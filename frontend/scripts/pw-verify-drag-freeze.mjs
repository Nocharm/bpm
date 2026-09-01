// 일반 드래그 동결(#R2) 행동 회귀 스위트 — 자체 맵 생성 후: ①단일 드래그 중간 프레임 커서 1:1 +
// 드롭 저장/리로드 영속 ②Shift 중간 프레임 축고정(이탈 0) ④다중선택 드래그 동반 이동+영속
// ⑥그룹 멤버 드래그 중 그룹박스 실시간 추종(멤버는 동결 제외 경로) ⑧드롭존 링 dwell 표시/경계 이탈 해제
// ⑩드래그 1회=undo 1회 원위치 → 맵 삭제. 존 드롭 실행은 pw-verify-zone-swap.mjs 별도.
// 실행 (frontend/): node scripts/pw-verify-drag-freeze.mjs  (기본 3000, BASE_URL로 변경)
// 전제: backend + frontend 기동, playwright-core(--no-save), 시스템 Chrome.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
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

const flowPos = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"]`);
    const m = el?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }, id);

const zoomOf = () =>
  page.evaluate(() => {
    const vp = document.querySelector(".react-flow__viewport");
    const m = vp?.style.transform.match(/scale\(([\d.]+)\)/);
    return m ? +m[1] : 1;
  });

