# Framework 트랙 A — confirmed 상태 분리·옆문 봉쇄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** framework 캔버스 확정 스냅샷을 `published`에서 신규 `confirmed` 상태로 분리하고, 일반 버전 워크플로로 통하는 옆문(BE 12곳·FE 3표면)을 봉쇄하며, "담당자 확정" 전용 시각(워터마크·칩·필)을 입힌다.

**Architecture:** BE는 `workflow.py`에 상수 1개 추가 + `framework-confirm` 전이 변경 + 멱등 startup 데이터 이전 + 엔드포인트별 `mode=="framework"` 422 가드. FE는 `VersionStatus` 유니온 확장(Record 타입들이 컴파일 에러로 누락을 잡는 구조) + framework 전용 시각 분기. DB 스키마 변경 없음(status는 String(20) 자유 문자열).

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + vitest / Playwright(playwright-core + 시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md` (§3 상태 모델·§3.1 동반 수정·§3.2 시각·§6 옆문 봉쇄)

## Global Constraints

- 베이스 브랜치는 `dev`(통합 브랜치, 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`에 상시 체크아웃). 작업은 dev에서 딴 feature 브랜치 워크트리에서 하고 dev로 머지한다.
- BE 테스트: `backend/`에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/.env가 있으면 이 env 강제 없이는 깨진다).
- BE 린트: `.venv/bin/ruff check app/ tests/` — `target-version = "py311"` (PEP 695 등 3.12+ 문법 금지).
- FE 게이트: `frontend/`에서 `npx tsc --noEmit` · `npm run lint` · `npx vitest run` · `npm run build`.
- 색은 raw hex 금지 — 토큰만(`rules/frontend/design.md`). UI 문구 영어 기본, 상태 라벨은 en/ko 모두 등록.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. 커밋마다 PROGRESS.md 갱신은 트랙 단위 1회(마지막 태스크)로 갈음.
- DB는 운영 데이터가 있어 리셋 불가 — 데이터 이전은 반드시 멱등 startup 훅으로.

---

### Task 1: BE — `confirmed` 상수 + framework-confirm 전이 변경

**Files:**
- Modify: `backend/app/workflow.py:18-24` (상수 추가)
- Modify: `backend/app/routers/maps.py:1189-1295` (`confirm_framework_version`)
- Modify: `backend/tests/test_framework_canvas.py:328,357-358` (기존 기대값 갱신)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Produces: `workflow.CONFIRMED = "confirmed"` (이후 모든 태스크가 이 상수/문자열을 사용), 확정 스냅샷 `status="confirmed"` + `VersionEvent(event_type="confirmed")` + `version_number=None`.

- [ ] **Step 1: 기존 테스트를 새 기대값으로 갱신 (RED 확보)**

`backend/tests/test_framework_canvas.py`의 확정 플로 테스트에서 published 기대를 confirmed로 바꾼다:

```python
# :328 부근
assert (v1["version"]["label"], v1["version"]["status"]) == ("v1.0", "confirmed")
```

```python
# :357-358 부근
statuses = [v["status"] for v in detail["versions"]]
assert statuses.count("confirmed") == 3 and statuses.count("draft") == 1
```

같은 파일 끝에 신규 테스트 추가(이벤트 타입·채번 중단):

```python
def test_confirm_snapshot_is_confirmed_without_version_number(client, act_as):
    """확정 스냅샷은 confirmed 상태·confirmed 이벤트·게시 순번 없음 (spec 2026-09-02 §3)."""
    map_id = _make_canvas(client, act_as)  # 파일 내 기존 헬퍼(캔버스 생성) 재사용 — 없으면 기존 테스트의 생성 시퀀스를 함수로 추출
    body = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    ver = body["version"]
    assert ver["status"] == "confirmed"
    assert ver.get("version_number") in (None, 0)
    events = client.get(f"/api/maps/{map_id}").json()["versions"]
    snap = next(v for v in events if v["id"] == ver["id"])
    assert any(e["event_type"] == "confirmed" for e in snap.get("events", []))
```

주의: `_make_canvas` 헬퍼가 없으면 `test_framework_canvas.py:300~`의 기존 확정 테스트 도입부(카테고리 생성→linkage-map POST→체크아웃)를 모듈 레벨 헬퍼로 추출해 두 테스트가 공유하게 한다. `events`가 `VersionSummary`에 없으면 `GET /api/versions/{id}` 응답으로 단언을 옮긴다(기존 테스트들이 이벤트를 어떻게 읽는지 grep해 그 방식을 따른다: `git grep -n "event_type" backend/tests/`).

