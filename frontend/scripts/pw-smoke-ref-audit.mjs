// 고아 참조 감사 스모크 — 탭 렌더 → 그룹 펼침 → 체크·대상 선택·Apply → 재스캔 → Notify → 인박스 → 홈 배지·필터.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 API_URL=http://localhost:8047 node scripts/pw-smoke-ref-audit.mjs
// 전제: backend(DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys) + frontend 기동,
//       reset_db 후 `python -m scripts.seed_ref_audit_demo`. docs/lessons/browser-verification.md 준수.
//
// 셀렉터 노트(Task 8 fix round 이후 실측): 그룹 내 인터랙티브 data-id는 카드 키
// `${kind}-${value_kind}-${value}` 접미사가 붙는다(예: ref-audit-apply-dept-leaf-Old Team) —
// 그룹 로케이터 안에서 `^=` prefix로 잡는다. DeptTreePicker 행은 챙피언(chevron) 버튼도 섞여
// 있어 `button` 전체 선택자 대신 `[data-id="dept-tree-picker-row"]` + hasText로 특정 행을 집는다.
// PrincipalPicker 드롭다운은 body에 포털되므로 그룹 로케이터로 스코프하면 못 찾는다 — 전역 조회.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const GONE_PATH = "Old Division/Old Office/Old Team";
const GONE_LEAF = "Old Team";
// 스크립트는 frontend/ 에서 실행되므로 워크트리 루트의 계획 워크스페이스로 한 단계 올라간다.
const SHOT_DIR = "../.superpowers/sdd/2026-09-09-ref-audit";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const api = async (p, init = {}) => {
  const res = await fetch(`${API}/api${p}`, {
    ...init, headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN, ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p} -> ${res.status} ${await res.text()}`);
  return res.json();
};
const groupSel = (kind, valueKind, value) => `[data-id="ref-audit-group-${kind}-${valueKind}-${value}"]`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // [1] 탭 진입 + 섹션 렌더
  // 설정 페이지는 ?tab= 딥링크가 없다 — 탭 버튼을 직접 누른다
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Orphaned refs" }).first().click();
  await page.locator('[data-id="ref-audit-panel"]').waitFor({ timeout: 10000 });
  const pathGroup = page.locator(groupSel("dept", "path", GONE_PATH));
  const leafGroup = page.locator(groupSel("dept", "leaf", GONE_LEAF));
  const userGroup = page.locator(groupSel("user", "login", "gone.user"));
  // ref-audit-panel은 GET /admin/ref-audit 완료 전에도 마운트된다 — count()는 auto-wait하지 않으므로
  // 그룹 카드가 실제로 붙을 때까지 기다린 뒤 세야 한다(그렇지 않으면 로딩 중 0으로 오탐).
  await leafGroup.waitFor({ timeout: 10000 });
  check("[1] dept path/leaf + user groups rendered",
    (await pathGroup.count()) === 1 && (await leafGroup.count()) === 1 && (await userGroup.count()) === 1);
  await page.screenshot({ path: `${SHOT_DIR}/shot-refs-tab.png`, fullPage: true });

  // [2] 리프 그룹 펼침 — 노드 라인 체크 불가, SP 라인 체크 가능
  await leafGroup.locator('[data-id^="ref-audit-group-toggle-"]').click();
  await leafGroup.locator('[data-id="ref-audit-actions"]').waitFor({ timeout: 5000 });
  const nodeLines = await leafGroup.locator('[data-id^="ref-audit-line-node_dept:"][data-checkable="false"]').count();
  const spLines = await leafGroup.locator('[data-id^="ref-audit-line-sp_dept:"][data-checkable="true"]').count();
  check("[2] node lines uncheckable (published+draft), sp line checkable", nodeLines === 2 && spLines === 1,
    `node=${nodeLines} sp=${spLines}`);

  // [3] 전체 선택 → 대상 부서 선택 → Apply → 재스캔 후 SP 라인 사라짐
  await leafGroup.locator('[data-id^="ref-audit-check-all-"]').click();
  await leafGroup.locator('[data-id^="ref-audit-pick-dept-"]').click();
  await page.locator('[data-id="dept-tree-picker"] input').fill("Logistics Team");
  await page.locator('[data-id="dept-tree-picker-list"] [data-id="dept-tree-picker-row"]')
    .filter({ hasText: "Logistics Team" }).first().click();
  await leafGroup.locator('[data-id^="ref-audit-apply-"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.locator('[data-id="ref-audit-message"]').waitFor({ timeout: 10000 });
  const msg = await page.locator('[data-id="ref-audit-message"]').innerText();
  check("[3] apply applied 1 line", /Applied 1/.test(msg), msg);
  await page.screenshot({ path: `${SHOT_DIR}/shot-apply-applied.png`, fullPage: true });
  await leafGroup.locator('[data-id^="ref-audit-group-toggle-"]').click();
  await leafGroup.locator('[data-id="ref-audit-actions"]').waitFor({ timeout: 5000 });
  check("[3b] sp line gone after rescan",
    (await leafGroup.locator('[data-id^="ref-audit-line-sp_dept:"]').count()) === 0);

  // [4] Notify owners → 인박스 알림 맵 필
  await leafGroup.locator('[data-id^="ref-audit-notify-"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.locator('[data-id="ref-audit-message"]', { hasText: "Notified 1 owner" }).waitFor({ timeout: 10000 });
  const notifs = await api("/notifications");
  const fix = notifs.find((n) => n.type === "ref_fix_requested");
  check("[4] ref_fix_requested notification to admin.sys with map list",
    !!fix && Array.isArray(fix.payload?.maps) && fix.payload.maps.length === 1 && fix.payload.maps[0].node_dept === 4);

  // [5] 사용자 그룹 — replace 오너 → owner_assigned 알림
  await userGroup.locator('[data-id^="ref-audit-group-toggle-"]').click();
  await userGroup.locator('[data-id="ref-audit-actions"]').waitFor({ timeout: 5000 });
  await userGroup.locator('[data-id^="ref-audit-check-all-"]').click();
  await userGroup.locator('[data-id^="ref-audit-pick-user-"] input').fill("System Admin");
  await page.locator('[data-id="principal-picker-dropdown"]').getByText("System Admin").first().click();
  await userGroup.locator('[data-id^="ref-audit-apply-"]').click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.locator('[data-id="ref-audit-message"]', { hasText: "Applied" }).waitFor({ timeout: 10000 });
  const ownerMap = (await api("/maps")).find((m) => m.name === "Ref demo - departed owner");
  check("[5] owner replaced + owner_assigned notice",
    ownerMap?.owner_id === ADMIN &&
      (await api("/notifications")).some((n) => n.type === "owner_assigned" && n.map_id === ownerMap.id));

  // [6] 홈 배지 + Issues 필터
  // 부서 뷰는 카드가 접힌 아코디언 안에 있어 펼치기 전엔 마운트되지 않는다 — 검색 대신 실제 트리 토글을
  // 3단(Old Division→Old Office→Old Team) 펼쳐 데모 맵 카드를 노출시킨다("Unassigned department"
  // 섹션은 기본 펼침이라 배지 없는 카드 기준선도 검색 없이 이미 존재한다).
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('[data-id="org-node-toggle"][data-path="Old Division"]').click();
  await page.locator('[data-id="org-node-toggle"][data-path="Old Division/Old Office"]').click();
  await page.locator('[data-id="org-node-toggle"][data-path="Old Division/Old Office/Old Team"]').click();
  const badge = page.locator('[data-id="map-card-stale-refs"]');
  await badge.first().waitFor({ timeout: 10000 });
  check("[6] stale refs badge on home card", (await badge.count()) >= 1);
  await page.screenshot({ path: `${SHOT_DIR}/shot-home-badge.png`, fullPage: true });

  const mapCard = () => page.locator('[data-id="map-card"]');
  const mapCardWithBadge = () => page.locator('[data-id="map-card"]:has([data-id="map-card-stale-refs"])');
  const totalBefore = await mapCard().count();
  const withBadgeBefore = await mapCardWithBadge().count();
  check("[6a] some cards lack the badge before filtering (baseline diversity)",
    totalBefore > withBadgeBefore, `total=${totalBefore} withBadge=${withBadgeBefore}`);

  await page.locator('[data-id="home-owning-filter"]').click();
  await page.getByText("Stale references").first().click();
  await page.locator('[data-id="home-owning-filter"]').click(); // 드롭다운 닫기(카드 리렌더 대기)
  const totalAfter = await mapCard().count();
  const withBadgeAfter = await mapCardWithBadge().count();
  check("[6b] Issues filter keeps only stale-ref maps",
    totalAfter >= 1 && withBadgeAfter === totalAfter, `total=${totalAfter} withBadge=${withBadgeAfter}`);

  // [7] 인박스 렌더
  // 좁은 화면용 카드-아래 아코디언(`notification-detail-accordion`, split:hidden)도 같은 상세를 마운트해
  // 두고 CSS로만 숨긴다 — data-id 카운트가 중복되므로 ≥980px에서만 보이는 우측 aside로 스코프한다.
  await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  await page.getByText("Stale references").first().click();
  const detailChips = page.locator('[data-id="inbox-detail-aside"] [data-id^="inbox-ref-fix-map-"]');
  await detailChips.first().waitFor({ timeout: 10000 });
  check("[7] inbox shows map chips", (await detailChips.count()) === 1);
  check("[8] no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} PASS / ${failed} FAIL`);
process.exit(failed ? 1 : 0);
