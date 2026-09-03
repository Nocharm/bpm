"use client";

// IO 항목 불러오기 선택 모달 — EdgeSelectModal의 크롬(포탈·투명 백드롭·헤더+X·Esc·edge-row-in 스태거·
// 내부 스크롤·하단 Cancel)을 본떠, 후보를 필터+홉 축약(기본 2홉, Show more)으로 노드별 그룹핑해 보여준다.
// 불러오기 실행은 상위(onPick)에 위임 — 이 컴포넌트는 순수 선택 UI. 설계: 2026-08-21-io-linking-design.md

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { clampToViewport } from "@/lib/clamp-viewport";
import { useI18n } from "@/lib/i18n";
import type { IoImportCandidate, IoSide } from "@/lib/io-items";

// 기본 노출 범위(홉) — 초과분은 Show more 클릭 전까지 숨김 (io-linking §1-4)
const HOP_COLLAPSE_THRESHOLD = 2;
// 뷰포트 클램프용 행 높이 추정치(px) — 픽셀 정밀도는 불필요, 화면 밖으로 넘치지만 않으면 된다
const ROW_HEIGHT = 26;
const CAPTION_HEIGHT = 16;
const CHROME_HEIGHT = 130; // 헤더+필터입력+하단 Cancel+패딩 합

const FORM_PILL_CLASS =
  "shrink-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary";
const SP_BADGE_CLASS =
  "shrink-0 rounded-full border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-tertiary";

interface IoImportModalProps {
  side: IoSide;
  position: { x: number; y: number };
  /** hop 오름차순 정렬된 전 흐름 후보(Task 4 collectIoImportCandidates 출력). */
  candidates: IoImportCandidate[];
  onPick: (candidate: IoImportCandidate) => void;
  /** 행 hover 시 캔버스의 대응 노드/엣지를 하이라이트하도록 알림(빈값이면 해제). */
  onHoverCandidate?: (candidate: IoImportCandidate | null) => void;
  onClose: () => void;
}

export function IoImportModal({ side, position, candidates, onPick, onHoverCandidate, onClose }: IoImportModalProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 닫힐 땐 hover 하이라이트도 해제.
  const closeAndClear = () => {
    onHoverCandidate?.(null);
    onClose();
  };

  const query = filter.trim().toLowerCase();
  const matched = query
    ? candidates.filter(
        (c) => c.text.toLowerCase().includes(query) || c.nodeLabel.toLowerCase().includes(query),
      )
    : candidates;
  const hasMore = !expanded && matched.some((c) => c.hop > HOP_COLLAPSE_THRESHOLD);
  const visible = expanded ? matched : matched.filter((c) => c.hop <= HOP_COLLAPSE_THRESHOLD);
  const isEmpty = visible.length === 0 && !hasMore;

  // nodeId 연속 구간의 첫 행에만 노드명 캡션을 얹는다 — candidates는 hop 오름차순이라 같은 노드는 이미 인접.
  const rows = visible.map((candidate, i) => ({
    candidate,
    showCaption: i === 0 || visible[i - 1].nodeId !== candidate.nodeId,
  }));
  const captionCount = rows.filter((r) => r.showCaption).length;
  const listH = Math.min(
    rows.length * ROW_HEIGHT + captionCount * CAPTION_HEIGHT + (hasMore ? ROW_HEIGHT : 0),
    220,
  );
  const { left, top } = clampToViewport(position.x, position.y, 288, CHROME_HEIGHT + listH);

  const title = side === "input" ? t("io.importTitleInput") : t("io.importTitleOutput");

  return createPortal(
    // z 1360 — 노드 편집 모달(1200)·타일 입력 팝오버(1350) 위. 팝오버의 '다른 노드에서 불러오기'가
    // 팝오버를 열어둔 채 이 모달을 띄우므로 그 위에 와야 행을 고를 수 있다 (2026-09-03)
    <ModalBackdrop className="fixed inset-0 z-[1360]" style={{ background: "transparent" }} onClose={closeAndClear}>
      <div
        data-id="io-import-modal"
        className="fixed w-72 rounded-md border border-hairline bg-surface p-2 shadow-lg"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-fine font-semibold uppercase tracking-wide text-ink-tertiary">{title}</span>
          <button
            type="button"
            aria-label={t("summary.close")}
            title={t("summary.close")}
            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt"
            onClick={closeAndClear}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <input
          data-id="io-import-filter"
          type="text"
          // 열리면 바로 필터 타이핑 — 포커스가 이 모달 안에 있어야 Esc가 아래 타일 팝오버까지 닫지 않는다
          autoFocus
          className="mb-1.5 w-full rounded-sm border border-hairline bg-surface px-1.5 py-1 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
          placeholder={t("io.filterPlaceholder")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <div className="scrollbar-hidden flex max-h-[220px] flex-col gap-1 overflow-y-auto">
          {isEmpty ? (
            <div data-id="io-import-empty" className="px-1 py-2 text-center text-caption text-ink-tertiary">
              {t("io.noCandidates")}
            </div>
          ) : (
            rows.map(({ candidate: c, showCaption }, i) => (
              <div key={`${c.nodeId}-${c.list}-${c.index}`}>
                {showCaption && (
                  <div className="truncate px-1 pt-1 text-fine text-ink-tertiary" title={c.nodeLabel}>
                    {c.nodeLabel}
                  </div>
                )}
                <button
                  type="button"
                  data-id={`io-import-row-${c.nodeId}-${c.list}-${c.index}`}
                  className="edge-row-in flex w-full items-center gap-1.5 rounded-sm border border-hairline px-2 py-1 text-left transition-colors hover:border-accent hover:bg-accent-tint active:bg-accent-tint"
                  style={{ animationDelay: `${i * 30}ms` }}
                  onMouseEnter={() => onHoverCandidate?.(c)}
                  onMouseLeave={() => onHoverCandidate?.(null)}
                  onClick={() => {
                    onHoverCandidate?.(null);
                    onPick(c);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-ink" title={c.text}>
                    {c.text}
                  </span>
                  {c.form !== "" && (
                    <span className={FORM_PILL_CLASS} title={c.form}>
                      {c.form}
                    </span>
                  )}
                  {c.isSp ? (
                    <span className={SP_BADGE_CLASS}>{t("io.spBadge")}</span>
                  ) : c.groupId ? (
                    <span className="shrink-0 text-ink-tertiary" title={t("io.linkedBadge")}>
                      <Link2 size={12} strokeWidth={1.5} />
                    </span>
                  ) : null}
                </button>
              </div>
            ))
          )}
          {hasMore && (
            <button
              type="button"
              data-id="io-import-show-more"
              className="flex w-full items-center justify-center rounded-sm py-1 text-caption text-ink-tertiary hover:bg-surface-alt"
              onClick={() => setExpanded(true)}
            >
              {t("io.showMore")}
            </button>
          )}
        </div>
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center rounded-sm text-caption text-ink-tertiary hover:bg-surface-alt"
          onClick={closeAndClear}
        >
          {t("common.cancel")}
        </button>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
