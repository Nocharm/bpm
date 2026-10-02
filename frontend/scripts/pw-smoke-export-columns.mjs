// 내보내기 열 선택 스모크 — CSV 모달에서 열 하나 해제 → 다운로드 헤더에서 빠짐, Excel 모달 Columns 섹션 토글 →
// 해제한 열이 시트 헤더에서 빠짐. 설계: export-column-picker-design(2026-10-02).
//
// 실행 (frontend/ 에서):
//   bash:       BASE_URL=http://localhost:3000 node scripts/pw-smoke-export-columns.mjs
//   PowerShell: $env:BASE_URL="http://localhost:3000"; node scripts\pw-smoke-export-columns.mjs
// 전제: backend :8000 + frontend dev 서버(BASE_URL), playwright-core·exceljs 설치(npm i --no-save playwright-core).
// 캡처: 저장소 루트 .shots/export-columns-*.png (gitignore). 스크래치 맵 1개를 만들고 끝에 소프트삭제한다.
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, readFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "../.shots";
const OUT = "/tmp/pw-smoke-export-columns";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

// 32자 hex id — 노드/엣지 id는 버전을 넘어 전역 유니크(insecure context라 crypto.randomUUID 금지)
const rid = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// 내보내기 버튼은 인스펙터 "Map" 탭 안에 있다
async function ensureMapTab() {
  const visible = await page.locator('[data-id="export-csv"]').isVisible().catch(() => false);
  if (!visible) {
    await page.locator('button[aria-label="Map"]').first().click();
    await page.waitForSelector('[data-id="export-csv"]', { timeout: 5000 });
  }
}

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}

