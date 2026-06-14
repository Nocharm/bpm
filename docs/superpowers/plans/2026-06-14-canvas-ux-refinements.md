# 캔버스 UX 정제 4종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터 캔버스의 4가지 사용성 문제(최소화 산만함, 아웃라인 깜빡임, 더블클릭 오용, 드롭존 과민)를 해결한다.

**Architecture:** 순수 프론트엔드. 신규 presentational 컴포넌트 2개(`window-dock`, `node-summary-modal`)와 순수 헬퍼 1개(`pickDropZone`), 나머지는 `page.tsx`/`scope-window.tsx` 수정. 기존 API(`listComments`/`createComment`/`getFullGraph`)와 `ScopePreview` 재사용.

**Tech Stack:** Next.js(16, Turbopack) + React + TypeScript + @xyflow/react. 검증: `npm run lint`(eslint) + `npm run build`(tsc/Turbopack). 순수 헬퍼는 `bun` 단발 실행으로 검증(프로젝트에 커밋된 테스트 하니스 없음 — 새 프레임워크 도입 금지). 인터랙션은 원격이라 로컬(Windows) 수동 확인.

**Spec:** `docs/superpowers/specs/2026-06-14-canvas-ux-refinements-design.md`

**Branch:** `feat/canvas-ux` (현재 브랜치 그대로 진행)

---

## 공통 사전 지식 (작업 전 반드시 읽기)

- 모든 명령은 저장소 루트(`/Users/hyeonjin/Documents/bpm`)에서. 프론트 명령은 `cd frontend && <cmd>` 형태로 절대경로 사용(셸 cwd가 호출 간 바뀌면 절대경로로 복귀).
- 주 편집 파일 `frontend/src/app/maps/[mapId]/page.tsx`는 경로에 `[mapId]` 대괄호가 있어 zsh에서 `grep`이 안 먹는다. **검색은 `git grep -nE "패턴" -- 'frontend/src/app/maps/[mapId]/page.tsx'`** 사용. 라인 번호는 편집이 누적되며 밀리므로, 각 Step은 라인 대신 **앵커 코드 문자열**로 위치를 잡는다.
- i18n 키는 `frontend/src/lib/i18n-messages.ts`의 `en`(권위, 상단)과 `ko`(하단, ~250줄) 두 블록에 **둘 다** 추가/삭제해야 한다(tsc가 키 누락을 강제). 키 추가는 두 블록 동일 키.
- 디자인 룰(`rules/frontend/design.md`): raw hex 금지(토큰 클래스/`var(--color-*)`), 굵기 300/400/600, Lucide 16px strokeWidth 1.5, elevation은 `--shadow-sm/md/lg`, UI 영어. 새 컴포넌트는 이 규칙 준수.
- 각 Task는 독립 커밋. 커밋 직전 `PROGRESS.md` 갱신(`rules/common/git.md`). 커밋 메시지 형식: `type(scope): English — 한국어`, 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

| 파일 | 역할 | Task |
|------|------|------|
| `frontend/src/app/maps/[mapId]/page.tsx` | 에디터 오케스트레이션 — 모든 와이어링 | 1,2,3,4,5 |
| `frontend/src/components/process-node.tsx` | 연결 소스 링 제거 | 1 |
| `frontend/src/lib/node-actions.ts` | `connectSource` 컨텍스트 필드 제거 | 1 |
| `frontend/src/lib/i18n-messages.ts` | 키 추가/제거(en+ko) | 1,2,3 |
| `frontend/src/components/node-summary-modal.tsx` | **신규** 노드 요약 모달 | 2 |
| `frontend/src/components/window-dock.tsx` | **신규** 좌하단 최소화 dock | 3 |
| `frontend/src/components/scope-window.tsx` | 최소화 제자리 렌더 제거 | 3 |
| `frontend/src/lib/canvas.ts` | **신규 순수함수** `pickDropZone` | 5 |
| `frontend/src/app/globals.css` | 아웃라인 고스트 dim | 4 |

---

## Task 1: 더블클릭=연결 모드 전체 제거 (#3a)

**근거:** 연결은 핸들 드래그(`onConnect`)만 유지. 더블클릭 연결 일체 제거 → Task 2에서 더블클릭을 모달로 재사용.

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/components/process-node.tsx`
- Modify: `frontend/src/lib/node-actions.ts`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: `node-actions.ts`에서 connectSource 제거**

`frontend/src/lib/node-actions.ts` 전체를 다음으로 교체:

```ts
// 노드(ProcessNode)→에디터 통신 — 드릴 트리거. Provider 없으면 no-op(compare 안전).
"use client";

import { createContext, useContext } from "react";

export interface NodeActions {
  onDrill: ((nodeId: string, clientX: number, clientY: number) => void) | null;
}

const defaultActions: NodeActions = { onDrill: null };

export const NodeActionsContext = createContext<NodeActions>(defaultActions);

export function useNodeActions(): NodeActions {
  return useContext(NodeActionsContext);
}
```

- [ ] **Step 2: `process-node.tsx`에서 소스 링 제거**

`frontend/src/components/process-node.tsx`에서 다음 줄 제거:
```ts
  const { connectSource } = useNodeActions();
