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
// 루트(EPCV, 자식 1개) 클릭 → 단일 후보라 Facility까지 자동으로 내려가야 한다.
// Facility는 자식이 2개라 거기서 멈추는 게 의도된 동작(선택지가 생기면 사용자가 고른다).
const firstRoot = page.locator('[data-id^="framework-picker-node-"]').first();
await firstRoot.click();
const facility = page.locator('[data-id^="framework-picker-node-"]').filter({ hasText: "Facility" }).first();
await facility.waitFor({ state: "visible", timeout: 12000 });
const facilityExpanded = await facility.getAttribute("aria-expanded");
check(
  "[7] 단일 후보 자동 드릴인 — 루트 1클릭에 다음 단계가 펼쳐짐",
  facilityExpanded === "true",
  `Facility aria-expanded=${facilityExpanded}`,
);
await shot(page, "07a-autodrill-one-click");

// 나머지 체인은 갈래가 있어 수동 — 이미 열린 단계는 건너뛴다(재클릭=닫힘)
for (const name of ["계측 보전", "Calibration 기획 및 운영", "Calibration 수행 및 결과 보고"]) {
  const row = page.locator('[data-id^="framework-picker-node-"]').filter({ hasText: name }).first();
  await row.waitFor({ state: "visible", timeout: 12000 });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}
const mapRowVisible = await page
  .locator('[data-id^="framework-picker-map-"]').first()
  .waitFor({ state: "visible", timeout: 12000 })
  .then(() => true)
  .catch(() => false);
check("[7] L5까지 드릴하면 L6 목록 노출", mapRowVisible);

const highlighted = await page.locator('[data-id^="framework-picker-node-"][aria-current="true"]').count();
check("[7] 현재 L5 하이라이트(aria-current)", highlighted === 1, `count=${highlighted}`);
await shot(page, "07b-picker-highlight");

// ── 항목 2·3·4·8: 맵 행 클릭 → 피크 ──────────────────────────────────────────
const mapRow = page.locator('[data-id^="framework-picker-map-"]').first();
await mapRow.click();
const peek = page.locator('[data-id="library-peek"]');
await peek.waitFor({ state: "visible", timeout: 12000 });
const box = await peek.boundingBox();
// 1.5배 = 폭 하한 960 (창 1600 → 0.6*1600=960)
check("[2] 피크 폭 1.5배(>=940px)", (box?.width ?? 0) >= 940, `width=${Math.round(box?.width ?? 0)}`);
await page.waitForTimeout(1200); // 그래프 로드 대기
await shot(page, "02-peek-enlarged");

const zoomVisible = await page.locator('[data-id="library-peek-zoom"]').isVisible().catch(() => false);
check("[2] 줌 컨트롤 노출", zoomVisible);
if (zoomVisible) {
  await page.locator('[data-id="library-peek-zoom-in"]').click();
  await page.locator('[data-id="library-peek-zoom-in"]').click();
  const label = await page.locator('[data-id="library-peek-zoom"] span').first().textContent();
  check("[2] 줌인 반영", label?.includes("150"), `label=${label}`);
  await shot(page, "02-peek-zoomed-150");
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

// ── 항목 1: 노드 업무체계 아이콘 → 피크가 커서 기준 ──────────────────────────
await page.keyboard.press("Escape");
// SP 노드를 펼치면 영역 헤더에 업무체계 5단계 라벨(= 같은 FrameworkPeekTrigger)이 뜬다
const spNode = page.locator(".react-flow__node").first();
await spNode.click();
await page.waitForTimeout(400);
const expandBtn = page.locator('[data-id="node-action-expand"]');
if (await expandBtn.count()) {
  await expandBtn.click();
  await page.waitForSelector('[data-id^="region-band-"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1400);
}
const pill = page.locator('[data-id^="region-framework-"]').first();
const pillCount = await pill.count();
if (pillCount > 0) {
  const pillBox = await pill.boundingBox();
  const px = Math.round((pillBox?.x ?? 0) + 4);
  const py = Math.round((pillBox?.y ?? 0) + 4);
  await page.mouse.click(px, py);
  const fwPeek = page.locator('[data-id="node-framework-peek"]');
  await fwPeek.waitFor({ state: "visible", timeout: 8000 });
  const fwBox = await fwPeek.boundingBox();
  const fdx = (fwBox?.x ?? 0) - px;
  const fdy = (fwBox?.y ?? 0) - py;
  check(
    "[1] 체계 피크가 커서 좌상단 기준(오른쪽 고정 아님)",
    fdx >= -2 && fdx <= 20 && fdy >= -2 && fdy <= 20,
    `dx=${Math.round(fdx)} dy=${Math.round(fdy)}`,
  );
  await shot(page, "01-framework-peek-at-cursor");
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
