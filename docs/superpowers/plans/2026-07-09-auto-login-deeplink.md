# Auto Login + Deep-link Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 딥링크(`/maps/12`) 직접 진입 시 Keycloak SSO 세션이 있으면 버튼 클릭 없이 자동 로그인 후 원래 페이지로 복귀, 세션 없으면 현행 로그인 카드 유지.

**Architecture:** sessionStorage 기반 `returnTo`(딥링크 보존) + `autoLoginSkip`(자동 시도 억제) 플래그를 신규 lib(`auth-return.ts`)로 두고, `/login` mount 시 `prompt=none`으로 silent signinRedirect를 1회 시도한다. 실패(`error=login_required`)는 AuthGate가 "세션 없음" 신호로 해석해 로그인 카드로 보낸다. 스펙: `docs/superpowers/specs/2026-07-09-auto-login-deeplink-design.md`.

**Tech Stack:** Next.js(App Router) + react-oidc-context 3.3 + oidc-client-ts 3.5, vitest(node 환경 — DOM 없음, sessionStorage는 스텁), Playwright(playwright-core + 시스템 Chrome) 스모크.

## Global Constraints

- 줄바꿈 LF 고정. UI 문자열 영어(신규 문자열 없음 — `auth.signingIn` 재사용).
- `crypto.randomUUID`/`crypto.subtle` 금지(평문 HTTP). PKCE 비활성 유지(`disablePKCE: true`).
- vitest는 **node 환경**(`frontend/vitest.config.ts`) — 테스트에서 `window`/`sessionStorage`는 `vi.stubGlobal`로 스텁.
- React Compiler lint: `useCallback`/`useMemo` deps 불일치 금지 — 트리비얼 핸들러는 plain function 유지.
- raw hex 금지 — 기존 토큰 클래스만 사용(이번 작업은 스타일 변경 없음).
- 커밋마다 `PROGRESS.md`를 같은 커밋에 갱신(`rules/common/git.md`).
- 검증 명령(frontend/에서): `npm test`, `npm run lint`, `npm run build`.

---

### Task 1: returnTo·autoLoginSkip 헬퍼 (`auth-return.ts`) — TDD

**Files:**
- Create: `frontend/src/lib/auth-return.ts`
- Test: `frontend/src/lib/auth-return.test.ts`

**Interfaces:**
- Consumes: 없음 (신규 leaf 모듈, `window.sessionStorage`만 사용)
- Produces (Task 2가 사용):
  - `isSafeReturnPath(path: string): boolean`
  - `saveReturnTo(path: string): void` / `peekReturnTo(): string | null` / `consumeReturnTo(): string | null`
  - `setAutoLoginSkip(): void` / `clearAutoLoginSkip(): void` / `hasAutoLoginSkip(): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/src/lib/auth-return.test.ts`:

