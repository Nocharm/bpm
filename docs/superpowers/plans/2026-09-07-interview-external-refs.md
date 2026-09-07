# Interview JSON 0.5 External L6 References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a consultant's per-L5 interview JSON reference an L6 that belongs to another L5 by `(L5 code, uncertain name)` via a new `externalTasks[]` registry, and have the importer place origin-aware placeholders, auto-link exact-name matches, and resolve them when the other L5 is delivered.

**Architecture:** Adapter (`scripts/consultant_interview.py`) parses `externalTasks`, resolves edge endpoints `rows → externalTasks → raw code`, marks foreign lineage in `framework.categories` as external. Engine (`scripts/import_consultant.py`) creates external categories create-only, pre-resolves refs by normalized name within the origin L5, writes placeholders with `placeholder_category_id`, and resolves placeholders by `(category, normalized name)` on later deliveries. FE only learns the new report message kinds. No DDL.

**Tech Stack:** Python 3.11-compatible (ruff `target-version = "py311"` — no PEP 695 syntax), FastAPI + SQLAlchemy async, pytest; Next.js/TypeScript, vitest; Playwright smokes with system Chrome.

**Spec:** `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`

## Global Constraints

- Branch `feat/interview-external-refs` (worktree `.claude/worktrees/interview-external-refs`, based on dev `91f9f5f6`). Commit per task; **push the branch only — do not merge into dev**.
- Backend full-green command: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (run from `backend/`). Lint: `.venv/bin/ruff check app/ tests/ scripts/`.
- Frontend gates (from `frontend/`): `npx vitest run`, `npx tsc --noEmit`, `npm run lint`.
- Python 3.11 syntax only (`X | None` fine; no `type` statements, no PEP 695 generics).
- Commit message format: `type(scope): English summary — 한국어 요약`, body explains WHY, trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WJnAZvozJDizUX2hFzMCRj
  ```
- Update `PROGRESS.md` in the **same commit** as code changes (1–3 lines per commit under the existing `## 2026-09-07 — 인터뷰 JSON 0.5 외부 L6 참조(externalTasks) 설계 확정` heading — append bullets there rather than adding new headings).
- Report detail strings are a contract with `frontend/src/lib/interview-report.ts` PATTERNS — copy them verbatim from this plan.
- `schema_version` accepted prefixes: `0.4`, `0.5`. Samples are `0.5-bpm-interface-draft`.
- Placeholder title for `l6: null`: `"(L6 unspecified) {L5 name}"`.
- Name normalization for "exact match": `"".join(unicodedata.normalize("NFKC", s).casefold().split())`.

---

## File Structure

| File | Responsibility (this plan) |
|---|---|
| `backend/app/lineage.py` | + `normalize_task_name`, `external_ref_lineage_key` (shared by scripts/ and app/) |
| `backend/scripts/consultant_canonical.py` | + `CanonicalCategory.external: bool` |
| `backend/scripts/consultant_interview.py` | `externalTasks` parsing, `ExternalRef`, `InterviewLinkage.external_refs`, endpoint resolution, external lineage marking, 0.5 version, quote KeyError fix |
| `backend/scripts/import_consultant.py` | create-only upsert for external categories, external ref pre-resolution/placeholders/reimport update, name-path resolution, report rows |
| `backend/app/routers/categories.py` | cross-file category merge: home claim wins |
| `backend/tests/test_lineage_keys.py` (new) | lineage helper unit tests |
| `backend/tests/test_consultant_interview.py` | adapter tests |
| `backend/tests/test_consultant_import.py` | upsert tests |
| `backend/tests/test_interview_import_api.py` | engine/API tests |
| `backend/tests/test_samples_0_5.py` (new) | sample-shape + B-set scenario tests |
| `frontend/src/lib/interview-report.ts`, `.test.ts` | 5 new `DetailKind`s + PATTERNS |
| `frontend/src/components/admin/framework-panel.tsx`, `frontend/src/lib/i18n-messages.ts` | labels for the 5 kinds (en/ko) |
| `docs/samples/consultant-interview-sample/*.json` (2), `docs/samples/framework-linkage-dummy/*.json` (5; `brr-large-l5.json` → `brr-l5.json`) | 0.5 samples |
| `frontend/scripts/pw-smoke-{interview-import,field-promotion}.mjs` | count constants |
| `docs/samples/interview-json-0.5.md` (new), `docs/qa/interview-import-field-map.md`, `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md`, `docs/design/2026-09-01-interview-import-v04-result.md`, `docs/README.md`, `PROGRESS.md` | docs |

---

### Task 1: Lineage helpers — `normalize_task_name`, `external_ref_lineage_key`

**Files:**
- Modify: `backend/app/lineage.py`
- Test: `backend/tests/test_lineage_keys.py` (new)

**Interfaces:**
- Produces: `normalize_task_name(name: str) -> str`; `external_ref_lineage_key(home_code: str, ref_id: str) -> str` (both imported later by `scripts/import_consultant.py`).

- [ ] **Step 1: Write the failing tests**

```python
"""계보 키·이름 정규화 헬퍼 — 임포터(scripts/)와 앱(framework_slots)이 공유하는 순수 함수."""

from app.lineage import (
    external_lineage_key,
    external_ref_lineage_key,
    make_node_id,
    normalize_task_name,
)


def test_normalize_task_name_ignores_case_width_and_whitespace() -> None:
    assert normalize_task_name("OOS 접수 및 초동 평가") == normalize_task_name("OOS접수 및  초동평가")
    assert normalize_task_name("Oos 접수") == normalize_task_name("OOS 접수")
    assert normalize_task_name("ＯＯＳ 접수") == normalize_task_name("OOS 접수")  # NFKC 전각→반각
    assert normalize_task_name("  ") == ""


def test_normalize_task_name_keeps_distinct_names_apart() -> None:
    assert normalize_task_name("교정 결과 보고") != normalize_task_name("교정 결과 보고 및 이력 등록")


def test_external_ref_lineage_key_is_namespaced_by_home_l5() -> None:
    a = external_ref_lineage_key("19-01-06-01-02", "ext-0001")
    b = external_ref_lineage_key("19-01-02-01-01", "ext-0001")  # 다른 파일의 같은 refId
    assert a != b
    assert a == external_ref_lineage_key("19-01-06-01-02", "ext-0001")  # 결정적
    assert a != external_lineage_key("ext-0001")  # 미선언(taskId) 키와도 구분
    assert a == make_node_id("__ext__", "19-01-06-01-02|ext-0001")
```

- [ ] **Step 2: Run to verify failure**

Run (from `backend/`): `.venv/bin/python -m pytest tests/test_lineage_keys.py -q`
Expected: FAIL with `ImportError: cannot import name 'external_ref_lineage_key'`

- [ ] **Step 3: Implement**

Append to `backend/app/lineage.py` (after `external_lineage_key`), and add `import unicodedata` next to `import hashlib`:

```python
def external_ref_lineage_key(home_code: str, ref_id: str) -> str:
    """externalTasks[].refId 플레이스홀더의 계보 키 — 파일 안에서만 유일한 refId를 홈 L5 코드로
    네임스페이스한다. 미선언 원문 코드(taskId)는 external_lineage_key를 그대로 쓴다 (spec 2026-09-07 §6.2)."""
    return make_node_id(EXTERNAL_LINEAGE_SCOPE, f"{home_code}|{ref_id}")


def normalize_task_name(name: str) -> str:
    """"정확 일치" 비교용 — NFKC·casefold·공백 전부 제거("OOS 접수" == "OOS접수"). 자동 연결은 이 값이
    같은 맵이 그 L5에 정확히 1개일 때만 (spec 2026-09-07 §6.2)."""
    return "".join(unicodedata.normalize("NFKC", name).casefold().split())
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_lineage_keys.py -q` → `3 passed`. Then `.venv/bin/ruff check app/lineage.py tests/test_lineage_keys.py`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/lineage.py backend/tests/test_lineage_keys.py PROGRESS.md
git commit -m "feat(lineage): namespaced external-ref lineage key and task-name normalization — 외부 참조 계보 키·이름 정규화 헬퍼"
```
(PROGRESS bullet: `- T1 lineage 헬퍼: external_ref_lineage_key(홈 L5|refId)·normalize_task_name(NFKC·casefold·공백 제거) — 어댑터/엔진/후차 해소가 공유`.)

---

### Task 2: Adapter — `externalTasks` parsing, `ExternalRef`, endpoint resolution, quote KeyError fix

**Files:**
- Modify: `backend/scripts/consultant_interview.py` (constants :25-58, dataclasses :98-121, `_build_linkage` :452-560, `convert_interview` :700-770)
- Test: `backend/tests/test_consultant_interview.py`

**Interfaces:**
- Produces: `ExternalRef(code, l5_code, l5_label, name, note, declared)`; `InterviewLinkage.external_refs: dict[str, ExternalRef]` (insertion-ordered, one entry per external edge endpoint); temporary compatibility property `InterviewLinkage.external_codes -> list[str]` (sorted keys) so the engine keeps working until Task 5 removes it.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_consultant_interview.py`)

```python
def _external_task(ref_id: str, node_code: str, l6: object = "외부 업무", **over: object) -> dict:
    base: dict = {"refId": ref_id, "l5": {"nodeCode": node_code, "label": "외부 L5"}, "l6": l6, "note": None}
    base.update(over)
    return base


def _with_external(data: dict) -> dict:
    """홈 rows 1건 + 외부 L5(19-01-02-01-01) 계보 동봉 + 선언 ref 1건."""
    data["schema_version"] = "0.5-bpm-interface-draft"
    data["framework"]["categories"] += [
        {"code": "19-01-02", "name": "유틸리티 운전", "level": 3, "parent": "19-01"},
        {"code": "19-01-02-01", "name": "정제수 시스템 운전", "level": 4, "parent": "19-01-02"},
        {"code": "19-01-02-01-01", "name": "정제수 일상 점검", "level": 5, "parent": "19-01-02-01"},
    ]
    data["externalTasks"] = [_external_task("ext-util", "19-01-02-01-01", "정제수 일상 점검 수행",
                                            note="점검 라운드가 끝나야 교정 준비를 시작한다고 함")]
    data["relations"]["edges"] = [_edge("ext-util", "task-prep-0001", label="점검 후 준비")]
    return data


def test_declared_external_task_becomes_external_ref_without_warning() -> None:
    res = convert_interview(_with_external(_interview()))
    assert not res.has_error()
    lk = res.linkage
    assert lk is not None
    ref = lk.external_refs["ext-util"]
    assert (ref.l5_code, ref.l5_label, ref.name, ref.declared) == (
        "19-01-02-01-01", "외부 L5", "정제수 일상 점검 수행", True)
    assert ref.note == "점검 라운드가 끝나야 교정 준비를 시작한다고 함"
    assert [(e.source, e.target, e.external) for e in lk.edges] == [("ext-util", "task-prep-0001", True)]
    assert not any("external" in i.message and i.severity == "warning" for i in res.issues)
    note = next(n for n in res.notes if n.kind == "external")
    assert note.title == "정제수 일상 점검 수행 (외부 L5)" and note.category_code == "19-01-06-01-02"


def test_undeclared_endpoint_keeps_legacy_taskid_placeholder_with_warning() -> None:
    data = _interview()
    data["relations"]["edges"] = [_edge("task-prep-0001", "other-l5-task-0009")]
    res = convert_interview(data)
    assert not res.has_error()
    ref = res.linkage.external_refs["other-l5-task-0009"]
    assert ref.declared is False and ref.l5_code is None and ref.name == ""
    assert any("kept as placeholder" in i.message and "not declared in externalTasks" in i.message
               for i in res.issues)


def test_external_edge_quote_no_longer_crashes_and_becomes_flow_note() -> None:
    data = _with_external(_interview())
    data["relations"]["edges"][0]["quote"] = "라운드 끝나면 그때 준비 들어가요."
    res = convert_interview(data)  # 이전엔 row_names[src] KeyError
    assert not res.has_error()
    flow = next(n for n in res.notes if n.kind == "flow")
    assert flow.title == "정제수 일상 점검 수행 → 교정 준비"


def test_external_task_l6_null_keeps_empty_name() -> None:
    data = _with_external(_interview())
    data["externalTasks"][0]["l6"] = None
    res = convert_interview(data)
    assert not res.has_error()
    assert res.linkage.external_refs["ext-util"].name == ""  # 제목은 엔진이 "(L6 unspecified) L5명"으로


def test_external_task_errors_and_warnings() -> None:
    data = _with_external(_interview())
    data["externalTasks"] += [
        _external_task("ext-util", "19-01-02-01-01"),               # 중복 refId
        _external_task("task-prep-0001", "19-01-02-01-01"),          # taskId 충돌
        {"refId": "ext-nol5", "l6": "x"},                            # l5 누락
        {"refId": "ext-nocode", "l5": {"label": "이름만"}, "l6": "x"},  # nodeCode 누락
    ]
    res = convert_interview(data)
    msgs = [(i.severity, i.message) for i in res.issues]
    assert ("error", "duplicate refId 'ext-util' (참조 id 중복)") in msgs
    assert any(s == "error" and "collides with rows[].taskId" in m for s, m in msgs)
    assert any(s == "error" and m.startswith("l5 missing") for s, m in msgs)
    assert any(s == "error" and m.startswith("nodeCode missing") for s, m in msgs)


def test_external_task_unknown_l5_and_unreferenced_are_warnings() -> None:
    data = _with_external(_interview())
    data["externalTasks"].append(_external_task("ext-unused", "77-01-01-01-01"))  # 파일 categories에 없음 + 엣지 미참조
    res = convert_interview(data)
    assert not res.has_error()
    assert any(i.severity == "warning" and "external L5 '77-01-01-01-01' not in framework.categories" in i.message
               for i in res.issues)
    assert any(i.severity == "warning" and "refId 'ext-unused' not referenced by any edge" in i.message
               for i in res.issues)
    assert "ext-unused" not in res.linkage.external_refs


def test_edge_between_two_external_endpoints_is_dropped() -> None:
    data = _with_external(_interview())
    data["externalTasks"].append(_external_task("ext-two", "19-01-02-01-01", "다른 외부"))
    data["relations"]["edges"].append(_edge("ext-util", "ext-two"))
    res = convert_interview(data)
    assert not res.has_error()
    assert [(e.source, e.target) for e in res.linkage.edges] == [("ext-util", "task-prep-0001")]
    assert any("references unknown taskId" in i.message for i in res.issues)
```

