// 맵 이름 변경 승인 워크플로 왕복 검증 (map-rename-workflow, SDD Task 7).
// 시나리오: ①오너 즉시 변경(Settings) ②에디터 요청→pending 배지·입력 disable
// ③취소→배지 소멸→재요청 ④오너 Inbox Approvals에서 "Map rename" 카드 승인→맵 이름 반영
// ⑤에디터 Inbox Notifications에 승인 알림 수신
//
// 전제: 백엔드가 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys 로 기동돼야
// 오너/에디터 역할 차등이 실제로 걸린다(기본은 전원 sysadmin=owner 우회).
//
// 실행 (frontend/ 에서):
//   bash:       BASE_URL=http://localhost:3211 node scripts/pw-verify-map-rename.mjs
//   PowerShell: $env:BASE_URL="http://localhost:3211"; node scripts\pw-verify-map-rename.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3211";
const SHOTS = "/tmp/pw-verify-map-rename";
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
  if (m.type() === "error") consoleErrors.push(m.text());
});

// ── 헬퍼 (pw-verify-params-ui-sync.mjs 미러) ────────────────────────
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

// devUser 전환 — providers.tsx DevGate가 렌더 단계에서 localStorage를 동기 반영하므로
// 이후 반드시 풀 네비게이션(goto)으로 새 값을 태워야 한다(SPA 라우팅은 재마운트 안 됨).
async function switchUserAndGoto(loginId, path) {
  await page.evaluate((u) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", "en");
  }, loginId);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
}

const toastVisible = (text) =>
  page
    .getByText(text, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 6000 })
    .then(() => true)
    .catch(() => false);

// ── 서버 프로브 ──────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
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

let mapId = null;
let ownerLogin = null;

