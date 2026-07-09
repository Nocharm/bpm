# 멤버 카드 한/영 이름·아이콘 + 부서 매핑 철회 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 멤버 카드(맵 상세>멤버)의 아이콘을 접힌 카드 높이로 확대하고 유저 이름을 한/영 토글(+펼침 시 반대 언어 필)로 표시하며, 그룹 카드 이름 해석 누락을 고치고, 부서 매핑 액션(모달·PUT·필터)을 철회한다(관찰용 열·툴팁 유지, 툴팁 1열화).

**Architecture:** `/api/directory`에 `korean_name`만 추가(카드가 이미 쓰는 API). 매핑 철회는 순수 삭제 — `employees.korean_name/korean_dept` 컬럼·임포트(`PUT /api/employees/korean-names`)·관찰용 표시는 절대 건드리지 않는다.

**Spec:** `docs/superpowers/specs/2026-07-09-member-card-korean-names-design.md`

## Global Constraints

- 작업 루트: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-2` — 메인 체크아웃 접근 금지, 브랜치 전환 금지(`worktree-ui-improvement-2`).
- **삭제 금지 목록(유지)**: `employees.korean_name`/`korean_dept` 컬럼·`_ADDED_COLUMNS` 등록, `PUT /api/employees/korean-names` 임포트 전체, Employees 탭 korean 열·모달·추출 스플릿, 부서 탭 `korean dept` 열(`admin.deptKrCol` 키 포함)·인원수 명단 툴팁, `AdminUserOut.korean_name/korean_dept`, `korean-dept.ts`의 `getDeptMembers`/`aggregateDeptKoreanDepts`/`formatRosterName`/`buildExportIds`.
- 모든 커밋에 `PROGRESS.md` 갱신 포함(최상단 `## 2026-07-09 — AD 동기화 비활성 제외 + 프룬` 섹션에 한 줄). 커밋 메시지 `type(scope): English — 한국어` + 트레일러 2줄(`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01GYhJfUnNEGtfRwVwC4UoGv`). `git add` 파일 명시.
- Python 타입힌트·ruff 0. TS: raw hex 금지, Lucide strokeWidth 1.5, data-id 부여, `any`·`useCallback` 추가 금지.
- backend 게이트: `backend/`에서 `.venv/bin/python -m pytest tests/ -q`·`.venv/bin/ruff check app/ tests/`. frontend: `npm run lint`·`npm test`·`npm run build`.

---

### Task 1: BE — directory에 korean_name 노출 + 부서 매핑 엔드포인트 삭제

**Files:**
- Modify: `backend/app/schemas.py` (`DirectoryUserOut` ~line 725 + `DeptKoreanDeptIn/Out` 삭제)
- Modify: `backend/app/routers/directory.py` (DirectoryUserOut 생성부)
- Modify: `backend/app/routers/admin.py` (`set_department_korean_dept` 삭제 + import 정리)
- Modify: `backend/tests/test_dept_korean_mapping.py` (매핑 테스트 삭제·유지 정리)
- Test: directory 테스트가 있는 기존 파일(grep으로 `api/directory` 테스트 위치 확인, 없으면 `tests/test_directory.py` 신규)

**Interfaces:**
- Produces: `GET /api/directory` 유저 항목에 `korean_name: str`(기본 "") — Task 3이 사용.
- Removes: `PUT /api/admin/departments/korean-dept`(호출자는 Task 2에서 함께 삭제되는 `setDeptKoreanDept`뿐 — 다른 호출자 없음을 grep으로 확인).

- [ ] **Step 1: 실패하는 테스트 작성** — directory 응답에 korean_name:

```python
def test_directory_includes_korean_name(client: TestClient) -> None:
    """멤버 카드 한/영 토글용 — /api/directory 유저 항목에 korean_name 노출."""
    # employees에 한글이름 시드 (기존 시드 유저 재사용)
    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_name = "이민재"
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["id"]: u for u in res.json()["users"]}
    assert by_id["user.lee"]["korean_name"] == "이민재"
```

(배치할 파일의 기존 import 관례에 맞춰 asyncio/SessionLocal/Employee import. `/api/directory`의 인증 요구사항은 기존 테스트를 따라 헤더 구성.)

- [ ] **Step 2: 실패 확인** — `KeyError: 'korean_name'`

- [ ] **Step 3: 구현** — `DirectoryUserOut`에 `korean_name: str = ""` 추가(`role: str = "user"` 아래), `routers/directory.py`의 DirectoryUserOut 생성에 `korean_name=emp.korean_name` 전달.

