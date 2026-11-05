// 실행 체크(Run) 세션 — 맵 화면이 실행 모드일 때 실행 상세·고정된 하위 범위 그래프를 들고, 노드 동작·다시 읽기·공유 실행
// 폴링을 맡는다. 실행 상태는 페이지의 편집 상태(nodes·edges)와 섞지 않고 이 훅에만 둔다(lessons react-ts-patterns §4).
// 서버가 진실이라 동작 응답의 전체 상세로 바꾸고, 409·403(먼저 바뀜·권한)이면 최신 상세로 다시 읽은 뒤 알린다.
// 처음 읽기가 실패하면 토스트 대신 loadError로 돌려준다 — 실행 바가 오류 줄과 "실행 닫기"를 보인다(R24).

import { useStoreApi, useUpdateNodeInternals, type Node } from "@xyflow/react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { actOnRun, ApiError, getRun, getRunScopeGraph, type Graph, type RunActionName, type RunDetail } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getRunTouchedAfterTitle, humanizeRunError, isRunSubProgressError } from "@/lib/run-view";

// 공유 실행 다시 읽기 주기(ms) — 실행 화면이 열려 있고 탭이 보이는 동안만 돈다(계획 "공유 실행 동기화")
export const RUN_POLL_MS = 10_000;

export interface RunActInput {
  scopePath: string;
  nodeId: string;
  action: RunActionName;
  edgeId?: string;
  exitKey?: string;
  cascade?: boolean;
  downstream?: boolean;
}

export interface RunActOptions {
  // 하위 맵 기록이 있어 cascade 확인이 필요하다는 409 — 주면 오류 토스트 대신 이것을 부른다(R5, 화면이 못 보는 하위 범위 대비)
  onNeedsCascade?: () => void;
  // 뒤 단계가 이미 진행돼 downstream 확인이 필요하다는 409(첫 막은 단계 이름) — 화면이 못 본 뒤 단계 대비
  onNeedsDownstream?: (title: string) => void;
}

export interface RunSession {
  detail: RunDetail;
  // 범위 경로 → 그 범위 그래프(실행이 고정한 버전) — 맵 화면 합성 트리(getEmbed)가 링크 해석보다 먼저 쓴다
  scopeGraphs: Map<string, Graph>;
  act(input: RunActInput, options?: RunActOptions): Promise<RunDetail | null>;
  reload(): Promise<void>;
  loadScopeGraph(scopePath: string): Promise<void>;
  update(next: RunDetail): void;
}

export interface RunSessionState {
  // 실행 상세가 도착하기 전·실패했을 때 null
  session: RunSession | null;
  // 처음 읽기 실패 문구 — 상세가 있으면(뒤늦은 폴링 성공 등) null
  loadError: string | null;
}

interface LoadedRun {
  runId: number;
  detail: RunDetail;
}

interface FailedRun {
  runId: number;
  message: string;
}

interface ScopeGraphEntry {
  // 받을 때 고정돼 있던 버전 — 아직 고정 전(들어가기만 함)이면 null, 고정되면 그 버전으로 한 번 다시 받는다
  versionId: number | null;
  graph: Graph;
}

interface ScopeGraphCache {
  runId: number;
  entries: Map<string, ScopeGraphEntry>;
}

