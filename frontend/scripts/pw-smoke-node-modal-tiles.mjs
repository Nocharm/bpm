// 노드 편집 모달 타일화 스모크 — 편집(타일→팝오버→Enter→저장), 비용 단위 탭, 부서 행 타일 피커,
// 액션 바 셰브론(변경 있을 때만), 읽기 전용(정적 타일·IO 읽기 팝오버), SP 노드 모달(상속 읽기 타일·참고치),
// Subprocess 탭 지정 파라미터 섹션 + 수정 → 지정 모달(부서/담당자 행 타일·비용 단일 타일).
// 실행(frontend/ 에서): SCRATCH_DIR=<dir> BASE_URL=http://localhost:3000 node scripts/pw-smoke-node-modal-tiles.mjs
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
const shot = (page, name) => page.screenshot({ path: path.join(SCRATCH, `tiles-${name}.png`) });
// 노드 편집 모달 열기 — 우클릭 메뉴 "Edit info"(더블클릭은 축소 캔버스에서 제목 히트 시 이름 편집으로 빠진다)
const openNodeModal = async (page, text) => {
  const node = page.locator(".react-flow__node").filter({ hasText: text }).first();
  await node.click({ button: "right" });
  await page.locator('[data-id="context-menu"]').getByText("Edit info").click();
  await page.waitForSelector('[data-id="node-summary-body"]', { timeout: 8000 });
};
// ParamInput은 포커스 시 표시값(1,200·1h30m)→raw로 바뀐다 — fill의 전체선택이 그 리렌더에 풀려
// 이어붙기(1200→12001238)가 되므로 먼저 포커스해 스왑을 끝낸 뒤 채운다
const fillParam = async (page, selector, value) => {
  const input = page.locator(selector);
  await input.click();
  await page.waitForTimeout(120);
  await input.fill(value);
};
const expandSections = async (page, ids) => {
  for (const id of ids) {
    const toggle = page.locator(`[data-id="${id}"]`);
    if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
};

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

  // ── 0) 샘플 임포트(API) → 노드가 있는 맵·draft·게시본·L5 캔버스 확보 ───────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const files = [];
  for (const name of ["calibration-l5.json", "utility-l5.json"]) {
    files.push({ name, content: JSON.parse(await fs.readFile(path.join(SAMPLE_DIR, name), "utf8")) });
  }
  const imported = await api("/categories/import-interview", { method: "POST", body: { files, apply: true, label: "tiles" } });
  check("samples imported via API", imported.applied === true);
  const maps = await api("/maps");
  const target = maps.find((m) => m.consultant_code === "smp-cal-task-0001");
  const detail = await api(`/maps/${target.id}`);
  const draft = detail.versions.find((v) => v.status === "draft") ?? detail.versions[0];
  const published = detail.versions.find((v) => v.status === "published");
  await api(`/versions/${draft.id}/checkout`, { method: "POST", body: { force: true } });
  const graph = await api(`/versions/${draft.id}/graph`);
  const processNode = graph.nodes.find((n) => n.node_type === "process");
  check("draft has a process node to edit", !!processNode, processNode?.title ?? "");
  // 실행마다 다른 값 — 같은 DB에 재실행해도 "변경 있음" 판정이 살아 있게
  const stamp = Date.now() % 1000;
  const durH = 1 + (stamp % 8);
  const durInput = `${durH}.30`;
  const costVal = 1000 + stamp;
  const costText = costVal.toLocaleString("en-US");
  const spCostVal = 100000 + stamp * 100;
  const spCostText = spCostVal.toLocaleString("en-US");

  // ── 1) 편집 모달 — 타일 그리드 + 팝오버 Enter 확정 + 비용 단위 탭 ──────────────
  await page.goto(`${BASE}/maps/${target.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  await page.waitForTimeout(500);
  await openNodeModal(page, processNode.title);
  await expandSections(page, ["summary-attrs-toggle", "summary-params-toggle", "summary-details-toggle"]);
  await page.waitForSelector('[data-id="summary-tile-duration"]', { timeout: 5000 });
  const editTiles = await page.locator('[data-id^="summary-tile-"]:not([data-id*="popover"])').count();
  check("edit modal renders field tiles", editTiles >= 12, `tiles=${editTiles}`);
  const modalWidth = (await page.locator('[data-id="node-summary-body"]').boundingBox())?.width ?? 0;
  // 바디는 카드 안쪽(보더 1px×2 제외) — 512 카드면 510
  check("modal width matches the 512px designation modal", Math.abs(modalWidth - 510) <= 2, `w=${modalWidth}`);
  // 편집 타일은 role=button div — 안에 부서 필·원문 메모 버튼이 중첩된다
  const deptTag = await page.locator('[data-id="summary-tile-department"]').evaluate((el) => `${el.tagName}:${el.getAttribute("role")}:${getComputedStyle(el).gridColumn}`);
  check("department is a clickable wide tile", deptTag.startsWith("DIV:button") && /span 2/.test(deptTag), deptTag);
  await shot(page, "edit-modal-tiles");

  // 인스펙터(같은 노드 선택) 지표 카드도 펼쳐 둔다 — 양방향 동기 검증용
  await expandSections(page, ["inspector-attrs-toggle", "inspector-params-toggle"]);
  await page.locator('[data-id="summary-tile-duration"]').click();
  await page.waitForSelector('[data-id="summary-tile-popover-duration"]', { timeout: 5000 });
  // 액션 바 — 변경 없을 땐 셰브론 숨김, 입력하면 나타남
  const chevronBefore = await page.locator('[data-id="summary-tile-popover-duration-menu-toggle"]').getAttribute("aria-hidden");
  await fillParam(page, '[data-id="summary-param-duration"]', durInput);
  await page.waitForTimeout(200);
  const chevronAfter = await page.locator('[data-id="summary-tile-popover-duration-menu-toggle"]').getAttribute("aria-hidden");
  check("action bar chevron appears only when dirty", chevronBefore === "true" && chevronAfter === "false", `${chevronBefore}→${chevronAfter}`);
  await shot(page, "popover-duration");
  await page.locator('[data-id="summary-param-duration"]').press("Enter");
  const durTile = await page.locator('[data-id="summary-tile-duration"]').textContent();
  check("Enter commits duration tile (Nh30m)", (durTile ?? "").includes(`${durH}h30m`), durTile ?? "");
  // 라이브 동기 — 팝오버 확정이 곧 노드 반영이라 인스펙터 지표 카드가 같은 값을 보인다
  await page.waitForTimeout(150);
  const inspectorDur = await page.locator('[data-id="inspector-param-duration"]').inputValue().catch(() => "");
  check("modal commit shows up in the inspector right away", inspectorDur.includes(`${durH}h30m`) || inspectorDur === durInput, inspectorDur);
  // 반대 방향 — 인스펙터 시스템 입력이 모달 시스템 타일에 바로 보인다
  const sysText = `sys-${stamp}`;
  await page.locator('[data-id="inspector-field-system"]').fill(sysText);
  await page.waitForTimeout(150);
  const sysTile = await page.locator('[data-id="summary-tile-system"]').textContent();
  check("inspector edit shows up in the modal tile right away", (sysTile ?? "").includes(sysText), sysTile ?? "");
  // 시스템 타일 호버 → 원문 메모 아이콘 → 메모 입력(노드 system_fallback)
  await page.locator('[data-id="summary-tile-system"]').hover();
  await page.locator('[data-id="summary-tile-note-icon-system"]').click();
  const notePopover = await page.locator('[data-id="summary-tile-note-icon-system-popover"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  // 임포트된 노드는 원문이 이미 있어 보기 모드로 열린다 — 그땐 '노트 수정'으로 편집 모드 진입
  const noteEditBtn = page.locator('[data-id="summary-tile-note-icon-system-edit-btn"]');
  if ((await noteEditBtn.count()) > 0) await noteEditBtn.click();
  const noteEdit = page.locator('[data-id="summary-tile-note-icon-system-edit"]');
  const noteOpened = await noteEdit.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("hovering the system tile swaps to a note icon that opens the note editor", notePopover && noteOpened);
  await noteEdit.fill(`note-${stamp}`);
  await page.locator('[data-id="summary-tile-note-icon-system-commit"]').click();
  await page.waitForSelector('[data-id="summary-tile-note-icon-system-popover"]', { state: "detached", timeout: 5000 });
  check("saving the note keeps the node modal open (no tile popover opened)", (await page.locator('[data-id="summary-tile-popover-system"]').count()) === 0);
  await page.mouse.move(10, 10); // 호버 해제 — 점은 호버 전에도 보여야 한다
  check("a tile with a note shows a small dot before hover", (await page.locator('[data-id="summary-tile-note-icon-system-dot"]').count()) === 1);
  await page.locator('[data-id="summary-tile-system"]').hover();
  await page.waitForTimeout(250);
  const dotOpacity = await page.locator('[data-id="summary-tile-note-icon-system-dot"]').evaluate((el) => getComputedStyle(el).opacity);
  const hoveredTileBg = await page.locator('[data-id="summary-tile-system"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  check("note dot fades and the tile turns white while hovered", Number(dotOpacity) < 0.5 && /255,\s*255,\s*255/.test(hoveredTileBg), `${dotOpacity} ${hoveredTileBg}`);
  await page.mouse.move(10, 10);
  // 시스템 팝오버 안에도 메모 칸
  await page.locator('[data-id="summary-tile-system"]').click();
  await page.waitForSelector('[data-id="summary-tile-popover-system"]', { timeout: 5000 });
  const noteInPopover = await page.locator('[data-id="summary-tile-note-system"]').inputValue().catch(() => null);
  check("system popover carries the interview note field", noteInPopover === `note-${stamp}`, noteInPopover ?? "none");
  await shot(page, "popover-system-note");
  await page.locator('[data-id="summary-tile-popover-system-cancel"]').click();

  await page.locator('[data-id="summary-tile-cost"]').click();
  await page.waitForSelector('[data-id="summary-tile-popover-cost"]', { timeout: 5000 });
  await page.locator('[data-id="summary-tile-cost-unit-usd"]').click();
  await fillParam(page, '[data-id="summary-param-cost"]', String(costVal));
  await shot(page, "popover-cost");
  await page.locator('[data-id="summary-param-cost"]').press("Enter");
  const costTile = await page.locator('[data-id="summary-tile-cost"]').textContent();
  check("cost tile shows value with USD pill", (costTile ?? "").includes(costText) && (costTile ?? "").includes("USD"), costTile ?? "");

  // 부서 행 타일 → 피커 팝오버(내 부서 체인 우선)
  await page.locator('[data-id="summary-tile-department"]').click();
  await page.waitForSelector('[data-id="summary-tile-popover-department"]', { timeout: 5000 });
  await page.locator('[data-id="summary-tile-popover-department"] [data-id="search-select-trigger"]').click();
  await page.waitForSelector('[data-id="search-select-menu"]', { timeout: 5000 });
  const me = await api("/me");
  const firstOption = await page.locator('[data-id="search-select-menu"] button').nth(1).textContent();
  check("department list starts with my department", (firstOption ?? "").includes(me.department), `${firstOption} vs ${me.department}`);
  const myDeptTag = await page.locator('[data-id="search-select-menu"] button').nth(1).locator('[data-id="search-select-tag"]').textContent().catch(() => "");
  check("my department row carries a 'My Dept' tag", /my dept/i.test(myDeptTag ?? ""), myDeptTag ?? "");
  await shot(page, "popover-department");
  await page.locator('[data-id="search-select-menu"] button').nth(1).click();
  await page.locator('[data-id="summary-tile-popover-department-commit"]').click();
  const deptTile = await page.locator('[data-id="summary-tile-department"]').textContent();
  check("department tile shows the picked department as a leaf pill", (deptTile ?? "").includes(me.department) && (await page.locator('[data-id="summary-tile-department-pill"]').count()) === 1, deptTile ?? "");
  // 부서 필 클릭 → 조직 정보 모달(피커 팝오버는 열리지 않는다)
  await page.locator('[data-id="summary-tile-department-pill"]').click();
  const orgModal = await page.locator('[data-id="org-info-modal"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  const pickerOpened = await page.locator('[data-id="summary-tile-popover-department"]').count();
  check("department pill opens the org info modal instead of the picker", orgModal && pickerOpened === 0);
  await page.waitForTimeout(450); // 등장 애니메이션(comment-modal-in) 종료 후 캡처
  await shot(page, "dept-pill-org-modal");
  await page.mouse.click(30, 450); // 백드롭 클릭으로 조직 모달만 닫기
  await page.waitForSelector('[data-id="org-info-modal"]', { state: "detached", timeout: 5000 });
  check("closing the org modal keeps the node modal open", (await page.locator('[data-id="node-summary-body"]').count()) === 1);
  // 담당자 타일 → 피커(＋) → 첫 후보 선택 → 저장 → 인물 필 + 호버 인물 카드(부서 트리) + 인스펙터 동일 필.
  // 같은 DB 재실행이면 이미 담당자가 있어(후보 목록이 빌 수 있음) 선택 단계는 건너뛴다
  let firstUser = "";
  if ((await page.locator('[data-id="summary-tile-assignee-pill"]').count()) === 0) {
    await page.locator('[data-id="summary-tile-assignee"]').click();
    await page.waitForSelector('[data-id="summary-tile-popover-assignee"]', { timeout: 5000 });
    await page.locator('[data-id="summary-tile-popover-assignee"] button').filter({ has: page.locator("svg.lucide-plus") }).first().click();
    await page.waitForSelector('[data-id="search-select-flyout"]', { timeout: 5000 });
    firstUser = (await page.locator('[data-id="search-select-flyout"] button').nth(1).textContent()) ?? "";
    await page.locator('[data-id="search-select-flyout"] button').nth(1).click();
    await page.locator('[data-id="summary-tile-popover-assignee-commit"]').click();
  }
  const assigneePill = page.locator('[data-id="summary-tile-assignee-pill"]').first();
  check("assignee shows as a person pill", (await assigneePill.count()) >= 1 && (await assigneePill.getAttribute("data-resolved")) === "true", firstUser);
  await assigneePill.hover();
  const personCard = await page.locator('[data-id="person-hover-card"]').waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("hovering the assignee pill opens the person card", personCard);
  await shot(page, "assignee-pill-card");
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  check("inspector assignee row shows the same person pill", (await page.locator('[data-id="inspector-assignee-pill"]').count()) >= 1);

  // 입출력 타일 → 플라이아웃 편집기('+ Add' · '다른 노드에서 불러오기' 푸터)
  await page.locator('[data-id="summary-tile-input"]').click();
  await page.waitForSelector('[data-id="summary-tile-popover-input"]', { timeout: 5000 });
  const importBtn = page.locator('[data-id="summary-tile-io-input-import"]');
  check("IO popover offers 'Import from node' next to Add", (await importBtn.count()) === 1 && (await importBtn.isEnabled()));
  await importBtn.click();
  const importOpened = await page.locator('[data-id="io-import-modal"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("import button opens the IO import modal above the popover", importOpened);
  await shot(page, "popover-input-import");
  await page.keyboard.press("Escape"); // 최상위(불러오기 모달)만 닫힌다
  await page.waitForSelector('[data-id="io-import-modal"]', { state: "detached", timeout: 5000 });
  check("Esc closes only the import modal - popover and node modal stay", (await page.locator('[data-id="summary-tile-popover-input"]').count()) === 1 && (await page.locator('[data-id="node-summary-body"]').count()) === 1);
  await page.locator('[data-id="summary-tile-io-input-add"]').click();
  const rows = page.locator('[data-id^="summary-tile-io-input-row-"]');
  const lastRow = rows.nth((await rows.count()) - 1);
  await lastRow.fill("타일 스모크 인풋");
  await lastRow.press("Enter");
  await shot(page, "popover-input");
  await page.locator('[data-id="summary-tile-popover-input-commit"]').click();
  const inputTile = await page.locator('[data-id="summary-tile-input"]').textContent();
  check("input tile shows item count after add", /\d+ items/.test(inputTile ?? ""), inputTile ?? "");

  check("footer explains live editing and offers Done", (await page.locator('[data-id="summary-live-hint"]').count()) === 1 && (await page.locator('[data-id="summary-save"]').count()) === 0);
  await page.locator('[data-id="summary-close"]').click();
  await page.waitForSelector('[data-id="node-summary-body"]', { state: "detached", timeout: 8000 });
  await page.waitForTimeout(2500); // autosave
  const saved = await api(`/versions/${draft.id}/graph`);
  const savedNode = saved.nodes.find((n) => n.id === processNode.id);
  check(
    "live edits persisted duration/cost_usd/department/assignee/input/system/note",
    savedNode?.duration === durInput && savedNode?.cost_usd === String(costVal) && savedNode?.cost_krw === "" && savedNode?.department === me.department && (savedNode?.assignee ?? "") !== "" && (savedNode?.input ?? "").includes("타일 스모크 인풋") && savedNode?.system === sysText && savedNode?.system_fallback === `note-${stamp}`,
    `${savedNode?.duration}/${savedNode?.cost_usd}/${savedNode?.department}/${savedNode?.assignee}/${savedNode?.system}/${savedNode?.system_fallback}`,
  );
  // 인스펙터 BPM 속성 행 — 아이콘+라벨 문법, 시스템 행머리는 원문 메모 트리거
  const attrIcons = await page.locator('[data-id="inspector-attrs-toggle"]').locator("xpath=..").locator("svg").count();
  check("inspector attribute rows carry row-head icons", attrIcons >= 5 && (await page.locator('[data-id="inspector-system-hint"]').count()) === 1, `icons=${attrIcons}`);

  // ── 1b) Subprocess 탭(draft 열림) — 게시본이 아니라는 워터마크 + 게시본으로 이동(수정 자리) ────
  await page.locator('button[aria-label="Subprocess"]').first().click();
  await page.waitForSelector('[data-id="sp-usage-params"]', { timeout: 10000 });
  const draftWatermark = (await page.locator('[data-id="sp-usage-not-published"]').count()) === 1;
  const goPublished = page.locator('[data-id="sp-usage-go-published"]');
  check("draft: Subprocess tab shows the not-published watermark and a go-to-published button instead of Edit", draftWatermark && (await goPublished.count()) === 1 && (await page.locator('[data-id="sp-usage-edit"]').count()) === 0);
  await shot(page, "sp-usage-draft-watermark");
  await goPublished.click();
  const editAfterGo = await page.locator('[data-id="sp-usage-edit"]').waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  check("go-to-published switches to the published version (Edit button appears, watermark gone)", editAfterGo && (await page.locator('[data-id="sp-usage-not-published"]').count()) === 0);

  // ── 2) 읽기 전용(게시본) — 정적 타일, 입출력만 읽기 팝오버 ──────────────────────
  await page.goto(`${BASE}/maps/${target.id}?version=${published.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".react-flow__node", { timeout: 30000 });
  await page.waitForTimeout(500);
  const pubGraph = await api(`/versions/${published.id}/graph`);
  const pubNode = pubGraph.nodes.find((n) => n.node_type === "process" && (n.input ?? "") !== "") ?? pubGraph.nodes.find((n) => n.node_type === "process");
  await openNodeModal(page, pubNode.title);
  // 선후행 사이드 독 — 모달 카드 밖 좌우, 카드 클릭이면 그 노드로 전환
  const prevCards = await page.locator('[data-id="summary-dock-prev"] [data-id^="summary-dock-card-"]').count();
  const nextCards = await page.locator('[data-id="summary-dock-next"] [data-id^="summary-dock-card-"]').count();
  const dockOutside = await page.evaluate(() => {
    const body = document.querySelector('[data-id="node-summary-body"]');
    const dock = document.querySelector('[data-id="summary-dock-next"]') ?? document.querySelector('[data-id="summary-dock-prev"]');
    if (!body || !dock) return false;
    const b = body.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    return d.right <= b.left + 1 || d.left >= b.right - 1;
  });
  check("prev/next docks float outside the modal card", prevCards + nextCards > 0 && dockOutside, `prev=${prevCards} next=${nextCards}`);
  const restBox = await page.locator('[data-id^="summary-dock-card-"]').first().boundingBox();
  await page.locator('[data-id^="summary-dock-card-"]').first().hover();
  await page.waitForTimeout(500);
  const hoverState = await page.locator('[data-id^="summary-dock-card-"]').first().evaluate((el) => {
    const scroll = el.parentElement;
    const r = el.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    // 커진 카드가 스크롤 상자(overflow) 경계 안에 있어야 잘리지 않는다 + 안쪽 모서리 히트가 카드 자신
    const inside = r.left >= s.left - 0.5 && r.right <= s.right + 0.5;
    const innerX = el.closest('[data-id="summary-dock-next"]') ? r.left + 1 : r.right - 1;
    const hit = document.elementFromPoint(innerX, r.top + r.height / 2);
    return { width: r.width, height: r.height, transform: getComputedStyle(el).scale, inside, hitOk: hit === el || el.contains(hit) };
  });
  // 레이아웃 성장(폭 +12·높이 +8) — scale 변환 없음(래스터 뒤틀림 방지)
  check(
    "dock card grows on hover by layout (no scale transform)",
    Math.abs(hoverState.width - ((restBox?.width ?? 0) + 12)) < 1.5 && hoverState.height > (restBox?.height ?? 0) + 6 && hoverState.transform === "none",
    JSON.stringify({ rest: restBox?.width, ...hoverState }),
  );
  check("hovered dock card is not clipped at the inner edge", hoverState.inside && hoverState.hitOk, JSON.stringify(hoverState));
  await shot(page, "readonly-docks");
  const dockTarget = page.locator('[data-id^="summary-dock-card-"]').first();
  const dockLabel = (await dockTarget.getAttribute("title")) ?? "";
  await dockTarget.click();
  // 전환 애니메이션 — 클릭한 카드의 고스트가 가운데로, 가운데 카드는 반대편으로 줄어든다
  const ghostShown = (await page.locator('[data-id="summary-swap-ghost"]').count()) === 1;
  const cardSwapping = await page.locator('[data-id="node-summary-card"]').evaluate((el) => el.classList.contains("summary-swap-out"));
  check("clicking a dock card plays the swap animation (ghost + shrinking card)", ghostShown && cardSwapping);
  await page.waitForTimeout(200);
  await shot(page, "dock-swap-mid");
  await page.waitForTimeout(700);
  const headerAfter = await page.locator('[data-id="node-summary-body"]').locator("xpath=..").locator("span.text-body-strong").first().textContent();
  check("clicking a dock card navigates the modal to that node", (headerAfter ?? "").includes(dockLabel) && (await page.locator('[data-id="summary-swap-ghost"]').count()) === 0, `${headerAfter} vs ${dockLabel}`);
  await page.keyboard.press("Escape");
  await openNodeModal(page, pubNode.title);
  const readTiles = await page.locator('[data-id^="summary-tile-"]:not([data-id*="popover"])').count();
  const staticTag = await page.locator('[data-id="summary-tile-type"]').evaluate((el) => el.tagName);
  check("read-only modal renders static tiles", readTiles >= 2 && staticTag === "DIV", `tiles=${readTiles} type=${staticTag}`);
  const editable = await page.locator('[data-id="summary-tile-popover-duration"]').count();
  check("read-only modal has no edit popover", editable === 0);
  if ((pubNode.input ?? "") !== "") {
    const ioTag = await page.locator('[data-id="summary-tile-input"]').evaluate((el) => `${el.tagName}:${el.getAttribute("role")}`);
    await page.locator('[data-id="summary-tile-input"]').click();
    const ro = await page.locator('[data-id="summary-tile-popover-input"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    const roCommit = await page.locator('[data-id="summary-tile-popover-input-commit"]').count();
    check("read-only input tile opens a view-only popover", ioTag === "DIV:button" && ro && roCommit === 0, ioTag);
    await shot(page, "readonly-io-popover");
    await page.locator('[data-id="summary-tile-popover-input-close"]').click();
  }
  await shot(page, "readonly-modal");
  await page.keyboard.press("Escape");

  // ── 3) Subprocess 탭 — 지정 파라미터 타일 + 수정 → 지정 모달(행 타일·비용 단일 타일) ──
  await page.locator('button[aria-label="Subprocess"]').first().click();
  await page.waitForSelector('[data-id="sp-usage-params"]', { timeout: 10000 });
  const usageTiles = await page.locator('[data-id^="sp-usage-tile-"]:not([data-id$="-pill"])').count();
  check("Subprocess tab lists designation value tiles", usageTiles >= 3, `tiles=${usageTiles}`);
  const usageLayout = await page.locator('[data-id="sp-usage-param-tiles"]').evaluate((el) => getComputedStyle(el).flexDirection);
  check("Subprocess tab tiles stack in one column", usageLayout === "column", usageLayout);
  const beforeSp = await api(`/maps/${target.id}`);
  // 빈 값도 "미입력" 타일로 남고, 대표값 없이 원문만 있는 필드는 원문을 임시값 스타일로 보여준다
  const emptyTiles = await page.locator('[data-id^="sp-usage-tile-"][data-filled="false"]').count();
  const emptyText = await page.locator('[data-id^="sp-usage-tile-"][data-filled="false"]').first().textContent().catch(() => "");
  const expectedFallback = [
    [beforeSp.sp_duration, beforeSp.sp_total_time_fallback],
    [beforeSp.sp_touch_time, beforeSp.sp_touch_time_fallback],
    [beforeSp.sp_system, beforeSp.sp_system_fallback],
    [beforeSp.sp_annual_count, beforeSp.sp_frequency_fallback],
  ].filter(([v, n]) => !(v ?? "").trim() && (n ?? "").trim()).length;
  const fallbackTiles = await page.locator('[data-id^="sp-usage-tile-"][data-filled="fallback"]').count();
  check("Subprocess tab keeps unset values as grey 'Not set' tiles", emptyTiles >= 1 && /not set/i.test(emptyText ?? ""), `empty=${emptyTiles} "${emptyText}"`);
  check("note-only fields show the interview note as a provisional value", fallbackTiles === expectedFallback, `fallback=${fallbackTiles} expected=${expectedFallback}`);
  if ((beforeSp.sp_total_time_fallback ?? "") !== "" || (beforeSp.sp_frequency_fallback ?? "") !== "") {
    const noteField = (beforeSp.sp_total_time_fallback ?? "") !== "" ? "duration" : "annual_count";
    check("note tile shows the note dot before hover", (await page.locator(`[data-id="sp-usage-note-${noteField}-dot"]`).count()) === 1);
    await page.locator(`[data-id="sp-usage-tile-${noteField}"]`).hover();
    await page.locator(`[data-id="sp-usage-note-${noteField}"]`).click();
    const notePop = await page.locator(`[data-id="sp-usage-note-${noteField}-popover"]`).waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    check("hovering a tile with an interview note swaps the icon and opens the note", notePop, noteField);
    await shot(page, "sp-usage-note");
    // 원문 팝오버는 포커스를 잡지 않는다 — 바깥(오버레이) 클릭으로 닫는다
    await page.mouse.click(400, 500);
    await page.waitForSelector(`[data-id="sp-usage-note-${noteField}-popover"]`, { state: "detached", timeout: 5000 });
  } else {
    check("interview note icons (no fallback text in this delivery - skipped)", true);
  }
  const usageOrder = await page.evaluate(() => {
    const linked = document.querySelector('[data-id="sp-usage-row"]')?.getBoundingClientRect().top ?? 0;
    const params = document.querySelector('[data-id="sp-usage-params"]')?.getBoundingClientRect().top ?? 0;
    return { linked, params };
  });
  check("designation section sits below the linked-from list", usageOrder.params > usageOrder.linked, JSON.stringify(usageOrder));
  await shot(page, "sp-usage-tab");
  await page.locator('[data-id="sp-usage-edit"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 8000 });
  await expandSections(page, ["sp-designation-attrs-toggle", "sp-designation-params-toggle", "sp-designation-details-toggle"]);
  const spDeptWide = await page.locator('[data-id="sp-tile-department"]').evaluate((el) => getComputedStyle(el).gridColumn);
  check("designation modal has wide department tile", /span 2/.test(spDeptWide), spDeptWide);
  // 원문 메모 필드 타일(시간·실작업·시스템·연간)엔 호버 메모 아이콘 — 값이 없어도 편집 모드라 추가 아이콘이 있다
  const spNoteIcons = await page.locator('[data-id^="sp-tile-note-icon-"]:not([data-id$="-dot"])').count();
  check("designation tiles with interview notes expose the hover note icon", spNoteIcons === 4, `icons=${spNoteIcons}`);
  const condTiles = await page.locator('[data-id="sp-tile-start_condition"], [data-id="sp-tile-end_condition"]').count();
  check("designation modal has start/end condition tiles", condTiles === 2, `tiles=${condTiles}`);
  await page.locator('[data-id="sp-tile-start_condition"]').click();
  await page.waitForSelector('[data-id="sp-tile-popover-start_condition"]', { timeout: 5000 });
  await page.locator('[data-id="sp-tile-input-start_condition"]').fill(`start-${stamp}`);
  await page.locator('[data-id="sp-tile-input-start_condition"]').press("Enter");
  const oldCostTiles = await page.locator('[data-id="sp-tile-cost_krw"], [data-id="sp-tile-cost_usd"]').count();
  check("designation modal folds cost into one tile", oldCostTiles === 0 && (await page.locator('[data-id="sp-tile-cost"]').count()) === 1);
  await page.locator('[data-id="sp-tile-cost"]').click();
  await page.waitForSelector('[data-id="sp-tile-popover-cost"]', { timeout: 5000 });
  const unitHint = await page.locator('[data-id="sp-tile-popover-cost"]').textContent();
  check("cost popover explains the one-currency rule", (unitHint ?? "").toLowerCase().includes("one currency"), (unitHint ?? "").slice(0, 80));
  await page.locator('[data-id="sp-tile-cost-unit-krw"]').click();
  await fillParam(page, '[data-id="sp-tile-input-cost"]', String(spCostVal));
  await page.locator('[data-id="sp-tile-input-cost"]').press("Enter");
  const spCost = await page.locator('[data-id="sp-tile-cost"]').textContent();
  check("designation cost tile shows KRW pill and value", (spCost ?? "").includes(spCostText) && (spCost ?? "").includes("KRW"), spCost ?? "");
  await shot(page, "sp-modal-cost");
  await page.locator('[data-id="subprocess-designation-save"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 10000 });
  const afterSp = await api(`/maps/${target.id}`);
  check("designation cost persisted as KRW only", afterSp.sp_cost_krw === String(spCostVal) && (afterSp.sp_cost_usd ?? "") === "", `${afterSp.sp_cost_krw}/${afterSp.sp_cost_usd}`);
  check("designation start condition persisted from the modal tile", afterSp.sp_start_condition === `start-${stamp}`, afterSp.sp_start_condition ?? "");
  await page.waitForTimeout(800); // usage 재조회 → 상세 재조회
  const usageCost = await page.locator('[data-id="sp-usage-tile-cost"]').textContent().catch(() => "");
  check("Subprocess tab cost tile refreshes after save", (usageCost ?? "").includes(spCostText), usageCost ?? "");
  const usageStart = await page.locator('[data-id="sp-usage-tile-start_condition"]').textContent().catch(() => "");
  check("Subprocess tab shows the start condition tile", (usageStart ?? "").includes(`start-${stamp}`), usageStart ?? "");

  // ── 4) SP 노드 모달(L5 연계 캔버스) — 상속 읽기 타일 + 연간 건수 참고치 ─────────
  const linkage = await api(`/categories/${detail.category_id}/linkage-map`, { method: "POST" }).catch(() => null);
  const canvasId = linkage?.map_id ?? linkage?.map?.id ?? linkage?.id ?? null;
  if (canvasId) {
    const cdetail = await api(`/maps/${canvasId}`);
    const cver = cdetail.versions.find((v) => v.status === "draft") ?? cdetail.versions[0];
    await api(`/versions/${cver.id}/checkout`, { method: "POST", body: { force: true } }).catch(() => null);
    await page.goto(`${BASE}/maps/${canvasId}?version=${cver.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".react-flow__node", { timeout: 30000 });
    await page.waitForTimeout(500);
    await openNodeModal(page, "교정 준비");
    // 섹션이 펼쳐진 채 열린 직후(팝인 애니메이션 뒤) 아코디언 높이가 내용을 다 담는다 — 잘림 회귀 방지
    await page.waitForTimeout(500);
    const clipState = await page.evaluate(() => {
      const ids = ["summary-attr-tiles", "summary-param-tiles", "summary-detail-tiles"];
      return ids.map((id) => {
        const grid = document.querySelector(`[data-id="${id}"]`);
        const box = grid?.closest(".scroll-quiet");
        if (!grid || !box) return { id, ok: false, missing: true };
        const g = grid.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        return { id, ok: g.bottom <= b.bottom + 1, g: Math.round(g.bottom), b: Math.round(b.bottom) };
      });
    });
    check("expanded sections are not clipped right after the modal opens", clipState.every((s) => s.ok || s.missing) && clipState.some((s) => !s.missing), JSON.stringify(clipState));
    await expandSections(page, ["summary-attrs-toggle", "summary-params-toggle", "summary-details-toggle"]);
    const spDeptTag = await page.locator('[data-id="summary-tile-department"]').evaluate((el) => `${el.tagName}:${el.getAttribute("role")}`).catch(() => "none");
    const annualTag = await page.locator('[data-id="summary-tile-annual_count"]').evaluate((el) => `${el.tagName}:${el.getAttribute("role")}`).catch(() => "none");
    check("SP modal: inherited department is static, annual count editable", spDeptTag === "DIV:null" && annualTag === "DIV:button", `${spDeptTag}/${annualTag}`);
    await page.locator('[data-id="summary-tile-annual_count"]').click();
    const refVisible = await page.locator('[data-id="summary-tile-reference"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    check("SP annual count popover shows designated reference", refVisible);
    await shot(page, "sp-node-modal");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    // 인스펙터 SP 지표 행 — 참고치 아이콘은 라벨 뒤, 입력은 맨 우측(같은 폭)
    await page.waitForSelector('[data-id="node-summary-body"]', { state: "detached", timeout: 5000 });
    await expandSections(page, ["inspector-params-toggle"]);
    const spRow = await page.evaluate(() => {
      const ref = document.querySelector('[data-id="inspector-ref-annual_count"]')?.getBoundingClientRect();
      const annual = document.querySelector('[data-id="inspector-param-annual_count"]')?.getBoundingClientRect();
      const fte = document.querySelector('[data-id="inspector-param-fte"]')?.getBoundingClientRect();
      if (!ref || !annual || !fte) return null;
      return { refLeftOfInput: ref.right <= annual.left, sameWidth: Math.abs(annual.width - fte.width) < 1, sameRight: Math.abs(annual.right - fte.right) < 1 };
    });
    check("inspector SP metrics: info icon after label, inputs flush right with equal width", spRow !== null && spRow.refLeftOfInput && spRow.sameWidth && spRow.sameRight, JSON.stringify(spRow));
    await page.locator('[data-id="inspector-ref-annual_count"]').hover();
    await page.waitForTimeout(200);
    const tipWidth = await page.locator('[role="tooltip"]').first().evaluate((el) => el.getBoundingClientRect().width).catch(() => 0);
    check("designated reference tooltip is wide enough (>= 300px)", tipWidth >= 300, `w=${tipWidth}`);
    await shot(page, "sp-inspector-metrics");
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
