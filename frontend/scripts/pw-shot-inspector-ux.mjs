// 인스펙터 UX 3종 스크린샷 — ① 맵 요약 아코디언(접힘=아이콘+숫자) ② 소유·승인자 섹션 ③ SP 카드 Linked from.
// 실행: node scripts/pw-shot-inspector-ux.mjs  (서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOT_DIR ?? "/tmp/inspector-ux-shots";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

// 인스펙터(우측 패널)만 잘라 찍기
const shotPanel = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 1600 - 460, y: 0, width: 460, height: 1000 } });
  console.log("shot:", name);
};

// ── 맵 3 (Incident Response) — 오우닝 부서·오너·승인자 + 요약 아코디언 + SP 지정(링크 0)
await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForSelector('[data-id="inspector-summary-toggle"]', { timeout: 15000 });
await page.waitForTimeout(2500); // 디렉터리/워크플로 로드 안정화(UserPill 스켈레톤 해소)
await shotPanel("1-map3-summary-collapsed-ownership");

// 요약 펼침
await page.click('[data-id="inspector-summary-toggle"]');
await page.waitForTimeout(400);
await shotPanel("2-map3-summary-expanded");

// SP 카드 열기(이미 열려 있으면 유지 — sessionStorage 공유) → Linked from(0) 열기
const ensureSpOpen = async () => {
  const toggle = page.locator('[data-id="sp-inspector-toggle"]').first();
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await page.waitForTimeout(400);
  }
};
await ensureSpOpen();
const linkedToggle = page.locator('[data-id="sp-linked-from-toggle"]');
const hasLinked3 = await linkedToggle.count();
console.log("map3 linked-from toggle count:", hasLinked3);
if (hasLinked3 > 0) {
  await linkedToggle.first().scrollIntoViewIfNeeded();
  await linkedToggle.first().click();
  await page.waitForTimeout(400);
  await linkedToggle.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
}
await shotPanel("3-map3-sp-card-linkedfrom-empty");

// ── 맵 1 (Order Fulfillment) — 역참조 1건(Employee Onboarding)
await page.goto("http://localhost:3000/maps/1", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-id="inspector-summary-toggle"]', { timeout: 30000 });
await page.waitForTimeout(2500);
await ensureSpOpen();
const linkedToggle1 = page.locator('[data-id="sp-linked-from-toggle"]');
const hasLinked1 = await linkedToggle1.count();
console.log("map1 linked-from toggle count:", hasLinked1);
if (hasLinked1 > 0) {
  const countText = await linkedToggle1.first().innerText();
  console.log("map1 linked-from header text:", countText.replace(/\n/g, " | "));
  await linkedToggle1.first().scrollIntoViewIfNeeded();
  await linkedToggle1.first().click();
  await page.waitForTimeout(400);
  await linkedToggle1.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const rows = await page.locator('[data-id="sp-card-linked-row"]').count();
  console.log("map1 linked rows:", rows);
}
await shotPanel("4-map1-sp-card-linkedfrom");

// ── 맵 탭에서도 SP 카드 확인 (모든 탭 일괄 적용 검증)
await page.click('button[aria-label="Map"], button[aria-label="맵"]');
await page.waitForTimeout(800);
const spToggleMapTab = page.locator('[data-id="sp-inspector-toggle"]');
if ((await spToggleMapTab.count()) > 0) {
  await ensureSpOpen();
  const lt = page.locator('[data-id="sp-linked-from-toggle"]');
  if ((await lt.count()) > 0) {
    await lt.first().scrollIntoViewIfNeeded();
    await lt.first().click();
    await page.waitForTimeout(400);
    await lt.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  }
}
await shotPanel("5-map1-maptab-sp-card-linkedfrom");

console.log("console errors:", errors.length, errors.slice(0, 5));
await browser.close();
