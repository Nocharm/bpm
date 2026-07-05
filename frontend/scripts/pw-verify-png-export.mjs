// PNG 내보내기 검증 — 에디터(Ctrl+Shift+E)·비교(Export 버튼) 출력에 엣지(검은 실선)가 실제로
// 그려지는지 검은 픽셀 수로 판정 + 캡처 후 라이브 엣지 스타일 원상복구 확인.
// 실행: node scripts/pw-verify-png-export.mjs  (playwright-core, 서버 8000/3000 기동, 맵 6 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MIN_BLACK_PX = 2000; // 2× 해상도에서 엣지 10개면 수만 픽셀 — 보수적 하한

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.kim");
  window.localStorage.setItem("bpm.lang", "en");
  window.__png = null;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__png = this.href; return; }
    return orig.call(this);
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// dataURL PNG의 검은 픽셀 수 — 엣지 실선 존재 판정
const countBlack = (dataUrl) =>
  page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const g = canvas.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40 && d[i + 3] > 200) black++;
    }
    return { black, width: img.width, height: img.height };
  }, dataUrl);

// ── 에디터 내보내기 ──────────────────────────────────────────────
await page.goto("http://localhost:3000/maps/6", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__edge", { state: "attached", timeout: 30000 });
await page.waitForTimeout(1500);
const strokeBefore = await page.evaluate(
  () => getComputedStyle(document.querySelector(".react-flow__edge-path")).stroke,
);
await page.keyboard.press("Control+Shift+E");
await page.waitForFunction(() => window.__png !== null, undefined, { timeout: 30000 });
const editorPng = await page.evaluate(() => window.__png);
const editor = await countBlack(editorPng);
await page.waitForTimeout(300);
const strokeAfter = await page.evaluate(
  () => getComputedStyle(document.querySelector(".react-flow__edge-path")).stroke,
);

// ── 비교 화면 내보내기 ────────────────────────────────────────────
await page.evaluate(() => { window.__png = null; });
await page.goto("http://localhost:3000/maps/6/compare", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__edge", { state: "attached", timeout: 30000 });
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "Export" }).click();
await page.waitForFunction(() => window.__png !== null, undefined, { timeout: 30000 });
const compare = await countBlack(await page.evaluate(() => window.__png));

const pass =
  editor.black > MIN_BLACK_PX &&
  compare.black > MIN_BLACK_PX &&
  strokeBefore === strokeAfter &&
  errors.length === 0;
console.log(
  JSON.stringify(
    { editor, compare, strokeRestored: strokeBefore === strokeAfter, consoleErrors: errors.length, pass },
    null,
    2,
  ),
);
await browser.close();
process.exit(pass ? 0 : 1);
