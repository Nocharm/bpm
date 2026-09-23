// AI L5 캠페인 스모크 — 관리 트리에서 L5 선택 → 우측 상세 패널 [AI로 L5 채우기] → 계획 확정 →
// 설문 전량 제출 → 카드 드로잉 → 연결 확정 → dry-run 리포트.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-fw-consult.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
// 스크립트가 자체 L1~L5 카테고리 체인을 매 실행 고유 이름으로 만들어 독립 실행(재실행해도 다른 세션).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

// L1..L5 체인을 고유 이름으로 생성 — 기존 시드/이전 실행과 절대 충돌하지 않게(브리프의 "간단한 자급 체인" 방침).
async function createL5Chain() {
  const tag = Date.now().toString(36);
  let parentId = null;
  let l5 = null;
  for (let level = 1; level <= 5; level++) {
    const name = level === 5 ? `smoke-L5-${tag}` : `smoke-L${level}-${tag}`;
    const res = await fetch(`${BACKEND}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN },
      body: JSON.stringify({ name, parent_id: parentId }),
    });
    if (!res.ok) throw new Error(`create category failed: ${res.status} ${await res.text()}`);
    const node = await res.json();
    parentId = node.id;
    if (level === 5) l5 = node;
  }
  return { l5Name: `smoke-L5-${tag}`, l5 };
}

const { l5Name, l5 } = await createL5Chain();
check("seed L1..L5 chain", true, l5Name);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor();
check("entry visible", true);

// 진입은 트리 선택이 기준(2026-09-22 설계) — 검색 히트를 누르면 체인이 펼쳐지고 그 행이 선택된다.
// 선택된 행만 우측 상세 패널의 AI L5 버튼을 살린다.
await page.locator('[data-id="framework-admin-search"]').fill(l5Name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
check("L5 row selected in the admin tree", true);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-entry.png" }).catch(() => undefined);
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
check("session page opened", true, page.url());

await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor();
check("plan locked -> tasks", (await page.locator('[data-id="fw-consult-task-list"] li').count()) >= 2);

async function answerOneCard() {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 20000 });
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  const autoCount = await page.locator('[data-id^="fw-consult-auto-"]').count();
  await page.locator('[data-id="fw-consult-submit"]').click();
  return autoCount;
}

const firstAutoCount = await answerOneCard();
check("review shows auto badge", firstAutoCount > 0);
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 30000 });
check("first card drawn", true);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-board.png" }).catch(() => undefined);

// 남은 카드 전부 제출 — questionnaire가 뜨는 동안 반복(카드 2장 고정이라 최대 1회 더).
while (await page.locator('[data-id="fw-consult-questions"]').isVisible().catch(() => false)) {
  await answerOneCard();
  await page.waitForTimeout(500);
}

await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
check("relations step reached", true);
await page.locator('[data-id="fw-consult-propose-relations"]').click();
await page.locator('[data-id="fw-consult-edge-0"]').waitFor({ timeout: 20000 });
check("relations proposed", true);
await page.locator('[data-id="fw-consult-relations-preview"] svg').first().waitFor({ timeout: 20000 });
check("L5 preview rendered", true);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-relations.png" }).catch(() => undefined);
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor();
check("register step reached", true);
await page.locator('[data-id="fw-consult-dryrun"]').click();
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 20000 });
check("dry-run report rendered", true);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-register.png" }).catch(() => undefined);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
