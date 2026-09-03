// 엣지 선 모양 스모크 — 인스펙터 개별 변경·컨텍스트 메뉴 행·전체 일괄 변경 확인 모달·영속 라운드트립 실측.
// 실행(frontend/ 에서): node scripts/pw-smoke-edge-style.mjs  (playwright-core, 서버 8000/3000 기동 전제, reset_db 시드)
// 백엔드는 BPM_SYSADMINS=admin.sys 필요(시드 draft를 sion.seo3가 점유 — Force edit 인계로 편집 진입).
// 대상: 맵 1 draft(버전 6) — m1v6-s → m1v6-t → m1v6-e (엣지 2개). 종료 시 seed 복원을 시도하나
// 체크아웃 잠금으로 423이 정상 — 스모크는 일회용 DB(reset_db 재시드) 전제라 무해.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = "http://localhost:8000/api/versions/6/graph";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const getGraph = async () => (await fetch(API)).json();
const edgeByPair = (g, s, t) =>
  g.edges.find((e) => e.source_node_id === s && e.target_node_id === t);
const edgeLoc = (page, id) =>
  page.locator(`.react-flow__edge[data-id="${id}"], .react-flow__edge[data-testid="rf__edge-${id}"]`).first();

// 엣지 경로 중앙의 화면 좌표 — bbox 중심은 꺾은선에서 경로를 벗어날 수 있어 getPointAtLength로 실좌표 산출
const edgePathPoint = (page, id) =>
  page.evaluate((edgeId) => {
    const g =
      document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`) ??
      document.querySelector(`.react-flow__edge[data-testid="rf__edge-${edgeId}"]`);
    const path = g.querySelector("path.react-flow__edge-path");
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }, id);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const seed = await getGraph();
const openMap = async () => {
  // ?version=6 — 기본 진입은 게시본(v5)이라 draft(v6)로 딥링크(편집 가능 버전)
  await page.goto(`${BASE}/maps/1?version=6`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.react-flow__node[data-id="m1v6-s"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
};

const isEditable = () =>
  page.evaluate(() =>
    document.querySelector('.react-flow__node[data-id="m1v6-s"]').classList.contains("draggable"),
  );

try {
  await openMap();
  // 시드는 draft를 sion.seo3가 점유 중 — 시스템관리자로 Force edit 해 점유 인계
  if (!(await isEditable())) {
    const force = page.getByRole("button", { name: "Force edit" }).first();
    if (await force.isVisible().catch(() => false)) {
      await force.click();
      const confirm = page.locator('[data-id="confirm-dialog-confirm"]');
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.click();
      }
      await page.waitForTimeout(3000);
    }
  }
  const editable = await isEditable();
  check("editor editable (draft checkout)", editable);
  if (!editable) throw new Error("read-only editor - cannot exercise pickers");

  const e1 = edgeByPair(seed, "m1v6-s", "m1v6-t");
  const e2 = edgeByPair(seed, "m1v6-t", "m1v6-e");
  check("seed edges found", Boolean(e1 && e2), JSON.stringify(seed.edges.map((e) => e.id)));

  // ── 1) 엣지 클릭 → 인스펙터 Line style 그리드, 저장값(""=꺾은선)이 활성 ──
  const normalize = (v) => (v === "default" || v === "straight" ? v : "smoothstep");
  const expectInitial = normalize(e1.line_style);
  await edgeLoc(page, e1.id).click({ force: true });
  const grid = page.locator('[data-id="inspector-edge-line-style"]');
  const gridVisible = await grid
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("inspector line-style picker visible", gridVisible);
  const initialActive = await page
    .locator(`[data-id="inspector-edge-line-style-${expectInitial}"]`)
    .evaluate((el) => el.className.includes("border-accent"));
  check(`stored value renders active (${expectInitial})`, initialActive);

  // ── 2) Straight 클릭 → autosave(2s) → API line_style="straight" ──
  await page.locator('[data-id="inspector-edge-line-style-straight"]').click();
  await page.waitForTimeout(3000);
  let g = await getGraph();
  check(
    "inspector per-edge straight persisted",
    edgeByPair(g, "m1v6-s", "m1v6-t")?.line_style === "straight",
    JSON.stringify(g.edges.map((e) => e.line_style)),
  );

  // ── 3) 컨텍스트 메뉴 행 — 같은 엣지(e1) 우클릭 → Curved → API "default" ──
  // (e2 중앙은 그룹 박스가 겹쳐 그룹 메뉴가 뜬다 — 좌클릭 선택이 검증된 e1 경로 좌표 사용)
  const p1 = await edgePathPoint(page, e1.id);
  await page.mouse.click(p1.x, p1.y, { button: "right" });
  const menuBtn = page.locator('[data-id="edge-menu-line-style-default"]');
  const menuVisible = await menuBtn
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("context-menu line-style row visible", menuVisible);
  if (menuVisible) {
    await menuBtn.click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(3000);
    g = await getGraph();
    check(
      "context-menu curved persisted",
      edgeByPair(g, "m1v6-s", "m1v6-t")?.line_style === "default",
      JSON.stringify(g.edges.map((e) => e.line_style)),
    );
  }

  // ── 4) 리로드 라운드트립 — 마지막 저장값(curved)이 픽커 활성으로 복원 ──
  await openMap();
  await edgeLoc(page, e1.id).click({ force: true });
  await page.locator('[data-id="inspector-edge-line-style"]').waitFor({ state: "visible", timeout: 5000 });
  const curvedActiveAfterReload = await page
    .locator('[data-id="inspector-edge-line-style-default"]')
    .evaluate((el) => el.className.includes("border-accent"));
  check("reload round-trip: curved active", curvedActiveAfterReload);

  // ── 5) 전체 일괄 변경 — 아코디언 열기 → straight → 확인 모달 → 확정 → 전량 straight ──
  // 인스펙터 "Map" 탭으로 전환(선택 상태 무관) → Edge style 아코디언 펼침
  await page.getByRole("button", { name: "Map", exact: true }).first().click();
  await page.locator('[data-id="inspector-edge-style-section"]').waitFor({ state: "visible", timeout: 5000 });
  await page.locator('[data-id="inspector-edge-style-section"] button').first().click();
  await page.locator('[data-id="inspector-edge-style-all-straight"]').click();
  const modal = page.locator('[data-id="edge-style-apply-all"]');
  const modalVisible = await modal
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("bulk-apply confirm modal shown", modalVisible);
  if (modalVisible) {
    await page.locator('[data-id="confirm-dialog-confirm"]').click();
    await page.waitForTimeout(3000);
    g = await getGraph();
    check(
      "bulk apply persisted all straight",
      g.edges.length > 0 && g.edges.every((e) => e.line_style === "straight"),
      JSON.stringify(g.edges.map((e) => e.line_style)),
    );
  }

  check("console errors 0", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  // seed 복원(멱등) — 지연 autosave가 복원본을 덮지 않게 페이지부터 닫는다
  await page.close().catch(() => {});
  const restore = await fetch(API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seed),
  });
  console.log("seed restore:", restore.status);
  await browser.close();
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails === 0 ? 0 : 1);