- [ ] **Step 2: RED 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_canvas.py -q`
Expected: FAIL — `"published" != "confirmed"` 계열.

- [ ] **Step 3: workflow.py에 상수 추가**

```python
# backend/app/workflow.py — PUBLISHED 아래
PUBLISHED = "published"
CONFIRMED = "confirmed"  # framework 캔버스 확정 스냅샷 — 게시(published)와 별도 트랙 (spec 2026-09-02 §3)
```

`EDITABLE_STATUSES`는 불변(confirmed는 읽기전용).

- [ ] **Step 4: framework-confirm 전이 변경**

`backend/app/routers/maps.py`의 `confirm_framework_version`에서:

```python
    snapshot = MapVersion(
        map_id=map_id, label=f"v{major}.{minor}", status="confirmed",
        fw_major=major, fw_minor=minor, submitted_by=user,
    )
    session.add(snapshot)
    await session.flush()
    await clone_graph(session, draft, snapshot.id)
    record_version_event(session, snapshot.id, "confirmed", user)
```

즉 ① `status="published"` → `"confirmed"` ② `version_number` 채번 블록(`max_num = await session.scalar(...)` ~ `snapshot.version_number = (max_num or 0) + 1` 3줄) **삭제** ③ `record_version_event(..., "published", ...)` → `"confirmed"`. docstring 첫 줄의 `(published)`도 `(confirmed)`로 갱신.

- [ ] **Step 5: GREEN 확인 + 파일 전체 그린**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_canvas.py -q`
Expected: PASS (전건).

- [ ] **Step 6: Commit**

```bash
git add backend/app/workflow.py backend/app/routers/maps.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): confirm snapshots as 'confirmed' status — 확정 스냅샷을 confirmed 상태로 분리"
```

---

### Task 2: BE — startup 데이터 이전 (멱등)

**Files:**
- Modify: `backend/app/db.py` (startup 훅 함수 추가 — `_sweep_orphan_kb_chunks` 선례와 나란히)
- Test: `backend/tests/test_db_migrations.py` (신규 또는 기존 db 테스트 파일에 추가 — `ls backend/tests/ | grep -i db`로 확인 후 있으면 거기에)

**Interfaces:**
- Consumes: Task 1의 `"confirmed"` 문자열.
- Produces: `_migrate_framework_confirmed(conn)` — init 경로에서 매 기동 멱등 실행.

- [ ] **Step 1: 실패 테스트 작성**

```python
from sqlalchemy import text

def test_migrate_framework_confirmed_idempotent(sync_conn_factory):
    """published인 fw 스냅샷 → confirmed, 이벤트도 함께. 재실행 무해 (spec §3 데이터 이전)."""
    # conftest에 동기 커넥션 픽스처가 없으면: 앱 모델로 fw 스냅샷을 published 상태로 직접 삽입하는
    # async 테스트로 작성한다(기존 테스트들의 세션 픽스처 사용 — git grep -n "AsyncSession" backend/tests/ 참고).
```

실전 형태(기존 테스트 스타일이 API 경유라면 이 방식 권장 — Task 1의 `_make_canvas` 재사용):

```python
def test_migrate_framework_confirmed_idempotent(client, act_as, db_session_sync):
    map_id = _make_canvas(client, act_as)
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]
    # 구버전 상태로 되돌려 놓고(운영 DB 시뮬레이션)
    db_session_sync.execute(text(
        "UPDATE map_versions SET status='published' WHERE id=:i"), {"i": ver["id"]})
    db_session_sync.execute(text(
        "UPDATE version_events SET event_type='published' WHERE version_id=:i AND event_type='confirmed'"),
        {"i": ver["id"]})
    db_session_sync.commit()
    from app.db import _migrate_framework_confirmed
    _migrate_framework_confirmed(db_session_sync.connection())
    _migrate_framework_confirmed(db_session_sync.connection())  # 멱등 재실행
    db_session_sync.commit()
    row = db_session_sync.execute(text("SELECT status FROM map_versions WHERE id=:i"), {"i": ver["id"]}).one()
    assert row[0] == "confirmed"
```

`db_session_sync` 픽스처가 없으면 conftest의 기존 DB 접근 방식을 grep해서(`git grep -n "text(" backend/tests/ | head`) 그 관례를 따른다 — 관례가 async면 async로 작성.

- [ ] **Step 2: RED 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -k migrate_framework_confirmed`
Expected: FAIL — `ImportError: _migrate_framework_confirmed`.

- [ ] **Step 3: db.py에 이전 함수 추가 + init 배선**

```python
def _migrate_framework_confirmed(conn: Connection) -> None:
    """fw 확정 스냅샷의 status published→confirmed 일회 이전 — 매 기동 멱등 (spec 2026-09-02 §3).

    fw_major가 있는 버전만 대상이라 일반 게시본은 건드리지 않는다. 이벤트도 함께 전환해
    타임라인 칩·PNG 확정일 소스가 일관된다.
    """
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    if "map_versions" not in tables:
        return
    conn.execute(text(
        "UPDATE map_versions SET status = 'confirmed' "
        "WHERE fw_major IS NOT NULL AND status = 'published'"
    ))
    if "version_events" in tables:
        conn.execute(text(
            "UPDATE version_events SET event_type = 'confirmed' "
            "WHERE event_type = 'published' AND version_id IN "
            "(SELECT id FROM map_versions WHERE fw_major IS NOT NULL)"
        ))
