// consult 라우트 스모크 — API 모킹으로 인사→답변→draw 오버레이→제안 모달→수락→프리뷰 검증
// (speed redesign: 그리기는 /draw 이벤트, 턴 응답 draw_due가 자동 트리거)
// 전제: frontend dev(:3000) 기동. 사용: node scripts/pw-smoke-consult.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = 9101;

const graph = (keys) => ({
  nodes: keys.map((k, i) => ({
    key: k, title: `step ${i}`, node_type: i === 0 ? "start" : i === keys.length - 1 ? "end" : "process",
    description: "", attributes: null, group_key: null,
  })),
  edges: keys.slice(1).map((k, i) => ({ source: keys[i], target: k, label: "" })),
  groups: [],
});

const state = {
  id: 1, map_id: MAP_ID, version_id: 501, status: "active", current_stage: "scope", lang: "ko",
  facts: {}, working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-23T10:00:00+09:00", base_graph_updated_at: "2026-07-23T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "안녕하세요, 컨설턴트입니다.", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:00:00+09:00" }],
};

// 턴 1 — 빠른 Q&A 응답: 질문 + draw_due 신호(프론트가 자동으로 /draw 호출)
const afterAnswer = {
  ...state,
  facts: { scope: { process_name: "구매" } },
  draw_due: "multi",
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer", content: "구매 프로세스", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "question", content: "활동 골격을 그려볼게요.", payload: null, stage: "activities", superseded: false, created_at: "2026-07-23T10:01:05+09:00" }],
};

// draw 응답 — 제안 3안(choices 메시지 + pending)
const afterDraw = {
  ...afterAnswer,
  draw_due: null,
  messages: [...afterAnswer.messages,
    { id: 4, seq: 4, role: "consultant", kind: "choices", content: "안을 준비했습니다 — 캔버스에서 골라주세요.", stage: "activities",
      payload: { options: [
        { id: "opt-1", title: "Standard", summary: "6 steps", graph: graph(["s", "a", "e"]) },
        { id: "opt-2", title: "Detailed", summary: "9 steps", graph: graph(["s", "a", "b", "e"]) },
        { id: "opt-3", title: "Compact", summary: "2 steps", graph: graph(["s", "e"]), same_as_current: true },
      ] }, superseded: false, created_at: "2026-07-23T10:01:20+09:00" }],
};

const afterChoice = {
  ...afterDraw, working_graph: graph(["s", "a", "b", "e"]), draw_due: null,
  facts: { scope: { process_name: "구매" }, activities: { activities: ["요청", "비교", "발주"] } },
  checkpoints: [{ stage: "activities", message_seq: 6, working_graph: graph(["s", "e"]), created_at: "2026-07-23T10:02:00+09:00" }],
  messages: [...afterDraw.messages,
    { id: 5, seq: 5, role: "user", kind: "choice", content: "opt-2", payload: { choice_id: "opt-2" }, stage: "activities", superseded: false, created_at: "2026-07-23T10:02:00+09:00" },
    { id: 6, seq: 6, role: "consultant", kind: "question", content: "역할을 알려주세요.", payload: null, stage: "roles", superseded: false, created_at: "2026-07-23T10:02:05+09:00" },
    // 유사 SP 제안(P2) — 캔버스 카드 노출·Dismiss 로컬 숨김 검증용
    { id: 7, seq: 7, role: "consultant", kind: "sp_suggestion", content: "유사 맵을 찾았습니다.",
      payload: { map_id: 777, map_name: "Standard Purchase", node_keys: ["a", "b"], score: 0.8 },
      stage: "roles", superseded: false, created_at: "2026-07-23T10:02:06+09:00" }],
};

