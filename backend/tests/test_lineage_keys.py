"""계보 키·이름 정규화 헬퍼 — 임포터(scripts/)와 앱(framework_slots)이 공유하는 순수 함수."""

from app.lineage import (
    external_lineage_key,
    external_ref_lineage_key,
    make_node_id,
    normalize_task_name,
)


def test_normalize_task_name_ignores_case_width_and_whitespace() -> None:
    assert normalize_task_name("OOS 접수 및 초동 평가") == normalize_task_name("OOS접수 및  초동평가")
    assert normalize_task_name("Oos 접수") == normalize_task_name("OOS 접수")
    assert normalize_task_name("ＯＯＳ 접수") == normalize_task_name("OOS 접수")  # NFKC 전각→반각
    assert normalize_task_name("  ") == ""


def test_normalize_task_name_keeps_distinct_names_apart() -> None:
    assert normalize_task_name("교정 결과 보고") != normalize_task_name("교정 결과 보고 및 이력 등록")


def test_external_ref_lineage_key_is_namespaced_by_home_l5() -> None:
    a = external_ref_lineage_key("19-01-06-01-02", "ext-0001")
    b = external_ref_lineage_key("19-01-02-01-01", "ext-0001")  # 다른 파일의 같은 refId
    assert a != b
    assert a == external_ref_lineage_key("19-01-06-01-02", "ext-0001")  # 결정적
    assert a != external_lineage_key("ext-0001")  # 미선언(taskId) 키와도 구분
    assert a == make_node_id("__ext__", "19-01-06-01-02|ext-0001")