let mapId = null;
try {
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments - cannot supply owning_department");
  const map = await api("/maps", {
    method: "POST",
    body: { name: `Export Columns Smoke ${Date.now()}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = map.id;
  const versionId = map.versions[0].id;
  const [s, a, b, e] = [rid(), rid(), rid(), rid()];
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
        { id: a, title: "Review", node_type: "process", pos_x: 200, pos_y: 0, sort_order: 1, description: "check", gmp: "direct", input: "PR\nBudget", input_forms: "\nExcel" },
        { id: b, title: "Approve", node_type: "process", pos_x: 400, pos_y: 0, sort_order: 2 },
        { id: e, title: "End", node_type: "end", pos_x: 600, pos_y: 0, sort_order: 3, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: s, target_node_id: a, label: "" },
        { id: rid(), source_node_id: a, target_node_id: b, label: "" },
        { id: rid(), source_node_id: b, target_node_id: e, label: "" },
      ],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await ensureMapTab();

  // ── CSV: 모달 → Description 해제 → 다운로드 헤더에서 빠짐 ──
  await page.locator('[data-id="export-csv"]').click();
  await page.waitForSelector('[data-id="csv-export-modal"]', { timeout: 5000 });
  // 다시 가져오기에 필요한 열은 Clear로도 못 뺀다 — 잠금 열만 체크된 채 남는다
  await page.locator('[data-id="export-columns-csv-deselect-all"]').click();
  const lockedAfterClear = await page.evaluate(() =>
    [...document.querySelectorAll('[data-id="export-columns-csv"] input[type="checkbox"]')].filter((box) => !box.getAttribute("data-id").startsWith("export-columns-"))
      .filter((box) => box.checked)
      .map((box) => ({ key: box.getAttribute("data-id").replace("export-column-", ""), disabled: box.disabled })),
  );
  check(
    "CSV: Clear keeps exactly the import columns Name, Parallel, Next (locked)",
    lockedAfterClear.map((box) => box.key).join(",") === "name,parallel,next" && lockedAfterClear.every((box) => box.disabled),
    JSON.stringify(lockedAfterClear),
  );
  check(
    "CSV: the locked hint says why (importing back needs them)",
    /importing this file back/.test(await page.locator('[data-id="export-columns-csv-locked-hint"]').innerText()),
    await page.locator('[data-id="export-columns-csv-locked-hint"]').innerText(),
  );
  // 줄 정렬 짝 — Input을 담으면 Input_Flags·Input_Forms가 함께 고정되고, Input을 빼면 다시 풀린다
  const csvBox = (key) => page.locator(`[data-id="export-columns-csv"] [data-id="export-column-${key}"]`);
  await csvBox("input").click();
  const pairedOn = await Promise.all(["input_flags", "input_forms"].map(async (key) => (await csvBox(key).isChecked()) && (await csvBox(key).isDisabled())));
  await page.waitForTimeout(300);
  await page.locator('[data-id="csv-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-csv-cleared.png` });
  await csvBox("input").click();
  const pairedOff = await Promise.all(["input_flags", "input_forms"].map((key) => csvBox(key).isDisabled()));
  check(
    "CSV: Input locks Input_Flags and Input_Forms on, and unticking Input releases them",
    pairedOn.every(Boolean) && pairedOff.every((disabled) => !disabled),
    JSON.stringify({ pairedOn, pairedOff }),
  );

  // 묶음 일괄 체크/해제 — 머리 체크박스로 수행 지표 7열을 한 번에 끄고 켜고, 일부만 켜지면 머리는 중간 상태
  await page.locator('[data-id="export-columns-csv-select-all"]').click();
  const groupChecked = (group) =>
    page.evaluate(
      (g) =>
        [...document.querySelectorAll(`[data-id="export-columns-csv-group-${g}"] input[type="checkbox"]`)]
          .slice(1)
          .map((box) => box.checked),
      group,
    );
  const metricsToggle = page.locator('[data-id="export-columns-csv-group-metrics-toggle"]');
  await metricsToggle.click();
  const metricsOff = await groupChecked("metrics");
  await csvBox("fte").click();
  const isMixed = await metricsToggle.evaluate((box) => box.indeterminate && !box.checked);
  await page.waitForTimeout(300);
  await page.locator('[data-id="csv-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-csv-groups.png` });
  await metricsToggle.click();
  const metricsOn = await groupChecked("metrics");
  check(
    "CSV: the Metrics group header clears all 7, shows a mixed state for one, and selects all again",
    metricsOff.length === 7 && metricsOff.every((on) => !on) && isMixed && metricsOn.every(Boolean),
    JSON.stringify({ metricsOff, isMixed, metricsOn }),
  );
  await page.locator('[data-id="export-columns-csv-group-details-toggle"]').click();
  const detailsAfterClear = await groupChecked("details");
  check(
    "CSV: clearing the I/O group also releases the paired flag and form columns",
    detailsAfterClear.length === 7 && detailsAfterClear.every((on) => !on),
    JSON.stringify(detailsAfterClear),
  );
  check(
    "CSV: the Flow group header is locked (always included)",
    await page.locator('[data-id="export-columns-csv-group-flow-toggle"]').isDisabled(),
  );
  await page.locator('[data-id="export-columns-csv-select-all"]').click();
  await page.locator('[data-id="export-column-description"]').click();
  await page.waitForTimeout(300); // 체크 표시 페이드(150ms)가 끝난 뒤 찍는다
  await page.locator('[data-id="csv-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-csv.png` });
  const csvDownload = page.waitForEvent("download");
  await page.locator('[data-id="csv-export-download"]').click();
  const csvFile = `${OUT}/export.csv`;
  await (await csvDownload).saveAs(csvFile);
  const csvHeader = readFileSync(csvFile, "utf8").replace(/^﻿/, "").split("\r\n")[0].split(",");
  check(
    "CSV: unticked Description is left out, the other 24 columns stay",
    !csvHeader.includes("Description") && csvHeader[0] === "Name" && csvHeader.length === 24 && csvHeader.includes("GMP"),
    csvHeader.join(","),
  );

  // ── Excel: 모달 → Columns 펼침 → Groups 해제 → 다운로드 시트 헤더에서 빠짐 ──
  await page.locator('[data-id="export-excel"]').click();
  await page.waitForSelector('[data-id="excel-export-modal"]', { timeout: 5000 });
  await page.locator('[data-id="excel-format-map"]').click();
  await page.locator('[data-id="excel-export-columns-toggle"]').click();
  await page.waitForSelector('[data-id="export-columns-excel"]', { timeout: 5000 });
  // 맵을 다시 그릴 최소 열(No·Name·Type·Parallel·Next)은 Clear로도 못 뺀다
  await page.locator('[data-id="export-columns-excel-deselect-all"]').click();
  const excelLocked = await page.evaluate(() =>
    [...document.querySelectorAll('[data-id="export-columns-excel"] input[type="checkbox"]')].filter((box) => !box.getAttribute("data-id").startsWith("export-columns-"))
      .filter((box) => box.checked)
      .map((box) => ({ key: box.getAttribute("data-id").replace("export-column-", ""), disabled: box.disabled })),
  );
  check(
    "Excel: Clear keeps exactly the redraw columns No, Name, Type, Parallel, Next (locked)",
    excelLocked.map((box) => box.key).join(",") === "no,name,type,parallel,next" && excelLocked.every((box) => box.disabled),
    JSON.stringify(excelLocked),
  );
  await page.waitForTimeout(300);
  await page.locator('[data-id="excel-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-excel-cleared.png` });
  await page.locator('[data-id="export-columns-excel-select-all"]').click();
  await page.locator('[data-id="export-column-groups"]').click();
  await page.waitForTimeout(300); // 체크 표시 페이드(150ms)가 끝난 뒤 찍는다
  await page.locator('[data-id="excel-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-excel.png` });
  await page.waitForSelector('[data-id="excel-export-download"]:not([disabled])', { timeout: 8000 });
  const xlsxDownload = page.waitForEvent("download");
  await page.locator('[data-id="excel-export-download"]').click();
  const xlsxFile = `${OUT}/export.xlsx`;
  await (await xlsxDownload).saveAs(xlsxFile);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxFile);
  const xlsxHeader = workbook.worksheets[0].getRow(4).values.slice(1).map(String);
  check(
    "Excel: unticked Groups is left out, new Input/GMP/Parallel columns are present",
    !xlsxHeader.includes("Groups") && ["Input", "GMP", "Parallel"].every((h) => xlsxHeader.includes(h)),
    xlsxHeader.join(","),
  );

  // 선택 기억 — 모달을 다시 열면 Groups가 해제된 채로 남는다
  await page.locator('[data-id="export-excel"]').click();
  // 모달은 닫혀도 마운트가 유지돼 Columns 펼침 상태가 남는다 — 접혀 있을 때만 펼친다
  const columnsToggle = page.locator('[data-id="excel-export-columns-toggle"]');
  if ((await columnsToggle.getAttribute("aria-expanded")) !== "true") await columnsToggle.click();
  check(
    "Excel: the column selection is remembered on reopen",
    !(await page.locator('[data-id="export-column-groups"]').isChecked()),
  );
  await page.locator('[data-id="export-columns-excel-select-all"]').click();
  // 낮은 화면(노트북 브라우저 ~650px)에서도 Columns를 펼친 채 Download가 모달 안에 보인다 — 열 섹션이 줄어들며 안에서 스크롤
  const footerFits = [];
  for (const height of [900, 650, 600]) {
    await page.setViewportSize({ width: 1440, height });
    await page.waitForTimeout(250);
    const fit = await page.evaluate(() => {
      const modal = document.querySelector('[data-id="excel-export-modal"]').getBoundingClientRect();
      const download = document.querySelector('[data-id="excel-export-download"]').getBoundingClientRect();
      return download.bottom <= modal.bottom + 0.5 && download.top >= modal.top;
    });
    footerFits.push({ height, fit });
    if (height === 650) {
      await page.locator('[data-id="excel-export-modal"]').screenshot({ path: `${SHOTS}/export-columns-excel-650.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  check(
    "Excel: with Columns open, Download stays inside the modal at 900/650/600px tall viewports",
    footerFits.every((row) => row.fit),
    JSON.stringify(footerFits),
  );
  await page.keyboard.press("Escape");
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
