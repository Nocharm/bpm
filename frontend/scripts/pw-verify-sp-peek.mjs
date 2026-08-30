// SP 라이브러리/체계 피커 미리보기 피크 검증 — 5 시나리오:
//  [1] admin.sys, 일반 맵(26): 행 클릭 → 피크(추가될 노드 목업 + 게시본 SVG 미리보기 + SP 등록정보 필태그)
//      → 헤더 "Add to map" 클릭 → 캔버스에 subprocess 노드 생성 + 행 blocked 전환
//  [2] 바깥 클릭 닫기 → 행 2.5s 호버 → 자동 오픈
//  [3] 미등록 토글 → 미등록 행 클릭 → 미등록 안내 → Add → 확인 체인 모달 오픈
//  [4] bora.choi(권한 없음), draft 전용 맵 27(editor)에서 라이브러리 → 'Incident Response'(map 3)
//      클릭 → 잠금 안내 + 추가 버튼은 활성(등록은 가능)
//  [5] admin.sys, 프레임워크 캔버스(25): 트리 피커 → L5 펼침 → 맵 행 클릭 → 피크 → Add → 노드 생성
// 실행: node scripts/pw-verify-sp-peek.mjs  (서버 8100/3100 전제. 스크린샷은 scratchpad)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOT_DIR =
  "/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm--claude-worktrees-dev/048fa90f-5731-4e5d-b26d-b3226e15097e/scratchpad/shots";
