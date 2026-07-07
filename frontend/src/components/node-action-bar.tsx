"use client";

// 단일 선택 노드 하단 중앙의 통합 액션 바 — 하위 프로세스 펼치기/접기 → 링크 열기 → 그룹 나가기(고정 순서).
// NodeSelectionRing과 같은 store 구독 + ViewportPortal flow 좌표 패턴 — 팬/줌 정합 자동, 드래그 중 숨김.
// locked/undesignated subprocess는 기존 캔버스 동작대로 펼치기 버튼 미노출(노드 뱃지가 사유 표시).

import { useStore } from "@xyflow/react";
import { ChevronDown, ExternalLink, Link, LogOut } from "lucide-react";

import type { NodeData } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { useNodeActions } from "@/lib/node-actions";
import { isSafePreviewUrl } from "@/lib/url";

// 노드 하단 ↔ 바 상단 간격(px) — 스펙 12~14, 커넥터 선 7px과 시각적으로 이어지는 값
const BAR_GAP = 13;

interface BarTarget {
  id: string;
  cx: number; // 노드 하단 중앙 x (flow 좌표)
  bottom: number; // 노드 하단 y (flow 좌표)
  url?: string;
  urlLabel: string;
  groupIds: string[];
  groupKey: string; // eq 비교용 join — 배열 참조 변동에 둔감
  expandable: boolean; // subprocess && subEnds>0 && !locked && !undesignated
  dragging: boolean;
}

function eq(a: BarTarget | null, b: BarTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.cx === b.cx &&
    a.bottom === b.bottom &&
    a.url === b.url &&
    a.urlLabel === b.urlLabel &&
    a.groupKey === b.groupKey &&
    a.expandable === b.expandable &&
    a.dragging === b.dragging
  );
}

export function NodeActionBar({
  readOnly,
  onLeaveGroups,
  onOpenLink,
}: {
  readOnly: boolean;
  onLeaveGroups: (groupIds: string[]) => void;
  onOpenLink: (url: string) => void;
}) {
  const { t } = useI18n();
  const { onToggleExpand, expandedInlineIds } = useNodeActions();

  // 정확히 1개 선택 + measured일 때만 대상 — 다중 선택/미측정(임베드 자식 방어)은 null
  const target = useStore((s): BarTarget | null => {
    let found: BarTarget | null = null;
    for (const n of s.nodeLookup.values()) {
      if (!n.selected) continue;
      if (found) return null; // 두 개째 발견 → 다중 선택
      const w = n.measured?.width ?? 0;
      const h = n.measured?.height ?? 0;
      if (!w || !h) return null;
      const data = n.data as NodeData;
      const isSub = data.nodeType === "subprocess";
      found = {
        id: n.id,
        cx: n.internals.positionAbsolute.x + w / 2,
        bottom: n.internals.positionAbsolute.y + h,
        url: (isSub ? data.spUrl : data.url) ?? undefined,
        urlLabel: (isSub ? data.spUrlLabel : data.urlLabel) ?? "",
        groupIds: data.groupIds,
        groupKey: data.groupIds.join(","),
        expandable:
          data.nodeType === "subprocess" &&
          (data.subEnds ?? []).length > 0 &&
          !data.locked &&
          !data.undesignated,
        dragging: n.dragging ?? false,
      };
    }
    return found;
  }, eq);

  if (!target || target.dragging) return null;

  const expanded = expandedInlineIds.has(target.id);
  const showExpand = target.expandable && onToggleExpand !== null;
  const showLink = isSafePreviewUrl(target.url);
  const showLeave = !readOnly && target.groupIds.length > 0;
  if (!showExpand && !showLink && !showLeave) return null;

  // 액센트 버튼(펼치기·링크) 공통 — 그룹 나가기는 중립→hover 위험색
  const accentBtn =
    "pointer-events-auto inline-flex h-8 items-center gap-[7px] rounded-sm border border-accent-tint-border " +
    "bg-surface px-3 text-xs font-semibold text-accent-focus shadow-lg hover:bg-accent-tint/60";

  return (
    <div
      data-id="node-action-bar"
      className="absolute flex min-w-[172px] flex-col items-stretch gap-[7px]"
      style={{
        left: 0,
        top: 0,
        transform: `translate(${target.cx}px, ${target.bottom + BAR_GAP}px) translateX(-50%)`,
        zIndex: 8,
      }}
    >
      {/* 노드-바 커넥터 선 */}
      <div className="pointer-events-none absolute -top-[7px] left-1/2 h-[7px] w-px -translate-x-1/2 bg-accent-tint-border" />
      {showExpand && (
        <button
          type="button"
          data-id="node-action-expand"
          aria-label={t(expanded ? "node.action.collapse" : "node.action.expand")}
          onClick={() => onToggleExpand?.(target.id)}
          className={accentBtn}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-xs bg-accent-tint">
            <ChevronDown
              size={12}
              strokeWidth={1.5}
              className={`text-accent transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            />
          </span>
          {t(expanded ? "node.action.collapse" : "node.action.expand")}
        </button>
      )}
      {showLink && (
        <button
          type="button"
          data-id="node-action-link"
          aria-label={target.urlLabel || t("node.action.openLink")}
          onClick={() => onOpenLink(target.url ?? "")}
          className={accentBtn + " group"}
        >
          {target.urlLabel ? (
            <>
              <span className="min-w-0 max-w-[200px] truncate">{target.urlLabel}</span>
              <ExternalLink
                size={12}
                strokeWidth={1.5}
                className="ml-auto shrink-0 text-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              />
            </>
          ) : (
            <>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-xs bg-accent-tint">
                <Link size={12} strokeWidth={1.5} className="text-accent" />
              </span>
              {t("node.action.openLink")}
            </>
          )}
        </button>
      )}
      {showLeave && (
        <button
          type="button"
          data-id="node-action-leave-group"
          aria-label={t("group.leave")}
          onClick={() => onLeaveGroups(target.groupIds)}
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 text-xs font-semibold text-ink-secondary shadow-lg hover:border-error/40 hover:bg-error/10 hover:text-error"
        >
          <LogOut size={14} strokeWidth={1.5} />
          {t("group.leave")}
        </button>
      )}
    </div>
  );
}
