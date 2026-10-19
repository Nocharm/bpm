// 에디터 이탈 확인창 검증 (리뷰 2026-10-19 W-1·E-11) — 편집 직후(자동저장 2초 전) 앱 안 이동이 확인창에 붙잡히고,
// 머무르기·저장하고 이동·저장하지 않고 이동·뒤로 가기·L5 확정이 각각 기대대로 저장되는지 서버 그래프로 확인한다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-leave-guard.mjs
//   FW_MAP=<L5 캔버스 맵 id> 이면 그 캔버스로 확정 전 저장(E-11)까지 본다(확정 게이트 통과·draft 보유 캔버스, 확정 스냅샷이 하나 생긴다).
//   산출물은 저장소 루트 .shots/leave-guard-*.png (gitignore).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const LANG = process.env.PW_LANG ?? "ko";
const FW_MAP = process.env.FW_MAP ? Number(process.env.FW_MAP) : null;
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
// 자동저장 디바운스(2초)보다 넉넉히 — 이 시간 안에 PUT이 없으면 "멈췄다"로 본다
const PAST_AUTOSAVE_MS = 2800;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// ---- 시드: 시작 → 작업 → 끝 ----
const tag = Date.now().toString(36);
const TASK = `leave-${tag}-task`;
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0])?.org_path;
for (const stale of (await api("GET", "/api/maps")).filter((m) => m.name.startsWith("Leave guard smoke"))) {
  await api("DELETE", `/api/maps/${stale.id}`).catch(() => undefined);
}
const map = await api("POST", "/api/maps", { name: `Leave guard smoke ${tag}`, owning_department: owning, visibility: "private" });
const detail = await api("GET", `/api/maps/${map.id}`);
const draft = (detail.versions ?? []).find((v) => v.status === "draft") ?? detail.versions[0];
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    { id: `leave-${tag}-start`, title: "Start", node_type: "start", pos_x: 0, pos_y: 100 },
    { id: TASK, title: "Original", node_type: "process", pos_x: 260, pos_y: 100 },
    { id: `leave-${tag}-end`, title: "", node_type: "end", pos_x: 560, pos_y: 100 },
  ],
  edges: [
    { id: `leave-${tag}-e1`, source_node_id: `leave-${tag}-start`, target_node_id: TASK, label: "" },
    { id: `leave-${tag}-e2`, source_node_id: TASK, target_node_id: `leave-${tag}-end`, label: "" },
  ],
  groups: [],
});
const EDITOR = `/maps/${map.id}?version=${draft.id}`;
const serverTitle = async () =>
  (await api("GET", `/api/versions/${draft.id}/graph`)).nodes.find((n) => n.id === TASK)?.title;

// ---- 브라우저 ----
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript((lang) => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", lang);
}, LANG);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
const requests = [];
page.on("request", (r) => {
  if (r.url().includes("/api/")) requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
});
const graphPuts = () => requests.filter((r) => r === `PUT /api/versions/${draft.id}/graph`).length;
const dialog = page.locator('[data-id="editor-leave-confirm"]');
const onEditor = () => new URL(page.url()).pathname === `/maps/${map.id}`;

async function openEditor() {
  await page.goto(`${BASE}${EDITOR}`, { waitUntil: "domcontentloaded" });
  await page.locator(`.react-flow__node[data-id="${TASK}"]`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
}
async function rename(title) {
  await page.locator(`.react-flow__node[data-id="${TASK}"]`).click();
  await page.keyboard.press("F2");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150); // 리뷰 재현과 같은 간격 — 자동저장(2초) 훨씬 전
}

