# Consultant Hierarchy Phase 1 (schema + canonical + import script) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 컨설턴트 7단계 체계 전달물(canonical `categories.json` + `maps.jsonl`)을 멱등 업서트로 BPM에 적재하는 백엔드 스키마 + 파서 + 임포트 스크립트(dry-run/apply)를 만든다.

**Architecture:** 스펙은 `docs/design/2026-08-08-consultant-hierarchy-design.md`(§2 스키마, §4 계약, §5 임포트, §8 스케일). 순수 파서(`scripts/consultant_canonical.py`)와 DB 엔진+CLI(`scripts/import_consultant.py`)를 분리하고, 그래프는 **컨설턴트 코드에서 파생한 결정적 노드/엣지 id**로 빌드해 재임포트 시 버전 비교 화면의 diff 매칭이 성립하게 한다. 버전 게시는 기존 라우터 규칙(채번 = max(version_number)+1, 기존 published→expired, VersionEvent 기록)을 스크립트 안에서 그대로 재현하되 승인 워크플로·알림은 우회한다(부트스트랩 경로 — 2만 맵 알림 폭탄 방지 의도).

**Tech Stack:** Python 3.10+, SQLAlchemy async(`app.db.SessionLocal`), Pydantic v2, pytest(기존 `tests/conftest.py` client 픽스처), argparse CLI.

## Global Constraints

- **작업 위치**: 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-hierarchy` (브랜치 `feat/consultant-hierarchy`). 모든 경로는 이 워크트리 기준. 커밋 전 `pwd`·`git branch --show-current`로 위치 확인.
- **테스트 명령** (backend/ 에서): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_consultant_canonical.py tests/test_consultant_import.py -q` (개발 중 단건) / 마지막 태스크에서 `tests/ -q` 전체. 린트: `.venv/bin/ruff check app/ tests/ scripts/`.
- **워크트리엔 .venv가 없다** — Task 1 Step 0에서 생성한다.
- **신규 컬럼은 `app/db.py _ADDED_COLUMNS`에 반드시 등록** (운영 DB는 리셋 불가, 배포 시 자동 ALTER). 신규 테이블 `process_categories`는 create_all이 만들므로 등록 불요.
- **타임스탬프는 KST**: `from app.clock import now_kst`. duration 정규화는 `from app.duration import normalize_duration`(무효→None), 숫자 검증은 `from app.schemas import NUMERIC_RE`.
- **커밋 형식**: `type(scope): English summary — 한국어 요약` + 본문 마지막에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. **PROGRESS.md와 이 플랜 파일의 체크박스를 같은 커밋에 갱신**(rules/common/git.md).
- **주석은 why만**, 모듈 docstring 1줄 필수. 함수명은 동사 시작, 타입힌트 전체.
- **테스트 직원 시드는 `active=False`** — 활성 직원 행을 늘리면 공지 브로드캐스트 수신자 수 단언(test_notices 계열)이 오염된다(conftest `owning.anchor` 선례). known-department 검증·org 폴백은 active 무관이라 문제없다.
- **거버넌스 필드 vs 콘텐츠 필드 (스펙 §5의 플랜 확정)**: `owner_id`·MapPermission·MapApprover·`visibility`·`owning_department`는 **맵 생성 시에만** 세팅하고 재임포트는 건드리지 않는다(이양 후 거버넌스 소유). 재임포트가 갱신하는 건 콘텐츠 필드뿐: `name`·`category_id`·sp 파라미터/I/O·그래프(새 버전).

## File Structure

- Modify: `backend/app/models.py` — `ProcessCategory` 신설(테이블 `process_categories`), `ProcessMap`에 4컬럼(`category_id`·`consultant_code`·`sp_input`·`sp_output`)
- Modify: `backend/app/db.py` — `_ADDED_COLUMNS`에 process_maps 4엔트리
- Create: `backend/scripts/consultant_canonical.py` — canonical Pydantic 모델 + 로더(순수, DB 무관)
- Create: `backend/scripts/import_consultant.py` — 그래프 빌더 + 업서트 엔진 + 리포트 + CLI
- Create: `backend/tests/test_consultant_canonical.py`, `backend/tests/test_consultant_import.py`

---

### Task 1: 스키마 — ProcessCategory + ProcessMap 4컬럼

**Files:**
- Modify: `backend/app/models.py` (ProcessMap 클래스 끝 `doc_generated_at` 뒤, MapVersion 앞에 컬럼 추가 / `ProcessCategory`는 `ProcessMap` 클래스 **앞**에 정의 — FK 참조는 문자열이라 순서 무관하지만 가독성)
- Modify: `backend/app/db.py:81` (`_ADDED_COLUMNS` 리스트 끝)
- Test: `backend/tests/test_consultant_import.py` (스키마 스모크만 이 태스크에서)

**Interfaces:**
- Produces: `app.models.ProcessCategory` (id·code·name·level·parent_id·sort_order), `ProcessMap.category_id/consultant_code/sp_input/sp_output` — Task 4~6이 사용

- [x] **Step 0: venv 셋업** (워크트리 최초 1회)

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/consultant-hierarchy/backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

- [x] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_consultant_import.py` 신규

```python
"""컨설턴트 임포트 — 스키마·엔진 테스트. 설계: docs/design/2026-08-08-consultant-hierarchy-design.md"""

from fastapi.testclient import TestClient


def test_schema_has_consultant_columns(client: TestClient) -> None:
    # 신규 테이블·컬럼이 create_all로 생기고, 운영 ALTER 목록에도 등록돼 있는지(_ADDED_COLUMNS 누락 방지)
    import asyncio

    from sqlalchemy import text

    from app.db import _ADDED_COLUMNS, SessionLocal

    async def _check() -> None:
        async with SessionLocal() as session:
            await session.execute(text("SELECT id, code, name, level, parent_id, sort_order FROM process_categories"))
            await session.execute(text(
                "SELECT category_id, consultant_code, sp_input, sp_output FROM process_maps"
            ))

    asyncio.run(_check())
    added = {(t, c) for t, c, _ in _ADDED_COLUMNS}
    for col in ("category_id", "consultant_code", "sp_input", "sp_output"):
        assert ("process_maps", col) in added
```

- [x] **Step 2: 실패 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_consultant_import.py -q`
Expected: FAIL — `no such table: process_categories` (또는 no such column)

- [x] **Step 3: 모델 구현** — `app/models.py`

`ProcessMap` 클래스 직전에 추가:

```python
class ProcessCategory(Base):
    """컨설턴트 체계 카테고리(L1~L5) 트리 — code 기준 멱등 업서트, 빈 카테고리도 행으로 존재.

    설계: docs/design/2026-08-08-consultant-hierarchy-design.md §2.1
    """

    __tablename__ = "process_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(300))
    level: Mapped[int] = mapped_column(Integer)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("process_categories.id"), default=None
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

`ProcessMap`의 `doc_generated_at` 필드 뒤(relationship 정의 앞)에 추가:

```python
    # 컨설턴트 체계 (design 2026-08-08) — 체계 소속 판정=category_id 존재, 출처=consultant_code.
    # category_id는 모든 레벨 허용(리프=L6 업무 맵, 비-리프=오버뷰 맵 대표).
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("process_categories.id"), default=None
    )
    # L6 멱등 업서트 키 — 임포트된 맵만 non-null. 레거시 DB는 유니크 제약 없이 앱 계층에서 보장.
    consultant_code: Mapped[str | None] = mapped_column(String(200), unique=True, default=None)
    # L6 Input/Output — 자유 텍스트(구조화는 후속 승격) (design 2026-08-08 §2.2)
    sp_input: Mapped[str | None] = mapped_column(Text, default=None)
    sp_output: Mapped[str | None] = mapped_column(Text, default=None)
