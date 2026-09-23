// 기존 L6 학습·정정 스모크(설계 2026-09-22 §2·§3) — 이미 맵이 있는 L5에서 캠페인을 열면
// 기존 맵이 "기존" 카드로 먼저 오고(기본 유지), 카드 단위로 정정 전환할 수 있어야 한다.
// 흐름: API로 L1~L5 체인 + 인터뷰 임포트로 L6 맵 2개 적재 → 관리 트리에서 그 L5 선택 →
// 캠페인 시작 → 계획 제안(기존 칩 2장) → 2번 카드 정정 전환 → 잠금(유지 태스크는 즉시 drawn) →
// 설문 1장 제출 → 연결 확정 → 등록 dry run 리포트에서 변경없음 1·갱신 1.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-existing.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
// 맵 이름을 가짜 AI 계획 카드 이름과 같게 두어 서버 병합이 두 카드를 모두 keep으로 찍게 한다.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
// fake-ai.mjs planJson()이 돌려주는 카드 이름 — 이름이 같아야 merge_existing_cards가 keep으로 찍는다
const L6_NAMES = ["요청 접수", "결과 통보"];

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

async function post(pathname, body) {
  const r = await fetch(`${BACKEND}${pathname}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${await r.text()}`);
  return r.json();
}
async function get(pathname) {
  const r = await fetch(`${BACKEND}${pathname}`, { headers: H });
  if (!r.ok) throw new Error(`${pathname} ${r.status} ${await r.text()}`);
  return r.json();
}

// ── 시드 ① L1~L5 체인 ────────────────────────────────────────────────────────
const tag = Date.now().toString(36);
let parent = null;
let l5 = null;
for (let level = 1; level <= 5; level++) {
  l5 = await post("/api/categories", { name: `exist-L${level}-${tag}`, parent_id: parent });
  parent = l5.id;
}

// ── 시드 ② 인터뷰 임포트로 L6 맵 2개 — 체인은 서버가 준 code로 그대로 적어 새 카테고리를 만들지 않는다
const chain = await get(`/api/categories/${l5.id}/chain`);
const categories = chain.map((c, i) => ({
  code: c.code, name: c.name, level: c.level, parent: i === 0 ? null : chain[i - 1].code,
}));
const codes = L6_NAMES.map((_, i) => `${l5.code}-${String(i + 1).padStart(2, "0")}`);
const doc = {
  schema_version: "0.5-bpm-interface-draft",
  labelSource: "human-confirmed",
  framework: { categories },
  l5: { label: l5.name, nodeCode: l5.code },
  rows: L6_NAMES.map((name, i) => ({
    taskId: codes[i],
    l6: name,
    ownerRole: "담당자",
    department: "",
    fields: { start_condition: "요청서 도착" },
    actions: [
      { seq: 1, label: "요청 확인", name: "요청 내용을 확인한다", kind: "action" },
      { seq: 2, label: "완결성 판정", name: "서류가 충분한지 판정한다", kind: "decision" },
      { seq: 3, label: "접수 등록", name: "접수 대장에 등록한다", kind: "action" },
    ],
    relations: { edges: [
      { src: 1, dst: 2, kind: "seq" },
      { src: 2, dst: 3, kind: "branch", gateway: "exclusive", condition: "완결" },
    ] },
  })),
};
const applied = await post("/api/categories/import-interview", {
  files: [{ name: `exist-${tag}.json`, content: doc }], apply: true,
});
const createdMaps = (applied.rows ?? []).filter((r) => r.action === "created").length;
check("seeded two existing L6 maps by interview import", createdMaps === 2, `created=${createdMaps}`);

// ── UI ───────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor({ timeout: 15000 });
await page.locator('[data-id="framework-admin-search"]').fill(l5.name);
await page.locator(`[data-id="framework-admin-search-result-${l5.id}"]`).click();
await page.locator(`[data-id="framework-admin-node-${l5.id}"][aria-current="true"]`).waitFor({ timeout: 15000 });
check("L5 with existing maps selected", true);
await page.locator('[data-id="fw-level-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/, { timeout: 20000 });
const sessionId = Number(page.url().split("/").pop());

// 계획 화면 머리의 "이미 있는 L6 n개" 안내
await page.locator('[data-id="fw-consult-existing-note"]').waitFor({ timeout: 15000 });
check("existing L6 note shown on the plan screen", true);

await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-1"]').waitFor({ timeout: 30000 });
const existingChips = await page.locator('[data-id^="fw-consult-plan-existing-"]').count();
check("both plan cards carry the existing chip", existingChips === 2, `chips=${existingChips}`);
// 상세 열(3열)에서 확인 — 삭제는 기존 카드에서 비활성, 모드 세그먼트는 선택한 카드의 것
await page.locator('[data-id="fw-consult-plan-row-0"]').click();
check("existing cards cannot be removed", await page.locator('[data-id="fw-consult-plan-remove"]').isDisabled());

// 2번 카드만 정정으로 전환 — 1번은 유지
await page.locator('[data-id="fw-consult-plan-row-1"]').click();
await page.locator('[data-id="fw-consult-plan-mode-revise"]').click();
await page.waitForTimeout(200);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-existing.png" }).catch(() => undefined);
await page.locator('[data-id="fw-consult-plan-lock"]').click();

// 잠금 직후 — 유지 태스크는 설문 없이 바로 drawn
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 20000 });
const drawnAtLock = await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').count();
const taskCount = await page.locator('[data-id="fw-consult-task-list"] li').count();
check("keep task is drawn at lock, revise task is not", drawnAtLock === 1 && taskCount === 2, `drawn=${drawnAtLock} tasks=${taskCount}`);
const modeChips = await page.locator('[data-id^="fw-consult-task-mode-"]').count();
check("task board shows the keep/revise mode chips", modeChips === 2, `chips=${modeChips}`);

// 정정 카드 설문 1장 제출 → drawn 2
await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 40000 });
await page.locator('[data-id="fw-consult-fill-all"]').click();
await page.locator('[data-id="fw-consult-review"]').click();
await page.locator('[data-id="fw-consult-submit"]').click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-id="fw-consult-task-list"] li[data-status="drawn"]').length >= 2,
  null,
  { timeout: 60000 },
);
check("revise task drawn after one questionnaire", true);

// 연결 → 등록
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
// 연결 단계는 진입 즉시 자동 제안 — 캔버스 엣지가 그려지길 기다린다
// 수평 엣지는 bbox 높이가 0이라 visible 판정이 안 된다 — attached로 기다린다
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 30000 });
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-dryrun"]').click();
await page.locator('[data-id="interview-import-report"]').first().waitFor({ timeout: 40000 });

// 유지한 행은 서명이 같아 변경없음, 정정한 행은 갱신 — 카드 상태 필 텍스트로 읽는다(lang=en)
const keepRow = ((await page.locator(`[data-id="interview-map-${codes[0]}"]`).textContent()) ?? "").trim();
const reviseRow = ((await page.locator(`[data-id="interview-map-${codes[1]}"]`).textContent()) ?? "").trim();
check("kept L6 reported as Unchanged", keepRow.includes("Unchanged"), keepRow.slice(0, 60));
check("revised L6 reported as Updated", reviseRow.includes("Updated"), reviseRow.slice(0, 60));
console.log(`session ${sessionId} · codes ${codes.join(", ")}`);

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