```
그리고 `ring` 계산에서 connectSource 분기 제거 — 다음 블록을:
```ts
  const ring =
    connectSource === id
      ? "ring-2 ring-accent"
      : data.diffStatus
        ? DIFF_RINGS[data.diffStatus]
        : selected
          ? "ring-2 ring-accent"
          : "";
```
이것으로 교체:
```ts
  const ring = data.diffStatus
    ? DIFF_RINGS[data.diffStatus]
    : selected
      ? "ring-2 ring-accent"
      : "";
```
`useNodeActions` import는 `DrillButton`에서 계속 쓰므로 유지.

- [ ] **Step 3: `page.tsx` — connectSource state·completeConnect 제거**

`git grep -nE "connectSource|completeConnect" -- 'frontend/src/app/maps/[mapId]/page.tsx'` 로 모든 사용처 확인. 제거 대상:

(a) state 선언 삭제:
```ts
  const [connectSource, setConnectSource] = useState<string | null>(null);
```
(b) `completeConnect` useCallback 전체 삭제(주석 `// 연결 모드 완료 — connectSource→target 엣지 생성(one-shot)` 포함 ~18줄).
(c) `focusScope` 첫 줄 `setConnectSource(null);` 삭제.
(d) Esc 핸들러 블록을:
```ts
      if (event.key === "Escape") {
        setConnectSource(null);
        setPending(null);
        return;
      }
```
이것으로 교체:
```ts
      if (event.key === "Escape") {
        setPending(null);
        return;
      }
```

- [ ] **Step 4: `page.tsx` — click 핸들러·배너·컨텍스트 정리**

(a) `onNodeClick` 핸들러를:
```tsx
                      onNodeClick={(_, node) => {
                        if (connectSource && connectSource !== node.id) {
                          completeConnect(node.id);
                          return;
                        }
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                      }}
```
이것으로 교체:
```tsx
                      onNodeClick={(_, node) => {
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                      }}
```
(b) `onNodeDoubleClick` 핸들러 블록 전체 삭제(Task 2에서 재추가):
```tsx
                      onNodeDoubleClick={(_, node) => {
                        if (readOnly) {
                          return;
                        }
                        setConnectSource(node.id);
                      }}
```
(c) `onPaneClick`에서 `setConnectSource(null);` 줄 삭제.
(d) 연결 배너 JSX 블록 삭제:
```tsx
          {connectSource && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-accent/10 px-2 py-1 text-caption text-accent">
              <Spline size={14} strokeWidth={1.5} />
              {t("connect.banner", {
                name: nodes.find((node) => node.id === connectSource)?.data.label ?? "",
              })}
            </span>
          )}
```
(e) `NodeActionsContext.Provider` value를 `git grep -nE "onDrill: handleDrillById, connectSource" -- '...page.tsx'`로 찾아:
```ts
    () => ({ onDrill: handleDrillById, connectSource }),
    [handleDrillById, connectSource],
```
이것으로 교체:
```ts
    () => ({ onDrill: handleDrillById }),
    [handleDrillById],
```

- [ ] **Step 5: 미사용 import 정리**

`Spline`이 배너 외에 안 쓰이면 page.tsx 상단 lucide import에서 제거. 확인: `git grep -nE "Spline" -- 'frontend/src/app/maps/[mapId]/page.tsx'` → import 줄만 남으면 제거.

- [ ] **Step 6: i18n `connect.banner` 제거**

`frontend/src/lib/i18n-messages.ts`에서 en·ko 양쪽의 `"connect.banner": ...` 줄 삭제(2개).

- [ ] **Step 7: lint + build 검증**

```bash
cd frontend && npm run lint && npm run build
```
Expected: lint 출력 없음(통과), build `✓ Compiled successfully` + `Finished TypeScript`. connectSource 잔존 참조가 있으면 tsc가 에러로 잡는다.

- [ ] **Step 8: 커밋**

PROGRESS.md의 `## 2026-06-14` 최상단에 한 줄 추가:
```
- 더블클릭=연결 모드 제거 (브랜치 `feat/canvas-ux`). 노드 연결은 핸들 드래그(onConnect)만 유지. connectSource state·completeConnect·연결 배너·NodeActionsContext.connectSource·process-node 소스 링·connect.banner i18n 제거. 더블클릭은 Task 2에서 요약 모달로 재사용. 검증: lint/build green.
```
```bash
cd /Users/hyeonjin/Documents/bpm
git add PROGRESS.md frontend/src/lib/node-actions.ts frontend/src/components/process-node.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -F - <<'EOF'
refactor(canvas): remove double-click connect mode, keep handle-drag only — 더블클릭 연결 모드 제거

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: 노드 요약 모달 (#3b)

**Files:**
- Create: `frontend/src/components/node-summary-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts` en 블록(`"node.childChangedTitle"` 근처)에 추가:
```ts
  "summary.predecessors": "Previous steps",
  "summary.successors": "Next steps",
  "summary.subprocess": "Sub-process",
  "summary.comments": "Comments",
  "summary.addComment": "Add comment",
  "summary.commentPlaceholder": "Write a comment…",
  "summary.submit": "Post",
  "summary.cancel": "Cancel",
  "summary.none": "None",
  "summary.type": "Type",
  "summary.group": "Group",
  "summary.close": "Close",
