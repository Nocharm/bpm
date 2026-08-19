# Interview JSON Import (Phase 3 Adapter) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PwC 인터뷰 결과 JSON(여러 파일)을 웹에서 일괄 임포트 — 카테고리 업서트+맵 생성 동시, dry-run 키 검증 리포트, 예외/VOC는 신규 `map_notes` 테이블 + 읽기전용 표시.

**Architecture:** 신규 순수 어댑터(`scripts/consultant_interview.py`)가 인터뷰 JSON → canonical(`CanonicalCategory`/`CanonicalMap`) + `InterviewNote`로 변환하고, 기존 `import_delivery()` 엔진을 소폭 확장(owner 폴백·description·거버넌스 예외)해 재사용한다. 웹 엔드포인트 `POST /api/categories/import-interview`가 파일별 리포트를 내려주고, 설정 Framework 탭에 다중 파일 UI를 추가한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + TypeScript.

**Spec:** `docs/design/2026-08-18-interview-import-design.md` (결정 로그 §8 포함 — 플랜과 충돌 시 스펙 우선)

## Global Constraints

- 브랜치 `feat/interview-import` (main 4b2a6ec에서 분기). 커밋마다 PROGRESS.md 갱신(1-3줄), 커밋 트레일러는 CLAUDE.md 규칙.
- 길이 캡: Node.title ≤200 · map name ≤200 · category code ≤100/name ≤300 · MapVersion.label ≤100 · MapPermission.principal_id ≤100. **description(Text)은 캡 금지**(sp_input 교훈).
- 신규 컬럼은 `db.py` `_ADDED_COLUMNS` 등록 필수(운영 자동 ALTER). 신규 테이블(map_notes)은 create_all이 처리.
- FE: raw hex 금지(토큰만)·Lucide 16px·UI 영어·`data-id` 부여·React Compiler(useCallback deps) 함정 주의.
- BE 게이트: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/ scripts/`. FE 게이트: `npm run lint` + `npx tsc --noEmit` + `npx vitest run` + `npm run build`.
- 파이썬 룰: 타입힌트 전 시그니처·`X | None`·verb 함수명. TS 룰: strict·named export·interface.

---

### Task 1: canonical/엔진 확장 — owner 폴백·description·pending 플래그·거버넌스 예외

**Files:**
- Modify: `backend/scripts/consultant_canonical.py` (CanonicalNode :41, CanonicalMap :63)
- Modify: `backend/scripts/import_consultant.py` (build_graph_rows :89, resolve 호출부 :437, pass1 :428, pass2 fields_changed :532, _graph_signature :292)
- Modify: `backend/app/models.py` (ProcessMap :173 근처), `backend/app/db.py` (_ADDED_COLUMNS :93 뒤)
- Test: `backend/tests/test_consultant_import.py` (기존 파일에 추가)

**Interfaces:**
- Produces: `CanonicalNode.description: str = ""` · `CanonicalMap.description: str = ""` · `CanonicalMap.owner: str | None`(None=폴백) · `ProcessMap.consultant_owner_pending: bool` · 리포트 action `"governance"`(재전달 오너 배정).
- 후속 태스크는 `CanonicalMap(..., owner=None, description="...")`을 그대로 만들 수 있다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_consultant_import.py`에 추가 (기존 `_run`, `_seed_import_employees`, 헬퍼 재사용 — 파일 상단의 기존 맵 페이로드 헬퍼를 그대로 따른다):

