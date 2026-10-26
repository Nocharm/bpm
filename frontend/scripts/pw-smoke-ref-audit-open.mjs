// 고아 참조 오픈 감사 스모크 — Editor 사용자와 admin.sys 각각: 상단 이름 점 → 메뉴 설정 줄 점 → 설정 > 점검 탭 점 →
// 섹션 최대 3줄·쪽 넘김 → 섹션 검색으로 시드 카드 찾기 → 경우 아이콘 호버 설명창 → 카드 넘침 검사(긴 이름·여러 폭) →
// 부서 카드 대체(노드 호버 제목·대상 선택·미리보기 칩·적용·토스트) → 사용자 카드 대체/제거 → 카드·점 갱신. 콘솔 에러 0.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-ref-audit-open.mjs
//   bash       KEEP=1 BASE_URL=... node scripts/pw-smoke-ref-audit-open.mjs   (KEEP=1이면 시드 맵을 지우지 않는다)
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-ref-audit-open.mjs
// 전제: backend를 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys 로, frontend를 BACKEND_URL=<backend> 로 기동.
//       시드는 이 스크립트가 API로 직접 만든다(맵 이름 접두 "RA smoke" - 시작·끝에 지운다). reset_db 금지.
//       산출물은 저장소 루트 .shots/ref-audit-open-*.png (gitignore).
// 주의: 로컬 개발 시드가 필요하다(woojin.choi, 부서 Logistics Team·Support Team, 사람 Yerin Jang, 시드 맵의 오우닝 부서 Management Center/IT Office/System Team).
//       API_URL 뒤 DB에 `RA smoke` 맵을 만들고 영구 삭제하므로 운영·공용 DB가 아닌 스크래치 DB 사본에서 돌린다.
//       적용 뒤 actionable이 정확히 6 줄어드는지 보므로 다른 변경이 동시에 일어나지 않는 DB여야 한다.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";

const ADMIN = "admin.sys";
const EDITOR = "woojin.choi"; // Growth Center 소속 - 시드 맵의 오우닝 부서(IT Office)와 달라 파생 editor가 아니다
const OWNING_DEPT = "Management Center/IT Office/System Team";
const MAP_PREFIX = "RA smoke";
// 긴 한글 이름 - 카드가 두 줄로 줄바꿈되는 최악의 경우(부서 이름 23자, 사람 이름 공백 포함 긴 직함)
const LONG_DEPT = "품질보증본부 제조품질관리팀 밸리데이션파트";
const LONG_PERSON = "남궁민수 품질보증 밸리데이션 책임연구원";
const MAP_COUNT = 3;
const WIDTHS = [1480, 1380, 1280, 1180, 1140, 1000, 900, 800, 700];

mkdirSync(OUT, { recursive: true });
const tag = Date.now().toString(36);
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(user, method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function purgeFixtureMaps() {
  const maps = await api(ADMIN, "GET", "/maps");
  for (const found of maps.filter((m) => m.name.startsWith(MAP_PREFIX))) {
    await api(ADMIN, "DELETE", `/maps/${found.id}`);
    await api(ADMIN, "DELETE", `/maps/${found.id}/permanent`);
  }
  const trash = await api(ADMIN, "GET", "/maps/deleted/list");
  for (const found of trash.filter((m) => m.name.startsWith(MAP_PREFIX))) {
    await api(ADMIN, "DELETE", `/maps/${found.id}/permanent`);
  }
}

// 사라진 부서·사람이 노드에 남은 맵 MAP_COUNT개 - 작업본(점유 없음)이라 평소 권한이면 "점유하고 반영"이다
async function seedFixtures(label, withEditorGrant) {
  for (let i = 1; i <= MAP_COUNT; i += 1) {
    const created = await api(ADMIN, "POST", "/maps", {
      name: `${MAP_PREFIX} ${label} ${tag} ${i}`,
      owning_department: OWNING_DEPT,
      visibility: "private",
    });
    const id = (key) => `ra-${tag}-${label}-${i}-${key}`;
    const versionId = created.versions[0].id;
    await api(ADMIN, "POST", `/versions/${versionId}/checkout`, {});
    await api(ADMIN, "PUT", `/versions/${versionId}/graph`, {
      nodes: [
        { id: id("s"), title: "Start", node_type: "start", pos_x: 0, pos_y: 0 },
        { id: id("p"), title: "Check", node_type: "process", department: LONG_DEPT, assignee: LONG_PERSON, pos_x: 200, pos_y: 0 },
        { id: id("e"), title: "End", node_type: "end", is_primary_end: true, pos_x: 400, pos_y: 0 },
      ],
      edges: [
        { id: id("e1"), source_node_id: id("s"), target_node_id: id("p"), label: "" },
        { id: id("e2"), source_node_id: id("p"), target_node_id: id("e"), label: "" },
      ],
    });
    await api(ADMIN, "DELETE", `/versions/${versionId}/checkout`); // 점유 없는 작업본이어야 판정이 "점유하고 반영"이다
    if (withEditorGrant) {
      await api(ADMIN, "POST", `/maps/${created.id}/permissions`, { principal_type: "user", principal_id: EDITOR, role: "editor" });
    }
  }
}

const deptCard = (page) => page.locator(`[data-id="ref-card-dept-${LONG_DEPT}"]`);
const userCard = (page) => page.locator(`[data-id="ref-card-user-${LONG_PERSON}"]`);

// 카드 안 내용이 잘리는지 - overflow-hidden 카드는 scrollHeight가 clientHeight보다 크면 잘린 것이다
async function findClippedCards(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-id^="ref-card-dept-"], [data-id^="ref-card-user-"]')];
    return cards
      .filter((card) => card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1)
      .map((card) => `${card.getAttribute("data-id")} ${card.clientWidth}x${card.clientHeight} (scroll ${card.scrollWidth}x${card.scrollHeight})`);
  });
}

