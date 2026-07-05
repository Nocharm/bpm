// 무한스크롤(25청크) 검증 — principal-picker(New map 협업자 피커): 초기 25 → 바닥 도달 시 +25, 검색은 8개 캡.
// 실행: node scripts/pw-verify-infinite-scroll.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.kim");
  window.localStorage.setItem("bpm.lang", "en"); // 라벨 매칭을 EN으로 고정

});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Process Maps", { timeout: 30000 });

// New map 다이얼로그 → 협업자 피커 포커스
await page.getByRole("button", { name: "New map" }).click();
const input = page.locator('input[placeholder="Search by name or initial consonant…"]').first();
await input.click();
await page.waitForTimeout(400);

const result = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const input = document.querySelector('input[placeholder="Search by name or initial consonant…"]');
  const list = input.closest(".relative").querySelector(".overflow-y-auto");
  const count = () => list.querySelectorAll("button").length;
  const out = { count1: count(), sentinel1: !!list.querySelector("div.h-px") };
  list.scrollTop = list.scrollHeight;
  await wait(500);
  out.count2 = count();
  list.scrollTop = list.scrollHeight;
  await wait(500);
  out.count3 = count();
  // 검색 캡 — React 제어 입력에 네이티브 setter로 주입
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setVal.call(input, "kim");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  out.countSearch = count();
  // 검색어 지우면 다시 25부터(리셋 확인)
  setVal.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  out.countReset = count();
  return out;
});

const pass =
  result.count1 === 25 &&
  result.sentinel1 &&
  result.count2 === 50 &&
  result.count3 === 75 &&
  result.countSearch <= 8 &&
  result.countReset === 25;

console.log(JSON.stringify({ ...result, consoleErrors: errors.length, pass }, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
