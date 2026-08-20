// IO 연결(불러오기) 단일 소스 — 줄 정렬·판정·인덱스·후보·불러오기·전파. 설계: docs/superpowers/specs/2026-08-21-io-linking-design.md

import type { Edge } from "@xyflow/react";

import type { SubprocessRef } from "@/lib/api";
import { getIncomingEdges, getOutgoingEdges } from "@/lib/canvas";
import { genId } from "@/lib/id";

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

export function getFlowPathBetween(edges: Edge[], fromId: string, toId: string): string[] {
  if (fromId === toId) return [];
  const parent = new Map<string, { prev: string; edgeId: string }>();
  const seen = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0 && !parent.has(toId)) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const edge of getOutgoingEdges(edges, cur)) {
        if (seen.has(edge.target)) continue;
        seen.add(edge.target);
        parent.set(edge.target, { prev: cur, edgeId: edge.id });
        next.push(edge.target);
      }
    }
    frontier = next;
  }
  if (!parent.has(toId)) return [];
  const path: string[] = [];
  for (let cur = toId; cur !== fromId; ) {
    const step = parent.get(cur);
    if (!step) return [];
    path.unshift(step.edgeId);
    cur = step.prev;
  }
  return path;
}

export function canReachForward(edges: Edge[], fromId: string, toId: string): boolean {
  return getFlowPathBetween(edges, fromId, toId).length > 0;
}

export interface IoImportCandidate {
  nodeId: string;
  nodeLabel: string;
  list: IoListKind;
  index: number;
  text: string;
  form: string;
  groupId: string | null;
  isSp: boolean;
  hop: number;
  pathEdgeIds: string[];
}

export type IoImportAction = "mirror" | "takeover" | "succession" | "join";

// 요청 노드의 side 목록 끝에 항목 1줄 추가 — forms/links/ids 줄 정렬 동반
function appendIoRow<N extends IoNode>(
  node: N, side: IoSide, row: { text: string; form: string; link: string; originId: string },
): N {
  const texts = side === "input" ? node.data.input : node.data.output;
  const idx = countIoLines(texts);
  const nextTexts = idx === 0 ? row.text : `${texts}\n${row.text}`;
  const data: IoLinkFields = { ...node.data };
  if (side === "input") {
    data.input = nextTexts;
    data.input_forms = setIoLine(node.data.input_forms, idx, row.form);
    data.input_links = setIoLine(node.data.input_links, idx, row.link);
  } else {
    data.output = nextTexts;
    data.output_forms = setIoLine(node.data.output_forms, idx, row.form);
    data.output_links = setIoLine(node.data.output_links, idx, row.link);
    data.output_ids = setIoLine(node.data.output_ids, idx, row.originId);
  }
  return { ...node, data: { ...node.data, ...data } };
}

// 불러오기 실행 — 소유권 모델 5케이스(io-linking §2)를 판정해 그래프에 즉시 반영
export function applyIoImport<N extends IoNode>(opts: {
  nodes: N[]; edges: Edge[]; spRefs: SpRefMap;
  nodeId: string; side: IoSide; candidate: IoImportCandidate;
}): { nodes: N[]; action: IoImportAction } | null {
  const { nodes, edges, spRefs, nodeId, side, candidate } = opts;
  const index = buildIoIndex(nodes, spRefs);
  const origin = candidate.groupId ? (index.get(candidate.groupId) ?? null) : null;
  const mapNode = (list: N[], id: string, fn: (n: N) => N) => list.map((n) => (n.id === id ? fn(n) : n));

  if (side === "input") {
    // 인풋은 항상 미러 (io-linking §2) — 일반 아웃풋이면 원본 id를 먼저 부여
    let next = nodes;
    let itemId = origin?.itemId ?? null;
    if (itemId === null) {
      if (candidate.list !== "out") return null; // SP 항목은 id 상시 보유 — 여기 올 수 없음
      itemId = genId();
      next = mapNode(next, candidate.nodeId, (n) => ({
        ...n, data: { ...n.data, output_ids: setIoLine(n.data.output_ids, candidate.index, itemId!) },
      }));
    }
    const text = origin?.text ?? candidate.text;
    const form = origin?.form ?? candidate.form;
    next = mapNode(next, nodeId, (n) => appendIoRow(n, "input", { text, form, link: itemId!, originId: "" }));
    return { nodes: next, action: "mirror" };
  }

  // side === "output"
  if (origin === null) {
    if (candidate.list !== "in") return null;
    // 소유권 인수 — 아웃풋이 일반 인풋을 불러오면 아웃풋이 원본이 된다 (io-linking §2)
    const itemId = genId();
    let next = mapNode(nodes, candidate.nodeId, (n) => ({
      ...n, data: { ...n.data, input_links: setIoLine(n.data.input_links, candidate.index, itemId) },
    }));
    next = mapNode(next, nodeId, (n) =>
      appendIoRow(n, "output", { text: candidate.text, form: candidate.form, link: "", originId: itemId }));
    return { nodes: next, action: "takeover" };
  }

  const upstream =
    origin.kind === "out" &&
    canReachForward(edges, nodeId, origin.nodeId) &&
    !canReachForward(edges, origin.nodeId, nodeId); // 순환이면 승계 없음 (io-linking §2)
  if (upstream) {
    // 원본 승계 — itemId를 합류자 아웃풋으로 이동, 구 원본은 미러로 강등. 미러들 링크 줄은 불변(자동 재지향)
    let next = mapNode(nodes, origin.nodeId, (n) => ({
      ...n,
      data: {
        ...n.data,
        output_ids: setIoLine(n.data.output_ids, origin.index, ""),
        output_links: setIoLine(n.data.output_links, origin.index, origin.itemId),
      },
    }));
    next = mapNode(next, nodeId, (n) =>
      appendIoRow(n, "output", { text: origin.text, form: origin.form, link: "", originId: origin.itemId }));
    return { nodes: next, action: "succession" };
  }
  // 병렬·하류·순환·SP 원본 → 그룹 합류 (io-linking §2)
  const next = mapNode(nodes, nodeId, (n) =>
    appendIoRow(n, "output", { text: origin.text, form: origin.form, link: origin.itemId, originId: "" }));
  return { nodes: next, action: "join" };
}

