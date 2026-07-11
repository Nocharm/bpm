// CSV 머지 임포트 e2e — 유닛 테스트가 못 닿는 7시나리오:
//   ① AI/CSV 프리뷰 충돌(도달 가능한 절반: 프리뷰 중 툴바 Import 버튼 소멸)
//   ② 머지 후 비교 화면 무오탐(엣지 added/removed 0) + 코멘트 생존
//   ③ 빈 셀은 기존 값 보존, Next는 흐름 전체를 덮어씀
//   ④ CSV에 없는 노드 빨간 점선 → Delete/Keep 선택
//   ⑤ 담당자 login_id → 이름 해석, 미해석 토큰은 원문 저장 + 비차단 경고
//   ⑥ 이름 매칭된 서브프로세스 노드의 타입·링크 보존
//   ⑦ 프리뷰 중 인스펙터 잠금(탭·접기 비활성) + Cancel 복원
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-csv-import-merge.mjs
//   PowerShell: node scripts\pw-verify-csv-import-merge.mjs
// 전제:
//   backend :8000 기동 —  cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 기동 — cd frontend && npm run dev
//   playwright-core 설치 — npm i --no-save playwright-core
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전 pkill -f "next dev" 후 재기동.
//   - dev.db 오염: 이 스크립트는 맵 2개를 만들고 끝에 소프트삭제한다. 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
//   - 시나리오 ②의 비교 화면은 v1 게시(승인 워크플로)가 필요 — dev.db에 직원(employees) 행이 없으면 SKIP 처리된다.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/csv-import-merge";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const skip = (name, reason) => console.log(`SKIP ${name} — ${reason}`);

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

// ── 헬퍼 ────────────────────────────────────────────────────────────
// 인페이지 fetch — AUTH_ENABLED=false 백엔드는 X-Dev-User 헤더로 사용자를 식별한다
const api = (path, { method = "GET", body, user = "admin.sys" } = {}) =>
  page.evaluate(
    async ({ path, method, body, user }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body, user },
  );

// 32자 hex id — 서버가 저장하는 노드/엣지 id 형식과 동일 (insecure context라 crypto.randomUUID 금지)
const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// CSV 조립 — 콤마/따옴표 포함 셀은 RFC4180 인용
const q = (cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
const HEADER = "Name,Description,Assignee,Department,System,Duration,URL,URL_Label,Next";
const csvOf = (rows) => [HEADER, ...rows.map((r) => r.map(q).join(","))].join("\n");

// 엣지를 "출발제목→도착제목" 정렬 배열로 — id는 임포트마다 재생성되므로 제목 쌍으로 비교
const edgeTitles = (g) => {
  const titles = new Map(g.nodes.map((n) => [n.id, n.title]));
  return g.edges.map((e) => `${titles.get(e.source_node_id)}→${titles.get(e.target_node_id)}`).sort();
};

// 툴바 → 모달 → 붙여넣기 → Continue → 프리뷰 진입
async function stageCsv(csv) {
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-paste-toggle"]').click();
  await page.locator('[data-id="csv-paste-input"]').fill(csv);
  await page.waitForTimeout(300);
  await page.locator('[data-id="csv-import-continue"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]');
}

async function applyPreview() {
  await page.locator('[data-id="csv-import-apply"]').click();
  // Import 탭 소멸 = 저장 완료 신호 (실패 시 프리뷰 유지 → 타임아웃으로 FAIL)
  await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached", timeout: 10000 });
  await page.waitForTimeout(400);
}

const openEditor = async (mapId, versionId) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page
    .waitForSelector('[data-id="toolbar-import-csv"]', { timeout: 20000 })
    .catch(() => {
      throw new Error(
        "Import CSV toolbar button never appeared — checkout/eligible not ready, or a stale build is serving :3000 (zombie next dev?)",
      );
    });
  // 캔버스 노드 6개(start/end 포함)가 다 그려진 뒤에야 모달 base 그래프가 완전하다
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 6, null, {
    timeout: 15000,
  });
};

