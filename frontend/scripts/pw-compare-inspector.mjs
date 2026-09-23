// 비교 화면 2라운드 검증 — 초기 base≠target, 인스펙터 드래그 폭(240~520 클램프+localStorage), 변경 노드 diff 토큰,
// L5 하늘 캔버스 드롭존 캡처(framework 맵이 있을 때만).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-compare-inspector.mjs  (reset_db 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const maps = await (await ctx.request.get(`${BASE}/api/maps`, { headers: { "X-Dev-User": ADMIN } })).json();
const demo = maps.find((m) => /비교 데모|comparison/i.test(m.name));  // scripts.seed_compare_demo
if (!demo) { console.log("FAIL compare demo map not found"); await browser.close(); process.exit(1); }

const page = await ctx.newPage();
await page.goto(`${BASE}/maps/${demo.id}/compare`);
const inspector = page.locator('[data-id="compare-inspector"]');
await inspector.waitFor();

// 초기 base ≠ target — 두 셀렉트의 표시 라벨이 다르다
const baseLabel = (await page.locator('[data-id="compare-version-base"]').innerText()).trim();
const targetLabel = (await page.locator('[data-id="compare-version-target"]').innerText()).trim();
check("initial base and target differ", baseLabel !== "" && baseLabel !== targetLabel, `${baseLabel} vs ${targetLabel}`);

// 인스펙터 기본 폭 288
const w0 = (await inspector.boundingBox()).width;
check("inspector default width is 288", Math.abs(w0 - 288) < 2, String(w0));

// 디바이더를 왼쪽으로 200px 드래그 → 488
const divider = page.locator('[data-id="compare-inspector-divider"]');
const box = await divider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x - 200, box.y + 200, { steps: 8 });
await page.mouse.up();
const w1 = (await inspector.boundingBox()).width;
check("drag widens the inspector by 200", Math.abs(w1 - (w0 + 200)) < 4, String(w1));

// 최대 520 클램프
const box2 = await divider.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + 200);
await page.mouse.down();
await page.mouse.move(box2.x - 900, box2.y + 200, { steps: 8 });
await page.mouse.up();
const w2 = (await inspector.boundingBox()).width;
check("width clamps at 520", Math.abs(w2 - 520) < 2, String(w2));
check("width persists to localStorage", (await page.evaluate(() => window.localStorage.getItem("bpm.compareInspectorWidth"))) === "520");

// 리로드 후 유지
await page.reload();
await inspector.waitFor();
check("width survives reload", Math.abs((await inspector.boundingBox()).width - 520) < 2);

// 변경 노드 테두리가 diff 토큰 색(teal)이다 — 앰버(#9a6b00 = rgb(154,107,0))가 아니다
const changedStroke = await page.evaluate(() => {
  const node = document.querySelector('[data-diff-status="changed"]');
  return node ? getComputedStyle(node).borderColor : null;
});
check("changed node border uses the diff token (not amber)", changedStroke !== null && changedStroke !== "rgb(154, 107, 0)", String(changedStroke));

await page.screenshot({ path: "../docs/qa/screens/compare-inspector-resized.png" });

// L5 하늘 캔버스 드롭존 — framework 맵의 노드 하나를 드래그 중인 프레임을 캡처
const fw = maps.find((m) => m.mode === "framework");
if (fw) {
  await page.goto(`${BASE}/maps/${fw.id}`);
  const nodes = page.locator(".react-flow__node");
  await nodes.first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);  // 체크아웃·편집 가능 판정이 붙을 때까지
  const count = await nodes.count();
  const editable = await page.evaluate(() => document.querySelector(".react-flow__node")?.classList.contains("draggable") ?? false);
  if (count >= 2 && editable) {
    // 드롭존 링은 다른 노드 위에서 머문 뒤(DWELL) 뜬다 — pw-smoke-issue3-dropzone.mjs와 같은 제스처
    const a = await nodes.nth(1).boundingBox();
    const b = await nodes.nth(0).boundingBox();
    const bx = b.x + b.width / 2;
    const by = b.y + b.height / 2;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move((a.x + bx) / 2, (a.y + by) / 2, { steps: 6 });
    await page.mouse.move(bx, by, { steps: 6 });
    await page.waitForTimeout(800);
    await page.mouse.move(bx + 1, by, { steps: 2 });
    await page.waitForTimeout(300);
    check("L5 drop-zone fan renders while dragging", (await page.locator(".zone-fan").count()) > 0);
    await page.screenshot({ path: "../docs/qa/screens/l5-dropzone-dark.png" });
    await page.keyboard.press("Escape");
    await page.mouse.up();
  } else {
    console.log(`SKIP framework map not exercisable (nodes=${count}, editable=${editable})`);
  }
} else {
  console.log("SKIP no framework map in this db");
}

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
