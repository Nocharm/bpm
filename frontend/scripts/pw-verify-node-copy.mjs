// Ctrl+C / Ctrl+V 노드 복사·붙여넣기 — 브라우저 실기동 검증 (Task 1.3, FIX1 누적 오프셋 반영).
// 시나리오: ①단일 노드 선택→Ctrl+C→Ctrl+V: "(2)" 중복라벨 + findFreeSpot 보정 오프셋으로 붙여넣기, 새 노드가 유일 선택
//           ①-b 같은 클립보드로 연속 Ctrl+V(새 복사 없음): 직전 붙여넣기와 같은 자리에 쌓이지 않고 더 멀리 대각선 이동(누적 오프셋)
//           ②start 노드(비복사 타입) 선택→Ctrl+C: copy.blocked 토스트 노출 + 클립보드 미변경
//           ③다중선택(2노드+내부 엣지) Ctrl+C→Ctrl+V: 노드 2개 + 엣지 1개 함께 복제(공유 오프셋, 개별 findFreeSpot 없음)
//           ④크로스탭 — 같은 브라우저 컨텍스트의 다른 탭(같은 origin=localStorage 공유)에서 Ctrl+V → 붙여넣기 성공
//           ⑤＋메뉴로 노드 추가 직후(클릭 없이) Ctrl+C→Ctrl+V — 새 노드가 즉시 selected:true라 재클릭 없이 복사 가능해야 함(FIX4)
//           ⑥콘솔 에러 0
//
// NOTE(FIX1 리뷰 반영): 단일 노드 붙여넣기는 이제 raw {16,16} 오프셋 뒤에 findFreeSpot(handleAddNode와 동일 로직)을
// 한 번 더 통과한다. NODE_HEIGHT=52(lib/canvas.ts)라 hit 문턱(0.7배)이 y축 36.4px밖에 안 되고, raw {16,16}은 원본과
// 여전히 겹침 판정이라 findFreeSpot이 28px씩 밀어낸다 — 이 픽스처(원본 pos_x=470/pos_y=380) 기준 실측값은 아래 참고.
//   1회 연속 붙여넣기: {16,16} raw → hit(원본과 겹침) → 1회 보정 → 최종 오프셋 {44,44}
//   2회 연속 붙여넣기(같은 클립보드): {32,32} raw → hit(원본·1차 사본 모두와 겹침) → 2회 보정 → 최종 오프셋 {88,88}
// 즉 "(a) pasted node is offset by +16/+16" 단정은 findFreeSpot 도입으로 더 이상 성립하지 않음 — 겹침 회피가
// 의도된 동작이므로, 아래 단정은 실측 좌표(+44/+44, +88/+88)로 갱신하고 "직전 붙여넣기보다 항상 더 멀어진다"는
// 단조성 체크를 추가해 findFreeSpot 상수(28px 스텝)가 바뀌어도 핵심 회귀(같은 자리에 쌓임)는 계속 잡히게 한다.
//
// 실행 (frontend/ 에서): node scripts/pw-verify-node-copy.mjs
// 전제: backend :8000(reset_db 시드 무관 — API로 맵을 새로 만듦), frontend :3000, playwright-core(--no-save)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// 앱은 event.ctrlKey || event.metaKey 둘 다 받으므로 플랫폼에 맞는 조합키 문자열 사용(csv-create-flow 검증 스크립트와 동일 관례).
const COPY_KEY = process.platform === "darwin" ? "Meta+C" : "Control+C";
const PASTE_KEY = process.platform === "darwin" ? "Meta+V" : "Control+V";

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
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

const rid = () =>
  Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

// 노드 표시좌표(flow 단위) — RF가 .react-flow__node에 쓰는 translate(x,y) transform을 그대로 읽는다.
const readNodePos = (targetPage, id) =>
  targetPage.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    if (!el) return null;
    const m = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }, id);

const idByText = (targetPage, text) =>
  targetPage.locator(".react-flow__node", { hasText: text }).first().getAttribute("data-id");

// ── 서버 프로브 ──
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
  console.error(`FATAL backend not reachable (GET /api/maps → ${backendStatus})`);
  await browser.close();
  process.exit(1);
}

