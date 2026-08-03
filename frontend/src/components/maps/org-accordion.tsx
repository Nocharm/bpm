// 홈 좌측 — owning department 조직도 아코디언. 부서명은 고정폭 필, 자기 맵 없이 자식이 1개뿐인
// 구간은 한 행에 병합하고, 맵 카드는 depth 무관 풀폭으로 그린다.
// 설계: docs/design/2026-08-04-home-dept-visibility-design.md
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import { collectPillChain, type OrgNode } from "@/lib/org-tree";
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
  // 부서 미지정 섹션 접기 — 부서 노드와 동일한 토글 UX. 상태는 page.tsx가 보유(Collapse all에 함께 반응).
  unassignedOpen: boolean;
  onToggleUnassigned: () => void;
  // 좁은 화면(<split)에서도 상세를 볼 수 있도록 카드 렌더를 페이지에 위임 — 미지정 시 bare MapCard로 폴백.
  // Delegates card render to the page so narrow screens keep an inline detail accordion — falls back to bare MapCard.
  renderCard?: (map: MapSummary) => ReactNode;
}

// 부서명 필 — 폭 고정(96px)이라 같은 depth의 필이 세로로 정렬되어, 카드를 들여쓰지 않고도 계층이 읽힌다.
// truncate가 긴 부서명을 자르므로 title은 필수.
function DeptPill({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      title={name}
      className={`w-24 shrink-0 truncate rounded-full border px-2 py-0.5 text-center text-fine ${
        active
          ? "border-accent-tint-border bg-accent-tint text-accent"
          : "border-hairline bg-surface text-ink-secondary"
      }`}
    >
      {name}
    </span>
  );
}

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const {
    roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId,
    onSelect, unassignedOpen, onToggleUnassigned, renderCard,
  } = props;

  // 맵 목록 — 들여쓰기 없음(전 depth 동일 폭). 부서 노드와 미지정 섹션이 공유.
  const renderMapList = (maps: MapSummary[]) => (
    <ul className="flex flex-col gap-2 pt-2">
      {maps.map((m) => (
        <li key={m.id}>
          {renderCard
            ? renderCard(m)
            : <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );

  const renderNode = (node: OrgNode, depth: number) => {
    // 열림 판정·토글은 체인의 첫 노드 path — 터미널 path로 판정하면 접기(page.tsx가 첫 path만 삭제)가
    // 먹지 않는 죽은 행이 된다.
    const open = openPaths.has(node.path);
    const chain = collectPillChain(node);
    const terminal = chain[chain.length - 1];
    // 자기 맵을 가진 행만 sticky — 순수 네비 행까지 sticky면 4단계가 계단식으로 쌓여 높이를 잠식한다.
    // 전부 같은 top-0이라 나중 헤더가 앞 헤더를 덮어 화면에 보이는 sticky는 항상 1개.
    const sticky = open && terminal.maps.length > 0;
    // sticky 행은 조상이 스크롤 밖으로 나가므로 경로를 흐린 breadcrumb으로 동반한다(필보다 좁게).
    const ancestors = sticky ? node.path.split("/").slice(0, -1) : [];
    return (
      <li key={node.path} className="flex flex-col">
        <button
          type="button"
          data-id="org-node-toggle"
          data-path={node.path}
          data-sticky={sticky ? "true" : undefined}
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
          // sticky 행은 들여쓰지 않는다 — breadcrumb이 경로를 담아 중복이고, 가장 넓은 행이라 폭이 아쉽다.
          style={sticky ? undefined : { paddingLeft: `${depth * 12 + 4}px` }}
          className={`group flex items-center gap-1 rounded-sm py-1 text-left hover:bg-surface-alt ${
            sticky ? "sticky top-0 z-10 border-b border-hairline bg-surface px-1" : ""
          }`}
        >
          {open
            ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
            : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
          {ancestors.length > 0 && (
            // min-w-0 + shrink — 폭이 모자라면 필이 아니라 breadcrumb이 먼저 줄어든다.
            <span className="flex min-w-0 shrink items-center gap-1 text-fine text-ink-tertiary">
              {ancestors.map((seg) => (
                <span key={seg} className="flex min-w-0 items-center gap-1">
                  <span className="max-w-[4.5rem] truncate" title={seg}>{seg}</span>
                  <span aria-hidden>/</span>
                </span>
              ))}
            </span>
          )}
          {chain.map((n, i) => (
            <span key={n.path} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />}
              <DeptPill name={n.name} active={open} />
            </span>
          ))}
          <span className="ml-auto shrink-0 pl-1 text-fine text-ink-tertiary">({terminal.mapCount})</span>
        </button>
        {open && (
          <div className="flex flex-col gap-2">
            {/* 자기 맵을 자식보다 먼저 — 반대면 손자 카드가 헤더와 자기 맵 사이에 통째로 끼어들어
                sticky 헤더가 자기 것 아닌 카드를 덮는다. */}
            {terminal.maps.length > 0 && renderMapList(terminal.maps)}
            {terminal.children.length > 0 && (
              <ul className="flex flex-col">{terminal.children.map((c) => renderNode(c, depth + 1))}</ul>
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
          <button
            type="button"
            data-id="org-unassigned-toggle"
            data-sticky={unassignedOpen ? "true" : undefined}
            aria-expanded={unassignedOpen}
            onClick={(e) => { e.stopPropagation(); onToggleUnassigned(); }}
            className={`group flex items-center gap-1 rounded-sm px-1 py-1 text-left hover:bg-surface-alt ${
              unassignedOpen ? "sticky top-0 z-10 border-b border-hairline bg-surface" : ""
            }`}
          >
            {unassignedOpen
              ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
              : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
            <DeptPill name={t("home.unassignedDept")} active={unassignedOpen} />
            <span className="ml-auto shrink-0 pl-1 text-fine text-ink-tertiary">({unassigned.length})</span>
          </button>
          {unassignedOpen && renderMapList(unassigned)}
        </div>
      )}
    </section>
  );
}
