// 경량 SVG 프리뷰(ScopePreview) 기하 검증 — 임포트 드라이런 리포트의 L6 맵·L5 캔버스 미리보기와 라이브러리 피크를 캡처하고
// 라벨·화살촉 id 유일성·첫 배율(노드가 읽히는 크기)을 확인한다. 산출물은 ../.shots/preview-geometry/ (gitignore).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3054 node scripts/pw-verify-preview-geometry.mjs
// 전제: reset_db 시드 backend + frontend 기동. 임포트는 드라이런만(롤백) — DB를 바꾸지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "../.shots/preview-geometry";
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples/consultant-interview-sample/calibration-l5.json");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1) 임포트 드라이런 → 첫 L6 맵 미리보기
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Categories & import" }).first().click();
await page.locator('[data-id="interview-import-files"]').setInputFiles([SAMPLE]);
await page.locator('[data-id="interview-import-file-0"]').waitFor({ timeout: 5000 });
await page.locator('[data-id="interview-import-dryrun"]').click();
await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 });
const mapButtons = page.locator('[data-id^="interview-map-preview-btn-"]');
const mapCount = await mapButtons.count();
check("import report lists map previews", mapCount > 0, `maps=${mapCount}`);
for (let i = 0; i < Math.min(mapCount, 5); i += 1) {
  const button = mapButtons.nth(i);
  const code = ((await button.getAttribute("data-id")) ?? "").replace("interview-map-preview-btn-", "");
  await button.click({ force: true });
  const host = page.locator(`[data-id="interview-map-preview-${code}"]`);
  const pane = host.locator('[data-id="scope-preview-pane"]');
  await pane.waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  const labels = await pane.locator('[data-id^="scope-preview-edge-label-"]').count();
  const svgWidth = await pane.locator("svg").first().evaluate((el) => el.getBoundingClientRect().width);
  const paneWidth = await pane.evaluate((el) => el.clientWidth);
  console.log(`  map ${code}: labels=${labels} zoom≈${(svgWidth / paneWidth).toFixed(2)}`);
  await host.screenshot({ path: path.join(OUT, `import-map-${i}.png`) });
  if (i === 0) check("map preview renders edge labels", labels > 0, `labels=${labels}`);
  // 전체 조망(1배) — 건너뛰기·역행 통로·라벨 배치를 한 장에서 본다
  for (let k = 0; k < 24; k += 1) await host.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(200);
  await host.screenshot({ path: path.join(OUT, `import-map-${i}-overview.png`) });
}

// 2) L5 캔버스 미리보기
const canvasBtn = page.locator('[data-id^="interview-canvas-preview-btn-"]').first();
if ((await canvasBtn.count()) > 0) {
  await canvasBtn.click({ force: true });
  const pane = page.locator('[data-id="scope-preview-pane"]').first();
  await pane.waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await pane.screenshot({ path: path.join(OUT, "import-canvas.png") });
  check("L5 canvas preview renders", true);
}

// 3) 화살촉 마커 id 유일성 — 열린 프리뷰들의 marker id가 서로 겹치지 않는다
const markerIds = await page.locator('[data-id="scope-preview-pane"] marker').evaluateAll((els) => els.map((el) => el.id));
check("arrow marker ids are unique per instance", new Set(markerIds).size === markerIds.length && markerIds.every((id) => !id.includes(":")), markerIds.join(","));

// 4) 라이브러리 피크 — 에디터에서 라이브러리 행 클릭
await page.goto(`${BASE}/maps/1`, { waitUntil: "networkidle" });
await page.locator('button[aria-label="Process library"]').click();
await page.waitForSelector('[data-id="process-library-panel"]');
const row = page.locator('[data-id="process-library-panel"] [data-map-id]').first();
if ((await row.count()) > 0) {
  await row.click();
  await page.waitForSelector('[data-id="library-peek"] [data-id="scope-preview-pane"]', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.locator('[data-id="library-peek"]').screenshot({ path: path.join(OUT, "library-peek.png") });
  check("library peek renders preview", true);
}

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
