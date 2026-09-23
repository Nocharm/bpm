// AI L5 캠페인 연결 캔버스 스모크 — 진입 즉시 자동 제안(오버레이 링) → 편집 캔버스(우클릭 분기 추가·엣지 라벨·PUT /canvas)
// → 피드백으로 엣지 뒤집기 → 확정 → 등록. 보드 전 행 클릭(대기 카드→준비 중 패널, 완료 카드→미리보기+채팅)과
// 설문 섹션 헤더·카드 피드백(수정) 반영까지 같은 세션에서 훑는다.
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
// 남은 검사를 밟을 수 없을 때(선행 조건 실패) — 지금까지의 결과를 요약하고 실패로 끝낸다
const summarize = () => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  return failed.length;
};

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

async function readTask(sessionId, taskPk) {
  const res = await fetch(`${BACKEND}/api/framework-interviews/${sessionId}/tasks/${taskPk}`, { headers: { "X-Dev-User": ADMIN } });
  return res.json();
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
// 등록 단계 드라이런 재실행 감시 — 보드 카드를 열고 닫는 동안 다시 돌면 거버넌스 선택이 초기화된다
const importPosts = [];
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/categories/import-interview")) importPosts.push(req.url());
});

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-search"]').fill(l5Name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
const sessionId = Number(/consult\/(\d+)/.exec(page.url())[1]);
check("session page opened", Number.isFinite(sessionId), String(sessionId));

// 러너를 미리 멈춰 둔다 — 가짜 AI는 즉답이라 잠금 직후 카드가 곧바로 ready로 가서 대기 상태를 볼 틈이 없다.
await fetch(`${BACKEND}/api/framework-interviews/${sessionId}/pause`, { method: "POST", headers: { "X-Dev-User": ADMIN } });
await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor({ timeout: 20000 });

const { tasks: lockedTasks } = await (await fetch(`${BACKEND}/api/framework-interviews/${sessionId}`, { headers: { "X-Dev-User": ADMIN } })).json();
const [firstTask, secondTask] = [...lockedTasks].sort((a, b) => a.seq - b.seq);
check("plan locked into at least 2 cards", Boolean(firstTask) && Boolean(secondTask), lockedTasks.map((x) => `${x.seq}:${x.status}`).join(" "));

