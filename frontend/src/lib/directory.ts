"use client";

// 사용자 디렉터리 해석 — login_id → DirectoryUser(이름/직급/조직). 모듈 캐시로 세션당 1회만 fetch.
// 여러 페이지·컴포넌트가 공유(UserPill 등). 이름 우선·id 보조 표시의 단일 소스.
// 부서 목록(departments)도 같은 응답에 실려 오므로 한 번의 fetch를 유저·부서가 함께 쓴다.

import { useEffect, useMemo, useState } from "react";

import { getDirectory, type Directory, type DirectoryDept, type DirectoryUser } from "@/lib/api";
import { buildDeptLeaves } from "@/lib/node-ref-warnings";

let cache: Directory | null = null;
let usersCache: Map<string, DirectoryUser> | null = null;
let inflight: Promise<Directory> | null = null;

function loadDirectory(): Promise<Directory> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getDirectory()
      .then((dir) => {
        cache = dir;
        usersCache = new Map(dir.users.map((u) => [u.id, u]));
        return dir;
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
  const [users, setUsers] = useState<Map<string, DirectoryUser>>(usersCache ?? new Map());
  const [ready, setReady] = useState<boolean>(cache != null);
  useEffect(() => {
    let alive = true;
    loadDirectory()
      .then(() => {
        if (alive && usersCache) setUsers(usersCache);
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

/** 조직도 유효 부서 리프명 — 도착 전이면 null(판정 보류). 부서 필·노드 경고의 고아 판정 단일 소스.
 *  null 가드가 핵심 — 로드 전에 판정하면 화면의 모든 부서가 고아로 물든다 (2026-09-10). */
export function useValidDeptLeaves(): ReadonlySet<string> | null {
  const { users, ready } = useDirectoryState();
  const departments = useDirectoryDepartments();
  return useMemo(
    () => (ready && users.size > 0 ? buildDeptLeaves(users.values(), departments) : null),
    [ready, users, departments],
  );
}

/** 조직도 부서 목록(org_path 전체). 유저 맵과 같은 fetch를 공유 — 부서 트리 UI의 소스. */
export function useDirectoryDepartments(): DirectoryDept[] {
  const [departments, setDepartments] = useState<DirectoryDept[]>(cache?.departments ?? []);
  useEffect(() => {
    let alive = true;
    loadDirectory()
      .then((dir) => {
        if (alive) setDepartments(dir.departments);
      })
      .catch(() => {
        // 조회 실패 — 라이브러리 행에서 얻은 부서만으로 트리를 만든다
      });
    return () => {
      alive = false;
    };
  }, []);
  return departments;
}
