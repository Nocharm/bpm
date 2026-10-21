"use client";

// PNG 내보내기 옵션 창 — 화면 그대로 / Word 문서용(스타일 3종·병렬 표시·맵 정보 블록 토글) 선택, 표시 정보·입출력 펼침
// (두 테마 공통, 출력 순간에만 캔버스에 적용) + 샘플 흐름 미리보기.
// 미리보기 구성요소는 켜고 끌 때 쉬머로 생기고 사라진다(ShimmerPresence). 마지막 선택은 브라우저에 기억(lib/export).
// 에디터(maps/[mapId]/page.tsx)의 PNG 내보내기 진입점(인스펙터 버튼·우클릭 메뉴·Ctrl+⇧E)이 공유.

import { Fragment, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ListTree, PanelTop, X } from "lucide-react";

import { EdgeFanIcon } from "@/components/edge-fan-icon";
import { HoverTip } from "@/components/hover-tip";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { TOGGLE_ICONS, TOGGLE_LABEL_KEY } from "@/components/node-display-section";
import { PngPrintPanel } from "@/components/png-print-panel";
import { resolveNodeStroke } from "@/components/process-node";
import { ShimmerPresence } from "@/components/shimmer-presence";
import { ToggleChip } from "@/components/toggle-chip";
import {
  buildSampleStepPath,
  PRINT_EDGE_CORNER_RADIUS,
  SCREEN_EDGE_CORNER_RADIUS,
  type SampleStepPath,
} from "@/lib/edge-path";
import {
  CROSSING_STYLES,
  getPrintHeaderPt,
  loadPngExportOptions,
  PRINT_LEGEND_ROW_PT,
  savePngExportOptions,
  WORD_EXPORT_STYLES,
  type CrossingStyle,
  type ExportFrame,
  type PngExportOptions,
  type WordExportStyle,
} from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { NodeDisplayToggle } from "@/lib/node-actions";
import type { SplitSource } from "@/lib/print-split";

interface PngExportModalProps {
  // 현재 맵의 캡처 프레임(lib/export measureExportFrame) — 인쇄 크기 패널의 비율·해상도 계산. 노드가 없으면 null
  frame: ExportFrame | null;
  // 나눠 싣기 재료 측정(lib/print-split measureSplitSource) — 창을 열 때 한 번 부른다. 캔버스가 없으면 null
  measureSplit: () => SplitSource | null;
  // 캔버스의 현재 표시 정보 — 창을 열 때 표시 정보 칩의 시작값(창에서 바꿔도 캔버스 설정은 그대로)
  canvasDisplayFields: NodeDisplayToggle[];
  onClose: () => void;
  onExport: (options: PngExportOptions, displayFields: NodeDisplayToggle[]) => void;
}

