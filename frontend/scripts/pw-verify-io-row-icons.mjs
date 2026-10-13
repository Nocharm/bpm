// 노드 IO 행 오른쪽 아이콘(링크·양식) 세로 정렬 검증 — 아이콘 중심이 행 첫 줄(글자 줄 16px) 중심과 1px 이내인지 잰다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 node scripts/pw-verify-io-row-icons.mjs
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
    window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(["assignee", "params", "input", "output"]));
  }, USER);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator(".react-flow").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  // 줌과 무관하게 레이아웃 좌표 비율로 비교 — 행 첫 줄 중심(행 상단 패딩 + 8px) 대 아이콘 svg 중심
  const offsets = await page.evaluate(() =>
    [...document.querySelectorAll('[data-id^="node-io-linked-"]')].map((badge) => {
      const row = badge.closest("label");
      const text = row?.querySelector(".line-clamp-2");
      const svg = badge.querySelector("svg");
      if (!row || !text || !svg) return null;
      const scale = row.getBoundingClientRect().height / row.offsetHeight;
      const textTop = text.getBoundingClientRect().top;
      const firstLineCenter = textTop + (8 * scale);
      const svgRect = svg.getBoundingClientRect();
      return Number(((svgRect.top + svgRect.height / 2 - firstLineCenter) / scale).toFixed(2));
    }),
  );
  console.log(`link icon center - first line center (px): ${JSON.stringify(offsets)}`);
  const first = page.locator('[data-id^="node-io-linked-"]').first();
  const rowBox = await first.locator("xpath=ancestor::label[1]").boundingBox();
  await page.screenshot({
    path: path.join(SHOT_DIR, "io-row-icon-align.png"),
    clip: { x: rowBox.x - 12, y: rowBox.y - 8, width: rowBox.width + 24, height: rowBox.height + 16 },
  });
  await ctx.close();
} finally {
  await browser.close();
}
