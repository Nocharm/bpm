// consult 라우트 스모크 — API 모킹으로 인사→답변→선택지→선택→프리뷰 갱신 검증
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
  working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-23T10:00:00+09:00", base_graph_updated_at: "2026-07-23T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "안녕하세요, 컨설턴트입니다.", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:00:00+09:00" }],
};

const afterAnswer = {
  ...state,
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer", content: "구매 프로세스", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "choices", content: "안을 골라주세요.", stage: "activities",
      payload: { options: [
        { id: "opt-1", title: "Standard", summary: "6 steps", graph: graph(["s", "a", "e"]) },
        { id: "opt-2", title: "Detailed", summary: "9 steps", graph: graph(["s", "a", "b", "e"]) },
        { id: "opt-3", title: "Compact", summary: "2 steps", graph: graph(["s", "e"]) },
      ] }, superseded: false, created_at: "2026-07-23T10:01:05+09:00" }],
};

const afterChoice = {
  ...afterAnswer, working_graph: graph(["s", "a", "b", "e"]),
  checkpoints: [{ stage: "activities", message_seq: 5, working_graph: graph(["s", "e"]), created_at: "2026-07-23T10:02:00+09:00" }],
  messages: [...afterAnswer.messages,
    { id: 4, seq: 4, role: "user", kind: "choice", content: "opt-2", payload: { choice_id: "opt-2" }, stage: "activities", superseded: false, created_at: "2026-07-23T10:02:00+09:00" },
    { id: 5, seq: 5, role: "consultant", kind: "question", content: "역할을 알려주세요.", payload: null, stage: "roles", superseded: false, created_at: "2026-07-23T10:02:05+09:00" }],
};

// 체크포인트 확정(revert) 후 상태 — 작업본이 스냅샷으로 복원, 해당 체크포인트는 제거.
// message_seq(5) 이후 메시지가 없으므로 superseded 변화는 없음(실 백엔드와 동일 규칙).
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
  await page.route("**/api/interviews/1/turns", (r) => {
    turnCount += 1;
    r.fulfill({ json: turnCount === 1 ? afterAnswer : afterChoice });
  });
  await page.route("**/api/interviews/1/revert", (r) => r.fulfill({ json: afterRevert }));
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

  await page.fill('[data-id="iv-input"]', "구매 프로세스");
  await page.click('[data-id="iv-send"]');
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 3) throw new Error(`expected 3 choice cards, got ${cards.length}`);
  // 3안 레이아웃(2026-07-27): 큰 창 1 + 작은 창 2 + 탭 — 탭 클릭으로 큰 창 교체
  const tabs = await page.$$('[data-id="iv-choice-tab"]');
  if (tabs.length !== 3) throw new Error(`expected 3 choice tabs, got ${tabs.length}`);
  let focusedText = await page.textContent('[data-id="iv-choice-card"][data-focused="true"]');
  if (!focusedText.includes("Standard")) throw new Error("first option should be focused initially");
  await tabs[1].click();
  focusedText = await page.textContent('[data-id="iv-choice-card"][data-focused="true"]');
  if (!focusedText.includes("Detailed")) throw new Error("tab click should focus the second option");

  await page.click('[data-id="iv-choice-card"][data-focused="true"] [data-id="iv-choice-pick"]');
  await page.waitForSelector('[data-id="iv-checkpoint-activities"]');
  await page.waitForSelector(".react-flow__node");
  let nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 4) throw new Error(`expected 4 preview nodes, got ${nodes.length}`);

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

  console.log("PW consult smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
