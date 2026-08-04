// 홈 좌측 — owning department 조직도 아코디언. main의 들여쓰기 트리 위에 카운트 태그·펼침 톤다운·
// 맵 보유 부서의 그룹 박스를 얹는다.
// 설계: docs/design/2026-08-04-home-dept-list-revision-design.md
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import type { OrgNode } from "@/lib/org-tree";
import { useI18n } from "@/lib/i18n";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
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

export function OrgAccordion(props: OrgAccordionProps) {
  const { t } = useI18n();
  const {
    roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId,
    onSelect, unassignedOpen, onToggleUnassigned, renderCard,
  } = props;

  // 맵 목록 — 인셋은 pl-5 pr-2 고정값(depth에서 파생하지 않는 상수). 박스가 테두리를 잃은 뒤
  // 카드가 헤더 아래 소속임을 보여주는 유일한 단서라, 상수로 고정해야 모든 depth에서 카드 폭이 동일하다.
  const renderMapList = (maps: MapSummary[]) => (
    <ul className="flex flex-col gap-2 pl-5 pr-2">
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
    const open = openPaths.has(node.path);
    // 자기 맵을 가진 부서를 펼치면 헤더 행과 자기 카드만 박스로 묶는다. 자식은 박스 밖 —
    // 박스의 뜻을 "이 부서가 직접 가진 맵"으로 고정하고 박스 중첩을 막는다.
    const boxed = open && node.maps.length > 0;

    // 박스 안이든 밖이든 같은 행이다 — 부서명을 트리 행과 박스 제목에 따로 쓰면 같은 이름이 두 줄 연속으로 나온다.
    const header = (
      <button
        type="button"
        data-id="org-node-toggle"
        data-path={node.path}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(node.path); }}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className="group flex w-full items-center gap-1.5 rounded-sm py-1 text-left hover:bg-divider"
      >
        {open
          ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
          : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
        {/* 펼친 행은 톤다운 — 지나온 경로는 뒤로 물러나고 아직 안 연 부서가 앞으로 나온다 */}
        <span
          data-id="org-node-name"
          className={`truncate text-fine ${open ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
        >
          {node.name}
        </span>
        {!open && <CountTag count={node.mapCount} />}
      </button>
    );

    return (
      <li key={node.path} className="flex flex-col gap-2">
        {boxed ? <DeptGroupBox>{header}{renderMapList(node.maps)}</DeptGroupBox> : header}
        {open && node.children.length > 0 && (
          <ul className="flex flex-col gap-2">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  // 미지정 섹션 — 부서 하나 + 그 맵이라는 같은 모양이므로 같은 헤더·박스 규칙을 쓴다.
  const unassignedHeader = (
    <button
      type="button"
      data-id="org-unassigned-toggle"
      aria-expanded={unassignedOpen}
      onClick={(e) => { e.stopPropagation(); onToggleUnassigned(); }}
      className="group flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-left hover:bg-divider"
    >
      {unassignedOpen
        ? <ChevronDown size={14} strokeWidth={1.5} className="shrink-0" />
        : <ChevronRight size={14} strokeWidth={1.5} className="shrink-0" />}
      <span
        data-id="org-node-name"
        className={`truncate text-fine ${unassignedOpen ? "text-ink-tertiary" : "text-ink-secondary group-hover:text-ink"}`}
      >
        {t("home.unassignedDept")}
      </span>
      {!unassignedOpen && <CountTag count={unassigned.length} />}
    </button>
  );

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
      <ul className="flex flex-col gap-2">{roots.map((r) => renderNode(r, 0))}</ul>
      {unassigned.length > 0 && (
        <div className="pt-2">
          {unassignedOpen
            ? <DeptGroupBox>{unassignedHeader}{renderMapList(unassigned)}</DeptGroupBox>
            : unassignedHeader}
        </div>
      )}
    </section>
  );
}
