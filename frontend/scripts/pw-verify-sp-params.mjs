// SP 숫자 파라미터 5종 + 지정 모달 Σ 합산 + duration 1h30m 표시형 — 브라우저 실기동 검증 (Task 6).
// 7시나리오: ①맵 A 게시+지정 모달 5입력·Σ 4개(headcount 없음)·Σ(duration)=1.15·Σ(cost)=0.3·저장200
// ②미게시 맵 B: Designate 진입점 disabled(+게이트 동치인 Σ 내부 disabled를 강제오픈으로 실측)
// ③맵 C에 맵 A 링크: subprocess 노드 칩 duration `1h15m`+cost `0.3` 표기
// ④에디터 인스펙터 Parameters 그룹 기본접힘→펼침→duration `1.30`입력·blur `1h30m`·포커스 `1.30`→새로고침 펼침유지(localStorage)
// ⑤콘솔 에러 0
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-sp-params.mjs
//   PowerShell: node scripts\pw-verify-sp-params.mjs
// 전제:
//   backend :8000 — cd backend && .venv/bin/python -m scripts.reset_db && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 — cd frontend && npm run dev
//   playwright-core — npm i --no-save playwright-core
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전 pkill -f "next dev" 후 재기동.
//   - dev.db 오염: 이 스크립트는 스크래치 맵 3개(A/B/C)를 만들고 끝에 소프트삭제한다.
// 다운로드 없음 — acceptDownloads 불요.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-sp-params";
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

// ── 헬퍼 ────────────────────────────────────────────────────────────
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

async function waitForCondition(fn, { timeout = 8000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

const openEditor = async (mapId, versionId) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
};

// 인스펙터가 Properties 탭이 아니면 전환 (pw-verify-export.mjs 미러 — 단 inspector-param-duration은
// Parameters 그룹이 펼쳐졌을 때만 DOM에 존재(기본 접힘, Task 3)하므로 항상 존재하는 토글 버튼을 신호로 쓴다).
async function ensurePropertiesTab() {
  const toggleVisible = await page.locator('[data-id="inspector-params-toggle"]').isVisible().catch(() => false);
  if (!toggleVisible) {
    await page.locator('button[aria-label="Properties"]').first().click();
    await page.waitForSelector('[data-id="inspector-params-toggle"]', { timeout: 5000 });
  }
}

// 노드 카드의 파라미터 칩 컨테이너 (pw-verify-export.mjs 미러)
const paramChipsLocator = (nodeSel) => page.locator(`${nodeSel} div.flex.flex-wrap.gap-x-2`);

// 게시 체인 — checkout→graph PUT→approvers→submit→approve→publish (test_workflow.py / pw-verify-csv-import-merge.mjs 미러)
async function publishVersion(mapId, versionId, approver) {
  await api(`/maps/${mapId}/approvers`, { method: "PUT", body: { user_ids: [approver] } });
  await api(`/versions/${versionId}/submit`, { method: "POST" });
  await api(`/versions/${versionId}/approve`, { method: "POST", user: approver });
  await api(`/versions/${versionId}/publish`, { method: "POST" });
}

// ── 서버 프로브 ────────────────────────────────────────────────────
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
  console.error("  start it: cd backend && .venv/bin/uvicorn app.main:app --port 8000");
  await browser.close();
  process.exit(1);
}

