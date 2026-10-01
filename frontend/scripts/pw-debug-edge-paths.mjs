// 엣지 경로 디버그 덤프 — 지정 URL을 열어 특정 노드로 들어오는(또는 나가는) 엣지의 렌더된 path d와 핸들 변을 출력한다.
// 실행(frontend/ 에서): URL=http://localhost:3047/maps/13/compare?base=72&target=73 VERSION=73 TARGET="결제 처리" node scripts/pw-debug-edge-paths.mjs
//   BACKEND_URL(기본 8048)로 그래프를 읽어 엣지 id→이름을 맞춘다. SOURCE="노드명"이면 나가는 엣지 기준.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const URL_ = process.env.URL ?? "http://localhost:3047/maps/13/compare?base=72&target=73";
const VERSION = process.env.VERSION ?? "73";
const TARGET = process.env.TARGET;
const SOURCE = process.env.SOURCE;

const graph = await (await fetch(`${BACKEND}/api/versions/${VERSION}/graph`, { headers: { "X-Dev-User": "admin.sys" } })).json();
const titleOf = Object.fromEntries(graph.nodes.map((n) => [n.id, n.title]));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2500);
const rendered = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__edge")].map((g) => ({
    id: g.getAttribute("data-id"),
    d: g.querySelector("path.react-flow__edge-path")?.getAttribute("d") ?? "",
  })),
);
const nodes = await page.evaluate(() =>
  [...document.querySelectorAll(".react-flow__node")].map((n) => ({
    id: n.getAttribute("data-id"),
    title: (n.textContent ?? "").slice(0, 14),
    transform: n.style.transform,
    w: n.offsetWidth,
    h: n.offsetHeight,
  })),
);
for (const edge of graph.edges) {
  const hit = TARGET ? titleOf[edge.target_node_id] === TARGET : SOURCE ? titleOf[edge.source_node_id] === SOURCE : true;
  if (!hit) continue;
  const row = rendered.find((r) => r.id === edge.id || r.id?.endsWith(edge.id));
  console.log(
    `${titleOf[edge.source_node_id]} -> ${titleOf[edge.target_node_id]} [${edge.label}] sides ${edge.source_side}/${edge.target_side} handles ${edge.source_handle ?? "-"}/${edge.target_handle ?? "-"}\n  d=${row?.d ?? "(not rendered)"}`,
  );
}
const focus = [TARGET, SOURCE].filter(Boolean);
for (const n of nodes.filter((n) => focus.some((f) => n.title.includes(f)) || /재고|결제/.test(n.title))) {
  console.log("node", n.title, n.transform, `${n.w}x${n.h}`);
}
await browser.close();
