"""비교 화면 AI 보고서 프롬프트 — 프론트가 계산한 버전 diff를 결재자에게 올리는 보고체 서술 JSON으로 (2026-09-20).

2026-09-18의 대시보드식 요약(총평·하이라이트 칩)을 사람이 상급자에게 보고하는 문서 형식으로 전환.
맵·제출 맥락(제출 코멘트)과 추가 노드의 담당/부서/시스템을 재료로 넣어 "왜·무엇을·누가"를 서술한다.
"""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass

from app.schemas import CompareDiffPayload

# 기본 계약 — sysadmin이 ai_prompts(compare_summary_contract)로 오버라이드 가능
_CONTRACT = """당신은 BPM 프로세스맵 변경 보고서를 작성합니다. 게시본(base)과 승인 대기본(target)의 차이를
결재자가 읽는 개조식 업무 보고서로 씁니다. 실무자가 상급자에게 올리는 보고서처럼 핵심만 명사형으로 끊어
적으세요(서술형 문장 금지). 반드시 JSON 한 개만 반환하세요(설명 텍스트·코드펜스 금지).

[입력]
- map / base / target: 맵 이름과 오너 부서, 비교 대상 버전 라벨.
- submitted_by / submit_note: 제출자와 제출 시 적은 변경 사유. 사유가 있으면 배경(opening)의 근거로 삼되 그대로 베끼지 말 것.
- nodes: 추가/삭제/변경된 활동(노드). changed는 바뀐 필드의 before→after 값을 담습니다.
  추가된 활동에는 desc(설명)·role(담당 역할)·dept(부서)·system이 붙을 수 있습니다 — "무엇을 누가 어디서 하는 단계"인지 서술에 활용.
- edges: 추가/삭제/라벨변경된 흐름(연결). source/target은 활동 제목입니다.
- ref: 각 항목의 인용 키(n1, e2 …). 절이 근거로 삼은 항목의 ref를 refs에 그대로 적으세요(지어내지 말 것).
- totals: 전체 개수. 상한 초과로 생략된 항목 수는 "(외 N건 생략)"으로 표시됩니다.

[출력]
{"title": <보고 제목 한 줄. 예: "발주 프로세스 v3 변경 보고">,
 "opening": <개정 배경·목적 한 줄(명사형). 예: "감사 지적 대응을 위한 검토 단계 추가 개정">,
 "sections": [{"heading": <소제목(명사형)>, "points": [<항목 1~4개. 각각 명사형 종결 한 줄 — 무엇이 어떻게 바뀌었는지>], "refs": [<ref>...]}],
 "impacts": [<업무 영향·주의점 한 줄(명사형)>...],
 "closing": <마무리 한 줄(명사형). 예: "검토 후 결재 요청">}

[문체 — 개조식]
- 모든 문자열은 명사형 종결("~ 신설", "~ 삭제", "~로 변경", "~ 검토 필요", "~ 요청"). "~되었습니다"·"~합니다" 같은 서술형 문장 금지.
- 한 항목 한 줄, 25자 안팎. 관형절을 길게 늘이지 말고 항목을 나누기.
- 1인칭·화자 없음(제출자를 화자로 쓰지 말 것). 이모지·머리기호·마크다운 금지.
- 수치는 방향과 크기를 짧게 병기(예: "소요시간 1시간 → 2시간 30분", "연간 건수 120 → 200건").
- duration 값은 H.MM 표기(소수부 2자리가 분)이므로 반드시 시·분으로 풀어 쓸 것 — 1.30은 "1시간 30분", 0.50은 "50분", 2.00은 "2시간"(원문 "1.30 → 0.50" 그대로 옮기지 말 것). cost_krw/usd=회당 비용, headcount=회당 인원, annual_count=연간 건수, fte=FTE.
- 추가된 활동은 괄호로 담당·부서·시스템 병기 가능(예: "QA 검토 단계 신설(품질팀·LIMS)").

[규칙]
- sections는 중요도 순 최대 5개. 관련 변경은 한 절로 묶으세요(단계 신설 + 그 단계로 이어지는 흐름 추가 → 한 절).
- impacts는 최대 4개. 통제·검토 단계 삭제, GMP 관련 변경, 시스템·부서 이관, 리드타임·비용 증감 같은 실질 영향만. 근거 없는 추측 금지.
- 변경이 없으면 title에 "변경 없음", opening에 "두 버전 동일", sections·impacts는 빈 배열, closing은 빈 문자열.
"""

