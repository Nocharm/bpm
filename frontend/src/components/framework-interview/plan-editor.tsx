"use client";

// 캠페인 ① L6 카드 계획 — 3열 중 2·3열: 단계 행(위→아래 = 선행 순서, 같은 행 = 동시 진행) | 선택 카드 상세.
// 단계는 depends_on에서 계산한다(lib/plan-cards groupByStage). 타일 전체를 끌어 다른 행(단계 이동 = 선행 갱신)·같은 행 안(표시 순서)·
// 점선 새 단계 행으로 옮기고, 선택 타일에서 Alt+↑/↓(단계)·Alt+←/→(순서)로도 옮긴다. 분기·조건은 여기서 잡지 않는다(연결 단계).
// 모션: 자리 이동은 FLIP(useFlipOrder 2D), 추가 .plan-tile-in, 삭제 .plan-tile-out, 단계가 바뀐 타일은 .plan-tile-settle 링.
// 그립 아이콘은 hover에서만 우측 상단에(왼쪽 여백을 잡아두지 않게). 기존 L6 맵에서 병합된 카드(existing_code)는 유지/정정만 고르고 삭제는 막는다(서버 병합이 되살린다).
// brief·첨부·AI 제안은 1열 PlanBriefPanel(page.tsx가 이어 준다). 시안 확정 2026-09-24.

import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2, X } from "lucide-react";

import type { FwCardMode, FwInterviewSession, FwPlanCard } from "@/lib/api";
import { hasBlockingDuplicate } from "@/lib/framework-interview";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import {
  groupByStage, moveCardToStage, renameDependency, reorderWithinStage, stripClientIds, withClientIds, type KeyedCard,
} from "@/lib/plan-cards";
import { useFlipOrder } from "@/lib/use-flip-order";
import { SearchSelect } from "@/components/search-select";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink outline-none focus:border-accent";
const LABEL = "text-fine text-ink-tertiary";
const TILE_WIDTH = 200;
const TILE =
  "group relative flex w-[200px] cursor-grab flex-col gap-px rounded-md border py-2 pl-2.5 pr-6 text-left shadow-sm outline-none " +
  "transition-[background-color,border-color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1";
const TILE_QUIET = "border-hairline bg-surface hover:bg-surface-pearl";
const TILE_SELECTED = "border-accent bg-accent-tint";
// 추가 버튼은 그 행에 마우스가 올라왔을 때만 페이드인 — 빈 자리가 늘 점선으로 채워져 있지 않게(사용자 요청 2026-09-24)
const ADD_TILE = "flex items-center justify-center rounded-md border border-dashed border-hairline bg-surface-pearl text-fine text-ink-tertiary hover:border-accent hover:text-accent opacity-0 transition-opacity duration-150 group-hover/stage:opacity-100 focus-visible:opacity-100";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const SEGMENT = "flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5";  // 홈 뷰 토글과 같은 세그먼트
const DETAIL_WIDTH = 320;
const DRAG_THRESHOLD_PX = 4;  // 이보다 덜 움직이면 클릭(선택)
const OUT_MS = 240;     // globals.css .plan-tile-out
const IN_MS = 300;      // .plan-tile-in
const SETTLE_MS = 600;  // .plan-tile-settle

interface PlanEditorProps {
  session: FwInterviewSession;
  busy: boolean;
  // 현재 카드(키 제거본)를 부모에 미러 — 좌측 brief 패널의 AI 제안이 화면의 카드로 제안받는다
  onCardsChange: (cards: FwPlanCard[]) => void;
  onSave: (cards: FwPlanCard[]) => void;
  onLock: (cards: FwPlanCard[]) => void;
}

interface DragState {
  clientId: string;
  x: number;  // 고스트 좌상단(뷰포트)
  y: number;
  stage: number | null;  // 포인터가 올라간 행(마지막+1 = 새 단계), null = 행 밖
  index: number;         // 그 행 안 삽입 위치
}

const EMPTY: FwPlanCard = { name: "", summary: "", owner_role: "", department: "", depends_on: [], mode: "new", existing_code: null };
const CARD_MODES: FwCardMode[] = ["keep", "revise"];

