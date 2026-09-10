// 홈 업무 체계 뷰 — 레벨 상세 패널 + 맵 카드 재디자인(2026-09-10) 검증 스모크.
// 레벨 패널 L1~L5(경로 칩·타일·직계 하위/소속 맵 목록), 직계 하위 드릴다운(트리 펼침 연동), 소속 맵 행 클릭→맵 상세,
// 카드 호버(상태 필 접힘·열기 슬라이드 인), 호버 요약 모달(0.7초 등장·페이드 아웃), 경고 모달, 미확정 오너 인물 카드 배너,
// 좁은 뷰포트(1100px) 캡처.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 OUT_DIR=/tmp/shots node scripts/pw-verify-fw-detail-cards.mjs
// 전제: backend+frontend 네이티브 기동, 인터뷰 샘플(calibration-l5·utility-l5) 임포트된 시드(체인 상수 CHAIN 참고).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "/tmp/fw-detail-cards-shots";
const CHAIN = ["EPCV", "Facility", "계측 보전", "Calibration 기획 및 운영", "Calibration 수행 및 결과 보고"];
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];

async function openPage(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "ko");
    window.localStorage.removeItem("bpm.homeTree");
    window.localStorage.removeItem("bpm.frameworkTree");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: /Framework|체계/ }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 10000 });
  return page;
}
const nodeButton = (page, name) =>
  page.locator('[data-id="framework-node"] button[aria-expanded]').filter({ hasText: name }).first();
async function selectNode(page, name) {
  const btn = nodeButton(page, name);
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click();
  if ((await btn.getAttribute("aria-expanded")) === "false") await btn.click();
  await page.waitForSelector('[data-id="category-summary-card"]', { timeout: 8000 });
  await page.waitForTimeout(500);
}

