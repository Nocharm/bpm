# Departments Org Basis (v2 — EDW Positions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 조직도·부서권한 판정을 `departments` 기준으로 전환하고 `dept_info` 소비를 전제거하며, EDW 직책(n8n `hr-position` 워크플로 + AD `employeeNumber` 매핑)으로 부서장(`employees.position`)을 자동 수집해 승인자 피커 Manager 태그를 부서 체인 직책 기반으로 재정의한다.

**Architecture:** 설계 v2: `docs/design/2026-08-11-departments-org-basis-design.md`. 신설 `app/orgchart.py` resolver(체인 우선·org 컬럼 폴백)를 모든 판정·표시 소비처가 사용. EDW positions는 HR sync 후속 AD 패스에서 title과 함께 갱신. 노출 직책 allowlist는 `app_settings`. **v1 구현 재사용**: `backup/dept-basis-v1-impl`의 `2fefc78`(orgchart)·`e8d37a4`(권한 전환)를 셔리픽.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + TypeScript / ldap3 · n8n(MSSQL).

## Global Constraints

- **운영 DB 물리 드랍 금지** — `dept_info` 테이블·데이터 잔류. 코드 참조만 제거.
- **폴백 불변식** — departments가 빈 환경에서 경로 해석은 현행 `org_path(org_l1..l5, department)`와 완전 동일. **기존 테스트 전체 무수정 그린이 증거** — 기존 테스트를 departments 시드로 고쳐 통과시키는 것 금지(신규 동작은 신규 테스트로).
- **position 소거 안전장치** — EDW 피드가 1행 이상일 때만 목록 밖 기존 `position` 소거, 빈 피드면 스킵. 매핑 실패는 소거하지 않고 `position_unmatched` 카운트.
- **노출 필터 백엔드 단일 강제** — manager_ids 산정·directory `position` 직렬화 모두 allowlist(`exposed_positions`)로 필터. FE는 온 값을 그대로 표기.
- 신규 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS` 수동 등록. 신규 env는 `.env.example` + Settings + **docker-compose backend `environment:` 블록** 3종 세트(`rules/backend/config.md` — 누락 시 컨테이너 미도달).
- 백엔드 게이트: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`.
- 프론트 게이트: `cd frontend && npx tsc --noEmit && npm run lint && npm run test -- --run && npm run build`.
- `backend/tests/`는 패키지 — 공유 헬퍼는 `from tests.hr_sync_helpers import ...`.
- 커밋: `type(scope): English summary — 한국어 요약` + 같은 커밋에 `PROGRESS.md` 한 줄 동반.
- FE: raw hex 금지(토큰만), 기존 클래스 상수 재사용, i18n EN/KO 두 블록 동시 갱신, UI 영어 기본.

## 환경 준비

워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dept-basis` (브랜치 `feat/departments-org-basis`). `backend/.venv`·`frontend/node_modules`는 이미 프로비저닝됨(리셋에도 잔존 — untracked).

---

### Task 1: orgchart resolver 셔리픽 + 검증

**Files:**
- Create(셔리픽): `backend/app/orgchart.py`, `backend/tests/test_orgchart.py`

**Interfaces:**
- Produces: `DeptIndex(by_code: dict[str, tuple[str, str|None]], name_ko_by_name: dict[str, str])`, `async load_dept_index(session)`, `resolve_org_path(emp, index) -> str`, `resolve_org_prefixes(path) -> list[str]`.

- [ ] **Step 1: 셔리픽** — `git cherry-pick 2fefc78` (backup/dept-basis-v1-impl의 orgchart 커밋). PROGRESS.md 충돌 시: 양쪽 내용 모두 보존(섹션에 두 줄 다 유지)하고 `git cherry-pick --continue`.
- [ ] **Step 2: 검증** — `cd backend && .venv/bin/python -m pytest tests/test_orgchart.py -q` (8 passed 기대) → 전체 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` 그린 → `ruff check app/ tests/` 클린.
- [ ] **Step 3: 완료** — 추가 커밋 불요(셔리픽 커밋이 곧 태스크 커밋).

