"use client";

// PNG 내보내기 옵션 창 — 화면 그대로 / Word 문서용(스타일 3종·병렬 표시·맵 정보 블록 토글) 선택 + 샘플 흐름 미리보기.
// 미리보기 구성요소는 켜고 끌 때 쉬머로 생기고 사라진다(ShimmerPresence). 마지막 선택은 브라우저에 기억(lib/export).
// 에디터(maps/[mapId]/page.tsx)의 PNG 내보내기 진입점(인스펙터 버튼·우클릭 메뉴·Ctrl+⇧E)이 공유.

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PanelTop, X } from "lucide-react";

import { HoverTip } from "@/components/hover-tip";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { PngPrintPanel } from "@/components/png-print-panel";
import { resolveNodeStroke } from "@/components/process-node";
import { ShimmerPresence } from "@/components/shimmer-presence";
import {
  CROSSING_STYLES,
  loadPngExportOptions,
  savePngExportOptions,
  WORD_EXPORT_STYLES,
  type CrossingStyle,
  type ExportFrame,
  type PngExportOptions,
  type WordExportStyle,
} from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

interface PngExportModalProps {
  // 현재 맵의 캡처 프레임(lib/export measureExportFrame) — 인쇄 크기 패널의 비율·해상도 계산. 노드가 없으면 null
  frame: ExportFrame | null;
  onClose: () => void;
  onExport: (options: PngExportOptions) => void;
}

const STYLE_LABEL_KEY: Record<WordExportStyle, MessageKey> = {
  mono: "pngExport.styleMono",
  gray: "pngExport.styleGray",
  navy: "pngExport.styleNavy",
};

const CROSSING_LABEL_KEY: Record<CrossingStyle, MessageKey> = {
  none: "pngExport.crossingNone",
  jump: "pngExport.crossingJump",
  gap: "pngExport.crossingGap",
};

// 미리보기 흐름 좌표(viewBox) — 시작 → 접수 → 병렬 두 갈래 → 판단 → 끝, 판단 아니오는 접수로 되돌아가며 갈래와 교차
const VIEW_W = 520;
const VIEW_H = 150;
const PARALLEL_MARK_X = 204;
const PARALLEL_MARK_Y = 60;
// 되돌림 선(y 96)이 두 세로 갈래(x 214·356)를 지나는 자리
const CROSSING_POINTS: [number, number][] = [
  [214, 96],
  [356, 96],
];
const CROSSING_BOX = 16; // 교차 글리프 상자(viewBox 단위)

// 교차 글리프 상자 — 미리보기 svg와 같은 비율로 늘어나도록 % 위치·크기
function getCrossingBoxStyle(x: number, y: number): CSSProperties {
  const half = CROSSING_BOX / 2;
  return {
    left: `${((x - half) / VIEW_W) * 100}%`,
    top: `${((y - half) / VIEW_H) * 100}%`,
    width: `${(CROSSING_BOX / VIEW_W) * 100}%`,
    height: `${(CROSSING_BOX / VIEW_H) * 100}%`,
  };
}

// 교차 자리 덧그림 — 바탕으로 지운 뒤 jump는 세로선 + 반원 넘김, gap은 가로선 + 끊긴 세로선(lib/export drawCrossings와 같은 모양)
function CrossingGlyph({ kind }: { kind: "jump" | "gap" }) {
  const line: CSSProperties = { stroke: "var(--word-edge)" };
  return (
    <svg viewBox="-8 -8 16 16" className="block h-full w-full" aria-hidden>
      <rect x="-8" y="-8" width="16" height="16" style={{ fill: "var(--color-surface)" }} />
      {kind === "jump" ? (
        <path d="M0,-8 V8 M-8,0 H-5 A5,5 0 0 1 5,0 H8" fill="none" strokeWidth={1.25} style={line} />
      ) : (
        <path d="M-8,0 H8 M0,-8 V-6 M0,6 V8" fill="none" strokeWidth={1.25} style={line} />
      )}
    </svg>
  );
}

interface PreviewPalette {
  edge: string;
  ink: string;
  taskFill: string;
  taskStroke: string;
  termFill: string;
  termStroke: string;
  termInk: string;
  decFill: string;
  decStroke: string;
  labelStroke: string;
}

