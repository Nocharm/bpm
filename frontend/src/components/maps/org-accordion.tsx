// 홈 좌측 — owning department 조직도 아코디언. 리프/노드에 MapCard, 상위 노드는 롤업 카운트.
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import type { MapSummary } from "@/lib/api";
import type { OrgNode } from "@/lib/org-tree";
import { useI18n } from "@/lib/i18n";
import { MapCard } from "@/components/maps/map-card";

interface OrgAccordionProps {
  roots: OrgNode[];
  unassigned: MapSummary[];
  openPaths: Set<string>;
  onToggle: (path: string) => void;
  onCollapseAll: () => void;
  selectedId: number | null;
  highlightId: number | null;
  onSelect: (id: number) => void;
}

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const { roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId, onSelect } = props;

  const renderNode = (node: OrgNode, depth: number) => {
    const open = openPaths.has(node.path);
    return (
      <li key={node.path} className="flex flex-col">
        <button
          type="button"
          data-id="org-node-toggle"
          data-path={node.path}
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="group flex items-center gap-1.5 rounded-sm py-1 text-left hover:bg-surface-alt"
        >
          {open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
          <span className="truncate text-fine text-ink-secondary group-hover:text-ink">{node.name}</span>
          <span className="ml-auto shrink-0 text-fine text-ink-tertiary">({node.mapCount})</span>
        </button>
        {open && (
          <div className="flex flex-col gap-2">
            {node.children.length > 0 && (
              <ul className="flex flex-col">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
            )}
            {node.maps.length > 0 && (
              <ul className="flex flex-col gap-2" style={{ paddingLeft: `${depth * 12 + 16}px` }}>
                {node.maps.map((m) => (
                  <li key={m.id}>
                    <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section data-id="home-org-accordion" className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-fine text-ink-tertiary">{t("home.departments")}</span>
        <button
          type="button"
          data-id="org-collapse-all"
          onClick={(e) => { e.stopPropagation(); onCollapseAll(); }}
          className="text-fine text-accent hover:underline"
        >
          {t("home.collapseAll")}
        </button>
      </div>
      <ul className="flex flex-col">{roots.map((r) => renderNode(r, 0))}</ul>
      {unassigned.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <span className="px-1 text-fine text-ink-tertiary">{t("home.unassignedDept")} ({unassigned.length})</span>
          <ul className="flex flex-col gap-2 pl-1">
            {unassigned.map((m) => (
              <li key={m.id}>
                <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
