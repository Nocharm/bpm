// 조건 캡션(노드 위=시작·아래=종료)과 분기 노드 IO 요약 칩(호버 카드·선택 박스)을 캡처 — 노드 조건·IO 가시성 라운드 검증용.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 node scripts/pw-shot-condition-captions.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const USER = process.env.USER_ID ?? "admin.sys";
const FIELDS = ["assignee", "params", "conditions", "input", "output"];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([user, fields]) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
    window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(fields));
  }, [USER, FIELDS]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle", timeout: 120000 });
  const canvas = page.locator(".react-flow");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await canvas.screenshot({ path: path.join(SHOT_DIR, "condition-captions-rest.png") });

  const chip = page.locator('[data-id="decision-io-chip"]').first();
  await chip.hover();
  await page.waitForTimeout(300);
  await canvas.screenshot({ path: path.join(SHOT_DIR, "condition-captions-chip-hover.png") });

  const decision = page.locator(".react-flow__node").filter({ has: page.locator(".bpm-decision-title-box") }).first();
  await decision.click({ position: { x: 58, y: 48 } });
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: path.join(SHOT_DIR, "condition-captions-decision-selected.png") });

  console.log(`captions: ${await page.locator('[data-id^="node-condition-"]').count()}, errors: ${JSON.stringify(errors)}`);
  await ctx.close();
} finally {
  await browser.close();
}
