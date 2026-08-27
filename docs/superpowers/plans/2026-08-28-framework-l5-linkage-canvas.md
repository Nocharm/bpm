# Framework L5 연계 캔버스 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L5 카테고리를 열면 소속 L6 맵들이 subprocess 노드로 배치된 "연계 캔버스"(실맵 `mode="framework"`)가 나오고, 카테고리 권한자가 다른 L5의 L6도 끌어와 업무 연계를 엣지로 그린 뒤 스냅샷(v1.0, v1.1…)으로 확정한다.

**Architecture:** 캔버스는 진짜 `ProcessMap`(`mode="framework"`, `category_id=NULL`)이며 `ProcessCategory.linkage_map_id` 1:1로 결착 — 에디터·체크아웃·SP 라이브 주입·임베드가 전부 재사용된다. 권한은 신설 `category_permissions`(user/group, 하향 상속)에서 `get_effective_role`의 mode 분기로 파생하고, 수명주기는 영구 draft 라이브 편집 + 본인 확정 스냅샷(`fw_major/fw_minor`, status=published 재사용)이다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + React + @xyflow/react / pytest + vitest + playwright-core 스모크.

**Spec:** `docs/superpowers/specs/2026-08-28-framework-l5-linkage-canvas-design.md` (승인 완료본 — 이 플랜의 논거 원천, 실행자는 함께 읽는다)

## Global Constraints

- 운영 DB 리셋 불가 — 신규 컬럼은 전부 `backend/app/db.py` `_ADDED_COLUMNS` 등록, 신규 테이블은 `create_all`. (`docs/deploy/db-seed.md`)
- `validate_process` 시그니처 변경 금지 — 인터뷰 오케스트레이터(`interview/orchestrator.py:244`)가 의존.
- FE id 생성은 `genId()`(`@/lib/id`) — `crypto.randomUUID()` 금지(평문 HTTP 서버).
- React Compiler: `useCallback`/`useMemo` deps 불일치는 lint/build를 깨뜨림 — trivial 핸들러는 plain function으로.
- UI 문언 영어 기본(동적 데이터만 한글), 아이콘 Lucide 16px strokeWidth 1.5, raw hex 금지(토큰만). (`rules/frontend/design.md`)
- 인터랙티브 요소에 `data-id`(surface-role kebab-case) 부여. (`rules/frontend/identifiers.md`)
- 백엔드 전체 그린 확인 명령: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/에서).
- FE 게이트: `npx vitest run` + `npx tsc --noEmit` + `npm run lint` (frontend/에서).
- 커밋 메시지: `type(scope): English summary — 한국어 요약`, 커밋마다 PROGRESS.md 1줄 갱신은 **최종 Task 16에서 일괄**(중간 태스크는 코드만 — 브랜치 머지 시 압축 정책과 일관).
- `grep`은 ugrep이라 `[mapId]` 브래킷 디렉터리를 재귀에서 건너뜀 — page.tsx는 파일 경로를 명시해 grep.
- 이 플랜의 "권한자"(category admin) = `category_permissions`에 자기/조상 체인 매치가 있는 사용자.

## 파일 구조 (전체 조감)

| 파일 | 작업 |
|---|---|
| `backend/app/models.py` | `CategoryPermission` 신설, `ProcessCategory.linkage_map_id`, `MapVersion.fw_major/fw_minor` |
| `backend/app/db.py` | `_ADDED_COLUMNS` 3행 |
| `backend/app/schemas.py` | `CategoryPermissionEntry(+In)`, `LinkageMapOut`, `FrameworkConfirmIn`, `CategoryNodeOut`·`MapOut`·`SubprocessRefOut` 필드 확장 |
| `backend/app/permissions/access.py` | framework 분기 `_framework_role`·`is_category_admin`·`get_framework_category_id` |
| `backend/app/routers/categories.py` | permissions GET/PUT · linkage-map POST · nodes/chain 필드 채움 · rename 동기 · delete 409 |
| `backend/app/routers/maps.py` | framework-confirm POST · SP지정/copy 가드 · get_map linkage 필드 |
| `backend/app/routers/graph.py` | mode 분기 → `validate_framework_canvas` |
| `backend/app/subprocess.py` | `validate_framework_canvas` · `get_subprocess_refs`에 category_path |
| `backend/tests/test_framework_canvas.py` | 신규 — 백엔드 태스크 전체의 테스트 |
| `frontend/src/lib/api.ts` | 타입·클라이언트 함수 추가 |
| `frontend/src/lib/word-map-home.ts` | `splitMapsByMode` framework 제외 |
| `frontend/src/components/maps/framework-tree.tsx` | L5 행 Linkage 버튼 |
| `frontend/src/components/framework-chip.tsx` | L5 행 "Open linkage canvas" + 캔버스 칩 소스 |
| `frontend/src/components/framework-tree-picker.tsx` | 신규 — 캔버스용 트리 피커 패널 |
| `frontend/src/components/framework-confirm-section.tsx` | 신규 — Confirm changes 섹션 |
| `frontend/src/components/admin/framework-panel.tsx` | 권한자 관리 모달 |
| `frontend/src/components/process-node.tsx` | 외부 L6 출신 배지 |
| `frontend/src/app/maps/[mapId]/page.tsx` | isFrameworkMap 플러밍(버전선택·팔레트·패널 seam·리콘실·칩·컨펌) |
| `frontend/src/app/page.tsx` | 홈 트리 버튼 핸들러 |
| `frontend/src/lib/i18n-messages.ts` | en/ko 키(각 UI 태스크에 포함) |
| `frontend/scripts/pw-smoke-framework-canvas.mjs` | 신규 — 실브라우저 스모크 |

---

### Task 1: 백엔드 모델 + DB 등록

**Files:**
- Modify: `backend/app/models.py` (ProcessCategory 뒤·MapVersion·MapNote 뒤)
- Modify: `backend/app/db.py:19` `_ADDED_COLUMNS`
- Test: `backend/tests/test_framework_canvas.py` (신규)

**Interfaces:**
- Produces: `models.CategoryPermission(category_id, principal_type, principal_id, granted_by, granted_at)` · `ProcessCategory.linkage_map_id: int|None` · `MapVersion.fw_major/fw_minor: int|None` — 이후 모든 태스크가 소비.

- [x] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_framework_canvas.py` 신규:

```python
"""Framework L5 연계 캔버스 — 모델·권한·linkage-map·검증·확정·가드 (design 2026-08-28)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

SYSADMIN = "fwc.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이라 권한 분기가 안 걸린다."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def test_models_roundtrip(client: TestClient) -> None:
    """신설 테이블/컬럼이 create_all·자동 ALTER로 존재하고 ORM 왕복이 된다."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import CategoryPermission, MapVersion, ProcessCategory

    async def _run() -> None:
        async with SessionLocal() as session:
            cat = ProcessCategory(code="FWC-M1", name="모델검증", level=1, sort_order=0)
            session.add(cat)
            await session.flush()
            session.add(
                CategoryPermission(
                    category_id=cat.id, principal_type="user",
                    principal_id="fwc.admin1", granted_by=SYSADMIN,
                )
            )
            cat.linkage_map_id = None  # 컬럼 존재 확인
            await session.commit()
            row = await session.scalar(
                select(CategoryPermission).where(CategoryPermission.category_id == cat.id)
            )
            assert row is not None and row.principal_id == "fwc.admin1"
            # MapVersion fw 컬럼 존재 — 인스턴스 생성으로 확인
            assert MapVersion(map_id=1, label="x", fw_major=1, fw_minor=0).fw_major == 1

    asyncio.run(_run())
```

- [x] **Step 2: 실패 확인**

Run(backend/에서): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_canvas.py -q`
Expected: FAIL — `ImportError: cannot import name 'CategoryPermission'`

- [x] **Step 3: 모델 구현** — `backend/app/models.py`:

① `ProcessCategory`의 `sort_order` 컬럼 아래에 추가(줄 109 뒤):

```python
    # L5 연계 캔버스 1:1 결착 — mode="framework" 맵. category_id 미사용(L6 목록 오염 차단)
    # (design 2026-08-28). 레거시 DB는 ALTER가 FK 없이 추가 — 앱 계층이 정합 보장.
    linkage_map_id: Mapped[int | None] = mapped_column(
        ForeignKey("process_maps.id", ondelete="SET NULL"), default=None
    )
```

② `MapVersion`의 `version_number` 컬럼 아래에 추가(줄 253 근처):

```python
    # framework 캔버스 확정 스냅샷 번호 — 일반 맵/라이브 draft는 NULL (design 2026-08-28)
    fw_major: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    fw_minor: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
```

③ `MapPermission` 클래스 뒤에 신설:

```python
class CategoryPermission(Base):
    """카테고리 권한자 행 — 행 존재=권한자(role 없음), 하향 상속은 판정 시 조상 체인 매치.

    principal_type은 user|group만 — 카테고리는 조직도와 별개 축이라 department 미지원
    (design 2026-08-28 §3). 부여는 sysadmin 전용.
    """

    __tablename__ = "category_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("process_categories.id", ondelete="CASCADE"), index=True
    )
    # 'user' | 'group'
    principal_type: Mapped[str] = mapped_column(String(20))
    # user→login_id; group→그룹 id 문자열(MapPermission 규약과 동일)
    principal_id: Mapped[str] = mapped_column(String(200))
    granted_by: Mapped[str] = mapped_column(String(100))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

④ `backend/app/db.py` `_ADDED_COLUMNS` 리스트 말미에:

```python
    # Framework L5 연계 캔버스 (design 2026-08-28) — 카테고리↔캔버스 1:1 · 확정 스냅샷 번호
    ("process_categories", "linkage_map_id", "INTEGER"),
    ("map_versions", "fw_major", "INTEGER"),
    ("map_versions", "fw_minor", "INTEGER"),
```

- [x] **Step 4: 통과 확인**

Run: 위 pytest 명령. Expected: PASS (1 passed)

- [x] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): add category permission and linkage canvas columns — 카테고리 권한자·연계 캔버스 컬럼"
```

---

### Task 2: 카테고리 권한자 API (GET/PUT, sysadmin)

**Files:**
- Modify: `backend/app/schemas.py` (`CategoryCreateIn` 앞)
- Modify: `backend/app/routers/categories.py` (delete_category 뒤)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 1 `CategoryPermission`.
- Produces: `GET/PUT /api/categories/{category_id}/permissions` — body/응답 `{"permissions": [{"principal_type": "user"|"group", "principal_id": str}]}`. FE Task 9가 소비.

- [x] **Step 1: 실패하는 테스트 작성** — test_framework_canvas.py에 추가:

