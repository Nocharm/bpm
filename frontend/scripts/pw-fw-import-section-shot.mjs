// 인터뷰 임포트 섹션 캡처 — 그리드 아래 전폭 아코디언을 열고 샘플 JSON을 dry run해 리포트가 폭을 다 쓰는지 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-fw-import-section-shot.mjs
// 전제: backend + frontend 기동(가짜 AI 불필요). 샘플: docs/samples/consultant-interview-sample/utility-l5.json(멱등).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.resolve(here, "../../docs/samples/consultant-interview-sample/utility-l5.json");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="admin-section-import"]').waitFor();
if ((await page.locator('[data-id="admin-section-import"]').getAttribute("data-open")) !== "true") await page.locator('[data-id="admin-section-toggle-import"]').click();
await page.locator('[data-id="interview-import-files"]').setInputFiles(sample);
await page.locator('[data-id="interview-import-dryrun"]').waitFor();
await page.locator('[data-id="interview-import-dryrun"]').click();
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 30000 });
await page.locator('[data-id="admin-section-import"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: "../docs/qa/screens/framework-import-section.png" });
console.log("PASS import section report screenshot");
await browser.close();
