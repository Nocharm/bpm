"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]
