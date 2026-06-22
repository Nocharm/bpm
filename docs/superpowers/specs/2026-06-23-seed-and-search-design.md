# 시드 정합성 + 검색/승인자 UX — 설계 (2026-06-23)

브랜치: `feat/seed-and-search` (base `main` @ 7b72ebc — compare-merged-view + map-card-detail-redesign 병합 포함).

## 목표

1. **시드 워크플로 정합성(Task 0)** — 정상 워크플로에서 불가능한 시드 상태 제거(승인자/소유자/제출자 누락).
2. **재사용 검색 모듈(Task 2)** — 초성 + 로마자 초성 + 소속 검색, 콤마 AND 멀티필터, 하이라이트. principal-picker·홈 검색에서 공용.
3. **승인자 필(pill) UI(Task 1)** — settings 승인자 등록을 `<select>`+텍스트 리스트 → 검색 typeahead + 칩(pill). 생성 다이얼로그도 동일.
4. **홈 맵 검색(Task 3)** — 메인 화면 맵 검색창 + 하이라이트.

## 결정(확정)
- 이니셜 = **로마자 초성**(한글이름 영문이니셜, 예 `gj`→결재). ㅇ은 묵음 → 빈자(건너뜀, 한계 주석).
- 콤마 = **AND**(콤마로 나눈 모든 항이 매칭). 항 내 필드/모드는 OR.
- 승인자 필: settings 패널 + 생성 다이얼로그 **둘 다**.
- 시드: 모든 맵 owner+승인자≥1, 비-draft 버전 submitted_by+승인자+(approved/published)승인이력. **노드 assignee는 범위 밖**.

비범위(YAGNI): 부서별 가중치/스코어링, 에디터 노드검색 교체(추후 재사용 가능하나 이번 미적용), 다국어 로마자 규칙 완전판.

---

## Task 0 — 시드 워크플로 정합성

### 메커니즘: 시드 후 멱등 정규화 패스 (공용 헬퍼)
개별 시드 스크립트를 각각 고치는 대신, 모든 시드 실행 후 한 번 도는 정규화 함수로 통일(DRY). `seed_reference_demo`·`seed_compare_demo`·`seed_nesting_demo`가 남기는 누락을 일괄 보완.

`backend/scripts/seed_invariants.py` (신규):
```python
async def normalize_workflow_invariants(session: AsyncSession) -> dict[str, int]:
    """시드 후 워크플로 불변식 보정 (멱등). 반환: 보정 건수 집계."""
```
규칙(멱등):
1. **모든 맵**: `owner_id` None → `created_by` 또는 데모유저로 설정; `created_by` None → `owner_id`로. **MapApprover 0개** → 데모 유저 1명 이상 추가(제출자와 다른 사람 우선, LOCAL_USERS에서 결정적 선택).
2. **비-draft 버전**(`pending`/`approved`/`published`): `submitted_by` None → 맵 owner(또는 데모유저)로 설정.
3. **approved/published 버전**: 현재 맵의 모든 MapApprover에 대해 `VersionApproval` 행이 없으면 생성(만장일치 게이트 충족). published는 `submitted_by`가 곧 게시자.

- `reset_db.py` main: 모든 시드(현 4단계) + 기존 version-events 백필 **다음**에 `normalize_workflow_invariants` 호출, 집계 출력.
- 데모 유저: `app.ad.service.LOCAL_USERS` 사용(영문 시드 단일 소스).

### 검증 (pytest, `backend/tests/test_seed_invariants.py`)
정규화 함수를 직접 호출하는 단위/통합 테스트(asyncio.run + SessionLocal 패턴):
- 누락 픽스처(owner 없음·승인자 없음·published인데 submitted_by 없음·승인이력 없음)를 직접 시드 → 정규화 1회 → **불변식 충족** 단언 → 2회 → **0건 추가(멱등)**.
- 불변식 단언: 모든 맵 `owner_id≠None ∧ 승인자≥1`; 비-draft 버전 `submitted_by≠None`; approved/published 버전 `승인행수 == 승인자수`.

---

## Task 2 — 재사용 검색 모듈

### `frontend/src/lib/search.ts` (신규, `hangul.ts` 기반·신규 deps 없음)

기존 `hangul.ts`(`extractChosung`/`isChosungQuery`/`matchesQuery`)는 유지(에디터·picker가 사용 중). 신규 `search.ts`가 상위 기능 제공:

**로마자 초성 매핑(고정)**: ㄱg ㄲkk ㄴn ㄷd ㄸtt ㄹr ㅁm ㅂb ㅃpp ㅅs ㅆss ㅇ"" ㅈj ㅉjj ㅊch ㅋk ㅌt ㅍp ㅎh. (ㅇ 묵음=빈자 → ㅇ-초성 음절은 로마자초성에 기여 안 함, 주석.)

**코어 — 원문 인덱스 기반 매치(하이라이트용)**:
```ts
export interface MatchRange { start: number; end: number } // 원문 char 인덱스 [start,end)
// 한 term이 text에 매치하면 원문 기준 range 배열, 아니면 null
export function matchTerm(text: string, term: string): MatchRange[] | null
```
- **모드1 부분일치**(대소문자 무시): 직접 인덱스 range.
- **모드2 한글초성**(term이 전부 초성): text의 초성열을 만들되 `초성위치→원문음절인덱스` 매핑 유지 → term을 초성열에서 찾고 음절 range로 환산.
- **모드3 로마자초성**(term이 전부 라틴): text의 로마자초성열 + `로마자char위치→원문음절인덱스` 매핑 → term(소문자) 찾아 덮는 음절 range로 환산.
- 셋 중 먼저 매치하는 것의 range 반환(우선순위 부분일치→초성→로마자).

