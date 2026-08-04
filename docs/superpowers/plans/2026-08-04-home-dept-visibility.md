# 홈 부서 가시성·시인성 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 좌측 조직도에서 맵 카드 폭을 부서 깊이와 무관하게 통일하고, 첫 진입 시 내 부서 카드 한 곳으로 시선이 모이게 한다.

**Architecture:** 부서 헤더를 고정폭 필 체인으로 바꿔 계층 단서를 들여쓰기에서 필 정렬로 옮긴다. 맵 카드에서 `paddingLeft`를 제거해 전 depth 417px로 통일하고, 맵을 가진 부서 헤더만 `sticky top-0`으로 고정해 귀속을 유지한다. 첫 진입 중복 렌더는 "내 부서 맵이 있으면 조직도 시드 생략"으로 없애고, 접힘 상태는 `localStorage`로 분리해 새로고침에도 유지한다.

**Tech Stack:** Next.js (App Router) · React 19 + React Compiler · TypeScript strict · Tailwind v4 `@theme` 토큰 · vitest · playwright-core + 시스템 Chrome

**설계 문서:** `docs/design/2026-08-04-home-dept-visibility-design.md` — 구현 중 판단이 필요하면 이 문서가 기준이다.

## Global Constraints

- **작업 브랜치는 `feat/home-dept-visibility`** (이미 생성됨, 설계 커밋 `8cc558c`). 저장소 루트 `/Users/hyeonjin/Documents/bpm`.
- **Raw hex 금지** — 색은 토큰 클래스(`bg-surface`, `text-ink-secondary`, `bg-accent-tint`, `border-hairline`, `border-accent-tint-border`, `text-accent`, `text-ink-tertiary`)로만 (`rules/frontend/design.md` §1).
- **UI 문자열은 영어**, 주석·설명은 한글. 이모지 금지 → Lucide 16px(작은 보조는 12–14px) / `strokeWidth={1.5}` (`rules/frontend/design.md` §5).
- **타입스크립트 strict** — `any` 금지, `@ts-ignore` 금지. `interface`로 props 정의 (`rules/languages/typescript.md`).
- **함수명은 동사로 시작** (`rules/common/naming.md`). React 컴포넌트만 PascalCase 명사 허용.
- **React Compiler** — `useCallback`/`useMemo`의 추론 deps와 선언 deps가 어긋나면 `npm run lint`/`build`가 `react-hooks/preserve-manual-memoization`으로 실패한다. **새 핸들러는 평범한 함수로 둔다** (`frontend/AGENTS.md`).
- **커밋 메시지 형식**: `type(scope): English summary — 한국어 요약` (`rules/common/git.md`). 각 커밋 끝에 아래 2줄을 붙인다.

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
  ```

- **`PROGRESS.md`는 코드와 같은 커밋에** 갱신한다 (`rules/common/git.md`). 마지막 Task에서 일괄이 아니라 **각 Task 커밋마다 한 줄씩** 추가한다.
- 모든 명령은 `frontend/`에서 실행한다(명시적으로 다른 디렉터리를 지정한 경우 제외).

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `frontend/src/lib/org-tree.ts` | 조직도 순수 로직 | **추가** — `collectPillChain` (기존 함수 무변경) |
| `frontend/src/lib/org-tree.test.ts` | 위 단위 테스트 | **추가** — `collectPillChain` describe 블록 |
| `frontend/src/components/maps/org-accordion.tsx` | 조직도 아코디언 렌더 | **전면 개편** — 필 체인·카드 풀폭·sticky·렌더 순서 |
| `frontend/src/components/maps/map-card.tsx` | 맵 카드 | **부분 수정** — `ownerAndTime` → `renderOwnerAndTime(recent)`, 최근접속 레이어 반전 |
| `frontend/src/app/page.tsx` | 홈 페이지 상태·배선 | **부분 수정** — 시드 조건부·이동, 접힘 상태 localStorage 영속, 토글 핸들러 |
| `frontend/scripts/pw-smoke-home-dept.mjs` | 브라우저 스모크 | **신규** |

`org-accordion.tsx`는 113줄로 작고 책임이 하나(조직도 렌더)라 분할하지 않는다. `page.tsx`(876줄)는 홈의 상태 소유자로서 기존 구조를 따르고 새 파일을 만들지 않는다.

---

### Task 1: `collectPillChain` 순수 함수

필 체인 병합 규칙을 컴포넌트에 인라인하지 않고 순수 함수로 분리해 단위 테스트 가능하게 만든다.

**Files:**
- Modify: `frontend/src/lib/org-tree.ts` (파일 끝에 추가)
- Test: `frontend/src/lib/org-tree.test.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: 기존 `OrgNode` 인터페이스 (`org-tree.ts:6-13`) — `{ path, name, koreanName, children, maps, mapCount }`
- Produces: `collectPillChain(node: OrgNode): OrgNode[]` — Task 2가 import한다. 반환 배열은 **항상 길이 ≥ 1**이고 **첫 원소는 인자 `node` 자신**, **마지막 원소가 터미널**(그 행의 `mapCount`·`maps`·`children`을 소유).

