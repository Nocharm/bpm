"use client";

import { useParams } from "next/navigation";

import EditorShell from "@/components/editor-v2/editor-shell";

// 신규 에디터 임시 라우트 — 패리티 달성 후 page.tsx로 승격(컷오버). 구 에디터는 /maps/[mapId] 유지.
export default function EditorV2Page() {
  const params = useParams<{ mapId: string }>();
  return <EditorShell mapId={params.mapId} />;
}