```python
def _seed_category(client: TestClient, code: str, name: str, level: int = 1,
                   parent_id: int | None = None) -> int:
    """멱등 카테고리 시드 — 세션 스코프 공유 DB라 code 재사용."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
            if row is None:
                row = ProcessCategory(code=code, name=name, level=level,
                                      parent_id=parent_id, sort_order=0)
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_category_permissions_put_replaces_and_gates(client: TestClient, enforce: None) -> None:
    cid = _seed_category(client, "FWC-P1", "권한검증")
    body = {"permissions": [{"principal_type": "user", "principal_id": "fwc.admin1"}]}
    act_as("fwc.pleb")
    assert client.put(f"/api/categories/{cid}/permissions", json=body).status_code == 403
    act_as(SYSADMIN)
    res = client.put(f"/api/categories/{cid}/permissions", json=body)
    assert res.status_code == 200
    assert res.json()["permissions"] == body["permissions"]
    # replace 멱등 — 다른 목록으로 갈아끼우면 이전 행은 사라진다
    body2 = {"permissions": [{"principal_type": "group", "principal_id": "7"}]}
    assert client.put(f"/api/categories/{cid}/permissions", json=body2).status_code == 200
    got = client.get(f"/api/categories/{cid}/permissions").json()["permissions"]
    assert got == body2["permissions"]
    assert client.get("/api/categories/999999/permissions").status_code == 404
```

- [x] **Step 2: 실패 확인** — 같은 pytest 명령. Expected: FAIL (405/404 — 라우트 없음)

- [x] **Step 3: 구현**

① `backend/app/schemas.py` — `CategoryCreateIn` 클래스 바로 앞에:

```python
class CategoryPermissionEntry(BaseModel):
    """카테고리 권한자 1행 — 행 존재=권한자(role 없음) (design 2026-08-28 §3)."""

    principal_type: Literal["user", "group"]
    principal_id: str = Field(min_length=1, max_length=200)


class CategoryPermissionsIn(BaseModel):
    permissions: list[CategoryPermissionEntry]


class CategoryPermissionsOut(BaseModel):
    permissions: list[CategoryPermissionEntry]
```

(`Literal`이 schemas.py 상단 typing import에 없으면 추가: `from typing import Literal`. 기존 import 블록 확인 후 병합.)

② `backend/app/routers/categories.py` — import에 `CategoryPermission` (models), `CategoryPermissionEntry, CategoryPermissionsIn, CategoryPermissionsOut` (schemas) 추가. `delete_category` 뒤에:

```python
@router.get("/{category_id}/permissions", response_model=CategoryPermissionsOut)
async def list_category_permissions(
    category_id: int,
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> CategoryPermissionsOut:
    """카테고리 권한자 목록 — sysadmin 전용 (설정 Framework 탭 관리 화면)."""
    if await session.get(ProcessCategory, category_id) is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    rows = (
        await session.execute(
            select(CategoryPermission.principal_type, CategoryPermission.principal_id)
            .where(CategoryPermission.category_id == category_id)
            .order_by(CategoryPermission.id)
        )
    ).all()
    return CategoryPermissionsOut(
        permissions=[CategoryPermissionEntry(principal_type=t, principal_id=p) for t, p in rows]
    )


@router.put("/{category_id}/permissions", response_model=CategoryPermissionsOut)
async def set_category_permissions(
    category_id: int,
    payload: CategoryPermissionsIn,
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> CategoryPermissionsOut:
    """권한자 전체 교체 — 멱등 PUT(setApprovers 선례). 중복 항목은 1개로 접는다."""
    if await session.get(ProcessCategory, category_id) is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    await session.execute(
        delete(CategoryPermission).where(CategoryPermission.category_id == category_id)
    )
    seen: set[tuple[str, str]] = set()
    for entry in payload.permissions:
        key = (entry.principal_type, entry.principal_id)
        if key in seen:
            continue
        seen.add(key)
        session.add(
            CategoryPermission(
                category_id=category_id, principal_type=entry.principal_type,
                principal_id=entry.principal_id, granted_by=login_id,
            )
        )
    await session.commit()
    return await list_category_permissions(category_id, login_id, session)  # type: ignore[arg-type]
```

주의: 마지막 줄 재호출이 Depends 시그니처 때문에 어색하면 조회 로직을 `_load_category_permissions(session, category_id)` 내부 함수로 추출해 양쪽에서 호출한다(동작 동일).

