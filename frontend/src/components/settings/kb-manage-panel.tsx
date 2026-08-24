"use client";

// 설정 · 지식기반 라이브러리(P2) — sysadmin 문서 업로드/목록/삭제. 파싱은 업로드 응답에 반영되고
// 임베딩 인덱싱은 백그라운드(chunk_count>0이면 검색 가능 상태) — AI 컨설턴트가 참조로 활용.

import { FileUp, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  deleteKbDocument,
  getApiErrorDetail,
  listKbDocuments,
  uploadKbDocument,
  type KbDocument,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { ConfirmDialog } from "@/components/confirm-dialog";

const ACCEPT = ".pdf,.docx,.xlsx,.txt,.md";

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function KbManagePanel({ onToast }: { onToast: (message: string) => void }) {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<KbDocument | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setDocs(await listKbDocuments());
  };

  useEffect(() => {
    let alive = true;
    void listKbDocuments().then((rows) => {
      if (alive) setDocs(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setBusy(true);
    try {
      const doc = await uploadKbDocument(file);
      await refresh();
      onToast(
        doc.status === "parsed"
          ? "Document uploaded - indexing runs in the background."
          : "Uploaded, but the file could not be parsed.",
      );
    } catch (err) {
      onToast(getApiErrorDetail(err) || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteKbDocument(pendingDelete.id);
      await refresh();
      onToast("Document deleted.");
    } catch (err) {
      onToast(getApiErrorDetail(err) || "Delete failed.");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-id="kb-manage-panel">
      <header className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-strong text-ink">Knowledge base library</h2>
          <p className="text-caption text-ink-muted">
            Organization documents the AI consultant can cite during interviews. Supported: pdf,
            docx, xlsx, txt, md (max 20MB).
          </p>
        </div>
        <button className={OUTLINE_BTN} onClick={() => void refresh()} data-id="kb-refresh">
          <RefreshCw size={16} strokeWidth={1.5} />
          Refresh
        </button>
        <button
          className={OUTLINE_BTN}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          data-id="kb-upload"
        >
          <FileUp size={16} strokeWidth={1.5} />
          {busy ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => void handleFile(event)}
          data-id="kb-file-input"
        />
      </header>
      {docs.length === 0 ? (
        <p className="rounded-sm border border-hairline bg-surface-alt px-3 py-4 text-caption text-ink-muted">
          No documents yet - upload SOPs or guides to ground the AI consultant.
        </p>
      ) : (
        <ul className="divide-y divide-hairline rounded-sm border border-hairline">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-3 py-2" data-id="kb-doc-row">
              <div className="min-w-0 flex-1">
                <div className="truncate text-caption-strong text-ink">{doc.filename}</div>
                <div className="text-fine text-ink-muted">
                  {doc.uploaded_by} · {formatKstShort(doc.created_at)}
                </div>
              </div>
              <span
                className={
                  "shrink-0 rounded-xs px-1.5 py-0.5 text-fine " +
                  (doc.status === "failed"
                    ? "bg-error/10 text-error"
                    : doc.chunk_count > 0
                      ? "bg-accent-tint text-accent"
                      : "bg-surface-alt text-ink-muted")
                }
              >
                {doc.status === "failed"
                  ? "Parse failed"
                  : doc.chunk_count > 0
                    ? `Indexed (${doc.chunk_count})`
                    : "Indexing…"}
              </span>
              <button
                className="shrink-0 rounded-xs p-1 text-ink-muted hover:text-error"
                onClick={() => setPendingDelete(doc)}
                title="Delete"
                data-id="kb-doc-delete"
              >
                <Trash2 size={16} strokeWidth={1.5} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pendingDelete ? (
        <ConfirmDialog
          title="Delete this document?"
          message={`'${pendingDelete.filename}' will be removed from the knowledge base along with its search index.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={() => {
            void handleDelete();
          }}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </section>
  );
}
