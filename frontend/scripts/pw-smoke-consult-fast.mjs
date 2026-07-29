// 패스트트랙 스모크 — 인사 보기 → 첨부 → 자동 범위 턴 → 이대로 그리기(fast-forward) → multi draw
// 전제: frontend dev(:3000) 기동. 사용: node scripts/pw-smoke-consult-fast.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = 9102;

const graph = (keys) => ({
  nodes: keys.map((k, i) => ({
    key: k, title: `step ${i}`, node_type: i === 0 ? "start" : i === keys.length - 1 ? "end" : "process",
    description: "", attributes: null, group_key: null,
  })),
  edges: keys.slice(1).map((k, i) => ({ source: keys[i], target: k, label: "" })),
  groups: [],
});

const state = {
  id: 2, map_id: MAP_ID, version_id: 601, status: "active", current_stage: "scope", lang: "en",
  facts: {}, working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-29T10:00:00+09:00", base_graph_updated_at: "2026-07-29T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "Hello, I'm your process consultant.",
    payload: { options: ["Draw from a document"] }, stage: "scope", superseded: false, created_at: "2026-07-29T10:00:00+09:00" }],
};

const afterScopeTurn = {
  ...state,
  facts: { scope: { process_name: "Purchasing", purpose: "standardize", boundaries: "req~po" } },
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer",
      content: "I'd like to draw the process map from this document. Please propose the name, purpose, and scope first.",
      payload: null, stage: "scope", superseded: false, created_at: "2026-07-29T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "question", content: "Here is the proposed scope.",
      payload: { options: ["Draw it as proposed", "I want changes", "Continue the full interview"] },
      stage: "scope", superseded: false, created_at: "2026-07-29T10:01:05+09:00" }],
};

const afterFastForward = {
  ...afterScopeTurn, current_stage: "review", draw_due: "multi",
  checkpoints: [
    { stage: "scope", message_seq: 4, working_graph: null, created_at: "2026-07-29T10:02:00+09:00" },
    { stage: "activities", message_seq: 4, working_graph: null, created_at: "2026-07-29T10:02:00+09:00" },
  ],
  messages: [...afterScopeTurn.messages,
    { id: 4, seq: 4, role: "user", kind: "fast_forward", content: "Draw it as proposed.", payload: null, stage: "scope", superseded: false, created_at: "2026-07-29T10:02:00+09:00" },
    { id: 5, seq: 5, role: "consultant", kind: "notice", content: "Drawing straight from the document.", payload: null, stage: "review", superseded: false, created_at: "2026-07-29T10:02:01+09:00" }],
};

const afterDraw = {
  ...afterFastForward, draw_due: null,
  messages: [...afterFastForward.messages,
    { id: 6, seq: 6, role: "consultant", kind: "choices", content: "Proposals are ready.", stage: "review",
      payload: { options: [
        { id: "opt-7-1", title: "Standard", summary: "10 steps", graph: graph(["s", "a", "b", "e"]) },
        { id: "opt-7-2", title: "Detailed", summary: "14 steps", graph: graph(["s", "a", "b", "c", "e"]) },
      ] }, superseded: false, created_at: "2026-07-29T10:02:20+09:00" }],
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();

  await page.route("**/api/me", (r) => r.fulfill({ json: { login_id: "admin.sys", name: "Admin", ai_enabled: true, manual_url: "", csv_manual_url: "", role: "admin", is_sysadmin: true, can_view_dashboard: true } }));
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Fast Track Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 601, label: "As-Is", status: "draft", events: [] }] } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/2/attachments", (r) => r.fulfill({ json: { id: 11, filename: "sop.txt", mime: "text/plain", size: 5, status: "parsed", error: null, created_at: "2026-07-29T10:00:30+09:00" } }));
  await page.route("**/api/interviews/2/turns", (r) => r.fulfill({ json: afterScopeTurn }));
  await page.route("**/api/interviews/2/fast-forward", (r) => r.fulfill({ json: afterFastForward }));
  await page.route("**/api/interviews/2/draw", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    r.fulfill({ json: afterDraw });
  });
  await page.route("**/api/interviews/2", (r) =>
    r.request().method() === "DELETE" ? r.fulfill({ status: 204 }) : r.fulfill({ json: afterScopeTurn }),
  );
  await page.route("**/api/notifications*", (r) => r.fulfill({ json: [] }));

  await page.goto(`${BASE}/maps/${MAP_ID}/consult`);
  await page.waitForSelector('[data-id="interview-panel"]');

  // 1) 인사 보기 클릭 → 첨부 안내 모달(턴 소비 없음)
  await page.click('[data-id="iv-question-option"]:has-text("Draw from a document")');
  await page.waitForSelector('[data-id="iv-attach-info"]');

  // 2) 파일 주입 → 업로드 → 자동 범위 제안 턴 → 확인 보기 노출
  await page.setInputFiles('[data-id="iv-file-input"]', [
    { name: "sop.txt", mimeType: "text/plain", buffer: Buffer.from("purchase process doc") },
  ]);
  await page.waitForSelector('[data-id="iv-question-option"]:has-text("Draw it as proposed")');

  // 3) 이대로 그리기 → fast-forward → 자동 multi draw → 오버레이 → 복수안 모달
  await page.click('[data-id="iv-question-option"]:has-text("Draw it as proposed")');
  await page.waitForSelector('[data-id="iv-draw-overlay"]');
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 2) throw new Error(`expected 2 choice cards, got ${cards.length}`);

  console.log("PW consult-fast smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
