// 홈 Framework 뷰 스모크 — 세그먼트 토글·lazy 카테고리 트리 펼침·맵 카드 노출·상세 카드 경로뱃지/IO·
// Departments 회귀·새로고침 뷰 유지. docs/samples/consultant-delivery-sample import --apply 전제.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-framework.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드 + import_consultant --apply 완료.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";

// 샘플 전달물(docs/samples/consultant-delivery-sample) 고정값 — 어긋나면 샘플이나 여기 둘 중 하나를 고친다.
const L5_PATH = "구매/소싱/구매요청관리/발주처리/원자재발주";
const CHAIN = ["구매", "소싱", "구매요청관리", "발주처리", "원자재발주"]; // L1→L5, 형제(대금지급)는 안 탐
const MAP_NAME = "원자재 구매요청 접수"; // params(duration/annual_count/fte/input=PR/output=PO) 보유 맵

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function openContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  return ctx;
}

// framework-node 버튼은 span(카테고리명)+CountTag만 담고, 자식 카테고리의 <ul>은 버튼의 형제라
// hasText가 조상 li까지 오매칭하지 않는다(li 기준이면 자손 텍스트까지 걸려 .first()가 부모를 집는다).
const nodeButton = (page, name) =>
  page.locator('[data-id="framework-node"] > button').filter({ hasText: name });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const ctx = await openContext(browser);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 1) 홈 진입 — 뷰 토글 노출 ────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: "networkidle" });
  const toggleVisible = await page.locator('[data-id="home-view-toggle"]').isVisible().catch(() => false);
  check("home-view-toggle visible", toggleVisible);

  // ── 2) Framework 클릭 → 트리 펼침 → 체인 하강 → 맵 카드 노출 ──────────────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 8000 });
  // 루트 카테고리는 마운트 후 비동기 fetch로 채워진다 — isVisible()의 즉시 스냅샷이 아니라
  // waitFor로 도착을 기다려야 한다(즉시 체크는 아직 미도착 시 거짓 FAIL을 낸다).
  const rootVisible = await nodeButton(page, CHAIN[0]).first().waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("framework-tree root category row visible", rootVisible, CHAIN[0]);

  for (const name of CHAIN) {
    const btn = nodeButton(page, name).first();
    await btn.waitFor({ state: "visible", timeout: 8000 });
    await btn.click();
    await page.waitForTimeout(150); // lazy fetch(children+maps) 왕복 대기
  }
  const mapCard = page.locator('[data-id="framework-tree"] [data-id="map-card-name"]', { hasText: MAP_NAME });
  const mapVisible = await mapCard.first().isVisible().catch(() => false);
  check("imported map card visible after expanding L1→L5 chain", mapVisible, MAP_NAME);

  // ── 3) 맵 선택 → 상세 카드 경로뱃지 + IO ───────────────────────────────────
  // map-detail-*는 이중 마운트(모바일 인라인 아코디언 split:hidden + 데스크톱 우측 aside)가 기존
  // 패턴 — 뷰포트 1440에서 인라인 쪽은 CSS로 숨어 있으므로 :visible로 실제 노출본만 골라야 한다.
  await page.locator('[data-id="framework-tree"] [data-id="map-card"]', { hasText: MAP_NAME }).first().click();
  await page.waitForSelector('[data-id="map-detail-category"]:visible', { timeout: 8000 });
  const categoryText = (await page.locator('[data-id="map-detail-category"]:visible').first().textContent()) ?? "";
  check("map-detail-category shows L1..L5 path badge", categoryText.includes(L5_PATH), categoryText.trim());

  await page.waitForSelector('[data-id="map-detail-io"]:visible', { timeout: 8000 });
  const ioText = (await page.locator('[data-id="map-detail-io"]:visible').first().textContent()) ?? "";
  check("map-detail-io shows Input/Output values", ioText.includes("PR") && ioText.includes("PO"), ioText.trim());

  // ── 4) Departments 복귀 — 조직도 회귀 ──────────────────────────────────────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Departments" }).click();
  await page.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const orgVisible = await page.locator('[data-id="home-org-accordion"]').isVisible().catch(() => false);
  check("Departments toggle renders org accordion (regression)", orgVisible);

  // ── 5) 새로고침 — 마지막 선택(Departments) 유지 ────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  const storedRaw = await page.evaluate(() => window.localStorage.getItem("bpm.home.tree"));
  const storedView = (() => {
    try {
      return JSON.parse(storedRaw ?? "{}").view;
    } catch {
      return null;
    }
  })();
  const orgStillVisible = await page.locator('[data-id="home-org-accordion"]').isVisible().catch(() => false);
  const frameworkGone = (await page.locator('[data-id="framework-tree"]').count()) === 0;
  check(
    "view persists across reload (bpm.home.tree.view)",
    storedView === "departments" && orgStillVisible && frameworkGone,
    `view=${storedView} orgVisible=${orgStillVisible} frameworkGone=${frameworkGone}`,
  );

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
