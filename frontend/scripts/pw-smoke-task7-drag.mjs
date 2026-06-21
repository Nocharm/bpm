// Task 7 후속 스모크 — 펼침 중 루트 드래그가 커서를 1:1로 추종(튐 없음)하고, 펼친 임베드 레인 위
// 무효 드롭은 원위치로 취소되는지 실측. map 3에서 c-order(주문 처리)를 펼친 뒤 루트 c-done(이행 완료)을:
//   (a) 펼친 레인 x밴드 안으로 드래그(무효) → 드래그 전 표시 transform으로 복귀 + 미영속.
//   (b) 레인 밖 빈 영역(아래)으로 드래그(유효) → 표시중심이 커서 드롭점 ~한노드폭 이내(이중쉬프트=수백px 빗나감
//       방지) + 새로고침 후 영속.
// 콘솔 에러 0.
//
// devUser: 활성 체크아웃 보유자(user.choi)로 실행한다. dev.db 시드는 체크아웃이 없지만, 개발 PC에서 실제
// 브라우저 세션이 user.choi로 체크아웃을 잡고 있으면 admin은 읽기전용(드래그 불가)이 된다. 체크아웃을 강탈하면
// 타 세션을 끊으므로(브라우저 검증 lesson: DB/락 오염과 싸우지 말 것), 보유자와 동일 사용자로 붙어 충돌 없이
// 편집 가능 상태를 얻는다. 시드만 있는 깨끗한 환경에선 누구로 붙어도 즉시 체크아웃을 획득하므로 동일하게 동작.
//
// 실행: node scripts/pw-smoke-task7-drag.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NODE_W_FLOW = 90; // process 노드 근사 폭(flow) — 반/한 노드폭 판정용.
const AUTOSAVE_WAIT = 2800; // AUTO_SAVE_DELAY_MS(2000) + PUT 여유

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "user.choi"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  // RF가 시드 데이터의 "취소" 분기 핸들을 못 만든다는 사전 존재 경고는 본 변경과 무관 — 집계 제외.
  if (m.type() === "error" && !m.text().includes("Couldn't create edge for source handle")) {
    errors.push(m.text());
  }
});

const rdNode = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return { transform: el.style.transform, fx: +m[1], fy: +m[2] };
  }, id);

