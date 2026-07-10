// SearchSelect 드롭다운 클리핑 회귀 검증 — 인스펙터(overflow-y-auto)·노드 편집 모달(overflow-hidden).
// 실행: frontend/ 에서 node scripts/pw-verify-search-select-portal.mjs
// 전제: backend :8000 + frontend :3000, dev.db 종합 시드.
//   맵 1의 draft v6 점유권 보유자는 시드상 sion.seo3 — 그 유저로 열어야 피커가 편집 가능 상태로 뜬다.
//   (admin.sys로 /maps/1을 열면 게시본 v5가 읽기전용으로 열려 SearchSelect 자체가 없다.)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HEIGHTS = [800, 620, 540, 480];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 메뉴가 실제로 온전히 보이는가 — 네 귀퉁이 안쪽 점에서 elementFromPoint가 메뉴 내부를 가리켜야 한다.
// bounding box만 보면 조상의 overflow 클리핑을 못 잡는다.
const probeMenu = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector('[data-id="search-select-menu"]');
    if (!menu) return { found: false };
    const b = menu.getBoundingClientRect();
    const corners = {
      topLeft: [b.left + 4, b.top + 4],
      topRight: [b.right - 4, b.top + 4],
      bottomLeft: [b.left + 4, b.bottom - 4],
      bottomRight: [b.right - 4, b.bottom - 4],
    };
    const hidden = Object.entries(corners)
      .filter(([, [x, y]]) => {
        const el = document.elementFromPoint(x, y);
        return !el || !menu.contains(el);
      })
      .map(([name]) => name);
    return {
      found: true,
      hidden,
      inViewport: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
      portaled: menu.parentElement === document.body,
    };
  });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

for (const height of HEIGHTS) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height } });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "sion.seo3");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto(`${BASE}/maps/1?version=6`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node");
  await page.waitForTimeout(1200);

  const nodes = page.locator(".react-flow__node");
  let bpmNode = -1;
  for (let i = 0; i < (await nodes.count()); i++) {
    await nodes.nth(i).click({ force: true });
    await page.waitForTimeout(300);
    if (await page.locator('[data-id="search-select-trigger"]').count()) {
      bpmNode = i;
      break;
    }
  }
  if (bpmNode < 0) {
    check(`${height}px — BPM 속성 피커 노출`, false, "편집 가능한 process 노드 없음");
    await ctx.close();
    continue;
  }

  // 인스펙터 패널의 부서 드롭다운
  await page.locator('[data-id="search-select-trigger"]').first().click();
  await page.waitForTimeout(350);
  const insp = await probeMenu(page);
  check(
    `인스펙터 ${height}px — 드롭다운 안 잘림`,
    insp.found && insp.hidden.length === 0 && insp.inViewport && insp.portaled,
    JSON.stringify(insp),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  // 노드 편집 모달 — 제목 더블클릭은 이름 편집이라 카드 하단을 노린다
  const nb = await nodes.nth(bpmNode).boundingBox();
  await page.mouse.dblclick(nb.x + nb.width / 2, nb.y + nb.height - 6);
  await page.waitForTimeout(700);
  const modal = page.locator('div.w-\\[420px\\]').first();
  await modal.waitFor();

  const body = await page.evaluate(() => {
    const el = document.querySelector('[data-id="node-summary-body"]');
    const card = el.parentElement;
    el.scrollTop = el.scrollHeight;
    const nav = el.querySelector(".grid.grid-cols-2");
    const nr = nav.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      canScroll: el.scrollHeight > el.clientHeight,
      scrollbarHidden: getComputedStyle(el).scrollbarWidth === "none",
      navReachable: nr.top >= cr.top - 1 && nr.bottom <= cr.bottom + 1,
    };
  });
  check(`모달 ${height}px — 본문 스크롤 살아있음`, body.canScroll, JSON.stringify(body));
  check(`모달 ${height}px — 스크롤바 숨김`, body.scrollbarHidden);
  check(`모달 ${height}px — 끝까지 내리면 선행/후행 내비가 카드 안`, body.navReachable);

  await modal.locator('[data-id="search-select-trigger"]').first().click();
  await page.waitForTimeout(350);
  const mod = await probeMenu(page);
  check(
    `모달 ${height}px — 드롭다운 안 잘림`,
    mod.found && mod.hidden.length === 0 && mod.inViewport && mod.portaled,
    JSON.stringify(mod),
  );
  await ctx.close();
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