---

### Task 2: 권한 판정·/me 경로 전환 셔리픽 + 검증

**Files:**
- Modify(셔리픽): `backend/app/permissions/access.py`(3곳), `backend/app/main.py`(/api/me org_path) + Create: `backend/tests/test_orgchart_permissions.py`

- [ ] **Step 1: 셔리픽** — `git cherry-pick e8d37a4`. 충돌 시 PROGRESS.md는 양쪽 보존; main.py 충돌이 나면 무리하게 풀지 말고 BLOCKED 보고(원 커밋은 org_path 산출부와 dept_index 로드 추가만 건드린다 — 현 main.py는 dev 상태라 대개 클린 적용).
- [ ] **Step 2: 검증** — `pytest tests/test_orgchart_permissions.py -q`(2 passed) → 전체 그린(기존 테스트 무수정 — 폴백 불변식) → ruff 클린.
- [ ] **Step 3: 완료** — 추가 커밋 불요.

---

### Task 3: EDW positions 백엔드 파이프라인

**Files:**
- Modify: `backend/app/models.py`(Employee.position), `backend/app/db.py`(`_ADDED_COLUMNS`), `backend/app/settings.py`(`n8n_position_url`+`position_enabled`), `.env.example`, `docker-compose.yml`(backend environment), `backend/app/hr/client.py`(`RawHrPosition`·`fetch_positions`), `backend/app/ad/client.py`(`employeeNumber`), `backend/app/ad/service.py`(`refresh_titles` → `refresh_titles_and_positions`), `backend/app/hr/service.py`(호출부+summary), `backend/app/schemas.py`(`SyncSummaryOut`)
- Test: `backend/tests/test_hr_client.py`(positions 파싱)·`backend/tests/test_hr_title_pass.py`(확장/개명)

**Interfaces:**
- Consumes: 없음(독립).
- Produces: `Employee.position: str | None`, `RawHrPosition(emp_id, dept_code, name, position)`, `async fetch_positions() -> list[RawHrPosition]`, `async refresh_titles_and_positions(session, positions) -> tuple[int, int, int]`(title_refreshed, position_refreshed, position_unmatched), `SyncSummaryOut.position_refreshed/position_unmatched: int | None`, `settings.position_enabled`.

- [ ] **Step 1: 실패 테스트 작성** — 기존 목 패턴(`tests/hr_sync_helpers.py`·`test_hr_title_pass.py`의 fake RawUser·monkeypatch) 확장. 케이스:
  1. `parse_position_row`: dict 아님/empId 결측/position 결측 → None, 정상 행 트림 파싱 (`test_hr_client.py`에 추가).
  2. `fetch_positions`: `_post` 목으로 `{kind:"positions", rows:[...]}` → 파싱 목록, rows 비정형이면 빈 목록.
  3. AD 패스 매핑: fake RawUser(`employee_number="100"` 등) + positions(empId="100") → 해당 직원 `position` 갱신, `position_refreshed` 카운트.
  4. 중복 사번: 두 RawUser가 같은 employee_number → 그 사번의 position row는 unmatched.
  5. 미해석 사번(어떤 employeeNumber와도 불일치) → unmatched, 기존 position 유지.
  6. 소거: 기존 position 보유자가 이번 목록에 없으면 NULL 소거 — 단 positions가 빈 리스트면 소거 스킵(기존 보유자 유지).
  7. title 동작 회귀: 기존 title 갱신 단언 유지(개명·튜플 반환 반영).
- [ ] **Step 2: RED 확인** — 함수 부재·필드 부재로 실패.
- [ ] **Step 3: 구현**

