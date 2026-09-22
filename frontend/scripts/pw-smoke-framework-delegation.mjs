// 트랙 C 마감 스모크(Task 9) — 레벨 위임 스코프 + 배치 현황판(Status) + 홈 레벨 요약 카드 + 배타.
// pw-smoke-framework-admin.mjs(카테고리 CRUD)·pw-smoke-framework-canvas.mjs(게이트 체크리스트)와
// 관심사가 달라 신규 파일로 분리(브리프 §Files 판단) — 여기는 Task 4/6/7/8 결과물만 다룬다.
// 시드는 두 스크립트와 동일(인터뷰 샘플 웹 임포트, 멱등) + 위임 검증용 CategoryPermission 1건을
// 서버 API로 직접 심는다(설정 화면 UI를 통하지 않음 — 대상 계정 login_id는 실행 시점에 directory에서 뽑는다).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3003 SHOT_DIR=/tmp/bpm-track-c-verify node scripts/pw-smoke-framework-delegation.mjs
// 전제: backend+frontend 네이티브 기동, reset_db 직후(카테고리 0건) + DEV_ENFORCE_PERMISSIONS=true
// BPM_SYSADMINS=admin.sys — 기본값(enforce=false)은 전원 sysadmin 바이패스라 위임 스코프 자체를
// 재현할 수 없다(docs/lessons 아님, memory local-permission-sim-demo 관례).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-track-c-verify";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

// 인터뷰 샘플 고정값 — pw-smoke-framework-canvas.mjs와 동일 소스
const L1 = "EPCV";
const L2 = "Facility"; // 위임 대상 seed(=권한 부여 카테고리) 겸 서브트리 확정 요약 검증 대상
const L5_LEAF = "Calibration 수행 및 결과 보고"; // calibration-l5.json의 리프
// 홈 드릴다운은 한 레벨씩 내려간다 — L1..L4를 거쳐야 L5 카드가 나온다
const CHAIN = [L1, L2, "계측 보전", "Calibration 기획 및 운영", L5_LEAF];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

// 홈 드릴다운 행(하위 열 L1~L4)·형제 열은 이름 텍스트로 고른다 — 한 레벨만 렌더되므로 오매칭이 없다
const rowByName = (page, name) => page.locator('[data-id^="framework-row-"]').filter({ hasText: name });
const sibByName = (page, name) => page.locator('[data-id^="framework-sib-"]').filter({ hasText: name });

// 레벨 배지 — 요약 카드 헤더의 첫 LevelPill(data-level). 헤더 경로 칩도 같은 틴트 배경이라
// 클래스로는 못 가른다(2026-09-09 헤더 재구성).
const levelBadgeText = (page) =>
  page.locator('[data-id="category-summary-card"] [data-level]').first().innerText().catch(() => "");