```

배선: db.py에서 `_sweep_orphan_kb_chunks`가 호출되는 init 지점을 찾아(`grep -n "_sweep_orphan_kb_chunks" backend/app/db.py`) 같은 자리에서 `_migrate_framework_confirmed(conn)`을 호출한다.

- [ ] **Step 4: GREEN 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -k migrate_framework_confirmed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db.py backend/tests/
git commit -m "feat(db): migrate framework snapshots to confirmed on startup — fw 스냅샷 상태 멱등 이전"
```

---

### Task 3: BE — confirmed 보호·집계 동반 수정

**Files:**
- Modify: `backend/app/routers/versions.py:408` (delete 차단 목록)
- Modify: `backend/app/routers/dashboard.py` (상태 열거 — `grep -n "_VERSION_STATUSES\|published" backend/app/routers/dashboard.py`로 :283, :341-343, :408 부근 확인)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: `workflow.CONFIRMED`.

- [ ] **Step 1: 실패 테스트 — confirmed 스냅샷 삭제 차단**

```python
def test_confirmed_snapshot_cannot_be_deleted(client, act_as):
    """확정 스냅샷은 pending/published와 같은 삭제 보호를 받는다 (spec §3.1)."""
    map_id = _make_canvas(client, act_as)
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]
    res = client.delete(f"/api/versions/{ver['id']}")
    assert res.status_code == 409
```

- [ ] **Step 2: RED 확인**

Run: `... pytest tests/test_framework_canvas.py -q -k cannot_be_deleted`
Expected: FAIL — 204(삭제 성공)가 나와버림.

- [ ] **Step 3: 구현**

`versions.py:408`:

```python
    if version.status in (workflow.PENDING, workflow.PUBLISHED, workflow.CONFIRMED):
```

`dashboard.py`: `_VERSION_STATUSES` 튜플(:283 부근)에 `"confirmed"` 추가. :341-343(부서 커버리지)·:408 부근에서 `"published"` 하드코딩을 읽고 — 커버리지 의미(부서에 게시 맵 존재)는 일반 맵 개념이므로 **변경하지 않는다**. `_VERSION_STATUSES`만 추가(누락 시 상태별 집계 dict 채우기에서 confirmed 맵이 빠지거나 KeyError).

- [ ] **Step 4: GREEN + dashboard 스위트 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_canvas.py tests/test_dashboard*.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/versions.py backend/app/routers/dashboard.py backend/tests/
git commit -m "feat(versions): protect confirmed snapshots from deletion — confirmed 삭제 차단·대시보드 열거"
```

---

### Task 4: BE — versions.py 옆문 가드 8종

**Files:**
- Modify: `backend/app/routers/versions.py` — create_version(:165), rename_version(:264), submit(:563), approve(:682), reject(:746), publish(:819), republish(:905), withdraw(:967)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Produces: `_assert_not_framework(session, map_id)` — versions.py 모듈 헬퍼. 422 detail 문자열은 정확히 `"framework maps use the confirm workflow"`.

- [ ] **Step 1: 실패 테스트 — 라이프사이클 옆문 전건 422**

```python
def test_framework_map_rejects_version_workflow(client, act_as):
    """framework 캔버스는 일반 버전 워크플로 옆문 전건 422 (spec §6).

    실파손 시나리오였던 것: 확정 후 create-version이 빈 draft를 만들고
    다음 확정이 그 빈 draft를 복제, 게시 옆문은 스냅샷 전량 expired 전환.
    """
    map_id = _make_canvas(client, act_as)
    client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False})
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")

    assert client.post(f"/api/maps/{map_id}/versions", json={"label": "x"}).status_code == 422
    for action in ("submit", "approve", "reject", "publish", "republish", "withdraw"):
        res = client.post(f"/api/versions/{draft['id']}/{action}", json={})
        assert res.status_code == 422, f"{action}: {res.status_code}"
    assert client.patch(f"/api/versions/{draft['id']}", json={"label": "hack"}).status_code == 422