`models.py` Employee(dept_code 아래):
```python
    # EDW 직책(FRNM) — 부서장 목록 행만, 그 외 NULL. AD employeeNumber 매핑으로 갱신 (설계 2026-08-11 §4)
    position: Mapped[str | None] = mapped_column(String(100), default=None)
```
`db.py`: `("employees", "position", "VARCHAR(100)")` 등록.

`settings.py`: 기존 `n8n_hr_url` 옆에 `n8n_position_url: str = ""`, `hr_enabled` property 패턴으로:
```python
    @property
    def position_enabled(self) -> bool:
        """EDW 직책 수집 활성 — URL과 HR 토큰(공용) 둘 다 필요."""
        return bool(self.n8n_position_url and self.n8n_hr_token)
```
`.env.example`: `N8N_POSITION_URL=` 주석 포함 추가(HR 블록 옆). `docker-compose.yml` backend environment: `N8N_POSITION_URL: ${N8N_POSITION_URL:-}`.

`hr/client.py`: `HR_POSITION_TIMEOUT_SECONDS = 30.0`(부서장 수백 행 — 전수 180s보다 짧게). `_post`가 URL을 받을 수 있게 최소 확장(`url: str | None = None`, 기본=기존 HR URL — 기존 호출부 무변경). 그리고:
```python
@dataclass(frozen=True)
class RawHrPosition:
    emp_id: str
    dept_code: str | None
    name: str | None
    position: str


def parse_position_row(row: object) -> RawHrPosition | None:
    """positions row 파싱 — empId·position 결측/비dict은 None(호출부 skip)."""
    if not isinstance(row, dict):
        return None
    emp_id = _clean(row.get("empId"))
    position = _clean(row.get("position"))
    if not emp_id or not position:
        return None
    return RawHrPosition(
        emp_id=emp_id,
        dept_code=_clean(row.get("deptCode")),
        name=_clean(row.get("name")),
        position=position,
    )


async def fetch_positions() -> list[RawHrPosition]:
    """EDW 부서장 목록 — n8n hr-position 워크플로(FRNM≠'프로' 필터 완료본)."""
    data = await _post({"kind": "positions"}, HR_POSITION_TIMEOUT_SECONDS, url=settings.n8n_position_url)
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    parsed = (parse_position_row(r) for r in rows)
    return [p for p in parsed if p is not None]
```

`ad/client.py`: `_ATTRS`에 `"employeeNumber"` 추가, `RawUser.employee_number: str | None = None`, **양쪽 생성 지점**(`_to_raw`의 `str_val("employeeNumber")` + 하단 dict 기반 생성부의 `_str_attr`) 모두 채움.

