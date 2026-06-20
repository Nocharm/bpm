// Task 6 시각 스모크 — 하위 편집 경로 제거 후 두 가지 검증:
// 1) 임베드 회귀: 펼침 후 embedded 자식(접수/검토)이 여전히 표시됨 (Task 5 regression safety net)
// 2) 편집 스모크: 펼침 전 루트 노드는 draggable 클래스 보유, 펼침 후 자식 노드는 draggable 클래스 없음
// 실행: node scripts/pw-smoke-task6.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});
const page = await ctx.newPage();
const consoleErrors = [];
const serverErrors500 = [];
// Pre-existing 500s from checkout/notifications polling — not caused by Task 6
const PREEXISTING_500_PATHS = ["/checkout", "/notifications"];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 500) serverErrors500.push(r.url());
});

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2000); // 측정/레이아웃 안정화

// ── 1. 펼침 전: 루트 노드가 draggable 클래스를 보유하는지 확인 ──────────
// RF v12: draggable=true인 노드에 'draggable' 클래스 부여.
// nodesDraggable prop이 false이면 전체 비활성화되므로 expandedInline.size===0일 때 측정.
const beforeInfo = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".react-flow__node")];
  return nodes.slice(0, 3).map((n) => ({
    text: n.textContent?.trim().slice(0, 20) ?? "",
    draggable: n.classList.contains("draggable"),
    selectable: n.classList.contains("selectable"),
  }));
});
const rootIsDraggable = beforeInfo.length > 0 && beforeInfo[0].draggable === true;

// ── 2. 임베드 회귀: 펼침 후 자식 등장 ───────────────────────────────────
const textsBefore = await page.$$eval(".react-flow__node", (ns) =>
  ns.map((n) => n.textContent?.trim() ?? ""),
);
const nodeCountBefore = textsBefore.length;

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
    const order = [...document.querySelectorAll(".react-flow__node")].find((n) =>
      n.textContent?.includes("주문 처리"),
    );
    const btn = order?.querySelector("button[title]");
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  });
}
await page.waitForTimeout(2000); // 펼침 애니메이션 + materialize

const textsAfter = await page.$$eval(".react-flow__node", (ns) =>
  ns.map((n) => n.textContent?.trim() ?? ""),
);
const hasJeobsu = textsAfter.some((t) => t.includes("접수"));
const hasGeomto = textsAfter.some((t) => t.includes("검토"));
const nodeCountAfter = textsAfter.length;

// ── 3. 펼침 후: 자식 노드(접수)는 draggable 클래스 없음(read-only) ────────
// 펼침 중 nodesDraggable=false이므로 루트도 draggable 없음 — 이것이 설계.
// 자식이 draggable:false로 설정됐는지 확인: RF는 노드별 draggable=false면 클래스도 없음.
// 루트와 자식 모두 draggable 없는 것이 정상 — 중요한 건 자식 노드가 selectable인지(클릭 허용).
const afterInfo = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".react-flow__node")];
  const child = nodes.find((n) => n.textContent?.includes("접수"));
  const root = nodes.find((n) => n.textContent?.includes("주문 접수"));
  return {
    childSelectable: child?.classList.contains("selectable") ?? null,
    childDraggable: child?.classList.contains("draggable") ?? null,
    rootSelectable: root?.classList.contains("selectable") ?? null,
    rootDraggable: root?.classList.contains("draggable") ?? null,
  };
});

// 펼침 후 자식은 selectable(클릭 가능)이지만 draggable 없어야 함 — read-only 증명
const childIsSelectableNotDraggable =
  afterInfo.childSelectable === true && afterInfo.childDraggable === false;

await page.screenshot({ path: "/tmp/bpm-task6-smoke.png", fullPage: false });
await browser.close();

// pre-existing 500s (checkout/notifications) 제외한 실제 서버 오류만 집계
const taskErrors500 = serverErrors500.filter(
  (url) => !PREEXISTING_500_PATHS.some((path) => url.includes(path)),
);

console.log("beforeInfo (root nodes):", JSON.stringify(beforeInfo));
console.log("rootIsDraggable (before expand):", rootIsDraggable);
console.log("toggle clicked:", clicked);
console.log("nodeCount before -> after:", nodeCountBefore, "->", nodeCountAfter);
console.log("embedded visible — 접수:", hasJeobsu, "검토:", hasGeomto);
console.log("afterInfo (child classes post-expand):", JSON.stringify(afterInfo));
console.log("childIsSelectableNotDraggable:", childIsSelectableNotDraggable);
console.log("consoleErrors (all):", consoleErrors.length, consoleErrors.slice(0, 5));
console.log("serverErrors500 (all):", serverErrors500);
console.log("taskErrors500 (non-pre-existing):", taskErrors500);

const embedOk = clicked && hasJeobsu && hasGeomto && nodeCountAfter > nodeCountBefore;
const editingOk = rootIsDraggable && childIsSelectableNotDraggable;
const noTaskErrors = taskErrors500.length === 0;

console.log("embedOk:", embedOk, "editingOk:", editingOk, "noTaskErrors:", noTaskErrors);
const ok = embedOk && editingOk && noTaskErrors;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
