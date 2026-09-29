// 매뉴얼 슬라이드 캡처(사용자 덱, 5차 2026-09-30 기준) — 홈 필터 2줄·연동 액센트 바·비교 눈 아이콘 카드·비교 AI 보고서·
// 연계 캔버스 맵 설정 편집 가능자 탭·엣지 라벨 강조·내보내기. 산출물은 ../.shots/manual/<lang>/ (gitignore).
// 관리자 덱 캡처는 pw-fw-level-actions·pw-fw-admin-layout-shot·pw-fw-consult(-external/-ux/-existing)를 PW_LANG=ko|en으로 돌린 ../.shots/*.png.
// 덱 수술은 docs/manual/slides/build_slides.py, 넘침 검사는 scripts/check-deck-overflow.mjs, PDF는 docs/manual/slides/export-pdf.mjs.
// 실행(frontend/ 에서): PW_LANG=ko BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-manual-shots.mjs
// 전제: reset_db + seed_compare_demo 시드, 가짜 AI(:9999)+backend(AI_ENABLED=true …)+frontend 기동.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const LANG = process.env.PW_LANG ?? "ko";
const OUT = process.env.PW_OUT_DIR ?? `../.shots/manual/${LANG}`;
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const ko = LANG === "ko";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
const api = async (method, p, body) => {
  const r = await fetch(`${BACKEND}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${await r.text()}`);
  return r.json();
};
const shot = async (page, name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.log(`shot ${name}`);
};

// ── 시드 보강: 인터뷰 샘플 Apply → L5 연계 캔버스 + 관리 부서 지정(홈 조직도 "L5 캔버스" 그룹) ──
const sample = JSON.parse(fs.readFileSync("../docs/samples/consultant-interview-sample/utility-l5.json", "utf-8"));
await api("POST", "/api/categories/import-interview", { files: [{ name: "utility-l5.json", content: sample }], apply: true });
const maps = await api("GET", "/api/maps");
const fwMap = maps.find((m) => m.mode === "framework");
check("framework map exists after import", !!fwMap, fwMap?.name);
const dir = await api("GET", "/api/directory");
const depts = dir.departments ?? dir.depts ?? [];
const me = dir.users?.find((u) => u.login_id === ADMIN);
const myDept = depts.find((d) => d.name === me?.department) ?? depts.find((d) => (d.id ?? "").split("/").length >= 3) ?? depts[0];
if (fwMap?.linkage_category_id && myDept) {
  await api("PATCH", `/api/categories/${fwMap.linkage_category_id}`, { admin_department: myDept.id ?? myDept.name });
  check("L5 admin department set", true, myDept.id ?? myDept.name);
}

// 라벨 있는 엣지·디시전이 있는 일반 맵 고르기(흐름 하이라이트·내보내기 캡처용)
let flowPick = null;
for (const m of maps.filter((m) => m.mode !== "framework" && !m.name.includes("비교 데모")).slice(0, 30)) {
  const versions = (await api("GET", `/api/maps/${m.id}`)).versions ?? [];
  const v = versions.find((x) => x.status === "published") ?? versions[0];
  if (!v) continue;
  const g = await api("GET", `/api/versions/${v.id}/graph`);
  const labeled = (g.edges ?? []).filter((e) => (e.label ?? "").trim()).length;
  const decisions = (g.nodes ?? []).filter((n) => n.node_type === "decision").length;
  const score = labeled * 2 + decisions + Math.min(g.nodes?.length ?? 0, 12) / 12;
  if (decisions && labeled && (!flowPick || score > flowPick.score)) flowPick = { map: m, version: v, graph: g, score };
}
check("flow map picked", !!flowPick, flowPick ? `${flowPick.map.name} v${flowPick.version.id}` : "");
const compareMap = maps.find((m) => m.name.includes("비교 데모"));
check("compare demo map present", !!compareMap);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1456, height: 837 }, deviceScaleFactor: 1 });
await ctx.addInitScript(([user, lang]) => {
  window.localStorage.setItem("bpm.devUser", user);
  window.localStorage.setItem("bpm.lang", lang);
}, [ADMIN, LANG]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 160)));

