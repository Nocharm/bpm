// 엣지 팬아웃 캡처 — 지정 URL(기본 맵13 v73 비교 데모, "결제 처리"에 4개 유입)을 열어 경로 통계와 스크린샷을 남긴다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-shot-edge-fanout.mjs
//   URL=... FOCUS="노드 이름" OUT=../.shots/edge-fanout-editor.png 로 대상 변경. 산출물은 저장소 루트 .shots/(gitignore).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const URL_ = process.env.URL ?? `${BASE}/maps/13?version=73`;
const OUT = process.env.OUT ?? "../.shots/edge-fanout-editor.png";
const FOCUS = process.env.FOCUS ?? "결제 처리";
const ZOOM = Number(process.env.ZOOM ?? "1.6");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
// networkidle은 알림 폴링 때문에 영원히 안 온다 — DOM 로드 후 엣지 path 출현으로 대기
await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForSelector("path.react-flow__edge-path", { state: "attached", timeout: 120_000 });
await page.waitForTimeout(2500);

// 경로 통계 — 팬 경로는 원호(A) 명령을 갖는다
const stats = await page.evaluate(() => {
  const ds = [...document.querySelectorAll("path.react-flow__edge-path")].map((p) => p.getAttribute("d") ?? "");
  return { edges: ds.length, withArc: ds.filter((d) => / A /.test(d)).length };
});
console.log("edges", JSON.stringify(stats));

// 대상 노드를 화면 중앙에 두고 확대 — RF 뷰포트 변환을 직접 계산(fitView는 전체를 작게 보여줘 아크가 안 보인다)
const focused = await page.evaluate(
  ({ label, zoom }) => {
    const nodes = [...document.querySelectorAll(".react-flow__node")];
    const node = nodes.find((n) => (n.textContent ?? "").includes(label));
    if (!node) return null;
    const viewport = document.querySelector(".react-flow__viewport");
    const pane = document.querySelector(".react-flow");
    if (!viewport || !pane) return null;
    const rect = node.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    // 노드 중심의 flow 좌표
    const fx = (rect.left + rect.width / 2 - paneRect.left - m.e) / m.a;
    const fy = (rect.top + rect.height / 2 - paneRect.top - m.f) / m.d;
    const tx = paneRect.width / 2 - fx * zoom;
    const ty = paneRect.height / 2 - fy * zoom;
    viewport.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    return { fx, fy };
  },
  { label: FOCUS, zoom: ZOOM },
);
console.log("focus", FOCUS, focused ? "ok" : "not found");
await page.waitForTimeout(400);
await page.locator(".react-flow").first().screenshot({ path: OUT });
console.log("wrote", OUT);
await browser.close();
