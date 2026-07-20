// Excel 내보내기 2안(WBS) + 형식 선택 모달 — 브라우저 실기동 검증 (Task 5).
// 부모 맵 A(스크래치)+자식 맵 B(게시+SP 지정)를 만들고 모달을 열어 Process Map(1안 회귀)과
// WBS(레벨 컬럼) 양쪽을 순서대로 다운로드·파싱해 12체크를 단언한다.
// 구현 뼈대는 pw-verify-excel-format-v1.mjs(맵 생성·checkout·다운로드 파싱)를 복제하고
// 게시+SP 지정 API 시퀀스는 pw-verify-sp-params.mjs의 publishVersion 절차를 그대로 이식했다.
// 실행 (frontend/ 에서): node scripts/pw-verify-excel-wbs.mjs
// 전제: backend :8000(reset_db 시드), frontend :3000, playwright-core(--no-save)·exceljs(dependencies)
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "/tmp/pw-verify-excel-wbs";
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

// 게시 체인 — checkout→graph PUT은 호출부에서, 여기는 승인자 등록→submit→approve→publish
// (pw-verify-sp-params.mjs publishVersion 미러).
async function publishVersion(mapId, versionId, approver) {
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: [approver] } });
  await api(`/versions/${versionId}/submit`, { method: "POST" });
  await api(`/versions/${versionId}/approve`, { method: "POST", user: approver });
  await api(`/versions/${versionId}/publish`, { method: "POST" });
}

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
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
  await browser.close();
  process.exit(1);
}

