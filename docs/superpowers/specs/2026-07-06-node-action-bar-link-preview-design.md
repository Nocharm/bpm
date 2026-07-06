# 노드 액션 바 + 링크 미리보기 패널 — 설계

2026-07-06 · 브랜치 `feat/url-viewer` · 프론트 전용(백엔드/DB 무변경)

## 1. 목표

캔버스 메인 뷰에서 단일 노드 포커싱 시 흩어져 있던 하위 액션(하위프로세스 펼침 — 노드 우측 위, 그룹 나가기 — 그룹 박스 우측 위)을 **노드 하단 중앙의 세로 통합 액션 바** 하나로 모으고, 노드의 `url`을 **우측 슬라이드 미리보기 브라우저 패널**로 편집 흐름을 벗어나지 않고 열람한다.

참고 산출물: `/Users/hyeonjin/Desktop/NewDesign/Node Focus Actions.dc.html` + 스크린샷 3종(정확한 치수·색·keyframes의 출처).

## 2. 확정 결정사항 (브레인스토밍 Q&A)

| 항목 | 결정 |
|---|---|
| 버튼 순서 | **스펙 텍스트 순서 고정**: 펼치기/접기 → 링크 열기 → 그룹 나가기 (목업 HTML의 링크-우선 순서는 폐기) |
| readOnly에서 링크 열기 | **노출** — 읽기 전용 열람 액션 |
| readOnly에서 펼치기 | **노출** — 현재도 뷰어가 캔버스에서 펼침 가능(임베드는 읽기전용), 회귀 방지 |
| readOnly에서 그룹 나가기 | 숨김 (편집 액션) |
| 다중 그룹 소속 | 버튼 1개 → **소속 그룹 전부 탈퇴** (클릭 1회에 groupIds 전체 제거) |
| 목업 좌하단 힌트 라벨 | 미포함 (에디터 밀도 룰, 발견성은 선택 즉시 바 노출로 충분) |
| 패널 폭 | 520px (목업 확정값) |

## 3. 컴포넌트 1 — `NodeActionBar` (`frontend/src/components/node-action-bar.tsx`, 신규)

`NodeSelectionRing`(`node-selection-ring.tsx`)과 동일 패턴의 독립 store-구독 컴포넌트.

### 렌더 위치·좌표
- page.tsx `<ViewportPortal>` 안, `NodeSelectionRing` 옆에 마운트(≈L6559). `NodeActionsContext.Provider`(L6109) 내부이므로 `useNodeActions()` 소비 가능.
- `useStore`(custom equality)로 `nodeLookup`에서 `selected === true` && `measured` 크기 보유 노드를 수집. **정확히 1개**일 때만 렌더(다중 선택·무선택 숨김). 해당 노드 `dragging`이면 렌더 생략.
- flow 좌표 배치: `translate(x + w/2, y + h + 13px)` + `translateX(-50%)`. 세로 스택 `gap 7px`, `zIndex 8`, `min-width 172px`. 상단 중앙 1px×7px 커넥터 선(`--color-accent-tint-border`). 팬/줌 정합은 ViewportPortal flow 좌표로 자동.
- 임베드 자식(prop-only)은 클릭 선택 불가라 자연 배제 + measured 가드 이중 방어 (`docs/lessons/canvas-react-flow.md` §2·§3).

### Props
```ts
interface NodeActionBarProps {
  readOnly: boolean;
  onLeaveGroup: (groupIds: string[]) => void;
  onOpenLink: (url: string) => void;
}
```
펼침 토글·상태는 props가 아니라 `useNodeActions()`의 `onToggleExpand`/`expandedInlineIds`.

### 버튼 (위→아래 고정, 조건 참인 항목만 렌더)
| # | 버튼 | 조건 | 액션 |
|---|---|---|---|
| 1 | 하위 프로세스 펼치기/접기 | `nodeType === "subprocess" && (subEnds?.length ?? 0) > 0 && !locked && !undesignated` (readOnly 무관) | `onToggleExpand(id)` — 기존 `toggleInlineExpand` 경로(중첩 접기·확장 한도 캡 포함) 그대로. 라벨은 `expandedInlineIds.has(id)`로 expand/collapse 토글, 셰브론 180° 회전 |
| 2 | 링크 열기 | `isHttpUrl(data.url)` (아래 §5) — readOnly에서도 노출 | `onOpenLink(data.url)` → 패널 오픈. 라벨에 URL 원문 미노출 |
| 3 | 그룹 나가기 | `!readOnly && data.groupIds.length > 0` | `onLeaveGroup(data.groupIds)` — page.tsx에서 전 그룹 제거를 **한 번의** setNodes + `pruneSmallGroups` + `scheduleAutoSave`로 처리(기존 `leaveGroup` 로직 일반화, undo/저장 경로 동일) |

