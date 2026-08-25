"use client";

import { Fragment, useRef, type CSSProperties } from "react";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleArrowUp,
  CornerDownRight,
  Flag,
  Link as LinkIcon,
  Lock,
  LogIn,
  LogOut,
  type LucideIcon,
  MessageSquare,
  Pin,
  Play,
  Plus,
  Server,
  ShieldCheck,
  User,
  Workflow,
  Zap,
} from "lucide-react";

import {
  hasBpmAttributes,
  hasCustomTerminalLabel,
  type AppNode,
  type HandleSide,
  type ProcessNodeType,
  terminalDisplayLabel,
  toPosition,
} from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { type NodeDisplayField, useNodeActions } from "@/lib/node-actions";
import { PARAM_ICON } from "@/components/param-icons";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { resolveDataForm } from "@/lib/data-forms";
import { getIoLine } from "@/lib/io-items";
import { formatParamValue, PARAM_FIELDS, type ParamField } from "@/lib/params";
import {
  PRIMARY_END_HANDLE,
  SUBPROCESS_IN_HANDLE,
  type SubEnd,
} from "@/lib/subprocess-embed";

const FIELD_ICON: Record<Exclude<NodeDisplayField, "conditions">, LucideIcon> = {
  assignee: User,
  department: Building2,
  system: Server,
  url: LinkIcon,
  // 승격 IO — 인스펙터 I/O & Conditions 카드와 동일 아이콘 (2026-08-20)
  input: LogIn,
  output: LogOut,
};

// 캔버스 규범 순서(#10) — 표시 순서는 토글을 켠 순서가 아니라 고정: 속성 → 지표(NodeParams) →
// 조건 → 인풋 → 아웃풋. 속성 줄은 NodeFields, 조건·IO는 NodeIoDetails(지표 뒤)가 담당.
// url 줄은 폐기 — 좌하단 UrlBadge + 액션 바 링크가 전부 (사용자 결정 2026-08-25).
const ATTR_FIELD_ORDER = ["assignee", "department", "system"] as const;

// 노드 속성 줄(담당자/부서/시스템) — 켜진 필드 중 값이 있는 것만, 규범 순서 고정.
// start/end는 BPM 속성 줄을 표시하지 않음. subprocess는 지정 어트리뷰트(sp*, 라이브 참조) (spec 2026-07-06).
function NodeFields({ data }: { data: AppNode["data"] }) {
  const { displayFields } = useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const spValues: Record<(typeof ATTR_FIELD_ORDER)[number], string | null | undefined> = {
    assignee: data.spAssignee,
    department: data.spDepartment,
    system: data.spSystem,
  };
  return (
    <>
      {ATTR_FIELD_ORDER.filter((field) => displayFields.includes(field)).map((field) => {
        const value = isSubprocess ? spValues[field] : data[field];
        if (!value) return null;
        const Icon = FIELD_ICON[field];
        return (
          <div key={field} className="mt-0.5 text-xs text-ink-tertiary">
            <span className="inline-flex items-center gap-1">
              <Icon size={12} strokeWidth={1.5} />
              {value}
            </span>
          </div>
        );
      })}
    </>
  );
}

