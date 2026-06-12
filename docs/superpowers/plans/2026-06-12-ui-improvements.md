# UI Improvements Implementation Plan (drill-in cascade · global nav/i18n · shortcuts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로세스맵 에디터에 ① 계단식 창 드릴인 애니메이션, ② 전역 네비바 + 앱 전체 영/한 i18n(기본 영어), ③ 박스 다중선택·스페이스 팬 단축키를 추가한다.

**Architecture:** 순수 프론트엔드. 경량 자체 i18n(React context + 타입드 사전, 새 의존성 0). 드릴인은 라이브 ReactFlow 캔버스 1개 + 조상 장식 프레임 계단식 배치 + 좌상단 origin 확장 애니메이션. 유저 정보는 AuthGate가 모듈 스토어에 발행, TopNav가 구독(로컬은 Guest). 단축키는 ReactFlow props로 처리.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, @xyflow/react 12, TailwindCSS 4, TypeScript 5. 테스트 러너 없음 → 검증은 `npx tsc --noEmit` + `npm run lint` + `npm run build` + 수동 체크리스트.

**작업 디렉터리:** 모든 명령은 `frontend/`에서 실행.

**Next 버전 주의:** `frontend/AGENTS.md` — "This is NOT the Next.js you know". layout/metadata 등 Next API를 만질 때는 `node_modules/next/dist/docs/`의 해당 가이드를 먼저 확인. 본 계획의 변경은 표준 App Router 범위(client provider 래핑, client component 추가)라 리스크는 낮음.

---

## File Structure

신규:
- `src/lib/i18n-messages.ts` — 전체 번역 사전(en 권위, ko는 `Record<keyof en, string>`로 타입 강제). 키 누락/잉여를 tsc가 잡음.
- `src/lib/i18n.tsx` — `LangProvider`, `useI18n()`, `t(key, vars?)`. localStorage 영속(`bpm.lang`), 기본 en.
- `src/lib/current-user.ts` — 유저 프로필 모듈 스토어(`setCurrentUser`/`subscribe`/`getSnapshot`), `authToken` 패턴과 동형.
- `src/components/top-nav.tsx` — 전역 얇은 바(브랜드 · 유저칩 · 영/한 토글).

수정:
- `src/app/layout.tsx` — `LangProvider` 래핑 + `<TopNav>` + body flex column.
- `src/app/globals.css` — 드릴인 entrance 키프레임 + reduced-motion 가드.
- `src/app/page.tsx` — 홈 문자열 t() 교체 + `h-full`.
- `src/app/maps/[mapId]/page.tsx` — 에디터 문자열 t() 교체 + 계단식 프레임/애니메이션 + ReactFlow 단축키 props + 루트 `h-full`.
- `src/app/maps/[mapId]/compare/page.tsx` — 비교 문자열 t() 교체 + `h-full`.
- `src/lib/canvas.ts` — `NODE_TYPE_OPTIONS`의 `label` → `labelKey`.
- `src/lib/diff.ts` — 변경 필드 한국어 라벨 → 필드 키(`ChangedField`).
- `src/components/process-node.tsx` · `comment-section.tsx` · `context-menu.tsx`(해당 없음, 항목 라벨은 호출부) · `providers.tsx`(AuthGate 문자열 + 유저 발행).

---

## Task 1: i18n 인프라 + 전체 사전 + layout 래핑

**Files:**
- Create: `src/lib/i18n-messages.ts`
- Create: `src/lib/i18n.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 사전 파일 작성**

`src/lib/i18n-messages.ts` — en을 권위로, ko를 `Record<keyof typeof en, string>`로 선언해 키 누락을 컴파일 타임에 강제한다. `{x}` 토큰은 `t`의 vars로 치환.

```ts
"""번역 사전 — en 권위, ko는 동일 키 강제(tsc). {x}는 t(key, vars)로 치환."""

export type Lang = "en" | "ko";

