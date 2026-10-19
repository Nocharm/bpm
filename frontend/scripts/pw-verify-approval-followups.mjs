// 권한·결재 잔여 화면 검증 (리뷰 2026-10-19 7a) — 받은함 승인 창의 동봉 공개 범위 줄(B-9), 반려본 읽기 전용 안내(W-6),
// 승인자 피커 빈 안내·열 때 후보 새로 읽기(W-4), 분류 권한자에서 빠진 사람 알림(E-12)을 실제 화면으로 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-approval-followups.mjs
//   산출물은 저장소 루트 .shots/approval-followups-*.png (gitignore). 시드한 맵은 휴지통으로, 분류는 지운다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys, 디렉터리에 활성 직원 3명 이상.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const LANG = process.env.PW_LANG ?? "ko";

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(user, method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "X-Dev-User": user, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const tag = Date.now().toString(36);
const directory = await api(ADMIN, "GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0]).org_path;
const people = directory.users.filter((u) => u.id !== ADMIN && u.org_path).slice(0, 3).map((u) => u.id);
if (people.length < 3) throw new Error("need 3 directory users");
const [APPROVER, EDITOR, REMOVED] = people;
const graph = (prefix) => ({
  nodes: [
    { id: `${prefix}-s`, title: "Start", node_type: "start", pos_x: 0, pos_y: 100 },
    { id: `${prefix}-t`, title: "검토", node_type: "process", pos_x: 260, pos_y: 100 },
    { id: `${prefix}-e`, title: "", node_type: "end", pos_x: 560, pos_y: 100 },
  ],
  edges: [
    { id: `${prefix}-e1`, source_node_id: `${prefix}-s`, target_node_id: `${prefix}-t`, label: "" },
    { id: `${prefix}-e2`, source_node_id: `${prefix}-t`, target_node_id: `${prefix}-e`, label: "" },
  ],
  groups: [],
});
// 로컬 sqlite는 영구삭제한 맵의 id를 재사용하고 권한 행이 남는다(리뷰 H-11) — 같은 부여가 이미 있으면 그대로 쓴다
async function grantEditor(mapId, user) {
  await api(ADMIN, "POST", `/api/maps/${mapId}/permissions`, { principal_type: "user", principal_id: user, role: "editor" })
    .catch((err) => {
      if (!String(err).includes("grant already exists")) throw err;
    });
}
async function newMap(name) {
  const map = await api(ADMIN, "POST", "/api/maps", { name, owning_department: owning, visibility: "private" });
  const draft = (await api(ADMIN, "GET", `/api/maps/${map.id}`)).versions.find((v) => v.status === "draft");
  return { id: map.id, draft: draft.id };
}

const cleanup = [];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function pageAs(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([u, lang]) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", lang);
  }, [user, LANG]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
  return page;
}

try {
  // ── B-9 받은함 승인 창에 동봉 공개 범위 변경 ─────────────────────────
  const m1 = await newMap(`Followups bundle ${tag}`);
  cleanup.push(m1.id);
  await api(ADMIN, "PUT", `/api/maps/${m1.id}/approvers`, { user_ids: [APPROVER] });
  await api(ADMIN, "POST", `/api/versions/${m1.draft}/checkout`, { force: true });
  await api(ADMIN, "PUT", `/api/versions/${m1.draft}/graph`, graph(`fu-${tag}-a`));
  await api(ADMIN, "POST", `/api/versions/${m1.draft}/submit`, { to_visibility: "public", comment: "공개 전환 같이" });
  const approver = await pageAs(APPROVER);
  // 홈 대시보드와 같은 딥링크 — 승인 탭으로 바꾸고 그 카드를 고른다
  await approver.goto(`${BASE}/inbox?approval=version_approval:${m1.draft}`, { waitUntil: "domcontentloaded" });
  const approveBtn = approver.locator('[data-id="inbox-approve"]:visible');
  await approveBtn.waitFor({ timeout: 60_000 }).catch(async (err) => {
    await approver.screenshot({ path: `${OUT}/approval-followups-error-${LANG}.png` });
    throw err;
  });
  await approveBtn.click();
  const dialog = approver.locator('[data-id="confirm-dialog"]');
  await dialog.waitFor({ timeout: 10_000 });
  const bundleText = LANG === "ko" ? "공개 범위 변경" : "Visibility will change";
  check("inbox approve dialog shows the bundled visibility change", (await dialog.getByText(bundleText).count()) === 1);
  await approver.screenshot({ path: `${OUT}/approval-followups-inbox-bundle-${LANG}.png` });
  await approver.locator('[data-id="confirm-dialog-cancel"]').click();

  // ── W-6 반려본: 점유자 아닌 편집자에게 회수 안내 ──────────────────────
  await api(APPROVER, "POST", `/api/versions/${m1.draft}/reject`, { reason: "보완 필요" });
  await grantEditor(m1.id, EDITOR);
  const editor = await pageAs(EDITOR);
  await editor.goto(`${BASE}/maps/${m1.id}?version=${m1.draft}`, { waitUntil: "domcontentloaded" });
  const notice = editor.locator('[data-id="editor-readonly-notice"]');
  await notice.waitFor({ timeout: 60_000 });
  await editor.waitForTimeout(1500);
  const rejectedText = LANG === "ko" ? "Draft로 회수한 뒤" : "withdrawn to a draft";
  check("rejected version tells editors to wait for the withdraw", (await notice.getByText(rejectedText, { exact: false }).count()) === 1,
    (await notice.innerText()).slice(0, 120));
  await editor.screenshot({ path: `${OUT}/approval-followups-rejected-${LANG}.png` });

  // ── W-4 승인자 피커: 빈 안내, 열 때 후보 새로 읽기 ─────────────────────
  const m2 = await newMap(`Followups picker ${tag}`);
  cleanup.push(m2.id);
  await api(ADMIN, "PUT", `/api/maps/${m2.id}/approvers`, { user_ids: [ADMIN] });
  const owner = await pageAs(ADMIN);
  await owner.goto(`${BASE}/maps/${m2.id}/settings`, { waitUntil: "domcontentloaded" });
  await owner.locator('[data-id="settings-nav-approvers"]').click();
  const input = owner.locator('[data-id="approvers-add-form"] input').first();
  await input.waitFor({ timeout: 30_000 });
  await input.click();
  const empty = owner.locator('[data-id="principal-picker-empty"]');
  await empty.waitFor({ timeout: 10_000 });
  const emptyText = await empty.innerText();
  check("approver picker explains why it is empty", emptyText.length > 5 && emptyText !== "-", emptyText);
  await owner.screenshot({ path: `${OUT}/approval-followups-picker-empty-${LANG}.png` });
  await owner.locator("body").click({ position: { x: 5, y: 5 } });
  // 같은 화면을 연 채로 협업자를 추가(다른 탭에서 추가한 것과 같다) → 다시 열면 후보가 보여야
  await grantEditor(m2.id, EDITOR);
  const editorName = directory.users.find((u) => u.id === EDITOR)?.name ?? EDITOR;
  await input.click();
  const dropdown = owner.locator('[data-id="principal-picker-dropdown"]');
  await dropdown.waitFor({ timeout: 10_000 });
  await owner.waitForTimeout(800);
  check("reopening the picker shows the new collaborator", (await dropdown.getByText(editorName).count()) >= 1, editorName);

  // ── E-12 분류 권한자에서 빠진 사람 알림 ───────────────────────────────
  const cat = await api(ADMIN, "POST", "/api/categories", { name: `Followups cat ${tag}`, parent_id: null });
  cleanup.push(`cat:${cat.id}`);
  await api(ADMIN, "PUT", `/api/categories/${cat.id}/permissions`, { permissions: [{ principal_type: "user", principal_id: REMOVED }] });
  await api(ADMIN, "PUT", `/api/categories/${cat.id}/permissions`, { permissions: [{ principal_type: "user", principal_id: EDITOR }] });
  const removed = await pageAs(REMOVED);
  await removed.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const bell = removed.locator(`button[aria-label="${LANG === "ko" ? "알림" : "Notifications"}"]`).first();
  await bell.waitFor({ timeout: 60_000 });
  await removed.waitForTimeout(2500); // 하이드레이션 전 클릭은 무시된다
  await bell.click();
  const row = removed.locator('[data-id^="notif-bell-row-"]').filter({ hasText: `Followups cat ${tag}` }).first();
  await row.waitFor({ timeout: 10_000 });
  const label = LANG === "ko" ? "권한자 해제" : "Admin role removed";
  check("removed category admin gets a notice", (await row.getByText(label).count()) >= 1, (await row.innerText()).replace(/\s+/g, " ").slice(0, 120));
  await removed.screenshot({ path: `${OUT}/approval-followups-admin-removed-${LANG}.png` });
} finally {
  await browser.close();
  for (const item of cleanup) {
    if (typeof item === "string") await api(ADMIN, "DELETE", `/api/categories/${item.slice(4)}`).catch(() => undefined);
    // 휴지통까지만 — 영구삭제하면 로컬 sqlite가 같은 id를 다음 맵에 다시 쓰며 남은 권한 행을 물려준다(H-11)
    else await api(ADMIN, "DELETE", `/api/maps/${item}`).catch(() => undefined);
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
