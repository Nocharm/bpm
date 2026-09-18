// 스모크 — (1) 인터뷰 프리뷰 노드 속성·파라미터 표시 (2) 프리뷰 Tab/Shift+Tab 포커스 이동 (3) 에디터 PNG 선택 해제 캡처+복원
// 전제: frontend dev 기동(프리뷰는 API 전량 목킹), 에디터 PNG는 실 백엔드+엣지 있는 맵(EDITOR_MAP_ID, 기본 13).
// 실행: BASE_URL=http://localhost:3000 OUT_DIR=/tmp node scripts/pw-smoke-preview-tab-export.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? ".";
const MAP_ID = 9102;

const attrs = (o) => ({ assignee_role: "", department: "", system: "", duration: "", fte: "", ...o });
const workingGraph = {
  nodes: [
    { key: "s", title: "Start", node_type: "start", description: "", attributes: null, group_key: null },
    { key: "a", title: "Create purchase request", node_type: "process", description: "Requester fills PR", attributes: attrs({ assignee_role: "Buyer", department: "Purchasing", system: "SAP", duration: "1.30", annual_count: "120", fte: "0.5" }), group_key: null },
    { key: "b", title: "Approve request", node_type: "process", description: "", attributes: attrs({ assignee_role: "Manager", system: "Groupware", duration: "0.15", cost_krw: "12000" }), group_key: null },
    { key: "c", title: "Issue PO", node_type: "process", description: "", attributes: attrs({ assignee_role: "Buyer", department: "Purchasing", system: "SAP", headcount: "2" }), group_key: null },
    { key: "e", title: "End", node_type: "end", description: "", attributes: null, group_key: null },
  ],
  edges: [["s", "a"], ["a", "b"], ["b", "c"], ["c", "e"]].map(([source, target]) => ({ source, target, label: "" })),
  groups: [],
};
const state = {
  id: 2, map_id: MAP_ID, version_id: 601, status: "active", current_stage: "roles", lang: "en",
  facts: {}, working_graph: workingGraph, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-29T10:00:00+09:00", base_graph_updated_at: "2026-07-29T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "Who performs each step?", payload: null, stage: "roles", superseded: false, created_at: "2026-07-29T10:00:00+09:00" }],
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
  window.__png = null;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__png = this.href; return; }
    return orig.call(this);
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const results = [];
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// ---- (1)(2) 프리뷰 — API 전량 목킹
await page.route("**/api/me", (r) => r.fulfill({ json: { login_id: "admin.sys", name: "Admin", ai_enabled: true, manual_url: "", csv_manual_url: "", role: "admin", is_sysadmin: true, can_view_dashboard: true } }));
await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Preview Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 601, label: "As-Is", status: "draft", events: [] }] } }));
await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
await page.route("**/api/interviews/2", (r) => r.fulfill({ json: state }));
await page.route("**/api/notifications*", (r) => r.fulfill({ json: [] }));
await page.route("**/api/catalogs*", (r) => r.fulfill({ json: { roles: [], systems: [] } }));

await page.goto(`${BASE}/maps/${MAP_ID}/consult`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-id="interview-preview"] .react-flow__node', { timeout: 60000 });
await page.waitForTimeout(1200);
const roleLines = await page.locator('[data-id="interview-preview"] [data-id="node-assignee-line"]').count();
const deptLines = await page.locator('[data-id="interview-preview"] [data-id="node-department-line"]').count();
const sysLines = await page.locator('[data-id="interview-preview"] [data-id="node-system-line"]').count();
check("preview shows role lines", roleLines === 3, `${roleLines}`);
check("preview shows department lines", deptLines === 2, `${deptLines}`);
check("preview shows system lines", sysLines === 3, `${sysLines}`);
const nodeAText = await page.locator('[data-id="interview-preview"] .react-flow__node', { hasText: "Create purchase request" }).innerText();
check("preview node A shows param chips", nodeAText.includes("1h30m") && nodeAText.includes("120") && nodeAText.includes("0.5"), JSON.stringify(nodeAText));
await page.screenshot({ path: `${OUT}/01-preview-fields.png` });