const en = {
  // common / nav
  "app.name": "BPM",
  "nav.guest": "Guest",
  "nav.toEnglish": "EN",
  "nav.toKorean": "한",
  "auth.error": "Auth error: {msg}",
  "auth.signingIn": "Signing in…",
  // home
  "home.title": "Process Maps",
  "home.newMapPlaceholder": "New map name",
  "home.create": "Create",
  "home.empty": "No maps yet.",
  "home.delete": "Delete",
  "err.loadMaps": "Failed to load map list",
  "err.createMap": "Failed to create map",
  "err.deleteMap": "Failed to delete map",
  // editor header / tools
  "editor.backToList": "List",
  "editor.searchPlaceholder": "Search nodes — chosung ok (Ctrl+K)",
  "editor.versionSelectAria": "Select version",
  "editor.newVersion": "New version",
  "editor.rename": "Rename",
  "editor.deleteVersion": "Delete version",
  "editor.compare": "Compare",
  "editor.undoTitle": "Undo (Ctrl+Z)",
  "editor.redoTitle": "Redo (Ctrl+Shift+Z)",
  "editor.autoLayout": "Auto layout",
  "editor.alignLeft": "Align left",
  "editor.alignTop": "Align top",
  "editor.distributeX": "Distribute H",
  "editor.distributeY": "Distribute V",
  "editor.addNode": "+ Node",
  "editor.save": "Save",
  "editor.saving": "Saving…",
  "editor.saved": "Saved ✓",
  "editor.saveError": "Save failed — retry with Save button",
  "editor.editingByOther": "{name} is editing — read only",
  "editor.forceEdit": "Force edit",
  "editor.editingMineTitle": "You are editing this version",
  "editor.editingMine": "Editing",
  // editor side panel
  "editor.nodeEdit": "Edit node",
  "field.title": "Title",
  "field.description": "Description",
  "field.type": "Type",
  "field.color": "Color",
  "field.assignee": "Assignee",
  "field.department": "Department",
  "field.system": "System",
  "field.duration": "Duration",
  "field.location": "Location (hierarchy)",
  "editor.defaultColor": "Default color",
  "editor.colorDefaultName": "default",
  "editor.colorAria": "Color {name}",
  "editor.hexPlaceholder": "Enter #RRGGBB then Enter",
  "editor.bpmAttrs": "BPM attributes",
  "editor.durationPlaceholder": "e.g. 2 days",
  "editor.comments": "Comments",
  "editor.unresolvedCount": "unresolved {n}",
  "editor.hintNode": "Double-click: open child · Right-click: menu · Ctrl+Z: undo",
  "editor.edgeEdit": "Edit edge",
  "editor.edgeLabel": "Label (branch condition, etc.)",
  "editor.hintEdge": "Right-click: menu · Ctrl+Z: undo",
  "editor.newStep": "New step",
  // context menu items
  "ctx.addNode": "+ Add node",
  "ctx.autoLayout": "Auto layout",
  "ctx.delete": "Delete",
  "ctx.openChild": "Open child process",
  "ctx.doubleClick": "Double-click",
  "ctx.editLabel": "Edit label",
  // prompts / confirms
  "prompt.newVersionName": "New version name (clones current version)",
  "prompt.renameVersion": "Rename version",
  "prompt.deleteVersionConfirm": "Delete this version? This cannot be undone.",
  // editor errors
  "err.loadMap": "Failed to load map",
  "err.loadCanvas": "Failed to load canvas",
  "err.search": "Search failed",
  "err.checkout": "Checkout failed",
  "err.forceCheckout": "Force checkout failed",
  "err.addComment": "Failed to add comment",
  "err.toggleComment": "Failed to update comment",
  "err.deleteComment": "Failed to delete comment (author only)",
  "err.save": "Failed to save",
  "err.createVersion": "Failed to create version",
  "err.renameVersion": "Failed to rename",
  "err.deleteVersion": "Failed to delete version",
  "err.exportPng": "Failed to export PNG",
  // node types
  "nodeType.process": "Process",
  "nodeType.decision": "Decision (branch)",
  "nodeType.start": "Start",
  "nodeType.end": "End",
  // process node badges
  "node.childBadge": "Sub",
  "node.openChildTitle": "Child process",
  "node.unresolvedAria": "{n} unresolved comments",
  "node.childChangedTitle": "Child has changes",
  // comment section
  "comment.reopen": "Reopen",
  "comment.resolve": "Resolve",
  "comment.delete": "Delete",
  "comment.empty": "No comments yet.",
  "comment.placeholder": "Write a comment — Ctrl+Enter to send",
  "comment.submit": "Post",
  // compare
  "compare.statusAdded": "Added",
  "compare.statusRemoved": "Removed",
  "compare.statusChanged": "Changed",
  "compare.legendAdded": "Added",
  "compare.legendRemoved": "Removed",
  "compare.legendChanged": "Changed",
  "compare.changedFields": "Changed: {fields}",
  "compare.selectVersionAria": "Select comparison version",
  "compare.childChanged": "Child changed",
  "compare.identical": "The two versions are identical.",
  "compare.summary": "Added {a} · Removed {r} · Changed {c}",
  "compare.editorLink": "Editor",
  "compare.title": "Version compare",
  "compare.subtitle": "Left baseline → right changes",
} as const;

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  "app.name": "BPM",
  "nav.guest": "Guest",
  "nav.toEnglish": "EN",
  "nav.toKorean": "한",
  "auth.error": "인증 오류: {msg}",
  "auth.signingIn": "로그인 중…",
  "home.title": "프로세스맵",
  "home.newMapPlaceholder": "새 맵 이름",
  "home.create": "생성",
  "home.empty": "아직 맵이 없습니다.",
  "home.delete": "삭제",
  "err.loadMaps": "맵 목록을 불러오지 못했습니다",
  "err.createMap": "맵 생성에 실패했습니다",
  "err.deleteMap": "맵 삭제에 실패했습니다",
  "editor.backToList": "목록",
  "editor.searchPlaceholder": "노드 검색 — 초성 가능 (Ctrl+K)",
  "editor.versionSelectAria": "버전 선택",
  "editor.newVersion": "새 버전",
  "editor.rename": "이름변경",
  "editor.deleteVersion": "버전삭제",
  "editor.compare": "비교",
  "editor.undoTitle": "실행취소 (Ctrl+Z)",
  "editor.redoTitle": "다시실행 (Ctrl+Shift+Z)",
  "editor.autoLayout": "자동 정렬",
  "editor.alignLeft": "좌측 맞춤",
  "editor.alignTop": "상단 맞춤",
  "editor.distributeX": "가로 등간격",
  "editor.distributeY": "세로 등간격",
  "editor.addNode": "+ 노드",
  "editor.save": "저장",
  "editor.saving": "저장 중…",
  "editor.saved": "저장됨 ✓",
  "editor.saveError": "저장 실패 — 저장 버튼으로 재시도",
  "editor.editingByOther": "{name}님이 편집 중 — 읽기 전용",
  "editor.forceEdit": "강제 편집",
  "editor.editingMineTitle": "이 버전을 편집 중입니다",
  "editor.editingMine": "편집 중",
  "editor.nodeEdit": "노드 편집",
  "field.title": "제목",
  "field.description": "설명",
  "field.type": "타입",
  "field.color": "색상",
  "field.assignee": "담당자",
  "field.department": "부서",
  "field.system": "시스템",
  "field.duration": "소요시간",
  "field.location": "위치(계층)",
  "editor.defaultColor": "기본색",
  "editor.colorDefaultName": "기본",
  "editor.colorAria": "색상 {name}",
  "editor.hexPlaceholder": "#RRGGBB 직접 입력 후 Enter",
  "editor.bpmAttrs": "BPM 속성",
  "editor.durationPlaceholder": "예: 2일",
  "editor.comments": "코멘트",
  "editor.unresolvedCount": "미해결 {n}",
  "editor.hintNode": "더블클릭: 하위 프로세스로 진입 · 우클릭: 메뉴 · Ctrl+Z: 실행취소",
  "editor.edgeEdit": "엣지 편집",
  "editor.edgeLabel": "라벨 (분기 조건 등)",
  "editor.hintEdge": "우클릭: 메뉴 · Ctrl+Z: 실행취소",
  "editor.newStep": "새 단계",
  "ctx.addNode": "+ 노드 추가",
  "ctx.autoLayout": "자동 정렬",
  "ctx.delete": "삭제",
  "ctx.openChild": "하위 프로세스 열기",
  "ctx.doubleClick": "더블클릭",
  "ctx.editLabel": "라벨 편집",
  "prompt.newVersionName": "새 버전 이름 (현재 버전을 복제합니다)",
  "prompt.renameVersion": "버전 이름 변경",
  "prompt.deleteVersionConfirm": "이 버전을 삭제할까요? 되돌릴 수 없습니다.",
  "err.loadMap": "맵을 불러오지 못했습니다",
  "err.loadCanvas": "캔버스를 불러오지 못했습니다",
  "err.search": "검색에 실패했습니다",
  "err.checkout": "체크아웃에 실패했습니다",
  "err.forceCheckout": "강제 체크아웃에 실패했습니다",
  "err.addComment": "코멘트 등록에 실패했습니다",
  "err.toggleComment": "코멘트 변경에 실패했습니다",
  "err.deleteComment": "코멘트 삭제에 실패했습니다 (작성자만 가능)",
  "err.save": "저장에 실패했습니다",
  "err.createVersion": "버전 생성에 실패했습니다",
  "err.renameVersion": "이름 변경에 실패했습니다",
  "err.deleteVersion": "버전 삭제에 실패했습니다",
  "err.exportPng": "PNG 내보내기에 실패했습니다",
  "nodeType.process": "프로세스",
  "nodeType.decision": "판단(분기)",
  "nodeType.start": "시작",
  "nodeType.end": "종료",
  "node.childBadge": "하위",
  "node.openChildTitle": "하위 프로세스",
  "node.unresolvedAria": "미해결 코멘트 {n}개",
  "node.childChangedTitle": "하위 프로세스에 변경 있음",
  "comment.reopen": "재열기",
  "comment.resolve": "해결",
  "comment.delete": "삭제",
  "comment.empty": "아직 코멘트가 없습니다.",
  "comment.placeholder": "코멘트 작성 — Ctrl+Enter 전송",
  "comment.submit": "등록",
  "compare.statusAdded": "추가됨",
  "compare.statusRemoved": "삭제됨",
  "compare.statusChanged": "변경됨",
  "compare.legendAdded": "추가",
  "compare.legendRemoved": "삭제",
  "compare.legendChanged": "변경",
  "compare.changedFields": "변경: {fields}",
  "compare.selectVersionAria": "비교 버전 선택",
  "compare.childChanged": "하위 변경 있음",
  "compare.identical": "두 버전의 내용이 동일합니다.",
  "compare.summary": "추가 {a} · 삭제 {r} · 변경 {c}",
  "compare.editorLink": "편집기",
  "compare.title": "버전 비교",
  "compare.subtitle": "왼쪽 기준 → 오른쪽 변경",
};

