// 컨설턴트 임포트 후속 2~6 스모크 — 인터뷰 원문 메모(에디터 편집·홈 카드·비교 요약), 노트 CRUD('[' 자동완성),
// SP 지정 타일 모달(팝오버·IO 플라이아웃·원문 메모), SP 노드 참고치 힌트, SP 카드 액션 행 wrap.
// 실행(frontend/ 에서): SCRATCH_DIR=<dir> BASE_URL=http://localhost:3000 node scripts/pw-smoke-import-followups.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드. 샘플 임포트는 이 스크립트가 API로 수행.
import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const SCRATCH = process.env.SCRATCH_DIR ?? "/tmp";
const SAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples/consultant-interview-sample");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: path.join(SCRATCH, `followups-${name}.png`) });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
    window.localStorage.setItem("bpm.inspectorWidth", "320");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
  const api = (p, { method = "GET", body } = {}) =>
    page.evaluate(
      async ({ p, method, body, user }) => {
        const res = await fetch(`/api${p}`, {
          method,
          headers: { "Content-Type": "application/json", "X-Dev-User": user },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${text.slice(0, 200)}`);
        return text ? JSON.parse(text) : null;
      },
      { p, method, body, user: ADMIN },
    );

  // ── 0) 샘플 임포트(API) → 교정 준비 맵·draft·L5 캔버스 확보 ───────────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const files = [];
  for (const name of ["calibration-l5.json", "utility-l5.json"]) {
    files.push({ name, content: JSON.parse(await fs.readFile(path.join(SAMPLE_DIR, name), "utf8")) });
  }
  const imported = await api("/categories/import-interview", { method: "POST", body: { files, apply: true, label: "followups" } });
  const landed = (imported.summary.created ?? 0) + (imported.summary.updated ?? 0) + (imported.summary.unchanged ?? 0);
  check("samples imported via API", imported.applied === true && landed >= 4, `maps=${landed}`);
  const maps = await api("/maps");
  const target = maps.find((m) => m.consultant_code === "smp-cal-task-0001");
  check("교정 준비 map exists with sp_annual_count from delivery", target?.sp_annual_count === "52", `annual=${target?.sp_annual_count}`);
  const detail = await api(`/maps/${target.id}`);
  const draft = detail.versions.find((v) => v.status === "draft") ?? detail.versions[0];
  await api(`/versions/${draft.id}/checkout`, { method: "POST", body: { force: true } });

  // ── 1) 에디터 Map 탭 — 서브프로세스 카드 아래 Interview notes(편집) → Notes ─────
  // 에디터는 폴링 때문에 networkidle이 안 올 수 있다 — DOM 로드 후 노드 렌더를 신호로
  await page.goto(`${BASE}/maps/${target.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button[aria-label="Map"]').first().click();
  await page.waitForSelector('[data-id="map-fallback-notes"]', { timeout: 10000 });
  const fbRows = await page.locator('[data-id^="map-fallback-"][data-id$="_fallback"]').count();
  check("interview notes section lists fallback rows in editor map tab", fbRows >= 3, `rows=${fbRows}`);
  const spCardBox = await page.locator('[data-id="sp-inspector-card"]').boundingBox();
  const fbBox = await page.locator('[data-id="map-fallback-notes"]').boundingBox();
  const notesBox = await page.locator('[data-id="map-notes-section"]').boundingBox();
  check("order: SP card → interview notes → notes", !!spCardBox && !!fbBox && !!notesBox && spCardBox.y < fbBox.y && fbBox.y < notesBox.y);
  await page.locator('[data-id="map-fallback-system_fallback-hint"]').click();
  await page.waitForSelector('[data-id="map-fallback-system_fallback-hint-popover"]', { timeout: 5000 });
  await page.locator('[data-id="map-fallback-system_fallback-hint-edit-btn"]').click();
  await page.locator('[data-id="map-fallback-system_fallback-hint-edit"]').fill("EAM, 수기 대장");
  await page.locator('[data-id="map-fallback-system_fallback-hint-save"]').click();
  const savedOk = await page.locator('[data-id="map-fallback-system_fallback"]').getByText("EAM, 수기 대장")
    .waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("editor saves interview note via PATCH fallback-notes", savedOk);
  await shot(page, "editor-map-tab");

  // ── 2) 노트 CRUD — 추가('[' 자동완성) → 수정 → 삭제 ──────────────────────────
  await page.locator('[data-id="map-notes-add"]').click();
  await page.waitForSelector('[data-id="map-note-form"]', { timeout: 5000 });
  await page.locator('[data-id="map-note-kind-input"]').fill("");
  await page.locator('[data-id="map-note-kind-input"]').type("[");
  const suggestVisible = await page.locator('[data-id="map-note-kind-suggest"]').waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("'[' opens kind suggestions", suggestVisible);
  await page.locator('[data-id="map-note-kind-suggest-voc"]').click();
  await page.locator('[data-id="map-note-title-input"]').fill("현업 요청");
  await page.locator('[data-id="map-note-text-input"]').fill("교정 결과를 당일 공유해 달라는 요청");
  await shot(page, "notes-add-form");
  await page.locator('[data-id="map-note-save"]').click();
  const created = await page.locator('[data-id="map-notes-section"]').getByText("현업 요청").first().waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("note created with VOC kind", created);
  const noteRow = page.locator('[data-id^="map-note-"]').filter({ hasText: "현업 요청" }).first();
  const noteId = (await noteRow.getAttribute("data-id"))?.replace("map-note-", "");
  await noteRow.hover();
  await page.locator(`[data-id="map-note-edit-${noteId}"]`).click();
  await page.locator('[data-id="map-note-text-input"]').fill("당일 공유 요청 (수정)");
  await page.locator('[data-id="map-note-save"]').click();
  const edited = await page.locator('[data-id="map-notes-section"]').getByText("당일 공유 요청 (수정)").first().waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("note edited", edited);
  await noteRow.hover();
  await page.locator(`[data-id="map-note-delete-${noteId}"]`).click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForTimeout(500);
  const gone = (await page.locator(`[data-id="map-note-${noteId}"]`).count()) === 0;
  check("note deleted after confirm", gone);

  // ── 3) SP 지정 모달 — 타일 → 팝오버(Enter 확정) → IO 플라이아웃 → 원문 메모 → 저장 ──
  // 지정/수정은 게시본을 열었을 때만 활성(spCanManage) — 임포트가 게시한 버전으로 이동
  const published = detail.versions.find((v) => v.status === "published");
  await page.goto(`${BASE}/maps/${target.id}?version=${published.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('button[aria-label="Map"]').first().click();
  await page.waitForSelector('[data-id="sp-inspector-card"]', { timeout: 10000 });
  // 카드가 접혀 있을 때만 토글(sessionStorage 영속) — 이미 열려 있으면 토글이 닫아버린다
  if (!(await page.locator('[data-id="sp-inspector-edit"]').isVisible().catch(() => false))) {
    await page.locator('[data-id="sp-inspector-toggle"]').click();
  }
  await page.locator('[data-id="sp-inspector-edit"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 8000 });
  // 섹션 아코디언은 노드 편집 모달과 영속 키를 공유(기본 접힘일 수 있음) — 접힌 섹션은 펼친다
  for (const id of ["sp-designation-attrs-toggle", "sp-designation-params-toggle", "sp-designation-details-toggle"]) {
    const toggle = page.locator(`[data-id="${id}"]`);
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
  await page.waitForSelector('[data-id="sp-tile-duration"]', { timeout: 5000 });
  const tiles = await page.locator('[data-id^="sp-tile-"]:not([data-id*="popover"])').count();
  check("designation modal renders field tiles", tiles >= 9, `tiles=${tiles}`);
  await shot(page, "sp-modal-tiles");
  await page.locator('[data-id="sp-tile-duration"]').click();
  await page.waitForSelector('[data-id="sp-tile-popover-duration"]', { timeout: 5000 });
  await page.locator('[data-id="sp-tile-input-duration"]').fill("2.30");
  await page.locator('[data-id="sp-tile-note-duration"]').fill("한 번에 두 시간 반쯤");
  await shot(page, "sp-popover-duration");
  await page.locator('[data-id="sp-tile-input-duration"]').press("Enter");
  const durTile = await page.locator('[data-id="sp-tile-duration"]').textContent();
  check("Enter commits duration tile (2h30m)", (durTile ?? "").includes("2h30m"), durTile ?? "");
  await page.locator('[data-id="sp-tile-annual_count"]').click();
  await page.waitForSelector('[data-id="sp-tile-popover-annual_count"]', { timeout: 5000 });
  const freqNote = await page.locator('[data-id="sp-tile-note-annual_count"]').inputValue();
  check("annual_count popover carries frequency note from delivery", freqNote.includes("주 1회"), freqNote);
  await page.keyboard.press("Escape");
  await page.locator('[data-id="sp-tile-input"]').click();
  await page.waitForSelector('[data-id="sp-tile-popover-input"]', { timeout: 5000 });
  await shot(page, "sp-io-flyout");
  await page.locator('[data-id="sp-tile-popover-input-commit"]').click();
  const inputTile = await page.locator('[data-id="sp-tile-input"]').textContent();
  check("input tile shows item count", /\d+ items/.test(inputTile ?? ""), inputTile ?? "");
  await page.locator('[data-id="subprocess-designation-save"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 10000 });
  const after = await api(`/maps/${target.id}`);
  check("designation PUT persisted duration and note", after.sp_duration === "2.30" && after.sp_total_time_fallback === "한 번에 두 시간 반쯤", `${after.sp_duration} / ${after.sp_total_time_fallback}`);

  // ── 4) SP 카드 액션 행 — 좁은 인스펙터(320px)에서 버튼 라벨 한 줄 유지 ─────────
  const editBtn = page.locator('[data-id="sp-inspector-edit"]');
  const editBox = await editBtn.boundingBox();
  check("SP card action buttons stay single-line at 320px", !!editBox && editBox.height < 34, `h=${editBox?.height}`);
  await shot(page, "sp-card-narrow");

  // ── 5) 홈 상세 카드 — 읽기 전용 interview notes + notes(오너 추가 버튼) ────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 10000 });
  await page.locator('[data-id="framework-node"] button').filter({ hasText: "EPCV" }).first().click();
  await page.locator('[data-id="framework-tree"] [data-id="map-card"]', { hasText: "교정 준비" }).first().click();
  await page.waitForSelector('[data-id="map-fallback-notes"]:visible', { timeout: 10000 });
  const homeToggle = page.locator('[data-id="map-fallback-notes"]:visible [data-id="map-fallback-notes-toggle"]').first();
  if ((await homeToggle.getAttribute("aria-expanded")) === "false") await homeToggle.click();
  const homeFb = await page.locator('[data-id="map-fallback-notes"]:visible').first().textContent();
  check("home card shows interview notes read-only", (homeFb ?? "").includes("EAM, 수기 대장"));
  const homeAdd = await page.locator('[data-id="map-notes-section"]:visible [data-id="map-notes-add"]').count();
  check("home card notes section offers Add for the owner", homeAdd === 1);
  await shot(page, "home-card");

  // ── 6) 비교 화면 요약 탭 — Interview notes 블록(기본 접힘) ─────────────────
  await page.goto(`${BASE}/maps/${target.id}/compare`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const summaryTab = page.getByRole("button", { name: /summary/i }).first();
  if (await summaryTab.isVisible().catch(() => false)) await summaryTab.click();
  const compareFb = await page.locator('[data-id="compare-summary"] [data-id="map-fallback-notes"]').first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("compare summary has interview notes block", compareFb);
  const collapsed = await page.locator('[data-id="compare-summary"] [data-id="map-fallback-notes-toggle"]').first().getAttribute("aria-expanded");
  check("compare interview notes block starts collapsed", collapsed === "false", `aria-expanded=${collapsed}`);
  await shot(page, "compare-summary");

  // ── 7) L5 연계 캔버스 SP 노드 — annual_count 참고치 힌트 + 카테고리 노트 ───────
  // 연계 캔버스는 홈 목록에 안 실린다 — L5 카테고리로 열기(POST linkage-map: 있으면 반환, 없으면 생성)
  const linkage = await api(`/categories/${detail.category_id}/linkage-map`, { method: "POST" }).catch(() => null);
  const canvasId = linkage?.map_id ?? linkage?.map?.id ?? linkage?.id ?? null;
  const canvas = canvasId ? { id: canvasId } : null;
  if (canvas) {
    const cdetail = await api(`/maps/${canvas.id}`);
    const cver = cdetail.versions.find((v) => v.status === "draft") ?? cdetail.versions[0];
    await page.goto(`${BASE}/maps/${canvas.id}?version=${cver.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".react-flow__node", { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.locator(".react-flow__node").filter({ hasText: "교정 준비" }).first().click();
    const propsTab = page.locator('button[aria-label="Properties"]').first();
    if (await propsTab.isVisible().catch(() => false)) await propsTab.click();
    const toggle = page.locator('[data-id="inspector-params-toggle"]');
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    const refHint = await page.locator('[data-id="inspector-ref-annual_count"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    check("SP node shows designated reference hint for annual_count", refHint);
    await page.locator('[data-id="inspector-ref-annual_count"]').hover();
    await page.waitForTimeout(400);
    await shot(page, "ref-hint");
    await page.locator('button[aria-label="Map"]').first().click();
    const catNotes = await page.locator('[data-id="map-notes-section"]').waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    check("L5 canvas map tab shows category-scope notes", catNotes);
    await page.locator('[data-id="map-notes-toggle"]').click();
    const catRows = await page.locator('[data-id^="map-note-"]').count();
    check("category notes list has rows (entry/flow/open items)", catRows > 0, `rows=${catRows}`);
    await shot(page, "l5-category-notes");
  } else {
    check("L5 linkage canvas found", false, "no framework map");
  }

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
