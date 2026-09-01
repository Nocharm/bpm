// 백업 UI 검증 — Batch jobs 탭: Backup now(온디맨드 sqlite) → 파일 목록 갱신 → 다운로드 실동작.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS ?? "/tmp";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)); });

await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Batch jobs|배치 작업/ }).click();
await page.waitForSelector('[data-id="backup-files"]', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/backup-tab-before.png` });

const beforeCount = await page.locator('[data-id^="backup-file-bpm-"]').count();
await page.locator('[data-id="backup-run-now"]').click();
await page.waitForFunction(
  (prev) => document.querySelectorAll('[data-id^="backup-file-bpm-"]').length > prev,
  beforeCount,
  { timeout: 20000 },
);
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/backup-tab-after.png` });

const rows = await page.locator('[data-id^="backup-file-bpm-"]').count();
const firstName = await page
  .locator('[data-id^="backup-file-bpm-"]')
  .first()
  .getAttribute("data-id");

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.locator('[data-id^="backup-download-bpm-"]').first().click(),
]);
const savedPath = await download.path();
const { statSync } = await import("node:fs");
const size = statSync(savedPath).size;

console.log(JSON.stringify({
  filesBefore: beforeCount,
  filesAfter: rows,
  newest: firstName,
  downloadedBytes: size,
  suggestedName: download.suggestedFilename(),
  consoleErrors: errors,
}, null, 2));
await browser.close();
