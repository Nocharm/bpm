// Shift 드래그 축 고정 검증 (Task 4.2) — 단일 노드·다중선택 노드·그룹을 Shift 누른 채 대각선으로 드래그하면
// 드롭 후에도(드롭 확정 change까지 포함) 시작점 대비 더 큰 변위의 축만 움직이고 나머지 축은 고정되는지 확인.
// 대조군으로 Shift 없이 드래그하면 두 축 모두 움직이는지도 확인(항상-고정 회귀 방지).
//
// 시나리오: 새 맵 생성(Start/End 자동 시드, pw-verify-new-map-seed.mjs와 동일 패턴 — 데모 시드/체크아웃 점유에
// 의존하지 않음) →
//   ① Start 단일 Shift+대각 드래그: y 고정·x만 이동
//   ② Shift 없이 대각 드래그(대조군): x·y 둘 다 이동
//   ③ Start+End 다중선택(클릭+Meta클릭) 후 Start '노드'를 Shift+대각 드래그: 두 노드 모두 y 고정·x만 이동
//      (노드를 잡는 경로 = onNodeDragStart → dragStartPositionsRef가 nodes 전체를 커버해야 통과)
//   ④ Start+End 다중선택 후 '선택박스 오버레이'(두 노드 사이 빈 공간)를 Shift+대각 드래그: 두 노드 모두 y 고정
//      (오버레이 경로 = onSelectionDragStart → 여기서도 dragStartPositionsRef 시드 + dropDraggingPositions 보정)
//   ⑤ 두 노드를 그룹핑(Meta+G) 후 그룹 타이틀바 이동 핸들을 Shift+대각 드래그: 멤버 전원 한 축만 이동
//      (startGroupMove onMove가 constrainToAxis로 델타를 잠금)
//   ⑥ 콘솔 에러 0.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-shift-drag.mjs
// 전제: backend :8000(reset_db 시드 무관, API로 맵을 새로 만듦), frontend :3000, playwright-core(--no-save)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const LOCK_EPS = 1; // flow px — 고정축은 정확히 시작값이어야 하므로(constrainToAxis가 그대로 대입) 여유는 최소.
const MOVE_MIN = 40; // flow px — 자유축은 이만큼은 움직여야 "실제로 드래그됐다"로 인정.

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

// 노드 표시좌표(flow 단위) — RF가 .react-flow__node에 쓰는 translate(x,y) transform을 그대로 읽는다.
const readNodePos = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }, id);

const idByText = async (text) => {
  const loc = page.locator(".react-flow__node", { hasText: text }).first();
  return loc.getAttribute("data-id");
};

// 화면 좌표로 마우스 다운→다각 이동→업. shiftKey면 드래그 내내 Shift를 누른 채 진행.
async function dragBy(nodeId, dx, dy, { shiftKey = false } = {}) {
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  if (shiftKey) await page.keyboard.down("Shift");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, startY + (dy * i) / steps, { steps: 1 });
  }
  await page.mouse.up();
  if (shiftKey) await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
}

// 임의의 화면 점에서 마우스 다운→다각 이동→업 (노드가 아닌 선택박스 오버레이·그룹 핸들 드래그용).
async function dragFromPoint(sx, sy, dx, dy, { shiftKey = false } = {}) {
  if (shiftKey) await page.keyboard.down("Shift");
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps, { steps: 1 });
  }
  await page.mouse.up();
  if (shiftKey) await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
}

// 두 노드를 Meta+클릭으로 다중선택. (플레인 클릭이 나머지를 해제하므로 첫 노드는 일반 클릭.)
async function selectBoth(aId, bId) {
  await page.locator(`.react-flow__node[data-id="${aId}"]`).click();
  await page.keyboard.down("Meta");
  await page.locator(`.react-flow__node[data-id="${bId}"]`).click();
  await page.keyboard.up("Meta");
  await page.waitForTimeout(200);
}