- [ ] **Step 4: 매핑 엔드포인트 삭제** —
  - `routers/admin.py`: `set_department_korean_dept` 함수 전체 삭제, import에서 `DeptKoreanDeptIn, DeptKoreanDeptOut` 제거.
  - `schemas.py`: `DeptKoreanDeptIn`/`DeptKoreanDeptOut` 클래스 삭제.
  - `tests/test_dept_korean_mapping.py`: `test_dept_mapping_updates_exact_path_only`·`test_dept_mapping_unknown_path_updates_zero`·`test_dept_mapping_rejects_blank_and_overlong`·`test_dept_mapping_rejects_empty_levels`·`test_dept_mapping_requires_sysadmin` 삭제. **유지**: `test_admin_users_include_korean_fields`(+필요 헬퍼 `_seed_org`, autouse cleanup). 미사용이 된 헬퍼/fixture(`_get_korean_dept`, `sysadmin_enforced` 등)는 제거. 파일 docstring을 "관찰용 korean 필드 노출 테스트"로 갱신.
  - 삭제 전 확인: `grep -rn "departments/korean-dept" backend/ frontend/src` — 프론트 호출자는 Task 2에서 삭제될 `api.ts` 한 곳뿐이어야 함.

- [ ] **Step 5: GREEN + 회귀 + 린트** — 신규 테스트 PASS, 전체 pytest PASS(삭제 반영 후 개수 감소 정상), ruff 0.

- [ ] **Step 6: PROGRESS.md 한 줄 후 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-2
git add backend/app/schemas.py backend/app/routers/directory.py backend/app/routers/admin.py backend/tests/test_dept_korean_mapping.py <directory 테스트 파일> PROGRESS.md
git commit -m "feat(directory): expose korean_name + drop dept bulk-mapping endpoint — 디렉터리 한글이름 노출·부서 일괄 매핑 철회"
```

---

### Task 2: FE — 매핑 UI 철회 + 명단 툴팁 1열화

**Files:**
- Delete: `frontend/src/components/admin/dept-korean-modal.tsx`
- Modify: `frontend/src/components/admin/department-table.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/korean-dept.ts`(+`.test.ts`), `frontend/src/lib/i18n-messages.ts`, `frontend/scripts/pw-smoke-korean-dept.mjs`

**Interfaces:**
- Removes: `setDeptKoreanDept`, `shouldFlagDeptMapping`, i18n 7키(en/ko). `admin.deptKrCol`·`getDeptMembers`·`aggregateDeptKoreanDepts`·`formatRosterName`·툴팁 data-id는 유지.

- [ ] **Step 1: department-table.tsx 정리** —
  - `needsOnly` state·필터 체크박스 label·`filtered` 분기 삭제 → `useInfiniteSlice(departments, "")`로 복귀.
  - `mappingDept` state·행 `onDoubleClick`·`cursor-pointer` 클래스·`DeptKoreanModal` import/마운트 삭제. `data-id="dept-row"`·`dept-kr-cell`·korean dept 열·`RosterHover`는 유지.
  - `loadDirectory` 헬퍼가 onApplied 전용이었으면 useEffect 직접 호출 형태만 남기고 정리(기존 파일 패턴 유지).
  - **툴팁 1열화**: `RosterHover` 툴팁 컨테이너 `flex max-h-64 w-72 flex-wrap content-start gap-1 overflow-y-auto ...` → `flex max-h-64 w-72 flex-col items-start gap-1 overflow-y-auto ...` (필 한 줄에 하나).
- [ ] **Step 2: lib·api·i18n 정리** — `api.ts` `setDeptKoreanDept` 삭제 / `korean-dept.ts` `shouldFlagDeptMapping` 삭제 + `korean-dept.test.ts`의 해당 describe 삭제 / i18n en·ko 각각 `admin.deptNeedsFilter`·`admin.deptKrTitle`·`admin.deptKrHint`·`admin.deptKrInputPlaceholder`·`admin.deptKrApply`·`admin.deptKrNoCandidates`·`admin.deptKrUpdated` 삭제(`admin.deptKrCol`은 유지).
- [ ] **Step 3: dept 스모크 축소** — `pw-smoke-korean-dept.mjs`에서 ③(더블클릭 모달)·④(단일 필·필터 소실) 시나리오와 필터 조작 제거. 유지: 시드 → 부서 탭 진입 → `dept-kr-cell` 2필 확인 → 인원수 호버 → 툴팁 노출·이름 포함. 헤더 주석의 시나리오 설명 갱신.
- [ ] **Step 4: 검증** — `npm run lint` 0 · `npm test` PASS(삭제 반영) · `npm run build` 성공. `grep -rn "shouldFlagDeptMapping\|setDeptKoreanDept\|deptKrTitle\|DeptKoreanModal" frontend/src` → 0건 확인.
- [ ] **Step 5: PROGRESS.md 한 줄 후 커밋**

```bash
git add -A frontend/src/components/admin frontend/src/lib/api.ts frontend/src/lib/korean-dept.ts frontend/src/lib/korean-dept.test.ts frontend/src/lib/i18n-messages.ts frontend/scripts/pw-smoke-korean-dept.mjs PROGRESS.md
git commit -m "refactor(admin): retract dept mapping UI, single-column roster tooltip — 부서 매핑 UI 철회·명단 툴팁 1열"
```

(주의: `git add -A frontend/src/components/admin`은 modal 파일 삭제를 스테이징하기 위함 — 그 외는 파일 명시.)

---

### Task 3: FE — 멤버 카드: 아이콘 확대 + 이름 한/영 토글 + 반대 언어 필 + 그룹 이름

**Files:**
- Modify: `frontend/src/lib/api.ts` (`DirectoryUser` ~line 913)
- Modify: `frontend/src/components/maps/map-detail-card.tsx`

**Interfaces:**
- Consumes: Task 1의 `korean_name`.
- Produces: data-id `member-alt-name`(반대 언어 필) — Task 4 스모크가 검증.

- [ ] **Step 1: api.ts** — `DirectoryUser`에 `korean_name?: string;` 추가(`role?: string;` 아래, 서버 기본 ""라 optional 표기).

- [ ] **Step 2: map-detail-card.tsx** — 다음 편집을 그대로 적용:

(a) `const { t } = useI18n();` → `const { t, lang } = useI18n();`

(b) state 2종 추가 — `nameById` 선언(~line 157) 아래:

```tsx
  // loginId → 한글이름 — 언어 토글 표시용(없으면 영문 폴백) (member-card design 2026-07-09)
  const [koreanNameById, setKoreanNameById] = useState<Map<string, string>>(new Map());
  // 그룹 id → 그룹 이름 — 그룹 카드가 id를 그대로 노출하던 누락 수정
  const [groupNameById, setGroupNameById] = useState<Map<string, string>>(new Map());