```

- [ ] **Step 2: RED 확인**

Run: `... pytest tests/test_framework_canvas.py -q -k rejects_version_workflow`
Expected: FAIL — create가 409(확정 직후 최신=confirmed라 422 전에 409… 아님: Task 1 이후 최신 상태는 confirmed≠published이므로 create는 409가 난다. **가드가 409보다 먼저 걸리는지가 이 테스트의 검증점** — 최초 실행은 409/403/404 혼재로 FAIL).

- [ ] **Step 3: 헬퍼 + 가드 구현**

versions.py 상단(기존 import 아래):

```python
async def _assert_not_framework(session: AsyncSession, map_id: int) -> None:
    """framework 캔버스는 확정(framework-confirm) 전용 — 일반 버전 워크플로 옆문 차단 (spec 2026-09-02 §6)."""
    mode = await session.scalar(select(ProcessMap.mode).where(ProcessMap.id == map_id))
    if mode == "framework":
        raise HTTPException(status_code=422, detail="framework maps use the confirm workflow")
```

(`ProcessMap` import가 versions.py에 이미 있는지 확인 — 없으면 `from app.models import ProcessMap` 추가.)

배치 — **각 핸들러에서 404 체크 직후, 다른 상태 게이트보다 먼저**:
- `create_version`: `found_map` 로드 직후 `await _assert_not_framework(session, map_id)` (found_map.mode 직접 검사로 대체 가능 — 쿼리 절약: `if found_map.mode == "framework": raise ...` 동일 detail).
- `rename_version`·`submit`·`approve`·`reject`·`publish`·`republish`·`withdraw`: version 로드·404 체크 직후 `await _assert_not_framework(session, version.map_id)`.

- [ ] **Step 4: GREEN + versions 스위트 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_canvas.py tests/test_versions*.py -q`
Expected: PASS (기존 일반 맵 워크플로 테스트에 회귀 없어야 함).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/versions.py backend/tests/test_framework_canvas.py
git commit -m "feat(versions): block version workflow on framework maps — 캔버스 버전 워크플로 옆문 8종 봉쇄"
```

---

### Task 5: BE — 승인자·협업자·개명요청·SP요청 가드

**Files:**
- Modify: `backend/app/routers/approvers.py:34-53` (set_approvers)
- Modify: `backend/app/routers/permissions.py:134,187,259` (협업자 POST/PATCH/DELETE)
- Modify: `backend/app/routers/maps.py:759` (rename-requests POST), `:868` (sp-designation-requests POST)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: 422 detail `"framework maps use the confirm workflow"` (Task 4와 동일 문자열 — FE humanizeApiError가 한 문구로 처리).

- [ ] **Step 1: 실패 테스트**

```python
def test_framework_map_rejects_permission_side_doors(client, act_as):
    """승인자 지정(작성자 게이트 우회 경로)·협업자·개명요청·SP지정요청 전건 422 (spec §6)."""
    map_id = _make_canvas(client, act_as)
    assert client.put(f"/api/maps/{map_id}/approvers", json={"approvers": ["fwc.confirmer"]}).status_code == 422
    assert client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "fwc.pleb", "role": "editor"},
    ).status_code == 422
    assert client.post(
        f"/api/maps/{map_id}/rename-requests", json={"to_name": "hack"}
    ).status_code == 422
    assert client.post(
        f"/api/maps/{map_id}/sp-designation-requests", json={}
    ).status_code == 422
```

페이로드 필드명은 추측 금지 — 각 엔드포인트의 스키마를 확인해 맞춘다: `grep -n "class ApproversUpdate\|class PermissionCreate\|rename-requests 페이로드" backend/app/schemas.py` 및 각 핸들러 시그니처. 422가 페이로드 검증이 아닌 **framework 가드에서** 나오는지 detail 문자열로 단언을 보강한다:

```python
    res = client.put(f"/api/maps/{map_id}/approvers", json={"approvers": []})
    assert res.status_code == 422 and "confirm workflow" in res.json()["detail"]
```

- [ ] **Step 2: RED 확인**

Run: `... pytest tests/test_framework_canvas.py -q -k side_doors`
Expected: FAIL (현재 approvers는 200, 협업자는 200 후 무효, 요청 2종은 201/200).

- [ ] **Step 3: 구현**

각 핸들러의 맵 로드·404 체크 직후:

```python
    if found_map.mode == "framework":
        raise HTTPException(status_code=422, detail="framework maps use the confirm workflow")
```

permissions.py 3곳은 맵을 dependency로 로드할 수 있음 — 핸들러 본문에서 맵 객체를 어디서 얻는지 읽고(`sed -n '134,160p' backend/app/routers/permissions.py`) 그 직후에 삽입. 맵 객체가 없는 구조면 `_assert_not_framework` 패턴(모드만 scalar 조회)을 로컬 복제한다(파일 간 import 순환 방지 — versions.py 헬퍼를 permissions.py가 import하지 말 것).

- [ ] **Step 4: GREEN + 인접 스위트**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: 전체 PASS — 협업자/승인자 기존 테스트 회귀 없음.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/approvers.py backend/app/routers/permissions.py backend/app/routers/maps.py backend/tests/
git commit -m "feat(permissions): block approver/collab/request side doors on framework maps — 승인자·협업자·요청 옆문 봉쇄"
```

