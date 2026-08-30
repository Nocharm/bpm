// SP 펼침 UX 7종 검증 — 맵 4(일반, SP 2개 지정+체계) draft(v91) 기준:
//  [1] 펼친 자식 노드 클릭 → Tab/Shift+Tab이 자식 흐름을 순회(아웃라인과 동일 UX)
//  [2] 펼침 상태에서 바깥(밀린) 노드 방향키 이동 — 아래로 점프 없음(rootOffsets 역변환)
//  [3] 틴트 영역 호버 강조 + 우클릭 메뉴(Open linked map=확인 게이트 / Collapse)
//  [4] 영역 헤더 — 맵 이름·열기 아이콘 가시성 + 업무체계 5단계 경로 라벨(클릭=체계 피크)
//  [5] 체계 피크 패널 유예 닫힘(플라이아웃 갭 이동에도 유지, 이탈 400ms 후 닫힘) + 탐색 라벨 행
//  [6] 줌인 후 아웃라인 연속 이동 — 비행 중 재이동에도 앵커 줌 복귀(줌아웃 눌러앉음 없음)
//  [7] 펼친 자식 노드 GMP 태그 읽기전용(span) — 편집 모드 메인 노드는 버튼 유지
// 실행: (frontend/) node scripts/pw-verify-sp-ux7.mjs  — 서버 8000/3000, 맵19 노드 gmp 임시 주입 전제
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR =
  process.env.SHOT_DIR ??
  "/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm--claude-worktrees-dev/38e7b56d-3133-4546-9df7-3e24a2e9f969/scratchpad/shots-ux7";

