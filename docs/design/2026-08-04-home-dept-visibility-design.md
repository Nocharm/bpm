# 홈 부서 가시성·시인성 개선 (2026-08-04)

메인 페이지(`/`) 브라우즈 모드 좌측 컬럼의 조직도 표현을 재구성한다. 목표는 두 가지 — **맵 카드 폭을 부서 깊이와 무관하게 통일**하고, **첫 진입 시 시선이 한 곳에 모이게** 한다.

## 1. 문제 (실측)

### 1-1. 들여쓰기가 카드 폭을 잠식

좌측 컬럼은 `flex-1`, 우측 상세는 `flex-[2]` — `max-w-[80rem]`(1280px) 컨테이너에서 좌측 가용폭은 **약 421px**(`(1280 − 16) / 3`), 스크롤 컨테이너 `pr-1`을 빼면 417px.

`org-accordion.tsx`가 맵 카드 목록에 `paddingLeft: depth * 12 + 16`px를 건다. 시드 조직도는 4단계(`Growth Center / Strategy Office / Planning Team / Planning Part 1`)이므로:

| depth | 카드 폭 | 카드 내부 콘텐츠 폭(`p-4`) |
|---|---|---|
| 0 | 401px | 369px |
| 3 | 365px | 333px |

카드 첫 줄에 제목·상태 배지·SP 배지·역할 배지·공개 아이콘이 모두 들어가야 한다. 333px에서는 제목이 먼저 말줄임된다. 게다가 **같은 목록 안에서 카드 폭이 제각각**이라 리스트로 읽히지 않는다.

### 1-2. 같은 카드가 두 번 렌더

`filterMyDeptMaps(maps, me.org_path)`가 뽑는 맵(내 부서 + 하위 부서)은 `buildOrgTree`가 조직도 트리에도 그대로 넣는다. 그런데

- `favOpen` 기본값 `true` (`page.tsx:82`)
- 조직도 시드가 내 `org_path`의 **조상 체인을 전부 펼침** (`page.tsx:139-145`)

→ 첫 진입 시 My dept 섹션과 조직도가 동시에 열린 채 **동일한 카드를 위아래로 중복 렌더**한다. 시선 분산의 원인은 "둘 다 열려서"가 아니라 **"둘이 같은 내용이라서"**다.

## 2. A — 조직도 아코디언 재구성 (`components/maps/org-accordion.tsx`)

```
┌─ Departments ────────────────────── Collapse all ─┐
│ ▾ ( Growth Cen… )                            (23) │  네비 행 · 들여쓰기 유지
│   ▾ ( Strategy O… )                          (12) │  필 고정폭 96px → 세로 정렬
│   ▸ ( Marketing … )                           (8) │
│ ╞═══════════════════════════════════════════════╡ │
│ │ ▾ Growth… / Strategy… / ( Analytics Team ) (5)│ │  ◀ sticky top-0
│ ╞═══════════════════════════════════════════════╡ │
│ ┌───────────────────────────────────────────────┐ │
│ │ Order Fulfillment      [published]  Kim   🌐  │ │  417px
│ └───────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────┐ │
│ │ Budget Approval        [draft]      Lee   🔒  │ │  417px
│ └───────────────────────────────────────────────┘ │
│     ▸ ( Insights T… )                         (3) │
│ ▸ ( Operations … )                           (14) │
└───────────────────────────────────────────────────┘
```

### A1. 부서명 = 고정폭 필, 단일 자식 구간은 한 행에 병합

부서 헤더의 텍스트 라벨을 **고정폭 필**로 바꾼다. 폭이 일정하므로 같은 depth의 필이 세로로 정렬되어, 들여쓰기 없이도 계층이 눈에 잡힌다.

- 필: `inline-flex w-24 shrink-0 items-center justify-center truncate rounded-full border border-hairline bg-surface px-2 py-0.5 text-fine`
- 열린 필: `border-accent-tint-border bg-accent-tint text-accent`
- `w-24`(96px) 고정 + `truncate`이므로 **`title` 속성에 전체 부서명 필수**

**체인 병합 규칙** — 노드 `n`에서 시작해 `n.children.length === 1 && n.maps.length === 0`인 동안 유일 자식으로 내려가며 필을 쌓고, 그 결과를 한 행에 `( A )›( B )`로 렌더한다. 분기(자식 2개 이상)나 자기 맵을 가진 노드에서 멈춘다.

> **`maps.length === 0` 조건이 핵심.** 중간 노드가 자기 맵을 가지면 그 맵을 어느 행 아래에 그릴지 모호해진다. 병합은 "통과만 하는" 노드에만 허용한다.

