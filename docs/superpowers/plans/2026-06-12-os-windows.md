# OS형 자유 창 (드릴인 윈도우) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드릴인 계층 창을 OS 윈도우처럼 — 타이틀바 드래그 이동·코너 리사이즈·최소/최대/닫기·포커스 z-order·위치 영속 — 으로 만든다(활성 1개만 라이브 편집).

**Architecture:** 기존 `scopes` 체인·로드/저장 로직 유지 + `activeIndex`(포커스=라이브)·`windowGeom`(스코프별 기하) 상태 추가. 신규 `ScopeWindow`가 창 크롬 + pointer 기반 드래그/리사이즈를 자체 처리(외부 라이브러리 없음). 기하는 `localStorage`(`bpm.windows.<mapId>`) 영속, 저장값 없으면 계단식 자동배치.

**Tech Stack:** Next 16.2.9, React 19.2.4, @xyflow/react 12, Tailwind 4(디자인 토큰), lucide-react. 테스트 러너 없음 → `npx tsc --noEmit` + `npm run lint` + `npm run build` + 수동 검증.

**작업 디렉터리:** `frontend/` (git은 repo root `git -C /Users/hyeonjin/Documents/bpm`). 커밋마다 둘째 `-m`로 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**디자인 룰 주의:** 떠있는 창은 오버레이라 `shadow` 허용(rules/frontend/design.md §2 예외). 색·타입·아이콘은 토큰/Lucide.

---

## File Structure
신규:
- `frontend/src/lib/window-store.ts` — `WindowGeom` 타입 + localStorage load/save.
- `frontend/src/components/scope-window.tsx` — 창 크롬 + 드래그/리사이즈/min/max/close.

수정:
- `frontend/src/lib/i18n-messages.ts` — `window.*` 키 4개.
- `frontend/src/app/maps/[mapId]/page.tsx` — 드릴인 블록 → ScopeWindow 루프, `activeIndex`/`windowGeom`/`zOrder`/`bounds` 상태, 영속, 네비 의미 변경.

---

## Task 1: window-store + WindowGeom 타입 + i18n 키

**Files:**
- Create: `frontend/src/lib/window-store.ts`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: window-store.ts 작성**
```ts
// 맵별 창 기하 영속 — localStorage(bpm.windows.<mapId>). 스코프키 → WindowGeom.

export interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
}

const keyFor = (mapId: number) => `bpm.windows.${mapId}`;

export function loadWindowGeoms(mapId: number): Record<string, WindowGeom> {
  try {
    const raw = window.localStorage.getItem(keyFor(mapId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // 파싱 실패는 빈 값으로 — 손상된 저장값이 앱을 막지 않게
    return {};
  }
}

export function saveWindowGeoms(mapId: number, geoms: Record<string, WindowGeom>): void {
  try {
    window.localStorage.setItem(keyFor(mapId), JSON.stringify(geoms));
  } catch {
    // 용량 초과 등은 무시 — 영속은 best-effort
  }
}
```

- [ ] **Step 2: i18n 키 추가**
`frontend/src/lib/i18n-messages.ts`의 `en` 객체에 (적당한 위치, 예: compare 블록 뒤) 추가:
```ts
  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.close": "Close",
  "window.clickToEdit": "Click to edit",
```
그리고 `ko` 객체에 동일 키:
```ts
  "window.minimize": "최소화",
  "window.maximize": "최대화",
  "window.close": "닫기",
  "window.clickToEdit": "클릭해 편집",
```
(en/ko 키가 어긋나면 `Record<MessageKey,string>` 타입이 tsc 에러로 잡는다 — 4개 모두 양쪽에 넣을 것.)

- [ ] **Step 3: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/lib/window-store.ts frontend/src/lib/i18n-messages.ts
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(windows): window geometry store + i18n keys — 창 기하 영속 인프라" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: ScopeWindow 컴포넌트

**Files:**
- Create: `frontend/src/components/scope-window.tsx`

