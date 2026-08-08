"""컨설턴트 canonical 전달물(categories.json + maps.jsonl) 파서 — DB 무관 순수 검증.

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §4. 어댑터가 기계 생성하는
계약이므로 구조 위반은 명확한 에러로, 값 수준(duration 등) 정규화는 엔진에서 경고로 다룬다.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, model_validator


class CanonicalError(ValueError):
    """전달물 구조 위반 — 파일 단위로 임포트를 중단시켜야 하는 오류."""


class CanonicalCategory(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    level: int = Field(ge=1, le=5)
    parent: str | None = None


class CanonicalParams(BaseModel):
    duration: str = ""
    cost_krw: str = ""
    cost_usd: str = ""
    headcount: str = ""
    annual_count: str = ""
    fte: str = ""
    input: str = ""
    output: str = ""


class CanonicalNode(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(max_length=200)
    type: Literal["process", "decision"] = "process"
    department: str = ""
    assignee: str = ""
    system: str = ""
    seq: int = 0


class CanonicalEdge(BaseModel):
    source: str = Field(alias="from")
    target: str = Field(alias="to")
    label: str = ""


class CanonicalLink(BaseModel):
    to_map: str
    after_node: str | None = None


class CanonicalMap(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    category: str
    owner: str = Field(min_length=1)
    approvers: list[str] = []
    department: str = ""
    visibility: Literal["public", "private"] = "public"
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
        for link in self.links:
            if link.after_node is not None and link.after_node not in seen:
                raise ValueError(f"link.after_node unknown node: {link.after_node}")
        return self


def load_categories(path: Path) -> list[CanonicalCategory]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    try:
        cats = [CanonicalCategory.model_validate(c) for c in raw["categories"]]
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


def load_maps(path: Path) -> tuple[list[CanonicalMap], list[str]]:
    # 한 줄 오류가 전달분 전체를 죽이지 않게 수집 — 벌크 임포트 계약 (design §5.2)
    maps: list[CanonicalMap] = []
    errors: list[str] = []
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                maps.append(CanonicalMap.model_validate(json.loads(text)))
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                errors.append(f"line {lineno}: {exc}")
    return maps, errors
