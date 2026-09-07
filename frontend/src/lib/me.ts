"use client";

// 로그인 사용자(Me) 공유 훅 — 모듈 캐시로 세션당 1회만 fetch(directory.ts와 같은 관례).
// 페이지가 props로 내려주지 않는 깊은 컴포넌트(라이브러리 필터의 내 부서 등)가 소비한다.

import { useEffect, useState } from "react";

import { getMe, type Me } from "@/lib/api";

let cache: Me | null = null;
let inflight: Promise<Me> | null = null;

function loadMe(): Promise<Me> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getMe()
      .then((me) => {
        cache = me;
        return me;
      })
      .catch((err) => {
        inflight = null; // 실패한 약속을 캐시에 남기면 이후 마운트가 전부 같은 실패를 물려받는다
        throw err;
      });
  }
  return inflight;
}

/** 로그인 사용자. 최초 렌더엔 캐시(있으면) 또는 null, fetch 후 채워짐. 실패하면 null 유지. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(cache);
  useEffect(() => {
    let alive = true;
    loadMe()
      .then((loaded) => {
        if (alive) setMe(loaded);
      })
      .catch(() => {
        // 조회 실패 — 내 부서 기반 UI는 폴백(트리 루트)으로 그대로 동작한다
      });
    return () => {
      alive = false;
    };
  }, []);
  return me;
}
