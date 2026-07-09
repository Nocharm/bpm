# 피커 한글이름·한글그룹 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전 피커(협업자/결재자/그룹멤버 PrincipalPicker · 담당자/부서 SearchSelect · 점유권 이전)에 한글이름 검색(초성 자동 지원)과 부서 항목의 한글그룹 파생 키워드 검색을 추가하고, 행 표시를 언어 토글에 연동하며, 점유권 이전의 자체 필터를 `filterByQuery`로 통일한다.

**Architecture:** `search.ts`는 무변경 — 호출자의 FieldSpec 확장만. 백엔드는 이미 있는 스키마 필드(`korean_name`/`korean_dept`)의 미전달 지점을 채우는 것 위주. 저장값(영문 name/부서 문자열)은 절대 불변 — label/표시만 연동.

**Spec:** `docs/superpowers/specs/2026-07-09-picker-korean-search-design.md`

## Global Constraints

- 작업 루트: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-3` — 메인 체크아웃 접근 금지(스모크 dev.db 복사 소스 제외), 브랜치 전환 금지(`worktree-ui-improvement-3`).
- **저장값 불변**: 노드 assignee/department에 저장되는 값·PrincipalOption.principalId·SearchSelect `value`는 영문 그대로. label/표시/keywords만 변경.
- **유저 항목을 korean_dept로 매칭 금지**(스펙 §2 — 부서원 전원 덮임 방지 원칙).
- PROGRESS.md 갱신 동일 커밋(최상단 `## 2026-07-09 — 피커 한글 검색` 섹션에 한 줄). 커밋 메시지 `type(scope): English — 한국어` + 트레일러 2줄(`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01GYhJfUnNEGtfRwVwC4UoGv`). `git add` 파일 명시.
- Python 타입힌트·ruff 0. TS `any`·`useCallback` 추가 금지, raw hex 금지, data-id 부여.
- 게이트: backend `.venv/bin/python -m pytest tests/ -q`·ruff / frontend `npm run lint`·`npm test`·`npm run build`.

---

### Task 1: BE — korean 필드 전달 보강 (4개 엔드포인트)

**Files:**
- Modify: `backend/app/schemas.py` (`DirectoryUserOut`에 `korean_dept: str = ""` — `korean_name` 아래)
- Modify: `backend/app/routers/directory.py` (생성부에 `korean_dept=emp.korean_dept`)
- Modify: `backend/app/routers/versions.py` (eligible-assignees의 `DirectoryUserOut(...)` 생성부에 `korean_name=`·`korean_dept=` 전달 — `grep -n "DirectoryUserOut(" app/routers/versions.py`로 위치 확인)
- Modify: `backend/app/routers/maps.py` (eligible-approvers 생성부 + `list_editors`(~line 425)의 `DirectoryUserOut(...)`에 `korean_name=` 전달 — editors는 `emp_map[lid].korean_name if lid in emp_map else ""`)
- Test: `backend/tests/test_directory.py`(korean_dept 노출) + eligible-assignees/approvers/editors를 다루는 기존 테스트 파일에 각 1건(`grep -rn "eligible-assignees\|eligible-approvers\|/editors" backend/tests/`로 위치 확인, 없으면 test_directory.py에 통합)

**Interfaces:**
- Produces: `/api/directory` 유저에 `korean_dept`, `/versions/{id}/eligible-assignees`·`/maps/{id}/eligible-approvers`·`/maps/{id}/editors` 유저에 `korean_name`(+assignees는 `korean_dept`) 실값 — Task 2~4가 소비.

- [ ] **Step 1: 실패하는 테스트 작성** — 각 엔드포인트가 시드된 한글 값을 반환하는지(기존 테스트 파일의 시드/클라이언트 패턴 재사용, `_seed` 유틸은 test_korean_names.py 참고). 예(디렉터리):

```python
def test_directory_includes_korean_dept(client: TestClient) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_dept = "소싱1팀"
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    by_id = {u["id"]: u for u in res.json()["users"]}
    assert by_id["user.lee"]["korean_dept"] == "소싱1팀"
```

eligible-assignees/approvers/editors 테스트는 해당 엔드포인트의 기존 테스트 셋업(맵/버전/권한 시드)을 따라 최소로 — 시드 유저에 korean_name 지정 후 응답 필드 단언. 셋업이 과도하게 복잡하면 editors/approvers는 통합 1건으로 축소 가능(무엇을 합쳤는지 리포트에 명시).

- [ ] **Step 2: RED 확인** → **Step 3: 구현**(위 파일 4곳) → **Step 4: GREEN + 전체 pytest + ruff 0**