// 펼친 임베드 레인의 화면 사각형 — InlineRegionBands가 그리는 accent 보더 div.
const rdLaneScreen = () =>
  page.evaluate(() => {
    const portal =
      document.querySelector(".react-flow__viewport-portal") ||
      document.querySelector(".react-flow__viewport");
    const div = [...portal.querySelectorAll("div")].find(
      (d) => d.style.borderLeft && d.style.borderLeft.includes("accent"),
    );
    if (!div) return null;
    const r = div.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

async function expandAndZoom() {
  await page.evaluate(() =>
    document
      .querySelector('.react-flow__node[data-id="c-order"]')
      ?.querySelector("button[title]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  );
  await page.waitForTimeout(1800);
  const pane = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(70);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(700);
}

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);

const editable = await page.evaluate(() =>
  document.querySelector('.react-flow__node[data-id="c-start"]').classList.contains("draggable"),
);
if (!editable) {
  console.log("NOT EDITABLE (read-only) — checkout held by another user; cannot exercise drag.");
  await browser.close();
  process.exit(1);
}

// 펼침 전(저장좌표=표시좌표) c-done 위치를 무효-드롭 미영속 비교의 기준으로 캡처 — DB 시드/이전 실행에 무관하게 멱등.
const savedBaseline = await rdNode("c-done");
console.log("c-done saved baseline (pre-expand):", JSON.stringify({ fx: savedBaseline.fx, fy: savedBaseline.fy }));

await expandAndZoom();
const lane = await rdLaneScreen();
if (!lane) {
  console.log("NO LANE FOUND — expansion did not render embed region.");
  await browser.close();
  process.exit(1);
}
console.log("lane screen x-band:", JSON.stringify({ left: Math.round(lane.left), right: Math.round(lane.right) }));

// ===== (a) 무효 드롭 — 레인 x밴드 안으로. 드래그 전 transform 기록 후 복귀 확인 =====
const preInvalid = await rdNode("c-done");
const boxI = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
const startIx = boxI.x + boxI.width / 2;
const startIy = boxI.y + boxI.height / 2;
// 목표 화면점: 레인 가로 중앙, 세로는 레인 위쪽 빈 공간(다른 노드와 겹쳐 zone-drop 링이 뜨지 않게 충분히 위로).
const invX = (lane.left + lane.right) / 2;
const invY = Math.max(lane.top + 30, startIy - 160);
await page.mouse.move(startIx, startIy);
await page.mouse.down();
await page.mouse.move((startIx + invX) / 2, (startIy + invY) / 2, { steps: 8 });
await page.mouse.move(invX, invY, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const afterInvalid = await rdNode("c-done");
const reverted = afterInvalid.transform === preInvalid.transform;
console.log(
  "invalid drop: pre=",
  preInvalid.transform,
  "after=",
  afterInvalid.transform,
  "reverted=",
  reverted,
);

// 무효 미영속 — 디바운스 경과 후에도 저장 좌표가 안 바뀌었는지: 새로고침 후 펼침 전 기준좌표로 복귀.
await page.waitForTimeout(AUTOSAVE_WAIT);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);
const reloadAfterInvalid = await rdNode("c-done"); // 펼침 전이라 저장좌표 그대로 표시
const invalidNotPersisted =
  Math.abs(reloadAfterInvalid.fx - savedBaseline.fx) < NODE_W_FLOW &&
  Math.abs(reloadAfterInvalid.fy - savedBaseline.fy) < NODE_W_FLOW;
console.log(
  "invalid drop NOT persisted (back at pre-drag saved baseline):",
  invalidNotPersisted,
  "(reload fx=" +
    Math.round(reloadAfterInvalid.fx) +
    " fy=" +
    Math.round(reloadAfterInvalid.fy) +
    " baseline fx=" +
    Math.round(savedBaseline.fx) +
    " fy=" +
    Math.round(savedBaseline.fy) +
    ")",
);

// ===== (b) 유효 드롭 — 레인 밖(아래) 빈 영역. 커서 추종 + 영속 =====
await expandAndZoom();
const boxV = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
const startVx = boxV.x + boxV.width / 2;
const startVy = boxV.y + boxV.height / 2;
// 화면에서 아래로 100px 이동(x 유지 → 레인 우측 유지). 줌 0.2이라 100px≈500flow.
const dropVx = startVx;
const dropVy = startVy + 100;
await page.mouse.move(startVx, startVy);
await page.mouse.down();
await page.mouse.move(startVx, (startVy + dropVy) / 2, { steps: 8 });
await page.mouse.move(dropVx, dropVy, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const afterValid = await rdNode("c-done");
// 표시중심이 커서 드롭 화면점에 대응하는지 — 드롭한 노드의 화면 박스 중심과 마우스 up 지점 비교(반노드폭 화면).
const landedBox = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
const landedCx = landedBox.x + landedBox.width / 2;
const landedCy = landedBox.y + landedBox.height / 2;
const screenMiss = Math.hypot(landedCx - dropVx, landedCy - dropVy);
const followOk = screenMiss <= 30; // 줌0.2에서 한 노드폭≈18px 화면 — 30px 여유. 이중쉬프트면 ~180px(908flow*0.2) 빗나감.
console.log(
  "valid drop: display flow",
  JSON.stringify({ fx: afterValid.fx, fy: afterValid.fy }),
  "screen-miss(px)=",
  Math.round(screenMiss),
  "followOk=",
  followOk,
);

// 영속 — 새로고침 후 y 이동분 반영(저장좌표 = 표시 − offset, x는 800대 유지, y는 +500flow 근처).
await page.waitForTimeout(AUTOSAVE_WAIT);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);
const reloadAfterValid = await rdNode("c-done");
// 펼침 전 표시=저장좌표. 유효 드롭은 아래로 이동했으니, 새로고침 후 저장 y가 드롭 전 기준선보다 확실히 커졌으면 영속.
const persisted = reloadAfterValid.fy > savedBaseline.fy + NODE_W_FLOW;
console.log(
  "valid drop persisted after reload:",
  persisted,
  "(reload fy=" +
    Math.round(reloadAfterValid.fy) +
    " > baseline fy=" +
    Math.round(savedBaseline.fy) +
    " + node-width)",
);

await page.screenshot({ path: "/tmp/bpm-task7-drag.png", fullPage: false });
console.log("consoleErrors:", errors.length, errors.slice(0, 3));
await browser.close();

const pass = reverted && invalidNotPersisted && followOk && persisted && errors.length === 0;
console.log(pass ? "PASS" : "FAIL");
if (!pass) process.exit(1);
