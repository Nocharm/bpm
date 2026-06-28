"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getGraph,
  getMap,
  getMe,
  type Graph,
  type MapDetail,
  type Me,
  type VersionDetail,
} from "@/lib/api";

export interface EditorData {
  loading: boolean;
  error: string | null;
  map: MapDetail | null;
  versions: VersionDetail[];
  versionId: number | null;
  setVersionId: (id: number) => void;
  graph: Graph | null;
  me: Me | null;
  reloadGraph: () => void;
}

// 신규 에디터 셸의 데이터 소스 — 맵(+버전 목록)·현재유저·선택 버전의 그래프 로드.
// 버전 목록은 getMap의 MapDetail.versions에 포함됨(별도 listVersions 없음). id는 number.
export function useEditorData(mapId: string): EditorData {
  const mapIdNum = Number(mapId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MapDetail | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  // 인라인 async + active 가드 — setState를 await 이후에만 호출(set-state-in-effect 회피, compare/deleted-panels와 동일).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [m, meRes] = await Promise.all([getMap(mapIdNum), getMe()]);
        if (!active) return;
        setMap(m);
        setMe(meRes);
        // 기본 선택 = 최신 버전(최대 id)
        const latest = m.versions.reduce<VersionDetail | null>(
          (acc, v) => (acc && acc.id > v.id ? acc : v),
          null,
        );
        setVersionId((prev) => prev ?? latest?.id ?? null);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [mapIdNum]);

  const reloadGraph = useCallback(() => {
    if (versionId == null) return;
    getGraph(versionId)
      .then((g) => setGraph(g))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "graph load failed"),
      );
  }, [versionId]);

  useEffect(() => {
    reloadGraph();
  }, [reloadGraph]);

  return {
    loading,
    error,
    map,
    versions: map?.versions ?? [],
    versionId,
    setVersionId,
    graph,
    me,
    reloadGraph,
  };
}
