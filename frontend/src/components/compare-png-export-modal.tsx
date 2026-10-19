"use client";

// 비교 화면 PNG 내보내기 옵션 창 — 화면 그대로 / 문서용(결재자 보고용, 상태 색 유지) 선택, 범례·정보 블록·표시 정보 토글
// (출력 순간에만 캔버스에 적용) + 샘플 비교 흐름 미리보기(현재 상태 색 구성을 따른다). 켜고 끄는 부분은 쉬머로
// 생기고 사라지며(ShimmerPresence), 정보 블록은 위·범례는 아래로 출력과 같은 자리에 놓인다.
// 문서용이면 연결선 펼침 칩과 인쇄 크기 패널(PngPrintPanel, 나눠 싣기 포함)을 연다. 마지막 선택은 브라우저에 기억
// (lib/compare-png-export).
// 비교 화면(maps/[mapId]/compare/page.tsx) 내보내기 버튼이 연다. 편집 화면 PNG 창(png-export-modal)과 같은 골격.

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ListOrdered, PanelTop, X } from "lucide-react";

import { EdgeFanIcon } from "@/components/edge-fan-icon";
import { HoverTip } from "@/components/hover-tip";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { TOGGLE_ICONS, TOGGLE_LABEL_KEY } from "@/components/node-display-section";
import { PngPrintPanel } from "@/components/png-print-panel";
import { resolveNodeStroke } from "@/components/process-node";
import { ShimmerPresence } from "@/components/shimmer-presence";
import { ToggleChip } from "@/components/toggle-chip";
import {
  loadComparePngExportOptions,
  saveComparePngExportOptions,
  type ComparePngExportOptions,
  type ComparePngFormat,
} from "@/lib/compare-png-export";
import {
  buildSampleStepPath,
  PRINT_EDGE_CORNER_RADIUS,
  SCREEN_EDGE_CORNER_RADIUS,
  type SampleStepPath,
} from "@/lib/edge-path";
import { getCompareDocumentChromePt, type CompareLegendStatus, type ExportFrame } from "@/lib/export";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import type { NodeDisplayToggle } from "@/lib/node-actions";
import type { SplitSource } from "@/lib/print-split";

export interface CompareLegendItem {
  status: CompareLegendStatus;
  label: string;
}

interface ComparePngExportModalProps {
  // 현재 비교 캔버스의 캡처 프레임(lib/export measureCompareFrame) — 인쇄 크기 패널 계산. 그림이 없으면 null
  frame: ExportFrame | null;
  // 비교 화면의 상태 색 구성(2×2 견본) — 미리보기가 같은 토큰([data-diff-palette])을 쓴다
  paletteKey: "a" | "c";
  muteUnchanged: boolean;
  // 정보 블록 문구(맵 이름·기준 → 대상·내보낸 시각·건수)와 범례 항목 — 출력과 같은 값을 미리보기에 그린다
  header: { title: string; metaLines: string[] };
  legendItems: CompareLegendItem[];
  // 비교 화면의 현재 표시 정보 — 표시 정보 칩의 시작값(창에서 바꿔도 화면 설정은 그대로)
  canvasDisplayFields: NodeDisplayToggle[];
  // 나눠 싣기 재료 측정(lib/print-split measureSplitSource) — 창을 열 때 한 번 부른다. 그림이 없으면 null
  measureSplit: () => SplitSource | null;
  onClose: () => void;
  onExport: (options: ComparePngExportOptions, displayFields: NodeDisplayToggle[]) => void;
}

// 표시 정보 칩 순서 — 편집 화면 PNG 창과 같은 묶음 순서(속성 → 수행 지표 → 입출력·조건)
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

const FORMAT_LABEL_KEY: Record<ComparePngFormat, MessageKey> = {
  screen: "comparePng.formatScreen",
  document: "comparePng.formatDocument",
};

// 인쇄 크기 패널 폭·펼침 이동 — png-export-modal과 같은 값(문서용이면 오른쪽으로 펼치고 창을 절반만큼 민다)
const PRINT_PANEL_W = 300;
const BODY_W = 560;
const EXPANDED_SHIFT = `max(0px, min(${PRINT_PANEL_W / 2}px, calc(50vw - ${(BODY_W + PRINT_PANEL_W) / 2 + 16}px)))`;

