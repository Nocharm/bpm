"use client";

import { Lock } from "lucide-react";
import { useState } from "react";

import { postLdapLogin, setAuthToken } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { storeLdapToken } from "@/lib/ldap-session";

interface LdapLoginFormProps {
  onSuccess: () => void;
}

export function LdapLoginForm({ onSuccess }: LdapLoginFormProps) {
  const { t } = useI18n();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, expiresAt } = await postLdapLogin(loginId, password);
      storeLdapToken(token, expiresAt);
      setAuthToken(token);
      onSuccess();
    } catch (e) {
      setError(
        e instanceof Error && e.message === "too-many-attempts"
          ? t("login.tooManyAttempts")
          : t("login.invalidCredentials"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-id="login-ldap-form" onSubmit={(e) => void handleSubmit(e)}>
      <input
        data-id="login-ldap-id"
        className="mb-2 h-10 w-full rounded-sm border border-hairline bg-surface px-3 text-caption text-ink"
        placeholder={t("login.idPlaceholder")}
        value={loginId}
        onChange={(e) => setLoginId(e.target.value)}
        autoComplete="username"
      />
      <input
        data-id="login-ldap-password"
        className="mb-3 h-10 w-full rounded-sm border border-hairline bg-surface px-3 text-caption text-ink"
        type="password"
        placeholder={t("login.passwordPlaceholder")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && (
        <p data-id="login-ldap-error" className="mb-2 text-fine text-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-id="login-ldap-submit"
        disabled={busy || !loginId || !password}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-accent text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-50"
      >
        <Lock size={16} strokeWidth={1.7} />
        {t("login.signIn")}
      </button>
    </form>
  );
}
