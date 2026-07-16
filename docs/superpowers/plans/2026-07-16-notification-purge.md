# 알림 통합·삭제(퍼지)·100개 한도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 벨 알림을 완결된 알림함으로 — 승인 이벤트(checkout·permission) 벨 알림 추가, 개별/일괄/조건 삭제 API+UI, 인당 100개 한도, 벨→알림탭 딥링크, 카테고리 필터, sysadmin 기간 퍼지, 인덱스 2종, 매뉴얼 갱신.

**Architecture:** 생성은 기존 단일 헬퍼 `create_notifications`(async화+캡 트리밍) 경유 유지. 사용자 삭제는 단일 `bulk-delete` 엔드포인트(조건 택1), 관리자 퍼지는 preview→confirm 2단계 알림 전용 엔드포인트. DB는 신규 컬럼 없음 — 인덱스 2개만(`_ADDED_INDEXES` 자동 보강).

**Tech Stack:** FastAPI+SQLAlchemy(async)+Pydantic / Next.js+React / pytest·vitest·Playwright

**Spec:** `docs/superpowers/specs/2026-07-16-notification-purge-design.md` (각 태스크 구현 전 해당 섹션 참조)

## Global Constraints

- 작업 디렉터리는 **반드시** `/Users/hyeonjin/Documents/bpm/.claude/worktrees/alarm-audit` (브랜치 `worktree-alarm-audit`). 시작 시 `pwd`와 `git branch --show-current`로 확인. main 체크아웃에서 커밋 금지.
- 백엔드 테스트 실행: `backend/`에서 `.venv/bin/python -m pytest tests/<file> -q` (전체 그린 확인은 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`). venv 없으면 `python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- 프론트: `frontend/`에서 `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. **React Compiler**: setState만 하는 트리비얼 핸들러는 useCallback 없이 plain function으로(deps 불일치 시 lint 실패). effect 안 동기 setState 금지(`set-state-in-effect`) — fetch `.then` 안은 허용.
- 타임스탬프는 KST 고정: BE `app/clock.py`(`now`, `KST`), FE `lib/datetime.formatKstShort`. `toLocaleString()` 금지.
- 컴포넌트에 raw hex 금지 — 토큰 클래스만(`text-error`, `border-hairline`, `bg-surface-alt` 등). 아이콘은 Lucide 16px(카드 내부 14) strokeWidth 1.5, 이모지 금지. UI 문구는 i18n 키로 EN/KO 쌍 등록(`i18n-messages.ts` — EN 섹션 ~613행대, KO 섹션 ~1983행대에 각각 추가).
- 함수명은 동사 시작(`get`/`create`/`delete`/`is` …). 커밋 메시지 `type(scope): English — 한국어`. **모든 커밋에 `PROGRESS.md` 한 줄 갱신을 같은 커밋으로 포함**(기존 2026-07-16 항목 아래 하위 불릿 추가면 충분).
- 신규 비즈니스 상수는 .env 항목 없이 모듈 상수(기존 `GROUP_RETENTION` 관례).
- `grep`은 ugrep이라 `[mapId]` 등 대괄호 디렉터리를 조용히 건너뜀 — frontend 검색은 `find`+개별 grep 또는 Read로 검증.

---

### Task 1: 인덱스 2종 + `db.py` `_ADDED_INDEXES` 부트스트랩

**Files:**
- Modify: `backend/app/models.py:317-330` (Notification)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 아래 + `init_models`)
- Test: `backend/tests/test_db.py` (append)

**Interfaces:**
- Produces: `db._add_missing_indexes(conn)` — startup 멱등 인덱스 보강. 인덱스명 `ix_notifications_recipient_read`, `ix_notifications_recipient_created`.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_db.py` 끝에 추가 (파일 상단 기존 import에 없으면 `import asyncio`, `from sqlalchemy import inspect, text`, `from app.db import engine` 추가):

```python
def test_added_indexes_bootstrap_idempotent(client) -> None:
    """기존 DB에 인덱스가 없어도 startup 보강이 만들고, 재실행은 no-op(멱등)."""
    from app.db import _add_missing_indexes

    async def _run() -> list[str]:
        async with engine.begin() as conn:
            # 기존-DB 시뮬레이션: 하나 지우고 보강 2회(멱등) 후 인덱스 목록
            await conn.execute(text("DROP INDEX IF EXISTS ix_notifications_recipient_read"))
            await conn.run_sync(_add_missing_indexes)
            await conn.run_sync(_add_missing_indexes)
            return await conn.run_sync(
                lambda c: [ix["name"] for ix in inspect(c).get_indexes("notifications")]
            )

    names = asyncio.run(_run())
    assert "ix_notifications_recipient_read" in names
    assert "ix_notifications_recipient_created" in names
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_db.py -q` → Expected: FAIL (`ImportError: _add_missing_indexes`)

- [ ] **Step 3: 구현** — `models.py` Notification의 `created_at` 컬럼 선언 다음 줄에 (Index는 이미 import되어 있음 — ai_chat_sessions에서 사용 중):

```python
    __table_args__ = (
        # recipient 축 인덱스 — 5초 폴링 목록/미읽음 카운트, 정렬·캡 트리밍·날짜 삭제 (design 2026-07-16)
        Index("ix_notifications_recipient_read", "recipient", "read"),
        Index("ix_notifications_recipient_created", "recipient", "created_at"),
    )
```

`db.py` — `_ADDED_COLUMNS` 리스트 정의 바로 아래:

```python
# 기존 테이블에 추가된 인덱스 보강 — create_all은 이미 존재하는 테이블의 인덱스를 만들지 않는다.
# (table, index_name, "(col, ...)") — CREATE INDEX IF NOT EXISTS는 sqlite/postgres 공통 지원 (2026-07-16)
_ADDED_INDEXES: list[tuple[str, str, str]] = [
    ("notifications", "ix_notifications_recipient_read", "(recipient, read)"),
    ("notifications", "ix_notifications_recipient_created", "(recipient, created_at)"),
]


def _add_missing_indexes(conn: Connection) -> None:
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    for table, index_name, cols in _ADDED_INDEXES:
        if table not in tables:
            continue  # 신규 테이블은 create_all이 __table_args__ 인덱스 포함해 생성
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} {cols}"))
```

`init_models()` 내 `await conn.run_sync(_add_missing_columns)` 다음 줄에 `await conn.run_sync(_add_missing_indexes)` 추가.

- [ ] **Step 4: 통과 확인** — Run: `.venv/bin/python -m pytest tests/test_db.py -q` → Expected: PASS
- [ ] **Step 5: Commit** — `git add backend/app/models.py backend/app/db.py backend/tests/test_db.py PROGRESS.md && git commit -m "feat(db): notifications indexes + _ADDED_INDEXES bootstrap — 알림 인덱스 2종 자동 보강"`

---

### Task 2: `create_notifications` async화 + 인당 100캡 트리밍

**Files:**
- Modify: `backend/app/workflow.py:42-64` (+ 내부 호출 148·160행)
- Modify: `backend/app/routers/versions.py:512,566,610,662` / `backend/app/routers/notices.py:84` — `await` 부착
- Test: `backend/tests/test_notifications.py` (append)

**Interfaces:**
- Produces: `async def create_notifications(session, recipients, *, type, map_id=None, version_id=None, message) -> None` — **이후 모든 태스크는 `await`로 호출**. 상수 `workflow.NOTIFICATION_CAP = 100`.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_notifications.py` 끝에 (상단에 `from app.workflow import create_notifications` 추가):

```python
def test_notification_cap_trims_oldest(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """인당 100개 초과분은 읽음 여부 무관 오래된 순 삭제 — 생성 시점 트리밍."""

    async def _run() -> None:
        async with SessionLocal() as session:
            for i in range(105):
                await create_notifications(
                    session, ["cap-user"], type="notice", message=f"cap {i}"
                )
            await session.commit()

    asyncio.run(_run())
    monkeypatch.setattr(settings, "dev_user", "cap-user")
    items = client.get("/api/notifications").json()
    assert len(items) == 100
    messages = {n["message"] for n in items}
    assert "cap 104" in messages  # 최신 생존
    assert "cap 4" not in messages  # 최고령 5개(0..4) 삭제
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py::test_notification_cap_trims_oldest -q` → Expected: FAIL (sync 함수라 `await` 불가 TypeError)

- [ ] **Step 3: 구현** — `workflow.py`: 상단 import에 `delete` 추가(`from sqlalchemy import delete, select`), 상수 및 함수 교체:

```python
NOTIFICATION_CAP = 100  # 인당 알림 보존 상한 — 초과분은 읽음 여부 무관 오래된 순 삭제 (design 2026-07-16)


async def create_notifications(
    session: AsyncSession,
    recipients: list[str],
    *,
    type: str,
    map_id: int | None = None,
    version_id: int | None = None,
    message: str,
) -> None:
    """수신자별 알림 행 추가 + 인당 NOTIFICATION_CAP 초과분 트리밍 — commit은 호출자 책임.

    map_id/version_id는 선택 — 맵/버전과 무관한 알림(공지 등)은 생략.
    트리밍의 select가 autoflush로 pending add를 먼저 flush한다.
    """
    for recipient in recipients:
        session.add(
            Notification(
                recipient=recipient,
                type=type,
                map_id=map_id,
                version_id=version_id,
                message=message,
            )
        )
    for recipient in dict.fromkeys(recipients):  # 중복 수신자 1회만 트리밍
        stale_ids = (
            await session.scalars(
                select(Notification.id)
                .where(Notification.recipient == recipient)
                .order_by(Notification.created_at.desc(), Notification.id.desc())
                .offset(NOTIFICATION_CAP)
            )
        ).all()
        if stale_ids:
            await session.execute(
                delete(Notification).where(Notification.id.in_(stale_ids))
            )
```

호출부 7곳 전부 `await` 부착: `workflow.py:148,160`(`create_notifications(` → `await create_notifications(`), `versions.py:512,566,610,662`(`workflow.create_notifications(` → `await workflow.create_notifications(`), `notices.py:84`. 완료 후 `grep -rn "create_notifications(" backend/app/ | grep -v "await\|def "` 결과가 0건이어야 함.

- [ ] **Step 4: 통과+무회귀 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py tests/test_versions.py tests/test_notices.py tests/test_workflow.py tests/test_departed_reconcile.py -q` → Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(notifications): per-user 100 cap in async create_notifications — 인당 100개 한도 트리밍"` (변경 파일 + PROGRESS.md)

---

### Task 3: checkout 벨 알림 3종 (`checkout_requested/approved/rejected`)

**Files:**
- Modify: `backend/app/routers/checkout.py` (request_checkout :75 부근, decide_checkout_request :127-145 부근)
- Test: `backend/tests/test_notifications.py` (append)

**Interfaces:**
- Consumes: Task 2의 `await workflow.create_notifications(...)`
- Produces: type 문자열 `checkout_requested`·`checkout_approved`·`checkout_rejected` (FE Task 7 카테고리 매핑이 `checkout_` 접두사에 의존)

- [ ] **Step 1: 실패하는 테스트 작성** — `test_notifications.py` 끝에:

```python
def _checkout_map(client: TestClient, monkeypatch: pytest.MonkeyPatch, owner: str, seq: str) -> tuple[int, int]:
    """owner가 맵 생성(+v1 점유). 반환 (map_id, version_id)."""
    monkeypatch.setattr(settings, "dev_user", owner)
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"co map {seq}"},
    ).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})  # 이미 점유 중이면 409 — 무시
    return map_id, version_id


def test_checkout_request_notifies_holder_and_owner(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """점유 요청 → 현 점유자+오너에게 checkout_requested (요청자 제외, 중복 제거로 1건)."""
    _map_id, version_id = _checkout_map(client, monkeypatch, "co-owner1", "n1")
    monkeypatch.setattr(settings, "dev_user", "co-req1")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 201

    monkeypatch.setattr(settings, "dev_user", "co-owner1")
    got = [n for n in client.get("/api/notifications?unread_only=true").json() if n["type"] == "checkout_requested"]
    assert len(got) == 1  # holder==owner 중복 제거
    assert got[0]["version_id"] == version_id
    monkeypatch.setattr(settings, "dev_user", "co-req1")
    assert [n for n in client.get("/api/notifications").json() if n["type"] == "checkout_requested"] == []


def test_checkout_decision_notifies_requester(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """승인/거절 결과가 요청자에게 checkout_approved/rejected로 간다."""
    _map_id, version_id = _checkout_map(client, monkeypatch, "co-owner2", "n2")
    monkeypatch.setattr(settings, "dev_user", "co-req2")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]
    monkeypatch.setattr(settings, "dev_user", "co-owner2")
    assert client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": False}).status_code == 200

    monkeypatch.setattr(settings, "dev_user", "co-req2")
    types = [n["type"] for n in client.get("/api/notifications?unread_only=true").json()]
    assert "checkout_rejected" in types
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py -q -k checkout` → Expected: 2 FAIL (알림 0건)

- [ ] **Step 3: 구현** — `checkout.py`. `request_checkout`의 `session.add(req)`(75행) 다음, `await session.commit()` 전에:

```python
    # 벨 알림 — 처리 가능자(현 점유자+오너)에게 요청 발생 통지, 요청자 제외 (design 2026-07-16)
    requester_name = await workflow.get_display_name(session, user)
    owner_ids = (
        await session.scalars(
            select(MapPermission.principal_id).where(
                MapPermission.map_id == version.map_id,
                MapPermission.principal_type == "user",
                MapPermission.role == "owner",
            )
        )
    ).all()
    holder = [version.checked_out_by] if version.checked_out_by else []
    recipients = [r for r in dict.fromkeys(holder + list(owner_ids)) if r != user]
    await workflow.create_notifications(
        session,
        recipients,
        type="checkout_requested",
        map_id=version.map_id,
        version_id=version_id,
        message=f"{requester_name} requested checkout of '{version.label}'",
    )
```

`decide_checkout_request` — approve 분기(127-142행)의 벌크 자동거절 `update` **직전에** 다른 미결 요청자 캡처(업데이트 후엔 pending이 아니라 못 찾음), 분기 종료 후 `await session.commit()` 전에 알림 생성:

```python
    auto_rejected: list[str] = []
    if payload.approve:
        auto_rejected = list(
            (
                await session.scalars(
                    select(CheckoutRequest.requested_by).where(
                        CheckoutRequest.version_id == req.version_id,
                        CheckoutRequest.status == "pending",
                        CheckoutRequest.id != req.id,
                    )
                )
            ).all()
        )
        # …기존 approve 블록(점유 이전 + 벌크 자동거절 update) 그대로…
    else:
        req.status = "rejected"

    # 벨 알림 — 결과를 요청자에게, 자동 거절된 다른 요청자에게도 (design 2026-07-16)
    outcome = "approved" if payload.approve else "rejected"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type=f"checkout_{outcome}",
        map_id=version.map_id,
        version_id=version.id,
        message=f"Your checkout request for '{version.label}' was {outcome}",
    )
    if auto_rejected:
        await workflow.create_notifications(
            session,
            list(dict.fromkeys(auto_rejected)),
            type="checkout_rejected",
            map_id=version.map_id,
            version_id=version.id,
            message=f"Your checkout request for '{version.label}' was rejected",
        )
```

- [ ] **Step 4: 통과+무회귀 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py tests/test_version_lifecycle.py tests/test_inbox.py -q` → Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(checkout): bell notifications for request/decision — 점유권 요청·결과 벨 알림"`

---

### Task 4: permission 벨 알림 3종 (`permission_requested/approved/rejected`)

**Files:**
- Modify: `backend/app/routers/permissions.py` — ApprovalRequest 생성 3지점(154·197·294 부근) + `decide_approval_request`(350 부근)
- Test: `backend/tests/test_notifications.py` (append)

**Interfaces:**
- Consumes: `await workflow.create_notifications`, `workflow.load_active_approvers(session, map_id)`, `workflow.get_display_name`
- Produces: type `permission_requested`·`permission_approved`·`permission_rejected` (FE는 `permission_` 접두사 의존)

- [ ] **Step 1: 실패하는 테스트 작성** — `test_notifications.py` 끝에 (visibility 경로로 생성 지점 대표 + decide 결과):

```python
def test_visibility_request_notifies_approvers_and_decision_notifies_requester(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """가시성 변경 요청 → 활성 승인자에게 permission_requested, 반려 → 요청자에게 permission_rejected."""
    _ensure_employee("perm-appr1")
    monkeypatch.setattr(settings, "dev_user", "perm-owner1")
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": "perm map n1"},
    ).json()
    map_id = created["id"]
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["perm-appr1"]})
    req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()

    monkeypatch.setattr(settings, "dev_user", "perm-appr1")
    got = [n for n in client.get("/api/notifications?unread_only=true").json() if n["type"] == "permission_requested"]
    assert len(got) == 1 and got[0]["map_id"] == map_id
    assert "visibility change" in got[0]["message"]

    client.post(f"/api/approval-requests/{req['id']}/decide", json={"decision": "reject"})
    monkeypatch.setattr(settings, "dev_user", "perm-owner1")
    types = [n["type"] for n in client.get("/api/notifications?unread_only=true").json()]
    assert "permission_rejected" in types
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py -q -k visibility` → Expected: FAIL

- [ ] **Step 3: 구현** — `permissions.py` 상단에 `from app import workflow` 추가. 공용 헬퍼를 파일 하단 `_serialize_request` 위에 추가:

```python
async def _notify_permission_request(
    session: AsyncSession, *, map_id: int, map_name: str, requested_by: str, kind: str
) -> None:
    """승인 지연 요청 발생 → 활성 승인자에게 벨 알림 (요청자 제외, design 2026-07-16)."""
    requester_name = await workflow.get_display_name(session, requested_by)
    what = "a visibility change" if kind == "visibility_change" else "a permission change"
    recipients = [
        a for a in await workflow.load_active_approvers(session, map_id) if a != requested_by
    ]
    await workflow.create_notifications(
        session,
        recipients,
        type="permission_requested",
        map_id=map_id,
        message=f"{requester_name} requested {what} on '{map_name}'",
    )
```

생성 3지점 각각 `session.add(req)` 다음, `await session.commit()` 전에 호출:
- `update_permission`(154 부근): `await _notify_permission_request(session, map_id=map_id, map_name=found_map.name, requested_by=user, kind="permission_downgrade")` — `found_map`은 145행에서 이미 로드됨.
- `delete_permission`(197 부근): 분기 진입부에 `found_map = await _get_map_or_404(session, map_id)` 추가 후 동일 호출(kind="permission_downgrade").
- `request_visibility_change`(294 부근): `found_map` 이미 로드됨 — kind="visibility_change"로 호출.

`decide_approval_request` — reject 조기 반환 분기(371-374)와 approve 경로(377-379) **양쪽** commit 전에:

```python
    found_map = await session.get(ProcessMap, req.map_id)
    map_name = found_map.name if found_map is not None else f"map {req.map_id}"
    outcome = "rejected" if payload.decision == "reject" else "approved"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type=f"permission_{outcome}",
        map_id=req.map_id,
        message=f"Your request on '{map_name}' was {outcome}",
    )
```

(중복을 피하려면 decide 함수 초입에서 두 분기 공통 직전 위치로 리팩터해도 좋으나, 기존 조기-반환 구조 유지가 우선 — 각 분기에 2줄 호출로.)

- [ ] **Step 4: 통과+무회귀 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py tests/test_permission_endpoints.py tests/test_permission_gates.py -q` → Expected: PASS. 다운그레이드 2지점은 visibility와 동일 헬퍼 공유 — `test_change_role_downgrade_deferred_non_owner`(기존, :318) 그린이 회귀 가드.
- [ ] **Step 5: Commit** — `git commit -m "feat(permissions): bell notifications for approval requests/decisions — 권한·가시성 요청/결과 벨 알림"`

---

### Task 5: 사용자 삭제 API — `DELETE /{id}` + `POST /bulk-delete`

**Files:**
- Modify: `backend/app/schemas.py` (NotificationOut(764-773) 아래)
- Modify: `backend/app/routers/notifications.py`
- Test: `backend/tests/test_notifications.py` (append)

**Interfaces:**
- Produces: `DELETE /api/notifications/{id}` → 204 / 404(타인). `POST /api/notifications/bulk-delete` body `{ids | read_only | before}` 정확히 1개 → `{"deleted": n}`. FE Task 7이 이 계약 사용.
- Produces(스키마): `NotificationBulkDeleteIn`, `NotificationBulkDeleteOut(deleted: int)` — Task 6 응답에도 재사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_notifications.py` 끝에 (상단 import에 `from datetime import datetime` / `from app.clock import KST` / `from app.models import Notification` 추가):

```python
def _seed_notifs(recipient: str, count: int, *, read: bool = False, old: bool = False) -> list[int]:
    """직접 시드 — bulk-delete 모드 테스트용. old=True면 created_at을 과거로."""

    async def _run() -> list[int]:
        async with SessionLocal() as session:
            rows = [
                Notification(
                    recipient=recipient,
                    type="notice",
                    message=f"bd {i}",
                    read=read,
                    created_at=datetime(2026, 1, 1, tzinfo=KST) if old else None,
                )
                for i in range(count)
            ]
            for row in rows:
                if row.created_at is None:
                    row.created_at = datetime(2026, 7, 15, tzinfo=KST)
                session.add(row)
            await session.commit()
            return [r.id for r in rows]

    return asyncio.run(_run())


def test_delete_notification_own_and_foreign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    (nid,) = _seed_notifs("del-a1", 1)
    monkeypatch.setattr(settings, "dev_user", "del-b1")
    assert client.delete(f"/api/notifications/{nid}").status_code == 404  # 타인 → 404
    monkeypatch.setattr(settings, "dev_user", "del-a1")
    assert client.delete(f"/api/notifications/{nid}").status_code == 204
    assert client.get("/api/notifications").json() == []


def test_bulk_delete_ids_only_own_rows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    mine = _seed_notifs("bd-a2", 2)
    other = _seed_notifs("bd-b2", 1)
    monkeypatch.setattr(settings, "dev_user", "bd-a2")
    res = client.post("/api/notifications/bulk-delete", json={"ids": mine + other})
    assert res.status_code == 200 and res.json()["deleted"] == 2  # 타인 행은 교집합에서 제외
    monkeypatch.setattr(settings, "dev_user", "bd-b2")
    assert len(client.get("/api/notifications").json()) == 1


def test_bulk_delete_read_only_and_before(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_notifs("bd-a3", 2, read=True)
    _seed_notifs("bd-a3", 1, read=False)
    monkeypatch.setattr(settings, "dev_user", "bd-a3")
    assert client.post("/api/notifications/bulk-delete", json={"read_only": True}).json()["deleted"] == 2
    assert len(client.get("/api/notifications").json()) == 1

    _seed_notifs("bd-a4", 2, old=True)  # 2026-01-01
    _seed_notifs("bd-a4", 1)  # 2026-07-15
    monkeypatch.setattr(settings, "dev_user", "bd-a4")
    assert client.post("/api/notifications/bulk-delete", json={"before": "2026-07-01"}).json()["deleted"] == 2
    assert len(client.get("/api/notifications").json()) == 1


def test_bulk_delete_requires_exactly_one_criterion(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "bd-a5")
    assert client.post("/api/notifications/bulk-delete", json={}).status_code == 422
    assert (
        client.post(
            "/api/notifications/bulk-delete", json={"read_only": True, "before": "2026-07-01"}
        ).status_code
        == 422
    )
    assert client.post("/api/notifications/bulk-delete", json={"read_only": False}).status_code == 422
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py -q -k "delete or bulk"` → Expected: FAIL (405/404)

- [ ] **Step 3: 구현** — `schemas.py`의 NotificationOut 아래 (파일 상단 import에 `date`가 없으면 `from datetime import date, datetime` 형태로 확장; `model_validator`는 기존 import에 있음):

```python
class NotificationBulkDeleteIn(BaseModel):
    """알림 일괄 삭제 — ids/read_only/before 중 정확히 1개 (design 2026-07-16).

    before는 해당 날짜 00:00 KST 미만(그 이전 날들) 삭제.
    """

    ids: list[int] | None = None
    read_only: bool | None = None
    before: date | None = None

    @model_validator(mode="after")
    def validate_exactly_one_criterion(self) -> "NotificationBulkDeleteIn":
        provided = [self.ids is not None, self.read_only is not None, self.before is not None]
        if sum(provided) != 1:
            raise ValueError("provide exactly one of: ids, read_only, before")
        if self.read_only is False:
            raise ValueError("read_only must be true when provided")
        return self


class NotificationBulkDeleteOut(BaseModel):
    deleted: int
```

`notifications.py` — import 확장(`from datetime import datetime, time` / `from sqlalchemy import delete, select, update` / `from app.clock import KST` / 스키마 2종) 후 라우트 2개 추가:

```python
@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """개별 삭제 — 본인 수신분만(타인 것은 존재 노출 없이 404, mark_read와 동일 패턴)."""
    notif = await session.get(Notification, notification_id)
    if notif is None or notif.recipient != user:
        raise HTTPException(
            status_code=404, detail=f"notification {notification_id} not found"
        )
    await session.delete(notif)
    await session.commit()


@router.post("/bulk-delete", response_model=NotificationBulkDeleteOut)
async def bulk_delete_notifications(
    payload: NotificationBulkDeleteIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """조건별 일괄 삭제 — 항상 본인 수신분만. ids는 본인 소유와의 교집합만 삭제."""
    stmt = delete(Notification).where(Notification.recipient == user)
    if payload.ids is not None:
        stmt = stmt.where(Notification.id.in_(payload.ids))
    elif payload.read_only:
        stmt = stmt.where(Notification.read.is_(True))
    else:  # before — 해당 날짜 00:00 KST 미만
        cutoff = datetime.combine(payload.before, time.min, tzinfo=KST)
        stmt = stmt.where(Notification.created_at < cutoff)
    result = await session.execute(stmt)
    await session.commit()
    return NotificationBulkDeleteOut(deleted=result.rowcount or 0)
```

- [ ] **Step 4: 통과 확인** — Run: `.venv/bin/python -m pytest tests/test_notifications.py -q` → Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(notifications): single delete + criteria bulk-delete API — 알림 개별/일괄 삭제 API"`

---

### Task 6: 관리자 퍼지 — `GET purge-preview` + `POST purge`

**Files:**
- Modify: `backend/app/schemas.py` (Task 5 스키마 아래)
- Modify: `backend/app/routers/admin.py` (read_table 아래)
- Test: `backend/tests/test_admin_notifications.py` (create)

**Interfaces:**
- Consumes: `NotificationBulkDeleteOut`(Task 5), `admin.py`의 `_require_sysadmin`
- Produces: `GET /api/admin/notifications/purge-preview?from=YYYY-MM-DD&to=YYYY-MM-DD` → `[{type, message, count, first_at, last_at}]` (last_at desc). `POST /api/admin/notifications/purge` body `{"from", "to", "groups":[{type,message}]}` → `{"deleted": n}`. 기간은 `[from 00:00, to+1일 00:00) KST`.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_admin_notifications.py` 신규 (fixture는 `test_admin_tables.py:16`의 `sysadmin_enforced` 패턴 복사):

```python
"""/api/admin/notifications/purge-preview + purge — sysadmin 기간 퍼지 (design 2026-07-16)."""

import asyncio
from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.clock import KST
from app.db import SessionLocal
from app.models import Notification
from app.settings import settings

SYSADMIN = "admin.purge"


@pytest.fixture()
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    prev_user = settings.dev_user
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    settings.dev_user = SYSADMIN
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    settings.dev_user = prev_user


def _seed(recipient: str, type_: str, message: str, day: int) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(
                Notification(
                    recipient=recipient,
                    type=type_,
                    message=message,
                    created_at=datetime(2026, 6, day, 12, 0, tzinfo=KST),
                )
            )
            await session.commit()

    asyncio.run(_run())


def test_purge_preview_groups_by_type_message(
    client: TestClient, sysadmin_enforced: None
) -> None:
    _seed("pg-u1", "notice", "june notice", 5)
    _seed("pg-u2", "notice", "june notice", 6)
    _seed("pg-u3", "published", "pv published", 6)
    _seed("pg-u4", "notice", "outside", 20)  # 범위 밖

    res = client.get("/api/admin/notifications/purge-preview?from=2026-06-01&to=2026-06-10")
    assert res.status_code == 200
    groups = {(g["type"], g["message"]): g["count"] for g in res.json()}
    assert groups[("notice", "june notice")] == 2  # 수신자 2명 → 1묶음 count 2
    assert groups[("published", "pv published")] == 1
    assert ("notice", "outside") not in groups


def test_purge_deletes_only_confirmed_groups_in_range(
    client: TestClient, sysadmin_enforced: None
) -> None:
    _seed("pp-u1", "notice", "kill me", 5)
    _seed("pp-u2", "notice", "kill me", 6)
    _seed("pp-u3", "notice", "keep me", 6)
    _seed("pp-u4", "notice", "kill me", 20)  # 범위 밖 — 생존해야 함

    res = client.post(
        "/api/admin/notifications/purge",
        json={
            "from": "2026-06-01",
            "to": "2026-06-10",
            "groups": [{"type": "notice", "message": "kill me"}],
        },
    )
    assert res.status_code == 200 and res.json()["deleted"] == 2

    settings.dev_user = "pp-u3"
    assert [n["message"] for n in client.get("/api/notifications").json()] == ["keep me"]
    settings.dev_user = "pp-u4"
    assert len(client.get("/api/notifications").json()) == 1


def test_purge_non_sysadmin_403_and_empty_groups_422(
    client: TestClient, sysadmin_enforced: None
) -> None:
    settings.dev_user = "pg-nobody"
    assert client.get(
        "/api/admin/notifications/purge-preview?from=2026-06-01&to=2026-06-10"
    ).status_code == 403
    settings.dev_user = SYSADMIN
    assert client.post(
        "/api/admin/notifications/purge",
        json={"from": "2026-06-01", "to": "2026-06-10", "groups": []},
    ).status_code == 422
```

- [ ] **Step 2: 실패 확인** — Run: `.venv/bin/python -m pytest tests/test_admin_notifications.py -q` → Expected: FAIL (404)

- [ ] **Step 3: 구현** — `schemas.py`(Task 5 스키마 아래, `Field`/`ConfigDict`는 기존 import 확인 후 확장):

```python
class NotificationPurgeGroupOut(BaseModel):
    """purge-preview 1묶음 — type+message 동일 행 집계 (design 2026-07-16)."""

    type: str
    message: str
    count: int
    first_at: datetime
    last_at: datetime


class NotificationPurgeGroupIn(BaseModel):
    type: str
    message: str


class NotificationPurgeIn(BaseModel):
    """확정 퍼지 — [from 00:00, to+1일 00:00) KST 내 선택 묶음 전 수신자 행 삭제."""

    model_config = ConfigDict(populate_by_name=True)

    from_date: date = Field(alias="from")
    to_date: date = Field(alias="to")
    groups: list[NotificationPurgeGroupIn] = Field(min_length=1)
```

`admin.py` — import 확장(`from datetime import date, datetime, time, timedelta` / `and_`, `delete` sqlalchemy / `Notification` 모델 / `from app.clock import KST` / 신규 스키마 3종 + `NotificationBulkDeleteOut`), `read_table` 아래에:

```python
def _build_kst_range(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    """[from 00:00, to+1일 00:00) KST — to 날짜 하루 전체 포함."""
    start = datetime.combine(from_date, time.min, tzinfo=KST)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=KST)
    return start, end


@router.get("/notifications/purge-preview", response_model=list[NotificationPurgeGroupOut])
async def preview_notification_purge(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
) -> list[NotificationPurgeGroupOut]:
    """sysadmin 전용 — 기간 내 알림을 (type, message)로 묶어 검토 목록 반환 (last_at desc)."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(from_date, to_date)
    rows = await session.execute(
        select(
            Notification.type,
            Notification.message,
            func.count(),
            func.min(Notification.created_at),
            func.max(Notification.created_at),
        )
        .where(Notification.created_at >= start, Notification.created_at < end)
        .group_by(Notification.type, Notification.message)
        .order_by(func.max(Notification.created_at).desc())
    )
    return [
        NotificationPurgeGroupOut(type=r[0], message=r[1], count=r[2], first_at=r[3], last_at=r[4])
        for r in rows.all()
    ]


@router.post("/notifications/purge", response_model=NotificationBulkDeleteOut)
async def purge_notifications(
    payload: NotificationPurgeIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """sysadmin 전용 — 확정된 (type, message) 묶음의 기간 내 전 수신자 행 하드 삭제."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(payload.from_date, payload.to_date)
    group_match = or_(
        *[
            and_(Notification.type == g.type, Notification.message == g.message)
            for g in payload.groups
        ]
    )
    result = await session.execute(
        delete(Notification).where(
            Notification.created_at >= start, Notification.created_at < end, group_match
        )
    )
    await session.commit()
    return NotificationBulkDeleteOut(deleted=result.rowcount or 0)
```

- [ ] **Step 4: 통과+백엔드 전체 그린** — Run: `.venv/bin/python -m pytest tests/test_admin_notifications.py -q` PASS 후, `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/` → Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(admin): notification purge preview + period purge — 관리자 기간 퍼지 API"`

---

### Task 7: FE — API 클라이언트 + 카테고리 lib + vitest

**Files:**
- Modify: `frontend/src/lib/api.ts` (`markAllNotificationsRead`(1386-1388) 아래)
- Create: `frontend/src/lib/notification-categories.ts`
- Test: `frontend/src/lib/notification-categories.test.ts`

**Interfaces:**
- Produces(FE 전역): `deleteNotification(id)`, `bulkDeleteNotifications(body: NotificationBulkDelete)`, `previewNotificationPurge(from, to)`, `purgeNotifications(from, to, groups)`, 타입 `NotificationBulkDelete`/`NotificationBulkDeleteResult`/`NotificationPurgeGroup`; `getNotificationCategory(type): NotificationCategory | null`, `NOTIFICATION_CATEGORIES` 배열.

- [ ] **Step 1: 실패하는 테스트 작성** — `notification-categories.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { getNotificationCategory } from "./notification-categories";

describe("getNotificationCategory", () => {
  it("maps version workflow types", () => {
    for (const t of ["review_requested", "approved", "rejected", "published", "approval_cancelled"]) {
      expect(getNotificationCategory(t)).toBe("version");
    }
  });
  it("maps checkout_/permission_ prefixes and notice", () => {
    expect(getNotificationCategory("checkout_requested")).toBe("checkout");
    expect(getNotificationCategory("checkout_rejected")).toBe("checkout");
    expect(getNotificationCategory("permission_approved")).toBe("permission");
    expect(getNotificationCategory("notice")).toBe("notice");
  });
  it("returns null for unknown types (All에서만 노출)", () => {
    expect(getNotificationCategory("mystery")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/lib/notification-categories.test.ts` → Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `notification-categories.ts`:

```typescript
// 알림 type → 카테고리 매핑 — 인박스 필 필터 공용 (design 2026-07-16)

export type NotificationCategory = "version" | "checkout" | "permission" | "notice";

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "version",
  "checkout",
  "permission",
  "notice",
];

const VERSION_TYPES = new Set([
  "review_requested",
  "approved",
  "rejected",
  "published",
  "approval_cancelled",
]);

export function getNotificationCategory(type: string): NotificationCategory | null {
  if (VERSION_TYPES.has(type)) return "version";
  if (type.startsWith("checkout_")) return "checkout";
  if (type.startsWith("permission_")) return "permission";
  if (type === "notice") return "notice";
  return null; // 미지 type — All에서만 노출
}
```

`api.ts` — `markAllNotificationsRead` 아래에 (기존 `request` 헬퍼·JSON.stringify 관례 그대로):

```typescript
export function deleteNotification(id: number): Promise<void> {
  return request<void>(`/notifications/${id}`, { method: "DELETE" });
}

// bulk-delete — ids/read_only/before 중 정확히 1개 (백엔드 422 검증)
export interface NotificationBulkDelete {
  ids?: number[];
  read_only?: boolean;
  before?: string; // YYYY-MM-DD — 해당 날짜 00:00 KST 미만 삭제
}

export interface NotificationBulkDeleteResult {
  deleted: number;
}

export function bulkDeleteNotifications(
  body: NotificationBulkDelete,
): Promise<NotificationBulkDeleteResult> {
  return request<NotificationBulkDeleteResult>("/notifications/bulk-delete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── 관리자 알림 퍼지 (sysadmin, design 2026-07-16) ──────────────

export interface NotificationPurgeGroup {
  type: string;
  message: string;
  count: number;
  first_at: string;
  last_at: string;
}

export function previewNotificationPurge(
  from: string,
  to: string,
): Promise<NotificationPurgeGroup[]> {
  return request<NotificationPurgeGroup[]>(
    `/admin/notifications/purge-preview?from=${from}&to=${to}`,
  );
}

export function purgeNotifications(
  from: string,
  to: string,
  groups: { type: string; message: string }[],
): Promise<NotificationBulkDeleteResult> {
  return request<NotificationBulkDeleteResult>("/admin/notifications/purge", {
    method: "POST",
    body: JSON.stringify({ from, to, groups }),
  });
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/notification-categories.test.ts && npx tsc --noEmit` → Expected: PASS / 0 errors
- [ ] **Step 5: Commit** — `git commit -m "feat(fe): notification delete/purge api client + category mapping — FE 클라이언트·카테고리 매핑"`

---

### Task 8: FE — 벨 드롭다운 (삭제 버튼 + 클릭 네비게이션)

**Files:**
- Modify: `frontend/src/components/notification-bell.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN·KO 두 섹션)

**Interfaces:**
- Consumes: `deleteNotification`(Task 7)
- Produces: 벨 항목 클릭 → `/inbox?notification=<id>` (Task 9 딥링크가 소비)

- [ ] **Step 1: 구현** (표시 컴포넌트 — vitest 대신 Task 12 Playwright로 검증):
  - import 추가: `import { Bell, X } from "lucide-react";` / `import { useRouter } from "next/navigation";` / api import에 `deleteNotification` 추가.
  - 컴포넌트 상단에 `const router = useRouter();` 추가, 핸들러 2개 (plain function — React Compiler):

```tsx
  const handleDelete = async (id: number) => {
    try {
      await deleteNotification(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // 무시 — 다음 폴링에서 정합
    }
  };

  const handleOpen = (id: number) => {
    setOpen(false);
    router.push(`/inbox?notification=${id}`);
  };
```

  - `<li>`(88-104행) 교체 — 버튼 외 영역 클릭=이동, 읽음/삭제는 stopPropagation:

```tsx
                <li
                  key={item.id}
                  onClick={() => handleOpen(item.id)}
                  className={`flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1.5 text-caption hover:bg-surface-alt ${
                    item.read ? "text-ink-tertiary" : "text-ink"
                  }`}
                >
                  <span className="flex-1">{item.message}</span>
                  {!item.read && (
                    <button
                      type="button"
                      className="text-fine text-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRead(item.id);
                      }}
                    >
                      {t("notif.markRead")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("notif.delete")}
                    className="mt-0.5 shrink-0 text-ink-tertiary hover:text-error"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(item.id);
                    }}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </li>
```

  - i18n: EN 섹션 `notif.title` 부근에 `"notif.delete": "Delete",` / KO 섹션에 `"notif.delete": "삭제",` 추가.

- [ ] **Step 2: 게이트 확인** — Run: `npx tsc --noEmit && npm run lint` → Expected: 0 errors (특히 `react-hooks/preserve-manual-memoization` 없음)
- [ ] **Step 3: Commit** — `git commit -m "feat(bell): per-item delete + click-through to inbox — 벨 삭제 버튼·알림탭 이동"`

---

### Task 9: FE — 알림 탭 (딥링크·카테고리 필·선택/조건 삭제)

**Files:**
- Modify: `frontend/src/app/inbox/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN·KO)

**Interfaces:**
- Consumes: `bulkDeleteNotifications`/`deleteNotification`(Task 7), `getNotificationCategory`/`NOTIFICATION_CATEGORIES`(Task 7), 벨의 `?notification=<id>`(Task 8)
- 참고: ConfirmDialog는 이미 이 파일에서 import·사용 중 — **같은 파일 ApprovalDetail 하단(승인/반려 다이얼로그)의 prop 사용부를 열어 시그니처를 그대로 따를 것.**

- [ ] **Step 1: 구현**
  - **import**: lucide에 `Trash2`, `CalendarClock`, `CheckSquare`, `FileCheck`(기존), `ArrowLeftRight`(기존), `ShieldCheck`(기존), `Megaphone`(기존) 확인·추가. `useRouter` from `next/navigation`. api import에 `bulkDeleteNotifications`, `deleteNotification` 추가. `import { getNotificationCategory, NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notification-categories";`
  - **state 추가** (기존 state 선언부, 113-124행 부근):

```tsx
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<"all" | NotificationCategory>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [beforeDate, setBeforeDate] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<null | "ids" | "read" | "before">(null);
```

  - **딥링크 소비** — 마운트 effect(126-137행)의 `listNotifications().then` 콜백 확장 (`useSearchParams`는 Suspense 요구 — `window.location.search` 파싱으로 회피, setState는 `.then` 안이라 lint 안전):

```tsx
    listNotifications().then((data) => {
      if (!alive) return;
      setItems(data);
      const target = Number(new URLSearchParams(window.location.search).get("notification"));
      if (target) {
        setTab("notifications");
        const hit = data.find((n) => n.id === target);
        if (hit) {
          setSelectedId(hit.id);
          if (!hit.read) {
            void markNotificationRead(hit.id).then((updated) => {
              setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            });
          }
        }
        router.replace("/inbox"); // 파라미터 소거 — 재트리거 방지
      }
    });
```

  - **카테고리 필터 체인** — `byRead`(140행)와 `filterByQuery` 사이에 삽입, `useInfiniteSlice` resetKey에 카테고리 포함:

```tsx
  const byCategory =
    categoryFilter === "all"
      ? byRead
      : byRead.filter((n) => getNotificationCategory(n.type) === categoryFilter);
  const filtered = filterByQuery(byCategory, search, (n) => [
    { field: "message", text: n.message },
  ]).map((hit) => hit.item);
  // resetKey: `${readFilter}:${categoryFilter}:${search}`
```

  - **카테고리 필 옵션** — `filterOptions`(203행) 아래:

```tsx
  const CATEGORY_ICONS: Record<NotificationCategory, LucideIcon> = {
    version: FileCheck,
    checkout: ArrowLeftRight,
    permission: ShieldCheck,
    notice: Megaphone,
  };
  const categoryOptions: IconPillOption<"all" | NotificationCategory>[] = [
    { value: "all", label: t("inbox.catAll"), Icon: List },
    ...NOTIFICATION_CATEGORIES.map((c) => ({
      value: c,
      label: t(`inbox.cat.${c}` as MessageKey),
      Icon: CATEGORY_ICONS[c],
    })),
  ];
```

    렌더: 기존 읽음 IconPillFilter(250-256행) 아래 같은 행 또는 다음 행에 `{tab === "notifications" && <IconPillFilter options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />}` 추가.
  - **삭제 수행 함수** (plain async function, `markAll` 아래):

```tsx
  const performBulkDelete = async () => {
    if (!confirmDelete) return;
    const body =
      confirmDelete === "ids"
        ? { ids: [...selectedIds] }
        : confirmDelete === "read"
          ? { read_only: true }
          : { before: beforeDate };
    await bulkDeleteNotifications(body);
    const next = await listNotifications();
    setItems(next);
    setSelectedIds(new Set());
    setSelectMode(false);
    setConfirmDelete(null);
    if (selectedId !== null && !next.some((n) => n.id === selectedId)) setSelectedId(null);
  };

  const deleteOne = async (id: number) => {
    await deleteNotification(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
```

  - **툴바** — 알림 탭 전용, 필터 행 바로 아래(283행 부근)에 컴팩트 버튼 행 (`text-fine`, `border-hairline`, 밀도 규칙):

```tsx
            {tab === "notifications" && (
              <div className="flex flex-wrap items-center gap-2 pb-2 pr-3 text-fine">
                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedIds(new Set());
                  }}
                  className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 ${
                    selectMode
                      ? "border-accent-tint-border bg-accent-tint text-accent"
                      : "border-hairline text-ink-secondary hover:bg-surface-alt"
                  }`}
                >
                  <CheckSquare size={14} strokeWidth={1.5} />
                  {t("inbox.selectMode")}
                </button>
                {selectMode && (
                  <button
                    type="button"
                    disabled={selectedIds.size === 0}
                    onClick={() => setConfirmDelete("ids")}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-error disabled:opacity-40"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                    {t("inbox.deleteSelected", { count: selectedIds.size })}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!items.some((n) => n.read)}
                  onClick={() => setConfirmDelete("read")}
                  className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  {t("inbox.deleteRead")}
                </button>
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <CalendarClock size={14} strokeWidth={1.5} className="text-ink-tertiary" />
                  <input
                    type="date"
                    value={beforeDate}
                    onChange={(e) => setBeforeDate(e.target.value)}
                    className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink"
                  />
                  <button
                    type="button"
                    disabled={!beforeDate}
                    onClick={() => setConfirmDelete("before")}
                    className="rounded-sm border border-hairline px-2 py-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40"
                  >
                    {t("inbox.deleteBefore")}
                  </button>
                </span>
              </div>
            )}
```

  - **카드 변경** — 알림 카드(371-427행): (a) selectMode일 때 카드 클릭이 `toggleSelected(n.id)`로 동작(`onClick={(e) => { e.stopPropagation(); if (selectMode) toggleSelected(n.id); else void openNotification(n); }}`), 카드 좌상단에 체크박스 `<input type="checkbox" checked={selectedIds.has(n.id)} readOnly className="pointer-events-none" />` (아이콘 옆 배치); (b) 하단 시간 필 행에 개별 삭제 버튼:

```tsx
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            aria-label={t("notif.delete")}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteOne(n.id);
                            }}
                            className="text-ink-tertiary hover:text-error"
                          >
                            <Trash2 size={13} strokeWidth={1.5} />
                          </button>
                          <TimePills iso={n.created_at} nowMs={nowMs} />
                        </div>
```

  - **ConfirmDialog** — 페이지 return 최하단에 조건 렌더. **prop 시그니처는 같은 파일 ApprovalDetail의 승인/반려 ConfirmDialog 사용부를 그대로 복사**하고, 내용만: title=`t("inbox.deleteConfirmTitle")`, confirmLabel=`t("inbox.deleteConfirmAction")`, 요약 line 1줄 — `confirmDelete==="ids"` → `t("inbox.deleteConfirmIds", {count: selectedIds.size})`, `"read"` → `t("inbox.deleteConfirmRead", {count: items.filter((n)=>n.read).length})`, `"before"` → `t("inbox.deleteConfirmBefore", {date: beforeDate, count: items.filter((n)=>n.created_at.slice(0,10) < beforeDate).length})`. onConfirm=`() => void performBulkDelete()`, 취소=`() => setConfirmDelete(null)`.
  - **i18n 키** (EN/KO 두 섹션, `inbox.` 키들 부근):

| key | EN | KO |
|---|---|---|
| `inbox.catAll` | All | 전체 |
| `inbox.cat.version` | Version | 버전 |
| `inbox.cat.checkout` | Checkout | 점유권 |
| `inbox.cat.permission` | Permission | 권한 |
| `inbox.cat.notice` | Notice | 공지 |
| `inbox.selectMode` | Select | 선택 |
| `inbox.deleteSelected` | Delete selected ({count}) | 선택 삭제 ({count}) |
| `inbox.deleteRead` | Delete read | 읽은 알림 삭제 |
| `inbox.deleteBefore` | Delete older | 이전 알림 삭제 |
| `inbox.deleteConfirmTitle` | Delete notifications | 알림 삭제 |
| `inbox.deleteConfirmAction` | Delete | 삭제 |
| `inbox.deleteConfirmIds` | Delete {count} selected notification(s)? | 선택한 알림 {count}건을 삭제합니다 |
| `inbox.deleteConfirmRead` | Delete {count} read notification(s)? | 읽은 알림 {count}건을 삭제합니다 |
| `inbox.deleteConfirmBefore` | Delete {count} notification(s) before {date}? | {date} 이전 알림 {count}건을 삭제합니다 |

  - `typeIcon`(84-88행)에 신규 type 매핑 추가: `if (type.startsWith("checkout_")) return ArrowLeftRight;` / `if (type.startsWith("permission_")) return ShieldCheck;` (기존 notice/review_requested 유지, 나머지 Bell 폴백).

- [ ] **Step 2: 게이트 확인** — Run: `npx tsc --noEmit && npm run lint && npx vitest run` → Expected: 0 errors (set-state-in-effect·preserve-manual-memoization 주의)
- [ ] **Step 3: Commit** — `git commit -m "feat(inbox): deep link, category pills, checkbox/read/date bulk delete — 알림탭 딥링크·카테고리·삭제 3종"`

---

### Task 10: FE — 관리자 퍼지 UI (테이블 뷰어 + 모달)

**Files:**
- Create: `frontend/src/components/admin/notification-purge-modal.tsx`
- Modify: `frontend/src/components/admin/table-viewer.tsx` (헤더 바 199-215행 부근)
- Modify: `frontend/src/lib/i18n-messages.ts` (EN·KO, `db.` 키들 부근)

**Interfaces:**
- Consumes: `previewNotificationPurge`/`purgeNotifications`(Task 7)
- Produces: `<NotificationPurgeModal from to onClose onPurged />`

- [ ] **Step 1: 모달 구현** — `notification-purge-modal.tsx` 신규:

```tsx
"use client";

// 알림 기간 퍼지 모달 — preview(고유 묶음)를 체크박스로 확정 후 하드 삭제 (sysadmin, design 2026-07-16)

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  previewNotificationPurge,
  purgeNotifications,
  type NotificationPurgeGroup,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const keyOf = (g: NotificationPurgeGroup) => `${g.type} ${g.message}`;

export function NotificationPurgeModal({
  from,
  to,
  onClose,
  onPurged,
}: {
  from: string;
  to: string;
  onClose: () => void;
  onPurged: (deleted: number) => void;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<NotificationPurgeGroup[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    previewNotificationPurge(from, to)
      .then((data) => {
        if (!alive) return;
        setGroups(data);
        setChecked(new Set(data.map(keyOf))); // 기본 전체 선택
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runPurge = async () => {
    if (!groups || busy) return;
    setBusy(true);
    try {
      const confirmed = groups
        .filter((g) => checked.has(keyOf(g)))
        .map((g) => ({ type: g.type, message: g.message }));
      const result = await purgeNotifications(from, to, confirmed);
      onPurged(result.deleted);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const totalRows = (groups ?? [])
    .filter((g) => checked.has(keyOf(g)))
    .reduce((sum, g) => sum + g.count, 0);

  return (
    <div className="fixed inset-0 z-[1340] flex items-center justify-center bg-ink/30" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[36rem] flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-body-strong text-ink">{t("db.purgeTitle")}</p>
        <p className="text-caption text-ink-secondary">
          {t("db.purgeRange", { from, to })}
        </p>
        {error && <p className="text-caption text-error">{error}</p>}
        {groups === null ? (
          <div className="flex items-center gap-2 py-6 text-caption text-ink-tertiary">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            {t("db.loading")}
          </div>
        ) : groups.length === 0 ? (
          <p className="py-6 text-caption text-ink-tertiary">{t("db.purgeEmpty")}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-hairline">
            {groups.map((g) => {
              const key = keyOf(g);
              return (
                <li key={key} className="border-b border-divider last:border-0">
                  <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-alt">
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      onChange={() => toggle(key)}
                      className="mt-0.5"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-caption text-ink">{g.message}</span>
                      <span className="text-fine text-ink-tertiary">
                        {g.type} · {t("db.purgeRecipients", { count: g.count })} ·{" "}
                        {formatKstShort(g.first_at)} – {formatKstShort(g.last_at)}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            {t("db.purgeCancel")}
          </button>
          <button
            type="button"
            disabled={busy || checked.size === 0 || (groups ?? []).length === 0}
            onClick={() => void runPurge()}
            className="inline-flex items-center gap-1 rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent disabled:opacity-40"
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {t("db.purgeConfirm", { count: totalRows })}
          </button>
        </div>
      </div>
    </div>
  );
}
```

  (주의: `bg-error`·`text-on-accent` 토큰이 globals.css `@theme`에 없으면 기존 삭제 버튼 관례 — `deleteNotice`를 쓰는 `notices-manage-panel.tsx`의 삭제 확정 버튼 클래스 — 를 그대로 차용.)

- [ ] **Step 2: 테이블 뷰어 훅업** — `table-viewer.tsx`:
  - state 추가: `const [purgeFrom, setPurgeFrom] = useState(""); const [purgeTo, setPurgeTo] = useState(""); const [purgeOpen, setPurgeOpen] = useState(false); const [purgeResult, setPurgeResult] = useState<number | null>(null);`
  - import: `import { NotificationPurgeModal } from "./notification-purge-modal";` + lucide `Trash2`.
  - 헤더 바(199-215행) 우측 `filterInput` 옆에, **`selected === "notifications"`일 때만**:

```tsx
              {selected === "notifications" && (
                <span className="flex items-center gap-1.5 text-fine text-ink-tertiary">
                  <input type="date" value={purgeFrom} onChange={(e) => setPurgeFrom(e.target.value)}
                    className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink" />
                  –
                  <input type="date" value={purgeTo} onChange={(e) => setPurgeTo(e.target.value)}
                    className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink" />
                  <button
                    type="button"
                    disabled={!purgeFrom || !purgeTo || purgeTo < purgeFrom}
                    onClick={() => setPurgeOpen(true)}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-error disabled:opacity-40"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                    {t("db.purgeButton")}
                  </button>
                  {purgeResult !== null && (
                    <span className="text-ink-tertiary">{t("db.purgeDeleted", { count: purgeResult })}</span>
                  )}
                </span>
              )}
```

  - 컴포넌트 return 끝에 모달 조건 렌더 + 완료 시 재조회(테이블 목록 카운트 포함):

```tsx
      {purgeOpen && (
        <NotificationPurgeModal
          from={purgeFrom}
          to={purgeTo}
          onClose={() => setPurgeOpen(false)}
          onPurged={(deleted) => {
            setPurgeResult(deleted);
            setPage(1);
            setLoadedPage(0);
            setRows([]);
            void listDbTables().then(setTables); // pill 행수 갱신
          }}
        />
      )}
```

  (page/loadedPage 리셋으로 기존 fetch effect가 1페이지 재조회. `selectTable`과 동일 원리.)
  - i18n 키 (EN/KO, `db.` 부근):

| key | EN | KO |
|---|---|---|
| `db.purgeButton` | Delete in range | 기간 내 삭제 |
| `db.purgeTitle` | Purge notifications | 알림 일괄 삭제 |
| `db.purgeRange` | Notifications from {from} to {to}, grouped by content | {from} ~ {to} 알림을 내용별로 묶었습니다 |
| `db.purgeRecipients` | {count} recipient(s) | 수신자 {count}명 |
| `db.purgeEmpty` | No notifications in this range | 기간 내 알림이 없습니다 |
| `db.purgeCancel` | Cancel | 취소 |
| `db.purgeConfirm` | Delete {count} rows | {count}행 삭제 |
| `db.purgeDeleted` | Deleted {count} rows | {count}행 삭제됨 |

- [ ] **Step 3: 게이트 확인** — Run: `npx tsc --noEmit && npm run lint && npm run build` → Expected: 전부 통과
- [ ] **Step 4: Commit** — `git commit -m "feat(admin-ui): notifications period purge with preview modal — 테이블 뷰어 알림 퍼지 UI"`

---

### Task 11: 매뉴얼 갱신 (신규 기능 + 감사 불일치 4건)

**Files:**
- Modify: `docs/manual/user-manual-general-ko.md` (+ `-en.md` 대응 절)
- Modify: `docs/manual/admin-manual-ko.md` (+ `-en.md`)
- Modify: `backend/app/manual.md` (AI 프롬프트 번들 — 스테일이면 적극적 오답이 됨)

**Interfaces:** 없음 (문서만)

- [ ] **Step 1: user-manual-general (ko/en) — 알림 절 재작성.** 반영 사항:
  1. **[불일치 교정]** `:143` "알림 탭 — 이벤트 알림이 몇 초 간격으로 갱신됩니다" → 벨은 5초 자동 갱신, **알림 탭은 페이지 진입 시 로드**로 정정.
  2. **[신규]** 벨 항목 클릭 시 알림 탭으로 이동해 해당 알림이 열림. 벨/알림 탭에서 개별 삭제(X) 가능.
  3. **[신규]** 알림 탭: 카테고리 필터(전체/버전/점유권/권한/공지), 선택 모드 체크박스 일괄 삭제, 읽은 알림 삭제, 날짜 지정 이전 알림 삭제. 삭제는 되돌릴 수 없음.
  4. **[신규]** 보존 정책: 알림은 1인당 최근 100건 유지 — 초과분은 읽음 여부와 무관하게 오래된 것부터 자동 삭제.
  5. **[신규]** 점유권 이전·권한/가시성 요청과 그 결과도 이제 벨 알림으로 도착(승인 탭에도 그대로 표시).
  6. **[불일치 교정]** `:138` 공지 "읽음 처리" — 브라우저(기기)별 저장이라 다른 기기에선 초기화됨을 명시.
- [ ] **Step 2: admin-manual (ko/en).**
  1. **[불일치 교정]** `:59` 공지 "수정·삭제는 즉시 반영" → **삭제는 하드 삭제·복구 불가·휴지통 없음**(맵·그룹의 7일 휴지통과 다름) 명시. 단, 공지 삭제 시 이미 발송된 벨 알림은 남는다는 점 추가.
  2. **[신규]** 설정 → Database → Tables에서 `notifications` 선택 시 기간 지정 일괄 삭제: preview 묶음(내용·수신자 수) 확인 → 체크박스 확정 → 삭제. 복구 불가 경고.
  3. **[신규]** 알림 보존 100건/인 정책 항목 추가 (AI 챗 보존 상한 항목 `:184-190` 형식 참조).
- [ ] **Step 3: `backend/app/manual.md`** — 벨 서술(`:40` 부근)에 클릭 이동·삭제·100건 보존 추가, 알림 탭 삭제 3종 요약 1-2줄. 12k 토큰 선별 번들이므로 **간결하게**.
- [ ] **Step 4: Commit** — `git commit -m "docs(manual): notification deletion, retention cap, purge — 매뉴얼 알림 삭제·보존·퍼지 반영 + 불일치 4건 교정"`

---

### Task 12: 전체 게이트 + Playwright 실검증

**Files:**
- Create: `frontend/pw-verify-notifications.mjs` (기존 `pw-verify-dashboard.mjs` 하네스 구조 재사용 — playwright-core + 시스템 Chrome)

**사전 조건·함정** (`docs/lessons/browser-verification.md`):
- 좀비 next dev 전수 종료(`pkill -f "next dev"`) 후 재기동 — 3001 폴백이 구버전에 붙는 함정.
- dev.db 오염 주의 — 검증 전 `python -m scripts.reset_db && python -m scripts.seed_org_demo` (로컬 sqlite 한정, 운영 금지).
- devUser는 `admin.sys`(sysadmin — 관리자 퍼지 검증용).

- [ ] **Step 1: 백엔드 전체 그린** — Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/` → Expected: 전부 PASS
- [ ] **Step 2: 프론트 4중 게이트** — Run(frontend/): `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` → Expected: 전부 통과
- [ ] **Step 3: Playwright 시나리오 스크립트 작성·실행** — `pw-verify-dashboard.mjs`의 브라우저 기동·로그인(devUser)·대기 유틸을 복사해 다음 6개 시나리오를 순서대로 검증(각 PASS/FAIL 출력):
  1. **벨 → 딥링크**: 알림 시드(버전 제출로 생성) 후 벨 클릭 → 항목 본문 클릭 → URL이 `/inbox`이고 알림 탭 활성 + 해당 알림 상세 열림 + 읽음 처리됨.
  2. **벨 개별 삭제**: X 클릭 → 목록에서 즉시 제거, 5초 폴링 후에도 미복귀.
  3. **알림 탭 카테고리 필**: Notice 필 선택 시 notice type만 표시.
  4. **선택 삭제**: 선택 모드 → 2건 체크 → 선택 삭제 → ConfirmDialog 확인 → 목록 2건 감소.
  5. **읽은/이전 삭제**: 모두 읽음 → 읽은 알림 삭제 → 0건. (이전 삭제는 date input에 내일 날짜 → 전건 삭제로 확인.)
  6. **관리자 퍼지**: 설정 → Database → Tables → notifications 선택 → 기간 입력 → Delete in range → 모달 묶음 확인 → 삭제 → 행수 감소 확인.
- [ ] **Step 4: 결과 기록·커밋** — PROGRESS.md에 게이트·pw 결과 요약 1줄, `git commit -m "test(pw): notification flows e2e verification — 알림 플로우 Playwright 검증"`
- [ ] **Step 5: 잔여 리스크 보고** — `worktree-workflow-improvements`(미머지, `inbox/page.tsx` 승인 탭 수정)와의 충돌 가능성을 최종 보고에 명시. 서버(원격 IP·평문 HTTP) 검증은 배포 후 별도.

---

## Self-Review 결과 (플랜 작성자 확인)

- 스펙 §1(이벤트 6종)→T3·T4, §2(100캡)→T2, §3(사용자 API)→T5, §3-2(관리자)→T6, §4(인덱스)→T1, §5(벨)→T8, §6(알림 탭)→T9, §7(관리자 UI)→T10, §8(i18n·매뉴얼)→T8-T11, §9(검증)→각 태스크+T12. 커버리지 갭 없음.
- 다운그레이드 생성 2지점(permissions.py 154·197)은 공용 헬퍼 `_notify_permission_request` 공유로 visibility 테스트가 대표 — 기존 `test_change_role_downgrade_deferred_non_owner` 그린이 회귀 가드(T4 Step 4 명시).
- `NotificationBulkDeleteOut`을 T6 purge 응답에 재사용 — 타입명 일관 확인.
