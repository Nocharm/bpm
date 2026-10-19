// 비교 화면 PNG 내보내기 스모크 — 비교 데모 맵(13, 기준 73 → 대상 74)을 열고 옵션 창(화면 그대로 ↔ 문서용, 범례·정보 블록·
// 표시 정보 토글)을 조작하며 쉬머 중간 프레임과 안정 프레임을 캡처한 뒤 두 형식의 PNG를 실제로 내려받는다.
// 파일 이름 규칙(맵_기준-vs-대상_compare_KST시각), 문서용 pHYs(dpi), 캡처 뒤 포커스 복원, 문서용 나눠 싣기 ZIP을 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3061 MAP_ID=13 BASE_ID=73 TARGET_ID=74 node scripts/pw-compare-png-export.mjs
//   PW_LANG=ko|en(기본 ko). 산출물은 저장소 루트 .shots/compare-png-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys, 비교 데모 시드(seed_compare_demo).
import { mkdirSync, readFileSync } from "node:fs";

import JSZip from "jszip";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = process.env.MAP_ID ?? "13";
const BASE_ID = process.env.BASE_ID ?? "73";
const TARGET_ID = process.env.TARGET_ID ?? "74";
const LANG = process.env.PW_LANG ?? "ko";
const OUT = "../.shots";

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((lang) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", lang);
}, LANG);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${MAP_ID}/compare?base=${BASE_ID}&target=${TARGET_ID}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 180_000 });
// 지난 실행의 기억을 지우고 다시 연다 — 기본값(화면 그대로)부터 본다
await page.evaluate(() => window.localStorage.removeItem("bpm.comparePngExport"));
await page.waitForTimeout(2500);

// 변경 목록 첫 항목으로 포커스 — 캡처 동안 비우고 끝나면 되돌리는지 본다
await page.locator("aside li button").first().click();
await page.waitForTimeout(800);
const ringBefore = await page.locator(".node-ring-selected").count();

const modal = page.locator('[data-id="compare-png-modal"]');
const openModal = async () => {
  await page.locator('[data-id="compare-export-png"]').click();
  await modal.waitFor();
  await page.waitForTimeout(400);
};
const NAME_RE = /_compare_\d{8}-\d{4}\.png$/;
const download = async (name) => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.locator('[data-id="compare-png-download"]').click(),
  ]);
  const suggested = file.suggestedFilename();
  check(`${name} file name`, NAME_RE.test(suggested) && suggested.includes("-vs-"), suggested);
  const path = `${OUT}/compare-png-${name}.png`;
  await file.saveAs(path);
  const bytes = readFileSync(path);
  const at = bytes.indexOf(Buffer.from("pHYs"));
  const dpi = at > 0 ? Math.round(bytes.readUInt32BE(at + 4) * 0.0254) : 0;
  console.log(`  ${path} ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}px${dpi ? ` · ${dpi} dpi` : ""}`);
  await modal.waitFor({ state: "detached" });
  await page.waitForTimeout(1200);
  const leftover = await page.locator(".react-flow__viewport.bpm-export-compare").count();
  check(`${name} restores canvas classes`, leftover === 0);
  return dpi;
};

await openModal();
check("opens on canvas format by default", (await page.locator('[data-id="compare-png-format-screen"]').getAttribute("aria-pressed")) === "true");
check("preview follows page palette", (await page.locator('[data-id="compare-png-preview"]').getAttribute("data-diff-palette")) !== null);
check("preview shows info header and legend", (await page.locator('[data-id="compare-png-preview-header"]').count()) === 1 && (await page.locator('[data-id="compare-png-preview-legend"]').count()) === 1);
await modal.screenshot({ path: `${OUT}/compare-png-modal-screen.png` });

// 범례 끄기 — 쉬머 중간 프레임과 사라진 뒤
await page.locator('[data-id="compare-png-toggle-legend"]').click();
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/compare-png-modal-legend-shimmer-out.png` });
await page.waitForTimeout(600);
check("legend leaves the preview", (await page.locator('[data-id="compare-png-preview-legend"]').count()) === 0);
await page.locator('[data-id="compare-png-toggle-legend"]').click();
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/compare-png-modal-legend-shimmer-in.png` });
await page.waitForTimeout(600);

// 정보 블록 끄고 켜기
await page.locator('[data-id="compare-png-toggle-info"]').click();
await page.waitForTimeout(650);
check("info header leaves the preview", (await page.locator('[data-id="compare-png-preview-header"]').count()) === 0);
await page.locator('[data-id="compare-png-toggle-info"]').click();
await page.waitForTimeout(650);

