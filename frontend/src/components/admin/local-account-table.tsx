"use client";

// 로컬 계정(외부 컨설턴트) 관리 — 어드민 콘솔 "Local Accounts" 탭. ldap 모드 + sysadmin 전용
// (탭 자체는 settings/page.tsx가 게이팅, 서버는 /api/admin/local-accounts에서 다시 require_sysadmin+ldap 확인).
// 부서는 dept_code(EDW 코드) 기반 — 기존 부서 트리 피커(DeptTreePicker)는 org-path 문자열을 다루므로
// 키 공간이 달라 재사용 불가(현재 dept_code를 노출하는 조회 API 없음) → 자유 텍스트 입력으로 대체.

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import {
  createLocalAccount,
  deleteLocalAccount,
  listLocalAccounts,
  updateLocalAccount,
  type LocalAccount,
} from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkeletonRows } from "@/components/permissions/loading-skeleton";
import { ADMIN_HEAD_ROW, ADMIN_ROW, ADMIN_TD, ADMIN_TH, RolePill, TableCard } from "./admin-table";

const INPUT_CLASS =
  "rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink outline-none focus:border-accent";

interface CreateForm {
  loginId: string;
  name: string;
  deptCode: string;
  role: "admin" | "user";
  password: string;
  isSysadmin: boolean;
}

const EMPTY_FORM: CreateForm = {
  loginId: "",
  name: "",
  deptCode: "",
  role: "user",
  password: "",
  isSysadmin: false,
};

interface LocalAccountTableProps {
  onToast: (message: string) => void;
}