// 체크포인트 확정(revert) 후 상태 — 작업본이 스냅샷으로 복원, 해당 체크포인트는 제거
const afterRevert = { ...afterChoice, working_graph: graph(["s", "e"]), checkpoints: [] };

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();
  let turnCount = 0;

  await page.route("**/api/me", (r) => r.fulfill({ json: { login_id: "admin.sys", name: "Admin", ai_enabled: true, manual_url: "", csv_manual_url: "", role: "admin", is_sysadmin: true, can_view_dashboard: true } }));
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Consult Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 501, label: "As-Is", status: "draft", events: [] }] } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/1/turns", async (r) => {
    turnCount += 1;
    if (turnCount === 1) {
      // 응답 유실 재현 — 서버는 커밋(GET이 afterAnswer 반환)했는데 응답만 504 (hardening T5)
      r.fulfill({ status: 504, contentType: "text/plain", body: "gateway timeout" });
      return;
    }
    if (turnCount === 2) {
      r.fulfill({ json: afterAnswer });
      return;
    }
    // 수락 턴은 지연 — 낙관적 반영(응답 전 모달 닫힘·즉시 렌더) 검증용
    await new Promise((resolve) => setTimeout(resolve, 600));
    r.fulfill({ json: afterChoice });
  });
  // draw는 의도적으로 지연 — 진행 오버레이 노출 검증
  await page.route("**/api/interviews/1/draw", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    r.fulfill({ json: afterDraw });
  });
  await page.route("**/api/interviews/1/revert", (r) => r.fulfill({ json: afterRevert }));
  // DELETE=세션 초기화(이후 createOrResume이 초기 state 반환), GET=유실 턴 대조용 반영 상태
  await page.route("**/api/interviews/1", (r) =>
    r.request().method() === "DELETE"
      ? r.fulfill({ status: 204 })
      : r.fulfill({ json: afterAnswer }),
  );
  await page.route("**/api/notifications*", (r) =>
    r.fulfill({ json: [] }),
  );

  await page.goto(`${BASE}/maps/${MAP_ID}/consult`);
  await page.waitForSelector('[data-id="interview-panel"]');
  if (!(await page.textContent('[data-id="interview-panel"]')).includes("컨설턴트")) throw new Error("greeting missing");
  // 스테이지 스킵 버튼 — review 이전 스테이지에선 항상 노출 (2026-07-24 반복 루프 탈출구)
  await page.waitForSelector('[data-id="iv-skip-stage"]');
  // 리디자인(2026-07-26): 스테이지 칩 + 컴포저 카드
  await page.waitForSelector('[data-id="iv-stage-chip"]');
  await page.waitForSelector('[data-id="iv-composer"]');
  // 맵 기준 배지 — 초기(맵 없음)
  const initialBadge = await page.textContent('[data-id="iv-map-baseline"]');
  if (!initialBadge.includes("not drawn")) throw new Error(`unexpected initial baseline: ${initialBadge}`);
  await page.waitForSelector('[data-id="iv-draw"]'); // 수동 Draw map 버튼
  // 글자 크기 Aa 팝오버 (2026-07-26) + 첨부 안내 모달 (2026-07-24 5차 UX)
  await page.click('[data-id="iv-font"]');
  await page.waitForSelector('[data-id="iv-font-pop"]');
  await page.click('[data-id="iv-font-opt-12"]');
  await page.waitForSelector('[data-id="iv-font-pop"]', { state: "detached" });
  await page.click('[data-id="iv-attach"]');
  await page.waitForSelector('[data-id="iv-attach-info"]');
  // 복수 파일 주입 → 리뷰 모달(가능 1 + 불가 1 사유) 확인 후 취소 (2026-07-26 복수/폴더 첨부)
  await page.setInputFiles('[data-id="iv-file-input"]', [
    { name: "spec.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from("zip") },
  ]);
  await page.waitForSelector('[data-id="confirm-dialog"]');
  const review = await page.textContent('[data-id="confirm-dialog"]');
  if (!review.includes("1 of 2")) throw new Error("review summary missing");
  if (!review.includes("Unsupported format")) throw new Error("skip reason missing");
  await page.click('[data-id="confirm-dialog-cancel"]');
  await page.waitForSelector('[data-id="confirm-dialog"]', { state: "detached" });

  // 턴 1 — 응답 504 유실: 재조회 대조로 반영 상태를 채택, Retry 미노출 (hardening T5)
  await page.fill('[data-id="iv-input"]', "구매 프로세스");
  await page.click('[data-id="iv-send"]');
  await page.waitForFunction(() =>
    document.querySelector('[data-id="interview-panel"]')?.textContent?.includes("활동 골격"),
  );
  if (await page.$('[data-id="iv-error"]')) throw new Error("delivered turn must not show Retry");

  // 턴 2 — draw_due 자동 트리거 → 진행 오버레이 → 제안 모달 (speed redesign)
  await page.fill('[data-id="iv-input"]', "이대로 진행해줘");
  await page.click('[data-id="iv-send"]');
  await page.waitForSelector('[data-id="iv-draw-overlay"]');
  await page.waitForSelector('[data-id="iv-draw-cancel"]'); // 행 걸림 탈출구 (hardening T13)
  await page.waitForSelector('[data-id="iv-draw-overlay"]', { state: "detached", timeout: 15000 });
  // 아웃라인 패널 — facts 수집 즉시 표시
  const outline = await page.textContent('[data-id="iv-outline"]');
  if (!outline.includes("구매")) throw new Error("outline should show collected facts");
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 3) throw new Error(`expected 3 choice cards, got ${cards.length}`);
  // 3안 레이아웃(2026-07-27): 큰 창 1 + 작은 창 2 + 탭 — 탭 클릭으로 큰 창 교체
  const tabs = await page.$$('[data-id="iv-choice-tab"]');
  if (tabs.length !== 3) throw new Error(`expected 3 choice tabs, got ${tabs.length}`);
  // '현재 맵 유지' 안 배지+워터마크 — same_as_current 옵션 카드 (2026-07-28·30)
  const currentBadges = await page.$$('[data-id="iv-choice-current-badge"]');
  if (currentBadges.length !== 1) throw new Error(`expected 1 same-as-current badge, got ${currentBadges.length}`);
  const currentMarks = await page.$$('[data-id="iv-choice-current-watermark"]');
  if (currentMarks.length !== 1) throw new Error(`expected 1 current watermark, got ${currentMarks.length}`);
  let focusedText = await page.textContent('[data-id="iv-choice-card"][data-focused="true"]');
  if (!focusedText.includes("Standard")) throw new Error("first option should be focused initially");
  await tabs[1].click();
  focusedText = await page.textContent('[data-id="iv-choice-card"][data-focused="true"]');
  if (!focusedText.includes("Detailed")) throw new Error("tab click should focus the second option");

  await page.click('[data-id="iv-choice-card"][data-focused="true"] [data-id="iv-choice-pick"]');
  // 낙관적 수락 — 서버 응답(600ms 지연) 전에 모달이 닫히고 선택 안이 즉시 캔버스에 렌더
  await page.waitForSelector('[data-id="iv-choice-overlay"]', { state: "detached", timeout: 500 });
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__node").length === 4, { timeout: 500 },
  );
  await page.waitForSelector('[data-id="iv-checkpoint-activities"]');
  let nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 4) throw new Error(`expected 4 preview nodes, got ${nodes.length}`);
  // 수락 직후 맵 기준 배지 — up to date
  const badge = await page.textContent('[data-id="iv-map-baseline"]');
  if (!badge.includes("up to date")) throw new Error(`unexpected baseline after accept: ${badge}`);
  // Apply to draft — review 전이라도 맵이 그려져 있으면 노출 (2026-07-28)
  await page.waitForSelector('[data-id="iv-apply"]');

  // 유사 SP 제안 카드(P2) — 노출 확인 후 Dismiss로 로컬 숨김
  await page.waitForSelector('[data-id="iv-sp-card"]');
  const spText = await page.textContent('[data-id="iv-sp-card"]');
  if (!spText.includes("Standard Purchase")) throw new Error("sp card should show target map name");
  await page.click('[data-id="iv-sp-dismiss"]');
  await page.waitForSelector('[data-id="iv-sp-card"]', { state: "detached" });

  // 체크포인트 클릭 = 맵만 프리뷰 → 취소 복귀 → 확정 시 실제 revert (2026-07-27)
  await page.click('[data-id="iv-checkpoint-activities"]');
  await page.waitForSelector('[data-id="iv-cp-preview"]');
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 2);
  await page.click('[data-id="iv-cp-cancel"]');
  await page.waitForSelector('[data-id="iv-cp-preview"]', { state: "detached" });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 4);
  await page.click('[data-id="iv-checkpoint-activities"]');
  await page.waitForSelector('[data-id="iv-cp-preview"]');
  await page.click('[data-id="iv-cp-confirm"]');
  await page.waitForSelector('[data-id="iv-cp-preview"]', { state: "detached" });
  await page.waitForSelector('[data-id="iv-checkpoint-activities"]', { state: "detached" });
  nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 2) throw new Error(`expected 2 nodes after revert, got ${nodes.length}`);

  // 세션 초기화 — 확인 모달 후 abandon + 새 세션(초기 인사)으로 복귀 (2026-07-28)
  await page.click('[data-id="iv-restart"]');
  await page.waitForSelector('[data-id="confirm-dialog"]');
  const restartText = await page.textContent('[data-id="confirm-dialog"]');
  if (!restartText.includes("Start the interview over")) throw new Error("restart dialog missing");
  await page.click('[data-id="confirm-dialog-confirm"]');
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length === 0);
  const resetBadge = await page.textContent('[data-id="iv-map-baseline"]');
  if (!resetBadge.includes("not drawn")) throw new Error(`unexpected baseline after restart: ${resetBadge}`);

  console.log("PW consult smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
