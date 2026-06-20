// 앱 전체 i18n — LangProvider + useI18n + t(key, vars). 기본 한국어, localStorage 영속.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { messages, type Lang, type MessageKey } from "@/lib/i18n-messages";

const STORAGE_KEY = "bpm.lang";
const DEFAULT_LANG: Lang = "ko";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // localStorage는 클라이언트 전용 — 마운트 후 복원해 초기 SSR 렌더(en)와 일치시킴
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ko") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLangState(saved); // intentional: one-time hydration restore from localStorage
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const toggleLang = () => setLang(lang === "en" ? "ko" : "en");

  const t = (key: MessageKey, vars?: Record<string, string | number>) => {
    let str: string = messages[lang][key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LangProvider");
  }
  return ctx;
}