let mapId = null;
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  const stamp = Date.now();
  const created = await api("/maps", {
    method: "POST",
    body: {
      name: `Shift-Drag Verify ${stamp}`,
      description: "",
      visibility: "public",
      owning_department: owningDept,
    },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);

  const startId = await idByText("Start");
  const endId = await idByText("End");
  check("Start/End 노드 렌더", Boolean(startId && endId), `start=${startId} end=${endId}`);

  // ===== ① 단일 노드 Shift+대각 드래그 — y 고정, x만 이동 =====
  const beforeSingle = await readNodePos(startId);
  await dragBy(startId, 160, 100, { shiftKey: true });
  const afterSingle = await readNodePos(startId);
  const singleYLocked = Math.abs(afterSingle.y - beforeSingle.y) <= LOCK_EPS;
  const singleXMoved = Math.abs(afterSingle.x - beforeSingle.x) >= MOVE_MIN;
  check(
    "단일 드래그: Shift 시 y축 고정",
    singleYLocked,
    `before=${JSON.stringify(beforeSingle)} after=${JSON.stringify(afterSingle)}`,
  );
  check("단일 드래그: Shift 시 x축은 이동", singleXMoved);

  // ===== ② 대조군 — Shift 없이 대각 드래그하면 두 축 다 이동 =====
  const beforePlain = await readNodePos(startId);
  await dragBy(startId, 120, 80, { shiftKey: false });
  const afterPlain = await readNodePos(startId);
  const plainXMoved = Math.abs(afterPlain.x - beforePlain.x) >= MOVE_MIN;
  const plainYMoved = Math.abs(afterPlain.y - beforePlain.y) >= MOVE_MIN;
  check(
    "대조군: Shift 없으면 x·y 둘 다 이동(항상-고정 회귀 아님)",
    plainXMoved && plainYMoved,
    `before=${JSON.stringify(beforePlain)} after=${JSON.stringify(afterPlain)}`,
  );

  // ===== ③ 다중선택(Start+End) 후 Start '노드'를 Shift+대각 드래그 — 둘 다 y 고정, x만 이동 =====
  await selectBoth(startId, endId);
  const selectedCount = await page.locator(".react-flow__node.selected").count();
  check("다중선택 성사(2개 selected)", selectedCount === 2, `selected=${selectedCount}`);

  const beforeMultiStart = await readNodePos(startId);
  const beforeMultiEnd = await readNodePos(endId);
  await dragBy(startId, 150, 90, { shiftKey: true });
  const afterMultiStart = await readNodePos(startId);
  const afterMultiEnd = await readNodePos(endId);

  const multiStartYLocked = Math.abs(afterMultiStart.y - beforeMultiStart.y) <= LOCK_EPS;
  const multiStartXMoved = Math.abs(afterMultiStart.x - beforeMultiStart.x) >= MOVE_MIN;
  const multiEndYLocked = Math.abs(afterMultiEnd.y - beforeMultiEnd.y) <= LOCK_EPS;
  const multiEndXMoved = Math.abs(afterMultiEnd.x - beforeMultiEnd.x) >= MOVE_MIN;
  check(
    "다중선택(노드잡기) 드래그: 잡은 노드(Start) y축 고정",
    multiStartYLocked,
    `before=${JSON.stringify(beforeMultiStart)} after=${JSON.stringify(afterMultiStart)}`,
  );
  check("다중선택(노드잡기) 드래그: 잡은 노드(Start) x축 이동", multiStartXMoved);
  check(
    "다중선택(노드잡기) 드래그: 동반 노드(End) y축도 고정",
    multiEndYLocked,
    `before=${JSON.stringify(beforeMultiEnd)} after=${JSON.stringify(afterMultiEnd)}`,
  );
  check("다중선택(노드잡기) 드래그: 동반 노드(End) x축도 이동", multiEndXMoved);

  // ===== ④ 다중선택 후 '선택박스 오버레이'를 Shift+대각 드래그 — onSelectionDragStart 경로 =====
  // 두 노드 사이 빈 공간(선택박스 rect만 있고 노드는 없는 지점)에 마우스를 눌러 오버레이 드래그를 발동.
  await selectBoth(startId, endId);
  const rectPresent = (await page.locator(".react-flow__nodesselection-rect").count()) > 0;
  check("선택박스 오버레이(.react-flow__nodesselection-rect) 렌더", rectPresent);

  const startBox = await page.locator(`.react-flow__node[data-id="${startId}"]`).boundingBox();
  const endBox = await page.locator(`.react-flow__node[data-id="${endId}"]`).boundingBox();
  // Start·End는 같은 y라 두 노드 사이(수평 중앙, 수직 중앙)가 오버레이만 있는 빈 지점.
  const [leftBox, rightBox] = startBox.x <= endBox.x ? [startBox, endBox] : [endBox, startBox];
  const gapX = (leftBox.x + leftBox.width + rightBox.x) / 2;
  const gapY = leftBox.y + leftBox.height / 2;
  // 그 지점의 최상위 요소가 실제로 오버레이 rect인지 확인(노드 위면 onNodeDrag 경로로 새므로 검증 무의미).
  const hitClass = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.className?.toString() ?? "",
    { x: gapX, y: gapY },
  );
  check(
    "오버레이 빈 지점 적중(nodesselection-rect)",
    hitClass.includes("nodesselection-rect"),
    `hit="${hitClass}"`,
  );

  const beforeOvStart = await readNodePos(startId);
  const beforeOvEnd = await readNodePos(endId);
  await dragFromPoint(gapX, gapY, 140, 90, { shiftKey: true });
  const afterOvStart = await readNodePos(startId);
  const afterOvEnd = await readNodePos(endId);
  check(
    "오버레이 드래그: Start y축 고정",
    Math.abs(afterOvStart.y - beforeOvStart.y) <= LOCK_EPS,
    `before=${JSON.stringify(beforeOvStart)} after=${JSON.stringify(afterOvStart)}`,
  );
  check("오버레이 드래그: Start x축 이동", Math.abs(afterOvStart.x - beforeOvStart.x) >= MOVE_MIN);
  check(
    "오버레이 드래그: End y축도 고정",
    Math.abs(afterOvEnd.y - beforeOvEnd.y) <= LOCK_EPS,
    `before=${JSON.stringify(beforeOvEnd)} after=${JSON.stringify(afterOvEnd)}`,
  );
  check("오버레이 드래그: End x축도 이동", Math.abs(afterOvEnd.x - beforeOvEnd.x) >= MOVE_MIN);

  // ===== ⑤ 그룹핑(Meta+G) 후 그룹 타이틀바 이동 핸들을 Shift+대각 드래그 — startGroupMove 경로 =====
  await selectBoth(startId, endId);
  await page.keyboard.down("Meta");
  await page.keyboard.press("g"); // event.code === "KeyG" — createGroupFromSelection
  await page.keyboard.up("Meta");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape"); // 갓 생성된 그룹의 이름 편집모드 종료
  await page.waitForTimeout(200);

  const moveHandle = page.locator('[aria-label="Move group"]').first();
  const groupPresent = (await moveHandle.count()) > 0;
  check("그룹 타이틀바 이동 핸들 렌더", groupPresent);

  if (groupPresent) {
    const handleBox = await moveHandle.boundingBox();
    const hx = handleBox.x + handleBox.width / 2;
    const hy = handleBox.y + handleBox.height / 2;
    const beforeGrpStart = await readNodePos(startId);
    const beforeGrpEnd = await readNodePos(endId);
    await dragFromPoint(hx, hy, 150, 90, { shiftKey: true }); // x 우세 → y 고정, x 이동
    const afterGrpStart = await readNodePos(startId);
    const afterGrpEnd = await readNodePos(endId);
    check(
      "그룹 이동: 멤버 Start y축 고정",
      Math.abs(afterGrpStart.y - beforeGrpStart.y) <= LOCK_EPS,
      `before=${JSON.stringify(beforeGrpStart)} after=${JSON.stringify(afterGrpStart)}`,
    );
    check("그룹 이동: 멤버 Start x축 이동", Math.abs(afterGrpStart.x - beforeGrpStart.x) >= MOVE_MIN);
    check(
      "그룹 이동: 멤버 End y축도 고정",
      Math.abs(afterGrpEnd.y - beforeGrpEnd.y) <= LOCK_EPS,
      `before=${JSON.stringify(beforeGrpEnd)} after=${JSON.stringify(afterGrpEnd)}`,
    );
    check("그룹 이동: 멤버 End x축도 이동", Math.abs(afterGrpEnd.x - beforeGrpEnd.x) >= MOVE_MIN);
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
console.log(failed.length === 0 ? "PASS" : "FAIL");
process.exit(failed.length === 0 ? 0 : 1);
