// 역할(assignee_role)·시스템 정규화·별칭 치환·노드 담당자 줄 호버 전환·Catalogs 탭 별칭 편집 스모크.
// API로 맵/드래프트를 만든 뒤 브라우저에서 (1) 인스펙터 역할 입력(자동완성+별칭)→새로고침→캔버스 칩
// (2) 담당자 줄 휴식(역할 칩)↔호버/선택 후 NODE_ALT_DELAY_MS 지연 활성(담당자 이름) 전환
// (3) 시스템 자유값→Other+원문 메모, 별칭→카탈로그 표기 (4) Catalogs 탭 추가·CSV 임포트(2열: value,aliases)·
// 칩 별칭 편집→피커 옵션.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node scripts/pw-smoke-assignee-role.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, dev 인증(admin.sys=sysadmin). 스크린샷은 SHOT_DIR(기본 /tmp).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const ADMIN = "admin.sys";
const HEADERS = { "Content-Type": "application/json", "X-Dev-User": ADMIN };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const api = async (method, url, body) => {
  const res = await fetch(`${API}/api${url}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
};

// ── API 시드: 맵 + 드래프트 체크아웃 + 노드 3개 (담당자 이름 있음 — 호버 전환 판정용) ─────
const stamp = Date.now().toString(36);
const map = await api("POST", "/maps", { owning_department: "Growth Center", name: `Role smoke ${stamp}` });
const versionId = map.versions[0].id;
await api("POST", `/versions/${versionId}/checkout`, {});
const nodeId = `role-smoke-${stamp}`;
await api("PUT", `/versions/${versionId}/graph`, {
  nodes: [
    { id: `${nodeId}-s`, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
    { id: nodeId, title: "Weigh sample", node_type: "process", pos_x: 240, pos_y: 0, sort_order: 1, assignee: "Admin Sys" },
    { id: `${nodeId}-e`, title: "End", node_type: "end", pos_x: 480, pos_y: 0, sort_order: 2, is_primary_end: true },
  ],
  edges: [
    { id: `${nodeId}-e1`, source_node_id: `${nodeId}-s`, target_node_id: nodeId, label: "" },
    { id: `${nodeId}-e2`, source_node_id: nodeId, target_node_id: `${nodeId}-e`, label: "" },
  ],
});
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  // 카탈로그 초기화 — 역할 "Reviewer"(별칭 검토자)·시스템 "LIMS"(별칭 랩정보). try 안 첫 문장이라야
  // 실패해도 finally 정리가 돈다. 엔트리 형태({value, aliases})로 시드해 별칭 치환 경로를 검증한다.
  await api("PUT", "/admin/app-settings", {
    assignee_roles: [{ value: "Reviewer", aliases: ["검토자"] }],
    systems: [{ value: "LIMS", aliases: ["랩정보"] }],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── 1) 인스펙터 역할 행 — 자동완성 선택 → 저장 → 별칭 치환 → 새로고침 → 캔버스 칩 ────────
  await page.goto(`${BASE}/maps/${map.id}`, { waitUntil: "networkidle" });
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().click();
  const attrsToggle = page.locator('[data-id="inspector-attrs-toggle"]');
  await attrsToggle.waitFor({ state: "visible", timeout: 10000 });
  if ((await attrsToggle.getAttribute("aria-expanded")) !== "true") await attrsToggle.click();
  const roleInput = page.locator('[data-id="inspector-field-role"]');
  await roleInput.click();
  await roleInput.fill("rev");
  await page.locator('[data-id="inspector-field-role-option-0"]').waitFor({ state: "visible", timeout: 3000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600); // 자동 저장 디바운스(AUTO_SAVE_DELAY_MS=2000)
  let graph = await api("GET", `/versions/${versionId}/graph`);
  let node = graph.nodes.find((n) => n.id === nodeId);
  check("role saved via inspector suggestion (catalog spelling)", node?.assignee_role === "Reviewer", `got=${node?.assignee_role}`);
  await roleInput.click();
  await roleInput.fill("검토자");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("alias input is normalized to the canonical role", node?.assignee_role === "Reviewer", `got=${node?.assignee_role}`);
  await page.reload({ waitUntil: "networkidle" });
  const chip = page.locator(".react-flow__node", { hasText: "Weigh sample" }).locator('[data-id="node-role-text"]');
  await chip.waitFor({ state: "visible", timeout: 10000 });
  check("canvas shows the role text on the assignee line", ((await chip.textContent()) ?? "").trim() === "Reviewer");
  await page.screenshot({ path: path.join(SHOT_DIR, "assignee-role-canvas.png") });

  // ── 2) 담당자 줄 휴식↔활성 전환 — 휴식=역할 칩, 호버/선택 NODE_ALT_DELAY_MS 뒤 활성=담당자 이름 ──
  const line = page.locator(".react-flow__node", { hasText: "Weigh sample" }).locator('[data-id="node-assignee-line"]');
  check("rest state shows the role text", (await line.getAttribute("data-alt")) === "false" && (await line.locator('[data-id="node-role-text"]').count()) === 1);
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().hover();
  await page.waitForTimeout(1300); // NODE_ALT_DELAY_MS(1000) + 여유
  check("hover swaps to the assignee after the delay", (await line.getAttribute("data-alt")) === "true" && ((await line.textContent()) ?? "").includes("Admin Sys"));
  await page.screenshot({ path: path.join(SHOT_DIR, "alias-node-swap-hover.png") });
  await page.mouse.move(10, 10);
  // 이탈은 render-time 즉시 복귀(useDelayedFlag) — 페이드(350ms)만 기다리면 된다
  await page.waitForTimeout(300);
  check("leaving returns to the role", (await line.getAttribute("data-alt")) === "false");

  // ── 3) 시스템 자유값 → Other + 원문 메모, 별칭 → 카탈로그 표기 ──────────────────
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().click();
  if ((await attrsToggle.getAttribute("aria-expanded")) !== "true") await attrsToggle.click();
  const systemInput = page.locator('[data-id="inspector-field-system"]');
  await systemInput.click();
  await systemInput.fill("Excel macro");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("free system value stored as Other", node?.system === "Other", `got=${node?.system}`);
  check("raw system text kept as source note", node?.system_fallback === "Excel macro", `got=${node?.system_fallback}`);
  await systemInput.click();
  await systemInput.fill("lims");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("catalog system value normalized to catalog spelling", node?.system === "LIMS", `got=${node?.system}`);
  await systemInput.click();
  await systemInput.fill("랩정보");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2600);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("alias input is normalized to the canonical system", node?.system === "LIMS", `got=${node?.system}`);
  await page.locator('[data-id="inspector-field-system"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-system-row.png") });

  // ── 4) Catalogs 탭 — 직접 추가 + CSV(2열) 임포트 → 저장 → /catalogs 반영 ─────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Catalogs" }).click();
  await page.locator('[data-id="catalogs-panel"]').waitFor({ state: "visible", timeout: 10000 });
  const addInput = page.locator('[data-id="catalog-roles-add-input"]');
  await addInput.fill("Approver");
  await addInput.press("Enter");
  const csvPath = path.join(os.tmpdir(), `catalog-roles-${stamp}.csv`);
  fs.writeFileSync(csvPath, "value,aliases\r\nOperator,오퍼레이터|작업자\r\nreviewer,\r\n");
  await page.locator('[data-id="catalog-roles-file"]').setInputFiles(csvPath);
  await page.locator('[data-id="catalog-roles-import-note"]').waitFor({ state: "visible", timeout: 3000 });
  check("csv import note reports added/merged/duplicates",
    /Added 1, merged 2/.test((await page.locator('[data-id="catalog-roles-import-note"]').textContent()) ?? ""));
  await page.locator('[data-id="catalog-roles-save"]').click();
  await page.waitForTimeout(800);
  let catalogs = await api("GET", "/catalogs");
  check("saved roles reach /catalogs", JSON.stringify(catalogs.assignee_roles.map((e) => e.value)) === JSON.stringify(["Reviewer", "Approver", "Operator"]),
    JSON.stringify(catalogs.assignee_roles));
  check("systems keep the reserved Other first", catalogs.systems[0]?.value === "Other" && catalogs.systems.some((e) => e.value === "LIMS"));
  await page.locator('[data-id="catalogs-panel"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-catalogs-tab.png") });

  // ── 5) 칩 별칭 편집 — 클릭 → 별칭 입력 → 적용 → 저장 → /catalogs 반영 ──────────
  await page.locator('[data-id="catalog-roles-chip"][data-value="Reviewer"] button').first().click();
  const aliasInput = page.locator('[data-id="catalog-roles-alias-input"]');
  await aliasInput.waitFor({ state: "visible", timeout: 3000 });
  await aliasInput.fill("검토자, 리뷰어");
  await page.locator('[data-id="catalog-roles-alias-apply"]').click();
  await page.screenshot({ path: path.join(SHOT_DIR, "alias-node-swap-catalogs.png") });
  await page.locator('[data-id="catalog-roles-save"]').click();
  await page.waitForTimeout(800);
  catalogs = await api("GET", "/catalogs");
  const expectedRoles = [
    { value: "Reviewer", aliases: ["검토자", "리뷰어"] },
    { value: "Approver", aliases: [] },
    { value: "Operator", aliases: ["오퍼레이터", "작업자"] },
  ];
  check("aliases saved", JSON.stringify(catalogs.assignee_roles) === JSON.stringify(expectedRoles), JSON.stringify(catalogs.assignee_roles));
} finally {
  await browser.close();
  // 시드 정리 — 카탈로그는 비우고 맵은 남긴다(휴지통 절차 대신 이름에 stamp)
  await api("PUT", "/admin/app-settings", { assignee_roles: [], systems: [] })
    .catch((err) => console.warn("catalog reset failed", err));
}
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