- [ ] **Step 1: 컴포넌트 작성**
전체 파일:
```tsx
// 떠있는 스코프 창 — 타이틀바 드래그 이동·코너 리사이즈·최소/최대/닫기·포커스. 활성 창만 라이브 children.
"use client";

import { Minus, Square, X } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { WindowGeom } from "@/lib/window-store";

const MIN_W = 240;
const MIN_H = 160;

interface ScopeWindowProps {
  title: string;
  geom: WindowGeom;
  active: boolean;
  zIndex: number;
  canClose: boolean;
  bounds: { w: number; h: number };
  onFocus: () => void;
  onGeomChange: (geom: WindowGeom) => void;
  onClose: () => void;
  children: ReactNode;
}

export function ScopeWindow({
  title,
  geom,
  active,
  zIndex,
  canClose,
  bounds,
  onFocus,
  onGeomChange,
  onClose,
  children,
}: ScopeWindowProps) {
  const { t } = useI18n();
  // 드래그/리사이즈 시작 시점의 포인터·기하 스냅샷
  const dragRef = useRef<{ px: number; py: number; geom: WindowGeom } | null>(null);

  const clamp = (g: WindowGeom): WindowGeom => {
    const w = Math.min(Math.max(g.w, MIN_W), Math.max(MIN_W, bounds.w));
    const h = Math.min(Math.max(g.h, MIN_H), Math.max(MIN_H, bounds.h));
    const x = Math.min(Math.max(g.x, 0), Math.max(0, bounds.w - w));
    const y = Math.min(Math.max(g.y, 0), Math.max(0, bounds.h - h));
    return { ...g, x, y, w, h };
  };

  const startDrag = (event: ReactPointerEvent) => {
    if (geom.maximized) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { px: event.clientX, py: event.clientY, geom };
  };
  const moveWindow = (event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    onGeomChange(
      clamp({
        ...start.geom,
        x: start.geom.x + (event.clientX - start.px),
        y: start.geom.y + (event.clientY - start.py),
      }),
    );
  };
  const resizeWindow = (event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    onGeomChange(
      clamp({
        ...start.geom,
        w: start.geom.w + (event.clientX - start.px),
        h: start.geom.h + (event.clientY - start.py),
      }),
    );
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  };

  const toggleMax = () => onGeomChange({ ...geom, maximized: !geom.maximized });
  const toggleMin = () => onGeomChange({ ...geom, minimized: !geom.minimized });

  const rect = geom.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h }
    : {
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.minimized ? undefined : geom.h,
      };

  return (
    <div
      className={`absolute flex flex-col overflow-hidden rounded-sm border bg-surface shadow ${
        active ? "border-hairline" : "border-divider"
      }`}
      style={{ ...rect, zIndex }}
      onPointerDown={onFocus}
    >
      <div
        className="flex shrink-0 select-none items-center gap-1 border-b border-hairline bg-surface-alt px-2 py-1 text-fine text-ink-secondary"
        style={{ cursor: geom.maximized ? "default" : "move" }}
        onPointerDown={startDrag}
        onPointerMove={moveWindow}
        onPointerUp={endDrag}
        onDoubleClick={toggleMax}
      >
        <span className="flex-1 truncate font-medium">{title}</span>
        <button
          type="button"
          title={t("window.minimize")}
          className="rounded-xs p-0.5 hover:bg-surface-pearl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleMin();
          }}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title={t("window.maximize")}
          className="rounded-xs p-0.5 hover:bg-surface-pearl"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggleMax();
          }}
        >
          <Square size={12} strokeWidth={1.5} />
        </button>
        {canClose && (
          <button
            type="button"
            title={t("window.close")}
            className="rounded-xs p-0.5 hover:bg-error/10 hover:text-error"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>

      {!geom.minimized && (
        <div className="relative flex-1">
          {children}
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-caption text-ink-tertiary">
              {t("window.clickToEdit")}
            </div>
          )}
        </div>
      )}

      {!geom.minimized && !geom.maximized && (
        <div
          className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
          onPointerDown={startDrag}
          onPointerMove={resizeWindow}
          onPointerUp={endDrag}
        />
      )}
    </div>
  );
}
```
주의:
- 드래그/리사이즈는 `setPointerCapture`로 해당 엘리먼트가 move 이벤트를 독점 → 부드럽고 누수 없음. `endDrag`에서 release.
- 타이틀바 버튼은 `onPointerDown` `stopPropagation`으로 드래그 시작을 막는다(클릭만).
- `select-none`으로 드래그 중 텍스트 선택 방지.
- 비활성 창은 본문 위 `bg-surface/60` 오버레이 + "클릭해 편집". 본문(children)은 page.tsx가 활성일 때만 ReactFlow를 넣는다.