```python
def test_owner_none_falls_back_to_actor_and_marks_pending() -> None:
    """owner=None → actor 폴백 + consultant_owner_pending=True + owning NULL 유지."""
    _seed_import_employees()
    cmap = CanonicalMap(
        code="IV-P1", name="교정 준비", category="CAL-A1", owner=None,
        description="[Interview]\nGMP: yes",
        nodes=[CanonicalNode(code="a01", name="작업지시 확인", description="EAM에서 확인", seq=1)],
    )
    report = _run_delivery(categories=_cal_cats(), maps=[cmap], actor="admin.sys")
    m = _get_map_by_code("IV-P1")
    assert m.owner_id == "admin.sys"
    assert m.consultant_owner_pending is True
    assert m.owning_department is None          # actor 조직으로 오염시키지 않는다 (spec §4)
    assert m.description.startswith("[Interview]")
    assert any(a == "warning" and "owner missing" in d for _, a, d in report.rows)

def test_pending_map_governance_updated_on_redelivery_with_owner() -> None:
    """pending 맵만 재전달 오너로 거버넌스 갱신(권한행·승인자·owning) + 플래그 해제."""
    _seed_import_employees()
    base = dict(code="IV-P2", name="교정 수행", category="CAL-A1",
                nodes=[CanonicalNode(code="a01", name="수행", seq=1)])
    _run_delivery(categories=_cal_cats(), maps=[CanonicalMap(**base, owner=None)], actor="admin.sys")
    report = _run_delivery(
        categories=_cal_cats(),
        maps=[CanonicalMap(**base, owner="cons.owner", approvers=["cons.appr"],
                           department="Consult Div/Consult Team")],
        actor="admin.sys")
    m = _get_map_by_code("IV-P2")
    assert m.owner_id == "cons.owner" and m.consultant_owner_pending is False
    assert m.owning_department == "Consult Div/Consult Team"
    assert _owner_permission(m.id) == "cons.owner"      # MapPermission role='owner' 행 교체 확인
    assert any(a == "governance" for _, a, _ in report.rows)

def test_non_pending_map_governance_still_immutable() -> None:
    """일반(실오너) 맵은 재전달 오너가 달라도 기존 거버넌스 불변 — 기존 계약 회귀 가드."""
    ...  # 기존 테스트 스타일로: owner="cons.owner"로 1차 → owner="cons.appr"로 재전달 → owner_id 불변

def test_node_and_map_description_change_triggers_new_version() -> None:
    """description만 바뀌어도 fields/graph 변경으로 감지 — 무변경이면 여전히 unchanged."""
    ...  # 동일 전달 2회=unchanged, 노드 description 변경 3회차=updated 단언
```

주의: `_run_delivery`/`_get_map_by_code`/`_owner_permission`/`_cal_cats` 소형 헬퍼가 없으면 이 테스트 파일 안에 만든다(기존 `_run` 픽스처 위에 5줄 내외 — 세션 열어 `import_delivery` 호출·`select(ProcessMap)` 조회·`select(MapPermission)` 조회).

- [ ] **Step 2: 실패 확인** — `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_consultant_import.py -q` → 신규 4건 FAIL(ValidationError: owner none / AttributeError: consultant_owner_pending).

- [ ] **Step 3: 구현**

`consultant_canonical.py`:
```python
class CanonicalNode(BaseModel):
    ...
    description: str = ""  # 인터뷰 어댑터가 KV 직렬화를 싣는다 — Text 컬럼, 캡 금지 (design 2026-08-18)

class CanonicalMap(BaseModel):
    ...
    # None = 오너 미확정(인터뷰 1차) — 엔진이 actor 폴백 + consultant_owner_pending 마킹 (design 2026-08-18 §4)
    owner: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    description: str = ""
```

`models.py` (ProcessMap, consultant_code 아래):
```python
    # 오너 미확정 임포트 마킹 — True면 재전달 오너로 거버넌스 갱신 허용(불변 원칙의 명시적 예외) (design 2026-08-18 §4)
    consultant_owner_pending: Mapped[bool] = mapped_column(default=False)
```

`db.py` `_ADDED_COLUMNS` 말미:
```python
    # 인터뷰 임포트 오너 미확정 마킹 (design 2026-08-18 §4)
    ("process_maps", "consultant_owner_pending", "BOOLEAN DEFAULT FALSE"),
```

