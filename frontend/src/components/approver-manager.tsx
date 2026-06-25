"use client";

// 맵 소유자가 승인자 목록을 편집 — 캔버스 우하단 승인 워크플로에서 호출.
// 디자인은 맵 생성 다이얼로그의 승인자 지정과 통일: PrincipalPicker(viewer+ 자격자) + 선택 목록 (#4).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  listApprovers,
  listEligibleApprovers,
  setApprovers,
  type DirectoryUser,
} from "@/lib/api";
import { PrincipalPicker, PrincipalIcon } from "@/components/permissions/principal-picker";
import { useI18n } from "@/lib/i18n";

interface ApproverManagerProps {
  mapId: number;
  onClose: () => void;
  onSaved: (approvers: string[]) => void;
}

export function ApproverManager({ mapId, onClose, onSaved }: ApproverManagerProps) {
  const { t } = useI18n();
  const [dirUsers, setDirUsers] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([listApprovers(mapId), listEligibleApprovers(mapId)])
      .then(([ids, users]) => {
        if (alive) {
          setSelected(ids);
          setDirUsers(users);
        }
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

  // 승인자 후보 = viewer+ 자격자(서버) — 생성 다이얼로그/설정 승인자 picker와 동일.
  const pickerUsers = dirUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: "",
    departmentId: "",
    status: "active" as const,
    isSysadmin: false,
  }));
  const userDepartments = Object.fromEntries(dirUsers.map((u) => [u.id, u.department]));
  const dirName = (id: string) => dirUsers.find((u) => u.id === id)?.name ?? id;

  const handleSave = async () => {
    try {
      const saved = await setApprovers(mapId, selected);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("err.approvers"));
    }
  };

  return createPortal(
    <ModalBackdrop
      className="fixed inset-0 z-[1200] flex items-center justify-center backdrop-blur-sm"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClose={onClose}
    >
      <div
        className="flex w-96 flex-col gap-2 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <p className="text-body-strong text-ink">{t("approvers.title")}</p>
          <p className="mt-0.5 text-fine text-ink-tertiary">{t("approvers.hint")}</p>
        </div>

        {/* 승인자 추가 picker (users only) — 생성 다이얼로그와 동일 */}
        <PrincipalPicker
          users={pickerUsers}
          departments={[]}
          groups={[]}
          excludeIds={new Set(selected)}
          userDepartments={userDepartments}
          onSelect={(opt) => {
            if (opt.principalType === "user") {
              setSelected((prev) =>
                prev.includes(opt.principalId) ? prev : [...prev, opt.principalId],
              );
            }
          }}
        />

        {/* 선택된 승인자 목록 */}
        {selected.length > 0 ? (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {selected.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-sm border border-hairline px-2 py-1 text-caption text-ink"
              >
                <PrincipalIcon type="user" />
                <span className="min-w-0 flex-1 truncate">
                  {dirName(id)}
                  <span className="text-ink-tertiary"> ({id})</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-sm p-0.5 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                  aria-label={t("perm.removeButton")}
                  onClick={() => setSelected((prev) => prev.filter((x) => x !== id))}
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-1 text-fine text-ink-tertiary">{t("approvers.empty")}</p>
        )}

        {error && <p className="text-fine text-error">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("approvers.cancel")}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
            onClick={() => void handleSave()}
          >
            {t("approvers.save")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
