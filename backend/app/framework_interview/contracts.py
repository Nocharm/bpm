"""AI L5 캠페인 프롬프트 계약 4종 + 응답 스키마 + 메시지 빌더 (spec 2026-09-21 §4·§5).

계약 문구는 prompt_registry 오버라이드로 교체 가능. 출력은 전부 JSON 한 개.
키 이름은 인터뷰 JSON 0.4/0.5 계약(scripts/consultant_interview.py)과 같다 — 어댑터가 바뀌면 여기도 같이.
"""

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


class PlanOut(BaseModel):
    cards: list[PlanCard] = Field(min_length=1, max_length=40)


class QuestionOption(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=200)


QuestionKind = Literal["single", "multi", "text", "ordered"]
MapsTo = Literal["activities", "branches", "roles", "systems", "io", "conditions", "params"]


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: QuestionKind
    maps_to: MapsTo
    text: str = Field(min_length=1, max_length=600)
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
    input: str | None = None
    output: str | None = None
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


# ── 계약 문구 (관리자 오버라이드 가능) ──

L5_PLAN_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 주어진 L5 업무(카테고리 경로)와 설명을 읽고,
그 아래에 등록할 L6 단위 업무(각각 하나의 프로세스 맵) 목록을 제안하세요.

규칙
- 3개 이상 12개 이하. 이미 등록된 L6 이름과 겹치지 않게.
- name: 동사형 업무명 20자 이내. summary: 한 문장. owner_role: 역할 후보 목록의 표기 우선.
- department: 아는 경우 부서명, 모르면 빈 문자열.
- depends_on: 선행해야 하는 다른 카드의 name 목록(없으면 빈 배열).
- 다른 설명 없이 JSON 한 개만: {"cards":[{"name":"","summary":"","owner_role":"","department":"","depends_on":[]}]}"""

L6_QUESTIONNAIRE_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. L6 업무 하나의 흐름을 그리기 위한 설문지를 만드세요.
답하는 사람은 바쁜 현업입니다. 객관식 위주로, 제안 답을 미리 골라 두세요.

규칙
- 문항 6개 이상 12개 이하. id는 q1, q2 순서.
- kind: single(하나)·multi(여러 개)·ordered(순서 있는 여러 개)·text(주관식). text는 최대 3개.
- maps_to: activities·branches·roles·systems·io·conditions·params 중 하나.
- 반드시 kind=ordered, maps_to=activities 문항 1개: 활동 후보 5개 이상 12개 이하, suggested에 제안 순서 전부.
- 역할 문항의 options는 역할 후보 목록 표기를, 시스템 문항은 시스템 목록 표기를 우선.
- text 문항의 suggested는 그대로 답으로 써도 되는 완성 문장.
- 다른 설명 없이 JSON 한 개만:
{"questions":[{"id":"q1","kind":"ordered","maps_to":"activities","text":"","options":[{"id":"a1","label":""}],"suggested":["a1"]}]}"""

L6_ROW_DRAFTER_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 설문 답을 바탕으로 L6 업무 하나의 흐름을 인터뷰 JSON rows[] 원소로 작성하세요.

규칙
- actions: 활동 문항의 선택 순서를 seq 1부터. label은 동사형 20자 이내, kind는 action·handoff·decision.
- 분기 답이 있으면 판단 activity에 kind=decision을 주고 relations.edges에 kind=branch, gateway=exclusive, condition을 적으세요.
- relations.edges의 src/dst는 actions의 seq 정수. 모든 activity가 이어지게(seq 흐름 + 분기 + 필요하면 loop).
- fields: start_condition, input_data, output_data, done_criteria, systems, frequency, total_time, headcount 중 답이 있는 것만.
- ownerRole은 역할 답, department는 카드의 부서. owner는 넣지 마세요(실명 금지).
- 다른 설명 없이 JSON 한 개만:
{"l6":"","ownerRole":"","department":"","fields":{},"actions":[{"seq":1,"label":"","kind":"action","input":"","output":"","system":""}],"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"}]}}"""

L5_RELATIONS_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 한 L5 아래 L6 업무들의 흐름(연계 캔버스)을 정하세요.

규칙
- entry.taskId: 가장 먼저 시작되는 L6의 taskId. triggerType은 manual·timer·message·condition.
- edges: src/dst는 taskId. 순차는 kind=seq, 갈림은 kind=branch + gateway=exclusive + condition, 되돌아감은 kind=loop.
- 모든 L6가 최소 한 번은 등장해야 하고, 각 카드의 depends_on과 시작/종료 조건을 존중하세요.
- 다른 설명 없이 JSON 한 개만: {"entry":{"taskId":"","triggerType":"manual","label":""},"edges":[{"src":"","dst":"","kind":"seq"}]}"""


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


def build_plan_messages(
    *, lang: str, category_path: str, brief: str, existing_names: list[str],
    role_catalog: str = "", dept_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l5_plan_contract") or L5_PLAN_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, '', dept_catalog)}"
    existing = "\n".join(f"- {n}" for n in existing_names) or "- (없음)"
    user = f"[L5 경로]\n{category_path}\n\n[설명·범위·첨부 요약]\n{brief or '(없음)'}\n\n[이미 등록된 L6]\n{existing}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_questionnaire_messages(
    *, lang: str, category_path: str, brief: str, card: dict, neighbors: list[dict],
    role_catalog: str = "", system_catalog: str = "",
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
        f"[이웃 L6(선행/후행)]\n{neighbor_text}"
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
    role_catalog: str = "", system_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l6_row_drafter_contract") or L6_ROW_DRAFTER_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, system_catalog)}"
    user = (
        f"[L6]\n이름: {card.get('name')}\n요약: {card.get('summary', '')}\n부서: {card.get('department', '')}\n\n"
        f"[설문 답]\n{_render_answers(questionnaire, answers)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_relations_messages(
    *, lang: str, plan: list[dict], rows: dict[str, dict],
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
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
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
