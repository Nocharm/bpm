# Node Action Bar + Link Preview Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 노드 포커스 시 노드 하단 중앙에 통합 액션 바(펼치기→링크 열기→그룹 나가기 고정 순서)를 띄우고, "링크 열기"로 노드 url을 우측 520px 슬라이드 iframe 미리보기 패널에서 연다.

**Architecture:** 액션 바는 `NodeSelectionRing`과 동일한 React Flow store 구독 + `ViewportPortal` flow 좌표 패턴의 독립 컴포넌트. 패널은 `feedback-side-panel.tsx`의 스크림+`translate-x` 슬라이드 오버레이 패턴. page.tsx는 `linkPreviewUrl` 상태와 `leaveGroups` 콜백만 추가하고 기존 `toggleInlineExpand`/그룹 이탈/자동저장 경로를 그대로 재사용한다.

**Tech Stack:** Next.js(React 19, React Compiler) + @xyflow/react + Tailwind v4(@theme 토큰) + lucide-react + vitest(lib 단위) + playwright-core 스모크.

**Spec:** `docs/superpowers/specs/2026-07-06-node-action-bar-link-preview-design.md` (승인됨)

## Global Constraints

- 버튼 순서 고정(위→아래): 하위 프로세스 펼치기/접기 → 링크 열기 → 그룹 나가기.
- readOnly(뷰어/딥뷰): 펼치기·링크 열기 **노출**, 그룹 나가기 **숨김**.
- **locked/undesignated subprocess는 펼치기 버튼 미노출** — 조건 `nodeType === "subprocess" && (subEnds ?? []).length > 0 && !locked && !undesignated` 그대로 유지(현 캔버스 동작 보존, 사용자 재확인 2026-07-06). 노드의 `LockedBadge`/`UndesignatedBadge`는 그대로 남아 사유를 표시한다.
- 그룹 나가기 = 클릭 1회에 선택 노드의 **소속 그룹 전부** 탈퇴.
- 다중 선택·드래그 중 액션 바 숨김. 팬/줌 정합은 ViewportPortal flow 좌표로 달성.
- 컴포넌트에 raw hex 금지 — 토큰 클래스/`var(--color-*)`만 (`rules/frontend/design.md`). 그림자는 `shadow-lg`, 아이콘은 Lucide ≤16px strokeWidth 1.5, 굵기 600(`font-semibold`).
- i18n: en/ko 동시 추가 필수 — ko 딕셔너리는 en과 동일 키를 tsc로 강제(`i18n-messages.ts` 1행 규칙).
- React Compiler: `useCallback`/`useMemo` deps 불일치는 빌드 실패(`react-hooks/preserve-manual-memoization`), effect 내 동기 setState 금지(`react-hooks/set-state-in-effect`) — 로딩 상태는 파생값으로 설계됨(Task 3).
- `crypto.randomUUID` 금지(평문 HTTP 배포) — 이번 작업은 id 생성 불필요.
- URL 가드: `isHttpUrl`(http/https만)을 액션 바 노출 조건과 iframe 로드 게이트가 **공유** — `javascript:`/`data:` 차단.
- 기존 `toggleInlineExpand`·그룹 이탈(setNodes→pruneSmallGroups→scheduleAutoSave)·자동저장 경로 재사용, 신규 영속 로직 금지. 백엔드/DB 무변경.
- 커밋마다 `PROGRESS.md` 한 줄 + 이 플랜의 체크박스를 **같은 커밋**에 갱신(`rules/common/git.md`). 커밋 메시지: `type(scope): English — 한국어`.
- 작업 디렉터리: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/feat+url-viewer` (워크트리, 브랜치 `feat/url-viewer`). frontend 명령은 `frontend/`에서.
- ⚠️ `grep`은 ugrep이라 `[mapId]` 브래킷 경로를 조용히 건너뜀 — page.tsx 검색은 `command grep` 사용.

---

### Task 1: `isHttpUrl` URL 가드 헬퍼 (TDD)

**Files:**
- Create: `frontend/src/lib/url.ts`
- Test: `frontend/src/lib/url.test.ts`

**Interfaces:**
- Produces: `isHttpUrl(value: string | null | undefined): boolean` — Task 2(액션 바 노출 조건)·Task 3(iframe 로드 게이트)이 `@/lib/url`에서 import.

- [x] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/url.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isHttpUrl } from "./url";

describe("isHttpUrl", () => {
  it.each([
    "https://example.com",
    "http://wms.acme-corp.com/inbound/inspect",
    "HTTPS://UPPER.EXAMPLE.COM/path",
    "  https://padded.example.com  ",
  ])("accepts %s", (value) => {
    expect(isHttpUrl(value)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://files.example.com",
    "example.com",
    "//protocol-relative.example.com",
  ])("rejects %s", (value) => {
    expect(isHttpUrl(value)).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});
```

