# 하위프로세스 참조 모델 — 백엔드 구현 계획 (Plan 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백엔드를 "프로세스 참조(Call Activity)" 모델로 전환한다 — 노드 평면화(`parent_node_id` 제거), 하위프로세스 참조 필드·대표 끝·엣지 핸들 추가, 프로세스 단위 검증과 순환 방지, 링크 해석·라이브러리 API.

**Architecture:** FastAPI + SQLAlchemy(async) + Pydantic. 스키마는 startup `create_all`(마이그레이션 없음) — 컬럼 변경 후 dev.db는 재시드. 그래프는 `(version)` 단위 평면 그래프로 단순화(기존 `(version, parent_node_id)` 스코프 폐기). 검증은 API 경계(`PUT /graph`)에서 수행.

**Tech Stack:** Python 3.10+ / FastAPI / SQLAlchemy 2 async / Pydantic v2 / pytest (`TestClient`, 격리 sqlite).

**스펙:** `docs/superpowers/specs/2026-06-20-subprocess-reference-model-design.md`

## Global Constraints

- 줄바꿈 LF 고정(`.gitattributes`). 한 줄 변경도 위반 금지.
- 타입 힌트 필수: `X | None`, `list[str]` 스타일(`rules/languages/python.md`).
- 입력 검증은 API 경계에서만(`rules/common/security.md`). 내부는 신뢰.
- 함수명은 동사로 시작(`rules/common/naming.md`).
- 새 기능엔 대응 테스트(`rules/common/testing.md`). 단위 테스트는 개발 중, 전체는 커밋 전.
- 테스트 실행(backend/ 에서): `.venv/bin/python -m pytest tests/ -q` · 린트 `.venv/bin/ruff check app/ tests/`
- 클린 브레이크: 기존 dev.db는 스키마 변경 후 재시드(컬럼 호환 불필요).

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `backend/app/models.py` | ORM — Node/Edge에 참조·대표끝·핸들 필드, `parent_node_id` 제거 | Modify |
| `backend/app/schemas.py` | Pydantic — NodeIn/EdgeIn 필드, 검증, 라이브러리/해석 응답 모델 | Modify |
| `backend/app/routers/graph.py` | 그래프 read/replace를 평면화 + 검증 호출 | Modify |
| `backend/app/subprocess.py` | 신규 — 검증(시작/끝/대표끝)·순환 탐지·링크 버전 해석 순수 함수 | Create |
| `backend/app/routers/library.py` | 신규 — 프로세스 라이브러리 목록 + 링크 해석 그래프 API | Create |
| `backend/app/main.py` | library 라우터 등록 | Modify |
| `backend/tests/test_subprocess.py` | 신규 — 검증·순환·해석 테스트 | Create |
| `backend/tests/test_graph.py` | 평면 그래프 회귀 테스트 보정 | Modify |

---

### Task 1: 스키마 — 노드 평면화 + 참조·대표끝·핸들 필드

**Files:**
- Modify: `backend/app/models.py` (Node, Edge)
- Modify: `backend/app/schemas.py` (NodeIn, EdgeIn, FlatNodeOut)
- Test: `backend/tests/test_graph.py`

**Interfaces:**
- Produces: `Node.linked_map_id: int | None`, `Node.follow_latest: bool`, `Node.linked_version_id: int | None`, `Node.is_primary_end: bool`, `Edge.source_handle: str | None`, `Edge.target_handle: str | None`. `NodeIn`/`EdgeIn`에 동일 필드. `node_type` 값에 `"subprocess"` 허용.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_graph.py` 끝에 추가

```python
def test_subprocess_and_handle_fields_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "s", "title": "시작", "node_type": "start", "sort_order": 0},
            {
                "id": "sub",
                "title": "결재",
                "node_type": "subprocess",
                "linked_map_id": 999,
                "follow_latest": True,
                "sort_order": 1,
            },
            {"id": "e", "title": "끝", "node_type": "end", "is_primary_end": True, "sort_order": 2},
        ],
        "edges": [
            {
                "id": "x1",
                "source_node_id": "sub",
                "target_node_id": "e",
                "source_handle": "__primary__",
            }
        ],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    sub = next(n for n in saved["nodes"] if n["id"] == "sub")
    assert sub["node_type"] == "subprocess"
    assert sub["linked_map_id"] == 999
    assert sub["follow_latest"] is True
    end = next(n for n in saved["nodes"] if n["id"] == "e")
    assert end["is_primary_end"] is True
    assert saved["edges"][0]["source_handle"] == "__primary__"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_graph.py::test_subprocess_and_handle_fields_roundtrip -q`
Expected: FAIL — 응답에 `linked_map_id`/`source_handle` 키 없음(또는 422).

- [ ] **Step 3: models.py 수정** — `Node`에 아래 필드 추가(기존 `group_ids` 다음 줄에). ※ `parent_node_id`는 **아직 제거하지 않는다**(graph.py가 아직 사용 — Task 2에서 graph.py 평면화와 함께 제거).

```python
    # 하위프로세스 노드(node_type="subprocess") — 다른 프로세스를 참조(Call Activity)
    linked_map_id: Mapped[int | None] = mapped_column(Integer, default=None)
    follow_latest: Mapped[bool] = mapped_column(Boolean, default=False)
    # follow_latest=False면 고정 버전. True면 무시하고 렌더 시 최신 발행본 해석.
    linked_version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    # 끝 노드(node_type="end") — 대표 끝(프로세스당 1개, 버전업에도 유지되는 주 출구)
    is_primary_end: Mapped[bool] = mapped_column(Boolean, default=False)
