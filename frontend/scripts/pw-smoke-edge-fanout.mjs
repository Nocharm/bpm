// 엣지 팬아웃 스모크 — API로 시나리오 맵(LR 병합·루프백·아웃 팬·TB 병합·분기 혼합·곡선·직선)을 시드하고
// 에디터에서 형제 엣지가 핸들 근처에서 갈라지는지(경로 샘플 최소거리·원호 수·라벨 비겹침)를 실측한 뒤 캡처한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-smoke-edge-fanout.mjs
//   KEEP=1 이면 시드 맵을 지우지 않는다(수동 확인용). 산출물은 저장소 루트 .shots/edge-fanout-smoke-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false(생성자=오너라 어느 쪽이든 편집 가능), dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
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
const nid = (key) => `fan-${tag}-${key}`;
const nodes = [];
const edges = [];
const node = (key, title, x, y, node_type = "process") => {
  nodes.push({ id: nid(key), title, node_type, pos_x: x, pos_y: y });
  return nid(key);
};
const edge = (key, source, target, extra = {}) => {
  edges.push({ id: nid(`e-${key}`), source_node_id: source, target_node_id: target, label: "", ...extra });
  return nid(`e-${key}`);
};

// 그래프 검증 요건: 시작 1개·끝 1개 이상 — 시나리오 밖에 두고 LR 병합에 이어 붙인다
const START = node("start", "시작", -240, 150, "start");
const END = node("end", "완료", 1300, 150, "end");
// 1) LR 병합(꺾은선): 위 2·같은 줄 1·아래 1 → T
const T1 = node("t1", "검토 결과 집계", 330, 150);
edge("s0", START, nid("a3"));
edge("e0", T1, END);
const groupA = [
  edge("a1", node("a1", "서류 검토", 40, 20), T1, { label: "적합" }),
  edge("a2", node("a2", "현장 실사", 60, 90), T1, { label: "완료" }),
  edge("a3", node("a3", "선행 승인", 20, 150), T1),
  edge("a4", node("a4", "재작업", 80, 250), T1, { label: "재제출" }),
];
// 2) 루프백: T2 → M2 → N2, M2·N2 → T2(top→top)
const T2 = node("t2", "초안 작성", 20, 420);
const M2 = node("m2", "1차 검토", 230, 420);
const N2 = node("n2", "최종 승인", 440, 420);
edge("f1", T2, M2);
edge("f2", M2, N2);
const groupB = [
  edge("b1", M2, T2, { label: "보완", source_side: "top", target_side: "top" }),
  edge("b2", N2, T2, { label: "반려", source_side: "top", target_side: "top" }),
];
// 3) 아웃 팬: S3 → A3/B3/C3
const S3 = node("s3", "접수", 20, 600);
const groupC = [
  edge("c1", S3, node("a3x", "품질 검토", 330, 490), { label: "병렬" }),
  edge("c2", S3, node("b3x", "안전 검토", 330, 600)),
  edge("c3", S3, node("c3x", "환경 검토", 330, 710), { label: "병렬" }),
];
// 4) TB 병합: 위 3개 → T4 위쪽 핸들
const T4 = node("t4", "취합", 900, 250);
const groupD = [
  edge("d1", node("a4x", "팀 A 검토", 700, 20), T4, { source_side: "bottom", target_side: "top", label: "완료" }),
  edge("d2", node("b4x", "팀 B 검토", 850, 80), T4, { source_side: "bottom", target_side: "top" }),
  edge("d3", node("c4x", "팀 C 검토", 1080, 30), T4, { source_side: "bottom", target_side: "top", label: "완료" }),
];
// 5) 분기 혼합: 디시전 아래 핸들 + 일반 노드 우측 핸들 → Q5 좌측 핸들
const D5 = node("d5", "승인?", 700, 420, "decision");
const Q5 = node("q5", "보완 요청", 1000, 560);
edge("p5", D5, node("p5", "다음 단계", 1000, 430), { label: "Yes" });
const groupE = [
  edge("q5a", D5, Q5, { label: "No", source_side: "bottom", target_side: "left" }),
  edge("q5b", node("r5", "재검토 요청", 700, 620), Q5),
];
// 6) 곡선 병합
const T6 = node("t6", "집계(곡선)", 330, 900);
const groupF = [
  edge("g1", node("a6", "곡선 A", 40, 780), T6, { line_style: "default", label: "적합" }),
  edge("g2", node("a7", "곡선 B", 60, 850), T6, { line_style: "default" }),
  edge("g3", node("a8", "곡선 C", 80, 1010), T6, { line_style: "default", label: "재제출" }),
];
// 7) 직선 병합
const T7 = node("t7", "집계(직선)", 1000, 900);
const groupG = [
  edge("h1", node("a9", "직선 A", 700, 780), T7, { line_style: "straight" }),
  edge("h2", node("a10", "직선 B", 720, 900), T7, { line_style: "straight" }),
  edge("h3", node("a11", "직선 C", 740, 1010), T7, { line_style: "straight" }),
];