`ad/service.py`: `refresh_titles` → `refresh_titles_and_positions`:
```python
async def refresh_titles_and_positions(
    session: AsyncSession, positions: list[RawHrPosition]
) -> tuple[int, int, int]:
    """HR sync 후속 AD 패스 — title 갱신 + EDW 부서장 직책 매핑(employeeNumber=EMPID).

    반환 (title_refreshed, position_refreshed, position_unmatched).
    소거는 positions 비어있지 않을 때만 — 빈 피드 전멸 방어 (설계 2026-08-11 §4-2).
    """
    raws = await asyncio.to_thread(client.fetch_all_users)
    empno_to_sam: dict[str, str] = {}
    dup_empnos: set[str] = set()
    for r in raws:
        empno = (r.employee_number or "").strip()
        if not empno:
            continue
        if empno in empno_to_sam and empno_to_sam[empno] != r.sam_account_name:
            dup_empnos.add(empno)  # 사번 중복 — 오매칭 방지, 매핑 불가 처리
        else:
            empno_to_sam[empno] = r.sam_account_name
    titles = 0
    for raw in raws:
        if not raw.title:
            continue
        emp = await session.get(Employee, raw.sam_account_name)
        if emp is not None and emp.title != raw.title:
            emp.title = raw.title
            titles += 1
    pos_refreshed = 0
    unmatched = 0
    if positions:
        matched: set[str] = set()
        for p in positions:
            sam = None if p.emp_id in dup_empnos else empno_to_sam.get(p.emp_id)
            emp = await session.get(Employee, sam) if sam else None
            if emp is None:
                unmatched += 1
                continue
            matched.add(emp.login_id)
            if emp.position != p.position:
                emp.position = p.position
                pos_refreshed += 1
        stale_ids = (
            await session.scalars(
                select(Employee.login_id).where(
                    Employee.position.is_not(None), Employee.login_id.not_in(matched)
                )
            )
        ).all()
        for lid in stale_ids:  # 목록 밖 기존 보유자 소거 — 승진·이동 반영
            emp = await session.get(Employee, lid)
            if emp is not None:
                emp.position = None
                pos_refreshed += 1
    await session.commit()
    return titles, pos_refreshed, unmatched
```
(`from app.hr.client import RawHrPosition` — 순환 임포트 시 `TYPE_CHECKING`/지연 임포트로 조정. `matched`가 빈 set일 때 `not_in` 동작 확인 — sqlite에서 `not_in([])`은 전 행 참이라 의도대로 전 보유자 소거되지만, positions가 있는데 전부 unmatched인 극단 케이스에서도 소거가 도는 게 맞는지: 맞다 — 피드는 정상인데 매핑이 전멸이면 unmatched 카운트가 크게 떠서 §7 이행 확인에서 잡힌다. 우려되면 `matched`가 비면 소거 스킵으로 완화해도 좋다 — 어느 쪽이든 테스트로 고정하고 리포트에 명시.)

`hr/service.py` `sync_all` 후속 패스 교체:
```python
    title_refreshed: int | None = None
    position_refreshed: int | None = None
    position_unmatched: int | None = None
    if settings.ldap_enabled:
        positions: list[client.RawHrPosition] = []
        if settings.position_enabled:
            try:
                positions = await client.fetch_positions()
            except Exception:  # noqa: BLE001 -- EDW 실패 시 title만 갱신 (설계 §4-2)
                logger.exception("EDW positions fetch failed — proceeding with title-only AD pass")
        try:
            from app.ad.service import refresh_titles_and_positions  # 지연 import(LDAP 미설정 무부하)

            title_refreshed, position_refreshed, position_unmatched = (
                await refresh_titles_and_positions(session, positions)
            )
        except Exception:  # noqa: BLE001 -- AD 패스 실패가 sync 자체를 깨면 안 됨 (§5-7)
            logger.exception("AD title/position refresh failed — HR sync itself succeeded")
```
`HrSyncSummary`·`SyncSummaryOut`에 `position_refreshed: int | None = None`·`position_unmatched: int | None = None` 추가, summary 반환에 전달.

- [ ] **Step 4: GREEN + 전체 그린 + ruff** — 개명으로 깨지는 기존 참조(`refresh_titles`)는 전수 갱신(`git grep refresh_titles`).
- [ ] **Step 5: 커밋** — `feat(hr): EDW position pipeline via AD employeeNumber mapping — EDW 직책 수집(n8n hr-position)·AD 사번 매핑·소거 가드` + PROGRESS 한 줄.

---

### Task 4: 노출 직책 allowlist + /api/me manager_ids 부서 체인

**Files:**
- Modify: `backend/app/app_settings.py`, `backend/app/routers/app_settings.py`(+`schemas.py`의 해당 In/Out), `backend/app/main.py`(/api/me manager 블록 교체 — `DeptInfo` 임포트 제거)
- Test: `backend/tests/test_me_manager_chain.py`(신규)·app-settings 기존 테스트 확장

**Interfaces:**
- Consumes: Task 1 `DeptIndex.by_code`(체인 상향), Task 3 `Employee.position`.
- Produces: `get_exposed_positions(session) -> list[str]`, app-settings 응답 `exposed_positions`/`available_positions`, `MeOut.manager_ids`(형태 불변) = 부서 체인 직책 보유자.

