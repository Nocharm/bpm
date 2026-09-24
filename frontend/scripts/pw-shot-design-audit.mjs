// 디자인 통일성 수정(2026-09-24) 시각 확인 — 공용 CheckInput 전환 3표면 + 액센트 버튼 굵기. 서버 3047/8048 전제.
// 실행: BASE_URL=http://localhost:3047 node scripts/pw-shot-design-audit.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const OUT = process.env.SHOT_DIR ?? "/tmp/design-audit-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 837 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "ko");
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const clickText = async (candidates) => {
  for (const text of candidates) {
    const loc = page.getByRole("button", { name: text }).first();
    if (await loc.count()) {
      await loc.click();
      return text;
    }
  }
  throw new Error(`none of ${candidates.join("|")} found`);
};

// ① 설정 > 공지 > 새 공지 모달(기간 무제한 · 전체 알림 체크박스)
await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await clickText([/공지/, /Notices/]);
await page.waitForTimeout(800);
await clickText([/새 공지/, /공지 작성/, /New notice/, /Add/]);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/1-notice-modal-checkinput.png` });
console.log("shot: notice modal");
await page.keyboard.press("Escape");

// ② 설정 > 임직원 > 노출 직책 카드(체크박스 목록)
await clickText([/직원 관리/, /Employees/]);
await page.waitForTimeout(1500);
const card = page.locator('[data-id="exposed-positions-card"]');
if (await card.count()) {
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/2-employee-positions-checkinput.png` });
  console.log("shot: employee positions card");
}

// ③ 비교 화면 우측 패널 — Σ 표시 항목 토글 목록
await page.goto(`${BASE}/maps/1/compare`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const sumBtn = page.locator('[data-id="compare-sum-visibility"]');
if (await sumBtn.count()) {
  await sumBtn.click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT}/3-compare-sum-toggles.png` });
console.log("shot: compare");

// ④ 에디터 인스펙터 액센트 버튼(굵기 600)
await page.goto(`${BASE}/maps/1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/4-editor-inspector.png` });
console.log("shot: editor");

console.log("page errors:", errors.length ? errors : "none");
await browser.close();