- [x] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/url.test.ts`
Expected: FAIL — `Cannot find module './url'` 계열 에러.

- [x] **Step 3: 최소 구현**

`frontend/src/lib/url.ts`:

```ts
// 노드 참조 링크 가드 — http(s) 스킴만 통과. 액션 바 노출 조건과 미리보기 iframe 로드 게이트가
// 같은 판정을 공유해 javascript:/data: 등 스킴 주입(XSS)을 차단한다.
export function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}
```

- [x] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/url.test.ts`
Expected: PASS (3 test blocks, 12 cases).

- [x] **Step 5: 린트 + 전체 테스트 + 커밋**

Run: `cd frontend && npm run lint && npm run test`
Expected: lint 0 problems, vitest 전체 green.

```bash
git add frontend/src/lib/url.ts frontend/src/lib/url.test.ts PROGRESS.md docs/superpowers/plans/2026-07-06-node-action-bar-link-preview.md
git commit -m "feat(canvas): add isHttpUrl guard for node link actions — 노드 링크 http(s) 가드 헬퍼"
```

---

### Task 2: NodeActionBar 컴포넌트 + page.tsx 연결

**Files:**
- Create: `frontend/src/components/node-action-bar.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (import ~L36, state ~L677, callback ~L3120 뒤, mount L6559 뒤)
- Modify: `frontend/src/lib/i18n-messages.ts` (en `"node.collapseChildTitle"` 뒤, ko `"node.collapseChildTitle"` 뒤)

**Interfaces:**
- Consumes: `isHttpUrl` (Task 1), `useNodeActions()`의 `onToggleExpand: ((nodeId: string) => void) | null` / `expandedInlineIds: ReadonlySet<string>` (기존 `@/lib/node-actions`).
- Produces: `NodeActionBar({ readOnly: boolean; onLeaveGroups: (groupIds: string[]) => void; onOpenLink: (url: string) => void })` named export. page.tsx에 `linkPreviewUrl: string | null` state — Task 3이 소비. `data-id`: `node-action-bar`/`node-action-expand`/`node-action-link`/`node-action-leave-group` — Task 5 스모크가 소비.

- [ ] **Step 1: i18n 키 추가 (en/ko)**

`frontend/src/lib/i18n-messages.ts` — en 딕셔너리에서 `"node.collapseChildTitle": "Collapse subprocess",` 라인을 찾아(≈L262) 바로 아래 추가:

```ts
  "node.action.expand": "Expand subprocess",
  "node.action.collapse": "Collapse subprocess",
  "node.action.openLink": "Open link",
```

ko 딕셔너리에서 `"node.collapseChildTitle"` 라인(≈L1417) 바로 아래 추가:

```ts
  "node.action.expand": "하위 프로세스 펼치기",
  "node.action.collapse": "하위 프로세스 접기",
  "node.action.openLink": "링크 열기",
```

- [ ] **Step 2: NodeActionBar 컴포넌트 작성**

`frontend/src/components/node-action-bar.tsx` (전체 새 파일):

```tsx
"use client";

// 단일 선택 노드 하단 중앙의 통합 액션 바 — 하위 프로세스 펼치기/접기 → 링크 열기 → 그룹 나가기(고정 순서).
// NodeSelectionRing과 같은 store 구독 + ViewportPortal flow 좌표 패턴 — 팬/줌 정합 자동, 드래그 중 숨김.
// locked/undesignated subprocess는 기존 캔버스 동작대로 펼치기 버튼 미노출(노드 뱃지가 사유 표시).

import { useStore } from "@xyflow/react";
import { ChevronDown, Link, LogOut } from "lucide-react";

import type { NodeData } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { useNodeActions } from "@/lib/node-actions";
import { isHttpUrl } from "@/lib/url";

// 노드 하단 ↔ 바 상단 간격(px) — 스펙 12~14, 커넥터 선 7px과 시각적으로 이어지는 값
const BAR_GAP = 13;

interface BarTarget {
  id: string;
  cx: number; // 노드 하단 중앙 x (flow 좌표)
  bottom: number; // 노드 하단 y (flow 좌표)
  url?: string;
  groupIds: string[];
  groupKey: string; // eq 비교용 join — 배열 참조 변동에 둔감
  expandable: boolean; // subprocess && subEnds>0 && !locked && !undesignated
  dragging: boolean;
}

function eq(a: BarTarget | null, b: BarTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.cx === b.cx &&
    a.bottom === b.bottom &&
    a.url === b.url &&
    a.groupKey === b.groupKey &&
    a.expandable === b.expandable &&
    a.dragging === b.dragging
  );
}