// 섹션 그리드의 카드 행 수 - 한 쪽은 최대 3줄이다
async function countCardRows(page, sectionId) {
  return page.evaluate((id) => {
    const cards = document.querySelectorAll(`[data-id="${id}"] button[data-id^="ref-card-"]`);
    return new Set([...cards].map((card) => Math.round(card.getBoundingClientRect().top))).size;
  }, sectionId);
}

async function getFirstCardId(page, sectionId) {
  return page.locator(`[data-id="${sectionId}"] button[data-id^="ref-card-"]`).first().getAttribute("data-id");
}

// 같은 행 카드의 높이가 같은지 - 그리드 행이 늘어나도 한 줄은 가지런해야 한다
async function findUnevenRows(page) {
  return page.evaluate(() => {
    const uneven = [];
    for (const prefix of ["ref-card-dept-", "ref-card-user-"]) {
      const rows = new Map();
      for (const card of document.querySelectorAll(`[data-id^="${prefix}"]`)) {
        const rect = card.getBoundingClientRect();
        const key = Math.round(rect.top);
        rows.set(key, [...(rows.get(key) ?? []), Math.round(rect.height)]);
      }
      for (const [top, heights] of rows) if (new Set(heights).size > 1) uneven.push(`${prefix} row@${top}: ${heights.join(",")}`);
    }
    return uneven;
  });
}

