// 인스펙터 3종 검증 (2026-09-01)
//  [1] L5 맵에서는 서브프로세스 지정 카드가 모든 탭(속성·맵·승인)에서 숨겨진다 / 일반 맵은 그대로 노출
//  [2] 노드 표시 정보 헤더의 전체 보이기·숨기기 — 접힘/펼침 양쪽에서 동작
//  [3] 화면 가장자리 팝오버(오너·승인자 필 카드, SP 안내 툴팁)가 뷰포트 안으로 보정된다
// 전제: 데모 시드(맵 2 = 일반, 맵 17 = framework L5). 서버 8000/3000.
// 실행: (frontend/) node scripts/pw-verify-inspector-round.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";

const failures = [];
const check = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();

const openTab = async (re) => {
  await page.getByRole("button", { name: re }).first().click();
  await sleep(700);
};
const spCards = () => page.locator('[data-id="sp-inspector-card"]').count();
const displayFields = () =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem("bpm.nodeDisplayFields.v2") ?? "[]"));
// 뷰포트 밖으로 나갔는지 — 4px 여유(경계 반올림)
let viewport = { width: 1680, height: 1000 };
const clampProven = { card: false, tip: false };
const outOfView = (box, vp = viewport) =>
  box === null ||
  box.x < -4 ||
  box.y < -4 ||
  box.x + box.width > vp.width + 4 ||
  box.y + box.height > vp.height + 4;

const openMap = async (mapId, version) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${version}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await sleep(1400);
};

// ── [1] SP 카드 가시성 ──────────────────────────────────────────────────────
for (const c of [
  { label: "framework-l5", map: 17, version: 77, expect: 0 },
  { label: "normal", map: 2, version: 12, expect: 1 },
]) {
  await openMap(c.map, c.version);
  check(
    (await spCards()) === c.expect,
    `[1][${c.label}] properties tab sp card = ${c.expect} (got ${await spCards()})`,
  );
  await openTab(/^(Map|맵)$/);
  check(
    (await spCards()) === c.expect,
    `[1][${c.label}] map tab sp card = ${c.expect} (got ${await spCards()})`,
  );
  await openTab(/^(Approval|승인)$/);
  check(
    (await spCards()) === c.expect,
    `[1][${c.label}] approval tab sp card = ${c.expect} (got ${await spCards()})`,
  );
}

// ── [2] 노드 표시 정보 전체 토글 ────────────────────────────────────────────
await openMap(2, 12);
await openTab(/^(Properties|속성)$/);
const allBtn = page.locator('[data-id="properties-node-display-all"]');
const expandBtn = page.locator('[data-id="properties-node-display-toggle"]');
check((await allBtn.count()) === 1, "[2] all-toggle rendered in the collapsed header");
// 초깃값은 앱 기본값(로컬스토리지 미기록)이라 DOM에서 읽는다 — 첫 클릭 방향이 이 값에 달렸다
await expandBtn.click();
await sleep(400);
const initialOn = await page.locator('[role="switch"][aria-checked="true"]').count();
await expandBtn.click(); // 다시 접기 — 접힘 상태에서 동작하는지 보는 게 요점
await sleep(400);
check(initialOn > 0, `[2] app default has some fields on (${initialOn})`);
await allBtn.click(); // 접힘 상태 1클릭 = 전부 켜짐이면 숨기기
await sleep(400);
check((await displayFields()).length === 0, "[2] collapsed click hides every field");
await allBtn.click(); // 접힘 상태 2클릭 = 모두 보이기
await sleep(400);
const afterOn = await displayFields();
check(afterOn.length === 9, `[2] collapsed click shows every field (${afterOn.length})`);
await expandBtn.click(); // 펼치기
await sleep(400);
await allBtn.click();
await sleep(400);
check((await displayFields()).length === 0, "[2] expanded click hides every field");
check(
  (await page.locator('[role="switch"][aria-checked="true"]').count()) === 0,
  "[2] every row switch reads off",
);
await allBtn.click();
await sleep(400);
check((await displayFields()).length === 9, "[2] expanded click shows every field");
await page.screenshot({ path: `${SHOT_DIR}/inspector-display-all.png` });

// ── [3] 가장자리 팝오버 보정 ────────────────────────────────────────────────
// 보정이 "실제로 개입했는지"까지 본다 — 보정 없는 원래 자리(앵커 기준 배치)를 계산해
// 뷰포트를 벗어났는지 판정하고, 그 경우에도 최종 박스가 화면 안이면 통과.
const placement = async (anchorBox, popBox, mode) => {
  const un =
    mode === "below-left"
      ? { x: anchorBox.x, y: anchorBox.y + anchorBox.height + 6 }
      : { x: anchorBox.x + anchorBox.width / 2 - popBox.width / 2, y: anchorBox.y - 6 - popBox.height };
  const raw = { ...un, width: popBox.width, height: popBox.height };
  return { raw, wouldOverflow: outOfView(raw) };
};

