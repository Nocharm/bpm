"use client";

// Word 인쇄 크기 패널 — A4 세로/가로 위에 그림이 차지할 실제 상대 크기를 보여 주고 그림 너비를 조절한다.
// 인쇄 크기(cm)·해상도(px·dpi)·노드 글자(pt)를 함께 보여 준다(계산은 lib/export getPrintPlan 단일 소스).
// PNG 내보내기 옵션 창(png-export-modal)이 Word 문서용일 때 오른쪽으로 펼쳐 쓴다.

import { RectangleHorizontal, RectangleVertical } from "lucide-react";

import {
  getPrintPlan,
  PAPER_ORIENTATIONS,
  PRINT_WIDTH_PCT_MAX,
  PRINT_WIDTH_PCT_MIN,
  type ExportFrame,
  type PaperOrientation,
  type PngExportOptions,
} from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface PngPrintPanelProps {
  frame: ExportFrame | null;
  options: PngExportOptions;
  onChange: (patch: Partial<PngExportOptions>) => void;
}

// 페이지 그림의 긴 변(px) — 패널 폭(300) 안에 세로·가로 모두 들어가게
const PAGE_LONG_PX = 220;
const A4_RATIO = 21 / 29.7;
const MARGIN_CM = 2.54;
const PRINT_WIDTH_STEP = 5;
// 판정 문턱 — 300dpi 이상은 인쇄 품질, 150 미만은 흐림 / 노드 제목 9pt 이상은 본문급, 7pt 미만은 읽기 어려움
const DPI_GOOD = 300;
const DPI_LOW = 150;
const PT_GOOD = 9;
const PT_TINY = 7;

type Tone = "good" | "mid" | "bad";
const TONE_CLASS: Record<Tone, string> = {
  good: "border-added/40 bg-added/10 text-added",
  mid: "border-changed/40 bg-changed/10 text-changed",
  bad: "border-error/40 bg-error/10 text-error",
};

const PAPER_LABEL_KEY: Record<PaperOrientation, MessageKey> = {
  portrait: "pngExport.paperPortrait",
  landscape: "pngExport.paperLandscape",
};

function getDpiTone(dpi: number): Tone {
  if (dpi >= DPI_GOOD) return "good";
  return dpi >= DPI_LOW ? "mid" : "bad";
}

function getTextTone(pt: number): Tone {
  if (pt >= PT_GOOD) return "good";
  return pt >= PT_TINY ? "mid" : "bad";
}

