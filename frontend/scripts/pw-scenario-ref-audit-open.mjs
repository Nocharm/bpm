// 고아 참조 오픈 감사 시나리오 검증 - 머지 전 최종 시나리오 S1~S9(S10은 pw-smoke-ref-audit-open.mjs를 따로 실행).
// S1 Editor 노드 줄 4상태(바로 반영·점유하고 반영·점유자 알림·새 Draft) / S2 퇴직 협업자(승인 요청) / S3 퇴직 승인자(오너 알림)
// S4 sysadmin도 결재 중 승인자는 잠김 / S5 오너의 주관 부서 / S6 뷰어 전용 사용자(점·빈 화면·403 없음)
// S7 그룹 관리자 범위 / S8 빨간 점 수명(알림·잠김·게시 대기만이면 점 없음, 고칠 곳이 있으면 이름·메뉴·탭 점, 적용하면 새로 고침 없이 사라짐)
// S9 홈 경고 모달 링크 -> 설정 고아 참조 탭.
// 실행(frontend/ 에서): SCRATCH_DB=<스크래치 sqlite 경로> BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-scenario-ref-audit-open.mjs
//   bash       KEEP=1 SCRATCH_DB=... BASE_URL=... node scripts/pw-scenario-ref-audit-open.mjs   (KEEP=1이면 시드를 지우지 않는다)
//   PowerShell $env:SCRATCH_DB="..."; $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-scenario-ref-audit-open.mjs
// 전제: 스크래치 DB 사본(backend/dev.db 복사본)을 backend가 DATABASE_URL=sqlite+aiosqlite:///<경로> DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false 로 쓰고,
//       frontend를 BACKEND_URL=<backend> 로 기동. reset_db 금지. 로컬 개발 시드 사용자가 필요하다
//       (admin.sys, gunwoo.seo, woojin.choi, sanghyun.park, yuna.ahn, yerin.jang, jia.song, seojun.yoo, woojin.song, daehyun.seo, junho.park, nari.hong, taeyang.choi).
//       시드 맵·그룹은 이 스크립트가 API로 만든다(이름 접두 "RA scn" - 시작·끝에 지운다). 퇴직자는 로스터에 없는 login/이름으로 갈음한다.
//       유일하게 API로 못 만드는 상태(주관 부서가 로스터에서 사라진 맵)만 SCRATCH_DB에 직접 UPDATE 한다 - 운영·공용 DB 금지.
//       산출물은 저장소 루트 .shots/ref-audit-scenario-*.png (gitignore).
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const SCRATCH_DB = process.env.SCRATCH_DB ?? "";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";

const ADMIN = "admin.sys";
const OWNER = "gunwoo.seo"; // Insights Team - 시드 맵의 오우닝 부서(System Team)와 달라 파생 editor가 아니다
const OWNER_NAME = "Gunwoo Seo";
const EDITOR = "woojin.choi";
const HOLDER = "sanghyun.park";
const HOLDER_NAME = "Sanghyun Park";
const APPROVER = "yuna.ahn"; // 재직 승인자 - 퇴직 승인자 줄이 notify/approval로 판정되려면 재직 승인자가 하나는 있어야 한다
const NEW_PERSON = "yerin.jang";
const NEW_PERSON_NAME = "Yerin Jang";
const VIEWER = "jia.song";
const GROUP_MGR = "seojun.yoo";
const GROUP_OTHER = "woojin.song";
const GROUP_MEMBERS = ["daehyun.seo", "junho.park"];
const FIXER = "nari.hong";
const NODOT = "taeyang.choi";
const OWNING_DEPT = "Management Center/IT Office/System Team";
const REPLACE_DEPT = "Logistics Team";
const REPLACE_DEPT_PATH = "Operations Center/Delivery Office/Logistics Team"; // API는 대체 부서를 조직 경로로 받는다(피커가 경로를 싣는다)

const PREFIX = "RA scn";
const tag = Date.now().toString(36);
const ORPHAN_DEPT = `RA Scn Dept ${tag}`;
const ORPHAN_DEPT_S8 = `RA Scn Dept8 ${tag}`;
const ORPHAN_OWNING = `RA Scn Div ${tag}/RA Scn Office/RA Scn Team ${tag}`;
const ORPHAN_OWNING_LEAF = `RA Scn Team ${tag}`;
const ghost = (key) => `ra.scn.${key}.${tag}`;

mkdirSync(OUT, { recursive: true });

// ── 결과 기록 ─────────────────────────────────────────────────────────────
const results = new Map(); // 시나리오 -> { failures, checks }
const problems = []; // 콘솔 에러·페이지 에러
const serverErrors = []; // 5xx 응답
const refAuditHttpErrors = []; // /api/ref-audit* 의 4xx/5xx
let currentScn = "setup";

function check(scn, name, ok, detail = "") {
  const entry = results.get(scn) ?? { failures: 0, checks: [] };
  if (!ok) entry.failures += 1;
  entry.checks.push({ name, ok, detail });
  results.set(scn, entry);
  console.log(`${ok ? "PASS" : "FAIL"} [${scn}] ${name}${detail ? ` - ${detail}` : ""}`);
}

