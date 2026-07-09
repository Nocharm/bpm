# 피커 한글이름·한글그룹 검색 + 스코어링 정비 — 설계

날짜: 2026-07-09 · 브랜치: worktree-ui-improvement-3 · 선행: `2026-07-09-member-card-korean-names-design.md`

## 목적

사용자/부서를 고르는 모든 피커에서 **한글이름·한글그룹으로 검색**되게 한다(기존 `search.ts` 랭킹 덕에 한글 초성 검색 자동 지원). 행 표시도 언어 토글 연동(멤버 카드와 일관). 점유권 이전 다이얼로그의 자체 substring 필터를 `filterByQuery`로 통일해 스코어링을 정비한다.

## 1. 백엔드 — korean 필드 전달 보강

| 대상 | 변경 |
|------|------|
| `DirectoryUserOut`(`/api/directory`) | `korean_dept: str = ""` 추가 + `directory.py`에서 전달 (korean_name은 기존) — 부서 한글 키워드 파생 소스 |
| `eligible-assignees`(`versions.py`) | 생성부에 `korean_name`·`korean_dept` 전달(스키마는 DirectoryUserOut이라 필드 기존재, 값만 미전달 상태) |
| `eligible-approvers`(`maps.py`) | 동일하게 `korean_name`·`korean_dept` 전달 |
| `GET /maps/{id}/editors`(점유권 이전 후보) | 응답 항목에 `korean_name` 추가 |

테스트: 각 엔드포인트 응답에 시드한 한글 값이 채워지는지 1건씩.

## 2. 검색 필드 규칙 (스코어링 검토 결론)

`search.ts` 자체는 무변경(랭크: 정확>접두>단어시작>중간>초성 접두>초성·로마자 중간>subsequence, 필드 순서 타이브레이크, AND 텀, worstKey). 호출자의 필드 구성만 확장:

- **유저 항목**: `[name(영문), korean_name, id]` 순서 — 이름류 2필드가 id보다 우선, 동랭크 시 영문 우선. **유저를 한글그룹(korean_dept)으로 매칭하지 않음** — 기존 "소속부서 검색 제외" 원칙 유지(부서명 검색 시 부서원 전원이 결과를 덮는 것 방지).
- **부서 항목**: `[name(말단 영문), koreanKeywords]` — koreanKeywords는 **그 부서(org 경로 정확 일치) 소속 유저들의 distinct `korean_dept`**를 파생(클라이언트, 공백 join 또는 다중 필드). 매핑 룰 미확정 상태와 무관한 관찰 데이터 기반.
- **사용자 그룹 항목**: 현행(이름만) — 한/영 구분 없음.
- PrincipalPicker의 "부서/그룹 최상위 매치 top-pin" 로직 유지.

## 3. 프론트 변경

### 3a. 공용 헬퍼 (`src/lib/` — vitest 대상)

- `deriveDeptKoreanKeywords(users: DirectoryUser[]): Map<orgPath, string[]>` — org_path 정확 일치 유저들의 distinct 비어있지 않은 `korean_dept`.
- `formatPickerName(name, koreanName, lang)` — 행 표시: ko = `한글 (영문)`(한글 없으면 영문), en = `영문 (한글)`(한글 없으면 영문) — 멤버 카드 규칙과 동일 포맷.
- 담당자 옵션 빌더 `buildAssigneeOptions(users, lang)` — 현재 3곳(node-summary-modal·bpm-attribute-picker·group-bulk-modal)에 중복된 옵션 구성을 공용화하면서 `keywords`에 `korean_name` 추가, label은 lang 연동(**value는 기존 영문 name 유지 — 저장값 불변**).
- 부서 옵션 빌더 `buildDepartmentOptions(departments, users)` — keywords에 해당 부서 유저들의 korean_dept 파생.

### 3b. PrincipalPicker (+호출 화면 어댑터)

- `MockUser`(피커 입력 타입)에 `korean_name?: string` 추가, 6개 호출 화면의 어댑팅에서 `korean_name` 보존(현재 버리고 있음).
- 검색 필드: user = name → korean_name → id / dept = name → koreanKeywords(파생) / group = name.
- 행 표시: displayName을 `formatPickerName`으로 lang 연동. 하이라이트는 매치 필드가 표시 텍스트와 일치할 때만 적용(불일치 시 하이라이트 없이 표시 — 단순화).

### 3c. SearchSelect 담당자/부서 (3화면)

- 옵션 구성을 3a 빌더로 교체(중복 제거). 담당자 label lang 연동·keywords에 korean_name, 부서 keywords에 korean_dept 파생. `value`(저장값)는 영문 유지 — 노드 assignee/department 데이터 불변.
- 전제: `eligible-assignees` 응답에 korean 필드(§1).

### 3d. TransferCheckoutDialog (점유권 이전)

- 자체 `includes()` 필터 → `filterByQuery`(name → korean_name → id)로 통일. 행 표시 lang 연동. 초성 검색 자동 지원.

## 4. 검증

- BE pytest: §1 4건. FE vitest: 3a 헬퍼(파생·포맷·빌더) + 필드 규칙 단위 테스트.
- 브라우저 스모크(신규 1개): 협업자 피커에서 ① 한글이름 검색 → 해당 유저 상위 노출·ko 표시, ② 초성(예: ㅎㄱㄷ) 검색 매치, ③ 한글그룹명 검색 → 부서 항목 매치(유저 미덮임 — top-pin), ④ en 토글 시 영문 표시. 기존 피커 스모크 회귀 없으면 게이트(lint·vitest·build·pytest)로 마감.

## Out of scope

- NodeSearch(노드 제목, hangul.ts)의 랭킹 개선 — 사람 피커 아님.
- DangerZone 오너 이전의 검색 피커화(현행 네이티브 select).
- 부서 한글명 확정 매핑(철회된 매핑 룰) — 여기선 검색 키워드 파생만, 표시용 부서 한글명은 도입하지 않음(부서 행 표시는 영문 유지).

## 후속 (2026-07-09 최종 리뷰 이관)

- 서버 배포 검증 체크리스트: 점유권 이전 다이얼로그에서 한글이름·초성 검색·행 표기(lang 연동) 1회 육안 확인(브라우저 스모크 미커버 표면).
- 부서 행이 한글 키워드로 매치될 때 가시 하이라이트 없음(의도적 단순화) — 매치 한글그룹명 title 툴팁 노출 검토(백로그).
- 스모크 시드(korean_name) finally 원복(재실행 하이진) / top-pin 유저 경합 케이스 보강(백로그).
