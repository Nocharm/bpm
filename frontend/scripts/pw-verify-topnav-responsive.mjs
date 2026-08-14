// 상단 네비 4단계 반응형 실구동 검증 — top-nav.tsx가 폭 실측 기반(pickDisplayStage)으로
// S0(현행) → S1(탭 비활성 아이콘만) → S2(피드백 아이콘만) → S3(언어 1버튼) → S4(이름→User 아이콘)
// 순으로 누적 강등되며, 줄바꿈·좌우그룹 충돌·가로 넘침 없이 전환되는지 확인 (Task 3, T9 교훈 준수).
//
// 실행 (frontend/ 에서): node scripts/pw-verify-topnav-responsive.mjs
// 전제: backend :8000 + frontend :3000 기동, playwright-core 설치.
//
// 실측 결과 각주(설계 스펙 §5의 "760px→S4" 가정 보정): 시드 데이터(admin.sys="System Admin",
// 표준 EN/KO 라벨) 기준 760px는 S1까지만 내려간다(피드백 라벨 700px대까지 유지, 언어/이름은 stage>=2
// 필요). 진짜 S4는 avail<~644px(폭 ~660px대 후반 경계) 부터 — 이는 버그가 아니라 pickDisplayStage가
// "필요한 만큼만" 강등하는 설계대로 동작한 결과. 760은 실측대로 S1 앵커로 단언하고, 별도 SUPPLEMENTARY
// 폭(600px)에서 S4 도달을 확인해 캐스케이드 전 구간이 실제로 배선됐음을 검증한다.
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

const WIDTHS = [1440, 1200, 1000, 860, 760];
const S4_CONFIRM_WIDTH = 600; // 실측 S4 임계(avail<~644, 폭 ~660대) 아래 안전 여유폭
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
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

// nav 바로 아래 실제 자식 중 가시(측정용 aria-hidden 복제 제외 + offsetWidth>0)만 —
// nav.scrollWidth는 쓰지 않는다: aria-hidden 복제 4개(S0~S3)가 position:absolute로 같은 nav의
// 자식이라 invisible이어도 scrollWidth 계산에 얹혀 항상 최대(S0) 폭을 반영한다(T9 교훈).
async function measure(label) {
  const nav = page.locator("nav").first();
  const navRect = await nav.evaluate((el) => el.getBoundingClientRect());
  const data = await nav.evaluate((el) => {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.getAttribute("aria-hidden") === "true") continue; // 측정 복제 제외
        const r = child.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          out.push({ tag: child.tagName, top: r.top, right: r.right, midY: r.top + r.height / 2 });
        }
      }
    };
    const groups = Array.from(el.children).filter(
      (g) => g.tagName === "DIV" && g.getAttribute("aria-hidden") !== "true",
    );
    for (const group of groups) walk(group);
    // 좌그룹(브랜드+탭)·우그룹(아이콘류) 두 최상위 컨테이너 — 충돌(가로 겹침) 판정용.
    const [left, right] = groups.map((g) => g.getBoundingClientRect());
    return { visible: out, leftRight: left?.right ?? 0, rightLeft: right?.left ?? 0 };
  });
  const midYs = data.visible.map((r) => r.midY);
  const minMidY = Math.min(...midYs);
  const maxMidY = Math.max(...midYs);
  const maxRight = Math.max(...data.visible.map((r) => r.right));
  const overflowPx = maxRight - navRect.right;
  const collisionPx = data.leftRight - data.rightLeft; // 양수면 좌그룹이 우그룹을 침범(겹침)
  check(
    `${label}: no vertical wrap (all visible nav children share one line)`,
    maxMidY - minMidY <= 1,
    `count=${data.visible.length} midYs=[${midYs.map((v) => v.toFixed(1)).join(",")}]`,
  );
  check(
    `${label}: no left/right group collision (tabs don't overlap icon cluster)`,
    collisionPx <= 1,
    `collisionPx=${collisionPx.toFixed(2)} leftRight=${data.leftRight.toFixed(1)} rightLeft=${data.rightLeft.toFixed(1)}`,
  );
  check(
    `${label}: no horizontal overflow (rightmost element stays within nav)`,
    overflowPx <= 1,
    `overflowPx=${overflowPx.toFixed(2)} navRight=${navRect.right.toFixed(1)} maxRight=${maxRight.toFixed(1)}`,
  );
  return { count: data.visible.length, midYs, overflowPx, collisionPx };
}

async function shot(name) {
  await page.screenshot({ path: `${SHOT_DIR}/topnav-${name}.png` }).catch(() => {});
}

// 탭 라벨 offsetWidth>0 개수 — 비활성 아이콘만(S1+)인지 라벨 노출(S0)인지 판정.
async function countVisibleTabLabels() {
  return page.evaluate(() => {
    const links = document.querySelectorAll('nav > div:first-child a[href]');
    let n = 0;
    for (const link of links) {
      const span = link.querySelector("span");
      if (span && span.offsetWidth > 0) n += 1;
    }
    return n;
  });
}

async function feedbackLabelVisible() {
  return page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("nav button")).find((b) =>
      b.querySelector("svg.lucide-message-square"),
    );
    if (!btn) return false;
    return Array.from(btn.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0,
    );
  });
}