async function api(user, method, path, body, { allow } = {}) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && !(allow ?? []).includes(res.status)) {
    throw new Error(`${method} ${path} as ${user} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return allow ? { status: res.status, body: json } : json;
}

// ── 시드 ──────────────────────────────────────────────────────────────────
function buildGraph(key, { dept, assignee } = {}) {
  const id = (suffix) => `ra-${tag}-${key}-${suffix}`;
  return {
    nodes: [
      { id: id("s"), title: "Start", node_type: "start", pos_x: 0, pos_y: 0 },
      { id: id("p"), title: "Check", node_type: "process", department: dept ?? "", assignee: assignee ?? "", pos_x: 200, pos_y: 0 },
      { id: id("e"), title: "End", node_type: "end", is_primary_end: true, pos_x: 400, pos_y: 0 },
    ],
    edges: [
      { id: id("e1"), source_node_id: id("s"), target_node_id: id("p"), label: "" },
      { id: id("e2"), source_node_id: id("p"), target_node_id: id("e"), label: "" },
    ],
  };
}

// 맵 한 개를 평소 API로 만든다 - publish면 v1을 제출·승인·게시, draft면 게시본에서 복제한 Draft(점유자 by, held=false면 놓는다).
async function createMap({ key, graph, editors = [], viewers = [], approvers = [APPROVER], publish = false, draft = null, holdV1 = null, submit = false }) {
  const name = `${PREFIX} ${tag} ${key}`;
  const created = await api(OWNER, "POST", "/maps", { name, owning_department: OWNING_DEPT, visibility: "private" });
  const mapId = created.id;
  const v1 = created.versions[0].id;
  await api(OWNER, "PUT", `/maps/${mapId}/approvers`, { user_ids: approvers });
  for (const login of editors) await api(OWNER, "POST", `/maps/${mapId}/permissions`, { principal_type: "user", principal_id: login, role: "editor" });
  for (const login of viewers) await api(OWNER, "POST", `/maps/${mapId}/permissions`, { principal_type: "user", principal_id: login, role: "viewer" });
  await api(OWNER, "POST", `/versions/${v1}/checkout`, {});
  await api(OWNER, "PUT", `/versions/${v1}/graph`, graph);
  const out = { id: mapId, name, v1, draft: null };
  if (publish) {
    await api(OWNER, "POST", `/versions/${v1}/submit`, {});
    await api(APPROVER, "POST", `/versions/${v1}/approve`, {});
    await api(OWNER, "POST", `/versions/${v1}/publish`, {});
    if (draft) {
      const created2 = await api(draft.by, "POST", `/maps/${mapId}/versions`, { label: "Draft", source_version_id: v1 });
      out.draft = created2.id;
      if (draft.graphEdit) {
        const g = await api(draft.by, "GET", `/versions/${created2.id}/graph`);
        await api(draft.by, "PUT", `/versions/${created2.id}/graph`, draft.graphEdit(g));
      }
      if (!draft.held) await api(draft.by, "DELETE", `/versions/${created2.id}/checkout`);
    }
  } else if (submit) {
    await api(OWNER, "POST", `/versions/${v1}/submit`, {});
  } else if (holdV1) {
    await api(OWNER, "DELETE", `/versions/${v1}/checkout`);
    if (holdV1 !== OWNER) await api(holdV1, "POST", `/versions/${v1}/checkout`, {});
  } else {
    await api(OWNER, "DELETE", `/versions/${v1}/checkout`);
  }
  return out;
}

async function purgeFixtures() {
  const maps = await api(ADMIN, "GET", "/maps");
  for (const found of maps.filter((m) => m.name.startsWith(PREFIX))) {
    await api(ADMIN, "DELETE", `/maps/${found.id}`, undefined, { allow: [404, 409] });
    await api(ADMIN, "DELETE", `/maps/${found.id}/permanent`, undefined, { allow: [404, 409] });
  }
  const trash = await api(ADMIN, "GET", "/maps/deleted/list");
  for (const found of trash.filter((m) => m.name.startsWith(PREFIX))) {
    await api(ADMIN, "DELETE", `/maps/${found.id}/permanent`, undefined, { allow: [404, 409] });
  }
  const groups = await api(ADMIN, "GET", "/groups");
  for (const found of groups.filter((g) => g.name.startsWith(PREFIX))) {
    // 활성 그룹은 먼저 비활성해야 삭제된다(소프트삭제, 7일 뒤 퍼지)
    if (found.status === "active") await api(ADMIN, "POST", `/groups/${found.id}/deactivate`, undefined, { allow: [404, 409] });
    await api(ADMIN, "DELETE", `/groups/${found.id}`, undefined, { allow: [404, 409] });
  }
}

// ── 감사 조회 도우미 ──────────────────────────────────────────────────────
async function getAudit(user) {
  return api(user, "GET", "/ref-audit");
}
const findCard = (audit, kind, label) => (kind === "dept" ? audit.departments : audit.users).find((c) => c.label === label);
const lineOfMap = (card, mapId) => card?.lines.find((l) => l.map_id === mapId);
async function getSummary(user) {
  return (await api(user, "GET", "/ref-audit/summary")).actionable;
}
async function getNodeValues(user, versionId) {
  const graph = await api(user, "GET", `/versions/${versionId}/graph`);
  return graph.nodes.filter((n) => n.node_type === "process").map((n) => ({ dept: n.department, assignee: n.assignee }));
}
async function getHolder(user, versionId) {
  return (await api(user, "GET", `/versions/${versionId}/workflow`)).checkout_holder;
}
async function getVersions(user, mapId) {
  return (await api(user, "GET", `/maps/${mapId}`)).versions;
}
async function getRefFixNotices(user, mapName) {
  const list = await api(user, "GET", "/notifications");
  return list.filter((n) => n.type === "ref_fix_requested" && JSON.stringify(n.payload ?? {}).includes(mapName));
}

// ── 브라우저 도우미 ───────────────────────────────────────────────────────
async function newSession(browser, user, width = 1480) {
  const ctx = await browser.newContext({ viewport: { width, height: 950 } });
  await ctx.addInitScript((devUser) => {
    window.localStorage.setItem("bpm.devUser", devUser);
    window.localStorage.setItem("bpm.lang", "en");
  }, user);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${currentScn}] ${user} pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`[${currentScn}] ${user} console.error: ${msg.text()}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) serverErrors.push(`[${currentScn}] ${user} ${res.status()} ${res.request().method()} ${res.url()}`);
    if (res.url().includes("/api/ref-audit") && res.status() >= 400) {
      refAuditHttpErrors.push(`[${currentScn}] ${user} ${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/ref-audit-scenario-${name}.png`, fullPage: false });

async function gotoRefs(page) {
  await page.goto(`${BASE}/settings?tab=refs`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator('[data-id="ref-audit-page"]').waitFor({ timeout: 90000 });
  await page.locator('[data-id="ref-audit-loading"]').waitFor({ state: "detached", timeout: 60000 });
}

async function openCard(page, kind, key) {
  const card = page.locator(`[data-id="ref-card-${kind}-${key}"]`);
  await card.waitFor({ timeout: 20000 });
  await card.click();
  const dialog = page.locator('[data-id="ref-detail-dialog"]');
  await dialog.waitFor({ timeout: 10000 });
  return dialog;
}

// 상세 창에서 맵 한 개의 줄 영역 텍스트(소스·내용·결과 칩)
async function getMapSectionText(page, mapId) {
  const section = page
    .locator('[data-id^="ref-detail-group-"]')
    .filter({ has: page.locator(`[data-id="ref-line-map-link-${mapId}"]`) });
  await section.first().waitFor({ timeout: 10000 });
  return (await section.first().innerText()).replace(/\s+/g, " ");
}

async function pickDept(page, deptName) {
  await page.locator('[data-id="ref-detail-picker"]').click();
  await page.locator('[data-id="dept-tree-picker"] input').fill(deptName);
  await page.locator('[data-id="dept-tree-picker-list"] [data-id="dept-tree-picker-row"]').filter({ hasText: deptName }).first().click();
}

async function pickPerson(page, personName) {
  await page.locator('[data-id="ref-detail-picker"] input').fill(personName);
  await page.locator('[data-id="principal-picker-dropdown"]').getByText(personName).first().click();
}

async function applyAndConfirm(page) {
  const dialog = page.locator('[data-id="ref-detail-dialog"]');
  await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 15000 });
  await page.locator('[data-id="ref-detail-apply"]').click();
  await page.locator('[data-id="ref-detail-confirm"]').waitFor({ timeout: 5000 });
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await dialog.waitFor({ state: "detached", timeout: 20000 });
  const toast = page.getByText(/^(Applied|To publish|Notified|Approval requests|Skipped|Nothing changed)\b/).first();
  await toast.waitFor({ timeout: 8000 });
  return (await toast.innerText()).trim();
}

