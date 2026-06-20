// Task 6b 스모크 — 인라인 임베드 자식 노드 클릭 선택 UX 검증.
// 접수 노드 클릭 → .selected 클래스 획득, ring 스타일 적용, 우클릭 → 컨텍스트 메뉴 없음.
// 실행: node scripts/pw-smoke-task6b.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2000);

// "주문 처리" 하위프로세스 노드 펼치기
const orderNode = page.locator(".react-flow__node", { hasText: "주문 처리" }).first();
await orderNode.hover();
await page.waitForTimeout(200);
const toggle = orderNode.locator('button[title*="ubprocess"], button[title*="펼치기"]').first();
let clicked = false;
try {
  await toggle.click({ timeout: 4000, force: true });
  clicked = true;
} catch {
  clicked = await page.evaluate(() => {
    const order = [...document.querySelectorAll(".react-flow__node")].find((n) => n.textContent?.includes("주문 처리"));
    const btn = order?.querySelector("button[title]");
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  });
}
await page.waitForTimeout(2000);

// 자식 노드 확인
const textsAfter = await page.$$eval(".react-flow__node", (ns) => ns.map((n) => n.textContent?.trim() ?? ""));
const hasJeobsu = textsAfter.some((t) => t.includes("접수"));
const hasGeomto = textsAfter.some((t) => t.includes("검토"));

// 1. "접수" 임베드 자식 노드 클릭
const jeobsuNode = page.locator(".react-flow__node", { hasText: "접수" }).first();
await jeobsuNode.click();
await page.waitForTimeout(500);

// 선택 상태 확인 — RF는 클릭된 노드에 .selected 클래스를 추가
const selectedAfterClick = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".react-flow__node")].find((n) => n.textContent?.trim().includes("접수"));
  if (!node) return { hasSelected: false, hasRing: false };
  return {
    hasSelected: node.classList.contains("selected"),
    // ring 클래스는 process-node 내부 div에 있음
    hasRing: node.querySelector('[class*="ring"]') !== null,
  };
});

// 드래그 가능 여부 — draggable:false면 noDrag 클래스가 붙음
const notDraggable = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".react-flow__node")].find((n) => n.textContent?.trim().includes("접수"));
  return node ? node.classList.contains("noDrag") || !node.draggable : true;
});

// 2. 우클릭 → 컨텍스트 메뉴 등장하지 않아야 함
await jeobsuNode.click({ button: "right" });
await page.waitForTimeout(500);
// 메뉴 요소 확인: 앱 컨텍스트 메뉴(role=menu 또는 data-menu)
const menuVisible = await page.evaluate(() => {
  // 앱이 렌더하는 컨텍스트 메뉴 — role=menu 혹은 클래스에 "menu"를 포함하는 가시 요소
  const menus = [...document.querySelectorAll('[role="menu"], [data-menu]')];
  const visibleMenus = menus.filter((m) => {
    const s = window.getComputedStyle(m);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  });
  return visibleMenus.length > 0;
});

await page.screenshot({ path: "/tmp/bpm-task6b-smoke.png", fullPage: false });
await browser.close();

console.log("toggle clicked:", clicked);
console.log("embedded visible — 접수:", hasJeobsu, "검토:", hasGeomto);
console.log("selected after click:", JSON.stringify(selectedAfterClick));
console.log("not draggable:", notDraggable);
console.log("menu visible after right-click:", menuVisible);
console.log("consoleErrors:", errors.length, errors.slice(0, 5));

const embedOk = clicked && hasJeobsu && hasGeomto;
const selectionOk = selectedAfterClick.hasSelected || selectedAfterClick.hasRing;
const noMenuOk = !menuVisible;
const ok = embedOk && selectionOk && noMenuOk && errors.length === 0;

console.log("embedOk:", embedOk, "selectionOk:", selectionOk, "noMenuOk:", noMenuOk, "errorsOk:", errors.length === 0);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
