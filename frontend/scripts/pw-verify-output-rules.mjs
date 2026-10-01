// 출력 규칙 통일 검증(feat/output-rules) — SP 들어오는 핸들 시작 불가·드래그 중에만 노출(P1).
// 시드는 pw-verify-sp-ends.mjs와 같은 3끝(승인*·반려·보류) 링크 맵 + 호스트 맵.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-output-rules.mjs
//   산출물 .shots/output-rules-*.png (gitignore). 전제: admin.sys 시드(reset_db).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const NAME = "Output rules";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ── 시드 정리
const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const tag = Date.now().toString(36);
const nid = (key) => `opr-${tag}-${key}`;

async function createMap(name) {
  const map = await api("POST", "/api/maps", { name, owning_department: owning, visibility: "private" });
  const detail = await api("GET", `/api/maps/${map.id}`);
  const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
  await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
  return { map, draft };
}

// ── 링크 타깃: 시작 → 작업 → 끝 3개(승인*, 반려, 보류). 발행 + SP 지정이 있어야 임베드가 풀린다.
const target = await createMap(`${NAME} target ${tag}`);
await api("PUT", `/api/versions/${target.draft.id}/graph`, {
  nodes: [
    { id: nid("t-start"), title: "시작", node_type: "start", pos_x: 0, pos_y: 160 },
    { id: nid("t-task"), title: "검토 수행", node_type: "process", pos_x: 250, pos_y: 160 },
    { id: nid("t-ok"), title: "승인", node_type: "end", pos_x: 600, pos_y: 20, is_primary_end: true },
    { id: nid("t-reject"), title: "반려", node_type: "end", pos_x: 600, pos_y: 160 },
    { id: nid("t-hold"), title: "보류", node_type: "end", pos_x: 600, pos_y: 300 },
  ],
  edges: [
    { id: nid("t-e0"), source_node_id: nid("t-start"), target_node_id: nid("t-task") },
    { id: nid("t-e1"), source_node_id: nid("t-task"), target_node_id: nid("t-ok") },
    { id: nid("t-e2"), source_node_id: nid("t-task"), target_node_id: nid("t-reject") },
    { id: nid("t-e3"), source_node_id: nid("t-task"), target_node_id: nid("t-hold") },
  ],
  groups: [],
});
await api("PUT", `/api/maps/${target.map.id}/approvers`, { user_ids: [ADMIN] });
await api("POST", `/api/versions/${target.draft.id}/submit`, {});
await api("POST", `/api/versions/${target.draft.id}/approve`, {});
await api("POST", `/api/versions/${target.draft.id}/publish`, {});
await api("PUT", `/api/maps/${target.map.id}/subprocess-designation`, { department: String(owning).split(/\s*>\s*/).pop() || "QA" });
check("seeded, published and designated a 3-end link target", true, `map ${target.map.id}`);

