"use client";

// 캠페인 ① L5 개요 + L6 카드 편집 — 2단(좌: 목적/범위 brief + 첨부 목록, 우: 카드 편집)·AI 제안·카드 추가/삭제/순서·계획 확정(잠금).
// 첨부는 brief와 분리된 목록으로 개별 삭제한다(잘못 올린 파일 누적 방지). 페이지 우측 전용.
// 기존 L6 맵에서 병합된 카드(existing_code)는 유지/정정만 고르고 삭제는 막는다 — 저장 시 서버 병합이 되살리기 때문.

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Paperclip, Plus, Sparkles, Trash2, X } from "lucide-react";

import type { FwCardMode, FwInterviewSession, FwPlanCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const SEGMENT = "flex shrink-0 items-center gap-0.5 rounded-sm border border-hairline bg-surface p-0.5";  // 홈 뷰 토글과 같은 세그먼트

interface PlanEditorProps {
  session: FwInterviewSession;
  busy: boolean;
  onAttach: (file: File) => void;
  onRemoveAttachment: (index: number) => void;
  onGenerate: (cards: FwPlanCard[], brief: string) => void;
  onSave: (cards: FwPlanCard[], brief: string) => void;
  onLock: (cards: FwPlanCard[], brief: string) => void;
}

const EMPTY: FwPlanCard = { name: "", summary: "", owner_role: "", department: "", depends_on: [], mode: "new", existing_code: null };
const CARD_MODES: FwCardMode[] = ["keep", "revise"];

export function PlanEditor({ session, busy, onAttach, onRemoveAttachment, onGenerate, onSave, onLock }: PlanEditorProps) {
  const { t } = useI18n();
  // 부모가 session.plan 내용으로 key를 리마운트하므로(page.tsx) 여기서는 마운트 시 1회 초기화만 한다 —
  // 폴링(pause/resume 등)이 만드는 새 session 객체가 편집 중인 카드·brief를 덮어쓰지 않는다.
  const [cards, setCards] = useState<FwPlanCard[]>(() => session.plan ?? []);
  const [brief, setBrief] = useState(() => session.brief);
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
    <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(320px,2fr)_3fr]" data-id="fw-consult-plan">
      {/* 좌: 목적/범위 + 첨부 — 카드 목록과 나란히 두어 폭이 넓은 화면에서 한 눈에 들어오게 */}
      <section className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-pearl p-3" data-id="fw-consult-brief-panel">
        <div className="flex flex-col gap-1">
          <label className="text-body-strong text-ink" htmlFor="fw-consult-brief">{t("fwConsult.brief")}</label>
          <span className="text-fine text-ink-tertiary">{t("fwConsult.briefHint")}</span>
        </div>
        <textarea id="fw-consult-brief" data-id="fw-consult-brief" className={`${FIELD} min-h-48`} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("fwConsult.briefPlaceholder")} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-caption text-ink">{t("fwConsult.attachments")}</span>
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.md" data-id="fw-consult-attach-input"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
            <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-attach" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Paperclip size={14} strokeWidth={1.5} />{t("fwConsult.attach")}
            </button>
          </div>
          <span className="text-fine text-ink-tertiary">{t("fwConsult.attachHint")}</span>
          {session.attachments.length === 0 ? (
            <span className="text-fine text-ink-tertiary" data-id="fw-consult-attachments-empty">{t("fwConsult.noAttachments")}</span>
          ) : (
            <ul className="flex flex-col gap-1" data-id="fw-consult-attachments">
              {session.attachments.map((a, i) => (
                <li key={`${a.name}-${i}`} data-id={`fw-consult-attachment-${i}`} className="flex items-center gap-2 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink">
                  <FileText size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="shrink-0 text-fine text-ink-tertiary tabular-nums">{t("fwConsult.chars", { count: a.chars.toLocaleString() })}</span>
                  <button type="button" data-id={`fw-consult-attachment-remove-${i}`} className="shrink-0 rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.removeAttachment")} disabled={busy} onClick={() => onRemoveAttachment(i)}>
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className={SECONDARY} data-id="fw-consult-generate-plan" disabled={busy} onClick={() => onGenerate(cards, brief)}>
          <Sparkles size={14} strokeWidth={1.5} />{cards.length ? t("fwConsult.regeneratePlan") : t("fwConsult.generatePlan")}
        </button>
      </section>

      {/* 우: L6 카드 목록 + 저장/확정 */}
      <section className="flex min-w-0 flex-col gap-3" data-id="fw-consult-cards-panel">
        {session.existing.length > 0 && (
          <p className="rounded-md border border-hairline bg-surface-pearl px-2.5 py-2 text-fine text-ink-secondary" data-id="fw-consult-existing-note">
            {t("fwConsult.existingNote", { n: session.existing.length })}
          </p>
        )}
        <ol className="flex flex-col gap-2" data-id="fw-consult-plan-cards">
          {cards.map((card, i) => {
            // 기존 맵 카드는 서버 병합이 되살리므로 삭제 대신 유지/정정만 고른다.
            const isExisting = Boolean(card.existing_code);
            return (
              <li key={i} data-id={`fw-consult-plan-card-${i}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border border-hairline bg-surface-pearl p-2.5">
                <span className="pt-1 text-fine text-ink-tertiary tabular-nums">{i + 1}</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="col-span-2 flex items-center gap-1.5">
                    {isExisting && (
                      <span className="shrink-0 rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary" data-id={`fw-consult-plan-existing-${i}`} title={card.existing_code ?? undefined}>
                        {t("fwConsult.existing")}
                      </span>
                    )}
                    <input className={`${FIELD} min-w-0 flex-1`} data-id={`fw-consult-plan-name-${i}`} value={card.name} placeholder={t("fwConsult.cardName")} onChange={(e) => update(i, { name: e.target.value })} />
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
                <div className="flex flex-col gap-1">
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveUp")} data-id={`fw-consult-plan-up-${i}`} onClick={() => move(i, -1)}><ArrowUp size={14} strokeWidth={1.5} /></button>
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveDown")} data-id={`fw-consult-plan-down-${i}`} onClick={() => move(i, 1)}><ArrowDown size={14} strokeWidth={1.5} /></button>
                  <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt disabled:opacity-40" title={isExisting ? t("fwConsult.existingKept") : t("fwConsult.removeCard")} data-id={`fw-consult-plan-remove-${i}`} disabled={isExisting} onClick={() => setCards((prev) => prev.filter((_, k) => k !== i))}><Trash2 size={14} strokeWidth={1.5} /></button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY} data-id="fw-consult-plan-add" onClick={() => setCards((prev) => [...prev, { ...EMPTY }])}>
            <Plus size={14} strokeWidth={1.5} />{t("fwConsult.addCard")}
          </button>
          <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
          <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(cards, brief)}>{t("fwConsult.save")}</button>
          <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(cards, brief)}>{t("fwConsult.lockPlan")}</button>
        </div>
      </section>
    </div>
  );
}
