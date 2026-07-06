// AI 챗 다중 세션 스모크 — 세션 4개 시드 → 드롭다운/카운터 → 5번째 새 대화 확인 모달 → 최오래 닫힘 → 전환 → 구 포맷 이행.
// 실행: frontend/ 에서 node scripts/pw-smoke-ai-chat-sessions.mjs (백엔드 AUTH_ENABLED=false + 프론트 기동, 시드 dev.db 전제)
// 포트가 다르면 BASE_URL=http://localhost:3010 처럼 지정. playwright-core + 시스템 Chrome 사용.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

// 페이지가 조회한 버전 id 전부 수집 — 어떤 버전이 활성인지 모르므로 전부에 시드한다.
const versionIds = new Set();
page.on("request", (req) => {
  const m = req.url().match(/\/api\/versions\/(\d+)\//);
  if (m) versionIds.add(Number(m[1]));
});

const openAiPanel = async () => {
  const toggle = page.locator('button[title="AI 도우미"], button[title="AI assistant"]').first();
  await toggle.click();
  await page.waitForSelector('[data-id="ai-chat-list"]', { timeout: 5000 });
};

await page.goto(`${BASE}/maps/1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
await page.waitForTimeout(1000);
check("editor loaded", true, `versionIds=${[...versionIds].join(",")}`);
if (versionIds.size === 0) {
  console.log("FATAL no versionId captured");
  process.exit(1);
}
const KEYS = [...versionIds].map((id) => `bpm.aiChat.v${id}`);

// ① 최초 오픈 — 빈 세션 1개, 카운터 1/4
await openAiPanel();
const counter1 = await page.locator('[data-id="ai-chat-list"]').innerText();
check("fresh panel counter 1/4", counter1.includes("1/4"), counter1.replace(/\n/g, " "));

// ①-1 헤더 새 대화 아이콘(아이콘만) + 호버 툴팁 박스
const newChatText = await page.locator('[data-id="ai-new-chat"]').innerText();
check("header new-chat icon-only", newChatText.trim() === "", `text="${newChatText}"`);
await page.hover('[data-id="ai-new-chat"]');
await page.waitForTimeout(200);
const tipVisible = await page.evaluate(() => {
  const tips = [...document.querySelectorAll('[data-id="icon-tip"]')];
  return tips.some(
    (el) => getComputedStyle(el).display !== "none" && (el.textContent ?? "").includes("새 대화"),
  );
});
check("header tooltip box on hover", tipVisible);
await page.screenshot({ path: `${SHOT_DIR}/smoke-0-header-tooltip.png` });

// ①-2 대화 전환 바의 폰트 배율 툴 — T+ 클릭 시 스레드 zoom 1.1
await page
  .locator(
    '[data-id="ai-font-scale"] button[title="글자 크게"], [data-id="ai-font-scale"] button[title="Larger text"]',
  )
  .click();
await page.waitForTimeout(200);
const zoomApplied = await page.evaluate(
  () => [...document.querySelectorAll("div")].some((el) => el.style.zoom === "1.1"),
);
check("font scale tool in chat bar", zoomApplied);

// ② 4개 세션 시드 → 패널 닫았다 열어 재하이드레이션
await page.evaluate((keys) => {
  const mk = (id, at, topic) => ({
    id,
    createdAt: at,
    messages: [
      { role: "user", content: `${topic} 질문` },
      { role: "assistant", content: `${topic} 답변` },
    ],
  });
  const store = {
    sessions: [mk("s1", 100, "첫번째"), mk("s2", 200, "두번째"), mk("s3", 300, "세번째"), mk("s4", 400, "네번째")],
    activeId: "s4",
  };
  for (const key of keys) window.localStorage.setItem(key, JSON.stringify(store));
}, KEYS);
const toggle = page.locator('button[title="AI 도우미"], button[title="AI assistant"]').first();
await toggle.click(); // 닫기(언마운트)
await page.waitForTimeout(300);
await openAiPanel();
const counter4 = await page.locator('[data-id="ai-chat-list"]').innerText();
check("seeded counter 4/4", counter4.includes("4/4"), counter4.replace(/\n/g, " "));
check("active title = newest", counter4.includes("네번째 질문"));

// ③ 드롭다운 — 4개, 최신순, 활성 표시
await page.locator('[data-id="ai-chat-list"]').click();
await page.waitForSelector('[data-id="ai-chat-list-menu"]', { timeout: 3000 });
const items = await page.locator('[data-id="ai-chat-list-item"]').allInnerTexts();
check("dropdown 4 items", items.length === 4, JSON.stringify(items));
check(
  "dropdown newest-first",
  items[0]?.includes("네번째") && items[3]?.includes("첫번째"),
);
await page.screenshot({ path: `${SHOT_DIR}/smoke-1-dropdown.png` });

// ④ 스레드 전환 — 두번째 클릭 → 본문에 해당 대화 표시
await page.locator('[data-id="ai-chat-list-item"]', { hasText: "두번째" }).click();
await page.waitForTimeout(300);
const thread = await page.locator('[data-id="ai-chat-list"]').innerText();
check("switched active title", thread.includes("두번째 질문"), thread.replace(/\n/g, " "));
const bodyHasMsg = await page.getByText("두번째 답변").count();
check("switched thread content", bodyHasMsg > 0);

// ⑤ 새 대화(5번째) → 한도 확인 모달: 최오래(첫번째) 닫힘 안내
await page.locator('[data-id="ai-new-chat"]').click();
await page.waitForSelector('[data-id="confirm-dialog"]', { timeout: 3000 });
const dialogText = await page.locator('[data-id="confirm-dialog"]').innerText();
check("limit dialog title", dialogText.includes("대화 개수 한도"), dialogText.split("\n")[0]);
check("limit dialog max notice", dialogText.includes("최대 4개"));
check("limit dialog oldest named", dialogText.includes("첫번째 질문") && dialogText.includes("닫힘"));
await page.screenshot({ path: `${SHOT_DIR}/smoke-2-limit-dialog.png` });

// ⑥ 취소 → 모달 닫힘, 세션 유지
await page.locator('[data-id="confirm-dialog-cancel"]').click();
await page.waitForTimeout(200);
const dialogGone = (await page.locator('[data-id="confirm-dialog"]').count()) === 0;
const counterAfterCancel = await page.locator('[data-id="ai-chat-list"]').innerText();
check("cancel keeps sessions", dialogGone && counterAfterCancel.includes("4/4"));

// ⑦ 다시 새 대화 → 확인 → 최오래 닫히고 새 대화 활성
await page.locator('[data-id="ai-new-chat"]').click();
await page.waitForSelector('[data-id="confirm-dialog"]', { timeout: 3000 });
await page.locator('[data-id="confirm-dialog-confirm"]').click();
await page.waitForTimeout(300);
const counterAfterConfirm = await page.locator('[data-id="ai-chat-list"]').innerText();
check("confirm opens fresh chat", counterAfterConfirm.includes("4/4") && counterAfterConfirm.includes("새 대화"), counterAfterConfirm.replace(/\n/g, " "));
await page.locator('[data-id="ai-chat-list"]').click();
await page.waitForSelector('[data-id="ai-chat-list-menu"]', { timeout: 3000 });
const itemsAfter = await page.locator('[data-id="ai-chat-list-item"]').allInnerTexts();
check(
  "oldest evicted",
  itemsAfter.length === 4 && !itemsAfter.some((t) => t.includes("첫번째")),
  JSON.stringify(itemsAfter),
);
await page.locator("div.fixed.inset-0.z-20").click(); // 바깥 클릭으로 드롭다운 닫기
const storedAfter = await page.evaluate(
  (keys) => keys.map((key) => window.localStorage.getItem(key)),
  KEYS,
);
// 시드한 키 중 실제로 s1이 퇴출된(패널이 쓴) 스토어가 하나는 있어야 한다.
const evictedOk = storedAfter.some((raw) => {
  if (!raw) return false;
  const parsed = JSON.parse(raw);
  return parsed.sessions?.length === 4 && !parsed.sessions.some((s) => s.id === "s1");
});
check("localStorage evicted+added", evictedOk);

// ⑧ 구 포맷(flat array) 이행 — 리로드 후 단일 세션 복원
await page.evaluate((keys) => {
  for (const key of keys) {
    window.localStorage.setItem(
      key,
      JSON.stringify([
        { role: "user", content: "레거시 질문" },
        { role: "assistant", content: "레거시 답변" },
      ]),
    );
  }
}, KEYS);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".react-flow__node", { timeout: 60000 });
await openAiPanel();
const counterLegacy = await page.locator('[data-id="ai-chat-list"]').innerText();
const legacyMsg = await page.getByText("레거시 답변").count();
check("legacy migrated to 1 session", counterLegacy.includes("1/4") && counterLegacy.includes("레거시 질문"), counterLegacy.replace(/\n/g, " "));
check("legacy thread content", legacyMsg > 0);
await page.screenshot({ path: `${SHOT_DIR}/smoke-3-legacy.png` });

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
