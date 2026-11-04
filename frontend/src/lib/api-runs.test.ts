// 실행 체크 API 클라이언트 — 경로·메서드·본문이 BE routers/runs.py와 맞는지 fetch 스텁으로 확인한다.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actOnRun,
  addRunComment,
  createRun,
  deleteRun,
  getRun,
  getRunScopeGraph,
  listRunComments,
  listRuns,
  patchRun,
  reopenRun,
  shareRun,
  stopRun,
  updateRunParticipants,
} from "./api";

interface SentRequest {
  url: string;
  method: string;
  body: unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** fetch를 스텁하고, 호출 뒤 마지막으로 보낸 요청을 읽는 함수를 돌려준다. */
function stubFetch(status = 200): () => SentRequest {
  // Response 본문은 한 번만 읽히므로 호출마다 새로 만든다
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    async () => new Response(status === 204 ? null : "{}", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return () => {
    const [input, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const raw = init?.body;
    return {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    };
  };
}

describe("run api client", () => {
  it("creates a run under the map", async () => {
    const lastRequest = stubFetch();

    await createRun(7, { name: "LOT-1", version_id: 3, scope: "shared", participants: ["kim"] });

    expect(lastRequest()).toEqual({
      url: "/api/maps/7/runs",
      method: "POST",
      body: { name: "LOT-1", version_id: 3, scope: "shared", participants: ["kim"] },
    });
  });

  it("lists runs with only the filters that are set", async () => {
    const lastRequest = stubFetch();

    await listRuns(7, { tab: "ended" });
    expect(lastRequest().url).toBe("/api/maps/7/runs?tab=ended");

    await listRuns(7, { tab: "open", q: "LOT 1", mine: true, kept: true, page: 2 });
    expect(lastRequest().url).toBe("/api/maps/7/runs?tab=open&q=LOT+1&mine=true&kept=true&page=2");
  });

  it("reads a run and its scope graph", async () => {
    const lastRequest = stubFetch();

    await getRun(5);
    expect(lastRequest().url).toBe("/api/runs/5");

    await getRunScopeGraph(5, "");
    expect(lastRequest().url).toBe("/api/runs/5/graph?scope=");

    await getRunScopeGraph(5, "n1/n2");
    expect(lastRequest().url).toBe("/api/runs/5/graph?scope=n1%2Fn2");
  });

  it("posts a node action with the optional fields it was given", async () => {
    const lastRequest = stubFetch();

    await actOnRun(5, { scope_path: "n1", node_id: "q", action: "undo", cascade: true });

    expect(lastRequest()).toEqual({
      url: "/api/runs/5/actions",
      method: "POST",
      body: { scope_path: "n1", node_id: "q", action: "undo", cascade: true },
    });
  });

  it("reads and adds comments for one node", async () => {
    const lastRequest = stubFetch();

    await listRunComments(5, "n1", "q");
    expect(lastRequest().url).toBe("/api/runs/5/comments?scope=n1&node_id=q");

    await addRunComment(5, { scope_path: "n1", node_id: "q", body: "확인 완료" });
    expect(lastRequest()).toEqual({
      url: "/api/runs/5/comments",
      method: "POST",
      body: { scope_path: "n1", node_id: "q", body: "확인 완료" },
    });
  });

  it("sends the management calls to their routes", async () => {
    const lastRequest = stubFetch();

    await patchRun(5, { keep: true });
    expect(lastRequest()).toEqual({ url: "/api/runs/5", method: "PATCH", body: { keep: true } });

    await shareRun(5, ["kim", "lee"]);
    expect(lastRequest()).toEqual({ url: "/api/runs/5/share", method: "POST", body: { participants: ["kim", "lee"] } });

    await updateRunParticipants(5, { add: ["park"], remove: [] });
    expect(lastRequest()).toEqual({
      url: "/api/runs/5/participants",
      method: "POST",
      body: { add: ["park"], remove: [] },
    });

    await stopRun(5);
    expect(lastRequest()).toEqual({ url: "/api/runs/5/stop", method: "POST", body: undefined });

    await reopenRun(5);
    expect(lastRequest()).toEqual({ url: "/api/runs/5/reopen", method: "POST", body: undefined });
  });

  it("deletes a run and resolves without a body", async () => {
    const lastRequest = stubFetch(204);

    await expect(deleteRun(5)).resolves.toBeUndefined();

    expect(lastRequest()).toEqual({ url: "/api/runs/5", method: "DELETE", body: undefined });
  });
});