export const messages: Record<Lang, Record<MessageKey, string>> = { en, ko };
```

- [ ] **Step 2: i18n 컨텍스트 작성**

`src/lib/i18n.tsx` — 초기 렌더는 en(SSR 일치), 마운트 후 localStorage 복원. `{x}` 토큰 치환.

```tsx
"""앱 전체 i18n — LangProvider + useI18n + t(key, vars). 기본 영어, localStorage 영속."""
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { messages, type Lang, type MessageKey } from "@/lib/i18n-messages";

const STORAGE_KEY = "bpm.lang";
const DEFAULT_LANG: Lang = "en";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // localStorage는 클라이언트 전용 — 마운트 후 복원해 초기 SSR 렌더(en)와 일치시킴
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") {
      setLangState(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const toggleLang = () => setLang(lang === "en" ? "ko" : "en");

  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    let str: string = messages[lang][key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LangProvider");
  }
  return ctx;
}
```

- [ ] **Step 3: layout에 LangProvider 래핑**

`src/app/layout.tsx` 수정 — `Providers` 바깥(인증보다 위)에 `LangProvider`를 둔다. `lang="ko"` 하드코딩은 제거(i18n이 effect로 설정하므로 초기값 en으로).

```tsx
// import 추가
import { LangProvider } from "@/lib/i18n";

// <html lang="ko" ...> → <html lang="en" ...>
// <body> 내부를 LangProvider로 감싼다:
//   <body className="...">
//     <LangProvider>
//       <Providers>{children}</Providers>
//     </LangProvider>
//   </body>
```

- [ ] **Step 4: 타입체크/린트**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: PASS. en/ko 키가 어긋나면 tsc가 `Record<MessageKey,...>`에서 에러로 잡는다(의도된 안전장치). 어긋남이 있으면 사전을 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n-messages.ts src/lib/i18n.tsx src/app/layout.tsx
git commit -m "feat(i18n): add lightweight LangProvider + full en/ko dictionary — 앱 전체 i18n 인프라"
```

---

## Task 2: 유저 스토어 + AuthGate 발행/번역