try {
  const stamp = Date.now();
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — cannot supply owning_department");
  const realUsers = dir.users.filter((u) => u.role !== "admin");
  if (realUsers.length < 2) throw new Error("directory needs at least 2 non-admin employees");
  ownerLogin = realUsers[0].id;
  const editorLogin = realUsers[1].id;
  check("picked distinct owner/editor seed users", ownerLogin !== editorLogin, `owner=${ownerLogin} editor=${editorLogin}`);

  // ── 시드 — 맵 생성(오너=ownerLogin) + editorLogin에 editor grant ──────
  const initialName = `RenameWF ${stamp}`;
  const created = await api("/maps", {
    method: "POST",
    body: { name: initialName, description: "", visibility: "private", owning_department: owningDept },
    user: ownerLogin,
  });
  mapId = created.id;
  check("map created with ownerLogin as owner", created.my_role === "owner");

  await api(`/maps/${mapId}/permissions`, {
    method: "POST",
    body: { principal_type: "user", principal_id: editorLogin, role: "editor" },
    user: ownerLogin,
  });
  const editorView = await api(`/maps/${mapId}`, { user: editorLogin });
  check("editorLogin holds editor role on the map", editorView.my_role === "editor", `my_role=${editorView.my_role}`);

  // ── ① 오너 즉시 변경 ────────────────────────────────────────────
  const nameV1 = `${initialName} v1`;
  await switchUserAndGoto(ownerLogin, `/maps/${mapId}/settings`);
  await page.waitForSelector('[data-id="settings-details"]', { timeout: 15000 });
  await page.waitForSelector('[data-id="settings-map-name-save"]', { timeout: 10000 });
  const loadedInitial = await waitForCondition(
    async () => (await page.locator('[data-id="settings-map-name"]').inputValue()) === initialName,
  );
  check("settings loaded owner view with current map name", loadedInitial);
  await page.screenshot({ path: `${SHOTS}/01-owner-settings.png` });

  await page.locator('[data-id="settings-map-name"]').fill(nameV1);
  await page.locator('[data-id="settings-map-name-save"]').click();
  check('owner rename shows toast "Map renamed"', await toastVisible("Map renamed"));
  const afterOwnerRename = await waitForCondition(async () => (await api(`/maps/${mapId}`, { user: ownerLogin })).name === nameV1);
  check("owner rename applied immediately (API)", afterOwnerRename);

  // ── ② 에디터 요청 ──────────────────────────────────────────────
  const requestedName1 = `${initialName} editor-req1`;
  await switchUserAndGoto(editorLogin, `/maps/${mapId}/settings`);
  await page.waitForSelector('[data-id="settings-details"]', { timeout: 15000 });
  const loadedV1 = await waitForCondition(
    async () => (await page.locator('[data-id="settings-map-name"]').inputValue()) === nameV1,
  );
  check("settings loaded editor view with owner-renamed name", loadedV1);

  await page.locator('[data-id="settings-map-name"]').fill(requestedName1);
  await page.locator('[data-id="settings-map-name-save"]').click();
  check(
    'editor request shows toast "Rename request sent for approval"',
    await toastVisible("Rename request sent for approval"),
  );
  await page.waitForSelector('[data-id="settings-rename-pending"]', { timeout: 6000 });
  const badgeText1 = await page.locator('[data-id="settings-rename-pending"]').innerText();
  check("pending badge contains requested name", badgeText1.includes(requestedName1), `badge="${badgeText1.replace(/\n/g, " ")}"`);
  const disabled1 = await page.locator('[data-id="settings-map-name"]').isDisabled();
  check("name input disabled while a rename is pending", disabled1);
  await page.screenshot({ path: `${SHOTS}/02-editor-pending.png` });

  // ── ③ 취소 후 재요청 ────────────────────────────────────────────
  await page.locator('[data-id="settings-rename-withdraw"]').click();
  check('withdraw shows toast "Rename request withdrawn"', await toastVisible("Rename request withdrawn"));
  const badgeGone = await waitForCondition(async () => (await page.locator('[data-id="settings-rename-pending"]').count()) === 0);
  check("pending badge disappears after withdraw", badgeGone);

  const requestedName2 = `${initialName} editor-req2`;
  const nameInputAfterWithdraw = await page.locator('[data-id="settings-map-name"]').inputValue();
  check("name input restored to saved name after withdraw", nameInputAfterWithdraw === nameV1, `value="${nameInputAfterWithdraw}"`);
  await page.locator('[data-id="settings-map-name"]').fill(requestedName2);
  await page.locator('[data-id="settings-map-name-save"]').click();
  check(
    "re-request succeeds with a new pending badge",
    await toastVisible("Rename request sent for approval"),
  );
  await page.waitForSelector('[data-id="settings-rename-pending"]', { timeout: 6000 });
  const badgeText2 = await page.locator('[data-id="settings-rename-pending"]').innerText();
  check("re-request pending badge contains new requested name", badgeText2.includes(requestedName2), `badge="${badgeText2.replace(/\n/g, " ")}"`);

  // ── ④ 오너 Inbox Approvals → 승인 ───────────────────────────────
  await switchUserAndGoto(ownerLogin, "/inbox");
  await page.getByRole("button", { name: /Approvals/ }).first().click();
  const card = page.locator("button", { hasText: nameV1 }).first();
  const cardVisible = await card.isVisible().catch(() => false);
  check('Inbox Approvals lists a card for the map ("Map rename")', cardVisible);
  await card.click();
  const aside = page.locator('[data-id="inbox-detail-aside"]');
  await aside.waitFor({ timeout: 6000 });
  const asideText = await aside.innerText();
  check('detail shows "Map rename" title', asideText.includes("Map rename"));
  check("detail summary shows before→after names", asideText.includes(nameV1) && asideText.includes(requestedName2));
  await page.screenshot({ path: `${SHOTS}/03-inbox-approval-detail.png` });

  await aside.getByRole("button", { name: "Approve" }).click();
  await page.waitForSelector('[data-id="confirm-dialog"]', { timeout: 5000 });
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  check(
    'approve shows toast "Rename approved — new name applied"',
    await toastVisible("Rename approved — new name applied"),
  );
  const applied = await waitForCondition(
    async () => (await api(`/maps/${mapId}`, { user: ownerLogin })).name === requestedName2,
  );
  check("approved rename applied to the map (API)", applied);

  // ── ⑤ 에디터 알림 수신 ──────────────────────────────────────────
  await switchUserAndGoto(editorLogin, "/inbox");
  await page.getByRole("button", { name: /Notifications/ }).first().click();
  const expectedMsg = `Your request to rename '${nameV1}' to '${requestedName2}' was approved`;
  const notifVisible = await page
    .getByText(expectedMsg, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  check("editor's Notifications tab contains the rename-approved message", notifVisible, expectedMsg);
  await page.screenshot({ path: `${SHOTS}/04-editor-notifications.png` });
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null && ownerLogin !== null) {
    await api(`/maps/${mapId}`, { method: "DELETE", user: ownerLogin }).catch(() => {});
  }
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