// 화면 그대로 — 노드 타입 기본색(파스텔 채움)과 검정 엣지(현행 PNG 출력과 같은 톤)
function getScreenPalette(): PreviewPalette {
  const tint = (color: string) => `color-mix(in srgb, ${color} 18%, white)`;
  const task = resolveNodeStroke("", "process");
  const term = resolveNodeStroke("", "start");
  const dec = resolveNodeStroke("", "decision");
  return {
    edge: "var(--color-ink)",
    ink: "var(--color-ink)",
    taskFill: tint(task),
    taskStroke: task,
    termFill: tint(term),
    termStroke: term,
    termInk: "var(--color-ink)",
    decFill: tint(dec),
    decStroke: dec,
    labelStroke: "var(--color-hairline)",
  };
}

// Word 문서용 — globals.css `.bpm-export-word--<style>` 토큰(실제 출력과 같은 변수)
const WORD_PALETTE: PreviewPalette = {
  edge: "var(--word-edge)",
  ink: "var(--word-ink)",
  taskFill: "var(--word-task-fill)",
  taskStroke: "var(--word-task-stroke)",
  termFill: "var(--word-term-fill)",
  termStroke: "var(--word-term-fill)",
  termInk: "var(--word-term-ink)",
  decFill: "var(--word-dec-fill)",
  decStroke: "var(--word-dec-stroke)",
  labelStroke: "var(--word-label-stroke)",
};

// 테마·스타일 전환 때 색이 부드럽게 넘어가도록(SVG 속성 대신 style 속성이라 전이가 걸린다)
const COLOR_TRANSITION = "fill 350ms var(--ease-smooth), stroke 350ms var(--ease-smooth)";

function getShapeStyle(fill: string, stroke: string): CSSProperties {
  return { fill, stroke, transition: COLOR_TRANSITION };
}

// 인쇄 크기 패널 폭 — Word 문서용이면 이만큼 오른쪽으로 펼친다
const PRINT_PANEL_W = 300;
// 펼침 동안 왼쪽 가장자리를 붙잡는 이동 — 절반 폭만큼 오른쪽으로 밀되 화면 오른쪽 여백(16px)을 넘지 않게
const EXPANDED_SHIFT = `max(0px, min(${PRINT_PANEL_W / 2}px, calc(50vw - ${(560 + PRINT_PANEL_W) / 2 + 16}px)))`;

