// 엣지 팬아웃 밀집 캡처 — 파라미터가 가득 찬(키 큰) 노드에 사방(좌·상·하·우·루프백·역방향)에서 엣지가 모이는
// 허브 두 개(LR 허브·TB 허브)를 API로 시드하고, 노드 표시 필드를 전부 켠 상태로 캡처한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-shot-edge-fanout-dense.mjs
//   KEEP=1 이면 시드 맵을 지우지 않는다. 산출물은 저장소 루트 .shots/edge-fanout-dense-*.png (gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const NAME = "Edge fan-out dense";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `fand-${tag}-${key}`;
const nodes = [];
const edges = [];
// 파라미터 7종 + 역할·부서·시스템·입출력·조건·링크까지 채운 "키 큰" 노드
const FULL = {
  assignee_role: "품질 담당자",
  department: "품질보증팀",
  system: "LIMS",
  duration: "1.30",
  touch_time: "0.45",
  cost_krw: "50000",
  headcount: "2",
  annual_count: "2400",
  fte: "0.8",
  input: "검토 요청서, 시험 성적서",
  output: "검토 결과 보고서",
  start_condition: "재고 확보 확인 후",
  end_condition: "PG 승인 코드 수신",
  url: "https://example.com/sop",
  url_label: "SOP-001",
};
const node = (key, title, x, y, node_type = "process", extra = FULL) => {
  nodes.push({ id: nid(key), title, node_type, pos_x: x, pos_y: y, ...(node_type === "process" ? extra : {}) });
  return nid(key);
};
const edge = (key, source, target, extra = {}) => {
  edges.push({ id: nid(`e-${key}`), source_node_id: source, target_node_id: target, label: "", ...extra });
};

// ── LR 허브 H: 좌(4+디시전 위쪽 핸들)·상(위 2 + 루프백 2)·하(아래 2)·우(아웃 팬 3 + 역방향 유입 1)
// 키 큰 노드(약 240×175)라 열 450px·행 300px 간격 — 겹침·우연한 레인 일치를 피한다
const START = node("start", "시작", -400, 420, "start");
const END = node("end", "완료", 2100, 420, "end");
const Hh = node("h", "검토 결과 집계", 800, 400);
const A1 = node("a1", "서류 검토", 60, -40);
const A2 = node("a2", "현장 실사", 200, 180);
const A3 = node("a3", "선행 승인", 60, 400);
const A4 = node("a4", "재작업", 200, 640);
const D = node("d", "보완 필요?", 460, 980, "decision");
const E1 = node("e1", "보완 진행", 800, 960);
edge("s0", START, A3);
edge("a1", A1, Hh, { label: "적합" });
edge("a2", A2, Hh, { label: "완료" });
edge("a3", A3, Hh);
edge("a4", A4, Hh, { label: "재제출" });
edge("d1", D, Hh, { label: "No", source_side: "top", target_side: "left" });
edge("d2", D, E1, { label: "Yes" });
const B1 = node("b1", "팀 A 검토", 600, -60);
const B2 = node("b2", "팀 B 검토", 1150, -80);
edge("b1", B1, Hh, { label: "완료", source_side: "bottom", target_side: "top" });
edge("b2", B2, Hh, { label: "완료", source_side: "bottom", target_side: "top" });
const L1 = node("l1", "1차 검토", 1300, 400);
const L2 = node("l2", "최종 승인", 1750, 400);
edge("h-l1", Hh, L1);
edge("l1-l2", L1, L2);
edge("l1-back", L1, Hh, { label: "보완", source_side: "top", target_side: "top" });
edge("l2-back", L2, Hh, { label: "반려", source_side: "top", target_side: "top" });
const C1 = node("c1", "안전 검토", 600, 820);
const C2 = node("c2", "환경 검토", 1150, 840);
edge("c1", C1, Hh, { label: "동의", source_side: "top", target_side: "bottom" });
edge("c2", C2, Hh, { source_side: "top", target_side: "bottom" });
const R1 = node("r1", "품질 검토", 1300, 120);
const R2 = node("r2", "재검토 요청", 1300, 700);
edge("h-r1", Hh, R1, { label: "병렬" });
edge("h-r2", Hh, R2, { label: "병렬" });
edge("r2-back", R2, Hh, { label: "재검토", source_side: "left", target_side: "right" });
edge("l1-end", L1, END);
edge("l2-end", L2, END);

