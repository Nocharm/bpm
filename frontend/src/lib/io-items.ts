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
      if (text === "") return ""; // 빈 텍스트 줄엔 id 미부여 — 고아 id·후행 트림 무력화 방지
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
    // 텍스트보다 긴 스테일 flags 열이 새 행에 상속되지 않게 명시 소거 — 기본 required("")
    data.input_flags = setIoLine(node.data.input_flags, idx, "");
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

// 전파+로드 정합화 겸용 단일 패스 (io-linking §5) — 미러 텍스트/폼을 원본 값으로 동기화,
// 원본 소실·자기참조·id+link 공존 링크는 소거(복사본 전환), 인덱스에 없는(중복·빈 텍스트) 원본 id도 소거.
export function propagateIoLinks<N extends IoNode>(nodes: N[], spRefs: SpRefMap): { nodes: N[]; changed: boolean } {
  const index = buildIoIndex(nodes, spRefs);
  let changed = false;
  const next = nodes.map((node) => {
    const d = node.data;
    let { input = "", output = "", input_forms = "", output_forms = "", output_ids = "", input_links = "", output_links = "" } = d;
    // ① 원본 id 정리 — 인덱스가 인정하지 않는 id(중복 후발·빈 텍스트 줄)는 소거
    if (d.nodeType !== "subprocess") {
      output_ids.split("\n").forEach((raw, i) => {
        const id = raw.trim();
        if (id === "") return;
        const o = index.get(id);
        if (!o || o.nodeId !== node.id || o.index !== i) output_ids = setIoLine(output_ids, i, "");
      });
    }
    // ② 미러 정리·동기화
    const syncSide = (side: IoSide) => {
      let links = side === "input" ? input_links : output_links;
      links.split("\n").forEach((raw, i) => {
        const itemId = raw.trim();
        if (itemId === "") return;
        // 같은 줄 원본 id 공존(무효) 또는 원본 소실·자기 참조 → 링크 소거(복사본 전환)
        const o = index.get(itemId) ?? null;
        const invalid = (side === "output" && getIoLine(output_ids, i) !== "") || o === null || o.nodeId === node.id;
        if (invalid) {
          links = setIoLine(links, i, "");
          return;
        }
        if (side === "input") {
          if (getIoLine(input, i) !== o.text) input = setIoLine(input, i, o.text);
          if (getIoLine(input_forms, i) !== o.form) input_forms = setIoLine(input_forms, i, o.form);
        } else {
          if (getIoLine(output, i) !== o.text) output = setIoLine(output, i, o.text);
          if (getIoLine(output_forms, i) !== o.form) output_forms = setIoLine(output_forms, i, o.form);
        }
      });
      if (side === "input") input_links = links;
      else output_links = links;
    };
    syncSide("input");
    syncSide("output");
    const dirty =
      input !== (d.input ?? "") || output !== (d.output ?? "") ||
      input_forms !== (d.input_forms ?? "") || output_forms !== (d.output_forms ?? "") ||
      output_ids !== (d.output_ids ?? "") || input_links !== (d.input_links ?? "") || output_links !== (d.output_links ?? "");
    if (!dirty) return node;
    changed = true;
    return { ...node, data: { ...d, input, output, input_forms, output_forms, output_ids, input_links, output_links } };
  });
  return { nodes: changed ? next : nodes, changed };
}

// 항목 하나의 링크 관계 조회 — 인스펙터/모달 호버 하이라이트용(원본이면 mirrors 전체, 미러면 origin 1개)
export function getIoLinkPeers(
  nodes: IoNode[], spRefs: SpRefMap, nodeId: string, side: IoSide, index: number,
): { groupId: string | null; origin: IoOriginRef | null; mirrors: IoMirrorSite[] } {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { groupId: null, origin: null, mirrors: [] };
  let groupId: string | null = null;
  if (node.data.nodeType === "subprocess") {
    const ref = node.data.linkedMapId != null ? spRefs.get(node.data.linkedMapId) : undefined;
    groupId = getIoLine(side === "input" ? ref?.input_ids : ref?.output_ids, index) || null;
  } else if (side === "output") {
    groupId = getIoLine(node.data.output_ids, index) || getIoLine(node.data.output_links, index) || null;
  } else {
    groupId = getIoLine(node.data.input_links, index) || null;
  }
  if (groupId === null) return { groupId: null, origin: null, mirrors: [] };
  const origin = buildIoIndex(nodes, spRefs).get(groupId) ?? null;
  const mirrors = buildIoMirrorIndex(nodes).get(groupId) ?? [];
  return { groupId, origin, mirrors };
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
        // sp_*_ids 도입 전 지정된 SP는 id 줄이 비어 있다 — 그대로 내보내면 불러오기가 조용히 무동작하므로
        // 아예 후보에서 뺀다(SP는 영구 원본이라 여기서 lazy 부여도 불가). 재부여는 SP 지정 재저장이 담당.
        if (groupId === null) return;
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

// 끊긴 흐름 판정 — 선택 노드의 "인풋 미러" 중 원본→소비 전방 경로가 없는 줄 인덱스 (경고 배지용).
// 병렬 합류 아웃풋 미러는 원본과 직접 경로가 없는 게 정상이라 대상에서 제외한다 (사용자 합의 2026-08-21).
// 댕글링·자기참조 링크는 정합화가 처리하므로 여기선 배지 대상이 아니다.
export function getBrokenInputMirrorIndexes(
  nodes: IoNode[], edges: Edge[], spRefs: SpRefMap, nodeId: string,
): Set<number> {
  const broken = new Set<number>();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.data.nodeType === "subprocess") return broken;
  const index = buildIoIndex(nodes, spRefs);
  (node.data.input_links ?? "").split("\n").forEach((raw, i) => {
    const itemId = raw.trim();
    if (itemId === "") return;
    const origin = index.get(itemId);
    if (!origin || origin.nodeId === nodeId) return;
    if (getFlowPathBetween(edges, origin.nodeId, nodeId).length === 0) broken.add(i);
  });
  return broken;
}
