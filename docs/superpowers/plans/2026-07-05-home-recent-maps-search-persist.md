# Home Recent-Maps Cache · Search Priority · Search Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 맵 리스트에 최근 열어본 맵 밴드(상단 3개 + 더보기), 검색 시 최근 접속 우선 정렬·배지, 뒤로가기/목록복귀 시 검색어·필터 유지를 추가한다.

**Architecture:** 전부 프론트엔드 클라이언트 캐시. 최근 열람은 `localStorage`(에디터 진입 시 기록), 검색·필터 유지는 `sessionStorage`. 순수 정렬/병합 로직은 `lib/recent-maps.ts`로 분리해 vitest(node)로 단위 테스트하고, 렌더/스토리지 바인딩은 홈 페이지·MapCard에서 소비한다.

**Tech Stack:** Next.js(App Router, client component), React(+React Compiler), TypeScript, Tailwind 토큰, vitest(node 환경), @xyflow/react(무관).

## Global Constraints

- **디자인 토큰만** — raw hex 금지. 배지/버튼은 `bg-accent-tint`/`text-accent`/`text-fine` 등 토큰 클래스만 (`rules/frontend/design.md`).
- **UI 영어 기본**, 동적 데이터·주석만 한글. 이모지 금지 → Lucide 16px(카드 내부는 기존 12px 유지) strokeWidth 1.5.
- **id 생성은 `genId()`** — 이 작업엔 신규 id 생성 없음(해당 없음).
- **React Compiler** — 수동 메모이제이션 deps 불일치 시 `npm run lint`/`build` 실패. 신규 파생값은 **plain const**(컴파일러 자동 메모)로 두거나 deps 정합. setState-only 핸들러는 plain 함수로.
- **하이드레이션 안전** — localStorage/sessionStorage는 마운트 후 effect에서 복원(초기 render는 default). setState-in-effect는 `// eslint-disable-next-line react-hooks/set-state-in-effect` + 사유 주석(기존 `lib/i18n.tsx` 패턴).
- **커밋마다 `PROGRESS.md` 한 줄 갱신**을 같은 커밋에 포함(`rules/common/git.md`). 커밋 메시지는 `type(scope): English — 한국어`.
- **vitest는 node 환경**(`vitest.config.ts` include `src/**/*.test.ts`) — `window`/`localStorage`/DOM 없음. 스토리지·컴포넌트는 단위 테스트하지 말고 순수 함수만 테스트, 나머지는 lint/build + 브라우저 수동 검증.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `frontend/src/lib/recent-maps.ts` | **신규** — 최근 열람 캐시. 순수 로직(`mergeRecentEntry`, `partitionByRecency`) + localStorage 바인딩(`getRecentMaps`, `recordRecentMap`) |
| `frontend/src/lib/recent-maps.test.ts` | **신규** — 순수 로직 단위 테스트 |
| `frontend/src/app/maps/[mapId]/page.tsx` | **수정** — `MapEditorPage`에 진입 기록 effect |
| `frontend/src/lib/i18n-messages.ts` | **수정** — `home.recentTitle`/`recentMore`/`recentBadge` EN·KO |
| `frontend/src/components/maps/map-card.tsx` | **수정** — `recentOpenedAt` prop + 배지 |
| `frontend/src/app/page.tsx` | **수정** — 최근 밴드·검색 정렬 파생/렌더, sessionStorage 검색·필터 영속 |

---

## Task 1: `recent-maps.ts` — pure helpers + localStorage wrappers

**Files:**
- Create: `frontend/src/lib/recent-maps.ts`
- Test: `frontend/src/lib/recent-maps.test.ts`

**Interfaces:**
- Produces:
  - `interface RecentMapEntry { id: number; at: number }`
  - `mergeRecentEntry(entries: RecentMapEntry[], id: number, at: number, max?: number): RecentMapEntry[]`
  - `partitionByRecency<T>(items: T[], getId: (item: T) => number, recentIds: number[]): { recent: T[]; rest: T[] }`
  - `getRecentMaps(): RecentMapEntry[]`
  - `recordRecentMap(id: number): void`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/recent-maps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mergeRecentEntry, partitionByRecency } from "@/lib/recent-maps";