```ts
// auth-return 단위 테스트 — vitest node 환경이라 window/sessionStorage를 스텁한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAutoLoginSkip,
  consumeReturnTo,
  hasAutoLoginSkip,
  isSafeReturnPath,
  peekReturnTo,
  saveReturnTo,
  setAutoLoginSkip,
} from "@/lib/auth-return";

function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = makeFakeStorage();
  vi.stubGlobal("window", { sessionStorage: storage });
});

describe("isSafeReturnPath", () => {
  it("허용: 내부 경로(쿼리 포함)", () => {
    expect(isSafeReturnPath("/maps/12")).toBe(true);
    expect(isSafeReturnPath("/maps/12?v=3")).toBe(true);
  });
  it("거부: 외부/프로토콜/로그인/루트", () => {
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("/login")).toBe(false);
    expect(isSafeReturnPath("/login?next=1")).toBe(false);
    expect(isSafeReturnPath("/")).toBe(false);
  });
});

describe("returnTo save/peek/consume", () => {
  it("save 후 consume은 값을 돌려주고 제거한다", () => {
    saveReturnTo("/maps/12?v=3");
    expect(peekReturnTo()).toBe("/maps/12?v=3"); // peek은 제거하지 않음
    expect(consumeReturnTo()).toBe("/maps/12?v=3");
    expect(consumeReturnTo()).toBeNull();
  });
  it("unsafe 경로는 저장하지 않는다", () => {
    saveReturnTo("//evil.com");
    expect(consumeReturnTo()).toBeNull();
  });
  it("저장소가 오염돼도 consume은 unsafe 값을 돌려주지 않는다", () => {
    storage.setItem("bpm.returnTo", "https://evil.com");
    expect(consumeReturnTo()).toBeNull();
    expect(storage.getItem("bpm.returnTo")).toBeNull(); // 오염 값도 제거
  });
});

describe("autoLoginSkip flag", () => {
  it("set/has/clear 라운드트립", () => {
    expect(hasAutoLoginSkip()).toBe(false);
    setAutoLoginSkip();
    expect(hasAutoLoginSkip()).toBe(true);
    clearAutoLoginSkip();
    expect(hasAutoLoginSkip()).toBe(false);
  });
});

describe("window 없음(SSR)·storage 접근 불가", () => {
  it("window가 없으면 조용히 no-op", () => {
    vi.stubGlobal("window", undefined);
    expect(() => saveReturnTo("/maps/1")).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
    expect(hasAutoLoginSkip()).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/auth-return.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth-return'`

- [ ] **Step 3: 최소 구현**

`frontend/src/lib/auth-return.ts`:

```ts
// 로그인 리다이렉트 보조 — 딥링크 복원(returnTo) + 자동 silent 로그인 억제 플래그. sessionStorage(탭 단위).
const RETURN_TO_KEY = "bpm.returnTo";
const AUTO_LOGIN_SKIP_KEY = "bpm.autoLoginSkip";

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null; // 프라이버시 모드 등 접근 불가 — 딥링크 복원 없이 기존 흐름으로
  }
}

// open redirect 방지 — 내부 경로만("/" 시작, "//"·"/login"·루트 제외)
export function isSafeReturnPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && path !== "/" && !path.startsWith("/login");
}

export function saveReturnTo(path: string): void {
  if (!isSafeReturnPath(path)) {
    return;
  }
  getStorage()?.setItem(RETURN_TO_KEY, path);
}

export function peekReturnTo(): string | null {
  const value = getStorage()?.getItem(RETURN_TO_KEY) ?? null;
  return value !== null && isSafeReturnPath(value) ? value : null;
}

export function consumeReturnTo(): string | null {
  const value = peekReturnTo();
  getStorage()?.removeItem(RETURN_TO_KEY);
  return value;
}

export function setAutoLoginSkip(): void {
  getStorage()?.setItem(AUTO_LOGIN_SKIP_KEY, "1");
}

export function clearAutoLoginSkip(): void {
  getStorage()?.removeItem(AUTO_LOGIN_SKIP_KEY);
}

export function hasAutoLoginSkip(): boolean {
  return getStorage()?.getItem(AUTO_LOGIN_SKIP_KEY) === "1";
}
```

- [ ] **Step 4: 통과 확인 + 전체 테스트·린트**

Run: `cd frontend && npm test && npm run lint`
Expected: 신규 포함 전체 PASS, lint 0 error

- [ ] **Step 5: 커밋 (PROGRESS.md 갱신 포함)**

```bash
git add frontend/src/lib/auth-return.ts frontend/src/lib/auth-return.test.ts PROGRESS.md
git commit -m "feat(auth): returnTo + auto-login skip helpers — 딥링크 복원·자동로그인 억제 헬퍼"
```

---

### Task 2: silent 로그인 배선 — keycloak-login·login 페이지·AuthGate/DevGate·로그아웃

