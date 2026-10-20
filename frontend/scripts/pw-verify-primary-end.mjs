// 대표 끝 직접 고르기 화면 검증 (리뷰 2026-10-19 F-3, 사용자 결정 2026-10-20) — 끝이 둘인데 대표가 없으면 저장 체크리스트가
// 막고, 대표 토글은 하나만 켜지며(다른 끝은 꺼짐), 대표를 고르면 체크리스트가 통과한다. 서버는 대신 고르지 않는다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-primary-end.mjs
//   산출물은 저장소 루트 .shots/primary-end-*.png (gitignore). 시드 맵은 휴지통으로 보낸다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const LANG = process.env.PW_LANG ?? "ko";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "X-Dev-User": ADMIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const tag = Date.now().toString(36);
const directory = await api("GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0]).org_path;
const map = await api("POST", "/api/maps", { name: `Primary end ${tag}`, owning_department: owning, visibility: "private" });
const draft = (await api("GET", `/api/maps/${map.id}`)).versions.find((v) => v.status === "draft").id;
await api("POST", `/api/versions/${draft}/checkout`, { force: true });
const OK = `ok${tag}`;
const NO = `no${tag}`;
const n = (id, title, node_type, x, y = 0) => ({ id, title, node_type, pos_x: x, pos_y: y });
const e = (id, s, t, label = "") => ({ id, source_node_id: s, target_node_id: t, label });
await api("PUT", `/api/versions/${draft}/graph`, {
  nodes: [n(`s${tag}`, "Start", "start", 0), n(`d${tag}`, "검토", "decision", 240), n(OK, "승인", "end", 480, -80), n(NO, "반려", "end", 480, 80)],
  edges: [e(`1${tag}`, `s${tag}`, `d${tag}`), e(`2${tag}`, `d${tag}`, OK, "예"), e(`3${tag}`, `d${tag}`, NO, "아니오")],
  groups: [],
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([u, lang]) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", lang);
  }, [ADMIN, LANG]);
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR", String(err).slice(0, 200)));
  await page.goto(`${BASE}/maps/${map.id}?version=${draft}`, { waitUntil: "domcontentloaded" });
  await page.locator(`.react-flow__node[data-id="${OK}"]`).waitFor({ timeout: 120_000 });
  await sleep(800);
  const checkOk = () => page.locator('[data-id="save-check-primaryEnd"]').getAttribute("data-ok");

  check("two ends with no primary fail the checklist", (await checkOk()) === "false");
  check("the server did not pick one", !(await api("GET", `/api/versions/${draft}/graph`)).nodes.some((x) => x.is_primary_end));
  await page.locator('[data-id="save-checklist-toggle"]').click();
  await sleep(500);
  const chip = await page.locator('[data-id="save-check-primaryEnd"]').locator("xpath=ancestor::div[1]").boundingBox();
  await page.screenshot({
    path: `${OUT}/primary-end-checklist.png`,
    clip: { x: chip.x - 24, y: chip.y - 60, width: chip.width + 48, height: chip.height + 84 },
  });
  await page.locator('[data-id="save-checklist-toggle"]').click();

  const toggle = page.locator('button[role="switch"][aria-label="Primary end"]');
  await page.locator(`.react-flow__node[data-id="${OK}"]`).click();
  await toggle.click();
  await sleep(300);
  check("turning one end on passes the checklist", (await checkOk()) === "true");
  await page.locator(`.react-flow__node[data-id="${NO}"]`).click();
  await toggle.click();
  await sleep(3500); // 자동저장(2초) 뒤
  const saved = (await api("GET", `/api/versions/${draft}/graph`)).nodes.filter((x) => x.node_type === "end");
  const primaries = saved.filter((x) => x.is_primary_end).map((x) => x.title);
  check("the toggle is single-select: switching ends keeps exactly one primary", JSON.stringify(primaries) === JSON.stringify(["반려"]), JSON.stringify(primaries));
  await page.locator(`.react-flow__node[data-id="${OK}"]`).click();
  await sleep(300);
  check("the other end shows its toggle off", (await toggle.getAttribute("aria-checked")) === "false");
  await page.screenshot({ path: `${OUT}/primary-end-toggle.png`, clip: { x: 760, y: 60, width: 680, height: 520 } });
  await toggle.click(); // 다시 승인을 대표로 — 반려는 꺼진다
  await sleep(300);
  await page.locator(`.react-flow__node[data-id="${NO}"]`).click();
  await sleep(300);
  check("turning the first end back on turns the second off", (await toggle.getAttribute("aria-checked")) === "false");
} finally {
  await browser.close();
  await api("DELETE", `/api/maps/${map.id}`).catch(() => undefined);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
