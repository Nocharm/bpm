"""Pydantic request/response models — API boundary validation."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class MapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    # 생성 시 초기 공개 범위 — 생성자=owner라 즉시 반영(승인 워크플로 불필요)
    visibility: Literal["private", "public"] = "private"


class MapCopy(BaseModel):
    # 새 맵 이름 — 비우면 "<원본명> (Copy)" (F12 승인본 복사)
    name: str | None = Field(default=None, min_length=1, max_length=200)


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
    created_at: datetime


class VersionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    actor: str
    note: str | None
    created_at: datetime


class VersionDetailOut(VersionOut):
    # 상세 응답 전용 — 워크플로 단건 응답(VersionOut)에는 events를 싣지 않아 lazy-load 회피
    events: list[VersionEventOut]


class VersionCreate(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    # 주어지면 해당 버전의 노드/엣지를 깊은 복사 (As-Is → To-Be 파생, spec §3.4)
    source_version_id: int | None = None


class VersionUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=100)


class ApproversUpdate(BaseModel):
    user_ids: list[str]


# ── 권한 관리 (collaborators / owner-transfer / visibility / approvals, Task 4) ──

PrincipalType = Literal["user", "department", "group"]
Role = Literal["viewer", "editor", "owner"]


class PermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    principal_type: str
    principal_id: str
    role: str
    granted_by: str


class PermissionCreate(BaseModel):
    principal_type: PrincipalType
    principal_id: str = Field(min_length=1, max_length=200)
    # owner 부여는 owner-transfer 경로로만 — 여기선 viewer/editor만 허용
    role: Literal["viewer", "editor"]


class PermissionPatch(BaseModel):
    role: Role


class OwnerTransferIn(BaseModel):
    new_owner: str = Field(min_length=1, max_length=100)


class VisibilityRequestIn(BaseModel):
    to_visibility: Literal["public", "private"]


class ApprovalRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    map_id: int
    kind: str
    payload: dict
    requested_by: str
    status: str
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]


# ── 사용자 그룹 관리 (Layer 4 Task 3b) ──────────────────────────

MemberType = Literal["user", "department"]


class MemberIn(BaseModel):
    member_type: MemberType
    # user→login_id; department→org_path 문자열 (존재 검증 없음 — 디렉터리 규약)
    member_id: str = Field(min_length=1, max_length=200)


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    member_type: str
    member_id: str


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    # 생성 시 ≥2 멤버 필수 (managers 는 별개) — 검증은 라우터에서 422
    members: list[MemberIn] = Field(default_factory=list)
    # 추가 관리자 login_id 들. 생성자는 자동으로 관리자에 포함된다
    managers: list[str] = Field(default_factory=list)


class ManagersIn(BaseModel):
    # 관리자 집합 교체 — 최소 1명 (빈 배열은 라우터에서 422)
    managers: list[str] = Field(default_factory=list)


class GroupDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]


class GroupOut(BaseModel):
    id: int
    name: str
    description: str
    status: str
    created_by: str
    approved_by: str | None
    approved_at: datetime | None
    created_at: datetime
    members: list[MemberOut]
    managers: list[str]


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
    # 호출자의 서버 산정 유효 역할 — 프론트 게이팅 단일 소스 (클라 재계산 폐기)
    my_role: str | None = None
    # 맵 공개 범위 — Visibility 화면이 서버 진실을 표시·토글하기 위한 읽기 전용 노출
    visibility: str = "private"
    # 최신 버전(최대 id)의 워크플로 상태 — 홈 카드 표시용 (목록 응답에서만 채움)
    latest_version_status: str | None = None
    # 소프트삭제 시각 — 휴지통(삭제 예정) 목록 표시용. 정상 맵은 None (DL)
    deleted_at: datetime | None = None


class MapDetailOut(MapOut):
    versions: list[VersionDetailOut]


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
    # 하위프로세스 참조 (node_type="subprocess")
    linked_map_id: int | None = None
    follow_latest: bool = False
    linked_version_id: int | None = None
    # 대표 끝 (node_type="end")
    is_primary_end: bool = False

    @field_validator("group_ids", mode="before")
    @classmethod
    def _coerce_group_ids(cls, value: object) -> object:
        # 레거시 DB(컬럼 NULL)에서 from_attributes 로드 시 None → [] 로 보정
        return [] if value is None else value


HandleSide = Literal["top", "bottom", "left", "right"]


class EdgeIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_node_id: str
    target_node_id: str
    label: str = ""
    source_side: HandleSide = "right"
    target_side: HandleSide = "left"
    source_handle: str | None = Field(default=None, max_length=200)
    target_handle: str | None = Field(default=None, max_length=200)


class NodeOut(NodeIn):
    pass


class FlatNodeOut(NodeIn):
    # 전체 그래프 조회용 — 계보 정보 포함 (검색·버전 diff, spec §7 Phase B)
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
    locked: bool = False  # True → caller is below viewer; empty payload, no graph built


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
    # 부서 소속 판정용 org_path(루트→리프, "A/B/C") — 프론트 멤버 하이라이트(HM-2)
    org_path: str = ""
    # BPM 시스템 관리자 여부 — 프론트 sysadmin-only UI 게이팅용
    is_sysadmin: bool


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


# ── 관리 콘솔 API (sysadmin-only, Layer 4 Task 0b) ──────────────────────────

class AdminUserOut(BaseModel):
    """시스템 관리 콘솔용 — sysadmin only / Richer employee row for admin console."""

    login_id: str
    name: str
    department: str
    role: str          # 'admin' | 'user'
    is_sysadmin: bool
    org_levels: list[str]  # non-null org_l1..org_l5 in root→leaf order
    active: bool       # False = AD account disabled (userAccountControl bit 0x2)


class AdminDeptOut(BaseModel):
    """부서 행 — 관리 콘솔 department-table / Department row for admin console."""

    name: str          # leaf segment (display label)
    org_levels: list[str]  # full path levels root→leaf (variable depth)


class AdminDirectoryOut(BaseModel):
    users: list[AdminUserOut]
    departments: list[AdminDeptOut]


# ── 디렉터리 API (collaborator picker, Layer 4 Task 0) ──────────────────────

class DirectoryUserOut(BaseModel):
    """협업자 피커용 — 인증 사용자 누구나 조회 가능 / For picker; any authenticated user."""

    id: str       # login_id
    name: str     # English display name
    department: str


class EligibleApproverOut(DirectoryUserOut):
    """승인자 후보 — 디렉터리 기본 + 소속 경로(승인자 카드 표시용, ST)."""

    org_path: str = ""  # 루트→리프 조직 경로(센터/부서/팀/그룹/파트)


class DirectoryDeptOut(BaseModel):
    """부서 principal 후보 — principalId = org_path 문자열 / dept principal; id = org_path string."""

    id: str       # org_path ("l1/l2/l3" or leaf segment)
    name: str     # leaf segment (display label)


class DirectoryOut(BaseModel):
    users: list[DirectoryUserOut]
    departments: list[DirectoryDeptOut]


class EligibleAssigneesOut(BaseModel):
    """노드 담당자/부서 후보 — 맵 조회권한(viewer+) 보유 직원 + 그 직원들의 부서 (F5)."""

    users: list[DirectoryUserOut]
    departments: list[str]


AI_NODE_TYPES = {"start", "process", "decision", "end"}


class AiChatTurn(BaseModel):
    # 경계에서 역할 제약 — 클라이언트가 system 역할을 주입하지 못하도록 (security.md)
    role: Literal["user", "assistant"]
    content: str


class AiChatRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    history: list[AiChatTurn] = Field(default_factory=list, max_length=20)
    # 사용할 모델 id — 없으면 서버 기본(settings.ai_model). 프론트가 /ai/models에서 선택
    model: str | None = None


class AiModelsOut(BaseModel):
    models: list[str]


class AiNodeAttributes(BaseModel):
    """노드 비즈니스 메타 (선택) — NodeIn과 동일 제약. AI 생성/제안에 실어 보냄 (Phase 2)."""

    assignee: str = Field(default="", max_length=100)
    department: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    duration: str = Field(default="", max_length=50)
    color: str = Field(default="", pattern=r"^$|^#[0-9a-fA-F]{6}$")


class AiNode(BaseModel):
    key: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=200)
    node_type: str = "process"
    description: str = ""
    # 선택 메타 — 미제공이면 None (apply가 빈값/기존값으로 처리, D1)
    attributes: AiNodeAttributes | None = None
    # 소속 그룹 — AiProposal.groups[].key 참조 (단일 태그). null=무소속
    group_key: str | None = Field(default=None, max_length=50)


class AiEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class AiGroup(BaseModel):
    """그룹(레인/박스) 제안 — key는 노드 group_key가 참조하는 임시키 (Phase 2)."""

    key: str = Field(min_length=1, max_length=50)
    label: str = Field(default="", max_length=200)
    color: str = Field(default="", pattern=r"^$|^#[0-9a-fA-F]{6}$")
    parent_key: str | None = Field(default=None, max_length=50)


AiOpAction = Literal["add", "remove", "connect", "relabel", "set_attr"]


class AiOp(BaseModel):
    """증분 편집 연산 (D1 하이브리드 편집 경로). node_id는 [현재 그래프]의 캐노니컬 id.

    구조만 정의 — node_id 교차검증·실제 적용은 라우터/프론트(Phase 3). action별 사용 필드:
    add(node) · remove(node_id) · connect(source/target/label) · relabel(node_id/title)
    · set_attr(node_id/attributes).
    """

    action: AiOpAction
    node_id: str | None = None
    node: AiNode | None = None
    source: str | None = None
    target: str | None = None
    label: str | None = None
    title: str | None = None
    attributes: AiNodeAttributes | None = None


class AiStep(BaseModel):
    """워크스루 단계 (Phase 5). node_id는 현 그래프의 캐노니컬 id."""

    order: int
    node_id: str
    narration: str = ""


AiSeverity = Literal["high", "medium", "low"]


class AiFinding(BaseModel):
    """분석 결과 항목 (Phase 4). node_ids는 현 그래프의 캐노니컬 id."""

    severity: AiSeverity
    category: str = Field(max_length=50)
    node_ids: list[str] = Field(default_factory=list)
    message: str
    suggestion: str = ""


class AiProposal(BaseModel):
    # 판별 타입 5종 — graph/answer는 활성, ops/walkthrough/analysis는 정의만(Phase 3~5 활성)
    kind: Literal["graph", "answer", "walkthrough", "analysis", "ops"]
    message: str = ""
    nodes: list[AiNode] = Field(default_factory=list)
    edges: list[AiEdge] = Field(default_factory=list)
    groups: list[AiGroup] = Field(default_factory=list)
    ops: list[AiOp] = Field(default_factory=list)
    steps: list[AiStep] = Field(default_factory=list)
    findings: list[AiFinding] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_graph_integrity(self) -> "AiProposal":
        # graph만 구조 검증 — ops/walkthrough/analysis의 node_id 교차검증은 라우터(현 그래프 필요)
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
        # 그룹 키 유일성 + node.group_key / group.parent_key 참조 무결성
        group_keys = [group.key for group in self.groups]
        if len(group_keys) != len(set(group_keys)):
            raise ValueError("duplicate group keys")
        group_keyset = set(group_keys)
        for node in self.nodes:
            if node.group_key is not None and node.group_key not in group_keyset:
                raise ValueError(f"node references unknown group key: {node.group_key}")
        for group in self.groups:
            if group.parent_key is not None and group.parent_key not in group_keyset:
                raise ValueError(f"group references unknown parent key: {group.parent_key}")
        return self


class TableDataOut(BaseModel):
    """admin 테이블 뷰어 — 선택 테이블의 페이징/정렬/필터된 행 / Paginated table rows for the admin viewer."""

    columns: list[str]
    rows: list[dict[str, Any]]
    total: int
    page: int
    size: int