async function waitSummaryResponse(page, action) {
  const responded = page.waitForResponse((res) => res.url().includes("/api/ref-audit/summary") && res.request().method() === "GET", { timeout: 90000 });
  await action();
  await responded;
}

// 알림 수신자의 받은 편지함에서 ref_fix_requested가 맵 링크 칩과 함께 제대로 그려지는지
async function checkInboxRefFix(browser, scn, user, mapId, label, shotName) {
  const { ctx, page } = await newSession(browser, user);
  try {
    await page.goto(`${BASE}/inbox`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const item = page.locator('li [role="button"]').filter({ hasText: "Stale references" }).first();
    await item.waitFor({ timeout: 60000 });
    await item.click();
    // 상세는 우측 패널과 아코디언 두 벌이 DOM에 있다 - 넓은 화면에선 패널 쪽이 보인다
    const chip = page.locator(`[data-id="inbox-detail-aside"] [data-id="inbox-ref-fix-map-${mapId}"]`).first();
    await chip.waitFor({ timeout: 10000 });
    check(scn, `${label}: inbox renders the notification with a link chip to the map`, (await chip.getAttribute("href")) === `/maps/${mapId}`, await chip.innerText());
    if (shotName) await shot(page, shotName);
  } finally {
    await ctx.close();
  }
}

// ── 시나리오 ──────────────────────────────────────────────────────────────
const fx = {}; // 시드한 맵·그룹

async function seedAll() {
  currentScn = "seed";
  const dept = { dept: ORPHAN_DEPT };
  // S1 - 노드 부서가 사라진 맵 4개, EDITOR는 전부 Editor(오너 아님). 게시본에도 같은 값이 남아 있다.
  fx.s1a = await createMap({ key: "1a held-by-me", graph: buildGraph("1a", dept), editors: [EDITOR], publish: true, draft: { by: EDITOR, held: true } });
  fx.s1b = await createMap({ key: "1b unheld", graph: buildGraph("1b", dept), editors: [EDITOR], publish: true, draft: { by: OWNER, held: false } });
  fx.s1c = await createMap({ key: "1c held-by-other", graph: buildGraph("1c", dept), editors: [EDITOR, HOLDER], publish: true, draft: { by: HOLDER, held: true } });
  fx.s1d = await createMap({ key: "1d published-only", graph: buildGraph("1d", dept), editors: [EDITOR], publish: true });
  // S2 - 퇴직자가 Editor 협업자인 맵(재직 승인자 있음)
  fx.s2 = await createMap({ key: "2 departed-editor-grant", graph: buildGraph("2"), editors: [EDITOR] });
  await api(OWNER, "POST", `/maps/${fx.s2.id}/permissions`, { principal_type: "user", principal_id: ghost("s2"), role: "editor" });
  // S3 - 퇴직 승인자(편집 중 Draft)
  fx.s3 = await createMap({ key: "3 departed-approver", graph: buildGraph("3"), editors: [EDITOR], approvers: [APPROVER, ghost("s3")] });
  // S4 - 퇴직 승인자 + 제출(PENDING)된 버전 -> sysadmin에게도 잠김
  fx.s4 = await createMap({ key: "4 departed-approver-pending", graph: buildGraph("4"), approvers: [APPROVER, ghost("s4")], submit: true });
  // S5 - 주관 부서가 사라진 맵(오너 본인) - API로는 못 만든다(생성·변경이 로스터를 검사)
  fx.s5 = await createMap({ key: "5 orphan-owning-dept", graph: buildGraph("5") });
  if (!SCRATCH_DB) throw new Error("SCRATCH_DB is required to orphan the owning department (S5)");
  const db = new DatabaseSync(SCRATCH_DB);
  db.exec("PRAGMA busy_timeout = 10000");
  db.prepare("UPDATE process_maps SET owning_department = ? WHERE id = ?").run(ORPHAN_OWNING, fx.s5.id);
  db.close();
  // S6 - 뷰어 전용 사용자가 viewer grant로만 걸린 맵(노드 부서가 사라진 값)
  fx.s6 = await createMap({ key: "6 viewer-only", graph: buildGraph("6", { dept: `RA Scn Dept6 ${tag}` }), viewers: [VIEWER], holdV1: OWNER });
  // S7 - 그룹 관리자 + 퇴직 멤버
  const group = await api(GROUP_MGR, "POST", "/groups", {
    name: `${PREFIX} ${tag} group`,
    description: "scenario fixture",
    members: GROUP_MEMBERS.map((id) => ({ member_type: "user", member_id: id })),
  }); // 생성자가 자동 관리자
  await api(ADMIN, "POST", `/groups/${group.id}/decide`, { decision: "approve" });
  await api(GROUP_MGR, "POST", `/groups/${group.id}/members`, { member_type: "user", member_id: ghost("s7") });
  fx.s7 = { id: group.id, name: group.name };
  // S8 - FIXER: 직접 고칠 노드 줄 1개(본인 점유 Draft) / NODOT: 알림·잠김·게시 대기만
  fx.s8fix = await createMap({ key: "8f fixer", graph: buildGraph("8f", { dept: ORPHAN_DEPT_S8 }), editors: [FIXER], holdV1: FIXER });
  fx.s8b = await createMap({ key: "8b notify", graph: buildGraph("8b"), editors: [NODOT], approvers: [APPROVER, ghost("s8b")] });
  fx.s8c = await createMap({ key: "8c locked", graph: buildGraph("8c"), editors: [NODOT], approvers: [APPROVER, ghost("s8c")], submit: true });
  fx.s8d = await createMap({
    key: "8d pending", graph: buildGraph("8d", { dept: `RA Scn Dept8d ${tag}` }), editors: [NODOT], publish: true,
    draft: {
      by: OWNER, held: false,
      graphEdit: (g) => ({ ...g, nodes: g.nodes.map((n) => (n.node_type === "process" ? { ...n, department: REPLACE_DEPT } : n)) }),
    },
  });
  // S9 - 낡은 참조 경고가 뜨는 홈 카드: S1a를 쓴다(오너 화면)
}

async function runS6(browser) {
  currentScn = "S6";
  const scn = "S6";
  const summary = await getSummary(VIEWER);
  const audit = await getAudit(VIEWER);
  check(scn, "summary.actionable is 0 for a viewer-only user", summary === 0, `actionable=${summary}`);
  check(scn, "audit lists no cards and zero scope", audit.departments.length === 0 && audit.users.length === 0 && audit.scope.maps === 0 && audit.scope.groups === 0 && audit.scope.categories === 0, JSON.stringify(audit.scope));
  // 범위 밖 줄을 API로 직접 적용해도 건너뛰고 아무것도 쓰지 않는다(403이 아니라 skipped)
  const s6Dept = `RA Scn Dept6 ${tag}`;
  const s6Line = lineOfMap(findCard(await getAudit(ADMIN), "dept", s6Dept), fx.s6.id);
  const s6Applied = await api(VIEWER, "POST", "/ref-audit/apply", {
    kind: "dept", mode: "replace", to_value: REPLACE_DEPT_PATH, targets: [{ target_id: s6Line.target_id, from_value: s6Line.from_value }],
  });
  const s6Values = await getNodeValues(ADMIN, fx.s6.v1);
  check(scn, "a viewer's direct apply call is skipped and writes nothing", s6Applied.skipped.length === 1 && Object.keys(s6Applied.places).length === 0 && s6Values[0].dept === s6Dept, JSON.stringify({ applied: s6Applied, values: s6Values }));
  const { ctx, page } = await newSession(browser, VIEWER);
  try {
    await waitSummaryResponse(page, () => page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 }));
    await page.waitForTimeout(800);
    check(scn, "no red dot on the name button", (await page.locator('[data-id="nav-ref-dot"]').count()) === 0);
    await page.locator('[data-id="nav-user"]').click();
    await page.locator('[data-id="nav-settings"]').waitFor({ timeout: 5000 });
    check(scn, "no red dot on the Settings menu row", (await page.locator('[data-id="nav-settings-ref-dot"]').count()) === 0);
    await page.locator('[data-id="nav-settings"]').click();
    await page.locator('[data-id="settings-tab-refs"]').waitFor({ timeout: 60000 });
    check(scn, "no red dot beside the Orphaned refs tab", (await page.locator('[data-id="settings-tab-refs-dot"]').count()) === 0);
    await page.locator('[data-id="settings-tab-refs"]').click();
    await page.locator('[data-id="ref-audit-empty"]').waitFor({ timeout: 30000 });
    check(scn, "Orphaned refs page shows the empty state", true);
    await shot(page, "s6-viewer-empty");
    check(scn, "no /api/ref-audit* request failed (no 403)", refAuditHttpErrors.filter((e) => e.includes(VIEWER)).length === 0, refAuditHttpErrors.filter((e) => e.includes(VIEWER)).join(" | "));
  } finally {
    await ctx.close();
  }
}

