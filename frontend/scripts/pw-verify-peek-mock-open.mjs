// 재현: 라이브러리 피크 목업 드롭다운 "해당 맵으로 이동" 클릭 시 이탈 확인 게이트(openMapPrompt)가 떠야 한다.
// 버그: 메뉴가 body 포털이라 피크의 바깥클릭(mousedown 캡처) 닫기에 걸려 click 전에 피크가 언마운트.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAP_ID = process.env.MAP_ID ?? "2";
const SHOTS = process.env.SHOTS ?? "/tmp";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });

await page.goto(`http://localhost:3000/maps/${MAP_ID}`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2000);

// Force edit 필요 시(다른 세션이 점유 등) — 없으면 무시
const forceBtn = page.locator("button", { hasText: "Force edit" });
if (await forceBtn.count()) { await forceBtn.first().click(); await page.waitForTimeout(600); }

// 라이브러리 열기 — 인스펙터(빈 선택)의 "라이브러리에서 추가" 버튼
await page.getByRole("button", { name: /라이브러리에서 추가|Add from library/i }).first().click();
await page.waitForSelector('[data-id="process-library-panel"]', { timeout: 10000 });

// 피크가 뜨는 행(이미 링크된 행은 제외) 클릭 — data-map-id 있는 행 중 피크가 열릴 때까지 순회
const rows = page.locator('[data-id="process-library-panel"] [data-map-id]');
const n = await rows.count();
let peeked = false;
for (let i = 0; i < n && !peeked; i += 1) {
  await rows.nth(i).click();
  peeked = await page
    .locator('[data-id="library-peek"]')
    .waitFor({ timeout: 1500 })
    .then(() => true)
    .catch(() => false);
}
if (!peeked) throw new Error("no peek opened from any library row");

// 목업 클릭 → 드롭다운
await page.locator('[data-id="library-peek-node-mock"]').click();
await page.waitForSelector('[data-id="library-peek-mock-menu"]', { timeout: 5000 });
await page.screenshot({ path: `${SHOTS}/peek-mock-menu.png` });

// 드롭다운 "해당 맵으로 이동" 클릭
await page.locator('[data-id="library-peek-mock-open"]').click();
await page.waitForTimeout(800);

const gateVisible = await page.locator('[data-id="confirm-dialog"]').count();
const peekAlive = await page.locator('[data-id="library-peek"]').count();
await page.screenshot({ path: `${SHOTS}/peek-mock-open-result.png` });
console.log(JSON.stringify({ gateVisible, peekAlive, consoleErrors: errors }));
if (gateVisible === 0) {
  console.log("FAIL: open-map gate did not appear");
  process.exit(1);
}
console.log("PASS");
await browser.close();
