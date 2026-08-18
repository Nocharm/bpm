"""컨설턴트 canonical 모델 — DB 무관 순수 검증(내부 IR).

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §4. 원래 외부 전달 양식
(categories.json+maps.jsonl)이었으나 실전달물이 인터뷰 결과 JSON으로 확정되며(2026-08-18)
파일 로더·CLI는 제거 — 이제 인터뷰 어댑터(consultant_interview)가 이 모델을 생성하고
import_delivery가 소비한다. 구조 위반은 명확한 에러로, 값 수준(duration 등) 정규화는
엔진에서 경고로 다룬다.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, ValidationError, model_validator


class CanonicalError(ValueError):
    """전달물 구조 위반 — 파일 단위로 임포트를 중단시켜야 하는 오류."""


class CanonicalCategory(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    level: int = Field(ge=1, le=5)
    parent: str | None = None


class CanonicalParams(BaseModel):
    # 50자 상한 — Node.duration/cost_krw/cost_usd/headcount/annual_count/fte는 String(50).
    # postgres 컬럼폭 초과 시 sqlite에서는 안 걸리는데 서버(pg)에서만 apply 중 크래시하는 걸
    # 파서 단계에서 막는다. input/output은 무상한 — sp_input/sp_output은 Text(자유 텍스트,
    # design §2.2), 실제 값은 문장 단위라 50자 상한을 걸면 정상 데이터가 거부된다.
    duration: str = Field(default="", max_length=50)
    cost_krw: str = Field(default="", max_length=50)
    cost_usd: str = Field(default="", max_length=50)
    headcount: str = Field(default="", max_length=50)
    annual_count: str = Field(default="", max_length=50)
    fte: str = Field(default="", max_length=50)
    input: str = ""
    output: str = ""


class CanonicalNode(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(max_length=200)
    type: Literal["process", "decision"] = "process"
    # Node.department/assignee/system은 String(100) — 컬럼폭 상한과 동기화 (위 CanonicalParams와 동일 이유)
    department: str = Field(default="", max_length=100)
    assignee: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    seq: int = 0
    # 인터뷰 어댑터가 KV 직렬화를 싣는다 — Node.description은 Text, 캡 금지 (design 2026-08-18 §3)
    description: str = ""


class CanonicalEdge(BaseModel):
    source: str = Field(alias="from")
    target: str = Field(alias="to")
    label: str = Field(default="", max_length=200)  # Edge.label은 String(200)


class CanonicalLink(BaseModel):
    to_map: str
    after_node: str | None = None


class CanonicalMap(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    category: str
    # None = 오너 미확정(인터뷰 1차) — 엔진이 actor 폴백 + consultant_owner_pending 마킹 (design 2026-08-18 §4)
    owner: Annotated[str, Field(min_length=1, max_length=100)] | None = None  # MapPermission.principal_id는 String(100)
    approvers: list[Annotated[str, Field(max_length=100)]] = []  # MapApprover.user_id는 String(100)
    # ProcessMap.owning_department는 String(200)이지만 sp_department는 String(100) — 좁은 쪽에 맞춘다
    department: str = Field(default="", max_length=100)
    visibility: Literal["public", "private"] = "public"
    # 인터뷰 fields KV 직렬화 착지 — ProcessMap.description(Text), 캡 금지 (design 2026-08-18 §3)
    description: str = ""
    params: CanonicalParams = CanonicalParams()
    nodes: list[CanonicalNode] = []
    edges: list[CanonicalEdge] = []
    links: list[CanonicalLink] = []

    @model_validator(mode="after")
    def _check_graph_refs(self) -> "CanonicalMap":
        codes = [n.code for n in self.nodes]
        seen: set[str] = set()
        for code in codes:
            if code in seen:
                raise ValueError(f"duplicate node code: {code}")
            seen.add(code)
        for edge in self.edges:
            for end in (edge.source, edge.target):
                if end not in seen:
                    raise ValueError(f"edge references unknown node: {end}")
        linked_maps: set[str] = set()
        for link in self.links:
            if link.to_map in linked_maps:
                raise ValueError(f"duplicate link target: {link.to_map}")
            linked_maps.add(link.to_map)
            if link.after_node is not None and link.after_node not in seen:
                raise ValueError(f"link.after_node unknown node: {link.after_node}")
        return self


def parse_categories(raw: object) -> list[CanonicalCategory]:
    """categories 구조 검증(JSON 파싱 이후) — 중복 code·부모 참조·레벨 트리.

    raw는 `{"categories": [...]}` 형태 — 인터뷰 어댑터가 framework.categories를 이 형태로
    감싸 단일 검증 경로를 유지한다.
    """
    try:
        cats = [CanonicalCategory.model_validate(c) for c in raw["categories"]]  # type: ignore[index]
    except (KeyError, ValidationError) as exc:
        raise CanonicalError(f"categories.json invalid: {exc}") from exc
    by_code: dict[str, CanonicalCategory] = {}
    for cat in cats:
        if cat.code in by_code:
            raise CanonicalError(f"duplicate category code: {cat.code}")
        by_code[cat.code] = cat
    for cat in cats:
        if cat.parent is None:
            if cat.level != 1:
                raise CanonicalError(f"category {cat.code}: level {cat.level} without parent")
            continue
        parent = by_code.get(cat.parent)
        if parent is None:
            raise CanonicalError(f"category {cat.code}: unknown parent {cat.parent}")
        if cat.level != parent.level + 1:
            raise CanonicalError(
                f"category {cat.code}: level {cat.level} under parent level {parent.level}"
            )
    return cats
