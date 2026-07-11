// AI graph 병합 프리뷰 검증 — ①graph 제안 → Import 탭 노출 ②Apply 후 매칭 노드 id 불변 + 신규 노드 추가
// ③챗 graph 카드에 안내 푸터 ④서브프로세스(linked_map_id) 노드는 타입·링크 보존.
// AI 응답은 route mock — 실제 AI 서버 불필요. 단 패널 입력 활성화엔 백엔드 AI_ENABLED=true 필요.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-graph-merge.mjs
// 전제: backend(8010, reset_db 시드, AI_ENABLED=true) + 프론트(3010) 기동.
//
// ⚠️ 편집 전제: PUT /graph는 체크아웃 보유 강제(graph.py) — 맵의 draft 버전을 ctx.request로 먼저
//    checkout한 뒤 그 버전으로 ?version= 진입한다. 기본 선택(latestPublished 우선)에 맡기면
//    published 버전이 열려 체크아웃/저장이 전부 409로 막힌다.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";
// map 2(데모 시드)는 draft 버전에 subprocess 노드(linked_map_id 有)가 있어 ④까지 한 맵에서 검증 가능.
const MAP = Number(process.env.VERIFY_MAP ?? 2);
const DEV_USER = "admin.sys";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ── 시드 상태 확인 — draft 버전을 찾아 체크아웃 선행 ──────────────────
const mapDetail = await (
  await ctx.request.get(`${BASE}/api/maps/${MAP}`, { headers: { "X-Dev-User": DEV_USER } })
).json();
const draftVersion = mapDetail.versions?.find((v) => v.status === "draft") ?? null;
check(
  "setup draft version present",
  Boolean(draftVersion),
  `map=${MAP} versions=${JSON.stringify(mapDetail.versions?.map((v) => [v.id, v.status]))}`,
);
if (!draftVersion) {
  console.error("FATAL no editable (draft) version on the target map — cannot verify Apply");
  await browser.close();
  process.exit(1);
}

// force:true — 데모 시드는 draft 버전에 다른 사용자의 체크아웃을 미리 심어둔다("sticky 점유" 시나리오).
// admin.sys는 dev 기본 설정(dev_enforce_permissions=false)에서 전원-sysadmin 취급이라 강제 인수가 허용된다.
const checkoutRes = await ctx.request.post(`${BASE}/api/versions/${draftVersion.id}/checkout`, {
  headers: { "X-Dev-User": DEV_USER },
  data: { force: true },
});
const checkoutBody = await checkoutRes.json().catch(() => ({}));
check(
  "setup checkout acquired",
  checkoutRes.ok() && checkoutBody.mine === true && checkoutBody.checked_out_by === DEV_USER,
  `status=${checkoutRes.status()} body=${JSON.stringify(checkoutBody)}`,
);