`import_consultant.py` — 변경 4곳:
1) `build_graph_rows`의 L7 노드 생성(:148)에 `description=cn.description,` 추가.
2) `_graph_signature` 노드 튜플에 `n.description or ""` 추가(주석의 `or ""` 이유 동일).
3) pass1 신규 생성 분기(:437-461) 교체 — owner None 처리:
```python
        owner_login = cmap.owner
        pending = owner_login is None
        if pending:
            owner_login = actor
            report.add(cmap.code, "warning", "owner missing — fallback to importer (pending)")
            owning: str | None = None  # actor 조직으로 오염 금지 — 실오너 배정 시 재해석 (design 2026-08-18 §4)
            note = None
        else:
            owning, note = await resolve_owning_department(
                session, known, dept_index, cmap.department, owner_login
            )
        if note: ...  # 기존 유지
        if not pending and owner_login not in known_logins: ...  # 기존 유령 경고 유지 (폴백이면 스킵)
        new_map = ProcessMap(..., owner_id=owner_login, consultant_owner_pending=pending,
                             description=cmap.description, ...)
        session.add(MapPermission(..., principal_id=owner_login, ...))
```
4) pass1의 `if cmap.code in existing: continue`(:435) 앞에 거버넌스 예외 분기:
```python
        if cmap.code in existing:
            found = existing[cmap.code]
            if found.consultant_owner_pending and cmap.owner:
                owning, note = await resolve_owning_department(
                    session, known, dept_index, cmap.department, cmap.owner)
                if note:
                    report.add(cmap.code, "warning", note)
                found.owner_id = cmap.owner
                found.owning_department = owning
                found.consultant_owner_pending = False
                for perm in await session.scalars(select(MapPermission).where(
                        MapPermission.map_id == found.id, MapPermission.role == "owner")):
                    perm.principal_id = cmap.owner
                    perm.granted_by = actor
                await session.execute(delete(MapApprover).where(MapApprover.map_id == found.id))
                for approver in dict.fromkeys(cmap.approvers):
                    session.add(MapApprover(map_id=found.id, user_id=approver, assigned_by=actor))
                report.add(cmap.code, "governance", f"owner {cmap.owner} assigned")
            continue
```
(`from sqlalchemy import delete` 임포트 추가.)
5) pass2 `fields_changed`(:532)에 `or (found_map.description or "") != cmap.description` 추가, 콘텐츠 갱신 블록(:549)에 `found_map.description = cmap.description` 추가.

- [ ] **Step 4: 통과 확인** — 같은 pytest 명령, 신규 4건 + 기존 전건 PASS. `ruff check app/ tests/ scripts/`.
- [ ] **Step 5: 커밋** — `git add backend/... PROGRESS.md && git commit -m "feat(import): canonical description + owner-pending fallback — canonical 설명 필드·오너 미확정 폴백/거버넌스 예외"` (+PROGRESS 1줄).

---

### Task 2: 인터뷰 어댑터 — `scripts/consultant_interview.py`

**Files:**
- Create: `backend/scripts/consultant_interview.py`
- Test: `backend/tests/test_consultant_interview.py`

**Interfaces (Produces — Task 3·4가 소비):**
```python
@dataclass
class AdapterIssue:
    severity: str   # "error" | "warning"
    path: str       # 예: "rows[2].actions[3]"
    message: str

@dataclass
class InterviewNote:
    kind: str                    # exception | voc | rule_basis | ... (≤50자 truncate)
    text: str
    title: str | None = None     # 예외 name
    map_code: str | None = None  # taskId → consultant_code 매칭
    category_code: str | None = None  # L5 전역 노트

@dataclass
class AdapterResult:
    categories: list[CanonicalCategory]
    maps: list[CanonicalMap]
    notes: list[InterviewNote]
    issues: list[AdapterIssue]
    def has_error(self) -> bool: ...

def convert_interview(raw: object) -> AdapterResult
```
- 구조 치명 오류(파일이 dict 아님·framework/l5/rows 누락·l5.nodeCode가 categories에 없음)는 error issue + `maps=[]`로 반환 — **예외를 던지지 않는다**(파일별 독립 처리).

