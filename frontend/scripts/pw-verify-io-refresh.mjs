// 2026-10-02 요청 검증 — 흐름 펄스(병렬 75%·분기 동시 출발→반짝임→랜덤 1갈래·포커스 1.25배속·형제 선택 정지·
// L5 어두운 배경 대비), 병렬 해제 시 임포트 gateway 소거(일반 맵 + L5 캔버스 확정 게이트), 핸들 연결 위치 유지,
// 병렬 노드 안쪽 링, 임포트 L6 끝 노드 빈 제목.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-io-refresh.mjs
//   전제: admin.sys 시드(reset_db) + pw-smoke-framework-canvas.mjs로 L5 캔버스 임포트(없으면 L5 단계 SKIP).
//   산출물 .shots/io-refresh/*.png (gitignore). 펄스 프레임은 svg 시계를 멈춰 같은 시각으로 맞춰 찍는다.
import { mkdirSync, readFileSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots/io-refresh";
const NAME = "IO refresh verify";
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
async function waitFor(fn, ms = 12_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(400);
  }
  return false;
}

// ── 시드: 일반 맵 하나에 병렬 출발 A(속성)·분기 D(갈래 3)·레거시 병렬 K(gateway만)·핸들 연결용 H/I
for (const stale of (await api("GET", "/api/maps")).filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const tag = Date.now().toString(36);
const nid = (key) => `ior-${tag}-${key}`;
const map = await api("POST", "/api/maps", { name: `${NAME} ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
const node = (key, title, type, x, y, extra = {}) => ({ id: nid(key), title, node_type: type, pos_x: x, pos_y: y, ...extra });
const edge = (key, s, t, extra = {}) => ({ id: nid(key), source_node_id: nid(s), target_node_id: nid(t), ...extra });
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    node("s", "시작", "start", 0, 300),
    node("a", "병렬 출발", "process", 280, 120, { parallel_outputs: ["__primary__"] }),
    node("b", "동시 작업 1", "process", 640, 20),
    node("c", "동시 작업 2", "process", 640, 220),
    node("d", "검토 결과?", "decision", 280, 520),
    node("e1", "승인 처리", "process", 640, 420),
    node("e2", "반려 처리", "process", 640, 600),
    node("e3", "보류 처리", "process", 640, 780),
    node("h", "핸들 출발", "process", 1000, 120),
    node("i", "핸들 도착", "process", 1300, 420),
    node("k", "임포트 병렬", "process", 1000, 700),
    node("l1", "갈래 L1", "process", 1350, 620),
    node("l2", "갈래 L2", "process", 1350, 820),
    node("p", "병렬 미연결", "process", 1650, 420, { parallel_outputs: ["__primary__"] }),
    node("end", "", "end", 1650, 120, { is_primary_end: true }),
  ],
  edges: [
    edge("s-a", "s", "a"),
    edge("s-d", "s", "d"),
    edge("a-b", "a", "b"),
    edge("a-c", "a", "c"),
    edge("d-e1", "d", "e1", { label: "Yes" }),
    edge("d-e2", "d", "e2", { label: "No" }),
    edge("d-e3", "d", "e3"),
    edge("k-l1", "k", "l1", { gateway: "parallel" }),
    edge("k-l2", "k", "l2", { gateway: "parallel" }),
  ],
  groups: [],
});
check("seeded the scratch map", true, `map ${map.id} v${draft.id}`);

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  if (window.location.protocol === "about:") return; // about:blank·setContent엔 localStorage가 없다
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => errors.push(`page: ${String(e).slice(0, 200)}`));

async function openEditor(mapId, versionId) {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
  await sleep(2500);
  await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
  await sleep(800);
}
const nodeBox = (id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
const handleBox = (nodeId, handleId) =>
  page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`).boundingBox();
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const checkOk = (key) => page.locator(`[data-id="save-check-${key}"]`).getAttribute("data-ok");
const dotSel = (edgeId) => `[data-testid="rf__edge-${edgeId}"] .bpm-edge-pulse`;
/** 엣지 펄스 점의 애니메이션 속성 — dur·keyPoints·fill·filter·stroke */
const dotInfo = (edgeId) =>
  page.evaluate((sel) => {
    const dot = document.querySelector(sel);
    if (!dot) return null;
    const motion = dot.querySelector("animateMotion");
    return {
      dur: motion?.getAttribute("dur"),
      begin: motion?.getAttribute("begin"),
      keyPoints: motion?.getAttribute("keyPoints"),
      fill: dot.getAttribute("fill"),
      stroke: dot.getAttribute("stroke"),
      filter: dot.style.filter,
      opacity: getComputedStyle(dot).opacity,
    };
  }, dotSel(edgeId));
/** 모든 펄스 svg 시계를 같은 시각으로 멈춘다(프레임 캡처) */
const freezeAt = (t) =>
  page.evaluate((time) => {
    for (const dot of document.querySelectorAll(".bpm-edge-pulse")) {
      const svg = dot.ownerSVGElement;
      svg.pauseAnimations();
      svg.setCurrentTime(time);
    }
  }, t);
const unfreeze = () =>
  page.evaluate(() => {
    for (const dot of document.querySelectorAll(".bpm-edge-pulse")) dot.ownerSVGElement.unpauseAnimations();
  });
async function clipOf(ids, pad = 40) {
  const boxes = (await Promise.all(ids.map((id) => nodeBox(id)))).filter(Boolean);
  const x = Math.min(...boxes.map((b) => b.x)) - pad;
  const y = Math.min(...boxes.map((b) => b.y)) - pad;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const btm = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: Math.max(0, x), y: Math.max(0, y), width: r - Math.max(0, x), height: btm - Math.max(0, y) };
}

await openEditor(map.id, draft.id);

// ── (10) 병렬 노드 안쪽 링 — 속성 병렬 A·미연결 속성 병렬 P·레거시 gateway 병렬 K·시작 팬아웃엔 링, 분기 D·일반 B엔 없음
const ringOf = (id) => page.locator(`.react-flow__node[data-id="${id}"] [data-id="node-parallel-ring"]`).count();
check("a flagged parallel node draws the inner ring", (await ringOf(nid("a"))) === 1);
check("a legacy gateway-parallel node draws the inner ring", (await ringOf(nid("k"))) === 1);
check("a flagged parallel node draws the ring before any connection", (await ringOf(nid("p"))) === 1);
check("a plain node has no inner ring", (await ringOf(nid("b"))) === 0);
check("a decision node has no inner ring", (await ringOf(nid("d"))) === 0);
await page.screenshot({ path: `${OUT}/parallel-ring.png`, clip: await clipOf([nid("a"), nid("b"), nid("c")], 30) });

// ── (3) 병렬 점은 경로 75%까지 — 재방출 주기 4.2s 유지
const par = await dotInfo(nid("a-b"));
check("parallel dot stops at 75% of the path", par?.keyPoints === "0;0.75;0.75", JSON.stringify(par));
check("parallel cycle stays 4.2s", par?.dur === "4.2s", String(par?.dur));
for (const [label, t] of [["move", 1.0], ["near-75", 1.65]]) {
  await freezeAt(t);
  await page.screenshot({ path: `${OUT}/pulse-parallel-${label}.png`, clip: await clipOf([nid("a"), nid("b"), nid("c")], 30) });
}
await unfreeze();

// ── (4) 분기: 갈래 3개가 같은 시계(begin 0·같은 dur), 회차마다 정확히 한 갈래만 0.5까지
const decisionEdges = [nid("d-e1"), nid("d-e2"), nid("d-e3")];
const dec = await Promise.all(decisionEdges.map((id) => dotInfo(id)));
check("decision branches start together (same dur, begin 0)", dec.every((d) => d && d.dur === dec[0].dur && d.begin === "0s"), dec.map((d) => d?.dur).join(","));
const maxPoint = (d) => Math.max(...String(d?.keyPoints ?? "0").split(";").map(Number));
check("some branch reaches 50% in its winning rounds", dec.some((d) => maxPoint(d) === 0.5), dec.map((d) => maxPoint(d)).join(","));
const decFrames = [["1-moving", 0.6], ["2-stopped-blink", 1.22], ["3-sequential", 2.0], ["4-sequential", 2.55], ["5-winner", 3.9], ["6-winner-far", 4.45]];
for (const [label, t] of decFrames) {
  await freezeAt(t);
  await page.screenshot({ path: `${OUT}/pulse-decision-${label}.png`, clip: await clipOf([nid("d"), nid("e1"), nid("e2"), nid("e3")], 30) });
}
await unfreeze();

// ── (5) 포커스: 분기 노드 선택 → 점 채도 상승·1.25배속
const normalDur = parseFloat(dec[0]?.dur ?? "0");
const dBox = await nodeBox(nid("d"));
await page.mouse.click(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2);
await sleep(600);
const focused = await dotInfo(nid("d-e1"));
check("selecting the decision speeds its dots up 1.25x", Math.abs(parseFloat(focused?.dur ?? "0") - normalDur / 1.25) < 0.01, `${normalDur} -> ${focused?.dur}`);
check("selecting the decision saturates its dots", /saturate/.test(focused?.filter ?? ""), String(focused?.filter));
await freezeAt(1.0);
await page.screenshot({ path: `${OUT}/pulse-decision-focused.png`, clip: await clipOf([nid("d"), nid("e1"), nid("e2"), nid("e3")], 30) });
await unfreeze();
await page.keyboard.press("Escape");
await sleep(400);

// ── (6) 형제 한 갈래 선택 → 나머지 갈래는 이번 회차 뒤 반복 중지, 선택 갈래는 계속
// 꺾인 경로의 bbox 중심은 선 위가 아니라 force 클릭이 빈 캔버스에 떨어진다 → 경로 위 한 점을 화면 좌표로 찍는다
const e1Point = await page.evaluate((edgeId) => {
  const path = document.querySelector(`[data-testid="rf__edge-${edgeId}"] path.react-flow__edge-path`);
  const at = path.getPointAtLength(path.getTotalLength() * 0.6);
  const m = path.getScreenCTM();
  return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
}, nid("d-e1"));
await page.mouse.click(e1Point.x, e1Point.y);
await sleep(300);
const e1Selected = await page.locator(`[data-testid="rf__edge-${nid("d-e1")}"]`).evaluate((el) => el.classList.contains("selected"));
check("clicking one decision branch selects it", e1Selected);
const cycleS = normalDur / 8 + 0.4; // 회차 길이(8회차 수열) + 여유
await sleep(cycleS * 1000);
const sampleOpacity = (id) => page.evaluate((sel) => Number(getComputedStyle(document.querySelector(sel)).opacity), dotSel(id));
let siblingMax = 0;
let selectedMax = 0;
for (let i = 0; i < 12; i += 1) {
  siblingMax = Math.max(siblingMax, await sampleOpacity(nid("d-e2")), await sampleOpacity(nid("d-e3")));
  selectedMax = Math.max(selectedMax, await sampleOpacity(nid("d-e1")));
  await sleep(450);
}
check("the other branches stop after the current round", siblingMax === 0, `sibling max ${siblingMax}`);
check("the selected branch keeps pulsing", selectedMax > 0, `selected max ${selectedMax}`);
// 선택 해제 = 빈 캔버스 클릭(onPaneClick). Esc는 RF 표시 선택만 지우고 에디터 selectedEdgeId는 남긴다.
const panePoint = await page.evaluate(() => {
  for (let y = 900; y > 100; y -= 40) {
    for (let x = 1550; x > 100; x -= 40) {
      if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
    }
  }
  return null;
});
await page.mouse.click(panePoint.x, panePoint.y);
await sleep(300);
check("the branch is deselected", !(await page.locator(`[data-testid="rf__edge-${nid("d-e1")}"]`).evaluate((el) => el.classList.contains("selected"))));
let resumed = 0;
for (let i = 0; i < 16 && resumed === 0; i += 1) {
  resumed = Math.max(await sampleOpacity(nid("d-e2")), await sampleOpacity(nid("d-e3")));
  await sleep(400);
}
check("clearing the selection resumes the siblings", resumed > 0, `resumed ${resumed}`);

// ── (9) 핸들 → 핸들 연결: 잡은 변·놓은 변 그대로 저장(일반·분기 출발)
async function dragHandle(fromNode, fromHandle, toNode, toHandle) {
  const from = center(await handleBox(fromNode, fromHandle));
  const to = center(await handleBox(toNode, toHandle));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y - 25, { steps: 12 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await sleep(700);
}
await openEditor(map.id, draft.id);
await dragHandle(nid("h"), "s-bottom", nid("i"), "t-top");
await dragHandle(nid("d"), "s-bottom", nid("i"), "t-right");
await page.locator('[data-id="edge-branch-modal"] button:has-text("Other")').click();
await sleep(400);
const savedHandles = await waitFor(async () => {
  const g = await api("GET", `/api/versions/${draft.id}/graph`);
  const hi = g.edges.find((e) => e.source_node_id === nid("h") && e.target_node_id === nid("i"));
  const di = g.edges.find((e) => e.source_node_id === nid("d") && e.target_node_id === nid("i"));
  return hi?.source_handle === "s-bottom" && hi?.target_handle === "t-top" && di?.source_handle === "s-bottom" && di?.target_handle === "t-right";
});
check("handle-to-handle connections keep the grabbed and dropped sides (process and decision)", savedHandles);
await page.screenshot({ path: `${OUT}/handle-connect.png`, clip: await clipOf([nid("h"), nid("i"), nid("d")], 40) });

// ── (2) 임포트식 레거시 병렬(gateway만) — 메뉴에 켜짐으로 보이고, 끄면 gateway까지 지워져 체크리스트가 잡는다
check("legacy gateway fan-out passes the checklist before", (await checkOk("singleOutput")) === "true");
const kBox = await nodeBox(nid("k"));
await page.mouse.click(kBox.x + kBox.width / 2, kBox.y + kBox.height / 2, { button: "right" });
await sleep(400);
const toggle = page.locator('[data-id="context-menu-check-Parallel exit"]');
check("the legacy exit shows as parallel in the menu", (await toggle.getAttribute("aria-checked")) === "true");
await toggle.click();
await page.keyboard.press("Escape");
await sleep(600);
check("turning it off makes the checklist catch the fan-out", (await checkOk("singleOutput")) === "false");
const cleared = await waitFor(async () => {
  const g = await api("GET", `/api/versions/${draft.id}/graph`);
  return g.edges.filter((e) => e.source_node_id === nid("k")).every((e) => !e.gateway);
});
check("turning it off clears gateway=parallel on that exit's edges", cleared);

// ── (7) 임포트 L6 끝 노드 빈 제목 + (2)(8) L5 캔버스
const allMaps = await api("GET", "/api/maps");
const imported = allMaps.filter((m) => m.consultant_code && m.mode !== "framework");
if (imported.length > 0) {
  const l6 = await api("GET", `/api/maps/${imported[0].id}`);
  const v = (l6.versions ?? []).find((x) => x.status === "published") ?? l6.versions[0];
  const g = await api("GET", `/api/versions/${v.id}/graph`);
  const end = g.nodes.find((n) => n.node_type === "end");
  check("an imported L6 end node is created untitled", end?.title === "", `${imported[0].name}: "${end?.title}"`);
} else {
  console.log("SKIP (7) no imported L6 maps (run pw-smoke-framework-canvas.mjs first)");
}

const canvas = allMaps.find((m) => m.mode === "framework");
if (!canvas) {
  console.log("SKIP (2)(8) L5 canvas - none seeded (run pw-smoke-framework-canvas.mjs first)");
} else {
  const cDetail = await api("GET", `/api/maps/${canvas.id}`);
  const cDraft = (cDetail.versions ?? []).find((x) => x.status === "draft");
  await api("POST", `/api/versions/${cDraft.id}/checkout`, { force: true });
  const g = await api("GET", `/api/versions/${cDraft.id}/graph`);
  // 이전 실행 잔여(-par- 엣지·병렬 표시) 정리 후 원본 스냅샷 — 끝에서 되돌린다
  g.edges = g.edges.filter((e) => !e.id.includes("-par-"));
  for (const n of g.nodes) {
    if (n.node_type === "subprocess") n.parallel_outputs = [];
  }
  const original = JSON.parse(JSON.stringify(g));
  const sps = g.nodes.filter((n) => n.node_type === "subprocess");
  const outOf = (id) => g.edges.filter((e) => e.source_node_id === id);
  const x = sps.find((n) => outOf(n.id).length === 1);
  const z = x && sps.find((n) => n.id !== x.id && !outOf(x.id).some((e) => e.target_node_id === n.id) && !outOf(n.id).some((e) => e.target_node_id === x.id));
  if (!x || !z) {
    console.log("SKIP (2) L5 canvas has no subprocess pair to fan out");
  } else {
    // 임포트가 남기는 모양 — 출발 SP 속성 병렬 + 두 엣지 gateway=parallel
    x.parallel_outputs = ["__primary__"];
    for (const e of outOf(x.id)) e.gateway = "parallel";
    g.edges.push({ id: `${x.id}-par-${tag}`, source_node_id: x.id, target_node_id: z.id, label: "", gateway: "parallel", source_handle: "__primary__", target_handle: "in" });
    await api("PUT", `/api/versions/${cDraft.id}/graph`, { nodes: g.nodes, edges: g.edges, groups: g.groups });
    const plainFanout = async () => ((await api("GET", `/api/maps/${canvas.id}/confirm-readiness`)).failures ?? []).find((f) => f.code === "plain_fanout")?.node_ids ?? [];
    check("L5 canvas: the imported-style parallel fan-out passes gate 6", !(await plainFanout()).includes(x.id));
    await openEditor(canvas.id, cDraft.id);
    // (8) 어두운 하늘 — 점은 밝은 색 + 얇은 밝은 테두리
    const darkPar = await dotInfo(`${x.id}-par-${tag}`);
    check("L5 canvas: parallel dots use the sky accent with a light outline", darkPar?.fill === "var(--color-accent-sky)" && darkPar?.stroke === "var(--color-surface)", JSON.stringify(darkPar));
    const decisionNode = g.nodes.find((n) => n.node_type === "decision" && outOf(n.id).length >= 2);
    if (decisionNode) {
      const darkDec = await dotInfo(outOf(decisionNode.id)[0].id);
      check("L5 canvas: decision dots are lightened with white", /color-mix\(.*white\)/.test(darkDec?.fill ?? ""), String(darkDec?.fill));
    }
    // 44% 맞춤 화면에선 점이 1px대라 노드 주변을 Ctrl+휠로 확대해 찍는다
    const shots = [["parallel", x.id, `${x.id}-par-${tag}`, 1.2]];
    if (decisionNode) shots.push(["decision", decisionNode.id, outOf(decisionNode.id)[0].id, 1.22]);
    for (const [label, sourceId, edgeId, t] of shots) {
      await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
      await sleep(600);
      const c = center(await nodeBox(sourceId));
      await page.mouse.move(c.x, c.y);
      await page.keyboard.down("Control");
      for (let i = 0; i < 2; i += 1) {
        await page.mouse.wheel(0, -120);
        await sleep(120);
      }
      await page.keyboard.up("Control");
      await sleep(700);
      await freezeAt(t);
      // 멈춘 점 주변을 캔버스 안쪽으로 자른다(노드끼리 멀어 노드 기준 크롭은 점을 놓친다)
      const dot = await page.locator(dotSel(edgeId)).boundingBox();
      const pane = await page.locator(".react-flow").first().boundingBox();
      const left = Math.max(pane.x, dot.x - 260);
      const top = Math.max(pane.y, dot.y - 170);
      const clip = {
        x: left,
        y: top,
        width: Math.min(pane.x + pane.width, dot.x + 260) - left,
        height: Math.min(pane.y + pane.height, dot.y + 170) - top,
      };
      await page.screenshot({ path: `${OUT}/l5-dark-pulse-${label}.png`, clip });
      await unfreeze();
    }
    await page.locator('[aria-label="Fit to view (top-left)"]').first().click();
    await sleep(600);
    // (2) 끝 분기 취소 — 우클릭 병렬 출구 끄기 → 확정 게이트 6이 잡는다
    const xBox = await nodeBox(x.id);
    await page.mouse.click(xBox.x + xBox.width / 2, xBox.y + xBox.height / 2, { button: "right" });
    await sleep(400);
    const xToggle = page.locator('[data-id="context-menu-check-Parallel exit"]');
    check("L5 canvas: the subprocess exit shows as parallel", (await xToggle.getAttribute("aria-checked")) === "true");
    await xToggle.click();
    await page.keyboard.press("Escape");
    const gated = await waitFor(async () => (await plainFanout()).includes(x.id), 15_000);
    check("L5 canvas: cancelling the parallel exit makes gate 6 flag the fan-out", gated);
  }
  await page.goto("about:blank"); // 에디터 자동 저장이 복원을 덮지 않게 먼저 떠난다
  await api("POST", `/api/versions/${cDraft.id}/checkout`, { force: true });
  await api("PUT", `/api/versions/${cDraft.id}/graph`, { nodes: original.nodes, edges: original.edges, groups: original.groups });
}

// 분기 펄스 프레임 한 장 모음(contact sheet) — 이미지를 data URI로 얹은 페이지를 찍는다
const sheetFrames = decFrames.map(([label, t]) => ({ label: `${label} (t=${t}s)`, src: `data:image/png;base64,${readFileSync(`${OUT}/pulse-decision-${label}.png`).toString("base64")}` }));
await page.setContent(
  `<body style="margin:0;padding:16px;background:#fff;font:14px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${sheetFrames
    .map((f) => `<figure style="margin:0"><img src="${f.src}" style="width:100%;border:1px solid #ddd"><figcaption>${f.label}</figcaption></figure>`)
    .join("")}</body>`,
);
await page.screenshot({ path: `${OUT}/pulse-decision-sheet.png`, fullPage: true });
check("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
if (process.env.KEEP !== "1") await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
