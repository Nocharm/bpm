"""AI L5 캠페인 프롬프트 계약 4종 + 응답 스키마 + 메시지 빌더 (spec 2026-09-21 §4·§5).

계약 문구는 prompt_registry 오버라이드로 교체 가능. 출력은 전부 JSON 한 개.
키 이름은 인터뷰 JSON 0.4/0.5 계약(scripts/consultant_interview.py)과 같다 — 어댑터가 바뀌면 여기도 같이.
"""

import json
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

# ── 응답 스키마 ──


class PlanCard(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    summary: str = ""
    owner_role: str = Field(default="", max_length=100)
    department: str = Field(default="", max_length=100)
    depends_on: list[str] = []
    existing_code: str | None = None  # 병합된 기존 L6 맵의 task_id — merge_existing_cards가 채운다
    mode: Literal["new", "keep", "revise"] = "new"


class PlanOut(BaseModel):
    cards: list[PlanCard] = Field(min_length=1, max_length=40)


class QuestionOption(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=200)


QuestionKind = Literal["single", "multi", "text", "ordered"]
MapsTo = Literal["activities", "branches", "roles", "systems", "io", "conditions", "params"]
QuestionSection = Literal["basic", "activities", "exceptions", "io"]


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: QuestionKind
    maps_to: MapsTo
    section: QuestionSection = "basic"  # 폼 그룹 — exceptions(판단·예외·분기)/activities(활동)/basic(기본 정보)/io(입출력)
    text: str = Field(min_length=1, max_length=600)
    why: str = Field(default="", max_length=300)  # 왜 이 질문이 필요한지(자료에서 빠진 것) — 폼이 문항 아래에 작게 보여준다
    options: list[QuestionOption] = []
    suggested: list[str] | str = []

    @model_validator(mode="after")
    def _check_shape(self) -> "Question":
        if self.kind == "text":
            if not isinstance(self.suggested, str):
                raise ValueError("text question needs a string suggestion")
            return self
        if len(self.options) < 2:
            raise ValueError("choice question needs at least 2 options")
        ids = {o.id for o in self.options}
        if len(ids) != len(self.options):
            raise ValueError("duplicate option id")
        if not isinstance(self.suggested, list) or any(s not in ids for s in self.suggested):
            raise ValueError("suggested must reference option ids")
        return self


class QuestionnaireOut(BaseModel):
    questions: list[Question] = Field(min_length=3, max_length=15)  # 실모델 편차 흡수(요청은 6~12)

    @model_validator(mode="after")
    def _check_activities(self) -> "QuestionnaireOut":
        if not any(q.kind == "ordered" and q.maps_to == "activities" for q in self.questions):
            raise ValueError("questionnaire needs one ordered activities question")
        ids = [q.id for q in self.questions]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate question id")
        return self


class RowAction(BaseModel):
    seq: int = Field(ge=1)
    label: str = Field(min_length=1, max_length=200)
    name: str | None = None
    kind: Literal["action", "handoff", "decision"] = "action"
    variant: str | None = None  # normal|exception
    rule: str | None = None
    input: list[str] | str | None = None  # IO는 배열이 정본 — 정규화가 항상 list[str]로 맞춘다 (2026-09-23)
    output: list[str] | str | None = None
    system: str | None = None


class RowEdge(BaseModel):
    src: int
    dst: int
    kind: Literal["seq", "branch", "loop", "bypass"] = "seq"
    gateway: Literal["exclusive", "parallel"] | None = None
    condition: str | None = None
    label: str | None = None


class RowRelations(BaseModel):
    edges: list[RowEdge] = []


class RowOut(BaseModel):
    """rows[] 원소(taskId 제외) — 키는 어댑터 _ROW_KEYS·_FIELD_KEYS·_ACTION_KEYS의 부분집합."""

    l6: str = Field(min_length=1, max_length=200)
    owner: str | None = None
    ownerRole: str = ""  # noqa: N815 -- 인터뷰 JSON 키 그대로
    department: str = ""
    fields: dict[str, Any] = {}
    actions: list[RowAction] = Field(min_length=2, max_length=20)
    relations: RowRelations | None = None

    @model_validator(mode="after")
    def _check_seq(self) -> "RowOut":
        seqs = [a.seq for a in self.actions]
        if len(set(seqs)) != len(seqs):
            raise ValueError("duplicate action seq")
        return self


class RelationsEntry(BaseModel):
    taskId: str  # noqa: N815
    triggerType: Literal["message", "timer", "condition", "manual"] = "manual"  # noqa: N815
    label: str | None = None


class RelationsEdge(BaseModel):
    src: str
    dst: str
    kind: Literal["seq", "branch", "loop", "bypass"] = "seq"
    gateway: Literal["exclusive", "parallel"] | None = None
    condition: str | None = None
    label: str | None = None


class RelationsOut(BaseModel):
    entry: RelationsEntry
    edges: list[RelationsEdge] = []


class CanvasNodeOut(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    node_type: Literal["subprocess", "decision", "start", "end"]
    title: str = Field(default="", max_length=200)
    task_id: str | None = None
    pos_x: float = 0  # 피드백 응답은 좌표를 0으로 둔다 — 라우터가 relayout_canvas로 다시 배치한다
    pos_y: float = 0


class CanvasEdgeOut(BaseModel):
    id: str = Field(default="", max_length=180)
    source_node_id: str
    target_node_id: str
    label: str = Field(default="", max_length=200)
    gateway: Literal["exclusive", "parallel"] | None = None


class CanvasOut(BaseModel):
    """연계 캔버스 응답 — 저장 형태(canvas.py)와 같은 필드."""

    nodes: list[CanvasNodeOut] = Field(min_length=1)
    edges: list[CanvasEdgeOut] = []

    def to_canvas(self) -> dict:
        """저장 정본 형태 — task_id는 null로 남기고 gateway는 값이 없으면 뺀다(canvas.py 계약)."""
        return {
            "nodes": [n.model_dump() for n in self.nodes],
            "edges": [e.model_dump(exclude_none=True) for e in self.edges],
        }


# ── 계약 문구 (관리자 오버라이드 가능) ──

# 동결 맵 꼬리표 — 캔버스에 하위 맵 링크가 있어 역변환할 수 없는 L6 (existing.load_existing_l6)
FROZEN_MAP_NOTE = "(캔버스에 하위 맵 링크가 있어 편집 불가, 카드를 만들지 않는다)"

L5_PLAN_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 주어진 L5 업무(카테고리 경로)와 설명을 읽고,
그 아래에 등록할 L6 단위 업무(각각 하나의 프로세스 맵) 목록을 제안하세요.

규칙
- 3개 이상 12개 이하. 이 세션에서 이미 만든 카드와 이름이 겹치지 않게.
- [이미 있는 L6 맵]에 있는 맵은 각각 카드 하나로 이름을 그대로 두고 existing_code에 그 코드를 적는다.
- 새 카드는 빈 영역만 채우고 기존 맵과 이름이나 역할이 겹치는 카드는 만들지 않는다.
- name: 동사형 업무명 20자 이내. summary: 한 문장. owner_role: 역할 후보 목록의 표기 우선.
- department: 아는 경우 부서명, 모르면 빈 문자열.
- depends_on: 선행해야 하는 다른 카드의 name 목록(없으면 빈 배열).
- 다른 설명 없이 JSON 한 개만:
{"cards":[{"name":"","summary":"","owner_role":"","department":"","depends_on":[],"existing_code":null}]}"""

L6_QUESTIONNAIRE_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. L6 업무 하나의 흐름을 그리기 위한 설문지를 만드세요.
답하는 사람은 바쁜 현업입니다. 객관식 위주로, 제안 답을 미리 골라 두세요.

설문의 목적은 값을 채우는 것이 아니라, 흐름을 그리는 데 결정이 필요한 애매한 지점을 확정하는 것입니다.
[L5 설명](첨부 포함)·[이웃 L6]·[현재 등록된 내용]을 먼저 읽고, 거기서 이미 답이 나오는 것은 묻지 말고 suggested에 그 값을 담으세요.
주로 물을 것: 판단 지점과 판단 주체, 분기 조건, 반려·미비 시 되돌아가는 곳, 병렬인지 순차인지, 예외 처리 경로,
이 L6가 어디서 시작해 어디서 끝나는지(경계), 이웃 L6와의 인계 시점.
역할·시스템·입력물·산출물은 자료에서 읽어내지 못한 것만 묻습니다.

규칙
- 문항 6개 이상 12개 이하. id는 q1, q2 순서.
- 문항마다 why: 왜 이 질문이 필요한지(자료에서 무엇이 빠졌거나 어긋나는지) 한 줄. 근거가 있으면 출처(첨부 이름·이웃 L6)를 적으세요.
- kind: single(하나)·multi(여러 개)·ordered(순서 있는 여러 개)·text(주관식). text는 최대 3개.
- maps_to: activities·branches·roles·systems·io·conditions·params 중 하나.
- 종류 선택 기준: 하나만 고르는 배타 선택은 single(예/아니오도 single 2옵션), 여럿이 해당하면 multi, 순서가 의미 있으면 ordered, 자유 서술만 text.
- section: exceptions(판단·예외·분기·되돌아감) / activities(활동 순서, ordered 문항) / basic(담당·범위 같은 기본 정보) / io(입력물·산출물·시스템). 문항마다 하나를 적으세요.
- 구성 가이드: exceptions 3~5, activities 1, basic 0~2, io 0~2. 자료에서 답이 나오는 basic·io 문항은 만들지 않습니다.
- 반드시 kind=ordered, maps_to=activities 문항 1개: 활동 후보 5개 이상 12개 이하, suggested에 제안 순서 전부.
- 역할 문항의 options는 역할 후보 목록 표기를, 시스템 문항은 시스템 목록 표기를 우선.
- text 문항의 suggested는 그대로 답으로 써도 되는 완성 문장.
- [현재 등록된 내용]이 있으면 질문은 무엇을 바꿀지를 묻고 suggested는 현재 값을 그대로 담는다.
- [현재 등록된 내용]이 있으면 활동 순서 질문의 options는 현재 활동을 모두 포함하고 추가 후보를 뒤에 둔다.
- 다른 설명 없이 JSON 한 개만:
{"questions":[{"id":"q1","kind":"single","maps_to":"branches","section":"exceptions","why":"","text":"","options":[{"id":"a1","label":""}],"suggested":["a1"]}]}"""

L6_ROW_DRAFTER_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 설문 답을 바탕으로 L6 업무 하나의 흐름을 인터뷰 JSON rows[] 원소로 작성하세요.

규칙
- actions: 활동 문항의 선택 순서를 seq 1부터. label은 동사형 20자 이내, kind는 action·handoff·decision.
- 분기 답이 있으면 판단 activity에 kind=decision을 주고 relations.edges에 kind=branch, gateway=exclusive, condition을 적으세요.
- relations.edges의 src/dst는 actions의 seq 정수. 모든 activity가 이어지게(seq 흐름 + 분기 + 필요하면 loop).
- fields: start_condition, input_data, output_data, done_criteria, systems, frequency, total_time, headcount 중 답이 있는 것만.
- ownerRole은 역할 답, department는 카드의 부서. owner는 넣지 마세요(실명 금지).
- input/output은 항목 배열입니다. 앞 활동의 output 항목을 다음 활동의 input에 같은 표기로 다시 쓰면 캔버스에서 자동으로 이어집니다.
- [현재 등록된 내용]이 있으면 그것을 바탕으로 답에서 바뀐 부분만 고치고 나머지는 그대로 유지한다.
- 다른 설명 없이 JSON 한 개만:
{"l6":"","ownerRole":"","department":"","fields":{},"actions":[{"seq":1,"label":"","kind":"action","input":[],"output":[],"system":""}],"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"}]}}"""

L5_RELATIONS_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 한 L5 아래 L6 업무들의 흐름(연계 캔버스)을 정하세요.

규칙
- entry.taskId: 가장 먼저 시작되는 L6의 taskId. triggerType은 manual·timer·message·condition.
- edges: src/dst는 taskId. 순차는 kind=seq, 갈림은 kind=branch + gateway=exclusive + condition, 되돌아감은 kind=loop.
- 모든 L6가 최소 한 번은 등장해야 하고, 각 카드의 depends_on과 시작/종료 조건을 존중하세요.
- 다른 설명 없이 JSON 한 개만: {"entry":{"taskId":"","triggerType":"manual","label":""},"edges":[{"src":"","dst":"","kind":"seq"}]}"""