async function runS9(browser) {
  currentScn = "S9";
  const scn = "S9";
  const { ctx, page } = await newSession(browser, OWNER);
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.locator('[data-id="home-map-search"]').fill(fx.s1a.name);
    const card = page.locator('[data-id="map-card"]').filter({ hasText: fx.s1a.name }).first();
    await card.waitFor({ timeout: 60000 });
    const badge = card.locator('[data-id="map-card-warnings"][data-kinds~="stale_refs"]');
    check(scn, "map card shows the stale refs warning", await badge.isVisible());
    await badge.click();
    const modal = page.locator('[data-id="map-card-warnings-modal"]');
    await modal.waitFor({ timeout: 5000 });
    await shot(page, "s9-warnings-modal");
    const link = modal.locator('[data-id="map-warnings-open-refs"]');
    check(scn, "warnings modal links to the Orphaned refs tab", (await link.getAttribute("href")) === "/settings?tab=refs", `href=${await link.getAttribute("href")}`);
    await link.click();
    await page.waitForURL(/\/settings\?tab=refs/, { timeout: 60000 });
    check(scn, "URL is /settings?tab=refs", /\/settings\?tab=refs/.test(page.url()), page.url());
    await page.locator('[data-id="ref-audit-page"]').waitFor({ timeout: 60000 });
    const tabClass = (await page.locator('[data-id="settings-tab-refs"]').getAttribute("class")) ?? "";
    check(scn, "Orphaned refs tab is active and its page rendered", tabClass.includes("bg-accent-tint"), tabClass);
    await shot(page, "s9-refs-tab-active");
  } finally {
    await ctx.close();
  }
}

async function runS8NoDot(browser) {
  const scn = "S8";
  currentScn = scn;
  const summary = await getSummary(NODOT);
  const audit = await getAudit(NODOT);
  const userNotify = findCard(audit, "user", ghost("s8b"));
  const userLocked = findCard(audit, "user", ghost("s8c"));
  const deptPending = findCard(audit, "dept", `RA Scn Dept8d ${tag}`);
  check(scn, "no-dot user: summary.actionable is 0", summary === 0, `actionable=${summary}`);
  check(scn, "no-dot user: departed approver on an open map is a notify line (owner)", lineOfMap(userNotify, fx.s8b.id)?.outcome === "notify" && lineOfMap(userNotify, fx.s8b.id)?.notify_to?.role === "owner", JSON.stringify(lineOfMap(userNotify, fx.s8b.id)?.notify_to));
  check(scn, "no-dot user: departed approver on a pending map is locked (in_approval)", lineOfMap(userLocked, fx.s8c.id)?.outcome === "locked" && lineOfMap(userLocked, fx.s8c.id)?.reason === "in_approval");
  check(scn, "no-dot user: node value only left in the published version is pending", lineOfMap(deptPending, fx.s8d.id)?.outcome === "pending");
  const { ctx, page } = await newSession(browser, NODOT);
  try {
    await waitSummaryResponse(page, () => page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 }));
    await page.waitForTimeout(800);
    check(scn, "no-dot user: no red dot on the name button", (await page.locator('[data-id="nav-ref-dot"]').count()) === 0);
    await page.locator('[data-id="nav-user"]').click();
    await page.locator('[data-id="nav-settings"]').waitFor({ timeout: 5000 });
    check(scn, "no-dot user: no dot on the Settings row", (await page.locator('[data-id="nav-settings-ref-dot"]').count()) === 0);
    await page.locator('[data-id="nav-settings"]').click();
    await page.locator('[data-id="settings-tab-refs"]').waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    check(scn, "no-dot user: no dot beside the tab", (await page.locator('[data-id="settings-tab-refs-dot"]').count()) === 0);
    await page.locator('[data-id="settings-tab-refs"]').click();
    await page.locator('[data-id="ref-audit-loading"]').waitFor({ state: "detached", timeout: 30000 });
    check(scn, "no-dot user: the page still lists the notify/locked/pending cards", (await page.locator(`[data-id="ref-card-user-${ghost("s8b")}"]`).count()) === 1);
    await shot(page, "s8-nodot-user-page");
  } finally {
    await ctx.close();
  }
}