try {
  const page = await openPage(1440);

  // ── L1~L5 패널 ──
  for (let i = 0; i < CHAIN.length; i++) {
    await selectNode(page, CHAIN[i]);
    await page.screenshot({ path: `${OUT}/after-L${i + 1}.png` });
    await page.locator('[data-id="map-detail-aside"]').screenshot({ path: `${OUT}/after-L${i + 1}-aside.png` });
  }
  check("L5 path chip present", (await page.locator('[data-id="category-summary-path"]').count()) === 1);
  check("L5 maps list rows", (await page.locator('[data-id="category-summary-map-row"]').count()) === 3);
  check("L5 canvas tile", (await page.locator('[data-id="category-summary-tile-canvas"]').count()) === 1);

  // ── L5 소속 맵 행 클릭 → 맵 상세 ──
  await page.locator('[data-id="category-summary-map-row"]').first().click();
  await page.waitForTimeout(700);
  const mapDetailShown = (await page.locator('[data-id="map-detail-aside"] [data-id="map-detail-category"]').count()) > 0;
  check("map row click → map detail", mapDetailShown);

  // ── L2 → 직계 하위 드릴다운 ──
  await selectNode(page, CHAIN[1]);
  check("L2 children list", (await page.locator('[data-id="category-summary-children"] li').count()) === 2);
  check("L2 confirm bar", (await page.locator('[data-id="category-summary-confirm-bar"]').count()) === 1);
  // 트리에서 유틸리티 운전 접기 → 드릴다운이 다시 펼치는지
  const utilBtn = nodeButton(page, "유틸리티 운전");
  // 트리 클릭은 토글+선택이라 접은 뒤 Facility(L2)를 다시 선택해 패널을 되돌린다
  if ((await utilBtn.getAttribute("aria-expanded")) === "true") await utilBtn.click();
  await page.waitForTimeout(300);
  await selectNode(page, CHAIN[1]);
  check("util collapsed before drilldown", (await utilBtn.getAttribute("aria-expanded")) === "false");
  await page.locator('[data-id="category-summary-children"] button', { hasText: "유틸리티 운전" }).click();
  await page.waitForTimeout(900);
  const nowSelected = await page.locator('[data-id="category-summary-card"] h2').innerText();
  check("child row click → selects child", nowSelected.includes("유틸리티 운전"), nowSelected);
  check("child row click → tree expanded", (await utilBtn.getAttribute("aria-expanded")) === "true");
  await page.screenshot({ path: `${OUT}/after-drilldown.png` });

  // ── 카드 상태 캡처 (L5 펼친 상태) ──
  await selectNode(page, CHAIN[4]);
  const tree = page.locator('[data-id="framework-tree"]');
  await tree.screenshot({ path: `${OUT}/after-tree-cards.png` });
  const card = page.locator('[data-id="framework-tree"] [data-id="map-card"]').first();
  await card.screenshot({ path: `${OUT}/after-card.png` });
  // 호버 — 상태 필 접힘 + 열기 노출
  const statusPill = card.locator('[data-id="map-card-status"]');
  const wBefore = (await statusPill.boundingBox())?.width ?? 0;
  await card.hover();
  await page.waitForTimeout(350);
  const wAfter = (await statusPill.boundingBox())?.width ?? 0;
  check("status pill collapses on hover", wAfter < wBefore - 20, `${wBefore}→${wAfter}`);
  const openOpacity = await card.locator('[data-id="map-card-open"]').evaluate((el) => getComputedStyle(el).opacity);
  check("open button visible on hover", openOpacity === "1", openOpacity);
  await card.screenshot({ path: `${OUT}/after-card-hover.png` });
  // 호버 모달 0.7초
  await page.waitForTimeout(600);
  const modal = page.locator('[data-id="map-card-hover-modal"]');
  check("hover modal appears (~0.7s)", (await modal.count()) === 1);
  await page.screenshot({ path: `${OUT}/after-card-hover-modal.png` });
  // 이탈 → closing 페이즈 후 언마운트
  await page.mouse.move(5, 5);
  await page.waitForTimeout(40);
  const closingPhase = await modal.getAttribute("data-phase").catch(() => null);
  check("hover modal fades out (closing phase)", closingPhase === "closing", String(closingPhase));
  await page.waitForTimeout(300);
  check("hover modal unmounted", (await modal.count()) === 0);

  // ── 경고 모달 ──
  const warnBtn = page.locator('[data-id="framework-tree"] [data-id="map-card-warnings"]').first();
  check("warnings badge present", (await warnBtn.count()) > 0);
  await warnBtn.click();
  await page.waitForSelector('[data-id="map-card-warnings-modal"]', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/after-warnings-modal.png` });
  const warnRows = await page.locator('[data-id^="map-card-warning-"]').count();
  check("warnings modal rows", warnRows >= 1, String(warnRows));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("warnings modal closes on Esc", (await page.locator('[data-id="map-card-warnings-modal"]').count()) === 0);

  // ── 오너 필 클릭 → 인물 카드 + 미확정 배너 ──
  const ownerPill = page.locator('[data-id="framework-tree"] [data-id="map-card-owner"][data-pending="true"]').first();
  check("pending owner pill present", (await ownerPill.count()) > 0);
  await ownerPill.click();
  await page.waitForSelector('[data-id="person-hover-card"]', { timeout: 5000 });
  check("person card notice shown", (await page.locator('[data-id="person-hover-notice"]').count()) === 1);
  await page.waitForTimeout(400); // animate-item-in(220ms) 끝난 뒤 캡처
  await page.screenshot({ path: `${OUT}/after-owner-card.png` });
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 120);
  await page.waitForTimeout(200);

  // ── 부서 뷰 카드 ──
  await page.locator('[data-id="home-view-toggle"] button', { hasText: /Departments|부서/ }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/after-departments.png` });
  await page.context().close();

  // ── 좁은 뷰포트(1100px) ──
  const narrow = await openPage(1100);
  for (const name of CHAIN) await selectNode(narrow, name);
  await narrow.locator('[data-id="framework-tree"]').screenshot({ path: `${OUT}/after-narrow-tree.png` });
  await narrow.screenshot({ path: `${OUT}/after-narrow.png` });
  await narrow.context().close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed; pageerrors: ${errors.length ? errors.join(" | ") : "none"}`);
process.exit(failed || errors.length ? 1 : 0);