CANVAS_FEEDBACK_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 아래 L5 연계 캔버스(노드·엣지)를 사용자 피드백대로 고치세요.

규칙
- 노드 id와 task_id는 바꾸지 말 것. [L6 카드]에 없는 task_id는 만들지 말 것.
- 새 분기 노드 id는 `__branch__` 접두, node_type은 decision, task_id는 null.
- start/end는 유지(id는 __start__·__end__ 그대로).
- 엣지 label은 갈림·되돌아감의 조건 한 줄(없으면 빈 문자열), gateway는 필요할 때만 exclusive·parallel.
- 이미 있는 엣지의 gateway는 피드백이 바꾸라고 하지 않으면 그대로 다시 적으세요.
- 전면 재구성 요청("처음부터", "전부 다시" 등)이면 흐름을 새로 제안하되 기존 노드 id와 task_id는 그대로 쓰고 좌표는 0으로 둡니다.
- 좌표는 0으로 두어도 됨(서버가 다시 배치).
- 다른 설명 없이 같은 형식의 JSON 한 개만:
{"nodes":[{"id":"__start__","node_type":"start","title":"Start","task_id":null,"pos_x":0,"pos_y":0}],"edges":[{"id":"e1","source_node_id":"__start__","target_node_id":"","label":""}]}"""

ROW_FEEDBACK_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 아래 rows[] 원소를 사용자 피드백대로 고치세요.

규칙
- 키 집합·seq 규칙은 유지: actions의 seq는 1부터 중복 없이, relations.edges의 src/dst는 actions의 seq 정수.
- 피드백이 가리키지 않은 부분은 그대로 두세요.
- owner는 넣지 마세요(실명 금지). input/output은 항목 배열.
- 다른 설명 없이 JSON 한 개만:
{"l6":"","ownerRole":"","department":"","fields":{},"actions":[{"seq":1,"label":"","kind":"action"}],"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"}]}}"""