**Files:**
- Modify: `frontend/src/lib/keycloak-login.ts` (signinRedirect에 prompt=none 옵션)
- Modify: `frontend/src/app/login/page.tsx` (mount 자동 시도 + dev 픽 후 returnTo 복원)
- Modify: `frontend/src/components/providers.tsx` (returnTo 저장/복원, login_required 처리)
- Modify: `frontend/src/components/top-nav.tsx:68-83` (`onLogout`에 skip 플래그)

**Interfaces:**
- Consumes: Task 1의 `auth-return.ts` 전체 export, 기존 `signinRedirectFromLogin`
- Produces: `signinRedirectFromLogin(options?: { promptNone?: boolean }): Promise<void>` (시그니처 확장 — 기존 무인자 호출 하위호환)

**플래그 수명(설계 확정):** 자동 시도 **직전** `setAutoLoginSkip()`(실패 복귀 시 루프 차단) → 로그인 성공 시 AuthGate가 `clearAutoLoginSkip()` → 버튼 수동 클릭 시 `clearAutoLoginSkip()` → 로그아웃 시 `setAutoLoginSkip()`.

- [ ] **Step 1: `keycloak-login.ts` — promptNone 옵션**

```ts
// /login은 AuthProvider 안에서 렌더되지만, 빌드 단순화를 위해 UserManager를 직접 구성해 signinRedirect를 호출한다.
import { UserManager } from "oidc-client-ts";

export async function signinRedirectFromLogin(options?: { promptNone?: boolean }): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    // PKCE는 crypto.subtle을 요구 → 평문 HTTP(insecure context)에선 불가. 사내망 HTTP 접속 위해 비활성.
    // 콜백(providers.tsx buildOidcConfig)도 동일하게 맞춰야 토큰 교환이 깨지지 않음.
    disablePKCE: true,
  });
  // prompt=none: SSO 세션 있으면 폼 없이 즉시 복귀, 없으면 error=login_required로 복귀(AuthGate가 처리)
  await mgr.signinRedirect(options?.promptNone ? { prompt: "none" } : undefined);
}
```

- [ ] **Step 2: `login/page.tsx` — mount 자동 시도 + dev 픽 복원**

import 추가/변경 (기존 `useState`에 `useEffect` 추가):

```ts
import { useEffect, useState } from "react";

import { clearAutoLoginSkip, consumeReturnTo, hasAutoLoginSkip, setAutoLoginSkip } from "@/lib/auth-return";
```

`LoginPage` 컴포넌트 본문에 effect 추가(기존 `const [picking, ...]` 아래):

```tsx
// 자동 silent 로그인 — SSO 세션 있으면 버튼 없이 즉시 복귀. 시도 "직전"에 skip 플래그를 세워
// 실패(login_required) 복귀 시 재시도 루프를 차단한다(성공 시 AuthGate가 해제).
useEffect(() => {
  if (!AUTH_ENABLED || hasAutoLoginSkip()) {
    return;
  }
  setAutoLoginSkip();
  void (async () => {
    try {
      const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
      await signinRedirectFromLogin({ promptNone: true });
    } catch (e) {
      // Keycloak 미응답 등 — 카드에 머물러 수동 버튼으로 폴백
      console.error("silent login attempt failed", e);
    }
  })();
}, []);
```

`onKeycloak` 수정 — 수동 클릭은 플래그 해제 후 일반 리다이렉트:

```ts
const onKeycloak = async () => {
  clearAutoLoginSkip();
  const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
  await signinRedirectFromLogin();
};
```

`onPickDev` 수정 — dev 로그인 후 딥링크 복원:

```ts
const onPickDev = (loginId: string) => {
  storeDevUser(loginId);
  setDevUser(loginId);
  setPicking(false);
  router.replace(consumeReturnTo() ?? "/");
};
```

- [ ] **Step 3: `providers.tsx` — returnTo 저장/복원 + login_required 처리**

import 추가:

```ts
import { clearAutoLoginSkip, consumeReturnTo, peekReturnTo, saveReturnTo, setAutoLoginSkip } from "@/lib/auth-return";
```

