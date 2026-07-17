# Main Tabs UX Refresh — Design (2026-07-17)

메인 탭(Maps · Inbox · Notices)과 Feedback 패널의 특정 페인포인트를 개선한다. 전면 리디자인이 아니라 **죽은 공간 활용 + 인지성 개선 + 조직도 그룹화 + 가벼운 대시보드화**에 집중한다. **백엔드 변경 없음** — 전 항목이 기존 엔드포인트만 사용한다.

## 0. Context & Base State

- **Branch**: `worktree-main-tabs-ux` (worktree `.claude/worktrees/main-tabs-ux`), base = dev `0b72270`.
- **dev가 이미 제공(재작업 안 함)**: Inbox 알림 카테고리 아이콘+필터(`frontend/src/lib/notification-categories.ts` 5카테고리 `version|checkout|permission|subprocess|notice`, `getNotificationCategory`, `NOTIFICATION_CATEGORIES` + `inbox/page.tsx`의 `categoryFilter`·`CATEGORY_ICONS`·`IconPillFilter`·`typeIcon`). `sp_description` 필드, 알림 삭제/퍼지 API도 존재(무관).
- **미변경(main과 동일)**: `frontend/src/app/page.tsx`(홈), `notices/page.tsx`, `feedback/page.tsx`, `components/top-nav.tsx`, `components/feedback-side-panel.tsx`, `components/maps/map-card.tsx`, `components/maps/map-detail-card.tsx`.
- **재사용 자산**: `getDirectory()`/`useDirectory()`(`lib/directory.ts`), `getMe()`(`Me.org_path`·`Me.department`), `listInboxApprovals()`, `listMaps()`, `getRecentMaps()`(`lib/recent-maps.ts`), `approval-panel.tsx`의 `currentStage(status)` 파이프라인 단계 로직, `lib/feedback-meta.ts` 라벨/스타일.
- **차트**: 기존 `components/dashboard/`에 bar/hbar/line/stat만 있고 **도넛 없음** → 작은 self-contained SVG 도넛 신규(`components/charts/donut.tsx`).

## 1. Maps 좌측 — 나의 부서 즐겨찾기 + 오우닝 부서 조직도 아코디언

**목표**: 좌측 맵 리스트를 (a) 상단 "나의 부서" 즐겨찾기 + (b) owning department 조직도 아코디언으로 재구성. 기존 최근 밴드는 우측 대시보드로 이동.

**데이터**
- 그룹 키 = `MapSummary.owning_department` (org_path, `/` 구분, 1–5 레벨, 명시적 부모 없음 — prefix로 계층 암시).
- 트리 = `GET /directory` → `departments: DirectoryDept[]`(`id`=full org_path, `name`=리프, `korean_name`). `DirectoryDept.id`를 `/`로 split → 부모=prefix. 순수함수 `lib/org-tree.ts`(테스트 대상).
- 나의 부서 = `getMe().org_path`. 즐겨찾기 대상 = `owning_department === myOrgPath || owning_department.startsWith(myOrgPath + "/")`(내 부서 + 하위 팀).