function buildStageKey(groups: KeyedCard[][]): string {
  return groups.map((group) => group.map((card) => card.clientId).join(",")).join("|");
}

export function PlanEditor({ session, busy, onCardsChange, onSave, onLock }: PlanEditorProps) {
  const { t } = useI18n();
  // 부모가 session.plan 내용으로 key를 리마운트하므로(page.tsx) 여기서는 마운트 시 1회 초기화만 한다 —
  // 폴링(pause/resume 등)이 만드는 새 session 객체가 편집 중인 카드를 덮어쓰지 않는다.
  const [cards, setCards] = useState<KeyedCard[]>(() => withClientIds(session.plan ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
  const [addedId, setAddedId] = useState<string | null>(null);
  const [settledId, setSettledId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 포인터 제스처 스냅샷 — 클릭/드래그 판정과 고스트 오프셋. 렌더에서 읽지 않는다
  const gestureRef = useRef<{ clientId: string; startX: number; startY: number; offsetX: number; offsetY: number; dragging: boolean } | null>(null);
  const timersRef = useRef<number[]>([]);

  const groups = groupByStage(cards);
  const flat = groups.flat();
  useFlipOrder(listRef, buildStageKey(groups));

  useEffect(() => {
    onCardsChange(stripClientIds(cards));
  }, [cards, onCardsChange]);

  useEffect(() => () => { for (const id of timersRef.current) window.clearTimeout(id); }, []);

  function later(ms: number, fn: () => void) {
    timersRef.current.push(window.setTimeout(fn, ms));
  }

  // 선택이 없으면 첫 카드 — 상세 열이 비어 있지 않게. 삭제로 선택이 사라져도 같은 규칙으로 돌아온다.
  const selected = cards.find((c) => c.clientId === selectedId) ?? flat[0] ?? null;
  const selectedStage = selected ? groups.findIndex((group) => group.includes(selected)) : -1;
  const stageOf = (clientId: string) => groups.findIndex((group) => group.some((card) => card.clientId === clientId));

  function update(clientId: string, patch: Partial<FwPlanCard>) {
    setCards((prev) => prev.map((c) => (c.clientId === clientId ? { ...c, ...patch } : c)));
  }
  function rename(clientId: string, name: string) {
    setCards((prev) => {
      const old = prev.find((c) => c.clientId === clientId)?.name ?? "";
      return renameDependency(prev.map((c) => (c.clientId === clientId ? { ...c, name } : c)), old, name);
    });
  }
  // 단계가 바뀐 타일에 링 한 번 — 옮겨진 자리를 눈으로 잡게
  function settle(clientId: string) {
    setSettledId(clientId);
    later(SETTLE_MS, () => setSettledId((cur) => (cur === clientId ? null : cur)));
  }
  function applyStage(clientId: string, stage: number, index?: number) {
    setCards((prev) => {
      const moved = moveCardToStage(prev, clientId, stage);
      return index === undefined ? moved : reorderWithinStage(moved, clientId, index);
    });
    settle(clientId);
  }
  function add(stage: number) {
    const clientId = genId();
    setCards((prev) => {
      const prevGroups = groupByStage(prev);
      const before = stage > 0 ? (prevGroups[stage - 1] ?? []).map((c) => c.name.trim()).filter(Boolean) : [];
      return [...prev, { ...EMPTY, clientId, depends_on: before }];
    });
    setSelectedId(clientId);
    setAddedId(clientId);
    later(IN_MS, () => setAddedId((cur) => (cur === clientId ? null : cur)));
  }
  function remove(clientId: string) {
    setClosingIds((prev) => new Set(prev).add(clientId));
    later(OUT_MS, () => {
      setCards((prev) => prev.filter((c) => c.clientId !== clientId));
      setClosingIds((prev) => { const next = new Set(prev); next.delete(clientId); return next; });
      setSelectedId((cur) => (cur === clientId ? null : cur));
    });
  }

  // ── 타일 드래그: 4px 넘게 움직이면 드래그(고스트가 따라오고 행이 하이라이트), 아니면 클릭 = 선택
  function handleTilePointerDown(event: React.PointerEvent<HTMLDivElement>, clientId: string) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    gestureRef.current = { clientId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, dragging: false };
    const onMove = (ev: PointerEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      if (!g.dragging) {
        if (Math.abs(ev.clientX - g.startX) + Math.abs(ev.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
        g.dragging = true;
        setSelectedId(g.clientId);
      }
      setDrag({ clientId: g.clientId, x: ev.clientX - g.offsetX, y: ev.clientY - g.offsetY, ...locateDrop(ev.clientX, ev.clientY, g.clientId) });
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (!g.dragging) {
        setSelectedId(g.clientId);
        return;
      }
      const target = locateDrop(ev.clientX, ev.clientY, g.clientId);
      setDrag(null);
      if (target.stage === null) return;
      const from = stageOf(g.clientId);
      if (target.stage === from) setCards((prev) => reorderWithinStage(prev, g.clientId, target.index));
      else applyStage(g.clientId, target.stage, target.index);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  // 포인터 위치 → (행, 행 안 인덱스). 행은 [data-stage] 사각형으로, 인덱스는 그 행 타일들의 가로 중앙선으로 판정.
  // getBoundingClientRect가 FLIP transform 중간값을 돌려줄 수 있어 판정 자체는 중앙선 비교로 둔다(경계에서 튀지 않게).
  function locateDrop(x: number, y: number, dragging: string): { stage: number | null; index: number } {
    const root = listRef.current;
    if (!root) return { stage: null, index: 0 };
    const rows = [...root.querySelectorAll<HTMLElement>("[data-stage]")];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;
      const stage = Number(row.dataset.stage);
      const tiles = [...row.querySelectorAll<HTMLElement>("[data-flip-key]")].filter((el) => el.dataset.flipKey !== dragging);
      let index = tiles.length;
      for (let i = 0; i < tiles.length; i += 1) {
        const tr = tiles[i].getBoundingClientRect();
        // 줄바꿈된 행: 위 줄에 있는 타일은 건너뛰고, 같은 줄에서 중앙선 왼쪽이면 그 앞
        if (y < tr.top) { index = i; break; }
        if (y <= tr.bottom && x < tr.left + tr.width / 2) { index = i; break; }
      }
      return { stage, index };
    }
    return { stage: null, index: 0 };
  }

  // 키보드: ↑/↓ 선택 이동(표시 순), Alt+↑/↓ 단계 이동, Alt+←/→ 같은 행 안 순서, Enter/Space 선택
  function handleTileKeyDown(event: React.KeyboardEvent, card: KeyedCard, flatIndex: number) {
    if (event.target !== event.currentTarget) return;
    const stage = stageOf(card.clientId);
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const next = stage + (event.key === "ArrowUp" ? -1 : 1);
      if (next < 0 || next > groups.length) return;
      applyStage(card.clientId, next);
      later(0, () => focusTile(card.clientId));
    } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const pos = groups[stage].findIndex((c) => c.clientId === card.clientId);
      setCards((prev) => reorderWithinStage(prev, card.clientId, pos + (event.key === "ArrowLeft" ? -1 : 1)));
      later(0, () => focusTile(card.clientId));
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = flat[flatIndex + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) { setSelectedId(next.clientId); focusTile(next.clientId); }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(card.clientId);
    }
  }
  function focusTile(clientId: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-flip-key="${clientId}"] [role="button"]`)?.focus();
  }

  const canLock = cards.length > 0 && cards.every((c) => c.name.trim()) && !hasBlockingDuplicate(cards);
  const selectedExisting = Boolean(selected?.existing_code);
  const dragCard = drag ? cards.find((c) => c.clientId === drag.clientId) ?? null : null;
  const dependencyOptions = selected
    ? cards.filter((c) => c.clientId !== selected.clientId && c.name.trim() && !selected.depends_on.includes(c.name.trim()))
      .map((c) => ({ value: c.clientId, label: c.name.trim() }))
    : [];

  function renderStageLabel(stage: number, group: KeyedCard[]): string {
    const parts: string[] = [];
    if (stage === 0) parts.push(t("fwConsult.stageStart"));
    if (group.length > 1) parts.push(t("fwConsult.stageParallel", { n: group.length }));
    else if (group[0] && group[0].depends_on.length > 1) parts.push(t("fwConsult.stagePreceded", { n: group[0].depends_on.length }));
    if (stage === groups.length - 1 && groups.length > 1) parts.push(t("fwConsult.stageEnd"));
    return parts.join(" · ");
  }

  function renderTile(card: KeyedCard, flatIndex: number) {
    const isExisting = Boolean(card.existing_code);
    const isSelected = selected?.clientId === card.clientId;
    const isDragging = drag?.clientId === card.clientId;
    const motion = closingIds.has(card.clientId) ? "plan-tile-out" : addedId === card.clientId ? "plan-tile-in" : settledId === card.clientId ? "plan-tile-settle" : "";
    return (
      <div key={card.clientId} data-flip-key={card.clientId} data-id={`fw-consult-plan-card-${flatIndex}`} className={`${motion} ${isDragging ? "opacity-30" : ""}`}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={isSelected}
          data-id={`fw-consult-plan-row-${flatIndex}`}
          className={`${TILE} ${isSelected ? TILE_SELECTED : TILE_QUIET}`}
          onPointerDown={(event) => handleTilePointerDown(event, card.clientId)}
          onKeyDown={(event) => handleTileKeyDown(event, card, flatIndex)}
        >
          {/* 그립은 hover에서만, 우측 상단 — 타일 전체가 잡히므로 손잡이는 힌트일 뿐이라 왼쪽 여백을 차지하지 않는다 */}
          <span className="absolute right-1.5 top-2 text-ink-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100" aria-hidden="true">
            <GripVertical size={14} strokeWidth={1.5} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`min-w-0 truncate text-caption-strong ${card.name.trim() ? "text-ink" : "text-ink-muted"}`} data-id={`fw-consult-plan-title-${flatIndex}`}>
              {card.name.trim() || t("fwConsult.cardNameEmpty")}
            </span>
            {isExisting && (
              <span className="shrink-0 rounded-sm bg-surface-alt px-1 py-px text-[10px] leading-4 text-ink-secondary" data-id={`fw-consult-plan-existing-${flatIndex}`} title={card.existing_code ?? undefined}>
                {t("fwConsult.existing")} · {t((card.mode ?? "keep") === "revise" ? "fwConsult.revise" : "fwConsult.keep")}
              </span>
            )}
          </span>
          {(card.owner_role || card.department) && (
            <span className="truncate text-fine text-ink-secondary">{[card.owner_role, card.department].filter(Boolean).join(" · ")}</span>
          )}
          {card.summary && <span className="truncate text-fine text-ink-tertiary">{card.summary}</span>}
        </div>
      </div>
    );
  }

  // 단계별 표시 인덱스 시작점 — data-id 번호가 전체 표시 순서(flat)를 따르게
  const stageStarts = groups.reduce<number[]>((acc, group, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + groups[i - 1].length); return acc; }, []);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-id="fw-consult-plan">
      <div className="flex min-h-0 flex-1">
        {/* 2열: 단계 행 */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface-pearl px-2.5 py-1.5 text-fine text-ink-secondary">
            {session.existing.length > 0 && <span data-id="fw-consult-existing-note">{t("fwConsult.existingNote", { n: session.existing.length })}</span>}
            <span className="ml-auto text-ink-tertiary">{t("fwConsult.stageHint")}</span>
          </div>
          {/* select-none: 타일을 끌 때 포인터가 지나는 글자가 선택되지 않게(워스트 케이스 캡처에서 확인) */}
          <div ref={listRef} className="flex select-none flex-col" data-id="fw-consult-plan-cards">
            {groups.map((group, stage) => {
              const isTarget = drag !== null && drag.stage === stage;
              const startIndex = stageStarts[stage];
              return (
                <div
                  key={`stage-${stage}`}
                  data-stage={stage}
                  data-id={`fw-consult-plan-stage-${stage}`}
                  className={`group/stage flex items-stretch rounded-md py-1.5 transition-colors duration-150 ${isTarget ? "bg-accent-tint/50" : ""}`}
                >
                  <div className={`flex w-16 shrink-0 flex-col items-end border-r-2 pr-3 pt-0.5 ${selectedStage === stage ? "border-accent" : "border-hairline"}`}>
                    <span className={`text-tagline leading-none tabular-nums ${selectedStage === stage ? "text-accent" : "text-border-strong"}`}>{stage + 1}</span>
                    <span className="mt-0.5 whitespace-nowrap text-[10px] leading-3 text-ink-muted">{renderStageLabel(stage, group)}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap content-start gap-2 pl-3.5">
                    {group.map((card, k) => (
                      <div key={card.clientId} className="flex items-stretch gap-2">
                        {isTarget && drag?.index === k && drag.clientId !== card.clientId && <span className="w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                        {renderTile(card, startIndex + k)}
                      </div>
                    ))}
                    {isTarget && drag !== null && drag.index >= group.filter((c) => c.clientId !== drag.clientId).length && <span className="w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                    <button type="button" className={`${ADD_TILE} w-8 self-stretch`} data-id={`fw-consult-plan-add-stage-${stage}`} title={t("fwConsult.addCardHere")} aria-label={t("fwConsult.addCardHere")} onClick={() => add(stage)}>
                      <Plus size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
            {/* 새 단계 행 — 드롭하면 그 카드만 든 단계가 생긴다 */}
            <div
              data-stage={groups.length}
              data-id={`fw-consult-plan-stage-${groups.length}`}
              className={`group/stage flex items-stretch rounded-md py-1.5 transition-colors duration-150 ${drag !== null && drag.stage === groups.length ? "bg-accent-tint/50" : ""}`}
            >
              <div className="flex w-16 shrink-0 flex-col items-end border-r-2 border-dashed border-hairline pr-3 pt-0.5">
                <span className="text-tagline leading-none tabular-nums text-hairline">{groups.length + 1}</span>
              </div>
              <div className="flex min-w-0 flex-1 pl-3.5">
                <button type="button" className={`${ADD_TILE} gap-1 px-3 py-2`} style={{ width: TILE_WIDTH }} data-id="fw-consult-plan-add" onClick={() => add(groups.length)}>
                  <Plus size={14} strokeWidth={1.5} />{t("fwConsult.newStage")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 3열: 선택 카드 상세 */}
        <aside className="flex shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-hairline bg-surface-pearl p-3" style={{ width: DETAIL_WIDTH }} data-id="fw-consult-plan-detail">
          {selected ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-body-strong text-ink">{t("fwConsult.cardDetail")}</span>
                <span className="text-fine text-ink-tertiary tabular-nums">#{flat.indexOf(selected) + 1} · {selectedStage + 1}</span>
                {selectedExisting && (
                  <div className={`${SEGMENT} ml-auto`} data-id="fw-consult-plan-mode">
                    {CARD_MODES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        data-id={`fw-consult-plan-mode-${m}`}
                        aria-pressed={(selected.mode ?? "keep") === m}
                        title={m === "revise" ? t("fwConsult.reviseHint") : undefined}
                        className={`rounded-sm px-2 py-0.5 text-fine transition-colors ${
                          (selected.mode ?? "keep") === m ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                        }`}
                        onClick={() => update(selected.clientId, { mode: m })}
                      >
                        {t(m === "keep" ? "fwConsult.keep" : "fwConsult.revise")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedExisting && <span className="text-fine text-ink-tertiary" data-id="fw-consult-plan-detail-existing" title={selected.existing_code ?? undefined}>{t("fwConsult.existing")} · {t("fwConsult.reviseHint")}</span>}
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardName")}</span>
                <input className={`${FIELD} text-body-strong`} data-id="fw-consult-plan-name" value={selected.name} placeholder={t("fwConsult.cardName")} onChange={(e) => rename(selected.clientId, e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardSummary")}</span>
                <textarea className={`${FIELD} min-h-14 resize-y`} data-id="fw-consult-plan-summary" value={selected.summary} placeholder={t("fwConsult.cardSummary")} onChange={(e) => update(selected.clientId, { summary: e.target.value })} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className={LABEL}>{t("fwConsult.cardRole")}</span>
                  <input className={FIELD} data-id="fw-consult-plan-role" value={selected.owner_role} placeholder={t("fwConsult.cardRole")} onChange={(e) => update(selected.clientId, { owner_role: e.target.value })} />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className={LABEL}>{t("fwConsult.cardDept")}</span>
                  <input className={FIELD} data-id="fw-consult-plan-dept" value={selected.department} placeholder={t("fwConsult.cardDept")} onChange={(e) => update(selected.clientId, { department: e.target.value })} />
                </label>
              </div>
              {/* 선행 카드 — 단계 계산의 근거. 칩 제거·추가가 곧 단계 이동이다 */}
              <div className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.dependsOn")}</span>
                <div className="flex flex-wrap items-center gap-1" data-id="fw-consult-plan-deps">
                  {selected.depends_on.map((dep) => (
                    <span key={dep} className="inline-flex items-center gap-1 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink" data-id={`fw-consult-plan-dep-${dep}`}>
                      {dep}
                      <button type="button" className="rounded-xs text-ink-tertiary hover:text-error" aria-label={`${t("fwConsult.removeCard")} ${dep}`} onClick={() => { update(selected.clientId, { depends_on: selected.depends_on.filter((d) => d !== dep) }); settle(selected.clientId); }}>
                        <X size={12} strokeWidth={1.5} />
                      </button>
                    </span>
                  ))}
                  {dependencyOptions.length > 0 && (
                    <SearchSelect
                      value=""
                      options={dependencyOptions}
                      emptyLabel={t("fwConsult.addDependency")}
                      placeholder={t("fwConsult.cardName")}
                      fitContent
                      onChange={(clientId) => {
                        const target = cards.find((c) => c.clientId === clientId);
                        if (!target) return;
                        update(selected.clientId, { depends_on: [...selected.depends_on, target.name.trim()] });
                        settle(selected.clientId);
                      }}
                    />
                  )}
                </div>
              </div>
              <button
                type="button"
                className={`${SECONDARY} mt-auto self-start text-error`}
                data-id="fw-consult-plan-remove"
                title={selectedExisting ? t("fwConsult.existingKept") : t("fwConsult.removeCard")}
                disabled={selectedExisting || closingIds.has(selected.clientId)}
                onClick={() => remove(selected.clientId)}
              >
                <Trash2 size={14} strokeWidth={1.5} />{t("fwConsult.removeCard")}
              </button>
            </>
          ) : (
            <p className="text-caption text-ink-tertiary" data-id="fw-consult-plan-empty">{t("fwConsult.selectCardHint")}</p>
          )}
        </aside>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
        <span className="text-fine text-ink-tertiary">{t("fwConsult.dragToReorder")}</span>
        <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(stripClientIds(cards))}>{t("fwConsult.save")}</button>
        <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(stripClientIds(cards))}>{t("fwConsult.lockPlan")}</button>
      </div>

      {/* 드래그 고스트 — 포인터를 따라오는 타일 사본(원본은 제자리에서 흐려진다) */}
      {drag && dragCard && (
        <div className="pointer-events-none fixed z-[1200] w-[200px] rounded-md border border-accent bg-surface px-2.5 py-2 opacity-90 shadow-lg" style={{ left: drag.x, top: drag.y }} data-id="fw-consult-plan-ghost">
          <div className="truncate text-caption-strong text-ink">{dragCard.name.trim() || t("fwConsult.cardNameEmpty")}</div>
          {(dragCard.owner_role || dragCard.department) && <div className="truncate text-fine text-ink-secondary">{[dragCard.owner_role, dragCard.department].filter(Boolean).join(" · ")}</div>}
        </div>
      )}
    </section>
  );
}
