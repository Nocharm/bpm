"use client";

// CSV로 새 맵 만들기 — 드롭존 + 준비 액션 + 파싱 요약(2단계). [계속]이 파싱 결과를 CreateMapDialog로 넘긴다.
// 생성 시점엔 버전이 없어 listEligibleAssignees를 못 쓴다 → getDirectory()로 담당자/부서를 해석한다.
// 디렉터리 로드 전에는 [확인]을 막는다 — 같은 CSV가 로드 타이밍에 따라 다르게 해석되면 안 된다.
import { useEffect, useRef, useState } from "react";

import { AlertTriangle, FileUp, X } from "lucide-react";

import { CsvTemplateActions } from "@/components/csv-template-actions";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { getDirectory, getMe } from "@/lib/api";
import {
  buildGraphFromCsv,
  decodeCsvBuffer,
  toCsvDirectory,
  type CsvDirectory,
  type CsvImportOutcome,
} from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface Props {
  onClose: () => void;
  onContinue: (outcome: CsvImportOutcome, fileName: string) => void;
}

export function CsvCreateModal({ onClose, onContinue }: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [directory, setDirectory] = useState<CsvDirectory | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [csvManualUrl, setCsvManualUrl] = useState("");
  const [outcome, setOutcome] = useState<CsvImportOutcome | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<"pick" | "summary">("pick");

  useEffect(() => {
    let alive = true;
    // 디렉터리는 담당자 해석에 필수 — 실패는 사용자에게 보이고 [확인]을 막는다
    void getDirectory()
      .then((dir) => {
        if (alive) setDirectory(toCsvDirectory(dir));
      })
      .catch((err) => {
        console.warn("directory fetch failed", err);
        if (alive) setLoadError(true);
      });
    // 매뉴얼 URL은 안내 버튼 표시용일 뿐 — 실패해도 버튼만 숨기고 모달은 살린다
    void getMe()
      .then((me) => {
        if (alive) setCsvManualUrl(me.csv_manual_url);
      })
      .catch((err) => {
        console.warn("me fetch failed; csv manual button hidden", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadFile = async (file: File) => {
    if (directory === null) return;
    const text = decodeCsvBuffer(await file.arrayBuffer());
    setOutcome(buildGraphFromCsv(text, { directory }));
    setFileName(file.name);
    setStep("pick");
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // 같은 파일 재선택을 허용하기 위해 input value 리셋
  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadFile(file);
  };

  const parsedOk = outcome?.graph != null && outcome.errors.length === 0;
  const canConfirm = parsedOk && directory !== null;
  // 디렉터리 로드 중 — 드롭존을 비활성하고 로딩 문구로 클릭/드롭이 조용히 무시되지 않게
  const directoryLoading = directory === null && !loadError;

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-ink/20 pt-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 rounded-md bg-surface p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">{t("csvImport.createModalTitle")}</h2>
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt" aria-label={t("common.cancel")}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {loadError && (
          <p className="flex items-start gap-1.5 text-caption text-error">
            <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0" />
            {t("csvImport.directoryFailed")}
          </p>
        )}

        {step === "pick" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CsvTemplateActions manualUrl={csvManualUrl} />
            </div>

            <button
              type="button"
              data-id="csv-dropzone"
              disabled={directoryLoading}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center gap-2 rounded-sm border border-dashed px-4 py-10 text-caption disabled:opacity-40 ${
                dragOver ? "border-accent bg-accent-tint text-accent" : "border-hairline text-ink-tertiary hover:bg-surface-alt"
              }`}
            >
              <FileUp size={16} strokeWidth={1.5} />
              {directoryLoading
                ? t("csvImport.dropzoneLoading")
                : dragOver
                  ? t("csvImport.dropzoneActive")
                  : t("csvImport.dropzone")}
              {fileName !== null && <span className="text-caption-strong text-ink">{fileName}</span>}
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handlePick} />

            {outcome !== null && outcome.errors.length > 0 && (
              <ul data-id="csv-create-errors" className="flex flex-col gap-0.5">
                {outcome.errors.slice(0, 10).map((err) => (
                  <li key={`${err.line}-${err.message}`} className="text-caption text-error">
                    {t("csvImport.rowError", { line: err.line, message: err.message })}
                  </li>
                ))}
                {outcome.errors.length > 10 && (
                  <li className="text-caption text-ink-tertiary">{t("csvImport.moreErrors", { n: outcome.errors.length - 10 })}</li>
                )}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="csv-create-confirm"
                disabled={!canConfirm}
                onClick={() => setStep("summary")}
                className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
              >
                {t("common.confirm")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div data-id="csv-create-summary" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt px-3 py-2">
              <span className="truncate text-caption-strong text-ink">{fileName}</span>
              <p className="text-caption text-ink-secondary">
                {t("csvImport.createSummary", { nodes: outcome!.nodeCount, edges: outcome!.edgeCount })}
              </p>
              {outcome!.warnings.map((warn) => (
                <p key={`${warn.line}-${warn.message}`} className="text-caption text-ink-tertiary">
                  {t("csvImport.rowWarning", { line: warn.line, message: warn.message })}
                </p>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" data-id="csv-create-back" onClick={() => setStep("pick")} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                {t("csvImport.back")}
              </button>
              <button
                type="button"
                data-id="csv-create-continue"
                onClick={() => onContinue(outcome!, fileName!)}
                className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
              >
                {t("csvImport.continue")}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
