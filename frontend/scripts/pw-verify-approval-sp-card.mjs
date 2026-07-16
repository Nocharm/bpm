// 승인 탭 서브프로세스 지정 카드 노출 — 브라우저 실기동 검증 (workflow-improvements Task 3).
// 시나리오: ①게시본(오너/sysadmin): 승인 탭에 sp-inspector-card 노출·Designate 활성·클릭 시 지정 모달 진입
//           ②미게시본(draft): 승인 탭에 카드 노출되되 Designate 비활성 + 사유 노트(spNeedPublishedOpen)
//           ③콘솔 에러 0
//
// 실행 (frontend/ 에서): node scripts/pw-verify-approval-sp-card.mjs
// 전제:
//   backend :8000  — cd backend && .venv/bin/python -m scripts.reset_db && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 — cd frontend && npm run dev   (좀비 먼저: pkill -f "next dev")
//   playwright-core — npm i --no-save playwright-core
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-approval-sp-card";
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

const openEditor = async (mapId, versionId) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
};

const openApprovalTab = async () => {
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.waitForSelector('[data-id="sp-inspector-card"]', { timeout: 8000 });
};

async function publishVersion(mapId, versionId, approver) {
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: [approver] } });
  await api(`/versions/${versionId}/submit`, { method: "POST" });
  await api(`/versions/${versionId}/approve`, { method: "POST", user: approver });
  await api(`/versions/${versionId}/publish`, { method: "POST" });
}

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

let mapPubId = null;
let mapDraftId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees");

  const buildGraph = () => {
    const s = rid();
    const e = rid();
    return {
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
        { id: e, title: "End", node_type: "end", pos_x: 400, pos_y: 200, sort_order: 1, is_primary_end: true },
      ],
      edges: [{ id: rid(), source_node_id: s, target_node_id: e }],
      groups: [],
    };
  };

  // ═══ 시나리오 ① — 게시본 맵: 승인 탭 카드 활성 + 지정 모달 진입 ═══
  const mapPub = await api("/maps", {
    method: "POST",
    body: { name: `Approval-SP Pub ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapPubId = mapPub.id;
  const vPub = mapPub.versions[0].id;
  await api(`/versions/${vPub}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vPub}/graph`, { method: "PUT", body: buildGraph() });
  await publishVersion(mapPubId, vPub, approver);
  const pubDetail = await api(`/maps/${mapPubId}`);
  check("map (pub): v1 published", pubDetail.versions.find((v) => v.id === vPub)?.status === "published");

  await openEditor(mapPubId, vPub);
  await openApprovalTab();
  check("published: sp-inspector-card visible in Approval tab", await page.locator('[data-id="sp-inspector-card"]').isVisible());

  const designateBtn = page.locator('[data-id="sp-inspector-designate"]');
  check("published: Designate button present", (await designateBtn.count()) === 1);
  check("published: Designate button enabled (owner + published)", await designateBtn.isEnabled());
  await page.screenshot({ path: `${SHOTS}/01-approval-card-published.png`, fullPage: true });

  await designateBtn.click();
  const modalOpened = await page
    .waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("published: clicking Designate opens the designation modal from the Approval tab", modalOpened);
  await page.screenshot({ path: `${SHOTS}/02-designation-modal.png` });
  // 모달 닫기 (저장은 department 피커 상호작용이라 이 검증 범위 밖)
  await page.locator('[data-id="subprocess-designation-modal"] button', { hasText: "Cancel" }).first().click().catch(() => {});
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 5000 }).catch(() => {});

  // ═══ 시나리오 ② — 미게시(draft) 맵: 카드 노출 + Designate 비활성 + 사유 노트 ═══
  const mapDraft = await api("/maps", {
    method: "POST",
    body: { name: `Approval-SP Draft ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapDraftId = mapDraft.id;
  const vDraft = mapDraft.versions[0].id;
  await api(`/versions/${vDraft}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vDraft}/graph`, { method: "PUT", body: buildGraph() });

  await openEditor(mapDraftId, vDraft);
  await openApprovalTab();
  check("draft: sp-inspector-card visible in Approval tab", await page.locator('[data-id="sp-inspector-card"]').isVisible());
  check("draft: Designate button disabled (not published)", await page.locator('[data-id="sp-inspector-designate"]').isDisabled());
  const reason = page.locator('[data-id="sp-inspector-reason"]');
  const reasonVisible = await reason.isVisible().catch(() => false);
  const reasonText = reasonVisible ? await reason.innerText() : "";
  check(
    "draft: disabled reason note shown (published-version hint)",
    reasonVisible && /published version/i.test(reasonText),
    `reason="${reasonText}"`,
  );
  await page.screenshot({ path: `${SHOTS}/03-approval-card-draft.png`, fullPage: true });
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapPubId !== null) await api(`/maps/${mapPubId}`, { method: "DELETE" }).catch(() => {});
  if (mapDraftId !== null) await api(`/maps/${mapDraftId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
