"use client";

// 맵 정보 탭 — description 편집(편집자+) + 오우닝 부서 표시/지정(owner) / Map details:
// edit description (editor+); show/assign owning department (owner-gated, spec 2026-07-10).

import { useEffect, useState } from "react";
import { Building2, LockKeyhole, TriangleAlert } from "lucide-react";

import {
  createRenameRequest,
  getDirectory,
  getMap,
  getMe,
  getPendingRenameRequest,
  setOwningDepartment,
  updateMap,
  withdrawRenameRequest,
} from "@/lib/api";
import type { ApprovalRequest, DirectoryDept, DirectoryUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { buildKoreanDeptByPath, deriveDeptKoreanKeywords, formatDeptName } from "@/lib/korean-dept";
import type { Department } from "@/lib/mock/permissions-types";
import { PrincipalPicker } from "@/components/permissions/principal-picker";
import type { PrincipalOption } from "@/components/permissions/principal-picker";

interface MapDetailsPanelProps {
  mapId: string;
  canEdit: boolean;
  /** 오우닝 부서 지정/변경은 owner(sysadmin 포함) 전용 */
  isOwner: boolean;
  onToast: (message: string) => void;
  /** 오우닝 부서 변경 후 부모 갱신(협업자 잠금 행 동기화) */
  onChanged?: () => void;
}

export function MapDetailsPanel({ mapId, canEdit, isOwner, onToast, onChanged }: MapDetailsPanelProps) {
  const { t, lang } = useI18n();
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 이름 변경 — owner는 즉시 적용(updateMap), editor는 승인 요청(pending ApprovalRequest).
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [pendingRename, setPendingRename] = useState<ApprovalRequest | null>(null);
  const [me, setMe] = useState("");

  // 오우닝 부서 표시/지정 — description과 같은 effect에서 병렬 로드.
  const [owningDept, setOwningDept] = useState<string | null>(null);
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [dirDepts, setDirDepts] = useState<DirectoryDept[]>([]);
  const [pickingOwning, setPickingOwning] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getMap(Number(mapId)),
      getDirectory(),
      getPendingRenameRequest(Number(mapId)),
      getMe(),
    ])
      .then(([d, dir, pending, meRes]) => {
        if (active) {
          setDescription(d.description);
          setName(d.name);
          setSavedName(d.name);
          setOwningDept(d.owning_department ?? null);
          setDirUsers(dir.users);
          setDirDepts(dir.departments);
          setPendingRename(pending);
          setMe(meRes.username);
        }
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

  async function handleSaveName() {
    const next = name.trim();
    if (!next || next === savedName) return;
    setSaving(true);
    setError(null);
    try {
      if (isOwner) {
        const hadPending = pendingRename !== null;
        await updateMap(Number(mapId), { name: next });
        setSavedName(next);
        setPendingRename(null);
        onToast(t(hadPending ? "perm.rename.appliedSuperseded" : "perm.rename.applied"));
        onChanged?.();
      } else {
        const req = await createRenameRequest(Number(mapId), next);
        setPendingRename(req);
        setName(savedName); // 이름 자체는 미변경 — 입력은 저장명으로 복원
        onToast(t("perm.rename.requested"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleWithdraw() {
    try {
      await withdrawRenameRequest(Number(mapId));
      setPendingRename(null);
      onToast(t("perm.rename.withdrawn"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePickOwning(opt: PrincipalOption) {
    try {
      const updated = await setOwningDepartment(Number(mapId), opt.principalId);
      setOwningDept(updated.owning_department ?? opt.principalId);
      setPickingOwning(false);
      onToast(t("perm.owningDept.saved"));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // 피커용 부서 어댑터 — create-map-dialog.tsx:117-132와 동일한 변환(부서만 필요, users는 생략).
  const userById = new Map(dirUsers.map((u) => [u.id, u]));
  const pickerDepts: Department[] = dirDepts.map((d) => {
    const head = d.manager ? userById.get(d.manager) : undefined;
    const managerKeywords = [d.manager, head?.name, head?.korean_name].filter(Boolean).join(" ");
    return {
      id: d.id,
      code: "",
      name: d.name,
      orgLevels: [],
      parentId: null,
      rawDn: "",
      korean_name: d.korean_name,
      manager: managerKeywords,
    };
  });
  const koreanByPath = buildKoreanDeptByPath(dirDepts, dirUsers);

  return (
    <div data-id="settings-details" className="flex max-w-xl flex-col gap-3">
      <label className="text-caption text-ink-secondary">{t("perm.rename.label")}</label>
      <div className="flex items-center gap-2">
        <input
          data-id="settings-map-name"
          className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit || saving || (!isOwner && pendingRename !== null)}
        />
        {canEdit && (
          <button
            type="button"
            data-id="settings-map-name-save"
            className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
            onClick={() => void handleSaveName()}
            disabled={saving || name.trim() === "" || name.trim() === savedName || (!isOwner && pendingRename !== null)}
          >
            {t("perm.rename.save")}
          </button>
        )}
      </div>
      {pendingRename && (
        <div
          data-id="settings-rename-pending"
          className="flex flex-wrap items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary"
        >
          <span>{t("perm.rename.pendingBadge", { name: String(pendingRename.payload?.to_name ?? "") })}</span>
          <span className="text-ink-tertiary">{t("perm.rename.requestedBy", { user: pendingRename.requested_by })}</span>
          {pendingRename.requested_by === me && (
            <button
              type="button"
              data-id="settings-rename-withdraw"
              className="ml-auto rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface"
              onClick={() => void handleWithdraw()}
            >
              {t("perm.rename.withdraw")}
            </button>
          )}
        </div>
      )}
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

      <div data-id="settings-owning-dept" className="flex flex-col gap-1.5">
        <label className="text-caption text-ink-secondary">{t("perm.owningDept.title")}</label>
        {owningDept ? (
          <div className="flex items-center gap-2 rounded-sm border border-hairline px-3 py-2">
            <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <span className="min-w-0 flex-1 truncate text-body text-ink">
              {formatDeptName(owningDept, lang, koreanByPath)}
              <span className="ml-1.5 text-fine text-ink-tertiary">{owningDept}</span>
            </span>
            <span
              title={t("perm.owningDept.lockedNote")}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
            >
              <LockKeyhole size={12} strokeWidth={1.5} />
              {t("perm.owningDept.lockedEditor")}
            </span>
            {isOwner && (
              <button
                type="button"
                data-id="owning-dept-change"
                className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt"
                onClick={() => setPickingOwning((v) => !v)}
              >
                {t("perm.owningDept.changeBtn")}
              </button>
            )}
          </div>
        ) : (
          <div
            data-id="owning-dept-missing"
            className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2"
          >
            <TriangleAlert size={16} strokeWidth={1.5} className="shrink-0 text-error" />
            <span className="min-w-0 flex-1 text-caption text-ink-secondary">
              {t("perm.owningDept.missingNotice")}
            </span>
            {isOwner && (
              <button
                type="button"
                data-id="owning-dept-assign"
                className="rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
                onClick={() => setPickingOwning((v) => !v)}
              >
                {t("perm.owningDept.assignBtn")}
              </button>
            )}
          </div>
        )}
        {pickingOwning && isOwner && (
          <PrincipalPicker
            users={[]}
            departments={pickerDepts}
            groups={[]}
            excludeIds={new Set(owningDept ? [owningDept] : [])}
            deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
            onSelect={(opt) => void handlePickOwning(opt)}
          />
        )}
      </div>
    </div>
  );
}
