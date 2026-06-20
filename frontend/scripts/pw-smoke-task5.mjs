// Task 5 시각 스모크 — 하위프로세스 노드를 펼치면 링크맵(map 1) resolved 그래프가 임베드 자식으로 등장하는지 실측.
// 합성 트리(fullGraph)가 링크맵 resolved를 끼워 렌더 폴리시가 그대로 자식을 그리는지 검증.
// 실행: node scripts/pw-smoke-task5.mjs  (playwright-core, 서버 8000/3000 기동 전제)
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
await page.waitForTimeout(2000); // 측정/레이아웃 + resolved 선로드(subEnds) 안정화

const textsBefore = await page.$$eval(".react-flow__node", (ns) => ns.map((n) => n.textContent?.trim() ?? ""));
const hasOrder = textsBefore.some((t) => t.includes("주문 처리"));

// "주문 처리"(map 1 링크) 하위프로세스 노드의 끝 핸들 — subEnds 선로드 확인(완료=primary + 취소 → source 2개 기대)
const handlesBefore = await page.evaluate(() => {
  const order = [...document.querySelectorAll(".react-flow__node")].find((n) => n.textContent?.includes("주문 처리"));
  if (!order) return null;
  const handles = [...order.querySelectorAll(".react-flow__handle")];
  return {
    sources: handles.filter((h) => h.classList.contains("source")).length,
    targets: handles.filter((h) => h.classList.contains("target")).length,
  };
});

// 펼침 토글 클릭 — 노드 hover로 toggle(opacity-0 group-hover) 노출 후 클릭.
// 토글은 title 속성(영/한 둘 다 수용)으로 식별. 노드 안 유일한 title 버튼.
const orderNode = page.locator(".react-flow__node", { hasText: "주문 처리" }).first();
await orderNode.hover();
await page.waitForTimeout(200);
const toggle = orderNode.locator('button[title*="ubprocess"], button[title*="펼치기"]').first();
let clicked = false;
try {
  await toggle.click({ timeout: 4000, force: true });
  clicked = true;
} catch {
  // 폴백: 직접 DOM 디스패치(opacity-0이라 셀렉터 클릭이 불안정할 수 있음)
  clicked = await page.evaluate(() => {
    const order = [...document.querySelectorAll(".react-flow__node")].find((n) => n.textContent?.includes("주문 처리"));
    const btn = order?.querySelector("button[title]");
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  });
}

await page.waitForTimeout(2000); // 펼침 애니메이션 + materialize

const textsAfter = await page.$$eval(".react-flow__node", (ns) => ns.map((n) => n.textContent?.trim() ?? ""));
const hasJeobsu = textsAfter.some((t) => t.includes("접수"));   // map 1 임베드 자식
const hasGeomto = textsAfter.some((t) => t.includes("검토"));   // map 1 임베드 자식
const nodeCountBefore = textsBefore.length;
const nodeCountAfter = textsAfter.length;

await page.screenshot({ path: "/tmp/bpm-task5-smoke.png", fullPage: false });
await browser.close();

console.log("hasOrder:", hasOrder);
console.log("handlesBefore (subEnds proof):", JSON.stringify(handlesBefore));
console.log("toggle clicked:", clicked);
console.log("nodeCount before -> after:", nodeCountBefore, "->", nodeCountAfter);
console.log("embedded visible — 접수:", hasJeobsu, "검토:", hasGeomto);
console.log("consoleErrors:", errors.length, errors.slice(0, 5));

const subEndsOk = handlesBefore && handlesBefore.sources >= 2 && handlesBefore.targets >= 1;
const embedOk = hasOrder && clicked && hasJeobsu && hasGeomto && nodeCountAfter > nodeCountBefore;
const ok = subEndsOk && embedOk && errors.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
