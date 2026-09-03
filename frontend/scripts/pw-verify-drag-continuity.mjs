// height-shift 드래그 연속성 검증 — 노드정보(assignee+params) 노출로 커진 앵커(p-a) 아래 p-b를
// 밴드 경계 너머로 끌어올리며 매 스텝 화면 rect를 샘플링:
//   (a) 스텝당 이동량이 커서 스텝 + 여유(≤45px)를 넘지 않는다(구 계단 역변환의 스톨→풋프린트 점프 부재)
//   (b) 커서 누적 이동과 노드 누적 이동이 ±8px 이내(1:1 추종)
//   (c) 드롭 후 저장 pos_y == 표시 y(밴드 위=오프셋 0, 정착 완료) ± 1
//   (d) 콘솔 에러 0
// 실행: node scripts/pw-verify-drag-continuity.mjs  (서버 8100/3100, setup_dragmap.py 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAP_ID = 26;
const VERSION_ID = 86;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const rectOf = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, id);

const flowYOf = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    const m = el?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return m ? +m[2] : null;
  }, id);

await page.goto(`http://localhost:3100/maps/${MAP_ID}`, { waitUntil: "networkidle" });
await page.waitForSelector('.react-flow__node[data-id="p-b"]', { timeout: 20000 });
// 로드 fitView + 성장 재-fit(80ms 디바운스 + 300ms 카메라) 정착 대기
await page.waitForTimeout(2500);

// 전제: p-a가 밴드를 만들 만큼 컸는지 — p-b(저장 560)의 표시 flow y로 오프셋 실측
const preFlowY = await flowYOf("p-b");
const extra = preFlowY - 560;
console.log(`[pre] p-b display flow y=${preFlowY} (saved 560, band offset=${extra.toFixed(1)}px)`);
if (extra < 40) {
  console.error(`FAIL precondition: band offset too small (${extra}) - anchor not grown?`);
  process.exit(1);
}

const start = await rectOf("p-b");
const zoom = await page.evaluate(() => {
  const vp = document.querySelector(".react-flow__viewport");
  const m = vp?.style.transform.match(/scale\(([\d.]+)\)/);
  return m ? +m[1] : 1;
});
console.log(`[pre] zoom=${zoom.toFixed(3)} start rect=(${start.cx.toFixed(0)}, ${start.cy.toFixed(0)})`);

// 드래그: 잡고 → 우측으로 비켜(+240px, p-a 열·충돌 완전 회피) → 위로 스텝 이동(밴드 관통)
const STEP = 18;
const UP_STEPS = Math.ceil(((extra + 430) * zoom) / STEP); // 밴드 전체 + 여유를 관통할 스텝 수
await page.mouse.move(start.cx, start.cy);
await page.mouse.down();
await page.mouse.move(start.cx + 120, start.cy, { steps: 4 });
await page.mouse.move(start.cx + 240, start.cy, { steps: 4 });
await page.waitForTimeout(80);

let prevTop = (await rectOf("p-b")).y;
const cursorStartY = start.cy;
const trackStartTop = prevTop;
let maxStepJump = 0;
let maxTrackDrift = 0;
let cursorY = start.cy;
for (let i = 0; i < UP_STEPS; i += 1) {
  cursorY -= STEP;
  await page.mouse.move(start.cx + 240, cursorY);
  await page.waitForTimeout(30); // rAF 두 프레임 여유 — 표시 반영 후 샘플
  const cur = await rectOf("p-b");
  const stepMove = Math.abs(cur.y - prevTop);
  const drift = Math.abs(cur.y - trackStartTop - (cursorY - cursorStartY));
  maxStepJump = Math.max(maxStepJump, stepMove);
  maxTrackDrift = Math.max(maxTrackDrift, drift);
  prevTop = cur.y;
}
await page.mouse.up();
console.log(`[drag] steps=${UP_STEPS} maxStepJump=${maxStepJump.toFixed(1)}px maxTrackDrift=${maxTrackDrift.toFixed(1)}px`);

// 정착(트윈 350ms) + autosave 대기 후 저장 좌표 대조
await page.waitForTimeout(3200);
const finalFlowY = await flowYOf("p-b");
const res = await fetch(`http://localhost:8100/api/versions/${VERSION_ID}/graph`, {
  headers: { "X-Dev-User": "admin.sys" },
});
const graph = await res.json();
const saved = graph.nodes.find((n) => n.id === "p-b");
console.log(`[post] saved pos_y=${saved.pos_y} display flow y=${finalFlowY}`);

let ok = true;
if (maxStepJump > 45) {
  console.error(`FAIL (a) step jump ${maxStepJump.toFixed(1)}px > 45px - 스톨→점프 잔존`);
  ok = false;
}
if (maxTrackDrift > 8) {
  console.error(`FAIL (b) cursor tracking drift ${maxTrackDrift.toFixed(1)}px > 8px`);
  ok = false;
}
if (saved.pos_y >= 160 || saved.pos_y <= 0) {
  console.error(`FAIL (c) saved pos_y=${saved.pos_y} - 밴드 위로 이동 미반영`);
  ok = false;
}
if (Math.abs(finalFlowY - saved.pos_y) > 1.5) {
  console.error(`FAIL (c) display(${finalFlowY}) != saved(${saved.pos_y}) - 밴드 위 오프셋 0이어야 함`);
  ok = false;
}
if (errors.length > 0) {
  console.error(`FAIL (d) console errors: ${errors.slice(0, 3).join(" | ")}`);
  ok = false;
}
console.log(ok ? "PASS drag-continuity" : "FAILED drag-continuity");
await browser.close();
process.exit(ok ? 0 : 1);
