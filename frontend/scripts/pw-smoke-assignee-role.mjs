// 역할(assignee_role)·시스템 정규화·Catalogs 탭 스모크. API로 맵/드래프트를 만든 뒤 브라우저에서
// (1) 인스펙터 역할 입력→새로고침→캔버스 칩 (2) 시스템 자유값→Other+원문 메모 (3) Catalogs 탭 추가·CSV 임포트→피커 옵션.
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

// ── API 시드: 맵 + 드래프트 체크아웃 + 노드 3개 ───────────────────────────────
const stamp = Date.now().toString(36);
const map = await api("POST", "/maps", { owning_department: "Growth Center", name: `Role smoke ${stamp}` });
const versionId = map.versions[0].id;
await api("POST", `/versions/${versionId}/checkout`, {});
const nodeId = `role-smoke-${stamp}`;
await api("PUT", `/versions/${versionId}/graph`, {
  nodes: [
    { id: `${nodeId}-s`, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
    { id: nodeId, title: "Weigh sample", node_type: "process", pos_x: 240, pos_y: 0, sort_order: 1 },
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
  // 카탈로그 초기화 — 역할 목록에 "Reviewer"만. try 안 첫 문장이라야 실패해도 finally 정리가 돈다.
  await api("PUT", "/admin/app-settings", { assignee_roles: ["Reviewer"], systems: ["LIMS"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── 1) 인스펙터 역할 행 — 자동완성 선택 → 저장 → 새로고침 → 캔버스 칩 ────────
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
  await page.reload({ waitUntil: "networkidle" });
  const chip = page.locator(".react-flow__node", { hasText: "Weigh sample" }).locator('[data-id="node-role-chip"]');
  await chip.waitFor({ state: "visible", timeout: 10000 });
  check("canvas shows the role chip on the assignee line", ((await chip.textContent()) ?? "").trim() === "Reviewer");
  await page.screenshot({ path: path.join(SHOT_DIR, "assignee-role-canvas.png") });

  // ── 2) 시스템 자유값 → Other + 원문 메모 ──────────────────────────────────
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
  await page.locator('[data-id="inspector-field-system"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-system-row.png") });

  // ── 3) Catalogs 탭 — 직접 추가 + CSV 임포트 → 저장 → /catalogs 반영 ─────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Catalogs" }).click();
  await page.locator('[data-id="catalogs-panel"]').waitFor({ state: "visible", timeout: 10000 });
  const addInput = page.locator('[data-id="catalog-roles-add-input"]');
  await addInput.fill("Approver");
  await addInput.press("Enter");
  const csvPath = path.join(os.tmpdir(), `catalog-roles-${stamp}.csv`);
  fs.writeFileSync(csvPath, "value\r\nOperator\r\nreviewer\r\n");
  await page.locator('[data-id="catalog-roles-file"]').setInputFiles(csvPath);
  await page.locator('[data-id="catalog-roles-import-note"]').waitFor({ state: "visible", timeout: 3000 });
  check("csv import note reports added/duplicates",
    /Added 1, skipped 1/.test((await page.locator('[data-id="catalog-roles-import-note"]').textContent()) ?? ""));
  await page.locator('[data-id="catalog-roles-save"]').click();
  await page.waitForTimeout(800);
  const catalogs = await api("GET", "/catalogs");
  check("saved roles reach /catalogs", JSON.stringify(catalogs.assignee_roles) === JSON.stringify(["Reviewer", "Approver", "Operator"]),
    JSON.stringify(catalogs.assignee_roles));
  check("systems keep the reserved Other first", catalogs.systems[0] === "Other" && catalogs.systems.includes("LIMS"));
  await page.locator('[data-id="catalogs-panel"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-catalogs-tab.png") });
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
