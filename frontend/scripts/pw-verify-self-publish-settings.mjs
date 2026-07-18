// 셀프 게시(승인자=본인 1인) 팝오버 — 설정 페이지 Versions 탭 실기동 검증.
// 시나리오: ①승인자 2인: 승인요청 클릭 → 팝오버 없이 즉시 제출(pending, 기존 동작)
//           ②승인자 [본인]: 클릭 → 클릭 지점 근처 팝오버, Escape → draft 유지
//           ③No → 제출만 진행(pending, 게시 안 됨)
//           ④Yes → submit→approve→publish 일괄, status published
//           ⑤콘솔 에러 0
//
// 실행 (frontend/ 에서): node scripts/pw-verify-self-publish-settings.mjs
// 전제: backend :8000(reset_db 시드) · frontend :3000 · playwright-core (pw-verify-self-publish.mjs와 동일)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-self-publish-settings";
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
    body: { name: `Self-Publish Settings ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = map.id;
  const vid = map.versions[0].id;
  await api(`/versions/${vid}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vid}/graph`, { method: "PUT", body: graph });

  const requestBtn = page.getByRole("button", { name: "Request approval" });
  const popover = page.locator('[data-id="self-publish-popover"]');

  const openVersionsTab = async () => {
    await page.goto(`${BASE}/maps/${mapId}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Versions", exact: true }).first().click();
    await requestBtn.waitFor({ timeout: 8000 });
  };

  // ═══ ① 승인자 2인 — 팝오버 없이 즉시 제출(기존 동작 보존) ═══
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: ["admin.sys", other] } });
  await openVersionsTab();
  await requestBtn.click();
  await page.waitForTimeout(1200);
  check("two approvers: no popover", (await popover.count()) === 0);
  let wf = await api(`/versions/${vid}/workflow`);
  check("two approvers: submitted directly (pending)", wf.status === "pending", `status=${wf.status}`);
  await page.screenshot({ path: `${SHOTS}/01-two-approvers-pending.png` });
  await api(`/versions/${vid}/withdraw`, { method: "POST" }); // draft 복귀

  // ═══ ② 승인자 [본인] — 클릭 지점 근처 팝오버, Escape 취소 ═══
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: ["admin.sys"] } });
  await openVersionsTab();
  // 클릭이 자동 스크롤을 유발하면 사전 측정한 좌표가 틀어진다 — 먼저 스크롤해 두고 측정.
  await requestBtn.scrollIntoViewIfNeeded();
  const btnBox = await requestBtn.boundingBox();
  await requestBtn.click();
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
  await page.screenshot({ path: `${SHOTS}/02-popover.png` });
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "detached", timeout: 4000 });
  wf = await api(`/versions/${vid}/workflow`);
  check("escape: status stays draft", wf.status === "draft", `status=${wf.status}`);

  // ═══ ③ No — 제출만 진행(기존 플로우) ═══
  await requestBtn.click();
  await popover.waitFor({ timeout: 8000 });
  await popover.locator('[data-id="self-publish-no"]').click();
  let pending = false;
  for (let i = 0; i < 10; i += 1) {
    wf = await api(`/versions/${vid}/workflow`);
    if (wf.status === "pending") {
      pending = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  check("no: submit only (pending, not published)", pending && wf.status === "pending", `status=${wf.status}`);
  check("no: nothing approved yet", wf.approvals.length === 0, `approvals=${JSON.stringify(wf.approvals)}`);
  await page.screenshot({ path: `${SHOTS}/03-no-submitted.png` });
  await api(`/versions/${vid}/withdraw`, { method: "POST" }); // draft 복귀

  // ═══ ④ Yes — 승인요청→승인→게시 일괄 ═══
  await openVersionsTab();
  await requestBtn.click();
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
  check("yes: request button gone after publish", (await requestBtn.count()) === 0);
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
