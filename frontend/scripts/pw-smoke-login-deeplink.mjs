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
