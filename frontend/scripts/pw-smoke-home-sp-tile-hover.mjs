// 홈 맵 상세 SP 섹션 — 타일 호버 스모크. (1) 섹션 호버는 "모두 펼치기"만 켜고 타일 메모 아이콘은 안 바뀐다,
// (2) 타일 호버는 그 타일의 메모 아이콘만 스왑한다, (3) 부서 타일은 text-fine + 포인터 커서 (2026-09-10 수정 회귀 가드).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-home-sp-tile-hover.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 종합 시드 + 인터뷰 샘플 임포트
// (맵 16 정제수 일상 점검 수행=시스템·GMP 메모 보유, 맵 1 Order Fulfillment=Brand Part 1 지정).
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const ADMIN = "admin.sys";
const NOTED = "정제수 일상 점검 수행";
const DESIGNATED = "Order Fulfillment";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function openDetail(page, name) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-map-search"]').fill(name);
  await page.locator('[data-id="map-card"]', { hasText: name }).first().click();
  await page.waitForSelector('[data-id="map-detail-sp-section"]:visible', { timeout: 10000 });
  return page.locator('[data-id="map-detail-sp-section"]:visible').first();
}

// 메모 아이콘 스왑 상태 — 노트 아이콘(.note-swap-note)의 계산된 opacity(0=휴식, 1=스왑됨)
const noteOpacity = (section, field) =>
  section.locator(`[data-id="map-detail-sp-note-${field}"] .note-swap-note`).evaluate((el) => getComputedStyle(el).opacity);

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

  // ── 1) 메모 있는 맵 — 섹션 호버 vs 타일 호버 ────────────────────────────
  const section = await openDetail(page, NOTED);
  await section.locator('[data-id="map-detail-sp-note-system"]').waitFor({ state: "visible", timeout: 5000 });
  // 섹션 안쪽 여백(타일 밖) — 헤더 우측 상태 필 근처 빈 자리
  const box = await section.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 6);
  await page.waitForTimeout(300);
  const expandOpacity = await section.locator('[data-id="map-detail-sp-expand-all"]').evaluate((el) => getComputedStyle(el).opacity);
  check("section hover: expand-all button shows", expandOpacity === "1", `opacity=${expandOpacity}`);
  check("section hover: system note icon stays at rest", (await noteOpacity(section, "system")) === "0");
  check("section hover: gmp note icon stays at rest", (await noteOpacity(section, "gmp")) === "0");
  await section.screenshot({ path: path.join(SHOT_DIR, "home-sp-tile-hover-section.png") });

  await section.locator('[data-id="map-detail-sp-tile-system"]').hover();
  await page.waitForTimeout(500);
  check("tile hover: system note icon swaps", (await noteOpacity(section, "system")) === "1");
  check("tile hover: gmp note icon (other tile) stays at rest", (await noteOpacity(section, "gmp")) === "0");
  await section.screenshot({ path: path.join(SHOT_DIR, "home-sp-tile-hover-tile.png") });

  // ── 2) 지정 맵 — 부서 타일 글자 크기·포인터 ───────────────────────────────
  const spDesignated = await openDetail(page, DESIGNATED);
  const pill = spDesignated.locator('[data-id="map-detail-sp-department-pill"]');
  await pill.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(500);
  const [pillFont, fineFont, captionFont] = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const pillEl = document.querySelector('[data-id="map-detail-sp-department-pill"]');
    return [
      pillEl ? getComputedStyle(pillEl).fontSize : "",
      root.getPropertyValue("--text-fine").trim(),
      root.getPropertyValue("--text-caption").trim(),
    ];
  });
  check("dept pill: font is text-fine (one step below caption)", pillFont === fineFont && fineFont !== captionFont,
    `pill=${pillFont} fine=${fineFont} caption=${captionFont}`);
  // 아이콘과 이름의 세로 중앙 일치(±1px) — 글자 크기를 줄이면서 어긋났던 회귀 가드 (사용자 지적 2026-09-10)
  const centerGap = await pill.evaluate((el) => {
    const svg = el.querySelector("svg");
    const name = svg?.nextElementSibling;
    if (!svg || !name) return null;
    const a = svg.getBoundingClientRect();
    const b = name.getBoundingClientRect();
    return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
  });
  check("dept pill: icon vertically centered with name", centerGap !== null && centerGap <= 1, `gap=${centerGap}`);
  await pill.hover();
  await page.waitForTimeout(200);
  const cursor = await pill.evaluate((el) => getComputedStyle(el).cursor);
  check("dept pill: pointer cursor on hover", cursor === "pointer", `cursor=${cursor}`);
  // 필 > 열(span) > [아이콘+이름 행, 보조 줄] — 보조 줄은 열의 둘째 자식(행 안의 이름 span과 혼동 금지)
  const sub = pill.locator(":scope > span > span:nth-child(2)");
  if ((await sub.count()) > 0) {
    check("dept pill: sub label visible on hover", (await sub.evaluate((el) => getComputedStyle(el).opacity)) === "1");
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    check("dept pill: sub label hidden at rest", (await sub.evaluate((el) => getComputedStyle(el).opacity)) === "0");
  } else {
    console.log("INFO dept pill has no sub label in this seed (no Korean name) — hover reveal not exercised");
  }
  await pill.hover();
  await page.waitForTimeout(200);
  await spDesignated.screenshot({ path: path.join(SHOT_DIR, "home-sp-tile-hover-dept.png") });

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