- [ ] **Step 5: PROGRESS.md 한 줄 후 커밋**

```bash
git add backend/app/schemas.py backend/app/routers/directory.py backend/app/routers/versions.py backend/app/routers/maps.py backend/tests/<수정한 테스트 파일들> PROGRESS.md
git commit -m "feat(api): fill korean fields in picker-facing endpoints — 피커 대상 응답 한글 필드 전달"
```

---

### Task 2: FE lib — 파생·포맷·옵션 빌더 (vitest)

**Files:**
- Modify: `frontend/src/lib/api.ts` — `DirectoryUser`에 `korean_dept?: string;`(korean_name 아래), `EligibleAssignees.users` 항목 타입에 `korean_name?: string; korean_dept?: string;`
- Modify: `frontend/src/lib/korean-dept.ts`(+`korean-dept.test.ts`) — 신규 함수 3개 추가(기존 함수 무변경)

**Interfaces:**
- Produces (Task 3·4 소비):
  - `deriveDeptKoreanKeywords(users: { org_path?: string; korean_dept?: string }[]): Map<string, string[]>` — org_path 정확 일치 그룹의 distinct 비어있지 않은 korean_dept.
  - `buildAssigneeOptions(users: EligibleAssignees["users"], lang: Lang): SelectOption[]` — value=영문 name(불변), label=lang 연동(`formatRosterName` 재사용: ko=`한글 (영문)`), sub=`아이디 · 부서`, keywords=`아이디 + korean_name`(공백 join).
  - `buildDepartmentOptions(departments: string[], users: EligibleAssignees["users"]): SelectOption[]` — value/label=부서 영문(불변), keywords=그 부서(`department` 문자열 일치) 유저들의 distinct korean_dept 공백 join.
  - 기존 `formatRosterName`은 `{name, korean_name}` 구조면 그대로 재사용 가능(시그니처 무변경).

- [ ] **Step 1: 실패하는 테스트 작성** — `korean-dept.test.ts`에 describe 3개 추가:

```ts
describe("deriveDeptKoreanKeywords", () => {
  it("groups distinct non-empty korean_dept by exact org_path", () => {
    const users = [
      { org_path: "HQ/TeamA", korean_dept: "팀에이" },
      { org_path: "HQ/TeamA", korean_dept: "팀A그룹" },
      { org_path: "HQ/TeamA", korean_dept: "팀에이" },
      { org_path: "HQ/TeamA", korean_dept: "" },
      { org_path: "HQ/TeamA/Cell", korean_dept: "셀" },
      { korean_dept: "무경로" },
    ];
    const map = deriveDeptKoreanKeywords(users);
    expect(map.get("HQ/TeamA")).toEqual(["팀에이", "팀A그룹"]);
    expect(map.get("HQ/TeamA/Cell")).toEqual(["셀"]);
    expect(map.has("")).toBe(false);
  });
});

describe("buildAssigneeOptions", () => {
  const users = [
    { id: "h.jang", name: "Hyeonjin Jang", department: "TeamA", korean_name: "장현진", korean_dept: "팀에이" },
    { id: "no.kr", name: "No Korean", department: "TeamB" },
  ];
  it("keeps value as english name, localizes label, adds korean keywords", () => {
    const ko = buildAssigneeOptions(users, "ko");
    expect(ko[0]).toEqual({
      value: "Hyeonjin Jang",
      label: "장현진 (Hyeonjin Jang)",
      sub: "h.jang · TeamA",
      keywords: "h.jang 장현진",
    });
    expect(ko[1].label).toBe("No Korean");
    const en = buildAssigneeOptions(users, "en");
    expect(en[0].label).toBe("Hyeonjin Jang (장현진)");
    expect(en[0].value).toBe("Hyeonjin Jang");
  });
});

describe("buildDepartmentOptions", () => {
  it("derives korean keywords from members by department string", () => {
    const users = [
      { id: "a", name: "A", department: "TeamA", korean_dept: "팀에이" },
      { id: "b", name: "B", department: "TeamA", korean_dept: "팀A그룹" },
      { id: "c", name: "C", department: "TeamB" },
    ];
    const opts = buildDepartmentOptions(["TeamA", "TeamB"], users);
    expect(opts[0]).toEqual({ value: "TeamA", label: "TeamA", keywords: "팀에이 팀A그룹" });
    expect(opts[1]).toEqual({ value: "TeamB", label: "TeamB", keywords: undefined });
  });
});
```

- [ ] **Step 2: RED 확인** → **Step 3: 구현** — `korean-dept.ts`에 추가:

