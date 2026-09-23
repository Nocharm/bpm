// 외부 AI용 인터뷰 JSON 0.5 작성 프롬프트 — CSV의 buildAiPromptText와 같은 왕복(복사→외부 AI→관리자 임포트).
// 키 이름은 backend/scripts/consultant_interview.py의 _TOP_KEYS/_ROW_KEYS/_FIELD_KEYS/_ACTION_KEYS/_EDGE_KEYS와 동기.
// 계약이 바뀌면 docs/samples/interview-json-0.5.md와 이 파일을 같이 옮긴다 (spec 2026-09-21 결합 표면 3종).

export interface InterviewPromptTarget {
  code: string; // L5 nodeCode (process_categories.code)
  name: string;
  path: string[]; // L1..L4 이름
  existingL6?: { code: string; name: string }[]; // 이미 등록된 L6 — 같은 taskId면 임포트가 갱신한다
}

const SKELETON = {
  schema_version: "0.5-bpm-interface-draft",
  labelSource: "human-confirmed",
  framework: { categories: [{ code: "L1코드", name: "L1 이름", level: 1, parent: null }] },
  l5: { label: "L5 이름", nodeCode: "L5코드" },
  rows: [
    {
      taskId: "L5코드-01",
      l6: "L6 업무명",
      owner: null,
      ownerRole: "역할명",
      approvers: [],
      department: null,
      fields: {
        start_condition: "", input_data: "", output_data: "", done_criteria: "",
        systems: "", total_time: "", frequency: "", headcount: null, fte: null, gmp: "",
      },
      actions: [
        { seq: 1, label: "활동명", name: "한 문장 설명", kind: "action", variant: "normal", rule: null, input: [], output: [], system: "" },
        { seq: 2, label: "판정", name: "", kind: "decision", variant: "normal", rule: "판단 기준", input: [], output: [], system: null },
      ],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "seq", gateway: null, condition: null, label: null },
          { src: 2, dst: 1, kind: "loop", gateway: "exclusive", condition: "보완 필요", label: "재작업" },
        ],
      },
    },
  ],
  relations: {
    entry: { taskId: "L5코드-01", triggerType: "manual", label: "시작 계기" },
    edges: [{ src: "L5코드-01", dst: "L5코드-02", kind: "seq", gateway: null, condition: null, label: null }],
  },
  externalTasks: [],
};

export function buildInterviewJsonPromptText(target?: InterviewPromptTarget): string {
  const pathLine = target ? [...target.path, target.name].join(" > ") : "(L5 경로를 여기에 적으세요)";
  const codeLine = target ? target.code : "(L5 코드를 여기에 적으세요)";
  const existing = target?.existingL6 ?? [];
  // 이미 등록된 L6는 taskId가 곧 갱신 키다 — 손댈 것만 rows에 담게 해 무변경 행의 재작성을 막는다.
  const existingBlock = existing.length
    ? [
        "[이미 있는 L6]",
        ...existing.map((row) => `- ${row.code} · ${row.name}`),
        "- 규칙: 같은 taskId로 rows에 넣으면 갱신되고 빼면 그대로 둔다.",
        "",
      ]
    : [];
  return [
    "당신은 업무 프로세스 컨설턴트입니다. 아래 L5 업무에 대해 첨부 문서(규정, 지침, 절차서, 인터뷰 메모)를 읽고,",
    "그 아래 L6 단위 업무들과 각 L6의 활동 흐름을 인터뷰 결과 JSON 한 개로 작성하세요.",
    "",
    `[대상 L5] ${pathLine}`,
    `[L5 코드] ${codeLine}`,
    "",
    "[출력 형식, 반드시 지킬 것]",
    "- 다른 설명이나 코드블록 없이 JSON 객체 하나만 출력하세요.",
    '- schema_version은 정확히 "0.5-bpm-interface-draft".',
    "- framework.categories는 L1부터 L5까지 코드, 이름, level, parent(상위 코드 또는 null).",
    "- l5.nodeCode는 위 L5 코드, l5.label은 L5 이름.",
    "",
    ...existingBlock,
    "[rows 규칙, L6 하나가 rows 원소 하나]",
    "- taskId는 'L5코드-01', 'L5코드-02'처럼 유일하게. l6는 동사형 업무명.",
    "- owner는 null(실명 금지). ownerRole은 역할명. department는 부서명 또는 null.",
    "- fields: start_condition, input_data, output_data, done_criteria, systems, total_time, frequency, headcount, fte, gmp 중 아는 것만.",
    "- actions: seq는 1부터, label은 동사형 20자 이내, kind는 action, handoff, decision 중 하나. variant는 normal 또는 exception.",
    "- input/output은 문자열 배열입니다(한 항목 = 한 줄). 앞 활동의 output 항목을 다음 활동의 input에 같은 표기로 다시 쓰면 자동으로 이어집니다.",
    "- relations.edges의 src/dst는 actions의 seq 정수. kind는 seq, branch, loop, bypass. 분기는 gateway exclusive 또는 parallel과 condition.",
    "- 모든 활동이 이어지도록 edges를 채우세요. 비우면 순번 순서로 자동 연결됩니다.",
    "",
    "[최상위 relations, L6 사이의 흐름]",
    "- entry.taskId는 처음 시작하는 L6. triggerType은 manual, timer, message, condition.",
    "- edges의 src/dst는 rows의 taskId. 다른 L5의 L6를 가리키려면 externalTasks에 refId, l5.nodeCode, l6를 선언하고 그 refId를 쓰세요.",
    "",
    "[골격, 값만 바꿔 채우세요]",
    JSON.stringify(SKELETON, null, 2),
  ].join("\n");
}
