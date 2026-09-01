import { describe, expect, it } from "vitest";

import {
  buildImportReportView,
  buildInterviewIndex,
  classifyDetail,
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
    expect(classifyDetail("warning", "owner missing — fallback to importer (pending)").kind).toBe(
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
});

describe("buildImportReportView", () => {
  const rows: ImportRow[] = [
    { code: "task-0001", action: "warning", detail: "owner missing — fallback to importer (pending)" },
    { code: "task-0002", action: "warning", detail: "owner missing — fallback to importer (pending)" },
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
      { code: "task-0002", action: "error", detail: "map is in trash — restore or purge before re-import" },
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