```ts
/** org_path 정확 일치 그룹별 distinct 한글부서 — 피커 부서 항목 검색 키워드 파생. */
export function deriveDeptKoreanKeywords(
  users: { org_path?: string; korean_dept?: string }[],
): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const u of users) {
    const path = u.org_path ?? "";
    const dept = (u.korean_dept ?? "").trim();
    if (!path || !dept) continue;
    const list = byPath.get(path) ?? [];
    if (!list.includes(dept)) list.push(dept);
    byPath.set(path, list);
  }
  return byPath;
}

/** 담당자 SelectOption 빌더 — value는 저장값(영문 name) 불변, label만 언어 연동. */
export function buildAssigneeOptions(
  users: { id: string; name: string; department: string; korean_name?: string; korean_dept?: string }[],
  lang: Lang,
): { value: string; label: string; sub?: string; keywords?: string }[] {
  return users.map((u) => ({
    value: u.name,
    label: formatRosterName({ name: u.name, korean_name: u.korean_name ?? "" }, lang),
    sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined,
    keywords: [u.id, u.korean_name ?? ""].filter(Boolean).join(" "),
  }));
}

/** 부서 SelectOption 빌더 — 소속 유저들의 distinct 한글부서를 검색 키워드로. */
export function buildDepartmentOptions(
  departments: string[],
  users: { department: string; korean_dept?: string }[],
): { value: string; label: string; keywords?: string }[] {
  const byDept = new Map<string, string[]>();
  for (const u of users) {
    const dept = (u.korean_dept ?? "").trim();
    if (!u.department || !dept) continue;
    const list = byDept.get(u.department) ?? [];
    if (!list.includes(dept)) list.push(dept);
    byDept.set(u.department, list);
  }
  return departments.map((d) => ({
    value: d,
    label: d,
    keywords: byDept.get(d)?.join(" ") || undefined,
  }));
}
```

api.ts 타입 2곳 확장(위 Files 참조 — `EligibleAssignees.users`는 인라인 객체 타입이므로 필드 2개 추가).

- [ ] **Step 4: GREEN + lint** → **Step 5: PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/korean-dept.ts frontend/src/lib/korean-dept.test.ts PROGRESS.md
git commit -m "feat(search): korean keyword derivation + picker option builders — 한글 키워드 파생·옵션 빌더"
```

---

### Task 3: FE — PrincipalPicker 한글 검색·표시 + 호출 화면 어댑터 6곳

**Files:**
- Modify: `frontend/src/lib/mock/permissions-types.ts` (`User`에 `korean_name?: string;` — line 23-30)
- Modify: `frontend/src/components/permissions/principal-picker.tsx`
- Modify: 어댑터 6곳 — `collaborators-panel.tsx`(~187-194)·`approvers-panel.tsx`(~60-63)·`approver-manager.tsx`(~57-64)·`create-map-dialog.tsx`(어댑팅 2곳 가능)·`groups-panel.tsx`·`group-detail.tsx` — DirectoryUser→MockUser 변환에 `korean_name: u.korean_name ?? ""` 추가(각 위치는 `grep -n "isSysadmin" <file>`로 특정)
- Modify: dept principal을 쓰는 화면(collaborators-panel·create-map-dialog·groups-panel 등 — `departments` prop을 넘기는 곳)에서 `deptKoreanKeywords={deriveDeptKoreanKeywords(dir.users)}` 전달(디렉터리 응답을 이미 보유)

**Interfaces:**
- Consumes: Task 1 directory 필드, Task 2 `deriveDeptKoreanKeywords`, 기존 `formatRosterName`.
- Produces: 검색 필드 user=[name, koreanName, id] / dept=[name, koreanDept×n], 행 표시 lang 연동. Task 5 스모크가 검증.

- [ ] **Step 1: principal-picker.tsx 수정** — 다음을 정확히 적용:

(a) `PrincipalOption`에 필드 추가:

```ts
  koreanName?: string;
  /** 부서 항목 전용 — 소속 유저들의 distinct 한글부서(검색 키워드) */
  koreanKeywords?: string[];