# ── 빌더 ──

CONTEXT_MAX_CHARS = 40_000  # brief + 첨부 합산 프롬프트 예산(문자)


def build_context_text(brief: str, attachments: list[dict] | None) -> str:
    """사용자 brief + 첨부 파싱 텍스트를 프롬프트용 한 덩어리로. 첨부는 이름 머리말을 붙여 출처를 남긴다."""
    parts = [brief.strip()] if brief and brief.strip() else []
    for item in attachments or []:
        text = str(item.get("text") or "").strip()
        if text:
            parts.append(f"[첨부 {item.get('name', '')}]\n{text}")
    return "\n\n".join(parts)[:CONTEXT_MAX_CHARS]


def format_managed_catalog(entries: list[dict[str, object]], limit: int = 120) -> str:
    """관리 목록({value, aliases}) → '- 값 (별칭: …)' 줄 목록. routers/interviews.py와 같은 표기."""
    lines: list[str] = []
    for entry in entries[:limit]:
        aliases = entry.get("aliases") or []
        alias_text = f" (별칭: {', '.join(str(a) for a in aliases)})" if aliases else ""
        lines.append(f"- {entry.get('value')}{alias_text}")
    return "\n".join(lines)


def _lang_line(lang: str) -> str:
    return "출력 언어: 한국어." if lang == "ko" else "Output language: English."