- [ ] **Step 2: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. (아직 미사용이지만 컴파일·린트 통과해야 함. `bg-error/10`·`bg-surface/60`는 토큰 불투명도 변형으로 유효.)

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/components/scope-window.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(windows): ScopeWindow chrome with drag/resize/min/max/close — 창 컴포넌트" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: page.tsx 통합 (드릴인 → 자유 창)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

READ the file first. Current relevant anchors: `scopes` state (line ~153), `currentParentId` (line ~177), graph load effect (uses `currentParentId`, ~389), `navigateTo` (~609), `handleDrillIn` (~622), `handleBreadcrumb` (~629), the drill-in render block (lines ~1190-1285: `<div className="relative flex-1 bg-surface-alt">` … `scopes.map((scope, index) => {...})` … closing before `{menu && <ContextMenu`).

- [ ] **Step 1: import 추가**
상단 import 그룹에:
```ts
import { ScopeWindow } from "@/components/scope-window";
import { loadWindowGeoms, saveWindowGeoms, type WindowGeom } from "@/lib/window-store";
```
(기존 `ChevronRight` import는 헤더 브레드크럼에서 계속 쓰이면 유지; 드릴인 블록에서만 쓰였다면 제거해 unused 방지 — Step 6 후 lint로 확인.)

- [ ] **Step 2: 상태 추가 + currentParentId 재정의 + scopeKey**
`const [scopes, setScopes] = useState...` 아래에 추가:
```ts
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowGeom, setWindowGeom] = useState<Record<string, WindowGeom>>({});
  const [zOrder, setZOrder] = useState<string[]>([]);
  const [bounds, setBounds] = useState({ w: 960, h: 640 });
  const canvasContainerRef = useRef<HTMLDivElement>(null);
```
`scopeKey` 헬퍼(컴포넌트 함수 안, 다른 헬퍼 곁):
```ts
  const scopeKey = (scope: Scope) => scope.parentId ?? "root";
```
`currentParentId` 정의 교체(line ~177):
```ts
  const currentParentId =
    scopes[Math.min(activeIndex, scopes.length - 1)]?.parentId ?? null;
```

- [ ] **Step 3: 기하 영속 — 로드/저장**
맵 기하 로드 effect(마운트/`mapId` 변경 시):
```ts
  // 저장된 창 기하 복원 (클라이언트 전용)
  useEffect(() => {
    setWindowGeom(loadWindowGeoms(mapId));
  }, [mapId]);
```
디바운스 저장 effect:
```ts
  // 창 기하 변경 시 디바운스 저장
  useEffect(() => {
    const timer = setTimeout(() => saveWindowGeoms(mapId, windowGeom), 300);
    return () => clearTimeout(timer);
  }, [mapId, windowGeom]);
```

- [ ] **Step 4: 컨테이너 bounds (ResizeObserver)**
```ts
  // 캔버스 컨테이너 크기 추적 — 창 클램프/기본배치용
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) {
      return;
    }
    const update = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
```