```

`app/db.py` `_ADDED_COLUMNS` 리스트 끝(`interview_sessions` 엔트리 뒤)에 추가:

```python
    # 컨설턴트 체계 수용 (design 2026-08-08) — process_categories는 신규 테이블이라 create_all이 처리.
    # 기존 DB의 consultant_code 유니크는 ALTER로 못 걸어 앱 계층(코드 기준 업서트)이 보장한다.
    ("process_maps", "category_id", "INTEGER"),
    ("process_maps", "consultant_code", "VARCHAR(200)"),
    ("process_maps", "sp_input", "TEXT"),
    ("process_maps", "sp_output", "TEXT"),
```

- [x] **Step 4: 통과 확인**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_consultant_import.py -q` → PASS.
주의: conftest가 `test_processmap.db`를 지우고 새로 만들므로 create_all에 신규 테이블 포함 확인이 곧 스모크다.

- [x] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check app/ tests/
cd .. && git add backend/app/models.py backend/app/db.py backend/tests/test_consultant_import.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): process_categories table + ProcessMap intake columns — 컨설턴트 체계 스키마(카테고리 트리·4컬럼)"
```

---

### Task 2: canonical 파서 — `scripts/consultant_canonical.py`

**Files:**
- Create: `backend/scripts/consultant_canonical.py`
- Test: `backend/tests/test_consultant_canonical.py`

**Interfaces:**
- Produces (Task 4~6이 사용):
  - `CanonicalCategory(code, name, level, parent)` · `CanonicalParams(duration, cost_krw, cost_usd, headcount, annual_count, fte, input, output — 전부 str="")` · `CanonicalNode(code, name, type, department, assignee, system, seq)` · `CanonicalEdge(source, target, label)` (JSON 키는 `from`/`to` alias) · `CanonicalLink(to_map, after_node)` · `CanonicalMap(code, name, category, owner, approvers, department, visibility, params, nodes, edges, links)`
  - `load_categories(path: Path) -> list[CanonicalCategory]` — 구조·중복코드·parent 존재·level=parent.level+1 검증, 위반 시 `CanonicalError`
  - `load_maps(path: Path) -> tuple[list[CanonicalMap], list[str]]` — jsonl 한 줄=한 맵. **한 줄 파싱/검증 실패는 전체를 죽이지 않고 에러 문자열(줄번호 포함)로 수집**, (정상 맵 리스트, 에러 리스트) 반환
  - `class CanonicalError(ValueError)`

- [x] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_consultant_canonical.py`

```python
"""canonical 전달물 파서 테스트 — DB 무관 순수 검증."""

import json
from pathlib import Path

import pytest

from scripts.consultant_canonical import (
    CanonicalError,
    CanonicalMap,
    load_categories,
    load_maps,
)


def write(path: Path, obj: object) -> Path:
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    return path


CATS = [
    {"code": "A", "name": "구매", "level": 1, "parent": None},
    {"code": "A1", "name": "직접구매", "level": 2, "parent": "A"},
]


def test_load_categories_ok(tmp_path: Path) -> None:
    cats = load_categories(write(tmp_path / "categories.json", {"categories": CATS}))
    assert [c.code for c in cats] == ["A", "A1"]
    assert cats[1].parent == "A"


def test_load_categories_rejects_bad_tree(tmp_path: Path) -> None:
    dup = {"categories": CATS + [{"code": "A", "name": "중복", "level": 1, "parent": None}]}
    with pytest.raises(CanonicalError, match="duplicate"):
        load_categories(write(tmp_path / "c1.json", dup))
    orphan = {"categories": [{"code": "B1", "name": "고아", "level": 2, "parent": "NOPE"}]}
    with pytest.raises(CanonicalError, match="parent"):
        load_categories(write(tmp_path / "c2.json", orphan))
    skip = {"categories": [CATS[0], {"code": "A9", "name": "레벨점프", "level": 3, "parent": "A"}]}
    with pytest.raises(CanonicalError, match="level"):
        load_categories(write(tmp_path / "c3.json", skip))


def make_map(**over: object) -> dict:
    base = {
        "code": "L6-01", "name": "원자재 구매", "category": "A1", "owner": "hong.gd",
        "approvers": ["kim.cs"], "department": "Div/Team", "visibility": "public",
        "params": {"duration": "1.30", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "승인", "type": "decision", "seq": 2},
        ],
        "edges": [{"from": "N1", "to": "N2", "label": ""}],
        "links": [{"to_map": "L6-02", "after_node": "N2"}],
    }
    base.update(over)
    return base


def test_load_maps_jsonl(tmp_path: Path) -> None:
    lines = [json.dumps(make_map()), "", json.dumps(make_map(code="L6-02", links=[]))]
    maps, errors = load_maps((tmp_path / "maps.jsonl").write_text("\n".join(lines), encoding="utf-8") and tmp_path / "maps.jsonl")
    assert errors == []
    assert [m.code for m in maps] == ["L6-01", "L6-02"]
    assert maps[0].edges[0].source == "N1"  # "from" alias 매핑
    assert maps[0].params.input == "PR"


def test_load_maps_collects_line_errors(tmp_path: Path) -> None:
    bad_edge = make_map(code="L6-03", edges=[{"from": "N1", "to": "GHOST"}])
    lines = [json.dumps(make_map()), "{broken json", json.dumps(bad_edge)]
    path = tmp_path / "maps.jsonl"
    path.write_text("\n".join(lines), encoding="utf-8")
    maps, errors = load_maps(path)
    assert [m.code for m in maps] == ["L6-01"]
    assert len(errors) == 2
    assert "line 2" in errors[0]
    assert "line 3" in errors[1] and "GHOST" in errors[1]


def test_map_validates_duplicate_node_codes() -> None:
    with pytest.raises(ValueError, match="duplicate node code"):
        CanonicalMap.model_validate(
            make_map(nodes=[{"code": "N1", "name": "a", "type": "process", "seq": 1},
                            {"code": "N1", "name": "b", "type": "process", "seq": 2}])
        )
```

