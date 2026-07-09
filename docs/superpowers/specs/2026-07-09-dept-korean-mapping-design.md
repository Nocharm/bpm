# 부서 한글명 매핑 관리 + 유저 추출 옵션 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement · 선행: `2026-07-09-user-korean-name-import-design.md`

## 배경/목적

임포트 시점에 따라 같은 영어 부서의 구성원들이 서로 다른 `korean_dept` 값을 갖게 될 수 있다(영어 부서 ↔ 한글 부서 1:N). 관리자가 설정 화면 **부서 탭**에서 이를 발견하고 하나의 값으로 정규화한다. 추가로 한글이름 모달의 **유저 목록 JSON 추출에 대상 옵션**을 만든다.

**접근 A(확정)**: 매핑의 실체는 해당 부서 전원의 `employees.korean_dept` 일괄 갱신. 별도 매핑 테이블 없음(스키마 무변경). 새 임포트로 재발하면 필터에 다시 노출 → 재정규화. (매핑 테이블 + 임포트 자동 정규화는 백로그)

## 1. 백엔드

### 1a. `AdminUserOut` 확장 (`schemas.py`)

`korean_name: str`, `korean_dept: str` 추가 — 부서 페이지가 이미 쓰는 `GET /api/admin/users` 응답에 포함(추가 fetch 없음). `routers/admin.py`의 `AdminUserOut(...)` 생성에 두 필드 전달.

### 1b. PUT `/api/admin/departments/korean-dept` (sysadmin 전용)

```json
// request
{ "org_levels": ["SAMSUNGBIOLOGICS", "DeptB", "TeamA"], "korean_dept": "AI Operations그룹" }
// response
{ "updated": 12 }
```

- 직원의 non-null `org_l1..l5` 시퀀스가 `org_levels`와 **정확히 일치**하는 전원의 `korean_dept`를 trim된 값으로 덮어씀(빈 사람·다른 값 포함 — 전원 덮어쓰기 확정).
- 검증: `korean_dept` trim 후 비어있으면 422(매핑 해제 기능 아님), max_length 200(StringConstraints — PG VARCHAR 초과 방지), `org_levels` 최소 1개.
- 일치 직원 0명이면 `{updated: 0}` (에러 아님).

### 테스트 (backend/tests/test_korean_names.py에 추가)

- 정확 경로 일치 전원 갱신 + 형제/상위 경로 미간섭.
- 덮어쓰기(기존 다른 값·빈 값 모두 갱신).
- 빈 값 422, 201자 422, 비 sysadmin 403, 미존재 경로 updated 0.

## 2. 부서 페이지 (`department-table.tsx` + 신규 모달)

데이터: 기존 `getAdminUsers()` 그대로(확장된 korean 필드 포함). 집계는 클라이언트 순수 함수로 분리(§4).

1. **필터 체크박스** "Needs mapping only" (org 보기 토글 옆): 부서의 distinct 비어있지 않은 `korean_dept` 개수가 **≥2 또는 0**인 행만 표시(부서 목록은 구성원 경로에서 파생되므로 인원 0 부서는 없음).
2. **2번째 열 "korean dept"** (부서명 다음, org 보기 여부와 무관하게 항상): distinct 한글부서를 필로 **상하 나열**, 각 필에 값 + 사용 인원수(fine). 0개면 빈 셀.
3. **인원수 호버 툴팁** (org 보기 꺼짐일 때): 그 부서 구성원 명단, 각 인원 **필 형식·이름만**. 이름 표기는 **언어 토글 연동** — ko: `한글이름 (영문name)` / en: `영문name (한글이름)`, 괄호쪽 값이 없으면 있는 것만. 25행 청킹 무한스크롤(`useInfiniteSlice`), 충돌 툴팁과 동일한 호버 연속(패딩 래퍼) 처리.
4. **행 더블클릭 → 매핑 모달** (신규 `src/components/admin/dept-korean-modal.tsx`):
   - 후보 목록: 그 부서의 distinct `korean_dept` (값 + 인원수) — 클릭하면 아래 입력창에 채워짐.
   - **직접 입력창 상시 노출**(후보 유무 무관 — 후보 0개 부서도 여기서 입력). Apply는 입력값 trim 기준, 비어있으면 비활성.
   - Apply → PUT → `{updated: n}` 표시 후 닫기 + 목록 재조회. 모달 컨벤션·data-id·busy 가드·ModalBackdrop+createPortal 준수.

## 3. 추출 옵션 (`korean-name-modal.tsx`)

Download 버튼을 **스플릿 버튼**으로:

- 본 버튼: 디폴트 = ① 한글이름 없는 사람만(기존 동작·파일명 유지).
- 오른쪽 쉐브론(ChevronDown 16px) 버튼 → 드롭다운 메뉴 4항목, 클릭 즉시 다운로드:
  1. Missing names only (default) → `korean-names-missing.json`
  2. One random per department → `korean-names-sample-dept.json` — `EmployeeRow.department`(말단명) 기준 그룹핑, 그룹당 1명 무작위
  3. Random 50 users → `korean-names-sample-50.json` — 전체에서 비복원 무작위 min(50, n)명
  4. All users → `korean-names-all.json`
- 파일 내용은 모두 기존과 동일한 **login_id 배열 JSON**.
- 무작위는 `Math.random` 기반, 순수 함수는 rng 주입 가능하게(테스트용).

## 4. 순수 함수 lib (신규 `src/lib/korean-dept.ts`)

vitest 대상. DOM/fetch 없음.

- `aggregateDeptKoreanDepts(users, dept): { value, count }[]` — 그 부서(경로 일치) 구성원의 distinct 비어있지 않은 korean_dept, count 내림차순.
- `shouldFlagDeptMapping(candidates, memberCount): boolean` — candidates.length >= 2 || (memberCount > 0 && candidates.length === 0).
- `formatRosterName(user, lang): string` — 언어 토글 연동 표기 규칙(§2.3).
- `buildExportIds(rows, option, rng?): string[]` — 4옵션 샘플러(rng 주입, 기본 Math.random).

## 5. 검증

- backend pytest(§1 테스트), FE vitest(§4 전 함수), lint·build.
- 브라우저 스모크 신규 `pw-smoke-korean-dept.mjs`: 부서 탭 진입 → korean dept 열/필 확인 → 필터 체크 시 행 감소 → 인원수 호버 명단 툴팁 → 행 더블클릭 → 후보 선택/직접 입력 → Apply → 열에 단일 필 반영 + 필터에서 사라짐. 기존 `pw-smoke-korean-names.mjs`에 추출 쉐브론 메뉴(옵션 4개 노출 + "전체" 다운로드 1건) 체크 추가.

## Out of scope (백로그)

- 부서 매핑 테이블 + 임포트 시 자동 정규화(재발 방지).
- 매핑 해제(빈 값으로 되돌리기).
- 부서 페이지 org 보기 모드에서의 인원수/툴팁(열 자체가 없음 — 현행 유지).