**토글 대상은 체인의 첫 노드 path**로 둔다. `page.tsx:723-733`의 기존 핸들러가 이미 `collectSingleChildChain`으로 나머지 path를 자동 추가하므로 `page.tsx`는 손대지 않아도 된다. 다만 `collectSingleChildChain`은 현재 `children.length === 1`만 보고 `maps`를 보지 않아 병합 조건과 어긋나므로, **`lib/org-tree.ts`의 `collectSingleChildChain`에도 `maps.length === 0` 조건을 추가**하고 `org-tree.test.ts`에 케이스를 넣는다.

### A2. 맵 카드는 풀폭

`org-accordion.tsx:55`의 `style={{ paddingLeft: depth * 12 + 16 }}`를 제거한다. 전 depth에서 카드 폭 **417px 통일**. 미지정(unassigned) 섹션의 `pl-1`도 함께 제거해 동일 폭으로 맞춘다.

### A3. sticky 경로 헤더 — "맵을 가진 부서"만

열려 있고 **자기 맵을 가진** 노드의 헤더 행만 `sticky top-0 z-10 bg-surface border-b border-hairline`. 순수 네비 행(맵 없이 자식만 있는 노드)은 sticky가 아니다.

- 스크롤 컨테이너는 `page.tsx:697`의 `overflow-y-auto` div — 이것이 sticky 기준 박스가 된다.
- 맵 보유 노드는 트리 경로상 서로 조상-자손일 수 있으나, sticky 대상이 **모두 같은 `top-0`**이므로 나중에 도달한 헤더가 먼저 붙어 있던 헤더를 덮는다 → **화면에 보이는 sticky는 항상 1개**. 4단계를 계단식으로 쌓아 높이를 잠식하는 문제가 원천 차단된다.
- sticky 헤더는 **단독으로 완전한 컨텍스트**를 줘야 하므로 조상 경로를 함께 표시한다. 폭을 아끼기 위해 조상은 필이 아닌 흐린 breadcrumb 텍스트(`text-fine text-ink-tertiary`, 각 세그먼트 `max-w-[4.5rem] truncate`)로 `Growth… / Strategy… /` 형태, 소유 부서만 필.
- **sticky(맵 보유) 헤더는 들여쓰기하지 않는다**(`paddingLeft` 0). breadcrumb이 경로를 전부 담으므로 들여쓰기는 중복이고, 깊을수록 폭만 잃는다. 들여쓰기는 순수 네비 행에만 남긴다 — 즉 좌변 정렬은 `카드 = sticky 헤더 < 네비 행` 이 된다.

### A4. 자기 맵을 자식보다 먼저 렌더

현재 `renderNode`는 `children → maps` 순이라, 자기 맵을 가진 부모의 헤더와 그 맵 사이에 **손자들의 카드가 통째로 끼어든다**. sticky 헤더가 자기 것이 아닌 카드를 덮게 되므로 `maps → children`으로 뒤집는다.

## 3. B — 맵 카드 최근접속 표시 반전 (`components/maps/map-card.tsx:203-220`)

```
현행                                    변경
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│ Order Fulfillment  [published]  │    │ Order Fulfillment  [published]  │
│ (🕐 Recent · 5분 전)   ⚙3 ⑂2 👤4│    │ 👤Kim  (🕐 2h)      ⚙3 ⑂2 👤4 │  ← 기본
└─────────────────────────────────┘    └─────────────────────────────────┘
        ↓ hover                                 ↑ 시계 칩만 accent+tint
┌─────────────────────────────────┐            ↓ hover
│ 👤Kim  🕐 2h        ⚙3 ⑂2 👤4 │    ┌─────────────────────────────────┐
└─────────────────────────────────┘    │ (🕐 Recent · 5분 전)  ⚙3 ⑂2 👤4│
                                       └─────────────────────────────────┘
```

최근 접속한 맵의 표시를 **항상 떠 있는 배지 → 호버 시에만**으로 뒤집는다.

- **기본 상태**: 오너 + 수정시각(`ownerAndTime`)을 보여주고, 그중 **시계 칩**(clock 아이콘 + `relativeTime(updated_at)`)에 `rounded-full bg-accent-tint px-2 py-0.5 text-accent`를 적용한다. 최근 접속했다는 사실은 이 칩 하나로만 표시된다.
- **호버 상태**: `Recent · N ago` 필로 교체.
- `recentOpenedAt`이 없는 카드는 현행 그대로(칩 없는 평범한 `ownerAndTime`).

