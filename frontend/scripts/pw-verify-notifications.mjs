// 알림 플로우 검증 — 벨 딥링크/개별삭제, 알림탭 카테고리 필·선택/읽음/날짜 삭제, 관리자 기간 퍼지.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-verify-notifications.mjs
// 전제: backend(:8000, 기본 설정 — auth off·dev_enforce_permissions off라 devUser 전원 sysadmin) + 프론트(:3000).
// DB는 reset_db+seed_org_demo 직후(notifications 테이블 빈 상태) 가정 — 재실행 전 재시드 권장(본 스크립트가 순차 삭제까지 수행).
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const USER = "admin.sys"; // sysadmin — 관리자 퍼지(시나리오 6) 접근에 필요

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const consoleErrors = []; // validateDOMNesting 등 런타임 콘솔 에러 수집 (T9 픽스 회귀 확인)

// Notification 모델 경유 삽입 — raw sqlite insert의 tz-aware DateTime 비교 함정 회피(dashboard 스크립트와 동일 패턴).
// entries: [type, message] 튜플 배열. 항상 recipient=USER, read=False로 삽입.
function seedNotifications(entries) {
  const literal = entries.map(([type, message]) => `('${type}', '${message}')`).join(", ");
  execSync(
    `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import Notification

entries = [${literal}]

async def seed():
    async with SessionLocal() as s:
        for typ, msg in entries:
            s.add(Notification(recipient='${USER}', type=typ, message=msg, read=False))
        await s.commit()

asyncio.run(seed())
"`,
    { stdio: "inherit" },
  );
}

// KST 기준 오늘/내일 날짜(YYYY-MM-DD) — 퍼지 기간·이전삭제 date input에 사용(clock.now() 동일 기준).
const [TODAY, TOMORROW] = execSync(
  `cd ../backend && .venv/bin/python -c "
from datetime import timedelta
from app.clock import now
print(now().date().isoformat())
print((now() + timedelta(days=1)).date().isoformat())
"`,
)
  .toString()
  .trim()
  .split("\n");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// devUser + 언어 영문 고정(기본 ko라 선택자를 이중 유지하지 않기 위해) — TopNav의 storeDevUser와 동일 키.
await ctx.addInitScript((user) => {
  window.localStorage.setItem("bpm.devUser", user);
  window.localStorage.setItem("bpm.lang", "en");
}, USER);
const page = await ctx.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const waitApi = (method, test) =>
  page.waitForResponse(
    (r) => r.request().method() === method && test(new URL(r.url())),
    { timeout: 8000 },
  );
const listDone = () => waitApi("GET", (u) => u.pathname === "/api/notifications");

// ── 초기 시드 — 시나리오 1~4용 6건(모두 미읽음, admin.sys 수신) ──────────
seedNotifications([
  ["review_requested", "T12-S1 deep link target"],
  ["checkout_requested", "T12-S2 bell delete target"],
  ["notice", "T12-S3 category notice item"],
  ["permission_requested", "T12-S3 category permission item"],
  ["permission_requested", "T12-S4 select delete A"],
  ["permission_requested", "T12-S4 select delete B"],
]);

// ── 시나리오 2: 벨 개별 삭제(먼저 실행 — 인박스 마운트 전에 서버측 상태를 정리해야
// 이후 딥링크로 열리는 인박스의 최초 fetch가 정확한 잔여 목록을 받는다) ──────────
{
  const initial = listDone();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await initial.catch(() => undefined);
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Notifications" }).click();
  const row = page.locator("li", { hasText: "T12-S2 bell delete target" });
  await row.waitFor({ state: "visible", timeout: 5000 });
  const deleteDone = waitApi("DELETE", (u) => /^\/api\/notifications\/\d+$/.test(u.pathname));
  await row.getByRole("button", { name: "Delete" }).click();
  await deleteDone.catch(() => undefined);
  await page.waitForTimeout(200);
  const goneImmediately = (await row.count()) === 0;

  // 5초 폴링 후에도 미복귀 — 서버측 삭제 확인(로컬 낙관 제거만이 아님)
  await page.waitForTimeout(5500);
  const stillGone = (await page.locator("li", { hasText: "T12-S2 bell delete target" }).count()) === 0;
  check("2 bell individual delete (immediate + no poll revival)", goneImmediately && stillGone);
}

