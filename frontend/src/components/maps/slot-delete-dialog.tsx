"use client";

// 슬롯 있는 L6 삭제 — 후계자(선택) 고른 뒤 slot-changes{delete} dry_run → SlotChangeDialog (spec 2026-09-06 §7.3)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";

import { getApiErrorDetail, listMaps, postSlotChange, type MapSummary, type SlotChangeIn, type SlotChangeOut } from "@/lib/api";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { SlotChangeDialog } from "@/components/maps/slot-change-dialog";
import { useI18n } from "@/lib/i18n";

interface Props {
  mapId: number;
  mapName: string;
  onDone: (result: SlotChangeOut) => void;
  onClose: () => void;
}

export function SlotDeleteDialog({ mapId, mapName, onDone, onClose }: Props) {
  const { t } = useI18n();
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [successor, setSuccessor] = useState("");
  const [pending, setPending] = useState<{ body: SlotChangeIn; preview: SlotChangeOut } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listMaps().then((rows) => { if (active) setMaps(rows); }).catch((err: unknown) => setError(getApiErrorDetail(err)));
    return () => { active = false; };
  }, []);

  const options = (maps ?? [])
    .filter((m) => m.id !== mapId && (m.mode ?? "normal") === "normal" && m.category_id == null && m.consultant_code == null)
    .map((m) => ({ value: String(m.id), label: m.name }));

  async function next() {
    setBusy(true);
    setError(null);
    const body: SlotChangeIn = { action: "delete", to_map_id: successor ? Number(successor) : null };
    try {
      setPending({ body, preview: await postSlotChange(mapId, { ...body, dry_run: true }) });
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }

  if (pending !== null) {
    return <SlotChangeDialog mapId={mapId} body={pending.body} preview={pending.preview} onDone={onDone} onClose={() => setPending(null)} />;
  }
  return createPortal(
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm">
      <div data-id="slot-delete-dialog" className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <Trash2 size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("slot.action.delete")}</h2>
              <p className="truncate text-fine text-ink-tertiary">{mapName}</p>
            </div>
          </div>
          <button type="button" aria-label={t("summary.close")} className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-caption text-ink">
          {t("slot.successor")}
          <SearchSelect value={successor} options={options} emptyLabel={t("slot.successorNone")} placeholder={t("field.searchPlaceholder")} onChange={setSuccessor} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt" onClick={onClose}>{t("summary.cancel")}</button>
          <button type="button" data-id="slot-delete-next" disabled={busy} className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90 disabled:opacity-40" onClick={() => void next()}>
            {t("summary.next")}
          </button>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
