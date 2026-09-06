// Framework 슬롯 거버넌스 스모크 — 비관리자 owner 요청 → L5 관리자 승인 → 캔버스 재지정·배지·호버 패널 → 해제 요청 → 미싱 룩.
// 시드는 pw-smoke-framework-canvas.mjs와 동일(인터뷰 샘플 웹 임포트, 멱등). 계정 전환은 localStorage bpm.devUser + API는 X-Dev-User.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/bpm-slot-smoke node scripts/pw-smoke-framework-slot.mjs
// 전제: backend(8000, DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false)+frontend(3000), reset_db 직후.
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-slot-smoke";
const SAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples/consultant-interview-sample");
const ADMIN = "admin.sys";
const L5ADMIN = "slot.l5admin";
const OWNER = "slot.owner";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
let shotIndex = 0;
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `${String(++shotIndex).padStart(2, "0")}-${name}.png`), fullPage: false });

async function newSession(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((u) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", "en");
    // 트리 펼침 영속이 이전 실행에 남으면 캐스케이드 단언이 헷갈린다 — 매 실행 초기화
    window.localStorage.removeItem("bpm.framework.tree");
  }, user);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${user}: ${e.message}`));
  const api = (p, opts = {}) => page.evaluate(async ({ p, opts, u }) => {
    const res = await fetch(`/api${p}`, { ...opts, headers: { "Content-Type": "application/json", "X-Dev-User": u, ...(opts.headers ?? {}) } });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }, { p, opts, u: user });
  return { ctx, page, api };
}

// SearchSelect(포털 드롭다운) — 트리거 클릭으로 메뉴를 열고, 검색 후 옵션 클릭. 옵션 버튼은
// role="option"이 아니라 일반 button(텍스트만 매치) — 포털은 evaluate 클릭(memory: search-select-portal).
async function pickSearchSelect(page, scopeSelector, query, optionText) {
  await page.locator(`${scopeSelector} [data-id="search-select-trigger"]`).click();
  const menu = page.locator('[data-id="search-select-menu"]');
  await menu.waitFor({ state: "visible", timeout: 5000 });
  await menu.locator("input").fill(query);
  await menu.locator("button", { hasText: optionText }).first().evaluate((el) => el.click());
}

try {
  // ── 0) 시드: 인터뷰 샘플 임포트(sysadmin) + L5 관리자 임명 + 비관리자 owner 맵 A ─────────
  const admin = await newSession(ADMIN);
  await admin.page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await admin.page.getByRole("button", { name: "Categories & import" }).first().click();
  await admin.page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"), path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await admin.page.locator('[data-id="interview-import-file-list"] > li').nth(1)
    .waitFor({ state: "visible", timeout: 5000 });
  await admin.page.locator('[data-id="interview-import-dryrun"]').click();
  await admin.page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  // 실측: handleInterviewApply는 확인 다이얼로그 없이 바로 적용된다(framework-panel.tsx에 이 흐름의
  // ConfirmDialog가 없음, 브리프의 confirm-dialog-confirm 클릭은 실존하지 않아 제거) —
  // interviewBusy가 클릭 즉시 버튼을 disabled로 만들어 그 상태만으론 완료를 못 가른다. 실제 apply
  // 응답(import-interview POST)을 기다린다.
  const [applyResp] = await Promise.all([
    admin.page.waitForResponse((r) => r.url().includes("/categories/import-interview") && r.request().method() === "POST", { timeout: 20000 }),
    admin.page.locator('[data-id="interview-import-apply"]').click(),
  ]);
  check("import apply request succeeded", applyResp.ok(), `status=${applyResp.status()}`);

  const search = await admin.api(`/categories/search?q=${encodeURIComponent("Calibration 수행")}`);
  const l5 = search.body.categories.find((c) => c.level === 5) ?? search.body.categories[0];
  check("seeded L5 found", Boolean(l5), JSON.stringify(l5));

  await admin.api(`/categories/${l5.id}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions: [{ principal_type: "user", principal_id: L5ADMIN }] }),
  });
  const canvas = (await admin.api(`/categories/${l5.id}/linkage-map`, { method: "POST" })).body;
  const l6s = (await admin.api(`/categories/${l5.id}/maps`)).body.maps;
  const a = l6s[0];
  check("canvas + first L6 (A) available", Boolean(canvas?.map_id && a), `canvas=${canvas?.map_id} A=${a?.id}`);

  // A의 owner를 비관리자 owner로 — sysadmin이 transfer-owner (editor 요구 시 권한 먼저 부여)
  await admin.api(`/maps/${a.id}/permissions`, {
    method: "POST",
    body: JSON.stringify({ principal_type: "user", principal_id: OWNER, role: "editor" }),
  });
  const xfer = await admin.api(`/maps/${a.id}/transfer-owner`, { method: "POST", body: JSON.stringify({ new_owner: OWNER }) });
  check("A owner handed to non-admin owner", xfer.status === 200, `status=${xfer.status}`);

  // ── 1) owner 세션: 슬롯 없는 새 맵 C 생성 → 홈에서 A 선택 → 배정 모달에서 이양 요청 ───────
  // (브리프의 `/?map=` 딥링크는 실존하지 않는다 — 실측: 홈 검색으로 카드 특정 → 클릭 선택 → 우측 상세 패널)
  const owner = await newSession(OWNER);
  // page.evaluate(fetch(...))는 문서 origin이 있어야 상대경로를 못 푼다 — API 호출 전에 먼저 페이지를 연다.
  await owner.page.goto(BASE, { waitUntil: "networkidle" });
  // 실측: 인터뷰 임포트 맵의 owning_department는 조직도에 없는 문자열이라(unknown department) 그대로 재사용하면
  // 422 — /directory에서 실존 조직 경로를 하나 얻어 쓴다.
  const directory = await owner.api(`/directory`);
  const validDept = directory.body.departments[0].id;
  const created = await owner.api(`/maps`, {
    method: "POST",
    body: JSON.stringify({ name: "Slot smoke successor", visibility: "public", owning_department: validDept }),
  });
  check("owner created successor C", created.status === 200 || created.status === 201, `status=${created.status}`);
  const c = created.body;

  await owner.page.locator('[data-id="home-map-search"]').fill(a.name);
  const aCard = owner.page.locator('[data-id="map-card"]', { hasText: a.name }).first();
  await aCard.locator('[data-id="map-card-name"]').click();
  // 실측: 좁은-화면 아코디언과 ≥980px aside 양쪽에 동일 data-id가 렌더된다 — 아코디언 쪽은 split:hidden이라
  // "not visible"로 걸린다. 실제 표시되는 aside 안쪽으로 스코프.
  await owner.page.locator('[data-id="map-detail-aside"] [data-id="map-detail-category"]').first().click();
  await owner.page.waitForSelector('[data-id="framework-assign-modal"]', { timeout: 8000 });
  await owner.page.locator('[data-id="framework-transfer-open"]').click();
  await pickSearchSelect(owner.page, '[data-id="framework-assign-modal"]', "Slot smoke successor", "Slot smoke successor");
  await owner.page.locator('[data-id="framework-transfer-btn"]').click();
  await owner.page.waitForSelector('[data-id="slot-change-dialog"]', { timeout: 8000 });
  const requestMode = await owner.page.locator('[data-id="slot-change-note"]').count();
  check("non-admin owner sees request mode (note field)", requestMode === 1);
  await owner.page.locator('[data-id="slot-change-note"]').fill("smoke: replace A with C");
  await owner.page.locator('[data-id="slot-change-submit"]').click();
  await owner.page.waitForSelector('[data-id="slot-change-dialog"]', { state: "detached", timeout: 8000 });
  const pending = await owner.api(`/maps/${a.id}/slot-changes/pending`);
  check("request pending with one side", pending.body?.remaining?.length === 1, JSON.stringify(pending.body?.remaining));
  await shot(owner.page, "owner-request-sent");

  // ── 2) L5 관리자 세션: 인박스 Approvals 탭에서 확인 ──────────────────────────────────
  // (브리프의 `inbox-approval-*` data-id는 실존하지 않는다 — 실측: 기본 탭은 notifications, 승인 행은 data-id 없이
  // <li><button>...map_name...</button> 구조라 role/텍스트로 특정)
  const l5admin = await newSession(L5ADMIN);
  await l5admin.page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  await l5admin.page.getByRole("button", { name: "Approvals" }).click();
  // 맵 이름만으로 스코프하면 같은 맵에 걸린 다른 대기 승인(예: rename)도 매치될 수 있다 — 종류 타이틀
  // ("Framework slot change", i18n inbox.reqKind.fw_slot·approvalTitle()의 fw_slot 분기)까지 같이 건다.
  const row = l5admin.page.getByRole("button").filter({ hasText: a.name }).filter({ hasText: "Framework slot change" });
  // count()는 auto-wait이 없다 — 리스트가 아직 안 그려졌을 때 0으로 오판하지 않도록 먼저 렌더를 기다린다(비보고).
  await row.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const rowCount = await row.count();
  check("exactly one slot-change approval row for A", rowCount === 1, `count=${rowCount}`);
  const rowVisible = await row.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("L5 admin sees the slot request in inbox", rowVisible);
  await shot(l5admin.page, "l5admin-inbox");
  const decided = await l5admin.api(`/approval-requests/${pending.body.request.id}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });
  check("L5 admin approves → applied", decided.body?.status === "applied", `status=${decided.status} ${decided.body?.status}`);

  // ── 3) 캔버스: C 노드가 A 자리에, 최근 이양 배지, 호버 패널 ───────────────────────────
  await l5admin.page.goto(`${BASE}/maps/${canvas.map_id}`, { waitUntil: "networkidle" });
  await l5admin.page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const cNode = l5admin.page.locator(".react-flow__node", { hasText: "Slot smoke successor" }).first();
  check("canvas shows successor C node", await cNode.count() === 1);
  check("old A node is gone", (await l5admin.page.locator(".react-flow__node", { hasText: a.name }).count()) === 0);
  check("recent handover badge on C", (await cNode.locator('[data-id="node-recent-handover"]').count()) === 1);
  await cNode.hover();
  const panelLocator = l5admin.page.locator('[data-id="l5-node-info-panel"]');
  const panel = await panelLocator.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("hover shows slot history panel (top-right, replaces the L5 tag)", panel);
  // 컨테이너는 slot 이력(succeededAt/changedAt)이 있을 때만 렌더된다 — 실제 이양 시각이 찍혔는지
  // 텍스트로 확인한다. "Handed over"=framework.nodeInfo.succeededAt 라벨, KST는 formatKstShort("MM-DD HH:mm").
  const panelText = panel ? await panelLocator.innerText() : "";
  check(
    "panel shows a real handed-over KST timestamp (not the empty state)",
    /Handed over/.test(panelText) && /\d{2}-\d{2} \d{2}:\d{2}/.test(panelText),
    JSON.stringify(panelText),
  );
  await shot(l5admin.page, "canvas-after-replace-hover");

  // ── 4) 해제 요청 → 승인 → 미싱 룩 ────────────────────────────────────────────────────
  const unassignReq = await owner.api(`/maps/${c.id}/slot-changes`, {
    method: "POST",
    body: JSON.stringify({ action: "unassign", note: "smoke unassign" }),
  });
  check("owner unassign request created", unassignReq.body?.mode === "requested", JSON.stringify(unassignReq.body?.mode));
  const dec2 = await l5admin.api(`/approval-requests/${unassignReq.body.request_id}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve" }),
  });
  check("unassign approved", dec2.body?.status === "applied");
  await l5admin.page.reload({ waitUntil: "networkidle" });
  await l5admin.page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const missing = await l5admin.page.locator('[data-id="sp-banner-slot-missing"]').count();
  check("unassigned node renders missing banner", missing === 1, `banners=${missing}`);
  const ready = await l5admin.api(`/maps/${canvas.map_id}/confirm-readiness`);
  check("stale_link gate flags the unassigned link", ready.body?.failures?.some((f) => f.code === "stale_link"));
  await shot(l5admin.page, "canvas-unassigned-missing");

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
