// AI L5 캠페인 연결 캔버스 스모크 — 진입 즉시 자동 제안(오버레이 링) → 편집 캔버스(우클릭 분기 추가·엣지 라벨·PUT /canvas)
// → 피드백으로 엣지 뒤집기 → 확정 → 등록.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-canvas.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

async function createL5Chain() {
  const tag = Date.now().toString(36);
  let parentId = null;
  let l5 = null;
  for (let level = 1; level <= 5; level++) {
    const name = level === 5 ? `canvas-L5-${tag}` : `canvas-L${level}-${tag}`;
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
  return { l5Name: `canvas-L5-${tag}`, l5 };
}

async function readCanvas(sessionId) {
  const res = await fetch(`${BACKEND}/api/framework-interviews/${sessionId}`, { headers: { "X-Dev-User": ADMIN } });
  const session = await res.json();
  return session.canvas ?? { nodes: [], edges: [] };
}

const { l5Name, l5 } = await createL5Chain();
check("seed L1..L5 chain", true, l5Name);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); }, ADMIN);
const page = await ctx.newPage();
// 디바운스 저장이 실제로 서버에 닿는지 — 응답 상태를 모아 본다
const canvasPuts = [];
page.on("response", (res) => {
  if (res.request().method() === "PUT" && res.url().includes("/canvas")) canvasPuts.push(res.status());
});

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-search"]').fill(l5Name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
const sessionId = Number(/consult\/(\d+)/.exec(page.url())[1]);
check("session page opened", Number.isFinite(sessionId), String(sessionId));

await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor();

async function answerOneCard() {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 20000 });
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
}