- [x] **Step 4: 통과 확인** — pytest 같은 명령. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/categories.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): category admin list/replace API — 카테고리 권한자 조회·교체 API"
```

---

### Task 3: framework 역할 파생 (`get_effective_role` 분기)

**Files:**
- Modify: `backend/app/permissions/access.py`
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 1 모델.
- Produces: `access.is_category_admin(session, login_id, category_id) -> bool` · `access.get_framework_category_id(session, map_id) -> int | None` · `get_effective_role`이 framework 맵에서 sysadmin→owner / 권한자→editor / 그 외→viewer 반환. Task 4·6·8이 소비.

- [x] **Step 1: 실패하는 테스트 작성** — 추가:

```python
def _seed_canvas_map(client: TestClient, category_id: int, name: str) -> int:
    """mode=framework 캔버스 맵 + draft 버전 1개 + linkage 결착 — 권한/검증 테스트용 최소 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessCategory, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.name == name))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, owner_id=SYSADMIN,
                                 visibility="public", mode="framework")
                row.versions.append(MapVersion(label="Linkage"))
                session.add(row)
                await session.flush()
                cat = await session.get(ProcessCategory, category_id)
                cat.linkage_map_id = row.id
                await session.commit()
            return row.id

    return asyncio.run(_run())


def test_framework_role_derivation(client: TestClient, enforce: None) -> None:
    """권한자(자기/조상 체인)=editor, 비권한자=viewer, sysadmin=owner — map_permissions 무시."""
    import asyncio

    from app.db import SessionLocal
    from app.permissions.access import get_effective_role

    l1 = _seed_category(client, "FWC-R1", "역할L1")
    l5 = _seed_category(client, "FWC-R5", "역할L5", level=5, parent_id=l1)
    canvas_id = _seed_canvas_map(client, l5, "역할검증 연계")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.ancestor"}]})
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.direct"}]})

    async def _roles() -> tuple[str | None, str | None, str | None, str | None]:
        async with SessionLocal() as session:
            return (
                await get_effective_role(session, "fwc.direct", canvas_id),
                await get_effective_role(session, "fwc.ancestor", canvas_id),  # L1 권한자 → 상속
                await get_effective_role(session, "fwc.pleb", canvas_id),
                await get_effective_role(session, SYSADMIN, canvas_id),
            )

    direct, ancestor, pleb, sysadmin = asyncio.run(_roles())
    assert direct == "editor"
    assert ancestor == "editor"
    assert pleb == "viewer"
    assert sysadmin == "owner"
```

- [x] **Step 2: 실패 확인** — Expected: FAIL (`direct == "viewer"` — 분기 없음. public 맵이라 viewer 폴백)

- [x] **Step 3: 구현** — `backend/app/permissions/access.py`:

① import에 `CategoryPermission, ProcessCategory` 추가(models), `select`는 기존.

② 파일 하단(또는 `get_effective_role` 앞)에 헬퍼 2개:

```python
async def get_framework_category_id(session: AsyncSession, map_id: int) -> int | None:
    """캔버스 맵 → 결착 카테고리 역조회 (linkage_map_id 1:1)."""
    return await session.scalar(
        select(ProcessCategory.id).where(ProcessCategory.linkage_map_id == map_id)
    )


async def is_category_admin(
    session: AsyncSession, login_id: str, category_id: int
) -> bool:
    """카테고리 권한자 판정 — 자기+조상 체인에 user 직접 또는 (active 그룹) group 매치 (design 2026-08-28 §4).

    sysadmin은 여기서 판정하지 않는다 — 호출부가 logic.is_sysadmin을 먼저 본다.
    """
    rows = (
        await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id))
    ).all()
    parent_by_id = {cid: pid for cid, pid in rows}
    chain: list[int] = []
    cursor: int | None = category_id
    while cursor is not None and cursor in parent_by_id and cursor not in chain:
        chain.append(cursor)  # not-in-chain 가드 — (동시성) 부모 사이클에도 종료 보장
        cursor = parent_by_id[cursor]
    if not chain:
        return False
    perm_rows = (
        await session.execute(
            select(CategoryPermission.principal_type, CategoryPermission.principal_id)
            .where(CategoryPermission.category_id.in_(chain))
        )
    ).all()
    if not perm_rows:
        return False
    if any(ptype == "user" and pid == login_id for ptype, pid in perm_rows):
        return True
    group_pids = {pid for ptype, pid in perm_rows if ptype == "group"}
    if not group_pids:
        return False
    emp = await session.get(Employee, login_id)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )
    user_group_ids = await get_user_active_group_ids(session, login_id, emp_org_path)
    return bool(group_pids & user_group_ids)
```

③ `get_effective_role`의 `found_map is None` 체크 직후(줄 64 뒤)에 분기 삽입:

```python
    # framework 캔버스 — map_permissions 무시, 카테고리 권한자 체인에서 파생 (design 2026-08-28 §4)
    if found_map.mode == "framework":
        if logic.is_sysadmin(login_id):
            return "owner"
        category_id = await get_framework_category_id(session, map_id)
        if category_id is not None and await is_category_admin(session, login_id, category_id):
            return "editor"
        return "viewer" if found_map.visibility == "public" else None
```

- [x] **Step 4: 통과 확인** — pytest. Expected: PASS. 기존 스위트 회귀 확인: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` 전체 그린.
- [x] **Step 5: Commit**

```bash
git add backend/app/permissions/access.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): derive canvas roles from category admin chain — 캔버스 역할을 권한자 체인에서 파생"
```

---

### Task 4: 멱등 열기 엔드포인트 `POST /api/categories/{id}/linkage-map`

**Files:**
- Modify: `backend/app/schemas.py` (`CategoryPermissionsOut` 뒤)
- Modify: `backend/app/routers/categories.py`
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 3 `is_category_admin`.
- Produces: `POST /api/categories/{category_id}/linkage-map` → `{"map_id": int, "added_count": int, "missing_count": int}`. FE Task 9·10·11이 소비. 시드/보강 그리드 상수 `_LINKAGE_X0=120, _LINKAGE_Y0=120, _LINKAGE_X_STEP=240, _LINKAGE_Y_STEP=120, _LINKAGE_COLS=4`.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
def _seed_l6_map(client: TestClient, category_id: int, name: str, code: str) -> int:
    """카테고리에 연결된 게시본 있는 L6 맵 멱등 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, visibility="public",
                                 category_id=category_id, consultant_code=code)
                row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_linkage_map_open_create_seed_and_reconcile(client: TestClient, enforce: None) -> None:
    l1 = _seed_category(client, "FWC-O1", "열기L1")
    l5 = _seed_category(client, "FWC-O5", "열기L5", level=5, parent_id=l1)
    m1 = _seed_l6_map(client, l5, "열기업무1", "FWC-OM1")
    m2 = _seed_l6_map(client, l5, "열기업무2", "FWC-OM2")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.opener"}]})

    # level!=5 → 422
    assert client.post(f"/api/categories/{l1}/linkage-map").status_code == 422
    # 캔버스 없음 + 비권한자 → 404
    act_as("fwc.pleb")
    assert client.post(f"/api/categories/{l5}/linkage-map").status_code == 404
    # 권한자 생성 — 소속 L6 2개가 subprocess 노드로 시드
    act_as("fwc.opener")
    created = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert created["added_count"] == 2 and created["missing_count"] == 0
    map_id = created["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["mode"] == "framework"
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    linked = {n["linked_map_id"] for n in graph["nodes"]}
    assert linked == {m1, m2}
    assert all(n["node_type"] == "subprocess" for n in graph["nodes"])
    # 멱등 재호출 — 추가 없음
    again = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert again["map_id"] == map_id and again["added_count"] == 0
    # 새 L6 유입 후 재열기 → 자동 보강 append
    m3 = _seed_l6_map(client, l5, "열기업무3", "FWC-OM3")
    assert client.post(f"/api/categories/{l5}/linkage-map").json()["added_count"] == 1
    # 뷰어 열람 — 보강 없이 missing_count만
    _seed_l6_map(client, l5, "열기업무4", "FWC-OM4")
    act_as("fwc.pleb")
    viewed = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert viewed["added_count"] == 0 and viewed["missing_count"] == 1
    assert {m3} <= linked | {m3}  # m3는 이미 반영됨(위 보강)
```

- [x] **Step 2: 실패 확인** — Expected: FAIL (404 라우트 없음 — 첫 단언 422에서)

- [x] **Step 3: 구현**

① `backend/app/schemas.py`:

```python
class LinkageMapOut(BaseModel):
    """연계 캔버스 멱등 열기 응답 (design 2026-08-28 §5)."""

    map_id: int
    added_count: int  # 이번 호출이 시드/보강으로 추가한 소속 L6 노드 수
    missing_count: int  # 보강 못한(뷰어·타인 점유) 미반영 소속 L6 수
```

② `backend/app/routers/categories.py` — import 추가: `from uuid import uuid4`(기존), models에서 `CategoryPermission`(Task 2), `Node`·`MapVersion`·`ProcessMap`(기존), `from app.permissions.access import get_user_active_group_ids, is_category_admin`(기존 import 라인 확장), `from app.version_events import record_version_event`, schemas `LinkageMapOut`, `from app.permissions import logic`(기존). 파일 상단 상수(`MAX_CATEGORY_LEVEL` 아래):

```python
# 연계 캔버스 시드/보강 그리드 — import_consultant.place()와 동일 리듬 (design 2026-08-28 §6)
_LINKAGE_X0, _LINKAGE_Y0 = 120, 120
_LINKAGE_X_STEP, _LINKAGE_Y_STEP = 240, 120
_LINKAGE_COLS = 4
```

엔드포인트(permissions 엔드포인트 뒤):

```python
async def _unique_linkage_name(session: AsyncSession, category: ProcessCategory) -> str:
    """캔버스 맵 이름 자동 — "{카테고리명} 연계", 전역 충돌 시 코드/카운터 서픽스."""
    base = f"{category.name} 연계"
    candidates = [base, f"{base} ({category.code})"]
    n = 2
    while True:
        for candidate in candidates:
            if await session.scalar(
                select(ProcessMap.id).where(ProcessMap.name == candidate)
            ) is None:
                return candidate
        candidates = [f"{base} ({category.code}) ({n})"]
        n += 1


def _grid_positions(start_index: int, count: int, base_y: float) -> list[tuple[float, float]]:
    """row-major 그리드 좌표 — start_index부터 count개."""
    out: list[tuple[float, float]] = []
    for i in range(start_index, start_index + count):
        col, row = i % _LINKAGE_COLS, i // _LINKAGE_COLS
        out.append((_LINKAGE_X0 + col * _LINKAGE_X_STEP, base_y + row * _LINKAGE_Y_STEP))
    return out


@router.post("/{category_id}/linkage-map", response_model=LinkageMapOut)
async def open_linkage_map(
    category_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LinkageMapOut:
    """연계 캔버스 멱등 열기 — 없으면 생성+소속 L6 시드, 있으면 부족분 자동 보강 (design 2026-08-28 §5).

    보강은 권한자이면서 체크아웃이 비었거나 본인일 때만 — 타인 편집 중 서버가 draft를
    건드리지 않는다(체크아웃 규약과 일관). 뷰어는 missing_count만 받는다.
    """
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    if category.level != 5:
        raise HTTPException(status_code=422, detail="linkage canvas exists only at level 5")

    is_admin = logic.is_sysadmin(user) or await is_category_admin(session, user, category_id)
    contained_rows = (
        await session.execute(
            select(ProcessMap.id, ProcessMap.name)
            .where(ProcessMap.category_id == category_id, ProcessMap.deleted_at.is_(None))
            .order_by(ProcessMap.name)
        )
    ).all()

    canvas = (
        await session.get(ProcessMap, category.linkage_map_id)
        if category.linkage_map_id is not None
        else None
    )
    if canvas is None or canvas.deleted_at is not None:
        # 생성 — 권한자만. 소프트삭제/영구삭제된 캔버스는 새로 만든다(포인터 덮어씀).
        if not is_admin:
            raise HTTPException(status_code=404, detail="no linkage canvas for this category")
        canvas = ProcessMap(
            name=await _unique_linkage_name(session, category),
            created_by=user, owner_id=user, visibility="public", mode="framework",
        )
        canvas.versions.append(MapVersion(label="Linkage"))
        session.add(canvas)
        await session.flush()
        version_id = canvas.versions[0].id
        for i, ((map_id, map_name), (px, py)) in enumerate(
            zip(contained_rows, _grid_positions(0, len(contained_rows), _LINKAGE_Y0))
        ):
            session.add(
                Node(id=uuid4().hex, version_id=version_id, title=map_name,
                     node_type="subprocess", linked_map_id=map_id, follow_latest=True,
                     pos_x=px, pos_y=py, sort_order=i)
            )
        record_version_event(session, version_id, "created", user)
        category.linkage_map_id = canvas.id
        await session.commit()
        return LinkageMapOut(map_id=canvas.id, added_count=len(contained_rows), missing_count=0)

    # 기존 캔버스 — draft(라이브)에서 부족분 보강
    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == canvas.id, MapVersion.status == "draft")
        .order_by(MapVersion.id.desc())
    )
    if draft is None:  # 방어 — 라이브 draft는 생성 시 항상 만들어진다
        raise HTTPException(status_code=409, detail="linkage canvas has no draft version")
    linked_ids = set(
        (
            await session.scalars(
                select(Node.linked_map_id).where(
                    Node.version_id == draft.id, Node.node_type == "subprocess",
                    Node.linked_map_id.is_not(None),
                )
            )
        ).all()
    )
    missing = [(mid, name) for mid, name in contained_rows if mid not in linked_ids]
    can_append = is_admin and (draft.checked_out_by is None or draft.checked_out_by == user)
    if not missing or not can_append:
        return LinkageMapOut(map_id=canvas.id, added_count=0, missing_count=len(missing))

    stats = (
        await session.execute(
            select(func.max(Node.pos_y), func.max(Node.sort_order), func.count())
            .where(Node.version_id == draft.id)
        )
    ).one()
    max_y, max_sort, node_count = stats
    base_y = (max_y + _LINKAGE_Y_STEP) if node_count else _LINKAGE_Y0
    next_sort = (max_sort + 1) if node_count else 0
    for i, ((map_id, map_name), (px, py)) in enumerate(
        zip(missing, _grid_positions(0, len(missing), base_y))
    ):
        session.add(
            Node(id=uuid4().hex, version_id=draft.id, title=map_name,
                 node_type="subprocess", linked_map_id=map_id, follow_latest=True,
                 pos_x=px, pos_y=py, sort_order=next_sort + i)
        )
    await session.commit()
    return LinkageMapOut(map_id=canvas.id, added_count=len(missing), missing_count=0)
```

주의: FastAPI 등록 순서 — literal 경로 `/import-interview`처럼 `/{category_id}/linkage-map`은 파라미터 경로라 순서 무관. `func`는 categories.py에 이미 import됨.

- [x] **Step 4: 통과 확인** — pytest 파일 단위 → 전체. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/categories.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): idempotent linkage-map open with seed and reconcile — 연계 캔버스 멱등 열기·시드·자동 보강"
```

---

### Task 5: 그래프 저장 검증 분기 (`validate_framework_canvas`)

**Files:**
- Modify: `backend/app/subprocess.py` (validate_process 뒤)
- Modify: `backend/app/routers/graph.py:176-179`
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 4의 캔버스(draft 버전).
- Produces: framework 맵 저장은 subprocess-only 강제(start 불요), 일반 맵은 기존 그대로.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
def _checkout(client: TestClient, version_id: int) -> None:
    assert client.post(f"/api/versions/{version_id}/checkout").status_code in (200, 201)


def test_framework_graph_validation(client: TestClient, enforce: None) -> None:
    """캔버스 저장: subprocess-only 허용(start 없음 OK), 타 타입 유입은 422. 일반 맵은 start 강제 유지."""
    l5 = _seed_category(client, "FWC-V5", "검증L5", level=5)
    m1 = _seed_l6_map(client, l5, "검증업무1", "FWC-VM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.editor"}]})
    act_as("fwc.editor")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    node = graph["nodes"][0]
    # start 없이 subprocess 노드만 + 엣지 없이 저장 — 통과해야 한다
    payload = {"nodes": [node], "edges": [], "groups": []}
    assert client.put(f"/api/versions/{draft['id']}/graph", json=payload).status_code == 200
    # process 노드 유입 → 422
    bad = dict(node, id="fwcbadnode000000000000000000000001", node_type="process", linked_map_id=None)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, bad], "edges": [], "groups": []})
    assert res.status_code == 422
    assert "framework" in res.json()["detail"]
```

- [x] **Step 2: 실패 확인** — Expected: FAIL — 첫 PUT이 422("시작 노드는 정확히 1개여야 합니다")

- [x] **Step 3: 구현**

① `backend/app/subprocess.py` — `validate_process` 아래에:

```python
def validate_framework_canvas(nodes: list[NodeIn]) -> None:
    """framework 연계 캔버스 규칙 — 링크된 subprocess 노드만 허용, start/end 불요 (design 2026-08-28 §7)."""
    for n in nodes:
        if n.node_type != "subprocess" or not n.linked_map_id:
            raise ValueError(
                "framework canvas allows linked subprocess nodes only"
            )
```

② `backend/app/routers/graph.py` — import를 `from app.subprocess import assert_no_cycle, get_subprocess_refs, validate_framework_canvas, validate_process`로 확장, `from app.models import Comment, Edge, Group, MapVersion, Node, ProcessMap`으로 확장. `replace_graph`의 validate 블록(줄 176-179)을:

```python
    canvas_map = await session.get(ProcessMap, version.map_id)
    try:
        if canvas_map is not None and canvas_map.mode == "framework":
            validate_framework_canvas(payload.nodes)
        else:
            validate_process(payload.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [x] **Step 4: 통과 확인** — 파일 pytest → **전체 스위트**(기존 그래프 저장 테스트 회귀 필수). Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/subprocess.py backend/app/routers/graph.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): subprocess-only graph validation for canvas mode — 캔버스 저장 검증 분기(start 불요)"