async function runS8Fixer(browser) {
  const scn = "S8";
  currentScn = scn;
  const before = await getSummary(FIXER);
  check(scn, "dot user: summary.actionable is 1 (one node line)", before === 1, `actionable=${before}`);
  const { ctx, page } = await newSession(browser, FIXER);
  try {
    let reloads = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) reloads += 1;
    });
    await waitSummaryResponse(page, () => page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 }));
    await page.locator('[data-id="nav-ref-dot"]').waitFor({ state: "visible", timeout: 20000 });
    check(scn, "dot user: red dot on the name button", true);
    await page.locator('[data-id="nav-user"]').click();
    await page.locator('[data-id="nav-settings-ref-dot"]').waitFor({ state: "visible", timeout: 5000 });
    check(scn, "dot user: dot moves to the Settings row when the menu opens", (await page.locator('[data-id="nav-ref-dot"]').count()) === 0);
    await shot(page, "s8-menu-dot");
    await page.locator('[data-id="nav-settings"]').click();
    await page.locator('[data-id="settings-tab-refs-dot"]').waitFor({ state: "visible", timeout: 60000 });
    check(scn, "dot user: dot beside the Orphaned refs tab", true);
    await shot(page, "s8-tab-dot");
    await page.locator('[data-id="settings-tab-refs"]').click();
    await page.locator('[data-id="ref-audit-loading"]').waitFor({ state: "detached", timeout: 30000 });
    // 적용 전 이 지점부터 문서 이동을 센다(적용 뒤 점이 새로 고침 없이 사라지는지 보기 위해)
    reloads = 0;
    await openCard(page, "dept", ORPHAN_DEPT_S8);
    await pickDept(page, REPLACE_DEPT);
    const toast = await applyAndConfirm(page);
    check(scn, "dot user: applying the fixable line toasts the result", /^Applied 1\b/.test(toast), toast);
    await page.locator('[data-id="settings-tab-refs-dot"]').waitFor({ state: "detached", timeout: 15000 });
    check(scn, "dot user: tab dot disappears right after apply (no reload)", reloads === 0, `document navigations=${reloads}`);
    check(scn, "dot user: name dot gone after apply", (await page.locator('[data-id="nav-ref-dot"]').count()) === 0);
    await page.locator('[data-id="nav-user"]').click();
    await page.locator('[data-id="nav-settings"]').waitFor({ timeout: 5000 });
    check(scn, "dot user: Settings row dot gone after apply", (await page.locator('[data-id="nav-settings-ref-dot"]').count()) === 0);
    await shot(page, "s8-after-apply-no-dot");
    const after = await getSummary(FIXER);
    check(scn, "dot user: summary.actionable is 0 after apply", after === 0, `actionable=${after}`);
    const values = await getNodeValues(FIXER, fx.s8fix.v1);
    check(scn, "dot user: node department replaced in the held Draft", values[0]?.dept === REPLACE_DEPT, JSON.stringify(values));
  } finally {
    await ctx.close();
  }
}

async function runS4(browser) {
  currentScn = "S4";
  const scn = "S4";
  const audit = await getAudit(ADMIN);
  const card = findCard(audit, "user", ghost("s4"));
  const line = lineOfMap(card, fx.s4.id);
  check(scn, "sysadmin: departed approver on a pending map is locked (in_approval)", line?.outcome === "locked" && line?.reason === "in_approval", JSON.stringify({ outcome: line?.outcome, reason: line?.reason }));
  const ownerLine = lineOfMap(findCard(await getAudit(OWNER), "user", ghost("s4")), fx.s4.id);
  check(scn, "the map owner is locked too (same rule for everyone)", ownerLine?.outcome === "locked" && ownerLine?.reason === "in_approval", JSON.stringify({ outcome: ownerLine?.outcome, reason: ownerLine?.reason }));
  const preview = await api(ADMIN, "POST", "/ref-audit/preview", {
    kind: "user", mode: "replace", to_value: NEW_PERSON, targets: [{ target_id: line.target_id, from_value: line.from_value }],
  });
  check(scn, "sysadmin: preview also says locked", preview.lines[0]?.outcome === "locked", JSON.stringify(preview.lines[0]));
  const { ctx, page } = await newSession(browser, ADMIN);
  try {
    await gotoRefs(page);
    const dialog = await openCard(page, "user", card.key);
    const text = await getMapSectionText(page, fx.s4.id);
    check(scn, "dialog line shows the Locked chip with the in-approval reason", /Locked/.test(text) && /In approval/.test(text), text);
    const checkbox = page.locator('[data-id="ref-line-check-0"]');
    check(scn, "locked line checkbox is disabled", await checkbox.isDisabled().catch(() => false));
    await pickPerson(page, NEW_PERSON_NAME);
    await page.waitForTimeout(1200);
    check(scn, "apply stays disabled (nothing applicable is checked)", await page.locator('[data-id="ref-detail-apply"]').isDisabled());
    await shot(page, "s4-locked-for-sysadmin");
    await dialog.waitFor({ timeout: 2000 });
  } finally {
    await ctx.close();
  }
  const approversBefore = await api(OWNER, "GET", `/maps/${fx.s4.id}/approvers`);
  const applied = await api(ADMIN, "POST", "/ref-audit/apply", {
    kind: "user", mode: "replace", to_value: NEW_PERSON, targets: [{ target_id: line.target_id, from_value: line.from_value }],
  });
  const approversAfter = await api(OWNER, "GET", `/maps/${fx.s4.id}/approvers`);
  const changed = JSON.stringify(approversBefore) !== JSON.stringify(approversAfter);
  check(scn, "direct apply call changes nothing (approvers unchanged, still contains the departed approver)", !changed && approversAfter.includes(ghost("s4")), `before=${JSON.stringify(approversBefore)} after=${JSON.stringify(approversAfter)} response=${JSON.stringify(applied)}`);
  const total = Object.values(applied.places).reduce((sum, n) => sum + n, 0);
  check(scn, "apply response reports no applied place", total === 0 && applied.approval_requests === 0 && applied.notified === 0, JSON.stringify(applied));
}

