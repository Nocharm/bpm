// 고아 참조 상세 창 본문 — 맵·그룹·카테고리별 상자(머리 띠: 바로가기·역할·버전, 줄마다 체크·소스·내용·메모·결과 칩, 노드 줄은 호버로 노드 제목). 상세 창이 쓴다.
"use client";

import { FolderTree, Group, Map as MapIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { CheckInput } from "@/components/check-input";
import { RefOutcomeChip } from "@/components/ref-audit/ref-outcome-chip";
import { Tooltip } from "@/components/tooltip";
import type { RefCardLine, RefVersionStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { SOURCE_ICON, SOURCE_LABEL_KEY } from "@/lib/ref-audit";
import { getLineView, groupDialogLines, type DialogGroup, type NodeTitlesView, type RefMode } from "@/lib/ref-audit-view";

const GROUP_ICON: Record<DialogGroup["kind"], LucideIcon | null> = {
  map: MapIcon,
  group: Group,
  category: FolderTree,
  other: null,
};

const STATUS_KEY: Record<RefVersionStatus, MessageKey> = {
  draft: "status.draft",
  pending: "status.pending",
  approved: "status.approved",
  rejected: "status.rejected",
  published: "status.published",
};

interface RefDetailLinesProps {
  lines: RefCardLine[]; // 미리보기 판정을 합친 줄
  mode: RefMode;
  checkedKeys: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

function GroupHeader({ group }: { group: DialogGroup }) {
  const { t } = useI18n();
  const Icon = GROUP_ICON[group.kind];
  const titleClass = "min-w-0 truncate font-semibold text-ink";
  // 맵은 에디터로, 그룹은 그룹 페이지로 같은 탭에서 간다(카테고리는 글자만)
  const title = group.href ? (
    <Link
      href={group.href}
      data-id={group.kind === "map" ? `ref-line-map-link-${group.id}` : `ref-line-group-link-${group.id}`}
      className={`${titleClass} hover:text-accent hover:underline`}
    >
      {group.label}
    </Link>
  ) : (
    <span className={titleClass}>{group.label}</span>
  );
  const version = [group.versionLabel, group.versionStatus ? t(STATUS_KEY[group.versionStatus]) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-divider bg-surface-alt px-3 py-2 text-caption">
      {Icon ? <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-hidden /> : null}
      {title}
      {group.role ? (
        <span className="rounded-full bg-accent-tint px-[7px] text-fine leading-[18px] text-accent">
          {t(group.role === "owner" ? "perm.roleOwner" : "perm.roleEditor")}
        </span>
      ) : null}
      {version ? <span className="text-fine text-ink-tertiary">{version}</span> : null}
    </header>
  );
}

// "노드 N개" 호버 카드 — 서버가 실은 제목(상한까지)과 잘린 수
function NodeTitleList({ count, view }: { count: number; view: NodeTitlesView }) {
  const { t } = useI18n();
  return (
    <span data-id="ref-line-nodes-tip" className="flex flex-col gap-1.5">
      <span className="text-fine text-ink-tertiary">{t("refAudit.line.nodes", { n: count })}</span>
      <span className="flex flex-col gap-0.5">
        {view.titles.map((title, i) => (
          <span key={i} className="flex items-baseline gap-1.5">
            <span aria-hidden className="size-1 shrink-0 -translate-y-0.5 rounded-full bg-ink-muted" />
            <span className={`[overflow-wrap:anywhere] ${title ? "text-ink" : "text-ink-tertiary"}`}>
              {title || t("refAudit.nodes.untitled")}
            </span>
          </span>
        ))}
      </span>
      {view.rest > 0 ? <span className="text-fine text-ink-tertiary">{t("refAudit.nodes.more", { n: view.rest })}</span> : null}
    </span>
  );
}

export function RefDetailLines({ lines, mode, checkedKeys, onToggle }: RefDetailLinesProps) {
  const { t } = useI18n();
  const groups = groupDialogLines(lines);
  return (
    <div data-id="ref-detail-lines" className="@container flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 py-3">
      {groups.map((group) => (
        <section
          key={group.key}
          data-id={`ref-detail-group-${group.key}`}
          className="shrink-0 overflow-hidden rounded-sm border border-hairline bg-surface"
        >
          {group.kind === "other" ? null : <GroupHeader group={group} />}
          <div className="divide-y divide-divider">
            {group.lines.map(({ line, index }) => {
              const view = getLineView(line, mode);
              const SourceIcon = SOURCE_ICON[line.source];
              const muted = !view.checkable;
              const detail = t(view.detailKey, { n: view.detailCount ?? 0 });
              return (
                <label
                  key={view.key}
                  data-id={`ref-line-${index}`}
                  className={`grid grid-cols-[18px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-2.5 @[560px]:grid-cols-[18px_minmax(120px,180px)_minmax(0,1fr)_auto] ${muted ? "bg-surface-pearl text-ink-tertiary" : "cursor-pointer hover:bg-accent-tint/40"}`}
                >
                  <CheckInput
                    data-id={`ref-line-check-${index}`}
                    aria-label={t(SOURCE_LABEL_KEY[line.source])}
                    checked={checkedKeys.has(view.key)}
                    disabled={!view.checkable}
                    onChange={() => onToggle(view.key)}
                  />
                  <span className={`inline-flex min-w-0 items-center gap-1.5 text-caption ${muted ? "" : "text-ink"}`}>
                    <SourceIcon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" aria-hidden />
                    <span className="truncate">{t(SOURCE_LABEL_KEY[line.source])}</span>
                  </span>
                  <span
                    className={`col-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-caption @[560px]:col-start-auto ${muted ? "" : "text-ink-secondary"}`}
                  >
                    {view.nodeTitles ? (
                      <Tooltip content={<NodeTitleList count={line.count} view={view.nodeTitles} />} wide>
                        <span
                          data-id={`ref-line-nodes-${index}`}
                          className="cursor-help underline decoration-ink-muted decoration-dotted underline-offset-[3px]"
                        >
                          {detail}
                        </span>
                      </Tooltip>
                    ) : (
                      <span>{detail}</span>
                    )}
                    {view.reasonKey ? <span className="text-fine text-ink-tertiary">{t(view.reasonKey)}</span> : null}
                    {view.warningKey ? <span className="text-fine text-warn">{t(view.warningKey)}</span> : null}
                    {view.reloadNote ? <span className="text-fine text-ink-tertiary">{t("refAudit.note.reloadEditor")}</span> : null}
                  </span>
                  <span className="col-start-2 justify-self-start @[560px]:col-start-auto @[560px]:justify-self-end">
                    <RefOutcomeChip outcome={view.outcome} recipient={view.recipient} role={view.role} />
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