export function NodeActionBar({
  readOnly,
  onLeaveGroups,
  onOpenLink,
}: {
  readOnly: boolean;
  onLeaveGroups: (groupIds: string[]) => void;
  onOpenLink: (url: string) => void;
}) {
  const { t } = useI18n();
  const { onToggleExpand, expandedInlineIds } = useNodeActions();

  // 정확히 1개 선택 + measured일 때만 대상 — 다중 선택/미측정(임베드 자식 방어)은 null
  const target = useStore((s): BarTarget | null => {
    let found: BarTarget | null = null;
    for (const n of s.nodeLookup.values()) {
      if (!n.selected) continue;
      if (found) return null; // 두 개째 발견 → 다중 선택
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      if (!w || !h) return null;
      const data = n.data as NodeData;
      found = {
        id: n.id,
        cx: n.internals.positionAbsolute.x + w / 2,
        bottom: n.internals.positionAbsolute.y + h,
        url: data.url,
        groupIds: data.groupIds,
        groupKey: data.groupIds.join(","),
        expandable:
          data.nodeType === "subprocess" &&
          (data.subEnds ?? []).length > 0 &&
          !data.locked &&
          !data.undesignated,
        dragging: n.dragging ?? false,
      };
    }
    return found;
  }, eq);

  if (!target || target.dragging) return null;

  const expanded = expandedInlineIds.has(target.id);
  const showExpand = target.expandable && onToggleExpand !== null;
  const showLink = isHttpUrl(target.url);
  const showLeave = !readOnly && target.groupIds.length > 0;
  if (!showExpand && !showLink && !showLeave) return null;

  // 액센트 버튼(펼치기·링크) 공통 — 그룹 나가기는 중립→hover 위험색
  const accentBtn =
    "pointer-events-auto inline-flex h-8 items-center gap-[7px] rounded-sm border border-accent-tint-border " +
    "bg-surface px-3 text-xs font-semibold text-accent-focus shadow-lg hover:bg-accent-tint/60";

  return (
    <div
      data-id="node-action-bar"
      className="absolute flex min-w-[172px] flex-col items-stretch gap-[7px]"
      style={{
        left: 0,
        top: 0,
        transform: `translate(${target.cx}px, ${target.bottom + BAR_GAP}px) translateX(-50%)`,
        zIndex: 8,
      }}
    >
      {/* 노드-바 커넥터 선 */}
      <div className="pointer-events-none absolute -top-[7px] left-1/2 h-[7px] w-px -translate-x-1/2 bg-accent-tint-border" />
      {showExpand && (
        <button
          type="button"
          data-id="node-action-expand"
          aria-label={t(expanded ? "node.action.collapse" : "node.action.expand")}
          onClick={() => onToggleExpand?.(target.id)}
          className={accentBtn}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-xs bg-accent-tint">
            <ChevronDown
              size={12}
              strokeWidth={1.5}
              className={`text-accent transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            />
          </span>
          {t(expanded ? "node.action.collapse" : "node.action.expand")}
        </button>
      )}
      {showLink && (
        <button
          type="button"
          data-id="node-action-link"
          aria-label={t("node.action.openLink")}
          onClick={() => onOpenLink(target.url ?? "")}
          className={accentBtn}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-xs bg-accent-tint">
            <Link size={12} strokeWidth={1.5} className="text-accent" />
          </span>
          {t("node.action.openLink")}
        </button>
      )}
      {showLeave && (
        <button
          type="button"
          data-id="node-action-leave-group"
          aria-label={t("group.leave")}
          onClick={() => onLeaveGroups(target.groupIds)}
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 text-xs font-semibold text-ink-secondary shadow-lg hover:border-error/40 hover:bg-error/10 hover:text-error"
        >
          <LogOut size={14} strokeWidth={1.5} />
          {t("group.leave")}
        </button>
      )}
    </div>
  );
}
```

주의: 버튼에 `event.stopPropagation()`을 넣지 않는다 — 같은 ViewportPortal 위치의 기존 그룹 나가기 버튼이 없이도 선택 유지가 검증된 패턴(클릭이 pane 클릭으로 잡히지 않음). `pointer-events-auto`는 기존 버튼과 동일하게 명시.

- [ ] **Step 3: page.tsx 연결 (4개 edit)**

`frontend/src/app/maps/[mapId]/page.tsx`

(a) import — `import { NodeSelectionRing } from "@/components/node-selection-ring";` (L36) 바로 아래:

```ts
import { NodeActionBar } from "@/components/node-action-bar";
```

(b) state — `const [selectedId, setSelectedId] = useState<string | null>(null);` (≈L677) 바로 위에:

```ts
  // 링크 미리보기 패널 — non-null이면 열림. 액션 바 "링크 열기"가 세팅 (Task 3에서 패널 연결)
  const [linkPreviewUrl, setLinkPreviewUrl] = useState<string | null>(null);
```

(c) callback — `leaveGroup` useCallback 닫힘(≈L3120 `);` ) 바로 아래:

```ts
  // 액션 바 "그룹 나가기" — 선택 멤버를 소속 그룹 전체에서 이탈(확정: 클릭 1회 전 그룹 탈퇴).
  // leaveGroup과 같은 경로(setNodes→pruneSmallGroups→scheduleAutoSave)를 한 번에 태운다.
  const leaveGroups = useCallback(
    (groupIds: string[]) => {
      const drop = new Set(groupIds);
      const next = nodesRef.current.map((node) =>
        node.selected && node.data.groupIds.some((id) => drop.has(id))
          ? {
              ...node,
              data: {
                ...node.data,
                groupIds: node.data.groupIds.filter((id) => !drop.has(id)),
              },
            }
          : node,
      );
      setNodes(next);
      pruneSmallGroups(next);
      scheduleAutoSave();
    },
    [setNodes, pruneSmallGroups, scheduleAutoSave],
  );
```

(d) mount — `<NodeSelectionRing />` (L6559) 바로 아래:

```tsx
                        {/* 단일 선택 노드 하단의 통합 액션 바 — 펼치기/링크/그룹 나가기 */}
                        <NodeActionBar
                          readOnly={readOnly}
                          onLeaveGroups={leaveGroups}
                          onOpenLink={setLinkPreviewUrl}
                        />
```

- [ ] **Step 4: 린트 + 테스트**

Run: `cd frontend && npm run lint && npm run test`
Expected: 0 errors (기존 `pw-smoke-task8.mjs` unused-var warning 1건은 기존 것). vitest green.

(`linkPreviewUrl` **값**은 Task 3 전까지 미사용이라 `@typescript-eslint/no-unused-vars` warning이 1건 나올 수 있다 — warning은 lint 비차단(기존 pw-smoke-task8 warning과 동일)이며 Task 3 mount에서 해소된다. 억제 주석·임시 사용 코드를 넣지 말 것.)

- [ ] **Step 5: 브라우저 스팟체크**

backend(:8000)·frontend(:3000) 기동 후 데모 맵(`/maps/4`)에서:
- subprocess 노드("주문 처리") 클릭 → 노드 아래 중앙에 바 + "Expand subprocess" 버튼, 클릭 → 인라인 펼침 + 라벨 "Collapse subprocess" 전환.
- 팬/줌 시 바가 노드에 붙어 따라오는지, 노드 드래그 중 사라지는지, 빈 캔버스 클릭 시 사라지는지.
- 다중 선택(shift+클릭 2개) 시 바 미노출.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/node-action-bar.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md docs/superpowers/plans/2026-07-06-node-action-bar-link-preview.md
git commit -m "feat(canvas): unified node action bar below focused node — 단일 선택 노드 하단 통합 액션 바"
```

---

### Task 3: LinkPreviewPanel + 로딩 keyframes + page.tsx 연결

**Files:**
- Create: `frontend/src/components/link-preview-panel.tsx`
- Modify: `frontend/src/app/globals.css` (keyframes 추가 — `@keyframes edge-row-in` 블록 뒤)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (import + mount, `</NodeActionsContext.Provider>` 직전 ≈L8078)
- Modify: `frontend/src/lib/i18n-messages.ts` (en/ko `"node.action.openLink"` 라인 뒤 — Task 2가 추가한 위치)

**Interfaces:**
- Consumes: `isHttpUrl` (Task 1), page.tsx의 `linkPreviewUrl`/`setLinkPreviewUrl` (Task 2).
- Produces: `LinkPreviewPanel({ url: string | null; onClose: () => void })` named export. `data-id="link-preview-panel"` — Task 5 스모크가 소비.

- [ ] **Step 1: i18n 키 추가 (en/ko)**

en — `"node.action.openLink": "Open link",` 바로 아래:

```ts
  "linkPreview.title": "Linked page",
  "linkPreview.openNewTab": "Open in new tab",
  "linkPreview.refresh": "Reload",
  "linkPreview.close": "Close",
  "linkPreview.back": "Back",
  "linkPreview.forward": "Forward",
  "linkPreview.loading": "Loading page",
  "linkPreview.blocked": "This site can't be embedded in preview",
```

ko — `"node.action.openLink": "링크 열기",` 바로 아래:

```ts
  "linkPreview.title": "연결된 링크",
  "linkPreview.openNewTab": "새 탭에서 열기",
  "linkPreview.refresh": "새로고침",
  "linkPreview.close": "닫기",
  "linkPreview.back": "뒤로",
  "linkPreview.forward": "앞으로",
  "linkPreview.loading": "페이지를 불러오는 중",
  "linkPreview.blocked": "이 사이트는 미리보기(임베드)를 지원하지 않습니다",
```

- [ ] **Step 2: globals.css keyframes 추가**

`frontend/src/app/globals.css` — `@keyframes edge-row-in { ... }` 라인(≈L334) 아래에:

```css
/* 링크 미리보기 패널 로딩 — 진행 바/링 회전/글로브 펄스/점 페이드 (목업 Node Focus Actions 이식) */
@keyframes lp-bar { 0% { width: 4%; } 22% { width: 38%; } 55% { width: 66%; } 100% { width: 88%; } }
@keyframes lp-spin { to { transform: rotate(360deg); } }
@keyframes lp-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.94); } 50% { opacity: 1; transform: scale(1); } }
@keyframes lp-dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
```

- [ ] **Step 3: LinkPreviewPanel 컴포넌트 작성**

`frontend/src/components/link-preview-panel.tsx` (전체 새 파일):

```tsx
"use client";

// 링크 미리보기 패널 — 노드 참조 url을 우측 슬라이드 서브 브라우저(iframe)로 열람.
// 임베드 차단(X-Frame-Options/CSP)은 크로스오리진이라 직접 감지 불가 → onLoad + 타임아웃 조합으로
// 폴백을 띄우고, "새 탭에서 열기"를 크롬·폴백 양쪽에 상시 제공한다.

import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Link,
  Lock,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { isHttpUrl } from "@/lib/url";

// load 이벤트가 이 시간 안에 안 오면 임베드 차단으로 판정(ms) — 스펙 6s
const LOAD_TIMEOUT_MS = 6000;

type LoadStatus = { key: string; state: "loaded" | "failed" } | null;

export function LinkPreviewPanel({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<LoadStatus>(null);

  // http(s)만 로드 — 액션 바와 같은 가드(스킴 XSS 차단)
  const validUrl = url !== null && isHttpUrl(url) ? url : null;
  const open = validUrl !== null;
  const currentKey = `${validUrl ?? ""}#${reloadKey}`;
  // 로딩/실패는 status↔currentKey 비교로 파생 — effect 내 동기 setState 금지(react-hooks/set-state-in-effect)
  const loaded = status?.key === currentKey && status.state === "loaded";
  const failed = status?.key === currentKey && status.state === "failed";
  const loading = open && !loaded && !failed;

  // 슬라이드 아웃 애니메이션 동안 주소 줄 유지 — 렌더 중 ref 갱신(idempotent)
  const lastUrlRef = useRef("");
  if (validUrl) lastUrlRef.current = validUrl;
  const shownUrl = validUrl ?? lastUrlRef.current;

  // 임베드 차단 타임아웃 — 만료 시점까지 이 key로 load가 안 왔으면 failed 마킹(이미 loaded면 유지)
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setStatus((prev) =>
        prev?.key === currentKey ? prev : { key: currentKey, state: "failed" },
      );
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [open, currentKey]);

  // Esc 닫기 — 열려 있는 동안만 구독
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const chromeBtn =
    "inline-flex h-7 w-7 items-center justify-center rounded-xs text-ink-tertiary " +
    "hover:bg-surface-alt hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <>
      {/* 스크림 — 클릭 시 닫힘. z는 피드백 패널(1200/1300)보다 아래 */}
      <div
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-[1100] bg-ink/20 transition-opacity duration-350 " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />
      <aside
        role="dialog"
        aria-label={t("linkPreview.title")}
        data-id="link-preview-panel"
        className={
          "fixed right-0 top-0 z-[1110] flex h-full w-[520px] flex-col border-l border-hairline " +
          "bg-surface shadow-lg transition-transform duration-350 ease-spring " +
          (open ? "translate-x-0" : "translate-x-full")
        }
      >
        {/* 로딩 진행 바 — 패널 최상단 3px, 액센트 그라데이션 */}
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px]">
            <div
              className="h-full"
              style={{
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 65%, white), var(--color-accent))",
                boxShadow: "0 0 8px color-mix(in srgb, var(--color-accent) 45%, transparent)",
                animation: "lp-bar 2.4s ease-out forwards",
              }}
            />
          </div>
        )}
        {/* 브라우저 크롬 — 타이틀 줄 + 주소 줄 */}
        <div className="shrink-0 border-b border-hairline bg-surface-pearl">
          <div className="flex h-11 items-center gap-2 pl-3 pr-2.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary">
              <Link size={14} strokeWidth={1.5} className="text-accent" />
              {t("linkPreview.title")}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (validUrl) window.open(validUrl, "_blank", "noopener");
                }}
                aria-label={t("linkPreview.openNewTab")}
                title={t("linkPreview.openNewTab")}
                className={chromeBtn}
              >
                <ExternalLink size={14} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("linkPreview.close")}
                title={t("linkPreview.close")}
                className={chromeBtn}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2.5">
            {/* iframe history는 cross-origin 접근 불가 — 뒤/앞은 비활성 고정(스펙 허용) */}
            <button type="button" disabled aria-label={t("linkPreview.back")} title={t("linkPreview.back")} className={chromeBtn}>
              <ArrowLeft size={14} strokeWidth={1.5} />
            </button>
            <button type="button" disabled aria-label={t("linkPreview.forward")} title={t("linkPreview.forward")} className={chromeBtn}>
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label={t("linkPreview.refresh")}
              title={t("linkPreview.refresh")}
              className={chromeBtn}
            >
              <RefreshCw size={13} strokeWidth={1.5} />
            </button>
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5">
              <Lock size={11} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="truncate text-fine text-ink-secondary">{shownUrl}</span>
            </div>
          </div>
        </div>
        {/* 콘텐츠 — iframe / 로딩 / 임베드 차단 폴백 */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-surface-alt">
          {validUrl && !failed && (
            <iframe
              key={currentKey}
              src={validUrl}
              title={t("linkPreview.title")}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
              onLoad={() => setStatus({ key: currentKey, state: "loaded" })}
              className={"h-full w-full border-0 bg-surface " + (loading ? "invisible" : "")}
            />
          )}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
              <div className="relative h-14 w-14">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: "2.5px solid var(--color-accent-tint)",
                    borderTopColor: "var(--color-accent)",
                    animation: "lp-spin 0.85s linear infinite",
                  }}
                />
                <Globe
                  size={30}
                  strokeWidth={1.5}
                  className="absolute inset-0 m-auto text-accent"
                  style={{ animation: "lp-pulse 1.3s ease-in-out infinite" }}
                />
              </div>
              <div className="flex items-center gap-1.5 text-caption text-ink-tertiary">
                {t("linkPreview.loading")}
                <span className="inline-flex items-center gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-[3px] w-[3px] rounded-full bg-accent"
                      style={{ animation: `lp-dot 1.1s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          {failed && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="flex w-full max-w-[360px] flex-col items-center gap-3 rounded-md bg-surface p-6 text-center shadow-md">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-accent-tint">
                  <Globe size={24} strokeWidth={1.5} className="text-accent" />
                </span>
                <p className="text-caption text-ink-secondary">{t("linkPreview.blocked")}</p>
                <div className="w-full truncate rounded-xs border border-hairline bg-surface-alt px-2.5 py-1.5 text-fine text-ink-tertiary">
                  {shownUrl}
                </div>
                <button
                  type="button"
                  onClick={() => window.open(shownUrl, "_blank", "noopener")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-focus"
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                  {t("linkPreview.openNewTab")}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 4: page.tsx 연결 (2개 edit)**

(a) import — Task 2에서 넣은 `import { NodeActionBar } ...` 바로 아래:

```ts
import { LinkPreviewPanel } from "@/components/link-preview-panel";
```

(b) mount — 파일 끝부분 `</NodeActionsContext.Provider>` (≈L8079) **바로 위**(csvConfirmOpen ConfirmDialog 블록 뒤):

```tsx
      {/* 링크 미리보기 — 액션 바 "링크 열기"로 오픈, 인스펙터 포함 우측 전체를 덮는 오버레이 */}
      <LinkPreviewPanel url={linkPreviewUrl} onClose={() => setLinkPreviewUrl(null)} />
```

- [ ] **Step 5: 린트 + 테스트 + 브라우저 스팟체크**

Run: `cd frontend && npm run lint && npm run test`
Expected: 0 errors, vitest green.

브라우저(`/maps/4`): 아무 노드 선택 → 인스펙터 URL 필드에 `https://example.com` 입력 → 바에 "Open link" 버튼 등장 → 클릭 → 패널 슬라이드 인 + 로딩(진행 바·글로브 스피너·점 3개) → example.com 렌더. 새로고침 버튼 → 로딩 재진입. Esc → 슬라이드 아웃, 캔버스 선택 유지 확인. 임베드 차단 URL(`https://google.com`) 입력 → 6s 후 폴백 카드 + "새 탭에서 열기" 동작. 스크림 클릭 닫기 확인. URL 필드 비우고 원복.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/link-preview-panel.tsx frontend/src/app/globals.css "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md docs/superpowers/plans/2026-07-06-node-action-bar-link-preview.md
git commit -m "feat(canvas): right slide-in link preview browser panel — 우측 슬라이드 링크 미리보기 패널"
```

---

### Task 4: 기존 버튼 위치 제거 + 고아 정리

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (L3 import, L3104–3120, L3168 주석, L5330–5337, L6628–6649)
- Modify: `frontend/src/components/process-node.tsx` (L9–10 import, L333–358, L458–464, L502–503, L541)

**Interfaces:**
- Consumes: Task 2의 액션 바가 대체 UI로 이미 동작 중이어야 함(순서 의존).
- Produces: 없음(제거 전용). `LockedBadge`/`UndesignatedBadge`/`node.childBadge` 표시는 그대로 유지.

- [ ] **Step 1: page.tsx 그룹 모서리 버튼 + leaveGroup + selectedGroupIds 제거**

(a) L6628–6649 블록 삭제 (`{/* 그룹 나가기 — 박스 경계 우측 위 모서리 ... */}` 주석부터 `)}`까지 — `selectedGroupIds.has(box.id) && !readOnly` 조건 블록 전체).

(b) L3104–3120 삭제 — `// 선택된 멤버 노드에서 이 그룹 태그만 제거...` 주석 + `const leaveGroup = useCallback(...)` 전체 (이제 유일 콜사이트가 (a)에서 사라짐. Task 2의 `leaveGroups`는 유지).

