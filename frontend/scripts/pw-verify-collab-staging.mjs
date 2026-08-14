// 협업 스테이징 UX 실구동 검증 — 3표면(설정/홈 카드/에디터 맵 탭) + 새 맵 오우닝 피커.
// Task 9 브리프 시나리오:
//   1. 설정: viewer 추가 스테이지 → Zap 필 → hover "Cancel" 스왑(computed opacity) → 클릭 취소.
//   2. editor 행 제거 스테이지 → Hourglass(승인 예고) → Save → pending 필 1개만
//      (perm.rolePending 텍스트 부재 + 상세 태그 존재).
//   3. 본인 pending 필 hover "Withdraw" 스왑 → 클릭 → pending 소멸.
//   4. viewer 추가 → Save → Undo 버튼 노출 → 클릭 → 모달 항목/예고 아이콘 렌더 → 확인 →
//      행 소멸 + Undo 버튼 소멸.
//   5. 홈 미리보기 카드 + 에디터 맵 탭에서 2·3 요약 재확인(같은 data-id 프리픽스 map-detail-*).
//   6. 새 맵 모달 오우닝 피커: pinned "My Dept" 행·구분선·들여쓰기(paddingLeft 차등) 확인.
//
// 시나리오 1~4·5의 remove→save→withdraw 사이클은 net-zero로 설계 — 스크립트 종료 시 DB 상태는
// 시작 시와 동일(추가분은 전부 취소/되돌리기, 제거는 전부 회수). dev.db 오염 없음 (다만 실패 시
// 중간 상태가 남을 수 있어 finally에서 best-effort 정리한다).
//
// 실행 (frontend/ 에서): node scripts/pw-verify-collab-staging.mjs
// 전제: backend :8000(DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys) + frontend :3000 기동,
//   playwright-core 설치. Chrome 경로가 기본값과 다르면 CHROME_PATH 환경변수로 지정.
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR =
  process.env.SHOT_DIR ??
  "/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/52181cf7-17a0-4fb1-bdd6-38f77defa103/scratchpad";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (title) => console.log(`\n=== ${title} ===`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// 인페이지 fetch — X-Dev-User 헤더로 사용자 식별(AUTH_ENABLED=false 로컬). user 미지정 시 admin.sys
// (SETUP 단계의 전역 조회용) — 배우 전환은 localStorage(bpm.devUser)로 별도 수행한다.
const api = (path, { method = "GET", body, user = "admin.sys" } = {}) =>
  page.evaluate(
    async ({ path, method, body, user }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body, user },
  );

// devUser·언어를 localStorage에 심고 새로 내비게이션 — 프론트 내부 상태(AuthGate 등)는 마운트 시
// localStorage를 읽으므로 identity 전환은 반드시 goto/reload를 동반해야 한다.
async function loginAs(userId, path) {
  if (page.url() === "about:blank") {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  }
  await page.evaluate(
    ({ userId }) => {
      window.localStorage.setItem("bpm.devUser", userId);
      window.localStorage.setItem("bpm.lang", "en");
    },
    { userId },
  );
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
}

// 호버 리빌 버튼(opacity-0 pointer-events-none → group-hover) — force hover로 receives-events
// 액셔너빌리티 체크를 우회해 실제 마우스 좌표를 쏘면, 그 좌표의 조상(row)이 진짜 :hover를 받아
// CSS group-hover가 걸리고, 이후 일반 click은 정상 통과한다.
async function hoverRevealClick(locator) {
  await locator.hover({ force: true });
  await locator.click();
}

// HoverSwapPill 공용 — 클릭은 hover 여부와 무관하게 항상 동작(오버레이는 시각 전용)하므로
// 액션 자체는 그냥 click. 이 헬퍼는 스왑 시각 효과(computed opacity)만 별도로 검증한다.
async function assertHoverSwap(pill, expectedLabel, name) {
  const base = pill.locator("> span").nth(0);
  const overlay = pill.locator("> span").nth(1);
  const beforeOverlay = await overlay.evaluate((el) => getComputedStyle(el).opacity);
  check(`${name}: overlay hidden before hover`, beforeOverlay === "0", `opacity=${beforeOverlay}`);
  await pill.hover();
  await page.waitForTimeout(220); // transition-opacity duration-150 정착 대기
  const afterOverlay = await overlay.evaluate((el) => getComputedStyle(el).opacity);
  const afterBase = await base.evaluate((el) => getComputedStyle(el).opacity);
  const overlayText = (await overlay.innerText()).trim();
  check(
    `${name}: hover swaps to "${expectedLabel}"`,
    afterOverlay === "1" && afterBase === "0" && overlayText === expectedLabel,
    `overlay=${afterOverlay} base=${afterBase} text="${overlayText}"`,
  );
  await page.mouse.move(0, 0); // 다음 단언 전 호버 해제
}

async function assertForecastIcon(pill, expected, name) {
  const zap = await pill.locator("svg.lucide-zap").count();
  const hourglass = await pill.locator("svg.lucide-hourglass").count();
  const ok = expected === "instant" ? zap === 1 && hourglass === 0 : hourglass === 1 && zap === 0;
  check(`${name}: forecast icon = ${expected}`, ok, `zap=${zap} hourglass=${hourglass}`);
}

async function shot(name) {
  await page.screenshot({ path: `${SHOT_DIR}/collab-staging-${name}.png` }).catch(() => {});
}

// ── 서버 프로브 ────────────────────────────────────────────────────
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

let mapA = null;
let actorId = null;
let targetPerm = null; // MapPermission row(다른 editor) — approval 예고 시나리오 대상
let addCandidate = null; // 아직 권한 없는 디렉터리 유저 — 추가 스테이지 대상

try {
  // ── SETUP — 시드에서 "editor(오너 아님)가 다른 editor를 제거 → 승인 필요" 조건을 만족하는
  // 맵을 찾는다. seed_org_demo는 맵마다 오너 1 + editor 2 + viewer 3(+dept/group)를 항상 심으므로
  // 첫 맵부터 성립할 가능성이 높지만, 하드코딩 대신 admin.sys로 런타임 discovery한다. ──
  section("SETUP — discover a map with 2 distinct non-owner editors + a free directory user");
  const dir = await api("/directory");
  const mapsList = await api("/maps");
  for (const m of mapsList) {
    const perms = await api(`/maps/${m.id}/permissions`);
    const editorUserPerms = perms.filter((p) => p.principal_type === "user" && p.role === "editor");
    const distinctEditorIds = [...new Set(editorUserPerms.map((p) => p.principal_id))];
    if (distinctEditorIds.length < 2) continue;
    const existingUserIds = new Set(
      perms.filter((p) => p.principal_type === "user").map((p) => p.principal_id),
    );
    const candidate = dir.users.find((u) => !existingUserIds.has(u.id));
    if (!candidate) continue;
    mapA = m;
    actorId = distinctEditorIds[0];
    targetPerm = editorUserPerms.find((p) => p.principal_id === distinctEditorIds[1]);
    addCandidate = candidate;
    break;
  }
  if (!mapA) throw new Error("no seeded map satisfies the discovery conditions");
  check(
    "found candidate map + actor(editor) + target(editor) + addCandidate",
    true,
    `map=${mapA.id} actor=${actorId} target=${targetPerm.principal_id}(#${targetPerm.id}) add=${addCandidate.id}`,
  );
  const actorEffective = await api(`/maps/${mapA.id}`, { user: actorId });
  check(
    "actor's effective role on mapA is exactly editor (not elevated)",
    actorEffective.my_role === "editor",
    `my_role=${actorEffective.my_role}`,
  );
  const targetName = dir.users.find((u) => u.id === targetPerm.principal_id)?.name ?? targetPerm.principal_id;
  const addCandidateName = addCandidate.name;

  // ── 로그인 — 실 devUser 전환은 반드시 navigation 동반 (AuthGate/current-user 마운트 재읽기) ──
  await loginAs(actorId, `/maps/${mapA.id}/settings`);
  await page.waitForSelector("#sec-collaborators", { timeout: 15000 });
  await page.locator("#sec-collaborators").getByText(targetName, { exact: false }).first().waitFor({ timeout: 10000 });

  // ── ① viewer 추가 스테이지 → Zap 필 → hover Cancel 스왑 → 클릭 취소 ──
  section("① stage add(viewer) → Zap pill → hover swaps to Cancel → click cancels (not saved)");
  const addInput = page.locator('#sec-collaborators input[placeholder^="Search by name"]');
  await addInput.click();
  await addInput.fill(addCandidate.id);
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.waitForTimeout(200);
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForSelector('[data-id="add-pick-popover"]');
  await page.locator('[data-id="add-pick-viewer"]').click();
  const addKey = `user:${addCandidate.id}`;
  const stagedAddRow = page.locator(`[data-id="staged-add-${addKey}"]`);
  check("staged-add ghost row appears", await stagedAddRow.isVisible());
  const addCancelPill = page.locator(`[data-id="perm-staged-add-cancel-${addKey}"]`);
  await assertForecastIcon(addCancelPill, "instant", "① staged-add pill");
  await assertHoverSwap(addCancelPill, "Cancel", "① staged-add pill");
  await addCancelPill.click();
  check("cancel removes the staged-add row", (await stagedAddRow.count()) === 0);
  check("Save bar not shown (nothing staged after cancel)", (await page.locator('[data-id="perm-staged-save"]').count()) === 0);
  await shot("settings-1-add-cancelled");

  // ── ② editor 행 제거 스테이지 → Hourglass → Save → pending 필 1개만 ──
  section("② stage remove(editor row) → Hourglass forecast → Save → pending tag exactly once");
  const targetRow = (scope = page) =>
    scope.locator("#sec-collaborators div.group.relative").filter({ hasText: targetName });
  await targetRow().locator('button[title="Remove"]').first().hover({ force: true });
  await targetRow().locator('button[title="Remove"]').first().click();
  const removeCancelPill = page.locator(`[data-id="perm-staged-cancel-${targetPerm.id}"]`);
  await assertForecastIcon(removeCancelPill, "approval", "② staged-remove pill");
  await shot("settings-2-remove-staged");

  await page.locator('[data-id="perm-staged-save"]').click();
  await page.waitForSelector('[data-id="perm-staged-save"]', { state: "detached", timeout: 15000 });
  await page.waitForTimeout(300); // reload() 반영 대기
  const rowText = await targetRow().innerText();
  const rolePendingCount = (rowText.match(/Pending approval/g) ?? []).length;
  const approvalTagCount = (rowText.match(/Approval pending/g) ?? []).length;
  check(
    "RoleBadge shows the real role, not the old duplicated 'Pending approval' badge",
    rolePendingCount === 0,
    `rowText="${rowText.replace(/\n/g, " | ")}"`,
  );
  check("detail pending tag renders exactly once", approvalTagCount === 1, `count=${approvalTagCount}`);
  check("detail tag reads 'editor → removed · Approval pending'", rowText.includes("editor → removed · Approval pending"));
  await shot("settings-3-pending-once");

  // ── ③ 본인 pending 필 hover → Withdraw 스왑 → 클릭 → pending 소멸 ──
  section("③ own pending tag hovers to Withdraw → click withdraws → pending gone");
  const withdrawPill = page.locator(`[data-id="perm-pending-withdraw-${targetPerm.id}"]`);
  check("withdraw pill (own pending request) visible", await withdrawPill.isVisible());
  await assertHoverSwap(withdrawPill, "Withdraw", "③ pending withdraw pill");
  await withdrawPill.click();
  await page.waitForTimeout(400); // reload() 반영 대기
  check("pending withdraw pill gone after withdrawal", (await page.locator(`[data-id="perm-pending-withdraw-${targetPerm.id}"]`).count()) === 0);
  const rowTextAfterWithdraw = await targetRow().innerText();
  check(
    "row reverted to plain Editor role (removal was never applied)",
    rowTextAfterWithdraw.includes("Editor") && !rowTextAfterWithdraw.includes("Approval pending"),
    `rowText="${rowTextAfterWithdraw.replace(/\n/g, " | ")}"`,
  );
  await shot("settings-4-withdrawn");

  // ── ④ viewer 추가 → Save → Undo 노출 → 클릭 → 모달 → 확인 → 행 소멸 + Undo 소멸 ──
  section("④ stage add(viewer) → Save → Undo button → modal → confirm → row gone + Undo gone");
  await addInput.click();
  await addInput.fill(addCandidate.id);
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.waitForTimeout(200);
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForSelector('[data-id="add-pick-popover"]');
  await page.locator('[data-id="add-pick-viewer"]').click();
  await page.locator('[data-id="perm-staged-save"]').click();
  await page.waitForSelector('[data-id="perm-staged-save"]', { state: "detached", timeout: 15000 });
  await page.waitForTimeout(300);
  const undoBtn = page.locator('[data-id="perm-undo-last"]');
  check("Undo button appears after save", await undoBtn.isVisible());
  await undoBtn.click();
  const undoModal = page.locator('[data-id="undo-last-apply-modal"]');
  await undoModal.waitFor({ timeout: 5000 });
  const modalText = await undoModal.innerText();
  check("undo modal lists the added candidate", modalText.includes(addCandidateName), modalText.replace(/\n/g, " | ").slice(0, 200));
  await assertForecastIcon(undoModal.locator("li").first(), "instant", "④ undo modal item");
  await shot("settings-5-undo-modal");
  await page.locator('[data-id="undo-last-apply-confirm"]').click();
  await undoModal.waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(300);
  check(
    "candidate row gone after undo",
    (await page.locator("#sec-collaborators").getByText(addCandidateName, { exact: false }).count()) === 0,
  );
  check("Undo button gone after undo (one-shot memory cleared)", (await page.locator('[data-id="perm-undo-last"]').count()) === 0);
  await shot("settings-6-undo-done");

  // ── ⑤a 홈 미리보기 카드 — ②·③ 요약 재확인(map-detail-* 프리픽스) ──
  section("⑤a home preview card: remove(editor)→Hourglass→Save→pending once, then Withdraw");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-map-search"]').fill(mapA.name);
  await page.waitForTimeout(300);
  const mapCard = page.locator('[data-id="map-card"]').filter({ hasText: mapA.name }).first();
  await mapCard.waitFor({ timeout: 10000 });
  await mapCard.click();
  // 1440px(≥split=980px)에선 우측 고정 aside가 실 표시 상세다 — 같은 renderCardInner가 리스트
  // 항목마다 만드는 인라인 아코디언(좁은 폭 전용, split:hidden으로 항상 DOM엔 존재)과 data-id가
  // 겹치므로 반드시 aside로 스코프한다(안 그러면 strict-mode 위반 또는 숨은 사본을 잘못 조작한다).
  const homeDetail = page.locator('[data-id="map-detail-aside"]');
  await homeDetail.locator('[data-id="map-detail-add-member"]').waitFor({ timeout: 10000 });
  const removeBtnHome = homeDetail.locator(`[data-id="map-detail-remove-member-${targetPerm.id}"]`);
  await hoverRevealClick(removeBtnHome);
  const homeForecastPill = homeDetail.locator(`[data-id="map-detail-staged-cancel-${targetPerm.id}"]`);
  await assertForecastIcon(homeForecastPill, "approval", "⑤a home card staged-remove pill");
  await homeDetail.locator('[data-id="perm-staged-save"]').click();
  await homeDetail.locator('[data-id="perm-staged-save"]').waitFor({ state: "detached", timeout: 15000 });
  await page.waitForTimeout(300);
  const homePendingCount = await homeDetail.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`).count();
  check("home card: own pending withdraw pill appears exactly once", homePendingCount === 1, `count=${homePendingCount}`);
  await shot("home-card-pending");
  const homeWithdrawPill = homeDetail.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`);
  await assertHoverSwap(homeWithdrawPill, "Withdraw", "⑤a home card pending withdraw pill");
  await homeWithdrawPill.click();
  await page.waitForTimeout(400);
  check(
    "home card: pending withdraw pill gone after withdrawal",
    (await homeDetail.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`).count()) === 0,
  );

  // ── ⑥ 새 맵 모달 오우닝 피커 — pinned My Dept 행·구분선·들여쓰기 ──
  section("⑥ new-map dialog owning-dept picker: My Dept pins, divider, indentation");
  await page.getByRole("button", { name: "New map" }).first().click();
  await page.waitForSelector('[data-id="create-map-description"]');
  const owningInput = page.locator('div.max-w-lg input[placeholder^="Search by name"]').first();
  await owningInput.click();
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.waitForTimeout(200);
  const dropdown = page.locator('[data-id="principal-picker-dropdown"]');
  const optionButtons = dropdown.locator("button");
  const optCount = await optionButtons.count();
  check("owning-dept browse dropdown has rows", optCount > 0, `count=${optCount}`);
  const myDeptCount = await dropdown.getByText("My Dept", { exact: true }).count();
  check("at least one pinned 'My Dept' row", myDeptCount > 0, `count=${myDeptCount}`);
  const dividerCount = await dropdown.locator("div.border-t").count();
  check("divider between pinned rows and tree section", dividerCount === 1, `count=${dividerCount}`);
  const paddings = [];
  for (let i = 0; i < optCount; i++) {
    const pl = await optionButtons.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    paddings.push(pl);
  }
  const minPl = Math.min(...paddings);
  const maxPl = Math.max(...paddings);
  check("indentation varies across rows (paddingLeft differs)", maxPl > minPl, `min=${minPl} max=${maxPl}`);
  await shot("new-map-owning-picker");
  await page.keyboard.press("Escape");
  await page.locator("div.max-w-lg button[aria-label=\"Cancel\"]").click();

  // ── ⑤b 에디터 맵 탭 — ②·③ 요약 재확인(map-detail-* 프리픽스, only="members") ──
  section("⑤b editor map tab: remove(editor)→Hourglass→Save→pending once, then Withdraw");
  await page.goto(`${BASE}/maps/${mapA.id}`, { waitUntil: "networkidle" });
  await page.locator('button[title="Map"]').first().click();
  await page.locator('[data-id="map-detail-add-member"]').waitFor({ timeout: 15000 });
  const removeBtnTab = page.locator(`[data-id="map-detail-remove-member-${targetPerm.id}"]`);
  await hoverRevealClick(removeBtnTab);
  const tabForecastPill = page.locator(`[data-id="map-detail-staged-cancel-${targetPerm.id}"]`);
  await assertForecastIcon(tabForecastPill, "approval", "⑤b editor tab staged-remove pill");
  await page.locator('[data-id="perm-staged-save"]').click();
  await page.waitForSelector('[data-id="perm-staged-save"]', { state: "detached", timeout: 15000 });
  await page.waitForTimeout(300);
  const tabPendingCount = await page.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`).count();
  check("editor tab: own pending withdraw pill appears exactly once", tabPendingCount === 1, `count=${tabPendingCount}`);
  await shot("editor-tab-pending");
  const tabWithdrawPill = page.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`);
  await assertHoverSwap(tabWithdrawPill, "Withdraw", "⑤b editor tab pending withdraw pill");
  await tabWithdrawPill.click();
  await page.waitForTimeout(400);
  check(
    "editor tab: pending withdraw pill gone after withdrawal",
    (await page.locator(`[data-id="map-detail-pending-withdraw-${targetPerm.id}"]`).count()) === 0,
  );

  // ── 최종 정합성 — target 권한이 시작 상태(editor, pending 없음)로 순수 복귀했는지 ──
  section("cleanup verification — target permission net-zero");
  const finalPerms = await api(`/maps/${mapA.id}/permissions`);
  const finalTarget = finalPerms.find((p) => p.id === targetPerm.id);
  check(
    "target permission still exists as editor with no pending_change",
    finalTarget?.role === "editor" && finalTarget?.pending_change == null,
    `role=${finalTarget?.role} pending=${JSON.stringify(finalTarget?.pending_change)}`,
  );
  check(
    "addCandidate has no lingering permission on mapA",
    !finalPerms.some((p) => p.principal_type === "user" && p.principal_id === addCandidate.id),
  );
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  await shot("fatal-state");
} finally {
  // best-effort 정리 — 위 시나리오가 net-zero로 설계됐지만 중도 실패 시 잔여물이 남을 수 있다.
  if (mapA && targetPerm) {
    try {
      const perms = await api(`/maps/${mapA.id}/permissions`);
      const row = perms.find((p) => p.id === targetPerm.id);
      if (row?.pending_change) {
        await api(`/approval-requests/${row.pending_change.request_id}`, { method: "DELETE" }).catch(() => {});
      }
      if (addCandidate) {
        const addedRow = perms.find(
          (p) => p.principal_type === "user" && p.principal_id === addCandidate.id,
        );
        if (addedRow) {
          await api(`/maps/${mapA.id}/permissions/${addedRow.id}`, { method: "DELETE" }).catch(() => {});
        }
      }
    } catch {
      /* best-effort */
    }
  }
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
