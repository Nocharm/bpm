// 편집·SP·비교 잔여 화면 검증 (리뷰 2026-10-19 7b) — 설정 패널 제출 체크리스트(F-4), L5 확정 변경 요약 계보(F-5),
// 비교 화면 지름길 변(W-2), 열람권 없는 SP의 등록 요청·버전 피커(W-5), 펼친 SP 자식의 F2(W-7), 대시보드 누적(W-8, 캡처).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 SQLITE_DB=../backend/dev.db node scripts/pw-verify-editor-followups.mjs
//   F-5는 임포트 캔버스처럼 노드에 계보 키가 있어야 재현돼 SQLITE_DB(로컬 dev.db)로 시드 캔버스 draft 노드에 계보를 넣는다(없으면 건너뜀).
//   산출물은 저장소 루트 .shots/editor-followups-*.png (gitignore). 시드 맵은 휴지통으로, 분류는 지운다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys, 디렉터리에 활성 직원 1명 이상.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const SQLITE_DB = process.env.SQLITE_DB ?? null;
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
const OTHER = directory.users.find((u) => u.id !== ADMIN && u.org_path)?.id;
const cleanupMaps = [];
const cleanupCats = [];
const cleanupSlots = [];

const n = (id, title, node_type, x, y = 0, extra = {}) => ({ id, title, node_type, pos_x: x, pos_y: y, ...extra });
const e = (id, s, t, label = "", extra = {}) => ({ id, source_node_id: s, target_node_id: t, label, ...extra });
async function newMap(name, visibility = "private") {
  const map = await api(ADMIN, "POST", "/api/maps", { name, owning_department: owning, visibility });
  cleanupMaps.push(map.id);
  const draft = (await api(ADMIN, "GET", `/api/maps/${map.id}`)).versions.find((v) => v.status === "draft").id;
  await api(ADMIN, "PUT", `/api/maps/${map.id}/approvers`, { user_ids: [ADMIN] });
  await api(ADMIN, "POST", `/api/versions/${draft}/checkout`, { force: true });
  return { id: map.id, draft };
}
async function publish(versionId) {
  for (const step of ["submit", "approve", "publish"]) await api(ADMIN, "POST", `/api/versions/${versionId}/${step}`, {});
}
const straight = (p) => ({
  nodes: [n(`${p}s`, "Start", "start", 0), n(`${p}t`, "작업", "process", 220), n(`${p}e`, "", "end", 440)],
  edges: [e(`${p}1`, `${p}s`, `${p}t`), e(`${p}2`, `${p}t`, `${p}e`)],
  groups: [],
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function pageAs(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([u, lang]) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", lang);
  }, [user, LANG]);
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR", String(err).slice(0, 200)));
  return page;
}
const approvalTab = (page) => page.locator(`button[aria-label="${LANG === "ko" ? "승인" : "Approval"}"]`).first();

