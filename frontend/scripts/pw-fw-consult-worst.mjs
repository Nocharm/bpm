// AI L5 캠페인 워스트 케이스 캡처 — 카드 12장(단계 6, 동시 4, 선행 3, 긴 이름)·문항 12개(긴 문장·선택지 12)·행 12활동·
// 연결 12노드+분기/루프·피드백 로그 8건(마크다운)·카드 피드백 5건·등록 리포트 12맵. 화면 밀도·줄바꿈·스크롤 확인용.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-worst.mjs
// 전제: 가짜 AI를 FAKE_AI_WORST=1 로 기동(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1
// AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend. 캡처는 docs/qa/screens/worst/ 에 남긴다.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const OUT = "../docs/qa/screens/worst";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.json();
}
mkdirSync(OUT, { recursive: true });

// L1~L5 + 세션
const tag = Date.now().toString(36);
let parent = null;
let l5 = null;
for (let level = 1; level <= 5; level++) {
  l5 = await api("POST", "/api/categories", { name: `worst-L${level}-${tag}`, parent_id: parent });
  parent = l5.id;
}
const session = await api("POST", "/api/framework-interviews", { category_id: l5.id, lang: "ko" });
const sid = session.id;

// 카드 12장 — 단계 0:{0} 1:{1,2,3,4} 2:{5,6,7} 3:{8,9} 4:{10, 선행 3} 5:{11}
const NAMES = [
  "고객 요청서 접수 및 필수 항목 확인(양식 F-101 기준)",
  "완결성 검토 및 미비 항목 보완 요청",
  "긴급 여부 판정과 영업 부문장 승인 요청",
  "이전 회차 승인 이력 조회",
  "첨부 규격서 대조",
  "견적 산출(원가·조건 반영)",
  "계약 조건 확인(표준 계약 대비 차이 검토)",
  "납기 검토(생산 일정과 재고)",
  "검토 결과 취합 및 리스크 정리",
  "견적서 초안 작성과 내부 승인",
  "결과 통보서 작성 및 고객 통보",
  "고객 회신 접수와 접수 종결 처리",
];
const ROLES = ["담당자", "관리자", "영업 부문장", "담당자", "품질 담당", "영업 담당", "법무 담당", "생산 계획", "관리자", "영업 담당", "담당자", "담당자"];
const DEPTS = ["고객지원", "품질보증", "영업", "고객지원", "품질보증", "영업", "법무", "생산관리", "품질보증", "영업", "고객지원", "고객지원"];
const DEPS = [[], [0], [0], [0], [0], [1, 2], [1, 2], [1, 2], [5, 6, 7], [5, 6, 7], [8, 9, 3], [10]];
const cards = NAMES.map((name, i) => ({
  name, summary: `${name}. 고객사 담당자가 제출한 자료와 이전 회차 이력을 대조하여 누락과 불일치를 찾고, 결과를 다음 단계에 인계한다.`,
  owner_role: ROLES[i], department: DEPTS[i], depends_on: DEPS[i].map((k) => NAMES[k]),
}));
await api("PUT", `/api/framework-interviews/${sid}/plan`, { cards, lock: false, brief: "수주 요청이 접수되어 견적과 계약 조건이 확정되고 고객에게 통보되기까지의 전 과정. 고객지원·품질보증·영업·법무·생산관리가 관여한다." });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/framework/consult/${sid}`);

// ① 계획: 단계 6행, 선행 3개 카드 선택, 한 행 hover
await page.locator('[data-id="fw-consult-plan-card-11"]').waitFor({ timeout: 20000 });
check("12 cards render in 6 stage rows", (await page.locator('[data-id="fw-consult-plan-cards"] [data-stage]').count()) === 7);  // 6 + 새 단계
await page.locator('[data-id="fw-consult-plan-row-10"]').click();
check("fan-in card shows 3 preceding chips", (await page.locator('[data-id="fw-consult-plan-deps"] [data-id^="fw-consult-plan-dep-"]').count()) === 3);
await page.locator('[data-id="fw-consult-plan-stage-1"]').hover();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/worst-plan.png` });
// 드래그 중간 캡처 — 3단계 타일을 1단계 행 위로
const src = await page.locator('[data-id="fw-consult-plan-row-6"]').boundingBox();
const target = await page.locator('[data-id="fw-consult-plan-stage-1"]').boundingBox();
await page.mouse.move(src.x + 60, src.y + 20);
await page.mouse.down();
await page.mouse.move(src.x + 70, src.y + 30, { steps: 3 });
await page.mouse.move(target.x + target.width - 120, target.y + target.height / 2, { steps: 10 });
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/worst-plan-drag.png` });
await page.mouse.move(src.x + 60, src.y + 20, { steps: 6 });
await page.mouse.up();
check("cancelled drag keeps the stage layout", (await page.locator('[data-id="fw-consult-plan-stage-1"] [data-flip-key]').count()) === 4);

// ② 설문(문항 12) — 세로로 긴 뷰포트로 한 장
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 60000 });
await page.setViewportSize({ width: 1440, height: 1500 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/worst-questionnaire.png` });
await page.setViewportSize({ width: 1440, height: 900 });

