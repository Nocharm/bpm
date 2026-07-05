# 홈 맵 리스트 — 최근 열람 캐시 · 검색 우선순위 · 검색 유지 (Design)

작성: 2026-07-05 · 브랜치: `feat/editor-redesign-r11`

## 목표

홈(맵 리스트, `frontend/src/app/page.tsx`)에 최근 열어본 맵을 빠르게 다시 열 수 있는 편의 기능을 추가한다.

1. **최근 열람 밴드** — 최근 열어본 맵을 최신순으로 목록 최상단에 3개 노출, 밴드 하단 "Show more" 버튼으로 클릭당 +3개.
2. **기존 목록 유지** — 밴드 아래에 기존 순서 목록을 그대로 노출(최근 맵 중복 허용).
3. **검색 시 최근 우선** — 검색어 입력 시 기존 검색 랭킹을 유지하되, 최근 접속한 맵을 상단으로 끌어올리고 `Recently opened · N min ago` 배지 표시.
4. **검색·필터 유지** — 맵 에디터에서 뒤로가기 하거나 목록으로 돌아와도 검색어와 필터 상태가 유지.

백엔드/DB 스키마 변경 없음 — 전부 프론트엔드 클라이언트 캐시(localStorage/sessionStorage).

## 비목표 (YAGNI)

- 서버측 per-user 최근 열람 기록(백엔드 필드) — 브랜치 성격상 클라 캐시로 한정.
- 최근 열람 밴드 개수/증분 설정 UI — 상수 고정.
- 선택된 맵·스크롤 위치 복원 — "검색내용 유지" 범위 밖.

## 결정 사항 (사용자 확인 완료)

| 항목 | 결정 |
|------|------|
| 상단 최근 밴드 vs 하단 목록 중복 | **중복 허용** — 밴드는 강조용 추가 섹션, 하단은 전체 목록 그대로. 최근 맵은 위·아래 둘 다 노출. |
| 검색 유지 범위·방식 | **검색어 + 필터(가시성/상태/권한), `sessionStorage`** — 탭 세션 동안 유지, 탭 닫으면 초기화. |

## 문서화 가정 (사소·가역 → 진행)

- 최근 캐시 최대 12개(`MAX`), "더보기" 증분 3개(`RECENT_PAGE`), 초기 노출 3개.
- 브라우즈 모드 하단 목록의 중복 최근 맵에는 배지 미표시 — 배지는 상단 밴드와 검색모드 최근 매치에만.
- "더보기"로 늘린 노출 개수는 컴포넌트 state(검색내용 아님 → 미영속).
- 필터(가시성/상태/권한)는 상단 밴드·하단 목록 양쪽에 동일 적용. "검색 모드"(상단 고정 + 배지)는 **텍스트 검색어가 비어있지 않을 때만** 트리거.

## 아키텍처

### 신규 모듈: `frontend/src/lib/recent-maps.ts`

기존 localStorage 헬퍼(`lib/window-store.ts`, `lib/dev-auth.ts`) 컨벤션을 따른다 — SSR guard(`typeof window === "undefined"`), `bpm.*` 키 prefix, JSON 직렬화.

```ts
// 최근 열어본 맵 — localStorage(bpm.recentMaps). {id, at} 최신순, 최대 12개.
// 에디터 진입 시 기록, 홈 리스트에서 조회. 백엔드 변경 없음(클라 캐시).
export interface RecentMapEntry {
  id: number;
  at: number; // epoch ms — 마지막 열람 시각
}

const KEY = "bpm.recentMaps";
const MAX = 12;

export function getRecentMaps(): RecentMapEntry[];      // 최신순, 파싱 실패 시 []
export function recordRecentMap(id: number): void;      // 해당 id를 맨 앞으로, 중복 제거, MAX cap
```

- `recordRecentMap`: 기존 항목 제거 후 `{ id, at: Date.now() }`를 맨 앞에 push, `slice(0, MAX)`. `Date.now()`는 이벤트/effect 컨텍스트에서만 호출(렌더 순수성 위반 아님).
- `getRecentMaps`: SSR/파싱 실패 시 빈 배열.

### 기록 지점: `MapEditorPage` (page.tsx:7763)

```tsx
// 최근 열람 기록 — 6700줄 MapEditor 본체 대신 얇은 래퍼에서(모든 진입 경로 포괄).
useEffect(() => {
  if (Number.isFinite(mapId)) recordRecentMap(mapId);
}, [mapId]);
```

`MapEditorPage`는 `mapId`만 파싱하는 얇은 래퍼라 여기서 기록하면 상세 열기·직접 URL·버전 링크 등 모든 진입을 포괄하고 본체를 건드리지 않는다.

### 검색·필터 영속: `sessionStorage`

`frontend/src/app/page.tsx` 내부에서 처리(별도 모듈 불필요, 단일 사용처).

- 키: `bpm.home.filters`
- 형태: `{ q: string; vis: "all"|"public"|"private"; status: string[]; perm: string[] }` (Set → 배열 직렬화)
- **복원**: 마운트 후 1회 effect에서 읽어 state 세팅(`i18n.tsx`/`editor-left-sidebar.tsx`의 하이드레이션 안전 패턴 — 초기 render는 default, 마운트 후 복원). 복원 완료를 `restoredRef`로 표시.
- **저장**: `q`/`visFilter`/`statusFilter`/`permFilter` 변경 effect에서 write. 단 `restoredRef.current`가 true일 때만 → 초기 default가 저장값을 덮어쓰는 것을 방지.

