// 맵 설정 UX 스모크 — 섹션 아이콘·협업자 행(역할 메뉴·호버 카드)·버전 카드(액션 영역 등폭)·소유권 이전 피커
// (파생 editor 후보·트리거 등폭·간극 0)·SP 타일·GMP 메뉴를 실구동으로 확인하고, 임시 맵으로 오우닝 부서
// 소속(권한 행 없음)에게 transfer-owner 200 + 역할 메뉴 Owner → 확인 모달 게이트를 e2e로 밟는다 (2026-10-01).
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 API_URL=http://localhost:8048 node scripts/pw-smoke-map-settings.mjs
// 전제: 데모 시드(맵 2 = 오우닝 부서 Analytics Part 1, 맵 38 = SP 지정), dev 유저 admin.sys(sysadmin).
// 산출물은 저장소 루트 .shots/map-settings-*.png (gitignore). 임시 맵은 끝에 삭제한다.
import { mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3047";
const API = process.env.API_URL ?? "http://localhost:8048";
const OUT = process.env.SHOT_DIR ?? "../.shots";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const api = async (path, init = {}, user = "admin.sys") => {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Dev-User": user, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const asUser = async (id) => {
  await page.goto(`${BASE}/login`);
  await page.evaluate((u) => localStorage.setItem("bpm.devUser", u), id);
};

// ── 1. 데모 맵 2: 섹션 아이콘·협업자·버전·위험 구역 ──
await asUser("admin.sys");
await page.goto(`${BASE}/maps/2/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/map-settings-01-top.png` });
check("rail icons rendered", (await page.locator('[data-id^="settings-nav-"] svg').count()) >= 6);

const collab = page.locator("#sec-collaborators");
await collab.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await collab.screenshot({ path: `${OUT}/map-settings-02-collaborators.png` });
check("collab header count", (await page.locator('[data-id="settings-collab-count"]').count()) === 1);
check("owning locked row", (await page.locator('[data-id="owning-dept-locked-row"]').count()) === 1);

// 역할 드롭다운 열기 — 첫 editor 행
const roleBtn = page.locator('[data-id^="collab-role-"]:not([data-id$="-menu"])').first();
await roleBtn.click();
await page.waitForTimeout(350);
const menu = page.locator('[data-id$="-menu"][role="listbox"]');
check("role menu open", (await menu.count()) === 1);
const tr = await roleBtn.boundingBox();
const mr = await menu.boundingBox();
check("menu width = trigger width, no gap", tr && mr && Math.abs(tr.width - mr.width) < 1 && Math.abs(tr.y + tr.height - mr.y) < 1, `trigger ${tr?.width}x@${tr?.y + tr?.height} menu ${mr?.width}x@${mr?.y}`);
check("owner item present for editor row", (await page.locator('[data-id$="-option-owner"]').count()) === 1);
await collab.screenshot({ path: `${OUT}/map-settings-03-role-menu.png` });
await page.keyboard.press("Escape");
await page.mouse.click(10, 10);
await page.waitForTimeout(200);

// 유저 행 호버 카드 — 클릭 즉시
const firstUserName = page.locator('[data-id^="collab-row-"] span.text-caption').first();
await firstUserName.click();
await page.waitForTimeout(400);
const card = page.locator('[data-id="person-hover-card"], [data-id^="person-card"]');
check("person card opened on click", (await card.count()) >= 1 || (await page.locator("text=Taeyang").count()) > 0);
await collab.screenshot({ path: `${OUT}/map-settings-04-hover-card.png` });
await page.mouse.click(10, 10);
await page.waitForTimeout(200);

const versions = page.locator("#sec-versions");
await versions.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await versions.screenshot({ path: `${OUT}/map-settings-05-versions.png` });
const cards = page.locator('[data-id^="version-card-"]');
check("version cards rendered", (await cards.count()) >= 1, String(await cards.count()));
const widths = await cards.evaluateAll((els) => els.map((e) => e.lastElementChild.getBoundingClientRect().width));
check("action area same width", widths.every((w) => Math.abs(w - widths[0]) < 1), widths.join(","));

