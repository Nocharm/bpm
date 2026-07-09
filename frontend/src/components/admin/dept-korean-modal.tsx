"use client";

// 부서 한글명 매핑 모달 — 후보 선택 또는 직접 입력 → 부서 전원 korean_dept 덮어쓰기.
// 설계: docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md

import { Building2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { setDeptKoreanDept, type AdminDept } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { DeptKoreanCandidate } from "@/lib/korean-dept";

const BTN_SECONDARY =
  "rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const BTN_ACCENT =
  "rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface DeptKoreanModalProps {
  dept: AdminDept;
  candidates: DeptKoreanCandidate[];
  onClose: () => void;
  /** 적용 성공 후 디렉터리 재조회 */
  onApplied: () => void;
}

export function DeptKoreanModal({ dept, candidates, onClose, onApplied }: DeptKoreanModalProps) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);

  const onApply = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await setDeptKoreanDept(dept.org_levels, value.trim());
      setUpdated(res.updated);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "apply failed");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <ModalBackdrop
      onClose={() => {
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="dept-korean-modal"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Building2 size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-body-strong text-ink">{t("admin.deptKrTitle")}</h2>
        </div>
        <p className="text-caption text-ink-secondary">{dept.org_levels.join(" / ")}</p>

        {updated === null ? (
          <>
            <p className="text-caption text-ink-tertiary">{t("admin.deptKrHint")}</p>
            {candidates.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    data-id="dept-kr-candidate"
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-fine ${
                      value === c.value
                        ? "border-accent bg-accent-tint text-accent"
                        : "border-hairline text-ink-secondary hover:bg-surface-alt"
                    }`}
                    onClick={() => setValue(c.value)}
                  >
                    {c.value}
                    <span className="text-ink-tertiary">{c.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-fine text-ink-tertiary">{t("admin.deptKrNoCandidates")}</p>
            )}
            <input
              data-id="dept-kr-input"
              type="text"
              value={value}
              maxLength={200}
              placeholder={t("admin.deptKrInputPlaceholder")}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
            />
            {error && <p className="text-caption text-error">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-hairline pt-3">
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="dept-kr-apply"
                className={BTN_ACCENT}
                disabled={busy || !value.trim()}
                onClick={() => void onApply()}
              >
                {t("admin.deptKrApply")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p data-id="dept-kr-result" className="rounded-sm bg-surface-alt p-3 text-caption text-ink">
              {t("admin.deptKrUpdated", { n: updated })}
            </p>
            <div className="flex justify-end border-t border-hairline pt-3">
              <button type="button" data-id="dept-kr-close" className={BTN_SECONDARY} onClick={onClose}>
                {t("admin.krClose")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