**Files:**
- Create: `src/lib/current-user.ts`
- Modify: `src/components/providers.tsx`

- [ ] **Step 1: 유저 모듈 스토어 작성**

`src/lib/current-user.ts` — `useSyncExternalStore`로 구독 가능한 모듈 스토어. `authToken` 패턴과 동형.

```ts
"""현재 로그인 유저 표시명 — AuthGate가 발행, TopNav가 구독. 로컬(인증 비활성)이면 null."""

export interface CurrentUser {
  name: string;
  email: string | null;
}

let currentUser: CurrentUser | null = null;
const listeners = new Set<() => void>();

export function setCurrentUser(user: CurrentUser | null): void {
  currentUser = user;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCurrentUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}
```

- [ ] **Step 2: AuthGate가 유저 발행 + 문자열 번역**

`src/components/providers.tsx` 수정:
1. import 추가: `import { setCurrentUser } from "@/lib/current-user";` 와 `import { useI18n } from "@/lib/i18n";`
2. `AuthGate`의 토큰 동기화 effect 옆에 유저 발행 effect 추가:

```tsx
// 액세스 토큰 동기화 effect 바로 아래에 추가
useEffect(() => {
  const profile = auth.user?.profile;
  if (profile) {
    setCurrentUser({
      name: profile.name ?? profile.preferred_username ?? profile.email ?? "User",
      email: profile.email ?? null,
    });
  } else {
    setCurrentUser(null);
  }
}, [auth.user]);
```

3. `AuthGate` 내부에 `const { t } = useI18n();` 추가하고 두 메시지를 교체:
   - `인증 오류: {auth.error.message}` → `{t("auth.error", { msg: auth.error.message })}`
   - `로그인 중…` → `{t("auth.signingIn")}`

- [ ] **Step 3: 타입체크/린트**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: PASS. (`auth.user?.profile`는 oidc-client-ts의 `IdTokenClaims` — `name`/`preferred_username`/`email`은 옵셔널 string.)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/current-user.ts src/components/providers.tsx
git commit -m "feat(auth): publish current user to module store + i18n AuthGate strings — 유저 칩 데이터 소스"
```

---

## Task 3: 전역 TopNav + layout/에디터 높이 조정

**Files:**
- Create: `src/components/top-nav.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/maps/[mapId]/page.tsx` (루트 `h-screen` → `h-full`)
- Modify: `src/app/maps/[mapId]/compare/page.tsx` (루트 높이)
- Modify: `src/app/page.tsx` (해당 시 높이)

- [ ] **Step 1: TopNav 컴포넌트 작성**

`src/components/top-nav.tsx` — 유저칩(구독) + 영/한 토글. 유저 없으면 Guest.

```tsx
"""전역 네비게이션 바 — 브랜드 · 유저칩 · 영/한 토글. 모든 페이지 상단."""
"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";

