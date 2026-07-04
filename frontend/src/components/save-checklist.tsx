"use client";

// 좌상단 맵 제목 칩 + 저장(그래프 검증) 조건 아코디언 — 편집 모드에서 하나로 합침.
// 접힘: 제목 표시. 펼침: 제목이 크로스페이드로 사라지며 조건 리스트가 아코디언으로 열림.
// 각 조건은 현재 노드 상태에 맞춰 자동 체크(충족=체크+취소선, 미충족=빈 박스). 반투명 패널.

import { Check, ChevronRight, Crosshair } from "lucide-react";
import { useState } from "react";

export interface SaveCheckItem {
  key: string;
  label: string;
  ok: boolean;
  // 미충족 시 문제 위치로 이동/하이라이트(예: 잘못된 다중 연결 노드) — 있으면 아이템이 클릭 가능
  onLocate?: () => void;
}

// 잘못된 다중 연결 노드 id — 분기(decision)·하위프로세스(subprocess, 다중 끝) 외 노드가 출력 2개 이상.
export function getMultiOutputNodeIds(
  nodes: { id: string; nodeType: string }[],
  edges: { source: string }[],
): string[] {
  const outCount = new Map<string, number>();
  for (const edge of edges) {
    outCount.set(edge.source, (outCount.get(edge.source) ?? 0) + 1);
  }
  return nodes
    .filter(
      (node) =>
        node.nodeType !== "decision" &&
        node.nodeType !== "subprocess" &&
        (outCount.get(node.id) ?? 0) > 1,
    )
    .map((node) => node.id);
}

// 저장(그래프 검증) 조건의 충족 여부 — 체크리스트 렌더와 저장/승인 차단 로직 공용(어긋남 방지).
// 백엔드 validate_process 정합(시작 1개 / 대표끝=1 / 끝 이름 중복 없음) + 클라이언트 전용:
// 분기(decision)·하위프로세스(subprocess, 다중 끝)만 다출력 정상 — 그 외 노드가 출력 2개 이상이면
// 드롭존 조작 등으로 생긴 잘못된 분기이므로 작업자에게 알린다.
export function getSaveCheckStates(
  nodes: { id: string; nodeType: string; label: string }[],
  edges: { source: string }[],
): { start: boolean; primaryEnd: boolean; endUnique: boolean; singleOutput: boolean } {
  const startCount = nodes.filter((node) => node.nodeType === "start").length;
  const endLabels = nodes.filter((node) => node.nodeType === "end").map((node) => node.label);
  return {
    start: startCount === 1,
    primaryEnd: endLabels.length >= 1,
    endUnique: new Set(endLabels).size === endLabels.length,
    singleOutput: getMultiOutputNodeIds(nodes, edges).length === 0,
  };
}

const CHIP_BASE =
  "absolute left-2 top-2 z-10 rounded-sm border border-hairline bg-surface/40 shadow-sm backdrop-blur-sm";

export function MapTitleChecklist({
  mapTitle,
  checklistLabel,
  items,
}: {
  mapTitle: string;
  checklistLabel: string;
  items: SaveCheckItem[];
}) {
  const [open, setOpen] = useState(false);

  // 검증할 노드가 없으면(빈 맵) 평범한 제목 칩 — 아코디언/배지 없음.
  if (items.length === 0) {
    return (
      <span
        className={`${CHIP_BASE} max-w-[60%] truncate px-2 py-0.5 text-fine font-medium text-ink-secondary`}
      >
        {mapTitle}
      </span>
    );
  }

  const failed = items.filter((item) => !item.ok).length;
  const allOk = failed === 0;

  return (
    <div className={`${CHIP_BASE} w-max max-w-[220px] select-none overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1 hover:bg-surface-alt/50"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={`shrink-0 text-ink-tertiary transition-transform duration-350 ease-smooth ${
            open ? "rotate-90" : ""
          }`}
        />
        {/* 제목(접힘) ↔ 저장 조건 라벨(펼침) 크로스페이드 */}
        <span className="relative min-w-0 flex-1 text-left">
          <span
            className={`block truncate text-fine font-medium text-ink-secondary transition-opacity duration-350 ease-smooth ${
              open ? "opacity-0" : "opacity-100"
            }`}
          >
            {mapTitle}
          </span>
          <span
            className={`pointer-events-none absolute inset-0 truncate text-fine font-semibold text-ink-secondary transition-opacity duration-350 ease-smooth ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            {checklistLabel}
          </span>
        </span>
        <span
          className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-fine font-semibold ${
            allOk ? "text-accent" : "bg-error/10 text-error"
          }`}
        >
          {allOk ? <Check size={11} strokeWidth={2.5} /> : failed}
        </span>
      </button>

      {/* 아코디언 — grid-rows 0fr→1fr 로 부드러운 높이 전환(오버플로 클립) */}
      <div
        className={`grid transition-all duration-350 ease-smooth ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <ul className="flex flex-col gap-0.5 border-t border-divider px-1 py-1.5">
            {items.map((item) => {
              const locatable = !item.ok && !!item.onLocate;
              const rowClass = "flex w-full items-center gap-1.5 rounded-xs px-1 py-0.5 text-left";
              const inner = (
                <>
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                      item.ok ? "border-accent bg-accent text-on-accent" : "border-ink-tertiary/50"
                    }`}
                  >
                    {item.ok && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span
                    className={`whitespace-nowrap text-fine ${
                      item.ok ? "text-ink-tertiary line-through" : "text-ink"
                    }`}
                  >
                    {item.label}
                  </span>
                  {locatable && (
                    <Crosshair size={12} strokeWidth={1.5} className="ml-auto shrink-0 text-error" />
                  )}
                </>
              );
              return (
                <li key={item.key}>
                  {locatable ? (
                    <button
                      type="button"
                      onClick={item.onLocate}
                      title={item.label}
                      className={`${rowClass} hover:bg-error/10`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={rowClass}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
