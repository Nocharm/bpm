// 매뉴얼 뷰어 "한눈에 보기" 메뉴의 슬라이드 PDF 다운로드 스모크 — 메뉴가 env 없이도 뜨고, 사용자/관리자 항목이 언어 선택
// 다이얼로그를 열며, 한국어·English 링크가 /manuals/ 정적 파일(200, application/pdf)을 가리키는지 확인한다.
// 캡처는 ../.shots/manual-pdf-menu.png · manual-pdf-dialog.png. 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-manual-pdf.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? path.resolve("../.shots");
const ADMIN = "admin.sys";
const UI_LANG = process.env.PW_LANG ?? "ko";

fs.mkdirSync(SHOT_DIR, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ({ user, lang }) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", lang);
    },
    { user: ADMIN, lang: UI_LANG },
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/manual`, { waitUntil: "networkidle" });

  const menuBtn = page.locator('[data-id="manual-external-menu"]');
  await menuBtn.waitFor({ state: "visible", timeout: 15000 });
  check("menu button visible without env urls", true);
  await menuBtn.click();
  await page.locator('[data-id="manual-pdf-user"]').waitFor({ state: "visible", timeout: 5000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "manual-pdf-menu.png") });

  for (const kind of ["user", "admin"]) {
    if (kind === "admin") await menuBtn.click();
    await page.locator(`[data-id="manual-pdf-${kind}"]`).click();
    const dialog = page.locator('[data-id="manual-pdf-dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    check(`${kind}: language dialog opens`, true);
    for (const lang of ["ko", "en"]) {
      const link = dialog.locator(`[data-id="manual-pdf-lang-${lang}"]`);
      const href = await link.getAttribute("href");
      const expected = `/manuals/bpm-manual-${kind}-${lang}.pdf`;
      check(`${kind}/${lang}: link href`, href === expected, href ?? "(none)");
      check(`${kind}/${lang}: download attr`, (await link.getAttribute("download")) !== null);
      const res = await page.request.get(`${BASE}${expected}`);
      const type = res.headers()["content-type"] ?? "";
      check(`${kind}/${lang}: pdf served`, res.ok() && type.includes("application/pdf"), `${res.status()} ${type}`);
    }
    if (kind === "user") await page.screenshot({ path: path.join(SHOT_DIR, "manual-pdf-dialog.png") });
    // 언어 클릭 = 다운로드 시작 + 닫힘
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      dialog.locator('[data-id="manual-pdf-lang-ko"]').click(),
    ]);
    check(`${kind}: download starts`, download.suggestedFilename() === `bpm-manual-${kind}-ko.pdf`, download.suggestedFilename());
    await dialog.waitFor({ state: "hidden", timeout: 5000 });
    check(`${kind}: dialog closes after pick`, true);
  }
  await ctx.close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
