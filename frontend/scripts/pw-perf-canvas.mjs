// 캔버스 렌더 성능 측정 — API로 큰 맵(노드 N·분기·병렬·되돌림·입출력 링크·조건·영역)을 시드하고 에디터에서
// 로딩 · 대기(흐름 점·유리 효과) · 휠 이동 · 줌 · 노드 드래그 · 노드 선택 구간의 프레임 간격과 메인 스레드 시간을 잰다.
// 실행(frontend/ 에서, 반드시 운영 빌드 `next start` — dev 서버는 약 3배 과장):
//   BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-perf-canvas.mjs
//   NODES=120(기본) · RUNS=2(구간 반복, 중앙값) · PROFILE=drag 면 드래그 구간 CPU 프로파일 상위 함수 출력 · KEEP=1 시드 유지
//   MAP_ID=<id>&VERSION_ID=<id> 를 주면 시드 대신 그 맵을 잰다(A/B 비교 때 같은 맵 재사용).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const NODES = Number(process.env.NODES ?? 120);
const RUNS = Number(process.env.RUNS ?? 2);
const PROFILE = process.env.PROFILE ?? "";
const KEEP = process.env.KEEP === "1";
const H = { "X-Dev-User": "admin.sys", "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---- 시드: 행마다 왼→오 사슬, 6번째마다 판단(다음 행으로 갈래), 4번째마다 병렬 출구, 행 끝에서 앞 행으로 되돌림 ----
async function seedMap() {
  const tag = Date.now().toString(36);
  const id = (k) => `perf-${tag}-${k}`;
  const COLS = 12;
  const rows = Math.ceil(NODES / COLS);
  const nodes = [];
  const edges = [];
  const groups = [];
  nodes.push({ id: id("start"), title: "", node_type: "start", pos_x: -260, pos_y: 0 });
  for (let r = 0; r < rows; r += 1) {
    groups.push({ id: id(`g${r}`), label: `영역 ${r + 1}`, color: "" });
    for (let c = 0; c < COLS && r * COLS + c < NODES; c += 1) {
      const n = r * COLS + c;
      const isDecision = c % 6 === 5;
      nodes.push({
        id: id(`n${n}`),
        title: isDecision ? `판단 ${n}\n조건 확인` : `업무 단계 ${n} 처리 및 검토`,
        node_type: isDecision ? "decision" : "process",
        pos_x: c * 260,
        pos_y: r * 260,
        assignee_role: isDecision ? "" : "담당자",
        system: isDecision ? "" : "SAP",
        duration: isDecision ? "" : "1.30",
        start_condition: isDecision ? "" : "요청 접수",
        end_condition: isDecision ? "" : "결과 등록",
        input: `입력 ${n}`,
        input_links: n > 0 ? `io-${tag}-${n - 1}` : "",
        output: `산출 ${n}`,
        output_ids: `io-${tag}-${n}`,
        parallel_outputs: c % 4 === 2 ? ["__primary__"] : [],
        group_ids: [id(`g${r}`)],
      });
    }
  }
  const nodeId = (n) => id(`n${n}`);
  edges.push({ id: id("e-start"), source_node_id: id("start"), target_node_id: nodeId(0), label: "" });
  for (let n = 0; n < NODES; n += 1) {
    const c = n % COLS;
    const next = n + 1 < NODES && c < COLS - 1 ? n + 1 : null;
    const below = n + COLS < NODES ? n + COLS : null;
    if (c % 6 === 5) {
      if (next !== null) edges.push({ id: id(`e${n}-y`), source_node_id: nodeId(n), target_node_id: nodeId(next), label: "예" });
      if (below !== null) edges.push({ id: id(`e${n}-n`), source_node_id: nodeId(n), target_node_id: nodeId(below), label: "아니오" });
    } else if (c % 4 === 2 && next !== null && below !== null) {
      edges.push({ id: id(`e${n}-p1`), source_node_id: nodeId(n), target_node_id: nodeId(next), label: "" });
      edges.push({ id: id(`e${n}-p2`), source_node_id: nodeId(n), target_node_id: nodeId(below), label: "" });
    } else if (next !== null) {
      edges.push({ id: id(`e${n}`), source_node_id: nodeId(n), target_node_id: nodeId(next), label: "" });
    } else if (below !== null) {
      // 행 끝 → 다음 행 첫 노드(긴 되돌림, 교차 생성)
      edges.push({ id: id(`e${n}-wrap`), source_node_id: nodeId(n), target_node_id: nodeId(n + 1), label: "다음 단계" });
    }
  }
  nodes.push({ id: id("end"), title: "", node_type: "end", pos_x: COLS * 260, pos_y: (rows - 1) * 260 });
  edges.push({ id: id("e-end"), source_node_id: nodeId(NODES - 1), target_node_id: id("end"), label: "" });

  const directory = await api("GET", "/api/directory");
  const owning = (directory.users.find((u) => u.id === "admin.sys") ?? directory.users[0])?.org_path;
  const map = await api("POST", "/api/maps", { name: `Perf canvas ${NODES} ${tag}`, owning_department: owning, visibility: "private" });
  const detail = await api("GET", `/api/maps/${map.id}`);
  const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
  await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
  await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups });
  return { mapId: map.id, versionId: draft.id, edges: edges.length };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

