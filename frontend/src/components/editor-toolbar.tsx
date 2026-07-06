"use client";

// 편집 툴바 — 메인 상단바 아래 두 번째 바. 편집 모드(!readOnly)일 때만 노출(page.tsx에서 게이팅).
// 편집 기능 위주: ＋노드 메뉴 · 자동 정렬(dagre) · 정렬/분배. 핸들러는 page.tsx로 위임.
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BookOpen,
  FileUp,
  Network,
} from "lucide-react";
import { type ComponentType } from "react";

import { AddNodeMenu } from "@/components/add-node-menu";
import { type ProcessNodeType } from "@/lib/canvas";
import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";

type AlignAxis = "left" | "centerX" | "top" | "centerY";
type DistributeAxis = "x" | "y";
type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;

const ALIGNS: { axis: AlignAxis; icon: IconType; labelKey: MessageKey }[] = [
  { axis: "left", icon: AlignStartVertical, labelKey: "editor.alignLeft" },
  { axis: "centerX", icon: AlignCenterVertical, labelKey: "editor.alignCenterX" },
  { axis: "top", icon: AlignStartHorizontal, labelKey: "editor.alignTop" },
  { axis: "centerY", icon: AlignCenterHorizontal, labelKey: "editor.alignCenterY" },
];
const DISTRIBUTES: { axis: DistributeAxis; icon: IconType; labelKey: MessageKey }[] = [
  { axis: "x", icon: AlignHorizontalDistributeCenter, labelKey: "editor.distributeX" },
  { axis: "y", icon: AlignVerticalDistributeCenter, labelKey: "editor.distributeY" },
];

interface EditorToolbarProps {
  onAddNode: (type: ProcessNodeType) => void;
  onOpenLibrary: () => void;
  onAutoArrange: () => void;
  onAlign: (axis: AlignAxis) => void;
  onDistribute: (axis: DistributeAxis) => void;
  // 편집용 매뉴얼 사이트 주소(.env MANUAL_URL) — 비어 있으면 버튼 숨김 (F9)
  manualUrl?: string;
  // CSV 전체 교체 임포트 모달 열기 — 체크아웃 보유자·루트 스코프에서만 전달(page.tsx 게이팅), 없으면 버튼 숨김
  onImportCsv?: () => void;
}

export function EditorToolbar({
  onAddNode,
  onOpenLibrary,
  onAutoArrange,
  onAlign,
  onDistribute,
  manualUrl,
  onImportCsv,
}: EditorToolbarProps) {
  const { t } = useI18n();
  const iconBtn =
    "inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt";
  const divider = <span className="mx-0.5 h-5 w-px bg-divider" />;

  return (
    <div className="flex items-center gap-1.5 border-b border-hairline bg-surface px-3 py-1.5">
      <AddNodeMenu onAdd={onAddNode} onOpenLibrary={onOpenLibrary} />
      {divider}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
        onClick={onAutoArrange}
        title={t("ctx.autoLayout")}
      >
        <Network size={16} strokeWidth={1.5} />
        {t("ctx.autoLayout")}
      </button>
      {divider}
      {ALIGNS.map(({ axis, icon: Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          className={iconBtn}
          onClick={() => onAlign(axis)}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
      {divider}
      {DISTRIBUTES.map(({ axis, icon: Icon, labelKey }) => (
        <button
          key={axis}
          type="button"
          className={iconBtn}
          onClick={() => onDistribute(axis)}
          title={t(labelKey)}
          aria-label={t(labelKey)}
        >
          <Icon size={16} strokeWidth={1.5} />
        </button>
      ))}
      {/* 우측 클러스터 — CSV 임포트(체크아웃 보유 시) + 매뉴얼 사이트(F9) */}
      <div className="ml-auto flex items-center gap-1">
        {onImportCsv && (
          <button
            type="button"
            data-id="toolbar-import-csv"
            className={iconBtn}
            onClick={onImportCsv}
            title={t("csvImport.toolbar")}
            aria-label={t("csvImport.toolbar")}
          >
            <FileUp size={16} strokeWidth={1.5} />
          </button>
        )}
        {manualUrl && (
          <button
            type="button"
            data-id="toolbar-manual-site"
            className={iconBtn}
            onClick={() => window.open(manualUrl, "_blank", "noopener,noreferrer")}
            title={t("editor.manualSite")}
            aria-label={t("editor.manualSite")}
          >
            <BookOpen size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
