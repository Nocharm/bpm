"use client";

// 설정 > 조직 > Orphaned refs 탭 — 부서·사용자 두 섹션에 고아 참조 그룹 카드를 나열하고 재스캔·결과 문구를 관리.
// 스캔은 서버 온디맨드(GET /admin/ref-audit) — 적용/알림 뒤 다시 불러 배지·목록이 즉시 맞는다.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { getRefAudit, type RefAudit, type RefGroup } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { useDirectory, useDirectoryDepartments } from "@/lib/directory";
import { useI18n } from "@/lib/i18n";
import { useSectionMotion } from "@/lib/use-closing-keys";
import { RefGroupCard } from "./ref-group-card";

export function RefAuditPanel() {
  const { t } = useI18n();
  const [audit, setAudit] = useState<RefAudit | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { closingKeys, getSectionClass, openSection, closeSection } = useSectionMotion<string>();
  const directory = useDirectory();
  const departments = useDirectoryDepartments();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAudit(await getRefAudit());
      setError("");
    } catch (err) {
      setError(humanizeApiError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 명시적 Rescan 클릭만 이전 결과 문구를 지운다 — 적용/알림 뒤 자동 재로드(done→load)는
  // 방금 세팅한 성공 메시지를 유지해야 하므로 load() 자체에는 넣지 않는다.
  const rescan = () => {
    setMessage("");
    void load();
  };

  useEffect(() => { void load(); }, [load]);

  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name, korean_name: d.korean_name }));
  const users = [...directory.values()];
  const pickerUsers = users.map((u) => ({
    id: u.id, name: u.name, email: "", departmentId: "",
    status: "active" as const, isSysadmin: false, korean_name: u.korean_name ?? "",
  }));
  const userDepartments = Object.fromEntries(users.map((u) => [u.id, u.department]));

  const keyOf = (g: RefGroup) => `${g.kind}-${g.value_kind}-${g.value}`;
  const toggle = (g: RefGroup) => {
    const k = keyOf(g);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) { next.delete(k); closeSection(k); }
      else { next.add(k); openSection(k, true); }
      return next;
    });
  };
  const done = (msg: string) => {
    setMessage(msg);
    void load();
  };

  const section = (title: string, empty: string, groups: RefGroup[], dataId: string) => (
    <section className="flex flex-col gap-2" data-id={dataId}>
      <div className="flex items-center gap-2">
        <p className="text-caption-strong text-ink">{title}</p>
        <span className="rounded-full bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary">{groups.length}</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-fine text-ink-tertiary" data-id={`${dataId}-empty`}>{empty}</p>
      ) : groups.map((g) => (
        <RefGroupCard
          key={keyOf(g)}
          group={g}
          deptOptions={deptOptions}
          pickerUsers={pickerUsers}
          userDepartments={userDepartments}
          sectionClass={getSectionClass(keyOf(g))}
          // 닫히는 중(고스트)도 마운트 유지해 accordion-close가 재생되게 한다 — 쉐브런/aria는 open(실제 토글)만 따른다.
          expanded={expanded.has(keyOf(g)) || closingKeys.has(keyOf(g))}
          open={expanded.has(keyOf(g))}
          onToggle={() => toggle(g)}
          onDone={done}
        />
      ))}
    </section>
  );

  return (
    <div className="flex flex-col gap-4" data-id="ref-audit-panel">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-fine text-ink-tertiary">{t("refAudit.intro")}</p>
        <button
          type="button"
          data-id="ref-audit-rescan"
          className="inline-flex items-center gap-1 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40"
          disabled={loading}
          onClick={rescan}
        >
          <RefreshCw size={14} strokeWidth={1.5} className={loading ? "animate-spin" : ""} />
          {t("refAudit.rescan")}
        </button>
      </div>
      {error && <p className="text-caption text-error" data-id="ref-audit-error">{error}</p>}
      {message && <p className="text-fine text-ink-secondary" data-id="ref-audit-message">{message}</p>}
      {audit && section(t("refAudit.deptTitle"), t("refAudit.emptyDept"), audit.departments, "ref-audit-depts")}
      {audit && section(t("refAudit.userTitle"), t("refAudit.emptyUser"), audit.users, "ref-audit-users")}
    </div>
  );
}
