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
    { id: "q4", kind: "text", maps_to: "conditions", section: "exceptions", why: "첨부에 시작 시점이 없음", text: "시작 조건", options: [], suggested: "요청서 도착" },
    { id: "q7", kind: "single", maps_to: "branches", section: "exceptions", why: "완결성 판정에서 미비일 때의 경로가 자료에 없음", text: "완결성 판정에서 미비하면?", options: [{ id: "b1", label: "보완 요청 후 재판정" }, { id: "b2", label: "반려 종료" }], suggested: ["b1"] },
    { id: "q5", kind: "text", maps_to: "io", section: "io", text: "입력물", options: [], suggested: "요청서" },
    { id: "q6", kind: "text", maps_to: "io", section: "io", text: "산출물", options: [], suggested: "접수증" },
  ],
};

// ── 워스트 케이스 모드(FAKE_AI_WORST=1): 문항 12개·긴 문장·선택지 12개, 행 12활동·분기 2·되돌아감 1, 연결은 분기·루프 포함.
// 화면 밀도·줄바꿈·스크롤 확인용(pw-fw-consult-worst.mjs). 기본 모드의 스모크 계약(q4 text 등)은 건드리지 않는다.
const WORST = process.env.FAKE_AI_WORST === "1";
const LONG = "고객사 담당자가 제출한 요청서와 첨부 규격서, 이전 회차의 승인 이력까지 대조하여 누락된 항목이 없는지";
function worstQuestionnaire() {
  const opts = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, label: `${prefix === "a" ? "활동" : "선택지"} ${i + 1}: ${LONG.slice(0, 18 + (i * 7) % 40)}` }));
  const q = (id, kind, maps_to, section, text, options, suggested, why) => ({ id, kind, maps_to, section, text, options, suggested, why });
  return { questions: [
    q("q1", "ordered", "activities", "activities", `이 업무의 활동 순서를 확정해 주세요. ${LONG} 확인하는 단계를 포함해 12개 후보 중 실제로 수행하는 것만 순서대로 고르세요.`, opts("a", 12), Array.from({ length: 12 }, (_, i) => `a${i + 1}`), "첨부 SOP-수주관리.docx 4.2절의 순서와 업무분장표의 순서가 서로 달라 어느 쪽이 현재 실무인지 확정이 필요합니다"),
    q("q2", "single", "branches", "exceptions", `완결성 판정에서 미비로 판정되면 어디로 되돌아갑니까? ${LONG} 재확인해야 하는 경우와 단순 보완 요청으로 끝나는 경우를 구분해 주세요.`, opts("b", 5), ["b1"], "SOP에 반려 후 경로가 적혀 있지 않음(4.3절은 보완 요청만 언급)"),
    q("q3", "single", "roles", "exceptions", "미비 판정의 최종 판단 주체는 누구입니까? 담당자가 1차 판정하고 관리자가 승인하는 2단계인지, 담당자 단독인지 골라 주세요.", opts("c", 4), ["c2"], "업무분장표에는 담당자와 관리자가 모두 검토로 적혀 있어 판단 주체가 애매합니다"),
    q("q4", "text", "conditions", "exceptions", "긴급 요청(당일 처리)일 때 건너뛰는 단계가 있다면 어떤 조건에서 어떤 단계를 건너뛰는지 문장으로 적어 주세요.", [], `긴급 요청은 영업 부문장이 승인한 경우에 한해 완결성 검토를 사후로 미루고 견적 산출로 바로 진행하며, 사후 검토에서 미비가 발견되면 견적을 회수한다.`, "첨부에 긴급 처리 규정이 없고 이웃 L6 '견적 산출'이 긴급 경로를 전제로 적혀 있음"),
    q("q5", "multi", "branches", "exceptions", "견적 산출과 계약 조건 확인이 동시에 진행될 때, 어느 한쪽이 실패하면 다른 쪽도 중단합니까? 해당하는 경우를 모두 고르세요.", opts("d", 6), ["d1", "d3"], "두 L6가 동시 진행으로 계획되어 있으나 실패 시 처리가 어디에도 없음"),
    q("q6", "single", "conditions", "exceptions", "결과 통보 후 고객 회신이 기한 내 없으면 어떻게 처리합니까?", opts("e", 4), ["e2"], "SOP 5.1절에 회신 기한(5영업일)만 있고 미회신 처리가 없음"),
    q("q7", "single", "roles", "basic", "이 업무의 담당 역할을 골라 주세요(카탈로그 표기 우선).", opts("f", 6), ["f1"], "업무분장표에서 읽어냈으나 직급 표기가 카탈로그와 달라 확인이 필요합니다"),
    q("q8", "multi", "systems", "basic", "사용하는 시스템을 모두 고르세요.", opts("g", 8), ["g1", "g4"], "첨부에 ERP 화면 캡처만 있어 메일·그룹웨어 사용 여부를 알 수 없음"),
    q("q9", "text", "io", "io", "입력물을 적어 주세요(여러 개면 줄바꿈).", [], "고객 요청서(양식 F-101)\n첨부 규격서\n이전 회차 승인 이력", "첨부 규격서의 필수 여부가 문서마다 다르게 적혀 있음"),
    q("q10", "text", "io", "io", "산출물을 적어 주세요(여러 개면 줄바꿈).", [], "접수 확인서\n견적서 초안\n계약 조건 검토 메모", "산출물 명칭이 SOP와 업무분장표에서 다름"),
    q("q11", "single", "params", "basic", "이 업무는 한 건당 보통 얼마나 걸립니까?", opts("h", 5), ["h3"], "첨부에 처리 시간이 없음"),
    q("q12", "multi", "conditions", "exceptions", `종료 조건을 모두 고르세요. ${LONG} 확인이 끝난 시점을 종료로 볼지, 고객 회신까지를 종료로 볼지가 핵심입니다.`, opts("i", 5), ["i1", "i2"], "이웃 L6 '결과 통보'와 경계가 겹칠 수 있음"),
  ] };
}
function worstRow(name) {
  const labels = ["요청서 수령 및 등록", "첨부 규격서 대조", "이전 회차 승인 이력 조회", "완결성 판정", "보완 요청 발송", "긴급 여부 판정", "견적 산출 의뢰", "계약 조건 검토 의뢰", "검토 결과 취합", "결과 통보서 작성", "고객 회신 접수", "접수 종결 처리"];
  return {
    l6: name, ownerRole: "담당자", department: "고객지원", fields: { start_condition: "요청서 도착", done_criteria: "접수 종결", frequency: "일 20건", total_time: "2.30" },
    actions: labels.map((label, i) => ({ seq: i + 1, label, kind: label.endsWith("판정") ? "decision" : (i === 4 ? "handoff" : "action"), input: i === 0 ? ["요청서", "첨부 규격서"] : [`${labels[i - 1]} 결과`], output: [`${label} 결과`], system: i % 3 === 0 ? "ERP" : "" })),
    relations: { edges: [
      ...labels.slice(1).map((_, i) => ({ src: i + 1, dst: i + 2, kind: "seq" })).filter((e) => e.src !== 4 && e.src !== 6),
      { src: 4, dst: 5, kind: "branch", gateway: "exclusive", condition: "미비(필수 항목 누락 또는 규격서 불일치)" },
      { src: 4, dst: 6, kind: "branch", gateway: "exclusive", condition: "완결" },
      { src: 5, dst: 2, kind: "loop", condition: "보완 자료 도착" },
      { src: 6, dst: 7, kind: "branch", gateway: "exclusive", condition: "긴급 아님" },
      { src: 6, dst: 10, kind: "branch", gateway: "exclusive", condition: "긴급(부문장 승인)" },
    ] },
  };
}
function worstRelations(ids) {
  const edges = ids.slice(1).map((dst, i) => ({ src: ids[i], dst, kind: "seq" }));
  if (ids.length >= 6) {
    edges.splice(2, 1, { src: ids[2], dst: ids[3], kind: "branch", gateway: "exclusive", condition: "완결성 검토 통과(필수 항목 전부 확인)" }, { src: ids[2], dst: ids[5], kind: "branch", gateway: "exclusive", condition: "긴급 처리(영업 부문장 승인)" });
    edges.push({ src: ids[ids.length - 1], dst: ids[1], kind: "loop", condition: "고객 회신에서 변경 요청" });
  }
  return { entry: { taskId: ids[0] ?? "", triggerType: "message", label: "고객 요청서 도착" }, edges };
}

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
  if (WORST) return worstRow(name);
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
  if (WORST) return worstRelations(ids);
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
  if (system.includes("설문지를 만드세요")) return WORST ? worstQuestionnaire() : QUESTIONNAIRE;
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
