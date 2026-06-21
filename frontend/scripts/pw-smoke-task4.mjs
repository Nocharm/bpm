// Task 4 시각 스모크 — subprocess 노드가 새 모양 + 핸들로 렌더되는지 시스템 Chrome으로 실측.
// 실행: node scripts/pw-smoke-task4.mjs  (playwright-core --no-save 설치 전제, 서버 8000/3000 기동 전제)
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
// React Flow 노드가 붙을 때까지
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(1500); // 측정/레이아웃 안정화

const nodeTexts = await page.$$eval(".react-flow__node", (ns) => ns.map((n) => n.textContent?.trim() ?? ""));
const hasOrder = nodeTexts.some((t) => t.includes("주문 처리"));
const hasDeliver = nodeTexts.some((t) => t.includes("배송"));

// subprocess 노드(주문 처리)의 핸들 수 — 좌 input + 우 source(들)
const orderHandles = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".react-flow__node")];
  const order = nodes.find((n) => n.textContent?.includes("주문 처리"));
  if (!order) return null;
  const handles = [...order.querySelectorAll(".react-flow__handle")];
  return {
    total: handles.length,
    sources: handles.filter((h) => h.classList.contains("source")).length,
    targets: handles.filter((h) => h.classList.contains("target")).length,
  };
});

await page.screenshot({ path: "/tmp/bpm-task4-smoke.png", fullPage: false });
await browser.close();

console.log("nodeTexts:", JSON.stringify(nodeTexts));
console.log("hasOrder:", hasOrder, "hasDeliver:", hasDeliver);
console.log("orderHandles:", JSON.stringify(orderHandles));
console.log("consoleErrors:", errors.length, errors.slice(0, 5));

const ok = hasOrder && hasDeliver && orderHandles && orderHandles.targets >= 1 && orderHandles.sources >= 1;
console.log(ok ? "SMOKE PASS" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
