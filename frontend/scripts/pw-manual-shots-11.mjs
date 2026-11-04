// 매뉴얼 11차 캡처(2026-11-05) — 실행 체크와 배포 문서 파일. 사용자 덱: 새 실행 창 · 실행 화면 · 버튼 줄 · 문제 메모 · 하위 맵 자동 완료 ·
// 실행 범례(키보드) · 모든 실행 창 · 홈 진행 중 실행 목록. 관리자 덱: 설정 › 실행 · 매뉴얼 파일 동기화 · 공지 파일에서 불러오기.
// 앱 전체 화면은 슬라이드 프레임에서 작아서 각 화면의 해당 범위만 자른다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 PW_LANG=ko|en node scripts/pw-manual-shots-11.mjs
//   산출물은 저장소 루트 .shots/manual11/<lang>-*.png (gitignore). 시드 맵은 끝에 영구 삭제한다(실행·실행 알림도 같이 지워진다).
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys(A)와 bora.hong(B, 공유 실행 참여자). 아래 시드 맵 이름이 이미 있으면
//   지난 회차가 남긴 것으로 보고 지운다(이 이름은 데모 시드에 없다).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const LANG = process.env.PW_LANG ?? "ko";
const OUT = "../.shots/manual11";
const USER_A = "admin.sys";
const USER_B = "bora.hong";
const T =
  LANG === "ko"
    ? {
        parent: "원자재 입고 검사", child: "품질 시험",
        s: "시작", a: "접수", b: "서류 검토", d: "판정?", pass: "합격", fail: "불합격", c: "시료 채취", sp: "품질 시험",
        r: "반품 처리", re: "반품 끝", c1: "측정",
        run: "11월 1차 입고 · LOT 2611-07", solo: "11월 2차 입고 · LOT 2611-12", prob: "11월 3차 입고 · LOT 2611-15",
        stopped: "10월 4차 입고 · LOT 2610-31", memo: "라벨 인쇄가 흐려서 다시 뽑는 중",
        fit: "화면 맞춤(좌상단)", newNotice: "새 공지 등록",
      }
    : {
        parent: "Raw material intake check", child: "Quality test",
        s: "Start", a: "Receive", b: "Review documents", d: "Pass?", pass: "Pass", fail: "Fail", c: "Take samples",
        sp: "Quality test", r: "Return goods", re: "Returned", c1: "Measure",
        run: "Nov intake 1 · LOT 2611-07", solo: "Nov intake 2 · LOT 2611-12", prob: "Nov intake 3 · LOT 2611-15",
        stopped: "Oct intake 4 · LOT 2610-31", memo: "Label print is blurry, reprinting",
        fit: "Fit to view (top-left)", newNotice: "New notice",
      };

mkdirSync(OUT, { recursive: true });

