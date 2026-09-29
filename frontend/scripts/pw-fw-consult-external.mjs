// AI L5 캠페인 외부 참조 타일 스모크(2026-09-29) — 계획 단계 좌측 [외부 L6] 탭의 체계 피커에서 다른 L5의 L6 맵을
// 단계 행에 드래그 → 점선 외부 타일(소속 L5 배지) → 잠금 시 태스크 없음(보드 "외부 참조 1건") → 연결 캔버스에 외부 노드 →
// 등록 문서에 externalTasks. 체계 피커의 맵 수는 펼친 행에서 사라지고 가장 깊은 접힌 행에만 남는다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-external.mjs
// 전제: 가짜 AI(scripts/fake-ai-server.mjs, :9999) + backend(AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS="") + frontend 기동.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const LANG = process.env.PW_LANG ?? "ko"; // 캡처 언어(매뉴얼 ko/en 덱)
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

// ── 시드: 세션 L5(A)와 외부 L5(B, L6 맵 1개 임포트) ─────────────────────────
const tag = Date.now().toString(36);
const chainA = await makeChain(`extA-${tag}`);
const chainB = await makeChain(`extB-${tag}`);
const l5A = chainA[4];
const l5B = chainB[4];
const fullB = await get(`/api/categories/${l5B.id}/chain`);
const categories = fullB.map((c, i) => ({ code: c.code, name: c.name, level: c.level, parent: i === 0 ? null : fullB[i - 1].code }));
const codeB = `${fullB[4].code}-01`;
const EXT_NAME = "OOS 접수";
const doc = {
  schema_version: "0.5-bpm-interface-draft", labelSource: "human-confirmed",
  framework: { categories }, l5: { label: l5B.name, nodeCode: fullB[4].code },
  rows: [{
    taskId: codeB, l6: EXT_NAME, ownerRole: "담당자", department: "", fields: {},
    actions: [{ seq: 1, label: "접수", kind: "action" }, { seq: 2, label: "평가", kind: "action" }],
    relations: { edges: [{ src: 1, dst: 2, kind: "seq" }] },
  }],
};
await post("/api/categories/import-interview", { files: [{ name: `extB-${tag}.json`, content: doc }], apply: true });
const mapB = (await get(`/api/categories/${l5B.id}/maps?offset=0&limit=10`)).maps[0];
check("seeded a foreign L5 with one L6 map", Boolean(mapB?.id), `map=${mapB?.id}`);

// ── UI ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(([user, lang]) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", lang); }, [ADMIN, LANG]);
const page = await ctx.newPage();
const session = await post("/api/framework-interviews", { category_id: l5A.id, brief: "외부 참조 스모크" });
await page.goto(`${BASE}/framework/consult/${session.id}`);
await page.locator('[data-id="fw-consult-brief"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-1"]').waitFor({ timeout: 20000 });

// 좌측 [외부 L6] 탭 → 체계 피커 → B 체인을 L5까지 펼친다
await page.locator('[data-id="fw-consult-left-tab-external"]').click();
await page.locator('[data-id="fw-consult-external-finder"]').waitFor({ timeout: 10000 });
// 피커는 자식이 하나뿐인 가지를 자동으로 펼친다 — 이미 펼쳐진 행은 건너뛴다(다시 누르면 접힌다)
for (const node of chainB) {
  const row = page.locator(`[data-id="framework-picker-node-${node.id}"]`);
  await row.waitFor({ timeout: 15000 });
  await page.waitForTimeout(200);
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}
const mapRow = page.locator(`[data-id="framework-picker-map-${mapB.id}"]`);
await mapRow.waitFor({ timeout: 15000 });
check("picker shows the foreign L6 map row", true);
// 펼친 조상(L1~L4)에는 맵 수가 없고, 접힌 형제/깊은 행에만 남는다
const openCounts = await Promise.all(chainB.slice(0, 4).map((n) => page.locator(`[data-id="framework-picker-count-${n.id}"]`).count()));
check("expanded ancestors hide their map count", openCounts.every((c) => c === 0), openCounts.join(","));

// 드래그 → 2단계 행(검토 승인 옆)에 외부 타일
const stageRow = page.locator('[data-id="fw-consult-plan-stage-1"]');
await mapRow.dragTo(stageRow, { targetPosition: { x: 400, y: 20 } });
const extTile = page.locator('[data-id="fw-consult-plan-cards"] [data-external]');
const dropped = await extTile.first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("dropping a picker row creates an external tile", dropped);
if (!dropped) { await browser.close(); console.log(`${results.filter(Boolean).length}/${results.length}`); process.exit(1); }
check("external tile carries the origin L5 badge", (await page.locator('[data-id^="fw-consult-plan-external-origin-"]').first().innerText()).includes(l5B.name));
check("the tile sits in the second stage row", (await stageRow.locator("[data-external]").count()) === 1);
check("inspector shows the external card as read-only", await page.locator('[data-id="fw-consult-plan-detail-external"]').isVisible());
await page.screenshot({ path: "../.shots/fw-consult-external-plan.png" });

// 잠금 → 태스크는 내부 카드 2장, 보드에 외부 참조 1건
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor({ timeout: 20000 });
check("external tile does not become a task", (await page.locator('[data-id="fw-consult-task-list"] li').count()) === 2);
check("board summarizes one external reference", (await page.locator('[data-id="fw-consult-external-count"]').innerText()).includes("1"));
const locked = await get(`/api/framework-interviews/${session.id}`);
const extCard = locked.plan.find((c) => c.mode === "external");
check("locked plan keeps the external card with a ref id", Boolean(extCard?.task_id?.startsWith("ext-")), extCard?.task_id);

// 설문 2장 제출 → 연결 단계: 외부 노드가 캔버스에 있고 진입점은 내부 카드
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
const linked = await get(`/api/framework-interviews/${session.id}`);
check("canvas holds a node for the external reference", linked.canvas.nodes.some((n) => n.task_id === extCard.task_id));
check("entry point is an internal card", linked.relations.entry.taskId !== extCard.task_id);
check("the external node is wired by the plan predecessors", linked.relations.edges.some((e) => e.dst === extCard.task_id || e.src === extCard.task_id));
await page.waitForTimeout(500);
await page.screenshot({ path: "../.shots/fw-consult-external-canvas.png" });

// 확정 → 문서의 externalTasks
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor({ timeout: 20000 });
const document = await get(`/api/framework-interviews/${session.id}/document`);
check("assembled document declares the external task", (document.externalTasks ?? []).some((x) => x.refId === extCard.task_id && x.l5.nodeCode === fullB[4].code && x.l6 === EXT_NAME));

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
