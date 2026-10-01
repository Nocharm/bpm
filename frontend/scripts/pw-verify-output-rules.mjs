// 출력 규칙 통일 검증(feat/output-rules) — SP 들어오는 핸들 시작 불가·드래그 중에만 노출(P1).
// 시드는 pw-verify-sp-ends.mjs와 같은 3끝(승인*·반려·보류) 링크 맵 + 호스트 맵.
// (11)~(14)는 복제·붙여넣기·AI 병렬 출구 배선: 시작 노드 기본 병렬·⌘/Ctrl 드래그 단독 복제는 병렬 해제·
// 레거시 gateway 병렬 묶음 복사·AI ops(set_attr parallel) 적용 후 저장.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-output-rules.mjs
//   산출물 .shots/output-rules-*.png (gitignore). 전제: admin.sys 시드(reset_db).
//   (14)는 AI 패널 입력이 열려야 해서 backend AI_ENABLED=true가 필요하다(응답은 page.route 목). 꺼져 있으면 SKIP.
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
// ⌘/Ctrl — 드래그 복제·다중 선택·복사/붙여넣기 조합키(앱은 ctrlKey || metaKey를 받는다)
const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

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

// ── (7) 흐름 펄스: 병렬 출구(SP 대표 끝 2갈래)·분기(Q의 Yes/No) 엣지마다 점 1개, 일반 엣지엔 없음
const pulseCount = (edgeId) =>
  page.evaluate((id) => document.querySelectorAll(`.react-flow__edge[data-id="${id}"] .bpm-edge-pulse`).length, edgeId);
check("parallel branches carry a pulse", (await pulseCount(nid("e-d"))) === 1 && (await pulseCount(nid("e-extra"))) === 1);
check("decision branches carry a pulse", (await pulseCount(nid("e-yes"))) === 1 && (await pulseCount(nid("e-no"))) === 1);
check("plain edges carry no pulse", (await pulseCount(nid("e-a"))) === 0 && (await pulseCount(nid("e-r"))) === 0);
const sp7 = await nodeBox(SP);
await page.mouse.move(sp7.x + sp7.width / 2, sp7.y + sp7.height / 2);
await sleep(400);
const badge7 = page.locator(`.react-flow__node[data-id="${SP}"] [data-id="node-parallel-badge"]`);
const badgeText7 = await badge7.textContent().catch(() => null);
check("hovering a parallel node shows the parallel badge", !!badgeText7 && badgeText7.includes("2 in parallel"), String(badgeText7));
await page.screenshot({ path: `${OUT}/output-rules-parallel-hover.png`, clip: { x: sp7.x - 60, y: sp7.y - 80, width: 760, height: 520 } });
await page.mouse.move(5, 500);

// ── (8) 우클릭 메뉴 토글: 요청 접수(출력 1개)에 병렬 출구를 켜면 "병렬인데 1개"로 체크리스트 미충족, 끄면 복구
const aBox = await nodeBox(nid("a"));
await page.mouse.click(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2, { button: "right" });
await sleep(400);
const parallelCheck = page.locator('[data-id="context-menu-check-Parallel exit"]');
check("node context menu offers the parallel exit toggle", await parallelCheck.isVisible().catch(() => false));
await page.screenshot({ path: `${OUT}/output-rules-context-menu.png`, clip: { x: aBox.x - 20, y: aBox.y - 20, width: 420, height: 460 } });
await parallelCheck.click();
await page.keyboard.press("Escape");
await sleep(500);
check("a parallel exit with one edge fails the checklist", (await checkOk("singleOutput")) === "false");
await page.mouse.click(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2, { button: "right" });
await sleep(400);
await parallelCheck.click();
await page.keyboard.press("Escape");
await sleep(500);
check("turning it off restores the checklist", (await checkOk("singleOutput")) === "true");

