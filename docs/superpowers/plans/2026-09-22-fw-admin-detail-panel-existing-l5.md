# Categories & import 상세 패널 + 기존 L5 학습·정정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage 뷰를 "좌 트리 : 우 선택-행 상세 패널(액션·AI L5·임포트 버튼)"로 재구성하고, AI L5 캠페인이 이미 등록된 L6 맵을 불러와 학습하며 카드 단위로 유지/정정을 고르게 한다.

**Architecture:** 백엔드는 `framework_interview/existing.py`(맵 → 인터뷰 행 역변환, 기존 맵 스냅샷, 계획 카드 병합)를 추가하고 세션에 `existing` JSON, 태스크에 `mode`(new|keep|revise)를 더한다. keep 태스크는 잠금 시 곧바로 drawn(기존 행), revise 태스크는 프롬프트에 현재 내용을 실어 설문·드로잉한다. 프론트는 관리자 패널을 선택 기반 상세 패널로 다시 짜고(아코디언 폐기), 세션 화면 계획/보드에 기존 칩·유지/정정 전환을 얹는다.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2(Python 3.11 문법만), Next.js/React/Tailwind 토큰, vitest, Playwright(`playwright-core` + 시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-22-fw-admin-detail-panel-existing-l5-design.md`

## Global Constraints

- Python 3.11 문법만(`backend/ruff.toml target-version py311`). PEP 695 등 금지.
- 새 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS` 등록 필수(운영 DB 자동 ALTER).
- UI 문구·프롬프트·매뉴얼에 긴 대시(—) 금지. UI 영어 기본, i18n en/ko 동시 추가(`frontend/src/lib/i18n-messages.ts`).
- 색은 토큰만(raw hex 금지). 아이콘 Lucide 14/16 strokeWidth 1.5. 굵기 300/400/600.
- 인터랙티브 요소 `data-id`(`surface-role` kebab, 리스트는 키 접미).
- 인터뷰 JSON 0.5 키 집합 불변(3표면 규칙). `rows[]` 키는 어댑터 `_ROW_KEYS/_FIELD_KEYS/_ACTION_KEYS` 안에서만.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 갱신 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트: backend `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `ruff check app/ tests/`; frontend `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`.
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 복합 Bash(`cd a && b | c`)는 harness가 거부할 수 있으니 단순 명령으로 나눈다. 광범위 `pkill` 금지.
- 컴포넌트 추가·삭제 시 `frontend/`에서 `node scripts/build-component-catalog.mjs` 재생성.

---

### Task 1: 기존 맵 역변환·스냅샷·카드 병합 (`existing.py`)

**Files:**
- Create: `backend/app/framework_interview/existing.py`
- Test: `backend/tests/test_framework_interview_existing.py`

**Interfaces:**
- Consumes: `app.models.ProcessMap/MapVersion/Node/Edge`, `app.workflow.PUBLISHED/DRAFT`, `scripts.consultant_interview.EXCEPTION_VARIANT_COLOR`(지연 import), `app.framework_interview.assemble.validate_row/load_category_chain`.
- Produces:
  - `def map_to_row(map_name: str, owning_department: str | None, nodes: list[Node], edges: list[Edge]) -> dict`
  - `async def load_existing_l6(db: AsyncSession, category_id: int) -> list[dict]` → `[{"map_id", "code", "name", "summary", "activities": [str], "row": dict}]`
  - `def merge_existing_cards(cards: list[dict], existing: list[dict]) -> list[dict]`
  - `def existing_row_of(existing: list[dict] | None, code: str) -> dict | None`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_framework_interview_existing.py`

```python
"""기존 L6 맵 → 인터뷰 행 역변환 + 계획 카드 병합 (spec 2026-09-22 §2.1·§2.3)."""

import asyncio
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.framework_interview.assemble import build_document, load_category_chain, validate_row
from app.framework_interview.existing import existing_row_of, load_existing_l6, map_to_row, merge_existing_cards
from app.models import Edge, MapVersion, Node, ProcessMap

HEADERS = {"X-Dev-User": "admin.sys"}

ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착", "done_criteria": "접수증 발급"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action", "name": "요청서 내용 확인", "rule": "양식 A", "system": "ERP"},
        {"seq": 2, "label": "완결성 판정", "kind": "decision"},
        {"seq": 3, "label": "접수 등록", "kind": "action", "variant": "exception"},
        {"seq": 4, "label": "부서 전달", "kind": "handoff", "input": "접수증", "output": "전달 메일"},
    ],
    "relations": {"edges": [
        {"src": 1, "dst": 2, "kind": "seq"},
        {"src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "완결"},
        {"src": 2, "dst": 1, "kind": "loop", "condition": "보완 필요"},
        {"src": 3, "dst": 4, "kind": "seq"},
    ]},
}


def _make_l5(client: TestClient, tag: str) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    return node["id"]


def _import_row(client: TestClient, l5_id: int, row: dict, task_id: str) -> None:
    async def _chain() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)
    chain = asyncio.run(_chain())
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    doc = build_document(chain, l5, [{"taskId": task_id, **row}], None, label="t", session_id=0)
    res = client.post("/api/categories/import-interview", headers=HEADERS,
                      json={"files": [{"name": "a.json", "content": json.dumps(doc, ensure_ascii=False)}], "apply": True})
    assert res.status_code == 200, res.text
    assert res.json()["ok"] is True, res.json()


def test_map_to_row_round_trips_imported_map(client: TestClient) -> None:
    l5_id = _make_l5(client, "ex")

    async def _code() -> str:
        async with SessionLocal() as db:
            chain = await load_category_chain(db, l5_id)
            return chain[-1]["code"]
    task_id = f"{asyncio.run(_code())}-01"
    _import_row(client, l5_id, ROW, task_id)

    async def _load() -> list[dict]:
        async with SessionLocal() as db:
            return await load_existing_l6(db, l5_id)
    existing = asyncio.run(_load())
    assert [e["code"] for e in existing] == [task_id]
    got = existing[0]
    assert got["name"] == "요청 접수"
    assert got["activities"] == ["요청 확인", "완결성 판정", "접수 등록", "부서 전달"]
    row = got["row"]
    assert row["l6"] == "요청 접수"
    assert row["ownerRole"] == "담당자"
    assert [(a["seq"], a["label"], a["kind"]) for a in row["actions"]] == [
        (1, "요청 확인", "action"), (2, "완결성 판정", "decision"), (3, "접수 등록", "action"), (4, "부서 전달", "handoff")]
    assert row["actions"][0]["name"] == "요청서 내용 확인"
    assert row["actions"][0]["rule"] == "양식 A"
    assert row["actions"][0]["system"] == "ERP"
    assert row["actions"][2]["variant"] == "exception"
    assert row["actions"][3]["input"] == "접수증" and row["actions"][3]["output"] == "전달 메일"
    kinds = {(e["src"], e["dst"]): e["kind"] for e in row["relations"]["edges"]}
    assert kinds[(1, 2)] == "seq" and kinds[(2, 3)] == "branch" and kinds[(2, 1)] == "loop" and kinds[(3, 4)] == "seq"
    branch = next(e for e in row["relations"]["edges"] if (e["src"], e["dst"]) == (2, 3))
    assert branch["condition"] == "완결" and branch["gateway"] == "exclusive"

    async def _issues() -> list[dict]:
        async with SessionLocal() as db:
            chain = await load_category_chain(db, l5_id)
            return validate_row(chain, {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}, {"taskId": task_id, **row})
    assert [i for i in asyncio.run(_issues()) if i["severity"] == "error"] == []
    assert existing_row_of(existing, task_id) is row
    assert existing_row_of(existing, "nope") is None


def test_load_existing_skips_trashed_and_codeless_maps(client: TestClient) -> None:
    l5_id = _make_l5(client, "ex2")

    async def _seed() -> None:
        async with SessionLocal() as db:
            from app.clock import now
            trashed = ProcessMap(name="trashed", category_id=l5_id, consultant_code="ex2-trash", deleted_at=now())
            codeless = ProcessMap(name="manual", category_id=l5_id, consultant_code=None)
            db.add_all([trashed, codeless])
            await db.commit()
    asyncio.run(_seed())

    async def _load() -> list[dict]:
        async with SessionLocal() as db:
            return await load_existing_l6(db, l5_id)
    assert asyncio.run(_load()) == []


def test_map_to_row_pure_shape() -> None:
    # 순수 함수 검증(DB 없음): 게시본 선택은 load_existing_l6 몫이고 map_to_row는 노드/엣지만 본다
    nodes = [
        Node(id="s", version_id=1, title="Start", node_type="start", sort_order=0),
        Node(id="a", version_id=1, title="A", node_type="process", sort_order=1, description="이름\n\nRule: r1\nKind: handoff"),
        Node(id="b", version_id=1, title="B", node_type="decision", sort_order=2),
        Node(id="c", version_id=1, title="C", node_type="process", sort_order=3, color="#c2849a", assignee_role="검토자"),
        Node(id="e", version_id=1, title="End", node_type="end", sort_order=4),
    ]
    edges = [
        Edge(id="1", version_id=1, source_node_id="s", target_node_id="a"),
        Edge(id="2", version_id=1, source_node_id="a", target_node_id="b"),
        Edge(id="3", version_id=1, source_node_id="b", target_node_id="c", label="예", gateway="exclusive"),
        Edge(id="4", version_id=1, source_node_id="b", target_node_id="a", label="아니오"),
        Edge(id="5", version_id=1, source_node_id="c", target_node_id="e"),
    ]
    row = map_to_row("맵", "품질팀", nodes, edges)
    assert row["department"] == "품질팀" and row["ownerRole"] == "검토자"
    assert [a["kind"] for a in row["actions"]] == ["handoff", "decision", "action"]
    assert row["actions"][0]["name"] == "이름" and row["actions"][0]["rule"] == "r1"
    assert row["actions"][2]["variant"] == "exception"
    # 엣지는 (src seq, dst seq) 순으로 정렬돼 나온다
    assert [(e["src"], e["dst"], e["kind"]) for e in row["relations"]["edges"]] == [
        (1, 2, "seq"), (2, 1, "loop"), (2, 3, "branch")]


def test_merge_existing_cards_keeps_every_existing_map_once() -> None:
    existing = [
        {"map_id": 1, "code": "x-01", "name": "접수", "summary": "s1", "activities": ["a"], "row": {}},
        {"map_id": 2, "code": "x-02", "name": "검토", "summary": "s2", "activities": ["b"], "row": {}},
    ]
    cards = [
        {"name": "검토 ", "summary": "", "owner_role": "", "department": "", "depends_on": [], "mode": "revise", "existing_code": "x-02"},
        {"name": "신규", "summary": "", "owner_role": "", "department": "", "depends_on": [], "existing_code": "ghost"},
        {"name": "접수", "summary": "", "owner_role": "", "department": "", "depends_on": []},
    ]
    merged = merge_existing_cards(cards, existing)
    by_name = {c["name"].strip(): c for c in merged}
    assert by_name["접수"]["mode"] == "keep" and by_name["접수"]["existing_code"] == "x-01"
    assert by_name["검토"]["mode"] == "revise" and by_name["검토"]["existing_code"] == "x-02"
    assert by_name["신규"]["mode"] == "new" and by_name["신규"]["existing_code"] is None
    assert len(merged) == 3

    # 기존 카드를 지워도 되살아난다(앞쪽, 기존 순서)
    merged2 = merge_existing_cards([{"name": "신규", "summary": "", "owner_role": "", "department": "", "depends_on": []}], existing)
    assert [c["name"] for c in merged2] == ["접수", "검토", "신규"]
    assert merged2[0]["mode"] == "keep" and merged2[0]["summary"] == "s1"
```

- [ ] **Step 2: 실패 확인** — `backend/`에서 `.venv/bin/python -m pytest tests/test_framework_interview_existing.py -q` → ImportError.

- [ ] **Step 3: 구현** — `backend/app/framework_interview/existing.py`

```python
"""기존 L6 맵 학습 — 맵 → 인터뷰 행 역변환, 세션 시작 스냅샷, 계획 카드 병합 (spec 2026-09-22 §2)."""

from collections import Counter

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import Edge, MapVersion, Node, ProcessMap

SUMMARY_MAX = 300
ACTIVITY_TYPES = {"process", "decision"}
# 어댑터 format_node_description의 KV 접두 — 역변환 시 같은 표를 쓴다(consultant_interview._ACTION_FIELD_LABELS)
_KV_KEYS = {"Rule": "rule", "Screen": "screen", "Quote": "quote"}


def _split_description(text: str) -> tuple[str, dict[str, str]]:
    """설명 = name 줄들 + 빈 줄 + 'Label: value' 줄들 (adapter format_node_description)."""
    name_lines: list[str] = []
    kv: dict[str, str] = {}
    in_kv = False
    for line in (text or "").splitlines():
        if not in_kv and line.strip() == "":
            in_kv = True
            continue
        label, sep, value = line.partition(": ")
        if in_kv and sep and label in {*_KV_KEYS, "Variant", "Kind"}:
            kv[label] = value.strip()
        elif not in_kv:
            name_lines.append(line)
        # kv 구간의 알 수 없는 줄은 버린다(사람이 에디터에서 덧붙인 메모) — 정정 설문이 다시 묻는다
    return "\n".join(name_lines).strip(), kv


def map_to_row(map_name: str, owning_department: str | None, nodes: list[Node], edges: list[Edge]) -> dict:
    from scripts.consultant_interview import EXCEPTION_VARIANT_COLOR  # 지연 import — 스크립트 패키지

    activity = sorted((n for n in nodes if n.node_type in ACTIVITY_TYPES), key=lambda n: (n.sort_order, n.id))
    seq_of = {n.id: i for i, n in enumerate(activity, start=1)}
    actions: list[dict] = []
    for n in activity:
        name, kv = _split_description(n.description)
        action: dict = {"seq": seq_of[n.id], "label": n.title or f"step {seq_of[n.id]}"}
        if n.node_type == "decision":
            action["kind"] = "decision"
        elif kv.get("Kind") == "handoff":
            action["kind"] = "handoff"
        else:
            action["kind"] = "action"
        if name:
            action["name"] = name
        for label, key in _KV_KEYS.items():
            if kv.get(label):
                action[key] = kv[label]
        if kv.get("Variant") == "exception" or (n.color or "").lower() == EXCEPTION_VARIANT_COLOR:
            action["variant"] = "exception"
        for key in ("input", "output", "system"):
            value = getattr(n, key) or ""
            if value.strip():
                action[key] = value.strip()
        actions.append(action)

    roles = Counter(n.assignee_role for n in activity if (n.assignee_role or "").strip())
    fields: dict = {}
    if activity and (activity[0].start_condition or "").strip():
        fields["start_condition"] = activity[0].start_condition.strip()
    if activity and (activity[-1].end_condition or "").strip():
        fields["done_criteria"] = activity[-1].end_condition.strip()

    rel_edges: list[dict] = []
    by_id = {n.id: n for n in activity}
    for e in sorted(edges, key=lambda e: (seq_of.get(e.source_node_id, 0), seq_of.get(e.target_node_id, 0))):
        if e.source_node_id not in seq_of or e.target_node_id not in seq_of:
            continue
        src, dst = seq_of[e.source_node_id], seq_of[e.target_node_id]
        label = (e.label or "").strip()
        if dst < src:
            item = {"src": src, "dst": dst, "kind": "loop"}
            if label:
                item["condition"] = label
        elif by_id[e.source_node_id].node_type == "decision":
            item = {"src": src, "dst": dst, "kind": "branch", "gateway": e.gateway or "exclusive"}
            if label:
                item["condition"] = label
        else:
            item = {"src": src, "dst": dst, "kind": "seq"}
            if label:
                item["label"] = label
        rel_edges.append(item)

    row: dict = {
        "l6": map_name,
        "ownerRole": roles.most_common(1)[0][0] if roles else "",
        "department": owning_department or "",
        "fields": fields,
        "actions": actions,
    }
    if rel_edges:
        row["relations"] = {"edges": rel_edges}
    return row


async def _pick_version(db: AsyncSession, map_id: int) -> MapVersion | None:
    for status in (workflow.PUBLISHED, workflow.DRAFT):
        row = (await db.scalars(
            select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.status == status)
            .order_by(MapVersion.id.desc())
        )).first()
        if row is not None:
            return row
    return None


async def load_existing_l6(db: AsyncSession, category_id: int) -> list[dict]:
    """L5 아래 이미 등록된 L6 맵 스냅샷 — 휴지통·코드 없는 맵 제외, 게시본 우선."""
    maps = (await db.scalars(
        select(ProcessMap).where(
            ProcessMap.category_id == category_id,
            ProcessMap.deleted_at.is_(None),
            ProcessMap.consultant_code.is_not(None),
        ).order_by(ProcessMap.consultant_code)
    )).all()
    out: list[dict] = []
    for m in maps:
        version = await _pick_version(db, m.id)
        if version is None:
            continue
        nodes = list((await db.scalars(select(Node).where(Node.version_id == version.id))).all())
        edges = list((await db.scalars(select(Edge).where(Edge.version_id == version.id))).all())
        row = map_to_row(m.name, m.owning_department, nodes, edges)
        out.append({
            "map_id": m.id, "code": m.consultant_code, "name": m.name,
            "summary": (m.description or "").strip()[:SUMMARY_MAX],
            "activities": [a["label"] for a in row["actions"]],
            "row": row,
        })
    return out


def existing_row_of(existing: list[dict] | None, code: str) -> dict | None:
    for item in existing or []:
        if item.get("code") == code:
            return item.get("row")
    return None


def merge_existing_cards(cards: list[dict], existing: list[dict]) -> list[dict]:
    """기존 맵마다 카드 정확히 1개 — 코드·이름 일치 카드에 existing_code/mode를 찍고, 없으면 앞에 만든다."""
    by_code = {e["code"]: e for e in existing}
    by_name = {e["name"].strip(): e for e in existing}
    merged: list[dict] = []
    seen: set[str] = set()
    for card in cards:
        card = dict(card)
        code = card.get("existing_code")
        match = by_code.get(code) if code else None
        if match is None:
            match = by_name.get((card.get("name") or "").strip())
        if match is None or match["code"] in seen:
            card["existing_code"] = None
            card["mode"] = "new"
        else:
            seen.add(match["code"])
            card["existing_code"] = match["code"]
            card["mode"] = "revise" if card.get("mode") == "revise" else "keep"
        merged.append(card)
    missing = [
        {"name": e["name"], "summary": e["summary"], "owner_role": e["row"].get("ownerRole", ""),
         "department": e["row"].get("department", ""), "depends_on": [], "existing_code": e["code"], "mode": "keep"}
        for e in existing if e["code"] not in seen
    ]
    return missing + merged
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → 4 passed. `ruff check app/ tests/`.
- [ ] **Step 5: Commit** — `feat(fw-interview): reverse existing L6 maps into interview rows — 기존 L6 맵을 인터뷰 행으로 역변환·카드 병합`

---

### Task 2: 세션 `existing`·태스크 `mode` 컬럼 + 스키마 + 세션 생성 스냅샷

**Files:**
- Modify: `backend/app/models.py`(FrameworkInterviewSession·FrameworkInterviewTask), `backend/app/db.py`(`_ADDED_COLUMNS`), `backend/app/schemas.py`(FrameworkPlanCardIn·FrameworkInterviewTaskOut·FrameworkInterviewOut + `FrameworkExistingOut`), `backend/app/framework_interview/contracts.py`(PlanCard), `backend/app/routers/framework_interviews.py`(create·`_out`)
- Test: `backend/tests/test_framework_interview_api.py`(추가)

**Interfaces:**
- Consumes: Task 1 `load_existing_l6`.
- Produces: `FrameworkInterviewSession.existing: list|None`, `FrameworkInterviewTask.mode: str`, `PlanCard.existing_code: str|None = None`, `PlanCard.mode: Literal["new","keep","revise"] = "new"`, `FrameworkPlanCardIn` 동일 두 필드, `FrameworkExistingOut(map_id, code, name, activity_count)`, `FrameworkInterviewOut.existing: list[FrameworkExistingOut]`, `FrameworkInterviewTaskOut.mode: str = "new"`.

- [ ] **Step 1: 테스트** — `test_framework_interview_api.py`에 추가(기존 `_enable`, `_make_l5`, `HEADERS` 재사용; Task 1 테스트의 `_import_row`를 이 파일에 복제해 사용):

```python
def test_create_snapshots_existing_l6(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    l5_id = _make_l5(client, "exs")
    code = client.get(f"/api/categories/{l5_id}/chain", headers=HEADERS).json()[-1]["code"]
    _import_row(client, l5_id, EXISTING_ROW, f"{code}-01")
    res = client.post("/api/framework-interviews", json={"category_id": l5_id, "brief": "b"}, headers=HEADERS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["existing"] == [{"map_id": body["existing"][0]["map_id"], "code": f"{code}-01", "name": "요청 접수", "activity_count": 3}]
    assert "row" not in body["existing"][0]
```
(`/api/categories/{id}/chain` 경로가 다르면 `grep -n "chain" app/routers/categories.py`로 확인해 맞춘다. `EXISTING_ROW`는 Task 1의 `ROW` 중 3활동짜리 축약본을 파일 상단에 둔다.)

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**
  - models: `existing: Mapped[list | None] = mapped_column(JSON, default=None)  # 세션 시작 시 L5 아래 L6 맵 스냅샷 [{map_id, code, name, summary, activities, row}] (spec 2026-09-22 §2.2)`; 태스크 `mode: Mapped[str] = mapped_column(String(10), default="new")  # new|keep|revise`.
  - db.py `_ADDED_COLUMNS`: `("framework_interview_sessions", "existing", "JSON")`, `("framework_interview_tasks", "mode", "VARCHAR(10) DEFAULT 'new'")`.
  - contracts `PlanCard`: `existing_code: str | None = None`, `mode: Literal["new", "keep", "revise"] = "new"`.
  - schemas: `FrameworkPlanCardIn` 같은 두 필드; `FrameworkInterviewTaskOut.mode: str = "new"`; `class FrameworkExistingOut(BaseModel): map_id: int; code: str; name: str; activity_count: int`; `FrameworkInterviewOut.existing: list[FrameworkExistingOut] = []`.
  - router create: `existing=await load_existing_l6(db, payload.category_id)` 생성자 인자; `_out`에서 `existing=[FrameworkExistingOut(map_id=e["map_id"], code=e["code"], name=e["name"], activity_count=len(e.get("activities") or [])) for e in row.existing or []]`.
- [ ] **Step 4: 게이트** — 전체 pytest 그린(전체 그린 명령 사용) + ruff.
- [ ] **Step 5: Commit** — `feat(fw-interview): snapshot existing L6 maps on session start — 세션 시작 시 기존 L6 스냅샷·카드 모드 컬럼`

---

### Task 3: 계획 병합·잠금(keep/revise)·정정 프롬프트·revise 엔드포인트

**Files:**
- Modify: `backend/app/framework_interview/contracts.py`(L5_PLAN_CONTRACT·L6_QUESTIONNAIRE_CONTRACT·L6_ROW_DRAFTER_CONTRACT 문구, `build_plan_messages`·`build_questionnaire_messages`·`build_row_messages`), `backend/app/routers/framework_interviews.py`(propose_plan·save_plan·revise), `backend/app/framework_interview/runner.py`(`_generate_questionnaire`·`_draw_row`)
- Test: `backend/tests/test_framework_interview_contracts.py`, `test_framework_interview_api.py`, `test_framework_interview_runner.py`(추가)

**Interfaces:**
- Consumes: Task 1 `merge_existing_cards`·`existing_row_of`, Task 2 컬럼.
- Produces:
  - `build_plan_messages(..., existing_maps: list[dict] = [])` — user 메시지에 `[이미 있는 L6 맵]` 블록(`- {code} · {name}: {summary} (활동: a → b)`; 없으면 `- (없음)`).
  - `build_questionnaire_messages(..., existing_row: dict | None = None)`, `build_row_messages(..., existing_row: dict | None = None)` — 있으면 `[현재 등록된 내용]` 블록: `render_existing_row(row) -> str`(활동 `seq. label (kind)`, fields 키: 값, 엣지 `src→dst kind condition`).
  - `POST /framework-interviews/{id}/tasks/{task_pk}/revise` → `FrameworkInterviewOut`.

- [ ] **Step 1: 테스트**
  - contracts: `build_plan_messages(existing_maps=[{"code":"x-01","name":"접수","summary":"s","activities":["a","b"]}])` user 메시지에 `"[이미 있는 L6 맵]"`·`"x-01 · 접수: s (활동: a → b)"` 포함; `existing_maps=[]`면 `"- (없음)"`. 계약 문구에 `"existing_code"` 단어 포함. `build_questionnaire_messages(existing_row=ROW)`·`build_row_messages(existing_row=ROW)` user 메시지에 `"[현재 등록된 내용]"`과 `"1. 요청 확인 (action)"` 포함, `existing_row=None`이면 미포함.
  - api(`_enable`·fake AI 방식은 기존 `test_plan_generation_*` 참고):
    - `test_plan_merge_marks_existing_cards`: 기존 맵 1개 있는 L5에서 세션 생성 → `PUT /plan` cards=[{"name":"신규"}] lock=False → 응답 plan은 `[{"name":"요청 접수","mode":"keep","existing_code":"<code>-01"}, {"name":"신규","mode":"new",...}]`.
    - `test_lock_creates_keep_task_as_drawn_and_revise_pending`: cards=[keep 카드, revise 카드(existing_code 다른 맵), 새 카드] lock=True → tasks: keep는 `task_id==existing_code`·`status=="drawn"`·`mode=="keep"`, revise는 `status=="pending"`·`mode=="revise"`·`task_id==existing_code`, 새 카드는 `task_id=="<code>-03"`(채번이 기존 코드 뒤를 잇는다)·`mode=="new"`. 잠금 시 `runner.kick`은 monkeypatch로 무력화(기존 테스트 패턴).
    - `test_revise_endpoint_reopens_keep_task`: 위 잠금 후 keep 태스크에 `POST .../revise` → `mode=="revise"`·`status=="pending"`·세션 `plan_locked`·plan 카드 mode revise; new 태스크에 같은 호출은 409.
  - runner: `_generate_questionnaire`가 `mode=="revise"` 태스크에서 `build_questionnaire_messages`에 `existing_row`를 넘기는지(`monkeypatch`로 빌더를 감싸 kwargs 캡처; 기존 runner 테스트의 fake ask_schema 패턴 참고).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**
  - contracts: 계약 문구 세 곳에 규칙 문장 추가(긴 대시 금지, 한국어). 예) L5_PLAN_CONTRACT: `"[이미 있는 L6 맵]에 있는 맵은 각각 카드 하나로 이름을 그대로 두고 existing_code에 그 코드를 적는다. 새 카드는 빈 영역만 채우고 기존 맵과 이름이나 역할이 겹치는 카드는 만들지 않는다."` 설문 계약: `"[현재 등록된 내용]이 있으면 질문은 무엇을 바꿀지를 묻고 suggested는 현재 값을 그대로 담는다. 활동 순서 질문의 options는 현재 활동을 모두 포함하고 추가 후보를 뒤에 둔다."` 드로잉 계약: `"[현재 등록된 내용]이 있으면 그것을 바탕으로 답에서 바뀐 부분만 고치고 나머지는 그대로 유지한다."`
  - `render_existing_row(row)`: 활동 줄 `f"{a['seq']}. {a['label']} ({a.get('kind','action')})"` + name/rule 있으면 ` · {name}` ` · 규칙: {rule}`; fields `- 키: 값`; 엣지 `- {src}→{dst} {kind}{' '+condition if condition}`.
  - router `propose_plan`: `existing_maps=[{k: e[k] for k in ("code","name","summary","activities")} for e in row.existing or []]`; `_ask` 결과 → `cards = merge_existing_cards([c.model_dump() for c in plan.cards], row.existing or [])`; `row.plan = cards`.
  - router `save_plan`: `cards = merge_existing_cards(cards, row.existing or [])` (lock 여부 무관). lock 시: `new_cards = [c for c in cards if c["mode"] == "new"]`; `ids = allocate_task_ids(category.code, await load_existing_codes(db, row.category_id), len(new_cards))`; 순회하며 `task_id = card["existing_code"] if card["mode"] != "new" else next(ids_iter)`; keep → `FrameworkInterviewTask(..., mode="keep", status="drawn", row=existing_row, issues=validate_row(chain, l5, {"taskId": task_id, **existing_row}), drawn_at=now_kst())`; revise → `mode="revise"`; new → 현행. 중복 이름 검사는 병합 후 수행.
  - runner: `_generate_questionnaire`·`_draw_row`에 `existing_row=existing_row_of(session.existing, task.task_id) if task.mode == "revise" else None` 전달. `run_one_step`이 keep(drawn) 태스크를 집지 않음은 현행(drawn은 대상 아님) 확인.
  - revise 엔드포인트: 위치는 `reopen` 옆. 조건 `task.mode == "keep" and task.status == "drawn"` 아니면 409. 태스크 `mode="revise"`, `status="pending"`, `questionnaire=None`, `answers=None`, `error=None`(row 유지). plan 카드(`existing_code == task.task_id`) `mode="revise"`. 세션이 `ready`/`linking`이면 `plan_locked`로, `assembled=None`, `relations` 유지. `runner.kick(row.id)`.
- [ ] **Step 4: 게이트** — 전체 pytest + ruff.
- [ ] **Step 5: Commit** — `feat(fw-interview): keep or revise existing L6 per plan card — 계획 카드 단위 기존 L6 유지·정정`

---

### Task 4: 세션 화면 — 기존 칩·유지/정정 전환·정정 버튼·외부 프롬프트 기존 목록

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/components/framework-interview/plan-editor.tsx`, `frontend/src/components/framework-interview/task-board.tsx`, `frontend/src/app/framework/consult/[sessionId]/page.tsx`, `frontend/src/lib/interview-json-prompt.ts`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/components/admin/framework-panel.tsx`(프롬프트 target에 existingL6 전달은 Task 5에서 — 여기서는 타입만)
- Test: `frontend/src/lib/interview-json-prompt.test.ts`(추가), `frontend/src/lib/framework-interview.test.ts`(필요 시)

**Interfaces:**
- Consumes: Task 2·3 API(`existing`, `mode`, `existing_code`, `POST .../revise`).
- Produces: `FwPlanCard.existing_code?: string | null; mode?: "new"|"keep"|"revise"`, `FwInterviewTask.mode: "new"|"keep"|"revise"`, `FwExisting {map_id, code, name, activity_count}`, `FwInterviewSession.existing: FwExisting[]`, `reviseFrameworkTask(sessionId: number, taskPk: number): Promise<FwInterviewSession>`, `InterviewPromptTarget.existingL6?: {code: string; name: string}[]`.

- [ ] **Step 1: 테스트** — `interview-json-prompt.test.ts`: `existingL6: [{code:"x-01", name:"접수"}]`이면 출력에 `"x-01"`·`"접수"`와 "같은 taskId로 rows에 넣으면 갱신되고 빼면 그대로 둔다" 문장 포함; 없으면 그 절이 없다. 실패 확인.
- [ ] **Step 2: 구현**
  - api.ts 타입·함수(위 Produces). `reviseFrameworkTask`는 `request(`/framework-interviews/${id}/tasks/${pk}/revise`, {method:"POST"})`.
  - plan-editor: 카드에 `existing_code`가 있으면 이름 입력 왼쪽에 칩 `fw-consult-plan-existing-{i}`("Existing"/"기존", `bg-surface-alt text-fine`) + 세그먼트 `fw-consult-plan-mode-{i}-keep|revise`(홈 뷰 토글 스타일: `aria-pressed`, 활성 `bg-accent-tint text-accent`), 삭제 버튼 `disabled`. 카드 패널 위에 `session.existing.length > 0`이면 안내 `fw-consult-existing-note`(`fwConsult.existingNote` "{n} existing L6 maps were loaded. Keep them or switch a card to revise."). `EMPTY` 카드에 `mode:"new", existing_code:null`.
  - task-board: `task.mode === "keep"` → 칩 "Existing" + 버튼 `fw-consult-revise-{id}`("Revise"), onClick → prop `onRevise(task)`; `mode === "revise"` → 칩 "Revise". 카드 클릭 프리뷰는 현행(drawn).
  - page.tsx: `onRevise={(task) => void run(() => reviseFrameworkTask(session.id, task.id))}` 배선(기존 skip/reopen 배선 옆).
  - interview-json-prompt.ts: target에 `existingL6`가 있으면 절 추가(ko/en 둘 다, 긴 대시 금지).
  - i18n en/ko: `fwConsult.existing`("Existing"/"기존"), `fwConsult.revise`("Revise"/"정정"), `fwConsult.keep`("Keep"/"유지"), `fwConsult.reviseHint`, `fwConsult.existingNote`.
- [ ] **Step 3: 게이트** — tsc·lint·vitest·catalog.
- [ ] **Step 4: Commit** — `feat(fw-interview): existing chips, keep or revise toggle and revise button — 계획·보드에 기존 칩과 유지/정정 전환`

---

### Task 5: 관리자 패널 재구성 — 선택 행 상세 패널·액션·AI L5·임포트 버튼/스트립

**Files:**
- Modify: `frontend/src/components/admin/framework-panel.tsx`, `frontend/src/lib/i18n-messages.ts`
- Delete: `frontend/src/components/admin/admin-section.tsx`(사용처 이 패널뿐 — `grep -rn AdminSection src`로 확인)
- Regenerate: `frontend/COMPONENTS.md`
- Test: 기존 vitest 유지 + 스모크는 Task 6

**Interfaces:**
- Consumes: Task 4 타입(`FwInterviewSession.existing`, `InterviewPromptTarget.existingL6`), 기존 `canManageInScope`, `permNamesByCategory`, `activeSessions`, `interviewFiles`·dry run 핸들러, `createCategory`·`createFrameworkInterview`, `LevelPill`·`CountTag`·`Tooltip`·`InterviewJsonPromptButton`.
- Produces: 스펙 §1의 data-id 전부(`framework-admin-detail`, `-detail-head`, `-detail-empty`, `-detail-info`, `framework-admin-actions`, `framework-admin-action-{add|rename|dept|perms|move|delete}`, `framework-admin-ai`, `fw-consult-new-name`, `fw-consult-create`, `fw-consult-start`, `fw-consult-sessions-toggle`, `fw-consult-sessions-panel`, `fw-consult-session-{id}`, `interview-import-pick`, `interview-import-strip`, `interview-import-file-{i}`, `interview-import-remove-{i}`, `interview-import-file-count`, `interview-import-clear`, `interview-import-dryrun`). 트리 행 `framework-admin-node-{id}`에 `aria-current`.

- [ ] **Step 1: 구현(스펙 §1.1~1.5 그대로)**
  - 상태: `const [selectedId, setSelectedId] = useState<number | null>(null)`; `selectedNode = useMemo(() => 모든 childrenByParent 값에서 id 일치 노드, [childrenByParent, selectedId])`; 트리 갱신 후 없으면 `null`.
  - 트리 행: 액션 아이콘·`renderInlineAdmins` 제거(함수·`INLINE_ADMIN_MAX`·미사용 아이콘 import 정리). 이름 버튼 onClick: `setSelectedId(node.id); if (canExpand && !open) handleToggle(node.id)`; 클래스에 `selectedId === node.id ? "bg-accent-tint" : flashing ? ... : "hover:bg-divider"`; `aria-current={selectedId === node.id ? "true" : undefined}`. `revealCategory`는 끝에 `setSelectedId(id)`.
  - 그리드·높이: 스펙 §1.1. 트리 `h-[340px]`(max-h 대신), 우측 패널 `h-[340px] flex flex-col`.
  - 상세 패널·액션·AI 블록·세션 드롭다운·임포트 버튼: 스펙 §1.3. 새 L5 생성은 기존 `handleStartConsult`의 new 분기를 `selectedNode`(L4) + `newL5Name`로, L5 채우기는 existing 분기를 `selectedNode`(L5)로 바꾼다(`consultMode`·`consultPick`·`FrameworkCascadePicker` import 제거). 세션 드롭다운은 `createPortal` + fixed(버튼 rect 아래, z-[1350], 바깥 클릭 오버레이 z-[1340], Esc) — `framework-cascade-picker.tsx`의 드롭다운 코드를 참고해 패널 안 로컬 구현(공용화하지 않는다).
  - 임포트 스트립: 스펙 §1.4. 기존 파일 목록 `<ul>` 마크업을 필 나열로 교체, 리포트 wrap은 그대로 스트립 아래.
  - `AdminSection` 사용 전부 제거 → 파일 삭제 → `node scripts/build-component-catalog.mjs`.
  - i18n en/ko 키(스펙 §1.5). 비활성 버튼은 `title`로 이유(`fwConsult.needL4`/`needL5`).
  - 프롬프트 버튼 target: 선택이 L5이고 `activeSessions`/세션 정보가 없으므로 `existingL6`는 비워 둔다(세션 화면의 버튼이 채운다 — Task 4 범위 밖이면 생략 가능).
- [ ] **Step 2: 게이트** — tsc·lint·vitest·catalog `--check`.
- [ ] **Step 3: 눈 확인** — backend 8048(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`) + frontend 3047(`BACKEND_URL=http://localhost:8048 npx next dev --webpack -p 3047`)로 띄우고 `pw-fw-admin-layout-shot.mjs`를 임시로 고쳐(또는 스크래치 스크립트) 휴지 상태·L5 선택·임포트 스트립을 캡처해 본다. 정식 스모크 갱신은 Task 6.
- [ ] **Step 4: Commit** — `feat(admin): selected-row detail panel with actions, AI L5 and import strip — 선택 행 상세 패널(액션·AI L5·임포트 스트립)로 관리 뷰 재구성`

---

### Task 6: 스모크·스크린샷·매뉴얼·PROGRESS

**Files:**
- Modify: `frontend/scripts/pw-fw-consult.mjs`, `pw-fw-consult-new-l5.mjs`, `pw-fw-admin-layout-shot.mjs`, `pw-fw-import-section-shot.mjs`, `pw-fw-consult-pick-card.mjs`(진입부만), `pw-fw-consult-plan-shot.mjs`(진입부만)
- Create: `frontend/scripts/pw-fw-consult-existing.mjs`
- Modify: `docs/manual/admin-manual-ko.md`, `docs/manual/admin-manual-en.md`, `docs/qa/screens/*.png`, `PROGRESS.md`, `CLAUDE.md`(Lessons "인터뷰 JSON 0.5 계약 3표면" 항목에 `existing.py map_to_row`가 네 번째 표면임을 한 줄 추가)

**Interfaces:** Consumes Task 4·5 data-id.

- [ ] **Step 1: 진입 흐름 갱신** — 모든 캠페인 스모크의 진입: `framework-admin-search`에 L5(또는 L4) 이름 → `framework-admin-search-result-{id}` 클릭 → `framework-admin-node-{id}[aria-current="true"]` 대기 → `fw-consult-start`(L5) 또는 `fw-consult-new-name`+`fw-consult-create`(L4). 피커 data-id 참조 제거.
- [ ] **Step 2: 레이아웃 캡처 갱신** — `pw-fw-admin-layout-shot.mjs`: (1) 휴지 상태 `framework-admin-rest.png`(선택 없음, 버튼 비활성 확인) (2) L5 선택 `framework-admin-selected.png`(정보 줄·활성 버튼) (3) 임포트 버튼 → `setInputFiles`(샘플 `docs/samples/consultant-interview-sample/utility-l5.json`) → 스트립 필·개수 → dry run → 리포트 `framework-import-section.png`. `pw-fw-import-section-shot.mjs`는 (3)과 중복이면 삭제.
- [ ] **Step 3: 기존 L5 스모크** — `pw-fw-consult-existing.mjs`: 가짜 AI(:9999) 전제. API로 L1~L5 생성 → `import-interview` apply로 L6 맵 2개 임포트(문서는 Task 1 `ROW` 형태 2행) → 관리자 탭에서 그 L5 선택 → 캠페인 시작 → 계획 제안 → 카드 2장에 `fw-consult-plan-existing-*` 칩 → 두 번째 카드 `fw-consult-plan-mode-1-revise` → 잠금 → 보드에 keep 태스크 `li[data-status="drawn"]` 즉시 1개 → 설문 1장 제출(가짜 AI) → drawn 2 → 관계 제안·확정 → 등록 dry run 리포트에 unchanged 1·changed 1(리포트 문구는 `interview-import-report`의 카드 상태 필 텍스트로 확인). `fw-consult-existing.png` 캡처. PASS/FAIL 카운트 출력.
- [ ] **Step 4: 전 스모크 실행** — 가짜 AI + backend(AI_ENABLED=true, AI_BASE_URL=http://localhost:9999/v1) + frontend에서 `pw-fw-consult.mjs`·`pw-fw-consult-new-l5.mjs`·`pw-fw-consult-pick-card.mjs`·`pw-fw-consult-existing.mjs`·`pw-fw-admin-layout-shot.mjs` 전부 PASS. 스크린샷 `docs/qa/screens/`에 커밋.
- [ ] **Step 5: 매뉴얼** — ko/en "카테고리 관리"·"AI로 L5 채우기" 절: 트리 행 클릭 = 선택, 오른쪽 패널의 액션/AI/임포트 버튼, 기존 L6는 카드로 불러와 유지/정정, 정정은 현재 내용을 바탕으로 설문. 긴 대시 금지.
- [ ] **Step 6: Commit** — `test(fw-interview): smokes for the detail panel and existing L5 revise flow — 상세 패널·기존 L5 정정 스모크와 매뉴얼`
