// 실행 노드 버튼 줄 스모크 — 클릭만으로 이어 밟기(완료 → 다음 노드 자동 선택·반짝임), 판단 노드 갈래 버튼, 병렬로 두 단계가
// 열리면 제자리 반짝임 + 토스트, 대기 노드의 꺼진 완료에 올리면 먼저 끝낼 단계 2개(점선 안내)·누르면 화면 밖 노드로 이동(가운데),
// 문제 → 한 줄 메모 Enter, 코멘트 팝오버(Esc → 팝오버 → 선택 순서로 닫힘), 하위 맵 들어가기·하위 단계 완료 → 시작 취소 시
// 하위 맵 기록 취소 확인(모두 취소 = cascade), 하위 맵을 끝까지 → 바깥 자동 완료, 끝난 실행은 안내만. 콘솔 에러 0.
// 실행(frontend/ 에서):
//   bash       BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-run-bar.mjs
//   PowerShell $env:BASE_URL="http://localhost:3047"; $env:API_URL="http://localhost:8048"; node scripts\pw-smoke-run-bar.mjs
// 전제: backend는 AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" 로, frontend는 BACKEND_URL=<backend>로 기동.
//       시드는 스크립트가 API로 만든다(하위 맵 게시·하위프로세스 지정 → 바깥 맵 게시 → 개인 실행). 끝에 실행과 두 맵을 지운다
//       (KEEP=1이면 남긴다). 산출물은 저장소 루트 .shots/run-bar-*.png(gitignore).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = "../.shots";
const KEEP = process.env.KEEP === "1";
const ADMIN = "admin.sys";

mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};

