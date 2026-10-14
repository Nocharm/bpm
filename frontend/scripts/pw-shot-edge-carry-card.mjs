// 연결선 전달물 호버 카드 캡처 — 개수 점마다 호버해 "From [노드 이름 필]" 표기를 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 node scripts/pw-shot-edge-carry-card.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const USER = process.env.USER_ID ?? "admin.sys";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator(".react-flow").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const dots = page.locator('[data-id="edge-carry-dot"]');
  const count = await dots.count();
  console.log(`carry dots: ${count}`);
  for (let i = 0; i < count; i += 1) {
    await dots.nth(i).hover();
    const card = page.locator('[data-id="edge-carry-card"]');
    await card.waitFor({ timeout: 5000 });
    console.log(`card ${i}: ${(await card.innerText()).replace(/\n/g, " | ")}`);
    const box = await card.boundingBox();
    const dot = await dots.nth(i).boundingBox();
    const top = Math.min(box.y, dot.y) - 8;
    await page.screenshot({
      path: path.join(SHOT_DIR, `edge-carry-card-${i}.png`),
      clip: { x: box.x - 8, y: top, width: box.width + 16, height: box.y + box.height - top + 8 },
    });
    await page.mouse.move(20, 880);
    await page.waitForTimeout(250);
  }
  await ctx.close();
} finally {
  await browser.close();
}
