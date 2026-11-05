// 실행 체크 후속 스모크 2(2026-11-05) — 갈래 미리보기 · 뒤 단계 함께 취소 확인 창(마우스 자리·키보드 가운데) · 코멘트 고치기/지우기
// (줄에 올리면 버튼, 지우기 두 번 누르기) · 좌측 사이드바 실행 탭(이력, 줄에 올리면 노드 강조) · 인스펙터 맵/승인 탭 꺼짐 ·
// Ctrl+Z 되돌리기 · 사이드바 맵 설정 링크가 이력을 가리지 않음 · 실행 이름 워터마크 · 실행 바 ⋯ 메뉴 아이콘과 높이 가운데 ·
// 실행 메뉴 모든 실행 아이콘 버튼 · 모든 실행 창 "다른 맵" 칸 → 그 맵 실행으로 이동 · 홈 실행 타일 "최근 끝남". 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-history.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-history.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       시드는 스크립트가 API로 만든다(이름 접두 "pw-runhist-"), 끝에 지운다. 산출물은 저장소 루트 .shots/run-hist-*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const USER_A = "admin.sys";
const PREFIX = "pw-runhist-";

mkdirSync(OUT, { recursive: true });
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

async function purgeMaps() {
  for (const found of (await api(USER_A, "GET", "/maps")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}`);
  }
  for (const found of (await api(USER_A, "GET", "/maps/deleted/list")).filter((m) => m.name.startsWith(PREFIX))) {
    await api(USER_A, "DELETE", `/maps/${found.id}/permanent`);
  }
}

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `${PREFIX}${tag}-${key}`;
const directory = await api(USER_A, "GET", "/directory");
const me = directory.users.find((u) => u.id === USER_A) ?? directory.users[0];
if (!me?.org_path) throw new Error("no org_path in directory — seed the directory first");

async function createPublishedMap(name, nodes, edges) {
  const map = await api(USER_A, "POST", "/maps", { name, owning_department: me.org_path, visibility: "public" });
  const detail = await api(USER_A, "GET", `/maps/${map.id}`);
  const draft = detail.versions.find((v) => v.status === "draft") ?? detail.versions[0];
  await api(USER_A, "POST", `/versions/${draft.id}/checkout`, { force: true });
  await api(USER_A, "PUT", `/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
  await api(USER_A, "PUT", `/maps/${map.id}/approvers`, { user_ids: [USER_A] });
  await api(USER_A, "POST", `/versions/${draft.id}/submit`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/approve`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/publish`, {});
  return { mapId: map.id, versionId: draft.id };
}

const node = (key, title, x, y, extra = {}) => ({ id: nid(key), title, node_type: "process", pos_x: x, pos_y: y, ...extra });
const edge = (key, source, target, extra = {}) => ({
  id: nid(`e-${key}`),
  source_node_id: nid(source),
  target_node_id: nid(target),
  label: "",
  ...extra,
});
const act = (runId, nodeKey, action, extra = {}) =>
  api(USER_A, "POST", `/runs/${runId}/actions`, { scope_path: "", node_id: nid(nodeKey), action, ...extra });

const consoleErrors = [];
let browser = null;
let page = null;

const centerOf = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const edgeLook = (key) =>
  page.evaluate((id) => {
    const group = document.querySelector(`[data-testid="rf__edge-${id}"]`);
    const path = group?.querySelector(".react-flow__edge-path");
    return path ? { opacity: path.style.opacity, flow: group.querySelector(".bpm-run-flow") !== null } : null;
  }, nid(key));
// 이력 한 줄(묶음 안 줄) — 상태 변경·코멘트
const HISTORY_ENTRIES =
  '[data-id="run-history-list"] li[data-id^="run-history-event-"], [data-id="run-history-list"] li[data-id^="run-history-comment-"]';
const stateOf = async (runId) =>
  Object.fromEntries((await api(USER_A, "GET", `/runs/${runId}`)).states.map((row) => [row.node_id, row.status]));

try {
  await purgeMaps();
  // 바깥 맵: 시작 → 접수 → 서류 검토 → 판정?(합격 → 시료 채취 → 끝 / 불합격 → 반품 처리 → 반품 끝)
  const parent = await createPublishedMap(
    `${PREFIX}${tag} 입고 검사`,
    [
      node("s", "시작", 0, 220, { node_type: "start" }),
      node("a", "접수", 200, 220),
      node("b", "서류 검토", 420, 220),
      node("d", "판정?", 650, 200, { node_type: "decision" }),
      node("c", "시료 채취", 880, 220),
      node("e", "", 1100, 220, { node_type: "end", is_primary_end: true }),
      node("r", "반품 처리", 880, 420),
      node("re", "반품 끝", 1100, 420, { node_type: "end" }),
    ],
    [
      edge("sa", "s", "a"),
      edge("ab", "a", "b"),
      edge("bd", "b", "d"),
      edge("dc", "d", "c", { label: "합격" }),
      edge("dr", "d", "r", { label: "불합격" }),
      edge("ce", "c", "e"),
      edge("rre", "r", "re"),
    ],
  );
  // 다른 맵: 시작 → 출고 → 끝, 그 맵에서 끝난 실행 하나
  const other = await createPublishedMap(
    `${PREFIX}${tag} 출고 점검`,
    [node("os", "시작", 0, 100, { node_type: "start" }), node("o1", "출고", 220, 100), node("oe", "", 440, 100, { node_type: "end", is_primary_end: true })],
    [edge("o1", "os", "o1"), edge("o2", "o1", "oe")],
  );
  const otherRun = await api(USER_A, "POST", `/maps/${other.mapId}/runs`, {
    name: `${PREFIX}${tag} 출고 LOT 7`,
    version_id: other.versionId,
    scope: "solo",
    participants: [],
  });
  await act(otherRun.id, "o1", "complete");
  const run = await api(USER_A, "POST", `/maps/${parent.mapId}/runs`, {
    name: `${PREFIX}${tag} LOT 2611-09`,
    version_id: parent.versionId,
    scope: "solo",
    participants: [],
  });
  await act(run.id, "a", "complete");
  await act(run.id, "b", "complete");
  check("seed: decision is next", true, `run ${run.id} · other run ${otherRun.id}`);

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "ko");
  }, USER_A);
  page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}&run=${run.id}`);
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await page.locator(`.react-flow__node[data-id="${nid("a")}"]`).waitFor();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await page.waitForTimeout(600);

  // 0) 캔버스 워터마크는 "Published" 대신 실행 이름
  check(
    "watermark: shows the run name",
    ((await page.locator('[data-id="editor-run-watermark"]').textContent()) ?? "") === run.name,
  );

  // 1) 실행 바 — ⋯와 나만·공유 탭 세로 가운데, ⋯ 메뉴 줄마다 아이콘
  const scopeBox = await page.locator('[data-id="run-bar"] [role="group"]').first().boundingBox();
  const moreBox = await page.locator('[data-id="run-bar-more"]').boundingBox();
  const closeBox = await page.locator('[data-id="run-bar-close"]').boundingBox();
  const midGap = Math.max(Math.abs(centerOf(scopeBox).y - centerOf(moreBox).y), Math.abs(centerOf(scopeBox).y - centerOf(closeBox).y));
  check("run bar: scope tabs, more and close share a center line", midGap <= 1, `gap ${midGap.toFixed(2)}px`);
  await page.locator('[data-id="run-bar-more"]').click();
  const menuIcons = await page
    .locator('[data-id="run-bar-menu"] button')
    .evaluateAll((els) => els.map((el) => el.querySelector("svg") !== null));
  check("run bar menu: every item has an icon", menuIcons.length > 0 && menuIcons.every(Boolean), String(menuIcons.length));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/run-hist-bar-menu.png`, clip: { x: 900, y: 80, width: 700, height: 260 } });
  await page.keyboard.press("Escape");

  // 2) 좌측 사이드바 실행 탭이 열려 있고(이력), 인스펙터 맵·승인 탭은 꺼져 있다
  await page.locator('[data-id="sidebar-run-panel"] [data-id="run-history-list"]').waitFor({ timeout: 8000 });
  check("sidebar: run tab is open", (await page.locator('[data-id="sidebar-tab-run"]').getAttribute("aria-selected")) === "true");
  check(
    "inspector: map and approval tabs are off",
    (await page.locator('[data-id="inspector-tab-map"]').getAttribute("aria-disabled")) === "true" &&
      (await page.locator('[data-id="inspector-tab-approval"]').getAttribute("aria-disabled")) === "true",
  );
  await page.locator('[data-id="inspector-tab-map"]').click({ force: true });
  check(
    "inspector: clicking the map tab does nothing",
    (await page.locator('[data-id="inspector-tab-map"]').getAttribute("aria-pressed")) === "false",
  );
  const allItems = await page.locator(HISTORY_ENTRIES).count();
  check("history: whole run shows the two completions", allItems === 2, String(allItems));
  // 이력 묶음에 올리면 그 노드에 강조 링, 벗어나면 풀린다
  const firstRow = page.locator('[data-id^="run-history-group-"]').first();
  await firstRow.hover();
  await page.waitForTimeout(200);
  const isLit = (key) =>
    page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains("io-node-highlight") ?? false, nid(key));
  check("history hover: the step's node is highlighted", await isLit("b"));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/run-hist-sidebar-hover.png` });
  await page.mouse.move(800, 900);
  await page.waitForTimeout(200);
  check("history hover: leaving clears the highlight", !(await isLit("b")));
  await page.locator('[data-id="sidebar-tab-outline"]').click();
  check("sidebar: the outline tab still works", await page.locator("[data-editor-outline]").isVisible());
  await page.locator('[data-id="sidebar-tab-run"]').click();

  // 3) 갈래 미리보기 — 판정?을 골라 "합격"에 올리면 합격 선만 살고 불합격 선은 흐려진다
  await page.locator(`.react-flow__node[data-id="${nid("d")}"]`).click();
  await page.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).waitFor();
  await page.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).hover();
  await page.waitForTimeout(250);
  const onLook = await edgeLook("e-dc");
  const offLook = await edgeLook("e-dr");
  check("branch hover: the pointed branch flows", onLook?.flow === true, JSON.stringify(onLook));
  check("branch hover: the other branch is dimmed", offLook?.opacity === "0.15" && offLook.flow === false, JSON.stringify(offLook));
  await page.screenshot({ path: `${OUT}/run-hist-branch-hover.png` });
  await page.mouse.move(800, 900);
  await page.waitForTimeout(200);
  check("branch hover: leaving restores the branches", (await edgeLook("e-dr"))?.opacity !== "0.15");
  await page.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).focus();
  await page.waitForTimeout(150);
  check("branch focus: focus previews too", (await edgeLook("e-dr"))?.opacity === "0.15");
  await page.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).click();
  await page.waitForTimeout(400);
  // Ctrl+Z — 방금 고른 갈래 완료를 되돌리고, 더 되돌릴 것이 없으면 알린다. 다시 골라 이어 간다
  check("undo: the branch completion is recorded", (await stateOf(run.id))[nid("d")] === "done");
  await page.keyboard.press("Control+z");
  let undone = false;
  for (let i = 0; i < 40 && !undone; i += 1) {
    await page.waitForTimeout(200);
    undone = !((await stateOf(run.id))[nid("d")] !== undefined);
  }
  check("undo: Ctrl+Z undoes my last action", undone);
  await page.getByText("판정? · Complete 되돌렸어요").first().waitFor({ timeout: 5000 });
  await page.keyboard.press("Control+z");
  await page.getByText("되돌릴 동작이 없어요").first().waitFor({ timeout: 5000 });
  check("undo: an empty stack says so", true);
  await page.locator(`.react-flow__node[data-id="${nid("d")}"]`).click();
  await page.locator(`[data-id="run-act-branch-${nid("e-dc")}"]`).click();
  await page.waitForTimeout(400);
  await act(run.id, "c", "start");
  await page.waitForTimeout(300);

  // 4) 뒤 단계가 진행된 완료 취소 — 마우스로 누르면 확인 버튼이 누른 자리에, 한 번 더 누르면 뒤 단계까지 취소
  await page.locator(`.react-flow__node[data-id="${nid("b")}"]`).click();
  await page.reload(); // 폴링 없는 개인 실행 — 방금 API로 바꾼 상태를 읽는다
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await page.locator(`.react-flow__node[data-id="${nid("b")}"]`).click();
  const undo = page.locator('[data-id="run-act-undo"]');
  await undo.waitFor();
  const undoBox = await undo.boundingBox();
  const pointer = centerOf(undoBox);
  await page.mouse.click(pointer.x, pointer.y);
  const dialog = page.locator('[data-id="run-downstream-dialog"]');
  await dialog.waitFor();
  const steps = await page.locator('[data-id="run-downstream-steps"] li').allTextContents();
  check("downstream dialog lists the later steps", steps.join(",") === "판정?,시료 채취", steps.join(","));
  const confirmBox = await page.locator('[data-id="run-downstream-confirm"]').boundingBox();
  const under =
    pointer.x >= confirmBox.x && pointer.x <= confirmBox.x + confirmBox.width && pointer.y >= confirmBox.y && pointer.y <= confirmBox.y + confirmBox.height;
  check("downstream dialog: confirm sits under the pointer", under, JSON.stringify({ pointer, confirmBox }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/run-hist-downstream-mouse.png` });
  await page.mouse.click(pointer.x, pointer.y);
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  const afterMouse = await stateOf(run.id);
  check("downstream: a second click clears the later steps", JSON.stringify(afterMouse) === JSON.stringify({ [nid("a")]: "done" }), JSON.stringify(afterMouse));

  // 키보드 — 가운데에 뜨고 확인 버튼에 포커스, Enter 한 번 더로 취소
  await act(run.id, "b", "complete");
  await act(run.id, "d", "complete", { edge_id: nid("e-dc") });
  await page.reload();
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await page.locator(`.react-flow__node[data-id="${nid("b")}"]`).click();
  await undo.waitFor();
  await undo.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  const centered = Math.abs(centerOf(dialogBox).x - viewport.width / 2) < 4 && Math.abs(centerOf(dialogBox).y - viewport.height / 2) < 4;
  check("downstream dialog by keyboard is centered", centered, JSON.stringify(dialogBox));
  check(
    "downstream dialog by keyboard focuses confirm",
    (await page.evaluate(() => document.activeElement?.getAttribute("data-id"))) === "run-downstream-confirm",
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/run-hist-downstream-keyboard.png` });
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(400);
  check("downstream by keyboard: Enter again clears", Object.keys(await stateOf(run.id)).length === 1);

  // 5) 코멘트 — 줄에 올리면 고치기·지우기, 고치면 (수정됨), 지우기는 같은 버튼을 두 번
  await page.locator(`.react-flow__node[data-id="${nid("a")}"]`).click();
  await page.locator('[data-id="run-act-comments"]').click();
  const input = page.locator('[data-id="run-pop-comment-input"]');
  await input.waitFor();
  await input.fill("서류 원본 확인 필요");
  await input.press("Enter");
  const row = page.locator('[data-id^="run-pop-comment-"][class*="group/comment"]').first();
  await row.waitFor();
  const commentId = (await row.getAttribute("data-id")).replace("run-pop-comment-", "");
  const editBtn = page.locator(`[data-id="run-pop-comment-edit-${commentId}"]`);
  const deleteBtn = page.locator(`[data-id="run-pop-comment-delete-${commentId}"]`);
  const hiddenOpacity = await editBtn.evaluate((el) => getComputedStyle(el.parentElement).opacity);
  await row.hover();
  await page.waitForTimeout(250);
  const shownOpacity = await editBtn.evaluate((el) => getComputedStyle(el.parentElement).opacity);
  check("comment: actions show only on hover", hiddenOpacity === "0" && shownOpacity === "1", `${hiddenOpacity} -> ${shownOpacity}`);
  await page.screenshot({ path: `${OUT}/run-hist-comment-hover.png` });
  await editBtn.click();
  const editInput = page.locator(`[data-id="run-pop-comment-edit-input-${commentId}"]`);
  await editInput.fill("서류 원본 확인 완료");
  await editInput.press("Enter");
  await page.locator(`[data-id="run-pop-comment-edited-${commentId}"]`).waitFor();
  check("comment: edit saves and marks (수정됨)", ((await row.textContent()) ?? "").includes("서류 원본 확인 완료"));
  // 실행 탭(접수를 고른 채 이 단계) — 고친 코멘트가 이력에도 따라온다
  const historyComment = page.locator(`[data-id="run-history-comment-${commentId}"]`);
  await page.waitForFunction(
    (id) => (document.querySelector(`[data-id="run-history-comment-${id}"]`)?.textContent ?? "").includes("확인 완료"),
    commentId,
    { timeout: 8000 },
  );
  check("history: the edited comment shows in the step history", ((await historyComment.textContent()) ?? "").includes("(수정됨)"));
  await row.hover();
  const deleteBefore = await deleteBtn.boundingBox();
  const deletePoint = centerOf(deleteBefore);
  await page.mouse.click(deletePoint.x, deletePoint.y);
  await page.waitForTimeout(150);
  const deleteAfter = await deleteBtn.boundingBox();
  const stillUnder =
    deletePoint.x >= deleteAfter.x && deletePoint.x <= deleteAfter.x + deleteAfter.width && deletePoint.y >= deleteAfter.y && deletePoint.y <= deleteAfter.y + deleteAfter.height;
  check("comment delete: first click turns the same button into a confirm", (await deleteBtn.getAttribute("data-confirming")) === "true" && stillUnder);
  await page.screenshot({ path: `${OUT}/run-hist-comment-confirm.png` });
  await page.mouse.click(deletePoint.x, deletePoint.y);
  await page.locator('[data-id="run-pop-comments-empty"]').waitFor();
  check("comment delete: second click deletes", (await api(USER_A, "GET", `/runs/${run.id}/comments`)).length === 0);
  await historyComment.waitFor({ state: "detached", timeout: 8000 });
  await page.keyboard.press("Escape");

  // 6) 실행 탭 — 단계를 골라도 전체 그대로(이 단계는 버튼으로만), 이 단계를 누르면 그 단계 이력(접수 완료 한 줄),
  // 전체로 돌아가면 함께 취소 줄도. 전체에서 단계 이름을 눌러도 보기는 전체 그대로다
  const modeAll = page.locator('[data-id="run-history-mode-all"]');
  await modeAll.waitFor();
  check("history: a selected step keeps the whole run until This step is pressed", (await modeAll.getAttribute("aria-pressed")) === "true");
  await page.locator('[data-id="run-history-mode-step"]').click();
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 1, HISTORY_ENTRIES);
  const stepTexts = await page.locator(HISTORY_ENTRIES).allTextContents();
  check("history: step mode shows only that step", stepTexts.length === 1 && stepTexts[0].includes("Complete"), stepTexts.join(" | "));
  await modeAll.click();
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length > 6, HISTORY_ENTRIES);
  await page.locator('[data-id^="run-history-step-"]').last().click();
  await page.waitForTimeout(400);
  check(
    "history: clicking a step name in All moves the selection but keeps All",
    (await modeAll.getAttribute("aria-pressed")) === "true" && (await page.locator(HISTORY_ENTRIES).count()) > 6,
  );
  const allTexts = await page.locator(HISTORY_ENTRIES).allTextContents();
  check("history: whole run shows steps cleared with an undo", allTexts.some((text) => text.includes("Also undone")));
  // 이어진 같은 단계 줄은 한 묶음 — 단계 이름은 머리에 한 번, 바로 위와 같은 사람이면 이름 생략, 날짜는 구분 줄 한 번
  const groupShapes = await page.locator('[data-id^="run-history-group-"]').evaluateAll((groups) =>
    groups.map((group) => [...group.querySelectorAll('li[data-id^="run-history-"]')].map((li) => li.textContent ?? "")),
  );
  const folded = groupShapes.find((entries) => entries.length >= 2);
  check(
    "history: consecutive rows of one step fold into a group without repeating the name",
    folded !== undefined && folded[0].includes("System Admin") && !folded[1].includes("System Admin"),
    JSON.stringify(groupShapes.map((entries) => entries.length)),
  );
  check(
    "history: fewer groups than rows and one day separator",
    groupShapes.length < allTexts.length && (await page.locator('[data-id^="run-history-day-"]').count()) === 1,
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/run-hist-sidebar-all.png` });
  // 짧은 창에서 이력이 넘쳐 사이드바가 스크롤될 때 — 맵 설정 링크는 늘 사이드바 바닥에 붙고 중간에 뜨지 않는다
  await page.setViewportSize({ width: 1600, height: 640 });
  await page.waitForTimeout(300);
  const aside = page.locator('aside:has([data-id="sidebar-run-panel"])');
  const settingsLink = aside.locator('a[href$="/settings"]');
  const scrollable = await aside.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
  await aside.evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  await page.waitForTimeout(200);
  const asideBox = await aside.boundingBox();
  const linkBox = await settingsLink.boundingBox();
  check(
    "sidebar: the settings link stays at the bottom while history scrolls",
    scrollable && Math.abs(linkBox.y + linkBox.height - (asideBox.y + asideBox.height)) <= 10, // 사이드바 p-2(8px) 안쪽 바닥
    JSON.stringify({ scrollable, asideBottom: asideBox.y + asideBox.height, linkBottom: linkBox.y + linkBox.height }),
  );
  await page.screenshot({ path: `${OUT}/run-hist-sidebar-scrolled.png` });
  await page.setViewportSize({ width: 1600, height: 1000 });

  // 7) 실행 메뉴 — 모든 실행 보기는 머리 줄 오른쪽 아이콘(툴팁), 모든 실행 창 "다른 맵" 칸 → 그 맵의 실행으로
  await page.locator('[data-id="run-bar-close"]').click();
  await page.waitForURL((url) => !url.searchParams.has("run"));
  await page.locator('[data-id="run-menu"]').click();
  const allButton = page.locator('[data-id="run-menu-all"]');
  await allButton.waitFor();
  const popBox = await page.locator('[data-id="run-menu-pop"]').boundingBox();
  const allBox = await allButton.boundingBox();
  check(
    "run menu: show-all is a small icon at the top right",
    allBox.width <= 28 && popBox.x + popBox.width - (allBox.x + allBox.width) < 12 && allBox.y - popBox.y < 16 && ((await allButton.textContent()) ?? "").trim() === "",
    JSON.stringify({ popBox, allBox }),
  );
  await allButton.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/run-hist-run-menu.png`, clip: { x: 900, y: 40, width: 700, height: 330 } });
  await allButton.click();
  await page.locator('[data-id="run-list-modal"]').waitFor();
  await page.locator('[data-id="run-list-section-other"]').click();
  await page.locator('[data-id="run-list-tab-ended"]').click();
  const otherRow = page.locator(`[data-id="run-list-open-${otherRun.id}"]`);
  await otherRow.waitFor();
  check("all runs: other maps show my finished run with its map name", ((await otherRow.textContent()) ?? "").includes("출고 점검"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/run-hist-list-other.png` });
  await otherRow.click();
  await page.waitForURL((url) => url.pathname === `/maps/${other.mapId}` && url.searchParams.get("run") === String(otherRun.id));
  check("all runs: opening it goes to that map's run", true);

  // 8) 홈 — 진행 중이 없어도 실행 타일이 펼쳐지고 "최근 끝남"에서 연다
  await page.goto(BASE);
  await page.locator('[data-id="home-activity-runs"]').click();
  const endedRow = page.locator(`[data-id="home-run-ended-row-${otherRun.id}"]`);
  await endedRow.waitFor();
  check("home: recently finished lists the other map run", ((await endedRow.textContent()) ?? "").includes("출고 점검"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/run-hist-home-ended.png` });
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  failures += 1;
  console.log("FAIL exception", err);
} finally {
  if (browser) await browser.close();
  await purgeMaps().catch((err) => console.log("WARN cleanup", String(err)));
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
