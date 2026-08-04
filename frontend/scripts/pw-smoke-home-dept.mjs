// 홈 부서 목록 스모크 — 카드 폭 depth 무관 통일 · 그룹 박스/카운트 태그/펼침 톤다운 · 첫 진입 조직도 접힘 ·
// 접힘 상태 새로고침 유지 · 최근접속 호버 반전.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=<dir> node scripts/pw-smoke-home-dept.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, 시드 완료. 언어 en 고정.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API_BASE = process.env.API_BASE ?? "http://localhost:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const ADMIN = "admin.sys";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 내 부서(또는 하위)에 "본인이 볼 수 있는" 맵을 가진 사용자를 런타임에 고른다.
// DEV_ENFORCE_PERMISSIONS=true라 sysadmin(admin.sys)이 보는 /api/maps 목록으로 후보를 고르면
// 실제로는 그 유저 본인에게 안 보이는 맵일 수 있어 My dept 섹션이 비게 된다 — 후보마다 본인 헤더로 재조회한다.
async function findUserWithDeptMaps() {
  const dir = await fetch(`${API_BASE}/api/directory`, { headers: { "X-Dev-User": ADMIN } }).then((r) => r.json());
  const candidates = dir.users.filter((u) => u.org_path);
  for (const u of candidates.slice(0, 40)) {
    const mine = await fetch(`${API_BASE}/api/maps`, { headers: { "X-Dev-User": u.id } }).then((r) => r.json());
    const hit = mine.some(
      (m) => m.owning_department === u.org_path || (m.owning_department ?? "").startsWith(`${u.org_path}/`),
    );
    if (hit) return u.id;
  }
  return null;
}

// 컨텍스트 생성 — devUser/언어 고정. bpm.home.tree는 지우지 않는다 —
// addInitScript는 매 네비게이션(reload 포함)마다 재실행되므로, 여기서 removeItem을 두면
// 새로고침 유지 검증에서 우리가 방금 쓴 저장값을 스크립트 자신이 지워버린다.
// newContext()는 항상 빈 storage로 시작하므로 애초에 지울 것도 없다.
async function openContext(browser, devUser, recentIds = []) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ([user, ids]) => {
      window.localStorage.setItem("bpm.devUser", user);
      window.localStorage.setItem("bpm.lang", "en");
      if (ids.length > 0) {
        window.localStorage.setItem(
          "bpm.recentMaps",
          JSON.stringify(ids.map((id) => ({ id, at: 1754000000000 }))),
        );
      }
    },
    [devUser, recentIds],
  );
  return ctx;
}

// 닫힌 부서 행을 전부 펼친다 — 펼칠 때마다 하위 행이 새로 나타나므로 남은 게 없을 때까지 반복.
// 한 번에 하나씩(first) 여는 이유: 클릭마다 트리가 재렌더돼 미리 잡아둔 핸들이 무효해진다.
async function expandAll(page) {
  for (let round = 0; round < 60; round += 1) {
    const closed = page.locator('[data-id="org-node-toggle"][aria-expanded="false"]');
    if ((await closed.count()) === 0) return;
    await closed.first().click();
    await page.waitForTimeout(60);
  }
  throw new Error("expandAll: 60회 내에 전부 펼치지 못했다 — 트리가 예상보다 크거나 토글이 안 먹는다");
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];

