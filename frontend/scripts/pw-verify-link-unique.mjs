// 서브프로세스 중복 링크 방지 — 피커 자동 비활성 + 두 진입 경로 차단 (Task 2.2).
// 시나리오: 호스트 맵에 맵 X를 링크한 서브프로세스 노드를 시드 → ①라이브러리 패널에서 맵 X 행이
//           비활성(draggable=false, opacity-40, "Already linked in this map" 툴팁)인 반면 맵 Y(미링크)
//           행은 정상(draggable=true, cycleBlocked이 아닌 자기 이름 툴팁) ②상단 맵드롭다운 "링크노드로
//           추가"로 맵 X를 재시도 → 확인 모달 확인 시 노드 미생성 + "Already linked" 토스트. 콘솔 에러 0.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-link-unique.mjs
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

// 32자 hex id — insecure context라 crypto.randomUUID 금지 (CLAUDE.md)
const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// 게시 체인 — checkout→graph PUT→approvers→submit→approve→publish
async function publishVersion(mapId, versionId, approver) {
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: [approver] } });
  await api(`/versions/${versionId}/submit`, { method: "POST" });
  await api(`/versions/${versionId}/approve`, { method: "POST", user: approver });
  await api(`/versions/${versionId}/publish`, { method: "POST" });
}

// 지정(designated)+게시된 맵 하나 생성 — 라이브러리 패널·맵드롭다운 링크추가 모두 이 목록을 공유 조회한다.
async function createDesignatedMap(name, owningDept, approver, department) {
  const created = await api("/maps", {
    method: "POST",
    body: { name, description: "", visibility: "public", owning_department: owningDept },
  });
  const versionId = created.versions[0].id;
  const s = rid();
  const e = rid();
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
        { id: e, title: "End", node_type: "end", pos_x: 650, pos_y: 380, sort_order: 1, is_primary_end: true },
      ],
      edges: [{ id: rid(), source_node_id: s, target_node_id: e }],
      groups: [],
    },
  });
  await publishVersion(created.id, versionId, approver);
  await api(`/maps/${created.id}/subprocess-designation`, { method: "PUT", body: { department } });
  return created.id;
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