const failures = [];
const check = (cond, label) => {
  console.log(`${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  // GMP 필 표시 토글 ON — [7] 검증용
  window.localStorage.setItem(
    "bpm.nodeDisplayFields.v2",
    JSON.stringify(["assignee", "params", "gmp"]),
  );
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const nodeBoxes = async () => {
  return page.$$eval(".react-flow__node", (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-id"), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
};
const viewportScale = async () => {
  return page.$eval(".react-flow__viewport", (el) => {
    const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
    return m ? parseFloat(m[1]) : 1;
  });
};
const selectedNodeId = async () => {
  return page.evaluate(
    () => document.querySelector(".react-flow__node.selected")?.getAttribute("data-id") ?? null,
  );
};

// ── 진입: draft 버전 딥링크(편집 모드) ───────────────────────────────────────
await page.goto(`${BASE}/maps/4?version=91`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 20000 });
await sleep(1200);
const force = page.getByRole("button", { name: /Force edit|강제 편집/ }).first();
if (await force.count()) {
  await force.click();
  await sleep(1200);
}
check((await force.count()) === 0 || !(await force.isVisible()), "edit mode entered (no force-edit left)");

// ── [4] SP 펼침 + 영역 헤더 ─────────────────────────────────────────────────
const preBoxes = await nodeBoxes();
const spNode = page.locator('.react-flow__node:has-text("안정성 시험 검체 관리")').first();
await spNode.click();
await sleep(400);
await page.click('[data-id="node-action-expand"]');
await page.waitForSelector('[data-id^="region-band-"]', { timeout: 15000 });
await sleep(1400); // 슬라이드/성장 정착

check(await page.locator('[data-id="region-open-map"]').first().isVisible(), "[4] open-map icon visible");
const fwLabel = page.locator('[data-id^="region-framework-"]').first();
check((await fwLabel.count()) > 0, "[4] region framework label rendered");
const fwText = (await fwLabel.count()) ? await fwLabel.innerText() : "";
check(
  fwText.includes("Quality/품질관리(QC)/시험 운영/완제품 시험/완제품 출하 시험 관리"),
  `[4] framework label shows full 5-level path (got: ${fwText.slice(0, 60)})`,
);
await page.screenshot({ path: `${SHOT_DIR}/01-region-header.png` });

// ── [5] 체계 피크 — 유예 닫힘 + 탐색 라벨 행 ────────────────────────────────
await fwLabel.click();
await page.waitForSelector('[data-id="node-framework-peek"]', { timeout: 10000 });
check(true, "[5] framework peek opens from region label");
const browseRow = page.locator('[data-id="framework-chip-browse"]');
await browseRow.waitFor({ timeout: 10000 });
const browseText = await browseRow.innerText();
check(
  /Search other frameworks|다른 체계 검색/.test(browseText),
  `[5] browse row labeled (got: ${browseText})`,
);
await page.waitForSelector('[data-id^="editor-framework-row-"]', { timeout: 10000 });
const l5Row = page.locator('[data-id^="editor-framework-row-"]').last();
await l5Row.click();
await page.waitForSelector('[data-id="editor-framework-flyout"]', { timeout: 10000 });
await sleep(500); // 맵 목록 로드
await page.screenshot({ path: `${SHOT_DIR}/02-peek-flyout.png` });
const rowBox = await l5Row.boundingBox();
const flyBox = await page.locator('[data-id="editor-framework-flyout"]').boundingBox();
if (rowBox && flyBox) {
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
  await sleep(80);
  // 패널→플라이아웃 사이 6px 갭 통과(패널 밖) — 유예 덕에 닫히지 않아야 한다
  await page.mouse.move(flyBox.x + flyBox.width + 3, rowBox.y + rowBox.height / 2, { steps: 2 });
  await sleep(120);
  await page.mouse.move(flyBox.x + flyBox.width / 2, flyBox.y + flyBox.height / 2, { steps: 2 });
  await sleep(600);
  check(
    (await page.locator('[data-id="node-framework-peek"]').count()) > 0,
    "[5] peek survives gap-crossing to flyout",
  );
  // 완전 이탈 — 250ms 시점엔 아직 열림(유예), 750ms 시점엔 닫힘
  await page.mouse.move(300, 850, { steps: 3 });
  await sleep(220);
  check(
    (await page.locator('[data-id="node-framework-peek"]').count()) > 0,
    "[5] grace: still open ~250ms after leave",
  );
  await sleep(550);
  check(
    (await page.locator('[data-id="node-framework-peek"]').count()) === 0,
    "[5] closes after grace elapses",
  );
} else {
  check(false, "[5] flyout/row bbox unavailable");
}

// ── [7] 자식 GMP 읽기전용 ───────────────────────────────────────────────────
const band = await page.locator('[data-id^="region-band-"]').first().boundingBox();
check(band !== null, "region band bbox available");
const postBoxes = await nodeBoxes();
const preIds = new Set(preBoxes.map((b) => b.id));
const childBoxes = postBoxes.filter(
  (b) =>
    !preIds.has(b.id) &&
    band &&
    b.x + b.w / 2 > band.x &&
    b.x + b.w / 2 < band.x + band.width &&
    b.y + b.h / 2 > band.y &&
    b.y + b.h / 2 < band.y + band.height,
);
check(childBoxes.length >= 3, `[1pre] embedded child nodes present (${childBoxes.length})`);
const gmpInfo = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.react-flow__node [data-id="node-gmp-pill"]')) {
    const host = el.closest(".react-flow__node");
    out.push({ tag: el.tagName, node: host?.getAttribute("data-id") ?? "", text: el.textContent ?? "" });
  }
  return out;
});
const childIds = new Set(childBoxes.map((b) => b.id));
const childPills = gmpInfo.filter((p) => childIds.has(p.node));
check(childPills.length > 0, `[7] child gmp pill rendered (${childPills.length})`);
check(
  childPills.every((p) => p.tag === "SPAN"),
  `[7] child gmp pills are read-only spans (${childPills.map((p) => p.tag).join(",")})`,
);
await page.screenshot({ path: `${SHOT_DIR}/03-child-gmp.png` });

// ── [1] 자식 노드 Tab 순회 ──────────────────────────────────────────────────
const firstChild = childBoxes.find((b) => b.w > 80); // 프로세스형(터미널 원형 제외 우선)
if (firstChild) {
  await page.mouse.click(firstChild.x + firstChild.w / 2, firstChild.y + Math.min(14, firstChild.h / 2));
  await sleep(300);
  const sel0 = await selectedNodeId();
  check(sel0 === firstChild.id, `[1] child click selects it (${sel0})`);
  await page.keyboard.press("Tab");
  await sleep(650);
  const sel1 = await selectedNodeId();
  check(sel1 !== null && sel1 !== sel0 && childIds.has(sel1), `[1] Tab moves to next child (${sel1})`);
  await page.keyboard.press("Tab");
  await sleep(650);
  const sel2 = await selectedNodeId();
  check(sel2 !== null && sel2 !== sel1 && childIds.has(sel2), `[1] Tab again moves on (${sel2})`);
  await page.keyboard.press("Shift+Tab");
  await sleep(650);
  const sel3 = await selectedNodeId();
  check(sel3 === sel1, `[1] Shift+Tab returns (${sel3})`);
  await page.screenshot({ path: `${SHOT_DIR}/04-child-tab.png` });
} else {
  check(false, "[1] no child process node found");
}

// ── [2] 바깥(밀린) 노드 방향키 — 점프 없음 ──────────────────────────────────
const shifted = postBoxes
  .filter((b) => preIds.has(b.id))
  .map((b) => {
    const pre = preBoxes.find((p) => p.id === b.id);
    return { ...b, dy: pre ? b.y - pre.y : 0, dx: pre ? b.x - pre.x : 0 };
  })
  .filter((b) => Math.abs(b.dy) > 30 || Math.abs(b.dx) > 30);
check(shifted.length > 0, `[2] found displaced outside nodes (${shifted.length})`);
if (shifted.length > 0) {
  // [1]의 Tab 비행으로 카메라가 이동했고 일부 노드는 인스펙터/뷰포트 밖 — 줌아웃으로 가시화 후
  // elementFromPoint로 가림 없는 후보를 골라 클릭한다(스테일 bbox·가림 클릭 금지).
  await page.mouse.move(760, 480);
  await page.keyboard.down("Control");
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 240);
    await sleep(120);
  }
  await page.keyboard.up("Control");
  await sleep(500);
  const shiftedIds = new Set(shifted.map((s) => s.id));
  let picked = null;
  for (const b of await nodeBoxes()) {
    if (!shiftedIds.has(b.id)) continue;
    const px = b.x + b.w * 0.72;
    const py = b.y + b.h * 0.5;
    const hitsSelf = await page.evaluate(
      ([x, y, id]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest(".react-flow__node")?.getAttribute("data-id") === id;
      },
      [px, py, b.id],
    );
    if (hitsSelf) {
      picked = { id: b.id, x: px, y: py };
      break;
    }
  }
  check(picked !== null, "[2] unobstructed displaced node found");
  if (picked) {
    await page.mouse.click(picked.x, picked.y);
    await sleep(300);
    check((await selectedNodeId()) === picked.id, `[2] outside node selected (${picked.id})`);
    const before = (await nodeBoxes()).find((b) => b.id === picked.id);
    await page.keyboard.press("ArrowDown");
    await sleep(700);
    const after = (await nodeBoxes()).find((b) => b.id === picked.id);
    const dy = after && before ? after.y - before.y : NaN;
    const dx = after && before ? after.x - before.x : NaN;
    check(
      Number.isFinite(dy) && dy > 0.5 && dy <= 24 && Math.abs(dx) <= 2,
      `[2] ArrowDown moves one step, no jump (dy=${dy?.toFixed(1)}, dx=${dx?.toFixed(1)})`,
    );
    await page.keyboard.press("ArrowUp"); // 원위치 복원
    await sleep(500);
  }
}

// ── [3] 틴트 호버 + 우클릭 메뉴 ─────────────────────────────────────────────
const band2 = await page.locator('[data-id^="region-band-"]').first().boundingBox();
let emptyPoint = null;
if (band2) {
  const candidates = [
    [band2.x + 30, band2.y + band2.height - 30],
    [band2.x + band2.width - 30, band2.y + band2.height - 30],
    [band2.x + band2.width / 2, band2.y + band2.height - 20],
    [band2.x + band2.width - 25, band2.y + band2.height / 2],
  ];
  for (const [x, y] of candidates) {
    const onPane = await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el !== null && el.closest(".react-flow__node") === null;
      },
      [x, y],
    );
    if (onPane) {
      emptyPoint = { x, y };
      break;
    }
  }
}
check(emptyPoint !== null, "[3] empty point inside region found");
if (emptyPoint) {
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await sleep(250);
  const bandStyle = await page.locator('[data-id^="region-band-"]').first().getAttribute("style");
  check(bandStyle?.includes("9%") === true, "[3] hover strengthens tint (9%)");
  await page.screenshot({ path: `${SHOT_DIR}/05-region-hover.png` });
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: "right" });
  await sleep(400);
  const openItem = page.getByRole("button", { name: /Open linked map|링크된 맵 열기/ }).first();
  const collapseItem = page
    .getByRole("button", { name: /Collapse subprocess|하위 프로세스 접기/ })
    .first();
  check(await openItem.isVisible(), "[3] menu: Open linked map");
  check(await collapseItem.isVisible(), "[3] menu: Collapse subprocess");
  await page.screenshot({ path: `${SHOT_DIR}/06-region-menu.png` });
  await openItem.click();
  await sleep(400);
  const cancelBtn = page.locator('[data-id="confirm-dialog-cancel"]');
  check(await cancelBtn.isVisible(), "[3] open-map confirm gate appears");
  await page.screenshot({ path: `${SHOT_DIR}/07-open-map-gate.png` });
  await cancelBtn.click();
  await sleep(300);
  const bandsBefore = await page.locator('[data-id^="region-band-"]').count();
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: "right" });
  await sleep(400);
  await page
    .getByRole("button", { name: /Collapse subprocess|하위 프로세스 접기/ })
    .first()
    .click();
  await sleep(1000);
  const bandsAfter = await page.locator('[data-id^="region-band-"]').count();
  check(bandsAfter < bandsBefore, `[3] collapse closes region (${bandsBefore}→${bandsAfter})`);
}

// ── [6] 줌인 + 아웃라인 연속 이동 — 앵커 줌 복귀 ────────────────────────────
const outlineRows = page.locator("[data-editor-outline] li button:not([aria-label])");
const rowCount = await outlineRows.count();
check(rowCount >= 3, `[6] outline rows available (${rowCount})`);
if (rowCount >= 3) {
  await page.mouse.move(840, 500);
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, -240);
    await sleep(120);
  }
  await page.keyboard.up("Control");
  await sleep(500);
  const z1 = await viewportScale();
  check(z1 > 1.1, `[6] zoomed in (scale=${z1.toFixed(2)})`);
  const rowA = outlineRows.nth(1);
  const rowB = outlineRows.nth(rowCount - 2);
  for (let i = 0; i < 6; i += 1) {
    await (i % 2 === 0 ? rowA : rowB).click();
    await sleep(130); // 비행(500ms) 도중 연속 이동
  }
  await sleep(1500); // 마지막 비행 완료 대기
  const z2 = await viewportScale();
  check(
    Math.abs(z2 - z1) <= z1 * 0.06,
    `[6] zoom returns to anchor after rapid moves (z1=${z1.toFixed(2)} z2=${z2.toFixed(2)})`,
  );
  await page.screenshot({ path: `${SHOT_DIR}/08-zoom-anchor.png` });
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 5)) console.log("  ", e.slice(0, 160));
console.log(failures.length === 0 ? "\nALL PASS" : `\nFAILURES: ${failures.length}`);
for (const f of failures) console.log("  -", f);
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