try {
  const deptUser = await findUserWithDeptMaps();
  check("found a user with dept maps", deptUser !== null, `user=${deptUser}`);
  if (!deptUser) throw new Error("시드에 부서 맵을 가진 사용자가 없다 — 시드를 확인하라");

  // ── 1) 첫 진입 포커스 — 내 부서 맵이 있으면 조직도는 접힌 채 ──────────────────
  const ctxA = await openContext(browser, deptUser);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageA.goto(BASE, { waitUntil: "networkidle" });
  await pageA.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });

  const myDeptShown = await pageA.locator('[data-id="home-my-dept"]').count();
  check("my-dept section rendered", myDeptShown === 1, `count=${myDeptShown}`);

  const openedOnEntry = await pageA.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check("org tree starts collapsed", openedOnEntry === 0, `open=${openedOnEntry}`);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-1-entry.png`, fullPage: false });

  // 톤다운·카운트 태그 비교 기준 — 아직 전부 닫힌 지금 캡처해둔다. expandAll은 리프 부서까지
  // 전부 펼쳐버려 그 뒤엔 aria-expanded="false"인 행이 하나도 안 남는다(닫힌 색·닫힌 태그를 못 구함).
  // my-dept-toggle도 함께 본다(Fix 6 신설) — org-node-toggle만 보면 그 data-id·aria-expanded가
  // 톤다운·태그 검사를 통과 못 해도 안 걸린다.
  const toggleRowSelector = (expanded) =>
    `[data-id="org-node-toggle"][aria-expanded="${expanded}"], [data-id="my-dept-toggle"][aria-expanded="${expanded}"]`;
  const toggleNameSelector = (expanded) =>
    `[data-id="org-node-toggle"][aria-expanded="${expanded}"] [data-id="org-node-name"], ` +
    `[data-id="my-dept-toggle"][aria-expanded="${expanded}"] [data-id="org-node-name"]`;

  const closedNameColor = await pageA.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).color : null;
  }, toggleNameSelector("false"));

  // 태그 검사의 "닫힌 행은 태그를 단다" 절반 — expandAll 뒤엔 닫힌 행이 하나도 안 남아 그 절반이
  // 공집합만 걸러 항상 통과하던 버그(리뷰 M5)를 막기 위해 펼치기 전 지금 미리 캡처한다.
  const closedTagState = await pageA.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    const withoutTag = rows.filter((r) => r.querySelector('[data-id="org-node-count"]') === null);
    return { rowCount: rows.length, withoutTagCount: withoutTag.length };
  }, toggleRowSelector("false"));

  // ── 2) 카드 폭 — depth 무관 동일 ──────────────────────────────────────────
  await expandAll(pageA);
  const widths = await pageA
    .locator('[data-id="home-org-accordion"] [data-id="map-card"]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  const uniq = [...new Set(widths)];
  check(
    "map cards share one width across depths",
    widths.length >= 2 && uniq.length === 1,
    `cards=${widths.length} widths=${uniq.join(",")}`,
  );

  // 내 부서 섹션도 같은 박스라 카드 폭이 조직도와 같아야 한다 — 한쪽만 박스를 빼면 여기서 갈린다
  const myDeptWidths = await pageA
    .locator('[data-id="home-my-dept"] [data-id="map-card"]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  check(
    "my-dept cards match accordion card width",
    myDeptWidths.length > 0 && uniq.length === 1 && myDeptWidths.every((w) => w === uniq[0]),
    `myDept=${[...new Set(myDeptWidths)].join(",")} accordion=${uniq.join(",")}`,
  );

  // 펼친 깊이가 실제로 2단계 이상이어야 위 단언이 의미 있다
  const depths = await pageA
    .locator('[data-id="org-node-toggle"][aria-expanded="true"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-path") ?? "").split("/").length));
  check("expanded tree spans multiple depths", new Set(depths).size >= 2, `depths=${[...new Set(depths)].join(",")}`);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-2-expanded.png`, fullPage: false });

  // ── 3) 그룹 박스 · 카운트 태그 · 펼침 톤다운 ────────────────────────────────
  const boxCount = await pageA.locator('[data-id="org-group-box"]').count();
  check("map-owning depts render a group box", boxCount >= 1, `boxes=${boxCount}`);

  // 박스는 그 부서가 "직접" 가진 맵만 감싼다 — 자식 부서 행이 박스 안에 들어가면 박스가 중첩되고
  // depth마다 카드 폭이 줄어든다(설계 R4의 핵심 불변식).
  const nested = await pageA.evaluate(() => {
    const boxes = [...document.querySelectorAll('[data-id="org-group-box"]')];
    // 박스 안의 토글 행은 그 박스 자신의 헤더 1개뿐이어야 한다
    const bad = boxes.filter((b) => b.querySelectorAll('[data-id="org-node-toggle"]').length > 1);
    const nestedBoxes = boxes.filter((b) => b.querySelector('[data-id="org-group-box"]') !== null);
    return { ok: bad.length === 0 && nestedBoxes.length === 0, reason: `multiToggle=${bad.length} nested=${nestedBoxes.length}` };
  });
  check("child depts render outside their parent's box", nested.ok, nested.reason);

  // 펼친 행은 태그를 숨긴다 — "닫힌 행은 태그를 단다" 절반은 expandAll 전에 미리 캡처해둔
  // closedTagState를 쓴다(펼친 뒤엔 닫힌 행이 하나도 안 남아 그 절반이 공집합만 보게 된다).
  const openWithTagCount = await pageA.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    return rows.filter((r) => r.querySelector('[data-id="org-node-count"]') !== null).length;
  }, toggleRowSelector("true"));
  const tags = {
    ok: closedTagState.rowCount > 0 && closedTagState.withoutTagCount === 0 && openWithTagCount === 0,
    reason:
      `closedRows=${closedTagState.rowCount} closedWithoutTag=${closedTagState.withoutTagCount} ` +
      `openWithTag=${openWithTagCount}`,
  };
  check("expanded rows hide the count tag, collapsed rows show it", tags.ok, tags.reason);

  // 펼친 행 이름은 톤다운 — 매칭되는 모든 펼친 행(org-node-toggle + my-dept-toggle)의 computed color가
  // 위에서 미리 캡처해둔 닫힌 색과 전부 달라야 한다. 하나만 보면 my-dept-toggle이 회귀해도 다른 행이
  // 먼저 걸려 통과할 수 있다.
  const openNameColors = await pageA.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    return rows.map((el) => getComputedStyle(el).color);
  }, toggleNameSelector("true"));
  const tone = {
    ok:
      openNameColors.length > 0 &&
      closedNameColor !== null &&
      openNameColors.every((c) => c !== closedNameColor),
    reason: `open=${openNameColors.join("|")} closed=${closedNameColor}`,
  };
  check("expanded row name is toned down", tone.ok, tone.reason);
  await pageA.screenshot({ path: `${SHOT_DIR}/home-dept-3-boxes.png`, fullPage: false });

  // ── 3b) 좁은 폭에서 행이 무음으로 잘리지 않는다 ─────────────────────────────
  // 스크롤 컨테이너가 overflow-x-hidden이라 넘치면 스크롤바 없이 잘린다. 980~1280px는
  // 우측 상세 패널이 아직 보여 컬럼이 1/3로 좁아지는 실사용 구간이다(직전 브랜치 회귀 전례).
  for (const width of [1000, 1280]) {
    await pageA.setViewportSize({ width, height: 900 });
    await pageA.waitForTimeout(150);
    const clipped = await pageA.evaluate(() =>
      [...document.querySelectorAll('[data-id="org-node-toggle"]')].filter((r) => r.scrollWidth > r.clientWidth + 1).length,
    );
    check(`no dept row clipping at ${width}px`, clipped === 0, `clipped=${clipped}`);
  }
  await pageA.setViewportSize({ width: 1440, height: 900 });
  await pageA.waitForTimeout(150);

  // ── 4) 접힘 상태가 새로고침에도 유지 ────────────────────────────────────────
  const firstPath = await pageA
    .locator('[data-id="org-node-toggle"][aria-expanded="true"]')
    .first()
    .getAttribute("data-path");
  await pageA.locator(`[data-id="org-node-toggle"][data-path="${firstPath}"]`).click(); // 접는다
  await pageA.waitForTimeout(80);
  const storedRaw = await pageA.evaluate(() => window.localStorage.getItem("bpm.home.tree"));
  check("collapse state written to localStorage", storedRaw !== null, `raw=${String(storedRaw).slice(0, 60)}`);

  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const stillClosed = await pageA
    .locator(`[data-id="org-node-toggle"][data-path="${firstPath}"]`)
    .getAttribute("aria-expanded");
  const stillOpenElsewhere = await pageA.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check(
    "collapse state survives reload",
    stillClosed === "false" && stillOpenElsewhere > 0,
    `target=${stillClosed} othersOpen=${stillOpenElsewhere}`,
  );
  await ctxA.close();

  // ── 5) 내 부서 맵이 없는 사용자는 기존대로 조직도가 시드된다 ─────────────────
  const ctxB = await openContext(browser, ADMIN);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageB.goto(BASE, { waitUntil: "networkidle" });
  await pageB.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  const adminMyDept = await pageB.locator('[data-id="home-my-dept"]').count();
  const adminOpen = await pageB.locator('[data-id="org-node-toggle"][aria-expanded="true"]').count();
  check(
    "no my-dept section -> org tree still seeded open",
    adminMyDept === 0 ? adminOpen > 0 : true,
    `myDept=${adminMyDept} open=${adminOpen}`,
  );
  await ctxB.close();

  // ── 6) 최근접속 호버 반전 ──────────────────────────────────────────────────
  const anyMapId = await fetch(`${API_BASE}/api/maps`, { headers: { "X-Dev-User": deptUser } })
    .then((r) => r.json())
    .then((ms) => ms[0]?.id ?? null);
  check("picked a map for the recent cache", anyMapId !== null, `id=${anyMapId}`);

  const ctxC = await openContext(browser, deptUser, [anyMapId]);
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await pageC.goto(BASE, { waitUntil: "networkidle" });
  await pageC.waitForSelector('[data-id="home-org-accordion"]', { timeout: 8000 });
  await expandAll(pageC);

  await pageC.locator('[data-id="map-card-recent-badge"]').first().waitFor({ state: "visible", timeout: 8000 });
  // 최근 배지를 품은 카드 — 카드마다 updated-chip이 있으므로 반드시 배지 소유 카드로 좁힌다.
  const card = pageC.locator('[data-id="map-card"]:has([data-id="map-card-recent-badge"])').first();

  // 측정은 전부 배지 root 안에서 — 전역 querySelector면 다른 카드의 chip을 집는다.
  const readLayers = async () =>
    pageC.evaluate(() => {
      const root = document.querySelector('[data-id="map-card-recent-badge"]');
      if (!root) return null;
      const pill = root.querySelector('[data-id="map-card-recent-pill"]');
      const chip = root.querySelector('[data-id="map-card-updated-chip"]');
      const icon = root.querySelector('[data-id="map-card-recent-icon"]');
      const owner = chip?.parentElement ?? null;
      return {
        pill: pill ? Number(getComputedStyle(pill).opacity) : -1,
        owner: owner ? Number(getComputedStyle(owner).opacity) : -1,
        // 최근 열람 표시는 시계 "아이콘 색"뿐 — 칩 배경은 없어야 한다(다른 카드와 같은 한 줄로 읽혀야 하므로)
        chipBg: chip ? getComputedStyle(chip).backgroundColor : "",
        iconColor: icon ? getComputedStyle(icon).color : "",
      };
    });

  const before = await readLayers();
  check(
    "default shows owner/updated, recent pill hidden",
    before !== null && before.owner > 0.9 && before.pill < 0.1,
    `owner=${before?.owner} pill=${before?.pill}`,
  );
  // accent(#6A41FF) = rgb(106, 65, 255) — 아이콘만 액센트, 칩 배경은 투명이어야 한다
  check(
    "recent marker is the clock icon colour only, no chip background",
    before !== null && before.iconColor === "rgb(106, 65, 255)" && before.chipBg === "rgba(0, 0, 0, 0)",
    `iconColor=${before?.iconColor} chipBg=${before?.chipBg}`,
  );

  // 들어올 때는 1초 지연 후 페이드 — 스쳐 지나는 커서에 반응하지 않게 한다.
  await card.hover();
  await pageC.waitForTimeout(400); // 지연 구간 한가운데: 아직 바뀌면 안 된다
  const midHover = await readLayers();
  check(
    "hover does not swap during the 1s delay",
    midHover !== null && midHover.owner > 0.9 && midHover.pill < 0.1,
    `owner=${midHover?.owner} pill=${midHover?.pill}`,
  );

  await pageC.waitForTimeout(1200); // 1000ms 지연 + 350ms 페이드 완료
  const after = await readLayers();
  check(
    "hover swaps to the recent-opened pill after the delay",
    after !== null && after.pill > 0.9 && after.owner < 0.1,
    `owner=${after?.owner} pill=${after?.pill}`,
  );
  await pageC.screenshot({ path: `${SHOT_DIR}/home-dept-4-hover.png`, fullPage: false });

  // 나갈 때는 즉시 복귀 — duration/delay 0이라 100ms 안에 이미 되돌아와 있어야 한다.
  // (역방향도 지연됐다면 이 시점엔 아직 pill이 떠 있어 이 검사가 잡는다)
  await pageC.mouse.move(5, 5);
  await pageC.waitForTimeout(100);
  const afterLeave = await readLayers();
  check(
    "un-hover reverts immediately",
    afterLeave !== null && afterLeave.owner > 0.9 && afterLeave.pill < 0.1,
    `owner=${afterLeave?.owner} pill=${afterLeave?.pill}`,
  );
  await ctxC.close();

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}
