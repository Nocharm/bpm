// SP 라이브러리 패널 신규 진입점 검증 — 우클릭 pane 메뉴 맨 아래 항목 + 전역 S 단축키.
// 시나리오: ①빈 캔버스 우클릭 → 메뉴 맨 아래 "Open subprocess library" 노출 → 클릭 → 패널 열림
//           +검색창 자동포커스 ②캔버스 포커스 상태에서 S → 패널 열림 ③입력창(제목) 포커스 중 S →
//           가드로 무시(패널 안 열림). 시나리오별 reload로 격리, 콘솔 에러 0.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-library-open.mjs
// 전제:
//   backend :8000 — cd backend && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 — cd frontend && npm run dev  (좀비 먼저: pkill -f "next dev")
//   playwright-core — npm i --no-save playwright-core
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en"); // 라벨 매칭을 EN으로 고정
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

const buildGraph = () => {
  const s = rid();
  const e = rid();
  return {
    nodes: [
      { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
      { id: e, title: "End", node_type: "end", pos_x: 650, pos_y: 380, sort_order: 1, is_primary_end: true },
    ],
    edges: [{ id: rid(), source_node_id: s, target_node_id: e }],
    groups: [],
  };
};

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

let hostMapId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  const host = await api("/maps", {
    method: "POST",
    body: { name: `LibOpenTest Host ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  hostMapId = host.id;
  const hostVersionId = host.versions[0].id;
  await api(`/versions/${hostVersionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${hostVersionId}/graph`, { method: "PUT", body: buildGraph() });

  const editorUrl = `${BASE}/maps/${hostMapId}?version=${hostVersionId}`;

  // ── ① 빈 캔버스 우클릭 → pane 메뉴 맨 아래 항목 → 클릭 → 패널 열림 + 검색창 포커스 ──
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  // pane(빈 캔버스) 좌상단 우클릭 — 노드는 캔버스 중앙 부근(flow x:250/650,y:380)이라 여백 확보.
  // 컨텍스트 메뉴 패널 class는 z-[1200]을 백드롭(fixed inset-0 bg-ink/20)과 공유하므로 border-hairline로 구분.
  const pane = page.locator(".react-flow__pane").first();
  await pane.click({ button: "right", position: { x: 100, y: 100 }, force: true });
  await page.waitForTimeout(300);

  const menuText = await page.evaluate(
    () => document.querySelector(".fixed.z-\\[1200\\].border-hairline")?.innerText ?? "",
  );
  check("pane menu shows 'Open subprocess library'", menuText.includes("Open subprocess library"), menuText.slice(-120));

  // 메뉴 맨 아래 항목인지 — 버튼 목록 중 마지막 라벨이 'Open subprocess library'
  const isLast = await page.evaluate(() => {
    const menu = document.querySelector(".fixed.z-\\[1200\\].border-hairline");
    if (!menu) return false;
    const buttons = [...menu.querySelectorAll("button")];
    const last = buttons[buttons.length - 1];
    return !!last && last.textContent?.includes("Open subprocess library");
  });
  check("'Open subprocess library' is the bottom-most menu item", isLast);

  await page.getByRole("button", { name: "Open subprocess library" }).click({ force: true });
  await page.waitForSelector('[data-id="process-library-panel"]', { timeout: 8000 });
  await page.waitForTimeout(300); // 마운트 effect(focus) 반영 대기

  const panelOpenViaMenu = await page.evaluate(
    () => !!document.querySelector('[data-id="process-library-panel"]'),
  );
  check("(a) menu click → library panel opens", panelOpenViaMenu);

  const focusedViaMenu = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search…"]');
    return !!input && document.activeElement === input;
  });
  check("(a) library panel search input auto-focused", focusedViaMenu);

  // ── ② 캔버스 포커스 상태에서 S → 패널 열림 (reload로 격리) ──
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  const panelClosedBeforeS = await page.evaluate(
    () => !document.querySelector('[data-id="process-library-panel"]'),
  );
  check("(b) library panel closed before S", panelClosedBeforeS);

  await pane.click({ position: { x: 100, y: 100 }, force: true }); // 캔버스에 포커스(좌클릭, 여백)
  await page.keyboard.press("KeyS");
  await page.waitForTimeout(300);

  const panelOpenViaKey = await page.evaluate(
    () => !!document.querySelector('[data-id="process-library-panel"]'),
  );
  check("(b) S key (canvas focused) → library panel opens", panelOpenViaKey);

  // ── ③ 입력창 포커스 중 S → 가드로 무시 (reload로 격리) ──
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  // 좌측 사이드바 노드 검색 입력창 — 타이핑 가드 대상 INPUT(항상 노출, leftCollapsed 기본 false)
  const nodeSearchInput = page.locator('input[placeholder="Search nodes"]').first();
  await nodeSearchInput.click({ force: true });
  await page.keyboard.press("KeyS");
  await page.waitForTimeout(300);

  const panelOpenWhileTyping = await page.evaluate(
    () => !!document.querySelector('[data-id="process-library-panel"]'),
  );
  check("(c) S while typing in input → library panel does NOT open", !panelOpenWhileTyping);
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (hostMapId !== null) await api(`/maps/${hostMapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