export function PngExportModal({ frame, onClose, onExport }: PngExportModalProps) {
  const { t } = useI18n();
  const [options, setOptions] = useState<PngExportOptions>(() => loadPngExportOptions());
  const isWord = options.theme === "word";
  const update = (patch: Partial<PngExportOptions>) => setOptions((prev) => ({ ...prev, ...patch }));

  const handleExport = () => {
    savePngExportOptions(options);
    onExport(options);
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="png-export-modal"
        className="flex max-w-full flex-col overflow-hidden rounded-sm border glass glass-dense transition-[translate] duration-350 ease-smooth"
        style={{ translate: isWord ? `${EXPANDED_SHIFT} 0` : "0 0" }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="text-body-strong text-ink">{t("pngExport.title")}</span>
          <div className="ml-auto inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
            {(["screen", "word"] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                data-id={`png-export-theme-${theme}`}
                aria-pressed={options.theme === theme}
                className={
                  "rounded-xs px-1.5 py-0.5 " +
                  (options.theme === theme
                    ? "bg-accent-tint font-semibold text-accent"
                    : "text-ink-tertiary hover:text-ink-secondary")
                }
                onClick={() => update({ theme })}
              >
                {theme === "screen" ? t("pngExport.themeScreen") : t("pngExport.themeWord")}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0">
          <div className="flex w-[560px] max-w-full shrink-0 flex-col">
            <div className="px-4 pt-3">
              <div className="mb-1.5 text-caption text-ink-secondary">{t("pngExport.preview")}</div>
              <PngPreview options={options} />
            </div>

            {/* 모드 안내 ↔ Word 옵션 — 같은 칸에 겹쳐 두어 전환 중 높이가 출렁이지 않게 한다 */}
            <div className="grid px-4 py-3">
              <ShimmerPresence
                show={!isWord}
                dataId="png-export-screen-hint"
                className="relative col-start-1 row-start-1 self-start rounded-sm text-caption text-ink-tertiary"
              >
                {t("pngExport.themeScreenHint")}
              </ShimmerPresence>
              <ShimmerPresence
                show={isWord}
                dataId="png-export-word-options"
                className="relative col-start-1 row-start-1 flex flex-col gap-2 rounded-sm"
              >
                <div className="text-caption text-ink-tertiary">{t("pngExport.themeWordHint")}</div>
                <div className="flex gap-1.5">
                  {WORD_EXPORT_STYLES.map((style) => (
                    <button
                      key={style}
                      type="button"
                      data-id={`png-export-style-${style}`}
                      aria-pressed={options.wordStyle === style}
                      onClick={() => update({ wordStyle: style })}
                      className={`flex flex-1 flex-col items-center gap-1 rounded-sm border px-2 py-1.5 text-fine ${
                        options.wordStyle === style
                          ? "border-accent bg-accent-tint font-semibold text-accent"
                          : "border-hairline text-ink-secondary hover:bg-surface-alt"
                      }`}
                    >
                      <StyleThumb style={style} />
                      {t(STYLE_LABEL_KEY[style])}
                    </button>
                  ))}
                </div>
                {/* 출력 옵션 — 한 줄 칩(아이콘+짧은 이름)과 교차 아이콘 세그먼트로 압축 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <ToggleChip
                    dataId="png-export-toggle-parallel"
                    icon={<ParallelMarkIcon />}
                    label={t("pngExport.showParallel")}
                    on={options.showParallel}
                    onToggle={() => update({ showParallel: !options.showParallel })}
                  />
                  <ToggleChip
                    dataId="png-export-toggle-info"
                    icon={<PanelTop size={16} strokeWidth={1.5} />}
                    label={t("pngExport.showInfo")}
                    on={options.showInfo}
                    onToggle={() => update({ showInfo: !options.showInfo })}
                  />
                  <div className="ml-auto inline-flex items-center gap-1.5">
                    <span className="text-fine text-ink-tertiary">{t("pngExport.crossing")}</span>
                    <div className="inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5">
                      {CROSSING_STYLES.map((crossing) => (
                        <HoverTip key={crossing} tip={t(CROSSING_LABEL_KEY[crossing])} className="inline-flex">
                          <button
                            type="button"
                            data-id={`png-export-crossing-${crossing}`}
                            aria-label={t(CROSSING_LABEL_KEY[crossing])}
                            aria-pressed={options.crossing === crossing}
                            className={
                              "rounded-xs p-1 " +
                              (options.crossing === crossing
                                ? "bg-accent-tint text-accent"
                                : "text-ink-tertiary hover:text-ink-secondary")
                            }
                            onClick={() => update({ crossing })}
                          >
                            <CrossingIcon kind={crossing} />
                          </button>
                        </HoverTip>
                      ))}
                    </div>
                  </div>
                </div>
              </ShimmerPresence>
            </div>
          </div>
          {/* 인쇄 크기 패널 — Word 문서용이면 폭을 열며 오른쪽에서 밀려 들어온다 */}
          <div
            aria-hidden={!isWord}
            className={`shrink-0 overflow-hidden border-hairline transition-[width] duration-350 ease-smooth ${isWord ? "border-l" : ""}`}
            style={{ width: isWord ? PRINT_PANEL_W : 0 }}
          >
            <div
              className={`transition-[opacity,translate] duration-350 ease-smooth ${
                isWord ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"
              }`}
              style={{ width: PRINT_PANEL_W }}
            >
              <PngPrintPanel frame={frame} options={options} onChange={update} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="png-export-download"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus"
            onClick={handleExport}
          >
            {t("export.download")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}

interface ToggleChipProps {
  dataId: string;
  icon: ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
}

// 켜짐/꺼짐 칩 — 켜지면 액센트 틴트, 꺼지면 헤어라인 테두리만(폭은 내용만큼)
function ToggleChip({ dataId, icon, label, on, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-id={dataId}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-fine transition-colors duration-150 ${
        on ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-tertiary hover:bg-surface-alt"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// 병렬 표시 아이콘 — 출력의 이중 막대(=) 모양 그대로
function ParallelMarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M1,8 H15 M6,4 V12 M10,4 V12" />
    </svg>
  );
}

// 교차 표시 아이콘 — 없음(그냥 교차)·점프(가로선 반원)·터널(세로선 끊김)
function CrossingIcon({ kind }: { kind: CrossingStyle }) {
  const d =
    kind === "jump"
      ? "M8,1 V15 M1,10 H4 A4,4 0 0 1 12,10 H15"
      : kind === "gap"
        ? "M1,8 H15 M8,1 V4 M8,12 V15"
        : "M1,8 H15 M8,1 V15";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d={d} />
    </svg>
  );
}

// 스타일 버튼 썸네일 — 그 스타일 토큰 범위 안에서 시작·작업·판단 세 모양
function StyleThumb({ style }: { style: WordExportStyle }) {
  return (
    <span className={`bpm-export-word--${style} block`}>
      <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden>
        <rect x="1" y="7" width="14" height="10" rx="5" style={getShapeStyle("var(--word-term-fill)", "var(--word-term-fill)")} />
        <path d="M15 12h6" style={{ stroke: "var(--word-edge)" }} />
        <rect x="21" y="6" width="18" height="12" rx="2" style={getShapeStyle("var(--word-task-fill)", "var(--word-task-stroke)")} />
        <path d="M39 12h5" style={{ stroke: "var(--word-edge)" }} />
        <polygon points="52,3 61,12 52,21 43,12" style={getShapeStyle("var(--word-dec-fill)", "var(--word-dec-stroke)")} />
      </svg>
    </span>
  );
}

// 샘플 흐름 미리보기 — 실제 맵이 아니라 출력 모양의 차이(배경·색·병렬 표시·정보 블록)를 보여 준다
function PngPreview({ options }: { options: PngExportOptions }) {
  const { t } = useI18n();
  const isWord = options.theme === "word";
  const palette = isWord ? WORD_PALETTE : getScreenPalette();
  const edgeStyle: CSSProperties = { stroke: palette.edge, transition: COLOR_TRANSITION };
  const meta = [
    `${t("export.infoOwningDept")} QA`,
    `${t("export.infoVersion")} v3`,
    `${t("export.infoPublished")} 2026-10-14`,
  ];
  const edgeLabel = (x: number, y: number, label: string) => {
    const width = label.length * 9 + 10;
    return (
      <g>
        <rect
          x={x - width / 2}
          y={y - 7}
          width={width}
          height="14"
          rx="7"
          strokeWidth={1}
          style={{ fill: "var(--color-surface)", stroke: palette.labelStroke }}
        />
        <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="9" style={{ fill: palette.ink }}>
          {label}
        </text>
      </g>
    );
  };
  const node = (x: number, y: number, w: number, h: number, label: string, kind: "task" | "term") => {
    const isTerm = kind === "term";
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={isTerm ? h / 2 : 3}
          strokeWidth={isWord ? 1 : 1.5}
          style={getShapeStyle(isTerm ? palette.termFill : palette.taskFill, isTerm ? palette.termStroke : palette.taskStroke)}
        />
        <text
          x={x + w / 2}
          y={y + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="11"
          fontWeight={isTerm ? 600 : 400}
          style={{ fill: isTerm ? palette.termInk : palette.ink, transition: COLOR_TRANSITION }}
        >
          {label}
        </text>
      </g>
    );
  };
  return (
    <div
      data-id="png-export-preview"
      className={`overflow-hidden rounded-sm border border-hairline transition-colors duration-350 ${
        isWord ? `bpm-export-word bpm-export-word--${options.wordStyle} bg-surface` : "bg-canvas"
      }`}
      style={
        isWord
          ? undefined
          : {
              backgroundImage: "radial-gradient(var(--color-canvas-dot) 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }
      }
    >
      <ShimmerPresence
        show={isWord && options.showInfo}
        dataId="png-export-preview-header"
        className="relative mx-3 mt-2.5 pb-1.5"
        style={{ borderBottom: "2px solid var(--word-accent)" }}
      >
        <div className="text-caption font-semibold" style={{ color: "var(--word-accent)" }}>
          {t("pngExport.sampleTitle")}
        </div>
        <div className="text-fine" style={{ color: "var(--word-meta)" }}>
          {meta.join(" · ")}
        </div>
      </ShimmerPresence>
      <div className="relative">
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block w-full" aria-hidden>
          <path d="M72,60 L99,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M196,60 L214,60 L214,22 L231,22" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M196,60 L214,60 L214,118 L231,118" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M332,22 L356,22 L356,60 L375,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M332,118 L356,118 L356,60 L375,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M444,60 L465,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          {/* 되돌림 — 두 세로 갈래와 교차한다(교차 표시 차이를 보여 주는 자리) */}
          <path d="M410,82 L410,96 L148,96 L148,78" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <defs>
            <marker id="png-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: palette.edge, transition: COLOR_TRANSITION }} />
            </marker>
          </defs>
          {node(12, 47, 60, 26, "Start", "term")}
          {node(100, 43, 96, 34, t("pngExport.sampleReceive"), "task")}
          {node(232, 5, 100, 34, t("pngExport.sampleBudget"), "task")}
          {node(232, 101, 100, 34, t("pngExport.sampleVendor"), "task")}
          <polygon
            points="410,38 444,60 410,82 376,60"
            strokeWidth={1.5}
            style={getShapeStyle(palette.decFill, palette.decStroke)}
          />
          <text x="410" y="60" textAnchor="middle" dominantBaseline="central" fontSize="10" style={{ fill: palette.ink }}>
            {t("pngExport.sampleApprove")}
          </text>
          {node(466, 47, 48, 26, "End", "term")}
          {edgeLabel(455, 47, t("pngExport.sampleYes"))}
          {edgeLabel(385, 96, t("pngExport.sampleNo"))}
        </svg>
        {CROSSING_POINTS.map(([x, y]) => (
          <Fragment key={`${x}:${y}`}>
            <ShimmerPresence
              show={isWord && options.crossing === "jump"}
              dataId={`png-export-preview-jump-${x}`}
              className="absolute"
              style={getCrossingBoxStyle(x, y)}
            >
              <CrossingGlyph kind="jump" />
            </ShimmerPresence>
            <ShimmerPresence
              show={isWord && options.crossing === "gap"}
              dataId={`png-export-preview-gap-${x}`}
              className="absolute"
              style={getCrossingBoxStyle(x, y)}
            >
              <CrossingGlyph kind="gap" />
            </ShimmerPresence>
          </Fragment>
        ))}
        {/* 병렬 표시 — 갈라지기 직전 공통 구간의 이중 막대(실제 출력의 drawParallelMark와 같은 모양) */}
        <ShimmerPresence
          show={isWord && options.showParallel}
          dataId="png-export-preview-parallel"
          className="absolute h-[10%] w-[1.6%] -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(PARALLEL_MARK_X / VIEW_W) * 100}%`,
            top: `${(PARALLEL_MARK_Y / VIEW_H) * 100}%`,
            borderLeft: "1.25px solid var(--word-edge)",
            borderRight: "1.25px solid var(--word-edge)",
          }}
        >
          {null}
        </ShimmerPresence>
        <ShimmerPresence
          show={isWord && options.showParallel}
          dataId="png-export-preview-legend"
          className="absolute bottom-1 right-2 flex items-center gap-1.5 rounded-xs px-1 text-fine"
          style={{ color: "var(--word-ink)" }}
        >
          <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden>
            <path d="M0,5 H22 M9,0 V10 M13,0 V10" fill="none" strokeWidth={1.25} style={{ stroke: "var(--word-edge)" }} />
          </svg>
          {t("pngExport.parallelLegend")}
        </ShimmerPresence>
      </div>
      <ShimmerPresence
        show={!isWord}
        dataId="png-export-preview-card"
        className="relative mb-2.5 ml-3 inline-flex flex-col rounded-sm border border-hairline bg-surface px-2.5 py-1.5"
      >
        <span className="text-fine font-semibold text-ink">{t("pngExport.sampleTitle")}</span>
        <span className="text-fine text-ink-tertiary">{meta.join(" · ")}</span>
      </ShimmerPresence>
    </div>
  );
}
