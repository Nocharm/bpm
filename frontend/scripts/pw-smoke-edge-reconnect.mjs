// 엣지 편집 스모크 — 끝점 재연결(핸들·몸체 드롭·빈 곳 취소·출력 규칙 차단)·연결 변 다시 고르기·라벨 편집 박스 위치.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3055 BACKEND_URL=http://localhost:8055 node scripts/pw-smoke-edge-reconnect.mjs
//   KEEP=1 이면 시드 맵을 지우지 않는다. 산출물은 저장소 루트 .shots/edge-reconnect-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3055";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8055";
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
const nid = (key) => `rc-${tag}-${key}`;
const S = nid("s");
const A = nid("a");
const B = nid("b");
const E = nid("end");
const C = nid("c");
const D = nid("d");
const EAB = nid("e-ab");
const nodes = [
  { id: S, title: "Start", node_type: "start", pos_x: 0, pos_y: 100 },
  { id: A, title: "Draft", node_type: "process", pos_x: 200, pos_y: 100 },
  { id: B, title: "Review", node_type: "process", pos_x: 480, pos_y: 100 },
  { id: E, title: "", node_type: "end", pos_x: 760, pos_y: 110 },
  { id: C, title: "Rework", node_type: "process", pos_x: 480, pos_y: 300 },
  { id: D, title: "Archive", node_type: "process", pos_x: 200, pos_y: 420 },
  // 삽입 역행 쌍 시나리오: X1→X2, X2→X3에서 X1→X3 '삽입'은 X3→X2를 만들어 X2↔X3가 된다
  { id: nid("x1"), title: "Collect", node_type: "process", pos_x: 200, pos_y: 600 },
  { id: nid("x2"), title: "Check", node_type: "process", pos_x: 480, pos_y: 600 },
  { id: nid("x3"), title: "Close", node_type: "process", pos_x: 760, pos_y: 600 },
];
const edges = [
  { id: nid("e-sa"), source_node_id: S, target_node_id: A, label: "" },
  { id: EAB, source_node_id: A, target_node_id: B, label: "Go", line_style: "default" },
  { id: nid("e-be"), source_node_id: B, target_node_id: E, label: "" },
  { id: nid("e-x12"), source_node_id: nid("x1"), target_node_id: nid("x2"), label: "" },
  { id: nid("e-x23"), source_node_id: nid("x2"), target_node_id: nid("x3"), label: "" },
];

const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith("Edge reconnect smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const map = await api("POST", "/api/maps", { name: `Edge reconnect smoke ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
check("seeded map", true, `map ${map.id} v${draft.id}`);

const readEdge = async (id) => (await api("GET", `/api/versions/${draft.id}/graph`)).edges.find((e) => e.id === id);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(`.react-flow__edge[data-id="${EAB}"]`, { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2500);

const centerOf = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
};
const settle = () => page.waitForTimeout(3500); // 자동 저장 대기
const anchor = (edgeId, end) => `.react-flow__edge[data-id="${edgeId}"] .react-flow__edgeupdater-${end}`;
const handle = (nodeId, handleId) => `.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`;

// 1) 도착 끝을 C의 왼쪽 핸들로 — 같은 id·라벨·선 모양 유지
check("reconnect anchors rendered", (await page.locator(anchor(EAB, "target")).count()) === 1);
await drag(await centerOf(anchor(EAB, "target")), await centerOf(handle(C, "t-left")));
await settle();
let e = await readEdge(EAB);
check("target end moved to C (same id, label, line style)", e?.target_node_id === C && e?.label === "Go" && e?.line_style === "default", JSON.stringify(e));
await page.screenshot({ path: `${OUT}/edge-reconnect-1-moved.png` });

// 2) 빈 곳에 놓으면 취소
await drag(await centerOf(anchor(EAB, "target")), { x: 1300, y: 800 });
await settle();
e = await readEdge(EAB);
check("drop on empty pane keeps the edge", e?.target_node_id === C && e?.source_node_id === A);

// 3) 출발 끝을 이미 출력이 있는 B로 — 출력 규칙 토스트, 무변경
await drag(await centerOf(anchor(EAB, "source")), await centerOf(handle(B, "s-right")));
const toast = await page.getByText("This node already has an output.").first().isVisible().catch(() => false);
await settle();
e = await readEdge(EAB);
check("moving source onto a node with an output is blocked", toast && e?.source_node_id === A, `toast=${toast}`);

// 4) 도착 끝을 D 몸체에 놓으면 D의 기본 핸들로 재연결(새 엣지 생성 아님)
const before = (await api("GET", `/api/versions/${draft.id}/graph`)).edges.length;
await drag(await centerOf(anchor(EAB, "target")), await centerOf(`.react-flow__node[data-id="${D}"]`));
await settle();
const graph4 = await api("GET", `/api/versions/${draft.id}/graph`);
e = graph4.edges.find((x) => x.id === EAB);
check("body drop reconnects the moving end", e?.target_node_id === D && graph4.edges.length === before, `edges ${before}->${graph4.edges.length}`);

// 5) 연결 변 다시 고르기 — A 바로 아래 D: 아래→위
await page.locator(`.react-flow__node[data-id="${A}"]`).click({ button: "right" });
await page.getByText("Re-pick connection sides").first().click();
await settle();
e = await readEdge(EAB);
check("re-pick sides picks bottom→top for a node straight below", e?.source_handle === "s-bottom" && e?.target_handle === "t-top", `${e?.source_handle} → ${e?.target_handle}`);
await page.screenshot({ path: `${OUT}/edge-reconnect-2-repicked.png` });

// 6) 라벨 편집 박스 위치 — 라벨 알약 중심과의 거리
await page.locator(`.react-flow__edge[data-id="${EAB}"] path.react-flow__edge-path`).first().dblclick({ force: true });
await page.waitForTimeout(400);
const editor = await page.locator("textarea.nodrag").first().boundingBox();
const pill = await page.locator(".react-flow__edgelabel-renderer div", { hasText: "Go" }).first().boundingBox();
if (editor && pill) {
  const dx = editor.x + editor.width / 2 - (pill.x + pill.width / 2);
  const dy = editor.y + editor.height / 2 - (pill.y + pill.height / 2);
  check("label editor sits on the label pill", Math.hypot(dx, dy) < 24, `offset ${dx.toFixed(1)},${dy.toFixed(1)}`);
} else {
  check("label editor sits on the label pill", false, `editor=${!!editor} pill=${!!pill}`);
}
await page.screenshot({ path: `${OUT}/edge-reconnect-3-label-editor.png` });
await page.keyboard.press("Escape");
await page.locator(".react-flow__pane").click({ position: { x: 40, y: 40 } });

// 7) 삽입이 역행 쌍을 만들면 토스트 후 무변경(applyEdgeAction)
const edgesBefore = (await api("GET", `/api/versions/${draft.id}/graph`)).edges.length;
await page.locator(`.react-flow__node[data-id="${nid("x1")}"]`).hover();
await drag(await centerOf(handle(nid("x1"), "s-right")), await centerOf(handle(nid("x3"), "t-left")));
await page.getByRole("button", { name: "Insert" }).first().click();
const rewireToast = await page.getByText("would link both ways").first().isVisible().catch(() => false);
await settle();
const graph7 = await api("GET", `/api/versions/${draft.id}/graph`);
check("insert that would create a two-way pair is refused", rewireToast && graph7.edges.length === edgesBefore, `toast=${rewireToast} edges ${edgesBefore}->${graph7.edges.length}`);
await page.screenshot({ path: `${OUT}/edge-reconnect-4-rewire-toast.png` });

await browser.close();
if (!KEEP) await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
