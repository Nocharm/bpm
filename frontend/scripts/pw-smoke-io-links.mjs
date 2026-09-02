// IO 링크(불러오기) 엔드투엔드 스모크 — 노드 A(output "회의록") → B에 미러 행 불러오기,
// 캔버스 하이라이트(.edge-hover-highlight/.io-node-highlight), 리로드 라운드트립, 원본 편집 전파,
// 해제 draft 취소·영속을 실기동으로 검증. 설계: 2026-08-21-io-linking-design.md
// 실행(frontend/ 에서): node scripts/pw-smoke-io-links.mjs  (playwright-core, 서버 8000/3000 기동 전제,
// reset_db 시드 — admin.sys sysadmin 필요). 테스트 맵은 API로 생성 후 teardown에서 소프트삭제+ORM 하드퍼지.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = "http://localhost:8000/api";
const DEV_USER = "admin.sys";
const HEADERS = { "Content-Type": "application/json", "X-Dev-User": DEV_USER };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "../../backend");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const api = async (pathname, { method = "GET", body } = {}) => {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

// 전 테이블 행수 스냅샷 — sysadmin 전용 읽기전용 COUNT(*) (admin.py list_tables). teardown 후 대조해
// "잔류 0"을 API만으로 증명한다(sqlite 파일 직접 조회 불필요).
// login_records는 대조에서 제외 — /api/me는 login_id당 KST 하루 1행 dedup이라 이 테이블의 증가분이
// "이 런이 만든 행"인지 "다른 동시 세션이 그날 먼저 찍은 행"인지 구분할 근거가 없다(스키마에 세션
// 식별자 없음). _purge-test-map.py도 같은 이유로 이 테이블을 건드리지 않는다 — 남의 행을 지우는
// 쪽이 하루 1행/로그인id의 잔류를 감수하는 쪽보다 훨씬 위험하다는 판단(코드리뷰 반영).
const RESIDUE_EXEMPT_TABLES = new Set(["login_records"]);
const snapshotTables = async () => {
  const rows = await api("/admin/tables");
  return new Map(rows.map((r) => [r.name, r.count]));
};

let browser;
let mapId = null;
let versionId = null;
let baseline = null;

try {
  baseline = await snapshotTables();

  // ── Step 1: 테스트 맵 생성 — Start→A(output 회의록)→B→End, PUT 전 체크아웃 필수(graph.py 423/409 가드) ──
  const dir = await api("/directory");
  const owningDept = dir.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — run reset_db first");

  const stamp = Date.now();
  const created = await api("/maps", {
    method: "POST",
    body: { name: `IO Link Smoke ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = created.id;
  versionId = created.versions[0].id;
  check("test map created", mapId !== null, `map=${mapId} version=${versionId}`);

  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: false } });

  const graph = {
    nodes: [
      { id: "start", title: "Start", node_type: "start", pos_x: 40, pos_y: 200, sort_order: 0 },
      { id: "node-a", title: "Node A", node_type: "process", output: "회의록", pos_x: 260, pos_y: 200, sort_order: 1 },
      { id: "node-b", title: "Node B", node_type: "process", pos_x: 480, pos_y: 200, sort_order: 2 },
      { id: "end", title: "End", node_type: "end", is_primary_end: true, pos_x: 700, pos_y: 200, sort_order: 3 },
    ],
    edges: [
      { id: "e-start-a", source_node_id: "start", target_node_id: "node-a" },
      { id: "edge-a-b", source_node_id: "node-a", target_node_id: "node-b" },
      { id: "e-b-end", source_node_id: "node-b", target_node_id: "end" },
    ],
    groups: [],
  };
  await api(`/versions/${versionId}/graph`, { method: "PUT", body: graph });
  check("seed graph (Start→A→B→End) persisted", true);

  // ── 브라우저 셋업 ──
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(
    ([devUser]) => {
      window.localStorage.setItem("bpm.devUser", devUser);
      window.localStorage.setItem("bpm.lang", "en");
      // Details 카드 기본 접힘(bpm.detailsCollapsed) — 스모크는 항상 펼친 상태에서 시작
      window.localStorage.setItem("bpm.detailsCollapsed", "0");
    },
    [DEV_USER],
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const openMap = async () => {
    await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.react-flow__node[data-id="node-b"]', { timeout: 30000 });
    await page.waitForTimeout(1000); // 체크아웃 확보 + 측정 안정화
  };

  const selectNode = async (id) => {
    await page.locator(`.react-flow__node[data-id="${id}"]`).click({ force: true });
    await page.waitForTimeout(300);
  };

  const isNodeReadOnly = () =>
    page.evaluate(() => {
      const input = document.querySelector('[data-id="inspector-detail-input-row-0"]');
      return input === null; // io wiring이 아예 안 붙으면 read-only 편집기로 간주
    });

  await openMap();
  await selectNode("node-b");

  // ── Step 2: 호버로 + 버튼 노출 → 클릭 → 메뉴 → Import → 모달 행 노출·호버 하이라이트 → 클릭 ──
  const inputSection = page.locator('[data-id="inspector-detail-input"]');
  await inputSection.waitFor({ state: "visible", timeout: 5000 });
  await inputSection.hover();
  const addBtn = page.locator('[data-id="inspector-detail-input-add"]');
  await addBtn.click();
  const importItem = page.locator('[data-id="inspector-detail-input-add-import"]');
  const menuVisible = await importItem.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("add menu shows Import from node…", menuVisible);
  if (!menuVisible) {
    const readOnly = await isNodeReadOnly();
    throw new Error(`import menu never appeared (node read-only? ${readOnly})`);
  }
  await importItem.click();

  const modal = page.locator('[data-id="io-import-modal"]');
  const modalVisible = await modal.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("import modal opens", modalVisible);

  const candidateRow = page.locator('[data-id="io-import-row-node-a-out-0"]');
  const rowVisible = await candidateRow.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("candidate row shows A's 회의록", rowVisible);
  if (rowVisible) {
    const rowText = await candidateRow.innerText();
    check("candidate row text is 회의록", rowText.includes("회의록"), rowText);
  }

  await candidateRow.hover();
  await page.waitForTimeout(200);
  const highlight = await page.evaluate(() => ({
    edge: document.querySelector('.react-flow__edge[data-id="edge-a-b"]')?.classList.contains("edge-hover-highlight") ?? false,
    node: document.querySelector('.react-flow__node[data-id="node-a"]')?.classList.contains("io-node-highlight") ?? false,
  }));
  check("hover row → edge-a-b gets .edge-hover-highlight", highlight.edge);
  check("hover row → node-a gets .io-node-highlight", highlight.node);

  await candidateRow.click();
  await page.waitForTimeout(500);
  const modalClosed = await modal.waitFor({ state: "hidden", timeout: 3000 }).then(() => true).catch(() => false);
  check("import modal closes after pick", modalClosed);

  // ── Step 3: B 인풋에 미러 행(readOnly + link 아이콘) → 자동저장 대기 → 리로드해도 유지 ──
  const mirrorRow = page.locator('[data-id="inspector-detail-input-row-0"]');
  const mirrorVisible = await mirrorRow.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("B input shows mirror row", mirrorVisible);
  if (mirrorVisible) {
    const [text, readOnly, linkVisible] = await Promise.all([
      mirrorRow.inputValue(),
      mirrorRow.evaluate((el) => el.readOnly),
      page.locator('[data-id="inspector-detail-input-link-0"]').isVisible(),
    ]);
    check("mirror row text = 회의록", text === "회의록", text);
    check("mirror row is readOnly", readOnly);
    check("mirror row shows link icon", linkVisible);
  }

  await page.waitForTimeout(3000); // AUTO_SAVE_DELAY_MS(2000) + 여유
  let g = await api(`/versions/${versionId}/graph`);
  const nodeAAfterImport = g.nodes.find((n) => n.id === "node-a");
  const nodeBAfterImport = g.nodes.find((n) => n.id === "node-b");
  check(
    "import persisted server-side (B.input_links ↔ A.output_ids)",
    Boolean(nodeAAfterImport.output_ids) && nodeBAfterImport.input_links === nodeAAfterImport.output_ids,
    `A.output_ids=${nodeAAfterImport.output_ids} B.input_links=${nodeBAfterImport.input_links}`,
  );

  await openMap();
  await selectNode("node-b");
  const mirrorAfterReload = page.locator('[data-id="inspector-detail-input-row-0"]');
  await mirrorAfterReload.waitFor({ state: "visible", timeout: 3000 });
  const [textAfterReload, readOnlyAfterReload] = await Promise.all([
    mirrorAfterReload.inputValue(),
    mirrorAfterReload.evaluate((el) => el.readOnly),
  ]);
  check("reload round-trip: mirror row persists", textAfterReload === "회의록" && readOnlyAfterReload, textAfterReload);

  // ── Step 4: A output 텍스트 편집 → 카드 Save → B input 텍스트 동기화 ──
  await selectNode("node-a");
  const outputSection = page.locator('[data-id="inspector-detail-output"]');
  await outputSection.waitFor({ state: "visible", timeout: 3000 });
  const outputRow = page.locator('[data-id="inspector-detail-output-row-0"]');
  await outputRow.fill("회의록 v2");
  await outputRow.blur();
  const saveBtn = page.locator('[data-id="inspector-details-save"]');
  const dirtyAfterEdit = await saveBtn.evaluate((el) => !el.disabled);
  check("Save enabled after editing A's output", dirtyAfterEdit);
  await saveBtn.click();
  await page.waitForTimeout(500);

  await selectNode("node-b");
  const mirrorAfterPropagate = page.locator('[data-id="inspector-detail-input-row-0"]');
  await mirrorAfterPropagate.waitFor({ state: "visible", timeout: 3000 });
  const textAfterPropagate = await mirrorAfterPropagate.inputValue();
  check("B's mirror text synced to 회의록 v2 after A's Save", textAfterPropagate === "회의록 v2", textAfterPropagate);

  await page.waitForTimeout(3000); // autosave 여유
  g = await api(`/versions/${versionId}/graph`);
  check(
    "propagation persisted server-side",
    g.nodes.find((n) => n.id === "node-a")?.output === "회의록 v2" &&
      g.nodes.find((n) => n.id === "node-b")?.input === "회의록 v2",
  );

  // ── Step 5: 미러 link 아이콘 → 팝오버 Disconnect → 편집가능 전환(텍스트 유지) → 미저장 재선택 시 원복 ──
  await openMap();
  await selectNode("node-b");
  await page.locator('[data-id="inspector-detail-input-link-0"]').click();
  const unlinkPopover = page.locator('[data-id="io-unlink-popover"]');
  const popoverVisible = await unlinkPopover.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  check("unlink popover opens", popoverVisible);
  await page.locator('[data-id="io-unlink-confirm"]').click();
  await page.waitForTimeout(300);

  const rowAfterUnlink = page.locator('[data-id="inspector-detail-input-row-0"]');
  const [textAfterUnlink, readOnlyAfterUnlink, linkGoneAfterUnlink] = await Promise.all([
    rowAfterUnlink.inputValue(),
    rowAfterUnlink.evaluate((el) => el.readOnly),
    page.locator('[data-id="inspector-detail-input-link-0"]').isVisible().catch(() => false),
  ]);
  check("draft disconnect → row editable, text kept", !readOnlyAfterUnlink && textAfterUnlink === "회의록 v2");
  check("draft disconnect → link icon gone", !linkGoneAfterUnlink);

  // 저장 없이 노드 재선택(B→A→B) — NodeDetailsCard가 key로 리마운트되어 draft가 버려져야 한다
  await selectNode("node-a");
  await selectNode("node-b");
  const rowAfterReselect = page.locator('[data-id="inspector-detail-input-row-0"]');
  await rowAfterReselect.waitFor({ state: "visible", timeout: 3000 });
  const [textAfterReselect, readOnlyAfterReselect, linkAfterReselect] = await Promise.all([
    rowAfterReselect.inputValue(),
    rowAfterReselect.evaluate((el) => el.readOnly),
    page.locator('[data-id="inspector-detail-input-link-0"]').isVisible().catch(() => false),
  ]);
  check(
    "unsaved disconnect reverts on reselect (draft cancel)",
    readOnlyAfterReselect && linkAfterReselect && textAfterReselect === "회의록 v2",
    `text=${textAfterReselect} readOnly=${readOnlyAfterReselect} link=${linkAfterReselect}`,
  );

  // 다시 해제 + 이번엔 Save → 영속
  await page.locator('[data-id="inspector-detail-input-link-0"]').click();
  await page.locator('[data-id="io-unlink-popover"]').waitFor({ state: "visible", timeout: 3000 });
  await page.locator('[data-id="io-unlink-confirm"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-id="inspector-details-save"]').click();
  await page.waitForTimeout(3000); // autosave 여유

  g = await api(`/versions/${versionId}/graph`);
  const nodeBFinal = g.nodes.find((n) => n.id === "node-b");
  check(
    "disconnect persisted server-side (B.input_links cleared)",
    (nodeBFinal.input_links ?? "").trim() === "" && nodeBFinal.input === "회의록 v2",
    `input_links="${nodeBFinal.input_links}" input="${nodeBFinal.input}"`,
  );

  await openMap();
  await selectNode("node-b");
  const rowFinal = page.locator('[data-id="inspector-detail-input-row-0"]');
  await rowFinal.waitFor({ state: "visible", timeout: 3000 });
  const [textFinal, readOnlyFinal, linkFinal] = await Promise.all([
    rowFinal.inputValue(),
    rowFinal.evaluate((el) => el.readOnly),
    page.locator('[data-id="inspector-detail-input-link-0"]').isVisible().catch(() => false),
  ]);
  check(
    "reload round-trip: disconnect persists as plain editable text",
    !readOnlyFinal && !linkFinal && textFinal === "회의록 v2",
    `text=${textFinal} readOnly=${readOnlyFinal} link=${linkFinal}`,
  );

  check("console errors 0", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await page.close().catch(() => undefined);
  await browser.close();
  browser = null;
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);

  // ── Step 6: teardown — 소프트삭제(실 API 경로) + ORM 하드퍼지(모델 직접, MapPermission은
  // ProcessMap의 ORM cascade 밖이라 별도 삭제) → 전 테이블 행수가 베이스라인과 일치하는지 대조 ──
  if (mapId !== null) {
    await api(`/maps/${mapId}`, { method: "DELETE" }).catch((e) => console.error("soft-delete failed:", e.message));
    try {
      execFileSync(
        path.join(BACKEND_DIR, ".venv/bin/python"),
        [path.join(__dirname, "_purge-test-map.py")],
        { cwd: BACKEND_DIR, env: { ...process.env, SMOKE_MAP_ID: String(mapId) }, stdio: "inherit" },
      );
    } catch (e) {
      console.error("hard purge failed:", e.message);
    }
  }
  if (baseline) {
    const after = await snapshotTables().catch(() => null);
    if (after) {
      const diffs = [];
      for (const [name, count] of after) {
        if (RESIDUE_EXEMPT_TABLES.has(name)) continue;
        const before = baseline.get(name) ?? 0;
        if (count !== before) diffs.push(`${name}: ${before}→${count}`);
      }
      check("zero residue — table row counts match baseline", diffs.length === 0, diffs.join(", "));
    } else {
      check("zero residue — table row counts match baseline", false, "post-teardown snapshot failed");
    }
  }
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails === 0 ? 0 : 1);
