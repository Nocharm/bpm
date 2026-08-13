"use client";

// 승인요청/셀프게시에 동봉할 가시성 변경 선택 — 체크박스 대체(사용자 지시: "맵 탭처럼 공개>비공개 버튼식").
// 맵 설정 visibility-control의 pill과 동일 시각 패턴. 반대쪽 클릭=선택, 선택된 쪽 재클릭 또는 current 클릭=해제(null).

import { useI18n } from "@/lib/i18n";

type Visibility = "public" | "private";

interface VisibilityBundlePickerProps {
  /** 현재(서버 진실) 가시성 — 선택 불필요를 나타내는 기준점, 클릭 시 항상 해제. */
  current: Visibility;
  value: Visibility | null;
  onChange: (next: Visibility | null) => void;
}

export function VisibilityBundlePicker({ current, value, onChange }: VisibilityBundlePickerProps) {
  const { t } = useI18n();
  const options: Visibility[] = ["private", "public"];

  function handleClick(v: Visibility) {
    onChange(v === current ? null : value === v ? null : v);
  }

  return (
    <div data-id="visibility-bundle-picker" className="flex flex-col gap-1.5 self-start">
      <p className="text-caption text-ink">{t("approval.bundleVisibilityTitle")}</p>
      <div className="flex items-center gap-1.5">
        {options.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            className={`rounded-sm border px-2.5 py-1 text-caption ${
              value === v
                ? "border-accent bg-accent-tint text-accent"
                : "border-hairline text-ink hover:bg-surface-alt"
            }`}
            onClick={() => handleClick(v)}
          >
            {v === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate")}
            {v === current ? ` · ${t("perm.visibilityCurrent")}` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