// ── 호스트: 시작 → A → SP ; SP(승인)→D(라벨 없음=미러), SP(반려)→R ; D → 끝. N(느슨), I → Q(분기 Yes/No → Y1/Y2)
const host = await createMap(`${NAME} host ${tag}`);
const SP = nid("sp");
const hostNodes = [
  { id: nid("start"), title: "시작", node_type: "start", pos_x: -260, pos_y: 200 },
  { id: nid("a"), title: "요청 접수", node_type: "process", pos_x: 0, pos_y: 200 },
  { id: SP, title: "검토 서브", node_type: "subprocess", pos_x: 360, pos_y: 200, linked_map_id: target.map.id, follow_latest: true },
  { id: nid("d"), title: "결과 통보", node_type: "process", pos_x: 900, pos_y: 60 },
  { id: nid("r"), title: "재작업", node_type: "process", pos_x: 900, pos_y: 340 },
  { id: nid("end"), title: "완료", node_type: "end", pos_x: 1220, pos_y: 60 },
  { id: nid("n"), title: "보완 요청", node_type: "process", pos_x: 360, pos_y: 520 },
  { id: nid("i"), title: "접수 확인", node_type: "process", pos_x: -260, pos_y: 760 },
  { id: nid("q"), title: "승인 요청?", node_type: "decision", pos_x: 60, pos_y: 740 },
  { id: nid("y1"), title: "결제 처리", node_type: "process", pos_x: 900, pos_y: 620 },
  { id: nid("y2"), title: "보류 처리", node_type: "process", pos_x: 900, pos_y: 860 },
];
const hostEdges = [
  { id: nid("e-s"), source_node_id: nid("start"), target_node_id: nid("a") },
  { id: nid("e-a"), source_node_id: nid("a"), target_node_id: SP, target_handle: "in" },
  { id: nid("e-d"), source_node_id: SP, target_node_id: nid("d"), source_handle: "__primary__" },
  { id: nid("e-r"), source_node_id: SP, target_node_id: nid("r"), source_handle: "반려" },
  { id: nid("e-end"), source_node_id: nid("d"), target_node_id: nid("end") },
  { id: nid("e-i"), source_node_id: nid("i"), target_node_id: nid("q") },
  { id: nid("e-yes"), source_node_id: nid("q"), target_node_id: nid("y1"), label: "Yes" },
  { id: nid("e-no"), source_node_id: nid("q"), target_node_id: nid("y2"), label: "No" },
];
await api("PUT", `/api/versions/${host.draft.id}/graph`, { nodes: hostNodes, edges: hostEdges, groups: [] });
check("seeded host map with per-end exits", true, `map ${host.map.id} v${host.draft.id}`);

// ── 브라우저
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push(`page: ${String(e).slice(0, 200)}`));
/** 에디터 열기(재진입 포함) — 드래그 단계 앞에서는 다시 열어 RF 뷰포트 상태를 초기화한다
 *  (centerOn은 DOM transform만 바꿔 RF 스토어와 어긋나므로 드롭존 조준 전에는 쓰지 않는다). */
async function openEditor() {
  let opened = false;
  for (let i = 0; i < 30 && !opened; i += 1) {
    try {
      const r = await page.goto(`${BASE}/maps/${host.map.id}?version=${host.draft.id}`, { waitUntil: "domcontentloaded" });
      opened = !!r && r.status() < 500;
    } catch {
      await sleep(3000);
    }
  }
  await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
  await sleep(2500);
  // 화면 맞춤 — 로드 뷰포트는 확대돼 있을 수 있어 노드 일부가 화면 밖(드래그 좌표 무효). 전체를 보이게 맞춘다.
  await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
  await sleep(700);
}
await openEditor();

const edgeCount = () => page.locator(".react-flow__edge").count();
const nodeBox = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
const handleBox = (nodeId, handleId) =>
  page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`).boundingBox();
const handleStyle = (nodeId, handleId) =>
  page.evaluate(([n, h]) => {
    const el = document.querySelector(`.react-flow__node[data-id="${n}"] .react-flow__handle[data-handleid="${h}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, pe: cs.pointerEvents };
  }, [nodeId, handleId]);
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// ── (0) 끝 개수 배지: 끝 3개 중 대표·반려 연결 → 2/3, 초과 없음
const badgeText = (dataId) =>
  page.locator(`.react-flow__node[data-id="${SP}"] [data-id="${dataId}"]`).textContent({ timeout: 3000 }).catch(() => null);
check("badge shows connected exits out of ends (2/3)", (await badgeText("sp-output-count")) === "2/3", String(await badgeText("sp-output-count")));
check("no excess badge when every end has at most one output", (await badgeText("sp-output-excess")) === null);
const checkOk = (key) => page.locator(`[data-id="save-check-${key}"]`).getAttribute("data-ok");
check("save checklist output rule passes on load", (await checkOk("singleOutput")) === "true");

