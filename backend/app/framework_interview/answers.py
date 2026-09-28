"""설문 답 검증·보정 — 객관식은 옵션 id만(single도 복수 허용), 주관식 빈칸은 미답변으로 남긴다 (spec §4, 2026-09-28 개정).

빈 주관식에 제안값을 자동 적용하던 규칙은 폐기 — 안 적은 건 안 적은 것이다(사용자 결정 2026-09-28).
문항별 보충 코멘트(comments)는 그 답에 comment로, 제출 코멘트(note)는 예약 키 NOTE_KEY 아래 {"value": ...}로 같이 저장한다.
"""

CHOICE_KINDS = {"single", "multi", "ordered"}
NOTE_KEY = "_note"  # answers dict의 예약 키 — 문항 id와 겹치지 않게 밑줄로 시작


def _option_ids(question: dict) -> set[str]:
    return {str(o.get("id")) for o in question.get("options") or [] if isinstance(o, dict)}


def _clean_comment(comments: dict | None, qid: str) -> str:
    raw = (comments or {}).get(qid)
    return raw.strip() if isinstance(raw, str) else ""


def fill_answers(
    questionnaire: dict, answers: dict, comments: dict | None = None, note: str = "",
) -> tuple[dict, list[str]]:
    """(filled, missing) — filled[qid]={value, auto, comment?}. missing에 하나라도 있으면 제출 거부."""
    filled: dict = {}
    missing: list[str] = []
    for question in questionnaire.get("questions") or []:
        qid = str(question.get("id"))
        kind = question.get("kind")
        raw = answers.get(qid)
        comment = _clean_comment(comments, qid)
        entry: dict | None = None
        if kind == "text":
            text = raw.strip() if isinstance(raw, str) else ""
            entry = {"value": text, "auto": False}  # 빈칸 = 미답변(제안값 자동 적용 없음)
        elif kind in CHOICE_KINDS:
            allowed = _option_ids(question)
            if kind == "single" and isinstance(raw, str) and raw in allowed:
                entry = {"value": raw, "auto": False}
            elif isinstance(raw, list) and raw and all(isinstance(v, str) and v in allowed for v in raw):
                # single도 배열이면 복수 답으로 받는다 — 현업이 "둘 다"라고 답하고 싶을 때
                entry = {"value": list(raw), "auto": False}
            else:
                missing.append(qid)
        if entry is None:
            continue
        if comment:
            entry["comment"] = comment
        filled[qid] = entry
    cleaned_note = note.strip() if isinstance(note, str) else ""
    if cleaned_note:
        filled[NOTE_KEY] = {"value": cleaned_note}
    return filled, missing
