"""비교 화면 AI 보고서 프롬프트 — 프론트가 계산한 버전 diff를 결재자에게 올리는 개조식 보고서 JSON으로 (2026-09-21).

2026-09-18의 대시보드식 요약(총평·하이라이트 칩)을 2026-09-20 보고체로, 2026-09-21 "AI가 잘하는 일"
4블록으로 재편: 의도별 요지 · 전체 흐름 기준 영향 · 제출 코멘트 대비 미언급 변경 · 결재 전 확인 질문.
사실 나열(변경 목록)은 비교 화면 왼쪽 패널이 이미 보여주므로 보고서에서 뺀다. 재료로 무변경 이웃 노드·엣지,
파라미터 합계 before/after, 입출력 변경과 소비처를 받는다. 같은 재료로 제출 시 변경 사유 초안도 쓴다.
"""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass

from app.schemas import CompareDiffPayload

# 기본 계약 — sysadmin이 ai_prompts(compare_summary_contract)로 오버라이드 가능
_CONTRACT = """당신은 BPM 프로세스맵 변경 보고서를 작성합니다. 게시본(base)과 승인 대기본(target)의 차이를
결재자가 읽는 개조식 업무 보고서로 씁니다. 변경 목록은 결재자가 화면에서 이미 보고 있으니 나열하지 말고,
시스템이 계산할 수 없는 것 — 개정 의도, 흐름·통제에 미치는 영향, 제출 코멘트가 말하지 않은 변경, 결재 전에
제출자에게 되물을 질문 — 을 쓰세요. 반드시 JSON 한 개만 반환하세요(설명 텍스트·코드펜스 금지).

[입력]
- map / base / target: 맵 이름과 오너 부서, 비교 대상 버전 라벨.
- submitted_by / submit_note: 제출자와 제출 시 적은 변경 사유. 없으면 submit_note 줄이 없습니다.
- nodes: 활동(노드). status가 added/removed/changed면 변경, unchanged면 흐름 문맥용 이웃(변경 노드의 상하류).
  changed는 바뀐 필드의 before→after 값을 담습니다. 추가된 활동에는 desc·role·dept·system이 붙을 수 있습니다.
- edges: 흐름(연결). unchanged 엣지는 문맥입니다. source/target은 활동 제목입니다.
- metrics: **버전 전체** 파라미터 합계 before→after(시스템이 계산한 사실). 특정 활동의 값이 아니므로 "총 소요시간 3시간 → 4시간 30분"처럼 전체 합계로만 쓰고, 활동 하나의 변화는 그 노드의 changes에서 읽으세요.
- io: 입출력 항목 변경. output removed의 peers는 그 산출물을 입력으로 쓰는 하위 활동(끊김 후보), input의 peers는 산출처.
- ref: 각 항목의 인용 키(n1, e2 …). 근거로 삼은 항목의 ref를 refs에 그대로 적으세요(지어내지 말 것). metrics·io에는 ref가 없으니 합계만 근거인 항목은 refs를 빈 배열로.
- 비용은 cost_krw(원)와 cost_usd(달러) 중 하나만 씁니다 — 한쪽이 비고 다른 쪽이 생기면 "0원으로 변경"이 아니라 통화 전환(예: "회당 비용 50,000원 → 35달러(통화 전환)").
- totals: 전체 개수. 상한 초과로 생략된 항목 수는 "(외 N건 생략)"으로 표시됩니다.

[출력]
{"title": <보고 제목 한 줄. 예: "발주 프로세스 v3 변경 보고">,
 "opening": <개정 배경·목적 한 줄(명사형). 제출 코멘트가 있으면 그 사유를 근거로>,
 "sections": [{"heading": <개정 의도(명사형). 예: "출고 전 품질 통제 강화">, "points": [{"point": <그 의도를 이루는 변경 한 줄(명사형)>, "kind": <종류>}...], "refs": [<ref>...]}],
 "impacts": [{"point": <흐름·통제·부담 영향 한 줄(명사형)>, "kind": <종류>, "refs": [<ref>...]}],
 "unmentioned": [{"point": <제출 코멘트에 언급되지 않은 실질 변경 한 줄>, "kind": <종류>, "refs": [<ref>...]}],
 "questions": [<결재 전 제출자에게 확인할 질문 한 줄>...],
 "closing": <마무리 한 줄(명사형). 예: "검토 후 결재 요청">}

[kind — 항목 종류 태그. 화면이 아이콘·색으로 그리므로 항목마다 반드시 하나]
- added=활동·흐름 신설, removed=삭제, changed=담당·부서·시스템·설명·조건 등 속성 변경, increase=수치 증가(소요시간·비용·인원·건수·FTE), decrease=수치 감소,
  flow=흐름·경로·순서 변경(재배선·분기), control=통제·검토·승인 단계에 관한 영향(공백·강화), risk=끊김·누락·근거 없는 변경 같은 주의, note=그 외.
- 수치 항목은 방향에 맞춰 increase/decrease를 쓰고, 통화 전환처럼 방향이 없으면 changed.

[블록별 규칙]
- sections(개정 요지)는 **변경 종류(신설/삭제/변경)가 아니라 업무 의도**로 묶습니다. "검토 단계 신설 + 그리로 이어지는 흐름 + 담당 부서 이관"이 한 목적이면 한 절. 최대 3절. 목적을 알 수 없으면 가장 그럴듯한 해석을 쓰되 단정하지 말 것("~로 추정").
- impacts(흐름·통제 영향)는 unchanged 문맥·metrics·io를 근거로 씁니다. 예: "결제 처리 뒤 승인 단계 삭제로 통제 공백", "신설 단계가 주 경로에 삽입되어 총 소요시간 3시간 → 4시간 30분", "'발주서' 산출물 삭제, QA 검토가 입력으로 사용 중(끊김)". 최대 4개. 근거 없는 추측 금지.
- unmentioned(미언급 변경)는 submit_note가 있을 때만 씁니다 — 코멘트가 다루지 않은 실질 변경(담당·부서·시스템 이관, 수치 변경, 단계 삭제 등)을 적고, 코멘트가 모든 변경을 다루면 빈 배열. submit_note가 없으면 빈 배열.
- questions(확인 질문)는 결재자가 제출자에게 되물을 것 2~3개. 삭제된 단계의 예외 처리, 신설 단계의 담당·시스템 공백, 수치 변경의 근거처럼 diff에서 답이 안 보이는 것만. 물음표로 끝냅니다.
- refs에는 그 항목이 근거로 삼은 ref만. 문맥 노드(unchanged)도 인용 가능.

[문체 — 개조식]
- 모든 문자열은 명사형 종결("~ 신설", "~ 삭제", "~로 변경", "~ 검토 필요", "~ 요청"). "~되었습니다"·"~합니다" 같은 서술형 문장 금지(questions만 물음표 문장).
- 한 항목 한 줄, 30자 안팎. 관형절을 길게 늘이지 말고 항목을 나누기.
- 1인칭·화자 없음(제출자를 화자로 쓰지 말 것). 이모지·머리기호·마크다운·긴 대시(—) 금지. 구분은 쉼표·가운뎃점·괄호로.
- 수치는 방향과 크기를 짧게 병기(예: "소요시간 1시간 → 2시간 30분", "연간 건수 120 → 200건").
- duration 값은 H.MM 표기(소수부 2자리가 분)이므로 반드시 시·분으로 풀어 쓸 것: 1.30은 "1시간 30분", 0.50은 "50분", 2.00은 "2시간"(원문 "1.30 → 0.50" 그대로 옮기지 말 것). cost_krw/usd=회당 비용, headcount=회당 인원, annual_count=연간 건수, fte=FTE.
- 추가된 활동은 괄호로 담당·부서·시스템 병기 가능(예: "QA 검토 단계 신설(품질팀·LIMS)").
- 변경이 없으면 title에 "변경 없음", opening에 "두 버전 동일", 나머지 배열은 빈 배열, closing은 빈 문자열.
"""