모듈 레벨(예: `buildOidcConfig` 아래)에 타입 가드 추가:

```ts
// prompt=none 실패(SSO 세션 없음) 신호 — 에러 화면이 아니라 "로그인 카드로" 신호로 해석
function isLoginRequiredError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("error" in err)) {
    return false;
  }
  const code = (err as { error?: unknown }).error;
  return code === "login_required" || code === "interaction_required";
}
```

`AuthGate` — 기존 redirect effect를 수정하고 effect 2개 추가:

```tsx
useEffect(() => {
  if (!auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error) {
    if (pathname !== "/login") {
      saveReturnTo(pathname + window.location.search); // 딥링크 보존 — 로그인 후 복귀
      router.replace("/login");
    }
  }
}, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, pathname, router]);

// prompt=none 복귀(error=login_required): 자동 재시도 억제 후 로그인 카드로
useEffect(() => {
  if (auth.error && isLoginRequiredError(auth.error) && pathname !== "/login") {
    setAutoLoginSkip();
    router.replace("/login");
  }
}, [auth.error, pathname, router]);

// 로그인 성공: skip 플래그 해제 + 저장된 딥링크 복원
useEffect(() => {
  if (auth.isAuthenticated) {
    clearAutoLoginSkip();
    const returnTo = consumeReturnTo();
    if (returnTo && returnTo !== pathname) {
      router.replace(returnTo);
    }
  }
}, [auth.isAuthenticated, pathname, router]);
```

`AuthGate` 렌더 분기 수정 (login_required는 에러 화면 제외 + returnTo 복원 중 홈 플래시 방지):

```tsx
if (pathname === "/login") {
  return <>{children}</>;
}
if (auth.error && !isLoginRequiredError(auth.error)) {
  return <div className="p-8 text-caption text-error">{t("auth.error", { msg: auth.error.message })}</div>;
}
if (auth.isLoading || !auth.isAuthenticated) {
  return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
}
const pendingReturn = peekReturnTo();
if (pendingReturn && pendingReturn !== pathname) {
  // returnTo로 replace되기 전 홈(콜백 착지점 "/")이 잠깐 렌더되는 플래시 방지
  return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
}
return <>{children}</>;
```

`DevGate` — 기존 effect의 `/login` replace 직전에 저장 한 줄 추가:

```tsx
useEffect(() => {
  if (stored) {
    void publishMe();
  } else {
    setCurrentUser(null);
    if (pathname !== "/login") {
      saveReturnTo(pathname + window.location.search); // 딥링크 보존 — dev 로그인 후 복귀
      router.replace("/login");
    }
  }
}, [stored, pathname, router]);
```

- [ ] **Step 4: `top-nav.tsx` — 로그아웃 시 자동 재로그인 억제**

import 추가: `import { setAutoLoginSkip } from "@/lib/auth-return";`

`onLogout` 첫 줄에 추가:

```ts
const onLogout = async () => {
  // 로그아웃은 removeUser()만 하고 Keycloak SSO 세션은 살아있음 — /login 자동 재로그인 차단
  setAutoLoginSkip();
  if (AUTH_ENABLED) {
    ...기존 코드 그대로...
```

- [ ] **Step 5: 테스트·린트·빌드**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: 전체 PASS, lint 0, build 성공 (React Compiler 메모이제이션 에러 없음)

- [ ] **Step 6: 커밋 (PROGRESS.md 갱신 포함)**

```bash
git add frontend/src/lib/keycloak-login.ts frontend/src/app/login/page.tsx frontend/src/components/providers.tsx frontend/src/components/top-nav.tsx PROGRESS.md
git commit -m "feat(auth): silent SSO login + deep-link restore — 자동 로그인·딥링크 복귀 배선"
```

---

### Task 3: Playwright 스모크(dev 모드 딥링크 복원) + 브라우저 실검증

