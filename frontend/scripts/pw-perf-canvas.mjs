// 캔버스 렌더 성능 측정 — API로 큰 맵(노드 N·분기·병렬·되돌림·입출력 링크·조건·영역)을 시드하고 에디터에서
// 로딩 · 대기(흐름 점·유리 효과) · 휠 이동 · 줌 · 노드 드래그 · 노드 선택 구간의 프레임 간격과 메인 스레드 시간을 잰다.
// 실행(frontend/ 에서, 반드시 운영 빌드 `next start` — dev 서버는 약 3배 과장):
//   BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-perf-canvas.mjs
//   NODES=120(기본) · RUNS=2(구간 반복, 중앙값 — 짝수면 큰 쪽. 드롭이 맵을 바꿔 첫 제스처와 이후가 다를 수 있다:
//   A/B는 RUNS=1로 새 시드를 여러 번) · PROFILE=drag 면 드래그 구간 CPU 프로파일 상위 함수 출력 · KEEP=1 시드 유지
//   MAP_ID=<id>&VERSION_ID=<id> 를 주면 시드 대신 그 맵을 잰다(A/B 비교 때 같은 맵 재사용 — 단 드래그·드롭이 자동 저장돼
//   배치가 실행마다 바뀐다. 재현이 필요하면 기본(매번 새 시드)으로).
//   ⚠️ PROFILE(CPU 프로파일러)·RENDERS는 측정 자체가 무겁다 — 프레임 수치는 둘 다 끈 실행으로 비교한다.
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
  // 프레임 기록기 — 시작/정지 사이 rAF 간격. 운영 빌드에서도 되는 가벼운 재렌더 계수: 노드·엣지 DOM의
  // React props 객체(__reactProps$…)가 바뀌면 그 래퍼(NodeWrapper·EdgeWrapper)가 그 커밋에서 다시 렌더된 것이다.
  window.__perf = { on: false, last: 0, deltas: [], nodeRenders: 0, edgeRenders: 0, seen: new WeakMap() };
  const propsOf = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return key === undefined ? undefined : el[key];
  };
  const countRenders = (selector) => {
    const p = window.__perf;
    let n = 0;
    for (const el of document.querySelectorAll(selector)) {
      const props = propsOf(el);
      if (p.seen.has(el) && p.seen.get(el) !== props) n += 1;
      p.seen.set(el, props);
    }
    return n;
  };
  const tick = (t) => {
    const p = window.__perf;
    if (p.on) {
      if (p.last) p.deltas.push(t - p.last);
      p.last = t;
      p.nodeRenders += countRenders(".react-flow__node");
      p.edgeRenders += countRenders(".react-flow__edge");
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, process.env.GLASS === "off");
// RENDERS=1 — 구간 동안 실제로 렌더된 컴포넌트 수·자기 시간(React 프로파일링 빌드 필요:
// `next build --profile --no-mangling`). DevTools 훅 자리에 기록기를 두고, 커밋마다 이번 커밋에서 시작된
// 파이버(actualStartTime > 직전 커밋 시각) 중 컴포넌트 함수가 실제로 실행된 것만 센다.
if (process.env.RENDERS === "1") {
  await ctx.addInitScript((why) => {
    const rec = { on: false, commits: 0, byName: new Map(), last: 0, why: "", why_hits: new Map(), ctxPrev: new Map() };
    window.__renders = rec;
    const nameOf = (f) => {
      const t = f.type;
      if (!t || typeof t === "string") return null;
      return t.displayName || t.name || t.render?.name || t.type?.name || null;
    };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        this.renderers.set(1, renderer);
        return 1;
      },
      onCommitFiberRoot(_id, root) {
        const since = rec.last;
        rec.last = performance.now();
        if (!rec.on) return;
        rec.commits += 1;
        const stack = [root.current];
        while (stack.length) {
          const f = stack.pop();
          // 방문(시각 갱신)만으로는 갱신된 자손으로 가는 경로의 bailout 조상까지 잡힌다 — PerformedWork(1) 플래그로 실제 렌더만
          if (f.actualStartTime !== undefined && f.actualStartTime > since && f.alternate && (f.flags & 1) === 1) {
            const name = nameOf(f);
            if (name) {
              let childDur = 0;
              for (let c = f.child; c; c = c.sibling) if (c.actualStartTime > since) childDur += c.actualDuration ?? 0;
              const e = rec.byName.get(name) ?? { n: 0, self: 0 };
              e.n += 1;
              e.self += Math.max(0, (f.actualDuration ?? 0) - childDur);
              rec.byName.set(name, e);
              // WHY=<컴포넌트> — 그 컴포넌트에서 이번 커밋에 값이 바뀐 state 훅(순번·값 모양)
              if (name === rec.why) {
                if (f.memoizedProps !== f.alternate.memoizedProps) rec.why_hits.set("props changed", (rec.why_hits.get("props changed") ?? 0) + 1);
                for (let d = f.dependencies?.firstContext; d; d = d.next) {
                  const cur = d.context._currentValue;
                  const key = `context ${d.context.displayName ?? "?"} = ${cur && typeof cur === "object" ? `{${Object.keys(cur).slice(0, 5).join(",")}}` : String(cur)}`;
                  if (d.memoizedValue !== rec.ctxPrev.get(d.context)) rec.why_hits.set(key, (rec.why_hits.get(key) ?? 0) + 1);
                  rec.ctxPrev.set(d.context, d.memoizedValue);
                }
                let a = f.memoizedState;
                let b = f.alternate.memoizedState;
                for (let i = 0; a && b; i += 1, a = a.next, b = b.next) {
                  if (a.queue && a.memoizedState !== b.memoizedState) {
                    const v = a.memoizedState;
                    const shape =
                      v === null ? "null" : typeof v === "object" ? (v instanceof Map ? `Map(${v.size})` : Array.isArray(v) ? `Array(${v.length})` : `{${Object.keys(v).slice(0, 6).join(",")}}`) : `${typeof v}:${String(v).slice(0, 30)}`;
                    const key = `hook#${i} ${shape}`;
                    rec.why_hits.set(key, (rec.why_hits.get(key) ?? 0) + 1);
                  }
                }
              }
            }
          }
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
        }
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
    rec.why = why;
  }, process.env.WHY ?? "");
}
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
// CPU_THROTTLE=4 — 메인 스레드를 N배 느리게(사내 PC 수준 흉내). 빠른 개발 머신에선 프레임 예산 안에 묻히는 렌더 비용을 드러낸다.
if (process.env.CPU_THROTTLE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_THROTTLE) });
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
      window.__perf.nodeRenders = 0;
      window.__perf.edgeRenders = 0;
      window.__perf.seen = new WeakMap();
      window.__perf.on = true;
    });
    const start = Date.now();
    await action(run);
    const wall = Date.now() - start;
    const { deltas, nodeRenders, edgeRenders } = await page.evaluate(() => {
      window.__perf.on = false;
      return { deltas: window.__perf.deltas, nodeRenders: window.__perf.nodeRenders, edgeRenders: window.__perf.edgeRenders };
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
      nodeRenders,
      edgeRenders,
    });
  }
  const pick = (k) => median(results.map((r) => r[k]));
  console.log(
    `${name.padEnd(10)} avg ${pick("avg").toFixed(1)}ms · p95 ${pick("p95").toFixed(1)}ms · >33ms ${pick("over33")} / ${pick("frames")}f` +
      ` · busy ${(pick("busy") * 100).toFixed(0)}% · script ${pick("script").toFixed(0)} style ${pick("style").toFixed(0)} layout ${pick("layout").toFixed(0)}ms` +
      ` · re-render node ${pick("nodeRenders")} edge ${pick("edgeRenders")}`,
  );
}