async function api(method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Dev-User": ADMIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---- 시드 ----
const tag = Date.now().toString(36);
const nid = (key) => `rb-${tag}-${key}`;
const directory = await api("GET", "/directory");
const me = directory.users.find((u) => u.id === ADMIN) ?? directory.users[0];
if (!me?.org_path) throw new Error("no org_path in directory — seed the directory first");

async function createPublishedMap(name, nodes, edges) {
  const map = await api("POST", "/maps", { name, owning_department: me.org_path, visibility: "private" });
  const detail = await api("GET", `/maps/${map.id}`);
  const draft = detail.versions.find((v) => v.status === "draft") ?? detail.versions[0];
  await api("POST", `/versions/${draft.id}/checkout`, { force: true });
  await api("PUT", `/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
  await api("PUT", `/maps/${map.id}/approvers`, { user_ids: [ADMIN] });
  await api("POST", `/versions/${draft.id}/submit`, {});
  await api("POST", `/versions/${draft.id}/approve`, {});
  await api("POST", `/versions/${draft.id}/publish`, {});
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

// 하위 맵: 시작 → 시료 전처리 → 측정 → 끝. 캔버스의 하위프로세스 노드는 저장 제목 대신 이 맵 이름을 보인다
const childName = `실행 버튼 줄 스모크 하위 ${tag}`;
const child = await createPublishedMap(
  childName,
  [
    node("cs", "시작", 0, 100, { node_type: "start" }),
    node("c1", "시료 전처리", 200, 100),
    node("c2", "측정", 420, 100),
    node("ce", "", 640, 100, { node_type: "end" }),
  ],
  [edge("c1", "cs", "c1"), edge("c2", "c1", "c2"), edge("c3", "c2", "ce")],
);
await api("PUT", `/maps/${child.mapId}/subprocess-designation`, { department: me.department || "QA" });

// 바깥 맵: 시작 → 시료 접수 → 외관 이상?(예 → 반품 처리 → 반품 끝 / 아니오 → 검사 준비(병렬) → 이화학 시험 · 미생물 배양 → 미생물 판독)
//          → 결과 취합(멀리 오른쪽) → 품질 시험(하위프로세스) → 끝
const parent = await createPublishedMap(
  `실행 버튼 줄 스모크 ${tag}`,
  [
    node("s", "시작", 0, 220, { node_type: "start" }),
    node("a", "시료 접수", 200, 220),
    node("d", "외관 이상?", 430, 200, { node_type: "decision" }),
    node("r", "반품 처리", 660, 420),
    node("re", "반품 끝", 900, 420, { node_type: "end" }),
    node("f", "검사 준비", 660, 220, { parallel_outputs: ["__primary__"] }),
    node("x", "이화학 시험", 900, 100),
    node("w", "미생물 배양", 900, 320),
    node("y", "미생물 판독", 1120, 320),
    node("j", "결과 취합", 2700, 220),
    node("sp", "품질 시험", 2940, 220, { node_type: "subprocess", linked_map_id: child.mapId, follow_latest: true }),
    node("e", "", 3200, 220, { node_type: "end", is_primary_end: true }),
  ],
  [
    edge("sa", "s", "a"),
    edge("ad", "a", "d"),
    edge("dy", "d", "r", { label: "예" }),
    edge("dn", "d", "f", { label: "아니오" }),
    edge("rre", "r", "re"),
    edge("fx", "f", "x"),
    edge("fw", "f", "w"),
    edge("wy", "w", "y"),
    edge("xj", "x", "j"),
    edge("yj", "y", "j"),
    edge("jsp", "j", "sp"),
    edge("spe", "sp", "e", { source_handle: "__primary__" }),
  ],
);
const run = await api("POST", `/maps/${parent.mapId}/runs`, {
  name: `버튼 줄 스모크 ${tag}`,
  version_id: parent.versionId,
  scope: "solo",
  participants: [],
});
check("seeded maps and run", true, `child ${child.mapId} parent ${parent.mapId} run ${run.id}`);

// ---- 브라우저 ----
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 950 } });
await ctx.addInitScript((devUser) => {
  window.localStorage.setItem("bpm.devUser", devUser);
  window.localStorage.setItem("bpm.lang", "ko");
}, ADMIN);
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const bar = page.locator('[data-id="run-action-bar"]');
const pop = page.locator('[data-id="run-pop"]');
const nodeEl = (key) => page.locator(`.react-flow__node[data-id="${key}"]`);
const subKey = (key) => `${nid("sp")}/${nid(key)}`;

async function barButtons() {
  return bar.locator('[data-id^="run-act-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
}
async function waitBarOn(key, status) {
  await page.waitForFunction(
    ([k, s]) => {
      const el = document.querySelector('[data-id="run-action-bar"]');
      return el?.getAttribute("data-node") === k && (s === null || el.getAttribute("data-status") === s);
    },
    [key, status ?? null],
    { timeout: 8000 },
  );
}
// 앞 노드의 버튼 줄이 다음 노드를 덮을 수 있어(줌이 작을 때) Esc로 팝오버 → 선택을 먼저 닫고 누른다
async function selectNode(key) {
  for (let i = 0; i < 2 && (await bar.count()) > 0; i += 1) await page.keyboard.press("Escape");
  await bar.waitFor({ state: "detached" });
  await nodeEl(key).click();
  await waitBarOn(key, null);
}
// 노드 위에서 Ctrl+휠로 확대 — 맵 화면은 휠이 이동(panOnScroll)이고 Ctrl/Meta+휠이 확대다(핀치 배율이라 한 칸 -30 ≈ 1.5배)
async function zoomAt(key, steps) {
  const box = await nodeEl(key).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, -30);
    await page.waitForTimeout(120);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(400);
}
async function fitAll() {
  await page.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await page.waitForTimeout(600);
}
// 반짝임은 1.1초만 켜진다 — 그동안 노드들에 반짝임 링이 한 번이라도 같이 뜨는지 본다
async function waitFlash(keys) {
  return page
    .waitForFunction(
      (ids) => ids.every((id) => document.querySelector(`.react-flow__node[data-id="${id}"] [data-run-flash]`)),
      keys,
      { timeout: 3000, polling: 50 },
    )
    .then(() => true)
    .catch(() => false);
}
async function readStates() {
  return (await api("GET", `/runs/${run.id}`)).states;
}
async function isInsidePane(key) {
  const pane = await page.locator(".react-flow__pane").boundingBox();
  const box = await nodeEl(key).boundingBox();
  return (
    box !== null &&
    box.x >= pane.x &&
    box.y >= pane.y &&
    box.x + box.width <= pane.x + pane.width &&
    box.y + box.height <= pane.y + pane.height
  );
}

try {
  await page.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}&run=${run.id}`);
  await nodeEl(nid("a")).waitFor();
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await page.waitForTimeout(800); // 측정·첫 화면 맞춤
  // 캔버스를 넓히고(좌·우 패널 접기) 맵 전체를 맞춘 뒤 앞쪽 단계들이 읽히게 판단 노드 쪽으로 한 번 확대한다 —
  // 첫 화면 맞춤은 측정 전 좌표로 일부만 확대해 둘 수 있다
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForTimeout(500);
  await fitAll();
  await zoomAt(nid("d"), 1);

  // 1) 진행 가능 노드: 완료(초록)·시작·문제·말풍선, 노드 위
  await selectNode(nid("a"));
  check(
    "ready step bar: complete, start, problem, comments",
    JSON.stringify(await barButtons()) ===
      JSON.stringify(["run-act-complete", "run-act-start", "run-act-problem", "run-act-comments"]),
    (await barButtons()).join(","),
  );
  const aBox = await nodeEl(nid("a")).boundingBox();
  const barBox = await bar.boundingBox();
  check(
    "bar sits next to the node without covering it",
    barBox.y + barBox.height <= aBox.y + 1 || barBox.y >= aBox.y + aBox.height - 1,
    `bar ${Math.round(barBox.y)}-${Math.round(barBox.y + barBox.height)} node ${Math.round(aBox.y)}-${Math.round(aBox.y + aBox.height)}`,
  );
  await page.screenshot({ path: `${OUT}/run-bar-ready.png` });

  // 2) 완료 → 다음 노드(판단) 자동 선택 + 반짝임, 갈래 이름 버튼
  await page.locator('[data-id="run-act-complete"]').click();
  const advancedFlash = waitFlash([nid("d")]);
  await waitBarOn(nid("d"), "ready");
  check("complete auto-advances to the next step", true);
  check("advanced node flashes", await advancedFlash);
  const yesBtn = page.locator(`[data-id="run-act-branch-${nid("e-dy")}"]`);
  const noBtn = page.locator(`[data-id="run-act-branch-${nid("e-dn")}"]`);
  check(
    "decision bar shows branch names",
    (await yesBtn.textContent()).trim() === "예" && (await noBtn.textContent()).trim() === "아니오",
  );
  await page.waitForTimeout(350); // 선택 링이 미끄러져 오는 시간
  await page.screenshot({ path: `${OUT}/run-bar-decision.png` });

  // 3) 갈래 "아니오" → 검사 준비 자동 선택, 안 고른 반품 처리는 건너뜀
  await noBtn.click();
  await waitBarOn(nid("f"), "ready");
  check("branch choice advances to its target", true);
  await selectNode(nid("r"));
  check(
    "unchosen branch reads as skipped with a note",
    (await bar.getAttribute("data-status")) === "skipped" &&
      (await page.locator('[data-id="run-act-note"]').textContent()).includes("고르지 않은 갈래"),
  );

  // 4) 병렬로 두 단계가 열리면 제자리 + 열린 노드 반짝임 + 토스트
  await selectNode(nid("f"));
  await page.locator('[data-id="run-act-complete"]').click();
  check("both opened steps flash", await waitFlash([nid("x"), nid("w")]));
  await page.getByText("다음 단계 2개가 열렸어요").waitFor({ timeout: 5000 });
  check("two opened steps: toast", true);
  await waitBarOn(nid("f"), "done");
  check("selection stays on the completed step", JSON.stringify(await barButtons()) === JSON.stringify(["run-act-undo", "run-act-comments"]));
  await page.screenshot({ path: `${OUT}/run-bar-parallel.png` });

  // 5) 결과 취합(대기) 쪽으로 확대 → 꺼진 완료에 올리면 먼저 끝낼 단계 2개 + 점선 안내
  await fitAll();
  await zoomAt(nid("j"), 3);
  await selectNode(nid("j"));
  check(
    "waiting step bar: switched-off complete + comments",
    JSON.stringify(await barButtons()) === JSON.stringify(["run-act-why", "run-act-comments"]) &&
      (await page.locator('[data-id="run-act-why"]').getAttribute("aria-disabled")) === "true",
  );
  check("the step to jump to is off screen", !(await isInsidePane(nid("x"))));
  await page.locator('[data-id="run-act-why"]').hover();
  await pop.waitFor();
  const gotoIds = await pop.locator('[data-id^="run-pop-goto-"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
  check(
    "why popover lists the two steps to finish first",
    (await pop.getAttribute("data-kind")) === "why" &&
      (await pop.textContent()).includes("먼저 끝내야 할 단계") &&
      JSON.stringify(gotoIds) === JSON.stringify([`run-pop-goto-${nid("w")}`, `run-pop-goto-${nid("x")}`]),
    gotoIds.join(","),
  );
  check("hint ring on both targets", (await page.locator('[data-id="run-node-ring"][data-run-hint]').count()) === 2);
  await page.waitForTimeout(300); // 등장 애니메이션
  await page.screenshot({ path: `${OUT}/run-bar-why.png` });

  // 6) 누르면 그 노드로 이동(화면 밖 → 가운데), 이동해 온 노드 반짝임
  await page.locator(`[data-id="run-pop-goto-${nid("x")}"]`).click();
  const jumpedFlash = waitFlash([nid("x")]);
  await waitBarOn(nid("x"), "ready");
  check("jump selects the step", true);
  check("jumped node flashes", await jumpedFlash);
  await page.waitForTimeout(700); // 가운데로 옮기는 0.5초
  check("jumped node is brought on screen", await isInsidePane(nid("x")));
  check("hint rings cleared after the jump", (await page.locator("[data-run-hint]").count()) === 0);
  await page.screenshot({ path: `${OUT}/run-bar-jump.png` });

  // 7) 문제 → 한 줄 메모(입력 포커스) → Enter
  await page.locator('[data-id="run-act-problem"]').click();
  await page.locator('[data-id="run-pop"][data-kind="note"]').waitFor();
  check(
    "problem opens the note line with focus",
    await page.evaluate(() => document.activeElement?.getAttribute("data-id") === "run-pop-note-input"),
  );
  await page.keyboard.type("시약이 부족해요");
  await page.screenshot({ path: `${OUT}/run-bar-note.png` });
  await page.keyboard.press("Enter");
  await page.getByText("문제 알림에 메모를 같이 보냈어요").waitFor({ timeout: 5000 });
  check("note posted with the problem toast", true);
  await pop.waitFor({ state: "detached" });
  await page.waitForFunction(() =>
    document.querySelector('[data-id="run-act-comments"]')?.textContent?.includes("1"),
  );
  check(
    "problem bar: resolve, complete, comments(1)",
    JSON.stringify(await barButtons()) === JSON.stringify(["run-act-resolve", "run-act-complete", "run-act-comments"]),
  );

  // 8) 문제에서 바로 완료 → 아직 열린 단계 없음(미생물 쪽 남음) → 제자리
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("x"), "done");
  check("completing with nothing opened keeps the selection", true);

  // 9) 미생물 배양 → 판독 자동 선택 → 결과 취합 자동 선택(멀리 오른쪽, 화면으로) → 품질 시험 자동 선택
  await selectNode(nid("w"));
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("y"), "ready");
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("j"), "ready");
  await page.waitForTimeout(700);
  check("auto-advance reveals a far step", await isInsidePane(nid("j")));
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(nid("sp"), "ready");
  check(
    "subprocess bar: complete, sub map, start, problem, comments",
    JSON.stringify(await barButtons()) ===
      JSON.stringify(["run-act-complete", "run-act-enter", "run-act-start", "run-act-problem", "run-act-comments"]),
    (await barButtons()).join(","),
  );

  // 10) 코멘트 팝오버 → 남기기 → Esc는 팝오버 → 선택 순서로 닫는다
  await page.locator('[data-id="run-act-comments"]').click();
  await page.locator('[data-id="run-pop"][data-kind="comments"]').waitFor();
  await page.locator('[data-id="run-pop-comments-empty"]').waitFor();
  check(
    "comments popover: shown name, empty list and untouched",
    (await page.locator('[data-id="run-pop-touched"]').textContent()).includes("아직 손대지 않음") &&
      (await page.locator('[data-id="run-pop"][data-kind="comments"]').textContent()).includes(childName),
  );
  await page.locator('[data-id="run-pop-comment-input"]').fill("하위 맵에서 진행할게요");
  await page.keyboard.press("Enter");
  await page.getByText("코멘트를 남겼어요 · 코멘트만으로는 알림이 가지 않아요").waitFor({ timeout: 5000 });
  await page.locator('[data-id^="run-pop-comment-"]:not([data-id^="run-pop-comment-input"]):not([data-id^="run-pop-comment-submit"])').first().waitFor();
  check("comment posted and listed", (await page.locator('[data-id="run-pop-comments"]').textContent()).includes("하위 맵에서 진행할게요"));
  await page.screenshot({ path: `${OUT}/run-bar-comments.png` });
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "detached" });
  check("Esc closes the popover first", (await bar.count()) === 1);
  await page.keyboard.press("Escape");
  await bar.waitFor({ state: "detached" });
  check("second Esc clears the selection", true);

  // 11) 하위 맵 들어가기 → 하위 단계 완료(바깥은 진행 중) → 바깥 시작 취소 = 하위 맵 기록 취소 확인
  await selectNode(nid("sp"));
  await page.locator('[data-id="run-act-enter"]').click();
  await nodeEl(subKey("c1")).waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  check(
    "sub map nodes are not dimmed in run mode",
    (await nodeEl(subKey("c1")).evaluate((el) => getComputedStyle(el).opacity)) === "1",
  );
  await selectNode(subKey("c1"));
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(subKey("c2"), "ready");
  check("auto-advance inside the sub map", true);
  await page.waitForTimeout(600); // 다음 하위 단계를 가운데로 옮기는 0.5초
  await fitAll();
  await selectNode(nid("sp"));
  check("host became in progress", (await bar.getAttribute("data-status")) === "active");
  await page.locator('[data-id="run-act-unstart"]').click();
  const cascade = page.locator('[data-id="run-pop-cascade"]');
  await cascade.waitFor();
  check("undo start asks to clear the sub map records", (await cascade.textContent()).includes("하위 맵 기록도 모두 취소돼요"));
  await page.waitForTimeout(300); // 등장 애니메이션
  await page.screenshot({ path: `${OUT}/run-bar-cascade.png` });
  await page.locator('[data-id="run-pop-cascade-cancel"]').click();
  await cascade.waitFor({ state: "detached" });
  check("keep closes the confirm without changes", (await readStates()).some((row) => row.scope_path === nid("sp")));
  await page.locator('[data-id="run-act-unstart"]').click();
  await cascade.waitFor();
  await page.locator('[data-id="run-pop-cascade-confirm"]').click();
  await waitBarOn(nid("sp"), "ready");
  const afterCascade = await readStates();
  check(
    "undo all clears the host and its sub map records",
    !afterCascade.some((row) => row.scope_path === nid("sp")) && !afterCascade.some((row) => row.node_id === nid("sp")),
  );

  // 12) 하위 맵을 끝까지 → 바깥 자동 완료 + 알림, 실행 끝 → 안내만
  await fitAll();
  await selectNode(subKey("c1"));
  await page.locator('[data-id="run-act-complete"]').click();
  await waitBarOn(subKey("c2"), "ready");
  await page.locator('[data-id="run-act-complete"]').click();
  await page.getByText(`하위 맵 끝에 닿아서 ${childName} 단계가 완료됐어요`).waitFor({ timeout: 5000 });
  check("reaching the sub map end completes the host (toast)", true);
  await page.waitForFunction(
    (key) =>
      document
        .querySelector(`.react-flow__node[data-id="${key}"] [data-id="run-node-badge"]`)
        ?.getAttribute("data-run-status") === "done",
    nid("sp"),
  );
  check("host badge shows done", true);
  await page.screenshot({ path: `${OUT}/run-bar-sub-done.png` });
  check("run finished", (await api("GET", `/runs/${run.id}`)).status === "done");
  await fitAll();
  await selectNode(nid("a"));
  check(
    "finished run: a note and comments only",
    JSON.stringify(await barButtons()) === JSON.stringify(["run-act-note", "run-act-comments"]),
    (await barButtons()).join(","),
  );

  // 13) 빈 캔버스를 누르면 버튼 줄이 닫힌다
  const pane = await page.locator(".react-flow__pane").boundingBox();
  await page.mouse.click(pane.x + 30, pane.y + pane.height - 30);
  await bar.waitFor({ state: "detached" });
  check("pane click closes the bar", true);
} catch (err) {
  failures += 1;
  console.log("FAIL exception", err);
  await page.screenshot({ path: `${OUT}/run-bar-failure.png` }).catch(() => undefined);
} finally {
  // 예상한 서버 거절(409·404)만 남는다 — 그 밖의 콘솔 에러는 실패
  const unexpected = consoleErrors.filter((text) => !/status of (404|409)/.test(text));
  check("console errors", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
  await browser.close();
  if (!KEEP) {
    await api("DELETE", `/runs/${run.id}`).catch((err) => console.warn("run cleanup skipped", String(err).slice(0, 120)));
    for (const mapId of [parent.mapId, child.mapId]) {
      await api("DELETE", `/maps/${mapId}`).catch((err) => console.warn("map cleanup skipped", String(err).slice(0, 120)));
    }
  }
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
