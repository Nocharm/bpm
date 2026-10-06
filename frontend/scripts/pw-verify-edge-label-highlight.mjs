// 엣지 라벨 하이라이트 검증 — 맵 2 draft(v12, SP "Order Fulfillment" 지정) 기준:
//  [1] 엣지 선택 → 선 stroke=edge-selected 바이올렛(RF 기본 #555 아님) + 라벨 글자·테두리 바이올렛 + 링
//  [2] 노드 선택 → 들어오는 엣지 라벨 teal(edge-in) / 선과 동일 색
//  [3] SP 펼침 → 자식 엣지 클릭 선택 → 선 바이올렛 + 인스펙터 "엣지(임베드)"
// 라벨은 스크립트가 e1에 임시로 붙였다가 끝에 지운다(로컬 dev.db 초안, 자동 저장 경유).
// 실행: (frontend/) BASE_URL=http://localhost:3047 node scripts/pw-verify-edge-label-highlight.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const LABEL = "검토 완료";
const VIOLET = "rgb(124, 77, 255)"; // --color-edge-selected #7c4dff
const TEAL = "rgb(13, 148, 136)"; // --color-edge-in #0d9488

const failures = [];
const check = (cond, label) => {
  console.log(`${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();

const edgeMid = (id, t = 0.4) =>
  page.locator(`.react-flow__edge[data-id="${id}"]`).evaluate((el, t) => {
    const p = el.querySelector("path.react-flow__edge-path");
    const m = p.getPointAtLength(p.getTotalLength() * t);
    const c = p.getScreenCTM();
    return { x: m.x * c.a + m.y * c.c + c.e, y: m.x * c.b + m.y * c.d + c.f };
  }, t);
const pathStroke = (id) =>
  page.locator(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`).evaluate((p) => getComputedStyle(p).stroke);
const labelStyle = () =>
  page.locator(`.react-flow__edgelabel-renderer div:has-text("${LABEL}")`).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, border: cs.borderColor, shadow: cs.boxShadow, bg: cs.backgroundColor };
  });
const setLabel = async (edgeId, text) => {
  const pt = await edgeMid(edgeId);
  await page.mouse.dblclick(pt.x, pt.y);
  const box = page.locator("textarea.nodrag");
  await box.waitFor({ timeout: 5000 });
  await box.fill(text);
  await box.press("Enter");
  await sleep(400);
};
const nodeBox = (text, nth = 0) => page.locator(`.react-flow__node:has-text("${text}")`).nth(nth).boundingBox();
const clipAround = (boxes, pad = 40) => {
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

await page.goto(`${BASE}/maps/2?version=12`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await sleep(1200);
const force = page.getByRole("button", { name: /Force edit|강제 편집/ }).first();
if (await force.count()) { await force.click(); await sleep(1200); }

// 임시 라벨 부착
await setLabel("m2v6-e1", LABEL);
check((await page.locator(`.react-flow__edgelabel-renderer div:has-text("${LABEL}")`).count()) === 1, "temp label attached to e1");
await page.mouse.click(700, 500); // 선택 해제
await sleep(300);
const baseLabel = await labelStyle();
check(baseLabel.color !== VIOLET && baseLabel.border !== VIOLET, `[0] idle label is not highlighted (${baseLabel.color})`);

// [1] 엣지 선택
{
  const pt = await edgeMid("m2v6-e1");
  await page.mouse.click(pt.x, pt.y);
  await sleep(400);
  check(await page.locator('.react-flow__edge[data-id="m2v6-e1"].selected').count() === 1, "[1] e1 selected");
  check((await pathStroke("m2v6-e1")) === VIOLET, `[1] selected path stroke violet (${await pathStroke("m2v6-e1")})`);
  const ls = await labelStyle();
  check(ls.color === VIOLET, `[1] label text violet (${ls.color})`);
  check(ls.border === VIOLET, `[1] label border violet (${ls.border})`);
  check(ls.shadow !== "none", `[1] label ring present (${ls.shadow})`);
  await page.screenshot({ path: `${SHOT_DIR}/edge-label-1-edge-selected.png`, clip: clipAround([await nodeBox("Start"), await nodeBox("End")]) });
}
// [2] 노드 선택 → in 엣지 라벨 teal
{
  const nb = await nodeBox("Process Request");
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await sleep(400);
  check((await pathStroke("m2v6-e1")) === TEAL, `[2] in-edge path teal (${await pathStroke("m2v6-e1")})`);
  const ls = await labelStyle();
  check(ls.color === TEAL, `[2] in-edge label text teal (${ls.color})`);
  check(ls.border === TEAL, `[2] in-edge label border teal (${ls.border})`);
  check(ls.shadow === "none", `[2] in-edge label has no ring (${ls.shadow})`);
  await page.screenshot({ path: `${SHOT_DIR}/edge-label-2-node-selected.png`, clip: clipAround([await nodeBox("Start"), await nodeBox("End")]) });
  await page.mouse.click(700, 500);
  await sleep(300);
  const idle = await labelStyle();
  check(idle.color === baseLabel.color, `[2] label returns to idle after deselect (${idle.color})`);
}
// [3] SP 펼침 자식 엣지 선택
{
  await page.locator('.react-flow__node:has-text("Order Fulfillment")').first().click();
  await sleep(300);
  await page.locator('[data-id="node-action-expand"]').click();
  await page.waitForSelector('[data-id^="region-band-"]', { timeout: 15000 });
  await sleep(1600);
  const childEdge = "m2-sp-designated/m1v5-e1";
  const pt = await edgeMid(childEdge);
  await page.mouse.click(pt.x, pt.y);
  await sleep(400);
  check(await page.locator(`.react-flow__edge[data-id="${childEdge}"].selected`).count() === 1, "[3] child edge selected by click");
  check((await pathStroke(childEdge)) === VIOLET, `[3] child edge selected stroke violet (${await pathStroke(childEdge)})`);
  const inspector = await page.evaluate(() => document.body.innerText.includes("연결선(임베드)") || document.body.innerText.includes("Edge (embedded)"));
  check(inspector, "[3] inspector shows embedded edge section");
  await page.screenshot({ path: `${SHOT_DIR}/edge-label-3-child-edge-selected.png`, clip: clipAround([await nodeBox("Order Fulfillment"), await nodeBox("Process Request", 1)], 50) });
  // 접기
  await page.mouse.click(700, 500);
  await sleep(200);
  await page.locator('.react-flow__node:has-text("Order Fulfillment")').first().click();
  await sleep(300);
  const collapseBtn = page.locator('[data-id="node-action-collapse"]');
  if (await collapseBtn.count()) { await collapseBtn.click(); await sleep(1200); }
}
// 임시 라벨 제거 + 자동 저장 대기
await page.mouse.click(700, 500);
await sleep(300);
await setLabel("m2v6-e1", "");
check((await page.locator(`.react-flow__edgelabel-renderer div:has-text("${LABEL}")`).count()) === 0, "temp label removed");
await sleep(2500);

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