```

`Edge` 클래스의 `target_side` 다음에 추가:

```python
    # 다중 출구 식별 — 하위프로세스 노드의 끝별 출력 핸들 id(대표끝="__primary__", 그 외=끝 이름)
    source_handle: Mapped[str | None] = mapped_column(String(200), default=None)
    target_handle: Mapped[str | None] = mapped_column(String(200), default=None)
```

`Node`/`Edge`가 `Integer`,`Boolean`,`String`을 import하는지 확인 — 파일 상단 `from sqlalchemy import` 줄에 `Boolean`,`Integer`가 없으면 추가.

- [ ] **Step 4: schemas.py 수정** — `NodeIn`의 `group_ids` 필드 다음에 추가

```python
    # 하위프로세스 참조 (node_type="subprocess")
    linked_map_id: int | None = None
    follow_latest: bool = False
    linked_version_id: int | None = None
    # 대표 끝 (node_type="end")
    is_primary_end: bool = False
```

`EdgeIn`의 `target_side` 다음에 추가:

```python
    source_handle: str | None = None
    target_handle: str | None = None
```

`FlatNodeOut`의 `parent_node_id`는 Task 2(평면화)에서 제거 — 이 태스크에선 그대로 둔다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_graph.py::test_subprocess_and_handle_fields_roundtrip -q`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_graph.py
git commit -m "feat(backend): flatten nodes + subprocess reference/primary-end/handle fields — 노드 평면화·참조 필드"
```

---

### Task 2: 그래프 라우터 평면화 — `parent_node_id` 스코프 제거

**Files:**
- Modify: `backend/app/routers/graph.py`
- Test: `backend/tests/test_graph.py`

**Interfaces:**
- Consumes: Task 1의 평면 Node/Edge.
- Produces: `GET/PUT /api/versions/{id}/graph` 가 버전 전체 그래프(평면)를 다룬다. `parent` 쿼리 파라미터·`_load_scope`의 parent 분기 제거. `has_children`는 항상 False(계층 없음) — 또는 `FlatNodeOut`에서 필드 제거.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_graph.py`에 추가(parent 스코프가 사라졌음을 고정)

```python
def test_graph_is_flat_per_version(client: TestClient) -> None:
    version_id = _create_version(client)
    # 예전엔 parent 스코프로 분리됐던 노드들이 이제 한 평면에 공존
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    assert {n["id"] for n in saved["nodes"]} == {"a", "b", "c"}
    assert "has_children" not in saved["nodes"][0]  # 계층 개념 제거
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_graph.py::test_graph_is_flat_per_version -q`
Expected: FAIL — `has_children` 키 존재.

- [ ] **Step 3: graph.py의 `_load_scope`를 평면 `_load_graph`로 교체**

`_load_scope(session, version_id, parent_node_id)` 전체를 아래로 교체(파일에서 `parent_node_id` 사용처를 평면화):

```python
async def _load_graph(session: AsyncSession, version_id: int) -> GraphOut:
    node_rows = (
        await session.scalars(
            select(Node).where(Node.version_id == version_id).order_by(Node.sort_order)
        )
    ).all()
    node_ids = [n.id for n in node_rows]
    edges: list[EdgeIn] = []
    if node_ids:
        edge_rows = (
            await session.scalars(
                select(Edge).where(
                    Edge.version_id == version_id, Edge.source_node_id.in_(node_ids)
                )
            )
        ).all()
        edges = [EdgeIn.model_validate(e) for e in edge_rows]
    nodes = [
        NodeOut.model_validate(n).model_copy(update={"group_ids": _node_group_ids(n)})
        for n in node_rows
    ]
    group_rows = (
        await session.scalars(select(Group).where(Group.version_id == version_id))
    ).all()
    groups = [GroupIn.model_validate(g) for g in group_rows]
    return GraphOut(nodes=nodes, edges=edges, groups=groups)
```

