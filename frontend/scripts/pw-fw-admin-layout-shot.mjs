// Categories & import 레이아웃 캡처 3장 — 첫 진입(전부 접힘) / 캠페인 섹션 열고 피커 드롭다운 펼침 / 인터뷰 임포트 섹션 열림.
// 섹션 접힘·전폭 규칙과 피커 드롭다운(포털)이 섹션 밖으로 잘 내려오는지 눈으로 확인하는 용도.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-fw-admin-layout-shot.mjs
// 전제: backend + frontend 기동(가짜 AI 불필요).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => {
  window.localStorage.setItem("bpm.devUser", user);
  window.localStorage.setItem("bpm.lang", "en");
  // 펼침 취향은 localStorage에 남는다 — 첫 진입 상태를 보려고 비운다
  ["consult", "sessions", "import"].forEach((id) => window.localStorage.removeItem(`bpm.adminSection.${id}`));
}, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="admin-section-import"]').waitFor();
await page.locator('[data-id="framework-admin-tree"] li').first().waitFor({ timeout: 15000 });
await page.screenshot({ path: "../docs/qa/screens/framework-admin-rest.png" });
console.log("PASS rest (all collapsed)");

await page.locator('[data-id="admin-section-toggle-consult"]').click();
await page.locator('[data-id="fw-consult-picker-search"]').click();
await page.locator('[data-id="fw-consult-picker-panel"] li').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-entry.png" });
console.log("PASS consult open + picker dropdown");
await page.keyboard.press("Escape");
const panelGone = (await page.locator('[data-id="fw-consult-picker-panel"]').count()) === 0;
console.log(`${panelGone ? "PASS" : "FAIL"} Escape closes the dropdown`);

// 검색으로 L5 하나를 골라 드롭다운이 닫힌 뒤의 섹션 모습(요약 카드에 선택)을 찍는다
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const all = await (await fetch(`${BACKEND}/api/categories/all`, { headers: { "X-Dev-User": ADMIN } })).json();
const l5 = all.find((c) => c.level === 5);
if (l5) {
  await page.locator('[data-id="fw-consult-picker-search"]').fill(l5.name);
  await page.locator(`[data-id="fw-consult-picker-result-${l5.id}"]`).click();
  await page.locator('[data-id="fw-consult-pick-name"]', { hasText: l5.name }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "../docs/qa/screens/framework-admin-consult-open.png" });
  console.log("PASS consult open with an L5 picked (dropdown closed)");
}

await page.locator('[data-id="admin-section-toggle-import"]').click();
await page.locator('[data-id="interview-import-pick"]').waitFor();
await page.waitForTimeout(400);
await page.locator('[data-id="admin-section-import"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: "../docs/qa/screens/framework-admin-import-open.png" });
console.log("PASS import open (full width)");
await browser.close();
process.exit(panelGone ? 0 : 1);