export function PngPrintPanel({ frame, options, onChange }: PngPrintPanelProps) {
  const { t } = useI18n();
  const isPortrait = options.paper === "portrait";
  const pageWidthPx = isPortrait ? PAGE_LONG_PX * A4_RATIO : PAGE_LONG_PX;
  const pageHeightPx = isPortrait ? PAGE_LONG_PX : PAGE_LONG_PX * A4_RATIO;
  const pxPerCm = pageWidthPx / (isPortrait ? 21 : 29.7);
  const marginPx = MARGIN_CM * pxPerCm;
  const plan = frame ? getPrintPlan(frame, options) : null;
  const figureWidthPx = plan ? plan.widthCm * pxPerCm : 0;
  const figureHeightPx = plan ? plan.heightCm * pxPerCm : 0;
  const contentWidthPx = pageWidthPx - marginPx * 2;
  // 본문 글줄 2줄 아래에 그림 — 페이지 본문 높이를 넘으면 한 페이지를 넘는다
  const figureTopPx = marginPx + 14;
  const isOverflow = figureTopPx + figureHeightPx > pageHeightPx - marginPx;
  const dpiTone = plan ? getDpiTone(plan.dpi) : "good";
  const textTone = plan ? getTextTone(plan.nodeTextPt) : "good";
  const textLabelKey: MessageKey =
    textTone === "good" ? "pngExport.textGood" : textTone === "mid" ? "pngExport.textSmall" : "pngExport.textTiny";
  const dpiLabelKey: MessageKey =
    dpiTone === "good" ? "pngExport.qualityPrint" : dpiTone === "mid" ? "pngExport.qualityScreen" : "pngExport.qualityLow";
  const bar = (top: number, widthPct: number) => (
    <span
      className="absolute h-[3px] rounded-full bg-divider transition-all duration-350 ease-smooth"
      style={{ top, left: marginPx, width: (contentWidthPx * widthPct) / 100 }}
    />
  );

  return (
    <div data-id="png-export-print-panel" className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-caption font-semibold text-ink">{t("pngExport.printTitle")}</span>
        <div className="inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
          {PAPER_ORIENTATIONS.map((paper) => (
            <button
              key={paper}
              type="button"
              data-id={`png-export-paper-${paper}`}
              aria-pressed={options.paper === paper}
              className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 ${
                options.paper === paper ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:text-ink-secondary"
              }`}
              onClick={() => onChange({ paper })}
            >
              {paper === "portrait" ? (
                <RectangleVertical size={14} strokeWidth={1.5} />
              ) : (
                <RectangleHorizontal size={14} strokeWidth={1.5} />
              )}
              {t(PAPER_LABEL_KEY[paper])}
            </button>
          ))}
        </div>
      </div>

      {/* 페이지 — 본문 글줄·그림·캡션이 실제 비율로 놓인다. 크기·용지 전환은 폭·높이 전이로 움직인다 */}
      <div className="flex h-[236px] items-center justify-center rounded-sm bg-surface-alt">
        <div
          data-id="png-export-print-page"
          className="relative overflow-hidden rounded-xs bg-surface shadow-md transition-all duration-350 ease-smooth"
          style={{ width: pageWidthPx, height: pageHeightPx }}
        >
          {bar(marginPx, 70)}
          {bar(marginPx + 6, 100)}
          {plan && (
            <span
              data-id="png-export-print-figure"
              className="absolute flex items-center justify-center overflow-hidden rounded-[2px] border border-accent bg-accent-tint text-[9px] text-accent transition-all duration-350 ease-smooth"
              style={{
                top: figureTopPx,
                left: marginPx + (contentWidthPx - figureWidthPx) / 2,
                width: figureWidthPx,
                height: figureHeightPx,
              }}
            >
              {figureHeightPx >= 12 ? t("pngExport.pageFigure") : null}
            </span>
          )}
          {plan && !isOverflow && (
            <>
              {bar(figureTopPx + figureHeightPx + 5, 40)}
              {bar(figureTopPx + figureHeightPx + 14, 100)}
              {bar(figureTopPx + figureHeightPx + 20, 100)}
              {bar(figureTopPx + figureHeightPx + 26, 85)}
            </>
          )}
        </div>
      </div>

      {plan ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-fine text-ink-secondary">
              {t("pngExport.printWidth")}
              <span data-id="png-export-print-width-value" className="text-ink">
                {`${plan.widthCm.toFixed(1)} cm · ${options.printWidthPct}%`}
              </span>
            </span>
            <input
              type="range"
              data-id="png-export-print-width"
              min={PRINT_WIDTH_PCT_MIN}
              max={PRINT_WIDTH_PCT_MAX}
              step={PRINT_WIDTH_STEP}
              value={options.printWidthPct}
              onChange={(event) => onChange({ printWidthPct: Number(event.target.value) })}
              className="w-full"
              style={{ accentColor: "var(--color-accent)" }}
            />
          </label>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-fine">
            <dt className="text-ink-tertiary">{t("pngExport.printDims")}</dt>
            <dd data-id="png-export-print-dims" className="text-ink">
              {`${plan.widthCm.toFixed(1)} × ${plan.heightCm.toFixed(1)} cm`}
            </dd>
            <dt className="text-ink-tertiary">{t("pngExport.resolution")}</dt>
            <dd className="flex flex-wrap items-center gap-1.5 text-ink">
              <span data-id="png-export-print-dpi">
                {`${Math.round(plan.pixelWidth).toLocaleString()} px · ${Math.round(plan.dpi)} dpi`}
              </span>
              <span className={`rounded-xs border px-1 ${TONE_CLASS[dpiTone]}`}>{t(dpiLabelKey)}</span>
            </dd>
            <dt className="text-ink-tertiary">{t("pngExport.nodeText")}</dt>
            <dd className="flex flex-wrap items-center gap-1.5 text-ink">
              <span data-id="png-export-print-pt">{`≈ ${plan.nodeTextPt.toFixed(1)} pt`}</span>
              <span className={`rounded-xs border px-1 ${TONE_CLASS[textTone]}`}>{t(textLabelKey)}</span>
            </dd>
          </dl>
          {(textTone !== "good" || isOverflow) && (
            <p className="text-fine text-ink-tertiary">
              {isOverflow ? t("pngExport.overflowPage") : t("pngExport.textTip")}
            </p>
          )}
          <p className="text-fine text-ink-muted">{t("pngExport.wordInsertNote")}</p>
        </>
      ) : (
        <p className="text-fine text-ink-tertiary">{t("pngExport.noNodes")}</p>
      )}
    </div>
  );
}