export function collectIoImportCandidates(opts: {
  nodes: IoNode[]; edges: Edge[]; spRefs: SpRefMap; nodeId: string; side: IoSide;
}): IoImportCandidate[] {
  const { nodes, edges, spRefs, nodeId, side } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = buildIoIndex(nodes, spRefs);
  const self = byId.get(nodeId);
  const alreadyLinked = new Set(
    ((side === "input" ? self?.data.input_links : self?.data.output_links) ?? "")
      .split("\n").map((s) => s.trim()).filter((s) => s !== ""),
  );
  // 홉 계산 — 인풋은 업스트림(incoming의 source), 아웃풋은 다운스트림(outgoing의 target)
  const hops = new Map<string, number>();
  const seen = new Set([nodeId]);
  let frontier = [nodeId];
  for (let hop = 1; frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const stepEdges = side === "input" ? getIncomingEdges(edges, cur) : getOutgoingEdges(edges, cur);
      for (const edge of stepEdges) {
        const nb = side === "input" ? edge.source : edge.target;
        if (seen.has(nb)) continue;
        seen.add(nb);
        hops.set(nb, hop);
        next.push(nb);
      }
    }
    frontier = next;
  }
  const results: IoImportCandidate[] = [];
  for (const [candId, hop] of hops) {
    const cand = byId.get(candId);
    if (!cand) continue;
    const isSp = cand.data.nodeType === "subprocess";
    const ref = isSp && cand.data.linkedMapId != null ? spRefs.get(cand.data.linkedMapId) : undefined;
    if (isSp && !ref?.designated) continue; // 미지정 SP는 원본이 될 수 없음 (io-linking §2)
    // 인풋이 가져올 것 = 상대의 아웃풋(spout) / 아웃풋이 가져올 것 = 상대의 인풋(spin) (§1-3·4)
    const wantOutput = side === "input";
    const list: IoListKind = isSp ? (wantOutput ? "spout" : "spin") : wantOutput ? "out" : "in";
    const texts = isSp ? (wantOutput ? ref!.output : ref!.input) : wantOutput ? cand.data.output : cand.data.input;
    const forms = isSp ? (wantOutput ? ref!.output_forms : ref!.input_forms) : wantOutput ? cand.data.output_forms : cand.data.input_forms;
    const pathEdgeIds = side === "input"
      ? getFlowPathBetween(edges, candId, nodeId)
      : getFlowPathBetween(edges, nodeId, candId);
    (texts ?? "").split("\n").forEach((raw, i) => {
      const text = raw.trim();
      if (text === "") return;
      let groupId: string | null;
      if (isSp) {
        groupId = getIoLine(wantOutput ? ref!.output_ids : ref!.input_ids, i) || null;
      } else if (wantOutput) {
        groupId = getIoLine(cand.data.output_ids, i) || getIoLine(cand.data.output_links, i) || null;
      } else {
        groupId = getIoLine(cand.data.input_links, i) || null;
      }
      if (groupId !== null && !index.has(groupId)) groupId = null; // 댕글링은 일반 항목 취급
      if (groupId !== null) {
        if (alreadyLinked.has(groupId)) return;              // 같은 그룹 중복 불러오기 방지 (§4)
        if (index.get(groupId)?.nodeId === nodeId) return;   // 자기 그룹 재수입 방지
      }
      results.push({
        nodeId: candId, nodeLabel: cand.data.label, list, index: i,
        text, form: getIoLine(forms, i), groupId, isSp, hop, pathEdgeIds,
      });
    });
  }
  return results.sort((a, b) => a.hop - b.hop);
}
