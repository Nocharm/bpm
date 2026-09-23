// 캠페인 스모크용 가짜 AI — OpenAI 호환 /v1/chat/completions. system 프롬프트의 계약 마커로 어떤 단계인지 알아
// backend 테스트(tests/test_framework_interview_runner.py Q_JSON·ROW_JSON)와 같은 모양의 JSON을 돌려준다.
// 실행(frontend/ 에서): node scripts/fake-ai-server.mjs
//   → backend는 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake AI_API_TOKEN=fake AI_ENDPOINTS=""
//     (ai_client는 토큰이 비어도 Bearer 헤더를 보내므로 빈 토큰이면 "Illegal header value"로 502가 난다)
import http from "node:http";

const PORT = Number(process.env.FAKE_AI_PORT ?? 9999);

const PLAN = {
  cards: [
    { name: "요청 접수", summary: "요청을 받는다", owner_role: "담당자", department: "", depends_on: [] },
    { name: "검토 승인", summary: "검토한다", owner_role: "관리자", department: "", depends_on: ["요청 접수"] },
  ],
};
const QUESTIONNAIRE = {
  questions: [
    { id: "q1", kind: "ordered", maps_to: "activities", section: "activities", text: "활동 순서", options: [{ id: "a1", label: "요청 확인" }, { id: "a2", label: "완결성 판정" }, { id: "a3", label: "접수 등록" }], suggested: ["a1", "a2", "a3"] },
    { id: "q2", kind: "single", maps_to: "roles", section: "basic", text: "담당 역할", options: [{ id: "r1", label: "담당자" }, { id: "r2", label: "관리자" }], suggested: ["r1"] },
    { id: "q3", kind: "multi", maps_to: "systems", section: "basic", text: "사용 시스템", options: [{ id: "s1", label: "ERP" }, { id: "s2", label: "메일" }], suggested: ["s1"] },
    { id: "q4", kind: "text", maps_to: "conditions", section: "exceptions", text: "시작 조건", options: [], suggested: "요청서 도착" },
    { id: "q5", kind: "text", maps_to: "io", section: "io", text: "입력물", options: [], suggested: "요청서" },
    { id: "q6", kind: "text", maps_to: "io", section: "io", text: "산출물", options: [], suggested: "접수증" },
  ],
};

// [이미 있는 L6 맵] 블록("- CODE · NAME: summary …")이 있으면 그 맵들을 코드째 카드로 되돌린다(계약: 유지 카드는 existing_code) —
// 없으면 기본 2장. 기존 L6 스모크(pw-fw-consult-existing.mjs)가 이 병합 경로를 밟는다.
function planFor(userText) {
  const block = /\[이미 있는 L6 맵\]\n([\s\S]*)$/.exec(userText)?.[1] ?? "";
  const existing = [...block.matchAll(/^- (\S+) · (.+?):/gm)].map((m) => ({ code: m[1], name: m[2].trim() }));
  if (existing.length === 0) return PLAN;
  return {
    cards: existing.map((m, i) => ({
      name: m.name, summary: "기존 맵", owner_role: "담당자", department: "",
      depends_on: i === 0 ? [] : [existing[i - 1].name], existing_code: m.code,
    })),
  };
}

// [L6]\n이름: X 를 읽어 그 이름으로 행을 만든다 — 계획 카드와 이름이 맞아야 등록 리포트가 매칭된다
function rowFor(userText) {
  const name = (/\[L6\]\n이름: (.+)/.exec(userText)?.[1] ?? "요청 접수").trim();
  return {
    l6: name, ownerRole: "담당자", department: "", fields: { start_condition: "요청서 도착", done_criteria: "접수증 발급" },
    actions: [
      { seq: 1, label: "요청 확인", kind: "action", input: ["요청서"], output: ["확인 메모"] },
      { seq: 2, label: "완결성 판정", kind: "decision" },
      { seq: 3, label: "접수 등록", kind: "action", input: ["확인 메모"], output: ["접수증"], system: "ERP" },
    ],
    relations: { edges: [{ src: 1, dst: 2, kind: "seq" }, { src: 2, dst: 3, kind: "branch", gateway: "exclusive", condition: "완결" }] },
  };
}

// [L6 목록]의 taskId=… 를 순서대로 seq 연결
function relationsFor(userText) {
  const ids = [...userText.matchAll(/taskId=(\S+)/g)].map((m) => m[1]);
  const edges = ids.slice(1).map((dst, i) => ({ src: ids[i], dst, kind: "seq" }));
  return { entry: { taskId: ids[0] ?? "", triggerType: "manual", label: "시작" }, edges };
}

// [현재 캔버스]\n{...} 블록을 파싱해 첫 subprocess→subprocess 엣지의 방향을 뒤집는다(피드백 반영 흉내)
function canvasFeedbackFor(userText) {
  const match = /\[현재 캔버스\]\n([\s\S]*?)\n\n\[사용자 피드백\]/.exec(userText);
  const canvas = match ? JSON.parse(match[1]) : { nodes: [], edges: [] };
  const nodeType = new Map((canvas.nodes ?? []).map((n) => [n.id, n.node_type]));
  const edges = (canvas.edges ?? []).map((e) => ({ ...e }));
  const flip = edges.find((e) => nodeType.get(e.source_node_id) === "subprocess" && nodeType.get(e.target_node_id) === "subprocess");
  if (flip) {
    const src = flip.source_node_id;
    flip.source_node_id = flip.target_node_id;
    flip.target_node_id = src;
  }
  return {
    nodes: (canvas.nodes ?? []).map((n) => ({ id: n.id, node_type: n.node_type, title: n.title, task_id: n.task_id, pos_x: n.pos_x, pos_y: n.pos_y })),
    edges: edges.map((e) => {
      const out = { id: e.id, source_node_id: e.source_node_id, target_node_id: e.target_node_id, label: e.label ?? "" };
      if (e.gateway) out.gateway = e.gateway;
      return out;
    }),
  };
}

// [현재 행]\n{...} 블록을 파싱해 l6에 "(수정)"을 붙인다(피드백 반영 흉내)
function rowFeedbackFor(userText) {
  const match = /\[현재 행\]\n([\s\S]*?)\n\n\[사용자 피드백\]/.exec(userText);
  const row = match ? JSON.parse(match[1]) : rowFor("");
  return { ...row, l6: `${row.l6 ?? ""}(수정)` };
}

function route(messages) {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (system.includes("L6 단위 업무")) return planFor(user);
  if (system.includes("설문지를 만드세요")) return QUESTIONNAIRE;
  // 피드백 계약(연계 캔버스(노드·엣지)를 사용자 피드백대로 / rows[] 원소를 사용자 피드백대로)은
  // 기존 relationsFor/rowFor 마커의 부분 문자열을 포함하므로 먼저 검사한다.
  if (system.includes("연계 캔버스(노드·엣지)를 사용자 피드백대로")) return canvasFeedbackFor(user);
  if (system.includes("rows[] 원소를 사용자 피드백대로")) return rowFeedbackFor(user);
  if (system.includes("rows[] 원소")) return rowFor(user);
  if (system.includes("연계 캔버스")) return relationsFor(user);
  return {};
}

http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "fake" }] }));
    return;
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let content = "{}";
    try {
      content = JSON.stringify(route(JSON.parse(body).messages ?? []));
    } catch {
      content = "{}";
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
}).listen(PORT, () => console.log(`fake ai on :${PORT}`));
