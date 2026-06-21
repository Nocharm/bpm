// Task 7 스모크 — 하위프로세스 읽기전용 딥뷰 드릴인 검증.
// map 3에서 하위프로세스 c-order(주문 처리)를 더블클릭 → 링크맵(주문 처리) 노드들이 읽기전용 활성 영역으로 열린다.
// 검증: 드릴 노드(검토) 표시·비드래그, 조상(루트) 컨텍스트 dim, 브레드크럼 2단계, 루트 복귀 시 편집 재개·펼침 유지, 콘솔 에러 0.
// 실행: node scripts/pw-smoke-task7.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-order"]', { timeout: 30000 });
await page.waitForTimeout(2000);

const breadcrumbTitles = () =>
  page.$$eval("header nav button", (bs) => bs.map((b) => b.textContent?.trim() ?? ""));

const crumbsBefore = await breadcrumbTitles();

// 더블클릭 직전 카메라(뷰포트) 기록 — 드릴인이 카메라를 크게 점프시키지 않아야 함.
const vpBefore = await page.evaluate(
  () => document.querySelector(".react-flow__viewport")?.style.transform ?? "",
);

// 1. 하위프로세스 c-order(주문 처리) 더블클릭 → 읽기전용 딥뷰 드릴인
const orderNode = page.locator('.react-flow__node[data-id="c-order"]').first();
const orderBox = await orderNode.boundingBox();
await page.mouse.dblclick(orderBox.x + orderBox.width / 2, orderBox.y + orderBox.height / 2);
await page.waitForTimeout(2000);

const crumbsAfter = await breadcrumbTitles();
const vpAfter = await page.evaluate(
  () => document.querySelector(".react-flow__viewport")?.style.transform ?? "",
);

// 드릴인하면 링크맵(주문 처리)의 노드(검토)가 활성 영역으로 등장. 네임스페이스 id = c-order/a-review.
const drilledNode = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__node[data-id="c-order/a-review"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    present: true,
    text: el.textContent?.trim() ?? "",
    opacity: cs.opacity,
    draggable: el.classList.contains("draggable") && !el.classList.contains("nodrag"),
    hasNodrag: el.classList.contains("nodrag"),
  };
});

// 조상(루트) 컨텍스트 — 루트 프레임 노드(이행 완료=c-done)는 dim(opacity<1)으로 감싸 보임.
const ancestorDim = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__node[data-id="c-done"]');
  if (!el) return null;
  return { present: true, opacity: getComputedStyle(el).opacity };
});

// 카메라 점프 없음 — 뷰포트 scale이 동일(드릴인은 offset만 보정, 줌 불변).
const scaleOf = (t) => {
  const m = t.match(/scale\(([^)]+)\)/);
  return m ? parseFloat(m[1]) : 1;
};
const noCameraJump = Math.abs(scaleOf(vpBefore) - scaleOf(vpAfter)) < 0.05;

// 2. 드릴 노드는 읽기전용 — 드래그 시도 후 위치 불변
let drillNotDraggable = true;
const dn = page.locator('.react-flow__node[data-id="c-order/a-review"]').first();
const dnBox = await dn.boundingBox();
if (dnBox) {
  const t0 = await page.evaluate(
    () => document.querySelector('.react-flow__node[data-id="c-order/a-review"]')?.style.transform,
  );
  await page.mouse.move(dnBox.x + dnBox.width / 2, dnBox.y + dnBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dnBox.x + dnBox.width / 2 + 60, dnBox.y + dnBox.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const t1 = await page.evaluate(
    () => document.querySelector('.react-flow__node[data-id="c-order/a-review"]')?.style.transform,
  );
  drillNotDraggable = t0 === t1; // 읽기전용이면 드래그해도 위치 그대로
}

// 3. 브레드크럼 루트 크럼 클릭 → 루트 편집 재개, 펼침(c-order 자식) 유지
await page.locator("header nav button").first().click();
await page.waitForTimeout(1500);
const crumbsBack = await breadcrumbTitles();
// 루트로 복귀하면 루트 노드(c-order)가 다시 프레임 노드로 잡혀 드래그 가능(draggable, not nodrag).
const rootEditableAgain = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__node[data-id="c-order"]');
  if (!el) return false;
  return el.classList.contains("draggable") && !el.classList.contains("nodrag");
});
// 펼침 유지 — c-order의 자식(검토=c-order/a-review)이 여전히 인라인으로 보임.
const expansionPreserved = await page.evaluate(
  () => document.querySelector('.react-flow__node[data-id="c-order/a-review"]') !== null,
);

await page.screenshot({ path: "/tmp/bpm-task7-smoke.png", fullPage: false });
await browser.close();

console.log("breadcrumb before drill:", JSON.stringify(crumbsBefore));
console.log("breadcrumb after drill:", JSON.stringify(crumbsAfter));
console.log("drilled node (c-order/a-review):", JSON.stringify(drilledNode));
console.log("ancestor context (c-done) dim:", JSON.stringify(ancestorDim));
console.log("no camera jump:", noCameraJump, "(vp scale", scaleOf(vpBefore), "->", scaleOf(vpAfter), ")");
console.log("drill node not draggable:", drillNotDraggable);
console.log("breadcrumb after back:", JSON.stringify(crumbsBack));
console.log("root editable again:", rootEditableAgain);
console.log("expansion preserved after back:", expansionPreserved);
console.log("consoleErrors:", errors.length, errors.slice(0, 5));

const drillOpened = crumbsAfter.length === 2 && !!drilledNode?.present;
const drillReadOnly = !!drilledNode && !drilledNode.draggable && drillNotDraggable;
const ancestorOk = !!ancestorDim && parseFloat(ancestorDim.opacity) < 1;
const backOk = crumbsBack.length >= 1 && rootEditableAgain && expansionPreserved;
const ok =
  drillOpened && drillReadOnly && ancestorOk && noCameraJump && backOk && errors.length === 0;

console.log(
  "drillOpened:", drillOpened,
  "drillReadOnly:", drillReadOnly,
  "ancestorOk:", ancestorOk,
  "noCameraJump:", noCameraJump,
  "backOk:", backOk,
  "errorsOk:", errors.length === 0,
);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