// ── TB 허브 G: 위 3(bottom→top)·아래 아웃 팬 3·우측 유입 1·좌측 유입 2
const G = node("g", "취합", 2500, 500);
const G1 = node("g1", "팀 A 집계", 2250, 60);
const G2 = node("g2", "팀 B 집계", 2500, 20);
const G3 = node("g3", "팀 C 집계", 2820, 100);
edge("g1", G1, G, { label: "완료", source_side: "bottom", target_side: "top" });
edge("g2", G2, G, { source_side: "bottom", target_side: "top" });
edge("g3", G3, G, { label: "완료", source_side: "bottom", target_side: "top" });
const G4 = node("g4", "배포 A", 2260, 950);
const G5 = node("g5", "배포 B", 2500, 1000);
const G6 = node("g6", "배포 C", 2780, 940);
edge("g4", G, G4, { label: "배포", source_side: "bottom", target_side: "top" });
edge("g5", G, G5, { source_side: "bottom", target_side: "top" });
edge("g6", G, G6, { label: "배포", source_side: "bottom", target_side: "top" });
const G7 = node("g7", "외부 검토", 2950, 520);
edge("g7", G7, G, { label: "외부", source_side: "left", target_side: "right" });
const G8 = node("g8", "내부 검토", 2050, 540);
const G9 = node("g9", "사전 검토", 2020, 280);
edge("g8", G8, G);
edge("g9", G9, G, { label: "사전" });

const maps = await api("GET", "/api/maps");
for (const stale of maps.filter((m) => m.name.startsWith(NAME))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
const map = await api("POST", "/api/maps", { name: `${NAME} ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
console.log(`seeded map ${map.id} v${draft.id} (${nodes.length} nodes, ${edges.length} edges)`);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "ko");
  // 노드 표시 필드 전부 ON — 파라미터 칩·역할·부서·시스템·입출력·조건·링크·GMP
  window.localStorage.setItem(
    "bpm.nodeDisplayFields.v2",
    JSON.stringify(["assignee", "department", "system", "url", "input", "output", "conditions", "params", "gmp"]),
  );
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(3000);

const frame = (rect, zoom) =>
  page.evaluate(
    ({ rect, zoom }) => {
      const viewport = document.querySelector(".react-flow__viewport");
      const pane = document.querySelector(".react-flow");
      const pr = pane.getBoundingClientRect();
      const z = zoom ?? Math.min(pr.width / (rect.x1 - rect.x0), pr.height / (rect.y1 - rect.y0));
      const tx = pr.width / 2 - ((rect.x0 + rect.x1) / 2) * z;
      const ty = pr.height / 2 - ((rect.y0 + rect.y1) / 2) * z;
      viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
      return z;
    },
    { rect, zoom },
  );
const stats = await page.evaluate(() => {
  const ds = [...document.querySelectorAll("path.react-flow__edge-path")].map((p) => p.getAttribute("d") ?? "");
  return { edges: ds.length, withArc: ds.filter((d) => / A /.test(d)).length, nan: ds.filter((d) => /NaN/.test(d)).length };
});
console.log("edges", JSON.stringify(stats));

// 표시 좌표는 height-shift로 행이 밀릴 수 있어 허브 노드 DOM 중심을 기준으로 프레임을 잡는다
const centerOf = (label) =>
  page.evaluate((text) => {
    const node = [...document.querySelectorAll(".react-flow__node")].find((n) => (n.textContent ?? "").startsWith(text));
    const viewport = document.querySelector(".react-flow__viewport");
    const pane = document.querySelector(".react-flow");
    if (!node || !viewport || !pane) return null;
    const r = node.getBoundingClientRect();
    const pr = pane.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return { x: (r.left + r.width / 2 - pr.left - m.e) / m.a, y: (r.top + r.height / 2 - pr.top - m.f) / m.d };
  }, label);
const hub = (await centerOf("검토 결과 집계")) ?? { x: 920, y: 490 };
const tbHub = (await centerOf("취합")) ?? { x: 2620, y: 590 };
const around = (c, w, h) => ({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 });
const shots = [
  ["lr-overview", around(hub, 2700, 1650), undefined],
  ["lr-hub", around(hub, 1300, 900), 1.25],
  ["lr-hub-left-top", around({ x: hub.x - 250, y: hub.y - 200 }, 800, 560), 1.9],
  ["lr-hub-right-bottom", around({ x: hub.x + 250, y: hub.y + 180 }, 800, 560), 1.9],
  ["tb-overview", around(tbHub, 1400, 1300), undefined],
  ["tb-hub", around(tbHub, 900, 640), 1.6],
];
for (const [name, rect, zoom] of shots) {
  await frame(rect, zoom);
  await page.waitForTimeout(250);
  await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-dense-${name}.png` });
}
console.log("wrote", `${OUT}/edge-fanout-dense-*.png`);
await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${map.id}`).catch((e) => console.log("cleanup skipped:", String(e).slice(0, 120)));
} else {
  console.log(`kept map ${map.id}`);
}