- [x] **Step 2: 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_consultant_canonical.py -q`
Expected: FAIL — `ModuleNotFoundError: scripts.consultant_canonical`

- [x] **Step 3: 구현** — `backend/scripts/consultant_canonical.py`

```python
"""컨설턴트 canonical 전달물(categories.json + maps.jsonl) 파서 — DB 무관 순수 검증.

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §4. 어댑터가 기계 생성하는
계약이므로 구조 위반은 명확한 에러로, 값 수준(duration 등) 정규화는 엔진에서 경고로 다룬다.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator


class CanonicalError(ValueError):
    """전달물 구조 위반 — 파일 단위로 임포트를 중단시켜야 하는 오류."""


class CanonicalCategory(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    level: int = Field(ge=1, le=5)
    parent: str | None = None


class CanonicalParams(BaseModel):
    duration: str = ""
    cost_krw: str = ""
    cost_usd: str = ""
    headcount: str = ""
    annual_count: str = ""
    fte: str = ""
    input: str = ""
    output: str = ""


class CanonicalNode(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(max_length=200)
    type: Literal["process", "decision"] = "process"
    department: str = ""
    assignee: str = ""
    system: str = ""
    seq: int = 0


class CanonicalEdge(BaseModel):
    source: str = Field(alias="from")
    target: str = Field(alias="to")
    label: str = ""


class CanonicalLink(BaseModel):
    to_map: str
    after_node: str | None = None


class CanonicalMap(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    category: str
    owner: str = Field(min_length=1)
    approvers: list[str] = []
    department: str = ""
    visibility: Literal["public", "private"] = "public"
    params: CanonicalParams = CanonicalParams()
    nodes: list[CanonicalNode] = []
    edges: list[CanonicalEdge] = []
    links: list[CanonicalLink] = []

    @model_validator(mode="after")
    def _check_graph_refs(self) -> "CanonicalMap":
        codes = [n.code for n in self.nodes]
        seen: set[str] = set()
        for code in codes:
            if code in seen:
                raise ValueError(f"duplicate node code: {code}")
            seen.add(code)
        for edge in self.edges:
            for end in (edge.source, edge.target):
                if end not in seen:
                    raise ValueError(f"edge references unknown node: {end}")
        for link in self.links:
            if link.after_node is not None and link.after_node not in seen:
                raise ValueError(f"link.after_node unknown node: {link.after_node}")
        return self


def load_categories(path: Path) -> list[CanonicalCategory]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    try:
        cats = [CanonicalCategory.model_validate(c) for c in raw["categories"]]
    except (KeyError, ValidationError) as exc:
        raise CanonicalError(f"categories.json invalid: {exc}") from exc
    by_code: dict[str, CanonicalCategory] = {}
    for cat in cats:
        if cat.code in by_code:
            raise CanonicalError(f"duplicate category code: {cat.code}")
        by_code[cat.code] = cat
    for cat in cats:
        if cat.parent is None:
            if cat.level != 1:
                raise CanonicalError(f"category {cat.code}: level {cat.level} without parent")
            continue
        parent = by_code.get(cat.parent)
        if parent is None:
            raise CanonicalError(f"category {cat.code}: unknown parent {cat.parent}")
        if cat.level != parent.level + 1:
            raise CanonicalError(
                f"category {cat.code}: level {cat.level} under parent level {parent.level}"
            )
    return cats


def load_maps(path: Path) -> tuple[list[CanonicalMap], list[str]]:
    # 한 줄 오류가 전달분 전체를 죽이지 않게 수집 — 벌크 임포트 계약 (design §5.2)
    maps: list[CanonicalMap] = []
    errors: list[str] = []
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                maps.append(CanonicalMap.model_validate(json.loads(text)))
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                errors.append(f"line {lineno}: {exc}")
    return maps, errors
```

- [x] **Step 4: 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_consultant_canonical.py -q` → PASS (5개).

- [x] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check scripts/ tests/
git add backend/scripts/consultant_canonical.py backend/tests/test_consultant_canonical.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): canonical delivery parser (categories.json + maps.jsonl) — canonical 파서(줄단위 오류 수집)"
```

---

### Task 3: 그래프 빌더 — 결정적 id·Start/End 시드·연계 노드·레이아웃

**Files:**
- Create: `backend/scripts/import_consultant.py` (빌더 파트만 — 엔진·CLI는 Task 4~6에서 같은 파일에 추가)
- Test: `backend/tests/test_consultant_import.py` (append)

**Interfaces:**
- Consumes: Task 2의 `CanonicalMap` 계열
- Produces:
  - `make_node_id(map_code: str, node_code: str) -> str` — `"c" + sha1(f"{map_code}|{node_code}")[:24]` (≤25자, Node.id String(50) 안전). Start/End/연계는 가상 노드코드 `"__start__"`/`"__end__"`/`f"__link__{to_map}"` 사용 → **재임포트에도 id 불변 = 버전 비교 diff 매칭 성립**
  - `make_edge_id(map_code: str, src_code: str, dst_code: str) -> str` — `"e" + sha1(...)[:24]`
  - `build_graph_rows(cmap: CanonicalMap, link_targets: dict[str, tuple[int, CanonicalParams]]) -> tuple[list[Node], list[Edge], list[str]]` — version_id 미지정 ORM 객체(호출자가 채움) + 경고 리스트. `link_targets`는 to_map code → (map_id, 대상 맵 params)

**빌드 규칙 (스펙 §4·§5 확정 + 플랜 상세):**
1. Start/End 노드 자동 시드(End는 `is_primary_end=True`).
2. L7 노드: `title=name`, `node_type=type`, department/assignee/system 그대로, `sort_order=seq` 정렬 순 인덱스. **파라미터 없음**(L6 전용 계약).
3. 엣지 없으면 seq 순 체인. 엣지가 있으면 그대로 쓰되 **indegree-0 L7 노드 전부에 Start→엣지, outdegree-0 L7 노드 전부에 →End 엣지**를 추가한다(체인·분기 공통 규칙).
4. 연계(link): `node_type="subprocess"`, `title=대상 이름은 엔진이 세팅`(빌더는 to_map code를 title 폴백), `linked_map_id`, `follow_latest=True`, **`annual_count`/`fte`=대상 맵 params에서 시드**(부모 맥락 계약 — design §4). 부착 엣지: `after_node` 지정 시 그 노드→연계, 생략 시 최대 seq 노드→연계(End 배선은 건드리지 않는 병렬 분기).
5. 좌표: Kahn 토폴로지 순서로 rank(=max(선행 rank)+1) 계산, `pos_x = 120 + rank*240`, `pos_y = 200 + (rank 내 순번)*120`. 사이클로 남은 노드는 rank=max+1부터 순차 배정(전량 배치 보장).

- [x] **Step 1: 실패하는 테스트 작성** — `test_consultant_import.py`에 append

```python
def _canonical_map(**over: object):
    from scripts.consultant_canonical import CanonicalMap

    base = {
        "code": "L6-01", "name": "원자재 구매", "category": "A1", "owner": "cons.owner",
        "approvers": ["cons.appr"], "department": "Consult Div/Consult Team",
        "params": {"duration": "1.30", "annual_count": "12", "fte": "0.5", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "발주", "type": "process", "seq": 2},
        ],
        "edges": [], "links": [],
    }
    base.update(over)
    return CanonicalMap.model_validate(base)


def test_build_graph_rows_chain_and_ids() -> None:
    from scripts.consultant_canonical import CanonicalParams
    from scripts.import_consultant import build_graph_rows, make_node_id

    nodes, edges, warnings = build_graph_rows(_canonical_map(), link_targets={})
    assert warnings == []
    by_type = {}
    for n in nodes:
        by_type.setdefault(n.node_type, []).append(n)
    assert len(by_type["start"]) == 1 and len(by_type["end"]) == 1
    assert by_type["end"][0].is_primary_end is True
    # 결정적 id — 같은 입력이면 재실행에도 동일 (버전 비교 매칭의 핵심)
    assert by_type["process"][0].id == make_node_id("L6-01", "N1")
    nodes2, _, _ = build_graph_rows(_canonical_map(), link_targets={})
    assert sorted(n.id for n in nodes) == sorted(n.id for n in nodes2)
    # 체인: Start→N1→N2→End
    pairs = {(e.source_node_id, e.target_node_id) for e in edges}
    n1, n2 = make_node_id("L6-01", "N1"), make_node_id("L6-01", "N2")
    start_id, end_id = make_node_id("L6-01", "__start__"), make_node_id("L6-01", "__end__")
    assert pairs == {(start_id, n1), (n1, n2), (n2, end_id)}
    # 레이아웃 — rank가 x로 단조 증가
    xs = {n.id: n.pos_x for n in nodes}
    assert xs[start_id] < xs[n1] < xs[n2] < xs[end_id]


def test_build_graph_rows_link_node_seeds_params() -> None:
    from scripts.consultant_canonical import CanonicalParams
    from scripts.import_consultant import build_graph_rows, make_node_id

    cmap = _canonical_map(links=[{"to_map": "L6-02", "after_node": "N1"}])
    target_params = CanonicalParams(annual_count="7", fte="1.5")
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={"L6-02": (99, target_params)})
    sp = next(n for n in nodes if n.node_type == "subprocess")
    assert sp.linked_map_id == 99 and sp.follow_latest is True
    assert sp.annual_count == "7" and sp.fte == "1.5"
    assert sp.id == make_node_id("L6-01", "__link__L6-02")
    pairs = {(e.source_node_id, e.target_node_id) for e in edges}
    assert (make_node_id("L6-01", "N1"), sp.id) in pairs


def test_build_graph_rows_missing_link_target_warns() -> None:
    from scripts.import_consultant import build_graph_rows

    cmap = _canonical_map(links=[{"to_map": "GHOST"}])
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={})
    assert not any(n.node_type == "subprocess" for n in nodes)
    assert any("GHOST" in w for w in warnings)
```

- [x] **Step 2: 실패 확인**

Run: `.venv/bin/python -m pytest tests/test_consultant_import.py -q`
Expected: 기존 스키마 테스트 PASS + 신규 3건 FAIL (`ModuleNotFoundError: scripts.import_consultant`)

- [x] **Step 3: 구현** — `backend/scripts/import_consultant.py` 신규

```python
"""컨설턴트 canonical 전달물 임포트 — 멱등 업서트·버전 적재/게시·SP 지정 (dry-run/apply).

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §5·§8. 승인 워크플로·알림은
부트스트랩 경로로 의도적으로 우회한다(오너 이양 전 대량 알림 방지).