```

---

### Task 6: 확정 스냅샷 `POST /api/maps/{map_id}/framework-confirm`

**Files:**
- Modify: `backend/app/schemas.py` (`LinkageMapOut` 뒤)
- Modify: `backend/app/routers/maps.py` (designate_subprocess 근처)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 3 `is_category_admin`·`get_framework_category_id`, `clone_graph`(maps.py 기존 import).
- Produces: `POST /api/maps/{map_id}/framework-confirm` body `{"major": bool}` → VersionOut(스냅샷). 채번: 최초 1.0 → minor+1, major 체크 시 major+1·minor 0. 이전 스냅샷 expired 전환 **안 함**.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
def test_framework_confirm_versioning(client: TestClient, enforce: None) -> None:
    l5 = _seed_category(client, "FWC-C5", "확정L5", level=5)
    _seed_l6_map(client, l5, "확정업무1", "FWC-CM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.confirmer"}]})
    act_as("fwc.confirmer")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]

    act_as("fwc.pleb")
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).status_code == 403
    act_as("fwc.confirmer")
    v1 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert (v1["label"], v1["status"]) == ("v1.0", "published")
    v2 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert v2["label"] == "v1.1"
    v3 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": True}).json()
    assert v3["label"] == "v2.0"
    detail = client.get(f"/api/maps/{map_id}").json()
    statuses = [v["status"] for v in detail["versions"]]
    assert statuses.count("published") == 3  # 이전 스냅샷 expired 전환 없음
    assert statuses.count("draft") == 1      # 라이브는 계속 draft
    # 일반 맵에는 422
    act_as(SYSADMIN)
    normal = client.post("/api/maps", json={"name": "확정검증 일반맵",
                                            "owning_department": "Owning Anchor Division"}).json()
    assert client.post(f"/api/maps/{normal['id']}/framework-confirm",
                       json={"major": False}).status_code == 422
```

- [x] **Step 2: 실패 확인** — Expected: FAIL (404 라우트 없음)

- [x] **Step 3: 구현**

① `backend/app/schemas.py`:

```python
class FrameworkConfirmIn(BaseModel):
    """연계 캔버스 확정 — major 체크 시 다음 메이저.0 (design 2026-08-28 §6)."""

    major: bool = False
```

② `backend/app/routers/maps.py` — import: schemas에 `FrameworkConfirmIn`·`VersionOut` 추가, `from app.permissions.access import ...`에 `get_framework_category_id, is_category_admin` 추가, `from app.version_events import record_version_event`(이미 있으면 유지), `from sqlalchemy.orm import selectinload`(기존). `designate_subprocess` 앞에:

```python
@router.post("/{map_id}/framework-confirm", response_model=VersionOut)
async def confirm_framework_version(
    map_id: int,
    payload: FrameworkConfirmIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> MapVersion:
    """라이브 draft를 스냅샷(published)으로 확정 — 권한자/sysadmin 본인 확정, 상위 승인 없음.

    일반 게시와 달리 이전 스냅샷을 expired로 전환하지 않는다 — 모든 확정본이 이력으로
    남아 비교 가능 (design 2026-08-28 §6).
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.mode != "framework":
        raise HTTPException(status_code=422, detail="not a framework linkage canvas")
    if not logic.is_sysadmin(user):
        category_id = await get_framework_category_id(session, map_id)
        if category_id is None or not await is_category_admin(session, user, category_id):
            raise HTTPException(status_code=403, detail="category admin only")

    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == map_id, MapVersion.status == "draft")
        .order_by(MapVersion.id.desc())
        .options(
            selectinload(MapVersion.nodes),
            selectinload(MapVersion.edges),
            selectinload(MapVersion.groups),
        )
    )
    if draft is None:
        raise HTTPException(status_code=409, detail="canvas has no draft version")

    # fw 채번 — (major,minor) 최댓값 기준. 최초 1.0
    fw_rows = (
        await session.execute(
            select(MapVersion.fw_major, MapVersion.fw_minor).where(
                MapVersion.map_id == map_id, MapVersion.fw_major.is_not(None)
            )
        )
    ).all()
    if not fw_rows:
        major, minor = 1, 0
    else:
        cur_major, cur_minor = max(fw_rows)
        major, minor = (cur_major + 1, 0) if payload.major else (cur_major, cur_minor + 1)

    snapshot = MapVersion(
        map_id=map_id, label=f"v{major}.{minor}", status="published",
        fw_major=major, fw_minor=minor, submitted_by=user,
    )
    session.add(snapshot)
    await session.flush()
    max_num = await session.scalar(
        select(func.max(MapVersion.version_number)).where(MapVersion.map_id == map_id)
    )
    snapshot.version_number = (max_num or 0) + 1
    await clone_graph(session, draft, snapshot.id)
    record_version_event(session, snapshot.id, "published", user)
    await session.commit()
    await session.refresh(snapshot)
    return snapshot
```

주의: `VersionOut`이 maps.py schemas import에 없으면 추가. `record_version_event` import가 maps.py에 없으면 추가(`from app.version_events import record_version_event`).

- [x] **Step 4: 통과 확인** — 파일 → 전체 스위트. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/maps.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): self-serve confirm snapshots with maj.min numbering — 본인 확정 스냅샷·메이저/마이너 채번"
```

---

### Task 7: 누수 방지 가드 4종 (SP지정·복사·개명 동기·삭제 409)

**Files:**
- Modify: `backend/app/routers/maps.py` (`designate_subprocess`·`copy_map`)
- Modify: `backend/app/routers/categories.py` (`update_category`·`delete_category`)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Consumes: Task 4의 캔버스.
- Produces: 캔버스 SP지정 422 · 캔버스 복사 422 · 카테고리 개명 시 캔버스 이름 동기 · 서브트리에 캔버스 있으면 카테고리 삭제 409.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
def test_framework_guards(client: TestClient, enforce: None) -> None:
    l5 = _seed_category(client, "FWC-G5", "가드L5", level=5)
    _seed_l6_map(client, l5, "가드업무1", "FWC-GM1")
    act_as(SYSADMIN)
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    # SP 지정 거부
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json={"department": "X"})
    assert res.status_code == 422
    # 복사 거부
    assert client.post(f"/api/maps/{map_id}/copy", json={"name": "가드 복사본"}).status_code == 422
    # 카테고리 개명 → 캔버스 이름 동기
    client.patch(f"/api/categories/{l5}", json={"name": "가드L5개명"})
    assert client.get(f"/api/maps/{map_id}").json()["name"].startswith("가드L5개명 연계")
    # 서브트리에 캔버스 → 삭제 409 (L6 맵도 있어 어차피 409지만 detail로 캔버스 사유 확인 불가 —
    # 캔버스만 있는 카테고리로 별도 검증)
    l5b = _seed_category(client, "FWC-G5B", "가드빈L5", level=5)
    client.post(f"/api/categories/{l5b}/linkage-map")
    res = client.delete(f"/api/categories/{l5b}")
    assert res.status_code == 409
    assert "linkage" in res.json()["detail"]
```

- [x] **Step 2: 실패 확인** — Expected: FAIL (SP 지정이 409 "no published version"으로 — 422 아님)

- [x] **Step 3: 구현**

① `maps.py` `designate_subprocess` — `found_map` 404 체크 직후:

```python
    if found_map.mode == "framework":
        raise HTTPException(
            status_code=422, detail="framework linkage canvas cannot be designated"
        )
```

② `maps.py` `copy_map` — `source_map` 404 체크 직후:

```python
    if source_map.mode == "framework":
        raise HTTPException(
            status_code=422, detail="framework linkage canvas cannot be copied"
        )
```

③ `categories.py` `update_category` — `if payload.name is not None:` 블록을 확장(이름 반영 뒤 캔버스 동기):

```python
    if payload.name is not None:
        category.name = payload.name
        # 캔버스 이름 동기 — 생성 시 자동 명명("{이름} 연계")과 동일 규칙 (design 2026-08-28 §9)
        if category.linkage_map_id is not None:
            canvas = await session.get(ProcessMap, category.linkage_map_id)
            if canvas is not None and canvas.deleted_at is None:
                canvas.name = await _unique_linkage_name(session, category)
```

주의: `_unique_linkage_name`은 category.name이 이미 새 값으로 반영된 뒤 호출. 자기 자신과의 충돌은 없다(이름이 바뀌므로) — 단 rename이 동일 이름이면 후보 1이 자기 자신과 충돌해 `(code)` 서픽스가 붙는 극단 케이스가 있으니, `_unique_linkage_name`에 `exclude_map_id: int | None = None` 파라미터를 추가해 `where(ProcessMap.name == candidate, ProcessMap.id != exclude_map_id)`로 자기 제외하고 여기선 `exclude_map_id=canvas.id`로 호출한다(생성 경로는 미전달).

④ `categories.py` `delete_category` — 기존 `map_count` 409 뒤에:

```python
    canvas_count = await session.scalar(
        select(func.count())
        .select_from(ProcessCategory)
        .where(ProcessCategory.id.in_(subtree_ids), ProcessCategory.linkage_map_id.is_not(None))
    )
    if canvas_count:
        raise HTTPException(
            status_code=409,
            detail=f"{canvas_count} linkage canvases exist in this subtree",
        )
```

- [x] **Step 4: 통과 확인** — 파일 → 전체 스위트. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/routers/maps.py backend/app/routers/categories.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): canvas leak guards and rename/delete coupling — 캔버스 지정·복사 차단, 개명 동기·삭제 409"
```

---

### Task 8: 응답 표면 확장 (트리 필드 · MapOut linkage · SP ref category_path)

**Files:**
- Modify: `backend/app/schemas.py` (`CategoryNodeOut`·`MapOut`·`SubprocessRefOut`)
- Modify: `backend/app/routers/categories.py` (`list_category_nodes`·`get_category_chain`)
- Modify: `backend/app/routers/maps.py` (`get_map`)
- Modify: `backend/app/subprocess.py` (`get_subprocess_refs`)
- Test: `backend/tests/test_framework_canvas.py`

**Interfaces:**
- Produces: `CategoryNodeOut.linkage_map_id: int|None`·`can_edit_linkage: bool` / `MapOut.linkage_category_id: int|None`·`linkage_category_path: str|None` / `SubprocessRefOut.category_path: str|None`. FE Task 9~14가 소비.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
def test_surface_fields(client: TestClient, enforce: None) -> None:
    l1 = _seed_category(client, "FWC-S1", "표면L1")
    l5 = _seed_category(client, "FWC-S5", "표면L5", level=5, parent_id=l1)
    m1 = _seed_l6_map(client, l5, "표면업무1", "FWC-SM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.surfer"}]})
    act_as("fwc.surfer")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]

    # 트리: L5 행에 linkage_map_id + can_edit_linkage(권한자 상속)
    nodes = client.get(f"/api/categories/nodes?parent_id={l1}").json()
    row = next(n for n in nodes if n["id"] == l5)
    assert row["linkage_map_id"] == map_id and row["can_edit_linkage"] is True
    act_as("fwc.pleb")
    row = next(n for n in client.get(f"/api/categories/nodes?parent_id={l1}").json()
               if n["id"] == l5)
    assert row["linkage_map_id"] == map_id and row["can_edit_linkage"] is False
    # chain에도 동일 필드
    chain = client.get(f"/api/categories/{l5}/chain").json()
    assert chain[-1]["linkage_map_id"] == map_id

    # MapOut: 캔버스에 linkage_category_id/path
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["linkage_category_id"] == l5
    assert detail["linkage_category_path"] == "표면L1/표면L5"

    # SubprocessRefOut: 그래프 refs에 category_path
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    assert graph["subprocess_refs"][str(m1)]["category_path"] == "표면L1/표면L5"
```