**핵심 규칙 (spec §2·§3):**
- 최상위 화이트리스트 `{_readme, schema_version, labelSource, framework, l5, rows, tasks, summary, openItems, sideNotes}`; row `{taskId, unitId, l6, owner, ownerRole, approvers, department, fields, actions}`; fields는 spec §2 목록(`done_criteria`와 `done_criterial` 둘 다 수용 — 손타이핑 모호); action `{seq, label, name, kind, variant, rule, input, output, system, screen, dataForm, quote}`. 미지 키 → warning(경로 포함). `schema_version`이 `"0.3"` 프리픽스 아니면 warning.
- 맵: `code=taskId`(누락 시 그 row error·스킵) · `name=l6[:200]`(초과 warning·truncate, 누락 시 tasks[].name 폴백, 그것도 없으면 error) · `category=l5.nodeCode` · `owner=row.owner or None` · `approvers=row.approvers or []` · `department=row.department or ""` · `visibility` 기본(public).
- params: `total_time_min` 숫자면 분→H.MM(`f"{m//60}.{m%60:02d}"`) → `duration`; `annual_count`/`headcount`/`fte` 값이 오면 str로 전달(정규화는 엔진 담당); `input=fields.input_data` `output=fields.output_data`.
- 맵 description = `format_map_description(fields, owner_role)` — `[Interview]` 헤더 + 아래 순서의 `Label: value` 줄(빈 값 생략, 원문 그대로):
  `Start condition / Input / Output / Done criteria / Systems / Total time / Total time (min) / Touch time / Touch time (min) / Frequency / Annual count / Headcount / FTE / GMP / Artifact role / Owner role`.
- 노드: actions를 `(seq, 배열순)`으로 정렬. `code = f"a{int(seq):02d}"`, 같은 seq 2번째부터 `-2`,`-3` 접미. `name=label[:200]`(누락 시 `f"Step {seq}"` + warning) · `type = "decision" if kind=="decision" else "process"` · `system=action.system or ""`(100자 truncate+warning) · `description = format_node_description(action)` = action.name + 빈 줄 + `Input:/Output:/Rule:/System:/Screen:/Data form:/Quote:` 줄(빈 값 생략) + kind가 handoff면 `Kind: handoff`.
- 엣지: seq 그룹 k 전원 → 그룹 k+1 전원 (`CanonicalEdge(**{"from": a, "to": b})`). 명시 점프 키는 미구현(spec §3 확장 포인트).
- notes: `tasks[]`를 `id→task` 인덱스로, row.taskId 조인 — `exceptions[]` → `InterviewNote(kind="exception", title=name, text=rule, map_code=taskId)`(evidence 무시). `sideNotes[]` → `unitId`가 어떤 row.unitId와 일치하면 그 row의 taskId로 `map_code`, 아니면(`null` 포함) `category_code=l5.nodeCode`(+ unitId가 있는데 미매칭이면 warning).
- `summary/openItems/_readme/evidence` 무시. tasks의 나머지 필드 무시(start/end 조건은 rows.fields 우선 — spec §3).

- [ ] **Step 1: 실패 테스트 작성** — `tests/test_consultant_interview.py` (DB 불필요·순수 함수). 픽스처는 손타이핑 스키마 그대로 dict 리터럴(`_interview()` 헬퍼, calibration 예제 축약판: categories 5단 체인 + rows 2건 + tasks/exceptions + sideNotes 2건). 최소 케이스:

```python
def test_convert_basic_map_and_nodes(): ...        # code=taskId·name=l6·category·노드 title/description 직렬화 내용
def test_seq_groups_make_parallel_edges(): ...     # seq [1,2,2,3] → 1→2a,1→2b,2a→3,2b→3 (4엣지)·code a02/a02-2
def test_decision_and_handoff_kinds(): ...         # decision→type decision / handoff→process+["Kind: handoff" in desc]
def test_total_time_min_to_duration(): ...         # 90 → "1.30" / None → ""
def test_unknown_key_warning_with_path(): ...      # rows[0].actions[0]에 "done_criterial"급 미지 키 → warning 경로 문자열
def test_missing_l5_node_code_is_file_error(): ... # l5.nodeCode가 categories에 없음 → has_error()·maps==[]
def test_notes_extraction(): ...                   # exception→map_code / sideNote unitId 매칭 / null unitId→category_code
def test_map_description_serialization(): ...      # [Interview] 헤더·빈 값 줄 생략·원문 보존("한번에 한시간쯤")
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_consultant_interview.py -q` → ModuleNotFoundError.
- [ ] **Step 3: 구현** — 위 인터페이스·규칙대로. 파일 헤더 docstring에 `설계: docs/design/2026-08-18-interview-import-design.md §2·§3` 명시. CanonicalMap 생성은 `try: CanonicalMap(**kwargs) except ValidationError → row error issue`로 감싼다(캡 초과 등 잔여 검증 흡수).
- [ ] **Step 4: 통과 확인** — 신규 전건 PASS + ruff.
- [ ] **Step 5: 커밋** — `feat(import): interview JSON → canonical adapter — 인터뷰 JSON 어댑터(키 검증·매핑·notes 추출)`.