// ── (1) 호버: 우측 끝 핸들만 보이고 in 핸들은 숨김·클릭 통과
const spBox = await nodeBox(SP);
await page.mouse.move(spBox.x + spBox.width / 2, spBox.y + spBox.height / 2);
await sleep(300);
const inTop = await handleStyle(SP, "in:top");
const inLeft = await handleStyle(SP, "in");
const endPrimary = await handleStyle(SP, "__primary__");
const endHold = await handleStyle(SP, "보류");
check("hover hides in handles and lets clicks through", inTop?.opacity === "0" && inTop?.pe === "none" && inLeft?.opacity === "0", JSON.stringify({ inTop, inLeft }));
check("hover shows one right handle (primary end on top, other ends stacked and hidden)", endPrimary?.opacity === "1" && endHold?.opacity === "0" && endHold?.pe === "none", JSON.stringify({ endPrimary, endHold }));
const stacked = await page.evaluate((id) => {
  const tops = [...document.querySelectorAll(`.react-flow__node[data-id="${id}"] .react-flow__handle.source`)].map((h) => Math.round(h.getBoundingClientRect().top));
  return new Set(tops).size;
}, SP);
check("all end handles share one point", stacked === 1, `${stacked} distinct tops`);
await page.screenshot({ path: `${OUT}/output-rules-hover.png`, clip: { x: spBox.x - 60, y: spBox.y - 60, width: spBox.width + 120, height: spBox.height + 120 } });

// ── (2) SP 상단(in:top 자리)에서 끌어 다른 노드 몸체에 놓아도 연결이 생기지 않는다(역방향 입력 엣지 회귀)
const before = await edgeCount();
const topPoint = center(await handleBox(SP, "in:top"));
const nBox = await nodeBox(nid("n"));
await page.mouse.move(topPoint.x, topPoint.y);
await page.mouse.down();
await page.mouse.move(center(nBox).x, center(nBox).y, { steps: 12 });
await page.mouse.up();
await sleep(800);
check("dragging from the subprocess top side creates no edge", (await edgeCount()) === before, `${before} -> ${await edgeCount()}`);
await openEditor();

// ── (3) 다른 노드에서 끌어오는 중엔 in 핸들이 드러나고, 상단 in에 놓으면 들어오는 연결
const nRight = center(await handleBox(nid("n"), "s-right"));
const topTarget = center(await handleBox(SP, "in:top"));
await page.mouse.move(nRight.x, nRight.y);
await page.mouse.down();
await page.mouse.move(topTarget.x, topTarget.y - 30, { steps: 10 });
await page.mouse.move(topTarget.x, topTarget.y, { steps: 4 });
await sleep(300);
const inTopDragging = await handleStyle(SP, "in:top");
check("in handles reveal while a connection is being dragged", inTopDragging?.opacity === "1" && inTopDragging?.pe !== "none", JSON.stringify(inTopDragging));
const sp2 = await nodeBox(SP);
await page.screenshot({ path: `${OUT}/output-rules-dragging.png`, clip: { x: sp2.x - 80, y: sp2.y - 80, width: sp2.width + 160, height: sp2.height + 300 } });
await page.mouse.up();
await sleep(900);
const incoming = await edgeCount();
check("dropping on the top in handle adds an incoming edge", incoming === before + 1, `${before} -> ${incoming}`);

// ── (4) 우측 한 점에서 끌어 놓으면 출구 목록 → 보류 선택 → SP(보류)→보류 처리
const rightPoint = center(await handleBox(SP, "__primary__"));
const before4 = await edgeCount();
const yBox = await nodeBox(nid("y2"));
await page.mouse.move(rightPoint.x, rightPoint.y);
await page.mouse.down();
await page.mouse.move(center(yBox).x, center(yBox).y, { steps: 12 });
await page.mouse.up();
await sleep(700);
const endModal = page.locator('[data-id="edge-end-modal"]');
check("dropping from the right handle opens the end list", await endModal.isVisible().catch(() => false));
await page.screenshot({ path: `${OUT}/output-rules-end-list.png` });
await page.locator('[data-id="edge-end-row-보류"]').click();
await sleep(900);
check("picking an end connects from that end", (await edgeCount()) === before4 + 1, `${before4} -> ${await edgeCount()}`);
await sleep(1500);
const savedAfter = await api("GET", `/api/versions/${host.draft.id}/graph`);
check("the new edge leaves from the picked end", savedAfter.edges.some((e) => e.source_node_id === SP && e.target_node_id === nid("y2") && e.source_handle === "보류"), JSON.stringify(savedAfter.edges.filter((e) => e.source_node_id === SP).map((e) => e.source_handle)));
check("badge counts the newly connected end (3/3)", (await badgeText("sp-output-count")) === "3/3", String(await badgeText("sp-output-count")));