**필터(콤마 AND, 필드 OR)**:
```ts
export interface FieldMatch { field: string; ranges: MatchRange[] }
export interface SearchHit<T> { item: T; matches: FieldMatch[] }
// query를 콤마로 분할(공백 trim, 빈 항 제거) → 각 term이 어떤 필드에든 매치해야(AND)
export function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => { field: string; text: string }[],
): SearchHit<T>[]
```
- query 비면 전체 통과(matches=[]).
- 각 term에 대해 모든 필드에서 `matchTerm` 시도, 하나라도 매치하면 그 term 충족. **모든 term 충족** 시 hit. `matches`는 하이라이트용으로 (필드별, term별 range) 누적(중복 range 병합).

**하이라이트 컴포넌트** `frontend/src/components/highlight.tsx` (신규):
```tsx
export function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }): JSX.Element
```
- ranges를 정렬·병합 후 매치 구간만 `<mark>`(토큰 스타일: `bg-accent-tint text-accent rounded-[2px]`)로, 나머지는 평문. `data-id` 불필요(인라인).

### 단위 테스트
vitest(`npm test`=`vitest run`, main에 존재 — 기존 `lib/merge-diff.test.ts`)로 `lib/search.test.ts` 작성: 부분/초성/로마자 매치 range, 콤마 AND, ㅇ 처리, 빈 쿼리, 필드 OR. TDD(RED→GREEN) 권장 — `search.ts`가 순수함수라 적합.

---

## Task 1 — 승인자 등록 필(pill) UI

### settings 승인자 패널 (`frontend/src/components/permissions/approvers-panel.tsx`)
- 현 `<select>` 드롭다운 + 텍스트행 리스트 → **검색 typeahead(개선된 picker, Task 2 검색) + 선택 승인자 칩(pill, X 제거)**.
- 칩 스타일: 협업자/principal과 시각 일관(토큰 `bg-surface-alt border-hairline rounded-sm`, X 아이콘 Lucide). `data-id="approver-pill-{id}"`, 입력 `data-id="approver-search"`.

### 생성 다이얼로그 (`frontend/src/components/permissions/create-map-dialog.tsx`)
- 승인자 섹션도 동일 필 패턴(현재 PrincipalPicker + 리스트 → 칩 표시 통일). description 필드(map-card에서 추가됨)와 공존.

### principal-picker 검색 강화 (`frontend/src/components/permissions/principal-picker.tsx`)
- 필터를 `matchesQuery` → Task 2 `filterByQuery`로 교체(초성+로마자초성+콤마AND). 결과 라벨에 `<Highlight>` 적용.
- **소속 검색**: picker 옵션에 `department` 추가. 현재 create-map-dialog가 디렉터리 user를 picker용으로 변환할 때 `departmentId:""`로 비움 → 실제 부서명을 옵션의 검색 필드로 전달(디렉터리의 dept 매핑). `getFields`가 `[{field:"name",text:displayName},{field:"dept",text:departmentName}]` 반환.
- principal-picker는 collaborators-panel·create-map-dialog·approvers-panel 공용이므로, 옵션 타입에 `department?: string` 추가(선택).

---

## Task 3 — 홈 맵 검색

### `frontend/src/app/page.tsx`
- 헤더(타이틀 줄 또는 그 아래)에 검색 입력 추가(`data-id="home-map-search"`). map-card 작업으로 들어온 아코디언/리스트 레이아웃 위.
- `filterByQuery(visibleMaps, query, m => [{field:"name",text:m.name},{field:"description",text:m.description}])` → hit만 렌더.
- 카드 이름에 하이라이트: `MapCard`가 선택적 `nameRanges?: MatchRange[]`를 받아 `<Highlight>`로 이름 렌더(없으면 평문). page가 hit.matches에서 name 필드 range를 전달.
- i18n: `home.searchPlaceholder`(en/ko) 등 신규 키.

---

## 영향 파일 요약
**Backend**: `scripts/seed_invariants.py`(신규) · `scripts/reset_db.py`(호출) · `tests/test_seed_invariants.py`(신규).
**Frontend**: `lib/search.ts`(신규) · `components/highlight.tsx`(신규) · `components/permissions/principal-picker.tsx` · `approvers-panel.tsx` · `create-map-dialog.tsx` · `app/page.tsx` · `components/maps/map-card.tsx`(nameRanges) · `lib/i18n-messages.ts` · (vitest) `lib/search.test.ts`.

## 검증
- 백엔드: `pytest`(불변식 테스트 + 회귀 296 유지) · `ruff`.
- 프론트: `npm test`(vitest, search 순수함수) · `tsc --noEmit` · `lint` · `build`.
- 수동(네이티브 권장): 초성/로마자/소속/콤마 검색·하이라이트, 승인자 필 추가·제거, 홈 검색.

## 리스크/가정
- 로마자초성 ㅇ 묵음 한계(ㅇ-초성 음절 비기여) — v1 수용, 주석.
- 디렉터리에 부서명이 없으면 소속 검색은 해당 user에 무효(빈 필드) — 안전(매치 안 됨).
- 정규화 패스가 데모 유저를 승인자로 추가 → 시드 데이터 한정(운영 무관).
- principal-picker 옵션 타입 확장은 3개 사용처 모두 영향 — 선택 필드라 하위호환.
