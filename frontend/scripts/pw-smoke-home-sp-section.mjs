// 홈 맵 상세 — 서브프로세스 정보 섹션 스모크. (1) SP 미지정·내용 없는 맵도 섹션이 톤다운·접힘으로 남는지,
// (2) 정상 부서로 지정된 맵의 부서 타일에 고아 경고가 안 뜨는지 (2026-09-10 두 수정의 회귀 가드).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-home-sp-section.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 종합 시드(맵 1 Order Fulfillment=Brand Part 1 지정,
// 맵 2 Employee Onboarding=미지정·SP 값 없음). 스크린샷은 SHOT_DIR(기본 /tmp)에 남긴다.
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const ADMIN = "admin.sys";
const DESIGNATED = "Order Fulfillment";
const PLAIN = "Employee Onboarding";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

// 검색창으로 플랫 리스트에 띄운 뒤 카드를 눌러 우측 상세를 연다
async function openDetail(page, name) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-map-search"]').fill(name);
  await page.locator('[data-id="map-card"]', { hasText: name }).first().click();
  await page.waitForSelector('[data-id="map-detail-sp-section"]:visible', { timeout: 10000 });
  return page.locator('[data-id="map-detail-sp-section"]:visible').first();
}

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

  // ── 1) 지정 맵 — 부서 타일 경고 없음 ──────────────────────────────────────
  const spDesignated = await openDetail(page, DESIGNATED);
  const pill = spDesignated.locator('[data-id="map-detail-sp-department-pill"]');
  await pill.waitFor({ state: "visible", timeout: 5000 });
  // 디렉터리 로드 후 판정이 바뀔 수 있어 잠시 기다린 뒤 읽는다
  await page.waitForTimeout(800);
  check("designated map: department pill has no orphan flag", (await pill.getAttribute("data-orphan")) === null,
    `text=${(await pill.textContent())?.trim()}`);
  check("designated map: department pill is clickable (role=button)", (await pill.getAttribute("role")) === "button");
  check("designated map: status pill = Designated",
    ((await spDesignated.locator('[data-id="map-detail-sp-status"]').textContent()) ?? "").trim() === "Designated");
  await spDesignated.screenshot({ path: path.join(SHOT_DIR, "home-sp-section-designated.png") });

  // ── 2) 미지정·내용 없음 맵 — 섹션은 남고 톤다운·접힘 ─────────────────────
  const spPlain = await openDetail(page, PLAIN);
  check("plain map: section rendered", (await spPlain.count()) === 1);
  check("plain map: status pill = Not designated",
    ((await spPlain.locator('[data-id="map-detail-sp-status"]').textContent()) ?? "").trim() === "Not designated");
  check("plain map: starts collapsed (no attrs group)",
    (await spPlain.locator('[data-id="map-detail-sp-attrs"]').count()) === 0);
  const bg = await spPlain.evaluate((el) => getComputedStyle(el).backgroundColor);
  const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim());
  check("plain map: toned-down background (not plain surface)", bg !== "" && bg !== surface && bg !== "rgb(255, 255, 255)", `bg=${bg}`);
  await page.screenshot({ path: path.join(SHOT_DIR, "home-sp-section-plain-page.png") });
  await spPlain.screenshot({ path: path.join(SHOT_DIR, "home-sp-section-plain.png") });
  // 펼쳐도 죽지 않고 빈 타일("Not set")을 보여준다
  await spPlain.locator('[data-id="map-detail-sp-toggle"]').click();
  await spPlain.locator('[data-id="map-detail-sp-attrs"]').waitFor({ state: "visible", timeout: 3000 });
  check("plain map: expands to empty tiles",
    ((await spPlain.locator('[data-id="map-detail-sp-attrs"]').textContent()) ?? "").includes("Not set"));
  await spPlain.screenshot({ path: path.join(SHOT_DIR, "home-sp-section-plain-expanded.png") });

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
