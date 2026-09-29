// 슬라이드 덱 넘침 검사(임시) — 덱을 file://로 열고 슬라이드마다 show(i) 뒤 .col-text의 scrollHeight-clientHeight>8이면 보고.
// 실행(frontend/ 에서): node scripts/check-deck-overflow.mjs ../docs/manual/slides/bpm-manual-*.html
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 770 } });
for (const file of process.argv.slice(2)) {
  await page.goto("file://" + path.resolve(file), { waitUntil: "load" });
  const n = await page.locator(".slide").count();
  const bad = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((k) => window.show(k, false), i);
    await page.waitForTimeout(60);
    const r = await page.evaluate((k) => {
      const s = document.querySelectorAll(".slide")[k];
      const col = s.querySelector(".col-text");
      const title = s.querySelector(".title");
      return {
        over: col ? col.scrollHeight - col.clientHeight : 0,
        title: title ? title.scrollWidth - title.clientWidth : 0,
        text: title ? title.textContent.slice(0, 40) : "",
      };
    }, i);
    if (r.over > 8 || r.title > 0) bad.push(`#${i} over=${r.over} title=${r.title} ${r.text}`);
  }
  console.log(`${path.basename(file)}: ${n} slides, ${bad.length} overflow`);
  for (const b of bad) console.log("  " + b);
}
await browser.close();