// 요약 카드는 리마운트 없이 크로스페이드(2026-09-21) — 전환 중엔 직전 카테고리 내용이 남는다.
// 배지가 목표 레벨이 될 때까지 기다려 stale 판독을 막는다.
async function waitForSummaryLevel(page, level) {
  for (let i = 0; i < 40; i += 1) {
    if ((await levelBadgeText(page)) === `L${level}`) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// 서버 직접 호출 — X-Dev-User로 신원 지정(devLogin 없이도 dev 모드 인증 통과, admin.sys는
// BPM_SYSADMINS로 실제 sysadmin이어야 임명 게이트를 통과한다: DEV_ENFORCE_PERMISSIONS=true 전제).
async function api(pathname, { method = "GET", user = ADMIN, body } = {}) {
  const res = await fetch(`${BASE}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

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
    window.localStorage.removeItem("bpm.home.frameworkDrill"); // 드릴다운 위치 영속 초기화
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 0) 시드 — 인터뷰 샘플 웹 임포트(멱등, admin/canvas 스모크와 동일 시퀀스) ───
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Categories & import" }).first().click();
  await page.waitForSelector('[data-id="framework-admin-tree"]', { timeout: 8000 });
  await page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"),
    path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await page.locator('[data-id="interview-import-file-1"]')
    .waitFor({ state: "visible", timeout: 5000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  // 실측(2026-09-03 임포트 패널 리팩터 이후): apply는 확인 다이얼로그 없이 바로 적용된다 — 응답을 기다린다.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/categories/import-interview") && r.request().method() === "POST", { timeout: 20000 }),
    page.locator('[data-id="interview-import-apply"]').click(),
  ]);
  const seeded = await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 })
    .then(() => true).catch(() => false);
  check("seeded via interview web import", seeded);

  // ── 1) 설정 > Framework — Manage → Status 전환, 현황판 행/상태 필/Open ────────
  await page.locator('[data-id="framework-view-toggle"] button', { hasText: "Status" }).click();
  await page.waitForSelector('[data-id="framework-overview"]', { timeout: 8000 });
  const overviewRows = page.locator('[data-id^="framework-overview-row-"]');
  await overviewRows.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  const rowCount = await overviewRows.count();
  check("status board renders L5 rows", rowCount >= 2, `rows=${rowCount}`);
  // 상태 셀은 Ready/Blocked 또는 캔버스 미보유 시 "No canvas" — 세 단어 중 하나가 행마다 있어야 한다
  const statusPillCount = await page.locator('[data-id="framework-overview"] td', {
    hasText: /Ready|Blocked|No canvas/,
  }).count();
  check("status board shows a status pill per row", statusPillCount >= rowCount, `pills=${statusPillCount}`);
  // Open은 캔버스가 있는 행에만 — 인터뷰 샘플 0.5 시드엔 캔버스 없는 L5도 섞여 있다
  const noCanvasRows = await page.locator('[data-id="framework-overview"] td', { hasText: "No canvas" }).count();
  const openLinkCount = await page.locator('[data-id^="framework-overview-open-"]').count();
  check("status board shows Open action for linked canvases",
    openLinkCount > 0 && openLinkCount === rowCount - noCanvasRows,
    `open=${openLinkCount} rows=${rowCount} noCanvas=${noCanvasRows}`);
  await shot(page, "settings-status-board");

  // Status → Manage 역전환도 확인(브리프 "Manage↔Status 전환")
  await page.locator('[data-id="framework-view-toggle"] button', { hasText: "Manage" }).click();
  const backToManage = await page.waitForSelector('[data-id="framework-admin-tree"]', { timeout: 5000 })
    .then(() => true).catch(() => false);
  check("Status → Manage toggles back to tree", backToManage);

  // ── 2) 위임 시드 — Facility(L2)에 비-sysadmin 1인을 카테고리 권한자로 지정 ─────
  const rootNodes = (await api("/categories/nodes")).body ?? [];
  const epcvId = rootNodes.find((n) => n.name === L1)?.id;
  const l2Nodes = epcvId !== undefined ? (await api(`/categories/nodes?parent_id=${epcvId}`)).body ?? [] : [];
  const facilityId = l2Nodes.find((n) => n.name === L2)?.id;
  check("resolved EPCV/Facility category ids", epcvId !== undefined && facilityId !== undefined,
    `epcv=${epcvId} facility=${facilityId}`);

  const directory = (await api("/directory")).body ?? { users: [] };
  const delegate = (directory.users ?? []).find((u) => u.id !== ADMIN && u.role !== "admin");
  check("found a non-sysadmin directory user for delegation", Boolean(delegate), delegate?.id ?? "none");

  let delegateScoped = false;
  if (facilityId !== undefined && delegate) {
    const putRes = await api(`/categories/${facilityId}/permissions`, {
      method: "PUT",
      body: { permissions: [{ principal_type: "user", principal_id: delegate.id }] },
    });
    check("granted category permission via API", putRes.status === 200, `status=${putRes.status}`);
    const me = await api("/me", { user: delegate.id });
    delegateScoped = me.body?.category_admin_root_ids?.includes(facilityId) ?? false;
    check("delegate /me reflects category_admin_root_ids", delegateScoped, JSON.stringify(me.body?.category_admin_root_ids));
  }

  // ── 3) 홈 업무 체계 뷰 — L5 카드 선택 → 요약 카드(게이트 필·Open canvas) ──────
  // L5 포커스 드릴다운(2026-09-19) — L1은 형제 열, L2~L4는 하위 열에서 드릴인, L5는 카드(클릭=선택)
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-drill"]', { timeout: 8000 });
  await sibByName(page, CHAIN[0]).first().waitFor({ state: "visible", timeout: 8000 });
  await sibByName(page, CHAIN[0]).first().click();
  await page.locator('[data-id="framework-drill-title"]', { hasText: CHAIN[0] }).waitFor({ timeout: 8000 });
  for (let i = 1; i < 4; i += 1) {
    await rowByName(page, CHAIN[i]).first().click();
    await page.locator('[data-id="framework-drill-title"]', { hasText: CHAIN[i] }).waitFor({ timeout: 8000 });
  }
  const l5Card = page.locator('[data-id^="framework-l5-"]').filter({ hasText: L5_LEAF }).first();
  await l5Card.waitFor({ state: "visible", timeout: 12000 });
  await l5Card.click(); // 카드 클릭 = onSelectCategory(선택)
  const l5CardVisible = await page.locator('[data-id="category-summary-card"]')
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const l5Badge = await waitForSummaryLevel(page, 5);
  // 연계 캔버스 섹션은 L5 요약에만 있는 카드 — 헤더 문구 대신 data-id로 잡는다
  const canvasSection = await page.locator('[data-id="category-summary-canvas"]')
    .isVisible().catch(() => false);
  const gatePill = await page.locator('[data-id="category-summary-card"]').getByText(/Ready|Blocked|No canvas/)
    .first().isVisible().catch(() => false);
  check("L5 category card selects summary card with canvas section + gate pill",
    l5CardVisible && l5Badge && canvasSection && gatePill,
    `card=${l5CardVisible} L5=${l5Badge} canvas=${canvasSection} gate=${gatePill}`);
  await shot(page, "home-summary-card-l5");

  // ── 4) 소속 맵 선택 — 요약 카드와 배타. 맵 목록은 좌측 트리가 아니라 요약 카드의
  // 소속 맵 행(2026-09-19 드릴다운 재구성)이고, 고르면 우측이 맵 상세로 바뀐다 ──────
  const mapRow = page.locator('[data-id="category-summary-map-row"]').first();
  const mapRowFound = await mapRow.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (mapRowFound) {
    await mapRow.click();
    const detailVisible = await page.locator('[data-id="map-detail-category"]:visible').first()
      .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    const summaryGoneAfterMap = (await page.locator('[data-id="category-summary-card"]').count()) === 0;
    check("selecting a map clears the category summary card (exclusive)",
      detailVisible && summaryGoneAfterMap, `detail=${detailVisible} summaryGone=${summaryGoneAfterMap}`);
    await shot(page, "home-map-selected-exclusive");
  } else {
    check("selecting a map clears the category summary card (exclusive)", false, "no map row in the L5 summary");
  }

  // ── 5) L2(상위) 카테고리 선택 → 서브트리 확정 3필. 브레드크럼으로 Facility(L2)까지
  // 올라간다(조상 버튼 = goTo + 선택) ─────────────────────────────────────────────
  await page.locator(`[data-id="framework-crumb-${facilityId}"]`).click();
  await page.locator('[data-id="category-summary-card"]').waitFor({ state: "visible", timeout: 8000 });
  const l2Badge = await waitForSummaryLevel(page, 2);
  const subtreeSection = await page.locator('[data-id="category-summary-card"]').getByText("Subtree confirmation")
    .isVisible().catch(() => false);
  const noOpenCanvasBtn = await page.locator('[data-id="category-summary-open-canvas"]').count();
  check("L2 category row selects summary card with subtree confirm section",
    l2Badge && subtreeSection && noOpenCanvasBtn === 0,
    `L2=${l2Badge} subtree=${subtreeSection} openCanvasBtns=${noOpenCanvasBtn}`);
  await shot(page, "home-summary-card-l2");

  // ── 6) 빈 공간 클릭 — 맵·카테고리 선택 모두 해제, 대시보드로 복귀 ─────────────
  await page.evaluate(() => {
    const el = document.querySelector("div.flex.h-full.min-h-0.flex-col.px-8.py-6");
    el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  const dashboardVisible = await page.locator('[data-id="home-dashboard"]')
    .waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  const noSelectionLeftover =
    (await page.locator('[data-id="category-summary-card"]').count()) === 0;
  check("clicking empty space clears selection back to dashboard", dashboardVisible && noSelectionLeftover);
  await shot(page, "home-empty-click-dashboard");

  // ── 7) 위임 관리자 계정 — 설정 탭 노출 + 자기 서브트리만 렌더 + add-root 없음 ──
  if (delegate && delegateScoped && facilityId !== undefined) {
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await dctx.addInitScript((user) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", "en");
    }, delegate.id);
    const dpage = await dctx.newPage();
    dpage.on("pageerror", (e) => consoleErrors.push(`pageerror(delegate): ${e.message}`));
    await dpage.goto(`${BASE}/settings`, { waitUntil: "networkidle" });

    const frameworkTabVisible = await dpage.getByRole("button", { name: "Categories & import" })
      .first().isVisible().catch(() => false);
    check("delegate sees Categories & import tab", frameworkTabVisible);
    // sysadmin 전용 탭은 숨김 — frameworkAdmin만 부여됐음을 대비 확인(is_sysadmin=false 증거)
    const sysadminOnlyTabsVisible = await dpage.getByRole("button", { name: "Employees" }).count();
    check("delegate does NOT see sysadmin-only tabs (Employees)", sysadminOnlyTabsVisible === 0);

    await dpage.getByRole("button", { name: "Categories & import" }).first().click();
    await dpage.waitForSelector('[data-id="framework-admin-tree"]', { timeout: 8000 });
    const scopedRoots = dpage.locator('[data-id^="framework-admin-node-"]');
    await scopedRoots.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const scopedRootCount = await scopedRoots.count();
    const scopedRootText = scopedRootCount > 0 ? await scopedRoots.first().innerText() : "";
    check("delegate tree shows only own subtree root (Facility)",
      scopedRootCount === 1 && scopedRootText.includes(L2),
      `rootCount=${scopedRootCount} text="${scopedRootText}"`);
    const addRootCount = await dpage.locator('[data-id="framework-admin-add-root"]').count();
    check("delegate has no add-root button (sysadmin-only)", addRootCount === 0);
    await shot(dpage, "delegate-scoped-tree");
    await dctx.close();
  } else {
    check("delegate scope UI check", false, "skipped - permission seed step failed above");
  }

  const errFree = consoleErrors.length === 0;
  check("no page errors", errFree, errFree ? "" : consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