def _catalog_blocks(role_catalog: str = "", system_catalog: str = "", dept_catalog: str = "") -> str:
    parts: list[str] = []
    if dept_catalog:
        parts.append(f"[부서 후보 목록 - department 값은 이 목록의 항목만 사용]\n{dept_catalog}")
    if role_catalog:
        parts.append(f"[역할 후보 목록 - owner_role/ownerRole은 이 표기를 우선]\n{role_catalog}")
    if system_catalog:
        parts.append(f"[시스템 목록 - system은 이 정식 표기를 우선]\n{system_catalog}")
    return ("\n\n".join(parts) + "\n\n") if parts else ""


def render_existing_row(row: dict) -> str:
    """이미 등록된 L6 행을 프롬프트 블록으로 — 정정은 이 내용을 바탕으로 바뀐 부분만 고친다."""
    lines: list[str] = []
    for action in row.get("actions") or []:
        line = f"{action.get('seq')}. {action.get('label')} ({action.get('kind', 'action')})"
        if action.get("name"):
            line += f" · {action['name']}"
        if action.get("rule"):
            line += f" · 규칙: {action['rule']}"
        for key, label in (("input", "입력"), ("output", "출력")):
            value = action.get(key)
            if value:
                # IO는 배열이 정본(0.5) — 하위호환으로 문자열도 그대로 받아들인다
                text = ", ".join(value) if isinstance(value, list) else str(value)
                line += f" · {label}: {text}"
        if action.get("system"):
            line += f" · 시스템: {action['system']}"
        if action.get("variant") == "exception":  # 역변환이 내는 유일한 variant 값
            line += " · 예외"
        lines.append(line)
    for key, value in (row.get("fields") or {}).items():
        lines.append(f"- {key}: {value}")
    for edge in (row.get("relations") or {}).get("edges") or []:
        condition = f" {edge['condition']}" if edge.get("condition") else ""
        lines.append(f"- {edge.get('src')}→{edge.get('dst')} {edge.get('kind', 'seq')}{condition}")
    return "\n".join(lines)