```

(b) props에 `deptKoreanKeywords?: Map<string, string[]>;` 추가, `buildOptions`가 이를 받아 userOpts에 `koreanName: u.korean_name ?? ""`, deptOpts에 `koreanKeywords: deptKoreanKeywords?.get(d.id) ?? []` 채움(시그니처에 파라미터 추가).

(c) 검색 필드(기존 line 85-94 블록) 교체 — 주석의 원칙 문구는 유지하고 한 줄 보강("한글그룹명은 부서 항목만 매칭"):

```ts
  const hits = query.trim()
    ? filterByQuery(all, query, (o) =>
        o.principalType === "user"
          ? [
              { field: "name", text: o.displayName },
              ...(o.koreanName ? [{ field: "koreanName", text: o.koreanName }] : []),
              { field: "id", text: o.principalId },
            ]
          : [
              { field: "name", text: o.displayName },
              ...(o.koreanKeywords ?? []).map((k) => ({ field: "koreanDept", text: k })),
            ],
      )
    : all.map((item) => ({ item, matches: [] as { field: string; ranges: MatchRange[] }[] }));
```

(d) 행 표시 — `const { t } = useI18n();` → `const { t, lang } = useI18n();`. 행 렌더에서 기존 `<Highlight text={opt.displayName} ranges={nameRanges} />`와 유저 보조표기 블록을 다음으로 교체(이름/한글 각자의 매치 range로 하이라이트 정합 유지):

```tsx
                {(() => {
                  const koreanRanges: MatchRange[] =
                    matches.find((m) => m.field === "koreanName")?.ranges ?? [];
                  const hasKr = opt.principalType === "user" && !!opt.koreanName;
                  const primaryKr = hasKr && lang === "ko";
                  return (
                    <span className="min-w-0 truncate">
                      {primaryKr ? (
                        <Highlight text={opt.koreanName ?? ""} ranges={koreanRanges} />
                      ) : (
                        <Highlight text={opt.displayName} ranges={nameRanges} />
                      )}
                      {/* 반대 언어 보조 — 한글 보유 유저만 */}
                      {hasKr && (
                        <span className="ml-1 text-fine text-ink-tertiary">
                          (
                          {primaryKr ? (
                            <Highlight text={opt.displayName} ranges={nameRanges} />
                          ) : (
                            <Highlight text={opt.koreanName ?? ""} ranges={koreanRanges} />
                          )}
                          )
                        </span>
                      )}
                      {/* 사용자: 아이디 · 부서 노출 (SR-2) */}
                      {opt.principalType === "user" && (
                        <span className="ml-1.5 text-fine text-ink-tertiary">
                          <Highlight text={opt.principalId} ranges={idRanges} />
                          {opt.department ? ` · ${opt.department}` : ""}
                        </span>
                      )}
                      {opt.principalType !== "user" && opt.department && (
                        <span className="ml-1.5 text-fine text-ink-tertiary">{opt.department}</span>
                      )}
                    </span>
                  );
                })()}
```

- [ ] **Step 2: MockUser 타입 + 어댑터 6곳 + deptKoreanKeywords 전달** — 위 Files 목록대로. 각 어댑터는 기존 필드 유지 + `korean_name` 한 줄 추가(surgical). dept를 안 쓰는 화면(승인자 등 user 전용)은 keywords prop 불필요.

- [ ] **Step 3: 검증** — `npm run lint` 0 · `npm test` PASS · `npm run build` 성공.

- [ ] **Step 4: PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/src/lib/mock/permissions-types.ts frontend/src/components/permissions/principal-picker.tsx <어댑터 6파일> PROGRESS.md
git commit -m "feat(picker): korean name/group search + localized rows in principal picker — 협업자 피커 한글 검색·표시"
```

---

### Task 4: FE — SearchSelect 옵션 빌더 교체(3화면) + 점유권 이전 통일

**Files:**
- Modify: `frontend/src/components/node-summary-modal.tsx`(담당자 ~469-479·부서 ~428), `frontend/src/components/bpm-attribute-picker.tsx`(담당자 ~129-140·부서 ~79), `frontend/src/components/group-bulk-modal.tsx`(담당자 ~807/164-166·부서 ~779) — 옵션 구성 인라인 코드를 Task 2 빌더 호출로 교체(`useI18n`의 `lang` 필요 시 구조분해 추가). **value 배선·onChange·기존 filter 로직(예: users.filter(...))은 유지.**
- Modify: `frontend/src/components/version/transfer-checkout-dialog.tsx` — 자체 substring 필터(line 34-41)를 `filterByQuery`로 교체:

```ts
import { filterByQuery } from "@/lib/search";
import { formatRosterName } from "@/lib/korean-dept";
...
  const { lang } = useI18n(); // 기존 { t }에 병합
  const filtered = query.trim()
    ? filterByQuery(editors, query, (e) => [
        { field: "name", text: e.name },
        ...(e.korean_name ? [{ field: "koreanName", text: e.korean_name }] : []),
        { field: "id", text: e.id },
      ]).map((h) => h.item)
    : editors;
```