export function ComparePngExportModal({
  frame,
  paletteKey,
  muteUnchanged,
  header,
  legendItems,
  canvasDisplayFields,
  measureSplit,
  onClose,
  onExport,
}: ComparePngExportModalProps) {
  const { t } = useI18n();
  const [options, setOptions] = useState<ComparePngExportOptions>(() => loadComparePngExportOptions());
  const [displayFields, setDisplayFields] = useState<NodeDisplayToggle[]>(canvasDisplayFields);
  // 지금 비교 화면 모습으로 잰 어림 — 출력은 문서 톤으로 다시 재므로 조각 수가 하나쯤 다를 수 있다
  const [splitSource] = useState(measureSplit);
  const isDocument = options.format === "document";
  const update = (patch: Partial<ComparePngExportOptions>) => setOptions((prev) => ({ ...prev, ...patch }));
  const toggleField = (field: NodeDisplayToggle) =>
    setDisplayFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]));

  const handleExport = () => {
    saveComparePngExportOptions(options);
    onExport(options, displayFields);
  };

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="compare-png-modal"
        className="flex max-w-full flex-col overflow-hidden rounded-sm border glass glass-dense transition-[translate] duration-350 ease-smooth"
        style={{ translate: isDocument ? `${EXPANDED_SHIFT} 0` : "0 0" }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="text-body-strong text-ink">{t("comparePng.title")}</span>
          <div className="ml-auto inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
            {(["screen", "document"] as const).map((format) => (
              <button
                key={format}
                type="button"
                data-id={`compare-png-format-${format}`}
                aria-pressed={options.format === format}
                className={
                  "rounded-xs px-1.5 py-0.5 " +
                  (options.format === format
                    ? "bg-accent-tint font-semibold text-accent"
                    : "text-ink-tertiary hover:text-ink-secondary")
                }
                onClick={() => update({ format })}
              >
                {t(FORMAT_LABEL_KEY[format])}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Close"
            data-id="compare-png-close"
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0">
          <div className="flex max-w-full shrink-0 flex-col" style={{ width: BODY_W }}>
            <div className="px-4 pt-3">
              <div className="mb-1.5 text-caption text-ink-secondary">{t("pngExport.preview")}</div>
              <ComparePngPreview
                options={options}
                displayFields={displayFields}
                paletteKey={paletteKey}
                muteUnchanged={muteUnchanged}
                header={header}
                legendItems={legendItems}
              />
            </div>

            {/* 출력 구성 — 정보 블록(위)·범례(아래), 두 형식 공통 */}
            <div className="px-4 pt-3">
              <div className="mb-1.5 text-caption text-ink-secondary">{t("comparePng.output")}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ToggleChip
                  dataId="compare-png-toggle-info"
                  icon={<PanelTop size={14} strokeWidth={1.5} />}
                  label={t("comparePng.showInfo")}
                  on={options.showInfo}
                  onToggle={() => update({ showInfo: !options.showInfo })}
                />
                <ToggleChip
                  dataId="compare-png-toggle-legend"
                  icon={<ListOrdered size={14} strokeWidth={1.5} />}
                  label={t("comparePng.showLegend")}
                  on={options.showLegend}
                  onToggle={() => update({ showLegend: !options.showLegend })}
                />
                {/* 연결선 펼침 — 문서용만(화면 그대로는 비교 화면 모습 그대로) */}
                <ShimmerPresence show={isDocument} dataId="compare-png-edge-fan-wrap" className="relative rounded-full">
                  <HoverTip tip={t("pngExport.edgeFanTip")} className="inline-flex">
                    <ToggleChip
                      dataId="compare-png-toggle-edge-fan"
                      icon={<EdgeFanIcon />}
                      label={t("pngExport.edgeFan")}
                      on={options.edgeFan}
                      onToggle={() => update({ edgeFan: !options.edgeFan })}
                    />
                  </HoverTip>
                </ShimmerPresence>
              </div>
            </div>

            {/* 표시 정보 — 출력 순간에만 캔버스에 적용하고 끝나면 비교 화면 설정으로 돌아간다 */}
            <div className="px-4 pt-3">
              <div className="mb-1.5 text-caption text-ink-secondary">{t("pngExport.displayInfo")}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {DISPLAY_CHIP_ORDER.map((field) => {
                  const Icon = TOGGLE_ICONS[field];
                  return (
                    <ToggleChip
                      key={field}
                      dataId={`compare-png-field-${field}`}
                      icon={<Icon size={14} strokeWidth={1.5} />}
                      label={t(TOGGLE_LABEL_KEY[field])}
                      on={displayFields.includes(field)}
                      onToggle={() => toggleField(field)}
                    />
                  );
                })}
              </div>
            </div>

            {/* 형식 안내 — 같은 칸에 겹쳐 두어 전환 중 높이가 출렁이지 않게 한다 */}
            <div className="grid px-4 py-3">
              <ShimmerPresence
                show={!isDocument}
                dataId="compare-png-screen-hint"
                className="relative col-start-1 row-start-1 self-start rounded-sm text-caption text-ink-tertiary"
              >
                {t("comparePng.screenHint")}
              </ShimmerPresence>
              <ShimmerPresence
                show={isDocument}
                dataId="compare-png-document-hint"
                className="relative col-start-1 row-start-1 self-start rounded-sm text-caption text-ink-tertiary"
              >
                {t("comparePng.documentHint")}
              </ShimmerPresence>
            </div>
          </div>
          {/* 인쇄 크기 패널 — 문서용이면 폭을 열며 오른쪽에서 밀려 들어온다 */}
          <div
            aria-hidden={!isDocument}
            className={`shrink-0 overflow-hidden border-hairline transition-[width] duration-350 ease-smooth ${isDocument ? "border-l" : ""}`}
            style={{ width: isDocument ? PRINT_PANEL_W : 0 }}
          >
            <div
              className={`transition-[opacity,translate] duration-350 ease-smooth ${
                isDocument ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0"
              }`}
              style={{ width: PRINT_PANEL_W }}
            >
              <PngPrintPanel
                frame={frame}
                options={options}
                chromePt={getCompareDocumentChromePt(options)}
                splitSource={splitSource}
                onChange={update}
              />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          <button
            type="button"
            data-id="compare-png-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="compare-png-download"
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

// ---- 미리보기 ----

const VIEW_W = 520;
const VIEW_H_MIN = 132;
const LANE_Y = 54; // 큰길 연결선 높이(viewBox)
const DIFF_COLOR: Record<Exclude<CompareLegendStatus, "unchanged">, string> = {
  added: "var(--color-added)",
  changed: "var(--color-diff-changed)",
  removed: "var(--color-removed)",
};
const BADGE_KEY: Record<Exclude<CompareLegendStatus, "unchanged">, MessageKey> = {
  added: "compare.legendAdded",
  changed: "compare.legendChanged",
  removed: "compare.legendRemoved",
};
// 샘플 변경 노드(결제 검토)에 그릴 표시 정보 줄 — gmp(제목 위 필)·conditions(노드 밖 캡션)는 따로
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
// 변경 노드 세로 치수(viewBox) — 제목 줄 가운데가 큰길 높이, 위 여백·GMP 필·제목·표시 줄·아래 여백
const PAD_Y = 6;
const GMP_ROW = 12;
const TITLE_ROW = 18;
const LINE_ROW = 11;
const CHANGED_X = 196;
const CHANGED_W = 104;
// 삭제 연결선 두 개(결제 검토 → 재고 재확인 → 끝)는 추가 연결선과 핸들을 함께 쓴다 — 연결선 펼침이 바꾸는 두 자리.
// 펼침: 핸들에서 원호로 갈라지고 모인다(lib/edge-fanout) / 끔: 추가 연결선과 한 줄기로 겹쳐 나가 꺾이는 자리에서 갈라진다
const REMOVED_Y = 105; // 삭제 노드(재고 재확인) 가운데 높이
type Junction = "source" | "merge";
const FAN_PATHS: Record<Junction, SampleStepPath> = {
  source: {
    head: { x: 300, y: LANE_Y, r: 14, sweep: 1 },
    points: [{ x: 314, y: LANE_Y + 14 }, { x: 314, y: REMOVED_Y }, { x: 327, y: REMOVED_Y }],
  },
  merge: {
    points: [{ x: 420, y: REMOVED_Y }, { x: 441, y: REMOVED_Y }, { x: 441, y: LANE_Y + 14 }],
    tail: { x: 455, y: LANE_Y, r: 14, sweep: 1 },
  },
};
// 끔 — 추가 연결선 위를 18px쯤 함께 달린 뒤 꺾인다(한 줄기로 겹쳐 보이는 구간이 차이)
const FLAT_PATHS: Record<Junction, SampleStepPath> = {
  source: { points: [{ x: 300, y: LANE_Y }, { x: 318, y: LANE_Y }, { x: 318, y: REMOVED_Y }, { x: 327, y: REMOVED_Y }] },
  merge: { points: [{ x: 420, y: REMOVED_Y }, { x: 436, y: REMOVED_Y }, { x: 436, y: LANE_Y }, { x: 455, y: LANE_Y }] },
};
// 두 자리의 viewBox x 범위(겹쳐 그리는 svg 조각)
const JUNCTION_X: Record<Junction, [number, number]> = { source: [296, 332], merge: [416, 460] };
// 테마 전환 때 색이 부드럽게 넘어가도록(SVG 속성 대신 style이라 전이가 걸린다)
const COLOR_TRANSITION = "fill 350ms var(--ease-smooth), stroke 350ms var(--ease-smooth)";

interface SampleTone {
  edge: string;
  ink: string;
  sub: string;
  unchangedFill: (stroke: string) => string;
  unchangedStroke: (stroke: string) => string;
  labelStroke: string;
  nodeRadius: number;
}

// 화면 그대로 — C안은 무변경 노드를 회색으로 누르고(process-node mutedNodeStyle), A안은 노드 타입 기본색 그대로
function getScreenTone(muteUnchanged: boolean): SampleTone {
  return {
    edge: "var(--color-border-strong)",
    ink: "var(--color-ink)",
    sub: "var(--color-ink-tertiary)",
    unchangedFill: (stroke) =>
      muteUnchanged
        ? "color-mix(in srgb, var(--color-ink-muted) 22%, white)"
        : `color-mix(in srgb, ${stroke} 18%, white)`,
    unchangedStroke: (stroke) => (muteUnchanged ? "color-mix(in srgb, var(--color-ink-muted) 75%, white)" : stroke),
    labelStroke: "transparent",
    nodeRadius: 4,
  };
}

// 문서용 — globals.css .bpm-export-compare-doc 변수(실제 출력과 같은 값)
const DOCUMENT_TONE: SampleTone = {
  edge: "var(--cmp-doc-edge)",
  ink: "var(--cmp-doc-ink)",
  sub: "var(--cmp-doc-sub)",
  unchangedFill: () => "var(--cmp-doc-node-fill)",
  unchangedStroke: () => "var(--cmp-doc-node-stroke)",
  labelStroke: "var(--cmp-doc-label-stroke)",
  nodeRadius: 1,
};

function getBoxStyle(x: number, y: number, w: number, viewH: number): CSSProperties {
  return { left: `${(x / VIEW_W) * 100}%`, top: `${(y / viewH) * 100}%`, width: `${(w / VIEW_W) * 100}%` };
}

interface ComparePngPreviewProps {
  options: ComparePngExportOptions;
  displayFields: NodeDisplayToggle[];
  paletteKey: "a" | "c";
  muteUnchanged: boolean;
  header: { title: string; metaLines: string[] };
  legendItems: CompareLegendItem[];
}

// 샘플 비교 흐름 — 시작 → 주문 접수(무변경) → 결제 검토(변경) → 배송 승인(추가, 추가 연결선) → 끝,
// 결제 검토 → 재고 재확인(삭제, 삭제 점선) → 끝. 실제 맵이 아니라 출력 모양의 차이를 보여 준다
function ComparePngPreview({ options, displayFields, paletteKey, muteUnchanged, header, legendItems }: ComparePngPreviewProps) {
  const { t } = useI18n();
  const isDocument = options.format === "document";
  const tone = isDocument ? DOCUMENT_TONE : getScreenTone(muteUnchanged);
  const hasGmp = displayFields.includes("gmp");
  const hasConditions = displayFields.includes("conditions");
  const lineFields = SAMPLE_LINE_FIELDS.filter((field) => displayFields.includes(field));
  const changedTop = LANE_Y - TITLE_ROW / 2 - PAD_Y - (hasGmp ? GMP_ROW : 0);
  const changedBottom = LANE_Y + TITLE_ROW / 2 + lineFields.length * LINE_ROW + PAD_Y;
  const viewH = Math.max(VIEW_H_MIN, changedBottom + (hasConditions ? 20 : 10));
  const removedY = REMOVED_Y - 13;
  // 화면 그대로는 비교 화면처럼 늘 펼침, 문서용은 칩을 따른다. 꺾임 반경도 화면·출력 값(lib/edge-path)
  const fanKey = !isDocument || options.edgeFan ? "fan" : "flat";
  const cornerRadius = isDocument ? PRINT_EDGE_CORNER_RADIUS : SCREEN_EDGE_CORNER_RADIUS;
  const edge = (d: string, status: CompareLegendStatus) => {
    const stroke = status === "unchanged" ? tone.edge : DIFF_COLOR[status];
    return (
      <path
        d={d}
        fill="none"
        strokeWidth={status === "unchanged" ? 1.25 : 1.75}
        strokeDasharray={status === "removed" ? "6 3" : undefined}
        style={{ stroke, transition: COLOR_TRANSITION }}
        markerEnd={`url(#compare-png-arrow-${status})`}
      />
    );
  };
  const badge = (x: number, y: number, status: Exclude<CompareLegendStatus, "unchanged">) => {
    const label = t(BADGE_KEY[status]);
    const width = label.length * 7 + 10;
    return (
      <g opacity={0.8}>
        <rect x={x} y={y - 6} width={width} height={12} rx={6} style={{ fill: DIFF_COLOR[status], transition: COLOR_TRANSITION }} />
        <text x={x + width / 2} y={y} textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight={600} style={{ fill: "var(--color-on-accent)" }}>
          {label}
        </text>
      </g>
    );
  };
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    status: CompareLegendStatus,
    kind: "task" | "term",
  ) => {
    const own = resolveNodeStroke("", kind === "term" ? "start" : "process");
    const stroke = status === "unchanged" ? tone.unchangedStroke(own) : DIFF_COLOR[status];
    const fill = status === "unchanged" ? tone.unchangedFill(own) : `color-mix(in srgb, ${DIFF_COLOR[status]} 12%, white)`;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={kind === "term" ? h / 2 : tone.nodeRadius}
          strokeWidth={isDocument && status === "unchanged" ? 1 : 1.5}
          strokeDasharray={status === "removed" ? "4 2" : undefined}
          style={{ fill, stroke, transition: COLOR_TRANSITION }}
        />
        <text
          x={x + w / 2}
          y={y + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="10"
          style={{ fill: status === "unchanged" && !isDocument && muteUnchanged ? tone.sub : tone.ink }}
        >
          {label}
        </text>
        {status !== "unchanged" && badge(x + 6, y, status)}
      </g>
    );
  };
  const changedStroke = DIFF_COLOR.changed;
  return (
    <div
      data-id="compare-png-preview"
      data-diff-palette={paletteKey}
      className={`overflow-hidden rounded-sm border border-hairline transition-colors duration-350 ${
        isDocument ? "bpm-export-compare-doc bg-surface" : "bg-canvas"
      }`}
      style={
        isDocument
          ? undefined
          : { backgroundImage: "radial-gradient(var(--color-canvas-dot) 1px, transparent 1px)", backgroundSize: "16px 16px" }
      }
    >
      {/* 정보 블록 — 출력과 같이 그림 위. 맵 이름·기준 → 대상·내보낸 시각·건수는 실제 값 */}
      <ShimmerPresence
        show={options.showInfo}
        dataId="compare-png-preview-header"
        className="relative mx-3 mt-2.5 pb-1.5"
        style={{
          borderBottom: isDocument ? "2px solid var(--cmp-doc-ink)" : "1px solid var(--color-hairline)",
        }}
      >
        <div className="truncate text-caption font-semibold" style={{ color: tone.ink }}>
          {header.title}
        </div>
        {header.metaLines.map((line) => (
          <div key={line} className="truncate text-fine" style={{ color: tone.sub }}>
            {line}
          </div>
        ))}
      </ShimmerPresence>
      <div className="relative">
        <svg viewBox={`0 0 ${VIEW_W} ${viewH}`} className="block w-full" aria-hidden>
          <defs>
            {(["unchanged", "added", "changed", "removed"] as const).map((status) => (
              <marker
                key={status}
                id={`compare-png-arrow-${status}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path
                  d="M0,0 L10,5 L0,10 z"
                  style={{ fill: status === "unchanged" ? tone.edge : DIFF_COLOR[status], transition: COLOR_TRANSITION }}
                />
              </marker>
            ))}
          </defs>
          {edge(`M64,${LANE_Y} L83,${LANE_Y}`, "unchanged")}
          {edge(`M174,${LANE_Y} L${CHANGED_X - 1},${LANE_Y}`, "unchanged")}
          {edge(`M${CHANGED_X + CHANGED_W},${LANE_Y} L327,${LANE_Y}`, "added")}
          {edge(`M420,${LANE_Y} L455,${LANE_Y}`, "added")}
          {box(10, LANE_Y - 13, 54, 26, "Start", "unchanged", "term")}
          {box(84, LANE_Y - 17, 90, 34, t("comparePng.sampleReceive"), "unchanged", "task")}
          {box(328, LANE_Y - 17, 92, 34, t("comparePng.sampleApprove"), "added", "task")}
          {box(328, removedY, 92, 26, t("comparePng.sampleRecheck"), "removed", "task")}
          {box(456, LANE_Y - 13, 54, 26, "End", "unchanged", "term")}
        </svg>
        {/* 연결선 펼침이 바꾸는 두 자리 — 펼침(원호) ↔ 끔(추가 연결선과 한 줄기)을 그 자리에서만 쉬머로 바꾼다 */}
        {(["fan", "flat"] as const).flatMap((set) =>
          (["source", "merge"] as const).map((spot) => {
            const [x0, x1] = JUNCTION_X[spot];
            const path = (set === "fan" ? FAN_PATHS : FLAT_PATHS)[spot];
            return (
              <ShimmerPresence
                key={`${set}-${spot}`}
                show={fanKey === set}
                dataId={`compare-png-preview-${set}-${spot}`}
                className="pointer-events-none absolute top-0 h-full"
                style={{ left: `${(x0 / VIEW_W) * 100}%`, width: `${((x1 - x0) / VIEW_W) * 100}%` }}
              >
                <svg
                  viewBox={`${x0} 0 ${x1 - x0} ${viewH}`}
                  preserveAspectRatio="none"
                  className="block h-full w-full overflow-visible"
                  aria-hidden
                >
                  {edge(buildSampleStepPath(path, cornerRadius), "removed")}
                </svg>
              </ShimmerPresence>
            );
          }),
        )}
        {/* 변경 노드(결제 검토) — HTML로 겹쳐 그려 표시 정보 줄마다 쉬머로 생기고 사라진다 */}
        <div
          data-id="compare-png-preview-node"
          className="absolute overflow-hidden border transition-[top,height,border-radius] duration-350 ease-smooth"
          style={{
            ...getBoxStyle(CHANGED_X, changedTop, CHANGED_W, viewH),
            height: `${((changedBottom - changedTop) / viewH) * 100}%`,
            padding: `${PAD_Y}px 6px`,
            background: `color-mix(in srgb, ${changedStroke} 12%, white)`,
            borderColor: changedStroke,
            borderWidth: 1.5,
            borderRadius: tone.nodeRadius,
          }}
        >
          <ShimmerPresence show={hasGmp} dataId="compare-png-preview-gmp" className="relative flex rounded-full" style={{ height: GMP_ROW }}>
            <span
              className="rounded-full border px-1 text-[8px] leading-[10px]"
              style={{ borderColor: "var(--color-hairline)", color: tone.sub }}
            >
              GMP Direct
            </span>
          </ShimmerPresence>
          <div className="truncate text-center text-[11px]" style={{ height: TITLE_ROW, lineHeight: `${TITLE_ROW}px`, color: tone.ink }}>
            {t("comparePng.sampleReview")}
          </div>
          {SAMPLE_LINE_FIELDS.map((field) => {
            const Icon = TOGGLE_ICONS[field];
            const labelKey = SAMPLE_LINE_KEY[field];
            return (
              <ShimmerPresence
                key={field}
                show={displayFields.includes(field)}
                dataId={`compare-png-preview-line-${field}`}
                className="relative flex items-center gap-1 rounded-xs text-[8px]"
                style={{ height: LINE_ROW, color: tone.sub }}
              >
                <Icon size={8} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{labelKey ? t(labelKey) : ""}</span>
              </ShimmerPresence>
            );
          })}
        </div>
        <span
          className="pointer-events-none absolute -translate-y-1/2 whitespace-nowrap rounded-full px-1.5 text-[7.5px] font-semibold leading-3 text-on-accent opacity-80"
          style={{ ...getBoxStyle(CHANGED_X + 6, changedTop, 0, viewH), width: "auto", background: changedStroke }}
        >
          {t("compare.legendChanged")}
        </span>
        {/* 시작·종료 조건 — 노드 밖 위·아래 캡션 */}
        <ShimmerPresence
          show={hasConditions}
          dataId="compare-png-preview-cond-start"
          className="absolute truncate rounded-xs text-[8px]"
          style={{ ...getBoxStyle(CHANGED_X, changedTop - 18, 120, viewH), color: tone.sub }}
        >
          {`▷ ${t("pngExport.sampleStart")}`}
        </ShimmerPresence>
        <ShimmerPresence
          show={hasConditions}
          dataId="compare-png-preview-cond-end"
          className="absolute truncate rounded-xs text-[8px]"
          style={{ ...getBoxStyle(CHANGED_X, changedBottom + 2, 110, viewH), color: tone.sub }}
        >
          {`■ ${t("pngExport.sampleEnd")}`}
        </ShimmerPresence>
      </div>
      {/* 범례 — 출력과 같이 그림 아래 왼쪽, 현재 상태 색 구성의 견본 */}
      <ShimmerPresence
        show={options.showLegend}
        dataId="compare-png-preview-legend"
        className="relative mx-3 mb-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xs text-fine"
        style={{ color: tone.ink }}
      >
        {legendItems.map((item) => (
          <span key={item.status} className="inline-flex items-center gap-1">
            <LegendSwatch status={item.status} tone={tone} isDocument={isDocument} muteUnchanged={muteUnchanged} />
            {item.label}
          </span>
        ))}
      </ShimmerPresence>
    </div>
  );
}

// 범례 견본 — 노드와 같은 표기(상태색 12% 틴트 + 테두리, 삭제는 점선). 바뀌지 않음은 현재 구성의 무변경 노드 톤
function LegendSwatch({
  status,
  tone,
  isDocument,
  muteUnchanged,
}: {
  status: CompareLegendStatus;
  tone: SampleTone;
  isDocument: boolean;
  muteUnchanged: boolean;
}) {
  // A안 화면은 무변경 노드가 제 색이라 견본은 중립 흰 칸(출력 범례 lib/export readCompareColors와 같은 규칙)
  const isNeutral = !isDocument && !muteUnchanged;
  const stroke =
    status !== "unchanged" ? DIFF_COLOR[status] : isNeutral ? "var(--color-hairline)" : tone.unchangedStroke("");
  const fill =
    status !== "unchanged"
      ? `color-mix(in srgb, ${DIFF_COLOR[status]} 12%, white)`
      : isNeutral
        ? "var(--color-surface)"
        : tone.unchangedFill("");
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-[2px] border-[1.5px]"
      style={{ borderColor: stroke, background: fill, borderStyle: status === "removed" ? "dashed" : "solid" }}
    />
  );
}
