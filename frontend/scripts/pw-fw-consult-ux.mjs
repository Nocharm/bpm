// AI L5 캠페인 2라운드 UX 스모크 — 좌측 brief 패널·AiButton 쉬머 클래스·단계 행 계획(타일 클릭→상세 편집·Alt+↑ 단계 이동 FLIP·타일 드래그로 새 단계)·
// 카드 추가/삭제 접힘·주관식 [AI 제안] 타이핑→blur 확정→hover 연필·연결 미리보기 분기 마름모(polygon).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-ux.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

// L1~L5 + 세션 — 진입은 API로(관리 패널 진입은 pw-fw-level-actions.mjs가 본다)
const tag = Date.now().toString(36);
let parent = null;
let l5 = null;
for (let level = 1; level <= 5; level++) {
  l5 = await post("/api/categories", { name: `ux-L${level}-${tag}`, parent_id: parent });
  parent = l5.id;
}
const session = await post("/api/framework-interviews", { category_id: l5.id, lang: "en" });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/framework/consult/${session.id}`);

// ① planning — brief 패널이 좌측 보드 자리에, 생성 버튼은 AiButton
const briefPanel = page.locator('[data-id="fw-consult-board"] [data-id="fw-consult-brief-panel"]');
await briefPanel.waitFor({ timeout: 15000 });
check("brief panel lives in the left board while planning", true);
const generate = page.locator('[data-id="fw-consult-generate-plan"]');
check("generate button is an AiButton (shimmer class)", (await generate.getAttribute("class") ?? "").includes("ai-shimmer"));
await generate.click();
await page.locator('[data-id="fw-consult-plan-card-1"]').waitFor({ timeout: 20000 });

// 계획 = 단계 행(depends_on에서 계산, 2026-09-24 시안 확정) — 타일 클릭이 선택, 우측 상세 열에서 편집
const tiles = (stage) => page.locator(`[data-id="fw-consult-plan-stage-${stage}"] [data-flip-key]`);
check("cards land in stage rows by depends_on", (await tiles(0).count()) === 1 && (await tiles(1).count()) === 1, `${await tiles(0).count()} / ${await tiles(1).count()}`);
await page.locator('[data-id="fw-consult-plan-row-1"]').click();
const rowTitle = (await page.locator('[data-id="fw-consult-plan-title-1"]').innerText()).trim();
const detailName = await page.locator('[data-id="fw-consult-plan-detail"] [data-id="fw-consult-plan-name"]').inputValue();
check("clicking a tile opens it in the detail pane", rowTitle === detailName, `${rowTitle} / ${detailName}`);
check("selected tile is highlighted", (await page.locator('[data-id="fw-consult-plan-row-1"]').getAttribute("aria-pressed")) === "true");
check("detail lists the preceding card as a chip", (await page.locator('[data-id="fw-consult-plan-deps"] [data-id^="fw-consult-plan-dep-"]').count()) === 1);
await page.locator('[data-id="fw-consult-plan-detail"] [data-id="fw-consult-plan-name"]').fill(`${detailName} 편집`);
check("detail edits show on the tile", (await page.locator('[data-id="fw-consult-plan-title-1"]').innerText()).trim() === `${detailName} 편집`);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-plan-cards.png" });

// Alt+↑ = 단계 이동: 2단계 카드가 1단계 행으로 올라와 동시 진행이 되고 FLIP transform이 걸린다(rAF 전 동기 측정)
await page.locator('[data-id="fw-consult-plan-row-1"]').focus();
await page.locator('[data-id="fw-consult-plan-row-1"]').press("Alt+ArrowUp");
const flipped = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[data-id="fw-consult-plan-cards"] [data-flip-key]')];
  return items.some((el) => el instanceof HTMLElement && (el.style.transform.startsWith("translate(") || el.style.transition.includes("transform")));
});
check("stage move applies a FLIP transform/transition", flipped);
check("Alt+Up lifts the card into the first stage (parallel)", (await tiles(0).count()) === 2 && (await tiles(1).count()) === 0, `${await tiles(0).count()} / ${await tiles(1).count()}`);
check("the moved tile gets the settle ring", (await page.locator('[data-id="fw-consult-plan-cards"] .plan-tile-settle').count()) === 1);
check("detail shows no preceding card after the lift", (await page.locator('[data-id="fw-consult-plan-deps"] [data-id^="fw-consult-plan-dep-"]').count()) === 0);

// 드래그 — 동시 진행 타일을 점선 새 단계 행으로 끌면 다시 2단계가 된다(선행 = 1단계 카드)
await page.waitForTimeout(450);
const src = await page.locator('[data-id="fw-consult-plan-row-1"]').boundingBox();
const newRow = await page.locator('[data-id="fw-consult-plan-stage-1"]').boundingBox();
await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
await page.mouse.down();
await page.mouse.move(src.x + src.width / 2 + 10, src.y + src.height / 2 + 10, { steps: 3 });
await page.mouse.move(newRow.x + 200, newRow.y + newRow.height / 2, { steps: 8 });
check("drag shows a ghost and highlights the target row", (await page.locator('[data-id="fw-consult-plan-ghost"]').count()) === 1);
await page.mouse.up();
check("dropping on the new-stage row moves the card down a stage", (await tiles(0).count()) === 1 && (await tiles(1).count()) === 1, `${await tiles(0).count()} / ${await tiles(1).count()}`);
check("the dropped card now depends on the first-stage card", (await page.locator('[data-id="fw-consult-plan-deps"] [data-id^="fw-consult-plan-dep-"]').count()) === 1);

// 추가 → 새 단계에 3번째 카드(등장 애니 + 선택), 삭제(상세 열) → 사라짐 애니 뒤 2장
await page.locator('[data-id="fw-consult-plan-add"]').click();
check("add appends a card with the enter animation", (await page.locator('[data-id="fw-consult-plan-card-2"].plan-tile-in').count()) === 1);
check("added card is selected in the detail pane", (await page.locator('[data-id="fw-consult-plan-row-2"]').getAttribute("aria-pressed")) === "true");
check("added card opens a third stage", (await tiles(2).count()) === 1);
await page.locator('[data-id="fw-consult-plan-remove"]').click();
check("remove starts the exit animation", (await page.locator('[data-id="fw-consult-plan-card-2"].plan-tile-out').count()) === 1);
await page.waitForTimeout(400);
check("removed card is gone after the exit animation", (await page.locator('[data-id="fw-consult-plan-cards"] [data-flip-key]').count()) === 2);

// 잠금 → 첫 카드 설문
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 30000 });

// ② 주관식 — 빈칸에서 시작, [AI 제안] 타이핑, 확정 뷰, hover 연필
const q4 = page.locator('[data-id="fw-consult-answer-q4"]');
check("free-text answer starts empty", (await q4.inputValue()) === "");
await page.locator('[data-id="fw-consult-ai-suggest-q4"]').click();
await page.waitForTimeout(120);
const partial = await q4.inputValue();
check("AI suggestion types progressively", partial.length > 0 && partial.length < "요청서 도착".length, JSON.stringify(partial));
await page.screenshot({ path: "../docs/qa/screens/fw-consult-answer-typing.png" });
const view = page.locator('[data-id="fw-consult-answer-view-q4"]');
await view.waitFor({ timeout: 3000 });
check("typed answer commits to the read view", (await view.innerText()) === "요청서 도착");
await view.hover();
await page.waitForTimeout(200);
const pencilOpacity = await page.locator('[data-id="fw-consult-edit-answer-q4"]').evaluate((el) => getComputedStyle(el).opacity);
check("edit pencil shows on hover", pencilOpacity === "1", pencilOpacity);
await page.locator('[data-id="fw-consult-edit-answer-q4"]').click();
check("pencil reopens the textarea with the value", (await q4.inputValue()) === "요청서 도착");

// 제출 2장 → 연결 단계
async function submitCard() {
  await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 20000 });
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
}
await submitCard();
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 30000 });
while (await page.locator('[data-id="fw-consult-questions"]').isVisible().catch(() => false)) {
  await submitCard();
  await page.waitForTimeout(500);
}
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
// 연결 단계는 진입 즉시 자동 제안 — 캔버스 엣지가 그려지길 기다린다
// 수평 엣지는 bbox 높이가 0이라 visible 판정이 안 된다 — attached로 기다린다
await page.locator('[data-id="fw-consult-relations-canvas"] .react-flow__edge').first().waitFor({ state: "attached", timeout: 30000 });

// ③ 분기 노드 마름모 — 행 미리보기(scope=map)에는 decision이 있으므로 카드 미리보기 모달에서 본다.
// 미리보기는 좌측 보드 행의 눈 버튼(연결 단계 우측 카드 목록은 보드와 중복이라 제거됨, 2026-09-23).
const previewBtn = page.locator('[data-id="fw-consult-task-list"] [data-id^="fw-consult-task-preview-"]').first();
await previewBtn.click();
// 줌 버튼 아이콘도 svg라 프리뷰 페인 안으로 좁힌다
const previewSvg = page.locator('[data-id="fw-consult-task-preview-canvas"] [data-id="scope-preview-pane"] > svg');
await previewSvg.waitFor({ timeout: 15000 });
check("L6 preview draws the decision node as a diamond", (await previewSvg.locator("polygon").count()) >= 1);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-relations-diamond.png" });

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
