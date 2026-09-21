"""설문 답 검증·보정 — 객관식은 옵션 id만, 주관식 빈칸은 제안값으로 채우고 auto 표시 (spec §4)."""

CHOICE_KINDS = {"single", "multi", "ordered"}


def _option_ids(question: dict) -> set[str]:
    return {str(o.get("id")) for o in question.get("options") or [] if isinstance(o, dict)}


def fill_answers(questionnaire: dict, answers: dict) -> tuple[dict, list[str]]:
    """(filled, missing) — filled[qid]={value, auto}. missing에 하나라도 있으면 제출 거부."""
    filled: dict = {}
    missing: list[str] = []
    for question in questionnaire.get("questions") or []:
        qid = str(question.get("id"))
        kind = question.get("kind")
        raw = answers.get(qid)
        if kind == "text":
            text = raw.strip() if isinstance(raw, str) else ""
            if text:
                filled[qid] = {"value": text, "auto": False}
            else:
                filled[qid] = {"value": str(question.get("suggested") or ""), "auto": True}
            continue
        if kind not in CHOICE_KINDS:
            continue
        allowed = _option_ids(question)
        if kind == "single":
            if isinstance(raw, str) and raw in allowed:
                filled[qid] = {"value": raw, "auto": False}
            else:
                missing.append(qid)
            continue
        if isinstance(raw, list) and raw and all(isinstance(v, str) and v in allowed for v in raw):
            filled[qid] = {"value": list(raw), "auto": False}
        else:
            missing.append(qid)
    return filled, missing