```

데이터 적재(~line 203-208)의 `setNameById(...)` 아래·`setGroupInfo(...)` 옆에:

```tsx
            setKoreanNameById(new Map(dir.users.map((u) => [u.id, u.korean_name ?? ""])));
```

```tsx
            setGroupNameById(new Map(groups.map((g) => [String(g.id), g.name])));
```

(c) 유저 nameLine(line 392)·펼침 필 — 기존:

```tsx
                          nameLine = nameById.get(perm.principal_id) ?? perm.principal_id;
```

변경:

```tsx
                          const enName = nameById.get(perm.principal_id) ?? perm.principal_id;
                          const krName = koreanNameById.get(perm.principal_id) ?? "";
                          // 언어 토글: ko=한글(없으면 영문), en=영문. 반대 언어는 펼침 필로.
                          nameLine = lang === "ko" ? krName || enName : enName;
                          const altName = lang === "ko" ? (krName ? enName : "") : krName;
```

펼침 블록의 아이디 필(line 412-414) **위에** 반대 언어 필 추가:

```tsx
                                    {altName && (
                                      <span
                                        data-id="member-alt-name"
                                        className="rounded-xs border border-ink-tertiary/40 px-1.5 py-0.5 text-fine text-ink-secondary"
                                      >
                                        {altName}
                                      </span>
                                    )}
```

(d) 그룹 nameLine(line 434) — `nameLine = perm.principal_id;` → `nameLine = groupNameById.get(perm.principal_id) ?? perm.principal_id;`

(e) **아이콘 확대** — `MemberIcon`(line 68-88) 교체:

```tsx
// 멤버 행 아이콘 — 부서는 레벨별, 그룹은 UsersRound, 유저는 User(본인이면 'me' 배지) (HM)
// 접힌 카드 2줄 높이 기준 확대(22px) — 컨테이너가 세로 중앙 정렬 (member-card design 2026-07-09)
function MemberIcon({ perm, isMe }: { perm: MapPermission; isMe: boolean }) {
  if (perm.principal_type === "user") {
    if (isMe) {
      // 본인 — 손든 사람 아이콘 + 작은 ME, 악센트 선색으로 강조
      return (
        <span
          data-id="member-me-badge"
          title="me"
          className="inline-flex shrink-0 flex-col items-center text-accent"
        >
          <Hand size={20} strokeWidth={2} />
          <span className="text-[9px] font-bold leading-none">ME</span>
        </span>
      );
    }
    return <User size={22} strokeWidth={1.5} />;
  }
  if (perm.principal_type === "group") return <UsersRound size={22} strokeWidth={1.5} />;
  const Icon = LEVEL_ICONS[deptLevelRank(deptLeaf(perm.principal_id))] ?? Building2;
  return <Icon size={22} strokeWidth={1.5} />;
}
```

아이콘 컨테이너(line 511) — 기존 `<span className="mt-0.5 flex w-6 shrink-0 justify-center">` → 접힌 2줄 높이 고정 박스에서 중앙(펼침 시에도 상단 유지):

```tsx
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start">
```

(f) `MembersSkeleton`(line 90~)의 아이콘 자리 치수가 `w-6` 기준이면 `w-9` 기준으로 동기(고스트 리플로우 방지 목적 유지 — 실제 행 치수 모사 주석 참조).

- [ ] **Step 3: 검증** — `npm run lint` 0 · `npm test` PASS · `npm run build` 성공.

- [ ] **Step 4: PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/components/maps/map-detail-card.tsx PROGRESS.md
git commit -m "feat(members): bigger card icons + ko/en name toggle + group name resolve — 멤버 카드 아이콘 확대·한/영 이름·그룹 이름"
```

