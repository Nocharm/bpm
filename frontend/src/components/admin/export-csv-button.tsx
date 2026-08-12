"use client";

// 관리자 테이블 CSV 내보내기 버튼 — 행 구성은 호출자(getRows), 클릭 시점 지연 평가.

import { Download } from "lucide-react";

import { buildCsv, downloadCsv } from "@/lib/csv";
import { useI18n } from "@/lib/i18n";

interface ExportCsvButtonProps {
  dataId: string;
  filename: string;
  /** 헤더 포함 전체 행 — 클릭 시점에 구성(테이블 state 최신값). */
  getRows: () => string[][];
  disabled?: boolean;
}

export function ExportCsvButton({ dataId, filename, getRows, disabled }: ExportCsvButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      data-id={dataId}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface-alt disabled:opacity-50"
      onClick={() => downloadCsv(filename, buildCsv(getRows()))}
    >
      <Download size={14} strokeWidth={1.5} />
      {t("admin.exportCsv")}
    </button>
  );
}
