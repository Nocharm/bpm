// 통합 비교 화면 검증 — 단일 병합 캔버스 렌더 + diff 색(시드 오라클 added1/removed1/changed2) +
// dev-auth 레이스 수정(GET /maps/{id} 200) + 변경목록 클릭 포커스.
// 실행: node scripts/pw-verify-compare.mjs  (playwright-core, 서버 8000/3000 기동 + reset_db 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
// dev 로그인 우회 — DevGate가 읽는 localStorage 키 선주입(sysadmin=admin)
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin");
});

// 비교 데모 맵 id 찾기 (admin 헤더로 API 직접 조회)
const apiRes = await ctx.request.get("http://localhost:3000/api/maps", {
  headers: { "X-Dev-User": "admin" },
});
const maps = await apiRes.json();
const demo =
  maps.find((m) => /comparison/i.test(m.name)) ??
  maps.find((m) => /as-is|to-be/i.test(m.name));
if (!demo) {
  console.log(JSON.stringify({ ok: false, reason: "compare demo map not found", maps: maps.map((m) => m.name) }, null, 2));
  await browser.close();
  process.exit(1);
}

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
let mapStatus = null;
page.on("response", (r) => {
  if (r.url().endsWith(`/api/maps/${demo.id}`)) mapStatus = r.status();
});

await page.goto(`http://localhost:3000/maps/${demo.id}/compare`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 30000 });
await page.waitForTimeout(1500);

const counts = await page.evaluate(() => ({
  nodes: document.querySelectorAll(".react-flow__node").length,
  ringAdded: document.querySelectorAll(".ring-added").length,
  ringRemoved: document.querySelectorAll(".ring-removed").length,
  ringChanged: document.querySelectorAll(".ring-changed").length,
  edges: document.querySelectorAll(".react-flow__edge").length,
  changeItems: document.querySelectorAll('[data-id="compare-changes"] li').length,
  changesText: document.querySelector('[data-id="compare-changes"]')?.innerText ?? "",
  panes: document.querySelectorAll(".react-flow").length, // 단일 캔버스면 1
}));

// 클릭 포커스 — 첫 변경 항목 클릭 후 뷰포트 transform 변화 확인
const vpBefore = await page.evaluate(
  () => document.querySelector(".react-flow__viewport")?.style.transform ?? "",
);
let focusWorked = false;
const firstItem = page.locator('[data-id="compare-changes"] li button').first();
if ((await firstItem.count()) > 0) {
  await firstItem.click();
  await page.waitForTimeout(700);
  const vpAfter = await page.evaluate(
    () => document.querySelector(".react-flow__viewport")?.style.transform ?? "",
  );
  focusWorked = vpBefore !== vpAfter;
}

console.log(
  JSON.stringify(
    { ok: true, mapId: demo.id, mapName: demo.name, mapStatus, counts, focusWorked, errors },
    null,
    2,
  ),
);
await browser.close();
