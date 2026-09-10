// 노드 조직 참조 경고 캡처 — 캔버스 인라인 아이콘 · 배지 호버 내역 · 인스펙터 부서/담당자 필.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-orphan-warning-shots.mjs
// 전제: backend(8047) + frontend(3047) 기동, `python -m scripts.seed_ref_audit_demo` 시드.
//       맵 24 "Ref demo - stale node refs"의 노드 Check request = 부서 Old Team + 담당자 Gone Person.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const MAP_ID = 24;
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/claude-501/-Users-hyeonjin-Documents-bpm/dac09fa1-cd6a-48b5-887b-e7bdd0eb2383/scratchpad";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
    // 부서·담당자 줄을 켜 둔다 — 경고 아이콘이 그 줄에 붙는다
    window.localStorage.setItem(
      "bpm.nodeDisplayFields.v2",
      JSON.stringify(["assignee", "department", "system", "params"]),
    );
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/maps/${MAP_ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  // 디렉터리 fetch 도착까지 — 도착 전엔 판정 보류라 경고가 안 뜬다
  await page.waitForSelector('[data-id="node-warning-badge"]', { timeout: 20000 });

  const badges = await page.locator('[data-id="node-warning-badge"]').count();
  check("경고 배지 노출", badges > 0, `${badges}개`);

  await page.screenshot({ path: `${SHOT_DIR}/orphan-1-canvas.png` });

  // 배지 호버 → 내역 카드
  await page.locator('[data-id="node-warning-badge"]').first().hover();
  await page.waitForSelector('[data-id="node-warning-tip"]', { timeout: 5000 });
  const tipText = (await page.locator('[data-id="node-warning-tip"]').innerText()).replace(/\n/g, " | ");
  check("호버 내역 카드", tipText.includes("Old Team") && tipText.includes("Gone Person"), tipText);
  await page.screenshot({ path: `${SHOT_DIR}/orphan-2-hover.png` });

  // 노드 선택은 좌측 Outline 행으로 — 캔버스에서 겹친 노드는 클릭이 서로 가로채인다.
  await page.mouse.move(8, 8);
  await page.waitForTimeout(300);
  await page.getByText("Check request", { exact: true }).first().click();
  await page.waitForTimeout(600);
  // BPM attributes 아코디언은 기본 접힘 — 부서/담당자 행이 그 안에 있다
  const attrs = page.getByText(/^BPM attributes/).first();
  await attrs.click();
  await page.waitForTimeout(600);
  const orphanPills = await page.locator('[data-orphan="true"]').count();
  check("인스펙터 고아 필", orphanPills > 0, `${orphanPills}개`);
  await page.screenshot({ path: `${SHOT_DIR}/orphan-3-inspector.png` });

  check("페이지 에러 없음", pageErrors.length === 0, pageErrors.join(" / "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