const LIB_BTN = 'button[aria-label="Process library"], button[aria-label="프로세스 라이브러리"]';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
const check = (cond, label) => {
  console.log(`${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
};

async function newPage(devUser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((u) => window.localStorage.setItem("bpm.devUser", u), devUser);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return { ctx, page, errors };
}

// ── [1][2][3] admin.sys 일반 맵 ──────────────────────────────────────────────
{
  const { ctx, page, errors } = await newPage("admin.sys");
  await page.goto("http://localhost:3100/maps/26", { waitUntil: "networkidle" });
  await page.waitForSelector('.react-flow__node[data-id="p-b"]', { timeout: 20000 });
  await page.click(LIB_BTN);
  await page.waitForSelector('[data-id="process-library-panel"]');

  // [1] 행 클릭 → 피크 + 미리보기 + 정보 + Add
  await page.click('[data-id="process-library-panel"] [data-map-id="6"]');
  await page.waitForSelector('[data-id="library-peek"]');
  check(true, "[1] peek opens on row click");
  // ScopePreview 루트(.pointer-events-none)로 스코프 — 목업/아이콘 svg rect 오탐 방지
  await page.waitForSelector('[data-id="library-peek"] .pointer-events-none svg', { timeout: 10000 });
  check(
    (await page.locator('[data-id="library-peek"] .pointer-events-none svg rect').count()) > 0,
    "[1] published SVG preview rendered",
  );
  const addBtn = page.locator('[data-id="library-peek-add"]');
  check(await addBtn.isVisible(), "[1] add button visible in header");
  // 기본 탭 = 노드 목업(우측 최상단) — 기본: 전체 파라미터, 호버: 현재 맵 표시 기준(기본 토글 assignee+params)
  check(await page.locator('[data-id="library-peek-node-mock"]').isVisible(), "[1] node mock on default tab");
  const mockTextFull = await page.locator('[data-id="library-peek-node-mock"]').innerText();
  check(
    mockTextFull.includes("Zendesk") && mockTextFull.includes("₩"),
    "[1] mock full mode shows attrs + all params",
  );
  await page.hover('[data-id="library-peek-node-mock"]');
  await page.waitForTimeout(150);
  const mockTextMap = await page.locator('[data-id="library-peek-node-mock"]').innerText();
  check(
    !mockTextMap.includes("Zendesk") && mockTextMap.includes("₩"),
    "[1] hover switches to current-map display basis",
  );
  // 클릭 시 추가/이동 드롭다운(그대로)
  await page.click('[data-id="library-peek-node-mock"]');
  check(await page.locator('[data-id="library-peek-mock-add"]').isVisible(), "[1] mock menu shows add");
  check(await page.locator('[data-id="library-peek-mock-open"]').isVisible(), "[1] mock menu shows open-map");
  await page.screenshot({ path: `${SHOT_DIR}/peek-1-preview.png` });
  // 맵 이동 → 에디터 이탈 확인 게이트(취소) — 피크는 이동 선택 시 닫힘
  await page.click('[data-id="library-peek-mock-open"]');
  await page.waitForSelector('[data-id="confirm-dialog-cancel"]', { timeout: 5000 });
  check(true, "[1] open-map goes through confirm gate");
  await page.click('[data-id="confirm-dialog-cancel"]');
  await page.waitForTimeout(200);
  check(page.url().includes("/maps/26"), "[1] cancel keeps current editor");
  // 재오픈 → 상세 탭: 아이콘+라벨+값 필 3요소
  await page.click('[data-id="process-library-panel"] [data-map-id="6"]');
  await page.waitForSelector('[data-id="library-peek"]');
  await page.click('[data-id="library-peek-tab-details"]');
  const infoText = await page.locator('[data-id="library-peek-info"]').innerText();
  check(
    infoText.includes("Growth Team") && infoText.length > "Growth Team".length,
    "[1] detail tab lists label+value rows",
  );
  await page.screenshot({ path: `${SHOT_DIR}/peek-1-details.png` });
  const nodesBefore = await page.locator(".react-flow__node").count();
  await addBtn.click();
  await page.waitForTimeout(600);
  const nodesAfter = await page.locator(".react-flow__node").count();
  check(nodesAfter === nodesBefore + 1, `[1] node added to canvas (${nodesBefore}→${nodesAfter})`);
  check((await page.locator('[data-id="library-peek"]').count()) === 0, "[1] peek closes after add");
  const rowClass = await page.getAttribute('[data-id="process-library-panel"] [data-map-id="6"]', "class");
  check(rowClass.includes("cursor-not-allowed"), "[1] row becomes blocked after add");
  await page.screenshot({ path: `${SHOT_DIR}/peek-1-added.png` });

  // [2] 2.5s 호버 자동 오픈 (blocked 행도 미리보기는 제공)
  await page.hover('[data-id="process-library-panel"] [data-map-id="1"]');
  await page.waitForTimeout(1500);
  check((await page.locator('[data-id="library-peek"]').count()) === 0, "[2] not open before delay");
  await page.waitForTimeout(1400);
  check((await page.locator('[data-id="library-peek"]').count()) === 1, "[2] peek opens after 2.5s hover");
  // 바깥 클릭 닫기
  await page.mouse.click(1300, 900);
  await page.waitForTimeout(150);
  check((await page.locator('[data-id="library-peek"]').count()) === 0, "[2] outside click closes peek");

  // [3] 미등록 행 — 안내 + Add=확인 체인
  await page.click('[data-id="library-unregistered-toggle"] input');
  await page.waitForTimeout(700);
  const unregRow = page.locator('[data-id="process-library-panel"] [data-id="library-unregistered-badge"]').first();
  await unregRow.click();
  await page.waitForSelector('[data-id="library-peek-unregistered"]');
  check(true, "[3] unregistered note rendered");
  await page.screenshot({ path: `${SHOT_DIR}/peek-3-unregistered.png` });
  await page.click('[data-id="library-peek-add"]');
  await page.waitForTimeout(500);
  const dialogText = await page.evaluate(() => document.body.innerText);
  check(
    dialogText.includes("not registered as a subprocess") || dialogText.includes("등록되지 않은"),
    "[3] add opens unregistered confirm chain",
  );
  await page.screenshot({ path: `${SHOT_DIR}/peek-3-confirm.png` });
  check(errors.length === 0, `[1-3] no console errors (${errors.slice(0, 2).join("|")})`);
  await ctx.close();
}

// ── [4] bora.choi 권한 없음 케이스 ───────────────────────────────────────────
{
  const { ctx, page, errors } = await newPage("bora.choi");
  await page.goto("http://localhost:3100/maps/27", { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.click(LIB_BTN);
  await page.waitForSelector('[data-id="process-library-panel"]');
  await page.click('[data-id="process-library-panel"] [data-map-id="3"]');
  await page.waitForSelector('[data-id="library-peek-locked"]');
  check(true, "[4] locked notice for no-permission map");
  // ScopePreview 루트(.pointer-events-none) 부재로 판정 — 잠금 안내의 Lock 아이콘 svg는 제외
  check(
    (await page.locator('[data-id="library-peek"] .pointer-events-none svg').count()) === 0,
    "[4] no graph leaked in locked peek",
  );
  check(await page.locator('[data-id="library-peek-add"]').isEnabled(), "[4] add still enabled (등록은 가능)");
  await page.screenshot({ path: `${SHOT_DIR}/peek-4-locked.png` });
  check(errors.length === 0, `[4] no console errors (${errors.slice(0, 2).join("|")})`);
  await ctx.close();
}

// ── [5] 프레임워크 캔버스 트리 피커 ──────────────────────────────────────────
{
  const { ctx, page, errors } = await newPage("admin.sys");
  await page.goto("http://localhost:3100/maps/25", { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.click(LIB_BTN);
  await page.waitForSelector('[data-id="framework-tree-picker"]');
  // 맵 행이 나올 때까지 접힌 카테고리 반복 펼침(레벨 캡 8회)
  for (let round = 0; round < 8; round += 1) {
    const collapsed = page.locator('[data-id="framework-tree-picker"] button[aria-expanded="false"]');
    const n = await collapsed.count();
    if (n === 0) break;
    for (let i = 0; i < n; i += 1) {
      await collapsed.nth(0).click();
      await page.waitForTimeout(250);
    }
  }
  const mapRows = page.locator('[data-id^="framework-picker-map-"]:not(.cursor-not-allowed)');
  const rowCount = await mapRows.count();
  check(rowCount > 0, `[5] linkable map rows in tree (${rowCount})`);
  const firstRow = mapRows.first();
  await firstRow.click();
  await page.waitForSelector('[data-id="library-peek"]');
  check(true, "[5] peek opens in framework picker");
  await page.waitForSelector('[data-id="library-peek"] .pointer-events-none svg', { timeout: 10000 });
  check(
    (await page.locator('[data-id="library-peek"] .pointer-events-none svg rect').count()) > 0,
    "[5] preview rendered",
  );
  // 타 L5 출신 행 — 목업이 캔버스 규칙(홈 L5 색+출처 배지)로 미리 변경돼야 함
  check(
    await page.locator('[data-id="library-peek-mock-origin"]').isVisible(),
    "[5] external-origin mock shows L5 badge",
  );
  await page.screenshot({ path: `${SHOT_DIR}/peek-5-framework.png` });
  const nodesBefore = await page.locator(".react-flow__node").count();
  await page.click('[data-id="library-peek-add"]');
  await page.waitForTimeout(800);
  const nodesAfter = await page.locator(".react-flow__node").count();
  check(nodesAfter === nodesBefore + 1, `[5] node added to framework canvas (${nodesBefore}→${nodesAfter})`);
  await page.screenshot({ path: `${SHOT_DIR}/peek-5-added.png` });
  check(errors.length === 0, `[5] no console errors (${errors.slice(0, 2).join("|")})`);
  await ctx.close();
}

await browser.close();
if (failures.length > 0) {
  console.error(`FAILED sp-peek: ${failures.length} failures`);
  process.exit(1);
}
console.log("PASS sp-peek (all scenarios)");
