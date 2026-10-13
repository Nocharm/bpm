// 노드 편집 모달 선후행 전환 글라이드 검증 — 오른쪽 독(후행) 클릭 후 카드 높이를 프레임마다 샘플링해
// 직전 높이 → 새 내용 높이로 점진 변화하는지, 창이 끝난 뒤 섹션 접기가 즉시 반영되는지 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 NODE_TITLE="요청 확인" [VERSION_ID=121] node scripts/pw-shot-summary-glide.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const NODE_TITLE = process.env.NODE_TITLE ?? "요청 확인";
const USER = process.env.USER_ID ?? "admin.sys";
// 편집 모드 확인용 Draft 버전 id(비우면 기본 버전 — 게시본이면 읽기 전용 모달)
const VERSION_ID = process.env.VERSION_ID ?? "";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/maps/${MAP_ID}${VERSION_ID ? `?version=${VERSION_ID}` : ""}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator(".react-flow").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);

  const node = page.locator(".react-flow__node").filter({ hasText: NODE_TITLE }).first();
  const box = await node.boundingBox();
  // 제목 더블클릭은 이름 편집이라 우하단 여백을 더블클릭
  await page.mouse.dblclick(box.x + box.width - 8, box.y + box.height - 5);
  const card = page.locator('[data-id="node-summary-card"]');
  await card.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, `summary-glide${VERSION_ID ? "-edit" : ""}-1-before.png`) });

  const next = page.locator('[data-id="summary-dock-next"] button').first();
  if ((await next.count()) === 0) throw new Error("후행 독 카드가 없다 — 다른 NODE_TITLE을 지정");
  // 전환(380ms) 뒤 새 카드의 높이를 rAF마다 기록
  await page.evaluate(() => {
    window.__heights = [];
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector('[data-id="node-summary-card"]');
      if (el) window.__heights.push([Math.round(performance.now() - start), el.offsetHeight, el.className.includes("summary-card-glide")]);
      if (performance.now() - start < 1600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await next.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOT_DIR, `summary-glide${VERSION_ID ? "-edit" : ""}-2-mid.png`) });
  await page.waitForTimeout(1100);
  const heights = await page.evaluate(() => window.__heights);
  const gliding = heights.filter(([, , isGlide]) => isGlide);
  const distinct = [...new Set(gliding.map(([, h]) => h))];
  console.log(`glide frames ${gliding.length}, distinct heights ${distinct.length}: ${distinct.slice(0, 12).join(" → ")}`);
  console.log(`after window: glide class ${heights.at(-1)?.[2]}, height ${heights.at(-1)?.[1]}`);
  await page.screenshot({ path: path.join(SHOT_DIR, `summary-glide${VERSION_ID ? "-edit" : ""}-3-after.png`) });

  // 창이 끝난 뒤 섹션 접기 = 즉시(글라이드 없음)
  const toggle = page.locator('[data-id="summary-toggle-all-sections"]');
  if ((await toggle.count()) > 0) {
    const before = await card.evaluate((el) => el.offsetHeight);
    await toggle.click();
    const right = await card.evaluate((el) => el.offsetHeight);
    console.log(`toggle all sections: ${before} → ${right} (same frame), glide class ${await card.evaluate((el) => el.className.includes("summary-card-glide"))}`);
  }
  console.log(`errors: ${JSON.stringify(errors)}`);
  await ctx.close();
} finally {
  await browser.close();
}
