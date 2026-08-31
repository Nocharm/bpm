// 2026-08-31 UX 8종 라운드 실브라우저 확인 — 스크린샷 위주(항목 1~8).
// 전제: backend(8100)+frontend(3100) 기동 + pw-smoke-framework-canvas.mjs로 체계 시드 완료.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3100 SHOT_DIR=/tmp/shots node scripts/pw-verify-ux8-round.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-ux8";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${SHOT_DIR}/${name}.png` });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// 연계 캔버스 맵 id 찾기 — 스모크가 만든 mode=framework 맵.
// about:blank에서 부르면 인증 헤더가 안 실려 실패하므로 앱을 먼저 연 뒤 같은 오리진에서 조회한다.
await page.goto(BASE, { waitUntil: "domcontentloaded" });
const canvasId = await page.evaluate(async () => {
  const res = await fetch("/api/maps");
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.maps ?? []);
  return list.find((m) => m.mode === "framework")?.id ?? null;
});
if (canvasId === null) {
  console.log("FAIL 연계 캔버스 맵을 못 찾음 — pw-smoke-framework-canvas.mjs 선행 필요");
  process.exit(1);
}

await page.goto(`${BASE}/maps/${canvasId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 20000 });

// ── 항목 7: 트리 피커 자동 드릴인 + 현재 L5 하이라이트 ────────────────────────
await page.locator(".react-flow").first().click({ position: { x: 60, y: 400 } });
await page.keyboard.press("s");
await page.locator('[data-id="framework-tree-picker"]').waitFor({ state: "visible", timeout: 8000 });
// 피커는 마운트 시 캔버스 결착 L5 체인을 자동으로 펼친다(#14) — 먼저 그 결과를 기다린다.
const mapRowVisible = await page
  .locator('[data-id^="framework-picker-map-"]').first()
  .waitFor({ state: "visible", timeout: 12000 })
  .then(() => true)
  .catch(() => false);
check("[14] 열자마자 내 위치(L5)까지 드릴인 — L6 목록 노출", mapRowVisible);
await shot(page, "14-picker-drilled-on-open");

// [7] 단일 후보 자동 드릴인 — 자동 펼침 체인 밖 가지("유틸리티 운전")는 자식이 하나뿐이라
// 한 번 누르면 그 아래 L5까지 내려가 L6 목록이 드러나야 한다.
const otherBranch = page
  .locator('[data-id^="framework-picker-node-"]')
  .filter({ hasText: "유틸리티 운전" })
  .first();
await otherBranch.waitFor({ state: "visible", timeout: 12000 });
const beforeMaps = await page.locator('[data-id^="framework-picker-map-"]').count();
await otherBranch.click();
await page.waitForTimeout(2000);
const afterMaps = await page.locator('[data-id^="framework-picker-map-"]').count();
const leafL5 = page
  .locator('[data-id^="framework-picker-node-"]')
  .filter({ hasText: "정제수 일상 점검" })
  .first();
check(
  "[7] 단일 후보 자동 드릴인 — 1클릭에 L5까지 내려가 L6가 늘어남",
  afterMaps > beforeMaps && (await leafL5.count()) > 0,
  `maps ${beforeMaps} → ${afterMaps}`,
);
await shot(page, "07a-autodrill-one-click");

const highlighted = await page.locator('[data-id^="framework-picker-node-"][aria-current="true"]').count();
check("[7] 현재 L5 하이라이트(aria-current)", highlighted === 1, `count=${highlighted}`);
await shot(page, "07b-picker-highlight");

// ── 항목 13: 이미 이 캔버스에 있는 행 클릭 = 미리보기가 아니라 노드 포커스 ────────
// 링크 여부는 행 title로 구분한다(이미 포함 행은 "이동" 안내 문구)
const LINKED_TITLE = /이미 이 맵|Already on this map/;
const linkedRow = page.locator('[data-id^="framework-picker-map-"]').first();
const linkedTitle = await linkedRow.getAttribute("title");
const isLinkedRow = LINKED_TITLE.test(linkedTitle ?? "");
check("[13] 이미 포함된 행은 '이동' 안내로 표시", isLinkedRow, `title=${linkedTitle}`);
if (isLinkedRow) {
  await linkedRow.click();
  await page.waitForTimeout(900);
  const selected = await page.locator(".react-flow__node.selected").count();
  const peekOpened = await page.locator('[data-id="library-peek"]').count();
  check("[13] 클릭 시 미리보기 대신 노드가 선택된다", selected === 1 && peekOpened === 0, `selected=${selected} peek=${peekOpened}`);
  await shot(page, "13-linked-row-focus");
}

// ── 항목 2·3·4·8: 아직 안 들어온 맵 행 클릭 → 피크 ───────────────────────────
const rows = page.locator('[data-id^="framework-picker-map-"]');
const rowTotal = await rows.count();
let mapRow = null;
for (let i = 0; i < rowTotal; i++) {
  const title = await rows.nth(i).getAttribute("title");
  if (!LINKED_TITLE.test(title ?? "")) {
    mapRow = rows.nth(i);
    break;
  }
}
check("미링크 맵 행 확보(피크 검증용)", mapRow !== null, `rows=${rowTotal}`);
await mapRow.click();
const peek = page.locator('[data-id="library-peek"]');
await peek.waitFor({ state: "visible", timeout: 12000 });
const box = await peek.boundingBox();
// 1.5배 = 폭 하한 960 (창 1600 → 0.6*1600=960)
check("[2] 피크 폭 1.5배(>=940px)", (box?.width ?? 0) >= 940, `width=${Math.round(box?.width ?? 0)}`);
await page.waitForTimeout(1200); // 그래프 로드 대기
await shot(page, "02-peek-enlarged");

// ── 항목 16: 헤더의 "맵으로 이동" 버튼 → 확인 게이트 ─────────────────────────
const openMapBtn = page.locator('[data-id="library-peek-open-map"]');
check("[16] 피크 헤더에 '맵으로 이동' 버튼(추가 버튼 왼쪽)", (await openMapBtn.count()) > 0);
if (await openMapBtn.count()) {
  const openBox = await openMapBtn.boundingBox();
  const addBox = await page.locator('[data-id="library-peek-add"]').boundingBox();
  check("[16] 추가 버튼보다 왼쪽에 배치", (openBox?.x ?? 0) < (addBox?.x ?? 0), `open=${Math.round(openBox?.x ?? 0)} add=${Math.round(addBox?.x ?? 0)}`);
  await openMapBtn.click();
  const gate = page.locator('[data-id="confirm-dialog-confirm"]');
  const gateUp = await gate.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("[16] 클릭 시 바로 이동하지 않고 확인 게이트", gateUp);
  await shot(page, "16-peek-open-map-gate");
  // 취소 — 실제 이동은 하지 않는다(이후 검증이 이 페이지를 계속 쓴다)
  await page.locator('[data-id="confirm-dialog-cancel"]').click().catch(() => {});
  await page.waitForTimeout(500);
  if (!(await peek.isVisible().catch(() => false))) {
    await mapRow.click();
    await peek.waitFor({ state: "visible", timeout: 12000 });
    await page.waitForTimeout(800);
  }
}

const zoomVisible = await page.locator('[data-id="library-peek-zoom"]').isVisible().catch(() => false);
check("[2] 줌 컨트롤 노출", zoomVisible);
if (zoomVisible) {
  await page.locator('[data-id="library-peek-zoom-in"]').click();
  await page.locator('[data-id="library-peek-zoom-in"]').click();
  const label = await page.locator('[data-id="library-peek-zoom"] span').first().textContent();
  check("[2] 줌인 반영", label?.includes("150"), `label=${label}`);
  await shot(page, "02-peek-zoomed-150");

  // ── 항목 12: 확대 중 스크롤바 없이 드래그(그랩)로 이동 ──────────────────────
  const pane = page.locator('[data-id="library-peek"] [data-id="scope-preview-pane"]').first();
  const overflow = await pane.evaluate((el) => getComputedStyle(el).overflow);
  const cursor = await pane.evaluate((el) => getComputedStyle(el).cursor);
  check("[12] 확대 중 스크롤바 없음(overflow hidden)", overflow === "hidden", `overflow=${overflow}`);
  check("[12] 그랩 커서", cursor === "grab", `cursor=${cursor}`);
  const paneBox = await pane.boundingBox();
  const before = await pane.evaluate((el) => el.scrollLeft);
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width / 2 - 120, paneBox.y + paneBox.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await pane.evaluate((el) => el.scrollLeft);
  check("[12] 드래그로 미리보기가 이동한다", after > before, `scrollLeft ${before} → ${after}`);
  await shot(page, "12-peek-drag-pan");

  await page.locator('[data-id="library-peek-zoom-out"]').click();
  await page.locator('[data-id="library-peek-zoom-out"]').click();
}

// 항목 3: 패널 밖으로 나가도 즉시 안 꺼짐(유예 400ms) — 200ms 뒤 생존 확인
await page.mouse.move(20, 980);
await page.waitForTimeout(200);
const aliveInGrace = await peek.isVisible().catch(() => false);
check("[3] 마우스 이탈 직후 유예 중 생존", aliveInGrace);
await page.waitForTimeout(500);
const closedAfterGrace = !(await peek.isVisible().catch(() => false));
check("[3] 유예 경과 후 닫힘", closedAfterGrace);

// 다시 열기 — 목업 호버 아코디언 + 커서 기준 메뉴
await mapRow.click();
await peek.waitFor({ state: "visible", timeout: 12000 });
await page.waitForTimeout(800);
const mock = page.locator('[data-id="library-peek-node-mock"]');
// 항목 8: 외부 L6면 흰 바디, 자기 L5면 파스텔 — 어느 쪽이든 실제 캔버스 규칙과 일치해야 한다
const mockBg = await mock.evaluate((el) => getComputedStyle(el).backgroundColor);
const hasOriginBadge = await page.locator('[data-id="library-peek-mock-origin"]').count();
check(
  "[8] 목업 배경이 외부 L6 여부와 일치",
  hasOriginBadge > 0 ? /255,\s*255,\s*255/.test(mockBg) : true,
  `origin=${hasOriginBadge} bg=${mockBg}`,
);
await shot(page, "08-peek-node-mock");

// 항목 3: 목업 호버 시 높이가 애니메이션으로 변한다(transition 선언 확인 + 높이 변화)
const outerSel = '[data-id="library-peek-node-mock"] > div';
const beforeH = await page.locator(outerSel).first().evaluate((el) => el.getBoundingClientRect().height);
const transition = await page.locator(outerSel).first().evaluate((el) => getComputedStyle(el).transitionProperty);
await mock.hover();
await page.waitForTimeout(400);
const afterH = await page.locator(outerSel).first().evaluate((el) => el.getBoundingClientRect().height);
check("[3] 목업 높이 전환 선언(height transition)", transition.includes("height"), `transition=${transition}`);
check("[3] 호버로 목업 높이 변화(아코디언 대상)", beforeH !== afterH, `${Math.round(beforeH)} → ${Math.round(afterH)}`);
await shot(page, "03-mock-hover");

// 항목 4: 목업 클릭 메뉴가 커서 좌상단 기준
const mockBox = await mock.boundingBox();
const clickX = Math.round((mockBox?.x ?? 0) + 30);
const clickY = Math.round((mockBox?.y ?? 0) + 20);
await page.mouse.click(clickX, clickY);
const menu = page.locator('[data-id="library-peek-mock-menu"]');
await menu.waitFor({ state: "visible", timeout: 5000 });
const menuBox = await menu.boundingBox();
const dx = (menuBox?.x ?? 0) - clickX;
const dy = (menuBox?.y ?? 0) - clickY;
check(
  "[4] 메뉴가 커서를 좌상단 기준으로 뜬다",
  Math.abs(dx) <= 4 && Math.abs(dy) <= 4,
  `dx=${Math.round(dx)} dy=${Math.round(dy)}`,
);
await shot(page, "04-mock-menu-at-cursor");
await page.keyboard.press("Escape");
await page.mouse.click(800, 950);

// ── 항목 1: 영역 헤더 업무체계 라벨 → 피크가 커서 기준 ───────────────────────
// 피크·트리 피커를 먼저 치운다 — 열려 있으면 캔버스 클릭이 가려진다
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
// 피커가 열려 있으면 캔버스가 좁아져 영역 헤더가 오른쪽으로 잘린다 — 닫기 버튼으로 확실히 닫는다
const pickerClose = page.locator('[data-id="framework-tree-picker"] button[aria-label="Close"]');
if (await pickerClose.count()) {
  await pickerClose.click({ timeout: 5000 }).catch(() => {});
  await page.locator('[data-id="framework-tree-picker"]').waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
}
// SP 노드를 펼치면 영역 헤더에 업무체계 5단계 라벨(= 같은 FrameworkPeekTrigger)이 뜬다
const spNode = page.locator(".react-flow__node").first();
await spNode.click();
await page.waitForTimeout(400);
const expandBtn = page.locator('[data-id="node-action-expand"]');
if (await expandBtn.count()) {
  await expandBtn.click();
  await page.waitForSelector('[data-id^="region-band-"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1400);
  // 펼친 영역이 화면 밖으로 나가면 헤더 라벨을 못 누른다 — 전체 보기로 맞춘다
  await page.keyboard.press("Shift+1").catch(() => {});
  await page.waitForTimeout(900);
}
const pill = page.locator('[data-id^="region-framework-"]').first();
const pillCount = await pill.count();
if (pillCount > 0) {
  await pill.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  const pillBox = await pill.boundingBox();
  const px = Math.round((pillBox?.x ?? 0) + 4);
  const py = Math.round((pillBox?.y ?? 0) + 4);
  await page.mouse.move(px, py); // 커서 위치를 트리거가 기록하게 — 클릭 좌표가 곧 앵커다
  await page.mouse.click(px, py);
  const fwPeek = page.locator('[data-id="node-framework-peek"]');
  const opened = await fwPeek.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (!opened) {
    check("[1] 체계 피크가 커서 좌상단 기준", false, "피크가 안 열림");
    await shot(page, "01-framework-peek-FAILED");
  } else {
    const fwBox = await fwPeek.boundingBox();
    const fdx = (fwBox?.x ?? 0) - px;
    const fdy = (fwBox?.y ?? 0) - py;
    check(
      "[1] 체계 피크가 커서 좌상단 기준(오른쪽 고정 아님)",
      fdx >= -2 && fdx <= 20 && fdy >= -2 && fdy <= 20,
      `dx=${Math.round(fdx)} dy=${Math.round(fdy)}`,
    );
    await shot(page, "01-framework-peek-at-cursor");
  }
} else {
  check("[1] 체계 피크가 커서 좌상단 기준", false, "region-framework 라벨 없음(시드 한계)");
}

check("페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`shots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
