// 분기 노드 IO 아일랜드 검증 — 알약 → 호버 확장 → 박스 안 체크(노드 선택으로 버블 안 함) → 알약 하이라이트 → 선택 확장 크기 동일.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 node scripts/pw-shot-decision-island.mjs
// 전제: 대상 맵에 입력·산출물이 있는 분기 노드가 있고, 그 입력 하나가 앞 노드 산출물에 링크돼 있어야 한다(연관 체크 확인용).
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const USER = process.env.USER_ID ?? "admin.sys";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
    window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(["assignee", "params", "input", "output"]));
  }, USER);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle", timeout: 120000 });
  const canvas = page.locator(".react-flow");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const shoot = async (name) => {
    await canvas.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
    console.log(`shot ${name}`);
  };
  const island = page.locator('[data-id="decision-io-island"]').first();
  const parking = { x: 40, y: 860 };

  await shoot("island-1-pill");

  // 앞 노드의 링크된 산출물 체크 → 분기 알약 입력 칸이 하이라이트돼야 한다(연관 항목)
  const linkedRow = page.locator('[data-id^="node-io-linked-output-"]').first();
  const linkedLabel = linkedRow.locator("xpath=ancestor::label[1]");
  await linkedLabel.hover();
  await linkedLabel.locator('input[type="checkbox"]').check();
  await page.mouse.move(parking.x, parking.y);
  // "체크/전체"로 보여야 한다(입력 3개 중 링크 1개 체크 → 1/3) — 팝 도중(150ms)도 확대 캡처
  const decisionNode = page.locator(".react-flow__node").filter({ has: page.locator(".bpm-decision-title-box") }).first();
  const zoomShot = async (name) => {
    const nodeBox = await decisionNode.boundingBox();
    await page.screenshot({
      path: path.join(SHOT_DIR, `${name}.png`),
      clip: { x: nodeBox.x - 40, y: nodeBox.y - 10, width: nodeBox.width + 80, height: nodeBox.height + 60 },
    });
  };
  const popState = await page.evaluate(() => {
    const el = document.querySelector('[data-id="decision-io-chip-input-count"] .bpm-count-pop');
    return el ? `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationPlayState}` : "none";
  });
  console.log(`count pop: ${popState}`);
  await page.waitForTimeout(120);
  await zoomShot("island-2-pop-mid");
  await page.waitForTimeout(500);
  console.log(`input chip after linked check: ${await page.locator('[data-id="decision-io-chip-input-count"]').innerText()}`);
  await shoot("island-2-linked-highlight");

  await island.hover();
  await page.waitForTimeout(150);
  await shoot("island-3-expanding");
  await page.waitForTimeout(450);
  const hoverBox = await island.boundingBox();
  await shoot("island-4-hover-expanded");

  // 박스 안 행 클릭 = 체크만, 노드 선택 안 됨
  const row = island.locator("label").last();
  await row.hover();
  await row.click();
  await page.waitForTimeout(200);
  // 앞 노드 체크(위)는 그 노드를 선택할 수 있다 — 분기 노드가 선택되지 않았는지만 본다
  const decisionSelected = await page
    .locator(".react-flow__node.selected")
    .filter({ has: page.locator(".bpm-decision-title-box") })
    .count();
  console.log(`after row click: decision selected ${decisionSelected}, checked ${await row.locator('input[type="checkbox"]').isChecked()}`);

  await page.mouse.move(parking.x, parking.y);
  await page.waitForTimeout(600);
  console.log(`output chip checked: ${await page.locator('[data-id="decision-io-chip-output"]').getAttribute("data-checked")}`);
  await shoot("island-5-collapsed-checked");
  await zoomShot("island-5-pill-zoom");

  // 워터마크 오버레이가 Playwright 히트 판정을 가로채는 경우가 있어 좌표 클릭으로(실제 이벤트는 노드가 받는다)
  const diamondBox = await decisionNode.boundingBox();
  await page.mouse.click(diamondBox.x + diamondBox.width / 2, diamondBox.y + diamondBox.height / 2);
  await page.mouse.move(parking.x, parking.y);
  await page.waitForTimeout(600);
  const selectedBox = await island.boundingBox();
  console.log(
    `size hover ${hoverBox.width.toFixed(0)}x${hoverBox.height.toFixed(0)} vs selected ${selectedBox.width.toFixed(0)}x${selectedBox.height.toFixed(0)}`,
  );
  await shoot("island-6-selected");
  console.log(`errors: ${JSON.stringify(errors)}`);
  await ctx.close();
} finally {
  await browser.close();
}
