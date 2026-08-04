# 홈 부서 목록 재조정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 좌측 조직도를 main의 들여쓰기 트리로 되돌리고, 카운트 태그화·펼친 부서 톤다운·맵 보유 부서의 그룹 박스로 목록 가독성을 올린다.

**Architecture:** 필 체인·sticky 헤더·breadcrumb을 걷어내고 main의 `renderNode`(들여쓴 행 + 평문 부서명)로 복귀한다. 그 위에 네 규칙을 얹는다 — 카운트를 태그로, 펼친 행은 태그를 숨기고 이름을 톤다운, 자기 맵을 가진 펼친 부서는 헤더 행과 자기 카드를 **컬럼 풀폭 그룹 박스**로 묶고(들여쓰기는 박스 안쪽 헤더가 담당해 카드 폭이 depth에 안 묶인다), 자식 부서는 박스 밖에서 트리로 이어진다. 태그와 박스는 조직도·미지정·내 부서 세 곳이 공유하므로 작은 프리미티브 두 개로 뽑는다.

**Tech Stack:** Next.js (App Router) · React 19 + React Compiler · TypeScript strict · Tailwind v4 `@theme` 토큰 · vitest · playwright-core + 시스템 Chrome

**설계 문서:** `docs/design/2026-08-04-home-dept-list-revision-design.md` — 판단이 필요하면 이 문서가 기준이다. 이 문서는 `docs/design/2026-08-04-home-dept-visibility-design.md`의 §2만 대체하고, 같은 문서의 §3(카드 호버 반전)·§4(진입 포커스·접힘 영속)는 **손대지 않는다**.

## Global Constraints