export function useRunSession(
  runId: number | null,
  onToast: (msg: string, tone?: "error") => void,
): RunSessionState {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<LoadedRun | null>(null);
  const [failed, setFailed] = useState<FailedRun | null>(null);
  const [graphCache, setGraphCache] = useState<ScopeGraphCache | null>(null);
  // 응답 순서 가드 — 늦게 온 옛 읽기(폴링·다시 읽기) 응답이 그 뒤에 받은 결과를 덮지 않게 요청 순번으로 거른다.
  // 동작·변경 응답은 늘 적용하고 그보다 먼저 떠난 읽기를 모두 낡은 것으로 만든다(R26: 폴링이 방금 누른 결과를 10초 가리지 않게)
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  const inFlightGraphsRef = useRef(new Set<string>());

  const applyRead = useCallback((id: number, seq: number, next: RunDetail) => {
    if (seq < appliedSeqRef.current) return;
    appliedSeqRef.current = seq;
    setLoaded({ runId: id, detail: next });
  }, []);

  const applyWrite = useCallback((id: number, next: RunDetail) => {
    requestSeqRef.current += 1;
    appliedSeqRef.current = requestSeqRef.current;
    setLoaded({ runId: id, detail: next });
  }, []);

  const fetchDetail = useCallback(
    async (id: number): Promise<void> => {
      requestSeqRef.current += 1;
      const seq = requestSeqRef.current;
      applyRead(id, seq, await getRun(id));
    },
    [applyRead],
  );

  const fetchScopeGraph = useCallback(async (id: number, scopePath: string, versionId: number | null): Promise<void> => {
    const flightKey = `${id}:${versionId ?? "-"}:${scopePath}`;
    if (inFlightGraphsRef.current.has(flightKey)) return;
    inFlightGraphsRef.current.add(flightKey);
    try {
      const graph = await getRunScopeGraph(id, scopePath);
      setGraphCache((prev) => {
        const entries = new Map(prev?.runId === id ? prev.entries : []);
        entries.set(scopePath, { versionId, graph });
        return { runId: id, entries };
      });
    } finally {
      inFlightGraphsRef.current.delete(flightKey);
    }
  }, []);

  const detail = loaded !== null && loaded.runId === runId ? loaded.detail : null;
  const loadError = detail === null && failed !== null && failed.runId === runId ? failed.message : null;

  const handleLoadError = useEffectEvent((err: unknown) => {
    onToast(humanizeRunError(err, t), "error");
  });
  const handleFirstLoadError = useEffectEvent((id: number, err: unknown) => {
    console.warn("run load failed", { runId: id, status: err instanceof ApiError ? err.status : null, err });
    setFailed({ runId: id, message: humanizeRunError(err, t) });
  });

  useEffect(() => {
    if (runId === null) return;
    fetchDetail(runId).catch((err: unknown) => handleFirstLoadError(runId, err));
  }, [runId, fetchDetail]);

  // 고정된 하위 범위의 그래프 — 처음 보이거나 고정 버전이 바뀌면(되돌아가기 후 다시 고정) 받는다
  const pinnedKey = detail ? detail.scopes.map((scope) => `${scope.version_id}:${scope.scope_path}`).join("|") : "";
  const syncPinnedGraphs = useEffectEvent(() => {
    if (runId === null || detail === null) return;
    const entries = graphCache?.runId === runId ? graphCache.entries : null;
    for (const scope of detail.scopes) {
      if (entries?.get(scope.scope_path)?.versionId === scope.version_id) continue;
      fetchScopeGraph(runId, scope.scope_path, scope.version_id).catch((err: unknown) => handleLoadError(err));
    }
  });
  useEffect(() => {
    syncPinnedGraphs();
  }, [pinnedKey]);

  // 공유 실행 폴링 — 열린 실행이고 탭이 보이는 동안만. 다시 보이면 곧바로 한 번 읽고 재개한다
  const isPolling = detail !== null && detail.scope === "shared" && detail.status === "open";
  useEffect(() => {
    if (runId === null || !isPolling) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      fetchDetail(runId).catch((err: unknown) => {
        // 폴링 실패는 다음 회차가 다시 읽는다 — 10초마다 토스트를 띄우지 않고 기록만 남긴다
        console.warn("run poll failed", { runId, status: err instanceof ApiError ? err.status : null, err });
      });
    };
    const start = () => {
      if (timer === null && document.visibilityState === "visible") timer = setInterval(poll, RUN_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      poll();
      start();
    };
    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [runId, isPolling, fetchDetail]);

  const reload = useCallback(async (): Promise<void> => {
    if (runId === null) return;
    try {
      await fetchDetail(runId);
    } catch (err) {
      onToast(humanizeRunError(err, t), "error");
    }
  }, [runId, fetchDetail, onToast, t]);

  const act = useCallback(
    async (input: RunActInput, options?: RunActOptions): Promise<RunDetail | null> => {
      if (runId === null) return null;
      try {
        const next = await actOnRun(runId, {
          scope_path: input.scopePath,
          node_id: input.nodeId,
          action: input.action,
          edge_id: input.edgeId,
          exit_key: input.exitKey,
          cascade: input.cascade,
          downstream: input.downstream,
        });
        applyWrite(runId, next);
        return next;
      } catch (err) {
        // 먼저 바뀜(409)·권한(403) — 화면이 낡았으니 최신 상세로 다시 그린 뒤 알린다
        if (err instanceof ApiError && (err.status === 409 || err.status === 403)) {
          await fetchDetail(runId).catch((reloadErr: unknown) => {
            console.warn("run reload after action failed", { runId, err: reloadErr });
          });
        }
        if (!input.cascade && options?.onNeedsCascade && isRunSubProgressError(err)) {
          options.onNeedsCascade();
          return null;
        }
        const touchedTitle = getRunTouchedAfterTitle(err);
        if (!input.downstream && options?.onNeedsDownstream && touchedTitle !== null) {
          options.onNeedsDownstream(touchedTitle);
          return null;
        }
        onToast(humanizeRunError(err, t), "error");
        return null;
      }
    },
    [runId, applyWrite, fetchDetail, onToast, t],
  );

  const loadScopeGraph = useCallback(
    async (scopePath: string): Promise<void> => {
      if (runId === null) return;
      const pinned = detail?.scopes.find((scope) => scope.scope_path === scopePath) ?? null;
      try {
        await fetchScopeGraph(runId, scopePath, pinned?.version_id ?? null);
      } catch (err) {
        onToast(humanizeRunError(err, t), "error");
      }
    },
    [runId, detail, fetchScopeGraph, onToast, t],
  );

  // 실행 바의 변경(보존·알림·공유·참여자·중단·다시 열기) 응답 — 동작 응답과 같이 늘 적용한다
  const update = useCallback(
    (next: RunDetail) => {
      if (runId === null || next.id !== runId) return;
      applyWrite(runId, next);
    },
    [runId, applyWrite],
  );

  // 실행이 바뀌면 이전 실행의 그래프는 버린다(캐시는 실행 id로 표시돼 있다)
  const scopeGraphs = useMemo(
    () =>
      new Map(
        graphCache !== null && graphCache.runId === runId
          ? [...graphCache.entries].map(([scopePath, entry]) => [scopePath, entry.graph] as const)
          : [],
      ),
    [graphCache, runId],
  );

  const session = useMemo(
    () => (detail === null ? null : { detail, scopeGraphs, act, reload, loadScopeGraph, update }),
    [detail, scopeGraphs, act, reload, loadScopeGraph, update],
  );
  return { session, loadError };
}

/**
 * 실행 모드 React Flow 측정 복구 — 실행 상태가 첫 측정 직전에 도착하면 측정 전에 만든 노드 객체를 RF가 측정 뒤에야
 * 받아들여(StoreUpdater 패시브 이펙트) handleBounds를 잃고, 이어 측정값이 실린 객체가 와도 다시 재지 않아 연결선이
 * 통째로 사라진다(콘솔 경고 없음, 2026-11-04 브라우저 실측 12번 중 5번). 노드 배열이 바뀐 커밋마다 크기는 있는데
 * 핸들 경계가 없는 노드만 다시 재게 한다. 부모 이펙트는 자식(<ReactFlow>) 이펙트 뒤에 돌아 같은 커밋의 결과를 본다.
 * ReactFlowProvider 안에서만 쓴다.
 */
export function useRepairRunNodeInternals(displayNodes: readonly Node[], isActive: boolean): void {
  const storeApi = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    if (!isActive) return;
    const missing = [...storeApi.getState().nodeLookup.values()]
      .filter((node) => !node.hidden && node.measured.width !== undefined && !node.internals.handleBounds)
      .map((node) => node.id);
    if (missing.length > 0) updateNodeInternals(missing);
  }, [displayNodes, isActive, storeApi, updateNodeInternals]);
}
