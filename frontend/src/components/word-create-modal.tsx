"use client";

// Word 문서로 새 맵 만들기 — 드롭존 + 파싱 요약(2단계). csv-create-modal.tsx의 dialog chrome/
// dropzone/drag-over/버튼 구조를 그대로 미러링하되, 담당자 디렉터리 조회가 필요 없어 그 게이트는 없다.
// [Continue]가 파싱 결과를 CreateMapDialog(D2)로 넘긴다. i18n 키 미배선(section-panel.tsx와 동일
// 관례) — 프로젝트 기본인 영어 하드코딩.
import { useRef, useState } from "react";

import { AlertTriangle, FileUp, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import { parseWordSections, type SectionEntry } from "@/lib/word-import";

export interface WordCreateOutcome {
  docName: string;
  sections: SectionEntry[];
}

export interface WordCreateModalProps {
  onClose: () => void;
  onContinue: (outcome: WordCreateOutcome) => void;
}

export function WordCreateModal({ onClose, onContinue }: WordCreateModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionEntry[] | null>(null);
  const [step, setStep] = useState<"pick" | "summary">("pick");

  const loadFile = async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setError("Please select a .docx file.");
      return;
    }
    setParsing(true);
    try {
      const parsed = await parseWordSections(new Uint8Array(await file.arrayBuffer()));
      setSections(parsed);
      setFileName(file.name);
      setStep("summary");
    } catch (err) {
      // 손상되거나 지원 밖 구조의 .docx — 크래시 대신 재시도를 유도.
      console.warn("word section parse failed", err);
      setError("Could not read this document. Please check the file and try again.");
    } finally {
      setParsing(false);
    }
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

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-ink/20 pt-4 backdrop-blur-sm"
    >
      <div
        data-id="word-create-modal"
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-body-strong text-ink">Create from Word document</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
            aria-label="Cancel"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {step === "pick" ? (
          <>
            <button
              type="button"
              data-id="word-dropzone"
              disabled={parsing}
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
              {parsing ? "Reading document…" : dragOver ? "Drop the .docx file" : "Drop a .docx file here, or click to choose"}
            </button>
            <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={handlePick} />

            {error !== null && (
              <p data-id="word-create-error" className="flex items-start gap-1.5 text-caption text-error">
                <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0" />
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div data-id="word-create-summary" className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-alt px-3 py-2">
              <span className="truncate text-caption-strong text-ink">{fileName}</span>
              {sections !== null && sections.length > 0 ? (
                <p className="text-caption text-ink-secondary">
                  {sections.length} linkable section{sections.length === 1 ? "" : "s"} found.
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-caption text-ink-tertiary">
                  <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0" />
                  No linkable sections found — you can import later.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" data-id="word-create-back" onClick={() => setStep("pick")} className="rounded-sm border border-hairline px-4 py-1.5 text-caption text-ink hover:bg-surface-alt">
                Back
              </button>
              <button
                type="button"
                data-id="word-create-continue"
                onClick={() => onContinue({ docName: fileName!, sections: sections! })}
                className="rounded-sm bg-accent px-4 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );
}