// ── (9) 병렬 출구에선 갈래를 더해도 삽입/교체 모달 없이 바로 추가 + 나중에 생긴 갈래도 펄스 박자가 형제와 같다
const nNode = nid("n");
const nBox9 = await nodeBox(nNode);
await page.mouse.click(nBox9.x + nBox9.width / 2, nBox9.y + nBox9.height / 2, { button: "right" });
await sleep(400);
await page.locator('[data-id="context-menu-check-Parallel exit"]').click();
await page.keyboard.press("Escape");
await sleep(400);
const before9 = await edgeCount();
for (const target of [nid("y1"), nid("end")]) {
  const from = center(await handleBox(nNode, "s-right"));
  const to = center(await nodeBox(target));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await sleep(900);
}
check("a parallel exit takes a second branch without the conflict modal", (await edgeCount()) === before9 + 2, `${before9} -> ${await edgeCount()}`);
await sleep(1500);
const clocks = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__edge .bpm-edge-pulse")].map((dot) => dot.ownerSVGElement.getCurrentTime()),
);
const spread = Math.max(...clocks) - Math.min(...clocks);
check("pulse clocks stay in phase across edges added later", clocks.length >= 2 && spread < 0.15, `spread ${spread.toFixed(3)}s over ${clocks.length}`);

// ── (10) SP 끝별 병렬 — 우클릭 "Parallel exit" 하위 메뉴에 끝 이름 체크(승인은 병렬 켜짐)
const sp10 = await nodeBox(SP);
await page.mouse.click(sp10.x + sp10.width / 2, sp10.y + sp10.height / 2, { button: "right" });
await sleep(400);
await page.locator('[data-id="context-menu"]').getByText("Parallel exit", { exact: true }).hover();
await sleep(500);
const endChecks = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitemcheckbox"]')].map((el) => `${el.textContent?.trim()}:${el.getAttribute("aria-checked")}`),
);
check("subprocess menu lists each end as a parallel check (primary on)", ["승인:true", "반려:false", "보류:false"].every((v) => endChecks.includes(v)), endChecks.join(","));
await page.screenshot({ path: `${OUT}/output-rules-sp-parallel-menu.png`, clip: { x: sp10.x - 20, y: sp10.y - 20, width: 640, height: 460 } });
await page.keyboard.press("Escape");

// ── (11) 시드 추가: 시작에 갈래 2개(속성 없음) · 레거시 gateway 병렬 묶음 G(속성 없이 두 엣지 gateway=parallel) ·
//         단독 복제용 병렬 노드 L(속성 켜짐, 갈래 2개). 시작은 기본 병렬이라(172e8c69) 체크리스트를 통과해야 한다
await sleep(1500); // (9) 자동 저장이 끝난 뒤 덮어쓴다
const graph11 = await api("GET", `/api/versions/${host.draft.id}/graph`);
const G = nid("g");
const L = nid("l");
graph11.nodes.push(
  { id: G, title: "병렬 시작", node_type: "process", pos_x: 1500, pos_y: 640 },
  { id: nid("g1"), title: "병렬 갈래 1", node_type: "process", pos_x: 1820, pos_y: 560 },
  { id: nid("g2"), title: "병렬 갈래 2", node_type: "process", pos_x: 1820, pos_y: 760 },
  { id: L, title: "단독 병렬", node_type: "process", pos_x: 1500, pos_y: 1160, parallel_outputs: ["__primary__"] },
  { id: nid("l1"), title: "단독 갈래 1", node_type: "process", pos_x: 1820, pos_y: 1080 },
  { id: nid("l2"), title: "단독 갈래 2", node_type: "process", pos_x: 1820, pos_y: 1260 },
);
graph11.edges.push(
  { id: nid("e-s2"), source_node_id: nid("start"), target_node_id: nid("i") },
  { id: nid("e-g1"), source_node_id: G, target_node_id: nid("g1"), gateway: "parallel" },
  { id: nid("e-g2"), source_node_id: G, target_node_id: nid("g2"), gateway: "parallel" },
  { id: nid("e-l1"), source_node_id: L, target_node_id: nid("l1") },
  { id: nid("e-l2"), source_node_id: L, target_node_id: nid("l2") },
);
await api("PUT", `/api/versions/${host.draft.id}/graph`, { nodes: graph11.nodes, edges: graph11.edges, groups: graph11.groups ?? [] });
await openEditor();
check("a two-edge start and a legacy gateway bundle pass the checklist on load", (await checkOk("singleOutput")) === "true");
const startBox = await nodeBox(nid("start"));
await page.mouse.click(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2, { button: "right" });
await sleep(400);
const startMenuOpen = await page.locator('[data-id="context-menu"]').isVisible().catch(() => false);
const startParallelItems = await page.locator('[data-id="context-menu"]').getByText("Parallel exit", { exact: true }).count();
check("the start node menu has no parallel exit item", startMenuOpen && startParallelItems === 0, `menu=${startMenuOpen} items=${startParallelItems}`);
await page.keyboard.press("Escape");
await sleep(300);

