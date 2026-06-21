// Issue 1 스모크 — 펼침 영역을 가로질러(우→좌) 루트 노드를 드래그해 빈 공간에 드롭하면 드롭 지점에
// 정확히 안착하는지(드래그 시작 오프셋이 아닌 드롭 위치 오프셋으로 환산) 실측.
// map 3에서 c-order(주문 처리)를 펼치면 그 오른쪽에 임베드 레인이 생긴다. 루트 c-done(이행 완료, 레인 우측)을
// 레인 왼쪽 빈 공간으로 끌어 드롭 → 표시중심이 커서 드롭점 ~반노드폭(화면) 이내여야. 버그면 드롭 직후 노드가
// footprint(수백 flow)만큼 왼쪽으로 튄다(saved를 시작오프셋으로 환산 → 재파생 표시가 빗나감). 새로고침 후도 영속 일치.
// 콘솔 에러 0.  devUser: user.choi(체크아웃 보유자) — task7-drag와 동일.
// 실행: node scripts/pw-smoke-issue1-crossdrag.mjs  (playwright-core, 서버 8000/3000 기동 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AUTOSAVE_WAIT = 2800;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "user.choi"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("Couldn't create edge for source handle")) {
    errors.push(m.text());
  }
});

const rdNode = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return { fx: +m[1], fy: +m[2] };
  }, id);

const rdLaneScreen = () =>
  page.evaluate(() => {
    const portal =
      document.querySelector(".react-flow__viewport-portal") ||
      document.querySelector(".react-flow__viewport");
    const div = [...portal.querySelectorAll("div")].find(
      (d) => d.style.borderLeft && d.style.borderLeft.includes("accent"),
    );
    if (!div) return null;
    const r = div.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });

async function expandAndZoom() {
  await page.evaluate(() =>
    document
      .querySelector('.react-flow__node[data-id="c-order"]')
      ?.querySelector("button[title]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
  );
  await page.waitForTimeout(1800);
  const pane = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(70);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(700);
}

await page.goto("http://localhost:3000/maps/3", { waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);

const editable = await page.evaluate(() =>
  document.querySelector('.react-flow__node[data-id="c-start"]').classList.contains("draggable"),
);
if (!editable) {
  console.log("NOT EDITABLE (read-only) — checkout held by another user; cannot exercise drag.");
  await browser.close();
  process.exit(1);
}

await expandAndZoom();
const lane = await rdLaneScreen();
if (!lane) {
  console.log("NO LANE FOUND — expansion did not render embed region.");
  await browser.close();
  process.exit(1);
}
console.log("lane screen x-band:", JSON.stringify({ left: Math.round(lane.left), right: Math.round(lane.right) }));

// c-done(레인 우측) 을 레인 왼쪽 빈 공간으로 드래그 — 경계를 우→좌로 가로지른다.
const boxD = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
const startX = boxD.x + boxD.width / 2;
const startY = boxD.y + boxD.height / 2;
// 목표: 레인 왼쪽으로 충분히(레인 left 보다 100px 더 왼쪽), 세로는 위로 살짝(다른 노드/존링 회피).
const dropX = Math.max(lane.left - 120, 60);
const dropY = Math.max(startY - 140, lane.top + 20);
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.mouse.move((startX + dropX) / 2, (startY + dropY) / 2, { steps: 10 });
await page.mouse.move(dropX, dropY, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(900);

// 드롭 직후 표시중심이 커서 드롭점에 대응? (반노드폭 화면 이내) — 버그면 footprint*zoom 만큼 왼쪽으로 튐.
const landedBox = await page.locator('.react-flow__node[data-id="c-done"]').boundingBox();
const landedCx = landedBox.x + landedBox.width / 2;
const landedCy = landedBox.y + landedBox.height / 2;
const screenMiss = Math.hypot(landedCx - dropX, landedCy - dropY);
const followOk = screenMiss <= 30; // 줌≈0.2 → 한 노드폭≈18px. footprint(~900flow)면 ~180px 빗나감.
console.log(
  "cross-boundary drop: landed screen center vs cursor — miss(px)=",
  Math.round(screenMiss),
  "followOk=",
  followOk,
  "(landed cx=" + Math.round(landedCx) + " dropX=" + Math.round(dropX) + ")",
);

// 영속 — 새로고침 후(펼침 유지 안 됨, 저장좌표=표시) c-done 표시 x가 레인 왼쪽(드롭한 쪽)인지: c-start(80)보다 작거나 비슷.
await page.waitForTimeout(AUTOSAVE_WAIT);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('.react-flow__node[data-id="c-done"]', { timeout: 30000 });
await page.waitForTimeout(2500);
const reloadDone = await rdNode("c-done");
const reloadStart = await rdNode("c-start");
// 드롭을 레인 왼쪽(=c-start 부근 또는 더 왼쪽)으로 했으니 저장 x도 그 근처여야. 버그면 footprint만큼 더 왼쪽(음수 큼).
// 영속 일치 = 새로고침 표시가 드롭 직후 표시(saved)와 footprint 차 없이 일관 — 여기선 드롭 위치가 c-start 부근 이내인지로 근사.
const persistedNearDrop = reloadDone.fx < reloadStart.fx + 200 && reloadDone.fx > reloadStart.fx - 400;
console.log(
  "persisted near drop (reload c-done.fx within sane band of c-start):",
  persistedNearDrop,
  "(c-done.fx=" + Math.round(reloadDone.fx) + " c-start.fx=" + Math.round(reloadStart.fx) + ")",
);

await page.screenshot({ path: "/tmp/bpm-issue1.png", fullPage: false });
console.log("consoleErrors:", errors.length, errors.slice(0, 3));
await browser.close();

const pass = followOk && persistedNearDrop && errors.length === 0;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