실행 (backend/ 에서, 기본 dry-run):
    bash:       .venv/bin/python -m scripts.import_consultant <delivery_dir> [--apply]
    PowerShell: .venv\\Scripts\\python -m scripts.import_consultant <delivery_dir> [--apply]
"""

import hashlib

from app.models import Edge, Node
from scripts.consultant_canonical import CanonicalMap, CanonicalParams

_X_STEP = 240  # rank 간 가로 간격(px) — create_map Start/End 시드(120→480)와 동일 리듬
_Y_STEP = 120  # rank 내 세로 간격(px)


def make_node_id(map_code: str, node_code: str) -> str:
    # 컨설턴트 코드에서 파생한 결정적 id — 재임포트에도 불변이라 버전 비교 diff가 노드를 매칭한다
    return "c" + hashlib.sha1(f"{map_code}|{node_code}".encode()).hexdigest()[:24]


def make_edge_id(map_code: str, src_code: str, dst_code: str) -> str:
    return "e" + hashlib.sha1(f"{map_code}|{src_code}|{dst_code}".encode()).hexdigest()[:24]


def _compute_ranks(codes: list[str], pairs: list[tuple[str, str]]) -> dict[str, int]:
    """Kahn 토폴로지 순서로 rank(=max(선행)+1). 사이클 잔여 노드는 뒤 rank로 순차 배정(전량 배치)."""
    indeg = {c: 0 for c in codes}
    out: dict[str, list[str]] = {c: [] for c in codes}
    for src, dst in pairs:
        out[src].append(dst)
        indeg[dst] += 1
    rank = {c: 0 for c in codes}
    queue = [c for c in codes if indeg[c] == 0]
    seen: list[str] = []
    while queue:
        cur = queue.pop(0)
        seen.append(cur)
        for nxt in out[cur]:
            rank[nxt] = max(rank[nxt], rank[cur] + 1)
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    leftover = [c for c in codes if c not in seen]
    base = (max(rank[c] for c in seen) + 1) if seen and leftover else 0
    for i, code in enumerate(leftover):
        rank[code] = base + i
    return rank


def build_graph_rows(
    cmap: CanonicalMap,
    link_targets: dict[str, tuple[int, CanonicalParams]],
) -> tuple[list[Node], list[Edge], list[str]]:
    """canonical 맵 1건 → Node/Edge ORM 행(version_id는 호출자가 채움) + 경고."""
    warnings: list[str] = []
    ordered = sorted(cmap.nodes, key=lambda n: (n.seq, n.code))
    l7_codes = [n.code for n in ordered]

    # 흐름 엣지 — 명시 엣지 없으면 seq 체인, 있으면 그대로 + Start/End 보강
    flow: list[tuple[str, str, str]] = (
        [(e.source, e.target, e.label) for e in cmap.edges]
        if cmap.edges
        else [(a, b, "") for a, b in zip(l7_codes, l7_codes[1:])]
    )
    has_in = {dst for _, dst, _ in flow}
    has_out = {src for src, _, _ in flow}
    start, end = "__start__", "__end__"
    for code in l7_codes:
        if code not in has_in:
            flow.append((start, code, ""))
        if code not in has_out:
            flow.append((code, end, ""))

    # 연계 노드 — after_node 뒤(생략 시 최대 seq 노드 뒤) 병렬 분기, End 배선 불변 (design §4)
    link_rows: list[tuple[str, str, int, CanonicalParams]] = []  # (가상코드, 부착원점, map_id, params)
    for link in cmap.links:
        target = link_targets.get(link.to_map)
        if target is None:
            warnings.append(f"{cmap.code}: link target not in delivery/DB: {link.to_map}")
            continue
        attach = link.after_node or (l7_codes[-1] if l7_codes else start)
        link_rows.append((f"__link__{link.to_map}", attach, target[0], target[1]))
    for virtual, attach, _, _ in link_rows:
        flow.append((attach, virtual, ""))

    all_codes = [start, *l7_codes, *[v for v, *_ in link_rows], end]
    ranks = _compute_ranks(all_codes, [(s, d) for s, d, _ in flow])
    row_in_rank: dict[int, int] = {}

    def place(code: str) -> tuple[float, float]:
        r = ranks[code]
        row = row_in_rank.get(r, 0)
        row_in_rank[r] = row + 1
        return 120 + r * _X_STEP, 200 + row * _Y_STEP

    nodes: list[Node] = []
    sx, sy = place(start)
    nodes.append(Node(id=make_node_id(cmap.code, start), title="Start", node_type="start", pos_x=sx, pos_y=sy, sort_order=0))
    for i, cn in enumerate(ordered, start=1):
        x, y = place(cn.code)
        nodes.append(Node(
            id=make_node_id(cmap.code, cn.code), title=cn.name, node_type=cn.type,
            department=cn.department, assignee=cn.assignee, system=cn.system,
            pos_x=x, pos_y=y, sort_order=i,
        ))
    for j, (virtual, _, map_id, params) in enumerate(link_rows):
        x, y = place(virtual)
        nodes.append(Node(
            id=make_node_id(cmap.code, virtual), title=virtual.removeprefix("__link__"),
            node_type="subprocess", linked_map_id=map_id, follow_latest=True,
            annual_count=params.annual_count, fte=params.fte,
            pos_x=x, pos_y=y, sort_order=len(ordered) + 1 + j,
        ))
    ex, ey = place(end)
    nodes.append(Node(
        id=make_node_id(cmap.code, end), title="End", node_type="end",
        is_primary_end=True, pos_x=ex, pos_y=ey, sort_order=len(nodes),
    ))

    edges = [
        Edge(
            id=make_edge_id(cmap.code, src, dst),
            source_node_id=make_node_id(cmap.code, src),
            target_node_id=make_node_id(cmap.code, dst),
            label=label,
        )
        for src, dst, label in flow
    ]
    return nodes, edges, warnings
```

- [x] **Step 4: 통과 확인**

Run: `.venv/bin/python -m pytest tests/test_consultant_import.py tests/test_consultant_canonical.py -q` → 전부 PASS.

- [x] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check scripts/ tests/
git add backend/scripts/import_consultant.py backend/tests/test_consultant_import.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): deterministic graph builder for canonical maps — 결정적 id 그래프 빌더(Start/End·연계·레이아웃)"
```

---

### Task 4: 카테고리 업서트 + 오우닝 부서 해석

**Files:**
- Modify: `backend/scripts/import_consultant.py` (append)
- Test: `backend/tests/test_consultant_import.py` (append)

**Interfaces:**
- Consumes: Task 1 `ProcessCategory`, Task 2 `CanonicalCategory`
- Produces:
  - `async upsert_categories(session: AsyncSession, cats: list[CanonicalCategory]) -> dict[str, int]` — code→category_id. 멱등: code 존재 시 name/level/parent/sort_order 갱신, 없으면 생성. sort_order는 입력 순번. level 오름차순 2-pass로 parent_id 해석
  - `async build_known_departments(session: AsyncSession) -> set[str]` — `_assert_known_department`(app/routers/maps.py:96)와 동일 규약: 직원 org_l1~l5 전 prefix의 "/" 조인 집합
  - `async resolve_owning_department(session, known: set[str], dept: str, owner: str) -> tuple[str | None, str | None]` — (org_path|None, 경고|None). 1순위 dept∈known → 2순위 owner의 Employee org 경로 → 실패 시 (None, 경고) (design §5.3)

- [x] **Step 1: 실패하는 테스트 작성** — append. 테스트 직원은 **active=False**로 시드(Global Constraints 참조).

```python
def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _seed_import_employees() -> None:
    from app.db import SessionLocal
    from app.models import Employee

    async def _seed() -> None:
        async with SessionLocal() as session:
            for login, org in (("cons.owner", ("Consult Div", "Consult Team")), ("cons.appr", ())):
                if await session.get(Employee, login) is None:
                    orgs = dict(zip(("org_l1", "org_l2"), org))
                    session.add(Employee(login_id=login, name=login, source="local", active=False, **orgs))
            await session.commit()

    _run(_seed())


def test_upsert_categories_idempotent(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory
    from scripts.consultant_canonical import CanonicalCategory
    from scripts.import_consultant import upsert_categories

    cats = [
        CanonicalCategory(code="A", name="구매", level=1, parent=None),
        CanonicalCategory(code="A1", name="직접구매", level=2, parent="A"),
    ]

    async def _twice() -> tuple[dict, dict, list]:
        async with SessionLocal() as session:
            first = await upsert_categories(session, cats)
            await session.commit()
        cats[1].name = "직접구매(개정)"
        async with SessionLocal() as session:
            second = await upsert_categories(session, cats)
            await session.commit()
            rows = (await session.scalars(select(ProcessCategory).order_by(ProcessCategory.code))).all()
        return first, second, rows

    first, second, rows = _run(_twice())
    assert first == second  # 같은 code → 같은 id (멱등)
    assert [r.code for r in rows] == ["A", "A1"]
    assert rows[1].name == "직접구매(개정)" and rows[1].parent_id == first["A"]


def test_resolve_owning_department(client) -> None:
    from app.db import SessionLocal
    from scripts.import_consultant import build_known_departments, resolve_owning_department

    _seed_import_employees()

    async def _resolve() -> list:
        async with SessionLocal() as session:
            known = await build_known_departments(session)
            return [
                await resolve_owning_department(session, known, "Consult Div/Consult Team", "cons.owner"),
                await resolve_owning_department(session, known, "Nope/Nowhere", "cons.owner"),
                await resolve_owning_department(session, known, "", "cons.appr"),
            ]

    direct, fallback, none = _run(_resolve())
    assert direct == ("Consult Div/Consult Team", None)
    assert fallback[0] == "Consult Div/Consult Team" and "fallback" in (fallback[1] or "")
    assert none[0] is None and none[1] is not None
```

- [x] **Step 2: 실패 확인** — `pytest tests/test_consultant_import.py -q` → 신규 2건 FAIL (ImportError).

- [x] **Step 3: 구현** — `import_consultant.py`에 append

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, ProcessCategory
from scripts.consultant_canonical import CanonicalCategory


async def upsert_categories(
    session: AsyncSession, cats: list[CanonicalCategory]
) -> dict[str, int]:
    """code 기준 멱등 업서트 — 개명 안전. 반환: code→id (parent 해석용)."""
    existing = {
        c.code: c for c in (await session.scalars(select(ProcessCategory))).all()
    }
    ids: dict[str, int] = {}
    for order, cat in enumerate(sorted(cats, key=lambda c: c.level)):
        row = existing.get(cat.code)
        parent_id = ids.get(cat.parent) if cat.parent else None
        if row is None:
            row = ProcessCategory(code=cat.code, name=cat.name, level=cat.level,
                                  parent_id=parent_id, sort_order=order)
            session.add(row)
            await session.flush()
            existing[cat.code] = row
        else:
            row.name, row.level, row.parent_id, row.sort_order = cat.name, cat.level, parent_id, order
        ids[cat.code] = row.id
    return ids


async def build_known_departments(session: AsyncSession) -> set[str]:
    # routers/maps._assert_known_department와 동일 규약 — 직원 org 전 prefix의 "/" 조인
    rows = (
        await session.execute(
            select(Employee.org_l1, Employee.org_l2, Employee.org_l3,
                   Employee.org_l4, Employee.org_l5)
        )
    ).all()
    known: set[str] = set()
    for levels in rows:
        parts = [lv for lv in levels if lv]
        for i in range(1, len(parts) + 1):
            known.add("/".join(parts[:i]))
    return known


async def resolve_owning_department(
    session: AsyncSession, known: set[str], dept: str, owner: str
) -> tuple[str | None, str | None]:
    """canonical department → 오너 org 폴백 → (None, 경고) (design §5.3)."""
    dept = dept.strip()
    if dept and dept in known:
        return dept, None
    employee = await session.get(Employee, owner)
    parts = (
        [lv for lv in (employee.org_l1, employee.org_l2, employee.org_l3,
                       employee.org_l4, employee.org_l5) if lv]
        if employee else []
    )
    if parts:
        path = "/".join(parts)
        note = f"department {dept!r} unknown — fallback to owner org {path!r}" if dept else None
        if not dept:
            note = f"department empty — fallback to owner org {path!r}"
        return path, note
    return None, f"department {dept!r} unknown and owner {owner!r} has no org — left NULL"
```

- [x] **Step 4: 통과 확인** — `pytest tests/test_consultant_import.py tests/test_consultant_canonical.py -q` → PASS.

- [x] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check scripts/ tests/
git add backend/scripts/import_consultant.py backend/tests/test_consultant_import.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): category upsert + owning department resolution — 카테고리 멱등 업서트·오우닝 부서 해석"
```

---

### Task 5: 맵 업서트 엔진 — 버전 적재/게시·SP 지정·변경 감지

**Files:**
- Modify: `backend/scripts/import_consultant.py` (append)
- Test: `backend/tests/test_consultant_import.py` (append)

**Interfaces:**
- Consumes: Task 3 `build_graph_rows`, Task 4 전부, `app.version_events.record_version_event(session, version_id, event_type, actor, note=None)`, `app.clock.now_kst`, `app.duration.normalize_duration`, `app.schemas.NUMERIC_RE`
- Produces:
  - `@dataclass ImportReport` — `rows: list[tuple[str, str, str]]`(map_code, action∈{created,updated,unchanged,error,warning}, detail), `counts() -> dict[str, int]`
  - `async import_delivery(session, *, categories, maps, actor: str, label: str) -> ImportReport` — 전체 파이프라인(2-pass). **commit은 하지 않는다** — 호출자(Task 6 `run_import`)가 apply/dry-run에 따라 commit/rollback

**엔진 규칙 (스펙 §5 + Global Constraints의 거버넌스/콘텐츠 분리):**
1. `upsert_categories` → pass 1: 전체 canonical 맵의 code로 기존 `ProcessMap.consultant_code` 결착, 신규는 맵 껍데기 생성(+flush로 id 확보) → `link_targets` 완성 → pass 2: 그래프·버전.
2. 신규 맵: `ProcessMap(name, created_by=actor, owner_id=cmap.owner, visibility, owning_department=해석값, category_id, consultant_code=cmap.code)` + owner `MapPermission(role="owner", granted_by=actor)` + `MapApprover(user_id=..., assigned_by=actor)` rows.
3. 기존 맵: 콘텐츠 필드만 갱신(name·category_id·sp 파라미터) — owner/visibility/owning_department/approvers는 불변(리포트 detail에 유지 사실 기록 불요, 조용히 스킵).
4. 값 정규화(경고 수집): duration → `normalize_duration` 무효 시 `""`+warning row. cost_krw/usd 동시 입력 → usd 버리고 warning. headcount/annual_count/fte → `NUMERIC_RE` 불일치 시 `""`+warning.
5. 변경 감지: 최신 published 버전의 그래프 시그니처 vs 빌드 결과 시그니처 + 맵 콘텐츠 필드 비교. 시그니처는 **pos 제외**(레이아웃은 diff 대상 아님):
   `nodes: sorted((id, title, node_type, department, assignee, system, linked_map_id, annual_count, fte, is_primary_end))` / `edges: sorted((source_node_id, target_node_id, label))`.
   published 없거나 시그니처 다름 → 새 `MapVersion(label=label, status="draft")` 생성+flush → 노드/엣지에 version_id 채워 add → 게시(아래 6). 같으면 그래프는 스킵(맵 필드만 바뀌면 action="updated" detail="map fields only").
6. 게시(라우터 publish_version과 동일 규칙, 승인 우회): `version_number = max(기존)+1`, 같은 맵의 published → `"expired"` + `record_version_event(..., "expired", actor)`, 새 버전 `"published"` + events `"created"`·`"published"` 기록. **알림 없음**(의도 — 모듈 docstring에 명기됨).
7. SP 지정: `sp_designated_at`(None일 때만 now_kst), `sp_department=canonical department 원문(빈 값이면 owning 해석값, 그마저 없으면 "" + warning)`, `sp_duration/sp_cost_krw/sp_cost_usd/sp_headcount` 정규화값, `sp_input/sp_output`, `sp_changed_by=actor`, `sp_changed_at=now_kst()`.
8. action 판정: 신규=created / 그래프 or 맵 필드 변경=updated / 완전 동일=unchanged.

- [ ] **Step 1: 실패하는 테스트 작성** — append (핵심 5 시나리오)

```python
def _delivery(maps=None):
    from scripts.consultant_canonical import CanonicalCategory

    cats = [
        CanonicalCategory(code="A", name="구매", level=1, parent=None),
        CanonicalCategory(code="A1", name="직접구매", level=2, parent="A"),
    ]
    return cats, maps if maps is not None else [_canonical_map()]


async def _import_once(maps=None, label="Consultant import"):
    from app.db import SessionLocal
    from scripts.import_consultant import import_delivery

    cats, cmaps = _delivery(maps)
    async with SessionLocal() as session:
        report = await import_delivery(session, categories=cats, maps=cmaps, actor="admin.sys", label=label)
        await session.commit()
    return report


def test_initial_import_creates_published_map(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapApprover, MapPermission, MapVersion, Node, ProcessMap

    _seed_import_employees()
    report = _run(_import_once())
    assert report.counts() == {"created": 1}

    async def _load():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            v = (await session.scalars(select(MapVersion).where(MapVersion.map_id == m.id))).one()
            nodes = (await session.scalars(select(Node).where(Node.version_id == v.id))).all()
            perms = (await session.scalars(select(MapPermission).where(MapPermission.map_id == m.id))).all()
            apprs = (await session.scalars(select(MapApprover).where(MapApprover.map_id == m.id))).all()
        return m, v, nodes, perms, apprs

    m, v, nodes, perms, apprs = _run(_load())
    assert m.owner_id == "cons.owner" and m.owning_department == "Consult Div/Consult Team"
    assert m.category_id is not None and m.visibility == "public"
    assert m.sp_designated_at is not None and m.sp_input == "PR" and m.sp_output == "PO"
    assert m.sp_duration == "1.30"
    assert v.status == "published" and v.version_number == 1
    assert {n.node_type for n in nodes} == {"start", "process", "end"}
    assert [(p.principal_id, p.role) for p in perms] == [("cons.owner", "owner")]
    assert [a.user_id for a in apprs] == ["cons.appr"]


def test_reimport_unchanged_is_noop(client) -> None:
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()
    _run(_import_once())
    report = _run(_import_once())
    assert report.counts() == {"unchanged": 1}

    async def _count():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            return await session.scalar(select(func.count()).select_from(MapVersion).where(MapVersion.map_id == m.id))

    assert _run(_count()) == 1  # 새 버전 없음


def test_reimport_changed_publishes_new_version(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    _seed_import_employees()
    _run(_import_once())
    changed = _canonical_map()
    changed.nodes[0].name = "요청(개정)"
    report = _run(_import_once(maps=[changed], label="Delivery 2"))
    assert report.counts() == {"updated": 1}

    async def _versions():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            return (await session.scalars(
                select(MapVersion).where(MapVersion.map_id == m.id).order_by(MapVersion.id)
            )).all()

    versions = _run(_versions())
    assert [v.status for v in versions] == ["expired", "published"]
    assert versions[1].version_number == 2  # 현업 편집 있어도 같은 규칙 — 아무것도 안 막는다


def test_reimport_preserves_governance_fields(client) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap

    _seed_import_employees()
    _run(_import_once())

    async def _handover():
        async with SessionLocal() as session:
            m = (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()
            m.owner_id = "someone.else"  # 이양 후 거버넌스 변경 시뮬레이션
            m.visibility = "private"
            await session.commit()

    _run(_handover())
    changed = _canonical_map(name="이름 개정")
    _run(_import_once(maps=[changed]))

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code == "L6-01"))).one()

    m = _run(_load())
    assert m.owner_id == "someone.else" and m.visibility == "private"  # 거버넌스 불변
    assert m.name == "이름 개정"  # 콘텐츠는 갱신


def test_param_normalization_warnings(client) -> None:
    _seed_import_employees()
    bad = _canonical_map(code="L6-77", params={"duration": "about 3 days", "cost_krw": "100", "cost_usd": "1"})
    report = _run(_import_once(maps=[bad]))
    warnings = [r for r in report.rows if r[1] == "warning"]
    assert any("duration" in w[2] for w in warnings)
    assert any("cost" in w[2] for w in warnings)
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_consultant_import.py -q` → 신규 5건 FAIL (ImportError: import_delivery).

- [ ] **Step 3: 구현** — `import_consultant.py`에 append. 위 엔진 규칙 1~8 그대로. 뼈대:

```python
from dataclasses import dataclass, field

from sqlalchemy import func

from app.clock import now_kst
from app.duration import normalize_duration
from app.models import MapApprover, MapPermission, MapVersion, ProcessMap
from app.schemas import NUMERIC_RE
from app.version_events import record_version_event


@dataclass
class ImportReport:
    rows: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, map_code: str, action: str, detail: str = "") -> None:
        self.rows.append((map_code, action, detail))

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for _, action, _ in self.rows:
            if action != "warning":
                out[action] = out.get(action, 0) + 1
        return out


def _normalize_params(cmap: CanonicalMap, report: ImportReport) -> CanonicalParams:
    p = cmap.params.model_copy()
    if p.duration:
        normalized = normalize_duration(p.duration)
        if normalized is None:
            report.add(cmap.code, "warning", f"invalid duration {p.duration!r} dropped")
            p.duration = ""
        else:
            p.duration = normalized
    if p.cost_krw.strip() and p.cost_usd.strip():
        report.add(cmap.code, "warning", "both cost_krw and cost_usd set — cost_usd dropped")
        p.cost_usd = ""
    for name in ("cost_krw", "cost_usd", "headcount", "annual_count", "fte"):
        value = getattr(p, name).strip()
        if value and not NUMERIC_RE.fullmatch(value):
            report.add(cmap.code, "warning", f"invalid {name} {value!r} dropped")
            value = ""
        setattr(p, name, value)
    return p


def _graph_signature(nodes: list[Node], edges: list[Edge]) -> tuple:
    return (
        sorted((n.id, n.title, n.node_type, n.department, n.assignee, n.system,
                n.linked_map_id, n.annual_count, n.fte, bool(n.is_primary_end)) for n in nodes),
        sorted((e.source_node_id, e.target_node_id, e.label) for e in edges),
    )


async def _latest_published(session: AsyncSession, map_id: int) -> MapVersion | None:
    return await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == map_id, MapVersion.status == "published")
        .order_by(MapVersion.version_number.desc())
        .limit(1)
    )


async def _publish(session: AsyncSession, map_id: int, version: MapVersion, actor: str) -> None:
    # routers/versions.publish_version과 동일 규칙 — 채번·기존 게시본 expired·이벤트. 승인·알림은 우회.
    max_num = await session.scalar(
        select(func.max(MapVersion.version_number)).where(MapVersion.map_id == map_id)
    )
    version.version_number = (max_num or 0) + 1
    prior = await session.scalars(
        select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.status == "published")
    )
    for p in prior:
        p.status = "expired"
        record_version_event(session, p.id, "expired", actor)
    version.status = "published"
    record_version_event(session, version.id, "published", actor)


async def import_delivery(
    session: AsyncSession,
    *,
    categories: list[CanonicalCategory],
    maps: list[CanonicalMap],
    actor: str,
    label: str,
) -> ImportReport:
    """전달분 1건 임포트 — commit은 호출자 책임(dry-run=rollback, apply=commit)."""
    report = ImportReport()
    category_ids = await upsert_categories(session, categories)
    known = await build_known_departments(session)

    existing = {
        m.consultant_code: m
        for m in (
            await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code.is_not(None))
            )
        ).all()
    }
    # pass 1 — 맵 껍데기 확보(신규 생성 포함) → link_targets 완성
    created: set[str] = set()
    for cmap in maps:
        if cmap.category not in category_ids:
            report.add(cmap.code, "error", f"unknown category {cmap.category}")
            continue
        if cmap.code in existing:
            continue
        owning, note = await resolve_owning_department(session, known, cmap.department, cmap.owner)
        if note:
            report.add(cmap.code, "warning", note)
        new_map = ProcessMap(
            name=cmap.name, created_by=actor, owner_id=cmap.owner,
            visibility=cmap.visibility, owning_department=owning,
            category_id=category_ids[cmap.category], consultant_code=cmap.code,
        )
        session.add(new_map)
        await session.flush()
        session.add(MapPermission(map_id=new_map.id, principal_type="user",
                                  principal_id=cmap.owner, role="owner", granted_by=actor))
        for approver in dict.fromkeys(cmap.approvers):
            session.add(MapApprover(map_id=new_map.id, user_id=approver, assigned_by=actor))
        existing[cmap.code] = new_map
        created.add(cmap.code)

    # 연계 대상 = 이번 전달분 + 이전 전달분에만 있는 기존 맵(증분 전달 케이스).
    # DB-only 대상은 canonical params가 없어 annual/fte 시드는 공백(경고 불요 — 부모 맥락 값이라 후속 편집 몫).
    link_targets: dict[str, tuple[int, CanonicalParams]] = {
        code: (m.id, CanonicalParams()) for code, m in existing.items()
    }
    for cmap in maps:
        if cmap.code in existing:
            link_targets[cmap.code] = (existing[cmap.code].id, cmap.params)

    # pass 2 — 그래프·버전·SP 지정
    errored = {r[0] for r in report.rows if r[1] == "error"}
    for cmap in maps:
        if cmap.code in errored:
            continue
        found_map = existing[cmap.code]
        params = _normalize_params(cmap, report)
        nodes, edges, warnings = build_graph_rows(cmap, link_targets)
        for w in warnings:
            report.add(cmap.code, "warning", w)
        # 연계 노드 title을 대상 맵 이름으로 교체(빌더는 code 폴백) — DB-only 대상 포함
        names = {code: m.name for code, m in existing.items()}
        names.update({m.code: m.name for m in maps})
        for n in nodes:
            if n.node_type == "subprocess" and n.title in names:
                n.title = names[n.title]

        latest = await _latest_published(session, found_map.id)
        graph_changed = True
        if latest is not None:
            old_nodes = (await session.scalars(select(Node).where(Node.version_id == latest.id))).all()
            old_edges = (await session.scalars(select(Edge).where(Edge.version_id == latest.id))).all()
            graph_changed = _graph_signature(old_nodes, old_edges) != _graph_signature(nodes, edges)

        fields_changed = (
            found_map.name != cmap.name
            or found_map.category_id != category_ids[cmap.category]
            or (found_map.sp_input or "") != params.input
            or (found_map.sp_output or "") != params.output
            or (found_map.sp_duration or "") != params.duration
            or (found_map.sp_cost_krw or "") != params.cost_krw
            or (found_map.sp_cost_usd or "") != params.cost_usd
            or (found_map.sp_headcount or "") != params.headcount
        )
        # 콘텐츠 필드 갱신 — 거버넌스 필드(owner·visibility·owning_department·approvers)는 불변
        found_map.name = cmap.name
        found_map.category_id = category_ids[cmap.category]
        sp_department = cmap.department.strip() or found_map.owning_department or ""
        if not sp_department:
            report.add(cmap.code, "warning", "sp_department empty")
        if found_map.sp_designated_at is None:
            found_map.sp_designated_at = now_kst()
        found_map.sp_department = sp_department
        found_map.sp_duration = params.duration
        found_map.sp_cost_krw = params.cost_krw
        found_map.sp_cost_usd = params.cost_usd
        found_map.sp_headcount = params.headcount
        found_map.sp_input = params.input
        found_map.sp_output = params.output
        found_map.sp_changed_by = actor
        found_map.sp_changed_at = now_kst()

        if graph_changed:
            version = MapVersion(map_id=found_map.id, label=label, status="draft")
            session.add(version)
            await session.flush()
            record_version_event(session, version.id, "created", actor)
            for row in (*nodes, *edges):
                row.version_id = version.id
                session.add(row)
            await _publish(session, found_map.id, version, actor)

        if cmap.code in created:
            report.add(cmap.code, "created", f"published v{1 if graph_changed else 0}")
        elif graph_changed or fields_changed:
            report.add(cmap.code, "updated", "graph" if graph_changed else "map fields only")
        else:
            report.add(cmap.code, "unchanged", "")
    return report
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_consultant_import.py tests/test_consultant_canonical.py -q` → 전부 PASS. 시나리오 간 DB 공유(세션 스코프 sqlite) 주의 — 맵 code가 겹치는 테스트는 같은 맵에 업서트되므로 각 테스트의 단언은 위 코드처럼 code 필터로 조회한다.

- [ ] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check scripts/ tests/
git add backend/scripts/import_consultant.py backend/tests/test_consultant_import.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): map upsert engine with version publish + SP designation — 맵 업서트 엔진(버전 게시·SP 지정·변경 감지)"
```

---

### Task 6: dry-run/apply + 리포트 CSV + CLI + 청크 커밋

**Files:**
- Modify: `backend/scripts/import_consultant.py` (append)
- Test: `backend/tests/test_consultant_import.py` (append)

**Interfaces:**
- Consumes: Task 2 `load_categories`/`load_maps`, Task 5 `import_delivery`/`ImportReport`
- Produces:
  - `async run_import(delivery_dir: Path, *, apply: bool, actor: str, label: str, report_path: Path | None) -> ImportReport` — 파일 로드→`import_delivery`→apply면 commit/dry-run이면 rollback→CSV 기록. `load_maps`의 줄 에러는 `("-", "error", ...)` 행으로 리포트에 편입
  - CLI: `python -m scripts.import_consultant <delivery_dir> [--apply] [--actor consultant-import] [--label "Consultant import"] [--report path.csv]` — **기본 dry-run**(안전). stdout에 counts 요약 + warning/error 상위 20건
- **스케일 노트 (design §8)**: 청크 커밋은 `import_delivery`가 아닌 apply 경로에서 맵 N건마다 `session.commit()`을 걸 수 있도록 `import_delivery`에 `commit_every: int | None = None` 파라미터를 추가한다(pass 2 루프에서 `apply`시 200건마다 commit — dry-run은 None이라 단일 트랜잭션→rollback). 테스트는 `commit_every=1`로 경로만 검증(20k 성능 벤치는 범위 밖 — 서버 실측으로 미룸을 리포트에 명기).

- [ ] **Step 1: 실패하는 테스트 작성** — append

```python
def _write_delivery(tmp_path, maps):
    import json

    (tmp_path / "categories.json").write_text(json.dumps({"categories": [
        {"code": "A", "name": "구매", "level": 1, "parent": None},
        {"code": "A1", "name": "직접구매", "level": 2, "parent": "A"},
    ]}, ensure_ascii=False), encoding="utf-8")
    lines = [json.dumps(m, ensure_ascii=False) for m in maps]
    (tmp_path / "maps.jsonl").write_text("\n".join(lines), encoding="utf-8")
    return tmp_path


def _raw_map(code="L6-DRY"):
    return {
        "code": code, "name": f"드라이런 {code}", "category": "A1", "owner": "cons.owner",
        "nodes": [{"code": "N1", "name": "요청", "type": "process", "seq": 1}],
    }


def test_dry_run_writes_nothing_but_reports(client, tmp_path) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap
    from scripts.import_consultant import run_import

    _seed_import_employees()
    delivery = _write_delivery(tmp_path, [_raw_map()])
    report_path = tmp_path / "report.csv"
    report = _run(run_import(delivery, apply=False, actor="admin.sys",
                             label="DRY", report_path=report_path))
    assert report.counts() == {"created": 1}
    assert "created" in report_path.read_text(encoding="utf-8")

    async def _absent():
        async with SessionLocal() as session:
            return (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == "L6-DRY")
            )).first()

    assert _run(_absent()) is None  # rollback — DB 무변경


def test_apply_persists_and_line_errors_reported(client, tmp_path) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap
    from scripts.import_consultant import run_import

    _seed_import_employees()
    delivery = _write_delivery(tmp_path, [_raw_map("L6-APPLY")])
    (tmp_path / "maps.jsonl").write_text(
        (tmp_path / "maps.jsonl").read_text(encoding="utf-8") + "\n{broken", encoding="utf-8"
    )
    report = _run(run_import(delivery, apply=True, actor="admin.sys", label="APPLY", report_path=None))
    assert report.counts()["created"] == 1
    assert any(action == "error" for _, action, _ in report.rows)  # 깨진 줄 편입

    async def _present():
        async with SessionLocal() as session:
            return (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == "L6-APPLY")
            )).one()

    assert _run(_present()).name == "드라이런 L6-APPLY"
```

- [ ] **Step 2: 실패 확인** — FAIL (ImportError: run_import).

- [ ] **Step 3: 구현** — append

```python
import argparse
import asyncio
import csv
from datetime import date

from app.db import SessionLocal


async def run_import(
    delivery_dir: Path,
    *,
    apply: bool,
    actor: str,
    label: str,
    report_path: Path | None,
) -> ImportReport:
    """전달 디렉터리 임포트 — 기본 dry-run(rollback). apply=True만 영속."""
    categories = load_categories(delivery_dir / "categories.json")
    maps, line_errors = load_maps(delivery_dir / "maps.jsonl")
    async with SessionLocal() as session:
        report = await import_delivery(
            session, categories=categories, maps=maps, actor=actor, label=label,
            commit_every=200 if apply else None,
        )
        if apply:
            await session.commit()
        else:
            await session.rollback()
    for err in line_errors:
        report.add("-", "error", err)
    if report_path is not None:
        with report_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(["map_code", "action", "detail"])
            writer.writerows(report.rows)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Import consultant canonical delivery")
    parser.add_argument("delivery_dir", type=Path)
    parser.add_argument("--apply", action="store_true", help="write to DB (default: dry-run)")
    parser.add_argument("--actor", default="consultant-import")
    parser.add_argument("--label", default=f"Consultant {date.today().isoformat()}")
    parser.add_argument("--report", type=Path, default=None, help="detail CSV path")
    args = parser.parse_args()
    report = asyncio.run(run_import(
        args.delivery_dir, apply=args.apply, actor=args.actor,
        label=args.label, report_path=args.report,
    ))
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"{mode}  " + ", ".join(f"{k}={v}" for k, v in sorted(report.counts().items())))
    issues = [r for r in report.rows if r[1] in ("warning", "error")]
    for map_code, action, detail in issues[:20]:
        print(f"{action:8} {map_code}: {detail}")
    if len(issues) > 20:
        print(f"... {len(issues) - 20} more (use --report for full CSV)")


if __name__ == "__main__":
    main()
```

그리고 `import_delivery` 시그니처에 `commit_every: int | None = None`을 추가하고, pass 2 루프 끝에서:

```python
        if commit_every is not None and (index + 1) % commit_every == 0:
            await session.commit()  # 스케일 대응 — 20k 맵 단일 트랜잭션 방지 (design §8)
```

(pass 2 `for` 루프를 `for index, cmap in enumerate(maps):`로 바꾼다. Task 5 테스트는 commit_every 미지정이라 무영향.)

- [ ] **Step 4: 통과 확인** — `pytest tests/test_consultant_import.py tests/test_consultant_canonical.py -q` → 전부 PASS.

- [ ] **Step 5: 린트 + 커밋**

```bash
.venv/bin/ruff check scripts/ tests/
git add backend/scripts/import_consultant.py backend/tests/test_consultant_import.py PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "feat(consultant): dry-run/apply CLI with CSV report + chunked commits — CLI(dry-run 기본·CSV 리포트·청크 커밋)"
```

---

### Task 7: 전체 게이트 + 마무리

**Files:**
- Modify: `PROGRESS.md`, 이 플랜 파일(체크박스)

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: 전체 그린(기존 ~884 + 신규 ~15). 기존 테스트가 깨지면 원인 파악 먼저 — 특히 활성 직원 수 단언(test_notices 계열)이 깨지면 임포트 테스트 시드의 active=False 누락이다.

- [ ] **Step 2: 린트 전체**

Run: `.venv/bin/ruff check app/ tests/ scripts/` → 0 오류.

- [ ] **Step 3: PROGRESS.md 정리 + 최종 커밋**

PROGRESS.md 2026-08-08 섹션에 Phase 1 완료 요약(스키마·파서·엔진·CLI·테스트 수) 추가, 플랜 체크박스 전체 갱신 후:

```bash
git add PROGRESS.md docs/superpowers/plans/2026-08-08-consultant-import-phase1.md
git commit -m "docs(consultant): Phase 1 gates green — Phase 1 게이트 완료 기록"
```

미검증 잔여(정직하게 보고): 20k 스케일 실측 벤치(서버), postgres 실배포 ALTER 확인, 실제 컨설턴트 스키마 어댑터(Phase 3), 홈 UI 노출(Phase 2).
