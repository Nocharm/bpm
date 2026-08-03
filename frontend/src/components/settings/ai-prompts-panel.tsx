"use client";

// AI 프롬프트 관리 패널 — sysadmin이 AI 시스템 프롬프트를 열람·오버라이드·기본값 복원.
// 행 없음 = 코드 기본값 (설계: docs/design/2026-08-04-ai-prompts-admin-design.md)

import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Pencil, RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownView } from "@/components/markdown-view";
import { getAiPrompts, putAiPrompt, resetAiPrompt, type AiPromptItem } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const OUTLINE_BTN =
  "flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt";

// key → i18n 라벨 — 백엔드는 key만 주고 표시명·설명은 프론트가 소유
const PROMPT_LABELS: Record<string, { name: MessageKey; hint: MessageKey }> = {
  ai_chat_instructions: {
    name: "aiPrompts.name.ai_chat_instructions",
    hint: "aiPrompts.hint.ai_chat_instructions",
  },
  interviewer_contract: {
    name: "aiPrompts.name.interviewer_contract",
    hint: "aiPrompts.hint.interviewer_contract",
  },
  drafter_contract: {
    name: "aiPrompts.name.drafter_contract",
    hint: "aiPrompts.hint.drafter_contract",
  },
  interviewer_word_addendum: {
    name: "aiPrompts.name.interviewer_word_addendum",
    hint: "aiPrompts.hint.interviewer_word_addendum",
  },
  drafter_word_addendum: {
    name: "aiPrompts.name.drafter_word_addendum",
    hint: "aiPrompts.hint.drafter_word_addendum",
  },
  extract_contract: {
    name: "aiPrompts.name.extract_contract",
    hint: "aiPrompts.hint.extract_contract",
  },
  anti_repeat_nudge: {
    name: "aiPrompts.name.anti_repeat_nudge",
    hint: "aiPrompts.hint.anti_repeat_nudge",
  },
};

interface AiPromptsPanelProps {
  onToast: (message: string) => void;
}

export function AiPromptsPanel({ onToast }: AiPromptsPanelProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<AiPromptItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // 마운트 1회 로드 — setter만 사용해 deps 없음(로드 실패는 인라인 표기)
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await getAiPrompts();
        if (active) setItems(list);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selected = items.find((item) => item.key === selectedKey) ?? null;
  const dirty = selected !== null && draft !== selected.content;

  const applySelect = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    setSelectedKey(key);
    setDraft(item.content);
    setPreview(false);
  };

  const selectPrompt = (key: string) => {
    if (busy) return; // 저장/복원 비행 중 전환 차단 — 늦은 응답의 setDraft가 다른 프롬프트 draft를 덮는 경합 방지
    if (key === selectedKey) return;
    if (dirty) {
      setPendingSwitch(key);
      return;
    }
    applySelect(key);
  };

  const save = async () => {
    if (!selectedKey || draft.trim() === "") return;
    setBusy(true);
    try {
      const updated = await putAiPrompt(selectedKey, draft);
      setItems((prev) => prev.map((item) => (item.key === updated.key ? updated : item)));
      setDraft(updated.content);
      onToast(t("aiPrompts.saved"));
    } catch {
      onToast(t("aiPrompts.error"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!selectedKey) return;
    setBusy(true);
    try {
      const restored = await resetAiPrompt(selectedKey);
      setItems((prev) => prev.map((item) => (item.key === restored.key ? restored : item)));
      setDraft(restored.content);
      setPendingReset(false);
      onToast(t("aiPrompts.resetDone"));
    } catch {
      onToast(t("aiPrompts.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4" data-id="ai-prompts-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("aiPrompts.title")}</h2>
        <p className="pt-1 text-caption text-ink-tertiary">{t("aiPrompts.desc")}</p>
      </div>

      {/* JSON 계약 파손 경고 — 오편집 시 AI 기능 오동작 안내 */}
      <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
        <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 text-error" />
        {t("aiPrompts.warning")}
      </div>

      {loadError ? <p className="text-caption text-error">{t("aiPrompts.error")}</p> : null}

      {/* 프롬프트 목록 */}
      <div className="flex shrink-0 flex-col rounded-sm border border-hairline" data-id="ai-prompts-list">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            data-id={`ai-prompt-row-${item.key}`}
            className={`flex items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 ${
              selectedKey === item.key ? "bg-accent-tint" : "hover:bg-surface-alt"
            }`}
            onClick={() => selectPrompt(item.key)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-caption-strong text-ink">
                {t(PROMPT_LABELS[item.key]?.name ?? "aiPrompts.title")}
              </span>
              <span className="truncate text-fine text-ink-tertiary">
                {t(PROMPT_LABELS[item.key]?.hint ?? "aiPrompts.desc")}
              </span>
            </span>
            {item.is_customized ? (
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {t("aiPrompts.customized")}
                </span>
                <span className="text-fine text-ink-tertiary">
                  {t("aiPrompts.updatedBy", {
                    by: item.updated_by ?? "-",
                    at: formatKstShort(item.updated_at),
                  })}
                </span>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* 편집기 / 미리보기 — 매뉴얼 관리 패널 패턴 */}
      {selected ? (
        <div
          className="flex min-h-[320px] flex-1 flex-col rounded-sm border border-hairline"
          data-id="ai-prompt-editor"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-surface-alt px-3 py-1.5">
            <span className="font-mono text-fine text-ink-tertiary">{selected.key}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={preview}
                data-id="ai-prompt-preview-toggle"
                className={
                  OUTLINE_BTN + (preview ? " bg-accent-tint text-accent hover:bg-accent-tint" : "")
                }
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? (
                  <Pencil size={14} strokeWidth={1.5} />
                ) : (
                  <Eye size={14} strokeWidth={1.5} />
                )}
                {preview ? t("aiPrompts.edit") : t("aiPrompts.preview")}
              </button>
              <button
                type="button"
                data-id="ai-prompt-reset"
                disabled={busy || !selected.is_customized}
                className={OUTLINE_BTN + " disabled:opacity-50"}
                onClick={() => setPendingReset(true)}
              >
                <RotateCcw size={14} strokeWidth={1.5} />
                {t("aiPrompts.reset")}
              </button>
              <button
                type="button"
                data-id="ai-prompt-save"
                disabled={busy || !dirty || draft.trim() === ""}
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
                onClick={() => void save()}
              >
                {t("aiPrompts.save")}
              </button>
            </div>
          </div>
          {preview ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <MarkdownView source={draft} />
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              disabled={busy}
              className="min-h-0 flex-1 resize-none rounded-b-sm bg-surface px-5 py-4 font-mono text-caption leading-relaxed text-ink outline-none disabled:opacity-50"
            />
          )}
        </div>
      ) : null}

      {/* 기본값 복원 확인 */}
      {pendingReset && (
        <ConfirmDialog
          icon={<RotateCcw size={28} strokeWidth={1.5} />}
          title={t("aiPrompts.resetTitle")}
          message={t("aiPrompts.resetMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => void reset()}
          onClose={() => setPendingReset(false)}
        />
      )}
      {/* 더티 상태에서 다른 프롬프트 선택 확인 */}
      {pendingSwitch !== null && (
        <ConfirmDialog
          title={t("aiPrompts.dirtyTitle")}
          message={t("aiPrompts.dirtyMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            applySelect(pendingSwitch);
            setPendingSwitch(null);
          }}
          onClose={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