- [ ] **Step 1: 실패 테스트** — ① departments 체인(D1←D2←D3)+직원 시드: 리더 L2(dept_code=D2, position="팀장"), L1(dept_code=D1, position="센터장"), 나(dept_code=D3) → `/api/me` manager_ids == [L2, L1](리프 먼저) ② position="프로외기타"(allowlist 밖) 리더는 제외 ③ inactive 리더 제외·본인 제외 ④ dept_code 없음/departments 빈 환경 → `[]` ⑤ app-settings: GET 기본값 `["그룹장","파트장","팀장","센터장"]`·PUT 저장 반영·`available_positions`가 employees distinct position 정렬 목록. (기존 dept_info 기반 manager_ids 단언 테스트가 있으면 `git grep -n "manager_ids" backend/tests`로 찾아 새 의미로 갱신 — 사유 리포트 명시.)
- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현**

`app_settings.py`:
```python
EXPOSED_POSITIONS_KEY = "exposed_positions"
# 부서장으로 노출할 EDW 직책(FRNM) — 설정 화면에서 교체. 빈 목록 저장 = 전부 비노출(의도 허용).
DEFAULT_EXPOSED_POSITIONS = ["그룹장", "파트장", "팀장", "센터장"]


async def get_exposed_positions(session: AsyncSession) -> list[str]:
    """노출 직책 allowlist — 행 부재/파싱 불가면 기본값, 저장된 빈 목록은 그대로 존중."""
    row = await session.get(AppSetting, EXPOSED_POSITIONS_KEY)
    if row is None:
        return list(DEFAULT_EXPOSED_POSITIONS)
    try:
        stored = json.loads(row.value)
    except ValueError:
        return list(DEFAULT_EXPOSED_POSITIONS)
    if not isinstance(stored, list):
        return list(DEFAULT_EXPOSED_POSITIONS)
    return [v.strip() for v in stored if isinstance(v, str) and v.strip()]
```
`routers/app_settings.py`: 기존 `_to_out`/PUT 패턴에 맞춰 `exposed_positions`(저장·반환)와 읽기전용 `available_positions`(`select(distinct(Employee.position)).where(Employee.position.is_not(None))` 정렬) 추가. PUT In은 기존 필드들과 같은 옵셔널 규약.

`main.py` manager 블록 교체(기존 dept_info 블록 삭제·`DeptInfo` 임포트 제거 — 이 파일 마지막 사용처):
```python
    # 나의 관리자 — 부서 체인(리프→루트)의 노출 직책 보유자 (설계 2026-08-11 §5)
    manager_ids: list[str] = []
    if emp and emp.dept_code and emp.dept_code in dept_index.by_code:
        chain_codes: list[str] = []
        cur: str | None = emp.dept_code
        while cur is not None and cur in dept_index.by_code and cur not in chain_codes and len(chain_codes) < 15:
            chain_codes.append(cur)
            cur = dept_index.by_code[cur][1]
        exposed = set(await get_exposed_positions(session))
        if exposed:
            leader_rows = (
                await session.execute(
                    select(Employee.login_id, Employee.dept_code).where(
                        Employee.dept_code.in_(chain_codes),
                        Employee.position.in_(exposed),
                        Employee.active.is_(True),
                    )
                )
            ).all()
            leaders_by_code: dict[str, list[str]] = {}
            for lid, dcode in leader_rows:
                leaders_by_code.setdefault(dcode, []).append(lid)
            for code in chain_codes:
                for lid in sorted(leaders_by_code.get(code, [])):
                    if lid != login_id and lid not in manager_ids:
                        manager_ids.append(lid)
```
(`dept_index`는 Task 2가 /me에 넣어둔 로드를 재사용.)

- [ ] **Step 4: GREEN + 전체 그린 + ruff.**
- [ ] **Step 5: 커밋** — `feat(me): dept-chain manager ids from EDW positions + exposed allowlist — 부서 체인 관리자·노출 직책 설정` + PROGRESS 한 줄.

---