- [ ] **Step 4: 평면화 마무리 + `parent_node_id` 제거** — ① `schemas.py`의 `NodeOut`을 `class NodeOut(NodeIn): pass`로(또는 `has_children` 줄 삭제), `FlatNodeOut`에서 `parent_node_id: str | None = None` 줄 삭제. ② `models.py`의 `Node`에서 `parent_node_id` 컬럼 줄 삭제(이제 graph.py가 더는 안 씀). ③ `GET`/`PUT` 핸들러에서 `parent` 쿼리 파라미터와 그 전달 인자를 제거하고 `_load_graph(session, version_id)` 호출로 바꾼다. PUT의 저장 로직도 parent 분기를 제거(버전의 모든 노드/엣지/그룹을 교체) — `Node.parent_node_id` 참조 줄을 전부 제거.

> 구현 주의: graph.py의 PUT 핸들러에서 기존 parent 스코프 기준 delete/insert를 **버전 단위 delete/insert**로 바꾼다. `Node.parent_node_id` 참조 줄을 모두 제거.

- [ ] **Step 5: 테스트 통과 + 기존 그래프 테스트 회귀 확인**

Run: `.venv/bin/python -m pytest tests/test_graph.py -q`
Expected: PASS (신규 + 기존 회귀). parent 스코프를 쓰던 기존 테스트가 있으면 평면 기준으로 보정.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/graph.py backend/app/schemas.py backend/tests/test_graph.py
git commit -m "refactor(backend): flat per-version graph (drop parent scope) — 그래프 평면화"
```

---

### Task 3: 프로세스 검증 — 시작 1개·끝 이름 유니크·대표끝 1개

**Files:**
- Create: `backend/app/subprocess.py`
- Modify: `backend/app/routers/graph.py` (PUT에서 검증 호출)
- Test: `backend/tests/test_subprocess.py`

**Interfaces:**
- Produces: `validate_process(nodes: list[NodeIn]) -> None` — 위반 시 `ValueError(메시지)`. 규칙: start 정확히 1개(노드가 있으면), end 이름 유니크, `is_primary_end` 끝은 ≤1개.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_subprocess.py` 생성

```python
"""하위프로세스 검증·순환·해석 테스트."""

from fastapi.testclient import TestClient


def _new_version(client: TestClient, name: str = "p") -> int:
    return client.post("/api/maps", json={"name": name}).json()["versions"][0]["id"]


def test_rejects_two_starts(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s1", "node_type": "start"},
                {"id": "s2", "node_type": "start"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "시작" in r.json()["detail"]


def test_rejects_duplicate_end_names(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "e1", "title": "종료", "node_type": "end"},
                {"id": "e2", "title": "종료", "node_type": "end"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "끝" in r.json()["detail"]


def test_accepts_valid_process(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "e1", "title": "승인", "node_type": "end", "is_primary_end": True},
                {"id": "e2", "title": "반려", "node_type": "end"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 200
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py -q`
Expected: FAIL — 422가 안 나옴(검증 미구현).

- [ ] **Step 3: `subprocess.py` 작성**

```python
"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석 (순수 함수)."""

from app.schemas import NodeIn


def validate_process(nodes: list[NodeIn]) -> None:
    """프로세스 그래프 규칙 검증 — 위반 시 ValueError. (spec §3.3)"""
    if not nodes:
        return
    starts = [n for n in nodes if n.node_type == "start"]
    if len(starts) != 1:
        raise ValueError(f"시작 노드는 정확히 1개여야 합니다 (현재 {len(starts)}개).")
    ends = [n for n in nodes if n.node_type == "end"]
    names = [e.title for e in ends]
    if len(names) != len(set(names)):
        raise ValueError("끝 노드 이름이 중복되었습니다 (끝 이름은 유니크해야 함).")
    primaries = [e for e in ends if e.is_primary_end]
    if len(primaries) > 1:
        raise ValueError(f"대표 끝은 1개여야 합니다 (현재 {len(primaries)}개).")
```

- [ ] **Step 4: graph.py PUT에서 검증 호출** — PUT 핸들러에서 저장 직전에

