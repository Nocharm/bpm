// PNG 내보내기 옵션 기억(Word 문서용 테마 선택) 단위 테스트
import { afterEach, describe, expect, it } from "vitest";

import {
  findAxisRuns,
  getA4GuideWidths,
  findCrossings,
  getPrintPlan,
  loadPngExportOptions,
  savePngExportOptions,
  setPngDpi,
} from "./export";

afterEach(() => {
  window.localStorage.clear();
});

describe("loadPngExportOptions", () => {
  it("returns the canvas default when nothing is stored", () => {
    expect(loadPngExportOptions()).toEqual({
      theme: "screen",
      wordStyle: "navy",
      showParallel: true,
      showInfo: true,
      crossing: "jump",
      paper: "portrait",
      printWidthPct: 100,
      expandIo: false,
    });
  });

  it("round-trips the last saved choice", () => {
    const saved = {
      theme: "word",
      wordStyle: "mono",
      showParallel: false,
      showInfo: true,
      crossing: "gap",
      paper: "landscape",
      printWidthPct: 60,
      expandIo: true,
    } as const;
    savePngExportOptions(saved);
    expect(loadPngExportOptions()).toEqual(saved);
  });

  it("falls back per field when the stored value is broken", () => {
    window.localStorage.setItem(
      "bpm.pngExport",
      JSON.stringify({
        theme: "dark",
        wordStyle: "rose",
        showParallel: "yes",
        showInfo: false,
        crossing: "bridge",
        paper: "letter",
        printWidthPct: 140,
        expandIo: "yes",
      }),
    );
    expect(loadPngExportOptions()).toEqual({
      theme: "screen",
      wordStyle: "navy",
      showParallel: true,
      showInfo: false,
      crossing: "jump",
      paper: "portrait",
      printWidthPct: 100,
      expandIo: false,
    });
  });

  it("ignores unparsable JSON", () => {
    window.localStorage.setItem("bpm.pngExport", "{not json");
    expect(loadPngExportOptions().theme).toBe("screen");
  });
});

// 직선 점열 — 끝점 포함 step 간격 샘플
const line = (x0: number, y0: number, x1: number, y1: number, step = 2) => {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const count = Math.round(length / step);
  return Array.from({ length: count + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / count, y: y0 + ((y1 - y0) * i) / count }));
};

describe("findAxisRuns", () => {
  it("splits an orthogonal path into horizontal and vertical runs", () => {
    const points = [...line(0, 0, 40, 0), ...line(40, 0, 40, 30).slice(1)];
    expect(findAxisRuns(points, 0)).toEqual([
      { axis: "h", at: 0, from: 0, to: 40, edge: 0 },
      { axis: "v", at: 40, from: 0, to: 30, edge: 0 },
    ]);
  });

  it("drops diagonal steps such as rounded corners", () => {
    expect(findAxisRuns(line(0, 0, 30, 30), 0)).toEqual([]);
  });
});

describe("findCrossings", () => {
  it("finds a horizontal run passing through another edge's vertical run", () => {
    const runs = [...findAxisRuns(line(0, 50, 100, 50), 0), ...findAxisRuns(line(40, 0, 40, 100), 1)];
    expect(findCrossings(runs)).toEqual([{ x: 40, y: 50 }]);
  });

  it("ignores T-junctions where a run ends on the other line", () => {
    const runs = [...findAxisRuns(line(0, 50, 40, 50), 0), ...findAxisRuns(line(40, 0, 40, 100), 1)];
    expect(findCrossings(runs)).toEqual([]);
  });

  it("ignores runs of the same edge and merges duplicate points", () => {
    const self = [...findAxisRuns(line(0, 50, 100, 50), 0), ...findAxisRuns(line(40, 0, 40, 100), 0)];
    expect(findCrossings(self)).toEqual([]);
    // 두 갈래가 같은 세로 줄기를 공유하면 교차는 한 번만 그린다
    const shared = [
      ...findAxisRuns(line(0, 50, 100, 50), 0),
      ...findAxisRuns(line(40, 0, 40, 100), 1),
      ...findAxisRuns(line(40, 0, 40, 90), 2),
    ];
    expect(findCrossings(shared)).toEqual([{ x: 40, y: 50 }]);
  });
});

describe("getPrintPlan", () => {
  it("fits the A4 portrait text width and raises the pixel ratio toward 300 dpi", () => {
    // 1000px 폭 맵을 본문 폭(21-5.08=15.92cm) 100%로 — 2배면 약 319dpi라 배율 2 유지
    const plan = getPrintPlan({ width: 1000, height: 500, zoom: 1 }, { paper: "portrait", printWidthPct: 100, showInfo: false });
    expect(plan.contentWidthCm).toBeCloseTo(15.92);
    expect(plan.widthCm).toBeCloseTo(15.92);
    expect(plan.heightCm).toBeCloseTo(7.96);
    expect(plan.pixelRatio).toBe(2);
    expect(plan.dpi).toBeCloseTo(2000 / (15.92 / 2.54));
    // 14px 제목이 15.92cm/1000px 축척으로 → 약 6.3pt
    expect(plan.nodeTextPt).toBeCloseTo((14 * (15.92 / 2.54) * 72) / 1000);
  });

  it("uses a higher pixel ratio for a narrow frame printed wide, capped at 4", () => {
    const plan = getPrintPlan({ width: 400, height: 400, zoom: 1 }, { paper: "landscape", printWidthPct: 100, showInfo: false });
    expect(plan.pixelRatio).toBe(4);
    expect(plan.pixelWidth).toBe(1600);
  });

  it("keeps the longest output side under the canvas cap", () => {
    const plan = getPrintPlan({ width: 4096, height: 4096, zoom: 0.5 }, { paper: "landscape", printWidthPct: 100, showInfo: true });
    expect(plan.pixelRatio).toBe(2);
    expect(plan.nodeTextPt).toBeCloseTo((7 * (24.62 / 2.54) * 72) / 4096);
  });
});

describe("getA4GuideWidths", () => {
  it("returns the frame widths that print node titles at 9pt and 7pt", () => {
    const portrait = getA4GuideWidths("portrait");
    expect(portrait.readable).toBeCloseTo((14 * (15.92 / 2.54) * 72) / 9);
    expect(portrait.minimum).toBeCloseTo((14 * (15.92 / 2.54) * 72) / 7);
    // 가이드 폭으로 찍으면 인쇄 계획이 정확히 9pt를 낸다(두 계산이 같은 식)
    const plan = getPrintPlan({ width: portrait.readable, height: 400, zoom: 1 }, { paper: "portrait", printWidthPct: 100, showInfo: false });
    expect(plan.nodeTextPt).toBeCloseTo(9);
    expect(getA4GuideWidths("landscape").readable).toBeGreaterThan(portrait.readable);
  });
});

describe("setPngDpi", () => {
  it("inserts a pHYs chunk with pixels per metre right after IHDR", () => {
    const png = new Uint8Array(8 + 25 + 12);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = setPngDpi(png, 300);
    expect(out.length).toBe(png.length + 21);
    const view = new DataView(out.buffer);
    expect(view.getUint32(33)).toBe(9);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe("pHYs");
    expect(view.getUint32(41)).toBe(11811); // 300 / 0.0254
    expect(out[49]).toBe(1);
    // CRC32("pHYs" + data) — zlib.crc32로 구한 기대값
    expect(view.getUint32(50)).toBe(0x78a53f76);
  });
});