### Task 5: 표시·목록 소비처 전환 + 잔여 판정 4파일 + position 직렬화

**Files:**
- Modify: `backend/app/routers/directory.py`, `backend/app/routers/admin.py`(`get_admin_users`·`_load_valid_org_paths`), `backend/app/routers/dashboard.py`(`_resolve_display_name`·coverage 한글맵), `backend/app/routers/versions.py`(eligible `dept_infos`), `backend/app/schemas.py`(`DirectoryDeptOut.manager`·`AdminDeptOut.manager`·`DeptInfoValueOut.manager` 삭제, `DirectoryUserOut.position: str = ""` 추가)
- Modify(잔여 판정 4파일): `backend/app/routers/library.py:35`, `backend/app/routers/maps.py:234·438·509(list_editors — 다수 루프면 인덱스 1회 로드)`, `backend/app/routers/groups.py:118(_emp_org_path)`, `backend/app/routers/categories.py:65` — access.py와 같은 `resolve_org_path` 치환 패턴
- Test: 기존 directory/admin/dashboard/eligible 테스트 갱신 + departments·position 시드 신규 단언

**Interfaces:**
- Consumes: Task 1 resolver, Task 4 `get_exposed_positions`.
- Produces: `DirectoryDeptOut{id,name,korean_name}`, `AdminDeptOut{name,org_levels,korean_name}`, `DeptInfoValueOut{korean_name}`, `DirectoryUserOut.position`(allowlist 필터 — FE Task 7·9 소비).

- [ ] **Step 1: 실패 테스트** — departments 시드 후 directory/eligible/admin 응답 `korean_name` = name_ko·`manager` 키 부재, directory users의 `position`이 allowlist 직책만 노출(밖이면 ""), dashboard 부서 표시명 1건. 잔여 4파일은 기존 테스트 무수정 그린이 회귀 증거(경로 의미 동일).
- [ ] **Step 2: RED 확인.**
- [ ] **Step 3: 구현** — directory: 경로·프리픽스 resolver화, `korean_name=index.name_ko_by_name.get(leaf, "")`, users에 `position=emp.position if emp.position in exposed else ""`; admin: users·departments 모두 resolver 경로 `split("/")` 기반 통일(빈 경로→`[]`), korean은 name_ko 맵, `_load_valid_org_paths`는 resolved 프리픽스 합집합(docstring 문구 유지 가능 — directory와 동일 소스); dashboard: `_resolve_display_name` department 분기 = `select(Department).where(Department.name == leaf).order_by(Department.dept_code).limit(1)` 첫 행 name_ko(없으면 leaf), coverage 맵 = `load_dept_index().name_ko_by_name`, `DeptInfo` 임포트 제거; versions: `DeptInfoValueOut(korean_name=index.name_ko_by_name...)` — 맵에 없는 부서는 기존처럼 dict 생략; 잔여 4파일 치환. dept_info를 시드해 korean_name을 단언하던 기존 테스트는 departments 시드로 갱신(목록·사유 리포트 명시 — 한글명 소스 교체는 이 태스크의 스펙).
- [ ] **Step 4: GREEN + 전체 그린 + ruff + `git grep -n "DeptInfo" backend/app/routers backend/app/permissions` 0건 확인.**
- [ ] **Step 5: 커밋** — `feat(directory): departments-sourced names/paths, expose leader position — 표시·판정 소비처 departments 전환·직책 직렬화` + PROGRESS 한 줄.

---

### Task 6: dept_info·임포트 API 제거 (백엔드)

**Files:**
- Modify: `backend/app/models.py`(`DeptInfo` 클래스 삭제), `backend/app/routers/admin.py`(`PUT /dept-info` 삭제), `backend/app/routers/employees.py`(`PUT /korean-names` 삭제), `backend/app/schemas.py`(`DeptInfoImportIn/Out`·`KoreanNamesImportIn/Out`·`SyncSummaryOut.dept_info_orphans`·`HrSyncPreviewOut.dept_info_orphans` 삭제), `backend/app/hr/service.py`(`_find_dept_info_orphans`·summary/preview 필드·호출 삭제)
- Test: 임포트 테스트 삭제(전용 파일이면 파일째), sync/preview 단언에서 `dept_info_orphans` 제거, 라우트 부재 확인 각 1건(실행으로 상태코드 확정해 단언)

