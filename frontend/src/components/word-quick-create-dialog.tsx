"use client";

// Word 맵 빠른 생성 — 파싱 결과에서 이름만 확인, 오우닝 부서=내 org_path·승인자=본인 자동.
// 설계: docs/design/2026-07-24-word-map-lifecycle-design.md §3. 영어 하드코딩(word-create-modal 관례).
import { useRef, useState } from "react";

import { FileText, X } from "lucide-react";

import { ModalBackdrop } from "@/components/modal-backdrop";
import type { WordCreateOutcome } from "@/components/word-create-modal";
import { createMap, setApprovers, type MapDetail } from "@/lib/api";

interface WordQuickCreateDialogProps {
  outcome: WordCreateOutcome;
  /** 자동 오우닝 부서 — 내 org_path(루트→리프, design §3). org_path 없는 유저는 이 다이얼로그 대신 CreateMapDialog 폴백. */
  owningDepartment: string;
  approverId: string;
  onClose: () => void;
  onCreated: (detail: MapDetail) => void;
  /** 부분 실패(맵은 생성됨) 시 목록 갱신 — create-map-dialog onCreated(true) 선례 */
  onPartialCreate?: () => void;
}

export function WordQuickCreateDialog({
  outcome,
  owningDepartment,
  approverId,
  onClose,
  onCreated,
  onPartialCreate,
}: WordQuickCreateDialogProps) {
  const [name, setName] = useState(outcome.docName.replace(/\.docx$/i, ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 부분 실패 재시도 시 맵 재생성(이름 409) 방지 — create-map-dialog의 createdRef 관례
  const createdRef = useRef<MapDetail | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (createdRef.current === null) {
        createdRef.current = await createMap(trimmed, "", "private", owningDepartment, {
          docName: outcome.docName,
          sections: outcome.sections,
        });
      }
      await setApprovers(createdRef.current.id, [approverId]); // 멱등 PUT — 재시도 안전
      onCreated(createdRef.current);
    } catch (err) {
      // Partial failure: map created but approvers step failed. Refresh parent list silently.
      if (createdRef.current !== null) {
        onPartialCreate?.();
      }
      setError(err instanceof Error ? err.message : "Failed to create map.");
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-start justify-center bg-ink/20 pt-4 backdrop-blur-sm"
    >
      <div
        data-id="word-quick-create"
        className="w-[26rem] rounded-sm border border-hairline bg-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <FileText size={16} strokeWidth={1.5} className="text-ink-muted" />
          <h2 className="flex-1 text-body-strong text-ink">New Word document map</h2>
          <button
            type="button"
            data-id="word-quick-create-close"
            aria-label="Close"
            onClick={onClose}
            className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mb-2 truncate text-fine text-ink-muted">
          {outcome.docName} · {outcome.sections.length} sections
        </p>
        <input
          data-id="word-quick-create-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
          placeholder="Map name"
        />
        {error && <p className="mb-2 text-fine text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            data-id="word-quick-create-submit"
            disabled={!name.trim() || submitting}
            onClick={() => void handleCreate()}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
