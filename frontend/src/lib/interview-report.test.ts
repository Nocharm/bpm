import { describe, expect, it } from "vitest";

import type { GovernanceDiff } from "./api";
import {
  buildImportReportView,
  buildInterviewIndex,
  buildReportRelations,
  classifyDetail,
  classifyFileIssue,
  countExternalByCanvas,
  fileOfCode,
  governanceKey,
  groupGovernanceDiffs,
  parseGovernanceKey,
  sumCanvasAdditions,
  type ExternalRefEntry,
  type ImportRow,
} from "./interview-report";

function makeFile(name: string, l5Code: string, l5Label: string, rows: [string, string][]) {
  return {
    name,
    content: {
      framework: {
        categories: [
          { code: "19", name: "EPCV", parent: null },
          { code: "19-01", name: "Facility", parent: "19" },
          { code: l5Code, name: l5Label, parent: "19-01" },
        ],
      },
      l5: { nodeCode: l5Code, label: l5Label },
      rows: rows.map(([taskId, l6]) => ({
        taskId,
        l6,
        unitId: `${taskId}-unit`,
        department: "QC/QC Support",
        ownerRole: "교정 담당자",
        actions: [
          { seq: 1, label: "준비", kind: "action" },
          { seq: 2, label: "판정", kind: "decision" },
          { seq: 3, label: "수행", kind: "action" },
        ],
      })),
    },
  };
}

const FILE_A = makeFile("calibration.json", "19-01-06-01-02", "Calibration 수행", [
  ["task-0001", "교정 준비"],
  ["task-0002", "교정 수행"],
]);

describe("buildInterviewIndex", () => {
  it("maps task codes to their human labels and category path", () => {
    const index = buildInterviewIndex([FILE_A]);

    expect(index.maps.get("task-0001")?.name).toBe("교정 준비");
    expect(index.maps.get("task-0002")?.unitId).toBe("task-0002-unit");
    expect(index.files[0].categoryPath).toBe("EPCV › Facility › Calibration 수행");
    expect(index.files[0].l5Name).toBe("Calibration 수행");
  });

  it("tolerates files whose shape is not the interview schema", () => {
    const index = buildInterviewIndex([{ name: "junk.json", content: { hello: 1 } }]);

    expect(index.maps.size).toBe(0);
    expect(index.files[0]).toMatchObject({ name: "junk.json", l5Code: "", categoryPath: "" });
  });
});

describe("classifyDetail", () => {
  it("splits known messages into kind and subject", () => {
    expect(classifyDetail("warning", "approver 'cheolsu.kim' not found in employees")).toMatchObject({
      kind: "approver-not-found",
      severity: "warning",
      subject: "cheolsu.kim",
    });
    expect(classifyDetail("warning", "owner missing - fallback to importer (pending)").kind).toBe(
      "owner-fallback",
    );
    expect(classifyDetail("created", "published v3")).toMatchObject({ kind: "published", numbers: [3] });
    expect(classifyDetail("linkage", "canvas created (map 21, +11 nodes/edges)")).toMatchObject({
      kind: "canvas",
      subject: "created",
      numbers: [21, 11],
    });
  });

  it("keeps unknown messages verbatim", () => {
    const msg = classifyDetail("warning", "something new happened");

    expect(msg.kind).toBe("other");
    expect(msg.raw).toBe("something new happened");
  });

  it("classifies the external-reference messages from the importer", () => {
    expect(classifyDetail("linkage", "linked external task '검체 접수' @ 20-01-01-01-01 -> map 12")).toMatchObject({
      kind: "external-linked",
      severity: "info",
      subject: "검체 접수",
      numbers: [12],
      captures: ["검체 접수", "20-01-01-01-01", "12"],
    });
    expect(
      classifyDetail("linkage", "placeholder for external task '외부 업무' @ 20-02-01-01-01 (map not delivered yet)"),
    ).toMatchObject({ kind: "external-placeholder", subject: "외부 업무" });
    expect(
      classifyDetail("warning", "external task '중복' @ 20-02-01-01-01: 2 maps share the name - left as placeholder"),
    ).toMatchObject({ kind: "external-ambiguous", severity: "warning", subject: "중복", numbers: [2] });
    expect(
      classifyDetail("warning", "external L5 22-01-01-01-01 not found - placeholder without origin"),
    ).toMatchObject({ kind: "external-l5-unknown", subject: "22-01-01-01-01" });
    expect(classifyDetail("linkage", "resolved 3 external placeholder node(s)")).toMatchObject({
      kind: "external-resolved",
      numbers: [3],
      subject: "",
    });
  });
});

