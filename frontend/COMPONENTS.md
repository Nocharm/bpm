# Frontend Components

`src/components/**` 목록 — **파일 · 내보내는 컴포넌트 · 역할(머리 주석 첫 문장) · 사용처(임포트하는 파일)**. 일괄 UI 수정 전에 대상 컴포넌트가 어디서 공유되는지 여기서 먼저 확인한다(룰 `rules/frontend/components.md`).

> 생성 파일 — 손으로 고치지 말고 `node scripts/build-component-catalog.mjs`(frontend/)로 재생성한다. 컴포넌트를 추가·이동·삭제하거나 사용처가 바뀌면 같은 커밋에서 재생성. `--check`는 최신 여부만 검사. 역할 열이 비어 있으면 그 파일에 머리 주석(한 줄 역할 설명)이 없다는 뜻 — 주석을 채운다.

총 219개 · 2026-09-03 기준

## components/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `activity-digest.tsx` | `ActivityDigest` | 미선택 우측 공용 다이제스트 | `app/inbox/page.tsx`, `app/notices/page.tsx` |
| `add-node-menu.tsx` | `AddNodeMenu` | 좌측 사이드바 +노드 메뉴 | `components/editor-toolbar.tsx` |
| `ai-chat-cards.tsx` | `AnalysisCard`, `WalkthroughCard`, `ProposalSummaryCard` | AI 챗 메시지 부착 카드 | `components/ai-chat-panel.tsx` |
| `ai-chat-panel.tsx` | `AiChatPanel` | 에디터 AI 채팅 패널 | `app/maps/[mapId]/page.tsx` |
| `approval-panel.tsx` | `ApprovalPanel` | R5c 승인 탭 | `app/maps/[mapId]/page.tsx` |
| `approver-manager.tsx` | `ApproverManager` | 맵 소유자가 승인자 목록을 편집 | `app/maps/[mapId]/page.tsx` |
| `auth-loading.tsx` | `AuthLoadingScreen` |   | `app/login/page.tsx`, `components/providers.tsx` |
| `auto-height.tsx` | `AutoHeight` | 내용 높이에 맞춰 늘어나고, 바뀔 때 부드럽게 전환되는 컨테이너. | `app/inbox/page.tsx`, `components/group-bulk-modal.tsx`, `components/node-summary-modal.tsx`, `components/permissions/subprocess-designation-modal.tsx` |
| `bpm-attribute-picker.tsx` | `BpmAttributePicker` | 노드 BPM 속성 담당자·부서 피커 | `app/maps/[mapId]/page.tsx` |
| `branch-icon.tsx` | `BranchGlyph` | 분기(Yes/No/Other) 아이콘 | `app/maps/[mapId]/page.tsx`, `components/edge-branch-modal.tsx`, `components/edge-select-modal.tsx` |
| `canvas-zoom-scale.tsx` | `CanvasZoomScale` | 캔버스 줌 컨트롤 pill | `app/maps/[mapId]/page.tsx` |
| `change-summary-section.tsx` | `ChangeSummaryDisclosure`, `ChangeSummarySection` | 기준 버전 대비 변경 요약 | `app/maps/[mapId]/page.tsx`, `components/framework-confirm-section.tsx` |
| `checkout-panel.tsx` | `CheckoutPanel` | 점유권 탭 | `components/approval-panel.tsx` |
| `comment-section.tsx` | `CommentSection` | 노드 코멘트 스레드 | `app/maps/[mapId]/page.tsx` |
| `compare-field-diff.tsx` | `FieldDiffValues`, `FieldDiffHoverable` | 비교 필드 diff 공용 렌더 | `app/maps/[mapId]/compare/page.tsx`, `components/process-node.tsx` |
| `confirm-dialog.tsx` | `ConfirmDialog` | 범용 확인 모달 | `app/inbox/page.tsx`, `app/maps/[mapId]/compare/page.tsx`, `app/maps/[mapId]/consult/page.tsx`, `app/maps/[mapId]/page.tsx`, `components/admin/deleted-groups-panel.tsx`, `components/admin/deleted-maps-panel.tsx`, `components/admin/framework-panel.tsx`, `components/admin/local-account-table.tsx`, `components/admin/table-viewer.tsx`, `components/ai-chat-panel.tsx`, `components/bpm-attribute-picker.tsx`, `components/feedback-detail-modal.tsx`, `components/framework-browse-modal.tsx`, `components/framework-confirm-section.tsx`, `components/framework-connect-dialog.tsx`, `components/groups/group-actions.tsx`, `components/groups/group-detail.tsx`, `components/interview/interview-panel.tsx`, `components/interview/interview-preview.tsx`, `components/map-inspector-tab.tsx`, `components/map-name-dropdown.tsx`, `components/maps/map-notes-section.tsx`, `components/permissions/create-map-dialog.tsx`, `components/permissions/subprocess-designation-panel.tsx`, `components/settings/ai-prompts-panel.tsx`, `components/settings/kb-manage-panel.tsx`, `components/settings/manual-manage-panel.tsx`, `components/subprocess-inspector-card.tsx`, `components/version/approve-confirm-dialog.tsx`, `components/version/approver-status-lines.tsx`, `components/version/publish-confirm-dialog.tsx`, `components/version/reject-dialog.tsx`, `components/version/submit-confirm-dialog.tsx`, `components/version/version-switch-confirm.tsx`, `components/version/withdraw-confirm-dialog.tsx` |
| `context-menu.tsx` | `ContextMenu`, `EdgeSidesPad` | 마우스 커서 위치에 뜨는 컨텍스트 메뉴 | `app/maps/[mapId]/page.tsx`, `components/maps/map-detail-card.tsx`, `components/maps/version-timeline.tsx` |
| `cost-unit.tsx` | `CostUnitTabs`, `CurrencyPill` | 비용 단위(₩/$) 공용 조각 | `components/node-summary-modal.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `csv-create-modal.tsx` | `CsvCreateModal` | CSV로 새 맵 만들기 | `app/page.tsx` |
| `csv-import-section.tsx` | `CsvImportSection` | CSV 임포트 공용 섹션 | `app/maps/[mapId]/page.tsx` |
| `csv-import-tab.tsx` | `CsvImportTab` | 인스펙터 Import 탭 | `app/maps/[mapId]/page.tsx` |
| `csv-template-actions.tsx` | `CsvTemplateActions` | CSV 준비 액션 | `components/csv-create-modal.tsx`, `components/csv-import-section.tsx` |
| `data-form-picker.tsx` | `DataFormPicker` | IO 항목별 데이터 폼 피커 | `components/multi-value-input.tsx` |
| `dev-login-modal.tsx` | `DevLoginModal` | 로컬(인증 OFF) 임시 로그인 피커 | `app/login/page.tsx` |
| `edge-action-modal.tsx` | `EdgeActionModal` | 출력 1개 충돌 시 선택 모달 | `app/maps/[mapId]/page.tsx` |
| `edge-branch-modal.tsx` | `EdgeBranchModal` | 판단(decision) 노드에서 엣지를 연결할 때 뜨는 분기 선택 | `app/maps/[mapId]/page.tsx` |
| `edge-decision-modal.tsx` | `EdgeDecisionModal` | 디시전 노드에 노드를 드롭(출력 ≥1)했을 때 선택 모달 | `app/maps/[mapId]/page.tsx` |
| `edge-label-editor.tsx` | `EdgeLabelEditor` | 엣지 더블클릭 시 캔버스 가운데(엣지 중점)에 뜨는 인라인 라벨 편집 박스 | `app/maps/[mapId]/page.tsx` |
| `edge-select-modal.tsx` | `EdgeSelectModal` | 다중 출력 노드에 삽입 시 | `app/maps/[mapId]/page.tsx` |
| `editor-left-sidebar.tsx` | `EditorLeftSidebar` | 에디터 좌측 사이드바 | `app/maps/[mapId]/page.tsx` |
| `editor-toolbar.tsx` | `EditorToolbar` | 편집 툴바 | `app/maps/[mapId]/page.tsx` |
| `excel-export-modal.tsx` | `ExcelExportModal` | Excel 내보내기 형식 선택 모달 | `app/maps/[mapId]/page.tsx` |
| `expand-invariant-modal.tsx` | `ExpandInvariantModal` | 하위 프로세스 불변식 확인 모달 | (미사용) |
| `fallback-hint.tsx` | `FallbackHint` | 폴백 원문 힌트 | `app/maps/[mapId]/page.tsx`, `components/maps/map-fallback-notes.tsx`, `components/node-metrics-card.tsx`, `components/node-summary-modal.tsx`, `components/permissions/process-fields-card.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `feedback-detail-modal.tsx` | `FeedbackDetailModal` | 피드백 상세/관리 모달 | `app/feedback/page.tsx` |
| `feedback-notes-flyout.tsx` | `FeedbackNotesFlyout` | 피드백 노트 플라이아웃 | `app/feedback/page.tsx` |
| `feedback-side-panel.tsx` | `FeedbackSidePanel` | 피드백 사이드 패널 | `components/top-nav.tsx` |
| `flow-conflict-modal.tsx` | `FlowConflictModal` | 입력이 있는 노드 앞에 다른 노드를 추가할 때 | `app/maps/[mapId]/page.tsx` |
| `flow-glyphs.tsx` | `InsertGlyph`, `KeepGlyph` | 흐름 조작 의미 아이콘 | `components/edge-action-modal.tsx`, `components/flow-conflict-modal.tsx` |
| `framework-browse-modal.tsx` | `FrameworkBrowseModal` | 업무체계 탐색 모달 | `app/maps/[mapId]/page.tsx`, `components/framework-peek-pill.tsx` |
| `framework-chip.tsx` | `FrameworkChip` | 에디터 우상단 프레임워크 칩 | `app/maps/[mapId]/page.tsx`, `components/framework-peek-pill.tsx` |
| `framework-confirm-section.tsx` | `FrameworkConfirmSection` | 연계 캔버스 확정 섹션 | `app/maps/[mapId]/page.tsx` |
| `framework-connect-dialog.tsx` | `FrameworkConnectDialog` | 플레이스홀더 후차 연결 다이얼로그 (design 2026-08-28 §10.1) | `app/maps/[mapId]/page.tsx` |
| `framework-l5-explorer.tsx` | `FrameworkL5Explorer` | 연계 캔버스 좌상단 L5 탐색기 | `app/maps/[mapId]/page.tsx` |
| `framework-peek-pill.tsx` | `FrameworkPeekTrigger`, `FrameworkPeekPill` | 업무체계 드릴인 피크 | `app/maps/[mapId]/page.tsx`, `components/process-node.tsx`, `components/subprocess-preview-peek.tsx` |
| `framework-tree-picker.tsx` | `FrameworkTreePicker` | 연계 캔버스용 framework 트리 피커 | `app/maps/[mapId]/page.tsx` |
| `gmp-notice-popover.tsx` | `GmpNoticePopover` | GMP 분류 확정 안내 팝오버 | `app/maps/[mapId]/page.tsx` |
| `gmp-picker-popup.tsx` | `GmpColorSwatch`, `GmpPickerPopup` | GMP 분류 픽커 팝업 | `app/maps/[mapId]/page.tsx`, `components/gmp-notice-popover.tsx` |
| `group-box.tsx` | `GroupBox` | 업무 묶음 박스 | `app/maps/[mapId]/page.tsx` |
| `group-bulk-modal.tsx` | `GroupBulkModal` | 그룹 멤버 일괄 편집 | `app/maps/[mapId]/page.tsx` |
| `group-title-bar.tsx` | `GroupTitleBar` | 그룹 박스 타이틀바 | `app/maps/[mapId]/page.tsx` |
| `highlight.tsx` | `Highlight` | 매치 구간 하이라이트 | `components/maps/map-card.tsx`, `components/permissions/principal-picker.tsx`, `components/search-select.tsx` |
| `hover-tip.tsx` | `HoverTip` | 경량 호버 툴팁 | `components/approval-panel.tsx` |
| `html-view.tsx` | `HtmlView` | 게시된 HTML 매뉴얼 렌더 | `app/manual/page.tsx`, `components/settings/manual-manage-panel.tsx` |
| `icon-action-button.tsx` | `IconActionButton` | 아이콘 전용 버튼 | `components/admin/deleted-groups-panel.tsx`, `components/admin/deleted-maps-panel.tsx`, `components/groups/group-actions.tsx` |
| `icon-pill-filter.tsx` | `IconPillFilter` | 아이콘 필 필터 | `app/feedback/page.tsx`, `app/inbox/page.tsx`, `app/notices/page.tsx` |
| `icon-tip.tsx` | `IconTip` | 아이콘 전용 버튼의 호버 툴팁 박스 | `app/maps/[mapId]/page.tsx`, `components/scope-window.tsx` |
| `inbox-badge.tsx` | `InboxBadge` | top-nav 인박스 탭 카운트 배지 | `components/top-nav.tsx` |
| `inspector-panel.tsx` | `InspectorPanel` | 우측 인스펙터 (R5) | `app/maps/[mapId]/page.tsx` |
| `io-import-modal.tsx` | `IoImportModal` | IO 항목 불러오기 선택 모달 | `app/maps/[mapId]/page.tsx` |
| `io-peers-menu.tsx` | `IoPeersMenu` | 링크 항목의 연결 노드 드롭다운 | `app/maps/[mapId]/page.tsx` |
| `ldap-login-form.tsx` | `LdapLoginForm` |   | `app/login/page.tsx` |
| `link-preview-panel.tsx` | `LinkPreviewPanel` | 링크 미리보기 패널 | `app/maps/[mapId]/page.tsx` |
| `map-inspector-tab.tsx` | `MapInspectorTab` | NEW 인스펙터 맵 탭(좁은 폭) | `app/maps/[mapId]/page.tsx` |
| `map-name-dropdown.tsx` | `MapNameDropdown` | 상단바 맵 이름 드롭다운 | `app/maps/[mapId]/page.tsx` |
| `map-ownership-section.tsx` | `MapOwnershipSection` | 속성 빈상태 소유·승인자 섹션 | `app/maps/[mapId]/page.tsx`, `components/permissions/attribute-tiles.tsx`, `components/process-library-panel.tsx` |
| `markdown-view.tsx` | `MarkdownView` | 마크다운 뷰어 | `app/inbox/page.tsx`, `app/manual/page.tsx`, `app/notices/page.tsx`, `components/ai-chat-panel.tsx`, `components/csv-import-tab.tsx`, `components/interview/draw-confirm-dialog.tsx`, `components/interview/interview-panel.tsx`, `components/notices/notices-manage-panel.tsx`, `components/settings/ai-prompts-panel.tsx`, `components/settings/manual-manage-panel.tsx` |
| `minimap-viewport-fill.tsx` | `MinimapFade`, `MiniMapViewportFill` | React Flow MiniMap + 현재 뷰포트 영역을 반투명 악센트로 '채우는' 오버레이(MiniMapViewportFill). | `app/maps/[mapId]/page.tsx` |
| `modal-backdrop.tsx` | `ModalBackdrop` | 모달 백드롭 | `app/maps/[mapId]/page.tsx`, `components/admin/framework-panel.tsx`, `components/admin/notification-purge-modal.tsx`, `components/approver-manager.tsx`, `components/confirm-dialog.tsx`, `components/csv-create-modal.tsx`, `components/dev-login-modal.tsx`, `components/edge-action-modal.tsx`, `components/edge-branch-modal.tsx`, `components/edge-decision-modal.tsx`, `components/edge-select-modal.tsx`, `components/excel-export-modal.tsx`, `components/expand-invariant-modal.tsx`, `components/feedback-detail-modal.tsx`, `components/framework-browse-modal.tsx`, `components/framework-connect-dialog.tsx`, `components/group-bulk-modal.tsx`, `components/groups/group-detail.tsx`, `components/groups/groups-panel.tsx`, `components/interview/draw-confirm-dialog.tsx`, `components/interview/interview-panel.tsx`, `components/interview/params-table-dialog.tsx`, `components/io-import-modal.tsx`, `components/io-peers-menu.tsx`, `components/maps/delete-map-dialog.tsx`, `components/maps/framework-assign-modal.tsx`, `components/maps/map-detail-card.tsx`, `components/node-details-card.tsx`, `components/node-summary-modal.tsx`, `components/notices/notice-edit-modal.tsx`, `components/org-info-modal.tsx`, `components/permissions/create-map-dialog.tsx`, `components/permissions/danger-zone.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/permissions/undo-last-apply-modal.tsx`, `components/prompt-dialog.tsx`, `components/self-publish-popover.tsx`, `components/version/transfer-checkout-dialog.tsx`, `components/word-create-modal.tsx`, `components/word-quick-create-dialog.tsx` |
| `multi-value-input.tsx` | `MultiValueInput` | 개행 구분 복수 값 편집 | `components/node-details-fields.tsx`, `components/node-summary-modal.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `multiline-edge.tsx` | - | 에디터 엣지 | `app/maps/[mapId]/page.tsx` |
| `newline-hint.tsx` | `NewlineHint` | 줄바꿈 단축키 안내 캡션 | `app/maps/[mapId]/page.tsx`, `components/node-summary-modal.tsx` |
| `node-action-bar.tsx` | `NodeActionBar` | 단일 선택 노드 하단 중앙의 통합 액션 바 | `app/maps/[mapId]/page.tsx` |
| `node-details-card.tsx` | `NodeDetailsCard` | 인스펙터 I/O & Conditions 카드 | `app/maps/[mapId]/page.tsx` |
| `node-details-fields.tsx` | `NodeDetailsFields` | 노드 상세(승격) 필드 편집 | `components/group-bulk-modal.tsx`, `components/node-details-card.tsx` |
| `node-display-section.tsx` | `NodeDisplaySection` | Node display(캔버스 노드 표시 정보) 토글 섹션 | `app/maps/[mapId]/page.tsx` |
| `node-metrics-card.tsx` | `NodeMetricsCard` | 인스펙터 수행 지표 카드 | `app/maps/[mapId]/page.tsx` |
| `node-search.tsx` | `NodeSearch` | 노드 검색 | `app/maps/[mapId]/page.tsx` |
| `node-selection-ring.tsx` | `NodeSelectionRing` |   | `app/maps/[mapId]/compare/page.tsx`, `app/maps/[mapId]/page.tsx` |
| `node-summary-modal.tsx` | `NodeSummaryModal` | 노드 더블클릭 편집 모달 | `app/maps/[mapId]/page.tsx` |
| `notification-bell.tsx` | `NotificationBell` | 인앱 알림 벨 | `components/top-nav.tsx` |
| `org-info-modal.tsx` | `OrgInfoModal` | 조직 정보 모달 | `components/maps/map-detail-card.tsx`, `components/permissions/attribute-tiles.tsx`, `components/process-library-panel.tsx` |
| `pagination.tsx` | `Pagination` | 간단 페이지네이션 | `app/feedback/page.tsx`, `components/notices/notices-manage-panel.tsx` |
| `param-icons.ts` | - | 수행 지표(Metrics) 아이콘 단일 소스 | `app/maps/[mapId]/compare/page.tsx`, `components/group-bulk-modal.tsx`, `components/maps/map-fallback-notes.tsx`, `components/node-metrics-card.tsx`, `components/node-summary-modal.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/process-node.tsx`, `components/subprocess-preview-peek.tsx`, `components/subprocess-usage-tab.tsx` |
| `param-input.tsx` | `ParamInput` | 숫자 파라미터 공용 입력 | `components/group-bulk-modal.tsx`, `components/interview/params-table-dialog.tsx`, `components/node-metrics-card.tsx`, `components/node-summary-modal.tsx`, `components/permissions/process-fields-card.tsx`, `components/permissions/subprocess-designation-modal.tsx` |
| `person-hover-card.tsx` | `PersonHoverCard`, `PersonInfoPopup` | 인물 카드 | `app/inbox/page.tsx`, `components/approval-panel.tsx`, `components/maps/map-detail-card.tsx`, `components/maps/version-timeline.tsx`, `components/org-info-modal.tsx` |
| `popover-action-bar.tsx` | `PopoverActionBar` | 소형 입력 팝오버 공용 푸터 | `components/fallback-hint.tsx`, `components/maps/map-notes-section.tsx`, `components/node-summary-modal.tsx`, `components/permissions/attribute-tiles.tsx`, `components/permissions/sp-field-popover.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `process-library-panel.tsx` | `ProcessLibraryPanel` | 프로세스 라이브러리 패널 | `app/maps/[mapId]/page.tsx` |
| `process-node.tsx` | `ProcessNode` |   | `app/maps/[mapId]/compare/page.tsx`, `app/maps/[mapId]/page.tsx`, `components/interview/choice-card.tsx`, `components/interview/interview-preview.tsx`, `components/scope-preview.tsx`, `components/subprocess-preview-peek.tsx` |
| `prompt-dialog.tsx` | `PromptDialog` | 플로팅 입력 모달 | `app/maps/[mapId]/page.tsx`, `components/admin/framework-panel.tsx` |
| `providers.tsx` | `Providers` |   | `app/layout.tsx` |
| `quick-connect-line.tsx` | `QuickConnectLine` | 빠른 연결 미리보기 | `app/maps/[mapId]/page.tsx` |
| `save-checklist.tsx` | `MapTitleChecklist` | 좌상단 맵 제목 칩 + 저장(그래프 검증) 조건 아코디언 | `app/maps/[mapId]/page.tsx` |
| `scope-preview.tsx` | `ScopePreview` | 비활성(조상) 창의 정적 프리뷰 | `app/maps/[mapId]/page.tsx`, `components/node-summary-modal.tsx`, `components/subprocess-preview-peek.tsx` |
| `scope-window.tsx` | `ScopeWindow` | 떠있는 스코프 창 | `app/maps/[mapId]/page.tsx` |
| `search-box.tsx` | `SearchBox` | 공용 검색창 | `app/inbox/page.tsx`, `app/manual/page.tsx`, `app/notices/page.tsx`, `app/page.tsx` |
| `search-select.tsx` | `SearchSelect` | 검색 드롭다운 | `components/bpm-attribute-picker.tsx`, `components/dashboard/access-sidebar.tsx`, `components/group-bulk-modal.tsx`, `components/maps/framework-assign-modal.tsx`, `components/permissions/attribute-tiles.tsx`, `lib/korean-dept.ts` |
| `section-panel.tsx` | `SectionPanel` | 섹션 피커 패널 | `app/maps/[mapId]/page.tsx` |
| `self-publish-popover.tsx` | `SelfPublishPopover` | 셀프 게시 확인 팝오버 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `skeleton.tsx` | `SkeletonBlock`, `SkeletonLine`, `SkeletonPill`, `SkeletonCard` | 스켈레톤 플레이스홀더 | `app/notices/page.tsx`, `components/map-ownership-section.tsx`, `components/maps/approvals-card.tsx`, `components/maps/home-skeleton.tsx`, `components/user-pill.tsx` |
| `status-badge.tsx` | `StatusBadge` | 버전 라이프사이클 상태 pill | `app/maps/[mapId]/page.tsx`, `components/approval-panel.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `subprocess-inspector-card.tsx` | `SubprocessInspectorCard` | 인스펙터 서브프로세스 카드 | `app/maps/[mapId]/page.tsx` |
| `subprocess-preview-peek.tsx` | `SubprocessPreviewPeek` | 서브프로세스 라이브러리/체계 피커 행의 미리보기 피크 | `app/maps/[mapId]/page.tsx`, `components/framework-tree-picker.tsx`, `components/process-library-panel.tsx` |
| `subprocess-registration-cta.tsx` | `SubprocessRegistrationCta` | 미지정 링크 등록 요청 CTA | `app/maps/[mapId]/page.tsx` |
| `subprocess-usage-tab.tsx` | `SubprocessUsageTab` | 인스펙터 Subprocess 탭 | `app/maps/[mapId]/page.tsx` |
| `subprocess-version-picker.tsx` | `SubprocessVersionPicker` | 하위프로세스 노드 버전 선택 | `app/maps/[mapId]/page.tsx` |
| `time-pills.tsx` | `TimePills` | 카드 시각 표시 | `app/inbox/page.tsx`, `app/manual/page.tsx`, `app/notices/page.tsx`, `components/feedback-detail-modal.tsx`, `components/feedback-notes-flyout.tsx` |
| `toast-stack.tsx` | `ToastStack` | 우상단(Nav 아래) 토스트 스택 | `app/feedback/page.tsx`, `app/groups/[groupId]/page.tsx`, `app/inbox/page.tsx`, `app/manual/page.tsx`, `app/maps/[mapId]/page.tsx`, `app/maps/[mapId]/settings/page.tsx`, `app/notices/page.tsx`, `app/page.tsx`, `app/settings/page.tsx`, `components/admin/approval-queue.tsx`, `components/feedback-side-panel.tsx`, `components/groups/groups-panel.tsx`, `components/map-settings/checkout-requests-panel.tsx`, `components/permissions/pending-approvals-panel.tsx` |
| `tooltip.tsx` | `Tooltip` | 호버 툴팁 | `app/manual/page.tsx`, `app/maps/[mapId]/page.tsx`, `components/admin/framework-panel.tsx`, `components/csv-import-tab.tsx`, `components/editor-toolbar.tsx`, `components/inspector-panel.tsx`, `components/maps/map-detail-card.tsx`, `components/node-metrics-card.tsx`, `components/notices/notices-manage-panel.tsx`, `components/subprocess-inspector-card.tsx`, `components/subprocess-usage-tab.tsx`, `components/top-nav.tsx` |
| `top-nav.tsx` | `TopNav` | 전역 네비게이션 바 | `app/layout.tsx` |
| `url-label-field.tsx` | `UrlLabelField` | URL+라벨 공용 편집 필드 | `app/maps/[mapId]/page.tsx` |
| `user-hover-card.tsx` | `UserHoverCard` | 유저 호버 카드 | `components/map-ownership-section.tsx`, `components/user-pill.tsx` |
| `user-pill.tsx` | `UserPill` | 사용자 필 | `app/feedback/page.tsx`, `app/inbox/page.tsx`, `app/notices/page.tsx`, `components/feedback-detail-modal.tsx`, `components/feedback-notes-flyout.tsx`, `components/subprocess-usage-tab.tsx` |
| `version-pill.tsx` | `VersionPill` | 상단바 버전 pill | `app/maps/[mapId]/page.tsx` |
| `visibility-bundle-picker.tsx` | `VisibilityBundlePicker` | 승인요청/셀프게시에 동봉할 가시성 변경 선택 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `window-dock.tsx` | `WindowDock` | 최소화된 스코프 창들의 좌하단 dock | `app/maps/[mapId]/page.tsx` |
| `withdraw-handoff.tsx` | `WithdrawHandoff` | 회수 모달 핸드오프 | `components/version/withdraw-confirm-dialog.tsx` |
| `word-create-modal.tsx` | `WordCreateModal` | Word 문서로 새 맵 만들기 | `app/maps/[mapId]/page.tsx`, `app/page.tsx`, `components/permissions/create-map-dialog.tsx`, `components/word-quick-create-dialog.tsx` |
| `word-quick-create-dialog.tsx` | `WordQuickCreateDialog` | Word 맵 빠른 생성 | `app/page.tsx` |
| `workflow-actions.tsx` | `WorkflowActions` | 버전 상태·역할에 따라 조건부 전이 버튼을 노출 (design 2026-06-14). | `components/approval-panel.tsx` |

## components/admin/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `admin-table.tsx` | `TableCard`, `RolePill` | 어드민 콘솔 표 공통 셸 | `components/admin/department-table.tsx`, `components/admin/employee-table.tsx`, `components/admin/framework-overview.tsx`, `components/admin/local-account-table.tsx` |
| `approval-queue.tsx` | `ApprovalQueue` | 시스템 관리자 승인 큐 | `app/settings/page.tsx` |
| `batch-runs-panel.tsx` | `BatchRunsPanel` | 배치 작업(DB 백업·HR 동기화) 최근 실행 상태 | `app/settings/page.tsx` |
| `deleted-groups-panel.tsx` | `DeletedGroupsPanel` | 삭제 예정(휴지통) | `app/settings/page.tsx` |
| `deleted-maps-panel.tsx` | `DeletedMapsPanel` | 삭제 예정(휴지통) | `app/settings/page.tsx` |
| `department-table.tsx` | `DepartmentTable` | 부서 탭 | `app/settings/page.tsx` |
| `dept-tree-picker.tsx` | `DeptTreePicker` | 부서 선택 모달 | `components/admin/department-table.tsx` |
| `employee-table.tsx` | `EmployeeTable` | 직원 디렉터리 + AD 전체 동기화 | `app/settings/page.tsx` |
| `export-csv-button.tsx` | `ExportCsvButton` | 관리자 테이블 CSV 내보내기 버튼 | `components/admin/department-table.tsx`, `components/admin/employee-table.tsx`, `components/notices/notices-manage-panel.tsx` |
| `framework-overview.tsx` | `FrameworkOverview` | 설정 Framework 탭 | `components/admin/framework-panel.tsx` |
| `framework-panel.tsx` | `FrameworkPanel` | 설정 Framework 탭 | `app/settings/page.tsx` |
| `import-governance-review.tsx` | `ImportGovernanceReview` | 재임포트 거버넌스 확인 | `components/admin/framework-panel.tsx` |
| `local-account-table.tsx` | `LocalAccountTable` | 로컬 계정(외부 컨설턴트) 관리 | `app/settings/page.tsx` |
| `notification-purge-modal.tsx` | `NotificationPurgeModal` | 알림 기간 퍼지 모달 | `components/admin/table-viewer.tsx` |
| `table-viewer.tsx` | `TableViewer` | DB 테이블 뷰어 | `app/settings/page.tsx` |

## components/charts/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `donut.tsx` | `Donut` | 작은 SVG 도넛 | `components/maps/approvals-card.tsx`, `components/maps/status-donut-card.tsx` |

## components/dashboard/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `access-sidebar.tsx` | `AccessSidebar` | 대시보드 우측 사이드바 | `components/settings/dashboard-panel.tsx` |
| `bar-chart.tsx` | `BarChart` | 시계열 세로 막대 | `components/settings/dashboard-panel.tsx` |
| `hbar-list.tsx` | `HBarList` | 가로 막대 리스트 | `components/settings/dashboard-panel.tsx` |
| `line-chart.tsx` | `LineChart` | 누적 성장 라인 | `components/settings/dashboard-panel.tsx` |
| `period-filter.tsx` | `PeriodFilter` | 기간 선택 | `components/settings/dashboard-panel.tsx` |

## components/groups/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `group-actions.tsx` | `GroupActions` | 그룹 라이프사이클 액션 | `app/groups/[groupId]/page.tsx`, `components/groups/groups-panel.tsx` |
| `group-detail.tsx` | `GroupDetail` | 그룹 상세(멤버 + 편집) | `app/groups/[groupId]/page.tsx`, `components/groups/groups-panel.tsx` |
| `groups-guide.tsx` | `GroupsGuide` | 유저 그룹 상단 안내 | `components/groups/groups-panel.tsx` |
| `groups-panel.tsx` | `GroupsPanel` | 유저 그룹 목록 + 생성 요청 | `app/settings/page.tsx` |

## components/interview/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `choice-card.tsx` | `ChoiceWindow`, `ChoiceOverlay` | 선택지 플로팅 창 + 오버레이 레이아웃 | `components/interview/interview-preview.tsx` |
| `draw-confirm-dialog.tsx` | `DrawConfirmDialog` | Draw map 확인 | `app/maps/[mapId]/consult/page.tsx` |
| `interview-outline.tsx` | `InterviewOutline` | facts 아웃라인 패널 | `components/interview/interview-preview.tsx` |
| `interview-panel.tsx` | `InterviewPanel` | 인터뷰 우측 대화 패널 | `app/maps/[mapId]/consult/page.tsx`, `components/interview/interview-preview.tsx` |
| `interview-preview.tsx` | `InterviewPreview` | 좌측 메인 프리뷰 | `app/maps/[mapId]/consult/page.tsx` |
| `params-table-dialog.tsx` | `ParamsTableDialog` | params 표 확정 모달 | `app/maps/[mapId]/consult/page.tsx` |
| `question-options.tsx` | `QuestionOptions` | 질문 툴박스 | `components/interview/interview-panel.tsx` |

## components/map-settings/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `checkout-requests-panel.tsx` | `CheckoutRequestsPanel` | 맵별 점유권 요청 대기 패널 | `app/maps/[mapId]/settings/page.tsx` |

## components/maps/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `approvals-card.tsx` | `ApprovalsCard` | 홈 대시보드 | `components/maps/home-dashboard.tsx` |
| `category-summary-card.tsx` | `CategorySummaryCard` | 홈 Framework 뷰 | `app/page.tsx` |
| `clamped-list.tsx` | `ClampedList` | 맵 카드 리스트 3.5개 높이 클램프 | `components/maps/framework-tree.tsx`, `components/maps/my-dept-favorites.tsx`, `components/maps/org-accordion.tsx` |
| `count-tag.tsx` | `CountTag` | 맵 개수 태그 | `components/admin/framework-panel.tsx`, `components/maps/framework-tree.tsx`, `components/maps/my-dept-favorites.tsx`, `components/maps/org-accordion.tsx` |
| `dashboard-map-row.tsx` | `DashboardMapRow` | 대시보드 컴팩트 맵 행 | `components/maps/recent-opened-list.tsx`, `components/maps/status-donut-card.tsx` |
| `delete-map-dialog.tsx` | `DeleteMapDialog` | 맵 삭제 확인 | `components/maps/map-detail-card.tsx`, `components/permissions/danger-zone.tsx` |
| `dept-group-box.tsx` | `DeptGroupBox` | 부서 헤더 행 + 그 부서가 직접 가진 맵 카드를 묶는 박스. | `components/maps/framework-tree.tsx`, `components/maps/my-dept-favorites.tsx`, `components/maps/org-accordion.tsx` |
| `dept-level-icon.tsx` | `DeptLevelIcon` | 부서 조직 레벨 아이콘 | `components/bpm-attribute-picker.tsx`, `components/maps/map-detail-card.tsx`, `components/permissions/attribute-tiles.tsx`, `components/permissions/principal-picker.tsx` |
| `filter-dropdown.tsx` | `FilterDropdown` | 홈 목록 필터용 멀티셀렉트 드롭다운 | `components/maps/home-filter-pills.tsx` |
| `framework-assign-modal.tsx` | `FrameworkAssignModal` | 업무 체계 카테고리 연결/해제 + 슬롯 이양 | `components/maps/map-detail-card.tsx` |
| `framework-tree.tsx` | `FrameworkTree` | 홈 Framework 뷰 | `app/page.tsx` |
| `home-dashboard.tsx` | `HomeDashboard` | 홈 우측 | `app/page.tsx` |
| `home-filter-pills.tsx` | `HomeFilterPills` | 홈 상태·권한·오우닝·SP 필터 필 4종 | `app/page.tsx` |
| `home-skeleton.tsx` | `HomeSkeleton` | 홈 첫 진입 자리 | `app/page.tsx` |
| `map-card.tsx` | `MapCard` | 홈 프로세스맵 카드 | `app/page.tsx`, `components/maps/my-dept-favorites.tsx`, `components/maps/org-accordion.tsx` |
| `map-detail-card.tsx` | `MapDetailCard` | 선택된 맵 상세 | `app/maps/[mapId]/page.tsx`, `app/page.tsx`, `components/map-inspector-tab.tsx` |
| `map-fallback-notes.tsx` | `MapFallbackNotes` | 맵 단위 인터뷰 원문 메모 5종(GMP·빈도·총시간·실작업·시스템) | `app/maps/[mapId]/compare/page.tsx`, `app/maps/[mapId]/page.tsx`, `components/maps/map-detail-card.tsx` |
| `map-notes-section.tsx` | `MapNotesSection` | 맵/L5 노트 섹션 | `app/maps/[mapId]/page.tsx`, `components/maps/map-detail-card.tsx`, `components/node-summary-modal.tsx` |
| `my-dept-favorites.tsx` | `MyDeptFavorites` | 홈 좌측 상단 | `app/page.tsx` |
| `org-accordion.tsx` | `OrgAccordion` | 홈 좌측 | `app/page.tsx` |
| `recent-opened-list.tsx` | `RecentOpenedList` | 홈 대시보드 최상단 | `components/maps/home-dashboard.tsx` |
| `status-donut-card.tsx` | `StatusDonutCard` | 홈 대시보드 | `components/maps/home-dashboard.tsx` |
| `sticky-box-header.tsx` | `StickyBoxHeader` | 틴트 박스 헤더의 스티키 래퍼 | `components/maps/framework-tree.tsx`, `components/maps/my-dept-favorites.tsx`, `components/maps/org-accordion.tsx` |
| `version-timeline.tsx` | `VersionTimeline` | 버전 히스토리 | `components/maps/map-detail-card.tsx` |
| `welcome-placeholder.tsx` | `WelcomePlaceholder` | 빈 상태/미선택 자리 | `app/page.tsx` |
| `word-docs-section.tsx` | `WordDocsSection` | 홈 Word documents 섹션 | `app/page.tsx` |

## components/notices/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `date-range-calendar.tsx` | `DateRangeCalendar` | 게시기간 date-range 캘린더 | `components/notices/notice-edit-modal.tsx` |
| `notice-edit-modal.tsx` | `NoticeEditModal` | 공지 등록/수정 모달 | `components/notices/notices-manage-panel.tsx` |
| `notices-manage-panel.tsx` | `NoticesManagePanel` | 설정 · 공지사항 관리 | `app/settings/page.tsx` |

## components/permissions/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `add-collaborator.tsx` | `AddCollaborator` | 협업자 추가 피커+역할 선택 | `components/maps/map-detail-card.tsx`, `components/permissions/collaborators-panel.tsx` |
| `approvers-panel.tsx` | `ApproversPanel` | 결재자 관리 패널 | `app/maps/[mapId]/settings/page.tsx` |
| `attribute-tiles.tsx` | `DeptAssigneeTiles` | 부서·담당자 타일 쌍 | `components/node-summary-modal.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `collaborators-panel.tsx` | `CollaboratorsPanel` | 협업자 관리 패널 | `app/maps/[mapId]/settings/page.tsx` |
| `create-map-dialog.tsx` | `CreateMapDialog` | 맵 생성 다이얼로그 | `app/page.tsx`, `components/map-name-dropdown.tsx`, `components/process-library-panel.tsx` |
| `danger-zone.tsx` | `DangerZone` | 위험 구역 | `app/maps/[mapId]/settings/page.tsx` |
| `hover-swap-pill.tsx` | `HoverSwapPill` | 호버 스왑 필 | `components/maps/map-detail-card.tsx`, `components/permissions/collaborators-panel.tsx`, `components/permissions/pending-change-pill.tsx` |
| `loading-skeleton.tsx` | `SkeletonRows`, `SkeletonPills` | 로딩 스켈레톤 | `components/admin/framework-overview.tsx`, `components/admin/local-account-table.tsx`, `components/permissions/approvers-panel.tsx`, `components/permissions/collaborators-panel.tsx` |
| `map-details-panel.tsx` | `MapDetailsPanel` | 맵 정보 탭 | `app/maps/[mapId]/settings/page.tsx` |
| `pending-approvals-panel.tsx` | `PendingApprovalsPanel` | 맵별 결재 대기 패널 | `app/maps/[mapId]/page.tsx`, `app/maps/[mapId]/settings/page.tsx` |
| `pending-change-pill.tsx` | `PendingChangePill` | 권한 변경 승인 대기 필 | `components/maps/map-detail-card.tsx`, `components/permissions/collaborators-panel.tsx` |
| `principal-picker.tsx` | `PrincipalIcon`, `PrincipalPicker` | 협업자 추가용 피커 | `components/admin/framework-panel.tsx`, `components/approver-manager.tsx`, `components/groups/group-detail.tsx`, `components/groups/groups-panel.tsx`, `components/maps/map-detail-card.tsx`, `components/permissions/add-collaborator.tsx`, `components/permissions/approvers-panel.tsx`, `components/permissions/collaborators-panel.tsx`, `components/permissions/create-map-dialog.tsx`, `components/permissions/map-details-panel.tsx`, `components/permissions/undo-last-apply-modal.tsx`, `lib/dept-browse.ts` |
| `process-fields-card.tsx` | `ProcessFieldsCard` | 설정 > 상세 | `app/maps/[mapId]/settings/page.tsx` |
| `role-badge.tsx` | `RoleBadge` | 권한 역할 표시 뱃지 | `components/maps/map-card.tsx`, `components/maps/map-detail-card.tsx`, `components/permissions/collaborators-panel.tsx` |
| `role-popover.tsx` | `RolePopover` | 클릭 위치(또는 Enter 폴백 좌표) 기준 역할 팝오버 | `components/permissions/add-collaborator.tsx`, `components/permissions/create-map-dialog.tsx` |
| `sp-field-popover.tsx` | `SpFieldPopover` | 타일 입력 팝오버 | `components/node-summary-modal.tsx`, `components/permissions/attribute-tiles.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `sp-field-tile.tsx` | `SpFieldTile` | 필드 타일 | `components/node-summary-modal.tsx`, `components/permissions/attribute-tiles.tsx`, `components/permissions/subprocess-designation-modal.tsx`, `components/subprocess-usage-tab.tsx` |
| `subprocess-designation-modal.tsx` | `SubprocessDesignationModal` | 서브프로세스 지정/수정 모달 | `app/inbox/page.tsx`, `components/permissions/subprocess-designation-panel.tsx`, `components/subprocess-inspector-card.tsx`, `components/subprocess-usage-tab.tsx` |
| `subprocess-designation-panel.tsx` | `SubprocessDesignationPanel` | 서브프로세스 지정 패널 | `app/maps/[mapId]/settings/page.tsx` |
| `undo-last-apply-modal.tsx` | `UndoLastApplyModal` | 되돌리기 확인 모달 | `components/maps/map-detail-card.tsx`, `components/permissions/collaborators-panel.tsx` |
| `versions-publish-panel.tsx` | `VersionsPublishPanel` | 버전 게시 패널 | `app/maps/[mapId]/settings/page.tsx` |
| `visibility-control.tsx` | `VisibilityControl` | 맵 공개 범위 제어 | `app/maps/[mapId]/settings/page.tsx` |

## components/settings/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `ai-chat-settings-panel.tsx` | `AiChatSettingsPanel` | AI 챗 설정(sysadmin) | `app/settings/page.tsx` |
| `ai-prompts-panel.tsx` | `AiPromptsPanel` | AI 프롬프트 관리 패널 | `app/settings/page.tsx` |
| `dashboard-panel.tsx` | `DashboardPanel` | 운영 대시보드 | `app/settings/page.tsx` |
| `kb-manage-panel.tsx` | `KbManagePanel` | 설정 · 지식기반 라이브러리(P2) | `app/settings/page.tsx` |
| `manual-manage-panel.tsx` | `ManualManagePanel` | 설정 · 매뉴얼 편집·게시 | `app/settings/page.tsx` |

## components/version/

| 파일 | 컴포넌트 | 역할 | 사용처 |
|------|----------|------|--------|
| `approve-confirm-dialog.tsx` | `ApproveConfirmDialog` | 승인 확인 다이얼로그 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `approver-status-lines.tsx` | - | 승인자별 상태 라인 빌더 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx`, `components/version/approve-confirm-dialog.tsx`, `components/version/reject-dialog.tsx`, `components/version/withdraw-confirm-dialog.tsx` |
| `comment-history-modal.tsx` | `CommentHistoryModal` | 버전 코멘트 이력 모달 | `components/maps/version-timeline.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `publish-confirm-dialog.tsx` | `PublishConfirmDialog` | 게시 확인 다이얼로그 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `reject-dialog.tsx` | `RejectDialog` | 반려 다이얼로그 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `requester-comment-banner.tsx` | `RequesterCommentBanner` | 승인/반려 모달 배너 | `app/inbox/page.tsx`, `app/maps/[mapId]/compare/page.tsx`, `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx`, `components/version/approve-confirm-dialog.tsx`, `components/version/reject-dialog.tsx`, `components/version/submit-confirm-dialog.tsx` |
| `submit-confirm-dialog.tsx` | `SubmitConfirmDialog` | 승인요청 확인 다이얼로그 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |
| `transfer-checkout-dialog.tsx` | `TransferCheckoutDialog` | 점유권 이전 다이얼로그 | `app/maps/[mapId]/page.tsx` |
| `version-switch-confirm.tsx` | `VersionSwitchConfirm` | 버전 전환 확인 | `app/maps/[mapId]/page.tsx`, `components/version-pill.tsx` |
| `withdraw-confirm-dialog.tsx` | `WithdrawConfirmDialog` | 회수 확인 다이얼로그 | `app/maps/[mapId]/page.tsx`, `components/permissions/versions-publish-panel.tsx` |

