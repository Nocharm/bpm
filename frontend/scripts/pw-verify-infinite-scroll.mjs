// 무한스크롤(25청크) 검증 — A: principal-picker(New map 협업자 피커) 초기 25 → 바닥 도달 시 +25,
// 검색도 캡 없이 25청크 + 부서/그룹 1개 최상단 핀.
// B: 설정 → Employees 테이블(직원 401행) 25행+센티널 → 스크롤마다 +25.
// 실행: node scripts/pw-verify-infinite-scroll.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키를 선주입
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys"); // sysadmin — 설정 관리자 탭 접근용
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
  // 검색도 캡 없이 25청크 — 'a'는 264명 매치: 25개+센티널, 스크롤 시 +25 (React 제어 입력은 네이티브 setter로 주입)
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setVal.call(input, "a");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  out.searchCount1 = count();
  out.searchSentinel = !!list.querySelector("div.h-px");
  list.scrollTop = list.scrollHeight;
  await wait(500);
  out.searchCount2 = count();
  // 부서/그룹 최상단 핀 — 's'는 부서(System Team 등)+유저 동시 매치: 첫 행 우측 라벨이 Department/Group
  setVal.call(input, "s");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  out.firstRowLabel =
    list.querySelector("button")?.querySelector("span.ml-auto")?.textContent ?? "";
  // 검색어 지우면 다시 25부터(리셋 확인)
  setVal.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await wait(400);
  out.countReset = count();
  return out;
});

// ── B: 설정 → Employees 테이블 ──────────────────────────────────────
await page.goto("http://localhost:3000/settings", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Employees" }).first().click();
await page.waitForSelector("tbody tr", { timeout: 15000 });

const table = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tbody = document.querySelector("tbody");
  const rows = () => tbody.querySelectorAll("tr").length;
  // 실제 스크롤되는 조상 탐색(설정 main 등) — 없으면 문서 스크롤 폴백
  let sc = tbody.parentElement;
  while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
  const target = sc ?? document.scrollingElement;
  const out = { rows1: rows() };
  target.scrollTop = target.scrollHeight;
  await wait(500);
  out.rows2 = rows();
  target.scrollTop = target.scrollHeight;
  await wait(500);
  out.rows3 = rows();
  return out;
});

// ── C: 페이지 스모크 — 목록 적용 페이지들이 콘솔 에러 없이 렌더되는지 ──────────
const beforeC = errors.length;
for (const path of ["/", "/notices", "/inbox"]) {
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}
const cConsoleErrors = errors.length - beforeC;

// 테이블 행 수는 데이터 25 + 센티널 1
const pass =
  result.count1 === 25 &&
  result.sentinel1 &&
  result.count2 === 50 &&
  result.count3 === 75 &&
  result.searchCount1 === 25 &&
  result.searchSentinel &&
  result.searchCount2 === 50 &&
  ["Department", "Group"].includes(result.firstRowLabel) &&
  result.countReset === 25 &&
  table.rows1 === 26 &&
  table.rows2 === 51 &&
  table.rows3 === 76 &&
  cConsoleErrors === 0;

console.log(JSON.stringify({ picker: result, table, cConsoleErrors, consoleErrors: errors.length, pass }, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
