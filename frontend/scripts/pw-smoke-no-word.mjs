// Word 맵 모드·Word 내보내기 제거 후 회귀 스모크 — 홈 목록·에디터 인스펙터 내보내기 3버튼이 그대로 동작하고 Word 흔적(섹션 패널·Word 버튼·홈 Word 섹션)이 남지 않았는지 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-smoke-no-word.mjs
// 전제: backend+frontend 네이티브 기동, reset_db 시드(맵 "Order Fulfillment"). 스크린샷은 SHOT_DIR(기본 /tmp).
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const ADMIN = "admin.sys";
const MAP = "Order Fulfillment";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── 홈 — 목록이 뜨고 Word 섹션·재임포트 흔적이 없다 ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-map-search"]').fill(MAP);
  const card = page.locator('[data-id="map-card"]', { hasText: MAP }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });
  check("home: map card listed", (await card.count()) === 1);
  check("home: no Word documents section", (await page.locator('[data-id^="word-docs"]').count()) === 0);
  await card.click();
  await page.waitForSelector('[data-id="map-detail-sp-section"]:visible', { timeout: 10000 });
  check("home: no word-doc meta / promote button",
    (await page.locator('[data-id="word-doc-meta"], [data-id="map-detail-promote"]').count()) === 0);
  await page.screenshot({ path: path.join(SHOT_DIR, "no-word-home.png") });

  // ── 에디터 — 인스펙터 내보내기 3버튼만, Word 버튼·섹션 패널 없음 ──
  const href = await page.locator('[data-id="map-detail-open"], a[href^="/maps/"]').first().getAttribute("href");
  const mapId = href?.match(/\/maps\/(\d+)/)?.[1];
  check("home: open link resolves map id", Boolean(mapId), `href=${href}`);
  await page.goto(`${BASE}/maps/${mapId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  // 인스펙터 맵 탭(탭 버튼은 aria-label만 가진다 — pw-verify-params-ui-sync와 동일)
  await page.locator('button[aria-label="Map"]').first().click();
  const exportPng = page.locator('[data-id="export-png"]');
  await exportPng.waitFor({ state: "visible", timeout: 10000 });
  check("editor: export PNG/Excel/CSV buttons present",
    (await page.locator('[data-id="export-png"], [data-id="export-excel"], [data-id="export-csv"]').count()) === 3);
  check("editor: no Word export / complete-doc buttons",
    (await page.locator('[data-id="inspector-export-word"], [data-id="inspector-generate-complete-doc"]').count()) === 0);
  check("editor: no word page boundary", (await page.locator('[data-id="word-page-boundary"]').count()) === 0);
  await exportPng.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOT_DIR, "no-word-editor.png") });

  // 컨텍스트 메뉴의 라이브러리 항목은 pw-verify-library-open.mjs가 끝까지(패널 열림) 검증한다.

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