---

### Task 6: FE — VersionStatus 열거 스윕 (`confirmed`)

**Files:**
- Modify: `frontend/src/lib/api.ts:5-11`, `frontend/src/lib/version-status.ts:6-23`, `frontend/src/components/status-badge.tsx:8-24`, `frontend/src/components/maps/status-donut-card.tsx:13-21`, `frontend/src/components/maps/home-filter-pills.tsx:14`, `frontend/src/app/maps/[mapId]/compare/page.tsx:438-445`, `frontend/src/components/approval-panel.tsx:56-69`, `frontend/src/lib/mock/permissions-store.ts:16`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: `VersionStatus`에 `"confirmed"` — 이후 태스크 전부가 이 리터럴을 사용. i18n 키 `status.confirmed` / `home.verStatus.confirmed` / `home.verEvent.confirmed`.

- [ ] **Step 1: 유니온 확장 후 tsc로 누락 지점 열거 (컴파일러 주도)**

`api.ts`:

```ts
export type VersionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "published"
  | "confirmed"
  | "rejected"
  | "expired";
```

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — Record 4곳(`VERSION_STATUS_LABEL`/`STYLE`, status-badge `STYLES`/`LABEL_KEY`, donut `STATUS_COLOR`, compare `STATUS_DOT`)과 approval-panel switch에서 누락 에러. 이 목록이 곧 체크리스트다.

- [ ] **Step 2: Record·switch 채우기**

`version-status.ts`:

```ts
export const VERSION_STATUS_LABEL: Record<VersionStatus, MessageKey> = {
  // ...기존...
  confirmed: "home.verStatus.confirmed",
};
export const VERSION_STATUS_STYLE: Record<VersionStatus, string> = {
  // ...기존...
  confirmed: "border-accent text-accent",
};
```

`status-badge.tsx`: `STYLES.confirmed: "border-accent text-accent"`, `LABEL_KEY.confirmed: "status.confirmed"`.

`status-donut-card.tsx`:

```ts
const STATUS_COLOR: Record<VersionStatus, string> = {
  // ...기존...
  confirmed: "--color-accent-elevated", // 게시 green과 구분되는 딥 바이올렛 — 담당자 확정
};
const ORDER: VersionStatus[] = ["draft", "pending", "approved", "published", "confirmed", "rejected", "expired"];
```

`home-filter-pills.tsx`: `const STATUS_ORDER = ["draft", "pending", "approved", "rejected", "published", "confirmed"] as const;`

`compare/page.tsx` STATUS_DOT: `confirmed: "bg-accent"`.

`approval-panel.tsx` currentStage switch: `case "confirmed":` 를 `case "published":` 묶음에 추가(3 반환 — framework에선 이 패널이 렌더되지 않지만 exhaustive 충족).

`mock/permissions-store.ts:16`: 유니온에 `'confirmed'` 추가.

- [ ] **Step 3: i18n 키 추가 (en/ko 두 블록 모두)**

`i18n-messages.ts` — en 블록(:104-109·:171-176·:699-704 부근)과 ko 블록(:2119-·:2186-·:2714- 부근) 각각:

```ts
  "home.verStatus.confirmed": "Confirmed",        // ko: "담당자 확정"
  "home.verEvent.confirmed": "Confirmed",         // ko: "담당자 확정"
  "status.confirmed": "Confirmed",                // ko: "담당자 확정"
```

ko 블록의 실제 값은 `"담당자 확정"`. 기존 ko 값 스타일(초안/게시됨 혼용)과 무관하게 사용자 확정 명칭이다.

- [ ] **Step 4: 게이트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, 에러 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/version-status.ts frontend/src/components/status-badge.tsx frontend/src/components/maps/status-donut-card.tsx frontend/src/components/maps/home-filter-pills.tsx "frontend/src/app/maps/[mapId]/compare/page.tsx" frontend/src/components/approval-panel.tsx frontend/src/lib/mock/permissions-store.ts frontend/src/lib/i18n-messages.ts
git commit -m "feat(fe): add confirmed to VersionStatus enums — confirmed 상태 열거 전수 추가"
```

---

### Task 7: FE — framework 소비 지점 confirmed 전환

**Files:**
- Modify: `frontend/src/components/framework-confirm-section.tsx:46`
- Modify: `frontend/src/components/version-pill.tsx:33`
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx:2220-2222`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10026` (canCompare) + `:10715,10724` 부근 비교 CTA(같은 조건이면 동일 수정)
- Modify: `frontend/src/components/version/requester-comment-banner.tsx:21-26` (`findPublishedAt`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:5622-5639` PNG 정보 카드 라벨
- Test: 기존 vitest 스위트 + `npx tsc --noEmit`