- [x] **Step 2: 실패 확인** — Expected: FAIL (KeyError `linkage_map_id`)

- [x] **Step 3: 구현**

① `schemas.py` — `CategoryNodeOut`에:

```python
    # L5 연계 캔버스 — 결착 맵 id(없으면 None)·호출자 편집 가능 여부(권한자 체인, 배치 계산)
    linkage_map_id: int | None = None
    can_edit_linkage: bool = False
```

`MapOut`의 `consultant_code` 근처에:

```python
    # framework 캔버스 전용 — 결착 카테고리(트랜지언트, get_map이 역조회로 주입)
    linkage_category_id: int | None = None
    linkage_category_path: str | None = None
```

`SubprocessRefOut`의 `sp_description` 위에:

```python
    # 링크맵의 체계 경로 — 캔버스에서 외부 L6 출신 배지 소스(라이브 파생) (design 2026-08-28 §8)
    category_path: str | None = None
```

② `categories.py` — 권한자 상속 집합 헬퍼(`_split_visible_maps` 근처):

```python
async def _admin_category_ids(session: AsyncSession, user: str) -> set[int]:
    """호출자가 권한자인 카테고리 id 전체 — 직접 부여 + 그 서브트리(하향 상속). sysadmin은 전체."""
    rows = (
        await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id))
    ).all()
    if logic.is_sysadmin(user):
        return {cid for cid, _ in rows}
    perm_rows = (
        await session.execute(
            select(CategoryPermission.category_id, CategoryPermission.principal_type,
                   CategoryPermission.principal_id)
        )
    ).all()
    if not perm_rows:
        return set()
    emp = await session.get(Employee, user)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )
    group_ids = await get_user_active_group_ids(session, user, emp_org_path)
    seeds = {
        cid for cid, ptype, pid in perm_rows
        if (ptype == "user" and pid == user) or (ptype == "group" and pid in group_ids)
    }
    if not seeds:
        return set()
    children_by_parent: dict[int | None, list[int]] = {}
    for cid, pid in rows:
        children_by_parent.setdefault(pid, []).append(cid)
    admin_ids = set(seeds)
    frontier = [c for s in seeds for c in children_by_parent.get(s, [])]
    while frontier:
        admin_ids.update(frontier)
        frontier = [c for f in frontier for c in children_by_parent.get(f, []) if c not in admin_ids]
    return admin_ids
```

`list_category_nodes` — rows select에 `ProcessCategory.linkage_map_id` 추가, `user: str = Depends(get_current_user)` 파라미터 추가, 반환 직전 `admin_ids = await _admin_category_ids(session, user)` 계산 후 CategoryNodeOut 생성에:

```python
            linkage_map_id=r.linkage_map_id,
            can_edit_linkage=r.id in admin_ids,
```

`get_category_chain`도 동일(rows select 확장 + user 파라미터 + admin_ids + 두 필드).

③ `maps.py` `get_map` — `category_path` 주입 블록 뒤에:

```python
    if found_map.mode == "framework":
        linkage_cat_id = await session.scalar(
            select(ProcessCategory.id).where(ProcessCategory.linkage_map_id == map_id)
        )
        if linkage_cat_id is not None:
            found_map.linkage_category_id = linkage_cat_id
            category_paths = build_category_paths(
                (
                    await session.execute(
                        select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
                    )
                ).all()
            )
            found_map.linkage_category_path = category_paths.get(linkage_cat_id)
```

④ `subprocess.py` `get_subprocess_refs` — select에 `ProcessMap.category_id` 추가(마지막 컬럼), 언패킹 튜플에 `category_id` 추가, refs 생성 후:

```python
    cat_ids = {c for c in (category_id_by_map.values()) if c is not None}
```

구현 방식: rows 순회로 `category_id_by_map: dict[int, int | None]`을 함께 만들고, cat_ids가 비어있지 않으면 지역 import로 경로 조립:

```python
    if cat_ids:
        from app.routers.categories import build_category_paths  # 지역 관례 — 순환 회피(maps.py:66)

        cat_rows = (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
        paths = build_category_paths(cat_rows)
        for mid, cid in category_id_by_map.items():
            if cid is not None and mid in refs:
                refs[mid].category_path = paths.get(cid)
```

`ProcessCategory`를 subprocess.py import에 추가(`from app.models import MapVersion, Node, ProcessCategory, ProcessMap`).

- [x] **Step 4: 통과 확인** — 파일 → 전체 스위트 + ruff: `.venv/bin/ruff check app/ tests/`. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/categories.py backend/app/routers/maps.py backend/app/subprocess.py backend/tests/test_framework_canvas.py
git commit -m "feat(framework): expose linkage fields on tree, map and subprocess refs — 트리·맵·SP ref에 연계 필드 노출"
```

---

### Task 9: FE api.ts 타입·클라이언트

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 2·4·6·8 API.
- Produces: `CategoryNode.linkage_map_id/can_edit_linkage` · `MapSummary.linkage_category_id/linkage_category_path` · `SubprocessRef.category_path` · `openLinkageMap(categoryId)` · `confirmFrameworkVersion(mapId, major)` · `listCategoryPermissions/setCategoryPermissions` · `CategoryPermissionEntry`. Task 10~16이 소비.

- [x] **Step 1: 타입·함수 추가**

`CategoryNode`(api.ts:2507 근처)에:

```ts
  // L5 연계 캔버스 — 결착 맵 id(없으면 null)·호출자 생성/편집 가능 여부(권한자 체인)
  linkage_map_id: number | null;
  can_edit_linkage: boolean;
```

`MapSummary`(api.ts:37)의 `mode?: string;` 근처에:

```ts
  // framework 캔버스 전용 — 결착 카테고리(상세 응답에서만 채움)
  linkage_category_id?: number | null;
  linkage_category_path?: string | null;
```

`SubprocessRef`(api.ts:195)에:

```ts
  // 링크맵의 체계 경로 — 캔버스 외부 L6 출신 배지 소스(라이브 파생)
  category_path?: string | null;
```

카테고리 API 섹션(api.ts:2530s) 뒤에:

```ts
export interface LinkageMapResult {
  map_id: number;
  added_count: number;
  missing_count: number;
}

// 연계 캔버스 멱등 열기 — 없으면 생성+시드(권한자), 있으면 자동 보강. 뷰어는 missing_count만.
export function openLinkageMap(categoryId: number): Promise<LinkageMapResult> {
  return request<LinkageMapResult>(`/categories/${categoryId}/linkage-map`, { method: "POST" });
}

// 라이브 draft를 스냅샷으로 확정 — major=true면 다음 메이저.0
export function confirmFrameworkVersion(mapId: number, major: boolean): Promise<VersionSummary> {
  return request<VersionSummary>(`/maps/${mapId}/framework-confirm`, {
    method: "POST",
    body: JSON.stringify({ major }),
  });
}

export interface CategoryPermissionEntry {
  principal_type: "user" | "group";
  principal_id: string;
}

export function listCategoryPermissions(categoryId: number): Promise<{ permissions: CategoryPermissionEntry[] }> {
  return request<{ permissions: CategoryPermissionEntry[] }>(`/categories/${categoryId}/permissions`);
}

export function setCategoryPermissions(
  categoryId: number,
  permissions: CategoryPermissionEntry[],
): Promise<{ permissions: CategoryPermissionEntry[] }> {
  return request<{ permissions: CategoryPermissionEntry[] }>(`/categories/${categoryId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
}
```

주의: `VersionSummary`는 api.ts:33 근처에 기존 존재(`VersionDetail extends VersionSummary`) — import 불필요(동일 파일).

- [x] **Step 2: 타입 게이트**

Run(frontend/에서): `npx tsc --noEmit`
Expected: PASS (CategoryNode 필수 필드 추가로 기존 mock/테스트 픽스처가 깨지면 — `framework-tree-state.test.ts`의 CategoryNode 리터럴에 두 필드 추가)

- [x] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/framework-tree-state.test.ts
git commit -m "feat(frontend): api client for linkage canvas endpoints — 연계 캔버스 API 클라이언트"
```

---

### Task 10: 홈 트리 L5 행 Linkage 버튼

**Files:**
- Modify: `frontend/src/components/maps/framework-tree.tsx` (renderNode header)
- Modify: `frontend/src/app/page.tsx` (FrameworkTree 사용부 ~873)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 9 `openLinkageMap`, `CategoryNode.linkage_map_id/can_edit_linkage`.
- Produces: L5 행 우측 버튼 → 캔버스 열기/생성 후 `/maps/{id}` 이동.

- [x] **Step 1: FrameworkTree에 prop 추가**

`FrameworkTreeProps`에:

```ts
  // L5 행 연계 캔버스 열기 — 캔버스 존재 시 전원, 미존재 시 권한자만 버튼 노출 (design 2026-08-28 §8)
  onOpenLinkage: (node: CategoryNode) => void;
```

`renderNode`의 `header` 버튼(줄 250-268)을 래핑 — 기존 `<button>`을 `<div className="flex items-center gap-1">`으로 감싸고 버튼에 `min-w-0 flex-1` 추가, CountTag 뒤(래퍼 안, 토글 버튼 밖)에:

```tsx
        {node.level === 5 && (node.linkage_map_id !== null || node.can_edit_linkage) && (
          <button
            type="button"
            data-id={`framework-linkage-${node.id}`}
            title={t("framework.openLinkage")}
            className="shrink-0 rounded-sm p-1 text-ink-muted opacity-0 hover:bg-surface-alt hover:text-accent group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onOpenLinkage(node);
            }}
          >
            <Workflow size={14} strokeWidth={1.5} />
          </button>
        )}
```

주의: 기존 header `<button>`이 `group` 클래스 보유 — 래퍼 `<div>`로 옮긴다(`group flex w-full items-center gap-1 rounded-sm hover:bg-divider` → 래퍼, 내부 버튼은 `flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left`). lucide `Workflow` import 추가. 캔버스 미존재+비권한자는 버튼 자체가 안 보인다.

- [x] **Step 2: page.tsx 핸들러 연결**

`frontend/src/app/page.tsx`의 `<FrameworkTree renderCard=... filterMap=... />`(줄 873 근처)에:

```tsx
              onOpenLinkage={(node) => {
                void openLinkageMap(node.id)
                  .then((r) => router.push(`/maps/${r.map_id}`))
                  .catch((err) => showToast(humanizeApiError(err, t)));
              }}
