"use client";

// 우측 인스펙터 (R5) — 4탭 패널(속성/맵/승인/활동). 각 탭 콘텐츠는 page.tsx가 slot으로 주입(빈상태·요약은 내부).
// 탭 바: 좁으면 선택 탭만 라벨 노출, 폭 넉넉하면(@container ≥430px) 전 탭 라벨 펼침 — 잘림 방지.
import {
  Boxes,
  ChevronRight,
  CircleCheck,
  FileUp,
  GitCompare,
  LayoutGrid,
  Map as MapIcon,
  MessageSquare,
  Network,
  Plus,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { type ComponentType, type ReactNode, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { type MessageKey } from "@/lib/i18n-messages";

type InspectorTab = "properties" | "map" | "subprocess" | "approval" | "activity" | "import";
type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

const TABS: { key: InspectorTab; labelKey: MessageKey; icon: IconType }[] = [
  { key: "properties", labelKey: "inspector.tabProperties", icon: SlidersHorizontal },
  { key: "map", labelKey: "inspector.tabMap", icon: MapIcon },
  { key: "approval", labelKey: "editor.tabApproval", icon: CircleCheck },
  { key: "activity", labelKey: "inspector.tabActivity", icon: MessageSquare },
];

// CSV 프리뷰 중에만 나타나는 탭 — importSlot이 있을 때 TABS 뒤에 붙는다
const IMPORT_TAB: { key: InspectorTab; labelKey: MessageKey; icon: IconType } = {
  key: "import", labelKey: "csvImport.tabTitle", icon: FileUp,
};

// SP 지정된 맵에서만 나타나는 탭 — subprocessTabSlot이 있을 때 Map 탭 뒤에 끼운다
const SUBPROCESS_TAB: { key: InspectorTab; labelKey: MessageKey; icon: IconType } = {
  key: "subprocess", labelKey: "inspector.tabSubprocess", icon: Workflow,
};

interface InspectorPanelProps {
  onCollapse: () => void;
  mapId: number;
  // 게시(published) 버전이 있어야 비교 가능 — 없으면 진입 버튼 비활성화.
  canCompare: boolean;
  selectionKind: "node" | "edge" | null;
  // 선택된 노드/엣지 속성 폼 — page.tsx가 만들어 주입(빈상태는 내부 처리). 없으면 placeholder.
  propertiesSlot?: ReactNode;
  // 맵 탭 콘텐츠(가시성·소유자/협업자·설명·노드표시·엣지스타일·PNG) — page.tsx 주입. 없으면 placeholder.
  mapTabSlot?: ReactNode;
  // 승인 탭(워크플로 대시보드)·활동 탭(코멘트·버전 타임라인) 콘텐츠 — page.tsx 주입. 없으면 placeholder.
  approvalSlot?: ReactNode;
  activitySlot?: ReactNode;
  // CSV 임포트 프리뷰 — 슬롯이 있으면 Import 탭이 나타난다
  importSlot?: ReactNode;
  // 탭을 강제 고정(프리뷰 중). 내부 상태 대신 이 값이 이긴다.
  forcedTab?: InspectorTab;
  // 다른 탭·접기 잠금 — 프리뷰를 두고 빠져나가 자동저장 꺼진 상태에 갇히는 걸 막는다
  lockTabs?: boolean;
  // 서브프로세스 지정 카드 — 속성 빈상태·맵 탭 공용. page.tsx 주입.
  subprocessSlot?: ReactNode;
  // Subprocess 탭(지정 메타+역참조 목록) — 지정된 맵에서만 슬롯이 오고, 있을 때만 탭이 나타난다
  subprocessTabSlot?: ReactNode;
  // 속성 빈상태 헤더 — 맵 타이틀 + 버전 전환 컨트롤(VersionPill). page.tsx 주입.
  mapName?: string;
  // 맵 이름 위 작은 버전 표시("version {n}" / 드래프트 "(Draft)v.{n}"). page.tsx 주입.
  mapVersionMarker?: string;
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
  mapId,
  canCompare,
  selectionKind,
  propertiesSlot,
  mapTabSlot,
  approvalSlot,
  activitySlot,
  importSlot,
  forcedTab,
  lockTabs,
  subprocessSlot,
  subprocessTabSlot,
  mapName,
  mapVersionMarker,
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
  const [internalTab, setInternalTab] = useState<InspectorTab>("properties");
  // 지정 해제로 슬롯이 사라지면 열려 있던 subprocess 탭을 Map 탭으로 폴백(렌더 파생 — effect 불요)
  const rawTab = forcedTab ?? internalTab;
  const tab = rawTab === "subprocess" && !subprocessTabSlot ? "map" : rawTab;
  const tabs = [
    ...TABS.slice(0, 2),
    ...(subprocessTabSlot ? [SUBPROCESS_TAB] : []),
    ...TABS.slice(2),
    ...(importSlot ? [IMPORT_TAB] : []),
  ];

  return (
    // @container — 패널 폭 기준 컨테이너 쿼리(탭 라벨 전체 펼침 판정용, ≥430px면 전 탭 라벨)
    <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 탭 바 — 접기 화살표 + 아이콘 탭. 좁으면 선택 탭만 라벨, 폭 넉넉하면 전 탭 라벨 펼침(≥430px). 잘림 방지 */}
      <div className="flex items-center gap-0.5 border-b border-hairline px-2 py-1">
        <button
          type="button"
          disabled={lockTabs}
          className="shrink-0 rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          onClick={onCollapse}
          title={t("editor.inspectorToggle")}
          aria-label={t("editor.inspectorToggle")}
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        {tabs.map(({ key, labelKey, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              disabled={lockTabs && key !== tab}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              aria-pressed={active}
              className={`flex items-center gap-1 rounded-sm px-2 py-1.5 text-caption transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${
                active ? "bg-accent-tint font-medium text-accent" : "text-ink-secondary hover:bg-surface-alt"
              }`}
              onClick={() => setInternalTab(key)}
            >
              <Icon size={16} strokeWidth={1.5} className="shrink-0" />
              <span
                className={`grid transition-all duration-350 ease-smooth @[430px]:grid-cols-[1fr] ${
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
            mapVersionMarker={mapVersionMarker}
            versionControl={versionControl}
            subprocessSlot={subprocessSlot}
          />
        )}
        {tab === "properties" &&
          selectionKind !== null &&
          (propertiesSlot ?? (
            <Placeholder text={`${selectionKind === "node" ? "Node" : "Edge"} ${t("inspector.tabProperties")} · ${t("inspector.wip")}`} />
          ))}
        {tab === "map" &&
          (mapTabSlot ?? <Placeholder text={`${t("inspector.tabMap")} · ${t("inspector.wip")}`} />)}
        {tab === "subprocess" && subprocessTabSlot}
        {tab === "approval" &&
          (approvalSlot ?? <Placeholder text={`${t("editor.tabApproval")} · ${t("inspector.wip")}`} />)}
        {tab === "activity" &&
          (activitySlot ?? <Placeholder text={`${t("inspector.tabActivity")} · ${t("inspector.wip")}`} />)}
        {tab === "import" && importSlot}
      </div>

      {/* 속성 빈상태 하단 스티키 — 비교 화면 진입(PNG 다운로드 버튼과 동일 accent 톤). 선택 없을 때만.
          게시본이 없으면 비교 기준선이 없어 비활성화(툴팁 안내). */}
      {tab === "properties" && selectionKind === null && (
        <div className="shrink-0 border-t border-hairline p-3">
          {canCompare ? (
            <Link
              href={`/maps/${mapId}/compare`}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
            >
              <GitCompare size={16} strokeWidth={1.5} />
              {t("inspector.compareVersions")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title={t("inspector.compareNeedsPublished")}
              className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-sm bg-surface-alt px-3 py-2 text-caption font-medium text-ink-tertiary"
            >
              <GitCompare size={16} strokeWidth={1.5} />
              {t("inspector.compareVersions")}
            </button>
          )}
        </div>
      )}
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
  mapVersionMarker,
  versionControl,
  subprocessSlot,
}: Omit<InspectorPanelProps, "onCollapse" | "selectionKind" | "mapId" | "canCompare">) {
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
        {mapVersionMarker && (
          <span className="text-fine text-ink-tertiary">{mapVersionMarker}</span>
        )}
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

      {/* 서브프로세스 지정 카드 — 다른 맵 연결 절차 안내 + 상태/설정 */}
      {subprocessSlot}
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
