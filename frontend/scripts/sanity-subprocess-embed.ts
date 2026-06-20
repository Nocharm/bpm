import assert from "node:assert/strict";
import type { FlatNode, Graph, GraphEdge } from "../src/lib/api";
import {
  buildCompositeTree, deriveSubEnds, embedId, closesCycle,
  PRIMARY_END_HANDLE,
} from "../src/lib/subprocess-embed";

const flat = (id: string, t: string, extra: Partial<FlatNode> = {}): FlatNode => ({
  id, title: t, description: "", node_type: "process", color: "",
  assignee: "", department: "", system: "", duration: "", pos_x: 0, pos_y: 0,
  sort_order: 0, group_ids: [], parent_node_id: null, source_node_id: null,
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  ...extra,
});

// deriveSubEnds: primary gets fixed key, others use title; primary first
const resolved: Graph = {
  nodes: [
    flat("s", "Start", { node_type: "start" }),
    flat("e1", "OK", { node_type: "end", is_primary_end: true }),
    flat("e2", "Reject", { node_type: "end" }),
  ],
  edges: [], groups: [],
};
const ends = deriveSubEnds(resolved);
assert.equal(ends.length, 2);
assert.deepEqual(ends.find((x) => x.isPrimary), { key: PRIMARY_END_HANDLE, title: "OK", isPrimary: true, nodeId: "e1" });
assert.equal(ends.find((x) => !x.isPrimary)?.key, "Reject");

// buildCompositeTree: embed host "h" → namespaced children with synthetic parent_node_id
const root: FlatNode[] = [flat("s", "Start", { node_type: "start" }), flat("h", "Call", { node_type: "subprocess", linked_map_id: 7 })];
const rootEdges: GraphEdge[] = [{ id: "r1", source_node_id: "s", target_node_id: "h", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null }];
const sub: Graph = { nodes: [flat("cs", "cStart", { node_type: "start" }), flat("ce", "cEnd", { node_type: "end" })], edges: [{ id: "ce1", source_node_id: "cs", target_node_id: "ce", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null }], groups: [] };
const tree = buildCompositeTree(root, rootEdges, new Set(["h"]), (n) => (n.linked_map_id === 7 ? sub : null));
assert.ok(tree.nodes.find((n) => n.id === embedId("h", "cs"))?.parent_node_id === "h");
assert.ok(tree.edges.find((e) => e.id === embedId("h", "ce1")));
assert.ok(tree.nodes.find((n) => n.id === "s")?.parent_node_id === null);

// closesCycle: candidate refs reach current → true
const refs = new Map<number, number[]>([[7, [3]], [3, [1]]]);
assert.equal(closesCycle(7, 1, refs), true);   // 7→3→1
assert.equal(closesCycle(7, 9, refs), false);
assert.equal(closesCycle(1, 1, new Map()), true); // self-reference

console.log("PASS sanity-subprocess-embed");
