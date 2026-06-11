"""Pydantic request/response models — API boundary validation."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class MapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str


class VersionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    # 주어지면 해당 버전의 노드/엣지를 깊은 복사 (As-Is → To-Be 파생, spec §3.4)
    source_version_id: int | None = None


class VersionUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=100)


class MapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    created_at: datetime
    updated_at: datetime


class MapDetailOut(MapOut):
    versions: list[VersionOut]


class NodeIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str = ""
    description: str = ""
    node_type: str = "default"
    pos_x: float = 0.0
    pos_y: float = 0.0
    sort_order: int = 0


class EdgeIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_node_id: str
    target_node_id: str
    label: str = ""


class NodeOut(NodeIn):
    # 이 노드가 하위 캔버스(자식 노드)를 가지는지 — 드릴다운 표시용 (계산 필드, 입력 시 무시)
    has_children: bool = False


class GraphIn(BaseModel):
    nodes: list[NodeIn]
    edges: list[EdgeIn]


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeIn]