// Tab 이동 — 노드 A 클릭 → Tab → B, Tab → C, Shift+Tab → B
await page.locator('[data-id="interview-preview"] .react-flow__node', { hasText: "Create purchase request" }).click();
await page.waitForSelector('[data-id="iv-node-inspector"]');
const inspTitle = () => page.locator('[data-id="iv-node-inspector"] .text-caption-strong').innerText();
check("click focuses A", (await inspTitle()) === "Create purchase request");
await page.mouse.move(5, 5);
await page.keyboard.press("Tab");
await page.waitForTimeout(500);
check("Tab → B", (await inspTitle()) === "Approve request", await inspTitle());
await page.keyboard.press("Tab");
await page.waitForTimeout(500);
check("Tab → C", (await inspTitle()) === "Issue PO", await inspTitle());
const selectedLabel = await page.locator('[data-id="interview-preview"] .react-flow__node.selected').innerText();
check("selected ring follows Tab", selectedLabel.includes("Issue PO"), selectedLabel.split("\n")[0]);
await page.screenshot({ path: `${OUT}/02-preview-tab.png` });
await page.keyboard.press("Shift+Tab");
await page.waitForTimeout(500);
check("Shift+Tab → B", (await inspTitle()) === "Approve request", await inspTitle());
// 채팅 입력 포커스 중엔 Tab 가로채지 않음
const chatInput = page.locator('[data-id="interview-panel"] textarea').first();
if (await chatInput.count()) {
  await chatInput.focus();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  check("Tab in chat input does not move focus", (await inspTitle()) === "Approve request", await inspTitle());
}

// ---- (3) 에디터 PNG — 실 백엔드(8048), 선택 노드 있는 상태로 Ctrl+Shift+E
await page.unroute("**/api/me"); await page.unroute("**/api/notifications*"); await page.unroute("**/api/catalogs*");
await page.goto(`${BASE}/maps/${process.env.EDITOR_MAP_ID ?? 13}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__edge", { state: "attached", timeout: 60000 });
await page.waitForTimeout(1500);
const target = page.locator('.react-flow__node[data-id]').nth(1);
await target.click();
await page.waitForTimeout(400);
const selBefore = await page.locator(".react-flow__node.selected").count();
check("editor node selected before export", selBefore === 1, `${selBefore}`);
await page.mouse.move(5, 5);
// 캡처 시점의 DOM 선택 상태를 엿본다 — toPng 진입 시 .selected 노드 수
await page.evaluate(() => {
  window.__selAtCapture = null;
  const obs = new MutationObserver(() => {});
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
  const origClone = Node.prototype.cloneNode;
  Node.prototype.cloneNode = function (...args) {
    if (this.classList?.contains("react-flow__viewport") && window.__selAtCapture === null) {
      window.__selAtCapture = document.querySelectorAll(".react-flow__node.selected").length;
    }
    return origClone.apply(this, args);
  };
});
await page.keyboard.press("Control+Shift+E");
await page.waitForFunction(() => window.__png !== null, undefined, { timeout: 60000 });
await page.waitForTimeout(500);
const selAtCapture = await page.evaluate(() => window.__selAtCapture);
check("no selected node at capture", selAtCapture === 0, `${selAtCapture}`);
const selAfter = await page.locator(".react-flow__node.selected").count();
check("selection restored after export", selAfter === 1, `${selAfter}`);
// 액센트(#6A41FF) 픽셀 = 선택 링 색 — 0에 가까워야 함
const stats = await page.evaluate(async () => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = window.__png; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let accent = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 106) < 18 && Math.abs(d[i + 1] - 65) < 18 && Math.abs(d[i + 2] - 255) < 18 && d[i + 3] > 200) accent++;
  }
  return { accent, w: img.width, h: img.height };
});
check("no accent ring pixels in PNG", stats.accent < 50, JSON.stringify(stats));
const png = await page.evaluate(() => window.__png);
const { writeFileSync } = await import("node:fs");
writeFileSync(`${OUT}/03-editor-export.png`, Buffer.from(png.split(",")[1], "base64"));
await page.screenshot({ path: `${OUT}/04-editor-after-export.png` });

console.log(results.join("\n"));
if (errors.length) console.log("console errors:", errors.slice(0, 5).join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
