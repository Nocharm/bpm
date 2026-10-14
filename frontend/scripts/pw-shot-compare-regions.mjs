// 비교 화면을 구간별로 확대 캡처 — 노드가 많은 맵에서 상태 색·배지·필·무변경 회색을 실제 크기로 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=13 COMPARE_QUERY="base=73&target=74" node scripts/pw-shot-compare-regions.mjs
// REGIONS: 캔버스 안 비율 좌표 x들(쉼표) — 기본 왼쪽·가운데·오른쪽
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "13";
const COMPARE_QUERY = process.env.COMPARE_QUERY ?? "base=73&target=74";
const USER = process.env.USER_ID ?? "admin.sys";
const REGIONS = (process.env.REGIONS ?? "0.2,0.47,0.78").split(",").map(Number);
const ZOOM_STEPS = Number(process.env.ZOOM_STEPS ?? "5");
// 상태 색 구성 a|c(비교 화면 전환 탭과 같은 저장 키) — 비우면 저장값/기본(c)
const PALETTE = process.env.PALETTE ?? "";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const [index, rx] of REGIONS.entries()) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([user, palette]) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", "ko");
      if (palette) window.localStorage.setItem("bpm.compare.diffPalette", palette);
    }, [USER, PALETTE]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/maps/${MAP_ID}/compare?${COMPARE_QUERY}`, { waitUntil: "networkidle", timeout: 120000 });
    const canvas = page.locator(".react-flow").first();
    await canvas.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const box = await canvas.boundingBox();
    // 노드 띠는 세로 가운데 근처 — 그 점을 중심으로 Control+휠 확대
    await page.mouse.move(box.x + box.width * rx, box.y + box.height * 0.48);
    await page.keyboard.down("Control");
    for (let i = 0; i < ZOOM_STEPS; i += 1) {
      await page.mouse.wheel(0, Number(process.env.WHEEL ?? "-200"));
      await page.waitForTimeout(80);
    }
    await page.keyboard.up("Control");
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await page.waitForTimeout(500);
    await canvas.screenshot({ path: path.join(SHOT_DIR, `compare-region${PALETTE ? `-${PALETTE}` : ""}-${index + 1}.png`) });
    console.log(`shot region ${index + 1}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
