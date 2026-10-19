// 비교 화면 PNG 옵션 기억·프레임 계산 단위 테스트
import { afterEach, describe, expect, it } from "vitest";

import { getCompareDocumentChromePt, getPrintHeaderPt, measureCompareFrame, PRINT_LEGEND_ROW_PT } from "./export";
import {
  DEFAULT_COMPARE_PNG_EXPORT_OPTIONS,
  loadComparePngExportOptions,
  saveComparePngExportOptions,
} from "./compare-png-export";

afterEach(() => {
  window.localStorage.clear();
});

describe("loadComparePngExportOptions", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(loadComparePngExportOptions()).toEqual(DEFAULT_COMPARE_PNG_EXPORT_OPTIONS);
  });

  it("round-trips the last saved choice", () => {
    const saved = {
      format: "document",
      showLegend: false,
      showInfo: true,
      paper: "portrait",
      printWidthPct: 70,
      edgeFan: false,
      layout: "split",
    } as const;
    saveComparePngExportOptions(saved);
    expect(loadComparePngExportOptions()).toEqual(saved);
  });

  it("falls back per field when the stored value is broken", () => {
    window.localStorage.setItem(
      "bpm.comparePngExport",
      JSON.stringify({
        format: "word",
        showLegend: "yes",
        showInfo: false,
        paper: "letter",
        printWidthPct: 10,
        edgeFan: 1,
        layout: "pages",
      }),
    );
    expect(loadComparePngExportOptions()).toEqual({
      ...DEFAULT_COMPARE_PNG_EXPORT_OPTIONS,
      showInfo: false,
    });
  });

  it("ignores non-object and unparsable values", () => {
    window.localStorage.setItem("bpm.comparePngExport", "42");
    expect(loadComparePngExportOptions()).toEqual(DEFAULT_COMPARE_PNG_EXPORT_OPTIONS);
    window.localStorage.setItem("bpm.comparePngExport", "{broken");
    expect(loadComparePngExportOptions()).toEqual(DEFAULT_COMPARE_PNG_EXPORT_OPTIONS);
  });
});

describe("measureCompareFrame", () => {
  it("never enlarges a small map and centres it in the minimum frame", () => {
    const frame = measureCompareFrame({ x: 100, y: 50, width: 120, height: 60 });
    expect(frame.zoom).toBe(1);
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(320);
    // 경계 가운데가 프레임 가운데
    expect(frame.x + (100 + 60) * frame.zoom).toBeCloseTo(160);
    expect(frame.y + (50 + 30) * frame.zoom).toBeCloseTo(160);
  });

  it("keeps a mid-size map at zoom 1 with the bounds plus padding", () => {
    const frame = measureCompareFrame({ x: -20, y: 0, width: 1800, height: 700 });
    expect(frame.zoom).toBe(1);
    expect(frame.width).toBe(1880);
    expect(frame.height).toBe(780);
    expect(frame.x).toBe(60);
    expect(frame.y).toBe(40);
  });

  it("shrinks a huge map to the side cap", () => {
    const frame = measureCompareFrame({ x: 0, y: 0, width: 8000, height: 1000 });
    expect(frame.width).toBe(4096);
    expect(frame.zoom).toBeCloseTo((4096 - 80) / 8000);
    expect(frame.height).toBe(Math.ceil(1000 * frame.zoom) + 80);
  });
});

describe("getCompareDocumentChromePt", () => {
  it("adds the two-line info header and the legend row at print size only when shown", () => {
    expect(getCompareDocumentChromePt({ showInfo: false, showLegend: false })).toBe(0);
    expect(getCompareDocumentChromePt({ showInfo: true, showLegend: true })).toBe(
      getPrintHeaderPt(2) + PRINT_LEGEND_ROW_PT,
    );
  });
});