async function withProfile(name, fn) {
  if (process.env.RENDERS === "1" && PROFILE === name) {
    await page.evaluate(() => {
      window.__renders.byName = new Map();
      window.__renders.commits = 0;
      window.__renders.why_hits = new Map();
      window.__renders.on = true;
    });
    await fn();
    const rows = await page.evaluate(() => {
      window.__renders.on = false;
      return { commits: window.__renders.commits, rows: [...window.__renders.byName.entries()], why: [...window.__renders.why_hits.entries()] };
    });
    for (const [key, n] of rows.why.sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`   why ${process.env.WHY}: ${n}x ${key}`);
    console.log(`-- renders ${name}: ${rows.commits} commits`);
    for (const [key, e] of rows.rows.sort((a, b) => b[1].self - a[1].self).slice(0, Number(process.env.TOP ?? 25))) {
      console.log(`   ${e.self.toFixed(0).padStart(6)}ms ${String(e.n).padStart(6)}x  ${key}`);
    }
    return;
  }
  if (PROFILE !== name) return fn();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await fn();
  const { profile } = await cdp.send("Profiler.stop");
  // DUMP=<경로> — 원본 .cpuprofile 저장(호출 트리 오프라인 분석·DevTools 열기용)
  if (process.env.DUMP) (await import("node:fs")).writeFileSync(process.env.DUMP, JSON.stringify(profile));
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
  // INCLUSIVE=names — 운영 빌드는 URL에 src/가 없다: `next build --no-mangling` 산출물에서 이름 있는 앱 청크 함수 전부
  if (process.env.INCLUSIVE === "1" || process.env.INCLUSIVE === "names") {
    const isOurs = (f) =>
      process.env.INCLUSIVE === "names" ? f.url.includes("/_next/") && f.functionName.length > 2 : f.url.includes("/src/");
    const parent = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const inclusive = new Map();
    for (const [nodeId, count] of counts) {
      const seen = new Set();
      let cur = nodeId;
      while (cur !== undefined) {
        const f = byId.get(cur).callFrame;
        if (isOurs(f)) {
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
    for (const [key, count] of [...inclusive.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 25))) {
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
// DRAG_PACE=fast — 이동 사이 대기 없이 100번(사람 손처럼 프레임마다 이동이 들어오는 경우, 이동당 비용이 그대로 드러난다).
// 기본은 이동마다 16ms 쉬어 이동당 약 2~3프레임 — 이동당 렌더 비용이 희석된다.
const FAST = process.env.DRAG_PACE === "fast";
const dragGesture = (point) => async (run) => {
  const dir = run % 2 === 0 ? 1 : -1;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const steps = FAST ? 100 : 50;
  for (let i = 1; i <= steps; i += 1) {
    const k = FAST ? i / 2 : i;
    await page.mouse.move(point.x + dir * k * 4, point.y + dir * k * 2);
    if (!FAST) await page.waitForTimeout(16);
  }
  await page.mouse.up();
};
// 1) 맵 전체가 보이는 화면 맞춤 상태에서 드래그 — 연결선·라벨 전부가 화면에 있는 가장 무거운 경우
if (await fit.count()) {
  await fit.click();
  await page.waitForTimeout(600);
}
// DRAG_FIT_NODE=<노드 id 접미사> — 잡을 노드 고정(A/B 재현성: 가운데 최근접은 맞춤 애니메이션 타이밍에 따라 흔들린다)
const fitTarget = process.env.DRAG_FIT_NODE
  ? await page.evaluate((suffix) => {
      const el = [...document.querySelectorAll(".react-flow__node")].find((n) => n.getAttribute("data-id")?.endsWith(suffix));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(12, r.height / 3) };
    }, process.env.DRAG_FIT_NODE)
  : await pickTarget();
// 잡는 점이 노드 위인지 — 빈 캔버스면 선택 사각형 드래그를 재게 된다
const fitNodeId = fitTarget
  ? await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".react-flow__node")?.getAttribute("data-id") ?? null, fitTarget)
  : null;
console.log(`drag-fit target ${fitNodeId ?? "(none — 드래그가 노드를 잡지 못함)"} · zoom ${await page.evaluate(() => getComputedStyle(document.querySelector(".react-flow__viewport")).transform)}`);
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