(c) L3168 주석 갱신: `leaveGroup(선택 멤버만 이탈)과 구분` → `leaveGroups(선택 멤버만 이탈)과 구분`.

(d) L5330–5337 삭제 — `// 선택된 멤버가 가진 그룹 태그(합집합)...` 주석 + `selectedGroupIds` useMemo (유일 콜사이트가 (a)).
검증: `command grep -n "selectedGroupIds\|leaveGroup\b" "src/app/maps/[mapId]/page.tsx"` → `leaveGroups`만 남아야 함.

(e) L3 lucide import에서 `LogOut, ` 제거 (다른 사용처 없음 — 사전 확인됨).

- [ ] **Step 2: process-node.tsx ExpandToggleButton 제거**

(a) L333–358 삭제 — `// 호버 시 노드 우상단에 뜨는 인라인 펼치기/접기 토글...` 주석 + `function ExpandToggleButton(...)` 전체.

(b) subprocess 분기(L458–464)를 다음으로 교체 — 뱃지 우선순위 주석과 뱃지는 유지:

```tsx
        {/* 미지정 경고가 권한 잠금보다 우선 — 원인(지정 해제)을 보여야 오너가 조치 가능 */}
        {data.undesignated ? (
          <UndesignatedBadge />
        ) : data.locked ? (
          <LockedBadge />
        ) : null}
```