Also update the existing assertion in `test_edge_with_missing_endpoint_is_dropped_not_treated_as_external`: replace `assert lk.external_codes == []` with `assert lk.external_refs == {}`.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_consultant_interview.py -q -k "external or missing_endpoint"`
Expected: FAIL (`AttributeError: 'InterviewLinkage' object has no attribute 'external_refs'`, KeyError in the quote test).

- [ ] **Step 3: Implement the adapter changes**

3a. Constants (`consultant_interview.py` top): add `"externalTasks"` to `_TOP_KEYS`, and after `_KNOWN_TRIGGERS`:

```python
# 0.5 — 타 L5의 L6 참조 레지스트리. 엣지 src/dst가 rows[].taskId가 아니면 여기서 찾는다 (spec 2026-09-07 §4)
_EXTERNAL_TASK_KEYS = {"refId", "l5", "l6", "note"}
_EXTERNAL_L5_KEYS = {"nodeCode", "label"}
```

3b. Dataclasses — add before `InterviewLinkageEdge`, and replace `external_codes` in `InterviewLinkage`:

```python
@dataclass
class ExternalRef:
    """타 L5의 L6 참조 — externalTasks[] 선언(declared) 또는 엣지 끝점에만 등장한 원문 코드(미선언).

    미선언은 "실 taskId를 아는 외부 L6"(dev 2026-09-06 동작)로 취급돼 l5_code/name이 비고,
    엔진이 taskId 계보 키(external_lineage_key)로 배치·해소한다.
    """

    code: str                      # refId 또는 미선언 원문 코드 — 엣지 src/dst 값 그대로
    l5_code: str | None = None
    l5_label: str = ""
    name: str = ""                 # 이름 힌트 — 비면 자동 매칭 대상 아님(제목은 엔진이 만든다)
    note: str = ""
    declared: bool = True
```

In `InterviewLinkage` replace the field `external_codes: list[str] = field(default_factory=list)` with:

```python
    # code → ExternalRef, 엣지에 처음 등장한 순서. 선언 ref와 미선언 코드가 함께 들어간다 (spec 2026-09-07 §5)
    external_refs: dict[str, ExternalRef] = field(default_factory=dict)

    @property
    def external_codes(self) -> list[str]:
        # Task 5(엔진 전환)까지의 호환 뷰 — 이후 제거
        return sorted(self.external_refs)
```

3c. New parser (place before `_build_linkage`):

```python
def _parse_external_tasks(
    raw: object,
    row_codes: set[str],
    category_codes: set[str],
    issues: list[AdapterIssue],
) -> dict[str, ExternalRef]:
    """externalTasks[] → refId별 ExternalRef. error: refId 누락/중복/taskId 충돌·l5/nodeCode 누락 (spec 2026-09-07 §4.4)."""
    refs: dict[str, ExternalRef] = {}
    if raw is None:
        return refs
    if not isinstance(raw, list):
        issues.append(AdapterIssue("error", "externalTasks", "externalTasks is not a list (외부 업무 목록 형식 오류)"))
        return refs
    for i, item in enumerate(raw):
        path = f"externalTasks[{i}]"
        if not isinstance(item, dict):
            issues.append(AdapterIssue("error", path, "external task is not an object (외부 업무 형식 오류)"))
            continue
        _warn_unknown_keys(item, _EXTERNAL_TASK_KEYS, path, issues)
        ref_id = _clean(item.get("refId"))
        if not ref_id:
            issues.append(AdapterIssue("error", path, "refId missing (참조 id 없음)"))
            continue
        if ref_id in refs:
            issues.append(AdapterIssue("error", path, f"duplicate refId {ref_id!r} (참조 id 중복)"))
            continue
        if ref_id in row_codes:
            issues.append(AdapterIssue("error", path, f"refId {ref_id!r} collides with rows[].taskId (행 taskId와 충돌)"))
            continue
        l5 = item.get("l5")
        if not isinstance(l5, dict):
            issues.append(AdapterIssue("error", f"{path}.l5", "l5 missing or not an object (소속 L5 정보 없음)"))
            continue
        _warn_unknown_keys(l5, _EXTERNAL_L5_KEYS, f"{path}.l5", issues)
        l5_code = _clean(l5.get("nodeCode"))
        if not l5_code:
            issues.append(AdapterIssue("error", f"{path}.l5", "nodeCode missing (소속 L5 코드 없음)"))
            continue
        if l5_code not in category_codes:
            issues.append(AdapterIssue(
                "warning", f"{path}.l5",
                f"external L5 {l5_code!r} not in framework.categories - resolved against existing framework "
                "(파일에 없는 L5 - 기존 체계로 해석)"))
        refs[ref_id] = ExternalRef(
            code=ref_id, l5_code=l5_code, l5_label=_clean(l5.get("label")),
            name=_truncate(_clean(item.get("l6")), 200, path, "l6", issues),
            note=_clean(item.get("note")),
        )
    return refs
```

3d. `_build_linkage` — new signature and endpoint handling. Change the signature to:

```python
def _build_linkage(
    relations: object,
    l5_code: str,
    row_names: dict[str, str],
    declared: dict[str, ExternalRef],
    issues: list[AdapterIssue],
) -> tuple[InterviewLinkage, list[InterviewNote]]:
```

Inside the edge loop, replace the block from `src_known, dst_known = ...` through the `issues.append(... kept as placeholder ...)` with:

```python
        src_known, dst_known = src in row_names, dst in row_names
        if not src_known and not dst_known:
            issues.append(AdapterIssue(
                "warning", epath, f"edge references unknown taskId {src!r}→{dst!r} - dropped (존재하지 않는 taskId를 가리켜 제외됨)"))
            continue
        external = not (src_known and dst_known)
        if external:
            ext = dst if src_known else src
            ref = declared.get(ext)
            if ref is None:
                # 미선언 — dev 2026-09-06 동작 유지: 원문을 실 taskId로 보고 플레이스홀더 (spec 2026-09-07 §4.2)
                ref = linkage.external_refs.get(ext) or ExternalRef(code=ext, declared=False)
                if ext not in linkage.external_refs:
                    issues.append(AdapterIssue(
                        "warning", epath,
                        f"edge to external taskId {ext!r} kept as placeholder - not declared in externalTasks "
                        "(다른 L5의 업무 - externalTasks 미선언, taskId 플레이스홀더로 배치됨)"))
            linkage.external_refs.setdefault(ext, ref)
```

Replace the quote-note title (currently `title=f"{row_names[src]} → {row_names[dst]}"[:300]`) with:

```python
        if quote:
            names = {**row_names, **{c: (r.name or c) for c, r in linkage.external_refs.items()}}
            notes.append(InterviewNote(
                kind="flow",
                title=f"{names[src]} → {names[dst]}"[:300],
                text=_flow_note_text(kind, gateway, condition, quote),
                category_code=l5_code,
            ))
```

Replace the trailing `linkage.external_codes.sort()` with the unreferenced-ref warning:

```python
    for ref_id in declared:
        if ref_id not in linkage.external_refs:
            issues.append(AdapterIssue(
                "warning", "externalTasks",
                f"refId {ref_id!r} not referenced by any edge - ignored (엣지에서 참조되지 않은 외부 업무 - 무시됨)"))
```

3e. `convert_interview` wiring — replace the two lines

```python
    linkage, entry_notes = _build_linkage(raw.get("relations"), l5_code, row_names, issues)
```
with
```python
    # 0.5 외부 참조 — rows 파싱 뒤(taskId 충돌 검사), relations 전(끝점 해석)
    declared_refs = _parse_external_tasks(raw.get("externalTasks"), seen_task_ids, set(codes), issues)
    for ref in declared_refs.values():
        if ref.note:
            result.notes.append(InterviewNote(
                kind="external", text=ref.note,
                title=f"{ref.name or ref.code} ({ref.l5_label or ref.l5_code})",
                category_code=l5_code,
            ))
    linkage, entry_notes = _build_linkage(raw.get("relations"), l5_code, row_names, declared_refs, issues)
```

- [ ] **Step 4: Run tests**

Run: `.venv/bin/python -m pytest tests/test_consultant_interview.py tests/test_interview_import_api.py -q` → all pass (engine still reads `external_codes` through the compat property). `.venv/bin/ruff check scripts/ tests/`.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/consultant_interview.py backend/tests/test_consultant_interview.py PROGRESS.md
git commit -m "feat(import): parse externalTasks and resolve edge endpoints rows→refId→raw code, fix external-edge quote crash — 외부 업무 레지스트리 파싱·끝점 해석·quote KeyError 픽스"
```

---

### Task 3: Adapter — external lineage marking, broken external chain tolerance, 0.5 version

**Files:**
- Modify: `backend/scripts/consultant_canonical.py:19-23`, `backend/scripts/consultant_interview.py` (`convert_interview` version check and categories block :580-608)
- Test: `backend/tests/test_consultant_interview.py`

**Interfaces:**
- Produces: `CanonicalCategory.external: bool = False` (read by Task 4 upsert and router merge).

- [ ] **Step 1: Write the failing tests**

```python
def test_schema_version_05_accepted_and_04_still_works() -> None:
    data = _interview()
    data["schema_version"] = "0.5-bpm-interface-draft"
    assert not convert_interview(data).has_error()
    data["schema_version"] = "0.4-bpm-interface-draft"
    assert not convert_interview(data).has_error()


def test_categories_outside_home_chain_are_marked_external() -> None:
    res = convert_interview(_with_external(_interview()))
    flags = {c.code: c.external for c in res.categories}
    assert flags["19"] is False and flags["19-01"] is False  # 공유 조상은 홈 체인
    assert flags["19-01-06-01-02"] is False
    assert flags["19-01-02"] is True and flags["19-01-02-01-01"] is True


def test_broken_external_chain_is_dropped_with_warning_not_error() -> None:
    data = _with_external(_interview())
    # 외부 L5의 L4 부모(19-01-02-01)를 빼 체인을 끊는다 → L5도 부모 없음으로 연쇄 제외
    data["framework"]["categories"] = [c for c in data["framework"]["categories"] if c["code"] != "19-01-02-01"]
    res = convert_interview(data)
    assert not res.has_error()
    codes = {c.code for c in res.categories}
    assert "19-01-02" in codes and "19-01-02-01-01" not in codes
    assert sum("dropped - parent" in i.message for i in res.issues if i.severity == "warning") == 1
    # nodeCode는 이제 파일에 없다 → 기존 체계로 해석 경고
    assert any("not in framework.categories" in i.message for i in res.issues)


def test_broken_home_chain_is_still_file_error() -> None:
    data = _interview()
    data["framework"]["categories"] = [c for c in data["framework"]["categories"] if c["code"] != "19-01-06"]
    res = convert_interview(data)
    assert res.has_error()
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_consultant_interview.py -q -k "version_05 or home_chain or broken"` → FAIL (0.5 rejected; `external` attribute missing).

- [ ] **Step 3: Implement**

3a. `consultant_canonical.py` `CanonicalCategory`:

```python
class CanonicalCategory(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    level: int = Field(ge=1, le=5)
    parent: str | None = None
    # 홈 L5 조상 체인 밖 계보(타 L5 참조용 동봉) — 엔진은 없을 때만 생성, 있으면 불변 (spec 2026-09-07 §4.3)
    external: bool = False
```

3b. `consultant_interview.py` — version check:

```python
    version = _clean(raw.get("schema_version"))
    if not (version.startswith("0.4") or version.startswith("0.5")):
        issues.append(AdapterIssue(
            "error", "schema_version",
            f"unsupported schema_version {version!r} - re-deliver as 0.5-bpm-interface-draft (지원하지 않는 스키마 버전 - 0.5로 재전달 필요)",
        ))
        return result
```

