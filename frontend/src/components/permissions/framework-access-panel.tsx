// 프레임워크 캔버스 설정의 "편집 가능자" 읽기전용 패널 — 캔버스(mode=framework)는 map_permissions를 무시하고
// 결착 카테고리 체인 관리자만 편집하므로 협업자·승인자 탭 대신 이 패널을 둔다(사용자 결정 2026-09-21, (i)안).
// 내용: 결착 카테고리 경로 · 관리 부서(상속 반영) · 체인 관리자(직속 L5 관리자 = 확정 가능 표시). 지정은 설정 > Categories.
"use client";

import { Building2, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getCategorySummary, type CategorySummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { DeptPill } from "@/components/dept-pill";
import { LevelPill } from "@/components/level-pill";

interface FrameworkAccessPanelProps {
  categoryId: number;
  categoryPath: string | null;
}

export function FrameworkAccessPanel({ categoryId, categoryPath }: FrameworkAccessPanelProps) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<CategorySummary | null>(null);
  useEffect(() => {
    let active = true;
    void getCategorySummary(categoryId)
      .then((s) => {
        if (active) setSummary(s);
      })
      .catch(() => {
        /* 요약 실패 — 경로만 표시 */
      });
    return () => {
      active = false;
    };
  }, [categoryId]);
  const segments = (categoryPath ?? "").split("/").filter(Boolean);
  const dept = summary?.effective_admin_department ?? null;
  return (
    <div data-id="settings-framework-access" className="flex max-w-xl flex-col gap-4">
      <p className="text-caption text-ink-secondary">{t("perm.framework.accessHint")}</p>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-secondary">{t("perm.framework.linkedCategory")}</span>
        <div data-id="settings-framework-category" className="flex flex-wrap items-center gap-1 rounded-sm border border-hairline px-3 py-2 text-caption">
          <LevelPill level={5} size="sm" />
          {segments.map((name, i) => (
            <span key={`${i}-${name}`} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-ink-muted">›</span>}
              <span className={i === segments.length - 1 ? "font-semibold text-ink" : "text-ink-secondary"}>{name}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-secondary">{t("category.summary.managingDept")}</span>
        <div className="flex min-h-[30px] items-center gap-2">
          {dept ? (
            <>
              <DeptPill department={dept} dataId="settings-framework-dept" />
              {summary?.admin_department_source && (
                <span className="text-fine text-ink-tertiary">
                  {t("category.summary.inheritedFrom", { name: summary.admin_department_source })}
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-hairline px-2.5 py-1 text-fine text-ink-muted">
              <Building2 size={12} strokeWidth={1.5} />
              {t("category.summary.noManagingDept")}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink-secondary">{t("category.summary.admins")}</span>
        {summary === null ? (
          <span className="text-fine text-ink-tertiary">{t("common.loading")}</span>
        ) : summary.admins.length === 0 ? (
          <span className="inline-flex self-start rounded-full border border-dashed border-hairline px-2.5 py-1 text-fine text-ink-muted">
            {t("category.summary.noAdmins")}
          </span>
        ) : (
          <ul data-id="settings-framework-admins" className="flex flex-wrap gap-1.5">
            {summary.admins.map((a) => (
              <li
                key={a.login_id}
                data-id={`settings-framework-admin-${a.login_id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 py-1 pl-2 pr-2.5 text-fine text-ink-secondary"
              >
                <User size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                {a.name}
                <span className="text-ink-tertiary">L{a.level}</span>
                {a.level === 5 && (
                  <span
                    title={t("perm.framework.canConfirm")}
                    className="inline-flex items-center gap-0.5 rounded-sm bg-accent-tint px-1 py-0.5 text-[10px] font-semibold text-accent"
                  >
                    <ShieldCheck size={10} strokeWidth={2} />
                    {t("perm.framework.canConfirmShort")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href="/settings?tab=categories"
        data-id="settings-framework-manage-link"
        className="self-start text-caption text-accent hover:underline"
      >
        {t("perm.framework.manageLink")}
      </Link>
    </div>
  );
}