await answerOneCard();
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 30000 });
while (await page.locator('[data-id="fw-consult-questions"]').isVisible().catch(() => false)) {
  await answerOneCard();
  await page.waitForTimeout(500);
}
// 제안 오버레이는 연결 단계가 마운트되는 순간의 과도 상태 — Playwright 액션은 페이지당 직렬화되므로
// 동시 대기 대신, 마지막 카드가 그려지기 전에 페이지 안 폴링(waitForFunction)을 걸어 등장을 잡는다.
const overlaySeen = await page
  .waitForFunction(() => document.querySelector('[data-id="fw-consult-relations-proposing"]') !== null, null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
check("proposing overlay shown on entry", overlaySeen);

await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
const canvas = page.locator('[data-id="fw-consult-relations-canvas"]');
// 수평 엣지는 bbox 높이가 0이라 visible 판정이 안 된다 — attached로 기다린다
await canvas.locator(".react-flow__edge").first().waitFor({ state: "attached", timeout: 30000 });
const nodeCount = await canvas.locator(".react-flow__node").count();
check("auto proposal drew the canvas", nodeCount >= 4, `${nodeCount} nodes`);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-relations-canvas.png" });

// ① 피드백 → 가짜 AI가 첫 subprocess→subprocess 엣지를 뒤집는다.
// 분기 노드를 끼우기 전에 확인한다 — 분기가 들어가면 그 직결 엣지가 사라져 뒤집을 대상이 없다.
const beforeEdges = (await readCanvas(sessionId)).edges.map((e) => `${e.source_node_id}>${e.target_node_id}`);
await page.locator('[data-id="fw-feedback-input"]').fill("첫 두 단계 순서를 바꿔 주세요");
await page.locator('[data-id="fw-feedback-send"]').click();
await page.locator('[data-id="fw-feedback-entry-0"]').waitFor({ timeout: 30000 });
await canvas.locator(".react-flow__edge").first().waitFor({ state: "attached", timeout: 30000 });
const afterEdges = (await readCanvas(sessionId)).edges.map((e) => `${e.source_node_id}>${e.target_node_id}`);
check("feedback flipped an edge and remounted the canvas", beforeEdges.join("|") !== afterEdges.join("|"), afterEdges.join(" "));

// ② 우클릭 → 뒤에 분기 추가 (decision 노드 +1)
const nodeIds = await canvas.locator(".react-flow__node").evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
const subId = nodeIds.find((id) => id && !id.startsWith("__"));
await canvas.locator(`.react-flow__node[data-id="${subId}"]`).click({ button: "right" });
await page.locator('[data-id="context-menu"]').waitFor({ timeout: 5000 });
await page.locator('[data-id="context-menu"] button').filter({ hasText: "뒤에 분기 추가" }).click();
await page.waitForFunction(
  (want) => document.querySelectorAll('[data-id="fw-consult-relations-canvas"] .react-flow__node').length === want,
  nodeCount + 1,
  { timeout: 10000 },
);
check("context menu added a branch node", true, `${nodeCount + 1} nodes`);

// 엣지 클릭 지점 — 경로 중간점을 실좌표로 환산하고(bbox 중심은 곡선 밖일 수 있다) elementFromPoint로
// 그 점이 정말 그 엣지인 엣지를 고른다. 노드나 엣지 라벨이 덮은 중간점은 클릭이 거기로 간다.
function findEdgePoint() {
  return page.evaluate(() => {
    const paths = [...document.querySelectorAll('[data-id="fw-consult-relations-canvas"] .react-flow__edge-interaction')];
    for (const path of paths) {
      const pt = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      const x = pt.x * m.a + pt.y * m.c + m.e;
      const y = pt.x * m.b + pt.y * m.d + m.f;
      if (document.elementFromPoint(x, y) === path) return { x, y };
    }
    return null;
  });
}
const countEdges = () => canvas.locator(".react-flow__edge").count();

// ③ 엣지 클릭 → 라벨 저장
const point = await findEdgePoint();
check("found a clickable edge midpoint", point !== null);
await page.mouse.click(point.x, point.y);
const labelInput = page.locator('[data-id="fw-relations-edge-label"]');
await labelInput.waitFor({ timeout: 5000 });
await labelInput.fill("승인");
await labelInput.press("Enter");
await canvas.locator("text", { hasText: "승인" }).first().waitFor({ timeout: 10000 });
check("edge label saved on the canvas", true);

// ④ 엣지 선택 → Delete → 삭제 + 저장. 클릭은 라벨 팝오버도 열므로 Escape로 팝오버만 닫고
// (RF 선택은 유지) Delete를 누른다 — 입력에 포커스가 있으면 RF가 키를 무시한다.
await page.waitForTimeout(600);
const edgesBefore = await countEdges();
const putsBefore = canvasPuts.length;
const delPoint = await findEdgePoint();
await page.mouse.click(delPoint.x, delPoint.y);
await labelInput.waitFor({ timeout: 5000 });
await labelInput.press("Escape");
await page.keyboard.press("Delete");
const edgeDeleted = await page
  .waitForFunction(
    (want) => document.querySelectorAll('[data-id="fw-consult-relations-canvas"] .react-flow__edge').length === want,
    edgesBefore - 1,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false);
check("Delete removes the selected edge", edgeDeleted, `${edgesBefore} -> ${await countEdges()}`);
await page.waitForTimeout(1200);
check("edge delete was saved (PUT /canvas 200)", canvasPuts.length > putsBefore && canvasPuts.every((s) => s === 200), canvasPuts.join(","));

// ⑤ 노드는 삭제 불가 — L6 카드가 캔버스에서 사라지면 서버 캔버스와 어긋난다
const nodesBefore = await canvas.locator(".react-flow__node").count();
await canvas.locator(`.react-flow__node[data-id="${subId}"]`).click();
await page.keyboard.press("Delete");
await page.waitForTimeout(600);
const nodesAfter = await canvas.locator(".react-flow__node").count();
check("Delete leaves subprocess nodes alone", nodesAfter === nodesBefore, `${nodesBefore} -> ${nodesAfter}`);

// ⑥ 디바운스(300ms) PUT /canvas 전부 200
check("PUT /canvas returned 200", canvasPuts.length > 0 && canvasPuts.every((s) => s === 200), canvasPuts.join(","));

// ⑦ 확정 → 등록
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor({ timeout: 20000 });
check("register step reached", true);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