**Files:**
- Create: `frontend/scripts/pw-smoke-login-deeplink.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 2까지의 동작(DevGate returnTo 저장 → dev 로그인 → 복원). Keycloak prompt=none 경로는 로컬 검증 불가(스펙 §검증 — 서버 배포 후 3케이스).
- Produces: 없음 (검증 산출물)

**전제:** backend(:8000, sqlite dev.db) + frontend(:3000) 네이티브 기동. 좀비 next dev 주의(`docs/lessons/browser-verification.md`) — 실행 전 3000 포트 점유 확인. 시드 맵 id는 `MAP_ID` env로 조정(기본 2 — 데모 시드 subprocess 맵).

- [ ] **Step 1: 스모크 스크립트 작성**

`frontend/scripts/pw-smoke-login-deeplink.mjs`:

```js
// 로그인 딥링크 복원 스모크(dev 모드) — 미로그인 딥링크 → /login → dev 로그인 → 원래 맵 복귀 + unsafe returnTo 거부.
// 실행: frontend/ 에서 node scripts/pw-smoke-login-deeplink.mjs
// 전제: backend(:8000)+frontend(:3000) 기동, dev.db 시드(맵 MAP_ID 존재). playwright-core+시스템 Chrome.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = process.env.MAP_ID ?? "2";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

// ① 미로그인 딥링크 → /login 리다이렉트 → dev 로그인 → 원래 맵 복귀
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/login", { timeout: 15000 });
  check("deeplink redirects to /login", true);
  await page.click('[data-id="login-dev"]');
  await page.waitForSelector('[data-id="dev-login-modal"]');
  await page.click('[data-id="dev-user-row"]'); // 첫 유저(admin.kim)
  await page.waitForURL(`**/maps/${MAP_ID}`, { timeout: 15000 });
  check("returnTo restores deep link after dev login", true);
  const returnToLeft = await page.evaluate(() => window.sessionStorage.getItem("bpm.returnTo"));
  check("returnTo consumed after restore", returnToLeft === null, `left=${returnToLeft}`);
  await ctx.close();
}

// ② unsafe returnTo는 무시하고 홈으로
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.sessionStorage.setItem("bpm.returnTo", "//evil.com"));
  await page.click('[data-id="login-dev"]');
  await page.waitForSelector('[data-id="dev-login-modal"]');
  await page.click('[data-id="dev-user-row"]');
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  check("unsafe returnTo ignored, lands on home", true);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `ALL PASS (${results.length})` : `${failed.length} FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 2: 서버 기동 후 스모크 실행**

```bash
# backend/ 에서
.venv/bin/uvicorn app.main:app --port 8000   # 백그라운드
# frontend/ 에서
npm run dev                                   # 백그라운드, :3000 확인
node scripts/pw-smoke-login-deeplink.mjs
```

Expected: `ALL PASS (4)` — ①리다이렉트 ②복원 ③consume ④unsafe 거부

- [ ] **Step 3: 커밋 (PROGRESS.md 갱신 포함)**

```bash
git add frontend/scripts/pw-smoke-login-deeplink.mjs PROGRESS.md
git commit -m "test(auth): deep-link restore smoke (dev mode) — 딥링크 복원 스모크"
```

---

## 서버 배포 후 실검증 (구현 밖 — 스펙 §검증 재게)

Keycloak prompt=none 경로는 로컬에 Keycloak이 없어 서버(:3333)에서 확인:

1. SSO 세션 있는 브라우저에서 `http://<서버>:3333/maps/12` 직접 진입 → 로그인 카드 잠깐 표시 후 **버튼 없이** `/maps/12` 복귀.
2. 세션 없는(시크릿) 브라우저 → 로그인 카드 표시·자동 리다이렉트 루프 없음 → 버튼 로그인 → `/maps/12` 복귀.
3. 로그아웃 직후 → 자동 재로그인 없이 로그인 카드 유지, 버튼 클릭 시 정상 로그인.
