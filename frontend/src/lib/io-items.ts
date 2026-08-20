// IO 연결(불러오기) 단일 소스 — 줄 정렬·판정·인덱스·후보·불러오기·전파. 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md

import { genId } from "@/lib/id";
import type { SubprocessRef } from "@/lib/api";

export type IoSide = "input" | "output";
export type IoListKind = "in" | "out" | "spin" | "spout";
export type IoItemState = "origin" | "mirror" | "plain";

export interface IoLinkFields {
  input?: string;
  output?: string;
  input_forms?: string;
  output_forms?: string;
  output_ids?: string;
  input_links?: string;
  output_links?: string;
  input_flags?: string;
}

export interface IoNode {
  id: string;
  data: IoLinkFields & { label: string; nodeType: string; linkedMapId?: number | null };
}

export type SpRefMap = ReadonlyMap<number, SubprocessRef>;

export interface IoOriginRef {
  itemId: string;
  nodeId: string;
  kind: "out" | "spin" | "spout";
  index: number;
  text: string;
  form: string;
}

export function getIoLine(joined: string | null | undefined, index: number): string {
  return (joined ?? "").split("\n")[index]?.trim() ?? "";
}

export function setIoLine(joined: string | null | undefined, index: number, value: string): string {
  const lines = (joined ?? "").split("\n");
  while (lines.length <= index) lines.push("");
  lines[index] = value;
  // 후행 공백 줄만 소거 — 백엔드 rstrip 계약과 동치 (io-linking §3)
  return lines.join("\n").replace(/\s+$/, "");
}

export function countIoLines(joined: string | null | undefined): number {
  const v = joined ?? "";
  return v === "" ? 0 : v.split("\n").length;
}

export function getIoItemState(node: IoNode, side: IoSide, index: number): IoItemState {
  if (side === "output" && getIoLine(node.data.output_ids, index) !== "") return "origin";
  const links = side === "input" ? node.data.input_links : node.data.output_links;
  return getIoLine(links, index) !== "" ? "mirror" : "plain";
}

export function buildIoIndex(nodes: IoNode[], spRefs: SpRefMap): Map<string, IoOriginRef> {
  const index = new Map<string, IoOriginRef>();
  const addList = (
    nodeId: string, kind: IoOriginRef["kind"],
    ids: string | null | undefined, texts: string | null | undefined, forms: string | null | undefined,
  ) => {
    (ids ?? "").split("\n").forEach((raw, i) => {
      const itemId = raw.trim();
      const text = getIoLine(texts, i);
      // 중복 itemId는 먼저 만난 쪽만 원본 인정 — 이후 발견분은 reconcile이 소거 (io-linking §5)
      if (itemId === "" || text === "" || index.has(itemId)) return;
      index.set(itemId, { itemId, nodeId, kind, index: i, text, form: getIoLine(forms, i) });
    });
  };
  for (const node of nodes) {
    if (node.data.nodeType === "subprocess") {
      const ref = node.data.linkedMapId != null ? spRefs.get(node.data.linkedMapId) : undefined;
      if (!ref?.designated) continue;
      addList(node.id, "spin", ref.input_ids, ref.input, ref.input_forms);
      addList(node.id, "spout", ref.output_ids, ref.output, ref.output_forms);
    } else {
      addList(node.id, "out", node.data.output_ids, node.data.output, node.data.output_forms);
    }
  }
  return index;
}

export interface IoMirrorSite {
  nodeId: string;
  side: IoSide;
  index: number;
}

export function buildIoMirrorIndex(nodes: IoNode[]): Map<string, IoMirrorSite[]> {
  const map = new Map<string, IoMirrorSite[]>();
  for (const node of nodes) {
    for (const side of ["input", "output"] as const) {
      const links = side === "input" ? node.data.input_links : node.data.output_links;
      (links ?? "").split("\n").forEach((raw, i) => {
        const itemId = raw.trim();
        if (itemId === "") return;
        const sites = map.get(itemId) ?? [];
        sites.push({ nodeId: node.id, side, index: i });
        map.set(itemId, sites);
      });
    }
  }
  return map;
}

// SP 지정 저장 시 전 줄 id 부여 — 텍스트 일치 줄은 기존 id 승계(재정렬 안전), 개명·신규는 새 id.
// 개명은 소비 맵 링크의 보수적 해산으로 이어진다(reconcile) — CSV 규칙과 동일 결정 (io-linking §3)
export function assignSpIoIds(
  newText: string, oldText: string | null | undefined, oldIds: string | null | undefined,
): string {
  if (newText === "") return "";
  const oldLines = (oldText ?? "").split("\n").map((s) => s.trim());
  const oldIdLines = (oldIds ?? "").split("\n");
  const used = new Set<number>();
  return newText
    .split("\n")
    .map((line) => {
      const text = line.trim();
      const j = oldLines.findIndex((old, k) => old !== "" && old === text && !used.has(k));
      if (j >= 0) {
        used.add(j);
        const kept = (oldIdLines[j] ?? "").trim();
        if (kept !== "") return kept;
      }
      return genId();
    })
    .join("\n")
    .replace(/\s+$/, "");
}
