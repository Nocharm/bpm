"use client";

import { AlertTriangle, AlignCenterHorizontal, AlignCenterVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, Archive, ArrowLeft, ArrowLeftRight, ArrowRight, BadgeCheck, Boxes, Check, ChevronRight, Circle, CircleCheck, CircleDot, CornerDownRight, Diamond, Download, ExternalLink, Eye, FileDown, FileSpreadsheet, FileText, FolderTree, GitCompare, Group, Hand, Headset, Hourglass, LayoutGrid, Link2, Lock, Maximize2, Moon, MoreHorizontal, MoveHorizontal, MoveVertical, Network, Palette, PanelLeft, PanelRight, Pencil, PencilLine, Plus, Redo2, RotateCcw, Slash, SlidersHorizontal, Sparkles, Spline, Square, SquarePen, Sun, Trash2, Type, Undo2, Ungroup, User, Workflow, X, XCircle, type LucideIcon } from "lucide-react";
import {
  addEdge,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  type FinalConnectionState,
  MarkerType,
  type NodeChange,
  type NodeTypes,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { ScopeWindow } from "@/components/scope-window";
import { loadWindowGeoms, saveWindowGeoms, type WindowGeom } from "@/lib/window-store";
import { recordRecentMap } from "@/lib/recent-maps";

import { AiChatPanel } from "@/components/ai-chat-panel";
import { FrameworkChip } from "@/components/framework-chip";
import { FrameworkPeekTrigger } from "@/components/framework-peek-pill";
import { canQuickConnect, getQuickTargetHandleId, QuickConnectLine } from "@/components/quick-connect-line";
import { IconTip } from "@/components/icon-tip";
import { SubprocessInspectorCard } from "@/components/subprocess-inspector-card";
import { SubprocessUsageTab } from "@/components/subprocess-usage-tab";
import { MapOwnershipSection } from "@/components/map-ownership-section";
import { ApproverManager } from "@/components/approver-manager";
import { CanvasZoomScale } from "@/components/canvas-zoom-scale";
import { MinimapFade } from "@/components/minimap-viewport-fill";
import { NodeActionBar } from "@/components/node-action-bar";
import { UrlLabelField } from "@/components/url-label-field";
import { FallbackHint } from "@/components/fallback-hint";
import { formatGmp, getGmpBadgeStyle } from "@/lib/gmp";
import { GmpPickerPopup, getGmpTargetColor } from "@/components/gmp-picker-popup";
import { GmpNoticePopover } from "@/components/gmp-notice-popover";
import { IoPeersMenu, type IoPeerItem } from "@/components/io-peers-menu";
import { NodeDetailsCard } from "@/components/node-details-card";
import { NewlineHint } from "@/components/newline-hint";
import { NodeDisplaySection } from "@/components/node-display-section";
import { NodeMetricsCard } from "@/components/node-metrics-card";
import { LinkPreviewPanel } from "@/components/link-preview-panel";
import { NodeSelectionRing } from "@/components/node-selection-ring";
import { MapNameDropdown } from "@/components/map-name-dropdown";
import { VersionPill } from "@/components/version-pill";
import { CommentSection } from "@/components/comment-section";
import { ContextMenu, EdgeSidesPad, type ContextMenuItem } from "@/components/context-menu";
import { BranchGlyph } from "@/components/branch-icon";
import { EdgeBranchModal } from "@/components/edge-branch-modal";
import { EdgeActionModal } from "@/components/edge-action-modal";
import { EdgeSelectModal } from "@/components/edge-select-modal";
import { IoImportModal } from "@/components/io-import-modal";
import { ExcelExportModal, type ExcelExportFormat } from "@/components/excel-export-modal";
import { EdgeDecisionModal } from "@/components/edge-decision-modal";
import { EdgeLabelEditor } from "@/components/edge-label-editor";
import { EDITOR_EDGE_TYPES } from "@/components/multiline-edge";
import { FlowConflictModal } from "@/components/flow-conflict-modal";
import { EditorLeftSidebar } from "@/components/editor-left-sidebar";
import { EditorToolbar } from "@/components/editor-toolbar";
import { NodeSearch } from "@/components/node-search";
import { InspectorPanel } from "@/components/inspector-panel";
import { SubprocessRegistrationCta } from "@/components/subprocess-registration-cta";
import { SubprocessVersionPicker } from "@/components/subprocess-version-picker";
import { BpmAttributePicker } from "@/components/bpm-attribute-picker";
import { MapInspectorTab } from "@/components/map-inspector-tab";
import { ApprovalPanel } from "@/components/approval-panel";
import { FrameworkConfirmSection } from "@/components/framework-confirm-section";
import { FrameworkL5Explorer } from "@/components/framework-l5-explorer";
import { StatusBadge } from "@/components/status-badge";
import { PendingApprovalsPanel } from "@/components/permissions/pending-approvals-panel";
import { SelfPublishPopover } from "@/components/self-publish-popover";
import { Tooltip } from "@/components/tooltip";
import { formatVersionMarker } from "@/lib/version-name";
import { isSoleSelfApprover, runSelfPublishChain } from "@/lib/self-publish";
import { MapDetailCard } from "@/components/maps/map-detail-card";
import { ProcessLibraryPanel } from "@/components/process-library-panel";
import type { PeekAddPayload } from "@/components/subprocess-preview-peek";
import { ChangeSummarySection } from "@/components/change-summary-section";
import { FrameworkConnectDialog } from "@/components/framework-connect-dialog";
import { makeOptimisticRef } from "@/lib/framework-connect";
import { FrameworkTreePicker } from "@/components/framework-tree-picker";
import { SectionPanel } from "@/components/section-panel";
import { WordCreateModal } from "@/components/word-create-modal";
import { GroupBox } from "@/components/group-box";
import { ConfirmDialog, type ConfirmLine } from "@/components/confirm-dialog";
import { PromptDialog } from "@/components/prompt-dialog";
import { TransferCheckoutDialog } from "@/components/version/transfer-checkout-dialog";
import { SubmitConfirmDialog } from "@/components/version/submit-confirm-dialog";
import { ApproveConfirmDialog } from "@/components/version/approve-confirm-dialog";
import { findLatestRejection, findLatestSubmitComment, findPublishedAt } from "@/components/version/requester-comment-banner";
import { VersionSwitchConfirm } from "@/components/version/version-switch-confirm";
import { PublishConfirmDialog } from "@/components/version/publish-confirm-dialog";
import { WithdrawConfirmDialog } from "@/components/version/withdraw-confirm-dialog";
import { RejectDialog } from "@/components/version/reject-dialog";
import { buildBundledVisibilityLines } from "@/components/version/approver-status-lines";
import { VisibilityBundlePicker } from "@/components/visibility-bundle-picker";
import { GroupBulkModal, type BulkAttrField, type PeopleUpdate } from "@/components/group-bulk-modal";
import { GroupTitleBar } from "@/components/group-title-bar";
import { NodeSummaryModal } from "@/components/node-summary-modal";
import {
  MapTitleChecklist,
  getSaveCheckStates,
  getMultiOutputNodeIds,
  type SaveCheckItem,
} from "@/components/save-checklist";
import { ProcessNode, resolveNodeStroke } from "@/components/process-node";
import { ScopePreview } from "@/components/scope-preview";
import { ToastStack, type ToastItem } from "@/components/toast-stack";
import { WindowDock } from "@/components/window-dock";
import { CsvImportSection } from "@/components/csv-import-section";
import { CsvImportTab } from "@/components/csv-import-tab";
import { ModalBackdrop } from "@/components/modal-backdrop";
import {
  alignSelected,
  buildNodeData,
  buildOutline,
  distributeSelected,
  layoutWithDagre,
  layoutSubsetWithDagre,
  makeUniqueLabel,
  nodeSizeOf,
  normalizeNodeType,
  resolveCollision,
  getIncomingEdges,
  getOutgoingEdges,
  getNextNodeAlongFlow,
  getPrevNodeAlongFlow,
  getFlowPathForward,
  getFlowPathBackward,
  hasReciprocalEdge,
  removeOutgoingEdges,
  insertNodeBefore,
  insertNodeAfter,
  swapNodeEdges,
  withSubprocessHandles,
  pickDropZone,
  DROPZONE_HIT_OUTER_PAD,
  rectWithExclusions,
  branchKindOf,
  canSwapTypes,
  isCopyableNodeType,
  makeCopyLabel,
  sideFromHandleId,
  sourceHandleId,
  targetHandleId,
  violatesTerminalRule,
  BRANCH_YES_LABEL,
  BRANCH_NO_LABEL,
  EDGE_DEFAULTS,
  getEdgeDefaults,
  getNewEdgeLineStyle,
  setNewEdgeLineStyle,
  estimateNodeHeight,
  estimateNodeWidth,
  hasBpmAttributes,
  NODE_HEIGHT,
  NODE_TYPE_OPTIONS,
  NODE_WIDTH,
  type AppNode,
  type BranchKind,
  type DropZone,
  type HandleSide,
  COLOR_PRESETS,
  getExternalL5Color,
  type NodeData,
  type OutlineEdge,
  type OutlineNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import { buildPaste, readClipboard, writeClipboard } from "@/lib/node-clipboard";
import {
  acquireCheckout,
  ApiError,
  approveVersion,
  createComment,
  createSpDesignationRequest,
  createVersion,
  decideCheckoutRequest,
  deleteComment,
  deleteVersion,
  getApiErrorDetail,
  getDirectory,
  getEligibleAssignees,
  getFullGraph,
  getGraph,
  getMap,
  getMapEditors,
  getMe,
  getResolvedGraph,
  getSubprocessUsage,
  getWorkflowState,
  openLinkageMap,
  listComments,
  listLibraryProcesses,
  markWordDocGenerated,
  publishVersion,
  rejectVersion,
  renameVersion,
  republishVersion,
  requestCheckout,
  withdrawCheckoutRequest,
  saveGraph,
  setWordDoc,
  submitVersion,
  transferCheckout,
  updateComment,
  withdrawVersion,
  type AiNode,
  type AiNodeAttributes,
  type AiProposal,
  type CheckoutState,
  type CommentItem,
  type DirectoryUser,
  type EdgeLineStyle,
  type EligibleAssignees,
  type FlatNode,
  type Graph,
  type GraphEdge,
  type GraphGroup,
  type GraphNode,
  type LibraryProcess,
  type MapSummary,
  type SubprocessRef,
  type SubprocessUsage,
  type VersionGraph,
  type VersionDetail,
  type VersionSummary,
  type WorkflowState,
} from "@/lib/api";
import { humanizeApiError, PERMISSION_PENDING_DETAIL_PREFIX } from "@/lib/api-errors";
import { exportCanvasPng } from "@/lib/export";
import { exportCanvasWord } from "@/lib/word-export";
import { getStaleSectionNodeIds } from "@/lib/word-map-home";
import type { SectionEntry } from "@/lib/word-import";
import { buildExcelModel } from "@/lib/excel-export";
import { buildWbsModel } from "@/lib/excel-wbs";
import { buildCsvFromGraph } from "@/lib/csv-export";
import { formatKst } from "@/lib/datetime";
import { constrainToAxis } from "@/lib/drag-constrain";
import { autoLayoutFlow, type FlowDir } from "@/lib/flow-layout";
import { matchesQuery } from "@/lib/hangul";
import { genId } from "@/lib/id";
import {
  applyIoImport,
  buildIoIndex,
  buildIoMirrorIndex,
  collectIoImportCandidates,
  computeIoLinkHighlight,
  getBrokenInputMirrorIndexes,
  getFlowPathBetween,
  getIoLinkPeers,
  propagateIoLinks,
  type IoImportAction,
  type IoSide,
} from "@/lib/io-items";
import { displayToSavedX, type ShiftStep } from "@/lib/inline-shift";
import { buildHeightSteps, buildYOffsets } from "@/lib/height-shift";
import { mergeSubprocessDescription } from "@/lib/subprocess-description";
import { useI18n } from "@/lib/i18n";
import { useClosingKeys } from "@/lib/use-closing-keys";
import { EXPANSION_LIMITS } from "@/lib/expansion-config";
import { buildGatewayEdges, checkExpansionLimits } from "@/lib/inline-expand";
import { buildCompositeTree, deriveSubEnds, PRIMARY_END_HANDLE, type SubEnd } from "@/lib/subprocess-embed";
import {
  NodeActionsContext,
  type IoListDisplayState,
  type NodeDisplayToggle,
  parseDisplayToggles,
} from "@/lib/node-actions";
import { driftedAssignees, parseAssignees } from "@/lib/assignee";
import { buildBulkAttrPatch } from "@/lib/bulk-params";
import { buildGraphFromAiProposal, type CsvImportOutcome, withKeptNodes } from "@/lib/csv-import";
import { normalizeDuration, normalizeNumericParam, stripThousands } from "@/lib/duration";
import {
  coerceAiNewNodeType,
  dropConflictingCurrency,
  formatParamValue,
  getEditableParamFields,
  getInheritedParams,
  isSpParamField,
  readAttrsCollapsed,
  resolveAiParamPatch,
  resolveAiTextPatch,
  writeAttrsCollapsed,
  type ParamField,
} from "@/lib/params";

// 모듈 스코프 — 안정적 식별자 유지 (React Flow 권장)
const nodeTypes: NodeTypes = { process: ProcessNode };

const DWELL_MS = 300; // 노드 위에 머무는 시간이 이만큼 넘으면 드롭 영역(앞/그룹/뒤) 표시
const DROP_GAP = 24; // 삽입 시 A를 B 좌/우로 떨어뜨리는 간격
const GROUP_PAD = 16; // 그룹 박스가 멤버 bounding box를 감싸는 여백
const GROUP_TITLE_GAP = 26; // 박스 상단에 타이틀바를 얹을 추가 여백 — 멤버 노드와 제목 겹침 방지
const EXTENT_MARGIN = 600; // 우/하단 패닝·노드 여백 — 콘텐츠 성장 여유
const EXTENT_TOPLEFT_MARGIN = 120; // 좌/상단 여백 — 작게(좌상단 고정: 위/왼쪽으로 콘텐츠가 가운데로 밀리지 않게)
const MIN_ZOOM = 0.2; // 최소 줌 — translateExtent 우하단 확장(pane/MIN_ZOOM)이 이 값과 일치해야 줌아웃 centering 방지
// Word 산출물 도형 크기 — 전 노드·분기 통일(사용자 요구: 1.5cm×3cm). 캔버스 px 기준(word-export layout이 ×9525로 EMU 변환).
// 3cm≈113.4px(가로) · 1.5cm≈56.7px(세로). 정확 수치·엣지 라우팅은 시각 검토로 튜닝 예정(design §7, F1 수동 확인).
const WORD_SHAPE_W = 1080000 / 9525; // 3cm(너비) 정확값 — ×9525(EMU_PER_PX)=1,080,000 EMU
const WORD_SHAPE_H = 540000 / 9525; // 1.5cm(높이) — 540,000 EMU
// Word 산출물 1페이지 가용영역(A4·여백 2.5cm 제외 = word-export PAGE_*_EMU) − 내보내기 패딩(2×20px).
// 캔버스에 이 크기의 경계를 그려, 노드가 이 안이면 산출물이 1페이지에 들어감을 알린다(크기 감각).
const WORD_PAGE_W_PX = 5760720 / 9525 - 40; // ≈ 565px
const WORD_PAGE_H_PX = 8892540 / 9525 - 40; // ≈ 894px
// 엣지 라벨(분기 Yes/No/기타 등) — 디자인 토큰으로 알약 스타일(서피스 배경 + hairline 테두리 + ink 텍스트)
const EDGE_LABEL_STYLE = { fill: "var(--color-ink)", fontWeight: 600, fontSize: 11 };
const EDGE_LABEL_BG_STYLE = { fill: "var(--color-surface)", stroke: "var(--color-hairline)" };
const EDGE_LABEL_BG_PADDING: [number, number] = [6, 3];
const INLINE_GATEWAY_OPACITY = 0.55; // 인라인 펼침 게이트웨이(A→Start, End→후속) — 연결을 또렷이
// 불러오기 실행 결과별 안내 토스트 — 어떤 소유권 판정이 났는지 알려준다 (io-linking §2)
const IMPORT_TOAST_KEY = {
  mirror: "io.importedMirror",
  takeover: "io.importedTakeover",
  succession: "io.importedSuccession",
  join: "io.importedJoin",
} as const satisfies Record<IoImportAction, string>;
// 이 키가 패치에 하나라도 있으면 원본 수정일 수 있어 미러 전파를 돌린다 (io-linking §5)
const IO_PATCH_FIELDS = [
  "input", "output", "input_forms", "output_forms", "output_ids", "input_links", "output_links",
] as const satisfies readonly (keyof NodeData)[];

function hasIoPatchField(patch: Partial<NodeData>): boolean {
  return IO_PATCH_FIELDS.some((field) => field in patch);
}

const REGION_PAD = 28; // 하위 영역 안쪽 좌우 여백
const REGION_GAP = 48; // A↔영역, 영역↔우측 노드 간격
const REGION_MARGIN = 48; // 영역 세로 레인이 콘텐츠 위아래로 더 뻗는 여백
const REGION_CROSSING_OPACITY = 0.35; // 영역을 가로지르는 엣지 반투명
const INACTIVE_SCOPE_OPACITY = 0.4; // 포커스 모드 — 비활성(인라인 자식) 스코프 노드/엣지 dim. 활성 스코프만 또렷·편집
const ZONE_RADIUS_PAD = 32; // 링 반경 = max(노드 변) + 이 값 — 부채꼴 배치 반경(오버레이 렌더·hit-test 공용)
const ZONE_TILE_H = 58; // 링을 시야로 끌어오는 패닝 여유(ensureRingVisible) 계산용
const AI_WINDOW_KEY = "ai"; // windowGeom 맵에서 AI 플로팅 창 기하 키 (스코프 키와 충돌 없음)

type ScreenRect = { left: number; top: number; width: number; height: number; radius: number };

// 색 프리셋 — 첫 항목(빈 값)은 타입 기본색. 세련된 무채도(muted) 8톤 stroke(데이터/출력 예외).
// 노드 타입별 사용 가능 색 세트 (#8) — 첫 항목 ""=타입 기본색.
// 메인 6 · start/end 3 · 분기(decision) 4. 헥스는 인스펙터에서 아이콘→입력으로 별도 지정.
const NODE_COLORS = ["", "#6e84a3", "#5e988f", "#84a07c", "#c7a062", "#c58a6b"]; // 6
const TERMINAL_COLORS = ["", "#5e988f", "#c58a6b"]; // 3 (start/end)
const DECISION_COLORS = ["", "#c7a062", "#9183c0", "#c2849a"]; // 4 (decision)

function colorsForType(nodeType: string | undefined): string[] {
  // subprocess는 단일색(타입 기본 = 바이올렛 톤) 고정 — 색 변경 불가 (spec 2026-07-06 §9)
  if (nodeType === "subprocess") return [""];
  if (nodeType === "start" || nodeType === "end") return TERMINAL_COLORS;
  if (nodeType === "decision") return DECISION_COLORS;
  return NODE_COLORS;
}

// 그룹 전용 팔레트 — 노드보다 깊은 "존/라벨" 톤(노드 색과 분리해 묶음 영역을 구분)
const GROUP_COLOR_PRESETS = [
  "#4a5a8c", // indigo
  "#3f7d72", // pine
  "#5c7a4e", // moss
  "#a87b3e", // bronze
  "#a65d3e", // sienna
  "#8c5a72", // plum
  "#6e5aa0", // iris
  "#5f6068", // graphite
];

// 캔버스 우클릭 메뉴 노드 타입별 아이콘 — add-node-menu SHAPES와 동일 매핑(도형 일관)
const NODE_TYPE_ICONS: Record<string, LucideIcon> = {
  process: Square,
  decision: Diamond,
  start: Circle,
  end: CircleDot,
};


const HISTORY_LIMIT = 50; // 스코프당 undo 스냅샷 상한 — 메모리/실용 균형
const TEXT_HISTORY_GAP_MS = 2000; // 타이핑은 이 간격 안에서 한 번의 undo 단위로 묶음
const AUTO_SAVE_DELAY_MS = 2000; // 마지막 변경 후 자동 저장까지의 디바운스
const CHECKOUT_POLL_MS = 10_000; // 점유 상태 재조회 주기(요청 승인/이전 반영). sticky라 TTL 연장 아님
const COMMENT_POLL_MS = 5_000; // 코멘트 "실시간" 폴링 주기 (spec §7 Phase C)

const SEARCH_RESULT_LIMIT = 20; // 검색 드롭다운 최대 표시 수

// 스코프 = 편집 가능한 루트(평면 그래프) 또는 읽기전용 딥뷰(드릴인한 하위프로세스의 링크맵).
// hostId는 합성 트리에서 그 임베드 자식들의 parent_node_id이므로 currentParentId 앵커로 그대로 쓰인다.
type Scope =
  | { kind: "root"; title: string }
  | {
      kind: "sub";
      hostId: string;
      mapId: number;
      pinned: number | null;
      followLatest: boolean;
      title: string;
    };
// 스코프의 렌더 앵커 id — 루트=null, 딥뷰=호스트 id(합성 트리 자식의 parent_node_id).
const scopeHostId = (scope: Scope): string | null =>
  scope.kind === "sub" ? scope.hostId : null;

// 합성 트리의 호스트(하위프로세스) FlatNode → 읽기전용 딥뷰 스코프. 링크 메타는 host 노드에 실려 있다.
const flatToSubScope = (flat: FlatNode): Scope => ({
  kind: "sub",
  hostId: flat.id,
  mapId: flat.linked_map_id ?? 0,
  pinned: flat.linked_version_id,
  followLatest: flat.follow_latest,
  title: flat.title,
});
type SearchResult = { node: FlatNode; path: string; scopes: Scope[] };
type Snapshot = { nodes: AppNode[]; edges: Edge[]; groups: GraphGroup[] };
type SaveState = "idle" | "saving" | "saved" | "error";
// 읽기 전용 배너 — 사유별 톤/아이콘/타이틀(굵게)+설명. 시인성: 사유마다 다른 색·아이콘으로 즉시 구분.
type EditorNoticeTone = "warn" | "accent" | "neutral";
interface EditorNotice {
  tone: EditorNoticeTone;
  icon: LucideIcon;
  title: string;
  desc: string;
}
const NOTICE_TONE_CLASS: Record<EditorNoticeTone, string> = {
  warn: "border-notice-border bg-notice text-changed", // 타인 점유·결재 중·승인 완료(대기)
  accent: "border-accent-tint-border bg-accent-tint text-accent", // 게시본(정상 운영 상태)
  neutral: "border-hairline bg-surface-alt text-ink-secondary", // 뷰어·만료 이력
};
// 인라인 펼침 하위 영역 박스 — 깊이 틴트 배경 렌더용(flow 좌표 절대배치)
type RegionBox = {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

// 드래그 비활성 시 dragLiveById 기본값 — 매 렌더 새 Map 생성을 막아 displayNodes memo가 불필요 재계산되지 않게.
const EMPTY_DRAG_LIVE: ReadonlyMap<string, { x: number; y: number }> = new Map();
// Ctrl+드래그 비활성 시 ctrlDragIds 기본값 — 매 렌더 새 Set 생성을 막아 nodeActions memo가 불필요 재계산되지 않게.
const EMPTY_CTRL_DRAG_IDS: ReadonlySet<string> = new Set();

// 인라인 펼침 영역 — 콘텐츠 Y범위로 상하좌우 경계를 잡은 반투명 틴트 박스. 모든 영역이 동일 y/height라
// 중첩 시 바깥이 안을 항상 덮는다(box.y/height는 buildScope가 전체 콘텐츠 기준으로 산정).
// ViewportPortal(flow 좌표계) 안이라 box.x/y/width/height를 그대로 사용 — 별도 뷰포트 구독 불필요.
// 틴트는 pointer-events:none 유지 — 호버/우클릭은 pane 이벤트에서 좌표 히트테스트로 판정해 내려온다(hoverId).
function InlineRegionBands({
  regions,
  baseDepth,
  hoverId,
  frameworks,
  onTitleMenu,
  onOpenMap,
}: {
  regions: RegionBox[];
  baseDepth: number; // 현재 스코프의 절대깊이 — 셰브론을 절대깊이(루트 기준)로 표시해 포커스 레인과 통일
  // pane 히트테스트가 판정한 최상단(바깥) 영역 id — 해당 박스만 틴트/보더 강조
  hoverId: string | null;
  // hostId → 링크맵의 업무체계 소속(지정 링크맵 한정) — 라벨 옆 5단계 전체 경로 + 클릭 시 체계 피크
  frameworks: ReadonlyMap<string, { categoryId: number; path: string; linkedMapId: number }>;
  // 헤더의 맵 이름 클릭 — 바로 접지 않고 그 영역 기준 메뉴를 연다(오조작 방지, 사용자 요청 2026-08-31)
  onTitleMenu: (event: React.MouseEvent, hostId: string, label: string) => void;
  // 레인 헤더의 "링크맵 열기" — hostId(RegionBox.id)로 링크 대상 맵을 해석해 이동 확인 모달을 띄움 (F6)
  onOpenMap: (hostId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {regions.map((box) => {
        const hovered = hoverId === box.id;
        const framework = frameworks.get(box.id);
        return (
          <Fragment key={`region:${box.id}`}>
            {/* 상하좌우 경계 박스 + 반투명 틴트 — 깊을수록 틴트가 겹쳐 진해짐. 노드 뒤(z<0), 비상호작용 */}
            <div
              data-id={`region-band-${box.id}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${box.x}px, ${box.y}px)`,
                width: box.width,
                height: box.height,
                zIndex: -1,
                pointerEvents: "none",
                borderRadius: 12,
                background: `color-mix(in srgb, var(--color-accent) ${hovered ? 9 : 5}%, transparent)`,
                border: `1.5px solid color-mix(in srgb, var(--color-accent) ${hovered ? 55 : 35}%, transparent)`,
                transition: "background 150ms, border-color 150ms",
              }}
            />
            {/* 깊이 표시(›×depth) + 이름 + 열기 + 업무체계 — 콘텐츠 상단 근처. 서피스 필로 틴트/도트 위 가독 확보 */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${box.x + 6}px, ${box.y + 4}px)`,
                zIndex: 1,
              }}
            >
              <div className="pointer-events-auto inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface/85 px-0.5 py-0.5 shadow-sm backdrop-blur-[2px]">
                {/* 맵 이름 — 클릭하면 이 영역 기준 메뉴(이동·접기). 바로 접히면 실수로 다 닫히는 사고가 난다.
                    캔버스(pane)로 새는 클릭/우클릭은 여기서 끊는다 — 바깥 영역이 대신 처리하지 않도록. */}
                <button
                  type="button"
                  data-id={`region-title-${box.id}`}
                  className="group inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-caption transition-colors hover:bg-accent-tint"
                  title={t("region.titleMenu")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTitleMenu(event, box.id, box.label);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    onTitleMenu(event, box.id, box.label);
                  }}
                >
                  <span className="font-semibold tracking-tight text-accent">
                    {"›".repeat(baseDepth + box.depth)}
                  </span>
                  <span className="font-semibold text-ink underline-offset-2 transition-colors group-hover:text-accent group-hover:underline">
                    {box.label || t("node.childBadge")}
                  </span>
                </button>
                {/* 링크맵 열기 — 아이콘 버튼, 클릭 시 미저장 경고 확인 모달 (F6) */}
                <button
                  type="button"
                  data-id="region-open-map"
                  className="rounded-xs p-1 text-accent transition-colors hover:bg-accent-tint"
                  title={t("subprocess.openMap")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMap(box.id);
                  }}
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                </button>
                {/* 업무체계 소속 — 5단계 전체 경로, 클릭 시 체계 드릴인 피크(FrameworkChip 재활용) */}
                {framework && (
                  <FrameworkPeekTrigger
                    dataId={`region-framework-${box.id}`}
                    categoryId={framework.categoryId}
                    linkedMapId={framework.linkedMapId}
                    title={framework.path}
                    className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-xs border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine text-ink-secondary transition-colors hover:bg-accent-tint hover:text-accent"
                  >
                    <FolderTree size={11} strokeWidth={1.5} className="shrink-0" />
                    <span>{framework.path}</span>
                  </FrameworkPeekTrigger>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

// 포커스 스코프의 "레인" — 활성 스코프 좌우 세로 경계선 + 그 사이만 깊이 틴트(바깥은 부모/깊이0 바탕).
// 별도 컴포넌트(useViewport 구독)라 줌/팬 시 이 부분만 리렌더. 화면 전체 높이로 뻗는다.
function FocusScopeBands({
  left,
  right,
  top,
  depth,
  label,
}: {
  left: number;
  right: number;
  top: number;
  depth: number;
  label: string;
}) {
  const { t } = useI18n();
  const { y, zoom } = useViewport();
  const paneHeight = useStore((state) => state.height);
  const topFlow = -y / zoom;
  const bandHeight = paneHeight / zoom;
  return (
    <>
      {/* 레인 틴트(세로선 사이만) + 좌우 세로선 — 인라인 펼침(InlineRegionBands)과 동일: flat 5%, 중첩되면 겹쳐 진해짐. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${left}px, ${topFlow}px)`,
          width: right - left,
          height: bandHeight,
          background: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
          borderLeft: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          borderRight: "1.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          zIndex: -1,
          pointerEvents: "none",
        }}
      />
      {/* 깊이 표시(›×절대깊이) + 이름 — 인라인 펼침과 동일 언어. 첫 노드 위(top-26)에 띄워 노드와 겹치지 않게. 비상호작용 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${left + 6}px, ${top - 26}px)`,
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <span className="inline-flex items-center gap-1 rounded-xs px-1 py-0.5 text-fine">
          <span className="font-semibold tracking-tight text-accent">{"›".repeat(depth)}</span>
          <span className="text-ink-secondary">{label || t("node.childBadge")}</span>
        </span>
      </div>
    </>
  );
}
type MenuState = {
  x: number;
  y: number;
  kind: "pane" | "node" | "edge" | "group" | "selection" | "region";
  targetId: string | null;
  /** region 메뉴 헤더에 띄울 링크맵 이름 — 중첩 펼침(A>B>C)에서 어느 맵이 대상인지 못 박는다. */
  regionLabel?: string;
  /** 영역 헤더(맵 이름)를 눌러 연 메뉴 — 이름을 이미 클릭했으므로 헤더 항목은 생략. */
  viaTitle?: boolean;
};

// 링크맵 임베드 캐시 키 — 맵 + (최신 추종 | 핀 버전). null=비하위프로세스. 같은 맵/버전 임베드는 캐시 공유.
function linkKey(n: {
  linked_map_id: number | null;
  follow_latest: boolean;
  linked_version_id: number | null;
}): string | null {
  return n.linked_map_id == null
    ? null
    : `${n.linked_map_id}:${n.follow_latest ? "latest" : (n.linked_version_id ?? "latest")}`;
}

function toAppNodes(graph: Graph, scopeId: string | null = null): AppNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "process",
    position: { x: node.pos_x, y: node.pos_y },
    data: {
      label: node.title,
      description: node.description,
      nodeType: normalizeNodeType(node.node_type),
      color: node.color,
      assignee: node.assignee,
      department: node.department,
      system: node.system,
      duration: node.duration,
      cost_krw: node.cost_krw ?? "",
      cost_usd: node.cost_usd ?? "",
      headcount: node.headcount ?? "",
      annual_count: node.annual_count ?? "",
      fte: node.fte ?? "",
      touch_time: node.touch_time ?? "",
      input: node.input ?? "",
      output: node.output ?? "",
      input_forms: node.input_forms ?? "",
      output_forms: node.output_forms ?? "",
      output_ids: node.output_ids ?? "",
      input_links: node.input_links ?? "",
      output_links: node.output_links ?? "",
      input_flags: node.input_flags ?? "",
      start_condition: node.start_condition ?? "",
      end_condition: node.end_condition ?? "",
      data_form: node.data_form ?? "",
      system_fallback: node.system_fallback ?? "",
      gmp: node.gmp ?? "",
      url: node.url ?? "",
      urlLabel: node.url_label ?? "",
      section_anchor: node.section_anchor ?? "",
      groupIds: node.group_ids ?? [],
      hasChildren: node.has_children ?? false,
      scopeId,
      linkedMapId: node.linked_map_id,
      followLatest: node.follow_latest,
      linkedVersionId: node.linked_version_id,
      placeholderCategoryId: node.placeholder_category_id ?? null,
      placeholderCategoryPath: node.placeholder_category_path ?? null,
      nodeWidth: node.width ?? null,
      isPrimaryEnd: node.is_primary_end,
    },
  }));
}

// 그룹 태그 추가(중복 제거) — 다중 태그 멤버십
function addTags(existing: string[], add: string[]): string[] {
  const set = new Set(existing);
  for (const id of add) {
    set.add(id);
  }
  return Array.from(set);
}

// 렌더 type ↔ 저장 line_style 정규화 — ""(레거시)·비정상 값은 기본 꺾은선
function normalizeEdgeLineStyle(value: string | undefined): EdgeLineStyle {
  return value === "default" || value === "straight" ? value : "smoothstep";
}

// 선 모양 옵션 — 인스펙터(엣지/맵 탭)·엣지 컨텍스트 메뉴 3표면 공용
const EDGE_LINE_STYLE_OPTIONS = [
  { value: "default", labelKey: "edgeStyle.curve", icon: Spline },
  { value: "smoothstep", labelKey: "edgeStyle.step", icon: CornerDownRight },
  { value: "straight", labelKey: "edgeStyle.straight", icon: Slash },
] as const;

function toAppEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    ...EDGE_DEFAULTS,
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
    // 백엔드가 raw handle id를 보내면 우선 사용(subprocess end 핸들); 없으면 side에서 파생
    sourceHandle: edge.source_handle ?? sourceHandleId((edge.source_side as HandleSide) || "right"),
    targetHandle: edge.target_handle ?? targetHandleId((edge.target_side as HandleSide) || "left"),
    // 엣지별 저장 선 모양 — ""(레거시)는 기본 꺾은선
    type: normalizeEdgeLineStyle(edge.line_style),
  }));
}



// AI 노드 → GraphNode (graph 생성·ops add 공용). 미제공 attributes는 빈값 (D1)
// 신규 노드라 보호할 기존 SP 지정값이 없다 — SP 게이트는 미적용(csv-import mergeNode의
// existing===null 분기와 동일 전제). 통화 배타는 신규 여부와 무관해 그대로 적용.
function aiNodeToGraphNode(node: AiNode, id: string, groupId: string | undefined): GraphNode {
  const attr = node.attributes;
  const num = (raw: string | null | undefined) => normalizeNumericParam(stripThousands(raw ?? "")) ?? "";
  const { values: cost } = dropConflictingCurrency({ cost_krw: num(attr?.cost_krw), cost_usd: num(attr?.cost_usd) });
  return {
    id,
    title: node.title,
    description: node.description,
    // 링크 없는 subprocess는 process로 강등 — 링크가 실린 subprocess(P2 유사 SP 수락)만
    // 실제 Call Activity로 생성 (csv-import buildGraphFromAiProposal과 대칭)
    node_type:
      node.node_type === "subprocess" && node.linked_map_id
        ? "subprocess"
        : coerceAiNewNodeType(node.node_type),
    color: attr?.color ?? "",
    assignee: attr?.assignee ?? "",
    department: attr?.department ?? "",
    system: attr?.system ?? "",
    // 무효 duration은 ""로 — 프리뷰가 저장 결과(백엔드 소거)와 일치하게 (csv-import와 동일 규칙)
    duration: normalizeDuration(attr?.duration ?? "") ?? "",
    cost_krw: cost.cost_krw ?? "",
    cost_usd: cost.cost_usd ?? "",
    headcount: num(attr?.headcount),
    annual_count: num(attr?.annual_count),
    fte: num(attr?.fte),
    // 무효 touch_time도 duration과 동일하게 "" (design 2026-08-19 §2)
    touch_time: normalizeDuration(attr?.touch_time ?? "") ?? "",
    // 인터뷰 승격 텍스트 필드 — passthrough (csv-import buildGraphFromAiProposal과 대칭)
    input: attr?.input ?? "",
    output: attr?.output ?? "",
    input_forms: "",  // 항목별 폼 — AI 표면 제외, 매칭 노드는 mergeNode가 보존 (2026-08-20)
    output_forms: "",
    // IO 링크 — AI 표면 제외, 매칭 노드는 mergeNode가 보존 (io-linking §3)
    output_ids: "",
    input_links: "",
    output_links: "",
    input_flags: "",
    start_condition: attr?.start_condition ?? "",
    end_condition: attr?.end_condition ?? "",
    data_form: attr?.data_form ?? "",
    system_fallback: "",  // 폴백은 AI 표면 제외 — 신규 노드는 빈 값 (design 2026-08-19 §3)
    gmp: "",  // 검토값 — AI 표면 제외 (design 2026-08-20)
    // 링크 — 재생성 시 모델이 에코한 url 보존 (ai_prompt 계약 규칙 ⑦)
    url: attr?.url ?? "",
    url_label: attr?.url_label ?? "",
    // 문서 섹션 앵커 — word 맵 제안 스레딩(AI 변환 2곳 대칭 — csv-import buildGraphFromAiProposal과 동일)
    section_anchor: attr?.section_anchor ?? "",
    pos_x: 0,
    pos_y: 0,
    sort_order: 0,
    group_ids: groupId ? [groupId] : [],
    linked_map_id: node.node_type === "subprocess" ? node.linked_map_id ?? null : null,
    follow_latest: true,
    linked_version_id: null,
    is_primary_end: false,
  };
}


function buildGraph(nodes: AppNode[], edges: Edge[], groups: GraphGroup[]): Graph {
  // 자기완결적 payload 보장 — 백엔드 검증(엣지·group 참조) 422 방지
  const nodeIds = new Set(nodes.map((node) => node.id));
  // 어느 노드든 태그로 가진 그룹만 보존(빈 그룹 제거)
  const referencedGroupIds = new Set<string>();
  for (const node of nodes) {
    for (const gid of node.data.groupIds) {
      referencedGroupIds.add(gid);
    }
  }
  const keptGroups = groups.filter((group) => referencedGroupIds.has(group.id));
  const groupIds = new Set(keptGroups.map((group) => group.id));
  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      title: node.data.label,
      description: node.data.description,
      node_type: node.data.nodeType,
      color: node.data.color,
      assignee: node.data.assignee,
      department: node.data.department,
      system: node.data.system,
      duration: node.data.duration,
      cost_krw: node.data.cost_krw ?? "",
      cost_usd: node.data.cost_usd ?? "",
      headcount: node.data.headcount ?? "",
      annual_count: node.data.annual_count ?? "",
      fte: node.data.fte ?? "",
      touch_time: node.data.touch_time ?? "",
      input: node.data.input ?? "",
      output: node.data.output ?? "",
      input_forms: node.data.input_forms ?? "",
      output_forms: node.data.output_forms ?? "",
      output_ids: node.data.output_ids ?? "",
      input_links: node.data.input_links ?? "",
      output_links: node.data.output_links ?? "",
      input_flags: node.data.input_flags ?? "",
      start_condition: node.data.start_condition ?? "",
      end_condition: node.data.end_condition ?? "",
      data_form: node.data.data_form ?? "",
      system_fallback: node.data.system_fallback ?? "",
      gmp: node.data.gmp ?? "",
      url: node.data.url ?? "",
      url_label: node.data.urlLabel ?? "",
      section_anchor: node.data.section_anchor ?? "",
      pos_x: node.position.x,
      pos_y: node.position.y,
      sort_order: index,
      // 보존된 그룹만 남김(고아 태그 제거)
      group_ids: node.data.groupIds.filter((gid) => groupIds.has(gid)),
      linked_map_id: node.data.linkedMapId ?? null,
      follow_latest: node.data.followLatest ?? false,
      linked_version_id: node.data.linkedVersionId ?? null,
      // 미직렬화 시 저장마다 서버 소거 — 왕복 필수 (design 2026-08-28 §10.1)
      placeholder_category_id: node.data.placeholderCategoryId ?? null,
      width: node.data.nodeWidth ?? null,
      is_primary_end: node.data.isPrimaryEnd ?? false,
    })),
    // 양 끝이 모두 payload 노드인 엣지만 — 누락 노드 참조 제거
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map<GraphEdge>((edge) => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        label: typeof edge.label === "string" ? edge.label : "",
        source_side: sideFromHandleId(edge.sourceHandle, "right"),
        target_side: sideFromHandleId(edge.targetHandle, "left"),
        source_handle: edge.sourceHandle ?? null,
        target_handle: edge.targetHandle ?? null,
        line_style: normalizeEdgeLineStyle(edge.type),
      })),
    groups: keptGroups.map((group) => ({
      id: group.id,
      // 평면 다중 태그 모델 — 중첩(parent_group_id) 미사용
      parent_group_id: null,
      label: group.label,
      color: group.color,
    })),
  };
}

function MapEditor({ mapId }: { mapId: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const [mapName, setMapName] = useState("");
  // getMap 상세만 넣으므로 VersionDetail — 승인 모달의 제출 코멘트가 events를 읽는다.
  const [versions, setVersions] = useState<VersionDetail[]>([]);
  // 승인 트랜지션 시 bump — 하단 버전 기록(MapDetailCard) 재조회 트리거 / bump to refresh version record.
  const [versionsReloadKey, setVersionsReloadKey] = useState(0);
  const [versionId, setVersionId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([{ kind: "root", title: "홈" }]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowGeom, setWindowGeom] = useState<Record<string, WindowGeom>>({});
  const [zOrder, setZOrder] = useState<string[]>([]);
  const [bounds, setBounds] = useState({ w: 960, h: 640 });
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([]);
  // 펼친 자식 노드 — 메인 nodes(현재 스코프)와 분리해 둔다. React Flow가 측정·이벤트를 라우팅하도록 displayNodes에 포함하되,
  // nodes를 오염시키지 않아 아웃라인·저장·라우팅 등 기존 가정이 깨지지 않는다(회귀 0). scopeId = 펼친 부모 id.
  const [childNodes, setChildNodes] = useState<AppNode[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // 새 맵 온보딩 — 시드 Start/End만 있는 빈 맵에서 AI 컨설턴트 안내, **맵별 1회** (2026-07-30).
  // 전역 키였을 땐 컨설턴트를 한 번이라도 쓰면(Start/Dismiss/메뉴 진입) 이후 새 맵 전부에서
  // 영구 비노출됐다 — 새 맵마다 안내하는 의도와 어긋나 맵 단위 키로 전환.
  const consultOnboardKey = `bpm.consultOnboardSeen.${mapId}`;
  const [consultOnboardSeen, setConsultOnboardSeen] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.localStorage.getItem(consultOnboardKey) === "1",
  );
  function dismissConsultOnboard() {
    window.localStorage.setItem(consultOnboardKey, "1");
    setConsultOnboardSeen(true);
  }
  // AI 메뉴 — 챗·컨설턴트 진입을 버튼 하나로 통합(상단바 다이어트, 2026-07-30)
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const aiMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aiMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(event.target as Node)) {
        setAiMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAiMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [aiMenuOpen]);
  const [groups, setGroups] = useState<GraphGroup[]>([]);
  // 방금 생성된 그룹 id — 해당 GroupTitleBar가 마운트 시 이름 편집모드로 진입하도록 신호
  const [newGroupId, setNewGroupId] = useState<string | null>(null);
  // 루트 버전의 평면 그래프(getFullGraph) — 합성 트리(fullGraph)의 뿌리. 백엔드는 parent_node_id를 안 보내므로 null 취급.
  const [rootGraph, setRootGraph] = useState<VersionGraph | null>(null);
  // 링크맵 resolved 그래프 캐시 — linkKey(맵+버전)별. 임베드 자식·subEnds 소스. resolved는 버전당 불변이라 무효화 없음.
  const [resolvedCache, setResolvedCache] = useState<Map<string, Graph>>(new Map());
  // 잠긴 링크맵 키 집합 — resolved 응답 body가 locked:true면 기록(캐시엔 안 넣음). 펼침/드릴 봉인·Lock 뱃지의 단일 소스.
  // Locked linked-map keys — recorded when a resolved response body has locked:true (not cached). Single source for sealing expand/drill + Lock badge.
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(new Set());
  const lockedKeysRef = useRef<Set<string>>(new Set());
  // 라이브러리 프로세스 목록 — 버전 업데이트 뱃지·팔로우-최신 UI에 사용
  const [libraryList, setLibraryList] = useState<LibraryProcess[]>([]);
  const inFlightRef = useRef<Set<string>>(new Set());
  const [expandedOutline, setExpandedOutline] = useState<Set<string>>(new Set());
  // 캔버스 인라인 펼친 노드 id 집합 — 아웃라인용 expandedOutline과 분리. 스코프/버전 전환 시 초기화.
  const [expandedInline, setExpandedInline] = useState<Set<string>>(new Set());
  // 펼침 한도 초과 시 확인 모달 — next=적용 대기 집합
  const [capPrompt, setCapPrompt] = useState<{
    next: Set<string>;
    nodeCount: number;
    depth: number;
  } | null>(null);
  // 펼침/접힘 직후 잠깐 true — 노드 transform 전환(슬라이드 애니메이션) CSS 클래스 토글용
  const [expandAnimating, setExpandAnimating] = useState(false);
  // 사용자 펼침/접힘 — 전환(transition)은 "전환이 정의된 상태"가 먼저 칠해진 뒤 값이 바뀌어야 발동한다.
  // 따라서 애니메이션 클래스를 먼저 켜고(렌더1) 다음 프레임에 위치(expandedInline)를 바꿔(렌더2) 슬라이드시킨다.
  const commitExpanded = useCallback(
    (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
      setExpandAnimating(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setExpandedInline(next));
      });
    },
    [],
  );
  // 좌측 사이드바 접힘 / 우측 인스펙터 열림·폭(로컬 영속, 220~480 clamp)
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Word 맵 전용 — 섹션 패널 열림 + 맵의 문서 모드/카탈로그(임포트 시 채워짐, design 2026-07-18)
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [wordReimportOpen, setWordReimportOpen] = useState(false);
  const [mapMode, setMapMode] = useState<string>("normal");
  // 승인요청 모달의 가시성 동봉 옵션이 반대값을 계산하려면 현재 가시성이 필요 — getMap 로드 시 채움.
  const [mapVisibility, setMapVisibility] = useState<"public" | "private">("private");
  const [docName, setDocName] = useState<string>("");
  const [docSections, setDocSections] = useState<SectionEntry[]>([]);
  const completeDocPickerRef = useRef<HTMLInputElement>(null); // 완결 문서 생성 — 원본 .docx 재선택 파일 입력
  const isWordMap = mapMode === "word";
  // L5 연계 캔버스 — subprocess-only 팔레트·라이브 draft 우선·트리 피커 (design 2026-08-28)
  const isFrameworkMap = mapMode === "framework";
  // L5 캔버스 배경 — 기본 차콜("L5 화면" 즉시 인지 + 파스텔 노드 대비), 우상단 L5 태그로 토글.
  // 서버·클라 첫 렌더 모두 charcoal로 결정적 — 저장값 복원은 마운트 후 effect (hydration mismatch 방지)
  const [l5CanvasBg, setL5CanvasBg] = useState<"charcoal" | "light">("charcoal");
  useEffect(() => {
    if (window.localStorage.getItem("bpm.l5CanvasBg") === "light") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
      setL5CanvasBg("light");
    }
  }, []);
  const l5Charcoal = isFrameworkMap && l5CanvasBg === "charcoal";
  // 영속은 핸들러에서 — StrictMode에서 persist effect가 초기값으로 되덮는 문제 회피 (lessons: react-ts-patterns)
  const toggleL5CanvasBg = () => {
    const next = l5CanvasBg === "charcoal" ? "light" : "charcoal";
    window.localStorage.setItem("bpm.l5CanvasBg", next);
    setL5CanvasBg(next);
  };
  const [frameworkPickerOpen, setFrameworkPickerOpen] = useState(false);
  // stale 앵커 — 재임포트 후 카탈로그에서 사라진 앵커를 참조하는 섹션 노드 (design 2026-07-24 §5)
  const staleAnchorIds = useMemo(() => {
    if (!isWordMap) return new Set<string>();
    return getStaleSectionNodeIds(
      nodes.map((n) => ({
        id: n.id,
        nodeType: n.data.nodeType,
        sectionAnchor: n.data.section_anchor,
      })),
      docSections,
    );
  }, [isWordMap, nodes, docSections]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // 서버·클라이언트 첫 렌더 모두 320으로 결정적 — localStorage 복원은 마운트 후 effect에서 (hydration mismatch 방지)
  const [inspectorWidth, setInspectorWidth] = useState(360);
  // 링크 미리보기 패널 — non-null이면 열림. 액션 바 "링크 열기"가 세팅 (Task 3에서 패널 연결)
  const [linkPreviewUrl, setLinkPreviewUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // F14 플로우 경로 하이라이트 길이 — anchor가 현재 선택과 다르면 reach=0 (선택 바뀌면 초기화, effect 없이 파생).
  const [flow, setFlow] = useState<{ anchor: string | null; reach: number }>({
    anchor: null,
    reach: 0,
  });
  const flowReach = flow.anchor === selectedId ? flow.reach : 0;
  // 더블클릭으로 캔버스 가운데 인라인 편집 박스를 띄울 엣지 — 인스펙터 라벨 입력과 동시 표시
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  // 편집 박스 위치(엣지 중점, canvasContainerRef 기준) — 이벤트 시점에 계산해 둠(렌더 중 ref 접근 금지)
  const [editingEdgePos, setEditingEdgePos] = useState<{ left: number; top: number } | null>(null);
  // 판단 노드에서 분기(Yes/No/기타) 라벨을 기다리는 대상.
  // connection: 핸들 드래그(엣지 미생성, 선택 시 생성) / edge: 노드 드롭으로 이미 생성된 엣지에 라벨 부여
  const [branchPrompt, setBranchPrompt] = useState<
    | { kind: "connection"; connection: Connection; at: { x: number; y: number } }
    // 노드 드롭 삽입이 마름모에서 나가는 엣지를 만들 때 — 분기 선택 전엔 삽입을 적용하지 않고 보류.
    // 픽 시 nextEdges(라벨 부여)로 삽입 적용, 취소 시 미적용(엣지가 먼저 생기지 않게).
    | { kind: "pendingInsert"; nextEdges: Edge[]; freshId: string; at: { x: number; y: number } }
    | null
  >(null);
  // 출력 1개 충돌 시 삽입/교체/취소 모달 — source의 기존 출력이 있을 때 새 target 연결을 어떻게 할지.
  const [edgeAction, setEdgeAction] = useState<
    { source: string; target: string; at: { x: number; y: number } } | null
  >(null);
  // 다중 출력 노드에 삽입 시 — 어느 출력선으로 들어갈지 선택 (F1). source 출력선 중 1개 픽.
  const [edgeSelect, setEdgeSelect] = useState<
    | {
        source: string;
        target: string;
        options: { edgeId: string; branchKind: BranchKind; edgeLabel: string; targetLabel: string }[];
        at: { x: number; y: number };
      }
    | null
  >(null);
  // decision↔일반 스왑 시 — 일반 노드가 가져갈 decision 출력선 선택. 픽 시점에 위치·연결
  // 교환을 일괄 적용(취소=무변경). aStart: 드래그 시작 좌표 — onNodeDragStop이 handleZoneDrop
  // 직후 dragStartPosRef를 비우므로 모달을 열 때 캡처해 둔다.
  const [swapSelect, setSwapSelect] = useState<
    | {
        aId: string;
        bId: string;
        options: { edgeId: string; branchKind: BranchKind; edgeLabel: string; targetLabel: string }[];
        at: { x: number; y: number };
        aStart: { x: number; y: number } | null;
      }
    | null
  >(null);
  // 출력선 선택 모달에서 행 hover 중인 엣지 — 캔버스의 해당 엣지를 하이라이트(styledEdges).
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  // IO 링크 hover 하이라이트 — 인스펙터 행 hover와 불러오기 모달 행 hover가 공유하는 단일 상태 (io-linking §4-6)
  const [ioHighlight, setIoHighlight] = useState<{ nodeIds: string[]; edgeIds: string[] } | null>(null);
  // 안내 버튼 호버 미리보기 — 노드에 결과값(분류·색) 임시 반영, 렌더 전용(데이터 무변경) (#6 확장)
  const [gmpPreview, setGmpPreview] = useState<{ nodeId: string; gmp: string; color: string } | null>(null);
  // 열려 있는 불러오기 모달 — 어느 노드의 어느 쪽 IO를 채우는지 + 앵커 좌표
  const [ioImport, setIoImport] = useState<
    { side: IoSide; nodeId: string; at: { x: number; y: number } } | null
  >(null);
  // 디시전 노드에 노드 드롭(출력 ≥1) → 분기/인터셉트/취소 선택 (F1). options=B의 기존 출력선.
  const [decisionDrop, setDecisionDrop] = useState<
    | {
        aId: string;
        bId: string;
        options: { edgeId: string; branchKind: BranchKind; edgeLabel: string; targetLabel: string }[];
        at: { x: number; y: number };
      }
    | null
  >(null);
  // 마지막 포인터 화면 좌표 — 모달을 마우스 위치에 띄워 동선 최소화.
  const pointerScreenRef = useRef({ x: 0, y: 0 });
  const [summaryNodeId, setSummaryNodeId] = useState<string | null>(null);
  // 노드 더블클릭 → 인스펙터 속성 탭 강제 전환 신호(논스) — 읽기전용/편집 공통 (사용자 요청 2026-08-25)
  const [propertiesTabNonce, setPropertiesTabNonce] = useState(0);
  // 편집 모달 자동 포커스 대상 — 인스펙터 설명 더블클릭/편집 아이콘 진입 시 "description" (2026-08-20)
  const [summaryFocus, setSummaryFocus] = useState<"description" | null>(null);
  // 인라인 이름 편집 중인 노드 — 더블클릭으로 진입, NodeActionsContext로 ProcessNode에 전달
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // 인스펙터 hex 입력 토글 — 기본 숨김(아이콘), 필요 시에만 펼침 (#8)
  const [showHexInput, setShowHexInput] = useState(false);
  // Parameters 그룹 접기 — 기본 접힘, 인스펙터/요약모달 공유 키로 localStorage 퍼시스트
  const [bulkEditGroupId, setBulkEditGroupId] = useState<string | null>(null);
  // 토스트 스택 — 새 항목은 위에 쌓이고(prepend) 각자 슬라이드 아웃 후 자동 제거
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const removeToast = useCallback((id: string) => {
    setToasts((cur) => cur.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((message: string, tone?: "error") => {
    setToasts((cur) => [{ id: genId(), message, tone }, ...cur]);
  }, []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // BPM attributes 접힘 — 기본 접힘, 수행 지표·입출력 조건 카드와 동일 패턴(전역 선호, 노드 무관)
  const [attrsCollapsed, setAttrsCollapsed] = useState(readAttrsCollapsed);
  const [status, setStatus] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // 저장 실패 상세 — 상단 배너로 노출, 다음 저장 성공까지 유지
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 검색 결과로 스코프 이동 후 포커스할 노드 — 스코프 로드 완료 시 소비
  const focusNodeIdRef = useRef<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  // 언마운트/버전 전환 시 해제 여부 판단용 — 상태와 달리 cleanup에서 즉시 읽힘
  const checkoutMineRef = useRef(false);
  // CSV 임포트(이름 기준 머지) — 모달·파싱 결과 (design 2026-07-06)
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvOutcome, setCsvOutcome] = useState<CsvImportOutcome | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  // CSV 임포트 프리뷰 — 소멸 노드를 삭제할지 유지할지. 기본 삭제(CSV가 정본).
  const [csvKeepRemoved, setCsvKeepRemoved] = useState(false);
  // Excel 내보내기 형식 선택 모달(Process Map/WBS 토글) — design 2026-07-17-excel-export-wbs-v2
  const [excelExportOpen, setExcelExportOpen] = useState(false);
  // 신원·워크플로우 상태 (spec §workflow 2026-06-14)
  const [username, setUsername] = useState<string | null>(null);
  const [mapOwner, setMapOwner] = useState<string | null>(null);
  // PNG 정보 카드·프레임워크 칩 소스 — getMap 상세에서 채움 (2026-08-25)
  const [mapOwnerName, setMapOwnerName] = useState<string | null>(null);
  const [mapOwningDept, setMapOwningDept] = useState<string | null>(null);
  const [mapCategoryId, setMapCategoryId] = useState<number | null>(null);
  const [mapCategoryPath, setMapCategoryPath] = useState<string | null>(null);
  // 캔버스 전용 — 결착 카테고리(칩 소스·자동 보강 호출) + 뷰어 미반영 L6 수 (design 2026-08-28)
  const [linkageCategoryId, setLinkageCategoryId] = useState<number | null>(null);
  const [linkageCategoryPath, setLinkageCategoryPath] = useState<string | null>(null);
  const [reconcileMissing, setReconcileMissing] = useState(0);
  // SP 역참조(지정 메타+이 맵을 링크한 맵 목록) — designated일 때만 Subprocess 탭이 나타난다
  const [spUsage, setSpUsage] = useState<SubprocessUsage | null>(null);
  const [spUsageReload, setSpUsageReload] = useState(0);
  useEffect(() => {
    let active = true;
    void getSubprocessUsage(mapId)
      .then((usage) => {
        if (active) setSpUsage(usage);
      })
      .catch(() => {
        // 조회 실패 시 탭만 미노출(에디터 다른 기능에 영향 없음)
      });
    return () => {
      active = false;
    };
  }, [mapId, spUsageReload]);
  // 서버 산정 역할 — 뷰어(my_role) 판정 단일 소스 / server-computed role for viewer gating
  const [myRole, setMyRole] = useState<"viewer" | "editor" | "owner" | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [managingApprovers, setManagingApprovers] = useState(false);
  // 점유권 이전 다이얼로그 / Transfer checkout dialog
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEditors, setTransferEditors] = useState<DirectoryUser[]>([]);
  const [transferTarget, setTransferTarget] = useState<string>("");
  // 재게시 확인 다이얼로그 / Republish confirm dialog
  const [republishConfirmOpen, setRepublishConfirmOpen] = useState(false);
  // 승인 요청 확인 다이얼로그 — 승인자 목록 확인 후 제출 / Submit confirm listing approvers.
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  // 승인요청/셀프게시에 동봉할 가시성 변경 선택(VisibilityBundlePicker) — null이면 미동봉.
  const [bundleValue, setBundleValue] = useState<"public" | "private" | null>(null);
  // 셀프 게시 팝오버 — 승인자가 본인 1인일 때 승인요청 클릭 지점에 표시 / Self-publish prompt at click point.
  const [selfPublishPrompt, setSelfPublishPrompt] = useState<{ x: number; y: number } | null>(null);
  // 승인/게시/회수/거절 확인 다이얼로그 — 전이 액션 통일 모달 / transition confirm modals.
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // 4종 전이 모달(submit/approve/publish/withdraw) 공용 코멘트 입력 — 동시에 하나만 열리므로 상태 1개로 공유.
  const [transitionComment, setTransitionComment] = useState("");
  // 승인 탭 하단 결재 대기 섹션 pending 개수 — summary 카운트 필용 (R8)
  const [editorApprovalsCount, setEditorApprovalsCount] = useState(0);
  // login_id → 표시 이름 캐시 (점유자 이름 표시용) / name resolution cache for checkout holder display
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());

  // AI 채팅 패널 상태
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInitialSessionId, setAiInitialSessionId] = useState<number | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  // 편집용 매뉴얼 사이트 주소(.env MANUAL_URL) — 비어 있으면 툴바 버튼 숨김 (F9)
  const [manualUrl, setManualUrl] = useState("");
  // CSV 임포트 안내 문서 주소(.env CSV_MANUAL_URL) — 편집 매뉴얼과 별개, 비면 버튼 숨김
  const [csvManualUrl, setCsvManualUrl] = useState("");
  // BPM 시스템 관리자 여부 — 활성 점유 강제 인수(force checkout)는 sysadmin만 노출
  const [isSysadmin, setIsSysadmin] = useState(false);
  // 담당자 후보 목록 — 버전별 로드. 드리프트 경고 계산용(읽기전용에서도 로드).
  const [eligible, setEligible] = useState<EligibleAssignees | null>(null);
  // 미리보기 — AI 제안과 CSV 임포트가 공유. null이 아니면 자동저장이 꺼진다(Apply 전 영속화 방지).
  const [previewSource, setPreviewSource] = useState<"ai" | "csv" | null>(null);
  // previewSource와 항상 동기화되는 소스 유니온 — 하나의 undo 스냅샷/자동저장 억제 슬롯을 두 기능이 공유하므로
  // 서로 중첩되면 승인 전 그래프가 자동저장될 수 있다. 슬롯은 배타적으로만 점유한다.
  const previewRef = useRef<"ai" | "csv" | null>(null);
  // Import 탭 라벨용 원산지 — 프리뷰 상태 슬롯(previewSource="csv")은 CSV/AI graph가 공유한다
  const [importOrigin, setImportOrigin] = useState<"csv" | "ai" | null>(null);
  // 최소화 시 플로팅 스파클 버튼 위치(캔버스 좌표) — 화면 어디든 드래그
  const [aiMinPos, setAiMinPos] = useState({ x: 16, y: 16 });
  const aiMinDragRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(
    null,
  );
  // AI 헤더 — 답변 키워드 자동 타이틀(수동 편집 시 고정) + 채팅 폰트 상대 배율
  const [aiTitle, setAiTitle] = useState("");
  const [aiTitleEditing, setAiTitleEditing] = useState(false);
  const [aiTitleManual, setAiTitleManual] = useState(false);
  const [aiFontScale, setAiFontScale] = useState(1);
  // 새 대화 트리거 — 패널이 등록하고 창 헤더 버튼이 호출
  const aiNewChatRef = useRef<(() => void) | null>(null);
  const handleAutoTitle = useCallback(
    (title: string) => {
      if (!aiTitleManual) setAiTitle(title);
    },
    [aiTitleManual],
  );
  // 딥링크 소비 콜백 — 패널 세션 목록 effect deps에 들어가므로 인라인 화살표(렌더마다 새 identity) 금지: refetch 스톰 방지
  const handleAiInitialConsumed = useCallback(() => setAiInitialSessionId(null), []);

  // 새 엣지 선 모양 기본값 — 마지막 "전체 일괄 변경" 선택(맵별 localStorage). 개별 엣지의 모양은 edge.type→line_style로 서버 영속.
  const [edgeStyle, setEdgeStyle] = useState<EdgeLineStyle>("smoothstep");
  // 전체 일괄 변경 확인 모달 — 선택한 목표 스타일(null=닫힘)
  const [bulkEdgeStyle, setBulkEdgeStyle] = useState<EdgeLineStyle | null>(null);

  // 드래그-오버 드롭 영역 (Phase 1: 앞/뒤 흐름 삽입). rect는 활성 시점에 계산해 저장(렌더 중 ref 접근 회피).
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    zone: DropZone | null;
    rect: ScreenRect;
    // 시작/끝 규칙 위반으로 비활성화된 흐름존 — 활성 시점에 계산(렌더 중 ref 접근 회피)
    frontBlocked: boolean;
    backBlocked: boolean;
    // 다른 종류 노드라 비활성화된 스왑존(subprocess↔process 예외 외)
    swapBlocked: boolean;
  } | null>(null);
  // 드래그 노드가 기존 그룹 박스 빈 영역 위에 머무는 중 — 합류 대상 그룹 id(펄스 강조)
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const groupDropTargetRef = useRef<string | null>(null);
  const dwellRef = useRef<{ id: string; since: number } | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 현재 드래그 중인 노드 id — 드롭존 흐름 규칙(시작/끝) 판정에 드래그 노드 타입이 필요
  const draggedNodeIdRef = useRef<string | null>(null);
  // 드래그 시작 시점의 노드 위치 — 위치 교환(swap) 시 드래그 노드의 원래 자리 복원용
  const dragStartPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  // Shift 축 고정용 — 현재 제스처로 함께 움직이는 모든 노드의 시작 표시좌표(단일 드래그=1개, 다중선택 드래그
  // 시 onNodeDragStart 세 번째 인자(nodes)로 전원 채움 — RF는 노드를 직접 잡아 끌 때도 선택된 나머지를 같은
  // 콜백으로 보고하고 onSelectionDrag는 안 씀). onNodeDragStop에서 비운다.
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Shift 드래그 축 고정용 — 드래그 중에만 참조하므로 입력창 포커스 중 추적돼도 무방.
  const shiftHeldRef = useRef(false);
  // Ctrl/⌘+드래그 복제 모드 — 활성 여부(잔상·+배지 렌더 게이팅)와 복사 가능 노드의 시작 위치·data(잔상 데이터).
  const [ctrlDragActive, setCtrlDragActive] = useState(false);
  const [ctrlDragGhosts, setCtrlDragGhosts] = useState<
    { id: string; position: { x: number; y: number }; data: NodeData }[]
  >([]);
  // mousedown 직전(RF 선택 변경 전)의 선택 노드 id 집합 — Ctrl+드래그가 "의도된 선택 드래그"인지 "엉뚱한
  // 미선택 노드 새로 잡음"인지 판별용. RF의 multiSelectionKeyCode(기본 Ctrl/⌘)가 이 기능 트리거 키와 겹쳐,
  // 잡은 노드가 잔여 선택에 딸려 들어가는 걸 막는다(capture-phase pointerdown이 RF 선택 변경보다 먼저 스냅샷).
  const preMousedownSelectedRef = useRef<ReadonlySet<string>>(new Set());
  // Ctrl+드래그 사본 확정 1회 래치 — RF는 다중선택 드래그에서 onNodeDragStop·onSelectionDragStop을 둘 다
  // 발화하는데, 둘 다 applyCtrlDragCopy를 부르면 같은 stale nodesRef를 읽어 사본이 2×N개 append된다(백엔드 저장까지).
  // beginCtrlDrag에서 false로 리셋, applyCtrlDragCopy 진입 시 true로 세워 제스처당 정확히 한 번만 실행.
  const ctrlDragConsumedRef = useRef(false);
  // 연속 Ctrl+V 누적 오프셋 — 같은 클립보드 내용(pasteClipSigRef와 서명 일치)이면 seq를 증가시켜
  // 대각선으로 계속 밀어내고(handlePaste), 새로 복사하거나 다른 클립보드가 들어오면 1로 리셋.
  const pasteSeqRef = useRef(0);
  const pasteClipSigRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftHeldRef.current = e.shiftKey;
      // 드래그 중 Ctrl/⌘을 놓으면 일반 이동으로 취급 — 잔상·배지 즉시 해제(드롭 시 onNodeDragStop이
      // ctrlDragActive=false를 보고 사본 생성을 건너뜀).
      if (!(e.ctrlKey || e.metaKey)) {
        setCtrlDragActive((cur) => (cur ? false : cur));
        setCtrlDragGhosts((cur) => (cur.length > 0 ? [] : cur));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);
  // 펼침 중 루트 드래그: 드래그 중인 노드별 라이브 표시좌표(커서 1:1 추종). 드래그 중에만 항목 존재.
  // state로 둬야 displayNodes가 매 프레임 재렌더돼 커서를 따라온다(ref면 안 됨).
  const [dragLiveById, setDragLiveById] = useState<ReadonlyMap<string, { x: number; y: number }>>(
    EMPTY_DRAG_LIVE,
  );
  const dragLiveByIdRef = useRef(dragLiveById); // 핸들러에서 stale 없이 최신 라이브 맵 읽기용
  // 드래그 시작 시 캡처한 노드별 (저장좌표, footprint 오프셋, 시작 표시좌표) — 드롭 시 표시→저장 환산 및
  // Shift 축 고정(다중선택, start 필드)에 사용.
  const dragStartOffsetRef = useRef<
    Map<string, { offset: { x: number; y: number }; start: { x: number; y: number } }>
  >(new Map());
  // footprint-shift된 루트 노드의 position write를 nodes state에서 차단할 id 집합. 드래그 시작 시 채우고,
  // 드롭 후 몇 프레임까지 유지한다. RF는 표시좌표(=저장+offset)를 controlled nodes로 받아 드롭 직후 마지막
  // position 변경으로 돌려보내는데, 이게 새면 표시좌표가 저장좌표로 기록돼 재파생에서 또 밀린다(이중쉬프트).
  const suppressPosIdsRef = useRef<Set<string>>(new Set());
  const dragCursorRef = useRef({ x: 0, y: 0 }); // 컨테이너 상대 커서 — 타일 적중 판정용
  // 기존 엣지 충돌 시 유지/삽입 되묻기 팝오버
  const [pending, setPending] = useState<{
    mode: DropZone;
    aId: string;
    bId: string;
    rect: ScreenRect;
  } | null>(null);

  // 현재 버전 객체 — StatusBadge·워크플로우 역할 판정 공용
  const currentVersion = versions.find((v) => v.id === versionId) ?? null;

  // 비편집 상태(pending/approved/published)는 캔버스 읽기 전용 — 잠금과 별개로 status 기준
  const statusLocksEditing =
    currentVersion !== null &&
    currentVersion.status !== "draft" &&
    currentVersion.status !== "rejected";
  // 뷰어 권한 사용자는 항상 읽기 전용 — 서버 산정 my_role 기준 / viewer role is always read-only
  const isViewer = myRole === "viewer";
  // 다른 사용자가 유효한 체크아웃을 쥐고 있으면 읽기 전용 (코멘트 작성은 허용)
  const readOnly = isViewer || (checkout !== null && !checkout.mine) || statusLocksEditing;
  // 읽기 전용 배너 — 사유별 톤/아이콘/타이틀+설명 (우선순위: 뷰어 > 타인 점유 > 버전 상태).
  // 점유자는 디렉터리 표시명으로 해석(이름 우선·id 보조). 상태 타이틀은 한/영 모두 영어 고정.
  const checkoutHolder = checkout !== null && !checkout.mine ? checkout.checked_out_by : null;
  const checkoutHolderName = checkoutHolder ? (nameById.get(checkoutHolder) ?? checkoutHolder) : "";
  const checkoutHolderLabel =
    checkoutHolder && checkoutHolderName !== checkoutHolder
      ? `${checkoutHolderName} (${checkoutHolder})`
      : checkoutHolderName;
  const readOnlyNotice: EditorNotice | null = !readOnly
    ? null
    : isViewer
      ? {
          tone: "neutral",
          icon: Eye,
          title: t("editor.readonly.viewerTitle"),
          desc: t("editor.readonly.viewerDesc"),
        }
      : checkoutHolder !== null
        ? {
            tone: "warn",
            icon: PencilLine,
            title: t("editor.readonly.checkoutTitle", { name: checkoutHolderLabel }),
            desc: t("editor.readonly.checkoutDesc"),
          }
        : currentVersion?.status === "published"
          ? {
              tone: "accent",
              icon: BadgeCheck,
              title: t("editor.readonly.publishedTitle"),
              desc: t("editor.readonly.publishedDesc"),
            }
          : currentVersion?.status === "expired"
            ? {
                tone: "neutral",
                icon: Archive,
                title: t("editor.readonly.expiredTitle"),
                desc: t("editor.readonly.expiredDesc"),
              }
            : currentVersion?.status === "approved"
              ? {
                  tone: "warn",
                  icon: CircleCheck,
                  title: t("editor.readonly.approvedTitle"),
                  desc: t("editor.readonly.approvedDesc"),
                }
              : {
                  tone: "warn",
                  icon: Hourglass,
                  title: t("editor.readonly.pendingTitle"),
                  desc: t("editor.readonly.pendingDesc"),
                };
  // 역할 판정 — render 중 파생(useEffect 금지)
  // 소유자 미상(created_by=null, seed/legacy 맵)은 백엔드가 누구에게나 승인자 관리를 허용 — 그 규칙과 정합
  const isMapOwner = username !== null && (mapOwner === null || username === mapOwner);
  // 서브프로세스 지정 관리 — 게시된 버전이 열린 상태 + 오너/관리자(sysadmin)만 (인스펙터 카드 버튼)
  const spCanManage = currentVersion?.status === "published" && (isMapOwner || isSysadmin);
  const spDisabledReason = spCanManage
    ? null
    : currentVersion?.status !== "published"
      ? t("inspector.spNeedPublishedOpen")
      : t("inspector.spOwnerOnly");
  // disabledReason과 동일 분기의 구분값 — 카드가 문자열 비교 없이 사유별 액션(게시본 가기/등록 요청)을 분기 (R10)
  const spDisabledReasonKind: "needPublished" | "ownerOnly" | null = spCanManage
    ? null
    : currentVersion?.status !== "published"
      ? "needPublished"
      : "ownerOnly";
  const isApprover = username !== null && (workflow?.approvers ?? []).includes(username);
  const isSubmitter = username !== null && currentVersion?.submitted_by === username;
  // 회수 — 승인요청 단계(pending/approved)는 제출자만, 반려(rejected)는 +오너·sysadmin(백엔드 게이트와 일치).
  const canWithdraw =
    isSubmitter || (currentVersion?.status === "rejected" && (myRole === "owner" || isSysadmin));
  const hasApproved = username !== null && (workflow?.approvals ?? []).includes(username);
  // 승인 진행 중 — 어떤 버전이든 pending/approved면 승인자 목록 변경 금지(tally 깨짐 방지, 백엔드 409와 일치).
  const approvalInFlight = versions.some(
    (v) => v.status === "pending" || v.status === "approved",
  );
  // 전이 모달 공용 서브타이틀 — 어떤 버전인지(마커+라벨). 삭제 모달의 맵이름 자리와 동일 역할.
  const versionSubtitle = currentVersion
    ? `${formatVersionMarker(currentVersion, versions)} · ${currentVersion.label}`
    : undefined;
  // 회수 모달 핸드오프용 제출자 — 회수 대상은 제출 시 체크아웃이 해제돼 보유자가 늘 없으므로 제출자를 노출.
  const withdrawSubmitter = currentVersion?.submitted_by ?? null;
  // 가시성 동봉은 오너 전용(서버 403) — VisibilityBundlePicker 자체를 비오너에겐 전달하지 않는다.
  const canBundleVisibility = myRole === "owner";
  // 점유권 매트릭스 파생 / checkout role matrix
  const isHolder =
    !!username &&
    workflow?.checkout_holder === username &&
    currentVersion?.status === "draft";
  const isEditorRole = myRole === "owner" || myRole === "editor" || isSysadmin;
  const hasDraft = versions.some((v) => v.status === "draft");

  const reactFlow = useReactFlow();
  // 캔버스 컨테이너 픽셀 크기(리사이즈 시에만 변경 — 줌/팬엔 불변) — translateExtent 우하단 확장 계산용
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const currentScope = scopes[Math.min(activeIndex, scopes.length - 1)];
  // 현재 스코프가 딥뷰(하위프로세스 링크맵)면 읽기전용 — 편집/저장 경로를 모두 차단.
  const currentScopeIsReadOnly = currentScope?.kind === "sub";
  // 렌더 머신(inlineComposition/ancestorContextNodes/breadcrumb)이 읽는 단일 앵커.
  // 딥뷰면 hostId(=합성 트리 자식의 parent_node_id), 루트면 null. 매핑이 전부이고 새 변수를 스레드하지 않는다.
  const currentParentId = currentScope?.kind === "sub" ? currentScope.hostId : null;

  const scopeKey = (scope: Scope) => scopeHostId(scope) ?? "root";

  // 이벤트 핸들러/타이머에서 최신 상태를 읽기 위한 미러 — setState 클로저 stale 방지
  const nodesRef = useRef<AppNode[]>([]);
  const childNodesRef = useRef<AppNode[]>([]);
  // height-shift(#1) 스텝 미러 — dropDraggingPositions(정의가 앞선 useCallback)에서 읽기 위한 ref — TDZ 회피.
  const yStepsRef = useRef<ShiftStep[]>([]);
  // 상시(비게이트) 스텝 미러 — 표시 Y는 펼침 중에도 밀리므로(합성 입력에 베이크), 클릭점→저장 변환
  // (toSavedPoint)과 펼침 드롭 Y 환산(finalizeRootDrag)은 이 상시 스텝으로 역변환한다.
  const heightStepsRef = useRef<ShiftStep[]>([]);
  // height-shift(#1) 렌더 오프셋(트윈 중간값) 미러 — findGroupAt·handleExportPng(정의가 앞선 useCallback)에서
  // 읽기 위한 ref — TDZ 회피(renderYOffsets state는 뒤에서 선언). 미러링 useEffect는 state 선언부 옆에 유지.
  const renderYOffsetsRef = useRef<ReadonlyMap<string, number>>(new Map());
  // 드래그 제스처 동결 오프셋 미러 — dropDraggingPositions(정의가 앞선 useCallback)의 선형 역변환용. TDZ 회피.
  const dragYOffsetsRef = useRef<ReadonlyMap<string, number>>(new Map());
  // 펼침 합성(영역/스코프 오프셋/루트 오프셋)을 핸들러(handleAddNode·handleNodesChange 등 정의가 앞선)에서
  // 읽기 위한 ref — TDZ 회피.
  const inlineCompositionRef = useRef<{
    regions: RegionBox[];
    childEdges: Edge[];
    scopeOffsets: Map<string, { x: number; y: number }>;
    rootOffsets: Map<string, { x: number; y: number }>;
    rootShiftSteps: { x: number; footprint: number }[];
  } | null>(null);
  const edgesRef = useRef<Edge[]>([]);
  const groupsRef = useRef<GraphGroup[]>([]);
  const windowGeomRef = useRef<Record<string, WindowGeom>>({});
  // fullGraph가 어떤 버전의 트리인지 기록 — 스코프 전환 시 재요청 게이트용(버전 바뀌면 다시 받음)
  const fullGraphRef = useRef<VersionGraph | null>(null);
  const fullGraphVersionRef = useRef<number | null>(null);
  // toggleInlineExpand는 아래쪽에 정의돼 컨텍스트 메뉴 useMemo(위)에서 직접 못 씀(TDZ) — ref로 호출.
  const toggleInlineExpandRef = useRef<((nodeId: string) => void) | null>(null);
  // 컨텍스트 메뉴(위쪽 menuItems useMemo)에서 이름 편집 호출용 — startRename은 아래에 정의되어 TDZ 회피 필요
  const startRenameRef = useRef<((nodeId: string) => void) | null>(null);
  // 합성 트리에 끼울 호스트 — 인라인 펼침 ∪ 드릴 경로(딥뷰)의 호스트. 딥뷰 스코프의 호스트 자식이
  // 합성 트리에 namespaced id로 존재해야 ancestorContextNodes/딥뷰 로드가 그 체인을 앵커할 수 있다.
  const hostsToEmbed = useMemo(() => {
    const set = new Set(expandedInline);
    for (const scope of scopes) {
      if (scope.kind === "sub") {
        set.add(scope.hostId);
      }
    }
    return set;
  }, [expandedInline, scopes]);
  // 합성 트리 — 루트 평면 그래프 + 펼친/드릴인 하위프로세스의 링크맵 resolved를 합성 parent_node_id 자식으로 끼움.
  // 기존 fullGraph 소비자(materialize·inlineComposition·조상컨텍스트·펼침 한도 등)는 그대로 이 값을 읽는다.
  const fullGraph = useMemo<VersionGraph | null>(() => {
    if (!rootGraph) {
      return null;
    }
    const rootFlat = rootGraph.nodes.map((n) => ({ ...n, parent_node_id: null }));
    const getEmbed = (node: FlatNode): Graph | null => {
      const k = linkKey(node);
      return k ? (resolvedCache.get(k) ?? null) : null;
    };
    return buildCompositeTree(rootFlat, rootGraph.edges, hostsToEmbed, getEmbed);
  }, [rootGraph, hostsToEmbed, resolvedCache]);
  useEffect(() => {
    fullGraphRef.current = fullGraph;
  }, [fullGraph]);
  // 보이는 하위프로세스(루트는 항상, 임베드는 부모 펼침 후)의 resolved를 선로드 → subEnds/핸들이 펼치기 전 채워지고,
  // 캐시가 차면 fullGraph 재계산→다음 레벨 임베드 노드 등장→effect 재실행→그 레벨 로드(중첩 수렴). 캐시/in-flight 가드로 무한루프 방지.
  useEffect(() => {
    if (!fullGraph) {
      return;
    }
    for (const n of fullGraph.nodes) {
      if (n.node_type !== "subprocess" || n.linked_map_id == null) {
        continue;
      }
      const k = linkKey(n);
      if (!k || resolvedCache.has(k) || lockedKeys.has(k) || inFlightRef.current.has(k)) {
        continue;
      }
      inFlightRef.current.add(k);
      void getResolvedGraph(n.linked_map_id, n.follow_latest, n.linked_version_id)
        // 잠금은 status가 아니라 응답 body(g.locked)로 판정 — Task1은 403이 아닌 200+빈 그래프를 반환.
        // Judge lock from the response BODY (g.locked), not status — Task1 returns 200+empty, not 403.
        .then((g) => {
          if (g.locked) {
            // 캐시엔 안 넣음 → getEmbed null → buildCompositeTree가 자식 없는 봉인 호스트 유지.
            setLockedKeys((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
          } else {
            setResolvedCache((prev) => new Map(prev).set(k, g));
          }
        })
        .catch(() => undefined) // 실제 네트워크/5xx만 — 잠금은 위 .then에서 처리
        .finally(() => inFlightRef.current.delete(k));
    }
  }, [fullGraph, resolvedCache, lockedKeys]);
  // map_id → LibraryProcess 룩업 맵 — 업데이트 뱃지 계산용
  const libByMap = useMemo(() => {
    const m = new Map<number, LibraryProcess>();
    for (const row of libraryList) {
      m.set(row.map_id, row);
    }
    return m;
  }, [libraryList]);

  // 낙관 참조 — 드롭·연결 직후 서버 refs 도착 전 외부 L6 스타일 즉시 표시 (2026-08-30 #4)
  const [optimisticRefs, setOptimisticRefs] = useState<Map<number, SubprocessRef>>(new Map());
  // linked_map_id → 지정 정보 — 루트 그래프 + 임베드 resolved의 subprocess_refs 병합(중첩 임베드 커버).
  // 노드에 값을 저장하지 않는 라이브 참조 소스 (spec 2026-07-06).
  const subprocessRefs = useMemo(() => {
    const m = new Map<number, SubprocessRef>();
    const addAll = (refs?: Record<number, SubprocessRef>) => {
      if (!refs) {
        return;
      }
      for (const [refMapId, ref] of Object.entries(refs)) {
        m.set(Number(refMapId), ref);
      }
    };
    // 낙관 참조가 가장 약함 — 서버 refs가 도착하는 즉시 아래 병합이 덮는다 (#4)
    for (const [mid, ref] of optimisticRefs) {
      m.set(mid, ref);
    }
    // resolvedCache는 linkKey별 1회 fetch라 스테일 가능 — 루트 그래프 refs(매 로드/저장 응답 갱신)가 이긴다
    for (const g of resolvedCache.values()) {
      addAll(g.subprocess_refs);
    }
    addAll(rootGraph?.subprocess_refs);
    return m;
  }, [rootGraph, resolvedCache, optimisticRefs]);

  // 하위프로세스 노드에 subEnds + updateAvailable 주입 — 캐시된 링크맵 resolved의 끝 노드들에서 파생. NodeActionBar 펼침 게이트·핸들이 읽음.
  // 미로드면 그대로 둔다(로드되면 재계산되어 펼침 가능). data의 링크 메타로 linkKey를 만들어 캐시 조회.
  const injectSubEnds = useCallback(
    (node: AppNode): AppNode => {
      if (node.data.nodeType !== "subprocess") {
        return node;
      }
      const k = linkKey({
        linked_map_id: node.data.linkedMapId ?? null,
        follow_latest: node.data.followLatest ?? false,
        linked_version_id: node.data.linkedVersionId ?? null,
      });
      // updateAvailable: pinned 버전이 있고 라이브러리에 더 최신 발행본이 있는 경우
      const lib = node.data.linkedMapId != null ? libByMap.get(node.data.linkedMapId) : undefined;
      const updateAvailable =
        !node.data.followLatest &&
        node.data.linkedVersionId != null &&
        lib?.latest_published_version_id != null &&
        lib.latest_published_version_id > node.data.linkedVersionId;
      // 미지정/해제 링크맵 — 경고 뱃지 + 잠금(권한 무관). refs 미수신(undefined) 동안은 미판정 유지 (spec 2026-07-06).
      const ref = node.data.linkedMapId != null ? subprocessRefs.get(node.data.linkedMapId) : undefined;
      const undesignated = ref != null && !ref.designated;
      // 링크맵 현재 이름을 라이브로 표시 — subprocess 라벨은 링크맵 이름 고정(F5)이라 개명이 즉시 반영돼야 한다.
      // display 전용 주입(저장 스냅샷 data.label·게시본 노드는 불변). 삭제 맵(name null)은 저장 라벨로 폴백.
      const liveLabel = ref?.name ? { label: ref.name } : {};
      // 지정 어트리뷰트 라이브 주입 — 지정된 링크맵만. 노드에 저장하지 않고 렌더 시 파생.
      const spAttrs = ref?.designated
        ? {
            spDepartment: ref.department,
            spAssignee: ref.assignee,
            spSystem: ref.system,
            spDuration: ref.duration,
            spCostKrw: ref.cost_krw,
            spCostUsd: ref.cost_usd,
            spHeadcount: ref.headcount,
            spTouchTime: ref.touch_time,
            spInput: ref.input,
            spOutput: ref.output,
            spInputForms: ref.input_forms,
            spOutputForms: ref.output_forms,
            spStartCondition: ref.start_condition,
            spEndCondition: ref.end_condition,
            spGmp: ref.gmp,
            spUrl: ref.url,
            spUrlLabel: ref.url_label,
            // 캔버스 전용 — 링크맵의 현 소속이 이 캔버스의 L5와 다르면 출신 경로 배지(라이브 파생)
            // (design 2026-08-28 §8). 소속 이동·타 L5 가져오기 모두 이 값으로 표현된다.
            spOriginPath:
              isFrameworkMap && ref.category_path && ref.category_path !== linkageCategoryPath
                ? ref.category_path
                : null,
            // 출신 L5 카테고리 id — 출처 배지 클릭 드릴인 피크 소스 (2026-08-30)
            spOriginCategoryId:
              isFrameworkMap &&
              ref.category_id != null &&
              ref.category_path &&
              ref.category_path !== linkageCategoryPath
                ? ref.category_id
                : null,
            // 외부 L6 = 홈 L5별 색(같은 L5=같은 색, display 전용 — 저장값 불변). 8톤 모듈로라
            // L5가 9개+면 색 재사용 가능 (2026-08-28 개선). [0]은 기본색이라 1..8만 사용.
            ...(isFrameworkMap &&
            ref.category_id != null &&
            linkageCategoryId !== null &&
            ref.category_id !== linkageCategoryId
              ? { color: getExternalL5Color(ref.category_id) }
              : {}),
          }
        : {
            spDepartment: null,
            spAssignee: null,
            spSystem: null,
            spDuration: null,
            spCostKrw: null,
            spCostUsd: null,
            spHeadcount: null,
            spTouchTime: null,
            spInput: null,
            spOutput: null,
            spInputForms: null,
            spOutputForms: null,
            spStartCondition: null,
            spEndCondition: null,
            spGmp: null,
            spUrl: null,
            spUrlLabel: null,
            spOriginPath: null,
            spOriginCategoryId: null,
          };
      // 일반 맵 한정 — 링크맵 프레임워크 소속 필(이름 옆 아이콘+3초 호버 피크) 소스 (2026-08-30).
      // 연계 캔버스에선 출신 배지(spOriginPath)가 같은 정보를 담당하므로 제외.
      const frameworkPill = (r: SubprocessRef | undefined) =>
        !isFrameworkMap && r?.designated && r.category_id != null
          ? { spFrameworkCategoryId: r.category_id, spFrameworkPath: r.category_path ?? null }
          : { spFrameworkCategoryId: null, spFrameworkPath: null };
      // 잠긴 링크맵은 봉인 박스 — subEnds 없이 locked만 주입(state로 읽어 뱃지 재렌더). 모든 렌더 경로가 이 transform을 통과.
      if (k != null && lockedKeys.has(k)) {
        return { ...node, data: { ...node.data, locked: true, undesignated, spLinkDeleted: ref?.deleted === true, ...frameworkPill(ref), ...spAttrs, ...liveLabel, updateAvailable } };
      }
      const resolved = k ? resolvedCache.get(k) : undefined;
      if (!resolved) {
        return { ...node, data: { ...node.data, undesignated, spLinkDeleted: ref?.deleted === true, ...frameworkPill(ref), ...spAttrs, ...liveLabel, updateAvailable } };
      }
      return {
        ...node,
        data: {
          ...node.data,
          subEnds: deriveSubEnds(resolved),
          undesignated,
          spLinkDeleted: ref?.deleted === true,
          ...frameworkPill(ref),
          ...spAttrs,
          ...liveLabel,
          updateAvailable,
        },
      };
    },
    [resolvedCache, libByMap, lockedKeys, subprocessRefs, isFrameworkMap, linkageCategoryPath, linkageCategoryId],
  );
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    childNodesRef.current = childNodes;
  }, [childNodes]);
  // lockedKeys ref 미러 — canExpand(deps []) 콜백이 stale 없이 최신 잠금 집합을 읽도록.
  useEffect(() => {
    lockedKeysRef.current = lockedKeys;
  }, [lockedKeys]);
  // saveCurrentScope(useCallback)가 stale 클로저 없이 읽기전용 여부를 읽도록 ref 미러 — dep 추가 회피.
  // readOnly ref 미러 — 디바운스 타이머가 예약 시점 클로저를 잡으므로, 발사 순간의 최신 권한으로
  // 다시 판정해야 한다. myRole/checkout 도착 전엔 readOnly가 false로 시작해, 그 창에 예약된 저장이
  // 뷰어 권한으로 확정된 뒤에도 옛 클로저로 PUT을 던져 403이 난다.
  const readOnlyRef = useRef<boolean>(false);
  const currentScopeIsReadOnlyRef = useRef<boolean>(false);
  useEffect(() => {
    currentScopeIsReadOnlyRef.current = currentScopeIsReadOnly;
  }, [currentScopeIsReadOnly]);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  // 펼친 노드의 자식을 childNodes로 materialize한다(React Flow 측정·이벤트용). 부모가 접히면 제거.
  // 스코프/버전 전환 시 expandedInline이 비워지면 자동으로 모두 제거됨. 표시는 displayNodes가 buildScope 파생 위치로 합성.
  useEffect(() => {
    // deps에 childNodes가 없어 cascade 루프 없음(expandedInline/fullGraph 변화 시에만 동기화) — 안전한 의도된 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChildNodes((current) => {
      const present = new Set(current.map((node) => node.id));
      const toAdd: AppNode[] = [];
      if (fullGraph) {
        for (const expandedId of expandedInline) {
          for (const flat of fullGraph.nodes) {
            if (flat.parent_node_id === expandedId && !present.has(flat.id)) {
              const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, expandedId);
              // 중첩 하위프로세스 자식도 펼침 가능하게 subEnds 주입(캐시 있으면)
              toAdd.push(injectSubEnds({ ...app, selectable: true, draggable: false, deletable: true }));
            }
          }
        }
      }
      // 부모(scopeId)가 더 이상 펼쳐지지 않은 자식 제거
      const kept = current.filter((node) => expandedInline.has(node.data.scopeId as string));
      if (toAdd.length === 0 && kept.length === current.length) {
        return current;
      }
      return [...kept, ...toAdd];
    });
  }, [expandedInline, fullGraph, injectSubEnds]);

  // 화면 클릭점 → 저장 Y(height-shift 역변환) — 새 노드 생성·붙여넣기 좌표 전용.
  // 상시 스텝 사용 — 펼침 중에도 표시 Y는 밀려 있다(합성 입력 베이크).
  const toSavedPoint = useCallback((point: { x: number; y: number }) => {
    const steps = heightStepsRef.current;
    return steps.length === 0 ? point : { x: point.x, y: displayToSavedX(point.y, steps) };
  }, []);

  // 펼침 중 루트 드래그: 드래그 중인 노드의 position 변경은 nodes state에 쓰지 않고 버린다(저장 좌표 동결).
  // 라이브 표시좌표는 dragLiveById가 따로 추적하고 displayNodes가 직접 렌더한다 → 커서 1:1 추종, 매 프레임
  // offset 보정으로 인한 튐 없음. 표시→저장 환산은 드롭 시점(onNodeDragStop)에 한 번만. select/dimensions/remove
  // 등 비-position 변경은 그대로 통과.
  const dropDraggingPositions = useCallback(
    (changes: NodeChange<AppNode>[]): NodeChange<AppNode>[] => {
      // Shift 드래그 축 고정 — 단일·다중선택 드래그 공통 경로(각자 시작점 기준). suppress 필터와 무관하게
      // (펼침 추적 여부 상관없이) 적용. dragging true/false(드롭 확정) 둘 다 보정 — RF는 드롭 시 자체 내부
      // 좌표(우리가 보정한 적 없는 원본 대각 이동)로 마지막 position 변경을 한 번 더 흘려보내므로, true만
      // 잡으면 드롭 순간 원위치로 튄다.
      const starts = dragStartPositionsRef.current;
      if (starts.size > 0) {
        for (const change of changes) {
          if (change.type === "position" && change.position) {
            const start = starts.get(change.id);
            if (start) {
              change.position = constrainToAxis(start, change.position, shiftHeldRef.current);
            }
          }
        }
      }
      // height-shift(#1) 역변환 — RF가 흘려보내는 position은 표시 좌표(오프셋 포함)라
      // nodes state(저장 좌표)에 그대로 넣으면 드래그마다 오프셋이 누적된다. 축 고정과 무관하게 항상 적용.
      // 드래그 중(dragging=true) 제스처 노드는 시작 시점 오프셋 상수를 빼는 선형 역변환 — 표시(displayNodes)도
      // 같은 상수를 더해 항등 왕복이 되므로, 계단 역변환의 도달불가 갭에서 스톨→점프하지 않고 커서를 1:1 추종.
      // 드롭 확정(dragging=false, RF 마지막 flush)은 기존 계단 역변환 → 저장 좌표 의미(갭=앵커 클램프) 보존.
      const ySteps2 = yStepsRef.current;
      const gestureOffsets = dragYOffsetsRef.current;
      const suppress = suppressPosIdsRef.current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const frozen = change.dragging === true ? gestureOffsets.get(change.id) : undefined;
          if (frozen !== undefined) {
            if (frozen !== 0) {
              change.position = { x: change.position.x, y: change.position.y - frozen };
            }
          } else if (ySteps2.length > 0) {
            change.position = {
              x: change.position.x,
              y: displayToSavedX(change.position.y, ySteps2),
            };
          } else if (!suppress.has(change.id)) {
            // 펼침 중 비제스처 이동(방향키 등, dragging=false) — ySteps는 게이트로 비어 있고
            // 드래그 억제도 없어서 RF 표시좌표가 그대로 저장 state로 들어가 footprint/height-shift만큼
            // 점프하던 버그. 해당 노드의 rootOffsets(표시−저장)를 빼 저장좌표로 역변환한다.
            const offset = inlineCompositionRef.current?.rootOffsets.get(change.id);
            if (offset !== undefined && (offset.x !== 0 || offset.y !== 0)) {
              change.position = {
                x: change.position.x - offset.x,
                y: change.position.y - offset.y,
              };
            }
          }
        }
      }
      if (suppress.size === 0) {
        return changes;
      }
      return changes.filter(
        (change) => !(change.type === "position" && "id" in change && suppress.has(change.id)),
      );
    },
    [],
  );

  // React Flow 변경분을 현재 스코프(nodes)와 자식(childNodes)으로 분배 — 자식 측정/선택/이동이 올바른 state로 가게.
  const handleNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      // 카메라 애니메이션(fitView) 중 클릭은 RF가 onNodeClick을 드래그로 삼켜 selectedId가 안 따라온다(#14)
      // — RF 선택 변경을 미러링해 선택 링과 인스펙터를 일치시킨다(단일 신규 선택·현재 스코프만).
      const newlySelected = changes.filter(
        (change): change is Extract<NodeChange<AppNode>, { type: "select" }> =>
          change.type === "select" && change.selected,
      );
      if (newlySelected.length === 1) {
        const node = nodesRef.current.find((n) => n.id === newlySelected[0].id);
        if (node && (node.data.scopeId ?? null) === currentParentId) {
          setSelectedId(node.id);
          setSelectedEdgeId(null);
        }
      }
      if (childNodes.length === 0) {
        onNodesChange(dropDraggingPositions(changes));
        return;
      }
      const childIds = new Set(childNodes.map((node) => node.id));
      const childChanges = changes.filter((change) => "id" in change && childIds.has(change.id));
      const mainChanges = changes.filter(
        (change) => !("id" in change) || !childIds.has(change.id),
      );
      if (mainChanges.length > 0) {
        onNodesChange(dropDraggingPositions(mainChanges));
      }
      if (childChanges.length > 0) {
        setChildNodes((current) => applyNodeChanges(childChanges, current));
      }
    },
    [childNodes, onNodesChange, dropDraggingPositions, currentParentId],
  );
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);
  useEffect(() => {
    groupDropTargetRef.current = groupDropTarget;
  }, [groupDropTarget]);
  useEffect(() => {
    dragLiveByIdRef.current = dragLiveById;
  }, [dragLiveById]);

  // 아웃라인 하위 펼치기용 전체 그래프 — 비핵심이라 실패해도 조용히 무시(아웃라인만 영향)
  const refreshFullGraph = useCallback(() => {
    if (versionId === null) {
      return;
    }
    const fetchedVersion = versionId;
    void getFullGraph(fetchedVersion)
      .then((graph) => {
        setRootGraph(graph);
        fullGraphVersionRef.current = fetchedVersion; // 캐시된 트리가 속한 버전을 기록 — 게이트의 버전 불일치 판정용
      })
      .catch(() => undefined);
  }, [versionId]);
  // 라이브러리 목록 마운트 시 1회 로드 — 업데이트 뱃지·팔로우-최신 UI용
  useEffect(() => {
    void listLibraryProcesses().then(setLibraryList).catch(() => undefined);
  }, []);

  // 담당자 후보 목록 — 버전 전환 시 재로드. 읽기전용에서도 드리프트 경고 표시용으로 로드.
  useEffect(() => {
    if (versionId === null) return;
    let active = true;
    void getEligibleAssignees(versionId)
      .then((data) => { if (active) setEligible(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [versionId]);

  useEffect(() => {
    windowGeomRef.current = windowGeom;
  }, [windowGeom]);

  const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[] }>({
    past: [],
    future: [],
  });
  const lastTextEditAtRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 저장 ──────────────────────────────────────────────

  const saveCurrentScope = useCallback(async () => {
    // 미리보기 중에는 저장 생략 — Apply 전 자동 영속화 방지
    if (previewRef.current !== null) return;
    // 딥뷰(읽기전용 하위프로세스 스코프)는 영속 대상이 아님 — 자동/블러/디바운스 저장 모두 차단.
    if (currentScopeIsReadOnlyRef.current) return;
    // 읽기 전용(타인 체크아웃)이면 저장 자체를 생략 — 스코프 이동은 계속 가능
    if (versionId === null || readOnly) {
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setSaveState("saving");
    try {
      await saveGraph(
        versionId,
        buildGraph(nodesRef.current, edgesRef.current, groupsRef.current),
      );
      dirtyRef.current = false;
      setSaveState("saved");
      setSaveErrorDetail(null); // 저장 성공 — 실패 상세 배너 해제
      refreshFullGraph();
    } catch (err) {
      setSaveState("error");
      // 실패 상세는 상단 배너로 노출 — 다음 저장 성공까지 유지
      setSaveErrorDetail(humanizeApiError(err, t));
      throw err;
    }
  }, [versionId, readOnly, refreshFullGraph, t]);

  const scheduleAutoSave = useCallback(() => {
    // 미리보기 중에는 자동 저장 생략 — Apply 전 자동 영속화 방지
    if (previewRef.current !== null) return;
    if (readOnly) {
      return;
    }
    dirtyRef.current = true;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      // 예약 이후 읽기전용으로 확정됐으면(권한 도착·타인 체크아웃) 발사하지 않는다 —
      // saveCurrentScope의 readOnly는 예약 시점 클로저값이라 여기서 막지 않으면 403이 난다.
      // 저장할 수 없는 변경이므로 이탈 경고용 더티도 함께 내린다.
      if (readOnlyRef.current) {
        dirtyRef.current = false;
        return;
      }
      // 실패는 saveState=error 표시로 사용자에게 노출 — 수동 저장으로 재시도
      void saveCurrentScope().catch(() => undefined);
    }, AUTO_SAVE_DELAY_MS);
  }, [saveCurrentScope, readOnly]);

  // "저장됨" 표시는 잠깐 보여주고 지움
  useEffect(() => {
    if (saveState !== "saved") {
      return;
    }
    const timer = setTimeout(() => setSaveState("idle"), 1500);
    return () => clearTimeout(timer);
  }, [saveState]);

  // 미저장 변경이 있으면 페이지 이탈 경고
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    },
    [],
  );

  // 저장된 창 기하 복원 (클라이언트 전용)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration, 외부 저장소에서 읽는 합법적 패턴
    setWindowGeom(loadWindowGeoms(mapId));
  }, [mapId]);

  // 저장된 인스펙터 너비 복원 (클라이언트 전용, hydration 후 1회)
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("bpm.inspectorWidth"));
    if (Number.isFinite(saved) && saved > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration, 외부 저장소에서 읽는 합법적 패턴
      setInspectorWidth(Math.min(520, Math.max(300, saved)));
    }
  }, []);

  // 창 기하 변경 시 디바운스 저장
  useEffect(() => {
    const timer = setTimeout(() => saveWindowGeoms(mapId, windowGeom), 300);
    return () => clearTimeout(timer);
  }, [mapId, windowGeom]);

  // 캔버스 컨테이너 크기 추적 — 창 클램프/기본배치용
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) {
      return;
    }
    const update = () => setBounds({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // bounds 변경 시 화면 밖으로 나간 창을 안으로 끌어들임 — 다른 해상도에서 저장된 위치 복구
  useEffect(() => {
    if (bounds.w === 0 || bounds.h === 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bounds 변동에 따른 기하 보정(같은 참조면 bail-out)
    setWindowGeom((map) => {
      let changed = false;
      const next: Record<string, WindowGeom> = {};
      for (const [key, g] of Object.entries(map)) {
        const w = Math.min(g.w, bounds.w);
        const h = Math.min(g.h, bounds.h);
        const x = Math.min(Math.max(g.x, 0), Math.max(0, bounds.w - w));
        const y = Math.min(Math.max(g.y, 0), Math.max(0, bounds.h - h));
        if (w !== g.w || h !== g.h || x !== g.x || y !== g.y) {
          next[key] = { ...g, x, y, w, h };
          changed = true;
        } else {
          next[key] = g;
        }
      }
      return changed ? next : map;
    });
  }, [bounds]);

  // ── Undo / Redo ───────────────────────────────────────

  const pushHistory = useCallback(() => {
    const history = historyRef.current;
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    if (history.past.length > HISTORY_LIMIT) {
      history.past.shift();
    }
    history.future = [];
    setHistorySize({ past: history.past.length, future: 0 });
  }, []);

  // 병합 프리뷰 진입 코어 — CSV 임포트와 AI graph 제안이 공유(previewSource="csv" 슬롯). 캔버스에만 반영(미저장).
  // 소멸 노드/엣지는 삭제·유지와 무관하게 항상 빨간 점선으로 보여준다.
  const startImportPreview = useCallback(
    (outcome: CsvImportOutcome, origin: "csv" | "ai") => {
      if (versionId === null || !outcome?.graph) return;
      const added = new Set(outcome.merge.addedNodeIds);
      const removedIds = new Set(outcome.merge.removedNodes.map((node) => node.id));

      // 캔버스 그래프 = 머지 결과 + 소멸 노드(하이라이트용). 저장 payload는 Apply 시 따로 만든다.
      const canvasGraph = withKeptNodes(outcome.graph, outcome.merge.removedNodes);
      const previewNodes = toAppNodes(canvasGraph, null).map((node) => ({
        ...node,
        data: {
          ...node.data,
          diffStatus: removedIds.has(node.id)
            ? ("removed" as const)
            : added.has(node.id)
              ? ("added" as const)
              : undefined,
        },
      }));
      const previewEdges = [
        ...toAppEdges(canvasGraph),
        // toAppEdges는 graph.edges만 읽는다 (page.tsx:527) — 소멸 엣지만 담아 스타일을 얹는다
        ...toAppEdges({ nodes: [], edges: outcome.merge.lostEdges, groups: [] }).map((edge) => ({
          ...edge,
          // 비교 화면과 같은 시각 언어 (compare/page.tsx:257-259) — 사라질 엣지
          style: { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" },
        })),
      ];

      pushHistory(); // Cancel = undo 1회로 임포트 이전 캔버스 복귀
      previewRef.current = "csv";
      setNodes(previewNodes);
      setEdges(previewEdges);
      setGroups(canvasGraph.groups);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setMenu(null);
      setCsvKeepRemoved(false);
      setPreviewSource("csv");
      setImportOrigin(origin);
      setInspectorOpen(true); // Apply/Cancel이 인스펙터 Import 탭에 있다 — 접혀 있으면 갇히므로 강제로 펼친다
      setCsvImportOpen(false);
    },
    [versionId, pushHistory, setNodes, setEdges, setGroups],
  );

  const enterCsvPreview = useCallback(() => {
    // 슬롯이 이미 점유 중이면(주로 AI 프리뷰) 무시 — 툴바 게이팅이 우선 막지만 방어적으로 한 번 더 확인
    if (previewRef.current !== null) return;
    if (csvOutcome?.graph) startImportPreview(csvOutcome, "csv");
  }, [csvOutcome, startImportPreview]);

  // 프리뷰 확정 — 삭제/유지 선택을 반영한 최종 그래프를 PUT. 소멸 엣지는 어느 쪽이든 저장하지 않는다.
  // 직접 saveGraph를 쓰는 이유: setState 직후 ref 동기화 전에 saveCurrentScope를 부르면 이전 상태가 저장됨.
  const applyCsvImport = useCallback(async () => {
    const outcome = csvOutcome;
    if (versionId === null || !outcome?.graph) return;
    const payload = csvKeepRemoved
      ? withKeptNodes(outcome.graph, outcome.merge.removedNodes)
      : outcome.graph;
    try {
      const saved = await saveGraph(versionId, payload);
      previewRef.current = null;
      setPreviewSource(null);
      setImportOrigin(null);
      setNodes(toAppNodes(saved, null));
      setEdges(toAppEdges(saved));
      setGroups(saved.groups);
      dirtyRef.current = false;
      setSaveState("saved");
      refreshFullGraph();
      setCsvOutcome(null);
      setCsvFileName(null);
      showToast(t("csvImport.applied"));
    } catch (err) {
      // 프리뷰를 유지한 채 실패만 알린다 — 다시 Apply 하거나 Cancel 할 수 있다 (423/409)
      showToast(humanizeApiError(err, t), "error");
    }
  }, [versionId, csvOutcome, csvKeepRemoved, setNodes, setEdges, setGroups, refreshFullGraph, showToast, t]);

  // 타이핑은 간격 안에서 한 스냅샷으로 묶고, 그 외 변경은 즉시 기록
  const recordChange = useCallback(
    (fromTyping: boolean) => {
      if (fromTyping) {
        const now = Date.now();
        const withinGap = now - lastTextEditAtRef.current <= TEXT_HISTORY_GAP_MS;
        lastTextEditAtRef.current = now;
        if (withinGap) {
          return;
        }
      }
      pushHistory();
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) {
      return;
    }
    history.future.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setGroups(previous.groups);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, setGroups, scheduleAutoSave]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) {
      return;
    }
    history.past.push({ nodes: nodesRef.current, edges: edgesRef.current, groups: groupsRef.current });
    setNodes(next.nodes);
    setEdges(next.edges);
    setGroups(next.groups);
    setHistorySize({ past: history.past.length, future: history.future.length });
    scheduleAutoSave();
  }, [setNodes, setEdges, setGroups, scheduleAutoSave]);

  // CSV 프리뷰 취소 — 스냅샷 복원에 undo가 필요해 undo 선언 뒤에 둔다. Task 8이 Import 탭에 연결한다.
  const cancelCsvPreview = useCallback(() => {
    previewRef.current = null;
    setPreviewSource(null);
    setImportOrigin(null);
    setCsvOutcome(null);
    setCsvFileName(null);
    undo(); // enterCsvPreview가 밀어넣은 스냅샷으로 복귀
  }, [undo]);

  // AI graph 제안 → CSV와 같은 병합 프리뷰 (design 2026-07-11) — 전량 교체 경로 폐기
  const enterAiGraphPreview = useCallback(
    (proposal: AiProposal) => {
      if (proposal.kind !== "graph") return;
      // 프리뷰 슬롯 점유 중(CSV든 AI ops든) 진입 금지 — aa87766 중첩 자동저장 방지 경계 유지
      if (previewRef.current !== null) {
        showToast(t("preview.busy"));
        return;
      }
      if (versionId === null) return;
      const outcome = buildGraphFromAiProposal(proposal, {
        base: buildGraph(nodesRef.current, edgesRef.current, groupsRef.current),
      });
      if (!outcome.graph) {
        showToast(t("ai.error"));
        return;
      }
      setCsvFileName(null);
      setCsvOutcome(outcome);
      startImportPreview(outcome, "ai");
    },
    [versionId, startImportPreview, showToast, t],
  );

  // ── AI 증분 편집(ops) 적용 — 기존 좌표·색·담당자·그룹 보존 (D1 편집 경로) ──
  const applyAiOps = useCallback(
    (proposal: AiProposal) => {
      if (proposal.kind !== "ops") return;
      // graph 제안도 startImportPreview를 거쳐 "csv" 슬롯을 점유한다 — CSV 임포트든 graph 제안이든
      // 여기서 함께 막힌다. 허용되는 유일한 연쇄는 ops 프리뷰 위에 ops를 다시 적용하는 것(previewRef === "ai").
      if (previewRef.current === "csv") {
        showToast(t("preview.busy"));
        return;
      }
      const existingGroupIds = new Set(groupsRef.current.map((group) => group.id));
      const removed = new Set<string>();
      const relabels = new Map<string, string>();
      const setAttrs = new Map<string, AiNodeAttributes>();
      const setDescs = new Map<string, string>(); // set_desc — 노드 설명 갱신
      const disconnects = new Set<string>(); // "src→tgt" — 해당 방향 엣지 제거
      const edgeLabels = new Map<string, string>(); // "src→tgt" → 새 라벨
      const addedGraphNodes: GraphNode[] = [];
      const keyToId = new Map<string, string>(); // add 임시키 → 새 id
      const connectEdges: GraphEdge[] = [];

      // add 먼저 — 이후 connect가 새 키를 참조할 수 있게
      for (const op of proposal.ops) {
        if (op.action === "add" && op.node) {
          const id = genId();
          keyToId.set(op.node.key, id);
          const gid =
            op.node.group_key && existingGroupIds.has(op.node.group_key)
              ? op.node.group_key
              : undefined;
          addedGraphNodes.push(aiNodeToGraphNode(op.node, id, gid));
        }
      }
      const resolve = (ref: string | null): string | null =>
        ref ? keyToId.get(ref) ?? ref : null;

      for (const op of proposal.ops) {
        if (op.action === "remove" && op.node_id) {
          removed.add(op.node_id);
        } else if (op.action === "relabel" && op.node_id && op.title != null) {
          relabels.set(op.node_id, op.title);
        } else if (op.action === "set_attr" && op.node_id && op.attributes) {
          setAttrs.set(op.node_id, op.attributes);
        } else if (op.action === "set_desc" && op.node_id && op.description != null) {
          setDescs.set(op.node_id, op.description);
        } else if (op.action === "disconnect") {
          const source = resolve(op.source);
          const target = resolve(op.target);
          if (source && target) disconnects.add(`${source}→${target}`);
        } else if (op.action === "set_edge_label") {
          const source = resolve(op.source);
          const target = resolve(op.target);
          if (source && target && op.label != null) {
            edgeLabels.set(`${source}→${target}`, op.label);
          }
        } else if (op.action === "connect") {
          const source = resolve(op.source);
          const target = resolve(op.target);
          if (source && target) {
            connectEdges.push({
              id: genId(),
              source_node_id: source,
              target_node_id: target,
              label: op.label ?? "",
              source_side: "right",
              target_side: "left",
              source_handle: null,
              target_handle: null,
              // AI connect는 새 엣지 — 수동 생성과 같은 선 모양 기본값
              line_style: getNewEdgeLineStyle(),
            });
          }
        }
      }

      // 기존 노드: remove 제외 + relabel/set_desc/set_attr 적용 (좌표·나머지 보존)
      // set_attr는 부분 갱신 — null/생략 필드는 기존 값 유지, ""는 지움 (계약 시맨틱)
      const existingNodes = nodesRef.current
        .filter((node) => !removed.has(node.id))
        .map((node) => {
          const title = relabels.get(node.id);
          const desc = setDescs.get(node.id);
          const attr = setAttrs.get(node.id);
          if (title === undefined && desc === undefined && attr === undefined) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...(title !== undefined ? { label: title } : {}),
              ...(desc !== undefined ? { description: desc } : {}),
              ...(attr
                ? {
                    // 서브프로세스 색은 시스템 고정(바이올렛) — AI가 보내도 데이터 오염 방지 (design 2026-07-11 ④)
                    ...(attr.color != null && node.data.nodeType !== "subprocess"
                      ? { color: attr.color }
                      : {}),
                    ...(attr.assignee != null ? { assignee: attr.assignee } : {}),
                    ...(attr.department != null ? { department: attr.department } : {}),
                    ...(attr.system != null ? { system: attr.system } : {}),
                    // 파라미터 6종 — SP 노드는 annual_count·fte만 수정 가능(design 2026-07-13 §6) + 통화
                    // 배타를 resolveAiParamPatch(buildGraphFromAiProposal과 같은 규칙 재사용)로 강제.
                    // 위반 필드는 색과 같은 방식으로 조용히 드롭 — 이 경로엔 프리뷰 경고 채널이 없다.
                    ...resolveAiParamPatch(node.data.nodeType, attr),
                    // 승격 텍스트 필드 — IO 텍스트 변경 시 폼·링크·플래그 폐기 동반(mergeNode 계약 미러)
                    ...resolveAiTextPatch(node.data.nodeType, attr, node.data),
                    ...(attr.url != null ? { url: attr.url } : {}),
                    ...(attr.url_label != null ? { urlLabel: attr.url_label } : {}),
                  }
                : {}),
            },
          };
        });
      // 추가 노드: 기존 아래로 배치 — 기존 좌표는 불변
      const addedNodes = toAppNodes({ nodes: addedGraphNodes, edges: [], groups: [] });
      const baseY =
        existingNodes.reduce((max, node) => Math.max(max, node.position.y), 0) + 140;
      addedNodes.forEach((node, index) => {
        node.position = { x: 80, y: baseY + index * 120 };
      });
      const finalNodes = [...existingNodes, ...addedNodes];
      const finalEdges = [
        ...edgesRef.current
          .filter(
            (edge) =>
              !removed.has(edge.source) &&
              !removed.has(edge.target) &&
              !disconnects.has(`${edge.source}→${edge.target}`),
          )
          .map((edge) => {
            const label = edgeLabels.get(`${edge.source}→${edge.target}`);
            return label === undefined ? edge : { ...edge, label: label || undefined };
          }),
        ...toAppEdges({ nodes: [], edges: connectEdges, groups: [] }),
      ];

      pushHistory(); // Discard = undo restores the pre-preview state
      previewRef.current = "ai";
      setNodes(finalNodes);
      setEdges(finalEdges);
      setPreviewSource("ai");
    },
    [pushHistory, setNodes, setEdges, showToast, t],
  );

  const commitAiPreview = useCallback(() => {
    previewRef.current = null;
    setPreviewSource(null);
    void saveCurrentScope();
  }, [saveCurrentScope]);

  const discardAiPreview = useCallback(() => {
    previewRef.current = null;
    setPreviewSource(null);
    undo(); // restore the snapshot pushed in applyAiOps
  }, [undo]);

  // ── AI 노드 포커스/하이라이트 — 분석 finding·워크스루 공용 (Phase 4 신설, Phase 5 재사용) ──
  const highlightNode = useCallback(
    (nodeId: string) => {
      if (!nodesRef.current.some((node) => node.id === nodeId)) return; // 히스토리 카드의 사라진 노드 — no-op
      setSelectedId(nodeId);
      setNodes((current) =>
        current.map((node) =>
          node.selected === (node.id === nodeId)
            ? node
            : { ...node, selected: node.id === nodeId },
        ),
      );
      void reactFlow.fitView({
        nodes: [{ id: nodeId }],
        padding: 0.4,
        duration: 400,
        maxZoom: 1.3,
      });
    },
    [reactFlow, setNodes],
  );

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — 입력 필드 포커스 중에는 브라우저 기본 동작 유지. "/"는 검색 포커스.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isTyping =
        event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      // "/" = 검색 포커스 (Ctrl+K에서 변경, F8) — 입력 중이 아닐 때만
      if (event.key === "/" && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        // 검색이 사이드바로 이동(R4b) — 이미 펼쳐져 있으면 즉시, 접혀 있으면 펼친 뒤 다음 프레임에 포커스
        setLeftCollapsed(false);
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        } else {
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }
        return;
      }
      if (isTyping) {
        return;
      }
      if (event.key === "Escape") {
        setPending(null);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── 로드 ──────────────────────────────────────────────

  // 비공개 맵 접근 게이트 — 로드 403이면 안내 모달 후 홈으로
  const [accessDenied, setAccessDenied] = useState(false);

  // 맵 메타 로드 — 버전 확보 + 브레드크럼 루트 이름 + 기본 버전 선택(§6.1)
  // 기본 선택: 내가 점유 보유한 draft → 최신 published → 첫 번째
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [detail, me] = await Promise.all([getMap(mapId), getMe()]);
        if (!active) {
          return;
        }
        setMapName(detail.name);
        setMapOwner(detail.created_by);
        setMapOwnerName(detail.owner_name ?? null);
        setMapOwningDept(detail.owning_department ?? null);
        setMapCategoryId(detail.category_id ?? null);
        setMapCategoryPath(detail.category_path ?? null);
        setLinkageCategoryId(detail.linkage_category_id ?? null);
        setLinkageCategoryPath(detail.linkage_category_path ?? null);
        setMyRole(detail.my_role);
        setMapMode(detail.mode ?? "normal");
        setMapVisibility(detail.visibility);
        setDocName(detail.doc_name ?? "");
        setDocSections(detail.doc_sections ?? []);
        setVersions(detail.versions);
        setUsername(me.username);
        setAiEnabled(me.ai_enabled);
        setIsSysadmin(me.is_sysadmin);
        // 연계 캔버스 자동 보강 — 열 때 소속 L6 부족분 append(권한자만 반영, 뷰어는 미반영 수만).
        // 버전 선택 전에 끝내야 이어지는 그래프 로드가 보강분을 포함한다 (design 2026-08-28 §5)
        if (detail.mode === "framework" && detail.linkage_category_id != null) {
          try {
            const reconciled = await openLinkageMap(detail.linkage_category_id);
            if (active) {
              setReconcileMissing(reconciled.missing_count);
              if (reconciled.added_count > 0) {
                showToast(t("framework.reconciled", { n: reconciled.added_count }));
              }
            }
          } catch {
            // 보강 실패는 열람을 막지 않는다 — 다음 열기에서 재시도
          }
        }
        // 기본 선택 — 내 draft(점유 보유) > 최신 published > 첫 번째
        const draft = detail.versions.find((v) => v.status === "draft");
        const latestPublished = detail.versions.find((v) => v.status === "published");
        let initialId = latestPublished?.id ?? detail.versions[0]?.id;
        if (detail.mode === "framework") {
          // 캔버스는 뷰어 포함 항상 라이브 draft 우선 — 스냅샷은 버전 드롭다운에서 열람 (design 2026-08-28 §8)
          initialId = draft?.id ?? initialId;
        } else if (draft) {
          try {
            const ws = await getWorkflowState(draft.id);
            if (active && ws.checkout_holder === me.username) {
              initialId = draft.id;
            }
          } catch {
            // 워크플로우 조회 실패 시 기본값 유지
          }
        }
        // 홈 "이 버전으로 가기" 등에서 ?version=<id>로 진입 시 해당 버전으로 개시(기본 선택보다 우선).
        const paramVersion = Number(new URLSearchParams(window.location.search).get("version"));
        if (paramVersion && detail.versions.some((v) => v.id === paramVersion)) {
          initialId = paramVersion;
        }
        // AI 챗 딥링크 — ?aiChat=<sessionId>로 진입 시 패널 자동 오픈 + 해당 세션 활성 (async 콜백이라 set-state-in-effect 아님)
        const paramChat = Number(new URLSearchParams(window.location.search).get("aiChat"));
        if (paramChat) {
          setAiInitialSessionId(paramChat);
          setAiOpen(true);
        }
        if (active) {
          setVersionId(initialId ?? detail.versions[0].id);
          setScopes([{ kind: "root", title: detail.name }]);
          setActiveIndex(0);
        }
      } catch (err) {
        if (active) {
          if (err instanceof ApiError && err.status === 403) {
            setAccessDenied(true); // 권한 없음 — 에러 문자열 대신 안내 모달
          } else {
            setStatus(humanizeApiError(err, t));
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId, t, showToast]);

  // 현재 사용자 신원 — 마운트 1회(맵 로드 병렬 호출과 별개로 auth 비활성 시 null 유지)
  useEffect(() => {
    let alive = true;
    void getMe()
      .then((me) => {
        if (alive) {
          setUsername(me.username);
          setAiEnabled(me.ai_enabled);
          setManualUrl(me.manual_url);
          setCsvManualUrl(me.csv_manual_url);
          setIsSysadmin(me.is_sysadmin);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 이름 해석 캐시 — 점유자·이전 대상 이름 표시(login_id→표시이름) / name cache for checkout display
  useEffect(() => {
    let alive = true;
    void getDirectory()
      .then((dir) => {
        if (alive) {
          setNameById(new Map(dir.users.map((u) => [u.id, u.name])));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 워크플로우 상태 — 버전 전환 시 재요청
  const refreshWorkflow = useCallback(async () => {
    if (versionId === null) return;
    try {
      setWorkflow(await getWorkflowState(versionId));
    } catch {
      setWorkflow(null);
    }
  }, [versionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshWorkflow(); // intentional: fetch workflow state when version changes
  }, [refreshWorkflow]);

  // 주어진 노드들을 화면 좌상단에 정렬(현재 줌 유지) — 스코프 전환 시 줌 안 바꾸고 부드럽게 이동(왼쪽위 고정 일관).
  // 콘텐츠 좌상단을 extent 좌상단 경계(minX-여백)에 맞춰 setViewport → 비대칭 extent 안이라 스냅 없음. (스코프 로드 효과보다 먼저 정의 — TDZ 회피)
  const frameScopeTopLeftKeepZoom = useCallback(
    (ids: string[], duration: number) => {
      const idSet = new Set(ids);
      const ns = reactFlow.getNodes().filter((node) => idSet.has(node.id));
      if (ns.length === 0) {
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      for (const node of ns) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
      }
      const z = reactFlow.getZoom();
      void reactFlow.setViewport(
        { x: (EXTENT_TOPLEFT_MARGIN - minX) * z, y: (EXTENT_TOPLEFT_MARGIN - minY) * z, zoom: z },
        { duration },
      );
    },
    [reactFlow],
  );

  // 직전에 로드한 스코프(currentParentId) — 스코프 전환 시에만 부드러운 카메라 이동을 트리거(첫 로드/버전변경 제외)
  const prevScopeRef = useRef<string | null | undefined>(undefined);
  // 마지막으로 완전히 로드한 스코프 키(version:parent) — fullGraph 변화만으로 effect가 재실행될 때
  // 같은 스코프 재로딩(히스토리/펼침 리셋 회귀)을 막는 가드. 딥뷰는 자식이 늦게 도착하면 다시 들어와 채운다.
  const loadedScopeKeyRef = useRef<string | null>(null);

  // 현재 스코프(version, parent) 캔버스 로드 — 히스토리/저장 상태도 새 스코프 기준으로 리셋
  useEffect(() => {
    if (versionId === null) {
      return;
    }
    const scopeLoadKey = `${versionId}:${currentParentId ?? "root"}`;
    const isScopeChange = loadedScopeKeyRef.current !== scopeLoadKey;
    // 같은 스코프인데 effect가 재실행됐다면 fullGraph 변화 때문 — 루트(권위 로드)는 다시 안 받는다.
    // 딥뷰만 자식이 늦게 합성 트리에 들어온 경우를 채우려 통과시킨다(아래에서 자식 유무로 한 번 더 게이트).
    if (!isScopeChange && currentParentId === null) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        // 로드되는 스코프 노드 id들 — 카메라 프레이밍에 쓴다(루트=권위 그래프, 딥뷰=합성 트리 자식).
        let scopeNodeIds: string[];
        // IO 링크 정합화가 무언가 고쳤는지 — 아래 히스토리/더티 리셋 이후에 저장을 예약해야 살아남는다
        let ioLinksHealed = false;
        if (currentParentId === null) {
          // 루트 스코프 — 편집 가능한 권위 그래프(평면)를 그대로 로드.
          const graph = await getGraph(versionId);
          if (!active) {
            return;
          }
          // 로드 정합화 — 원본 소실 링크 해산·드리프트한 미러 텍스트 치유 (io-linking §5).
          // 읽기전용이면 scheduleAutoSave가 자체 게이트로 무시하므로 메모리 치유만 남는다.
          const { nodes: reconciled, changed } = propagateIoLinks(
            toAppNodes(graph, currentParentId),
            new Map(
              Object.entries(graph.subprocess_refs ?? {}).map(([key, ref]) => [Number(key), ref]),
            ),
          );
          ioLinksHealed = changed;
          // 현재 스코프 노드는 모두 currentParentId(=null) 스코프 소속 — scope-split 저장 식별용 태그
          setNodes(reconciled);
          setEdges(toAppEdges(graph));
          setGroups(graph.groups);
          scopeNodeIds = graph.nodes.map((node) => node.id);
        } else {
          // 딥뷰(읽기전용) — getResolvedGraph로 재로드하지 않는다(원본 id는 합성 트리 namespaced 체인에
          // 앵커 못함). 합성 트리에서 host의 자식(이미 namespaced)을 필터해 읽기전용으로 표시.
          const tree = fullGraphRef.current;
          const kids = tree
            ? tree.nodes.filter((flat) => flat.parent_node_id === currentParentId)
            : [];
          // 자식이 아직 합성 트리에 없으면(resolved 그래프 로딩 중) 그대로 둔다 — fullGraph 갱신 시 effect 재실행.
          if (kids.length === 0) {
            return;
          }
          const kidIds = new Set(kids.map((flat) => flat.id));
          const subEdges = tree
            ? tree.edges.filter(
                (edge) =>
                  kidIds.has(edge.source_node_id) && kidIds.has(edge.target_node_id),
              )
            : [];
          setNodes(
            toAppNodes({ nodes: kids, edges: [], groups: [] }, currentParentId).map((node) => ({
              ...node,
              draggable: false,
              selectable: true,
              deletable: false,
              connectable: false,
            })),
          );
          setEdges(
            toAppEdges({ nodes: [], edges: subEdges, groups: [] }).map((edge) => ({
              ...edge,
              selectable: false,
              deletable: false,
              focusable: false,
            })),
          );
          setGroups([]);
          scopeNodeIds = kids.map((flat) => flat.id);
        }
        loadedScopeKeyRef.current = scopeLoadKey;
        // 전체 트리는 버전당 1회만 — 스코프 전환 시 기존 데이터 재사용(깜빡임 방지).
        // 버전이 바뀌면 stale 트리이므로 다시 받는다.
        if (fullGraphRef.current === null || fullGraphVersionRef.current !== versionId) {
          refreshFullGraph();
        }
        // 자식이 늦게 채워진 재실행(같은 딥뷰 스코프)이면 리셋/펼침/카메라는 건너뛰고 노드만 채운다.
        if (!isScopeChange) {
          return;
        }
        setSelectedId(null);
        setSelectedEdgeId(null);
        setMenu(null);
        // 스코프 네비게이션(들고나기)이면 펼침을 유지 — "접히지 않고 활성 영역만 이동". 첫 로드/버전 변경만 모두 접힘.
        const prevScope = prevScopeRef.current; // 직전 스코프(아직 갱신 전)
        const isScopeNav =
          prevScope !== undefined &&
          prevScope !== currentParentId &&
          fullGraphVersionRef.current === versionId;
        if (isScopeNav && fullGraphRef.current) {
          const byId = new Map(fullGraphRef.current.nodes.map((flat) => [flat.id, flat]));
          // x가 새 스코프(currentParentId)의 (엄격) 하위인가 — 루트면 전부 하위
          const isUnder = (nodeId: string): boolean => {
            if (currentParentId === null) {
              return true;
            }
            let cur = byId.get(nodeId)?.parent_node_id ?? null;
            for (let guard = 0; cur !== null && guard < 20; guard++) {
              if (cur === currentParentId) {
                return true;
              }
              cur = byId.get(cur)?.parent_node_id ?? null;
            }
            return false;
          };
          // 명시적 접기 의도를 로컬로 캡처 후 ref 즉시 클리어 — 한 사이클만 적용(다음 펼침에 잔존 차단 없음, R1).
          const collapseIntent = collapseIntentRef.current;
          collapseIntentRef.current = new Set();
          setExpandedInline((prev) => {
            // 1) 새 스코프 하위 펼침 유지(들어갈 때 붕괴 방지) + 명시 접기 host 제외
            const next = new Set([...prev].filter((h) => isUnder(h) && !collapseIntent.has(h)));
            // 2) 나가기(직전 스코프가 새 스코프 하위)면 드릴 경로(직전 스코프→새 스코프 사이)를 펼쳐 유지
            //    → 떠난 스코프가 접히지 않고 인라인으로 보임(활성 영역만 이동). 단, 명시 접기 host는 re-add 건너뜀.
            if (prevScope !== null && prevScope !== undefined && isUnder(prevScope)) {
              let cur: string | null = prevScope;
              for (let guard = 0; cur !== null && cur !== currentParentId && guard < 20; guard++) {
                if (!collapseIntent.has(cur)) {
                  next.add(cur);
                }
                cur = byId.get(cur)?.parent_node_id ?? null;
              }
            }
            return next;
          });
        } else {
          setExpandedInline(new Set()); // 재로딩/버전 변경 시 모두 접힘으로 시작(spec 5.2)
        }
        historyRef.current = { past: [], future: [] };
        setHistorySize({ past: 0, future: 0 });
        lastTextEditAtRef.current = 0;
        dirtyRef.current = false;
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        setSaveState("idle");
        // 정합화 치유분은 다음 PUT에 동승 — 위 더티 리셋 뒤에 예약해야 타이머가 살아남는다 (io-linking §5)
        if (ioLinksHealed) {
          scheduleAutoSave();
        }
        // 스코프 전환이면(첫 로드/버전 변경 제외) 새 스코프로 카메라를 부드럽게 이동 — 콘텐츠가 제자리에서
        // 갑자기 바뀌어 시야가 길을 잃는 것 방지(포커스 모드 전환 연속화 A안).
        const isScopeTransition =
          prevScopeRef.current !== undefined && prevScopeRef.current !== currentParentId;
        prevScopeRef.current = currentParentId;
        // 검색 점프 — 노드가 렌더된 다음 틱에 화면 중앙으로
        if (focusNodeIdRef.current) {
          const focusId = focusNodeIdRef.current;
          focusNodeIdRef.current = null;
          setSelectedId(focusId);
          // 새 스코프 로드 직후 — 보더 강조를 위해 React Flow 선택 상태도 단일 선택으로 동기화
          setNodes((current) =>
            current.map((node) =>
              node.selected === (node.id === focusId)
                ? node
                : { ...node, selected: node.id === focusId },
            ),
          );
          setTimeout(() => {
            void reactFlow.fitView({
              nodes: [{ id: focusId }],
              padding: 0.4,
              duration: 700,
              maxZoom: 1.3,
            });
          }, 80);
        } else if (isScopeTransition) {
          const cam = focusCamRef.current;
          focusCamRef.current = null;
          if (cam) {
            // 포커스(Path 2) — 카메라를 offset×zoom만큼 옮겨 navigateTo한 자식이 레인 자리에 그대로(시각적 무이동).
            void reactFlow.setViewport({
              x: cam.vp.x + cam.shift.x * cam.vp.zoom,
              y: cam.vp.y + cam.shift.y * cam.vp.zoom,
              zoom: cam.vp.zoom,
            });
          } else {
            // 검색/브레드크럼 — 줌 유지한 채 새 스코프로 부드럽게 이동.
            if (scopeNodeIds.length > 0) {
              setTimeout(() => frameScopeTopLeftKeepZoom(scopeNodeIds, 600), 100);
            }
          }
        }
      } catch (err) {
        if (active) {
          setStatus(humanizeApiError(err, t));
        }
      }
    })();
    return () => {
      active = false;
    };
    // fullGraph: 딥뷰 진입 직후 host의 자식이 resolved 로딩으로 늦게 합성 트리에 들어오면 effect를 재실행해 채운다.
    // 루트 스코프에선 위 scopeKey 가드가 fullGraph-only 재실행을 무시하므로 권위 재로딩 회귀는 없다.
  }, [versionId, currentParentId, fullGraph, setNodes, setEdges, reactFlow, refreshFullGraph, scheduleAutoSave, t, frameScopeTopLeftKeepZoom]);

  // 노드 검색 — 버전 전체 노드에서 제목 부분 일치 + 초성 일치 (spec §7 Phase B).
  // 빈 쿼리의 결과 초기화는 입력 핸들러에서 처리 (effect 내 동기 setState 금지)
  useEffect(() => {
    if (versionId === null || !searchQuery.trim()) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const full = await getFullGraph(versionId);
        if (!active) {
          return;
        }
        const byId = new Map(full.nodes.map((node) => [node.id, node]));
        const matches = full.nodes
          .filter((node) => matchesQuery(node.title, searchQuery))
          .slice(0, SEARCH_RESULT_LIMIT);
        setSearchResults(
          matches.map((node) => {
            const ancestors: FlatNode[] = [];
            let current = node.parent_node_id ? byId.get(node.parent_node_id) : undefined;
            while (current) {
              ancestors.unshift(current);
              current = current.parent_node_id
                ? byId.get(current.parent_node_id)
                : undefined;
            }
            return {
              node,
              path: [mapName, ...ancestors.map((item) => item.title)].join(" › "),
              scopes: [
                { kind: "root", title: mapName } as Scope,
                ...ancestors.map(flatToSubScope),
              ],
            };
          }),
        );
        setSearchIndex(0);
      } catch (err) {
        if (active) {
          setStatus(humanizeApiError(err, t));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [searchQuery, versionId, mapName, t]);

  // 체크아웃 — 지정 인계 전용(자동해제 없음). 진입 시 점유 상태를 조회하고 주기적으로 재조회해
  // 요청 승인/이전으로 보유자가 바뀌면 반영한다. 이탈해도 점유는 유지(release 호출 안 함).
  // 뷰어는 점유 대상이 아니므로 조회도 생략(읽기 전용).
  // 게이트는 선택 버전의 status만 반응 — versions 배열 identity를 deps에 두면 목록 갱신마다
  // 인터벌이 재구독되며 acquireCheckout이 즉시 재호출된다(스팸).
  const selectedVersionStatus = versions.find((v) => v.id === versionId)?.status ?? null;
  // 폴 실패 처리 — t 최신값을 읽되 재구독을 유발하지 않는다. true 반환 = 영구 409(권한 pending)로 폴링 정지.
  const handleCheckoutPollError = useEffectEvent((err: unknown) => {
    setStatus(humanizeApiError(err, t));
    return getApiErrorDetail(err).startsWith(PERMISSION_PENDING_DETAIL_PREFIX);
  });
  useEffect(() => {
    if (versionId === null || !isEditorRole) {
      return;
    }
    // 비편집 상태에선 체크아웃 조회 안 함 — 백엔드가 409 반환하므로 스팸 방지
    if (selectedVersionStatus !== null && selectedVersionStatus !== "draft" && selectedVersionStatus !== "rejected") {
      return;
    }
    let active = true;
    // 본인 권한 변경이 pending이면 acquire-checkout이 영구 409 — 인터벌을 클로저 변수로 들고
    // catch에서 감지 시 정지(재시도 스팸 제거). stopped는 첫 poll(인터벌 설정 전) 실패 시
    // 인터벌 생성 자체를 생략하는 가드.
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const state = await acquireCheckout(versionId);
        if (!active) {
          return;
        }
        checkoutMineRef.current = state.mine;
        setCheckout(state);
      } catch (err) {
        if (!active) {
          return;
        }
        if (handleCheckoutPollError(err)) {
          stopped = true;
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      }
    };
    void poll().then(() => {
      if (active && !stopped) {
        intervalId = setInterval(() => void poll(), CHECKOUT_POLL_MS);
      }
    });
    return () => {
      active = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      checkoutMineRef.current = false;
    };
  }, [versionId, selectedVersionStatus, isEditorRole]);

  const handleForceCheckout = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    try {
      const state = await acquireCheckout(versionId, true);
      checkoutMineRef.current = state.mine;
      setCheckout(state);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  }, [versionId, t]);

  // 코멘트 폴링 — 5초 주기. 일시 오류는 다음 주기에 재시도되므로 상태 표시를 덮지 않는다.
  useEffect(() => {
    if (versionId === null) {
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const rows = await listComments(versionId);
        if (active) {
          setComments(rows);
        }
      } catch {
        // 다음 주기에 재시도
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), COMMENT_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [versionId]);

  const refreshComments = useCallback(async () => {
    if (versionId === null) {
      return;
    }
    setComments(await listComments(versionId));
  }, [versionId]);

  const handleAddComment = useCallback(
    async (body: string) => {
      if (versionId === null || selectedId === null) {
        return;
      }
      try {
        await createComment(versionId, selectedId, body);
        await refreshComments();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
      }
    },
    [versionId, selectedId, refreshComments, t],
  );

  const handleToggleComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await updateComment(comment.id, !comment.resolved);
        await refreshComments();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
      }
    },
    [refreshComments, t],
  );

  const handleDeleteComment = useCallback(
    async (comment: CommentItem) => {
      try {
        await deleteComment(comment.id);
        await refreshComments();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
      }
    },
    [refreshComments, t],
  );

  // 저장 차단 사유(수동 저장·승인 시작 전 검사) — 좌상단 체크리스트와 동일 조건. 빈 맵은 검증 없음.
  // autosave는 차단하지 않음(작성 중 방해 방지) — 사용자 선택: 수동 저장·승인 시작에서만 강제.
  const getSaveBlockers = useCallback((): string[] => {
    const ns = nodesRef.current;
    if (ns.length === 0) {
      return [];
    }
    const states = getSaveCheckStates(
      ns.map((node) => ({ id: node.id, nodeType: node.data.nodeType, label: node.data.label })),
      edgesRef.current.map((edge) => ({ source: edge.source })),
    );
    const blockers: string[] = [];
    // 연계 캔버스는 start·대표끝이 없는 게 정상 — 두 조건은 일반 맵에만 (2026-08-28 개선)
    if (!isFrameworkMap && !states.start) blockers.push(t("save.checkOneStart"));
    if (!isFrameworkMap && !states.primaryEnd) blockers.push(t("save.checkPrimaryEnd"));
    if (!states.endUnique) blockers.push(t("save.checkUniqueEnd"));
    if (!states.singleOutput) blockers.push(t("save.checkSingleOutput"));
    return blockers;
  }, [t, isFrameworkMap]);

  const handleSave = useCallback(async () => {
    const blockers = getSaveBlockers();
    if (blockers.length > 0) {
      showToast(`${t("save.blockedTitle")}: ${blockers.join(", ")}`);
      return;
    }
    try {
      await saveCurrentScope();
    } catch (err) {
      // 저장 실패(예: 시작/끝 노드 없음)는 상단 배너 대신 토스트로 안내 (#7)
      showToast(humanizeApiError(err, t), "error");
    }
  }, [getSaveBlockers, saveCurrentScope, showToast, t]);

  // 승인 요청(승인 시작) 전 현재 화면을 먼저 저장 — 저장된 구버전이 아니라 "지금 보는 내용"이
  // 승인 대상이 되도록. 저장 조건 미충족이거나 저장 실패면 승인 요청 다이얼로그를 열지 않는다.
  const handleSubmitForApproval = useCallback(
    async (at?: { x: number; y: number }) => {
      const blockers = getSaveBlockers();
      if (blockers.length > 0) {
        showToast(`${t("save.blockedTitle")}: ${blockers.join(", ")}`);
        return;
      }
      try {
        await saveCurrentScope();
      } catch (err) {
        showToast(humanizeApiError(err, t), "error");
        return;
      }
      // 동봉 선택은 오픈 시점에 리셋 — dismiss(Escape/바깥클릭/닫기) 경로는 confirm과 달리 값을 지우지
      // 않으므로, 이전 취소된 선택이 다음 오픈에 미리 선택된 채로 남아 의도치 않은 동봉을 유발할 수 있다.
      setBundleValue(null);
      // 승인자가 본인 1인이면 클릭 지점에 셀프 게시(승인요청→승인→게시) 제안 — No/닫기는 기존 플로우.
      if (at && username !== null && isSoleSelfApprover(workflow?.approvers ?? [], username)) {
        setSelfPublishPrompt(at);
        return;
      }
      setTransitionComment("");
      setSubmitConfirmOpen(true);
    },
    [getSaveBlockers, saveCurrentScope, showToast, t, username, workflow],
  );

  // 저장(그래프 검증) 조건 — 현재 스코프 노드 기준 라이브 계산(좌상단 체크리스트). 백엔드 validate_process와 정합:
  // 시작 정확히 1개 / 끝 이름(빈 제목 포함) 중복 없음 / 대표 끝 1개(끝 노드 최소 1개면 저장 시 자동 1개 지정).
  // 문제 노드(잘못된 다중 연결)로 이동+선택 하이라이트 — 체크리스트 항목 클릭 시.
  const locateProblemNodes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const idSet = new Set(ids);
      setSelectedEdgeId(null);
      setSelectedId(ids.length === 1 ? ids[0] : null);
      setNodes((current) =>
        current.map((node) =>
          node.selected === idSet.has(node.id) ? node : { ...node, selected: idSet.has(node.id) },
        ),
      );
      void reactFlow.fitView({
        nodes: ids.map((id) => ({ id })),
        padding: 0.4,
        duration: 400,
        maxZoom: 1.3,
      });
    },
    [reactFlow, setNodes],
  );

  const saveCheckItems = useMemo<SaveCheckItem[]>(() => {
    const simpleNodes = nodes.map((node) => ({
      id: node.id,
      nodeType: node.data.nodeType,
      label: node.data.label,
    }));
    const simpleEdges = edges.map((edge) => ({ source: edge.source }));
    const states = getSaveCheckStates(simpleNodes, simpleEdges);
    const problemIds = getMultiOutputNodeIds(simpleNodes, simpleEdges);
    return [
      { key: "start", label: t("save.checkOneStart"), ok: states.start },
      { key: "primaryEnd", label: t("save.checkPrimaryEnd"), ok: states.primaryEnd },
      { key: "endUnique", label: t("save.checkUniqueEnd"), ok: states.endUnique },
      {
        key: "singleOutput",
        label: t("save.checkSingleOutput"),
        ok: states.singleOutput,
        onLocate: problemIds.length > 0 ? () => locateProblemNodes(problemIds) : undefined,
      },
    ];
  }, [nodes, edges, t, locateProblemNodes]);

  const defaultGeom = (index: number, b: { w: number; h: number }): WindowGeom => {
    const step = 36;
    const w = Math.min(760, Math.round(b.w * 0.82));
    const h = Math.min(500, Math.round(b.h * 0.82));
    return { x: index * step, y: index * step, w, h, minimized: false, maximized: false };
  };

  // AI 창 기본 기하 — 우측에 도킹된 좁은 패널(처음 열 때). 이후 이동/리사이즈는 windowGeom["ai"]에 영속.
  const aiDefaultGeom = (b: { w: number; h: number }): WindowGeom => {
    const w = 340;
    const h = Math.min(440, Math.max(280, Math.round(b.h * 0.7)));
    return { x: Math.max(0, b.w - w - 16), y: 16, w, h, minimized: false, maximized: false };
  };

  const bringToFront = useCallback((key: string) => {
    setZOrder((order) => [...order.filter((k) => k !== key), key]);
  }, []);

  // 계층 진입/이탈 시 현재 스코프를 저장하고 이동 (편집 손실 방지). 읽기전용 딥뷰를 떠날 땐 저장 생략.
  const navigateTo = useCallback(
    async (nextScopes: Scope[]) => {
      // 딥뷰(읽기전용)에선 저장할 변경이 없음 — saveCurrentScope 자체도 ref 가드로 no-op이지만 명시적으로도 건너뛴다.
      if (!currentScopeIsReadOnlyRef.current) {
        try {
          await saveCurrentScope();
        } catch (err) {
          setStatus(humanizeApiError(err, t));
          return;
        }
      }
      setScopes(nextScopes);
      setActiveIndex(nextScopes.length - 1);
    },
    [saveCurrentScope, t],
  );

  // 특정 노드의 스코프를 활성화하는 스코프 체인(루트→…→그 노드). null이면 루트.
  const buildScopesTo = useCallback(
    (scopeNodeId: string | null): Scope[] => {
      const fg = fullGraphRef.current;
      if (!fg || scopeNodeId === null) {
        return [{ kind: "root", title: mapName }];
      }
      const byId = new Map(fg.nodes.map((node) => [node.id, node]));
      const chain: FlatNode[] = [];
      let cur = byId.get(scopeNodeId);
      while (cur) {
        chain.unshift(cur);
        cur = cur.parent_node_id ? byId.get(cur.parent_node_id) : undefined;
      }
      return [{ kind: "root", title: mapName }, ...chain.map(flatToSubScope)];
    },
    [mapName],
  );

  // 포커스(Path 2) — 자식을 navigateTo로 진짜 nodes化하되, 카메라를 offset×zoom만큼 옮겨 자식이 레인 자리에
  // 그대로 보이게(시각적 무이동). 편집·저장은 네이티브(스코프상대 좌표 그대로). 스코프 로드 효과가 이 ref를 읽어 적용.
  const focusCamRef = useRef<{ shift: { x: number; y: number }; vp: { x: number; y: number; zoom: number } } | null>(null);

  // (하위프로세스 딥뷰 드릴인은 봉인됨 — 인라인 펼침과의 이중 렌더/오프스크린 창 고장으로 임베드 자식
  // 더블클릭 진입로를 제거. 스코프 창 머신(navigateTo/scopes)은 포커스 모드 등 다른 경로가 계속 사용.)

  // 창 포커스 — 현재 활성 스코프를 저장하고 해당 창을 라이브로 전환(스코프 체인은 유지)
  const focusScope = useCallback(
    async (index: number) => {
      if (index === activeIndex) {
        return;
      }
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
        return;
      }
      setActiveIndex(index);
      // 최외곽(루트) 캔버스를 포커스하면 떠 있던 드릴인 창들을 최소화(좌하단 dock)
      if (index === 0) {
        setWindowGeom((map) => {
          const next = { ...map };
          scopes.forEach((scope, i) => {
            if (i === 0) {
              return;
            }
            const key = scopeKey(scope);
            const base = next[key] ?? defaultGeom(i, bounds);
            next[key] = { ...base, minimized: true };
          });
          return next;
        });
      }
    },
    [activeIndex, saveCurrentScope, scopes, bounds, t],
  );

  // 창 닫기 — 그 창과 하위(더 깊은 창) 모두 닫고 상위로 복귀
  const closeScope = useCallback(
    (index: number) => {
      if (index <= 0) {
        return;
      }
      void navigateTo(scopes.slice(0, index));
    },
    [navigateTo, scopes],
  );

  // 명시적 접기 의도 — 이 사이클 동안 scope-load effect가 re-add/keep하지 말아야 할 host들. 사용 즉시 클리어.
  // Explicit-collapse intent: hosts the scope-load effect must NOT re-inline THIS cycle. Cleared immediately after use.
  const collapseIntentRef = useRef<Set<string>>(new Set());

  // 하위프로세스 행 접기 — 드릴인(scopes)으로 펼친 host면 스코프를 pop하며 가드 표시(effect가 re-inline 안 함),
  // 인라인으로만 펼친 host면 기존 토글로 제거. 펼치기 방향은 기존 경로 유지(이 헬퍼는 접기 전용).
  const collapseSubprocessRow = useCallback(
    (id: string) => {
      const scopeIdx = scopes.findIndex((s) => scopeHostId(s) === id);
      if (scopeIdx > 0) {
        // idx 0 = root; >0 = drilled via scopes
        // 이 host + 그 하위 스코프 host 전체(결정 ②: 중간 접기=하위 닫힘)를 가드에 표시.
        for (const s of scopes.slice(scopeIdx)) {
          const h = scopeHostId(s);
          if (h != null) {
            collapseIntentRef.current.add(h);
          }
        }
        void navigateTo(scopes.slice(0, scopeIdx)); // scope pop → triggers the scope-load effect, which consumes the guard
        return;
      }
      if (expandedInline.has(id)) {
        toggleInlineExpandRef.current?.(id); // 인라인으로만 펼친 경우 — 기존 토글로 제거(effect 무관)
      }
    },
    [scopes, navigateTo, expandedInline],
  );
  // 버전 전환 — 현재 스코프 저장 후 루트로 리셋해 새 버전 캔버스를 로드
  const switchVersion = useCallback(
    async (nextVersionId: number) => {
      try {
        await saveCurrentScope();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
        return;
      }
      setVersionId(nextVersionId);
      setScopes([{ kind: "root", title: mapName }]);
      setActiveIndex(0);
    },
    [saveCurrentScope, mapName, t],
  );

  // 타임라인 '이 버전으로 가기' — 편집 중이면 VersionPill과 동일한 전환 확인 모달을 거친다 (feedback 2026-08-14)
  const [goVersionPrompt, setGoVersionPrompt] = useState<VersionSummary | null>(null);
  const requestGoToVersion = (id: number) => {
    if (id === versionId) return;
    const target = versions.find((v) => v.id === id);
    if (!target) return;
    if (!readOnly) setGoVersionPrompt(target);
    else void switchVersion(id);
  };

  // 네이티브 prompt/confirm 대신 플로팅 모달 — 버전 생성/이름변경 입력, 삭제 확인.
  const [versionDialog, setVersionDialog] = useState<{ mode: "create" | "rename" } | null>(null);
  const [deleteVersionOpen, setDeleteVersionOpen] = useState(false);
  // 펼침 레인 헤더 "링크맵 열기" 확인 — 에디터 이탈이라 미저장 경고 후 이동 (F6)
  const [openMapPrompt, setOpenMapPrompt] = useState<{ mapId: number; name: string } | null>(null);

  // 레인 헤더의 열기 버튼/영역 우클릭 메뉴 → 호스트 노드의 링크 대상 맵 해석 후 확인 모달.
  // menuItems useMemo의 dep이라 useCallback으로 identity 고정(ref+setter만 읽어 deps 없음).
  const promptOpenLinkedMap = useCallback((hostId: string) => {
    const host = fullGraphRef.current?.nodes.find((node) => node.id === hostId);
    if (host?.linked_map_id != null) {
      setOpenMapPrompt({ mapId: host.linked_map_id, name: host.title });
    }
  }, []);

  // 트리비얼 핸들러는 plain 함수로 — React Compiler 자동 메모(수동 useCallback은 setter 추론과 충돌).
  const handleCreateVersion = () => {
    if (versionId === null) {
      return;
    }
    setVersionDialog({ mode: "create" });
  };

  const handleRenameVersion = () => {
    if (versionId === null) {
      return;
    }
    setVersionDialog({ mode: "rename" });
  };

  // 버전 생성/이름변경 모달 제출 — mode에 따라 분기
  const submitVersionDialog = async (label: string) => {
    if (versionId === null || versionDialog === null) {
      return;
    }
    const mode = versionDialog.mode;
    setVersionDialog(null);
    if (mode === "create") {
      try {
        await saveCurrentScope();
        const created = await createVersion(mapId, label, versionId);
        const detail = await getMap(mapId);
        setVersions(detail.versions);
        setVersionId(created.id);
        setScopes([{ kind: "root", title: mapName }]);
        setActiveIndex(0);
      } catch (err) {
        // 진행 중 드래프트가 있으면 새 버전 생성 차단(409) — 토스트로 안내 (request #11)
        const isDraftConflict = err instanceof ApiError && err.status === 409;
        showToast(isDraftConflict ? t("err.versionDraftExists") : t("err.createVersion"), "error");
      }
    } else {
      try {
        await renameVersion(versionId, label);
        const detail = await getMap(mapId);
        setVersions(detail.versions);
      } catch (err) {
        setStatus(humanizeApiError(err, t));
      }
    }
  };

  const handleDeleteVersion = () => {
    if (versionId === null || versions.length <= 1) {
      return;
    }
    setDeleteVersionOpen(true);
  };

  const confirmDeleteVersion = async () => {
    setDeleteVersionOpen(false);
    if (versionId === null || versions.length <= 1) {
      return;
    }
    try {
      await deleteVersion(versionId);
      const detail = await getMap(mapId);
      setVersions(detail.versions);
      setVersionId(detail.versions[0].id);
      setScopes([{ kind: "root", title: mapName }]);
      setActiveIndex(0);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // ── 점유권 요청·결정·이전·재게시 핸들러 (§6.3) ──────────

  // 편집권한 요청 — 현 미보유 편집자가 보유자에게 요청
  const handleRequestCheckout = async () => {
    if (versionId === null) return;
    try {
      await requestCheckout(versionId);
      await refreshWorkflow();
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 편집권한 요청 결정 — 보유자/소유자/sysadmin이 승인 또는 거절
  const handleDecideCheckout = async (requestId: number, approve: boolean) => {
    try {
      await decideCheckoutRequest(requestId, approve);
      await refreshWorkflow();
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  const handleWithdrawCheckout = async (requestId: number) => {
    try {
      await withdrawCheckoutRequest(requestId);
      await refreshWorkflow();
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 점유권 이전 다이얼로그 열기 — 편집자 목록 로드 후 오픈
  const handleTransferOpen = async () => {
    if (versionId === null) return;
    try {
      const editors = await getMapEditors(mapId);
      const others = editors.filter((e) => e.id !== username);
      setTransferEditors(others);
      setTransferTarget(others[0]?.id ?? "");
      setTransferOpen(true);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 점유권 이전 확인
  const handleConfirmTransfer = async () => {
    if (versionId === null || !transferTarget) return;
    setTransferOpen(false);
    try {
      await transferCheckout(versionId, transferTarget);
      await refreshWorkflow();
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 재게시 확인 — 만료 버전에서 새 draft 생성 후 해당 draft로 전환
  const handleConfirmRepublish = async () => {
    setRepublishConfirmOpen(false);
    if (versionId === null) return;
    try {
      const newDraft = await republishVersion(versionId);
      const detail = await getMap(mapId);
      setVersions(detail.versions);
      setVersionId(newDraft.id);
      setScopes([{ kind: "root", title: mapName }]);
      setActiveIndex(0);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 워크플로우 전이 — updated VersionSummary를 versions에 머지하고 workflow 갱신
  const runTransition = useCallback(
    async (action: (id: number) => Promise<VersionSummary>) => {
      if (versionId === null) return;
      try {
        await action(versionId);
        // 전체 버전 재로딩 — 게시 시 직전 published→expired 반영(우측에 published 2개 방지).
        const detail = await getMap(mapId);
        setVersions(detail.versions);
        // 동봉 가시성 변경(셀프 게시 체인 포함)이 서버에 반영된 뒤 픽커의 current 소스도 갱신 — 안 하면 다음 동봉 선택이 구 값 기준.
        setMapVisibility(detail.visibility);
        // 동봉 픽커 게이트(오너 전용)도 같은 스냅샷으로 — 권한이 바뀌었으면 즉시 반영.
        setMyRole(detail.my_role);
        // 하단 버전 기록(MapDetailCard) 실시간 갱신 — 단계 이벤트 추가/상태 변경 반영.
        setVersionsReloadKey((k) => k + 1);
        await refreshWorkflow();
      } catch (err) {
        setStatus(humanizeApiError(err, t));
      }
    },
    [versionId, mapId, refreshWorkflow, t],
  );

  // ── 편집 조작 (모두 히스토리 + 자동 저장 대상) ─────────

  // 라벨 지정해 엣지 생성 (기본은 빈 라벨)
  const createEdge = useCallback(
    (connection: Connection, label: string) => {
      pushHistory();
      // 기본 출발/도착 면을 source=오른쪽 / target=왼쪽으로 고정 — 잡은 핸들 면에 의존하지 않게
      // (끝 노드를 후속으로 끌면 왼쪽 핸들이 잡혀 시작이 왼쪽이 되던 문제). 면 변경은 엣지 우클릭 메뉴로.
      // 예외: decision(분기를 여러 면에 분산) source·subprocess(전용 in/__primary__ 핸들) 끝점은 잡은 핸들 유지.
      const sourceNode = nodesRef.current.find((n) => n.id === connection.source);
      const targetNode = nodesRef.current.find((n) => n.id === connection.target);
      const keepSource =
        sourceNode?.data.nodeType === "decision" || sourceNode?.data.nodeType === "subprocess";
      const keepTarget = targetNode?.data.nodeType === "subprocess";
      const sourceHandle = keepSource ? connection.sourceHandle : sourceHandleId("right");
      const targetHandle = keepTarget ? connection.targetHandle : targetHandleId("left");
      // 출력 1개 충돌(이미 출력 있음)은 onConnect에서 삽입/교체/취소 모달로 처리 — 여기선 단순 추가.
      setEdges((current) =>
        addEdge(
          {
            ...getEdgeDefaults(),
            ...connection,
            sourceHandle,
            targetHandle,
            id: genId(),
            label: label || undefined,
          },
          current,
        ),
      );
      scheduleAutoSave();
    },
    [pushHistory, setEdges, scheduleAutoSave],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) {
        return;
      }
      // A↔B 1:1 회귀 차단 — 역행은 Decision 노드로 우회하도록 안내(토스트)
      if (
        connection.source &&
        connection.target &&
        hasReciprocalEdge(edgesRef.current, connection.source, connection.target)
      ) {
        showToast(t("edge.reciprocalBlocked"));
        return;
      }
      // 판단(decision) 노드에서 나가는 연결 → Yes/No/기타 선택 모달, 그 외는 즉시 생성
      const source = nodesRef.current.find((node) => node.id === connection.source);
      if (source?.data.nodeType === "decision") {
        setBranchPrompt({
          kind: "connection",
          connection,
          at: { ...pointerScreenRef.current },
        });
        return;
      }
      // 출력 1개 — 이미 출력이 있으면 삽입/교체/취소 모달(마우스 위치). 없으면 즉시 생성.
      if (connection.source && getOutgoingEdges(edgesRef.current, connection.source).length > 0) {
        setEdgeAction({
          source: connection.source,
          target: connection.target ?? "",
          at: { ...pointerScreenRef.current },
        });
        return;
      }
      createEdge(connection, "");
    },
    [readOnly, createEdge, showToast, t],
  );

  // 연결 제약 — 시작 노드는 도착(들어오는 연결) 불가/끝 노드는 출발 불가(터미널).
  // A↔B 회귀는 여기서 막지 않고 onConnect에서 토스트로 안내(Decision 우회 유도).
  const isValidConnection = useCallback((connection: Connection | Edge): boolean => {
    const sourceType = nodesRef.current.find((node) => node.id === connection.source)?.data
      .nodeType;
    const targetType = nodesRef.current.find((node) => node.id === connection.target)?.data
      .nodeType;
    return !violatesTerminalRule(sourceType, targetType);
  }, []);

  // 몸체 드롭 빠른 연결 — 핸들 미포착 드롭(isValid 아님)이 노드 위에서 끝나면 기본 핸들
  // (정방향=왼쪽 타깃, 역방향=오른쪽 소스)로 연결. 판정은 미리보기(QuickConnectLine)와 공유.
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (readOnly || connectionState.isValid) return;
      const { fromNode, fromHandle } = connectionState;
      if (!fromNode || !fromHandle) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const nodeEl = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest(".react-flow__node");
      const overId = nodeEl?.getAttribute("data-id");
      if (!overId || overId === fromNode.id) return;
      // 루트 스코프 노드만 — 임베드 자식/고스트는 nodes state에 없어 자연 제외
      const over = nodesRef.current.find((n) => n.id === overId);
      if (!over) return;
      const reverse = fromHandle.type === "target";
      // FinalConnectionState의 fromNode.data는 제네릭(Record) — 우리 노드 데이터로 좁혀 읽는다
      const fromType = (fromNode.data as AppNode["data"]).nodeType;
      if (!canQuickConnect(fromType, over.data.nodeType, reverse)) return;
      const connection: Connection = reverse
        ? {
            source: over.id,
            sourceHandle: sourceHandleId("right"),
            target: fromNode.id,
            targetHandle: fromHandle.id ?? null,
          }
        : {
            source: fromNode.id,
            sourceHandle: fromHandle.id ?? null,
            target: over.id,
            targetHandle: getQuickTargetHandleId(over.data.nodeType),
          };
      if (!isValidConnection(connection)) return;
      onConnect(connection);
    },
    [readOnly, isValidConnection, onConnect],
  );

  // 드롭존 흐름 삽입이 시작/끝 규칙을 어기는지 — front=A→B(드래그→대상), back=B→A(대상→드래그).
  // 핸들 드래그(isValidConnection)와 동일 규칙을 드롭존에도 적용 (양방향 모두 고려).
  const flowZoneViolates = useCallback(
    (draggedId: string, targetId: string, zone: DropZone): boolean => {
      const draggedType = nodesRef.current.find((node) => node.id === draggedId)?.data.nodeType;
      const targetType = nodesRef.current.find((node) => node.id === targetId)?.data.nodeType;
      if (zone === "front") {
        return violatesTerminalRule(draggedType, targetType);
      }
      if (zone === "back") {
        return violatesTerminalRule(targetType, draggedType);
      }
      if (zone === "swap") {
        // 스왑은 비터미널끼리(decision↔일반 포함) 허용, start/end는 동종만 — 불허면 무효(드롭존 흐림).
        return !canSwapTypes(draggedType, targetType);
      }
      return false;
    },
    [],
  );

  // 분기 모달 선택 → 라벨(Yes/No/빈값=기타) 적용. 드래그 연결·노드 드롭 삽입 모두 "선택 시점"에 엣지를 생성한다.
  const handlePickBranch = useCallback(
    (kind: BranchKind) => {
      const label = kind === "yes" ? BRANCH_YES_LABEL : kind === "no" ? BRANCH_NO_LABEL : "";
      if (branchPrompt?.kind === "connection") {
        createEdge(branchPrompt.connection, label);
      } else if (branchPrompt?.kind === "pendingInsert") {
        // 보류했던 삽입을 이제 적용 — fresh 엣지에 분기 라벨 부여.
        const { nextEdges, freshId } = branchPrompt;
        setEdges(
          nextEdges.map((edge) =>
            edge.id === freshId ? { ...edge, label: label || undefined } : edge,
          ),
        );
        scheduleAutoSave();
      }
      setBranchPrompt(null);
    },
    [branchPrompt, createEdge, setEdges, scheduleAutoSave],
  );

  // 새 노드가 기존 노드와 겹치지 않도록 충돌 시 대각선으로 밀어 빈 자리 탐색
  const findFreeSpot = useCallback((x: number, y: number) => {
    const hit = (px: number, py: number) =>
      nodesRef.current.some(
        (n) =>
          Math.abs(n.position.x - px) < NODE_WIDTH * 0.7 &&
          Math.abs(n.position.y - py) < NODE_HEIGHT * 0.7,
      );
    let pos = { x, y };
    let guard = 0;
    while (hit(pos.x, pos.y) && guard < 60) {
      pos = { x: pos.x + 28, y: pos.y + 28 };
      guard += 1;
    }
    return pos;
  }, []);

  // 새로 생성한 노드를 페이드로 한 번 반짝여 위치를 알림(.bpm-node-flash) → 850ms 후 클래스 제거
  const flashNode = useCallback(
    (id: string) => {
      window.setTimeout(() => {
        setNodes((cur) => cur.map((n) => (n.id === id ? { ...n, className: undefined } : n)));
      }, 850);
    },
    [setNodes],
  );

  // screen 좌표가 주어지면(컨텍스트 메뉴) 커서가 노드 중심이 되도록 생성
  const handleAddNode = useCallback(
    (screen: { x: number; y: number } | null, nodeType: ProcessNodeType = "process") => {
      if (readOnly) {
        return;
      }
      if (isFrameworkMap && nodeType !== "decision" && nodeType !== "end") {
        return; // 캔버스는 subprocess 링크+분기·끝만 — 서버 422의 클라 선제 차단 (2026-08-28 개선)
      }
      // 시작 노드는 맵당 1개만 — 이미 있으면 추가 대신 안내 후 기존 시작 노드로 포커스 이동.
      if (nodeType === "start") {
        const existingStart = nodesRef.current.find((node) => node.data.nodeType === "start");
        if (existingStart) {
          showToast(t("editor.startSingleton"));
          highlightNode(existingStart.id);
          return;
        }
      }
      pushHistory();
      const id = genId();
      const count = nodesRef.current.length;
      let position = { x: 80 + count * 30, y: 80 + count * 30 };
      if (screen) {
        const point = toSavedPoint(reactFlow.screenToFlowPosition(screen));
        position = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
      } else {
        // 좌측 팔레트 등 좌표 없는 추가 — 현재 뷰포트 중앙에 배치
        const container = canvasContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const point = toSavedPoint(
            reactFlow.screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            }),
          );
          position = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
        }
      }
      // 같은 자리에 겹치지 않도록 빈 자리로 보정
      position = findFreeSpot(position.x, position.y);
      setNodes((current) => [
        ...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        {
          id,
          type: "process",
          position,
          selected: true,
          // 생성 위치를 알 수 있도록 잠깐 페이드 반짝(클래스는 flashNode가 제거)
          className: "bpm-node-flash",
          // start/end는 기본 공란(표시는 terminalDisplayLabel이 "Start"/"End"로) — 그 외는 "New step" (#2)
          data: buildNodeData(
            nodeType,
            nodeType === "start" || nodeType === "end"
              ? ""
              : makeUniqueLabel(
                  t("editor.newStep"),
                  current.map((node) => node.data.label),
                ),
          ),
        },
      ]);
      setSelectedId(id);
      setSelectedEdgeId(null);
      scheduleAutoSave();
      flashNode(id);
    },
    [
      readOnly,
      pushHistory,
      reactFlow,
      setNodes,
      scheduleAutoSave,
      t,
      findFreeSpot,
      flashNode,
      showToast,
      highlightNode,
      toSavedPoint,
      isFrameworkMap,
    ],
  );

  // Ctrl+C — 선택 노드 중 복사 가능한 것(process/decision/end)만 + 내부 엣지를 클립보드에 저장(다른 탭·맵 붙여넣기 가능).
  const handleCopy = useCallback(() => {
    const selected = nodesRef.current.filter(
      (node) => node.selected && isCopyableNodeType(node.data.nodeType),
    );
    if (selected.length === 0) {
      showToast(t("copy.blocked"));
      return;
    }
    const ids = new Set(selected.map((node) => node.id));
    writeClipboard({
      sourceMapId: mapId,
      nodes: selected.map((node) => ({ id: node.id, position: node.position, data: node.data })),
      edges: edgesRef.current
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: typeof edge.label === "string" ? edge.label : undefined,
          sourceHandle: edge.sourceHandle ?? undefined,
          targetHandle: edge.targetHandle ?? undefined,
          type: edge.type,
        })),
    });
    // 새로 복사하면 다음 붙여넣기는 누적 오프셋 없이 1부터 다시 시작.
    pasteSeqRef.current = 0;
    pasteClipSigRef.current = null;
  }, [mapId, showToast, t]);

  // Ctrl+V — 같은 맵이면 {16,16}×연속횟수 누적 오프셋(대각선 이동, 겹침 방지), 다른 맵(다른 탭 포함)이면
  // 현재 뷰포트 중앙 기준으로 배치. 같은 클립보드 내용을 연속 붙여넣을 때만 누적 — 새로 복사하면 1로 리셋.
  const handlePaste = useCallback(() => {
    if (readOnly) {
      return;
    }
    const clip = readClipboard();
    if (!clip) {
      return;
    }
    let offset = { x: 16, y: 16 };
    if (clip.sourceMapId === mapId) {
      const sig = JSON.stringify(clip);
      pasteSeqRef.current = pasteClipSigRef.current === sig ? pasteSeqRef.current + 1 : 1;
      pasteClipSigRef.current = sig;
      offset = { x: 16 * pasteSeqRef.current, y: 16 * pasteSeqRef.current };
    } else {
      const container = canvasContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const center = toSavedPoint(
          reactFlow.screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          }),
        );
        const minX = Math.min(...clip.nodes.map((n) => n.position.x));
        const maxX = Math.max(...clip.nodes.map((n) => n.position.x)) + NODE_WIDTH;
        const minY = Math.min(...clip.nodes.map((n) => n.position.y));
        const maxY = Math.max(...clip.nodes.map((n) => n.position.y)) + NODE_HEIGHT;
        offset = { x: center.x - (minX + maxX) / 2, y: center.y - (minY + maxY) / 2 };
      }
    }
    const { nodes: pastedNodesRaw, edges: pastedEdges } = buildPaste(clip, {
      newId: genId,
      existingLabels: nodesRef.current.map((node) => node.data.label),
      offset,
    });
    if (pastedNodesRaw.length === 0) {
      return;
    }
    // 단일 노드는 기존 노드와 안 겹치도록 보정(handleAddNode와 동일 로직) — 다중은 그룹 형태 보존을 위해
    // 공유 오프셋만 적용(개별 findFreeSpot을 걸면 상대 배치가 깨진다).
    const pastedNodes =
      pastedNodesRaw.length === 1
        ? [
            {
              ...pastedNodesRaw[0],
              position: findFreeSpot(pastedNodesRaw[0].position.x, pastedNodesRaw[0].position.y),
            },
          ]
        : pastedNodesRaw;
    pushHistory();
    setNodes((current) => [
      ...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      ...pastedNodes.map((node) => ({
        id: node.id,
        type: "process" as const,
        position: node.position,
        selected: true,
        className: "bpm-node-flash",
        data: node.data,
      })),
    ]);
    if (pastedEdges.length > 0) {
      setEdges((current) => [
        ...current,
        ...pastedEdges.map((edge) => ({
          ...getEdgeDefaults(),
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? sourceHandleId("right"),
          targetHandle: edge.targetHandle ?? targetHandleId("left"),
          label: edge.label || undefined,
          // 원본 엣지의 선 모양 보존 — 구 클립보드(type 없음)는 생성 기본값
          type: edge.type ?? getNewEdgeLineStyle(),
        })),
      ]);
    }
    setSelectedId(pastedNodes.length === 1 ? pastedNodes[0].id : null);
    setSelectedEdgeId(null);
    for (const node of pastedNodes) {
      flashNode(node.id);
    }
    scheduleAutoSave();
    showToast(t("copy.pasted", { n: pastedNodes.length }));
  }, [
    readOnly,
    mapId,
    reactFlow,
    setNodes,
    setEdges,
    pushHistory,
    scheduleAutoSave,
    flashNode,
    showToast,
    t,
    findFreeSpot,
    toSavedPoint,
  ]);

  // Ctrl/⌘+드래그 시작 — 복사 가능 노드(process/decision/end)의 원위치 잔상을 캡처해 사본 모드를 켠다.
  // 복사 불가 노드가 섞이면 토스트만(그 노드는 그대로 이동, 사본 없음).
  // grabbedId — 잡은 노드 id(선택박스 오버레이 드래그는 null). RF의 multiSelectionKeyCode(=Ctrl/⌘)가 이 기능
  // 트리거 키와 겹쳐, 잡은 노드가 잔여 선택에 딸려 들어간다. 잡은 노드가 mousedown 직전에 이미 선택돼 있었으면
  // "의도된 선택 드래그"(선택 집합 전체 복제), 아니면 잔여 선택을 무시하고 잡은 노드만 복제.
  const beginCtrlDrag = useCallback(
    (isCtrl: boolean, grabbedId: string | null, dragged: AppNode[]) => {
      if (!isCtrl || readOnly) {
        return;
      }
      ctrlDragConsumedRef.current = false; // 새 제스처 시작 — 사본 확정 래치 해제
      const usePriorSelection =
        grabbedId === null || preMousedownSelectedRef.current.has(grabbedId);
      const intended = usePriorSelection
        ? dragged
        : dragged.filter((node) => node.id === grabbedId);
      const copyable = intended.filter((node) => isCopyableNodeType(node.data.nodeType));
      if (copyable.length < intended.length) {
        showToast(t("copy.blocked"));
      }
      if (copyable.length === 0) {
        return;
      }
      setCtrlDragGhosts(
        copyable.map((node) => ({ id: node.id, position: { ...node.position }, data: node.data })),
      );
      setCtrlDragActive(true);
    },
    [readOnly, showToast, t],
  );

  // Ctrl/⌘+드래그 드롭 확정 — 복사 가능 노드(ctrlDragGhosts)는 원위치로 되돌리고 드롭 위치(RF가 이미 반영한
  // 최신 좌표)에 사본을 생성(id/라벨 dedup). 선택에 섞였던 복사불가 노드는 이미 이동한 위치 그대로 둔다.
  // 사본만 선택 상태로 남긴다(단일=인스펙터 포커스, 다중=null).
  const applyCtrlDragCopy = useCallback(() => {
    // 제스처당 1회만 — RF가 onNodeDragStop·onSelectionDragStop을 둘 다 발화해도 두 번째 호출은 무시(2×N 방지).
    if (ctrlDragConsumedRef.current) {
      return;
    }
    ctrlDragConsumedRef.current = true;
    const ghosts = ctrlDragGhosts;
    if (ghosts.length === 0) {
      return;
    }
    const ghostById = new Map(ghosts.map((g) => [g.id, g]));
    // id/라벨은 setNodes 밖에서 먼저 확정 — updater는 순수해야 함(StrictMode 이중호출에도 안전).
    const existingLabels = nodesRef.current.map((node) => node.data.label);
    // ghost.position은 RF 보고값(표시좌표) — 인라인 펼침으로 footprint-shift된 노드는 저장좌표로 환산해
    // 원위치를 복원해야 표시좌표가 저장좌표로 박히는 드리프트가 없다(#3b). 미펼침이면 오프셋 0(동일).
    // height-shift(#1) 오프셋도 같은 이유로 빼야 한다(C2) — inline offset을 먼저 뺀 뒤 y만 역변환.
    const rootOffsets = inlineCompositionRef.current?.rootOffsets;
    const plans = new Map<string, { copyId: string; label: string; resetPos: { x: number; y: number } }>();
    for (const ghost of ghosts) {
      const label = makeCopyLabel(ghost.data.label, existingLabels);
      existingLabels.push(label);
      const offset = rootOffsets?.get(ghost.id);
      const resetPos = {
        x: offset ? ghost.position.x - offset.x : ghost.position.x,
        y: displayToSavedX(ghost.position.y - (offset?.y ?? 0), yStepsRef.current),
      };
      plans.set(ghost.id, { copyId: genId(), label, resetPos });
    }
    setNodes((current) => {
      const copies: AppNode[] = [];
      const next = current.map((node) => {
        const ghost = ghostById.get(node.id);
        const plan = ghost ? plans.get(node.id) : undefined;
        if (!ghost || !plan) {
          return node.selected ? { ...node, selected: false } : node;
        }
        copies.push({
          id: plan.copyId,
          type: "process",
          position: { ...node.position },
          selected: true,
          // 사본은 원본 그룹 소속·대표끝 지정을 물려받지 않음 — Ctrl+C/V 붙여넣기와 동일 관례(node-clipboard.ts buildPaste).
          // output_ids는 소거 — itemId가 중복되면 원본 판정이 깨진다(io-linking §6). *_links/input_flags는 유지(사본도 같은 원본의 미러).
          data: { ...ghost.data, label: plan.label, groupIds: [], isPrimaryEnd: false, output_ids: "" },
        });
        return { ...node, position: plan.resetPos, selected: false };
      });
      return [...next, ...copies];
    });
    // 선택 집합 내부 엣지도 함께 복제 — Ctrl+C/V(handleCopy·buildPaste)와 동일 관례.
    // 새 엣지 id(genId)는 updater 밖에서 확정 — updater가 이중 호출돼도 id를 재발급하지 않게(순수성).
    const newEdges = edgesRef.current
      .filter((edge) => plans.has(edge.source) && plans.has(edge.target))
      .map((edge) => ({
        ...getEdgeDefaults(),
        id: genId(),
        source: plans.get(edge.source)!.copyId,
        target: plans.get(edge.target)!.copyId,
        // 원본 엣지가 붙어 있던 변(핸들)·선 모양을 보존 — 없을 때만 기본값(우→좌). Ctrl+C/V(handlePaste)와 동일 관례.
        sourceHandle: edge.sourceHandle ?? sourceHandleId("right"),
        targetHandle: edge.targetHandle ?? targetHandleId("left"),
        label: typeof edge.label === "string" ? edge.label : undefined,
        type: edge.type ?? getNewEdgeLineStyle(),
      }));
    if (newEdges.length > 0) {
      setEdges((current) => [...current, ...newEdges]);
    }
    const single = ghosts.length === 1 ? plans.get(ghosts[0].id) : undefined;
    setSelectedId(single ? single.copyId : null);
    setSelectedEdgeId(null);
    scheduleAutoSave();
  }, [ctrlDragGhosts, setNodes, setEdges, scheduleAutoSave]);

  // 정렬/레이아웃 버튼 공통 래퍼 — 변경 전 스냅샷 기록 + 자동 저장
  const applyNodesTransform = useCallback(
    (transform: (current: AppNode[]) => AppNode[]) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes(transform);
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, scheduleAutoSave],
  );

  // 자동정렬(가로/세로) — 전체는 dagre + 척추(시작→대표 끝) 직선화 + 엣지 핸들 재지정(lib/flow-layout),
  // ids(2개 이상)가 오면 그 부분만 방향 dagre(직선화·핸들 변경 없음). 노드·엣지 한 스냅샷 = undo 1회.
  const applyAutoLayout = useCallback(
    (dir: FlowDir, ids?: ReadonlySet<string> | null) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      if (ids && ids.size >= 2) {
        setNodes(layoutSubsetWithDagre(nodesRef.current, edgesRef.current, ids, dir));
      } else {
        const result = autoLayoutFlow(nodesRef.current, edgesRef.current, dir);
        setNodes(result.nodes);
        setEdges(result.edges);
      }
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, setEdges, scheduleAutoSave],
  );

  // ── 드래그-오버 드롭 영역 (앞/뒤 흐름 삽입, Phase 1) ─────────

  // 노드 id의 캔버스 컨테이너 상대 화면 사각형 — 드롭 영역/팝오버 위치 계산용 (이벤트에서만 호출)
  // 반드시 reactFlow.getNode(표시 좌표) 사용 — nodes state는 저장 좌표라 인라인 펼침 중 footprint-shift된
  // 노드에서 화면 밖 팬텀 링을 만들고 ensureRingVisible이 카메라를 그쪽으로 날린다(#2 프리즈 원인).
  const screenRectOf = useCallback(
    (nodeId: string): ScreenRect | null => {
      // 현재 스코프(nodes) 멤버만 — 임베드 자식은 읽기전용이라 링/존 대상이 아니다(기존 null 동작 보존).
      const node = nodesRef.current.some((item) => item.id === nodeId)
        ? reactFlow.getNode(nodeId)
        : undefined;
      const container = canvasContainerRef.current;
      if (!node || !container) {
        return null;
      }
      const zoom = reactFlow.getViewport().zoom;
      const topLeft = reactFlow.flowToScreenPosition({ x: node.position.x, y: node.position.y });
      const rect = container.getBoundingClientRect();
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      return {
        left: topLeft.x - rect.left,
        top: topLeft.y - rect.top,
        width: w * zoom,
        height: h * zoom,
        // 링 반경은 줌·노드 타입과 무관하게 프로세스 노드 크기 기준 상수 — 모든 노드에서 동일 크기.
        // 0.56배(기존 0.7의 80%)로 축소 — 원을 중심(노드)에 더 가깝게.
        radius: (Math.max(NODE_WIDTH, NODE_HEIGHT) + ZONE_RADIUS_PAD) * 0.56,
      };
    },
    [reactFlow],
  );

  // A를 B의 좌(앞)/우(뒤)로 인접 배치 후 겹침 회피. 8px 그리드 스냅.
  const placeBeside = useCallback(
    (aId: string, bId: string, zone: DropZone) => {
      setNodes((current) => {
        const b = current.find((node) => node.id === bId);
        if (!b) {
          return current;
        }
        const bw = b.measured?.width ?? NODE_WIDTH;
        const rawX =
          zone === "front" ? b.position.x - NODE_WIDTH - DROP_GAP : b.position.x + bw + DROP_GAP;
        const moved = current.map((node) =>
          node.id === aId
            ? {
                ...node,
                position: { x: Math.round(rawX / 8) * 8, y: Math.round(b.position.y / 8) * 8 },
              }
            : node,
        );
        return resolveCollision(moved, aId);
      });
    },
    [setNodes],
  );

  // 흐름 엣지 적용 — rewire면 B의 기존 연결을 끊고 A를 중간에 삽입
  const applyFlowEdges = useCallback(
    (aId: string, bId: string, zone: DropZone, rewire: boolean) => {
      const current = edgesRef.current;
      const isDecision = (nodeId: string): boolean =>
        nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType === "decision";
      const isSubprocess = (nodeId: string): boolean =>
        nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType === "subprocess";
      const inserted =
        zone === "front"
          ? insertNodeBefore(current, aId, bId, rewire)
          : insertNodeAfter(current, aId, bId, rewire, isDecision(bId));
      // 삽입/재연결로 끝점이 하위프로세스가 된 엣지는 전용 핸들(in/__primary__)로 보정 — 안 그러면 RF가 못 붙임.
      const next = inserted.map((edge) => withSubprocessHandles(edge, isSubprocess));
      // 마름모에서 새로 출발하는(라벨 없는) 엣지가 생기면, 분기 선택 전엔 삽입을 적용하지 않는다
      // (엣지가 먼저 보이지 않도록). 픽 시 삽입 전체를 라벨과 함께 적용, 취소 시 미적용.
      const beforeIds = new Set(current.map((edge) => edge.id));
      const fresh = next.find(
        (edge) => !beforeIds.has(edge.id) && !edge.label && isDecision(edge.source),
      );
      if (fresh) {
        setBranchPrompt({
          kind: "pendingInsert",
          nextEdges: next,
          freshId: fresh.id,
          at: { ...pointerScreenRef.current },
        });
      } else {
        setEdges(next);
      }
      scheduleAutoSave();
    },
    [setEdges, scheduleAutoSave],
  );

  // A를 B의 그룹(태그)에 합류 — B가 태그를 가지면 그 태그들을 A에 추가, 무소속이면 새 그룹 생성 후 둘 다 태그.
  const addToGroup = useCallback(
    (aId: string, bId: string) => {
      const b = nodesRef.current.find((node) => node.id === bId);
      if (!b) {
        return;
      }
      const createNew = b.data.groupIds.length === 0;
      const newId = createNew ? genId() : "";
      const tagsForA = createNew ? [newId] : b.data.groupIds;
      if (createNew) {
        setGroups((cur) => [
          ...cur,
          {
            id: newId,
            parent_group_id: null,
            label: makeUniqueLabel(
              b.data.department || b.data.assignee || "",
              cur.map((g) => g.label),
            ),
            color: GROUP_COLOR_PRESETS[cur.length % GROUP_COLOR_PRESETS.length],
          },
        ]);
      }
      setNodes((current) => {
        const target = current.find((node) => node.id === bId);
        if (!target) {
          return current;
        }
        const bw = target.measured?.width ?? NODE_WIDTH;
        const x = Math.round((target.position.x + bw + DROP_GAP) / 8) * 8;
        const y = Math.round(target.position.y / 8) * 8;
        const moved = current.map((node) => {
          if (node.id === aId) {
            return {
              ...node,
              position: { x, y },
              data: { ...node.data, groupIds: addTags(node.data.groupIds, tagsForA) },
            };
          }
          if (createNew && node.id === bId) {
            return { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [newId]) } };
          }
          return node;
        });
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, setGroups, scheduleAutoSave],
  );

  // A에 특정 그룹 태그 추가 — 그룹 박스 영역에 드롭한 경우. 드롭 위치는 유지하되 멤버 겹침만 회피.
  const addToGroupId = useCallback(
    (aId: string, groupId: string) => {
      setNodes((current) => {
        const moved = current.map((node) =>
          node.id === aId
            ? { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [groupId]) } }
            : node,
        );
        return resolveCollision(moved, aId);
      });
      scheduleAutoSave();
    },
    [setNodes, scheduleAutoSave],
  );

  const renameGroup = useCallback(
    (groupId: string, label: string) => {
      setGroups((current) => {
        const taken = current.filter((g) => g.id !== groupId).map((g) => g.label);
        const unique = makeUniqueLabel(label, taken);
        return current.map((g) => (g.id === groupId ? { ...g, label: unique } : g));
      });
      setNewGroupId((cur) => (cur === groupId ? null : cur));
      scheduleAutoSave();
    },
    [setGroups, scheduleAutoSave],
  );

  const recolorGroup = useCallback(
    (groupId: string, color: string) => {
      setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, color } : g)));
      scheduleAutoSave();
    },
    [setGroups, scheduleAutoSave],
  );

  // 멤버 2명 미만 그룹은 유지 의미 없음 — 주어진 노드로 멤버 수를 세어 자동 제거(라이브 정리, 저장 0명 정리와 별개).
  const pruneSmallGroups = useCallback(
    (nextNodes: AppNode[]) => {
      const counts = new Map<string, number>();
      for (const node of nextNodes) {
        for (const gid of node.data.groupIds) {
          counts.set(gid, (counts.get(gid) ?? 0) + 1);
        }
      }
      // 라이브 groups 기준으로 제거 대상 선판정 — setGroups 업데이터 안 부작용(StrictMode 이중호출) 회피
      const removed = groupsRef.current.filter((group) => (counts.get(group.id) ?? 0) < 2);
      if (removed.length === 0) {
        return;
      }
      const removedIds = new Set(removed.map((group) => group.id));
      setGroups((cur) => cur.filter((group) => !removedIds.has(group.id)));
      showToast(removed.length === 1 ? t("group.removed") : t("group.removedN", { n: removed.length }));
    },
    [setGroups, showToast, t],
  );

  const handleNodesDelete = useCallback(
    (deleted: AppNode[]) => {
      const removed = new Set(deleted.map((node) => node.id));
      pruneSmallGroups(nodesRef.current.filter((node) => !removed.has(node.id)));
      // 원본 노드 삭제 → 미러 즉시 해제(복사본 전환, io-linking §5). RF는 실제 제거(applyNodeChanges)
      // 전에 onNodesDelete를 먼저 호출하므로, current에서 직접 걸러낸 배열로 propagateIoLinks를 돌린다
      // (updateSelectedData/patchNode와 동일 가드) — 뒤이은 RF 자체 제거는 이미 없는 id라 no-op.
      if (rootGraph !== null) {
        setNodes((current) =>
          propagateIoLinks(current.filter((node) => !removed.has(node.id)), subprocessRefs).nodes,
        );
      }
      scheduleAutoSave();
    },
    [pruneSmallGroups, rootGraph, setNodes, subprocessRefs, scheduleAutoSave],
  );

  // 액션 바 "그룹 나가기" — 선택 멤버를 소속 그룹 전체에서 이탈(확정: 클릭 1회 전 그룹 탈퇴).
  // leaveGroup과 같은 경로(setNodes→pruneSmallGroups→scheduleAutoSave)를 한 번에 태운다.
  const leaveGroups = useCallback(
    (groupIds: string[]) => {
      const drop = new Set(groupIds);
      const next = nodesRef.current.map((node) =>
        node.selected && node.data.groupIds.some((id) => drop.has(id))
          ? {
              ...node,
              data: {
                ...node.data,
                groupIds: node.data.groupIds.filter((id) => !drop.has(id)),
              },
            }
          : node,
      );
      setNodes(next);
      pruneSmallGroups(next);
      scheduleAutoSave();
    },
    [setNodes, pruneSmallGroups, scheduleAutoSave],
  );

  // 선택된 노드들(2개 이상)에 새 그룹 태그 추가 — 라벨 기본=첫 노드의 부서/담당자. 기존 태그는 유지(다중 소속).
  const createGroupFromSelection = useCallback(() => {
    if (readOnly) {
      return;
    }
    const selected = nodesRef.current.filter((node) => node.selected);
    if (selected.length < 2) {
      showToast(t("group.needTwo"));
      return;
    }
    // 선택 노드가 모두 한 그룹에 함께 속하면 중복 그룹 — 차단(무명 그룹 양산 방지)
    const shared = selected.reduce<Set<string> | null>((common, node) => {
      const ids = new Set(node.data.groupIds);
      return common === null ? ids : new Set([...common].filter((id) => ids.has(id)));
    }, null);
    if (shared && shared.size > 0) {
      showToast(t("group.allInOne"));
      return;
    }
    pushHistory();
    const newId = genId();
    const first = selected[0];
    setGroups((cur) => [
      ...cur,
      {
        id: newId,
        parent_group_id: null,
        label: makeUniqueLabel(
          first.data.department || first.data.assignee || "",
          cur.map((g) => g.label),
        ),
        color: GROUP_COLOR_PRESETS[cur.length % GROUP_COLOR_PRESETS.length],
      },
    ]);
    const ids = new Set(selected.map((node) => node.id));
    setNodes((current) =>
      current.map((node) =>
        ids.has(node.id)
          ? { ...node, data: { ...node.data, groupIds: addTags(node.data.groupIds, [newId]) } }
          : node,
      ),
    );
    setNewGroupId(newId);
    scheduleAutoSave();
  }, [readOnly, pushHistory, setGroups, setNodes, scheduleAutoSave, showToast, t]);

  // 그룹 해제(disband) — 모든 노드에서 이 그룹 태그 제거 + 그룹 자체 삭제. leaveGroups(선택 멤버만 이탈)과 구분.
  const disbandGroup = useCallback(
    (groupId: string) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.data.groupIds.includes(groupId)
            ? {
                ...node,
                data: { ...node.data, groupIds: node.data.groupIds.filter((id) => id !== groupId) },
              }
            : node,
        ),
      );
      setGroups((current) => current.filter((group) => group.id !== groupId));
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, setGroups, scheduleAutoSave],
  );

  // 그룹 멤버(이 태그를 가진 노드) 색 일괄 변경
  const applyGroupColor = useCallback(
    (groupId: string, color: string) => {
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.data.groupIds.includes(groupId)
            ? { ...node, data: { ...node.data, color } }
            : node,
        ),
      );
      scheduleAutoSave();
    },
    [pushHistory, setNodes, scheduleAutoSave],
  );

  // 그룹 멤버 속성 일괄 적용 — 모달이 정책(교체/추가/건너뛰기/개별)을 멤버별 값으로 해석해 넘김.
  // 패치는 buildBulkAttrPatch 경유 — 비용 설정 시 반대 통화 소거(배타 불변식), 비용 비우기는 양쪽 소거.
  const applyGroupAttribute = useCallback(
    (field: BulkAttrField, updates: { id: string; value: string }[]) => {
      if (updates.length === 0) {
        return;
      }
      pushHistory();
      const valueById = new Map(updates.map((u) => [u.id, u.value]));
      setNodes((current) =>
        current.map((node) =>
          valueById.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...buildBulkAttrPatch(field, valueById.get(node.id) ?? "", {
                    input: node.data.input ?? "",
                    output: node.data.output ?? "",
                  }),
                },
              }
            : node,
        ),
      );
      scheduleAutoSave();
      showToast(t("bulk.applied"));
    },
    [pushHistory, setNodes, scheduleAutoSave, showToast, t],
  );

  // 그룹 멤버 부서+담당자 일괄 적용 — people 모드에서 두 필드를 함께 패치
  const applyGroupPeople = useCallback(
    (updates: PeopleUpdate[]) => {
      if (updates.length === 0) {
        return;
      }
      pushHistory();
      const updateById = new Map(updates.map((u) => [u.id, u]));
      setNodes((current) =>
        current.map((node) => {
          const upd = updateById.get(node.id);
          return upd
            ? { ...node, data: { ...node.data, department: upd.department, assignee: upd.assignee } }
            : node;
        }),
      );
      scheduleAutoSave();
      showToast(t("bulk.applied"));
    },
    [pushHistory, setNodes, scheduleAutoSave, showToast, t],
  );

  // 그룹 타이틀바 드래그 → 멤버 전체를 함께 이동
  const startGroupMove = useCallback(
    (
      groupId: string,
      event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    ) => {
      if (readOnly) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pushHistory();
      const zoom = reactFlow.getViewport().zoom || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const startPositions = new Map(
        nodesRef.current
          .filter((node) => node.data.groupIds.includes(groupId))
          .map((node) => [node.id, { ...node.position }]),
      );
      const onMove = (ev: PointerEvent) => {
        let dx = (ev.clientX - startX) / zoom;
        let dy = (ev.clientY - startY) / zoom;
        if (shiftHeldRef.current) {
          // Shift = 그룹 전체를 한 축으로만 이동 — (dx,dy)를 원점 기준 점으로 보고 더 작은 변위 축을 0으로
          // (constrainToAxis와 동일 규칙, 동률=수평 유지). 전 멤버가 같은 델타를 쓰므로 그룹이 통째로 잠긴다.
          const locked = constrainToAxis({ x: 0, y: 0 }, { x: dx, y: dy }, true);
          dx = locked.x;
          dy = locked.y;
        }
        setNodes((current) =>
          current.map((node) => {
            const start = startPositions.get(node.id);
            return start ? { ...node, position: { x: start.x + dx, y: start.y + dy } } : node;
          }),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        scheduleAutoSave();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [readOnly, reactFlow, setNodes, pushHistory, scheduleAutoSave],
  );

  // A를 B의 자리로, B를 A의 드래그 시작 자리로 교환 (드롭존 중앙=swap).
  // takenEdgeId: decision↔일반 스왑에서 일반 노드가 가져갈 출력선(선택 모달 픽).
  // aStartOverride: 모달로 스왑을 미룬 경우의 드래그 시작 좌표 — onNodeDragStop이
  // handleZoneDrop 직후 dragStartPosRef를 비우므로 모달 열 때 캡처한 값을 받는다.
  const swapNodes = useCallback(
    (
      aId: string,
      bId: string,
      takenEdgeId?: string | null,
      aStartOverride?: { x: number; y: number } | null,
    ) => {
      const start = dragStartPosRef.current;
      const rawOrig =
        aStartOverride !== undefined
          ? aStartOverride
          : start && start.id === aId
            ? { x: start.x, y: start.y }
            : null;
      // rawOrig는 onNodeDragStart가 캡처한 *표시* 좌표(height-shift 오프셋 포함) — 저장 좌표(nodes state)에
      // 그대로 쓰면 B의 saved_y가 드리프트한다(C1). dropDraggingPositions와 동일하게 역변환해야 한다.
      const aOrig = rawOrig ? toSavedPoint(rawOrig) : null;
      setNodes((current) => {
        const b = current.find((node) => node.id === bId);
        if (!b) {
          return current;
        }
        const bPos = { ...b.position };
        return current.map((node) => {
          if (node.id === aId) {
            return { ...node, position: bPos };
          }
          if (node.id === bId && aOrig) {
            return { ...node, position: aOrig };
          }
          return node;
        });
      });
      // 엣지 연결 상태도 교환 — A의 연결은 B로, B의 연결은 A로.
      // decision↔일반 스왑은 출력 부분 이관(일반은 1개만, 나머지는 decision에 라벨째 잔류) — swapNodeEdges.
      setEdges((current) =>
        swapNodeEdges(
          current,
          aId,
          bId,
          (nodeId) => nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType,
          takenEdgeId ?? null,
        ),
      );
      scheduleAutoSave();
    },
    [setNodes, setEdges, scheduleAutoSave, toSavedPoint],
  );

  // 드롭 영역에 놓음 — 앞/뒤(흐름)·그룹·하위·교환. 앞·뒤는 기존 엣지가 있으면 유지/삽입 되묻기
  const handleZoneDrop = useCallback(
    (aId: string, bId: string, zone: DropZone) => {
      if (zone === "swap") {
        // 허용 안 되는 조합(start/end는 동종만)은 스왑 불가 — activateZone에서 이미 zone을
        // 죽이지만 방어적으로 차단.
        if (flowZoneViolates(aId, bId, "swap")) {
          return;
        }
        // decision↔일반 스왑에서 decision 출력이 2개 이상이면 일반 노드가 어느 출력선을
        // 가져갈지 선택 모달 — 직접 분기(D→N)가 있으면 그 엣지가 끝점째 교환되므로 선택 불요.
        const aType = nodesRef.current.find((node) => node.id === aId)?.data.nodeType;
        const bType = nodesRef.current.find((node) => node.id === bId)?.data.nodeType;
        const decisionId =
          aType === "decision" && bType !== "decision"
            ? aId
            : bType === "decision" && aType !== "decision"
              ? bId
              : null;
        if (decisionId) {
          const otherId = decisionId === aId ? bId : aId;
          const decisionOut = getOutgoingEdges(edgesRef.current, decisionId);
          const hasPairOut = decisionOut.some((edge) => edge.target === otherId);
          if (!hasPairOut && decisionOut.length >= 2) {
            const options = decisionOut.map((edge) => {
              const targetTitle =
                nodesRef.current.find((node) => node.id === edge.target)?.data.label ?? edge.target;
              return {
                edgeId: edge.id,
                branchKind: branchKindOf(edge.label),
                edgeLabel: typeof edge.label === "string" ? edge.label : "",
                targetLabel: targetTitle,
              };
            });
            const start = dragStartPosRef.current;
            setSwapSelect({
              aId,
              bId,
              options,
              at: { ...pointerScreenRef.current },
              aStart: start && start.id === aId ? { x: start.x, y: start.y } : null,
            });
            return;
          }
        }
        swapNodes(aId, bId);
        return;
      }
      if (zone === "group") {
        addToGroup(aId, bId);
        return;
      }
      // 흐름 삽입(front/back)이 시작/끝 규칙을 어기면 드롭 무효 — activateZone에서 이미 zone을 죽이지만 방어적으로 차단.
      if (flowZoneViolates(aId, bId, zone)) {
        return;
      }
      // A↔B 1:1 회귀 차단(드롭) — front=A→B / back=B→A. 역행은 Decision 우회 안내.
      const newSource = zone === "front" ? aId : bId;
      const newTarget = zone === "front" ? bId : aId;
      if (hasReciprocalEdge(edgesRef.current, newSource, newTarget)) {
        showToast(t("edge.reciprocalBlocked"));
        return;
      }
      placeBeside(aId, bId, zone);
      scheduleAutoSave();
      const conflict =
        zone === "front"
          ? getIncomingEdges(edgesRef.current, bId).some((edge) => edge.source !== aId)
          : getOutgoingEdges(edgesRef.current, bId).some((edge) => edge.target !== aId);
      const rect = conflict ? screenRectOf(bId) : null;
      if (conflict && rect) {
        if (zone === "back") {
          // B의 기존 출력선(A행 제외). source=B(드롭 대상), target=A(드래그 노드).
          const bOut = getOutgoingEdges(edgesRef.current, bId).filter((edge) => edge.target !== aId);
          const at = { ...pointerScreenRef.current };
          const options = bOut.map((edge) => {
            const targetTitle =
              nodesRef.current.find((node) => node.id === edge.target)?.data.label ?? edge.target;
            return {
              edgeId: edge.id,
              branchKind: branchKindOf(edge.label),
              edgeLabel: typeof edge.label === "string" ? edge.label : "",
              targetLabel: targetTitle,
            };
          });
          const bIsDecision =
            nodesRef.current.find((node) => node.id === bId)?.data.nodeType === "decision";
          // 디시전 노드 + 출력 ≥1 → 분기/인터셉트/취소 (F1)
          if (bIsDecision) {
            setDecisionDrop({ aId, bId, options, at });
            return;
          }
          // 비-디시전: 2개 이상이면 어느 선에 끼울지 선택, 1개면 삽입/교체/취소.
          if (bOut.length >= 2) {
            setEdgeSelect({ source: bId, target: aId, options, at });
            return;
          }
          setEdgeAction({ source: bId, target: aId, at });
          return;
        }
        setPending({ mode: zone, aId, bId, rect });
        return;
      }
      // 충돌 없음(또는 위치 계산 실패) → 기본 삽입
      applyFlowEdges(aId, bId, zone, true);
    },
    [
      swapNodes,
      addToGroup,
      placeBeside,
      applyFlowEdges,
      scheduleAutoSave,
      screenRectOf,
      flowZoneViolates,
      showToast,
      t,
    ],
  );

  // 드롭 위치에 하위프로세스 노드 생성 — 일반 드롭·미등록 확인 체인·피크 추가 공용. 생성 노드 id 반환(피크 flash용).
  const createLinkNodeAt = useCallback(
    async (linkedMapId: number, mapName: string, pinned: number | null, position: { x: number; y: number }): Promise<string> => {
      let subEnds: SubEnd[] = [];
      try {
        const resolved = await getResolvedGraph(linkedMapId, pinned === null, pinned);
        subEnds = deriveSubEnds(resolved);
      } catch {
        // subEnds 파생 실패 시 빈 채로 생성 — 백엔드가 핸들 없어도 저장 허용
      }
      const node: AppNode = {
        id: genId(),
        type: "process",
        position,
        data: {
          label: mapName,
          description: "",
          nodeType: "subprocess",
          color: "",
          assignee: "",
          department: "",
          system: "",
          duration: "",
          cost_krw: "",
          cost_usd: "",
          headcount: "",
          annual_count: "",
          fte: "",
          groupIds: [],
          hasChildren: false,
          linkedMapId,
          linkedVersionId: pinned,
          followLatest: true,
          subEnds,
        },
      };
      setNodes((cur) => [...cur, node]);
      scheduleAutoSave();
      return node.id;
    },
    [setNodes, scheduleAutoSave],
  );

  // 미등록 맵 드롭 확인 체인 — confirm(잠금 경고) → 노드 생성 → request(등록 요청 여부) (spec 2026-07-19)
  const [unregDrop, setUnregDrop] = useState<{
    stage: "confirm" | "request";
    linkedMapId: number;
    name: string;
    position: { x: number; y: number };
  } | null>(null);

  // 등록 요청 발송 — 409(중복 pending)는 안내 토스트로 완화
  const sendSpDesignationRequest = useCallback(
    async (targetMapId: number) => {
      try {
        await createSpDesignationRequest(targetMapId, mapId);
        showToast(t("library.requestSent"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast(t("library.requestAlreadyPending"));
        } else {
          showToast(getApiErrorDetail(err));
        }
      }
    },
    [mapId, showToast, t],
  );

  // 라이브러리 패널에서 드래그한 맵을 캔버스에 드롭 → 하위프로세스 노드 생성.
  // 미등록 맵은 즉시 생성하지 않고 확인 체인을 연다(드롭 위치 보존).
  const handleLibraryDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const raw = e.dataTransfer.getData("application/bpm-process");
      if (!raw) return;
      const linkedMapId = Number(raw);
      const mapName = e.dataTransfer.getData("application/bpm-process-name") || "Subprocess";
      const pinnedRaw = e.dataTransfer.getData("application/bpm-process-pinned");
      const pinned = pinnedRaw ? Number(pinnedRaw) : null;
      const unregistered = e.dataTransfer.getData("application/bpm-process-unregistered") === "1";
      // 낙관 참조 — 드롭 즉시 외부 L6 색·출처 배지가 그려지도록(서버 refs 도착 전) (2026-08-30 #4)
      const categoryRaw = e.dataTransfer.getData("application/bpm-process-category");
      if (isFrameworkMap && categoryRaw) {
        const categoryPath = e.dataTransfer.getData("application/bpm-process-category-path");
        setOptimisticRefs((current) => {
          const next = new Map(current);
          next.set(
            linkedMapId,
            makeOptimisticRef({
              name: mapName,
              categoryId: Number(categoryRaw),
              categoryPath: categoryPath || null,
              designated: !unregistered,
            }),
          );
          return next;
        });
      }
      const position = toSavedPoint(reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      if (unregistered) {
        setUnregDrop({ stage: "confirm", linkedMapId, name: mapName, position });
        return;
      }
      void createLinkNodeAt(linkedMapId, mapName, pinned, position);
    },
    // setUnregDrop(useState setter)은 참조가 늘 안정적이나, React Compiler가 이 렌더의
    // 재구조화 이후 추론한 의존성과 수동 배열을 일치시키기 위해 명시(동작 변화 없음).
    [readOnly, reactFlow, createLinkNodeAt, setUnregDrop, toSavedPoint, isFrameworkMap, setOptimisticRefs],
  );

  // Word 맵 섹션 패널에서 섹션을 캔버스로 드롭 — label=섹션 번호, section_anchor=문서 내부 앵커(읽기전용 링크 대상).
  const handleSectionDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const anchor = e.dataTransfer.getData("application/bpm-section");
      if (!anchor) return;
      const number = e.dataTransfer.getData("application/bpm-section-number");
      const title = e.dataTransfer.getData("application/bpm-section-title");
      // 라벨 = "번호 제목" — 내보내기 시 첫 공백토큰(번호)만 앵커 링크, 제목은 plain (design §8)
      const label = [number, title].filter(Boolean).join(" ");
      pushHistory();
      const id = genId();
      const point = toSavedPoint(reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      const position = findFreeSpot(point.x - NODE_WIDTH / 2, point.y - NODE_HEIGHT / 2);
      setNodes((current) => [
        ...current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        {
          id,
          type: "process",
          position,
          selected: true,
          className: "bpm-node-flash",
          data: buildNodeData("section", label, { section_anchor: anchor }),
        },
      ]);
      setSelectedId(id);
      setSelectedEdgeId(null);
      scheduleAutoSave();
      flashNode(id);
    },
    [
      readOnly,
      reactFlow,
      findFreeSpot,
      pushHistory,
      setNodes,
      scheduleAutoSave,
      flashNode,
      toSavedPoint,
    ],
  );

  // 현재 맵에 이미 링크된 서브프로세스 대상 맵 id 집합 — 라이브러리 패널 비활성화 + 재추가 차단에 공용.
  const linkedMapIds = useMemo(
    () =>
      new Set(
        nodes
          .filter((n) => n.data.nodeType === "subprocess" && n.data.linkedMapId != null)
          .map((n) => n.data.linkedMapId as number),
      ),
    [nodes],
  );

  // 상단 맵 드롭다운의 '링크노드로 추가' — 다른 맵을 현재 캔버스에 읽기전용 참조(subprocess) 노드로 삽입.
  // handleLibraryDrop과 동일한 노드 형태이되 드롭 좌표 대신 뷰포트 중앙, 최신본 추종(followLatest).
  const addLinkNodeFromMap = useCallback(
    async (linkedMapId: number, name: string) => {
      if (readOnly) return;
      if (linkedMapIds.has(linkedMapId)) {
        showToast(t("library.alreadyLinked"));
        return;
      }
      const center = toSavedPoint(
        reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
      );
      const id = genId();
      const position = findFreeSpot(center.x - NODE_WIDTH / 2, center.y - NODE_HEIGHT / 2);
      let subEnds: SubEnd[] = [];
      try {
        const resolved = await getResolvedGraph(linkedMapId, true, null);
        subEnds = deriveSubEnds(resolved);
      } catch {
        // subEnds 파생 실패 시 빈 채로 — 백엔드가 핸들 없어도 저장 허용
      }
      const node: AppNode = {
        id,
        type: "process",
        position,
        className: "bpm-node-flash",
        data: {
          label: name,
          description: "",
          nodeType: "subprocess",
          color: "",
          assignee: "",
          department: "",
          system: "",
          duration: "",
          cost_krw: "",
          cost_usd: "",
          headcount: "",
          annual_count: "",
          fte: "",
          groupIds: [],
          hasChildren: false,
          linkedMapId,
          linkedVersionId: null,
          followLatest: true,
          subEnds,
        },
      };
      setNodes((cur) => [...cur, node]);
      scheduleAutoSave();
      flashNode(id);
      showToast(t("editor.linkNodeAdded", { name }));
    },
    [
      readOnly,
      linkedMapIds,
      reactFlow,
      setNodes,
      scheduleAutoSave,
      showToast,
      t,
      findFreeSpot,
      flashNode,
      toSavedPoint,
    ],
  );

  // 라이브러리/체계 피커 피크의 "Add to map" — 드롭(handleLibraryDrop)과 동일 생성 체인을 뷰포트 중앙에
  // 적용(미등록=확인+등록요청 체인, 체계 출처 낙관 참조 포함). 좌표만 드롭점 대신 중앙+빈자리 탐색 (2026-08-30).
  const addLinkNodeFromPeek = useCallback(
    (payload: PeekAddPayload) => {
      if (readOnly) return;
      const { linkedMapId, name, pinned, unregistered, categoryId, categoryPath } = payload;
      if (isFrameworkMap && categoryId !== undefined) {
        setOptimisticRefs((current) => {
          const next = new Map(current);
          next.set(
            linkedMapId,
            makeOptimisticRef({
              name,
              categoryId,
              categoryPath: categoryPath || null,
              designated: !unregistered,
            }),
          );
          return next;
        });
      }
      const center = toSavedPoint(
        reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
      );
      const position = findFreeSpot(center.x - NODE_WIDTH / 2, center.y - NODE_HEIGHT / 2);
      if (unregistered) {
        setUnregDrop({ stage: "confirm", linkedMapId, name, position });
        return;
      }
      void createLinkNodeAt(linkedMapId, name, pinned, position).then((id) => {
        flashNode(id);
        showToast(t("editor.linkNodeAdded", { name }));
      });
    },
    [
      readOnly,
      isFrameworkMap,
      setOptimisticRefs,
      toSavedPoint,
      reactFlow,
      findFreeSpot,
      setUnregDrop,
      createLinkNodeAt,
      flashNode,
      showToast,
      t,
    ],
  );

  // 마우스(flow 좌표) 아래에 있는, 드래그 노드가 아직 속하지 않은 기존 그룹 박스 id — 박스 영역 드롭 합류용
  const findGroupAt = useCallback((mouse: { x: number; y: number }, draggingId: string): string | null => {
    const draggingTags = nodesRef.current.find((n) => n.id === draggingId)?.data.groupIds ?? [];
    for (const group of groupsRef.current) {
      if (draggingTags.includes(group.id)) {
        continue; // 이미 이 그룹 태그 보유
      }
      const members = nodesRef.current.filter(
        (n) => n.data.groupIds.includes(group.id) && n.id !== draggingId,
      );
      if (members.length === 0) {
        continue;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of members) {
        const w = m.measured?.width ?? NODE_WIDTH;
        const h = m.measured?.height ?? NODE_HEIGHT;
        // 마우스(mouse)는 표시좌표(screenToFlowPosition) — 멤버는 저장좌표라 height-shift 오프셋을
        // 더해야 히트박스가 실제 렌더 위치와 일치한다(I1 findGroupAt).
        const my = m.position.y + (renderYOffsetsRef.current.get(m.id) ?? 0);
        minX = Math.min(minX, m.position.x);
        minY = Math.min(minY, my);
        maxX = Math.max(maxX, m.position.x + w);
        maxY = Math.max(maxY, my + h);
      }
      const inX = mouse.x >= minX - GROUP_PAD && mouse.x <= maxX + GROUP_PAD;
      const inY = mouse.y >= minY - GROUP_PAD - GROUP_TITLE_GAP && mouse.y <= maxY + GROUP_PAD;
      if (inX && inY) {
        return group.id;
      }
    }
    return null;
  }, []);

  // dwell 타이머/상태 정리
  const clearDwell = useCallback(() => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    dwellRef.current = null;
  }, []);

  // 드롭 링(+타일)이 컨테이너 가장자리를 넘으면 뷰포트를 패닝해 시야 안으로 끌어온다.
  // 링 반경은 화면 고정 크기라 줌이 아닌 패닝이 링을 드러내는 수단. 패닝한 만큼 rect도 옮겨 반환(타일 정합).
  const ensureRingVisible = useCallback(
    (rect: ScreenRect): ScreenRect => {
      const container = canvasContainerRef.current;
      if (!container) {
        return rect;
      }
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const margin = rect.radius + ZONE_TILE_H + 8; // 타일 한 칸까지 여유
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = 0;
      let dy = 0;
      if (cx - margin < 0) {
        dx = margin - cx;
      } else if (cx + margin > cw) {
        dx = cw - margin - cx;
      }
      if (cy - margin < 0) {
        dy = margin - cy;
      } else if (cy + margin > ch) {
        dy = ch - margin - cy;
      }
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return rect;
      }
      const vp = reactFlow.getViewport();
      reactFlow.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 200 });
      return { ...rect, left: rect.left + dx, top: rect.top + dy };
    },
    [reactFlow],
  );

  // 커서(컨테이너 상대 좌표)로 타일 적중 zone을 갱신. 타일 밖이면 zone=null(중립). 링(rect)은 유지.
  const activateZone = useCallback(
    (targetId: string, cursorX: number, cursorY: number) => {
      const found = screenRectOf(targetId);
      if (!found) {
        return;
      }
      // 가장자리면 시야 보정(패닝) 후 보정된 rect로 타일 판정
      const rect = ensureRingVisible(found);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let zone = pickDropZone(cursorX, cursorY, cx, cy, rect.radius);
      // 시작/끝 규칙을 어기는 흐름존(front/back)은 비활성화 — 드롭해도 엣지가 생기지 않게 zone을 무효로.
      // 차단 여부는 이벤트 시점에 계산해 dropTarget에 저장(렌더에서 ref 접근 회피, 타일 흐림 표시용).
      const draggedId = draggedNodeIdRef.current;
      const frontBlocked = !!draggedId && flowZoneViolates(draggedId, targetId, "front");
      const backBlocked = !!draggedId && flowZoneViolates(draggedId, targetId, "back");
      const swapBlocked = !!draggedId && flowZoneViolates(draggedId, targetId, "swap");
      if (
        (zone === "front" && frontBlocked) ||
        (zone === "back" && backBlocked) ||
        (zone === "swap" && swapBlocked)
      ) {
        zone = null;
      }
      setGroupDropTarget((cur) => (cur ? null : cur)); // 노드 대상이 그룹 박스 hover보다 우선
      setDropTarget((cur) =>
        cur &&
        cur.id === targetId &&
        cur.zone === zone &&
        cur.frontBlocked === frontBlocked &&
        cur.backBlocked === backBlocked &&
        cur.swapBlocked === swapBlocked
          ? cur
          : { id: targetId, zone, rect, frontBlocked, backBlocked, swapBlocked },
      );
    },
    [screenRectOf, ensureRingVisible, flowZoneViolates],
  );

  // 드래그 중 — 커서 위치(현재 마우스) 기준으로 판정.
  // 링이 한번 뜨면 커서가 링 밖으로 나가기 전까지 유지(겹침 해제와 무관). 노드가 없으면 그룹 박스 hover.
  const handleNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: AppNode) => {
      if (readOnly) {
        return;
      }
      draggedNodeIdRef.current = node.id; // 흐름존 규칙 판정용 — 현재 드래그 노드 추적
      // 펼침 중 추적 대상 루트 드래그면 RF가 보고하는 표시좌표를 라이브 맵에 반영 → 커서 1:1 추종.
      // Shift 축 고정은 여기서 적용 — 이 경로는 dropDraggingPositions가 position 변경을 버려서(suppress)
      // 거기의 constrainToAxis를 안 타므로, 라이브 기록 시점에 시작점 기준으로 직접 보정한다(#3a).
      const tracked = dragStartOffsetRef.current.get(node.id);
      if (tracked) {
        const pos = constrainToAxis(tracked.start, node.position, shiftHeldRef.current);
        setDragLiveById((cur) => {
          const next = new Map(cur);
          next.set(node.id, { x: pos.x, y: pos.y });
          return next;
        });
      }
      const clientX = "touches" in event ? (event.touches[0]?.clientX ?? 0) : event.clientX;
      const clientY = "touches" in event ? (event.touches[0]?.clientY ?? 0) : event.clientY;
      const mouse = reactFlow.screenToFlowPosition({ x: clientX, y: clientY });

      // 컨테이너 상대 커서 — 타일 적중 판정·링 유지 경계가 모두 이 좌표계(=screenRectOf/오버레이 렌더)
      const container = canvasContainerRef.current;
      const crect = container?.getBoundingClientRect();
      const curX = crect ? clientX - crect.left : clientX;
      const curY = crect ? clientY - crect.top : clientY;
      dragCursorRef.current = { x: curX, y: curY };

      // 이미 떠 있는 링 — 커서가 유지 경계 안이면 zone만 갱신, 밖으로 나가면 해제 후 재탐지
      const active = dropTargetRef.current;
      if (active && active.id !== node.id) {
        const r = active.rect;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const keep = r.radius + DROPZONE_HIT_OUTER_PAD; // 부채꼴 판정 바깥까지 커서를 옮겨도 링 유지
        const dist = Math.hypot(curX - cx, curY - cy);
        if (dist <= keep) {
          activateZone(active.id, curX, curY);
          return;
        }
        setDropTarget((cur) => (cur ? null : cur));
        clearDwell();
      }

      // 드래그 노드와 겹치는 노드 — DWELL_MS 머문 뒤 4방향 링 표시(커서 아님, 노드끼리 겹침 기준)
      const target = reactFlow
        .getIntersectingNodes(node)
        .find((other) => other.id !== node.id);
      if (target) {
        setGroupDropTarget((cur) => (cur ? null : cur));
        if (!dwellRef.current || dwellRef.current.id !== target.id) {
          clearDwell();
          dwellRef.current = { id: target.id, since: Date.now() };
          dwellTimerRef.current = setTimeout(
            () => activateZone(target.id, dragCursorRef.current.x, dragCursorRef.current.y),
            DWELL_MS,
          );
        } else if (Date.now() - dwellRef.current.since >= DWELL_MS) {
          activateZone(target.id, dragCursorRef.current.x, dragCursorRef.current.y);
        }
        return;
      }

      // 커서 아래 노드 없음 — 기존 그룹 박스 빈 영역 위면 합류 대상으로 강조
      clearDwell();
      setDropTarget((cur) => (cur ? null : cur));
      const gid = findGroupAt(mouse, node.id);
      setGroupDropTarget((cur) => (cur === gid ? cur : gid));
    },
    [readOnly, reactFlow, clearDwell, activateZone, findGroupAt],
  );

  // 펼침 중 루트 드래그 시작 캡처 — 노드별 footprint 오프셋을 기록하고 라이브 표시좌표를 시드.
  // 펼침이 없으면(rootOffsets 없음) 일반 드래그라 추적 안 함 → 기존 경로 그대로.
  const captureRootDragStart = useCallback((dragged: AppNode[]) => {
    const composition = inlineCompositionRef.current;
    const rootOffsets = composition?.rootOffsets;
    if (!rootOffsets || rootOffsets.size === 0) {
      return;
    }
    const offsets = new Map<
      string,
      { offset: { x: number; y: number }; start: { x: number; y: number } }
    >();
    const live = new Map<string, { x: number; y: number }>();
    for (const node of dragged) {
      const offset = rootOffsets.get(node.id);
      if (!offset) {
        continue; // 펼침에 안 밀린 노드(offset 0 미등록 포함은 아래에서 0 처리)
      }
      // RF가 보고하는 node.position은 이미 표시좌표(=저장+offset). 그대로 라이브 시드 겸 축 고정 기준점.
      const start = { x: node.position.x, y: node.position.y };
      offsets.set(node.id, { offset, start });
      live.set(node.id, start);
    }
    if (offsets.size === 0) {
      return;
    }
    dragStartOffsetRef.current = offsets;
    suppressPosIdsRef.current = new Set(offsets.keys());
    setDragLiveById(live);
  }, []);

  // 펼침 중 루트 드래그 종료 — 표시좌표를 저장좌표로 환산하거나(유효), 무효(펼친 레인 위)면 취소(원위치).
  // 반환 `tracked`: 펼침 추적 드래그였는지(false면 호출부가 기존 일반 드래그 경로를 그대로 실행).
  //       `committed`: 유효 드롭으로 새 저장좌표를 커밋했는지(취소면 false → 호출부는 zone/collision/save 모두 생략).
  const finalizeRootDrag = useCallback(
    (): { tracked: boolean; committed: boolean } => {
      const offsets = dragStartOffsetRef.current;
      if (offsets.size === 0) {
        return { tracked: false, committed: false };
      }
      const live = dragLiveByIdRef.current;
      const composition = inlineCompositionRef.current;
      const regions = composition?.regions ?? [];
      const steps = composition?.rootShiftSteps ?? [];
      // 무효 판정: 노드 표시중심 x가 펼친 레인(full-height 세로밴드)의 x..x+width 안이면 취소.
      const isInvalid = (id: string, dropDisplay: { x: number; y: number }): boolean => {
        const node = nodesRef.current.find((n) => n.id === id);
        const w = node ? nodeSizeOf(node.data.nodeType).w : NODE_WIDTH;
        const centerX = dropDisplay.x + w / 2;
        return regions.some((r) => centerX >= r.x && centerX <= r.x + r.width);
      };
      let committed = false;
      const savedById = new Map<string, { x: number; y: number }>();
      for (const [id] of offsets) {
        const dropDisplay = live.get(id);
        if (!dropDisplay) {
          continue;
        }
        if (isInvalid(id, dropDisplay)) {
          continue; // 취소 — nodes state는 드래그 내내 동결돼 있어 원위치 유지. 저장 안 함.
        }
        // x는 드롭 위치 오프셋으로 환산(드래그 시작 오프셋 아님) — 펼침 영역 경계를 가로지르면 두 오프셋이 달라
        // footprint만큼 빗나간다. 도달 불가 갭(앵커 점프 구간)은 앵커 x로 클램프(lib/inline-shift).
        const sx = displayToSavedX(dropDisplay.x, steps);
        // y도 드롭 위치 기준 상시 스텝 역변환 — 펼침 중에도 height-shift가 베이크돼 있고,
        // 밴드 경계를 가로지른 드래그는 시작 오프셋(rootOffsets.y) 빼기로는 어긋난다.
        savedById.set(id, { x: sx, y: displayToSavedX(dropDisplay.y, heightStepsRef.current) });
        committed = true;
      }
      if (savedById.size > 0) {
        setNodes((current) =>
          current.map((node) => {
            const saved = savedById.get(node.id);
            return saved ? { ...node, position: saved } : node;
          }),
        );
      }
      // 라이브/오프셋 정리 → displayNodes가 다시 inlineComposition 파생좌표로 복귀(취소면 원위치, 유효면 새 저장좌표 기준).
      // suppressPosIdsRef는 드롭 직후 RF의 마지막 position 변경(표시좌표)까지 막아야 하므로 몇 프레임 뒤 해제.
      const finalizedIds = new Set(offsets.keys());
      dragStartOffsetRef.current = new Map();
      setDragLiveById(EMPTY_DRAG_LIVE);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const id of finalizedIds) {
            suppressPosIdsRef.current.delete(id);
          }
        }),
      );
      return { tracked: true, committed };
    },
    [setNodes],
  );

  // 언마운트 시 dwell 타이머 정리
  useEffect(() => clearDwell, [clearDwell]);

  const updateSelectedData = useCallback(
    (patch: Partial<NodeData>, fromTyping = false) => {
      if (readOnly) {
        return;
      }
      recordChange(fromTyping);
      // IO 텍스트/폼/링크가 바뀌면 원본 수정일 수 있다 → 같은 커밋에서 미러 전량 동기화 (io-linking §5).
      // rootGraph 미로드(=SP 지정 미확보) 중엔 건너뛴다 — 불완전한 spRefs로 돌리면 SP 원본 미러가
      // 댕글링으로 오판돼 해산된다. 그 경우 치유는 다음 로드 정합화가 맡는다.
      const propagate = rootGraph !== null && hasIoPatchField(patch);
      setNodes((current) => {
        const mapped = current.map((node) =>
          node.id === selectedId
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        );
        return propagate ? propagateIoLinks(mapped, subprocessRefs).nodes : mapped;
      });
      scheduleAutoSave();
    },
    [readOnly, recordChange, selectedId, setNodes, rootGraph, subprocessRefs, scheduleAutoSave],
  );

  // 하위프로세스 "최신으로 업데이트" — linkedVersionId를 latest_published_version_id로 갱신,
  // resolved 그래프 재fetch, subEnds 재파생, 끊어진 보조 출구 엣지 경고 토스트
  const handleUpdateSubprocess = useCallback(
    (nodeId: string) => {
      if (readOnly) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.data.linkedMapId == null) return;
      const lib = libByMap.get(node.data.linkedMapId);
      if (lib?.latest_published_version_id == null) return;
      const newVersionId = lib.latest_published_version_id;
      recordChange(false);
      void getResolvedGraph(node.data.linkedMapId, false, newVersionId).then((resolved) => {
        const newSubEnds = deriveSubEnds(resolved);
        const validHandles = new Set<string>([
          PRIMARY_END_HANDLE,
          ...newSubEnds.map((e) => e.key),
        ]);
        // 새 linkKey로 캐시 저장 — 다음 injectSubEnds가 쓸 수 있게
        const newKey = `${node.data.linkedMapId}:${newVersionId}`;
        setResolvedCache((prev) => new Map(prev).set(newKey, resolved));
        // 끊어진 보조 출구 엣지 감지 — source가 이 노드이고 sourceHandle이 새 끝에 없는 엣지
        setEdges((currentEdges) => {
          const broken = currentEdges.filter(
            (e) =>
              e.source === nodeId &&
              e.sourceHandle != null &&
              !validHandles.has(e.sourceHandle),
          );
          if (broken.length > 0) {
            showToast(t("subprocess.endRebindWarn"));
          }
          return currentEdges;
        });
        setNodes((current) =>
          current.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    linkedVersionId: newVersionId,
                    subEnds: newSubEnds,
                    updateAvailable: false,
                  },
                }
              : n,
          ),
        );
        scheduleAutoSave();
      });
    },
    [readOnly, libByMap, recordChange, setResolvedCache, setEdges, setNodes, scheduleAutoSave, showToast, t],
  );

  // 우클릭 색 스와치 → 선택 노드 색 변경 (우클릭 시 해당 노드가 selectedId가 됨)
  const handleRecolor = useCallback(
    (color: string) => updateSelectedData({ color }),
    [updateSelectedData],
  );

  // 특정 노드 데이터 패치 — 정보 수정 모달(summaryNodeId 대상)에서 사용. id로 직접 지정(선택과 무관).
  const patchNode = useCallback(
    (id: string, patch: Partial<NodeData>, fromTyping = false) => {
      if (readOnly) {
        return;
      }
      recordChange(fromTyping);
      // 노드 편집 모달도 IO 원본 텍스트를 고칠 수 있다 — 인스펙터와 같은 전파 트리거·가드 (io-linking §5)
      const propagate = rootGraph !== null && hasIoPatchField(patch);
      setNodes((current) => {
        const mapped = current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        );
        return propagate ? propagateIoLinks(mapped, subprocessRefs).nodes : mapped;
      });
      scheduleAutoSave();
    },
    [readOnly, recordChange, setNodes, rootGraph, subprocessRefs, scheduleAutoSave],
  );

  // 정보 수정 모달 패치 — summaryNodeId 대상. 현재 스코프 노드는 state, 펼친 자식은 scope-split.
  const handleSummaryPatch = useCallback(
    (patch: Partial<NodeData>) => {
      if (summaryNodeId === null) {
        return;
      }
      patchNode(summaryNodeId, patch, true);
    },
    [summaryNodeId, patchNode],
  );

  // 모달 연결 버전 피커의 "업데이트" — IIFE 내 인라인 클로저는 react-hooks/refs 오탐이라 톱레벨로.
  const handleSummaryUpdateSubprocess = useCallback(() => {
    if (summaryNodeId !== null) {
      handleUpdateSubprocess(summaryNodeId);
    }
  }, [summaryNodeId, handleUpdateSubprocess]);

  // 제목 입력 확정(blur) — 캔버스 내 다른 노드와 이름 중복 시 " (n)" 접미사로 고유화.
  const handleSummaryLabelCommit = useCallback(
    (label: string) => {
      if (summaryNodeId === null) {
        return;
      }
      const taken = nodesRef.current
        .filter((node) => node.id !== summaryNodeId)
        .map((node) => node.data.label);
      // 항상 반영 — 충돌 시 " (n)"로 고유화, 유니크하면 입력 그대로. (충돌일 때만 patch하던 버그로
      // 유니크한 새 제목이 저장되지 않던 문제 수정.)
      patchNode(summaryNodeId, { label: makeUniqueLabel(label, taken) }, false);
    },
    [summaryNodeId, patchNode],
  );

  // 요약 패널 "하위 열기" — 드릴인 창 대신 같은 캔버스에 인라인 펼침. toggleInlineExpand는 아래에서 정의(TDZ)·ref를
  // 읽으므로 ref 미러로 호출(인라인 JSX 화살표에서 직접 호출 시 react-hooks/refs 경고). useCallback 내부라 ref 접근 허용.
  const handleSummaryOpenChild = useCallback(() => {
    const id = summaryNodeId;
    setSummaryNodeId(null);
    if (id !== null) {
      toggleInlineExpandRef.current?.(id);
    }
  }, [summaryNodeId]);

  // 인라인 이름 편집 커밋(캔버스 노드·아웃라인 공용) — 현재 스코프 노드는 state, 펼친 자식은 scope-split 저장.
  const renameNode = useCallback(
    (id: string, label: string) => {
      setEditingNodeId(null);
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes((current) => {
        const taken = current.filter((node) => node.id !== id).map((node) => node.data.label);
        const unique = makeUniqueLabel(label, taken);
        return current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, label: unique } } : node,
        );
      });
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, scheduleAutoSave],
  );

  // 플레이스홀더 후차 연결 + 스테일 링크 교체 (design §10.1) — 배너 클릭 → 다이얼로그
  const [connectTarget, setConnectTarget] = useState<{
    nodeId: string;
    title: string;
    originId: number | null;
    originPath: string | null;
    successor: { id: number; name: string } | null;
  } | null>(null);
  const openConnectPlaceholder = useCallback(
    (nodeId: string) => {
      const node = reactFlow.getNode(nodeId) as AppNode | undefined;
      if (!node) {
        return;
      }
      const linked = node.data.linkedMapId ?? null;
      if (linked === null) {
        setConnectTarget({
          nodeId,
          title: node.data.label,
          originId: node.data.placeholderCategoryId ?? null,
          originPath: node.data.placeholderCategoryPath ?? null,
          successor: null,
        });
        return;
      }
      // 스테일 링크(삭제·이양된 맵) 교체 — 출처는 옛 맵의 카테고리, 추천은 이양 후계자 (2026-08-30)
      const ref = subprocessRefs.get(linked);
      if (ref?.deleted !== true) {
        return;
      }
      setConnectTarget({
        nodeId,
        title: node.data.label,
        originId: ref.category_id ?? null,
        originPath: ref.category_path ?? null,
        successor:
          ref.successor_map_id != null && ref.successor_name != null
            ? { id: ref.successor_map_id, name: ref.successor_name }
            : null,
      });
    },
    [reactFlow, subprocessRefs],
  );
  const applyConnectPlaceholder = useCallback(
    (
      map: Pick<MapSummary, "id" | "name">,
      origin?: { categoryId: number; categoryPath: string | null; designated: boolean },
    ) => {
      if (connectTarget === null || readOnly) {
        return;
      }
      if (origin) {
        // 낙관 참조 — 연결 직후 refs 도착 전에도 외부 L6 스타일 즉시 반영 (2026-08-30 #4)
        setOptimisticRefs((current) => {
          const next = new Map(current);
          next.set(map.id, makeOptimisticRef({ name: map.name, ...origin }));
          return next;
        });
      }
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.id === connectTarget.nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  // 라벨은 링크맵 이름 고정(F5) — 연결 즉시 이름을 따라간다
                  label: map.name,
                  linkedMapId: map.id,
                  followLatest: true,
                  linkedVersionId: null,
                  placeholderCategoryId: null,
                  placeholderCategoryPath: null,
                },
              }
            : node,
        ),
      );
      scheduleAutoSave();
      setConnectTarget(null);
      showToast(t("framework.connectedToast", { name: map.name }));
    },
    [connectTarget, readOnly, pushHistory, setNodes, scheduleAutoSave, showToast, t, setOptimisticRefs],
  );

  // SP 폭 그립 확정 — 노드 데이터에 영속(자동저장), 기본(180)이면 null 소거 (2026-08-30)
  const resizeSpNode = useCallback(
    (nodeId: string, width: number | null) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, nodeWidth: width } } : node,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setNodes, scheduleAutoSave],
  );

  // 게시본 기준 — 승인 탭 변경 요약의 왼쪽(최신 published, 없으면 섹션 미노출) (2026-08-30 #3)
  const latestPublishedBase = useMemo(() => {
    const published = versions.filter((v) => v.status === "published");
    return published.length > 0 ? published[published.length - 1] : null;
  }, [versions]);
  // 라이브 노드 계보 루트 — rootGraph(전체)의 source_node_id. 스냅샷 쪽 번역과 대칭이어야
  // 게시본 열람 중 전량 삭제+추가 오탐이 없다 (2026-08-30 픽스)
  const liveLineageById = useMemo(
    () => new Map((rootGraph?.nodes ?? []).map((n) => [n.id, n.source_node_id ?? n.id])),
    [rootGraph],
  );

  const updateSelectedEdgeLabel = useCallback(
    (label: string) => {
      if (readOnly) {
        return;
      }
      recordChange(true);
      setEdges((current) =>
        current.map((edge) =>
          edge.id === selectedEdgeId
            ? { ...edge, label: label || undefined }
            : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, recordChange, selectedEdgeId, setEdges, scheduleAutoSave],
  );

  // 엣지별 선 모양 변경 — 인스펙터 엣지 패널·컨텍스트 메뉴 공용 (type이 저장 시 line_style로 영속)
  const setEdgeLineStyle = useCallback(
    (edgeId: string, style: EdgeLineStyle) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        current.map((edge) => (edge.id === edgeId ? { ...edge, type: style } : edge)),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  const setEdgeSide = useCallback(
    (edgeId: string, end: "source" | "target", side: HandleSide) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                ...(end === "source"
                  ? { sourceHandle: sourceHandleId(side) }
                  : { targetHandle: targetHandleId(side) }),
              }
            : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  // 엣지 라벨 편집 모드 진입 — 엣지 선택 + 인스펙터 라벨 포커스 + 캔버스 가운데 인라인 박스(더블클릭·우클릭 공용)
  const edgeLabelInputRef = useRef<HTMLInputElement>(null);
  const startEdgeLabelEdit = useCallback(
    (edgeId: string) => {
      setSelectedId(null);
      setSummaryNodeId(null);
      setSelectedEdgeId(edgeId);
      setEditingEdgeId(edgeId);
      // 엣지 중점 위치를 이벤트 시점에 계산(ref 접근 허용 — 렌더 중엔 금지). 끝점 변 중앙의 중간점.
      const edge = edgesRef.current.find((e) => e.id === edgeId);
      const srcRect = edge ? screenRectOf(edge.source) : null;
      const tgtRect = edge ? screenRectOf(edge.target) : null;
      if (edge && srcRect && tgtRect) {
        const pointOf = (rect: ScreenRect, side: HandleSide): { x: number; y: number } => {
          const midX = rect.left + rect.width / 2;
          const midY = rect.top + rect.height / 2;
          if (side === "left") return { x: rect.left, y: midY };
          if (side === "right") return { x: rect.left + rect.width, y: midY };
          if (side === "top") return { x: midX, y: rect.top };
          return { x: midX, y: rect.top + rect.height }; // bottom
        };
        const from = pointOf(srcRect, sideFromHandleId(edge.sourceHandle, "right"));
        const to = pointOf(tgtRect, sideFromHandleId(edge.targetHandle, "left"));
        setEditingEdgePos({ left: (from.x + to.x) / 2, top: (from.y + to.y) / 2 });
      } else {
        // 인라인 박스를 못 띄울 때만 인스펙터 라벨 입력에 포커스 —
        // 인라인 박스가 뜰 땐 그쪽이 autoFocus 유지(인스펙터가 포커스를 뺏어 즉시 blur→커밋되던 문제, A1)
        setEditingEdgePos(null);
        setTimeout(() => {
          edgeLabelInputRef.current?.focus();
          edgeLabelInputRef.current?.select();
        }, 0);
      }
    },
    [screenRectOf],
  );

  // 가운데 인라인 박스에서 라벨 커밋 — 값 적용 후 편집 종료. Esc 취소는 cancelEdgeLabelEdit.
  const commitEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      setEditingEdgeId(null);
      setEditingEdgePos(null);
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId ? { ...edge, label: label.trim() || undefined } : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );

  const cancelEdgeLabelEdit = useCallback(() => {
    setEditingEdgeId(null);
    setEditingEdgePos(null);
  }, []);

  // 가운데 편집 박스 초기값 — 현재 스코프(edges)에 편집 대상 엣지가 있을 때만. (렌더 IIFE 회피)
  const editingEdgeInitial = useMemo<string | null>(() => {
    if (!editingEdgeId) {
      return null;
    }
    const edge = edges.find((e) => e.id === editingEdgeId);
    if (!edge) {
      return null;
    }
    return typeof edge.label === "string" ? edge.label : "";
  }, [editingEdgeId, edges]);

  // 검색 결과 선택 — 같은 스코프면 바로 포커스, 아니면 스코프 이동 후 포커스
  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setSearchQuery("");
      setSearchResults([]);
      const targetScope = result.scopes[result.scopes.length - 1];
      if (scopeHostId(targetScope) === currentParentId) {
        setSelectedId(result.node.id);
        setSelectedEdgeId(null);
        void reactFlow.fitView({
          nodes: [{ id: result.node.id }],
          padding: 0.4,
          duration: 300,
          maxZoom: 1.25,
        });
        return;
      }
      focusNodeIdRef.current = result.node.id;
      void navigateTo(result.scopes);
    },
    [currentParentId, reactFlow, navigateTo],
  );

  // PNG/Excel/CSV 3버튼 공유 — 파일명 규칙(sanitize+stamp) 단일 소스
  const buildExportFileName = useCallback(
    (ext: string) => {
      const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
      const sanitize = (text: string) => text.replace(/[^\w가-힣.-]+/g, "-");
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      return `${sanitize(mapName)}_${sanitize(versionLabel)}_${stamp}.${ext}`;
    },
    [versions, versionId, mapName],
  );

  const handleExportPng = useCallback(async () => {
    try {
      // getNodesBounds는 전달받은 좌표 그대로 프레임을 잡는데, 캡처 대상(.react-flow__viewport)은
      // height-shift로 밀린 *표시* 위치를 그린다 — 저장 좌표(nodesRef)로 프레임을 잡으면 밀려난
      // 하단 노드가 잘린다(I1/I2 PNG export). 여기서만 오프셋을 더해 표시 위치로 맞춘다(저장 좌표는 불변).
      const offsets = renderYOffsetsRef.current;
      const exportNodes =
        offsets.size === 0
          ? nodesRef.current
          : nodesRef.current.map((node) => {
              const yOff = offsets.get(node.id);
              return yOff
                ? { ...node, position: { x: node.position.x, y: node.position.y + yOff } }
                : node;
            });
      // 좌하단 정보 카드 — 이름·부서(org_path 리프)·오너·버전·게시일(있으면)·프레임워크(등록 시)
      const version = versions.find((v) => v.id === versionId);
      const publishedAt = findPublishedAt(version?.events);
      const info = {
        title: mapName,
        rows: [
          { label: t("export.infoOwningDept"), value: mapOwningDept?.split("/").filter(Boolean).pop() ?? "-" },
          { label: t("export.infoOwner"), value: mapOwnerName ?? mapOwner ?? "-" },
          { label: t("export.infoVersion"), value: version?.label ?? "-" },
          ...(publishedAt
            ? [{ label: t("export.infoPublished"), value: formatKst(publishedAt) }]
            : []),
          ...(mapCategoryPath
            ? [{ label: t("export.infoFramework"), value: mapCategoryPath }]
            : []),
        ],
      };
      await exportCanvasPng(exportNodes, buildExportFileName("png"), info);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  }, [buildExportFileName, t, versions, versionId, mapName, mapOwningDept, mapOwnerName, mapOwner, mapCategoryPath]);

  const handleExportCsv = useCallback(() => {
    // 저장 경로와 동일 소스(buildGraph)로 조립 — 캔버스 미저장 편집분까지 반영
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
    const { csv, warnings } = buildCsvFromGraph(graph);
    // BOM은 이스케이프로 명시 — 보이지 않는 리터럴은 포매터/편집에서 증발할 수 있다
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildExportFileName("csv");
    anchor.click();
    URL.revokeObjectURL(url);
    if (warnings.length > 0) showToast(t("export.csvWarnings"));
  }, [buildExportFileName, showToast, t]);

  // Excel 모달용 모델 빌더 — 저장 경로와 동일 소스(buildGraph)로 미저장 편집분까지 반영.
  // async로 감싸 buildGraph의 동기 throw까지 promise rejection으로 잡히게 한다(모달 .catch가 error로 수렴).
  const buildMapExcelModel = useCallback(async () => {
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    return buildExcelModel({
      graph,
      mapName,
      versionLabel,
      exportedAt: formatKst(new Date().toISOString()),
      fetchResolved: (id, follow, pinned) => getResolvedGraph(id, follow, pinned),
      rootMapId: mapId,
    });
  }, [versions, versionId, mapName, mapId]);

  const buildWbsExcelModel = useCallback(async () => {
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    return buildWbsModel({
      graph,
      mapName,
      versionLabel,
      exportedAt: formatKst(new Date().toISOString()),
      fetchResolved: (id, follow, pinned) => getResolvedGraph(id, follow, pinned),
      rootMapId: mapId,
    });
  }, [versions, versionId, mapName, mapId]);

  const excelFileNameFor = useCallback(
    (format: ExcelExportFormat) =>
      format === "wbs" ? buildExportFileName("xlsx").replace(/\.xlsx$/, "_WBS.xlsx") : buildExportFileName("xlsx"),
    [buildExportFileName],
  );

  // Word 내보내기/완결문서 생성 공용 — 캔버스 노드·엣지를 export 모델로(word맵은 고정크기+섹션앵커).
  const buildWordExportModel = () => {
    const exportNodes = nodesRef.current.map((node) => {
      const size = isWordMap
        ? { w: WORD_SHAPE_W, h: WORD_SHAPE_H }
        : nodeSizeOf(node.data.nodeType);
      return {
        id: node.id,
        title: node.data.label,
        nodeType: node.data.nodeType,
        x: node.position.x,
        y: node.position.y,
        w: size.w,
        h: size.h,
        url: node.data.url,
        urlLabel: node.data.urlLabel,
        sectionAnchor: node.data.section_anchor,
      };
    });
    const nodeById = new Map(exportNodes.map((n) => [n.id, n]));
    const exportEdges = edgesRef.current.map((edge) => {
      let sourceSide = sideFromHandleId(edge.sourceHandle, "right");
      let targetSide = sideFromHandleId(edge.targetHandle, "left");
      // Word 맵: 캔버스 핸들이 폴백(right/left)으로 어긋나는 문제 회피 — 노드 상대 위치로 변을 유도해
      // 실제 레이아웃(위/아래·좌/우)과 연결 변을 일치시킨다. 일반 맵은 기존 핸들 기반 유지.
      const s = nodeById.get(edge.source);
      const t = nodeById.get(edge.target);
      if (isWordMap && s && t) {
        const dx = t.x + t.w / 2 - (s.x + s.w / 2);
        const dy = t.y + t.h / 2 - (s.y + s.h / 2);
        if (Math.abs(dx) >= Math.abs(dy)) {
          sourceSide = dx >= 0 ? "right" : "left";
          targetSide = dx >= 0 ? "left" : "right";
        } else {
          sourceSide = dy >= 0 ? "bottom" : "top";
          targetSide = dy >= 0 ? "top" : "bottom";
        }
      }
      return {
        sourceId: edge.source,
        targetId: edge.target,
        label: typeof edge.label === "string" && edge.label ? edge.label : undefined,
        sourceSide,
        targetSide,
      };
    });
    return { exportNodes, exportEdges };
  };

  const wordDocFileName = (suffix: string) => {
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    const sanitize = (text: string) => text.replace(/[^\w가-힣.-]+/g, "-");
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return `${sanitize(mapName)}_${sanitize(versionLabel)}${suffix}_${stamp}.docx`;
  };

  const handleExportWord = () => {
    try {
      const { exportNodes, exportEdges } = buildWordExportModel();
      // word 맵은 fit-to-page 끔 → 도형 정확히 1.5×3cm(스프레드 시 페이지 초과 가능).
      exportCanvasWord(exportNodes, exportEdges, wordDocFileName(""), !isWordMap);
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // 완결 문서 생성 — 사용자가 원본 .docx 선택 → 사본에 합성 책갈피 주입 + 끝에 순서도 페이지 → 다운로드.
  const handleCompleteDocPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    try {
      const originalDocx = new Uint8Array(await file.arrayBuffer());
      const { exportNodes, exportEdges } = buildWordExportModel();
      const { generateCompleteWordDoc } = await import("@/lib/word-doc-generator");
      const blob = await generateCompleteWordDoc(originalDocx, exportNodes, exportEdges);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = wordDocFileName("_complete");
      link.click();
      URL.revokeObjectURL(url);
      // 생성 성공 기록 — 실패해도 다운로드는 이미 완료라 흐름을 막지 않는다 (design 2026-07-24 §5)
      void markWordDocGenerated(mapId).catch((err) =>
        console.warn("word-doc generated stamp failed", err),
      );
    } catch (err) {
      setStatus(humanizeApiError(err, t));
    }
  };

  // ── 컨텍스트 메뉴 ─────────────────────────────────────

  const openMenu = useCallback(
    (
      event: React.MouseEvent | MouseEvent,
      kind: MenuState["kind"],
      targetId: string | null,
      meta?: { regionLabel?: string; viaTitle?: boolean },
    ) => {
      event.preventDefault();
      // Ctrl은 복사(Ctrl+드래그) modifier — macOS는 Ctrl+클릭=네이티브 우클릭이라 contextmenu가 발화한다.
      // Ctrl이 눌린 채면 메뉴를 열지 않아 Ctrl+드래그 복사와 충돌하지 않게 한다(우클릭/투핑거는 그대로 동작).
      if (event.ctrlKey) {
        return;
      }
      // 읽기 전용에서는 노드 메뉴(드릴다운)와 펼침 영역 메뉴(이동·접기 = 조회 동작)만 의미가 있다
      if (readOnly && kind !== "node" && kind !== "region") {
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, kind, targetId, ...meta });
    },
    [readOnly],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) {
      return [];
    }
    // 정렬은 2개 이상, 분배는 3개 이상 대상이 있어야 의미가 있다 — 부족하면 비활성화
    const selectedCount = nodes.filter((node) => node.selected).length;

    // 정렬·레이아웃 통합 하위 메뉴 — ids=null이면 전체(pane), 지정이면 그 대상. 가로/세로는 아이콘으로 구분.
    const alignSubmenu = (
      ids: ReadonlySet<string> | null,
      count: number,
    ): ContextMenuItem[] => [
      {
        label: t("ctx.autoLayoutH"),
        icon: MoveHorizontal,
        accel: "a",
        shortcut: "A",
        disabled: ids ? count < 2 : false,
        onSelect: () => applyAutoLayout("LR", ids),
      },
      {
        label: t("ctx.autoLayoutV"),
        icon: MoveVertical,
        accel: "s",
        shortcut: "S",
        disabled: ids ? count < 2 : false,
        onSelect: () => applyAutoLayout("TB", ids),
      },
      { divider: true },
      { caption: t("legend.align") },
      // 4방향 정렬(캡션 아래 한 그룹) — 좌측 / 가로 가운데 / 상단 / 세로 가운데
      {
        label: t("editor.alignLeft"),
        icon: AlignStartVertical,
        shortcut: "W",
        accel: "w",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "left", ids ?? undefined)),
      },
      {
        label: t("editor.alignCenterX"),
        icon: AlignCenterVertical,
        shortcut: "C",
        accel: "c",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "centerX", ids ?? undefined)),
      },
      // 상단 / 세로 가운데 — 같은 정렬 그룹으로 연속(중간 구분선 제거)
      {
        label: t("editor.alignTop"),
        icon: AlignStartHorizontal,
        shortcut: "T",
        accel: "t",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "top", ids ?? undefined)),
      },
      {
        label: t("editor.alignCenterY"),
        icon: AlignCenterHorizontal,
        shortcut: "X",
        accel: "x",
        disabled: count < 2,
        onSelect: () => applyNodesTransform((current) => alignSelected(current, "centerY", ids ?? undefined)),
      },
      { divider: true },
      { caption: t("legend.distribute") },
      // 등간격 분배 — 가로 / 세로
      {
        label: t("editor.distributeX"),
        icon: AlignHorizontalDistributeCenter,
        shortcut: "R",
        accel: "r",
        disabled: count < 3,
        onSelect: () => applyNodesTransform((current) => distributeSelected(current, "x", ids ?? undefined)),
      },
      {
        label: t("editor.distributeY"),
        icon: AlignVerticalDistributeCenter,
        shortcut: "V",
        accel: "v",
        disabled: count < 3,
        onSelect: () => applyNodesTransform((current) => distributeSelected(current, "y", ids ?? undefined)),
      },
    ];
    const alignItem = (ids: ReadonlySet<string> | null, count: number): ContextMenuItem => ({
      label: t("ctx.align"),
      icon: LayoutGrid,
      accel: "a",
      shortcut: "A",
      submenu: alignSubmenu(ids, count),
    });

    // 펼침 영역(틴트) 우클릭 — 겹침(중첩 펼침)이면 히트테스트가 가장 안쪽 영역을 넘겨준다.
    // 대상이 헷갈리지 않게 메뉴 첫 줄에 그 맵 이름을 박는다(이름 필을 눌러 연 메뉴는 이미 자명해 생략).
    if (menu.kind === "region") {
      return [
        ...(menu.viaTitle
          ? []
          : ([
              { title: menu.regionLabel || t("node.childBadge"), icon: Network },
              { divider: true },
            ] as ContextMenuItem[])),
        {
          label: t("subprocess.openMap"),
          icon: ExternalLink,
          onSelect: () => {
            if (menu.targetId) {
              promptOpenLinkedMap(menu.targetId); // 확인 게이트(미저장 경고) 후 이동
            }
          },
        },
        {
          label: t("node.collapseChildTitle"),
          icon: X,
          onSelect: () => {
            if (menu.targetId) {
              toggleInlineExpandRef.current?.(menu.targetId);
            }
          },
        },
      ];
    }
    if (menu.kind === "pane") {
      // 기타 하위메뉴 — PNG 내보내기 등 보조 동작(추후 확장 지점). 실제 키는 전역 Ctrl/⌘+⇧+E(라벨 그대로).
      const moreItem: ContextMenuItem = {
        label: t("ctx.more"),
        icon: MoreHorizontal,
        submenu: [
          {
            label: t("ctx.exportPng"),
            icon: Download,
            shortcut: "Ctrl+⇧E",
            onSelect: () => void handleExportPng(),
          },
        ],
      };
      // 서브프로세스 라이브러리 열기 — 툴바 버튼·전역 S 단축키와 동일하게 읽기전용에서도 동작(조회 전용 진입점).
      const libraryItem: ContextMenuItem = {
        label: isWordMap
          ? "Add section"
          : isFrameworkMap
            ? t("framework.pickerOpen")
            : t("library.open"),
        icon: Network,
        // accel 필수 — 전역 S 핸들러는 메뉴 열림 중 무시(!menu)라, 우클릭 후 S는 메뉴 가속기가 처리
        accel: "s",
        shortcut: "S",
        onSelect: () =>
          isWordMap
            ? setSectionsOpen(true)
            : isFrameworkMap
              ? setFrameworkPickerOpen(true)
              : setLibraryOpen(true),
      };
      if (readOnly) {
        return [moreItem, { divider: true }, libraryItem];
      }
      return [
        // 캔버스는 subprocess 링크+분기·끝만 — process/start 추가 항목 숨김 (2026-08-28 개선)
        ...NODE_TYPE_OPTIONS.filter(
          (option) => !isFrameworkMap || option.value === "decision" || option.value === "end",
        ).map((option, index) => ({
          label: t(option.labelKey),
          icon: NODE_TYPE_ICONS[option.value],
          shortcut: String(index + 1),
          accel: String(index + 1),
          onSelect: () => handleAddNode({ x: menu.x, y: menu.y }, option.value),
        })),
        { divider: true },
        alignItem(null, selectedCount),
        { divider: true },
        moreItem,
        { divider: true },
        libraryItem,
      ];
    }
    // 그룹/복수선택 정렬 메뉴 — ids 미지정(selection)은 선택 노드, 지정(group)은 그룹 멤버 대상
    if (menu.kind === "group" || menu.kind === "selection") {
      const ids =
        menu.kind === "group"
          ? new Set(nodes.filter((node) => menu.targetId !== null && node.data.groupIds.includes(menu.targetId)).map((node) => node.id))
          : new Set(nodes.filter((node) => node.selected).map((node) => node.id));
      const targetCount = ids.size;
      const groupId = menu.targetId;
      // 그룹 우클릭 = 이름변경·색상(인라인)·멤버 일괄편집·해제·정렬. 이름변경 F2는 그룹 선택상태가 없어 미지원(메뉴만).
      if (menu.kind === "group" && groupId && !readOnly) {
        const groupColor = groups.find((g) => g.id === groupId)?.color ?? "";
        return [
          // setNewGroupId → GroupTitleBar가 autoEdit로 인라인 이름 편집 진입(신호는 소비 후 해제).
          { label: t("ctx.renameGroup"), icon: Type, onSelect: () => setNewGroupId(groupId) },
          {
            colors: GROUP_COLOR_PRESETS,
            current: groupColor,
            onPick: (color: string) => recolorGroup(groupId, color),
          },
          { label: t("group.bulkEdit"), icon: SlidersHorizontal, onSelect: () => setBulkEditGroupId(groupId) },
          { divider: true },
          { label: t("ctx.disband"), icon: Ungroup, onSelect: () => disbandGroup(groupId) },
          { divider: true },
          alignItem(ids, targetCount),
        ];
      }
      // 복수선택 우클릭 = 그룹 생성(+정렬)
      const selectionActions: ContextMenuItem[] =
        menu.kind === "selection" && !readOnly
          ? [
              {
                label: t("ctx.createGroup"),
                icon: Group,
                shortcut: "G",
                accel: "g",
                disabled: targetCount < 2,
                onSelect: () => createGroupFromSelection(),
              },
              { divider: true },
            ]
          : [];
      // 복수선택은 맨 아래 구분선 + 삭제(선택 노드 전부). D/Del 가속기.
      const deleteSelected: ContextMenuItem[] =
        menu.kind === "selection" && !readOnly && targetCount > 0
          ? [
              { divider: true },
              {
                label: t("ctx.delete"),
                icon: Trash2,
                shortcut: ["Del", "D"],
                accel: "d",
                danger: true,
                onSelect: () =>
                  void reactFlow.deleteElements({ nodes: [...ids].map((id) => ({ id })) }),
              },
            ]
          : [];
      return [...selectionActions, alignItem(ids, targetCount), ...deleteSelected];
    }
    if (menu.kind === "edge") {
      const edge = edges.find((e) => e.id === menu.targetId);
      if (!edge || readOnly) {
        return [];
      }
      // 하위프로세스(라이브러리) 끝점은 전용 핸들(in=좌/__primary__=우) 고정 → 면 선택 잠금
      const sourceLocked =
        nodes.find((n) => n.id === edge.source)?.data.nodeType === "subprocess";
      const targetLocked =
        nodes.find((n) => n.id === edge.target)?.data.nodeType === "subprocess";
      return [
        { caption: t("edge.connection") },
        {
          edgeSides: true,
          sourceLabel: t("edge.startBox"),
          targetLabel: t("edge.endBox"),
          sourceSide: sideFromHandleId(edge.sourceHandle, "right"),
          targetSide: sideFromHandleId(edge.targetHandle, "left"),
          sourceLocked,
          targetLocked,
          onPickSource: (side: HandleSide) => setEdgeSide(edge.id, "source", side),
          onPickTarget: (side: HandleSide) => setEdgeSide(edge.id, "target", side),
        },
        { divider: true },
        {
          lineStyles: EDGE_LINE_STYLE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
            icon: option.icon,
          })),
          current: normalizeEdgeLineStyle(edge.type),
          onPick: (value: string) => setEdgeLineStyle(edge.id, normalizeEdgeLineStyle(value)),
        },
        { divider: true },
        {
          label: t("edge.editLabel"),
          icon: PencilLine,
          shortcut: "F2",
          onSelect: () => startEdgeLabelEdit(edge.id),
        },
        // 노드 메뉴처럼 삭제 앞 스페이서를 2줄(구분선 2개)로 통일
        { divider: true },
        { divider: true },
        {
          label: t("ctx.delete"),
          icon: Trash2,
          shortcut: ["Del", "D"],
          accel: "d",
          danger: true,
          onSelect: () => void reactFlow.deleteElements({ edges: [{ id: edge.id }] }),
        },
      ];
    }
    if (menu.kind === "node") {
      // 임베드 자식(현재 스코프 밖) — 편집 액션 없음. "(읽기전용)" 안내 1항목만(캔버스·아웃라인 공통).
      if (menu.targetId !== null && !nodes.some((item) => item.id === menu.targetId)) {
        return [{ note: t("ctx.readonlyChild") }];
      }
      const deleteItems: ContextMenuItem[] = readOnly
        ? []
        : [
            { divider: true },
            {
              label: t("ctx.delete"),
              icon: Trash2,
              shortcut: ["Del", "D"],
              accel: "d",
              danger: true,
              onSelect: () => {
                if (menu.targetId) {
                  void reactFlow.deleteElements({ nodes: [{ id: menu.targetId }] });
                }
              },
            },
          ];
      // subprocess는 단일색 고정 — 컨텍스트 메뉴 색 항목 자체를 숨김 (spec 2026-07-06 §9)
      const menuNodeType = nodes.find((item) => item.id === menu.targetId)?.data.nodeType;
      const colorItems: ContextMenuItem[] = readOnly || menuNodeType === "subprocess"
        ? []
        : [
            {
              // 노드 타입별 색 세트 (#8) — 메인6·start/end3·분기4
              colors: colorsForType(menuNodeType),
              current: nodes.find((item) => item.id === menu.targetId)?.data.color ?? "",
              onPick: handleRecolor,
              moreLabel: t("editor.moreColors"),
            },
            { divider: true },
          ];
      // 하위 있으면 "열기"(창 — 기존 편집), process+하위없으면 "생성"(Start/작업/End 자동 + 인라인 펼침)
      const targetNode = nodes.find((item) => item.id === menu.targetId);
      const hasKids = targetNode?.data.hasChildren ?? false;
      // subprocess 펼치기/접기 — 액션 바 expandable과 동일 조건(끝 핸들 존재·미잠금·지정됨). 참조 모델
      // subprocess는 hasChildren(구 parent_node_id 모델)이 항상 false라 아래 "열기" 항목이 못 잡는다.
      // nodes state엔 subEnds/locked가 없어(displayNodes에서 파생 주입) 같은 주입을 거쳐 판정한다.
      const injectedTarget = targetNode ? injectSubEnds(targetNode) : undefined;
      const expandableSub =
        injectedTarget?.data.nodeType === "subprocess" &&
        (injectedTarget.data.subEnds ?? []).length > 0 &&
        !injectedTarget.data.locked &&
        !injectedTarget.data.undesignated;
      const openChildItems: ContextMenuItem[] = expandableSub
        ? [
            {
              label: t(
                menu.targetId !== null && expandedInline.has(menu.targetId)
                  ? "node.action.collapse"
                  : "node.action.expand",
              ),
              icon: Maximize2,
              onSelect: () => {
                if (menu.targetId) {
                  toggleInlineExpandRef.current?.(menu.targetId);
                }
              },
            },
          ]
        : hasKids
          ? [
              {
                label: t("ctx.openChild"),
                icon: Maximize2,
                onSelect: () => {
                  // 드릴인 창 대신 인라인 펼침/접기(toggleInlineExpand) — ref는 정의 순서(TDZ) 회피용
                  if (menu.targetId) {
                    toggleInlineExpandRef.current?.(menu.targetId);
                  }
                },
              },
            ]
          : [];
      // 이름 변경 — 인라인 타이틀 편집 진입(startRename). 편집 전용이라 readOnly에선 숨김(F2 전역키와 동일).
      // subprocess는 타이틀=링크된 맵 이름 고정이라 항목 자체 숨김 (F5)
      const renameItems: ContextMenuItem[] = readOnly || menuNodeType === "subprocess"
        ? []
        : [
            {
              label: t("editor.rename"),
              icon: Type,
              shortcut: "F2",
              onSelect: () => {
                if (menu.targetId) {
                  startRenameRef.current?.(menu.targetId);
                }
              },
            },
          ];
      return [
        // 노드 우클릭 기본 = 정보 수정 모달(보기+편집)
        {
          label: t("ctx.editInfo"),
          icon: PencilLine,
          shortcut: "E",
          accel: "e",
          onSelect: () => {
            if (menu.targetId) {
              setSummaryNodeId(menu.targetId);
            }
          },
        },
        ...renameItems,
        { divider: true },
        ...colorItems,
        ...openChildItems,
        ...deleteItems,
      ];
    }
    return [
      {
        label: t("ctx.editLabel"),
        onSelect: () => {
          setSelectedEdgeId(menu.targetId);
          setSelectedId(null);
        },
      },
      { divider: true },
      {
        label: t("ctx.delete"),
        shortcut: "Del",
        danger: true,
        onSelect: () => {
          if (menu.targetId) {
            void reactFlow.deleteElements({ edges: [{ id: menu.targetId }] });
          }
        },
      },
    ];
  }, [
    menu,
    readOnly,
    isFrameworkMap,
    nodes,
    edges,
    expandedInline,
    injectSubEnds,
    setEdgeSide,
    setEdgeLineStyle,
    startEdgeLabelEdit,
    handleAddNode,
    handleRecolor,
    applyNodesTransform,
    handleExportPng,
    createGroupFromSelection,
    disbandGroup,
    groups,
    recolorGroup,
    applyAutoLayout,
    reactFlow,
    isWordMap,
    promptOpenLinkedMap,
    t,
  ]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );
  // 선택된 subprocess의 지정 정보 — 인스펙터 읽기전용 카드 소스(라이브 참조, nodes state엔 sp* 미주입)
  const selectedSpRef =
    selectedNode?.data.nodeType === "subprocess" && selectedNode.data.linkedMapId != null
      ? subprocessRefs.get(selectedNode.data.linkedMapId)
      : undefined;
  // ── IO 링크(불러오기) 인스펙터 배선 (io-linking §4) ──
  // 미러를 실제로 보유한 원본/SP 항목의 줄 인덱스 — 행 아이콘 표시는 이 집합으로만 판정한다
  // (getIoLinkPeers는 호출마다 인덱스를 재구축하므로 행 단위로 쓰지 않는다).
  const ioMirrorIndex = useMemo(() => buildIoMirrorIndex(nodes), [nodes]);
  const collectLinkedIndexes = (ids: string | null | undefined): ReadonlySet<number> => {
    const set = new Set<number>();
    (ids ?? "").split("\n").forEach((raw, i) => {
      const itemId = raw.trim();
      if (itemId !== "" && (ioMirrorIndex.get(itemId)?.length ?? 0) > 0) {
        set.add(i);
      }
    });
    return set;
  };
  const ioOriginGroupIndexes = collectLinkedIndexes(selectedNode?.data.output_ids);
  const ioSpLinkedInputIndexes = collectLinkedIndexes(
    selectedSpRef?.designated ? selectedSpRef.input_ids : null,
  );
  const ioSpLinkedOutputIndexes = collectLinkedIndexes(
    selectedSpRef?.designated ? selectedSpRef.output_ids : null,
  );
  // 끊긴 흐름 경고 — 선택 노드 인풋 미러 중 원본→소비 경로 부재 행(표시 전용, io-linking 백로그 2026-08-21)
  const ioBrokenInputIndexes = selectedNode
    ? getBrokenInputMirrorIndexes(nodes, edges, subprocessRefs, selectedNode.id)
    : new Set<number>();
  // 항목 hover → 상대편 노드 + 흐름 경로 엣지 하이라이트 — 계산은 computeIoLinkHighlight 공용
  // (캔버스 노드 내 IO 행 hover와 동일 효과, io-linking §2·§4-5)
  const handleIoHoverItem = (side: IoSide, index: number | null) => {
    if (selectedNode === null || index === null) {
      setIoHighlight(null);
      return;
    }
    setIoHighlight(
      computeIoLinkHighlight(nodes, edges, subprocessRefs, selectedNode.id, side, index),
    );
  };
  // 불러오기 후보 — 모달이 열린 동안 hover가 ioHighlight 리렌더를 유발하므로 memo로 재스캔 방지
  const ioImportCandidates = useMemo(
    () =>
      ioImport
        ? collectIoImportCandidates({
            nodes,
            edges,
            spRefs: subprocessRefs,
            nodeId: ioImport.nodeId,
            side: ioImport.side,
          })
        : [],
    [ioImport, nodes, edges, subprocessRefs],
  );
  // 읽기전용 링크 항목 클릭 → 연결 노드 드롭다운(#2). anchorId는 경로 하이라이트 기준점
  const [ioPeersMenu, setIoPeersMenu] = useState<{
    anchorId: string;
    at: { x: number; y: number };
    items: IoPeerItem[];
  } | null>(null);
  const handleIoPeersMenu = (side: IoSide, index: number, at: { x: number; y: number }) => {
    if (selectedNode === null) return;
    const peers = getIoLinkPeers(nodes, subprocessRefs, selectedNode.id, side, index);
    const items: IoPeerItem[] = [];
    if (peers.origin && peers.origin.nodeId !== selectedNode.id) {
      const originNode = nodes.find((n) => n.id === peers.origin?.nodeId);
      if (originNode) {
        items.push({
          nodeId: originNode.id,
          label: originNode.data.label,
          side: peers.origin.kind === "spin" ? "input" : "output",
        });
      }
    } else {
      for (const mirror of peers.mirrors) {
        if (mirror.nodeId === selectedNode.id) continue;
        const mirrorNode = nodes.find((n) => n.id === mirror.nodeId);
        if (mirrorNode) {
          items.push({ nodeId: mirrorNode.id, label: mirrorNode.data.label, side: mirror.side });
        }
      }
    }
    if (items.length > 0) setIoPeersMenu({ anchorId: selectedNode.id, at, items });
  };
  // 미러 텍스트 클릭 → 원본 노드로 이동(선택+센터링). 원본이 없으면 no-op (io-linking §4-4)
  const handleIoNavigate = (side: IoSide, index: number) => {
    if (selectedNode === null) return;
    const peers = getIoLinkPeers(nodes, subprocessRefs, selectedNode.id, side, index);
    if (peers.origin && peers.origin.nodeId !== selectedNode.id) {
      setIoHighlight(null);
      highlightNode(peers.origin.nodeId);
    }
  };
  // 노드 타입별 편집 가능 파라미터 — subprocess는 회당 4필드가 링크 맵 지정값이라 제외 (design §3.1)
  const editableParams = selectedNode ? getEditableParamFields(selectedNode.data.nodeType) : [];
  // 상속 파라미터 표시값 — subprocess의 읽기전용 4행(링크 맵 지정값). 미지정이면 ""(행은 "—")
  const selectedInheritedParams = getInheritedParams(selectedSpRef);
  const inheritedParamDisplay = (field: ParamField): string =>
    isSpParamField(field) ? formatParamValue(field, selectedInheritedParams[field]) : "";
  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  );
  // 선택 엣지가 판단 노드 분기면 그 종류(Yes/No/기타), 아니면 null — 인스펙터 탭 표시 판정
  const selectedEdgeBranch = useMemo<BranchKind | null>(() => {
    if (!selectedEdge) {
      return null;
    }
    const source = nodes.find((node) => node.id === selectedEdge.source);
    if (source?.data.nodeType !== "decision") {
      return null;
    }
    return branchKindOf(selectedEdge.label);
  }, [selectedEdge, nodes]);

  // 인스펙터 탭으로 분기 종류 전환 — Yes/No는 고정 라벨, 기타는 라벨 비우고 직접 편집
  const setSelectedEdgeBranch = useCallback(
    (kind: BranchKind) => {
      updateSelectedEdgeLabel(
        kind === "yes" ? BRANCH_YES_LABEL : kind === "no" ? BRANCH_NO_LABEL : "",
      );
    },
    [updateSelectedEdgeLabel],
  );
  // 노드별 미해결 코멘트 수 — 렌더 시 nodes에 주입 (effect 내 setState 회피)
  const unresolvedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      if (!comment.resolved) {
        counts.set(comment.node_id, (counts.get(comment.node_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [comments]);

  // 마스킹 게이트 — 잠긴 링크맵은 펼침 불가(canvas 펼침·컨텍스트 open child·아웃라인 subprocess 모두 여기로 수렴).
  // Masking gate: locked linked-maps cannot expand (canvas expand · context open-child · outline subprocess all converge here).
  const canExpand = useCallback((nodeId: string): boolean => {
    const node = fullGraphRef.current?.nodes.find((n) => n.id === nodeId);
    const k = node ? linkKey(node) : null;
    return !(k != null && lockedKeysRef.current.has(k));
  }, []);

  // 인라인 펼치기/접기 토글 — 순수 뷰(raw state·저장 무영향). 펼칠 때 한도 초과면 확인 모달.
  const toggleInlineExpand = useCallback(
    (nodeId: string) => {
      // 마스킹 게이트(현재 no-op, 항상 허용) — 펼침/컨텍스트 open child/아웃라인 subprocess 모두 여기로 수렴.
      if (!canExpand(nodeId)) {
        return;
      }
      const next = new Set(expandedInline);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        // 중첩: 이 노드의 후손도 모두 접는다 — 안 그러면 후손의 childNodes가 고아로 남는다.
        if (fullGraph) {
          const parentOf = new Map(fullGraph.nodes.map((n) => [n.id, n.parent_node_id]));
          const isDescendant = (id: string): boolean => {
            let cursor = parentOf.get(id) ?? null;
            while (cursor != null) {
              if (cursor === nodeId) {
                return true;
              }
              cursor = parentOf.get(cursor) ?? null;
            }
            return false;
          };
          for (const id of [...next]) {
            if (isDescendant(id)) {
              next.delete(id);
            }
          }
        }
        commitExpanded(next);
        return;
      }
      next.add(nodeId);
      if (fullGraph) {
        const limits = checkExpansionLimits(fullGraph, next);
        if (limits.exceeds) {
          setCapPrompt({ next, nodeCount: limits.nodeCount, depth: limits.depth });
          return;
        }
      }
      commitExpanded(next);
    },
    [expandedInline, fullGraph, commitExpanded, canExpand],
  );
  // 컨텍스트 메뉴 등 위쪽 useMemo에서 호출하도록 ref로 노출(TDZ 회피)
  useEffect(() => {
    toggleInlineExpandRef.current = toggleInlineExpand;
  }, [toggleInlineExpand]);

  // 모두 펼치기/접기 버튼은 제거됨(제 기능 못 함) — 개별 노드 펼침만 유지 / removed all-expand/collapse buttons.

  const confirmCapPrompt = useCallback(() => {
    if (capPrompt) {
      commitExpanded(capPrompt.next);
    }
    setCapPrompt(null);
  }, [capPrompt, commitExpanded]);

  // 인라인 펼침 합성(영역 컨테이너 모델, 중첩 재귀) — 펼친 노드 오른쪽에 하위 "캔버스 레인"을 삽입하고
  // 공간상 그보다 오른쪽 노드를 우측으로 민다. 왼쪽/A의 수동 배치는 보존(전체 재배치 아님). 파생 레이어.
  // height-shift(#1) 상시 스텝/오프셋 — 합성(아래 inlineComposition) 입력에도 베이크하므로 게이트 없이 산출.
  // 펼침 중 표시는 합성 좌표가 담당(베이크)하고, 평시 표시는 renderYOffsets 트윈이 담당한다(flowNodes에서 게이트).
  // 드래그 중엔 시작 시점 스텝으로 동결 — 커진 노드(앵커)를 끌면 자기 밴드가 매 프레임 따라 움직여
  // 표시(offset)와 역변환이 서로 쫓으며 마우스·원위치 사이를 튀는 지터가 난다. 드롭 시 해제(트윈 복귀).
  const [dragFrozenSteps, setDragFrozenSteps] = useState<ShiftStep[] | null>(null);
  const heightSteps = useMemo(
    () => dragFrozenSteps ?? buildHeightSteps(nodes),
    [dragFrozenSteps, nodes],
  );
  useEffect(() => {
    heightStepsRef.current = heightSteps;
  }, [heightSteps]);
  const yOffsets = useMemo(() => buildYOffsets(nodes, heightSteps), [nodes, heightSteps]);

  // 드래그 제스처 동안 게스처 노드들의 렌더 Y오프셋을 시작 시점 값으로 동결 — 표시(displayNodes)와
  // 역변환(dropDraggingPositions)이 같은 상수를 쓰는 선형(항등) 왕복이 되어, 밴드 경계의 도달불가 갭에서
  // 노드가 스톨→점프하지 않고 커서를 1:1 연속 추종한다. 드롭 시 해제 → 계단 오프셋으로 트윈 정착.
  const [dragYOffsets, setDragYOffsets] = useState<ReadonlyMap<string, number> | null>(null);
  function captureDragYOffsets(dragged: { id: string }[]) {
    // 인라인 펼침 중엔 rootOffsets 라이브 경로(dragLiveById)가 표시를 담당 — 이 경로는 비활성(빈 맵).
    const captured = inlineCompositionRef.current
      ? new Map<string, number>()
      : new Map(dragged.map((n) => [n.id, renderYOffsetsRef.current.get(n.id) ?? 0]));
    dragYOffsetsRef.current = captured;
    setDragYOffsets(captured.size > 0 ? captured : null);
  }
  function clearDragYOffsets() {
    dragYOffsetsRef.current = new Map();
    setDragYOffsets(null);
  }

  const inlineComposition = useMemo(() => {
    if (expandedInline.size === 0 || !fullGraph) {
      return null;
    }
    const tree = fullGraph;
    const rootIds = new Set(nodes.map((node) => node.id));
    // height-shift(#1)를 합성 입력에 베이크 — 펼침 중에도 커진 노드 아래가 밀린 표시 Y로 배치된다.
    // 파생(childTop·regions bbox·rootOffsets=표시−저장)이 전부 이 표시 Y 기준으로 자동 일관.
    const displayNodes =
      yOffsets.size === 0
        ? nodes
        : nodes.map((node) => {
            const yOff = yOffsets.get(node.id);
            return yOff
              ? { ...node, position: { x: node.position.x, y: node.position.y + yOff } }
              : node;
          });

    // 루트 스코프(depth 1) 펼침 앵커별 footprint-shift 단계 — 각 {저장 x, footprint}.
    // 드롭 좌표 환산 시 "이 저장 x에서의 표시 오프셋"을 위치 의존으로 재계산하기 위함(드래그 시작 오프셋이 아닌
    // 드롭 위치 오프셋으로 환산 → 영역 경계를 가로지른 드래그가 footprint만큼 빗나가지 않게). x는 저장 좌표.
    const rootShiftSteps: { x: number; footprint: number }[] = [];

    // 한 스코프를 배치 — 펼친 노드마다 하위 스코프를 재귀 배치해 오른쪽에 영역으로 삽입.
    // 입력 노드는 이미 배치돼 있음(루트=수동, 자식=dagre). depth>1이면 결과를 원점 정규화해 부모가 평행이동.
    const buildScope = (
      scopeNodes: AppNode[],
      depth: number,
    ): { nodes: AppNode[]; regions: RegionBox[]; childEdges: Edge[]; width: number; height: number } => {
      const placed = new Map<string, AppNode>(
        scopeNodes.map((node) => [node.id, { ...node, position: { ...node.position } }]),
      );
      const descendants: AppNode[] = [];
      const regions: RegionBox[] = [];
      const childEdges: Edge[] = [];

      const expandedHere = scopeNodes
        .filter((node) => expandedInline.has(node.id))
        .sort((a, b) => a.position.x - b.position.x);

      for (const target of expandedHere) {
        const anchor = placed.get(target.id);
        if (!anchor) {
          continue;
        }
        const kidsFlat = tree.nodes.filter((node) => node.parent_node_id === target.id);
        if (kidsFlat.length === 0) {
          continue;
        }
        const kidApp = kidsFlat.map((flat) => {
          const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, target.id);
          // 자식은 선택 허용. 위치는 파생이라 드래그/삭제는 불가.
          // 자식은 `nodes` state에 없어 React Flow가 측정 못 함 → 미측정 노드는 visibility:hidden으로 숨겨진다.
          // 타입별 근사 크기를 measured로 직접 넣어 즉시 보이게 한다(레이아웃도 이 크기로 일관).
          // 폭·높이는 라벨 실측 추정 — 긴 라벨은 wrap으로 넓고(≤NODE_MAX_WIDTH)·세로로 커져 영역 경계가 감싸야 하므로.
          const width = estimateNodeWidth(app.data.label, app.data.nodeType);
          const height = estimateNodeHeight(app.data.label, app.data.nodeType, width);
          // 중첩 하위프로세스 자식도 펼침 가능하게 subEnds 주입(캐시 있으면)
          return injectSubEnds({
            ...app,
            draggable: false,
            selectable: true,
            deletable: false,
            width,
            height,
            measured: { width, height },
            data: app.data,
          });
        });
        const kidIds = new Set(kidsFlat.map((kid) => kid.id));
        const kidEdges = toAppEdges({
          nodes: [],
          edges: tree.edges.filter(
            (edge) => kidIds.has(edge.source_node_id) && kidIds.has(edge.target_node_id),
          ),
          groups: [],
        }).map((edge) => ({ ...edge, selectable: false, deletable: false, focusable: false }));
        // 자식 스코프 로컬 LR 배치 후 재귀(자식 안의 펼침 처리)
        // 자식은 dagre 재배치 대신 저장된 위치를 그대로 사용 — 드래그 편집이 영속되고 인라인=드릴인 레이아웃 일관.
        const sub = buildScope(kidApp, depth + 1);
        const anchorSize = nodeSizeOf(anchor.data.nodeType);
        const regionW = sub.width + REGION_PAD * 2;
        const regionX = anchor.position.x + anchorSize.w + REGION_GAP;
        // 영역 상단을 앵커 상단에 정렬(세로 중심정렬 아님) — 단일행 초기표시는 동일하고, 자식 세로 드래그 시 재중심화 튐을 없앤다.
        const childTop = anchor.position.y;
        // A 바로 오른쪽 노드도 영역을 완전히 벗어나도록 앵커 폭 포함(겹침 방지)
        const footprint = anchorSize.w + regionW + REGION_GAP * 2;
        // 루트 스코프 앵커만 기록 — x는 저장 좌표(target은 원본 nodes 항목이라 미쉬프트). 드롭 환산용.
        if (depth === 1) {
          rootShiftSteps.push({ x: target.position.x, footprint });
        }
        // 공간상 A보다 오른쪽 = 우측 이동(이 스코프 노드 + 먼저 배치된 자식/영역)
        for (const node of placed.values()) {
          if (node.position.x > anchor.position.x) {
            node.position = { ...node.position, x: node.position.x + footprint };
          }
        }
        for (const node of descendants) {
          if (node.position.x > anchor.position.x) {
            node.position = { ...node.position, x: node.position.x + footprint };
          }
        }
        for (const region of regions) {
          if (region.x > anchor.position.x) {
            region.x += footprint;
          }
        }
        // 하위 레이아웃을 영역 안쪽으로 평행이동(좌: 안쪽 여백, 상: A 세로 중앙)
        const offsetX = regionX + REGION_PAD;
        for (const node of sub.nodes) {
          descendants.push({
            ...node,
            position: { x: node.position.x + offsetX, y: node.position.y + childTop },
          });
        }
        for (const region of sub.regions) {
          regions.push({ ...region, x: region.x + offsetX, y: region.y + childTop });
        }
        childEdges.push(...sub.childEdges, ...kidEdges);
        regions.push({
          id: target.id,
          label: target.data.label,
          depth,
          x: regionX,
          y: 0,
          width: regionW,
          height: 0,
        });
      }

      // 콘텐츠 bbox — Y는 노드만, X는 노드+영역(영역이 더 넓을 수 있음)
      const all = [...placed.values(), ...descendants];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of all) {
        const size = nodeSizeOf(node.data.nodeType);
        // 폭·높이 실측 우선(자식은 라벨 실측 추정을 measured로 주입) — 긴 라벨로 넓/커진 노드를 영역 경계가 감싸도록.
        const nodeW = node.measured?.width ?? size.w;
        const nodeH = node.measured?.height ?? size.h;
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + nodeW);
        maxY = Math.max(maxY, node.position.y + nodeH);
      }
      for (const region of regions) {
        minX = Math.min(minX, region.x);
        maxX = Math.max(maxX, region.x + region.width);
      }
      const width = all.length > 0 ? maxX - minX : 0;
      const height = all.length > 0 ? maxY - minY : 0;
      // 중첩(depth>1)은 원점 정규화 — 부모가 (offsetX, childTop)으로 평행이동하도록
      if (depth > 1 && all.length > 0) {
        for (const node of all) {
          node.position = { x: node.position.x - minX, y: node.position.y - minY };
        }
        for (const region of regions) {
          region.x -= minX;
          region.y -= minY;
        }
      }
      return { nodes: all, regions, childEdges, width, height };
    };

    const root = buildScope(displayNodes, 1);
    if (root.regions.length === 0) {
      return null;
    }
    const allNodes = root.nodes;
    const childNodes = allNodes.filter((node) => !rootIds.has(node.id));
    const { regions, childEdges } = root;

    // 영역 박스 세로 범위 — 전체 콘텐츠(모든 깊이) Y 범위 + 여백. 모든 영역이 동일 y/height라 바깥이 안을 항상 덮음.
    // 높이는 실측 우선(자식은 wrap 반영 추정을 measured로 주입) — 긴 라벨 노드가 박스 아래로 삐져나오지 않게.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of allNodes) {
      const size = nodeSizeOf(node.data.nodeType);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + (node.measured?.height ?? size.h));
    }
    for (const region of regions) {
      region.y = minY - REGION_MARGIN;
      region.height = maxY - minY + REGION_MARGIN * 2;
    }

    // 게이트웨이(A→진입, 진출→후속, 깊이 무관) + A→B 숨김(깊이 무관)
    const combinedEdges = [...edges, ...childEdges];
    // 게이트웨이 끝점이 subprocess면 전용 핸들(in/__primary__)로 보정 — 하드코딩 t-left는 subprocess에
    // 존재하지 않아 앵커 실패(연쇄 subprocess 펼침 시 진출 엣지 소실, F2).
    const subprocessIds = new Set(
      tree.nodes.filter((n) => n.node_type === "subprocess").map((n) => n.id),
    );
    const gateways = buildGatewayEdges(expandedInline, childNodes, combinedEdges).map((edge) => ({
      ...EDGE_DEFAULTS,
      ...withSubprocessHandles(edge, (nodeId) => subprocessIds.has(nodeId)),
      animated: false,
      selectable: false,
      deletable: false,
      focusable: false,
      style: { opacity: INLINE_GATEWAY_OPACITY, strokeDasharray: "5 4" },
    }));
    const hiddenIds = new Set(
      combinedEdges.filter((edge) => expandedInline.has(edge.source)).map((edge) => edge.id),
    );
    // 영역을 가로지르는 루트 엣지 → 반투명(양 끝이 영역 좌우로 갈리는 경우)
    const xOf = new Map<string, number>();
    for (const node of allNodes) {
      xOf.set(node.id, node.position.x);
    }
    const crossingIds = new Set<string>();
    for (const edge of edges) {
      if (hiddenIds.has(edge.id)) {
        continue;
      }
      const sx = xOf.get(edge.source);
      const tx = xOf.get(edge.target);
      if (sx == null || tx == null) {
        continue;
      }
      const lo = Math.min(sx, tx);
      const hi = Math.max(sx, tx);
      if (regions.some((region) => lo < region.x && hi > region.x + region.width)) {
        crossingIds.add(edge.id);
      }
    }

    // 자식별 영역 오프셋(파생 절대위치 − fullGraph 스코프상대) — 드래그/추가 시 절대↔스코프상대 변환용.
    // scopeOffsets: 같은 스코프 자식은 동일 오프셋 → 새 노드 추가 위치 변환에 사용.
    const childOffsets = new Map<string, { x: number; y: number }>();
    const scopeOffsets = new Map<string, { x: number; y: number }>();
    // rootOffsets: 펼침이 footprint-shift한 "루트 프레임" 노드의 (표시 − 저장) — 루트 드래그 영속 시 빼서
    // 이중 쉬프트(다음 재파생에서 또 밀림)를 막는다. childOffsets와 동일 패턴, 단 기준은 nodes state(=저장 좌표).
    const rootOffsets = new Map<string, { x: number; y: number }>();
    const savedRootPos = new Map(nodes.map((node) => [node.id, node.position]));
    for (const node of allNodes) {
      const sid = node.data.scopeId;
      if (sid != null && sid !== currentParentId) {
        const flat = fullGraph.nodes.find((entry) => entry.id === node.id);
        if (flat) {
          const offset = {
            x: node.position.x - flat.pos_x,
            y: node.position.y - flat.pos_y,
          };
          childOffsets.set(node.id, offset);
          scopeOffsets.set(sid, offset);
        }
      } else if (rootIds.has(node.id)) {
        const saved = savedRootPos.get(node.id);
        if (saved) {
          rootOffsets.set(node.id, {
            x: node.position.x - saved.x,
            y: node.position.y - saved.y,
          });
        }
      }
    }
    return {
      nodes: allNodes,
      childEdges,
      gateways,
      regions,
      hiddenIds,
      crossingIds,
      childOffsets,
      scopeOffsets,
      rootOffsets,
      rootShiftSteps,
    };
  }, [expandedInline, fullGraph, nodes, yOffsets, edges, currentParentId, injectSubEnds]);

  useEffect(() => {
    inlineCompositionRef.current = inlineComposition;
  }, [inlineComposition]);

  // 펼침 영역 헤더의 업무체계 라벨 소스 — hostId → 링크맵의 지정 체계(카테고리 id + 5단계 전체 경로).
  // 지정(designated) 링크맵만 category를 갖는다. 라벨 클릭 시 FrameworkPeekTrigger가 체계 피크를 연다.
  const regionFrameworks = useMemo(() => {
    const out = new Map<string, { categoryId: number; path: string; linkedMapId: number }>();
    if (!inlineComposition || !fullGraph) {
      return out;
    }
    const flatById = new Map(fullGraph.nodes.map((node) => [node.id, node]));
    for (const region of inlineComposition.regions) {
      const linkedMapId = flatById.get(region.id)?.linked_map_id;
      if (linkedMapId == null) {
        continue;
      }
      const ref = subprocessRefs.get(linkedMapId);
      if (ref?.designated && ref.category_id != null && ref.category_path) {
        out.set(region.id, { categoryId: ref.category_id, path: ref.category_path, linkedMapId });
      }
    }
    return out;
  }, [inlineComposition, fullGraph, subprocessRefs]);

  // 펼침 영역 호버/우클릭 히트테스트 — 틴트 박스는 pointer-events:none(패닝 보존)이라 pane 이벤트의
  // flow 좌표로 판정한다. 중첩 펼침(A>B>C)은 바깥 영역이 안쪽을 항상 포함하므로 **가장 깊은(안쪽)**
  // 매치를 돌려준다 — 안쪽에서 우클릭했는데 바깥 맵이 이동/접기 대상이 되던 것을 막는다(사용자 신고 2026-08-31).
  const [hoverRegionId, setHoverRegionId] = useState<string | null>(null);
  const findRegionAtClient = (clientX: number, clientY: number): string | null => {
    const regions = inlineCompositionRef.current?.regions;
    if (!regions || regions.length === 0) {
      return null;
    }
    const point = reactFlow.screenToFlowPosition({ x: clientX, y: clientY });
    let hit: RegionBox | null = null;
    for (const region of regions) {
      if (
        point.x >= region.x &&
        point.x <= region.x + region.width &&
        point.y >= region.y &&
        point.y <= region.y + region.height &&
        (hit === null || region.depth >= hit.depth)
      ) {
        hit = region;
      }
    }
    return hit?.id ?? null;
  };

  // 펼침/접힘은 줌·팬을 바꾸지 않는다(사용자 요청 — 자동 fitView 제거). 슬라이드 전환만 잠깐 켰다 끈다.
  useEffect(() => {
    if (!expandAnimating) {
      return;
    }
    const timer = window.setTimeout(() => setExpandAnimating(false), 450);
    return () => window.clearTimeout(timer);
  }, [expandAnimating]);

  // 포커스 모드 Step 2 — 활성 스코프가 자식일 때(currentParentId≠null) 조상 스코프 노드를 읽기전용 dim 컨텍스트로 렌더.
  // 활성 스코프(`nodes`)는 스코프상대 좌표라, 각 조상 스코프를 그 우변이 활성 스코프 좌측에 오도록 평행이동(상단 정렬). 깊이만큼 좌로 누적.
  // fullGraph는 자식 state(`nodes`)에 없어 React Flow 미측정 → measured 직접 주입(레슨: 미측정=visibility:hidden).
  const ancestorContextNodes = useMemo<AppNode[]>(() => {
    // 인라인 펼침 중에도 조상 컨텍스트를 그린다(펼치면 깊이0이 사라지던 버그) — 앵커는 "표시" 위치(합성된 nodes) 기준.
    const anchorNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (currentParentId === null || !fullGraph || anchorNodes.length === 0) {
      return [];
    }
    // 활성 스코프(현재 표시)의 가로 범위 — 조상들이 이 영역을 감싸도록 배치
    let aMinX = Infinity;
    let aMaxX = -Infinity;
    let aMinY = Infinity;
    for (const node of anchorNodes) {
      const w = nodeSizeOf(node.data.nodeType).w;
      aMinX = Math.min(aMinX, node.position.x);
      aMaxX = Math.max(aMaxX, node.position.x + w);
      aMinY = Math.min(aMinY, node.position.y);
    }
    const byId = new Map(fullGraph.nodes.map((flat) => [flat.id, flat]));
    const GAP = 60; // 인접 노드 가로 간격(인라인 펼침과 동일 언어)
    const out: AppNode[] = [];
    let focusId: string | null = currentParentId; // 이 노드를 담는 부모 스코프를 활성 영역 둘레에 그린다
    let region = { minX: aMinX, maxX: aMaxX };
    for (let guard = 0; guard < 20 && focusId !== null; guard++) {
      const parentScopeId: string | null = byId.get(focusId)?.parent_node_id ?? null; // focusId를 담는 스코프
      const siblings = fullGraph.nodes
        .filter((flat) => (flat.parent_node_id ?? null) === parentScopeId)
        .sort((a, b) => a.pos_x - b.pos_x);
      const focusIdx = siblings.findIndex((flat) => flat.id === focusId);
      if (focusIdx < 0) {
        break;
      }
      const built = siblings.map((flat) => {
        const [app] = toAppNodes({ nodes: [flat], edges: [], groups: [] }, parentScopeId);
        return { app, size: nodeSizeOf(app.data.nodeType) };
      });
      const xs: number[] = new Array(built.length);
      // 포커스 노드(현재 스코프) — 활성 영역 바로 왼쪽. 앞·뒤 형제는 stored X 상대 간격을 보존(비균일 배치도 펼친 뷰와 일치).
      const focusStoredX = built[focusIdx].app.position.x;
      xs[focusIdx] = region.minX - GAP - built[focusIdx].size.w;
      for (let i = focusIdx - 1; i >= 0; i--) {
        xs[i] = xs[focusIdx] + (built[i].app.position.x - focusStoredX); // 앞 형제: 포커스 노드 기준 상대
      }
      for (let i = focusIdx + 1; i < built.length; i++) {
        // 뒤 형제: 활성 영역 오른쪽 + 포커스 노드 기준 stored X 상대(펼친 뷰와 일치 — 영역이 포커스 노드를 대체).
        xs[i] = region.maxX + (built[i].app.position.x - focusStoredX);
      }
      // 세로: 스코프 내부 상대 y를 보존(포커스 노드를 활성 행에 정렬). 직선 흐름이면 모두 aMinY, 분기는 유지.
      const focusStoredY = built[focusIdx].app.position.y;
      let lvMinX = Infinity;
      let lvMaxX = -Infinity;
      for (let i = 0; i < built.length; i++) {
        const { app, size } = built[i];
        out.push({
          ...app,
          position: { x: xs[i], y: aMinY + (app.position.y - focusStoredY) },
          selectable: false,
          draggable: false,
          deletable: false,
          connectable: false,
          // measured만 주입(미측정=visibility:hidden 회피). width/height 프롭은 강제하지 않아 DOM은 내용 기반
          // 오토사이징 → 활성 노드와 동일 폭(강제 시 nodeSizeOf 근사 170으로 미세하게 넓어짐).
          measured: { width: size.w, height: size.h },
          style: { opacity: INACTIVE_SCOPE_OPACITY },
        });
        lvMinX = Math.min(lvMinX, xs[i]);
        lvMaxX = Math.max(lvMaxX, xs[i] + size.w);
      }
      region = { minX: lvMinX, maxX: lvMaxX }; // 이 레벨의 범위가 다음(상위) 조상의 활성 영역
      if (parentScopeId === null) {
        break; // 루트 스코프까지 그림
      }
      focusId = parentScopeId;
    }
    return out;
  }, [currentParentId, inlineComposition, fullGraph, nodes]);

  // height-shift(#1): 표시 높이로 커진 노드 아래를 렌더 시점에만 밀어냄 — 저장 좌표 불변.
  // 드롭 역변환용 게이트 스텝 — 펼침 중엔 rootOffsets(y 베이크 포함)가 드롭 환산을 담당하므로
  // 비활성(이중 차감 방지). 상시 스텝/오프셋은 위(heightSteps/yOffsets)에서 산출.
  const ySteps = useMemo(
    () => (inlineComposition ? [] : heightSteps),
    [inlineComposition, heightSteps],
  );
  useEffect(() => {
    yStepsRef.current = ySteps;
  }, [ySteps]);

  // 오프셋 전환 트윈 — CSS transition은 엣지(SVG 재계산)가 안 따라와 분리돼 보임 → 값 자체를 rAF 보간.
  // 즉시 적용 3조건: 첫 산출(로드 정착)·드래그 중·prefers-reduced-motion. (spec §6)
  const [renderYOffsets, setRenderYOffsets] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    renderYOffsetsRef.current = renderYOffsets;
  }, [renderYOffsets]);
  const yTweenInitRef = useRef(false);
  // 성장 반영 후 1회 재-fit — 초기 fitView는 측정 전(성장 전) 좌표 기준이라 밀린 하단 노드가
  // 뷰 밖일 수 있다(V라운드 관찰 1). 마운트 직후 창(1.5s) 안에서만 — 이후 사용자 펼침엔 카메라 불가침.
  const mountAtRef = useRef(0);
  useEffect(() => {
    mountAtRef.current = performance.now();
  }, []);
  const didGrowthFitRef = useRef(false);
  useEffect(() => {
    if (didGrowthFitRef.current || yOffsets.size === 0) return undefined;
    if (performance.now() - mountAtRef.current >= 1500) {
      didGrowthFitRef.current = true; // 창 밖 도착 — 이후 성장에도 카메라 불가침
      return undefined;
    }
    // 소모 플래그는 실제 발사 시점에 세운다 — 오프셋이 여러 커밋으로 나눠 오면(터미널 높이가 IO 박스보다
    // 먼저 확정되는 등) cleanup이 타이머를 취소하고 재예약 없이 끝나던 버그(QA W3). 지금은 마지막
    // 성장 커밋 기준 80ms 디바운스로 1회 발사.
    const timer = window.setTimeout(() => {
      didGrowthFitRef.current = true;
      void reactFlow.fitView({ padding: 0.1, duration: 300 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [yOffsets, reactFlow]);
  useEffect(() => {
    const from = renderYOffsetsRef.current;
    const to = yOffsets;
    // 동일하면 스킵 — set-state-in-effect 회피 겸 무한 루프 방지
    if (from.size === to.size && [...to].every(([id, v]) => from.get(id) === v)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dragging = dragStartPositionsRef.current.size > 0;
    const instant = !yTweenInitRef.current || dragging || reduced;
    yTweenInitRef.current = true;
    if (instant) {
      const raf = requestAnimationFrame(() => setRenderYOffsets(to));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const DURATION = 350;
    const ids = new Set([...from.keys(), ...to.keys()]);
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      // ease-smooth 근사(cubic ease-out) — 프레임마다 노드·엣지가 함께 이동
      const e = 1 - Math.pow(1 - t, 3);
      const next = new Map<string, number>();
      for (const id of ids) {
        const a = from.get(id) ?? 0;
        const b = to.get(id) ?? 0;
        const v = a + (b - a) * e;
        if (v !== 0) next.set(id, v);
      }
      setRenderYOffsets(t >= 1 ? to : next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [yOffsets]);

  const displayNodes = useMemo(() => {
    // 인라인 펼침 중이면 합성·재배치된 노드(현재+자식)를, 아니면 현재 노드를 기준으로 코멘트 수 주입
    const base = inlineComposition ? inlineComposition.nodes : nodes;
    // Ctrl+드래그 중인 원본 id — 끌리는 실제 노드는 반투명 사본으로 표시(커서를 따라오는 건 사본).
    // 진짜 원본 그래픽은 아래 ghostNodes가 원위치에 솔리드로 렌더하고, 엣지도 그 고스트로 앵커된다(styledEdges).
    const ctrlGhostIdSet = ctrlDragActive ? new Set(ctrlDragGhosts.map((g) => g.id)) : null;
    // IO 링크 hover — 상대 노드에 링 강조(className만, 스타일은 globals.css)
    const ioHighlightIdSet = ioHighlight ? new Set(ioHighlight.nodeIds) : null;
    // 파생 자식(prop-only) 대신 childNodes의 state 객체를 buildScope 파생 위치로 표시해야 RF가 측정·이벤트를 라우팅한다.
    const childById = inlineComposition
      ? new Map(childNodes.map((node) => [node.id, node] as const))
      : null;
    const mapped = base.map((node) => {
      const stateChild = childById?.get(node.id);
      let display;
      if (stateChild) {
        // 자식(인라인) 노드 — 읽기전용 dim. 드래그/삭제/연결 불가. 선택 시 선명하게 표시.
        const childOpacity = stateChild.selected ? 1 : INACTIVE_SCOPE_OPACITY;
        display = {
          ...stateChild,
          position: node.position,
          data: node.data,
          selectable: true,
          draggable: false,
          deletable: false,
          connectable: false,
          style: { ...stateChild.style, opacity: childOpacity },
        };
      } else if (inlineComposition) {
        // 프레임(현재 스코프) 노드 — 루트(편집 가능)면 편집, 딥뷰(읽기전용)면 선택만 가능한 읽기전용.
        // 드래그 중인 루트는 라이브 표시좌표로 덮어써 커서를 1:1 추종(footprint 쉬프트 무시).
        const live = dragLiveById.get(node.id);
        display = currentScopeIsReadOnly
          ? {
              ...node,
              draggable: false,
              selectable: true,
              deletable: false,
              connectable: false,
            }
          : live
            ? { ...node, position: live, connectable: true }
            : { ...node, connectable: true };
      } else {
        display = node;
      }
      const count = unresolvedCounts.get(display.id) ?? 0;
      const withCount =
        count === (display.data.commentCount ?? 0)
          ? display
          : { ...display, data: { ...display.data, commentCount: count } };
      // 담당자 부서 드리프트 경고 — eligible 로드 완료 후 & BPM 속성 노드만 계산(로드 전 오탐·차단타입 미표시), 읽기전용에서도 표시
      const hasWarning =
        eligible !== null &&
        hasBpmAttributes(withCount.data.nodeType) &&
        driftedAssignees(withCount.data.department, parseAssignees(withCount.data.assignee), eligible.users).length > 0;
      const withWarning =
        hasWarning === (withCount.data.assigneeWarning ?? false)
          ? withCount
          : { ...withCount, data: { ...withCount.data, assigneeWarning: hasWarning } };
      // Ctrl+드래그로 끌리는 원본은 반투명 사본 스타일 — 원위치엔 ghostNodes(솔리드)가 남아 원본을 대신한다.
      const withCopyStyle = ctrlGhostIdSet?.has(node.id)
        ? { ...withWarning, className: [withWarning.className, "bpm-node-ctrl-copy"].filter(Boolean).join(" ") }
        : withWarning;
      const withIoHighlight = ioHighlightIdSet?.has(node.id)
        ? { ...withCopyStyle, className: [withCopyStyle.className, "io-node-highlight"].filter(Boolean).join(" ") }
        : withCopyStyle;
      // 루트 하위프로세스 노드(이 경로는 미주입)에 subEnds 주입 — 펼침 토글·끝 핸들 렌더 활성화.
      // GMP 안내 버튼 호버 미리보기 — 노드에도 결과값을 임시 반영(데이터 무변경, 렌더 전용) (사용자 요청 2026-08-21)
      const withGmpPreview =
        gmpPreview !== null && gmpPreview.nodeId === node.id
          ? { ...withIoHighlight, data: { ...withIoHighlight.data, gmp: gmpPreview.gmp, color: gmpPreview.color } }
          : withIoHighlight;
      const injected = injectSubEnds(withGmpPreview);
      // height-shift 오프셋 — 저장 좌표는 nodes state에 그대로, 표시 위치만 rAF 트윈된 값으로 이동.
      // 펼침 중엔 합성 입력에 이미 베이크돼 있어 여기서 더하면 이중 적용 — 스킵.
      // 드래그 제스처 노드는 동결 오프셋 우선 — 역변환(선형)과 짝을 이뤄 커서 1:1 추종(위 dragYOffsets 주석).
      const yOff = inlineComposition
        ? 0
        : (dragYOffsets?.get(node.id) ?? renderYOffsets.get(node.id) ?? 0);
      return yOff === 0
        ? injected
        : { ...injected, position: { x: injected.position.x, y: injected.position.y + yOff } };
    });
    // 조상 컨텍스트(자식 스코프 활성 시)를 dim 읽기전용으로 덧붙임 — 루트(currentParentId=null)에선 빈 배열이라 무영향.
    // Ctrl+드래그 — 원본은 원위치에 그대로(솔리드) 남기고, 커서를 따라 끌리는 실제 노드만 반투명 사본으로
    // 보인다(위 bpm-node-ctrl-copy). 엣지는 styledEdges가 이 원위치 고스트로 앵커해 원본 자리에 남는다.
    // id를 원본과 다르게 접두(ctrl-ghost:)해야 RF 노드 배열에서 key 충돌이 안 난다.
    const ghostNodes: AppNode[] = ctrlDragActive
      ? ctrlDragGhosts.map((ghost) => ({
          id: `ctrl-ghost:${ghost.id}`,
          type: "process",
          position: ghost.position,
          draggable: false,
          selectable: false,
          connectable: false,
          deletable: false,
          data: ghost.data,
        }))
      : [];
    let result: AppNode[] = [...mapped, ...ancestorContextNodes, ...ghostNodes];
    // stale 앵커 배지 — 재임포트로 사라진 앵커를 참조하는 섹션 노드에 표시 플래그 주입 (design 2026-07-24 §5)
    if (staleAnchorIds.size > 0) {
      result = result.map((n) =>
        staleAnchorIds.has(n.id) ? { ...n, data: { ...n.data, staleAnchor: true } } : n,
      );
    }
    return result;
  }, [
    nodes,
    childNodes,
    inlineComposition,
    unresolvedCounts,
    eligible,
    ancestorContextNodes,
    currentScopeIsReadOnly,
    dragLiveById,
    injectSubEnds,
    ctrlDragActive,
    ctrlDragGhosts,
    staleAnchorIds,
    ioHighlight,
    gmpPreview,
    renderYOffsets,
    dragYOffsets,
  ]);

  // 엣지 렌더 변환 — 선택 노드 기준 앞/뒤 단계 강조(target teal, source orange) 등.
  // 선 모양(type)은 엣지별 저장값 그대로 유지(구 맵 전역 일괄 적용은 "전체 일괄 변경" 액션으로 대체).
  const styledEdges = useMemo(() => {
    const hiddenIds = inlineComposition?.hiddenIds;
    const crossingIds = inlineComposition?.crossingIds;
    // F14 플로우 경로 하이라이트 — 선택 노드에서 전방 (reach+1)홉 / 후방 (-reach)홉 엣지 집합.
    const fwdHops = flowReach >= 0 ? flowReach + 1 : 1;
    const bwdHops = flowReach < 0 ? -flowReach : 0;
    const forwardIds = selectedId
      ? new Set(getFlowPathForward(edges, selectedId, fwdHops))
      : new Set<string>();
    const backwardIds = selectedId
      ? new Set(getFlowPathBackward(edges, selectedId, bwdHops))
      : new Set<string>();
    // Ctrl+드래그 중엔 끌리는 노드의 엣지를 원위치 고스트(ctrl-ghost:id)로 앵커 — 엣지가 원본 자리에 남고
    // 반투명 사본만 커서를 따라간다(원본은 제자리 유지). ghostIds가 없으면 항등 변환.
    const ctrlGhostIds = ctrlDragActive ? new Set(ctrlDragGhosts.map((g) => g.id)) : null;
    // IO 링크 hover — 원본↔미러 사이 흐름 경로 엣지(양방향 중 존재하는 쪽) 강조
    const ioHighlightEdgeIds = ioHighlight ? new Set(ioHighlight.edgeIds) : null;
    const anchorEdgesToGhosts = (list: Edge[]): Edge[] =>
      ctrlGhostIds
        ? list.map((edge) => {
            const remapSource = ctrlGhostIds.has(edge.source);
            const remapTarget = ctrlGhostIds.has(edge.target);
            return remapSource || remapTarget
              ? {
                  ...edge,
                  source: remapSource ? `ctrl-ghost:${edge.source}` : edge.source,
                  target: remapTarget ? `ctrl-ghost:${edge.target}` : edge.target,
                }
              : edge;
          })
        : list;
    const currentStyled = edges.map((edge) => {
      // 인라인 펼침 시 A→B는 렌더에서만 숨김(데이터 보존)
      if (hiddenIds?.has(edge.id)) {
        return { ...edge, hidden: true } as Edge;
      }
      let next: Edge = edge;
      // 영역을 가로지르는 엣지 — 반투명으로 영역 위를 지나가게
      if (crossingIds?.has(edge.id)) {
        next = { ...next, style: { ...next.style, opacity: REGION_CROSSING_OPACITY } };
      }
      // 라벨이 있는 엣지(분기 Yes/No/기타 등) — 디자인 알약 스타일
      if (edge.label) {
        // Yes/No 분기는 은은한 파스텔 블루/레드로 선·라벨 색 구분(라벨에서 파생, 영속 불필요). 기타는 기본 톤.
        const branch = branchKindOf(edge.label);
        const branchColor =
          branch === "yes"
            ? "var(--color-branch-yes)"
            : branch === "no"
              ? "var(--color-branch-no)"
              : null;
        next = {
          ...next,
          ...(branchColor
            ? {
                style: { ...next.style, stroke: branchColor },
                markerEnd: { type: MarkerType.ArrowClosed, color: branchColor },
              }
            : {}),
          labelStyle: EDGE_LABEL_STYLE,
          labelBgStyle: branchColor
            ? { fill: `color-mix(in srgb, ${branchColor} 14%, white)`, stroke: branchColor }
            : EDGE_LABEL_BG_STYLE,
          labelBgPadding: EDGE_LABEL_BG_PADDING,
          labelBgBorderRadius: 6,
        };
      }
      // 출력선 선택 모달에서 이 엣지 행 hover 시 캔버스 엣지 하이라이트 — className만 부여, 스타일은 globals.css.
      if (edge.id === hoveredEdgeId || ioHighlightEdgeIds?.has(edge.id)) {
        next = {
          ...next,
          className: [next.className, "edge-hover-highlight"].filter(Boolean).join(" "),
        };
      }
      if (!selectedId) {
        return next;
      }
      // 즉시 이웃(in/out) + F14 확장 경로(전방/후방) 하이라이트. 후방 우선(edge-in).
      const isBackward = edge.target === selectedId || backwardIds.has(edge.id);
      const isForward = edge.source === selectedId || forwardIds.has(edge.id);
      const stroke = isBackward
        ? "var(--color-edge-in)"
        : isForward
          ? "var(--color-edge-out)"
          : null;
      if (!stroke) {
        return next;
      }
      return {
        ...next,
        style: { ...next.style, stroke, strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      };
    });
    // 접힘 subprocess의 모든 끝(대표 포함)이 다음 노드로 연결돼 보이게 — 명시 엣지가 없는 끝 핸들에
    // 표시 전용 엣지를 파생(저장·선택 불가). 임베드 끝의 수동 배선이 차단되므로 기본 진출 흐름을 시각화 (F3).
    const syntheticEndEdges: Edge[] = [];
    for (const node of nodes) {
      if (node.data.nodeType !== "subprocess" || expandedInline.has(node.id)) {
        continue;
      }
      const k = linkKey({
        linked_map_id: node.data.linkedMapId ?? null,
        follow_latest: node.data.followLatest ?? false,
        linked_version_id: node.data.linkedVersionId ?? null,
      });
      const resolved = k ? resolvedCache.get(k) : undefined;
      const ends = resolved ? deriveSubEnds(resolved) : [];
      if (ends.length <= 1) {
        continue;
      }
      const outgoing = edges.filter((edge) => edge.source === node.id);
      if (outgoing.length === 0) {
        continue;
      }
      // sourceHandle 미지정(레거시)은 첫 핸들(=대표끝)에 앵커되므로 대표끝을 커버한 것으로 본다
      const covered = new Set(outgoing.map((edge) => edge.sourceHandle ?? PRIMARY_END_HANDLE));
      const anchor =
        outgoing.find((edge) => (edge.sourceHandle ?? PRIMARY_END_HANDLE) === PRIMARY_END_HANDLE) ??
        outgoing[0];
      for (const end of ends) {
        if (covered.has(end.key)) {
          continue;
        }
        syntheticEndEdges.push({
          ...EDGE_DEFAULTS,
          id: `sp-ends:${node.id}:${end.key}`,
          source: node.id,
          sourceHandle: end.key,
          target: anchor.target,
          targetHandle: anchor.targetHandle,
          // 같은 노드의 실제 출력 엣지(anchor)와 선 모양을 맞춤 — 표시 전용이라 영속 없음
          type: normalizeEdgeLineStyle(anchor.type),
          selectable: false,
          deletable: false,
          focusable: false,
        } as Edge);
      }
    }
    if (!inlineComposition) {
      return anchorEdgesToGhosts([...currentStyled, ...syntheticEndEdges]);
    }
    // 자식 엣지: 펼친 노드 출발(A→B)이면 숨김. 선 모양은 자식 맵 저장값 그대로(toAppEdges가 주입).
    // 게이트웨이는 합성 시 스타일 완료. 포커스 모드 Step 1: 비활성 스코프라 dim + 비선택(읽기전용).
    const childStyled = inlineComposition.childEdges.map((edge) => {
      if (hiddenIds?.has(edge.id)) {
        return { ...edge, hidden: true } as Edge;
      }
      return {
        ...edge,
        selectable: false,
        style: { ...edge.style, opacity: INACTIVE_SCOPE_OPACITY },
      };
    });
    return anchorEdgesToGhosts([...currentStyled, ...childStyled, ...inlineComposition.gateways, ...syntheticEndEdges]);
  }, [edges, nodes, resolvedCache, expandedInline, selectedId, inlineComposition, flowReach, hoveredEdgeId, ioHighlight, ctrlDragActive, ctrlDragGhosts]);

  // 그룹 박스 — 태그(다중 소속) 멤버 bbox로 산정. 멤버 많은 그룹일수록 패딩↑(작은 그룹을 감쌈),
  // z는 멤버 적은 그룹이 위(노드보다는 뒤). 반투명 fill이라 겹쳐도 모두 보임.
  const groupBoxes = useMemo(() => {
    // 인라인 펼침 중엔 그룹 박스 숨김 — 노드가 dagre로 재배치돼 raw 위치 기준 박스가 어긋나는 것 방지(Phase 2 단순화)
    if (expandedInline.size > 0) {
      return [];
    }
    // 저장좌표(nodes)에 height-shift 표시 오프셋을 더해야 멤버가 실제 렌더 위치(밀려난 하단)와 일치한다(I2).
    const dispY = (node: AppNode) => node.position.y + (renderYOffsets.get(node.id) ?? 0);
    return groups.flatMap((group) => {
      const members = nodes.filter((node) => node.data.groupIds.includes(group.id));
      if (members.length === 0) {
        return [];
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const member of members) {
        const w = member.measured?.width ?? NODE_WIDTH;
        const h = member.measured?.height ?? NODE_HEIGHT;
        const my = dispY(member);
        minX = Math.min(minX, member.position.x);
        minY = Math.min(minY, my);
        maxX = Math.max(maxX, member.position.x + w);
        maxY = Math.max(maxY, my + h);
      }
      // 멤버 많을수록 패딩↑ → 큰 그룹이 작은 그룹을 시각적으로 감쌈
      const pad = GROUP_PAD + Math.min(members.length, 8) * 4;
      const originX = minX - pad;
      const originY = minY - pad - GROUP_TITLE_GAP;
      const width = maxX - minX + pad * 2;
      const height = maxY - minY + pad * 2 + GROUP_TITLE_GAP;
      // 기본 사각형(멤버 padded bbox)에서, 범위 안에 들어온 비멤버 노드를 가장 가까운 변쪽으로 잘라냄.
      // 좌표는 박스 좌상단(origin) 기준 상대. y는 타이틀바 헤드룸(GROUP_TITLE_GAP)만큼 내림.
      const intruderMargin = 8;
      const intruders = nodes
        .filter((node) => !node.data.groupIds.includes(group.id))
        .flatMap((node) => {
          const w = node.measured?.width ?? NODE_WIDTH;
          const h = node.measured?.height ?? NODE_HEIGHT;
          const ny = dispY(node);
          // 멤버 padded bbox와 겹치는 비멤버만
          if (
            node.position.x >= maxX + pad ||
            node.position.x + w <= minX - pad ||
            ny >= maxY + pad ||
            ny + h <= minY - pad
          ) {
            return [];
          }
          return [
            {
              x: node.position.x - intruderMargin - originX,
              y: ny - intruderMargin - originY,
              w: w + intruderMargin * 2,
              h: h + intruderMargin * 2,
            },
          ];
        });
      // 멤버 노드(작은 여백)는 notch보다 우선 — notch가 멤버를 반만 자르지 않게 비껴감
      const memberKeep = 6;
      const memberRects = members.map((member) => {
        const w = member.measured?.width ?? NODE_WIDTH;
        const h = member.measured?.height ?? NODE_HEIGHT;
        return {
          x: member.position.x - memberKeep - originX,
          y: dispY(member) - memberKeep - originY,
          w: w + memberKeep * 2,
          h: h + memberKeep * 2,
        };
      });
      const region = rectWithExclusions(
        { x: 0, y: GROUP_TITLE_GAP, w: width, h: height - GROUP_TITLE_GAP },
        intruders,
        memberRects,
      );
      return [
        {
          id: group.id,
          label: group.label,
          color: group.color,
          x: originX,
          y: originY,
          width,
          height,
          fill: region.fill,
          outline: region.outline,
          // 멤버 적은 그룹이 위(z 큼). 전부 노드(z:0)보다 뒤
          z: -members.length,
        },
      ];
    });
  }, [nodes, groups, expandedInline, renderYOffsets]);

  // 노드 위치(nodeExtent)·패닝(translateExtent) 허용 범위 = 콘텐츠 bbox + 사방 대칭 여백(무한 캔버스 느낌, 자유 패닝).
  const contentExtent = useMemo<
    | { node: [[number, number], [number, number]]; pan: [[number, number], [number, number]] }
    | undefined
  >(() => {
    // 인라인 펼침 중엔 합성·재배치된 노드(현재+자식) 기준 — 자식이 패닝 범위 밖으로 잘리지 않게
    const extentNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (extentNodes.length === 0) {
      return undefined; // 빈 캔버스는 React Flow 기본(무제한)
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of extentNodes) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    // 조상 컨텍스트(좌측 dim)도 패닝 범위에 포함 — 안 그러면 translateExtent가 조상을 잘라 못 본다.
    for (const node of ancestorContextNodes) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    // 대칭 여백 — 좌상단 고정 없이 콘텐츠 사방에 동일 여백(줌아웃 시 기본 centering 허용). 패닝·노드 동일 extent.
    const extent: [[number, number], [number, number]] = [
      [minX - EXTENT_MARGIN, minY - EXTENT_MARGIN],
      [maxX + EXTENT_MARGIN, maxY + EXTENT_MARGIN],
    ];
    return { node: extent, pan: extent };
  }, [nodes, inlineComposition, ancestorContextNodes]);

  // 현재 스코프의 절대깊이(루트=0) — 인라인 펼침 셰브론을 절대깊이 기준으로 맞춰 포커스 레인과 통일.
  const currentScopeDepth = useMemo(() => {
    if (currentParentId === null) {
      return 0;
    }
    const byId = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
    let d = 0;
    let cur: string | null = currentParentId;
    while (cur !== null && d < 20) {
      d += 1;
      cur = byId.get(cur)?.parent_node_id ?? null;
    }
    return d;
  }, [currentParentId, fullGraph]);

  // 포커스(Path 2) — 자식 스코프에 들어가 있으면, 현재 스코프 + 보이는 조상 스코프(깊이≥1)를 각각 레인으로 감싼다.
  // 깊이별로 다른 틴트 → 중첩 레인(깊이2에서 깊이1 레인이 사라지지 않게). 루트(깊이0)는 틴트 없음.
  const focusScopeLanes = useMemo<
    { left: number; right: number; top: number; depth: number; label: string }[]
  >(() => {
    if (currentParentId === null) {
      return [];
    }
    const byId = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
    // 절대깊이(루트=0) — 인라인 펼침(InlineRegionBands)과 같은 기준이라 같은 스코프는 같은 셰브론.
    const depthOf = (scopeId: string | null): number => {
      let d = 0;
      let cur = scopeId;
      while (cur !== null && d < 20) {
        d += 1;
        cur = byId.get(cur)?.parent_node_id ?? null;
      }
      return d;
    };
    const boundsOf = (ns: AppNode[]) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      for (const node of ns) {
        const w = nodeSizeOf(node.data.nodeType).w;
        minX = Math.min(minX, node.position.x);
        maxX = Math.max(maxX, node.position.x + w);
        minY = Math.min(minY, node.position.y);
      }
      return { left: minX - REGION_PAD, right: maxX + REGION_PAD, top: minY };
    };
    const lanes: { left: number; right: number; top: number; depth: number; label: string }[] = [];
    // 현재(활성) 스코프 — 펼침 중이면 합성·재배치된 "표시" 위치 기준이라야 레인이 펼친 끝(밀려난 노드·자식)까지 따라간다.
    const currentScopeNodes = inlineComposition ? inlineComposition.nodes : nodes;
    if (currentScopeNodes.length > 0) {
      lanes.push({
        ...boundsOf(currentScopeNodes),
        depth: depthOf(currentParentId),
        label: byId.get(currentParentId)?.title ?? "",
      });
    }
    // 보이는 조상 스코프들 — 스코프별로 묶어 각자 레인(깊이0=루트는 제외)
    const byScope = new Map<string, AppNode[]>();
    for (const node of ancestorContextNodes) {
      const sid = node.data.scopeId ?? null;
      if (sid === null) {
        continue;
      }
      const arr = byScope.get(sid) ?? [];
      arr.push(node);
      byScope.set(sid, arr);
    }
    for (const [sid, ns] of byScope) {
      lanes.push({ ...boundsOf(ns), depth: depthOf(sid), label: byId.get(sid)?.title ?? "" });
    }
    return lanes;
  }, [currentParentId, nodes, inlineComposition, ancestorContextNodes, fullGraph]);

  const selectedComments = useMemo(
    () => comments.filter((comment) => comment.node_id === selectedId),
    [comments, selectedId],
  );

  // 노드에 표시할 정보 필드 — 사이드바 체크박스로 토글, localStorage 영속(v2 키).
  // params(칩 일괄) 토글은 기본 ON — 레거시 키 저장값은 parseDisplayToggles가 ON으로 이관.
  const [displayFields, setDisplayFields] = useState<NodeDisplayToggle[]>(["assignee", "params"]);

  useEffect(() => {
    const saved = parseDisplayToggles(
      window.localStorage.getItem("bpm.nodeDisplayFields.v2"),
      window.localStorage.getItem("bpm.nodeDisplayFields"),
    );
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
      setDisplayFields(saved);
    }
  }, []);
  // 영속은 토글 핸들러에서만 — displayFields 의존 effect로 쓰면 StrictMode 이중 마운트가
  // hydration 전 기본값을 저장소에 덮어써 사용자의 OFF 상태가 리셋된다(실측).

  // 새 엣지 선 모양 기본값 1회 hydration — 맵별 키 우선, 구 전역 키 폴백(구버전 사용자 선호 유지).
  // 영속은 일괄 변경 확정 핸들러에서만(상태-의존 effect 영속은 StrictMode 이중 마운트가
  // hydration 전 기본값을 저장소에 덮어써 저장값이 리셋됨, displayFields와 동일 진범)
  useEffect(() => {
    const saved =
      window.localStorage.getItem(`bpm.edgeStyle.${mapId}`) ??
      window.localStorage.getItem("bpm.edgeStyle");
    const resolved =
      saved === "default" || saved === "smoothstep" || saved === "straight" ? saved : "smoothstep";
    // 모듈 기본값 동기화 — 캔버스 헬퍼(withEdge 등)의 새 엣지 생성 경로가 이 값을 읽는다
    setNewEdgeLineStyle(resolved);
    // 무조건 set — 맵 간 인앱 이동(리마운트 없음) 시 이전 맵 기본값 하이라이트가 남지 않게
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 1회 hydration
    setEdgeStyle(resolved);
  }, [mapId]);

  // 전체 일괄 변경 확정 — 전 엣지 type 교체(변경분 있을 때만 히스토리/저장) + 새 엣지 기본값 영속(맵별)
  const applyBulkEdgeStyle = (style: EdgeLineStyle) => {
    setBulkEdgeStyle(null);
    if (edgesRef.current.some((edge) => normalizeEdgeLineStyle(edge.type) !== style)) {
      pushHistory();
      setEdges((current) =>
        current.map((edge) => (edge.type === style ? edge : { ...edge, type: style })),
      );
      scheduleAutoSave();
    }
    setEdgeStyle(style);
    setNewEdgeLineStyle(style);
    window.localStorage.setItem(`bpm.edgeStyle.${mapId}`, style);
  };

  const toggleDisplayField = useCallback(
    (field: NodeDisplayToggle) => {
      const next = displayFields.includes(field)
        ? displayFields.filter((f) => f !== field)
        : [...displayFields, field];
      window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(next));
      setDisplayFields(next);
    },
    [displayFields],
  );
  // 카테고리 일괄 보이기/숨기기(#4) — 영속은 핸들러에서만(위 StrictMode 리셋 랜드마인과 동일 이유)
  const setCategoryDisplayFields = useCallback(
    (fields: NodeDisplayToggle[], on: boolean) => {
      const next = on
        ? [...displayFields, ...fields.filter((f) => !displayFields.includes(f))]
        : displayFields.filter((f) => !fields.includes(f));
      window.localStorage.setItem("bpm.nodeDisplayFields.v2", JSON.stringify(next));
      setDisplayFields(next);
    },
    [displayFields],
  );

  // 맵 탭의 엣지 스타일 섹션 접힘 — 마운트마다 기본 접힘(세션 영속 불요). 노드 디스플레이는
  // NodeDisplaySection 컴포넌트가 자체 관리 (2026-08-20).
  const [edgeStyleSectionOpen, setEdgeStyleSectionOpen] = useState(false);
  const { closingKeys: inspectorClosingKeys, beginClose: beginInspectorClose, cancelClose: cancelInspectorClose } =
    useClosingKeys<string>();
  // 승인 탭 접힘 섹션 — 결재 대기는 기본 접힘, 워크플로는 기본 펼침(R6 W2). 위 accordion 인스턴스를
  // 키("editorApprovals"/"approvalWorkflow")로 공유.
  const [editorApprovalsSectionOpen, setEditorApprovalsSectionOpen] = useState(false);
  const [approvalWorkflowSectionOpen, setApprovalWorkflowSectionOpen] = useState(true);

  const cancelRename = useCallback(() => setEditingNodeId(null), []);
  // 타이틀 더블클릭 → 이름 편집 진입 (이름 외 영역 더블클릭은 요약창)
  const startRename = useCallback(
    (id: string) => {
      if (readOnly) {
        return;
      }
      // subprocess 타이틀은 링크된 맵 이름 고정 — 이름 편집 진입 차단 (F5)
      if (nodesRef.current.find((node) => node.id === id)?.data.nodeType === "subprocess") {
        return;
      }
      setSelectedId(id);
      setEditingNodeId(id);
    },
    [readOnly],
  );
  // 컨텍스트 메뉴(위쪽 menuItems useMemo)에서 호출하도록 ref로 노출(TDZ 회피)
  useEffect(() => {
    startRenameRef.current = startRename;
  }, [startRename]);
  // GMP 필 클릭 → 분류 피커(클릭 좌표 앵커). 편집 모드 전용 — readOnly면 컨텍스트에 null 전달
  const [gmpPicker, setGmpPicker] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  // setState만 부르는 핸들러는 useCallback 금지 — 컴파일러가 setter를 dep으로 추론해
  // preserve-manual-memoization에 걸린다(AGENTS.md). 평 함수로 두면 컴파일러가 메모이즈.
  const openGmpPicker = (nodeId: string, x: number, y: number) => setGmpPicker({ nodeId, x, y });
  // 픽커 대상 노드의 현재 값 — 미리보기·확정 패치가 공유 (렌더 IIFE 금지 — 컴파일러 ref 규칙)
  const gmpPickerNode = gmpPicker !== null ? nodes.find((n) => n.id === gmpPicker.nodeId) : undefined;
  const onEditGmpAction = readOnly ? null : openGmpPicker;
  // 분류 확정 안내 — 분류가 노드 색을 자동 변경하므로(일반 노드) 마우스 지점에 알리고
  // "이전 분류로"/"색만" 두 단계 되돌리기를 제공 (사용자 결정 2026-08-20)
  const [gmpNotice, setGmpNotice] = useState<{
    nodeId: string;
    prevGmp: string;
    prevColor: string;
    nextGmp: string;
    nextColor: string;
    x: number;
    y: number;
  } | null>(null);
  // 노드 IO 체크리스트(#9) — 화면 한정 상태(저장·영속 없음, 새로고침 리셋). 키는 링크 itemId
  // (원본·미러 그룹 동반 체크) 또는 노드·측·줄. 뷰어도 조작 가능 — 데이터가 아니라 열람 보조.
  const [ioChecks, setIoChecks] = useState<ReadonlySet<string>>(new Set());
  // 체크리스트 표시 상태(#2) — 키 `${nodeId}:${side}`, 미지정=capped(3.5줄)
  const [ioListStates, setIoListStates] = useState<ReadonlyMap<string, IoListDisplayState>>(new Map());
  const setIoListState = useCallback((key: string, state: IoListDisplayState) => {
    setIoListStates((prev) => {
      if (prev.get(key) === state) return prev;
      const next = new Map(prev);
      next.set(key, state);
      return next;
    });
  }, []);
  // 체크 동기 애니메이션(#3) — 논스로 같은 키 재체크도 재생
  const [ioCheckPulse, setIoCheckPulse] = useState<{ key: string; nonce: number } | null>(null);
  const toggleIoCheck = useCallback(
    (key: string) => {
      const turningOn = !ioChecks.has(key);
      setIoChecks((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      // 링크 항목 체크 시(#3) — 상대(원본·형제 미러) 목록이 접혀 있으면 펼치고(0줄→3.5줄),
      // 행이 캡 밖이면 전체 펼침, 체크 애니메이션 재생. per-노드 키(`:in:`/`:out:`)는 대상 없음
      if (!turningOn || /:(in|out):/.test(key)) return;
      const currentNodes = nodesRef.current;
      const sites: { nodeId: string; side: IoSide; index: number }[] = [
        ...(buildIoMirrorIndex(currentNodes).get(key) ?? []),
      ];
      const origin = buildIoIndex(currentNodes, subprocessRefs).get(key);
      if (origin && origin.kind === "out") {
        sites.push({ nodeId: origin.nodeId, side: "output", index: origin.index });
      }
      setIoListStates((prev) => {
        let next: Map<string, IoListDisplayState> | null = null;
        for (const site of sites) {
          const listKey = `${site.nodeId}:${site.side}`;
          const cur = (next ?? prev).get(listKey) ?? "capped";
          const want: IoListDisplayState =
            site.index >= 3 ? "all" : cur === "collapsed" ? "capped" : cur;
          if (want !== cur) {
            next = next ?? new Map(prev);
            next.set(listKey, want);
          }
        }
        return next ?? prev;
      });
      setIoCheckPulse((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [ioChecks, subprocessRefs],
  );
  // 캔버스 노드 IO 링크 행 hover — 인스펙터 행 hover(handleIoHoverItem)와 같은 하이라이트를
  // 노드 내부에서도 점등. nodes/edges는 ref 미러로 읽어 콜백을 stable하게 유지(컨텍스트 memo churn 방지)
  const handleNodeIoHoverLink = useCallback(
    (nodeId: string, side: IoSide, index: number | null) => {
      setIoHighlight(
        index === null
          ? null
          : computeIoLinkHighlight(
              nodesRef.current,
              edgesRef.current,
              subprocessRefs,
              nodeId,
              side,
              index,
            ),
      );
    },
    [subprocessRefs],
  );
  const nodeActions = useMemo(
    () => ({
      onToggleExpand: toggleInlineExpand,
      expandedInlineIds: expandedInline,
      displayFields,
      editingNodeId,
      onStartRename: startRename,
      onRename: renameNode,
      onCancelRename: cancelRename,
      ctrlDragIds: ctrlDragActive
        ? new Set(ctrlDragGhosts.map((ghost) => ghost.id))
        : EMPTY_CTRL_DRAG_IDS,
      onEditGmp: onEditGmpAction,
      ioChecks,
      onToggleIoCheck: toggleIoCheck,
      ioListStates,
      onSetIoListState: setIoListState,
      ioCheckPulse,
      onHoverIoLink: handleNodeIoHoverLink,
      // 후차 연결은 연계 캔버스 편집 모드에서만 — 일반 맵·읽기전용은 기존 배너 유지 (design §10.1)
      onConnectPlaceholder: isFrameworkMap && !readOnly ? openConnectPlaceholder : null,
      // SP 폭 그립 — 편집 표면에서만(비교·프리뷰·읽기전용은 null → 그립 미노출) (2026-08-30)
      onResizeNode: readOnly ? null : resizeSpNode,
    }),
    [
      toggleInlineExpand,
      expandedInline,
      displayFields,
      editingNodeId,
      startRename,
      renameNode,
      cancelRename,
      ctrlDragActive,
      ctrlDragGhosts,
      onEditGmpAction,
      ioChecks,
      toggleIoCheck,
      ioListStates,
      setIoListState,
      ioCheckPulse,
      handleNodeIoHoverLink,
      isFrameworkMap,
      readOnly,
      openConnectPlaceholder,
      resizeSpNode,
    ],
  );

  // 임베드 자식(prop-only)은 RF 노드 이벤트가 안 발화 → 캔버스 컨테이너 raw dblclick(capture)으로 가로챔.
  // 읽기전용 임베드 자식이 하위프로세스 호스트면 더블클릭=한 단계 더 드릴인(딥뷰). 아니면 무시(편집 불가).
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }
    const handleDblClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
      const id = nodeEl?.getAttribute("data-id");
      if (!id) {
        return; // 노드 밖 — React Flow 기본 처리
      }
      // 프레임(현재 스코프) 노드 분기: 루트(편집 가능, scopeId=null) 노드는 RF onNodeDoubleClick가
      // 모달/이름편집을 처리하므로 그대로 위임.
      const frameNode = nodesRef.current.find((node) => node.id === id);
      if (frameNode && frameNode.data?.scopeId == null) {
        return; // 루트 편집 프레임 노드 — React Flow 기본(onNodeDoubleClick) 처리
      }
      // 임베드 자식 더블클릭 봉인(깊이 무관) — 종전의 딥뷰 드릴인은 인라인 펼침과 이중 렌더(중복 key)·
      // 오프스크린 창으로 깨져 있어 진입로를 막는다. RF 더블클릭 줌/모달도 열지 않는다(읽기전용 안내는 우클릭 메뉴).
      event.preventDefault();
      event.stopPropagation();
    };
    // Ctrl+드래그 의도 판별 — mousedown 시점의 선택 집합을 RF가 바꾸기 전에 스냅샷(capture phase가 노드의
    // d3-drag pointerdown보다 먼저 발화). beginCtrlDrag이 이 스냅샷으로 잡은 노드의 사전 선택 여부를 본다.
    const handlePointerDownCapture = () => {
      preMousedownSelectedRef.current = new Set(
        nodesRef.current.filter((node) => node.selected).map((node) => node.id),
      );
    };
    container.addEventListener("dblclick", handleDblClick, true); // capture — RF zoom보다 먼저
    container.addEventListener("pointerdown", handlePointerDownCapture, true); // capture — RF 선택 변경보다 먼저
    return () => {
      container.removeEventListener("dblclick", handleDblClick, true);
      container.removeEventListener("pointerdown", handlePointerDownCapture, true);
    };
  }, []);

  // 좌측 아웃라인 — 현재 스코프는 라이브 상태, 하위 스코프는 전체 그래프에서 병합
  const outline = useMemo(() => {
    // 현재 스코프는 라이브 상태가 권위 — id로 dedup해 fullGraph가 stale일 때 중복 행 방지
    const liveIds = new Set(nodes.map((node) => node.id));
    // subprocess 노드 라벨은 링크맵 현재 이름을 라이브로 따른다(캔버스 injectSubEnds와 동일 규칙) — 저장 스냅샷은 폴백.
    const liveName = (nodeType: string, linkedMapId: number | null, fallback: string): string =>
      nodeType === "subprocess" && linkedMapId != null
        ? (subprocessRefs.get(linkedMapId)?.name ?? fallback)
        : fallback;
    const outlineNodes: OutlineNode[] = nodes.map((node) => {
      // nodes state엔 locked가 없다(주입은 displayNodes 렌더 시점 — L5037) → lockedKeys 직접 조회, canExpand와 동일 판정.
      // nodes state never carries locked (injected at displayNodes render) → look up lockedKeys directly, same as canExpand.
      const k = linkKey({
        linked_map_id: node.data.linkedMapId ?? null,
        follow_latest: node.data.followLatest ?? false,
        linked_version_id: node.data.linkedVersionId ?? null,
      });
      return {
        id: node.id,
        parentId: currentParentId,
        label: liveName(node.data.nodeType, node.data.linkedMapId ?? null, node.data.label),
        nodeType: node.data.nodeType,
        locked: k != null && lockedKeys.has(k),
      };
    });
    const outlineEdges: OutlineEdge[] = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));
    if (fullGraph) {
      const seenNodes = new Set(liveIds);
      for (const flat of fullGraph.nodes) {
        if (seenNodes.has(flat.id)) {
          continue;
        }
        // 현재 스코프 노드는 라이브가 권위 — 라이브 로드 후 fullGraph에만 있으면 삭제된 것이므로 제외(아웃라인 즉시 반영).
        // nodes 비어있는 로드/전환 구간엔 fullGraph로 폴백(깜빡임 방지).
        if (nodes.length > 0 && flat.parent_node_id === currentParentId) {
          continue;
        }
        seenNodes.add(flat.id);
        const flatKey = linkKey(flat);
        const flatType = normalizeNodeType(flat.node_type);
        outlineNodes.push({
          id: flat.id,
          parentId: flat.parent_node_id,
          label: liveName(flatType, flat.linked_map_id ?? null, flat.title),
          nodeType: flatType,
          // 임베드/심층 노드는 라이브 data가 없으므로 linkKey를 lockedKeys로 직접 조회 / embedded/deep nodes: look up linkKey in lockedKeys directly
          locked: flatKey != null && lockedKeys.has(flatKey),
        });
      }
      const seenEdges = new Set(outlineEdges.map((edge) => `${edge.source}\u0000${edge.target}`));
      for (const graphEdge of fullGraph.edges) {
        const key = `${graphEdge.source_node_id}\u0000${graphEdge.target_node_id}`;
        if (liveIds.has(graphEdge.source_node_id) || seenEdges.has(key)) {
          continue;
        }
        seenEdges.add(key);
        outlineEdges.push({
          source: graphEdge.source_node_id,
          target: graphEdge.target_node_id,
        });
      }
    }
    // 항상 프로젝트 루트(전체 트리) 기준 — 창을 옮겨도 전체 프로젝트를 일관되게 표시.
    // 활성 스코프 경로(드릴인한 노드들)는 항상 펼쳐 현재 위치가 보이도록 합성.
    const effectiveExpanded = new Set(expandedOutline);
    for (const scope of scopes) {
      const host = scopeHostId(scope);
      if (host !== null) {
        effectiveExpanded.add(host);
      }
    }
    // 캔버스에서 인라인 임베드된 하위프로세스도 아웃라인에서 펼친 것으로 표시 → 임베드된 자식이 아웃라인에 나타난다.
    for (const host of expandedInline) {
      effectiveExpanded.add(host);
    }
    return buildOutline(outlineNodes, outlineEdges, null, effectiveExpanded);
  }, [nodes, edges, fullGraph, currentParentId, expandedOutline, expandedInline, scopes, lockedKeys, subprocessRefs]);

  // 스코프 전환 중 라이브 nodes 공백 구간엔 직전 비어있지 않은 outline을 고스트로 유지(깜빡임 방지).
  // 비어있지 않을 때만 갱신 → 공백 구간엔 마지막 good 값을 그대로 렌더해 "사라졌다 뜨는" 현상 제거.
  const [displayOutline, setDisplayOutline] = useState(outline);
  useEffect(() => {
    if (outline.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 비어있지 않은 outline만 표시 캐시에 반영(고스트 유지)
      setDisplayOutline(outline);
    }
  }, [outline]);

  // 아웃라인 행이 하위프로세스(참조) 호스트인지 — 펼침이 캔버스 인라인 임베드를 트리거해야 자식이 로드된다.
  const isSubprocessRow = useCallback(
    (id: string): boolean => outline.find((r) => r.id === id)?.nodeType === "subprocess",
    [outline],
  );

  const handleToggleExpand = useCallback(
    (id: string) => {
      // 하위프로세스 행 펼침/접힘은 캔버스 버튼과 동일하게 inline-embed 토글(자식 로드) — outline-local 토글 아님.
      if (isSubprocessRow(id)) {
        if (scopes.some((s) => scopeHostId(s) === id)) {
          collapseSubprocessRow(id); // 드릴인된 host 토글 = 접기(스코프 pop, 가드)
        } else {
          toggleInlineExpandRef.current?.(id);
        }
        return;
      }
      setExpandedOutline((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [isSubprocessRow, scopes, collapseSubprocessRow],
  );

  // 포커스 비행(setCenter/fitView) 도중의 getZoom()은 d3 interpolateZoom의 일시 축소값 — 연속 이동 시
  // 그 값을 다음 목표 줌으로 캡처하면 이동을 반복할수록 줌아웃이 눌러앉는다. 비행 시작 시점의 안정
  // 줌을 앵커로 기억해 비행 중 재이동도 같은 앵커로 향하게 한다(연속 이동에도 줌 확장은 일시적).
  const focusFlightRef = useRef<{ zoom: number; until: number } | null>(null);
  const getFocusAnchorZoom = useCallback(
    (duration: number): number => {
      const now = performance.now();
      const flight = focusFlightRef.current;
      const zoom = flight !== null && now < flight.until ? flight.zoom : reactFlow.getZoom();
      focusFlightRef.current = { zoom, until: now + duration + 150 };
      return zoom;
    },
    [reactFlow],
  );

  // 노드가 화면 밖일 때만 현재 줌 유지한 채 부드럽게 가운데로 — 이미 보이면 이동 없음(매 클릭 점프/줌변경 방지).
  const revealNodeIfOffscreen = useCallback(
    (id: string) => {
      const node = reactFlow.getNode(id);
      if (!node) {
        return;
      }
      const zoom = reactFlow.getZoom();
      const vpt = reactFlow.getViewport();
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      const sx = node.position.x * zoom + vpt.x;
      const sy = node.position.y * zoom + vpt.y;
      const margin = 48; // 화면 가장자리 여유 — 이 안이면 "보임"으로 간주
      const visible =
        sx >= margin &&
        sy >= margin &&
        sx + w * zoom <= paneWidth - margin &&
        sy + h * zoom <= paneHeight - margin;
      if (!visible) {
        void reactFlow.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: getFocusAnchorZoom(500), // 비행 중 재이동은 앵커 줌 — 일시 축소값 목표화 방지
          duration: 500,
        });
      }
    },
    [reactFlow, paneWidth, paneHeight, getFocusAnchorZoom],
  );

  // 라이브러리/트리 피커에서 "이미 이 맵에 있는" 행을 눌렀을 때 — 그 링크맵을 쓰는 노드를 선택+화면에 노출.
  // 추가가 불가능한 행이라 미리보기는 의미가 없고, 어디 있는지 찾아주는 게 실제로 원하는 동작이다
  // (사용자 요청 2026-08-31). 같은 링크맵 노드가 여럿이면 첫 노드로 — 링크 유일성 규칙상 통상 1개.
  const focusLinkedNode = useCallback(
    (linkedMapId: number) => {
      const target = nodesRef.current.find((node) => node.data?.linkedMapId === linkedMapId);
      if (!target) return;
      setSelectedId(target.id);
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === target.id })));
      revealNodeIfOffscreen(target.id);
    },
    [setNodes, revealNodeIfOffscreen],
  );

  // fit 버튼 — 현재 스코프를 화면에 맞추되 가운데가 아니라 좌상단 정렬(왼쪽위 고정). 줌은 맞추되 콘텐츠는 좌상단에.
  const fitScopeTopLeft = useCallback(() => {
    const idSet = new Set(nodesRef.current.map((node) => node.id));
    const ns = reactFlow.getNodes().filter((node) => idSet.has(node.id));
    if (ns.length === 0) {
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of ns) {
      const w = node.measured?.width ?? NODE_WIDTH;
      const h = node.measured?.height ?? NODE_HEIGHT;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }
    const pad = 80;
    const zx = (paneWidth - pad * 2) / Math.max(1, maxX - minX);
    const zy = (paneHeight - pad * 2) / Math.max(1, maxY - minY);
    const z = Math.max(MIN_ZOOM, Math.min(zx, zy, 1.2));
    void reactFlow.setViewport(
      { x: (EXTENT_TOPLEFT_MARGIN - minX) * z, y: (EXTENT_TOPLEFT_MARGIN - minY) * z, zoom: z },
      { duration: 400 },
    );
  }, [reactFlow, paneWidth, paneHeight]);

  // 아웃라인 클릭 — 노드가 속한 스코프로 이동 후, 화면 밖일 때만 현재 줌으로 부드럽게 포커싱
  const handleOutlineSelect = useCallback(
    (id: string) => {
      const flatById = new Map((fullGraph?.nodes ?? []).map((node) => [node.id, node]));
      const flat = flatById.get(id);
      const scopeParentId = flat ? flat.parent_node_id : currentParentId;
      if (scopeParentId === currentParentId) {
        setSelectedId(id);
        setSelectedEdgeId(null);
        // 캔버스 클릭과 달리 프로그램적 선택은 React Flow 선택 상태를 안 건드려 보더가 안 켜짐 — 직접 단일 선택 동기화
        setNodes((current) =>
          current.map((node) =>
            node.selected === (node.id === id) ? node : { ...node, selected: node.id === id },
          ),
        );
        // 이전에 임베드 자식이 선택돼 있었을 수 있음 — 자식 선택도 해제(단일 선택 유지)
        setChildNodes((current) =>
          current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        );
        // 화면에 이미 보이면 이동 없음, 밖일 때만 현재 줌으로 부드럽게 가운데(줌 강제 변경 제거 — 매 클릭 점프 방지)
        revealNodeIfOffscreen(id);
        return;
      }
      // 다른 스코프(하위) — 드릴인 창 대신 조상 체인을 인라인 펼쳐 해당 노드를 레인에 노출하고 포커싱.
      const chainIds: string[] = [];
      let cursor = scopeParentId;
      while (cursor !== null) {
        chainIds.unshift(cursor);
        cursor = flatById.get(cursor)?.parent_node_id ?? null;
      }
      commitExpanded((prev) => {
        const next = new Set(prev);
        for (const ancestorId of chainIds) {
          next.add(ancestorId); // 루트~부모까지 모두 펼쳐 중첩 레인으로 대상 노드 표시
        }
        return next;
      });
      setSelectedId(id);
      // 합성·재배치가 반영된 다음 틱에 대상 노드로 팬 — 줌은 현재 값 유지(자동 줌 변경 방지)
      window.setTimeout(() => {
        // 임베드 자식 선택 효과 동기화(캔버스 클릭과 통일) — childNodes는 펼침 반영 다음 틱에 존재.
        setNodes((current) =>
          current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        );
        setChildNodes((current) =>
          current.map((node) =>
            node.selected === (node.id === id) ? node : { ...node, selected: node.id === id },
          ),
        );
        const zoom = getFocusAnchorZoom(500); // 비행 중 재이동은 앵커 줌 — 연속 이동 줌아웃 눌러앉음 방지
        void reactFlow.fitView({
          nodes: [{ id }],
          padding: 0.4,
          minZoom: zoom,
          maxZoom: zoom,
          duration: 500,
        });
      }, 160);
    },
    [fullGraph, currentParentId, reactFlow, setNodes, setChildNodes, commitExpanded, revealNodeIfOffscreen, getFocusAnchorZoom],
  );

  // 아웃라인 Tab/↓ — 다음(아래) 가시 행으로 이동. 펼치기는 자동으로 하지 않는다(→/F가 담당).
  const handleOutlineNext = useCallback(
    (id: string) => {
      const idx = outline.findIndex((row) => row.id === id);
      if (idx === -1) {
        return;
      }
      const next = outline[idx + 1];
      if (next) {
        handleOutlineSelect(next.id);
      }
    },
    [outline, handleOutlineSelect],
  );

  // Shift+Tab/↑ — 아웃라인의 이전(위) 가시 행으로 이동. 첫 자식에선 idx-1이 곧 부모라 자연히 위로 올라간다.
  const handleOutlinePrev = useCallback(
    (id: string) => {
      const idx = outline.findIndex((row) => row.id === id);
      if (idx <= 0) {
        return;
      }
      handleOutlineSelect(outline[idx - 1].id);
    },
    [outline, handleOutlineSelect],
  );

  // 맵 드롭다운의 사용중 행 클릭 → 해당 subprocess 노드 선택+포커싱 (spec 2026-07-19)
  const focusLinkedMap = useCallback(
    (linkedMapId: number) => {
      const target = nodesRef.current.find(
        (node) => node.data.nodeType === "subprocess" && node.data.linkedMapId === linkedMapId,
      );
      if (target) handleOutlineSelect(target.id);
    },
    [handleOutlineSelect],
  );

  // → 펼치기 — 자식 있고 접혀있을 때만(이동 없음). 하위프로세스는 inline-embed 토글로 자식 로드.
  const handleOutlineExpand = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (!row?.hasChildren || row.expanded) {
        return;
      }
      if (isSubprocessRow(id)) {
        toggleInlineExpandRef.current?.(id);
        return;
      }
      setExpandedOutline((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    },
    [outline, isSubprocessRow],
  );

  // 현재 노드의 부모를 접으며 그 부모로 이동 — F(말단)·←(닫을 게 없을 때) 공통.
  const foldToParent = useCallback(
    (id: string) => {
      const parentId =
        (fullGraph?.nodes ?? []).find((node) => node.id === id)?.parent_node_id ?? null;
      if (parentId === null) {
        return;
      }
      setExpandedOutline((prev) => {
        if (!prev.has(parentId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      handleOutlineSelect(parentId);
    },
    [fullGraph, handleOutlineSelect],
  );

  // ← — 펼쳐진 하위프로세스는 닫고, 닫을 게 없으면(말단·이미 접힘) 부모를 접으며 부모로 이동.
  const handleOutlineCollapse = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (row?.hasChildren && row.expanded) {
        if (isSubprocessRow(id)) {
          collapseSubprocessRow(id); // 드릴인/인라인 모드 인지 접기
          return;
        }
        setExpandedOutline((prev) => {
          if (!prev.has(id)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      foldToParent(id);
    },
    [outline, foldToParent, isSubprocessRow, collapseSubprocessRow],
  );

  // F 토글 — 자식 있으면 펼치기↔접기 토글, 말단이면 부모를 접으며 부모로 이동.
  const handleOutlineFold = useCallback(
    (id: string) => {
      const row = outline.find((r) => r.id === id);
      if (row?.hasChildren) {
        if (isSubprocessRow(id)) {
          if (scopes.some((s) => scopeHostId(s) === id)) {
            collapseSubprocessRow(id); // 드릴인된 host = 접기(스코프 pop, 가드)
          } else {
            toggleInlineExpandRef.current?.(id);
          }
          return;
        }
        setExpandedOutline((prev) => {
          const next = new Set(prev);
          if (row.expanded) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        return;
      }
      foldToParent(id);
    },
    [outline, foldToParent, isSubprocessRow, scopes, collapseSubprocessRow],
  );

  // 전역 단축키(조합키) — 메뉴 없이도 동작. 단일 키(1-4·E·정렬 L/C/T/M/H/V)는 우클릭 메뉴 가속기(ContextMenu) 담당.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // 입력/편집 중이면 무시 (검색·라벨·AI·아웃라인 rename 등) — onFlowKey와 동일 가드(contentEditable·아웃라인 포함).
      if (
        event.target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
          event.target.isContentEditable ||
          event.target.closest("[data-editor-outline]") !== null)
      ) {
        return;
      }
      // 모달 열림 중엔 무시
      if (
        summaryNodeId ||
        bulkEditGroupId ||
        branchPrompt ||
        decisionDrop ||
        managingApprovers ||
        pending
      ) {
        return;
      }
      const count = nodesRef.current.filter((node) => node.selected).length;
      const fire = (action: () => void) => {
        event.preventDefault();
        setMenu(null); // 메뉴가 떠 있으면 닫고 실행
        action();
      };

      // 모든 판정은 물리 키(event.code) — 한글 IME·키 레이아웃·OS(Mac Option) 무관
      // Shift+L — 전역 가로 자동 정렬(L=Layout) · Shift+K — 전역 세로 자동 정렬(L 인접 키).
      if (
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.code === "KeyL" || event.code === "KeyK")
      ) {
        const dir: FlowDir = event.code === "KeyL" ? "LR" : "TB";
        fire(() => applyAutoLayout(dir));
        return;
      }
      // S — 전역 서브프로세스 라이브러리 패널 열기. 컨텍스트 메뉴가 떠 있으면 무시
      // (정렬 서브메뉴의 accel 's'=세로 자동정렬과 충돌 방지). Shift+S는 제외(다른 조합과 충돌 방지 여지).
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyS" &&
        !menu
      ) {
        fire(() =>
          isWordMap
            ? setSectionsOpen(true)
            : isFrameworkMap
              ? setFrameworkPickerOpen(true)
              : setLibraryOpen(true),
        );
        return;
      }
      // Ctrl 조합 — 그룹 생성 / PNG 내보내기 / 노드 복사·붙여넣기 (undo/redo·검색은 별도 핸들러)
      if (event.ctrlKey || event.metaKey) {
        if (event.code === "KeyG" && !event.shiftKey) {
          fire(() => createGroupFromSelection());
        } else if (event.code === "KeyE" && event.shiftKey) {
          fire(() => void handleExportPng());
        } else if (event.code === "KeyC" && !event.shiftKey) {
          // 선택 노드가 없거나 **텍스트를 드래그 선택 중**이면 브라우저 기본 복사로 흘려보낸다 —
          // 노드가 선택된 채 AI 챗 본문을 선택 복사하면 노드 복사가 가로채 토스트만 뜨고
          // 클립보드는 그대로이던 문제 (실서버 핫픽스 2026-07-30)
          const hasSelectedNode = nodesRef.current.filter((node) => node.selected).length > 0;
          const selection = window.getSelection();
          const hasTextSelection = selection !== null && !selection.isCollapsed;
          if (!hasSelectedNode || hasTextSelection) {
            return;
          }
          fire(() => handleCopy());
        } else if (event.code === "KeyV" && !event.shiftKey) {
          fire(() => handlePaste());
        }
        return;
      }

      // Alt 조합 — 전역 정렬/분배 (왼손 전용 키: 좌=W, 가로가운데=C, 상단=T, 세로가운데=X, 가로분배=R, 세로분배=V)
      if (event.altKey) {
        // Alt+←/→ — 좌측 사이드바 / 우측 인스펙터 접기·펼치기 (batch2 ⑮)
        if (event.code === "ArrowLeft") {
          fire(() => setLeftCollapsed((v) => !v));
          return;
        }
        if (event.code === "ArrowRight") {
          // CSV 프리뷰 중에는 인스펙터를 못 접는다 — Apply/Cancel이 갇힌다
          if (previewSource !== "csv") fire(() => setInspectorOpen((v) => !v));
          return;
        }
        const alignByCode: Record<string, "left" | "centerX" | "top" | "centerY"> = {
          KeyW: "left",
          KeyC: "centerX",
          KeyT: "top",
          KeyX: "centerY",
        };
        const axis = alignByCode[event.code];
        if (axis) {
          if (count >= 2) {
            fire(() => applyNodesTransform((current) => alignSelected(current, axis)));
          }
          return;
        }
        if (event.code === "KeyR" || event.code === "KeyV") {
          if (count >= 3) {
            fire(() =>
              applyNodesTransform((current) => distributeSelected(current, event.code === "KeyR" ? "x" : "y")),
            );
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    summaryNodeId,
    bulkEditGroupId,
    branchPrompt,
    decisionDrop,
    managingApprovers,
    pending,
    previewSource,
    menu,
    selectedId,
    applyNodesTransform,
    applyAutoLayout,
    createGroupFromSelection,
    handleExportPng,
    handleCopy,
    handlePaste,
    isWordMap,
    isFrameworkMap,
  ]);

  // 포인터 화면 좌표 추적 — 엣지 액션/분기 모달을 마우스 위치에 띄우기 위함.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointerScreenRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // 출력 1개 충돌 모달 선택 — 삽입(흐름에 끼움) / 교체(기존 대체). source의 기존 출력 기준.
  const applyEdgeAction = useCallback(
    (action: "insert" | "replace") => {
      if (edgeAction === null) {
        return;
      }
      const { source, target } = edgeAction;
      setEdgeAction(null);
      if (!target) {
        return;
      }
      pushHistory();
      const isSub = (nodeId: string): boolean =>
        nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType === "subprocess";
      setEdges((current) => {
        // insert: source→target + source의 기존 출력을 target 뒤로 재연결(흐름 삽입).
        // replace: source의 기존 출력 제거 후 source→target만.
        const base = action === "replace" ? removeOutgoingEdges(current, source) : current;
        const next = insertNodeAfter(base, target, source, action === "insert");
        return next.map((edge) => withSubprocessHandles(edge, isSub));
      });
      scheduleAutoSave();
    },
    [edgeAction, pushHistory, setEdges, scheduleAutoSave],
  );

  // 선택한 출력선(source→X)에 끼워넣기: source→target→X (해당 선만, 라벨 보존, 다른 분기 유지).
  const interceptIntoEdge = useCallback(
    (source: string, target: string, edgeId: string) => {
      pushHistory();
      const isSub = (nodeId: string): boolean =>
        nodesRef.current.find((node) => node.id === nodeId)?.data.nodeType === "subprocess";
      setEdges((current) => {
        const picked = current.find((edge) => edge.id === edgeId);
        if (!picked) {
          return current;
        }
        const x = picked.target;
        const pickedLabel = picked.label;
        let next = current.filter((edge) => edge.id !== edgeId); // source→X 제거
        next = insertNodeAfter(next, target, source, false); // source→target
        next = insertNodeAfter(next, x, target, false); // target→X
        // 분기 라벨은 source→target(첫 구간)에 보존
        next = next.map((edge) =>
          edge.source === source && edge.target === target ? { ...edge, label: pickedLabel } : edge,
        );
        return next.map((edge) => withSubprocessHandles(edge, isSub));
      });
      scheduleAutoSave();
    },
    [pushHistory, setEdges, scheduleAutoSave],
  );

  // 다중 출력 노드 삽입 — 선택 모달에서 고른 출력선에 끼워넣기.
  const applyEdgeSelect = useCallback(
    (edgeId: string) => {
      if (edgeSelect === null) {
        return;
      }
      const { source, target } = edgeSelect;
      setEdgeSelect(null);
      interceptIntoEdge(source, target, edgeId);
    },
    [edgeSelect, interceptIntoEdge],
  );

  // decision↔일반 스왑 — 선택 모달에서 고른 출력선을 일반 노드가 가져가며 스왑 일괄 적용.
  const applySwapSelect = useCallback(
    (edgeId: string) => {
      if (swapSelect === null) {
        return;
      }
      const { aId, bId, aStart } = swapSelect;
      setSwapSelect(null);
      swapNodes(aId, bId, edgeId, aStart);
    },
    [swapSelect, swapNodes],
  );

  // 디시전 드롭 모달: 인터셉트 — 출력선 ≥2면 선택 모달, 1개면 그 선에 바로 끼움 (F1).
  const applyDecisionIntercept = useCallback(() => {
    if (decisionDrop === null) {
      return;
    }
    const { aId, bId, options, at } = decisionDrop;
    setDecisionDrop(null);
    if (options.length >= 2) {
      setEdgeSelect({ source: bId, target: aId, options, at });
      return;
    }
    if (options.length === 1) {
      interceptIntoEdge(bId, aId, options[0].edgeId);
    }
  }, [decisionDrop, interceptIntoEdge]);

  // 디시전 드롭 모달: 분기 — B→A 새 출력선 추가(자동 yes/no/기타 라벨 모달) (F1).
  const applyDecisionBranch = useCallback(() => {
    if (decisionDrop === null) {
      return;
    }
    const { aId, bId } = decisionDrop;
    setDecisionDrop(null);
    applyFlowEdges(aId, bId, "back", false);
  }, [decisionDrop, applyFlowEdges]);

  // F14 — 노드 선택 후 ]=하이라이트 경로 전방 확장 / [=축소→초기→후방 확장(뷰 고정).
  // Tab/Shift+Tab=흐름상 다음/이전 노드로 포커스 이동(+중앙). 입력/아웃라인 포커스 중엔 제외(아웃라인 Tab 보존).
  useEffect(() => {
    const onFlowKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable ||
          target.closest("[data-editor-outline]") !== null)
      ) {
        return; // 입력/아웃라인 포커스 중엔 기본 동작(아웃라인 Tab 보존)
      }
      // F2 — 노드/엣지 이름·라벨 편집 진입 + 열린 컨텍스트 메뉴 닫기. selectedId 가드보다 위(엣지도 처리).
      if (event.key === "F2") {
        if (selectedId) {
          event.preventDefault();
          setMenu(null);
          startRename(selectedId); // readOnly는 startRename 내부에서 가드
        } else if (selectedEdgeId && !readOnly) {
          event.preventDefault();
          setMenu(null);
          startEdgeLabelEdit(selectedEdgeId);
        }
        return;
      }
      if (!selectedId) {
        return;
      }
      // [ ] : 흐름 하이라이트 경로 증감 (뷰 고정). anchor≠선택이면 0에서 시작(파생 리셋).
      if (event.key === "]" || event.key === "[") {
        event.preventDefault();
        const delta = event.key === "]" ? 1 : -1;
        const edges = edgesRef.current;
        // reach 값에 해당하는 하이라이트 노드 수 — 4225~4231의 hop 산정과 동일하게.
        const reachCount = (r: number): number => {
          const fwd = r >= 0 ? r + 1 : 1;
          const bwd = r < 0 ? -r : 0;
          return new Set([
            ...getFlowPathForward(edges, selectedId, fwd),
            ...getFlowPathBackward(edges, selectedId, bwd),
          ]).size;
        };
        setFlow((prev) => {
          const base = prev.anchor === selectedId ? prev.reach : 0;
          const next = base + delta;
          // 실제 끝/처음에 도달하면 더 증가/감소하지 않음 (F14) — 노드 수가 안 변하면 클램프.
          if (reachCount(next) === reachCount(base)) {
            return prev.anchor === selectedId ? prev : { anchor: selectedId, reach: 0 };
          }
          return { anchor: selectedId, reach: next };
        });
        return;
      }
      // Tab / Shift+Tab : 흐름상 다음/이전 노드로 포커스 이동(+화면 중앙으로).
      // 임베드 자식 엣지도 포함 — 펼친 하위프로세스 안 노드를 클릭한 뒤에도 아웃라인과 동일하게 순회된다.
      if (event.key === "Tab") {
        const flowEdges = [
          ...edgesRef.current,
          ...(inlineCompositionRef.current?.childEdges ?? []),
        ];
        const nextId = event.shiftKey
          ? getPrevNodeAlongFlow(flowEdges, selectedId)
          : getNextNodeAlongFlow(flowEdges, selectedId);
        if (!nextId) {
          return;
        }
        event.preventDefault();
        setSelectedId(nextId);
        // 다음 노드가 임베드 자식이면 childNodes에 선택을 싣는다 — 반대편 state는 전부 해제(단일 선택).
        const isChild = childNodesRef.current.some((node) => node.id === nextId);
        setNodes((current) =>
          current.map((node) => ({ ...node, selected: !isChild && node.id === nextId })),
        );
        setChildNodes((current) =>
          current.map((node) =>
            node.selected === (isChild && node.id === nextId)
              ? node
              : { ...node, selected: isChild && node.id === nextId },
          ),
        );
        const node = reactFlow.getNode(nextId);
        if (node) {
          const w = node.measured?.width ?? NODE_WIDTH;
          const h = node.measured?.height ?? NODE_HEIGHT;
          void reactFlow.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
            duration: 350,
            zoom: getFocusAnchorZoom(350), // 연속 Tab에도 줌아웃이 눌러앉지 않게 앵커 줌으로
          });
        }
      }
    };
    window.addEventListener("keydown", onFlowKey);
    return () => window.removeEventListener("keydown", onFlowKey);
  }, [
    selectedId,
    selectedEdgeId,
    readOnly,
    reactFlow,
    setNodes,
    setChildNodes,
    setSelectedId,
    setMenu,
    startRename,
    startEdgeLabelEdit,
    getFocusAnchorZoom,
  ]);

  // 인스펙터 좌측 가장자리 드래그로 폭 조절 (왼쪽으로 끌면 넓어짐)
  const startInspectorResize = useCallback(
    (event: { clientX: number; preventDefault: () => void }) => {
      event.preventDefault();
      const startX = event.clientX;
      const startW = inspectorWidth;
      let lastW = startW;
      const onMove = (ev: PointerEvent) => {
        lastW = Math.min(520, Math.max(300, startW + (startX - ev.clientX)));
        setInspectorWidth(lastW);
      };
      const onUp = () => {
        // 영속은 드래그 종료 1회 — 상태-의존 effect 영속은 StrictMode 마운트가 저장값을 기본값으로 덮어씀
        window.localStorage.setItem("bpm.inspectorWidth", String(lastW));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [inspectorWidth],
  );

  // 상단바 ghost 아이콘 버튼 — 보더 없이 hover 배경만(목업 토브바 톤). 클릭 눌림은 globals.css base.
  const topIconBtn =
    "inline-flex items-center justify-center rounded-sm p-1.5 text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  // importSlot 렌더 조건과 forcedTab/lockTabs 잠금 조건은 반드시 동일해야 한다 —
  // 어긋나면 Import 탭 없이 인스펙터가 잠기고(autosave도 중단) 빠져나올 방법이 없어진다.
  const csvPreviewActive = previewSource === "csv" && csvOutcome !== null;

  return (
    <NodeActionsContext.Provider value={nodeActions}>
      {/* 인라인 펼침/접힘 슬라이드 — 런타임 클래스(.react-flow__node) 대상 규칙은 Turbopack(dev)이 purge하므로
          globals.css 대신 raw <style>로 주입해 dev·prod 모두 적용되게 한다(ease-in-out = 느림→빠름→느림). */}
      <style>{`.bpm-expand-anim .react-flow__node{transition:transform 350ms cubic-bezier(0.65,0,0.35,1)}@media(prefers-reduced-motion:reduce){.bpm-expand-anim .react-flow__node{transition:none}}@keyframes bpm-node-flash{0%{opacity:1}45%{opacity:.25}100%{opacity:1}}.react-flow__node.bpm-node-flash{animation:bpm-node-flash 450ms ease-in-out}@media(prefers-reduced-motion:reduce){.react-flow__node.bpm-node-flash{animation:none}}.react-flow__handle{width:11px;height:11px;border-radius:3px;background:color-mix(in srgb,var(--color-ink-tertiary) 20%,transparent);border:1px solid color-mix(in srgb,var(--color-ink-tertiary) 50%,transparent);opacity:0;transition:opacity 120ms var(--ease-smooth),background 120ms var(--ease-smooth),border-color 120ms var(--ease-smooth)}.react-flow__node:hover .react-flow__handle{opacity:1}.react-flow__handle:hover{opacity:1;background:color-mix(in srgb,var(--color-ink-tertiary) 42%,transparent);border-color:var(--color-ink-secondary)}.react-flow__node:hover .bpm-node-emph{box-shadow:0 0 0 3px color-mix(in srgb,var(--nc) 42%,transparent)}.react-flow__node.bpm-node-ctrl-copy{opacity:.5;outline:1.5px dashed var(--color-divider);outline-offset:-1.5px}.react-flow__node.io-node-highlight{outline:2px solid var(--color-accent);outline-offset:3px;border-radius:8px}`}</style>
      <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        {/* 좌: 사이드바 토글 · 맵네임 드롭다운(검색·최근 맵·새 맵) · 브레드크럼 구분자 · 버전 pill */}
        <button
          type="button"
          className={topIconBtn}
          onClick={() => setLeftCollapsed((v) => !v)}
          title={leftCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={leftCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
        <MapNameDropdown
          mapId={mapId}
          mapName={mapName}
          canToRoot={scopes.length > 1}
          isEditing={!readOnly}
          onToRoot={() => void navigateTo(scopes.slice(0, 1))}
          linkedMapIds={linkedMapIds}
          onAddLinkNode={(linkedMapId, name) => void addLinkNodeFromMap(linkedMapId, name)}
          onFocusLinkedMap={focusLinkedMap}
        />
        <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        <VersionPill
          versions={versions}
          versionId={versionId}
          isEditing={!readOnly}
          onSwitch={(id) => void switchVersion(id)}
        />

        {isViewer && (
          <span
            data-id="editor-readonly-badge"
            className="inline-flex items-center gap-1.5 rounded-sm bg-surface-alt px-2 py-1 text-fine font-semibold text-ink-secondary"
          >
            <Lock size={13} strokeWidth={1.7} />
            {t("editor.viewOnly")}
          </span>
        )}

        {/* 노드 검색은 좌측 사이드바 아웃라인 위로 이동(R4b) — searchSlot으로 주입 */}

        {/* 우: 상태 인디케이터 · undo/redo · 라이브러리 · AI · 저장 · 인스펙터 토글.
            (공유·전체화면은 백엔드/동작 부재로 보류 — R3) */}
        <div className="ml-auto flex items-center gap-1.5">
          {readOnly && !isViewer && checkout?.checked_out_by && (
            <span className="flex items-center gap-2 rounded-sm bg-changed/10 px-2 py-1 text-caption text-changed">
              <PencilLine size={14} strokeWidth={1.5} />{t("editor.editingByOther", { name: checkoutHolderLabel || checkout.checked_out_by })}
              {/* 활성 점유 강제 인수는 sysadmin만 — 에디터/오너는 읽기전용 안내만 본다 */}
              {isSysadmin && (
                <button
                  className="rounded-sm bg-error px-1.5 py-0.5 text-fine text-on-accent hover:bg-error/90"
                  onClick={() => void handleForceCheckout()}
                >
                  {t("editor.forceEdit")}
                </button>
              )}
            </span>
          )}
          {currentVersion?.status === "rejected" && currentVersion.reject_reason && (
            <span
              data-id="wf-rejected-banner"
              className="flex max-w-96 items-center gap-1.5 rounded-sm border border-error/40 bg-error/10 px-2 py-1 text-caption text-error"
              title={currentVersion.reject_reason}
            >
              <XCircle size={16} strokeWidth={1.5} className="shrink-0" />
              <span className="text-caption-strong">{t("wf.rejectedLabel")}</span>
              {workflow?.rejected_by && workflow.version_id === currentVersion.id && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-error/40 bg-surface px-1.5 py-0.5 text-fine">
                  <User size={12} strokeWidth={1.5} />
                  {nameById.get(workflow.rejected_by) ?? workflow.rejected_by}
                </span>
              )}
              <span className="truncate">{currentVersion.reject_reason}</span>
            </span>
          )}
          {!isViewer && checkout?.mine && (
            <span className="inline-flex items-center gap-1 text-fine text-ink-tertiary" title={t("editor.editingMineTitle")}>
              <Lock size={14} strokeWidth={1.5} />{t("editor.editingMine")}
            </span>
          )}
          {status && <span className="text-caption text-error">{status}</span>}
          {/* 저장 상태 — 필 형식(색상 유지). 실패 상세는 상단 배너로 노출 */}
          {saveState === "saving" && (
            <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-fine text-ink-tertiary">
              {t("editor.saving")}
            </span>
          )}
          {saveState === "saved" && (
            <span
              data-id="editor-save-pill-saved"
              className="inline-flex items-center gap-1 rounded-full border border-added/40 bg-added/10 px-2 py-0.5 text-fine text-added"
            >
              <Check size={12} strokeWidth={1.7} />
              {t("editor.saved")}
            </span>
          )}
          {saveState === "error" && (
            <span
              data-id="editor-save-pill-error"
              className="inline-flex items-center gap-1 rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-fine text-error"
            >
              <AlertTriangle size={12} strokeWidth={1.7} />
              {t("editor.saveFailedPill")}
            </span>
          )}
          {managingApprovers && (
            <ApproverManager
              mapId={mapId}
              visibility={mapVisibility}
              onClose={() => setManagingApprovers(false)}
              onSaved={() => void refreshWorkflow()}
            />
          )}
          <button
            className={topIconBtn}
            onClick={undo}
            disabled={readOnly || historySize.past === 0}
            title={t("editor.undoTitle")}
          >
            <Undo2 size={16} strokeWidth={1.5} />
          </button>
          <button
            className={topIconBtn}
            onClick={redo}
            disabled={readOnly || historySize.future === 0}
            title={t("editor.redoTitle")}
          >
            <Redo2 size={16} strokeWidth={1.5} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-divider" />
          <button
            className={topIconBtn}
            onClick={() => (isWordMap ? setSectionsOpen((open) => !open) : isFrameworkMap ? setFrameworkPickerOpen((open) => !open) : setLibraryOpen((open) => !open))}
            title={t("library.toggle")}
            aria-label={t("library.toggle")}
          >
            <Network size={16} strokeWidth={1.5} />
          </button>
          {/* AI 메뉴 — 챗·컨설턴트 진입 통합. 컨설턴트는 편집 불가 시 비활성+사유 툴팁 (2026-07-30) */}
          {(() => {
            // 온보딩 노출 — 시드 상태(Start/End 2노드 이하)의 편집 가능한 맵 + 미확인 사용자
            const pristine =
              !readOnly && nodes.length > 0 && nodes.length <= 2 &&
              nodes.every((n) => n.data.nodeType === "start" || n.data.nodeType === "end") &&
              edges.length <= 1;
            const showOnboard = pristine && !consultOnboardSeen && !aiMenuOpen;
            const consultDisabledReason = !readOnly
              ? null
              : isViewer
                ? "View-only access - consulting needs edit permission"
                : checkout?.checked_out_by
                  ? "Another user is editing this draft"
                  : "This version isn't an editable draft";
            return (
              <div className="relative" ref={aiMenuRef}>
                <button
                  type="button"
                  className={
                    "inline-flex items-center gap-1 rounded-sm px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt" +
                    (aiMenuOpen ? " bg-surface-alt text-ink" : "") +
                    (showOnboard ? " ring-2 ring-accent/60" : "")
                  }
                  onClick={() => setAiMenuOpen((open) => !open)}
                  title={t("ai.toggle")}
                  data-id="ai-menu"
                >
                  <Sparkles size={16} strokeWidth={1.5} />
                  AI
                </button>
                {aiMenuOpen ? (
                  <div
                    className="absolute right-0 top-full z-[1100] mt-1 w-56 rounded-md border border-hairline bg-surface p-1 shadow-lg"
                    data-id="ai-menu-pop"
                  >
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                      onClick={() => {
                        setAiMenuOpen(false);
                        // 열 때 dock에 최소화돼 있던 상태면 창으로 복원
                        if (!aiOpen) {
                          setWindowGeom((map) => {
                            const g = map[AI_WINDOW_KEY];
                            return g?.minimized
                              ? { ...map, [AI_WINDOW_KEY]: { ...g, minimized: false } }
                              : map;
                          });
                        }
                        setAiOpen((open) => !open);
                      }}
                      data-id="ai-menu-chat"
                    >
                      <Sparkles size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                      <span className="flex-1 text-left">AI Chat</span>
                    </button>
                    {/* disabled 버튼은 마우스 이벤트가 죽어 래퍼에 title — 비활성 사유 툴팁 */}
                    <div title={consultDisabledReason ?? undefined}>
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        disabled={consultDisabledReason !== null}
                        onClick={() => {
                          setAiMenuOpen(false);
                          // 어떤 경로로든 컨설턴트 진입 = 온보딩 목적 달성 — 말풍선 재노출 방지
                          dismissConsultOnboard();
                          router.push(`/maps/${mapId}/consult?version=${versionId}`);
                        }}
                        data-id="open-consultant"
                      >
                        <Headset size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
                        <span className="flex-1 text-left">AI Consultant</span>
                      </button>
                    </div>
                  </div>
                ) : null}
                {showOnboard ? (
                  // z-[1100]: RF 선택 노드(1000)·연결선(1001)이 z-40을 덮는다 — 플로팅 크롬 층으로
                  <div
                    className="absolute right-0 top-full z-[1100] mt-2 w-64 rounded-md border border-hairline bg-surface p-3 shadow-lg"
                    data-id="consult-onboard"
                  >
                    <div className="text-caption-strong text-ink">Try the AI consultant</div>
                    <p className="mt-1 text-fine text-ink-secondary">
                      Answer a few questions and this empty map draws itself - attach a document
                      to go even faster.
                    </p>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <button
                        className="rounded-sm px-2 py-1 text-fine text-ink-muted hover:bg-surface-alt"
                        onClick={dismissConsultOnboard}
                        data-id="consult-onboard-dismiss"
                      >
                        Dismiss
                      </button>
                      <button
                        className="rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent"
                        onClick={() => {
                          dismissConsultOnboard();
                          router.push(`/maps/${mapId}/consult?version=${versionId}`);
                        }}
                        data-id="consult-onboard-start"
                      >
                        Start
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })()}
          <button
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void handleSave()}
            disabled={readOnly}
          >
            {readOnly && <Lock size={14} strokeWidth={1.7} />}
            {t("editor.save")}
          </button>
          <span className="mx-0.5 h-5 w-px bg-divider" />
          <button
            className={topIconBtn}
            // CSV 프리뷰 중에는 인스펙터를 못 접는다 — Apply/Cancel이 갇힌다
            onClick={() => {
              if (previewSource !== "csv") setInspectorOpen((open) => !open);
            }}
            title={t("editor.inspectorToggle")}
            aria-label={t("editor.inspectorToggle")}
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/* 저장 실패 배너 — 상세 사유 노출, 다음 저장 성공까지 유지 */}
      {saveErrorDetail && (
        <div
          data-id="editor-save-error-banner"
          className="flex items-center gap-2 border-b border-error/40 bg-error/10 px-4 py-1.5 text-caption text-error"
        >
          <AlertTriangle size={14} strokeWidth={1.7} className="shrink-0" />
          <span className="shrink-0 font-semibold">{t("editor.saveFailedPill")}</span>
          <span className="min-w-0">
            {saveErrorDetail} - {t("editor.saveRetryHint")}
          </span>
        </div>
      )}

      {/* 읽기 전용 배너 — 사유별 톤·아이콘·굵은 타이틀로 즉시 구분(타인 점유는 이름 표기) */}
      {readOnlyNotice && (
        <div
          data-id="editor-readonly-notice"
          className={`flex items-center gap-2 border-b px-4 py-1.5 text-caption ${NOTICE_TONE_CLASS[readOnlyNotice.tone]}`}
        >
          <readOnlyNotice.icon size={14} strokeWidth={1.7} className="shrink-0" />
          <span className="shrink-0 font-semibold">{readOnlyNotice.title}</span>
          <span className="min-w-0">{readOnlyNotice.desc}</span>
        </div>
      )}

      {/* 편집 툴바(두 번째 상단바) — 편집 모드일 때만. 노드 추가·자동정렬·정렬/분배 */}
      {!readOnly && (
        <EditorToolbar
          onAddNode={(type) => handleAddNode(null, type)}
          onOpenLibrary={() => (isWordMap ? setSectionsOpen(true) : isFrameworkMap ? setFrameworkPickerOpen(true) : setLibraryOpen(true))}
          onAutoLayout={(dir) => {
            // 선택 노드 2개 이상이면 그 부분만 자동정렬, 아니면 전체 (컨텍스트 메뉴와 동일)
            const ids = new Set(
              nodesRef.current.filter((node) => node.selected).map((node) => node.id),
            );
            applyAutoLayout(dir, ids.size >= 2 ? ids : null);
          }}
          onAlign={(axis) => applyNodesTransform((current) => alignSelected(current, axis))}
          onDistribute={(axis) => applyNodesTransform((current) => distributeSelected(current, axis))}
          manualUrl={manualUrl}
          onImportCsv={
            checkout?.mine && currentParentId === null && eligible !== null && previewSource === null
              ? () => setCsvImportOpen(true)
              : undefined
          }
        />
      )}

      <div className="relative flex min-h-0 flex-1">
        <EditorLeftSidebar
          collapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((value) => !value)}
          mapId={mapId}
          selectedId={selectedId}
          outline={displayOutline}
          onSelectNode={handleOutlineSelect}
          onToggleExpand={handleToggleExpand}
          readOnly={readOnly}
          searchSlot={
            <NodeSearch<SearchResult>
              inputRef={searchInputRef}
              query={searchQuery}
              onQueryChange={(value) => {
                setSearchQuery(value);
                if (!value.trim()) {
                  setSearchResults([]);
                }
              }}
              results={searchResults}
              activeIndex={searchIndex}
              onActiveIndexChange={setSearchIndex}
              onSelect={handleSearchSelect}
            />
          }
          onRowContextMenu={(event, id) => {
            setSelectedId(id);
            setSelectedEdgeId(null);
            openMenu(event, "node", id);
          }}
          onRenameNode={renameNode}
          onReadOnlyRowNotice={() => showToast(t("outline.readonlyChild"))}
          onDeleteNode={(id) => void reactFlow.deleteElements({ nodes: [{ id }] })}
          onSelectNext={handleOutlineNext}
          onSelectPrev={handleOutlinePrev}
          onExpand={handleOutlineExpand}
          onCollapse={handleOutlineCollapse}
          onFold={handleOutlineFold}
        />
        {libraryOpen && (
          <ProcessLibraryPanel
            currentMapId={mapId}
            linkedMapIds={linkedMapIds}
            readOnly={readOnly}
            nodeDisplayFields={displayFields}
            onClose={() => setLibraryOpen(false)}
            onAddLinkNode={(linkedMapId, name) => void addLinkNodeFromMap(linkedMapId, name)}
            onPeekAdd={addLinkNodeFromPeek}
            onPeekOpenMap={(peekMapId, name) => setOpenMapPrompt({ mapId: peekMapId, name })}
            onFocusLinkedNode={focusLinkedNode}
          />
        )}
        {sectionsOpen && (
          <SectionPanel
            sections={docSections}
            docName={docName}
            onReimport={() => setWordReimportOpen(true)}
            onClose={() => setSectionsOpen(false)}
            staleCount={staleAnchorIds.size}
          />
        )}
        {frameworkPickerOpen && (
          <FrameworkTreePicker
            currentMapId={mapId}
            linkedMapIds={linkedMapIds}
            readOnly={readOnly}
            nodeDisplayFields={displayFields}
            linkageCategoryId={linkageCategoryId}
            onClose={() => setFrameworkPickerOpen(false)}
            onPeekAdd={addLinkNodeFromPeek}
            onPeekOpenMap={(peekMapId, name) => setOpenMapPrompt({ mapId: peekMapId, name })}
            onFocusLinkedNode={focusLinkedNode}
          />
        )}
        {connectTarget !== null && (
          <FrameworkConnectDialog
            nodeTitle={connectTarget.title}
            originCategoryId={connectTarget.originId}
            originPath={connectTarget.originPath}
            successor={connectTarget.successor}
            linkedMapIds={linkedMapIds}
            currentMapId={mapId}
            onConnect={applyConnectPlaceholder}
            onClose={() => setConnectTarget(null)}
          />
        )}
        {wordReimportOpen && (
          <WordCreateModal
            onClose={() => setWordReimportOpen(false)}
            onContinue={(outcome) => {
              setWordReimportOpen(false);
              void (async () => {
                try {
                  const updated = await setWordDoc(mapId, {
                    doc_name: outcome.docName,
                    sections: outcome.sections,
                  });
                  setDocName(updated.doc_name ?? "");
                  setDocSections(updated.doc_sections ?? []);
                  showToast("Sections re-imported");
                } catch {
                  showToast("Re-import failed");
                }
              })();
            }}
          />
        )}
        <div
          ref={canvasContainerRef}
          // select-none — 박스선택 드래그가 노드 라벨·아웃라인 텍스트를 파랗게 선택하는 UI 오류 방지(입력창은 globals에서 예외)
          className={`relative flex-1 select-none overflow-hidden ${isFrameworkMap ? "bg-surface" : "bg-canvas"}`}
          onDragOver={(e) => {
            if (
              e.dataTransfer.types.includes("application/bpm-process") ||
              e.dataTransfer.types.includes("application/bpm-section")
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer.types.includes("application/bpm-process")) {
              void handleLibraryDrop(e);
            } else if (e.dataTransfer.types.includes("application/bpm-section")) {
              void handleSectionDrop(e);
            }
          }}
        >
          {scopes.map((scope, index) => {
            const key = scopeKey(scope);
            const geom = windowGeom[key] ?? defaultGeom(index, bounds);
            // 포커스 모드 — 루트(index 0)가 유일한 캔버스 호스트라 항상 active(드릴 깊이와 무관).
            const active = index === 0 || index === activeIndex;
            // 포커스 모드 — 드릴인 플로팅 창 억제. 캔버스는 항상 루트에 두고 활성 스코프는 currentParentId로 전환.
            if (index !== 0) {
              return null;
            }
            return (
              <ScopeWindow
                key={key}
                title={scope.title}
                geom={geom}
                active={active}
                zIndex={active ? 1000 : zOrder.indexOf(key) + 1}
                canClose={index > 0}
                chromeless={index === 0}
                // 루트 좌상단 — 캔버스는 저장 체크리스트 대신 L5 탐색기(전 레벨 트리·내 위치·타 L5 열기),
                // 일반 맵은 기존 제목+저장 조건 아코디언 (2026-08-28 개선)
                titleSlot={
                  index === 0 && isFrameworkMap ? (
                    <FrameworkL5Explorer
                      currentCategoryId={linkageCategoryId}
                      currentName={scope.title}
                      inset
                      onNavigate={(targetId, name) => setOpenMapPrompt({ mapId: targetId, name })}
                      onError={(message) => showToast(message, "error")}
                    />
                  ) : index === 0 && !readOnly ? (
                    <MapTitleChecklist
                      mapTitle={scope.title}
                      checklistLabel={t("save.checklistTitle")}
                      items={nodes.length > 0 ? saveCheckItems : []}
                    />
                  ) : undefined
                }
                // 우상단 — 캔버스는 "L5 map" 단순 태그(+뷰어 미반영 칩), 일반 등록 맵은 기존 체인 트리 칩.
                // 이동은 F6 "링크맵 열기"와 같은 미저장 경고 확인 모달(openMapPrompt)을 거친다.
                topRightSlot={
                  index === 0 && isFrameworkMap ? (
                    <>
                      {/* 클릭 = 캔버스 배경 토글(차콜↔라이트) — "L5" 신호와 스위치를 한자리에.
                          표시 전용 설정이라 readOnly에도 허용, 선택은 사용자 전역 localStorage */}
                      <button
                        type="button"
                        data-id="framework-l5-tag"
                        title={t(l5Charcoal ? "framework.bgToLight" : "framework.bgToCharcoal")}
                        onClick={toggleL5CanvasBg}
                        className={`absolute right-5 top-5 z-10 flex select-none items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine font-medium text-ink-secondary shadow-sm backdrop-blur-sm transition-colors duration-150 ${
                          // 프레임 상시 유지라 위치 고정(20px) — 라이트/차콜 전환에도 버튼이 안 움직임
                          l5Charcoal ? "bg-surface/85 hover:bg-surface" : "bg-surface/40 hover:bg-surface/70"
                        }`}
                      >
                        <Workflow size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        {t("framework.l5MapTag")}
                        {l5Charcoal ? (
                          <Moon size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        ) : (
                          <Sun size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        )}
                      </button>
                      {/* 뷰어 안내 — 권한자가 아니라 자동 보강이 스킵된 미반영 소속 L6 수 (design 2026-08-28 §5) */}
                      {reconcileMissing > 0 && (
                        <span
                          data-id="framework-missing-chip"
                          className="absolute right-5 top-[52px] z-10 rounded-sm border border-hairline bg-surface/70 px-1.5 py-0.5 text-fine text-ink-tertiary shadow-sm backdrop-blur-sm"
                        >
                          {t("framework.missing", { n: reconcileMissing })}
                        </span>
                      )}
                    </>
                  ) : index === 0 && mapCategoryId !== null ? (
                    <FrameworkChip
                      mapId={mapId}
                      categoryId={mapCategoryId}
                      onNavigate={(targetId, name) => setOpenMapPrompt({ mapId: targetId, name })}
                    />
                  ) : undefined
                }
                bounds={bounds}
                onFocus={() => {
                  bringToFront(key);
                  if (!active) {
                    void focusScope(index);
                  }
                }}
                onGeomChange={(next) =>
                  setWindowGeom((map) => ({ ...map, [key]: next }))
                }
                onClose={() => closeScope(index)}
              >
                {active ? (
                  // 그룹 오버레이·복수 선택 영역 우클릭 시 브라우저 기본 메뉴 차단 (ReactFlow 핸들러가 안 타는 영역)
                  <div
                    // L5는 라이트 토글에서도 프레임 유지 — 전환 시 태그/칩 위치가 안 움직이게. 프레임은
                    // absolute inset(패딩으론 불가), 채움만 차콜 하늘(.bpm-l5-sky) ↔ 라이트 캔버스 교체
                    className={`${
                      index === 0 && isFrameworkMap
                        ? `absolute inset-2.5 overflow-hidden rounded-md shadow-md ${l5Charcoal ? "bpm-l5-sky" : "bg-canvas"}`
                        : "relative h-full w-full bg-canvas"
                    }${expandAnimating ? " bpm-expand-anim" : ""}`}
                    onContextMenu={(event) => event.preventDefault()}
                    // 펼침 영역 호버 — 상시 selection 모드라 RF onPaneMouseMove가 바인딩되지 않아(pane은
                    // 내부 셀렉션 핸들러 사용) 래퍼에서 버블링 pointermove로 판정. 동일 값은 setState 베일아웃.
                    onPointerMove={(event) => {
                      setHoverRegionId(findRegionAtClient(event.clientX, event.clientY));
                    }}
                    onPointerLeave={() => setHoverRegionId(null)}
                  >
                    {index === 0 && l5Charcoal && (
                      // 브랜드 워터마크 — 회사 로고·시스템명·플랫 아이콘을 번갈아 사선 타일링(단조로움 완화).
                      // ReactFlow보다 앞 DOM + 저불투명이라 노드/엣지를 가리지 않는다. 뷰포트 고정(팬 무관)
                      <div
                        aria-hidden
                        data-id="l5-brand-watermark"
                        className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
                      >
                        <div className="absolute -inset-[60%] flex -rotate-[24deg] flex-col items-center justify-center gap-14 text-canvas opacity-[0.06]">
                          {Array.from({ length: 14 }, (_, row) => (
                            <div
                              key={row}
                              className="flex items-center gap-16 whitespace-nowrap text-[15px] tracking-[0.18em]"
                              // 홀수 행 오프셋 — 격자 정렬을 깨 자연스러운 벽지 리듬
                              style={row % 2 === 1 ? { transform: "translateX(130px)" } : undefined}
                            >
                              {Array.from({ length: 5 }, (_, col) =>
                                (row + col) % 3 === 0 ? (
                                  <span key={col} className="font-semibold">SAMSUNG BIOLOGICS</span>
                                ) : (row + col) % 3 === 1 ? (
                                  <Workflow key={col} size={18} strokeWidth={1.5} className="shrink-0" />
                                ) : (
                                  <span key={col} className="font-light">Business Process Map</span>
                                ),
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <ReactFlow
                      // 우하단 어트리뷰션 마크 숨김(공식 proOptions) — 사내 도구 화면 정리 (사용자 요청 2026-09-01)
                      proOptions={{ hideAttribution: true }}
                      nodes={displayNodes}
                      edges={styledEdges}
                      nodeTypes={nodeTypes}
                      edgeTypes={EDITOR_EDGE_TYPES}
                      snapToGrid
                      snapGrid={[8, 8]}
                      nodesDraggable={!readOnly}
                      nodesConnectable={!readOnly}
                      onNodesChange={handleNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onConnectEnd={handleConnectEnd}
                      connectionLineComponent={QuickConnectLine}
                      isValidConnection={isValidConnection}
                      onNodeClick={(_, node) => {
                        // 인라인 자식(읽기전용) — 선택 효과(테두리·불투명)는 RF가 처리하고, selectedId도
                        // 동기화해 아웃라인 행 하이라이트와 일치시킨다(깊이 무관 통일). 탐색 없음.
                        if (node.data?.scopeId != null) {
                          setSelectedId(node.id);
                          setSelectedEdgeId(null);
                          return;
                        }
                        // 포커스(Path 2) — 다른 스코프 노드 클릭 시 그 스코프를 navigateTo로 진짜 nodes化(네이티브 풀편집).
                        // 카메라 보정: 클릭 노드의 "현재 표시 위치 − 저장(스코프상대) 위치"만큼 카메라를 옮겨
                        // 그 노드(=스코프)가 제자리에 남게 한다. 자식 진입·루트 복귀(exit) 양쪽 모두 제자리.
                        const nodeScope = node.data?.scopeId ?? null;
                        if (nodeScope !== currentParentId) {
                          const stored = fullGraph?.nodes.find((n) => n.id === node.id);
                          if (stored) {
                            focusCamRef.current = {
                              shift: {
                                x: node.position.x - stored.pos_x,
                                y: node.position.y - stored.pos_y,
                              },
                              vp: reactFlow.getViewport(),
                            };
                          }
                          void navigateTo(buildScopesTo(nodeScope));
                          return;
                        }
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                      }}
                      onNodeDoubleClick={(_, node) => {
                        // 더블클릭 = 요약/편집 모달 — subprocess 포함(딥뷰 드릴인 대신, 프레임 변동 제거 F4).
                        // 드릴인은 임베드 자식 더블클릭·펼침 토글 경로로 유지. 타이틀 더블클릭은 이름 편집(비-subprocess).
                        setSelectedId(node.id);
                        setSummaryNodeId(node.id);
                        setPropertiesTabNonce((n) => n + 1); // 인스펙터 속성 탭 자동 전환
                      }}
                      onEdgeClick={(_, edge) => {
                        setSelectedEdgeId(edge.id);
                        setSelectedId(null);
                      }}
                      onEdgeDoubleClick={(_, edge) => startEdgeLabelEdit(edge.id)}
                      onPaneClick={() => {
                        setSelectedId(null);
                        setSelectedEdgeId(null);
                        setMenu(null);
                        setPending(null);
                        setSummaryNodeId(null);
                        setFlow({ anchor: null, reach: 0 }); // 흐름 하이라이트 초기화(재선택 시 잔존 방지, F14)
                      }}
                      onPaneContextMenu={(event) => {
                        // 펼침 영역(틴트) 위 우클릭 — 겹침이면 가장 안쪽 영역. 밖이면 기존 pane 메뉴.
                        const regionId = findRegionAtClient(event.clientX, event.clientY);
                        if (regionId !== null) {
                          openMenu(event, "region", regionId, {
                            regionLabel: inlineCompositionRef.current?.regions.find(
                              (region) => region.id === regionId,
                            )?.label,
                          });
                          return;
                        }
                        openMenu(event, "pane", null);
                      }}
                      onNodeContextMenu={(event, node) => {
                        // 인라인 자식(읽기전용)도 메뉴를 연다 — 빌더가 "(읽기전용)" 안내 1항목을 내려
                        // 액션 불가를 인지시킴(아웃라인 자식 행 우클릭과 동일 경로·동일 결과).
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                        openMenu(event, "node", node.id);
                      }}
                      onEdgeContextMenu={(event, edge) => {
                        // 우클릭 = 엣지 선택(F2 리네임 대상 확정) — 노드 우클릭과 동일 패턴.
                        setSelectedEdgeId(edge.id);
                        setSelectedId(null);
                        openMenu(event, "edge", edge.id);
                      }}
                      onSelectionContextMenu={(event) => openMenu(event, "selection", null)}
                      onNodeDragStart={(event, node, nodes) => {
                        pushHistory();
                        dragStartPosRef.current = { id: node.id, x: node.position.x, y: node.position.y };
                        // RF는 다중선택을 노드 하나로 잡아 끌 때도 이 콜백에 전체 목록을 세 번째 인자로 준다.
                        dragStartPositionsRef.current = new Map(
                          nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
                        );
                        setDragFrozenSteps(heightStepsRef.current); // 드래그 중 height-shift 스텝 동결(지터 방지)
                        captureDragYOffsets(nodes); // 제스처 오프셋 동결 — 드래그 중 선형 왕복(커서 1:1)
                        captureRootDragStart([node]);
                        beginCtrlDrag(event.ctrlKey || event.metaKey, node.id, nodes);
                      }}
                      onNodeDrag={handleNodeDrag}
                      onNodeDragStop={(_, node) => {
                        // 펼침 중 추적 드래그면 표시→저장 환산/무효취소를 먼저 확정.
                        const { tracked, committed } = finalizeRootDrag();
                        // Ctrl+드래그 사본 모드 — zone/group/collision 대신 원위치 복귀+사본 생성으로 대체.
                        if (ctrlDragActive) {
                          applyCtrlDragCopy();
                        } else if (!tracked || committed) {
                          // 추적 드래그인데 무효(취소)면 zone/group/collision/save 모두 생략 — 원위치 복귀만.
                          const drop = dropTargetRef.current;
                          if (
                            !readOnly &&
                            drop &&
                            drop.id !== node.id &&
                            drop.zone !== null
                          ) {
                            handleZoneDrop(node.id, drop.id, drop.zone);
                          } else if (!readOnly && groupDropTargetRef.current) {
                            addToGroupId(node.id, groupDropTargetRef.current);
                          } else if (!readOnly) {
                            setNodes((current) => resolveCollision(current, node.id));
                            scheduleAutoSave();
                          }
                        }
                        setCtrlDragActive(false);
                        setCtrlDragGhosts((cur) => (cur.length > 0 ? [] : cur));
                        clearDwell();
                        setDropTarget(null);
                        setGroupDropTarget(null);
                        draggedNodeIdRef.current = null;
                        // 제스처 종료 — 다음 무관한 position 변경(화살표 이동 등)이 축 고정에 새지 않게 해제.
                        dragStartPosRef.current = null;
                        dragStartPositionsRef.current = new Map();
                        setDragFrozenSteps(null); // 동결 해제 — 최종 좌표 기준 스텝으로 트윈 복귀
                        clearDragYOffsets();
                      }}
                      onSelectionDragStart={(event, nodes) => {
                        pushHistory();
                        // 선택박스 오버레이(빈 공간)를 잡아 끄는 평범한 다중선택 드래그는 onNodeDragStart가 아니라
                        // 여기로 온다 — Shift 축 고정 기준점을 노드별로 시드해야 dropDraggingPositions가 각 노드를 보정한다.
                        dragStartPositionsRef.current = new Map(
                          nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
                        );
                        setDragFrozenSteps(heightStepsRef.current); // 드래그 중 height-shift 스텝 동결(지터 방지)
                        captureDragYOffsets(nodes); // 제스처 오프셋 동결 — 드래그 중 선형 왕복(커서 1:1)
                        captureRootDragStart(nodes);
                        // 선택박스 오버레이(빈 공간) 드래그는 항상 의도된 선택 드래그 → grabbedId=null(선택 집합 전체).
                        beginCtrlDrag(event.ctrlKey || event.metaKey, null, nodes);
                      }}
                      onSelectionDrag={(_, nodes) => {
                        // 다중선택 드래그 — onNodeDrag가 안 발화하므로 여기서 라이브 표시좌표를 갱신.
                        // 인라인 펼침(dragLiveById 렌더) 경로 전용. 평범한 다중선택은 nodes state로 렌더되고
                        // dropDraggingPositions가 dragStartPositionsRef 기준으로 이미 축 고정하므로 여긴 건너뛴다
                        // (여기서 dragLiveById를 써도 inlineComposition이 없으면 렌더에 안 쓰이고 잔여 항목만 남긴다).
                        const tracked = dragStartOffsetRef.current;
                        if (tracked.size === 0) {
                          return;
                        }
                        const shiftHeld = shiftHeldRef.current;
                        setDragLiveById((cur) => {
                          const next = new Map(cur);
                          for (const node of nodes) {
                            const entry = tracked.get(node.id);
                            if (entry) {
                              // 다중선택은 노드별 시작점이 달라 개별 보정(entry.start 기준).
                              next.set(
                                node.id,
                                constrainToAxis(entry.start, node.position, shiftHeld),
                              );
                            }
                          }
                          return next;
                        });
                      }}
                      onSelectionDragStop={() => {
                        const { tracked, committed } = finalizeRootDrag();
                        if (ctrlDragActive) {
                          applyCtrlDragCopy();
                        } else if (!tracked || committed) {
                          // 추적 드래그인데 전부 무효(취소)면 저장 생략. 그 외엔 기존대로 autosave.
                          scheduleAutoSave();
                        }
                        setCtrlDragActive(false);
                        setCtrlDragGhosts((cur) => (cur.length > 0 ? [] : cur));
                        // 제스처 종료 — 다음 무관한 position 변경이 축 고정에 새지 않게 해제(onNodeDragStop과 동일).
                        dragStartPositionsRef.current = new Map();
                        setDragFrozenSteps(null); // 동결 해제 — 최종 좌표 기준 스텝으로 트윈 복귀
                        clearDragYOffsets();
                      }}
                      onBeforeDelete={async ({ nodes: deletingNodes, edges: deletingEdges }) => {
                        if (readOnly) {
                          return false;
                        }
                        // 캔버스 소속 L6는 삭제 불가 — 걸러내고 나머지만 진행(서버 422 미러) (2026-08-28 개선)
                        if (isFrameworkMap) {
                          const allowedNodes = deletingNodes.filter((node) => {
                            if (node.data.nodeType !== "subprocess" || node.data.linkedMapId == null) {
                              return true;
                            }
                            const ref = subprocessRefs.get(node.data.linkedMapId);
                            return !(ref?.category_id != null && ref.category_id === linkageCategoryId);
                          });
                          if (allowedNodes.length < deletingNodes.length) {
                            showToast(t("framework.containedLocked"));
                            if (allowedNodes.length === 0 && deletingEdges.length === 0) {
                              return false;
                            }
                            pushHistory();
                            return { nodes: allowedNodes, edges: deletingEdges };
                          }
                        }
                        pushHistory();
                        return true;
                      }}
                      onNodesDelete={handleNodesDelete}
                      onEdgesDelete={() => scheduleAutoSave()}
                      onMoveStart={() => setMenu(null)}
                      selectionOnDrag
                      // 기본값 Shift가 축 고정 키와 충돌 — pane 빈 영역 드래그 선택은 selectionOnDrag로 이미 가능하므로 비활성화.
                      selectionKeyCode={null}
                      panOnDrag={[1]}
                      panActivationKeyCode="Space"
                      deleteKeyCode={["Delete"]}
                      // 휠 기본 = 캔버스 팬(세로 휠 상하, shift+휠·트랙패드 좌우 가로), Ctrl(또는 Cmd)+휠 = 줌 (사용자 요청)
                      panOnScroll
                      panOnScrollMode={PanOnScrollMode.Free}
                      zoomOnScroll={false}
                      // 읽기전용은 노드가 draggable이 아니라 nopan 클래스가 없어 d3-zoom 더블클릭 줌이
                      // 노드 위 이벤트를 소비(stopImmediatePropagation) → onNodeDoubleClick(모달)이 죽는다.
                      // 읽기전용에서 더블클릭 줌을 꺼서 모달 더블클릭을 편집 모드와 통일.
                      zoomOnDoubleClick={!readOnly}
                      zoomActivationKeyCode={["Control", "Meta"]}
                      {...(contentExtent
                        ? { nodeExtent: contentExtent.node, translateExtent: contentExtent.pan }
                        : {})}
                      minZoom={MIN_ZOOM}
                      fitView
                    >
                      <ViewportPortal>
                        {/* 선택 노드 추종 테두리 — 노드 사이를 슬라이드 */}
                        <NodeSelectionRing />
                        {/* 단일 선택 노드 하단의 통합 액션 바 — 펼치기/링크/그룹 나가기 */}
                        <NodeActionBar
                          readOnly={readOnly}
                          onLeaveGroups={leaveGroups}
                          onOpenLink={setLinkPreviewUrl}
                        />
                        {inlineComposition && (
                          <InlineRegionBands
                            regions={inlineComposition.regions}
                            baseDepth={currentScopeDepth}
                            hoverId={hoverRegionId}
                            frameworks={regionFrameworks}
                            onTitleMenu={(event, hostId, label) =>
                              openMenu(event, "region", hostId, { regionLabel: label, viaTitle: true })
                            }
                            onOpenMap={promptOpenLinkedMap}
                          />
                        )}
                        {focusScopeLanes.map((lane, index) => (
                          <FocusScopeBands
                            key={`lane:${lane.depth}:${index}`}
                            left={lane.left}
                            right={lane.right}
                            top={lane.top}
                            depth={lane.depth}
                            label={lane.label}
                          />
                        ))}
                        {groupBoxes.map((box) => (
                          <Fragment key={box.id}>
                            {/* 반투명 박스 — 노드 뒤로, 멤버 적은 그룹이 위(z) */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x}px, ${box.y}px)`,
                                zIndex: box.z,
                              }}
                            >
                              <GroupBox
                                color={box.color}
                                width={box.width}
                                height={box.height}
                                fill={box.fill}
                                outline={box.outline}
                                targeted={groupDropTarget === box.id}
                              />
                            </div>
                            {/* 타이틀바 — 노드 위, 박스 상단 좌측. 우클릭 시 그룹 멤버 정렬 메뉴 */}
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                transform: `translate(${box.x + 4}px, ${box.y + 3}px)`,
                                zIndex: 1,
                              }}
                              onContextMenu={(event) => {
                                event.stopPropagation(); // 팬 컨텍스트 메뉴로 덮어쓰이지 않게
                                openMenu(event, "group", box.id);
                              }}
                            >
                              <GroupTitleBar
                                id={box.id}
                                label={box.label}
                                color={box.color}
                                width={box.width - 56}
                                readOnly={readOnly}
                                autoEdit={box.id === newGroupId}
                                onAutoEditConsumed={() => setNewGroupId(null)}
                                colorPresets={GROUP_COLOR_PRESETS}
                                onRename={renameGroup}
                                onRecolor={recolorGroup}
                                onMoveStart={startGroupMove}
                                onBulkEdit={setBulkEditGroupId}
                              />
                            </div>
                          </Fragment>
                        ))}
                      </ViewportPortal>
                      {/* 편집 가능 시에만 모눈(dot) 배경. 뷰모드는 점 없이 워터마크로 표시(아래) */}
                      {/* 차콜 L5는 무늬 없는 민 무대 — 도트를 걷고 모드 링(프레임 액센트 테두리)이 신호를 담당 */}
                      {!readOnly && !(index === 0 && l5Charcoal) && (
                        <Background
                          variant={BackgroundVariant.Dots}
                          gap={20}
                          size={1.8}
                          color="var(--color-canvas-dot)"
                        />
                      )}
                      {/* Word 맵 1페이지 경계 — 크기 감각용(노드가 이 안이면 산출물 1페이지). ViewportPortal=flow 좌표(팬/줌 정합). */}
                      {isWordMap && (
                        <ViewportPortal>
                          <div
                            data-id="word-page-boundary"
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              width: WORD_PAGE_W_PX,
                              height: WORD_PAGE_H_PX,
                              border: "1.5px dashed var(--color-accent)",
                              borderRadius: 2,
                              pointerEvents: "none",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: 3,
                                left: 5,
                                fontSize: 11,
                                color: "var(--color-accent)",
                                opacity: 0.65,
                              }}
                            >
                              1 page
                            </span>
                          </div>
                        </ViewportPortal>
                      )}
                      {/* 미니맵 — 줌아웃으로 통째로 채워지면 페이드 아웃(줌인 복귀). 패널 자체에 opacity를 줘
                          z-index(패널 레이어)를 보존 → 노드/캔버스 위·클릭(시점 이동) 유효. 뷰포트 채움 오버레이 포함. */}
                      <MinimapFade
                        nodeColor={(n) =>
                          `color-mix(in srgb, ${resolveNodeStroke(n.data.color, n.data.nodeType)} 38%, white)`
                        }
                      />
                      <CanvasZoomScale onFit={fitScopeTopLeft} />
                    </ReactFlow>
                    {/* 뷰모드 워터마크 — 편집 불가 상태를 배경으로 즉시 인지(점 그리드 대체) / read-only watermark
                        게시=PUBLISHED(액센트), 만료=EXPIRED(회색), 그 외 READ ONLY — 상태 텍스트는 한/영 모두 영어 고정 */}
                    {readOnly && (
                      <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center overflow-hidden">
                        <span
                          className={`-rotate-[18deg] select-none whitespace-nowrap text-[120px] font-semibold uppercase tracking-widest opacity-[0.14] ${
                            // 차콜 캔버스에선 accent/회색이 묻힘 — 밝은색으로 동일한 은은함 유지.
                            // text-canvas(#f6f6f8) — 다크 셸이 --color-surface를 뒤집어도 라이트로 남는 토큰
                            index === 0 && l5Charcoal
                              ? "text-canvas"
                              : currentVersion?.status === "expired"
                                ? "text-ink-tertiary"
                                : "text-accent"
                          }`}
                        >
                          {currentVersion?.status === "published"
                            ? t("editor.watermarkPublished")
                            : currentVersion?.status === "expired"
                              ? t("editor.watermarkExpired")
                              : t("editor.watermark")}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <ScopePreview
                    fullGraph={fullGraph}
                    scopeParentId={scopeHostId(scope)}
                    charcoal={index === 0 && l5Charcoal}
                  />
                )}
              </ScopeWindow>
            );
          })}
          <WindowDock
            items={scopes
              .map((scope, index) => ({ scope, index, key: scopeKey(scope) }))
              .filter(({ index, key }) => index !== 0 && (windowGeom[key] ?? defaultGeom(index, bounds)).minimized)
              .map(({ scope, key }) => ({ key, title: scope.title }))}
            onRestore={(key) => {
              setWindowGeom((map) => {
                const idx = scopes.findIndex((scope) => scopeKey(scope) === key);
                const base = map[key] ?? defaultGeom(idx, bounds);
                return { ...map, [key]: { ...base, minimized: false } };
              });
              bringToFront(key);
            }}
          />
          {/* 최소화된 AI 창 — 정사각 스파클 아이콘, 화면 어디든 드래그. 클릭 시 복원 (R10d5) */}
          {aiOpen && windowGeom[AI_WINDOW_KEY]?.minimized && (
            <button
              type="button"
              title={t("ai.title")}
              aria-label={t("ai.title")}
              className="absolute z-[1095] flex h-11 w-11 touch-none items-center justify-center rounded-md border border-accent-tint-border bg-gradient-to-br from-surface to-accent-tint text-accent opacity-70 shadow-md transition hover:opacity-100 hover:shadow-lg"
              style={{ left: aiMinPos.x, top: aiMinPos.y }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                aiMinDragRef.current = {
                  px: event.clientX,
                  py: event.clientY,
                  x: aiMinPos.x,
                  y: aiMinPos.y,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                const drag = aiMinDragRef.current;
                if (!drag) return;
                if (Math.abs(event.clientX - drag.px) + Math.abs(event.clientY - drag.py) > 4) {
                  drag.moved = true;
                }
                setAiMinPos({
                  x: Math.min(Math.max(drag.x + (event.clientX - drag.px), 0), Math.max(0, bounds.w - 44)),
                  y: Math.min(Math.max(drag.y + (event.clientY - drag.py), 0), Math.max(0, bounds.h - 44)),
                });
              }}
              onPointerUp={(event) => {
                const drag = aiMinDragRef.current;
                aiMinDragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
                // 드래그가 아니면(제자리 클릭) 창 복원 — 버튼 위치에서 펴지되 캔버스 안에 들어오게 클램프
                if (drag && !drag.moved) {
                  setWindowGeom((map) => {
                    const base = map[AI_WINDOW_KEY] ?? aiDefaultGeom(bounds);
                    const x = Math.min(Math.max(aiMinPos.x, 0), Math.max(0, bounds.w - base.w));
                    const y = Math.min(Math.max(aiMinPos.y, 0), Math.max(0, bounds.h - base.h));
                    return { ...map, [AI_WINDOW_KEY]: { ...base, x, y, minimized: false } };
                  });
                }
              }}
            >
              <Sparkles size={20} strokeWidth={1.7} />
            </button>
          )}
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={menuItems}
              wide={menu.kind === "edge"}
              onClose={() => setMenu(null)}
            />
          )}
          {dropTarget &&
            (() => {
              const r = dropTarget.rect;
              const cx = r.left + r.width / 2;
              const cy = r.top + r.height / 2;
              // 링 반경 — screenRectOf에서 줌 무관 고정값으로 계산됨 (hit-test와 공용)
              const radius = r.radius;
              // 부채꼴: 노드 근처(ri)에서 바깥(ro)으로 팬, 아이콘/라벨은 중간 반경(rm)
              const ri = radius * 0.8; // 밴드 두께 축소 — 가장자리(ro)는 유지, 안쪽만 바깥으로
              const ro = radius + 48;
              const rm = (ri + ro) / 2;
              const rad = (d: number) => (d * Math.PI) / 180;
              const HALF = rad(19); // 활성 부채꼴 반각(=38° 폭) — 각폭 좁혀 조각 사이 간극 확대
              const DHALF = rad(16); // 대각 점선 부채꼴 반각
              const CR = 7; // 모서리 라운드 반경(px) — 이미지처럼 둥근 부채꼴
              const pt = (rr: number, a: number) =>
                `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
              // 라운드 모서리 annular sector — 각도 화면좌표(y-down, 0°=동). 방사형 변은 곧게(중심 방향)
              // 두어 각도 차만큼 조각 사이 간극이 바깥으로 갈수록 넓어진다. 네 모서리만 CR로 둥글림.
              const sector = (axis: number, half: number, r0: number, r1: number) => {
                const a0 = axis - half;
                const a1 = axis + half;
                const di = CR / r0; // 내호 각도 오프셋
                const dO = CR / r1; // 외호 각도 오프셋
                const R0 = r0.toFixed(2);
                const R1 = r1.toFixed(2);
                return [
                  `M ${pt(r0 + CR, a0)}`,
                  `L ${pt(r1 - CR, a0)}`,
                  `Q ${pt(r1, a0)} ${pt(r1, a0 + dO)}`,
                  `A ${R1} ${R1} 0 0 1 ${pt(r1, a1 - dO)}`,
                  `Q ${pt(r1, a1)} ${pt(r1 - CR, a1)}`,
                  `L ${pt(r0 + CR, a1)}`,
                  `Q ${pt(r0, a1)} ${pt(r0, a1 - di)}`,
                  `A ${R0} ${R0} 0 0 0 ${pt(r0, a0 + di)}`,
                  `Q ${pt(r0, a0)} ${pt(r0 + CR, a0)}`,
                  "Z",
                ].join(" ");
              };
              // 사용 4방향 — group=상(N)/back=우(E)/swap=하(S)/front=좌(W)
              const zones = [
                { zone: "group", axis: rad(-90), Icon: Boxes, label: t("dropzone.group") },
                { zone: "back", axis: rad(0), Icon: ArrowRight, label: t("dropzone.back") },
                { zone: "swap", axis: rad(90), Icon: ArrowLeftRight, label: t("dropzone.swap") },
                { zone: "front", axis: rad(180), Icon: ArrowLeft, label: t("dropzone.front") },
              ] as const;
              const diagAxes = [rad(-45), rad(45), rad(135), rad(-135)]; // NE·SE·SW·NW — 추후 확장
              const blockedOf = (zone: string) =>
                (zone === "front" && dropTarget.frontBlocked) ||
                (zone === "back" && dropTarget.backBlocked) ||
                (zone === "swap" && dropTarget.swapBlocked);
              return (
                <div className="pointer-events-none absolute inset-0 z-[1100]">
                  <svg className="zone-fan absolute inset-0 h-full w-full overflow-visible">
                    {/* 추후 확장 — 점선 대각 부채꼴 */}
                    {diagAxes.map((axis, i) => (
                      <path
                        key={`d${i}`}
                        d={sector(axis, DHALF, ri, ro)}
                        style={{
                          fill: "color-mix(in srgb, var(--color-ink-tertiary) 4%, transparent)",
                          stroke: "color-mix(in srgb, var(--color-ink-tertiary) 36%, transparent)",
                          strokeWidth: 1.5,
                          strokeDasharray: "4 4",
                          strokeLinejoin: "round",
                        }}
                      />
                    ))}
                    {/* 사용 4방향 부채꼴 */}
                    {zones.map(({ zone, axis }) => {
                      const active = dropTarget.zone === zone;
                      const blocked = blockedOf(zone);
                      const style = blocked
                        ? {
                            fill: "color-mix(in srgb, var(--color-ink-tertiary) 7%, transparent)",
                            stroke: "color-mix(in srgb, var(--color-ink-tertiary) 25%, transparent)",
                            strokeWidth: 1.5,
                          }
                        : active
                          ? {
                              fill: "color-mix(in srgb, var(--color-accent) 34%, transparent)",
                              stroke: "var(--color-accent)",
                              strokeWidth: 2.5,
                            }
                          : {
                              fill: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
                              stroke: "color-mix(in srgb, var(--color-accent) 32%, transparent)",
                              strokeWidth: 1.5,
                            };
                      return (
                        <path
                          key={zone}
                          d={sector(axis, HALF, ri, ro)}
                          style={{ ...style, strokeLinejoin: "round" }}
                        />
                      );
                    })}
                  </svg>
                  {/* 대각 + 표시(추후 확장) */}
                  {diagAxes.map((axis, i) => (
                    <span
                      key={`p${i}`}
                      className="absolute -translate-x-1/2 -translate-y-1/2 text-body font-light text-ink-tertiary/40"
                      style={{ left: cx + rm * Math.cos(axis), top: cy + rm * Math.sin(axis) }}
                    >
                      +
                    </span>
                  ))}
                  {/* 아이콘 + 라벨 */}
                  {zones.map(({ zone, axis, Icon, label }) => {
                    const active = dropTarget.zone === zone;
                    const blocked = blockedOf(zone);
                    const tone = blocked
                      ? "text-ink-tertiary opacity-40"
                      : active
                        ? "text-accent"
                        : "text-accent/80";
                    return (
                      <div
                        key={`l${zone}`}
                        className={`zone-pop absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 ${tone}`}
                        style={{ left: cx + rm * Math.cos(axis), top: cy + rm * Math.sin(axis) }}
                      >
                        <Icon size={18} strokeWidth={1.5} />
                        <span className="text-fine font-semibold leading-none">{label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          {/* 엣지 더블클릭 → 엣지 중점에 인라인 라벨 편집 박스 (인스펙터 입력과 동시) */}
          {editingEdgeId && editingEdgePos && editingEdgeInitial !== null && (
            <EdgeLabelEditor
              key={editingEdgeId}
              left={editingEdgePos.left}
              top={editingEdgePos.top}
              initial={editingEdgeInitial}
              placeholder={t("editor.edgeLabelPlaceholder")}
              onCommit={(value) => commitEdgeLabel(editingEdgeId, value)}
              onCancel={cancelEdgeLabelEdit}
            />
          )}
          {pending && (
            <FlowConflictModal
              rect={pending.rect}
              onKeep={() => {
                applyFlowEdges(pending.aId, pending.bId, pending.mode, false);
                setPending(null);
              }}
              onInsertBetween={() => {
                applyFlowEdges(pending.aId, pending.bId, pending.mode, true);
                setPending(null);
              }}
              onClose={() => setPending(null)}
            />
          )}
          {/* AI 제안 미리보기 커밋/취소는 채팅 스레드 내 카드로 이동(R10d4) — AiChatPanel */}
          {/* 단축키 안내는 좌측 사이드바 '아웃라인 키' 더보기로 이동 — 우하단은 줌 컨트롤(CanvasZoomScale) */}
          {summaryNodeId && versionId !== null && (() => {
            // 현재 스코프 노드 우선, 없으면 인라인 펼친 자식 노드(편집 오버레이 반영된 합성 노드)
            const node =
              nodes.find((n) => n.id === summaryNodeId) ??
              inlineComposition?.nodes.find((n) => n.id === summaryNodeId);
            if (!node) {
              return null;
            }
            const isCurrentScopeNode = nodes.some((n) => n.id === summaryNodeId);
            // 자식 노드는 현재 스코프 edges/nodes에 없으므로 fullGraph(전체 트리)에서 선후행 계산
            const labelById = (id: string): string =>
              isCurrentScopeNode
                ? nodes.find((n) => n.id === id)?.data.label ?? ""
                : fullGraph?.nodes.find((n) => n.id === id)?.title ?? "";
            const typeById = (id: string): string =>
              isCurrentScopeNode
                ? nodes.find((n) => n.id === id)?.data.nodeType ?? "process"
                : fullGraph?.nodes.find((n) => n.id === id)?.node_type ?? "process";
            const toRef = (id: string) => ({ id, label: labelById(id), nodeType: typeById(id) });
            const predecessors = (isCurrentScopeNode
              ? edges.filter((edge) => edge.target === summaryNodeId).map((edge) => edge.source)
              : (fullGraph?.edges ?? [])
                  .filter((edge) => edge.target_node_id === summaryNodeId)
                  .map((edge) => edge.source_node_id)
            )
              .map(toRef)
              .filter((ref) => ref.label);
            const successors = (isCurrentScopeNode
              ? edges.filter((edge) => edge.source === summaryNodeId).map((edge) => edge.target)
              : (fullGraph?.edges ?? [])
                  .filter((edge) => edge.source_node_id === summaryNodeId)
                  .map((edge) => edge.target_node_id)
            )
              .map(toRef)
              .filter((ref) => ref.label);
            const hasChildren = (fullGraph?.nodes ?? []).some((n) => n.parent_node_id === summaryNodeId);
            // 다중 태그 — 그룹 라벨들을 콤마로 합쳐 표시
            const groupLabels = node.data.groupIds
              .map((gid) => groups.find((g) => g.id === gid)?.label)
              .filter((label): label is string => Boolean(label));
            const groupLabel = groupLabels.length > 0 ? groupLabels.join(", ") : null;
            const typeKey = NODE_TYPE_OPTIONS.find((option) => option.value === node.data.nodeType)?.labelKey;
            // subprocess가 링크 맵에서 상속하는 회당 4필드 — 읽기전용 표시용(라이브 참조)
            const summarySpRef =
              node.data.nodeType === "subprocess" && node.data.linkedMapId != null
                ? subprocessRefs.get(node.data.linkedMapId)
                : undefined;
            return (
              <NodeSummaryModal
                versionId={versionId}
                nodeId={summaryNodeId}
                title={node.data.label}
                typeLabel={typeKey ? t(typeKey) : node.data.nodeType}
                nodeType={node.data.nodeType}
                showAttributes={hasBpmAttributes(node.data.nodeType)}
                groupLabel={groupLabel}
                predecessors={predecessors}
                successors={successors}
                hasChildren={hasChildren}
                fullGraph={fullGraph}
                readOnly={readOnly}
                description={node.data.description}
                color={node.data.color}
                assignee={node.data.assignee}
                department={node.data.department}
                system={node.data.system}
                duration={node.data.duration}
                touch_time={node.data.touch_time ?? ""}
                input={node.data.input ?? ""}
                output={node.data.output ?? ""}
                input_forms={node.data.input_forms ?? ""}
                output_forms={node.data.output_forms ?? ""}
                output_ids={node.data.output_ids ?? ""}
                input_links={node.data.input_links ?? ""}
                output_links={node.data.output_links ?? ""}
                input_flags={node.data.input_flags ?? ""}
                data_form={node.data.data_form ?? ""}
                start_condition={node.data.start_condition ?? ""}
                end_condition={node.data.end_condition ?? ""}
                cost_krw={node.data.cost_krw ?? ""}
                cost_usd={node.data.cost_usd ?? ""}
                headcount={node.data.headcount ?? ""}
                annual_count={node.data.annual_count ?? ""}
                fte={node.data.fte ?? ""}
                url={node.data.url ?? ""}
                urlLabel={node.data.urlLabel ?? ""}
                colorPresets={colorsForType(node.data.nodeType)}
                spParams={
                  node.data.nodeType === "subprocess" ? getInheritedParams(summarySpRef) : null
                }
                sp={node.data.nodeType === "subprocess" ? summarySpRef ?? null : null}
                gmp={
                  node.data.nodeType === "subprocess"
                    ? summarySpRef?.gmp ?? ""
                    : node.data.gmp ?? ""
                }
                inheritedDescription={
                  node.data.nodeType === "subprocess" ? (summarySpRef?.sp_description ?? null) : null
                }
                // 링크맵 노트 섹션 소스 — SP만 (사용자 요청 2026-08-31)
                linkedMapId={
                  node.data.nodeType === "subprocess" ? (node.data.linkedMapId ?? null) : null
                }
                versionPickerSlot={
                  node.data.nodeType === "subprocess" && node.data.linkedMapId != null ? (
                    <SubprocessVersionPicker
                      linkedMapId={node.data.linkedMapId}
                      linkedVersionId={node.data.linkedVersionId ?? null}
                      followLatest={node.data.followLatest ?? false}
                      updateAvailable={node.data.updateAvailable ?? false}
                      readOnly={readOnly}
                      onFollowLatest={(value) => handleSummaryPatch({ followLatest: value })}
                      onPinVersion={(pinId) => handleSummaryPatch({ linkedVersionId: pinId })}
                      onUpdate={handleSummaryUpdateSubprocess}
                    />
                  ) : undefined
                }
                initialFocus={summaryFocus ?? undefined}
                onPatch={handleSummaryPatch}
                onCommitLabel={handleSummaryLabelCommit}
                onNavigate={(id) => setSummaryNodeId(id)}
                onClose={() => {
                  setSummaryNodeId(null);
                  setSummaryFocus(null);
                }}
                onOpenChild={handleSummaryOpenChild}
              />
            );
          })()}
          {bulkEditGroupId && (
            <GroupBulkModal
              versionId={versionId}
              groupLabel={groups.find((g) => g.id === bulkEditGroupId)?.label ?? ""}
              members={nodes
                .filter((n) => bulkEditGroupId !== null && n.data.groupIds.includes(bulkEditGroupId))
                .map((n) => ({
                  id: n.id,
                  label: n.data.label,
                  assignee: n.data.assignee,
                  department: n.data.department,
                  system: n.data.system,
                  duration: n.data.duration,
                  touch_time: n.data.touch_time ?? "",
                  cost_krw: n.data.cost_krw ?? "",
                  cost_usd: n.data.cost_usd ?? "",
                  headcount: n.data.headcount ?? "",
                  annual_count: n.data.annual_count ?? "",
                  fte: n.data.fte ?? "",
                  input: n.data.input ?? "",
                  output: n.data.output ?? "",
                  start_condition: n.data.start_condition ?? "",
                  end_condition: n.data.end_condition ?? "",
                  nodeType: n.data.nodeType,
                }))}
              colorPresets={COLOR_PRESETS}
              onRenameGroup={(label) => renameGroup(bulkEditGroupId, label)}
              onApplyColor={(color) => applyGroupColor(bulkEditGroupId, color)}
              onApplyAttribute={(field, updates) =>
                applyGroupAttribute(field, updates)
              }
              onApplyPeople={(updates) => applyGroupPeople(updates)}
              onClose={() => setBulkEditGroupId(null)}
            />
          )}
          {/* 플로팅 AI 채팅 — ScopeWindow 재사용(드래그/리사이즈/최소화→dock/위치 영속). active=항상 상호작용. */}
          {versionId !== null && aiOpen && !(windowGeom[AI_WINDOW_KEY]?.minimized) && (
            <ScopeWindow
              title={t("ai.title")}
              geom={windowGeom[AI_WINDOW_KEY] ?? aiDefaultGeom(bounds)}
              active
              zIndex={1090}
              canClose
              canMaximize={false}
              bounds={bounds}
              onFocus={() => {}}
              onGeomChange={(next) =>
                setWindowGeom((map) => ({ ...map, [AI_WINDOW_KEY]: next }))
              }
              onClose={() => setAiOpen(false)}
              onMinimize={(clientX, clientY) => {
                // 최소화 아이콘을 현재 마우스 위치(캔버스 상대, 44px 중앙 정렬)에 배치
                const rect = canvasContainerRef.current?.getBoundingClientRect();
                if (!rect) return;
                setAiMinPos({
                  x: Math.min(Math.max(clientX - rect.left - 22, 0), Math.max(0, bounds.w - 44)),
                  y: Math.min(Math.max(clientY - rect.top - 22, 0), Math.max(0, bounds.h - 44)),
                });
              }}
              headerLeft={
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-accent text-on-accent">
                    <Sparkles size={18} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    {aiTitleEditing ? (
                      <input
                        autoFocus
                        value={aiTitle}
                        onChange={(event) => setAiTitle(event.target.value)}
                        onBlur={() => setAiTitleEditing(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") setAiTitleEditing(false);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        className="w-full rounded-xs border border-hairline px-1 py-0.5 text-caption font-semibold text-ink outline-none focus:border-accent"
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="truncate text-caption-strong text-ink">
                          {aiTitle || t("ai.title")}
                        </span>
                        <IconTip label={t("ai.renameTitle")} align="left">
                          <button
                            type="button"
                            aria-label={t("ai.renameTitle")}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setAiTitleManual(true);
                              setAiTitleEditing(true);
                            }}
                            className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-pearl hover:text-accent"
                          >
                            <Pencil size={14} strokeWidth={1.6} />
                          </button>
                        </IconTip>
                      </div>
                    )}
                    <div className="truncate text-[10px] text-ink-tertiary">
                      {mapName} · {versionSubtitle}
                    </div>
                  </div>
                </div>
              }
              headerActions={
                <div
                  className="flex items-center gap-1"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {/* 새 대화 — 아이콘만(폰트 툴과 자리 교환, 폰트 툴은 패널 대화 전환 바로) */}
                  <IconTip label={t("ai.clearChat")}>
                    <button
                      type="button"
                      data-id="ai-new-chat"
                      aria-label={t("ai.clearChat")}
                      onClick={() => aiNewChatRef.current?.()}
                      className="rounded-xs p-1 text-ink-tertiary hover:bg-surface-pearl hover:text-accent"
                    >
                      <Plus size={18} strokeWidth={1.5} />
                    </button>
                  </IconTip>
                  <IconTip label={t("ai.export")}>
                    <button
                      type="button"
                      aria-label={t("ai.export")}
                      onClick={() => showToast(t("ai.comingSoon"))}
                      className="rounded-xs p-1 text-ink-tertiary hover:bg-surface-pearl hover:text-accent"
                    >
                      <Download size={18} strokeWidth={1.5} />
                    </button>
                  </IconTip>
                </div>
              }
            >
              <AiChatPanel
                mapId={mapId}
                versionId={versionId}
                aiEnabled={aiEnabled}
                canEdit={!readOnly && (checkout?.mine ?? false)}
                initialSessionId={aiInitialSessionId}
                onInitialSessionConsumed={handleAiInitialConsumed}
                onGraphProposal={enterAiGraphPreview}
                onOpsProposal={applyAiOps}
                onHighlightNode={highlightNode}
                onToast={showToast}
                aiPreviewActive={previewSource === "ai"}
                onCommitPreview={commitAiPreview}
                onDiscardPreview={discardAiPreview}
                fontScale={aiFontScale}
                onFontScaleChange={setAiFontScale}
                onAutoTitle={handleAutoTitle}
                onRegisterNewChat={(fn) => {
                  aiNewChatRef.current = fn;
                }}
              />
            </ScopeWindow>
          )}
        </div>

        {inspectorOpen && (
          <div className="flex min-h-0 shrink-0" style={{ width: inspectorWidth }}>
            <div
              onPointerDown={startInspectorResize}
              className="w-1 shrink-0 cursor-col-resize hover:bg-accent-tint"
              title={t("editor.inspectorToggle")}
            />
            {/* 우측 4탭 인스펙터 — 속성/맵/승인/활동 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-hairline bg-surface">
              <InspectorPanel
                onCollapse={() => setInspectorOpen(false)}
                propertiesTabNonce={propertiesTabNonce}
                mapId={mapId}
                canCompare={versions.some((version) => version.status === "published")}
                selectionKind={selectedNode ? "node" : selectedEdge ? "edge" : null}
                propertiesSlot={
                  selectedNode ? (
                    // R5a NEW 노드 속성 폼 — 제목/유형(읽기전용)/색상/BPM 속성 카드 (목업 inspector-properties-node).
                    // 설명·end/subprocess 특수필드는 비교기간 OLD에 유지(후속 이관). 핸들러 재사용.
                    <div className="flex flex-col gap-3">
                      <h2 className="text-caption-strong text-ink-secondary">{t("editor.nodeEdit")}</h2>
                      <div>
                        <label className="mb-1 block text-fine text-ink-tertiary">{t("field.title")}</label>
                        <textarea
                          className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption"
                          value={selectedNode.data.label}
                          rows={Math.min(5, selectedNode.data.label.split("\n").length)}
                          // subprocess 타이틀은 링크된 맵 이름 고정 — 편집 차단 (F5)
                          disabled={readOnly || selectedNode.data.nodeType === "subprocess"}
                          onChange={(event) => updateSelectedData({ label: event.target.value }, true)}
                          onKeyDown={(event) => {
                            // Enter=포커스 해제, Alt/Shift+Enter=줄바꿈 — 캔버스 이름 편집과 동일 규칙.
                            // 제어 입력이라 상태로 삽입하고 rAF로 캐럿 복원(리렌더 후 같은 DOM 노드 유지).
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            if (!event.altKey && !event.shiftKey) {
                              event.currentTarget.blur();
                              return;
                            }
                            const el = event.currentTarget;
                            const caret = el.selectionStart + 1;
                            updateSelectedData(
                              {
                                label: `${el.value.slice(0, el.selectionStart)}\n${el.value.slice(el.selectionEnd)}`,
                              },
                              true,
                            );
                            requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                          }}
                        />
                        <NewlineHint />
                      </div>
                      {/* 설명 — 인스펙터는 읽기전용(회색, 내용만). 호버 시 편집 아이콘, 더블클릭/아이콘으로
                          편집 모달을 열어 설명에 자동 포커스 (사용자 결정 2026-08-20).
                          subprocess는 링크맵 설명(베이스)+이 맵 추가분을 줄바꿈 합성해 표시. */}
                      <div className="group/desc relative">
                        <label className="mb-1 block text-fine text-ink-tertiary">{t("field.description")}</label>
                        <div
                          data-id="inspector-description"
                          className={`min-h-[2rem] whitespace-pre-wrap rounded-sm bg-surface-alt px-2 py-1.5 text-caption text-ink-tertiary ${
                            readOnly ? "" : "cursor-text transition-colors hover:bg-surface-pearl"
                          }`}
                          onDoubleClick={() => {
                            if (readOnly) return;
                            setSummaryFocus("description");
                            setSummaryNodeId(selectedNode.id);
                          }}
                        >
                          {(selectedNode.data.nodeType === "subprocess"
                            ? mergeSubprocessDescription(
                                selectedSpRef?.sp_description,
                                selectedNode.data.description,
                              )
                            : selectedNode.data.description) || t("summary.none")}
                        </div>
                        {!readOnly && (
                          <button
                            type="button"
                            data-id="inspector-description-edit"
                            aria-label={t("field.description")}
                            className="absolute right-1 top-6 hidden rounded-sm bg-surface p-1 text-ink-tertiary shadow-sm hover:text-accent group-hover/desc:block"
                            onClick={() => {
                              setSummaryFocus("description");
                              setSummaryNodeId(selectedNode.id);
                            }}
                          >
                            <SquarePen size={13} strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                      {/* 유형·색 — 라벨 좌·필드 우측정렬·세로중앙·구분선(편집 모달과 동일) */}
                      <div className="flex flex-col divide-y divide-divider">
                        <div className="flex min-h-[34px] items-center gap-3 py-1.5">
                          <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("field.type")}</span>
                          <span className="min-w-0 flex-1 truncate text-right text-caption text-ink-secondary">
                            {t(
                              NODE_TYPE_OPTIONS.find((option) => option.value === selectedNode.data.nodeType)
                                ?.labelKey ?? "nodeType.process",
                            )}
                          </span>
                        </div>
                        {/* 색 — subprocess는 단일색 고정이라 선택 UI 숨김 (spec 2026-07-06 §9) */}
                        {selectedNode.data.nodeType !== "subprocess" && (
                        <div className="flex items-center gap-3 py-1.5">
                          <span className="w-16 shrink-0 text-fine text-ink-tertiary">{t("field.color")}</span>
                          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
                            {colorsForType(selectedNode.data.nodeType).map((preset) => (
                              <button
                                key={preset || "default"}
                                type="button"
                                title={preset || t("editor.defaultColor")}
                                aria-label={t("editor.colorAria", { name: preset || t("editor.colorDefaultName") })}
                                className={`h-6 w-6 rounded-sm border ${
                                  selectedNode.data.color === preset
                                    ? "border-transparent ring-2 ring-accent"
                                    : "border-hairline hover:ring-2 hover:ring-accent-tint-border"
                                }`}
                                style={{ backgroundColor: preset || "#ffffff" }}
                                disabled={readOnly}
                                onClick={() => updateSelectedData({ color: preset })}
                              />
                            ))}
                            {/* 커스텀 색상 — Palette 토글로 hex 직접 입력(인라인) */}
                            {!readOnly && (
                              <button
                                type="button"
                                title={t("editor.hexToggle")}
                                aria-label={t("editor.hexToggle")}
                                aria-pressed={showHexInput}
                                className={`flex h-6 w-6 items-center justify-center rounded-sm border ${
                                  showHexInput ? "border-accent text-accent" : "border-hairline text-ink-tertiary"
                                } hover:bg-surface-alt`}
                                onClick={() => setShowHexInput((value) => !value)}
                              >
                                <Palette size={14} strokeWidth={1.5} />
                              </button>
                            )}
                            {showHexInput && (
                              <input
                                key={`new-${selectedNode.id}-${selectedNode.data.color}`}
                                autoFocus
                                className="w-28 rounded-sm border border-hairline px-2 py-0.5 text-right text-fine text-ink"
                                defaultValue={selectedNode.data.color}
                                disabled={readOnly}
                                placeholder={t("editor.hexPlaceholder")}
                                onBlur={(event) => {
                                  const value = event.target.value.trim();
                                  if (value === "" || /^#[0-9a-fA-F]{6}$/.test(value)) {
                                    updateSelectedData({ color: value });
                                  }
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                            )}
                          </div>
                        </div>
                        )}
                      </div>
                      {/* BPM 속성 — process·decision만 표시. start/end/subprocess는 숨김.
                          아코디언(기본 접힘) — 수행 지표·입출력 조건과 동일 패턴 (사용자 결정 2026-08-20) */}
                      {hasBpmAttributes(selectedNode.data.nodeType) && (() => {
                        // 채움 카운트 — 헤더 배지·읽기전용 빈 섹션 딤(#3) 공용, gmp 포함 (사용자 요청 2026-08-21)
                        const attrsFilled = [
                          selectedNode.data.assignee,
                          selectedNode.data.department,
                          selectedNode.data.system,
                          selectedNode.data.url,
                          selectedNode.data.gmp,
                        ].filter((v) => (v ?? "") !== "").length;
                        return (
                        <div className={`rounded-md border border-hairline p-3 ${readOnly && attrsFilled === 0 ? "opacity-50" : ""}`}>
                          <button
                            type="button"
                            data-id="inspector-attrs-toggle"
                            data-acc-toggle
                            aria-expanded={!attrsCollapsed}
                            className="flex w-full items-center gap-1 text-fine font-semibold text-ink"
                            onClick={() => {
                              const next = !attrsCollapsed;
                              setAttrsCollapsed(next);
                              writeAttrsCollapsed(next);
                            }}
                          >
                            <ChevronRight
                              size={12}
                              strokeWidth={1.5}
                              className={`transition-transform duration-150 ${attrsCollapsed ? "" : "rotate-90"}`}
                            />
                            {t("editor.bpmAttrs")}
                            {attrsFilled > 0 && (
                              <span className="font-normal text-ink-tertiary">({attrsFilled})</span>
                            )}
                          </button>
                          {!attrsCollapsed && (
                          <div className="ml-2 border-l border-divider pl-2">
                          {/* 담당자·부서는 자격 직원/부서에서 선택(피커). 시스템·소요시간은 자유 입력 */}
                          <BpmAttributePicker
                            versionId={versionId}
                            assignee={selectedNode.data.assignee}
                            department={selectedNode.data.department}
                            readOnly={readOnly}
                            onChange={(patch) => updateSelectedData(patch, true)}
                          />
                          {([
                            ["system", "field.system"],
                          ] as const).map(([key, labelKey]) => (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-2 py-1"
                            >
                              <span className="shrink-0 text-caption text-ink-secondary">{t(labelKey)}</span>
                              <input
                                data-id={`inspector-field-${key}`}
                                className={`truncate rounded-sm px-1.5 py-0.5 text-right text-caption text-ink focus:outline-none ${
                                  readOnly
                                    ? "min-w-0 flex-1 bg-transparent"
                                    : "w-32 min-w-0 border border-hairline bg-surface-alt focus:border-accent"
                                }`}
                                value={selectedNode.data[key] ?? ""}
                                disabled={readOnly}
                                title={selectedNode.data[key] || undefined}
                                onChange={(event) => updateSelectedData({ [key]: event.target.value }, true)}
                              />
                              {/* 시스템 원문 폴백 힌트 — 라이브러리화 전 검토 원천 (design 2026-08-19 §5.2) */}
                              {key === "system" && (
                                <FallbackHint
                                  dataId="inspector-system-hint"
                                  fallback={selectedNode.data.system_fallback}
                                  onSaveFallback={
                                    readOnly
                                      ? undefined
                                      : (text) => updateSelectedData({ system_fallback: text }, true)
                                  }
                                  onApply={
                                    readOnly
                                      ? undefined
                                      : () =>
                                          updateSelectedData(
                                            { system: (selectedNode.data.system_fallback ?? "").slice(0, 100) },
                                            true,
                                          )
                                  }
                                />
                              )}
                            </div>
                          ))}
                          {/* GMP 분류 — 캔버스 필과 동일 픽커 재사용, 읽기전용은 배지만 (사용자 요청 2026-08-21 #5) */}
                          <div className="flex items-center justify-between gap-2 py-1">
                            <span className="shrink-0 text-caption text-ink-secondary">{t("field.gmp")}</span>
                            {readOnly ? (
                              (selectedNode.data.gmp ?? "") !== "" ? (
                                <span
                                  data-id="inspector-field-gmp"
                                  className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine"
                                  style={getGmpBadgeStyle(selectedNode.data.gmp)}
                                >
                                  {formatGmp(selectedNode.data.gmp)}
                                </span>
                              ) : (
                                <span data-id="inspector-field-gmp" className="text-caption text-ink-tertiary">-</span>
                              )
                            ) : (
                              <button
                                type="button"
                                data-id="inspector-field-gmp"
                                className="rounded-sm px-1 py-0.5 hover:bg-surface-alt"
                                onClick={(event) => openGmpPicker(selectedNode.id, event.clientX, event.clientY)}
                              >
                                {(selectedNode.data.gmp ?? "") !== "" ? (
                                  <span
                                    className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-fine"
                                    style={getGmpBadgeStyle(selectedNode.data.gmp)}
                                  >
                                    {formatGmp(selectedNode.data.gmp)}
                                  </span>
                                ) : (
                                  <span className="text-caption text-ink-tertiary">
                                    {t("perm.processFields.gmpUnset")}
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                          <UrlLabelField
                            key={selectedNode.id}
                            url={selectedNode.data.url ?? ""}
                            urlLabel={selectedNode.data.urlLabel ?? ""}
                            readOnly={readOnly}
                            onChange={(patch) => updateSelectedData(patch, true)}
                          />
                          </div>
                          )}
                        </div>
                        );
                      })()}
                      {/* end 노드 — 대표 엔드: 체크박스 대신 토글 스위치 */}
                      {selectedNode.data.nodeType === "end" && (
                        <div className="flex items-center justify-between">
                          <span className="text-caption text-ink-secondary">{t("node.primaryEnd")}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={selectedNode.data.isPrimaryEnd ?? false}
                            aria-label={t("node.primaryEnd")}
                            disabled={readOnly}
                            onClick={() =>
                              updateSelectedData(
                                { isPrimaryEnd: !(selectedNode.data.isPrimaryEnd ?? false) },
                                true,
                              )
                            }
                            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                              selectedNode.data.isPrimaryEnd ? "bg-accent" : "bg-border-strong"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-3 w-3 rounded-full bg-surface transition-all ${
                                selectedNode.data.isPrimaryEnd ? "left-3.5" : "left-0.5"
                              }`}
                            />
                          </button>
                        </div>
                      )}
                      {/* subprocess — 지정 어트리뷰트(라이브 참조, 읽기전용). 수정은 링크 대상 맵 설정의 지정 모달에서만.
                          회당 파라미터 4종은 아래 Parameters 카드에서 같이 표시(중복 방지) */}
                      {selectedNode.data.nodeType === "subprocess" && selectedSpRef?.designated && (
                        <div data-id="inspector-subprocess-attrs" className="rounded-md border border-hairline p-3">
                          <button
                            type="button"
                            data-id="inspector-sp-attrs-toggle"
                            data-acc-toggle
                            aria-expanded={!attrsCollapsed}
                            className="flex w-full items-center gap-1 text-fine font-semibold text-ink"
                            onClick={() => {
                              const next = !attrsCollapsed;
                              setAttrsCollapsed(next);
                              writeAttrsCollapsed(next);
                            }}
                          >
                            <ChevronRight
                              size={12}
                              strokeWidth={1.5}
                              className={`transition-transform duration-150 ${attrsCollapsed ? "" : "rotate-90"}`}
                            />
                            {t("editor.bpmAttrs")}
                            {(() => {
                              const filled = [
                                selectedSpRef.department,
                                selectedSpRef.assignee,
                                selectedSpRef.system,
                                selectedSpRef.url,
                              ].filter((v) => (v ?? "") !== "").length;
                              return filled > 0 ? (
                                <span className="font-normal text-ink-tertiary">({filled})</span>
                              ) : null;
                            })()}
                          </button>
                          {!attrsCollapsed && (
                          <div className="ml-2 border-l border-divider pl-2">
                          {([
                            ["department", "field.department"],
                            ["assignee", "field.assignee"],
                            ["system", "field.system"],
                          ] as const).map(([key, labelKey]) => {
                            const value = selectedSpRef[key];
                            return (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-2 border-t border-divider py-1"
                              >
                                <span className="shrink-0 text-caption text-ink-secondary">{t(labelKey)}</span>
                                <span
                                  className="min-w-0 truncate text-right text-caption text-ink"
                                  title={value || undefined}
                                >
                                  {value || "-"}
                                </span>
                              </div>
                            );
                          })}
                          <div className="flex items-center justify-between gap-2 border-t border-divider py-1">
                            <span className="shrink-0 text-caption text-ink-secondary">{t("field.url")}</span>
                            <span
                              className="min-w-0 truncate text-right text-caption text-ink"
                              title={selectedSpRef.url || undefined}
                            >
                              {selectedSpRef.url_label || selectedSpRef.url || "-"}
                            </span>
                          </div>
                          <p className="mt-1.5 text-fine text-ink-tertiary">{t("subprocess.attrsFromOwner")}</p>
                          </div>
                          )}
                        </div>
                      )}
                      {/* 회당 파라미터 — 접기 카드(레이지 세이브·비용 통화 토글). start/end 외 모든 타입에 표시.
                          subprocess는 회당 4필드가 링크 맵 지정값이라 읽기전용 텍스트, 연간 건수·FTE만 입력 (design §3.1) */}
                      {editableParams.length > 0 && (
                        <NodeMetricsCard
                          key={`metrics-${selectedNode.id}`}
                          nodeType={selectedNode.data.nodeType}
                          values={{
                            duration: selectedNode.data.duration ?? "",
                            touch_time: selectedNode.data.touch_time ?? "",
                            cost_krw: selectedNode.data.cost_krw ?? "",
                            cost_usd: selectedNode.data.cost_usd ?? "",
                            headcount: selectedNode.data.headcount ?? "",
                            annual_count: selectedNode.data.annual_count ?? "",
                            fte: selectedNode.data.fte ?? "",
                          }}
                          editableParams={editableParams}
                          inheritedDisplay={inheritedParamDisplay}
                          frequencyFallback={selectedSpRef?.frequency_fallback}
                          readOnly={readOnly}
                          onSave={(patch) => updateSelectedData(patch, true)}
                        />
                      )}
                      {/* 인터뷰 승격 상세 — IO(개행 복수)·자료 형식·시작/종료 조건. 레이지 세이브 카드.
                          subprocess는 링크 맵 sp_* 값을 read-only 상속 렌더 (design 2026-08-19 §5.1) */}
                      {(selectedNode.data.nodeType === "process" ||
                        selectedNode.data.nodeType === "decision" ||
                        selectedNode.data.nodeType === "subprocess") && (
                        <NodeDetailsCard
                          key={`details-${selectedNode.id}`}
                          nodeKey={selectedNode.id}
                          isSubprocess={selectedNode.data.nodeType === "subprocess"}
                          values={{
                            input: selectedNode.data.input ?? "",
                            output: selectedNode.data.output ?? "",
                            input_forms: selectedNode.data.input_forms ?? "",
                            output_forms: selectedNode.data.output_forms ?? "",
                            output_ids: selectedNode.data.output_ids ?? "",
                            input_links: selectedNode.data.input_links ?? "",
                            output_links: selectedNode.data.output_links ?? "",
                            input_flags: selectedNode.data.input_flags ?? "",
                            data_form: selectedNode.data.data_form ?? "",
                            start_condition: selectedNode.data.start_condition ?? "",
                            end_condition: selectedNode.data.end_condition ?? "",
                          }}
                          io={{
                            originGroupIndexes: ioOriginGroupIndexes,
                            brokenInputIndexes: ioBrokenInputIndexes,
                            onImport: (side, at) =>
                              setIoImport({ side, nodeId: selectedNode.id, at }),
                            onNavigate: handleIoNavigate,
                            onHoverItem: handleIoHoverItem,
                            onPeersMenu: handleIoPeersMenu,
                            spLinkedInputIndexes: ioSpLinkedInputIndexes,
                            spLinkedOutputIndexes: ioSpLinkedOutputIndexes,
                          }}
                          sp={selectedSpRef}
                          readOnly={readOnly}
                          onSave={(patch) => updateSelectedData(patch, true)}
                        />
                      )}
                      {/* subprocess 노드 — 연결 버전 선택(최신 추종 토글 + 버전 고정 + 업데이트) */}
                      {selectedNode.data.nodeType === "subprocess" &&
                        selectedNode.data.linkedMapId != null && (
                          <SubprocessVersionPicker
                            linkedMapId={selectedNode.data.linkedMapId}
                            linkedVersionId={selectedNode.data.linkedVersionId ?? null}
                            followLatest={selectedNode.data.followLatest ?? false}
                            updateAvailable={selectedNode.data.updateAvailable ?? false}
                            readOnly={readOnly}
                            onFollowLatest={(value) => updateSelectedData({ followLatest: value }, false)}
                            onPinVersion={(versionId) => updateSelectedData({ linkedVersionId: versionId }, false)}
                            onUpdate={() => handleUpdateSubprocess(selectedNode.id)}
                          />
                        )}
                      {/* 미지정 링크 — 등록 요청 CTA/Requested 배지 (spec 2026-07-19). key로 링크 전환 시 리셋 */}
                      {selectedNode.data.nodeType === "subprocess" &&
                        selectedNode.data.linkedMapId != null &&
                        selectedSpRef != null &&
                        !selectedSpRef.designated && (
                          <SubprocessRegistrationCta
                            key={selectedNode.data.linkedMapId}
                            linkedMapId={selectedNode.data.linkedMapId}
                            fromMapId={mapId}
                            onToast={showToast}
                          />
                        )}
                      {/* 코멘트 — 노드별, 하단 배치(읽기전용에서도 작성 가능). 활동 탭 통합은 R5d */}
                      <details open data-acc className="rounded-md border border-hairline px-3 py-2">
                        <summary className="cursor-pointer text-fine font-semibold text-ink">
                          {t("editor.comments")}
                          {selectedComments.some((comment) => !comment.resolved) &&
                            ` (${t("editor.unresolvedCount", { n: selectedComments.filter((comment) => !comment.resolved).length })})`}
                        </summary>
                        <div className="mt-2">
                          <CommentSection
                            comments={selectedComments}
                            onAdd={(body) => void handleAddComment(body)}
                            onToggleResolved={(comment) => void handleToggleComment(comment)}
                            onDelete={(comment) => void handleDeleteComment(comment)}
                            currentUser={username}
                          />
                        </div>
                      </details>
                    </div>
                  ) : selectedEdge ? (
                    // R5a NEW 엣지 속성 폼 — 소스→타겟·분기 라벨(Yes/No/기타)·라벨·연결 스타일·삭제 (목업 inspector-properties-edge).
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <h2 className="flex items-center gap-1.5 text-caption-strong text-ink-secondary">
                          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent-tint text-accent">
                            <ArrowRight size={14} strokeWidth={1.5} />
                          </span>
                          {t("inspector.edgeEdit")}
                        </h2>
                        <button
                          type="button"
                          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                          onClick={() => setSelectedEdgeId(null)}
                          aria-label={t("action.close")}
                        >
                          <X size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {nodes.find((node) => node.id === selectedEdge.source)?.data.label || "-"}
                        </span>
                        <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                        <span className="min-w-0 flex-1 truncate text-right font-medium">
                          {nodes.find((node) => node.id === selectedEdge.target)?.data.label || "-"}
                        </span>
                      </div>
                      {/* 연결면 — 엣지 우클릭 메뉴의 EdgeSidesPad 재사용, 편집 모드에서만 (2026-07-30) */}
                      {!readOnly && (
                        <div>
                          <label className="mb-1 block text-fine text-ink-tertiary">{t("edge.connection")}</label>
                          <div className="rounded-sm border border-hairline py-1">
                            <EdgeSidesPad
                              item={{
                                sourceLabel: t("edge.startBox"),
                                targetLabel: t("edge.endBox"),
                                sourceSide: sideFromHandleId(selectedEdge.sourceHandle, "right"),
                                targetSide: sideFromHandleId(selectedEdge.targetHandle, "left"),
                                // 하위프로세스 끝점은 전용 핸들 고정 — 컨텍스트 메뉴와 동일 잠금
                                sourceLocked:
                                  nodes.find((n) => n.id === selectedEdge.source)?.data.nodeType ===
                                  "subprocess",
                                targetLocked:
                                  nodes.find((n) => n.id === selectedEdge.target)?.data.nodeType ===
                                  "subprocess",
                                onPickSource: (side: HandleSide) =>
                                  setEdgeSide(selectedEdge.id, "source", side),
                                onPickTarget: (side: HandleSide) =>
                                  setEdgeSide(selectedEdge.id, "target", side),
                              }}
                            />
                          </div>
                        </div>
                      )}
                      {selectedEdgeBranch !== null && (
                        <div>
                          <label className="mb-1 block text-fine text-ink-tertiary">{t("inspector.branchLabel")}</label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {([
                              ["yes", BRANCH_YES_LABEL],
                              ["no", BRANCH_NO_LABEL],
                              ["other", t("inspector.branchOther")],
                            ] as const).map(([kind, label]) => (
                              <button
                                key={kind}
                                type="button"
                                disabled={readOnly}
                                onClick={() => setSelectedEdgeBranch(kind)}
                                className={`flex flex-col items-center justify-center gap-1 rounded-sm border px-2 py-2 text-caption transition-colors ${
                                  selectedEdgeBranch === kind
                                    ? "border-accent bg-accent-tint text-accent"
                                    : "border-hairline text-ink hover:bg-surface-alt"
                                }`}
                              >
                                <BranchGlyph kind={kind} size={20} />
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-fine text-ink-tertiary">{t("inspector.label")}</label>
                        <textarea
                          className="w-full resize-none rounded-sm border border-hairline px-2 py-1.5 text-caption"
                          value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
                          rows={Math.min(
                            5,
                            (typeof selectedEdge.label === "string" ? selectedEdge.label : "").split("\n")
                              .length,
                          )}
                          disabled={readOnly}
                          onChange={(event) => updateSelectedEdgeLabel(event.target.value)}
                          onKeyDown={(event) => {
                            // Enter=포커스 해제, Alt/Shift+Enter=줄바꿈 — 노드 이름 편집과 동일 규칙.
                            // 제어 입력이라 상태로 삽입하고 rAF로 캐럿 복원.
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            if (!event.altKey && !event.shiftKey) {
                              event.currentTarget.blur();
                              return;
                            }
                            const el = event.currentTarget;
                            const caret = el.selectionStart + 1;
                            updateSelectedEdgeLabel(
                              `${el.value.slice(0, el.selectionStart)}\n${el.value.slice(el.selectionEnd)}`,
                            );
                            requestAnimationFrame(() => el.setSelectionRange(caret, caret));
                          }}
                        />
                        <NewlineHint />
                      </div>
                      <div>
                        <label className="mb-1 block text-fine text-ink-tertiary">{t("inspector.connStyle")}</label>
                        <div className="grid grid-cols-3 gap-1.5" data-id="inspector-edge-line-style">
                          {EDGE_LINE_STYLE_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                            <button
                              key={value}
                              type="button"
                              disabled={readOnly}
                              title={t(labelKey)}
                              aria-label={t(labelKey)}
                              data-id={`inspector-edge-line-style-${value}`}
                              onClick={() => setEdgeLineStyle(selectedEdge.id, value)}
                              className={`flex items-center justify-center rounded-sm border py-2 ${
                                normalizeEdgeLineStyle(selectedEdge.type) === value
                                  ? "border-accent bg-accent-tint text-accent"
                                  : "border-hairline text-ink-secondary hover:bg-surface-alt"
                              }`}
                            >
                              <Icon size={18} strokeWidth={1.5} />
                            </button>
                          ))}
                        </div>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-error/40 px-2 py-2 text-caption text-error hover:bg-error/10"
                          onClick={() => void reactFlow.deleteElements({ edges: [{ id: selectedEdge.id }] })}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                          {t("inspector.deleteEdge")}
                        </button>
                      )}
                    </div>
                  ) : null
                }
                subprocessSlot={
                  // L5 연계 캔버스는 SP 지정 불가(서버 422, design 2026-08-28 §9) — 카드 자체를 숨겨 혼동 차단
                  isFrameworkMap ? undefined : (
                    <SubprocessInspectorCard
                      mapId={mapId}
                      canManage={spCanManage}
                      disabledReason={spDisabledReason}
                      disabledReasonKind={spDisabledReasonKind}
                      onToast={showToast}
                      onDesignationChange={() => setSpUsageReload((n) => n + 1)}
                      onGoToPublished={(id) => void switchVersion(id)}
                      usage={spUsage}
                    />
                  )
                }
                ownershipSlot={
                  // 속성 빈상태 — 오우닝 부서·오너·승인자 표시(맵 요약 위, 2026-08-27)
                  <MapOwnershipSection
                    owningDept={mapOwningDept}
                    ownerId={mapOwner}
                    approvers={workflow?.approvers ?? []}
                  />
                }
                nodeDisplaySlot={
                  // 속성 탭 빈상태(맵 요약 아래) — 맵 탭과 동일 토글 킷 (사용자 결정 2026-08-20)
                  <NodeDisplaySection
                    idPrefix="properties"
                    displayFields={displayFields}
                    onToggle={toggleDisplayField}
                    onSetCategory={setCategoryDisplayFields}
                  />
                }
                subprocessTabSlot={
                  // 지정된 맵에서만 탭 노출 — 지정 메타(버전·시점·행위자) + 역참조 목록
                  spUsage?.designated ? <SubprocessUsageTab usage={spUsage} /> : undefined
                }
                mapTabSlot={
                  // R5b/R6 W1 맵 탭 — 버전 선택(승인 탭에서 이동) + 가시성·소유자·협업자·설명(narrow)
                  // + 노드 표시 토글(접힘) + 엣지 스타일(접힘, 아이콘) + PNG
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      {/* 버전 필(전환) — 맵 탭 최상단으로 이동 (R6 W1, 승인 탭에서 옮김) */}
                      <VersionPill
                        versions={versions}
                        versionId={versionId}
                        isEditing={!readOnly}
                        onSwitch={(id) => void switchVersion(id)}
                        compact
                      />
                      {/* 버전 관리 — 역할/상태 매트릭스 우측 정렬 아이콘 (§6.2) */}
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        {/* 버전 비교 — 액션 최좌측(사용자 요청 2026-08-25). 게시본 없으면 비활성(하단 CTA와 동일 게이트) */}
                        <Tooltip
                          label={
                            versions.some((version) => version.status === "published")
                              ? t("inspector.compareVersions")
                              : t("inspector.compareNeedsPublished")
                          }
                        >
                          <button
                            type="button"
                            data-id="map-tab-compare"
                            className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary"
                            disabled={!versions.some((version) => version.status === "published")}
                            onClick={() => router.push(`/maps/${mapId}/compare`)}
                            aria-label={t("inspector.compareVersions")}
                          >
                            <GitCompare size={16} strokeWidth={1.5} />
                          </button>
                        </Tooltip>
                        {/* 새 버전 — editor+ 이고 진행 중 draft 없을 때만 (맵당 draft 1개 규약) */}
                        {isEditorRole && !hasDraft && (
                          <Tooltip label={t("editor.newVersion")}>
                            <button
                              type="button"
                              className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                              onClick={handleCreateVersion}
                              aria-label={t("editor.newVersion")}
                            >
                              <Plus size={16} strokeWidth={1.5} />
                            </button>
                          </Tooltip>
                        )}

                        {/* 점유자 + draft: 이전·이름변경·삭제 */}
                        {isHolder && (
                          <>
                            <Tooltip label={t("approval.checkoutTransfer")}>
                              <button
                                type="button"
                                className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                                onClick={() => void handleTransferOpen()}
                                aria-label={t("approval.checkoutTransfer")}
                              >
                                <ArrowLeftRight size={16} strokeWidth={1.5} />
                              </button>
                            </Tooltip>
                            <Tooltip label={t("editor.rename")}>
                              <button
                                type="button"
                                className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                                onClick={handleRenameVersion}
                                aria-label={t("editor.rename")}
                              >
                                <PencilLine size={16} strokeWidth={1.5} />
                              </button>
                            </Tooltip>
                            <Tooltip label={t("editor.deleteVersion")}>
                              <button
                                type="button"
                                className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary"
                                onClick={handleDeleteVersion}
                                disabled={versions.length <= 1}
                                aria-label={t("editor.deleteVersion")}
                              >
                                <Trash2 size={16} strokeWidth={1.5} />
                              </button>
                            </Tooltip>
                          </>
                        )}

                        {/* editor + 미점유 + draft: 편집권한 요청 + 편집 중 텍스트 */}
                        {!isHolder && isEditorRole && currentVersion?.status === "draft" && (
                          <>
                            {workflow?.pending_checkout_requests?.some(
                              (r) => r.requested_by === username,
                            ) ? (
                              <button
                                type="button"
                                className="inline-flex cursor-default items-center gap-1 rounded-sm p-1.5 text-ink-tertiary opacity-50"
                                disabled
                                aria-label={t("approval.checkoutRequested")}
                              >
                                <Hand size={16} strokeWidth={1.5} />
                                <span className="text-fine">{t("approval.checkoutRequested")}</span>
                              </button>
                            ) : (
                              <Tooltip label={t("approval.checkoutRequest")}>
                                <button
                                  type="button"
                                  className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                                  onClick={() => void handleRequestCheckout()}
                                  aria-label={t("approval.checkoutRequest")}
                                >
                                  <Hand size={16} strokeWidth={1.5} />
                                </button>
                              </Tooltip>
                            )}
                            {workflow?.checkout_holder && (
                              <span className="ml-1 text-fine text-ink-tertiary">
                                {nameById.get(workflow.checkout_holder) ?? workflow.checkout_holder}{" "}
                                {t("approval.checkoutEditing")}
                              </span>
                            )}
                          </>
                        )}

                        {/* editor + expired + draft 없음: 재게시 */}
                        {isEditorRole && currentVersion?.status === "expired" && !hasDraft && (
                          <Tooltip label={t("approval.checkoutRepublish")}>
                            <button
                              type="button"
                              className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt hover:text-accent"
                              onClick={() => setRepublishConfirmOpen(true)}
                              aria-label={t("approval.checkoutRepublish")}
                            >
                              <RotateCcw size={16} strokeWidth={1.5} />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    <MapInspectorTab mapId={mapId} readOnly={readOnly} />
                    <NodeDisplaySection
                      idPrefix="inspector"
                      displayFields={displayFields}
                      onToggle={toggleDisplayField}
                      onSetCategory={setCategoryDisplayFields}
                    />
                    <div data-id="inspector-edge-style-section" className="rounded-md border border-hairline p-3">
                      <button
                        type="button"
                        data-acc-toggle
                        aria-expanded={edgeStyleSectionOpen}
                        onClick={() => {
                          if (edgeStyleSectionOpen) beginInspectorClose("edgeStyle");
                          else cancelInspectorClose("edgeStyle");
                          setEdgeStyleSectionOpen((v) => !v);
                        }}
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        <ChevronRight
                          size={14}
                          strokeWidth={1.5}
                          className={`shrink-0 transition-transform ${edgeStyleSectionOpen ? "rotate-90" : ""}`}
                        />
                        <span className="text-fine text-ink-tertiary">
                          <span className="font-semibold text-ink">{t("inspector.edgeStyle")}</span> ·{" "}
                          {t("inspector.mapWide")}
                        </span>
                      </button>
                      {(edgeStyleSectionOpen || inspectorClosingKeys.has("edgeStyle")) && (
                        <div className={inspectorClosingKeys.has("edgeStyle") ? "accordion-close" : "accordion-open"}>
                          <div className="mt-1 grid grid-cols-3 gap-1.5">
                            {EDGE_LINE_STYLE_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
                              <button
                                key={value}
                                type="button"
                                disabled={readOnly}
                                title={t(labelKey)}
                                aria-label={t(labelKey)}
                                data-id={`inspector-edge-style-all-${value}`}
                                onClick={() => setBulkEdgeStyle(value)}
                                className={`flex items-center justify-center rounded-sm border py-2 ${
                                  edgeStyle === value
                                    ? "border-accent bg-accent-tint text-accent"
                                    : "border-hairline text-ink-secondary hover:bg-surface-alt"
                                }`}
                              >
                                <Icon size={18} strokeWidth={1.5} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* 서브프로세스 지정 — 다른 맵 연결 절차(임베드) 상태/설정. 엣지 스타일 아래 배치 (batch2 ⑨) */}
                    <SubprocessInspectorCard
                      mapId={mapId}
                      canManage={spCanManage}
                      disabledReason={spDisabledReason}
                      disabledReasonKind={spDisabledReasonKind}
                      onToast={showToast}
                      onDesignationChange={() => setSpUsageReload((n) => n + 1)}
                      onGoToPublished={(id) => void switchVersion(id)}
                      usage={spUsage}
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        data-id="export-png"
                        onClick={() => void handleExportPng()}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
                      >
                        <Download size={16} strokeWidth={1.5} />
                        {t("inspector.exportPng")}
                      </button>
                      <button
                        type="button"
                        data-id="export-excel"
                        onClick={() => setExcelExportOpen(true)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
                      >
                        <FileSpreadsheet size={16} strokeWidth={1.5} />
                        {t("inspector.exportExcel")}
                      </button>
                      <button
                        type="button"
                        data-id="export-csv"
                        onClick={handleExportCsv}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
                      >
                        <FileDown size={16} strokeWidth={1.5} />
                        {t("inspector.exportCsv")}
                      </button>
                    </div>
                    {isWordMap && (
                      <>
                        <button
                          type="button"
                          data-id="inspector-generate-complete-doc"
                          onClick={() => completeDocPickerRef.current?.click()}
                          className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
                          title="Pick the original SOP .docx - injects section bookmarks and appends the flowchart page."
                        >
                          <FileText size={16} strokeWidth={1.5} />
                          Generate complete document
                        </button>
                        <button
                          type="button"
                          data-id="inspector-export-word"
                          onClick={handleExportWord}
                          className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-hairline px-3 py-2 text-caption font-medium text-ink-secondary hover:bg-surface-alt"
                        >
                          <FileText size={16} strokeWidth={1.5} />
                          {t("inspector.exportWord")}
                        </button>
                        <input
                          ref={completeDocPickerRef}
                          type="file"
                          accept=".docx"
                          className="hidden"
                          onChange={handleCompleteDocPicked}
                        />
                      </>
                    )}
                  </div>
                }
                approvalSlot={
                  // R5c 승인 탭. 버전 pill + 관리 아이콘은 맵 탭 최상단으로 이동(R6 W1)
                  // R6 W2: 결재 대기를 최상단으로 재배치·드래프트 CTA 신설(옛 버전 행 자리)·워크플로는 접힘 섹션(기본 펼침)으로 래핑
                  <div className="flex flex-col gap-4">
                    {/* 결재 대기 섹션 — 설정 화면 C2와 동일 패널 재사용, 최상단·기본 접힘 (R8, R6 W2 재배치) */}
                    <div data-id="editor-approvals-section" className="rounded-md border border-hairline px-3 py-2">
                      <button
                        type="button"
                        data-acc-toggle
                        aria-expanded={editorApprovalsSectionOpen}
                        onClick={() => {
                          if (editorApprovalsSectionOpen) beginInspectorClose("editorApprovals");
                          else cancelInspectorClose("editorApprovals");
                          setEditorApprovalsSectionOpen((v) => !v);
                        }}
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        <ChevronRight
                          size={12}
                          strokeWidth={1.5}
                          className={`shrink-0 transition-transform ${editorApprovalsSectionOpen ? "rotate-90" : ""}`}
                        />
                        <span className="text-fine font-semibold text-ink">{t("perm.tabPendingApprovals")}</span>
                        {editorApprovalsCount > 0 && (
                          <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1 text-fine text-on-accent">
                            {editorApprovalsCount}
                          </span>
                        )}
                      </button>
                      {/* 항상 마운트 — PendingApprovalsPanel의 마운트 fetch가 배지(editorApprovalsCount)의
                          유일한 소스라 접힌 채로 언마운트하면 배지가 0에서 멈춘다. 완전히 닫힌 상태는
                          display:none(hidden)로 마운트만 유지, 접히는 중엔 accordion-close 고스트 애니 재생. */}
                      <div
                        className={
                          editorApprovalsSectionOpen
                            ? "accordion-open"
                            : inspectorClosingKeys.has("editorApprovals")
                              ? "accordion-close"
                              : "hidden"
                        }
                      >
                        <div className="mt-2">
                          <PendingApprovalsPanel
                            mapId={String(mapId)}
                            isOwner={myRole === "owner"}
                            isApprover={isApprover || isSysadmin}
                            onCountChange={setEditorApprovalsCount}
                            onDecided={() => void refreshWorkflow()}
                            onToast={(item) => showToast(item.message, item.tone)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 드래프트 CTA — 옛 버전 행 자리, editor+ 전용·현재가 draft가 아닐 때만 (R6 W2) */}
                    {currentVersion && isEditorRole && currentVersion.status !== "draft" && (
                      <button
                        type="button"
                        data-id="approval-draft-cta"
                        className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-accent bg-accent-tint/40 px-3 py-2 text-caption text-accent hover:bg-accent-tint"
                        onClick={() => {
                          if (hasDraft) {
                            const draft = versions.find((v) => v.status === "draft");
                            if (draft) void switchVersion(draft.id);
                          } else {
                            handleCreateVersion();
                          }
                        }}
                      >
                        {hasDraft ? (
                          <>
                            <PencilLine size={14} strokeWidth={1.5} />
                            {t("approval.goDraftCta")}
                          </>
                        ) : (
                          <>
                            <Plus size={14} strokeWidth={1.5} />
                            {t("approval.createDraftCta")}
                          </>
                        )}
                      </button>
                    )}

                    {/* 연계 캔버스 — 승인 워크플로 대신 본인 확정 섹션 (design 2026-08-28 §6) */}
                    {currentVersion && isFrameworkMap && (
                      <div data-id="framework-confirm-box" className="rounded-md border border-hairline">
                        <FrameworkConfirmSection
                          mapId={mapId}
                          canConfirm={myRole === "editor" || myRole === "owner"}
                          versions={versions}
                          liveNodes={nodes}
                          liveEdges={edges}
                          onConfirmed={(result) => {
                            showToast(
                              result.pruned_labels.length > 0
                                ? t("framework.confirmedPrunedToast", {
                                    label: result.version.label,
                                    pruned: result.pruned_labels.join(", "),
                                  })
                                : t("framework.confirmedToast", { label: result.version.label }),
                            );
                            // 스냅샷 목록 갱신 — VersionDetail(events 포함) 형이라 재조회로 동기화
                            void getMap(mapId).then((detail) => setVersions(detail.versions));
                          }}
                          onError={(message) => showToast(message, "error")}
                        />
                      </div>
                    )}
                    {/* 승인 워크플로 — 접힘 섹션(기본 펼침, 탭의 본론), 내부 ApprovalPanel은 무변경(래핑만) (R6 W2) */}
                    {currentVersion && !isFrameworkMap && (
                      <div data-id="approval-workflow-section" className="rounded-md border border-hairline p-3">
                        <button
                          type="button"
                          data-acc-toggle
                          aria-expanded={approvalWorkflowSectionOpen}
                          onClick={() => {
                            if (approvalWorkflowSectionOpen) beginInspectorClose("approvalWorkflow");
                            else cancelInspectorClose("approvalWorkflow");
                            setApprovalWorkflowSectionOpen((v) => !v);
                          }}
                          className="flex w-full items-center gap-1.5 text-left"
                        >
                          <ChevronRight
                            size={14}
                            strokeWidth={1.5}
                            className={`shrink-0 transition-transform ${approvalWorkflowSectionOpen ? "rotate-90" : ""}`}
                          />
                          <span className="text-fine font-semibold text-ink">{t("approval.workflowSection")}</span>
                          {/* 상태 배지 — 접힌 상태에서도 한눈에 보이도록 헤더 행에 (R6 W2 리뷰 수정) */}
                          <span className="ml-auto">
                            <StatusBadge status={currentVersion.status} />
                          </span>
                        </button>
                        {(approvalWorkflowSectionOpen || inspectorClosingKeys.has("approvalWorkflow")) && (
                          <div className={inspectorClosingKeys.has("approvalWorkflow") ? "accordion-close" : "accordion-open"}>
                            <div className="mt-2">
                              <ApprovalPanel
                                status={currentVersion.status}
                                workflow={workflow}
                                events={currentVersion.events}
                                isCheckoutHolder={checkout?.mine ?? false}
                                isApprover={isApprover}
                                isSubmitter={isSubmitter}
                                canWithdraw={canWithdraw}
                                hasApproved={hasApproved}
                                canManageApprovers={(isMapOwner || isSysadmin) && !approvalInFlight}
                                onSubmit={(at) => void handleSubmitForApproval(at)}
                                onApprove={() => {
                                  setTransitionComment("");
                                  setApproveConfirmOpen(true);
                                }}
                                onReject={() => setRejectOpen(true)}
                                onPublish={() => {
                                  setTransitionComment("");
                                  setPublishConfirmOpen(true);
                                }}
                                onWithdraw={() => {
                                  setTransitionComment("");
                                  setWithdrawConfirmOpen(true);
                                }}
                                onManageApprovers={() => setManagingApprovers(true)}
                                username={username}
                                canDecideCheckout={isHolder || myRole === "owner" || isSysadmin}
                                onDecideCheckout={(requestId, approve) =>
                                  void handleDecideCheckout(requestId, approve)
                                }
                                onWithdrawCheckout={(requestId) => void handleWithdrawCheckout(requestId)}
                                hideHeader
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {/* 게시본 대비 변경 요약 — 승인 워크플로(승인자) 아래, 접힘 1줄→펼침 상세 (2026-08-30 #3) */}
                    {currentVersion && !isFrameworkMap && latestPublishedBase !== null && (
                      <ChangeSummarySection
                        baseVersionId={latestPublishedBase.id}
                        baseLabel={formatVersionMarker(latestPublishedBase, versions)}
                        liveNodes={nodes}
                        liveEdges={edges}
                        lineageById={liveLineageById}
                      />
                    )}

                    {/* 서브프로세스 지정 — 게시본 승인 탭에서도 지정/수정/해제(맵 단위, 오너·관리자). Map 탭 카드와 동일 인스턴스 */}
                    <SubprocessInspectorCard
                      mapId={mapId}
                      canManage={spCanManage}
                      disabledReason={spDisabledReason}
                      disabledReasonKind={spDisabledReasonKind}
                      onToast={showToast}
                      onDesignationChange={() => setSpUsageReload((n) => n + 1)}
                      onGoToPublished={(id) => void switchVersion(id)}
                      usage={spUsage}
                    />
                    <MapDetailCard
                      mapId={mapId}
                      only="versions"
                      showFooter={false}
                      reloadKey={versionsReloadKey}
                      onGoToVersion={requestGoToVersion}
                      currentVersionId={versionId}
                    />
                  </div>
                }
                activitySlot={
                  // R5d 활동 탭 — 전체 코멘트(노드 단위 정렬, 노드 선택 시만 작성·클릭 시 노드 이동). 버전 타임라인은 승인 탭으로 이동
                  <div className="flex flex-col gap-4">
                    <section>
                      <div className="mb-2 text-fine font-semibold text-ink">
                        {t("editor.comments")}
                        {comments.some((comment) => !comment.resolved) &&
                          ` · ${t("editor.unresolvedCount", { n: comments.filter((comment) => !comment.resolved).length })}`}
                      </div>
                      <CommentSection
                        comments={[...comments].sort(
                          (a, b) => a.node_id.localeCompare(b.node_id) || a.created_at.localeCompare(b.created_at),
                        )}
                        onAdd={(body) => void handleAddComment(body)}
                        onToggleResolved={(comment) => void handleToggleComment(comment)}
                        onDelete={(comment) => void handleDeleteComment(comment)}
                        currentUser={username}
                        inputDisabled={selectedNode === null}
                        onCommentClick={(comment) => handleOutlineSelect(comment.node_id)}
                      />
                    </section>
                  </div>
                }
                mapName={mapName}
                mapVersionMarker={
                  currentVersion
                    ? formatVersionMarker(currentVersion, versions, { long: true })
                    : undefined
                }
                versionControl={
                  <VersionPill
                    versions={versions}
                    versionId={versionId}
                    isEditing={!readOnly}
                    onSwitch={(id) => void switchVersion(id)}
                  />
                }
                readOnly={readOnly}
                onAddNode={() => handleAddNode(null, "process")}
                onOpenLibrary={() => (isWordMap ? setSectionsOpen(true) : isFrameworkMap ? setFrameworkPickerOpen(true) : setLibraryOpen(true))}
                onAutoArrange={() => applyNodesTransform((current) => layoutWithDagre(current, edgesRef.current))}
                nodeCount={nodes.length}
                edgeCount={edges.length}
                subprocessCount={nodes.filter((node) => node.data.nodeType === "subprocess").length}
                saveLabel={
                  saveState === "saving"
                    ? t("editor.saving")
                    : saveState === "error"
                      ? t("editor.saveFailedPill")
                      : t("editor.saved")
                }
                importSlot={
                  csvPreviewActive && csvOutcome ? (
                    <CsvImportTab
                      merge={csvOutcome.merge}
                      warnings={csvOutcome.warnings}
                      keepRemoved={csvKeepRemoved}
                      onKeepRemovedChange={setCsvKeepRemoved}
                      onFocusNode={highlightNode}
                      onApply={() => void applyCsvImport()}
                      onCancel={cancelCsvPreview}
                      origin={importOrigin ?? "csv"}
                    />
                  ) : undefined
                }
                forcedTab={csvPreviewActive ? "import" : undefined}
                lockTabs={csvPreviewActive}
              />
            </div>
          </div>
        )}
      </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={removeToast} />
      {versionDialog && (
        <PromptDialog
          title={versionDialog.mode === "create" ? t("editor.newVersion") : t("editor.rename")}
          label={
            versionDialog.mode === "create"
              ? t("prompt.newVersionName")
              : t("prompt.renameVersion")
          }
          defaultValue={
            versionDialog.mode === "create"
              ? "" // 신규 버전 이름은 자동입력 없이 사용자가 직접 입력 (빈 값은 PromptDialog가 제출 비활성)
              : (versions.find((version) => version.id === versionId)?.label ?? "")
          }
          placeholder={
            // 이름은 사용자가 직접 입력 — 버전 번호는 게시 시 자동 채번(안내용 힌트)
            versionDialog.mode === "create" ? t("prompt.newVersionNumberAuto") : undefined
          }
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={(value) => void submitVersionDialog(value)}
          onClose={() => setVersionDialog(null)}
        />
      )}
      {deleteVersionOpen && (
        <ConfirmDialog
          title={t("editor.deleteVersion")}
          message={t("prompt.deleteVersionConfirm")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => void confirmDeleteVersion()}
          onClose={() => setDeleteVersionOpen(false)}
        />
      )}
      {/* 비공개 맵 접근 게이트 — 403 로드 실패 안내, 확인/닫기 모두 홈으로 */}
      {accessDenied && (
        <ConfirmDialog
          icon={<Lock size={28} strokeWidth={1.5} />}
          title={t("mapAccess.deniedTitle")}
          message={t("mapAccess.deniedBody")}
          confirmLabel={t("mapAccess.deniedConfirm")}
          onConfirm={() => router.replace("/")}
          onClose={() => router.replace("/")}
        />
      )}
      {/* 펼침 레인 "링크맵 열기" 확인 — 에디터 이탈 시 미저장 내용 경고 (F6) */}
      {openMapPrompt && (
        <ConfirmDialog
          icon={<ExternalLink size={28} strokeWidth={1.5} />}
          title={openMapPrompt.name}
          message={t("subprocess.openMapBody")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => router.push(`/maps/${openMapPrompt.mapId}`)}
          onClose={() => setOpenMapPrompt(null)}
        />
      )}
      {/* 미등록 맵 드롭 — 잠금 경고 동봉 확인 후 드롭 위치에 생성, 이어서 등록 요청 여부 (spec 2026-07-19) */}
      {unregDrop?.stage === "confirm" && (
        <ConfirmDialog
          icon={<Link2 size={28} strokeWidth={1.5} />}
          title={t("editor.confirmAddLinkTitle")}
          lines={[
            { icon: <Link2 size={14} strokeWidth={1.5} />, text: t("editor.confirmAddLinkBody", { name: unregDrop.name }) },
            { icon: <AlertTriangle size={14} strokeWidth={1.5} />, text: t("library.linkUnregNotice"), tone: "error" },
          ]}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const drop = unregDrop;
            void createLinkNodeAt(drop.linkedMapId, drop.name, null, drop.position);
            setUnregDrop({ ...drop, stage: "request" });
          }}
          onClose={() => setUnregDrop(null)}
        />
      )}
      {/* 링크는 이미 완료 — 등록 요청만 결정(No/닫기 = 링크만 유지) */}
      {unregDrop?.stage === "request" && (
        <ConfirmDialog
          icon={<Network size={28} strokeWidth={1.5} />}
          title={t("library.requestTitle")}
          lines={[
            { icon: <Network size={14} strokeWidth={1.5} />, text: t("library.requestMessage", { name: unregDrop.name }) },
          ]}
          confirmLabel={t("library.requestSend")}
          cancelLabel={t("library.requestSkip")}
          onConfirm={() => {
            const drop = unregDrop;
            setUnregDrop(null);
            void sendSpDesignationRequest(drop.linkedMapId);
          }}
          onClose={() => setUnregDrop(null)}
        />
      )}
      {/* 점유권 이전 다이얼로그 — searchable editor picker (T7); conditional render resets query state on close */}
      {transferOpen && (
        <TransferCheckoutDialog
          open={transferOpen}
          editors={transferEditors}
          value={transferTarget}
          onChange={setTransferTarget}
          onConfirm={() => void handleConfirmTransfer()}
          onCancel={() => setTransferOpen(false)}
        />
      )}
      {/* 재게시 확인 */}
      {republishConfirmOpen && (
        <ConfirmDialog
          icon={<RotateCcw size={28} strokeWidth={1.5} />}
          title={t("approval.republishConfirmTitle")}
          message={t("approval.republishConfirmBody")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => void handleConfirmRepublish()}
          onClose={() => setRepublishConfirmOpen(false)}
        />
      )}
      {/* 셀프 게시 팝오버 — 승인자가 본인 1인일 때 클릭 지점에 Yes/No (Yes=승인요청→승인→게시 일괄) */}
      {selfPublishPrompt && (
        <SelfPublishPopover
          position={selfPublishPrompt}
          onYes={() => {
            setSelfPublishPrompt(null);
            void runTransition((id) => runSelfPublishChain(id, bundleValue ?? undefined));
            setBundleValue(null);
          }}
          onNo={() => {
            setSelfPublishPrompt(null);
            setBundleValue(null);
            setTransitionComment("");
            setSubmitConfirmOpen(true);
          }}
          onClose={() => {
            setSelfPublishPrompt(null);
            // dismiss(Escape/바깥클릭)는 confirm 경로와 달리 값을 지우지 않아, 다음 오픈에 픽커가
            // 미리 선택된 채로 뜰 수 있다 — belt and braces로 여기서도 리셋.
            setBundleValue(null);
          }}
          bundleSlot={
            canBundleVisibility ? (
              <VisibilityBundlePicker current={mapVisibility} value={bundleValue} onChange={setBundleValue} />
            ) : undefined
          }
        />
      )}
      {/* 승인 요청 확인 — 현재 설정된 승인자 목록 노출 */}
      {submitConfirmOpen && (
        <SubmitConfirmDialog
          workflow={workflow}
          nameById={nameById}
          subtitle={versionSubtitle}
          previousRejection={findLatestRejection(currentVersion?.events)}
          bundleSlot={
            canBundleVisibility ? (
              <VisibilityBundlePicker current={mapVisibility} value={bundleValue} onChange={setBundleValue} />
            ) : undefined
          }
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setSubmitConfirmOpen(false);
            void runTransition((id) => submitVersion(id, bundleValue ?? undefined, transitionComment.trim() || undefined));
            setBundleValue(null);
          }}
          onClose={() => {
            setSubmitConfirmOpen(false);
            setBundleValue(null);
          }}
        />
      )}
      {/* 승인 확인 — 동봉 가시성 변경이 있으면 승인자에게 공개(원 신고 건) */}
      {approveConfirmOpen && (
        <ApproveConfirmDialog
          workflow={workflow}
          nameById={nameById}
          username={username}
          subtitle={versionSubtitle}
          extraLines={buildBundledVisibilityLines(workflow, nameById, t)}
          submitComment={findLatestSubmitComment(currentVersion?.events)}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setApproveConfirmOpen(false);
            void runTransition((id) => approveVersion(id, transitionComment.trim() || undefined));
          }}
          onClose={() => setApproveConfirmOpen(false)}
        />
      )}
      {/* 게시 확인 — 현재 게시본이 만료됨을 안내 */}
      {publishConfirmOpen && (
        <PublishConfirmDialog
          subtitle={versionSubtitle}
          priorPublished={versions.find((v) => v.status === "published") ?? null}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setPublishConfirmOpen(false);
            void runTransition((id) => publishVersion(id, transitionComment.trim() || undefined));
          }}
          onClose={() => setPublishConfirmOpen(false)}
        />
      )}
      {/* 회수 확인 — 기존 승인 초기화 안내 */}
      {withdrawConfirmOpen && (
        <WithdrawConfirmDialog
          workflow={workflow}
          nameById={nameById}
          username={username}
          subtitle={versionSubtitle}
          withdrawSubmitter={withdrawSubmitter}
          showCommentInput={workflow?.status === "rejected" || (workflow?.approvals.length ?? 0) >= 1}
          comment={transitionComment}
          onCommentChange={setTransitionComment}
          onConfirm={() => {
            setWithdrawConfirmOpen(false);
            void runTransition((id) => withdrawVersion(id, transitionComment.trim() || undefined));
          }}
          onClose={() => setWithdrawConfirmOpen(false)}
        />
      )}
      {/* 거절 — 사유 입력창 유지, 디자인 통일 */}
      {rejectOpen && (
        <RejectDialog
          workflow={workflow}
          nameById={nameById}
          username={username}
          subtitle={versionSubtitle}
          submitComment={findLatestSubmitComment(currentVersion?.events)}
          reason={rejectReason}
          onReasonChange={setRejectReason}
          onConfirm={() => {
            const reason = rejectReason.trim();
            setRejectOpen(false);
            setRejectReason("");
            void runTransition((id) => rejectVersion(id, reason));
          }}
          onClose={() => {
            setRejectOpen(false);
            setRejectReason("");
          }}
        />
      )}
      {/* 타임라인 go-to 전환 확인 — VersionPill과 동일 모달(편집 중 미저장 안내) */}
      {goVersionPrompt && (
        <VersionSwitchConfirm
          label={goVersionPrompt.label}
          onConfirm={() => {
            const id = goVersionPrompt.id;
            setGoVersionPrompt(null);
            void switchVersion(id);
          }}
          onClose={() => setGoVersionPrompt(null)}
        />
      )}
      {branchPrompt && (
        <EdgeBranchModal
          onPick={handlePickBranch}
          onClose={() => setBranchPrompt(null)}
          position={branchPrompt.at}
        />
      )}
      {bulkEdgeStyle !== null &&
        (() => {
          // 전체 일괄 변경 확인 — 변경 요약(전체/변경 수·모양별 내역)을 보여주고 확정
          const target = bulkEdgeStyle;
          const targetOption = EDGE_LINE_STYLE_OPTIONS.find((option) => option.value === target)!;
          const TargetIcon = targetOption.icon;
          const changing = edges.filter((edge) => normalizeEdgeLineStyle(edge.type) !== target);
          const counts = new Map<EdgeLineStyle, number>();
          for (const edge of changing) {
            const from = normalizeEdgeLineStyle(edge.type);
            counts.set(from, (counts.get(from) ?? 0) + 1);
          }
          const styleLabel = (value: EdgeLineStyle) =>
            t(EDGE_LINE_STYLE_OPTIONS.find((option) => option.value === value)!.labelKey);
          const lines: ConfirmLine[] = [
            {
              icon: <ArrowRight size={14} strokeWidth={1.5} />,
              text:
                changing.length === 0
                  ? t("edgeStyle.applyAllNone")
                  : t("edgeStyle.applyAllChange", { n: changing.length, total: edges.length }),
            },
            ...[...counts.entries()].map(([from, count]) => {
              const FromIcon = EDGE_LINE_STYLE_OPTIONS.find((option) => option.value === from)!.icon;
              return {
                icon: <FromIcon size={14} strokeWidth={1.5} />,
                text: `${styleLabel(from)} → ${styleLabel(target)} · ${count}`,
                tone: "muted",
              } as ConfirmLine;
            }),
            {
              icon: <Plus size={14} strokeWidth={1.5} />,
              text: t("edgeStyle.applyAllNew"),
              tone: "muted",
            },
          ];
          return (
            <ConfirmDialog
              dialogId="edge-style-apply-all"
              title={`${t("edgeStyle.applyAllTitle")} - ${t(targetOption.labelKey)}`}
              icon={<TargetIcon size={28} strokeWidth={1.5} />}
              lines={lines}
              confirmLabel={t("edgeStyle.applyAllConfirm")}
              cancelLabel={t("common.cancel")}
              onConfirm={() => applyBulkEdgeStyle(target)}
              onClose={() => setBulkEdgeStyle(null)}
            />
          );
        })()}
      {edgeAction && (
        <EdgeActionModal
          position={edgeAction.at}
          onInsert={() => applyEdgeAction("insert")}
          onReplace={() => applyEdgeAction("replace")}
          onClose={() => setEdgeAction(null)}
        />
      )}
      {edgeSelect && (
        <EdgeSelectModal
          position={edgeSelect.at}
          options={edgeSelect.options}
          onHoverOption={setHoveredEdgeId}
          onPick={(edgeId) => {
            setHoveredEdgeId(null);
            applyEdgeSelect(edgeId);
          }}
          onClose={() => {
            setHoveredEdgeId(null);
            setEdgeSelect(null);
          }}
        />
      )}
      {swapSelect && (
        <EdgeSelectModal
          position={swapSelect.at}
          options={swapSelect.options}
          title={t("edge.selectSwapOutput")}
          onHoverOption={setHoveredEdgeId}
          onPick={(edgeId) => {
            setHoveredEdgeId(null);
            applySwapSelect(edgeId);
          }}
          onClose={() => {
            setHoveredEdgeId(null);
            setSwapSelect(null);
          }}
        />
      )}
      {/* IO 항목 불러오기 — 후보는 ioImportCandidates memo(닫혀 있으면 빈 배열, 열림 중 hover 리렌더에 재스캔 없음).
          선택 즉시 그래프에 커밋(여러 노드를 만지므로 카드 draft로는 표현 불가, io-linking §4-2) */}
      {ioImport && (
        <IoImportModal
          side={ioImport.side}
          position={ioImport.at}
          candidates={ioImportCandidates}
          onHoverCandidate={(candidate) =>
            setIoHighlight(
              candidate
                ? { nodeIds: [candidate.nodeId], edgeIds: candidate.pathEdgeIds }
                : null,
            )
          }
          onPick={(candidate) => {
            const result = applyIoImport({
              nodes: nodesRef.current,
              edges,
              spRefs: subprocessRefs,
              nodeId: ioImport.nodeId,
              side: ioImport.side,
              candidate,
            });
            setIoImport(null);
            setIoHighlight(null);
            if (!result) {
              return;
            }
            recordChange(false);
            setNodes(result.nodes);
            scheduleAutoSave();
            showToast(t(IMPORT_TOAST_KEY[result.action]));
          }}
          onClose={() => {
            setIoImport(null);
            setIoHighlight(null);
          }}
        />
      )}
      {decisionDrop && (
        <EdgeDecisionModal
          position={decisionDrop.at}
          onBranch={applyDecisionBranch}
          onIntercept={applyDecisionIntercept}
          onClose={() => setDecisionDrop(null)}
        />
      )}
      {capPrompt && (
        <ConfirmDialog
          icon={<Maximize2 size={28} strokeWidth={1.5} />}
          title={t("inline.capTitle")}
          message={t("inline.capBody", {
            nodes: capPrompt.nodeCount,
            depth: capPrompt.depth,
            maxNodes: EXPANSION_LIMITS.maxNodes,
            maxDepth: EXPANSION_LIMITS.maxDepth,
          })}
          confirmLabel={t("inline.capProceed")}
          cancelLabel={t("inline.capCancel")}
          onConfirm={confirmCapPrompt}
          onClose={() => setCapPrompt(null)}
        />
      )}
      {/* CSV 임포트 모달 — 파일 선택·파싱 결과, Continue로 교체 확인 단계 진입 */}
      {csvImportOpen && (
        <ModalBackdrop
          onClose={() => {
            setCsvImportOpen(false);
            setCsvOutcome(null);
            setCsvFileName(null);
          }}
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink/20 backdrop-blur-sm"
        >
          <div className="relative flex w-full max-w-lg flex-col gap-4 rounded-md bg-surface p-6 shadow-lg">
            <h2 className="text-body-strong text-ink">{t("csvImport.modalTitle")}</h2>
            <CsvImportSection
              outcome={csvOutcome}
              fileName={csvFileName}
              manualUrl={csvManualUrl}
              context={{
                // refs가 아닌 렌더 state 사용 — ref.current를 렌더 중 읽으면 react-hooks/refs 위반
                base: buildGraph(nodes, edges, groups),
                directory: eligible ?? undefined,
              }}
              onChange={(nextOutcome, nextFileName) => {
                setCsvOutcome(nextOutcome);
                setCsvFileName(nextFileName);
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
                onClick={() => {
                  setCsvImportOpen(false);
                  setCsvOutcome(null);
                  setCsvFileName(null);
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                data-id="csv-import-continue"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-white hover:opacity-90 disabled:opacity-50"
                disabled={!csvOutcome?.graph || csvOutcome.errors.length > 0}
                onClick={enterCsvPreview}
              >
                {t("csvImport.continue")}
              </button>
            </div>
          </div>
        </ModalBackdrop>
      )}
      <ExcelExportModal
        open={excelExportOpen}
        onClose={() => setExcelExportOpen(false)}
        buildMap={buildMapExcelModel}
        buildWbs={buildWbsExcelModel}
        fileNameFor={excelFileNameFor}
      />
      {/* 링크 미리보기 — 액션 바 "링크 열기"로 오픈, 인스펙터 포함 우측 전체를 덮는 오버레이 */}
      <LinkPreviewPanel url={linkPreviewUrl} onClose={() => setLinkPreviewUrl(null)} />
      {/* GMP 분류 피커 — 캔버스 필 클릭 좌표 앵커, 분류가 필 색을 자동 확정 (design 2026-08-20) */}
      {/* GMP 변경 안내 — 닫기(X)가 클릭한 마우스 지점, 분류·노드 색 before→after를 명시 (design 2026-08-20) */}
      {gmpNotice !== null && (
        <GmpNoticePopover
          x={gmpNotice.x}
          y={gmpNotice.y}
          prevGmp={gmpNotice.prevGmp}
          nextGmp={gmpNotice.nextGmp}
          prevColor={gmpNotice.prevColor}
          nextColor={gmpNotice.nextColor}
          onRevertColor={() => {
            patchNode(gmpNotice.nodeId, { color: gmpNotice.prevColor }, true);
            setGmpNotice(null);
            setGmpPreview(null);
          }}
          onRevertAll={() => {
            patchNode(gmpNotice.nodeId, { gmp: gmpNotice.prevGmp, color: gmpNotice.prevColor }, true);
            setGmpNotice(null);
            setGmpPreview(null);
          }}
          onClose={() => {
            setGmpNotice(null);
            setGmpPreview(null);
          }}
          onHoverAction={(action) => {
            if (action === null) {
              setGmpPreview(null);
              return;
            }
            // 액션 결과값을 노드에 미리 반영 — color=색만 복원, all=둘 다 복원, confirm=현행 유지
            const preview =
              action === "color"
                ? { gmp: gmpNotice.nextGmp, color: gmpNotice.prevColor }
                : action === "all"
                  ? { gmp: gmpNotice.prevGmp, color: gmpNotice.prevColor }
                  : { gmp: gmpNotice.nextGmp, color: gmpNotice.nextColor };
            setGmpPreview({ nodeId: gmpNotice.nodeId, ...preview });
          }}
        />
      )}
      {ioPeersMenu !== null && (
        <IoPeersMenu
          position={ioPeersMenu.at}
          items={ioPeersMenu.items}
          onHoverPeer={(nodeId) => {
            if (nodeId === null) {
              setIoHighlight(null);
              return;
            }
            // 앵커→상대 흐름 경로가 있으면 엣지도 함께(양방향 중 존재하는 쪽) — 없으면 노드만
            const forward = getFlowPathBetween(edges, ioPeersMenu.anchorId, nodeId);
            const path = forward.length > 0 ? forward : getFlowPathBetween(edges, nodeId, ioPeersMenu.anchorId);
            setIoHighlight({ nodeIds: [nodeId], edgeIds: path });
          }}
          onPick={(nodeId) => {
            setIoPeersMenu(null);
            setIoHighlight(null);
            highlightNode(nodeId);
          }}
          onClose={() => {
            setIoPeersMenu(null);
            setIoHighlight(null);
          }}
        />
      )}
      {gmpPicker !== null && (
        <GmpPickerPopup
          x={gmpPicker.x}
          y={gmpPicker.y}
          onClose={() => setGmpPicker(null)}
          onPick={(value) => {
            const prevGmp = gmpPickerNode?.data.gmp ?? "";
            const prevColor = gmpPickerNode?.data.color ?? "";
            setGmpPicker(null);
            if (value === prevGmp) return; // 동일 분류 재선택 — 색 리셋 부작용 없이 무시
            // 분류가 노드 색을 자동 확정 — 미분류 선택은 타입 기본색으로 리셋 (사용자 요청 2026-08-21 #7)
            const nextColor = getGmpTargetColor(value);
            patchNode(gmpPicker.nodeId, { gmp: value, color: nextColor }, true);
            setGmpNotice({
              nodeId: gmpPicker.nodeId,
              prevGmp,
              prevColor,
              nextGmp: value,
              nextColor,
              x: gmpPicker.x,
              y: gmpPicker.y,
            });
          }}
        />
      )}
    </NodeActionsContext.Provider>
  );
}

export default function MapEditorPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  // 최근 열람 기록 — 얇은 래퍼에서(모든 진입 경로 포괄, 6700줄 본체 불변). 클라 캐시.
  useEffect(() => {
    if (Number.isFinite(mapId)) {
      recordRecentMap(mapId);
    }
  }, [mapId]);

  return (
    <ReactFlowProvider>
      <MapEditor mapId={mapId} />
    </ReactFlowProvider>
  );
}