(c) decision 분기 — L502–503 두 줄 삭제 (`{/* decision 노드는 기존 하위가 있을 때만 펼침 토글 */}` + `{data.hasChildren && <ExpandToggleButton nodeId={id} />}`). ※ 죽은 코드 — 백엔드가 `has_children`을 안 보내 항상 false.

(d) process/terminal 분기 — L541 `{data.hasChildren && <ExpandToggleButton nodeId={id} />}` 삭제 (동일하게 죽은 코드).

(e) import 정리 — `command grep -n "ChevronDown\|ChevronRight" src/components/process-node.tsx` 로 남은 사용처 0 확인 후 L9–10에서 `ChevronDown,`/`ChevronRight,` 제거. `useNodeActions`는 다른 사용처(이름 편집 등)가 있으므로 **유지** (`command grep -c "useNodeActions" src/components/process-node.tsx`로 확인).

- [ ] **Step 3: 미사용 i18n 키 확인**

Run: `command grep -rn "expandChildTitle\|collapseChildTitle" frontend/src/`
- 사용처 0이면 `node.expandChildTitle`/`node.collapseChildTitle` en+ko 4줄 삭제.
- 아웃라인 등 다른 사용처가 있으면 유지.

- [ ] **Step 4: 린트 + 테스트 + 브라우저 스팟체크**

