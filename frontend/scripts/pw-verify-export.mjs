// 숫자 파라미터 5종 + Excel/CSV 내보내기 — 브라우저 실기동 통합 검증 (Task 8).
// 6시나리오: ①파라미터 입력·정규화·노드칩 ②새로고침 저장왕복 ③CSV 내보내기→재임포트 diff 0
// ④Excel 내보내기(서브프로세스 재귀·outlineLevel·하이퍼링크·숫자셀) ⑤콘솔에러 0
// ⑥[Task3 이월] 디시전 노드 파라미터 칩의 마름모 밖 overflow 여부(boundingBox 판정, 스크린샷 증거)
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-export.mjs
//   PowerShell: node scripts\pw-verify-export.mjs
// 전제:
//   backend :8000 — cd backend && .venv/bin/python -m scripts.reset_db && .venv/bin/uvicorn app.main:app --port 8000
//     (auth_enabled 기본 False + dev_enforce_permissions 기본 False → 로컬은 전원 sysadmin, 별도 env 불필요)
//   frontend :3000 — cd frontend && npm run dev
//   playwright-core / exceljs 설치 — npm i --no-save playwright-core (exceljs는 Task 7에서 이미 dependencies에 있음)
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전 pkill -f "next dev" 후 재기동.
//   - dev.db 오염: 이 스크립트는 스크래치 맵 1개를 만들고 끝에 소프트삭제한다(다른 pw-verify-*.mjs와 동일 수준).
//     기존 데모 시드(맵 2)는 읽기 전용으로만 사용 — 변형하지 않는다.
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync, readFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-export";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, reason) => console.log(`SKIP ${name} — ${reason}`);

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

// ── 헬퍼 ────────────────────────────────────────────────────────────
const api = (path, { method = "GET", body, user = "admin.sys" } = {}) =>
  page.evaluate(
    async ({ path, method, body, user }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body, user },
  );

// 32자 hex id — edges/nodes.id는 버전을 넘어 전역 유니크해야 한다(소프트삭제된 이전 실행 행과도 충돌 가능).
// insecure context라 crypto.randomUUID 금지 (CLAUDE.md).
const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function waitForCondition(fn, { timeout = 8000, interval = 300 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

const openEditor = async (mapId, versionId) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
};

// 인스펙터가 Properties 탭이 아니면 전환 — 노드 클릭 직후에도 다른 탭이 남아있을 수 있음
async function ensurePropertiesTab() {
  const paramVisible = await page.locator('[data-id="inspector-param-duration"]').isVisible().catch(() => false);
  if (!paramVisible) {
    await page.locator('button[aria-label="Properties"]').first().click();
    await page.waitForSelector('[data-id="inspector-param-duration"]', { timeout: 5000 });
  }
}

// 내보내기 3버튼(PNG/Excel/CSV)은 인스펙터 "Map" 탭 안에 있다 (Task 7)
async function ensureMapTab() {
  const exportVisible = await page.locator('[data-id="export-csv"]').isVisible().catch(() => false);
  if (!exportVisible) {
    await page.locator('button[aria-label="Map"]').first().click();
    await page.waitForSelector('[data-id="export-csv"]', { timeout: 5000 });
  }
}

// 노드 카드의 파라미터 칩 컨테이너 — NodeParams 렌더 div(flex flex-wrap gap-x-2), NodeFields와 구분되는 유일 클래스 조합
const paramChipsLocator = (nodeSel) => page.locator(`${nodeSel} div.flex.flex-wrap.gap-x-2`);

// ── 서버 프로브 ────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  console.error('  start it: cd frontend && npm run dev   (kill zombies first: pkill -f "next dev")');
  await browser.close();
  process.exit(1);
}
const backendStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } });
    return res.status;
  } catch {
    return 0;
  }
});
if (backendStatus !== 200) {
  console.error(`FATAL backend not reachable through ${BASE}/api (GET /api/maps → ${backendStatus})`);
  console.error("  start it: cd backend && .venv/bin/uvicorn app.main:app --port 8000");
  await browser.close();
  process.exit(1);
}

let mapAId = null;

