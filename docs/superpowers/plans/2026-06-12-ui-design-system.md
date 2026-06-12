# BPM UI Design System Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참고 템플릿의 Apple 파생 디자인 토큰을 BPM에 이식하고(룰 문서 + Tailwind 4 `@theme` 토큰 + Pretendard + Lucide), 전 화면을 flat·hairline·토큰 기반으로 리스타일한다.

**Architecture:** Tailwind 4 CSS-first 토큰(`@theme` in globals.css) → `bg-surface`/`text-ink`/`border-hairline`/`text-accent`/`ring-added` 등 유틸리티 생성. 폰트는 Pretendard 번들. 이모지는 lucide-react 아이콘(16px/1.5). chrome shadow 제거 → hairline + surface 색단계. 기능/레이아웃 로직 불변, className·아이콘·토큰만 교체.

**Tech Stack:** Next.js 16.2.9, React 19.2.4, Tailwind CSS 4.3.0(`@theme`), @xyflow/react 12, lucide-react(신규), Pretendard Variable woff2. 테스트 러너 없음 → `npx tsc --noEmit` + `npm run lint` + `npm run build` + 수동 시각 검증.

**작업 디렉터리:** 별도 명시 없으면 `frontend/`. 모든 git은 repo root에서 `git -C /Users/hyeonjin/Documents/bpm`.

**Next 주의:** `frontend/AGENTS.md` — layout/폰트 변경 시 `node_modules/next/dist/docs/` 확인.

**커밋 트레일러:** 각 커밋 메시지에 두 번째 `-m`로 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 추가.

---

## File Structure

신규:
- `rules/frontend/design.md` — 프론트 디자인 룰(토큰·flat·타입·아이콘).
- `frontend/public/fonts/PretendardVariable.woff2` — 번들 폰트(참고 레포에서 복사).

수정:
- `CLAUDE.md` — `@rules/frontend/design.md` import 추가.
- `frontend/package.json` — lucide-react.
- `frontend/src/app/globals.css` — `@theme` 토큰 + @font-face, 다크/임시토큰 제거.
- `frontend/src/app/layout.tsx` — Geist 제거.
- `frontend/src/components/top-nav.tsx`, `frontend/src/app/page.tsx`, `frontend/src/app/maps/[mapId]/page.tsx`, `frontend/src/app/maps/[mapId]/compare/page.tsx`, `frontend/src/components/process-node.tsx`, `frontend/src/components/comment-section.tsx`, `frontend/src/components/context-menu.tsx` — 토큰 리스타일.

**토큰 → 클래스 매핑(전 태스크 공통 참조):**
| 의미 | 토큰 클래스 | zinc 등 대체 대상(예) |
|---|---|---|
| 기본 배경 | `bg-surface` | `bg-white` |
| 보조 배경(패널/타이틀바) | `bg-surface-alt` | `bg-zinc-50` |
| 본문 텍스트 | `text-ink` | `text-zinc-800/900` |
| 보조 텍스트 | `text-ink-secondary` | `text-zinc-600/700` |
| 흐린 텍스트/placeholder | `text-ink-tertiary` | `text-zinc-400/500` |
| 경계(카드/툴) | `border-hairline` | `border-zinc-200/300` |
| 약한 구분선 | `border-divider` | `border-zinc-100` |
| 강조/링크/primary | `text-accent` / `bg-accent text-on-accent` | `text-blue-700` / `bg-blue-600 text-white` |
| 에러/위험 | `text-error` | `text-red-600` |
| diff 추가/삭제/변경 | `added`/`removed`/`changed` (text-/border-/ring-/bg-) | green/red/amber-500 |

**Lucide 매핑(전 태스크 공통):** 🔒→`Lock`, 📝→`PencilLine`, ⚡→`Zap`, 👤→`User`, 💬→`MessageSquare`, ↶→`Undo2`, ↷→`Redo2`, ▾(하위)→`CornerDownRight`, ←(목록)→`ArrowLeft`, 검색→`Search`, PNG→`Download`, ✓(저장됨)→`Check`, +노드→`Plus`, 브레드크럼 `›`→`ChevronRight`, 삭제→`Trash2`. 사용: `<Icon size={16} strokeWidth={1.5} />` (뱃지 내부는 `size={12}`), 라벨과 함께면 부모를 `inline-flex items-center gap-1`.