// ── 1) 홈 필터 2줄 + Type 드롭다운 ──
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.locator('[data-id="home-filter-row-2"]').waitFor({ timeout: 20000 });
const deptBtn = page.locator('[data-id="home-view-toggle"] button').first();
if ((await deptBtn.getAttribute("aria-pressed")) !== "true") await deptBtn.click();
await page.waitForTimeout(600);
// L5 캔버스 그룹이 보이도록 관리 부서 행을 펼친다(있으면)
for (const seg of (myDept?.id ?? "").split("/")) {
  const row = page.locator('[data-id="home-dept-tree"], aside, main').locator("text=" + JSON.stringify(seg)).first();
  if (seg && (await row.count())) await row.click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(400);
await page.locator('[data-id="home-filter-row-2"] button', { hasText: "Type" }).first().click();
await page.waitForTimeout(300);
await shot(page, "home-filters");
await page.keyboard.press("Escape");

// ── 2) 개인 대시보드 연동 액센트 바(호버 0.5s 뒤) ──
const mine = maps.filter((m) => (m.owner_id ?? m.created_by) === ADMIN).map((m) => m.id);
await page.evaluate((ids) => {
  window.localStorage.setItem("bpm.recentMaps", JSON.stringify(ids.map((id, i) => ({ id, at: Date.now() - i * 60000 }))));
}, (mine.length ? mine : maps.map((m) => m.id)).slice(0, 6));
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator('[data-id="home-dashboard"]').waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
const recentRows = page.locator('[data-id="home-recent"] [data-id="dashboard-map-row"]');
let best = { i: 0, linked: -1 };
for (let i = 0; i < (await recentRows.count()); i++) {
  await recentRows.nth(i).hover();
  await page.waitForTimeout(150);
  const linked = await page.locator("[data-linked]").count();
  if (linked > best.linked) best = { i, linked };
}
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await recentRows.nth(best.i).hover();
await page.waitForTimeout(900);
check("linked rows on hover", best.linked > 0, String(best.linked));
await shot(page, "home-linked-hover");

// ── 3) 비교: 노드 표시 정보 카드(눈 아이콘) ──
await page.goto(`${BASE}/maps/${compareMap.id}/compare`, { waitUntil: "domcontentloaded" });
await page.locator(".react-flow__node").first().waitFor({ timeout: 20000 });
await page.waitForTimeout(1200);
await page.locator('[data-id="compare-node-display-float-toggle"]').first().click();
await page.waitForTimeout(400);
await shot(page, "compare-display-card");
await page.locator('[data-id="compare-node-display-float-toggle"]').first().click();
await page.waitForTimeout(300);

// ── 4) 비교: AI 요약 탭(개조식 보고서) ──
await page.locator('[data-id="compare-inspector-tab-ai"]').click();
await page.locator('[data-id="compare-ai-report"]').waitFor({ timeout: 40000 });
await page.waitForTimeout(600);
await shot(page, "compare-ai-report");

// ── 5) 연계 캔버스 맵 설정: 편집 가능자 탭 ──
if (fwMap) {
  await page.goto(`${BASE}/maps/${fwMap.id}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const tab = page.locator("button, a", { hasText: ko ? "편집 가능자" : "Who can edit" }).first();
  await tab.click();
  await page.locator('[data-id="settings-framework-access"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "framework-settings-editors");
}

// ── 6) 에디터: 흐름 하이라이트 + 엣지 라벨 강조 ──
if (flowPick) {
  await page.goto(`${BASE}/maps/${flowPick.map.id}?version=${flowPick.version.id}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  const fit = page.locator('button[title^="화면 맞춤"], button[title^="Fit to view"], .react-flow__controls-fitview').first();
  if (await fit.count()) await fit.click({ force: true });
  await page.waitForTimeout(700);
  const decision = flowPick.graph.nodes.find((n) => n.node_type === "decision");
  const startId = decision.id; // 디시전을 잡고 ]로 나가는 분기(Yes/No 라벨)까지 강조
  await page.locator(`.react-flow__node[data-id="${startId}"]`).click({ position: { x: 8, y: 8 }, force: true });
  await page.waitForTimeout(300);
  await page.keyboard.press("]");
  await page.waitForTimeout(400);
  // 화면 맞춤은 넓은 맵을 36%까지 줄인다 — 선택 노드 위에서 휠로 확대해 하이라이트·라벨이 보이게
  const box = await page.locator(`.react-flow__node[data-id="${startId}"]`).boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // zoomOnScroll=false, zoomActivationKeyCode=Control — 뷰포트 scale을 읽어 0.8 근처까지 조절
    const readScale = () => page.evaluate(() => parseFloat(/scale\(([\d.]+)\)/.exec(document.querySelector(".react-flow__viewport")?.style.transform ?? "")?.[1] ?? "1"));
    await page.keyboard.down("Control");
    for (let i = 0; i < 20; i++) {
      const s = await readScale();
      if (s >= 0.72 && s <= 0.9) break;
      await page.mouse.wheel(0, s < 0.72 ? -60 : 60);
      await page.waitForTimeout(120);
    }
    await page.keyboard.up("Control");
    console.log("zoom scale", await readScale());
  }
  await page.waitForTimeout(500);
  await shot(page, "editor-flow-highlight");

  // ── 7) 에디터: 인스펙터 맵 탭의 내보내기(PNG·Excel·CSV) ──
  await page.keyboard.press("Escape");
  await page.mouse.click(400, 700);
  await page.locator("button", { hasText: ko ? "맵" : "Map" }).filter({ hasNot: page.locator("svg") }).first().click().catch(() => undefined);
  const exp = page.locator('[data-id="export-png"]');
  if (!(await exp.count())) {
    await page.locator('[role="tab"], button', { hasText: ko ? /^맵$/ : /^Map$/ }).first().click().catch(() => undefined);
  }
  await exp.waitFor({ timeout: 10000 });
  await exp.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "editor-export");
}

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