- [ ] **Step 1: 소비 잔존 확인** — `git grep -n "DeptInfo\|dept_info" backend/app/` 가 삭제 대상 파일 외 0건인지 확인(남았으면 STOP·보고).
- [ ] **Step 2: 삭제 수행** — `dept_info` 테이블 DDL은 어디에도 추가하지 않는다(운영 잔류·로컬 신규 미생성).
- [ ] **Step 3: 테스트 정리 + 전체 그린 + ruff + `git grep -n "DeptInfo" backend/` 0건.**
- [ ] **Step 4: 커밋** — `refactor(admin): remove dept_info model and both JSON import APIs — dept_info 소비·임포트 API 전제거(운영 테이블 잔류)` + PROGRESS 한 줄.

---

### Task 7: FE — api 타입·korean-dept·피커 정리

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/korean-dept.ts`, `frontend/src/components/permissions/principal-picker.tsx`
- Test: `frontend/src/lib/korean-dept.test.ts` 갱신

- [ ] **Step 1: api.ts** — `SyncSummary`: `dept_info_orphans` 삭제, `position_refreshed: number | null`·`position_unmatched: number | null` 추가. `DirectoryDept.manager`·`AdminDept.manager` 삭제(주석 소스 표기 갱신), `DirectoryUser.position?: string` 추가. eligible `dept_infos` 타입(`api.ts:308` 부근)에서 `manager` 삭제. `importKoreanNames`·`KoreanNamesImportSummary`·`importDeptInfo`·`DeptInfoImportSummary` 삭제. app-settings 타입에 `exposed_positions: string[]`·`available_positions: string[]`(+PUT 파라미터) 추가 — 기존 AppSettings 함수 형태 준수.
- [ ] **Step 2: korean-dept.ts** — `buildDepartmentOptions` `deptInfos` 파라미터 타입·키워드 조합에서 `manager` 제거(주석 갱신). `formatRosterName`·`sortManagersFirst` 무변경.
- [ ] **Step 3: principal-picker.tsx** — `PrincipalOption.manager`·`buildOptions`의 manager 대입·검색 필드 배열의 manager 항목 제거. **Manager 태그·정렬 로직 무변경.**
- [ ] **Step 4: 테스트** — korean-dept.test.ts manager 키워드 단언 정리 → `npm run test -- --run` 그린(tsc 전체 그린은 Task 8·9 종료 시 달성 허용).
- [ ] **Step 5: 커밋** — `refactor(fe): drop dept_info manager surfaces, add position/sync fields — FE 타입 정리(직책·요약 필드)` + PROGRESS 한 줄.

---

### Task 8: FE — 임포트 모달 삭제 + 부서관리 재배치

**Files:**
- Delete: `frontend/src/components/admin/korean-name-modal.tsx`, `frontend/src/components/admin/dept-info-modal.tsx`
- Modify: `frontend/src/components/admin/employee-table.tsx`(모달·`kr-add-btn`·state 제거), `frontend/src/components/admin/department-table.tsx`, `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: employee-table.tsx** — `KoreanNameModal` 임포트·`showKrModal`·버튼·렌더 삭제. sync 요약 문자열은 카운트만 써서 무변경.
- [ ] **Step 2: department-table.tsx** — `DeptInfoModal` 임포트·state·`dept-info-add-btn`·렌더 삭제. **소멸 부서 재지정 카드(`dept-remap-card`)를 `<TableCard>` 위로 이동**(순서: 헤더 행 → remap 카드 → 테이블). `<TableCard>`를 `<div className="max-h-[60vh] overflow-y-auto" data-id="dept-table-scroll">`로 감싸 스크롤 격리(TableCard 자체가 카드 — 중첩 테두리 금지). Manager 열(th+`dept-manager-cell` td) 삭제, `colCount = showOrg ? 2 + maxOrgDepth : 3`. 상단 주석의 부서장 문구 갱신.
- [ ] **Step 3: i18n** — `admin.deptInfoAdd`·`admin.deptManagerCol`·`admin.krAdd`(미사용 확인 후)·모달 전용 키를 EN/KO 두 블록에서 제거(`git grep`으로 타 사용처 없는 키만).
- [ ] **Step 4: 게이트** — `npx tsc --noEmit && npm run lint && npm run test -- --run` 그린, `git grep "deptInfoAdd\|deptManagerCol\|KoreanNameModal\|DeptInfoModal" frontend/src` 0건.
- [ ] **Step 5: 커밋** — `feat(admin-ui): orphan remap above dept table, drop import modals — 고아 재지정 상단·테이블 스크롤·임포트 모달 삭제` + PROGRESS 한 줄.

