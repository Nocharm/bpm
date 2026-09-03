// ldap 모드 로그인 스모크 — Task 11 (설계: 2026-08-19-auth-fallback-ldap). 5개 시나리오:
// (1) /login이 ID/PW 폼을 보이고 Keycloak 버튼은 없음 (2) 시드 계정 로그인→홈 진입
// (3) 오답 비밀번호→에러 노출·진입 실패 (4) 딥링크(/maps/1)가 로그인 후 그 경로로 복귀
// (5) 로그아웃→/login 복귀 + 저장 토큰 소거.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-ldap-login.mjs
// 전제: backend를 AUTH_MODE=ldap AUTH_JWT_SECRET=<아무값> BPM_SYSADMINS=admin.sys로 기동(:8000),
//   frontend 기동(:3000). 계정 시드는 이 스크립트가 backend venv를 통해 직접 수행(멱등, 재실행 가능).
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LOGIN_ID = "smoke.ldap";
const PASSWORD = "Smoke!2026Test";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

// 로컬 계정 시드 — 앱 모델(app.passwords.hash_password) 경유. sqlite raw INSERT는 해시 규격이
// 벗어나 검증이 항상 실패하는 함정이 있어 백엔드 코드를 그대로 재사용한다(pw-verify-dashboard.mjs 선례).
execSync(
  `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import Employee, LocalCredential
from app.passwords import hash_password

LOGIN_ID = '${LOGIN_ID}'
PASSWORD = '${PASSWORD}'

async def seed():
    async with SessionLocal() as s:
        employee = await s.get(Employee, LOGIN_ID)
        if employee is None:
            employee = Employee(login_id=LOGIN_ID, source='local')
            s.add(employee)
        employee.name = 'LDAP Smoke'
        employee.active = True
        employee.role = 'user'
        credential = await s.get(LocalCredential, LOGIN_ID)
        if credential is None:
            credential = LocalCredential(
                login_id=LOGIN_ID,
                password_hash=hash_password(PASSWORD),
                is_sysadmin=False,
                created_by='smoke',
            )
            s.add(credential)
        else:
            credential.password_hash = hash_password(PASSWORD)
            credential.is_sysadmin = False
        await s.commit()

asyncio.run(seed())
"`,
  { stdio: "inherit" },
);

// dev.db 오염 방지(docs/lessons/browser-verification.md) — 시드 행을 지운다. 실패 경로(throw)에서도
// 반드시 돌도록 아래 try/finally에서 호출한다.
function teardownSeed() {
  execSync(
    `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import Employee, LocalCredential

LOGIN_ID = '${LOGIN_ID}'

async def teardown():
    async with SessionLocal() as s:
        credential = await s.get(LocalCredential, LOGIN_ID)
        if credential is not None:
            await s.delete(credential)
        employee = await s.get(Employee, LOGIN_ID)
        if employee is not None:
            await s.delete(employee)
        await s.commit()

asyncio.run(teardown())
"`,
    { stdio: "inherit" },
  );
}