let hostMapId = null;
let mapXId = null;
let mapYId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees");

  const nameX = `LinkUniq X ${stamp}`;
  const nameY = `LinkUniq Y ${stamp}`;

  // 링크 대상 맵 X(호스트가 이미 링크할 대상)와 대조군 맵 Y(미링크) — 둘 다 지정+게시해 라이브러리에 노출
  mapXId = await createDesignatedMap(nameX, owningDept, approver, `LinkUniqDeptX${stamp}`);
  mapYId = await createDesignatedMap(nameY, owningDept, approver, `LinkUniqDeptY${stamp}`);

  // 호스트 맵 — 맵 X를 링크한 subprocess 노드를 그래프에 직접 시드 (Task 2.1 백엔드 422 가드와 무관하게
  // 초기 상태를 만드는 경로이므로 graph PUT으로 직접 삽입)
  const host = await api("/maps", {
    method: "POST",
    body: { name: `LinkUniq Host ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  hostMapId = host.id;
  const hostVersionId = host.versions[0].id;
  const hStart = rid();
  const hProc = rid();
  const hSub = rid();
  const hEnd = rid();
  await api(`/versions/${hostVersionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${hostVersionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: hStart, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
        { id: hProc, title: "Step 1", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
        { id: hSub, title: "Call X", node_type: "subprocess", pos_x: 870, pos_y: 380, sort_order: 2, linked_map_id: mapXId },
        { id: hEnd, title: "End", node_type: "end", pos_x: 1180, pos_y: 380, sort_order: 3, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: hStart, target_node_id: hProc },
        { id: rid(), source_node_id: hProc, target_node_id: hSub },
        { id: rid(), source_node_id: hSub, target_node_id: hEnd },
      ],
      groups: [],
    },
  });

  const editorUrl = `${BASE}/maps/${hostMapId}?version=${hostVersionId}`;

  // ── ① 라이브러리 패널 — 맵 X 행 자동 비활성 vs 맵 Y 행 정상 ──
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  const nodeCountBefore = await page.locator(".react-flow__node").count();
  check("host canvas loaded with 4 seeded nodes (incl. linked subprocess)", nodeCountBefore === 4, `count=${nodeCountBefore}`);

  await page.getByRole("button", { name: "Process library" }).click();
  await page.waitForSelector('[data-id="process-library-panel"]', { timeout: 8000 });
  await page.waitForTimeout(300);

  const readRow = async (name) =>
    page.evaluate((rowName) => {
      const panel = document.querySelector('[data-id="process-library-panel"]');
      if (!panel) return null;
      const row = [...panel.querySelectorAll("div[draggable]")].find((r) => r.textContent?.includes(rowName));
      if (!row) return null;
      return { draggable: row.getAttribute("draggable"), title: row.getAttribute("title"), className: row.className };
    }, name);

  const rowX = await readRow(nameX);
  check("map X row found in library panel", rowX !== null);
  if (rowX) {
    check("map X row: draggable=false (already-linked block)", rowX.draggable === "false", `draggable=${rowX.draggable}`);
    check("map X row: opacity-40 (visually disabled)", rowX.className.includes("opacity-40"), rowX.className);
    check(
      'map X row: tooltip = "Already linked in this map"',
      rowX.title === "Already linked in this map",
      `title="${rowX.title}"`,
    );
  }

  const rowY = await readRow(nameY);
  check("map Y row found in library panel", rowY !== null);
  if (rowY) {
    check("map Y row: draggable=true (not blocked)", rowY.draggable === "true", `draggable=${rowY.draggable}`);
    check("map Y row: no opacity-40 (enabled)", !rowY.className.includes("opacity-40"), rowY.className);
    check('map Y row: tooltip = own name (not "Already linked")', rowY.title === nameY, `title="${rowY.title}"`);
  }

  // 패널 닫기 — 다음 시나리오와 격리
  await page.locator('[data-id="process-library-panel"] button[aria-label="Close"]').click();
  await page.waitForSelector('[data-id="process-library-panel"]', { state: "detached", timeout: 5000 });

  // ── ② 상단 맵드롭다운 "Add as link node"로 맵 X 재시도 → 토스트만, 노드 미생성 ──
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  // 트리거 버튼의 접근성 이름은 맵 이름(children 텍스트)이라 role/name으론 못 잡음 — title 속성으로 지정.
  await page.getByTitle("Map menu").click();
  await page.waitForSelector('input[placeholder="Load another map…"]', { timeout: 5000 });
  await page.locator('input[placeholder="Load another map…"]').fill(nameX);
  await page.waitForTimeout(300);

  await page.getByText(nameX, { exact: false }).first().click();
  await page.waitForTimeout(200);
  const addLinkBtn = page.getByRole("button", { name: "Add as link node" });
  check("map dropdown: 'Add as link node' entry visible for map X", await addLinkBtn.isVisible().catch(() => false));
  await addLinkBtn.click();

  await page.waitForSelector('input[placeholder="Load another map…"]', { state: "hidden", timeout: 5000 }).catch(() => {});
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForTimeout(400);

  const toastVisible = await page.getByText("Already linked in this map", { exact: false }).first().isVisible().catch(() => false);
  check('map dropdown re-add → "Already linked in this map" toast shown', toastVisible);

  const nodeCountAfter = await page.locator(".react-flow__node").count();
  check("no new node created on the blocked re-add", nodeCountAfter === nodeCountBefore, `before=${nodeCountBefore} after=${nodeCountAfter}`);
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (hostMapId !== null) await api(`/maps/${hostMapId}`, { method: "DELETE" }).catch(() => {});
  if (mapXId !== null) await api(`/maps/${mapXId}`, { method: "DELETE" }).catch(() => {});
  if (mapYId !== null) await api(`/maps/${mapYId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
