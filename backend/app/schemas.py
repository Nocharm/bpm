"""Pydantic request/response models — API boundary validation."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    status: str
    submitted_by: str | None
    reject_reason: str | None


class VersionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    # 주어지면 해당 버전의 노드/엣지를 깊은 복사 (As-Is → To-Be 파생, spec §3.4)
    source_version_id: int | None = None


class VersionUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=100)


class ApproversUpdate(BaseModel):
    user_ids: list[str]


class WorkflowStateOut(BaseModel):
    version_id: int
    status: str
    submitted_by: str | None
    reject_reason: str | None
    # 맵의 지정 승인자 전체
    approvers: list[str]
    # 이번 사이클에 이미 승인한 승인자
    approvals: list[str]


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class MapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class MapDetailOut(MapOut):
    versions: list[VersionOut]


class NodeIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str = ""
    description: str = ""
    node_type: str = "process"
    # hex 색 또는 빈 값(타입 기본색) — 형식은 API 경계에서 검증
    color: str = Field(default="", pattern=r"^$|^#[0-9a-fA-F]{6}$")
    # BPM 속성 (spec §7 Phase B)
    assignee: str = Field(default="", max_length=100)
    department: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    duration: str = Field(default="", max_length=50)
    pos_x: float = 0.0
    pos_y: float = 0.0
    sort_order: int = 0
    # 다중 그룹(태그) 소속 — 노드가 여러 그룹에 동시 소속. 빈 배열=무소속
    group_ids: list[str] = Field(default_factory=list)

    @field_validator("group_ids", mode="before")
    @classmethod
    def _coerce_group_ids(cls, value: object) -> object:
        # 레거시 DB(컬럼 NULL)에서 from_attributes 로드 시 None → [] 로 보정
        return [] if value is None else value


class EdgeIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_node_id: str
    target_node_id: str
    label: str = ""
    source_side: str = "right"
    target_side: str = "left"


class NodeOut(NodeIn):
    # 이 노드가 하위 캔버스(자식 노드)를 가지는지 — 드릴다운 표시용 (계산 필드, 입력 시 무시)
    has_children: bool = False


class FlatNodeOut(NodeIn):
    # 전체 그래프(모든 계층) 조회용 — 계층/계보 정보 포함 (검색·버전 diff, spec §7 Phase B)
    parent_node_id: str | None = None
    source_node_id: str | None = None


class GroupIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    # 상위 그룹 id — 중첩(그룹 안 그룹). null=최상위
    parent_group_id: str | None = None
    label: str = Field(default="", max_length=200)
    color: str = Field(default="", pattern=r"^$|^#[0-9a-fA-F]{6}$")


class GraphIn(BaseModel):
    nodes: list[NodeIn]
    edges: list[EdgeIn]
    groups: list[GroupIn] = []


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeIn]
    groups: list[GroupIn] = []


class VersionGraphOut(BaseModel):
    nodes: list[FlatNodeOut]
    edges: list[EdgeIn]


class CheckoutIn(BaseModel):
    # True면 다른 사용자의 유효한 잠금도 인수 (spec §7 Phase C)
    force: bool = False


class CheckoutOut(BaseModel):
    checked_out_by: str | None
    checked_out_at: datetime | None
    # 요청 사용자가 현재 잠금 소유자인지
    mine: bool


class CommentCreate(BaseModel):
    node_id: str
    body: str = Field(min_length=1, max_length=2000)


class CommentUpdate(BaseModel):
    resolved: bool


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    node_id: str
    author: str
    body: str
    resolved: bool
    created_at: datetime


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    map_id: int | None
    version_id: int | None
    message: str
    read: bool
    created_at: datetime


class MeOut(BaseModel):
    username: str
    ai_enabled: bool
    name: str
    role: str
    department: str


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    login_id: str
    name: str
    title: str
    source: str
    role: str
    department: str


class SyncSummaryOut(BaseModel):
    scanned: int
    upserted: int
    excluded: int


AI_NODE_TYPES = {"start", "process", "decision", "end"}


class AiChatTurn(BaseModel):
    # 경계에서 역할 제약 — 클라이언트가 system 역할을 주입하지 못하도록 (security.md)
    role: Literal["user", "assistant"]
    content: str


class AiChatRequest(BaseModel):
    parent: str | None = None
    instruction: str = Field(min_length=1, max_length=2000)
    history: list[AiChatTurn] = Field(default_factory=list, max_length=20)
    # 사용할 모델 id — 없으면 서버 기본(settings.ai_model). 프론트가 /ai/models에서 선택
    model: str | None = None


class AiModelsOut(BaseModel):
    models: list[str]


class AiNode(BaseModel):
    key: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=200)
    node_type: str = "process"
    description: str = ""


class AiEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class AiProposal(BaseModel):
    # 판별 타입 — graph: 순서도 제안, answer: 사용법 텍스트 (design 2026-06-15)
    kind: Literal["graph", "answer"]
    message: str = ""
    nodes: list[AiNode] = Field(default_factory=list)
    edges: list[AiEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_graph_integrity(self) -> "AiProposal":
        if self.kind != "graph":
            return self
        keys = [node.key for node in self.nodes]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate node keys")
        keyset = set(keys)
        for node in self.nodes:
            if node.node_type not in AI_NODE_TYPES:
                raise ValueError(f"invalid node_type: {node.node_type}")
        for edge in self.edges:
            if edge.source not in keyset or edge.target not in keyset:
                raise ValueError("edge references unknown node key")
        return self
