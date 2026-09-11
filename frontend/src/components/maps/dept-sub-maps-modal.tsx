// 홈 대시보드 내 부서 카드 — 하위 부서 맵 모달. 고른 범위 아래 부서별로 맵을 묶어 간단히 보여준다(사용자 지시 2026-09-11).
// 부서 행 클릭 → 범위 드롭다운을 그 부서로 전환 + 좌측 트리 펼침, 맵 행 클릭 → 그 맵 선택. 둘 다 모달을 닫는다.
// 공용 ModalBackdrop(바깥 mousedown·Escape 닫기) + 포털, z는 모달 사다리(1200).
"use client";

import { Building2, ChevronRight, X } from "lucide-react";
import { useMemo } from "react";
import { createPortal } from "react-dom";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { VERSION_STATUS_TONE } from "@/lib/version-status";
import { ModalBackdrop } from "@/components/modal-backdrop";

interface DeptSubMapsModalProps {
  scope: string; // 기준 부서 경로 — 제목·상대 경로 계산
  maps: MapSummary[]; // scope 하위 부서 소유 맵(접근 가능한 것만)
  onPickDept: (path: string) => void;
  onSelectMap: (id: number) => void;
  onClose: () => void;
}

// 부서 경로 → 맵 묶음, 경로순. 상대 경로(scope 이후 세그먼트)를 함께 둔다
function groupByDept(maps: MapSummary[], scope: string): { path: string; segments: string[]; maps: MapSummary[] }[] {
  const byPath = new Map<string, MapSummary[]>();
  for (const m of maps) {
    const path = m.owning_department ?? "";
    byPath.set(path, [...(byPath.get(path) ?? []), m]);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, list]) => ({
      path,
      segments: path.slice(scope.length + 1).split("/").filter(Boolean),
      maps: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export function DeptSubMapsModal({ scope, maps, onPickDept, onSelectMap, onClose }: DeptSubMapsModalProps) {
  const { t } = useI18n();
  const groups = useMemo(() => groupByDept(maps, scope), [maps, scope]);
  const scopeLeaf = scope.split("/").filter(Boolean).at(-1) ?? scope;
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="dept-sub-maps-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-hover-modal-in flex max-h-[70vh] w-full max-w-[28rem] flex-col rounded-sm border border-hairline bg-surface shadow-lg"
      >
        <header className="flex items-center gap-2 border-b border-divider px-4 py-3">
          <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="truncate text-body-strong text-ink">{t("home.dash.subDeptTitle", { dept: scopeLeaf })}</h2>
            <p className="text-fine text-ink-tertiary">{t("home.dash.subDeptHint")}</p>
          </div>
          <button
            type="button"
            data-id="dept-sub-maps-close"
            onClick={onClose}
            aria-label={t("action.close")}
            className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>
        <div data-id="dept-sub-maps-list" className="scroll-soft flex flex-col overflow-y-auto py-1">
          {groups.map((g) => (
            <section key={g.path} data-id={`dept-sub-group-${g.path}`} className="flex flex-col">
              {/* 부서 행 — 범위 전환 + 트리 펼침 */}
              <button
                type="button"
                data-id="dept-sub-dept"
                data-path={g.path}
                onClick={() => { onPickDept(g.path); onClose(); }}
                className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-surface-alt"
              >
                <Building2 size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-caption text-ink">
                  {g.segments.map((seg, i) => (
                    <span key={i} className="inline-flex min-w-0 items-center gap-1">
                      {i > 0 && <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-ink-muted" />}
                      <span className={`truncate ${i === g.segments.length - 1 ? "font-semibold" : "text-ink-secondary"}`}>{seg}</span>
                    </span>
                  ))}
                </span>
                <span className="shrink-0 text-fine tabular-nums text-ink-tertiary">{t("home.dash.subDeptMapCount", { n: g.maps.length })}</span>
              </button>
              {/* 맵 행 — 선택 */}
              {g.maps.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-id="dept-sub-map"
                  data-map-id={m.id}
                  onClick={() => { onSelectMap(m.id); onClose(); }}
                  className="flex w-full items-center gap-2 py-1.5 pr-4 pl-10 text-left hover:bg-surface-pearl"
                >
                  {m.latest_version_status ? (
                    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${VERSION_STATUS_TONE[m.latest_version_status].dot}`} />
                  ) : (
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-hairline" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">{m.name}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
