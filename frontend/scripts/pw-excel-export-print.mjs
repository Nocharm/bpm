// Excel 내보내기 인쇄용 문서 스모크 — API로 맵(시간·비용·여러 줄 IO·URL·라벨 분기)을 시드하고 Excel 창(두 형식,
// 열 펼침·접기, 열 끄고 켤 때 쉬머 전환 중간 프레임, 형식 기억, 다운로드 실패 안내)을 캡처한 뒤 두 형식 .xlsx를 내려받아
// exceljs로 인쇄 배치·고정·필터·글꼴·시간 셀·메타 줄을 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3062 BACKEND_URL=http://localhost:8062 node scripts/pw-excel-export-print.mjs
//   PW_LANG=ko|en(기본 ko). KEEP=1 이면 시드 맵을 지우지 않는다. 산출물은 저장소 루트 .shots/excel-print-*.png·*.xlsx (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import ExcelJS from "exceljs";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3062";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8062";
const LANG = process.env.PW_LANG ?? "ko";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `xl-${tag}-${key}`;
const nodes = [];
const edges = [];
const node = (key, title, x, y, extra = {}) => {
  nodes.push({ id: nid(key), title, node_type: "process", pos_x: x, pos_y: y, ...extra });
  return nid(key);
};
const edge = (key, source, target, extra = {}) => {
  edges.push({ id: nid(`e-${key}`), source_node_id: source, target_node_id: target, label: "", ...extra });
};
const START = node("start", "", 0, 100, { node_type: "start" });
const T1 = node("t1", "구매 요청서 작성 및 예산 코드 확인", 160, 80, {
  description: "요청 부서가 품목·수량·납기를 적고 예산 코드를 확인한다. 금액이 크면 사전 협의 메일을 첨부한다.",
  assignee_role: "요청자",
  system: "SAP",
  duration: "1.30",
  touch_time: "0.45",
  cost_krw: "1250000",
  annual_count: "1200",
  input: "구매 요청서\n견적서",
  output: "예산 확인서",
  url: "https://example.com/guide",
  url_label: "작성 가이드",
});
const T2 = node("t2", "요청 접수", 420, 80, { assignee_role: "구매 담당", duration: "0.20", touch_time: "0.10" });
const D = node("d", "금액 1억 원 초과 여부", 680, 80, { node_type: "decision" });
const T3 = node("t3", "경영진 결재", 940, 0, { assignee_role: "대표이사", duration: "24" });
const T4 = node("t4", "팀장 결재", 940, 180, { assignee_role: "구매팀장", duration: "2.15" });
const END = node("end", "", 1200, 100, { node_type: "end" });
edge("1", START, T1);
edge("2", T1, T2);
edge("3", T2, D);
edge("4", D, T3, { label: "예" });
edge("5", D, T4, { label: "아니오" });
edge("6", T3, END);
edge("7", T4, END);

const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith("Excel print smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
if (!owning) throw new Error("no org_path in directory — seed the directory first");
const map = await api("POST", "/api/maps", {
  name: `Excel print smoke R&D 구매 ${tag}`,
  owning_department: owning,
  visibility: "private",
});
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
check("seeded map", true, `map ${map.id} v${draft.id}`);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript((lang) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", lang);
}, LANG);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  window.localStorage.removeItem("bpm.excelExportFormat");
  window.localStorage.removeItem("bpm.exportColumns.excel");
});

const modal = page.locator('[data-id="excel-export-modal"]');
const MAP_TAB_LABEL = LANG === "ko" ? "맵" : "Map";
const openModal = async () => {
  const button = page.locator('[data-id="export-excel"]');
  if (!(await button.isVisible())) {
    await page.locator(".react-flow__pane").first().click({ position: { x: 20, y: 20 } });
    await page.locator(`button[aria-label="${MAP_TAB_LABEL}"]`).first().click();
  }
  await button.click();
  await modal.waitFor();
  await page.locator('[data-id="excel-export-preview"]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
};
const shot = (name) => modal.screenshot({ path: `${OUT}/excel-print-${name}.png` });
const download = async (name) => {
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator('[data-id="excel-export-download"]').click()]);
  const path = `${OUT}/excel-print-${name}.xlsx`;
  await file.saveAs(path);
  await modal.waitFor({ state: "detached" });
  return path;
};

// 1) Process Map(기본) — 열 접힘
await openModal();
check("defaults to Process Map", (await page.locator('[data-id="excel-format-map"]').getAttribute("aria-pressed")) === "true");
check("modal is portaled to body", await page.evaluate(() => document.querySelector('[data-id="excel-export-modal"]')?.parentElement?.parentElement === document.body));
check("preview shows meta rows", (await page.locator('[data-id="excel-export-preview-meta"]').innerText()).includes("Excel print smoke"));
await shot("map-collapsed");

// Escape는 한 번에 창 하나만 닫는다(중복 리스너 제거)
await page.keyboard.press("Escape");
await modal.waitFor({ state: "detached" });
check("Escape closes the dialog", true);

// 2) 열 펼침 + Description 끄기(쉬머 퇴장 중간 프레임) → 다시 켜기(등장 중간 프레임)
await openModal();
await page.locator('[data-id="excel-export-columns-toggle"]').click();
await page.waitForTimeout(300);
await shot("map-expanded");
const descCol = page.locator('[data-id="excel-export-preview-col-description"]');
await page.locator('[data-id="export-column-description"]').click();
await page.waitForTimeout(160);
check("column leaving runs shimmer-out", ((await descCol.getAttribute("class")) ?? "").includes("shimmer-out"));
await shot("map-col-out-mid");
await page.waitForTimeout(600);
check("column removed after transition", (await descCol.count()) === 0);
await shot("map-col-off");
await page.locator('[data-id="export-column-description"]').click();
await page.waitForTimeout(160);
check("column entering runs shimmer-in", ((await descCol.getAttribute("class")) ?? "").includes("shimmer-in"));
await shot("map-col-in-mid");
await page.waitForTimeout(600);
await page.locator('[data-id="excel-export-columns-toggle"]').click();
const mapXlsx = await download("map");

