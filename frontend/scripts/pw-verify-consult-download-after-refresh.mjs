// AI 컨설턴트 등록 단계 — 등록이 끝난 세션을 새로고침해 열어도 JSON 다운로드가 켜지고 KST 시각 이름으로 받아지는지 확인한다.
// 실행(frontend/ 에서): SESSION_ID=<applied 세션 id> BASE_URL=http://localhost:3063 node scripts/pw-verify-consult-download-after-refresh.mjs
// 전제: 그 세션이 applied 상태(조립 문서 있음), dev 유저 admin.sys(sysadmin). 캡처는 ../.shots/consult-download-after-refresh.png
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SESSION_ID = process.env.SESSION_ID;
const SHOTS = "../.shots";
if (!SESSION_ID) throw new Error("SESSION_ID is required");
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "ko");
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/framework/consult/${SESSION_ID}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  const done = page.locator('[data-id="fw-consult-done"]');
  await done.waitFor({ timeout: 60000 });
  const button = done.locator('[data-id="fw-consult-download"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-id="fw-consult-done"] [data-id="fw-consult-download"]');
    return el instanceof HTMLButtonElement && !el.disabled;
  }, undefined, { timeout: 15000 }).catch(() => undefined);
  check("download is enabled after a refresh of an applied session", await button.isEnabled());
  await page.screenshot({ path: `${SHOTS}/consult-download-after-refresh.png` });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), button.click()]);
  const name = download.suggestedFilename();
  check("file name carries category code, label, ai-consult and a KST stamp", /_ai-consult_\d{8}-\d{4}\.json$/.test(name), name);
  await ctx.close();
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