// 카드 12장 제출 — 4장째 제출 뒤 보드(상태 섞임) 캡처
let submitted = 0;
for (let guard = 0; guard < 40; guard += 1) {
  const which = await Promise.race([
    page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 90000 }).then(() => "questions"),
    page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 90000 }).then(() => "relations"),
  ]).catch(() => "timeout");
  if (which !== "questions") break;
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
  submitted += 1;
  if (submitted === 4) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/worst-board.png` });
  }
  await page.waitForTimeout(400);
}
check("all 12 cards submitted", submitted === 12, `${submitted}`);
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 120000 });
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 60000 });

// ③ 연결 — 피드백 8건(마크다운)을 API로 쌓고 새로고침, 캔버스+플로팅 채팅
const feedbacks = [
  "**긴급 경로**를 하나 더 주세요.\n- 영업 부문장 승인이 있으면 검토를 건너뛰고\n- 없으면 기존 경로",
  "`계약 조건 확인`과 `납기 검토`는 동시에 시작해야 합니다. 둘 다 끝나야 취합으로.",
  "결과 통보 뒤에 고객이 변경을 요청하면 **완결성 검토**로 되돌아가게 루프를 넣어 주세요.",
  "분기 조건 문구를 짧게: \"완결\" / \"미비\" 정도면 됩니다.",
  "### 확인 요청\n1. 견적 산출 앞에 판정이 필요한지\n2. 납기 검토를 병렬로 둘지\n3. 종결 처리 위치",
  "이전 회차 승인 이력 조회는 접수와 **동시에** 시작해도 됩니다(선행 아님).",
  "첨부 규격서 대조 결과가 불일치면 보완 요청으로 가야 합니다. 조건 라벨에 적어 주세요.",
  "마지막으로 시작 트리거를 '고객 요청서 도착(메일)'로 바꿔 주세요.",
];
for (const message of feedbacks) await api("POST", `/api/framework-interviews/${sid}/feedback`, { scope: "relations", message });
await page.reload();
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 60000 });
await page.waitForTimeout(600);
const nodeCount = await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__node').count();
check("relations canvas holds 12 subprocess nodes plus branches", nodeCount >= 14, `${nodeCount} nodes`);
check("chat log shows 8 entries", (await page.locator('[data-id^="fw-feedback-entry-"]').count()) === 8);
await page.screenshot({ path: `${OUT}/worst-relations.png` });

// ④ 카드 패널 — 카드 피드백 5건 뒤 첫 카드 열기(미리보기 12활동 + 채팅)
const current = await api("GET", `/api/framework-interviews/${sid}`);
const first = [...current.tasks].sort((a, b) => a.seq - b.seq)[0];
for (let i = 1; i <= 5; i += 1) await api("POST", `/api/framework-interviews/${sid}/feedback`, { scope: "task", task_pk: first.id, message: `${i}번째 수정 요청: 활동 ${i + 2}의 이름을 더 구체적으로, 입력물에 **첨부 규격서**를 추가해 주세요.` });
await page.reload();
await page.locator(`[data-id="fw-consult-task-${first.id}"]`).click();
await page.locator('[data-id="fw-consult-task-panel"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-task-panel-canvas"] [data-id="scope-preview-pane"] > svg').waitFor({ timeout: 20000 });
await page.setViewportSize({ width: 1440, height: 1500 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/worst-task-panel.png` });
await page.setViewportSize({ width: 1440, height: 900 });
await page.locator('[data-id="fw-consult-task-close"]').click();

// ⑤ 등록 — 12맵 드라이런 리포트
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor({ timeout: 30000 });
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 60000 });
await page.setViewportSize({ width: 1440, height: 1500 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/worst-register.png` });
check("register report rendered for 12 maps", true);

await browser.close();
const failed = results.filter((r) => !r);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
