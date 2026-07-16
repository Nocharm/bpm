// 프로세스 라이브러리 패널 검색 강화 검증 — filterByQuery(부분일치+초성) 적용 + 검색창 자동포커스.
// 시나리오: ①패널 오픈 시 검색 input이 document.activeElement ②department 필드로 초성 쿼리("ㄱㅁ")를
//           치면 매치하는 지정만 남고(부서=구매팀…) 매치 안 하는 지정(부서=영업팀…)은 사라짐(이름은
//           둘 다 비한글이라 department 필드가 검색 대상에 포함됐는지 확인하는 근거) ③콘솔 에러 0.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-library-search.mjs
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
  window.localStorage.setItem("bpm.lang", "en"); // 라벨 매칭을 EN으로 고정 (placeholder="Search…")
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
      { id: s, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
      { id: e, title: "End", node_type: "end", pos_x: 400, pos_y: 200, sort_order: 1, is_primary_end: true },
    ],
    edges: [{ id: rid(), source_node_id: s, target_node_id: e }],
    groups: [],
  };
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

let hostMapId = null;
let mapAId = null;
let mapBId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees");

  // 이름은 둘 다 비한글 — department 필드가 매치 근거임을 보장(이름 매치 오염 방지)
  const nameA = `LibTest EN ${stamp}`;
  const nameB = `LibTest EN2 ${stamp}`;
  const deptA = `구매팀${stamp}`; // 초성 ㄱㅁ
  const deptB = `영업팀${stamp}`; // 초성 ㅇㅇ — ㄱㅁ과 무관

  // host — 라이브러리 패널을 열 대상 맵(그 자체는 지정하지 않음)
  const host = await api("/maps", {
    method: "POST",
    body: { name: `LibTest Host ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  hostMapId = host.id;
  const hostVersionId = host.versions[0].id;

  // map A — 지정 + 게시(라이브러리 목록 노출 전제)
  const mapA = await api("/maps", {
    method: "POST",
    body: { name: nameA, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;
  const vA = mapA.versions[0].id;
  await api(`/versions/${vA}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vA}/graph`, { method: "PUT", body: buildGraph() });
  await publishVersion(mapAId, vA, approver);
  await api(`/maps/${mapAId}/subprocess-designation`, { method: "PUT", body: { department: deptA } });

  // map B — 대조군(다른 초성 부서), 동일하게 지정 + 게시
  const mapB = await api("/maps", {
    method: "POST",
    body: { name: nameB, description: "", visibility: "public", owning_department: owningDept },
  });
  mapBId = mapB.id;
  const vB = mapB.versions[0].id;
  await api(`/versions/${vB}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vB}/graph`, { method: "PUT", body: buildGraph() });
  await publishVersion(mapBId, vB, approver);
  await api(`/maps/${mapBId}/subprocess-designation`, { method: "PUT", body: { department: deptB } });

  // ── 편집기 오픈 + 라이브러리 패널 토글 ──
  await page.goto(`${BASE}/maps/${hostMapId}?version=${hostVersionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Process library" }).click();
  await page.waitForSelector('input[placeholder="Search…"]', { timeout: 8000 });
  await page.waitForTimeout(300); // 마운트 effect(focus) 반영 대기

  // ① 자동 포커스 — 별도 클릭 없이 검색 input이 activeElement
  const focused = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search…"]');
    return !!input && document.activeElement === input;
  });
  check("panel open → search input auto-focused", focused);

  // 지정된 두 항목이 필터 전에는 모두 노출
  const preFilterText = await page.evaluate(
    () => document.querySelector(".w-56.flex-col.border-r.border-hairline.bg-surface")?.innerText ?? "",
  );
  check("before query: map A (dept=구매팀…) listed", preFilterText.includes(nameA));
  check("before query: map B (dept=영업팀…) listed", preFilterText.includes(nameB));

  // ② 초성 쿼리 — department 필드 매치로 A만 남고 B는 사라짐
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search…"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "ㄱㅁ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const postFilterText = await page.evaluate(
    () => document.querySelector(".w-56.flex-col.border-r.border-hairline.bg-surface")?.innerText ?? "",
  );
  check(
    "초성 query 'ㄱㅁ': map A (dept=구매팀…) still listed",
    postFilterText.includes(nameA),
    postFilterText.slice(0, 200),
  );
  check(
    "초성 query 'ㄱㅁ': map B (dept=영업팀…) filtered out",
    !postFilterText.includes(nameB),
    postFilterText.slice(0, 200),
  );

  // 쿼리 비우면 다시 둘 다 노출(리셋 확인)
  await page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search…"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const resetText = await page.evaluate(
    () => document.querySelector(".w-56.flex-col.border-r.border-hairline.bg-surface")?.innerText ?? "",
  );
  check("query cleared: both listed again", resetText.includes(nameA) && resetText.includes(nameB));
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
  if (mapBId !== null) await api(`/maps/${mapBId}`, { method: "DELETE" }).catch(() => {});
  if (hostMapId !== null) await api(`/maps/${hostMapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