// 에디터가 실제 로드하는 버전 id를 네트워크 요청에서 포착 — ?version= 쿼리가 실제로 먹혔는지 대조
let vid = null;
page.on("request", (req) => {
  const match = req.url().match(/\/api\/versions\/(\d+)\/graph/);
  if (match && vid === null) vid = Number(match[1]);
});
await page.goto(`${BASE}/maps/${MAP}?version=${draftVersion.id}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
check("0a editor opened the checked-out draft version", vid === draftVersion.id, `captured=${vid} expected=${draftVersion.id}`);

const before = await (
  await ctx.request.get(`${BASE}/api/versions/${vid}/graph`, { headers: { "X-Dev-User": DEV_USER } })
).json();
// 매칭 대상 — start/end가 아닌 아무 노드 (제목 매칭 규칙은 node_type과 무관). 시드는 "process"가 아니라
// "task"/"subprocess"를 쓰므로 타입으로 필터링하지 않는다.
const targetNode = before.nodes.find((n) => n.node_type !== "start" && n.node_type !== "end" && n.linked_map_id === null);
check("0 seed graph loaded", Boolean(targetNode), `nodes=${before.nodes.length}`);
// 서브프로세스 노드가 있으면 ④(타입·링크 보존)도 같이 검증 — 없으면 뒤에서 SKIP 처리
const subprocessNode = before.nodes.find((n) => n.node_type === "subprocess" && n.linked_map_id !== null) ?? null;
if (!targetNode) {
  console.error("FATAL seed graph has no non-start/end node to match against");
  await browser.close();
  process.exit(1);
}

// AI 응답 mock — 기존 노드 제목 에코(+서브프로세스 있으면 그것도) + 신규 1개.
// AI_NODE_TYPES(start/process/decision/end) 밖의 타입은 실제 AI가 절대 내지 않으므로 echo node_type은
// 항상 "process"로 둔다 — 매칭은 title 기준이라 무관하고, 서브프로세스는 mergeNode가 기존 타입을 강제 보존한다.
// start/end는 buildGraphFromAiProposal이 proposal.nodes 안에 있어야만 base에서 재사용한다(누락 시
// 병합 결과에 시작 노드가 0개가 되어 백엔드 validate_process가 422로 거부) — 반드시 echo한다.
const proposalNodes = [
  { key: "start", title: "Start", node_type: "start", description: "", attributes: null, group_key: null },
  { key: "a", title: targetNode.title, node_type: "process", description: "", attributes: null, group_key: null },
];
const proposalEdges = [{ source: "start", target: "a", label: "" }];
if (subprocessNode) {
  proposalNodes.push({
    key: "s",
    title: subprocessNode.title,
    node_type: "process",
    description: "",
    attributes: null,
    group_key: null,
  });
  proposalEdges.push({ source: "a", target: "s", label: "" });
}
proposalNodes.push({ key: "b", title: "AI Verify Added", node_type: "process", description: "", attributes: null, group_key: null });
proposalEdges.push({ source: subprocessNode ? "s" : "a", target: "b", label: "" });
proposalNodes.push({ key: "end", title: "End", node_type: "end", description: "", attributes: null, group_key: null });
proposalEdges.push({ source: "b", target: "end", label: "" });

const proposal = {
  kind: "graph",
  message: "polish",
  nodes: proposalNodes,
  edges: proposalEdges,
  groups: [],
  ops: [],
  steps: [],
  findings: [],
  session_id: null,
};
await page.route("**/ai/chat", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(proposal) }),
);

// AI 패널 열고 전송 (패널 토글 → 입력창 → 전송 버튼)
await page.locator('button[title="AI 도우미"], button[title="AI assistant"]').first().click();
await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 8000 });
const chatInput = page.locator('textarea[maxlength="2000"]');
await chatInput.fill("폴리싱해줘");
await chatInput.locator("xpath=following-sibling::button").click();

// ① Import 탭 프리뷰 진입
await page.waitForSelector('[data-id="csv-import-tab"]', { timeout: 10000 });
check("1 import tab opened for AI graph proposal", true);

// ③ 챗 graph 카드 안내 푸터
const cardText = await page.locator('[data-id="ai-proposal-card"]').last().innerText().catch(() => "");
check("3 chat card shows import-tab notice", /Import tab|Import 탭/.test(cardText), cardText.slice(0, 80));

// ② Apply → 매칭 노드 id 불변 + 신규 추가
await page.locator('[data-id="csv-import-apply"]').click();
const applyClosed = await page
  .waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("2 apply closed the import tab (save succeeded)", applyClosed);
const after = await (
  await ctx.request.get(`${BASE}/api/versions/${vid}/graph`, { headers: { "X-Dev-User": DEV_USER } })
).json();
const kept = after.nodes.find((n) => n.id === targetNode.id);
check("2a matched node id preserved after apply", Boolean(kept), targetNode.id);
check("2b new node added", after.nodes.some((n) => n.title === "AI Verify Added"));

// ④ 서브프로세스 노드는 AI가 "process"로 에코해도 node_type·linked_map_id 보존 (mergeNode 규칙)
if (subprocessNode) {
  const keptSub = after.nodes.find((n) => n.id === subprocessNode.id);
  check(
    "4 subprocess node keeps type and link after AI merge",
    keptSub?.node_type === "subprocess" && keptSub?.linked_map_id === subprocessNode.linked_map_id,
    `type=${keptSub?.node_type} linked_map_id=${keptSub?.linked_map_id}`,
  );
} else {
  console.log("SKIP 4 subprocess preservation — seed map has no subprocess node");
}

check("5 no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await ctx.request.delete(`${BASE}/api/versions/${vid}/checkout`, { headers: { "X-Dev-User": DEV_USER } }).catch(() => {});
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