try {
  // 1) 편집이 없으면 그냥 이동한다
  await openEditor();
  await page.locator('nav a[href="/notices"]').click();
  await page.waitForURL(/\/notices/, { timeout: 15_000 });
  check("clean editor leaves without a dialog", (await dialog.count()) === 0, page.url());

  // 2) 머무르기 — 묻는 동안 자동저장이 멈췄다가 머무르면 다시 걸린다
  await openEditor();
  let puts = graphPuts();
  await rename("Stay edit");
  await page.locator('nav a[href="/"][aria-current="page"]').click();
  await dialog.waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT}/leave-guard-dialog-${LANG}.png` });
  check("Maps tab is held by the dialog", onEditor(), page.url());
  await page.waitForTimeout(PAST_AUTOSAVE_MS);
  check("autosave stays paused while asking", graphPuts() === puts, `PUT ${graphPuts() - puts}`);
  await page.locator('[data-id="confirm-dialog-cancel"]').click();
  await page.waitForTimeout(PAST_AUTOSAVE_MS);
  check("Stay resumes the autosave", graphPuts() === puts + 1 && (await serverTitle()) === "Stay edit",
    `PUT ${graphPuts() - puts} title=${await serverTitle()}`);

  // 3) 저장하고 이동 — 링크
  puts = graphPuts();
  await rename("Saved edit");
  await page.locator('nav a[href="/notices"]').click();
  await dialog.waitFor({ timeout: 5000 });
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForURL(/\/notices/, { timeout: 15_000 });
  check("Save and leave saves first, then follows the link",
    graphPuts() === puts + 1 && (await serverTitle()) === "Saved edit", `PUT ${graphPuts() - puts} title=${await serverTitle()}`);

  // 4) 저장하지 않고 이동 — 사이드바 맵 설정 링크, 언마운트 저장도 돌지 않는다
  await openEditor();
  puts = graphPuts();
  await rename("Discarded edit");
  await page.locator(`a[href="/maps/${map.id}/settings"]`).first().click();
  await dialog.waitFor({ timeout: 5000 });
  await page.locator('[data-id="confirm-dialog-secondary"]').click();
  await page.waitForURL(new RegExp(`/maps/${map.id}/settings`), { timeout: 15_000 });
  await page.waitForTimeout(PAST_AUTOSAVE_MS);
  check("Leave without saving drops the last edit", graphPuts() === puts && (await serverTitle()) === "Saved edit",
    `PUT ${graphPuts() - puts} title=${await serverTitle()}`);

  // 5) 버튼 이동(router.push) — 사용자 메뉴 Settings
  await openEditor();
  puts = graphPuts();
  await rename("Button edit");
  await page.locator("nav div.relative > button[aria-label]").last().click();
  await page.locator('[data-id="nav-settings"]').click();
  await dialog.waitFor({ timeout: 5000 });
  check("button navigation is held too", onEditor(), page.url());
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForURL((url) => url.pathname === "/settings", { timeout: 15_000 });
  check("button Save and leave saves first", graphPuts() === puts + 1 && (await serverTitle()) === "Button edit",
    `PUT ${graphPuts() - puts} title=${await serverTitle()}`);

  // 6) 로고 — 링크 자신의 동작(필터 비우고 전체 새로고침)을 그대로 다시 태운다
  await openEditor();
  await page.evaluate(() => window.sessionStorage.setItem("bpm.home.filters", "{\"q\":\"x\"}"));
  await rename("Logo edit");
  await page.locator('nav a[href="/"]').first().click();
  await dialog.waitFor({ timeout: 5000 });
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await page.waitForLoadState("domcontentloaded");
  const filters = await page.evaluate(() => window.sessionStorage.getItem("bpm.home.filters"));
  check("logo replays its own handler after saving", (await serverTitle()) === "Logo edit" && filters === null,
    `title=${await serverTitle()} filters=${filters}`);

  // 7) 브라우저 뒤로 가기(앱 안 기록) — 물을 수 없으니 바로 저장한다. 맵 설정 → "에디터로" 링크로 들어와 기록을 앱 안에 둔다
  await openEditor();
  await page.locator(`a[href="/maps/${map.id}/settings"]`).first().click();
  await page.waitForURL(new RegExp(`/maps/${map.id}/settings`), { timeout: 15_000 });
  await page.locator('[data-id="settings-back-to-editor"]').click();
  await page.locator(`.react-flow__node[data-id="${TASK}"]`).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await rename("Back edit");
  await page.goBack();
  await page.waitForURL(new RegExp(`/maps/${map.id}/settings`), { timeout: 15_000 });
  await page.waitForTimeout(1500);
  check("in-app browser back saves the pending edit", (await serverTitle()) === "Back edit", `title=${await serverTitle()} url=${page.url()}`);

  // 8) L5 확정 — 대기 중인 자동저장을 먼저 비운다 (E-11)
  if (FW_MAP !== null) {
    const fwDetail = await api("GET", `/api/maps/${FW_MAP}`);
    const fwDraft = fwDetail.versions.find((v) => v.status === "draft");
    await api("POST", `/api/versions/${fwDraft.id}/checkout`, { force: true });
    const before = await api("GET", `/api/versions/${fwDraft.id}/graph`);
    const target = before.nodes[0];
    await page.goto(`${BASE}/maps/${FW_MAP}`, { waitUntil: "domcontentloaded" });
    const nodeEl = page.locator(`.react-flow__node[data-id="${target.id}"]`);
    await nodeEl.waitFor({ timeout: 120_000 });
    await page.locator(`button[aria-label="${LANG === "ko" ? "승인" : "Approval"}"]`).first().click();
    const confirmBtn = page.locator('[data-id="framework-confirm-button"]');
    await confirmBtn.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => !document.querySelector('[data-id="framework-confirm-button"]')?.hasAttribute("disabled"), null, { timeout: 30_000 });
    const box = await nodeEl.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 80, { steps: 8 });
    await page.mouse.up();
    const mark = requests.length;
    const confirmResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/maps/${FW_MAP}/framework-confirm`) && r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await confirmBtn.click();
    const confirmStatus = (await confirmResponse).status();
    await page.waitForTimeout(500);
    const after = requests.slice(mark);
    const putAt = after.indexOf(`PUT /api/versions/${fwDraft.id}/graph`);
    const confirmAt = after.indexOf(`POST /api/maps/${FW_MAP}/framework-confirm`);
    const fwVersions = (await api("GET", `/api/maps/${FW_MAP}`)).versions;
    const snap = fwVersions.filter((v) => v.status === "confirmed").sort((a, b) => b.id - a.id)[0];
    const snapNode = snap ? (await api("GET", `/api/versions/${snap.id}/graph`)).nodes.find((n) => n.title === target.title) : null;
    check("confirm saves the pending edit before confirming",
      putAt !== -1 && confirmAt > putAt, `order=${after.filter((r) => r.startsWith("PUT") || r.includes("framework-confirm")).join(" > ")}`);
    check("confirmed snapshot carries the on-screen position",
      confirmStatus === 200 && snapNode != null && snapNode.pos_x !== target.pos_x,
      `status=${confirmStatus} before=${target.pos_x} snapshot=${snapNode?.pos_x} label=${snap?.label}`);
  }
} finally {
  await browser.close();
  await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
