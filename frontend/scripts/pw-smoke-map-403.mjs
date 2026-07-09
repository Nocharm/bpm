// 비공개 맵 접근 게이트 스모크 — /api/maps/:id에 403 목 응답 → 안내 모달(단일 버튼) → 확인 → 홈 복귀.
// 실행: frontend/ 에서 node scripts/pw-smoke-map-403.mjs
// 전제: backend(:8000)+frontend(:3000) 기동. 백엔드 권한 세팅 불필요(라우트 목으로 403 주입).
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en"); // 모달 타이틀 "Private map" 고정용
});
const page = await ctx.newPage();
await page.route(`**/api/maps/${MAP_ID}`, (route) =>
  route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ detail: "forbidden" }) }),
);

await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-id="confirm-dialog"]', { timeout: 15000 });
check("403 → access-denied dialog shown", true);
const title = await page.locator('[data-id="confirm-dialog"] h2').innerText();
check("dialog title is Private map", title === "Private map", `title=${title}`);
check("single button (no cancel)", (await page.locator('[data-id="confirm-dialog-cancel"]').count()) === 0);
await page.click('[data-id="confirm-dialog-confirm"]');
await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
check("confirm returns to home", true);

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `ALL PASS (${results.length})` : `${failed.length} FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
