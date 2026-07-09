"use client";

// 부서 정보(한글 부서명·부서장) JSON 임포트 모달 — 부서 탭용. 다운로드·충돌 단계 없음(항상 덮어쓰기).
// 필드명은 임시(dept/koreanName/manager) — 실제 소스 키 확정 시 lib/dept-info-import.ts 상수만 변경.

import { Building2, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { importDeptInfo, type DeptInfoImportSummary } from "@/lib/api";
import { DEPT_INFO_EXAMPLE, parseDeptInfoJson } from "@/lib/dept-info-import";
import { useI18n } from "@/lib/i18n";

const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const BTN_ACCENT =
  "flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface DeptInfoModalProps {
  onClose: () => void;
  onApplied: () => void;
}

export function DeptInfoModal({ onClose, onApplied }: DeptInfoModalProps) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<DeptInfoImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    setError("");
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Failed to read file.");
      return;
    }
    const parsed = parseDeptInfoJson(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      setSummary(await importDeptInfo(parsed.entries));
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
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
        data-id="dept-info-modal"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Building2 size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-body-strong text-ink">{t("admin.deptInfoTitle")}</h2>
        </div>

        {!summary && (
          <>
            <p className="text-caption text-ink-tertiary">{t("admin.deptInfoHint")}</p>
            <div className="rounded-sm bg-surface-alt p-3">
              <p className="pb-1 text-fine uppercase tracking-wide text-ink-tertiary">
                {t("admin.krSchema")}
              </p>
              <pre className="overflow-x-auto text-fine text-ink-secondary">{DEPT_INFO_EXAMPLE}</pre>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                data-id="dept-info-import-btn"
                className={BTN_ACCENT}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={16} strokeWidth={1.5} />
                {t("admin.krImport")}
              </button>
              <input
                ref={fileRef}
                data-id="dept-info-file-input"
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // 같은 파일 재선택 허용
                  if (file) void onFile(file);
                }}
              />
            </div>
          </>
        )}

        {summary && (
          <div className="rounded-sm bg-surface-alt p-3 text-caption text-ink" data-id="dept-info-result">
            <p>
              {t("admin.krUpdated")}: {summary.updated}
            </p>
            {summary.unknown.length > 0 && (
              <div className="pt-1">
                <p className="text-caption text-error">
                  {t("admin.deptInfoUnknown")} ({summary.unknown.length})
                </p>
                <div className="max-h-32 overflow-y-auto pt-1 text-fine text-ink-tertiary">
                  {summary.unknown.map((name) => (
                    <p key={name}>{name}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-caption text-error">{error}</p>}

        <div className="flex justify-end border-t border-hairline pt-3">
          <button
            type="button"
            data-id="dept-info-close-btn"
            className={BTN_SECONDARY}
            disabled={busy}
            onClick={onClose}
          >
            {summary ? t("admin.krClose") : t("common.cancel")}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