---

## Task 1: 디자인 룰 문서 + CLAUDE.md import

**Files:**
- Create: `rules/frontend/design.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 룰 문서 작성**

Create `rules/frontend/design.md`:
```markdown
# Frontend Design Rules

BPM 프론트엔드 시각 언어 — Apple 파생 토큰 시스템(`frontend/src/app/globals.css` `@theme`). 새 컴포넌트·리스타일 시 준수.

## 1. Raw hex 금지 — 토큰만
- 컴포넌트(JSX/TSX/CSS)에 `#xxxxxx` 직접 사용 금지. 색은 토큰 클래스(`bg-surface`, `text-ink`, `text-accent`, `border-hairline`, `text-error`, `ring-added` 등) 또는 inline style의 `var(--color-*)`로만.
- **예외(데이터/출력)**: 사용자가 노드에 지정하는 `color`와 색 팔레트 `COLOR_PRESETS`(선택지로서의 색), PNG export 배경색은 데이터/출력이며 chrome이 아니다 — 유지.

## 2. Flat elevation
- `shadow`는 떠있는 오버레이(컨텍스트 메뉴·다이얼로그·토스트)에만. 툴바·사이드바·카드·노드·헤더·계단창은 flat.
- 깊이는 `border-hairline`/`border-divider` 또는 surface 색단계(`bg-surface` ↔ `bg-surface-alt` ↔ `bg-surface-pearl`)로.

## 3. 타입
- Pretendard. 본문 17px(`text-body`), 굵기 사다리 **300/400/600**(500 금지).
- 시맨틱 스케일: `text-tagline`/`text-body-strong`/`text-body`/`text-caption`/`text-caption-strong`/`text-fine`.

## 4. 모션
- 이징 `ease-spring`/`ease-overshoot`/`ease-smooth`, duration은 `duration-150/350/450/700`. 인터랙션(hover/entrance)에만.

## 5. 언어 · 아이콘
- UI 영어 기본(동적 데이터·주석만 한글). 이모지 금지 → **Lucide 16px / strokeWidth 1.5**.

## 6. 밀도
- 생산성 화면(에디터)의 컨트롤은 컴팩트 유지(작은 패딩, `text-caption`/`text-fine`). 마케팅형 대형 여백 미적용.

## 7. 라이트 전용
- 다크모드 미지원(데스크톱 라이트). `prefers-color-scheme: dark` 스타일 추가 금지.
```

- [ ] **Step 2: CLAUDE.md에 import 추가**

`CLAUDE.md`의 "## Language-Specific Rules" 블록에서 `@rules/languages/typescript.md` 줄 바로 아래에 다음 줄 추가:
```
@rules/frontend/design.md
```

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add rules/frontend/design.md CLAUDE.md
git -C /Users/hyeonjin/Documents/bpm commit -m "docs(design): add frontend design rules + CLAUDE import — 프론트 디자인 룰" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: 토큰 인프라 + Pretendard + layout 폰트

**Files:**
- Create: `frontend/public/fonts/PretendardVariable.woff2`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/app/layout.tsx`

- [ ] **Step 1: Pretendard 자산 복사**
참고 레포가 `/tmp/cdt_ref`에 클론되어 있다(없으면 `gh repo clone Nocharm/claude_design_template /tmp/cdt_ref -- --depth 1`).
```
mkdir -p /Users/hyeonjin/Documents/bpm/frontend/public/fonts
cp /tmp/cdt_ref/public/fonts/PretendardVariable.woff2 /Users/hyeonjin/Documents/bpm/frontend/public/fonts/PretendardVariable.woff2
```
확인: `ls -l frontend/public/fonts/PretendardVariable.woff2` (약 2MB).

