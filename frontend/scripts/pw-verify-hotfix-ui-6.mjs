// 핫픽스 UI 6 시각 검증 — ① 백-투-에디터 버튼 ② 피커 드롭다운(밀림·클리핑) ③ 980px 분기점 3탭.
// 실행: frontend/ 에서 node scripts/pw-verify-hotfix-ui-6.mjs
// 전제: backend :8000 + frontend :3000 기동, dev.db에 맵·공지·알림 시드.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/hotfix-ui-6";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 580 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ── ② 생성 모달 피커 — 1280×580 ─────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "New map" }).click();
await page.waitForSelector("text=Required approvers");

// 협업자 피커: 후보가 400+명이라 목록이 실제로 160px를 채운다 → 클리핑 여부를 진짜로 검증한다.
const PICKER = 'input[placeholder^="Search by name"]'; // 홈 검색창("Search maps")과 구분
const collabInput = page.locator(PICKER).first();
await collabInput.click();
await page.waitForSelector('[data-id="principal-picker-dropdown"]');
await page.waitForTimeout(200);
const collabDd = page.locator('[data-id="principal-picker-dropdown"]');
const collabBox = await collabDd.boundingBox();
const vh0 = await page.evaluate(() => window.innerHeight);
check(
  "협업자 드롭다운(긴 목록)이 잘리지 않음",
  collabBox !== null && collabBox.height > 100 && collabBox.y >= 0 && collabBox.y + collabBox.height <= vh0,
  collabBox ? `y=${Math.round(collabBox.y)} h=${Math.round(collabBox.height)} vh=${vh0}` : "no box",
);
await page.screenshot({ path: `${SHOTS}/02a-collab-picker-1280x580.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

// 결재자 피커 = 두 번째 PrincipalPicker(협업자 다음).
// 사용자가 실제로 겪는 순서를 재현: 피커까지 스크롤 → 정착 → 클릭 → 본문이 움직였는지.
// (Playwright의 click은 대상을 먼저 스크롤하므로, 클릭 전에 스크롤을 끝내 둬야 밀림만 측정된다.)
const bodySel = ".scrollbar-hidden";
const approverInput = page.locator(PICKER).last();
await approverInput.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const scrollBefore = await page.locator(bodySel).evaluate((el) => el.scrollTop);
await approverInput.click();
await page.waitForSelector('[data-id="principal-picker-dropdown"]');
await page.waitForTimeout(300);
const scrollAfter = await page.locator(bodySel).evaluate((el) => el.scrollTop);
check("모달 본문이 밀리지 않음 (scrollTop 불변)", scrollBefore === scrollAfter, `${scrollBefore} → ${scrollAfter}`);

const dd = page.locator('[data-id="principal-picker-dropdown"]');
const side = await dd.getAttribute("data-side");
check("결재자 드롭다운이 아래로 열림 (1280×580)", side === "below", `data-side=${side}`);

// 후보가 1명뿐이라 실제 상자는 낮다 — 아래로 5줄(160px)이 확보됐는지는 maxHeight로 본다.
const maxH = await dd.evaluate((el) => getComputedStyle(el).maxHeight);
check("결재자 드롭다운에 5줄(160px)이 온전히 배정됨", maxH === "160px", `max-height=${maxH}`);

const box = await dd.boundingBox();
const vh = await page.evaluate(() => window.innerHeight);
check(
  "드롭다운이 뷰포트 안에 온전히 들어감",
  box !== null && box.y >= 0 && box.y + 160 <= vh,
  box ? `y=${Math.round(box.y)} +160 vs vh=${vh}` : "no box",
);
// portal 확인 — 모달 서브트리 밖(body 직계)에 붙어야 클리핑을 벗어난다
const portaled = await dd.evaluate((el) => el.parentElement === document.body);
check("드롭다운이 body로 portal 됨", portaled);
await page.screenshot({ path: `${SHOTS}/02-approver-picker-1280x580.png` });

// 아주 낮은 뷰포트 — 아래 공간이 없으면 옆으로 열려야 한다(위로 flip 금지)
await page.setViewportSize({ width: 1280, height: 420 });
await page.waitForTimeout(250);
const sideNarrow = await dd.getAttribute("data-side");
const boxNarrow = await dd.boundingBox();
const anchorBox = await approverInput.boundingBox();
check(
  "아래 공간 부족 시 옆으로 (위로 flip 안 함)",
  sideNarrow === "right" || sideNarrow === "left",
  `data-side=${sideNarrow}`,
);
check(
  "옆으로 열려도 뷰포트 안",
  boxNarrow !== null && boxNarrow.y >= 0 && boxNarrow.y + boxNarrow.height <= 420,
  boxNarrow ? `y=${Math.round(boxNarrow.y)} h=${Math.round(boxNarrow.height)}` : "no box",
);
check(
  "옆 드롭다운이 앵커를 가리지 않음",
  boxNarrow !== null && anchorBox !== null && boxNarrow.x >= anchorBox.x + anchorBox.width - 1,
  boxNarrow && anchorBox ? `dd.x=${Math.round(boxNarrow.x)} anchor.right=${Math.round(anchorBox.x + anchorBox.width)}` : "",
);
await page.screenshot({ path: `${SHOTS}/02b-approver-picker-side-1280x420.png` });
await page.keyboard.press("Escape");

// ── ③ 980px 분기점 — 홈·공지·인박스 ─────────────────────────────────
const asideVisible = async (dataId) =>
  page.locator(`[data-id="${dataId}"]`).evaluate((el) => getComputedStyle(el).display !== "none");

for (const [w, expectAside] of [[940, false], [1100, true]]) {
  await page.setViewportSize({ width: w, height: 900 });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // 카드 패딩을 클릭 = 선택. 중앙은 이름 Link라 에디터로 이동해 버린다
  await page.locator('[data-id="map-card"]').first().click({ position: { x: 6, y: 6 } });
  await page.waitForTimeout(400);
  check(`홈 ${w}px — 우측 상세 ${expectAside ? "표시" : "숨김"}`, (await asideVisible("map-detail-aside")) === expectAside);
  await page.screenshot({ path: `${SHOTS}/03-home-${w}.png` });

  await page.goto(`${BASE}/notices`, { waitUntil: "networkidle" });
  await page.locator("ul li button").first().click();
  await page.waitForTimeout(400);
  check(`공지 ${w}px — 우측 상세 ${expectAside ? "표시" : "숨김"}`, (await asideVisible("notice-detail-aside")) === expectAside);
  await page.screenshot({ path: `${SHOTS}/03-notices-${w}.png` });

  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  await page.locator("ul li button").first().click();
  await page.waitForTimeout(400);
  check(`인박스 ${w}px — 우측 상세 ${expectAside ? "표시" : "숨김"}`, (await asideVisible("inbox-detail-aside")) === expectAside);
  await page.screenshot({ path: `${SHOTS}/03-inbox-${w}.png` });
}

// 940px에서 아코디언이 실제로 펼쳐졌는지 (grid-rows 1fr)
await page.setViewportSize({ width: 940, height: 900 });
await page.goto(`${BASE}/notices`, { waitUntil: "networkidle" });
await page.locator("ul li button").first().click();
await page.waitForTimeout(500);
const accordionOpen = await page
  .locator('[data-id="notice-detail-accordion"]')
  .first()
  .evaluate((el) => el.getBoundingClientRect().height > 40);
check("공지 940px — 카드 아래 아코디언 펼침", accordionOpen);
await page.screenshot({ path: `${SHOTS}/03b-notices-940-accordion.png`, fullPage: false });

// ── ① 맵 설정 좌측 레일 버튼 ────────────────────────────────────────
await page.setViewportSize({ width: 1280, height: 800 });
const firstMapId = await page.evaluate(async () => {
  const res = await fetch("/api/maps");
  const maps = await res.json();
  return maps[0].id;
});
await page.goto(`${BASE}/maps/${firstMapId}/settings`, { waitUntil: "networkidle" });
const backBtn = page.locator('[data-id="settings-back-to-editor"]');
await backBtn.waitFor();
// 레일 = 버튼의 부모(설정 페이지 좌측 aside). 페이지에 aside가 여럿이라 위치로 고르지 않는다.
const { btnWidth, railWidth, hasBorder } = await backBtn.evaluate((el) => {
  const rail = el.parentElement;
  return {
    btnWidth: el.getBoundingClientRect().width,
    railWidth: rail.getBoundingClientRect().width,
    hasBorder: getComputedStyle(el).borderTopWidth !== "0px",
  };
});
check(
  "Back to editor 버튼이 레일 폭을 채우지 않음 (self-start)",
  btnWidth < railWidth - 30,
  `btn=${Math.round(btnWidth)} rail=${Math.round(railWidth)}`,
);
check("Back to editor 버튼에 테두리", hasBorder);
check("Back to editor 버튼에 ArrowLeft 아이콘", (await backBtn.locator("svg").count()) === 1);
await backBtn.evaluate((el) => el.parentElement.setAttribute("data-pw-rail", "1"));
await page.locator("[data-pw-rail]").screenshot({ path: `${SHOTS}/01-settings-rail.png` });

// ── 결과 ────────────────────────────────────────────────────────────
console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
