// 로딩 플레이스홀더 스모크 — API에 인위적 지연(라우트 인터셉트)을 걸고 첫 페인트 상태를 실측한다.
// (1) 공지 작성자 필이 아이디로 먼저 뜨지 않는지 (2) 홈이 빈 상태 대신 스켈레톤인지
// (3) 첫 페인트에 accordion-open(진입 애니메이션)이 하나도 없는지 + 사용자 토글에는 여전히 재생되는지.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-smoke-loading.mjs
// 전제: 백엔드·프론트 기동, reset_db 시드(맵 다수) + 공지 1건 이상. 공지가 0건이면 (1)이 SKIP 아닌 FAIL로 뜬다.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3012";
const OUT = process.env.SHOT_DIR ?? ".";
const TAG = process.env.TAG ?? "after";
const DELAY_MS = 600;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
// API 응답을 늦춰 로딩 상태를 관측 가능하게. 디렉터리는 더 늦춰 "목록은 왔는데 이름은 아직"
// 구간(= 아이디가 먼저 뜨던 버그의 조건)을 확실히 만든다.
await ctx.route("**/api/**", async (route) => {
  const isDirectory = route.request().url().includes("/api/directory");
  await new Promise((r) => setTimeout(r, isDirectory ? DELAY_MS * 3 : DELAY_MS));
  await route.continue();
});
const page = await ctx.newPage();

// ── (1) 공지: 로딩 중 스켈레톤 카드, 작성자 자리에 아이디 문자열이 뜨지 않는다
await page.goto(`${BASE}/notices`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(250);
const noticeEarly = await page.evaluate(() => ({
  skeletons: document.querySelectorAll(".skeleton").length,
  text: document.body.innerText,
}));
check("notices: skeleton cards during load", noticeEarly.skeletons > 0, `${noticeEarly.skeletons} blocks`);
// 목록은 도착했지만 디렉터리는 아직인 구간 — 작성자 자리에 login id가 보이면 실패(아이디→이름 깜빡임)
await page.waitForTimeout(700);
const midLoad = await page.evaluate(() => {
  const cards = document.querySelectorAll('[data-id="notice-detail-accordion"]').length;
  // login id 형태(alpha.alpha[digit])만 담긴 span — 이름이 오기 전 아이디를 그린 흔적
  const idSpans = [...document.querySelectorAll("span")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter((txt) => /^[a-z]+\.[a-z]+\d?$/.test(txt));
  return { cards, idSpans };
});
check(
  "notices: no login-id flash while names are still loading",
  midLoad.cards > 0 && midLoad.idSpans.length === 0,
  `${midLoad.cards} cards · ids=${JSON.stringify(midLoad.idSpans.slice(0, 3))}`,
);
await page.screenshot({ path: `${OUT}/loading-notices-${TAG}.png`, clip: { x: 0, y: 0, width: 720, height: 700 } });
await page.waitForTimeout(2000);
const noticeLate = await page.evaluate(() => ({
  skeletons: document.querySelectorAll(".skeleton").length,
  pill: document.querySelector('[data-id="notice-detail-aside"]') ? true : false,
  text: document.body.innerText,
}));
check("notices: skeletons gone after load", noticeLate.skeletons === 0, `${noticeLate.skeletons} left`);

// ── (2)(3) 홈: 첫 페인트에 welcome-placeholder 대신 스켈레톤, accordion-open 0개
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(250);
const homeEarly = await page.evaluate(() => ({
  skeleton: Boolean(document.querySelector('[data-id="home-skeleton"]')),
  welcome: Boolean(document.querySelector('[data-id="welcome-placeholder"]')),
  animating: document.querySelectorAll(".accordion-open").length,
}));
check("home: skeleton instead of empty state on first paint", homeEarly.skeleton && !homeEarly.welcome, JSON.stringify(homeEarly));
await page.screenshot({ path: `${OUT}/loading-home-${TAG}.png`, clip: { x: 0, y: 0, width: 1440, height: 800 } });

// 데이터 도착 직후 — 트리가 펼쳐져도 진입 애니메이션은 재생되지 않아야 한다.
// 디렉터리 지연(1800ms)까지 기다린다 — 홈은 맵·내 정보·디렉터리가 모두 와야 본 화면을 그린다.
await page.waitForTimeout(2600);
const homeLoaded = await page.evaluate(() => ({
  skeleton: Boolean(document.querySelector('[data-id="home-skeleton"]')),
  animating: document.querySelectorAll(".accordion-open").length,
  statics: document.querySelectorAll(".accordion-static").length,
  tree: Boolean(document.querySelector('[data-id="home-org-accordion"]')),
}));
check("home: content replaced the skeleton", !homeLoaded.skeleton && homeLoaded.tree, JSON.stringify(homeLoaded));
check("home: no entrance animation on first render", homeLoaded.animating === 0, JSON.stringify(homeLoaded));
await page.screenshot({ path: `${OUT}/loaded-home-${TAG}.png`, clip: { x: 0, y: 0, width: 1440, height: 800 } });

// 사용자가 부서를 펼치면 그때는 애니메이션이 살아 있어야 한다(기능 회귀 방지)
const toggle = page.locator('[data-id="org-node-toggle"]').first();
if (await toggle.count()) {
  await toggle.click();
  await page.waitForTimeout(60);
  const afterToggle = await page.evaluate(() => document.querySelectorAll(".accordion-open").length);
  check("home: expand animation still plays on user toggle", afterToggle > 0, `${afterToggle} animating`);
} else {
  check("home: expand animation still plays on user toggle", false, "no org node toggle found");
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