Run: `cd frontend && npm run lint && npm run test`
Expected: 0 errors (unused import 잔재 없음), vitest green.

브라우저(`/maps/4`): subprocess 노드 호버 → 우상단 토글 **안 뜸**, locked/undesignated 뱃지는 유지. 그룹 박스 모서리에 나가기 버튼 **안 뜸**. 액션 바 경로로 펼침·(그룹 노드 있으면) 나가기 정상.

- [ ] **Step 5: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/components/process-node.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md docs/superpowers/plans/2026-07-06-node-action-bar-link-preview.md
git commit -m "refactor(canvas): remove old expand toggle + group-corner leave button — 구 버튼 위치 제거(액션 바로 이관)"
```

---

### Task 5: 스모크 테스트 + 최종 검증

**Files:**
- Create: `frontend/scripts/pw-smoke-node-action-bar.mjs`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (L7268 인스펙터 필드 input에 data-id 1줄 — 셀렉터 안정화, data-id 컨벤션)

**Interfaces:**
- Consumes: Task 2·3의 `data-id` 4종(`node-action-bar`/`node-action-expand`/`node-action-link`/`link-preview-panel`).
- Produces: `node scripts/pw-smoke-node-action-bar.mjs` 스모크 1본, `data-id="inspector-field-url"` (필드 키별 `inspector-field-${key}`).

- [ ] **Step 1: 인스펙터 필드 input에 data-id 부여**

page.tsx L7268 `<input` (system/duration/url 공통 map 루프)에 속성 추가:

```tsx
                              <input
                                data-id={`inspector-field-${key}`}
                                className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink hover:bg-surface-alt focus:bg-surface-alt focus:outline-none disabled:hover:bg-transparent"
