"""매뉴얼 섹션 선별 — 질문 관련 섹션만 budget 내 (design 2026-07-11 B2)."""

from app.manual_select import select_manual_sections

_MANUAL = """# 사용자 매뉴얼

인트로 프리앰블.

## 1. 시작하기
로그인과 홈 화면 설명. """ + ("가" * 300) + """

## 2. 버전 관리
버전 생성과 게시 절차. """ + ("나" * 300) + """

## 3. 승인 워크플로우
승인 요청과 반려 처리. """ + ("다" * 300) + """
"""


def test_small_manual_passes_through_unchanged() -> None:
    assert select_manual_sections(_MANUAL, "아무 질문", budget=100_000) == _MANUAL


def test_selects_matching_section_within_budget() -> None:
    out = select_manual_sections(_MANUAL, "승인 워크플로우에서 반려는 어떻게 해?", budget=700)
    assert "## 3. 승인 워크플로우" in out
    assert "반려 처리" in out           # 매칭 섹션 본문 포함
    assert "나" * 50 not in out          # 무관 섹션 본문 제외
    # TOC는 항상 — 미포함 섹션도 헤딩은 보인다
    assert "2. 버전 관리" in out


def test_toc_and_preamble_always_present() -> None:
    out = select_manual_sections(_MANUAL, "승인", budget=700)
    assert "# 사용자 매뉴얼" in out or "인트로 프리앰블" in out
    assert "1. 시작하기" in out  # TOC 라인


def test_zero_score_falls_back_to_leading_sections() -> None:
    out = select_manual_sections(_MANUAL, "xyz qqq", budget=700)
    assert "## 1. 시작하기" in out  # 원문 앞쪽 우선


def test_sections_are_whole_units_and_order_preserved() -> None:
    out = select_manual_sections(_MANUAL, "버전 게시와 승인", budget=1500)
    # 두 섹션이 들어가면 원문 순서(2 → 3)
    idx2, idx3 = out.find("## 2. 버전 관리"), out.find("## 3. 승인 워크플로우")
    assert idx2 != -1 and idx3 != -1 and idx2 < idx3


def test_no_headings_returns_truncated_text() -> None:
    plain = "헤딩 없는 매뉴얼 " * 200
    out = select_manual_sections(plain, "질문", budget=500)
    assert len(out) <= 500


def test_header_alone_over_budget_is_capped() -> None:
    # 섹션 헤딩이 많아 TOC만으로 budget을 넘는 극단 — 반환은 항상 budget 이하
    bloated = "# 제목\n\n" + "\n\n".join(
        f"## {i}. 아주아주아주아주아주아주 긴 섹션 제목 {i}\n본문 {i}" for i in range(1, 40)
    )
    out = select_manual_sections(bloated, "질문", budget=300)
    assert len(out) <= 300