// ── 서버 프로브 — 미기동이면 크게, 명확하게 실패 ─────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  console.error('  start it: cd frontend && npm run dev   (kill zombies first: pkill -f "next dev")');
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
  console.error("  start it: cd backend && AUTH_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000");
  await browser.close();
  process.exit(1);
}

let mapAId = null;
let mapBId = null;

try {
  // ── 시드 — 서브프로세스 링크 대상 맵 + 본 맵(start→Alpha→Beta→Gamma→SubStep→end) ──
  const stamp = Date.now();
  // 오우닝 부서는 필수 필드 — 서버가 known org_path 존재를 검증하므로 디렉터리에서 실제 부서 id를 얻는다
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) {
    console.error("FATAL directory has no departments — cannot supply the required owning_department");
    await browser.close();
    process.exit(1);
  }
  const mapB = await api("/maps", {
    method: "POST",
    body: { name: `CSV-PW Sub ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapBId = mapB.id;
  const mapA = await api("/maps", {
    method: "POST",
    body: { name: `CSV-PW Main ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;
  const v1 = mapA.versions[0].id;

  const NODE = {
    description: "", color: "", assignee: "", department: "", system: "", duration: "",
    url: "", url_label: "", pos_y: 0, group_ids: [],
    linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  };
  const ids = { Start: rid(), Alpha: rid(), Beta: rid(), Gamma: rid(), SubStep: rid(), End: rid() };
  // sort_order·엣지 방향(right→left)·라벨("")을 CSV 재구성 결과와 일치시켜 identity 머지가 무변경이 되게 한다
  const seedGraph = {
    nodes: [
      { ...NODE, id: ids.Start, title: "Start", node_type: "start", pos_x: 0, sort_order: 0 },
      { ...NODE, id: ids.Alpha, title: "Alpha", node_type: "process", pos_x: 220, sort_order: 1, system: "ERP", description: "keep me" },
      { ...NODE, id: ids.Beta, title: "Beta", node_type: "process", pos_x: 440, sort_order: 2 },
      { ...NODE, id: ids.Gamma, title: "Gamma", node_type: "process", pos_x: 660, sort_order: 3 },
      { ...NODE, id: ids.SubStep, title: "SubStep", node_type: "subprocess", pos_x: 880, sort_order: 4, linked_map_id: mapBId },
      { ...NODE, id: ids.End, title: "End", node_type: "end", pos_x: 1100, sort_order: 5, is_primary_end: true },
    ],
    edges: [
      [ids.Start, ids.Alpha], [ids.Alpha, ids.Beta], [ids.Beta, ids.Gamma],
      [ids.Gamma, ids.SubStep], [ids.SubStep, ids.End],
    ].map(([s, t]) => ({
      id: rid(), source_node_id: s, target_node_id: t, label: "",
      source_side: "right", target_side: "left", source_handle: null, target_handle: null,
    })),
    groups: [],
  };
  await api(`/versions/${v1}/checkout`, { method: "POST", body: { force: false } });
  await api(`/versions/${v1}/graph`, { method: "PUT", body: seedGraph });

  // ── v1 게시 + v2(To-Be) 클론 — 비교 화면(시나리오 ②)용. 실패하면 v1에서 계속 + 비교만 SKIP ──
  let workV = v1;
  let compareReady = false;
  let submitted = false;
  try {
    const dir = await api("/directory");
    const approver = (dir.users.find((u) => u.id === "admin.sys") ?? dir.users[0])?.id;
    if (!approver) throw new Error("directory has no employees — approval quorum impossible");
    await api(`/maps/${mapAId}/approvers`, { method: "PUT", body: { user_ids: [approver] } });
    await api(`/versions/${v1}/submit`, { method: "POST" });
    submitted = true;
    await api(`/versions/${v1}/approve`, { method: "POST", user: approver });
    await api(`/versions/${v1}/publish`, { method: "POST" });
    const v2 = await api(`/maps/${mapAId}/versions`, {
      method: "POST",
      body: { label: "To-Be", source_version_id: v1 },
    });
    workV = v2.id;
    compareReady = true;
  } catch (err) {
    // 게시 실패 시 pending에 갇히지 않게 회수 시도 — 실패해도 진행(아래서 어차피 FAIL로 드러남)
    if (submitted && !compareReady) {
      await api(`/versions/${v1}/withdraw`, { method: "POST" }).catch(() => {});
    }
    skip("compare screen scenario (publish workflow)", err instanceof Error ? err.message : String(err));
  }

  // 작업 버전의 실제 노드 id(클론이면 새 id) + Beta에 코멘트 — 머지 후 생존 검증용
  const g0 = await api(`/versions/${workV}/graph`);
  const idOf0 = new Map(g0.nodes.map((n) => [n.title, n.id]));
  await api(`/versions/${workV}/comments`, {
    method: "POST",
    body: { node_id: idOf0.get("Beta"), body: "pw-verify keep me" },
  });

  await openEditor(mapAId, workV);
  check("toolbar Import CSV button present before preview", (await page.locator('[data-id="toolbar-import-csv"]').count()) === 1);

  // ── CSV A: identity 머지 — 프리뷰 진입 후 ①툴바 소멸 ⑦인스펙터 잠금·Cancel 복원 ──
  const rowsA = [
    ["Alpha", "", "", "", "", "", "", "", "Beta"],
    ["Beta", "", "", "", "", "", "", "", "Gamma"],
    ["Gamma", "", "", "", "", "", "", "", "SubStep"],
    ["SubStep", "", "", "", "", "", "", "", ""],
  ];
  await page.locator('[data-id="toolbar-import-csv"]').click();
  await page.waitForSelector('[data-id="csv-import-section"]');
  await page.locator('[data-id="csv-paste-toggle"]').click();
  await page.locator('[data-id="csv-paste-input"]').fill(csvOf(rowsA));
  await page.waitForTimeout(300);
  const summary = await page.locator('[data-id="csv-import-section"]').innerText();
  check("identity CSV parses as 0 added / 6 matched / 0 removed", summary.includes("0 added · 6 matched · 0 removed"), summary.split("\n").find((l) => l.includes("matched")) ?? summary.slice(0, 80));
  await page.locator('[data-id="csv-import-continue"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]');
  await page.screenshot({ path: `${SHOTS}/01-preview-staged.png` });

  // ① 프리뷰 슬롯 점유 중 툴바 Import 버튼 소멸 (previewSource !== null 게이팅)
  check("toolbar Import CSV gone while a CSV preview is staged", (await page.locator('[data-id="toolbar-import-csv"]').count()) === 0);
  console.log("NOT COVERED: staging an AI proposal preview then checking the Import button — requires driving the AI chat");
  console.log('NOT COVERED: applying an AI proposal during a CSV preview → "preview.busy" toast — requires driving the AI chat');

  // ⑦ 인스펙터 잠금 — 다른 탭·접기 비활성, Apply/Cancel 존재
  check("other inspector tabs disabled during preview", await page.locator('button[aria-label="Properties"]').first().isDisabled());
  // 인스펙터 잠금 — "Toggle inspector" 라벨 버튼은 둘이다: 툴바 토글(프리뷰 중 no-op이나 enabled)과
  // 패널 접기 버튼(disabled={lockTabs}). 접기 경로가 둘 다 막혔음을 각각 확인한다.
  check(
    "inspector panel collapse button disabled during preview",
    (await page.locator('button[aria-label="Toggle inspector"][disabled]').count()) >= 1,
  );
  // 툴바 토글은 프리뷰 중 클릭해도 no-op이라 Import 탭이 그대로 남아야 한다
  await page
    .locator('button[aria-label="Toggle inspector"]:not([disabled])')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(150);
  check(
    "toolbar inspector toggle is a no-op during preview (Import tab stays)",
    await page.locator('[data-id="csv-import-tab"]').isVisible(),
  );
  check(
    "Apply and Cancel present in Import tab",
    (await page.locator('[data-id="csv-import-apply"]').isVisible()) && (await page.locator('[data-id="csv-import-cancel"]').isVisible()),
  );
  const tabText = await page.locator('[data-id="csv-import-tab"]').innerText();
  check("identity preview reports nothing missing from the CSV", tabText.includes("Nothing in this map is missing from the CSV."));

  // ⑦ Cancel — 캔버스 복원 + 툴바 버튼 복귀
  await page.locator('[data-id="csv-import-cancel"]').click();
  await page.waitForSelector('[data-id="csv-import-tab"]', { state: "detached" });
  await page.waitForTimeout(400);
  check("cancel restores toolbar Import button", (await page.locator('[data-id="toolbar-import-csv"]').count()) === 1);
  check("cancel keeps the canvas intact (Gamma still present)", (await page.locator(".react-flow__node", { hasText: "Gamma" }).count()) >= 1);

  // ── ② identity 머지 Apply — id 계보·코멘트·엣지 보존, 비교 화면 무오탐 ──
  await stageCsv(csvOf(rowsA));
  await applyPreview();
  const toastSeen = await page
    .waitForSelector("text=CSV imported", { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("apply shows the applied toast", toastSeen);

  const g1 = await api(`/versions/${workV}/graph`);
  const idOf1 = new Map(g1.nodes.map((n) => [n.title, n.id]));
  const preserved = ["Start", "Alpha", "Beta", "Gamma", "SubStep", "End"].every((t) => idOf1.get(t) === idOf0.get(t));
  check("identity merge reuses every node id (title match)", preserved);
  check("identity merge keeps the same edge set", edgeTitles(g1).join("|") === edgeTitles(g0).join("|"), edgeTitles(g1).join(", "));
  const comments = await api(`/versions/${workV}/comments`);
  const kept = comments.find((c) => c.body === "pw-verify keep me");
  check(
    "comment still attached to a live node after merge",
    kept !== undefined && g1.nodes.some((n) => n.id === kept.node_id) && kept.node_id === idOf0.get("Beta"),
    kept ? `node_id=${kept.node_id.slice(0, 8)}…` : "comment missing",
  );

  if (compareReady) {
    await page.goto(`${BASE}/maps/${mapAId}/compare`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-id="compare-legend"]', { timeout: 20000 });
    const legend = (await page.locator('[data-id="compare-legend"]').innerText()).replace(/\n/g, " ");
    const nums = legend.match(/\d+/g) ?? [];
    check("compare flags nothing added/removed after identity merge", nums[0] === "0" && nums[1] === "0", legend);
    const changes = await page.locator('[data-id="compare-changes"]').innerText().catch(() => "");
    check("compare lists no edge added/removed items", !changes.includes("Edge added") && !changes.includes("Edge removed"));
    await page.screenshot({ path: `${SHOTS}/02-compare-clean.png` });
    await openEditor(mapAId, workV);
  } else {
    skip("compare shows 0 added / 0 removed edges", "v1 was not published — single-version compare would be vacuous");
  }

  // ── ③⑤⑥ CSV B: 빈 셀 보존 + Next 재배선 + 담당자/부서 해석 + 서브프로세스 보존 ──
  const eligible = await api(`/versions/${workV}/eligible-assignees`);
  const realUser = eligible.users[0] ?? null;
  const dept = realUser?.department ?? "";
  const koreanDept = dept ? eligible.dept_infos?.[dept]?.korean_name : undefined;
  const assigneeCell = realUser ? `${realUser.id}, bogus.nobody` : "bogus.nobody";
  const rowsB = [
    ["Alpha", "", assigneeCell, koreanDept ?? dept, "", "", "", "", "Gamma"],
    ["Gamma", "", "", "", "", "", "", "", "Beta"],
    ["Beta", "", "", "", "", "", "", "", "SubStep"],
    ["SubStep", "", "", "", "", "", "", "", ""],
  ];
  await stageCsv(csvOf(rowsB));
  const tabB = await page.locator('[data-id="csv-import-tab"]').innerText();
  check("unknown assignee raises a non-blocking row warning", tabB.includes('Unknown assignee "bogus.nobody"'), tabB.split("\n").find((l) => l.includes("bogus")) ?? "(no warning line)");
  await applyPreview();

  const g2 = await api(`/versions/${workV}/graph`);
  const alpha = g2.nodes.find((n) => n.title === "Alpha");
  check("blank cells preserve existing attributes", alpha?.system === "ERP" && alpha?.description === "keep me", `system=${alpha?.system} description=${alpha?.description}`);
  const expectB = ["Start→Alpha", "Alpha→Gamma", "Gamma→Beta", "Beta→SubStep", "SubStep→End"].sort();
  check("Next rewires the flow exactly", edgeTitles(g2).join("|") === expectB.join("|"), edgeTitles(g2).join(", "));
  check("unresolvable assignee token stored verbatim", (alpha?.assignee ?? "").includes("bogus.nobody"), alpha?.assignee);
  if (realUser && realUser.name !== realUser.id) {
    check(
      "login_id resolved to display name",
      (alpha?.assignee ?? "").includes(realUser.name) && !(alpha?.assignee ?? "").includes(realUser.id),
      `assignee=${alpha?.assignee}`,
    );
  } else {
    skip("login_id resolved to display name", realUser ? `user ${realUser.id} has no distinct display name` : "eligible directory is empty");
  }
  if (dept) {
    check(
      `department cell (${koreanDept ? "korean name" : "canonical"}) stored as canonical`,
      alpha?.department === dept,
      `department=${alpha?.department}`,
    );
  } else {
    skip("department resolution", "eligible user has no department to test with");
  }
  const subStep = g2.nodes.find((n) => n.title === "SubStep");
  check("subprocess matched by title keeps type and link", subStep?.node_type === "subprocess" && subStep?.linked_map_id === mapBId, `type=${subStep?.node_type} linked_map_id=${subStep?.linked_map_id}`);

  // ── ④ CSV C: Gamma 누락 → 빨간 점선 프리뷰 → Keep(노드 유지·엣지 소멸) ──
  const rowsC = [
    ["Alpha", "", "", "", "", "", "", "", "Beta"],
    ["Beta", "", "", "", "", "", "", "", "SubStep"],
    ["SubStep", "", "", "", "", "", "", "", ""],
  ];
  await stageCsv(csvOf(rowsC));
  check("missing node listed in the Import tab", (await page.locator('[data-id="csv-import-tab"] button[title="Gamma"]').count()) === 1);
  const gammaDashed = await page
    .locator(".react-flow__node", { hasText: "Gamma" })
    .first()
    .evaluate((el) => [el, ...el.querySelectorAll("*")].some((n) => getComputedStyle(n).borderTopStyle === "dashed"));
  check("missing node rendered dashed on the canvas", gammaDashed);
  check("Delete is the default mode", (await page.locator('[data-id="csv-import-mode-delete"]').getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${SHOTS}/03-preview-removed.png` });
  await page.locator('[data-id="csv-import-mode-keep"]').click();
  check("Keep becomes active on click", (await page.locator('[data-id="csv-import-mode-keep"]').getAttribute("aria-pressed")) === "true");
  await applyPreview();

  const g3 = await api(`/versions/${workV}/graph`);
  const gammaKept = g3.nodes.find((n) => n.title === "Gamma");
  const gammaEdges = gammaKept
    ? g3.edges.filter((e) => e.source_node_id === gammaKept.id || e.target_node_id === gammaKept.id)
    : [];
  check("Keep leaves the node in the graph with no edges", gammaKept !== undefined && gammaEdges.length === 0, `edges touching Gamma: ${gammaEdges.length}`);
  check("kept node still visible on the canvas", (await page.locator(".react-flow__node", { hasText: "Gamma" }).count()) >= 1);

  // ── ④ CSV D: 같은 CSV, 이번엔 기본값 Delete → Gamma 삭제 ──
  await stageCsv(csvOf(rowsC));
  check("Delete is the default again on a fresh preview", (await page.locator('[data-id="csv-import-mode-delete"]').getAttribute("aria-pressed")) === "true");
  await applyPreview();
  const g4 = await api(`/versions/${workV}/graph`);
  check("Delete removes the node from the graph", !g4.nodes.some((n) => n.title === "Gamma"), `nodes=${g4.nodes.map((n) => n.title).join(",")}`);
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 시드 정리 — 소프트삭제(휴지통). 완전 복원은 git checkout backend/dev.db + 백엔드 재시작
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
  if (mapBId !== null) await api(`/maps/${mapBId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