_LANG_LINE = {
    "ko": "출력 언어: 한국어(명사형 종결 유지).",
    "en": "Output language: English. Write every string value in English as terse noun-phrase bullet items (no full sentences), like a formal executive memo.",
}


@dataclass(frozen=True)
class CompareSummaryContext:
    """보고서 맥락 — 서버가 맵·버전 행에서 채운다(프론트 diff엔 없음)."""

    map_name: str
    owning_department: str
    base_label: str
    target_label: str
    submitted_by: str = ""  # 표시 이름(없으면 빈값)
    submit_note: str = ""  # 제출 코멘트(VersionEvent.note, submitted)


def resolve_contract(overrides: Mapping[str, str] | None) -> str:
    return (overrides or {}).get("compare_summary_contract") or _CONTRACT


def compute_diff_hash(diff: CompareDiffPayload, lang: str, contract: str) -> str:
    """캐시 키 — diff 내용 + 언어 + 유효 프롬프트 계약. 셋 중 하나라도 바뀌면 재생성."""
    canonical = json.dumps(diff.model_dump(), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256()
    for part in (canonical, lang, contract):
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _serialize_diff(diff: CompareDiffPayload) -> str:
    """모델이 읽기 쉬운 라인 형식 — JSON 원문보다 토큰이 적고 ref가 눈에 띈다."""
    lines: list[str] = []
    totals = diff.totals
    lines.append(
        "totals: nodes +%d -%d ~%d, edges +%d -%d ~%d"
        % (
            totals.nodes_added,
            totals.nodes_removed,
            totals.nodes_changed,
            totals.edges_added,
            totals.edges_removed,
            totals.edges_changed,
        )
    )
    lines.append("nodes:")
    for node in diff.nodes:
        head = f"- [{node.ref}] {node.status} {node.node_type or 'process'} \"{node.title}\""
        if node.changes:
            fields = "; ".join(f"{c.field}: {c.before!r} -> {c.after!r}" for c in node.changes)
            head = f"{head} | {fields}"
        attrs = [
            f"{label}: {value!r}"
            for label, value in (
                ("desc", node.description),
                ("role", node.assignee_role),
                ("dept", node.department),
                ("system", node.system),
            )
            if value
        ]
        if attrs:
            head = f"{head} | {'; '.join(attrs)}"
        lines.append(head)
    if diff.omitted_nodes:
        lines.append(f"- (외 {diff.omitted_nodes}건 생략)")
    lines.append("edges:")
    for edge in diff.edges:
        head = f"- [{edge.ref}] {edge.status} \"{edge.source}\" -> \"{edge.target}\""
        if edge.status == "changed":
            head = f"{head} | label: {edge.label_before!r} -> {edge.label!r}"
        elif edge.label:
            head = f"{head} | label: {edge.label!r}"
        lines.append(head)
    if diff.omitted_edges:
        lines.append(f"- (외 {diff.omitted_edges}건 생략)")
    return "\n".join(lines)


def _serialize_context(context: CompareSummaryContext) -> str:
    lines = [
        f"map: {context.map_name}" + (f" (owning department: {context.owning_department})" if context.owning_department else ""),
        f"base: {context.base_label}",
        f"target: {context.target_label}",
    ]
    if context.submitted_by:
        lines.append(f"submitted_by: {context.submitted_by}")
    if context.submit_note:
        lines.append(f"submit_note: {context.submit_note!r}")
    return "\n".join(lines)


def build_compare_summary_messages(
    diff: CompareDiffPayload,
    *,
    context: CompareSummaryContext,
    lang: str,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    contract = resolve_contract(overrides)
    system = f"{contract}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}"
    user = f"{_serialize_context(context)}\n\n{_serialize_diff(diff)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
