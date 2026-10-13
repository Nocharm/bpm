// 조건 캡션(노드 위=시작·아래=종료)·분기 노드 IO 요약 칩·연결선 전달물 개수 점을 캡처 — 노드 조건·IO 가시성 라운드 검증용.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 L5_MAP_ID=41 COMPARE_QUERY="base=120&target=121" node scripts/pw-shot-condition-captions.mjs
// L5_MAP_ID는 새벽 하늘(L5 연계 캔버스) 위 캡션 가독성 확인용 — 비우면 건너뛴다.
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const L5_MAP_ID = process.env.L5_MAP_ID ?? "";
// 비교 화면 쿼리(예: base=120&target=121) — 비우면 건너뛴다
const COMPARE_QUERY = process.env.COMPARE_QUERY ?? "";
const USER = process.env.USER_ID ?? "admin.sys";
const FIELDS = ["assignee", "params", "conditions", "input", "output"];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];

async function openMap(mapId) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([user, fields]) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
    window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(fields));
  }, [USER, FIELDS]);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/maps/${mapId}`, { waitUntil: "networkidle", timeout: 120000 });
  const canvas = page.locator(".react-flow");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  return { ctx, page, canvas };
}

async function shoot(canvas, name) {
  await canvas.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  console.log(`shot ${name}`);
}

try {
  {
    const { ctx, page, canvas } = await openMap(MAP_ID);
    await shoot(canvas, "condition-captions-rest");
    await page.locator('[data-id="decision-io-chip"]').first().hover();
    await page.waitForTimeout(300);
    await shoot(canvas, "condition-captions-chip-hover");
    const dots = page.locator('[data-id="edge-carry-dot"]');
    console.log(`carry dots: ${await dots.count()}`);
    if ((await dots.count()) > 0) {
      await dots.last().hover();
      await page.waitForTimeout(300);
      await shoot(canvas, "condition-captions-carry-hover");
    }
    await ctx.close();
  }
  {
    const { ctx, page, canvas } = await openMap(MAP_ID);
    const decision = page.locator(".react-flow__node").filter({ has: page.locator(".bpm-decision-title-box") }).first();
    await decision.click({ position: { x: 58, y: 48 } });
    await page.waitForTimeout(400);
    await shoot(canvas, "condition-captions-decision-selected");
    await ctx.close();
  }
  {
    // 줌 0.5 미만이면 전달물 점이 사라져야 한다(흐름 펄스와 같은 기준) — 에디터 줌은 Control+휠
    const { ctx, page, canvas } = await openMap(MAP_ID);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 300);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    const zoom = await page.evaluate(() => {
      const viewport = document.querySelector(".react-flow__viewport");
      return viewport ? new DOMMatrix(getComputedStyle(viewport).transform).a : null;
    });
    console.log(`zoomed out to ${zoom?.toFixed(2)}, carry dots: ${await page.locator('[data-id="edge-carry-dot"]').count()}`);
    await ctx.close();
  }
  if (COMPARE_QUERY !== "") {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((user) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", "ko");
    }, USER);
    const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/maps/${MAP_ID}/compare?${COMPARE_QUERY}`, { waitUntil: "networkidle", timeout: 120000 });
    const canvas = page.locator(".react-flow").first();
    await canvas.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    console.log(
      `compare captions: ${await page.locator('[data-id^="node-condition-"]').count()}, carry dots: ${await page.locator('[data-id="edge-carry-dot"]').count()}`,
    );
    await shoot(canvas, "condition-captions-compare");
    await ctx.close();
  }
  if (L5_MAP_ID !== "") {
    const { ctx, page } = await openMap(L5_MAP_ID);
    console.log(`L5 captions: ${await page.locator('[data-id^="node-condition-"]').count()}`);
    await page.locator(".react-flow").screenshot({ path: path.join(SHOT_DIR, "condition-captions-l5.png") });
    console.log("shot condition-captions-l5");
    await ctx.close();
  }
  console.log(`errors: ${JSON.stringify(errors)}`);
} finally {
  await browser.close();
}
