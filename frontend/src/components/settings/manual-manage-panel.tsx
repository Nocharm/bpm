"use client";

// 설정 · 매뉴얼 편집·게시 — 포맷 토글(마크다운/HTML)·.md 업로드·배포본 불러오기·미리보기·게시. sysadmin.
// 게시(putManual)는 단일 게시본 upsert → /manual 뷰어에 즉시 반영. (design 2026-07-05, 시안 New Screens.html 3c)

import { Eye, Pencil, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getManual, putManual, type ManualDoc } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useDirectory } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { HtmlView } from "@/components/html-view";
import { MarkdownView } from "@/components/markdown-view";

type Format = ManualDoc["format"];

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 " +
  "text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function ManualManagePanel({ onToast }: { onToast: (message: string) => void }) {
  const { t } = useI18n();
  const dir = useDirectory();
  const [format, setFormat] = useState<Format>("markdown");
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<Pick<ManualDoc, "updated_at" | "updated_by">>({
    updated_at: null,
    updated_by: null,
  });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    getManual().then((doc) => {
      if (!alive) return;
      setFormat(doc.format);
      setContent(doc.content);
      setMeta({ updated_at: doc.updated_at, updated_by: doc.updated_by });
    });
    return () => {
      alive = false;
    };
  }, []);

  // 업로드된 .md 파일 → 편집기(게시는 별도). 같은 파일 재선택 위해 value 리셋.
  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setContent(await file.text());
    setFormat("markdown");
    setPreview(false);
    onToast(t("manual.manage.uploadedToast"));
  };

  // 배포 포함 manual.md 원문을 편집기로(게시본을 배포 기본값으로 되돌릴 때).
  const loadBundled = async () => {
    const doc = await getManual(true);
    setContent(doc.content);
    setFormat(doc.format);
    setPreview(false);
    onToast(t("manual.manage.loadedToast"));
  };

  const publish = async () => {
    setBusy(true);
    try {
      const doc = await putManual(format, content);
      setMeta({ updated_at: doc.updated_at, updated_by: doc.updated_by });
      onToast(t("manual.manage.publishedToast"));
    } finally {
      setBusy(false);
    }
  };

  const authorName = meta.updated_by ? (dir.get(meta.updated_by)?.name ?? meta.updated_by) : null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 헤더 — 타이틀·부제(좌) + 포맷 토글 · 툴바(우) */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-body-strong text-ink">{t("manual.manage.title")}</h2>
            <p className="text-fine text-ink-tertiary">
              {meta.updated_at
                ? `${t("manual.manage.published")} · ${authorName} · ${formatKstShort(meta.updated_at)}`
                : t("manual.manage.bundledSource")}
            </p>
          </div>

          {/* 포맷 세그먼트 — 피드백 유형 세그먼트와 동일 디자인 */}
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
            disabled={busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => void publish()}
          >
            {t("manual.manage.publish")}
          </button>
        </div>
      </div>

      {/* 편집기 / 미리보기 — 파일명 라벨바 + 본문 */}
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
    </div>
  );
}
