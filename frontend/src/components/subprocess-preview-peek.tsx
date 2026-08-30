"use client";

// 서브프로세스 라이브러리/체계 피커 행의 미리보기 피크 — 행 클릭 즉시·2.5초 호버로 열리는 포털 패널.
// 게시본 기준 그래프(getResolvedGraph follow_latest → 최신 게시본, 없으면 최신본)를 ScopePreview(경량 SVG)로
// 렌더하고 SP 등록 정보를 함께 보여준다. viewer 미만은 locked 응답 → 권한 안내 + "추가는 가능" 안내.
// 미리보기 영역에 마우스가 있으면 우상단에 "Add to map" 버튼이 나타난다 (사용자 요청 2026-08-30).

import {
  Building2,
  CalendarClock,
  ChevronRight,
  ExternalLink,
  Flag,
  FolderTree,
  GitBranch,
  Lock,
  LogIn,
  LogOut,
  Network,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  User,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getMap, getResolvedGraph, type VersionGraph } from "@/lib/api";
import { PARAM_ICON } from "@/components/param-icons";
import { resolveNodeStroke } from "@/components/process-node";
import { ScopePreview } from "@/components/scope-preview";
import { getExternalL5Color } from "@/lib/canvas";
import { formatKstShort } from "@/lib/datetime";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { useI18n } from "@/lib/i18n";
import type { NodeDisplayToggle } from "@/lib/node-actions";
import { formatParamValue, PARAM_LABEL_KEY, SP_PARAM_FIELDS, type SpParamField } from "@/lib/params";

// 행 호버로 피크가 열리기까지의 지연 — 스침 오픈 방지(클릭은 즉시)
export const PEEK_HOVER_DELAY_MS = 2500;

export interface SubprocessPeekInfo {
  department: string | null;
  assignee: string | null;
  system: string | null;
  duration: string | null;
  // SP 파라미터 나머지 4종 — 목업 "전체 파라미터" 표시 소스 (2026-08-30)
  touch_time: string | null;
  cost_krw: string | null;
  cost_usd: string | null;
  headcount: string | null;
}

// 피크 "Add to map" → 에디터 생성 경로 페이로드 — 드래그 dataTransfer 규약과 1:1 대응(드롭과 동일 체인)
export interface PeekAddPayload {
  linkedMapId: number;
  name: string;
  pinned: number | null;
  unregistered: boolean;
  // 체계 피커 전용 — 드롭의 낙관 참조(출처 배지) 소스와 동일 (design 2026-08-28 §8)
  categoryId?: number;
  categoryPath?: string;
}

type PeekFetch =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "error" }
  | { status: "ready"; graph: VersionGraph };