// ── (5) 한 출구에 엣지 2개(삽입 재연결이 만드는 상태)를 API로 만들고 다시 열면 +1 배지·체크리스트 미충족·수동 저장 차단
const graph = await api("GET", `/api/versions/${host.draft.id}/graph`);
graph.edges.push({ id: nid("e-extra"), source_node_id: SP, target_node_id: nid("n"), source_handle: "__primary__" });
await api("PUT", `/api/versions/${host.draft.id}/graph`, { nodes: graph.nodes, edges: graph.edges, groups: graph.groups ?? [] });
await openEditor();
const excessLayers = () =>
  page.evaluate((id) => {
    const pill = document.querySelector(`.react-flow__node[data-id="${id}"] [data-id="sp-output-excess"]`);
    return pill ? [...pill.children].map((el) => ({ text: el.textContent, opacity: getComputedStyle(el).opacity })) : null;
  }, SP);
const layers = await excessLayers();
check("excess pill shows +1 (ratio layer hidden)", layers?.[0]?.text === "+1" && layers[0].opacity === "1" && layers[1].opacity === "0", JSON.stringify(layers));
check("save checklist output rule fails", (await checkOk("singleOutput")) === "false");
const spBox5 = await nodeBox(SP);
const badgeClip = { x: spBox5.x - 40, y: spBox5.y - 40, width: spBox5.width + 80, height: spBox5.height + 80 };
await page.screenshot({ path: `${OUT}/output-rules-badge-excess.png`, clip: badgeClip });
const pillBox = await page.locator(`.react-flow__node[data-id="${SP}"] [data-id="sp-output-excess"]`).boundingBox();
await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
await sleep(400);
const hovered = await excessLayers();
check("hovering the excess pill fades to connections over ends (4/3)", hovered?.[1]?.text === "4/3" && hovered[1].opacity === "1" && hovered[0].opacity === "0", JSON.stringify(hovered));
await page.screenshot({ path: `${OUT}/output-rules-badge-excess-hover.png`, clip: badgeClip });
await page.mouse.move(5, 500);
await page.locator('[data-id="save-checklist-toggle"]').click();
await sleep(500);
await page.screenshot({ path: `${OUT}/output-rules-checklist.png`, clip: { x: 0, y: 0, width: 700, height: 300 } });
await page.locator('[data-id="editor-save"]').click();
await sleep(600);
const toast = await page.getByText(/Cannot save/).first().textContent({ timeout: 3000 }).catch(() => null);
check("manual save is blocked with the output rule", !!toast && toast.includes("No invalid branching"), String(toast));

// ── (6) 같은 상태에서 대표 끝을 병렬로 켜면 정상 — 초과 없음·병렬 출구는 1로 세어 3/3·체크리스트 통과
const graph6 = await api("GET", `/api/versions/${host.draft.id}/graph`);
graph6.nodes = graph6.nodes.map((n) => (n.id === SP ? { ...n, parallel_outputs: ["__primary__"] } : n));
await api("PUT", `/api/versions/${host.draft.id}/graph`, { nodes: graph6.nodes, edges: graph6.edges, groups: graph6.groups ?? [] });
await openEditor();
check("a parallel end with two edges shows no excess", (await badgeText("sp-output-excess")) === null);
check("a parallel end counts once (3/3)", (await badgeText("sp-output-count")) === "3/3", String(await badgeText("sp-output-count")));
check("save checklist passes with the parallel end", (await checkOk("singleOutput")) === "true");

check("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${host.map.id}`).catch(() => undefined);
  await api("DELETE", `/api/maps/${target.map.id}`).catch(() => undefined);
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
