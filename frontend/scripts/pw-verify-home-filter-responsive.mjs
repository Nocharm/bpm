// 홈 필터 필 반응형 실구동 검증 — home-filter-row 안 버튼들이 뷰포트 폭에 따라
// full → label-only → icon-only로 실측 전환되며, 세로 줄바꿈·가로 넘침이 없는지 확인 (Task 9, T8 검증).
// 뷰포트 1440/1130/1000/900px × EN·KO: offsetTop 전원 동일(줄바꿈 없음) + row.scrollWidth <= clientWidth
// (가로 넘침 없음)을 단언하고 각 조합을 스크린샷한다. 1130px는 활성 필터(Clear 노출) 상태로도 1회 추가
// 측정 — Task 8 Step 7에서 "Clear 폭 미차감 시 넘칠 수 있음"으로 이월된 주의사항의 실측 판정.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-home-filter-responsive.mjs
// 전제: backend :8000 + frontend :3000 기동, playwright-core 설치.
import { chromium } from "playwright-core";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR =
  process.env.SHOT_DIR ??
  "/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/52181cf7-17a0-4fb1-bdd6-38f77defa103/scratchpad";

const WIDTHS = [1440, 1130, 1000, 900];
const LANGS = ["en", "ko"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const section = (title) => console.log(`\n=== ${title} ===`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// row 안의 실 버튼만(측정용 absolute 복제는 measureOnly라 data-id가 없어 자동 제외됨) —
// home-status-filter/home-role-filter/home-owning-filter/home-sp-filter(+활성 시 home-filter-clear).
const filterButtons = () => page.locator('[data-id="home-filter-row"] [data-id^="home-"]');

// 세로 줄바꿈 없음(전원 동일 offsetTop) + 가로 넘침 없음(scrollWidth<=clientWidth) 측정.
async function measure(label) {
  const row = page.locator('[data-id="home-filter-row"]');
  const btns = filterButtons();
  const count = await btns.count();
  // row.scrollWidth는 쓰지 않는다 — 측정용 absolute invisible 복제 2종(full/label 자연폭 클론)이
  // position:absolute로 같은 row의 자식이라 visibility:hidden이어도 scrollWidth 계산에 얹혀
  // 항상 최대(full 모드) 폭을 반영한다(실측으로 확인된 함정, T9). 실제 가시 버튼들의 우측 끝
  // bounding rect로 진짜 가로 넘침을 판정한다.
  // offsetTop도 그대로 비교하지 않는다 — Clear는 일반 텍스트(패딩 없음, 12px)라 필 버튼(24~30px)과
  // 자연 높이가 달라 같은 줄이어도 items-center 정렬상 offsetTop이 몇 px 어긋난다. 세로 중심(y+h/2)
  // 비교가 "다음 줄로 줄바꿈됐는지"를 실제로 반영한다.
  const rects = await btns.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, right: r.right, midY: r.top + r.height / 2 };
    }),
  );
  const rowRect = await row.evaluate((el) => el.getBoundingClientRect());
  const midYs = rects.map((r) => r.midY);
  const minMidY = Math.min(...midYs);
  const maxMidY = Math.max(...midYs);
  const maxRight = Math.max(...rects.map((r) => r.right));
  const overflowPx = maxRight - rowRect.right;
  check(
    `${label}: no vertical wrap (all buttons share one line, vertical-center aligned)`,
    maxMidY - minMidY <= 2,
    `count=${count} midYs=[${midYs.map((v) => v.toFixed(1)).join(",")}]`,
  );
  check(
    `${label}: no horizontal overflow (rightmost button stays within the row)`,
    overflowPx <= 0.5,
    `overflowPx=${overflowPx.toFixed(2)} rowRight=${rowRect.right.toFixed(1)} maxBtnRight=${maxRight.toFixed(1)}`,
  );
  return { count, midYs, overflowPx };
}

async function shot(name) {
  await page.screenshot({ path: `${SHOT_DIR}/home-filter-${name}.png` }).catch(() => {});
}

// 상태 필터 드롭다운을 열고 첫 옵션(draft)을 골라 Clear 버튼을 노출시킨다.
async function activateOneFilter() {
  await page.locator('[data-id="home-status-filter"]').click();
  await page
    .locator('[data-id="home-status-filter"]')
    .locator('xpath=following-sibling::div[1]//button')
    .first()
    .click();
  await page.locator('[data-id="home-map-search"]').click(); // 바깥 클릭으로 드롭다운 닫기
}

async function clearFilters() {
  const clearBtn = page.locator('[data-id="home-filter-clear"]');
  if (await clearBtn.count()) {
    await clearBtn.click();
  }
}

// ── 서버 프로브 ────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}
const backendStatus = await page.evaluate(async () => {
  try {
    const res = await fetch("/api/maps", { headers: { "X-Dev-User": "admin.sys" } });
    return res.status;
  } catch {
    return 0;
  }
});
if (backendStatus !== 200) {
  console.error(`FATAL backend not reachable through ${BASE}/api (GET /api/maps → ${backendStatus})`);
  await browser.close();
  process.exit(1);
}

try {
  for (const lang of LANGS) {
    section(`lang=${lang}`);
    await page.evaluate(
      ({ lang }) => {
        window.localStorage.setItem("bpm.devUser", "admin.sys");
        window.localStorage.setItem("bpm.lang", lang);
      },
      { lang },
    );
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-id="home-filter-row"]');
    await page.waitForTimeout(300); // RAF + ResizeObserver 첫 산정 대기

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400); // ResizeObserver 재산정 대기
      await measure(`${lang}@${width}px`);
      await shot(`${lang}-${width}`);
    }

    // 1130px + 활성 필터(Clear 노출) — Task 8 Step 7 이월 주의사항의 실측 판정 지점.
    section(`lang=${lang} — 1130px with an active filter (Clear visible)`);
    await page.setViewportSize({ width: 1130, height: 900 });
    await page.waitForTimeout(300);
    await activateOneFilter();
    await page.waitForTimeout(400);
    const hasClear = (await page.locator('[data-id="home-filter-clear"]').count()) > 0;
    check(`${lang}@1130px+filter: Clear button visible`, hasClear);
    const withFilter = await measure(`${lang}@1130px+filter`);
    await shot(`${lang}-1130-with-clear`);
    await clearFilters();
    await page.waitForTimeout(300);

    if (withFilter.overflowPx > 0.5 || Math.max(...withFilter.midYs) - Math.min(...withFilter.midYs) > 2) {
      console.log(`  ⚠ ${lang}@1130px+filter overflowed/wrapped — needs the Clear-width-subtraction fix`);
    }
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
  await shot("fatal-state");
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 160)));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 && consoleErrors.length === 0 ? 0 : 1);