3c. New helper before `convert_interview`:

```python
def _prune_external_lineage(raw_cats: list, l5_code: str, issues: list[AdapterIssue]) -> list:
    """홈 체인(l5_code의 조상) 밖 카테고리 중 부모가 파일에 없는 것을 경고 후 제외한다 — 외부 계보는
    파일 error가 아니다(nodeCode는 DB 기존 체계로 해석). 홈 체인은 손대지 않아 parse_categories가 그대로 검증한다."""
    by_code: dict[str, dict] = {}
    for c in raw_cats:
        if isinstance(c, dict) and _clean(c.get("code")):
            by_code[_clean(c.get("code"))] = c
    home: set[str] = set()
    cursor: str | None = l5_code
    while cursor and cursor in by_code and cursor not in home and len(home) < 10:
        home.add(cursor)
        parent = by_code[cursor].get("parent")
        cursor = _clean(parent) if parent is not None else None
    kept = list(raw_cats)
    while True:
        codes = {_clean(c.get("code")) for c in kept if isinstance(c, dict)}
        dropped = [
            c for c in kept
            if isinstance(c, dict) and _clean(c.get("code")) not in home
            and c.get("parent") is not None and _clean(c.get("parent")) not in codes
        ]
        if not dropped:
            return kept
        for c in dropped:
            issues.append(AdapterIssue(
                "warning", "framework.categories",
                f"category {_clean(c.get('code'))} dropped - parent {_clean(c.get('parent'))} not in file "
                "(외부 계보 체인 끊김 - 기존 체계로 해석)"))
        kept = [c for c in kept if c not in dropped]
```

3d. In `convert_interview`, read `l5.nodeCode` **before** parsing categories and prune, then mark. Replace the block from `try: result.categories = parse_categories(...)` through the `codes[l5_code].level != 5` warning with:

```python
    l5 = raw.get("l5")
    if isinstance(l5, dict):
        _warn_unknown_keys(l5, _L5_KEYS, "l5", issues)
    l5_code = _clean(l5.get("nodeCode")) if isinstance(l5, dict) else ""
    raw_cats = _prune_external_lineage(framework["categories"], l5_code, issues)
    try:
        result.categories = parse_categories({"categories": raw_cats})
    except CanonicalError as exc:
        issues.append(AdapterIssue("error", "framework.categories", str(exc)))
        return result
    codes = {c.code: c for c in result.categories}
    if not l5_code or l5_code not in codes:
        issues.append(AdapterIssue("error", "l5.nodeCode",
                                   f"nodeCode {l5_code!r} not found in framework.categories (업무체계에 없는 코드)"))
        return result
    if codes[l5_code].level != 5:
        issues.append(AdapterIssue("warning", "l5.nodeCode",
                                   f"nodeCode {l5_code!r} is level {codes[l5_code].level}, expected 5 (L5 코드가 아님)"))
    # 홈 체인 밖 = 외부 계보 — 엔진이 create-only로 다룬다 (spec 2026-09-07 §4.3)
    home_chain: set[str] = set()
    cursor: str | None = l5_code
    while cursor and cursor in codes and cursor not in home_chain:
        home_chain.add(cursor)
        cursor = codes[cursor].parent
    for cat in result.categories:
        cat.external = cat.code not in home_chain
```
(Delete the older duplicate `l5 = raw.get("l5") … l5_code = …` lines that followed the categories parse so `l5_code` is defined once.)

- [ ] **Step 4: Run tests**

`.venv/bin/python -m pytest tests/test_consultant_interview.py tests/test_consultant_canonical.py tests/test_interview_import_api.py -q` → pass. ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/consultant_canonical.py backend/scripts/consultant_interview.py backend/tests/test_consultant_interview.py PROGRESS.md
git commit -m "feat(import): accept schema 0.5 and mark categories outside the home L5 chain as external lineage — 0.5 수용·외부 계보 마킹(끊긴 체인은 경고 제외)"
```

---

### Task 4: Engine — create-only upsert for external categories, router merge "home wins"

**Files:**
- Modify: `backend/scripts/import_consultant.py:301-320` (`upsert_categories`), `backend/app/routers/categories.py:766-775` (merge loop)
- Test: `backend/tests/test_consultant_import.py`, `backend/tests/test_interview_import_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_consultant_import.py`:

```python
def test_upsert_categories_external_is_create_only(client) -> None:
    """외부 계보(external=True)는 없을 때만 생성하고, 있으면 이름·부모·순서를 건드리지 않는다 (spec 2026-09-07 §6.1)."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory
    from scripts.consultant_canonical import CanonicalCategory
    from scripts.import_consultant import upsert_categories

    home = [CanonicalCategory(code="X", name="원본 루트", level=1, parent=None),
            CanonicalCategory(code="X1", name="원본 L2", level=2, parent="X")]
    foreign = [CanonicalCategory(code="X", name="다른 파일이 부른 이름", level=1, parent=None, external=True),
               CanonicalCategory(code="X1", name="다른 이름 L2", level=2, parent="X", external=True),
               CanonicalCategory(code="X2", name="새 외부 L2", level=2, parent="X", external=True)]

    async def _run_both():
        async with SessionLocal() as session:
            await upsert_categories(session, home)
            await session.commit()
        async with SessionLocal() as session:
            ids = await upsert_categories(session, foreign)
            await session.commit()
            rows = (await session.scalars(
                select(ProcessCategory).where(ProcessCategory.code.in_(["X", "X1", "X2"]))
                .order_by(ProcessCategory.code))).all()
        return ids, rows

    ids, rows = _run(_run_both())
    assert [r.name for r in rows] == ["원본 루트", "원본 L2", "새 외부 L2"]  # 기존 2행 불변, 신규 1행 생성
    assert rows[2].parent_id == ids["X"] and ids["X2"] == rows[2].id
```
(Reuse the file's existing `_run` helper.)

Append to `backend/tests/test_interview_import_api.py`:

```python
def test_home_claim_wins_over_external_lineage_across_files(client: TestClient) -> None:
    """같은 code를 한 파일은 홈으로, 다른 파일은 외부 계보로 실으면 파일 순서와 무관하게 홈 이름이 남는다 (spec 2026-09-07 §4.3)."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    def _pair(order: str) -> list[dict]:
        home = _interview()
        home["schema_version"] = "0.5-bpm-interface-draft"
        home["framework"]["categories"] = [
            {"code": "HW", "name": "홈 루트", "level": 1, "parent": None},
            {"code": "HW-1", "name": "홈 L2", "level": 2, "parent": "HW"},
            {"code": "HW-1-1", "name": "홈 L3", "level": 3, "parent": "HW-1"},
            {"code": "HW-1-1-1", "name": "홈 L4", "level": 4, "parent": "HW-1-1"},
            {"code": "HW-1-1-1-1", "name": "홈 L5 정식명", "level": 5, "parent": "HW-1-1-1"},
        ]
        home["l5"] = {"label": "홈 L5 정식명", "nodeCode": "HW-1-1-1-1"}
        home["rows"][0]["taskId"] = f"hw-task-{order}"
        other = _interview()
        other["schema_version"] = "0.5-bpm-interface-draft"
        other["framework"]["categories"] += home["framework"]["categories"][:4] + [
            {"code": "HW-1-1-1-1", "name": "다른 파일이 부른 이름", "level": 5, "parent": "HW-1-1-1"}]
        other["rows"][0]["taskId"] = f"hw-other-{order}"
        other["externalTasks"] = [{"refId": "ext-hw", "l5": {"nodeCode": "HW-1-1-1-1", "label": None}, "l6": "아무 업무", "note": None}]
        other["relations"]["edges"] = [{"src": f"hw-other-{order}", "dst": "ext-hw", "kind": "seq", "gateway": None,
                                        "condition": None, "label": None, "quote": None}]
        files = [{"name": "home.json", "content": home}, {"name": "other.json", "content": other}]
        return files if order == "a" else list(reversed(files))

    async def _name():
        async with SessionLocal() as session:
            return await session.scalar(select(ProcessCategory.name).where(ProcessCategory.code == "HW-1-1-1-1"))

    for order in ("a", "b"):
        res = _post(client, _pair(order), apply=True)
        assert res.status_code == 200, res.text
        assert all(f["ok"] for f in res.json()["files"]), res.json()["files"]
        assert _run(_name()) == "홈 L5 정식명"
```

- [ ] **Step 2: Run to verify failure**

`.venv/bin/python -m pytest tests/test_consultant_import.py::test_upsert_categories_external_is_create_only tests/test_interview_import_api.py::test_home_claim_wins_over_external_lineage_across_files -q` → FAIL (names overwritten).

- [ ] **Step 3: Implement**

3a. `upsert_categories` loop body:

```python
    for order, cat in enumerate(sorted(cats, key=lambda c: c.level)):
        row = existing.get(cat.code)
        parent_id = ids.get(cat.parent) if cat.parent else None
        if row is None:
            row = ProcessCategory(code=cat.code, name=cat.name, level=cat.level,
                                  parent_id=parent_id, sort_order=order)
            session.add(row)
            await session.flush()
            existing[cat.code] = row
        elif not cat.external:
            row.name, row.level, row.parent_id, row.sort_order = cat.name, cat.level, parent_id, order
        # cat.external and 기존 행 → 불변: 타 L5의 계보를 이 파일이 개명·이동하지 않는다 (spec 2026-09-07 §6.1)
        ids[cat.code] = row.id
```

3b. Router merge (`categories.py`, inside `if ok:` before `merged_maps.extend`):

```python
            for cat in result.categories:
                prev = merged_cats.get(cat.code)
                if prev is not None and cat.external and not prev.external:
                    continue  # 홈 주장 우선 — 외부 계보는 다른 파일의 홈 항목을 덮지 않는다 (spec 2026-09-07 §4.3)
                if prev is not None and prev.name != cat.name and not (prev.external or cat.external):
                    issues.append(AdapterIssue(
                        "warning", "framework.categories",
                        f"category {cat.code} name differs across files - later file wins"
                        " (파일 간 분류 이름 불일치 - 뒤 파일 기준 적용)",
                    ))
                merged_cats[cat.code] = cat
```

- [ ] **Step 4: Run tests** — the two new tests + `tests/test_consultant_import.py tests/test_interview_import_api.py tests/test_categories_api.py -q` → pass. ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import_consultant.py backend/app/routers/categories.py backend/tests/test_consultant_import.py backend/tests/test_interview_import_api.py PROGRESS.md
git commit -m "feat(import): external lineage is create-only and a home claim wins across files — 외부 계보 create-only·파일 간 홈 우선 병합"
```

---

### Task 5: Engine — `apply_interview_linkage` external refs (origin, pre-resolution, titles, reimport update)

**Files:**
- Modify: `backend/scripts/import_consultant.py` (imports :31; `apply_interview_linkage` external section), `backend/scripts/consultant_interview.py` (remove the `external_codes` compat property)
- Test: `backend/tests/test_interview_import_api.py`

**Interfaces:**
- Consumes: `InterviewLinkage.external_refs`, `ExternalRef` (Task 2), `normalize_task_name`, `external_ref_lineage_key` (Task 1).
- Produces report details (verbatim, FE contract):
  - `linked external task '{title}' -> map {id}`
  - `placeholder for external task '{title}' @ {l5_code} (map not delivered yet)` (undeclared refs use `@ unknown`)
  - `external task '{title}' @ {l5_code}: {n} maps share the name - left as placeholder`
  - `external L5 {code} not found - placeholder without origin`

- [ ] **Step 1: Write the failing tests** (append to `test_interview_import_api.py`; reuse `_ext_delivery`, `_files`, `_post`, `_canvas_map_id`, `_draft_id`)

