"use client";

// 설정 · 매뉴얼 편집·게시 — 다중 문서(F10): 목록(제목 자동 추출·한/영) + 편집기(포맷·언어·업로드·미리보기·저장·삭제).
// 제목은 저장 시 서버가 본문 첫 헤딩에서 추출. 뷰어(/manual)는 현재 한/영 토글에 맞는 목록만 노출. sysadmin.

import { Eye, FilePlus2, Pencil, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  createManualDoc,
  deleteManualDoc,
  getManual,
  getManualDoc,
  listManualDocs,
  updateManualDoc,
  type ManualDoc,
  type ManualDocSummary,
  type ManualLang,
} from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HtmlView } from "@/components/html-view";
import { MarkdownView } from "@/components/markdown-view";

type Format = ManualDoc["format"];

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function ManualManagePanel({ onToast }: { onToast: (message: string) => void }) {
  const { t } = useI18n();
  const dir = useDirectory();
  const [docs, setDocs] = useState<ManualDocSummary[]>([]);
  // 편집 대상 — null이면 새 문서 작성 중
  const [editingId, setEditingId] = useState<number | null>(null);
  const [language, setLanguage] = useState<ManualLang>("ko");
  const [format, setFormat] = useState<Format>("markdown");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ManualDocSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshDocs = async () => {
    setDocs(await listManualDocs());
  };

  useEffect(() => {
    let alive = true;
    void listManualDocs().then((rows) => {
      if (alive) setDocs(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const startNew = () => {
    setEditingId(null);
    setLanguage("ko");
    setFormat("markdown");
    setContent("");
    setPreview(false);
  };

  const openDoc = async (docId: number) => {
    const doc = await getManualDoc(docId);
    setEditingId(doc.id);
    setLanguage(doc.language);
    setFormat(doc.format);
    setContent(doc.content);
    setPreview(false);
  };

  // 업로드된 .md 파일 → 편집기(저장은 별도). 같은 파일 재선택 위해 value 리셋.
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setContent(await file.text());
    setFormat("markdown");
    setPreview(false);
    onToast(t("manual.manage.uploadedToast"));
  };

  // 배포 포함 manual.md 원문을 편집기로(기본 매뉴얼을 문서로 등록할 때).
  const loadBundled = async () => {
    const doc = await getManual(true);
    setContent(doc.content);
    setFormat(doc.format);
    setPreview(false);
    onToast(t("manual.manage.loadedToast"));
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved =
        editingId === null
          ? await createManualDoc({ language, format, content })
          : await updateManualDoc(editingId, { language, format, content });
      setEditingId(saved.id);
      await refreshDocs();
      onToast(t("manual.manage.publishedToast"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteManualDoc(pendingDelete.id);
    if (editingId === pendingDelete.id) startNew();
    setPendingDelete(null);
    await refreshDocs();
    onToast(t("manual.manage.deletedToast"));
  };

  const authorOf = (loginId: string | null) =>
    loginId ? (dir.get(loginId)?.name ?? loginId) : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 문서 목록 — 제목(자동 추출)·언어·수정 정보. 클릭=편집, 휴지통=삭제 */}
      <div data-id="manual-docs-list" className="flex flex-col gap-1 rounded-sm border border-hairline p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-caption-strong text-ink">{t("manual.manage.docs")}</span>
          <button type="button" className={OUTLINE_BTN} onClick={startNew}>
            <FilePlus2 size={14} strokeWidth={1.5} />
            {t("manual.manage.newDoc")}
          </button>
        </div>
        {docs.length === 0 ? (
          <p className="px-1 py-2 text-caption text-ink-tertiary">{t("manual.manage.noDocs")}</p>
        ) : (
          docs.map((doc) => (
            <div
              key={doc.id}
              className={
                "group flex items-center gap-2 rounded-sm px-2 py-1.5 " +
                (doc.id === editingId ? "bg-accent-tint" : "hover:bg-surface-alt")
              }
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => void openDoc(doc.id)}
              >
                <span
                  className={
                    "shrink-0 rounded-xs border px-1.5 py-0.5 text-fine " +
                    (doc.language === "ko"
                      ? "border-accent-tint-border bg-accent-tint text-accent"
                      : "border-hairline bg-surface-alt text-ink-secondary")
                  }
                >
                  {doc.language === "ko" ? t("manual.manage.langKo") : t("manual.manage.langEn")}
                </span>
                <span className="min-w-0 truncate text-caption text-ink">{doc.title || t("manual.manage.untitled")}</span>
                {doc.updated_at && (
                  <span className="shrink-0 text-fine text-ink-tertiary">
                    {authorOf(doc.updated_by)} · {formatKstShort(doc.updated_at)}
                  </span>
                )}
              </button>
              {/* 삭제 — 행 호버 시에만 노출 (F11) */}
              <button
                type="button"
                className="shrink-0 rounded-xs p-1 text-ink-tertiary opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                title={t("manual.manage.delete")}
                aria-label={t("manual.manage.delete")}
                onClick={() => setPendingDelete(doc)}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* 편집 헤더 — 신규/수정 라벨 + 포맷·언어 세그먼트(좌) · 툴바(우) */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-body-strong text-ink">
              {editingId === null ? t("manual.manage.newDoc") : t("manual.manage.title")}
            </h2>
            <p className="text-fine text-ink-tertiary">{t("manual.manage.titleAuto")}</p>
          </div>

          {/* 포맷 세그먼트 */}
          <div className="grid grid-cols-2 gap-1 rounded-sm bg-surface-alt p-1">
            {(["markdown", "html"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={format === value}
                onClick={() => {
                  setFormat(value);
                  setPreview(false);
                }}
                className={
                  "rounded-xs px-3 py-1 text-caption transition-colors " +
                  (format === value
                    ? "bg-surface text-accent shadow-sm"
                    : "text-ink-tertiary hover:text-ink")
                }
              >
                {t(value === "markdown" ? "manual.manage.formatMd" : "manual.manage.formatHtml")}
              </button>
            ))}
          </div>

          {/* 언어 세그먼트 — 저장 전 한/영 선택, 뷰어는 토글 상태에 맞는 목록만 노출 (F10) */}
          <div data-id="manual-language-segment" className="grid grid-cols-2 gap-1 rounded-sm bg-surface-alt p-1">
            {(["ko", "en"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
                onClick={() => setLanguage(value)}
                className={
                  "rounded-xs px-3 py-1 text-caption transition-colors " +
                  (language === value
                    ? "bg-surface text-accent shadow-sm"
                    : "text-ink-tertiary hover:text-ink")
                }
              >
                {t(value === "ko" ? "manual.manage.langKo" : "manual.manage.langEn")}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => void handleFile(event)}
          />
          <button type="button" className={OUTLINE_BTN} onClick={() => fileRef.current?.click()}>
            <Upload size={14} strokeWidth={1.5} />
            {t("manual.manage.upload")}
          </button>
          <button type="button" className={OUTLINE_BTN} onClick={() => void loadBundled()}>
            {t("manual.manage.loadBundled")}
          </button>
          <button
            type="button"
            aria-pressed={preview}
            className={
              OUTLINE_BTN + (preview ? " bg-accent-tint text-accent hover:bg-accent-tint" : "")
            }
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? (
              <Pencil size={14} strokeWidth={1.5} />
            ) : (
              <Eye size={14} strokeWidth={1.5} />
            )}
            {preview ? t("manual.manage.edit") : t("manual.manage.preview")}
          </button>
          <button
            type="button"
            disabled={busy || content.trim() === ""}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => void save()}
          >
            {t("manual.manage.publish")}
          </button>
        </div>
      </div>

      {/* 편집기 / 미리보기 */}
      <div className="flex min-h-0 flex-1 flex-col rounded-sm border border-hairline">
        <div className="shrink-0 border-b border-hairline bg-surface-alt px-3 py-1.5 font-mono text-fine text-ink-tertiary">
          {t("manual.manage.editorLabel")}
        </div>
        {preview ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {content.trim() === "" ? (
              <p className="text-caption text-ink-tertiary">{t("manual.manage.emptyPreview")}</p>
            ) : format === "html" ? (
              <HtmlView source={content} />
            ) : (
              <MarkdownView source={content} />
            )}
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
            placeholder={t("manual.manage.editorPlaceholder")}
            className="min-h-0 flex-1 resize-none rounded-b-sm bg-surface px-5 py-4 font-mono text-caption leading-relaxed text-ink outline-none"
          />
        )}
      </div>

      {/* 삭제 확인 */}
      {pendingDelete && (
        <ConfirmDialog
          icon={<Trash2 size={28} strokeWidth={1.5} />}
          title={t("manual.manage.deleteTitle")}
          message={pendingDelete.title || t("manual.manage.untitled")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => void confirmDelete()}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