let mapId = null;
try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  // 시작→A→B→끝 체인 — A(단일 복사 대상), A+B(다중선택+내부 엣지), 시작(비복사 타입 차단) 시나리오를 한 맵에서 커버.
  const s = rid();
  const a = rid();
  const b = rid();
  const e = rid();
  const created = await api("/maps", {
    method: "POST",
    body: {
      name: `Node-Copy Verify ${stamp}`,
      description: "",
      visibility: "public",
      owning_department: owningDept,
    },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;
  // 그래프 교체는 체크아웃 보유가 필수(운영자든 오너든 무조건 — backend/app/routers/graph.py replace_graph).
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      // pos는 캔버스 원점에서 충분히 아래·오른쪽으로 — 기본 줌에서 좌상단 MapTitleChecklist 칩
      // (components/save-checklist.tsx, 캔버스 top-left 고정) 밑에 노드가 깔려 클릭이 가로채이는 것을 방지.
      nodes: [
        { id: s, title: "Start", node_type: "start", pos_x: 250, pos_y: 480, sort_order: 0 },
        { id: a, title: "Step A", node_type: "process", pos_x: 470, pos_y: 380, sort_order: 1 },
        { id: b, title: "Step B", node_type: "process", pos_x: 470, pos_y: 580, sort_order: 2 },
        { id: e, title: "End", node_type: "end", pos_x: 690, pos_y: 480, sort_order: 3, is_primary_end: true },
      ],
      edges: [
        { id: rid(), source_node_id: s, target_node_id: a },
        { id: rid(), source_node_id: a, target_node_id: b },
        { id: rid(), source_node_id: b, target_node_id: e },
      ],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(500);

  // ===== (a) 단일 노드 선택→Ctrl+C→Ctrl+V: "(2)" 중복라벨 + {16,16} 오프셋, 새 노드가 유일 선택 =====
  const beforeCountA = await page.locator(".react-flow__node").count();
  // force:true — 좌상단 크롬(체크리스트 칩 등)이 노드를 가릴 때 actionability 타임아웃을 피함(노드 위치도 이미 원점에서 이격).
  await page.locator(`.react-flow__node[data-id="${a}"]`).click({ force: true });
  const beforePosA = await readNodePos(page, a);
  await page.keyboard.press(COPY_KEY);
  await page.waitForTimeout(150);
  await page.keyboard.press(PASTE_KEY);
  await page.waitForTimeout(300);

  const afterCountA = await page.locator(".react-flow__node").count();
  check("(a) paste adds exactly 1 node", afterCountA === beforeCountA + 1, `before=${beforeCountA} after=${afterCountA}`);

  const dupLabelCount = await page.locator(".react-flow__node", { hasText: "Step A (2)" }).count();
  check('(a) pasted node shows "Step A (2)" dedup label', dupLabelCount === 1, `count=${dupLabelCount}`);

  const dupId = await idByText(page, "Step A (2)");
  const dupPos = dupId ? await readNodePos(page, dupId) : null;
  // raw {16,16}은 원본(52px 높이)과 여전히 겹치므로 findFreeSpot이 한 번 더 밀어내 {44,44}에 안착(위 NOTE 참고).
  check(
    "(a) pasted node lands clear of the source via findFreeSpot (+44/+44, not raw +16/+16)",
    !!(dupPos && beforePosA && dupPos.x === beforePosA.x + 44 && dupPos.y === beforePosA.y + 44),
    `before=${JSON.stringify(beforePosA)} pasted=${JSON.stringify(dupPos)}`,
  );

  const selectedAfterPasteA = await page.locator(".react-flow__node.selected").count();
  check("(a) pasted node becomes the sole selection", selectedAfterPasteA === 1, `selected=${selectedAfterPasteA}`);

  // ===== (a2) 같은 클립보드로 연속 Ctrl+V(새 복사 없음) — 누적 오프셋이 직전 붙여넣기 위로 안 쌓이고 더 멀어져야 함 =====
  const beforeCountA2 = await page.locator(".react-flow__node").count();
  await page.keyboard.press(PASTE_KEY);
  await page.waitForTimeout(300);
  const afterCountA2 = await page.locator(".react-flow__node").count();
  check(
    "(a2) consecutive paste (same clipboard) adds another node",
    afterCountA2 === beforeCountA2 + 1,
    `before=${beforeCountA2} after=${afterCountA2}`,
  );
  const dup2Id = await idByText(page, "Step A (3)");
  const dup2Pos = dup2Id ? await readNodePos(page, dup2Id) : null;
  check(
    "(a2) second consecutive paste is not stacked on the first paste (moves further diagonally)",
    !!(dup2Pos && dupPos && dup2Pos.x > dupPos.x && dup2Pos.y > dupPos.y),
    `first=${JSON.stringify(dupPos)} second=${JSON.stringify(dup2Pos)}`,
  );
  // 실측값(위 NOTE) — {32,32} raw가 원본·1차 사본 모두와 겹쳐 findFreeSpot이 2회 보정, 누적 오프셋 {88,88}.
  check(
    "(a2) second consecutive paste lands at the accumulated +88/+88 offset from the source",
    !!(dup2Pos && beforePosA && dup2Pos.x === beforePosA.x + 88 && dup2Pos.y === beforePosA.y + 88),
    `before=${JSON.stringify(beforePosA)} pasted=${JSON.stringify(dup2Pos)}`,
  );

  // ===== (b) start 노드(비복사 타입) 선택→Ctrl+C: copy.blocked 토스트 + 클립보드 미변경 =====
  const clipBefore = await page.evaluate(() => window.localStorage.getItem("bpm.nodeClipboard"));
  await page.locator(`.react-flow__node[data-id="${s}"]`).click({ force: true });
  await page.keyboard.press(COPY_KEY);
  await page.waitForTimeout(200);
  const blockedToastVisible = await page
    .getByText("can't be copied", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  check("(b) copying a start node shows the copy.blocked toast", blockedToastVisible);
  const clipAfter = await page.evaluate(() => window.localStorage.getItem("bpm.nodeClipboard"));
  check("(b) clipboard unchanged after a blocked copy", clipAfter === clipBefore);

  // ===== (c) 다중선택(A+B, 내부 엣지 포함) Ctrl+C→Ctrl+V: 노드 2개 + 엣지 1개 함께 복제 =====
  // 자체 try/catch — (c)가 던져도 (d)가 건너뛰어지지 않도록 격리. 실패 시 실패 체크를 기록해 non-zero 종료는 유지.
  try {
    const beforeCountC = await page.locator(".react-flow__node").count();
    const beforeEdgeCountC = await page.locator(".react-flow__edge").count();
    await page.locator(`.react-flow__node[data-id="${a}"]`).click({ force: true });
    await page.keyboard.down("Meta"); // RF 기본 multiSelectionKeyCode="Meta" — shift-drag 검증 스크립트와 동일 관례
    await page.locator(`.react-flow__node[data-id="${b}"]`).click({ force: true });
    await page.keyboard.up("Meta");
    await page.waitForTimeout(150);
    const multiSelectedCount = await page.locator(".react-flow__node.selected").count();
    check("(c) multi-select picks up 2 nodes", multiSelectedCount === 2, `selected=${multiSelectedCount}`);

    await page.keyboard.press(COPY_KEY);
    await page.waitForTimeout(150);
    await page.keyboard.press(PASTE_KEY);
    await page.waitForTimeout(300);

    const afterCountC = await page.locator(".react-flow__node").count();
    const afterEdgeCountC = await page.locator(".react-flow__edge").count();
    check("(c) paste adds exactly 2 nodes", afterCountC === beforeCountC + 2, `before=${beforeCountC} after=${afterCountC}`);
    check(
      "(c) paste adds exactly 1 internal edge (A→B)",
      afterEdgeCountC === beforeEdgeCountC + 1,
      `before=${beforeEdgeCountC} after=${afterEdgeCountC}`,
    );
  } catch (err) {
    check("(c) multi-select copy/paste ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (d) 크로스탭 — 같은 컨텍스트의 다른 탭(같은 origin → localStorage 공유)에서 Ctrl+V =====
  // note: 다른 맵으로 붙여넣는 크로스맵 케이스(뷰포트 중앙 오프셋)는 여기서 별도 커버하지 않음 — 오프셋 계산 로직은
  // handlePaste 코드 리뷰로 확인(cross-map 분기), 별도 맵을 여는 브라우저 왕복은 이 스크립트 범위 밖으로 남김.
  // (c)와 독립된 try/catch — 위가 실패해도 여기는 항상 실행되고, 여기 실패도 별도 체크로 기록된다.
  try {
    const page2 = await ctx.newPage();
    const consoleErrors2 = [];
    page2.on("console", (m) => {
      if (m.type() === "error") consoleErrors2.push(m.text());
    });
    page2.on("pageerror", (e) => consoleErrors2.push(`pageerror: ${e.message}`));
    await page2.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
    await page2.waitForSelector(".react-flow__node", { timeout: 20000 });
    await page2.waitForTimeout(500);
    const beforeCountD = await page2.locator(".react-flow__node").count();
    await page2.keyboard.press(PASTE_KEY); // 조합키 핸들러는 window 레벨이라 별도 포커스 불필요
    await page2.waitForTimeout(300);
    const afterCountD = await page2.locator(".react-flow__node").count();
    check(
      "(d) cross-tab paste reads the shared localStorage clipboard (same map, new tab)",
      afterCountD > beforeCountD,
      `before=${beforeCountD} after=${afterCountD}`,
    );
    consoleErrors.push(...consoleErrors2);
    await page2.close();
  } catch (err) {
    check("(d) cross-tab paste ran without throwing", false, err instanceof Error ? err.message : String(err));
  }

  // ===== (e) FIX4 — ＋메뉴로 노드를 추가한 직후(재클릭 없이) Ctrl+C→Ctrl+V가 그 노드를 복사해야 함 =====
  // 별도 탭에서 실행 — (a)~(d)가 남긴 클립보드/선택 상태와 격리해, 버그가 있어도 이전 클립보드가 우연히
  // 붙여넣기 돼 거짓 통과가 나오는 것을 방지한다.
  try {
    const page3 = await ctx.newPage();
    const consoleErrors3 = [];
    page3.on("console", (m) => {
      if (m.type() === "error") consoleErrors3.push(m.text());
    });
    page3.on("pageerror", (e) => consoleErrors3.push(`pageerror: ${e.message}`));
    await page3.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
    await page3.waitForSelector(".react-flow__node", { timeout: 20000 });
    await page3.waitForTimeout(500);
    await page3.evaluate(() => window.localStorage.removeItem("bpm.nodeClipboard"));

    const beforeCountE = await page3.locator(".react-flow__node").count();
    await page3.getByRole("button", { name: "Node", exact: true }).click();
    await page3.getByRole("button", { name: "Process", exact: true }).click();
    await page3.waitForTimeout(200);

    const afterAddCountE = await page3.locator(".react-flow__node").count();
    check("(e) + menu adds a new node", afterAddCountE === beforeCountE + 1, `before=${beforeCountE} after=${afterAddCountE}`);

    const selectedAfterAddE = await page3.locator(".react-flow__node.selected").count();
    check(
      "(e) FIX4: newly added node is selected immediately (no click needed)",
      selectedAfterAddE === 1,
      `selected=${selectedAfterAddE}`,
    );

    // 클릭 없이 곧바로 복사→붙여넣기
    await page3.keyboard.press(COPY_KEY);
    await page3.waitForTimeout(150);
    await page3.keyboard.press(PASTE_KEY);
    await page3.waitForTimeout(300);

    const afterPasteCountE = await page3.locator(".react-flow__node").count();
    check(
      "(e) FIX4: Ctrl+C→Ctrl+V right after add (no re-click) pastes exactly 1 copy",
      afterPasteCountE === afterAddCountE + 1,
      `afterAdd=${afterAddCountE} afterPaste=${afterPasteCountE}`,
    );

    consoleErrors.push(...consoleErrors3);
    await page3.close();
  } catch (err) {
    check("(e) add-then-copy-paste ran without throwing", false, err instanceof Error ? err.message : String(err));
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("no console errors across the run", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