const maps = await api("GET", "/api/maps");
// 이전 실행이 남긴 스모크 맵 정리(휴지통) — 실패 중단 시 빈 맵이 쌓이지 않게
for (const stale of maps.filter((m) => m.name.startsWith("Edge fan-out smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
// 오우닝 부서는 resolver 유효 경로여야 한다(맵에 저장된 옛 경로는 422) — 피커와 같은 소스인 디렉터리의 org_path
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
if (!owning) throw new Error("no org_path in directory — seed the directory first");
const map = await api("POST", "/api/maps", { name: `Edge fan-out smoke ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
check("seeded scenario map", true, `map ${map.id} v${draft.id} (${nodes.length} nodes, ${edges.length} edges)`);

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2500);

/** flow 좌표 사각형을 화면에 맞추는 뷰포트 변환(RF fitView 대신 결정적) */
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

/** 엣지 id 목록의 경로 d·끝점 근처 샘플(끝점에서 from~to px 앞) — flow 좌표 */
const sample = (ids, from, to, atStart = false) =>
  page.evaluate(
    ({ ids, from, to, atStart }) =>
      ids.map((id) => {
        const g = document.querySelector(`.react-flow__edge[data-id="${id}"]`);
        const path = g?.querySelector("path.react-flow__edge-path");
        if (!path) return null;
        const total = path.getTotalLength();
        const pts = [];
        for (let s = from; s <= to; s += 2) {
          const p = path.getPointAtLength(atStart ? s : total - s);
          pts.push([p.x, p.y]);
        }
        return { d: path.getAttribute("d") ?? "", pts, end: (() => { const p = path.getPointAtLength(total); return [p.x, p.y]; })() };
      }),
    { ids, from, to, atStart },
  );
const minDist = (a, b) => {
  let best = Infinity;
  for (const [x1, y1] of a) for (const [x2, y2] of b) best = Math.min(best, Math.hypot(x1 - x2, y1 - y2));
  return best;
};
/** 그룹의 모든 형제 쌍이 끝점 근처에서 최소 gap 이상 떨어져 있는가 */
async function checkSeparation(name, ids, { from = 30, to = 80, gap = 6, atStart = false, arcs } = {}) {
  const samples = await sample(ids, from, to, atStart);
  check(`${name}: all ${ids.length} edges rendered`, samples.every(Boolean));
  const ok = samples.filter(Boolean);
  let worst = Infinity;
  for (let i = 0; i < ok.length; i += 1)
    for (let j = i + 1; j < ok.length; j += 1) worst = Math.min(worst, minDist(ok[i].pts, ok[j].pts));
  check(`${name}: sibling paths ≥ ${gap}px apart ${from}-${to}px from the handle`, worst >= gap, `min ${worst.toFixed(1)}px`);
  if (arcs !== undefined) {
    const withArc = ok.filter((s) => / A /.test(s.d)).length;
    check(`${name}: ${arcs} fan arcs`, withArc === arcs, `got ${withArc}`);
  }
  return ok;
}

await checkSeparation("LR merge (step)", groupA, { arcs: 3 });
// 루프백 아크는 반경 34/44(원호 길이 53/69px) — 원호 안에서는 설계상 끝점으로 수렴하므로 그 뒤 레인 구간을 잰다
await checkSeparation("loop-back (top→top)", groupB, { arcs: 2, from: 80, to: 140 });
await checkSeparation("out-fan (source side)", groupC, { atStart: true, arcs: 2 });
await checkSeparation("TB merge (bottom→top)", groupD, { arcs: 3 });
await checkSeparation("decision bottom + process right → left", groupE, { arcs: 2 });
await checkSeparation("bezier merge", groupF, { gap: 1.5, arcs: 0 });
const straight = await checkSeparation("straight merge", groupG, { gap: 2.5, from: 0, to: 4, arcs: 0 });
check("straight endpoints spread within the handle", new Set(straight.map((s) => s.end[1].toFixed(1))).size === straight.length, straight.map((s) => s.end[1].toFixed(1)).join(","));

// 라벨 비겹침(LR 병합 3라벨) — 라벨 알약 사각형 교차 없음
const labelBoxes = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__edgelabel-renderer > div")]
    .filter((el) => {
      // LR 병합 영역(flow 좌표 x<600, y<400)의 라벨만 — transform의 두 번째 translate가 flow 좌표
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)\s*$/.exec(el.style.transform ?? "");
      return !!m && Number(m[1]) < 600 && Number(m[2]) < 400;
    })
    .map((el) => { const r = el.getBoundingClientRect(); return { t: el.textContent?.trim(), x: r.left, y: r.top, w: r.width, h: r.height }; }),
);
let overlap = false;
for (let i = 0; i < labelBoxes.length; i += 1)
  for (let j = i + 1; j < labelBoxes.length; j += 1) {
    const a = labelBoxes[i], b = labelBoxes[j];
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = true;
  }
check("labels of the LR merge do not overlap", !overlap, labelBoxes.map((b) => b.t).join(","));

// ---- 캡처 ----
await frame({ x0: -20, y0: -20, x1: 1300, y1: 1100 });
await page.waitForTimeout(300);
await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-smoke-editor.png` });
const zooms = [
  ["lr-merge", { x0: 0, y0: 0, x1: 540, y1: 330 }],
  ["loopback", { x0: 0, y0: 340, x1: 640, y1: 500 }],
  ["out-fan", { x0: 0, y0: 470, x1: 540, y1: 780 }],
  ["tb-merge", { x0: 680, y0: 0, x1: 1280, y1: 330 }],
  ["decision-mix", { x0: 680, y0: 400, x1: 1200, y1: 700 }],
  ["bezier", { x0: 0, y0: 760, x1: 540, y1: 1080 }],
  ["straight", { x0: 680, y0: 760, x1: 1200, y1: 1080 }],
];
for (const [name, rect] of zooms) {
  await frame(rect, 1.8);
  await page.waitForTimeout(200);
  await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-smoke-${name}.png` });
}
console.log("wrote", `${OUT}/edge-fanout-smoke-*.png`);

// ---- 비교 화면(맵 13 비교 데모, 결제 처리에 4개 유입) ----
try {
  const demo = maps.find((m) => m.name.includes("비교 데모"));
  if (demo) {
    const d = await api("GET", `/api/maps/${demo.id}`);
    const versions = (d.versions ?? []).map((v) => v.id).sort((a, b) => a - b);
    if (versions.length >= 2) {
      await page.goto(`${BASE}/maps/${demo.id}/compare?base=${versions[0]}&target=${versions[versions.length - 1]}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
      await page.waitForTimeout(2500);
      const arcs = await page.evaluate(() => [...document.querySelectorAll("path.react-flow__edge-path")].filter((p) => / A /.test(p.getAttribute("d") ?? "")).length);
      check("compare page renders fan arcs on the shared handle", arcs >= 2, `${arcs} arcs`);
      await page.locator(".react-flow").first().screenshot({ path: `${OUT}/edge-fanout-smoke-compare.png` });
    }
  }
} catch (error) {
  check("compare page capture", false, String(error).slice(0, 160));
}

await browser.close();
if (!KEEP) {
  await api("DELETE", `/api/maps/${map.id}`).catch((e) => console.log("cleanup skipped:", String(e).slice(0, 120)));
}
const failed = results.filter((r) => !r).length;
console.log(`${results.length - failed}/${results.length} passed${KEEP ? ` (kept map ${map.id})` : ""}`);
process.exit(failed ? 1 : 0);