### 스타일 (raw hex 금지 — 토큰 매핑)
- 공통: 높이 32px, radius 8px, 12px/600, `bg-surface`, 그림자 `--shadow-lg`(목업의 `0 6px 18px rgba(22,22,29,.14)`는 커스텀 값이라 플로팅 크롬 토큰으로 대체).
- 펼치기·링크(액센트 버튼): 보더 `--color-accent-tint-border`(#d7ccff), 텍스트 `--color-accent-focus`(#5733e0), hover `bg` 액센트 틴트 계열, 아이콘 칩 20×20 r5 `--color-accent-tint`(#efebff) + 아이콘 stroke `--color-accent`.
- 그룹 나가기(중립→위험 hover): 보더 `--color-hairline`, 텍스트 중립, hover 시 error 토큰 계열(배경 틴트·보더·텍스트).
- 아이콘 Lucide strokeWidth 1.5: `ChevronDown`(회전), `Link2`, `LogOut`.
- 접근성/테스트: 각 버튼 `aria-label` + `data-id`(`node-action-expand` / `node-action-link` / `node-action-leave-group`).

### 기존 위치 제거
- page.tsx L6628–6649: 그룹 박스 우측 위 나가기 버튼 블록 삭제. `selectedGroupIds` memo(L5331)는 다른 사용처 없으면 함께 제거.
- `process-node.tsx`: `ExpandToggleButton` 정의(L333–358) 및 콜사이트 3곳 제거 — subprocess(L458–464 분기의 토글만), process/decision/terminal(L503, L541 — **죽은 코드**: 백엔드가 `has_children`을 보내지 않아 `data.hasChildren`은 항상 false, 렌더된 적 없음). `UndesignatedBadge`/`LockedBadge`·펼침 시 노드 시각 표현은 유지. `api.ts`의 `has_children` 필드는 이번 스코프에서 건드리지 않음.

### i18n (en/ko 동시 — tsc 강제)
```
node.action.expand   "Expand subprocess"   / "하위 프로세스 펼치기"
node.action.collapse "Collapse subprocess" / "하위 프로세스 접기"
node.action.openLink "Open link"           / "링크 열기"
group.leave          (기존 키 재사용)
```

## 4. 컴포넌트 2 — `LinkPreviewPanel` (`frontend/src/components/link-preview-panel.tsx`, 신규)

`feedback-side-panel.tsx`(L73–89)의 슬라이드 오버레이 패턴.

### 상태·계약
- page.tsx: `linkPreviewUrl: string | null` 하나만 보유(non-null = 열림). 패널 props `{ url: string | null, onClose: () => void }`.
- 내부 상태: `loading`, `failed`, `reloadKey`. 컴포넌트는 상시 마운트(슬라이드 아웃 전환용), `url === null`이면 iframe unmount(백그라운드 로드 방지).
- `Esc` 닫기(열림 동안 keydown 리스너), 닫힘/언마운트 시 6s 타이머·리스너 정리. 패널 오픈 중 캔버스 선택/스코프 상태 불변.

### 레이아웃
- 스크림: `fixed inset-0 bg-ink/20`, opacity 전환 .3s, 클릭 시 닫힘.
- 패널: `fixed right-0 top-0 h-full w-[520px] bg-surface border-l border-hairline`, 좌측 그림자 `--shadow-lg`(목업 `-16px 0 44px` 커스텀 값 대체, 시각 확인 후 부족하면 전용 토큰 추가), 전환 `translate-x-full → translate-x-0` + `duration-350 ease-spring`(목업 `.34s cubic-bezier(.22,1,.32,1)`와 동등). 인스펙터 포함 우측 전체를 덮는 z-order(기존 feedback 1200/1300 아래 계층).

### 브라우저 크롬
- 1행(44px, surface-pearl 톤, 하단 헤어라인): `Link2` 아이콘 + `linkPreview.title` 라벨, 우측에 새 탭 열기(`window.open(url, "_blank", "noopener")`, `ExternalLink`)·닫기(X).
- 2행(주소 줄): 뒤로/앞으로 **비활성 고정**(cross-origin iframe history 접근 불가 — 스펙 허용), 새로고침(`reloadKey++` → iframe 재마운트 + 로딩 재진입), `Lock` 아이콘 + URL 읽기전용 말줄임.

### 콘텐츠 — iframe·로딩·폴백
- `<iframe key={reloadKey} src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />`
- `onLoad` → `loading = false`. **6s 타임아웃** 내 load 미발생 → `failed = true` 폴백 카드(목업 플레이스홀더 카드 스타일): 글로브 아이콘 칩 + `linkPreview.blocked` + "새 탭에서 열기" 버튼 + URL 박스. X-Frame-Options/CSP 차단은 완벽 감지 불가 → load+타임아웃 조합, 새 탭 버튼은 크롬에 상시 존재.
- 로딩 UI(`loading === true`, keyframes는 `lp-*` 접두로 globals.css에 추가 — `.react-flow__node` 무관이라 Turbopack purge 함정 없음):
  - 상단 3px 진행 바: 액센트 파생 그라데이션(`var(--color-accent)` 기반), width 4%→88% keyframe.
  - 중앙: `Globe` 펄스(1.3s ease-in-out) + 회전 링(border-top만 액센트, .85s linear).
  - 하단: `linkPreview.loading` + 점 3개 순차 페이드(1.1s).

### i18n (en/ko)
```
linkPreview.title      "Linked page"                            / "연결된 링크"
linkPreview.openNewTab "Open in new tab"                        / "새 탭에서 열기"
linkPreview.refresh    "Reload"                                 / "새로고침"
linkPreview.close      "Close"                                  / "닫기"
linkPreview.back       "Back"                                   / "뒤로"
linkPreview.forward    "Forward"                                / "앞으로"
linkPreview.loading    "Loading page"                           / "페이지를 불러오는 중"
linkPreview.blocked    "This site can't be embedded in preview" / "이 사이트는 미리보기(임베드)를 지원하지 않습니다"
```

## 5. URL 가드 (보안 — XSS 백로그 해소)

- 공용 헬퍼 `isHttpUrl(v?: string): boolean` — `/^https?:\/\//i` 매칭만 통과. 액션 바 노출 조건과 iframe 로드 게이트가 **같은 헬퍼**를 공유해 `javascript:`/`data:` 등 차단.
- 서버가 평문 HTTP인 현 배포에서 http iframe은 동작. 향후 HTTPS 전환 시 http 링크는 mixed content로 차단될 수 있음 — 폴백 UI가 해당 케이스 커버.

## 6. 비변경·제약

- 백엔드/DB 무변경 (`NodeData.url`·`groupIds`·`subEnds`·`locked`·`undesignated` 기존 필드만 사용).
- `leaveGroup`·`toggleInlineExpand`의 undo/자동저장 경로 그대로 — 트리거 위치만 이동, 신규 상태 전이 로직 금지.
- React Compiler: 신규 훅/콜백은 `react-hooks/preserve-manual-memoization` 주의(단순 setState 핸들러는 plain function).
- id 생성 필요 시 `genId()`(`@/lib/id`) — `crypto.randomUUID` 금지.

## 7. 검증 계획

- 기존 스모크 스크립트는 캔버스 토글·그룹 나가기 버튼을 직접 참조하지 않음(아웃라인 aria-label 기반 → 무영향). 신규 `data-id` 기반 Playwright 스모크 추가: 노드 선택 → 바 노출·버튼 순서 → 펼침 토글 → 링크 열기 → 패널 오픈·로딩 → Esc 닫기 → 그룹 나가기 반영.
- `npm run lint` / `npm run build` 클린, 팬/줌 중 바-노드 정합 육안 확인(브라우저 검증 하네스), 다중 선택·드래그 중 숨김 확인.
- 작업 단위별 커밋 + PROGRESS.md 동시 갱신.