**구조 (브라우즈 모드 = 검색어·상태/권한/가시성 필터 모두 없음)**
```
[🔍 search maps ............]
[ All | Public | Private ]
[Status ▾] [Role ▾] [Subprocess ▾]           ← Subprocess 토글 신규(선택)
─────────────────────────────────────
★ My department — Procurement Office   (3)   ← 즐겨찾기(핀 고정, 접기 가능)
   • Purchase Flow            v4 ●  [SP]
   • Vendor Mgmt              published
─────────────────────────────────────
Departments                 [⌄ Collapse all]  ← 모두 접기 버튼
▼ Management Support Division            (8)
   ▼ Procurement Office                  (3)
      • Purchase Flow          v4 ●  [SP]
   ▸ Finance Office                      (5)
▸ R&D Division                          (12)
▸ Unassigned department                  (3)   ← owning_department=null 폴백
```
- 리프 팀 노드가 소유 맵(`MapCard`, **디자인 그대로** + `[SP]` 배지)을 담고, 상위 부서 노드는 접기/펼치기 + 롤업 카운트.
- **모두 접기** 버튼: 아코디언 전체 부서 노드 collapse. (모두 펼치기는 1st cut 생략 가능 — 필요 시 추가.)
- 펼침 상태 `sessionStorage` 유지(키 예 `bpm.home.orgOpen`, 즐겨찾기 접힘은 `bpm.home.favOpen`). 초기: 내 부서 subtree 펼침, 나머지 접힘.
- **검색·필터 활성 → 기존 평면 목록**(현행 유지, 즐겨찾기·아코디언 숨김). 아코디언·즐겨찾기는 브라우즈 전용. 아코디언 모드에서는 기존 권한 그룹 경계선·최근 밴드 로직 미적용.
- **선택 자동 펼침**: 우측 대시보드에서 맵 선택(§2) 시 좌측 아코디언이 해당 부서 경로를 자동 펼치고 그 카드로 스크롤·하이라이트(포커스).

**`[SP]` 배지**: `sp_designated_at != null`이면 `MapCard`와 `MapDetailCard`(§2b) 양쪽에 작은 배지 1개. 카드 나머지 레이아웃/스타일 불변.

**파일**: `frontend/src/app/page.tsx`(좌측 렌더 분기), 신규 `components/maps/org-accordion.tsx`·`components/maps/my-dept-favorites.tsx`, `lib/org-tree.ts`(테스트), `components/maps/map-card.tsx`([SP] 배지).

**Out of scope**: 부서장/조직 관리, owning_department 편집(설정에 존재).

## 2. Maps 우측 — 홈 대시보드 (미선택 시) + 차트

**목표**: 미선택 우측 aside(`home.detailEmpty`, `page.tsx:695`)를 대시보드로 대체. **목록만으로 단조롭지 않게 도넛 차트 도입.** 맵 선택 시 = §2b `MapDetailCard`.