# 제출 시 변경 사유 초안 계약 — sysadmin이 ai_prompts(submit_note_contract)로 오버라이드 가능
_SUBMIT_NOTE_CONTRACT = """당신은 BPM 프로세스맵 개정안을 제출하는 실무자의 변경 사유 초안을 씁니다. 최신 게시본(base)과
제출할 초안(target)의 차이를 보고, 결재자가 한눈에 "무엇을 왜 바꿨는지" 알 수 있는 코멘트를 씁니다.
제출자가 읽고 고쳐 올릴 초안이므로 사실만 담고, 목적은 diff에서 읽히는 범위에서만 씁니다.
반드시 JSON 한 개만 반환하세요(설명 텍스트·코드펜스 금지).

[입력] 비교 보고서와 같은 형식 — nodes(added/removed/changed/unchanged)·edges·metrics·io·totals. base가 "(없음)"이면 첫 제출(전체 신규).

[출력]
{"note": <개조식 변경 사유. 2~4줄, 줄바꿈(\\n)으로 구분, 전체 300자 이내>}

[규칙]
- 첫 줄은 개정 목적 한 줄(명사형). 이어서 핵심 변경 1~3줄(무엇을 어떻게 — 담당·부서·시스템·수치 변화 포함).
- 명사형 종결("~ 신설", "~로 변경", "~ 삭제"). "~함"·"~높임" 같은 용언 명사형이 아니라 체언으로 끝낼 것. 서술형 문장·1인칭·이모지·머리기호·마크다운·긴 대시(—) 금지.
- 활동 이름은 따옴표 없이 쓰고, 여러 활동은 "재고 예약·배송 준비 단계 신설"처럼 가운뎃점으로 묶기.
- duration 값은 H.MM 표기(소수부 2자리가 분)이므로 시·분으로 풀어 쓸 것(1.30 → "1시간 30분").
- 변경 목록을 전부 나열하지 말 것 — 결재자가 알아야 할 것만. 변경이 없으면 note는 "변경 없음".
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
    base_label: str  # 빈값 = 게시본 없음(첫 제출)
    target_label: str
    submitted_by: str = ""  # 표시 이름(없으면 빈값)
    submit_note: str = ""  # 제출 코멘트(VersionEvent.note, submitted)


def resolve_contract(overrides: Mapping[str, str] | None, key: str = "compare_summary_contract") -> str:
    default = _SUBMIT_NOTE_CONTRACT if key == "submit_note_contract" else _CONTRACT
    return (overrides or {}).get(key) or default


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
    if diff.metrics:
        lines.append("metrics (version totals, base -> target):")
        for metric in diff.metrics:
            lines.append(f"- {metric.field}: {metric.base or '-'} -> {metric.target or '-'}")
    if diff.io_changes:
        lines.append("io (input/output item changes; peers = consumers of an output / producers of an input):")
        for change in diff.io_changes:
            peers = f" | peers: {', '.join(change.peers)}" if change.peers else ""
            lines.append(f"- [{change.ref}] {change.side} {change.status} {change.text!r}{peers}")
    return "\n".join(lines)


def _serialize_context(context: CompareSummaryContext) -> str:
    lines = [
        f"map: {context.map_name}" + (f" (owning department: {context.owning_department})" if context.owning_department else ""),
        f"base: {context.base_label or '(없음: 첫 제출, 전체 신규)'}",
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


def build_submit_note_messages(
    diff: CompareDiffPayload,
    *,
    context: CompareSummaryContext,
    lang: str,
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    contract = resolve_contract(overrides, "submit_note_contract")
    system = f"{contract}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}"
    user = f"{_serialize_context(context)}\n\n{_serialize_diff(diff)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
