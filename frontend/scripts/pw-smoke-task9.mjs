// Task 9 시각 스모크 — 하위프로세스 인스펙터에서 follow-latest 체크박스가 렌더되는지,
// 토글 시 콘솔 오류가 없는지, 엣지 sourceHandle 라운드트립이 백엔드에서 유지되는지 실측.
// 실행: node scripts/pw-smoke-task9.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2000); // 측정/레이아웃 + resolved 선로드 안정화

// (a) "주문 처리" subprocess 노드 선택 — inspector에서 follow-latest 체크박스 확인
const orderNode = page.locator(".react-flow__node", { hasText: "주문 처리" }).first();
let nodeFound = false;
let checkboxFound = false;
let checkboxToggled = false;
const errorsAfterToggle = [];

try {
  await orderNode.click({ timeout: 5000 });
  nodeFound = true;
  await page.waitForTimeout(500); // inspector 렌더 대기
} catch {
  nodeFound = false;
}

if (nodeFound) {
  // follow-latest 라벨 검색 — 인스펙터에 "Follow" 또는 "추종" 텍스트가 있는 체크박스
  const labels = await page.$$eval("label", (els) =>
    els.map((el) => ({ text: el.textContent?.trim() ?? "", hasCheckbox: !!el.querySelector('input[type="checkbox"]') }))
  );
  const followLabel = labels.find((l) => l.hasCheckbox && (l.text.includes("Follow") || l.text.includes("추종")));
  checkboxFound = !!followLabel;

  if (checkboxFound) {
    const errsBefore = errors.length;
    try {
      // 라벨을 직접 DOM 클릭으로 토글 (opacity-0 우회) — safe eval: 로컬 DOM 조작만
      await page.evaluate(() => {
        const labels = [...document.querySelectorAll("label")];
        const target = labels.find((l) => l.textContent?.includes("Follow") || l.textContent?.includes("추종"));
        const cb = target?.querySelector('input[type="checkbox"]');
        if (cb) cb.click();
      });
      await page.waitForTimeout(500);
      checkboxToggled = true;
      errorsAfterToggle.push(...errors.slice(errsBefore));
      // 원복
      await page.evaluate(() => {
        const labels = [...document.querySelectorAll("label")];
        const target = labels.find((l) => l.textContent?.includes("Follow") || l.textContent?.includes("추종"));
        const cb = target?.querySelector('input[type="checkbox"]');
        if (cb) cb.click();
      });
    } catch {
      checkboxToggled = false;
    }
  }
}

// (b) 엣지 sourceHandle 라운드트립 — REST API 직접 확인
// map 3 version 3의 그래프를 GET → source_handle="취소" 엣지가 있는지 확인
// (seed에서 이미 심어진 값 — 백엔드가 보존했는지 확인)
let roundtripOk = false;
try {
  const graphResp = await fetch("http://localhost:8000/api/versions/3/graph");
  const graph = await graphResp.json();
  // seed 엣지 c-e4: source_handle="취소" 이 있어야 함
  const cancelEdge = graph.edges?.find((e) => e.source_handle === "취소");
  if (cancelEdge) {
    roundtripOk = true;
  } else {
    // 없으면 직접 PUT/GET 라운드트립으로 확인
    if (graph.edges && graph.edges.length > 0) {
      const testEdge = { ...graph.edges[0], source_handle: "test-handle-9" };
      const modified = { ...graph, edges: [testEdge, ...graph.edges.slice(1)] };
      const putResp = await fetch("http://localhost:8000/api/versions/3/graph", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modified),
      });
      if (putResp.ok) {
        const readback = await (await fetch("http://localhost:8000/api/versions/3/graph")).json();
        roundtripOk = readback.edges?.some((e) => e.source_handle === "test-handle-9") === true;
        // 복원
        await fetch("http://localhost:8000/api/versions/3/graph", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(graph),
        });
      }
    }
  }
} catch (e) {
  console.log("roundtrip error:", e.message);
}

await page.screenshot({ path: "/tmp/bpm-task9-smoke.png", fullPage: false });
await browser.close();

console.log("nodeFound (주문 처리 subprocess):", nodeFound);
console.log("checkboxFound (follow-latest in inspector):", checkboxFound);
console.log("checkboxToggled:", checkboxToggled);
console.log("errorsAfterToggle:", errorsAfterToggle);
console.log("roundtripOk (source_handle persists):", roundtripOk);
console.log("consoleErrors total:", errors.length, errors.slice(0, 5));

const ok = nodeFound && checkboxFound && checkboxToggled && errorsAfterToggle.length === 0 && roundtripOk && errors.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