const centerOf = async (id) => {
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

let mapId = null;
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  const dept = (await api("/directory")).departments[0].id;
  const created = await api("/maps", {
    method: "POST",
    body: { name: `R2-Suite ${Date.now()}`, description: "", visibility: "public", owning_department: dept },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;
  await api(`/versions/${versionId}/checkout`, { method: "POST", body: { force: true } });
  const P = `r2s${Date.now().toString(36)}`;
  const N = (id, title, x, y, node_type = "process") => ({ id: `${P}-${id}`, node_type, title, pos_x: x, pos_y: y });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        N("start", "Start", 0, 0, "start"),
        N("end", "End", 1300, 0, "end"),
        N("a", "Single", 0, 300),
        N("b", "Multi B", 420, 300),
        N("c", "Multi C", 420, 470),
        N("g1", "Grp One", 0, 700),
        N("g2", "Grp Two", 280, 700),
        N("t1", "Ring Src", 900, 300),
        N("t2", "Ring Dst", 900, 560),
      ],
      edges: [],
    },
  });
  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`.react-flow__node[data-id="${P}-a"]`, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const zoom = await zoomOf();

  // ===== ① 단일 드래그 — 중간 프레임 커서 1:1 + 드롭 후 저장/리로드 영속 =====
  {
    const id = `${P}-a`;
    const start = await centerOf(id);
    const p0 = await flowPos(id);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 6, start.y + 6, { steps: 1 });
    await page.waitForTimeout(60);
    const base = await flowPos(id);
    const baseCursor = { x: start.x + 6, y: start.y + 6 };
    let maxDrift = 0;
    const steps = 14;
    const dx = 200;
    const dy = 130;
    for (let i = 1; i <= steps; i += 1) {
      const cx = baseCursor.x + (dx * i) / steps;
      const cy = baseCursor.y + (dy * i) / steps;
      await page.mouse.move(cx, cy, { steps: 1 });
      await page.waitForTimeout(35);
      const cur = await flowPos(id);
      const wantX = base.x + (cx - baseCursor.x) / zoom;
      const wantY = base.y + (cy - baseCursor.y) / zoom;
      maxDrift = Math.max(maxDrift, Math.hypot(cur.x - wantX, cur.y - wantY));
    }
    await page.mouse.up();
    // 임계 9px — 드래그 활성화 임계+줌 양자화 아티팩트로 ~8px가 나오며 최적화/베이스라인 빌드에서
    // 동일 수치임을 확인(2026-09-01). 실제 추종 깨짐(동결 스냅백 등)은 수십~수백 px로 나타난다.
    check("① 단일 드래그 중간 프레임 커서 1:1 (drift ≤ 9 flow px)", maxDrift <= 9, `maxDrift=${maxDrift.toFixed(1)}`);
    await page.waitForTimeout(3000); // autosave 2s 디바운스
    const disp = await flowPos(id);
    const saved = (await api(`/versions/${versionId}/graph`)).nodes.find((n) => n.id === id);
    check(
      "① 드롭 후 저장좌표 = 표시좌표",
      Math.abs(saved.pos_x - disp.x) <= 1 && Math.abs(saved.pos_y - disp.y) <= 1,
      `saved=(${saved.pos_x},${saved.pos_y}) disp=(${disp.x},${disp.y})`,
    );
    const moved = Math.hypot(disp.x - p0.x, disp.y - p0.y);
    check("① 실제 이동 발생(≥100px)", moved >= 100, `moved=${moved.toFixed(0)}`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(`.react-flow__node[data-id="${id}"]`, { timeout: 20000 });
    await page.waitForTimeout(1200);
    const afterReload = await flowPos(id);
    check(
      "① 리로드 후 위치 영속",
      Math.abs(afterReload.x - saved.pos_x) <= 1 && Math.abs(afterReload.y - saved.pos_y) <= 1,
      `reload=(${afterReload.x},${afterReload.y})`,
    );
  }

  // ===== ② Shift 축고정 — 드래그 "중간 프레임"에서 축 이탈 0 =====
  {
    const id = `${P}-a`;
    const start = await centerOf(id);
    const y0 = (await flowPos(id)).y;
    await page.keyboard.down("Shift");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    let maxYDev = 0;
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(start.x + i * 14, start.y + i * 9, { steps: 1 });
      await page.waitForTimeout(35);
      const cur = await flowPos(id);
      maxYDev = Math.max(maxYDev, Math.abs(cur.y - y0));
    }
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForTimeout(300);
    const yEnd = (await flowPos(id)).y;
    check("② Shift 중간 프레임 y 이탈 0 (≤1px)", maxYDev <= 1, `maxYDev=${maxYDev.toFixed(2)}`);
    check("② Shift 드롭 후에도 y 고정", Math.abs(yEnd - y0) <= 1, `y0=${y0} yEnd=${yEnd}`);
  }

  // ===== ④ 다중선택(노드잡기) 무Shift 드래그 — 동반 이동 + 영속 =====
  {
    const b = `${P}-b`;
    const c = `${P}-c`;
    await page.locator(`.react-flow__node[data-id="${b}"]`).click();
    await page.keyboard.down("Meta");
    await page.locator(`.react-flow__node[data-id="${c}"]`).click();
    await page.keyboard.up("Meta");
    await page.waitForTimeout(200);
    const b0 = await flowPos(b);
    const c0 = await flowPos(c);
    const start = await centerOf(b);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(start.x + i * 15, start.y + i * 8, { steps: 1 });
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(3000);
    const b1 = await flowPos(b);
    const c1 = await flowPos(c);
    const db = { x: b1.x - b0.x, y: b1.y - b0.y };
    const dc = { x: c1.x - c0.x, y: c1.y - c0.y };
    check("④ 다중선택 드래그: 두 노드 동일 델타", Math.abs(db.x - dc.x) <= 1 && Math.abs(db.y - dc.y) <= 1, `db=${JSON.stringify(db)} dc=${JSON.stringify(dc)}`);
    check("④ 다중선택 드래그: 실제 이동", Math.hypot(db.x, db.y) >= 80, `moved=${Math.hypot(db.x, db.y).toFixed(0)}`);
    const graph = await api(`/versions/${versionId}/graph`);
    const sb = graph.nodes.find((n) => n.id === b);
    const sc = graph.nodes.find((n) => n.id === c);
    check(
      "④ 다중선택 드롭 영속(저장=표시)",
      Math.abs(sb.pos_x - b1.x) <= 1 && Math.abs(sb.pos_y - b1.y) <= 1 && Math.abs(sc.pos_x - c1.x) <= 1 && Math.abs(sc.pos_y - c1.y) <= 1,
      `sb=(${sb.pos_x},${sb.pos_y}) sc=(${sc.pos_x},${sc.pos_y})`,
    );
    await page.keyboard.press("Escape");
  }

  // ===== ⑥ 그룹박스 라이브 추종 — 멤버 드래그 중 이동 핸들이 실시간으로 따라온다 =====
  {
    const g1 = `${P}-g1`;
    const g2 = `${P}-g2`;
    await page.locator(`.react-flow__node[data-id="${g1}"]`).click();
    await page.keyboard.down("Meta");
    await page.locator(`.react-flow__node[data-id="${g2}"]`).click();
    await page.keyboard.press("g");
    await page.keyboard.up("Meta");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const handle = page.locator('[aria-label="Move group"]').first();
    check("⑥ 그룹 생성(이동 핸들 렌더)", (await handle.count()) > 0);
    const h0 = await handle.boundingBox();
    const start = await centerOf(g1);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 120, { steps: 4 });
    await page.waitForTimeout(120);
    // 드래그 유지 중(마우스 업 전) 박스 핸들 위치 실측 — 라이브 추종이면 이미 내려가 있어야 한다
    const hMid = await handle.boundingBox();
    await page.mouse.move(start.x + 40, start.y + 200, { steps: 4 });
    await page.waitForTimeout(120);
    const hMid2 = await handle.boundingBox();
    await page.mouse.up();
    await page.waitForTimeout(400);
    const followed = hMid && hMid.y - h0.y >= 60 && hMid2.y - hMid.y >= 40;
    check(
      "⑥ 멤버 드래그 중 그룹박스 실시간 추종",
      Boolean(followed),
      `h0.y=${h0?.y?.toFixed(0)} mid=${hMid?.y?.toFixed(0)} mid2=${hMid2?.y?.toFixed(0)}`,
    );
  }

  // ===== ⑧ 드롭존 링 — 겹침 dwell 시 표시, 이탈 시 해제 =====
  {
    const t1 = `${P}-t1`;
    const t2 = `${P}-t2`;
    const src = await centerOf(t1);
    const dst = await centerOf(t2);
    await page.mouse.move(src.x, src.y);
    await page.mouse.down();
    // t2 위로 끌고 가 dwell(300ms) 초과 대기
    await page.mouse.move(dst.x, dst.y, { steps: 8 });
    await page.waitForTimeout(650);
    await page.mouse.move(dst.x + 2, dst.y + 2, { steps: 1 }); // dwell 경과 후 재판정 트리거
    await page.waitForTimeout(200);
    const ringVisible = await page.getByText("Swap", { exact: true }).count();
    check("⑧ 겹침 dwell 후 드롭존 링 표시", ringVisible > 0, `swapLabels=${ringVisible}`);
    // 링 유지 경계 밖(왼쪽 위 빈 공간)으로 이탈 → 해제
    await page.mouse.move(dst.x - 420, dst.y - 200, { steps: 10 });
    await page.waitForTimeout(300);
    const ringGone = await page.getByText("Swap", { exact: true }).count();
    check("⑧ 링 경계 이탈 시 해제", ringGone === 0, `swapLabels=${ringGone}`);
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  // 존 드롭(swap) 실행 검증은 별도 스크립트 — pw-verify-zone-swap.mjs (클린 4노드 맵 전제라 안정적.
  // 이 스위트의 누적 상태·뷰포트에선 링 조준이 flaky해 분리했다, 2026-09-01).

  // ===== ⑩ undo — 드래그 1회가 undo 1회로 원위치 =====
  {
    const id = `${P}-a`;
    const before = await flowPos(id);
    const c = await centerOf(id);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 90, c.y + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = await flowPos(id);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(600);
    const undone = await flowPos(id);
    check(
      "⑩ 드래그 후 undo 1회로 원위치 복귀",
      Math.hypot(moved.x - before.x, moved.y - before.y) > 40 &&
        Math.abs(undone.x - before.x) <= 1 &&
        Math.abs(undone.y - before.y) <= 1,
      `before=${JSON.stringify(before)} moved=${JSON.stringify(moved)} undone=${JSON.stringify(undone)}`,
    );
  }
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("콘솔 에러 0", consoleErrors.length === 0, `${consoleErrors.length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
console.log(failed.length === 0 ? "PASS" : "FAIL");
process.exit(failed.length === 0 ? 0 : 1);