```python
from app.subprocess import validate_process
# ... PUT 핸들러 내부, body 파싱 후:
    try:
        validate_process(body.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py -q`
Expected: PASS (3개)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/subprocess.py backend/app/routers/graph.py backend/tests/test_subprocess.py
git commit -m "feat(backend): process validation (one start, unique end names, one primary end) — 프로세스 검증"
```

---

### Task 4: 순환 참조 방지

**Files:**
- Modify: `backend/app/subprocess.py` (순환 탐지)
- Modify: `backend/app/routers/graph.py` (PUT에서 호출)
- Test: `backend/tests/test_subprocess.py`

**Interfaces:**
- Consumes: Task 3의 `validate_process`.
- Produces: `async def assert_no_cycle(session, version_id, nodes) -> None` — 이 버전이 속한 맵을 다른 맵이 직접/간접 참조해 사이클이 생기면 `ValueError`. (이 버전의 subprocess 노드가 가리키는 맵들의 참조 클로저에 *현재 맵*이 들어가면 순환.)

- [ ] **Step 1: 실패하는 테스트 작성** — `test_subprocess.py`에 추가

```python
def _map_and_version(client: TestClient, name: str) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": name}).json()
    return created["id"], created["versions"][0]["id"]


def test_rejects_self_reference(client: TestClient) -> None:
    map_id, vid = _map_and_version(client, "selfref")
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "sub", "node_type": "subprocess", "linked_map_id": map_id},
                {"id": "e", "node_type": "end", "is_primary_end": True},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "순환" in r.json()["detail"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py::test_rejects_self_reference -q`
Expected: FAIL — 200이 나옴(순환 미검증).

- [ ] **Step 3: `subprocess.py`에 순환 탐지 추가**

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MapVersion, Node


async def assert_no_cycle(
    session: AsyncSession, version_id: int, nodes: list[NodeIn]
) -> None:
    """이 버전 저장이 참조 사이클을 만들면 ValueError. (spec §4)"""
    self_map_id = await session.scalar(
        select(MapVersion.map_id).where(MapVersion.id == version_id)
    )
    targets = {n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id}
    seen: set[int] = set()
    stack = list(targets)
    while stack:
        m = stack.pop()
        if m == self_map_id:
            raise ValueError("순환 참조입니다 — 자기 자신을 직접/간접 하위로 가져올 수 없습니다.")
        if m in seen:
            continue
        seen.add(m)
        # m 맵의 모든 버전 노드가 참조하는 맵들을 따라간다
        refs = (
            await session.scalars(
                select(Node.linked_map_id)
                .join(MapVersion, Node.version_id == MapVersion.id)
                .where(MapVersion.map_id == m, Node.linked_map_id.is_not(None))
            )
        ).all()
        stack.extend(r for r in refs if r is not None)
```

- [ ] **Step 4: graph.py PUT에서 호출** — `validate_process` 다음 줄에

```python
    from app.subprocess import assert_no_cycle  # 상단 import에 합쳐도 됨
    try:
        await assert_no_cycle(session, version_id, body.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py -q`
Expected: PASS (4개)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/subprocess.py backend/app/routers/graph.py backend/tests/test_subprocess.py
git commit -m "feat(backend): reject cyclic subprocess references — 순환 참조 차단"
```

---

### Task 5: 라이브러리 + 링크 해석 API

**Files:**
- Create: `backend/app/routers/library.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Modify: `backend/app/subprocess.py` (`resolve_linked_version`)
- Test: `backend/tests/test_subprocess.py`

**Interfaces:**
- Produces:
  - `GET /api/library/processes` → `[{map_id, name, latest_version_id, published_version_id}]` — 링크 가능한 프로세스 목록.
  - `GET /api/library/processes/{map_id}/resolved?follow_latest=&pinned=` → 해석된 버전의 평면 그래프(읽기전용 임베드용).
  - `async def resolve_linked_version(session, map_id, follow_latest, pinned_version_id) -> int | None`.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_subprocess.py`에 추가

```python
def test_library_lists_processes(client: TestClient) -> None:
    client.post("/api/maps", json={"name": "재사용 프로세스"})
    r = client.get("/api/library/processes")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "재사용 프로세스" in names


def test_resolved_returns_pinned_graph(client: TestClient) -> None:
    map_id, vid = _map_and_version(client, "lib-target")
    client.put(
        f"/api/versions/{vid}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}], "edges": []},
    )
    r = client.get(
        f"/api/library/processes/{map_id}/resolved",
        params={"follow_latest": "false", "pinned": vid},
    )
    assert r.status_code == 200
    assert [n["id"] for n in r.json()["nodes"]] == ["s"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py::test_library_lists_processes tests/test_subprocess.py::test_resolved_returns_pinned_graph -q`
Expected: FAIL — 404(라우터 없음).

- [ ] **Step 3: `subprocess.py`에 `resolve_linked_version` 추가**

```python
from app.models import ProcessMap  # 상단 import에 합치기


async def resolve_linked_version(
    session: AsyncSession,
    map_id: int,
    follow_latest: bool,
    pinned_version_id: int | None,
) -> int | None:
    """렌더할 버전 id 결정 — follow_latest면 최신 발행본, 아니면 고정. (spec §5)"""
    if not follow_latest and pinned_version_id is not None:
        return pinned_version_id
    published = await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id, MapVersion.status == "published")
        .order_by(MapVersion.id.desc())
    )
    if published is not None:
        return published
    return await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id)
        .order_by(MapVersion.id.desc())
    )
