// 2026-08-31 후속 3종 확인 — [9] 지정 설명=맵 설명 일원화 · [10] SP 상세 모달 노트 섹션 ·
// [11] 슬롯 해제/변경 파급효과 게이트.
// 전제: backend(8100)+frontend(3100) + pw-smoke-framework-canvas.mjs 시드 완료.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3100 SHOT_DIR=/tmp/shots node scripts/pw-verify-slot-notes-desc.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-slot";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${SHOT_DIR}/${name}.png` });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// ── [9] 지정 설명이 맵 description에 쓰인다(왕복) ────────────────────────────
const desc = `지정설명 ${Date.now() % 100000}`;
const api = await page.evaluate(async (text) => {
  const list = await (await fetch("/api/maps")).json();
  const maps = Array.isArray(list) ? list : (list.maps ?? []);
  const target = maps.find((m) => m.category_id != null && m.mode !== "framework");
  if (!target) return { error: "no framework-slot map" };
  const before = await (await fetch(`/api/maps/${target.id}`)).json();
  const body = {
    // department는 min_length=1 — 시드 값이 비어 있으면 임의값으로 채운다(이 검증의 관심사가 아님)
    department: before.sp_department || "품질관리",
    assignee: before.sp_assignee ?? "",
    system: before.sp_system ?? "",
    duration: before.sp_duration ?? "",
    cost_krw: before.sp_cost_krw ?? "",
    cost_usd: before.sp_cost_usd ?? "",
    headcount: before.sp_headcount ?? "",
    touch_time: before.sp_touch_time ?? "",
    url: before.sp_url ?? "",
    url_label: before.sp_url_label ?? "",
    description: text,
  };
  const res = await fetch(`/api/maps/${target.id}/subprocess-designation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const after = await (await fetch(`/api/maps/${target.id}`)).json();
  return {
    status: res.status,
    mapId: target.id,
    description: after.description,
    hasLegacyField: Object.prototype.hasOwnProperty.call(after, "sp_description"),
  };
}, desc);
check("[9] 지정 설명 저장이 맵 description에 반영", api.description === desc, `status=${api.status} desc=${api.description}`);
check("[9] 응답에서 sp_description 필드 제거됨", api.hasLegacyField === false, `hasLegacyField=${api.hasLegacyField}`);

// ── [10] SP 더블클릭 상세 모달의 노트 섹션 ──────────────────────────────────
const canvasId = await page.evaluate(async () => {
  const list = await (await fetch("/api/maps")).json();
  const maps = Array.isArray(list) ? list : (list.maps ?? []);
  return maps.find((m) => m.mode === "framework")?.id ?? null;
});
await page.goto(`${BASE}/maps/${canvasId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node", { timeout: 20000 });
await page.waitForTimeout(1200);

// 노트가 있는 링크맵을 가리키는 SP 노드를 찾는다
const body = page.locator('[data-id="node-summary-body"]');
const closeModal = async () => {
  if (await body.count()) {
    await page.keyboard.press("Escape");
    await body.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
};
const total = await page.locator(".react-flow__node").count();
let opened = false;
for (let i = 0; i < total && !opened; i++) {
  await closeModal();
  await page.locator(".react-flow__node").nth(i).dblclick();
  await body.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const notes = page.locator('[data-id="map-notes-section"]');
  if (await notes.count()) {
    opened = true;
    const toggle = page.locator('[data-id="map-notes-toggle"]');
    const expandedBefore = await toggle.getAttribute("aria-expanded");
    check("[10] 노트 섹션 기본 접힘", expandedBefore === "false", `aria-expanded=${expandedBefore}`);
    await shot(page, "10-sp-modal-notes-collapsed");
    await toggle.click();
    await page.waitForTimeout(300);
    const expandedAfter = await toggle.getAttribute("aria-expanded");
    check("[10] 노트 섹션 펼침 동작", expandedAfter === "true", `aria-expanded=${expandedAfter}`);
    await shot(page, "10-sp-modal-notes-expanded");
  }
}
if (!opened) check("[10] SP 상세 모달 노트 섹션", false, "노트 있는 링크맵 노드를 못 찾음");
await closeModal();

// ── [11] 슬롯 해제·변경 게이트 ──────────────────────────────────────────────
// 검증 대상은 게이트다 — 대상 맵은 "홈 목록에 실제로 보이는 카드"에서 고른 뒤 API로 L5를 붙인다.
// (슬롯 보유 맵을 UI만으로 찾아가면 시드/필터에 따라 흔들린다)
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const visibleName = await page
  .locator('[data-id="map-card-name"]')
  .first()
  .innerText()
  .catch(() => null);

const prepared = await page.evaluate(async (name) => {
  if (!name) return null;
  const list = await (await fetch("/api/maps")).json();
  const maps = Array.isArray(list) ? list : (list.maps ?? []);
  const target = maps.find(
    (m) => m.name === name && m.my_role === "owner" && m.mode !== "framework",
  );
  if (!target) return null;
  const cats = await (await fetch("/api/categories/nodes")).json();
  // L5까지 내려간다 — 첫 자식을 따라가며 level 5를 찾는다
  let node = cats[0];
  for (let i = 0; i < 6 && node && node.level < 5; i++) {
    const kids = await (await fetch(`/api/categories/nodes?parent_id=${node.id}`)).json();
    node = kids[0];
  }
  if (!node || node.level !== 5) return null;
  const res = await fetch(`/api/maps/${target.id}/category`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category_id: node.id }),
  });
  return { mapId: target.id, name: target.name, categoryId: node.id, status: res.status };
}, visibleName);
check("[11] 준비: 소유 맵에 L5 슬롯 연결", prepared?.status === 200, JSON.stringify(prepared));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
let modalUp = false;
if (prepared) {
  const mapName = prepared.name;
  // 맵 카드 이름 클릭 = 상세 카드 열기
  const card = page.locator('[data-id="map-card-name"]', { hasText: mapName }).first();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1400);
    // 연결 필과 미연결 유령 필이 같은 data-id라 여러 카드가 펼쳐져 있으면 엉뚱한 것을 누를 수 있다 —
    // 해제 버튼이 있는 모달이 뜰 때까지 후보를 차례로 시도한다.
    const pills = page.locator('[data-id="map-detail-category"]');
    const pillCount = await pills.count();
    for (let k = 0; k < pillCount && !modalUp; k++) {
      const pill = pills.nth(k);
      await pill.scrollIntoViewIfNeeded().catch(() => {});
      await pill.click({ timeout: 5000 }).catch(() => {});
      const up = await page
        .locator('[data-id="framework-assign-modal"]')
        .waitFor({ state: "visible", timeout: 6000 })
        .then(() => true)
        .catch(() => false);
      if (up && (await page.locator('[data-id="framework-unassign-btn"]').count())) {
        modalUp = true;
      } else if (up) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
    }
  }
}
{
  check("[11] 체계 연결 모달 오픈(슬롯 보유 맵)", modalUp);
  if (modalUp) {
    const unassign = page.locator('[data-id="framework-unassign-btn"]');
    if (await unassign.count()) {
      await unassign.click();
      const gate = page.locator('[data-id="framework-slot-gate"]');
      const gateUp = await gate.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
      check("[11] 해제 클릭이 즉시 실행되지 않고 게이트로 막힌다", gateUp);
      await page.waitForTimeout(700); // 참조 수 조회 대기
      await shot(page, "11-slot-unassign-gate");
      // 참조 줄은 "이 맵을 SP로 링크한 맵이 있을 때만" 뜬다 — 실제 참조 수와 렌더 여부가 일치해야 한다
      const refCount = await page.evaluate(async (id) => {
        const u = await (await fetch(`/api/maps/${id}/subprocess-usage`)).json();
        return (u.used_by?.length ?? 0) + (u.hidden_count ?? 0);
      }, prepared.mapId);
      const refsRow = await page.locator('[data-id="framework-gate-refs"]').count();
      check(
        "[11] 참조 맵 수 안내가 실제 참조 유무와 일치",
        (refCount > 0 ? 1 : 0) === (refsRow > 0 ? 1 : 0),
        `refs=${refCount} row=${refsRow}`,
      );
      // 취소하면 원래 버튼으로 복귀 — 실제 해제는 하지 않는다(시드 보존)
      await page.locator('[data-id="framework-gate-cancel"]').click();
      await page.waitForTimeout(300);
      const backToButtons = await page.locator('[data-id="framework-unassign-btn"]').isVisible();
      check("[11] 취소 시 원상복귀(해제 미실행)", backToButtons);
    }
  }
}

check("페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`shots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
