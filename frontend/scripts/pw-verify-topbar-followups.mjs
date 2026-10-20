// 에디터 상단 바 잔여 화면 검증 (리뷰 2026-10-19 7d) — 에디터에서 승인을 요청한 뒤 오너 본인에게 "<본인> 편집 중 - 읽기 전용"이
// 남지 않는지(W-9), 반려본의 반려 사유 칩이 좁은 폭에서 저장 버튼을 화면 밖으로 밀지 않는지(W-11, 900·1060·1280px).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-topbar-followups.mjs
//   산출물은 저장소 루트 .shots/topbar-*.png (gitignore). 시드 맵은 휴지통으로 보낸다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys, 디렉터리에 admin.sys 외 활성 직원 1명 이상.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const OUT = "../.shots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
async function api(user, method, path, body) {
  const r = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "X-Dev-User": user, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const tag = Date.now().toString(36);
const directory = await api(ADMIN, "GET", "/api/directory");
const owning = (directory.users.find((u) => u.id === ADMIN) ?? directory.users[0]).org_path;
const APPROVER = directory.users.find((u) => u.id !== ADMIN)?.id;
const cleanup = [];
async function newMap(name) {
  const map = await api(ADMIN, "POST", "/api/maps", { name, owning_department: owning, visibility: "private" });
  cleanup.push(map.id);
  const draft = (await api(ADMIN, "GET", `/api/maps/${map.id}`)).versions.find((v) => v.status === "draft").id;
  await api(ADMIN, "PUT", `/api/maps/${map.id}/approvers`, { user_ids: [APPROVER] });
  await api(ADMIN, "POST", `/api/versions/${draft}/checkout`, { force: true });
  await api(ADMIN, "PUT", `/api/versions/${draft}/graph`, {
    nodes: [
      { id: `s${tag}${map.id}`, title: "Start", node_type: "start", pos_x: 0, pos_y: 0 },
      { id: `t${tag}${map.id}`, title: "작업", node_type: "process", pos_x: 220, pos_y: 0 },
      { id: `e${tag}${map.id}`, title: "", node_type: "end", pos_x: 440, pos_y: 0 },
    ],
    edges: [
      { id: `1${tag}${map.id}`, source_node_id: `s${tag}${map.id}`, target_node_id: `t${tag}${map.id}`, label: "" },
      { id: `2${tag}${map.id}`, source_node_id: `t${tag}${map.id}`, target_node_id: `e${tag}${map.id}`, label: "" },
    ],
    groups: [],
  });
  return { id: map.id, draft };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function pageAt(width, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([u, l]) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", l);
  }, [ADMIN, lang]);
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR", String(err).slice(0, 200)));
  return page;
}

try {
  // ── W-9 에디터에서 승인 요청 → 점유 표시가 남지 않는다 ───────────────
  const sub = await newMap(`Topbar submit ${tag}`);
  const page = await pageAt(1440, "en");
  await page.goto(`${BASE}/maps/${sub.id}?version=${sub.draft}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120_000 });
  await sleep(1500);
  await page.locator('button[aria-label="Approval"]').first().click();
  await page.getByRole("button", { name: "Submit for approval" }).first().click();
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await page.getByText("Pending approval").first().waitFor({ timeout: 15_000 });
  await sleep(800);
  const header = await page.locator("header").filter({ has: page.locator('[data-id="editor-save"]') }).innerText();
  check("after submitting, the owner is not told someone is editing", !header.includes("is editing - read only"), header.replace(/\s+/g, " ").slice(0, 160));
  check("after submitting, the stale Editing badge is gone", !/\bEditing\b/.test(header));
  await page.screenshot({ path: `${OUT}/topbar-after-submit.png`, clip: { x: 0, y: 0, width: 1440, height: 140 } });
  await page.context().close();

  // ── W-11 반려본 상단 바 — 저장 버튼이 항상 화면 안 ───────────────────
  const rej = await newMap(`Topbar rejected ${tag}`);
  await api(ADMIN, "POST", `/api/versions/${rej.draft}/submit`, {});
  await api(APPROVER, "POST", `/api/versions/${rej.draft}/reject`, { reason: "Needs revision before release - the approval step is missing a reviewer and the cost line is blank" });
  await api(ADMIN, "POST", `/api/versions/${rej.draft}/checkout`, { force: true });
  for (const lang of ["en", "ko"]) {
    for (const width of [900, 1060, 1280]) {
      const p = await pageAt(width, lang);
      await p.goto(`${BASE}/maps/${rej.id}?version=${rej.draft}`, { waitUntil: "domcontentloaded" });
      await p.locator('[data-id="wf-rejected-banner"]').waitFor({ timeout: 120_000 });
      await sleep(800);
      const fit = await p.evaluate(() => {
        const save = document.querySelector('[data-id="editor-save"]')?.getBoundingClientRect();
        return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, saveRight: save ? save.right : null };
      });
      check(`${lang} ${width}px: Save stays on screen and the page does not scroll sideways`,
        fit.scroll <= fit.client && fit.saveRight !== null && fit.saveRight <= fit.client, JSON.stringify(fit));
      if (width === 900 || width === 1280) {
        await p.screenshot({ path: `${OUT}/topbar-rejected-${lang}-${width}.png`, clip: { x: 0, y: 0, width, height: 140 } });
      }
      await p.context().close();
    }
  }
} finally {
  await browser.close();
  for (const id of cleanup) await api(ADMIN, "DELETE", `/api/maps/${id}`).catch(() => undefined);
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