- [ ] **Step 5: 기본 배치 + z-order + 네비 핸들러**
기본 계단 배치 헬퍼(컴포넌트 함수 안):
```ts
  const defaultGeom = (index: number, b: { w: number; h: number }): WindowGeom => {
    const step = 36;
    const w = Math.min(760, Math.round(b.w * 0.82));
    const h = Math.min(500, Math.round(b.h * 0.82));
    return { x: index * step, y: index * step, w, h, minimized: false, maximized: false };
  };

  const bringToFront = useCallback((key: string) => {
    setZOrder((order) => [...order.filter((k) => k !== key), key]);
  }, []);
```
`navigateTo`를 activeIndex까지 설정하도록 수정(기존 save 후 setScopes 하던 것에 추가):
```ts
  const navigateTo = useCallback(
    async (nextScopes: Scope[]) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.save"));
        return;
      }
      setScopes(nextScopes);
      setActiveIndex(nextScopes.length - 1);
    },
    [saveCurrentScope, t],
  );
```
`handleDrillIn` 수정(활성 기준으로 truncate 후 push):
```ts
  const handleDrillIn = useCallback(
    (node: AppNode) => {
      void navigateTo([
        ...scopes.slice(0, activeIndex + 1),
        { parentId: node.id, title: node.data.label },
      ]);
    },
    [navigateTo, scopes, activeIndex],
  );
```
포커스/닫기 핸들러 신규(컴포넌트 함수 안, navigateTo 곁):
```ts
  // 창 포커스 — 현재 활성 스코프를 저장하고 해당 창을 라이브로 전환(스코프 체인은 유지)
  const focusScope = useCallback(
    async (index: number) => {
      if (index === activeIndex) {
        return;
      }
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : t("err.save"));
        return;
      }
      setActiveIndex(index);
    },
    [activeIndex, saveCurrentScope, t],
  );

  // 창 닫기 — 그 창과 하위(더 깊은 창) 모두 닫고 상위로 복귀
  const closeScope = useCallback(
    (index: number) => {
      if (index <= 0) {
        return;
      }
      void navigateTo(scopes.slice(0, index));
    },
    [navigateTo, scopes],
  );
```
`handleBreadcrumb`를 포커스로 변경(잘라내기 대신):
```ts
  const handleBreadcrumb = useCallback(
    (index: number) => {
      void focusScope(index);
    },
    [focusScope],
  );
```
주의:
- 맵 로드/버전 전환/생성/삭제에서 `setScopes([{ parentId: null, title: ... }])` 하는 모든 곳 바로 뒤에 `setActiveIndex(0)` 추가(체인이 root 하나로 리셋되므로). 해당 위치를 grep `setScopes(` 로 찾아 각각 보강.
- 검색 점프(`handleSearchSelect`)는 `navigateTo(result.scopes)`를 쓰므로 activeIndex가 자동으로 last가 됨 — 추가 작업 불필요.