- [ ] **Step 2: globals.css 전체 교체**
`frontend/src/app/globals.css`를 아래로 **전체 교체**(기존 `--background/--foreground`, dark 블록, `@theme inline`(geist), Arial body 제거. 기존 `drill-in-open`/`.drill-canvas`는 유지하되 이징 토큰화):
```css
@import "tailwindcss";

/* Pretendard — 번들 가변 폰트(Windows/Linux/Mac 동일 렌더) */
@font-face {
  font-family: "Pretendard Variable";
  font-weight: 300 600;
  font-display: swap;
  src: url("/fonts/PretendardVariable.woff2") format("woff2-variations");
}

@theme {
  /* Accent — 단일 블루, 세 역할 */
  --color-accent: #0066cc;
  --color-accent-focus: #0071e3;
  --color-accent-elevated: #2997ff;
  --color-on-accent: #ffffff;

  /* Surfaces */
  --color-surface: #ffffff;
  --color-surface-alt: #f5f5f7;
  --color-surface-pearl: #fafafc;
  --color-surface-chip: #d2d2d7;

  /* Ink */
  --color-ink: #1d1d1f;
  --color-ink-secondary: #333333;
  --color-ink-tertiary: #7a7a7a;

  /* Borders */
  --color-divider: #f0f0f0;
  --color-hairline: #e0e0e0;

  /* Feedback */
  --color-error: #cc3300;

  /* Diff(비교) — 노드 타입 의미색으로도 재사용 */
  --color-added: #16794f;
  --color-removed: #cc3300;
  --color-changed: #9a6b00;

  /* Fonts */
  --font-text: "Pretendard Variable", Pretendard, -apple-system, "SF Pro Text", system-ui, sans-serif;
  --font-display: "Pretendard Variable", Pretendard, -apple-system, "SF Pro Display", system-ui, sans-serif;

  /* Type scale */
  --text-tagline: 21px;
  --text-tagline--line-height: 1.19;
  --text-tagline--font-weight: 600;
  --text-body-strong: 17px;
  --text-body-strong--line-height: 1.24;
  --text-body-strong--font-weight: 600;
  --text-body: 17px;
  --text-body--line-height: 1.47;
  --text-body--font-weight: 400;
  --text-caption: 14px;
  --text-caption--line-height: 1.43;
  --text-caption--font-weight: 400;
  --text-caption-strong: 14px;
  --text-caption-strong--line-height: 1.29;
  --text-caption-strong--font-weight: 600;
  --text-fine: 12px;
  --text-fine--line-height: 1;
  --text-fine--font-weight: 400;

  /* Radius */
  --radius-xs: 5px;
  --radius-sm: 8px;
  --radius-md: 11px;
  --radius-lg: 18px;

  /* Easing */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.25, 1, 0.5, 1);
}

body {
  background: var(--color-surface);
  color: var(--color-ink);
  font-family: var(--font-text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 드릴인 — 자식 캔버스가 좌상단에서 확장되며 열리는 연출 */
@keyframes drill-in-open {
  from {
    opacity: 0;
    transform: scale(0.92) translate(-8px, -8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translate(0, 0);
  }
}

.drill-canvas {
  transform-origin: top left;
  animation: drill-in-open 220ms var(--ease-overshoot);
}

@media (prefers-reduced-motion: reduce) {
  .drill-canvas {
    animation: none;
  }
}
```

- [ ] **Step 3: layout.tsx에서 Geist 제거**
`frontend/src/app/layout.tsx`:
- `import { Geist, Geist_Mono } from "next/font/google";` 줄 삭제.
- `const geistSans = ...` / `const geistMono = ...` 블록 삭제.
- `<html>`의 className에서 `${geistSans.variable} ${geistMono.variable}` 제거 → `className="h-full antialiased"` (lang="en" 유지).
- 나머지(metadata, LangProvider/TopNav/main/Providers 구조, body className) 변경 없음. body 폰트는 globals.css가 적용.

- [ ] **Step 4: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. 빌드 후 Pretendard가 `/fonts/PretendardVariable.woff2`로 참조되는지(빌드 에러 없음) 확인. `@theme` 토큰이 유틸리티를 생성하는지는 다음 태스크의 클래스 사용으로 검증된다.

