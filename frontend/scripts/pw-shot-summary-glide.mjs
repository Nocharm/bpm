// 노드 편집 모달 선후행 전환 글라이드 검증 — 오른쪽 독(후행) 클릭 후 카드 높이를 프레임마다 샘플링해
// 직전 높이 → 새 내용 높이로 점진 변화하는지, 창이 끝난 뒤 섹션 접기가 즉시 반영되는지 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=40 NODE_TITLE="요청 확인" [VERSION_ID=121] node scripts/pw-shot-summary-glide.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "40";
const NODE_TITLE = process.env.NODE_TITLE ?? "요청 확인";
const USER = process.env.USER_ID ?? "admin.sys";
// 편집 모드 확인용 Draft 버전 id(비우면 기본 버전 — 게시본이면 읽기 전용 모달)
const VERSION_ID = process.env.VERSION_ID ?? "";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER);
  const page = await ctx.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${BASE}/maps/${MAP_ID}${VERSION_ID ? `?version=${VERSION_ID}` : ""}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator(".react-flow").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);

  const node = page.locator(".react-flow__node").filter({ hasText: NODE_TITLE }).first();
  const box = await node.boundingBox();
  // 제목 더블클릭은 이름 편집이라 우하단 여백을 더블클릭
  await page.mouse.dblclick(box.x + box.width - 8, box.y + box.height - 5);
  const card = page.locator('[data-id="node-summary-card"]');
  await card.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, `summary-glide${VERSION_ID ? "-edit" : ""}-1-before.png`) });

  const next = page.locator('[data-id="summary-dock-next"] button').first();
  if ((await next.count()) === 0) throw new Error("후행 독 카드가 없다 — 다른 NODE_TITLE을 지정");
  // rAF마다 카드 크기·불투명도·고스트·이어받기 카드를 기록 — 고스트는 불투명한 채로 이동하며 커져야 하고,
  // 새 카드는 도착 크기에서 내용 높이로 점진 변화하며, 펼침 창이 끝난 뒤 다시 팝인(깜빡임)하면 안 된다
  await page.evaluate(() => {
    window.__frames = [];
    const start = performance.now();
    const tick = () => {
      const card = document.querySelector('[data-id="node-summary-card"]');
      const ghost = document.querySelector('[data-id="summary-swap-ghost"]');
      const handoff = document.querySelector('[data-id="summary-swap-handoff"]');
      window.__frames.push({
        t: Math.round(performance.now() - start),
        w: card?.offsetWidth,
        h: card?.offsetHeight,
        glide: card?.className.includes("summary-card-glide") ?? false,
        ghostW: ghost ? Math.round(ghost.getBoundingClientRect().width) : null,
        cardOpacity: card ? Number(getComputedStyle(card).opacity) : null,
        cardAnim: card ? getComputedStyle(card).animationName : null,
        ghostOpacity: ghost ? Number(getComputedStyle(ghost).opacity) : null,
        handoffOpacity: handoff ? Number(getComputedStyle(handoff).opacity).toFixed(2) : null,
      });
      if (performance.now() - start < 1600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await next.click();
  for (const [ms, name] of [[200, "2-travel"], [520, "3-expanding"], [1300, "4-after"]]) {
    await page.waitForTimeout(ms - (name === "2-travel" ? 0 : name === "3-expanding" ? 200 : 520));
    await page.screenshot({ path: path.join(SHOT_DIR, `summary-glide${VERSION_ID ? "-edit" : ""}-${name}.png`) });
  }
  await page.waitForTimeout(400);
  const frames = await page.evaluate(() => window.__frames);
  const travel = frames.filter((f) => f.ghostW !== null);
  const ghostWidths = [...new Set(travel.map((f) => f.ghostW))];
  console.log(
    `ghost travel: widths ${ghostWidths.slice(0, 3).join(" → ")} … ${ghostWidths.slice(-2).join(" → ")} (${ghostWidths.length} steps), opacity ${[...new Set(travel.map((f) => f.ghostOpacity))].join(",")}`,
  );
  // 펼침이 끝난 뒤(글라이드 클래스가 빠진 뒤) 카드 불투명도가 1 아래로 떨어지거나 팝인이 다시 걸리면 깜빡임
  const lastGlide = frames.findLastIndex((f) => f.glide);
  const afterGlide = frames.slice(lastGlide + 1);
  const dips = afterGlide.filter((f) => f.cardOpacity !== null && (f.cardOpacity < 0.999 || f.cardAnim === "summary-card-in"));
  console.log(`after-glide frames ${afterGlide.length}, flicker frames ${dips.length}`);
  const gliding = frames.filter((f) => f.glide);
  const sizes = [...new Set(gliding.map((f) => `${f.w}x${f.h}`))];
  console.log(`expand frames ${gliding.length}: ${sizes.slice(0, 4).join(" → ")} … ${sizes.slice(-3).join(" → ")}`);
  console.log(`handoff opacity: ${[...new Set(frames.map((f) => f.handoffOpacity).filter((v) => v !== null))].slice(0, 8).join(" → ")}`);
  const last = frames.at(-1);
  console.log(`after window: glide class ${last.glide}, size ${last.w}x${last.h}`);

  // 창이 끝난 뒤 섹션 접기 = 즉시(글라이드 없음)
  const toggle = page.locator('[data-id="summary-toggle-all-sections"]');
  if ((await toggle.count()) > 0) {
    const before = await card.evaluate((el) => el.offsetHeight);
    await toggle.click();
    const right = await card.evaluate((el) => el.offsetHeight);
    console.log(`toggle all sections: ${before} → ${right} (same frame), glide class ${await card.evaluate((el) => el.className.includes("summary-card-glide"))}`);
  }
  console.log(`errors: ${JSON.stringify(errors)}`);
  await ctx.close();
} finally {
  await browser.close();
}
