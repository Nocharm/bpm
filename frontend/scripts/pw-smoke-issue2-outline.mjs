// Issue 2 스모크 — 모두 접힌 상태에서도 아웃라인의 하위프로세스 행(c-order/c-deliver)이 펼치기 어포던스
// (chevron 버튼)를 보이는지, 클릭하면 (a) 행이 펼쳐지고 (b) 캔버스에 자식이 임베드되는지 실측.
// map 3: c-order(주문 처리, linked=1) / c-deliver(배송, linked=2). 임베드 자식 id는 "c-order/<원본id>" 네임스페이스.
// 실행: node scripts/pw-smoke-issue2-outline.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Couldn't create edge for source handle")) {
    errors.push(m.text());
  }
});

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2500);

// 아웃라인 행(li) 중 라벨 텍스트로 행을 찾아 펼치기 버튼(aria-label expand/collapse) 유무를 본다.
async function rowState(label) {
  return page.evaluate((lbl) => {
    const lis = [...document.querySelectorAll("aside li, nav li, ul li")];
    const li = lis.find((el) => (el.textContent ?? "").includes(lbl) && el.querySelector("span,svg,button"));
    if (!li) return { found: false };
    const btn = li.querySelector("button[aria-label]");
    const al = btn?.getAttribute("aria-label") ?? "";
    // ChevronDown(펼침) vs ChevronRight(접힘)은 aria-label(collapse vs expand)로 구분
    const expandable = !!btn && (al.toLowerCase().includes("expand") || al.toLowerCase().includes("collapse") || al.includes("펼치") || al.includes("접기"));
    const expanded = al.toLowerCase().includes("collapse") || al.includes("접기");
    return { found: true, expandable, expanded, ariaLabel: al };
  }, label);
}

// 펼치기 버튼 클릭
async function clickRowExpand(label) {
  return page.evaluate((lbl) => {
    const lis = [...document.querySelectorAll("aside li, nav li, ul li")];
    const li = lis.find((el) => (el.textContent ?? "").includes(lbl) && el.querySelector("button[aria-label]"));
    const btn = li?.querySelector("button[aria-label]");
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
}

// 캔버스에 c-order의 임베드 자식이 있는지 — data-id가 "c-order/" 로 시작하는 RF 노드.
async function embeddedChildCount(hostId) {
  return page.evaluate((h) => {
    return [...document.querySelectorAll(".react-flow__node")].filter((el) =>
      (el.getAttribute("data-id") ?? "").startsWith(h + "/"),
    ).length;
  }, hostId);
}

// ===== (1) 접힌 상태: c-order/c-deliver 행이 펼치기 어포던스를 가지는가 =====
const orderBefore = await rowState("주문 처리");
const deliverBefore = await rowState("배송");
console.log("c-order row (collapsed):", JSON.stringify(orderBefore));
console.log("c-deliver row (collapsed):", JSON.stringify(deliverBefore));
const childrenBefore = await embeddedChildCount("c-order");
console.log("c-order embedded children before expand:", childrenBefore);

const affordanceOk =
  orderBefore.found && orderBefore.expandable && !orderBefore.expanded &&
  deliverBefore.found && deliverBefore.expandable && !deliverBefore.expanded;
console.log("(1) collapsed subprocess rows show expand affordance:", affordanceOk);

// ===== (2) 클릭 → 행 펼침 + 캔버스 자식 임베드 =====
const clicked = await clickRowExpand("주문 처리");
console.log("clicked c-order expand:", clicked);
await page.waitForTimeout(2500); // resolved embed + materialize

const orderAfter = await rowState("주문 처리");
const childrenAfter = await embeddedChildCount("c-order");
console.log("c-order row (after click):", JSON.stringify(orderAfter));
console.log("c-order embedded children after expand:", childrenAfter);

const rowExpanded = orderAfter.found && orderAfter.expanded;
const canvasEmbedded = childrenAfter > childrenBefore && childrenAfter > 0;
console.log("(2a) row expanded after click:", rowExpanded);
console.log("(2b) canvas embedded children after click:", canvasEmbedded);

await page.screenshot({ path: "/tmp/bpm-issue2.png", fullPage: false });
console.log("consoleErrors:", errors.length, errors.slice(0, 5));
await browser.close();

const pass = affordanceOk && clicked && rowExpanded && canvasEmbedded && errors.length === 0;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