let mapAId = null;
let mapBId = null;
let mapCId = null;

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — cannot supply owning_department");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees — approval quorum impossible");

  // ═══ 시나리오 ① — 맵 A: duration 0.45/0.30, cost 0.1/0.2 → 게시 → SP 지정 모달 Σ ═══
  const mapA = await api("/maps", {
    method: "POST",
    body: { name: `SP-Params A ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapAId = mapA.id;
  const v1 = mapA.versions[0].id;

  const aStart = rid();
  const aP1 = rid();
  const aP2 = rid();
  const aEnd = rid();
  await api(`/versions/${v1}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${v1}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: aStart, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
        { id: aP1, title: "Step 1", node_type: "process", pos_x: 260, pos_y: 200, sort_order: 1, duration: "0.45", cost: "0.1" },
        { id: aP2, title: "Step 2", node_type: "process", pos_x: 520, pos_y: 200, sort_order: 2, duration: "0.30", cost: "0.2" },
        { id: aEnd, title: "End", node_type: "end", pos_x: 780, pos_y: 200, sort_order: 3, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: aStart, target_node_id: aP1 },
        { id: rid(), source_node_id: aP1, target_node_id: aP2 },
        { id: rid(), source_node_id: aP2, target_node_id: aEnd },
      ],
      groups: [],
    },
  });
  await publishVersion(mapAId, v1, approver);
  const mapAAfterPublish = await api(`/maps/${mapAId}`);
  check(
    "map A: v1 published",
    mapAAfterPublish.versions.find((v) => v.id === v1)?.status === "published",
  );

  // 지정 사전조건(department)만 API로 심어 둔다 — Save 버튼 게이트(department 필수)는
  // BpmAttributePicker(포털 SearchSelect) 상호작용이라 이 태스크의 검증 범위(숫자 5종+Σ) 밖.
  await api(`/maps/${mapAId}/subprocess-designation`, {
    method: "PUT",
    body: {
      department: "Owning Anchor Division",
      assignee: "",
      system: "",
      duration: "",
      headcount: "",
      etf: "",
      cost: "",
      extra: "",
      url: "",
      url_label: "",
    },
  });

  await page.goto(`${BASE}/maps/${mapAId}/settings`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="subprocess-designation-panel"]', { timeout: 15000 });
  check(
    "settings: SP panel shows Designated (map A, published)",
    await page.locator('[data-id="subprocess-designation-edit"]').isVisible(),
  );

  await page.locator('[data-id="subprocess-designation-edit"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 5000 });
  check("SP designation modal opens (map A)", true);
  await page.screenshot({ path: `${SHOTS}/01-modal-open.png` });

  const PARAM_KEYS = ["duration", "headcount", "etf", "cost", "extra"];
  let allInputsPresent = true;
  for (const key of PARAM_KEYS) {
    const n = await page.locator(`[data-id="subprocess-designation-${key}"]`).count();
    if (n !== 1) allInputsPresent = false;
  }
  check("modal has 5 numeric param inputs", allInputsPresent);

  const sumButtonCount = await page.locator('[data-id^="subprocess-designation-sum-"]').count();
  const headcountSumCount = await page.locator('[data-id="subprocess-designation-sum-headcount"]').count();
  check(
    "modal has exactly 4 sigma buttons (no headcount sum)",
    sumButtonCount === 4 && headcountSumCount === 0,
    `sumButtons=${sumButtonCount} headcountSum=${headcountSumCount}`,
  );

  await page.locator('[data-id="subprocess-designation-sum-duration"]').click();
  const durationSummedUnfocused = await waitForCondition(async () => {
    const v = await page.locator('[data-id="subprocess-designation-duration"]').inputValue();
    return v === "1h15m";
  });
  check(
    "Σ(duration): unfocused input shows formatted 1h15m (0.45+0.30=75min)",
    durationSummedUnfocused,
    `got "${await page.locator('[data-id="subprocess-designation-duration"]').inputValue()}"`,
  );
  await page.locator('[data-id="subprocess-designation-duration"]').click();
  const durationRaw = await page.locator('[data-id="subprocess-designation-duration"]').inputValue();
  check('Σ(duration): focus reveals raw normalized value "1.15"', durationRaw === "1.15", `got "${durationRaw}"`);

  await page.locator('[data-id="subprocess-designation-sum-cost"]').click();
  const costSummed = await waitForCondition(async () => {
    const v = await page.locator('[data-id="subprocess-designation-cost"]').inputValue();
    return v === "0.3";
  });
  check(
    'Σ(cost): input filled "0.3" (0.1+0.2)',
    costSummed,
    `got "${await page.locator('[data-id="subprocess-designation-cost"]').inputValue()}"`,
  );
  await page.screenshot({ path: `${SHOTS}/02-modal-summed.png` });

  const [saveResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/maps/${mapAId}/subprocess-designation`) && r.request().method() === "PUT",
    ),
    page.locator('[data-id="subprocess-designation-save"]').click(),
  ]);
  check("save PUT subprocess-designation → 200", saveResp.status() === 200, `status=${saveResp.status()}`);
  await page
    .waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 5000 })
    .catch(() => {});
  check(
    "modal closes after save",
    (await page.locator('[data-id="subprocess-designation-modal"]').count()) === 0,
  );

  const mapADetail = await api(`/maps/${mapAId}`);
  check(
    "persisted: sp_duration=1.15, sp_cost=0.3",
    mapADetail.sp_duration === "1.15" && mapADetail.sp_cost === "0.3",
    `sp_duration=${mapADetail.sp_duration} sp_cost=${mapADetail.sp_cost}`,
  );

  // ═══ 시나리오 ② — 맵 B: 미게시 → Σ 진입 불가(게이트) + 강제오픈으로 내부 disabled 실측 ═══
  const mapB = await api("/maps", {
    method: "POST",
    body: { name: `SP-Params B ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapBId = mapB.id;

  await page.goto(`${BASE}/maps/${mapBId}/settings`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="subprocess-designation-panel"]', { timeout: 15000 });
  const designateBtn = page.locator('[data-id="subprocess-designation-designate"]');
  check(
    "map B (unpublished): Designate entry point is disabled",
    await designateBtn.isDisabled(),
  );
  const hintVisible = await page
    .locator('[data-id="subprocess-designation-panel"]')
    .locator("text=Requires a published version")
    .isVisible()
    .catch(() => false);
  check('map B (unpublished): hint text "Requires a published version." visible', hintVisible);

  // 진입 게이트(hasPublished)와 모달 내부 Σ 게이트(publishedVersionId===null)는 동일 전제라
  // 정상 UI로는 "모달이 열려 있고 Σ가 disabled인" 상태 자체가 도달 불가(진입 버튼이 항상 먼저 막는다).
  // 그 내부 disabled 렌더 경로를 실제로 태우려고 DOM의 disabled 속성만 지우고 btn.click()을 시도했으나
  // 실패(React의 SimpleEventPlugin.shouldPreventMouseEvent가 라이브 DOM이 아니라 파이버 props.disabled를
  // 봐서 여전히 억제 — 실측 확인). 우회책: 파이버에 붙은 __reactProps$* 키로 실제 onClick 핸들러(openModal)를
  // 직접 호출 — 같은 핸들러를 그대로 태우므로 앱 로직 자체는 변형하지 않는다(테스트 전용 우회).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-id="subprocess-designation-designate"]');
    const propsKey = btn && Object.keys(btn).find((k) => k.startsWith("__reactProps$"));
    if (propsKey) btn[propsKey].onClick();
  });
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 5000 });
  let allSumDisabled = true;
  for (const key of ["duration", "etf", "cost", "extra"]) {
    const disabled = await page.locator(`[data-id="subprocess-designation-sum-${key}"]`).isDisabled();
    if (!disabled) allSumDisabled = false;
  }
  check(
    "map B (forced-open probe): all 4 sigma buttons disabled when publishedVersionId is null",
    allSumDisabled,
  );
  await page.screenshot({ path: `${SHOTS}/03-mapB-sigma-disabled.png` });
  await page.locator('[data-id="subprocess-designation-modal"] button', { hasText: "Cancel" }).click();
  await page
    .waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 5000 })
    .catch(() => {});

  // ═══ 시나리오 ③+④ — 맵 C: 맵 A 링크(subprocess 칩) + 인스펙터 Parameters 그룹 ═══
  const mapC = await api("/maps", {
    method: "POST",
    body: { name: `SP-Params C ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapCId = mapC.id;
  const vC = mapC.versions[0].id;

  const cStart = rid();
  const cProc = rid();
  const cSub = rid();
  const cEnd = rid();
  await api(`/versions/${vC}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${vC}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: cStart, title: "Start", node_type: "start", pos_x: 0, pos_y: 200, sort_order: 0 },
        { id: cProc, title: "Inspector Target", node_type: "process", pos_x: 260, pos_y: 200, sort_order: 1 },
        { id: cSub, title: "Call A", node_type: "subprocess", pos_x: 520, pos_y: 200, sort_order: 2, linked_map_id: mapAId },
        { id: cEnd, title: "End", node_type: "end", pos_x: 780, pos_y: 200, sort_order: 3, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: cStart, target_node_id: cProc },
        { id: rid(), source_node_id: cProc, target_node_id: cSub },
        { id: rid(), source_node_id: cSub, target_node_id: cEnd },
      ],
      groups: [],
    },
  });

  await openEditor(mapCId, vC);
  check("editor loads map C (4 nodes on canvas)", (await page.locator(".react-flow__node").count()) === 4);

  const subSel = `.react-flow__node[data-id="${cSub}"]`;
  await page.locator(subSel).scrollIntoViewIfNeeded();
  const subChipsText = await paramChipsLocator(subSel).innerText().catch(() => "");
  check(
    "subprocess node chip shows sp duration formatted 1h15m + cost 0.3 (live ref to map A)",
    subChipsText.includes("1h15m") && subChipsText.includes("0.3"),
    `chips="${subChipsText.replace(/\n/g, " ")}"`,
  );
  await page.locator(subSel).screenshot({ path: `${SHOTS}/04-subprocess-chip.png` });

  // ── ④ 인스펙터 Parameters 그룹 — 기본 접힘·펼침·duration 1.30→1h30m 표시형·포커스 복원·새로고침 유지 ──
  const procSel = `.react-flow__node[data-id="${cProc}"]`;
  await page.locator(procSel).click();
  await ensurePropertiesTab();

  const toggle = page.locator('[data-id="inspector-params-toggle"]');
  check("Parameters group starts collapsed (aria-expanded=false)", (await toggle.getAttribute("aria-expanded")) === "false");

  await toggle.click();
  check("Parameters group expands on click (aria-expanded=true)", (await toggle.getAttribute("aria-expanded")) === "true");
  await page.waitForSelector('[data-id="inspector-param-duration"]', { timeout: 5000 });

  const durationField = page.locator('[data-id="inspector-param-duration"]');
  await durationField.fill("1.30");
  await durationField.blur();
  const blurredDisplay = await durationField.inputValue();
  check('inspector duration: blur shows "1h30m"', blurredDisplay === "1h30m", `got "${blurredDisplay}"`);

  await durationField.click();
  const focusedRaw = await durationField.inputValue();
  check('inspector duration: focus restores raw "1.30"', focusedRaw === "1.30", `got "${focusedRaw}"`);
  await durationField.blur();

  const durationSaved = await waitForCondition(async () => {
    const g = await api(`/versions/${vC}/graph`);
    return g.nodes.find((n) => n.id === cProc)?.duration === "1.30";
  });
  check("inspector duration 1.30 persisted (autosave)", durationSaved);
  await page.screenshot({ path: `${SHOTS}/05-inspector-expanded.png` });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
  await page.locator(procSel).click();
  await ensurePropertiesTab();
  const toggleAfterReload = page.locator('[data-id="inspector-params-toggle"]');
  check(
    "Parameters group stays expanded after reload (localStorage)",
    (await toggleAfterReload.getAttribute("aria-expanded")) === "true",
  );
  const persistedBlurred = await page.locator('[data-id="inspector-param-duration"]').inputValue();
  check('reload: duration still shows "1h30m"', persistedBlurred === "1h30m", `got "${persistedBlurred}"`);
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 시드 정리 — 소프트삭제(휴지통). 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
  if (mapBId !== null) await api(`/maps/${mapBId}`, { method: "DELETE" }).catch(() => {});
  if (mapCId !== null) await api(`/maps/${mapCId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