describe("buildImportReportView", () => {
  const rows: ImportRow[] = [
    { code: "task-0001", action: "warning", detail: "owner missing - fallback to importer (pending)" },
    { code: "task-0002", action: "warning", detail: "owner missing - fallback to importer (pending)" },
    { code: "task-0002", action: "warning", detail: "approver 'cheolsu.kim' not found in employees" },
    { code: "task-0001", action: "created", detail: "published v1" },
    { code: "task-0002", action: "created", detail: "published v1" },
    { code: "19-01-06-01-02", action: "linkage", detail: "canvas created (map 21, +11 nodes/edges)" },
  ];

  it("nests maps under their source file with names and versions", () => {
    const view = buildImportReportView(rows, buildInterviewIndex([FILE_A]));

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].file).toBe("calibration.json");
    expect(view.groups[0].maps.map((m) => m.name)).toEqual(["교정 준비", "교정 수행"]);
    expect(view.groups[0].maps[0]).toMatchObject({ outcome: "created", version: 1 });
    expect(view.groups[0].maps[1].messages).toHaveLength(2);
  });

  it("routes L5 category rows to the file's linkage canvas", () => {
    const view = buildImportReportView(rows, buildInterviewIndex([FILE_A]));

    expect(view.groups[0].canvas).toMatchObject({ code: "19-01-06-01-02", name: "Calibration 수행" });
    expect(view.groups[0].canvas?.messages[0]).toMatchObject({ kind: "canvas", numbers: [21, 11] });
    expect(view.externalRefs).toEqual([]);
    expect(view.externalSummary).toEqual({ linked: 0, placeholder: 0, ambiguous: 0, unknownOrigin: 0, resolved: 0 });
  });

  it("collects external L6 references into one table, action-needed first", () => {
    const external: ImportRow[] = [
      ...rows,
      { code: "19-01-06-01-02", action: "linkage", detail: "linked external task '정제수 일상 점검 수행' @ 19-01-02-01-01 -> map 41" },
      { code: "19-01-06-01-02", action: "warning", detail: "external L5 19-01-05-01-01 not found - placeholder without origin" },
      { code: "19-01-06-01-02", action: "linkage", detail: "placeholder for external task '작업지시 발행 및 배정' @ 19-01-05-01-01 (map not delivered yet)" },
      { code: "19-01-06-01-02", action: "warning", detail: "external task '중복 이름' @ 20-02-01-01-01: 2 maps share the name - left as placeholder" },
      { code: "19-01-06-01-02", action: "linkage", detail: "placeholder for external task '중복 이름' @ 20-02-01-01-01 (map not delivered yet)" },
      { code: "19-01-06-01-02", action: "linkage", detail: "placeholder for external task 'phx-ext-0001' @ unknown (map not delivered yet)" },
      { code: "linkage", action: "linkage", detail: "resolved 3 external placeholder node(s)" },
    ];
    const view = buildImportReportView(external, buildInterviewIndex([FILE_A]));

    expect(view.externalRefs.map((r) => [r.title, r.l5Code, r.state])).toEqual([
      ["작업지시 발행 및 배정", "19-01-05-01-01", "unknown-origin"],
      ["중복 이름", "20-02-01-01-01", "ambiguous"], // 모호 경고가 같은 참조의 자리표 행을 이긴다
      ["phx-ext-0001", "unknown", "placeholder"],
      ["정제수 일상 점검 수행", "19-01-02-01-01", "linked"],
    ]);
    expect(view.externalRefs[3]).toMatchObject({ mapId: 41, canvasName: "Calibration 수행" });
    expect(view.externalRefs[1].sameNameCount).toBe(2);
    expect(view.externalSummary).toEqual({ linked: 1, placeholder: 1, ambiguous: 1, unknownOrigin: 1, resolved: 3 });
    // "linkage" 고정 코드의 후차 해소 행은 맵 항목을 만들지 않는다
    expect(view.groups.every((g) => g.file !== "")).toBe(true);
  });

  it("lists category admins added from the file apart from maps and canvases", () => {
    const withAdmins: ImportRow[] = [
      ...rows,
      { code: "19-01-06-01-02", action: "category", detail: "category admin 'cheolsu.kim' added @ 19-01-06-01-02" },
      { code: "19-01", action: "warning", detail: "category admin 'ghost.user' not found in employees @ 19-01" },
      { code: "19-01", action: "category", detail: "category admin 'ghost.user' added @ 19-01" },
    ];
    const view = buildImportReportView(withAdmins, buildInterviewIndex([FILE_A]));

    expect(view.adminChanges).toEqual([
      { code: "19-01-06-01-02", login: "cheolsu.kim", state: "added" },
      { code: "19-01", login: "ghost.user", state: "unknown" },
      { code: "19-01", login: "ghost.user", state: "added" },
    ]);
    // L5 코드 행이지만 캔버스 문구로 새지 않고, 상위 코드 행도 미매칭 그룹을 만들지 않는다
    expect(view.groups[0].canvas?.messages.every((m) => !m.kind.startsWith("category-admin"))).toBe(true);
    expect(view.groups.every((g) => g.file !== "")).toBe(true);
  });

  it("folds repeated warnings into one digest line per kind", () => {
    const view = buildImportReportView(rows, buildInterviewIndex([FILE_A]));

    const fallback = view.digest.find((d) => d.kind === "owner-fallback");
    expect(fallback).toMatchObject({ count: 2 });
    expect(fallback?.maps.map((m) => m.name)).toEqual(["교정 준비", "교정 수행"]);
    const approver = view.digest.find((d) => d.kind === "approver-not-found");
    expect(approver?.subjects).toEqual(["cheolsu.kim"]);
  });

  it("puts errors first in the digest and keeps their reason attached to the map", () => {
    const errorRows: ImportRow[] = [
      ...rows,
      { code: "task-0002", action: "error", detail: "map is in trash - restore or purge before re-import" },
    ];
    const view = buildImportReportView(errorRows, buildInterviewIndex([FILE_A]));

    expect(view.digest[0].kind).toBe("in-trash");
    expect(view.groups[0].maps[1].outcome).toBe("error");
  });

  it("collects codes that match no uploaded file into a trailing group", () => {
    const view = buildImportReportView(
      [{ code: "ghost-0001", action: "warning", detail: "sp_department empty" }],
      buildInterviewIndex([FILE_A]),
    );

    expect(view.groups[1]).toMatchObject({ file: "" });
    expect(view.groups[1].maps[0]).toMatchObject({ code: "ghost-0001", name: "ghost-0001" });
  });
});