// ── (12) ⌘/Ctrl 드래그로 병렬 노드 L만 복제 — 갈래가 같이 오지 않으니 사본의 병렬 출구는 꺼지고 원본은 그대로
const nodeIds = () => page.evaluate(() => [...document.querySelectorAll(".react-flow__node")].map((el) => el.getAttribute("data-id")));
const idsBefore12 = new Set(await nodeIds());
const lBox = await nodeBox(L);
const l1Box = await nodeBox(nid("l1"));
const flowScale = (center(l1Box).x - center(lBox).x) / 320; // L→L1 저장 x 간격 320으로 화면 배율 환산(폭이 같은 노드)
const lFrom = center(lBox);
const lTo = { x: lFrom.x, y: lFrom.y - 150 * flowScale }; // 위쪽 빈 자리(갈래 엣지는 L 오른쪽에서 출발)
await page.keyboard.down(MOD_KEY);
await page.mouse.move(lFrom.x, lFrom.y);
await page.mouse.down();
for (let i = 1; i <= 10; i += 1) {
  await page.mouse.move(lFrom.x, lFrom.y + ((lTo.y - lFrom.y) * i) / 10, { steps: 1 });
}
await sleep(120);
await page.mouse.up();
await page.keyboard.up(MOD_KEY);
await sleep(600);
const copyId12 = (await nodeIds()).find((id) => !idsBefore12.has(id));
check("modifier-dragging a lone parallel node adds one copy", !!copyId12, String(copyId12));
if (copyId12) {
  const copyBox = await nodeBox(copyId12);
  await page.mouse.click(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2, { button: "right" });
  await sleep(400);
  const copyChecked = await page.locator('[data-id="context-menu-check-Parallel exit"]').getAttribute("aria-checked").catch(() => null);
  check("the copy's parallel exit is off in the context menu", copyChecked === "false", String(copyChecked));
  await page.keyboard.press("Escape");
  await sleep(1500);
  const saved12 = await api("GET", `/api/versions/${host.draft.id}/graph`);
  const copy12 = saved12.nodes.find((n) => n.id === copyId12);
  const original12 = saved12.nodes.find((n) => n.id === L);
  check(
    "the saved copy has no parallel exit and the original keeps it",
    JSON.stringify(copy12?.parallel_outputs ?? null) === "[]" && JSON.stringify(original12?.parallel_outputs) === '["__primary__"]',
    `copy=${JSON.stringify(copy12?.parallel_outputs)} original=${JSON.stringify(original12?.parallel_outputs)}`,
  );
  check("the checklist stays green after the duplicate", (await checkOk("singleOutput")) === "true");
}

// ── (13) 레거시 gateway 병렬 묶음(G+갈래 2) 복사·붙여넣기 — gateway가 같이 와서 사본도 병렬로 읽히고 체크리스트 유지
await openEditor();
const idsBefore13 = new Set(await nodeIds());
await page.locator(`.react-flow__node[data-id="${G}"]`).click({ force: true });
await page.keyboard.down(MOD_KEY);
await page.locator(`.react-flow__node[data-id="${nid("g1")}"]`).click({ force: true });
await page.locator(`.react-flow__node[data-id="${nid("g2")}"]`).click({ force: true });
await page.keyboard.up(MOD_KEY);
await sleep(150);
check("the legacy bundle is selected (3 nodes)", (await page.locator(".react-flow__node.selected").count()) === 3);
await page.keyboard.press(`${MOD_KEY}+C`);
await sleep(150);
await page.keyboard.press(`${MOD_KEY}+V`);
await sleep(600);
const pasted13 = (await nodeIds()).filter((id) => !idsBefore13.has(id));
check("pasting the bundle adds 3 nodes", pasted13.length === 3, `${pasted13.length}`);
check("the checklist stays green after pasting a legacy parallel bundle", (await checkOk("singleOutput")) === "true");
await sleep(1500);
const saved13 = await api("GET", `/api/versions/${host.draft.id}/graph`);
const pastedSet13 = new Set(pasted13);
const pastedEdges13 = saved13.edges.filter((e) => pastedSet13.has(e.source_node_id) && pastedSet13.has(e.target_node_id));
check("the pasted branches keep gateway parallel", pastedEdges13.length === 2 && pastedEdges13.every((e) => e.gateway === "parallel"), JSON.stringify(pastedEdges13.map((e) => e.gateway)));
await page.screenshot({ path: `${OUT}/output-rules-paste-legacy-bundle.png` });