async function langButtonCount() {
  return page.evaluate(() => document.querySelectorAll("nav div.border-hairline.bg-surface-alt button").length);
}

async function userShowsIcon() {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("nav button"));
    const userBtn = btns.find((b) => b.className.includes("text-caption"));
    if (!userBtn) return false;
    const hasSvg = userBtn.querySelector("svg") !== null;
    const hasText = Array.from(userBtn.querySelectorAll("span")).some(
      (s) => s.textContent.trim().length > 0 && s.querySelector("svg") === null,
    );
    return hasSvg && !hasText;
  });
}

async function userShowsNameText() {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("nav button"));
    const userBtn = btns.find((b) => b.className.includes("text-caption") && b.querySelector("svg") === null);
    return userBtn !== undefined && userBtn.textContent.trim().length > 0;
  });
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
    await page.waitForSelector("nav");
    await page.waitForTimeout(300); // RAF + ResizeObserver 첫 산정 대기

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400); // ResizeObserver 재산정 대기
      await measure(`${lang}@${width}px`);

      if (width === 1440) {
        // S0 앵커: 탭 라벨 3개 모두 노출 + 피드백 라벨 노출 + 언어 버튼 2개 + 유저 이름 텍스트.
        const tabLabels = await countVisibleTabLabels();
        check(`${lang}@1440px: S0 — 3 tab labels visible`, tabLabels === 3, `tabLabels=${tabLabels}`);
        check(`${lang}@1440px: S0 — feedback label visible`, await feedbackLabelVisible());
        const langCount = await langButtonCount();
        check(`${lang}@1440px: S0 — 2 lang buttons`, langCount === 2, `count=${langCount}`);
        check(`${lang}@1440px: S0 — user name text (no icon)`, await userShowsNameText());
      }

      if (width === 760) {
        // S1 앵커(실측 보정 — 스펙 초안의 "760→S4" 가정은 실 시드 데이터로 재현 안 됨, 위 헤더 각주
        // 참고): 탭만 강등(비활성 아이콘만), 피드백/언어/이름은 아직 S0 그대로.
        const tabLabels = await countVisibleTabLabels();
        check(`${lang}@760px: S1 — exactly 1 tab label (only active)`, tabLabels === 1, `tabLabels=${tabLabels}`);
        check(`${lang}@760px: S1 — feedback label still visible (not yet S2)`, await feedbackLabelVisible());
        const langCount = await langButtonCount();
        check(`${lang}@760px: S1 — still 2 lang buttons (not yet S3)`, langCount === 2, `count=${langCount}`);
        check(`${lang}@760px: S1 — user still shows name text (not yet S4)`, await userShowsNameText());
      }

      await shot(`${lang}-${width}`);
    }

    // SUPPLEMENTARY: 공식 5폭 스윕에는 없지만, 캐스케이드 최종 단계(S4)가 실제로 렌더되는지
    // end-to-end 확인하는 폭. 실측 임계(avail<~644px, 폭 ~660대 경계) 아래 안전 여유.
    section(`lang=${lang} — S4 confirmation (supplementary ${S4_CONFIRM_WIDTH}px)`);
    await page.setViewportSize({ width: S4_CONFIRM_WIDTH, height: 900 });
    await page.waitForTimeout(400);
    await measure(`${lang}@${S4_CONFIRM_WIDTH}px(S4-confirm)`);
    const tabLabels = await countVisibleTabLabels();
    check(`${lang}@${S4_CONFIRM_WIDTH}px: S4 — ≤1 tab label visible`, tabLabels <= 1, `tabLabels=${tabLabels}`);
    check(`${lang}@${S4_CONFIRM_WIDTH}px: S4 — no feedback label`, !(await feedbackLabelVisible()));
    const langCount = await langButtonCount();
    check(`${lang}@${S4_CONFIRM_WIDTH}px: S4 — 1 lang button`, langCount === 1, `count=${langCount}`);
    check(`${lang}@${S4_CONFIRM_WIDTH}px: S4 — user renders svg icon not name text`, await userShowsIcon());
    await shot(`${lang}-${S4_CONFIRM_WIDTH}-s4confirm`);
  }

  // S1 인터랙션 sanity — 760px(위에서 실측 확인된 S1 경계)에서 비활성(아이콘만) 탭을 클릭하면
  // 실제로 이동하는지. 홈('/')이 활성이므로 비활성 탭(/notices)을 클릭.
  section("S1 interaction sanity");
  await page.evaluate(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(400);
  const tabLabelsAt760 = await countVisibleTabLabels();
  check("S1 interaction sanity: precondition — 760px is S1 (icon-only inactive tabs)", tabLabelsAt760 === 1, `tabLabels=${tabLabelsAt760}`);
  await page.locator('nav a[href="/notices"]').click();
  await page.waitForURL(/\/notices/, { timeout: 5000 }).catch(() => {});
  check(
    "S1 interaction sanity: clicking icon-only inactive tab navigates",
    page.url().includes("/notices"),
    `url=${page.url()}`,
  );
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