// 대기 중인 두 번째 행 클릭 → 준비 중 패널(러너가 아직 멈춰 있어 pending으로 붙잡힌다)
await page.locator(`[data-id="fw-consult-task-${secondTask.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"]').waitFor({ timeout: 10000 });
const waitingShown = await page.locator('[data-id="fw-consult-task-waiting"]').isVisible();
check("pending board row opens the waiting panel", waitingShown);

// 닫기 → 자동 흐름(첫 카드)으로 복귀 후 러너 재개
await page.locator('[data-id="fw-consult-task-close"]').click();
await page.locator('[data-id="fw-consult-pause-toggle"]').click();

let sectionChecked = false;
async function answerOneCard() {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 20000 });
  if (!sectionChecked) {
    sectionChecked = true;
    const basicSection = await page.locator('[data-id="fw-consult-section-basic"]').count();
    check("questionnaire shows the basic-info section header", basicSection > 0);
  }
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
}

await answerOneCard();
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 30000 });
// 제안 오버레이는 연결 단계가 마운트되는 순간의 과도 상태(최소 1.5초, RelationsStep OVERLAY_MIN_MS) —
// 마지막 카드가 그려지자마자 나타났다 걷힐 수 있으니, 마지막 제출 전에 미리 폴링(waitForFunction)을 걸어 둔다.
const overlayPromise = page
  .waitForFunction(() => document.querySelector('[data-id="fw-consult-relations-proposing"]') !== null, null, { timeout: 90000 })
  .then(() => true)
  .catch(() => false);
while (await page.locator('[data-id="fw-consult-questions"]').isVisible().catch(() => false)) {
  await answerOneCard();
  await page.waitForTimeout(500);
}
check("proposing overlay shown on entry", await overlayPromise);

await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
const canvas = page.locator('[data-id="fw-consult-relations-canvas"]');
// 수평 엣지는 bbox 높이가 0이라 visible 판정이 안 된다 — attached로 기다린다
await canvas.locator(".react-flow__edge").first().waitFor({ state: "attached", timeout: 30000 });
const nodeCount = await canvas.locator(".react-flow__node").count();
check("auto proposal drew the canvas", nodeCount >= 4, `${nodeCount} nodes`);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-relations-canvas.png" });

// [다시 제안]은 리셋이라 캔버스가 있으면 확인을 먼저 묻는다 — 취소하면 캔버스는 그대로(부분 수정은 채팅 한 게이트)
await page.locator('[data-id="fw-consult-propose-relations"]').click();
const reproposeAsked = await page.locator('[data-id="fw-consult-repropose-confirm"]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
check("propose again asks for confirmation when a canvas exists", reproposeAsked);
await page.locator('[data-id="confirm-dialog-cancel"]').click();
check("cancelling keeps the canvas", (await canvas.locator(".react-flow__node").count()) === nodeCount);
check("the memo box next to the propose button is gone", (await page.locator('[data-id="fw-consult-propose-comment"]').count()) === 0);

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
const branchAdded = await page
  .waitForFunction(
    (want) => document.querySelectorAll('[data-id="fw-consult-relations-canvas"] .react-flow__node').length === want,
    nodeCount + 1,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false);
check("context menu added a branch node", branchAdded, `${await canvas.locator(".react-flow__node").count()} nodes`);

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
if (point === null) {
  await browser.close();
  process.exit(summarize() ? 1 : 0);
}
await page.mouse.click(point.x, point.y);
const labelInput = page.locator('[data-id="fw-relations-edge-label"]');
await labelInput.waitFor({ timeout: 5000 });
await labelInput.fill("승인");
await labelInput.press("Enter");
const labelShown = await canvas
  .locator("text", { hasText: "승인" })
  .first()
  .waitFor({ timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("edge label saved on the canvas", labelShown);

// ③-b 보드 카드를 열고 닫아도 편집 중인 캔버스가 살아 있다 — 연결 단계는 언마운트되지 않고 숨기만 한다.
// (리마운트하면 디바운스 저장 대기분·분기·라벨이 낡은 session.canvas로 되감긴다)
await page.waitForTimeout(700);  // 라벨 저장 디바운스(300ms) PUT까지 흘려보낸다
const readViewport = () => canvas.locator(".react-flow__viewport").evaluate((el) => el.style.transform);
const nodesBeforeSelect = await canvas.locator(".react-flow__node").count();
const viewportBeforeSelect = await readViewport();
const putsBeforeSelect = canvasPuts.length;
await page.locator(`[data-id="fw-consult-task-${firstTask.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"]').waitFor({ timeout: 10000 });
const relationsHidden = await page.locator('[data-id="fw-consult-relations-host"]').isHidden();
check("board row hides (not unmounts) the relations step", relationsHidden);
await page.locator('[data-id="fw-consult-task-close"]').click();
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 10000 });
const nodesAfterSelect = await canvas.locator(".react-flow__node").count();
const labelKept = await canvas.locator("text", { hasText: "승인" }).count();
check(
  "canvas edits survive opening and closing a board card",
  nodesAfterSelect === nodesBeforeSelect && labelKept > 0,
  `${nodesBeforeSelect} -> ${nodesAfterSelect} nodes, label x${labelKept}`,
);
check("no stale PUT /canvas fired while the card panel was open", canvasPuts.length === putsBeforeSelect, `${putsBeforeSelect} -> ${canvasPuts.length}`);
// 숨었다 돌아온 ReactFlow가 화면을 그대로 유지하는지(뷰포트 변환 동일) + L6 카드 이름이 노드 라벨에 실렸는지
const viewportAfterSelect = await readViewport();
check("hidden canvas keeps its viewport", viewportAfterSelect === viewportBeforeSelect, `${viewportBeforeSelect} -> ${viewportAfterSelect}`);
// 노드 텍스트는 이름 뒤에 카드의 역할·부서가 이어진다(L5 맵 L6 노드와 같은 룩) — 이름으로 시작하는지만 본다
const cardNames = (await (await fetch(`${BACKEND}/api/framework-interviews/${sessionId}`, { headers: { "X-Dev-User": ADMIN } })).json()).tasks.map((task) => task.name);
const nodeLabels = await canvas.locator(".react-flow__node").evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
const subLabels = nodeLabels.filter((label) => label && !["Start", "End"].includes(label) && !label.endsWith("결과"));
check(
  "subprocess nodes are labelled with the L6 card names",
  subLabels.length > 0 && subLabels.every((label) => cardNames.some((name) => label.startsWith(name))),
  subLabels.join(" | "),
);
const serverCanvas = await readCanvas(sessionId);
check(
  "server canvas still holds the branch and the label",
  serverCanvas.nodes.length === nodesBeforeSelect && serverCanvas.edges.some((e) => e.label === "승인"),
  `${serverCanvas.nodes.length} nodes`,
);

