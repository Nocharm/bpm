// L5 캔버스 차콜 배경 + 태그 토글 검증 — 기본 차콜·태그 클릭 토글·localStorage 영속·일반 맵 무영향.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/shots node scripts/pw-verify-l5-canvas-bg.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, dev.db에 mode=framework 맵 존재(기본 id 17).
// docs/lessons/browser-verification.md 준수(시스템 Chrome·playwright-core, node는 frontend/ cwd).
import { chromium } from "playwright-core";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const FW_MAP = process.env.FW_MAP ?? "17"; // mode=framework 맵
const PLAIN_MAP = process.env.PLAIN_MAP ?? "1"; // 일반 맵(무영향 확인)
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-l5-bg-verify";

const CHARCOAL = "rgb(54, 56, 67)"; // --color-canvas-l5 #363843
const LIGHT = "rgb(246, 246, 248)"; // --color-canvas #f6f6f8

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 활성 캔버스(.react-flow를 품은 bg-canvas*/bpm-l5-sky 래퍼)의 computed 배경색
const canvasBg = (page) =>
  page.evaluate(() => {
    const flow = document.querySelector(".react-flow");
    const host = flow?.closest('div[class*="bg-canvas"], div[class*="bpm-l5-sky"]');
    return host ? getComputedStyle(host).backgroundColor : null;
  });
// dot-grid 점 색 — React Flow Background 패턴의 circle fill
const dotColor = (page) =>
  page.evaluate(() => {
    const dot = document.querySelector(".react-flow__background circle, .react-flow__background pattern circle");
    return dot ? getComputedStyle(dot).fill : null;
  });
// 크롬은 항상 라이트(다크 셸 폐기) — 에디터 헤더(브레드크럼 바)의 computed 배경으로 판정
const chromeBg = (page) =>
  page.evaluate(() => {
    const header = document.querySelector('div[class*="flex h-full flex-col"] > header');
    return header ? getComputedStyle(header).backgroundColor : null;
  });
// 프레임 무대화 — 차콜 뷰포트의 라운드(--radius-md 11px) / 라이트는 풀블리드(0px)
const frameRadius = (page) =>
  page.evaluate(() => {
    const flow = document.querySelector(".react-flow");
    const host = flow?.closest('div[class*="bg-canvas"], div[class*="bpm-l5-sky"]');
    return host ? getComputedStyle(host).borderRadius : null;
  });
// 새벽 그라데이션 — 차콜 뷰포트의 background-image 판정(라이트/일반 맵은 none)
const skyGradient = (page) =>
  page.evaluate(() => {
    const flow = document.querySelector(".react-flow");
    const host = flow?.closest('div[class*="bg-canvas"], div[class*="bpm-l5-sky"]');
    return host ? getComputedStyle(host).backgroundImage : null;
  });
// 노드 타이틀 잉크 — 다크 셸에서도 노드 내부는 라이트(#16161d) 유지되어야 한다(viewport 제외 재정의)
const nodeTitleColor = (page) =>
  page.evaluate(() => {
    const title = document.querySelector('.react-flow__node [class*="font-medium"]');
    return title ? getComputedStyle(title).color : null;
  });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];
let shotIndex = 0;
const shot = (page, name) =>
  page.screenshot({ path: path.join(SHOT_DIR, `${String(++shotIndex).padStart(2, "0")}-${name}.png`), fullPage: false });

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
    // 이전 실행 잔재 초기화 — 기본값 단언용. initScript는 reload마다 재실행되므로
    // sessionStorage 마커로 첫 로드 1회만 지운다(영속 단언이 스스로 깨지지 않게)
    if (!window.sessionStorage.getItem("l5bg-cleared")) {
      window.localStorage.removeItem("bpm.l5CanvasBg");
      window.sessionStorage.setItem("l5bg-cleared", "1");
    }
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // ── 1) L5 캔버스 — 기본 차콜 + Moon 태그 ─────────────────────────────────
  await page.goto(`${BASE}/maps/${FW_MAP}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  const tag = page.locator('[data-id="framework-l5-tag"]');
  await tag.waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: "fit view" }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  check("L5 default charcoal bg", (await canvasBg(page)) === CHARCOAL, String(await canvasBg(page)));
  // 새벽 조감도 — 도트·별 없는 그라데이션 하늘 + 라운드 프레임
  check("charcoal has no grid (solid stage)", await page.evaluate(() => document.querySelector(".react-flow__background") === null));
  check("dawn sky gradient", String(await skyGradient(page)).includes("linear-gradient"), String(await skyGradient(page)).slice(0, 60));
  check("charcoal viewport framed (rounded)", (await frameRadius(page)) === "11px", String(await frameRadius(page)));
  check("tag shows Moon (charcoal state)", (await tag.locator("svg.lucide-moon").count()) === 1);
  check("tag is a button with tooltip", (await tag.getAttribute("title")) === "Switch to light background");
  check("chrome stays light in charcoal", (await chromeBg(page)) === "rgb(255, 255, 255)", String(await chromeBg(page)));
  // 칩 안쪽 배치 — 모드 링(inset 6px) 안쪽으로 20px (라이트는 8px 복귀)
  check("tag inset in charcoal (top 20px)", (await tag.evaluate((el) => getComputedStyle(el).top)) === "20px");
  check("node title ink stays light-mode", (await nodeTitleColor(page)) === "rgb(22, 22, 29)", String(await nodeTitleColor(page)));
  await shot(page, "l5-charcoal-default");

  // ── 2) 태그 클릭 → 라이트 전환 ───────────────────────────────────────────
  await tag.click();
  await page.waitForTimeout(300);
  check("toggle to light bg", (await canvasBg(page)) === LIGHT, String(await canvasBg(page)));
  check("light dot color", (await dotColor(page)) === "rgb(189, 189, 201)", String(await dotColor(page)));
  check("tag shows Sun (light state)", (await tag.locator("svg.lucide-sun").count()) === 1);
  check("light is full-bleed (no frame)", (await frameRadius(page)) === "0px", String(await frameRadius(page)));
  check("no gradient in light", (await skyGradient(page)) === "none", String(await skyGradient(page)));
  check("tag back to edge in light (top 8px)", (await tag.evaluate((el) => getComputedStyle(el).top)) === "8px");
  check("chrome header stays light", (await chromeBg(page)) === "rgb(255, 255, 255)", String(await chromeBg(page)));
  await shot(page, "l5-light-after-toggle");

  // ── 3) 새로고침 — 라이트 영속 ────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(400);
  check("light persists after reload", (await canvasBg(page)) === LIGHT, String(await canvasBg(page)));

  // ── 4) 다시 차콜 → 새로고침 영속 ─────────────────────────────────────────
  await page.locator('[data-id="framework-l5-tag"]').click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(400);
  check("charcoal persists after reload", (await canvasBg(page)) === CHARCOAL, String(await canvasBg(page)));
  await shot(page, "l5-charcoal-persisted");

  // ── 5) 일반 맵 — 라이트 유지 + L5 태그 없음 ──────────────────────────────
  await page.goto(`${BASE}/maps/${PLAIN_MAP}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(400);
  check("plain map stays light", (await canvasBg(page)) === LIGHT, String(await canvasBg(page)));
  check("plain map has no L5 tag", (await page.locator('[data-id="framework-l5-tag"]').count()) === 0);
  check("plain map is full-bleed", (await frameRadius(page)) === "0px", String(await frameRadius(page)));
  await shot(page, "plain-map-light");

  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length === 0 ? 0 : 1);
