// AI L5 캠페인 외부 L6 지름길 스모크(2026-09-29) — 계획 보드 빈 영역 우클릭 → [외부 L6 추가...]가 좌측 [외부 L6] 탭을 연다.
// + 로 만든 이름 없는 타일 우클릭 → [외부 L6 목록 보기...] → 체계 피커 모달에서 다른 L5의 L6 맵을 고르면 그 타일이 제자리에서
// 외부 타일로 바뀐다. 연결 단계의 피드백 채팅 최소화 칩은 에디터와 같은 AiChatMinButton(끌기·제자리 클릭 복원).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-external-menu.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const SHOTS = process.env.SHOT_DIR ?? "../docs/qa/screens";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
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
async function makeChain(prefix) {
  const chain = [];
  let parent = null;
  for (let level = 1; level <= 5; level++) {
    const node = await post("/api/categories", { name: `${prefix}-L${level}`, parent_id: parent });
    chain.push(node);
    parent = node.id;
  }
  return chain;
}

// ── 시드: 세션 L5(A)와 외부 L5(B, L6 맵 1개 임포트) — pw-fw-consult-external.mjs와 동일 ─────
const tag = Date.now().toString(36);
const chainA = await makeChain(`extA-${tag}`);
const chainB = await makeChain(`extB-${tag}`);
const l5A = chainA[4];
const l5B = chainB[4];
const fullB = await get(`/api/categories/${l5B.id}/chain`);
const categories = fullB.map((c, i) => ({ code: c.code, name: c.name, level: c.level, parent: i === 0 ? null : fullB[i - 1].code }));
const EXT_NAME = "OOS 접수";
const doc = {
  schema_version: "0.5-bpm-interface-draft", labelSource: "human-confirmed",
  framework: { categories }, l5: { label: l5B.name, nodeCode: fullB[4].code },
  rows: [{
    taskId: `${fullB[4].code}-01`, l6: EXT_NAME, ownerRole: "담당자", department: "", fields: {},
    actions: [{ seq: 1, label: "접수", kind: "action" }, { seq: 2, label: "평가", kind: "action" }],
    relations: { edges: [{ src: 1, dst: 2, kind: "seq" }] },
  }],
};
await post("/api/categories/import-interview", { files: [{ name: `extB-${tag}.json`, content: doc }], apply: true });
const mapB = (await get(`/api/categories/${l5B.id}/maps?offset=0&limit=10`)).maps[0];
check("seeded a foreign L5 with one L6 map", Boolean(mapB?.id), `map=${mapB?.id}`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "ko"); window.localStorage.removeItem("bpm.fwRelationsChatGeom"); }, ADMIN);
const page = await ctx.newPage();
const session = await post("/api/framework-interviews", { category_id: l5A.id, brief: "외부 지름길 스모크" });
await page.goto(`${BASE}/framework/consult/${session.id}`);
await page.locator('[data-id="fw-consult-brief"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-1"]').waitFor({ timeout: 20000 });

// ── 1. 보드 빈 영역 우클릭 → [외부 L6 추가...] → 좌측 [외부 L6] 탭 ─────────────────────────
const board = page.locator('[data-id="fw-consult-plan-cards"]');
const boardBox = await board.boundingBox();
await page.mouse.click(boardBox.x + boardBox.width - 40, boardBox.y + 24, { button: "right" });
const menu = page.locator('[data-id="context-menu"]');
await menu.waitFor({ timeout: 5000 });
const addItem = menu.getByText("외부 L6 추가...");
check("board right-click opens a menu with the external L6 shortcut", await addItem.isVisible());
await page.screenshot({ path: `${SHOTS}/fw-consult-external-board-menu.png` });
await addItem.click();
check("the shortcut opens the left external L6 finder", await page.locator('[data-id="fw-consult-external-finder"]').isVisible());
await page.locator('[data-id="fw-consult-left-tab-brief"]').click();  // 모달의 피커와 셀렉터가 겹치지 않게 탭을 되돌린다

