"""역할 에이전트 — 인터뷰어·드래프터·톤 검수자의 프롬프트 빌더와 출력 계약 (design 2026-07-23 §4).

프롬프트는 고정 프리픽스(역할·표준) → 문서 발췌 → facts → 히스토리 순으로 조립해
vLLM prefix cache 적중을 유도한다. AI 호출 자체는 orchestrator가 수행.
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from app.interview.engine import get_stage


def extract_json(text: str) -> str:
    """모델이 ```json 펜스나 앞뒤 설명을 붙여도 본문 JSON만 추출 — ai.py _extract_json과 동일 계약."""
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


class InterviewerOut(BaseModel):
    """인터뷰어 응답 — 다음 질문/확인과 facts 갱신 + 명확화 보기(quick reply)."""

    message: str
    facts_patch: dict[str, Any] = Field(default_factory=dict)
    stage_complete: bool = False
    needs_choices: bool = False
    # 명확화 질문의 보기 2~4개 — 프론트가 클릭형 칩으로 노출. 서술형 질문이면 빈 배열
    options: list[str] = Field(default_factory=list)


class ToneRename(BaseModel):
    key: str
    title: str = Field(max_length=200)


class ToneReviewOut(BaseModel):
    """톤 검수자 응답 — 명명·세분도 표준화 개명 제안."""

    message: str = ""
    renames: list[ToneRename] = Field(default_factory=list)


# 선택지 병렬 생성용 변형 힌트 — i번째 안이 i번째 힌트를 사용 (스펙 §3 구조 결정 지점 2곳)
CHOICE_VARIANT_HINTS: dict[str, list[str]] = {
    "activities": [
        "표준 세분도 — 핵심 활동 6±3개, '명사+동사' 명명, 담당 조직 단위로 묶기",
        "세밀 분해 — 검증·승인·기록 단계까지 명시, 활동 8~12개",
        "간결 요약 — 핵심 가치 활동만 4~6개, 세부는 설명(description)으로",
    ],
    "branches": [
        "표준 분기 — 핵심 디시전만 마름모로, 예외는 설명에 기록",
        "예외 명시 — 반려/보류/재작업 루프를 엣지로 모두 표현",
        "해피패스 우선 — 분기 최소화, 예외는 별도 노드 없이 라벨로",
    ],
}

_LANG_LINE = {
    "ko": "모든 message와 질문은 한국어로 작성하세요.",
    "en": "Write all messages and questions in English.",
}

_INTERVIEWER_CONTRACT = """당신은 프로세스 컨설턴트입니다. 현업 담당자를 인터뷰해 프로세스 맵을 함께 만듭니다.
조직 표준: 노드 제목은 '명사+동사'(예: '요청서 작성'), 활동 6±3개 세분도, 한 질문에 한 주제만.

반드시 아래 JSON 하나만 반환:
{"message": <사용자에게 보일 제안 또는 질문>,
 "facts_patch": {<이번 답변에서 확정된 현재 스테이지 facts 키:값>},
 "stage_complete": <현재 스테이지 필수 항목이 모두 확정되면 true>,
 "needs_choices": <구조 대안을 시각적으로 제시하는 게 나으면 true — 활동/분기 스테이지에서만>,
 "options": [<질문에 대한 예상 답 보기 2~4개 — 사용자가 클릭으로 답할 수 있게. 서술형 질문이면 빈 배열>]}

행동 원칙 — 컨설턴트는 리드한다:
1. **제안 우선**: [참고 문서]가 있으면 백지 질문을 던지지 말고, 문서에서 답을 먼저 추론해 "~로 이해했습니다. 맞나요?" 형태의 구체 제안으로 확인만 받으세요.
2. **되물음에는 즉답**: 사용자가 "너가 생각해봐/제안해줘/정리해줘"처럼 제안을 요청하면 반드시 당신의 구체안을 제시하세요. 같은 질문을 사용자에게 되돌려 묻는 것은 금지.
3. **문서 요청 수행**: 사용자가 문서 요약·설명을 요청하면 message에 핵심 요약을 담아 답한 뒤 자연스럽게 현재 스테이지로 연결하세요. "할 수 없다"는 답변 금지.
4. **반복 금지**: 직전 컨설턴트 메시지와 같은 문장을 다시 보내지 마세요. 사용자가 답을 미루면 관점을 바꿔 제안하세요.
5. stage_complete=true일 때 message에는 다음 주제로 넘어가는 첫 제안/질문을 포함하세요.
6. facts_patch 값은 문자열 또는 문자열 배열만. 사용자가 당신의 제안에 동의하면 그 내용을 facts_patch로 확정하세요.
7. message는 반드시 마크다운으로 구조화하세요 — 형식: 도입 한 문장 → 제안 내용은 `- ` 불릿 목록(핵심어 **굵게**) → 마지막 줄에 확인 질문 하나. 예:
   "문서에서 다음 활동들을 확인했습니다.\\n- **요청서 작성** — 구매 요청 접수\\n- **견적 비교** — 3사 견적 취합\\n\\n이대로 진행할까요?"
8. 확인형·선택형 질문에는 options에 보기 2~4개를 함께 주세요(예: ["네, 맞습니다", "수정이 필요합니다"] 또는 후보 값들). 서술형 답이 필요한 질문이면 빈 배열."""

_DRAFTER_CONTRACT = """당신은 프로세스 맵 드래프터입니다. 확정된 facts로 순서도 그래프를 생성합니다.
반드시 아래 JSON 하나만 반환 (kind는 항상 "graph"):
{"kind": "graph", "message": <이 안의 특징 한 줄>,
 "nodes": [{"key": <임시키>, "title": <제목>, "node_type": "start|process|decision|end",
            "description": <설명>, "attributes": {"assignee": …, "department": …, "system": …,
            "duration": …, "cost_krw": …, "headcount": …, "annual_count": …, "fte": …} 또는 생략,
            "group_key": <그룹키 또는 생략>}],
 "edges": [{"source": <키>, "target": <키>, "label": <분기 라벨 또는 "">}],
 "groups": [{"key": <키>, "label": <레인/묶음 이름>}]}

규칙:
1. start 1개로 시작, end 1개 이상으로 끝나는 연결 그래프.
2. 좌표는 넣지 마세요(자동 배치). 노드 제목은 '명사+동사'.
3. 분기는 node_type="decision" + 나가는 엣지에 라벨."""

_TONE_CONTRACT = """당신은 프로세스 맵 톤 검수자입니다. 노드 명명·세분도가 조직 표준('명사+동사', 활동 6±3개, 존댓말 금지)에 맞는지 검토합니다.
반드시 아래 JSON 하나만 반환:
{"message": <검수 요약 한 줄>, "renames": [{"key": <노드 키>, "title": <표준화된 새 제목>}]}
규칙: key는 [검수 대상 그래프]에 실제로 존재하는 노드 키만. 실제 표준 위반만 개명하고, 이미 표준에 맞으면 renames는 빈 배열. start/end 노드 제목은 검수 대상이 아님."""


def _facts_block(facts: dict) -> str:
    return json.dumps(facts, ensure_ascii=False)


def build_interviewer_messages(
    stage_key: str,
    lang: str,
    facts: dict,
    graph_summary: str,
    context_text: str,
    history: list[dict],
    user_input: str,
) -> list[dict]:
    stage = get_stage(stage_key)
    goal = stage.goal_ko if lang == "ko" else stage.goal_en
    system = (
        f"{_INTERVIEWER_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[참고 문서]\n{context_text or '(없음)'}\n\n"
        f"[현재 스테이지] {stage.key} — {goal}\n"
        f"[누적 facts]\n{_facts_block(facts)}\n\n"
        f"[현재 작업본 요약]\n{graph_summary or '(빈 캔버스)'}"
    )
    return [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": user_input},
    ]


def build_drafter_messages(
    stage_key: str,
    lang: str,
    facts: dict,
    working_graph: dict | None,
    context_text: str,
    variant_hint: str,
) -> list[dict]:
    current = json.dumps(working_graph, ensure_ascii=False) if working_graph else "(없음)"
    system = (
        f"{_DRAFTER_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[참고 문서]\n{context_text or '(없음)'}\n\n"
        f"[확정 facts]\n{_facts_block(facts)}\n\n"
        f"[현재 작업본]\n{current}\n\n"
        f"[이 안의 방향] {variant_hint}"
    )
    user = "위 facts와 방향에 맞는 전체 그래프를 생성하세요."
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_tone_messages(lang: str, working_graph: dict) -> list[dict]:
    system = (
        f"{_TONE_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[검수 대상 그래프]\n{json.dumps(working_graph, ensure_ascii=False)}"
    )
    user = "위 그래프를 검토하고 표준에 맞는 개명을 제안하세요."
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
