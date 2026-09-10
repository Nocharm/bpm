"use client";

// 홈 Framework 뷰 — 카테고리 행 선택 시 우측 패널에 레벨 요약을 보여준다. GET /categories/{id}/summary +
// (L1~L4) 직계 하위 목록 / (L5) 소속 맵 목록을 함께 불러 빈 공간을 실제 내용으로 채운다.
// 레이아웃은 map-detail-card.tsx 문법(경로 칩 → 제목 → 요약 타일 → SectionHeader 섹션)을 따른다
// (Track C Task 8 → 2026-09-10 목업 A 확정 재구성).

import {
  ChevronRight,
  CircleCheck,
  FolderTree,
  Layers,
  Loader2,
  Map as MapIcon,
  Network,
  ShieldCheck,
  User,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { SectionHeader } from "@/components/section-header";
import {
  getCategorySummary,
  listCategoryMaps,
  listCategoryNodes,
  type CategoryMaps,
  type CategoryNode,
  type CategorySummary,
  type MapSummary,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKstShort, relativeAgo } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";

interface CategorySummaryCardProps {
  categoryId: number;
  // 연계 캔버스 열기 — 있으면 이동, 없으면 생성 후 이동. 홈 Framework 트리 Linkage 버튼(page.tsx handleOpenLinkage)과
  // 동일 핸들러를 공유해 실패 토스트까지 일원화한다.
  onOpenCanvas: (node: { id: number; linkage_map_id: number | null }) => void;
  // 직계 하위 행 클릭(L1~L4) — 그 카테고리를 선택하고 트리를 펼친다(page.tsx selectChildCategory).
  onSelectChild?: (node: CategoryNode) => void;
  // 소속 맵 행 클릭(L5) — 맵 상세로 전환(page.tsx selectMap).
  onSelectMap?: (mapId: number) => void;
}

// 요약 타일 — 아이콘 라벨 + 큰 숫자(또는 짧은 텍스트). 색 톤은 확정 현황 타일이 재사용한다.
function StatTile({
  dataId,
  icon,
  label,
  value,
  tone = "plain",
}: {
  dataId: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "plain" | "added" | "error" | "muted";
}) {
  const toneClass =
    tone === "added"
      ? "border-added/40 bg-added/10 [&_.stat-label]:text-added [&_.stat-value]:text-added"
      : tone === "error"
        ? "border-error/40 bg-error/10 [&_.stat-label]:text-error [&_.stat-value]:text-error"
        : tone === "muted"
          ? "border-hairline bg-surface [&_.stat-label]:text-ink-tertiary [&_.stat-value]:text-ink-tertiary"
          : "border-hairline bg-surface [&_.stat-label]:text-ink-tertiary [&_.stat-value]:text-ink";
  return (
    <div data-id={dataId} className={`flex flex-col gap-2 rounded-sm border px-3 py-2.5 ${toneClass}`}>
      <div className="stat-label flex items-center gap-1.5 text-fine">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="stat-value text-[22px] font-bold leading-none tracking-tight">{value}</div>
    </div>
  );
}

export function CategorySummaryCard({ categoryId, onOpenCanvas, onSelectChild, onSelectMap }: CategorySummaryCardProps) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<CategorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 목록 — 요약 도착 후 레벨에 따라 한쪽만 채운다. null=미로드(로딩 표시), 실패는 빈 목록으로 두고 조용히 넘어간다
  // (요약이 본문이고 목록은 보조라 재시도 버튼까지는 두지 않는다).
  const [children, setChildren] = useState<CategoryNode[] | null>(null);
  const [maps, setMaps] = useState<CategoryMaps | null>(null);

  // categoryId 변경 시 page.tsx가 key={selectedCategoryId}로 리마운트시켜 초기 state(null)로 되돌린다 —
  // map-detail-card.tsx와 동일 관례. 이 effect는 fetch만 하고 동기 setState는 하지 않는다(set-state-in-effect 회피).
  useEffect(() => {
    let active = true;
    void getCategorySummary(categoryId)
      .then((res) => {
        if (!active) return;
        setSummary(res);
        if (res.level === 5) {
          void listCategoryMaps(categoryId)
            .then((m) => {
              if (active) setMaps(m);
            })
            .catch(() => {
              if (active) setMaps({ total: 0, hidden: 0, maps: [] });
            });
        } else {
          void listCategoryNodes(categoryId)
            .then((nodes) => {
              if (active) setChildren(nodes);
            })
            .catch(() => {
              if (active) setChildren([]);
            });
        }
      })
      .catch((err) => {
        if (active) setError(humanizeApiError(err, t));
      });
    return () => {
      active = false;
    };
  }, [categoryId, t]);

  function handleRetry() {
    setError(null);
    void getCategorySummary(categoryId)
      .then((res) => setSummary(res))
      .catch((err) => setError(humanizeApiError(err, t)));
  }

  // 상대 시각 — 홈 카드와 같은 문구(home.timeAgo.*)
  const relative = (iso: string): string => {
    const r = relativeAgo(iso);
    if (!r) return "";
    if (r.unit === "now") return t("home.timeAgo.now");
    if (r.unit === "min") return t("home.timeAgo.minutes", { n: r.n });
    if (r.unit === "hour") return t("home.timeAgo.hours", { n: r.n });
    return t("home.timeAgo.days", { n: r.n });
  };

  if (error) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center p-4">
        <button
          type="button"
          data-id="category-summary-retry"
          className="text-left text-caption text-error hover:underline"
          onClick={handleRetry}
        >
          {error}
        </button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div
        data-id="category-summary-loading"
        className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4"
      >
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-ink-tertiary" />
        <span className="text-caption text-ink-tertiary">{t("common.loading")}</span>
      </div>
    );
  }

  const l5 = summary.l5;
  const subtreeConfirm = summary.subtree_confirm;
  const pathSegments = summary.path.split("/").filter(Boolean);
  const canOpenCanvas = !!l5 && (l5.linkage_map_id !== null || l5.can_edit_linkage);

  // 게이트 상태 필 — 캔버스 없음(중립) / Ready(added) / Blocked(error)+실패 코드 필. 상태 라벨은
  // framework.overview.* 재사용, 실패 코드 필은 framework.gateFail.*(긍정문 framework.gate.*와 별도,
  // error 톤 극성 일치. final review Finding 2) — framework-overview.tsx의 renderStatus와 동일 소스.
  const renderGateStatus = () => {
    if (!l5 || l5.linkage_map_id === null) {
      return (
        <span className="inline-flex items-center rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
          {t("framework.overview.noCanvas")}
        </span>
      );
    }
    if (l5.ready) {
      return (
        <span className="inline-flex items-center rounded-sm border border-added px-1.5 py-0.5 text-fine text-added">
          {t("framework.overview.ready")}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap items-center justify-end gap-1">
        <span className="inline-flex items-center rounded-sm border border-error px-1.5 py-0.5 text-fine text-error">
          {t("framework.overview.blocked")}
        </span>
        {l5.failures.map((f) => (
          <span
            key={f.code}
            className="inline-flex items-center rounded-sm border border-error/40 bg-error/10 px-1.5 py-0.5 text-fine text-error"
          >
            {t(`framework.gateFail.${f.code}` as MessageKey)} ({f.count})
          </span>
        ))}
      </span>
    );
  };
  // L5 타일용 캔버스 한 단어 — 없음 / Ready / Blocked
  const canvasWord =
    !l5 || l5.linkage_map_id === null
      ? t("framework.overview.noCanvas")
      : l5.ready
        ? t("framework.overview.ready")
        : t("framework.overview.blocked");
  const canvasTone: "muted" | "added" | "error" =
    !l5 || l5.linkage_map_id === null ? "muted" : l5.ready ? "added" : "error";

  const confirmTotal = subtreeConfirm
    ? subtreeConfirm.confirmed + subtreeConfirm.not_ready + subtreeConfirm.no_canvas
    : 0;
  const pct = (n: number) => (confirmTotal > 0 ? `${(n / confirmTotal) * 100}%` : "0%");

  const renderMapRow = (m: MapSummary) => {
    const tone = m.latest_version_status ? VERSION_STATUS_TONE[m.latest_version_status] : null;
    return (
      <li key={m.id}>
        <button
          type="button"
          data-id="category-summary-map-row"
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-pearl"
          onClick={() => onSelectMap?.(m.id)}
        >
          <span className="min-w-0 flex-1 truncate text-caption text-ink">{m.name}</span>
          {m.latest_version_status && tone && (
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {VERSION_STATUS_LABEL_EN[m.latest_version_status]}
            </span>
          )}
          {m.sp_designated_at && (
            <span
              title={t("home.spBadgeTip")}
              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-accent-tint text-accent"
            >
              <Workflow size={11} strokeWidth={2.2} />
            </span>
          )}
          <span className="shrink-0 text-fine text-ink-tertiary">{relative(m.updated_at)}</span>
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-id="category-summary-card" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* 헤더 — 경로 칩(맵 상세와 동일 문법) + L배지·제목, L5는 캔버스 열기 버튼을 우측 고정 */}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              data-id="category-summary-path"
              title={summary.path}
              className="inline-flex max-w-full items-center gap-1 self-start rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent"
            >
              <Network size={12} strokeWidth={1.5} className="shrink-0" />
              <span className="flex min-w-0 items-center gap-1 truncate">
                {pathSegments.map((seg, i) => (
                  <span key={`${seg}-${i}`} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <span className="shrink-0 opacity-45">›</span>}
                    <span className={i === pathSegments.length - 1 ? "truncate font-semibold" : "truncate"}>{seg}</span>
                  </span>
                ))}
              </span>
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-fine font-semibold text-accent">
                L{summary.level}
              </span>
              <h2 className="min-w-0 truncate text-[20px] font-bold leading-tight text-ink">{summary.name}</h2>
            </div>
          </div>
          {/* 캔버스 존재 시 전원, 미존재 시 권한자만 — 트리 Linkage 버튼과 동일 규칙(node.can_edit_linkage) */}
          {canOpenCanvas && l5 && (
            <button
              type="button"
              data-id="category-summary-open-canvas"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-surface px-3 py-1.5 text-caption text-accent transition-colors duration-150 hover:bg-accent-tint"
              onClick={() => onOpenCanvas({ id: summary.id, linkage_map_id: l5.linkage_map_id })}
            >
              <Workflow size={14} strokeWidth={1.5} />
              {t("category.summary.openCanvas")}
            </button>
          )}
        </div>

        {/* 요약 타일 3종 — L1~L4: 직계 하위/서브트리 L5/서브트리 맵, L5: 소속 맵/관리자/연계 캔버스 */}
        {l5 ? (
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              dataId="category-summary-tile-maps"
              icon={<MapIcon size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.mapsSection")}
              value={maps ? maps.total : summary.subtree_map_count}
            />
            <StatTile
              dataId="category-summary-tile-admins"
              icon={<ShieldCheck size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.admins")}
              value={summary.admins.length}
            />
            <StatTile
              dataId="category-summary-tile-canvas"
              icon={<Workflow size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.canvasSection")}
              value={<span className="text-caption-strong">{canvasWord}</span>}
              tone={canvasTone}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              dataId="category-summary-tile-children"
              icon={<FolderTree size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.children")}
              value={summary.child_count}
            />
            <StatTile
              dataId="category-summary-tile-l5"
              icon={<Layers size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.subtreeL5")}
              value={summary.subtree_l5_count}
            />
            <StatTile
              dataId="category-summary-tile-subtree-maps"
              icon={<MapIcon size={13} strokeWidth={1.5} className="shrink-0" />}
              label={t("category.summary.subtreeMaps")}
              value={summary.subtree_map_count}
            />
          </div>
        )}

        {/* 관리자 필 목록 — 이름 + L{level} 캡션(권한 상속 기준 레벨) */}
        <section className="flex flex-col gap-2">
          <SectionHeader
            dataId="category-summary-admins-header"
            title={t("category.summary.admins")}
            icon={ShieldCheck}
            count={summary.admins.length}
            collapsed={false}
          />
          {summary.admins.length === 0 ? (
            <span
              data-id="category-summary-no-admins"
              className="inline-flex self-start rounded-full border border-dashed border-hairline px-2.5 py-1 text-fine text-ink-muted"
            >
              {t("category.summary.noAdmins")}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {summary.admins.map((a) => (
                <span
                  key={a.login_id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 py-1 pl-2 pr-2.5 text-fine text-ink-secondary"
                >
                  <User size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  {a.name}
                  <span className="text-ink-tertiary">L{a.level}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* L1~L4 — 직계 하위 목록(드릴다운) */}
        {!l5 && (
          <section className="flex flex-col gap-2">
            <SectionHeader
              dataId="category-summary-children-header"
              title={t("category.summary.children")}
              icon={FolderTree}
              count={children ? children.length : summary.child_count}
              collapsed={false}
            />
            {children === null ? (
              <div className="flex items-center gap-2 px-1 text-fine text-ink-tertiary">
                <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
                {t("common.loading")}
              </div>
            ) : children.length === 0 ? (
              <span className="text-fine text-ink-tertiary">{t("category.summary.noChildren")}</span>
            ) : (
              <ul data-id="category-summary-children" className="flex flex-col divide-y divide-divider rounded-sm border border-hairline bg-surface">
                {children.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-id={`category-summary-child-${c.id}`}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-pearl"
                      onClick={() => onSelectChild?.(c)}
                    >
                      <span className="shrink-0 rounded-full bg-accent-tint px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent">
                        L{c.level}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-caption text-ink">{c.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-fine text-ink-tertiary" title={t("category.summary.subtreeMaps")}>
                        <MapIcon size={12} strokeWidth={1.5} />
                        {c.map_count}
                      </span>
                      {c.level === 5 && c.linkage_map_id !== null && (
                        <Workflow size={12} strokeWidth={1.5} className="shrink-0 text-accent" />
                      )}
                      <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* L1~L4 — 서브트리 L5 확정 현황 3종(상호배타 집계) + 비율 바 */}
        {subtreeConfirm && (
          <section className="flex flex-col gap-2">
            <SectionHeader
              dataId="category-summary-confirm-header"
              title={t("category.summary.subtreeSection")}
              icon={CircleCheck}
              collapsed={false}
              right={<span className="text-fine text-ink-tertiary">{t("category.summary.l5Count", { n: confirmTotal })}</span>}
            />
            <div data-id="category-summary-confirm-bar" className="flex h-1.5 overflow-hidden rounded-full bg-surface-chip">
              <span className="h-full bg-added transition-[width] duration-300" style={{ width: pct(subtreeConfirm.confirmed) }} />
              <span className="h-full bg-error transition-[width] duration-300" style={{ width: pct(subtreeConfirm.not_ready) }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                dataId="category-summary-tile-confirmed"
                icon={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-added" />}
                label={t("status.confirmed")}
                value={subtreeConfirm.confirmed}
                tone="added"
              />
              <StatTile
                dataId="category-summary-tile-not-ready"
                icon={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" />}
                label={t("category.summary.notReady")}
                value={subtreeConfirm.not_ready}
                tone="error"
              />
              <StatTile
                dataId="category-summary-tile-no-canvas"
                icon={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-surface-chip" />}
                label={t("framework.overview.noCanvas")}
                value={subtreeConfirm.no_canvas}
                tone="muted"
              />
            </div>
          </section>
        )}

        {/* L5 — 연계 캔버스 상태(최신 확정·게이트) */}
        {l5 && (
          <section className="flex flex-col gap-2">
            <SectionHeader
              dataId="category-summary-canvas-header"
              title={t("category.summary.canvasSection")}
              icon={Workflow}
              collapsed={false}
            />
            <div data-id="category-summary-canvas" className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {l5.latest_fw ? (
                  <>
                    <span className="truncate text-caption-strong text-ink">{l5.latest_fw}</span>
                    {l5.confirmed_at && (
                      <span className="text-fine text-ink-tertiary">
                        {formatKstShort(l5.confirmed_at)}
                        {l5.confirmed_by ? ` · ${l5.confirmed_by}` : ""}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-caption text-ink-tertiary">{t("framework.notConfirmedShort")}</span>
                    {l5.linkage_map_id === null && (
                      <span className="text-fine text-ink-muted">{t("category.summary.canvasHint")}</span>
                    )}
                  </>
                )}
              </div>
              <div className="shrink-0">{renderGateStatus()}</div>
            </div>
          </section>
        )}

        {/* L5 — 소속 맵 목록(클릭 → 맵 상세) */}
        {l5 && (
          <section className="flex flex-col gap-2">
            <SectionHeader
              dataId="category-summary-maps-header"
              title={t("category.summary.mapsSection")}
              icon={MapIcon}
              count={maps ? maps.total : undefined}
              collapsed={false}
            />
            {maps === null ? (
              <div className="flex items-center gap-2 px-1 text-fine text-ink-tertiary">
                <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
                {t("common.loading")}
              </div>
            ) : maps.maps.length === 0 ? (
              <span className="text-fine text-ink-tertiary">{t("category.summary.noMaps")}</span>
            ) : (
              <ul data-id="category-summary-maps" className="flex flex-col divide-y divide-divider rounded-sm border border-hairline bg-surface">
                {maps.maps.map(renderMapRow)}
                {maps.hidden > 0 && (
                  <li className="px-3 py-1.5 text-fine text-ink-tertiary">{t("home.frameworkHidden", { n: maps.hidden })}</li>
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
