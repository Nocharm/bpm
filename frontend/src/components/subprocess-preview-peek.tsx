"use client";

// 서브프로세스 라이브러리/체계 피커 행의 미리보기 피크 — 행 클릭 즉시·2.5초 호버로 열리는 포털 패널.
// 게시본 기준 그래프(getResolvedGraph follow_latest → 최신 게시본, 없으면 최신본)를 ScopePreview(경량 SVG)로
// 렌더하고 SP 등록 정보를 함께 보여준다. viewer 미만은 locked 응답 → 권한 안내 + "추가는 가능" 안내.
// 미리보기 영역에 마우스가 있으면 우상단에 "Add to map" 버튼이 나타난다 (사용자 요청 2026-08-30).

import {
  Building2,
  Clock,
  Lock,
  Network,
  Plus,
  RefreshCw,
  Server,
  User,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getResolvedGraph, type VersionGraph } from "@/lib/api";
import { resolveNodeStroke } from "@/components/process-node";
import { ScopePreview } from "@/components/scope-preview";
import { formatDurationHm } from "@/lib/duration";
import { useI18n } from "@/lib/i18n";

// 행 호버로 피크가 열리기까지의 지연 — 스침 오픈 방지(클릭은 즉시)
export const PEEK_HOVER_DELAY_MS = 2500;

export interface SubprocessPeekInfo {
  department: string | null;
  assignee: string | null;
  system: string | null;
  duration: string | null;
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
  onAdd,
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
  onAdd: () => void;
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

  // 캔버스 속성 줄 규범 순서(담당자→부서→시스템) + 소요시간 — 아이콘은 process-node FIELD_ICON과 동일
  const infoRows: { key: string; label: string; icon: LucideIcon; value: string }[] = designated
    ? [
        { key: "assignee", label: t("field.assignee"), icon: User, value: info.assignee ?? "" },
        { key: "department", label: t("field.department"), icon: Building2, value: info.department ?? "" },
        { key: "system", label: t("field.system"), icon: Server, value: info.system ?? "" },
        {
          key: "duration",
          label: t("field.duration"),
          icon: Clock,
          value: info.duration ? formatDurationHm(info.duration) : "",
        },
      ]
    : [];
  // 추가될 SP 노드 목업 색 — 캔버스 정본(resolveNodeStroke, subprocess=단일 바이올렛 고정)
  const spStroke = resolveNodeStroke("", "subprocess");

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
      {/* body — 추가될 노드 목업(좌) + 미리보기(중) + SP 등록 정보(우) (사용자 피드백 2026-08-30) */}
      <div className="flex min-h-0">
        {/* 추가될 노드 — Add 시 캔버스에 렌더될 SP 노드 목업(캔버스 정본 색·필 파생·최신 추종 표기) */}
        <div className="flex w-44 shrink-0 flex-col justify-center gap-2 border-r border-hairline px-3">
          <span className="text-fine text-ink-tertiary">{t("library.peekNodePreview")}</span>
          <div
            data-id="library-peek-node-mock"
            className="rounded-sm px-2.5 py-2"
            style={{
              border: `1.5px solid ${spStroke}`,
              background: `color-mix(in srgb, ${spStroke} 18%, white)`,
            }}
          >
            <div className="flex items-start gap-1.5">
              <Workflow size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: spStroke }} />
              <span className="min-w-0 break-words text-fine font-medium text-ink">{name}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-fine text-ink-tertiary">
              <RefreshCw size={10} strokeWidth={1.5} className="shrink-0" />
              <span className="truncate">{t("subprocess.followingBanner")}</span>
            </div>
          </div>
        </div>
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
        {/* SP 등록 정보 — 미등록 행은 서버가 값 마스킹(전부 null)이라 컬럼 생략(미리보기가 전폭 사용) */}
        {designated && (
          <div
            data-id="library-peek-info"
            className="flex w-52 shrink-0 flex-col gap-1.5 overflow-y-auto border-l border-hairline px-3 py-2"
          >
            <span className="text-fine font-semibold text-ink-secondary">{t("library.peekInfoTitle")}</span>
            {infoRows.map((row) => {
              const Icon = row.icon;
              return (
                // 아이콘 + 값 필 태그 — 라벨은 툴팁으로(가시성 재배열, 사용자 피드백 2026-08-30)
                <div key={row.key} title={row.label} className="flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  {row.value ? (
                    <span className="min-w-0 truncate rounded-xs border border-hairline bg-surface-alt px-1.5 py-px text-fine text-ink">
                      {row.value}
                    </span>
                  ) : (
                    <span className="text-fine text-ink-tertiary">-</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
