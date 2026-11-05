// 홈 대시보드 "진행 중 실행" 첫 실행 권유 칸 — 실행을 써 본 적 없는 사람이 타일을 누르면 펼친다. 세 단계 그림 소개가
// 짧게 돈 뒤(누르면 건너뜀, 모션 축소면 생략) 설명과 실행해 볼 맵 줄이 나온다. 줄을 누르면 0.6초 지연 이동으로 그 맵의
// 새 실행 창을 연다(레이어 클릭 = 취소). 활동 타일이 펼치고, 보일지는 lib/run-onboard가 정한다(사용자 결정 2026-11-05).
"use client";

import { FileCheck2, Footprints, MessageSquareText, Play, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useState, type CSSProperties } from "react";

import type { MapSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { buildNewRunHref } from "@/lib/run-onboard";
import { useDelayedNav } from "@/lib/use-delayed-nav";
import { NavPendingScope } from "@/components/nav-pending-scope";

// 소개 길이(ms) — 마지막 단계가 차고(1.4초+0.45초) 잠깐 머문 뒤 본 칸으로. globals.css .run-onboard-* 차례와 맞춘다
const RUN_ONBOARD_INTRO_MS = 2600;
// 단계 사이 간격(ms) — 원 하나가 차는 동안 다음 선이 자란다
const STEP_GAP_MS = 700;

const STEPS: { Icon: LucideIcon; label: MessageKey }[] = [
  { Icon: FileCheck2, label: "home.dash.runOnboard.stepPick" },
  { Icon: Footprints, label: "home.dash.runOnboard.stepWalk" },
  { Icon: MessageSquareText, label: "home.dash.runOnboard.stepNote" },
];

interface DashboardRunOnboardProps {
  maps: MapSummary[]; // 실행해 볼 맵 — pickRunOnboardMaps 결과
}

export function DashboardRunOnboard(props: DashboardRunOnboardProps) {
  return (
    <NavPendingScope dataId="home-run-onboard" className="rounded-sm">
      <RunOnboardBody {...props} />
    </NavPendingScope>
  );
}

// 소개 그림 차례 — globals.css .run-onboard-*가 읽는다
function getStepDelayStyle(ms: number): CSSProperties {
  return { "--step-delay": `${ms}ms` } as CSSProperties;
}

function isReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 스코프 안쪽에서 훅을 돌려야 이 칸의 레이어에 보고된다
function RunOnboardBody({ maps }: DashboardRunOnboardProps) {
  const { t } = useI18n();
  const { pending, toggle } = useDelayedNav();
  const [isIntro, setIsIntro] = useState(() => !isReducedMotion());
  useEffect(() => {
    if (!isIntro) return;
    const timer = window.setTimeout(() => setIsIntro(false), RUN_ONBOARD_INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [isIntro]);
  const goingLabel = t("home.dash.navGoing", { dest: t("home.dash.destRun") });
  return (
    <div className="flex flex-col rounded-sm border border-accent-tint-border bg-surface">
      {isIntro ? (
        <button
          type="button"
          data-id="home-run-onboard-intro"
          aria-label={t("home.dash.runOnboard.skip")}
          title={t("home.dash.runOnboard.skip")}
          onClick={() => setIsIntro(false)}
          className="flex items-start justify-center px-3 py-4"
        >
          {STEPS.map(({ Icon, label }, index) => (
            <Fragment key={label}>
              {index > 0 && (
                <span
                  className="run-onboard-link mt-[15px] h-px w-10 shrink-0 bg-run-done"
                  style={getStepDelayStyle(index * STEP_GAP_MS - 250)}
                />
              )}
              <span className="flex w-28 shrink-0 flex-col items-center gap-1.5">
                <span
                  className="run-onboard-step flex size-8 items-center justify-center rounded-full border-[1.5px] border-run-done bg-run-done-fill text-run-done"
                  style={getStepDelayStyle(index * STEP_GAP_MS)}
                >
                  <Icon size={16} strokeWidth={1.5} />
                </span>
                <span
                  className="run-onboard-caption text-center text-fine text-ink-secondary"
                  style={getStepDelayStyle(index * STEP_GAP_MS + 150)}
                >
                  {t(label)}
                </span>
              </span>
            </Fragment>
          ))}
        </button>
      ) : (
        <div data-id="home-run-onboard-main" className="animate-item-in flex flex-col">
          <p className="border-b border-hairline px-3 py-2 text-fine text-ink-secondary">{t("home.dash.runOnboard.body")}</p>
          <ul data-id="home-run-onboard-list">
            {maps.map((map) => {
              const href = buildNewRunHref(map.id);
              const selecting = pending === href;
              return (
                <li key={map.id}>
                  <button
                    type="button"
                    data-id={`home-run-onboard-row-${map.id}`}
                    data-selecting={selecting || undefined}
                    onClick={() => toggle(href, goingLabel)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-surface-pearl [li+li>&]:border-t [li+li>&]:border-divider ${
                      selecting ? "bg-accent-tint/40" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-caption-strong text-ink">{map.name}</span>
                    <span className="shrink-0 text-fine tabular-nums text-ink-tertiary">v{map.published_version_number}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-tint-border bg-accent-tint px-2 py-px text-fine font-semibold text-accent">
                      <Play size={12} strokeWidth={1.5} />
                      {t("run.menu.new")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-hairline bg-surface-alt px-3 py-1 text-fine text-ink-tertiary">{t("home.dash.runOnboard.foot")}</p>
        </div>
      )}
    </div>
  );
}
