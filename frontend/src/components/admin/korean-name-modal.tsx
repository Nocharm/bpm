"use client";

// 한글이름 일괄 등록 모달 — 미보유 목록 다운로드 + JSON 임포트(충돌 시 skip/overwrite 확인).
// 설계: docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md

import { FileDown, FileUp, Languages, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  importKoreanNames,
  type EmployeeRow,
  type KoreanNamesImportSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  buildMissingIdsJson,
  classifyKoreanNames,
  parseKoreanNamesJson,
  type KoreanNameClassification,
  type KoreanNameConflict,
} from "@/lib/korean-name-import";
import { useInfiniteSlice } from "@/lib/use-infinite-slice";

const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const BTN_ACCENT =
  "flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40";

interface KoreanNameModalProps {
  rows: EmployeeRow[];
  onClose: () => void;
  /** 적용 성공 후 직원 목록 재조회 */
  onApplied: () => void;
}

type Phase = "idle" | "confirm" | "result";

/** "N users" 호버 시 충돌 목록 툴팁 — 25행 청킹 무한스크롤(직원 ~5000명 대비). */
function ConflictHover({ conflicts }: { conflicts: KoreanNameConflict[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useInfiniteSlice(conflicts, "");
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help font-semibold text-accent underline decoration-dotted">
        {t("admin.krConflictUsers", { n: conflicts.length })}
      </span>
      {open && (
        <div className="absolute left-0 top-full z-10 pt-1">
          <div
            data-id="kr-conflict-tooltip"
            className="max-h-64 w-80 overflow-y-auto rounded-md border border-hairline bg-surface p-2 shadow-lg"
          >
            {visible.map((c) => (
              <div key={c.loginId} className="flex items-baseline gap-2 px-1 py-0.5 text-fine">
                <span className="shrink-0 text-ink-secondary">{c.loginId}</span>
                <span className="truncate text-ink-tertiary">{c.current}</span>
                <span className="shrink-0 text-ink-tertiary">→</span>
                <span className="truncate text-ink">{c.next}</span>
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} className="h-4" />}
          </div>
        </div>
      )}
    </span>
  );
}

export function KoreanNameModal({ rows, onClose, onApplied }: KoreanNameModalProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [classification, setClassification] = useState<KoreanNameClassification | null>(null);
  const [summary, setSummary] = useState<KoreanNamesImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onDownload = () => {
    const blob = new Blob([buildMissingIdsJson(rows)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "korean-names-missing.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const applyImport = async (mode: "skip" | "overwrite", cls: KoreanNameClassification) => {
    setBusy(true);
    setError("");
    try {
      setSummary(await importKoreanNames(mode, cls.entries));
      setPhase("result");
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setError("");
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Failed to read file.");
      return;
    }
    const parsed = parseKoreanNamesJson(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const cls = classifyKoreanNames(parsed.entries, rows);
    setClassification(cls);
    if (cls.conflicts.length > 0) {
      setPhase("confirm");
    } else {
      await applyImport("skip", cls); // 충돌 0 — 확인 없이 바로 적용(모드 무의미)
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
        data-id="korean-name-modal"
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Languages size={16} strokeWidth={1.5} className="text-accent" />
          <h2 className="text-body-strong text-ink">{t("admin.krTitle")}</h2>
        </div>

        {phase === "idle" && (
          <>
            <p className="text-caption text-ink-tertiary">{t("admin.krHint")}</p>
            <div className="rounded-sm bg-surface-alt p-3">
              <p className="pb-1 text-fine uppercase tracking-wide text-ink-tertiary">
                {t("admin.krSchema")}
              </p>
              <pre className="overflow-x-auto text-fine text-ink-secondary">{`[
  { "userId": "hong.gd", "status": "found",
    "name": "홍길동", "dept": "AI Operations그룹" }
]`}</pre>
              {/* status가 found가 아닌 항목(not_found·error)은 무시된다 */}
              <p className="pt-1 text-fine text-ink-tertiary">{t("admin.krSchemaAlt")}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" data-id="kr-download-btn" className={BTN_SECONDARY} onClick={onDownload}>
                <FileDown size={16} strokeWidth={1.5} />
                {t("admin.krDownload")}
              </button>
              <button
                type="button"
                data-id="kr-import-btn"
                className={BTN_ACCENT}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={16} strokeWidth={1.5} />
                {t("admin.krImport")}
              </button>
              <input
                ref={fileRef}
                data-id="kr-file-input"
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

        {phase === "confirm" && classification && (
          <div className="flex flex-col gap-3" data-id="kr-conflict-step">
            <div className="flex items-start gap-2 rounded-sm bg-surface-alt p-3">
              <TriangleAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-error" />
              {/* div(not p) — 툴팁 div가 p 자손이면 invalid nesting(validateDOMNesting 경고) */}
              <div className="text-caption text-ink">
                <ConflictHover conflicts={classification.conflicts} />{" "}
                {t("admin.krConflictRest")}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-id="kr-conflict-cancel"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => setPhase("idle")}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="kr-skip-all"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => void applyImport("skip", classification)}
              >
                {t("admin.krSkipAll")}
              </button>
              <button
                type="button"
                data-id="kr-overwrite-all"
                className={BTN_ACCENT}
                disabled={busy}
                onClick={() => void applyImport("overwrite", classification)}
              >
                {t("admin.krOverwriteAll")}
              </button>
            </div>
          </div>
        )}

        {phase === "result" && summary && (
          <div className="flex flex-col gap-2" data-id="kr-result">
            <div className="rounded-sm bg-surface-alt p-3 text-caption text-ink">
              <p>
                {t("admin.krUpdated")}: {summary.updated} · {t("admin.krSkipped")}: {summary.skipped}
              </p>
              {summary.unknown.length > 0 && (
                <div className="pt-1">
                  <p className="text-caption text-error">
                    {t("admin.krUnknown")} ({summary.unknown.length})
                  </p>
                  <div className="max-h-32 overflow-y-auto pt-1 text-fine text-ink-tertiary">
                    {summary.unknown.map((id) => (
                      <p key={id}>{id}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-caption text-error">{error}</p>}

        {phase !== "confirm" && (
          <div className="flex justify-end border-t border-hairline pt-3">
            <button
              type="button"
              data-id="kr-close-btn"
              className={BTN_SECONDARY}
              disabled={busy}
              onClick={onClose}
            >
              {phase === "result" ? t("admin.krClose") : t("common.cancel")}
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