**Interfaces:**
- Consumes: `"confirmed"` 리터럴(Task 6).
- Produces: `findPublishedAt`은 published·confirmed 이벤트를 모두 잡는다(시그니처 불변).

- [ ] **Step 1: 확정 이력 파싱 — 1순위**

`framework-confirm-section.tsx:46`:

```ts
    if (v.status !== "confirmed") continue;
```

- [ ] **Step 2: 버전 필 "진행 중" 분류**

`version-pill.tsx:33`:

```ts
    .filter((v) => v.id !== versionId && v.status !== "published" && v.status !== "expired" && v.status !== "confirmed")
```

- [ ] **Step 3: 비교화면 기준버전 — framework는 최신 confirmed**

`compare/page.tsx:2220-2222`:

```ts
        // base=게시본(일반) 또는 최신 확정 스냅샷(framework) 우선 — 없으면 최초 버전.
        const isFw = detail.mode === "framework";
        const baseCandidates = detail.versions.filter((version) =>
          isFw ? version.status === "confirmed" : version.status === "published",
        );
        const base = baseCandidates.length > 0 ? baseCandidates[baseCandidates.length - 1] : detail.versions[0];
        setBaseId(base.id);
        setTargetId(detail.versions[detail.versions.length - 1].id);
```

- [ ] **Step 4: 비교 진입 게이트**

`page.tsx:10026`:

```ts
                canCompare={versions.some(
                  (version) => version.status === "published" || version.status === "confirmed",
                )}
```

`:10715`·`:10724` 부근(맵 탭 비교 버튼)을 읽어 같은 `status === "published"` 존재 조건이면 동일하게 `|| status === "confirmed"`를 추가한다.

- [ ] **Step 5: PNG 정보 카드 — 확정일**

`requester-comment-banner.tsx` `findPublishedAt`:

```ts
    if (evt && (evt.event_type === "published" || evt.event_type === "confirmed")) return evt.created_at;
```

`page.tsx:5622-5639`의 정보 카드 행에서 `t("export.infoPublished")` 라벨을 쓰는 지점에 framework 분기:

```ts
label: isFrameworkMap ? t("export.infoConfirmed") : t("export.infoPublished"),
```

(실제 코드 형태는 해당 블록을 읽고 그 구조를 따른다 — 라벨 상수만 분기.) i18n에 `"export.infoConfirmed": "Confirmed"` (ko: `"확정일"`) 추가 — en/ko 두 블록.

- [ ] **Step 6: 게이트 확인**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(fe): route framework consumers to confirmed status — 확정 이력·비교·PNG 소비 지점 전환"
```

---

### Task 8: FE — confirmed 전용 시각 (워터마크·배너·타임라인)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:1325-1367` (읽기전용 배너), `:9471-9487` (워터마크)
- Modify: `frontend/src/components/maps/version-timeline.tsx:30-63` (아이콘·칩·노드), `:237-244`·`:399-407` (published 칩 로직)
- Modify: `frontend/src/lib/i18n-messages.ts`
- Test: `npx tsc --noEmit` + Task 10 실브라우저

**Interfaces:**
- Consumes: `"confirmed"` 상태·이벤트(Task 1·6).

- [ ] **Step 1: 읽기전용 배너 confirmed 분기**

`page.tsx:1341` published 분기 **앞에** 삽입:

```ts
        : currentVersion?.status === "confirmed"
          ? {
              tone: "accent",
              icon: BadgeCheck,
              title: t("editor.readonly.confirmedTitle"),
              desc: t("editor.readonly.confirmedDesc"),
            }
          : currentVersion?.status === "published"
```

i18n(en): `"editor.readonly.confirmedTitle": "Confirmed snapshot"`, `"editor.readonly.confirmedDesc": "This framework snapshot was confirmed by its admin - read-only. The live draft stays editable."` / (ko): `"확정 스냅샷"`, `"담당자가 확정한 스냅샷입니다 - 읽기 전용. 라이브 초안은 계속 편집할 수 있습니다."`

- [ ] **Step 2: 워터마크 — 도장(스탬프) 모티프**

`page.tsx:9471-9487` 워터마크 블록을 확장 — confirmed일 때만 보더 스탬프 룩(그 외 기존 텍스트 유지):

