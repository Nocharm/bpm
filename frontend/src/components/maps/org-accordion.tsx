// 홈 좌측 — owning department 조직도 아코디언. main의 들여쓰기 트리 위에 카운트 태그·펼침 톤다운·
// 맵 보유 부서의 그룹 박스를 얹는다.
// 설계: 2026-08-04-home-dept-list-revision-design.md
"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { MapSummary } from "@/lib/api";
import type { OrgNode } from "@/lib/org-tree";
import { useI18n } from "@/lib/i18n";
import { useClosingKeys } from "@/lib/use-closing-keys";
import { CLAMP_VISIBLE, ClampedList } from "@/components/maps/clamped-list";
import { CountTag } from "@/components/maps/count-tag";
import { DeptGroupBox } from "@/components/maps/dept-group-box";
import { MapCard } from "@/components/maps/map-card";
import { StickyBoxHeader } from "@/components/maps/sticky-box-header";

// 리스트 3.5개 클램프의 "전체 펼치기" 상태 영속 키 — 트리 펼침(bpm.home.tree)과 별도 보관.
const LIST_EXPAND_KEY = "bpm.home.deptListExpand";
// 미지정 섹션 리스트 키 — 부서 path와 충돌하지 않는 센티널.
const UNASSIGNED_LIST_KEY = "__unassigned__";

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
  const { t, lang } = useI18n();
  const {
    roots, unassigned, openPaths, onToggle, onCollapseAll, selectedId, highlightId,
    onSelect, unassignedOpen, onToggleUnassigned, renderCard,
  } = props;

  // 리스트 "전체 펼치기" 상태 — 박스별(부서 path·미지정 센티널). localStorage 복원으로 뒤로가기에도 유지.
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LIST_EXPAND_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { paths?: unknown };
      if (Array.isArray(s.paths)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpandedLists(new Set(s.paths.filter((x): x is string => typeof x === "string"))); // one-time hydration
      }
    } catch {
      /* 손상된 저장값 무시 */
    }
  }, []);
  const toggleListExpand = (key: string) => {
    const next = new Set(expandedLists);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedLists(next);
    window.localStorage.setItem(LIST_EXPAND_KEY, JSON.stringify({ paths: [...next] }));
  };

  // 섹션 접힘 애니메이션 — 상태는 즉시 커밋, 고스트 렌더로 accordion-close만 재생 후 언마운트.
  const { closingKeys, beginClose, cancelClose } = useClosingKeys<string>();

  // 맵 목록 — 인셋은 pl-5 pr-2 고정값(depth에서 파생하지 않는 상수). 박스가 테두리를 잃은 뒤
  // 카드가 헤더 아래 소속임을 보여주는 유일한 단서라, 상수로 고정해야 모든 depth에서 카드 폭이 동일하다.
  // 3.5개 초과 목록은 ClampedList가 자르고 풀폭 쉐브론 버튼으로 전체 펼침을 토글한다.
  // accordion-open/close — 펼침은 0→콘텐츠 높이 진입, 접힘은 역방향 재생 후 언마운트(globals.css).
  const renderMapList = (maps: MapSummary[], listKey: string) => (
    <div className={closingKeys.has(listKey) ? "accordion-close" : "accordion-open"}>
      <ClampedList
        count={maps.length}
        expanded={expandedLists.has(listKey)}
        onToggle={() => toggleListExpand(listKey)}
        dataId={`org-list-expand-${listKey}`}
      >
        <ul className="flex flex-col gap-2 pl-5 pr-2">
          {maps.map((m) => (
            <li key={m.id}>
              {renderCard
                ? renderCard(m)
                : <MapCard map={m} selected={selectedId === m.id} highlighted={highlightId === m.id} onSelect={onSelect} />}
            </li>
          ))}
        </ul>
      </ClampedList>
    </div>
  );

  const renderNode = (node: OrgNode, depth: number) => {
    const open = openPaths.has(node.path);
    // 접힘 애니메이션 중(고스트) — open은 이미 false, 콘텐츠만 accordion-close 재생 동안 남긴다.
    const isClosing = closingKeys.has(node.path);
    const showContent = open || isClosing;
    // 자기 맵을 가진 부서를 펼치면 헤더 행과 자기 카드만 박스로 묶는다. 자식은 박스 밖 —
    // 박스의 뜻을 "이 부서가 직접 가진 맵"으로 고정하고 박스 중첩을 막는다.
    const boxed = showContent && node.maps.length > 0;

    // 박스 안이든 밖이든 같은 행이다 — 부서명을 트리 행과 박스 제목에 따로 쓰면 같은 이름이 두 줄 연속으로 나온다.
    const header = (
      <button
        type="button"
        data-id="org-node-toggle"
        data-path={node.path}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          // 닫기: 상태·영속은 즉시, 콘텐츠는 고스트로 accordion-close 재생 후 언마운트("뿅" 방지).
          if (open) beginClose(node.path);
          else cancelClose(node.path);
          onToggle(node.path);
        }}
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
          {/* 한/영 토글 연동 — ko는 한글명 우선(없으면 영문 유지) */}
          {lang === "ko" && node.koreanName ? node.koreanName : node.name}
        </span>
        {!open && <CountTag count={node.mapCount} />}
      </button>
    );

    return (
      <li key={node.path} className="flex flex-col gap-2">
        {boxed ? (
          <DeptGroupBox>
            <StickyBoxHeader
              showCollapse={node.maps.length > CLAMP_VISIBLE && expandedLists.has(node.path)}
              onCollapse={() => toggleListExpand(node.path)}
              dataId={`org-list-collapse-${node.path}`}
            >
              {header}
            </StickyBoxHeader>
            {renderMapList(node.maps, node.path)}
          </DeptGroupBox>
        ) : header}
        {showContent && node.children.length > 0 && (
          <div className={isClosing ? "accordion-close" : "accordion-open"}>
            <ul className="flex flex-col gap-2">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
          </div>
        )}
      </li>
    );
  };

  // 미지정 섹션 — 부서 하나 + 그 맵이라는 같은 모양이므로 같은 헤더·박스·접힘 애니 규칙을 쓴다.
  const unassignedClosing = closingKeys.has(UNASSIGNED_LIST_KEY);
  const unassignedHeader = (
    <button
      type="button"
      data-id="org-unassigned-toggle"
      aria-expanded={unassignedOpen}
      onClick={(e) => {
        e.stopPropagation();
        if (unassignedOpen) beginClose(UNASSIGNED_LIST_KEY);
        else cancelClose(UNASSIGNED_LIST_KEY);
        onToggleUnassigned();
      }}
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
          {(unassignedOpen || unassignedClosing)
            ? (
              <DeptGroupBox>
                <StickyBoxHeader
                  showCollapse={unassigned.length > CLAMP_VISIBLE && expandedLists.has(UNASSIGNED_LIST_KEY)}
                  onCollapse={() => toggleListExpand(UNASSIGNED_LIST_KEY)}
                  dataId="org-list-collapse-unassigned"
                >
                  {unassignedHeader}
                </StickyBoxHeader>
                {renderMapList(unassigned, UNASSIGNED_LIST_KEY)}
              </DeptGroupBox>
            )
            : unassignedHeader}
        </div>
      )}
    </section>
  );
}
