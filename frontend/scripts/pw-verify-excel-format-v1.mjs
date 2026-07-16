// Excel 출력 양식 1안 — 브라우저 실기동 검증.
// 스크래치 맵에 제어 픽스처(start·무라벨 디시전·라벨 디시전·기본/커스텀 end)를 넣고
// [data-id="export-excel"] 다운로드 → exceljs 파싱 → 4규칙(행 제거·flow-through·주석·No 연속) 단언.
// 실행 (frontend/ 에서): node scripts/pw-verify-excel-format-v1.mjs
// 전제: backend :8000(reset_db 시드), frontend :3000, playwright-core(--no-save)·exceljs(dependencies)
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "/tmp/pw-verify-excel-format-v1";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
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

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}

let mapId = null;
try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  const created = await api("/maps", {
    method: "POST",
    body: { name: `Excel Format V1 ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;

  // 픽스처: Start→Prepare→Par(무라벨 디시전)→{Branch B, Branch C}→Approve?(yes→Ship, no→End)→Ship→Archived
  const N = (id, title, node_type, sort_order, extra = {}) => ({
    id, title, node_type, pos_x: sort_order * 160, pos_y: 0, sort_order, ...extra,
  });
  const E = (id, source_node_id, target_node_id, label = "") => ({ id, source_node_id, target_node_id, label });
  // PUT /graph는 활성 체크아웃 보유를 강제(동시편집 가드) — 새 맵 생성만으론 체크아웃이 없어 먼저 획득.
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: false } });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        N("s", "Start", "start", 0),
        N("a", "Prepare", "process", 1),
        N("p", "Par", "decision", 2),
        N("b", "Branch B", "process", 3),
        N("c", "Branch C", "process", 4),
        N("d", "Approve?", "decision", 5),
        N("ship", "Ship", "process", 6),
        N("e", "End", "end", 7, { is_primary_end: true }),
        N("arch", "Archived", "end", 8),
      ],
      edges: [
        E("x1", "s", "a"), E("x2", "a", "p"), E("x3", "p", "b"), E("x4", "p", "c"),
        E("x5", "b", "d"), E("x6", "c", "d"),
        E("x7", "d", "ship", "yes"), E("x8", "d", "e", "no"), E("x9", "ship", "arch"),
      ],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(800);

  // 내보내기 3버튼은 인스펙터 "Map" 탭 안
  const exportVisible = await page.locator('[data-id="export-excel"]').isVisible().catch(() => false);
  if (!exportVisible) {
    await page.locator('button[aria-label="Map"]').first().click();
    await page.waitForSelector('[data-id="export-excel"]', { timeout: 5000 });
  }
  const dlPromise = page.waitForEvent("download");
  await page.locator('[data-id="export-excel"]').click();
  const dl = await dlPromise;
  const xlsxPath = `${OUT}/export.xlsx`;
  await dl.saveAs(xlsxPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = wb.worksheets[0];
  const rows = []; // { no, name, next }
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return;
    rows.push({ no: row.getCell(1).value, name: String(row.getCell(2).value ?? ""), next: String(row.getCell(16).value ?? "") });
  });

  check("규칙1: 무라벨 디시전(Par) 행 없음", rows.every((r) => !r.name.startsWith("Par")), rows.map((r) => r.name).join("|"));
  check("규칙2: Start 행은 정확히 1개", rows.filter((r) => r.name === "Start").length === 1);
  check("규칙3: 기본 End 행 없음·커스텀 end(Archived) 유지",
    rows.every((r) => r.name !== "End") && rows.some((r) => r.name === "Archived"));
  const prepare = rows.find((r) => r.name === "Prepare");
  check("규칙1: Prepare.next가 flow-through로 대상들", prepare?.next === "Branch B;Branch C", prepare?.next);
  const approve = rows.find((r) => r.name.startsWith("Approve?"));
  check("디시전 행 next는 기존 표기 유지(End 텍스트 포함)", approve?.next === "Ship:yes;End:no", approve?.next);
  check("규칙4: Ship에 [디시전No:yes] 주석", rows.some((r) => r.name === `Ship [${approve?.no}:yes]`),
    rows.map((r) => r.name).join("|"));
  check("규칙4: 삭제 행(기본 End) 주석 소멸", rows.every((r) => !r.name.includes(":no]")));
  check("No 재부여 1..n 연속", rows.map((r) => r.no).join(",") === rows.map((_, i) => i + 1).join(","),
    rows.map((r) => r.no).join(","));
  const header = sheet.getRow(4).values.slice(1, 17).map(String);
  check("헤더 16컬럼 무변경", header[0] === "No" && header[1] === "Name" && header[15] === "Next", header.join(","));
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("콘솔 에러 0", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