- [ ] **Step 6: 드릴인 렌더 블록 교체 (ScopeWindow 루프)**
현재 블록 `<div className="relative flex-1 bg-surface-alt"> … scopes.map(...) … </div>`(menu 렌더 직전까지)를 아래로 교체. **ReactFlow 엘리먼트의 모든 props/핸들러/children(`<Background/><Controls/>`)은 그대로 복사**:
```tsx
        <div
          ref={canvasContainerRef}
          className="relative flex-1 overflow-hidden bg-surface-alt"
        >
          {scopes.map((scope, index) => {
            const key = scopeKey(scope);
            const geom = windowGeom[key] ?? defaultGeom(index, bounds);
            const active = index === activeIndex;
            return (
              <ScopeWindow
                key={key}
                title={scope.title}
                geom={geom}
                active={active}
                zIndex={active ? 1000 : zOrder.indexOf(key) + 1}
                canClose={index > 0}
                bounds={bounds}
                onFocus={() => {
                  bringToFront(key);
                  if (!active) {
                    void focusScope(index);
                  }
                }}
                onGeomChange={(next) =>
                  setWindowGeom((map) => ({ ...map, [key]: next }))
                }
                onClose={() => closeScope(index)}
              >
                {active ? (
                  <div className="drill-canvas h-full w-full">
                    <ReactFlow
                      /* ←←← 기존 ReactFlow props/핸들러 전부 그대로 ←←← */
                    >
                      <Background />
                      <Controls />
                    </ReactFlow>
                  </div>
                ) : null}
              </ScopeWindow>
            );
          })}
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menuItems}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
```
주의:
- ReactFlow를 감싼 `<div className="drill-canvas h-full w-full">`는 활성 전환/드릴 시 entrance 애니메이션 유지(globals.css의 `.drill-canvas`). ReactFlow는 부모(`relative flex-1` of ScopeWindow body)에서 높이를 받으므로 `h-full w-full`.
- 활성 창은 항상 zIndex 1000(라이브·최상위). 비활성은 포커스 순서.
- 제거되는 것: 기존 고정 오프셋 프레임/타이틀바 버튼/`drill-canvas` 외곽 div/조상 `bg-surface-pearl` placeholder. ScopeWindow가 대체.

- [ ] **Step 7: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. unused import(예: 더 이상 안 쓰는 `ChevronRight`가 드릴인에서만 쓰였다면)·unused var 없도록 정리. (`ChevronRight`는 헤더 브레드크럼 `nav`에서도 쓰이는지 확인 후 결정.)

- [ ] **Step 8: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add "frontend/src/app/maps/[mapId]/page.tsx"
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(editor): OS-like free windows for drill-in — 자유 창 통합" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 최종 검증
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` PASS.
- [ ] PROGRESS.md 갱신 후 커밋.
- [ ] 사용자 수동 체크리스트:
  1. 노드 더블클릭 → 자식 창이 계단 위치로 열리고 활성(라이브).
  2. 타이틀바 드래그로 창 이동, 우하단 핸들로 리사이즈.
  3. 비활성 창 클릭 → 맨 앞으로 + 라이브 전환(그 계층 로드), 이전 활성은 비활성 오버레이.
  4. 최소화(타이틀바만)/최대화(가득)/닫기(상위 복귀, root는 닫기 버튼 없음).
  5. 창 옮긴 뒤 새로고침 → 위치·크기 유지(localStorage).
  6. 헤더 브레드크럼 클릭 = 해당 창 포커스.

---

## Self-Review (작성자 점검)
- **스펙 커버리지:** 모델(활성1·focus전환)=Task3 focusScope/activeIndex; ScopeWindow(이동·리사이즈·min/max/close·z)=Task2; 영속=Task1 store+Task3 effect; 계단 기본배치=Task3 defaultGeom; 닫기=하위정리=closeScope; 드릴=truncate+push. 전 항목 매핑.
- **플레이스홀더:** 없음. window-store·ScopeWindow는 전체 코드, page.tsx는 정확한 앵커+코드 블록. ReactFlow props는 "기존 그대로 복사"로 명시(1400행 재출력 회피, 현재 블록을 그대로 보존).
- **타입 일관성:** `WindowGeom`(window-store 정의, scope-window·page import), `scopeKey`/`activeIndex`/`windowGeom`/`zOrder`/`bounds`/`defaultGeom`/`focusScope`/`closeScope`/`bringToFront` 명칭 태스크 간 일치. i18n `window.*` 키 4개 en/ko 양쪽.
- **위험:** ① 모든 `setScopes([root])` 리셋부에 `setActiveIndex(0)` 보강 누락 시 activeIndex 범위초과 — Step5 주의에 명시(`currentParentId`는 `Math.min`으로 방어). ② `ChevronRight` unused 가능 — Step7 lint로 확인. ③ 드래그 중 ReactFlow 리렌더(활성 창 이동 시) 비용 — 단일 창이라 수용. ④ `bg-error/10`·`bg-surface/60` opacity 변형 유효성 — build로 확인.