```tsx
                    {readOnly && (
                      <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center overflow-hidden">
                        {currentVersion?.status === "confirmed" ? (
                          /* 담당자 확정 스탬프 — 게시 워터마크와 구분되는 도장 모티프 (spec 2026-09-02 §3.2) */
                          <span className="flex -rotate-[18deg] select-none items-center gap-4 rounded-md border-[6px] border-accent px-10 py-4 text-[96px] font-semibold uppercase tracking-widest text-accent opacity-[0.14]">
                            <BadgeCheck size={96} strokeWidth={1.5} />
                            {t("editor.watermarkConfirmed")}
                          </span>
                        ) : (
                          <span
                            className={`-rotate-[18deg] select-none whitespace-nowrap text-[120px] font-semibold uppercase tracking-widest opacity-[0.14] ${
                              currentVersion?.status === "expired" ? "text-ink-tertiary" : "text-accent"
                            }`}
                          >
                            {currentVersion?.status === "published"
                              ? t("editor.watermarkPublished")
                              : currentVersion?.status === "expired"
                                ? t("editor.watermarkExpired")
                                : t("editor.watermark")}
                          </span>
                        )}
                      </div>
                    )}
```

i18n: `"editor.watermarkConfirmed": "CONFIRMED"` (en/ko 동일 — 워터마크는 영어 고정 관례).

- [ ] **Step 3: 타임라인 confirmed 칩·노드**

`version-timeline.tsx`:

```ts
// EventIcon에 추가
  if (type === "confirmed") return <BadgeCheck size={12} strokeWidth={1.7} />;
// EVENT_CHIP에 추가 — 게시 green과 구분되는 액센트 틴트
  confirmed: "border-accent-tint-border bg-accent-tint text-accent",
// nodeFor switch에 추가
    case "confirmed":
      return { cls: "border-accent bg-accent text-on-accent", Icon: BadgeCheck };
```

(`BadgeCheck`를 lucide import에 추가.) `:237-238` 접힘 칩 로직:

```ts
        const publishedEvt = events.find(
          (evt) => evt.event_type === "published" || evt.event_type === "confirmed",
        );
        const chipEvents = events.filter(
          (evt) => evt.event_type !== "published" && evt.event_type !== "confirmed",
        );
```

`:399-407` 칩 렌더에서 하드코딩된 `EVENT_CHIP.published`·`type="published"`·`t("home.verEvent.published")`를 `publishedEvt.event_type` 기반으로 치환:

```tsx
                        {publishedEvt && (
                          <span
                            data-id={`version-event-${publishedEvt.id}`}
                            title={`${t(publishedEvt.event_type === "confirmed" ? "home.verEvent.confirmed" : "home.verEvent.published")} - ${nameOf(publishedEvt.actor)}`}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-fine ${EVENT_CHIP[publishedEvt.event_type] ?? EVENT_CHIP.published}`}
                          >
                            <EventIcon type={publishedEvt.event_type} />
                            {t(publishedEvt.event_type === "confirmed" ? "home.verEvent.confirmed" : "home.verEvent.published")}
                          </span>
                        )}
```

- [ ] **Step 4: 게이트 확인**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/components/maps/version-timeline.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(fe): confirmed visual language — 확정 전용 스탬프 워터마크·배너·타임라인 칩"
```

---

### Task 9: FE — 옆문 UI 봉쇄 (설정 페이지·에디터 버튼·SP 카드)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/settings/page.tsx:41-49` (TABS 필터) + detail 로드부(:76-101)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10732` (새 버전 버튼), `:10819` (republish 버튼), `:10665`·`:10888`·`:11145` (SubprocessInspectorCard 3곳)
- Modify: `frontend/src/lib/i18n-messages.ts` (안내 문구)

**Interfaces:**
- Consumes: `detail.mode`(MapDetailOut — 이미 존재), 에디터의 `isFrameworkMap`(page.tsx:984).

- [ ] **Step 1: 설정 페이지 framework 분기**

detail 로드부에 mode 상태 추가:

```ts
  const [mapMode, setMapMode] = useState<string>("normal");
  // detail 수신 시(두 로드 경로 :76-82, :95-101 모두):
  setMapMode(detail.mode ?? "normal");
```

TABS 렌더 지점에서 필터(원본 상수는 불변 유지):

```ts
  // framework 캔버스 — 게시/승인자/협업자/SP 지정 탭 숨김. 확정은 에디터 승인 탭에서 (spec 2026-09-02 §6)
  const FRAMEWORK_HIDDEN_TABS = new Set(["subprocess", "collaborators", "approvers", "versions"]);
  const visibleTabs = mapMode === "framework"
    ? TABS.filter((tab) => !FRAMEWORK_HIDDEN_TABS.has(tab.id))
    : TABS;
```

