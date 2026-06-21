// 재현 — 하위프로세스 펼친 상태에서 ROOT 노드가 여전히 편집(드래그) 가능한지 실측.
// 루트 노드 c-done(이행 완료)을 펼침 전/후로 opacity·transform 비교 + 실제 드래그.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2000);

const readRoot = () => page.evaluate(() => {
  const el = document.querySelector('.react-flow__node[data-id="c-done"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { opacity: cs.opacity, transform: el.style.transform, draggableAttr: el.classList.contains("nodrag") };
});

const beforeExpand = await readRoot();

// 주문 처리(c-order) 펼침
const orderNode = page.locator('.react-flow__node[data-id="c-order"]').first();
await orderNode.hover();
await page.waitForTimeout(200);
let clicked = false;
try {
  await orderNode.locator('button[title*="ubprocess"], button[title*="펼치기"]').first().click({ timeout: 4000, force: true });
  clicked = true;
} catch {
  clicked = await page.evaluate(() => {
    const o = document.querySelector('.react-flow__node[data-id="c-order"]');
    const b = o?.querySelector("button[title]");
    if (!b) return false;
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  });
}
await page.waitForTimeout(2000);

const afterExpand = await readRoot();

// 실제 드래그 — c-done을 우측으로 60px
const box = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
let dragMoved = false;
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const afterDrag = await readRoot();
  dragMoved = afterDrag && afterExpand && afterDrag.transform !== afterExpand.transform;
}

await page.screenshot({ path: "/tmp/bpm-repro-root-edit.png", fullPage: false });
await browser.close();

console.log("beforeExpand c-done:", JSON.stringify(beforeExpand));
console.log("toggle clicked:", clicked);
console.log("afterExpand  c-done:", JSON.stringify(afterExpand));
console.log("root drag moved after expand:", dragMoved);
console.log("consoleErrors:", errors.length);
const rootEditable = afterExpand && afterExpand.opacity === "1" && !afterExpand.draggableAttr && dragMoved;
console.log(rootEditable ? "ROOT EDITABLE WHEN EXPANDED (no bug)" : "ROOT READ-ONLY WHEN EXPANDED (bug reproduced)");
