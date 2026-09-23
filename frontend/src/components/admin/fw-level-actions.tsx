"use client";

// 관리 패널 레벨별 타일 액션 — L1~3은 하위 타일 드릴(좌측 트리와 싱크), L4는 새 L5 만들기, L5는 AI로 작업/이어서. framework-panel 전용 (spec 2026-09-23 §2 A1).

import { Headset, Play, Sparkles } from "lucide-react";

import type { CategoryNode, FwInterviewSession } from "@/lib/api";
import { countSessionsUnder, findSessionFor } from "@/lib/fw-level-actions";
import { useI18n } from "@/lib/i18n";
import { LevelPill } from "@/components/level-pill";

const TILE_ROWS_VISIBLE = 2.5; // 2열 타일 2행 반까지만 보이고 나머지는 페이드+"+N"
const TILE_HEIGHT_PX = 56;
const TILE_GAP_PX = 6;
const LIST_MAX_HEIGHT = Math.round(TILE_HEIGHT_PX * TILE_ROWS_VISIBLE + TILE_GAP_PX * 2);

const TILE =
  "flex h-14 min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 text-left hover:bg-surface-alt disabled:opacity-40";
// AI 액션 타일 — 스프린트 ③ AiButton으로 교체 예정(그라데이션만, 쉬머 없음)
const AI_TILE =
  "flex h-14 w-full items-center gap-2 rounded-md px-3 text-left text-on-accent hover:brightness-105 disabled:opacity-40 [background:linear-gradient(135deg,var(--color-accent),var(--color-accent-focus))]";

interface FwLevelActionsProps {
  selectedNode: CategoryNode | null;
  // 선택 노드의 자식(미로드면 undefined)
  childNodes: CategoryNode[] | undefined;
  childrenLoading: boolean;
  // 진행 중 세션 전체
  sessions: FwInterviewSession[];
  busy: boolean;
  // 하위 타일 클릭 = 선택 이동
  onPick: (node: CategoryNode) => void;
  // L4에서 이름 모달 열기
  onCreateL5: () => void;
  onStart: (l5Id: number) => void;
  onResume: (sessionId: number) => void;
}

export function FwLevelActions({
  selectedNode, childNodes, childrenLoading, sessions, busy, onPick, onCreateL5, onStart, onResume,
}: FwLevelActionsProps) {
  const { t } = useI18n();
  if (!selectedNode) {
    return (
      <p data-id="fw-level-empty" className="text-fine text-ink-tertiary">
        {t("framework.adminDetailEmpty")}
      </p>
    );
  }
  const level = selectedNode.level;

  if (level <= 3) {
    const rows = childNodes ?? [];
    const visibleCap = Math.ceil(TILE_ROWS_VISIBLE) * 2;
    const hidden = Math.max(0, rows.length - visibleCap);
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <span className="text-fine text-ink-tertiary">{t("fwLevel.childrenTitle")}</span>
        <div className="relative overflow-hidden" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          <div className="grid grid-cols-2 gap-1.5">
            {rows.map((child) => {
              const n = countSessionsUnder(sessions, child.id);
              return (
                <button
                  key={child.id}
                  type="button"
                  data-id={`fw-level-tile-${child.id}`}
                  className={TILE}
                  disabled={busy}
                  onClick={() => onPick(child)}
                >
                  <LevelPill level={child.level} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{child.name}</span>
                  {n > 0 && (
                    <span
                      data-id={`fw-level-tile-badge-${child.id}`}
                      className="shrink-0 rounded-full bg-accent-tint px-1.5 text-fine text-accent"
                      title={t("fwLevel.sessions", { n })}
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {hidden > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-pearl to-transparent" />
          )}
        </div>
        {childrenLoading && <span className="text-fine text-ink-tertiary">…</span>}
        {hidden > 0 && (
          <span data-id="fw-level-more" className="text-fine text-ink-tertiary">
            {t("fwLevel.more", { n: hidden })}
          </span>
        )}
      </div>
    );
  }

  if (level === 4) {
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <button
          type="button"
          data-id="fw-level-create-l5"
          className={AI_TILE}
          disabled={busy}
          title={t("fwLevel.createL5Hint")}
          onClick={onCreateL5}
        >
          <Sparkles size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.createL5")}</span>
        </button>
      </div>
    );
  }

  const session = findSessionFor(sessions, selectedNode.id);
  return (
    <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
      {session ? (
        <button
          type="button"
          data-id="fw-level-resume"
          className={AI_TILE}
          disabled={busy}
          onClick={() => onResume(session.id)}
        >
          <Play size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.resume")}</span>
          <span className="shrink-0 text-fine opacity-80">
            {session.progress.drawn}/{session.progress.total}
          </span>
        </button>
      ) : (
        <button
          type="button"
          data-id="fw-level-start"
          className={AI_TILE}
          disabled={busy}
          onClick={() => onStart(selectedNode.id)}
        >
          <Headset size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.start")}</span>
        </button>
      )}
    </div>
  );
}