```

import: `openLinkageMap`(api). `router`·토스트 헬퍼는 page.tsx 기존 것 사용 — 홈에 토스트 유틸이 없으면 기존 에러 표시 관례(`setStatus`류)를 따른다(구현 시 실측).

- [x] **Step 3: i18n 키** — en 블록(1845 근처)과 ko 블록(3757 근처)에:

```ts
  "framework.openLinkage": "Linkage canvas",        // en
  "framework.openLinkage": "연계 캔버스",             // ko
```

- [x] **Step 4: 게이트** — `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add frontend/src/components/maps/framework-tree.tsx frontend/src/app/page.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(frontend): linkage canvas entry on L5 tree rows — 홈 트리 L5 행 연계 캔버스 버튼"
```

---

### Task 11: 에디터 framework 모드 플러밍 (버전선택·팔레트·패널 seam·자동 보강)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 9 `openLinkageMap`, `MapSummary.linkage_category_id/path`.
- Produces: `isFrameworkMap`·`linkageCategoryId/Path` state — Task 12~14가 소비. `frameworkPickerOpen` state — Task 13이 소비.

- [x] **Step 1: 상태·파생 추가** (933 근처):

```ts
  const isFrameworkMap = mapMode === "framework";
```

state 선언부(mapCategoryId 근처, 2318 참조)에:

```ts
  const [linkageCategoryId, setLinkageCategoryId] = useState<number | null>(null);
  const [linkageCategoryPath, setLinkageCategoryPath] = useState<string | null>(null);
  const [frameworkPickerOpen, setFrameworkPickerOpen] = useState(false);
  const [reconcileNotice, setReconcileNotice] = useState<{ added: number; missing: number } | null>(null);
```

- [x] **Step 2: 로드 effect 확장** (2318-2356) — `setMapMode(detail.mode ?? "normal")` 뒤에:

```ts
        setLinkageCategoryId(detail.linkage_category_id ?? null);
        setLinkageCategoryPath(detail.linkage_category_path ?? null);
        // 연계 캔버스 자동 보강 — 열 때 소속 L6 부족분 append(권한자), 뷰어는 미반영 수만 (design 2026-08-28 §5)
        if (detail.mode === "framework" && detail.linkage_category_id != null) {
          try {
            const r = await openLinkageMap(detail.linkage_category_id);
            if (active && (r.added_count > 0 || r.missing_count > 0)) {
              setReconcileNotice({ added: r.added_count, missing: r.missing_count });
            }
          } catch {
            // 보강 실패는 열람을 막지 않는다 — 다음 열기에서 재시도
          }
        }
```

버전 선택(2330-2332)을:

```ts
        const draft = detail.versions.find((v) => v.status === "draft");
        const latestPublished = detail.versions.find((v) => v.status === "published");
        let initialId = latestPublished?.id ?? detail.versions[0]?.id;
        if (detail.mode === "framework") {
          // 캔버스는 뷰어 포함 항상 라이브 draft 우선 — 스냅샷은 드롭다운에서 열람 (design 2026-08-28 §8)
          initialId = draft?.id ?? initialId;
        } else if (draft) {
          try {
            const ws = await getWorkflowState(draft.id);
            if (active && ws.checkout_holder === me.username) {
              initialId = draft.id;
            }
          } catch {
            // 워크플로우 조회 실패 시 기본값 유지
          }
        }
```

주의: 보강이 노드를 추가했을 수 있으므로 **보강 호출은 setVersionId 전에** 끝난다(그래프 로드는 versionId effect가 수행 — 순서상 최신 그래프를 읽는다).

- [x] **Step 3: 보강 토스트/칩** — `reconcileNotice`를 소비: 에디터 마운트 후 토스트(`showToast`) 1회 + 뷰어 캡션. versionId 설정 직후(로드 effect 말미)나 별도 effect 대신 **로드 effect 안에서 직접**:

```ts
        // (setVersionId 이후) 보강 알림 — 권한자는 토스트, 뷰어는 상단 칩(Task 12의 캡션 영역에서 렌더)
```

토스트는 상태 세팅으로 갈음하고 실제 표시는: `reconcileNotice.added > 0`이면 `showToast(t("framework.reconciled", { n: ... }))`를 로드 effect에서 직접 호출(에디터 showToast는 기존 유틸), `missing > 0`은 Task 12의 캡션에서 `{t("framework.missing", { n })}` 칩으로 렌더.

- [x] **Step 4: 팔레트 제한** — pane 컨텍스트 메뉴(5590-5597):

```ts
      return [
        ...(isFrameworkMap
          ? []
          : NODE_TYPE_OPTIONS.map((option, index) => ({
              label: t(option.labelKey),
              icon: NODE_TYPE_ICONS[option.value],
              shortcut: String(index + 1),
              accel: String(index + 1),
              onSelect: () => handleAddNode({ x: menu.x, y: menu.y }, option.value),
            }))),
```

`handleAddNode` 본문 첫 줄에 choke-point 가드:

```ts
    if (isFrameworkMap) return; // 캔버스는 subprocess 링크만 — 서버 422의 클라 선제 차단
```

(handleAddNode가 useCallback이면 deps에 isFrameworkMap 추가 — React Compiler 제약 준수.)

- [x] **Step 5: 패널 seam 통일** — 5개 지점(5580-5585, 7723, 8180, 8349, 10554)의 `isWordMap ? setSectionsOpen(true) : setLibraryOpen(true)` 패턴을 plain function으로 추출해 교체:

```ts
  function openMapPalette() {
    if (isWordMap) setSectionsOpen(true);
    else if (isFrameworkMap) setFrameworkPickerOpen(true);
    else setLibraryOpen(true);
  }
```

라벨(5580)은 `isWordMap ? "Add section" : isFrameworkMap ? t("framework.pickerOpen") : t("library.open")`. 토글형(8180)은 대칭으로 `setFrameworkPickerOpen((open) => !open)` 분기.

- [x] **Step 6: i18n 키** (en/ko 각각):

```ts
  "framework.pickerOpen": "Add L6 process",            // en
  "framework.reconciled": "{n} new L6 added (unplaced)",
  "framework.missing": "{n} L6 not yet on canvas",
  "framework.pickerOpen": "L6 업무 추가",               // ko
  "framework.reconciled": "새 L6 {n}개 추가됨 (미배치)",
  "framework.missing": "미반영 L6 {n}개",
```

- [x] **Step 7: 게이트** — `npx tsc --noEmit && npm run lint && npx vitest run`. Expected: PASS
- [x] **Step 8: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): framework canvas mode plumbing — 캔버스 모드 버전선택·팔레트 제한·자동 보강"
```

---

### Task 12: Confirm 섹션 + FrameworkChip 확장

**Files:**
- Create: `frontend/src/components/framework-confirm-section.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (10427-10465 ApprovalPanel seam · 8497-8504 chip · 캡션)
- Modify: `frontend/src/components/framework-chip.tsx` (L5 행 캔버스 열기)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 9 `confirmFrameworkVersion`, Task 11 state, Task 8 chain의 `linkage_map_id`.
- Produces: 캔버스 확정 UI·최신 확정 캡션·캔버스/L6 칩 진입.

- [x] **Step 1: FrameworkConfirmSection 컴포넌트**:

```tsx
"use client";

// 연계 캔버스 확정 섹션 — 일반 맵의 ApprovalPanel 자리를 대체. 권한자(editor+)만 버튼,
// 확정은 minor+1, Major 체크 시 다음 메이저.0 (design 2026-08-28 §6).
import { BadgeCheck } from "lucide-react";
import { useState } from "react";

import { confirmFrameworkVersion, type VersionSummary } from "@/lib/api";
import { humanizeApiError } from "@/lib/humanize-error";
import { useI18n } from "@/lib/i18n";

export interface FrameworkConfirmSectionProps {
  mapId: number;
  canConfirm: boolean; // myRole editor+ (권한자/sysadmin 파생)
  latestLabel: string | null; // 최신 확정 스냅샷 label("v1.1") — 없으면 null
  onConfirmed: (snapshot: VersionSummary) => void; // 부모가 versions 갱신·토스트
  onError: (message: string) => void;
}

export function FrameworkConfirmSection({
  mapId, canConfirm, latestLabel, onConfirmed, onError,
}: FrameworkConfirmSectionProps) {
  const { t } = useI18n();
  const [major, setMajor] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div data-id="framework-confirm-section" className="flex flex-col gap-2 p-3">
      <p className="text-caption text-ink-secondary">
        {latestLabel
          ? t("framework.latestConfirmed", { label: latestLabel })
          : t("framework.notConfirmed")}
      </p>
      {canConfirm && (
        <>
          <label className="flex cursor-pointer items-center gap-1.5 text-fine text-ink-tertiary">
            <input
              data-id="framework-confirm-major"
              type="checkbox"
              checked={major}
              onChange={() => setMajor((v) => !v)}
            />
            {t("framework.majorVersion")}
          </label>
          <button
            type="button"
            data-id="framework-confirm-button"
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              confirmFrameworkVersion(mapId, major)
                .then((snapshot) => {
                  setMajor(false);
                  onConfirmed(snapshot);
                })
                .catch((err) => onError(humanizeApiError(err, t)))
                .finally(() => setBusy(false));
            }}
          >
            <BadgeCheck size={16} strokeWidth={1.5} />
            {t("framework.confirmChanges")}
          </button>
        </>
      )}
    </div>
  );
}
```

주의: `humanizeApiError`의 실제 모듈 경로는 구현 시 grep(`humanizeApiError` — page.tsx import 참조)해 맞춘다. `text-white`가 토큰 규칙에 걸리면 기존 accent 버튼(예: 게시 버튼)의 클래스를 그대로 미러한다.

- [x] **Step 2: page.tsx 통합** — 10427 승인 아코디언 내부의 `<ApprovalPanel …/>`을:

```tsx
                              {isFrameworkMap ? (
                                <FrameworkConfirmSection
                                  mapId={mapId}
                                  canConfirm={myRole === "editor" || myRole === "owner"}
                                  latestLabel={
                                    versions
                                      .filter((v) => v.status === "published")
                                      .at(-1)?.label ?? null
                                  }
                                  onConfirmed={(snapshot) => {
                                    setVersions((prev) => [...prev, snapshot]);
                                    showToast(t("framework.confirmedToast", { label: snapshot.label }));
                                  }}
                                  onError={(message) => showToast(message)}
                                />
                              ) : (
                                <ApprovalPanel … 기존 그대로 … />
                              )}