// ── 2. + 로 만든 이름 없는 타일 우클릭 → [외부 L6 목록 보기...] → 모달에서 전환 ────────────
const stage0 = page.locator('[data-id="fw-consult-plan-stage-0"]');
const before = await stage0.locator("[data-flip-key]").count();
await page.locator('[data-id="fw-consult-plan-add-stage-0"]').click();
await page.waitForTimeout(400);
const blankTile = stage0.locator("[data-flip-key]").nth(before);
await blankTile.waitFor({ timeout: 5000 });
const blankKey = await blankTile.getAttribute("data-flip-key");
await blankTile.locator('[role="button"]').click({ button: "right" });
await menu.waitFor({ timeout: 5000 });
const switchItem = menu.getByText("외부 L6 목록 보기...");
check("a blank tile's menu offers the external L6 list", await switchItem.isVisible());
await page.screenshot({ path: `${SHOTS}/fw-consult-external-tile-menu.png` });
await switchItem.click();
const modal = page.locator('[data-id="fw-consult-external-modal"]');
await modal.waitFor({ timeout: 5000 });
// 트리는 마운트 뒤 비동기로 온다 — 첫 행이 붙을 때까지 기다린다
const firstNode = modal.locator('[data-id^="framework-picker-node-"]').first();
check("the modal embeds the framework picker", await firstNode.waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
for (const node of chainB) {
  const row = modal.locator(`[data-id="framework-picker-node-${node.id}"]`);
  await row.waitFor({ timeout: 15000 });
  await page.waitForTimeout(200);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}
const mapRow = modal.locator(`[data-id="framework-picker-map-${mapB.id}"]`);
await mapRow.waitFor({ timeout: 15000 });
await mapRow.click();
const cta = page.locator('[data-id="library-peek-add"]');
await cta.waitFor({ timeout: 10000 });
check("the peek CTA reads as a tile switch", (await cta.innerText()).includes("이 타일로 전환"));
await page.screenshot({ path: `${SHOTS}/fw-consult-external-switch-modal.png` });
await cta.click();
await modal.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
const switched = stage0.locator(`[data-flip-key="${blankKey}"] [data-external]`);
const became = await switched.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
check("picking a map switches the same tile into an external tile in place", became);
check("the switched tile shows the foreign L5 badge", became && (await stage0.locator(`[data-flip-key="${blankKey}"] [data-id^="fw-consult-plan-external-origin-"]`).innerText()).includes(l5B.name));
check("the stage still holds the same number of tiles", (await stage0.locator("[data-flip-key]").count()) === before + 1);
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/fw-consult-external-switched.png` });

// ── 3. 잠금 → 설문 → 연결 단계: 채팅 최소화 칩(에디터와 같은 AiChatMinButton) ─────────────
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor({ timeout: 20000 });
async function submitCard() {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 30000 });
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
  await page.waitForTimeout(400);
}
for (let i = 0; i < 4; i++) {
  if (await page.locator('[data-id="fw-consult-relations"]').isVisible().catch(() => false)) break;
  await submitCard().catch(() => undefined);
}
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 90000 });
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 30000 });
await page.waitForTimeout(500);
await page.locator('[data-id="fw-consult-relations"] button[aria-label="최소화"]').first().click();
const chip = page.locator('[data-id="fw-consult-chat-restore"]');
await chip.waitFor({ timeout: 5000 });
const host = await page.locator('[data-id="fw-consult-relations-canvas-host"]').boundingBox();
const chipBox = await chip.boundingBox();
check("minimized chip sits at the editor default (top-left 16px)", Math.abs(chipBox.x - host.x - 16) < 2 && Math.abs(chipBox.y - host.y - 16) < 2, `${Math.round(chipBox.x - host.x)},${Math.round(chipBox.y - host.y)}`);
check("the chip is the shared sparkle button", (await chip.locator("svg.lucide-sparkles").count()) === 1);
await page.screenshot({ path: `${SHOTS}/fw-consult-chat-min-chip.png` });
// 끌기 — 칩이 따라오고 창은 펴지지 않는다
await page.mouse.move(chipBox.x + 22, chipBox.y + 22);
await page.mouse.down();
await page.mouse.move(chipBox.x + 122, chipBox.y + 82, { steps: 8 });
await page.mouse.move(chipBox.x + 222, chipBox.y + 162, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const moved = await chip.boundingBox();
check("dragging moves the chip without restoring the window", moved && Math.round(moved.x - chipBox.x) === 200 && Math.round(moved.y - chipBox.y) === 140 && (await chip.count()) === 1, `${moved ? Math.round(moved.x - chipBox.x) : "-"},${moved ? Math.round(moved.y - chipBox.y) : "-"}`);
// 제자리 클릭 — 창이 칩 자리에서 펴진다
await chip.click();
await chip.waitFor({ state: "hidden", timeout: 5000 });
const feedbackChat = page.locator('[data-id="fw-feedback-chat"]');
check("clicking the chip restores the chat window", await feedbackChat.isVisible());
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/fw-consult-chat-restored.png` });

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
