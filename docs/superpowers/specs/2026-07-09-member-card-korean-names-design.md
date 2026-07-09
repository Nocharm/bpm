# 멤버 카드 한/영 이름·아이콘 확대 + 부서 매핑 기능 철회 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement-2 · 선행: `2026-07-09-dept-korean-mapping-design.md`(이 스펙이 그 매핑 액션을 철회)

## 배경

한글이름/한글부서 데이터가 DB에 쌓이기 시작했다. 사용자 결정: **부서 매핑 개념(레벨 확정·전원 덮어쓰기 룰)은 일단 철회**하고 임포트로 DB에 쌓이는 값만 유지 — 데이터 분포를 본 뒤 매핑 룰(어미 레벨 귀속 등)을 다시 정한다. 이번 라운드는 멤버 카드(맵 상세>멤버)의 표시 개선에 집중한다.

## 1. 부서 매핑 기능 철회 (삭제)

**삭제 대상:**
- 프론트: `dept-korean-modal.tsx` 파일, 부서 탭의 더블클릭 핸들러·`mappingDept` state·모달 마운트, "Needs mapping only" 필터(체크박스·filtered 분기·resetKey 분기), `api.ts`의 `setDeptKoreanDept`, `korean-dept.ts`의 `shouldFlagDeptMapping`(+테스트), 관련 i18n 키(`admin.deptNeedsFilter`, `admin.deptKrTitle/Hint/InputPlaceholder/Apply/NoCandidates/Updated` — en/ko 쌍).
- 백엔드: `PUT /api/admin/departments/korean-dept` 엔드포인트, `DeptKoreanDeptIn/Out` 스키마, `test_dept_korean_mapping.py`의 매핑 엔드포인트 테스트(§주의: `test_admin_users_include_korean_fields`는 유지 — AdminUserOut korean 필드는 관찰용 열이 사용).
- 스모크: `pw-smoke-korean-dept.mjs`에서 매핑 시나리오(더블클릭~단일 필~필터 소실) 제거.

**유지 대상(관찰용):**
- 부서 탭 `korean dept` 필 열(distinct 값+인원수 집계 = `aggregateDeptKoreanDepts`), 인원수 호버 명단 툴팁, `AdminUserOut.korean_name/korean_dept`, Employees 탭 열, 임포트(배열/맵)와 `korean_dept` 저장 규칙(빈 dept 보존 포함).

**툴팁 수정**: 명단 툴팁(`RosterHover`)의 필 나열을 현행 wrap(`flex-wrap`)에서 **1열 세로 나열**(`flex-col`, 필 한 줄에 하나)로 변경.

## 2. 멤버 카드 아이콘 확대 (`frontend/src/components/maps/map-detail-card.tsx`)

- 현행: 아이콘 열 `w-6`, 아이콘 12px(첫 행 높이 기준, `mt-0.5` 상단 정렬).
- 변경: 아이콘 열 `w-9`, 아이콘을 **접힌 카드 2줄 높이 기준으로 확대**(User/UsersRound/부서 LEVEL_ICONS: 12→22px, strokeWidth 1.5 유지), 컨테이너를 `self-center`(세로 중앙)로 — 시각적으로 현재 위치에서 왼쪽 아래 방향 확장.
- Me 뱃지: `Hand` 13→20px + "ME" 텍스트 7→9px, 세로 스택(`flex-col items-center`)으로 확대. `data-id="member-me-badge"` 유지.
- 펼친 상태에서도 아이콘은 상단 2줄 영역 기준 유지(`self-start` + 고정 높이 정렬 — 펼침 시 카드가 길어져도 아이콘이 중앙으로 내려가지 않게).

## 3. 유저 카드 이름 한/영 토글 + 반대 언어 필

- **백엔드**: `DirectoryUserOut`에 `korean_name: str = ""` 추가(`/api/directory` — 카드가 이미 쓰는 API). `routers/directory.py`에서 `emp.korean_name` 전달. (korean_dept는 이번에 미노출 — 부서 카드 한글 표시는 매핑 룰 확정 후)
- **프론트**: `DirectoryUser.korean_name` 추가. 카드 이름줄 — ko 토글: `korean_name`(없으면 `name`), en 토글: `name`.
- **펼쳤을 때**: 아이디(`principal_id`) 줄 **위에** 반대 언어 이름 필 추가 — ko 화면: 영문 이름 필, en 화면: 한글 이름 필. 해당 값이 없으면 필 생략. 기존 필 스타일(직급/부서 레벨 필)과 동일 토큰.
- 이름 정렬·검색 등 파생 동작은 표시 이름 기준 유지(기존 정렬이 이름 문자열 기준이면 토글에 따라 정렬 기준도 자연 변경 — 허용).

## 4. 사용자 그룹 카드 이름 해석 (기존 누락 수정)

- group principal 카드가 `principal_id`(그룹 id 숫자)를 그대로 노출 중 → `listGroups()` 결과로 id→이름 해석해 그룹 **이름**을 이름줄에 표시(이미 로드하는 데이터 — 추가 fetch 없음). 이름 해석 실패 시 id 폴백. 그룹명은 한/영 구분 없어 토글 무관.

## 5. 검증

- 백엔드: directory korean_name 노출 pytest 1건, 매핑 엔드포인트 삭제 후 전체 회귀(삭제 테스트 정리 포함).
- 프론트: lint·vitest(korean-dept lib에서 삭제 함수 테스트 제거·유지 함수 회귀)·build.
- 스모크: `pw-smoke-korean-dept.mjs` 축소판(열 필·1열 툴팁 체크), 멤버 카드는 신규 스모크 1개 — 홈 상세 패널에서 유저 카드 이름 토글(ko/en)·펼침 시 반대 언어 필·그룹 카드 이름 표시·Me 뱃지 존재 확인.

## Out of scope

- 부서 카드 한글명 표시, 어미(센터·담당·팀·그룹·파트) 레벨 귀속 매핑 — 데이터 확인 후 별도 설계.
- 협업자 설정 패널(`collaborators-panel.tsx`)·피커의 한/영 토글 — 멤버 카드 한정.