---

### Task 3: `map_notes` 모델 + 적재 헬퍼 + GET API

**Files:**
- Modify: `backend/app/models.py` (ProcessMap 클래스 뒤에 신규 클래스), `backend/app/schemas.py`, `backend/app/routers/maps.py`, `backend/scripts/import_consultant.py` (말미에 헬퍼 추가)
- Test: `backend/tests/test_map_notes.py`

**Interfaces:**
- Produces: 모델 `MapNote` · 엔진 헬퍼 `apply_interview_notes(session, notes, *, actor, label) -> int` · `GET /api/maps/{map_id}/notes -> list[MapNoteOut]`.
- Consumes: Task 2 `InterviewNote`.

```python
# models.py — 인터뷰 노트·예외 규칙 + (추후) 일반맵 사용자 노트 공용 (design 2026-08-18 §5)
class MapNote(Base):
    __tablename__ = "map_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int | None] = mapped_column(
        ForeignKey("process_maps.id", ondelete="CASCADE"), default=None
    )
    node_id: Mapped[str | None] = mapped_column(String(50), default=None)   # 추후 활동별 등록용
    category_code: Mapped[str | None] = mapped_column(String(100), default=None)  # L5 전역 VOC
    kind: Mapped[str] = mapped_column(String(50))
    title: Mapped[str | None] = mapped_column(String(300), default=None)
    text: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(100), default="consultant-import")
    delivery_label: Mapped[str | None] = mapped_column(String(100), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```
```python
# schemas.py
class MapNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    title: str | None
    text: str
    node_id: str | None
    source: str
    created_at: datetime
```
```python
# import_consultant.py 말미 — 전달 단위 replace 멱등 (design 2026-08-18 §5)
async def apply_interview_notes(
    session: AsyncSession, notes: list["InterviewNote"], *, actor: str, label: str
) -> int:
    """인터뷰 노트 적재 — 관련 맵/L5 스코프의 consultant-import 행을 지우고 재삽입."""
    code_to_id: dict[str, int] = {...}   # select(ProcessMap).where(consultant_code.in_(맵코드들))
    map_ids = {...}; cat_codes = {...}
    await session.execute(delete(MapNote).where(
        MapNote.source == "consultant-import", MapNote.map_id.in_(map_ids)))
    await session.execute(delete(MapNote).where(
        MapNote.source == "consultant-import", MapNote.map_id.is_(None),
        MapNote.category_code.in_(cat_codes)))
    inserted = 0
    for n in notes:
        map_id = code_to_id.get(n.map_code) if n.map_code else None
        if n.map_code and map_id is None:
            continue  # 맵 생성 자체가 스킵된 경우(휴지통 등) — 엔진 리포트가 이미 사유를 남겼다
        session.add(MapNote(map_id=map_id, category_code=None if map_id else n.category_code,
                            kind=n.kind[:50], title=n.title, text=n.text,
                            source="consultant-import", delivery_label=label))
        inserted += 1
    return inserted
```
```python
# routers/maps.py — 기존 viewer 가드 패턴(:526 get_map과 동일)
@router.get("/{map_id}/notes", response_model=list[MapNoteOut],
            dependencies=[Depends(require_map_role("viewer"))])
async def list_map_notes(map_id: int, session: AsyncSession = Depends(get_session)) -> list[MapNote]:
    return list((await session.scalars(
        select(MapNote).where(MapNote.map_id == map_id).order_by(MapNote.id))).all())
```