- [ ] **Step 5: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/public/fonts/PretendardVariable.woff2 frontend/src/app/globals.css frontend/src/app/layout.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(design): Apple-derived tokens + Pretendard, drop dark/geist — 토큰 인프라" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: lucide-react 설치

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`

- [ ] **Step 1: 설치**
Run(frontend/): `npm install lucide-react`
(최신 버전 — React 19 호환. dependencies에 추가됨.)

- [ ] **Step 2: 검증**
Run(frontend/): `npm run build`
Expected: PASS(설치만으로 빌드 영향 없음, 사용은 후속 태스크). 만약 React 19 peer 경고로 설치 실패 시 `npm install lucide-react@latest --legacy-peer-deps` 대신 호환 버전 확인 후 보고(BLOCKED).

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/package.json frontend/package-lock.json
git -C /Users/hyeonjin/Documents/bpm commit -m "build(frontend): add lucide-react for icon system — 아이콘 의존성" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: layout + top-nav 리스타일

**Files:**
- Modify: `frontend/src/components/top-nav.tsx`

- [ ] **Step 1: top-nav 토큰화**
`frontend/src/components/top-nav.tsx` READ 후 className 교체(구조/로직 불변):
- `<nav>` 의 `border-zinc-200` → `border-hairline`, 배경 추가 `bg-surface`. 결과: `flex h-10 shrink-0 items-center justify-between border-b border-hairline bg-surface px-4`.
- 브랜드 `<Link>`: `text-zinc-800` → `text-ink`, 폰트 `text-body-strong`(또는 유지). 결과: `text-body-strong text-ink`.
- 유저칩 `<span>`: `text-zinc-600` → `text-ink-secondary text-caption`.
- 토글 `<button>`: `border-zinc-300` → `border-hairline`, `hover:bg-zinc-50` → `hover:bg-surface-alt`, 텍스트 `text-ink-secondary`, `text-xs` → `text-fine`. 결과: `rounded-xs border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt`.

- [ ] **Step 2: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint`
Expected: PASS. (토큰 클래스가 실제 유틸리티로 생성되는지 여기서 1차 확인 — 미생성이면 빌드/스타일 누락. `npm run build`도 실행해 확인.)
Run: `npm run build` → PASS.

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/components/top-nav.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "style(nav): tokenize top nav — flat hairline surface" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: home 화면 리스타일

**Files:**
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1: 토큰화**
`frontend/src/app/page.tsx` READ 후 적용(로직/문자열 불변, className·아이콘만):
- 제목: `프로세스맵`은 이미 `t("home.title")`. 그 헤딩에 `text-tagline text-ink` 적용.
- 맵 카드/리스트 항목: shadow 클래스가 있으면 제거, 경계 `border-zinc-*` → `border-hairline`, 배경 `bg-surface`(hover `bg-surface-alt`). 텍스트 `text-ink`/`text-ink-secondary`.
- 생성 버튼: primary → `bg-accent text-on-accent hover:bg-accent-focus rounded-sm px-3 py-1 text-caption-strong`. (앞에 `<Plus size={16} strokeWidth={1.5} />` 추가, 부모 `inline-flex items-center gap-1`.) import: `import { Plus, Trash2 } from "lucide-react";`
- 삭제 버튼: 텍스트 → `text-error hover:bg-error/10`(또는 `hover:bg-surface-alt`), 앞에 `<Trash2 size={16} strokeWidth={1.5} />` 옵션.
- 입력(새 맵 이름): `border-zinc-300` → `border-hairline rounded-sm`, placeholder는 t 유지.
- empty 상태 텍스트: `text-ink-tertiary`.
- 에러 메시지: `text-red-*` → `text-error`.

(정확한 기존 className은 파일에서 확인 후 위 매핑대로 치환. raw hex 신규 도입 금지.)

- [ ] **Step 2: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/app/page.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "style(home): tokenize map list + lucide icons" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: editor 리스타일 (대형)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1: 공통 버튼 클래스 토큰화**
`toolButton` 상수(헤더 도구 버튼 공통 클래스)를 flat 토큰으로 교체:
```ts
const toolButton =
  "inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
```