```
ko 블록에 동일 키:
```ts
  "summary.predecessors": "이전 단계",
  "summary.successors": "다음 단계",
  "summary.subprocess": "하위 프로세스",
  "summary.comments": "코멘트",
  "summary.addComment": "코멘트 추가",
  "summary.commentPlaceholder": "코멘트를 입력하세요…",
  "summary.submit": "등록",
  "summary.cancel": "취소",
  "summary.none": "없음",
  "summary.type": "유형",
  "summary.group": "그룹",
  "summary.close": "닫기",
```

- [ ] **Step 2: 모달 컴포넌트 생성**

`frontend/src/components/node-summary-modal.tsx`:

```tsx
"use client";

// 노드 더블클릭 요약 모달 — 전/후 단계, 하위 프로세스 프리뷰, 코멘트(읽기+추가), 메타.
// 바깥 클릭/Esc로 닫힘. readOnly면 코멘트 추가 숨김.

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { createComment, listComments, type CommentItem, type VersionGraph } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ScopePreview } from "@/components/scope-preview";

interface NodeSummaryModalProps {
  versionId: number;
  nodeId: string;
  title: string;
  typeLabel: string;
  groupLabel: string | null;
  predecessors: string[];
  successors: string[];
  hasChildren: boolean;
  fullGraph: VersionGraph | null;
  readOnly: boolean;
  onClose: () => void;
}