describe("groupGovernanceDiffs", () => {
  const diff = (code: string, field: GovernanceDiff["field"], name = `map ${code}`): GovernanceDiff => ({
    code, name, field, current: "x", delivered: "y", applied: false,
  });

  it("groups by map in first-seen order and orders fields owner→department→approvers", () => {
    const groups = groupGovernanceDiffs([
      diff("t2", "approvers"), diff("t1", "department"), diff("t2", "owner"), diff("t1", "owner"),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["t2", "t1"]);
    expect(groups[0].name).toBe("map t2");
    expect(groups[0].diffs.map((d) => d.field)).toEqual(["owner", "approvers"]);
    expect(groups[1].diffs.map((d) => d.field)).toEqual(["owner", "department"]);
  });

  it("round-trips keys even when the code contains a colon", () => {
    const key = governanceKey({ code: "a:b", field: "owner" });
    expect(key).toBe("a:b:owner");
    expect(parseGovernanceKey(key)).toEqual({ code: "a:b", field: "owner" });
  });
});

describe("file issues folded into the digest", () => {
  const files = [
    {
      name: "calibration.json",
      issues: [
        {
          severity: "warning",
          path: "rows[1].relations.edges[0]",
          message: "a02 promoted to decision (exclusive branch edge) - 택일 분기가 있어 판단(마름모) 노드로 자동 변환",
        },
        {
          severity: "warning",
          path: "rows[0].relations.edges[2]",
          message:
            "self edge on seq 3 - kept as loop via auto-generated branch node a03r (자기 반복 - 분기 노드 '반복 여부(자동 생성됨)'를 자동 생성해 되도는 연결로 변환)",
        },
        {
          severity: "warning",
          path: "externalTasks[1].l5",
          message:
            "external L5 '22-01-01-01-01' not in framework.categories - resolved against existing framework (파일에 없는 L5 - 기존 체계로 해석)",
        },
        { severity: "error", path: "rows[1].actions[0].label", message: "label too long - truncated (200자 초과)" },
      ],
    },
  ];

  it("classifies adapter messages by their English head", () => {
    expect(classifyFileIssue(files[0].issues[0])).toMatchObject({
      kind: "file-decision-promoted",
      severity: "warning",
      subject: "a02",
    });
    expect(classifyFileIssue(files[0].issues[1])).toMatchObject({ kind: "file-self-edge", numbers: [3] });
    expect(classifyFileIssue(files[0].issues[2])).toMatchObject({
      kind: "file-external-l5-missing",
      subject: "22-01-01-01-01",
    });
    expect(classifyFileIssue(files[0].issues[3])).toMatchObject({ kind: "file-issue", severity: "error" });
  });

  it("attaches row issues to the map (step names, row warning count) and file issues to the canvas", () => {
    const view = buildImportReportView(
      [
        { code: "task-0001", action: "created", detail: "published v1" },
        { code: "task-0002", action: "created", detail: "published v1" },
      ],
      buildInterviewIndex([FILE_A]),
      files,
    );

    const promoted = view.digest.find((g) => g.kind === "file-decision-promoted");
    expect(promoted?.subjects).toEqual(["판정"]); // a02 → actions seq 2 라벨
    expect(promoted?.maps.map((m) => m.code)).toEqual(["task-0002"]);
    const selfEdge = view.digest.find((g) => g.kind === "file-self-edge");
    expect(selfEdge?.subjects).toEqual(["수행"]); // seq 3
    expect(selfEdge?.maps[0]).toMatchObject({ code: "task-0001", name: "교정 준비" });
    const external = view.digest.find((g) => g.kind === "file-external-l5-missing");
    expect(external?.maps[0]).toMatchObject({ code: "19-01-06-01-02", name: "Calibration 수행" });
    expect(view.groups[0].maps.find((m) => m.code === "task-0002")?.messages.map((m) => m.kind)).toEqual([
      "file-decision-promoted",
      "file-issue",
    ]);
    expect(view.fileIssueCounts).toEqual({ warnings: 3, errors: 1 });
  });

  it("keeps issues of an excluded file (no map rows) in the digest under the map name", () => {
    const view = buildImportReportView([], buildInterviewIndex([FILE_A]), files);

    expect(view.groups[0].maps).toHaveLength(0);
    expect(view.digest.find((g) => g.kind === "file-self-edge")?.maps[0].name).toBe("교정 준비");
  });
});

describe("layout A helpers", () => {
  const ref = (canvasCode: string, state: ExternalRefEntry["state"]): ExternalRefEntry => ({
    title: "t", l5Code: "x", canvasCode, canvasName: "", state, mapId: null, sameNameCount: null,
  });

  it("keeps the lineage chain with codes for the header breadcrumb", () => {
    const index = buildInterviewIndex([FILE_A]);

    expect(index.files[0].chain.map((c) => c.code)).toEqual(["19", "19-01", "19-01-06-01-02"]);
    expect(index.files[0].chain[1].name).toBe("Facility");
  });

  it("counts external references per home canvas", () => {
    const counts = countExternalByCanvas([
      ref("A", "linked"), ref("A", "placeholder"), ref("B", "unknown-origin"), ref("A", "ambiguous"),
    ]);

    expect(counts.get("A")).toEqual({ linked: 1, placeholder: 1, ambiguous: 1, unknownOrigin: 0 });
    expect(counts.get("B")).toEqual({ linked: 0, placeholder: 0, ambiguous: 0, unknownOrigin: 1 });
  });

  it("sums the nodes and edges added to linkage canvases", () => {
    const view = buildImportReportView(
      [
        { code: "19-01-06-01-02", action: "linkage", detail: "canvas created (map 21, +11 nodes/edges)" },
        { code: "task-0001", action: "created", detail: "published v1" },
      ],
      buildInterviewIndex([FILE_A]),
    );

    expect(sumCanvasAdditions(view)).toBe(11);
  });

  it("relates map, canvas and lineage codes back to their file", () => {
    const relations = buildReportRelations(buildInterviewIndex([FILE_A]));

    expect(fileOfCode(relations, "task-0001")).toBe(0);
    expect(fileOfCode(relations, "19-01-06-01-02")).toBe(0);
    expect(fileOfCode(relations, "nope")).toBeNull();
    expect(relations.filesOfCategory.get("19")).toEqual([0]);
    expect(relations.filesOfCategory.get("19-01-06-01-02")).toEqual([0]);
  });
});
