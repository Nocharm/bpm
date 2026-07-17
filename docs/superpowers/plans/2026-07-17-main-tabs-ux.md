# Main Tabs UX Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maps·Inbox·Notices 탭과 Feedback 패널의 페인포인트를 개선한다 — Maps 좌측 조직도 아코디언+즐겨찾기, 우측 홈 대시보드(도넛 차트+승인/최근/초안), Feedback 최근목록+딥링크, Inbox/Notices 빈영역 다이제스트, `[SP]` 배지.

**Architecture:** 순수 로직(트리 구성·그룹핑·도넛 기하)은 `lib/`로 분리해 vitest TDD. UI는 작은 단일책임 컴포넌트로 분해(`components/maps/`·`components/charts/`)해 조립 후 `app/*/page.tsx`에 배선. 전부 클라이언트, 기존 엔드포인트만 사용(`listMaps`·`getDirectory`·`getMe`·`listInboxApprovals`·`listFeedback`·`getRecentMaps`) — **백엔드 변경 없음**.

**Tech Stack:** Next.js(App Router, React 19 + React Compiler) · TypeScript strict · @xyflow 무관(에디터 아님) · Tailwind 토큰(`globals.css @theme`) · Lucide 아이콘 · vitest(순수 로직) · Playwright+시스템 Chrome(실기동 검증).

**Spec:** `docs/superpowers/specs/2026-07-17-main-tabs-ux-design.md`

## Global Constraints

- **디자인 토큰만** — raw hex 금지. 색은 토큰 클래스(`bg-surface`·`text-ink`·`text-accent`·`bg-accent-tint`·`border-hairline` 등) 또는 `var(--color-*)`. 상태색은 기존 `VERSION_STATUS_STYLE`(`lib/version-status.ts`) 재사용. Lucide 16px strokeWidth 1.5(메타는 12–14px 관례). 라이트 전용(dark 스타일 금지).
- **i18n**: 신규 문자열은 전부 `frontend/src/lib/i18n-messages.ts`의 `en`과 `ko` **양쪽 동일 키**로 추가(en 권위, ko 누락 시 tsc 실패). 하드코딩 금지. UI 영어 기본.
- **React Compiler**: setState만 하는 핸들러는 **plain 함수**(useCallback 금지 — 추론 deps 불일치로 `react-hooks/preserve-manual-memoization` 빌드 실패). effect 내 동기 setState 금지(`react-hooks/set-state-in-effect`) → `reloadKey` bump 또는 파생 계산.
- **id**: `genId()`(`@/lib/id`) — `crypto.randomUUID` 금지(평문 HTTP insecure context).
- **시각**: 상대시각/타임스탬프는 `lib/datetime`(`formatKst`/`formatKstShort`) 또는 기존 `relativeTime` — browser tz(`toLocaleString`) 금지.
- **grep 주의**: ugrep은 `[mapId]` 같은 대괄호 디렉터리를 건너뜀 — `find`+개별 grep 또는 Read 직접.
- **커밋**: 각 태스크 끝 커밋. 커밋 메시지 `type(scope): English — 한국어`. 코드와 함께 `PROGRESS.md` 해당 줄 갱신은 **마지막 통합 커밋**에서 일괄(태스크별 진행은 plan 체크박스로 추적).
- **검증**: 순수 로직=vitest. 컴포넌트=`npm run lint` + `npx tsc --noEmit` + `npm run build` 통과 + 지정 Playwright 스크립트. `npm run dev`는 :3000, `/api`는 backend(:8000) 프록시.

---

# Phase A — Maps 좌측 (조직도 아코디언 + 즐겨찾기 + SP 배지)

### Task 1: `lib/org-tree.ts` — 부서 트리·그룹핑 순수 함수 (TDD)

**Files:**
- Create: `frontend/src/lib/org-tree.ts`
- Test: `frontend/src/lib/org-tree.test.ts`

**Interfaces:**
- Consumes: `MapSummary`(`@/lib/api`, field `owning_department: string | null`), `DirectoryDept`(`@/lib/api`, field `id: string`=org_path, `name`, `korean_name`).
- Produces:
  - `interface OrgNode { path: string; name: string; koreanName: string | null; children: OrgNode[]; maps: MapSummary[]; mapCount: number }`
  - `buildOrgTree(maps: MapSummary[], depts: DirectoryDept[]): { roots: OrgNode[]; unassigned: MapSummary[] }` — org_path prefix로 트리 구성, 각 리프/노드에 직접 소속 맵 배치, `mapCount`=자신+자손 맵 합. `owning_department == null`인 맵은 `unassigned`.
  - `filterMyDeptMaps(maps: MapSummary[], myOrgPath: string): MapSummary[]` — `owning_department === myOrgPath || owning_department.startsWith(myOrgPath + "/")`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { buildOrgTree, filterMyDeptMaps, type OrgNode } from "@/lib/org-tree";
import type { DirectoryDept, MapSummary } from "@/lib/api";

function makeMap(id: number, dept: string | null): MapSummary {
  return {
    id, name: `Map ${id}`, description: "", created_by: "u", created_at: "", updated_at: "",
    my_role: "owner", visibility: "public", latest_version_status: "draft",
    owning_department: dept,
  } as MapSummary;
}
function dept(id: string, korean: string | null = null): DirectoryDept {
  return { id, name: id.split("/").pop() ?? id, korean_name: korean, manager: null } as DirectoryDept;
}

describe("buildOrgTree", () => {
  it("nests by org_path prefix and rolls up mapCount", () => {
    const depts = [dept("Div"), dept("Div/OfficeA"), dept("Div/OfficeB")];
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeA"), makeMap(3, "Div/OfficeB")];
    const { roots, unassigned } = buildOrgTree(maps, depts);
    expect(unassigned).toEqual([]);
    expect(roots).toHaveLength(1);
    const div = roots[0];
    expect(div.path).toBe("Div");
    expect(div.mapCount).toBe(3); // 자손 합산
    const offices = div.children.map((c: OrgNode) => c.path).sort();
    expect(offices).toEqual(["Div/OfficeA", "Div/OfficeB"]);
    const officeA = div.children.find((c: OrgNode) => c.path === "Div/OfficeA")!;
    expect(officeA.maps.map((m) => m.id).sort()).toEqual([1, 2]);
    expect(officeA.mapCount).toBe(2);
  });

  it("routes null owning_department to unassigned", () => {
    const { roots, unassigned } = buildOrgTree([makeMap(9, null)], []);
    expect(roots).toEqual([]);
    expect(unassigned.map((m) => m.id)).toEqual([9]);
  });

  it("creates missing intermediate nodes when a dept row is absent", () => {
    // dept 목록에 'Div'만 있고 리프가 없어도 맵의 org_path로 노드를 만든다
    const { roots } = buildOrgTree([makeMap(1, "Div/Sub/Team")], [dept("Div")]);
    expect(roots[0].path).toBe("Div");
    expect(roots[0].children[0].path).toBe("Div/Sub");
    expect(roots[0].children[0].children[0].path).toBe("Div/Sub/Team");
    expect(roots[0].children[0].children[0].maps.map((m) => m.id)).toEqual([1]);
  });
});