function summarize(deltas) {
  if (deltas.length === 0) return { avg: 0, p95: 0, over33: 0, frames: 0 };
  const s = [...deltas].sort((a, b) => a - b);
  return {
    avg: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    over33: deltas.filter((d) => d > 33).length,
    frames: deltas.length,
  };
}

const seeded = process.env.MAP_ID
  ? { mapId: process.env.MAP_ID, versionId: process.env.VERSION_ID, edges: "?" }
  : await seedMap();
console.log(`map ${seeded.mapId} v${seeded.versionId} · ${NODES} nodes · ${seeded.edges} edges`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
// 원인 가르기 스위치 — GLASS=off(유리 효과 끄기) · MOTION=reduce(흐름 점 등 모션 축소)
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: process.env.MOTION === "reduce" ? "reduce" : "no-preference",
});
// CSS=<규칙> — 가설 확인용 스타일 덮어쓰기(예: 특정 filter 끄기)
await ctx.addInitScript((css) => {
  if (!css) return;
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  });
}, process.env.CSS ?? "");
await ctx.addInitScript((glassOff) => {
  if (glassOff) window.localStorage.setItem("bpm.glass", "off");
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "ko");
  // 표시 정보 — 조건·입출력까지 켠 무거운 상태로 잰다
  window.localStorage.setItem(
    "bpm.nodeDisplayFields.v2",
    JSON.stringify(["assignee", "system", "params", "input", "output", "conditions", "gmp"]),
  );
  // 프레임 기록기 — 시작/정지 사이 rAF 간격
  window.__perf = { on: false, last: 0, deltas: [] };
  const tick = (t) => {
    const p = window.__perf;
    if (p.on) {
      if (p.last) p.deltas.push(t - p.last);
      p.last = t;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, process.env.GLASS === "off");
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const metrics = async () => {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
};

const t0 = Date.now();
await page.goto(`${BASE}/maps/${seeded.mapId}?version=${seeded.versionId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 180_000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(3000);
// 저장된 화면 위치와 무관하게 같은 출발점 — 화면 맞춤
const fit = page.locator('button[title^="화면 맞춤"], button[title^="Fit"]').first();
if (await fit.count()) {
  await fit.click();
  await page.waitForTimeout(800);
}
const pane = await page.locator(".react-flow__pane").first().boundingBox();
const cx = pane.x + pane.width / 2;
const cy = pane.y + pane.height / 2;

// 구간 측정 — 프레임 간격 + 메인 스레드(스크립트·스타일·레이아웃) 시간
async function measure(name, action) {
  const results = [];
  for (let run = 0; run < RUNS; run += 1) {
    await page.waitForTimeout(400);
    const before = await metrics();
    await page.evaluate(() => {
      window.__perf.deltas = [];
      window.__perf.last = 0;
      window.__perf.on = true;
    });
    const start = Date.now();
    await action(run);
    const wall = Date.now() - start;
    const deltas = await page.evaluate(() => {
      window.__perf.on = false;
      return window.__perf.deltas;
    });
    const after = await metrics();
    const ms = (k) => (after[k] - before[k]) * 1000;
    results.push({
      ...summarize(deltas),
      busy: ms("TaskDuration") / wall,
      script: ms("ScriptDuration"),
      style: ms("RecalcStyleDuration"),
      layout: ms("LayoutDuration"),
      wall,
    });
  }
  const pick = (k) => median(results.map((r) => r[k]));
  console.log(
    `${name.padEnd(10)} avg ${pick("avg").toFixed(1)}ms · p95 ${pick("p95").toFixed(1)}ms · >33ms ${pick("over33")} / ${pick("frames")}f` +
      ` · busy ${(pick("busy") * 100).toFixed(0)}% · script ${pick("script").toFixed(0)} style ${pick("style").toFixed(0)} layout ${pick("layout").toFixed(0)}ms`,
  );
}

async function withProfile(name, fn) {
  if (PROFILE !== name) return fn();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await fn();
  const { profile } = await cdp.send("Profiler.stop");
  // 함수별 self 샘플 합산 → 상위 25
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [nodeId, count] of counts) {
    const node = byId.get(nodeId);
    const { functionName, url, lineNumber } = node.callFrame;
    const key = `${functionName || "(anon)"} ${url.split("/").pop()}:${lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + count);
  }
  const total = profile.samples.length;
  // CALLERS_OF=<함수 이름> — 그 함수가 self로 잡힌 샘플의 호출자 체인(상위 5단)을 합산해 누가 부르는지 본다
  const callersOf = process.env.CALLERS_OF;
  if (callersOf) {
    const parent = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const chains = new Map();
    for (const [nodeId, count] of counts) {
      if (byId.get(nodeId).callFrame.functionName !== callersOf) continue;
      const chain = [];
      let cur = parent.get(nodeId);
      while (cur !== undefined && chain.length < 6) {
        const f = byId.get(cur).callFrame;
        chain.push(`${f.functionName || "(anon)"}@${f.url.split("/").pop()}:${f.lineNumber}`);
        cur = parent.get(cur);
      }
      const key = chain.join(" < ");
      chains.set(key, (chains.get(key) ?? 0) + count);
    }
    console.log(`-- callers of ${callersOf}`);
    for (const [key, count] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`   ${((count / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
    }
  }
  // INCLUSIVE=1 — 우리 소스(src/) 함수의 포함 시간: 샘플 스택에 그 함수가 있으면 1회 계산(어떤 컴포넌트가 렌더를 일으키는지)
  if (process.env.INCLUSIVE === "1") {
    const parent = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const inclusive = new Map();
    for (const [nodeId, count] of counts) {
      const seen = new Set();
      let cur = nodeId;
      while (cur !== undefined) {
        const f = byId.get(cur).callFrame;
        if (f.url.includes("/src/")) {
          const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}`;
          if (!seen.has(key)) {
            seen.add(key);
            inclusive.set(key, (inclusive.get(key) ?? 0) + count);
          }
        }
        cur = parent.get(cur);
      }
    }
    console.log(`-- inclusive (src/) ${name}`);
    for (const [key, count] of [...inclusive.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`   ${((count / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
    }
  }
  console.log(`-- profile ${name}: ${total} samples`);
  for (const [key, count] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`   ${((count / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
  }
}

console.log(`load       ${loadMs}ms (첫 연결선까지)`);
await withProfile("idle", () => measure("idle", () => page.waitForTimeout(3000)));
await withProfile("pan", () =>
  measure("pan", async (run) => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.wheel(0, (run % 2 === 0 ? 1 : -1) * 40);
      await page.waitForTimeout(16);
    }
  }),
);
await withProfile("zoom", () =>
  measure("zoom", async (run) => {
    await page.mouse.move(cx, cy);
    await page.keyboard.down("Control");
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.wheel(0, (i < 10) === (run % 2 === 0) ? -20 : 20);
      await page.waitForTimeout(30);
    }
    await page.keyboard.up("Control");
  }),
);
// 드래그 대상 고르기 — 화면 가운데에 가장 가까운 노드(맞춤·확대 두 상태에서 쓴다)
const pickTarget = () =>
  page.evaluate(({ cx, cy }) => {
    let best = null;
    for (const el of document.querySelectorAll(".react-flow__node")) {
      const r = el.getBoundingClientRect();
      const midX = r.x + r.width / 2;
      if (r.width < 10 || midX < 0 || r.y < 0 || midX > innerWidth || r.y > innerHeight) continue;
      const d = Math.hypot(midX - cx, r.y + 6 - cy);
      if (!best || d < best.d) best = { d, x: midX, y: r.y + Math.min(12, r.height / 3) };
    }
    return best;
  }, { cx, cy });
const dragGesture = (point) => async (run) => {
  const dir = run % 2 === 0 ? 1 : -1;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let i = 1; i <= 50; i += 1) {
    await page.mouse.move(point.x + dir * i * 4, point.y + dir * i * 2);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};
// 1) 맵 전체가 보이는 화면 맞춤 상태에서 드래그 — 연결선·라벨 전부가 화면에 있는 가장 무거운 경우
if (await fit.count()) {
  await fit.click();
  await page.waitForTimeout(600);
}
const fitTarget = await pickTarget();
if (fitTarget) await withProfile("drag-fit", () => measure("drag-fit", dragGesture(fitTarget)));
if (await fit.count()) {
  await fit.click();
  await page.waitForTimeout(600);
}
await page.mouse.move(cx, cy);
await page.keyboard.down("Control");
for (let i = 0; i < 6; i += 1) {
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(60);
}
await page.keyboard.up("Control");
await page.waitForTimeout(600);
const target = await page.evaluate(({ cx, cy }) => {
  let best = null;
  for (const el of document.querySelectorAll(".react-flow__node")) {
    const r = el.getBoundingClientRect();
    const midX = r.x + r.width / 2;
    if (r.width < 10 || midX < 0 || r.y < 0 || midX > innerWidth || r.y > innerHeight) continue;
    const d = Math.hypot(r.x + r.width / 2 - cx, r.y + 12 - cy);
    if (!best || d < best.d) best = { d, x: r.x + r.width / 2, y: r.y + 12 };
  }
  return best;
}, { cx, cy });
const nodeAt = (x, y) =>
  page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".react-flow__node")?.getAttribute("data-id") ?? null, { x, y });
const dragNodeId = await nodeAt(target.x, target.y);
console.log(`drag target ${dragNodeId ?? "(none — 드래그가 노드를 잡지 못함)"}`);
await withProfile("drag", () =>
  measure("drag", async (run) => {
    const dir = run % 2 === 0 ? 1 : -1;
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let i = 1; i <= 50; i += 1) {
      await page.mouse.move(target.x + dir * i * 4, target.y + dir * i * 2);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  }),
);
await withProfile("select", () =>
  measure("select", async () => {
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(250);
      await page.mouse.click(pane.x + 20, pane.y + pane.height - 20);
      await page.waitForTimeout(250);
    }
  }),
);

await browser.close();
if (!KEEP && !process.env.MAP_ID) await api("DELETE", `/api/maps/${seeded.mapId}`).catch(() => undefined);