---

### Task 9: FE — 노출 직책 카드 + 직책 병기

**Files:**
- Modify: `frontend/src/components/admin/employee-table.tsx`(노출 직책 카드), `frontend/src/components/user-hover-card.tsx`(title 옆 병기), `frontend/src/components/maps/map-detail-card.tsx`(멤버 행 title 병기), `frontend/src/lib/i18n-messages.ts`(신규 키 EN/KO)

- [ ] **Step 1: 노출 직책 카드** — employee-table 상단(테이블 위)에 컴팩트 카드: app-settings API로 `available_positions` 체크박스 목록(현 `exposed_positions` 체크 상태) + Save 버튼(PUT). 기존 admin 카드 스타일(`border-hairline`·`bg-surface-alt`·`text-caption`) 재사용, data-id `exposed-positions-card`. available이 빈 경우 빈 상태 문구(직책 미수집 — sync 후 표시).
- [ ] **Step 2: 직책 병기** — `user-hover-card.tsx`: `user?.position`이 비어있지 않으면 title 라인에 `{title} · {position}` 형태 병기(title 없이 position만 있으면 position만). `map-detail-card.tsx`: `titleById` 값 구성 시 동일 규칙로 position 병기(`dir.users` 맵핑부). 백엔드가 allowlist 필터를 이미 적용하므로 FE는 값 존재 여부만 본다.
- [ ] **Step 3: 게이트** — `npx tsc --noEmit && npm run lint && npm run test -- --run && npm run build` 전부 그린.
- [ ] **Step 4: 커밋** — `feat(fe): exposed-positions admin card + leader position beside title — 노출 직책 선택 카드·직책 병기` + PROGRESS 한 줄.

---

### Task 10: 최종 게이트 + 브라우저 스모크

**Files:**
- Modify: `PROGRESS.md`(완료 기록)

- [ ] **Step 1: 백엔드 전체** — env-clean pytest 그린 + ruff 0.
- [ ] **Step 2: 프론트 전체** — tsc·lint·vitest·build 그린.
- [ ] **Step 3: 로컬 브라우저 스모크(가능 범위)** — 백엔드(:8901)·프론트(:3200) 기동(좀비 프론트 전수 pkill — `docs/lessons/browser-verification.md`), Playwright+시스템 Chrome: ① 설정 Departments 탭 — 고아 섹션 상단·Manager 열 부재·테이블 스크롤 ② Employees 탭 — 임포트 버튼 부재·노출 직책 카드 렌더 ③ 피커 부서 검색·표시 정상 ④ (시드 가능하면) departments+position 시드 후 /api/me manager_ids·피커 Manager 태그 확인. departments 빈 DB에서 한글명 공란은 정상(폴백).
- [ ] **Step 4: PROGRESS.md 갱신 + 최종 커밋**(게이트 결과 한 줄).