**레이아웃** (넓은 폭은 2단, 좁으면 세로 스택. **최근 접속이 최상단/좌상단**)
```
┌──────────────────────────────────────────────────────────────┐
│ Recently opened                                     see all   │  ← 최상단, 전폭
│ [row][row][row][row]        (스태거 진입 애니메이션 §2 하단)   │
│ ─────────────────────────────────────────────────────────────│
│ ┌ My documents ───────────────┐ ┌ Needs approval ───────────┐│
│ │  (donut: 상태별)             │ │  (donut/bar: 단계별)       ││
│ │  ● draft 3 ○ pending 1 …     │ │  pending 2                 ││
│ │  ── list(선택 상태=draft) ───│ │  ── list ──────────────────││
│ │  ▸ Purchase Flow            │ │  ▸ Sales Order v4 (pending)││
│ │  ▸ Vendor Setup             │ │  ▸ HR Flow v2 (pending)    ││
│ └──────────────────────────────┘ └────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**섹션 1 — Recently opened (최상단)**
- `getRecentMaps()` ∩ 접근 가능 맵, 최신순. 각 행 = §2 하단 공용 `dashboard-map-row`.
- **진입 애니메이션(사용자 요청 ②)**: 오작동이 아니라 순서 변화 비가시성이 문제. 맵 탭 복귀/재로딩 시 최근 top id가 직전과 다르면(sessionStorage `bpm.home.recentTop` 대비) **새 항목이 위에서 내려오며 아래가 밀리는 스태거 진입** 재생 → 갱신 인지. top 무변화면 미재생. `prefers-reduced-motion` 가드. 패턴 참조 `excel-export-modal.tsx`.

**섹션 2 — My documents (도넛 + 상태별 목록)**
- 데이터: `listMaps()`에서 `my_role === "owner"`, `latest_version_status`로 그룹.
- **도넛**: 상태별 카운트(draft/pending/approved/published/rejected/expired). 세그먼트 클릭 → 아래 목록이 그 상태로 필터. **기본 선택 = `draft`**(미완성 초안). 0건 상태는 도넛에서 생략.
- 목록: 선택 상태의 맵들, 각 행 = 공용 `dashboard-map-row`.

**섹션 3 — Needs approval (단계 그래프 + 목록) — 백엔드 무변경**
- 데이터: `listInboxApprovals()` (내가 결정할 대기 큐). `kind` = version_approval / checkout_transfer / approval_request.
- **그래프**: kind별(또는 version_approval의 status 단계) 분포 도넛/바. 각 version_approval 행은 `currentStage(status)`(draft→pending→approved→published) 미니 단계 표시.
- 목록: 대기 항목, 각 행 클릭 → 해당 맵 선택(§2b) 또는 version 이동. 0건이면 "✓ All caught up".
- **범위 주의**: `InboxApproval`엔 승인수/총승인자 없음 → 단계는 status 파생만. 실 진행도(N명 중 M명)는 이번 스코프 밖.

**§2b — MapDetailCard `[SP]` 표시**
- 맵 상세카드 헤더/메타에 `sp_designated_at != null`이면 `[SP]` 배지(§1 배지와 동일 스타일). `components/maps/map-detail-card.tsx`.

**공용 `dashboard-map-row` 인터랙션 (사용자 요청)**
- **hover → `[Open →]` 버튼 노출**: 클릭 시 `/maps/{id}` 에디터로 이동(navigate).
- **버튼 외 영역 클릭 → 맵 선택**: `setSelectedId(id)` → 우측이 대시보드→`MapDetailCard`로 전환 + 좌측 아코디언이 해당 부서로 자동 펼침·포커스(§1). 빈 배경 클릭으로 선택 해제하면 대시보드 복귀.

**파일**: `frontend/src/app/page.tsx`(우측 aside 분기 + selectedId 연동), 신규 `components/maps/home-dashboard.tsx`·`recent-opened-list.tsx`·`status-donut-card.tsx`·`approvals-card.tsx`·`dashboard-map-row.tsx`, `components/charts/donut.tsx`(SVG). i18n 키 추가.

## 3. Feedback 패널 — 최근 피드백 + 진행상황

**목표**: 작성폼 아래 남는 공간에 최근 피드백 카드. 카드/"보러가기" → 피드백 페이지 해당 글 상세 모달.

**동작**
- `listFeedback()` → **내 피드백**(author === `getCurrentUser()` login_id) 최신순 N개(예 5). 카드 = `kind` 아이콘 + `body` 발췌 + 상태칩(`draft`/`in_progress`/`done`, `lib/feedback-meta.ts` 재사용).
- 클릭 → `router.push("/feedback?feedback=<id>")` 후 패널 닫기.
- **딥링크(신규)**: `feedback/page.tsx` 마운트 시 `?feedback=<id>` 읽어 `selectedId` seed → `FeedbackDetailModal` 자동 오픈. 닫으면 `router.replace`로 param 제거(새로고침 재오픈 방지).
- 위치: 작성폼(kind 세그먼트+textarea+Cancel/Submit) 아래. 목록 없으면 섹션 비표시. 스크롤은 목록 영역만.

**파일**: `components/feedback-side-panel.tsx`(하단 목록), `app/feedback/page.tsx`(딥링크). i18n 키 추가.

**Out of scope**: 피드백 작성/수정/삭제/상태전이 로직.

## 4. Inbox 미선택 우측 — 활동 요약 다이제스트

**목표**: 우측 detail aside 미선택 placeholder(`inbox.selectPrompt`/`inbox.approvalsSelectPrompt`)를 활동 요약으로 대체.

**동작**
- Notifications 탭 미선택 → 카테고리별 건수(`NOTIFICATION_CATEGORIES`+`getNotificationCategory` 재사용) + 미읽음 수. "Select a notification →" 유지.
- Approvals 탭 미선택 → 대기 승인 건수, 0건이면 "✓ All caught up".
- 이미 로드된 `items`/`approvals` state 파생(추가 fetch 없음).

**파일**: `app/inbox/page.tsx`(우측 aside 미선택 분기), 신규 `components/activity-digest.tsx`(Notices와 형태 공유). i18n 키 추가.

## 5. Notices 미선택 우측 — 활동 요약 다이제스트

**목표**: `notices/page.tsx` `notices.selectPrompt`(`:230`, `notice-detail-aside`)를 다이제스트로 대체.

**동작**: 미읽음/전체 건수 + 최신 중요(important) 공지 1건 강조(클릭 시 선택). 읽음은 기존 클라 캐시(`notices-read`). 추가 fetch 없음. §4 `activity-digest` 뷰 공유.

**파일**: `app/notices/page.tsx`(우측 aside 미선택 분기). i18n 키 추가.

## 6. Cross-cutting

- **i18n**: 신규 문자열 전부 `lib/i18n-messages.ts` ko/en 동시(하드코딩 금지). UI 영어 기본.
- **디자인 토큰**: raw hex 금지, 토큰/`var(--color-*)`만. Lucide 16px strokeWidth 1.5. 라이트 전용. 도넛 세그먼트 색도 토큰 팔레트(상태색은 `VERSION_STATUS_STYLE` 계열 재사용).
- **React Compiler 함정**: setState-only 핸들러는 plain 함수, effect 내 동기 setState 금지(reloadKey/anchor 파생). `frontend/AGENTS.md` 준수.
- **id 생성**: `genId()`(`crypto.randomUUID` 금지).
- **KST**: 상대시각/타임스탬프는 `lib/datetime` 사용(browser tz 금지).

## 7. Verification

- **vitest**: `lib/org-tree.ts`(org_path[]→트리, Unassigned, prefix 롤업, 나의 부서 prefix 매칭), 상태별 그룹 집계, 최근 top 변화 판정, 도넛 세그먼트 각도 계산.
- **Playwright + 시스템 Chrome**: (a) 즐겨찾기+아코디언 펼침/접기/모두접기·검색 시 평면 전환·선택 시 자동 펼침 포커스, (b) 대시보드 3섹션·도넛 세그먼트 클릭→목록 변경·hover Open·클릭 선택→상세 전환·최근 진입 애니메이션, (c) Feedback 최근카드→딥링크 모달, (d) Inbox/Notices 미선택 다이제스트, (e) `[SP]` 배지(목록+상세). 데모 시드 실기동(devUser).
- 로컬 네이티브(backend uvicorn + `npm run dev`). `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""` 로 pytest 그린. 프론트 `npm run lint`·`tsc --noEmit`·`npm run build`.

## 8. Risks / Open

- **대시보드 복잡도**: 3섹션 + 2도넛 + 상호작용(hover-open/click-select/segment-filter) + 좌측 자동펼침 연동은 큰 표면. 컴포넌트 분리(§2 파일 목록)로 격리하고, 각 섹션 0건 시 은닉으로 단순화.
- **아코디언 ↔ 기존 정렬/무한슬라이스/권한 경계**: 브라우즈=아코디언 / 검색·필터=평면으로 모드 분리해 복잡도 격리.
- **owning_department null 비중**: 레거시 다수면 `Unassigned` 버킷 큼(정상). 최하단 유지.
- **나의 부서 즐겨찾기 중복**: 즐겨찾기 맵이 아래 아코디언에도 다시 나타남(의도 — 빠른 접근 vs 전체 조직도, 노티스 최근 밴드와 동일 패턴).
- **승인 진행도 한계**: status 단계 파생만(N명 중 M명 아님). 추후 필요 시 백엔드 필드로 확장.
- **딥링크 param 잔존**: 모달 닫을 때 `?feedback` 제거(`router.replace`).
