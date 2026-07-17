// sp_description 3표면(지정 모달·인스펙터 카드·설정 패널) + 인박스 subprocess 카테고리 — 브라우저 실기동 검증 (Task 3.3).
// 시나리오: ①맵 게시 → 다른 유저(actor2)가 API로 최초 지정(설명 없음) → 오너(admin.sys)에게 subprocess_registered 알림 발생
//           ②에디터 승인 탭 인스펙터 카드: 지정 직후엔 Description 행 미표시(빈 값)
//           ③카드에서 Edit → 모달 설명 textarea에 입력 → 저장 → 카드에 Description 행 표시
//           ④설정 페이지 SP 패널에도 동일 설명 표시(3표면 정합)
//           ⑤인박스 알림탭 Subprocess 카테고리 필터 → 등록 알림 노출
//           ⑥콘솔 에러 0
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-sp-description.mjs
//   PowerShell: node scripts\pw-verify-sp-description.mjs
// 전제:
//   backend :8000 — cd backend && .venv/bin/python -m scripts.reset_db && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 — cd frontend && npm run dev
//   playwright-core — npm i --no-save playwright-core
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전 pkill -f "next dev" 후 재기동.
//   - auth off·dev_enforce_permissions off라 devUser 전원 sysadmin(=owner) — actor2로 다른 유저 헤더를 써도
//     지정 PUT이 통과한다. 이 성질로 "지정 행위자(actor2) != 수신자(맵 오너 admin.sys)"를 만들어 알림을 실측한다.
// 다운로드 없음 — acceptDownloads 불요.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = "/tmp/pw-verify-sp-description";
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

const openEditor = async (mapId, versionId) => {
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);
};

const openApprovalTab = async () => {
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.waitForSelector('[data-id="sp-inspector-card"]', { timeout: 8000 });
};

// 게시 체인 — checkout→graph PUT→approvers→submit→approve→publish (test_workflow.py / 기존 pw-verify-*.mjs 미러)
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

let mapId = null;
const DESCRIPTION_TEXT = "Handles vendor onboarding checks end-to-end.";