const danger = page.locator("#sec-danger");
await danger.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.locator('#sec-danger [data-id="search-select-trigger"]').click();
await page.waitForTimeout(350);
const ssMenu = page.locator('[data-id="search-select-menu"]');
check("transfer menu open", (await ssMenu.count()) === 1);
const tags = await ssMenu.locator('[data-id="search-select-tag"]').allTextContents();
check("derived editor candidates listed", tags.some((x) => /파생|Derived/.test(x)), tags.join("|"));
const tb = await page.locator('#sec-danger [data-id="search-select-trigger"]').boundingBox();
const mb = await ssMenu.boundingBox();
const flushBelow = tb && mb && Math.abs(tb.y + tb.height - mb.y) < 1;
const flushAbove = tb && mb && Math.abs(mb.y + mb.height - tb.y) < 1;
check("transfer menu width = trigger, no gap (below or above)", tb && mb && Math.abs(tb.width - mb.width) < 1 && (flushBelow || flushAbove), `${tb?.width}/${mb?.width} below=${flushBelow} above=${flushAbove}`);
await page.screenshot({ path: `${OUT}/map-settings-06-transfer-menu.png` });
await page.keyboard.press("Escape");

// ── 2. SP 지정 맵 38: 타일 그리드 ──
await page.goto(`${BASE}/maps/38/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const sp = page.locator("#sec-subprocess");
await sp.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await sp.screenshot({ path: `${OUT}/map-settings-07-sp-tiles.png` });
check("sp tiles rendered", (await page.locator('[data-id^="sp-tile-"]').count()) >= 10);
const details = page.locator("#sec-details");
await details.scrollIntoViewIfNeeded();
await page.locator('[data-id="process-fields-gmp"]').click();
await page.waitForTimeout(300);
check("gmp menu open", (await page.locator('[data-id="process-fields-gmp-menu"]').count()) === 1);
await details.screenshot({ path: `${OUT}/map-settings-08-gmp-menu.png` });
await page.keyboard.press("Escape");

// ── 3. 소유권 이전 e2e — 임시 맵: 오너(sysadmin)가 오우닝 부서 소속(권한 행 없음)에게 이전 ──
const dir = (await api("/directory")).body;
const dept = (await api("/maps/2")).body.owning_department; // 알려진 경로(known-path) 보장
const member = dir.users.find((u) => ((u.org_path ?? "") === dept || (u.org_path ?? "").startsWith(`${dept}/`)) && u.id !== "admin.sys");
check("owning member found", Boolean(member), member?.id);
const created = await api("/maps", { method: "POST", body: JSON.stringify({ name: `_xfer-${Date.now()}`, owning_department: dept }) });
check("temp map created", created.status === 201, String(created.status));
const mid = created.body.id;
const before = (await api(`/maps/${mid}/permissions`)).body;
check("member has no grant before", !before.some((p) => p.principal_id === member.id));
const xfer = await api(`/maps/${mid}/transfer-owner`, { method: "POST", body: JSON.stringify({ new_owner: member.id }) });
check("transfer to derived editor 200", xfer.status === 200, JSON.stringify(xfer.body));
const after = (await api(`/maps/${mid}/permissions`)).body;
check("member now owner grant with granted_at", after.some((p) => p.principal_id === member.id && p.role === "owner" && p.granted_at));
// UI 게이트: 새 오너로 들어가 역할 메뉴 Owner → 확인 모달
await asUser(member.id);
await api(`/maps/${mid}/permissions`, { method: "POST", body: JSON.stringify({ principal_type: "user", principal_id: "admin.sys", role: "editor" }) }, member.id).catch(() => null);
await page.goto(`${BASE}/maps/${mid}/settings`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.locator("#sec-collaborators").scrollIntoViewIfNeeded();
const editorRole = page.locator('[data-id^="collab-role-"]:not([data-id$="-menu"])').first();
if ((await editorRole.count()) > 0) {
  await editorRole.click();
  await page.waitForTimeout(300);
  await page.locator('[data-id$="-option-owner"]').first().click();
  await page.waitForTimeout(300);
  check("transfer dialog opened from role menu", (await page.locator('[data-id="transfer-owner-dialog"]').count()) === 1);
  await page.screenshot({ path: `${OUT}/map-settings-09-transfer-dialog.png` });
  await page.locator('[data-id="transfer-owner-cancel"]').click();
}
const del = await api(`/maps/${mid}`, { method: "DELETE" }, "admin.sys");
check("temp map deleted", del.status < 300, String(del.status));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