- [ ] **Step 2: 헤더/패널/경계 토큰화**
- `<header>` 의 `border-zinc-200` → `border-hairline`. 배경 필요 시 `bg-surface`.
- 사이드바 `<aside>` 의 `border-zinc-200` → `border-hairline`, 배경 `bg-surface`. 내부 라벨 `text-zinc-500` → `text-ink-tertiary text-fine`, 제목 `text-zinc-600` → `text-ink-secondary text-caption-strong`.
- 모든 입력/셀렉트의 `border-zinc-300` → `border-hairline rounded-sm`, 텍스트 `text-sm` → `text-caption`.
- 브레드크럼 `nav`: 활성 `text-zinc-800` → `text-ink`, 비활성 `text-blue-700 hover:underline` → `text-accent hover:underline`, 구분자 `›`를 `<ChevronRight size={14} strokeWidth={1.5} className="text-ink-tertiary" />`로(또는 텍스트 유지 + `text-ink-tertiary`).

- [ ] **Step 3: 상태색 토큰화**
- 저장중 `text-zinc-400` → `text-ink-tertiary`.
- 저장됨 `text-green-600` → `text-added`. (앞 ✓는 `<Check size={14} strokeWidth={1.5} />`로.)
- 저장실패 `text-red-600` → `text-error`.
- 읽기전용 배너: `bg-amber-100 text-amber-900` → `bg-changed/10 text-changed`(또는 `border border-changed text-changed`); 강제편집 버튼 `bg-red-500 text-white` → `bg-error text-on-accent`.
- 🔒 편집중: `🔒` → `<Lock size={14} strokeWidth={1.5} />` (`text-ink-tertiary`).
- 📝 editingByOther 배너: `📝` → `<PencilLine size={14} strokeWidth={1.5} />`.

- [ ] **Step 4: 아이콘 버튼 교체**
- undo 버튼 텍스트 `↶` → `<Undo2 size={16} strokeWidth={1.5} />`; redo `↷` → `<Redo2 size={16} strokeWidth={1.5} />`.
- `← 목록`: `←` → `<ArrowLeft size={16} strokeWidth={1.5} />` + 텍스트(부모 `inline-flex items-center gap-1`), 색 `text-accent`.
- 검색 입력 앞에 `<Search size={16} strokeWidth={1.5} className="..." />`(옵션, 입력 내부 아이콘이면 relative 래퍼). 최소: placeholder 유지 + 입력 토큰화.
- PNG 버튼: 텍스트 앞 `<Download size={16} strokeWidth={1.5} />`.
- `+ 노드` 버튼: `+` → `<Plus size={16} strokeWidth={1.5} />` + "Node" 텍스트(t("editor.addNode")는 "+ Node"이므로, 텍스트의 "+"는 제거하고 아이콘으로 대체 — `t("editor.addNode")` 값을 "Node"로 바꾸기보다, 버튼 내부를 `<Plus/> <span>{t("editor.addNode").replace("+ ","")}</span>` 로 처리하거나 i18n 값을 "Node"로 수정. 권장: i18n-messages의 `editor.addNode`를 "Node"/"노드"로 바꾸고 버튼에 `<Plus/>` 추가.)
- 저장 버튼(primary): `bg-blue-600 text-white hover:bg-blue-700` → `bg-accent text-on-accent hover:bg-accent-focus`.

import: `import { Undo2, Redo2, ArrowLeft, Search, Download, Plus, Check, Lock, PencilLine, ChevronRight } from "lucide-react";`

- [ ] **Step 5: 계단창 shadow 제거 → hairline/surface**
드릴인 창 블록에서:
- 활성/조상 창 `<div>`의 `shadow` 클래스 제거.
- 활성 창: `border-zinc-300` → `border-hairline`, `bg-white` → `bg-surface`.
- 조상 창: `border-zinc-200` → `border-divider`, `bg-white` → `bg-surface`.
- 타이틀바 버튼: 활성 `bg-zinc-50` → `bg-surface-alt`, `text-zinc-700` → `text-ink-secondary`; 조상 `bg-zinc-100 text-zinc-500 hover:bg-zinc-200` → `bg-surface-alt text-ink-tertiary hover:bg-surface-pearl`, 경계 `border-zinc-200` → `border-hairline`.
- 컨테이너 `bg-zinc-100` → `bg-surface-alt`.

- [ ] **Step 6: COLOR_PRESETS / export bg 예외 확인**
`COLOR_PRESETS`(raw hex 팔레트)와 색 swatch의 `backgroundColor: preset || "#ffffff"`, PNG export 배경은 **데이터/출력 예외 — 변경하지 않는다**(룰 §1 예외). 손대지 말 것.