def _existing_row_block(existing_row: dict | None) -> str:
    return f"\n\n[현재 등록된 내용]\n{render_existing_row(existing_row)}" if existing_row else ""


def build_plan_messages(
    *, lang: str, category_path: str, brief: str, existing_names: list[str],
    existing_maps: list[dict] | None = None,
    role_catalog: str = "", dept_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l5_plan_contract") or L5_PLAN_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, '', dept_catalog)}"
    existing = "\n".join(f"- {n}" for n in existing_names) or "- (없음)"
    # 이미 그려진 맵은 이름만이 아니라 코드·활동까지 보여야 AI가 유지 카드를 코드째로 되돌려준다
    map_lines = []
    for m in existing_maps or []:
        line = f"- {m.get('code')} · {m.get('name')}: {m.get('summary', '')}"
        # 동결 맵은 활동을 싣지 않는다(역변환하지 않았다) — 대신 카드를 만들지 말라고 못 박는다
        map_lines.append(f"{line} {FROZEN_MAP_NOTE}" if m.get("frozen") else
                         f"{line} (활동: {' → '.join(m.get('activities') or [])})")
    maps = "\n".join(map_lines) or "- (없음)"
    user = (
        f"[L5 경로]\n{category_path}\n\n[설명·범위·첨부 요약]\n{brief or '(없음)'}\n\n"
        f"[이미 등록된 L6]\n{existing}\n\n[이미 있는 L6 맵]\n{maps}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_questionnaire_messages(
    *, lang: str, category_path: str, brief: str, card: dict, neighbors: list[dict],
    role_catalog: str = "", system_catalog: str = "", existing_row: dict | None = None,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l6_questionnaire_contract") or L6_QUESTIONNAIRE_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, system_catalog)}"
    neighbor_text = "\n".join(f"- {n.get('name')}: {n.get('summary', '')}" for n in neighbors) or "- (없음)"
    user = (
        f"[L5 경로]\n{category_path}\n\n[L5 설명]\n{brief or '(없음)'}\n\n"
        f"[이 L6]\n이름: {card.get('name')}\n요약: {card.get('summary', '')}\n"
        f"역할: {card.get('owner_role', '')}\n부서: {card.get('department', '')}\n\n"
        f"[이웃 L6(선행/후행)]\n{neighbor_text}{_existing_row_block(existing_row)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _render_answers(questionnaire: dict, answers: dict) -> str:
    lines: list[str] = []
    for q in questionnaire.get("questions") or []:
        qid = str(q.get("id"))
        got = answers.get(qid) or {}
        value = got.get("value")
        labels = {o.get("id"): o.get("label") for o in q.get("options") or []}
        if isinstance(value, list):
            shown = " → ".join(str(labels.get(v, v)) for v in value)
        else:
            shown = str(labels.get(value, value)) if value is not None else ""
        lines.append(f"- ({q.get('maps_to')}) {q.get('text')}: {shown}")
    return "\n".join(lines)


def build_row_messages(
    *, lang: str, card: dict, questionnaire: dict, answers: dict,
    role_catalog: str = "", system_catalog: str = "", existing_row: dict | None = None,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l6_row_drafter_contract") or L6_ROW_DRAFTER_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, system_catalog)}"
    user = (
        f"[L6]\n이름: {card.get('name')}\n요약: {card.get('summary', '')}\n부서: {card.get('department', '')}"
        f"{_existing_row_block(existing_row)}\n\n"
        f"[설문 답]\n{_render_answers(questionnaire, answers)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_relations_messages(
    *, lang: str, plan: list[dict], rows: dict[str, dict],
    overrides: Mapping[str, str] | None = None,
    comment: str = "", previous: dict | None = None,
) -> list[dict]:
    """L6 흐름 제안 프롬프트. comment가 있으면 직전 제안 + 사용자 피드백을 덧붙여 재제안을 받는다."""
    ov = overrides or {}
    contract = ov.get("l5_relations_contract") or L5_RELATIONS_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}"
    lines: list[str] = []
    for card in plan:
        task_id = card.get("task_id")
        row = rows.get(task_id, {}) if task_id else {}
        fields = row.get("fields") or {}
        lines.append(
            f"- taskId={task_id} 이름={card.get('name')} 선행={card.get('depends_on') or []} "
            f"시작조건={fields.get('start_condition', '')} 완료기준={fields.get('done_criteria', '')}"
        )
    user = "[L6 목록]\n" + "\n".join(lines)
    if comment:
        prior = json.dumps(previous, ensure_ascii=False) if previous else "(없음)"
        user += f"\n\n[직전 제안]\n{prior}\n\n[사용자 피드백]\n{comment}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_canvas_feedback_messages(
    *, lang: str, canvas: dict, tasks: list[tuple[str, str]], message: str,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    """캔버스 자연어 수정 프롬프트 — 현재 캔버스 전문을 싣고 피드백대로 고친 같은 형태를 받는다."""
    contract = (overrides or {}).get("l5_canvas_feedback_contract") or CANVAS_FEEDBACK_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}"
    task_lines = "\n".join(f"- {tid}: {name}" for tid, name in tasks)
    user = (
        f"[L6 카드]\n{task_lines}\n\n[현재 캔버스]\n{json.dumps(canvas, ensure_ascii=False)}\n\n"
        f"[사용자 피드백]\n{message}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_row_feedback_messages(
    *, lang: str, row: dict, message: str, overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    """행 자연어 수정 프롬프트 — 현재 행 전문을 싣는다(설문 답이 아니라 행 자체를 고친다)."""
    contract = (overrides or {}).get("l6_row_feedback_contract") or ROW_FEEDBACK_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}"
    user = f"[현재 행]\n{json.dumps(row, ensure_ascii=False)}\n\n[사용자 피드백]\n{message}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