// ── (14) AI ops 적용: 새 노드 P 추가 + 기존 I에 set_attr {parallel:true} + I→P·P→보류 처리 연결 → 저장 후
//         GET /graph의 I.parallel_outputs가 ['__primary__']이고 체크리스트 통과(I는 Q·P 두 갈래).
//         set_attr는 기존 노드에만 적용되므로(applyAiOps) 병렬 대상은 새 노드가 아니라 I다
await openEditor();
const opsReply = {
  kind: "ops",
  message: "병렬 갈래를 추가했습니다.",
  nodes: [],
  edges: [],
  groups: [],
  ops: [
    { action: "add", node_id: null, node: { key: "p", title: "병렬 통보", node_type: "process", description: "", attributes: null, group_key: null }, source: null, target: null, label: null, title: null, attributes: null, description: null },
    { action: "set_attr", node_id: nid("i"), node: null, source: null, target: null, label: null, title: null, attributes: { parallel: true }, description: null },
    { action: "connect", node_id: null, node: null, source: nid("i"), target: "p", label: null, title: null, attributes: null, description: null },
    { action: "connect", node_id: null, node: null, source: "p", target: nid("y2"), label: null, title: null, attributes: null, description: null },
  ],
  steps: [],
  findings: [],
  session_id: null,
};
await page.route("**/ai/chat", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opsReply) }),
);
// 상단 AI 메뉴(드롭다운)에서 채팅 항목을 골라야 채팅 창이 열린다
await page.locator('[data-id="ai-menu"]').click();
await page.locator('[data-id="ai-menu-chat"]').click();
await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 });
await sleep(800); // AI 활성 여부(aiEnabled)는 비동기로 도착 — 초기 비활성 상태를 SKIP으로 오판하지 않게
const chatInput = page.locator('textarea[maxlength="2000"]');
if (await chatInput.isDisabled()) {
  console.log("SKIP (14) AI ops parallel - AI panel disabled (start backend with AI_ENABLED=true)");
} else {
  await chatInput.fill("접수 확인 뒤에 병렬로 통보를 추가해줘");
  await chatInput.locator("xpath=following-sibling::button").click();
  const addToMap = page.getByRole("button", { name: "Add to map" }).first();
  await addToMap.waitFor({ state: "visible", timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/output-rules-ai-ops-preview.png` });
  await addToMap.click();
  await sleep(2000);
  const saved14 = await api("GET", `/api/versions/${host.draft.id}/graph`);
  const iNode = saved14.nodes.find((n) => n.id === nid("i"));
  const added14 = saved14.nodes.find((n) => n.title === "병렬 통보");
  const iOut = saved14.edges.filter((e) => e.source_node_id === nid("i"));
  check("AI set_attr parallel saves the primary exit as parallel", JSON.stringify(iNode?.parallel_outputs) === '["__primary__"]', JSON.stringify(iNode?.parallel_outputs));
  check(
    "AI add and connects land (I has 2 branches, P to the hold step)",
    !!added14 && iOut.length === 2 && saved14.edges.some((e) => e.source_node_id === added14.id && e.target_node_id === nid("y2")),
    `out=${iOut.length} added=${!!added14}`,
  );
  check("the checklist passes after the AI parallel edit", (await checkOk("singleOutput")) === "true");
}
await page.unroute("**/ai/chat");

check("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${host.map.id}`).catch(() => undefined);
  await api("DELETE", `/api/maps/${target.map.id}`).catch(() => undefined);
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