## 홈 렌더링 로직 (`page.tsx`)

### 파생 상태

```
recentEntries: RecentMapEntry[]        // 마운트 후 getRecentMaps()로 로드(state)
now: number                            // 마운트 시 1회 고정(상대시각 기준, MapCard와 동일)
recentShown: number                    // 밴드 노출 개수 state, 기본 3, "더보기" +3
isSearching = mapQuery.trim() !== ""
```

### 브라우즈 모드 (`!isSearching`)

좌측 리스트 컬럼을 **하나의 스크롤 컨테이너**로 재구성:

1. **상단 "Recently opened" 밴드**
   - `recentBandItems = recentEntries` 중 `filteredMaps`에 존재하는 것을 최신순으로, `slice(0, recentShown)`.
   - 각 `MapCard`에 `recentOpenedAt={entry.at}` 전달 → 배지 렌더.
   - 밴드 하단 "Show more" 버튼: `recentBandItems` 후보가 `recentShown`보다 많을 때만 노출, 클릭 시 `recentShown += RECENT_PAGE`.
   - `recentBandItems`가 비면 밴드 전체 미표시.
2. **하단 기존 목록**
   - 현행 `mapHits`(빈 쿼리이므로 전체 통과) 렌더 — **기존 순서·기존 카드 그대로**, `recentOpenedAt` 미전달(배지 없음).

### 검색 모드 (`isSearching`)

밴드 없음, 단일 랭킹 목록:

- `mapHits = filterByQuery(...)` (기존).
- `recentRank: Map<id, index>` (recentEntries 최신순 인덱스).
- 정렬: 최근 접속 매치(recentRank 보유)를 **먼저**(recentRank 오름차순), 그 다음 나머지를 **기존 mapHits 순서 유지**. → `stableSort`가 아니라 partition + concat으로 구현(기존 순서 보존 보장).
- 상단 고정된 최근 매치 카드에만 `recentOpenedAt` 전달(배지).

## 컴포넌트 변경: `MapCard`

- prop 추가: `recentOpenedAt?: number` (epoch ms).
- 있으면 accent 배지 렌더 — `Recently opened · {relativeTime}`. 기존 `relativeTime(iso)` 헬퍼 재사용을 위해 내부에서 `new Date(recentOpenedAt).toISOString()` 변환하거나 ms 직접 처리(기존 `now - ts` 로직 재사용).
- 배지 스타일: `bg-accent-tint text-accent` 소형 pill(`text-fine`), 토큰만 사용(raw hex 금지, `rules/frontend/design.md`).

## i18n (EN/KO, `lib/i18n-messages.ts`)

| 키 | EN | KO |
|----|----|----|
| `home.recentTitle` | Recently opened | 최근 열어본 |
| `home.recentMore` | Show more | 더보기 |
| `home.recentBadge` | Recently opened | 최근 접속 |

배지 최종 텍스트 = `t("home.recentBadge") + " · " + relativeTime` (기존 `home.timeAgo.*` 재사용).

## 엣지 케이스

- 최근 맵이 삭제/권한 상실 → `filteredMaps`에 없으므로 밴드·검색에서 자동 제외.
- 최근 맵이 활성 필터에 걸림 → 밴드에서도 제외(필터를 밴드에 동일 적용).
- `recentShown`이 후보 수보다 큼 → slice가 자동 처리, "Show more" 숨김.
- SSR/localStorage 미가용 → 빈 배열, 밴드 미표시(정상 폴백).

## 검증 계획

- `npm run lint` / `npm run build` 통과(React Compiler 수동 메모이제이션 규칙 주의 — 신규 파생값은 컴파일러 자동 메모 또는 deps 정합).
- 브라우저 수동 검증(로컬 네이티브):
  1. 맵 2~3개 열기 → 홈 최상단 밴드에 최신순 노출, 배지 시각 확인.
  2. "Show more" 클릭 → +3개.
  3. 검색어 입력 → 최근 접속 매치 상단 고정 + 배지, 나머지 검색 랭킹.
  4. 검색어+필터 설정 후 맵 진입 → 뒤로가기/브랜드 로고 클릭 → 검색어·필터 유지.
  5. 탭 닫았다 새로 열기 → 검색·필터 초기화(session 스코프).

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `frontend/src/lib/recent-maps.ts` | 신규 — 최근 열람 localStorage 헬퍼 |
| `frontend/src/app/maps/[mapId]/page.tsx` | `recordRecentMap` import + `MapEditorPage`에 기록 effect |
| `frontend/src/app/page.tsx` | 최근 밴드/검색 정렬 파생·렌더, sessionStorage 검색·필터 영속 |
| `frontend/src/components/maps/map-card.tsx` | `recentOpenedAt` prop + 배지 |
| `frontend/src/lib/i18n-messages.ts` | `home.recentTitle`/`recentMore`/`recentBadge` EN·KO |
