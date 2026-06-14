"use client";

// 맵 소유자가 승인자 목록을 편집 (design 2026-06-14)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { listApprovers, setApprovers } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ApproverManagerProps {
  mapId: number;
  onClose: () => void;
  onSaved: (approvers: string[]) => void;
}

export function ApproverManager({ mapId, onClose, onSaved }: ApproverManagerProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listApprovers(mapId)
      .then((ids) => {
        if (alive) setText(ids.join("\n"));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mapId]);

  // Esc로 닫기 — backdrop·캔버스 뒤에 갇히지 않도록 항상 탈출 가능
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSave = async () => {
    const ids = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    try {
      const saved = await setApprovers(mapId, ids);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.approvers"));
    }
  };

  const btn =
    "rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt disabled:opacity-40";

  // document.body로 포털 — 에디터 캔버스/창의 스택 컨텍스트 밖에서 최상단 렌더
  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="w-80 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-body-strong text-ink">{t("approvers.title")}</p>
        <p className="mt-1 text-fine text-ink-tertiary">{t("approvers.hint")}</p>
        <textarea
          className="mt-2 w-full rounded-sm border border-hairline p-2 text-caption"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {error && <p className="mt-1 text-fine text-error">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("approvers.cancel")}
          </button>
          <button type="button" className={btn} onClick={() => void handleSave()}>
            {t("approvers.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