- **작업 브랜치는 `feat/home-dept-list-revision`** (이미 생성됨, `dev`에서 분기, 설계 커밋 `8e23f14`). 저장소 루트 `/Users/hyeonjin/Documents/bpm`.
- **Raw hex 금지** — 색은 토큰 클래스로만: `bg-surface`, `bg-surface-alt`, `text-ink`, `text-ink-secondary`, `text-ink-tertiary`, `text-accent`, `border-hairline` (`rules/frontend/design.md` §1).
- **액센트는 선택·활성 전용** — 카운트 태그에 `accent` 계열을 쓰지 않는다. 태그는 중립색.
- **UI 문자열은 영어**(`t()` 경유), 주석·설명은 한글. 이모지 금지 → Lucide 아이콘 `strokeWidth={1.5}`.
- **TypeScript strict** — `any` 금지, `@ts-ignore` 금지. props는 `interface`로 정의하고 인라인 객체 타입을 쓰지 않는다 (`rules/languages/typescript.md`).
- **컴포넌트 파일당 export 컴포넌트 1개** (`rules/languages/typescript.md` React 절).
- **함수명은 동사로 시작** (`rules/common/naming.md`). React 컴포넌트만 PascalCase 명사 허용.
- **React Compiler** — 새 핸들러를 `useCallback`으로 감싸지 않는다. 추론 deps와 선언 deps가 어긋나면 `npm run lint`/`build`가 `react-hooks/preserve-manual-memoization`으로 실패한다 (`frontend/AGENTS.md`).
- **커밋 메시지**: `type(scope): English summary — 한국어 요약`. **em dash 뒤는 반드시 한국어.** 본문 끝에 아래 2줄을 붙인다.

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
  ```

- **`PROGRESS.md`는 코드와 같은 커밋에** 갱신한다 — Task마다 한 줄씩 (`rules/common/git.md`).
- 모든 npm 명령은 `frontend/`에서 실행한다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `frontend/src/components/maps/count-tag.tsx` | 맵 개수 태그(중립 알약) | **신규** |
| `frontend/src/components/maps/dept-group-box.tsx` | 부서 헤더 + 그 카드를 감싸는 풀폭 박스 | **신규** |
| `frontend/src/components/maps/org-accordion.tsx` | 조직도 렌더 | **전면 교체** — main 구조 + R1~R5 |
| `frontend/src/components/maps/my-dept-favorites.tsx` | 내 부서 즐겨찾기 | **부분 수정** — R6 박스·태그 적용 |
| `frontend/src/lib/org-tree.ts` | 조직도 순수 로직 | `collectPillChain` **제거** (사용처 소멸) |
| `frontend/src/lib/org-tree.test.ts` | 위 단위 테스트 | `collectPillChain` describe **제거** |
| `frontend/scripts/pw-smoke-home-dept.mjs` | 브라우저 스모크 | sticky 검사 2건 → 박스·태그·톤다운 검사로 교체 |

`count-tag.tsx`와 `dept-group-box.tsx`를 뽑는 이유: 두 마크업이 조직도 행·미지정 섹션·내 부서 섹션 **세 곳**에서 동일하게 쓰인다. 한쪽만 고쳐 드리프트하면 "좌측 컬럼의 시각 언어를 하나로"라는 설계 목적이 깨진다.

---

### Task 1: 조직도 아코디언 재구성 + `collectPillChain` 제거

main의 들여쓰기 트리로 되돌리고 R1~R5를 적용한다. 공유 프리미티브 두 개도 이 태스크에서 만든다(이 태스크의 산출물이 필요로 하므로).

**Files:**
- Create: `frontend/src/components/maps/count-tag.tsx`
- Create: `frontend/src/components/maps/dept-group-box.tsx`
- Modify: `frontend/src/components/maps/org-accordion.tsx` (전체 교체)
- Modify: `frontend/src/lib/org-tree.ts` (`collectPillChain` 제거)
- Modify: `frontend/src/lib/org-tree.test.ts` (`collectPillChain` describe 제거 + import 정리)

**Interfaces:**
- Consumes: 기존 `OrgNode` (`org-tree.ts`) — `{ path, name, koreanName, children, maps, mapCount }`. `OrgAccordionProps`는 **형태를 바꾸지 않는다**(`page.tsx`가 호출하며 이 태스크에서 손대지 않음).
- Produces:
  - `CountTag({ count }: CountTagProps)` — `count: number`. Task 2가 import한다.
  - `DeptGroupBox({ children }: DeptGroupBoxProps)` — `children: ReactNode`. Task 2가 import한다.
  - DOM 계약(Task 3의 스모크가 의존): 행 `[data-id="org-node-toggle"]` + `data-path` + `aria-expanded` **유지**, `data-sticky` **제거**. 신설 `[data-id="org-group-box"]`, `[data-id="org-node-count"]`, `[data-id="org-node-name"]`.

> **`collectSingleChildChain`과 그 테스트는 건드리지 않는다.** `page.tsx`의 자동펼침이 계속 쓴다. `org-tree.test.ts`에서 지우는 것은 `collectPillChain` describe 블록과 import의 해당 이름뿐이다.

- [ ] **Step 1: 카운트 태그 컴포넌트를 만든다**

`frontend/src/components/maps/count-tag.tsx`:

```tsx
// 맵 개수 태그 — 접힌 행에만 붙는다. 펼치면 내용(자식 행·자기 카드)이 아래 다 보여 롤업 숫자는 중복이고,
// 조상 체인을 따라 태그가 줄줄이 남으면 그게 노이즈가 된다.
// 액센트는 선택·활성 전용 토큰이라 카운트엔 중립색만 쓴다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R1·R2
"use client";

interface CountTagProps {
  count: number;
}

export function CountTag({ count }: CountTagProps) {
  return (
    <span
      data-id="org-node-count"
      className="ml-auto shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary"
    >
      {count}
    </span>
  );
}
```

- [ ] **Step 2: 그룹 박스 컴포넌트를 만든다**

`frontend/src/components/maps/dept-group-box.tsx`:

```tsx
// 부서 헤더 행 + 그 부서가 직접 가진 맵 카드를 묶는 박스.
// 컬럼 풀폭(들여쓰기 0)이라 카드 폭이 depth와 무관하게 고정된다 — 계층은 박스 "안쪽" 헤더의
// paddingLeft가 담당한다. 박스를 들여쓰거나 중첩하면 카드 폭이 다시 depth에 묶인다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R4
"use client";

import type { ReactNode } from "react";

interface DeptGroupBoxProps {
  children: ReactNode;
}

