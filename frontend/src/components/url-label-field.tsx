"use client";

// URL+라벨 공용 편집 필드 — 담당자 칩과 같은 필 2행 (url-label design 2026-07-07).
// URL 행 X = URL·라벨 동시 삭제, 라벨 행은 URL 있을 때만 노출되고 X = 라벨만 삭제.
// 입력은 드래프트 → blur/Enter 커밋(수정은 삭제 후 재입력 — 칩 관용).

import { X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";

const PILL_CLASS =
  "flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink";
const READONLY_INPUT_CLASS =
  "min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-right text-caption text-ink focus:outline-none";

export function UrlLabelField({
  url,
  urlLabel,
  readOnly,
  inputWidth = "w-32",
  onChange,
}: {
  url: string;
  urlLabel: string;
  readOnly: boolean;
  // 편집 입력 통일 폭 — 인스펙터 w-32(기본), 편집 모달 w-44 (사용자 결정 2026-08-20)
  inputWidth?: string;
  onChange: (patch: { url?: string; urlLabel?: string }) => void;
}) {
  const { t } = useI18n();
  // 편집 가능이면 입력 영역 상시 노출 + 통일 폭 + 포커스 보더 (사용자 결정 2026-08-20)
  const inputClass = readOnly
    ? READONLY_INPUT_CLASS
    : `${inputWidth} shrink-0 truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-right text-caption text-ink focus:border-accent focus:outline-none`;
  const [urlDraft, setUrlDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");

  const commitUrl = () => {
    const value = urlDraft.trim();
    if (value) onChange({ url: value });
    setUrlDraft("");
  };
  const commitLabel = () => {
    const value = labelDraft.trim();
    if (value) onChange({ urlLabel: value });
    setLabelDraft("");
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
        <span className="shrink-0 text-caption text-ink-secondary">{t("field.url")}</span>
        {url ? (
          <span data-id="url-field-pill" className={PILL_CLASS} title={url}>
            <span className="truncate">{url}</span>
            {!readOnly && (
              <button
                type="button"
                data-id="url-field-remove"
                aria-label={t("urlField.removeUrl")}
                onClick={() => onChange({ url: "", urlLabel: "" })}
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            )}
          </span>
        ) : (
          <input
            data-id="url-field-input"
            className={inputClass}
            placeholder={t("urlField.addUrl")}
            maxLength={500}
            disabled={readOnly}
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onBlur={commitUrl}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitUrl();
            }}
          />
        )}
      </div>
      {url.trim() !== "" && (
        /* 링크 라벨 — URL의 하위 항목: 한 단 더 들여쓰기 + 축소 글자 (사용자 결정 2026-08-20) */
        <div className="ml-2 flex items-center justify-between gap-2 border-l border-divider py-0.5 pl-2">
          <span className="shrink-0 text-fine text-ink-tertiary">{t("field.urlLabel")}</span>
          {urlLabel ? (
            <span data-id="url-label-pill" className={PILL_CLASS} title={urlLabel}>
              <span className="truncate">{urlLabel}</span>
              {!readOnly && (
                <button
                  type="button"
                  data-id="url-label-remove"
                  aria-label={t("urlField.removeLabel")}
                  onClick={() => onChange({ urlLabel: "" })}
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </span>
          ) : (
            <input
              data-id="url-label-input"
              className={`${inputClass} !text-fine`}
              placeholder={t("urlField.addLabel")}
              maxLength={100}
              disabled={readOnly}
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitLabel();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
