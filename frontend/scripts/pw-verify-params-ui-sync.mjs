// 6필드 파라미터 표면 동기화 검증 — 그룹 일괄 편집 6필드 + "Parameters" 표시 토글 (params-ui-sync).
// 시나리오: ①그룹 일괄 편집 모달 8모드 탭 ②cost_krw 일괄 500(통화 전환 충돌→Replace) → 반대 통화 소거·SP 제외
// ③fte 일괄 0.5 → SP 노드 포함 4멤버 ④캔버스 칩 ₩500 표기 ⑤맵 탭 Parameters 토글 OFF→칩 숨김·새로고침 유지(v2 키)→ON 복귀
// ⑥레거시 localStorage(bpm.nodeDisplayFields)만 있으면 params ON으로 이관 ⑦콘솔 에러 0
//
// 실행 (frontend/ 에서):
//   bash:       BASE_URL=http://localhost:3000 node scripts/pw-verify-params-ui-sync.mjs
//   PowerShell: $env:BASE_URL="http://localhost:3000"; node scripts\pw-verify-params-ui-sync.mjs
// 전제: pw-verify-export.mjs와 동일(백엔드+프론트 기동, playwright-core). 스크래치 맵 2개 생성 후 소프트삭제.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-params-ui-sync";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ── 헬퍼 (pw-verify-sp-params.mjs 미러) ─────────────────────────────
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