// 표시 정보 칩 순서 — 노드 표시 정보 카드의 묶음 순서(속성 → 수행 지표 → 입출력·조건)
const DISPLAY_CHIP_ORDER: NodeDisplayToggle[] = [
  "assignee",
  "department",
  "system",
  "url",
  "gmp",
  "params",
  "input",
  "output",
  "conditions",
];

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
const VIEW_H_MIN = 150; // 샘플 노드가 표시 정보로 길어지면 그만큼 늘어난다
const PARALLEL_MARK_X = 204;
const PARALLEL_MARK_Y = 60;
// 병렬 두 갈래(접수 → 예산·업체)와 합류(→ 승인?) — 연결선 펼침이 바꾸는 두 자리.
// 펼침: 출발·도착 핸들에서 반경이 다른 원호 레인으로 갈라지고 모인다(lib/edge-fanout) / 끔: 한 점에서 겹쳐 나가 꺾이는 자리에서
// 갈라진다(한 줄기). 두 자리만 따로 겹쳐 그려 칩을 바꾸면 그 자리에서 쉬머로 바뀐다
type Junction = "source" | "merge";
const FAN_PATHS: Record<Junction, SampleStepPath[]> = {
  source: [
    { head: { x: 196, y: 60, r: 12, sweep: 0 }, points: [{ x: 208, y: 48 }, { x: 208, y: 22 }, { x: 231, y: 22 }] },
    { head: { x: 196, y: 60, r: 24, sweep: 1 }, points: [{ x: 220, y: 84 }, { x: 220, y: 118 }, { x: 231, y: 118 }] },
  ],
  merge: [
    { points: [{ x: 332, y: 22 }, { x: 363, y: 22 }, { x: 363, y: 48 }], tail: { x: 375, y: 60, r: 12, sweep: 0 } },
    { points: [{ x: 332, y: 118 }, { x: 351, y: 118 }, { x: 351, y: 84 }], tail: { x: 375, y: 60, r: 24, sweep: 1 } },
  ],
};
const FLAT_PATHS: Record<Junction, SampleStepPath[]> = {
  source: [
    { points: [{ x: 196, y: 60 }, { x: 214, y: 60 }, { x: 214, y: 22 }, { x: 231, y: 22 }] },
    { points: [{ x: 196, y: 60 }, { x: 214, y: 60 }, { x: 214, y: 118 }, { x: 231, y: 118 }] },
  ],
  merge: [
    { points: [{ x: 332, y: 22 }, { x: 356, y: 22 }, { x: 356, y: 60 }, { x: 375, y: 60 }] },
    { points: [{ x: 332, y: 118 }, { x: 356, y: 118 }, { x: 356, y: 60 }, { x: 375, y: 60 }] },
  ],
};
// 두 자리의 viewBox x 범위(겹쳐 그리는 svg 조각)
const JUNCTION_X: Record<Junction, [number, number]> = { source: [188, 238], merge: [326, 382] };
// 되돌림 선이 지나는 아래 갈래·아래 합류의 세로 구간 x — 교차 표시 자리
const LOWER_LANE_X = { fan: [220, 351], flat: [214, 356] } as const;
const CROSSING_BOX = 16; // 교차 글리프 상자(viewBox 단위)

// 교차 글리프 상자 — 미리보기 svg와 같은 비율로 늘어나도록 % 위치·크기
function getCrossingBoxStyle(x: number, y: number, viewH: number): CSSProperties {
  const half = CROSSING_BOX / 2;
  return {
    left: `${((x - half) / VIEW_W) * 100}%`,
    top: `${((y - half) / viewH) * 100}%`,
    width: `${(CROSSING_BOX / VIEW_W) * 100}%`,
    height: `${(CROSSING_BOX / viewH) * 100}%`,
  };
}

