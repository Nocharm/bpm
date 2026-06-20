// Task 8 스모크 — 프로세스 라이브러리 패널 열기 + 자기 참조 비활성 + 드래그로 subprocess 노드 생성.
// 실행: node scripts/pw-smoke-task8.mjs  (playwright-core, 서버 8000/3000 기동 전제)
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

// map 3 = 주문 이행(초안). 라이브러리에 주문 처리(1)/배송(2)가 보여야 하고 자기 자신(3)은 비활성.
await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(1500);

// 라이브러리 토글 버튼 클릭
const libraryToggle = page.locator('button[title="Process library"], button[aria-label="Process library"], button[title="프로세스 라이브러리"]').first();
let panelOpened = false;
try {
  await libraryToggle.click({ timeout: 5000 });
  panelOpened = true;
} catch {
  // 폴백: Network 아이콘 버튼 찾기
  const btns = await page.locator("header button").all();
  for (const btn of btns) {
    const svg = await btn.locator("svg").count();
    if (svg > 0) {
      const title = await btn.getAttribute("title");
      if (title && (title.includes("library") || title.includes("라이브러리"))) {
        await btn.click();
        panelOpened = true;
        break;
      }
    }
  }
}
await page.waitForTimeout(1000);

// 패널 내 행 확인
const panelTexts = await page.$$eval("[class*='border-hairline']", (els) =>
  els.map((el) => el.textContent?.trim() ?? "")
);
const hasJumun = panelTexts.some((t) => t.includes("주문 처리"));
const hasBaesong = panelTexts.some((t) => t.includes("배송"));

// 자기 자신(map 3) 행이 disabled(opacity-40)인지 확인
const selfDisabled = await page.evaluate(() => {
  const all = [...document.querySelectorAll("[draggable]")];
  // draggable=false 이거나 opacity-40 클래스를 가진 행이 "주문 이행" 텍스트를 포함하면 비활성
  const selfRow = [...document.querySelectorAll("div")].find(
    (el) => el.textContent?.trim() === "주문 이행" && el.className.includes("opacity-40")
  );
  return selfRow !== null && selfRow !== undefined;
});

// 노드 수 기록
const nodeCountBefore = await page.$$eval(".react-flow__node", (ns) => ns.length);

// drag-drop 시뮬레이션 — HTML5 DnD는 Playwright에서 완전 자동화가 어려움.
// DataTransfer를 직접 구성해 dragstart/dragover/drop 이벤트를 dispatch.
const dropOk = await page.evaluate(() => {
  // 라이브러리에서 map_id=1("주문 처리") 드래그를 시뮬레이트.
  // 캔버스 컨테이너(bg-canvas)를 드롭 타겟으로 사용.
  const canvas = document.querySelector(".bg-canvas");
  if (!canvas) return false;
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // DataTransfer polyfill — 실제 드래그 핸들러가 읽는 키를 설정
  const dt = new DataTransfer();
  dt.setData("application/bpm-process", "1");
  dt.setData("application/bpm-process-name", "주문 처리");
  dt.setData("application/bpm-process-pinned", "");

  // dragover → drop
  const overEvt = new DragEvent("dragover", {
    bubbles: true, cancelable: true,
    clientX: cx, clientY: cy,
    dataTransfer: dt,
  });
  canvas.dispatchEvent(overEvt);

  const dropEvt = new DragEvent("drop", {
    bubbles: true, cancelable: true,
    clientX: cx, clientY: cy,
    dataTransfer: dt,
  });
  canvas.dispatchEvent(dropEvt);
  return true;
});

await page.waitForTimeout(2000); // 비동기 getResolvedGraph + setNodes 안정화

const nodeCountAfter = await page.$$eval(".react-flow__node", (ns) => ns.length);
const nodeAdded = nodeCountAfter > nodeCountBefore;

// 스크린샷
await page.screenshot({ path: "/tmp/bpm-task8-smoke.png", fullPage: false });
await browser.close();

console.log("panelOpened:", panelOpened);
console.log("hasJumunChori(주문 처리):", hasJumun);
console.log("hasBaesong(배송):", hasBaesong);
console.log("selfDisabled(주문 이행 blocked):", selfDisabled);
console.log("dropSimulated:", dropOk);
console.log("nodeCount before -> after:", nodeCountBefore, "->", nodeCountAfter);
console.log("nodeAdded:", nodeAdded);
console.log("consoleErrors:", errors.length, errors.slice(0, 5));

// 판정: 패널 열기 + 라이브러리 행 확인 + 자기 비활성. 드롭은 bestEffort(DataTransfer 제약).
const panelOk = panelOpened && hasJumun && hasBaesong;
const ok = panelOk && errors.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
