// L5 확정 요청 중 점유 검증 (리뷰 2026-10-19 E-1) — 체인 상위 관리자가 확정을 요청하면 그 에디터가 바로
// "Confirm requested" 읽기 전용이 되고(다음 폴에서 점유를 되가져가지 않는다), 철회하면 곧바로 다시 편집할 수 있는지 본다.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-verify-fw-confirm-checkout.mjs
//   산출물은 저장소 루트 .shots/fw-confirm-checkout-*.png (gitignore). 시드한 카테고리·캔버스는 끝에 지운다.
// 전제: 백엔드 DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys (아니면 모두가 sysadmin이라 요청 버튼이 없다).
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8048";
const ADMIN = "admin.sys";
const UPPER = "fwi.upper";
const DIRECT = "fwi.direct";
// 점유자 확인용 두 번째 체인 관리자 — 잠긴 점유는 가져가지 않고 보유자만 돌려받는다(대기 중엔 막혀서 부작용 없음)
const OBSERVER = "fwi.observer";
const OUT = "../.shots";
const LANG = process.env.PW_LANG ?? "ko";
// 다음 체크아웃 폴(10초)보다 훨씬 짧게 — 요청·철회 직후 다시 읽는지 본다
const PROMPT_MS = 4000;

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

// ---- 시드: L1(UPPER) → … → L5(DIRECT) + 연계 캔버스 ----
const tag = Date.now().toString(36);
let parent = null;
const chain = [];
for (let level = 1; level <= 5; level += 1) {
  const created = await api(ADMIN, "POST", "/api/categories", { name: `E1 ${tag} L${level}`, parent_id: parent });
  chain.push(created.id);
  parent = created.id;
}
await api(ADMIN, "PUT", `/api/categories/${chain[0]}/permissions`, {
  permissions: [{ principal_type: "user", principal_id: UPPER }, { principal_type: "user", principal_id: OBSERVER }],
});
await api(ADMIN, "PUT", `/api/categories/${chain[4]}/permissions`, { permissions: [{ principal_type: "user", principal_id: DIRECT }] });
const canvas = (await api(ADMIN, "POST", `/api/categories/${chain[4]}/linkage-map`)).map_id;
const draftId = (await api(ADMIN, "GET", `/api/maps/${canvas}`)).versions.find((v) => v.status === "draft").id;
const peekHolder = async () => (await api(OBSERVER, "POST", `/api/versions/${draftId}/checkout`, { force: false }));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([user, lang]) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", lang);
  }, [UPPER, LANG]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
  await page.goto(`${BASE}/maps/${canvas}`, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const notice = page.locator('[data-id="editor-readonly-notice"]');
  const pendingNotice = notice.filter({ hasText: "Confirm requested" });
  // L5 캔버스 draft는 편집 중에도 "Draft" 배너가 상시라 배너 유무가 아니라 점유자로 본다
  const opened = await peekHolder();
  check("chain admin starts editing", opened.checked_out_by === UPPER && (await pendingNotice.count()) === 0,
    `holder=${opened.checked_out_by}`);
  await page.screenshot({ path: `${OUT}/fw-confirm-checkout-open-${LANG}.png` });

  await page.locator(`button[aria-label="${LANG === "ko" ? "승인" : "Approval"}"]`).first().click();
  const requestBtn = page.locator('[data-id="framework-request-confirm"]');
  await requestBtn.waitFor({ timeout: 15_000 }).catch(async (err) => {
    await page.screenshot({ path: `${OUT}/fw-confirm-checkout-error-${LANG}.png` });
    throw err;
  });
  const startedAt = Date.now();
  await requestBtn.click();
  await pendingNotice.waitFor({ timeout: PROMPT_MS });
  check("request turns the editor read-only right away", true, `${Date.now() - startedAt}ms`);
  await page.screenshot({ path: `${OUT}/fw-confirm-checkout-pending-${LANG}.png` });

  // 다음 폴이 지나도 점유를 되가져가지 않는다
  await page.waitForTimeout(11_000);
  const during = await peekHolder();
  check("requester poll does not take the checkout back", during.checked_out_by === null && during.confirm_pending === true,
    `holder=${during.checked_out_by}`);
  check("notice stays after the poll", (await pendingNotice.count()) === 1);

  // 결정권자는 대기 중에도 점유할 수 있다(API)
  const direct = await api(DIRECT, "POST", `/api/versions/${draftId}/checkout`, { force: false });
  check("direct L5 admin can take the checkout while pending", direct.mine === true);
  await api(DIRECT, "DELETE", `/api/versions/${draftId}/checkout`);

  const withdrawAt = Date.now();
  await page.locator('[data-id="framework-request-withdraw"]').click();
  await pendingNotice.waitFor({ state: "detached", timeout: PROMPT_MS });
  const back = await peekHolder();
  check("withdraw makes the editor editable right away", back.checked_out_by === UPPER,
    `${Date.now() - withdrawAt}ms holder=${back.checked_out_by}`);
  await page.screenshot({ path: `${OUT}/fw-confirm-checkout-withdrawn-${LANG}.png` });
} finally {
  await browser.close();
  // 정리 — 캔버스를 휴지통 → 영구삭제한 뒤 카테고리 서브트리 삭제(영구삭제가 L5 포인터를 비워야 지워진다, E-3)
  // 남은 요청을 먼저 거둔다 — sqlite는 영구삭제된 맵의 요청을 지우지 않고 id를 재사용해 다음 캔버스에 붙는다
  await api(UPPER, "DELETE", `/api/maps/${canvas}/fw-confirm-requests/pending`).catch(() => undefined);
  await api(ADMIN, "DELETE", `/api/maps/${canvas}`).catch((e) => console.log("cleanup", String(e)));
  await api(ADMIN, "DELETE", `/api/maps/${canvas}/permanent`).catch((e) => console.log("cleanup", String(e)));
  try {
    await api(ADMIN, "DELETE", `/api/categories/${chain[0]}`);
    check("cleanup: purged canvas no longer blocks deleting its L5", true);
  } catch (e) {
    check("cleanup: purged canvas no longer blocks deleting its L5", false, String(e).slice(0, 160));
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