let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // 브라우저 로케일에 따라 기본 언어가 한글로 잡힐 수 있어 텍스트 셀렉터("Log out")가 깨진다 — 영어 고정.
  const newEnglishContext = async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.localStorage.setItem("bpm.lang", "en");
    });
    return ctx;
  };

  // (1) 로그인 화면 — ID/PW 폼 노출, Keycloak 버튼 없음
  {
    const ctx = await newEnglishContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    // 모드 조회(getCachedAuthMode)가 끝나기 전엔 AuthLoadingScreen이 잠깐 보인다 — 폼 렌더까지 대기
    await page.locator('[data-id="login-ldap-form"]').waitFor({ timeout: 10000 }).catch(() => {});
    const form = await page.locator('[data-id="login-ldap-form"]').count();
    const keycloakBtn = await page.locator('[data-id="login-keycloak"]').count();
    check("login page shows ID/PW form", form === 1, `form=${form}`);
    check("login page has no Keycloak button", keycloakBtn === 0, `keycloakBtn=${keycloakBtn}`);
    await ctx.close();
  }

  // (2) 시드된 로컬 계정으로 로그인 → 홈 진입
  {
    const ctx = await newEnglishContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-id="login-ldap-id"]').fill(LOGIN_ID);
    await page.locator('[data-id="login-ldap-password"]').fill(PASSWORD);
    await page.locator('[data-id="login-ldap-submit"]').click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 10000 }).catch(() => {});
    const onHome = new URL(page.url()).pathname === "/";
    const token = await page.evaluate(() => window.localStorage.getItem("bpm.ldapToken"));
    check("valid login reaches home", onHome, `url=${page.url()}`);
    check("valid login stores a session token", !!token, `token=${token ? "present" : "absent"}`);
    await ctx.close();
  }

  // (3) 오답 비밀번호 — 에러 노출, 진입 실패
  {
    const ctx = await newEnglishContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-id="login-ldap-id"]').fill(LOGIN_ID);
    await page.locator('[data-id="login-ldap-password"]').fill("wrong-password");
    await page.locator('[data-id="login-ldap-submit"]').click();
    await page.locator('[data-id="login-ldap-error"]').waitFor({ timeout: 10000 }).catch(() => {});
    const errorShown = await page.locator('[data-id="login-ldap-error"]').count();
    const stillOnLogin = new URL(page.url()).pathname === "/login";
    const token = await page.evaluate(() => window.localStorage.getItem("bpm.ldapToken"));
    check("wrong password shows an error", errorShown === 1, `errorShown=${errorShown}`);
    check("wrong password does not enter the app", stillOnLogin && !token, `url=${page.url()} token=${token}`);
    await ctx.close();
  }

  // (4) 딥링크 — 미인증으로 /maps/1 접근 → 로그인 후 그 경로로 복귀
  {
    const ctx = await newEnglishContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/maps/1`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 10000 }).catch(() => {});
    // 로그인 진행 후 page.url()이 바뀌므로, 이 시점 URL을 지금 캡처해 메시지에 쓴다(뒤에서 재조회 금지)
    const urlAfterGoto = page.url();
    const redirectedToLogin = new URL(urlAfterGoto).pathname === "/login";
    await page.locator('[data-id="login-ldap-id"]').fill(LOGIN_ID);
    await page.locator('[data-id="login-ldap-password"]').fill(PASSWORD);
    await page.locator('[data-id="login-ldap-submit"]').click();
    await page.waitForURL((u) => u.pathname === "/maps/1", { timeout: 10000 }).catch(() => {});
    const restoredDeepLink = new URL(page.url()).pathname === "/maps/1";
    check("unauthenticated deep link redirects to /login first", redirectedToLogin, `url after goto=${urlAfterGoto}`);
    check("login restores the original deep link", restoredDeepLink, `url=${page.url()}`);
    await ctx.close();
  }

  // (5) 로그아웃 — /login 복귀 + 저장된 토큰 소거
  {
    const ctx = await newEnglishContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-id="login-ldap-id"]').fill(LOGIN_ID);
    await page.locator('[data-id="login-ldap-password"]').fill(PASSWORD);
    await page.locator('[data-id="login-ldap-submit"]').click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 10000 }).catch(() => {});
    // top-nav 유저 메뉴 — 시드 이름(LDAP Smoke)이 aria-label
    await page.locator('button[aria-label="LDAP Smoke"]').click();
    await page.getByText("Log out", { exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/login", { timeout: 10000 }).catch(() => {});
    const loggedOutToLogin = new URL(page.url()).pathname === "/login";
    const tokenAfterLogout = await page.evaluate(() => window.localStorage.getItem("bpm.ldapToken"));
    check("logout returns to /login", loggedOutToLogin, `url=${page.url()}`);
    check("logout clears the stored token", tokenAfterLogout === null, `token=${tokenAfterLogout}`);
    await ctx.close();
  }
} finally {
  // 성공/실패(throw 포함) 모두 브라우저 종료 + 시드 행 정리 — dev.db에 smoke.ldap 잔류 방지
  if (browser) {
    await browser.close();
  }
  teardownSeed();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
