"use client";

// 캠페인 ① L6 카드 계획 — 3열 중 2·3열: 읽기전용 카드 목록(드래그로 순서, 클릭으로 선택) | 선택한 카드의 상세 편집.
// brief·첨부·AI 제안은 1열 PlanBriefPanel이 맡는다(page.tsx가 이어 준다). 인라인 편집 카드는 폐기(사용자 결정 2026-09-24).
// 순서는 핸들 드래그(포인터) 또는 선택 행에서 Alt+↑/↓, 이동 애니는 FLIP(useFlipOrder, clientId 키).
// 삭제는 accordion-close 접힘, 추가는 accordion-open 펼침 + 새 카드 자동 선택.
// 기존 L6 맵에서 병합된 카드(existing_code)는 유지/정정만 고르고 삭제는 막는다 — 저장 시 서버 병합이 되살리기 때문.

import { useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import type { FwCardMode, FwInterviewSession, FwPlanCard } from "@/lib/api";
import { hasBlockingDuplicate } from "@/lib/framework-interview";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { moveCard, orderKeyOf, stripClientIds, swapCards, withClientIds, type KeyedCard } from "@/lib/plan-cards";
import { useFlipOrder } from "@/lib/use-flip-order";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink outline-none focus:border-accent";
const LABEL = "text-fine text-ink-tertiary";
const ROW =
  "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 " +
  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 outline-none";
const ROW_QUIET = "border-hairline bg-surface hover:bg-surface-pearl";
const ROW_SELECTED = "border-accent bg-accent-tint";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const SEGMENT = "flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5";  // 홈 뷰 토글과 같은 세그먼트
const DETAIL_WIDTH = 380;
const CLOSE_MS = 240;  // globals.css .accordion-close 재생 시간과 동기(use-closing-keys.ts 규칙)
const OPEN_MS = 300;   // globals.css .accordion-open

interface PlanEditorProps {
  session: FwInterviewSession;
  busy: boolean;
  // 현재 카드(키 제거본)를 부모에 미러 — 좌측 brief 패널의 AI 제안이 화면의 카드로 제안받는다
  onCardsChange: (cards: FwPlanCard[]) => void;
  onSave: (cards: FwPlanCard[]) => void;
  onLock: (cards: FwPlanCard[]) => void;
}

const EMPTY: FwPlanCard = { name: "", summary: "", owner_role: "", department: "", depends_on: [], mode: "new", existing_code: null };
const CARD_MODES: FwCardMode[] = ["keep", "revise"];

export function PlanEditor({ session, busy, onCardsChange, onSave, onLock }: PlanEditorProps) {
  const { t } = useI18n();
  // 부모가 session.plan 내용으로 key를 리마운트하므로(page.tsx) 여기서는 마운트 시 1회 초기화만 한다 —
  // 폴링(pause/resume 등)이 만드는 새 session 객체가 편집 중인 카드를 덮어쓰지 않는다.
  const [cards, setCards] = useState<KeyedCard[]>(() => withClientIds(session.plan ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(() => null);
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
  const [addedId, setAddedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useFlipOrder(listRef, orderKeyOf(cards));

  useEffect(() => {
    onCardsChange(stripClientIds(cards));
  }, [cards, onCardsChange]);

  // 선택이 없으면 첫 카드 — 상세 열이 비어 있지 않게. 삭제로 선택이 사라져도 같은 규칙으로 돌아온다.
  const selected = cards.find((c) => c.clientId === selectedId) ?? cards[0] ?? null;
  const selectedIndex = selected ? cards.indexOf(selected) : -1;

  function update(clientId: string, patch: Partial<FwPlanCard>) {
    setCards((prev) => prev.map((c) => (c.clientId === clientId ? { ...c, ...patch } : c)));
  }
  function add() {
    const clientId = genId();
    setCards((prev) => [...prev, { ...EMPTY, clientId }]);
    setSelectedId(clientId);
    setAddedId(clientId);
    window.setTimeout(() => setAddedId((cur) => (cur === clientId ? null : cur)), OPEN_MS);
  }
  function remove(clientId: string) {
    setClosingIds((prev) => new Set(prev).add(clientId));
    window.setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.clientId !== clientId));
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(clientId);
        return next;
      });
      setSelectedId((cur) => (cur === clientId ? null : cur));
    }, CLOSE_MS);
  }

  // 핸들 드래그 — 포인터 y가 이웃 행의 중앙선을 넘으면 그 자리로 옮긴다(FLIP이 나머지를 미끄러뜨린다).
  // 행 위치는 offsetTop(레이아웃 값)으로 읽는다 — getBoundingClientRect는 FLIP transform 중간값을 돌려줘 튄다.
  function handleDragStart(event: React.PointerEvent, clientId: string) {
    event.preventDefault();
    const list = listRef.current;
    if (!list) return;
    setSelectedId(clientId);
    setDraggingId(clientId);
    const onMove = (ev: PointerEvent) => {
      const items = [...list.querySelectorAll<HTMLElement>("[data-flip-key]")];
      const from = items.findIndex((el) => el.dataset.flipKey === clientId);
      if (from < 0) return;
      const y = ev.clientY - list.getBoundingClientRect().top + list.scrollTop;
      let to = from;
      items.forEach((el, idx) => {
        const mid = el.offsetTop + el.offsetHeight / 2;
        if (idx < from && y < mid) to = Math.min(to, idx);
        if (idx > from && y > mid) to = Math.max(to, idx);
      });
      if (to !== from) setCards((prev) => moveCard(prev, from, to));
    };
    const finish = () => {
      setDraggingId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  // 행 키보드: ↑/↓ 선택 이동, Alt+↑/↓ 순서 이동, Enter/Space 선택
  function handleRowKeyDown(event: React.KeyboardEvent, i: number) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      if (event.altKey) {
        setCards((prev) => swapCards(prev, i, delta));
        return;
      }
      const next = cards[i + delta];
      if (next) {
        setSelectedId(next.clientId);
        focusRow(i + delta);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(cards[i].clientId);
    }
  }
  function focusRow(i: number) {
    listRef.current?.querySelector<HTMLElement>(`[data-id="fw-consult-plan-row-${i}"]`)?.focus();
  }

  const canLock = cards.length > 0 && cards.every((c) => c.name.trim()) && !hasBlockingDuplicate(cards);
  const selectedExisting = Boolean(selected?.existing_code);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-id="fw-consult-plan">
      <div className="flex min-h-0 flex-1">
        {/* 2열: 읽기전용 카드 목록 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {session.existing.length > 0 && (
            <p className="rounded-md border border-hairline bg-surface-pearl px-2.5 py-2 text-fine text-ink-secondary" data-id="fw-consult-existing-note">
              {t("fwConsult.existingNote", { n: session.existing.length })}
            </p>
          )}
          <ol ref={listRef} className="relative flex flex-col gap-1" data-id="fw-consult-plan-cards">
            {cards.map((card, i) => {
              const isExisting = Boolean(card.existing_code);
              const isSelected = selected?.clientId === card.clientId;
              const wrapClass = closingIds.has(card.clientId) ? "accordion-close" : addedId === card.clientId ? "accordion-open" : "accordion-static";
              return (
                <li key={card.clientId} data-flip-key={card.clientId} data-id={`fw-consult-plan-card-${i}`} className={wrapClass}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    data-id={`fw-consult-plan-row-${i}`}
                    className={`${ROW} ${isSelected ? ROW_SELECTED : ROW_QUIET} ${draggingId === card.clientId ? "shadow-md" : ""}`}
                    onClick={() => setSelectedId(card.clientId)}
                    onKeyDown={(event) => handleRowKeyDown(event, i)}
                  >
                    <span
                      className="shrink-0 cursor-grab touch-none rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink active:cursor-grabbing"
                      data-id={`fw-consult-plan-handle-${i}`}
                      title={t("fwConsult.dragToReorder")}
                      onPointerDown={(event) => handleDragStart(event, card.clientId)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <GripVertical size={14} strokeWidth={1.5} />
                    </span>
                    <span className="w-5 shrink-0 text-fine text-ink-tertiary tabular-nums">{i + 1}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className={`min-w-0 truncate text-body-strong ${card.name.trim() ? "text-ink" : "text-ink-muted"}`} data-id={`fw-consult-plan-title-${i}`}>
                          {card.name.trim() || t("fwConsult.cardNameEmpty")}
                        </span>
                        {isExisting && (
                          <span className="shrink-0 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary" data-id={`fw-consult-plan-existing-${i}`} title={card.existing_code ?? undefined}>
                            {t("fwConsult.existing")} · {t((card.mode ?? "keep") === "revise" ? "fwConsult.revise" : "fwConsult.keep")}
                          </span>
                        )}
                      </span>
                      {(card.owner_role || card.department) && (
                        <span className="truncate text-fine text-ink-secondary">{[card.owner_role, card.department].filter(Boolean).join(" · ")}</span>
                      )}
                      {card.summary && <span className="truncate text-fine text-ink-tertiary">{card.summary}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" className={`${SECONDARY} self-start`} data-id="fw-consult-plan-add" onClick={add}>
            <Plus size={14} strokeWidth={1.5} />{t("fwConsult.addCard")}
          </button>
        </div>

        {/* 3열: 선택 카드 상세 */}
        <aside className="flex shrink-0 flex-col gap-3 overflow-y-auto border-l border-hairline bg-surface-pearl p-4" style={{ width: DETAIL_WIDTH }} data-id="fw-consult-plan-detail">
          {selected ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-body-strong text-ink">{t("fwConsult.cardDetail")}</span>
                <span className="text-fine text-ink-tertiary tabular-nums">#{selectedIndex + 1}</span>
                {selectedExisting && (
                  <span className="ml-auto rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary" data-id="fw-consult-plan-detail-existing" title={selected.existing_code ?? undefined}>
                    {t("fwConsult.existing")}
                  </span>
                )}
              </div>
              {selectedExisting && (
                <div className="flex items-center gap-2">
                  <div className={SEGMENT} data-id="fw-consult-plan-mode">
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
                  <span className="text-fine text-ink-tertiary">{t("fwConsult.reviseHint")}</span>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardName")}</span>
                <input className={`${FIELD} text-body-strong`} data-id="fw-consult-plan-name" value={selected.name} placeholder={t("fwConsult.cardName")} onChange={(e) => update(selected.clientId, { name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardSummary")}</span>
                <textarea className={`${FIELD} min-h-20 resize-y`} data-id="fw-consult-plan-summary" value={selected.summary} placeholder={t("fwConsult.cardSummary")} onChange={(e) => update(selected.clientId, { summary: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardRole")}</span>
                <input className={FIELD} data-id="fw-consult-plan-role" value={selected.owner_role} placeholder={t("fwConsult.cardRole")} onChange={(e) => update(selected.clientId, { owner_role: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{t("fwConsult.cardDept")}</span>
                <input className={FIELD} data-id="fw-consult-plan-dept" value={selected.department} placeholder={t("fwConsult.cardDept")} onChange={(e) => update(selected.clientId, { department: e.target.value })} />
              </label>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        <span className="text-fine text-ink-tertiary">{t("fwConsult.dragToReorder")}</span>
        <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(stripClientIds(cards))}>{t("fwConsult.save")}</button>
        <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(stripClientIds(cards))}>{t("fwConsult.lockPlan")}</button>
      </div>
    </section>
  );
}