행 표시의 `{editor.name}` → `{formatRosterName({ name: editor.name, korean_name: editor.korean_name ?? "" }, lang)}`.

**Interfaces:**
- Consumes: Task 1 필드(eligible-assignees·editors), Task 2 빌더.

- [ ] **Step 1: 3화면 옵션 구성 교체** (각 화면의 담당자/부서 options를 `buildAssigneeOptions(users…, lang)`/`buildDepartmentOptions(departments, users)`로 — 화면별 기존 사전 filter는 빌더 호출 전에 그대로 적용)
- [ ] **Step 2: transfer-checkout-dialog 교체** (위 코드)
- [ ] **Step 3: 검증** — lint 0 · vitest PASS · build 성공
- [ ] **Step 4: PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/src/components/node-summary-modal.tsx frontend/src/components/bpm-attribute-picker.tsx frontend/src/components/group-bulk-modal.tsx frontend/src/components/version/transfer-checkout-dialog.tsx PROGRESS.md
git commit -m "feat(picker): korean search in assignee/department selects + transfer dialog — 담당자·부서·점유권 피커 한글 검색"
```

---

### Task 5: 브라우저 스모크 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-picker-korean.mjs`

- [ ] **Step 1: 서버 기동** — 메인 dev.db 사본(맵·권한 데이터 필요), 포트는 기존 스모크 관례(백엔드 8001, 프론트 3000 — 점유 시 3002 등 폴백, 다른 세션 프로세스는 절대 kill 금지):

```bash
cp /Users/hyeonjin/Documents/bpm/backend/dev.db /Users/hyeonjin/Documents/bpm/.claude/worktrees/ui-improvement-3/backend/dev.db
# backend: nohup .venv/bin/uvicorn app.main:app --port 8001 (scratchpad 로그로)
# frontend: BACKEND_URL=http://localhost:8001 nohup npm run dev (3000 점유 확인 후)
sqlite3 backend/dev.db "UPDATE employees SET korean_name='', korean_dept='';"
```

- [ ] **Step 2: 스모크 작성·실행** — 기존 스모크 관례(playwright-core+시스템 Chrome, `bpm.devUser=admin.sys`, `bpm.lang` en 시작, check/exit 규율, 상시 참 체크 금지). 시나리오:
  1. 준비: 임포트 API로 유저 1명에 `{name:"장현진", dept:"AI Operations그룹"}` 부여(대상: admin.sys 소유 맵의 협업자 후보 아무나 — 맵 설정 화면 진입 가능해야 하므로 admin.sys 소유 맵을 `POST /api/maps`로 생성(member-card 스모크 패턴 재사용, 종료 시 DELETE 정리).
  2. 맵 설정(`/maps/{id}/settings`) 협업자 탭 피커: "장현진" 검색 → 해당 유저 행 노출·(en 모드) `영문 (장현진)` 표기. 초성 "ㅈㅎㅈ" 검색 → 동일 유저 매치.
  3. "AI Operations그룹" 일부(예: "AI Operations그") 검색 → **부서 항목**이 상위 매치(top-pin)·유저 무더기가 앞을 덮지 않음(첫 행 principal 타입 확인 — 행의 유형 라벨 텍스트로 판정).
  4. `bpm.lang=ko` 재로드: 같은 유저 검색 시 행 primary가 "장현진".
  5. 점유권 이전은 UI 전제(체크아웃 상태)가 무거우므로 스모크 제외 — filterByQuery 전환은 vitest+수동 확인 대상(리포트에 명시).
  6. cleanup(테스트맵 DELETE) + 콘솔 에러 0 + N/N passed.
- [ ] **Step 3: 기존 스모크 회귀** — DB 한글 필드 리셋 후 `pw-smoke-member-card.mjs`(11/11), `pw-smoke-korean-names.mjs`(17/17), `pw-smoke-korean-dept.mjs`(5/5).
- [ ] **Step 4: 최종 게이트** — backend pytest·ruff / frontend lint·vitest·build 전부.
- [ ] **Step 5: DB 리셋 + PROGRESS.md 한 줄 후 커밋**

```bash
git add frontend/scripts/pw-smoke-picker-korean.mjs PROGRESS.md
git commit -m "test(picker): korean search smoke — 피커 한글 검색 스모크"
```

---

## 완료 후

- finishing-a-development-branch — 직전 패턴: 커밋·푸시 후 사용자 머지 결정.
- 백로그: NodeSearch 랭킹 개선, DangerZone select 피커화, 부서 표시용 한글명(매핑 룰 확정 후).
