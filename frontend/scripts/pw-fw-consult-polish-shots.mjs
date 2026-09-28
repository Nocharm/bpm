// AI L5 캠페인 폴리시 라운드(2026-09-28) 확인용 스크린샷 — 관리 패널(컴팩트 타일·열 토글·인터뷰 JSON 스트립),
// 계획(선행 연결선·호버 무리·우클릭 선행 메뉴), 설문(복수 선택·코멘트·AI 제안 링), 검토(제출 코멘트), 등록 완료 오버레이.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-polish-shots.mjs
// 전제: 가짜 AI(:9999) + backend + frontend 기동. 자체 L1~L5 체인을 만든다. 산출: docs/qa/screens/fw-polish-*.png
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const OUT = process.env.SHOT_DIR ?? "../docs/qa/screens";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}
const shots = [];
const shot = async (page, name) => { const path = `${OUT}/${name}.png`; await page.screenshot({ path }); shots.push(path); console.log(`SHOT ${path}`); };

const tag = Date.now().toString(36);
const chain = [];
let parent = null;
for (let level = 1; level <= 4; level++) {
  const n = await post("/api/categories", { name: `polish-L${level}-${tag}`, parent_id: parent });
  chain.push(n);
  parent = n.id;
}
// L3 아래 형제 L4를 여럿 두어 타일 목록 스크롤을 보인다
for (let i = 1; i <= 7; i++) await post("/api/categories", { name: `polish-L4-sibling-${i}-${tag}`, parent_id: chain[2].id });
const l5 = await post("/api/categories", { name: `polish-L5-${tag}`, parent_id: chain[3].id });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); }, ADMIN);
const page = await ctx.newPage();

// ① 관리 패널 — L3 선택(형제 L4 타일 8개 스크롤) + 인터뷰 JSON 스트립
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor();
await page.locator('[data-id="framework-admin-search"]').fill(chain[2].name);
await page.locator(`[data-id="framework-admin-search-result-${chain[2].id}"]`).click();
await page.locator('[data-id="fw-level-tile-list"]').waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-level-columns-3"]').click();
await page.waitForTimeout(300);
await shot(page, "fw-polish-settings-tiles");
await page.locator('[data-id="framework-admin-search"]').fill(l5.name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator('[data-id="fw-level-start"]').waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-level-start"]').hover();
await page.waitForTimeout(200);
await shot(page, "fw-polish-settings-l5");

// ② 계획 — 제안 후 카드 2장 + 수동 2장(2단계 병렬·3단계) → 연결선·호버·우클릭 메뉴
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
await page.locator('[data-id="fw-consult-brief"]').waitFor();
await shot(page, "fw-polish-plan-brief");
await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-1"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-plan-add-stage-1"]').click({ force: true });
await page.locator('[data-id="fw-consult-plan-name"]').fill("증빙 확인");
await page.locator('[data-id="fw-consult-plan-role"]').fill("검토 담당자");
await page.locator('[data-id="fw-consult-plan-add"]').click({ force: true });
await page.locator('[data-id="fw-consult-plan-name"]').fill("결과 통보");
await page.locator('[data-id="fw-consult-plan-role"]').fill("구매 담당자");
await page.waitForTimeout(600);
await page.locator('[data-id="fw-consult-plan-row-1"]').hover();
await page.waitForTimeout(250);
await shot(page, "fw-polish-plan-links");
await page.locator('[data-id="fw-consult-plan-row-3"]').click({ button: "right" });
await page.locator('[data-id="context-menu"]').waitFor({ timeout: 5000 });
await page.locator('[data-id="context-menu"] button').filter({ hasText: "선행 카드" }).hover();
await page.waitForTimeout(300);
await shot(page, "fw-polish-plan-menu");
await page.keyboard.press("Escape");

// ③ 설문 — 복수 선택 토글·코멘트·AI 제안 링
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 30000 });
await page.locator('[data-id="fw-consult-multi-toggle-q7"]').click();
await page.locator('[data-id="fw-consult-answer-q7-b2"]').click();
await page.locator('[data-id="fw-consult-comment-toggle-q2"]').click();
await page.locator('[data-id="fw-consult-comment-q2"]').fill("긴급 건은 관리자가 직접 처리");
await page.locator('[data-id="fw-consult-ai-suggest-q4"]').click();
await page.waitForTimeout(500);
await shot(page, "fw-polish-questionnaire");
await page.waitForTimeout(2500);
await page.locator('[data-id="fw-consult-review"]').click();
await page.locator('[data-id="fw-consult-submit-note"]').waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-consult-submit-note"]').fill("야간에는 당직자가 접수까지만 처리하고 검토는 다음 날 아침에 한다.");
await shot(page, "fw-polish-review");
await page.locator('[data-id="fw-consult-submit"]').click();

// ④ 나머지 카드 제출 → 연결 → 등록 → 적용 → 완료 오버레이
const submitRest = async () => {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 30000 });
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
  await page.waitForTimeout(500);
};
await page.locator('[data-id="fw-consult-task-drawing"], [data-id="fw-consult-task-waiting"]').first().waitFor({ timeout: 30000 }).catch(() => undefined);
await page.waitForTimeout(400);
await shot(page, "fw-polish-drawing");
for (let i = 0; i < 6; i++) {
  if (await page.locator('[data-id="fw-consult-relations"]').isVisible().catch(() => false)) break;
  await submitRest().catch(() => undefined);
}
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 90000 });
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 30000 });
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor();
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 30000 });
await page.locator('[data-id="interview-import-apply"]').click();
await page.locator('[data-id="fw-consult-done"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await shot(page, "fw-polish-done");

await browser.close();
console.log(`${shots.length} screenshots`);