> **기존 `collectSingleChildChain`은 절대 수정하지 말 것.** `org-tree.test.ts:79-84`의 "continues through nodes that hold their own maps (unconditional chaining)" 테스트는 의도적으로 옳다. 자동펼침(어느 노드가 *열리는가*)과 필 병합(어느 노드가 *같은 행에 그려지는가*)은 독립 관심사다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/src/lib/org-tree.test.ts` 맨 끝에 추가:

```ts
describe("collectPillChain", () => {
  it("merges pass-through nodes into one row", () => {
    // Div → Sub(유일 자식·맵 없음) → Team(유일 자식·맵 없음) → {A, B} 분기에서 멈춤
    const maps = [makeMap(1, "Div/Sub/Team/A"), makeMap(2, "Div/Sub/Team/B")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual([
      "Div",
      "Div/Sub",
      "Div/Sub/Team",
    ]);
  });

  it("stops at a node that holds its own maps", () => {
    // Sub가 직속 맵을 가지면 병합 중단 — 병합하면 그 맵이 뒤쪽 필 소속으로 보인다.
    // 같은 트리에서 collectSingleChildChain은 계속 내려간다(규칙이 의도적으로 다름).
    const maps = [makeMap(1, "Div/Sub"), makeMap(2, "Div/Sub/Team/Leaf")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual(["Div", "Div/Sub"]);
  });

  it("returns the node alone when it branches or is a leaf", () => {
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeB")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual(["Div"]); // 하위 2개 — 분기
    const leaf = roots[0].children[0];
    expect(collectPillChain(leaf).map((n) => n.path)).toEqual([leaf.path]); // 말단
  });
});
```

같은 파일 3행의 import에 `collectPillChain`을 추가한다:

```ts
import { buildOrgTree, collectPillChain, collectSingleChildChain, filterMyDeptMaps, type OrgNode } from "@/lib/org-tree";
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test -- org-tree`
Expected: FAIL — `collectPillChain is not a function` (또는 import 해석 실패)

- [ ] **Step 3: 최소 구현을 넣는다**

`frontend/src/lib/org-tree.ts` 맨 끝에 추가:

```ts
// 렌더용 필 체인 — "통과만 하는" 노드(자기 맵 없이 자식 1개)를 이어붙여 한 행에 그릴 부서 목록을 만든다.
// 마지막 원소가 터미널로, 그 행의 카운트·맵·자식을 소유한다. 자기 맵을 가진 노드에서 멈추는 이유는
// 병합하면 그 맵이 뒤쪽 필에 속한 것처럼 보이기 때문. 자동펼침용 collectSingleChildChain과는
// 규칙이 의도적으로 다르다(그쪽은 맵 보유와 무관하게 계속 내려간다).
export function collectPillChain(node: OrgNode): OrgNode[] {
  const chain = [node];
  let cur = node;
  while (cur.maps.length === 0 && cur.children.length === 1) {
    cur = cur.children[0];
    chain.push(cur);
  }
  return chain;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test -- org-tree`
Expected: PASS — `collectPillChain` 3케이스 포함 전부 초록. 기존 `collectSingleChildChain` 3케이스도 그대로 초록이어야 한다(하나라도 빨개지면 기존 함수를 건드린 것 — 되돌린다).

- [ ] **Step 5: 커밋**

`PROGRESS.md`의 `## 2026-08-04 — 홈 부서 가시성·시인성 개선 설계` 섹션 끝에 한 줄 추가:

```markdown
- 구현: `collectPillChain` 순수 함수(통과 노드 병합·맵 보유 시 중단) + 단위 테스트 3종.
```

```bash
git add frontend/src/lib/org-tree.ts frontend/src/lib/org-tree.test.ts PROGRESS.md
git commit -F - <<'EOF'
feat(home): add collectPillChain for dept row merging — 부서 행 병합용 필 체인 순수 함수

통과만 하는 노드(자기 맵 없이 자식 1개)를 한 행에 이어 그리기 위한 병합 규칙.
자동펼침용 collectSingleChildChain과 달리 맵 보유 노드에서 멈춘다 — 병합하면
그 맵이 뒤쪽 필 소속으로 보이기 때문.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 2: 조직도 아코디언 재구성

부서 헤더를 고정폭 필 체인으로 바꾸고, 맵 카드 들여쓰기를 제거하고, 맵을 가진 헤더만 sticky로 만들고, 자기 맵을 자식보다 먼저 렌더한다.

**Files:**
- Modify: `frontend/src/components/maps/org-accordion.tsx` (전체 교체)

**Interfaces:**
- Consumes: Task 1의 `collectPillChain(node: OrgNode): OrgNode[]`
- Produces: DOM 계약 — Task 5의 스모크가 의존한다.
  - `[data-id="org-node-toggle"]` · `data-path="<첫 노드 path>"` · `aria-expanded="true"|"false"` · 열린 sticky 행에만 `data-sticky="true"`
  - `[data-id="org-unassigned-toggle"]` · `aria-expanded` · 열렸을 때 `data-sticky="true"`
  - 맵 카드는 depth 무관 동일 폭(`[data-id="map-card"]`)
- `OrgAccordionProps` 인터페이스는 **변경하지 않는다** — `page.tsx`의 호출부가 그대로 동작해야 한다.

- [ ] **Step 1: 파일을 통째로 교체한다**

`frontend/src/components/maps/org-accordion.tsx` 전체를 아래로 바꾼다:

```tsx
// 홈 좌측 — owning department 조직도 아코디언. 부서명은 고정폭 필, 자기 맵 없이 자식이 1개뿐인
// 구간은 한 행에 병합하고, 맵 카드는 depth 무관 풀폭으로 그린다.
// 설계: docs/design/2026-08-04-home-dept-visibility-design.md
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import { collectPillChain, type OrgNode } from "@/lib/org-tree";
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
  // 부서 미지정 섹션 접기 — 부서 노드와 동일한 토글 UX. 상태는 page.tsx가 보유(Collapse all에 함께 반응).
  unassignedOpen: boolean;
  onToggleUnassigned: () => void;
  // 좁은 화면(<split)에서도 상세를 볼 수 있도록 카드 렌더를 페이지에 위임 — 미지정 시 bare MapCard로 폴백.
  // Delegates card render to the page so narrow screens keep an inline detail accordion — falls back to bare MapCard.
  renderCard?: (map: MapSummary) => ReactNode;
}

// 부서명 필 — 폭 고정(96px)이라 같은 depth의 필이 세로로 정렬되어, 카드를 들여쓰지 않고도 계층이 읽힌다.
// truncate가 긴 부서명을 자르므로 title은 필수.
function DeptPill({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      title={name}
      className={`w-24 shrink-0 truncate rounded-full border px-2 py-0.5 text-center text-fine ${
        active
          ? "border-accent-tint-border bg-accent-tint text-accent"
          : "border-hairline bg-surface text-ink-secondary"
      }`}
    >
      {name}
    </span>
  );
}

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const {
    roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId,
    onSelect, unassignedOpen, onToggleUnassigned, renderCard,
  } = props;

  // 맵 목록 — 들여쓰기 없음(전 depth 동일 폭). 부서 노드와 미지정 섹션이 공유.
  const renderMapList = (maps: MapSummary[]) => (
    <ul className="flex flex-col gap-2 pt-2">
      {maps.map((m) => (
        <li key={m.id}>
          {renderCard
            ? renderCard(m)
            : <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );

  const renderNode = (node: OrgNode, depth: number) => {
    // 열림 판정·토글은 체인의 첫 노드 path — 터미널 path로 판정하면 접기(page.tsx가 첫 path만 삭제)가
    // 먹지 않는 죽은 행이 된다.
    const open = openPaths.has(node.path);
    const chain = collectPillChain(node);
    const terminal = chain[chain.length - 1];
    // 자기 맵을 가진 행만 sticky — 순수 네비 행까지 sticky면 4단계가 계단식으로 쌓여 높이를 잠식한다.
    // 전부 같은 top-0이라 나중 헤더가 앞 헤더를 덮어 화면에 보이는 sticky는 항상 1개.
    const sticky = open && terminal.maps.length > 0;
    // sticky 행은 조상이 스크롤 밖으로 나가므로 경로를 흐린 breadcrumb으로 동반한다(필보다 좁게).
    const ancestors = sticky ? node.path.split("/").slice(0, -1) : [];
    return (
      <li key={node.path} className="flex flex-col">
        <button
          type="button"
          data-id="org-node-toggle"
          data-path={node.path}
          data-sticky={sticky ? "true" : undefined}
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          // sticky 행은 들여쓰지 않는다 — breadcrumb이 경로를 담아 중복이고, 가장 넓은 행이라 폭이 아쉽다.
          style={sticky ? undefined : { paddingLeft: `${depth * 12 + 4}px` }}
          className={`group flex items-center gap-1 rounded-sm py-1 text-left hover:bg-surface-alt ${
            sticky ? "sticky top-0 z-10 border-b border-hairline bg-surface px-1" : ""
          }`}
        >
          {open
            ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
          {ancestors.length > 0 && (
            // min-w-0 + shrink — 폭이 모자라면 필이 아니라 breadcrumb이 먼저 줄어든다.
            <span className="flex min-w-0 shrink items-center gap-1 text-fine text-ink-tertiary">
              {ancestors.map((seg) => (
                <span key={seg} className="flex min-w-0 items-center gap-1">
                  <span className="max-w-[4.5rem] truncate" title={seg}>{seg}</span>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </span>
          )}
          {chain.map((n, i) => (
            <span key={n.path} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
              <DeptPill name={n.name} active={open} />
            </span>
          ))}
          <span className="ml-auto shrink-0 pl-1 text-fine text-ink-tertiary">({terminal.mapCount})</span>
        </button>
        {open && (
          <div className="flex flex-col gap-2">
            {/* 자기 맵을 자식보다 먼저 — 반대면 손자 카드가 헤더와 자기 맵 사이에 통째로 끼어들어
                sticky 헤더가 자기 것 아닌 카드를 덮는다. */}
            {terminal.maps.length > 0 && renderMapList(terminal.maps)}
            {terminal.children.length > 0 && (
              <ul className="flex flex-col">{terminal.children.map((c) => renderNode(c, depth + 1))}</ul>
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
          <button
            type="button"
            data-id="org-unassigned-toggle"
            data-sticky={unassignedOpen ? "true" : undefined}
            aria-expanded={unassignedOpen}
            onClick={(e) => { e.stopPropagation(); onToggleUnassigned(); }}
            className={`group flex items-center gap-1 rounded-sm px-1 py-1 text-left hover:bg-surface-alt ${
              unassignedOpen ? "sticky top-0 z-10 border-b border-hairline bg-surface" : ""
            }`}
          >
            {unassignedOpen
              ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
              : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
            <DeptPill name={t("home.unassignedDept")} active={unassignedOpen} />
            <span className="ml-auto shrink-0 pl-1 text-fine text-ink-tertiary">({unassigned.length})</span>
          </button>
          {unassignedOpen && renderMapList(unassigned)}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 타입·린트를 확인한다**

Run: `npx tsc --noEmit`
Expected: 에러 0. (`npm run build`/`vitest`는 테스트 파일 타입 에러를 못 잡으므로 `tsc`를 별도로 돌린다.)

Run: `npm run lint`
Expected: 에러 0, 경고 0.

- [ ] **Step 3: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `npm run test`
Expected: 전부 PASS (이 Task는 렌더 변경이라 신규 단위 테스트 없음 — 시각 검증은 Task 5의 브라우저 스모크가 담당).

- [ ] **Step 4: 커밋**

`PROGRESS.md` 같은 섹션에 추가:

```markdown
- 구현: 조직도 아코디언 재구성 — 부서명 고정폭 필 체인(단일자식 병합)·맵 카드 들여쓰기 제거(전 depth 동일 폭)·맵 보유 행만 sticky 경로 헤더(조상 breadcrumb 동반)·자기 맵을 자식보다 먼저 렌더.
```

```bash
git add frontend/src/components/maps/org-accordion.tsx PROGRESS.md
git commit -F - <<'EOF'
feat(home): pill-chain dept rows + full-width map cards — 부서 필 체인·카드 풀폭·sticky 경로 헤더

들여쓰기가 depth마다 카드 폭을 잠식하던 문제(401~365px)를 카드 들여쓰기 제거로 통일하고,
계층 단서는 고정폭 필의 세로 정렬로 옮긴다. 귀속은 맵 보유 행만 sticky로 고정해 유지하며,
전부 같은 top-0이라 계단식 높이 잠식이 없다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 3: 맵 카드 최근접속 표시 반전

항상 떠 있던 "Recent" 배지를 호버 시로 옮기고, 기본 상태에서는 시계 칩(accent + tint 배경) 하나로만 최근 접속을 표시한다.

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx:112-132` (`ownerAndTime` 상수 → `renderOwnerAndTime` 함수)
- Modify: `frontend/src/components/maps/map-card.tsx:203-220` (겹침 레이어 반전)

**Interfaces:**
- Consumes: 없음 (컴포넌트 내부 변경)
- Produces: DOM 계약 — `[data-id="map-card-recent-badge"]`는 유지하되, 그 안의 최근 접속 필에 `[data-id="map-card-recent-pill"]`, 기본 노출되는 시계 칩에 `[data-id="map-card-updated-chip"]`를 새로 부여한다. Task 5가 두 요소의 `opacity`로 반전을 검증한다.

- [ ] **Step 1: `ownerAndTime`을 `recent` 플래그를 받는 함수로 바꾼다**

`map-card.tsx:112-132`의 아래 블록을

```tsx
  // 오너·수정시각 메타 — 최근 카드는 기본을 배지로 대체하고 카드 호버 시 이걸 노출 / owner + updated meta
  const ownerAndTime = (
    <>
```

...부터 해당 `</>` + `);` 까지를 다음으로 교체한다(내부 오너 표시 블록은 그대로 두고, 시계 span에만 칩 스타일을 조건부로 얹는다):

```tsx
  // 오너·수정시각 메타 — 기본 노출. recent면 시계 칩만 accent+tint로 강조해 "최근 열람"을 표시한다
  // (배지를 상시 띄우는 대신 시계 하나로 압축, 상세는 호버 시 교체) / owner + updated meta
  const renderOwnerAndTime = (recent: boolean) => (
    <>
      {(map.owner_name ?? map.created_by) && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <User size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">{map.owner_name ?? map.created_by}</span>
          {/* owner_name null = 디렉터리에 없는 오너(퇴사) — id 폴백 + 배지 */}
          {!map.owner_name && map.created_by && (
            <span className="shrink-0 rounded-sm border border-hairline px-1 text-fine text-error">
              {t("perm.badgeDeparted")}
            </span>
          )}
        </span>
      )}
      <span
        data-id="map-card-updated-chip"
        title={recent ? t("home.recentBadge") : undefined}
        className={`inline-flex shrink-0 items-center gap-1 ${
          recent ? "rounded-full bg-accent-tint px-2 py-0.5 text-accent" : ""
        }`}
      >
        <Clock size={12} strokeWidth={1.5} />
        {relativeTime(map.updated_at)}
      </span>
    </>
  );
```

- [ ] **Step 2: 겹침 레이어를 뒤집는다**

`map-card.tsx:203-220`의 삼항 전체(`{recentOpenedAt !== undefined ? ( ... ) : ( ownerAndTime )}`)를 다음으로 교체한다:

```tsx
          {recentOpenedAt !== undefined ? (
            // 최근 열람 맵 — 기본은 오너/수정시각(시계 칩만 accent), 호버 시 최근 접속 기록으로 교체.
            // 두 텍스트를 같은 그리드 셀에 겹쳐 박스를 더 넓은 쪽 폭으로 고정 → 교체 시 폭 점프 없음.
            <div data-id="map-card-recent-badge" className="grid w-fit items-center">
              <div className="col-start-1 row-start-1 flex items-center gap-2 whitespace-nowrap transition-opacity duration-350 ease-smooth group-hover:opacity-0">
                {renderOwnerAndTime(true)}
              </div>
              <span
                data-id="map-card-recent-pill"
                className="col-start-1 row-start-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-accent-tint px-2 py-0.5 text-accent opacity-0 transition-opacity duration-350 ease-smooth group-hover:opacity-100"
              >
                <Clock size={12} strokeWidth={1.5} />
                {t("home.recentBadge")} · {relativeTime(new Date(recentOpenedAt).toISOString())}
              </span>
            </div>
          ) : (
            renderOwnerAndTime(false)
          )}
```

- [ ] **Step 3: 타입·린트를 확인한다**

Run: `npx tsc --noEmit && npm run lint`
Expected: 둘 다 에러 0. (`ownerAndTime` 식별자가 남아 있으면 `tsc`가 잡는다 — 참조가 2곳뿐이므로 전부 `renderOwnerAndTime(...)`으로 바뀌어야 한다.)

- [ ] **Step 4: 회귀가 없는지 확인한다**

Run: `npm run test`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

`PROGRESS.md` 같은 섹션에 추가:

```markdown
- 구현: 맵 카드 최근접속 표시 반전 — 기본은 오너/수정시각(시계 칩 accent+tint)·호버 시 `Recent · N ago` 필로 교체(겹침 그리드 유지로 폭 점프 없음).
```

```bash
git add frontend/src/components/maps/map-card.tsx PROGRESS.md
git commit -F - <<'EOF'
feat(home): invert recent-opened badge to hover — 최근접속 표시 호버 반전

상시 배지가 오너/수정시각을 가려 카드 메타가 한눈에 안 들어오던 문제.
기본은 오너/수정시각을 보여주고 최근 열람은 시계 칩(accent+tint) 하나로만 표시,
상세한 접속 시각은 호버 시 노출한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 4: 진입 포커스 + 접힘 상태 영속화

내 부서 맵이 있으면 조직도를 접힌 채로 시작하고, 접힘 상태를 `localStorage`로 분리해 새로고침에도 유지한다.

**Files:**
- Modify: `frontend/src/app/page.tsx` — 모듈 상수 추가(37행 부근), 시드 이펙트 이동·조건부(138-145), sessionStorage 복원/저장에서 접힘 필드 제거(154-229), 토글 핸들러 5곳(698-741)

**Interfaces:**
- Consumes: Task 2의 `OrgAccordionProps`(무변경) — `onToggle(path)` · `onCollapseAll()` · `onToggleUnassigned()`
- Produces: `localStorage["bpm.home.tree"]` = `{ orgOpen: string[], fav: boolean, word: boolean, unassigned: boolean }`. Task 5가 이 키를 읽고 지운다.

- [ ] **Step 1: 저장 키 상수를 추가한다**

`page.tsx:38`의 `STATUS_ORDER` 선언 **바로 아래**에 추가:

```tsx
// 좌측 접힘 상태 영속 키 — 검색·필터(sessionStorage, 새로고침 시 초기화)와 달리 새로고침에도 유지한다.
const TREE_STATE_KEY = "bpm.home.tree";
```

- [ ] **Step 2: 시드 이펙트를 제거하고 복원 이펙트를 넣는다**

`page.tsx:136-145`의 아래 블록 전체를 삭제한다:

```tsx
  // 아코디언 초기 펼침 — 내 org_path 조상 경로를 1회 시드(이후는 사용자 토글만 반영) /
  // seed org accordion expansion from my org_path once when it arrives.
  const seededOrg = useRef(false);
  useEffect(() => {
    if (seededOrg.current || !me?.org_path) return;
    seededOrg.current = true;
    const parts = me.org_path.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setOrgOpen(new Set(paths)); // one-time seed from my org_path
  }, [me]);
```

같은 자리에 다음을 넣는다(시드 본체는 Step 3에서 아래쪽으로 옮긴다):

```tsx
  const seededOrg = useRef(false);

  // 접힘 상태 복원 — localStorage(새로고침에도 유지). 저장값이 있으면 내 부서 시드보다 우선한다.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TREE_STATE_KEY);
      if (!raw) {
        return;
      }
      const s = JSON.parse(raw) as { orgOpen?: unknown; fav?: unknown; word?: unknown; unassigned?: unknown };
      if (Array.isArray(s.orgOpen)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setOrgOpen(new Set(s.orgOpen.filter((x): x is string => typeof x === "string"))); // one-time hydration
        seededOrg.current = true; // 저장값이 시드를 덮어쓰지 않게
      }
      if (typeof s.fav === "boolean") setFavOpen(s.fav);
      if (typeof s.word === "boolean") setWordOpen(s.word);
      if (typeof s.unassigned === "boolean") setUnassignedOpen(s.unassigned);
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);
```

- [ ] **Step 3: 시드를 `myDeptMaps` 선언 아래로 옮기고 조건부로 만든다**

`page.tsx`의 `const myDeptLabel = ...` 줄(현행 411행) **바로 아래**에 추가한다. `myDeptMaps`가 위에서 선언돼야 하므로 반드시 이 위치여야 한다:

```tsx
  // 아코디언 초기 펼침 — 내 부서 섹션이 진입점이므로, 내 부서 맵이 있으면 조직도는 접힌 채로 둔다.
  // me·maps가 모두 도착한 뒤 1회만 판단한다 — 먼저 도착한 쪽만 보고 시드하면 뒤늦게 뜬 My dept 섹션과
  // 조직도가 결국 둘 다 펼쳐진다. deps는 배열 identity가 아닌 길이 스칼라로(refresh()마다 새 참조).
  const hasMyDeptMaps = myDeptMaps.length > 0;
  useEffect(() => {
    if (seededOrg.current || !me?.org_path || maps.length === 0) return;
    seededOrg.current = true;
    if (hasMyDeptMaps) return;
    const parts = me.org_path.split("/");
    const paths = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setOrgOpen(new Set(paths)); // one-time seed from my org_path
  }, [me, maps.length, hasMyDeptMaps]);
```

- [ ] **Step 4: sessionStorage에서 접힘 필드를 걷어낸다**

이중 소스를 남기지 않는다. `page.tsx`의 sessionStorage **복원** 블록에서 아래 타입 필드와 처리 6줄을 삭제한다:

- 타입 리터럴에서 `orgOpen?: unknown;` · `fav?: unknown;` · `word?: unknown;` · `unassigned?: unknown;` 4줄 삭제
- 아래 처리 블록 전체 삭제:

```tsx
      // 좌측 접힘 상태 복원 — 조직도·즐겨찾기·Word 섹션·미지정 (검색·필터와 동일한 SPA 복귀 정책)
      if (Array.isArray(s.orgOpen)) {
        setOrgOpen(new Set(s.orgOpen.filter((x): x is string => typeof x === "string")));
        seededOrg.current = true; // 복원값이 내 부서 시드보다 우선 — 시드가 덮어쓰지 않게
      }
      if (typeof s.fav === "boolean") setFavOpen(s.fav);
      if (typeof s.word === "boolean") setWordOpen(s.word);
      if (typeof s.unassigned === "boolean") setUnassignedOpen(s.unassigned);
```

sessionStorage **저장** 블록의 객체 리터럴에서 `orgOpen: [...orgOpen],` · `fav: favOpen,` · `word: wordOpen,` · `unassigned: unassignedOpen,` 4줄을 삭제하고, 그 이펙트의 deps 배열을 다음으로 줄인다:

```tsx
  }, [mapQuery, visFilter, statusFilter, permFilter, owningFilter]);
```

- [ ] **Step 5: 저장 헬퍼를 추가한다**

`page.tsx`의 `const dismissToast = ...` 선언 **바로 아래**에 추가한다:

```tsx
  // 접힘 상태 저장 — 의존성 이펙트로 저장하면 StrictMode 재마운트에서 초기 default가 저장값을 덮어쓴다.
  // 반드시 토글 핸들러에서 다음 값을 계산해 넘긴다 (설계: docs/design/2026-08-04-home-dept-visibility-design.md §4).
  // C1 시드는 사용자 행동이 아니므로 저장하지 않는다 — 미조작 사용자는 매 진입 같은 규칙으로 재계산된다.
  const writeTree = (org: Set<string>, fav: boolean, word: boolean, unassigned: boolean) => {
    window.localStorage.setItem(
      TREE_STATE_KEY,
      JSON.stringify({ orgOpen: [...org], fav, word, unassigned }),
    );
  };
```

`useCallback`으로 감싸지 않는다 — React Compiler가 메모하고, 감싸면 `preserve-manual-memoization`에 걸릴 수 있다.

- [ ] **Step 6: 토글 핸들러 5곳을 저장과 함께 묶는다**

`MyDeptFavorites`의 `onToggle`:

```tsx
                    onToggle={() => {
                      const next = !favOpen;
                      setFavOpen(next);
                      writeTree(orgOpen, next, wordOpen, unassignedOpen);
                    }}
```

`WordDocsSection`의 `onToggle`:

```tsx
                      onToggle={() => {
                        const next = !wordOpen;
                        setWordOpen(next);
                        writeTree(orgOpen, favOpen, next, unassignedOpen);
                      }}
```

`OrgAccordion`의 `onToggle` — 함수형 업데이터 대신 현재 값을 읽어 다음 집합을 만들고 state·저장에 같이 넘긴다(이벤트당 토글 1회라 안전):

```tsx
                    onToggle={(path) => {
                      const next = new Set(orgOpen);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                        // 하위 부서가 1개뿐인 구간은 이어서 자동 펼침 — 선택지 없는 클릭 반복 제거
                        for (const p of collectSingleChildChain(orgTree.roots, path)) next.add(p);
                      }
                      setOrgOpen(next);
                      writeTree(next, favOpen, wordOpen, unassignedOpen);
                    }}
```

`OrgAccordion`의 `onCollapseAll`:

```tsx
                    onCollapseAll={() => {
                      const next = new Set<string>();
                      setOrgOpen(next);
                      setUnassignedOpen(false);
                      writeTree(next, favOpen, wordOpen, false);
                    }}
```

`OrgAccordion`의 `onToggleUnassigned`:

```tsx
                    onToggleUnassigned={() => {
                      const next = !unassignedOpen;
                      setUnassignedOpen(next);
                      writeTree(orgOpen, favOpen, wordOpen, next);
                    }}
```

> 맵 선택 시 자동펼침 이펙트(`setOrgOpen((prev) => new Set([...prev, ...paths]))`)는 **그대로 둔다** — 사용자의 명시적 토글이 아니고 경로를 추가만 하므로 저장하지 않는다.

- [ ] **Step 7: 타입·린트·테스트를 확인한다**

Run: `npx tsc --noEmit && npm run lint && npm run test`
Expected: 전부 에러 0 / PASS. `s.orgOpen` 등 삭제한 필드를 참조하는 잔재가 있으면 `tsc`가 잡는다.

- [ ] **Step 8: 프로덕션 빌드를 확인한다**

Run: `npm run build`
Expected: 성공. React Compiler 관련 에러(`preserve-manual-memoization`, `set-state-in-effect`)가 나오면 해당 핸들러를 평범한 함수로 되돌린다.

- [ ] **Step 9: 커밋**

`PROGRESS.md` 같은 섹션에 추가:

```markdown
- 구현: 첫 진입 포커스 — 내 부서 맵이 있으면 조직도 시드 생략(me·maps 도착 후 1회 판단으로 경합 차단), 접힘 상태는 `bpm.home.tree`(localStorage)로 분리해 새로고침에도 유지(저장은 StrictMode 사고 회피 위해 토글 핸들러에서).
```

```bash
git add frontend/src/app/page.tsx PROGRESS.md
git commit -F - <<'EOF'
feat(home): collapse org tree when my-dept section covers it — 진입 포커스 정리·접힘 상태 영속

My dept 섹션과 조직도가 같은 카드를 중복 렌더해 첫 진입 시선이 갈리던 문제.
내 부서 맵이 있으면 조직도 시드를 건너뛰고, 접힘 상태는 새로고침에도 남도록
sessionStorage(검색·필터)에서 분리해 localStorage로 옮긴다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 5: 브라우저 스모크 + 전체 게이트

렌더 변경은 단위 테스트로 잡히지 않는다. 실제 브라우저에서 카드 폭·sticky·진입 포커스·영속·호버 반전을 측정한다.

**Files:**
- Create: `frontend/scripts/pw-smoke-home-dept.mjs`

**Interfaces:**
- Consumes: Task 2의 DOM 계약(`org-node-toggle` / `aria-expanded` / `data-sticky` / `data-path`), Task 3의 `map-card-recent-pill`·`map-card-updated-chip`, Task 4의 `localStorage["bpm.home.tree"]`
- Produces: 없음(검증 전용)

**전제:** backend(8000) + frontend(3000) 네이티브 기동, 시드 완료. `playwright-core` 미설치면 `npm i -D playwright-core --no-save`.

- [ ] **Step 1: 스모크 스크립트를 만든다**

`frontend/scripts/pw-smoke-home-dept.mjs`:

```js
// 홈 부서 가시성 스모크 — 카드 폭 depth 무관 통일 · sticky 경로 헤더 · 첫 진입 조직도 접힘 ·
// 접힘 상태 새로고침 유지 · 최근접속 호버 반전.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=<dir> node scripts/pw-smoke-home-dept.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, 시드 완료. 언어 en 고정.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API_BASE = process.env.API_BASE ?? "http://localhost:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const ADMIN = "admin.sys";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 내 부서(또는 하위)에 맵을 가진 사용자를 런타임에 고른다 — 시드가 바뀌어도 스크립트가 깨지지 않게.
async function findUserWithDeptMaps() {
  const headers = { "X-Dev-User": ADMIN };
  const [maps, dir] = await Promise.all([
    fetch(`${API_BASE}/api/maps`, { headers }).then((r) => r.json()),
    fetch(`${API_BASE}/api/directory`, { headers }).then((r) => r.json()),
  ]);
  const owned = maps.map((m) => m.owning_department).filter(Boolean);
  for (const u of dir.users) {
    if (!u.org_path) continue;
    if (owned.some((d) => d === u.org_path || d.startsWith(`${u.org_path}/`))) return u.id;
  }
  return null;
}

// 컨텍스트 생성 — devUser/언어 고정, 접힘 저장값은 매번 비운 상태로 시작.
async function openContext(browser, devUser, recentIds = []) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ([user, ids]) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", "en");
      window.localStorage.removeItem("bpm.home.tree");
      if (ids.length > 0) {
        window.localStorage.setItem(
          "bpm.recentMaps",
          JSON.stringify(ids.map((id) => ({ id, at: 1754000000000 }))),
        );
      }
    },
    [devUser, recentIds],
  );
  return ctx;
}

// 닫힌 부서 행을 전부 펼친다 — 펼칠 때마다 하위 행이 새로 나타나므로 남은 게 없을 때까지 반복.
// 한 번에 하나씩(first) 여는 이유: 클릭마다 트리가 재렌더돼 미리 잡아둔 핸들이 무효해진다.
async function expandAll(page) {
  for (let round = 0; round < 60; round += 1) {
    const closed = page.locator('[data-id="org-node-toggle"][aria-expanded="false"]');
    if ((await closed.count()) === 0) return;
    await closed.first().click();
    await page.waitForTimeout(60);
  }
  throw new Error("expandAll: 60회 내에 전부 펼치지 못했다 — 트리가 예상보다 크거나 토글이 안 먹는다");
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const deptUser = await findUserWithDeptMaps();
  check("found a user with dept maps", deptUser !== null, `user=${deptUser}`);
  if (!deptUser) throw new Error("시드에 부서 맵을 가진 사용자가 없다 — 시드를 확인하라");

  // ── 1) 첫 진입 포커스 — 내 부서 맵이 있으면 조직도는 접힌 채 ──────────────────
  const ctxA = await openContext(browser, deptUser);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageA.goto(BASE, { waitUntil: "networkidle" });
  await pageA.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });

  const myDeptShown = await pageA.locator('[data-id="home-my-dept"]').count();
  check("my-dept section rendered", myDeptShown === 1, `count=${myDeptShown}`);

  const openedOnEntry = await pageA.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check("org tree starts collapsed", openedOnEntry === 0, `open=${openedOnEntry}`);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-1-entry.png`, fullPage: false });

  // ── 2) 카드 폭 — depth 무관 동일 ──────────────────────────────────────────
  await expandAll(pageA);
  const widths = await pageA
    .locator('[data-id="home-org-accordion"] [data-id="map-card"]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  const uniq = [...new Set(widths)];
  check(
    "map cards share one width across depths",
    widths.length >= 2 && uniq.length === 1,
    `cards=${widths.length} widths=${uniq.join(",")}`,
  );

  // 펼친 깊이가 실제로 2단계 이상이어야 위 단언이 의미 있다
  const depths = await pageA
    .locator('[data-id="org-node-toggle"][aria-expanded="true"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-path") ?? "").split("/").length));
  check("expanded tree spans multiple depths", new Set(depths).size >= 2, `depths=${[...new Set(depths)].join(",")}`);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-2-expanded.png`, fullPage: false });

  // ── 3) sticky 경로 헤더 — 스크롤해도 컨테이너 상단에 붙는다 ──────────────────
  const stickyCount = await pageA.locator('[data-id="org-node-toggle"][data-sticky="true"]').count();
  check("map-owning rows are sticky", stickyCount >= 1, `sticky=${stickyCount}`);

  const stuck = await pageA.evaluate(() => {
    const scroller = document.querySelector('[data-id="home-org-accordion"]')?.parentElement;
    if (!scroller) return { ok: false, reason: "scroller not found" };
    scroller.scrollTop = scroller.scrollHeight; // 끝까지 내린다
    const headers = [...document.querySelectorAll('[data-id="org-node-toggle"][data-sticky="true"]')];
    const top = scroller.getBoundingClientRect().top;
    // 화면에 걸린 sticky 헤더 중 하나는 컨테이너 상단(±2px)에 붙어 있어야 한다
    const pinned = headers.filter((h) => Math.abs(h.getBoundingClientRect().top - top) <= 2);
    return { ok: pinned.length >= 1, reason: `pinned=${pinned.length} headers=${headers.length}` };
  });
  check("a sticky header pins to the container top", stuck.ok, stuck.reason);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-3-sticky.png`, fullPage: false });

  // ── 4) 접힘 상태가 새로고침에도 유지 ────────────────────────────────────────
  const firstPath = await pageA
    .locator('[data-id="org-node-toggle"][aria-expanded="true"]')
    .first()
    .getAttribute("data-path");
  await pageA.locator(`[data-id="org-node-toggle"][data-path="${firstPath}"]`).click(); // 접는다
  await pageA.waitForTimeout(80);
  const storedRaw = await pageA.evaluate(() => window.localStorage.getItem("bpm.home.tree"));
  check("collapse state written to localStorage", storedRaw !== null, `raw=${String(storedRaw).slice(0, 60)}`);

  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const stillClosed = await pageA
    .locator(`[data-id="org-node-toggle"][data-path="${firstPath}"]`)
    .getAttribute("aria-expanded");
  const stillOpenElsewhere = await pageA.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check(
    "collapse state survives reload",
    stillClosed === "false" && stillOpenElsewhere > 0,
    `target=${stillClosed} othersOpen=${stillOpenElsewhere}`,
  );
  await ctxA.close();

  // ── 5) 내 부서 맵이 없는 사용자는 기존대로 조직도가 시드된다 ─────────────────
  const ctxB = await openContext(browser, ADMIN);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageB.goto(BASE, { waitUntil: "networkidle" });
  await pageB.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const adminMyDept = await pageB.locator('[data-id="home-my-dept"]').count();
  const adminOpen = await pageB.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check(
    "no my-dept section -> org tree still seeded open",
    adminMyDept === 0 ? adminOpen > 0 : true,
    `myDept=${adminMyDept} open=${adminOpen}`,
  );
  await ctxB.close();

  // ── 6) 최근접속 호버 반전 ──────────────────────────────────────────────────
  const anyMapId = await fetch(`${API_BASE}/api/maps`, { headers: { "X-Dev-User": deptUser } })
    .then((r) => r.json())
    .then((ms) => ms[0]?.id ?? null);
  check("picked a map for the recent cache", anyMapId !== null, `id=${anyMapId}`);

  const ctxC = await openContext(browser, deptUser, [anyMapId]);
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageC.goto(BASE, { waitUntil: "networkidle" });
  await pageC.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  await expandAll(pageC);

  await pageC.locator('[data-id="map-card-recent-badge"]').first().waitFor({ state: "visible", timeout: 8000 });
  // 최근 배지를 품은 카드 — 카드마다 updated-chip이 있으므로 반드시 배지 소유 카드로 좁힌다.
  const card = pageC.locator('[data-id="map-card"]:has([data-id="map-card-recent-badge"])').first();

  // 측정은 전부 배지 root 안에서 — 전역 querySelector면 다른 카드의 chip을 집는다.
  const readLayers = async () =>
    pageC.evaluate(() => {
      const root = document.querySelector('[data-id="map-card-recent-badge"]');
      if (!root) return null;
      const pill = root.querySelector('[data-id="map-card-recent-pill"]');
      const chip = root.querySelector('[data-id="map-card-updated-chip"]');
      const owner = chip?.parentElement ?? null;
      return {
        pill: pill ? Number(getComputedStyle(pill).opacity) : -1,
        owner: owner ? Number(getComputedStyle(owner).opacity) : -1,
        chipBg: chip ? getComputedStyle(chip).backgroundColor : "",
      };
    });

  const before = await readLayers();
  check(
    "default shows owner/updated, recent pill hidden",
    before !== null && before.owner > 0.9 && before.pill < 0.1,
    `owner=${before?.owner} pill=${before?.pill}`,
  );
  check(
    "updated chip carries the accent tint background",
    before !== null && before.chipBg !== "rgba(0, 0, 0, 0)" && before.chipBg !== "",
    `chipBg=${before?.chipBg}`,
  );

  await card.hover();
  await pageC.waitForTimeout(500); // duration-350 전이 완료 대기
  const after = await readLayers();
  check(
    "hover swaps to the recent-opened pill",
    after !== null && after.pill > 0.9 && after.owner < 0.1,
    `owner=${after?.owner} pill=${after?.pill}`,
  );
  await pageC.screenshot({ path: `${SHOT_DIR}/home-dept-4-hover.png`, fullPage: false });
  await ctxC.close();

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
```

- [ ] **Step 2: 백엔드·프론트를 띄운다**

두 서버는 **사용자 터미널에서** 띄운다(에이전트 백그라운드 프로세스는 턴 경계에서 회수된다).

```bash
# 터미널 1 — backend/ 에서
.venv/bin/uvicorn app.main:app --reload --port 8000
# 터미널 2 — frontend/ 에서
npm run dev
```

- [ ] **Step 3: 스모크를 실행한다**

Run (frontend/ 에서):

```bash
SHOT_DIR=/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/7afdc34d-22a3-4598-bbc5-ba30008df981/scratchpad node scripts/pw-smoke-home-dept.mjs
```

Expected: `N/N passed`, 종료 코드 0. 스크린샷 4장(`home-dept-1-entry.png` ~ `home-dept-4-hover.png`)을 **육안으로 확인**한다 — 필 정렬·카드 폭 통일·sticky 헤더·호버 반전.

FAIL이 나오면 스크린샷과 실패 항목 이름을 근거로 원인을 특정한다. 같은 수정을 두 번 시도해도 진전이 없으면 멈추고 보고한다.

- [ ] **Step 4: 전체 게이트를 돌린다**

Run (frontend/ 에서):

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

Expected: 전부 통과.

Run (backend/ 에서) — 프론트 전용 변경이라 회귀만 확인:

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
```

Expected: 전부 PASS. (`backend/.env`가 있으면 "기본 비활성" 가정 테스트가 깨지므로 위 환경변수를 반드시 붙인다.)

- [ ] **Step 5: 커밋**

`PROGRESS.md` 같은 섹션에 추가(실제 통과 수치로 채운다):

```markdown
- 검증: 브라우저 스모크 `pw-smoke-home-dept.mjs` N/N 통과(진입 접힘·카드 폭 통일·sticky 고정·새로고침 유지·호버 반전) + 전체 게이트(lint·tsc·vitest·build·pytest).
```

```bash
git add frontend/scripts/pw-smoke-home-dept.mjs PROGRESS.md
git commit -F - <<'EOF'
test(home): browser smoke for dept visibility redesign — 부서 가시성 개편 브라우저 스모크

카드 폭·sticky·진입 포커스·영속·호버 반전은 단위 테스트로 잡히지 않아
실제 브라우저에서 측정한다. 부서 맵을 가진 사용자는 런타임에 골라 시드 변경에 강하게.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

## 완료 기준

- [ ] Task 1–5의 모든 스텝 체크
- [ ] `npm run lint` · `npx tsc --noEmit` · `npm run test` · `npm run build` 전부 통과
- [ ] `pw-smoke-home-dept.mjs` 전 항목 PASS + 스크린샷 4장 육안 확인
- [ ] 백엔드 pytest 회귀 없음
- [ ] `PROGRESS.md`에 Task별 한 줄씩 기록됨

**남는 검증(이 플랜 범위 밖):** Windows 로컬 네이티브 실행 확인 → 서버 docker-compose 배포 확인. 사용자 파이프라인이므로 별도 진행한다.