---

### Task 4: 브라우저 스모크 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-member-card.mjs`
- (재실행) `pw-smoke-korean-dept.mjs`(축소판)·`pw-smoke-korean-names.mjs`(회귀)

- [ ] **Step 1: 서버 기동** — 백엔드는 **메인 dev.db 사본**으로(맵·멤버 데이터 필요):

```bash
pkill -f "uvicorn app.main:app --port 8001" 2>/dev/null; sleep 1
cp /Users/hyeonjin/Documents/bpm/backend/dev.db /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-2/backend/dev.db
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-2/backend
nohup .venv/bin/uvicorn app.main:app --port 8001 > /private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/13be4761-75fa-46ee-9196-5f78cd845771/scratchpad/backend-8001.log 2>&1 & disown
cd ../frontend
lsof -nP -iTCP:3000 -sTCP:LISTEN || (BACKEND_URL=http://localhost:8001 nohup npm run dev > /private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/13be4761-75fa-46ee-9196-5f78cd845771/scratchpad/frontend-3000.log 2>&1 & disown)
sleep 6
sqlite3 ../backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';"
```

- [ ] **Step 2: 멤버 카드 스모크 작성·실행** — `pw-smoke-member-card.mjs` (기존 스모크 관례: playwright-core+시스템 Chrome, `bpm.devUser=admin.sys`, check/exit 규율, data-id 셀렉터):
  1. 준비: `/api/admin/users`에서 임의 맵 멤버가 될 유저 확인이 어려우므로, 접근 가능한 맵 목록(`/api/maps`) 중 멤버 섹션이 뜨는 맵을 홈에서 선택(`page.goto(BASE)`, 맵 카드 클릭). 멤버 유저 행의 login_id 하나를 얻어(`/api/maps/{id}` 권한 API 또는 화면 텍스트) 그 유저에게 임포트 API로 한글이름 부여: `PUT /api/employees/korean-names` `{mode:"overwrite", entries:{[id]:{name:"홍길동"}}}`. 페이지 새로고침.
  2. `bpm.lang=en`: 해당 유저 행 이름줄이 영문(홍길동 미노출) → 행 클릭 펼침 → `[data-id="member-alt-name"]`에 "홍길동".
  3. `bpm.lang=ko`로 재로드: 이름줄 "홍길동" → 펼침 → alt 필에 영문 이름.
  4. Me 뱃지 `[data-id="member-me-badge"]` 존재(스모크 유저가 멤버인 맵 전제 — admin.sys 소유 맵 선택).
  5. 그룹 카드가 있으면 이름이 숫자 id가 아님을 확인(없으면 SKIP 로그 — vacuous 체크 금지, 결과에 skipped로 표기).
  6. 콘솔 에러 0, N/N passed, exit code 규율.
  실패 시 셀렉터/전제(데모 DB 구성) 문제인지 제품 결함인지 구분 — 제품 결함이면 고치지 말고 보고.
- [ ] **Step 3: 기존 스모크 재실행** — DB 한글 필드 리셋 후 `pw-smoke-korean-names.mjs`(17/17), 리셋 후 `pw-smoke-korean-dept.mjs`(축소판 전체 PASS).
- [ ] **Step 4: 최종 게이트** — backend pytest·ruff / frontend lint·vitest·build 전부 PASS.
- [ ] **Step 5: DB 한글 필드 리셋 + PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/scripts/pw-smoke-member-card.mjs PROGRESS.md
git commit -m "test(members): member-card ko/en + icon smoke — 멤버 카드 스모크"
```

---

## 완료 후

- superpowers:finishing-a-development-branch — 머지/푸시는 사용자 결정(직전 패턴: 커밋 후 push).
- 백로그: 부서 카드 한글 표시·어미 레벨 귀속 매핑(데이터 확인 후 재설계), collaborators-panel 한/영.