```

- [ ] **Step 2: 스모크 스크립트 작성**

`frontend/scripts/pw-smoke-node-action-bar.mjs` (전체 새 파일 — pw-smoke-demo.mjs 컨벤션):

```js
// 노드 액션 바 + 링크 미리보기 스모크 — 단일 선택 시 바 노출·버튼 순서(펼치기→링크), subprocess 펼침 토글,
// URL 입력→링크 열기→패널 오픈·주소 표기·Esc 닫기, 콘솔 에러 0 검증.
// 그룹 나가기는 데모 시드에 그룹이 없어 수동 시현으로 검증(플랜 Task 5 Step 4).
// 실행: node scripts/pw-smoke-node-action-bar.mjs  (backend 8000 + frontend 3000 기동, 데모 시드 map 4 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let failed = false;
const fail = (msg) => {
  console.error("FAIL:", msg);
  failed = true;
};

await page.goto("http://localhost:3000/maps/4", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(3000); // 측정/레이아웃 + subprocess 메타 로드 안정화

// (a) subprocess 노드 선택 → 액션 바 + 펼치기 버튼
const subNode = page.locator(".react-flow__node", { hasText: "주문 처리" }).first();
await subNode.click();
const bar = page.locator('[data-id="node-action-bar"]');
await bar.waitFor({ timeout: 5000 }).catch(() => fail("action bar did not appear"));
const expandBtn = page.locator('[data-id="node-action-expand"]');
if (!(await expandBtn.isVisible().catch(() => false))) fail("expand button not visible on subprocess node");

// (b) URL 세팅(인스펙터, 자동저장 경로) → 링크 버튼 노출 + 순서 확인
const urlInput = page.locator('[data-id="inspector-field-url"]');
await urlInput.fill("https://example.com/");
await page.waitForTimeout(500); // 상태 반영
const ids = await bar.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
// 순서 고정: 펼치기 → 링크 (그룹 나가기는 이 노드에 없음)
if (ids.join(",") !== "node-action-expand,node-action-link") fail(`button order wrong: ${ids.join(",")}`);

// (c) 펼침 토글 — aria-label이 collapse로 전환
await expandBtn.click();
await page.waitForTimeout(1500);
const label = await expandBtn.getAttribute("aria-label");
if (!/collapse|접기/i.test(label ?? "")) fail(`expand did not toggle: ${label}`);
await expandBtn.click(); // 원복
await page.waitForTimeout(800);

// (d) 링크 열기 → 패널 오픈 + 주소 표기 + iframe → Esc 닫기
await page.locator('[data-id="node-action-link"]').click();
const panel = page.locator('[data-id="link-preview-panel"]');
await page.waitForTimeout(600); // 슬라이드 인
if (!((await panel.getAttribute("class")) ?? "").includes("translate-x-0")) fail("panel did not open");
if ((await panel.locator("iframe").count()) === 0) fail("iframe not rendered");
if (!(await panel.getByText("https://example.com").first().isVisible().catch(() => false)))
  fail("address bar url missing");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
if (((await panel.getAttribute("class")) ?? "").includes("translate-x-0")) fail("panel did not close on Esc");

// (e) 다중 선택 시 바 숨김 — RF 기본 multiSelectionKeyCode는 Mac에서 Meta(에디터 오버라이드 없음)
const anyOther = page.locator(".react-flow__node", { hasText: "배송" }).first();
await anyOther.click({ modifiers: ["Meta"] });
await page.waitForTimeout(300);
if (await bar.isVisible().catch(() => false)) fail("bar visible on multi-select");

// URL 원복 — 데모 시드 오염 방지
await subNode.click();
await urlInput.fill("");
await page.waitForTimeout(600);

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
await browser.close();
if (failed) process.exit(1);
console.log("PASS: node action bar + link preview smoke");
```

- [ ] **Step 3: 스모크 실행**

backend·frontend 기동 확인 후(좀비 next dev 주의 — 3000 포트 선점 시 전수 `pkill -f "next dev"` 후 재기동, `docs/lessons/browser-verification.md`):

Run: `cd frontend && node scripts/pw-smoke-node-action-bar.mjs`
Expected: `PASS: node action bar + link preview smoke`

- [ ] **Step 4: 그룹 나가기 수동 검증**

`/maps/4`(또는 아무 편집 가능 맵)에서: 노드 2개 shift 선택 → 컨텍스트 메뉴로 그룹 생성 → 멤버 노드 1개 단일 선택 → 액션 바 맨 아래 "그룹 나가기"(중립색, hover 시 위험색) 클릭 → 노드가 그룹에서 빠지고 그룹 박스가 남은 멤버 기준으로 갱신(1개 남으면 그룹 자동 해체) → 저장 토스트/새로고침 후 유지 확인. readOnly 화면(뷰어 계정 또는 게시 버전)에서 그룹 멤버 선택 시 "그룹 나가기" 미노출 + 펼치기/링크는 노출 확인.

- [ ] **Step 5: 전체 검증 + 빌드**

```bash
cd frontend && npm run lint && npm run test && npm run build
```
Expected: 모두 클린(React Compiler 포함). 기존 스모크 회귀 1본 실행: `node scripts/pw-smoke-demo.mjs` → PASS 유지.

- [ ] **Step 6: 커밋**

```bash
git add frontend/scripts/pw-smoke-node-action-bar.mjs "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md docs/superpowers/plans/2026-07-06-node-action-bar-link-preview.md
git commit -m "test(canvas): node action bar + link preview smoke — 액션 바·미리보기 스모크 및 인스펙터 data-id"
```
