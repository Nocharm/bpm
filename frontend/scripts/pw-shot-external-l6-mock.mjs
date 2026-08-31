// 항목 8 확인 — 연계 캔버스에서 "다른 L5" 소속 L6를 미리보기하면 노드 목업이 실제 캔버스 렌더와
// 같은 C안(흰 바디 + 좌측 컬러 탭)으로 그려지는지. 같은 L5 소속은 기존 파스텔 필 유지.
// 실행(frontend/): BASE_URL=http://localhost:3100 SHOT_DIR=/tmp/shots node scripts/pw-shot-external-l6-mock.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-ext-l6";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// 캔버스와, 캔버스가 결착된 L5가 아닌 다른 L5의 맵을 찾는다
const target = await page.evaluate(async () => {
  const list = await (await fetch("/api/maps")).json();
  const maps = Array.isArray(list) ? list : (list.maps ?? []);
  const canvas = maps.find((m) => m.mode === "framework");
  if (!canvas) return null;
  const detail = await (await fetch(`/api/maps/${canvas.id}`)).json();
  const ownCat = detail.linkage_category_id;
  // 전체 L5 순회 — 캔버스 소속이 아닌 L5의 맵 하나
  const walk = async (pid) => {
    const kids = await (
      await fetch(pid == null ? "/api/categories/nodes" : `/api/categories/nodes?parent_id=${pid}`)
    ).json();
    for (const k of kids) {
      if (k.level === 5) {
        if (k.id === ownCat) continue;
        const mm = await (await fetch(`/api/categories/${k.id}/maps`)).json();
        if ((mm.maps ?? []).length) return { catId: k.id, catName: k.name, map: mm.maps[0] };
      } else {
        const found = await walk(k.id);
        if (found) return found;
      }
    }
    return null;
  };
  const other = await walk(null);
  return { canvasId: canvas.id, ownCat, other };
});
check("외부 L5 후보 확보", target?.other != null, JSON.stringify(target?.other ?? target));
if (!target?.other) process.exit(1);

await page.goto(`${BASE}/maps/${target.canvasId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 20000 });
await page.locator(".react-flow").first().click({ position: { x: 60, y: 400 } });
await page.keyboard.press("s");
await page.locator('[data-id="framework-tree-picker"]').waitFor({ state: "visible", timeout: 8000 });

// 대상 맵 행이 보일 때까지 트리를 펼친다(단일 후보 구간은 자동 드릴인이 처리)
const mapRow = page.locator(`[data-id="framework-picker-map-${target.other.map.id}"]`);
for (let round = 0; round < 8; round++) {
  if (await mapRow.count()) break;
  const closed = page.locator('[data-id^="framework-picker-node-"][aria-expanded="false"]');
  const n = await closed.count();
  if (!n) break;
  for (let i = 0; i < n; i++) {
    const row = closed.nth(i);
    if (await row.isVisible().catch(() => false)) {
      await row.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(500);
}
check("다른 L5의 맵 행 노출", (await mapRow.count()) > 0, `map ${target.other.map.id} (${target.other.catName})`);

await mapRow.click();
await page.locator('[data-id="library-peek"]').waitFor({ state: "visible", timeout: 12000 });
await page.waitForTimeout(1500);

const mock = page.locator('[data-id="library-peek-node-mock"]');
const bg = await mock.evaluate((el) => getComputedStyle(el).backgroundColor);
const originBadge = await page.locator('[data-id="library-peek-mock-origin"]').count();
// 좌측 컬러 탭 — 목업 첫 자식 span(absolute, width 5px)
const tabWidth = await mock.evaluate((el) => {
  const span = el.querySelector("span[aria-hidden]");
  return span ? getComputedStyle(span).width : null;
});
check("[8] 외부 L6 출처 배지 노출", originBadge > 0, `badge=${originBadge}`);
check("[8] 목업 바디가 흰색(파스텔 필 아님)", /255,\s*255,\s*255/.test(bg), `bg=${bg}`);
check("[8] 좌측 컬러 탭 존재(5px)", tabWidth === "5px", `tab=${tabWidth}`);
await page.screenshot({ path: `${SHOT_DIR}/08-external-l6-mock.png` });

// 대비용 — 같은 L5(캔버스 소속) 맵은 파스텔 필 유지
const ownRow = page.locator('[data-id^="framework-picker-map-"]').first();
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await ownRow.click();
await page.locator('[data-id="library-peek"]').waitFor({ state: "visible", timeout: 12000 });
await page.waitForTimeout(1200);
const ownBg = await page.locator('[data-id="library-peek-node-mock"]').evaluate((el) => getComputedStyle(el).backgroundColor);
check("[8] 같은 L5 목업은 파스텔 필 유지(회귀)", !/255,\s*255,\s*255/.test(ownBg), `bg=${ownBg}`);
await page.screenshot({ path: `${SHOT_DIR}/08-own-l5-mock.png` });

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`shots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