describe("mergeRecentEntry", () => {
  it("prepends a new id", () => {
    expect(mergeRecentEntry([], 1, 100)).toEqual([{ id: 1, at: 100 }]);
  });

  it("moves an existing id to the front and updates its time", () => {
    const entries = [
      { id: 1, at: 10 },
      { id: 2, at: 20 },
    ];
    expect(mergeRecentEntry(entries, 2, 30)).toEqual([
      { id: 2, at: 30 },
      { id: 1, at: 10 },
    ]);
  });

  it("caps at max, dropping the oldest", () => {
    const entries = [
      { id: 1, at: 1 },
      { id: 2, at: 2 },
      { id: 3, at: 3 },
    ];
    expect(mergeRecentEntry(entries, 4, 4, 3)).toEqual([
      { id: 4, at: 4 },
      { id: 1, at: 1 },
      { id: 2, at: 2 },
    ]);
  });
});

describe("partitionByRecency", () => {
  const items = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }];
  const getId = (x: { id: number }) => x.id;

  it("splits recent (in recentIds order) from rest (original order)", () => {
    const { recent, rest } = partitionByRecency(items, getId, [30, 10]);
    expect(recent).toEqual([{ id: 30 }, { id: 10 }]);
    expect(rest).toEqual([{ id: 20 }, { id: 40 }]);
  });

  it("empty recentIds → everything is rest", () => {
    const { recent, rest } = partitionByRecency(items, getId, []);
    expect(recent).toEqual([]);
    expect(rest).toEqual(items);
  });

  it("ignores recentIds not present in items", () => {
    const { recent } = partitionByRecency(items, getId, [99, 20]);
    expect(recent).toEqual([{ id: 20 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/recent-maps.test.ts`
Expected: FAIL — cannot resolve `@/lib/recent-maps` (module not found).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/recent-maps.ts`:

```ts
// 최근 열어본 맵 — localStorage(bpm.recentMaps). {id, at} 최신순, 최대 12개.
// 에디터 진입 시 기록하고 홈 리스트에서 조회한다. 백엔드 변경 없는 클라이언트 캐시.

export interface RecentMapEntry {
  id: number;
  at: number; // epoch ms — 마지막 열람 시각
}

const KEY = "bpm.recentMaps";
const MAX = 12; // 캐시 상한(밴드 "더보기" 4페이지 분량)

// 순수 로직 — id를 맨 앞으로(중복 제거) 후 max개로 절단. 단위 테스트 대상.
export function mergeRecentEntry(
  entries: RecentMapEntry[],
  id: number,
  at: number,
  max: number = MAX,
): RecentMapEntry[] {
  const rest = entries.filter((e) => e.id !== id);
  return [{ id, at }, ...rest].slice(0, max);
}

// 순수 로직 — recentIds(최신순) 기준으로 items를 recent/rest로 분할.
// recent는 recentIds 순, rest는 원본 순. 단위 테스트 대상.
export function partitionByRecency<T>(
  items: T[],
  getId: (item: T) => number,
  recentIds: number[],
): { recent: T[]; rest: T[] } {
  const rank = new Map<number, number>();
  recentIds.forEach((id, i) => rank.set(id, i));
  const recent = items
    .filter((it) => rank.has(getId(it)))
    .sort((a, b) => (rank.get(getId(a)) ?? 0) - (rank.get(getId(b)) ?? 0));
  const rest = items.filter((it) => !rank.has(getId(it)));
  return { recent, rest };
}

// localStorage 조회 — SSR/파싱 실패 시 빈 배열(하이드레이션 안전).
export function getRecentMaps(): RecentMapEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (e): e is RecentMapEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentMapEntry).id === "number" &&
        typeof (e as RecentMapEntry).at === "number",
    );
  } catch {
    return [];
  }
}

// 진입 기록 — 현재 시각으로 id를 맨 앞으로 병합해 저장(이벤트/effect 컨텍스트 전용).
export function recordRecentMap(id: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const next = mergeRecentEntry(getRecentMaps(), id, Date.now());
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/recent-maps.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: no errors for `recent-maps.ts` / `recent-maps.test.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md에 한 줄 추가: "- home: recent-maps localStorage 캐시 헬퍼(mergeRecentEntry/partitionByRecency) 추가"
git add frontend/src/lib/recent-maps.ts frontend/src/lib/recent-maps.test.ts PROGRESS.md
git commit -m "feat(home): recent-maps cache helpers + unit tests — 최근 열람 캐시 순수 로직"
```

---

## Task 2: Record map opens in the editor

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (top imports + `MapEditorPage`, around line 7763)

**Interfaces:**
- Consumes: `recordRecentMap(id: number)` from Task 1.

- [ ] **Step 1: Add the import**

`grep` is ugrep here and skips bracket dirs — open the file directly and add near the other `@/lib` imports (top of file). Add this line:

```ts
import { recordRecentMap } from "@/lib/recent-maps";
```

- [ ] **Step 2: Add the record effect in `MapEditorPage`**

Find (page.tsx ~7763):

```tsx
export default function MapEditorPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  return (
    <ReactFlowProvider>
      <MapEditor mapId={mapId} />
    </ReactFlowProvider>
  );
}
```

Replace with:

```tsx
export default function MapEditorPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  // 최근 열람 기록 — 얇은 래퍼에서(모든 진입 경로 포괄, 6700줄 본체 불변). 클라 캐시.
  useEffect(() => {
    if (Number.isFinite(mapId)) {
      recordRecentMap(mapId);
    }
  }, [mapId]);

  return (
    <ReactFlowProvider>
      <MapEditor mapId={mapId} />
    </ReactFlowProvider>
  );
}
```

`useEffect` is already imported at the top of this file (used throughout `MapEditor`). If lint reports it unused/missing, verify the existing React import line includes `useEffect`.

- [ ] **Step 3: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no type/lint error). This is the verifiable check — no unit test (integration behavior, verified in Task 8 browser run).

- [ ] **Step 4: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: 에디터 진입 시 recordRecentMap 기록 effect"
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(editor): record map open into recent-maps cache — 진입 시 최근 열람 기록"
```

---

## Task 3: i18n keys

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts` (EN block near `home.timeAgo.*` ~line 25-42; KO block ~line 937-954)

**Interfaces:**
- Produces: message keys `home.recentTitle`, `home.recentMore`, `home.recentBadge` (both EN and KO).

- [ ] **Step 1: Add EN keys**

In the EN messages object, next to the existing `"home.searchPlaceholder"` / `"home.filterAll"` group, add:

```ts
  "home.recentTitle": "Recently opened",
  "home.recentMore": "Show more",
  "home.recentBadge": "Recently opened",
```

- [ ] **Step 2: Add KO keys**

In the KO messages object (same relative location, ~line 951 group), add:

```ts
  "home.recentTitle": "최근 열어본",
  "home.recentMore": "더보기",
  "home.recentBadge": "최근 접속",
```

- [ ] **Step 3: Typecheck the message map**

`MessageKey` is derived from the message object, so both language maps must contain identical keys. Run:

Run: `cd frontend && npm run build`
Expected: build succeeds. If a key exists in one language only, TS errors on the message type — fix by matching both.

- [ ] **Step 4: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: i18n keys recentTitle/recentMore/recentBadge (EN·KO)"
git add frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(home): i18n keys for recent-maps band + badge — 최근열람 라벨 EN·KO"
```

---

## Task 4: MapCard — `recentOpenedAt` prop + badge

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx` (props interface ~line 20-27; component signature ~line 30-36; meta row ~line 166-178)

**Interfaces:**
- Consumes: `home.recentBadge` (Task 3); existing local `relativeTime(iso: string)` helper; `Clock` icon (already imported).
- Produces: `MapCard` accepts optional `recentOpenedAt?: number` (epoch ms). When set, renders an accent badge `Recently opened · <relative time>`.

- [ ] **Step 1: Add the prop to the interface**

Find:

```tsx
interface MapCardProps {
  map: MapSummary;
  // 마스터-디테일 선택 — 클릭 시 우측 상세 패널 대상 / select for the detail panel.
  selected?: boolean;
  onSelect?: (mapId: number) => void;
  nameRanges?: MatchRange[];
  // 복사 직후 강조 — 쉬머 링 + 자동 스크롤 (F12).
  highlighted?: boolean;
}
```

Replace with (add one line):

```tsx
interface MapCardProps {
  map: MapSummary;
  // 마스터-디테일 선택 — 클릭 시 우측 상세 패널 대상 / select for the detail panel.
  selected?: boolean;
  onSelect?: (mapId: number) => void;
  nameRanges?: MatchRange[];
  // 복사 직후 강조 — 쉬머 링 + 자동 스크롤 (F12).
  highlighted?: boolean;
  // 최근 접속 시각(epoch ms) — 있으면 accent 배지 표시(상단 밴드·검색모드 최근 매치).
  recentOpenedAt?: number;
}
```

- [ ] **Step 2: Destructure the prop**

Find:

```tsx
export function MapCard({
  map,
  selected = false,
  onSelect,
  nameRanges,
  highlighted = false,
}: MapCardProps) {
```

Replace with:

```tsx
export function MapCard({
  map,
  selected = false,
  onSelect,
  nameRanges,
  highlighted = false,
  recentOpenedAt,
}: MapCardProps) {
```

- [ ] **Step 3: Render the badge in the meta row**

Find the meta-left group (~line 167):

```tsx
        <div className="flex min-w-0 items-center gap-2">
          {(map.owner_name ?? map.created_by) && (
```

Replace with (insert the badge as the first child):

```tsx
        <div className="flex min-w-0 items-center gap-2">
          {recentOpenedAt !== undefined && (
            <span
              data-id="map-card-recent-badge"
              className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-accent-tint px-1.5 py-0.5 text-accent"
            >
              <Clock size={12} strokeWidth={1.5} />
              {t("home.recentBadge")} · {relativeTime(new Date(recentOpenedAt).toISOString())}
            </span>
          )}
          {(map.owner_name ?? map.created_by) && (
```

Note: `relativeTime` takes an ISO string; converting ms → ISO reuses the existing thresholds with zero duplication.

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: passes. No unit test (no jsdom); visual verified in Task 8.

- [ ] **Step 5: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: MapCard recentOpenedAt 배지(accent pill, 상대시각)"
git add frontend/src/components/maps/map-card.tsx PROGRESS.md
git commit -m "feat(home): MapCard recent-opened badge — 최근 접속 배지"
```

---

## Task 5: Home — recent band (browse mode) + list restructure

**Files:**
- Modify: `frontend/src/app/page.tsx` (imports; state; derived values after `mapHits`; render region lines ~284-323)

**Interfaces:**
- Consumes: `getRecentMaps`, `partitionByRecency`, `RecentMapEntry` (Task 1); `MapCard` `recentOpenedAt` (Task 4); `home.recentTitle`/`home.recentMore` (Task 3); `type MatchRange` from `@/lib/search`.
- Produces: browse-mode layout — top "Recently opened" band (3 + Show more) over the unchanged full list; a local `renderRow` closure reused by the full lists.

- [ ] **Step 1: Extend imports**

Find:

```tsx
import { copyMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { filterByQuery } from "@/lib/search";
```

Replace with:

```tsx
import { copyMap, deleteMap, listMaps, type MapSummary } from "@/lib/api";
import { filterByQuery, type MatchRange } from "@/lib/search";
import { getRecentMaps, partitionByRecency, type RecentMapEntry } from "@/lib/recent-maps";
```

- [ ] **Step 2: Add state (recent entries + band page size)**

Find:

```tsx
  const [highlightId, setHighlightId] = useState<number | null>(null);
```

Insert after it:

```tsx
  // 최근 열람 캐시(마운트 후 로드) + 밴드 노출 개수("더보기" +3, 검색내용 아님 → 미영속) /
  // recent-opened cache (loaded after mount) + band page size.
  const [recentEntries, setRecentEntries] = useState<RecentMapEntry[]>([]);
  const [recentShown, setRecentShown] = useState(3);
```

- [ ] **Step 3: Load recent entries after mount**

Find the existing initial-load effect (`useEffect(() => { let active = true; ... }, [t]);`, ~line 63-80). Immediately after it, add:

```tsx
  // 최근 열람 로드 — localStorage는 클라 전용이라 마운트 후 복원(초기 render는 빈 배열).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentEntries(getRecentMaps()); // one-time hydration from localStorage
  }, []);
```

- [ ] **Step 4: Add derived values after `mapHits`**

Find (~line 154, end of the `mapHits` useMemo):

```tsx
  // 선택 파생 — selectedId가 비었거나 삭제된 맵이면 첫 맵으로 폴백(이펙트 없이) /
  // Derive selection: fall back to the first map when none/stale (no effect needed).
  const effectiveSelected =
```

Insert **before** that comment:

```tsx
  // 최근 접속 파생 — 검색 여부, id 순서·시각 맵, 브라우즈 밴드(최근 ∩ 필터, 최신순) /
  // recent-opened derivations: search flag, id order, time-by-id, browse band.
  const isSearching = mapQuery.trim() !== "";
  const recentIds = recentEntries.map((e) => e.id);
  const atById = new Map(recentEntries.map((e) => [e.id, e.at]));
  const recentBand = isSearching
    ? []
    : partitionByRecency(filteredMaps, (m) => m.id, recentIds).recent;

```

- [ ] **Step 5: Add the `renderRow` closure**

Find the `return (` of the component (~line 163, `return (` just before the outer `<div className="flex h-full ...">`). Insert this closure **immediately before** `return (`:

```tsx
  // 리스트 행 — MapCard + 좁은 폭 인라인 아코디언(기존 블록 그대로). 밴드는 아코디언 없이 별도 렌더. /
  // A full-list row: MapCard + narrow-screen accordion. The band renders cards without the accordion.
  const renderRow = (
    processMap: MapSummary,
    nameRanges: MatchRange[],
    recentAt: number | undefined,
  ) => (
    <li key={processMap.id} className="flex flex-col">
      <MapCard
        map={processMap}
        selected={effectiveSelected === processMap.id}
        highlighted={highlightId === processMap.id}
        onSelect={setSelectedId}
        nameRanges={nameRanges}
        recentOpenedAt={recentAt}
      />
      <div
        data-id="map-detail-accordion"
        className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth xl:hidden ${
          effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {effectiveSelected === processMap.id && (
            <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
              <MapDetailCard
                mapId={processMap.id}
                onDelete={(id) => void handleDelete(id)}
                onCopy={handleCopyOpen}
                onGoToVersion={(vid) => router.push(`/maps/${processMap.id}?version=${vid}`)}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );

```

- [ ] **Step 6: Replace the list render region**

Find the current render block (~line 284-323):

```tsx
              {mapHits.length === 0 ? (
                /* 필터/검색 결과 없음 */
                <div className="flex flex-1 items-center justify-center rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
                  {t("home.empty")}
                </div>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {mapHits.map(({ item: processMap, matches }) => (
              <li key={processMap.id} className="flex flex-col">
                <MapCard
                  map={processMap}
                  selected={effectiveSelected === processMap.id}
                  highlighted={highlightId === processMap.id}
                  onSelect={setSelectedId}
                  nameRanges={matches.find((m) => m.field === "name")?.ranges ?? []}
                />
                {/* 폭이 좁을 때(< xl)만 — 선택 카드 아래 펼침 아코디언 / inline accordion below the selected card on narrow screens */}
                <div
                  data-id="map-detail-accordion"
                  className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth xl:hidden ${
                    effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {effectiveSelected === processMap.id && (
                      <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                        <MapDetailCard
                          mapId={processMap.id}
                          onDelete={(id) => void handleDelete(id)}
                          onCopy={handleCopyOpen}
                          onGoToVersion={(vid) => router.push(`/maps/${processMap.id}?version=${vid}`)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
                </ul>
              )}
```

Replace with (search arm stays a flat list for now — Task 6 adds the reorder):

```tsx
              {mapHits.length === 0 ? (
                /* 필터/검색 결과 없음 */
                <div className="flex flex-1 items-center justify-center rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
                  {t("home.empty")}
                </div>
              ) : isSearching ? (
                /* 검색 모드 — 단일 랭킹 목록(최근 우선 정렬은 Task 6) */
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {mapHits.map(({ item: processMap, matches }) =>
                    renderRow(
                      processMap,
                      matches.find((m) => m.field === "name")?.ranges ?? [],
                      undefined,
                    ),
                  )}
                </ul>
              ) : (
                /* 브라우즈 모드 — 상단 최근 밴드 + 하단 전체 목록(중복 허용) */
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                  {recentBand.length > 0 && (
                    <section data-id="home-recent-band" className="flex flex-col gap-2">
                      <h2 className="text-fine text-ink-tertiary">{t("home.recentTitle")}</h2>
                      <ul className="flex flex-col gap-2">
                        {recentBand.slice(0, recentShown).map((processMap) => (
                          <li key={processMap.id}>
                            <MapCard
                              map={processMap}
                              selected={effectiveSelected === processMap.id}
                              highlighted={highlightId === processMap.id}
                              onSelect={setSelectedId}
                              recentOpenedAt={atById.get(processMap.id)}
                            />
                          </li>
                        ))}
                      </ul>
                      {recentBand.length > recentShown && (
                        <button
                          type="button"
                          data-id="home-recent-more"
                          className="self-start text-fine text-accent hover:underline"
                          onClick={() => setRecentShown((n) => n + 3)}
                        >
                          {t("home.recentMore")}
                        </button>
                      )}
                    </section>
                  )}
                  <ul className="flex flex-col gap-2">
                    {mapHits.map(({ item: processMap, matches }) =>
                      renderRow(
                        processMap,
                        matches.find((m) => m.field === "name")?.ranges ?? [],
                        undefined,
                      ),
                    )}
                  </ul>
                </div>
              )}
```

- [ ] **Step 7: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: passes. Watch for `react-hooks/preserve-manual-memoization` — the new derived values are plain consts (compiler-memoized), matching the existing `effectiveSelected` pattern. If lint flags `setRecentShown((n) => n + 3)` inline handler, leave as-is (arrow in JSX is fine; the compiler memoizes the element).

- [ ] **Step 8: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: 브라우즈 모드 최근 열람 밴드(3+더보기) + 리스트 renderRow 추출"
git add frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(home): recently-opened band with show-more (browse mode) — 최근 열람 밴드"
```

---

## Task 6: Home — search mode recent-first ordering

**Files:**
- Modify: `frontend/src/app/page.tsx` (derived values; search render arm)

**Interfaces:**
- Consumes: `partitionByRecency` (Task 1), `atById`/`recentIds`/`isSearching` (Task 5), `MapCard` `recentOpenedAt` (Task 4).
- Produces: search results reordered so recent-opened matches float to the top (recency order), the rest keep the existing search ranking; pinned recents get the badge.

- [ ] **Step 1: Add the ordered-hits derivation**

Find (added in Task 5):

```tsx
  const recentBand = isSearching
    ? []
    : partitionByRecency(filteredMaps, (m) => m.id, recentIds).recent;
```

Insert after it:

```tsx
  // 검색 모드 정렬 — 최근 접속 매치 상단 고정(최신순) + 나머지 기존 검색 랭킹 /
  // search order: recent-opened matches pinned on top (recency), rest keep search rank.
  const searchPartition = partitionByRecency(mapHits, (h) => h.item.id, recentIds);
  const orderedHits = [...searchPartition.recent, ...searchPartition.rest];
```

- [ ] **Step 2: Use `orderedHits` + badge in the search arm**

Find (the search arm from Task 5):

```tsx
              ) : isSearching ? (
                /* 검색 모드 — 단일 랭킹 목록(최근 우선 정렬은 Task 6) */
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {mapHits.map(({ item: processMap, matches }) =>
                    renderRow(
                      processMap,
                      matches.find((m) => m.field === "name")?.ranges ?? [],
                      undefined,
                    ),
                  )}
                </ul>
              ) : (
```

Replace with:

```tsx
              ) : isSearching ? (
                /* 검색 모드 — 최근 접속 매치 상단 고정 + 배지, 나머지 검색 랭킹 */
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {orderedHits.map(({ item: processMap, matches }) =>
                    renderRow(
                      processMap,
                      matches.find((m) => m.field === "name")?.ranges ?? [],
                      atById.get(processMap.id),
                    ),
                  )}
                </ul>
              ) : (
```

- [ ] **Step 3: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: 검색 시 최근 접속 매치 상단 고정 + 배지"
git add frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(home): pin recent-opened matches on top of search results — 검색 최근 우선"
```

---

## Task 7: Home — persist search + filters (sessionStorage)

**Files:**
- Modify: `frontend/src/app/page.tsx` (imports; add restore + save effects)

**Interfaces:**
- Consumes: existing `mapQuery`/`visFilter`/`statusFilter`/`permFilter` state + their setters.
- Produces: `sessionStorage["bpm.home.filters"]` = `{ q, vis, status[], perm[] }`. Restored once on mount; saved on change (skipping the mount write so defaults never clobber a saved value).

- [ ] **Step 1: Add `useRef` to the React import**

Find:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
```

Replace with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 2: Add the restore effect**

Immediately after the recent-entries load effect (added in Task 5, Step 3), add:

```tsx
  // 검색·필터 복원 — session 스코프(탭 닫으면 초기화). 마운트 후 1회, default 후 복원(하이드레이션 안전).
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("bpm.home.filters");
      if (!raw) {
        return;
      }
      const s = JSON.parse(raw) as {
        q?: unknown;
        vis?: unknown;
        status?: unknown;
        perm?: unknown;
      };
      if (typeof s.q === "string") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMapQuery(s.q); // one-time hydration restore from sessionStorage
      }
      if (s.vis === "all" || s.vis === "public" || s.vis === "private") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisFilter(s.vis);
      }
      if (Array.isArray(s.status)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStatusFilter(new Set(s.status.filter((x): x is string => typeof x === "string")));
      }
      if (Array.isArray(s.perm)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPermFilter(new Set(s.perm.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);
```

- [ ] **Step 3: Add the save effect (skip mount write)**

After the restore effect, add:

```tsx
  // 검색·필터 저장 — 변경 시 session에 기록. 마운트 첫 실행은 skip(초기 default가 저장값 덮어쓰기 방지).
  const saveSkip = useRef(true);
  useEffect(() => {
    if (saveSkip.current) {
      saveSkip.current = false;
      return;
    }
    window.sessionStorage.setItem(
      "bpm.home.filters",
      JSON.stringify({
        q: mapQuery,
        vis: visFilter,
        status: [...statusFilter],
        perm: [...permFilter],
      }),
    );
  }, [mapQuery, visFilter, statusFilter, permFilter]);
```

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npm run lint && npm run build`
Expected: passes. The save effect only writes (no setState) → no `set-state-in-effect`. The restore effect's setStates carry per-line disables.

- [ ] **Step 5: Commit**

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: 검색어·필터 sessionStorage 유지(뒤로가기/목록복귀 시 복원)"
git add frontend/src/app/page.tsx PROGRESS.md
git commit -m "feat(home): persist search + filters via sessionStorage — 검색·필터 유지"
```

---

## Task 8: Integrated browser verification

**Files:** none (verification only). This is the reviewer's end-to-end gate — no unit test can cover localStorage/sessionStorage + navigation.

**Prereq:** local native run per CLAUDE.md — backend on :8000, frontend `npm run dev` on :3000. Have at least 4–5 maps seeded (see `docs/db-seed.md` if empty). Note the browser-verification lessons (`docs/lessons/browser-verification.md`) — kill zombie `next dev` so you test the right build.

- [ ] **Step 1: Recent band appears, most-recent first**

Open 2–3 different maps (navigate into the editor), return home. Expect: a "Recently opened" band at the top of the left list, cards ordered most-recent-first, each with an accent `Recently opened · N min ago` badge. The same maps still appear in the full list below (duplication is intended).

- [ ] **Step 2: "Show more" reveals +3**

Open ≥4 maps. Home band shows 3 + a "Show more" button. Click → up to 3 more appear; button hides when the band is exhausted.

- [ ] **Step 3: Search pins recent matches + badge**

Type a query that matches several maps including a recently-opened one. Expect: no band; recently-opened matches are pinned at the top (recency order) with the badge; the rest follow the existing search ranking. Name highlight still works.

- [ ] **Step 4: Search + filters persist across back / return**

Set a search query and a status/role filter. Enter a map, then return via the browser back button AND (separately) via the top-nav brand logo. Expect: the query and filters are restored both ways.

- [ ] **Step 5: Session scope resets on new tab**

Close the tab, open a fresh tab to the home URL. Expect: search + filters are cleared (sessionStorage is per-tab-session); the recent band persists (localStorage).

- [ ] **Step 6: Record verification result**

Append a one-line result to `PROGRESS.md` (what was verified + observed). If all pass:

```bash
cd /Users/hyeonjin/Documents/bpm
# PROGRESS.md: "- home: 최근열람/검색우선/검색유지 브라우저 수동 검증 통과(band·show-more·pin·persist·session-scope)"
git add PROGRESS.md
git commit -m "docs(home): browser verification of recent-maps feature — 수동 검증 기록"
```

If any step fails, stop and report the failing step with observed vs expected — do not mark the feature complete.

---

## Self-Review (checked against spec)

**Spec coverage:**
- 최근 밴드 3 + 더보기 → Task 5. · 밴드 아래 기존 순서(중복) → Task 5 (full list unchanged). · 검색 시 최근 우선 + 배지 → Task 6 + Task 4. · 검색·필터 유지 → Task 7. · 진입 기록 → Task 2. · localStorage 캐시 헬퍼 → Task 1. · i18n → Task 3. All spec sections mapped.
- Assumptions from spec (cap 12 / +3 / 초기 3 / 하단 중복엔 배지 없음 / filters on both bands / search-mode trigger on non-empty text) are all encoded (Task 1 `MAX`, Task 5 `recentShown` + list passes `undefined` for badge, `isSearching = mapQuery.trim() !== ""`).

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `RecentMapEntry`, `mergeRecentEntry`, `partitionByRecency`, `getRecentMaps`, `recordRecentMap`, `recentOpenedAt` used identically across Tasks 1/2/4/5/6. `partitionByRecency` return `{ recent, rest }` consumed correctly in Task 5 (`.recent`) and Task 6 (`[...recent, ...rest]`). `MatchRange` imported where `renderRow` needs it.

**Extra note (design nuance handled):** band cards deliberately omit the inline accordion (only `renderRow`/full lists render it) so a selected map that appears in both band and list does not open two accordions on narrow screens.
