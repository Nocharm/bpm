// 비교 화면 분기 노드 캡처 — diff 필·조건 캡션·입출력 요약이 겹치지 않는지 확인용(노드 주변 확대).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 COMPARE_QUERY="base=120&target=121" node scripts/pw-shot-compare-decision.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const COMPARE_QUERY = process.env.COMPARE_QUERY ?? "base=120&target=121";
const USER = process.env.USER_ID ?? "admin.sys";
const TAG = process.env.TAG ?? "";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP_ID}/compare?${COMPARE_QUERY}`, { waitUntil: "networkidle", timeout: 120000 });
  const canvas = page.locator(".react-flow").first();
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await canvas.screenshot({ path: path.join(SHOT_DIR, `compare-decision${TAG}-full.png`) });
  const decision = page.locator(".react-flow__node").filter({ has: page.locator(".bpm-decision-title-box") }).first();
  const box = await decision.boundingBox();
  await page.screenshot({
    path: path.join(SHOT_DIR, `compare-decision${TAG}-zoom.png`),
    clip: { x: box.x - 140, y: box.y - 60, width: box.width + 280, height: box.height + 200 },
  });
  console.log(`decision text: ${(await decision.innerText()).replace(/\n/g, " | ")}`);
  await ctx.close();
} finally {
  await browser.close();
}
