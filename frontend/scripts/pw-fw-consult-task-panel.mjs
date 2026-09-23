// AI L5 캠페인 카드 패널 스모크 — 보드의 모든 행이 상태별 패널을 연다: 대기(준비 중 링) → 설문(섹션 헤더) →
// 제출(답+드로잉 링) → 완성(답+흐름 미리보기+피드백 채팅, 피드백 뒤 상세 재조회) → 닫기로 자동 흐름 복귀.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-task-panel.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core·node는 frontend/ cwd).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
const api = (path, init = {}) => fetch(`${BACKEND}/api${path}`, {
  ...init,
  headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN, ...(init.headers ?? {}) },
});

async function createL5Chain() {
  const tag = Date.now().toString(36);
  let parentId = null;
  let l5 = null;
  for (let level = 1; level <= 5; level++) {
    const res = await api("/categories", { method: "POST", body: JSON.stringify({ name: `panel-L${level}-${tag}`, parent_id: parentId }) });
    if (!res.ok) throw new Error(`create category failed: ${res.status} ${await res.text()}`);
    const node = await res.json();
    parentId = node.id;
    if (level === 5) l5 = node;
  }
  return { l5Name: `panel-L5-${tag}`, l5 };
}

const readSession = async (sessionId) => (await api(`/framework-interviews/${sessionId}`)).json();
const readTask = async (sessionId, taskPk) => (await api(`/framework-interviews/${sessionId}/tasks/${taskPk}`)).json();

const { l5Name, l5 } = await createL5Chain();
check("seed L1..L5 chain", true, l5Name);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); }, ADMIN);
const page = await ctx.newPage();
// 카드 상세(GET /tasks/{pk}) 재조회 횟수 — 피드백 뒤 패널이 실제로 다시 받았는지 본다
const detailGets = [];
page.on("response", (res) => {
  if (res.request().method() === "GET" && /\/tasks\/\d+$/.test(new URL(res.url()).pathname)) detailGets.push(res.status());
});

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-search"]').fill(l5Name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
const sessionId = Number(/consult\/(\d+)/.exec(page.url())[1]);

// 러너를 미리 멈춰 둔다 — 가짜 AI는 즉답이라 잠금 직후 카드가 곧바로 ready로 가서 대기 상태를 볼 틈이 없다.
await api(`/framework-interviews/${sessionId}/pause`, { method: "POST" });
await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor({ timeout: 20000 });

const tasks = (await readSession(sessionId)).tasks.sort((a, b) => a.seq - b.seq);
check("plan locked into cards", tasks.length >= 2, tasks.map((x) => `${x.seq}:${x.status}`).join(" "));
const [first, second] = tasks;

