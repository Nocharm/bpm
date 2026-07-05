"use client";

// 사용자 디렉터리 해석 — login_id → DirectoryUser(이름/직급/조직). 모듈 캐시로 세션당 1회만 fetch.
// 여러 페이지·컴포넌트가 공유(UserPill 등). 이름 우선·id 보조 표시의 단일 소스.

import { useEffect, useState } from "react";

import { getDirectory, type DirectoryUser } from "@/lib/api";

let cache: Map<string, DirectoryUser> | null = null;
let inflight: Promise<Map<string, DirectoryUser>> | null = null;

function loadDirectory(): Promise<Map<string, DirectoryUser>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getDirectory().then((dir) => {
      cache = new Map(dir.users.map((u) => [u.id, u]));
      return cache;
    });
  }
  return inflight;
}

/** login_id → DirectoryUser 맵. 최초 렌더엔 캐시(있으면) 또는 빈 맵, fetch 후 채워짐. */
export function useDirectory(): Map<string, DirectoryUser> {
  const [users, setUsers] = useState<Map<string, DirectoryUser>>(cache ?? new Map());
  useEffect(() => {
    let alive = true;
    loadDirectory().then((map) => {
      if (alive) setUsers(map);
    });
    return () => {
      alive = false;
    };
  }, []);
  return users;
}