async function runS1(browser) {
  currentScn = "S1";
  const scn = "S1";
  const audit = await getAudit(EDITOR);
  const card = findCard(audit, "dept", ORPHAN_DEPT);
  check(scn, "one department card with 4 map lines", card?.lines.length === 4, `lines=${card?.lines.length}`);
  const outcome = (m) => lineOfMap(card, m.id)?.outcome;
  check(scn, "1a held-by-me -> direct", outcome(fx.s1a) === "direct", outcome(fx.s1a));
  check(scn, "1b unheld Draft -> checkout", outcome(fx.s1b) === "checkout", outcome(fx.s1b));
  const notifyLine = lineOfMap(card, fx.s1c.id);
  check(scn, "1c held by another active user -> notify(holder)", notifyLine?.outcome === "notify" && notifyLine?.notify_to?.role === "holder" && notifyLine?.notify_to?.id === HOLDER, JSON.stringify(notifyLine?.notify_to));
  check(scn, "1d published only -> new_draft", outcome(fx.s1d) === "new_draft", outcome(fx.s1d));
  check(scn, "editor lines carry the Editor role (not owner)", card.lines.every((l) => l.map_role === "editor"), card.lines.map((l) => l.map_role).join(","));

  const targets = card.lines.map((l) => ({ target_id: l.target_id, from_value: l.from_value }));
  const before = {
    a: { draft: await getNodeValues(ADMIN, fx.s1a.draft), pub: await getNodeValues(ADMIN, fx.s1a.v1) },
    b: { draft: await getNodeValues(ADMIN, fx.s1b.draft), pub: await getNodeValues(ADMIN, fx.s1b.v1) },
    c: { draft: await getNodeValues(ADMIN, fx.s1c.draft) },
    d: { pub: await getNodeValues(ADMIN, fx.s1d.v1) },
    versionsD: (await getVersions(ADMIN, fx.s1d.id)).length,
  };
  check(scn, "before: drafts and published versions all carry the departed department", before.a.draft[0].dept === ORPHAN_DEPT && before.a.pub[0].dept === ORPHAN_DEPT && before.b.draft[0].dept === ORPHAN_DEPT && before.c.draft[0].dept === ORPHAN_DEPT && before.d.pub[0].dept === ORPHAN_DEPT);

  const { ctx, page } = await newSession(browser, EDITOR);
  try {
    await gotoRefs(page);
    await openCard(page, "dept", card.key);
    const texts = {
      a: await getMapSectionText(page, fx.s1a.id),
      b: await getMapSectionText(page, fx.s1b.id),
      c: await getMapSectionText(page, fx.s1c.id),
      d: await getMapSectionText(page, fx.s1d.id),
    };
    check(scn, "dialog 1a chip: Applies now", /Applies now/.test(texts.a), texts.a);
    check(scn, "dialog 1b chip: Check out and apply", /Check out and apply/.test(texts.b), texts.b);
    check(scn, "dialog 1c chip: Notify the checkout holder with the holder name", /Notify the checkout holder/.test(texts.c) && texts.c.includes(HOLDER_NAME), texts.c);
    check(scn, "dialog 1d chip: New draft, publish needed", /New draft/.test(texts.d) && /publish needed/.test(texts.d), texts.d);
    await pickDept(page, REPLACE_DEPT);
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 15000 });
    const forecast = (await page.locator('[data-id="ref-detail-forecast"]').innerText()).replace(/\s+/g, " ");
    check(scn, "forecast lists every outcome", /Applies now/.test(forecast) && /Check out and apply/.test(forecast) && /New draft/.test(forecast) && /Notify/.test(forecast), forecast);
    await shot(page, "s1-dialog-forecast");
    const toast = await applyAndConfirm(page);
    check(scn, "toast summarizes applied, publish needed and notified", /Applied 2/.test(toast) && /To publish 1/.test(toast) && /Notified 1/.test(toast), toast);

    // 결과 검증 - 서버 상태
    const a = { draft: await getNodeValues(ADMIN, fx.s1a.draft), pub: await getNodeValues(ADMIN, fx.s1a.v1) };
    check(scn, "1a: held Draft value replaced, published unchanged", a.draft[0].dept === REPLACE_DEPT && a.pub[0].dept === ORPHAN_DEPT, JSON.stringify(a));
    const b = { draft: await getNodeValues(ADMIN, fx.s1b.draft), pub: await getNodeValues(ADMIN, fx.s1b.v1), holder: await getHolder(ADMIN, fx.s1b.draft) };
    check(scn, "1b: checkout taken by the editor and value replaced, published unchanged", b.holder === EDITOR && b.draft[0].dept === REPLACE_DEPT && b.pub[0].dept === ORPHAN_DEPT, JSON.stringify(b));
    const c = { draft: await getNodeValues(ADMIN, fx.s1c.draft), holder: await getHolder(ADMIN, fx.s1c.draft) };
    check(scn, "1c: nodes unchanged and the holder keeps the checkout", c.draft[0].dept === ORPHAN_DEPT && c.holder === HOLDER, JSON.stringify(c));
    const notices = await getRefFixNotices(HOLDER, fx.s1c.name);
    check(scn, "1c: the holder received ref_fix_requested (as holder)", notices.length >= 1 && notices[0].payload?.as === "holder", `count=${notices.length} payload=${JSON.stringify(notices[0]?.payload)}`);
    const versionsD = await getVersions(ADMIN, fx.s1d.id);
    const cleanup = versionsD.find((v) => v.label === "Reference cleanup");
    check(scn, "1d: a new version labeled 'Reference cleanup' exists", !!cleanup && versionsD.length === before.versionsD + 1, JSON.stringify(versionsD.map((v) => `${v.label}:${v.status}`)));
    if (cleanup) {
      const d = { draft: await getNodeValues(ADMIN, cleanup.id), pub: await getNodeValues(ADMIN, fx.s1d.v1), holder: await getHolder(ADMIN, cleanup.id) };
      check(scn, "1d: the new draft is checked out by the editor, value replaced, published untouched", d.holder === EDITOR && cleanup.status === "draft" && d.draft[0].dept === REPLACE_DEPT && d.pub[0].dept === ORPHAN_DEPT, JSON.stringify({ ...d, status: cleanup.status }));
    }
    const dPub = (await getVersions(ADMIN, fx.s1d.id)).find((v) => v.id === fx.s1d.v1);
    check(scn, "1d: published version status untouched", dPub?.status === "published", dPub?.status);

    // 적용 뒤 - 게시 대기·알림 줄 표시
    const after = await getAudit(EDITOR);
    const afterCard = findCard(after, "dept", ORPHAN_DEPT);
    const afterOutcome = (m) => lineOfMap(afterCard, m.id)?.outcome;
    // 같은 줄을 다시 적용해도 새 Draft를 또 만들거나 게시본을 쓰지 않는다(이미 바뀐 줄·게시 대기 줄은 건너뜀)
    const again = await api(EDITOR, "POST", "/ref-audit/apply", { kind: "dept", mode: "replace", to_value: REPLACE_DEPT_PATH, targets });
    const versionsAfter = await getVersions(ADMIN, fx.s1d.id);
    const pubA = await getNodeValues(ADMIN, fx.s1a.v1);
    const pubD = await getNodeValues(ADMIN, fx.s1d.v1);
    check(scn, "re-applying the same lines writes nothing new (no extra draft, published untouched)", (again.places.direct ?? 0) === 0 && (again.places.checkout ?? 0) === 0 && (again.places.new_draft ?? 0) === 0 && again.drafts.length === 0 && versionsAfter.length === before.versionsD + 1 && pubA[0].dept === ORPHAN_DEPT && pubD[0].dept === ORPHAN_DEPT, JSON.stringify(again));
    check(scn, "after: 1a/1b/1d lines are pending (awaiting publish), 1c still notify", afterOutcome(fx.s1a) === "pending" && afterOutcome(fx.s1b) === "pending" && afterOutcome(fx.s1d) === "pending" && afterOutcome(fx.s1c) === "notify", [fx.s1a, fx.s1b, fx.s1c, fx.s1d].map(afterOutcome).join(","));
    await page.waitForTimeout(500);
    await openCard(page, "dept", ORPHAN_DEPT);
    const textD = await getMapSectionText(page, fx.s1d.id);
    check(scn, "after: UI line for 1d shows Awaiting publish", /Awaiting publish/.test(textD), textD);
    await shot(page, "s1-after-awaiting-publish");
  } finally {
    await ctx.close();
  }
  await checkInboxRefFix(browser, scn, HOLDER, fx.s1c.id, "1c holder", "s1-holder-inbox");
}

