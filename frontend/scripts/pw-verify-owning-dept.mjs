// 오우닝 부서(owning department) e2e — 8시나리오 (brief 6개 + 리뷰 요청 2개 추가):
//   ① 생성 다이얼로그: 이름+승인자만 채우면 Create 비활성, requiredHint 노출.
//   ② 오우닝 부서 피커에서 부서 선택 → 부서장(manager) 승인자 pill 자동 추가.
//   ③ 잠금 표시(선택 블록·협업자 목록 행) 확인 → 자동 pill 제거 → 승인자 피커 브라우즈 시
//     제거된 리더가 다시 최상단(Dept Lead 배지)으로 뜨는지 확인.
//   ④ Create → 에디터 진입 → 설정 페이지에 오우닝 부서 표시.
//   ⑤ 홈: 시드된 누락 맵(idx%3==0)에 배지 → Missing 필터 → 목록이 누락 맵만 남는지 확인.
//   ⑥ sysadmin(admin.sys)으로 누락 맵 설정 → Assign → 부서 선택 → 표시 전환 + 협업자 잠금 행.
//   ⑦ 리더-수동추가 겹침: 승인자 피커에서 리더를 먼저 수동 추가 → 그 리더가 manager인 부서를
//     오우닝 부서로 선택(자동 추가는 dedup으로 스킵) → 오우닝 부서 해제 → 수동 pill이 남는지 확인.
//   ⑧ 협업자 패널 빈 문구: 오우닝 부서가 지정된 신규 맵의 설정>Collaborators에서
//     "No collaborators yet."이 잠금 행과 동시에 보이지 않아야 PASS.
//
// 사전 설정(SETUP): seed_org_demo.py는 DeptInfo(부서장) 테이블을 시드하지 않는다(어드민 JSON
// 임포트 전용, tests/conftest만 직접 seed) — ②③⑥⑦(리더 자동추가·핀고정)을 시연하려면 최소
// 부서장 1명이 필요해, 이 스크립트가 실행 시점에 /api/admin/dept-info PUT으로 부서장 1명을
// 심는다(디렉터리에서 런타임 선택, 하드코딩 아님). ⚠️ 이 PUT은 dev.db에 영구 반영된다(시드
// 재실행 전까지) — 완전 복원은 docs/lessons/browser-verification.md대로
// git checkout backend/dev.db + 백엔드 재시작.
//
// 실행 (frontend/ 에서):
//   bash:       node scripts/pw-verify-owning-dept.mjs
//   PowerShell: node scripts\pw-verify-owning-dept.mjs
// 전제:
//   backend :8000 기동 — cd backend && .venv/bin/uvicorn app.main:app --port 8000
//   frontend :3000 기동 — cd frontend && npm run dev
//   playwright-core 설치 — npm i --no-save playwright-core
//   Chrome 경로가 기본값과 다르면 CHROME_PATH 환경변수로 지정
// ⚠️ 함정 (docs/lessons/browser-verification.md):
//   - 좀비 next dev가 :3000을 점유하면 새 서버가 :3001로 밀려 낡은 빌드에 붙는다 → 실행 전
//     pkill -f "next dev" 후 재기동.
//   - dev.db 오염: 이 스크립트는 ⑥에서 시드 맵 1개의 owning_department를 영구 지정하고(되돌리는
//     API 없음), SETUP에서 DeptInfo 1행을 심는다. 완전 복원은 git checkout backend/dev.db +
//     백엔드 재시작. ②~④·⑧에서 만든 맵 1개는 스크립트 종료 시 소프트삭제로 정리한다.
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (title) => console.log(`\n=== ${title} ===`);

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