try {
  // ── F-4 설정 패널 제출도 저장 체크리스트를 거친다 ─────────────────────
  const fan = await newMap(`Followups fanout ${tag}`);
  await api(ADMIN, "PUT", `/api/versions/${fan.draft}/graph`, {
    nodes: [n(`f4s${tag}`, "Start", "start", 0), n(`f4a${tag}`, "작업", "process", 220), n(`f4b${tag}`, "곁가지", "process", 440, 120), n(`f4e${tag}`, "", "end", 660)],
    edges: [e(`f41${tag}`, `f4s${tag}`, `f4a${tag}`), e(`f42${tag}`, `f4a${tag}`, `f4e${tag}`), e(`f43${tag}`, `f4a${tag}`, `f4b${tag}`), e(`f44${tag}`, `f4b${tag}`, `f4e${tag}`)],
    groups: [],
  });
  const settings = await pageAs(ADMIN);
  const submits = [];
  settings.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith(`/versions/${fan.draft}/submit`)) submits.push(r.url());
  });
  await settings.goto(`${BASE}/maps/${fan.id}/settings`, { waitUntil: "domcontentloaded" });
  await settings.locator('[data-id="settings-nav-versions"]').click();
  const submitBtn = settings.getByRole("button", { name: LANG === "ko" ? "승인 요청" : "Request approval" }).first();
  await submitBtn.waitFor({ timeout: 30_000 });
  await submitBtn.click();
  const blocked = settings.getByText(LANG === "ko" ? "저장 불가 - 미충족" : "Cannot save - unmet", { exact: false });
  await blocked.first().waitFor({ timeout: 10_000 }).catch(() => undefined); // 안 뜨면 아래 단언이 실패로 남긴다
  await settings.waitForTimeout(500);
  check("settings submit stops at the save checklist", submits.length === 0 && (await blocked.count()) >= 1);
  await settings.screenshot({ path: `${OUT}/editor-followups-settings-blocked-${LANG}.png` });

  // ── W-2 비교 화면: 판단 노드 No → 끝 지름길이 가운데 노드를 지나지 않는다 ─────
  const cmp = await newMap(`Followups compare ${tag}`);
  await api(ADMIN, "PUT", `/api/versions/${cmp.draft}/graph`, {
    nodes: [
      n(`w2s${tag}`, "Start", "start", 0), n(`w2d${tag}`, "승인?", "decision", 220), n(`w2t${tag}`, "후속 처리", "process", 440),
      n(`w2e${tag}`, "", "end", 660),
    ],
    edges: [e(`w21${tag}`, `w2s${tag}`, `w2d${tag}`), e(`w22${tag}`, `w2d${tag}`, `w2t${tag}`, "Yes"), e(`w23${tag}`, `w2t${tag}`, `w2e${tag}`), e(`w24${tag}`, `w2d${tag}`, `w2e${tag}`, "No")],
    groups: [],
  });
  await publish(cmp.draft);
  const v2 = await api(ADMIN, "POST", `/api/maps/${cmp.id}/versions`, { label: "v2", source_version_id: cmp.draft });
  const compare = await pageAs(ADMIN);
  await compare.goto(`${BASE}/maps/${cmp.id}/compare?base=${cmp.draft}&target=${v2.id}`, { waitUntil: "domcontentloaded" });
  await compare.locator(".react-flow__node").first().waitFor({ timeout: 60_000 });
  await compare.waitForTimeout(2500);
  const overlap = await compare.evaluate(() => {
    const boxes = [...document.querySelectorAll(".react-flow__node")]
      .filter((el) => el.textContent?.includes("후속 처리"))
      .map((el) => el.getBoundingClientRect());
    const labels = [...document.querySelectorAll(".react-flow *")]
      .filter((el) => el.children.length === 0 && el.textContent?.trim() === "No")
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0);
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { nodes: boxes.length, labels: labels.length, overlaps: labels.some((l) => boxes.some((b) => hit(l, b))) };
  });
  check("compare keeps the No label off the middle node", overlap.labels > 0 && !overlap.overlaps, JSON.stringify(overlap));
  await compare.screenshot({ path: `${OUT}/editor-followups-compare-${LANG}.png` });

  // ── W-5·W-7 열람권 없는 SP / 펼친 SP 자식 ────────────────────────────
  const child = await newMap(`Followups child ${tag}`);
  await api(ADMIN, "PUT", `/api/versions/${child.draft}/graph`, straight(`c${tag}`));
  await publish(child.draft);
  const host = await newMap(`Followups host ${tag}`, "public");
  await api(ADMIN, "PUT", `/api/versions/${host.draft}/graph`, {
    nodes: [
      n(`h${tag}s`, "Start", "start", 0), n(`h${tag}p`, "하위", "subprocess", 260, 0, { linked_map_id: child.id, follow_latest: true }),
      n(`h${tag}e`, "", "end", 560),
    ],
    edges: [
      e(`h${tag}1`, `h${tag}s`, `h${tag}p`, "", { target_handle: "in" }),
      e(`h${tag}2`, `h${tag}p`, `h${tag}e`, "", { source_handle: "__primary__" }),
    ],
    groups: [],
  });
  if (OTHER) {
    await api(ADMIN, "POST", `/api/maps/${host.id}/permissions`, { principal_type: "user", principal_id: OTHER, role: "editor" })
      .catch((err) => { if (!String(err).includes("grant already exists")) throw err; });
    await api(ADMIN, "POST", `/api/versions/${host.draft}/checkout`, { force: true });
    await api(ADMIN, "DELETE", `/api/versions/${host.draft}/checkout`);
    const outsider = await pageAs(OTHER);
    const forbidden = [];
    outsider.on("response", (r) => { if (r.status() === 403) forbidden.push(new URL(r.url()).pathname); });
    await outsider.goto(`${BASE}/maps/${host.id}?version=${host.draft}`, { waitUntil: "domcontentloaded" });
    const spNode = outsider.locator(`.react-flow__node[data-id="h${tag}p"]`);
    await spNode.waitFor({ timeout: 60_000 });
    await outsider.waitForTimeout(1500);
    const before = forbidden.length;
    await spNode.click();
    await outsider.waitForTimeout(1500);
    const cta = await outsider.locator('[data-id="sp-registration-cta"]').count();
    check("locked subprocess shows no registration request and fires no 403", cta === 0 && forbidden.length === before,
      `cta=${cta} new403=${forbidden.slice(before).join(",")}`);
  } else {
    check("locked subprocess shows no registration request and fires no 403", false, "no second directory user");
  }

  // 펼치려면 링크 맵이 서브프로세스로 지정돼 있어야 한다 — 위 W-5는 미지정이라야 등록 요청 버튼이 생기므로 여기서 지정
  const ownDept = (directory.users.find((u) => u.id === ADMIN)?.department) || "Team";
  await api(ADMIN, "PUT", `/api/maps/${child.id}/subprocess-designation`, { department: ownDept });
  const editor = await pageAs(ADMIN);
  await api(ADMIN, "POST", `/api/versions/${host.draft}/checkout`, { force: true });
  await editor.goto(`${BASE}/maps/${host.id}?version=${host.draft}`, { waitUntil: "domcontentloaded" });
  const hostSp = editor.locator(`.react-flow__node[data-id="h${tag}p"]`);
  await hostSp.waitFor({ timeout: 60_000 });
  await editor.waitForTimeout(1500);
  await hostSp.click();
  await editor.locator('[data-id="node-action-expand"]').click({ timeout: 15_000 }).catch(async (err) => {
    await editor.screenshot({ path: `${OUT}/editor-followups-expand-error-${LANG}.png` });
    throw err;
  }); // 선택 노드 액션 바의 펼치기
  const childNode = editor.locator(".react-flow__node").filter({ hasText: "작업" }).first();
  await childNode.waitFor({ timeout: 15_000 });
  await childNode.click();
  await editor.keyboard.press("F2");
  await editor.waitForTimeout(400);
  const editors = await editor.locator(".react-flow__node textarea").count();
  check("F2 on an embedded child does not open a rename box", editors === 0, `textareas=${editors}`);

  // ── F-5 L5 확정 변경 요약이 계보로 맞춘다 ──────────────────────────────
  if (SQLITE_DB) {
    let parent = null;
    const chain = [];
    for (let level = 1; level <= 5; level += 1) {
      const cat = await api(ADMIN, "POST", "/api/categories", { name: `F5 ${tag} L${level}`, parent_id: parent });
      chain.push(cat.id);
      parent = cat.id;
    }
    cleanupCats.push(chain[0]);
    const l6 = [];
    for (const name of ["가", "나"]) {
      const m = await newMap(`Followups L6 ${name} ${tag}`, "public");
      await api(ADMIN, "PUT", `/api/versions/${m.draft}/graph`, straight(`l6${name}${tag}`));
      await publish(m.draft);
      await api(ADMIN, "POST", `/api/maps/${m.id}/slot-changes`, { action: "assign", to_category_id: chain[4] });
      l6.push(m.id);
      cleanupSlots.push(m.id);
    }
    const canvas = (await api(ADMIN, "POST", `/api/categories/${chain[4]}/linkage-map`)).map_id;
    cleanupMaps.push(canvas);
    const canvasDraft = (await api(ADMIN, "GET", `/api/maps/${canvas}`)).versions.find((v) => v.status === "draft").id;
    await api(ADMIN, "POST", `/api/versions/${canvasDraft}/checkout`, { force: true });
    const cg = await api(ADMIN, "GET", `/api/versions/${canvasDraft}/graph`);
    const [a, b] = cg.nodes;
    await api(ADMIN, "PUT", `/api/versions/${canvasDraft}/graph`, {
      nodes: cg.nodes, groups: [],
      edges: [e(`f5${tag}`, a.id, b.id, "", { source_handle: "__primary__", target_handle: "in" })],
    });
    // 임포트 캔버스처럼 계보 키를 단다(PUT은 source_node_id를 받지 않는다)
    execFileSync("sqlite3", [SQLITE_DB, `update nodes set source_node_id = 'lin-' || id where version_id = ${canvasDraft};`]);
    await api(ADMIN, "POST", `/api/maps/${canvas}/framework-confirm`, { major: false });
    const fw = await pageAs(ADMIN);
    await fw.goto(`${BASE}/maps/${canvas}`, { waitUntil: "domcontentloaded" });
    await fw.locator(".react-flow__node").first().waitFor({ timeout: 60_000 });
    await approvalTab(fw).click();
    await fw.locator('[data-id="framework-confirm-button"]').waitFor({ timeout: 30_000 });
    await fw.waitForTimeout(2500);
    const noChanges = await fw.locator('[data-id="framework-no-changes"]').count();
    const summary = await fw.locator('[data-id="framework-change-summary"]').count();
    const disabled = await fw.locator('[data-id="framework-confirm-button"]').isDisabled();
    check("unchanged L5 canvas reads as no changes after confirm", noChanges === 1 && summary === 0 && disabled,
      `noChanges=${noChanges} summary=${summary} disabled=${disabled}`);
    await fw.screenshot({ path: `${OUT}/editor-followups-fw-nochange-${LANG}.png` });
  } else {
    console.log("SKIP F-5 (no SQLITE_DB)");
  }

  // ── W-8 대시보드 누적 그래프(캡처) ─────────────────────────────────────
  const dash = await pageAs(ADMIN);
  await dash.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await dash.locator('[data-id="dashboard-growth"]').waitFor({ timeout: 60_000 }).catch(() => undefined);
  await dash.waitForTimeout(1500);
  if ((await dash.locator('[data-id="dashboard-growth"]').count()) > 0) {
    await dash.locator('[data-id="dashboard-growth"]').screenshot({ path: `${OUT}/editor-followups-growth-${LANG}.png` });
  }
} finally {
  await browser.close();
  for (const id of cleanupSlots) await api(ADMIN, "POST", `/api/maps/${id}/slot-changes`, { action: "unassign" }).catch(() => undefined);
  for (const id of cleanupMaps) await api(ADMIN, "DELETE", `/api/maps/${id}`).catch(() => undefined);
  for (const id of cleanupCats) await api(ADMIN, "DELETE", `/api/categories/${id}`).catch(() => undefined);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