- [ ] **Step 1: 실패 테스트** — `tests/test_map_notes.py`: ① apply_interview_notes 삽입+맵 매칭+L5 스코프 ② 같은 notes 재적용 시 행 수 불변(멱등) ③ GET 정렬·필드 ④ 권한(private 맵 무권한 사용자 403 — `enforce`/`act_as` 패턴은 `test_categories_import_api.py` 미러).
- [ ] **Step 2: 실패 확인** → ImportError/404.
- [ ] **Step 3: 구현** (모델·스키마·헬퍼·라우트).
- [ ] **Step 4: 통과 확인** + 전체 pytest + ruff.
- [ ] **Step 5: 커밋** — `feat(notes): map_notes table + import loader + GET API — 예외/VOC 공용 노트 테이블`.

---

### Task 4: 웹 엔드포인트 `POST /api/categories/import-interview`

**Files:**
- Modify: `backend/app/schemas.py`, `backend/app/routers/categories.py` (기존 `/import` 라우트 바로 아래 — path-param 라우트보다 앞 유지)
- Test: `backend/tests/test_interview_import_api.py`

**Interfaces (Produces — Task 5가 소비):**
```python
class InterviewImportFileIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
    content: dict[str, Any]          # 인터뷰 JSON 원문 — 검증은 어댑터가 담당

class InterviewImportIn(BaseModel):
    files: list[InterviewImportFileIn] = []
    apply: bool = False
    label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None

class InterviewIssueOut(BaseModel):
    severity: str; path: str; message: str

class InterviewImportFileOut(BaseModel):
    name: str
    ok: bool                          # error 0건 → 임포트 대상 포함
    map_count: int
    note_count: int
    issues: list[InterviewIssueOut]   # 파일당 최대 200행(초과는 말미에 "... n more" 행)

class InterviewImportOut(BaseModel):
    applied: bool
    files: list[InterviewImportFileOut]
    summary: dict[str, int]           # 엔진 counts + warning + notes
    rows: list[FrameworkImportRow]    # 엔진 리포트 재사용(500캡·error/warning 우선 — 기존 규칙)
    truncated: bool
```

**라우트 흐름** (기존 `/import` :273-325 미러 + 어댑터 단계):
1. `require_sysadmin`. 파일별 `convert_interview(f.content)` → `InterviewImportFileOut` 구성. `has_error()` 파일은 스킵(ok=False).
2. ok 파일들의 categories를 code 기준 dedupe 병합(같은 code 다른 name → 해당 파일 issues에 warning 추가·나중 파일 승리), maps 병합(파일 간 중복 taskId → 뒤 파일에 error issue·그 맵 제외), notes 병합.
3. `label = payload.label or f"Interview {now_kst():%Y-%m-%d}"` → `import_delivery(...)` → `apply_interview_notes(...)` (같은 세션 — dry-run rollback이 노트까지 원복).
4. `summary = report.counts(); summary["warning"] = ...(기존 규칙); summary["notes"] = inserted`.
5. apply면 commit, 아니면 rollback. 응답 조립(rows 정렬·500캡은 기존 `/import` 코드 복제).

- [ ] **Step 1: 실패 테스트** — `tests/test_interview_import_api.py` (픽스처는 Task 2의 `_interview()` 재사용 — 모듈 import): ① dry-run: 파일 리포트+rows 반환·DB 미영속 ② apply: 맵 2·카테고리 5·노트 생성 + `consultant_owner_pending` ③ error 파일 스킵·ok 파일은 진행 ④ 파일 간 중복 taskId error ⑤ 비-sysadmin 403.
- [ ] **Step 2: 실패 확인** → 404.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 전체 pytest + ruff.**
- [ ] **Step 5: 커밋** — `feat(import): POST /api/categories/import-interview — 다중 파일 인터뷰 임포트 엔드포인트`.

---

### Task 5: FE — Interview import UI (설정 Framework 탭)