export function LocalAccountTable({ onToast }: LocalAccountTableProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LocalAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void listLocalAccounts()
      .then((data) => {
        if (alive) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setRows([]);
          setError(humanizeApiError(e, t));
        }
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, t]);

  const handleCreate = async () => {
    if (!form.loginId.trim() || !form.name.trim() || !form.password) return;
    setCreateBusy(true);
    try {
      await createLocalAccount({
        loginId: form.loginId.trim(),
        name: form.name.trim(),
        deptCode: form.deptCode.trim() || null,
        role: form.role,
        password: form.password,
        isSysadmin: form.isSysadmin,
      });
      setForm(EMPTY_FORM);
      setReloadKey((k) => k + 1);
      onToast(t("localAccount.created"));
    } catch (e) {
      onToast(humanizeApiError(e, t));
    } finally {
      setCreateBusy(false);
    }
  };

  // sysadmin 토글 — env로 지정된 계정은 여기서 못 내린다(설계 §3.1 불변식).
  const handleToggleSysadmin = async (row: LocalAccount) => {
    if (row.envSysadmin) return;
    try {
      await updateLocalAccount(row.loginId, { isSysadmin: !row.isSysadmin });
      setReloadKey((k) => k + 1);
    } catch (e) {
      onToast(humanizeApiError(e, t));
    }
  };

  const handleResetPassword = async (loginId: string) => {
    if (!resetValue) return;
    setResetBusy(true);
    try {
      await updateLocalAccount(loginId, { password: resetValue });
      setResetTarget(null);
      setResetValue("");
      onToast(t("localAccount.passwordReset"));
    } catch (e) {
      onToast(humanizeApiError(e, t));
    } finally {
      setResetBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await deleteLocalAccount(pendingDelete);
      setPendingDelete(null);
      setReloadKey((k) => k + 1);
      onToast(t("localAccount.deleted"));
    } catch (e) {
      onToast(humanizeApiError(e, t));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-id="local-account-table">
      <div>
        <p className="text-body-strong text-ink">{t("localAccount.tab")}</p>
        <p className="text-fine text-ink-tertiary">{t("localAccount.hint")}</p>
      </div>

      {/* 생성 폼 */}
      <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-alt p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            data-id="local-account-login-id-input"
            placeholder={t("localAccount.loginIdPlaceholder")}
            value={form.loginId}
            onChange={(e) => setForm((f) => ({ ...f, loginId: e.target.value }))}
            className={`${INPUT_CLASS} w-36`}
          />
          <input
            type="text"
            data-id="local-account-name-input"
            placeholder={t("localAccount.namePlaceholder")}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`${INPUT_CLASS} w-36`}
          />
          <input
            type="text"
            data-id="local-account-dept-code-input"
            placeholder={t("localAccount.deptPlaceholder")}
            value={form.deptCode}
            onChange={(e) => setForm((f) => ({ ...f, deptCode: e.target.value }))}
            className={`${INPUT_CLASS} w-36`}
          />
          <select
            data-id="local-account-role-select"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "admin" | "user" }))}
            className="rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <input
            type="password"
            data-id="local-account-password-input"
            placeholder={t("localAccount.password")}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={`${INPUT_CLASS} w-36`}
          />
          <label className="flex items-center gap-1.5 text-caption text-ink-secondary">
            <input
              type="checkbox"
              checked={form.isSysadmin}
              onChange={(e) => setForm((f) => ({ ...f, isSysadmin: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            {t("localAccount.sysadmin")}
          </label>
          <button
            type="button"
            data-id="local-account-create"
            onClick={() => void handleCreate()}
            disabled={createBusy || !form.loginId.trim() || !form.name.trim() || !form.password}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {createBusy && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
            {t("localAccount.create")}
          </button>
        </div>
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      {rows === null ? (
        <SkeletonRows count={4} />
      ) : rows.length === 0 ? (
        <p className="text-fine text-ink-tertiary">{t("localAccount.empty")}</p>
      ) : (
        <TableCard>
          <thead>
            <tr className={ADMIN_HEAD_ROW}>
              <th className={ADMIN_TH}>loginId</th>
              <th className={ADMIN_TH}>name</th>
              <th className={ADMIN_TH}>department</th>
              <th className={ADMIN_TH}>role</th>
              <th className={ADMIN_TH}>sysadmin</th>
              <th className={ADMIN_TH}>status</th>
              <th className={ADMIN_TH}>createdBy</th>
              <th className={ADMIN_TH}>updatedAt</th>
              <th className={ADMIN_TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.loginId}
                className={ADMIN_ROW}
                data-id={`local-account-row-${row.loginId}`}
              >
                <td className={ADMIN_TD}>{row.loginId}</td>
                <td className={ADMIN_TD}>{row.name}</td>
                <td className={ADMIN_TD}>{row.department}</td>
                <td className={ADMIN_TD}>
                  <RolePill role={row.role} />
                </td>
                <td className={ADMIN_TD}>
                  <label className="flex items-center gap-1.5 text-caption text-ink-secondary">
                    <input
                      type="checkbox"
                      data-id={`local-account-sysadmin-${row.loginId}`}
                      checked={row.isSysadmin || row.envSysadmin}
                      disabled={row.envSysadmin}
                      onChange={() => void handleToggleSysadmin(row)}
                      className="h-3.5 w-3.5"
                    />
                    {row.envSysadmin ? t("localAccount.setByEnvironment") : t("localAccount.sysadmin")}
                  </label>
                </td>
                <td className={ADMIN_TD}>
                  <span className={row.active ? "text-ink" : "text-ink-tertiary"}>
                    {row.active
                      ? t("perm.sysadmin.userStatusActive")
                      : t("perm.sysadmin.userStatusInactive")}
                  </span>
                </td>
                <td className={`${ADMIN_TD} text-ink-tertiary`}>{row.createdBy}</td>
                <td className={`${ADMIN_TD} text-ink-tertiary`}>{formatKstShort(row.updatedAt)}</td>
                <td className={ADMIN_TD}>
                  <div className="flex items-center justify-end gap-1.5">
                    {resetTarget === row.loginId ? (
                      <>
                        <input
                          type="password"
                          autoFocus
                          value={resetValue}
                          onChange={(e) => setResetValue(e.target.value)}
                          placeholder={t("localAccount.password")}
                          className={`${INPUT_CLASS} w-28`}
                        />
                        <button
                          type="button"
                          disabled={resetBusy || !resetValue}
                          onClick={() => void handleResetPassword(row.loginId)}
                          className="rounded-sm border border-accent px-2 py-1 text-fine text-accent hover:bg-accent-tint disabled:opacity-40"
                        >
                          {t("common.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(null);
                            setResetValue("");
                          }}
                          className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-tertiary hover:bg-surface-alt"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-id={`local-account-reset-pw-${row.loginId}`}
                        onClick={() => {
                          setResetTarget(row.loginId);
                          setResetValue("");
                        }}
                        className="rounded-sm border border-hairline px-2 py-1 text-fine text-ink-tertiary hover:bg-surface-alt"
                      >
                        {t("localAccount.resetPassword")}
                      </button>
                    )}
                    <button
                      type="button"
                      data-id={`local-account-delete-${row.loginId}`}
                      aria-label={t("localAccount.delete")}
                      onClick={() => setPendingDelete(row.loginId)}
                      className="rounded-sm p-1 text-ink-tertiary hover:bg-error/10 hover:text-error"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={t("localAccount.deleteConfirmTitle")}
          message={t("localAccount.deleteConfirm", { loginId: pendingDelete })}
          confirmLabel={t("localAccount.delete")}
          cancelLabel={t("common.cancel")}
          danger
          confirmDisabled={deleteBusy}
          onConfirm={() => void handleDelete()}
          onClose={() => setPendingDelete(null)}
          dialogId="local-account-delete-confirm"
        />
      )}
    </div>
  );
}
