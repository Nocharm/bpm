// 인스펙터 승인 탭 결재 대기 섹션을 인스펙터 폭(300/360/520)·언어별로 캡처 — 폭 대응 현황 파악용.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 MAP_ID=1 USER=sion.seo3 node scripts/pw-shot-pending-approvals-width.mjs
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "../.shots";
const MAP_ID = process.env.MAP_ID ?? "1";
const USER = process.env.USER_ID ?? "sion.seo3";
const WIDTHS = [300, 360, 520];
const APPROVAL_TAB = { en: "Approval", ko: "승인" };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const lang of ["ko", "en"]) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await ctx.addInitScript(([user, l, w]) => {
        window.localStorage.setItem("bpm.devUser", user);
        window.localStorage.setItem("bpm.lang", l);
        window.localStorage.setItem("bpm.inspectorWidth", String(w));
      }, [USER, lang, width]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle", timeout: 120000 });
      await page.getByRole("button", { name: APPROVAL_TAB[lang], exact: true }).first().click();
      const section = page.locator('[data-id="editor-approvals-section"]');
      await section.waitFor({ timeout: 20000 });
      await section.locator("button[data-acc-toggle]").click();
      await page.waitForTimeout(600);
      await section.screenshot({ path: path.join(SHOT_DIR, `pending-approvals-${lang}-${width}.png`) });
      console.log(`shot ${lang} ${width}`);
      await ctx.close();
    }
    // 같은 패널을 쓰는 맵 설정 > 결재 대기 탭(넓은 폭)
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(([user, l]) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", l);
    }, [USER, lang]);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/maps/${MAP_ID}/settings`, { waitUntil: "networkidle", timeout: 120000 });
    await page.locator('[data-id="settings-nav-approvals"]').click();
    await page.locator('[data-id^="pending-approval-"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT_DIR, `pending-approvals-${lang}-settings.png`) });
    console.log(`shot ${lang} settings`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
