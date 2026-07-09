"""Pydantic request/response models — API boundary validation."""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


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


class SubprocessDesignationIn(BaseModel):
    # 부서 필수 — 공백만은 불가 (지정의 핵심 메타). 나머지는 선택 (spec 2026-07-06)
    department: str = Field(min_length=1, max_length=100)
    assignee: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    duration: str = Field(default="", max_length=50)
    # 지정 URL — 노드 url과 동일하게 길이만 서버 검증(스킴은 클라이언트) (url-label design 2026-07-07)
    url: str = Field(default="", max_length=500)
    url_label: str = Field(default="", max_length=100)

    @field_validator("department")
    @classmethod
    def _department_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("department must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def _drop_label_without_url(self) -> "SubprocessDesignationIn":
        if not self.url.strip():
            self.url_label = ""
        return self


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    status: str
    submitted_by: str | None
    reject_reason: str | None
    created_at: datetime
    version_number: int | None = None


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
    deleted_at: datetime | None = None  # 소프트삭제/거절 시각 — 7일 후 자동 영구삭제
    name_changed_at: datetime | None = None  # 마지막 이름변경 시각 — 주 1회 rename 제한
    members: list[MemberOut]
    managers: list[str]


class GroupRenameIn(BaseModel):
    name: str


class PendingCheckoutRequestOut(BaseModel):
    """WorkflowStateOut에 내포되는 경량 점유 요청 — 점유권 탭 요청자 카드용."""

    id: int
    requested_by: str
    created_at: datetime | None = None


class CheckoutRequestOut(BaseModel):
    """점유권 요청 단건 응답 — request/decide 엔드포인트 공용."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    version_id: int
    requested_by: str
    status: str
    created_at: datetime


class CheckoutRequestQueueOut(BaseModel):
    """승인 큐 목록 응답 — pending 목록 전용, 맵·버전 컨텍스트 포함."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    version_id: int
    requested_by: str
    status: str
    created_at: datetime
    map_id: int
    map_name: str
    version_label: str


class CheckoutDecideIn(BaseModel):
    approve: bool


class InboxApprovalOut(BaseModel):
    """승인 대기 인박스 통합 항목 — 세 출처(버전 승인·점유권 이전·권한/가시성)를 kind로 구분.

    id: 각 kind의 act 엔드포인트가 받는 id (version_approval=version_id, 그 외=request id).
    """

    kind: Literal["version_approval", "checkout_transfer", "approval_request"]
    id: int
    title: str
    map_id: int
    map_name: str
    requester: str
    status: str
    created_at: datetime
    version_id: int | None = None  # checkout_transfer·version_approval의 대상 버전
    detail: dict | None = None  # approval_request의 payload 등 부가 정보
    # 상세 표시용 부가 정보
    version_label: str | None = None
    version_number: int | None = None
    updated_at: datetime | None = None  # 버전/맵 최종 수정 시각
    holder: str | None = None  # checkout_transfer 현재 점유자
    before: str | None = None  # approval_request 변경 전 값(가시성/역할)
    after: str | None = None  # approval_request 변경 후 값
    principal: str | None = None  # permission_downgrade 대상 사용자


class ManualOut(BaseModel):
    """사용 매뉴얼 게시본 — DB 행 또는 파일 fallback(updated_at=None) 공용."""

    model_config = ConfigDict(from_attributes=True)

    format: str
    content: str
    updated_at: datetime | None = None
    updated_by: str | None = None


class ManualUpdate(BaseModel):
    format: Literal["markdown", "html"] = "markdown"
    content: str = Field(max_length=200_000)


class ManualDocCreate(BaseModel):
    """매뉴얼 문서 생성 — 제목은 서버가 본문에서 자동 추출 (F10)."""

    language: Literal["ko", "en"] = "ko"
    format: Literal["markdown", "html"] = "markdown"
    content: str = Field(max_length=200_000)


class ManualDocPatch(BaseModel):
    """매뉴얼 문서 수정 — 보낸 필드만 반영, content 변경 시 제목 재추출 (F10)."""

    language: Literal["ko", "en"] | None = None
    format: Literal["markdown", "html"] | None = None
    content: str | None = Field(default=None, max_length=200_000)


class ManualDocListOut(BaseModel):
    """매뉴얼 문서 목록 행 — content 제외(가벼운 목록) (F10)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    language: str
    format: str
    sort_order: int
    updated_at: datetime | None = None
    updated_by: str | None = None


class ManualDocDetailOut(ManualDocListOut):
    content: str


class DashboardMetricsOut(BaseModel):
    """운영 대시보드 지표 — 현재는 접속자 현황(login_records 집계). 상세 지표는 후속."""

    visitors_unique: int  # 고유 접속자 수(distinct login_id)
    logins_total: int  # 전체 로그인/활동 기록 수
    logins_7d: int  # 최근 7일 로그인 수


class WorkflowStateOut(BaseModel):
    version_id: int
    # 게시 시 부여된 버전 번호 — 미게시 초안은 None
    version_number: int | None
    status: str
    submitted_by: str | None
    reject_reason: str | None
    # 현재 반려 상태를 만든 승인자(rejected 상태일 때만) — 승인자 목록 'Rejected' 표시용
    rejected_by: str | None = None
    # 맵의 지정 승인자 전체
    approvers: list[str]
    # 이번 사이클에 이미 승인한 승인자
    approvals: list[str]
    # 현재 활성 체크아웃 보유자 — TTL 이내 잠금이 없으면 None
    checkout_holder: str | None = None
    # 점유 획득 시각 — "언제" 상대시간 표시용(활성 점유일 때만)
    checkout_holder_since: datetime | None = None
    # 점유 출처(누구에게서 넘어왔는지) — 이전/요청승인 시 기록, 최초 생성자 점유는 None
    checkout_from: str | None = None
    # (deprecated) 단건 미결 요청 — 하위호환. 신규 UI는 pending_checkout_requests 사용
    pending_checkout_request: PendingCheckoutRequestOut | None = None
    # 이 버전의 모든 미결 점유 요청 — 요청자 복수 (점유권 탭)
    pending_checkout_requests: list[PendingCheckoutRequestOut] = []


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
    # H5b — 홈 카드 집계(목록 응답에서만 채움): 전체 버전 수 · 라이브(published, 없으면 최신) 노드 수 · 허용 인원 수 · 소유자 직원명
    version_count: int = 0
    node_count: int = 0
    member_count: int = 0
    owner_name: str | None = None
    # 소프트삭제 시각 — 휴지통(삭제 예정) 목록 표시용. 정상 맵은 None (DL)
    deleted_at: datetime | None = None
    # 서브프로세스 지정 상태·어트리뷰트·최근 변경 — 설정 페이지 표시용 (spec 2026-07-06)
    sp_designated_at: datetime | None = None
    sp_department: str | None = None
    sp_assignee: str | None = None
    sp_system: str | None = None
    sp_duration: str | None = None
    sp_url: str | None = None
    sp_url_label: str | None = None
    sp_changed_by: str | None = None
    sp_changed_at: datetime | None = None


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
    # 참조 링크 — 스킴 검증은 클라이언트(CSV 파서·링크 렌더)에서. 자유 타이핑 자동저장이 깨지지 않게 길이만 제한
    url: str = Field(default="", max_length=500)
    # URL 표시 라벨 — url이 비면 아래 validator가 함께 소거(캐스케이드 삭제를 서버 경계에서 보장)
    url_label: str = Field(default="", max_length=100)
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

    @model_validator(mode="after")
    def _drop_label_without_url(self) -> "NodeIn":
        if not self.url.strip():
            self.url_label = ""
        return self


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


class SubprocessRefOut(BaseModel):
    # 링크 대상 맵의 지정 상태·어트리뷰트 — 노드에 복사하지 않는 라이브 참조 렌더 소스 (spec 2026-07-06)
    designated: bool
    department: str | None = None
    assignee: str | None = None
    system: str | None = None
    duration: str | None = None
    url: str | None = None
    url_label: str | None = None


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeIn]
    groups: list[GroupIn] = []
    locked: bool = False  # True → caller is below viewer; empty payload, no graph built
    # 그래프 내 subprocess 노드들의 linked_map_id별 지정 정보 — 경고·잠금·어트리뷰트 표시 소스
    subprocess_refs: dict[int, SubprocessRefOut] = {}


class VersionGraphOut(BaseModel):
    nodes: list[FlatNodeOut]
    edges: list[EdgeIn]
    # 에디터 루트 그래프(/graph/all)도 지정 정보 동봉 — GraphOut.subprocess_refs와 동일 (spec 2026-07-06)
    subprocess_refs: dict[int, SubprocessRefOut] = {}


class CheckoutIn(BaseModel):
    # True면 다른 사용자의 유효한 잠금도 인수 (spec §7 Phase C)
    force: bool = False


class CheckoutOut(BaseModel):
    checked_out_by: str | None
    checked_out_at: datetime | None
    # 요청 사용자가 현재 잠금 소유자인지
    mine: bool


class CheckoutTransferIn(BaseModel):
    """점유권 이전 요청 — 대상 login_id."""
    to: str


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


class FeedbackCreate(BaseModel):
    kind: Literal["bug", "suggestion", "question", "etc"]
    body: str = Field(min_length=1, max_length=4000)
    context: dict = Field(default_factory=dict)


class FeedbackUpdate(BaseModel):
    # 부분 갱신 — 제공된 필드만. 권한은 서버가 필드별 검증
    # (status=sysadmin · reply=sysadmin·done아닐때 · body=작성자·draft일때)
    status: Literal["draft", "in_progress", "done"] | None = None
    reply: str | None = Field(default=None, max_length=4000)
    body: str | None = Field(default=None, min_length=1, max_length=4000)


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    body: str
    author: str
    context: dict
    status: str
    reply: str
    created_at: datetime
    body_edited_at: datetime | None
    reply_at: datetime | None
    done_at: datetime | None


class FeedbackCounts(BaseModel):
    total: int
    mine: int
    in_progress: int
    done: int


class FeedbackListOut(BaseModel):
    items: list[FeedbackOut]
    counts: FeedbackCounts


class NoticeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_md: str = Field(default="", max_length=20000)
    importance: Literal["important", "normal"] = "normal"
    starts_at: datetime
    ends_at: datetime | None = None
    notify_all: bool = False


class NoticeUpdate(BaseModel):
    # 제공된 필드만 갱신(exclude_unset) — ends_at=null은 '무제한'으로 명시 갱신
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body_md: str | None = Field(default=None, max_length=20000)
    importance: Literal["important", "normal"] | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class NoticeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body_md: str
    importance: str
    starts_at: datetime
    ends_at: datetime | None
    created_by: str
    created_at: datetime


class MeOut(BaseModel):
    username: str
    ai_enabled: bool
    # 편집용 매뉴얼 사이트 주소 — 비어 있으면 에디터 버튼 숨김 (F9)
    manual_url: str = ""
    name: str
    role: str
    department: str
    # 부서 소속 판정용 org_path(루트→리프, "A/B/C") — 프론트 멤버 하이라이트(HM-2)
    org_path: str = ""
    # BPM 시스템 관리자 여부 — 프론트 sysadmin-only UI 게이팅용
    is_sysadmin: bool
    # 내 상위 부서장 체인(리프→루트, 본인 제외) — 피커 Manager 라벨·승인자 우선 정렬 (2026-07-09)
    manager_ids: list[str] = []


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    login_id: str
    name: str
    title: str
    source: str
    role: str
    department: str
    korean_name: str
    korean_dept: str
    active: bool
    # env(BPM_SYSADMINS) 계산값 — ORM 속성이 아니라 라우터에서 채움
    is_sysadmin: bool = False


class KoreanNameEntryIn(BaseModel):
    """임포트 항목 — 이름 필수, 그룹(dept) 선택. max_length 200 = VARCHAR(200) 초과 DataError 방지."""

    name: Annotated[str, StringConstraints(max_length=200)]
    dept: Annotated[str, StringConstraints(max_length=200)] = ""


class KoreanNamesImportIn(BaseModel):
    """한글이름 일괄 등록 — mode: skip(기존 값 보유 유저 건너뜀) | overwrite(덮어씀)."""

    mode: Literal["skip", "overwrite"]
    entries: dict[str, KoreanNameEntryIn]


class KoreanNamesImportOut(BaseModel):
    updated: int
    skipped: int
    unknown: list[str]


class SyncSummaryOut(BaseModel):
    scanned: int
    upserted: int
    excluded: int
    purged: int  # 전체 동기화에서 삭제된 스테일 ad 행 수 (2026-07-09)


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
    korean_name: str   # AD 미제공 — 어드민 임포트 전용 (2026-07-09)
    korean_dept: str


class AdminDeptOut(BaseModel):
    """부서 행 — 관리 콘솔 department-table / Department row for admin console."""

    name: str          # leaf segment (display label)
    org_levels: list[str]  # full path levels root→leaf (variable depth)
    korean_name: str = ""  # dept_info 조인 — 어드민 임포트 전용 (2026-07-09)
    manager: str = ""


class DeptInfoEntryIn(BaseModel):
    """부서 임포트 항목 — 빈 필드는 미기입(기존 보존). max_length 200 = VARCHAR(200) 초과 방지."""

    korean_name: Annotated[str, StringConstraints(max_length=200)] = ""
    manager: Annotated[str, StringConstraints(max_length=200)] = ""


class DeptInfoImportIn(BaseModel):
    """부서 한글명·부서장 일괄 등록 — 키는 영문 부서명(리프), 비어있지 않은 필드만 덮어씀."""

    entries: dict[str, DeptInfoEntryIn]


class DeptInfoImportOut(BaseModel):
    updated: int
    unknown: list[str]  # 현존 부서와 매칭 실패한 부서명


class AdminDirectoryOut(BaseModel):
    users: list[AdminUserOut]
    departments: list[AdminDeptOut]


# ── 디렉터리 API (collaborator picker, Layer 4 Task 0) ──────────────────────

class DirectoryUserOut(BaseModel):
    """협업자 피커용 — 인증 사용자 누구나 조회 가능 / For picker; any authenticated user."""

    id: str       # login_id
    name: str     # English display name
    department: str
    title: str = ""     # 직급 — 멤버 2번째 줄(H2)
    org_path: str = ""  # 루트→리프 org_path — 멤버 2번째 줄 말단 org·부서 카운트(H2)
    role: str = "user"  # admin | user — 로컬 로그인 피커에서 관리자 식별용
    korean_name: str = ""  # 멤버 카드 한/영 토글용
    korean_dept: str = ""  # 담당자 피커 한글 부서 검색용


class EligibleApproverOut(DirectoryUserOut):
    """승인자 후보 — 디렉터리 기본 + 소속 경로(승인자 카드 표시용, ST)."""

    org_path: str = ""  # 루트→리프 조직 경로(센터/부서/팀/그룹/파트)


class DirectoryDeptOut(BaseModel):
    """부서 principal 후보 — principalId = org_path 문자열 / dept principal; id = org_path string."""

    id: str       # org_path ("l1/l2/l3" or leaf segment)
    name: str     # leaf segment (display label)
    korean_name: str = ""  # dept_info 조인(리프명 키) — 피커 한/영 표시·검색 (2026-07-09)
    manager: str = ""


class DirectoryOut(BaseModel):
    users: list[DirectoryUserOut]
    departments: list[DirectoryDeptOut]


class DeptInfoValueOut(BaseModel):
    """부서 부가정보 값 — dept_infos 맵 원소 (키는 영문 부서명)."""

    korean_name: str = ""
    manager: str = ""


class EligibleAssigneesOut(BaseModel):
    """노드 담당자/부서 후보 — 맵 조회권한(viewer+) 보유 직원 + 그 직원들의 부서 (F5)."""

    users: list[DirectoryUserOut]
    departments: list[str]
    # 부서명 → 한글 부서명·부서장 (dept_info 보유 부서만) — 부서 셀렉트 검색·한/영 표시용
    dept_infos: dict[str, DeptInfoValueOut] = {}


AI_NODE_TYPES = {"start", "process", "decision", "end"}


class AppSettingsOut(BaseModel):
    """앱 런타임 설정 — AI 챗 기능 팁 + 대화 보존 상한."""

    ai_chat_tips: list[str]
    ai_chat_max_sessions_per_map: int
    ai_chat_max_messages_per_session: int
    ai_chat_retention_days: int
    updated_by: str | None = None
    updated_at: datetime | None = None


class AppSettingsUpdate(BaseModel):
    """부분 갱신 — None 필드는 유지. 팁을 빈 목록으로 보내면 기본 팁으로 복원."""

    ai_chat_tips: list[str] | None = Field(default=None, max_length=50)
    ai_chat_max_sessions_per_map: int | None = Field(default=None, ge=1, le=200)
    ai_chat_max_messages_per_session: int | None = Field(default=None, ge=10, le=2000)
    ai_chat_retention_days: int | None = Field(default=None, ge=7, le=3650)


class AiTipsOut(BaseModel):
    tips: list[str]


class AiChatTurn(BaseModel):
    # 경계에서 역할 제약 — 클라이언트가 system 역할을 주입하지 못하도록 (security.md)
    role: Literal["user", "assistant"]
    content: str


class AiChatRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    history: list[AiChatTurn] = Field(default_factory=list, max_length=20)
    # 사용할 모델 id — 없으면 서버 기본(settings.ai_model). 프론트가 /ai/models에서 선택
    model: str | None = None
    # 대화 세션 — None이면 첫 메시지 시점에 서버가 새 세션 생성(지연 생성)
    session_id: int | None = None


class AiModelsOut(BaseModel):
    models: list[str]


class AiChatSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    map_id: int
    map_name: str
    title: str
    message_count: int
    updated_at: datetime


class AiChatSessionsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sessions: list[AiChatSessionOut]  # updated_at desc


class AiChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "assistant"]
    content: str
    kind: str | None = None
    version_id: int | None = None
    created_at: datetime


class AiChatMessagesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    messages: list[AiChatMessageOut]  # 시간 오름차순(페이지 내)
    has_more: bool  # before 커서로 더 오래된 기록 존재 여부


class AiNodeAttributes(BaseModel):
    """노드 비즈니스 메타 (선택) — NodeIn과 동일 제약. AI 생성/제안에 실어 보냄 (Phase 2).

    부분 갱신 시맨틱(증분 편집): None(생략)=기존 값 유지, ""=지움, 값=설정.
    graph 생성/ops add에서는 None을 빈값으로 취급한다(프론트 aiNodeToGraphNode).
    """

    assignee: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    system: str | None = Field(default=None, max_length=100)
    duration: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None, pattern=r"^$|^#[0-9a-fA-F]{6}$")
    # 참조 링크 — NodeIn과 동일하게 길이만 서버 검증(스킴은 클라이언트) (url-label design 2026-07-07)
    url: str | None = Field(default=None, max_length=500)
    url_label: str | None = Field(default=None, max_length=100)


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


AiOpAction = Literal[
    "add",
    "remove",
    "connect",
    "relabel",
    "set_attr",
    "disconnect",
    "set_edge_label",
    "set_desc",
]


class AiOp(BaseModel):
    """증분 편집 연산 (D1 하이브리드 편집 경로). node_id는 [현재 그래프]의 캐노니컬 id.

    구조만 정의 — node_id 교차검증·실제 적용은 라우터/프론트(Phase 3). action별 사용 필드:
    add(node) · remove(node_id) · connect(source/target/label) · relabel(node_id/title)
    · set_attr(node_id/attributes, 부분 갱신) · disconnect(source/target)
    · set_edge_label(source/target/label) · set_desc(node_id/description).
    """

    action: AiOpAction
    node_id: str | None = None
    node: AiNode | None = None
    source: str | None = None
    target: str | None = None
    label: str | None = Field(default=None, max_length=200)
    title: str | None = None
    attributes: AiNodeAttributes | None = None
    description: str | None = Field(default=None, max_length=2000)


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
    # 적재된 대화 세션 id — 라우터가 저장 후 세팅(AI 출력에는 없음)
    session_id: int | None = None

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


class TableInfoOut(BaseModel):
    """admin 테이블 뷰어 — 테이블명 + 행수(선택 pill 표시용) / table name + row count for selector pills."""

    name: str
    count: int


class TableDataOut(BaseModel):
    """admin 테이블 뷰어 — 선택 테이블의 페이징/정렬/필터된 행 / Paginated table rows for the admin viewer."""

    columns: list[str]
    rows: list[dict[str, Any]]
    total: int
    page: int
    size: int


class EmbedCheckOut(BaseModel):
    """임베드 체크 — True/False=판정, None=대상 도달 실패(판정 불가) (embed-check design 2026-07-08)."""

    embeddable: bool | None
