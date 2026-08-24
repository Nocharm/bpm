// 필드 승격 스모크 — QA 문서(docs/qa/2026-08-20-field-promotion-qa.md) 항목 1~22 자동 체크.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-field-promotion.mjs
// 전제: backend(8000, DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys)+frontend(3000) 기동,
// reset_db 시드만(임포트는 이 스크립트가 UI로 수행). docs/lessons/browser-verification.md 준수.
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const SAMPLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/samples/consultant-interview-sample",
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const api = async (p, init = {}) => {
  const res = await fetch(`${API}/api${p}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN, ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const chip = (page, label, count) =>
  page.locator('[data-id="interview-import"]').getByText(new RegExp(`${label}\\s*${count}`)).first();

async function runDryRun(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Categories & import" }).first().click();
  await page.locator('[data-id="interview-import"]').waitFor({ state: "visible", timeout: 10000 });
  await page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"),
    path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await page.locator('[data-id="interview-import-file-list"] > li').nth(1)
    .waitFor({ state: "visible", timeout: 5000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 950 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
    window.localStorage.setItem("bpm.paramsCollapsed", "0"); // Parameters 기본 펼침 — 행 단언 안정화
    window.localStorage.setItem("bpm.detailsCollapsed", "0"); // I/O & Conditions 기본 펼침 — 행 단언 안정화
    window.localStorage.setItem("bpm.attrsCollapsed", "0"); // BPM attributes 기본 펼침 — 시스템 힌트 단언 안정화
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── [1][2] 임포트: dry-run → apply → 재dry-run 멱등 ─────────────────────
  await runDryRun(page);
  const okBadges = await page
    .locator('[data-id="interview-import-file-reports"]').getByText("OK", { exact: true }).count();
  const dryCreated = await chip(page, "Created", 4).isVisible().catch(() => false);
  check("[1] dry-run: 2 files OK + Created 4", okBadges === 2 && dryCreated, `ok=${okBadges}`);
  const dryNotes = await chip(page, "Notes", 8).isVisible().catch(() => false);
  check("[1b] dry-run: Notes 8 (open_item/task_note 포함)", dryNotes);
  await page.locator('[data-id="interview-import-apply"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.waitForSelector('[data-id="interview-import-report"]', { timeout: 25000 });
  await page.locator('[data-id="interview-import-dryrun"]').click();
  const idempotent = await chip(page, "Unchanged", 4).waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("[2] re-dry-run Unchanged 4 (idempotent)", idempotent);

  // ── 임포트 결과 API 대조 — 맵/버전/그래프 ────────────────────────────────
  const maps = await api("/maps");
  const calMap = maps.find((m) => m.consultant_code === "smp-cal-task-0001");
  if (!calMap) throw new Error("imported map smp-cal-task-0001 not found");
  const calDetail = await api(`/maps/${calMap.id}`);
  const publishedId = calDetail.versions.filter((v) => v.status === "published")
    .reduce((max, v) => (max === null || v.id > max ? v.id : max), null);
  const calGraph = await api(`/versions/${publishedId}/graph`);
  const a01 = calGraph.nodes.find((n) => n.title === "작업지시 확인");
  check("[3] node landing: input/output/data_form/system_fallback",
    a01?.input === "그 주 작업지시" && a01?.output === "대상 계측기와 측정 범위"
      && a01?.data_form === "structured" && a01?.system === "EAM" && a01?.system_fallback === "EAM");
  const descOk = a01?.description.includes("Quote:")
    && !/Input:|Output:|System:|Data form:/.test(a01?.description ?? "");
  check("[4] node description KV shrunk (Quote only)", descOk, (a01?.description ?? "").slice(0, 60));
  // artifact_role 잔류 복원 (점검 2026-08-24) — 기록성 키 2종만 [Interview]에 남는다
  check("[5] map [Interview] = Owner role + Artifact role",
    calDetail.description === "[Interview]\nOwner role: 교정 담당자\nArtifact role: deliverable",
    calDetail.description);
  check("[landing] map fields: conditions/touch/gmp fallback",
    calDetail.sp_start_condition?.startsWith("교정 주기 도래")
      && calDetail.sp_end_condition === "준비 목록 나오면 끝"
      && calDetail.sp_touch_time === "1"  // 60분 → 1.00 → 응답 경계 정규화가 "1"로 표준화
      && calDetail.sp_gmp === null
      && (calDetail.sp_gmp_fallback ?? "").includes("GMP 문서")
      && calDetail.sp_frequency_fallback === "주 1회"
      && calDetail.sp_system_fallback === "EAM");

  // ── [17][18][19] 설정 Conditions & GMP 카드 ─────────────────────────────
  await page.goto(`${BASE}/maps/${calMap.id}/settings`, { waitUntil: "networkidle" });
  const cardVisible = await page.locator('[data-id="settings-process-fields"]')
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  const startPrefill = await page.locator('[data-id="process-fields-start-condition"]').inputValue();
  check("[17] settings card renders with imported prefill",
    cardVisible && startPrefill.startsWith("교정 주기 도래"), startPrefill.slice(0, 30));
  await page.locator('[data-id="process-fields-gmp-hint"]').click();
  const gmpHintText = (await page.locator('[data-id="process-fields-gmp-hint-popover"]').textContent()) ?? "";
  check("[19] gmp fallback popover shows raw text", gmpHintText.includes("GMP 문서 맞음"));
  await page.mouse.click(5, 5); // 오버레이 클릭으로 팝오버 닫기(Escape 핸들러 없음)
  await page.locator('[data-id="process-fields-gmp"]').selectOption("direct");
  await page.waitForTimeout(800);
  const afterGmp = await api(`/maps/${calMap.id}`);
  check("[18] gmp select saves via PATCH", afterGmp.sp_gmp === "direct");

  // ── [6][18b] 홈 상세 카드 — 조건/터치타임 행 + GMP 배지 ─────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="home-view-toggle"] button', { hasText: "Framework" }).click();
  await page.waitForSelector('[data-id="framework-tree"]', { timeout: 10000 });
  await page.locator('[data-id="framework-node"] > button').filter({ hasText: "EPCV" }).first().click();
  await page.locator('[data-id="framework-tree"] [data-id="map-card"]', { hasText: "교정 준비" })
    .first().click();
  await page.waitForSelector('[data-id="map-detail-io"]:visible', { timeout: 10000 });
  const ioText = (await page.locator('[data-id="map-detail-io"]:visible').first().textContent()) ?? "";
  check("[6] detail card rows: conditions + touch time",
    ioText.includes("Start condition") && ioText.includes("준비 목록 나오면 끝") && ioText.includes("1h"));
  check("[18b] detail card GMP badge", ioText.includes("GMP Direct"));

  // ── [7] Notes — task_note 포함 4행 ──────────────────────────────────────
  await page.locator('[data-id="map-notes-section"]:visible').first()
    .waitFor({ state: "visible", timeout: 10000 });
  // 노트는 기본 접힘 아코디언(2026-08-20) — 행 단언 전에 펼침
  await page.locator('[data-id="map-notes-section"]:visible [data-id="map-notes-toggle"]').first()
    .click({ timeout: 10000 }).catch(() => {});
  await page.locator('[data-id="map-notes-section"]:visible [data-id^="map-note-"]').first()
    .waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  const noteRows = await page.locator('[data-id="map-notes-section"]:visible [data-id^="map-note-"]').count();
  const notesText = (await page.locator('[data-id="map-notes-section"]:visible').first().textContent()) ?? "";
  check("[7] notes rows include task_note (4 rows)",
    noteRows === 4 && notesText.includes("표준기 관리대장은 아직 엑셀"), `rows=${noteRows}`);

  // ── [8][9][10] 에디터(published 읽기) — Details·배지·힌트·파라미터 7행 ────
  await page.goto(`${BASE}/maps/${calMap.id}`, { waitUntil: "networkidle" });
  await page.locator(".react-flow__node", { hasText: "작업지시 확인" }).first().click();
  const details = page.locator('[data-id="inspector-details"]');
  await details.waitFor({ state: "visible", timeout: 10000 });
  const detailsText = (await details.textContent()) ?? "";
  // data_form은 IO 종속 행(배지 아님) — c0c532a에서 배지 제거, readOnly 행 텍스트로 단언
  const dataFormText = (await page.locator('[data-id="inspector-detail-data-form"]').textContent().catch(() => "")) ?? "";
  check("[8] inspector Details shows imported IO + data form row",
    detailsText.includes("그 주 작업지시") && dataFormText.trim() === "structured");
  await page.locator('[data-id="inspector-system-hint"]').click();
  const hintText = (await page.locator('[data-id="inspector-system-hint-popover"]').textContent().catch(() => "")) ?? "";
  check("[9] system fallback popover shows raw text", hintText.includes("EAM"));
  await page.mouse.click(5, 5); // 오버레이 클릭으로 팝오버 닫기
  const touchRow = await page.locator('[data-id="inspector-param-touch_time"]').count();
  check("[10] Parameters exposes touch_time row", touchRow > 0, `count=${touchRow}`);

  // ── 편집용 맵 준비(API) — 신규 맵 + 노드 시드 + 체크아웃 ────────────────
  const dir = await api("/directory");
  const dept = dir.departments[0]?.name ?? dir.departments[0]; // directory 항목은 {id,name,...} 객체
  const newMap = await api("/maps", { method: "POST", body: JSON.stringify({ name: `FP smoke map ${Date.now()}`, owning_department: dept }) });
  const draftId = newMap.versions[0].id;
  const seeded = await api(`/versions/${draftId}/graph`);
  const start = seeded.nodes.find((n) => n.node_type === "start");
  const end = seeded.nodes.find((n) => n.node_type === "end");
  const work = {
    id: "fp-node-1", title: "작업 단계", description: "", node_type: "process", color: "",
    assignee: "", department: "", system: "", duration: "", cost_krw: "", cost_usd: "",
    headcount: "", annual_count: "", fte: "", touch_time: "", input: "", output: "",
    start_condition: "", end_condition: "", data_form: "", system_fallback: "EAM(스모크 원문)",
    url: "", url_label: "", section_anchor: "", pos_x: 380, pos_y: 220, sort_order: 1,
    group_ids: [], linked_map_id: null, follow_latest: true, linked_version_id: null,
    is_primary_end: false,
  };
  await api(`/versions/${draftId}/checkout`, { method: "POST", body: "{}" });
  await api(`/versions/${draftId}/graph`, {
    method: "PUT",
    body: JSON.stringify({
      nodes: [start, work, end],
      edges: [
        { id: "fp-e1", source_node_id: start.id, target_node_id: work.id, label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null, line_style: "" },
        { id: "fp-e2", source_node_id: work.id, target_node_id: end.id, label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null, line_style: "" },
      ],
      groups: [],
    }),
  });

  // ── [11]~[15] 에디터 편집 플로우 ─────────────────────────────────────────
  await page.goto(`${BASE}/maps/${newMap.id}`, { waitUntil: "networkidle" });
  await page.locator(".react-flow__node", { hasText: "작업 단계" }).first().click();
  await page.locator('[data-id="inspector-details"]').waitFor({ state: "visible", timeout: 10000 });
  // [11] IO add 2건
  await page.locator('[data-id="inspector-detail-input-add"]').click();
  await page.locator('[data-id="inspector-detail-input-row-0"]').fill("작업지시");
  await page.keyboard.press("Enter");
  await page.locator('[data-id="inspector-detail-input-add"]').click();
  await page.locator('[data-id="inspector-detail-input-row-1"]').fill("표준기 목록");
  await page.keyboard.press("Enter");
  // 항목별 데이터 폼 — 첫 항목에만 지정. 피커 전환(행 호버 아이콘→자동완성 Enter 선택, 2026-08-20)
  await page.locator('[data-id="inspector-detail-input-row-0"]').hover();
  await page.locator('[data-id="inspector-detail-input-form-0-open"]').click();
  await page.locator('input[data-id="inspector-detail-input-form-0"]').fill("document");
  await page.keyboard.press("Enter"); // 최상위 후보(document) 선택
  await page.locator('[data-id="inspector-details-save"]').click(); // 레이지 세이브 — 명시 Save
  await page.waitForTimeout(2600); // autosave 디바운스
  let g = await api(`/versions/${draftId}/graph`);
  let node = g.nodes.find((n) => n.id === "fp-node-1");
  check("[11] IO add x2 + item form → newline-joined save",
    node?.input === "작업지시\n표준기 목록" && node?.input_forms === "document",
    `${JSON.stringify(node?.input)} forms=${JSON.stringify(node?.input_forms)}`);
  // [12] remove 두 번째 항목
  await page.locator('[data-id="inspector-detail-input-remove-1"]').click();
  await page.locator('[data-id="inspector-details-save"]').click();
  await page.waitForTimeout(2600);
  g = await api(`/versions/${draftId}/graph`);
  node = g.nodes.find((n) => n.id === "fp-node-1");
  check("[12] IO remove → server reflects, first item form survives",
    node?.input === "작업지시" && node?.input_forms === "document", JSON.stringify(node?.input));
  // [13] 조건 입력 + 항목별 폼 존재 시 노드 레벨 data_form 행 숨김(폴백 규칙, 2026-08-20)
  const legacyDataFormHidden =
    (await page.locator('[data-id="inspector-detail-data-form"]').count()) === 0;
  await page.locator('[data-id="inspector-detail-start-condition"]').fill("주기 도래");
  await page.locator('[data-id="inspector-detail-end-condition"]').fill("목록 확정");
  await page.locator('[data-id="inspector-details-save"]').click();
  await page.waitForTimeout(2600);
  g = await api(`/versions/${draftId}/graph`);
  node = g.nodes.find((n) => n.id === "fp-node-1");
  check("[13] conditions saved + legacy data_form row hidden with item forms",
    legacyDataFormHidden && node?.start_condition === "주기 도래" && node?.end_condition === "목록 확정");
  // [14] touch_time 정규화
  await page.locator('input[data-id="inspector-param-touch_time"]').fill("1.75");
  await page.keyboard.press("Enter");
  await page.locator('[data-id="inspector-params-save"]').click(); // 레이지 세이브 — 명시 Save
  await page.waitForTimeout(2600);
  g = await api(`/versions/${draftId}/graph`);
  node = g.nodes.find((n) => n.id === "fp-node-1");
  check("[14] touch_time 1.75 → 2.15 (H.MM carry)", node?.touch_time === "2.15", JSON.stringify(node?.touch_time));
  // [15] system 폴백 Apply
  await page.locator('[data-id="inspector-system-hint"]').click();
  await page.locator('[data-id="inspector-system-hint-apply"]').click();
  await page.waitForTimeout(2600);
  g = await api(`/versions/${draftId}/graph`);
  node = g.nodes.find((n) => n.id === "fp-node-1");
  check("[15] fallback Apply → system set", node?.system === "EAM(스모크 원문)", JSON.stringify(node?.system));

  // ── [16] SP 노드 — Details read-only 상속 ────────────────────────────────
  let spChecked = false;
  for (const m of maps) {
    if (spChecked) break;
    const d = await api(`/maps/${m.id}`).catch(() => null);
    if (!d) continue;
    // SP 데모는 draft 버전에만 있을 수 있다 — 전 버전 스캔 후 해당 버전 딥링크로 진입
    let sp = null;
    let verId = null;
    for (const v of d.versions) {
      const gr = await api(`/versions/${v.id}/graph`).catch(() => null);
      const hit = gr?.nodes.find((n) => n.node_type === "subprocess" && n.linked_map_id != null);
      if (hit) { sp = hit; verId = v.id; break; }
    }
    if (!sp) continue;
    await page.goto(`${BASE}/maps/${m.id}?version=${verId}`, { waitUntil: "networkidle" });
    const spNode = page.locator(".react-flow__node", { hasText: sp.title }).first();
    if ((await spNode.count()) === 0) continue;
    await spNode.click();
    const visible = await page.locator('[data-id="inspector-details"]')
      .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    const text = visible ? (await page.locator('[data-id="inspector-details"]').textContent()) ?? "" : "";
    check("[16] SP node Details renders read-only inherited card",
      visible && text.includes("Input"), text.slice(0, 40));
    spChecked = true;
  }
  if (!spChecked) check("[16] SP node Details renders read-only inherited card", false, "no subprocess node in seed");

  // ── [20][21] 거버넌스 — gmp 선정 보존·폴백은 전달분이 진실 ────────────────
  await runDryRun(page);
  const stillUnchanged = await chip(page, "Unchanged", 4).waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  const gmpKept = (await api(`/maps/${calMap.id}`)).sp_gmp === "direct";
  check("[20] gmp selection survives re-dry-run as Unchanged", stillUnchanged && gmpKept);
  await api(`/maps/${calMap.id}/process-fields`, {
    method: "PATCH", body: JSON.stringify({ gmp_fallback: "검토자가 고친 원문" }),
  });
  await runDryRun(page);
  const updatedOne = await chip(page, "Updated", 1).waitFor({ state: "visible", timeout: 15000 })
    .then(() => true).catch(() => false);
  check("[21] edited fallback re-detected as Updated (delivery is truth)", updatedOne);

  const errFree = consoleErrors.length === 0;
  check("[22] no page errors", errFree, errFree ? "" : consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
