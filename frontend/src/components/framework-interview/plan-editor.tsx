"use client";

// 캠페인 ① L6 카드 편집 — 카드 추가/삭제/순서·저장·계획 확정(잠금). brief·첨부·AI 제안은 좌측 PlanBriefPanel이 맡는다(page.tsx가 이어 준다).
// 카드는 기본 투명(값만 텍스트처럼)이고 hover/focus-within에서 편집 모양이 드러난다. 순서 이동은 FLIP(useFlipOrder, clientId 키),
// 삭제는 accordion-close 접힘, 추가는 accordion-open 펼침 (spec 2026-09-23 §3 B6·B7).
// 기존 L6 맵에서 병합된 카드(existing_code)는 유지/정정만 고르고 삭제는 막는다 — 저장 시 서버 병합이 되살리기 때문.

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import type { FwCardMode, FwInterviewSession, FwPlanCard } from "@/lib/api";
import { hasBlockingDuplicate } from "@/lib/framework-interview";
import { genId } from "@/lib/id";
import { useI18n } from "@/lib/i18n";
import { orderKeyOf, stripClientIds, swapCards, withClientIds, type KeyedCard } from "@/lib/plan-cards";
import { useFlipOrder } from "@/lib/use-flip-order";

// 인풋은 카드가 조용할 때 테두리 없이 텍스트처럼, 카드가 hover/focus-within이면 편집 모양으로
const FIELD =
  "w-full rounded-sm border border-transparent bg-transparent px-2 py-1 text-caption text-ink transition-colors duration-150 " +
  "group-hover:border-hairline group-hover:bg-surface group-focus-within:border-hairline group-focus-within:bg-surface";
const CARD =
  "group grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border border-transparent p-2.5 transition-colors duration-150 " +
  "hover:border-hairline hover:bg-surface-pearl focus-within:border-hairline focus-within:bg-surface-pearl";
// 순서/삭제 열은 카드가 조용할 때 숨긴다
const CARD_TOOLS = "flex flex-col gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const SEGMENT = "flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5";  // 홈 뷰 토글과 같은 세그먼트
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
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
  const [addedId, setAddedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useFlipOrder(listRef, orderKeyOf(cards));

  useEffect(() => {
    onCardsChange(stripClientIds(cards));
  }, [cards, onCardsChange]);

  function update(i: number, patch: Partial<FwPlanCard>) {
    setCards((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }
  function move(i: number, delta: 1 | -1) {
    setCards((prev) => swapCards(prev, i, delta));
  }
  function add() {
    const clientId = genId();
    setCards((prev) => [...prev, { ...EMPTY, clientId }]);
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
    }, CLOSE_MS);
  }
  const canLock = cards.length > 0 && cards.every((c) => c.name.trim()) && !hasBlockingDuplicate(cards);

  return (
    <section className="flex min-w-0 flex-col gap-3 p-4" data-id="fw-consult-plan">
      {session.existing.length > 0 && (
        <p className="rounded-md border border-hairline bg-surface-pearl px-2.5 py-2 text-fine text-ink-secondary" data-id="fw-consult-existing-note">
          {t("fwConsult.existingNote", { n: session.existing.length })}
        </p>
      )}
      <ol ref={listRef} className="flex flex-col gap-1" data-id="fw-consult-plan-cards">
        {cards.map((card, i) => {
          // 기존 맵 카드는 서버 병합이 되살리므로 삭제 대신 유지/정정만 고른다.
          const isExisting = Boolean(card.existing_code);
          const wrapClass = closingIds.has(card.clientId) ? "accordion-close" : addedId === card.clientId ? "accordion-open" : "accordion-static";
          return (
            <li key={card.clientId} data-flip-key={card.clientId} data-id={`fw-consult-plan-card-${i}`} className={wrapClass}>
              <div className={CARD}>
                <span className="pt-1 text-fine text-ink-tertiary tabular-nums">{i + 1}</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="col-span-2 flex items-center gap-1.5">
                    {isExisting && (
                      <span className="shrink-0 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary" data-id={`fw-consult-plan-existing-${i}`} title={card.existing_code ?? undefined}>
                        {t("fwConsult.existing")}
                      </span>
                    )}
                    <input className={`${FIELD} min-w-0 flex-1 text-body-strong`} data-id={`fw-consult-plan-name-${i}`} value={card.name} placeholder={t("fwConsult.cardName")} onChange={(e) => update(i, { name: e.target.value })} />
                    {isExisting && (
                      <div className={SEGMENT} data-id={`fw-consult-plan-mode-${i}`}>
                        {CARD_MODES.map((m) => (
                          <button
                            key={m}
                            type="button"
                            data-id={`fw-consult-plan-mode-${i}-${m}`}
                            aria-pressed={(card.mode ?? "keep") === m}
                            title={m === "revise" ? t("fwConsult.reviseHint") : undefined}
                            className={`rounded-sm px-2 py-0.5 text-fine transition-colors ${
                              (card.mode ?? "keep") === m ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                            }`}
                            onClick={() => update(i, { mode: m })}
                          >
                            {t(m === "keep" ? "fwConsult.keep" : "fwConsult.revise")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input className={`${FIELD} col-span-2`} data-id={`fw-consult-plan-summary-${i}`} value={card.summary} placeholder={t("fwConsult.cardSummary")} onChange={(e) => update(i, { summary: e.target.value })} />
                  <input className={FIELD} data-id={`fw-consult-plan-role-${i}`} value={card.owner_role} placeholder={t("fwConsult.cardRole")} onChange={(e) => update(i, { owner_role: e.target.value })} />
                  <input className={FIELD} data-id={`fw-consult-plan-dept-${i}`} value={card.department} placeholder={t("fwConsult.cardDept")} onChange={(e) => update(i, { department: e.target.value })} />
                </div>
                <div className={CARD_TOOLS}>
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40" title={t("fwConsult.moveUp")} data-id={`fw-consult-plan-up-${i}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} strokeWidth={1.5} /></button>
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40" title={t("fwConsult.moveDown")} data-id={`fw-consult-plan-down-${i}`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} strokeWidth={1.5} /></button>
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40" title={isExisting ? t("fwConsult.existingKept") : t("fwConsult.removeCard")} data-id={`fw-consult-plan-remove-${i}`} disabled={isExisting || closingIds.has(card.clientId)} onClick={() => remove(card.clientId)}><Trash2 size={14} strokeWidth={1.5} /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-add" onClick={add}>
          <Plus size={14} strokeWidth={1.5} />{t("fwConsult.addCard")}
        </button>
        <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(stripClientIds(cards))}>{t("fwConsult.save")}</button>
        <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(stripClientIds(cards))}>{t("fwConsult.lockPlan")}</button>
      </div>
    </section>
  );
}