const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function waitForCondition(fn, { timeout = 8000, interval = 250 } = {}) {
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

const paramChipsLocator = (nodeSel) => page.locator(`${nodeSel} div.flex.flex-wrap.gap-x-2`);
const modal = () => page.locator('[data-id="group-bulk-modal"]');

// 그룹 타이틀바의 일괄 편집 버튼(aria-label=group.bulkEdit EN)으로 모달 진입
async function openBulkModal() {
  await page.locator('button[aria-label="Bulk edit members"]').first().click();
  await page.waitForSelector('[data-id="group-bulk-modal"]', { timeout: 5000 });
}

// 모드 탭(grid-cols-3 첫 그리드)에서 라벨로 모드 선택
async function selectMode(label) {
  await modal().locator("div.grid.grid-cols-3").first().locator("button", { hasText: label }).click();
}

// 값 입력(ParamInput, aria-label="Value") → blur → Apply, 충돌 시 정책 선택
async function applyValue(value, { policy = null } = {}) {
  const input = modal().locator('input[aria-label="Value"]');
  await input.fill(value);
  await input.blur();
  if (policy !== null) {
    await modal().locator("button", { hasText: policy }).first().click();
  }
  await modal().locator("button", { hasText: "Apply" }).click();
  await page.waitForSelector('[data-id="group-bulk-modal"] table', { timeout: 5000 });
}

async function confirmSummaryAndClose() {
  await modal().locator("button", { hasText: "Confirm" }).click();
  await page
    .waitForSelector('[data-id="group-bulk-modal"]', { state: "detached", timeout: 5000 })
    .catch(() => {});
}

// ── 서버 프로브 ────────────────────────────────────────────────────
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
let mapCId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — cannot supply owning_department");

  // ── 시드 — 맵 A(링크 대상), 맵 C(그룹: process 3 + subprocess 1) ──────────
  const mapA = await api("/maps", {
    method: "POST",
    body: { name: `ParamsSync A ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;

  const mapC = await api("/maps", {
    method: "POST",
    body: { name: `ParamsSync C ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapCId = mapC.id;
  const vC = mapC.versions[0].id;

  const gid = rid();
  const cStart = rid();
  const p1 = rid();
  const p2 = rid();
  const p3 = rid();
  const sub = rid();
  const cEnd = rid();
  await api(`/versions/${vC}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vC}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: cStart, title: "Start", node_type: "start", pos_x: 0, pos_y: 300, sort_order: 0 },
        { id: p1, title: "Alpha", node_type: "process", pos_x: 260, pos_y: 150, sort_order: 1, group_ids: [gid] },
        // p2는 USD 보유 — cost_krw 일괄 설정 시 "통화 전환" 충돌 + 반대 통화 소거 검증 대상
        { id: p2, title: "Bravo", node_type: "process", pos_x: 260, pos_y: 300, sort_order: 2, group_ids: [gid], cost_usd: "10" },
        { id: p3, title: "Charlie", node_type: "process", pos_x: 260, pos_y: 450, sort_order: 3, group_ids: [gid] },
        { id: sub, title: "Call A", node_type: "subprocess", pos_x: 520, pos_y: 300, sort_order: 4, group_ids: [gid], linked_map_id: mapAId },
        { id: cEnd, title: "End", node_type: "end", pos_x: 780, pos_y: 300, sort_order: 5, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: cStart, target_node_id: p1 },
        { id: rid(), source_node_id: p1, target_node_id: sub },
        { id: rid(), source_node_id: sub, target_node_id: cEnd },
      ],
      groups: [{ id: gid, label: "Bulk Group" }],
    },
  });

  await openEditor(mapCId, vC);
  check("editor loads map C (6 nodes on canvas)", (await page.locator(".react-flow__node").count()) === 6);

  // ── ① 모달 진입 + 모드 탭 8개(people/system + 파라미터 6종) ──────────────
  await openBulkModal();
  const modeButtons = await modal().locator("div.grid.grid-cols-3").first().locator("button").count();
  check("bulk modal shows 8 mode tabs (people/system + 6 params)", modeButtons === 8, `count=${modeButtons}`);
  await page.screenshot({ path: `${SHOTS}/01-modal-modes.png` });

  // ── ② cost_krw 일괄 500 — Bravo(USD 보유)는 통화 전환 충돌 → Replace ─────
  await selectMode("Cost / run (KRW)");
  const costInput = modal().locator('input[aria-label="Value"]');
  await costInput.fill("500");
  await costInput.blur();
  // 충돌 안내는 값 입력 후에 나타난다(attrConflicts가 value와 비교)
  const conflictNote = await modal().locator("text=already have a value").isVisible().catch(() => false);
  check("cost_krw mode surfaced currency-switch conflict for Bravo", conflictNote);
  await modal().locator("button", { hasText: "Replace" }).first().click();
  await modal().locator("button", { hasText: "Apply" }).click();
  await page.waitForSelector('[data-id="group-bulk-modal"] table', { timeout: 5000 });
  const summaryRows2 = await modal().locator("tbody tr").count();
  check("cost_krw apply summary lists 3 process members (SP excluded)", summaryRows2 === 3, `rows=${summaryRows2}`);
  await page.screenshot({ path: `${SHOTS}/02-cost-summary.png` });
  await confirmSummaryAndClose();

  const costSaved = await waitForCondition(async () => {
    const g = await api(`/versions/${vC}/graph`);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    return (
      byId[p1]?.cost_krw === "500" &&
      byId[p2]?.cost_krw === "500" &&
      byId[p2]?.cost_usd === "" &&
      byId[p3]?.cost_krw === "500" &&
      (byId[sub]?.cost_krw ?? "") === ""
    );
  });
  check(
    "saved: cost_krw=500 on 3 process nodes, Bravo's USD cleared (exclusive), SP untouched",
    costSaved,
  );

  // ── ③ fte 일괄 0.5 — SP 노드 포함 4멤버 ────────────────────────────────
  await openBulkModal();
  await selectMode("FTE");
  await applyValue("0.5");
  const summaryRows3 = await modal().locator("tbody tr").count();
  check("fte apply summary lists 4 members incl. subprocess", summaryRows3 === 4, `rows=${summaryRows3}`);
  await confirmSummaryAndClose();

  const fteSaved = await waitForCondition(async () => {
    const g = await api(`/versions/${vC}/graph`);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    return [p1, p2, p3, sub].every((id) => byId[id]?.fte === "0.5");
  });
  check("saved: fte=0.5 on all 4 group members incl. subprocess", fteSaved);

  // ── ④ 캔버스 칩 — Alpha에 ₩500 표시형 ─────────────────────────────────
  const p1Sel = `.react-flow__node[data-id="${p1}"]`;
  const chipText = await paramChipsLocator(p1Sel).innerText().catch(() => "");
  check("Alpha node chip shows ₩500 (display form)", chipText.includes("₩500"), `chips="${chipText.replace(/\n/g, " ")}"`);
  await page.screenshot({ path: `${SHOTS}/03-chips.png` });

  // ── ⑤ 맵 탭 Parameters 토글 — OFF→칩 숨김, 새로고침 유지(v2), ON 복귀 ────
  await page.locator('button[aria-label="Map"]').first().click();
  const paramsSwitch = page.locator('button[role="switch"][aria-label="Parameters"]');
  await paramsSwitch.waitFor({ timeout: 5000 });
  check("Map tab has Parameters switch, default ON", (await paramsSwitch.getAttribute("aria-checked")) === "true");

  await paramsSwitch.click();
  await page.waitForTimeout(300);
  check("toggle OFF hides param chips", (await paramChipsLocator(p1Sel).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/04-toggle-off.png` });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
  check("reload keeps chips hidden (bpm.nodeDisplayFields.v2 persisted)", (await paramChipsLocator(p1Sel).count()) === 0);

  await page.locator('button[aria-label="Map"]').first().click();
  await page.locator('button[role="switch"][aria-label="Parameters"]').click();
  await page.waitForTimeout(300);
  check("toggle ON restores chips", (await paramChipsLocator(p1Sel).count()) === 1);

  // ── ⑥ 레거시 이관 — v2 삭제 + 구 키만 존재 → params ON으로 이관 ─────────
  await page.evaluate(() => {
    window.localStorage.removeItem("bpm.nodeDisplayFields.v2");
    window.localStorage.setItem("bpm.nodeDisplayFields", JSON.stringify(["assignee"]));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
  check(
    "legacy key only → params migrated ON (chips visible)",
    (await paramChipsLocator(p1Sel).count()) === 1,
  );
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapCId !== null) await api(`/maps/${mapCId}`, { method: "DELETE" }).catch(() => {});
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