기존에 `TABS`를 순회하는 지점을 전부 `visibleTabs`로 교체(`grep -n "TABS" frontend/src/app/maps/[mapId]/settings/page.tsx`). details 탭 상단에 framework 안내 한 줄(선택 — 탭이 사라진 이유):

```tsx
  {mapMode === "framework" && (
    <p data-id="map-settings-framework-note" className="rounded-sm border border-accent-tint-border bg-accent-tint/40 px-3 py-2 text-caption text-ink-secondary">
      {t("perm.frameworkNote")}
    </p>
  )}
```

i18n: `"perm.frameworkNote": "This is a framework linkage canvas - versions are managed with Confirm in the editor. Publishing, approvers and collaborators do not apply."` (ko: `"프레임워크 연계 캔버스입니다 - 버전은 에디터의 확정(Confirm)으로 관리합니다. 게시·승인자·협업자는 적용되지 않습니다."`)

- [ ] **Step 2: 에디터 버튼 가드**

`:10732`:

```ts
                        {isEditorRole && !hasDraft && !isFrameworkMap && (
```

`:10819`:

```ts
                        {isEditorRole && !isFrameworkMap && currentVersion?.status === "expired" && !hasDraft && (
```

- [ ] **Step 3: SubprocessInspectorCard 3곳 가드**

`:10665`·`:10888`·`:11145` 각 렌더를 `{!isFrameworkMap && ( ... )}`로 감싼다(들여쓰기·기존 조건과 병합 — 이미 조건부면 `&& !isFrameworkMap` 추가).

- [ ] **Step 4: 게이트 확인**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/settings/page.tsx" "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(fe): hide publish/approver/collab surfaces on framework maps — 캔버스 옆문 UI 봉쇄"
```

---

### Task 10: 스모크 갱신 + 전체 게이트 + PROGRESS

**Files:**
- Modify: `frontend/scripts/pw-smoke-framework-canvas.mjs:146-169`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: 전 태스크 결과. 실행 전제: backend(8000)+frontend(3000) 네이티브 기동, `docs/lessons/browser-verification.md` 준수(frontend/ cwd).

- [ ] **Step 1: 스모크 기대값 confirmed로 갱신**

`pw-smoke-framework-canvas.mjs`:
- `:166-167`: `statuses.includes("draft") && statuses.includes("confirmed")` — check 라벨도 `"live draft stays editable next to confirmed snapshot"`.
- `:169` 주석의 published → confirmed.
- 확정 응답 단언(:146-148)은 라벨 기준이라 불변.
- 추가 체크 1개 — 확정 스냅샷 열람 시 스탬프 워터마크:

```js
  // 스냅샷 버전으로 전환해 확정 워터마크 확인 — 버전 드롭다운 대신 URL 파라미터로 직행
  await page.goto(`${BASE}/maps/${mapId}?version=${confirm1.body.version.id}`, { waitUntil: "networkidle" });
  const stamp = await page.getByText("CONFIRMED", { exact: true }).first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("confirmed snapshot shows CONFIRMED stamp watermark", stamp);
```

- [ ] **Step 2: BE 전체 그린**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전건 PASS · ruff 0.

- [ ] **Step 3: FE 전체 그린**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 전건 PASS.

- [ ] **Step 4: 실브라우저 스모크**

Run: `cd frontend && BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/bpm-canvas-smoke node scripts/pw-smoke-framework-canvas.mjs`
Expected: ALL PASS (dev.db 오염 시 `python -m scripts.reset_db` 후 재실행 — `docs/deploy/db-seed.md`).
스크린샷을 세션에 공유한다(스탬프 워터마크·타임라인 칩 확인용) — 사용자 지시: 프론트 작업은 캡처 공유가 기본.

- [ ] **Step 5: PROGRESS 갱신 + 최종 커밋**

`PROGRESS.md` 상단에:

```markdown
## 2026-09-0X — Framework 트랙 A: confirmed 상태 분리·옆문 봉쇄 (dev)
- 확정 스냅샷 published→confirmed 분리(멱등 startup 이전 포함)·게시 순번 채번 중단·삭제 보호. versions.py 8종+승인자/협업자/개명·SP요청 옆문 422, 설정 페이지·에디터 버튼 UI 봉쇄. 확정 전용 시각(스탬프 워터마크·타임라인 칩·Confirmed 필). 스펙: docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md §3·§6.
```

```bash
git add frontend/scripts/pw-smoke-framework-canvas.mjs PROGRESS.md
git commit -m "test(framework): update smoke for confirmed track A — 스모크 confirmed 갱신·트랙 A 마감"
```

- [ ] **Step 6: 머지 결정**

superpowers:finishing-a-development-branch 스킬로 dev 머지 여부를 사용자와 확정한다(FE/BE 동시 배포 필요 — status 값을 양쪽이 함께 이해해야 하므로 부분 배포 금지).
