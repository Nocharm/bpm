"use client";

// NEW 우측 인스펙터 (R5) — 4탭 패널(속성/맵/승인/활동). 기존 인스펙터와 나란히 두고 비교, 전 탭 완성 후 OLD 제거.
// 현재: 탭 바 + 속성 탭 빈상태(노드추가·라이브러리·자동정렬·맵 요약). 노드/엣지 폼·맵/승인/활동 탭은 후속 단위.
import {
  Boxes,
  ChevronRight,
  CircleCheck,
  LayoutGrid,
  Map as MapIcon,
  MessageSquare,
  Network,
  Plus,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";

type InspectorTab = "properties" | "map" | "approval" | "activity";
type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

const TABS: { key: InspectorTab; labelKey: MessageKey; icon: IconType }[] = [
  { key: "properties", labelKey: "inspector.tabProperties", icon: SlidersHorizontal },
  { key: "map", labelKey: "inspector.tabMap", icon: MapIcon },
  { key: "approval", labelKey: "editor.tabApproval", icon: CircleCheck },
  { key: "activity", labelKey: "inspector.tabActivity", icon: MessageSquare },
];

interface InspectorPanelProps {
  onCollapse: () => void;
  selectionKind: "node" | "edge" | null;
  // 선택된 노드/엣지 속성 폼 — page.tsx가 만들어 주입(빈상태는 내부 처리). 없으면 placeholder.
  propertiesSlot?: ReactNode;
  // 맵 탭 콘텐츠(가시성·소유자/협업자·설명·노드표시·엣지스타일·PNG) — page.tsx 주입. 없으면 placeholder.
  mapTabSlot?: ReactNode;
  // 속성 빈상태 헤더 — 맵 타이틀 + 버전 전환 컨트롤(VersionPill). page.tsx 주입.
  mapName?: string;
  versionControl?: ReactNode;
  readOnly: boolean;
  onAddNode: () => void;
  onOpenLibrary: () => void;
  onAutoArrange: () => void;
  nodeCount: number;
  edgeCount: number;
  subprocessCount: number;
  saveLabel: string;
}

export function InspectorPanel({
  onCollapse,
  selectionKind,
  propertiesSlot,
  mapTabSlot,
  mapName,
  versionControl,
  readOnly,
  onAddNode,
  onOpenLibrary,
  onAutoArrange,
  nodeCount,
  edgeCount,
  subprocessCount,
  saveLabel,
}: InspectorPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("properties");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 탭 바 — 접기 화살표 + 아이콘 탭(선택 시 폭 늘며 라벨 노출). 잘림 방지·컴팩트 */}
      <div className="flex items-center gap-0.5 border-b border-hairline px-2 py-1">
        <button
          type="button"
          className="shrink-0 rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          onClick={onCollapse}
          title={t("editor.inspectorToggle")}
          aria-label={t("editor.inspectorToggle")}
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        {TABS.map(({ key, labelKey, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              title={t(labelKey)}
              aria-label={t(labelKey)}
              aria-pressed={active}
              className={`flex items-center gap-1 rounded-sm px-2 py-1.5 text-caption transition-colors ${
                active ? "bg-accent-tint font-medium text-accent" : "text-ink-secondary hover:bg-surface-alt"
              }`}
              onClick={() => setTab(key)}
            >
              <Icon size={16} strokeWidth={1.5} className="shrink-0" />
              <span
                className={`grid transition-all duration-350 ease-smooth ${
                  active ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
                }`}
              >
                <span className="overflow-hidden whitespace-nowrap">{t(labelKey)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "properties" && selectionKind === null && (
          <PropertiesEmpty
            readOnly={readOnly}
            onAddNode={onAddNode}
            onOpenLibrary={onOpenLibrary}
            onAutoArrange={onAutoArrange}
            nodeCount={nodeCount}
            edgeCount={edgeCount}
            subprocessCount={subprocessCount}
            saveLabel={saveLabel}
            mapName={mapName}
            versionControl={versionControl}
          />
        )}
        {tab === "properties" &&
          selectionKind !== null &&
          (propertiesSlot ?? (
            <Placeholder text={`${selectionKind === "node" ? "Node" : "Edge"} ${t("inspector.tabProperties")} · ${t("inspector.wip")}`} />
          ))}
        {tab === "map" &&
          (mapTabSlot ?? <Placeholder text={`${t("inspector.tabMap")} · ${t("inspector.wip")}`} />)}
        {(tab === "approval" || tab === "activity") && (
          <Placeholder text={`${t(TABS.find((x) => x.key === tab)!.labelKey)} · ${t("inspector.wip")}`} />
        )}
      </div>
    </div>
  );
}

function PropertiesEmpty({
  readOnly,
  onAddNode,
  onOpenLibrary,
  onAutoArrange,
  nodeCount,
  edgeCount,
  subprocessCount,
  saveLabel,
  mapName,
  versionControl,
}: Omit<InspectorPanelProps, "onCollapse" | "selectionKind">) {
  const { t } = useI18n();
  const action =
    "flex w-full items-center gap-2 rounded-sm border border-hairline px-3 py-2 text-caption text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-col gap-4">
      {/* 빈상태 — 맵 타이틀 + 버전(전환 가능). 아이콘은 앱 대표 아이콘(로그인 화면) */}
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-md bg-accent-tint text-accent">
          <Workflow size={24} strokeWidth={1.6} />
        </span>
        <span className="max-w-full truncate text-body-strong text-ink">{mapName || t("inspector.noSelection")}</span>
        {versionControl}
        <span className="text-caption text-ink-tertiary">{t("inspector.emptyHint")}</span>
      </div>

      {!readOnly && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm border border-accent/40 bg-accent-tint px-3 py-2 text-caption font-medium text-accent hover:bg-accent-tint/70"
            onClick={onAddNode}
          >
            <Plus size={16} strokeWidth={1.5} />
            {t("inspector.addNode")}
          </button>
          <button type="button" className={action} onClick={onOpenLibrary}>
            <Network size={16} strokeWidth={1.5} className="text-ink-tertiary" />
            {t("inspector.addFromLibrary")}
          </button>
          <button type="button" className={action} onClick={onAutoArrange}>
            <LayoutGrid size={16} strokeWidth={1.5} className="text-ink-tertiary" />
            {t("ctx.autoLayout")}
          </button>
        </div>
      )}

      <div className="rounded-md border border-hairline bg-surface-alt/50 p-3">
        <div className="mb-2 text-fine font-semibold text-ink-tertiary">{t("inspector.summary")}</div>
        <SummaryRow icon={Boxes} label={t("inspector.sumNodes")} value={`${nodeCount}`} />
        <SummaryRow icon={Network} label={t("inspector.sumEdges")} value={`${edgeCount}`} />
        <SummaryRow icon={LayoutGrid} label={t("inspector.sumSubprocess")} value={`${subprocessCount}`} />
        <SummaryRow icon={Boxes} label={t("inspector.sumSaved")} value={saveLabel} muted />
      </div>
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-caption">
      <span className="flex items-center gap-1.5 text-ink-secondary">
        <Icon size={14} strokeWidth={1.5} className="text-ink-tertiary" />
        {label}
      </span>
      <span className={muted ? "text-ink-tertiary" : "font-medium text-ink"}>{value}</span>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-caption text-ink-tertiary">{text}</div>
  );
}
