// "At a glance" 외부 매뉴얼 드롭다운(/manual) 검증 — mocked /api/**, backend/DB 미기동.
// Case A: manual_url·csv_manual_url 둘 다 설정 → 트리거 노출, 메뉴 2항목, 각 클릭 시 window.open 인자 확인.
// Case B: 둘 다 빈 문자열 → 트리거 미노출.
// 실행(frontend/ 에서): node scripts/pw-verify-manual-dropdown.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// Me 인터페이스 공통 필드 — 페이지가 접근하는 필드의 undefined 전파 방지. 테스트 대상인
// manual_url·csv_manual_url 2필드는 케이스별로 meOverrides로 주입한다(여기엔 없음).
const baseMe = {
  username: "admin.sys",
  ai_enabled: false,
  name: "Admin Sys",
  role: "admin",
  department: "HQ",
  org_path: "HQ",
  is_sysadmin: true,
  manager_ids: [],
  can_view_dashboard: true,
};

const manualDoc = {
  format: "markdown",
  content: "# Fallback Manual\n\nHello.",
  updated_at: null,
  updated_by: null,
};

async function mockApi(context, meOverrides) {
  await context.route("**/api/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...baseMe, ...meOverrides }),
    }),
  );
  await context.route("**/api/manual/docs*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await context.route("**/api/manual", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manualDoc),
    }),
  );
  // 전역 알림 벨(레이아웃 chrome, 매뉴얼 기능과 무관) — 미목킹 시 백엔드 부재로 500 → 콘솔 오염
  await context.route("**/api/notifications*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
  // window.open 스텁 — 실제 팝업을 열지 않고 호출 인자만 기록
  window.__openCalls = [];
  window.open = (url, target, features) => {
    window.__openCalls.push({ url, target, features });
    return null;
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

// ── Case A: 둘 다 설정 ──────────────────────────────────────
await mockApi(ctx, {
  manual_url: "https://example.com/edit-manual",
  csv_manual_url: "https://example.com/csv-manual",
});
await page.goto(`${BASE}/manual`, { waitUntil: "domcontentloaded" });

const trigger = page.locator('[data-id="manual-external-menu"]');
try {
  await trigger.waitFor({ state: "visible", timeout: 8000 });
  check("A1 trigger visible (both urls set)", true);
} catch (e) {
  check("A1 trigger visible (both urls set)", false, String(e));
}

await trigger.click();
const menu = page.locator('[role="menu"]');
try {
  await menu.waitFor({ state: "visible", timeout: 3000 });
  check("A2 menu opens on click", true);
} catch (e) {
  check("A2 menu opens on click", false, String(e));
}

const items = page.locator('[role="menuitem"]');
const itemCount = await items.count();
check("A3 menu has exactly 2 menuitems", itemCount === 2, `count=${itemCount}`);

const itemTexts = await items.allInnerTexts();
check(
  "A4 item texts include editSite + csv manual labels",
  itemTexts.some((t) => t.includes("Manual editor site")) &&
    itemTexts.some((t) => t.includes("CSV import manual")),
  JSON.stringify(itemTexts),
);

let svgCounts = [];
for (let i = 0; i < itemCount; i++) {
  svgCounts.push(await items.nth(i).locator("svg").count());
}
check(
  "A5 each menuitem contains svg icon(s) (BookOpen + ExternalLink)",
  svgCounts.every((c) => c >= 2),
  JSON.stringify(svgCounts),
);

// A6 — 편집사이트 항목 클릭 → window.open(manual_url, "_blank", "noopener,noreferrer")
const editItem = items.filter({ hasText: "Manual editor site" });
await editItem.click();
await page.waitForTimeout(200);
let openCalls = await page.evaluate(() => window.__openCalls);
check(
  "A6 edit-site click opens manual_url",
  openCalls.length === 1 &&
    openCalls[0].url === "https://example.com/edit-manual" &&
    openCalls[0].target === "_blank" &&
    openCalls[0].features === "noopener,noreferrer",
  JSON.stringify(openCalls),
);

// 메뉴는 클릭 시 닫히는 사양(setExtOpen(false)) — 재오픈 후 CSV 항목 클릭
await trigger.click();
await page.locator('[role="menu"]').waitFor({ state: "visible", timeout: 3000 });
const csvItem = page.locator('[role="menuitem"]').filter({ hasText: "CSV import manual" });
await csvItem.click();
await page.waitForTimeout(200);
openCalls = await page.evaluate(() => window.__openCalls);
check(
  "A7 csv-manual click opens csv_manual_url",
  openCalls.length === 2 &&
    openCalls[1].url === "https://example.com/csv-manual" &&
    openCalls[1].target === "_blank" &&
    openCalls[1].features === "noopener,noreferrer",
  JSON.stringify(openCalls),
);

// ── Case B: 둘 다 빈 값 ──────────────────────────────────────
await mockApi(ctx, { manual_url: "", csv_manual_url: "" });
await page.reload({ waitUntil: "domcontentloaded" });
// 페이지가 안정적으로 로드됐는지 확인용 앵커 — TOC/본문 등 헤더 아닌 요소 대기
await page.waitForTimeout(800);
const triggerAfter = page.locator('[data-id="manual-external-menu"]');
const triggerCountB = await triggerAfter.count();
check("B1 trigger NOT present (both urls empty)", triggerCountB === 0, `count=${triggerCountB}`);

await browser.close();

const failed = results.some((r) => !r.ok);
console.log(`\nConsole errors: ${errors.length}`);
if (errors.length > 0) {
  for (const e of errors) console.log(`  console-error: ${e}`);
}
const overallPass = !failed && errors.length === 0;
console.log(overallPass ? "\nPASS: all checks passed, no console errors" : "\nFAIL: see above");
process.exit(overallPass ? 0 : 1);