export function SubprocessPreviewPeek({
  mapId,
  name,
  designated,
  info,
  anchor,
  anchorEl,
  addDisabledReason,
  externalOrigin = null,
  displayFields,
  onAdd,
  onOpenMap,
  onClose,
}: {
  mapId: number;
  name: string;
  designated: boolean;
  info: SubprocessPeekInfo;
  // 뷰포트 고정 좌표(행 rect 기준) — 세로는 패널이 화면 안에 들어오게 클램프해 렌더
  anchor: { x: number; y: number };
  // 바깥 클릭 닫기에서 제외할 트리거 행 — 행 재클릭은 행 onClick이 토글로 처리
  anchorEl: Element | null;
  // null=추가 가능. 문자열이면 비활성 사유(이미 링크됨·순환·읽기전용 등)
  addDisabledReason: string | null;
  // L5 연계 캔버스 전용 — 타 L5 출신 맵이면 캔버스 규칙(홈 L5별 색+출처 배지)로 목업 렌더 (design 2026-08-28 §8)
  externalOrigin?: { categoryId: number; categoryPath: string } | null;
  // 현재 맵의 노드 표시 설정 — 목업 호버 시 "현재 맵 기준" 렌더 필터 (2026-08-30)
  displayFields: NodeDisplayToggle[];
  onAdd: () => void;
  // 목업 드롭다운 "해당 맵으로 이동" — 에디터 이탈 확인 게이트(openMapPrompt)는 호출측이 담당
  onOpenMap: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [fetchState, setFetchState] = useState<PeekFetch>({ status: "loading" });

  useEffect(() => {
    // 미등록 맵은 서버가 권한과 무관하게 잠금 응답 — 요청 생략(전용 안내 렌더)
    if (!designated) return;
    let cancelled = false;
    getResolvedGraph(mapId, true, null)
      .then((graph) => {
        if (cancelled) return;
        if (graph.locked) {
          setFetchState({ status: "locked" });
          return;
        }
        // ScopePreview는 VersionGraph(FlatNode) 계약 — 평면 노드라 parent/source 계보만 채워 맞춘다
        setFetchState({
          status: "ready",
          graph: {
            nodes: graph.nodes.map((node) => ({
              ...node,
              parent_node_id: null,
              source_node_id: null,
            })),
            edges: graph.edges,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, designated]);

  // 상세 탭 메타 — 게시 버전 정보(마커·게시 시각=published 이벤트)와 업무체계 경로.
  // 지정 맵은 미리보기 응답이 권한을 확정한 뒤(ready)에만 조회 — locked면 맵 상세도 403이 확실하므로
  // 요청을 생략해 콘솔 403 스팸 없이 톤다운 대시로 남긴다. 미등록 행은 목록 노출=가시(viewer+)라 즉시 조회.
  const [meta, setMeta] = useState<
    | { status: "loading" }
    | { status: "none" }
    | {
        status: "ready";
        version: { label: string; number: number | null; publishedAt: string | null } | null;
        categoryPath: string | null;
        // SP 지정의 표시 필드 나머지 — 조건·IO·GMP (목업 전체 파라미터·상세 탭 소스)
        sp: {
          input: string | null;
          output: string | null;
          startCondition: string | null;
          endCondition: string | null;
          gmp: string | null;
        };
      }
  >({ status: "loading" });
  const canFetchMeta = !designated || fetchState.status === "ready";
  useEffect(() => {
    if (!canFetchMeta) return;
    let cancelled = false;
    getMap(mapId)
      .then((detail) => {
        if (cancelled) return;
        const published = [...detail.versions]
          .filter((version) => version.status === "published")
          .sort((a, b) => b.id - a.id)[0];
        setMeta({
          status: "ready",
          version: published
            ? {
                label: published.label,
                number: published.version_number ?? null,
                publishedAt:
                  [...(published.events ?? [])]
                    .filter((event) => event.event_type === "published")
                    .sort((a, b) => b.id - a.id)[0]?.created_at ?? published.updated_at,
              }
            : null,
          categoryPath: detail.category_path ?? null,
          sp: {
            input: detail.sp_input ?? null,
            output: detail.sp_output ?? null,
            startCondition: detail.sp_start_condition ?? null,
            endCondition: detail.sp_end_condition ?? null,
            gmp: detail.sp_gmp ?? null,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setMeta({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, [mapId, canFetchMeta]);

  // 바깥 클릭 닫기 — 포털 자식은 DOM 트리 밖이라 contains로 판정(모달 컨벤션과 동일 mousedown 캡처)
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof globalThis.Element &&
        !panelRef.current?.contains(event.target) &&
        !anchorEl?.contains(event.target)
      ) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [anchorEl, onClose]);

  // 크기 = 브라우저 창 비례(고정 높이 대신) — 폭 40vw·미리보기 32vh, 상하한 클램프 (사용자 피드백 2026-08-30).
  // 열림 시점 창 기준(리스너 없음) — 피크는 스크롤·바깥클릭으로 닫히는 일시 표면이라 리사이즈 추적은 과함.
  // 하한 640 — 좌 노드목업(176)+우 정보(208) 고정 컬럼을 빼고도 미리보기가 최소 ~250px 확보되게
  const panelW = Math.round(Math.min(Math.max(window.innerWidth * 0.4, 640), 800));
  const previewH = Math.round(Math.min(Math.max(window.innerHeight * 0.32, 220), 460));
  // 화면 밖 잘림 방지 클램프 — 헤더(~40px)+미리보기 행 기준
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - panelW - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - (previewH + 40) - 8));

  // SP 파라미터 값 조회 — SP 지정 5종(연간 건수·FTE는 부모 노드 맥락이라 제외, lib/params SP_PARAM_FIELDS)
  const spParamValue = (field: SpParamField): string | null =>
    field === "duration"
      ? info.duration
      : field === "touch_time"
        ? info.touch_time
        : field === "cost_krw"
          ? info.cost_krw
          : field === "cost_usd"
            ? info.cost_usd
            : info.headcount;
  // 상세 탭 — 캔버스 속성 줄 규범 순서(담당자→부서→시스템) + SP 파라미터 5종(아이콘=PARAM_ICON 단일 소스).
  // 미등록 행도 행 형태 유지(값은 서버 마스킹으로 전부 대시).
  const infoRows: { key: string; label: string; icon: LucideIcon; value: string }[] = [
    { key: "assignee", label: t("field.assignee"), icon: User, value: info.assignee ?? "" },
    { key: "department", label: t("field.department"), icon: Building2, value: info.department ?? "" },
    { key: "system", label: t("field.system"), icon: Server, value: info.system ?? "" },
    ...SP_PARAM_FIELDS.map((field) => ({
      key: field as string,
      label: t(PARAM_LABEL_KEY[field]),
      icon: PARAM_ICON[field],
      value: formatParamValue(field, spParamValue(field)),
    })),
  ];
  // 상세 탭 메타 표시값 — 게시 버전 마커(v번호 · 라벨)·게시 시각(KST)·업무체계 전체 경로
  const metaVersion =
    meta.status === "ready" && meta.version
      ? `${meta.version.number != null ? `v${meta.version.number} · ` : ""}${meta.version.label}`
      : "";
  const metaPublishedAt =
    meta.status === "ready" && meta.version?.publishedAt
      ? formatKstShort(meta.version.publishedAt)
      : "";
  const metaCategoryPath = meta.status === "ready" ? meta.categoryPath : null;
  const metaRows: { key: string; label: string; icon: LucideIcon; value: string }[] = [
    { key: "version", label: t("library.peekVersion"), icon: GitBranch, value: metaVersion },
    { key: "publishedAt", label: t("library.peekPublishedAt"), icon: CalendarClock, value: metaPublishedAt },
  ];

  // 목업 색 — 기본은 캔버스 정본 SP 바이올렛, L5 캔버스의 타 L5 출신은 홈 L5별 색(캔버스 규칙 미러)
  const mockStroke = externalOrigin
    ? getExternalL5Color(externalOrigin.categoryId)
    : resolveNodeStroke("", "subprocess");

  // 우측 탭(노드 목업/상세 값) + 목업 클릭 드롭다운(추가/맵 이동)
  const [tab, setTab] = useState<"node" | "detail">("node");
  const [mockMenu, setMockMenu] = useState(false);
  // 목업 표시 모드 — 기본: 전체 파라미터, 호버: 현재 맵 노드 표시 설정 기준(실제 렌더 미리보기) (2026-08-30)
  const [mockHover, setMockHover] = useState(false);
  const mockAttrRows = (
    [
      { key: "assignee", icon: User, value: info.assignee ?? "" },
      { key: "department", icon: Building2, value: info.department ?? "" },
      { key: "system", icon: Server, value: info.system ?? "" },
    ] as const
  ).filter((row) => row.value && (!mockHover || displayFields.includes(row.key)));
  const mockParamChips = SP_PARAM_FIELDS.map((field) => ({
    field,
    text: formatParamValue(field, spParamValue(field)),
  })).filter((chip) => chip.text);
  const showMockParams = !mockHover || displayFields.includes("params");
  // 조건·IO·GMP — SP 지정의 나머지 표시 필드(getMap 소스, 잠금 맵은 meta 미조회라 미표시/대시)
  const spExtra = meta.status === "ready" ? meta.sp : null;
  const splitIoLines = (raw: string | null | undefined): string[] =>
    (raw ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  const mockGmpLabel = formatGmp(spExtra?.gmp);
  const showMockGmp = !mockHover || displayFields.includes("gmp");
  const mockConditionLines = [
    { key: "start_condition", icon: Play, value: spExtra?.startCondition ?? "" },
    { key: "end_condition", icon: Flag, value: spExtra?.endCondition ?? "" },
  ].filter((line) => line.value);
  const showMockConditions = !mockHover || displayFields.includes("conditions");
  const mockIoSides = [
    { side: "input" as const, icon: LogIn, lines: splitIoLines(spExtra?.input) },
    { side: "output" as const, icon: LogOut, lines: splitIoLines(spExtra?.output) },
  ].filter((entry) => entry.lines.length > 0 && (!mockHover || displayFields.includes(entry.side)));
  const mockAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mockMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.target instanceof globalThis.Element && !mockAreaRef.current?.contains(event.target)) {
        setMockMenu(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => window.removeEventListener("mousedown", handleMouseDown, true);
  }, [mockMenu]);

  return createPortal(
    <div
      ref={panelRef}
      data-id="library-peek"
      style={{ left, top, width: panelW, boxShadow: "var(--shadow-lg)" }}
      className="fixed z-[1250] flex flex-col overflow-hidden rounded-md border border-hairline bg-surface"
      onMouseLeave={onClose}
    >
      {/* header — 맵 이름 + Add to map(항시 노출, 게시본 표기는 미리보기 안 워터마크로 이동 — 사용자 피드백 2026-08-30) */}
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-ink">
          <Network size={14} strokeWidth={1.5} className="shrink-0 text-ink/50" />
          <span className="truncate">{name}</span>
        </span>
        {/* Add to map — 잠금/미등록 상태에서도 추가는 가능 */}
        <button
          type="button"
          data-id="library-peek-add"
          disabled={addDisabledReason !== null}
          title={addDisabledReason ?? t("library.peekAdd")}
          onClick={onAdd}
          className={`flex shrink-0 items-center gap-1 rounded-sm border px-2 py-0.5 text-fine font-medium ${
            addDisabledReason !== null
              ? "cursor-not-allowed border-hairline bg-surface text-ink-tertiary"
              : "border-accent-tint-border bg-accent text-white hover:opacity-90"
          }`}
        >
          <Plus size={12} strokeWidth={1.5} />
          {t("library.peekAdd")}
        </button>
      </div>
      {/* body — 미리보기(좌, 전폭)와 우측 탭 컬럼(노드 목업/상세) (사용자 피드백 2026-08-30) */}
      <div className="flex min-h-0">
        {/* preview — 게시본 그래프(타입 색 SVG), 우하단 게시본 표기 워터마크 */}
        <div className="relative min-w-0 flex-1 bg-canvas" style={{ height: previewH }}>
          {!designated ? (
            <div data-id="library-peek-unregistered" className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
              <Lock size={16} strokeWidth={1.5} className="text-ink-tertiary" />
              <p className="text-fine text-ink-secondary">{t("library.peekUnregisteredNote")}</p>
            </div>
          ) : fetchState.status === "loading" ? (
            <div className="flex h-full items-center justify-center text-fine text-ink-tertiary">
              {t("common.loading")}
            </div>
          ) : fetchState.status === "locked" ? (
            <div data-id="library-peek-locked" className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
              <Lock size={16} strokeWidth={1.5} className="text-ink-tertiary" />
              <p className="text-fine text-ink-secondary">{t("library.peekNoPermission")}</p>
              <p className="text-fine text-ink-tertiary">{t("library.peekCanStillAdd")}</p>
            </div>
          ) : fetchState.status === "error" ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-fine text-ink-tertiary">
              {t("library.peekLoadError")}
            </div>
          ) : fetchState.graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-fine text-ink-tertiary">
              {t("library.peekEmptyGraph")}
            </div>
          ) : (
            <ScopePreview fullGraph={fetchState.graph} scopeParentId={null} />
          )}
          {/* 게시본 기준 표기 — 그래프 위 워터마크(헤더에서 이동 — 사용자 피드백 2026-08-30) */}
          {designated && fetchState.status === "ready" && (
            <span className="pointer-events-none absolute bottom-1.5 right-2 rounded-xs border border-hairline bg-surface/85 px-1.5 py-px text-fine text-ink-tertiary">
              {t("library.peekPublishedBasis")}
            </span>
          )}
        </div>
        {/* 우측 — 탭: 노드 목업(최상단, 클릭=추가/이동 드롭다운) / 상세(아이콘+라벨+값 필) */}
        <div className="flex w-60 shrink-0 flex-col border-l border-hairline">
          <div className="flex gap-0.5 border-b border-hairline p-1.5">
            <button
              type="button"
              data-id="library-peek-tab-node"
              onClick={() => {
                setMockMenu(false);
                setTab("node");
              }}
              className={`flex-1 rounded-sm px-2 py-1 text-fine font-medium ${
                tab === "node" ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
              }`}
            >
              {t("library.peekTabNode")}
            </button>
            <button
              type="button"
              data-id="library-peek-tab-details"
              onClick={() => {
                setMockMenu(false);
                setTab("detail");
              }}
              className={`flex-1 rounded-sm px-2 py-1 text-fine font-medium ${
                tab === "detail" ? "bg-accent-tint text-accent" : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
              }`}
            >
              {t("library.peekTabDetails")}
            </button>
          </div>
          {tab === "node" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {/* 추가될 노드 목업 — 일반 맵=SP 바이올렛, L5 캔버스 타 L5 출신=홈 L5 색+출처 배지(캔버스 규칙) */}
              <div ref={mockAreaRef} className="relative">
                {/* 캡션 — 기본 "전체 파라미터", 호버 시 "현재 맵 표시 기준" 스왑 안내 */}
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="shrink-0 text-fine text-ink-tertiary">{t("library.peekNodePreview")}</span>
                  <span data-id="library-peek-mock-mode" className="truncate text-fine text-ink-muted">
                    {mockHover ? t("library.peekMockMapBasis") : t("library.peekMockAllParams")}
                  </span>
                </div>
                <button
                  type="button"
                  data-id="library-peek-node-mock"
                  aria-expanded={mockMenu}
                  onClick={() => setMockMenu((cur) => !cur)}
                  onMouseEnter={() => setMockHover(true)}
                  onMouseLeave={() => setMockHover(false)}
                  className="w-full rounded-sm px-2.5 py-2 text-left transition-shadow duration-150 hover:shadow-sm"
                  style={{
                    border: `1.5px solid ${mockStroke}`,
                    background: `color-mix(in srgb, ${mockStroke} 18%, white)`,
                  }}
                >
                  <div className="flex items-start gap-1.5">
                    <Workflow size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: mockStroke }} />
                    <span className="min-w-0 break-words text-fine font-medium text-ink">{name}</span>
                  </div>
                  {/* GMP 필 — 캔버스 GmpPill 미러(분류된 경우만, 신호등 배지) */}
                  {showMockGmp && mockGmpLabel && (
                    <span
                      data-id="library-peek-mock-gmp"
                      className="mt-1 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-transparent px-1.5 py-0 text-[10px] leading-4"
                      style={getGmpBadgeStyle(spExtra?.gmp)}
                    >
                      <ShieldCheck size={10} strokeWidth={1.5} className="shrink-0" />
                      {mockGmpLabel}
                    </span>
                  )}
                  {externalOrigin && (
                    <span
                      data-id="library-peek-mock-origin"
                      title={externalOrigin.categoryPath}
                      className="mt-1.5 flex w-fit max-w-full items-center gap-1 rounded-xs border px-1 py-px text-fine"
                      style={{
                        background: `color-mix(in srgb, ${mockStroke} 12%, white)`,
                        borderColor: `color-mix(in srgb, ${mockStroke} 38%, white)`,
                        color: `color-mix(in srgb, ${mockStroke} 72%, var(--color-ink))`,
                      }}
                    >
                      <FolderTree size={10} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{externalOrigin.categoryPath.split("/").pop()}</span>
                    </span>
                  )}
                  {/* 속성 줄(담당자/부서/시스템) — 기본: 값 있는 전부, 호버: 현재 맵 토글 기준 */}
                  {mockAttrRows.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {mockAttrRows.map((row) => {
                        const Icon = row.icon;
                        return (
                          <span key={row.key} className="flex items-center gap-1 text-fine text-ink-secondary">
                            <Icon size={11} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                            <span className="min-w-0 truncate">{row.value}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* 파라미터 칩 — 캔버스 NodeParams 미러(아이콘+표시형), 호버 시 "params" 토글 기준 */}
                  {showMockParams && mockParamChips.length > 0 && (
                    <div
                      data-id="library-peek-mock-params"
                      className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-fine text-ink-tertiary"
                    >
                      {mockParamChips.map((chip) => {
                        const Icon = PARAM_ICON[chip.field];
                        return (
                          <span key={chip.field} className="inline-flex items-center gap-1">
                            <Icon size={11} strokeWidth={1.5} />
                            {chip.text}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* 조건 줄(시작/종료) — 캔버스 NodeIoDetails 미러(Play/Flag) */}
                  {showMockConditions &&
                    mockConditionLines.map((line) => {
                      const Icon = line.icon;
                      return (
                        <div key={line.key} className="mt-1 flex items-start gap-1 text-fine text-ink-tertiary">
                          <Icon size={11} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 break-words">{line.value}</span>
                        </div>
                      );
                    })}
                  {/* 인풋/아웃풋 — 개행 항목 나열(LogIn/LogOut) */}
                  {mockIoSides.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <div key={entry.side} className="mt-1 flex items-start gap-1 text-fine text-ink-tertiary">
                        <Icon size={11} strokeWidth={1.5} className="mt-0.5 shrink-0" />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          {entry.lines.map((line, index) => (
                            <span key={`${index}-${line}`} className="truncate">
                              {line}
                            </span>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                  <div className="mt-1.5 flex items-center gap-1 text-fine text-ink-tertiary">
                    <RefreshCw size={10} strokeWidth={1.5} className="shrink-0" />
                    <span className="truncate">{t("subprocess.followingBanner")}</span>
                  </div>
                </button>
                {mockMenu && (
                  <div
                    data-id="library-peek-mock-menu"
                    className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-sm border border-hairline bg-surface"
                    style={{ boxShadow: "var(--shadow-md)" }}
                  >
                    <button
                      type="button"
                      data-id="library-peek-mock-add"
                      disabled={addDisabledReason !== null}
                      title={addDisabledReason ?? t("library.peekAdd")}
                      onClick={() => {
                        setMockMenu(false);
                        onAdd();
                      }}
                      className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-fine text-ink hover:bg-surface-alt disabled:cursor-not-allowed disabled:text-ink-tertiary disabled:hover:bg-surface"
                    >
                      <Plus size={12} strokeWidth={1.5} className="shrink-0" />
                      {t("library.peekAdd")}
                    </button>
                    <button
                      type="button"
                      data-id="library-peek-mock-open"
                      onClick={() => {
                        setMockMenu(false);
                        onOpenMap();
                      }}
                      className="flex w-full items-center gap-1.5 border-t border-hairline px-2.5 py-1.5 text-left text-fine text-ink hover:bg-surface-alt"
                    >
                      <ExternalLink size={12} strokeWidth={1.5} className="shrink-0" />
                      {t("library.peekOpenMap")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              data-id="library-peek-info"
              className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2"
            >
              {infoRows.map((row) => {
                const Icon = row.icon;
                return (
                  // 아이콘 + 라벨 + 값 필 — 값 없는 행도 나열하되 톤 다운 (사용자 피드백 2026-08-30)
                  <div
                    key={row.key}
                    title={row.label}
                    className={`flex items-center gap-1.5 ${row.value ? "" : "opacity-40"}`}
                  >
                    <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{row.label}</span>
                    {row.value ? (
                      <span className="max-w-[55%] truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-px text-fine text-ink">
                        {row.value}
                      </span>
                    ) : (
                      <span className="shrink-0 text-fine text-ink-tertiary">-</span>
                    )}
                  </div>
                );
              })}
              {/* 조건·IO·GMP — SP 지정의 나머지 표시 필드. 없는 값은 동일하게 톤다운 대시 (사용자 피드백 2026-08-30) */}
              <div data-id="library-peek-io" className="mt-0.5 flex flex-col gap-1.5 border-t border-hairline pt-2">
                <div title={t("field.gmp")} className={`flex items-center gap-1.5 ${mockGmpLabel ? "" : "opacity-40"}`}>
                  <ShieldCheck size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{t("field.gmp")}</span>
                  {mockGmpLabel ? (
                    <span
                      className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border border-transparent px-1.5 py-0 text-[10px] leading-4"
                      style={getGmpBadgeStyle(spExtra?.gmp)}
                    >
                      <ShieldCheck size={10} strokeWidth={1.5} className="shrink-0" />
                      {mockGmpLabel}
                    </span>
                  ) : (
                    <span className="shrink-0 text-fine text-ink-tertiary">-</span>
                  )}
                </div>
                {[
                  {
                    key: "start_condition",
                    label: t("field.startCondition"),
                    icon: Play,
                    value: spExtra?.startCondition ?? "",
                  },
                  {
                    key: "end_condition",
                    label: t("field.endCondition"),
                    icon: Flag,
                    value: spExtra?.endCondition ?? "",
                  },
                ].map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.key}
                      title={row.value || row.label}
                      className={`flex items-center gap-1.5 ${row.value ? "" : "opacity-40"}`}
                    >
                      <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{row.label}</span>
                      {row.value ? (
                        <span className="max-w-[55%] truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-px text-fine text-ink">
                          {row.value}
                        </span>
                      ) : (
                        <span className="shrink-0 text-fine text-ink-tertiary">-</span>
                      )}
                    </div>
                  );
                })}
                {[
                  { key: "input", label: t("field.input"), icon: LogIn, lines: splitIoLines(spExtra?.input) },
                  { key: "output", label: t("field.output"), icon: LogOut, lines: splitIoLines(spExtra?.output) },
                ].map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.key} className={row.lines.length > 0 ? "" : "opacity-40"}>
                      <div className="flex items-center gap-1.5">
                        <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{row.label}</span>
                        {row.lines.length === 0 && <span className="shrink-0 text-fine text-ink-tertiary">-</span>}
                      </div>
                      {/* 항목 전부 나열 — 개행 구분 복수 항목(줄바꿈 허용) */}
                      {row.lines.length > 0 && (
                        <div className="mt-0.5 flex flex-col gap-0.5 pl-5">
                          {row.lines.map((line, index) => (
                            <span key={`${index}-${line}`} className="break-words text-fine text-ink">
                              {line}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* 메타 — 게시 버전·게시 시각·업무체계(전체 레벨). 없는 값은 동일하게 톤다운 대시 */}
              <div data-id="library-peek-meta" className="mt-0.5 flex flex-col gap-1.5 border-t border-hairline pt-2">
                {metaRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.key}
                      title={row.label}
                      className={`flex items-center gap-1.5 ${row.value ? "" : "opacity-40"}`}
                    >
                      <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">{row.label}</span>
                      {row.value ? (
                        <span className="max-w-[55%] truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-px text-fine text-ink">
                          {row.value}
                        </span>
                      ) : (
                        <span className="shrink-0 text-fine text-ink-tertiary">-</span>
                      )}
                    </div>
                  );
                })}
                <div className={metaCategoryPath ? "" : "opacity-40"} title={t("library.peekFramework")}>
                  <div className="flex items-center gap-1.5">
                    <FolderTree size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-fine text-ink-tertiary">
                      {t("library.peekFramework")}
                    </span>
                    {!metaCategoryPath && <span className="shrink-0 text-fine text-ink-tertiary">-</span>}
                  </div>
                  {/* 소속 시 전체 레벨 나열 — 줄바꿈 허용(레벨 모두 표시, 사용자 피드백 2026-08-30) */}
                  {metaCategoryPath && (
                    <div
                      data-id="library-peek-framework-path"
                      className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-5 text-fine text-ink"
                    >
                      {metaCategoryPath.split("/").map((segment, index) => (
                        <span key={`${index}-${segment}`} className="flex min-w-0 items-center gap-1">
                          {index > 0 && (
                            <ChevronRight size={10} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                          )}
                          <span className="break-words">{segment}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