// 조건·IO 표시 — 지표 뒤 고정 순서(조건→인풋→아웃풋, #10). IO는 체크리스트 영역(#9):
// 체크는 화면 한정(저장 안 함) 상태이고, 키가 링크 itemId면 원본·미러가 동반 체크된다.
function NodeIoDetails({
  nodeId,
  data,
  nodeSelected = true,
  framed = false,
}: {
  nodeId: string;
  data: AppNode["data"];
  // 미선택 노드의 헤더 클릭은 접힘/열림 대신 선택(포커스 이동)만 — 클릭 버블이 RF onNodeClick으로
  // 흘러 선택되고, 선택된 뒤의 클릭부터 토글로 동작한다 (사용자 요청 2026-08-25).
  nodeSelected?: boolean;
  // 분기(decision)처럼 노드 밖(캔버스 위)에 뜰 때 — 배경과 구분되도록 보더/그림자 강조
  framed?: boolean;
}) {
  const { t } = useI18n();
  const { displayFields, ioChecks, onToggleIoCheck, ioListStates, onSetIoListState, ioCheckPulse } =
    useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const conditionLines = displayFields.includes("conditions")
    ? [
        {
          key: "start_condition",
          icon: Play,
          value: isSubprocess ? data.spStartCondition : data.start_condition,
        },
        {
          key: "end_condition",
          icon: Flag,
          value: isSubprocess ? data.spEndCondition : data.end_condition,
        },
      ].filter((line) => !!line.value)
    : [];
  const sides = (["input", "output"] as const).filter((side) => displayFields.includes(side));
  return (
    <>
      {conditionLines.map(({ key, icon: Icon, value }) => (
        <div key={key} className="mt-0.5 text-xs text-ink-tertiary">
          <span className="inline-flex items-center gap-1">
            <Icon size={12} strokeWidth={1.5} />
            {value}
          </span>
        </div>
      ))}
      {sides.map((side) => {
        const raw = isSubprocess
          ? side === "input"
            ? data.spInput
            : data.spOutput
          : data[side];
        const visible = (raw ?? "")
          .split("\n")
          .map((text, index) => ({ text: text.trim(), index }))
          .filter((item) => item.text !== "");
        if (visible.length === 0) return null;
        const Icon = FIELD_ICON[side];
        // 표시 3단계(#2): collapsed=헤더만 · capped=3.5줄 오버플로 히든 · all=전부. 화면 한정 상태
        const listKey = `${nodeId}:${side}`;
        const listState = ioListStates.get(listKey) ?? "capped";
        const hiddenCount = Math.max(0, visible.length - 3);
        return (
          // nodrag/nopan + 전파 차단 — 체크 조작이 드래그·더블클릭(요약 모달)로 새지 않게
          <div
            key={side}
            data-id={`node-io-list-${side}`}
            className={`group/iobox nodrag nopan mt-1 rounded-sm border bg-surface px-1.5 py-1 ${
              framed ? "border-ink-tertiary/40 shadow-sm" : "border-hairline"
            }`}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {/* 헤더 클릭 = 접기(0줄)↔기본(3.5줄) 토글(#2). 미선택 노드에선 토글 없이 선택만(버블). */}
            <button
              type="button"
              data-id={`node-io-list-${side}-toggle`}
              tabIndex={-1}
              disabled={onSetIoListState === null}
              className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wide text-ink-muted"
              onClick={() => {
                if (!nodeSelected) return;
                onSetIoListState?.(listKey, listState === "collapsed" ? "capped" : "collapsed");
              }}
            >
              <ChevronRight
                size={10}
                strokeWidth={1.5}
                className={`shrink-0 transition-transform duration-150 ${
                  listState === "collapsed" ? "" : "rotate-90"
                }`}
              />
              <Icon size={10} strokeWidth={1.5} />
              {side === "input" ? "Input" : "Output"}
              <span className="normal-case tracking-normal">({visible.length})</span>
            </button>
            {listState !== "collapsed" && (
              // 3.5줄 캡 — 4번째 줄이 반쯤 보여 "더 있음"이 드러난다(#2).
              // nowheel+overflow-y-auto — 호버 중 휠은 캔버스 팬 대신 이 목록을 스크롤 (사용자 요청 2026-08-25).
              <div
                className={
                  listState === "capped" && hiddenCount > 0
                    ? "nowheel scroll-quiet max-h-[63px] overflow-y-auto"
                    : undefined
                }
              >
                {visible.map(({ text, index }) => {
                  // 링크 항목은 itemId가 키 — 미러 인풋 체크 시 원본 아웃풋·형제 미러가 함께 체크(#9)
                  const checkKey = isSubprocess
                    ? `${nodeId}:${side}:${index}`
                    : side === "input"
                      ? getIoLine(data.input_links, index) || `${nodeId}:in:${index}`
                      : getIoLine(data.output_ids, index) ||
                        getIoLine(data.output_links, index) ||
                        `${nodeId}:out:${index}`;
                  const checked = ioChecks.has(checkKey);
                  // 체크 동기 애니메이션(#3) — key에 논스를 실어 같은 키 재체크도 재생(리마운트)
                  const pulsing = ioCheckPulse !== null && ioCheckPulse.key === checkKey;
                  // 미체크 인풋은 필수/선택을 글자색으로 분류(선택=뮤트), 양식은 아이콘만 맨 뒤
                  // 고정 노출+호버 툴팁 — 긴 이름은 2줄 클램프라 텍스트가 잘려도 아이콘은 남는다
                  const isOptional =
                    !isSubprocess && side === "input" && getIoLine(data.input_flags, index) === "optional";
                  // SP는 링크 맵 지정의 sp_*_forms 상속(subprocess_refs 경유) — 플래그는 소비자 로컬이라 없음
                  const formsRaw = isSubprocess
                    ? ((side === "input" ? data.spInputForms : data.spOutputForms) ?? "")
                    : side === "input"
                      ? data.input_forms
                      : data.output_forms;
                  const form = resolveDataForm(getIoLine(formsRaw, index));
                  return (
                    // 빈 체크박스는 행 호버 시에만 노출, 체크된 것은 유지. 체크 텍스트는 accent-tint
                    // 하이라이트+진한 글자 — 취소선·딤 대신 "확인됨" 강조 (사용자 결정 2026-08-23)
                    <label
                      key={pulsing ? `${index}-p${ioCheckPulse.nonce}` : index}
                      className={`group/iorow -mx-0.5 flex cursor-pointer items-start gap-1 rounded-xs px-0.5 py-px text-xs text-ink-tertiary hover:bg-surface-alt ${
                        pulsing ? "bpm-io-pulse" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        data-id={`node-io-check-${side}-${index}`}
                        tabIndex={-1}
                        className={`mt-0.5 h-3 w-3 shrink-0 accent-[var(--color-accent)] transition-opacity duration-150 ${
                          checked ? "" : "opacity-0 group-hover/iorow:opacity-100"
                        }`}
                        checked={checked}
                        disabled={onToggleIoCheck === null}
                        onChange={() => onToggleIoCheck?.(checkKey)}
                      />
                      <span
                        className={`line-clamp-2 min-w-0 flex-1 break-words ${
                          checked
                            ? "rounded-xs bg-accent-tint px-0.5 text-ink"
                            : isOptional
                              ? "text-ink-muted"
                              : ""
                        }`}
                      >
                        {text}
                      </span>
                      {form && (
                        <span title={form.value} className="mt-0.5 shrink-0 text-ink-muted">
                          <form.icon size={10} strokeWidth={1.5} />
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
            {listState !== "collapsed" && hiddenCount > 0 && (
              // 전체 펼침↔기본 캡 토글(#2) — 전체 펼침 시 간격 재조정(#1)은 별도 브랜치에서
              // 박스 호버 시에만 노출 — 평상시엔 4번째 반 줄이 "더 있음"을 암시 (사용자 요청 2026-08-23)
              <button
                type="button"
                data-id={`node-io-list-${side}-more`}
                tabIndex={-1}
                disabled={onSetIoListState === null}
                className="mt-0.5 flex w-full items-center gap-0.5 text-left text-[10px] text-accent opacity-0 transition-opacity duration-150 group-hover/iobox:opacity-100"
                onClick={() => onSetIoListState?.(listKey, listState === "all" ? "capped" : "all")}
              >
                {listState === "all" ? (
                  <ChevronUp size={10} strokeWidth={1.5} className="shrink-0" />
                ) : (
                  <ChevronDown size={10} strokeWidth={1.5} className="shrink-0" />
                )}
                {listState === "all" ? t("io.showLess") : `${t("io.showMore")} (+${hiddenCount})`}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

// GMP 필 태그 — 노드 라벨 왼쪽 위 부유(토글 "gmp"). 분류가 색을 확정, null(미분류)은 아이콘만.
// 편집 모드(onEditGmp 제공)에서 클릭하면 해당 노드의 gmp 분류 피커 — SP 노드는 링크 맵 상속이라
// read-only(수정은 링크 맵 설정 Conditions & GMP에서) (design 2026-08-20).
function GmpPill({ nodeId, data, className: extra }: { nodeId: string; data: AppNode["data"]; className?: string }) {
  const { displayFields, onEditGmp } = useNodeActions();
  if (!displayFields.includes("gmp")) return null;
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const value = (isSubprocess ? data.spGmp : data.gmp) ?? "";
  const label = formatGmp(value);
  const editable = !isSubprocess && onEditGmp !== null;
  // 미분류(Unclassified)는 공간을 차지하지 않고 기본 숨김 — 노드 호버 시 좌상단에 부유로만 노출
  // (분류 진입점은 유지, 사용자 요청 2026-08-25). 이때 호출부 위치 className(extra)은 무시한다.
  const floating = !label;
  // 노드 안쪽 배치(사용자 결정 2026-08-20) — 배치는 호출부 className이 담당(사각=본문 첫 줄, 마름모=상단 중앙)
  // whitespace-nowrap — 좁은 노드에서 "GMP Indirect"가 두 줄로 꺾이지 않게 (사용자 요청 2026-08-21 #8)
  const className =
    "nodrag nopan inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 py-0 text-[10px] leading-4 " +
    (label ? "border-transparent " : "border-hairline bg-surface text-ink-muted ") +
    (floating
      ? "absolute -left-2 -top-2 z-10 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      : (extra ?? ""));
  const body = (
    <>
      <ShieldCheck size={10} strokeWidth={1.5} className="shrink-0" />
      {label && <span>{label}</span>}
    </>
  );
  if (!editable) {
    return (
      <span data-id="node-gmp-pill" className={className} style={label ? getGmpBadgeStyle(value) : undefined} title="GMP">
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-id="node-gmp-pill"
      // 캔버스 탭 순회에서 제외 — Tab이 노드 대신 GMP 태그를 넘어다니는 문제(#16)
      tabIndex={-1}
      className={`${className} hover:brightness-95`}
      style={label ? getGmpBadgeStyle(value) : undefined}
      title="GMP - click to classify"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onEditGmp?.(nodeId, event.clientX, event.clientY);
      }}
    >
      {body}
    </button>
  );
}

// 파라미터 칩 — 값이 작성된 파라미터 전부, 라벨 없이 아이콘+숫자 (design 2026-07-11 §2.4, 2026-07-13 §3.2)
// subprocess는 회당 4필드를 지정 어트리뷰트(sp*, 라이브 참조)로, 연간 건수·FTE는 노드 자체 값으로 표시.
// duration은 1h30m, 비용 2필드는 통화기호+천단위 콤마, 나머지는 원문 숫자.
function NodeParams({ data, className }: { data: AppNode["data"]; className?: string }) {
  const { displayFields } = useNodeActions();
  const isSubprocess = data.nodeType === "subprocess";
  // "params" 토글 OFF면 칩 전체 숨김 (맵 탭 노드 표시 정보 — 6필드 일괄 스위치)
  if (!displayFields.includes("params")) return null;
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  const values: Partial<Record<ParamField, string | null | undefined>> = {
    annual_count: data.annual_count,
    fte: data.fte,
    ...(isSubprocess
      ? {
          duration: data.spDuration,
          touch_time: data.spTouchTime,
          cost_krw: data.spCostKrw,
          cost_usd: data.spCostUsd,
          headcount: data.spHeadcount,
        }
      : {
          duration: data.duration,
          touch_time: data.touch_time,
          cost_krw: data.cost_krw,
          cost_usd: data.cost_usd,
          headcount: data.headcount,
        }),
  };
  // 표시형 결과 기준으로 filled 판정 — 무효(레거시 자유텍스트)는 ""가 되어 칩 자체를 숨김
  // (백엔드가 이미 소거하므로 실제로는 도달하지 않는 방어 코드).
  const displayValue = (f: ParamField): string => formatParamValue(f, values[f]);
  const filled = PARAM_FIELDS.filter((f) => displayValue(f));
  if (filled.length === 0) return null;
  return (
    <div
      className={`mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-tertiary${className ? ` ${className}` : ""}`}
    >
      {filled.map((f) => {
        const Icon = PARAM_ICON[f];
        return (
          <span key={f} className="inline-flex items-center gap-1">
            <Icon size={12} strokeWidth={1.5} />
            {displayValue(f)}
          </span>
        );
      })}
    </div>
  );
}

// 노드 타이틀 — 더블클릭 인라인 편집(editingNodeId 일치 시 입력 모드). 평상시 호버에 I-beam 커서.
// 타이틀 더블클릭만 이름 편집으로 진입(stopPropagation) — 이름 외 영역은 노드 요약창으로.
// displayLabel: 표시 전용(시작/끝의 "Start (라벨)"). 편집 입력은 항상 원본 label을 다룬다.
function NodeTitle({
  id,
  label,
  displayLabel,
  editable = true,
  clamp3 = false,
}: {
  id: string;
  label: string;
  displayLabel?: string;
  // false면 인라인 이름 편집 진입 차단 — subprocess는 링크된 맵 이름 고정 (F5)
  editable?: boolean;
  // 마름모 전용 — 3줄 클램프+말줄임(#4). 전문은 title 툴팁, 인쇄(PNG)는 export 픽스업이 해제
  clamp3?: boolean;
}) {
  const { t } = useI18n();
  const { editingNodeId, onStartRename, onRename, onCancelRename } = useNodeActions();
  // Esc 취소 시 onBlur가 값을 다시 커밋하지 않도록 가드
  const cancelledRef = useRef(false);

  if (editable && editingNodeId === id && onRename) {
    // 내용 높이에 맞춰 늘어나는 자동 높이 — 줄바꿈(Alt/Shift+Enter) 시 잘리지 않게
    const fitHeight = (el: HTMLTextAreaElement) => {
      el.style.height = "0";
      el.style.height = `${el.scrollHeight}px`;
    };
    return (
      <textarea
        autoFocus
        defaultValue={label}
        rows={1}
        // 줄바꿈 단축키 안내(#7) — 캔버스 인라인은 공간이 없어 title 툴팁으로
        title={t("hint.newline")}
        // nodrag — 입력 중 React Flow가 노드를 끌지 않게
        className="nodrag w-full resize-none overflow-hidden rounded-xs border border-accent bg-surface px-1 text-center text-sm text-ink"
        ref={(el) => {
          if (el) fitHeight(el);
        }}
        onInput={(event) => fitHeight(event.currentTarget)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onBlur={(event) => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
          }
          // 끝쪽 줄바꿈만 정리 — Alt/Shift+Enter 후 그대로 커밋하면 빈 줄이 남는다
          onRename(id, event.target.value.replace(/\n+$/, ""));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.altKey || event.shiftKey) {
              // Alt/Shift+Enter = 줄바꿈 삽입 (Enter는 커밋) — 비제어 입력이라 setRangeText로 충분
              const el = event.currentTarget;
              el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
              fitHeight(el);
            } else {
              event.currentTarget.blur();
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            onCancelRename?.();
          }
        }}
      />
    );
  }
  return (
    <span
      className={`whitespace-pre-wrap ${clamp3 ? "bpm-decision-title line-clamp-3" : ""} ${
        editable && onStartRename ? "cursor-text" : ""
      }`}
      title={clamp3 ? (displayLabel ?? label) : undefined}
      onDoubleClick={
        editable && onStartRename
          ? (event) => {
              // 타이틀 더블클릭 = 이름 편집 (노드 더블클릭=요약창으로 버블되지 않게 차단)
              event.stopPropagation();
              onStartRename(id);
            }
          : undefined
      }
    >
      {displayLabel ?? label}
    </span>
  );
}

// 타입별 기본 stroke — data.color 미지정(빈 값) 시 사용. 세련된 무채도 톤(데이터/출력 예외 → raw hex 허용)
const DEFAULT_COLORS: Record<ProcessNodeType, string> = {
  process: "#6e84a3", // slate (E3)
  decision: "#c7a062", // amber
  start: "#84a07c", // sage
  end: "#c2849a", // rose
  subprocess: "#7c6adc", // violet
  section: "#909098", // stone
};

// data.color 우선, 없으면 타입별 기본 stroke — 미니맵 등에서 실제 노드 색 재사용.
// subprocess는 단일색 고정이라 저장 color 무시 (spec 2026-07-06 §9)
export function resolveNodeStroke(color: string, nodeType: ProcessNodeType): string {
  if (nodeType === "subprocess") return DEFAULT_COLORS.subprocess;
  return color || DEFAULT_COLORS[nodeType];
}

// 파스텔 fill — 저장된 stroke color에서 파생(데이터 모델 무변경)
function deriveFill(color: string): string {
  return `color-mix(in srgb, ${color} 18%, white)`;
}

// 비교 화면 diff — 노드 자기색 대신 diff색으로 테두리/틴트/뱃지 (에디터에선 diffStatus 미설정).
type DiffStatus = "added" | "removed" | "changed";
const DIFF_COLOR: Record<DiffStatus, string> = {
  added: "var(--color-added)",
  removed: "var(--color-removed)",
  changed: "var(--color-changed)",
};
const DIFF_BADGE_KEY: Record<DiffStatus, MessageKey> = {
  added: "compare.legendAdded",
  removed: "compare.legendRemoved",
  changed: "compare.legendChanged",
};
const DIFF_BADGE_BG: Record<DiffStatus, string> = {
  added: "bg-added",
  removed: "bg-removed",
  changed: "bg-changed",
};

// diff 노드 스타일 — diff색 테두리(삭제=점선)+연한 틴트 fill. --nc는 호버 강조 링용.
function diffNodeStyle(status: DiffStatus): CSSProperties {
  const c = DIFF_COLOR[status];
  return {
    borderColor: c,
    borderWidth: "1.5px",
    borderStyle: status === "removed" ? "dashed" : "solid",
    background: `color-mix(in srgb, ${c} 12%, white)`,
    "--nc": c,
  } as unknown as CSSProperties;
}

// 상태 뱃지(상단) — opacity .7로 내용 안 가림. 위치는 className으로(마름모는 상단중앙).
function DiffBadge({ status, className = "-top-2.5 left-2.5" }: { status: DiffStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute z-10 rounded-full px-1.5 text-[11px] font-semibold leading-5 text-white opacity-70 ${DIFF_BADGE_BG[status]} ${className}`}
    >
      {t(DIFF_BADGE_KEY[status])}
    </span>
  );
}

// 필 배경은 노드 fill과 동일한 불투명 틴트 — 뒤로 지나는 엣지(우회 아크)가 비쳐 변경 내용을 가리지 않게.
const CHANGED_PILL_BG = "color-mix(in srgb, var(--color-changed) 12%, white)";

// 변경 필드 before→after 필 — 노드 아래에 절대배치(레이아웃 영향 없음). changed 노드만.
// 최대 3줄 + "+N more"로 캡(다필드 변경 시 아래 노드 침범 방지). 값은 폭 제한 truncate.
function DiffFieldPills({ fields }: { fields: NonNullable<AppNode["data"]["diffFields"]> }) {
  const { t } = useI18n();
  const shown = fields.slice(0, 3);
  const extra = fields.length - shown.length;
  return (
    <div className="absolute left-0 top-full z-10 mt-1.5 flex flex-col items-start gap-1">
      {shown.map((field) => (
        <span
          key={field.label}
          className="flex max-w-[220px] items-center gap-1 whitespace-nowrap rounded-xs border border-changed/30 px-1.5 py-0.5 text-[11px]"
          style={{ backgroundColor: CHANGED_PILL_BG }}
        >
          <span className="shrink-0 font-semibold text-changed">{field.label}</span>
          <span className="min-w-0 truncate text-ink-muted">{field.before}</span>
          <span className="shrink-0 text-ink-tertiary">→</span>
          <span className="min-w-0 truncate font-semibold text-ink">{field.after}</span>
        </span>
      ))}
      {extra > 0 && (
        <span
          className="rounded-xs border border-changed/30 px-1.5 py-0.5 text-[11px] font-medium text-changed"
          style={{ backgroundColor: CHANGED_PILL_BG }}
        >
          {t("compare.moreFields", { n: extra })}
        </span>
      )}
    </div>
  );
}

// 미해결 코멘트 수 뱃지 (에디터 전용)
// className — 위치 오버라이드: 마름모(분기)는 사각 경계 코너가 도형에서 멀어 안쪽 오프셋 사용 (batch2 ⑬)
function UnresolvedCommentBadge({
  count,
  className = "-left-2 -top-2",
}: {
  count: number;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full bg-removed px-1 text-[10px] leading-4 text-white`}
      title={t("node.unresolvedAria", { n: count })}
    >
      <span className="inline-flex items-center gap-0.5">
        <MessageSquare size={10} strokeWidth={1.5} />
        {count}
      </span>
    </span>
  );
}

// URL 배지 — url 지정 노드 좌하단 표시 전용(반투명 액센트, 클릭 없음). 좌상단은 코멘트 배지,
// 우상·우하단은 경고/펼침이 사용 — 좌하단이 에디터·비교뷰 통틀어 유일하게 빈 모서리.
// 비교뷰는 노드 data에 url 미탑재(compare/page.tsx buildNodes)라 자동 미표시. (batch2 ⑧)
function UrlBadge({ url, className = "-bottom-2 -left-2" }: { url: string; className?: string }) {
  return (
    <span
      data-id="node-url-badge"
      className={`absolute ${className} rounded-xs border border-accent-tint-border bg-accent-tint/80 p-0.5 text-accent opacity-70`}
      title={url}
    >
      <LinkIcon size={12} strokeWidth={1.5} />
    </span>
  );
}

// 하위 계층에 변경이 있음을 알리는 뱃지 (비교 화면 전용)
function DescendantChangeBadge({ className = "-right-2 -top-2" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full bg-changed px-1 text-[10px] leading-4 text-white`}
      title={t("node.childChangedTitle")}
    >
      <Zap size={10} strokeWidth={1.5} />
    </span>
  );
}

// 담당자 부서 드리프트 경고 뱃지 — 담당자의 현재 부서가 노드 부서와 다를 때 (에디터 전용)
function AssigneeWarningBadge({ className = "-bottom-2 -right-2" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={`absolute ${className} rounded-full border border-hairline bg-surface p-0.5 shadow-sm`}
      title={t("assignee.driftWarn")}
    >
      <AlertTriangle size={12} strokeWidth={1.5} className="text-error" />
    </span>
  );
}

// 미지정 서브프로세스 뱃지 — 링크맵이 지정 해제/미지정이면 경고 삼각형 + 잠금(권한 무관). (spec 2026-07-06)
function UndesignatedBadge() {
  const { t } = useI18n();
  return (
    <span
      data-id="subprocess-undesignated-badge"
      className="absolute -right-2 -top-2 rounded-xs border border-error/40 bg-error/10 p-0.5 shadow-sm"
      title={t("subprocess.undesignated")}
    >
      <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
    </span>
  );
}

// 잠긴 하위프로세스 뱃지 — 권한 없는 링크맵은 펼침/드릴 대신 자물쇠 표시(봉인 박스). 펼침 버튼 자리를 대체.
function LockedBadge() {
  const { t } = useI18n();
  return (
    <span
      className="absolute -right-2 -top-2 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary shadow-sm"
      title={t("subprocess.locked")}
    >
      <Lock size={16} strokeWidth={1.5} />
    </span>
  );
}

// Ctrl/⌘+드래그 사본 배지 — 이 노드를 놓으면 원위치에 사본이 남는다는 신호(잔상과 세트, 드래그 중만 표시).
function CopyDragBadge({ className = "-right-2 -top-2" }: { className?: string }) {
  return (
    <span className={`absolute ${className} rounded-full bg-accent p-0.5 text-on-accent shadow-sm`}>
      <Plus size={14} strokeWidth={1.5} />
    </span>
  );
}

// 하위프로세스 노드의 핸들 — 좌측 단일 입력, 우측 끝 노드별 출력 (끝 없으면 단일 PRIMARY_END_HANDLE)
// connectable — 노드 레벨 connectable(임베드 읽기전용 자식 false)을 Handle에 전달해야 실제로 끌기가 막힌다 (F3)
// anchorTop — 좌 인핸들·단일 대표출력을 세로 중앙 대신 라벨 라인 높이(px)에 고정. 다중 끝 핸들은
// 종료 지점별 분산 배치가 기능이라 유지 (사용자 요청 2026-08-25 — 프로세스 노드 18px 고정과 정합).
function SubprocessHandles({
  ends,
  connectable,
  anchorTop,
}: {
  ends: SubEnd[];
  connectable: boolean;
  anchorTop?: number;
}) {
  const anchorStyle = anchorTop !== undefined ? { top: anchorTop } : undefined;
  return (
    <>
      <Handle
        id={SUBPROCESS_IN_HANDLE}
        type="target"
        position={Position.Left}
        isConnectable={connectable}
        style={anchorStyle}
      />
      {ends.length === 0 ? (
        <Handle
          id={PRIMARY_END_HANDLE}
          type="source"
          position={Position.Right}
          isConnectable={connectable}
          style={anchorStyle}
        />
      ) : (
        ends.map((end, i) => (
          <Handle
            key={end.key}
            id={end.key}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (ends.length + 1)) * 100}%` }}
            title={end.title}
            isConnectable={connectable}
          />
        ))
      )}
    </>
  );
}

const NODE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// 4변 각각에 source·target 핸들(총 8개) — 엣지가 어느 변에든 붙도록. 어느 핸들에 붙을지는 엣지가 id로 지정.
// connectable — SubprocessHandles와 동일하게 노드 레벨 값을 명시 전달(기본 true로 무시되는 것 방지) (F3)
// sideAnchorTop — 좌/우 핸들을 노드 세로 중앙 대신 제목 라인 높이에 고정(px). 키 큰 노드에서 엣지가
// 몸통 중앙이 아니라 라벨 옆에 붙고, 모든 노드가 같은 높이라 이웃 간 엣지가 수평 유지(사용자 요청 2026-08-24).
function NodeHandles({ connectable, sideAnchorTop }: { connectable: boolean; sideAnchorTop?: number }) {
  return (
    <>
      {NODE_SIDES.map((side) => {
        const style =
          sideAnchorTop !== undefined && (side === "left" || side === "right")
            ? { top: sideAnchorTop }
            : undefined;
        return (
          <Fragment key={side}>
            <Handle
              id={`t-${side}`}
              type="target"
              position={toPosition(side)}
              isConnectable={connectable}
              style={style}
            />
            <Handle
              id={`s-${side}`}
              type="source"
              position={toPosition(side)}
              isConnectable={connectable}
              style={style}
            />
          </Fragment>
        );
      })}
    </>
  );
}

// 노드 테두리/배경 + 호버 강조 링용 노드색 CSS 변수(--nc). @types/react가 커스텀 속성 인덱스
// 시그니처를 갖지 않아 unknown 경유 캐스팅(런타임은 React가 그대로 전달).
function nodeStyle(color: string, fill: string): CSSProperties {
  return {
    borderColor: color,
    borderWidth: "1.5px",
    borderStyle: "solid",
    background: fill,
    "--nc": color,
  } as unknown as CSSProperties;
}

// 프로세스 단계 노드 — node_type별 모양(사각/마름모/알약), 좌(입력)/우(출력) 핸들로 선후 연결.
// isConnectable — 노드 레벨 connectable(임베드 자식 false)이 여기로 전달됨. Handle에 명시 forward 필수 (F3).
export function ProcessNode({ id, data, isConnectable, selected }: NodeProps<AppNode>) {
  const { t } = useI18n();
  const { ctrlDragIds } = useNodeActions();
  const showCopyBadge = ctrlDragIds.has(id);
  // subprocess는 단일색 고정 — 과거 저장된 color도 렌더에서 무시(데이터 무변경) (spec 2026-07-06 §9)
  const color =
    data.nodeType === "subprocess"
      ? DEFAULT_COLORS.subprocess
      : data.color || DEFAULT_COLORS[data.nodeType];
  const fill = deriveFill(color);
  const commentCount = data.commentCount ?? 0;
  // 비교화면 diff — diff색 테두리/틴트/뱃지로 표시(에디터에선 diffStatus 미설정 → 자기색). 선택 링은 오버레이 담당.
  const diff = data.diffStatus;
  const style = diff ? diffNodeStyle(diff) : nodeStyle(color, fill);
  const diffFields = data.diffFields ?? [];

  if (data.nodeType === "subprocess") {
    return (
      // justify-start — 라벨을 상단 고정해 좌/우 핸들 라벨 라인 앵커(18px)와 정합 (사용자 요청 2026-08-25)
      <div
        className="group bpm-node-emph relative flex min-h-[64px] w-[180px] flex-col justify-start rounded-sm px-3 py-2 text-sm transition-all duration-150"
        style={style}
        title={data.diffNote}
      >
        {diff && <DiffBadge status={diff} />}
        {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
        <div className="mb-0.5 empty:hidden"><GmpPill nodeId={id} data={data} /></div>
        {/* SP 마크는 라벨 앞에만 — 아래 줄들(필드·IO)이 노드 전체 폭을 쓴다 (사용자 요청 2026-08-23) */}
        <div className="flex items-center gap-1.5 font-medium text-ink">
          <Workflow size={16} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
          <div className="min-w-0">
            {/* 타이틀 = 링크된 맵 이름 고정 — 인라인 이름 편집 차단 (F5) */}
            <NodeTitle id={id} label={data.label} editable={false} />
          </div>
        </div>
        {/* 지정 어트리뷰트 줄 — 표시 필드 설정(displayFields)을 따르고, 미지정이면 sp* 비어 자동 생략 */}
        <NodeFields data={data} />
        <NodeParams data={data} />
        <NodeIoDetails nodeId={id} data={data} nodeSelected={selected ?? false} />
        {/* 버전 추적 배너(하단) — 새 발행본이 우선(핀 고정을 함의), 아니면 핀 고정 안내만.
            점+텍스트보다 가시성 강화: 전체 폭 틴트 배너 (사용자 요청 2026-08-23) */}
        {data.updateAvailable ? (
          // 배너는 한 줄 고정(짧은 문구+truncate) — 전문은 툴팁 (사용자 요청 2026-08-23)
          <div
            data-id="sp-banner-update"
            title={t("subprocess.updateAvailable")}
            className="mt-1 flex items-center gap-1 rounded-xs border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-xs text-accent"
          >
            <CircleArrowUp size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{t("subprocess.updateBanner")}</span>
          </div>
        ) : data.followLatest === false ? (
          <div
            data-id="sp-banner-pinned"
            title={t("subprocess.pinnedNotice")}
            className="mt-1 flex items-center gap-1 rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-xs text-ink-secondary"
          >
            <Pin size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{t("subprocess.pinnedBanner")}</span>
          </div>
        ) : null}
        {data.hasDescendantChange && <DescendantChangeBadge />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
        {data.spUrl && <UrlBadge url={data.spUrl} />}
        {data.assigneeWarning && <AssigneeWarningBadge />}
        {/* 미지정 경고가 권한 잠금보다 우선 — 원인(지정 해제)을 보여야 오너가 조치 가능 */}
        {data.undesignated ? (
          <UndesignatedBadge />
        ) : data.locked ? (
          <LockedBadge />
        ) : null}
        {/* 핸들은 잠금 무관 유지 — 호스트의 입력/대표출력 엣지가 살아있어야 봉인 박스가 흐름에 연결됨.
            비교뷰는 모든 엣지를 4변 핸들로 재매핑하므로 diff 여부와 무관하게 NodeHandles 필요
            (unchanged subprocess가 SubprocessHandles를 렌더하면 엣지가 앵커 실패 — F1). */}
        {diff || data.sideHandles ? (
          <NodeHandles connectable={isConnectable ?? true} />
        ) : (
          <SubprocessHandles ends={data.subEnds ?? []} connectable={isConnectable ?? true} anchorTop={18} />
        )}
      </div>
    );
  }

  if (data.nodeType === "decision") {
    return (
      <div
        className="group relative flex h-24 w-[116px] items-center justify-center"
        title={data.diffNote}
      >
        {/* 마름모는 회전한 정사각형 + 화면축 scaleX(1.2)로 가로가 살짝 긴 1:1.2 비율(사용자 요청 2026-08-23).
            텍스트는 회전하지 않은 레이어에 둔다. 박스 폭 116은 canvas.ts nodeSizeOf와 동기화 필수 */}
        <div
          className="bpm-node-emph absolute left-1/2 top-1/2 h-[72px] w-[72px] rounded-sm transition-all duration-150"
          style={{ ...style, transform: "translate(-50%, -50%) scaleX(1.2) rotate(45deg)" }}
        />
        {diff && <DiffBadge status={diff} className="-top-1 left-1/2 -translate-x-1/2" />}
        {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
        {/* GMP 태그는 왼쪽 위 바깥쪽(#4) — 가운데 3줄 제목·우상단 코멘트 배지와 겹치지 않게 */}
        <GmpPill nodeId={id} data={data} className="absolute -left-2 top-0 z-10" />
        <div className="bpm-decision-title-box relative max-w-24 text-center text-xs font-medium text-ink">
          <NodeTitle id={id} label={data.label} clamp3 />
          {data.hasChildren && (
            <div className="inline-flex items-center gap-0.5 text-[10px] text-accent">
              <CornerDownRight size={12} strokeWidth={1.5} />
              {t("node.childBadge")}
            </div>
          )}
        </div>
        {/* 어트리뷰트·파라미터·조건/IO — 마름모 박스(h-24 w-[116px])를 넘치지 않게 아래 절대배치 캡션으로
            (규범 순서 #10: 속성→지표→조건→IO — 프로세스/서브프로세스와 동일 수준 표시, 사용자 요청 2026-08-25).
            절대배치라 React Flow 측정 크기가 불변 → 핸들·엣지 앵커 무영향. IO 박스는 framed(보더 강조).
            조건/IO 박스는 노드 밖이라 상시 노출이 산만 — 선택(활성) 시에만 (사용자 요청 2026-08-25). */}
        <div className="absolute left-1/2 top-full w-max max-w-44 -translate-x-1/2">
          <NodeFields data={data} />
          <NodeParams data={data} className="justify-center" />
          {selected && <NodeIoDetails nodeId={id} data={data} nodeSelected framed />}
        </div>
        {/* 배지는 박스 진짜 코너로 — 마름모 내접 3줄 제목을 가리지 않게 아래·바깥으로 이동(#5) */}
        {data.hasDescendantChange && <DescendantChangeBadge className="right-3 top-3" />}
        {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} className="right-0 top-0" />}
        {data.url && <UrlBadge url={data.url} className="bottom-0 left-0" />}
        {data.assigneeWarning && <AssigneeWarningBadge className="bottom-0 right-0" />}
        {showCopyBadge && <CopyDragBadge className="right-3 top-3" />}
        <NodeHandles connectable={isConnectable ?? true} />
      </div>
    );
  }

  const isTerminal = data.nodeType === "start" || data.nodeType === "end";
  // 터미널 커스텀 라벨 — 타입 필("Start"/"End") + 라벨 본문 분리, 왼쪽 정렬(일반 노드와 동일 결).
  // 설명(노트)은 캔버스에 노출하지 않는다 — 다른 노드처럼 인스펙터·편집 모달에서만 (사용자 결정 2026-08-24).
  const customTerminal = isTerminal && hasCustomTerminalLabel(data.label);
  // 긴 라벨은 max-w-[240px](canvas.ts NODE_MAX_WIDTH 동기화)에서 wrap — break-words로 무공백 토큰도 분절
  // 터미널 곡률은 rounded-full 대신 한 줄 높이의 반지름 고정(19px) — 내용이 늘어나 키가 커져도
  // 타원이 계란형으로 변하지 않고 같은 곡률의 둥근 사각형이 된다(사용자 요청 2026-08-24).
  // 기본 라벨(Start/End 한 단어) 알약만 가운데 정렬 유지 — 좁은 알약에서 좌정렬은 쏠려 보인다.
  return (
    <div
      className={`group bpm-node-emph relative break-words px-3 py-2 text-sm transition-all duration-150 ${
        isTerminal
          ? `min-w-[90px] max-w-[240px] rounded-[19px] ${customTerminal ? "text-left" : "text-center"}`
          : "min-w-[150px] max-w-[240px] rounded-sm"
      }`}
      style={style}
      title={data.diffNote}
    >
      {diff && <DiffBadge status={diff} />}
      {diffFields.length > 0 && <DiffFieldPills fields={diffFields} />}
      <div className="mb-0.5 empty:hidden"><GmpPill nodeId={id} data={data} /></div>
      {customTerminal && (
        // 타입 필 — GMP 필과 같은 자리(본문 첫 줄 좌측). 노드색 테두리+틴트로 소속을 드러낸다.
        <div className="mb-0.5 flex justify-start">
          <span
            data-id="node-terminal-pill"
            className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-4"
            style={{ borderColor: color, background: "var(--color-surface)", color }}
          >
            {data.nodeType === "start" ? (
              <Play size={10} strokeWidth={1.5} className="shrink-0" />
            ) : (
              <Flag size={10} strokeWidth={1.5} className="shrink-0" />
            )}
            {data.nodeType === "start" ? "Start" : "End"}
          </span>
        </div>
      )}
      <div className="font-medium text-ink">
        <NodeTitle
          id={id}
          label={data.label}
          displayLabel={
            isTerminal && !customTerminal
              ? terminalDisplayLabel(data.nodeType, data.label)
              : undefined
          }
        />
      </div>
      <NodeFields data={data} />
      <NodeParams data={data} />
      <NodeIoDetails nodeId={id} data={data} nodeSelected={selected ?? false} />
      {data.hasChildren && (
        <div className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-accent">
          <CornerDownRight size={12} strokeWidth={1.5} />
          {t("node.openChildTitle")}
        </div>
      )}
      {data.hasDescendantChange && <DescendantChangeBadge />}
      {commentCount > 0 && <UnresolvedCommentBadge count={commentCount} />}
      {data.url && <UrlBadge url={data.url} />}
      {data.assigneeWarning && <AssigneeWarningBadge />}
      {data.staleAnchor && (
        <span
          title="Section no longer exists in the imported document"
          className="absolute -right-1.5 -top-1.5 rounded-full bg-surface text-changed"
          data-id="node-stale-anchor-badge"
        >
          <AlertTriangle size={16} strokeWidth={1.5} />
        </span>
      )}
      {showCopyBadge && <CopyDragBadge />}
      {/* 좌/우 핸들 = 제목 라인 높이(py-2 8px + text-sm 줄높이 20의 절반 = 18px).
          터미널(알약)은 단일 라인 중앙 정렬이라 기본 50% 유지 */}
      <NodeHandles connectable={isConnectable ?? true} sideAnchorTop={isTerminal ? undefined : 18} />
    </div>
  );
}
