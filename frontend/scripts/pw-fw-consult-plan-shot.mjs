// 캠페인 ① 계획 화면 캡처 — 2단 레이아웃(brief+첨부 | 카드)과 첨부 목록을 확인용 스크린샷으로 남긴다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-plan-shot.mjs
// 전제: 가짜 AI(:9999) + backend + frontend 기동. 자체 L1~L5 체인을 만든다(pw-fw-consult.mjs와 동일).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };

async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

const tag = Date.now().toString(36);
let parent = null;
let node = null;
for (let level = 1; level <= 5; level++) {
  node = await post("/api/categories", { name: `shot-L${level}-${tag}`, parent_id: parent });
  parent = node.id;
}
const session = await post("/api/framework-interviews", { category_id: node.id, brief: "정제수 일상 점검 라운드. 매일 오전 운전원이 BMS와 현장 계기를 대조하고 이상 시 재측정한다." });
const form = new FormData();
form.append("file", new Blob(["정제수 점검 절차서 요약: 라운드 시작 → 계기값 확인 → 이상 판정 → 기록"], { type: "text/plain" }), "sop-summary.txt");
const up = await fetch(`${BACKEND}/api/framework-interviews/${session.id}/attachments`, { method: "POST", headers: { "X-Dev-User": ADMIN }, body: form });
if (!up.ok) throw new Error(`attach ${up.status}`);
await post(`/api/framework-interviews/${session.id}/plan`, {});

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/framework/consult/${session.id}`);
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor({ timeout: 30000 });
await page.screenshot({ path: "../docs/qa/screens/fw-consult-plan.png" });
console.log(`PASS plan screenshot (session ${session.id})`);
await browser.close();