export function NodeSummaryModal({
  versionId,
  nodeId,
  title,
  typeLabel,
  groupLabel,
  predecessors,
  successors,
  hasChildren,
  fullGraph,
  readOnly,
  onClose,
}: NodeSummaryModalProps) {
  const { t } = useI18n();
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 해당 노드 코멘트 로드(진입 1회) — 실패해도 모달은 동작(빈 목록)
  useEffect(() => {
    let alive = true;
    void listComments(versionId)
      .then((all) => {
        if (alive) {
          setComments(all.filter((comment) => comment.node_id === nodeId));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [versionId, nodeId]);

  // Esc로 닫기
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const created = await createComment(versionId, nodeId, body);
      setComments((current) => [...current, created]);
      setDraft("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[1200] flex items-center justify-center bg-ink/20"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80%] w-[420px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg"
        style={{ boxShadow: "var(--shadow-lg)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="flex-1 truncate text-body-strong text-ink">{title}</span>
          <button
            type="button"
            title={t("summary.close")}
            aria-label={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-caption text-ink-secondary">
          <div className="flex gap-4">
            <span><span className="text-fine text-ink-tertiary">{t("summary.type")}:</span> {typeLabel}</span>
            {groupLabel && (
              <span><span className="text-fine text-ink-tertiary">{t("summary.group")}:</span> {groupLabel}</span>
            )}
          </div>

          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.predecessors")}</div>
            <div className="text-ink">{predecessors.length ? predecessors.join(", ") : t("summary.none")}</div>
          </div>
          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.successors")}</div>
            <div className="text-ink">{successors.length ? successors.join(", ") : t("summary.none")}</div>
          </div>

          {hasChildren && (
            <div>
              <div className="text-fine text-ink-tertiary">{t("summary.subprocess")}</div>
              <div className="mt-1 h-32 overflow-hidden rounded-sm border border-hairline">
                <ScopePreview fullGraph={fullGraph} scopeParentId={nodeId} />
              </div>
            </div>
          )}

          <div>
            <div className="text-fine text-ink-tertiary">{t("summary.comments")}</div>
            {comments.length === 0 && <div className="text-ink-tertiary">{t("summary.none")}</div>}
            <ul className="mt-1 flex flex-col gap-1">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-sm bg-surface-alt px-2 py-1">
                  <span className="text-fine text-ink-tertiary">{comment.author}</span>
                  <div className="text-ink">{comment.body}</div>
                </li>
              ))}
            </ul>
            {!readOnly && !adding && (
              <button
                type="button"
                className="mt-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
                onClick={() => setAdding(true)}
              >
                {t("summary.addComment")}
              </button>
            )}
            {!readOnly && adding && (
              <div className="mt-1 flex flex-col gap-1">
                <textarea
                  className="rounded-sm border border-hairline px-2 py-1 text-caption"
                  rows={2}
                  placeholder={t("summary.commentPlaceholder")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoFocus
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-sm bg-accent px-2 py-1 text-fine text-white disabled:opacity-50"
                    disabled={submitting || !draft.trim()}
                    onClick={() => void submitComment()}
                  >
                    {t("summary.submit")}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary"
                    onClick={() => { setAdding(false); setDraft(""); }}
                  >
                    {t("summary.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

참고: `bg-ink/20`, `bg-accent`, `text-white`가 토큰 클래스로 존재하는지 확인. 없으면 `style={{ background: "var(--color-ink)", opacity }}` 또는 기존 컴포넌트(예: context-menu, comment-section)에서 쓰는 backdrop/버튼 클래스를 그대로 차용. `git grep -nE "bg-ink/|bg-accent\b|text-white" -- frontend/src` 로 선례 확인 후 일치시킨다.

- [ ] **Step 3: page.tsx — 모달 상태·파생값·더블클릭·렌더 와이어링**

(a) state 추가(다른 useState 근처):
```ts
  const [summaryNodeId, setSummaryNodeId] = useState<string | null>(null);
```
(b) `onNodeDoubleClick` 재추가(Task 1에서 삭제한 자리, `onNodeClick` 다음):
```tsx
                      onNodeDoubleClick={(_, node) => setSummaryNodeId(node.id)}
```
(c) `onPaneClick`에 모달 닫기 추가:
```tsx
                        setSummaryNodeId(null);
```
(d) 파생값 — 모달 렌더 직전(컴포넌트 return 내, ScopeWindow 매핑 바깥 캔버스 컨테이너 안)에서 계산. `displayNodes`/`nodes`·`edges`·`groups`·`fullGraph` 접근 가능 위치에 둔다:
```tsx
          {summaryNodeId && versionId !== null && (() => {
            const node = nodes.find((n) => n.id === summaryNodeId);
            if (!node) {
              return null;
            }
            const predecessors = edges
              .filter((edge) => edge.target === summaryNodeId)
              .map((edge) => nodes.find((n) => n.id === edge.source)?.data.label ?? "")
              .filter(Boolean);
            const successors = edges
              .filter((edge) => edge.source === summaryNodeId)
              .map((edge) => nodes.find((n) => n.id === edge.target)?.data.label ?? "")
              .filter(Boolean);
            const hasChildren = (fullGraph?.nodes ?? []).some((n) => n.parent_node_id === summaryNodeId);
            const groupLabel = node.data.groupId
              ? groups.find((g) => g.id === node.data.groupId)?.label ?? null
              : null;
            return (
              <NodeSummaryModal
                versionId={versionId}
                nodeId={summaryNodeId}
                title={node.data.label}
                typeLabel={t(NODE_TYPE_LABEL_KEY[node.data.nodeType])}
                groupLabel={groupLabel}
                predecessors={predecessors}
                successors={successors}
                hasChildren={hasChildren}
                fullGraph={fullGraph}
                readOnly={readOnly}
                onClose={() => setSummaryNodeId(null)}
              />
            );
          })()}
```
(e) import 추가:
```ts
import { NodeSummaryModal } from "@/components/node-summary-modal";
```
(f) `NODE_TYPE_LABEL_KEY`: 노드 타입→i18n 키 매핑이 이미 있으면 재사용. 없으면 `node.data.nodeType` 문자열을 그대로 typeLabel로 넘기고 `typeLabel={node.data.nodeType}`로 단순화(추가 i18n 불필요). `git grep -nE "labelKey|NODE_TYPE" -- frontend/src/lib/canvas.ts` 로 기존 매핑 확인 후 결정 — 있으면 그것을, 없으면 raw nodeType 문자열.

- [ ] **Step 4: lint + build 검증**

```bash
cd frontend && npm run lint && npm run build
```
Expected: green. 누락 토큰 클래스/타입 에러는 여기서 잡힌다 — Step 2 참고로 클래스 교정.

- [ ] **Step 5: 커밋**

PROGRESS.md `## 2026-06-14` 최상단에 추가:
```
- 노드 더블클릭 요약 모달 추가 (브랜치 `feat/canvas-ux`). 신규 node-summary-modal.tsx — 전/후 단계, 하위 프로세스 ScopePreview 썸네일, 코멘트 읽기 목록 + 인라인 추가(createComment), 노드 타입·그룹 메타. 바깥 클릭/Esc 닫힘, readOnly면 추가 숨김. 검증: lint/build green. 인터랙션 로컬 확인 필요.
```
```bash
cd /Users/hyeonjin/Documents/bpm
git add PROGRESS.md frontend/src/components/node-summary-modal.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -F - <<'EOF'
feat(canvas): node double-click summary modal (steps, sub-process, comments) — 더블클릭 요약 모달

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: 최소화 → 좌하단 dock (#1)

**Files:**
- Create: `frontend/src/components/window-dock.tsx`
- Modify: `frontend/src/components/scope-window.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: i18n `window.restore` 추가**

en 블록 `"window.clickToEdit"` 근처:
```ts
  "window.restore": "Restore",
```
ko 블록:
```ts
  "window.restore": "복원",
```

- [ ] **Step 2: dock 컴포넌트 생성**

`frontend/src/components/window-dock.tsx`:
```tsx
"use client";

// 최소화된 스코프 창들의 좌하단 dock — 칩 클릭 시 복원. presentational.

import { Square } from "lucide-react";

import { useI18n } from "@/lib/i18n";

interface WindowDockProps {
  items: { key: string; title: string }[];
  onRestore: (key: string) => void;
}

export function WindowDock({ items, onRestore }: WindowDockProps) {
  const { t } = useI18n();
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="absolute bottom-2 left-2 z-[1100] flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          title={t("window.restore")}
          className="inline-flex max-w-[160px] items-center gap-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink-secondary shadow-sm hover:bg-surface-alt"
          onClick={() => onRestore(item.key)}
        >
          <Square size={12} strokeWidth={1.5} />
          <span className="truncate">{item.title}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: scope-window.tsx — 최소화 제자리 렌더 제거**

`frontend/src/components/scope-window.tsx`에서:
(a) `rect` 계산의 minimized 분기 제거:
```ts
  const rect = geom.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h }
    : {
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.minimized ? undefined : geom.h,
      };
```
이것으로 교체:
```ts
  const rect = geom.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h }
    : { left: geom.x, top: geom.y, width: geom.w, height: geom.h };
```
(b) 본문/리사이즈의 `!geom.minimized` 가드 제거 — 다음 두 군데를 풀어 항상 렌더:
```tsx
      {!geom.minimized && (
        <div className="relative flex-1">
          {children}
          ...
        </div>
      )}
```
→ 가드 없이:
```tsx
      <div className="relative flex-1">
        {children}
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
            {t("window.clickToEdit")}
          </div>
        )}
      </div>
```
그리고:
```tsx
      {!geom.minimized && !geom.maximized && (
        <div className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize" ... />
      )}
```
→
```tsx
      {!geom.maximized && (
        <div
          className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
          onPointerDown={startDrag}
          onPointerMove={resizeWindow}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      )}
```
(최소화 표현은 이제 page+dock이 담당. `toggleMin`/최소화 버튼은 그대로 둬 `geom.minimized=true`만 설정.)

- [ ] **Step 4: page.tsx — 최소화 창은 dock으로 분기**

(a) ScopeWindow 매핑 콜백 안, `const active = ...` 다음에 minimized 스킵 추가:
```tsx
            const active = index === activeIndex;
            if (geom.minimized && index !== 0) {
              return null; // 최소화 창은 아래 WindowDock으로 렌더
            }
```
(b) `scopes.map(...)` 닫힌 직후(같은 캔버스 컨테이너 안, ScopeWindow들 다음)에 dock 렌더:
```tsx
          <WindowDock
            items={scopes
              .map((scope, index) => ({ scope, index, key: scopeKey(scope) }))
              .filter(({ index, key }) => index !== 0 && (windowGeom[key] ?? defaultGeom(index, bounds)).minimized)
              .map(({ scope, key }) => ({ key, title: scope.title }))}
            onRestore={(key) => {
              setWindowGeom((map) => ({
                ...map,
                [key]: { ...(map[key] ?? {}), minimized: false } as WindowGeom,
              }));
              bringToFront(key);
            }}
          />
```
(c) import 추가:
```ts
import { WindowDock } from "@/components/window-dock";
```
주의: `onRestore`의 `map[key]`가 없을 수 있으니 `defaultGeom`로 폴백하는 편이 안전. 만약 `map[key]`가 undefined면 복원해도 기하가 없어 깨질 수 있다 — 더 안전하게:
```tsx
            onRestore={(key) => {
              setWindowGeom((map) => {
                const idx = scopes.findIndex((scope) => scopeKey(scope) === key);
                const base = map[key] ?? defaultGeom(idx, bounds);
                return { ...map, [key]: { ...base, minimized: false } };
              });
              bringToFront(key);
            }}
```
이 안전한 버전을 사용.

- [ ] **Step 5: lint + build 검증**

```bash
cd frontend && npm run lint && npm run build
```
Expected: green.

- [ ] **Step 6: 커밋**

PROGRESS.md 추가:
```
- 창 최소화 → 좌하단 dock 스택 (브랜치 `feat/canvas-ux`). 최소화 시 제자리 접힘 대신 신규 window-dock.tsx 칩으로 좌하단에 쌓이고, 칩 클릭 시 복원+포커스. scope-window.tsx의 minimized 제자리 렌더 제거. 검증: lint/build green. 인터랙션 로컬 확인 필요.
```
```bash
cd /Users/hyeonjin/Documents/bpm
git add PROGRESS.md frontend/src/components/window-dock.tsx frontend/src/components/scope-window.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -F - <<'EOF'
feat(canvas): minimized windows stack into bottom-left dock — 최소화 좌하단 dock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: 아웃라인 고스트 + refetch 절감 (#2)

**근거:** 스코프 전환 시 라이브 `nodes` 공백 구간 + 과도한 refetch로 목록이 깜빡인다. 직전 비어있지 않은 outline을 유지(고스트)하고, 불필요한 refetch를 줄인다.

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: 현재 동작 확인**

`git grep -nE "refreshFullGraph\(\)" -- 'frontend/src/app/maps/[mapId]/page.tsx'` 로 호출처 4곳 확인(현재: mount effect, 스코프 로드 effect, moveToChild, saveCurrentScope). "스코프 전환만으로 refetch"하는 호출이 어느 것인지 식별 — 스코프 로드 effect(versionId/currentParentId 변동, 라인 ~338) 호출이 전환마다 발생.

- [ ] **Step 2: 스코프 전환 시 refetch 제거**

스코프 로드 effect 안의 `refreshFullGraph();` 호출을 조건부로: 최초 1회(fullGraph가 null일 때)만 로드하고, 이후 전환은 기존 fullGraph 재사용. 해당 effect에서:
```ts
      refreshFullGraph();
```
를:
```ts
      if (fullGraphRef.current === null) {
        refreshFullGraph(); // 전체 트리는 최초 1회만 — 전환 시 기존 데이터 재사용(깜빡임 방지)
      }
```
로 교체. 이를 위해 fullGraph의 ref 추가(다른 ref 근처):
```ts
  const fullGraphRef = useRef<VersionGraph | null>(null);
```
그리고 fullGraph 동기화 effect 추가(windowGeomRef 동기화 근처):
```ts
  useEffect(() => {
    fullGraphRef.current = fullGraph;
  }, [fullGraph]);
```
effect deps에 `fullGraph`가 빠져있어 stale 경고가 나면, ref로 읽으므로 deps 추가 불필요(eslint exhaustive-deps 억제는 기존 패턴 따름 — 다른 effect들 확인). 저장 성공 후 갱신(`saveCurrentScope`의 `refreshFullGraph()`)과 `moveToChild` 갱신은 유지(실제 구조 변경이므로 최신화 필요).

- [ ] **Step 3: 아웃라인 고스트 — 직전 비어있지 않은 결과 유지**

`const outline = useMemo(...)` 블록을 찾아, 결과가 비면 직전 값을 유지하도록 ref 래핑. useMemo 다음에 추가:
```ts
  const lastOutlineRef = useRef(outline);
  if (outline.length > 0) {
    lastOutlineRef.current = outline;
  }
  const displayOutline = outline.length > 0 ? outline : lastOutlineRef.current;
  const outlineRefreshing = outline.length === 0 && lastOutlineRef.current.length > 0;
```
`EditorLeftSidebar`에 넘기는 `outline={outline}`을 `outline={displayOutline}`으로 교체. (사이드바가 refreshing 표시를 지원하면 `outlineRefreshing`도 넘기되, 미지원이면 생략 — 깜빡임 제거가 핵심.)

- [ ] **Step 4: (선택) 고스트 dim 시각**

전환 중 살짝 dim으로 "갱신 중"을 약하게 알리려면, `EditorLeftSidebar`가 받는 컨테이너에 `outlineRefreshing ? "opacity-60 transition-opacity" : ""` 클래스를 적용. 사이드바 컴포넌트가 className prop을 안 받으면 이 Step은 생략(깜빡임 제거만으로 충분). `globals.css` 신규 키프레임 불필요 — 기존 opacity 트랜지션만.

- [ ] **Step 5: lint + build 검증**

```bash
cd frontend && npm run lint && npm run build
```
Expected: green. eslint react-hooks 경고가 새로 뜨면(deps), 동일 파일의 기존 ref 패턴과 동일하게 처리(억제 주석은 기존 선례 따름).

- [ ] **Step 6: 커밋**

PROGRESS.md 추가:
```
- 아웃라인 깜빡임 제거 (브랜치 `feat/canvas-ux`). 스코프 전환 시 전체 트리 refetch를 최초 1회로 제한(기존 fullGraph 재사용), 라이브 nodes 공백 구간엔 직전 비어있지 않은 outline을 고스트로 유지해 "사라졌다 뜨는" 현상 제거. 저장·moveToChild 후 갱신은 유지. 검증: lint/build green.
```
```bash
cd /Users/hyeonjin/Documents/bpm
git add PROGRESS.md "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/app/globals.css
git commit -F - <<'EOF'
fix(canvas): stop outline flicker on scope switch — ghost-hold + refetch dedupe — 아웃라인 깜빡임 제거

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: 드롭존 — 타일 적중 시에만 활성 + 링 유지 강화 (#4)

**근거:** dwell 후 커서 방향만으로 항상 zone이 켜져 과민하다. 커서가 타일 hitbox 안일 때만 zone 활성, 아니면 중립(겹침 밀어내기). 링은 커서를 타일로 옮길 수 있게 넉넉히 유지.

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (순수함수 추가)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1: 순수함수 `pickDropZone` 추가**

`frontend/src/lib/canvas.ts` 끝에 추가. 타일은 링 중심에서 ±radius 떨어진 4 cardinal 지점(렌더와 동일 배치), 각 타일 `tileW×tileH` 박스. 커서가 어느 타일 안이면 그 zone, 아니면 null.
```ts
// 드롭존 타일 적중 판정 — 커서(컨테이너 상대 좌표)가 4 cardinal 타일 중 하나의 박스 안이면 그 zone, 아니면 null.
// 타일 배치는 page.tsx 오버레이 렌더와 동일해야 한다(좌=front/우=back/상=group/하=child).
export type DropZone = "front" | "back" | "group" | "child";

export function pickDropZone(
  cursorX: number,
  cursorY: number,
  cx: number,
  cy: number,
  radius: number,
  tileW: number,
  tileH: number,
): DropZone | null {
  const tiles: { zone: DropZone; x: number; y: number }[] = [
    { zone: "front", x: cx - radius, y: cy },
    { zone: "back", x: cx + radius, y: cy },
    { zone: "group", x: cx, y: cy - radius },
    { zone: "child", x: cx, y: cy + radius },
  ];
  for (const tile of tiles) {
    if (Math.abs(cursorX - tile.x) <= tileW / 2 && Math.abs(cursorY - tile.y) <= tileH / 2) {
      return tile.zone;
    }
  }
  return null;
}
```
page.tsx의 로컬 `type DropZone`(현재 line ~91 선언)은 canvas.ts의 export로 통일: page.tsx에서 로컬 `type DropZone = ...` 선언을 제거하고 canvas import에 `DropZone` 추가. (`git grep -nE "type DropZone" -- 'frontend/src/app/maps/[mapId]/page.tsx'`로 확인 후 제거.)

- [ ] **Step 2: 순수함수 bun 검증(단발)**

임시 검증 스크립트로 동작 확인(커밋 안 함):
```bash
cd /Users/hyeonjin/Documents/bpm/frontend
cat > /tmp/pick.mjs <<'EOF'
function pickDropZone(cursorX, cursorY, cx, cy, radius, tileW, tileH) {
  const tiles = [
    { zone: "front", x: cx - radius, y: cy },
    { zone: "back", x: cx + radius, y: cy },
    { zone: "group", x: cx, y: cy - radius },
    { zone: "child", x: cx, y: cy + radius },
  ];
  for (const t of tiles) {
    if (Math.abs(cursorX - t.x) <= tileW / 2 && Math.abs(cursorY - t.y) <= tileH / 2) return t.zone;
  }
  return null;
}
const R = 100, W = 84, H = 58, cx = 200, cy = 200;
console.assert(pickDropZone(cx - R, cy, cx, cy, R, W, H) === "front", "front center");
console.assert(pickDropZone(cx + R, cy, cx, cy, R, W, H) === "back", "back center");
console.assert(pickDropZone(cx, cy - R, cx, cy, R, W, H) === "group", "group center");
console.assert(pickDropZone(cx, cy + R, cx, cy, R, W, H) === "child", "child center");
console.assert(pickDropZone(cx, cy, cx, cy, R, W, H) === null, "center = neutral");
console.assert(pickDropZone(cx - R + 50, cy, cx, cy, R, W, H) === null, "between tiles = neutral");
console.log("pickDropZone OK");
EOF
bun /tmp/pick.mjs && rm /tmp/pick.mjs
```
Expected: `pickDropZone OK` (assert 실패 없음).

- [ ] **Step 3: page.tsx — handleNodeDrag를 타일 적중식으로**

현재 `handleNodeDrag`의 "이미 떠 있는 링" 유지 분기와 `activateZone` 흐름을 다음 원칙으로 수정:
- dwell로 노드 대상이 정해지면 `dropTarget = { id, rect, zone: null }`로 링만 띄운다.
- 매 move마다 커서(컨테이너 상대 좌표)로 `pickDropZone` 호출해 `dropTarget.zone`을 갱신(타일 밖이면 null).
- 링 유지 경계 = `radius + tileH`(타일보다 넉넉) — 이 경계를 벗어날 때만 해제.

먼저 `dropTarget` 타입에 zone이 null 가능하도록 확장. 현재:
```ts
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    zone: DropZone;
    rect: ScreenRect;
  } | null>(null);
```
을:
```ts
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    zone: DropZone | null;
    rect: ScreenRect;
  } | null>(null);
```
(드롭존 오버레이 렌더에서 `dropTarget.zone === zone` 비교는 null이면 false라 그대로 동작 — 활성 타일 없음 표현.)

`activateZone` useCallback을 타일 적중식으로 교체:
```tsx
  // 커서(컨테이너 상대 좌표)로 타일 적중 zone을 갱신. 타일 밖이면 zone=null(중립). 링(rect)은 유지.
  const activateZone = useCallback(
    (targetId: string, cursorX: number, cursorY: number) => {
      const rect = screenRectOf(targetId);
      if (!rect) {
        return;
      }
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) + 32; // 오버레이 렌더와 동일
      const zone = pickDropZone(cursorX, cursorY, cx, cy, radius, 84, 58); // tileW/H = 렌더와 동일
      setGroupDropTarget((cur) => (cur ? null : cur));
      setDropTarget((cur) =>
        cur && cur.id === targetId && cur.zone === zone ? cur : { id: targetId, zone, rect },
      );
    },
    [screenRectOf],
  );
```

`handleNodeDrag` 안의 호출부 수정 — `activateZone(target.id)` / `activateZone(active.id)` 호출을 컨테이너 상대 커서 좌표와 함께 넘긴다. 컨테이너 상대 좌표는 이미 "이미 떠 있는 링" 분기에서 계산한 `crect`를 활용:
```ts
const crect = container.getBoundingClientRect();
const curX = clientX - crect.left;
const curY = clientY - crect.top;
```
그리고:
- 유지 분기의 경계 계산을 `radius`(=max+32)에서 `radius + 58`(타일 높이만큼 여유)로 키운다:
```ts
        const radius = Math.max(r.width, r.height) + 32;
        const keep = radius + 58; // 타일까지 커서를 옮겨도 링 유지
        ...
        if (dist <= keep) {
          activateZone(active.id, curX, curY);
          return;
        }
```
- dwell 발화/유지 시 `activateZone(target.id, curX, curY)`로 호출(setTimeout 콜백도 최신 커서가 필요 → 타이머 콜백에서 `dragMouseRef`/마지막 커서를 쓰도록, 또는 dwell 만료 시점에 마지막 컨테이너 상대 좌표를 ref로 보관해 전달). 간단히: 컨테이너 상대 커서를 ref(`dragCursorRef`)에 매 move 저장하고 타이머 콜백은 그 ref로 `activateZone(target.id, dragCursorRef.current.x, dragCursorRef.current.y)` 호출.

`dragCursorRef` 추가(dragMouseRef 근처):
```ts
  const dragCursorRef = useRef({ x: 0, y: 0 }); // 컨테이너 상대 커서 — 타일 적중 판정용
```
매 move에서 `dragCursorRef.current = { x: curX, y: curY };` 갱신.

- [ ] **Step 4: page.tsx — onNodeDragStop 중립 드롭**

`onNodeDragStop`에서 zone이 null이면 collision(중립)로 가도록. 현재:
```tsx
                        if (!readOnly && dropTargetRef.current && dropTargetRef.current.id !== node.id) {
                          handleZoneDrop(node.id, dropTargetRef.current.id, dropTargetRef.current.zone);
                        } else if (!readOnly && groupDropTargetRef.current) {
```
을:
```tsx
                        if (
                          !readOnly &&
                          dropTargetRef.current &&
                          dropTargetRef.current.id !== node.id &&
                          dropTargetRef.current.zone !== null
                        ) {
                          handleZoneDrop(node.id, dropTargetRef.current.id, dropTargetRef.current.zone);
                        } else if (!readOnly && groupDropTargetRef.current) {
```
`handleZoneDrop`의 zone 파라미터 타입이 `DropZone`(non-null)이면, 위 가드로 null이 걸러지므로 호출은 안전. tsc가 narrowing을 못 하면 `dropTargetRef.current.zone`을 지역 변수로 빼서 `if (zone !== null)` 후 전달.

- [ ] **Step 5: 드롭존 오버레이 radius 정합 확인**

오버레이 렌더(`{dropTarget && (() => { ... })()}`)의 `radius = Math.max(r.width, r.height) + 32`와 `tileW=84/tileH=58`이 Step 3의 `activateZone` 상수와 **반드시 동일**해야 적중 판정과 시각이 일치한다. 다르면 맞춘다. (DRY: 가능하면 `const ZONE_RADIUS_PAD = 32, ZONE_TILE_W = 84, ZONE_TILE_H = 58;`를 page.tsx 상단 상수로 두고 양쪽에서 참조.)

- [ ] **Step 6: lint + build + 순수함수 재검증**

```bash
cd frontend && npm run lint && npm run build
```
Expected: green. (Step 2의 bun 검증은 이미 통과.)

- [ ] **Step 7: 커밋**

PROGRESS.md 추가:
```
- 드롭존 과민성 해소 (브랜치 `feat/canvas-ux`). zone을 커서 방향식 → 타일 hitbox 적중식으로 변경(canvas.ts 신규 순수함수 pickDropZone, bun 검증). 커서가 타일 밖이면 중립 드롭(resolveCollision)으로 그냥 겹침 밀어냄. 링 유지 경계를 radius+타일높이로 키워 커서를 타일로 옮겨도 안 사라지게 함. ZONE 상수(radius pad/tile w/h)를 오버레이 렌더와 단일 출처로 정합. 검증: lint/build green + pickDropZone bun. 인터랙션 로컬 확인 필요.
```
```bash
cd /Users/hyeonjin/Documents/bpm
git add PROGRESS.md frontend/src/lib/canvas.ts "frontend/src/app/maps/[mapId]/page.tsx"
git commit -F - <<'EOF'
fix(canvas): drop-zone activates only on tile hit, ring persists to reach tiles — 드롭존 과민성 해소

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
```

---

## 최종 검증 (전체 Task 후)

- [ ] `cd frontend && npm run lint && npm run build` 최종 green.
- [ ] 수동 체크리스트(로컬 Windows `npm run dev`):
  1. 창 최소화 → 좌하단 칩으로 쌓임, 칩 클릭 시 복원+최상단.
  2. 스코프 상/하 전환 반복 → 아웃라인이 사라졌다 뜨지 않음(고스트 유지).
  3. 노드 더블클릭 → 요약 모달(전/후 단계, 하위 있으면 썸네일, 코멘트 목록+추가). 바깥/Esc 닫힘. 노드 연결은 핸들 드래그로만.
  4. 노드를 다른 노드에 겹쳐 드래그 → 타일 위로 커서를 가져가야 zone 활성, 타일 밖에서 놓으면 그냥 겹쳐 밀어남. 겹침 풀려도 링 유지.
- [ ] 미해결/잔여 사항을 PROGRESS.md 또는 보고에 명시.

## Self-Review 결과 (작성자 점검)

- **Spec 커버리지:** #1→Task3, #2→Task4, #3(연결 제거)→Task1·(모달)→Task2, #4→Task5. 전 항목 매핑됨.
- **타입 정합:** `DropZone`을 canvas.ts로 통일(Task5 Step1), `dropTarget.zone: DropZone | null`(Task5 Step3)과 `onNodeDragStop` 가드(Step4) 일치. `NodeActions`에서 connectSource 제거(Task1)와 process-node 참조 제거 일치.
- **플레이스홀더:** 없음. 단 Task2 Step3(f)·Task4 Step2의 "기존 패턴 확인 후 결정" 분기는 `git grep`로 선례를 확인해 정하는 실행 지침이며, 양쪽 선택지의 구체 코드를 제시함.
- **위험:** page.tsx 거대 파일 — 각 Step은 앵커 코드 문자열로 위치 지정, 라인 번호 의존 최소화.