async function api(user, method, path, body) {
  const r = await fetch(`${BACKEND}/api${path}`, {
    method,
    headers: { "X-Dev-User": user, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function purgeSeedMaps() {
  const names = new Set([T.parent, T.child]);
  for (const found of (await api(USER_A, "GET", "/maps")).filter((m) => names.has(m.name))) {
    await api(USER_A, "DELETE", `/maps/${found.id}`);
  }
  for (const found of (await api(USER_A, "GET", "/maps/deleted/list")).filter((m) => names.has(m.name))) {
    await api(USER_A, "DELETE", `/maps/${found.id}/permanent`);
  }
}

const tag = Date.now().toString(36);
const nid = (key) => `m11-${tag}-${key}`;
const node = (key, title, x, y, extra = {}) => ({ id: nid(key), title, node_type: "process", pos_x: x, pos_y: y, ...extra });
const edge = (key, source, target, extra = {}) => ({ id: nid(`e-${key}`), source_node_id: nid(source), target_node_id: nid(target), label: "", ...extra });

async function createPublishedMap(name, owning, nodes, edges) {
  const map = await api(USER_A, "POST", "/maps", { name, owning_department: owning, visibility: "public" });
  const draft = (await api(USER_A, "GET", `/maps/${map.id}`)).versions.find((v) => v.status === "draft");
  await api(USER_A, "POST", `/versions/${draft.id}/checkout`, { force: true });
  await api(USER_A, "PUT", `/versions/${draft.id}/graph`, { nodes, edges, groups: [] });
  await api(USER_A, "PUT", `/maps/${map.id}/approvers`, { user_ids: [USER_A] });
  await api(USER_A, "POST", `/versions/${draft.id}/submit`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/approve`, {});
  await api(USER_A, "POST", `/versions/${draft.id}/publish`, {});
  return { mapId: map.id, versionId: draft.id };
}

const act = (runId, nodeKey, action, extra = {}) =>
  api(USER_A, "POST", `/runs/${runId}/actions`, { scope_path: "", node_id: nid(nodeKey), action, ...extra });

// 요소 둘레를 여백과 함께 자른다(화면 밖으로 넘지 않게)
async function shotAround(page, file, locators, pad = 40) {
  const boxes = [];
  for (const loc of locators) {
    const box = await loc.boundingBox();
    if (box) boxes.push(box);
  }
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  await page.screenshot({ path: `${OUT}/${LANG}-${file}.png`, clip: { x, y, width: right - x, height: bottom - y } });
  console.log(`shot ${LANG}-${file}`);
}

const consoleErrors = [];
let browser = null;
try {
  await purgeSeedMaps();
  const directory = await api(USER_A, "GET", "/directory");
  const me = directory.users.find((u) => u.id === USER_A);
  const child = await createPublishedMap(
    T.child,
    me.org_path,
    [node("cs", T.s, 0, 100, { node_type: "start" }), node("c1", T.c1, 220, 100), node("ce", "", 440, 100, { node_type: "end" })],
    [edge("c1", "cs", "c1"), edge("c2", "c1", "ce")],
  );
  await api(USER_A, "PUT", `/maps/${child.mapId}/subprocess-designation`, { department: me.department || "QA" });
  const parent = await createPublishedMap(
    T.parent,
    me.org_path,
    [
      node("s", T.s, 0, 220, { node_type: "start" }),
      node("a", T.a, 200, 220),
      node("b", T.b, 420, 220),
      node("d", T.d, 650, 200, { node_type: "decision" }),
      node("c", T.c, 880, 220),
      node("sp", T.sp, 1100, 220, { node_type: "subprocess", linked_map_id: child.mapId, follow_latest: true }),
      node("e", "", 1340, 220, { node_type: "end", is_primary_end: true }),
      node("r", T.r, 880, 420),
      node("re", T.re, 1100, 420, { node_type: "end" }),
    ],
    [
      edge("sa", "s", "a"), edge("ab", "a", "b"), edge("bd", "b", "d"),
      edge("dc", "d", "c", { label: T.pass }), edge("dr", "d", "r", { label: T.fail }),
      edge("csp", "c", "sp"), edge("spe", "sp", "e", { source_handle: "__primary__" }), edge("rre", "r", "re"),
    ],
  );
  const runOf = (name, scope, participants = []) =>
    api(USER_A, "POST", `/maps/${parent.mapId}/runs`, { name, version_id: parent.versionId, scope, participants });
  const main = await runOf(T.run, "shared", [USER_B]);
  await act(main.id, "a", "complete");
  await act(main.id, "b", "complete");
  await act(main.id, "d", "complete", { edge_id: nid("e-dc") });
  await act(main.id, "c", "start");
  await runOf(T.solo, "solo");
  const prob = await runOf(T.prob, "shared", [USER_B]);
  await act(prob.id, "a", "complete");
  await act(prob.id, "b", "problem");
  const stopped = await runOf(T.stopped, "shared", [USER_B]);
  await act(stopped.id, "a", "complete");
  await api(USER_A, "POST", `/runs/${stopped.id}/stop`);

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1456, height: 837 } });
  await ctx.addInitScript(([user, lang]) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", lang);
  }, [USER_A, LANG]);
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  const bar = page.locator('[data-id="run-action-bar"]');
  const nodeEl = (key) => page.locator(`.react-flow__node[data-id="${key}"]`);
  const fit = async () => {
    await page.getByRole("button", { name: T.fit }).click();
    await page.waitForTimeout(700);
  };

  // 1) 새 실행 창 — 공유 + 참여자를 고른 상태(만들지 않고 닫는다)
  await page.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}`);
  await page.waitForFunction(() => document.querySelector('[data-id="run-menu"]')?.getAttribute("aria-disabled") === "false");
  await page.locator('[data-id="run-menu"]').click();
  await page.locator('[data-id="run-menu-new"]').click();
  const dialog = page.locator('[data-id="run-start-dialog"]');
  await dialog.waitFor();
  await page.locator('[data-id="run-start-name"]').fill(T.run);
  await page.locator('[data-id="run-start-scope-shared"]').click();
  const picker = dialog.locator("input:not([data-id])");
  await picker.click();
  await picker.fill(USER_B);
  await page.locator('[data-id="principal-picker-dropdown"] button').first().waitFor();
  await picker.press("Enter");
  await dialog.locator(`[data-id="run-start-participant-${USER_B}"]`).waitFor();
  await page.locator('[data-id="run-start-name"]').click();
  await page.waitForTimeout(400);
  await shotAround(page, "run-start", [dialog], 24);
  await page.locator('[data-id="run-start-cancel"]').click();

  // 2) 실행 화면 — 완료 3 · 진행 중 1 · 대기 · 건너뜀
  await page.goto(`${BASE}/maps/${parent.mapId}?version=${parent.versionId}&run=${main.id}`);
  await page.locator('[data-id="run-bar"][data-state="ready"]').waitFor();
  await nodeEl(nid("a")).waitFor();
  await page.waitForTimeout(800);
  await page.keyboard.press("Alt+ArrowLeft");
  await page.keyboard.press("Alt+ArrowRight");
  await page.waitForTimeout(500);
  await fit();
  await page.locator('[data-id="run-bar"]').click({ position: { x: 5, y: 5 } }); // 줌 버튼 포커스를 푼다
  await page.screenshot({ path: `${OUT}/${LANG}-run-screen.png`, clip: { x: 0, y: 40, width: 1456, height: 520 } });
  console.log(`shot ${LANG}-run-screen`);

  // 3) 버튼 줄(진행 중 노드) → 문제 메모
  await nodeEl(nid("c")).click();
  await bar.waitFor();
  await page.waitForTimeout(400);
  await shotAround(page, "run-actions", [nodeEl(nid("c")), bar, nodeEl(nid("d")), nodeEl(nid("sp"))], 60);
  await page.locator('[data-id="run-act-problem"]').click();
  const note = page.locator('[data-id="run-pop-note-input"]');
  await note.waitFor();
  await note.fill(T.memo);
  await page.waitForTimeout(400);
  await shotAround(page, "run-problem-note", [nodeEl(nid("c")), bar, page.locator('[data-id="run-pop"]')], 50);
  await note.press("Enter");
  await page.waitForFunction(
    (key) => document.querySelector('[data-id="run-action-bar"]')?.getAttribute("data-node") === key &&
      document.querySelector('[data-id="run-action-bar"]')?.getAttribute("data-status") === "problem",
    nid("c"),
  );
  await page.locator('[data-id="run-act-resolve"]').click();
  await page.waitForFunction(() => document.querySelector('[data-id="run-action-bar"]')?.getAttribute("data-status") === "active");
  await page.locator('[data-id="run-act-complete"]').click();
  await page.waitForFunction(
    (key) => document.querySelector('[data-id="run-action-bar"]')?.getAttribute("data-node") === key,
    nid("sp"),
  );

  // 4) 하위 맵 들어가 마지막 단계 완료 → 바깥 자동 완료 + 실행 끝
  await page.locator('[data-id="run-act-enter"]').click();
  const childKey = `${nid("sp")}/${nid("c1")}`;
  await nodeEl(childKey).waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  await fit();
  await nodeEl(childKey).click();
  await page.waitForFunction(
    (key) => document.querySelector('[data-id="run-action-bar"]')?.getAttribute("data-node") === key,
    childKey,
  );
  await page.locator('[data-id="run-act-complete"]').click();
  await page.locator('[data-id="run-bar"]').getByText(LANG === "ko" ? "실행 완료" : "Run complete").waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${LANG}-run-submap.png`, clip: { x: 0, y: 40, width: 1456, height: 400 } });
  console.log(`shot ${LANG}-run-submap`);

  // 5) 실행 범례(키보드 칸)
  await page.keyboard.press("Escape");
  await page.locator('[data-id="run-legend-toggle"]').click();
  await page.locator('[data-id="run-legend-keys"]').waitFor();
  await page.waitForTimeout(400);
  await shotAround(page, "run-legend", [page.locator('[data-id="run-legend-card"]'), page.locator('[data-id="run-legend-toggle"]')], 24);
  await page.locator('[data-id="run-legend-toggle"]').click();

  // 6) 모든 실행 창
  await page.locator('[data-id="run-menu"]').click();
  await page.locator('[data-id="run-menu-all"]').click();
  const modal = page.locator('[data-id="run-list-modal"]');
  await modal.locator('[data-id="run-list-rows"]').waitFor();
  await page.waitForTimeout(500);
  await shotAround(page, "run-list", [modal], 16);
  await page.locator('[data-id="run-list-close"]').click();

  // 7) 홈 — 진행 중 실행 타일을 펼친 목록
  await page.goto(BASE);
  await page.locator('[data-id="home-activity-runs"]').click();
  await page.locator('[data-id="home-run-list"]').waitFor();
  await page.waitForTimeout(600);
  await shotAround(page, "home-runs", [page.locator('[data-id="home-activity"]'), page.locator('[data-id="home-run-panel"]')], 16);

  // 8) 관리자 — 설정 › 실행, 매뉴얼(파일 동기화), 공지 파일에서 불러오기
  await page.goto(`${BASE}/settings`);
  await page.locator('[data-id="settings-tab-runs"]').click();
  await page.locator('[data-id="run-settings-panel"]').waitFor();
  await page.waitForTimeout(400);
  await shotAround(page, "admin-run-settings", [page.locator('[data-id="run-settings-panel"]')], 24);
  await page.locator('[data-id="settings-tab-manual"]').click();
  await page.locator('[data-id^="manual-doc-synced-"]').first().waitFor();
  await page.locator('[data-id="manual-docs-list"] button').filter({ has: page.locator('[data-id^="manual-doc-synced-"]') }).nth(LANG === "ko" ? 1 : 0).click();
  await page.locator('[data-id="manual-synced-hint"]').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${LANG}-admin-manual-synced.png`, clip: { x: 210, y: 50, width: 1246, height: 560 } });
  console.log(`shot ${LANG}-admin-manual-synced`);
  await page.locator('[data-id="settings-tab-notices"]').click();
  await page.getByRole("button", { name: T.newNotice }).click();
  await page.locator('[data-id="notice-load-draft"]').click();
  await page.locator('[data-id="notice-draft-list"] li').first().waitFor();
  await page.waitForTimeout(400);
  const noticeDialog = page.locator('[role="dialog"]', { has: page.locator('[data-id="notice-load-draft"]') });
  await noticeDialog.locator('[data-id="notice-load-draft"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shotAround(page, "admin-notice-load", [noticeDialog], 16);
  console.log(consoleErrors.length === 0 ? "no console errors" : `console errors: ${consoleErrors.slice(0, 3).join(" || ")}`);
} finally {
  if (browser !== null) await browser.close();
  await purgeSeedMaps();
}
