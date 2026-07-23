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
      ] }, superseded: false, created_at: "2026-07-23T10:01:05+09:00" }],
};

const afterChoice = {
  ...afterAnswer, working_graph: graph(["s", "a", "e"]),
  checkpoints: [{ stage: "activities", message_seq: 5, created_at: "2026-07-23T10:02:00+09:00" }],
  messages: [...afterAnswer.messages,
    { id: 4, seq: 4, role: "user", kind: "choice", content: "opt-1", payload: { choice_id: "opt-1" }, stage: "activities", superseded: false, created_at: "2026-07-23T10:02:00+09:00" },
    { id: 5, seq: 5, role: "consultant", kind: "question", content: "역할을 알려주세요.", payload: null, stage: "roles", superseded: false, created_at: "2026-07-23T10:02:05+09:00" }],
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
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Consult Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 501, label: "As-Is", status: "draft", events: [] }] } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/1/turns", (r) => {
    turnCount += 1;
    r.fulfill({ json: turnCount === 1 ? afterAnswer : afterChoice });
  });
  await page.route("**/api/notifications*", (r) =>
    r.fulfill({ json: [] }),
  );

  await page.goto(`${BASE}/maps/${MAP_ID}/consult`);
  await page.waitForSelector('[data-id="interview-panel"]');
  if (!(await page.textContent('[data-id="interview-panel"]')).includes("컨설턴트")) throw new Error("greeting missing");
  // 스테이지 스킵 버튼 — review 이전 스테이지에선 항상 노출 (2026-07-24 반복 루프 탈출구)
  await page.waitForSelector('[data-id="iv-skip-stage"]');

  await page.fill('[data-id="iv-input"]', "구매 프로세스");
  await page.click('[data-id="iv-send"]');
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 2) throw new Error(`expected 2 choice cards, got ${cards.length}`);

  await page.click('[data-id="iv-choice-pick"]');
  await page.waitForSelector('[data-id="iv-checkpoint-activities"]');
  await page.waitForSelector(".react-flow__node");
  const nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 3) throw new Error(`expected 3 preview nodes, got ${nodes.length}`);

  console.log("PW consult smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
