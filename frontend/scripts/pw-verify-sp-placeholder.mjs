// 서브프로세스 플레이스홀더 왕복 검증 (sp-placeholder, spec 2026-07-19).
// 시나리오: ①피커 토글→미등록 배지→링크+등록요청(2단 확인) ②인스펙터 CTA(철회→재요청)
// ③Inbox 미게시 맵 카드=지정 비활성+안내 ④게시 맵 카드=게시본 이동 링크+지정 모달 저장=수락 완결
// ⑤반려 경로+요청자 알림 ⑥피커 "New map" 프리필→생성→에디터 잔류+자동 링크
//
// 전제: 백엔드가 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys 로 기동돼야
// 오너/뷰어 역할 차등이 실제로 걸린다(기본은 전원 sysadmin=owner 우회).
//
// 실행 (frontend/ 에서):
//   bash:       BASE_URL=http://localhost:3233 node scripts/pw-verify-sp-placeholder.mjs
//   PowerShell: $env:BASE_URL="http://localhost:3233"; node scripts\pw-verify-sp-placeholder.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3233";
const SHOTS = "/tmp/pw-verify-sp-placeholder";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  consoleErrors.push(m.text());
});

// ── 헬퍼 (pw-verify-map-rename.mjs 미러) ────────────────────────
const api = (path, { method = "GET", body, user = "admin.sys" } = {}) =>
  page.evaluate(
    async ({ path, method, body, user }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body, user },
  );

async function waitForCondition(fn, { timeout = 8000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

// devUser 전환 — DevGate가 렌더 단계에서 localStorage를 동기 반영 → 풀 네비게이션 필수
async function switchUserAndGoto(loginId, path) {
  await page.evaluate((u) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", "en");
  }, loginId);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
}

const toastVisible = (text) =>
  page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

// ── 서버 프로브 ──────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}
const backendStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } });
    return res.status;
  } catch {
    return 0;
  }
});
if (backendStatus !== 200) {
  console.error(`FATAL backend not reachable through ${BASE}/api (GET /api/maps → ${backendStatus})`);
  await browser.close();
  process.exit(1);
}

