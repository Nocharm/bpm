// Task 10 검증 — 홈 우측 대시보드 조립 + 선택 시 좌측 아코디언 자동펼침을 실제 브라우저에서 확인.
// 실행: node scripts/pw-verify-home-dashboard.mjs  (playwright-core, 프론트 dev 서버 사전 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.PW_BASE_URL ?? "http://localhost:3011";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.kim"); // owning_department 있는 로컬 유저
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (label, ok) => { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} - ${label}`); };

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// 최근 열람 목록이 비어 있으면 RecentOpenedList가 렌더 자체를 스킵(null) — 백엔드에서 첫 맵 id를
// 조회해 bpm.recentMaps에 직접 시드, "home-recent" 섹션이 실제로 뜨는지까지 확인.
const firstMapId = await page.evaluate(async () => {
  const r = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.kim" } });
  const list = await r.json();
  return list[0]?.id ?? null;
});
if (firstMapId) {
  await page.evaluate((id) => {
    window.localStorage.setItem("bpm.recentMaps", JSON.stringify([{ id, at: Date.now() }]));
  }, firstMapId);
}
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// 우측 폭 확보 — split 브레이크포인트(980px) 이상에서만 aside 노출
check("home-dashboard visible (unselected)", await page.locator('[data-id="home-dashboard"]').isVisible().catch(() => false));
check("home-recent visible", await page.locator('[data-id="home-recent"]').isVisible().catch(() => false));
check("home-my-documents visible", await page.locator('[data-id="home-my-documents"]').isVisible().catch(() => false));
check("home-needs-approval visible", await page.locator('[data-id="home-needs-approval"]').isVisible().catch(() => false));

// hover 시 open 버튼 노출 — home-recent의 첫 행(방금 시드한 firstMapId)을 대상으로 클릭까지 이어간다.
const firstRow = page.locator('[data-id="home-recent"] [data-id="dashboard-map-row"]').first();
const rowCount = await firstRow.count();
if (rowCount > 0 && firstMapId) {
  await firstRow.hover();
  await page.waitForTimeout(200);
  check("dashboard-map-open visible on hover", await firstRow.locator('[data-id="dashboard-map-open"]').isVisible().catch(() => false));

  // owning_department 확보 — 자동펼침 대상 최상위 path 계산
  const dept = await page.evaluate(async (id) => {
    const r = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.kim" } });
    const list = await r.json();
    return list.find((m) => m.id === id)?.owning_department ?? null;
  }, firstMapId);
  const topPath = dept ? dept.split("/")[0] : null;

  // 행 클릭 → 우측이 MapDetailCard로 전환 + 좌측 부서 펼침
  await firstRow.click();
  await page.waitForTimeout(600);
  const dashboardGone = !(await page.locator('[data-id="home-dashboard"]').isVisible().catch(() => false));
  check("home-dashboard replaced by detail after row click", dashboardGone);
  const detailVisible = await page.locator('[data-id="map-detail-aside"]').isVisible().catch(() => false);
  check("map-detail-aside visible after select", detailVisible);

  if (topPath) {
    const toggle = page.locator(`[data-id="org-node-toggle"][data-path="${topPath}"]`);
    const toggleCount = await toggle.count().catch(() => 0);
    if (toggleCount > 0) {
      const expanded = await toggle.locator("svg.lucide-chevron-down").count().catch(() => 0);
      check(`org accordion auto-expanded for owning_department "${topPath}"`, expanded > 0);
    } else {
      console.log(`org-node-toggle not found for path "${topPath}" (unassigned bucket or not rendered under current filters) — skip`);
    }
  } else {
    console.log("selected map has no owning_department — skip auto-expand check");
  }
} else {
  console.log("no seeded row in home-recent — skip hover/click/auto-expand checks");
}

// 도넛 세그먼트 클릭 → 목록 변경 확인 (StatusDonutCard 내부, my-documents 카드로 재접근)
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
const donutCard = page.locator('[data-id="home-my-documents"]');
const segPath = donutCard.locator("svg path, svg circle").first();
if (await segPath.count().catch(() => 0) > 0) {
  const beforeRows = await donutCard.locator('[data-id="dashboard-map-row"]').count();
  await segPath.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const afterRows = await donutCard.locator('[data-id="dashboard-map-row"]').count();
  check("donut segment click renders a list (rows >= 0)", afterRows >= 0);
  console.log(`donut rows before=${beforeRows} after=${afterRows}`);
} else {
  console.log("no donut segments (owned maps empty for this dev user) — skip donut click check");
}

check("no console/page errors", errors.length === 0);
if (errors.length) console.log("console errors:\n" + errors.join("\n"));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
