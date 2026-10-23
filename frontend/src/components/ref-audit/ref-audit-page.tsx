// 고아 참조 페이지 — 히어로 + 부서·사용자 두 섹션(카드 그리드)의 로드·에러·빈 상태. 설정 > 점검 > 고아 참조 탭 본문이다.
// 카드 그리드는 items-stretch가 필요하다 - 비율(aspect-ratio) 카드는 기본 정렬이 start라 한 행에서 긴 카드만 자란다.
"use client";

import { Building2, CircleCheck, UserX, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { RefAuditHero } from "@/components/ref-audit/ref-audit-hero";
import { RefDeptCard } from "@/components/ref-audit/ref-dept-card";
import { RefDetailDialog } from "@/components/ref-audit/ref-detail-dialog";
import { RefUserCard } from "@/components/ref-audit/ref-user-card";
import { getRefAudit, type RefApplyResult, type RefAuditData, type RefCard } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { sortCards } from "@/lib/ref-audit";
import { notifyRefAuditChanged } from "@/lib/ref-audit-summary";
import { formatAppliedToast } from "@/lib/ref-audit-view";

// 스캔 한 번의 결과 — key가 reloadKey와 다르면 아직 그 스캔이 끝나지 않은 것
interface ScanResult {
  key: number;
  page: RefAuditData | null;
  error: unknown;
}

interface SectionProps {
  dataId: string;
  icon: LucideIcon;
  round?: boolean;
  titleKey: MessageKey;
  subKey: MessageKey;
  count: number;
  children: ReactNode;
}

function Section({ dataId, icon: Icon, round, titleKey, subKey, count, children }: SectionProps) {
  const { t } = useI18n();
  return (
    <section
      data-id={dataId}
      className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-hairline bg-surface-pearl px-[18px] pb-[18px] pt-4"
    >
      <header className="flex items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center border border-warn/40 bg-warn/10 text-warn ${round ? "rounded-full" : "rounded-sm"}`}
        >
          <Icon size={18} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-body-strong text-ink">
            {t(titleKey)}
            <span
              data-id={`${dataId}-count`}
              className="rounded-full border border-hairline bg-surface px-2 text-fine font-normal leading-5 text-ink-tertiary"
            >
              {count}
            </span>
          </span>
          <span className="text-fine text-ink-tertiary">{t(subKey)}</span>
        </span>
      </header>
      {children}
    </section>
  );
}

interface RefAuditPageProps {
  onToast: (message: string) => void; // 적용 결과 요약 — 설정 화면의 토스트 스택에 올린다
}

export function RefAuditPage({ onToast }: RefAuditPageProps) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  // 카드를 누르면 담긴다 - 상세 창이 이 카드를 읽는다
  const [selected, setSelected] = useState<RefCard | null>(null);

  useEffect(() => {
    let isAlive = true;
    getRefAudit()
      .then((page) => {
        if (!isAlive) return;
        setResult({ key: reloadKey, page, error: null });
        // 처음 로드는 TopNav 요약이 이미 받았다 - 다시 스캔했을 때만 빨간 점을 갱신한다
        if (reloadKey > 0) notifyRefAuditChanged();
      })
      .catch((error: unknown) => {
        if (isAlive) setResult({ key: reloadKey, page: null, error });
      });
    return () => {
      isAlive = false;
    };
  }, [reloadKey]);

  const isLoading = result === null || result.key !== reloadKey;
  const page = result?.page ?? null;
  const departments = page ? sortCards(page.departments) : [];
  const users = page ? sortCards(page.users) : [];
  const openCard = selected
    ? ([...departments, ...users].find((card) => card.kind === selected.kind && card.key === selected.key) ?? selected)
    : null;

  function handleRescan() {
    setReloadKey((key) => key + 1);
  }

  function handleOpenCard(card: RefCard) {
    setSelected(card);
  }

  // 적용이 끝나면 창을 닫고 결과를 토스트로 알린 뒤 다시 스캔한다. 재스캔 성공 경로가 notifyRefAuditChanged()로 빨간 점도 갱신한다.
  // 뒤 묶음이 실패한 부분 적용(isPartial)은 창을 열어 둬 오류를 보이고, 재스캔 결과의 카드로 줄을 바꿔 끼운다
  function handleApplied(results: RefApplyResult[], isPartial = false) {
    if (!isPartial) setSelected(null);
    onToast(formatAppliedToast(results, t));
    setReloadKey((key) => key + 1);
  }

  let body: ReactNode;
  if (result?.error) {
    body = (
      <p
        data-id="ref-audit-error"
        role="alert"
        className="rounded-md border border-error/30 bg-error/5 px-4 py-3 text-caption text-error"
      >
        {humanizeApiError(result.error, t)}
      </p>
    );
  } else if (page === null) {
    body = (
      <p data-id="ref-audit-loading" className="py-10 text-center text-caption text-ink-tertiary">
        {t("refAudit.hero.scanning")}
      </p>
    );
  } else if (departments.length === 0 && users.length === 0) {
    body = (
      <div
        data-id="ref-audit-empty"
        className="flex flex-col items-center gap-2 rounded-lg border border-hairline bg-surface-pearl px-6 py-12 text-center"
      >
        <CircleCheck size={28} strokeWidth={1.5} className="text-added" aria-hidden />
        <p className="max-w-[420px] text-caption text-ink-secondary">{t("refAudit.empty")}</p>
      </div>
    );
  } else {
    body = (
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @[1080px]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Section
          dataId="ref-audit-depts"
          icon={Building2}
          titleKey="refAudit.section.depts.title"
          subKey="refAudit.section.depts.sub"
          count={departments.length}
        >
          {departments.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] items-stretch gap-3">
              {departments.map((card) => (
                <RefDeptCard key={card.key} card={card} onOpen={handleOpenCard} />
              ))}
            </div>
          ) : (
            <p data-id="ref-audit-depts-none" className="py-4 text-center text-caption text-ink-tertiary">
              {t("refAudit.section.none")}
            </p>
          )}
        </Section>
        <Section
          dataId="ref-audit-users"
          icon={UserX}
          round
          titleKey="refAudit.section.users.title"
          subKey="refAudit.section.users.sub"
          count={users.length}
        >
          {users.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] items-stretch gap-3">
              {users.map((card) => (
                <RefUserCard key={card.key} card={card} onOpen={handleOpenCard} />
              ))}
            </div>
          ) : (
            <p data-id="ref-audit-users-none" className="py-4 text-center text-caption text-ink-tertiary">
              {t("refAudit.section.none")}
            </p>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div data-id="ref-audit-page" className="@container flex flex-col gap-5">
      <RefAuditHero page={page} loading={isLoading} onRescan={handleRescan} />
      {body}
      {openCard ? (
        <RefDetailDialog
          key={`${openCard.kind}:${openCard.key}`}
          card={openCard}
          onClose={() => setSelected(null)}
          onApplied={handleApplied}
        />
      ) : null}
    </div>
  );
}