```

주의: `versions` state의 타입이 `VersionDetail[]`이면 `setVersions` append 시 스냅샷(VersionSummary)과 형이 안 맞을 수 있다 — 그 경우 `getMap(mapId)` 재조회로 `setVersions(detail.versions)` 하는 쪽을 택한다(구현 시 타입 실측, 재조회가 안전).

- [x] **Step 3: FrameworkChip 소스 확장** — page.tsx 8497-8504:

```tsx
                topRightSlot={
                  index === 0 && (mapCategoryId !== null || linkageCategoryId !== null) ? (
                    <FrameworkChip
                      mapId={mapId}
                      categoryId={(mapCategoryId ?? linkageCategoryId)!}
                      onNavigate={(targetId, name) => setOpenMapPrompt({ mapId: targetId, name })}
                    />
                  ) : undefined
                }
```

- [x] **Step 4: FrameworkChip L5 행에 캔버스 열기** — framework-chip.tsx 체인 행 렌더(153-183)에서, `cat.level === 5 && cat.linkage_map_id != null && cat.linkage_map_id !== mapId`이면 행 우측(map_count 스팬 앞)에 작은 아이콘 버튼:

```tsx
                    {cat.level === 5 && cat.linkage_map_id != null && cat.linkage_map_id !== mapId && (
                      <span
                        data-id={`editor-framework-linkage-${cat.id}`}
                        title={t("framework.openLinkage")}
                        className="ml-auto shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                        onClick={(event) => {
                          event.stopPropagation();
                          const targetId = cat.linkage_map_id;
                          if (targetId == null) return;
                          if (onNavigate) onNavigate(targetId, cat.name);
                          else router.push(`/maps/${targetId}`);
                        }}
                      >
                        <Workflow size={12} strokeWidth={1.5} />
                      </span>
                    )}
```

주의: 부모가 `<button>`이라 중첩 button 금지 — `<span role="button">` 대신 위처럼 span+onClick(stopPropagation)으로. `Workflow` lucide import. map_count 스팬의 `ml-auto`와 겹치면 순서 조정(캔버스 버튼이 먼저 ml-auto를 가져가고 count는 `shrink-0`만).

- [x] **Step 5: 뷰어 미반영 칩** — Task 11의 `reconcileNotice.missing > 0`을 캔버스 상단(FrameworkChip 아래가 아닌 좌상단 titleSlot 근처 기존 readOnly 배너 영역)에 `text-fine` 칩으로 렌더:

```tsx
          {isFrameworkMap && reconcileNotice !== null && reconcileNotice.missing > 0 && (
            <span data-id="framework-missing-chip" className="rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink-tertiary">
              {t("framework.missing", { n: reconcileNotice.missing })}
            </span>
          )}
```

배치는 readOnlyNotice 배너 렌더 지점 옆(구현 시 실측) — 겹치면 배너 desc 뒤에 붙인다.

- [x] **Step 6: i18n 키** (en/ko):

```ts
  "framework.latestConfirmed": "Linkage canvas · latest {label}",
  "framework.notConfirmed": "Linkage canvas · not confirmed yet",
  "framework.majorVersion": "Major version",
  "framework.confirmChanges": "Confirm changes",
  "framework.confirmedToast": "Confirmed as {label}",
  // ko
  "framework.latestConfirmed": "연계 캔버스 · 최신 확정 {label}",
  "framework.notConfirmed": "연계 캔버스 · 확정 이력 없음",
  "framework.majorVersion": "메이저 버전",
  "framework.confirmChanges": "변경 확정",
  "framework.confirmedToast": "{label}로 확정됨",
```

- [x] **Step 7: 게이트** — tsc/lint/vitest. Expected: PASS
- [x] **Step 8: Commit**

```bash
git add frontend/src/components/framework-confirm-section.tsx frontend/src/components/framework-chip.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): confirm section and framework chip for canvases — 확정 섹션·캔버스 칩 진입"
```

---

### Task 13: FrameworkTreePicker 패널 (L6 가져오기)

**Files:**
- Create: `frontend/src/components/framework-tree-picker.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (8408-8424 패널 seam)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `framework-tree-state`(리듀서·fetch 유틸), 드래그 규약 `application/bpm-process(-name/-pinned/-unregistered)` → 기존 `handleLibraryDrop`/`createLinkNodeAt` 무변경 재사용.
- Produces: 캔버스 좌측 트리 피커(fetch-all 없음, L6≈20,000 대응).

- [x] **Step 1: 컴포넌트 작성**:

```tsx
"use client";

// 연계 캔버스용 framework 트리 피커 — 라이브러리 패널(fetch-all)을 대체하는 lazy 트리
// (L5≈3,000·L6≈20,000 스케일). 맵 카드를 기존 bpm-process 드래그 규약으로 캔버스에 드롭한다.
// 상태는 lib/framework-tree-state.ts 리듀서 재사용(캐스케이드·영속 없음 — 패널은 임시 탐색).
import { ChevronDown, ChevronRight, Network, X } from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";

import type { MapSummary } from "@/lib/api";
import {
  applyCategoryLoaded,
  createInitialState,
  fetchCategoryChildren,
  fetchRootChildren,
  hasCachedChildren,
  reduceFrameworkTree,
  ROOT,
  shouldFetchChildren,
  type FrameworkTreeState,
} from "@/lib/framework-tree-state";
import { useI18n } from "@/lib/i18n";

export interface FrameworkTreePickerProps {
  currentMapId: number;
  linkedMapIds: Set<number>;
  onClose: () => void;
}

export function FrameworkTreePicker({ currentMapId, linkedMapIds, onClose }: FrameworkTreePickerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FrameworkTreeState>(createInitialState());
  const [rootError, setRootError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchRootChildren()
      .then((nodes) => {
        if (active) setState((prev) => reduceFrameworkTree(prev, { type: "children_loaded", parentId: ROOT, nodes }));
      })
      .catch(() => {
        if (active) setRootError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function handleToggle(categoryId: number) {
    if (state.openIds.has(categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "closed", categoryId }));
      return;
    }
    setState((prev) => reduceFrameworkTree(prev, { type: "opened", categoryId }));
    if (shouldFetchChildren(state, categoryId)) {
      setState((prev) => reduceFrameworkTree(prev, { type: "loading_started", categoryId }));
      void fetchCategoryChildren(categoryId)
        .then(({ nodes, maps }) => setState((prev) => applyCategoryLoaded(prev, categoryId, nodes, maps)))
        .catch(() => setState((prev) => reduceFrameworkTree(prev, { type: "loading_ended", categoryId })));
    }
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, row: MapSummary) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/bpm-process", String(row.id));
    e.dataTransfer.setData("application/bpm-process-name", row.name);
    e.dataTransfer.setData("application/bpm-process-pinned", ""); // 캔버스 노드는 최신 추종
    if (!row.sp_designated_at) e.dataTransfer.setData("application/bpm-process-unregistered", "1");
  }

  const renderMapRow = (row: MapSummary) => {
    const blocked = row.id === currentMapId || linkedMapIds.has(row.id) || row.mode === "framework";
    return (
      <div
        key={row.id}
        data-id={`framework-picker-map-${row.id}`}
        draggable={!blocked}
        onDragStart={blocked ? undefined : (e) => handleDragStart(e, row)}
        title={blocked ? t("library.alreadyLinked") : row.name}
        className={`flex cursor-grab items-center gap-1.5 rounded-sm px-1.5 py-1 text-fine text-ink ${
          blocked ? "cursor-not-allowed opacity-40" : "hover:bg-surface-alt active:cursor-grabbing"
        }`}
      >
        <Network size={12} strokeWidth={1.5} className="shrink-0 text-ink/50" />
        <span className="min-w-0 truncate">{row.name}</span>
      </div>
    );
  };

  const renderNode = (node: { id: number; name: string; level: number; map_count: number }, depth: number) => {
    const open = state.openIds.has(node.id);
    const children = state.childrenByParent.get(node.id) ?? [];
    const mapsData = state.mapsByCategory.get(node.id);
    return (
      <li key={node.id} className="flex flex-col">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => handleToggle(node.id)}
          style={{ paddingLeft: `${depth * 10 + 4}px` }}
          className="flex w-full items-center gap-1 rounded-sm py-0.5 text-left hover:bg-surface-alt"
        >
          {open
            ? <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            : <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
          <span className="min-w-0 truncate text-fine text-ink-secondary">{node.name}</span>
          {node.map_count > 0 && (
            <span className="ml-auto shrink-0 text-fine text-ink-muted">{node.map_count}</span>
          )}
        </button>
        {open && (
          <>
            {mapsData !== undefined && mapsData.maps.length > 0 && (
              <div style={{ paddingLeft: `${(depth + 1) * 10 + 4}px` }} className="flex flex-col">
                {mapsData.maps.map(renderMapRow)}
              </div>
            )}
            {children.length > 0 && (
              <ul className="flex flex-col">{children.map((c) => renderNode(c, depth + 1))}</ul>
            )}
          </>
        )}
      </li>
    );
  };

  const roots = state.childrenByParent.get(ROOT) ?? [];
  return (
    <div
      data-id="framework-tree-picker"
      className="flex w-56 flex-col border-r border-hairline bg-surface"
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5 text-caption font-semibold text-ink">
          <Network size={14} strokeWidth={1.5} />
          {t("framework.pickerTitle")}
        </div>
        <button
          type="button"
          className="rounded-sm p-0.5 text-ink/50 hover:bg-surface-alt hover:text-ink"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-1">
        {rootError ? (
          <p className="p-2 text-fine text-error">{t("home.frameworkLoadError")}</p>
        ) : !hasCachedChildren(state, ROOT) ? (
          <p className="p-2 text-fine text-ink-tertiary">{t("common.loading")}</p>
        ) : (
          <ul className="flex flex-col">{roots.map((r) => renderNode(r, 0))}</ul>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 2: 에디터 seam** — page.tsx 8415 뒤(SectionPanel과 형제):

```tsx
        {frameworkPickerOpen && (
          <FrameworkTreePicker
            currentMapId={mapId}
            linkedMapIds={linkedMapIds}
            onClose={() => setFrameworkPickerOpen(false)}
          />
        )}
```

import 추가. `linkedMapIds`는 라이브러리 패널에 이미 넘기는 기존 값 재사용.

- [x] **Step 3: i18n 키** (en/ko):

```ts
  "framework.pickerTitle": "Framework L6",   // en
  "framework.pickerTitle": "업무 체계 L6",     // ko
```

- [x] **Step 4: 게이트** — tsc/lint/vitest. Expected: PASS
- [x] **Step 5: Commit**

```bash
git add frontend/src/components/framework-tree-picker.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): framework tree picker panel for canvas — 캔버스용 업무체계 트리 피커"
```

---

### Task 14: 외부 L6 출신 배지 (category_path 라이브 파생)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`injectSubEnds` 1479-1567)
- Modify: `frontend/src/components/process-node.tsx`

**Interfaces:**
- Consumes: Task 8 `SubprocessRef.category_path`, Task 11 `linkageCategoryPath`.
- Produces: 캔버스에서 다른 L5 소속 L6 노드에 출신 경로 배지.

- [x] **Step 1: injectSubEnds에 필드 주입** — designated 분기(1503-1543)의 spGmp 등 주입 목록에:

```ts
        // 캔버스 전용 — 링크맵의 현 소속이 이 캔버스의 L5와 다르면 출신 경로 배지 (라이브 파생)
        spOriginPath:
          isFrameworkMap && ref.category_path && ref.category_path !== linkageCategoryPath
            ? ref.category_path
            : null,
