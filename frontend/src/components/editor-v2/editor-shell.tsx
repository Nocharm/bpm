"use client";

import { useEditorData } from "./use-editor-data";

// 신규 에디터 셸 — 4영역 골격(상단/좌/캔버스/우). 각 영역은 후속 Phase에서 실제 컴포넌트로 채운다.
export default function EditorShell({ mapId }: { mapId: string }) {
  const { loading, error, map, graph } = useEditorData(mapId);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-error">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas" data-id="editor-v2-shell">
      <header
        className="flex h-12 items-center border-b border-hairline bg-surface px-3 text-body-strong"
        data-id="editor-v2-topbar"
      >
        {loading ? "Loading…" : (map?.name ?? "Untitled")}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className="w-64 border-r border-hairline bg-surface"
          data-id="editor-v2-sidebar"
        />
        <main className="relative min-w-0 flex-1" data-id="editor-v2-canvas">
          {/* P1: EditorCanvas mounts here */}
          {graph ? null : null}
        </main>
        <aside
          className="w-[330px] border-l border-hairline bg-surface"
          data-id="editor-v2-inspector"
        />
      </div>
    </div>
  );
}
