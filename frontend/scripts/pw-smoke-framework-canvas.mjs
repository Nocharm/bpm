// L5 연계 캔버스 스모크 — 트리 L5 행 Linkage 버튼→캔버스 생성·소속 L6 시드(Start 없음)→
// FrameworkChip(캔버스 소스)→S 단축키 트리 피커→확정 게이트 체크리스트(통과/위반)→확정(v1.0) 반영.
// 확정 요청 워크플로(kind=fw_confirm)는 BE 10케이스가 커버 — 여기는 게이트 체크리스트·버튼 상태 중심(task-9 결정).
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

  // 게이트 스모크 전용 호출자 — X-Dev-User로 브라우저 세션(ADMIN)과 신원을 맞춰, 그래프 PUT의
  // 체크아웃 점유 검증(graph.py 409)과 확정의 점유 검증(framework_confirm.py 409)을 함께 통과시킨다.
  // 헤더 없는 raw fetch는 settings.dev_user(local-dev)로 떨어져 브라우저가 쥔 점유자와 어긋난다.
  const callApi = (path, opts = {}) =>
    page.evaluate(
      async ({ path, opts, user }) => {
        const res = await fetch(`/api${path}`, {
          ...opts,
          headers: { "Content-Type": "application/json", "X-Dev-User": user, ...(opts.headers ?? {}) },
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      },
      { path, opts, user: ADMIN },
    );

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

  // ── 4b) 게이트 체크리스트 — Approval 탭에 확정 게이트 6종 고정 렌더 + readiness GET 정합 확인 ──
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.waitForSelector('[data-id="framework-gate-checklist"]', { timeout: 8000 });
  await page.waitForTimeout(600); // 마운트 readiness GET 정착 대기 — readiness===null 순간은 "전행 통과"로 오판됨

  const readinessBaseline = (await callApi(`/maps/${mapId}/confirm-readiness`)).body;
  const checklistRowCount = await page.locator('[data-id="framework-gate-checklist"] li').count();
  check("gate checklist renders 6 fixed rows", checklistRowCount === 6, `rows=${checklistRowCount}`);

  const confirmBtnDisabledBaseline = await page.locator('[data-id="framework-confirm-button"]').isDisabled();
  check("confirm button disabled state matches readiness.ready (seed baseline)",
    confirmBtnDisabledBaseline === !readinessBaseline.ready,
    `disabled=${confirmBtnDisabledBaseline} ready=${readinessBaseline.ready} failures=${JSON.stringify(readinessBaseline.failures)}`);
  await shot(page, readinessBaseline.ready ? "gate-checklist-pass" : "gate-checklist-violation-seed");

  // ── 4c) 위반 주입/해소 — placeholder(linked_map_id 없는 subprocess) 노드를 그래프에 임시 추가 ──
  // (S 피커 드래그 대신 그래프 PUT 직접 — 시드의 실제 초기 게이트 상태와 무관하게 결정적으로 위반 1건을 만든다)
  const detailForGraph = (await callApi(`/maps/${mapId}`)).body;
  const draftVersion = detailForGraph.versions.find((v) => v.status === "draft");
  check("draft version resolved for gate injection", Boolean(draftVersion), `draft=${draftVersion?.id}`);

  const originalGraph = (await callApi(`/versions/${draftVersion.id}/graph`)).body;
  const placeholderNode = {
    id: "smoke-gate-placeholder", title: "Smoke Placeholder", node_type: "subprocess",
    linked_map_id: null, placeholder_category_id: detailForGraph.linkage_category_id ?? null,
    pos_x: 900, pos_y: 560, sort_order: 999,
  };
  const putInjected = await callApi(`/versions/${draftVersion.id}/graph`, {
    method: "PUT",
    body: JSON.stringify({ ...originalGraph, nodes: [...originalGraph.nodes, placeholderNode] }),
  });
  check("placeholder node injected into draft graph", putInjected.status === 200, `status=${putInjected.status}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.waitForSelector('[data-id="framework-gate-checklist"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  const readinessViolation = (await callApi(`/maps/${mapId}/confirm-readiness`)).body;
  check("placeholder gate violation detected via readiness GET",
    !readinessViolation.ready && readinessViolation.failures.some((f) => f.code === "placeholder"),
    JSON.stringify(readinessViolation.failures));
  const locateBtnVisible = await page.locator('[data-id="framework-gate-locate-placeholder"]')
    .isVisible().catch(() => false);
  check("checklist shows placeholder violation row with locate CTA", locateBtnVisible);
  const confirmBtnDisabledViolation = await page.locator('[data-id="framework-confirm-button"]').isDisabled();
  check("confirm button disabled while gate is violated", confirmBtnDisabledViolation);
  await shot(page, "gate-checklist-violation-injected");

  const putRestored = await callApi(`/versions/${draftVersion.id}/graph`, {
    method: "PUT",
    body: JSON.stringify(originalGraph),
  });
  check("placeholder node removed, original draft graph restored", putRestored.status === 200, `status=${putRestored.status}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.waitForSelector('[data-id="framework-gate-checklist"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  const readinessResolved = (await callApi(`/maps/${mapId}/confirm-readiness`)).body;
  check("gate violation resolved after removing placeholder",
    readinessResolved.ready === readinessBaseline.ready, JSON.stringify(readinessResolved.failures));
  const confirmBtnDisabledResolved = await page.locator('[data-id="framework-confirm-button"]').isDisabled();
  check("confirm button state restored to baseline", confirmBtnDisabledResolved === confirmBtnDisabledBaseline);

  // ── 5) 확정 — v1.0 스냅샷 생성(앱 프록시 경유 API) 후 재로드로 반영 확인 ────
  const confirm1 = await callApi(`/maps/${mapId}/framework-confirm`, {
    method: "POST",
    body: JSON.stringify({ major: false }),
  });
  check("framework-confirm creates v1.0 snapshot",
    confirm1.status === 200 && confirm1.body.version?.label === "v1.0",
    JSON.stringify(confirm1.body).slice(0, 120));

  // 무변경 재확정 → 409 게이트 (노드 위치 이동은 변경으로 안 침) (2026-08-28 개선)
  const confirm2 = (await callApi(`/maps/${mapId}/framework-confirm`, {
    method: "POST",
    body: JSON.stringify({ major: false }),
  })).status;
  check("no-change reconfirm is rejected (409)", confirm2 === 409, `status=${confirm2}`);

  const detail = await page.evaluate(async (id) => {
    const res = await fetch(`/api/maps/${id}`);
    return res.json();
  }, mapId);
  const statuses = (detail.versions ?? []).map((v) => v.status);
  check("live draft stays editable next to confirmed snapshot",
    statuses.includes("draft") && statuses.includes("confirmed"), statuses.join(","));

  // 재로드 — 캔버스는 confirmed 스냅샷이 있어도 라이브 draft를 기본으로 연다
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const tagAfter = await page.locator('[data-id="framework-l5-tag"]')
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("reload keeps canvas usable (draft-first selection)", tagAfter);
  await shot(page, "canvas-after-confirm");

  // 스냅샷 버전으로 전환해 확정 워터마크 확인 — 버전 드롭다운 대신 URL 파라미터로 직행
  await page.goto(`${BASE}/maps/${mapId}?version=${confirm1.body.version.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 15000 });
  // getByText는 페이지 전역에서 대소문자 구분 없이 매칭될 여지가 있어, 워터마크 span(uppercase 클래스) 텍스트로 특정
  const stamp = await page.locator('span.uppercase', { hasText: "CONFIRMED" }).first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("confirmed snapshot shows CONFIRMED stamp watermark", stamp);
  await shot(page, "confirmed-stamp-watermark");

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
