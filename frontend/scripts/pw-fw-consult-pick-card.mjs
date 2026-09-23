// 캠페인 보드 카드 선택 검증 — 두 카드가 ready가 되면 2번 카드를 눌러 먼저 답할 수 있어야 한다(순서 강제 없음).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-pick-card.mjs
// 전제: 가짜 AI(:9999) + backend + frontend 기동. 자체 L1~L5 체인을 만든다.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}
async function put(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

const tag = Date.now().toString(36);
let parent = null;
let node = null;
for (let level = 1; level <= 5; level++) {
  node = await post("/api/categories", { name: `pick-L${level}-${tag}`, parent_id: parent });
  parent = node.id;
}
const session = await post("/api/framework-interviews", { category_id: node.id, brief: "카드 선택 검증" });
const cards = ["요청 접수", "결과 통보", "기록 보관"].map((name) => ({ name, summary: "", owner_role: "", department: "", depends_on: [] }));
await put(`/api/framework-interviews/${session.id}/plan`, { cards, lock: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/framework/consult/${session.id}`);
const second = page.locator('[data-id="fw-consult-task-list"] li').nth(1);
await page.waitForFunction(() => document.querySelectorAll('[data-id="fw-consult-task-list"] li[data-status="ready"]').length >= 2, null, { timeout: 60000 });
check("two cards ready (prefetch)", true);
await second.click();
await page.locator('[data-id="fw-consult-answer"]').waitFor({ timeout: 10000 });
// 카드 이름은 패널 머리줄(task-panel) — 설문 본문 바깥이다
const heading = (await page.locator('[data-id="fw-consult-task-panel"] .text-body-strong').first().textContent()) ?? "";
check("second card answered first", heading.includes("결과 통보"), heading.trim());
await page.locator('[data-id="fw-consult-fill-all"]').click();
await page.locator('[data-id="fw-consult-review"]').click();
await page.locator('[data-id="fw-consult-submit"]').click();
await page.waitForFunction(() => document.querySelector('[data-id="fw-consult-task-list"] li:nth-child(2)')?.getAttribute("data-status") !== "ready", null, { timeout: 10000 });
// 고른 카드는 제출 뒤에도 열려 있다(제출 답 + 드로잉 링) — 자동 흐름 복귀는 [닫기]가 한다(2026-09-23 §4.3 B9)
const stayed = (await page.locator('[data-id="fw-consult-task-panel"] .text-body-strong').first().textContent().catch(() => "")) ?? "";
check("selected card stays open after submit", stayed.includes("결과 통보"), stayed.trim());
await page.locator('[data-id="fw-consult-task-close"]').click();
const backTo = (await page.locator('[data-id="fw-consult-task-panel"] .text-body-strong').first().textContent().catch(() => "")) ?? "";
check("close falls back to the first ready card", backTo.includes("요청 접수"), backTo.trim());
await page.screenshot({ path: "../docs/qa/screens/fw-consult-pick-card.png" });
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
