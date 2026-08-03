// consult 라우트 스모크 — word 모드 변형 (pw-smoke-consult.mjs 복제, mode:"word" + 3단계 + 섹션 노드만 변경)
// 전제: frontend dev(:3000) 기동. 사용: node scripts/pw-smoke-consult-word.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = 9102;

// word 맵의 working_graph 섹션 노드 — attributes.section_anchor가 문서 내부 앵커 참조 (design 2026-07-18)
const sectionGraph = {
  nodes: [
    {
      key: "a", title: "1 재고", node_type: "section", description: "",
      attributes: { section_anchor: "_Toc1" }, group_key: null,
    },
  ],
  edges: [],
  groups: [],
};

const state = {
  id: 1, map_id: MAP_ID, version_id: 501, status: "active", current_stage: "draft", mode: "word", lang: "ko",
  working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-23T10:00:00+09:00", base_graph_updated_at: "2026-07-23T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "안녕하세요, 컨설턴트입니다.", payload: null, stage: "draft", superseded: false, created_at: "2026-07-23T10:00:00+09:00" }],
};

// 턴 응답 — 질문 + draw_due 신호(프론트가 자동으로 /draw 호출, speed redesign)
const afterAnswer = {
  ...state,
  draw_due: "multi",
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer", content: "구매 프로세스", payload: null, stage: "draft", superseded: false, created_at: "2026-07-23T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "question", content: "초안을 그려볼게요.", payload: null, stage: "draft", superseded: false, created_at: "2026-07-23T10:01:05+09:00" }],
};

const afterDraw = {
  ...afterAnswer,
  draw_due: null,
  messages: [...afterAnswer.messages,
    { id: 30, seq: 4, role: "consultant", kind: "choices", content: "안을 준비했습니다.", stage: "draft",
      payload: { options: [
        { id: "opt-1", title: "Standard", summary: "6 steps", graph: sectionGraph },
        { id: "opt-2", title: "Detailed", summary: "9 steps", graph: sectionGraph },
      ] }, superseded: false, created_at: "2026-07-23T10:01:10+09:00" }],
};

const afterChoice = {
  ...afterDraw, working_graph: sectionGraph, draw_due: null,
  checkpoints: [{ stage: "draft", message_seq: 6, working_graph: null, created_at: "2026-07-23T10:02:00+09:00" }],
  messages: [...afterDraw.messages,
    { id: 4, seq: 5, role: "user", kind: "choice", content: "opt-1", payload: { choice_id: "opt-1" }, stage: "draft", superseded: false, created_at: "2026-07-23T10:02:00+09:00" },
    { id: 5, seq: 6, role: "consultant", kind: "question", content: "다음 섹션을 확인해 주세요.", payload: null, stage: "review", superseded: false, created_at: "2026-07-23T10:02:05+09:00" }],
};

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
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: {
    id: MAP_ID, name: "Consult Smoke Word", description: "", created_by: null, created_at: "", updated_at: "",
    my_role: "owner", visibility: "public", owning_department: "X", mode: "word",
    doc_sections: [{ anchor: "_Toc1", title: "재고", number: "1", level: 1, language: "ko" }],
    versions: [{ id: 501, label: "As-Is", status: "draft", events: [] }],
  } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/1/turns", (r) => {
    turnCount += 1;
    r.fulfill({ json: turnCount === 1 ? afterAnswer : afterChoice });
  });
  await page.route("**/api/interviews/1/draw", (r) => r.fulfill({ json: afterDraw }));
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
  // word 모드 3단계 검증 — 닷 진행바(consult-progress) li 3개 + 칩 텍스트 "Stage 2 of 3"(draft=index1)
  const dots = await page.$$('[data-id="consult-progress"] li');
  if (dots.length !== 3) throw new Error(`expected 3 stage dots, got ${dots.length}`);
  const chipText = await page.textContent('[data-id="iv-stage-chip"]');
  if (!chipText.includes("Stage 2 of 3")) throw new Error(`expected "Stage 2 of 3" chip, got: ${chipText}`);
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
  if (cards.length !== 2) throw new Error(`expected 2 choice cards, got ${cards.length}`);

  await page.click('[data-id="iv-choice-pick"]');
  await page.waitForSelector('[data-id="iv-checkpoint-draft"]');
  await page.waitForSelector(".react-flow__node");
  const nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 1) throw new Error(`expected 1 preview node, got ${nodes.length}`);
  // 섹션 노드 렌더 — 프리뷰 캔버스에 "1 재고" 텍스트 노출 확인
  const nodeText = await page.textContent(".react-flow__node");
  if (!nodeText.includes("1 재고")) throw new Error(`expected section node text "1 재고", got: ${nodeText}`);

  console.log("PW consult-word smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