**Files:**
- Modify: `frontend/src/lib/api.ts` (:2317 뒤), `frontend/src/lib/framework-import-parse.ts`, `frontend/src/components/admin/framework-panel.tsx` (기존 임포트 섹션 :422-570 아래 형제 섹션), `frontend/src/lib/i18n-messages.ts` (EN :1617대·KO :3260대 근처)
- Test: `frontend/src/lib/framework-import-parse.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 4 응답 스키마.
- Produces: `importInterview(body: { files: { name: string; content: unknown }[]; apply: boolean; label?: string }): Promise<InterviewImportResult>` — `InterviewImportResult`/`InterviewFileReport`/`InterviewIssue` 인터페이스는 BE 스키마 1:1 미러(api.ts에 export).
- `parseInterviewFile(text: string): { content: unknown; error?: string }` — JSON.parse + 최상위가 object인지 확인만(깊은 검증은 서버 어댑터 몫).

**UI 구성** (`data-id` 필수):
- 섹션 `data-id="interview-import"` — 제목 `t("framework.interviewImportTitle")`, 힌트(파일=L5 1건·dry-run 필수).
- 파일 선택: `<input type="file" multiple accept=".json,application/json">` 숨김 + 버튼(`interview-import-pick`) — 선택 파일 리스트(이름·parse 에러는 `text-error`), 개별 제거 버튼(`interview-import-remove-${i}`).
- 버튼: Dry run(`interview-import-dryrun`) / Apply(`interview-import-apply`, dry-run 결과 있어야 활성 + 기존 `ConfirmDialog` 패턴 재사용) — busy 중 전부 disabled(기존 :436 패턴).
- 결과(`interview-import-report`): 파일별 아코디언(파일명 + ok 뱃지 + map/note 카운트, 펼치면 issues 테이블 severity/path/message) + 아래 엔진 rows 테이블(기존 :526-560 테이블 마크업 복제·요약 렌더 `renderImportSummary` 재사용 가능하면 재사용).
- i18n 키(EN/KO 쌍): `framework.interviewImportTitle`("Interview import"/"인터뷰 임포트")·`framework.interviewImportHint`·`framework.interviewImportPick`·`framework.interviewFileOk`·`framework.interviewFileError`·`framework.interviewIssueCol{Severity,Path,Message}`·`framework.interviewNoteCount`.

- [ ] **Step 1: 실패 테스트** — `framework-import-parse.test.ts`에 `parseInterviewFile` 3케이스(정상/깨진 JSON/배열 루트 에러).
- [ ] **Step 2: `npx vitest run src/lib/framework-import-parse.test.ts`** → FAIL.
- [ ] **Step 3: 구현** — parse 헬퍼 → api.ts → framework-panel 섹션 → i18n. 상태는 기존 패턴 미러(`interviewFiles: {name, content?, error?}[]`, `interviewResult`, `interviewBusy`, `confirmInterviewApply`).
- [ ] **Step 4: 게이트** — vitest run 전체 + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: 커밋** — `feat(admin): interview multi-file import UI — 인터뷰 다중 파일 임포트·파일별 키 검증 리포트`.

---

### Task 6: FE — Notes 읽기전용 섹션 (맵 상세 카드 + 에디터 인스펙터)

**Files:**
- Create: `frontend/src/components/maps/map-notes-section.tsx`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/components/maps/map-detail-card.tsx` (description :880·IO :893 블록 뒤), `frontend/src/components/map-inspector-tab.tsx` (description 섹션 :172-181 뒤), `frontend/src/lib/i18n-messages.ts`
- Test: `frontend/src/components/maps/map-notes-section.test.tsx`

**Interfaces:**
- `getMapNotes(mapId: number): Promise<MapNote[]>` — `MapNote { id: number; kind: string; title: string | null; text: string; node_id: string | null; source: string; created_at: string }`.
- `<MapNotesSection mapId={number} />` — 마운트 시 fetch, **notes 0건이거나 로드 실패면 null 렌더**(섹션 자체 숨김 — 기존 맵 대다수가 노트 없음), 로딩 중에도 null.

**렌더:** `data-id="map-notes-section"`, 제목 "Notes"(`text-caption-strong`), 항목 `data-id="map-note-${id}"` — kind 뱃지(uppercase, `text-fine`·`bg-surface-alt`·`rounded-sm`, exception만 `text-error` 톤), title(있으면 `text-caption-strong`), text(`text-caption`, `whitespace-pre-wrap`). 5건 초과 시 `max-h` 스크롤(`scroll-soft`). i18n: `notes.title`("Notes"/"노트") — kind 라벨은 데이터 원문 그대로(영어 고정 아님).

