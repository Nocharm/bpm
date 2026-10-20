// 매뉴얼 10차 캡처(2026-10-20) — ① 저장 안 된 편집이 있을 때 앱 안 이동을 붙잡는 확인창(리뷰 W-1, 대화상자 둘레만 16:10),
// ② 설정 > 배치 작업의 HR 카드와 동기화 회차 이력(리뷰 H-3, 대량 퇴직 회차를 펼친 상태). 앱 전체 화면은 슬라이드 프레임에서 너무 작다.
// PNG·비교 PNG 옵션 창은 pw-png-export-word·pw-compare-png-export 캡처를 쓴다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 PW_LANG=ko|en node scripts/pw-manual-shots-10.mjs
//   산출물은 저장소 루트 .shots/manual10/<lang>-leave-guard.png · <lang>-batch-hr-history.png (gitignore). 시드 맵은 휴지통으로 보낸다.
//   ②는 hr_sync_runs에 회차가 있어야 찍힌다(로컬은 HR 미연결이라 비어 있다 — 없으면 건너뛴다). 대량 퇴직 회차가 있으면 그 행을 펼친다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=false, dev 유저 admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const LANG = process.env.PW_LANG ?? "ko";
const OUT = "../.shots/manual10";
const T = LANG === "ko"
  ? { map: "구매 요청 처리", a: "요청 접수", b: "예산 검토", renamed: "예산 검토 및 승인" }
  : { map: "Purchase request handling", a: "Receive request", b: "Budget review", renamed: "Budget review and approval" };

async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "X-Dev-User": "admin.sys", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const tag = Date.now().toString(36);
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === "admin.sys") ?? directory.users[0]).org_path;
const map = await api("POST", "/api/maps", { name: `${T.map} ${tag}`, owning_department: owning, visibility: "private" });
const draft = (await api("GET", `/api/maps/${map.id}`)).versions.find((v) => v.status === "draft");
await api("POST", `/api/versions/${draft.id}/checkout`, { force: true });
const id = (k) => `m10-${tag}-${k}`;
await api("PUT", `/api/versions/${draft.id}/graph`, {
  nodes: [
    { id: id("s"), title: "Start", node_type: "start", pos_x: 0, pos_y: 120 },
    { id: id("a"), title: T.a, node_type: "process", pos_x: 220, pos_y: 120 },
    { id: id("b"), title: T.b, node_type: "process", pos_x: 470, pos_y: 120 },
    { id: id("e"), title: "", node_type: "end", pos_x: 720, pos_y: 120 },
  ],
  edges: [
    { id: id("1"), source_node_id: id("s"), target_node_id: id("a"), label: "" },
    { id: id("2"), source_node_id: id("a"), target_node_id: id("b"), label: "" },
    { id: id("3"), source_node_id: id("b"), target_node_id: id("e"), label: "" },
  ],
  groups: [],
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((lang) => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", lang);
  }, LANG);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/maps/${map.id}?version=${draft.id}`, { waitUntil: "domcontentloaded" });
  const node = page.locator(`.react-flow__node[data-id="${id("b")}"]`);
  await node.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1200);
  await node.click();
  await page.keyboard.press("F2");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(T.renamed);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150); // 자동저장(2초) 전에 이동
  await page.locator('nav a[href="/"][aria-current="page"]').click();
  const dialog = page.locator('[data-id="editor-leave-confirm"]');
  await dialog.waitFor({ timeout: 5000 });
  await page.waitForTimeout(600); // 등장 모션이 끝난 뒤
  const box = await dialog.boundingBox();
  const width = Math.min(1440, Math.max(box.width + 120, 720));
  const height = Math.round((width * 10) / 16);
  const x = Math.max(0, Math.min(1440 - width, box.x + box.width / 2 - width / 2));
  const y = Math.max(0, Math.min(900 - height, box.y + box.height / 2 - height / 2));
  await page.screenshot({ path: `${OUT}/${LANG}-leave-guard.png`, clip: { x, y, width, height } });
  await page.locator('[data-id="confirm-dialog-cancel"]').click();
  console.log(`saved ${OUT}/${LANG}-leave-guard.png (${Math.round(width)}x${height})`);

  // ② 배치 작업 HR 카드
  const runs = await api("GET", "/api/admin/hr-sync-runs");
  if (runs.length === 0) {
    console.log("skip batch-hr-history: hr_sync_runs is empty");
  } else {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: LANG === "ko" ? "배치 작업" : "Batch jobs" }).first().click();
    const card = page.locator('[data-id="batch-run-hr_sync"]');
    await card.locator('[data-id="hr-sync-history-list"]').waitFor({ timeout: 30_000 });
    const mass = runs.find((run) => run.mass_departure);
    if (mass) {
      await page.locator(`[data-id="hr-sync-run-toggle-${mass.id}"]`).click();
      await page.waitForTimeout(800);
    }
    await card.screenshot({ path: `${OUT}/${LANG}-batch-hr-history.png` });
    console.log(`saved ${OUT}/${LANG}-batch-hr-history.png`);
  }
} finally {
  await browser.close();
  await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
}