try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments — cannot supply owning_department");
  const approver = (dir0.users.find((u) => u.id === "admin.sys") ?? dir0.users[0])?.id;
  if (!approver) throw new Error("directory has no employees — approval quorum impossible");
  // admin.sys가 아닌 유저 — 지정 행위자로 써서 (오너=admin.sys) != (행위자) 를 만든다 (알림 수신자 실측)
  const actor2 = dir0.users.find((u) => u.id !== "admin.sys")?.id;
  if (!actor2) throw new Error("directory needs a second user distinct from admin.sys");

  // ═══ 맵 생성 + 게시 ═══
  const map = await api("/maps", {
    method: "POST",
    body: { name: `SP-Description ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = map.id;
  const v1 = map.versions[0].id;

  const s = rid();
  const p1 = rid();
  const e = rid();
  await api(`/versions/${v1}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${v1}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 380, sort_order: 0 },
        { id: p1, title: "Step 1", node_type: "process", pos_x: 560, pos_y: 380, sort_order: 1 },
        { id: e, title: "End", node_type: "end", pos_x: 870, pos_y: 380, sort_order: 2, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: s, target_node_id: p1 },
        { id: rid(), source_node_id: p1, target_node_id: e },
      ],
      groups: [],
    },
  });
  await publishVersion(mapId, v1, approver);
  const afterPublish = await api(`/maps/${mapId}`);
  check("map: v1 published", afterPublish.versions.find((v) => v.id === v1)?.status === "published");

  // ═══ 시나리오 ① — actor2가 최초 지정(설명 없음) → 오너(admin.sys)에게 알림 ═══
  await api(`/maps/${mapId}/subprocess-designation`, {
    method: "PUT",
    user: actor2,
    body: {
      department: "Owning Anchor Division",
      assignee: "",
      system: "",
      duration: "",
      cost_krw: "",
      cost_usd: "",
      headcount: "",
      url: "",
      url_label: "",
      description: "",
    },
  });
  const afterDesignate = await api(`/maps/${mapId}`);
  check(
    "initial designation persisted (sp_designated_at set, sp_description empty)",
    afterDesignate.sp_designated_at != null && !afterDesignate.sp_description,
    `sp_designated_at=${afterDesignate.sp_designated_at} sp_description=${afterDesignate.sp_description}`,
  );

  // ═══ 시나리오 ② — 인스펙터 카드: 지정 직후엔 Description 행 미표시 ═══
  await openEditor(mapId, v1);
  await openApprovalTab();
  check("sp-inspector-card shows Designated badge", (await page.locator('[data-id="sp-inspector-card"]').innerText()).includes("Designated"));
  const cardTextBeforeDesc = await page.locator('[data-id="sp-inspector-card"]').innerText();
  check(
    "inspector card: no Description row when sp_description is empty",
    !cardTextBeforeDesc.includes("Description"),
    `cardText="${cardTextBeforeDesc.replace(/\n/g, " | ")}"`,
  );
  await page.screenshot({ path: `${SHOTS}/01-card-no-description.png` });

  // ═══ 시나리오 ③ — 카드 Edit → 모달 textarea 입력·저장 → 카드에 Description 행 표시 ═══
  await page.locator('[data-id="sp-inspector-edit"]').click();
  await page.waitForSelector('[data-id="subprocess-designation-modal"]', { timeout: 5000 });
  const descField = page.locator('[data-id="subprocess-designation-description"]');
  check("modal has description textarea", (await descField.count()) === 1);
  const prefill = await descField.inputValue();
  check('modal description prefilled empty (matches API-only initial designation)', prefill === "", `got "${prefill}"`);

  await descField.fill(DESCRIPTION_TEXT);
  await page.screenshot({ path: `${SHOTS}/02-modal-description-filled.png` });

  const [saveResp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/maps/${mapId}/subprocess-designation`) && r.request().method() === "PUT",
    ),
    page.locator('[data-id="subprocess-designation-save"]').click(),
  ]);
  check("save PUT subprocess-designation → 200", saveResp.status() === 200, `status=${saveResp.status()}`);
  await page
    .waitForSelector('[data-id="subprocess-designation-modal"]', { state: "detached", timeout: 5000 })
    .catch(() => {});

  const cardTextAfterDesc = await page.locator('[data-id="sp-inspector-card"]').innerText();
  check(
    "inspector card shows Description row + saved text",
    cardTextAfterDesc.includes("Description") && cardTextAfterDesc.includes(DESCRIPTION_TEXT),
    `cardText="${cardTextAfterDesc.replace(/\n/g, " | ")}"`,
  );
  await page.screenshot({ path: `${SHOTS}/03-card-with-description.png` });

  const mapAfterSave = await api(`/maps/${mapId}`);
  check(
    "persisted: sp_description matches saved text",
    mapAfterSave.sp_description === DESCRIPTION_TEXT,
    `sp_description="${mapAfterSave.sp_description}"`,
  );

  // ═══ 시나리오 ④ — 설정 페이지 SP 패널에도 동일 설명 표시 ═══
  await page.goto(`${BASE}/maps/${mapId}/settings`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="subprocess-designation-panel"]', { timeout: 15000 });
  const panelText = await page.locator('[data-id="subprocess-designation-panel"]').innerText();
  check(
    "settings SP panel shows Description row + saved text (3-surface consistency)",
    panelText.includes("Description") && panelText.includes(DESCRIPTION_TEXT),
    `panelText="${panelText.replace(/\n/g, " | ")}"`,
  );
  await page.screenshot({ path: `${SHOTS}/04-settings-panel-description.png`, fullPage: true });

  // ═══ 시나리오 ⑤ — 인박스 Subprocess 카테고리 필터 → 등록 알림 노출 ═══
  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  await page.locator("div.inline-grid button", { hasText: "Notifications" }).click();
  await page.waitForTimeout(300);

  const subprocessPill = page.getByRole("button", { name: "Subprocess", exact: true });
  check("inbox has a Subprocess category pill", (await subprocessPill.count()) === 1);
  await subprocessPill.click();
  await page.waitForTimeout(300);

  const cards = page.locator('div[role="button"] span.line-clamp-2');
  const texts = await cards.allTextContents();
  const registrationText = texts.find((t) => t.includes(map.name));
  check(
    "Subprocess category filter shows the subprocess_registered notification",
    registrationText !== undefined && registrationText.includes("서브프로세스로 등록되었습니다"),
    `texts=${JSON.stringify(texts)}`,
  );
  await page.screenshot({ path: `${SHOTS}/05-inbox-subprocess-filter.png` });
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // 시드 정리 — 소프트삭제(휴지통). 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