// 3) WBS — 형식 기억
await openModal();
await page.locator('[data-id="excel-format-wbs"]').click();
await page.locator('[data-id="excel-export-preview-col-wbs-task"]').waitFor({ timeout: 20_000 });
await page.waitForTimeout(600);
await shot("wbs-collapsed");
await page.locator('[data-id="excel-export-columns-toggle"]').click();
await page.waitForTimeout(300);
await shot("wbs-expanded");
await page.locator('[data-id="excel-export-columns-toggle"]').click();
const wbsXlsx = await download("wbs");
await openModal();
check("remembers WBS format", (await page.locator('[data-id="excel-format-wbs"]').getAttribute("aria-pressed")) === "true");
await page.keyboard.press("Escape");
await modal.waitFor({ state: "detached" });

// 4) 다운로드 실패 안내 — exceljs 청크를 막은 새 페이지에서 Download
const failPage = await ctx.newPage();
await failPage.route(/exceljs/, (route) => route.abort());
await failPage.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await failPage.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await failPage.waitForTimeout(1500);
{
  const button = failPage.locator('[data-id="export-excel"]');
  if (!(await button.isVisible())) {
    await failPage.locator(".react-flow__pane").first().click({ position: { x: 20, y: 20 } });
    await failPage.locator(`button[aria-label="${MAP_TAB_LABEL}"]`).first().click();
  }
  await button.click();
  await failPage.locator('[data-id="excel-export-preview"]').waitFor({ timeout: 20_000 });
  await failPage.locator('[data-id="excel-export-download"]').click();
  const error = failPage.locator('[data-id="excel-export-download-error"]');
  const shown = await error.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("download failure shows an inline error and keeps the dialog", shown);
  await failPage.locator('[data-id="excel-export-modal"]').screenshot({ path: `${OUT}/excel-print-download-error.png` });
}
await failPage.close();

// ---- 파일 검사 ----
const dumpSheet = async (path) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = wb.worksheets[0];
  const headerRow = sheet.views[0].ySplit;
  const header = sheet.getRow(headerRow).values.slice(1).map(String);
  const metaRows = [];
  for (let n = 1; n < headerRow - 1; n += 1) metaRows.push([sheet.getRow(n).getCell(1).value, sheet.getRow(n).getCell(3).value]);
  const durationCol = header.indexOf("Duration (h:mm)") + 1;
  // exceljs는 시간 서식 숫자 셀을 읽을 때 Date(1899-12-30 기준)로 돌려준다 — 일 단위 숫자로 되돌려 비교한다
  const toSerial = (value) => (value instanceof Date ? (value.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000 : value);
  let durationRow = null;
  sheet.eachRow((row, n) => {
    if (n > headerRow && durationRow === null && toSerial(row.getCell(durationCol).value) > 0) durationRow = row;
  });
  const dump = {
    sheet: sheet.name,
    title: wb.title,
    creator: wb.creator,
    pageSetup: (({ paperSize, orientation, fitToPage, fitToWidth, fitToHeight, margins, printTitlesRow }) => ({
      paperSize, orientation, fitToPage, fitToWidth, fitToHeight, margins, printTitlesRow,
    }))(sheet.pageSetup),
    headerFooter: sheet.headerFooter,
    views: sheet.views,
    autoFilter: sheet.autoFilter,
    headerFont: sheet.getRow(headerRow).getCell(2).font,
    headerFill: sheet.getRow(headerRow).getCell(2).fill?.fgColor,
    bodyFont: sheet.getRow(headerRow + 1).getCell(2).font,
    bodyAlignment: sheet.getRow(headerRow + 1).getCell(2).alignment,
    duration: durationRow ? { value: toSerial(durationRow.getCell(durationCol).value), numFmt: durationRow.getCell(durationCol).numFmt } : null,
    metaRows,
  };
  console.log(`--- ${path}\n${JSON.stringify(dump, null, 1)}`);
  return dump;
};
const mapDump = await dumpSheet(mapXlsx);
const wbsDump = await dumpSheet(wbsXlsx);
for (const [name, dump] of [["map", mapDump], ["wbs", wbsDump]]) {
  check(`${name}: A4 landscape fit to width`, dump.pageSetup.paperSize === 9 && dump.pageSetup.orientation === "landscape" && dump.pageSetup.fitToPage === true && dump.pageSetup.fitToWidth === 1 && dump.pageSetup.fitToHeight === 0);
  check(`${name}: header font Malgun Gothic bold`, dump.headerFont?.name === "Malgun Gothic" && dump.headerFont?.bold === true);
  check(`${name}: body font Malgun Gothic 10`, dump.bodyFont?.name === "Malgun Gothic" && dump.bodyFont?.size === 10);
  check(`${name}: duration [h]:mm 1.30 = 1.5h`, dump.duration?.numFmt === "[h]:mm" && Math.abs(dump.duration.value - 1.5 / 24) < 1e-9, JSON.stringify(dump.duration));
  check(`${name}: header & escaped`, dump.headerFooter.oddHeader?.includes("R&&D"));
}
check("map: frozen through Name", mapDump.views[0].xSplit === 2);
check("wbs: frozen through Task", wbsDump.views[0].xSplit === 3);

await browser.close();
if (!KEEP) await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
