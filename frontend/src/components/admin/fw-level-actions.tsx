"use client";

// 관리 패널 레벨별 타일 액션 — L1~3은 하위 타일 드릴(좌측 트리와 싱크), L4는 새 L5 만들기, L5는 AI로 작업/이어서. framework-panel 전용 (spec 2026-09-23 §2 A1).
// 하위 타일은 컴팩트 한 줄(h-9)로 내부 스크롤 상자 안에 두고, 우측 세그먼트로 1열 목록/2열/3열을 고른다(localStorage, 사용자 요청 2026-09-28).

import { useState } from "react";
import { Headset, LayoutGrid, List, Play, Sparkles } from "lucide-react";

import type { CategoryNode, FwInterviewSession } from "@/lib/api";
import { countSessionsUnder, findSessionFor } from "@/lib/fw-level-actions";
import { useI18n } from "@/lib/i18n";
import { AiButton } from "@/components/ai-button";
import { LevelPill } from "@/components/level-pill";

const COLUMNS_KEY = "bpm.fwLevelTileColumns";
type TileColumns = 1 | 2 | 3;
const COLUMN_OPTIONS: TileColumns[] = [1, 2, 3];
const GRID_CLASS: Record<TileColumns, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" };
const LIST_MAX_HEIGHT_PX = 168;  // 한 줄 타일(36px) 4행 + 간격 — 그 이상은 상자 안에서 스크롤

const TILE =
  "flex h-9 min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface px-2 text-left transition-[background-color,border-color,box-shadow] duration-150 " +
  "hover:border-border-strong hover:bg-surface-alt hover:shadow-sm disabled:opacity-40";
const SEGMENT = "flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5";
const SEGMENT_BTN = "flex h-5 w-5 items-center justify-center rounded-xs transition-colors duration-150";

function readColumns(): TileColumns {
  if (typeof window === "undefined") return 2;
  const stored = Number(window.localStorage.getItem(COLUMNS_KEY));
  return stored === 1 || stored === 2 || stored === 3 ? stored : 2;
}

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
  const [columns, setColumns] = useState<TileColumns>(readColumns);
  if (!selectedNode) {
    return (
      <p data-id="fw-level-empty" className="text-fine text-ink-tertiary">
        {t("framework.adminDetailEmpty")}
      </p>
    );
  }
  const level = selectedNode.level;

  function pickColumns(next: TileColumns) {
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, String(next));
    } catch {
      // 영속은 best-effort
    }
  }

  if (level <= 3) {
    const rows = childNodes ?? [];
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-fine text-ink-tertiary">{t("fwLevel.childrenTitle")}</span>
          <span className="text-fine text-ink-muted tabular-nums">{rows.length}</span>
          <div className={`${SEGMENT} ml-auto`} data-id="fw-level-columns" role="group" aria-label={t("fwLevel.columns")}>
            {COLUMN_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                data-id={`fw-level-columns-${n}`}
                aria-pressed={columns === n}
                title={t(n === 1 ? "fwLevel.columnsList" : n === 2 ? "fwLevel.columns2" : "fwLevel.columns3")}
                className={`${SEGMENT_BTN} ${columns === n ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"}`}
                onClick={() => pickColumns(n)}
              >
                {n === 1 ? <List size={12} strokeWidth={1.5} /> : <LayoutGrid size={12} strokeWidth={1.5} className={n === 3 ? "scale-x-[1.15]" : ""} />}
                {n === 3 && <span className="sr-only">3</span>}
              </button>
            ))}
          </div>
        </div>
        {/* 상자 안 내부 스크롤 — 형제가 많아도 3행부터 잘리지 않는다(이전 페이드+"+N" 캡 폐기) */}
        <div className="scroll-soft overflow-y-auto pr-0.5" style={{ maxHeight: LIST_MAX_HEIGHT_PX }} data-id="fw-level-tile-list">
          <div className={`grid gap-1.5 ${GRID_CLASS[columns]}`}>
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
        </div>
        {childrenLoading && <span className="text-fine text-ink-tertiary">…</span>}
      </div>
    );
  }

  if (level === 4) {
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <AiButton
          variant="tile"
          data-id="fw-level-create-l5"
          disabled={busy}
          title={t("fwLevel.createL5Hint")}
          onClick={onCreateL5}
          icon={<Sparkles size={16} strokeWidth={1.5} className="shrink-0" />}
        >
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.createL5")}</span>
        </AiButton>
      </div>
    );
  }

  const session = findSessionFor(sessions, selectedNode.id);
  return (
    <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
      {session ? (
        <AiButton
          variant="tile"
          data-id="fw-level-resume"
          disabled={busy}
          onClick={() => onResume(session.id)}
          icon={<Play size={16} strokeWidth={1.5} className="shrink-0" />}
        >
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.resume")}</span>
          <span className="shrink-0 text-fine opacity-80">
            {session.progress.drawn}/{session.progress.total}
          </span>
        </AiButton>
      ) : (
        <AiButton
          variant="tile"
          data-id="fw-level-start"
          disabled={busy}
          onClick={() => onStart(selectedNode.id)}
          icon={<Headset size={16} strokeWidth={1.5} className="shrink-0" />}
        >
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.start")}</span>
        </AiButton>
      )}
    </div>
  );
}
