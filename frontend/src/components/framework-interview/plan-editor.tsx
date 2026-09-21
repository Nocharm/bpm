"use client";

// 캠페인 ① L5 개요 + L6 카드 편집 — brief 입력·첨부·AI 제안·카드 추가/삭제/순서·계획 확정(잠금). 페이지 우측 전용.

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";

import type { FwInterviewSession, FwPlanCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface PlanEditorProps {
  session: FwInterviewSession;
  busy: boolean;
  onBriefChange: (brief: string) => void;
  onAttach: (file: File) => void;
  onGenerate: () => void;
  onSave: (cards: FwPlanCard[]) => void;
  onLock: (cards: FwPlanCard[]) => void;
}

const EMPTY: FwPlanCard = { name: "", summary: "", owner_role: "", department: "", depends_on: [] };

export function PlanEditor({ session, busy, onAttach, onGenerate, onSave, onLock }: PlanEditorProps) {
  const { t } = useI18n();
  // 부모가 session.plan 내용으로 key를 리마운트하므로(page.tsx) 여기서는 마운트 시 1회 초기화만 한다 —
  // 폴링(attach/pause/resume 등)이 만드는 새 session 객체가 편집 중인 카드를 덮어쓰지 않는다.
  const [cards, setCards] = useState<FwPlanCard[]>(() => session.plan ?? []);
  const fileRef = useRef<HTMLInputElement>(null);

  function update(i: number, patch: Partial<FwPlanCard>) {
    setCards((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }
  function move(i: number, delta: number) {
    setCards((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  const canLock = cards.length > 0 && cards.every((c) => c.name.trim()) && new Set(cards.map((c) => c.name.trim())).size === cards.length;

  return (
    <div className="flex flex-col gap-4 p-4" data-id="fw-consult-plan">
      <div className="flex flex-col gap-1.5">
        <label className="text-caption text-ink-secondary" htmlFor="fw-consult-brief">{t("fwConsult.brief")}</label>
        <textarea id="fw-consult-brief" data-id="fw-consult-brief" className={`${FIELD} min-h-24`} defaultValue={session.brief} readOnly placeholder={t("fwConsult.briefPlaceholder")} />
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.md" data-id="fw-consult-attach-input"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
          <button type="button" className={SECONDARY} data-id="fw-consult-attach" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} strokeWidth={1.5} />{t("fwConsult.attach")}
          </button>
          <button type="button" className={SECONDARY} data-id="fw-consult-generate-plan" disabled={busy} onClick={onGenerate}>
            <Sparkles size={14} strokeWidth={1.5} />{cards.length ? t("fwConsult.regeneratePlan") : t("fwConsult.generatePlan")}
          </button>
        </div>
      </div>
      <ol className="flex flex-col gap-2" data-id="fw-consult-plan-cards">
        {cards.map((card, i) => (
          <li key={i} data-id={`fw-consult-plan-card-${i}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border border-hairline bg-surface-pearl p-2.5">
            <span className="pt-1 text-fine text-ink-tertiary tabular-nums">{i + 1}</span>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${FIELD} col-span-2`} data-id={`fw-consult-plan-name-${i}`} value={card.name} placeholder={t("fwConsult.cardName")} onChange={(e) => update(i, { name: e.target.value })} />
              <input className={`${FIELD} col-span-2`} data-id={`fw-consult-plan-summary-${i}`} value={card.summary} placeholder={t("fwConsult.cardSummary")} onChange={(e) => update(i, { summary: e.target.value })} />
              <input className={FIELD} data-id={`fw-consult-plan-role-${i}`} value={card.owner_role} placeholder={t("fwConsult.cardRole")} onChange={(e) => update(i, { owner_role: e.target.value })} />
              <input className={FIELD} data-id={`fw-consult-plan-dept-${i}`} value={card.department} placeholder={t("fwConsult.cardDept")} onChange={(e) => update(i, { department: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveUp")} data-id={`fw-consult-plan-up-${i}`} onClick={() => move(i, -1)}><ArrowUp size={14} strokeWidth={1.5} /></button>
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveDown")} data-id={`fw-consult-plan-down-${i}`} onClick={() => move(i, 1)}><ArrowDown size={14} strokeWidth={1.5} /></button>
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.removeCard")} data-id={`fw-consult-plan-remove-${i}`} onClick={() => setCards((prev) => prev.filter((_, k) => k !== i))}><Trash2 size={14} strokeWidth={1.5} /></button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-add" onClick={() => setCards((prev) => [...prev, { ...EMPTY }])}>
          <Plus size={14} strokeWidth={1.5} />{t("fwConsult.addCard")}
        </button>
        <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(cards)}>{t("fwConsult.save")}</button>
        <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(cards)}>{t("fwConsult.lockPlan")}</button>
      </div>
    </div>
  );
}
