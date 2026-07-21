// 셀프 게시(승인자=본인 1인) 팝오버 — 브라우저 실기동 검증.
// 시나리오: ①승인자 2인: 승인요청 클릭 → 팝오버 없음, 기존 확인 모달 직행
//           ②승인자 [본인]: 클릭 → 클릭 지점 근처에 팝오버 노출
//           ③Escape → 팝오버만 닫힘(모달 없음), 상태 draft 유지
//           ④No → 기존 승인요청 확인 모달로 진행(Cancel 후 draft 유지)
//           ⑤Yes → submit→approve→publish 일괄, 워크플로 status published
//           ⑥콘솔 에러 0
//
// 실행 (frontend/ 에서): node scripts/pw-verify-self-publish.mjs
// 전제:
//   backend :8000  — cd backend && .venv/bin/python -m scripts.reset_db && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 — cd frontend && npm run dev   (좀비 먼저: pkill -f "next dev")
//   playwright-core — npm i --no-save playwright-core
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-self-publish";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

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

const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// ── 서버 프로브 ──
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

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const other = dir0.users.find((u) => u.id !== "admin.sys")?.id;
  if (!other) throw new Error("directory needs a second employee");

  const s = rid();
  const e = rid();
  const graph = {
    nodes: [
      { id: s, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
      { id: e, title: "End", node_type: "end", pos_x: 400, pos_y: 200, sort_order: 1, is_primary_end: true },
    ],
    edges: [{ id: rid(), source_node_id: s, target_node_id: e }],
    groups: [],
  };

  const map = await api("/maps", {
    method: "POST",
    body: { name: `Self-Publish ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = map.id;
  const vid = map.versions[0].id;
  await api(`/versions/${vid}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vid}/graph`, { method: "PUT", body: graph });

  const submitBtn = page.getByRole("button", { name: "Submit for approval" });
  const popover = page.locator('[data-id="self-publish-popover"]');
  const confirmTitle = page.getByText("Request approval", { exact: true });
  const cancelBtn = page.locator('[data-id="confirm-dialog-cancel"]');

  const openApproval = async () => {
    await page.goto(`${BASE}/maps/${mapId}?version=${vid}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".react-flow__node", { timeout: 20000 });
    await page.locator('button[aria-label="Approval"]').first().click();
    await submitBtn.waitFor({ timeout: 8000 });
  };

  // ═══ ① 승인자 2인 — 팝오버 없이 기존 확인 모달 직행 ═══
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: ["admin.sys", other] } });
  await openApproval();
  await submitBtn.click();
  await confirmTitle.waitFor({ timeout: 8000 });
  check("two approvers: regular confirm dialog opens", await confirmTitle.isVisible());
  check("two approvers: no self-publish popover", (await popover.count()) === 0);
  await page.screenshot({ path: `${SHOTS}/01-two-approvers-dialog.png` });
  await cancelBtn.click();

  // ═══ ② 승인자 [본인] — 클릭 지점 근처 팝오버 ═══
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: ["admin.sys"] } });
  await openApproval(); // 재로딩으로 workflow 재조회(승인자 변경 반영)
  const btnBox = await submitBtn.boundingBox();
  await submitBtn.click();
  await popover.waitFor({ timeout: 8000 });
  check("sole self approver: popover appears", await popover.isVisible());
  const popBox = await popover.boundingBox();
  const clickX = btnBox.x + btnBox.width / 2;
  const clickY = btnBox.y + btnBox.height / 2;
  const near =
    popBox !== null &&
    Math.abs(popBox.x - clickX) < 320 &&
    Math.abs(popBox.y - clickY) < 200;
  check("popover positioned near the click point", near, `click=(${clickX},${clickY}) pop=(${popBox?.x},${popBox?.y})`);
  check("popover shows sole-approver message", await popover.getByText("You are the only approver").isVisible());
  await page.screenshot({ path: `${SHOTS}/02-popover.png` });

  // ═══ ③ Escape — 팝오버만 닫힘, 모달 없음, draft 유지 ═══
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "detached", timeout: 4000 });
  check("escape: popover dismissed", (await popover.count()) === 0);
  check("escape: no confirm dialog", (await confirmTitle.count()) === 0);
  let wf = await api(`/versions/${vid}/workflow`);
  check("escape: status stays draft", wf.status === "draft", `status=${wf.status}`);

  // ═══ ④ No — 기존 승인요청 확인 모달로 진행 ═══
  await submitBtn.click();
  await popover.waitFor({ timeout: 8000 });
  await popover.locator('[data-id="self-publish-no"]').click();
  await confirmTitle.waitFor({ timeout: 8000 });
  check("no: falls back to regular confirm dialog", await confirmTitle.isVisible());
  check("no: popover closed", (await popover.count()) === 0);
  await page.screenshot({ path: `${SHOTS}/03-no-fallback-dialog.png` });
  await cancelBtn.click();
  wf = await api(`/versions/${vid}/workflow`);
  check("no+cancel: status stays draft", wf.status === "draft", `status=${wf.status}`);

  // ═══ ⑤ Yes — 승인요청→승인→게시 일괄 ═══
  await submitBtn.click();
  await popover.waitFor({ timeout: 8000 });
  await popover.locator('[data-id="self-publish-yes"]').click();
  let published = false;
  for (let i = 0; i < 20; i += 1) {
    wf = await api(`/versions/${vid}/workflow`);
    if (wf.status === "published") {
      published = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  check("yes: version reaches published in one go", published, `status=${wf.status}`);
  check("yes: self approval recorded", wf.approvals.includes("admin.sys"), `approvals=${JSON.stringify(wf.approvals)}`);
  await page.waitForTimeout(800);
  check("yes: submit button gone after publish", (await submitBtn.count()) === 0);
  await page.screenshot({ path: `${SHOTS}/04-published.png`, fullPage: true });
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