export function DeptGroupBox({ children }: DeptGroupBoxProps) {
  return (
    <div
      data-id="org-group-box"
      className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface-alt p-2"
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: 조직도 아코디언을 통째로 교체한다**

`frontend/src/components/maps/org-accordion.tsx` 전체를 아래로 바꾼다:

```tsx
// 홈 좌측 — owning department 조직도 아코디언. main의 들여쓰기 트리 위에 카운트 태그·펼침 톤다운·
// 맵 보유 부서의 그룹 박스를 얹는다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import type { OrgNode } from "@/lib/org-tree";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
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

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const {
    roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId,
    onSelect, unassignedOpen, onToggleUnassigned, renderCard,
  } = props;

  // 맵 목록 — 들여쓰기 없음. 감싸는 DeptGroupBox의 p-2가 안쪽 여백을 담당한다.
  const renderMapList = (maps: MapSummary[]) => (
    <ul className="flex flex-col gap-2">
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
    const open = openPaths.has(node.path);
    // 자기 맵을 가진 부서를 펼치면 헤더 행과 자기 카드만 박스로 묶는다. 자식은 박스 밖 —
    // 박스의 뜻을 "이 부서가 직접 가진 맵"으로 고정하고 박스 중첩을 막는다.
    const boxed = open && node.maps.length > 0;

    // 박스 안이든 밖이든 같은 행이다 — 부서명을 트리 행과 박스 제목에 따로 쓰면 같은 이름이 두 줄 연속으로 나온다.
    const header = (
      <button
        type="button"
        data-id="org-node-toggle"
        data-path={node.path}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className="group flex w-full items-center gap-1.5 rounded-sm py-1 text-left hover:bg-surface-alt"
      >
        {open
          ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
          : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
        {/* 펼친 행은 톤다운 — 지나온 경로는 뒤로 물러나고 아직 안 연 부서가 앞으로 나온다 */}
        <span
          data-id="org-node-name"
          className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
        >
          {node.name}
        </span>
        {!open && <CountTag count={node.mapCount} />}
      </button>
    );

    return (
      <li key={node.path} className="flex flex-col gap-1">
        {boxed ? <DeptGroupBox>{header}{renderMapList(node.maps)}</DeptGroupBox> : header}
        {open && node.children.length > 0 && (
          <ul className="flex flex-col gap-1">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  // 미지정 섹션 — 부서 하나 + 그 맵이라는 같은 모양이므로 같은 헤더·박스 규칙을 쓴다.
  const unassignedHeader = (
    <button
      type="button"
      data-id="org-unassigned-toggle"
      aria-expanded={unassignedOpen}
      onClick={(e) => { e.stopPropagation(); onToggleUnassigned(); }}
      className="group flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-surface-alt"
    >
      {unassignedOpen
        ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
      <span
        data-id="org-node-name"
        className={`truncate text-fine ${unassignedOpen ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
      >
        {t("home.unassignedDept")}
      </span>
      {!unassignedOpen && <CountTag count={unassigned.length} />}
    </button>
  );

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
      <ul className="flex flex-col gap-1">{roots.map((r) => renderNode(r, 0))}</ul>
      {unassigned.length > 0 && (
        <div className="pt-2">
          {unassignedOpen
            ? <DeptGroupBox>{unassignedHeader}{renderMapList(unassigned)}</DeptGroupBox>
            : unassignedHeader}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: `collectPillChain`을 제거한다**

`frontend/src/lib/org-tree.ts` 파일 끝의 `collectPillChain` 함수와 그 위 주석 블록을 통째로 삭제한다. 삭제 대상은 아래로 시작하는 블록이다:

```ts
// 렌더용 필 체인 — "통과만 하는" 노드(자기 맵 없이 자식 1개)를 이어붙여 한 행에 그릴 부서 목록을 만든다.
```

`buildOrgTree`·`filterMyDeptMaps`·`collectSingleChildChain`은 그대로 둔다.

- [ ] **Step 5: 해당 테스트를 제거한다**

`frontend/src/lib/org-tree.test.ts`에서 `describe("collectPillChain", ...)` 블록 전체를 삭제하고, 3행 import에서 `collectPillChain`만 뺀다:

```ts
import { buildOrgTree, collectSingleChildChain, filterMyDeptMaps, type OrgNode } from "@/lib/org-tree";
```

`describe("collectSingleChildChain", ...)`의 3케이스는 **그대로 남긴다**.

- [ ] **Step 6: 테스트를 돌려 회귀가 없는지 확인한다**

Run: `npm run test -- org-tree`
Expected: PASS. `collectSingleChildChain` 3케이스를 포함해 남은 케이스가 전부 초록. 이 파일의 테스트 수가 3개 줄어드는 것이 정상(제거한 `collectPillChain` 케이스).

- [ ] **Step 7: 타입·린트를 확인한다**

Run: `npx tsc --noEmit`
Expected: 에러 0. `collectPillChain`을 아직 import하는 곳이 남아 있으면 여기서 잡힌다.

Run: `npm run lint`
Expected: 에러 0. (`scripts/pw-smoke-task8.mjs`의 `'all' is assigned a value but never used` 경고 1건은 이 브랜치와 무관한 기존 경고다.)

- [ ] **Step 8: 전체 테스트로 회귀를 확인한다**

Run: `npm run test`
Expected: 전부 PASS.

- [ ] **Step 9: 커밋**

`PROGRESS.md`의 `## 2026-08-04 — 홈 부서 목록 재조정 설계 (개정)` 섹션 끝에 한 줄 추가:

```markdown
- 구현: 조직도 아코디언을 main 들여쓰기 트리로 되돌리고 카운트 태그(`CountTag`)·펼친 행 태그 숨김/톤다운·맵 보유 부서 풀폭 그룹 박스(`DeptGroupBox`, 자식은 박스 밖) 적용. 사용처 사라진 `collectPillChain`+테스트 제거.
```

```bash
git add frontend/src/components/maps/count-tag.tsx frontend/src/components/maps/dept-group-box.tsx frontend/src/components/maps/org-accordion.tsx frontend/src/lib/org-tree.ts frontend/src/lib/org-tree.test.ts PROGRESS.md
git commit -F - <<'EOF'
feat(home): indented dept tree with count tags and group boxes — 들여쓰기 트리 회귀·카운트 태그·그룹 박스

필 체인·sticky·breadcrumb이 좌변 지그재그와 윗줄 중복을 만들어 오히려 훑기 어려웠다.
main 트리로 돌아가되 펼친 부서는 태그를 숨기고 톤다운해 뒤로 물리고, 맵 보유 부서는
자기 카드와 함께 풀폭 박스로 묶어 경계를 준다. 박스가 풀폭이라 카드 폭은 depth에 안 묶인다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 2: 내 부서 섹션에 같은 박스·태그 적용

`MyDeptFavorites`는 "부서 하나 + 그 맵"이라는 같은 모양이다. 같은 프리미티브를 써서 좌측 컬럼의 시각 언어를 하나로 맞춘다. 이걸 빼면 내 부서 카드만 417px, 조직도 카드는 399px로 어긋난다.

**Files:**
- Modify: `frontend/src/components/maps/my-dept-favorites.tsx` (전체 교체)

**Interfaces:**
- Consumes: Task 1이 만든 두 컴포넌트 — `CountTag`(props 인터페이스 `CountTagProps { count: number }`, `@/components/maps/count-tag`)와 `DeptGroupBox`(props 인터페이스 `DeptGroupBoxProps { children: ReactNode }`, `@/components/maps/dept-group-box`). 두 인터페이스는 각 파일에 이미 선언돼 있으니 재선언하지 말고 컴포넌트만 import한다.
- Produces: DOM 계약 — 섹션 루트 `[data-id="home-my-dept"]` **유지**. 펼친 상태에서 `[data-id="org-group-box"]`가 1개 생기고, 접힌 상태에서 `[data-id="org-node-count"]`가 1개 생긴다. `MyDeptFavoritesProps`는 **형태를 바꾸지 않는다**(`page.tsx`가 호출하며 이 태스크에서 손대지 않음).

- [ ] **Step 1: 파일을 통째로 교체한다**

`frontend/src/components/maps/my-dept-favorites.tsx` 전체를 아래로 바꾼다:

```tsx
// 홈 좌측 상단 — 나의 부서 맵 즐겨찾기(핀). 아코디언과 별개로 빠른 접근.
// 부서 하나 + 그 맵이라는 같은 모양이라 조직도와 동일한 태그·박스 규칙을 쓴다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md R6
"use client";

import { ChevronDown, ChevronRight, Star } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
import { MapCard } from "@/components/maps/map-card";

interface MyDeptFavoritesProps {
  maps: MapSummary[];
  deptLabel: string;
  open: boolean;
  onToggle: () => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  // 좁은 화면(<split)에서도 상세를 볼 수 있도록 카드 렌더를 페이지에 위임 — 미지정 시 bare MapCard로 폴백.
  // Delegates card render to the page so narrow screens keep an inline detail accordion — falls back to bare MapCard.
  renderCard?: (map: MapSummary) => ReactNode;
}

export function MyDeptFavorites({ maps, deptLabel, open, onToggle, selectedId, onSelect, renderCard }: MyDeptFavoritesProps) {
  const { t } = useI18n();
  if (maps.length === 0) return null;

  const header = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="group flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-surface-alt"
    >
      {open
        ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
      <Star size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
      <span
        data-id="org-node-name"
        className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
      >
        {t("home.myDepartment")} — {deptLabel}
      </span>
      {!open && <CountTag count={maps.length} />}
    </button>
  );

  return (
    <section data-id="home-my-dept" className="flex flex-col gap-2">
      {open ? (
        <DeptGroupBox>
          {header}
          <ul className="flex flex-col gap-2">
            {maps.map((m) => (
              <li key={m.id}>
                {renderCard ? renderCard(m) : <MapCard map={m} selected={selectedId === m.id} onSelect={onSelect} />}
              </li>
            ))}
          </ul>
        </DeptGroupBox>
      ) : (
        header
      )}
    </section>
  );
}
```

- [ ] **Step 2: 타입·린트를 확인한다**

Run: `npx tsc --noEmit && npm run lint`
Expected: 둘 다 에러 0(기존 경고 1건 제외).

- [ ] **Step 3: 전체 테스트로 회귀를 확인한다**

Run: `npm run test`
Expected: 전부 PASS.

- [ ] **Step 4: 프로덕션 빌드를 확인한다**

Run: `npm run build`
Expected: 성공. React Compiler 에러(`preserve-manual-memoization`·`set-state-in-effect`)가 나오면 해당 핸들러를 평범한 함수로 되돌린다.

- [ ] **Step 5: 커밋**

`PROGRESS.md` 같은 섹션에 추가:

```markdown
- 구현: 내 부서 섹션에도 같은 태그·그룹 박스 적용 — 좌측 컬럼 카드 폭을 조직도와 동일(399px)하게 정렬.
```

```bash
git add frontend/src/components/maps/my-dept-favorites.tsx PROGRESS.md
git commit -F - <<'EOF'
feat(home): apply the same tag and group box to my-dept — 내 부서 섹션 태그·박스 통일

내 부서 섹션도 "부서 하나 + 그 맵"이라 조직도와 같은 모양이다. 프리미티브를 공유해
좌측 컬럼의 시각 언어를 하나로 맞추고, 카드 폭이 조직도와 어긋나던 것도 함께 해소한다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

### Task 3: 스모크 갱신 + 전체 게이트

sticky 장치가 사라졌으므로 그 검사 2건을 박스·태그·톤다운 검사로 교체하고, 좁은 폭 클리핑 회귀 검사를 상시 항목으로 넣는다(직전 브랜치에서 1000~1100px 무음 클리핑을 실측으로 잡은 전례가 있다).

**Files:**
- Modify: `frontend/scripts/pw-smoke-home-dept.mjs`

**Interfaces:**
- Consumes: Task 1·2의 DOM 계약 — `[data-id="org-node-toggle"]`(+`data-path`,`aria-expanded`), `[data-id="org-group-box"]`, `[data-id="org-node-count"]`, `[data-id="org-node-name"]`, `[data-id="home-my-dept"]`, `[data-id="map-card"]`
- Produces: 없음(검증 전용)

**전제:** backend(8000) + frontend(3000) 네이티브 기동, 시드된 `backend/dev.db`. `backend/.env`가 `DEV_ENFORCE_PERMISSIONS=true`·`BPM_SYSADMINS=admin.sys`를 켜므로 스크립트의 사용자 선정 로직(후보별 `X-Dev-User`로 `/api/maps` 조회)은 **그대로 둔다**.

- [ ] **Step 1: 파일 상단 주석을 갱신한다**

1행의 설명에서 sticky 언급을 뺀다:

```js
// 홈 부서 목록 스모크 — 카드 폭 depth 무관 통일 · 그룹 박스/카운트 태그/펼침 톤다운 · 첫 진입 조직도 접힘 ·
```

- [ ] **Step 2: sticky 검사 2건을 박스·태그·톤다운 검사로 교체한다**

`// ── 3) sticky 경로 헤더` 주석부터 `home-dept-3-sticky.png` 스크린샷 줄까지(현행 110~125행) 전체를 아래로 바꾼다:

```js
  // ── 3) 그룹 박스 · 카운트 태그 · 펼침 톤다운 ────────────────────────────────
  const boxCount = await pageA.locator('[data-id="org-group-box"]').count();
  check("map-owning depts render a group box", boxCount >= 1, `boxes=${boxCount}`);

  // 박스는 그 부서가 "직접" 가진 맵만 감싼다 — 자식 부서 행이 박스 안에 들어가면 박스가 중첩되고
  // depth마다 카드 폭이 줄어든다(설계 R4의 핵심 불변식).
  const nested = await pageA.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-id="org-group-box"]')];
    // 박스 안의 토글 행은 그 박스 자신의 헤더 1개뿐이어야 한다
    const bad = boxes.filter((b) => b.querySelectorAll('[data-id="org-node-toggle"]').length > 1);
    const nestedBoxes = boxes.filter((b) => b.querySelector('[data-id="org-group-box"]') !== null);
    return { ok: bad.length === 0 && nestedBoxes.length === 0, reason: `multiToggle=${bad.length} nested=${nestedBoxes.length}` };
  });
  check("child depts render outside their parent's box", nested.ok, nested.reason);

  // 펼친 행은 태그를 숨기고 접힌 행만 단다
  const tags = await pageA.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-id="org-node-toggle"]')];
    const openWithTag = rows.filter(
      (r) => r.getAttribute("aria-expanded") === "true" && r.querySelector('[data-id="org-node-count"]') !== null,
    );
    const closedWithoutTag = rows.filter(
      (r) => r.getAttribute("aria-expanded") === "false" && r.querySelector('[data-id="org-node-count"]') === null,
    );
    return {
      ok: rows.length > 0 && openWithTag.length === 0 && closedWithoutTag.length === 0,
      reason: `rows=${rows.length} openWithTag=${openWithTag.length} closedWithoutTag=${closedWithoutTag.length}`,
    };
  });
  check("expanded rows hide the count tag, collapsed rows show it", tags.ok, tags.reason);

  // 펼친 행 이름은 톤다운 — 접힌 행과 computed color가 달라야 한다
  const tone = await pageA.evaluate(() => {
    const nameOf = (state) => {
      const row = document.querySelector(`[data-id="org-node-toggle"][aria-expanded="${state}"]`);
      const el = row?.querySelector('[data-id="org-node-name"]');
      return el ? getComputedStyle(el).color : null;
    };
    const openColor = nameOf("true");
    const closedColor = nameOf("false");
    return { ok: openColor !== null && closedColor !== null && openColor !== closedColor, reason: `open=${openColor} closed=${closedColor}` };
  });
  check("expanded row name is toned down", tone.ok, tone.reason);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-3-boxes.png`, fullPage: false });

  // ── 3b) 좁은 폭에서 행이 무음으로 잘리지 않는다 ─────────────────────────────
  // 스크롤 컨테이너가 overflow-x-hidden이라 넘치면 스크롤바 없이 잘린다. 980~1280px는
  // 우측 상세 패널이 아직 보여 컬럼이 1/3로 좁아지는 실사용 구간이다(직전 브랜치 회귀 전례).
  for (const width of [1000, 1280]) {
    await pageA.setViewportSize({ width, height: 900 });
    await pageA.waitForTimeout(150);
    const clipped = await pageA.evaluate(() =>
      [...document.querySelectorAll('[data-id="org-node-toggle"]')].filter((r) => r.scrollWidth > r.clientWidth + 1).length,
    );
    check(`no dept row clipping at ${width}px`, clipped === 0, `clipped=${clipped}`);
  }
  await pageA.setViewportSize({ width: 1440, height: 900 });
  await pageA.waitForTimeout(150);
```

- [ ] **Step 3: 내 부서 카드도 같은 폭인지 검사를 추가한다**

`check("map cards share one width across depths", ...)` 블록 **바로 아래**에 추가한다(현행 101행 뒤):

```js
  // 내 부서 섹션도 같은 박스라 카드 폭이 조직도와 같아야 한다 — 한쪽만 박스를 빼면 여기서 갈린다
  const myDeptWidths = await pageA
    .locator('[data-id="home-my-dept"] [data-id="map-card"]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  check(
    "my-dept cards match accordion card width",
    myDeptWidths.length > 0 && uniq.length === 1 && myDeptWidths.every((w) => w === uniq[0]),
    `myDept=${[...new Set(myDeptWidths)].join(",")} accordion=${uniq.join(",")}`,
  );
```

> 이 검사는 `expandAll` 직후 실행되므로 내 부서 섹션이 펼쳐져 있어야 카드가 잡힌다. `favOpen` 기본값이 `true`라 성립한다. 만약 0장이 잡히면 섹션이 접힌 것이므로, 검사를 완화하지 말고 원인을 보고한다.

- [ ] **Step 4: 서버를 띄운다**

두 서버는 **사용자 터미널에서** 띄운다(에이전트 백그라운드 프로세스는 턴 경계에서 회수된다).

```bash
# 터미널 1 — backend/ 에서
.venv/bin/uvicorn app.main:app --reload --port 8000
# 터미널 2 — frontend/ 에서
npm run dev
```

- [ ] **Step 5: 스모크를 실행한다**

Run (frontend/ 에서):

```bash
SHOT_DIR=/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/7afdc34d-22a3-4598-bbc5-ba30008df981/scratchpad node scripts/pw-smoke-home-dept.mjs
```

Expected: `N/N passed`, 종료 코드 0. 스크린샷 4장(`home-dept-1-entry.png`·`home-dept-2-expanded.png`·`home-dept-3-boxes.png`·`home-dept-4-hover.png`)을 **Read 도구로 열어 육안 확인**한다 — 펼친 부서가 회색이고 태그가 없는지, 접힌 부서에 태그가 붙는지, 맵 보유 부서가 카드와 함께 박스로 묶였는지, 자식 부서 행이 박스 밖에 있는지, 카드 좌·우변이 전부 정렬돼 있는지.

FAIL이 나오면 검사를 약화하지 말고 원인을 특정한다 — 제품 코드가 틀렸으면 고치고 보고하고, 스크립트가 틀렸으면 무엇이 왜 틀렸는지 밝힌다. 같은 수정을 두 번 시도해도 진전이 없으면 멈추고 보고한다.

- [ ] **Step 6: 전체 게이트를 돌린다**

Run (frontend/ 에서):

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

Expected: 전부 통과.

Run (backend/ 에서) — 프론트 전용 변경이라 회귀만 확인:

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
```

Expected: 전부 PASS. (`backend/.env`가 있으므로 위 환경변수를 반드시 붙인다.)

- [ ] **Step 7: 커밋**

`PROGRESS.md` 같은 섹션에 추가(실제 통과 수치로 채운다):

```markdown
- 검증: 스모크를 박스·태그·톤다운·좁은폭 클리핑 검사로 갱신해 N/N 통과 + 전체 게이트(lint·tsc·vitest·build·pytest).
```

```bash
git add frontend/scripts/pw-smoke-home-dept.mjs PROGRESS.md
git commit -F - <<'EOF'
test(home): swap sticky smoke checks for group box and tag checks — 스모크를 박스·태그·톤다운 검사로 교체

sticky 장치가 사라져 그 검사는 의미를 잃었다. 대신 박스가 자식을 품지 않는지(중첩 금지
불변식), 펼친 행이 태그를 숨기고 톤다운되는지, 좁은 폭에서 행이 무음으로 잘리지 않는지를
측정한다. 마지막 항목은 직전 브랜치에서 실제로 회귀했던 지점이다.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy
EOF
```

---

## 완료 기준

- [ ] Task 1–3의 모든 스텝 체크
- [ ] `npm run lint` · `npx tsc --noEmit` · `npm run test` · `npm run build` 전부 통과
- [ ] `pw-smoke-home-dept.mjs` 전 항목 PASS + 스크린샷 4장 육안 확인
- [ ] 백엔드 pytest 회귀 없음
- [ ] `PROGRESS.md`에 Task별 한 줄씩 기록됨

**남는 검증(이 플랜 범위 밖):** Windows 로컬 네이티브 실행 확인 → 서버 docker-compose 배포 확인.
