// L5 연계 캔버스 스모크 — 트리 L5 행 Linkage 버튼→캔버스 생성·소속 L6 시드(Start 없음)→
// FrameworkChip(캔버스 소스)→S 단축키 트리 피커→확정(v1.0) 반영.
// 시드는 pw-smoke-framework.mjs와 동일(인터뷰 샘플 웹 임포트, 멱등).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/shots node scripts/pw-smoke-framework-canvas.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드만.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
// 스크린샷 저장 위치 — 저장소에 떨구지 않도록 기본값도 저장소 밖 (interview-import SHOT_DIR 선례)
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-canvas-smoke";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

// 인터뷰 샘플 고정값 — pw-smoke-framework.mjs와 동일 소스
const CHAIN = ["EPCV", "Facility", "계측 보전", "Calibration 기획 및 운영", "Calibration 수행 및 결과 보고"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];
let shotIndex = 0;
const shot = (page, name) =>
  page.screenshot({ path: path.join(SHOT_DIR, `${String(++shotIndex).padStart(2, "0")}-${name}.png`), fullPage: false });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
    // 트리 펼침 영속이 이전 실행에 남으면 캐스케이드 단언이 헷갈린다 — 매 실행 초기화
    window.localStorage.removeItem("bpm.framework.tree");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 0) 시드 — 인터뷰 샘플 웹 임포트(멱등) ─────────────────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Categories & import" }).first().click();
  await page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"),
    path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await page.locator('[data-id="interview-import-file-list"] > li').nth(1)
    .waitFor({ state: "visible", timeout: 5000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  const seeded = await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 })
    .then(() => true).catch(() => false);
  check("seeded via interview web import", seeded);

  // ── 1) 홈 Framework 뷰 — 캐스케이드 후 L5 행에 Linkage 버튼(호버 노출) ──────
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 8000 });
  // 헤더는 boxed(틴트 박스) 시 li 직계가 아니다 — 버튼 data-id로 직접 잡고 그룹 행에 hover
  const rootBtn = page.locator('[data-id="framework-node"] button').filter({ hasText: CHAIN[0] });
  await rootBtn.first().waitFor({ state: "visible", timeout: 8000 });
  await rootBtn.first().click(); // 캐스케이드 — 맵 있는 가지가 L5까지 자동 펼침
  const linkageBtn = page.locator('[data-id^="framework-linkage-"]').first();
  await linkageBtn.waitFor({ state: "attached", timeout: 12000 });
  const groupRow = linkageBtn.locator("xpath=ancestor::div[contains(@class,'group')][1]");
  await groupRow.hover(); // 버튼은 hidden group-hover:block — 그룹 행 hover로 노출
  const btnVisible = await linkageBtn.isVisible().catch(() => false);
  check("L5 row shows linkage button on hover (can_edit_linkage)", btnVisible);
  await shot(page, "tree-l5-linkage-button");

  // ── 2) 클릭 → 캔버스 생성·이동 — 소속 L6 subprocess 노드 시드, Start/End 없음 ──
  await linkageBtn.evaluate((el) => el.click()); // JS 클릭 — hover 해제 타이밍 무관
  await page.waitForURL(/\/maps\/\d+/, { timeout: 15000 });
  const mapId = Number((page.url().match(/\/maps\/(\d+)/) ?? [])[1]);
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const nodeCount = await page.locator(".react-flow__node").count();
  const startCount = await page.locator(".react-flow__node", { hasText: "Start" }).count();
  check("canvas opens with seeded L6 subprocess nodes, no Start", nodeCount >= 2 && startCount === 0,
    `nodes=${nodeCount} start=${startCount} mapId=${mapId}`);
  await shot(page, "canvas-seeded");

  // ── 3) FrameworkChip — 캔버스는 category_id 없이 linkage_category_id로 렌더 ──
  // 우상단은 L5 map 태그, 좌상단은 L5 탐색기 — FrameworkChip·저장 체크리스트 대체 (2026-08-28 개선)
  const tagVisible = await page.locator('[data-id="framework-l5-tag"]')
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const explorerVisible = await page.locator('[data-id="framework-l5-explorer"]')
    .isVisible().catch(() => false);
  check("L5 tag (top-right) and L5 explorer (top-left) render", tagVisible && explorerVisible,
    `tag=${tagVisible} explorer=${explorerVisible}`);
  // 탐색기 펼침 — 내 위치(현재 L5) 하이라이트 행 노출
  await page.locator('[data-id="l5-explorer-toggle"]').click();
  const hereVisible = await page.locator('[data-id="framework-l5-explorer"] .bg-accent-tint')
    .first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("L5 explorer highlights current position", hereVisible);
  await shot(page, "l5-explorer-open");
  await page.locator('[data-id="l5-explorer-toggle"]').click();

  // ── 4) S 단축키 → 라이브러리 대신 framework 트리 피커 ─────────────────────
  await page.locator(".react-flow").first().click({ position: { x: 60, y: 400 } });
  await page.keyboard.press("s");
  const pickerVisible = await page.locator('[data-id="framework-tree-picker"]')
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("S opens framework tree picker on canvas", pickerVisible);
  if (pickerVisible) {
    // 2026-08-31부터 피커는 열릴 때 "내 위치"(캔버스 결착 L5) 체인까지 자동으로 펼친다 —
    // 먼저 그 결과를 기다리고, 안 되면(구동작·권한 등) 체인을 수동으로 드릴한다.
    // ⚠️ 자동 드릴인이 끝나기 전에 클릭하면 이미 열린 행을 토글로 닫아버려 트리가 사라진다.
    let anyMapRow = await page.locator('[data-id^="framework-picker-map-"]').first()
      .waitFor({ state: "visible", timeout: 12000 }).then(() => true).catch(() => false);
    check("picker auto-drills to the canvas L5 on open", anyMapRow);
    if (!anyMapRow) {
      for (const name of CHAIN) {
        const row = page.locator('[data-id^="framework-picker-node-"]').filter({ hasText: name }).first();
        await row.waitFor({ state: "visible", timeout: 12000 });
        if ((await row.getAttribute("aria-expanded")) !== "true") {
          await row.click();
        }
      }
      anyMapRow = await page.locator('[data-id^="framework-picker-map-"]').first()
        .waitFor({ state: "visible", timeout: 12000 }).then(() => true).catch(() => false);
    }
    check("picker lazy tree reveals L6 map rows", anyMapRow);
    await shot(page, "framework-picker");
  } else {
    check("picker lazy tree reveals L6 map rows", false, "picker not visible");
  }

  // ── 5) 확정 — v1.0 스냅샷 생성(앱 프록시 경유 API) 후 재로드로 반영 확인 ────
  const confirm1 = await page.evaluate(async (id) => {
    const res = await fetch(`/api/maps/${id}/framework-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ major: false }),
    });
    return { status: res.status, body: await res.json() };
  }, mapId);
  check("framework-confirm creates v1.0 snapshot",
    confirm1.status === 200 && confirm1.body.version?.label === "v1.0",
    JSON.stringify(confirm1.body).slice(0, 120));

  // 무변경 재확정 → 409 게이트 (노드 위치 이동은 변경으로 안 침) (2026-08-28 개선)
  const confirm2 = await page.evaluate(async (id) => {
    const res = await fetch(`/api/maps/${id}/framework-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ major: false }),
    });
    return res.status;
  }, mapId);
  check("no-change reconfirm is rejected (409)", confirm2 === 409, `status=${confirm2}`);

  const detail = await page.evaluate(async (id) => {
    const res = await fetch(`/api/maps/${id}`);
    return res.json();
  }, mapId);
  const statuses = (detail.versions ?? []).map((v) => v.status);
  check("live draft stays editable next to published snapshot",
    statuses.includes("draft") && statuses.includes("published"), statuses.join(","));

  // 재로드 — 캔버스는 published 스냅샷이 있어도 라이브 draft를 기본으로 연다
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const tagAfter = await page.locator('[data-id="framework-l5-tag"]')
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("reload keeps canvas usable (draft-first selection)", tagAfter);
  await shot(page, "canvas-after-confirm");

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