let mapAId = null;
let mapBId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees — approval quorum impossible");

  // ═══ 자식 맵 B — Start→Pick items→Pack items→End(기본), 게시 + SP 지정 ═══
  const mapB = await api("/maps", {
    method: "POST",
    body: { name: `Excel WBS Child B ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapBId = mapB.id;
  const vB = mapB.versions[0].id;
  const N = (id, title, node_type, sort_order, extra = {}) => ({
    id, title, node_type, pos_x: sort_order * 160, pos_y: 0, sort_order, ...extra,
  });
  const E = (id, source_node_id, target_node_id, label = "") => ({ id, source_node_id, target_node_id, label });

  await api(`/versions/${vB}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vB}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        N("bs", "Start", "start", 0),
        N("bp1", "Pick items", "process", 1),
        N("bp2", "Pack items", "process", 2),
        N("be", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [E("bx1", "bs", "bp1"), E("bx2", "bp1", "bp2"), E("bx3", "bp2", "be")],
      groups: [],
    },
  });
  await publishVersion(mapBId, vB, approver);
  const mapBAfterPublish = await api(`/maps/${mapBId}`);
  check("map B: v1 published", mapBAfterPublish.versions.find((v) => v.id === vB)?.status === "published");

  await api(`/maps/${mapBId}/subprocess-designation`, {
    method: "PUT",
    body: { department: "Owning Anchor Division", assignee: "", system: "", duration: "", cost_krw: "", cost_usd: "", headcount: "", url: "", url_label: "" },
  });
  const mapBDesignated = await api(`/maps/${mapBId}`);
  check("map B: subprocess designated", mapBDesignated.sp_designated_at != null);

  // ═══ 부모 맵 A — Start→Prepare→SubWork(SP→B)→Approve?(yes→Ship,no→End)→Ship→End(기본) ═══
  const mapA = await api("/maps", {
    method: "POST",
    body: { name: `Excel WBS Parent A ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;
  const vA = mapA.versions[0].id;

  await api(`/versions/${vA}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vA}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        N("as", "Start", "start", 0),
        N("ap", "Prepare", "process", 1),
        N("asub", "SubWork", "subprocess", 2, { linked_map_id: mapBId, follow_latest: true, linked_version_id: null }),
        N("ad", "Approve?", "decision", 3),
        N("aship", "Ship", "process", 4),
        N("ae", "End", "end", 5, { is_primary_end: true }),
      ],
      edges: [
        E("ax1", "as", "ap"), E("ax2", "ap", "asub"), E("ax3", "asub", "ad"),
        E("ax4", "ad", "aship", "yes"), E("ax5", "ad", "ae", "no"), E("ax6", "aship", "ae"),
      ],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapAId}?version=${vA}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(800);

  const exportVisible = await page.locator('[data-id="export-excel"]').isVisible().catch(() => false);
  if (!exportVisible) {
    await page.locator('button[aria-label="Map"]').first().click();
    await page.waitForSelector('[data-id="export-excel"]', { timeout: 5000 });
  }

  // ── 체크1: Excel 버튼 → 모달 표시(즉시 다운로드 아님) ──
  await page.locator('[data-id="export-excel"]').click();
  await page.waitForSelector('[data-id="excel-export-modal"]', { timeout: 5000 });
  check("체크1: Excel 버튼 클릭 → 모달 표시", await page.locator('[data-id="excel-export-modal"]').isVisible());

  // ── 체크2: 기본 탭 Process Map 미리보기 렌더("Prepare" 등장) ──
  await page.waitForSelector('[data-id="excel-export-modal"] :text("Prepare")', { timeout: 8000 }).catch(() => {});
  const prepareInPreview = await page
    .locator('[data-id="excel-export-modal"]')
    .locator("text=Prepare")
    .first()
    .isVisible()
    .catch(() => false);
  check("체크2: Process Map 미리보기에 Prepare 렌더", prepareInPreview);

  // ── 체크3: Process Map Download → xlsx 파싱(시트명·헤더 16컬럼·SubWork 행·자식 잎 들여쓰기) ──
  const dlPromise1 = page.waitForEvent("download");
  await page.waitForSelector('[data-id="excel-export-download"]:not([disabled])', { timeout: 8000 });
  await page.locator('[data-id="excel-export-download"]').click();
  const dl1 = await dlPromise1;
  const mapXlsxPath = `${OUT}/export-map.xlsx`;
  await dl1.saveAs(mapXlsxPath);

  const wbMap = new ExcelJS.Workbook();
  await wbMap.xlsx.readFile(mapXlsxPath);
  const mapSheet = wbMap.worksheets[0];
  check("체크3a: 시트명 Process Map", mapSheet.name === "Process Map", mapSheet.name);
  const mapHeader = mapSheet.getRow(4).values.slice(1, 17).map(String);
  check(
    "체크3b: 헤더 16컬럼",
    mapHeader.length === 16 && mapHeader[0] === "No" && mapHeader[1] === "Name" && mapHeader[15] === "Next",
    mapHeader.join(","),
  );
  const mapRows = [];
  mapSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return;
    mapRows.push({ name: String(row.getCell(2).value ?? ""), indent: row.getCell(2).alignment?.indent ?? 0 });
  });
  const subWorkRow = mapRows.find((r) => r.name === "SubWork");
  const pickItemsRow = mapRows.find((r) => r.name === "Pick items");
  check("체크3c: SubWork 행 존재", subWorkRow !== undefined, mapRows.map((r) => r.name).join("|"));
  check(
    "체크3d: 자식 잎(Pick items) 들여쓰기 행(1안 회귀)",
    pickItemsRow !== undefined && pickItemsRow.indent > 0,
    `indent=${pickItemsRow?.indent}`,
  );

  // ── 체크4: 모달 재오픈 → WBS 탭 클릭 → 미리보기 렌더("Level 1" 등장) ──
  await page.locator('[data-id="export-excel"]').click();
  await page.waitForSelector('[data-id="excel-export-modal"]', { timeout: 5000 });
  await page.locator('[data-id="excel-format-wbs"]').click();
  await page.waitForSelector('[data-id="excel-export-modal"] :text("Level 1")', { timeout: 8000 }).catch(() => {});
  const level1InPreview = await page
    .locator('[data-id="excel-export-modal"]')
    .locator("text=Level 1")
    .first()
    .isVisible()
    .catch(() => false);
  check("체크4: 모달 재오픈+WBS 탭 → Level 1 헤더 렌더", level1InPreview);

  // ── 체크5~11: WBS Download → xlsx 파싱 ──
  const dlPromise2 = page.waitForEvent("download");
  await page.waitForSelector('[data-id="excel-export-download"]:not([disabled])', { timeout: 8000 });
  await page.locator('[data-id="excel-export-download"]').click();
  const dl2 = await dlPromise2;
  const wbsXlsxPath = `${OUT}/export-wbs.xlsx`;
  await dl2.saveAs(wbsXlsxPath);

  const wbWbs = new ExcelJS.Workbook();
  await wbWbs.xlsx.readFile(wbsXlsxPath);
  const wbsSheet = wbWbs.worksheets[0];
  check("체크5a: 시트명 WBS", wbsSheet.name === "WBS", wbsSheet.name);

  const wbsHeaderRaw = wbsSheet.getRow(4).values; // 1-based sparse array — index0 undefined
  const wbsHeader = wbsHeaderRaw.slice(1).map(String);
  const taskIdx = wbsHeader.indexOf("Task"); // 0-based within trimmed header
  check(
    "체크5b: WBS 헤더 No,Level 1,Level 2,Task,…,Next",
    wbsHeader[0] === "No" && wbsHeader[1] === "Level 1" && wbsHeader[2] === "Level 2" && wbsHeader[3] === "Task" && wbsHeader[taskIdx + 1] === "Type" && wbsHeader[wbsHeader.length - 1] === "Next",
    wbsHeader.join(","),
  );
  const noCol = 1;
  const level1Col = 2;
  const level2Col = 3;
  const taskCol = 4; // maxLevel=2(root+SP 1단계) 고정 픽스처 기준 — No,Level1,Level2,Task
  const typeCol = taskCol + 1;
  const nextCol = wbsHeader.length; // 1-based 마지막 컬럼

  const wbsRows = [];
  wbsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return;
    wbsRows.push({
      no: row.getCell(noCol).value,
      level1: String(row.getCell(level1Col).value ?? ""),
      level2: String(row.getCell(level2Col).value ?? ""),
      title: String(row.getCell(taskCol).value ?? ""),
      type: String(row.getCell(typeCol).value ?? ""),
      next: String(row.getCell(nextCol).value ?? ""),
      level1Font: row.getCell(level1Col).font?.color?.argb,
    });
  });

  check("체크6: start/end 타입 행 0개", wbsRows.filter((r) => r.type === "start" || r.type === "end").length === 0, wbsRows.map((r) => `${r.title}:${r.type}`).join("|"));

  const subWorkTaskRow = wbsRows.find((r) => r.title === "SubWork");
  const pickItemsWbsRow = wbsRows.find((r) => r.title === "Pick items");
  const packItemsWbsRow = wbsRows.find((r) => r.title === "Pack items");
  check(
    "체크7: SubWork Task 행 없음, Pick/Pack items의 Level 2=SubWork",
    subWorkTaskRow === undefined && pickItemsWbsRow?.level2 === "SubWork" && packItemsWbsRow?.level2 === "SubWork",
    `subWorkRow=${subWorkTaskRow?.title} pick.level2=${pickItemsWbsRow?.level2} pack.level2=${packItemsWbsRow?.level2}`,
  );

  const prepareWbsRow = wbsRows.find((r) => r.title === "Prepare");
  check(
    "체크8: 루트 잎(Prepare) Level 1=맵 A 이름, Level 2 빈칸",
    prepareWbsRow?.level1 === mapA.name && prepareWbsRow?.level2 === "",
    `level1="${prepareWbsRow?.level1}" level2="${prepareWbsRow?.level2}" expected="${mapA.name}"`,
  );

  const approveWbsRow = wbsRows.find((r) => r.title.startsWith("Approve?"));
  const shipWbsRow = wbsRows.find((r) => r.title.startsWith("Ship"));
  check("체크9a: Approve? 디시전 행 존재", approveWbsRow !== undefined, wbsRows.map((r) => r.title).join("|"));
  check(
    "체크9b: Ship 행 제목에 [디시전No:yes] 주석",
    shipWbsRow?.title === `Ship [${approveWbsRow?.no}:yes]`,
    `got="${shipWbsRow?.title}" decisionNo=${approveWbsRow?.no}`,
  );

  const nodeNos = wbsRows.map((r) => r.no).filter((n) => n !== "" && n != null);
  check(
    "체크10: WBS No 컬럼 1..n 연속",
    nodeNos.join(",") === nodeNos.map((_, i) => i + 1).join(","),
    nodeNos.join(","),
  );

  check(
    "체크11: 레벨 셀 회색 폰트(FF9CA3AF)",
    prepareWbsRow?.level1Font === "FF9CA3AF",
    `got="${prepareWbsRow?.level1Font}"`,
  );
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
  if (mapBId !== null) await api(`/maps/${mapBId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("체크12: 콘솔 에러 0", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
