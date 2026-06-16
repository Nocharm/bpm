"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import {
  listEmployees,
  syncEmployees,
  type EmployeeRow,
  type SyncSummary,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";

export default function AdminPage() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 비-admin은 메인으로
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  useEffect(() => {
    void listEmployees().then(setRows).catch(() => setRows([]));
  }, []);

  const onSync = async () => {
    setBusy(true);
    setMsg("");
    try {
      const s: SyncSummary = await syncEmployees();
      setMsg(`scanned ${s.scanned} · upserted ${s.upserted} · excluded ${s.excluded}`);
      void listEmployees().then(setRows).catch(() => setRows([]));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <p className="text-body-strong text-ink">{t("admin.title")}</p>
        <button
          type="button"
          className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
          onClick={() => void onSync()}
          disabled={busy}
        >
          {busy ? t("admin.syncing") : t("admin.sync")}
        </button>
      </div>
      {msg && <p className="text-fine text-ink-tertiary">{msg}</p>}
      <table className="w-full text-caption">
        <thead>
          <tr className="border-b border-hairline text-left text-ink-tertiary">
            <th className="py-1">loginId</th>
            <th>name</th>
            <th>title</th>
            <th>department</th>
            <th>role</th>
            <th>source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.login_id} className="border-b border-divider">
              <td className="py-1">{r.login_id}</td>
              <td>{r.name}</td>
              <td>{r.title}</td>
              <td>{r.department}</td>
              <td>{r.role}</td>
              <td>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