```

미지정 분기(null 주입 목록)에도 `spOriginPath: null` 추가. `injectSubEnds`가 useCallback이면 deps에 `isFrameworkMap`·`linkageCategoryPath` 추가.

- [x] **Step 2: 노드 렌더** — `process-node.tsx`의 subprocess 노드 데이터 타입에 `spOriginPath?: string | null` 추가(노드 data 타입 선언 위치는 구현 시 grep `spDepartment`로 실측 — 같은 자리), 부서 칩(`spDepartment` 렌더부) 근처에:

```tsx
      {data.spOriginPath && (
        <span
          data-id="node-origin-badge"
          title={data.spOriginPath}
          className="max-w-[200px] truncate rounded-xs border border-hairline bg-surface-alt px-1 py-px text-fine text-ink-tertiary"
        >
          {data.spOriginPath.split("/").slice(-2).join("/")}
        </span>
      )}
```

(마지막 2세그먼트만 — 전체 경로는 title 툴팁.)

- [x] **Step 3: 게이트** — tsc/lint/vitest. Expected: PASS
- [x] **Step 4: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/components/process-node.tsx
git commit -m "feat(canvas): origin path badge on cross-L5 subprocess nodes — 외부 L5 출신 배지"
```

---

### Task 15: 설정 권한자 관리 + 홈 목록 제외

**Files:**
- Modify: `frontend/src/components/admin/framework-panel.tsx`
- Modify: `frontend/src/lib/word-map-home.ts` (+ 테스트 파일 있으면 갱신, 없으면 신규 `word-map-home.test.ts`에 케이스 1개)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 9 `listCategoryPermissions/setCategoryPermissions`, `PrincipalPicker`(`components/permissions/principal-picker.tsx`), `getDirectory`(api.ts:1516)·`listGroups`(api.ts:1552).
- Produces: 카테고리 행 권한자 관리 모달 · 홈 일반 목록에서 framework 제외.

- [x] **Step 1: splitMapsByMode 제외 + 테스트**:

```ts
export function splitMapsByMode<T extends { mode?: string }>(
  maps: T[],
): { processMaps: T[]; wordMaps: T[] } {
  const processMaps: T[] = [];
  const wordMaps: T[] = [];
  for (const m of maps) {
    if (m.mode === "framework") continue; // 연계 캔버스는 홈 목록 제외 — 트리 L5 행으로만 진입 (design 2026-08-28 §9)
    (m.mode === "word" ? wordMaps : processMaps).push(m);
  }
  return { processMaps, wordMaps };
}
```

vitest 케이스(기존 테스트 파일에 추가, 없으면 신규):

```ts
import { describe, expect, it } from "vitest";
import { splitMapsByMode } from "./word-map-home";

describe("splitMapsByMode", () => {
  it("excludes framework canvases from both buckets", () => {
    const { processMaps, wordMaps } = splitMapsByMode([
      { mode: "normal" }, { mode: "word" }, { mode: "framework" }, {},
    ]);
    expect(processMaps).toHaveLength(2);
    expect(wordMaps).toHaveLength(1);
  });
});
```

- [x] **Step 2: framework-panel 권한자 모달** — 행 액션(rename 버튼 근처)에 버튼 추가:

```tsx
            <button
              type="button"
              data-id={`framework-admin-perms-${node.id}`}
              title={t("framework.adminPerms")}
              className={ROW_ICON_BTN}
              onClick={() => setPermsNode(node)}
            >
              <ShieldCheck size={14} strokeWidth={1.5} />
            </button>
```

state `const [permsNode, setPermsNode] = useState<CategoryNode | null>(null);` + lucide `ShieldCheck` import. 파일 하단에 모달 컴포넌트(MoveCategoryModal 선례를 따라 같은 파일 내):

```tsx
function CategoryPermsModal({ node, onClose, onToast }: {
  node: CategoryNode;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<CategoryPermissionEntry[] | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([listCategoryPermissions(node.id), getDirectory(), listGroups()])
      .then(([perms, dir, groupRows]) => {
        if (!active) return;
        setEntries(perms.permissions);
        setUsers(dir.users);
        setGroups(groupRows);
      })
      .catch(() => {
        if (active) onToast(t("framework.permsLoadError"));
      });
    return () => {
      active = false;
    };
  }, [node.id, onToast, t]);

  function save(next: CategoryPermissionEntry[]) {
    setEntries(next); // 낙관 반영
    void setCategoryPermissions(node.id, next)
      .then((r) => setEntries(r.permissions))
      .catch(() => onToast(t("framework.permsSaveError")));
  }

  return (
    <ModalBackdrop onClose={onClose}>
      … 제목: node.name + t("framework.adminPerms") …
      {entries === null ? 로딩 : (
        <>
          <ul>… entries.map — 유저/그룹 필 + 제거 버튼(save(entries.filter(...))) …</ul>
          <PrincipalPicker
            users={users}
            departments={[]}
            groups={groups}
            excludeIds={new Set(entries.map((e) => e.principal_id))}
            onSelect={(opt) => {
              if (opt.principalType !== "user" && opt.principalType !== "group") return;
              save([...entries, { principal_type: opt.principalType, principal_id: opt.principalId }]);
            }}
          />
        </>
      )}
    </ModalBackdrop>
  );
}
```

주의(구현 시 실측 3가지): ① `PrincipalPicker`의 정확한 props(users/departments/groups의 원소 타입, `userDepartments` 필요 여부)는 `approvers-panel.tsx:198`·`principal-picker.tsx:90`을 열어 맞춘다. ② `DirectoryUser`/`Group` 타입명은 api.ts의 `getDirectory`/`listGroups` 반환 타입에서 가져온다. ③ 모달 마크업은 `MoveCategoryModal`(framework-panel.tsx:715 근처)의 ModalBackdrop 구조를 그대로 미러한다. 렌더는 `{permsNode && <CategoryPermsModal node={permsNode} onClose={() => setPermsNode(null)} onToast={onToast} />}`.

- [x] **Step 3: i18n 키** (en/ko):

```ts
  "framework.adminPerms": "Linkage admins",
  "framework.permsLoadError": "Failed to load admins",
  "framework.permsSaveError": "Failed to save admins",
  // ko
  "framework.adminPerms": "연계 권한자",
  "framework.permsLoadError": "권한자 조회 실패",
  "framework.permsSaveError": "권한자 저장 실패",
```

- [x] **Step 4: 게이트** — tsc/lint/vitest(신규 케이스 포함). Expected: PASS
- [x] **Step 5: Commit**

```bash
git add frontend/src/components/admin/framework-panel.tsx frontend/src/lib/word-map-home.ts frontend/src/lib/word-map-home.test.ts frontend/src/lib/i18n-messages.ts
git commit -m "feat(admin): category admin management and home list exclusion — 권한자 관리 모달·홈 목록 캔버스 제외"
```

---

### Task 16: 통합 게이트 — 실브라우저 스모크 + 전체 그린 + 문서

**Files:**
- Create: `frontend/scripts/pw-smoke-framework-canvas.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: 전 태스크.
- Produces: 전 게이트 그린 + 스모크 통과 + 세션 스크린샷.

- [x] **Step 1: 백엔드 전체** — backend/에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`. Expected: 전부 그린.
- [x] **Step 2: FE 전체** — frontend/에서 `npx vitest run && npx tsc --noEmit && npm run lint`. Expected: 그린.
- [x] **Step 3: 스모크 작성** — `pw-smoke-framework.mjs` 하네스(시스템 Chrome·playwright-core·인터뷰 샘플 시드·check/결과 표) 골격을 복사해 시나리오만 교체:

1. admin.sys로 홈 → Framework 뷰 → 샘플 L5 행의 `[data-id^="framework-linkage-"]` 클릭 → 에디터 URL 이동 확인
2. 캔버스에 소속 L6 개수만큼 `subprocess` 노드 존재(Start/End 없음) 확인
3. `[data-id="framework-tree-picker"]` 열기(팔레트 버튼) → 다른 L5 펼침 → L6 행 존재 확인 (드래그는 CDP 제약이 크면 `addLinkNodeFromMap` 경로 — 상단 맵 드롭다운 — 로 대체 확인)
4. 엣지 1개 연결 후 저장(자동저장 대기) → 새로고침 후 유지 확인
5. `[data-id="framework-confirm-button"]` 클릭 → 토스트 "v1.0" 확인, 버전 드롭다운에 v1.0 확인
6. 뷰어 계정 전환(`page.goto` 재로그인) → 캔버스 열림(라이브)·편집 불가 확인

각 단계 스크린샷 저장(SHOT_DIR은 스크립트 인자/환경변수로 스크래치 지정 — **저장소 루트에 떨구지 말 것**, interview-import-branch 선례). 실행: backend(8000)+frontend(3000) 네이티브 기동, `python -m scripts.reset_db` 시드.
- [x] **Step 4: 스모크 실행** — `BASE_URL=http://localhost:3000 node scripts/pw-smoke-framework-canvas.mjs` 전 항목 PASS. 스크린샷을 사용자에게 공유(SendUserFile — frontend-screenshot-share-default 메모리).
- [x] **Step 5: PROGRESS.md 1항목 추가**(최상단):

```markdown
## 2026-08-28 — Framework L5 연계 캔버스 (feature/framework-l5-canvas)
- L5 "상세보기" 캔버스 — 실맵 mode="framework"+linkage_map_id 1:1, category_permissions 권한자(하향 상속)·라이브 draft+확정 스냅샷(fw_major/minor, published 재사용)·멱등 열기(시드/자동 보강)·subprocess-only 검증·트리/칩/피커/확정 UI. 스펙: docs/superpowers/specs/2026-08-28-framework-l5-linkage-canvas-design.md
```

- [x] **Step 6: Commit**

```bash
git add frontend/scripts/pw-smoke-framework-canvas.mjs PROGRESS.md
git commit -m "test(framework): canvas browser smoke and progress note — 캔버스 실브라우저 스모크·진행 기록"
```

---

## Self-Review 결과 (플랜 작성 시 수행)

- **스펙 커버리지**: §3 데이터 모델→T1, §4 권한→T2·T3, §5 API→T2·T4·T6·T8, §6 수명주기→T6, §7 검증→T5, §8 FE→T9~T14, §9 가드→T7·T15, §12 테스트→각 태스크+T16. §10(임포트 호환)·§11(알려진 한계)은 구현 없음(원칙 문서) — 커버 불요.
- **의도적 비-구현**: 스펙 §8 "이름 검색은 초기 범위 제외(후속)" — 피커는 트리 탐색만(T13).
- **주의 지점**: T12 Step 2의 versions 타입(재조회 폴백 명시), T15 Step 2의 PrincipalPicker props(실측 지시 명시) — 실행 시 해당 파일을 열어 확정한다.
