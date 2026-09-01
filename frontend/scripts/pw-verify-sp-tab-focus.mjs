// 펼친 하위프로세스 안에서 Tab/Shift+Tab이 펼침 경계를 건너는지 검증 (일반 맵 + L5 업무체계 맵).
//  [A] 펼친 호스트에서 Tab → 자식 진입점(가려진 A→B 대신 진입 게이트웨이)
//  [B] 자식 진입점에서 Shift+Tab → 호스트
//  [C] 자식 내부 Tab 순회 유지
//  [D] 자식 끝(막다른) 노드에서 Tab → 포커스가 캔버스 밖으로 새지 않음(브라우저 기본 Tab 차단)
// 전제: 데모 시드(맵 2 v12 = 일반, 맵 17 v77 = framework L5). 서버 8000/3000.
// 실행: (frontend/) node scripts/pw-verify-sp-tab-focus.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";

const CASES = [
  { label: "normal", map: 2, version: 12, sp: "Order Fulfillment" },
  { label: "framework-l5", map: 17, version: 77, sp: "교정 준비" },
];

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

const nodeBoxes = () =>
  page.$$eval(".react-flow__node", (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-id"),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        text: (el.textContent ?? "").trim().slice(0, 24),
      };
    }),
  );
const selectedNodeId = () =>
  page.evaluate(
    () => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") ?? null,
  );
// 포커스 이탈 판정용 — 활성 요소의 노드 id(캔버스 노드가 아니면 태그명)
const focusMark = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    const node = el.closest?.(".react-flow__node");
    return node ? `node:${node.getAttribute("data-id")}` : `other:${el.tagName}`;
  });
// Tab 이동이 카메라를 팬시키므로 좌표는 클릭 직전에 다시 잰다(스테일 bbox 클릭 금지).
// 가림 없는 지점을 elementFromPoint로 확인해 노드 본체를 정확히 찍는다.
const clickNodeById = async (id) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = (await nodeBoxes()).find((b) => b.id === id);
    if (!box) {
      await sleep(300);
      continue;
    }
    const spots = [
      [box.x + box.w / 2, box.y + Math.min(12, box.h / 2)],
      [box.x + box.w / 2, box.y + box.h / 2],
      [box.x + box.w * 0.25, box.y + box.h / 2],
    ];
    for (const [x, y] of spots) {
      const hits = await page.evaluate(
        ([px, py, target]) =>
          document.elementFromPoint(px, py)?.closest(".react-flow__node")?.getAttribute("data-id") ===
          target,
        [x, y, id],
      );
      if (hits) {
        await page.mouse.click(x, y);
        await sleep(400);
        return true;
      }
    }
    // 못 찾으면 축소해 시야를 넓힌다(Tab 비행으로 노드가 뷰포트/인스펙터 밖으로 나간 경우)
    await page.mouse.move(760, 480);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 240);
    await page.keyboard.up("Control");
    await sleep(400);
  }
  return false;
};

for (const c of CASES) {
  console.log(`\n=== ${c.label}: map ${c.map} v${c.version} / SP "${c.sp}" ===`);
  await page.goto(`${BASE}/maps/${c.map}?version=${c.version}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await sleep(1200);
  const force = page.getByRole("button", { name: /Force edit|강제 편집/ }).first();
  if (await force.count()) {
    await force.click();
    await sleep(1200);
  }

  const pre = await nodeBoxes();
  await page.locator(`.react-flow__node:has-text("${c.sp}")`).first().click();
  await sleep(400);
  await page.click('[data-id="node-action-expand"]');
  await page.waitForSelector('[data-id^="region-band-"]', { timeout: 15000 });
  await sleep(1600);

  const hostId = (
    await page.locator('[data-id^="region-band-"]').first().getAttribute("data-id")
  ).replace("region-band-", "");
  const band = await page.locator('[data-id^="region-band-"]').first().boundingBox();
  const post = await nodeBoxes();
  const preIds = new Set(pre.map((b) => b.id));
  const kids = post
    .filter(
      (b) =>
        !preIds.has(b.id) &&
        band &&
        b.x + b.w / 2 > band.x &&
        b.x + b.w / 2 < band.x + band.width,
    )
    .sort((a, b) => a.x - b.x);
  check(kids.length >= 3, `[${c.label}] embedded children present (${kids.length})`);
  if (kids.length < 3) continue;
  const entry = kids[0];
  const exit = kids[kids.length - 1];
  const host = post.find((b) => b.id === hostId);

  // [D] 먼저 — 막다른 자식 끝 노드에서 포커스가 캔버스 밖으로 새지 않는다.
  // (A~C의 Tab 비행이 카메라를 옮기기 전에 확인해 좌표 흔들림을 줄인다)
  check(await clickNodeById(exit.id), `[${c.label}][D] child end clicked`);
  const beforeSel = await selectedNodeId();
  const beforeFocus = await focusMark();
  check(beforeSel === exit.id, `[${c.label}][D] child end selected (${beforeSel})`);
  await page.keyboard.press("Tab");
  await sleep(800);
  const afterFocus = await focusMark();
  const afterSel = await selectedNodeId();
  check(
    !afterFocus.startsWith("other:"),
    `[${c.label}][D] focus stays on the canvas (before=${beforeFocus} after=${afterFocus}, selected=${afterSel})`,
  );
  await page.screenshot({ path: `${SHOT_DIR}/tab-focus-${c.label}.png` });

  // [A] 호스트 → 자식 진입점
  check(host !== undefined, `[${c.label}][A] host box found`);
  check(await clickNodeById(hostId), `[${c.label}][A] host clicked`);
  check((await selectedNodeId()) === hostId, `[${c.label}][A] host selected`);
  await page.keyboard.press("Tab");
  await sleep(800);
  const afterHost = await selectedNodeId();
  check(afterHost === entry.id, `[${c.label}][A] Tab enters the child scope (${afterHost})`);
  await page.screenshot({ path: `${SHOT_DIR}/tab-enter-${c.label}.png` });

  // [B] 자식 진입점 → 호스트 (Shift+Tab)
  check(await clickNodeById(entry.id), `[${c.label}][B] child entry clicked`);
  check((await selectedNodeId()) === entry.id, `[${c.label}][B] child entry selected`);
  await page.keyboard.press("Shift+Tab");
  await sleep(800);
  const backId = await selectedNodeId();
  check(backId === hostId, `[${c.label}][B] Shift+Tab returns to the host (${backId})`);

  // [C] 자식 내부 순회
  check(await clickNodeById(entry.id), `[${c.label}][C] child entry re-clicked`);
  await page.keyboard.press("Tab");
  await sleep(800);
  const innerNext = await selectedNodeId();
  const kidIds = new Set(kids.map((k) => k.id));
  check(
    innerNext !== null && innerNext !== entry.id && kidIds.has(innerNext),
    `[${c.label}][C] Tab walks the child chain (${innerNext})`,
  );
}

console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES (${failures.length}):`}`);
for (const f of failures) console.log(" -", f);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