// principal-picker 검색 입력 — 세 폼(오우닝 부서·협업자·승인자)이 동시에 렌더될 수 있어
// placeholder만으로는 구분 안 됨. 호출부가 DOM 순서상의 인덱스를 넘긴다(오우닝 미선택 시
// 오우닝(0)·협업자(1)·승인자(2), 선택 후엔 오우닝 입력이 언마운트되어 협업자(0)·승인자(1)).
const pickerInputs = () => page.locator('input[placeholder^="Search by name"]');
const selectViaPicker = async (inputIndex, query) => {
  const input = pickerInputs().nth(inputIndex);
  await input.click();
  await input.fill(query);
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.waitForTimeout(200); // 필터링 리렌더 대기
  await page.locator('[data-id="principal-picker-dropdown"] button').first().click();
  await page.waitForTimeout(150);
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
  console.error("  start it: cd backend && .venv/bin/uvicorn app.main:app --port 8000");
  await browser.close();
  process.exit(1);
}

let mapAId = null; // 시나리오②~④·⑧에서 만드는 실 맵 — 끝에 소프트삭제로 정리

try {
  // ── SETUP — 부서장 픽스처: 시드가 DeptInfo를 채우지 않아 런타임에 1건 심는다 ──
  section("SETUP — seed a department manager via /api/admin/dept-info (DeptInfo not covered by seed_org_demo)");
  const me = await api("/me");
  const dirBefore = await api("/directory");
  const fixtureDept = dirBefore.departments.find((d) => d.name.length > 0);
  const fixtureManager = dirBefore.users.find((u) => u.id !== me.username);
  if (!fixtureDept || !fixtureManager) {
    throw new Error("directory has no usable department/user to seed a manager fixture");
  }
  await api("/admin/dept-info", {
    method: "PUT",
    body: { entries: { [fixtureDept.name]: { manager: fixtureManager.id } } },
  });
  const dirAfter = await api("/directory");
  const dept = dirAfter.departments.find((d) => d.id === fixtureDept.id);
  check(
    "fixture department now has a non-empty manager",
    dept?.manager === fixtureManager.id,
    `dept=${dept?.id} manager=${dept?.manager}`,
  );

  // ── ① New map 다이얼로그 — 이름+승인자만 채우면 Create 비활성, requiredHint 노출 ──
  section("① create dialog: owning department required before Create enables");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New map" }).first().click();
  await page.waitForSelector('[data-id="create-map-description"]');
  const mapName = `T8 owning-dept pw-${Date.now()}`;
  await page.locator('input[placeholder="Map name"]').fill(mapName);
  // 승인자로 본인(admin.sys) 추가 — 오우닝 미선택 상태라 입력 인덱스는 오우닝(0)·협업자(1)·승인자(2)
  await selectViaPicker(2, me.username);
  check(
    "approver pill added for self",
    (await page.locator(`[data-id="create-approver-pill-${me.username}"]`).count()) === 1,
  );
  const createBtn = page.getByRole("button", { name: "Create", exact: true });
  check("Create disabled without an owning department", await createBtn.isDisabled());
  check(
    "requiredHint shown",
    (await page.locator("text=Select the owning department.").count()) > 0,
  );

  // ── ② 오우닝 부서 피커에서 부서 선택 → 부서장 승인자 pill 자동 추가 ──
  section("② picking the owning department auto-adds its leader as an approver");
  // manager 로그인id로 검색 — 부서명 대신 리더 키워드로 매치하면 조직 트리 leaf명 중복과 무관해진다
  await selectViaPicker(0, fixtureManager.id);
  check("owning-dept-selected block visible", await page.locator('[data-id="owning-dept-selected"]').isVisible());
  const selectedText = await page.locator('[data-id="owning-dept-selected"]').innerText();
  check("selected block shows the picked department", selectedText.includes(dept.id), selectedText.slice(0, 80));
  check(
    "department leader auto-added as an approver pill",
    (await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"]`).count()) === 1,
  );

  // ── ③ 잠금 표시 확인 → 자동 pill 제거 → 승인자 피커 브라우즈 시 리더가 다시 최상단(Dept Lead) ──
  section("③ locked row + removed leader re-surfaces pinned at top of the approver picker");
  check(
    "owning-dept-locked-row visible in the collaborators list",
    await page.locator('[data-id="owning-dept-locked-row"]').isVisible(),
  );
  await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"] button`).click();
  check(
    "auto-added leader pill removed",
    (await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"]`).count()) === 0,
  );
  // 오우닝 부서가 이미 선택된 상태라 입력 인덱스는 협업자(0)·승인자(1)
  const approverInputAfterOwning = pickerInputs().nth(1);
  await approverInputAfterOwning.click();
  await page.waitForSelector('[data-id="principal-picker-dropdown"]');
  await page.waitForTimeout(200);
  const firstItemText = await page.locator('[data-id="principal-picker-dropdown"] button').first().innerText();
  check(
    "removed leader reappears pinned at top with the Dept Lead badge",
    firstItemText.includes(fixtureManager.id) && firstItemText.includes("Dept Lead"),
    firstItemText.replace(/\n/g, " | ").slice(0, 100),
  );
  await page.keyboard.press("Escape");

  // ── ④ Create → 에디터 진입 → 설정 페이지에 오우닝 부서 표시 ──
  section("④ create → editor → settings shows the owning department");
  check("Create enabled (self approver remains, owning dept set)", await createBtn.isEnabled());
  await createBtn.click();
  await page.waitForURL(/\/maps\/\d+/, { timeout: 20000 });
  mapAId = Number(page.url().match(/\/maps\/(\d+)/)[1]);
  check("map created and opened in the editor", true, `mapId=${mapAId}`);
  await page.goto(`${BASE}/maps/${mapAId}/settings`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="settings-owning-dept"]');
  const settingsText = await page.locator('[data-id="settings-owning-dept"]').innerText();
  check("settings page shows the owning department", settingsText.includes(dept.id), settingsText.slice(0, 100));

  // ── ⑧ 협업자 패널 빈 문구 — 잠금 행과 동시에 뜨면 안 됨 (같은 설정 페이지, 이어서 확인) ──
  section("⑧ collaborators panel: empty-list note must not coexist with the locked row");
  await page.waitForSelector("#sec-collaborators");
  check(
    "owning-dept locked row visible in collaborators section",
    await page.locator('#sec-collaborators [data-id="owning-dept-locked-row"]').isVisible(),
  );
  const collabText = await page.locator("#sec-collaborators").innerText();
  check('"No collaborators yet." not shown alongside the locked row', !collabText.includes("No collaborators yet."));

  // ── ⑤ 홈 — 누락 맵 배지 + Missing 필터 ──
  section("⑤ home: missing-owning badge + Missing filter");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const maps = await api("/maps");
  const missingMaps = maps.filter((m) => !m.owning_department);
  check(
    "seed produced missing-owning maps (idx%3==0)",
    missingMaps.length >= 4,
    `count=${missingMaps.length}`,
  );
  const missingSample = missingMaps[0];
  const assignedSample = maps.find((m) => m.owning_department && m.id !== mapAId);
  const missingCard = page.locator('[data-id="map-card"]').filter({ hasText: missingSample.name });
  check(
    "missing map shows the owning-missing badge",
    await missingCard.locator('[data-id="map-card-owning-missing"]').isVisible(),
  );
  await page.locator('[data-id="home-owning-filter"]').click();
  await page.getByRole("button", { name: "Missing owning dept" }).click();
  await page.waitForTimeout(300);
  check(
    "Missing filter keeps the missing map",
    (await page.locator('[data-id="map-card"]').filter({ hasText: missingSample.name }).count()) > 0,
  );
  check(
    "Missing filter hides an assigned map",
    (await page.locator('[data-id="map-card"]').filter({ hasText: assignedSample.name }).count()) === 0,
  );
  const cardCount = await page.locator('[data-id="map-card"]').count();
  const badgeCount = await page.locator('[data-id="map-card-owning-missing"]').count();
  check(
    "every card visible under the filter carries the missing badge",
    cardCount === badgeCount && cardCount > 0,
    `cards=${cardCount} badges=${badgeCount}`,
  );
  await page.locator('[data-id="home-filter-clear"]').click();

  // ── ⑥ sysadmin으로 누락 맵 설정 → Assign → 협업자 잠금 행 반영 ──
  section("⑥ sysadmin assigns the owning department from settings");
  await page.goto(`${BASE}/maps/${missingSample.id}/settings`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-id="settings-owning-dept"]');
  check("missing map shows the Assign prompt", await page.locator('[data-id="owning-dept-assign"]').isVisible());
  await page.locator('[data-id="owning-dept-assign"]').click();
  // 설정 화면의 오우닝 피커(0)가 협업자 섹션의 상시 피커(1)보다 DOM상 먼저 온다
  await selectViaPicker(0, fixtureManager.id);
  check("Assign switched to the Change control", await page.locator('[data-id="owning-dept-change"]').isVisible());
  const settingsText2 = await page.locator('[data-id="settings-owning-dept"]').innerText();
  check("assigned department shown", settingsText2.includes(dept.id), settingsText2.slice(0, 100));
  await page.waitForSelector("#sec-collaborators");
  check(
    "collaborators locked row appears reactively (no reload)",
    await page.locator('#sec-collaborators [data-id="owning-dept-locked-row"]').isVisible(),
  );

  // ── ⑦ 리더-수동추가 겹침 — 수동 pill이 자동추가 dedup·clear를 모두 살아남는지 ──
  section("⑦ manually-added leader survives owning-dept auto-add dedup and clear");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New map" }).first().click();
  await page.waitForSelector('[data-id="create-map-description"]');
  await page.locator('input[placeholder="Map name"]').fill(`T8 leader-overlap pw-${Date.now()}`);
  // Public — 승인자 후보군을 전 직원으로 넓혀 부서 무관 없이도 리더를 수동 추가할 수 있게 한다.
  // 승인자가 아직 0명이라 확인 모달 없이 즉시 적용된다.
  // 다이얼로그 스코프 필수 — 홈 화면 자체의 가시성 필터에도 동명 "Public" 버튼이 있어
  // 페이지 전역 getByRole은 strict-mode 위반(2개 매치)으로 터진다.
  await page.locator("div.max-w-lg").getByRole("button", { name: "Public", exact: true }).click();
  await selectViaPicker(2, fixtureManager.id); // 오우닝 미선택 상태 — 승인자 입력은 인덱스 2
  check(
    "leader manually added as an approver first",
    (await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"]`).count()) === 1,
  );
  await selectViaPicker(0, fixtureManager.id); // 그 리더가 manager인 부서를 오우닝 부서로 선택
  check("owning dept selected", await page.locator('[data-id="owning-dept-selected"]').isVisible());
  check(
    "dedup — no duplicate approver pill after auto-add would-be leader",
    (await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"]`).count()) === 1,
  );
  await page.locator('[data-id="owning-dept-selected"] button').click(); // 오우닝 부서 X로 해제
  check("owning dept cleared", (await page.locator('[data-id="owning-dept-selected"]').count()) === 0);
  check(
    "manually-added leader pill survives the clear",
    (await page.locator(`[data-id="create-approver-pill-${fixtureManager.id}"]`).count()) === 1,
  );
  await page.keyboard.press("Escape");
  await page.locator('div.max-w-lg button[aria-label="Cancel"]').click();
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  // ②~④·⑧에서 만든 실 맵만 정리(소프트삭제). ⑥의 시드 맵 owning_department·SETUP의 DeptInfo는
  // 되돌리는 API가 없다 — 완전 복원은 git checkout backend/dev.db + 백엔드 재시작.
  if (mapAId !== null) await api(`/maps/${mapAId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