```python
def _ext_ref_delivery(l5_code: str, ref_id: str, target_l5: str, l6: object, *, target_lineage: bool = True,
                      task_ids: list[str] | None = None) -> dict:
    """홈 L5 최소 문서(rows 2) + 선언 외부 참조 1건(rows[0] → ref). target_lineage=False면 외부 L5 계보 미동봉."""
    doc = _ext_delivery(l5_code, task_ids)
    doc["schema_version"] = "0.5-bpm-interface-draft"
    if target_lineage:
        doc["framework"]["categories"].append(
            {"code": target_l5, "name": f"L5 {target_l5}", "level": 5, "parent": "19-01-06-01"})
    doc["externalTasks"] = [{"refId": ref_id, "l5": {"nodeCode": target_l5, "label": f"L5 {target_l5}"}, "l6": l6, "note": None}]
    doc["relations"]["edges"] = [{"src": doc["rows"][0]["taskId"], "dst": ref_id, "kind": "seq", "gateway": None,
                                  "condition": None, "label": "인계", "quote": None}]
    return doc


def _category_id(code: str) -> int | None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _load():
        async with SessionLocal() as session:
            return await session.scalar(select(ProcessCategory.id).where(ProcessCategory.code == code))
    return _run(_load())


def _placeholders(client: TestClient, l5_code: str) -> list[dict]:
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, l5_code))}/graph").json()
    return [n for n in graph["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]


def test_declared_external_ref_places_placeholder_with_origin_and_title(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-A", "ext-a1", "PHY-A-EXT", "외부 업무 A")
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200, res.text
    ph = _placeholders(client, "PHY-A")
    assert len(ph) == 1
    assert ph[0]["title"] == "외부 업무 A"
    assert ph[0]["placeholder_category_id"] == _category_id("PHY-A-EXT")  # 계보 동봉 → 빈 카테고리 생성
    assert any(r["detail"] == "placeholder for external task '외부 업무 A' @ PHY-A-EXT (map not delivered yet)"
               for r in res.json()["rows"])


def test_declared_external_ref_with_null_l6_gets_unspecified_title(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-B", "ext-b1", "PHY-B-EXT", None)
    assert _post(client, _files(doc), apply=True).status_code == 200
    ph = _placeholders(client, "PHY-B")
    assert len(ph) == 1 and ph[0]["title"] == "(L6 unspecified) L5 PHY-B-EXT"


def test_declared_external_ref_unknown_l5_has_no_origin_but_warns(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-C", "ext-c1", "PHY-C-NOWHERE", "어딘가의 업무", target_lineage=False)
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    ph = _placeholders(client, "PHY-C")
    assert len(ph) == 1 and ph[0]["placeholder_category_id"] is None and ph[0]["title"] == "어딘가의 업무"
    assert any(r["detail"] == "external L5 PHY-C-NOWHERE not found - placeholder without origin"
               for r in res.json()["rows"])


def test_declared_external_ref_links_directly_when_exact_name_exists(client: TestClient) -> None:
    # 외부 L5 먼저 전달 — 이름 "검체 접수"
    target = _ext_delivery("PHY-D-EXT", task_ids=["phy-d-ext-0001"])
    target["rows"][0]["l6"] = "검체 접수"
    assert _post(client, _files(target), apply=True).status_code == 200
    doc = _ext_ref_delivery("PHY-D", "ext-d1", "PHY-D-EXT", "검체접수")  # 공백만 다름 → 정규화 일치
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    assert _placeholders(client, "PHY-D") == []
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHY-D'))}/graph").json()
    linked = [n for n in graph["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is not None]
    ext = next(n for n in linked if n["title"] == "검체 접수")
    assert graph["subprocess_refs"][str(ext["linked_map_id"])]["category_path"].endswith("PHY-D-EXT")
    assert any(r["detail"].startswith("linked external task '검체접수' -> map ") for r in res.json()["rows"])


def test_declared_external_ref_ambiguous_name_stays_placeholder(client: TestClient) -> None:
    target = _ext_delivery("PHY-E-EXT", task_ids=["phy-e-ext-0001", "phy-e-ext-0002"])
    target["rows"][0]["l6"] = "중복 이름"
    target["rows"][1]["l6"] = "중복이름"
    assert _post(client, _files(target), apply=True).status_code == 200
    res = _post(client, _files(_ext_ref_delivery("PHY-E", "ext-e1", "PHY-E-EXT", "중복 이름")), apply=True)
    assert res.status_code == 200
    assert len(_placeholders(client, "PHY-E")) == 1
    assert any(r["detail"] == "external task '중복 이름' @ PHY-E-EXT: 2 maps share the name - left as placeholder"
               for r in res.json()["rows"])


def test_reimport_updates_unlinked_placeholder_title_and_origin_without_duplicating(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-F", "ext-f1", "PHY-F-EXT", "옛 이름")
    assert _post(client, _files(doc), apply=True).status_code == 200
    doc["externalTasks"][0]["l6"] = "고친 이름"
    assert _post(client, _files(doc), apply=True).status_code == 200
    ph = _placeholders(client, "PHY-F")
    assert len(ph) == 1 and ph[0]["title"] == "고친 이름"
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHY-F'))}/graph").json()
    assert sum(1 for e in graph["edges"] if e["target_node_id"] == ph[0]["id"]) == 1


def test_legacy_undeclared_code_still_uses_taskid_lineage(client: TestClient) -> None:
    """미선언 코드는 dev 2026-09-06 동작 그대로 — taskId 계보 키, 제목=코드, 출처 없음, 리포트는 @ unknown."""
    doc = _ext_delivery("PHY-G")
    doc["relations"]["edges"].append({"src": doc["rows"][0]["taskId"], "dst": "phy-g-ext-0001", "kind": "seq"})
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    ph = _placeholders(client, "PHY-G")
    assert len(ph) == 1 and ph[0]["title"] == "phy-g-ext-0001" and ph[0]["placeholder_category_id"] is None
    assert any(r["detail"] == "placeholder for external task 'phy-g-ext-0001' @ unknown (map not delivered yet)"
               for r in res.json()["rows"])
```

- [ ] **Step 2: Run to verify failure**

`.venv/bin/python -m pytest tests/test_interview_import_api.py -q -k "declared_external or reimport_updates or legacy_undeclared"` → FAIL.

- [ ] **Step 3: Implement**

3a. Imports (`import_consultant.py:31`):
```python
from app.lineage import external_lineage_key, external_ref_lineage_key, make_node_id, normalize_task_name
```

3b. In `apply_interview_linkage`, replace the `lookup_codes` line with (declared refIds must not be looked up as consultant codes):

```python
        ext_refs = linkage.external_refs
        lookup_codes = set(linkage.map_codes) | {c for c, r in ext_refs.items() if not r.declared}
```

3c. After `map_names = {...}` and the `if not map_ids:` guard, before the canvas lookup, add the origin/pre-resolution block:

```python
        # 외부 참조 해석 — 선언 ref: 출처 L5 + 그 L5 안 정규화 이름 정확 일치 1건이면 선해소.
        # 미선언 코드: taskId로 취급(제목=코드, 출처 없음) (spec 2026-09-07 §6.3)
        ext_l5_ids: dict[str, int] = {}
        ext_l5_names: dict[int, str] = {}
        wanted_l5 = sorted({r.l5_code for r in ext_refs.values() if r.declared and r.l5_code})
        if wanted_l5:
            for cid, ccode, cname in (await session.execute(
                select(ProcessCategory.id, ProcessCategory.code, ProcessCategory.name)
                .where(ProcessCategory.code.in_(wanted_l5))
            )).all():
                ext_l5_ids[ccode] = cid
                ext_l5_names[cid] = cname
        maps_by_l5: dict[int, list[tuple[int, str]]] = {}
        if ext_l5_ids:
            for mid, cid, mname in (await session.execute(
                select(ProcessMap.id, ProcessMap.category_id, ProcessMap.name).where(
                    ProcessMap.category_id.in_(sorted(ext_l5_ids.values())), ProcessMap.deleted_at.is_(None))
            )).all():
                maps_by_l5.setdefault(cid, []).append((mid, mname))
        ext_key: dict[str, str] = {}
        ext_title: dict[str, str] = {}
        ext_origin: dict[str, int | None] = {}
        ext_l5_label: dict[str, str] = {}
        for c, ref in ext_refs.items():
            if not ref.declared:
                ext_key[c], ext_title[c], ext_origin[c], ext_l5_label[c] = external_lineage_key(c), c, None, "unknown"
                continue
            ext_key[c] = external_ref_lineage_key(code, c)
            ext_l5_label[c] = ref.l5_code or "unknown"
            l5_id = ext_l5_ids.get(ref.l5_code or "")
            if l5_id is None:
                report.add(code, "warning", f"external L5 {ref.l5_code} not found - placeholder without origin")
            ext_origin[c] = l5_id
            l5_name = ext_l5_names.get(l5_id) if l5_id is not None else None
            ext_title[c] = ref.name or f"(L6 unspecified) {l5_name or ref.l5_label or ref.l5_code}"
            if ref.name and l5_id is not None:
                wanted = normalize_task_name(ref.name)
                hits = [(mid, mname) for mid, mname in maps_by_l5.get(l5_id, [])
                        if normalize_task_name(mname) == wanted]
                if len(hits) == 1:
                    map_ids[c], map_names[hits[0][0]] = hits[0][0], hits[0][1]
                    report.add(code, "linkage", f"linked external task '{ext_title[c]}' -> map {hits[0][0]}")
                elif len(hits) > 1:
                    report.add(code, "warning",
                               f"external task '{ext_title[c]}' @ {ref.l5_code}: {len(hits)} maps share the name"
                               " - left as placeholder")
```
Note: the `if not map_ids:` guard stays where it is (before this block); a delivery with only external refs and no home maps is still "nothing to place".

3d. Replace every `external_lineage_key(c)` inside `apply_interview_linkage` with `ext_key[c]`, and every use of `linkage.external_codes` with `ext_refs` (`external_present = {c for c in ext_refs if c in map_ids}`, `external_missing = [c for c in ext_refs if c not in map_ids]`).

3e. Reimport update — right after the existing `for c in external_present:` backfill loop, add:

```python
        # 미연결 계보 노드는 이번 값으로 제목·출처 갱신(이름 수정 전파). 연결된 노드는 불변 (spec 2026-09-07 §6.3-4)
        for c, ref in ext_refs.items():
            node = lineage_nodes.get(ext_key[c])
            if node is not None and node.linked_map_id is None and ref.declared:
                node.title = ext_title[c]
                node.placeholder_category_id = ext_origin[c]
```

3f. Placeholder creation loop (`for i, c in enumerate(missing_placeholders):`) — set `title=ext_title[c]`, `placeholder_category_id=ext_origin[c]`, `source_node_id=ext_key[c]`, and change the report line to:

```python
            report.add(code, "linkage",
                       f"placeholder for external task '{ext_title[c]}' @ {ext_l5_label[c]} (map not delivered yet)")
```

3g. `_node_of`: replace `lineage_nodes.get(external_lineage_key(key))` with `lineage_nodes.get(ext_key.get(key, external_lineage_key(key)))`.

3h. Remove the `external_codes` compat property from `InterviewLinkage` (Task 2) and grep `external_codes` across `backend/` — must be zero hits.

- [ ] **Step 4: Run tests**

`.venv/bin/python -m pytest tests/test_interview_import_api.py tests/test_consultant_interview.py -q` → pass, including the pre-existing placeholder tests (`test_external_edge_becomes_placeholder_and_resolves_on_later_delivery` etc.). ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import_consultant.py backend/scripts/consultant_interview.py backend/tests/test_interview_import_api.py PROGRESS.md
git commit -m "feat(import): origin-aware external placeholders with exact-name pre-resolution on the L5 canvas — 출처 있는 플레이스홀더·정확 일치 선해소·재임포트 갱신"
```

---

### Task 6: Engine — resolve placeholders by `(origin L5, normalized name)` on later deliveries

**Files:**
- Modify: `backend/scripts/import_consultant.py` (`resolve_external_placeholders` :712-780)
- Test: `backend/tests/test_interview_import_api.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_name_placeholder_resolves_when_origin_l5_is_delivered_later(client: TestClient) -> None:
    doc_a = _ext_ref_delivery("PHZ-A", "ext-za", "PHZ-A-EXT", "OOS 접수 및 초동 평가")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    ph = _placeholders(client, "PHZ-A")
    assert len(ph) == 1 and ph[0]["placeholder_category_id"] == _category_id("PHZ-A-EXT")

    later = _ext_delivery("PHZ-A-EXT", task_ids=["phz-a-ext-0001", "phz-a-ext-0002"])
    later["rows"][0]["l6"] = "OOS접수 및 초동평가"  # 공백만 다름 → 정규화 일치
    res = _post(client, _files(later), apply=True)
    assert res.status_code == 200, res.text
    assert any(r["detail"] == "resolved 1 external placeholder node(s)" for r in res.json()["rows"])
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHZ-A'))}/graph").json()
    node = next(n for n in graph["nodes"] if n["id"] == ph[0]["id"])
    assert node["linked_map_id"] is not None and node["placeholder_category_id"] is None
    assert node["title"] == "OOS접수 및 초동평가"
    assert any(e["target_node_id"] == node["id"] for e in graph["edges"])  # 엣지 유지


def test_name_placeholder_stays_when_delivery_has_two_maps_with_that_name(client: TestClient) -> None:
    doc_a = _ext_ref_delivery("PHZ-B", "ext-zb", "PHZ-B-EXT", "중복")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    later = _ext_delivery("PHZ-B-EXT", task_ids=["phz-b-ext-0001", "phz-b-ext-0002"])
    later["rows"][0]["l6"] = "중복"
    later["rows"][1]["l6"] = "중 복"
    res = _post(client, _files(later), apply=True)
    assert res.status_code == 200
    assert len(_placeholders(client, "PHZ-B")) == 1
    assert any(r["detail"] == "external task '중복' @ PHZ-B-EXT: 2 maps share the name - left as placeholder"
               for r in res.json()["rows"])