// ── 시나리오 1: 벨 → 딥링크(읽음 처리 + 알림탭 오픈) ──────────
{
  const readDone = waitApi("POST", (u) => /^\/api\/notifications\/\d+\/read$/.test(u.pathname));
  const bellRow = page.locator("li", { hasText: "T12-S1 deep link target" });
  await bellRow.waitFor({ state: "visible", timeout: 5000 });
  await bellRow.locator("span.flex-1").click();

  await page.waitForURL(/\/inbox/, { timeout: 8000 });
  await readDone.catch(() => undefined);
  await page.waitForURL((u) => u.pathname === "/inbox" && u.search === "", { timeout: 8000 });
  await page.waitForTimeout(300);

  const detail = page.locator('[data-id="inbox-detail-aside"]');
  const detailText = await detail.innerText().catch(() => "");
  const card = page.locator('div[role="button"]', { hasText: "T12-S1 deep link target" });
  const cardText = await card.innerText().catch(() => "");
  // 알림 탭 활성 직접 단언 — 탭 세그먼트(div.inline-grid)로 스코프해 벨 버튼(aria-label
  // "Notifications")과 구분. 활성 탭은 text-accent, 비활성(Approvals)은 아님.
  const notifTabClass =
    (await page
      .locator("div.inline-grid button", { hasText: "Notifications" })
      .getAttribute("class")) ?? "";
  const approvalsTabClass =
    (await page
      .locator("div.inline-grid button", { hasText: "Approvals" })
      .getAttribute("class")) ?? "";
  const notifTabActive =
    notifTabClass.includes("text-accent") && !approvalsTabClass.includes("text-accent");
  check(
    "1 bell deep link opens inbox + notifications tab active + marks read",
    page.url().endsWith("/inbox") &&
      notifTabActive &&
      detailText.includes("T12-S1 deep link target") &&
      cardText.includes("Read"),
    `${page.url()} tabActive=${notifTabActive}`,
  );
}

// ── 시나리오 3: 알림탭 카테고리 필 ── (현재 items: S1(read,version) S3-notice S3-perm S4a S4b)
// "All" 라벨이 읽음필터·카테고리필터 두 IconPillFilter에 중복 존재 — Notice pill의 부모 컨테이너로 스코프.
{
  const noticePill = page.getByRole("button", { name: "Notice", exact: true });
  const categoryRow = noticePill.locator("xpath=..");
  await noticePill.click();
  await page.waitForTimeout(200);
  const cards = page.locator('div[role="button"] span.line-clamp-2');
  const texts = await cards.allTextContents();
  const onlyNotice = texts.length === 1 && texts[0].includes("T12-S3 category notice item");
  check("3 category pill filters to notice only", onlyNotice, JSON.stringify(texts));

  await categoryRow.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForTimeout(200);
}

