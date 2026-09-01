// 인터뷰 임포트 0.4 결과 스크린샷 — L5 연계 캔버스(L6 흐름)와 L6 맵(분기·루프).
// 실행: FE_PORT=3010 CANVAS_MAP=17 L6_MAP=13 node scripts/pw-shot-interview-v04.mjs
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOT_DIR ?? "/tmp/interview-v04-shots";
const PORT = process.env.FE_PORT ?? "3000";
const CANVAS_MAP = process.env.CANVAS_MAP ?? "17";
const L6_MAP = process.env.L6_MAP ?? "13";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
};

const openMap = async (mapId) => {
  await page.goto(`http://localhost:${PORT}/maps/${mapId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500); // 레이아웃·엣지 라벨 안정화
};

await openMap(CANVAS_MAP);
console.log("linkage nodes:", await page.locator(".react-flow__node").count());
console.log("linkage edges:", await page.locator(".react-flow__edge").count());
await shot("01-linkage-canvas");

await openMap(L6_MAP);
console.log("l6 nodes:", await page.locator(".react-flow__node").count());
console.log("l6 edges:", await page.locator(".react-flow__edge").count());
await shot("02-l6-branch-loop");

// 라벨이 읽히도록 확대 — fitView 배율은 노드가 많으면 50%대까지 내려간다
const zoomIn = page.locator('.react-flow__controls button, button[aria-label*="확대"], button[title*="Zoom in"]').last();
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press("Control+Equal").catch(() => {});
  await zoomIn.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
await shot("03-l6-branch-loop-zoom");

console.log("console errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
