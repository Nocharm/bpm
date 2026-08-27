// 소유·승인자 섹션 언어설정 검증 — ko: 한글이름·한글부서 우선(없으면 영문 폴백), en: 영문.
// 실행: node scripts/pw-shot-ownership-lang.mjs  (서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.SHOT_DIR ?? "/tmp/inspector-ux-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const capture = async (lang, name) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((l) => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", l);
  }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-id="map-ownership-section"]', { timeout: 30000 });
  await page.waitForTimeout(2500); // 디렉터리 로드 안정화(스켈레톤 해소)
  const text = await page.locator('[data-id="map-ownership-section"]').innerText();
  console.log(`[${lang}]`, text.replace(/\n/g, " | "));
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 1600 - 460, y: 100, width: 460, height: 420 } });
  console.log("shot:", name, "| console errors:", errors.length);
  await ctx.close();
};

await capture("ko", "6-map3-ownership-ko");
await capture("en", "7-map3-ownership-en");
await browser.close();
