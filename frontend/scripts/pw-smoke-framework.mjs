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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function openContext(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  return ctx;
}

// 드릴다운 행(하위 열 L1~L4)·형제 열은 이름 텍스트로 고른다 — 한 레벨만 렌더되므로 조상/자손 오매칭이 없다.
const rowByName = (page, name) => page.locator('[data-id^="framework-row-"]').filter({ hasText: name });
const sibByName = (page, name) => page.locator('[data-id^="framework-sib-"]').filter({ hasText: name });

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

  // ── 1) 홈 진입 — 뷰 토글 노출 ────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: "networkidle" });
  const toggleVisible = await page.locator('[data-id="home-view-toggle"]').isVisible().catch(() => false);
  check("home-view-toggle visible", toggleVisible);

  // ── 2) Framework 클릭 → 드릴다운: L1 행 → L2 → L3 → L4에서 L5 카드 ─────────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-drill"]', { timeout: 8000 });
  // 이전 실행의 영속 위치(localStorage)가 남아 있으면 브레드크럼 루트로 되돌린다
  await page.locator('[data-id="framework-crumb-root"]').click({ timeout: 1500 }).catch(() => {});
  // 루트: 왼쪽 형제 열에 L1 목록(선택 없음), 오른쪽은 안내. 목록은 마운트 후 비동기 fetch — waitFor로 도착을 기다린다.
  const rootVisible = await sibByName(page, CHAIN[0]).first().waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("drill root lists L1 in the sibling column", rootVisible, CHAIN[0]);
  check("root shows the pick-an-L1 hint on the right", (await page.locator('[data-id="framework-drill-root-hint"]').count()) === 1);
  // 형제 항목 2행 = 직속 관리자(없으면 점선 플레이스홀더 "Unassigned"); L5 수는 표시하지 않는다
  const rootAdmin = sibByName(page, CHAIN[0]).first().locator('[data-id="framework-sib-admin"]');
  const rootMeta = (await sibByName(page, CHAIN[0]).first().textContent()) ?? "";
  check("sibling entry shows the admin or an unassigned placeholder, no L5 count",
    (await rootAdmin.count()) === 1 && !/L5\s*\d+/.test(rootMeta), rootMeta.trim());

  // L1은 형제 열에서, L2~L4는 오른쪽 하위 열에서 드릴인
  await sibByName(page, CHAIN[0]).first().click();
  await page.locator('[data-id="framework-drill-title"]', { hasText: CHAIN[0] }).waitFor({ timeout: 8000 });
  // 하위 행(L2~L4) = 앞 레벨 필 · 2줄 관리자 슬롯 · 우측 직계 하위 수("L3 n"), L5 수 없음
  const l2Row = rowByName(page, CHAIN[1]).first();
  const l2RowText = ((await l2Row.textContent()) ?? "").trim();
  check("child row shows a level pill, an admin slot and the direct child count",
    /^L2/.test(l2RowText) && (await l2Row.locator('[data-id="framework-row-admin"]').count()) === 1 && /L3\s*\d+/.test(l2RowText)
      && !/L5\s*\d+/.test(l2RowText),
    l2RowText);
  for (let i = 1; i < 4; i += 1) {
    await rowByName(page, CHAIN[i]).first().click();
    await page.locator('[data-id="framework-drill-title"]', { hasText: CHAIN[i] }).waitFor({ timeout: 8000 });
  }
  const rowAdmin = sibByName(page, CHAIN[3]).first().locator('[data-id="framework-sib-admin"]');
  check("sibling column shows the current L4 with its admin slot", (await rowAdmin.count()) === 1,
    ((await sibByName(page, CHAIN[3]).first().textContent()) ?? "").trim());
  const crumbText = (await page.locator('[data-id="framework-crumb"]').textContent()) ?? "";
  // 현재(L4)는 바로 아래 레벨 헤더에 있어 브레드크럼에서 생략(2026-09-21)
  check("breadcrumb lists ancestors (not the current) after drilling to L4",
    CHAIN.slice(0, 3).every((c) => crumbText.includes(c)) && !crumbText.includes(CHAIN[3]), crumbText.trim());
  const l5Card = page.locator('[data-id^="framework-l5-"]').filter({ hasText: CHAIN[4] }).first();
  const cardVisible = await l5Card.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("L4 level lists the L5 card", cardVisible, CHAIN[4]);
  const statusText = ((await l5Card.locator('[data-id="framework-l5-status"]').getAttribute("title")) ?? "").trim();
  check("L5 card status dot carries an English canvas label", ["Confirmed", "Draft", "No canvas"].includes(statusText), statusText);
  const noMapCardsLeft = (await page.locator('[data-id="framework-drill"] [data-id="map-card"]').count()) === 0;
  check("left drill list holds no map cards (maps live in the right summary)", noMapCardsLeft);
  const slideName = await page.locator('[data-id="framework-drill-list"]')
    .evaluate((el) => getComputedStyle(el).animationName).catch(() => "none");
  check("drill-in slide animation applied", slideName === "fw-slide-in", slideName);

  // ── 2b) L5 카드 선택 → 우측 요약의 소속 맵 목록 ───────────────────────────
  await l5Card.click();
  const summaryMapRow = page.locator('[data-id="category-summary-map-row"]', { hasText: MAP_NAME });
  const mapInSummary = await summaryMapRow.first().waitFor({ state: "visible", timeout: 8000 })
    .then(() => true).catch(() => false);
  check("selecting the L5 card lists its maps in the right summary", mapInSummary, MAP_NAME);
  check("selected L5 card is highlighted", (await l5Card.getAttribute("aria-pressed")) === "true");

  // ── 2c) 형제 열(현재 1개 강조, 클릭=오른쪽만 교체) + 상위 버튼 → 한 레벨 위 ──
  const currentSibs = await page.locator('[data-id^="framework-sib-"][aria-current="true"]').count();
  check("sibling column marks the current category", currentSibs === 1, `current=${currentSibs}`);

  // ── 2d) 탐색 모달 — 계단식(현재 경로 펼침·강조) ↔ 다이어그램(상위 체인 L1까지·우클릭 메뉴 3항목) ─
  await page.locator('[data-id="framework-explorer-open"]').click();
  const explorer = page.locator('[data-id="framework-explorer-modal"]');
  const explorerOpen = await explorer.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("breadcrumb tree icon opens the explorer modal", explorerOpen);
  await page.locator('[data-id="framework-explorer-mode-tree"]').click();
  const treeCurrent = await page.locator('[data-id^="framework-explorer-node-"] [data-tree-head].bg-accent-tint')
    .first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const treeLeafVisible = await page.locator('[data-id^="framework-explorer-go-"]').filter({ hasText: CHAIN[4] }).first()
    .isVisible().catch(() => false);
  check("tree mode pre-expands the current chain and highlights the current row", treeCurrent && treeLeafVisible,
    `current=${treeCurrent} leaf=${treeLeafVisible}`);
  const treeWidth = (await explorer.boundingBox())?.width ?? 0;
  // 검색 — 초성(공백 무시)·비연속 글자로도 걸리고, 결과 행엔 하이라이트 mark + 왼쪽 레벨 필(호버 = 조상 경로 툴팁)
  await page.locator('[data-id="framework-explorer-search"]').fill("ㄱㅊㅂㅈ");
  const hitRow = page.locator('[data-id^="framework-explorer-result-"]').filter({ hasText: CHAIN[2] }).first();
  const chosungHit = await hitRow.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const markCount = await page.locator('[data-id="framework-explorer-results"] mark').count();
  await hitRow.locator('[data-id^="framework-explorer-marker-"]').hover().catch(() => {});
  const tipText = await page.locator('[data-id="framework-explorer-results"] li.pointer-events-none').first()
    .textContent().catch(() => "");
  const tipHasPath = (tipText ?? "").includes(CHAIN[0]) && (tipText ?? "").includes(CHAIN[1]);
  check("chosung search finds the L3 with highlighted chars; level pill hover shows the ancestor path",
    chosungHit && markCount > 0 && tipHasPath, `hit=${chosungHit} marks=${markCount} tip=${JSON.stringify(tipText)}`);
  await page.mouse.move(5, 5);
  await page.locator('[data-id="framework-explorer-search"]').fill("");
  await page.locator('[data-id="framework-explorer-mode-diagram"]').click();
  await page.waitForSelector('[data-id^="framework-diagram-node-"]', { timeout: 8000 });
  await page.waitForTimeout(700);
  const diagramWidth = (await explorer.boundingBox())?.width ?? 0;
  check("modal narrows for the tree and widens for the diagram", treeWidth < 600 && diagramWidth > 900,
    `tree=${treeWidth} diagram=${diagramWidth}`);
  const ancestorCount = await page.locator('[data-id^="framework-diagram-node-"][data-kind="ancestor"]').count();
  check("diagram stacks the whole ancestor chain (L1..L3) above the L4 center", ancestorCount === 3, `ancestors=${ancestorCount}`);
  const centerBox = page.locator('[data-id^="framework-diagram-node-"][data-kind="center"]').first();
  {
    const b = await centerBox.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
  }
  const menuItems = await page.locator('[data-id="go-to-menu"] button').count();
  check("right-click on a diagram box opens the 3-item menu", menuItems === 3, `items=${menuItems}`);
  await page.keyboard.press("Escape");
  await page.locator('[data-id="framework-explorer-close"]').click();
  const explorerGone = (await explorer.count()) === 0;
  check("explorer modal closes", explorerGone);
  await page.locator('[data-id="framework-back"]').click();
  const backTitle = await page.locator('[data-id="framework-drill-title"]', { hasText: CHAIN[2] })
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check("back button moves up one level", backTitle, CHAIN[2]);
  await rowByName(page, CHAIN[3]).first().click();
  await l5Card.waitFor({ state: "visible", timeout: 8000 });

  // ── 3) 검색 — Framework 뷰에서도 공용 플랫 검색으로 전환·복귀 ──────────────
  await page.locator('[data-id="home-map-search"]').fill(MAP_NAME);
  const searchHit = await page
    .locator('[data-id="map-card-name"]', { hasText: MAP_NAME })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const drillGoneInSearch = (await page.locator('[data-id="framework-drill"]').count()) === 0;
  check("search in framework view switches to flat results", searchHit && drillGoneInSearch,
    `hit=${searchHit} drillGone=${drillGoneInSearch}`);
  await page.locator('[data-id="home-map-search"]').fill("");
  // 검색 해제 → 드릴 리마운트 + 영속 위치 복원으로 같은 L4 레벨(L5 카드)이 그대로 돌아와야 한다.
  const cardBackAfterSearch = await l5Card.waitFor({ state: "visible", timeout: 12000 })
    .then(() => true).catch(() => false);
  check("clearing search restores the drill position (persisted)", cardBackAfterSearch);

  // ── 4) 필터 — Private 세그먼트 → 우측 소속 맵 숨김 + filtered-out 노트, All 복귀 ─
  await l5Card.click();
  await summaryMapRow.first().waitFor({ state: "visible", timeout: 8000 });
  await page.locator('[data-id="home-visibility-filter"] button', { hasText: "Private" }).click();
  const noteVisible = await page.locator('[data-id="category-summary-filtered-note"]').first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  const rowHidden = !(await summaryMapRow.first().isVisible().catch(() => false));
  check("Private filter hides public maps in the summary with a filtered-out note", noteVisible && rowHidden,
    `note=${noteVisible} rowHidden=${rowHidden}`);
  await page.locator('[data-id="home-visibility-filter"] button', { hasText: "All" }).click();
  const noteGone = (await page.locator('[data-id="category-summary-filtered-note"]').count()) === 0;
  check("All filter clears filtered-out note", noteGone);

  // ── 5) 새로고침 — framework 뷰 유지 + 드릴 위치 복원(무클릭으로 L5 카드 노출) ─
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="framework-drill"]', { timeout: 8000 });
  const cardAfterReload = await l5Card.waitFor({ state: "visible", timeout: 12000 })
    .then(() => true).catch(() => false);
  check("reload keeps framework view and restores the drill position", cardAfterReload);

  // ── 6) L5 선택 → 우측 소속 맵 행 클릭 → 맵 상세 카드 경로뱃지 + IO ───────
  // map-detail-*는 이중 마운트(모바일 인라인 아코디언 split:hidden + 데스크톱 우측 aside)가 기존
  // 패턴 — 뷰포트 1440에서 인라인 쪽은 CSS로 숨어 있으므로 :visible로 실제 노출본만 골라야 한다.
  await l5Card.click();
  await summaryMapRow.first().waitFor({ state: "visible", timeout: 8000 });
  await summaryMapRow.first().click();
  await page.waitForSelector('[data-id="map-detail-category"]:visible', { timeout: 8000 });
  const categoryText = (await page.locator('[data-id="map-detail-category"]:visible').first().textContent()) ?? "";
  check("map-detail-category shows L1..L5 path badge", categoryText.includes(L5_PATH), categoryText.trim());

  await page.waitForSelector('[data-id="map-detail-sp-section"]:visible', { timeout: 8000 });
  const ioText = (await page.locator('[data-id="map-detail-sp-section"]:visible').first().textContent()) ?? "";
  check("map-detail-sp-section shows Input/Output values",
    ioText.includes("교정 작업지시") && ioText.includes("준비 목록"), ioText.trim());

  // ── 7) Departments 복귀 — 조직도 회귀 + 3.5개 클램프/전체 펼치기 ───────────
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Departments" }).click();
  await page.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const orgVisible = await page.locator('[data-id="home-org-accordion"]').isVisible().catch(() => false);
  check("Departments toggle renders org accordion (regression)", orgVisible);

  // 직접 맵 4개+ 리스트(시드에선 미지정 섹션, 기본 펼침)는 3.5개 높이로 잘리고 Show all 버튼이 뜬다.
  const clampBtn = page.locator('button[data-id="org-list-expand-__unassigned__"]');
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
  const clampAfterReload = page.locator('button[data-id="org-list-expand-__unassigned__"]');
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
  const reclamped = ((await page.locator('button[data-id="org-list-expand-__unassigned__"]').textContent()) ?? "")
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