async function runPhase({ phase, user, deptTarget, personMode, personTarget, isPreviewFailureChecked }) {
  console.log(`\n== ${phase} (${user}) ==`);
  const consoleErrors = [];
  let isFailureInjected = false; // 일부러 낸 미리보기 500이 남기는 콘솔 오류는 세지 않는다
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
    await ctx.addInitScript((devUser) => {
      window.localStorage.setItem("bpm.devUser", devUser);
      window.localStorage.setItem("bpm.lang", "en");
    }, user);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isFailureInjected) consoleErrors.push(`console.error: ${msg.text()}`);
    });
    const shot = (name) => page.screenshot({ path: `${OUT}/ref-audit-open-${phase}-${name}.png`, fullPage: false });

    const before = (await api(user, "GET", "/ref-audit/summary")).actionable;
    check(`[${phase}] summary has fixable places`, before >= MAP_COUNT * 2, `actionable=${before}`);

    // 1) 상단 이름 버튼 점 -> 메뉴를 열면 설정 줄 점
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-id="nav-ref-dot"]').waitFor({ state: "visible", timeout: 20000 });
    check(`[${phase}] red dot on the name button`, true);
    await page.locator('[data-id="nav-user"]').click();
    await page.locator('[data-id="nav-settings-ref-dot"]').waitFor({ state: "visible", timeout: 5000 });
    check(`[${phase}] name dot moves to the Settings row when the menu opens`, (await page.locator('[data-id="nav-ref-dot"]').count()) === 0);
    await shot("1-menu-dot");

    // 2) 설정 > 점검 > 고아 참조 탭 점
    await page.locator('[data-id="nav-settings"]').click();
    await page.locator('[data-id="settings-tab-refs-dot"]').waitFor({ state: "visible", timeout: 15000 });
    check(`[${phase}] red dot beside the Orphaned refs tab`, true);
    check(`[${phase}] Checks category listed`, (await page.getByText("Checks", { exact: true }).count()) > 0);
    await page.locator('[data-id="settings-tab-refs"]').click();
    await page.locator('[data-id="ref-audit-page"]').waitFor({ timeout: 15000 });
    await page.locator('[data-id="ref-audit-depts-search"]').waitFor({ timeout: 20000 });
    for (const section of ["ref-audit-depts", "ref-audit-users"]) {
      const rows = await countCardRows(page, section);
      check(`[${phase}] ${section} shows at most 3 card rows`, rows >= 1 && rows <= 3, `rows=${rows}`);
      const next = page.locator(`[data-id="${section}-pager-next"]`);
      if (await next.count()) {
        const first = await getFirstCardId(page, section);
        await next.click();
        check(`[${phase}] ${section} next page shows other cards`, (await getFirstCardId(page, section)) !== first);
        await page.locator(`[data-id="${section}-pager-prev"]`).click();
      }
    }
    await shot("2-page");
    // 시드 카드는 뒤 쪽에 있을 수 있다 - 섹션 검색으로 첫 쪽에 올린다
    await page.locator('[data-id="ref-audit-depts-search"]').fill(LONG_DEPT);
    await page.locator('[data-id="ref-audit-users-search"]').fill(LONG_PERSON);
    await deptCard(page).waitFor({ timeout: 20000 });
    await userCard(page).waitFor({ timeout: 20000 });
    check(`[${phase}] section search finds the long-name department and person cards`, true);

    // 3) 경우 아이콘 호버 -> 설명창
    const caseButton = page.locator('[data-id="ref-case-node_dept"]');
    await caseButton.scrollIntoViewIfNeeded();
    await caseButton.hover();
    const tip = caseButton.locator("xpath=..").locator('[role="tooltip"]');
    await page.waitForFunction((el) => el && getComputedStyle(el).opacity === "1", await tip.elementHandle(), { timeout: 3000 });
    check(`[${phase}] case icon hover shows the explanation`, (await tip.innerText()).trim().length > 0);
    await shot("3-case-hover");
    await page.mouse.move(5, 5);

    // 4) 카드 넘침 - 긴 이름이 여러 폭에서 잘리지 않고 한 줄 카드 높이가 같다
    const clipped = [];
    const uneven = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 950 });
      await page.waitForTimeout(250);
      clipped.push(...(await findClippedCards(page)).map((c) => `@${width} ${c}`));
      uneven.push(...(await findUnevenRows(page)).map((c) => `@${width} ${c}`));
    }
    check(`[${phase}] no card clips its content at ${WIDTHS.join("/")}px`, clipped.length === 0, clipped.slice(0, 3).join(" | "));
    check(`[${phase}] cards in one grid row share a height`, uneven.length === 0, uneven.slice(0, 3).join(" | "));
    await page.setViewportSize({ width: 1140, height: 950 });
    await page.waitForTimeout(250);
    await shot("4-narrow-cards");
    await page.setViewportSize({ width: 1480, height: 950 });

    // 5) 부서 카드 -> 대상 선택 -> 미리보기 칩 -> 적용 -> 토스트
    await deptCard(page).click();
    const dialog = page.locator('[data-id="ref-detail-dialog"]');
    await dialog.waitFor({ timeout: 5000 });
    const applyButton = page.locator('[data-id="ref-detail-apply"]');
    check(`[${phase}] apply is disabled until a target is picked`, await applyButton.isDisabled());
    check(`[${phase}] department card has no remove mode`, await page.locator('[data-id="ref-detail-mode-remove"]').isDisabled());
    await shot("5a-dept-dialog");
    // 노드 줄 "Nodes N"에 마우스를 올리면 노드 제목 목록
    await dialog.locator('[data-id^="ref-line-nodes-"]').first().hover();
    const nodesTip = page.locator('[data-id="ref-line-nodes-tip"]');
    await nodesTip.waitFor({ timeout: 3000 });
    const nodesTipText = (await nodesTip.innerText()).replace(/\s+/g, " ");
    check(`[${phase}] node count hover lists the node titles`, nodesTipText.includes("Check"), nodesTipText);
    await shot("5a1-node-hover");
    await page.mouse.move(5, 5);
    // 미리보기 요청이 실패하는 동안엔 오류를 보이고 적용을 막는다 - 다시 시도하면 풀린다
    let isPreviewBroken = isPreviewFailureChecked;
    isFailureInjected = isPreviewFailureChecked;
    if (isPreviewFailureChecked) {
      await page.route("**/api/ref-audit/preview", (route) =>
        isPreviewBroken
          ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "preview down" }) })
          : route.continue(),
      );
    }
    await page.locator('[data-id="ref-detail-picker"]').click();
    await page.locator('[data-id="dept-tree-picker"] input').fill(deptTarget);
    await page.locator('[data-id="dept-tree-picker-list"] [data-id="dept-tree-picker-row"]').filter({ hasText: deptTarget }).first().click();
    if (isPreviewFailureChecked) {
      await page.locator('[data-id="ref-detail-error"]').waitFor({ timeout: 10000 });
      check(`[${phase}] failed preview keeps apply disabled and offers a retry`, await applyButton.isDisabled() && (await page.locator('[data-id="ref-detail-retry"]').count()) === 1);
      await shot("5a2-preview-failed");
      isPreviewBroken = false;
      await page.locator('[data-id="ref-detail-retry"]').click();
    }
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 10000 });
    isFailureInjected = false;
    check(`[${phase}] apply opens once the preview is current`, true);
    const forecast = await page.locator('[data-id="ref-detail-forecast"]').innerText();
    check(`[${phase}] preview chips show the outcome`, /Check out and apply/.test(forecast), forecast.replace(/\s+/g, " "));
    check(`[${phase}] apply label counts the places`, (await applyButton.innerText()).includes(`Replace ${MAP_COUNT}`));
    await shot("5b-dept-preview");
    await applyButton.click();
    await page.locator('[data-id="ref-detail-confirm"]').waitFor({ timeout: 5000 });
    await page.locator('[data-id="confirm-dialog-confirm"]').click();
    await dialog.waitFor({ state: "detached", timeout: 15000 });
    const deptToast = page.getByText(new RegExp(`^Applied ${MAP_COUNT}\\b`));
    await deptToast.first().waitFor({ timeout: 5000 });
    check(`[${phase}] toast reports the applied places`, true, await deptToast.first().innerText());
    await shot("5c-dept-applied");
    await deptCard(page).waitFor({ state: "detached", timeout: 15000 });
    check(`[${phase}] department card is gone after the rescan`, true);

    // 6) 사용자 카드 -> 대체 또는 제거 -> 토스트
    await userCard(page).click();
    await dialog.waitFor({ timeout: 5000 });
    if (personMode === "remove") {
      await page.locator('[data-id="ref-detail-mode-remove"]').click();
    } else {
      await page.locator('[data-id="ref-detail-picker"] input').fill(personTarget);
      await page.locator('[data-id="principal-picker-dropdown"]').getByText(personTarget).first().click();
    }
    await page.locator('[data-id="ref-detail-apply"]:not([disabled])').waitFor({ timeout: 10000 });
    const personForecast = await page.locator('[data-id="ref-detail-forecast"]').innerText();
    check(`[${phase}] person ${personMode} preview chips show an outcome`, /(Applies now|Check out and apply)/.test(personForecast), personForecast.replace(/\s+/g, " "));
    await shot(`6a-person-${personMode}`);
    await page.locator('[data-id="ref-detail-apply"]').click();
    await page.locator('[data-id="ref-detail-confirm"]').waitFor({ timeout: 5000 });
    await page.locator('[data-id="confirm-dialog-confirm"]').click();
    await dialog.waitFor({ state: "detached", timeout: 15000 });
    await page.getByText(new RegExp(`^Applied ${MAP_COUNT}\\b`)).first().waitFor({ timeout: 5000 });
    check(`[${phase}] person ${personMode} toast`, true);
    await userCard(page).waitFor({ state: "detached", timeout: 15000 });
    check(`[${phase}] person card is gone after the rescan`, true);
    await shot("6b-after");

    // 7) 점·요약 갱신
    const after = (await api(user, "GET", "/ref-audit/summary")).actionable;
    check(`[${phase}] summary dropped by the applied places`, before - after === MAP_COUNT * 2, `before=${before} after=${after}`);
    if (after === 0) {
      await page.locator('[data-id="settings-tab-refs-dot"]').waitFor({ state: "detached", timeout: 10000 });
      check(`[${phase}] tab dot cleared when nothing fixable is left`, true);
    } else {
      check(`[${phase}] tab dot stays while other fixable places remain`, (await page.locator('[data-id="settings-tab-refs-dot"]').count()) === 1, `actionable=${after}`);
    }

    const nodeDepts = await api(user, "GET", "/ref-audit");
    check(
      `[${phase}] fixture lines no longer in the audit`,
      ![...nodeDepts.departments, ...nodeDepts.users].some((c) => c.label === LONG_DEPT || c.label === LONG_PERSON),
    );
    check(`[${phase}] no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  await purgeFixtureMaps();

  await seedFixtures("editor", true);
  await runPhase({
    phase: "editor", user: EDITOR, isPreviewFailureChecked: true,
    deptTarget: "Logistics Team", personMode: "replace", personTarget: "Yerin Jang",
  });

  await seedFixtures("admin", false);
  await runPhase({
    phase: "admin", user: ADMIN,
    deptTarget: "Support Team", personMode: "remove",
  });
} catch (error) {
  failures += 1;
  console.log(`FAIL smoke aborted - ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (!KEEP) await purgeFixtureMaps();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