try {
  const stamp = Date.now();
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const realUsers = dir.users.filter((u) => u.role !== "admin");
  if (realUsers.length < 2) throw new Error("directory needs at least 2 non-admin employees");
  const hostOwner = realUsers[0].id;
  const targetOwner = realUsers[1].id;
  check("picked distinct host/target owners", hostOwner !== targetOwner, `host=${hostOwner} target=${targetOwner}`);

  // ── 시드 — 호스트 맵 + 대상 3종(A 미게시, B 게시, C 반려용) 전부 미지정·public ──
  const mkMap = async (name, user) =>
    api("/maps", {
      method: "POST",
      body: { name, description: "", visibility: "public", owning_department: owningDept },
      user,
    });
  const host = await mkMap(`SPPH Host ${stamp}`, hostOwner);
  const targetA = await mkMap(`SPPH TargetA ${stamp}`, targetOwner);
  const targetB = await mkMap(`SPPH TargetB ${stamp}`, targetOwner);
  const targetC = await mkMap(`SPPH TargetC ${stamp}`, targetOwner);
  check("seeded host + 3 target maps", Boolean(host.id && targetA.id && targetB.id && targetC.id));

  // targetB 게시 — 승인자=오너 셀프 체인(checkout→submit→approve→publish)
  const vB = targetB.versions[0].id;
  await api(`/maps/${targetB.id}/approvers`, { method: "PUT", body: { user_ids: [targetOwner] }, user: targetOwner });
  await api(`/versions/${vB}/checkout`, { method: "POST", body: { force: false }, user: targetOwner });
  await api(`/versions/${vB}/submit`, { method: "POST", user: targetOwner });
  await api(`/versions/${vB}/approve`, { method: "POST", user: targetOwner });
  const published = await api(`/versions/${vB}/publish`, { method: "POST", user: targetOwner });
  check("targetB published for the accept chain", published.status === "published", `status=${published.status}`);

  // ── ① 라이브러리 패널 토글 → 미등록 링크 + 등록 요청 ─────────────────
  await switchUserAndGoto(hostOwner, `/maps/${host.id}`);
  await page.waitForSelector('button[title="Process library"]', { timeout: 20000 });
  await page.locator('button[title="Process library"]').click();
  await page.waitForSelector('[data-id="process-library-panel"]', { timeout: 8000 });
  const panel = page.locator('[data-id="process-library-panel"]');
  await panel.locator("input").first().fill(`SPPH TargetA ${stamp}`);

  // 토글 OFF — 미지정 맵은 서버가 반환하지 않아 행 자체가 없다
  await page.waitForTimeout(400);
  check(
    "toggle OFF: unregistered map absent from the library list",
    (await panel.getByText(`SPPH TargetA ${stamp}`).count()) === 0,
  );

  // 토글 ON — 미등록 행 + 배지 등장
  await panel.locator('[data-id="library-unregistered-toggle"] input').click();
  const badgeShown = await waitForCondition(
    async () => (await panel.locator('[data-id="library-unregistered-badge"]').count()) > 0,
  );
  check("toggle ON: 'Not registered' badge appears in the panel", badgeShown);
  await page.screenshot({ path: `${SHOTS}/01-library-toggle.png` });
  await panel.getByText(`SPPH TargetA ${stamp}`, { exact: true }).first().click();

  // 확인 1 — 잠금 경고 동봉
  await page.getByText("Add link node?").waitFor({ timeout: 6000 });
  check(
    "link confirm shows unregistered warning line",
    (await page.getByText("not registered as a subprocess", { exact: false }).count()) > 0,
  );
  await page.screenshot({ path: `${SHOTS}/02-link-unreg-confirm.png` });
  await page.getByRole("button", { name: "Confirm", exact: true }).click();

  // 확인 2 — 등록 요청 여부
  await page.getByText("Request subprocess registration?").waitFor({ timeout: 6000 });
  await page.screenshot({ path: `${SHOTS}/03-request-confirm.png` });
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  check('request sent toast shown', await toastVisible("Registration request sent"));

  const pendingA = await api(`/maps/${targetA.id}/sp-designation-requests/pending`, { user: hostOwner });
  check("pending request exists for targetA (API)", pendingA !== null && pendingA.status === "pending");
  check(
    "request payload carries host map context",
    pendingA?.payload?.from_map_name === `SPPH Host ${stamp}`,
    `from=${pendingA?.payload?.from_map_name}`,
  );
  const nodeOnCanvas = await waitForCondition(
    async () => (await page.getByText(`SPPH TargetA ${stamp}`, { exact: true }).count()) > 0,
  );
  check("subprocess placeholder node added to canvas", nodeOnCanvas);
  await page.screenshot({ path: `${SHOTS}/04-node-added.png` });

  // ── ② 인스펙터 CTA — Requested 배지 → 철회 → 재요청 ─────────────────
  await page.getByText(`SPPH TargetA ${stamp}`, { exact: true }).first().click();
  const pendingBadge = await page
    .locator('[data-id="sp-registration-pending"]')
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("inspector shows 'Registration requested' badge", pendingBadge);
  await page.screenshot({ path: `${SHOTS}/05-inspector-pending.png` });
  await page.locator('[data-id="sp-registration-withdraw"]').click();
  check("withdraw toast shown", await toastVisible("Registration request withdrawn"));
  const ctaBack = await page
    .locator('[data-id="sp-registration-cta"]')
    .waitFor({ state: "visible", timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  check("CTA button returns after withdraw", ctaBack);
  const withdrawnA = await api(`/maps/${targetA.id}/sp-designation-requests/pending`, { user: hostOwner });
  check("pending cleared after withdraw (API)", withdrawnA === null);
  await page.locator('[data-id="sp-registration-cta"]').click();
  // POST 완료를 API 폴링으로 대기 — 토스트는 직전 단계 것이 잔존할 수 있어 신뢰 불가
  const rePendingA = await waitForCondition(
    async () => (await api(`/maps/${targetA.id}/sp-designation-requests/pending`, { user: hostOwner })) !== null,
  );
  check("pending re-created via inspector CTA (API)", rePendingA);

  // B·C 요청은 API로 (UI 경로는 ①에서 검증)
  await api(`/maps/${targetB.id}/sp-designation-requests`, { method: "POST", body: { from_map_id: host.id }, user: hostOwner });
  await api(`/maps/${targetC.id}/sp-designation-requests`, { method: "POST", body: { from_map_id: host.id }, user: hostOwner });

  // ── ③ Inbox — 미게시 맵 카드: 지정 비활성 + 안내 ────────────────────
  // 카드는 반드시 제목("Subprocess registration")+맵 이름으로 특정 — 우측 다이제스트/알림 li 오매칭 방지.
  // 상세 조작은 wide 레이아웃의 우측 패널(inbox-detail-aside)로 스코프(숨은 아코디언 중복 마운트 회피).
  await switchUserAndGoto(targetOwner, "/inbox");
  // 기본 탭은 알림 — 승인 대기 탭으로 전환(뱃지 카운트가 붙어 exact 불가)
  await page.getByRole("button", { name: "Approvals" }).first().click();
  const spCard = (name) =>
    page.locator("li").filter({ hasText: "Subprocess registration" }).filter({ hasText: name }).first();
  const aside = page.locator('[data-id="inbox-detail-aside"]');
  const cardA = spCard(`SPPH TargetA ${stamp}`);
  await cardA.waitFor({ state: "visible", timeout: 15000 });
  check(
    "inbox lists 'Subprocess registration' cards for the owner",
    (await page.locator("li").filter({ hasText: "Subprocess registration" }).count()) >= 3,
  );
  await cardA.locator("button").first().click();
  const noPub = await aside
    .getByText("No published version yet", { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("unpublished target: no-published notice shown", noPub);
  check(
    "unpublished target: designate button disabled",
    await aside.locator('[data-id="inbox-sp-designate"]').isDisabled(),
  );
  await page.screenshot({ path: `${SHOTS}/06-inbox-nopublished.png` });

  // ── ④ Inbox — 게시 맵 카드: 지정 모달 저장 = 수락 완결 ───────────────
  const cardB = spCard(`SPPH TargetB ${stamp}`);
  await cardB.locator("button").first().click();
  const goPub = aside.getByRole("link", { name: "Go to published version" }).first();
  const goPubShown = await goPub.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("published target: 'Go to published version' link shown", goPubShown);
  const designateBtn = aside.locator('[data-id="inbox-sp-designate"]');
  const designateEnabled = await waitForCondition(async () => !(await designateBtn.isDisabled()));
  check("published target: designate button enabled", designateEnabled);
  await designateBtn.click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/07-designation-modal.png` });

  // 부서(필수) — 모달 내 첫 SearchSelect에서 실제 부서 옵션 선택("None"/클리어 항목 제외)
  const modal = page.locator('[data-id="subprocess-designation-modal"]');
  await modal.locator('[data-id="search-select-trigger"]').first().click();
  await page.waitForSelector('[data-id="search-select-menu"]', { timeout: 6000 });
  await page
    .locator('[data-id="search-select-menu"] button')
    .filter({ hasNotText: "None" })
    .first()
    .click();
  const saveBtn = modal.locator('[data-id="subprocess-designation-save"]');
  const saveEnabled = await waitForCondition(async () => !(await saveBtn.isDisabled()));
  check("designation save enabled after picking a department", saveEnabled);
  await saveBtn.click();
  check("designation saved toast (request approved)", await toastVisible("registration request approved"));
  const cardBGone = await waitForCondition(
    async () =>
      (await page
        .locator("li")
        .filter({ hasText: "Subprocess registration" })
        .filter({ hasText: `SPPH TargetB ${stamp}` })
        .count()) === 0,
  );
  check("accepted card removed from the queue", cardBGone);
  const mapB = await api(`/maps/${targetB.id}`, { user: targetOwner });
  check("targetB designated (API)", mapB.sp_designated_at != null);
  const pendingBGone = await api(`/maps/${targetB.id}/sp-designation-requests/pending`, { user: targetOwner });
  check("targetB pending auto-applied by designation PUT (API)", pendingBGone === null);
  const hostNotes = await api("/notifications", { user: hostOwner });
  check(
    "requester notified sp_designation_approved",
    hostNotes.some((n) => n.type === "sp_designation_approved" && n.map_id === targetB.id),
  );
  await page.screenshot({ path: `${SHOTS}/08-accepted.png` });

  // ── ⑤ Inbox — 반려 경로 ────────────────────────────────────────
  const cardC = spCard(`SPPH TargetC ${stamp}`);
  await cardC.locator("button").first().click();
  await aside.getByRole("button", { name: "Reject", exact: true }).click();
  // 반려 확인 모달(포털) — 보이는 마지막 Reject 버튼이 모달 확인
  await page.locator('button:visible', { hasText: "Reject" }).last().click();
  check("reject toast shown", await toastVisible("Registration request rejected"));
  const rejectedNote = await waitForCondition(async () => {
    const notes = await api("/notifications", { user: hostOwner });
    return notes.some((n) => n.type === "sp_designation_rejected" && n.map_id === targetC.id);
  });
  check("requester notified sp_designation_rejected", rejectedNote);
  const pendingCGone = await api(`/maps/${targetC.id}/sp-designation-requests/pending`, { user: targetOwner });
  check("targetC pending resolved after reject (API)", pendingCGone === null);

  // ── ⑥ 라이브러리 "New map" — 프리필 → 생성 → 에디터 잔류 + 자동 링크 ─────
  const createdName = `SPPH Created ${stamp}`;
  await switchUserAndGoto(hostOwner, `/maps/${host.id}`);

  // 드롭다운 마커 확인 — 지정된 targetB는 SP 배지, 링크된 targetA는 체크
  await page.waitForSelector('button[title="Map menu"]', { timeout: 20000 });
  await page.locator('button[title="Map menu"]').click();
  const ddSearch = page.locator('input[placeholder^="Load"]').first();
  await ddSearch.fill(`SPPH TargetB ${stamp}`);
  const spPill = await waitForCondition(
    async () => (await page.locator("button", { hasText: `SPPH TargetB ${stamp}` }).getByText("SP", { exact: true }).count()) > 0,
  );
  check("dropdown: designated map shows SP badge", spPill);
  await ddSearch.fill(`SPPH TargetA ${stamp}`);
  const linkedCheck = await waitForCondition(
    async () =>
      (await page
        .locator("button", { hasText: `SPPH TargetA ${stamp}` })
        .locator('svg[aria-label="Already linked in this map"]')
        .count()) > 0,
  );
  check("dropdown: already-linked map shows check mark", linkedCheck);
  await page.keyboard.press("Escape");

  // 라이브러리 패널에서 새 맵 생성
  await page.locator('button[title="Process library"]').click();
  await page.waitForSelector('[data-id="process-library-panel"]', { timeout: 8000 });
  const panel2 = page.locator('[data-id="process-library-panel"]');
  await panel2.locator("input").first().fill(createdName);
  await panel2.locator('[data-id="library-new-map"]').click();
  await page.waitForSelector('input[placeholder="Map name"]', { timeout: 8000 });
  check(
    "create dialog prefilled with the search query",
    (await page.locator('input[placeholder="Map name"]').inputValue()) === createdName,
  );
  await page.screenshot({ path: `${SHOTS}/09-create-prefill.png` });

  // 오우닝 부서 + 결재자 — csv-create-flow 셀렉터 미러
  const owningName = dir.departments[0].name;
  const owningInput = page.locator('input[placeholder^="Search by name"]').first();
  await owningInput.scrollIntoViewIfNeeded();
  await owningInput.click();
  await owningInput.fill(owningName);
  await page.waitForSelector('[data-id="principal-picker-dropdown"]', { timeout: 6000 });
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForSelector('[data-id="owning-dept-selected"]', { timeout: 6000 });
  const approverInput = page.locator('input[placeholder^="Search by name"]').last();
  await approverInput.scrollIntoViewIfNeeded();
  await approverInput.click();
  await page.waitForSelector('[data-id="principal-picker-dropdown"]', { timeout: 6000 });
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForSelector('[data-id^="create-approver-pill-"]', { timeout: 6000 });
  await page.getByRole("button", { name: "Create", exact: true }).click();

  check("editor stays on the host map (no navigation)", await waitForCondition(
    async () => page.url().includes(`/maps/${host.id}`) && (await page.locator('input[placeholder="Map name"]').count()) === 0,
  ));
  check("auto-link toast for the created map", await toastVisible(`Link node added — ${createdName}`));
  const createdNode = await waitForCondition(
    async () => (await page.getByText(createdName, { exact: true }).count()) > 0,
  );
  check("created map linked as a node on canvas", createdNode);
  await page.screenshot({ path: `${SHOTS}/10-created-linked.png` });

  // 새로 만든 맵은 미지정 — 링크는 경고 상태로 시작(모델 확인, API)
  const createdRow = (await api(`/library/processes?include_undesignated=true`, { user: hostOwner })).find(
    (r) => r.name === createdName,
  );
  check("created map present as unregistered in library (API)", createdRow != null && createdRow.designated === false);
} catch (err) {
  check("scenario crashed", false, String(err).slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/99-crash.png` }).catch(() => {});
}

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? ` — ${failed} FAIL` : ""}`);
await browser.close();
process.exit(failed ? 1 : 0);
