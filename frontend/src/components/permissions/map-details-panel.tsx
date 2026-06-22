"use client";

// 맵 정보 탭 — description 편집(편집자+). 저장 시 PATCH /maps/{id} / Map details: edit description (editor+).

import { useEffect, useState } from "react";

import { getMap, updateMap } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface MapDetailsPanelProps {
  mapId: string;
  canEdit: boolean;
  onToast: (message: string) => void;
}

export function MapDetailsPanel({ mapId, canEdit, onToast }: MapDetailsPanelProps) {
  const { t } = useI18n();
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (active) setDescription(d.description);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateMap(Number(mapId), { description });
      onToast(t("perm.details.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-id="settings-details" className="flex max-w-xl flex-col gap-3">
      <label className="text-caption text-ink-secondary">
        {t("perm.details.descriptionLabel")}
      </label>
      <textarea
        data-id="settings-description"
        className="min-h-[6rem] resize-y rounded-sm border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent disabled:opacity-60"
        placeholder={t("perm.details.descriptionPlaceholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={!canEdit || saving}
      />
      {error && <p className="text-caption text-error">{error}</p>}
      {canEdit && (
        <div>
          <button
            type="button"
            data-id="settings-description-save"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {t("perm.details.save")}
          </button>
        </div>
      )}
    </div>
  );
}
