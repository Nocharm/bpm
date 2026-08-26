"use client";

// 승인요청/셀프게시에 동봉할 가시성 변경 선택 — 라벨 + 우측 드롭다운(U2, 설계: pill 행 대체).
// 트리거는 유효 대상(value ?? current) 아이콘+라벨, 메뉴 옵션 중 current 항목엔 "Current" 필.
// 선택=동봉, current 선택(또는 재선택)=해제(null). 다이얼로그/팝오버 내부 렌더이므로 absolute로 충분(포털 불요).

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Globe, Lock } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options: Visibility[] = ["private", "public"];
  const shown = value ?? current;
  const ShownIcon = shown === "public" ? Globe : Lock;
  const label = (v: Visibility) => (v === "public" ? t("perm.visibilityPublic") : t("perm.visibilityPrivate"));

  // 바깥 mousedown(capture)·Esc = 닫힘 — role-popover.tsx와 동일 관용구.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handlePick(v: Visibility) {
    onChange(v === current ? null : value === v ? null : v);
    setOpen(false);
  }

  return (
    <div data-id="visibility-bundle-picker" className="flex w-full items-center justify-between gap-2">
      <p className="text-left text-caption text-ink">{t("approval.bundleVisibilityTitle")}</p>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          data-id="bundle-visibility-trigger"
          aria-expanded={open}
          className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-caption ${
            value != null
              ? "border-accent bg-accent-tint text-accent"
              : "border-hairline text-ink hover:bg-surface-alt"
          }`}
          onClick={() => setOpen((o) => !o)}
        >
          <ShownIcon size={14} strokeWidth={1.5} />
          {label(shown)}
          <ChevronDown size={14} strokeWidth={1.5} />
        </button>
        {open && (
          // w-max — 트리거(ko "공개"처럼 짧음)보다 옵션+Current 필이 넓을 때 메뉴가 콘텐츠 폭으로 커지게.
          // nowrap — 옵션 라벨("비공개")이 필에 밀려 한 글자씩 세로로 꺾이는 것 방지 (ko 실측 버그).
          <div className="absolute right-0 top-full z-[1320] mt-1 w-max min-w-full rounded-md border border-hairline bg-surface p-1 shadow-lg">
            {options.map((v) => {
              const OptIcon = v === "public" ? Globe : Lock;
              return (
                <button
                  key={v}
                  type="button"
                  data-id={v === "public" ? "bundle-opt-public" : "bundle-opt-private"}
                  className={`flex w-full items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-caption hover:bg-surface-alt ${
                    value === v ? "text-accent" : "text-ink"
                  }`}
                  onClick={() => handlePick(v)}
                >
                  <OptIcon size={14} strokeWidth={1.5} className="shrink-0" />
                  {label(v)}
                  {v === current && (
                    <span className="ml-auto shrink-0 rounded-full bg-accent-tint px-1.5 py-px text-fine font-medium text-accent">
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