try {
  // ── 시드 — 스크래치 맵 A: Start → Widget Step(process, 빈 파라미터) → End ──────────
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — cannot supply owning_department");

  const mapA = await api("/maps", {
    method: "POST",
    body: { name: `Params Export PW ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;
  const v1 = mapA.versions[0].id;

  const sId = rid();
  const pId = rid();
  const eId = rid();
  const dId = rid();
  const seedGraph = {
    nodes: [
      { id: sId, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
      { id: pId, title: "Widget Step", node_type: "process", pos_x: 260, pos_y: 200, sort_order: 1 },
      { id: eId, title: "End", node_type: "end", pos_x: 520, pos_y: 200, sort_order: 2, is_primary_end: true },
    ],
    edges: [
      { id: rid(), source_node_id: sId, target_node_id: pId },
      { id: rid(), source_node_id: pId, target_node_id: eId },
    ],
    groups: [],
  };
  await api(`/versions/${v1}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${v1}/graph`, { method: "PUT", body: seedGraph });

  await openEditor(mapAId, v1);
  check("editor loads scratch map (3 nodes on canvas)", (await page.locator(".react-flow__node").count()) === 3);

  // ── ① 파라미터 5입력 → blur → duration H.MM 정규화 + 노드칩 5개 ──────────────
  const pSel = `.react-flow__node[data-id="${pId}"]`;
  await page.locator(pSel).click();
  await ensurePropertiesTab();

  const inputs = [
    ["duration", "0.75", "1.15"],
    ["headcount", "2", "2"],
    ["etf", "1.5", "1.5"],
    ["cost", "300", "300"],
    ["extra", "7", "7"],
  ];
  for (const [key, raw] of inputs) {
    const loc = page.locator(`[data-id="inspector-param-${key}"]`);
    await loc.fill(raw);
    await loc.blur();
  }
  // autosave 디바운스(2s) 이후 서버 반영을 폴링 — 고정 sleep 대신 실제 저장 완료를 기다림
  const savedDuration = await waitForCondition(async () => {
    const g = await api(`/versions/${v1}/graph`);
    return g.nodes.find((n) => n.id === pId)?.duration === "1.15";
  });
  check("PUT saved: duration normalizes 0.75 → 1.15 (60분 이월)", savedDuration);

  for (const [key, , expected] of inputs) {
    const val = await page.locator(`[data-id="inspector-param-${key}"]`).inputValue();
    check(`inspector shows normalized ${key} = "${expected}"`, val === expected, `got "${val}"`);
  }

  const chips1 = paramChipsLocator(pSel);
  const chipCount1 = await chips1.locator("span").count();
  const chipText1 = await chips1.innerText().catch(() => "");
  check(
    "node card shows 5 param chips (icon+value)",
    chipCount1 === 5 && ["1.15", "2", "1.5", "300", "7"].every((v) => chipText1.includes(v)),
    `count=${chipCount1} text="${chipText1.replace(/\n/g, " ")}"`,
  );
  await page.screenshot({ path: `${SHOTS}/01-params-filled.png` });

  // ── ② 새로고침 후 값 유지(저장 왕복) ──────────────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.locator(pSel).click();
  await ensurePropertiesTab();
  let persistedOk = true;
  for (const [key, , expected] of inputs) {
    const val = await page.locator(`[data-id="inspector-param-${key}"]`).inputValue();
    if (val !== expected) persistedOk = false;
  }
  check("reload: inspector params persisted", persistedOk);
  const chips2 = paramChipsLocator(pSel);
  const chipCount2 = await chips2.locator("span").count();
  check("reload: node card still shows 5 param chips", chipCount2 === 5, `count=${chipCount2}`);

  // ── ③ CSV 다운로드 → 13컬럼·숫자값 확인 → 재임포트 → 머지 프리뷰 변경 0 ────────
  await ensureMapTab();
  const csvDlPromise = page.waitForEvent("download");
  await page.locator('[data-id="export-csv"]').click();
  const csvDl = await csvDlPromise;
  const csvPath = `${SHOTS}/export.csv`;
  await csvDl.saveAs(csvPath);
  const csvText = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const csvLines = csvText.split("\r\n").filter((l) => l.length > 0);
  const header = csvLines[0]?.split(",") ?? [];
  const expectedHeader = [
    "Name", "Description", "Assignee", "Department", "System", "Duration",
    "Headcount", "ETF", "Cost", "Extra", "URL", "URL_Label", "Next",
  ];
  check(
    "CSV header has 13 columns in expected order",
    header.length === 13 && expectedHeader.every((h, i) => header[i] === h),
    header.join(","),
  );
  const colIdx = Object.fromEntries(header.map((h, i) => [h, i]));
  const widgetRow = csvLines.slice(1).find((l) => l.startsWith("Widget Step,"))?.split(",");
  check(
    "CSV row carries the 5 normalized numeric values",
    widgetRow !== undefined &&
      widgetRow[colIdx.Duration] === "1.15" &&
      widgetRow[colIdx.Headcount] === "2" &&
      widgetRow[colIdx.ETF] === "1.5" &&
      widgetRow[colIdx.Cost] === "300" &&
      widgetRow[colIdx.Extra] === "7",
    widgetRow?.join(","),
  );

  // 재임포트 — 다운로드한 CSV를 그대로 같은 맵에 붙여넣기(왕복)
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-paste-toggle"]').click();
  await page.locator('[data-id="csv-paste-input"]').fill(csvText);
  await page.waitForTimeout(300);
  const summary = await page.locator('[data-id="csv-import-section"]').innerText();
  check(
    "re-import preview reports 0 added / 0 removed (round-trip diff 0)",
    summary.includes("0 added") && summary.includes("0 removed"),
    summary.split("\n").find((l) => l.includes("added")) ?? summary.slice(0, 80),
  );
  await page.locator('[data-id="csv-import-continue"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]');
  await page.locator('[data-id="csv-import-apply"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(400);

  const gAfterReimport = await api(`/versions/${v1}/graph`);
  const pAfter = gAfterReimport.nodes.find((n) => n.title === "Widget Step");
  check(
    "graph unchanged after CSV round-trip apply",
    pAfter?.duration === "1.15" && pAfter?.headcount === "2" && pAfter?.etf === "1.5" &&
      pAfter?.cost === "300" && pAfter?.extra === "7" && gAfterReimport.nodes.length === 3,
    `nodes=${gAfterReimport.nodes.length} duration=${pAfter?.duration}`,
  );

  // ── URL + 디시전 노드 추가(파라미터 5종) — Map A는 스크래치라 자유롭게 변형 ────
  const gForD = await api(`/versions/${v1}/graph`);
  const pNode = gForD.nodes.find((n) => n.title === "Widget Step");
  pNode.url = "https://example.com/doc";
  pNode.url_label = "Doc";
  gForD.nodes.push({
    id: dId, title: "Approve?", node_type: "decision", pos_x: 260, pos_y: 420, sort_order: 3,
    duration: "2.30", headcount: "5", etf: "3.75", cost: "1200", extra: "9",
  });
  await api(`/versions/${v1}/graph`, {
    method: "PUT",
    body: { nodes: gForD.nodes, edges: gForD.edges, groups: gForD.groups },
  });

  // ── Map A Excel 내보내기 — 하이퍼링크 + 숫자 셀 단언(제어된 데이터로 정확한 값 검증) ──
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);

  await ensureMapTab();
  const xlsxDlPromiseA = page.waitForEvent("download");
  await page.locator('[data-id="export-excel"]').click();
  const xlsxDlA = await xlsxDlPromiseA;
  const xlsxPathA = `${SHOTS}/export-mapA.xlsx`;
  await xlsxDlA.saveAs(xlsxPathA);
  const wbA = new ExcelJS.Workbook();
  await wbA.xlsx.readFile(xlsxPathA);
  const sheetA = wbA.worksheets[0];
  const headerRowA = sheetA.getRow(4).values.slice(1).map(String);
  const expectedXlsxHeader = [
    "No", "Name", "Type", "Description", "Assignee", "Department", "System", "Duration (h)",
    "Headcount", "ETF", "Cost", "Extra", "URL", "Groups", "Next",
  ];
  check(
    "Excel header row (row 4) has 15 expected columns",
    expectedXlsxHeader.every((h, i) => headerRowA[i] === h),
    headerRowA.join(","),
  );
  let widgetXlsxRow = null;
  sheetA.eachRow({ includeEmpty: false }, (row) => {
    if (row.getCell(2).value === "Widget Step") widgetXlsxRow = row;
  });
  check(
    "Excel numeric cells (duration/headcount/etf/cost/extra) are real numbers",
    widgetXlsxRow !== null &&
      typeof widgetXlsxRow.getCell(8).value === "number" && widgetXlsxRow.getCell(8).value === 1.15 &&
      typeof widgetXlsxRow.getCell(9).value === "number" && widgetXlsxRow.getCell(9).value === 2 &&
      typeof widgetXlsxRow.getCell(10).value === "number" && widgetXlsxRow.getCell(10).value === 1.5 &&
      typeof widgetXlsxRow.getCell(11).value === "number" && widgetXlsxRow.getCell(11).value === 300 &&
      typeof widgetXlsxRow.getCell(12).value === "number" && widgetXlsxRow.getCell(12).value === 7,
    widgetXlsxRow
      ? [8, 9, 10, 11, 12].map((c) => `${c}:${widgetXlsxRow.getCell(c).value}(${typeof widgetXlsxRow.getCell(c).value})`).join(" ")
      : "row not found",
  );
  const urlCell = widgetXlsxRow?.getCell(13);
  check(
    "Excel hyperlink cell carries {text, hyperlink}",
    urlCell?.value?.hyperlink === "https://example.com/doc" && urlCell?.value?.text === "Doc",
    JSON.stringify(urlCell?.value),
  );

  // ── ⑥ [Task 3 이월] 디시전 노드 — 파라미터 3개 이상, 칩이 마름모 밖으로 넘치는지 실측 ──
  const dSel = `.react-flow__node[data-id="${dId}"]`;
  await page.locator(dSel).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const dChips = paramChipsLocator(dSel);
  const dChipCount = await dChips.locator("span").count();
  check("decision node renders param chips (>=3 filled)", dChipCount >= 3, `count=${dChipCount}`);
  await page.locator(dSel).screenshot({ path: `${SHOTS}/06-decision-params.png` });
  const diamondBox = await page.locator(`${dSel} .rotate-45`).boundingBox();
  const contentBox = await page.locator(`${dSel} .max-w-20`).boundingBox();
  if (diamondBox && contentBox) {
    // 마름모(회전한 정사각형)의 대각선 길이 D = diamondBox.width(=height, 회전 후 AABB).
    // 중심에 놓인 축정렬 박스(w×h)가 마름모 안에 완전히 들어가는 정확한 조건은 w+h <= D
    // (경계식 |x|/(D/2)+|y|/(D/2)<=1에서 코너 (w/2,h/2) 대입 유도).
    const D = diamondBox.width;
    const sum = contentBox.width + contentBox.height;
    const withinDiamond = sum <= D;
    check(
      "decision node param chips stay within the rhombus outline (Task 3 carryover)",
      withinDiamond,
      `diamond D=${D.toFixed(1)}px, content ${contentBox.width.toFixed(1)}x${contentBox.height.toFixed(1)} (sum=${sum.toFixed(1)}) — screenshot: ${SHOTS}/06-decision-params.png`,
    );
  } else {
    check("decision node param chips stay within the rhombus outline (Task 3 carryover)", false, "could not measure boundingBox");
  }

  // ── ④ Map 2(Employee Onboarding, 서브프로세스 데모) Excel — 재귀 인라인·outlineLevel ──
  // 읽기 전용 검증만 — 이 맵은 변형하지 않는다(공유 데모 시드 보존).
  const mapList = await api("/maps");
  const map2 = mapList.find((m) => m.name === "Employee Onboarding");
  if (!map2) {
    skip("Excel export on subprocess demo map (map 2)", "seed map 'Employee Onboarding' not found — reset_db not run?");
  } else {
    const map2Detail = await api(`/maps/${map2.id}`);
    const draftV = map2Detail.versions.find((v) => v.label === "Release 6");
    if (!draftV) {
      skip("Excel export on subprocess demo map (map 2)", "draft version 'Release 6' not found on map 2");
    } else {
      await openEditor(map2.id, draftV.id);
      await ensureMapTab();
      const xlsxDlPromise2 = page.waitForEvent("download");
      await page.locator('[data-id="export-excel"]').click();
      const xlsxDl2 = await xlsxDlPromise2;
      const xlsxPath2 = `${SHOTS}/export-map2.xlsx`;
      await xlsxDl2.saveAs(xlsxPath2);
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.readFile(xlsxPath2);
      const sheet2 = wb2.worksheets[0];

      let dataRows = 0;
      let maxOutline = 0;
      let sawSubprocessTitle = false;
      sheet2.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber <= 4) return; // 1=title 2=meta 3=blank 4=header
        dataRows += 1;
        maxOutline = Math.max(maxOutline, row.outlineLevel ?? 0);
        const name = row.getCell(2).value;
        if (name === "Order Fulfillment" || name === "Procurement Flow") sawSubprocessTitle = true;
      });
      check(
        "map 2 Excel export has recursively-inlined subprocess rows",
        dataRows >= 5 && sawSubprocessTitle,
        `dataRows=${dataRows} sawSubprocessTitle=${sawSubprocessTitle}`,
      );
      check("map 2 Excel export has depth>0 rows (outlineLevel from subprocess inlining)", maxOutline > 0, `maxOutline=${maxOutline}`);
    }
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 시드 정리 — 소프트삭제(휴지통). 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
  // 맵 2(Employee Onboarding)는 읽기만 했으므로 정리 불필요.
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