describe("filterMyDeptMaps", () => {
  it("matches my org_path and its descendants only", () => {
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeA/Team"), makeMap(3, "Div/OfficeB"), makeMap(4, null)];
    expect(filterMyDeptMaps(maps, "Div/OfficeA").map((m) => m.id).sort()).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/org-tree.test.ts`
Expected: FAIL — `Cannot find module '@/lib/org-tree'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// 부서 org_path(‘/’ 구분)로 맵을 조직도 트리로 묶는 순수 함수 — 홈 좌측 아코디언·즐겨찾기 소스.
import type { DirectoryDept, MapSummary } from "@/lib/api";

export interface OrgNode {
  path: string; // full org_path (root→this)
  name: string; // 리프 세그먼트
  koreanName: string | null;
  children: OrgNode[];
  maps: MapSummary[]; // 이 부서에 직접 소속된 맵
  mapCount: number; // 자신 + 모든 자손 맵 수
}

export function buildOrgTree(
  maps: MapSummary[],
  depts: DirectoryDept[],
): { roots: OrgNode[]; unassigned: MapSummary[] } {
  const koreanByPath = new Map(depts.map((d) => [d.id, d.korean_name ?? null]));
  const byPath = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];
  const unassigned: MapSummary[] = [];

  const ensure = (path: string): OrgNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: OrgNode = {
      path,
      name: segments[segments.length - 1],
      koreanName: koreanByPath.get(path) ?? null,
      children: [],
      maps: [],
      mapCount: 0,
    };
    byPath.set(path, node);
    if (segments.length === 1) {
      roots.push(node);
    } else {
      ensure(segments.slice(0, -1).join("/")).children.push(node);
    }
    return node;
  };

  // dept 목록 먼저 등록(맵 없는 부서도 노드로 보이게)
  for (const d of depts) ensure(d.id);
  // 맵 배치
  for (const m of maps) {
    if (!m.owning_department) {
      unassigned.push(m);
      continue;
    }
    ensure(m.owning_department).maps.push(m);
  }

  // mapCount 롤업(자손 합) — DFS
  const rollup = (node: OrgNode): number => {
    node.mapCount = node.maps.length + node.children.reduce((s, c) => s + rollup(c), 0);
    return node.mapCount;
  };
  for (const r of roots) rollup(r);
  return { roots, unassigned };
}

export function filterMyDeptMaps(maps: MapSummary[], myOrgPath: string): MapSummary[] {
  if (!myOrgPath) return [];
  return maps.filter(
    (m) => m.owning_department === myOrgPath || (m.owning_department?.startsWith(myOrgPath + "/") ?? false),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/org-tree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/org-tree.ts frontend/src/lib/org-tree.test.ts
git commit -m "feat(home): org-tree pure helpers for dept accordion — 조직도 트리·즐겨찾기 그룹핑"
```

---

### Task 2: `[SP]` 배지 — MapCard + MapDetailCard

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx` (상태배지 옆, `data-id="map-card-status"` 블록 직후)
- Modify: `frontend/src/components/maps/map-detail-card.tsx` (제목/메타 헤더)
- Modify: `frontend/src/lib/i18n-messages.ts` (`home.spBadge`, `home.spBadgeTip`)

**Interfaces:**
- Consumes: `MapSummary.sp_designated_at?: string | null`(이미 존재).
- Produces: 시각 배지만 — 새 export 없음.

- [ ] **Step 1: Add i18n keys**

`frontend/src/lib/i18n-messages.ts` `en` 블록과 `ko` 블록에 각각 추가(기존 `home.*` 근처):

```ts
// en
"home.spBadge": "SP",
"home.spBadgeTip": "Designated as a subprocess",
// ko
"home.spBadge": "SP",
"home.spBadgeTip": "서브프로세스로 지정됨",
```

- [ ] **Step 2: Add badge to MapCard**

`map-card.tsx`에서 `data-id="map-card-status"` `<span>...</span>` 닫힌 직후(같은 flex row 안)에 삽입. `Tooltip`은 이미 프로젝트에 존재(`@/components/tooltip`) — import 추가:

```tsx
{map.sp_designated_at && (
  <span
    data-id="map-card-sp"
    title={t("home.spBadgeTip")}
    className="shrink-0 rounded-sm border border-hairline bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
  >
    {t("home.spBadge")}
  </span>
)}
```

- [ ] **Step 3: Add badge to MapDetailCard**

`map-detail-card.tsx`의 맵 제목/상태 헤더 영역(맵 이름 렌더 근처)에 동일 배지 삽입(같은 클래스). 상세는 `MapDetail`(=`MapSummary` 확장)이라 `detail.sp_designated_at` 접근 가능. 정확한 앵커는 파일 내 맵 이름(`<h*>`/제목) 라인 — 구현 시 Read로 확인 후 이름 옆에 배치.

- [ ] **Step 4: Verify build/lint/types**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/maps/map-card.tsx frontend/src/components/maps/map-detail-card.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): SP badge on map card + detail — 서브프로세스 지정 배지"
```

---

### Task 3: 아코디언·즐겨찾기 컴포넌트 (props-driven, 배선 없음)

**Files:**
- Create: `frontend/src/components/maps/org-accordion.tsx`
- Create: `frontend/src/components/maps/my-dept-favorites.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`home.myDepartment`, `home.departments`, `home.collapseAll`, `home.unassignedDept`)

**Interfaces:**
- Consumes: `OrgNode`·`buildOrgTree`(Task 1), `MapCard`(`@/components/maps/map-card`), `MapSummary`.
- Produces:
  - `interface OrgAccordionProps { roots: OrgNode[]; unassigned: MapSummary[]; openPaths: Set<string>; onToggle: (path: string) => void; onCollapseAll: () => void; selectedId: number | null; highlightId: number | null; onSelect: (id: number) => void; }`
  - `function OrgAccordion(props: OrgAccordionProps): JSX.Element`
  - `interface MyDeptFavoritesProps { maps: MapSummary[]; deptLabel: string; open: boolean; onToggle: () => void; selectedId: number | null; onSelect: (id: number) => void; }`
  - `function MyDeptFavorites(props: MyDeptFavoritesProps): JSX.Element | null` (maps 비면 null)

- [ ] **Step 1: Add i18n keys** (en+ko)

```ts
"home.myDepartment": "My department",
"home.departments": "Departments",
"home.collapseAll": "Collapse all",
"home.unassignedDept": "Unassigned department",
```
ko:
```ts
"home.myDepartment": "나의 부서",
"home.departments": "부서",
"home.collapseAll": "모두 접기",
"home.unassignedDept": "부서 미지정",
```

- [ ] **Step 2: Write `my-dept-favorites.tsx`**

```tsx
// 홈 좌측 상단 — 나의 부서 맵 즐겨찾기(핀). 아코디언과 별개로 빠른 접근.
"use client";

import { ChevronDown, ChevronRight, Star } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { MapCard } from "@/components/maps/map-card";

interface MyDeptFavoritesProps {
  maps: MapSummary[];
  deptLabel: string;
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function MyDeptFavorites({ maps, deptLabel, open, onToggle, selectedId, onSelect }: MyDeptFavoritesProps) {
  const { t } = useI18n();
  if (maps.length === 0) return null;
  return (
    <section data-id="home-my-dept" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="group flex items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-surface-alt"
      >
        {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
        <Star size={14} strokeWidth={1.5} className="text-accent" />
        <span className="text-fine text-ink-secondary">{t("home.myDepartment")} — {deptLabel}</span>
        <span className="ml-auto text-fine text-ink-tertiary">({maps.length})</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 pl-1">
          {maps.map((m) => (
            <li key={m.id}>
              <MapCard map={m} selected={selectedId === m.id} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write `org-accordion.tsx`** (재귀 노드 렌더 + 모두 접기)

```tsx
// 홈 좌측 — owning department 조직도 아코디언. 리프/노드에 MapCard, 상위 노드는 롤업 카운트.
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import type { OrgNode } from "@/lib/org-tree";
import { useI18n } from "@/lib/i18n";
import { MapCard } from "@/components/maps/map-card";

interface OrgAccordionProps {
  roots: OrgNode[];
  unassigned: MapSummary[];
  openPaths: Set<string>;
  onToggle: (path: string) => void;
  onCollapseAll: () => void;
  selectedId: number | null;
  highlightId: number | null;
  onSelect: (id: number) => void;
}

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const { roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId, onSelect } = props;

  const renderNode = (node: OrgNode, depth: number) => {
    const open = openPaths.has(node.path);
    return (
      <li key={node.path} className="flex flex-col">
        <button
          type="button"
          data-id="org-node-toggle"
          data-path={node.path}
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="group flex items-center gap-1.5 rounded-sm py-1 text-left hover:bg-surface-alt"
        >
          {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
          <span className="truncate text-fine text-ink-secondary group-hover:text-ink">{node.name}</span>
          <span className="ml-auto shrink-0 text-fine text-ink-tertiary">({node.mapCount})</span>
        </button>
        {open && (
          <div className="flex flex-col gap-2">
            {node.children.length > 0 && (
              <ul className="flex flex-col">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
            )}
            {node.maps.length > 0 && (
              <ul className="flex flex-col gap-2" style={{ paddingLeft: `${depth * 12 + 16}px` }}>
                {node.maps.map((m) => (
                  <li key={m.id}>
                    <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section data-id="home-org-accordion" className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-fine text-ink-tertiary">{t("home.departments")}</span>
        <button
          type="button"
          data-id="org-collapse-all"
          onClick={(e) => { e.stopPropagation(); onCollapseAll(); }}
          className="text-fine text-accent hover:underline"
        >
          {t("home.collapseAll")}
        </button>
      </div>
      <ul className="flex flex-col">{roots.map((r) => renderNode(r, 0))}</ul>
      {unassigned.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <span className="px-1 text-fine text-ink-tertiary">{t("home.unassignedDept")} ({unassigned.length})</span>
          <ul className="flex flex-col gap-2 pl-1">
            {unassigned.map((m) => (
              <li key={m.id}>
                <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Verify build/lint/types**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors. (`MapCard`/`DirectoryDept` prop 이름 불일치 시 여기서 잡힘.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/maps/org-accordion.tsx frontend/src/components/maps/my-dept-favorites.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): org accordion + my-dept favorites components — 조직도 아코디언·즐겨찾기 컴포넌트"
```

---

### Task 4: 좌측 배선 — page.tsx (브라우즈=즐겨찾기+아코디언 / 검색·필터=평면, 데이터 fetch, 자동 펼침)

**Files:**
- Modify: `frontend/src/app/page.tsx` (좌측 리스트 컬럼: 브라우즈 분기 교체, `useDirectory`/`getMe` fetch, openPaths state, 최근 밴드 제거)

**Interfaces:**
- Consumes: `OrgAccordion`·`MyDeptFavorites`(Task 3), `buildOrgTree`·`filterMyDeptMaps`(Task 1), `useDirectory`(`@/lib/directory`), `getMe`(`@/lib/api`).
- Produces: 좌측 렌더 — `selectedId` 연동은 Task 10에서 자동펼침 완성.

- [ ] **Step 1: Add data fetch + state**

`page.tsx` 상단(다른 useState 근처)에 추가:

```tsx
const directory = useDirectory(); // { departments, users } | null (session-cached)
const [me, setMe] = useState<Me | null>(null);
const [orgOpen, setOrgOpen] = useState<Set<string>>(new Set());
const [favOpen, setFavOpen] = useState(true);

useEffect(() => {
  let active = true;
  void getMe().then((m) => { if (active) setMe(m); }).catch(() => {});
  return () => { active = false; };
}, []);
```

import 추가: `import { getMe, type Me } from "@/lib/api";`(기존 api import에 병합), `import { useDirectory } from "@/lib/directory";`, `import { buildOrgTree, filterMyDeptMaps } from "@/lib/org-tree";`, `import { OrgAccordion } from "@/components/maps/org-accordion";`, `import { MyDeptFavorites } from "@/components/maps/my-dept-favorites";`.

- [ ] **Step 2: Derive tree + favorites (render-time, no effect)**

`filteredMaps`/`browseHits` 파생 근처에 추가:

```tsx
const orgTree = useMemo(
  () => buildOrgTree(filteredMaps, directory?.departments ?? []),
  [filteredMaps, directory],
);
const myDeptMaps = useMemo(
  () => (me?.org_path ? filterMyDeptMaps(filteredMaps, me.org_path) : []),
  [filteredMaps, me],
);
const myDeptLabel = me?.department ?? me?.org_path?.split("/").pop() ?? "";
```

- [ ] **Step 3: Replace browse-mode left render**

브라우즈 분기(현재 `recentBand` + 전체목록 렌더, `page.tsx:582-678` 영역)를 아래로 교체(검색 모드 `isSearching` 분기와 `mapHits.length===0` 분기는 유지). 최근 밴드 관련(`recentBand`, `recentShown`, `recentCollapsed`, `toggleRecentCollapse`)은 좌측에서 제거(우측 대시보드로 이동, Task 7):

```tsx
) : (
  /* 브라우즈 — 나의 부서 즐겨찾기 + 조직도 아코디언 */
  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1">
    <MyDeptFavorites
      maps={myDeptMaps}
      deptLabel={myDeptLabel}
      open={favOpen}
      onToggle={() => setFavOpen((v) => !v)}
      selectedId={effectiveSelected}
      onSelect={setSelectedId}
    />
    <OrgAccordion
      roots={orgTree.roots}
      unassigned={orgTree.unassigned}
      openPaths={orgOpen}
      onToggle={(path) => setOrgOpen((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path); else next.add(path);
        return next;
      })}
      onCollapseAll={() => setOrgOpen(new Set())}
      selectedId={effectiveSelected}
      highlightId={highlightId}
      onSelect={setSelectedId}
    />
  </div>
)
```

- [ ] **Step 4: Seed initial expansion (my-dept subtree open)**

`orgOpen` 초기 펼침 — me·directory 로드 후 내 부서 조상 경로를 연다. effect 내 동기 setState 금지이므로 `me`/`directory` 준비되면 1회 파생:

```tsx
const seededOrg = useRef(false);
useEffect(() => {
  if (seededOrg.current || !me?.org_path) return;
  seededOrg.current = true;
  const parts = me.org_path.split("/");
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setOrgOpen(new Set(paths)); // one-time seed from my org_path
}, [me]);
```

- [ ] **Step 5: Verify build + browser**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 errors.

Playwright(백엔드+프론트 기동 후): 홈에서 `[data-id=home-my-dept]`·`[data-id=home-org-accordion]` 존재, `[data-id=org-node-toggle]` 클릭 시 자식 토글, `[data-id=org-collapse-all]` 클릭 시 전부 접힘, 검색어 입력 시 평면 목록(`[data-id=home-org-accordion]` 사라짐) 확인. (스크립트는 `frontend/scripts/pw-verify-org-accordion.mjs` 신설 — 기존 `pw-verify-*.mjs` 패턴 참조.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(home): wire dept accordion + favorites into left column — 좌측 조직도·즐겨찾기 배선, 최근밴드 이동"
```

---

# Phase B — Maps 우측 홈 대시보드

### Task 5: `lib/donut-geometry.ts` + `components/charts/donut.tsx` (기하 TDD + SVG)

**Files:**
- Create: `frontend/src/lib/donut-geometry.ts`
- Test: `frontend/src/lib/donut-geometry.test.ts`
- Create: `frontend/src/components/charts/donut.tsx`

**Interfaces:**
- Produces:
  - `interface DonutSegment { key: string; value: number; colorVar: string }`
  - `interface DonutArc { key: string; value: number; colorVar: string; dashArray: string; dashOffset: number }`
  - `computeDonutArcs(segments: DonutSegment[], circumference: number): DonutArc[]` — value 0 세그먼트 제외, 누적 offset 계산.
  - `Donut({ segments, size, selectedKey, onSelect }): JSX.Element` — SVG stroke-dasharray 도넛, 세그먼트 클릭 콜백, 중앙 total 표시.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { computeDonutArcs } from "@/lib/donut-geometry";

describe("computeDonutArcs", () => {
  it("splits circumference proportionally and accumulates offsets", () => {
    const C = 100;
    const arcs = computeDonutArcs(
      [{ key: "a", value: 3, colorVar: "--x" }, { key: "b", value: 1, colorVar: "--y" }],
      C,
    );
    expect(arcs).toHaveLength(2);
    // a=75% → dash "75 25", offset 0; b=25% → dash "25 75", offset -75
    expect(arcs[0].dashArray).toBe("75 25");
    expect(arcs[0].dashOffset).toBe(0);
    expect(arcs[1].dashArray).toBe("25 75");
    expect(arcs[1].dashOffset).toBe(-75);
  });

  it("drops zero-value segments", () => {
    const arcs = computeDonutArcs(
      [{ key: "a", value: 0, colorVar: "--x" }, { key: "b", value: 2, colorVar: "--y" }],
      100,
    );
    expect(arcs.map((a) => a.key)).toEqual(["b"]);
    expect(arcs[0].dashArray).toBe("100 0");
  });

  it("returns empty for all-zero", () => {
    expect(computeDonutArcs([{ key: "a", value: 0, colorVar: "--x" }], 100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — verify fails**

Run: `cd frontend && npx vitest run src/lib/donut-geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement geometry**

```ts
// 도넛 세그먼트 → SVG stroke-dasharray 아크 변환(순수). circumference=2πr.
export interface DonutSegment { key: string; value: number; colorVar: string }
export interface DonutArc { key: string; value: number; colorVar: string; dashArray: string; dashOffset: number }

export function computeDonutArcs(segments: DonutSegment[], circumference: number): DonutArc[] {
  const nonZero = segments.filter((s) => s.value > 0);
  const total = nonZero.reduce((s, x) => s + x.value, 0);
  if (total === 0) return [];
  const arcs: DonutArc[] = [];
  let acc = 0;
  for (const s of nonZero) {
    const len = (s.value / total) * circumference;
    const round = (n: number) => Math.round(n * 100) / 100;
    arcs.push({
      key: s.key,
      value: s.value,
      colorVar: s.colorVar,
      dashArray: `${round(len)} ${round(circumference - len)}`,
      dashOffset: -round(acc),
    });
    acc += len;
  }
  return arcs;
}
```

- [ ] **Step 4: Run test — verify passes**

Run: `cd frontend && npx vitest run src/lib/donut-geometry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `Donut` component**

```tsx
// 작은 SVG 도넛 — 세그먼트 클릭 선택. 색은 토큰 var(--color-*) 전달.
"use client";

import { computeDonutArcs, type DonutSegment } from "@/lib/donut-geometry";

interface DonutProps {
  segments: DonutSegment[]; // colorVar 예: "--color-accent"
  size?: number; // px, 기본 120
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
}

export function Donut({ segments, size = 120, selectedKey, onSelect }: DonutProps) {
  const stroke = Math.round(size * 0.16);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const arcs = computeDonutArcs(segments, C);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx={cx} cy={cx} r={r}
            fill="none"
            stroke={`var(${a.colorVar})`}
            strokeWidth={selectedKey === a.key ? stroke + 3 : stroke}
            strokeDasharray={a.dashArray}
            strokeDashoffset={a.dashOffset}
            className="cursor-pointer transition-[stroke-width] duration-150"
            onClick={() => onSelect?.(a.key)}
            opacity={selectedKey && selectedKey !== a.key ? 0.45 : 1}
          />
        ))}
      </g>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink text-body-strong">
        {total}
      </text>
    </svg>
  );
}
```

- [ ] **Step 6: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 0 errors.

```bash
git add frontend/src/lib/donut-geometry.ts frontend/src/lib/donut-geometry.test.ts frontend/src/components/charts/donut.tsx
git commit -m "feat(charts): SVG donut + geometry helper — 대시보드용 도넛 차트"
```

---

### Task 6: `dashboard-map-row.tsx` — hover→Open / click→select 공용 행

**Files:**
- Create: `frontend/src/components/maps/dashboard-map-row.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`home.openMap`)

**Interfaces:**
- Consumes: `MapSummary`, `useRouter`(next/navigation).
- Produces: `interface DashboardMapRowProps { map: MapSummary; meta?: React.ReactNode; onSelect: (id: number) => void }` · `function DashboardMapRow(props): JSX.Element`
  - hover 시 `[Open →]` 버튼 노출 → `router.push('/maps/{id}')`. 버튼 외 클릭 → `onSelect(id)`.

- [ ] **Step 1: Add i18n key** (en `"home.openMap": "Open"`, ko `"home.openMap": "열기"`)

- [ ] **Step 2: Implement component**

```tsx
// 대시보드 컴팩트 맵 행 — hover 시 Open 버튼(에디터 이동), 그 외 클릭은 선택(좌측 포커스 + 우측 상세).
"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

interface DashboardMapRowProps {
  map: MapSummary;
  meta?: React.ReactNode; // 우측 부가 표기(시각·부서·단계 등)
  onSelect: (id: number) => void;
}

export function DashboardMapRow({ map, meta, onSelect }: DashboardMapRowProps) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div
      data-id="dashboard-map-row"
      onClick={(e) => { e.stopPropagation(); onSelect(map.id); }}
      className="group flex cursor-pointer items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 hover:bg-surface-alt"
    >
      <span className="min-w-0 flex-1 truncate text-caption text-ink">{map.name}</span>
      {map.sp_designated_at && (
        <span className="shrink-0 rounded-sm border border-hairline bg-accent-tint px-1 text-fine text-accent">{t("home.spBadge")}</span>
      )}
      {map.latest_version_status && (
        <span className={`shrink-0 rounded-sm border px-1 py-0.5 text-fine ${VERSION_STATUS_STYLE[map.latest_version_status]}`}>
          {t(VERSION_STATUS_LABEL[map.latest_version_status])}
        </span>
      )}
      {meta && <span className="shrink-0 text-fine text-ink-tertiary">{meta}</span>}
      <button
        type="button"
        data-id="dashboard-map-open"
        onClick={(e) => { e.stopPropagation(); router.push(`/maps/${map.id}`); }}
        className="hidden shrink-0 items-center gap-1 rounded-sm bg-accent px-2 py-1 text-fine text-on-accent group-hover:inline-flex"
      >
        {t("home.openMap")} <ArrowRight size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/components/maps/dashboard-map-row.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): dashboard map row (hover-open / click-select) — 대시보드 맵 행"
```

---

### Task 7: `lib/recent-order.ts`(TDD) + `recent-opened-list.tsx` (최상단 + 스태거 진입)

**Files:**
- Create: `frontend/src/lib/recent-order.ts`
- Test: `frontend/src/lib/recent-order.test.ts`
- Create: `frontend/src/components/maps/recent-opened-list.tsx`

**Interfaces:**
- Consumes: `getRecentMaps`(`@/lib/recent-maps`), `DashboardMapRow`(Task 6), `MapSummary`.
- Produces:
  - `readTopChanged(currentTopId: number | null): boolean` — sessionStorage `bpm.home.recentTop`와 비교해 바뀌었으면 true + 저장 갱신.
  - `RecentOpenedList({ maps, onSelect }): JSX.Element | null` — 최근순 렌더, top 변경 시 스태거 진입 애니메이션.

- [ ] **Step 1: Write the failing test** (jsdom sessionStorage)

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { readTopChanged } from "@/lib/recent-order";

describe("readTopChanged", () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it("is true on first sight of a top id and stores it", () => {
    expect(readTopChanged(5)).toBe(true);
    expect(window.sessionStorage.getItem("bpm.home.recentTop")).toBe("5");
  });

  it("is false when top id is unchanged", () => {
    readTopChanged(5);
    expect(readTopChanged(5)).toBe(false);
  });

  it("is true when top id changes", () => {
    readTopChanged(5);
    expect(readTopChanged(7)).toBe(true);
  });

  it("is false for null top", () => {
    expect(readTopChanged(null)).toBe(false);
  });
});
```

(vitest jsdom 환경 필요 — `frontend/vitest.config.ts`에 `environment: "jsdom"`이 이미 설정됐는지 확인, 아니면 파일 상단 `// @vitest-environment jsdom` 주석 추가.)

- [ ] **Step 2: Run — verify fails**

Run: `cd frontend && npx vitest run src/lib/recent-order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// 최근 목록 최상단 변화 감지 — 순서 갱신을 애니메이션으로 인지시키기 위한 세션 비교.
const KEY = "bpm.home.recentTop";

export function readTopChanged(currentTopId: number | null): boolean {
  if (currentTopId == null) return false;
  let prev: string | null = null;
  try { prev = window.sessionStorage.getItem(KEY); } catch { return false; }
  const cur = String(currentTopId);
  if (prev === cur) return false;
  try { window.sessionStorage.setItem(KEY, cur); } catch { /* ignore */ }
  return true;
}
```

- [ ] **Step 4: Run — verify passes**

Run: `cd frontend && npx vitest run src/lib/recent-order.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement `recent-opened-list.tsx`**

```tsx
// 홈 대시보드 최상단 — 최근 열람 맵. top 변경 시 위에서 내려오며 밀리는 스태거 진입.
"use client";

import { useMemo } from "react";

import type { MapSummary } from "@/lib/api";
import { getRecentMaps } from "@/lib/recent-maps";
import { readTopChanged } from "@/lib/recent-order";
import { useI18n } from "@/lib/i18n";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";

interface RecentOpenedListProps {
  maps: MapSummary[]; // 접근 가능한 전체(필터 전) — 최근 id와 교차
  onSelect: (id: number) => void;
}

export function RecentOpenedList({ maps, onSelect }: RecentOpenedListProps) {
  const { t } = useI18n();
  const recent = useMemo(() => {
    const ids = getRecentMaps().map((e) => e.id);
    const byId = new Map(maps.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id)).filter((m): m is MapSummary => Boolean(m));
  }, [maps]);
  // top 변화 시 1회 애니메이션(파생 — render 중 sessionStorage 비교, effect 아님)
  const animate = useMemo(() => readTopChanged(recent[0]?.id ?? null), [recent]);
  if (recent.length === 0) return null;
  return (
    <section data-id="home-recent" className="flex flex-col gap-2">
      <div className="px-1 text-fine text-ink-tertiary">{t("home.recentTitle")}</div>
      <ul className="flex flex-col gap-2">
        {recent.slice(0, 6).map((m, i) => (
          <li
            key={m.id}
            className={animate ? "motion-safe:animate-[slideDown_350ms_ease-out_both]" : ""}
            style={animate ? { animationDelay: `${i * 45}ms` } : undefined}
          >
            <DashboardMapRow map={m} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`globals.css`에 keyframe이 없으면 추가(있으면 재사용):
```css
@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
```

- [ ] **Step 6: Verify + Commit**

Run: `cd frontend && npx vitest run src/lib/recent-order.test.ts && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/lib/recent-order.ts frontend/src/lib/recent-order.test.ts frontend/src/components/maps/recent-opened-list.tsx frontend/src/app/globals.css
git commit -m "feat(home): recent-opened list with entrance animation — 최근 열람 스태거 진입"
```

---

### Task 8: `status-donut-card.tsx` — 내 오너 문서 상태 도넛 + 목록

**Files:**
- Create: `frontend/src/components/maps/status-donut-card.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`home.myDocuments`)

**Interfaces:**
- Consumes: `Donut`(Task 5), `DashboardMapRow`(Task 6), `MapSummary`, `VERSION_STATUS_LABEL/STYLE`.
- Produces: `interface StatusDonutCardProps { maps: MapSummary[]; onSelect: (id: number) => void }` · `function StatusDonutCard(props): JSX.Element | null` (내 오너 맵 0이면 null). 내부 `selectedStatus` state 기본 `"draft"`.

- [ ] **Step 1: Add i18n key** (en `"home.myDocuments": "My documents"`, ko `"내 문서"`)

- [ ] **Step 2: Implement**

```tsx
// 홈 대시보드 — 내가 오너인 문서 상태별 도넛. 세그먼트 클릭 → 목록 필터(기본 draft).
"use client";

import { useMemo, useState } from "react";

import type { MapSummary } from "@/lib/api";
import type { VersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_LABEL } from "@/lib/version-status";
import { Donut } from "@/components/charts/donut";
import { DashboardMapRow } from "@/components/maps/dashboard-map-row";

// 상태 → 토큰 색변수(상태 배지 색과 계열 일치)
const STATUS_COLOR: Record<VersionStatus, string> = {
  draft: "--color-ink-tertiary",
  pending: "--color-warning",
  approved: "--color-accent",
  published: "--color-success",
  rejected: "--color-error",
  expired: "--color-ink-quaternary",
};
const ORDER: VersionStatus[] = ["draft", "pending", "approved", "published", "rejected", "expired"];

interface StatusDonutCardProps { maps: MapSummary[]; onSelect: (id: number) => void }

export function StatusDonutCard({ maps, onSelect }: StatusDonutCardProps) {
  const { t } = useI18n();
  const owned = useMemo(() => maps.filter((m) => m.my_role === "owner"), [maps]);
  const byStatus = useMemo(() => {
    const g = new Map<VersionStatus, MapSummary[]>();
    for (const m of owned) {
      const s = (m.latest_version_status ?? "draft") as VersionStatus;
      (g.get(s) ?? g.set(s, []).get(s)!).push(m);
    }
    return g;
  }, [owned]);
  const [selected, setSelected] = useState<VersionStatus>("draft");
  if (owned.length === 0) return null;
  const segments = ORDER
    .map((s) => ({ key: s, value: byStatus.get(s)?.length ?? 0, colorVar: STATUS_COLOR[s] }))
    .filter((s) => s.value > 0);
  const list = byStatus.get(selected) ?? [];
  return (
    <section data-id="home-my-documents" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-alt p-3">
      <div className="text-caption-strong text-ink">{t("home.myDocuments")}</div>
      <div className="flex items-center gap-3">
        <Donut segments={segments} size={104} selectedKey={selected} onSelect={(k) => setSelected(k as VersionStatus)} />
        <ul className="flex flex-col gap-1 text-fine">
          {segments.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelected(s.key as VersionStatus); }}
                className={"flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 " + (selected === s.key ? "bg-accent-tint" : "hover:bg-surface")}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${s.colorVar})` }} />
                <span className="text-ink-secondary">{t(VERSION_STATUS_LABEL[s.key as VersionStatus])}</span>
                <span className="ml-auto text-ink-tertiary">{s.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex flex-col gap-1.5">
        {list.map((m) => <li key={m.id}><DashboardMapRow map={m} onSelect={onSelect} /></li>)}
      </ul>
    </section>
  );
}
```

> 구현 주의: `STATUS_COLOR`가 참조하는 토큰(`--color-warning`·`--color-success`·`--color-ink-quaternary` 등)이 `globals.css @theme`에 없으면, 존재하는 토큰으로 대체(구현 시 `globals.css`에서 확인). 없으면 `VERSION_STATUS_STYLE`의 색계열에 맞춰 가장 가까운 기존 토큰 사용.

- [ ] **Step 3: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/components/maps/status-donut-card.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): my-documents status donut card — 내 문서 상태 도넛"
```

---

### Task 9: `approvals-card.tsx` — 승인 필요 단계 그래프 + 목록

**Files:**
- Create: `frontend/src/components/maps/approvals-card.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`home.needsApproval`, `home.allCaughtUp`)

**Interfaces:**
- Consumes: `listInboxApprovals`·`InboxApproval`(`@/lib/api`), `Donut`(Task 5), `DashboardMapRow`(Task 6).
- Produces: `interface ApprovalsCardProps { onSelect: (id: number) => void }` · `function ApprovalsCard(props): JSX.Element`. 내부에서 `listInboxApprovals()` fetch(마운트 1회). kind별 도넛 + 목록. 0건이면 "all caught up".

- [ ] **Step 1: Add i18n keys** (en `"home.needsApproval": "Needs approval"`, `"home.allCaughtUp": "All caught up"`; ko `"승인 필요"`, `"모두 처리됨"`)

- [ ] **Step 2: Implement**

```tsx
// 홈 대시보드 — 내 승인 대기 큐(kind별 도넛 + 목록). status 파생 단계만(백엔드 무변경).
"use client";

import { useEffect, useMemo, useState } from "react";

import { listInboxApprovals, type InboxApproval } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Donut } from "@/components/charts/donut";

const KIND_COLOR: Record<InboxApproval["kind"], string> = {
  version_approval: "--color-accent",
  checkout_transfer: "--color-warning",
  approval_request: "--color-ink-tertiary",
};

interface ApprovalsCardProps { onSelect: (id: number) => void }

export function ApprovalsCard({ onSelect }: ApprovalsCardProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<InboxApproval[]>([]);
  useEffect(() => {
    let active = true;
    void listInboxApprovals().then((r) => { if (active) setItems(r); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const segments = useMemo(() => {
    const g = new Map<InboxApproval["kind"], number>();
    for (const a of items) g.set(a.kind, (g.get(a.kind) ?? 0) + 1);
    return [...g.entries()].map(([k, v]) => ({ key: k, value: v, colorVar: KIND_COLOR[k] }));
  }, [items]);
  return (
    <section data-id="home-needs-approval" className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-alt p-3">
      <div className="text-caption-strong text-ink">{t("home.needsApproval")}</div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-fine text-ink-tertiary">✓ {t("home.allCaughtUp")}</p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Donut segments={segments} size={104} />
            <ul className="flex flex-col gap-1 text-fine">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${s.colorVar})` }} />
                  <span className="text-ink-secondary">{t(`inbox.kind.${s.key}` as never)}</span>
                  <span className="ml-auto text-ink-tertiary">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <ul className="flex flex-col gap-1.5">
            {items.map((a) => (
              <li key={`${a.kind}:${a.id}`}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSelect(a.map_id); }}
                  className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface px-3 py-2 text-left hover:bg-surface-alt"
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{a.map_name}</span>
                  {a.version_number != null && <span className="shrink-0 text-fine text-ink-tertiary">v{a.version_number}</span>}
                  <span className="shrink-0 text-fine text-ink-tertiary">{a.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

> 주의: `inbox.kind.<kind>` i18n 키가 dev에 이미 있는지 확인(인박스 카테고리 작업 산출물). 없으면 `home.approvalKind.<kind>` 3키를 en/ko 추가.

- [ ] **Step 3: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/components/maps/approvals-card.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(home): needs-approval card (kind donut + queue) — 승인 필요 카드"
```

---

### Task 10: `home-dashboard.tsx` 조립 + page.tsx 우측 배선 + 선택 자동펼침

**Files:**
- Create: `frontend/src/components/maps/home-dashboard.tsx`
- Modify: `frontend/src/app/page.tsx` (우측 aside: 미선택→대시보드 / 선택→기존 MapDetailCard; 선택 시 좌측 아코디언 자동펼침)

**Interfaces:**
- Consumes: `RecentOpenedList`(Task 7), `StatusDonutCard`(Task 8), `ApprovalsCard`(Task 9), `MapSummary`.
- Produces: `interface HomeDashboardProps { maps: MapSummary[]; onSelect: (id: number) => void }` · `function HomeDashboard(props): JSX.Element`.

- [ ] **Step 1: Implement `home-dashboard.tsx`**

```tsx
// 홈 우측 — 미선택 시 대시보드. 최상단 최근 열람 + (내 문서 도넛 | 승인 필요) 2단.
"use client";

import type { MapSummary } from "@/lib/api";
import { RecentOpenedList } from "@/components/maps/recent-opened-list";
import { StatusDonutCard } from "@/components/maps/status-donut-card";
import { ApprovalsCard } from "@/components/maps/approvals-card";

interface HomeDashboardProps { maps: MapSummary[]; onSelect: (id: number) => void }

export function HomeDashboard({ maps, onSelect }: HomeDashboardProps) {
  return (
    <div data-id="home-dashboard" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <RecentOpenedList maps={maps} onSelect={onSelect} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StatusDonutCard maps={maps} onSelect={onSelect} />
        <ApprovalsCard onSelect={onSelect} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire right aside in page.tsx**

`page.tsx`의 우측 `<aside data-id="map-detail-aside">` 내부(현재 `effectiveSelected !== null ? <MapDetailCard/> : <div>{home.detailEmpty}</div>`)에서 미선택 분기를 `HomeDashboard`로 교체. `visibleMaps`(권한 있는 전체)를 넘긴다:

```tsx
{effectiveSelected !== null ? (
  <MapDetailCard key={effectiveSelected} mapId={effectiveSelected} ... />
) : (
  <HomeDashboard maps={visibleMaps} onSelect={setSelectedId} />
)}
```

import: `import { HomeDashboard } from "@/components/maps/home-dashboard";`. `home.detailEmpty` 문자열은 더 이상 미사용이면 그대로 두되(다른 곳 참조 없으면) 제거는 하지 않음(surgical).

- [ ] **Step 3: Selected → auto-expand left accordion**

맵 선택(`selectedId`) 시 좌측 아코디언이 그 맵의 부서 경로를 펼치도록. 선택된 맵의 `owning_department`를 조상 경로로 확장해 `orgOpen`에 합집합. effect 내 setState는 `selectedId` 변화에 반응(파생 불가 — 사용자 액션):

```tsx
useEffect(() => {
  if (selectedId == null) return;
  const m = visibleMaps.find((x) => x.id === selectedId);
  const dept = m?.owning_department;
  if (!dept) return;
  const parts = dept.split("/");
  const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setOrgOpen((prev) => new Set([...prev, ...paths])); // reveal selected map's dept
}, [selectedId, visibleMaps]);
```

(스크롤/하이라이트: `highlightId`는 기존 복사 강조용 — 여기선 아코디언 펼침으로 충분. 필요 시 선택 카드 `scrollIntoView`는 후속.)

- [ ] **Step 4: Verify build + browser**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 0 errors.

Playwright(`frontend/scripts/pw-verify-home-dashboard.mjs` 신설): 미선택 홈에서 `[data-id=home-dashboard]`·`[data-id=home-recent]`·`[data-id=home-my-documents]`·`[data-id=home-needs-approval]` 존재, `[data-id=dashboard-map-row]` hover 시 `[data-id=dashboard-map-open]` 노출, 행 클릭 시 우측이 MapDetailCard로 전환 + 좌측 해당 부서 펼침, 도넛 세그먼트 클릭 시 목록 변경 확인.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/maps/home-dashboard.tsx frontend/src/app/page.tsx
git commit -m "feat(home): assemble right dashboard + auto-expand on select — 우측 대시보드 조립·선택 자동펼침"
```

---

# Phase C — Feedback

### Task 11: Feedback 페이지 딥링크 `?feedback=<id>`

**Files:**
- Modify: `frontend/src/app/feedback/page.tsx`

**Interfaces:**
- Consumes: `useSearchParams`·`useRouter`(next/navigation), 기존 `selectedId` state·`FeedbackDetailModal`.
- Produces: URL `?feedback=<id>` → 마운트 시 모달 자동 오픈. Task 12가 이 링크로 이동.

- [ ] **Step 1: Seed selectedId from query param**

`feedback/page.tsx`에 추가(기존 `selectedId` state 아래). 목록 로드 후 param의 id가 존재하면 선택:

```tsx
const searchParams = useSearchParams();
const router = useRouter();
const seededDeepLink = useRef(false);
useEffect(() => {
  if (seededDeepLink.current) return;
  const raw = searchParams.get("feedback");
  if (!raw) return;
  const id = Number(raw);
  if (!Number.isFinite(id)) return;
  if (!items.some((f) => f.id === id)) return; // 목록 로드 후에만 매칭
  seededDeepLink.current = true;
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setSelectedId(id); // open modal from deep link once list is loaded
}, [searchParams, items]);
```

(import: `import { useRouter, useSearchParams } from "next/navigation";` `import { useEffect, useRef } from "react";` 병합.)

- [ ] **Step 2: Clear param on modal close**

모달 `onClose`에서 param 제거(새로고침 재오픈 방지):

```tsx
onClose={() => {
  setSelectedId(null);
  if (searchParams.get("feedback")) router.replace("/feedback");
}}
```

- [ ] **Step 3: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/app/feedback/page.tsx
git commit -m "feat(feedback): deep-link ?feedback=<id> opens detail modal — 피드백 딥링크"
```

---

### Task 12: Feedback 사이드 패널 — 내 최근 피드백 목록

**Files:**
- Modify: `frontend/src/components/feedback-side-panel.tsx` (작성폼 아래 목록 섹션)
- Modify: `frontend/src/lib/i18n-messages.ts` (`feedback.yourRecent`, `feedback.viewOnPage`)

**Interfaces:**
- Consumes: `listFeedback`·`FeedbackItem`(`@/lib/api`), `getCurrentUser`(`@/lib/current-user`), `useRouter`, `FEEDBACK_STATUS_LABEL/STYLE`·kind 아이콘(`@/lib/feedback-meta`).
- Produces: 패널 하단 최근 목록 — 클릭 시 `/feedback?feedback=<id>` 이동 + 패널 닫기(`onClose`).

- [ ] **Step 1: Add i18n keys** (en `"feedback.yourRecent": "Your recent feedback"`, `"feedback.viewOnPage": "View"`; ko `"내 최근 피드백"`, `"보러가기"`)

- [ ] **Step 2: Fetch my recent feedback (open 시 1회)**

`feedback-side-panel.tsx` 본문에 추가(패널 `open` prop true일 때 fetch):

```tsx
const router = useRouter();
const [recent, setRecent] = useState<FeedbackItem[]>([]);
useEffect(() => {
  if (!open) return;
  const me = getCurrentUser();
  let active = true;
  void listFeedback().then((list) => {
    if (!active) return;
    const mine = list.items.filter((f) => f.author === me?.login_id).slice(0, 5);
    setRecent(mine);
  }).catch(() => {});
  return () => { active = false; };
}, [open]);
```

(정확한 `FeedbackList` 형태·`getCurrentUser()` 반환 login 필드명은 구현 시 Read로 확인 — `me?.login_id` 또는 `me?.id`.)

- [ ] **Step 3: Render list under compose form**

작성폼 컨테이너 하단(Cancel/Submit 푸터 아래 또는 위, 남는 공간)에 삽입:

```tsx
{recent.length > 0 && (
  <div className="mt-4 flex flex-col gap-2 border-t border-divider pt-3">
    <div className="text-fine text-ink-tertiary">{t("feedback.yourRecent")}</div>
    <ul className="flex flex-col gap-1.5">
      {recent.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onClick={() => { router.push(`/feedback?feedback=${f.id}`); onClose(); }}
            className="flex w-full items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-left hover:bg-surface-alt"
          >
            <span className="min-w-0 flex-1 truncate text-fine text-ink">{f.body}</span>
            <span className={`shrink-0 rounded-sm border px-1 text-fine ${FEEDBACK_STATUS_STYLE[f.status]}`}>
              {t(FEEDBACK_STATUS_LABEL[f.status])}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </div>
)}
```

(import: `listFeedback, type FeedbackItem` from `@/lib/api`; `getCurrentUser` from `@/lib/current-user`; `useRouter` from `next/navigation`; `FEEDBACK_STATUS_LABEL, FEEDBACK_STATUS_STYLE` from `@/lib/feedback-meta`.)

- [ ] **Step 4: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/components/feedback-side-panel.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(feedback): recent feedback list in side panel — 작성 하단 최근 피드백"
```

---

# Phase D — Inbox / Notices 미선택 다이제스트

### Task 13: `activity-digest.tsx` 공용 다이제스트 뷰

**Files:**
- Create: `frontend/src/components/activity-digest.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`digest.selectHint`)

**Interfaces:**
- Produces:
  - `interface DigestStat { icon: React.ReactNode; label: string; count: number }`
  - `interface ActivityDigestProps { title: string; stats: DigestStat[]; unreadCount?: number; hint?: string; children?: React.ReactNode }`
  - `function ActivityDigest(props): JSX.Element`

- [ ] **Step 1: Add i18n key** (en `"digest.selectHint": "Select an item to view"`, ko `"항목을 선택하세요"`)

- [ ] **Step 2: Implement**

```tsx
// 미선택 우측 공용 다이제스트 — 카테고리별 건수 + 미읽음 + 힌트. Inbox/Notices 공유.
"use client";

interface DigestStat { icon: React.ReactNode; label: string; count: number }
interface ActivityDigestProps {
  title: string;
  stats: DigestStat[];
  unreadCount?: number;
  hint?: string;
  children?: React.ReactNode;
}

export function ActivityDigest({ title, stats, unreadCount, hint, children }: ActivityDigestProps) {
  return (
    <div data-id="activity-digest" className="flex h-full flex-col gap-4 p-6">
      <div className="text-caption-strong text-ink">{title}</div>
      <ul className="flex flex-col gap-2">
        {stats.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-caption">
            <span className="text-ink-tertiary">{s.icon}</span>
            <span className="text-ink-secondary">{s.label}</span>
            <span className="ml-auto text-ink">{s.count}</span>
          </li>
        ))}
      </ul>
      {unreadCount != null && (
        <div className="rounded-sm bg-accent-tint px-3 py-2 text-caption text-accent">Unread: {unreadCount}</div>
      )}
      {children}
      {hint && <p className="mt-auto text-fine text-ink-tertiary">{hint}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
```bash
git add frontend/src/components/activity-digest.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(digest): shared activity digest view — 공용 활동 다이제스트"
```

---

### Task 14: Inbox 미선택 우측 다이제스트 배선

**Files:**
- Modify: `frontend/src/app/inbox/page.tsx` (우측 detail aside 미선택 분기 — 탭별)

**Interfaces:**
- Consumes: `ActivityDigest`(Task 13), 기존 `items`(NotificationItem[])·`approvals`·`getNotificationCategory`·`CATEGORY_ICONS`.

- [ ] **Step 1: Build category stats + replace empty placeholder**

`inbox/page.tsx` 우측 aside(미선택) — `inbox.selectPrompt`/`inbox.approvalsSelectPrompt` div를 다이제스트로 교체. Notifications 탭:

```tsx
const categoryStats = NOTIFICATION_CATEGORIES.map((c) => ({
  icon: (() => { const I = CATEGORY_ICONS[c]; return <I size={14} strokeWidth={1.5} />; })(),
  label: t(`inbox.category.${c}` as never),
  count: items.filter((n) => getNotificationCategory(n.type) === c).length,
}));
```

미선택 렌더:
```tsx
tab === "approvals" ? (
  <ActivityDigest
    title={t("inbox.approvalsTitle")}
    stats={[]}
    hint={t("digest.selectHint")}
  >
    <div className="rounded-sm bg-accent-tint px-3 py-2 text-caption text-accent">
      {approvals.length === 0 ? `✓ ${t("home.allCaughtUp")}` : `${approvals.length}`}
    </div>
  </ActivityDigest>
) : (
  <ActivityDigest
    title={t("inbox.notificationsTitle")}
    stats={categoryStats}
    unreadCount={unread}
    hint={t("digest.selectHint")}
  />
)
```

(사용하는 `inbox.category.<c>`·`inbox.approvalsTitle`·`inbox.notificationsTitle` 키가 dev에 이미 있는지 확인 — 없으면 en/ko 추가. `CATEGORY_ICONS`는 이미 `inbox/page.tsx` 내부에 정의됨.)

- [ ] **Step 2: Verify build + browser**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Playwright(`pw-verify-inbox-digest.mjs`): 미선택 상태에서 `[data-id=activity-digest]` 존재, 카테고리 건수 표시, 탭 전환 시 승인/알림 다이제스트 전환.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/inbox/page.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(inbox): activity digest on empty right pane — 인박스 미선택 다이제스트"
```

---

### Task 15: Notices 미선택 우측 다이제스트 배선

**Files:**
- Modify: `frontend/src/app/notices/page.tsx` (우측 `notice-detail-aside` 미선택 분기)

**Interfaces:**
- Consumes: `ActivityDigest`(Task 13), 기존 notices 목록·읽음 캐시(`notices-read`)·중요 플래그.

- [ ] **Step 1: Build stats + replace `notices.selectPrompt`**

`notices/page.tsx`에서 미선택 placeholder(`:230` 영역)를 교체. 미읽음/전체 + 최신 중요 1건:

```tsx
<ActivityDigest
  title={t("notices.title")}
  stats={[
    { icon: <List size={14} strokeWidth={1.5} />, label: t("notices.filterAll"), count: notices.length },
    { icon: <CircleAlert size={14} strokeWidth={1.5} />, label: t("notices.important"), count: notices.filter((n) => n.important).length },
  ]}
  unreadCount={unreadCount}
  hint={t("digest.selectHint")}
>
  {latestImportant && (
    <button
      type="button"
      onClick={() => setSelectedId(latestImportant.id)}
      className="rounded-sm border border-hairline bg-surface px-3 py-2 text-left hover:bg-surface-alt"
    >
      <div className="text-fine text-error">{t("notices.important")}</div>
      <div className="truncate text-caption text-ink">{latestImportant.title}</div>
    </button>
  )}
</ActivityDigest>
```

(정확한 notices 목록 state명·`important` 필드·`unreadCount`·`title` 필드·`setSelectedId`는 구현 시 Read로 확인. `latestImportant` = 중요 표시 최신 1건 파생. 아이콘 `List`/`CircleAlert`는 파일에 이미 import됨.)

- [ ] **Step 2: Verify build + browser**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Playwright(`pw-verify-notices-digest.mjs`): 미선택 시 `[data-id=activity-digest]`·건수·최신 중요 카드, 클릭 시 해당 공지 선택.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/notices/page.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(notices): activity digest on empty right pane — 공지 미선택 다이제스트"
```

---

# Final: 통합 검증 + PROGRESS

### Task 16: 전체 게이트 + PROGRESS 갱신

- [ ] **Step 1: Full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: 0 errors, 모든 vitest PASS(신규 org-tree·donut-geometry·recent-order 포함).

- [ ] **Step 2: Backend gate (회귀 없음 확인 — 백엔드 무변경이지만 확인)**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: 기존과 동일 PASS(변경 없음).

- [ ] **Step 3: Full browser smoke**

모든 `pw-verify-*.mjs`(org-accordion·home-dashboard·inbox-digest·notices-digest + feedback 딥링크 수동) 실기동 통과, 콘솔 에러 0. 데모 시드 필요(`docs/db-seed.md`).

- [ ] **Step 4: Update PROGRESS + commit**

`PROGRESS.md` 최상단 설계 항목을 "구현 완료"로 갱신(게이트 결과·커밋 범위 기록).

```bash
git add PROGRESS.md
git commit -m "docs(progress): main-tabs UX refresh implemented + verified — 구현 완료 기록"
```

---

## Self-Review (plan author)

- **Spec coverage**: §1 좌측 아코디언+즐겨찾기+SP배지 → T1–T4, T2(SP). §2 우측 대시보드(최근/도넛/승인)+hover-open/click-select+자동펼침 → T5–T10. §2b SP 상세 → T2. §3 Feedback 최근+딥링크 → T11–T12. §4 Inbox 다이제스트 → T13–T14. §5 Notices 다이제스트 → T13,T15. Cross-cutting(i18n/토큰/컴파일러) → Global Constraints + 각 태스크. 검증 → T16. **전 항목 커버.**
- **Placeholder scan**: 순수 로직(T1/T5/T7)은 완전한 test+impl 코드. UI 태스크는 실제 prop interface + JSX + 검증 명령. "구현 시 Read로 확인"은 기존 파일의 정확한 필드명 앵커링용(플레이스홀더 아님) — 해당 필드는 인터페이스에 이미 명시.
- **Type consistency**: `OrgNode`(T1)→T3 사용, `DonutSegment`/`computeDonutArcs`(T5)→T8/T9, `DashboardMapRow`(T6)→T7/T8, `readTopChanged`(T7)→recent-list, `ActivityDigest`(T13)→T14/T15. 명칭 일치.
- **미해결 앵커(구현자 확인 필요, 인터페이스는 확정)**: `getCurrentUser()` login 필드명, `FeedbackList` 형태, notices state 필드명, dev의 `inbox.category.*`/`inbox.kind.*` i18n 키 존재 여부, `globals.css` 상태 토큰(`--color-warning`/`success` 등) 존재 여부. 각 태스크에 확인 지점 명시.
