// 중첩 펼침(A>B>C) 영역 메뉴 — 안쪽 영역이 대상이 되는지, 헤더에 대상 맵 이름이 뜨는지,
// 영역 헤더 이름 클릭이 "바로 접기"가 아니라 메뉴 열기인지 검증. (사용자 신고 2026-08-31)
// 사전 준비(데모 시드엔 2단 중첩이 없다): 맵1 게시본(v5)에 지정 맵(맵3) SP 노드를 하나 심는다 —
//   sqlite3 backend/dev.db "insert into nodes (id,version_id,title,node_type,linked_map_id,follow_latest,
//     pos_x,pos_y,sort_order,group_ids) values ('m1v5-sp',5,'Incident Response','subprocess',3,1,300,380,40,'[]');"
// 실행(frontend/): BASE_URL=http://localhost:3100 SHOT_DIR=/tmp/shots node scripts/pw-verify-nested-region-menu.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-nested-region";
// 데모 시드 기준 — 맵2(Employee Onboarding) 드래프트의 SP "Order Fulfillment"(맵1) 안에 SP(맵3)
const MAP_URL = `${BASE}/maps/2?version=12`;
const HOST_B = "m2-sp-designated"; // 바깥 영역(B) host 노드 id
const HOST_C = "m2-sp-designated/m1v5-sp"; // 안쪽 영역(C) host 노드 id(임베드 자식은 `${host}/${child}`)
const NAME_C = "Incident Response";
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

const bandIds = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-id^="region-band-"]')].map((el) =>
      (el.getAttribute("data-id") ?? "").replace("region-band-", ""),
    ),
  );
// 펼치면 영역이 화면 밖으로 커진다 — 좌표 히트테스트 전에 항상 화면 맞춤
const fitView = async () => {
  await page.getByRole("button", { name: "화면 맞춤(좌상단)" }).click();
  await page.waitForTimeout(800);
};
const menuText = () =>
  page.evaluate(() => document.querySelector('[data-id="context-menu"]')?.innerText ?? "");

await page.goto(MAP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// B 펼치기 — 노드 우클릭 메뉴
await page.locator(`.react-flow__node[data-id="${HOST_B}"]`).click({ button: "right" });
await page.waitForTimeout(500);
await page.getByText("하위 프로세스 펼치기").first().click();
await page.waitForTimeout(1500);
// C 펼치기 — 아웃라인의 자식 행 셰브론(임베드 자식은 캔버스 메뉴가 읽기전용이라 아웃라인 경로)
await page
  .locator("li")
  .filter({ hasText: NAME_C })
  .last()
  .getByRole("button")
  .first()
  .click();
await page.waitForTimeout(1500);
await fitView();
const twoBands = await bandIds();
check("[중첩] 영역 2개(B·C) 펼침", twoBands.includes(HOST_B) && twoBands.includes(HOST_C), twoBands.join(", "));
await shot(page, "nested-1-expanded");

// C 영역 안쪽(노드·컨트롤이 없는 여백)에서 우클릭 — 좌표 히트테스트가 안쪽 영역을 골라야 한다.
// 캔버스 pane이 실제로 잡히는 지점을 격자 탐색으로 고른다(노드/줌 컨트롤 위면 pane 이벤트가 안 뜬다).
const pickPaneSpot = async (hostId) =>
  page.evaluate((id) => {
    const band = document.querySelector(`[data-id="region-band-${id}"]`);
    if (!band) return null;
    const r = band.getBoundingClientRect();
    for (let fy = 0.15; fy <= 0.85; fy += 0.1) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
        const x = Math.round(r.x + r.width * fx);
        const y = Math.round(r.y + r.height * fy);
        const el = document.elementFromPoint(x, y);
        if (el && el.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  }, hostId);
const inC = await pickPaneSpot(HOST_C);
check("[중첩] C 영역 안 빈 지점 확보", inC !== null, JSON.stringify(inC));
await page.mouse.click(inC.x, inC.y, { button: "right" });
await page.waitForTimeout(500);
const text1 = await menuText();
check("[중첩] 안쪽 영역 우클릭 = 메뉴 오픈", text1.length > 0);
check("[중첩] 메뉴 첫 줄이 대상 맵 이름(C)", text1.split("\n")[0].trim() === NAME_C, JSON.stringify(text1.slice(0, 60)));
await shot(page, "nested-2-menu-inner");

// 접기 실행 → C만 접히고 B는 남아야 한다(기존 버그: 바깥 B가 접혀 전부 닫힘)
await page.getByText("하위 프로세스 접기").first().click();
await page.waitForTimeout(1200);
const afterCollapse = await bandIds();
check(
  "[중첩] 접기는 안쪽(C)만 - 바깥(B) 유지",
  afterCollapse.includes(HOST_B) && !afterCollapse.includes(HOST_C),
  afterCollapse.join(", ") || "(없음)",
);
await shot(page, "nested-3-collapsed-inner");

// C 다시 펼치고, 헤더 이름 클릭 = 바로 접기가 아니라 메뉴 열기
await page
  .locator("li")
  .filter({ hasText: NAME_C })
  .last()
  .getByRole("button")
  .first()
  .click();
await page.waitForTimeout(1200);
await fitView();
await page.locator(`[data-id="region-title-${HOST_C}"]`).click();
await page.waitForTimeout(500);
const afterTitle = await bandIds();
check("[중첩] 헤더 이름 클릭해도 접히지 않음", afterTitle.includes(HOST_C), afterTitle.join(", "));
const text2 = await menuText();
check("[중첩] 헤더 이름 클릭 = 그 영역 메뉴 오픈", text2.includes("하위 프로세스 접기"), JSON.stringify(text2.slice(0, 60)));
check("[중첩] 이름으로 연 메뉴엔 헤더 없음", !text2.split("\n")[0].includes(NAME_C), JSON.stringify(text2.split("\n")[0]));
await shot(page, "nested-4-title-menu");

// 이름 메뉴의 접기도 그 영역(C) 기준이어야 한다
await page.getByText("하위 프로세스 접기").first().click();
await page.waitForTimeout(1200);
const afterTitleCollapse = await bandIds();
check(
  "[중첩] 이름 메뉴의 접기도 C 기준",
  afterTitleCollapse.includes(HOST_B) && !afterTitleCollapse.includes(HOST_C),
  afterTitleCollapse.join(", ") || "(없음)",
);

// "링크된 맵 열기"도 안쪽(C) 맵으로 — 바깥 B(맵1)로 새면 사용자가 신고한 그 증상
await page
  .locator("li")
  .filter({ hasText: NAME_C })
  .last()
  .getByRole("button")
  .first()
  .click();
await page.waitForTimeout(1200);
await fitView();
const inC2 = await pickPaneSpot(HOST_C);
await page.mouse.click(inC2.x, inC2.y, { button: "right" });
await page.waitForTimeout(400);
await page.getByText("링크된 맵 열기").first().click();
await page.waitForTimeout(600);
const dialogText = await page.evaluate(() => document.body.innerText.includes("Incident Response"));
check("[중첩] 열기 확인 모달 = C 맵 이름", dialogText);
await page.getByRole("button", { name: "확인", exact: true }).last().click();
await page.waitForTimeout(2500);
check("[중첩] 이동 대상은 C 맵(/maps/3)", page.url().includes("/maps/3"), page.url());
await shot(page, "nested-5-opened-inner-map");

check("페이지 에러 없음", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`shots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