for (const vp of [
  { width: 1680, height: 1000 },
  { width: 1280, height: 700 },
]) {
  const tag = `${vp.width}x${vp.height}`;
  viewport = vp;
  await page.setViewportSize(vp);
  await sleep(600);

  // 오너/승인자 필 — 인스펙터가 화면 오른쪽 끝이라 보정 없으면 카드가 밖으로 나간다
  await openTab(/^(Properties|속성)$/);
  const ownerPill = page.locator('[data-id="map-ownership-section"] span.cursor-pointer').first();
  check((await ownerPill.count()) > 0, `[3][${tag}] ownership pill present`);
  const pillBox = await ownerPill.boundingBox();
  await ownerPill.click();
  await sleep(400);
  const card = page.locator('[role="tooltip"]').first();
  const cardBox = await card.boundingBox();
  const cardPlace = await placement(pillBox, cardBox, "below-left");
  check(!outOfView(cardBox, vp), `[3][${tag}] user card inside viewport`);
  console.log(
    `     user card: unclamped=${JSON.stringify(cardPlace.raw)} overflow=${cardPlace.wouldOverflow} actual=${JSON.stringify(cardBox)}`,
  );
  if (cardPlace.wouldOverflow) clampProven.card = true;
  await page.screenshot({ path: `${SHOT_DIR}/inspector-usercard-${tag}.png` });

  // SP 안내 툴팁 — 맵 탭 카드 제목 옆 Info 아이콘(앵커 위·중앙 정렬)
  await openTab(/^(Map|맵)$/);
  const info = page.locator('[data-id="sp-inspector-card"] svg.lucide-info').first();
  check((await info.count()) > 0, `[3][${tag}] sp info icon present`);
  await info.hover(); // 앵커 좌표는 hover 뒤에 잰다 — hover가 인스펙터를 스크롤해 앵커가 움직인다
  await sleep(500);
  const infoBox = await info.boundingBox();
  const tip = page.locator('[role="tooltip"]').first();
  const tipBox = await tip.boundingBox();
  const tipPlace = await placement(infoBox, tipBox, "above-center");
  check(!outOfView(tipBox, vp), `[3][${tag}] sp tooltip inside viewport`);
  console.log(
    `     sp tooltip: unclamped=${JSON.stringify(tipPlace.raw)} overflow=${tipPlace.wouldOverflow} actual=${JSON.stringify(tipBox)}`,
  );
  if (tipPlace.wouldOverflow) clampProven.tip = true;
  await page.screenshot({ path: `${SHOT_DIR}/inspector-sp-tooltip-${tag}.png` });
}
check(clampProven.card, "[3] user card actually needed clamping in at least one viewport");
// 툴팁은 기본 시드 배치에선 화면을 안 벗어나 보정 경로를 안 탄다 — 카드를 화면 우상단 끝으로
// 강제 이동시켜 가로(-translate-x-1/2)·세로(-translate-y-full) 변형이 걸린 상태의 보정을 검증한다.
await page.setViewportSize({ width: 1280, height: 700 });
viewport = { width: 1280, height: 700 };
await sleep(500);
await openTab(/^(Map|맵)$/);
await page.evaluate(() => {
  const card = document.querySelector('[data-id="sp-inspector-card"]');
  if (!(card instanceof HTMLElement)) return;
  card.style.position = "fixed";
  card.style.width = "180px"; // 좁혀서 Info 아이콘이 카드 왼쪽 가까이 오게(뷰포트 안이어야 hover 가능)
  card.style.left = `${window.innerWidth - 190}px`;
  card.style.top = "2px";
  card.style.zIndex = "50";
});
await sleep(300);
const edgeInfo = page.locator('[data-id="sp-inspector-card"] svg.lucide-info').first();
await edgeInfo.hover();
await sleep(500);
const edgeAnchor = await edgeInfo.boundingBox();
const edgeTip = page.locator('[role="tooltip"]').first();
const edgeBox = await edgeTip.boundingBox();
const edgePlace = await placement(edgeAnchor, edgeBox, "above-center");
check(edgePlace.wouldOverflow, "[3] forced edge case really would overflow without clamping");
check(!outOfView(edgeBox, viewport), `[3] forced edge tooltip pulled inside (${JSON.stringify(edgeBox)})`);
console.log(`     forced: unclamped=${JSON.stringify(edgePlace.raw)} actual=${JSON.stringify(edgeBox)}`);
await page.screenshot({ path: `${SHOT_DIR}/inspector-tooltip-edge.png` });

console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES (${failures.length}):`}`);
for (const f of failures) console.log(" -", f);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