// 미리보기 viewBox 좌표 사각형 → 겹쳐 그리는 HTML 상자의 % 위치
function getBoxStyle(x: number, y: number, w: number, viewH: number): CSSProperties {
  return { left: `${(x / VIEW_W) * 100}%`, top: `${(y / viewH) * 100}%`, width: `${(w / VIEW_W) * 100}%` };
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
  sub: string;
  // 노드·라벨 모서리 — Word는 각지게(globals.css .bpm-export-word와 같은 값)
  nodeRadius: number;
  labelRadius: number;
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
    sub: "var(--color-ink-tertiary)",
    nodeRadius: 4,
    labelRadius: 7,
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
  sub: "var(--word-sub)",
  nodeRadius: 1,
  labelRadius: 1,
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

export function PngExportModal({ frame, measureSplit, canvasDisplayFields, onClose, onExport }: PngExportModalProps) {
  const { t } = useI18n();
  const [options, setOptions] = useState<PngExportOptions>(() => loadPngExportOptions());
  const [displayFields, setDisplayFields] = useState<NodeDisplayToggle[]>(canvasDisplayFields);
  // 지금 캔버스 모습으로 잰 어림 — 출력은 고른 표시 정보·문서 글꼴로 다시 재므로 조각 수가 하나쯤 다를 수 있다
  const [splitSource] = useState(measureSplit);
  const isWord = options.theme === "word";
  // 머리 블록(메타 한 줄 어림)·병렬 범례 줄 — 인쇄 크기 패널의 한 장 세로 크기
  const chromePt = (options.showInfo ? getPrintHeaderPt(1) : 0) + (options.showParallel ? PRINT_LEGEND_ROW_PT : 0);
  const hasIo = displayFields.includes("input") || displayFields.includes("output");
  const update = (patch: Partial<PngExportOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const toggleField = (field: NodeDisplayToggle) =>
    setDisplayFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));

  const handleExport = () => {
    savePngExportOptions(options);
    onExport(options, displayFields);
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
              <PngPreview options={options} displayFields={displayFields} />
            </div>

            {/* 표시 정보 — 두 테마 공통. 출력 순간에만 캔버스에 적용하고 끝나면 원래 표시로 돌아간다 */}
            <div className="px-4 pt-3">
              <div className="mb-1.5 text-caption text-ink-secondary">{t("pngExport.displayInfo")}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {DISPLAY_CHIP_ORDER.map((field) => {
                  const Icon = TOGGLE_ICONS[field];
                  return (
                    <ToggleChip
                      key={field}
                      dataId={`png-export-field-${field}`}
                      icon={<Icon size={14} strokeWidth={1.5} />}
                      label={t(TOGGLE_LABEL_KEY[field])}
                      on={displayFields.includes(field)}
                      onToggle={() => toggleField(field)}
                    />
                  );
                })}
                <ShimmerPresence show={hasIo} dataId="png-export-expand-io-wrap" className="relative rounded-full">
                  <ToggleChip
                    dataId="png-export-expand-io"
                    icon={<ListTree size={14} strokeWidth={1.5} />}
                    label={t("pngExport.expandIo")}
                    on={options.expandIo}
                    onToggle={() => update({ expandIo: !options.expandIo })}
                  />
                </ShimmerPresence>
              </div>
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
                  <HoverTip tip={t("pngExport.edgeFanTip")} className="inline-flex">
                    <ToggleChip
                      dataId="png-export-toggle-edge-fan"
                      icon={<EdgeFanIcon />}
                      label={t("pngExport.edgeFan")}
                      on={options.edgeFan}
                      onToggle={() => update({ edgeFan: !options.edgeFan })}
                    />
                  </HoverTip>
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
              <PngPrintPanel
                frame={frame}
                options={options}
                chromePt={chromePt}
                splitSource={splitSource}
                onChange={update}
              />
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

// 미리보기 샘플 노드(요청 접수)에 그릴 표시 정보 줄 — 아이콘·문구. gmp(제목 위 필)·conditions(노드 밖 캡션)는 따로
const SAMPLE_LINE_FIELDS: NodeDisplayToggle[] = ["assignee", "department", "system", "url", "params", "input", "output"];
const SAMPLE_LINE_KEY: Partial<Record<NodeDisplayToggle, MessageKey>> = {
  assignee: "pngExport.sampleRole",
  department: "pngExport.sampleDept",
  system: "pngExport.sampleSystem",
  url: "pngExport.sampleUrl",
  params: "pngExport.sampleParams",
  input: "pngExport.sampleInput",
  output: "pngExport.sampleOutput",
};
// 샘플 노드 세로 치수(viewBox) — 제목 줄 가운데가 60(연결선 높이), 위 여백·GMP 필·제목·표시 줄·아래 여백
const TITLE_Y = 60;
const PAD_Y = 8;
const GMP_ROW = 12;
const TITLE_ROW = 18;
const LINE_ROW = 11;
const IO_BOX_ROW = 16; // 샘플 노드 입출력 상자 한 칸(상자 14 + 위 간격 2) — 캔버스처럼 사선 상자로
const DEC_BOX_ROW = 17; // 분기 입출력 상자 한 칸(목록 한 줄 + 상자 여백)
const LANE_Y = 96; // 되돌림 선 높이 — 교차 표시 자리의 y

// 샘플 흐름 미리보기 — 실제 맵이 아니라 출력 모양의 차이(배경·색·병렬 표시·정보 블록·표시 정보)를 보여 준다
function PngPreview({ options, displayFields }: { options: PngExportOptions; displayFields: NodeDisplayToggle[] }) {
  const { t } = useI18n();
  const isWord = options.theme === "word";
  const palette = isWord ? WORD_PALETTE : getScreenPalette();
  const edgeStyle: CSSProperties = { stroke: palette.edge, transition: COLOR_TRANSITION };
  // 화면 그대로는 캔버스처럼 늘 펼침, Word는 칩을 따른다
  const fanKey = !isWord || options.edgeFan ? "fan" : "flat";
  // 꺾임 반경 — 화면은 캔버스 값, Word는 출력 값(lib/edge-path)
  const cornerRadius = isWord ? PRINT_EDGE_CORNER_RADIUS : SCREEN_EDGE_CORNER_RADIUS;
  const drawPath = (path: SampleStepPath, key: number) => (
    <path
      key={key}
      d={buildSampleStepPath(path, cornerRadius)}
      fill="none"
      strokeWidth={1.25}
      style={edgeStyle}
      markerEnd="url(#png-preview-arrow)"
    />
  );
  // 되돌림 선(y LANE_Y)이 아래 갈래·아래 합류를 지나는 자리
  const crossingPoints = LOWER_LANE_X[fanKey].map((x) => [x, LANE_Y] as const);
  const meta = [
    `${t("export.infoOwningDept")} QA`,
    `${t("export.infoVersion")} v3`,
    `${t("export.infoPublished")} 2026-10-14`,
  ];
  // 샘플 노드 치수 — 켠 표시 정보만큼 아래로 길어진다(제목 줄 높이는 고정이라 연결선이 흔들리지 않는다)
  const hasGmp = displayFields.includes("gmp");
  const hasConditions = displayFields.includes("conditions");
  const lineFields = SAMPLE_LINE_FIELDS.filter((field) => displayFields.includes(field));
  const isIoField = (field: NodeDisplayToggle) => field === "input" || field === "output";
  const t1Top = TITLE_Y - TITLE_ROW / 2 - PAD_Y - (hasGmp ? GMP_ROW : 0);
  const t1Bottom =
    TITLE_Y +
    TITLE_ROW / 2 +
    lineFields.reduce((sum, field) => sum + (isIoField(field) ? IO_BOX_ROW : LINE_ROW), 0) +
    PAD_Y;
  // 분기 노드 입출력 — 알약(접힘) 또는 목록(펼침), 판단 마름모 오른쪽 아래
  const decIo = (["input", "output"] as const).filter((side) => displayFields.includes(side));
  const decIoBottom = decIo.length === 0 ? 0 : options.expandIo ? 90 + decIo.length * (DEC_BOX_ROW + 2) : 104;
  const viewH = Math.max(VIEW_H_MIN, t1Bottom + (hasConditions ? 22 : 12), decIoBottom + 10);
  // 되돌림 선 — 노드가 짧으면 아래 변으로, 길어 선 높이를 덮으면 오른쪽 변으로 들어간다
  const loopPath: SampleStepPath = {
    points:
      t1Bottom >= LANE_Y + 3
        ? [{ x: 410, y: 82 }, { x: 410, y: LANE_Y }, { x: 197, y: LANE_Y }]
        : [{ x: 410, y: 82 }, { x: 410, y: LANE_Y }, { x: 180, y: LANE_Y }, { x: 180, y: t1Bottom + 1 }],
  };
  const edgeLabel = (x: number, y: number, label: string) => {
    const width = label.length * 9 + 10;
    return (
      <g>
        <rect
          x={x - width / 2}
          y={y - 7}
          width={width}
          height="14"
          rx={palette.labelRadius}
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
          rx={isTerm ? h / 2 : palette.nodeRadius}
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
        <svg viewBox={`0 0 ${VIEW_W} ${viewH}`} className="block w-full" aria-hidden>
          <path d="M72,60 L99,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          <path d="M444,60 L465,60" fill="none" strokeWidth={1.25} style={edgeStyle} markerEnd="url(#png-preview-arrow)" />
          {/* 되돌림 — 아래 갈래·아래 합류와 교차한다(교차 표시 차이를 보여 주는 자리) */}
          {drawPath(loopPath, 0)}
          <defs>
            <marker id="png-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: palette.edge, transition: COLOR_TRANSITION }} />
            </marker>
          </defs>
          {node(12, 47, 60, 26, "Start", "term")}
          {node(232, 5, 100, 34, t("pngExport.sampleBudget"), "task")}
          {node(232, 101, 100, 34, t("pngExport.sampleVendor"), "task")}
          <polygon
            points="410,38 444,60 410,82 376,60"
            strokeWidth={1.5}
            strokeLinejoin={isWord ? "miter" : "round"}
            style={getShapeStyle(palette.decFill, palette.decStroke)}
          />
          <text x="410" y="60" textAnchor="middle" dominantBaseline="central" fontSize="10" style={{ fill: palette.ink }}>
            {t("pngExport.sampleApprove")}
          </text>
          {node(466, 47, 48, 26, "End", "term")}
          {edgeLabel(455, 47, t("pngExport.sampleYes"))}
          {edgeLabel(385, LANE_Y, t("pngExport.sampleNo"))}
        </svg>
        {/* 연결선 펼침이 바꾸는 두 자리 — 펼침(원호 레인) ↔ 끔(한 줄기)을 그 자리에서만 쉬머로 바꾼다 */}
        {(["fan", "flat"] as const).flatMap((set) =>
          (["source", "merge"] as const).map((spot) => {
            const [x0, x1] = JUNCTION_X[spot];
            return (
              <ShimmerPresence
                key={`${set}-${spot}`}
                show={fanKey === set}
                dataId={`png-export-preview-${set}-${spot}`}
                className="pointer-events-none absolute top-0 h-full"
                style={{ left: `${(x0 / VIEW_W) * 100}%`, width: `${((x1 - x0) / VIEW_W) * 100}%` }}
              >
                <svg
                  viewBox={`${x0} 0 ${x1 - x0} ${viewH}`}
                  preserveAspectRatio="none"
                  className="block h-full w-full overflow-visible"
                  aria-hidden
                >
                  {(set === "fan" ? FAN_PATHS : FLAT_PATHS)[spot].map(drawPath)}
                </svg>
              </ShimmerPresence>
            );
          }),
        )}
        {/* 샘플 노드(요청 접수) — HTML로 겹쳐 그려 표시 정보 줄마다 쉬머로 생기고 사라진다. 높이는 줄 수만큼 늘어난다 */}
        <div
          data-id="png-export-preview-node"
          className="absolute overflow-hidden border transition-[top,height,border-radius] duration-350 ease-smooth"
          style={{
            ...getBoxStyle(100, t1Top, 96, viewH),
            height: `${((t1Bottom - t1Top) / viewH) * 100}%`,
            padding: `${PAD_Y}px 6px`,
            background: palette.taskFill,
            borderColor: palette.taskStroke,
            borderWidth: isWord ? 1 : 1.5,
            borderRadius: palette.nodeRadius,
          }}
        >
          <ShimmerPresence show={hasGmp} dataId="png-export-preview-gmp" className="relative flex rounded-full" style={{ height: GMP_ROW }}>
            <span
              className="rounded-full border px-1 text-[8px] leading-[10px]"
              style={{ borderColor: isWord ? "var(--word-pill-stroke)" : "var(--color-hairline)", color: palette.sub }}
            >
              GMP Direct
            </span>
          </ShimmerPresence>
          <div className="truncate text-center text-[11px]" style={{ height: TITLE_ROW, lineHeight: `${TITLE_ROW}px`, color: palette.ink }}>
            {t("pngExport.sampleReceive")}
          </div>
          {SAMPLE_LINE_FIELDS.map((field) => {
            const Icon = TOGGLE_ICONS[field];
            const labelKey = SAMPLE_LINE_KEY[field];
            // 입력물·산출물은 캔버스 노드처럼 사선 상자(입력 왼쪽 위·출력 오른쪽 아래, globals.css .bpm-io-box)
            const isIo = isIoField(field);
            return (
              <ShimmerPresence
                key={field}
                show={displayFields.includes(field)}
                dataId={`png-export-preview-line-${field}`}
                className={
                  isIo
                    ? `relative bpm-io-box bpm-io-box--${field} bpm-io-box--compact mt-0.5 flex items-center gap-1 px-1 text-[8px]`
                    : "relative flex items-center gap-1 rounded-xs text-[8px]"
                }
                style={{ height: isIo ? IO_BOX_ROW - 2 : LINE_ROW, color: palette.sub }}
              >
                <Icon size={8} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{labelKey ? t(labelKey) : ""}</span>
              </ShimmerPresence>
            );
          })}
        </div>
        {/* 시작·종료 조건 — 노드 밖 위·아래 캡션 */}
        <ShimmerPresence
          show={hasConditions}
          dataId="png-export-preview-cond-start"
          className="absolute truncate rounded-xs text-[8px]"
          style={{ ...getBoxStyle(100, t1Top - 11, 120, viewH), color: palette.sub }}
        >
          {`▷ ${t("pngExport.sampleStart")}`}
        </ShimmerPresence>
        <ShimmerPresence
          show={hasConditions}
          dataId="png-export-preview-cond-end"
          className="absolute truncate rounded-xs text-[8px]"
          style={{ ...getBoxStyle(100, t1Bottom + 2, 76, viewH), color: palette.sub }}
        >
          {`■ ${t("pngExport.sampleEnd")}`}
        </ShimmerPresence>
        {/* 분기 노드 입출력 — 접힘 알약 ↔ 펼친 목록(입출력 펼침) */}
        <ShimmerPresence
          show={decIo.length > 0 && !options.expandIo}
          dataId="png-export-preview-dec-chip"
          className="absolute flex items-center gap-1.5 rounded-full border px-1.5 text-[8px] leading-[12px]"
          style={{ ...getBoxStyle(418, 88, 46, viewH), width: "auto", borderColor: palette.labelStroke, color: palette.sub, background: "var(--color-surface)" }}
        >
          {decIo.map((side) => {
            const Icon = TOGGLE_ICONS[side];
            return (
              <span key={side} className="inline-flex items-center gap-0.5">
                <Icon size={8} strokeWidth={1.5} />1
              </span>
            );
          })}
        </ShimmerPresence>
        <ShimmerPresence
          show={decIo.length > 0 && options.expandIo}
          dataId="png-export-preview-dec-list"
          className="absolute flex flex-col gap-0.5"
          style={getBoxStyle(418, 90, 94, viewH)}
        >
          {/* 캔버스와 같은 입출력 상자 — 입력은 왼쪽 위, 출력은 오른쪽 아래가 사선(globals.css .bpm-io-box) */}
          {decIo.map((side) => {
            const Icon = TOGGLE_ICONS[side];
            return (
              <span
                key={side}
                className={`bpm-io-box bpm-io-box--${side} bpm-io-box--framed flex items-center gap-1 px-1.5 text-[8px]`}
                style={{ height: DEC_BOX_ROW, color: palette.sub }}
              >
                <Icon size={8} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{t(side === "input" ? "pngExport.sampleDecInput" : "pngExport.sampleDecOutput")}</span>
              </span>
            );
          })}
        </ShimmerPresence>
        {crossingPoints.map(([x, y], index) => (
          // 자리 순번 키 — 펼침을 바꿔도 글리프가 다시 생기지 않고 자리만 옮긴다
          <Fragment key={index}>
            <ShimmerPresence
              show={isWord && options.crossing === "jump"}
              dataId={`png-export-preview-jump-${index + 1}`}
              className="absolute"
              style={getCrossingBoxStyle(x, y, viewH)}
            >
              <CrossingGlyph kind="jump" />
            </ShimmerPresence>
            <ShimmerPresence
              show={isWord && options.crossing === "gap"}
              dataId={`png-export-preview-gap-${index + 1}`}
              className="absolute"
              style={getCrossingBoxStyle(x, y, viewH)}
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
            top: `${(PARALLEL_MARK_Y / viewH) * 100}%`,
            height: `${(14 / viewH) * 100}%`,
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