// ① 대기 중인 두 번째 행 클릭 → 준비 중 패널
await page.locator(`[data-id="fw-consult-task-${second.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"]').waitFor({ timeout: 10000 });
const waitingShown = await page.locator('[data-id="fw-consult-task-waiting"]').isVisible();
const panelTitle = (await page.locator('[data-id="fw-consult-task-panel"] .text-body-strong').first().textContent()) ?? "";
check("pending row opens the preparing panel", waitingShown && panelTitle.includes(second.name), `${panelTitle.trim()} / waiting=${waitingShown}`);

// 닫기 → 자동 흐름(첫 카드)으로 복귀 후 러너 재개
await page.locator('[data-id="fw-consult-task-close"]').click();
await page.locator('[data-id="fw-consult-pause-toggle"]').click();

// ② 설문 폼 — 섹션 헤더가 묶여 나온다
await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 30000 });
const sectionIds = await page.locator('[data-id="fw-consult-questions"] section').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
const basicHeader = (await page.locator('[data-id="fw-consult-section-basic"] span').first().textContent()) ?? "";
check("questionnaire groups questions into sections", sectionIds.includes("fw-consult-section-basic") && sectionIds.includes("fw-consult-section-activities"), sectionIds.join(","));
check("section header uses the localized label", basicHeader.trim() === "기본 정보", basicHeader.trim());

// ③ 제출 답 + 드로잉 링 — 제출 전에 러너를 멈춰 submitted 상태를 붙잡는다
await page.locator('[data-id="fw-consult-pause-toggle"]').click();
await page.locator('[data-id="fw-consult-fill-all"]').click();
await page.locator('[data-id="fw-consult-review"]').click();
await page.locator('[data-id="fw-consult-submit"]').click();
await page.locator(`[data-id="fw-consult-task-${first.id}"][data-status="submitted"]`).waitFor({ timeout: 20000 });
await page.locator(`[data-id="fw-consult-task-${first.id}"]`).click();
await page.locator('[data-id="fw-consult-task-submitted"]').waitFor({ timeout: 10000 });
const drawingRing = await page.locator('[data-id="fw-consult-task-drawing"]').isVisible();
// 답은 상세(GET /tasks/{pk})가 도착한 뒤 붙는다 — 링은 즉시라 같이 재면 경합한다
const reviewShown = await page.locator('[data-id="fw-consult-task-submitted"] [data-id="fw-consult-review-list"]')
  .waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("submitted row shows the answers and the drawing ring", drawingRing && reviewShown, `ring=${drawingRing} review=${reviewShown}`);

// ④ 완성 카드 — 답 + 흐름 미리보기 + 피드백 채팅
await page.locator('[data-id="fw-consult-task-close"]').click();
await page.locator('[data-id="fw-consult-pause-toggle"]').click();
await page.locator(`[data-id="fw-consult-task-${first.id}"][data-status="drawn"]`).waitFor({ timeout: 60000 });
await page.locator(`[data-id="fw-consult-task-${first.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"][data-status="drawn"]').waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-consult-task-panel-canvas"]').waitFor({ timeout: 15000 });
const chatShown = await page.locator('[data-id="fw-feedback-chat"]').isVisible();
const drawnReview = await page.locator('[data-id="fw-consult-task-drawn"] [data-id="fw-consult-review-list"]').isVisible();
check("drawn row shows answers, preview and feedback chat", chatShown && drawnReview, `chat=${chatShown} review=${drawnReview}`);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-task-panel.png" });

// ⑤ 카드 피드백은 제자리 수정 — 행이 바뀌고 패널이 상세를 다시 받는다(상태는 drawn 유지)
const beforeL6 = (await readTask(sessionId, first.id)).row?.l6 ?? "";
const getsBefore = detailGets.length;
await page.locator('[data-id="fw-feedback-input"]').fill("이름 고쳐");
await page.locator('[data-id="fw-feedback-send"]').click();
await page.locator('[data-id="fw-feedback-entry-0"]').waitFor({ timeout: 30000 });
const afterTask = await readTask(sessionId, first.id);
check("task feedback rewrote the row in place", String(afterTask.row?.l6 ?? "").endsWith("(수정)") && afterTask.status === "drawn", `${beforeL6} -> ${afterTask.row?.l6} (${afterTask.status})`);
for (let i = 0; i < 20 && detailGets.length === getsBefore; i++) await page.waitForTimeout(250);
const refetched = detailGets.length > getsBefore && detailGets.every((s) => s === 200);
check("panel re-fetched the task detail after feedback", refetched, `${getsBefore} -> ${detailGets.length} GETs`);
const stillDrawn = await page.locator('[data-id="fw-consult-task-panel"][data-status="drawn"]').isVisible();
check("panel stays on the drawn card (no submitted badge transition)", stillDrawn);

// ⑥ 닫기 → 선택 해제 → 자동 흐름 복귀
await page.locator('[data-id="fw-consult-task-close"]').click();
const closed = await page
  .waitForFunction(() => document.querySelector('[data-id="fw-consult-task-panel"][data-status="drawn"]') === null, null, { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("close returns to the automatic flow", closed);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