```

> 주의: `MapVersion.status` 컬럼명·발행 상태값("published")을 `models.py`에서 확인해 맞춘다. 다르면 그 값으로 교체.

- [ ] **Step 4: `library.py` 작성**

```python
"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapVersion, ProcessMap
from app.routers.graph import _load_graph
from app.subprocess import resolve_linked_version

router = APIRouter(
    prefix="/api/library", tags=["library"], dependencies=[Depends(get_current_user)]
)


@router.get("/processes")
async def list_processes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    maps = (await session.scalars(select(ProcessMap).order_by(ProcessMap.name))).all()
    out: list[dict] = []
    for m in maps:
        latest = await session.scalar(
            select(MapVersion.id)
            .where(MapVersion.map_id == m.id)
            .order_by(MapVersion.id.desc())
        )
        out.append({"map_id": m.id, "name": m.name, "latest_version_id": latest})
    return out


@router.get("/processes/{map_id}/resolved")
async def resolved_graph(
    map_id: int,
    follow_latest: bool = Query(False),
    pinned: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> object:
    version_id = await resolve_linked_version(session, map_id, follow_latest, pinned)
    if version_id is None:
        raise HTTPException(status_code=404, detail="해석할 버전이 없습니다.")
    return await _load_graph(session, version_id)
```

- [ ] **Step 5: `main.py`에 라우터 등록** — 기존 `app.include_router(...)` 모음에 추가

```python
from app.routers import library
app.include_router(library.router)
```

(기존 라우터 등록 패턴을 따른다 — `main.py`에서 다른 `include_router` 줄 위치 확인.)

- [ ] **Step 6: 테스트 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_subprocess.py -q`
Expected: PASS (6개)

- [ ] **Step 7: 전체 테스트 + 린트**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, 린트 클린.

- [ ] **Step 8: 커밋**

```bash
git add backend/app/routers/library.py backend/app/main.py backend/app/subprocess.py backend/tests/test_subprocess.py
git commit -m "feat(backend): process library + linked-version resolution API — 라이브러리·링크 해석"
```

---

## 다음 Plan (이 plan 완료 후 작성)

- **Plan 2/3 (프론트 렌더링·UX):** 라이브러리 드래그로 subprocess 노드 생성, 읽기전용 인라인 임베드(`/api/library/.../resolved` 로드), 렌더 폴리시(감싸기·크기 불변·"활성 영역만 이동"·카메라 보정) 재사용, 하위 *편집* 경로 제거, 다중 출구 핸들, 버전 업데이트 배지·알림.
- **Plan 3/3 (마이그레이션·데모):** 기존 중첩 데모 폐기, 새 모델 데모 재시드(평면 프로세스 다수 + 하위프로세스 링크·대표끝·분기 예시), dev.db 재생성.

## Self-Review

- **스펙 커버리지:** §3 데이터모델→Task1·2, §3.3 검증→Task3, §4 순환→Task4, §5 버전 해석→Task5, §6 렌더링/§7 생성 UX/§9 마이그레이션→Plan 2·3(명시). 백엔드 범위 누락 없음.
- **플레이스홀더:** 없음(모든 스텝에 실제 코드/명령). "주의" 메모는 기존 코드명 확인 지시로, 실행 시 1줄 확인.
- **타입 일관성:** `linked_map_id:int|None`·`follow_latest:bool`·`is_primary_end:bool`·`source_handle:str|None`·`validate_process(list[NodeIn])`·`assert_no_cycle(session,version_id,nodes)`·`resolve_linked_version(...)->int|None` — Task 간 시그니처 일치.
