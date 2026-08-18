// 홈 Framework 뷰 스모크 — 세그먼트 토글·캐스케이드 원클릭 펼침·공용 검색/가시성 필터·펼침 상태 영속
// (localStorage 복원)·상세 카드 경로뱃지/IO·Departments 회귀·새로고침 뷰 유지.
// 시드는 스크립트가 인터뷰 샘플(docs/samples/consultant-interview-sample)을 웹 임포트로 직접 수행(멱등).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-framework.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, reset_db 시드만.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

// 인터뷰 샘플(calibration-l5.json) 고정값 — 어긋나면 샘플이나 여기 둘 중 하나를 고친다.
const L5_PATH = "EPCV/Facility/계측 보전/Calibration 기획 및 운영/Calibration 수행 및 결과 보고";
const CHAIN = ["EPCV", "Facility", "계측 보전", "Calibration 기획 및 운영", "Calibration 수행 및 결과 보고"];
const MAP_NAME = "교정 준비"; // sp_input=교정 작업지시(EAM)·sp_output=준비 목록 보유 맵

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function openContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  return ctx;
}

// framework-node 버튼은 span(카테고리명)+CountTag만 담고, 자식 카테고리의 <ul>은 버튼의 형제라
// hasText가 조상 li까지 오매칭하지 않는다(li 기준이면 자손 텍스트까지 걸려 .first()가 부모를 집는다).
const nodeButton = (page, name) =>
  page.locator('[data-id="framework-node"] > button').filter({ hasText: name });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const ctx = await openContext(browser);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 0) 시드 — 인터뷰 샘플 웹 임포트(멱등: 기적재 상태면 unchanged로 끝) ─────
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

  // ── 1) 홈 진입 — 뷰 토글 노출 ────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: "networkidle" });
  const toggleVisible = await page.locator('[data-id="home-view-toggle"]').isVisible().catch(() => false);
  check("home-view-toggle visible", toggleVisible);

  // ── 2) Framework 클릭 → L1 한 번 클릭 → 캐스케이드로 맵까지 자동 펼침 ──────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 8000 });
  // 루트 카테고리는 마운트 후 비동기 fetch로 채워진다 — isVisible()의 즉시 스냅샷이 아니라
  // waitFor로 도착을 기다려야 한다(즉시 체크는 아직 미도착 시 거짓 FAIL을 낸다).
  const rootVisible = await nodeButton(page, CHAIN[0]).first().waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("framework-tree root category row visible", rootVisible, CHAIN[0]);

  // L1 클릭 1회만 — 맵 있는 가지(map_count>0)가 L5까지 자동 펼쳐져 맵 카드가 바로 보여야 한다.
  await nodeButton(page, CHAIN[0]).first().click();
  const mapCard = page.locator('[data-id="framework-tree"] [data-id="map-card-name"]', { hasText: MAP_NAME });
  const mapVisible = await mapCard.first().waitFor({ state: "visible", timeout: 12000 })
    .then(() => true).catch(() => false);
  check("one-click cascade reveals imported map card (L1→L5)", mapVisible, MAP_NAME);
  const midVisible = await nodeButton(page, CHAIN[3]).first().isVisible().catch(() => false);
  check("cascade auto-opened intermediate levels", midVisible, CHAIN[3]);
  // 직접 보유 맵이 있는 카테고리(L5)는 부서 목록과 같은 틴트 박스로 묶인다 — 맵 카드가 박스 안에 있어야 한다.
  const boxedCard = await page
    .locator('[data-id="framework-group-box"] [data-id="map-card-name"]', { hasText: MAP_NAME })
    .first().isVisible().catch(() => false);
  check("map-holding category renders tint group box", boxedCard);
  // 펼침 진입 애니메이션 — 드러난 영역 래퍼에 accordion-open 키프레임이 실제로 걸려 있어야 한다
  // (computed animationName은 재생 종료 후에도 유지 — 백그라운드 스로틀과 무관).
  const animName = await page.locator(".accordion-open").first()
    .evaluate((el) => getComputedStyle(el).animationName).catch(() => "none");
  check("expand animation keyframes applied", animName === "accordion-open", animName);

  // ── 3) 검색 — Framework 뷰에서도 공용 플랫 검색으로 전환·복귀 ──────────────
  await page.locator('[data-id="home-map-search"]').fill(MAP_NAME);
  const searchHit = await page
    .locator('[data-id="map-card-name"]', { hasText: MAP_NAME })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const treeGoneInSearch = (await page.locator('[data-id="framework-tree"]').count()) === 0;
  check("search in framework view switches to flat results", searchHit && treeGoneInSearch,
    `hit=${searchHit} treeGone=${treeGoneInSearch}`);
  await page.locator('[data-id="home-map-search"]').fill("");
  // 검색 해제 → 트리 리마운트 + localStorage 복원으로 펼침 상태가 그대로 돌아와야 한다.
  const mapBackAfterSearch = await mapCard.first().waitFor({ state: "visible", timeout: 12000 })
    .then(() => true).catch(() => false);
  check("clearing search restores expanded tree (persisted open state)", mapBackAfterSearch);

  // ── 4) 필터 — Private 세그먼트 → 카드 숨김 + filtered-out 노트, All 복귀 ───
  await page.locator('[data-id="home-visibility-filter"] button', { hasText: "Private" }).click();
  const noteVisible = await page.locator('[data-id="framework-filtered-note"]').first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const cardHidden = !(await mapCard.first().isVisible().catch(() => false));
  check("Private filter hides public cards with filtered-out note", noteVisible && cardHidden,
    `note=${noteVisible} cardHidden=${cardHidden}`);
  await page.locator('[data-id="home-visibility-filter"] button', { hasText: "All" }).click();
  const noteGone = (await page.locator('[data-id="framework-filtered-note"]').count()) === 0;
  check("All filter clears filtered-out note", noteGone);

  // ── 5) 새로고침 — framework 뷰 유지 + 펼침 상태 복원(무클릭으로 맵 노출) ────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 8000 });
  const mapAfterReload = await mapCard.first().waitFor({ state: "visible", timeout: 12000 })
    .then(() => true).catch(() => false);
  check("reload keeps framework view and restores open state", mapAfterReload);

  // ── 6) 맵 선택 → 상세 카드 경로뱃지 + IO ───────────────────────────────────
  // map-detail-*는 이중 마운트(모바일 인라인 아코디언 split:hidden + 데스크톱 우측 aside)가 기존
  // 패턴 — 뷰포트 1440에서 인라인 쪽은 CSS로 숨어 있으므로 :visible로 실제 노출본만 골라야 한다.
  await page.locator('[data-id="framework-tree"] [data-id="map-card"]', { hasText: MAP_NAME }).first().click();
  await page.waitForSelector('[data-id="map-detail-category"]:visible', { timeout: 8000 });
  const categoryText = (await page.locator('[data-id="map-detail-category"]:visible').first().textContent()) ?? "";
  check("map-detail-category shows L1..L5 path badge", categoryText.includes(L5_PATH), categoryText.trim());

  await page.waitForSelector('[data-id="map-detail-io"]:visible', { timeout: 8000 });
  const ioText = (await page.locator('[data-id="map-detail-io"]:visible').first().textContent()) ?? "";
  check("map-detail-io shows Input/Output values",
    ioText.includes("교정 작업지시") && ioText.includes("준비 목록"), ioText.trim());

  // ── 7) Departments 복귀 — 조직도 회귀 + 3.5개 클램프/전체 펼치기 ───────────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Departments" }).click();
  await page.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const orgVisible = await page.locator('[data-id="home-org-accordion"]').isVisible().catch(() => false);
  check("Departments toggle renders org accordion (regression)", orgVisible);

  // 직접 맵 4개+ 리스트(시드에선 미지정 섹션, 기본 펼침)는 3.5개 높이로 잘리고 Show all 버튼이 뜬다.
  const clampBtn = page.locator('button[data-id^="org-list-expand-"]').first();
  const clampShown = await clampBtn.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const clampLabel = clampShown ? ((await clampBtn.textContent()) ?? "") : "";
  check("dept map list clamps with Show all button", clampShown && clampLabel.includes("Show all"), clampLabel.trim());
  // 접힌 영역은 내부 스크롤(스크롤바 숨김 — 폭 밀림 방지), 끝에 닿으면 바깥 목록 스크롤로
  // 자연 체이닝(overscroll 기본값 auto — contain 금지).
  const scrollInfo = await page.locator('[data-id$="-scroll"]').first().evaluate((el) => {
    el.scrollTop = 120;
    return {
      scrollable: el.scrollHeight > el.clientHeight,
      moved: el.scrollTop > 0,
      chains: getComputedStyle(el).overscrollBehaviorY === "auto",
      barHidden: getComputedStyle(el).scrollbarWidth === "none",
    };
  });
  check(
    "clamped area scrolls internally, hidden scrollbar, chains to outer list",
    scrollInfo.scrollable && scrollInfo.moved && scrollInfo.chains && scrollInfo.barHidden,
    JSON.stringify(scrollInfo),
  );
  await clampBtn.click();
  const expandedLabel = (await clampBtn.textContent()) ?? "";
  check("Show all expands list and turns into Collapse", expandedLabel.includes("Collapse"), expandedLabel.trim());

  // ── 8) 새로고침 — 마지막 선택(Departments) 유지 ────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  const storedRaw = await page.evaluate(() => window.localStorage.getItem("bpm.home.tree"));
  const storedView = (() => {
    try {
      return JSON.parse(storedRaw ?? "{}").view;
    } catch {
      return null;
    }
  })();
  const orgStillVisible = await page.locator('[data-id="home-org-accordion"]').isVisible().catch(() => false);
  const frameworkGone = (await page.locator('[data-id="framework-tree"]').count()) === 0;
  check(
    "view persists across reload (bpm.home.tree.view)",
    storedView === "departments" && orgStillVisible && frameworkGone,
    `view=${storedView} orgVisible=${orgStillVisible} frameworkGone=${frameworkGone}`,
  );
  // 리스트 "전체 펼치기" 상태도 새로고침에 유지 — Growth Center 트리 펼침(bpm.home.tree)과
  // 리스트 확장(bpm.home.deptListExpand) 둘 다 복원돼 버튼이 Collapse로 남아야 한다.
  const clampAfterReload = page.locator('button[data-id^="org-list-expand-"]').first();
  const persistedLabel = await clampAfterReload.waitFor({ state: "visible", timeout: 8000 })
    .then(async () => (await clampAfterReload.textContent()) ?? "").catch(() => "");
  check("list expand state persists across reload", persistedLabel.includes("Collapse"), persistedLabel.trim());

  // ── 9) 스티키 박스 헤더 + 우측 다시 접기 ───────────────────────────────────
  // 전체 펼침 상태의 박스 헤더엔 우측 다시 접기 버튼이 뜨고, 헤더 래퍼는 computed sticky여야 한다.
  const headerCollapse = page.locator('button[data-id="org-list-collapse-unassigned"]');
  const collapseVisible = await headerCollapse.waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  const stickyPos = collapseVisible
    ? await headerCollapse.evaluate((el) => getComputedStyle(el.parentElement).position)
    : "none";
  check("sticky box header shows right-side collapse while expanded",
    collapseVisible && stickyPos === "sticky", `visible=${collapseVisible} pos=${stickyPos}`);
  await headerCollapse.click();
  const reclamped = ((await page.locator('button[data-id^="org-list-expand-"]').first().textContent()) ?? "")
    .includes("Show all");
  check("header collapse re-clamps the list", reclamped);
  // my-dept 스티키 체크는 제거(2026-08-18) — 구 canonical 샘플(owner=admin.sys·IT팀 오우닝)이
  // 채우던 박스라 인터뷰 샘플(owner null → 오우닝 NULL=미지정)에선 렌더 전제 자체가 없다.
  // StickyBoxHeader 규칙은 위 unassigned 박스 체크가, my-dept 박스는 pw-smoke-home-dept가 커버.

  // ── 10) 접힘 애니메이션 — 닫기 클릭 직후 accordion-close 재생, 종료 후 언마운트 ──
  await page.locator('[data-id="org-unassigned-toggle"]').click();
  const closingCount = await page.locator(".accordion-close").count();
  check("collapse plays accordion-close before unmount", closingCount > 0, `closing=${closingCount}`);
  await page.waitForTimeout(500);
  const closedGone = (await page.locator(".accordion-close").count()) === 0
    && (await page.locator('button[data-id^="org-list-expand-"]').count()) === 0;
  check("collapsed section unmounts after the animation", closedGone);

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
