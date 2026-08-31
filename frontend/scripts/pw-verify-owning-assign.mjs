// 항목 17 확인 — 상세 카드의 "오우닝 부서 미지정" 필을 눌러 부서를 지정한다(오너/시스템 관리자 전용).
// 맵 카드(좌측 목록)의 태그는 클릭 대상이 아니라 그대로 둔다.
// 후속: 피커 목록이 모달 위에 뜨는지(z), 행 클릭은 선택까지만이고 Confirm에서만 저장되는지 함께 검증.
// 실행(frontend/): BASE_URL=http://localhost:3100 SHOT_DIR=/tmp/shots node scripts/pw-verify-owning-assign.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-owning";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = (page, name) => page.screenshot({ path: `${SHOT_DIR}/${name}.png` });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => window.localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// 오우닝 미지정 + 내가 오너인 맵을 하나 만든다(시드에 없을 수 있어 확실히 확보)
const target = await page.evaluate(async () => {
  const list = await (await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } })).json();
  const maps = Array.isArray(list) ? list : (list.maps ?? []);
  const found = maps.find(
    (m) => m.my_role === "owner" && m.mode !== "framework" && !m.owning_department,
  );
  return found ? { id: found.id, name: found.name } : null;
});
check("오우닝 미지정 소유 맵 확보", target !== null, JSON.stringify(target));
if (!target) process.exit(1);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);

// 좌측 맵 카드의 태그는 그대로(비클릭) — 상세 카드의 필만 버튼이어야 한다
const cardTag = page.locator('[data-id="map-card-owning-missing"]').first();
if (await cardTag.count()) {
  const tagName = await cardTag.evaluate((el) => el.tagName.toLowerCase());
  check("[17] 맵 카드 태그는 그대로(button 아님)", tagName !== "button", `tag=${tagName}`);
}

// 상세 카드 열기
const card = page.locator('[data-id="map-card-name"]', { hasText: target.name }).first();
await card.scrollIntoViewIfNeeded().catch(() => {});
await card.click({ timeout: 8000 });
await page.waitForTimeout(1600);

// 상세 카드는 목록/사이드 등 여러 인스턴스가 마운트될 수 있다 — 실제로 보이는 것만 고른다
const pillCandidates = page.locator('[data-id="map-detail-owning-missing"]');
const pillCount = await pillCandidates.count();
let pill = pillCandidates.first();
for (let i = 0; i < pillCount; i++) {
  if (await pillCandidates.nth(i).isVisible().catch(() => false)) {
    pill = pillCandidates.nth(i);
    break;
  }
}
await pill.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(300);
check("[17] 상세 카드에 미지정 필 노출", (await pill.count()) > 0);
const pillTag = await pill.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
check("[17] 상세 필은 클릭 가능(button)", pillTag === "button", `tag=${pillTag}`);

// 권한(역할) 필 오른쪽에 있는지 — 같은 줄에서 role 필보다 x가 크다
const roleBox = await page.locator('[data-id="map-detail-role"]').first().boundingBox().catch(() => null);
const pillBox = await pill.boundingBox();
if (roleBox && pillBox) {
  check("[17] 권한 필 오른쪽 배치", pillBox.x > roleBox.x, `role=${Math.round(roleBox.x)} pill=${Math.round(pillBox.x)}`);
}
await shot(page, "17-owning-missing-pill");

await pill.click();
const modal = page.locator('[data-id="owning-dept-modal"]');
await modal.waitFor({ state: "visible", timeout: 8000 });
check("[17] 클릭 시 오우닝 지정 모달", true);
await page.waitForTimeout(800);
await shot(page, "17-owning-modal");

// 선택 전엔 Confirm 비활성 — 오지정 즉시 저장을 막는 게이트
const confirmBtn = modal.locator('[data-id="owning-dept-confirm"]');
check("[17] 선택 전 Confirm 비활성", await confirmBtn.isDisabled(), "");

// 피커 목록은 모달 위에 떠야 한다 — 좌표 히트테스트로 backdrop에 가려지지 않았음을 확인
const input = modal.locator("input").first();
await input.click();
await page.waitForTimeout(900);
const dropdown = page.locator('[data-id="principal-picker-dropdown"]').first();
await dropdown.waitFor({ state: "visible", timeout: 5000 });
const ddBox = await dropdown.boundingBox();
const onTop = await page.evaluate(
  ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-id="principal-picker-dropdown"]'),
  { x: ddBox.x + ddBox.width / 2, y: ddBox.y + 12 },
);
check("[17] 피커 목록이 모달 위에 보임", onTop, `box=${Math.round(ddBox.width)}x${Math.round(ddBox.height)}`);
await shot(page, "17-owning-picker-open");

// 행 클릭 = 선택까지만 — 서버는 아직 그대로여야 한다
const row = dropdown.locator("button").first();
const rowLabel = (await row.innerText()).trim();
await row.click({ timeout: 5000 });
await page.waitForTimeout(1200);
const afterPick = await page.evaluate(
  async (id) =>
    (await (await fetch(`/api/maps/${id}`, { headers: { "X-Dev-User": "admin.sys" } })).json())
      .owning_department,
  target.id,
);
check("[17] 행 클릭만으로는 저장 안 됨", !afterPick, `owning=${afterPick} row=${rowLabel}`);
const selectedRow = modal.locator('[data-id="owning-dept-selected"]');
check("[17] 선택한 부서가 모달에 표시", await selectedRow.isVisible(), (await selectedRow.innerText().catch(() => "")).trim());
check("[17] 선택 후 Confirm 활성", await confirmBtn.isEnabled(), "");
await shot(page, "17-owning-picked");

// Confirm에서만 확정 저장
await confirmBtn.click();
await page.waitForTimeout(2000);
const assigned = await page.evaluate(
  async (id) =>
    (await (await fetch(`/api/maps/${id}`, { headers: { "X-Dev-User": "admin.sys" } })).json())
      .owning_department,
  target.id,
);
check("[17] Confirm 후 서버에 저장됨", !!assigned, `owning=${assigned}`);
check("[17] 저장 후 모달 닫힘", (await modal.count()) === 0 || !(await modal.isVisible()));
const nowPill = await page.locator('[data-id="map-detail-owning-dept"]').count();
check("[17] 카드가 부서 필로 전환", nowPill > 0, `deptPill=${nowPill}`);
await shot(page, "17-owning-assigned");

check("페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`shots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
