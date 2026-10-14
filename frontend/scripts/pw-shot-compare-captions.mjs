// 비교 화면 조건 캡션·팔레트 견본 캡처 — 범례 옆 2×2 견본, 변경 노드 시작 캡션 위치(배지 위·위쪽 연결선 회피),
// 캡션 호버 툴팁(이전 → 이후)을 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=13 COMPARE_QUERY="base=73&target=74" node scripts/pw-shot-compare-captions.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "13";
const COMPARE_QUERY = process.env.COMPARE_QUERY ?? "base=73&target=74";
const USER = process.env.USER_ID ?? "admin.sys";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP_ID}/compare?${COMPARE_QUERY}`, { waitUntil: "networkidle", timeout: 120000 });
  const canvas = page.locator(".react-flow").first();
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);

  const legend = page.locator('[data-id="compare-palette"]').locator("xpath=ancestor::div[contains(@class,'react-flow__panel')][1]");
  await legend.screenshot({ path: path.join(SHOT_DIR, "compare-palette-legend.png") });
  console.log("shot legend");

  // 변경 노드 중 시작 조건 캡션이 있는 첫 노드로 확대
  const startCaption = page.locator('.react-flow__node[data-diff-status], .react-flow__node').locator('[data-id="node-condition-start"]').first();
  const capBox = await startCaption.boundingBox();
  await page.mouse.move(capBox.x + capBox.width / 2, capBox.y + 40);
  await page.keyboard.down("Control");
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(80);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);
  await canvas.screenshot({ path: path.join(SHOT_DIR, "compare-captions-zoom.png") });
  console.log("shot zoom");

  const changedCaption = page.locator('[data-id="node-condition-start"][data-diff="true"], [data-id="node-condition-end"][data-diff="true"]').first();
  const target = (await changedCaption.count()) > 0 ? changedCaption : page.locator('[data-id="node-condition-start"]').first();
  await target.hover();
  await page.waitForTimeout(400);
  const tip = page.locator('[data-id="hover-tip"]');
  console.log(`tooltip: ${(await tip.count()) > 0 ? (await tip.innerText()).replace(/\n/g, " | ") : "none"}`);
  await canvas.screenshot({ path: path.join(SHOT_DIR, "compare-captions-tooltip.png") });
  console.log(`condition pills left: ${await page.locator("text=시작 조건").count() + (await page.locator("text=종료 조건").count())}`);
  await ctx.close();
} finally {
  await browser.close();
}
