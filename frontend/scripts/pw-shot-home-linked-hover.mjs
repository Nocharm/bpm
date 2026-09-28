// 홈 대시보드 맵 호버 연동 표식 캡처 — 최근 열람 행에 마우스를 올려 다른 섹션의 같은 맵 행에 좌측 액센트 바가 뜨는지 확인.
// 실행: frontend/에서 PW_BASE_URL=http://localhost:3047 node scripts/pw-shot-home-linked-hover.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.PW_BASE_URL ?? "http://localhost:3047";
const OUT = process.env.PW_OUT_DIR ?? "/tmp";
const USER = process.env.PW_USER ?? "admin.sys"; // 시드에서 맵을 소유한 유저 — 내 문서·최근 변경에 같은 맵이 떠야 연동이 보인다

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript((u) => { window.localStorage.setItem("bpm.devUser", u); }, USER);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
const check = (label, ok) => { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} - ${label}`); };

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// 내가 오너인 맵을 최근 열람에 시드 — 내 문서·내 부서 섹션에도 같은 맵이 뜨도록
const ids = await page.evaluate(async (u) => {
  const r = await fetch("/api/maps", { headers: { "X-Dev-User": u } });
  const list = await r.json();
  const mine = list.filter((m) => (m.owner_id ?? m.created_by) === u).map((m) => m.id);
  return (mine.length ? mine : list.map((m) => m.id)).slice(0, 6);
}, USER);
await page.evaluate((ids) => {
  window.localStorage.setItem("bpm.recentMaps", JSON.stringify(ids.map((id, i) => ({ id, at: Date.now() - i * 60000 }))));
}, ids);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const dash = page.locator('[data-id="home-dashboard"]');
check("home-dashboard visible", await dash.isVisible());
const recentRows = page.locator('[data-id="home-recent"] [data-id="dashboard-map-row"]');
const n = await recentRows.count();
check("recent rows present", n > 0);

// 연동 행이 가장 많이 뜨는 최근 열람 행을 골라 호버 상태로 캡처
let best = { i: -1, linked: 0 };
for (let i = 0; i < n; i++) {
  await recentRows.nth(i).hover();
  await page.waitForTimeout(200);
  const linked = await page.locator("[data-linked]").count();
  if (linked > best.linked) best = { i, linked };
}
check("some other-section row is linked on hover", best.linked > 0);
if (best.i >= 0) {
  const row = recentRows.nth(best.i);
  await row.hover();
  await page.waitForTimeout(300);
  check("hovered row itself is NOT marked linked", (await row.getAttribute("data-linked")) === null);
  const shadow = await page.locator("[data-linked]").first().evaluate((el) => getComputedStyle(el).boxShadow);
  check(`linked row has inset accent bar (${shadow})`, /inset/.test(shadow) && shadow !== "none");
  const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log(`hovered row bg=${bg}`);
  await dash.screenshot({ path: `${OUT}/home-linked-hover.png` });
  console.log(`shot: ${OUT}/home-linked-hover.png (linked rows: ${best.linked})`);
}

// 반대 방향 — 다른 섹션 행 호버 시 최근 열람 행에 표식
const other = page.locator("[data-linked]").first();
if (await other.count()) {
  const mapId = await other.getAttribute("data-map-id");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const target = page.locator(`[data-map-id="${mapId}"]`).last();
  await target.hover();
  await page.waitForTimeout(300);
  const back = await page.locator(`[data-id="home-recent"] [data-map-id="${mapId}"][data-linked]`).count();
  check("reverse: recent row marked when other-section row hovered", back > 0);
  await dash.screenshot({ path: `${OUT}/home-linked-hover-reverse.png` });
}

check("no page errors", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