// ④ 엣지 선택 → Delete → 삭제 + 저장. 클릭은 라벨 팝오버도 열므로 Escape로 팝오버만 닫고
// (RF 선택은 유지) Delete를 누른다 — 입력에 포커스가 있으면 RF가 키를 무시한다.
await page.waitForTimeout(600);
const edgesBefore = await countEdges();
const putsBefore = canvasPuts.length;
const delPoint = await findEdgePoint();
check("found a clickable edge midpoint for delete", delPoint !== null);
if (delPoint === null) {
  await browser.close();
  process.exit(summarize() ? 1 : 0);
}
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

// 자동 드라이런이 끝난 리포트에 사용자 상태(검색어)를 하나 남긴다 — 카드 패널을 닫은 뒤 그대로인지 본다
await page.locator('[data-id="interview-import-report"]').waitFor({ timeout: 40000 });
const reportSearch = page.locator('[data-id="interview-report-search"]');
await reportSearch.fill("keep-me");
const importPostsBefore = importPosts.length;

// ⑧ 등록 리포트를 보는 중에도 보드는 살아있다 — 완료 카드를 클릭하면 미리보기+피드백 채팅 패널이 열린다
await page.locator(`[data-id="fw-consult-task-${firstTask.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"][data-status="drawn"]').waitFor({ timeout: 10000 });
const registerHidden = await page.locator('[data-id="fw-consult-register-host"]').isHidden();
check("board row hides (not unmounts) the register step", registerHidden);
await page.locator('[data-id="fw-consult-task-panel-canvas"]').waitFor({ timeout: 15000 });
const feedbackChatShown = await page.locator('[data-id="fw-feedback-chat"]').isVisible();
check("done board card opens preview + feedback chat after registration", feedbackChatShown);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-canvas-feedback.png" });

// ⑧-b 카드 패널을 닫으면 등록 리포트가 그대로 돌아온다 — 드라이런 재실행 없음, 리포트 상태 유지
await page.locator('[data-id="fw-consult-task-close"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor({ timeout: 10000 });
check("dry run did not re-run while the card panel was open", importPosts.length === importPostsBefore, `${importPostsBefore} -> ${importPosts.length}`);
check("register report state survived the card panel", (await reportSearch.inputValue()) === "keep-me", await reportSearch.inputValue());

// ⑨ 카드 피드백(수정) — 행이 바뀌면 조립본이 낡아 서버가 연결 단계로 되돌린다(status linking)
await page.locator(`[data-id="fw-consult-task-${firstTask.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"][data-status="drawn"]').waitFor({ timeout: 10000 });
const beforeTask = await readTask(sessionId, firstTask.id);
await page.locator('[data-id="fw-feedback-input"]').fill("이름 고쳐");
await page.locator('[data-id="fw-feedback-send"]').click();
await page.locator('[data-id="fw-feedback-entry-0"]').waitFor({ timeout: 30000 });
const afterTask = await readTask(sessionId, firstTask.id);
check(
  "task feedback rewrote the row with a (수정) suffix",
  String(afterTask.row?.l6 ?? "").endsWith("(수정)"),
  `${beforeTask.row?.l6 ?? ""} -> ${afterTask.row?.l6 ?? ""}`,
);

await browser.close();
process.exit(summarize() ? 1 : 0);
