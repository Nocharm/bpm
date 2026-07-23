"""인터뷰 스테이지 상태머신 — 고정 7단계 정의·전이·완료 판정 (design 2026-07-23 §3)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class StageDef:
    key: str
    title: str  # UI 크롬 표시(영어)
    goal_ko: str  # 인터뷰어 프롬프트 브리프
    goal_en: str
    # 이 스테이지가 채워야 하는 facts 키 — 전부 truthy면 완료(적응 스킵 판정에도 사용)
    required_facts: tuple[str, ...]
    # 구조 결정 지점 — 드래프터 선택지 병렬 생성 허용 (스펙 §3: ③활동·④분기 2곳)
    choice_stage: bool = False


STAGES: tuple[StageDef, ...] = (
    StageDef(
        "scope", "Scope",
        "프로세스의 이름·목적·시작과 끝 경계를 확정한다",
        "Confirm the process name, purpose, and start/end boundaries",
        ("process_name", "purpose", "boundaries"),
    ),
    StageDef(
        "io", "Inputs & Outputs",
        "프로세스를 촉발하는 트리거, 투입물(인풋), 산출물(아웃풋)을 확정한다",
        "Confirm the trigger, inputs, and outputs",
        ("trigger", "inputs", "outputs"),
    ),
    StageDef(
        "activities", "Activities",
        "주요 활동을 순서대로 나열한다 — 세분도(활동 6±3개)가 핵심 결정",
        "List the main activities in order — granularity is the key decision",
        ("activities",),
        choice_stage=True,
    ),
    StageDef(
        "branches", "Branches & Exceptions",
        "분기(디시전)와 예외 흐름을 확정한다",
        "Confirm decision branches and exception flows",
        ("branches",),
        choice_stage=True,
    ),
    StageDef(
        "roles", "Roles & Systems",
        "각 활동의 담당자/부서와 사용 시스템을 채운다",
        "Fill in assignee/department and systems for each activity",
        ("roles",),
    ),
    StageDef(
        "params", "Parameters",
        "파라미터 체계를 설명한 뒤 활동별 회당 파라미터(소요시간 H.MM·비용 단일통화·인원·연간횟수·FTE)를 하나씩 확인해 확정한다 — 모르는 값은 비워 둔다",
        "Explain the parameter system, then confirm per-activity values (duration H.MM, single-currency cost, headcount, annual count, FTE) one by one — leave unknowns empty",
        ("params_done",),
    ),
    StageDef(
        "review", "Review",
        "완성된 맵을 함께 검토하고 승인 여부를 확인한다",
        "Review the finished map together and confirm approval",
        ("approved",),
    ),
)

_BY_KEY = {stage.key: stage for stage in STAGES}


def get_stage(key: str) -> StageDef:
    stage = _BY_KEY.get(key)
    if stage is None:
        raise ValueError(f"unknown stage: {key}")
    return stage


def stage_index(key: str) -> int:
    return [s.key for s in STAGES].index(get_stage(key).key)


def next_stage_key(key: str) -> str | None:
    idx = stage_index(key)
    return STAGES[idx + 1].key if idx + 1 < len(STAGES) else None


def is_stage_complete(key: str, facts: dict) -> bool:
    stage = get_stage(key)
    stage_facts = facts.get(key) or {}
    return all(stage_facts.get(name) for name in stage.required_facts)


def first_incomplete_stage(facts: dict) -> str:
    """문서/기존 맵이 미리 채운 스테이지는 건너뛴 시작점 — 전부 완료면 review."""
    for stage in STAGES:
        if not is_stage_complete(stage.key, facts):
            return stage.key
    return "review"