- [ ] **Step 1: 실패 테스트** — vitest: ① notes 2건 렌더(kind 뱃지·title·text) ② 빈 배열 → null ③ fetch 실패 → null (api 모킹은 기존 컴포넌트 테스트 패턴 — `vi.mock("@/lib/api")`).
- [ ] **Step 2: FAIL 확인.**
- [ ] **Step 3: 구현 + 두 표면 삽입** — map-detail-card: IO 블록(:893) 뒤에 `<MapNotesSection mapId={detail.id} />`; map-inspector-tab: description `<section>`(:172-181) 뒤에 `<section><MapNotesSection mapId={mapId} /></section>`. React Compiler 함정: fetch effect는 `useEffect(() => { let alive = true; ... }, [mapId])` 표준형.
- [ ] **Step 4: 게이트** — vitest 전체 + tsc + lint + `npm run build`.
- [ ] **Step 5: 커밋** — `feat(maps): read-only interview notes section — 맵 상세·인스펙터 노트 표시`.

---

### Task 7: 합성 샘플 + 실브라우저 스모크 + 최종 게이트 + 문서

**Files:**
- Create: `docs/samples/consultant-interview-sample/calibration-l5.json`, `docs/samples/consultant-interview-sample/utility-l5.json` (합성 데이터 — 실파일 아님. calibration은 손타이핑 예제 기반 rows 3·병렬 seq 1쌍·decision 1·exceptions 2·sideNotes 3, utility는 소형 rows 1)
- Create: `frontend/scripts/pw-smoke-interview-import.mjs` (기존 `pw-smoke-framework-admin.mjs` 하네스 복제)
- Modify: `docs/README.md`(샘플 1줄), `docs/design/2026-08-18-interview-import-design.md`(검증 결과 각주), `PROGRESS.md`

**스모크 시나리오** (로컬 dev 서버 — `docs/lessons/browser-verification.md` 절차·좀비 프론트 주의):
1. sysadmin으로 설정 → Framework 탭 → Interview import → 샘플 2파일 선택 → Dry run → 파일 리포트 2건·ok 확인 → Apply.
2. 홈 Framework 뷰 → L5 체인 펼침 → 임포트 맵 노출 확인.
3. 맵 상세 카드 → `map-notes-section` 예외/VOC 렌더 확인. 에디터 진입 → 인스펙터 Map 탭 동일 확인.
4. 같은 파일 재-Apply → summary unchanged·노트 행 수 불변(멱등).

- [ ] **Step 1: 샘플 2파일 작성** (스키마는 Task 2 픽스처와 동일 구조·값만 풍부하게).
- [ ] **Step 2: 스모크 스크립트 작성·실행** — 전 시나리오 green (`node scripts/pw-smoke-interview-import.mjs`).
- [ ] **Step 3: 최종 게이트** — BE: env-off pytest 전체 + ruff. FE: vitest·tsc·lint·build 전체.
- [ ] **Step 4: 문서** — docs/README.md 샘플 인덱스 1줄·스펙 검증 각주·PROGRESS 요약.
- [ ] **Step 5: 커밋** — `feat(import): interview sample + browser smoke — 합성 샘플·실브라우저 스모크·게이트`. 이후 dev 머지·서버 배포는 별도 결정(9910 절차는 `docs/qa/dev-vs-main-checklist.md`).

---

## Self-Review 결과

- 스펙 커버리지: §1→T4, §2·§3→T2, §4→T1, §5→T3, §6→T5·T6, §7→각 태스크 Step + T7. 갭 없음.
- 시그니처 일관성: `convert_interview`/`AdapterResult`(T2)를 T4가 소비, `apply_interview_notes`(T3)를 T4가 호출, `InterviewImportOut`(T4)을 T5가 미러, `MapNoteOut`(T3)을 T6이 미러 — 이름 통일 확인.
- 미결(실파일 대조 대기): `done_criterial` 표기·`*_min` 실제 키 — 어댑터가 양쪽 수용+unknown key 리포트로 흡수.
