# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/superpowers/specs·plans/`·`docs/spec.md` 참조.

## 2026-06-22
- **feat(home): 카드 폭 축소 + 상세창에 허용 인원** (`claude/frontend-ux-improvements`) — 리스트 폭 `max-w-sm`로 제한(카드 과폭 해소), 상세 패널은 `flex-1`로 확장(타임라인·멤버 공간). 상세 카드에 허용 인원 섹션 추가(`listMapPermissions`, editor+ 한정). #2 버전 타임스탬프 타임라인은 백엔드 필요(스키마에 submit/publish 시각 미기록) — 별도 결정. 검증: tsc·lint·build clean.
- **feat(home): 마스터-디테일 레이아웃 + New map 우상단** (`claude/frontend-ux-improvements`) — 홈을 풀높이 div로(페이지 스크롤 X, **리스트만 내부 스크롤**). New map 버튼 우상단 이동. 카드 선택(`MapCard` selected/onSelect) → **넓은 화면(xl)에서 우측 상세 카드**(`map-detail-card.tsx`: 가시성·역할·버전+승인상태, getMap만 사용·백엔드 무변경). 선택은 파생(첫 맵 폴백, 이펙트 없음). **확인 결과: "누가 들어가도 owner"는 버그 아님** — `is_sysadmin`이 AUTH_ENABLED=false & DEV_ENFORCE_PERMISSIONS=false면 전원 True(로컬 잠금 방지)→sysadmin=owner. 실제 역할은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=…` 또는 AUTH_ENABLED=true에서. 검증: tsc·lint·build clean.
- **feat(map-settings): 맵 설정 레이아웃을 /settings와 동일하게** (`claude/frontend-ux-improvements`) — `/maps/[mapId]/settings`를 헤더+가로탭 → **좌측 세로 탭 레일 + 우측 콘텐츠**로 전환(설정 콘솔과 동일 패턴). 레일: 뒤로가기·맵이름·탭 버튼(좌측정렬, active=bg-accent-tint)·하단 현재유저+[Dev]전환. 읽기전용 알림은 콘텐츠 상단으로, dev 스위처 드롭다운은 좌하단 앵커. 로직(게이팅·effectiveRole·visibleTabs·refreshMap) 불변, JSX 레이아웃만 교체. 검증: tsc·lint·build clean.
- **feat(editor): 사이드바 하단 설정 버튼 + 뷰모드 워터마크 배경** (`claude/frontend-ux-improvements`) — 에디터 좌측 사이드바 하단에 `/settings` 진입 버튼(펼침=sticky bottom 라벨, 접힘=`mt-auto` 아이콘으로 왼쪽 아래 유지). 편집 불가(`readOnly`=타 사용자 체크아웃/상태 잠금) 시 점(dot) 그리드를 끄고 "읽기 전용" 워터마크(중앙 대형·faint·회전, pointer-events-none) 표시 → 뷰모드 즉시 인지. i18n 1키(editor.viewOnly). 백엔드 무변경. 검증: tsc·lint·build clean.
- **feat(home): 프로세스맵 카드 리디자인** (`claude/frontend-ux-improvements`) — 홈 목록을 카드로(`components/maps/map-card.tsx`). 카드 좌하단 메타 한 줄(가시성·역할 뱃지 + **"허용된 인원 보기" 드롭다운** = `listMapPermissions` lazy fetch). 인원 조회는 서버 editor+ 게이트라 **editor/owner 카드에만** 버튼 노출. 호버 시에만 **더보기(→맵 설정)·삭제(owner만)** 버튼 표시. RoleBadge·visibility 라벨 재사용, i18n 3키. 백엔드 무변경. 검증: tsc·lint·build clean.
- **feat(settings): DB 테이블 뷰어 탭** (`claude/frontend-ux-improvements`) — 설정 콘솔에 sysadmin 전용 "Database" 카테고리 추가. 백엔드(스키마 무변경·읽기전용 인트로스펙션): `GET /api/admin/tables`(메타데이터 테이블명) + `GET /api/admin/tables/{name}`(서버측 페이징/정렬/필터). 안전장치: sysadmin 게이트·테이블/정렬컬럼 메타데이터 검증·q 바인드 파라미터·SELECT 전용. 프론트 `table-viewer.tsx`: 테이블 선택→표, 헤더 클릭 정렬, 필터(디바운스), 100행 초과 시 페이징. 좌측 바 유지·우측 갱신은 기존 /settings 레이아웃 그대로. 검증: ruff·pytest 269(신규 7)·tsc·lint·build clean.
- **feat(UX): 어드민 콘솔 → 설정(/settings) 통합 + 그룹 탭 편입** (`claude/frontend-ux-improvements`) — `/admin`을 **`/settings`(누구나 접근)** 로 전환, 좌측 탭이 권한별로 다르게: Groups(모두)·조직(admin)·권한(sysadmin). `/groups` 인덱스를 `components/groups/groups-panel.tsx`로 추출해 Groups 탭으로(상세 `/groups/[groupId]` 유지, back→/settings). top-nav 드롭다운=설정+로그아웃만(Admin·Groups 링크 흡수). 미사용 i18n(nav.adminPage·navLink·consoleTitle·noAccess) 제거, nav.settings 추가. 백엔드 무변경. 검증: tsc·lint·build clean(라우트 /settings·/groups/[groupId], /admin·/groups 인덱스 제거).
- **feat(admin/UX): 어드민 + 시스템 어드민 페이지 통합** (`claude/frontend-ux-improvements`) — `/admin`(직원·role) + `/admin/permissions`(권한·sysadmin)를 한 `/admin` 콘솔로 합치고 **좌측 세로 탭 레일**(카테고리: 조직/권한, 스페이서 구분)로 분리. 권한별 카테고리 노출(admin→Employees / sysadmin→큐·부서·사용자), 둘 다 없으면 안내. 직원 테이블을 `components/admin/employee-table.tsx`로 추출, top-nav 두 링크→단일 "관리자 페이지". `/admin/permissions` 라우트 제거. 백엔드 무변경(서버 가드 기존). 검증: tsc·lint·build clean(라우트 7개, /admin/permissions 사라짐).
- **fix(seed): 빈 영어 데모 맵에 노드 채움 + Version Workflow v1↔v2 diff** — `seed_permission_demo`의 4개 맵(Public/Private/Roles/Version Workflow)이 노드 0개였음 → `_build_flow` 헬퍼로 선형 흐름 시드. Version Workflow는 v2에 `source_node_id` 계보로 added(Test)·changed(Release→Release & Notify) 부여해 그 맵 자체 비교도 의미있게. 검증: reset_db 후 9개 맵 전부 노드>0, map8/map9 diff 정상.
- **feat(seed): 버전 비교 데모 맵 추가** — `seed_compare_demo`(reset_db ADDITIVE 5단계) 신설. "Version Comparison Demo (As-Is / To-Be)" 맵 1개에 As-Is(published)·To-Be(draft) 2버전, To-Be `source_node_id`로 As-Is 계보 연결 → 비교 화면에서 추가(품질 점검)/삭제(수기 승인)/변경(신용 검토 담당자·출고→출고/배송) 하이라이트. 검증: reset_db 후 diff 규칙 재현 = added 1·removed 1·changed 2. db-seed.md 갱신.
- **fix(seed): 권한 데모 맵 버전 누락 → 에디터 크래시 수정** — `seed_permission_demo._create_map`이 버전 없이 맵 생성 → Public/Private/Roles 맵을 열면 에디터 `versions[0].id`에서 `cannot read properties of undefined (reading 'id')`. 정상 `create_map` 라우터처럼 초기 "As-Is" 버전을 시드(`seed_version=True` 기본, Version Workflow 맵만 자체 v1/v2라 False). 검증: reset_db 후 8개 맵 전부 ≥1 버전(이전 5/6/7 = 0).
- **서버 시드 활성화** — `backend/Dockerfile`에 `COPY scripts/ scripts/` 추가(시드 스크립트가 이미지에 없어 컨테이너에서 `reset_db` 불가였음). 이제 서버에서 `docker compose up -d --build backend` 후 `docker compose exec backend python -m scripts.reset_db`로 시드. `db-seed.md`에 "서버(docker-compose)에서 시드" 섹션, `deploy.md` §3에 포인터 추가.
- **md 문서 최신화 + 압축**(메인 기준) — `db-seed.md` 전면 재작성(stale `seed_dummy.py`→실제 `reset_db.py` 4단계: drop/create+직원+참조데모+권한데모, 부분 시드·권한 강제 검증), `deploy.md`+`deploy-auth-ad.md` 단일 런북 병합, `spec.md` 데이터모델·구현순서 최신화(parent_node_id 폐기→subprocess 참조·RBAC), CLAUDE.md 상태줄·README·lessons 현행화, `PROGRESS.md` 한 줄 요약으로 압축(175→약55줄).

## 2026-06-21
- **권한 워크플로 데모 시드 + EN/KO 가이드** — `reset_db`가 호출하는 ADDITIVE `seed_permission_demo`(가시성 대비 맵·3종 principal 협업자·pending 결재 2·활성/비활성 승인자·그룹 2·버전 워크플로). 가이드 `docs/permission-demo-walkthrough.md`(8단계).
- **권한 whole-branch 리뷰 픽스 + mock-store dead code 정리** — create-dialog `.catch` 폴백, 고아 모달 제거, Layer 1-4 후 외부참조 0 심볼(types/logic/store) 제거. pytest 262 pass.
- **권한 Layer 4(유저그룹) 완료** — 스키마 3테이블 + `effective_role` 그룹 principal 활성(user/dept 멤버십), 그룹 관리 API(`/groups` CRUD·승인 큐·멤버≥2·관리자≥1), 프론트 그룹 화면·협업자 그룹 grant 실 API 배선. cross-map 결재 큐 엔드포인트는 미생성(보고). 협업자 피커 데이터소스를 한글 mock→영문 실 디렉터리(`/api/directory`)로 교체.
- **권한 Layer 3(프론트 실 API 배선) 완료** — 역할 컨텍스트 서버 단일화(`/api/me.is_sysadmin`·`MapOut.my_role`)·시드 영문화(AD 정렬), 맵 권한 화면 6종(협업자·결재자·가시성·위험구역·생성·결재대기) + 버전 게시 워크플로를 Layer-2 엔드포인트로 전환(서버 진실·낙관적 갱신 금지). MAP cross-map 큐는 라벨된 mock 미리보기 유지.
- **권한 Layer 2(백엔드 게이트·관리 API) 완료** — 맵 엔드포인트 권한 게이트(가시성 필터·viewer/editor/owner·체크아웃 보유 강제) + 권한 관리 엔드포인트(협업자 CRUD·다운그레이드 승인 pending·owner 이양·가시성 요청·결재 결정). pytest 216 pass.
- **캔버스 회귀 픽스 3건** — ① 펼침 영역 가로지른 루트 드래그 드롭 좌표 보정(고정점 풀이) ② 아웃라인이 접힌 하위프로세스를 펼치기 가능으로 표시 ③ obsolete "child" 드롭존 제거 + 하위프로세스 엣지 핸들 보정(`withSubprocessHandles`).

## 2026-06-20
- **하위프로세스 참조 모델(Call Activity) — 백엔드+프론트 완료**. 인라인 계층 편집(`parent_node_id`, 버그 원천) 폐기 → 루트에서만 편집, 하위는 다른 프로세스를 링크해 읽기전용 펼침. 백엔드: 노드 평면화·subprocess 참조/대표끝/엣지핸들 필드·프로세스 검증·순환 차단·라이브러리/해석 API(120 tests). 프론트(9태스크): 합성트리(compositeTree로 링크맵 resolved를 네임스페이스 parent로 임베드 → 렌더 폴리시 무변경)·동적 끝핸들·하위 편집경로 제거·읽기전용 딥뷰 드릴인·라이브러리 드래그·다중출구+버전 업데이트 배지·follow-latest. 설계 `specs/2026-06-20-subprocess-reference-model-design.md`.
- **포커스 시 조상이 활성 영역을 "감싸도록"** — `ancestorContextNodes`를 재귀 감싸기로 재작성(앞 형제=왼쪽·뒤 형제=오른쪽), 깊은 드릴인 시 좌측 붕괴 수정.
- **권한 관리(Permission Management) UI-first mock 구현(Phase 1-3)** — mock 레이어(타입·시드·순수 판정·in-memory store) → 맵 권한 UI(협업자·결재자·가시성·위험구역·버전 게시 상태기계·승인자 재지정) → 유저그룹·sysadmin 콘솔(`/admin/permissions` 통합 승인 큐·부서 동적 깊이·사용자 목록). 설계 `specs/2026-06-20-permission-management-design.md`. (이후 Layer 1-4에서 실 백엔드로 대체)
- **복잡한 깊이4 테스트 맵 추가**(`seed_complex_demo.py`) — 하위보유 노드 3개·깊이4 중첩 + 그룹·속성·description·decision 분기·엣지 라벨·루프백.

## 2026-06-19
- **포커스 모드 — 활성 스코프 dim/편집** (`feat/active-scope-focus-mode`). 비활성(인라인 자식/조상) 스코프 읽기전용 dim → 클릭 시 그 스코프를 활성 `nodes`化(`navigateTo`+카메라 보정, 드롭존·그룹·정렬 네이티브) → 제자리 토글로 정착. 깊이별 레인 세로 경계선·틴트(flat 5%)·셰브론 절대깊이 통일, 조상 감싸기 레인, fit/팬 좌상단 스냅 제거, exit 카메라 통합 보정. 자식 다중선택 드래그 1개만 이동 버그 수정.
- **인라인 하위 프로세스 편집 가능화 — 별도 `childNodes` state 방식**. (메인 nodes 합치기는 광범위 회귀로 reset.) displayNodes 합성 + 커스텀 `onNodesChange` 분배로 RF 측정·이벤트 발화하며 메인 nodes 무손상. 레인 안 자식 삭제·이동(저장 pos)·연결·추가 4종. 이름편집은 모달 유지. 계획 `plans/2026-06-19-editable-inline-subprocess.md`.
- **레슨런 문서화**(`docs/lessons/`) — canvas-react-flow·scope-save-and-coordinates·browser-verification·react-ts-patterns + README, CLAUDE.md "Lessons" 섹션 링크.
- 줌아웃 시 캔버스 좌상단 고정 풀리던 버그 수정(`translateExtent` 우하단을 pane/minZoom 이상으로 → centering 차단).

## 2026-06-18
- **인라인 펼치기/접기 전면 구현** — 드릴인 자유창(`ScopeWindow`)을 같은 캔버스 인라인 펼침으로 전환. 자식 노드 가시화(measured 직접 주입·미측정=visibility:hidden 회피), 더블클릭 편집(raw dblclick 캡처 — RF가 prop-only 자식에 이벤트 미발화), 영역 = 전체높이 세로 레인(`InlineRegionBands`), 중첩(재귀) 지원, 모두 펼치기/접기 + 펼침 캡(노드300/깊이5), ease-in-out 슬라이드, 휠=상하이동·Ctrl+휠=줌. `/graph/all`에 `has_children` 추가. 하위 생성/삭제 불변식 모달(Start/작업/End).
- 마이너 버그 묶음 — 언그룹 undo 그룹 복원, 그룹 2명 미만 자동제거, 노드 타입 변경 삭제, 토스트 우상단 스택, 아웃라인 삭제 지연.
- 드롭/삽입 엣지 좌-좌 붙던 버그 수정(`s-right`/`t-left` 기본 핸들 명시).
- 아웃라인 키보드 내비게이션(↓/Tab·↑/⇧Tab·→펼침·←/F 접고이동) + 고정 단축키 안내 카드, 선택행 자동 스크롤.

## 2026-06-17
- 엣지 핸들 변 커스텀(`source_side`/`target_side` 컬럼, 노드 4변 8핸들, 우클릭 십자 패드). 설계 `specs/2026-06-17-edge-handle-side-customization-design.md`.
- decision 분기 엣지 Yes/No 색상(파스텔 블루/레드 토큰, `branchKindOf`).
- 모달 외부클릭 닫기 버그 수정(공용 `ModalBackdrop` — mousedown·click 모두 백드롭일 때만).
- 노드·그룹 이름 캔버스 내 중복 금지(`(2)` 자동 접미사), 캔버스 좌측 줌 인디케이터, AI 채팅 세로 스크롤 수정.

## 2026-06-16
- **Keycloak 로그인 + 사내 AD(LDAP) 동기화 + 로컬 임시 로그인** — 백엔드 `employees` 테이블·`app/ad/`(DN 파싱·필터·ldap3·sync_one/all+5분 가드)·`X-Dev-User`·`require_admin`·`/api/me·employees·employees/sync`. 프론트 `/login` 게이트·임시 로그인 모달·TopNav 드롭다운·`/admin` 직원 테이블. 배포 절차·compose `LDAP_*` 배선. 설계 `specs·plans/2026-06-16-keycloak-login-ad-sync*`.
- insecure context(평문 HTTP) 픽스 — `crypto.randomUUID`/`crypto.subtle`가 secure context 전용 → 노드/엣지 생성은 `lib/id.ts genId`(getRandomValues 폴백), Keycloak 로그인은 `disablePKCE:true`. **localhost에선 재현 안 됨**(secure context). 로그인 직후 첫 `GET /maps` 401 레이스 수정(토큰 렌더 단계 동기 반영).
- 서버(사내 71번) 배포 성공 — node:22→20-alpine, compose 명시 서브넷(172.36.0.0/16). 앱 노출 포트 9787→3333 일괄 변경.
- DB 초기화·시드 문서/스크립트 등록(`docs/db-seed.md`). decision 분기 모달 누락(드롭 경로) 수정. 전역 버튼 인터랙션 base(커서·scale 0.97).

## 2026-06-15
- **온프레미스 AI 채팅** — 백엔드 OpenAI 호환 프록시(`ai_client`/`ai_prompt`/`routers/ai`, 502 내부 URL 비노출) + 프론트 채팅·미리보기·적용·모델 드롭다운(`/v1/models`). 접속 테스트 `docs/ai-connectivity-test.md`. 설계 `specs/2026-06-15-ai-chat-flowchart-design.md`.
- 그룹 = 다중 태그 모델(`nodes.group_ids` JSON, 레거시 `group_id` 무손실 병합) + 중첩(하위 그룹) + 멤버 일괄 편집. 그룹 박스 = bbox − 비멤버 notch.
- 메뉴 단축키 2계층화(가속기 + 전역 조합, IME 무관 `event.code`) + 정렬 메뉴 재구성(가운데 정렬·날개 통합). 아웃라인 들여쓰기=계층만·키보드 편집. 캔버스 무한 확장 → bbox 기반 fit.
- 에디터 14종 배치(호버·요약모달 편집·인라인 리네임·드롭존 교환·그룹 생성/해제·엣지 스타일 전역·AI 플로팅 창 등).

## 2026-06-14
- **버전 승인 워크플로우 풀스택** — Draft→Pending→Approved→Published(+Rejected), 맵별 만장일치 승인자, 수동 게시+구버전 강등, 인앱 알림, 대시보드(라이프사이클 stepper). 설계 `specs/2026-06-14-version-approval-workflow-design.md`.

## 2026-06-13
- **에디터 UI 대개편** — 좌 아웃라인 트리·우 인스펙터·컨텍스트 메뉴·단축키 레전드·드래그 드롭존·비활성창 정적 프리뷰. 설계 `specs/2026-06-13-{editor-ui,drag-drop-zones,node-interactions}-design.md`.
- 그룹(업무 묶음) 풀스택(`groups` 테이블·박스·타이틀바). Whimsical 디자인(바이올렛 #6A41FF·파스텔·dot-grid). 설계 `specs/2026-06-13-whimsical-design-design.md`, `rules/frontend/design.md`.

## 2026-06-12
- OS형 자유 창(드릴인 `ScopeWindow`)·UI 디자인 시스템(Tailwind4 `@theme`·Pretendard·Lucide)·전역 네비바+i18n(en/ko)·박스선택. 설계 `specs/2026-06-12-*`.
- 기능 확장 Phase A/B/C(`docs/spec.md` §7) — A: undo/redo·컨텍스트메뉴·자동저장·색/모양. B: BPM 속성·버전 diff(계보)·초성 검색·PNG. C: 체크아웃 잠금·노드 코멘트.
- 문서 명령 bash/PowerShell 병기 원칙(`rules/common/documentation.md`).

## 2026-06-11
- 초기 구축(spec §6 ①~⑤): 스캐폴딩(Next+FastAPI+nginx+compose) → 맵 CRUD+캔버스 → 계층(드릴다운·브레드크럼)+정렬(dagre) → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). 기능 명세 `docs/spec.md`. 프로젝트명 BPM 확정.
