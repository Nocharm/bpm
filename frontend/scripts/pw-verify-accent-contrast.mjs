// 악센트 테마 대비 가드 — lib/accent-theme.ts 프리셋 전부 × 실사용 색 조합(라이트 면·L5 새벽 하늘·대시보드 유리 카드)을
// 실제 CSS로 토큰을 해석해 WCAG 대비로 검사한다. 프리셋·파생 공식(globals.css)을 바꾸면 돌린다. 실패 시 exit 1.
// 실행: frontend/scripts에서 BASE_URL=http://localhost:3000 node pw-verify-accent-contrast.mjs (dev 서버 필요)
// 하늘 배경값은 .bpm-l5-sky(86% 그라데이션) + 흰 거터 합성 실측(상단 #3b455d·하단 #52545d), 유리 카드는 하단 위 흰 10%.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SRC = readFileSync(new URL("../src/lib/accent-theme.ts", import.meta.url), "utf8");
const THEMES = Object.fromEntries([...SRC.matchAll(/\{ id: "(\w+)", hex: "(#[0-9a-fA-F]{6})" \}/g)].map((m) => [m[1], m[2]]));
if (Object.keys(THEMES).length === 0) throw new Error("no presets parsed from accent-theme.ts");
// [이름, 전경, 배경, 최소비, 메모] — 전경/배경은 CSS 색 식(토큰 포함)
const PAIRS = [
  // 라이트 면
  ["버튼 흰 글씨", "var(--color-on-accent)", "var(--color-accent)", 4.5],
  ["버튼 hover 흰 글씨", "var(--color-on-accent)", "var(--color-accent-focus)", 4.5],
  ["악센트 글씨 / 흰 바탕", "var(--color-accent)", "#ffffff", 4.5],
  ["악센트 글씨 / surface-alt", "var(--color-accent)", "var(--color-surface-alt)", 4.5],
  ["악센트 글씨 / 선택 틴트", "var(--color-accent)", "var(--color-accent-tint)", 4.5],
  ["선택 링 / 라이트 캔버스", "var(--color-accent)", "var(--color-canvas)", 3],
  ["선택 엣지 / 라이트 캔버스", "var(--color-edge-selected)", "var(--color-canvas)", 3],
  ["차트 승인 막대 / 흰 바탕", "var(--color-chart-approved)", "#ffffff", 3],
  ["SP stroke / SP fill", "var(--color-subprocess)", "color-mix(in srgb, var(--color-subprocess) 18%, white)", 3],
  ["SP stroke / 라이트 캔버스", "var(--color-subprocess)", "var(--color-canvas)", 3],
  // 다크 면(L5 새벽 하늘 — 86% 그라데이션 위 흰 거터, 하단이 가장 밝아 최악)
  ["선택 링(sky) / L5 하늘 하단", "var(--color-accent-sky)", "#52545d", 3],
  ["선택 링(sky) / L5 하늘 상단", "var(--color-accent-sky)", "#3b455d", 3],
  ["선택 엣지(sky) / L5 하늘 하단", "var(--color-accent-sky)", "#52545d", 3],
  ["병렬 펄스(sky) / L5 하늘 하단", "var(--color-accent-sky)", "#52545d", 3],
  ["SP 채움 / L5 하늘 하단(노드 윤곽)", "color-mix(in srgb, var(--color-subprocess) 18%, white)", "#52545d", 3],
  ["대시보드 sky 글씨 / 하늘 상단 맨바닥", "var(--color-accent-sky)", "#3b455d", 4.5],
  ["대시보드 sky 글씨 / 유리 카드(하단)", "var(--color-accent-sky)", "#63656d", 4.5],
  ["대시보드 sky 막대 / 유리 카드(하단)", "var(--color-accent-sky)", "#63656d", 3],
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(() => localStorage.setItem("bpm.devUser", "admin.sys"));
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await page.waitForTimeout(2500);
const rows = [];
for (const [id, hex] of Object.entries(THEMES)) {
  const res = await page.evaluate(({ hex, PAIRS }) => {
    document.documentElement.style.setProperty("--color-accent", hex);
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const g = cv.getContext("2d", { willReadFrequently: true });
    // 계산값이 oklch()/color() 등 어떤 표기든 캔버스에 칠해 sRGB로 환산
    const rgb = (expr) => {
      probe.style.color = expr;
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = getComputedStyle(probe).color;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const out = PAIRS.map(([name, fg, bg, min]) => ({ name, min, v: +cr(rgb(fg), rgb(bg)).toFixed(2) }));
    probe.remove();
    return out;
  }, { hex, PAIRS });
  for (const r of res) rows.push({ theme: id, ...r });
}
const names = PAIRS.map((p) => p[0]);
console.log("조합".padEnd(30), Object.keys(THEMES).map((t) => t.padStart(9)).join(""));
for (const n of names) {
  const line = Object.keys(THEMES).map((t) => { const r = rows.find((x) => x.theme === t && x.name === n); return `${r.v < r.min ? "✗" : " "}${r.v.toFixed(2)}`.padStart(9); }).join("");
  console.log(`${n} (≥${PAIRS.find((p) => p[0] === n)[3]})`.padEnd(30), line);
}
await browser.close();
const failures = rows.filter((r) => r.v < r.min);
console.log(failures.length === 0 ? "PASS all pairs" : `FAIL ${failures.length} pair(s)`);
process.exit(failures.length === 0 ? 0 : 1);
