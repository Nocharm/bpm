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
        "주요 활동을 순서대로 나열한다 — 세분도(활동 10개 내외)가 핵심 결정",
        "List the main activities in order — granularity (around 10 activities) is the key decision",
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
        "각 활동의 부서(제시된 후보 목록 내)와 사용 시스템을 채운다 — 담당자는 에디터 피커로 지정하므로 묻지 않는다",
        "Fill in the department (from the provided candidate list) and systems for each activity — "
        "assignees are set via the editor picker, do not ask for them",
        ("roles",),
    ),
    StageDef(
        "review", "Review",
        "완성된 맵을 함께 검토하고 승인 여부를 확인한다 — 파라미터 정리는 Params 버튼/요청으로 가능함을 처음에 한 번 안내한다",
        "Review the finished map together and confirm approval — mention once that parameters can be organized anytime via the Params button or on request",
        ("approved",),
    ),
)

# word 맵 전용 — 문서→순서도 변환 모드 3스테이지 (design 2026-07-26 §3). 시작/끝 키는
# 일반 세트와 동일("scope"/"review")라 InterviewSession.current_stage 기본값·체크포인트가 공용.
WORD_STAGES: tuple[StageDef, ...] = (
    StageDef(
        "scope", "Scope",
        "문서에서 그릴 범위(전체/특정 섹션 서브트리)와 언어 트리를 확정하고 원본 .docx 업로드를 권한다",
        "Confirm what to draw (whole document or a section subtree), the language tree, and suggest uploading the original .docx",
        ("draw_scope",),
    ),
    StageDef(
        "draft", "Draft",
        "섹션 카탈로그(와 본문 발췌)를 근거로 순서도 초안을 제안하고 사용자 교정을 반영한다",
        "Propose a flowchart draft grounded in the section catalog (and body excerpts), refine with the user",
        ("draft_confirmed",),
    ),
    StageDef(
        "review", "Review",
        "라벨 톤과 문서 링크 커버리지(노드 N개 중 M개 링크)를 요약하고 승인 여부를 확인한다",
        "Summarize label tone and document-link coverage (M of N nodes linked), confirm approval",
        ("approved",),
    ),
)

_BY_KEY = {stage.key: stage for stage in STAGES}
_WORD_BY_KEY = {stage.key: stage for stage in WORD_STAGES}


def _stage_set(mode: str) -> tuple[tuple[StageDef, ...], dict[str, StageDef]]:
    return (WORD_STAGES, _WORD_BY_KEY) if mode == "word" else (STAGES, _BY_KEY)


# params는 2026-07-28부터 고정 스테이지가 아니다(대화 중 수집 + 표 확정으로 대체) —
# 진행 중이던 레거시 세션이 안전히 review로 빠져나가도록 정의만 유지한다.
_LEGACY_PARAMS_STAGE = StageDef(
    "params", "Parameters",
    "파라미터 체계를 설명한 뒤 활동별 회당 파라미터를 확인해 확정한다 (레거시 — 다음 단계는 review)",
    "Confirm per-activity parameters (legacy — the next stage is review)",
    ("params_done",),
)


def get_stage(key: str, mode: str = "normal") -> StageDef:
    stages, by_key = _stage_set(mode)
    stage = by_key.get(key)
    if stage is None and key == "params":
        return _LEGACY_PARAMS_STAGE
    if stage is None:
        raise ValueError(f"unknown stage: {key}")
    return stage


def stage_index(key: str, mode: str = "normal") -> int:
    stages, _ = _stage_set(mode)
    return [s.key for s in stages].index(get_stage(key, mode).key)


def next_stage_key(key: str, mode: str = "normal") -> str | None:
    if key == "params":
        return "review"  # 레거시 세션 탈출로 — params는 더 이상 시퀀스에 없다
    stages, _ = _stage_set(mode)
    idx = stage_index(key, mode)
    return stages[idx + 1].key if idx + 1 < len(stages) else None


def is_stage_complete(key: str, facts: dict, mode: str = "normal") -> bool:
    stage = get_stage(key, mode)
    stage_facts = facts.get(key) or {}
    return all(stage_facts.get(name) for name in stage.required_facts)


def first_incomplete_stage(facts: dict, mode: str = "normal") -> str:
    """문서/기존 맵이 미리 채운 스테이지는 건너뛴 시작점 — 전부 완료면 review."""
    stages, _ = _stage_set(mode)
    for stage in stages:
        if not is_stage_complete(stage.key, facts, mode):
            return stage.key
    return "review"
