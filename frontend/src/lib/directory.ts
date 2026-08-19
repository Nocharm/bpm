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
    inflight = getDirectory()
      .then((dir) => {
        cache = new Map(dir.users.map((u) => [u.id, u]));
        return cache;
      })
      .catch((err) => {
        inflight = null; // 실패한 약속을 캐시에 남기면 이후 마운트가 전부 같은 실패를 물려받는다
        throw err;
      });
  }
  return inflight;
}

/** login_id → DirectoryUser 맵. 최초 렌더엔 캐시(있으면) 또는 빈 맵, fetch 후 채워짐. */
export function useDirectory(): Map<string, DirectoryUser> {
  return useDirectoryState().users;
}

/** 맵 + 도착 여부. ready 전에는 "이름을 모르는 것"이 아니라 "아직 안 온 것" — 아이디 폴백 대신
 * 스켈레톤을 그려 id→이름으로 글자가 바뀌는 깜빡임을 없앤다(UserPill). fetch 실패도 ready=true로
 * 풀어 준다 — 영원히 스켈레톤으로 남기지 않고 아이디 폴백으로 되돌린다. */
export function useDirectoryState(): { users: Map<string, DirectoryUser>; ready: boolean } {
  const [users, setUsers] = useState<Map<string, DirectoryUser>>(cache ?? new Map());
  const [ready, setReady] = useState<boolean>(cache != null);
  useEffect(() => {
    let alive = true;
    loadDirectory()
      .then((map) => {
        if (alive) setUsers(map);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { users, ready };
}