- [ ] **Step 7: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. 잔여 chrome `bg-white`/`border-zinc`/`text-zinc`/이모지가 의도치 않게 남지 않았는지 점검: `grep -nE 'zinc-|bg-white|text-blue-|🔒|📝|↶|↷' "src/app/maps/[mapId]/page.tsx"` — 남은 항목이 데이터/예외인지 확인.

- [ ] **Step 8: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git -C /Users/hyeonjin/Documents/bpm commit -m "style(editor): tokenize editor chrome + lucide icons + flat cascade" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
(i18n-messages는 `editor.addNode` 값 조정 시에만 add.)

---

## Task 7: compare 리스타일 + diff 토큰

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx`

- [ ] **Step 1: diff 색 토큰화**
`frontend/src/app/maps/[mapId]/compare/page.tsx`:
- 엣지 stroke raw hex: `"#22c55e"` → `"var(--color-added)"`, `"#ef4444"` → `"var(--color-removed)"` (inline style 객체 내).
- `DiffLegend`: `border-green-500` → `border-added`, `border-red-500` → `border-removed`, `border-amber-500` → `border-changed`. ⚡ → `<Zap size={14} strokeWidth={1.5} />`. 텍스트 `text-zinc-600` → `text-ink-secondary text-caption`.
- 변경 목록/요약/상태 텍스트: green/red/amber 계열 클래스가 있으면 `text-added`/`text-removed`/`text-changed`로.
- 경계/배경: `border-zinc-200` → `border-hairline`, `bg-white`(있으면) → `bg-surface`, shadow 제거.
- 셀렉트/링크: `border-zinc-300` → `border-hairline rounded-sm`, 편집기 링크 `text-blue-*` → `text-accent`. 제목 `text-tagline text-ink`.
import: `import { Zap } from "lucide-react";`

- [ ] **Step 2: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. `grep -nE '#[0-9a-fA-F]{6}|zinc-|green-5|red-5|amber-5|⚡' "src/app/maps/[mapId]/compare/page.tsx"` 로 잔여 chrome 색/이모지 없는지 확인.

- [ ] **Step 3: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add "frontend/src/app/maps/[mapId]/compare/page.tsx"
git -C /Users/hyeonjin/Documents/bpm commit -m "style(compare): diff tokens + lucide" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: process-node + comment-section + context-menu 리스타일

**Files:**
- Modify: `frontend/src/components/process-node.tsx`
- Modify: `frontend/src/components/comment-section.tsx`
- Modify: `frontend/src/components/context-menu.tsx`

- [ ] **Step 1: process-node 색 토큰화 + 뱃지 아이콘**
`frontend/src/components/process-node.tsx`:
- `DEFAULT_COLORS`(타입별 테두리 raw hex)를 토큰 CSS 변수 참조로:
```ts
const DEFAULT_COLORS: Record<ProcessNodeType, string> = {
  process: "var(--color-surface-chip)",
  decision: "var(--color-changed)",
  start: "var(--color-added)",
  end: "var(--color-removed)",
};
```
(이 값은 `style={{ borderColor: color }}` 등 inline style에 그대로 들어가므로 `var(--color-*)`가 유효.)
- `DIFF_RINGS`: `ring-green-500` → `ring-added`, `ring-red-500 opacity-60` → `ring-removed opacity-60`, `ring-amber-500` → `ring-changed`.
- `UnresolvedCommentBadge`: `bg-red-500` → `bg-removed`, 본문 `💬{count}` → `<span className="inline-flex items-center gap-0.5"><MessageSquare size={10} strokeWidth={1.5} />{count}</span>`. `text-white` 유지(또는 `text-on-accent`).
- `DescendantChangeBadge`: `bg-amber-400` → `bg-changed`, `⚡` → `<Zap size={10} strokeWidth={1.5} />`.
- 👤 assignee: `👤 {data.assignee}` → `<span className="inline-flex items-center gap-1"><User size={12} strokeWidth={1.5} />{data.assignee}</span>`, 텍스트 색 `text-zinc-500` → `text-ink-tertiary`.
- ▾ 하위 표시(2곳: 마름모 `text-[10px] text-blue-600`, 일반 `text-xs text-blue-600`): `▾ ` → `<CornerDownRight size={12} strokeWidth={1.5} />` + 텍스트, 색 `text-blue-600` → `text-accent`.
- 노드 본문 텍스트 `text-zinc-800` → `text-ink`.
import: `import { MessageSquare, Zap, User, CornerDownRight } from "lucide-react";`

- [ ] **Step 2: comment-section 토큰화**
`frontend/src/components/comment-section.tsx`:
- 버튼/경계 `border-zinc-*` → `border-hairline`, 배경 `bg-zinc-50`(있으면) → `bg-surface-alt`.
- 해결/재열기 버튼: 색 토큰(`text-ink-secondary`), 삭제 버튼: `text-error`(앞에 `<Trash2 size={14} strokeWidth={1.5} />` 옵션).
- empty/placeholder: `text-zinc-400/500` → `text-ink-tertiary`. 텍스트 크기 `text-sm` → `text-caption`.
- 등록 버튼: primary면 `bg-accent text-on-accent`.
import(아이콘 쓸 경우): `import { Trash2, Check } from "lucide-react";`

- [ ] **Step 3: context-menu 토큰화 (shadow 유지)**
`frontend/src/components/context-menu.tsx`(오버레이 — **shadow 유지, 규칙 §2 허용**):
- 배경 `bg-white` → `bg-surface`, 경계 `border-zinc-*` → `border-hairline`, 항목 hover `hover:bg-zinc-50/100` → `hover:bg-surface-alt`.
- danger 항목: `text-red-600` → `text-error`.
- 텍스트 `text-sm` → `text-caption`, shortcut `text-zinc-400` → `text-ink-tertiary`.

- [ ] **Step 4: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. `grep -rnE 'zinc-|green-5|red-5|amber-5|blue-6|🔒|📝|⚡|👤|💬|▾' src/components` 로 잔여 chrome/이모지 점검(데이터 예외 외 없어야 함).

- [ ] **Step 5: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/components/process-node.tsx frontend/src/components/comment-section.tsx frontend/src/components/context-menu.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "style(components): tokenize node/comment/menu + lucide" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 최종 검증

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` 모두 PASS.
- [ ] chrome raw hex 0 확인: `grep -rnE '#[0-9a-fA-F]{6}' frontend/src` 결과가 **데이터/출력 예외만**(globals.css 토큰 정의부, `COLOR_PRESETS`(page.tsx), swatch `#ffffff`, `export.ts` PNG bg) 남는지 점검.
- [ ] 잔여 이모지 0: `grep -rnE '🔒|📝|⚡|👤|💬|↶|↷|▾' frontend/src` → 없음.
- [ ] PROGRESS.md 갱신 후 커밋.
- [ ] 사용자 수동 시각 검증 체크리스트 전달: Pretendard 렌더(국/영), flat 룩(그림자 없음, hairline 경계), Lucide 아이콘 표시, accent 블루 primary, 계단창 색단계, compare diff 색, 노드 타입 색.

---

## Self-Review (작성자 점검)
- **스펙 커버리지:** ①룰=Task1, ②토큰=Task2, ③Pretendard=Task2, ④리스타일=Task4~8, lucide=Task3. diff 토큰=Task2 정의+Task7 사용. 전 항목 매핑.
- **플레이스홀더:** 없음. 신규 파일(룰·globals.css)은 전체 내용, 리스타일은 매핑표+정확한 토큰. 기존 className은 "파일에서 확인 후 치환"으로 명시(1419행 전체 재출력 회피) — 토큰 매핑표가 권위.
- **타입 일관성:** 토큰 이름(`surface/ink/hairline/accent/added/removed/changed/surface-chip`), Lucide 컴포넌트명, `DEFAULT_COLORS` var 참조가 태스크 간 일치.
- **위험:** Tailwind 4 `@theme` 유틸 생성은 Task4 첫 사용에서 build로 검증(미생성 시 조기 발견). `editor.addNode` "+ Node" → Plus 아이콘 처리(Task6 Step4)는 i18n 값 조정 동반 가능 — 명시. lucide-react React19 호환은 Task3 build로 확인.