// 표시 정보 — 입력물·산출물을 켜면 샘플 변경 노드에 줄이 생긴다(출력에도 적용)
for (const field of ["input", "output"]) {
  const chip = page.locator(`[data-id="compare-png-field-${field}"]`);
  if ((await chip.getAttribute("aria-checked")) !== "true") await chip.click();
}
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/compare-png-modal-fields-shimmer.png` });
await page.waitForTimeout(600);
check("preview shows io lines", (await page.locator('[data-id="compare-png-preview-line-input"]').count()) === 1);
await modal.screenshot({ path: `${OUT}/compare-png-modal-screen-settled.png` });
const screenDpi = await download("screen");
check("canvas format has no print dpi", screenDpi === 0);
check("focus ring restored after export", (await page.locator(".node-ring-selected").count()) === ringBefore, `${ringBefore} ring(s)`);

// 문서용 — 인쇄 크기 패널이 펼쳐지고 dpi를 싣는다
await openModal();
await page.locator('[data-id="compare-png-format-document"]').click();
await page.waitForTimeout(180);
await modal.screenshot({ path: `${OUT}/compare-png-modal-document-shimmer.png` });
await page.waitForTimeout(600);
check("document hint appears", await page.locator('[data-id="compare-png-document-hint"]').isVisible());
check("print panel shows size", (await page.locator('[data-id="png-export-print-dims"]').count()) === 1, await page.locator('[data-id="png-export-print-dims"]').textContent());
console.log(`  dpi ${await page.locator('[data-id="png-export-print-dpi"]').textContent()} · text ${await page.locator('[data-id="png-export-print-pt"]').textContent()}`);
await modal.screenshot({ path: `${OUT}/compare-png-modal-document.png` });
const docDpi = await download("document");
check("document carries pHYs dpi", docDpi > 0, `${docDpi} dpi`);

await openModal();
check("remembers document format", (await page.locator('[data-id="compare-png-format-document"]').getAttribute("aria-pressed")) === "true");
// 범례·정보 블록 없이 문서용 하나 더 — 그림만
await page.locator('[data-id="compare-png-toggle-info"]').click();
await page.locator('[data-id="compare-png-toggle-legend"]').click();
await page.waitForTimeout(600);
await download("document-bare");
await page.screenshot({ path: `${OUT}/compare-png-page-after.png` });

// 문서용 연결선 펼침 끔 + 나눠 싣기 — 조각 PNG를 담은 ZIP 하나(같은 dpi), 출력 중엔 커서 가림막
await openModal();
await page.locator('[data-id="compare-png-toggle-info"]').click();
await page.locator('[data-id="compare-png-toggle-legend"]').click();
check("edge fan chip shows for document", await page.locator('[data-id="compare-png-toggle-edge-fan"]').isVisible());
await page.locator('[data-id="compare-png-toggle-edge-fan"]').click();
await page.locator('[data-id="png-export-print-width"]').fill("40");
await page.locator('[data-id="png-export-layout-split"]').click();
await page.waitForTimeout(500);
await modal.screenshot({ path: `${OUT}/compare-png-modal-split.png` });
const zipDownload = page.waitForEvent("download", { timeout: 60_000 });
await page.locator('[data-id="compare-png-download"]').click();
await page.waitForTimeout(300);
check("shield covers the canvas during export", (await page.locator('[data-id="compare-png-shield"]').count()) === 1);
const zipFile = await zipDownload;
check("split downloads one zip", zipFile.suggestedFilename().endsWith(".zip"), zipFile.suggestedFilename());
await zipFile.saveAs(`${OUT}/compare-png-split.zip`);
const zip = await JSZip.loadAsync(readFileSync(`${OUT}/compare-png-split.zip`));
const pieceDpis = await Promise.all(
  Object.values(zip.files).map(async (entry) => {
    const bytes = Buffer.from(await entry.async("uint8array"));
    const at = bytes.indexOf(Buffer.from("pHYs"));
    return at > 0 ? Math.round(bytes.readUInt32BE(at + 4) * 0.0254) : 0;
  }),
);
check("zip holds pieces at one dpi", pieceDpis.length >= 2 && pieceDpis.every((dpi) => dpi > 0 && dpi === pieceDpis[0]), `${pieceDpis.length} pieces · ${pieceDpis[0]} dpi`);
await page.waitForTimeout(1200);
check("shield leaves after export", (await page.locator('[data-id="compare-png-shield"]').count()) === 0);
// 다음 실행이 화면 그대로 기본값부터 보도록 기억을 지운다
await page.evaluate(() => window.localStorage.removeItem("bpm.comparePngExport"));

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASS` : `${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