async function runS2(browser) {
  currentScn = "S2";
  const scn = "S2";
  const audit = await getAudit(EDITOR);
  const card = findCard(audit, "user", ghost("s2"));
  const line = lineOfMap(card, fx.s2.id);
  check(scn, "editor (not owner): departed Editor collaborator -> approval", line?.outcome === "approval", JSON.stringify({ outcome: line?.outcome, source: line?.source, role: line?.map_role }));
  const { ctx, page } = await newSession(browser, EDITOR);
  try {
    await gotoRefs(page);
    await openCard(page, "user", card.key);
    await pickPerson(page, NEW_PERSON_NAME);
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 15000 });
    const text = await getMapSectionText(page, fx.s2.id);
    check(scn, "dialog chip: Approval request", /Approval request/.test(text), text);
    await shot(page, "s2-approval-dialog");
    const toast = await applyAndConfirm(page);
    check(scn, "toast reports an approval request", /Approval requests 1/.test(toast), toast);
  } finally {
    await ctx.close();
  }
  const grants = await api(OWNER, "GET", `/maps/${fx.s2.id}/permissions`);
  const newGrant = grants.find((g) => g.principal_id === NEW_PERSON);
  const oldGrant = grants.find((g) => g.principal_id === ghost("s2"));
  check(scn, "new person's Editor grant exists immediately", newGrant?.role === "editor", JSON.stringify(newGrant));
  check(scn, "departed grant still exists until approved", !!oldGrant, JSON.stringify(oldGrant));
  const requests = await api(OWNER, "GET", `/maps/${fx.s2.id}/approval-requests`);
  const request = requests.find((r) => r.kind === "permission_downgrade" && r.payload?.principal_id === ghost("s2"));
  check(scn, "a pending permission_downgrade request removes the departed grant", request?.status === "pending" && request?.requested_by === EDITOR, JSON.stringify(request));
}

async function runS3(browser) {
  currentScn = "S3";
  const scn = "S3";
  const audit = await getAudit(EDITOR);
  const card = findCard(audit, "user", ghost("s3"));
  const line = lineOfMap(card, fx.s3.id);
  check(scn, "editor: departed approver -> notify owner (name shown)", line?.outcome === "notify" && line?.notify_to?.role === "owner" && line?.notify_to?.name === OWNER_NAME, JSON.stringify(line?.notify_to));
  const { ctx, page } = await newSession(browser, EDITOR);
  try {
    await gotoRefs(page);
    await openCard(page, "user", card.key);
    const text = await getMapSectionText(page, fx.s3.id);
    check(scn, "dialog chip: Notify owner with the owner's name", /Notify owner/.test(text) && text.includes(OWNER_NAME), text);
    await page.locator('[data-id="ref-detail-mode-remove"]').click();
    await shot(page, "s3-notify-owner-dialog");
    const toast = await applyAndConfirm(page);
    check(scn, "toast reports a notification", /Notified 1/.test(toast), toast);
  } finally {
    await ctx.close();
  }
  const notices = await getRefFixNotices(OWNER, fx.s3.name);
  check(scn, "the owner received ref_fix_requested (as owner)", notices.length >= 1 && notices[0].payload?.as === "owner", `count=${notices.length} payload=${JSON.stringify(notices[0]?.payload)}`);
  const approvers = await api(OWNER, "GET", `/maps/${fx.s3.id}/approvers`);
  check(scn, "approver list unchanged (departed approver still present)", approvers.includes(ghost("s3")) && approvers.includes(APPROVER), JSON.stringify(approvers));
  await checkInboxRefFix(browser, scn, OWNER, fx.s3.id, "owner");
}