def test_hand_made_placeholder_without_origin_is_not_auto_linked(client: TestClient) -> None:
    """UI 라이브러리 footer가 만드는 이름만 있는 플레이스홀더(placeholder_category_id NULL)는 이름 경로 대상이 아니다."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Node

    doc_a = _ext_ref_delivery("PHZ-C", "ext-zc", "PHZ-C-EXT", "손으로 만든 이름")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    ph = _placeholders(client, "PHZ-C")[0]

    async def _strip_origin():
        async with SessionLocal() as session:
            node = await session.scalar(select(Node).where(Node.id == ph["id"]))
            node.placeholder_category_id = None
            await session.commit()
    _run(_strip_origin())

    later = _ext_delivery("PHZ-C-EXT", task_ids=["phz-c-ext-0001"])
    later["rows"][0]["l6"] = "손으로 만든 이름"
    assert _post(client, _files(later), apply=True).status_code == 200
    assert [n["id"] for n in _placeholders(client, "PHZ-C")] == [ph["id"]]
```

- [ ] **Step 2: Run to verify failure**

`.venv/bin/python -m pytest tests/test_interview_import_api.py -q -k "name_placeholder or hand_made"` → FAIL (placeholders stay unresolved).

- [ ] **Step 3: Implement** — in `resolve_external_placeholders`, change the first query to also select the map name, and add the name path after the taskId loop (before the `if resolved:` report line):

```python
    live_rows = (await session.execute(
        select(ProcessMap.id, ProcessMap.consultant_code, ProcessMap.category_id, ProcessMap.name).where(
            ProcessMap.consultant_code.in_(list(code_to_map.keys())),
            ProcessMap.deleted_at.is_(None),
        )
    )).all()
    live_by_code: dict[str, int] = {}
    for mid, ccode, category_id, _name in live_rows:
        if ccode not in live_by_code or category_id is not None:
            live_by_code[ccode] = mid
```
(keep the rest of the taskId path unchanged, but note `if not live_by_code: return 0` must stay), then:

```python
    # 이름 경로 — 이번 전달분이 건드린 L5마다, 출처가 그 L5인 미연결 플레이스홀더를 정규화 이름 정확 일치(라이브 맵
    # 정확히 1개)로 연결한다. 손으로 만든 플레이스홀더(출처 NULL)는 대상 아님 (spec 2026-09-07 §6.4)
    touched_l5 = sorted({cid for _, _, cid, _ in live_rows if cid is not None})
    if touched_l5:
        cat_codes = dict((await session.execute(
            select(ProcessCategory.id, ProcessCategory.code).where(ProcessCategory.id.in_(touched_l5))
        )).all())
        live_named = (await session.execute(
            select(ProcessMap.id, ProcessMap.category_id, ProcessMap.name).where(
                ProcessMap.category_id.in_(touched_l5), ProcessMap.deleted_at.is_(None))
        )).all()
        by_l5_name: dict[tuple[int, str], list[int]] = {}
        name_by_id: dict[int, str] = {}
        for mid, cid, mname in live_named:
            by_l5_name.setdefault((cid, normalize_task_name(mname)), []).append(mid)
            name_by_id[mid] = mname
        ph_rows = (await session.execute(
            select(Node, MapVersion.checked_out_by, MapVersion.map_id)
            .join(MapVersion, MapVersion.id == Node.version_id).where(
                Node.node_type == "subprocess", Node.linked_map_id.is_(None),
                Node.placeholder_category_id.in_(touched_l5), MapVersion.status == "draft",
            )
        )).all()
        for node, checked_out_by, canvas_map_id in ph_rows:
            if node.placeholder_category_id is None:
                continue
            hits = by_l5_name.get((node.placeholder_category_id, normalize_task_name(node.title)), [])
            if len(hits) > 1:
                report.add("linkage", "warning",
                           f"external task '{node.title}' @ {cat_codes.get(node.placeholder_category_id, '?')}: "
                           f"{len(hits)} maps share the name - left as placeholder")
                continue
            if not hits:
                continue
            if checked_out_by not in (None, actor):
                skipped_canvases.add(canvas_map_id)
                continue
            node.linked_map_id = hits[0]
            node.title = name_by_id[hits[0]]
            node.follow_latest = True
            node.placeholder_category_id = None  # 연결 뒤 출처는 링크맵 카테고리 — FE 연결·슬롯 채움과 같은 소거 규약
            resolved += 1
```
Also move `if not live_by_code: return 0` so the name path still runs when the taskId path has nothing to do: change it to `key_to_map = {...} if live_by_code else {}` and guard the taskId query with `if key_to_map:`.

- [ ] **Step 4: Run tests** — `.venv/bin/python -m pytest tests/test_interview_import_api.py -q` → pass. ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import_consultant.py backend/tests/test_interview_import_api.py PROGRESS.md
git commit -m "feat(import): resolve origin-scoped placeholders by exact normalized name when the origin L5 is delivered — 후차 해소 이름 경로"
```

---

### Task 7: FE report kinds + labels

**Files:**
- Modify: `frontend/src/lib/interview-report.ts:40-53,166-179`, `frontend/src/components/admin/framework-panel.tsx:586-615`, `frontend/src/lib/i18n-messages.ts` (en block near :2209, ko block near :4480)
- Test: `frontend/src/lib/interview-report.test.ts`

- [ ] **Step 1: Write the failing test** (inside `describe("classifyDetail")`)

```ts
  it("classifies the external-reference messages from the importer", () => {
    expect(classifyDetail("linkage", "linked external task '검체 접수' -> map 12")).toMatchObject({
      kind: "external-linked", severity: "info", subject: "검체 접수", numbers: [12],
    });
    expect(classifyDetail("linkage", "placeholder for external task '외부 업무' @ 20-02-01-01-01 (map not delivered yet)"))
      .toMatchObject({ kind: "external-placeholder", subject: "외부 업무" });
    expect(classifyDetail("warning", "external task '중복' @ 20-02-01-01-01: 2 maps share the name - left as placeholder"))
      .toMatchObject({ kind: "external-ambiguous", severity: "warning", subject: "중복", numbers: [2] });
    expect(classifyDetail("warning", "external L5 22-01-01-01-01 not found - placeholder without origin"))
      .toMatchObject({ kind: "external-l5-unknown", subject: "22-01-01-01-01" });
    expect(classifyDetail("linkage", "resolved 3 external placeholder node(s)"))
      .toMatchObject({ kind: "external-resolved", numbers: [3], subject: "" });
  });
```

- [ ] **Step 2: Run** `npx vitest run src/lib/interview-report.test.ts` → FAIL (kind `other`).

- [ ] **Step 3: Implement**

`DetailKind` union — add before `| "other"`:
```ts
  | "external-linked"
  | "external-placeholder"
  | "external-ambiguous"
  | "external-l5-unknown"
  | "external-resolved"
```
`PATTERNS` — add before the `canvas` entry:
```ts
  // 외부 L6 참조(인터뷰 0.5) — 문구는 import_consultant.apply_interview_linkage/resolve_external_placeholders와 계약
  { kind: "external-linked", re: /^linked external task '(.*)' -> map (\d+)$/ },
  { kind: "external-placeholder", re: /^placeholder for external task '(.*)' @ (\S+) \(map not delivered yet\)$/ },
  { kind: "external-ambiguous", re: /^external task '(.*)' @ (\S+): (\d+) maps share the name - left as placeholder$/ },
  { kind: "external-l5-unknown", re: /^external L5 (\S+) not found - placeholder without origin$/ },
  { kind: "external-resolved", re: /^resolved (\d+) external placeholder node\(s\)$/ },
```
`describeMessage` (framework-panel.tsx) — add cases before `default`:
```tsx
      case "external-linked":
        return `${t("framework.importMsgExternalLinked")}: ${subject}`;
      case "external-placeholder":
        return `${t("framework.importMsgExternalPlaceholder")}: ${subject}`;
      case "external-ambiguous":
        return `${t("framework.importMsgExternalAmbiguous")}: ${subject}`;
      case "external-l5-unknown":
        return `${t("framework.importMsgExternalL5Unknown")}: ${subject}`;
      case "external-resolved":
        return t("framework.importMsgExternalResolved");
```
i18n-messages.ts — en block (next to `framework.importMsgCanvasAugmented`):
```ts
  "framework.importMsgExternalLinked": "Linked to a task in another L5",
  "framework.importMsgExternalPlaceholder": "Placeholder for a task in another L5 (not delivered yet)",
  "framework.importMsgExternalAmbiguous": "Several maps share this name - left as a placeholder",
  "framework.importMsgExternalL5Unknown": "External L5 not found - placeholder without origin",
  "framework.importMsgExternalResolved": "External placeholders linked",
```
ko block:
```ts
  "framework.importMsgExternalLinked": "다른 L5의 업무에 연결됨",
  "framework.importMsgExternalPlaceholder": "다른 L5 업무 플레이스홀더(미전달)",
  "framework.importMsgExternalAmbiguous": "같은 이름의 맵이 여럿 - 플레이스홀더 유지",
  "framework.importMsgExternalL5Unknown": "외부 L5 없음 - 출처 없는 플레이스홀더",
  "framework.importMsgExternalResolved": "외부 플레이스홀더 연결됨",
```

- [ ] **Step 4: Run** `npx vitest run src/lib/interview-report.test.ts && npx tsc --noEmit && npm run lint` → green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/interview-report.ts frontend/src/lib/interview-report.test.ts frontend/src/components/admin/framework-panel.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(import-report): classify external-reference importer messages instead of showing raw text — 외부 참조 리포트 문구 5종 분류·라벨"
```

---

### Task 8: Samples A (`consultant-interview-sample/`) rewrite + sample-shape test + smoke counts

**Files:**
- Rewrite: `docs/samples/consultant-interview-sample/calibration-l5.json`, `docs/samples/consultant-interview-sample/utility-l5.json`
- Create: `backend/tests/test_samples_0_5.py`
- Modify: `frontend/scripts/pw-smoke-interview-import.mjs:69-73,80+ (Unchanged)`, `frontend/scripts/pw-smoke-field-promotion.mjs:69-72,150`

**Rules for every rewritten sample (both tasks 8 and 9):**
- `schema_version: "0.5-bpm-interface-draft"`, `labelSource: "human-confirmed"`, `_readme: ["합성 샘플 — 실전달물 아님. 계약·시나리오: docs/samples/interview-json-0.5.md"]`.
- Every row: ≥6 actions with unique `seq`; `relations.edges` contains ≥1 `kind: "branch"` pair out of a `kind: "decision"` action (`gateway: "exclusive"`), and ≥1 `kind: "loop"` back to an earlier seq. Per file at least one row also has a `gateway: "parallel"` branch pair, one `kind: "bypass"` edge, one action with `variant: "exception"` (on the exceptional branch), and one `kind: "handoff"` action.
- Top-level `relations.edges` contains ≥1 `branch` (exclusive) and ≥1 `loop`; `relations.entry.taskId` is a row.
- Every `externalTasks[]` refId is used by ≥1 top-level edge; every ref's `l5.nodeCode` is in `framework.categories` **except** the one intentional case in `qc-raw-material-l5.json`.
- `tasks[]` mirrors rows (id/name/ownerRole/startCondition/endCondition/exceptions/note); `summary` recomputed (`l6_total`, `l7_total`, `l6_edge_total`, `l7_edge_total`, `rows_total`, …) — informational only.
- Domain voice: Korean pharma QA/QC/EPCV, quotes as spoken Korean, `fields.*_min` numeric where given.

Row template (copy its structure for each new row; change seq labels/conditions to the row's domain):

```jsonc
{
  "taskId": "smp-cal-task-0004", "unitId": "smp-cal-unit-0004", "l6": "표준기 유효성 확인 및 교체",
  "owner": null, "ownerRole": "표준기 관리자", "approvers": ["cheolsu.kim"],
  "department": "Quality Center/QC Department/QC Support Team/QC Sample Management Group",
  "fields": { "start_condition": "현장에서 표준기 유효기간 경과 의심", "input_data": "표준기 관리대장", "output_data": "유효 표준기 확정 목록",
              "done_criteria": "유효 표준기가 확정되고 대장이 갱신되면 끝", "systems": "EAM", "total_time": "건당 30분", "total_time_min": 30,
              "touch_time": "20분", "touch_time_min": 20, "frequency": "월 2회", "annual_count": 24, "headcount": 1, "fte": 0.01,
              "gmp": "표준기 관리대장은 GMP 기록", "artifact_role": "record" },
  "actions": [
    { "seq": 1, "label": "대장 조회", "name": "표준기 관리대장에서 해당 표준기의 유효기간을 조회한다", "kind": "action", "variant": "normal", "rule": null, "input": "표준기 관리대장", "output": "유효기간 확인 결과", "system": "EAM", "screen": null, "dataForm": "structured", "quote": null },
    { "seq": 2, "label": "유효기간 판정", "name": "유효기간 내인지 판정한다", "kind": "decision", "variant": "normal", "rule": "유효기간 내면 계속 사용, 경과면 교체", "input": null, "output": null, "system": null, "screen": null, "dataForm": null, "quote": null },
    { "seq": 3, "label": "대체 표준기 선정", "name": "같은 범위를 커버하는 대체 표준기를 고른다", "kind": "action", "variant": "normal", "rule": null, "input": "유효기간 확인 결과", "output": "대체 표준기", "system": "EAM", "screen": null, "dataForm": null, "quote": null },
    { "seq": 4, "label": "임시 사용 승인", "name": "대체가 없으면 QA에 임시 사용 승인을 받는다", "kind": "action", "variant": "exception", "rule": "대체 표준기 없음 > QA 임시 사용 승인", "input": null, "output": "임시 사용 승인서", "system": "QMS", "screen": null, "dataForm": null, "quote": "대체가 없으면 QA 승인 받고 그냥 써요." },
    { "seq": 5, "label": "대장 갱신", "name": "표준기 관리대장을 갱신한다", "kind": "action", "variant": "normal", "rule": null, "input": "대체 표준기", "output": "갱신된 관리대장", "system": "EAM", "screen": null, "dataForm": "structured", "quote": null },
    { "seq": 6, "label": "현장 인계", "name": "확정 표준기를 현장 교정 담당자에게 인계한다", "kind": "handoff", "variant": "normal", "rule": null, "input": "갱신된 관리대장", "output": "유효 표준기 확정 목록", "system": null, "screen": null, "dataForm": null, "quote": null }
  ],
  "relations": { "edges": [
    { "src": 1, "dst": 2, "kind": "seq", "gateway": null, "condition": null, "label": null, "quote": null },
    { "src": 2, "dst": 6, "kind": "branch", "gateway": "exclusive", "condition": "유효기간 내", "label": "계속 사용", "quote": null },
    { "src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "유효기간 경과", "label": "교체", "quote": "기간 지났으면 바꿔야죠." },
    { "src": 3, "dst": 4, "kind": "bypass", "gateway": null, "condition": "대체 표준기 없음", "label": "임시 사용", "quote": null },
    { "src": 3, "dst": 5, "kind": "seq", "gateway": null, "condition": null, "label": null, "quote": null },
    { "src": 4, "dst": 5, "kind": "seq", "gateway": null, "condition": null, "label": null, "quote": null },
    { "src": 5, "dst": 1, "kind": "loop", "gateway": null, "condition": "갱신 후 재확인", "label": "재확인", "quote": null },
    { "src": 5, "dst": 6, "kind": "seq", "gateway": null, "condition": null, "label": null, "quote": null }
  ]}
}
```

**calibration-l5.json (L5 `19-01-06-01-02`)** — keep rows 1–3 (`smp-cal-task-0001/0002/0003`) **byte-for-byte as today** (smoke anchors: actions[0] input/output, fields, owner null, approvers, department, `annual_count 52`), keep `tasks[0..2]`, `sideNotes`, `openItems`, `relations.entry`; add:
- Row 4 `smp-cal-task-0004` "표준기 유효성 확인 및 교체" (template above, `approvers: ["cheolsu.kim"]`).
- Row 5 `smp-cal-task-0005` "교정 부적합 처리" (ownerRole "교정 담당자", `approvers: ["cheolsu.kim", "younghee.lee"]`, includes a `parallel` pair: 통보와 격리 표시를 동시에, then exclusive 재교정/폐기 decision, loop 재측정, handoff QA).
- Top-level edges: existing 4 + `0002→0004 branch exclusive "현장에서 표준기 이상 발견"`, `0004→0002 loop "표준기 교체 후 재수행"`, `0002→0005 branch exclusive "허용오차 초과"`, `0005→0003 seq "부적합 처리 후 보고"`, `0003→ext-util-daily-check seq "교정 완료 계측기 일상 점검 재개"`, `ext-eam-work-order→0001 seq "작업지시 발행 후 준비 시작"`.
- `externalTasks`:
```json
[
  { "refId": "ext-util-daily-check", "l5": { "nodeCode": "19-01-02-01-01", "label": "정제수 일상 점검" }, "l6": "정제수 일상 점검 수행", "note": "교정 끝난 계기는 그날 라운드부터 다시 본다고 함" },
  { "refId": "ext-eam-work-order", "l5": { "nodeCode": "19-01-05-01-01", "label": "설비 작업지시 운영" }, "l6": "작업지시 발행 및 배정", "note": "발행 주체는 설비보전팀 — 이 L5는 아직 인터뷰 전" }
]
```
- `framework.categories`: home 5 + `19-01-02 유틸리티 운전 (L3, parent 19-01)`, `19-01-02-01 정제수 시스템 운전 (L4)`, `19-01-02-01-01 정제수 일상 점검 (L5)`, `19-01-05 설비 보전 (L3, parent 19-01)`, `19-01-05-01 작업지시 관리 (L4)`, `19-01-05-01-01 설비 작업지시 운영 (L5)`.

**utility-l5.json (L5 `19-01-02-01-01`)** — keep row 1's `taskId/unitId/l6/owner(null)/ownerRole/approvers/department(null)/fields` exactly; **expand its actions** to ≥6 with a decision branch + loop (계기값 확인 → 이상 판정 ◇ → 재측정 loop / 기록 → 인계). Add rows `smp-util-task-0002` "수질 이상 대응", `smp-util-task-0003` "정제수 시스템 소독 운전", `smp-util-task-0004` "점검 기록 검토 및 승인" (owner null, approvers [], department null — this is the owner-less sample). Top-level edges: `0001→0002 branch exclusive "이상값 발견"`, `0001→0004 branch exclusive "정상"`, `0002→0001 loop "재측정 후 라운드 복귀"`, `0002→0003 seq "오염 의심 시 소독"`, `0003→0004 seq`, `0004→0001 loop "반려 시 재점검"`, `0002→ext-cal-report branch exclusive "계기 이상 의심 시 교정 의뢰"`, `ext-eam-unnamed→0003 seq "소독 작업지시 발행"`.
- `externalTasks`:
```json
[
  { "refId": "ext-cal-report", "l5": { "nodeCode": "19-01-06-01-02", "label": "Calibration 수행 및 결과 보고" }, "l6": "교정 결과 보고", "note": "실제 업무명이 더 길 수 있음(…및 이력 등록) — 이름 근사 케이스" },
  { "refId": "ext-eam-unnamed", "l5": { "nodeCode": "19-01-05-01-01", "label": "설비 작업지시 운영" }, "l6": null, "note": "어느 작업지시 업무인지 미확정 — L5만 아는 케이스" }
]
```
- `framework.categories`: home 5 + calibration lineage (`19-01-06`, `19-01-06-01`, `19-01-06-01-02`, names as in calibration) + EAM lineage (same three as above).

- [ ] **Step 1: Write the failing sample-shape test** `backend/tests/test_samples_0_5.py`:

```python
"""저장소 인터뷰 샘플(0.5) 규격 고정 — 7파일 error 0·의도 경고만·L6 ≥4·행마다 loop+branch·externalTasks 전부
참조·스모크 앵커 보존 (spec 2026-09-07 §8). 샘플을 고치면 이 테스트가 규격 이탈을 잡는다."""

import json
from pathlib import Path

import pytest

from scripts.consultant_interview import convert_interview

SAMPLES = Path(__file__).resolve().parents[2] / "docs" / "samples"
FILES = sorted((SAMPLES / "consultant-interview-sample").glob("*.json")) + sorted(
    (SAMPLES / "framework-linkage-dummy").glob("*.json"))
# 파일별 의도된 warning 부분 문자열 — 그 외 warning은 규격 이탈
INTENDED_WARNINGS: dict[str, list[str]] = {
    "qc-raw-material-l5.json": ["external L5 '22-01-01-01-01' not in framework.categories"],
}


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_sample_converts_without_errors_or_unintended_warnings(path: Path) -> None:
    res = convert_interview(_load(path))
    errors = [(i.path, i.message) for i in res.issues if i.severity == "error"]
    assert not errors, errors
    allowed = INTENDED_WARNINGS.get(path.name, [])
    unexpected = [(i.path, i.message) for i in res.issues
                  if i.severity == "warning" and not any(a in i.message for a in allowed)]
    assert not unexpected, unexpected


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_sample_shape_meets_the_0_5_spec(path: Path) -> None:
    doc = _load(path)
    assert doc["schema_version"].startswith("0.5")
    rows = doc["rows"]
    assert len(rows) >= 4
    for row in rows:
        kinds = [e["kind"] for e in row["relations"]["edges"]]
        assert "loop" in kinds, row["taskId"]
        assert "branch" in kinds, row["taskId"]
        assert any(a["kind"] == "decision" for a in row["actions"]), row["taskId"]
        assert len(row["actions"]) >= 6, row["taskId"]
    top = doc["relations"]["edges"]
    assert {"branch", "loop"} <= {e["kind"] for e in top}
    refs = {t["refId"] for t in doc["externalTasks"]}
    assert refs
    assert refs <= {e["src"] for e in top} | {e["dst"] for e in top}
    text = json.dumps(doc, ensure_ascii=False)
    for needle in ('"gateway": "parallel"', '"kind": "bypass"', '"variant": "exception"', '"kind": "handoff"'):
        assert needle in text, f"{path.name} lacks {needle}"


def test_calibration_keeps_smoke_anchors() -> None:
    doc = _load(SAMPLES / "consultant-interview-sample" / "calibration-l5.json")
    row = next(r for r in doc["rows"] if r["taskId"] == "smp-cal-task-0001")
    assert row["l6"] == "교정 준비" and row["owner"] is None
    assert row["actions"][0]["input"] == "그 주 작업지시"
    assert row["actions"][0]["output"] == "대상 계측기와 측정 범위"
    assert row["fields"]["annual_count"] == 52 and row["fields"]["artifact_role"] == "deliverable"
    assert row["fields"]["start_condition"].startswith("교정 주기 도래")
    util = _load(SAMPLES / "consultant-interview-sample" / "utility-l5.json")
    assert util["rows"][0]["taskId"] == "smp-util-task-0001" and util["rows"][0]["owner"] is None
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_samples_0_5.py -q` → FAIL (0.4 versions, <4 rows, no externalTasks).

- [ ] **Step 3: Author the two JSON files** per the specifications above. Validate structure while authoring:

```bash
cd backend && .venv/bin/python - <<'PY'
import json, sys
sys.path.insert(0, ".")
from scripts.consultant_interview import convert_interview
for n in ("calibration-l5.json", "utility-l5.json"):
    d = json.load(open(f"../docs/samples/consultant-interview-sample/{n}"))
    r = convert_interview(d)
    print(n, "errors:", [(i.path, i.message) for i in r.issues if i.severity == "error"])
    print(n, "warnings:", [(i.path, i.message) for i in r.issues if i.severity == "warning"])
    print(n, "maps:", len(r.maps), "external_refs:", list(r.linkage.external_refs))
PY
```

- [ ] **Step 4: Run** `.venv/bin/python -m pytest tests/test_samples_0_5.py -q -k "calibration or utility"` → pass for the two A files (B files still fail until Task 9 — that is expected; run with `-k` here).

- [ ] **Step 5: Measure the new smoke counts and update constants.** Start the servers (backend `.venv/bin/uvicorn app.main:app --port 8000` on a freshly seeded dev.db per `docs/deploy/db-seed.md`; frontend `npm run dev`), then:

```bash
cd backend && .venv/bin/python - <<'PY'
import json, sys, urllib.request
sys.path.insert(0, ".")
from scripts.consultant_interview import convert_interview
names = ("calibration-l5.json", "utility-l5.json")
docs = {n: json.load(open(f"../docs/samples/consultant-interview-sample/{n}")) for n in names}
files = [{"name": n, "content": d} for n, d in docs.items()]
req = urllib.request.Request("http://localhost:8000/api/categories/import-interview",
    data=json.dumps({"files": files, "apply": False, "label": "count"}).encode(),
    headers={"Content-Type": "application/json", "X-Dev-User": "admin.sys"})
body = json.load(urllib.request.urlopen(req))
print("summary:", body["summary"])  # created → 'Created N' / 'Unchanged N', notes → 'Notes N'
res = convert_interview(docs["calibration-l5.json"])
print("교정 준비 note rows:", sum(1 for n in res.notes if n.map_code == "smp-cal-task-0001"))
PY
```
Update: `pw-smoke-interview-import.mjs` — `chip(page, "Created", 4)` → created N (two places: dry-run and the re-dry-run `Unchanged`), `chip(page, "Notes", 17)` → notes N, `noteRows === 6` → measured 교정 준비 note rows; `pw-smoke-field-promotion.mjs` — `chip(page, "Created", 4)` → N, `chip(page, "Notes", 8)` → N (this smoke uses the same two files; confirm by reading its `SAMPLE_DIR`), `noteRows === 4` → measured. Update the adjacent comments to say "0.5 샘플 기준". Then run `BASE_URL=http://localhost:3000 node scripts/pw-smoke-interview-import.mjs` from `frontend/` on a reseeded DB and confirm the count checks PASS; failures unrelated to samples (pre-existing staleness, e.g. a missing note text) are reported in the commit body, not silently fixed.

- [ ] **Step 6: Commit**

```bash
git add docs/samples/consultant-interview-sample/calibration-l5.json docs/samples/consultant-interview-sample/utility-l5.json backend/tests/test_samples_0_5.py frontend/scripts/pw-smoke-interview-import.mjs frontend/scripts/pw-smoke-field-promotion.mjs PROGRESS.md
git commit -m "docs(samples): rewrite the EPCV interview samples as 0.5 with external L6 references and richer L7 flows — EPCV 샘플 0.5 재작성(외부 참조·순환·분기)"
```

---

### Task 9: Samples B (`framework-linkage-dummy/`) rewrite + scenario test + README

**Files:**
- Rewrite: `qc-raw-material-l5.json`, `qc-finished-product-l5.json`, `qa-deviation-oos-l5.json`, `change-control-l5.json`; `git mv brr-large-l5.json brr-l5.json` then rewrite.
- Modify: `backend/tests/test_samples_0_5.py` (scenario test), `docs/README.md:44-45`

Per-file specification (keep each file's existing L5 code/name, taskIds, row names, departments/owners as they are today; rewrite L7 per the Task 8 rules):

| File / L5 | Rows (taskId → l6) | externalTasks | Top-level external edges | External lineage in `framework.categories` |
|---|---|---|---|---|
| `qc-raw-material-l5.json` `20-01-01-01-01` | dmy-rm-task-0001 원자재 검체 채취 및 접수 · 0002 원자재 이화학 시험 · 0003 원자재 미생물 시험 · 0004 원자재 시험 판정 및 사용 승인 | `ext-oos-intake` → `20-02-01-01-01` "OOS 접수 및 초동 평가" · `ext-purchase-receipt` → `22-01-01-01-01` (label "입고 검수 관리") "입고 검수" **(no lineage — intentional origin-unknown)** | `0002→ext-oos-intake branch exclusive "규격 이탈(OOS)"` · `0003→ext-oos-intake branch exclusive "규격 이탈(OOS)"` · `ext-purchase-receipt→0001 seq "입고 검수 완료 후 채취 의뢰"` | 20-02 품질보증(QA) · 20-02-01 품질 이벤트 관리 · 20-02-01-01 일탈 관리 · 20-02-01-01-01 시험 일탈·OOS 관리 |
| `qc-finished-product-l5.json` `20-01-01-02-01` | dmy-fp-task-0001 출하 시험 의뢰 접수 및 계획 · 0002 완제품 품질 시험 수행 · 0003 안정성 시험 검체 관리 · 0004 시험 성적서 발행 및 출하 승인 | `ext-brr-intake` → `21-06-01-01-01` "검토 접수 및 배치 편성" · `ext-oos-intake` → `20-02-01-01-01` "OOS접수 및 초동평가" (whitespace variant) | `0004→ext-brr-intake seq "성적서 발행 후 BRR 편성으로"` · `0002→ext-oos-intake branch exclusive "OOS 발생"` | 21 Quality System · 21-06 배치기록 검토 · 21-06-01 완제품 배치기록 검토 · 21-06-01-01 BRR 수행 및 종결 · 21-06-01-01-01 완제품 배치기록 검토 수행 + QA deviation lineage (as above) |
| `qa-deviation-oos-l5.json` `20-02-01-01-01` | dmy-qa-task-0001 OOS 접수 및 초동 평가 · 0002 실험실 조사 수행(Phase 1) · 0003 확대 조사 및 CAPA 수립(Phase 2) · 0004 일탈 종결 및 효과성 평가 | `ext-cc-intake` → `21-03-02-01-01` "변경요청 접수" (near-miss) · `ext-capa-unnamed` → `20-02-01-02-01` (label "CAPA 실행 및 효과성 확인") `l6: null` | `0003→ext-cc-intake branch exclusive "공정 변경 필요"` · `0003→ext-capa-unnamed branch exclusive "CAPA 등록"` · `ext-capa-unnamed→0004 seq "CAPA 완료 후 종결"` | 21 · 21-03 변경관리 · 21-03-02 제조 변경관리 · 21-03-02-01 변경 실행 및 완료 · 21-03-02-01-01 공정 변경관리 실행 + 20-02-01-02 CAPA 관리 (L4, parent 20-02-01) · 20-02-01-02-01 CAPA 실행 및 효과성 확인 (L5) |
| `change-control-l5.json` `21-03-02-01-01` | cc-task-0001 변경 요청 접수 및 분류 · 0002 영향평가 및 승인 · 0003 변경 실행 및 검증 · 0004 변경 완료 및 문서화 (keep the existing IO exact-match design) | `ext-dev-closure` → `20-02-01-01-01` "일탈 종결 및 효과성 평가" · `ext-brr-cert` → `21-06-01-01-01` "적합 판정서 발행 및 통보" | `0003→ext-dev-closure branch exclusive "실행 중 일탈 발생"` · `ext-dev-closure→0004 seq "일탈 종결 후 완료"` · `0004→ext-brr-cert seq "변경 후 첫 배치 BRR 판정 확인"` | QA deviation lineage (20 · 20-02 · 20-02-01 · 20-02-01-01 · 20-02-01-01-01) + BRR lineage (21-06 · 21-06-01 · 21-06-01-01 · 21-06-01-01-01) |
| `brr-l5.json` `21-06-01-01-01` | brr-task-0001 검토 접수 및 배치 편성 · 0002 제조기록 전수 검토 · 0003 시험기록 대조 확인 · 0004 일탈·OOS 연계 확인 · 0005 검토 종결 판정 · 0006 적합 판정서 발행 및 통보 | `ext-fp-cert` → `20-01-01-02-01` "시험 성적서 발행 및 출하 승인" · `ext-dev-closure` → `20-02-01-01-01` "일탈 종결 및 효과성 평가" | `ext-fp-cert→0003 seq "성적서 수령 후 대조"` · `0004→ext-dev-closure branch exclusive "미종결 일탈 있음"` · `ext-dev-closure→0005 seq "종결 확인 후 판정"` | 20 Quality · 20-01 품질관리(QC) · 20-01-01 시험 운영 · 20-01-01-02 완제품 시험 · 20-01-01-02-01 완제품 출하 시험 관리 + QA deviation lineage |

(The home lineage of each file stays exactly as today. `brr-l5.json` keeps 6 rows but normal size — 6–9 actions per row.)

- [ ] **Step 1: Add the failing scenario test** to `backend/tests/test_samples_0_5.py`:

```python
def _load_set(names: list[str]) -> list[dict]:
    folder = SAMPLES / "framework-linkage-dummy"
    return [{"name": n, "content": _load(folder / n)} for n in names]


def _canvas_nodes(client, l5_code: str) -> tuple[list[dict], list[dict], dict]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _canvas():
        async with SessionLocal() as session:
            cat = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == l5_code))
            return cat.linkage_map_id
    map_id = __import__("asyncio").run(_canvas())
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    sp = [n for n in graph["nodes"] if n["node_type"] == "subprocess"]
    return [n for n in sp if n["linked_map_id"] is None], [n for n in sp if n["linked_map_id"] is not None], graph


def test_linkage_dummy_set_scenarios_end_to_end(client) -> None:
    """B 세트: qa-deviation 없이 4파일 → 플레이스홀더, 그 뒤 qa-deviation 전달 → 이름 경로 후차 해소 (spec 2026-09-07 §8)."""
    first = ["qc-raw-material-l5.json", "qc-finished-product-l5.json", "change-control-l5.json", "brr-l5.json"]
    res = client.post("/api/categories/import-interview",
                      json={"files": _load_set(first), "apply": True, "label": "B-1"})
    assert res.status_code == 200, res.text
    assert all(f["ok"] for f in res.json()["files"]), res.json()["files"]

    # qc-raw-material: OOS 접수(qa-deviation 미전달 → 출처 있는 플레이스홀더) + 구매 L5(계보 없음 → 출처 없음)
    ph, linked, _ = _canvas_nodes(client, "20-01-01-01-01")
    titles = {n["title"]: n for n in ph}
    assert titles["OOS 접수 및 초동 평가"]["placeholder_category_id"] is not None
    assert titles["입고 검수"]["placeholder_category_id"] is None
    # qc-finished-product: brr 정확 일치 직결, OOS(공백 변형)는 플레이스홀더(qa-deviation 미전달)
    ph, linked, _ = _canvas_nodes(client, "20-01-01-02-01")
    assert "검토 접수 및 배치 편성" in {n["title"] for n in linked}
    assert "OOS접수 및 초동평가" in {n["title"] for n in ph}
    # change-control: brr 직결 1 + 일탈 종결 플레이스홀더 1 / brr: fp 직결 1 + 일탈 종결 플레이스홀더 1
    ph_cc, linked_cc, _ = _canvas_nodes(client, "21-03-02-01-01")
    assert len(linked_cc) == 1 and len(ph_cc) == 1
    ph_brr, linked_brr, _ = _canvas_nodes(client, "21-06-01-01-01")
    assert len(linked_brr) == 1 and len(ph_brr) == 1

    res2 = client.post("/api/categories/import-interview",
                       json={"files": _load_set(["qa-deviation-oos-l5.json"]), "apply": True, "label": "B-2"})
    assert res2.status_code == 200, res2.text
    assert res2.json()["files"][0]["ok"], res2.json()["files"][0]
    # 후차 해소: OOS 접수(정확·공백 변형) 2 + 일탈 종결 2 = 4
    assert any(r["detail"] == "resolved 4 external placeholder node(s)" for r in res2.json()["rows"])
    ph, _, _ = _canvas_nodes(client, "20-01-01-01-01")
    assert [n["title"] for n in ph] == ["입고 검수"]  # 출처 없는 것만 남는다
    assert _canvas_nodes(client, "20-01-01-02-01")[0] == []
    assert _canvas_nodes(client, "21-03-02-01-01")[0] == [] and _canvas_nodes(client, "21-06-01-01-01")[0] == []
    # qa-deviation 자신의 캔버스: 변경관리 근사 불일치 플레이스홀더(출처=변경관리 L5) + unnamed CAPA 플레이스홀더
    ph_qa, linked_qa, _ = _canvas_nodes(client, "20-02-01-01-01")
    by_title = {n["title"]: n for n in ph_qa}
    assert by_title["변경요청 접수"]["placeholder_category_id"] is not None
    assert any(t.startswith("(L6 unspecified) ") for t in by_title)
    assert linked_qa == []
```
(Import `client` fixture from `conftest` implicitly by parameter name; add `from fastapi.testclient import TestClient` only if type hints are wanted.)

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_samples_0_5.py -q` → FAIL for B files.

- [ ] **Step 3: `git mv docs/samples/framework-linkage-dummy/brr-large-l5.json docs/samples/framework-linkage-dummy/brr-l5.json`, then author the five files** per the table and the Task 8 rules; validate each with the Step 3 snippet from Task 8 (adjust folder/names).

- [ ] **Step 4: Update `docs/README.md` lines 44–45**:

```markdown
[`samples/consultant-interview-sample/`](samples/consultant-interview-sample/) — 인터뷰 결과 JSON(0.5) 합성 샘플 2파일(EPCV: calibration·utility). 각 L5에 L6 ≥4, 순환·분기 포함, 타 L5 참조(`externalTasks`) 동봉. 계약·시나리오 매트릭스: [`samples/interview-json-0.5.md`](samples/interview-json-0.5.md). 설정 > Framework > Interview import 입력, 실전달물 아님.
[`samples/framework-linkage-dummy/`](samples/framework-linkage-dummy/) — L5 연계 캔버스 시연용 더미 L5 5종(0.5, Quality 계열: qc-raw-material·qc-finished-product·qa-deviation-oos·change-control·brr). 서로를 `externalTasks`로 참조해 정확 일치 직결·근사 불일치 플레이스홀더·후차 해소·origin unknown을 한 세트로 시연한다.
```

- [ ] **Step 5: Run** `.venv/bin/python -m pytest tests/test_samples_0_5.py -q` → all pass; then the whole backend suite (full-green command) + ruff.

- [ ] **Step 6: Commit**

```bash
git add docs/samples/framework-linkage-dummy backend/tests/test_samples_0_5.py docs/README.md PROGRESS.md
git commit -m "docs(samples): rewrite the Quality linkage dummy set as 0.5 with cross-L5 external references — 연계 더미 5종 0.5 재작성(교차 참조·후차 해소 시연)"
```

---

### Task 10: Consultant contract doc, field-map, spec/handoff notes, gates, screenshot, push

**Files:**
- Create: `docs/samples/interview-json-0.5.md`
- Modify: `docs/qa/interview-import-field-map.md` (§1 최상위 table + new §2-2), `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` (§8 footnote), `docs/design/2026-09-01-interview-import-v04-result.md` (§4), `PROGRESS.md`

- [ ] **Step 1: Write `docs/samples/interview-json-0.5.md`**

```markdown
# 인터뷰 결과 JSON `0.5-bpm-interface-draft` — 외부 L6 참조 계약

컨설턴트 전달용. 0.4(흐름 그래프)와의 델타만 다룬다 — 나머지 키는 0.4와 동일하며 `docs/qa/interview-import-field-map.md`가 착지를 설명한다.
설계: `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`.

## 1. 왜 필요한가
전달은 L5 단위인데, L6 흐름(`relations.edges`)에 **다른 L5의 L6**가 등장한다. 그 L6는 아직 인터뷰 전이라 `taskId`가 없고, 알 수 있는 것은 **소속 L5 코드**와 **대략적인 이름**(없을 수도, 실제와 다를 수도)이다. 0.5는 이를 `externalTasks[]`로 선언하고 엣지가 `refId`로 가리키게 한다. BPM은 그 자리를 **플레이스홀더 노드**(출처 L5 배지)로 두고, 그 L5가 전달되면 **같은 L5 안에서 이름이 정확히 일치하는 맵이 1개**일 때만 자동 연결한다. 나머지는 화면에서 사람이 연결한다.

## 2. 추가 키 — `externalTasks[]` (선택)
```jsonc
"schema_version": "0.5-bpm-interface-draft",
"externalTasks": [
  {
    "refId": "ext-oos-intake",        // 필수. 파일 안 유일, rows[].taskId와 겹치면 안 됨. 엣지 src/dst에 taskId 자리 그대로 사용
    "l5": { "nodeCode": "20-02-01-01-01", "label": "시험 일탈·OOS 관리" },  // nodeCode 필수, label은 참고용
    "l6": "OOS 접수 및 초동 평가",    // 이름 힌트. 모르면 null
    "note": "완료 후 일탈이 열리면 QA로 넘긴다고 함"   // 선택 — 홈 L5 노트로 저장
  }
]
```

| 키 | 필수 | 설명 |
|---|---|---|
| `refId` | ✅ | 파일 안 유일 식별자. 접두 `ext-` 권장. 재전달 때도 **같은 refId를 유지**해야 이름 수정이 같은 노드에 반영된다 |
| `l5.nodeCode` | ✅ | 외부 L6가 속한 L5의 업무체계 코드 |
| `l5.label` | — | 사람이 읽는 L5 이름(참고용) |
| `l6` | — | 외부 L6 이름 힌트. `null` 허용(L5만 아는 경우) → BPM 제목 `"(L6 unspecified) {L5명}"` |
| `note` | — | 참조에 대한 메모 → BPM 홈 L5 노트(kind `external`) |

## 3. 엣지 끝점 해석
`relations.edges[].src|dst`는 **① `rows[].taskId` → ② `externalTasks[].refId` → ③ 둘 다 아님** 순으로 해석한다.
- ①+① 홈 L6 사이 엣지(0.4와 동일) · ①+② 외부 엣지(선언) · ①+③ **외부 엣지(미선언)** — 그 문자열을 "실 taskId를 아는 외부 L6"로 보고 플레이스홀더로 두되 경고를 낸다(가급적 ②로 선언할 것) · ②/③+②/③ 제외(이 L5의 캔버스 것이 아님).
- `relations.entry.taskId`는 rows만. 외부에서 들어오는 시작은 `ext → 첫 L6` 엣지로 표현한다.

## 4. 외부 L5의 계보
외부 L5의 L1~L5 체인을 **`framework.categories`에 그대로 이어서** 넣는다(새 형식 없음). BPM은 홈 `l5.nodeCode`의 조상 체인 밖 항목을 외부 계보로 판정해 **없을 때만 생성하고, 있으면 이름·부모를 절대 바꾸지 않는다**. 체인이 끊긴 외부 항목(부모가 파일에 없음)은 경고 후 제외하고, `nodeCode`는 BPM의 기존 체계에서 찾는다. 계보를 안 넣어도 되지만, BPM에도 그 L5가 없으면 플레이스홀더는 출처 없이(제목만) 놓인다.

## 5. 검증 심각도
| 대상 | error(파일 전체 제외) | warning |
|---|---|---|
| `externalTasks` | 리스트가 아님 | — |
| `externalTasks[i]` | 객체 아님 · `refId` 누락/중복/`taskId` 충돌 · `l5` 또는 `nodeCode` 누락 | 미지 키 · 엣지에서 참조되지 않음(무시) |
| `externalTasks[i].l5` | — | `nodeCode`가 파일 categories에 없음(기존 체계로 해석) |
| `externalTasks[i].l6` | — | 200자 초과 절단 |

## 6. BPM 처리 요약
1. 외부 L5의 라이브 맵 중 **정규화 이름**(대소문자·전각/반각·공백 무시)이 같은 것이 정확히 1개 → 즉시 연결(외부 L6 색). 2개 이상 → 연결 안 함 + 경고. 0개 → 플레이스홀더(제목=`l6` 또는 `(L6 unspecified) L5명`, 출처 배지=L5).
2. 그 L5가 나중에 전달되면 같은 규칙으로 플레이스홀더를 자동 연결한다(엣지·좌표 유지).
3. 자동 연결이 안 된 플레이스홀더는 캔버스에서 **Connect** 배너 → 연결 다이얼로그(출처 L5 자동 펼침)로 사람이 연결한다. 미해소 플레이스홀더가 있으면 그 L5는 확정(confirmed)으로 갈 수 없다.
4. 재전달 시 같은 `refId`의 미연결 플레이스홀더는 제목·출처가 새 값으로 갱신된다(중복 노드 없음). 이미 연결된 노드는 건드리지 않는다.

## 7. 샘플 7종 — 시나리오 매트릭스
| 파일 (L5) | 외부 참조 | 시나리오 |
|---|---|---|
| `consultant-interview-sample/calibration-l5.json` | utility "정제수 일상 점검 수행" | 세트 안 존재·정확 일치 → 같은 배치면 직결, 따로 올리면 후차 해소 |
| | EAM `19-01-05-01-01` "작업지시 발행 및 배정"(계보 동봉) | 세트 밖 → 빈 카테고리 생성 + 출처 있는 플레이스홀더 |
| `consultant-interview-sample/utility-l5.json` | calibration "교정 결과 보고" | 근사 불일치(실명 "…및 이력 등록") → 플레이스홀더 → 수동 연결 |
| | EAM `l6: null` | `(L6 unspecified) …` 플레이스홀더 |
| `framework-linkage-dummy/qc-raw-material-l5.json` | qa-deviation "OOS 접수 및 초동 평가" | 정확 일치 |
| | 구매 `22-01-01-01-01` "입고 검수"(**계보 없음**) | BPM에도 없음 → 경고, 출처 없는 플레이스홀더(세트 중 유일한 의도 경고) |
| `framework-linkage-dummy/qc-finished-product-l5.json` | brr "검토 접수 및 배치 편성" · qa-deviation "OOS접수 및 초동평가" | 정확 일치 · 공백만 다름(정규화 일치) |
| `framework-linkage-dummy/qa-deviation-oos-l5.json` | change-control "변경요청 접수" · CAPA `l6: null`(계보 동봉) | 근사 불일치 → 수동 · unnamed 플레이스홀더 |
| `framework-linkage-dummy/change-control-l5.json` | qa-deviation "일탈 종결 및 효과성 평가" · brr "적합 판정서 발행 및 통보" | 한 캔버스에 외부 L6 2종(L5 색 2개) |
| `framework-linkage-dummy/brr-l5.json` | qc-finished-product "시험 성적서 발행 및 출하 승인" · qa-deviation "일탈 종결 및 효과성 평가" | 정확 일치 |

**후차 해소 시연**: 설정 > Framework > Interview import에 `framework-linkage-dummy/` 중 `qa-deviation-oos-l5.json`을 **빼고** 4파일 apply → 각 캔버스에 OOS·일탈 종결 플레이스홀더(출처 배지) → `qa-deviation-oos-l5.json`만 apply → 리포트에 `resolved 4 external placeholder node(s)`, 캔버스의 플레이스홀더가 실 노드(외부 L6 색)로 바뀐다. `입고 검수`(출처 없음)와 `변경요청 접수`(근사 불일치)는 남아 Connect 배너로 잇는다.
```

- [ ] **Step 2: `docs/qa/interview-import-field-map.md`** — in §1 최상위 table add rows:

```markdown
| `externalTasks[]` (0.5) | 타 L5의 L6 참조 레지스트리 — 엣지 끝점이 `refId`면 **L5 연계 캔버스 플레이스홀더 SP 노드**(`title=l6`∥`(L6 unspecified) L5명`, `placeholder_category_id=l5.nodeCode의 카테고리`, 계보키 `__ext__|홈L5|refId`). 그 L5에 정규화 이름 정확 일치 라이브 맵이 1개면 실 노드로 직결. `note`는 홈 L5 노트(kind=`external`) |
| `framework.categories[]` 중 홈 체인 밖 | 외부 계보 — **없을 때만 생성**(있으면 name/level/parent/sort 불변). 부모가 파일에 없으면 경고 후 제외 |
```
and a new section after §2:

```markdown
## 2-2. 외부 참조 해소 (0.5)

| 시점 | 규칙 |
|---|---|
| 임포트 시 | `externalTasks[].l5.nodeCode` 카테고리(파일 동봉 또는 DB)의 라이브 맵 중 `normalize_task_name(name) == normalize_task_name(l6)`가 **정확히 1개** → 직결. 2개 이상 → 경고, 플레이스홀더 유지. `l6: null`은 매칭 대상 아님 |
| 재전달(다른 L5) | 전달분이 건드린 카테고리를 `placeholder_category_id`로 가진 미연결 플레이스홀더를 전 캔버스 draft에서 스캔 → 같은 규칙으로 연결(`placeholder_category_id`는 소거). 손으로 만든 플레이스홀더(출처 NULL)는 대상 아님 |
| 재임포트(같은 파일) | 같은 `refId`의 미연결 플레이스홀더는 제목·출처 갱신, 연결된 노드는 불변 |
| 미선언 코드 | `externalTasks`에 없는 끝점 문자열은 실 taskId로 취급(dev 2026-09-06 동작) — 제목=코드, 출처 없음, 계보키 `__ext__|코드`, 리포트 `@ unknown` |
```
Also add to §5 (파일 거부 조건): `externalTasks`가 리스트가 아님 · `refId` 누락/중복/`taskId` 충돌 · `l5`/`nodeCode` 누락.

- [ ] **Step 3: Spec/handoff notes.** In `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §8 append:

```markdown
> **follow-up (2026-09-07)**: "계약 확장은 인터뷰 트랙 백로그"는 `2026-09-07-interview-external-refs-design.md`(인터뷰 JSON 0.5 `externalTasks`)로 해소 — 플레이스홀더가 출처 L5·이름 힌트를 갖고, 같은 L5 안 정규화 이름 정확 일치는 자동 연결된다.
```
In `docs/design/2026-09-01-interview-import-v04-result.md` §4 append item `6. **타 L5 L6 참조(externalTasks, 0.5)** — 구현됨 2026-09-07(feat/interview-external-refs): 설계 `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`, 계약 `docs/samples/interview-json-0.5.md`.` and change the "저장소 샘플" row in §1.1 to `7종 전부 0.5 (consultant-interview-sample/ 2 + framework-linkage-dummy/ 5)`.

- [ ] **Step 4: Full gates**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/ scripts/
cd ../frontend && npx vitest run && npx tsc --noEmit && npm run lint && node scripts/build-component-catalog.mjs --check
```
Expected: all green (pytest count ≥ 1392 + new tests; vitest ≥ 895).

- [ ] **Step 5: Browser capture** — with backend (fresh seed) + frontend running, import the B set via the UI or API (`X-Dev-User: admin.sys`), open the change-control L5 linkage canvas (Framework tab → 21-03-02-01-01 → canvas) and capture `external-refs-canvas.png` into the scratchpad with a short playwright-core script modelled on `frontend/scripts/pw-smoke-interview-import.mjs` (system Chrome, `bpm.devUser` init script, `page.screenshot({ path })`). The frame must show two linked external L6 nodes with distinct L5 colour tabs plus the `일탈 종결…` placeholder badge before qa-deviation is imported. Send the file with SendUserFile.

- [ ] **Step 6: Commit and push the branch (no dev merge)**

```bash
git add docs/samples/interview-json-0.5.md docs/qa/interview-import-field-map.md docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md docs/design/2026-09-01-interview-import-v04-result.md PROGRESS.md
git commit -m "docs(interview): 0.5 external-reference contract for consultants, field map and handoff notes — 컨설턴트 전달용 0.5 계약 문서·필드표·핸드오프 갱신"
git push -u origin feat/interview-external-refs
```

---

## Self-Review

- **Spec coverage**: §4.1–4.6 → Tasks 2, 3, 10; §5 → Task 2/3; §6.1 → Task 4; §6.2 → Task 1; §6.3 → Task 5; §6.4 → Task 6; §6.5/§7 → Tasks 5–7; §8 → Tasks 8–9; §9 → Tasks 9–10; §10 tests → each task; §13 branch/push → Task 10 Step 6. The spec's "외부 자기 반복 드롭" is covered by the both-endpoints-unknown rule (a self edge with an external endpoint has both endpoints unknown) — no separate branch needed.
- **Placeholders**: none — every code step has code; sample rows are specified by table + template + shape test.
- **Type consistency**: `ExternalRef(code, l5_code, l5_label, name, note, declared)` used identically in Tasks 2, 5; `InterviewLinkage.external_refs: dict[str, ExternalRef]`; `external_ref_lineage_key(home_code, ref_id)`; `normalize_task_name(name)`; report strings identical between Tasks 5/6 and Task 7 PATTERNS; `CanonicalCategory.external` in Tasks 3/4.
