// 운영 대시보드 "새벽 조감도" 리디자인 스크린샷 — 하늘 프레임·KPI 밴드·다크 사이드바·스포트라이트·스크롤.
// 실행: node scripts/pw-shot-dashboard-sky.mjs  (서버 8000/3000 기동 전제, admin.sys)
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOT_DIR ?? "/tmp/dashboard-sky-shots";
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

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
};

await page.goto("http://localhost:3000/settings", { waitUntil: "domcontentloaded" });
// 설정 레일에서 Dashboard 탭 진입 (en "Dashboard" / ko "대시보드" 병행 매치)
const tabBtn = page.locator('button:has-text("Dashboard"), button:has-text("대시보드")').first();
await tabBtn.waitFor({ timeout: 30000 });
await tabBtn.click();
await page.waitForSelector('[data-id="dashboard-sky-frame"]', { timeout: 30000 });
await page.waitForSelector('[data-id="dashboard-kpi-band"]', { timeout: 15000 });
await page.waitForTimeout(2500); // summary/timeseries/sidebar 로드 안정화

// 1) 전체 — 하늘 프레임 + KPI 밴드 + 유리 카드 + 다크 사이드바
await shot("1-dashboard-full");

// 2) 스크롤 하단 — 하늘은 프레임 고정, 내용만 흐르는지
await page.evaluate(() => {
  const scroller = document.querySelector('[data-id="dashboard-sky-frame"] main > div');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(600);
await shot("2-dashboard-scrolled-bottom");

// 3) 사이드바 Coverage 탭 + 기간 필터 직접 지정(라이트 폼 필드 확인)
await page.evaluate(() => {
  const scroller = document.querySelector('[data-id="dashboard-sky-frame"] main > div');
  if (scroller) scroller.scrollTop = 0;
});
await page.click('[data-id="dashboard-sidebar-tab-coverage"]');
await page.waitForTimeout(400);
// 기간 필터 "직접 지정" 열기 — 날짜 입력(라이트 필드) 렌더 확인
const customBtn = page
  .locator('[data-id="dashboard-period-filter"] button')
  .filter({ hasText: /직접 지정|Custom/ })
  .first();
await customBtn.click();
await page.waitForTimeout(400);
await shot("3-dashboard-coverage-and-custom-period");

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