두 레이어를 같은 그리드 셀에 겹쳐 넓은 쪽 폭으로 고정하는 현행 구조(`grid` + `col-start-1 row-start-1` + `w-fit`)는 그대로 두고 `opacity`/`bg`만 뒤집는다. 따라서 **호버 시 레이아웃 점프 없음**.

## 4. C — 중복 제거 + 접힘 상태 영속화 (`app/page.tsx`)

### C1. My dept 섹션이 있으면 조직도는 접힌 채 시작

`page.tsx:139-145`의 시드 이펙트를 조건부로 만든다 — **내 부서 맵이 하나라도 있으면 조상 체인 시드를 건너뛴다**. 첫 화면은 "내 부서 카드 + 접힌 조직도"가 되어 진입점 포커스가 하나로 모인다.

내 부서 맵이 없는 사용자(신규·미배치)는 현행대로 조상 체인을 시드해 빈 조직도만 보는 상황을 막는다.

`MyDeptFavorites`는 유지한다 — 하위 부서 맵까지 모아 보는 기능은 조직도 병합으로는 대체되지 않는다.

### C2. 접힘 상태는 새로고침에도 유지

현재 접힘 상태(`orgOpen` / `favOpen` / `wordOpen` / `unassignedOpen`)는 검색·필터와 함께 `sessionStorage`의 `bpm.home.filters`에 저장되지만, **`navigation.type === "reload"`면 통째로 폐기**된다(`page.tsx:157-162`). 즉 새로고침마다 트리가 초기화된다.

접힘 상태를 검색·필터와 **분리**한다:

| 상태 | 저장소 | 새로고침 |
|---|---|---|
| 검색어·가시성·상태·권한·오우닝 필터 | `sessionStorage` `bpm.home.filters` | 초기화 (현행 유지) |
| `orgOpen` / `favOpen` / `wordOpen` / `unassignedOpen` | `localStorage` `bpm.home.tree` | **유지** |

복원 우선순위는 **저장값 > C1 시드**. 저장값이 있으면 `seededOrg.current = true`로 막아 시드가 덮어쓰지 않게 한다(현행 `page.tsx:198`과 동일한 패턴).

## 5. 불변식 · 랜드마인

- **필 `w-24` 고정 + `truncate`** → `title` 속성 없으면 긴 부서명이 완전히 사라진다. 필·breadcrumb 세그먼트 모두 필수.
- **체인 병합 조건과 `collectSingleChildChain`은 한 쌍**이다. 한쪽만 `maps.length === 0`을 보면 자동펼침이 병합되지 않은 노드까지 열어 시각과 상태가 어긋난다.
- **sticky는 스크롤 컨테이너 안에서만 동작**한다. `page.tsx:697` div가 `overflow-y-auto`라 성립하지만, 조상에 `overflow-hidden`이 끼면 조용히 깨진다.
- **`react-hooks/set-state-in-effect`** — localStorage hydration은 마운트 1회 이펙트라 기존 `eslint-disable` 주석 패턴을 따른다.
- **StrictMode 이중 마운트** — 저장 이펙트는 첫 실행을 건너뛰는 `saveSkip` ref 패턴이 필수다(초기 default가 저장값을 덮어쓰는 사고 방지). `localStorage`용 별도 skip ref를 둔다.
- **카드 풀폭화는 인라인 상세 아코디언에도 적용**된다(`renderCard`가 카드+상세를 함께 반환). 980px 미만 화면에서 상세도 풀폭이 되는 것은 의도된 결과.

## 6. 검증

| 항목 | 방법 |
|---|---|
| `collectSingleChildChain`의 `maps` 조건 | `lib/org-tree.test.ts` 케이스 추가 → `npm run test` |
| 린트·타입·빌드 | `npm run lint` · `npx tsc --noEmit` · `npm run build` |
| depth별 카드 폭 동일 | 브라우저 — depth 0·3 카드 `getBoundingClientRect().width` 동일 확인 |
| sticky 헤더 | 브라우저 — 카드 구간 스크롤 중 헤더가 컨테이너 상단에 고정, 다음 부서 헤더가 밀어냄 |
| 첫 진입 포커스 | 브라우저 — 내 부서 맵 보유 계정으로 진입 시 조직도 접힘 |
| 접힘 상태 영속 | 브라우저 — 노드 펼침 → 새로고침 → 펼침 유지 |
| 카드 호버 반전 | 브라우저 — 기본은 오너+accent 시계 칩, 호버 시 `Recent · N ago`, 폭 점프 없음 |