export function TopNav() {
  const { t, lang, toggleLang } = useI18n();
  const user = useSyncExternalStore(
    subscribeCurrentUser,
    getCurrentUser,
    () => null, // 서버 스냅샷 — SSR에서는 유저 없음
  );

  return (
    <nav className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
      <Link href="/" className="text-sm font-semibold text-zinc-800">
        {t("app.name")}
      </Link>
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-600">{user?.name ?? t("nav.guest")}</span>
        <button
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50"
          onClick={toggleLang}
          aria-label="Toggle language"
        >
          {lang === "en" ? t("nav.toKorean") : t("nav.toEnglish")}
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: layout에 TopNav 추가 + body flex column**

`src/app/layout.tsx` 수정 — `LangProvider` 안, `Providers` 위에 `<TopNav>`, 본문은 `flex-1 min-h-0`로 감싼다.

```tsx
import { TopNav } from "@/components/top-nav";

// body 내부:
//   <LangProvider>
//     <TopNav />
//     <main className="flex flex-1 flex-col min-h-0">
//       <Providers>{children}</Providers>
//     </main>
//   </LangProvider>
//
// body className은 화면 높이 고정 + column: "h-screen flex flex-col"
```

주의: 기존 `body className="min-h-full flex flex-col"`를 `h-screen flex flex-col`로 바꿔 TopNav(h-10)+main(flex-1)이 뷰포트에 맞게 한다.

- [ ] **Step 3: 에디터 루트 높이 조정**

`src/app/maps/[mapId]/page.tsx`의 `MapEditor` 최상위 `<div className="flex h-screen flex-col">` → `<div className="flex h-full flex-col">` (이제 부모 `<main flex-1>`이 높이를 제공).

- [ ] **Step 4: compare/home 높이 확인**

`src/app/maps/[mapId]/compare/page.tsx`와 `src/app/page.tsx`에서 `h-screen`을 쓰는 최상위가 있으면 `h-full`로 바꾼다. (없으면 변경 없음 — grep으로 확인: `grep -n "h-screen" src/app/page.tsx src/app/maps/\[mapId\]/compare/page.tsx`.)

- [ ] **Step 5: 빌드 + 타입체크 + 린트**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. 빌드 성공.

- [ ] **Step 6: 커밋**

```bash
git add src/components/top-nav.tsx src/app/layout.tsx "src/app/maps/[mapId]/page.tsx" "src/app/maps/[mapId]/compare/page.tsx" src/app/page.tsx
git commit -m "feat(nav): global top nav with user chip + EN/KO toggle — 전역 네비바"
```

---

## Task 4: 홈 화면 번역

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: useI18n 도입 + 문자열 교체**

`src/app/page.tsx`는 client component(`"use client"` 확인). 컴포넌트 상단에 `const { t } = useI18n();` 추가하고 아래 매핑대로 교체. import: `import { useI18n } from "@/lib/i18n";`

| 위치(현재 한국어) | 교체 |
|---|---|
| `"맵 목록을 불러오지 못했습니다"` (2곳: catch 메시지) | `t("err.loadMaps")` |
| `"맵 생성에 실패했습니다"` | `t("err.createMap")` |
| `"맵 삭제에 실패했습니다"` | `t("err.deleteMap")` |
| `>프로세스맵<` (제목) | `{t("home.title")}` |
| placeholder `새 맵 이름` | `placeholder={t("home.newMapPlaceholder")}` |
| `>생성<` 버튼 | `{t("home.create")}` |
| `아직 맵이 없습니다.` | `{t("home.empty")}` |
| `>삭제<` 버튼 | `{t("home.delete")}` |

- [ ] **Step 2: 타입체크/린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
git add src/app/page.tsx
git commit -m "i18n(home): translate map list screen — 홈 화면 영/한"
```

---

## Task 5: 에디터 + 노드/메뉴/코멘트 번역

**Files:**
- Modify: `src/lib/canvas.ts` (`NODE_TYPE_OPTIONS` label → labelKey)
- Modify: `src/app/maps/[mapId]/page.tsx`
- Modify: `src/components/process-node.tsx`
- Modify: `src/components/comment-section.tsx`

- [ ] **Step 1: canvas NODE_TYPE_OPTIONS를 labelKey로**

`src/lib/canvas.ts` 수정 — `label: string` 필드를 `labelKey: MessageKey`로 교체. import: `import type { MessageKey } from "@/lib/i18n-messages";`

```ts
export const NODE_TYPE_OPTIONS: { value: ProcessNodeType; labelKey: MessageKey }[] = [
  { value: "process", labelKey: "nodeType.process" },
  { value: "decision", labelKey: "nodeType.decision" },
  { value: "start", labelKey: "nodeType.start" },
  { value: "end", labelKey: "nodeType.end" },
];
```

주의: `ProcessNodeType` 정의가 `(typeof NODE_TYPE_OPTIONS)[number]["value"]`에 의존하면 순서를 유지하고, `value` 리터럴은 그대로 둔다. 타입 선언부 `interface`의 `label` 필드도 `labelKey`로 바꾼다(7번째 줄 근처).

- [ ] **Step 2: 에디터 사용처에서 labelKey 번역**

`src/app/maps/[mapId]/page.tsx`의 타입 select(현재 `{option.label}`) → `{t(option.labelKey)}`.

- [ ] **Step 3: 에디터 문자열 교체**

`MapEditor` 함수 상단에 `const { t } = useI18n();` 추가(import 포함). 아래 매핑대로 교체. **주석(코드 설명)은 한국어 유지** — 교체 대상은 렌더/placeholder/title/aria/prompt/confirm/상태 메시지뿐.

| 현재 | 교체 |
|---|---|
| 초기 scope `title: "홈"`(150) | (런타임 표시 전 `mapName`으로 덮어쓰므로 그대로 두되, 표시 라벨 아님 — 변경 불필요) |
| `← 목록`(978) | `← {t("editor.backToList")}` |
| placeholder `노드 검색 — 초성 가능 (Ctrl+K)`(1003) | `placeholder={t("editor.searchPlaceholder")}` |
| `{checkout.checked_out_by}님이 편집 중 — 읽기 전용`(1055) | `{t("editor.editingByOther", { name: checkout.checked_out_by })}` |
| `강제 편집`(1060) | `{t("editor.forceEdit")}` |
| title `이 버전을 편집 중입니다`(1065) | `title={t("editor.editingMineTitle")}` |
| `🔒 편집 중`(1066) | `🔒 {t("editor.editingMine")}` |
| `저장 중…`(1071) | `{t("editor.saving")}` |
| `저장됨 ✓`(1074) | `{t("editor.saved")}` |
| `저장 실패 — 저장 버튼으로 재시도`(1077) | `{t("editor.saveError")}` |
| aria `버전 선택`(1084) | `aria-label={t("editor.versionSelectAria")}` |
| `새 버전`(1093) | `{t("editor.newVersion")}` |
| `이름변경`(1096) | `{t("editor.rename")}` |
| `버전삭제`(1103) | `{t("editor.deleteVersion")}` |
| `비교`(1109) | `{t("editor.compare")}` |
| title `실행취소 (Ctrl+Z)`(1118) | `title={t("editor.undoTitle")}` |
| title `다시실행 (Ctrl+Shift+Z)`(1126) | `title={t("editor.redoTitle")}` |
| `자동 정렬`(1138) | `{t("editor.autoLayout")}` |
| `좌측 맞춤`(1145) | `{t("editor.alignLeft")}` |
| `상단 맞춤`(1152) | `{t("editor.alignTop")}` |
| `가로 등간격`(1159) | `{t("editor.distributeX")}` |
| `세로 등간격`(1166) | `{t("editor.distributeY")}` |
| `+ 노드`(1173) | `{t("editor.addNode")}` |
| `저장`(1183) | `{t("editor.save")}` |
| `노드 편집`(1258) | `{t("editor.nodeEdit")}` |
| `제목`(1259) | `{t("field.title")}` |
| `설명`(1268) | `{t("field.description")}` |
| `타입`(1277) | `{t("field.type")}` |
| `색상`(1292) | `{t("field.color")}` |
| title `기본색`/aria `색상 ${preset \|\| "기본"}`(1297-1298) | `title={preset || t("editor.defaultColor")}` · `aria-label={t("editor.colorAria", { name: preset || t("editor.colorDefaultName") })}` |
| placeholder `#RRGGBB 직접 입력 후 Enter`(1315) | `placeholder={t("editor.hexPlaceholder")}` |
| `BPM 속성`(1330) | `{t("editor.bpmAttrs")}` |
| `담당자`(1332) | `{t("field.assignee")}` |
| `부서`(1341) | `{t("field.department")}` |
| `시스템`(1350) | `{t("field.system")}` |
| `소요시간`(1359) | `{t("field.duration")}` |
| placeholder `예: 2일`(1367) | `placeholder={t("editor.durationPlaceholder")}` |
| `코멘트` summary(1372) + ` (미해결 N)`(1374) | `{t("editor.comments")}` + `{" "}({t("editor.unresolvedCount", { n: selectedComments.filter((c) => !c.resolved).length })})` |
| 힌트 `더블클릭: 하위 …`(1387) | `{t("editor.hintNode")}` |
| `엣지 편집`(1394) | `{t("editor.edgeEdit")}` |
| `라벨 (분기 조건 등)`(1395) | `{t("editor.edgeLabel")}` |
| 힌트 `우클릭: 메뉴 …`(1402) | `{t("editor.hintEdge")}` |

프롬프트/확인/에러(콜백 내부) 교체:
| 현재 | 교체 |
|---|---|
| `window.prompt("새 버전 이름 (현재 버전을 복제합니다)", "To-Be")`(655) | `window.prompt(t("prompt.newVersionName"), "To-Be")` |
| `window.prompt("버전 이름 변경", ...)`(676) | `window.prompt(t("prompt.renameVersion"), ...)` |
| `window.confirm("이 버전을 삭제할까요? 되돌릴 수 없습니다.")`(693) | `window.confirm(t("prompt.deleteVersionConfirm"))` |
| `"새 단계"` 기본 라벨(744) | `t("editor.newStep")` |
| 에러 문자열들(369,420,469,495,521,565,577,590,601,611,642,667,685,703,848) | 각각 `t("err.loadMap")`, `t("err.loadCanvas")`, `t("err.search")`, `t("err.checkout")`, `t("err.forceCheckout")`, `t("err.addComment")`, `t("err.toggleComment")`, `t("err.deleteComment")`, `t("err.save")`(601·611·642 공통), `t("err.createVersion")`, `t("err.renameVersion")`, `t("err.deleteVersion")`, `t("err.exportPng")` |

컨텍스트 메뉴 항목 라벨(`menuItems` useMemo, 873-931):
| 현재 | 교체 |
|---|---|
| `"+ 노드 추가"` | `t("ctx.addNode")` |
| `"자동 정렬"`(877) | `t("ctx.autoLayout")` |
| `"삭제"`(888,922) | `t("ctx.delete")` |
| `"하위 프로세스 열기"`(900) | `t("ctx.openChild")` |
| shortcut `"더블클릭"`(901) | `t("ctx.doubleClick")` |
| `"라벨 편집"`(915) | `t("ctx.editLabel")` |

주의: `menuItems`는 `useMemo`이므로 의존성 배열에 `t`를 추가한다.

- [ ] **Step 4: process-node 번역**

`src/components/process-node.tsx`에 `const { t } = useI18n();` 추가(import 포함):
| 현재 | 교체 |
|---|---|
| aria `미해결 코멘트 ${count}개`(27) | `t("node.unresolvedAria", { n: count })` |
| title `하위 프로세스에 변경 있음`(39) | `t("node.childChangedTitle")` |
| `하위` 뱃지(71) | `{t("node.childBadge")}` |
| title `하위 프로세스`(98) | `title={t("node.openChildTitle")}` |

- [ ] **Step 5: comment-section 번역**

`src/components/comment-section.tsx`에 `const { t } = useI18n();` 추가(import 포함):
| 현재 | 교체 |
|---|---|
| `재열기`/`해결`(60) | `comment.resolved ? t("comment.reopen") : t("comment.resolve")` 형태 유지 |
| `삭제`(67) | `{t("comment.delete")}` |
| `아직 코멘트가 없습니다.`(73) | `{t("comment.empty")}` |
| placeholder `코멘트 작성 — Ctrl+Enter 전송`(78) | `placeholder={t("comment.placeholder")}` |
| `등록`(92) | `{t("comment.submit")}` |

- [ ] **Step 6: 타입체크/린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (canvas labelKey 변경으로 깨지는 사용처가 있으면 모두 `t(option.labelKey)`로 고친다 — `grep -rn "\.label" src/app/maps/\[mapId\]/compare/page.tsx`로 compare가 label을 안 쓰는지 확인.)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/canvas.ts "src/app/maps/[mapId]/page.tsx" src/components/process-node.tsx src/components/comment-section.tsx
git commit -m "i18n(editor): translate editor, node, menu, comments — 에디터 영/한"
```

---

## Task 6: 비교 화면 + diff 라벨 번역

**Files:**
- Modify: `src/lib/diff.ts` (변경 필드 한국어 → 필드 키)
- Modify: `src/app/maps/[mapId]/compare/page.tsx`

- [ ] **Step 1: diff.ts의 변경 필드를 키로**

`src/lib/diff.ts`에서 비교 필드 라벨(30-39행 `제목/설명/타입/색상/담당자/부서/시스템/소요시간`)과 `위치(계층)`(129행)을 **한국어 문자열 대신 필드 키**로 바꾼다. `DiffItem.changedFields: string[]`에 들어가는 값을 아래 `ChangedField` 키로 교체.

```ts
// diff.ts 상단에 추가
export type ChangedField =
  | "title"
  | "description"
  | "type"
  | "color"
  | "assignee"
  | "department"
  | "system"
  | "duration"
  | "location";

// 기존 [{ field/getter, label: "제목" }, ...] 형태를 키 기반으로:
const COMPARED_FIELDS: { key: ChangedField; get: (n: FlatNode) => string }[] = [
  { key: "title", get: (n) => n.title ?? "" },
  { key: "description", get: (n) => n.description ?? "" },
  { key: "type", get: (n) => n.node_type ?? "" },
  { key: "color", get: (n) => n.color ?? "" },
  { key: "assignee", get: (n) => n.assignee ?? "" },
  { key: "department", get: (n) => n.department ?? "" },
  { key: "system", get: (n) => n.system ?? "" },
  { key: "duration", get: (n) => n.duration ?? "" },
];
// 위치(계층) 이동 감지 시 changedFields.push("location")로 추가.
```

주의: 기존 비교 로직(필드 getter)은 유지하되 `label` 누적을 `key` 누적으로만 바꾼다. `changedFields`의 타입을 `ChangedField[]`로 좁힐 수 있으면 좁히고, 어려우면 `string[]` 유지. **diff.ts 내 한국어는 주석만 남고 사용자 노출 문자열은 0이 되어야 한다.** (구현 시 실제 구조에 맞춰 getter 시그니처는 조정.)

- [ ] **Step 2: compare 페이지에서 필드 키 → 번역 + 나머지 문자열**

`src/app/maps/[mapId]/compare/page.tsx`에 `const { t } = useI18n();`(import 포함). 필드 키→메시지 매핑 상수 추가:

```ts
import type { ChangedField } from "@/lib/diff";
import type { MessageKey } from "@/lib/i18n-messages";

const FIELD_MSG: Record<ChangedField, MessageKey> = {
  title: "field.title",
  description: "field.description",
  type: "field.type",
  color: "field.color",
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  location: "field.location",
};
```

`변경: ${changedFields...}` 렌더 → `t("compare.changedFields", { fields: item.changedFields.map((f) => t(FIELD_MSG[f as ChangedField])).join(", ") })`.

나머지 문자열 매핑:
| 현재 | 교체 |
|---|---|
| STATUS 라벨 `추가됨/삭제됨/변경됨`(35-37) | `t("compare.statusAdded")` / `t("compare.statusRemoved")` / `t("compare.statusChanged")` (이 상수가 모듈 스코프면, 컴포넌트 안에서 t로 만들거나 키→t 매핑으로 변경) |
| 범례 `추가/삭제/변경`(41-43,167-173) | `t("compare.legendAdded")` / `t("compare.legendRemoved")` / `t("compare.legendChanged")` |
| aria `비교 버전 선택`(136) | `aria-label={t("compare.selectVersionAria")}` |
| `⚡ 하위 변경 있음`(175) | `⚡ {t("compare.childChanged")}` |
| `두 버전의 내용이 동일합니다.`(184) | `{t("compare.identical")}` |
| 요약 `추가 N · 삭제 N · 변경 N`(193) | `{t("compare.summary", { a: addedCount, r: removedCount, c: changedCount })}` (각 카운트 변수명은 실제 코드에 맞춤) |
| `편집기`(312) | `{t("compare.editorLink")}` |
| `버전 비교`(314) | `{t("compare.title")}` |
| `왼쪽 기준 → 오른쪽 변경`(315) | `{t("compare.subtitle")}` |

주의: 35-43행이 모듈 스코프 상수 객체라면 컴포넌트 내부 `useMemo`/인라인으로 옮겨 `t`를 쓸 수 있게 한다(상수는 t 호출 불가).

- [ ] **Step 3: 빌드 + 타입체크 + 린트**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. compare에 남은 한국어 사용자 문자열 0(`grep -noE '[가-힣]' src/app/maps/\[mapId\]/compare/page.tsx src/lib/diff.ts` → 주석만 남아야 함).

- [ ] **Step 4: 커밋**

```bash
git add src/lib/diff.ts "src/app/maps/[mapId]/compare/page.tsx"
git commit -m "i18n(compare): translate compare screen + diff field labels — 비교 화면 영/한"
```

---

## Task 7: 드릴인 계단식 창 + 확장 애니메이션

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1: entrance 키프레임 추가**

`src/app/globals.css` 맨 아래에 추가. 좌상단 origin에서 확장 + 페이드, reduced-motion 가드.

```css
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
  animation: drill-in-open 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .drill-canvas {
    animation: none;
  }
}
```

- [ ] **Step 2: 정적 카드 스택 → 동적 계단식 프레임 + 애니메이션 래퍼**

`src/app/maps/[mapId]/page.tsx`의 캔버스 컨테이너(현재 `1188-1254`)를 교체. 기존 정적 2겹 카드 블록(`1189-1196`)을 조상 프레임 스택으로, `<ReactFlow>` 래퍼에 `drill-canvas` 클래스 + `key`를 부여한다.

```tsx
{/* 계층 깊이 — 조상 스코프를 우하향 오프셋 프레임으로 계단식 표시 */}
<div className="relative flex-1 overflow-hidden">
  {scopes.slice(0, -1).map((scope, index) => {
    const offset = (index + 1) * 14; // 레벨당 14px 우하향
    return (
      <button
        key={scope.parentId ?? "root"}
        className="pointer-events-auto absolute -z-10 rounded-t border border-zinc-200 bg-zinc-50 px-3 py-1 text-left text-xs text-zinc-500 hover:bg-zinc-100"
        style={{ top: offset - 22, left: offset }}
        onClick={() => handleBreadcrumb(index)}
        title={scope.title}
      >
        {scope.title}
      </button>
    );
  })}
  <div
    key={String(currentParentId)}
    className="drill-canvas h-full rounded border border-zinc-200 bg-white"
  >
    <ReactFlow
      /* 기존 props 그대로 유지 */
    >
      <Background />
      <Controls />
    </ReactFlow>
  </div>
  {menu && (
    <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
  )}
</div>
```

주의:
- 조상 프레임은 제목 탭만 위로 삐져나오게(`top: offset - 22`) 배치해 계단처럼 보이게 한다. 깊이가 깊어지면 더 많은 탭이 좌상단에 쌓인다.
- `key={String(currentParentId)}`로 스코프 변경 시 래퍼가 remount → `drill-canvas` 애니메이션 재생.
- `<ReactFlow>` 안의 모든 기존 props/핸들러(`onNodeDoubleClick` 등)는 변경 없이 유지.
- 래퍼에 `h-full`을 줘 ReactFlow가 높이를 갖도록 한다(부모 `flex-1`).

- [ ] **Step 3: 빌드 + 타입체크 + 린트**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: 수동 확인 메모(원격 검증용 — 빌드만으론 확인 불가)**

빌드 통과를 1차 근거로 보고, 실제 동작은 사용자 수동 확인 항목으로 넘긴다: 노드 더블클릭 시 자식 캔버스가 좌상단에서 확장되며 열리고 조상 제목 탭이 계단식으로 보이는지, 탭 클릭으로 상위 복귀되는지.

- [ ] **Step 5: 커밋**

```bash
git add src/app/globals.css "src/app/maps/[mapId]/page.tsx"
git commit -m "feat(editor): cascading window drill-in with expand animation — 계단식 창 드릴인"
```

---

## Task 8: 단축키 — 박스 선택 · 스페이스 팬 · undo/redo 검증

**Files:**
- Modify: `src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1: ReactFlow에 선택/팬 props 추가**

`<ReactFlow>`에 아래 props를 추가한다(기존 props 유지):

```tsx
selectionOnDrag
panOnDrag={[1]}
panActivationKeyCode="Space"
```

의미:
- `selectionOnDrag` — 좌-드래그로 박스 다중선택(노드 + 그 사이 엣지).
- `panOnDrag={[1]}` — 휠(가운데) 버튼 드래그로만 팬(좌-드래그는 선택에 양보).
- `panActivationKeyCode="Space"` — 스페이스를 누른 채 좌-드래그하면 팬.

(기존 `onSelectionDragStart`/`onSelectionDragStop`이 이미 있어 박스선택 후 벌크 이동/삭제는 히스토리·자동저장과 호환된다.)

- [ ] **Step 2: undo/redo 키 핸들러 검증·보강**

기존 keydown 핸들러(`319-350`)는 유지. redo 경로(`Ctrl+Shift+Z`, `Ctrl+Y`)에 `event.preventDefault()`가 이미 호출되는지 확인(브라우저 기본동작/중복 트리거 차단). 누락 시 추가. 입력 필드 포커스 시 통과 가드도 유지.

- [ ] **Step 3: 빌드 + 타입체크 + 린트**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. (`panOnDrag`는 `number[]`, `panActivationKeyCode`는 `string` — @xyflow/react 12 타입과 일치.)

- [ ] **Step 4: 수동 확인 메모**

사용자 수동 확인: 빈 캔버스 좌-드래그 → 박스 선택(여러 노드/엣지), 스페이스+드래그 → 화면 이동, Ctrl+Z/Ctrl+Shift+Z → undo/redo(브라우저 새로고침/중복 없음).

- [ ] **Step 5: 커밋**

```bash
git add "src/app/maps/[mapId]/page.tsx"
git commit -m "feat(editor): box-select on drag + space-to-pan shortcuts — 드래그 박스선택·스페이스 팬"
```

---

## 최종 검증

- [ ] `npx tsc --noEmit` PASS
- [ ] `npm run lint` PASS
- [ ] `npm run build` PASS
- [ ] 잔여 사용자 노출 한국어 0 확인: `grep -rnoE '[가-힣]' src/app src/components src/lib | grep -v "//\|/\*\|\*"` 결과가 (주석 외) 비어 있는지 점검. 동적 데이터(맵 이름·노드 제목)는 대상 아님.
- [ ] PROGRESS.md 갱신 후 커밋(작업 요약: i18n 인프라+전역 네비바, 계단식 드릴인, 단축키).
- [ ] 사용자 수동 체크리스트 전달:
  1. 더블클릭 → 자식 캔버스 좌상단 확장 + 조상 계단 탭, 탭/브레드크럼 클릭 복귀.
  2. 우상단 토글 → 전 화면 즉시 영/한 전환, 새로고침 후 유지.
  3. 로컬에서 유저칩 "Guest".
  4. 좌-드래그 박스선택, 스페이스+드래그 팬.
  5. Ctrl+Z / Ctrl+Shift+Z undo/redo, 새로고침·중복 없음.

---

## Self-Review 결과 (작성자 점검)

- **스펙 커버리지:** ① 드릴인=Task 7, ② 네비바=Task 3·i18n=Task 1·4·5·6·유저=Task 2, ③ 단축키=Task 8. 스펙 전 항목 매핑 완료.
- **플레이스홀더:** 없음. 모든 교체는 매핑표·코드로 구체화. (string-replacement 태스크는 1419행 전체 재출력 대신 정확한 행 앵커+한↔키 매핑으로 명세 — 엔지니어가 순서 무관하게 적용 가능.)
- **타입 일관성:** `MessageKey`(en 권위)·`ChangedField`(diff)·`CurrentUser`(store)·`labelKey`(canvas) 명칭이 태스크 간 일치. `t(key, vars?)` 시그니처 통일.
- **위험요소:** diff.ts 내부 getter 구조는 실제 코드에 맞춰 조정 필요(Task 6 Step1에 명시). compare의 STATUS/범례 상수가 모듈 스코프면 컴포넌트 내부로 이동(명시). canvas `label`→`labelKey` 변경의 모든 사용처는 Task 5 Step6 grep으로 확인.