// ── 시나리오 4: 선택 모드 → 2건 체크 → 선택 삭제(ConfirmDialog) ──────────
{
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.locator('div[role="button"]', { hasText: "T12-S4 select delete A" }).click();
  await page.locator('div[role="button"]', { hasText: "T12-S4 select delete B" }).click();

  const deleteSelectedBtn = page.getByRole("button", { name: /Delete selected \(2\)/ });
  await deleteSelectedBtn.waitFor({ state: "visible", timeout: 5000 });
  await deleteSelectedBtn.click();

  const dialog = page.locator('[data-id="confirm-dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const dialogText = await dialog.innerText();
  const bulkDone = waitApi("POST", (u) => u.pathname === "/api/notifications/bulk-delete");
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await bulkDone.catch(() => undefined);
  await listDone().catch(() => undefined);
  await page.waitForTimeout(300);

  const remaining = await page.locator('div[role="button"] span.line-clamp-2').allTextContents();
  const remainingOk =
    remaining.length === 3 &&
    !remaining.some((t) => t.includes("T12-S4 select delete"));
  check(
    "4 select-mode bulk delete via ConfirmDialog",
    dialogText.includes("Delete 2 selected") && remainingOk,
    `dialog="${dialogText.replace(/\n+/g, " ").trim()}" remaining=${remaining.length}`,
  );
}

// ── 시나리오 5a: 모두 읽음 → 읽은 알림 삭제 → 0건 ──────────
{
  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.waitForTimeout(400);

  const deleteReadBtn = page.getByRole("button", { name: "Delete read" });
  await deleteReadBtn.click();
  const dialog = page.locator('[data-id="confirm-dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const dialogText = await dialog.innerText();
  const bulkDone = waitApi("POST", (u) => u.pathname === "/api/notifications/bulk-delete");
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await bulkDone.catch(() => undefined);
  await listDone().catch(() => undefined);
  await page.waitForTimeout(300);

  const emptyState = await page.getByText("No notifications.").isVisible().catch(() => false);
  check(
    "5a mark-all-read then delete-read empties list",
    emptyState,
    dialogText.replace(/\n+/g, " ").trim(),
  );
}

// ── 시나리오 5b: 날짜(내일) 이전 삭제 → 전건 삭제 ──────────
{
  seedNotifications([
    ["review_requested", "T12-S5b before-date target A"],
    ["review_requested", "T12-S5b before-date target B"],
  ]);
  // 인박스는 마운트 1회 fetch(자동 갱신 없음, docs/manual 서술과 일치) — 새로고침으로 반영 확인.
  const reloadListDone = listDone();
  await page.reload({ waitUntil: "domcontentloaded" });
  await reloadListDone.catch(() => undefined);
  await page.waitForTimeout(300);

  await page.locator('input[type="date"]').fill(TOMORROW);
  const deleteBeforeBtn = page.getByRole("button", { name: "Delete older" });
  await deleteBeforeBtn.click();
  const dialog = page.locator('[data-id="confirm-dialog"]');
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  const dialogText = await dialog.innerText();
  const bulkDone = waitApi("POST", (u) => u.pathname === "/api/notifications/bulk-delete");
  await page.locator('[data-id="confirm-dialog-confirm"]').click();
  await bulkDone.catch(() => undefined);
  await listDone().catch(() => undefined);
  await page.waitForTimeout(300);

  const emptyState = await page.getByText("No notifications.").isVisible().catch(() => false);
  check(
    "5b delete-before-tomorrow removes all",
    emptyState,
    dialogText.replace(/\n+/g, " ").trim(),
  );
}

// ── 시나리오 6: 관리자 기간 퍼지(설정 → Database → Tables → notifications) ──────────
{
  seedNotifications([
    ["notice", "T12-S6 purge batch"],
    ["notice", "T12-S6 purge batch"],
    ["notice", "T12-S6 purge batch"],
  ]);

  const meDone = waitApi("GET", (u) => u.pathname === "/api/me");
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await meDone.catch(() => undefined);

  await page.getByRole("button", { name: "Tables" }).click();
  const tablesDone = waitApi("GET", (u) => u.pathname === "/api/admin/tables");
  await tablesDone.catch(() => undefined);

  const tableRowsDone = waitApi("GET", (u) => u.pathname === "/api/admin/tables/notifications");
  await page.getByRole("button", { name: /^notifications/ }).click();
  await tableRowsDone.catch(() => undefined);
  await page.waitForTimeout(300);

  // pill 텍스트 "notifications\n3" → 행수 숫자만 추출("notifications"엔 숫자 없음)
  const parsePillCount = (text) => Number(text.replace(/\D+/g, ""));
  const pillCountBefore = parsePillCount(
    await page.getByRole("button", { name: /^notifications/ }).innerText(),
  );
  const rowsShownBefore = await page.getByText(/rows · \d+ shown/).innerText();

  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.nth(0).fill(TODAY);
  await dateInputs.nth(1).fill(TODAY);

  const previewDone = waitApi("GET", (u) => u.pathname === "/api/admin/notifications/purge-preview");
  await page.getByRole("button", { name: "Delete in range" }).click();
  await previewDone.catch(() => undefined);
  await page.waitForTimeout(300);

  const modalText = await page.locator("div.shadow-lg", { hasText: "Purge notifications" }).innerText();
  const groupShown = modalText.includes("T12-S6 purge batch") && modalText.includes("3 recipient");

  // 확정 버튼 라벨("Delete {N} rows")에서 체크된 묶음의 count 합 N을 읽어 정확 감소 단언에 사용
  const purgeBtn = page.getByRole("button", { name: /Delete \d+ rows/ });
  const confirmedRows = Number((await purgeBtn.innerText()).match(/Delete (\d+) rows/)?.[1] ?? NaN);

  const purgeDone = waitApi("POST", (u) => u.pathname === "/api/admin/notifications/purge");
  await purgeBtn.click();
  await purgeDone.catch(() => undefined);
  await page.waitForTimeout(300);

  const pillCountAfter = parsePillCount(
    await page.getByRole("button", { name: /^notifications/ }).innerText(),
  );

  check(
    "6 admin purge preview groups + exact row count decrease",
    groupShown && confirmedRows > 0 && pillCountAfter === pillCountBefore - confirmedRows,
    `before=${pillCountBefore} confirmed=${confirmedRows} after=${pillCountAfter} rowsShownBefore="${rowsShownBefore}"`,
  );
}

// ── 콘솔 에러 — T9에서 픽스한 button-in-button(validateDOMNesting) 회귀 확인 ──────────
const domNestingErrors = consoleErrors.filter((e) => e.includes("validateDOMNesting"));
check(
  "7 no validateDOMNesting console errors",
  domNestingErrors.length === 0,
  `validateDOMNesting=${domNestingErrors.length}`,
);

// ── 콘솔 에러 총량 게이트 — error 타입 콘솔 메시지·pageerror 전부 0건이어야 통과
// (validateDOMNesting 외 임의의 런타임 에러도 FAIL 유발. allowlist 없음 — 현재 클린 실측 기준)
check(
  "8 zero console errors overall",
  consoleErrors.length === 0,
  `total=${consoleErrors.length}` +
    (consoleErrors.length > 0 ? ` | ${consoleErrors.slice(0, 5).join(" || ")}` : ""),
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