async function runS5(browser) {
  currentScn = "S5";
  const scn = "S5";
  const audit = await getAudit(OWNER);
  const card = findCard(audit, "dept", ORPHAN_OWNING_LEAF);
  const line = lineOfMap(card, fx.s5.id);
  check(scn, "owner: orphan owning department -> direct", line?.source === "owning_dept" && line?.outcome === "direct" && line?.map_role === "owner", JSON.stringify({ source: line?.source, outcome: line?.outcome, role: line?.map_role }));
  const { ctx, page } = await newSession(browser, OWNER);
  try {
    await gotoRefs(page);
    await openCard(page, "dept", card.key);
    const text = await getMapSectionText(page, fx.s5.id);
    check(scn, "dialog chip: Applies now", /Applies now/.test(text), text);
    check(scn, "remove button is disabled on a department card", await page.locator('[data-id="ref-detail-mode-remove"]').isDisabled());
    await pickDept(page, REPLACE_DEPT);
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 15000 });
    await shot(page, "s5-owning-dept-dialog");
    const toast = await applyAndConfirm(page);
    check(scn, "toast reports the applied place", /Applied 1/.test(toast), toast);
  } finally {
    await ctx.close();
  }
  const updated = await api(OWNER, "GET", `/maps/${fx.s5.id}`);
  check(scn, "owning department updated to the picked department", typeof updated.owning_department === "string" && updated.owning_department.endsWith(REPLACE_DEPT), `owning_department=${updated.owning_department}`);
}

async function runS7(browser) {
  currentScn = "S7";
  const scn = "S7";
  const audit = await getAudit(GROUP_MGR);
  const card = findCard(audit, "user", ghost("s7"));
  const line = card?.lines.find((l) => l.group_id === fx.s7.id);
  check(scn, "group manager (non-sysadmin): departed member line is visible and direct", !!line && line.outcome === "direct" && (line.source === "group_user" || line.source === "group_member"), JSON.stringify({ source: line?.source, outcome: line?.outcome }));
  const other = await getAudit(GROUP_OTHER);
  check(scn, "a user who does not manage the group does not see the line", !findCard(other, "user", ghost("s7")), `cards=${other.users.map((c) => c.label).join(",")}`);
  // 관리자가 아닌 사용자가 같은 줄을 API로 적용해도 건너뛰고 멤버는 그대로다
  const intruder = await api(GROUP_OTHER, "POST", "/ref-audit/apply", {
    kind: "user", mode: "replace", to_value: NEW_PERSON, targets: [{ target_id: line.target_id, from_value: line.from_value }],
  });
  const membersAfterIntruder = (await api(GROUP_MGR, "GET", `/groups/${fx.s7.id}`)).members.map((m) => m.member_id);
  check(scn, "a non-manager's direct apply call is skipped and the group is unchanged", intruder.skipped.length === 1 && Object.keys(intruder.places).length === 0 && membersAfterIntruder.includes(ghost("s7")) && !membersAfterIntruder.includes(NEW_PERSON), JSON.stringify({ intruder, membersAfterIntruder }));
  const { ctx, page } = await newSession(browser, GROUP_MGR);
  try {
    await gotoRefs(page);
    await openCard(page, "user", card.key);
    await pickPerson(page, NEW_PERSON_NAME);
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 15000 });
    const dialogText = (await page.locator('[data-id="ref-detail-dialog"]').innerText()).replace(/\s+/g, " ");
    check(scn, "dialog shows the group line with Applies now", /Applies now/.test(dialogText) && dialogText.includes(fx.s7.name), dialogText.slice(0, 300));
    await shot(page, "s7-group-dialog");
    const toast = await applyAndConfirm(page);
    check(scn, "toast reports the applied place", /Applied 1/.test(toast), toast);
  } finally {
    await ctx.close();
  }
  const group = await api(GROUP_MGR, "GET", `/groups/${fx.s7.id}`);
  const members = group.members.map((m) => m.member_id);
  check(scn, "group member replaced (departed gone, replacement present, others kept)", !members.includes(ghost("s7")) && members.includes(NEW_PERSON) && GROUP_MEMBERS.every((id) => members.includes(id)), JSON.stringify(members));
}

// ── 실행 ──────────────────────────────────────────────────────────────────
let browser;
try {
  await purgeFixtures();
  await seedAll();
  console.log(`seeded tag=${tag}`);
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // 순서: 읽기 전용·되돌릴 수 없는 변경 전 시나리오를 먼저(S9은 S1 변경 전 낡은 참조가 있는 카드가 필요)
  const steps = [
    ["S6", runS6], ["S9", runS9], ["S8", runS8NoDot], ["S4", runS4], ["S1", runS1],
    ["S2", runS2], ["S3", runS3], ["S5", runS5], ["S7", runS7], ["S8", runS8Fixer],
  ];
  for (const [scn, run] of steps) {
    try {
      await run(browser);
    } catch (error) {
      check(scn, "scenario aborted", false, error instanceof Error ? error.stack?.split("\n").slice(0, 4).join(" | ") : String(error));
    }
  }
} catch (error) {
  check("setup", "seed or launch failed", false, error instanceof Error ? error.stack : String(error));
} finally {
  if (browser) await browser.close();
  if (!KEEP) {
    try {
      await purgeFixtures();
    } catch (error) {
      console.log(`WARN purge failed - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log("\n== summary ==");
let failedScenarios = 0;
for (const scn of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "setup"]) {
  const entry = results.get(scn);
  if (!entry) continue;
  if (entry.failures > 0) failedScenarios += 1;
  console.log(`${entry.failures === 0 ? "PASS" : "FAIL"} ${scn} (${entry.checks.length - entry.failures}/${entry.checks.length})`);
}
console.log(`console/page errors: ${problems.length}`);
for (const p of problems) console.log(`  ${p}`);
console.log(`5xx responses: ${serverErrors.length}`);
for (const p of serverErrors) console.log(`  ${p}`);
console.log(`/api/ref-audit* 4xx/5xx responses: ${refAuditHttpErrors.length}`);
for (const p of refAuditHttpErrors) console.log(`  ${p}`);
const clean = failedScenarios === 0 && problems.length === 0 && serverErrors.length === 0 && refAuditHttpErrors.length === 0;
console.log(clean ? "\nALL PASS" : `\n${failedScenarios} scenario(s) failed`);
process.exit(clean ? 0 : 1);
