# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). 한 줄 요약만 — 상세는 git 이력·`docs/superpowers/specs/`·`docs/spec.md` 참조.

## 2026-06-18
- 인라인 펼침 영역 시각 변경(사용자 피드백) — 그룹식 깊이 틴트 박스 → **삽입된 새 캔버스 느낌의 세로 레인**. 영역 배경은 콘텐츠 **상하 전체 높이**(전 노드 Y 범위 + 여백)로 뻗고, 흰 `surface` + dot-grid + 좌우 `divider`로 "새 캔버스가 끼워진" 모양. 자식은 A 세로 중앙에 배치. tsc/eslint/build green.
- 인라인 펼침 **영역 컨테이너 모델로 전환**(사용자 피드백) — 평면 LR 병합은 연결 안 된 노드가 상하로 쌓여 영역 구분이 사라지는 문제. 펼친 A 오른쪽에 **깊이 틴트 배경의 하위 영역 박스**를 삽입하고 공간상 A보다 오른쪽 노드를 우측 이동(왼쪽·A의 수동 배치 보존, 전체 재배치 아님). 자식은 영역 안에서 로컬 LR 배치, `A→진입(Start 등)`·`진출(End 등)→후속` 게이트웨이 또렷이(opacity 0.55), `A→B` 숨김, 영역 가로지르는 엣지 반투명. 영역 제목 칩 클릭=접기. 다중 펼침은 왼→오 누적 시프트. MVP=루트 레벨(중첩·편집은 후속). tsc/eslint/build green.
- 인라인 펼침 레이아웃 수정 — 게이트웨이가 Start/End 타입에만 의존해 레거시 하위(Start/End 없음)에서 자식이 그래프와 끊겨 dagre가 분리 컴포넌트로 처리 → 다음 노드가 아래로 빠지고 자식이 안 보이던 문제. 진입점=Start(없으면 진입차수0 자식)·진출점=End(없으면 진출차수0 자식)로 추론해 항상 `P↔자식↔다음노드`를 연결(자식이 가운데로 삽입·다음노드 우측 이동). 펼침 시 `fitView`로 화면 맞춤. tsc/eslint/build green.
- 인라인 펼치기/접기 **Phase 2(렌더)** — 노드 우상단 토글(`DrillButton`→`ExpandToggleButton`, Chevron, `hasChildren`일 때만)로 하위를 같은 캔버스에 인라인 펼침/접기. 메모리 `fullGraph`에서 자식 수집 → 통합 `layoutWithDagre(LR)` 재배치(**파생 레이어** `inlineComposition`, raw state·저장 무오염), A→B(펼친 노드 출발 엣지)는 `hidden`·게이트웨이(P→Start/End→후속)는 흐리게, 중첩 펼침은 현재+자식 엣지 합쳐 처리. 펼침 중 드래그/연결 비활성(dagre 재배치 좌표 불일치 방지)·자식은 보기 전용(비선택)·pan extent는 합성 노드 기준·그룹박스는 펼침 중 숨김. 자식 편집은 당분간 기존 창(존속) 경로 유지(편집 인라인화는 후속). 프론트 tsc/eslint/build green. ⚠️ 캔버스 수동 검증 필요(이 환경 브라우저 구동 불가).

## 2026-06-17
- 인라인 하위 프로세스 펼치기/접기 — 드릴인 자유창(`ScopeWindow`)을 같은 캔버스 인라인 펼침으로 전환 착수. 설계 확정: 자식 스코프(`parent_node_id`) 유지+뷰 합성(백엔드 무변경), 메모리의 `fullGraph` 재사용(추가 fetch 0), 통합 `layoutWithDagre(LR)`, 펼침=순수 뷰(A→B는 hide·재배선 없음), scope-split 저장, AI 채팅용 ScopeWindow는 존속. **Phase 1 기반**: 캡 config(`expansion-config.ts` 노드300/깊이5), 순수 로직(`inline-expand.ts` — 자식수집·게이트웨이·캡·scope-split·불변식), `NodeData.scopeId` 태그(`toAppNodes` 주입). 프론트 tsc/eslint green. WIP. (스펙/계획: `docs/superpowers/specs|plans/2026-06-17-inline-subprocess-expand.md`)
- 마이너 버그 수정 묶음. ① 언그룹→실행취소 시 그룹 미복원 — `Snapshot`이 `groups` 누락해 undo가 nodes만 복원하던 게 원인, 스냅샷·undo·redo에 `groups` 포함(disband·create 양쪽 정상화). ② 그룹 생성 로직 — 멤버 2명 미만이면 자동 제거(`pruneSmallGroups`, leaveGroup·노드삭제 경로 한정, 로드 데이터 불변), 선택 노드가 모두 한 그룹이면 생성 차단+토스트, 단일 노드 Ctrl+G 차단+토스트, 생성 즉시 이름 편집모드 진입(`GroupTitleBar autoEdit`), 그룹 자동삭제 시 토스트. ③ 노드 타입 변경 기능 삭제 — 인스펙터·요약모달 select를 읽기전용 표시로 교체(생성 시 타입 선택은 우클릭 메뉴 유지). ④ 토스트 재설계 — 우상단(Nav 아래) 슬라이드 인/아웃+스택(`toast-stack.tsx`, `var(--ease-spring/smooth)`). ⑤ 아웃라인 노드 삭제 지연 — stale `fullGraph` 병합이 삭제 노드를 되살리던 빈틈, 라이브 로드 후 현재 스코프는 라이브가 권위(즉시 반영). 프론트 tsc/lint/build green.
- 엣지 핸들 변 커스텀 — 엣지마다 시작/끝이 붙는 노드 변(상/하/좌/우)을 엣지 우클릭 십자 패드 2개(Start/End)로 변경(클릭해도 메뉴 유지). `source_side`/`target_side` 엣지 컬럼 영속(기본 우/좌, Pydantic `Literal` 검증), 노드는 4변 source·target 핸들(8개) 렌더(평소 은은·hover 강조), 엣지는 `sourceHandle`/`targetHandle`(`s-{side}`/`t-{side}`)로 연결. diff는 엣지를 source→target 계보로만 비교해 변은 비교 제외(diff.ts 무변경). 스키마는 1회 drop+recreate 필요. 백엔드 pytest(라운드트립·기본값·invalid 422) 통과, 프론트 tsc/lint/build green. (스펙: docs/superpowers/specs/2026-06-17-edge-handle-side-customization-design.md, 계획: docs/superpowers/plans/2026-06-17-edge-handle-side-customization.md)
- 판단(decision) 분기 엣지 Yes/No 색상 구분 — 은은한 파스텔 블루(Yes `#6f93cc`)/레드(No `#cf7e84`) 토큰 신설, `styledEdges`에서 `branchKindOf(label)` 기준으로 stroke·화살표·라벨 알약(14% 틴트 배경+테두리) 색 적용. 기타 분기는 기본 톤 유지, 라벨 파생이라 영속 불필요. 선택 노드 강조(in=teal/out=orange)는 그대로 우선.
- AI 채팅 패널 세로 스크롤 수정 — 메시지 영역 `flex-1`에 `min-h-0` 누락으로 컨테이너 밖으로 늘어나 스크롤 불가였음. `min-h-0` 추가 + 새 메시지 시 자동 하단 스크롤. 스크롤바는 `scrollbar-hidden` 유틸(globals.css)로 기본 숨김(동작은 유지).
- 모달 외부클릭 닫기 버그 수정 — `onClick`(=mouseup)으로 닫아, 모달 내부 드래그를 바깥에서 떼면 백드롭 click이 발생해 잘못 닫혔음. 공용 `ModalBackdrop`(mousedown·click 모두 백드롭 자신일 때만 닫음)으로 5개 모달(dev-login·node-summary·group-bulk·approver-manager·edge-branch) 통일. edge-branch 기존 150ms `armed` 해킹은 이 가드로 대체·제거.
- 캔버스 좌측 줌 인디케이터(`canvas-zoom-scale.tsx`) — `useViewport`로 현재 줌을 세로 눈금 바에 실시간 표시(로그 스케일·반응형 높이·표시 전용 pointer-events-none).
- 노드·그룹 이름 캔버스 내 중복 금지 — 중복 시 `(2)`/`(3)` 자동 접미사(`canvas.ts makeUniqueLabel`). 노드끼리·그룹끼리 따로, 빈 이름 예외. 적용: 노드 인라인/요약모달(blur) 리네임·생성, 그룹 리네임(타이틀바·일괄)·생성(선택→/드롭→).

## 2026-06-16
- 편집화면 노드/엣지 생성 시 `crypto.randomUUID is not a function`(평문 HTTP=insecure context, secure context 전용 API) 수정. 실제 호출처는 에디터 `[mapId]/page.tsx` **6곳**(handleAddNode·createEdge·applyAiProposal·그룹 생성) — 직접 `crypto.randomUUID()`. 공용 헬퍼 `lib/id.ts`(`genId`, getRandomValues 폴백) 신설해 6곳 + `canvas.ts` 전부 교체. (앞선 canvas.ts-only 수정은 실제 경로를 못 짚었고, ugrep이 `[mapId]` 대괄호 경로를 건너뛰어 호출처를 놓쳤었음.) localhost는 secure context라 정상 → 서버(원격 HTTP) 전용 증상.
- AI 채팅 502 "AI returned invalid response" 진단 보강 — 검증 실패 시 원본 모델 출력을 서버 로그에 기록(`ai.py`), `_extract_json`으로 ```json 펜스·앞뒤 prose 제거 후 재파싱. (AI는 서버 전용 기능=AI_ENABLED, 로컬 기본 비활성이라 서버에서만 발현. 근본 원인은 로그의 raw 출력으로 확정 필요.)
- 로그인 직후 첫 `GET /maps` 401(missing bearer token) 수정 — 자식 페이지 fetch effect가 부모 AuthGate의 `setAuthToken` effect보다 먼저 실행되던 레이스(React effect 자식→부모 순서). 토큰을 effect 대신 AuthGate **렌더 단계에서 동기 반영**해 자식 mount 전에 채움. 전 페이지 적용.
- 앱 노출 포트 9787→3333 일괄 변경 — 서버 실제 배포 포트(3333)에 맞춤. `.env.example`·`docker-compose.yml` 기본값·README·CLAUDE.md·`docs/spec.md`·`docs/deploy.md`·`docs/deploy-auth-ad.md`·`nginx/default.conf` 주석 전수 스윕(과거 로그는 보존). ⚠️ Keycloak `bpm-frontend` Valid redirect URIs/Web origins도 `:3333`으로 갱신해야 로그인 redirect 정상.
- Keycloak 로그인 무반응(평문 HTTP) 수정 — 원격 IP HTTP는 secure context가 아니라 PKCE의 `crypto.subtle`이 브라우저에 차단됨 → `signinRedirect`가 조용히 throw. 프론트 OIDC 설정(`keycloak-login.ts`·`providers.tsx`)에 `disablePKCE: true`로 우회(사내망 한정·Keycloak도 동일 서버 개발용이라 수용한 트레이드오프, HTTPS 전환 시 복구). 배포 문서 트러블슈팅·보안 메모 추가.
- 서버(사내 71번) 배포 성공 반영 — 프론트 Dockerfile `node:22-alpine`→`node:20-alpine`(서버에서 node:22 이미지 풀 실패), `docker-compose.yml`에 `networks.default` 명시 서브넷(172.36.0.0/16, 사내망 대역 충돌 회피).
- 배포 절차 문서(`docs/deploy-auth-ad.md`) — Keycloak 로그인+AD 동기화 서버 배포(env·Keycloak federation·검증·트러블슈팅). + `docker-compose.yml` backend에 `LDAP_*`·`SYSTEM_ADMIN_LOGIN_IDS` 환경변수 배선(누락 갭 수정 — 컨테이너는 .env 직접 안 읽고 compose environment로만 주입받음).
- Keycloak 로그인 화면 + 사내 AD(LDAP) 동기화 + 로컬 임시 로그인 구현(spec/plan: `docs/superpowers/specs|plans/2026-06-16-keycloak-login-ad-sync*`). 백엔드: `employees` 테이블, `app/ad/`(DN 파싱·필터 순수함수+pytest, ldap3 클라이언트, `sync_one`/`sync_all`+5분 인메모리 가드), `X-Dev-User` 의존성·`require_admin`, `/api/me` 확장·`/api/employees`·`/api/employees/sync`(admin). 프론트: `/login` 와일드카드 게이트(AuthGate/DevGate), 임시 로그인 모달(5명 fixture, `X-Dev-User`), TopNav 유저 드롭다운(관리자 페이지/로그아웃), `/admin` 직원 테이블+동기화. 검증: 백엔드 108 pytest+ruff, 프론트 eslint+build green. (Keycloak 서버 설정·실연동은 서버 배포 시.)
- DB 초기화·더미 시드 문서화(`docs/db-seed.md`) + 시드 스크립트(`backend/scripts/seed_dummy.py`) 저장소 등록. `--reset`(전체삭제 후 3세트 재생성)·`--verify`(인접 버전 diff) 사용법, 대상 DB(로컬 sqlite/서버 postgres), 검증 절차 정리.
- 판단(마름모) 분기 모달 누락 수정. 엣지 생성 경로가 둘(핸들 드래그 `onConnect` / 노드 드롭 `applyFlowEdges`)인데 모달이 드래그에만 있어 드롭 연결 시 라벨 없는(=기타) 엣지가 바로 생성되던 버그 → 드롭 경로도 모달을 타도록 `branchPrompt`(connection/edge) 일반화. 중간 삽입 시 분기 라벨이 마름모를 source로 유지되도록 `insertNodeAfter`에 `bIsDecision` 분기 추가.
- 전역 버튼 인터랙션 base(`globals.css`) — 모든 `<button>` 포인터 커서 + 클릭 `scale(0.97)` 눌림(`prefers-reduced-motion` 가드), 컴포넌트는 hover 배경만. 설계 규칙(`rules/frontend/design.md` §4)에 명문화.
- 캔버스 노드 hover 모션에 대각선 이동(`-translate-x-0.5`) 추가 — 마름모·일반 노드.
- WorkflowDashboard 리디자인 — 하단 액션 버튼 전폭(flex-1)·흰 배경 호버 가시화, 안내/진행 메시지 좌측 배치, 승인자 관리 버튼 본문 이동, LifecycleStepper를 oh-my-zsh Powerline 셰브론 세그먼트 바 스타일로 재설계.
- decision/start/end는 하위 프로세스 생성 차단(moveToChild 가드+`err.childOnlyProcess`, 노드메뉴 "하위 열기"·DrillButton은 process/기존하위 노드에만 노출, 드롭존 child 타일은 숨기지 않고 비활성(흐리게) 표시). 분기 모달 즉시닫힘 방지(EdgeBranchModal `armed` 150ms 가드 — 연결 릴리스 후속 click 무시; onConnect 로직은 회귀 아님). 오토레이아웃 단축키 추가: 전역 Shift+L, 메뉴 가속기 A→A(정렬 날개 첫 항목 accel A).

## 2026-06-15
- 드롭다운 메뉴 단축키 힌트를 숏컷 레전드와 동일한 `kbd` 디자인(공용 `KBD_CLASS`)으로 + 라벨과 간격(gap-3) 분리, 패널 폭 w-44→w-48.
- 단축키 IME 무관(`event.code` 물리키 판정 — 한글 ㅁ/ㅊ 등도 인식) + 정렬 키를 왼손 전용·연관 철자로 재배치(좌 W=West, 가로가운데 C, 상단 T, 세로가운데 X, 가로분배 R=spRead, 세로분배 V). Alt 조합도 동일(Alt+W/C/T/X·R/V). 레전드 갱신.
- 메뉴 단축키 2계층화. ① **메뉴 가속기(단일 키, 우클릭 메뉴 떠 있을 때만)** — `ContextMenu`에 키보드 네비게이션(`accel` 필드, 하위 메뉴 진입: A→정렬 날개→T 등). 1~4 추가, E 정보수정, A 정렬, G 그룹생성. ② **전역 조합키(메뉴 없이)** — Alt+L/C/T/M 정렬·Alt+H/V 분배(event.code로 OS무관), Ctrl+G 그룹, Ctrl+⇧E PNG. 레전드 갱신.
- 정렬 메뉴 재구성. 가로 가운데(centerX)·세로 가운데(centerY) 정렬 추가(`alignSelected`), 오토레이아웃+정렬+분배를 단일 "정렬·레이아웃" 날개(submenu) 메뉴로 통합(pane/group/selection 공용 `alignItem`), 각 항목에 Lucide 정렬 아이콘으로 가로/세로 구분(`ContextMenuItem.icon` 지원 추가). bun 검증.
- dot-grid 가시성 향상(`--color-canvas-dot` 진하게 + size 1.2→1.8) + 루트(최외곽) 캔버스 포커스 시 드릴인 창 자동 최소화(좌하단 dock, `focusScope` index 0).
- 판단(decision) 노드 분기 엣지. 판단 노드에서 연결 시 Yes/No/기타 선택 모달(`edge-branch-modal.tsx`), 엣지 라벨에 디자인 알약 스타일(styledEdges labelStyle/Bg), 인스펙터에 Yes/No/기타 세그먼트 탭 전환 + 기타일 때만 라벨 직접 편집. 라벨 기반 종류 판정(`branchKindOf`, 백엔드 무변경 — 기존 label 영속). build green.
- 캔버스 무한 확장 → fit 비대화 개선. ① 오토레이아웃(`layoutWithDagre`) 결과를 좌상단(0,0) 기준 정규화(드리프트 누적 제거, bun 검증). ② 노드 위치·패닝 범위를 콘텐츠 bbox+여백(600)으로 제한(`contentExtent` → `nodeExtent`/`translateExtent`, 콘텐츠 늘면 확장) + `minZoom 0.2` 안전망. build green.
- 아웃라인 들여쓰기·키보드 편집. ① 들여쓰기는 하위 프로세스(계층)에만 — 병렬/분기는 같은 수준(`computeScopeFlow` 분기 indentation 제거, bun 검증). ② 키보드: 선택 상태 Enter=이름 편집 진입·재Enter=저장, Esc=취소, Tab=다음 노드(하위 프로세스 있으면 펼쳐 첫 자식 진입), 편집 중 Tab=저장+다음(`page.tsx handleOutlineNext`, 사이드바 onKeyDown·focus 관리). build green.
- 그룹 박스 외곽선 로직 = **기본 사각형(멤버 bbox) − 비멤버 notch**. 범위 안에 들어온 비그룹 노드를 가장 가까운 변쪽으로 직사각형으로 잘라내 제외(90° 직교, 연결 유지). `canvas.ts rectWithExclusions`/`nearestEdgeNotch`(좌표압축 격자, 의존성 0, bun 검증). `GroupBox`는 SVG fill+outline path(non-scaling-stroke). 반투명·z·타이틀바·합류 펄스 유지. build green. (이전 union/MST-다리 방식 대체)
- 그룹 = 다중 태그 모델로 전환(#6) — 중첩(parent_group_id) 미사용, 노드가 여러 그룹(태그) 동시 소속. 백엔드 `nodes.group_ids`(JSON, 레거시 `group_id` 로드시 병합·무손실, 스톱갭 컬럼, 검증·복제 갱신, 테스트). 프론트 `NodeData.groupIds[]`, 태그별 박스(멤버 많을수록 패딩↑로 감쌈), 반투명 fill(z 무관 모두 가시) + z는 멤버 적은 그룹이 위, 색 팔레트 순환. 백엔드 94 passed+ruff, 프론트 build green.
- 에디터 후속 7종(#0·3·4-1·4-2·4-3·5·10·14) — 노드 호버(그림자·살짝나옴·반투명), 이름 외 영역 더블클릭=요약창(타이틀 더블클릭=이름편집), 스왑 드롭존 좌하단 이동·엣지연결도 교환·드롭존 크기 프로세스 기준 고정, 엣지 선택 강조색, dagre 간격 확대(엣지-노드 겹침), 알림센터 z최상위. build green.
- 그룹 중첩(하위 그룹핑, 항목 8 — 옵션1 중첩만, 큰 다중소속 모델은 보류). 백엔드: `groups.parent_group_id`(자기참조, 스톱갭 컬럼 보강·고아/자기참조 정리·복제 리맵, 테스트). 프론트: 그룹 멤버 부분집합 선택→"그룹 생성" 시 하위 그룹으로 중첩, 해제 시 멤버·하위그룹 상위로 승격, 중첩 높이 기반 패딩으로 박스 포함 렌더, 일괄편집·색은 서브트리 대상. 순수 헬퍼 `collectKeptGroups`/`computeGroupHeights`/`groupSubtreeIds`(bun 검증). 백엔드 94 passed+ruff, 프론트 build green.
- 에디터 14종 배치(브랜치 `feat/editor-batch`) — 12개 구현(항목 8 중첩/다중그룹은 설계 협의 후 별도): 아웃라인 행 우클릭 메뉴·더블클릭 이름편집(#1), 노드 우클릭 "정보 수정" 모달(요약모달 편집 확장, 색 1줄+더보기)(#2), 더블클릭 인라인 이름편집·타이틀 I-beam(#3), 드롭존 중앙 위치교환(#4), 엣지 선택 강조 강화(#5), 다중선택→그룹 생성(#6), 그룹 해제(#7), Delete 전용 삭제(#9), dagre 간격·노드별 박스로 겹침 완화(#10), 엣지 스타일 맵 전역 선택(곡선/꺾은선/직선)(#11), 겹침 시 시야 자동 보정(#12), AI 채팅 풀 플로팅 창(ScopeWindow·dock 재사용)(#13), 알림센터 바깥클릭 닫힘(#14). eslint+build green.
- AI 채팅 패널 플로팅 슬라이드 인/아웃 + 일괄 속성 적용 후 입력·정책 초기화·"적용 완료" 토스트.
- 후속 UI: 미리보기 노드 호버 채우기, 일괄 속성 동일값 자동 스킵, 노드정보 박스 아웃라인 밖 이동·접기.
- 후속 UI: AI 패널 상시 표시(비활성 시 사유), 대시보드 상단 sticky·본문 스크롤, 서브프로세스 버튼 미리보기 이동, 그룹 일괄 편집 개선(개별선택 마법사·그룹명·기존값 팝오버), 노드정보 토글 스위치.
- 그룹 멤버 일괄 편집(색상·속성, 충돌 처리: 교체/추가/건너뛰기/개별) 신규 `group-bulk-modal.tsx`.
- UI 개선 4종: 대시보드 정리, 요약 모달 서브프로세스 진입 버튼, 드롭존 0.7배·겹침+dwell 트리거, 노드 표시 정보 선택(localStorage).
- DB 스톱갭(`app/db.py`)에 워크플로우 컬럼 보강(`status` DEFAULT 'draft' 백필) — 기존 DB 데이터 보존 자동 마이그레이션. `tests/test_db.py`.
- AI 모델 선택(프론트 드롭다운, `/v1/models` 프록시) + 접속 테스트 문서 `docs/ai-connectivity-test.md`.
- 온프레미스 AI 채팅 구현 — 백엔드 OpenAI 호환 프록시(`ai_client`/`ai_prompt`/`manual`/`routers/ai`, 502에 내부 URL 비노출, AI 서버 mock 테스트) + 프론트 채팅·미리보기·적용·매뉴얼. 설계 `specs/2026-06-15-ai-chat-flowchart-design.md`. **미해결: 실 vLLM `/v1/models` 502(서버측, 보류).**

## 2026-06-14
- 버전 승인 워크플로우 풀스택 완료 — Draft→Pending→Approved→Published(+Rejected), 맵별 만장일치 승인자, 수동 게시+구버전 강등, 인앱 알림. 대시보드(라이프사이클 stepper·승인자 체크리스트·높이조절), 상태배지·액션 버튼. 설계 `specs/2026-06-14-version-approval-workflow-design.md`.
- 워크플로우 버그·스모크 수정 — 모달 갇힘 portal화, Submit 막다른길 방지, `isMapOwner` 백엔드 정합.
- 캔버스 UX — 드롭존 줌 고정, 아웃라인/검색 선택 노드 보더, 방향별 엣지 색강조.

## 2026-06-13
- 에디터 UI 대개편 — 좌 사이드바(아웃라인 트리), 우 인스펙터 상시·폭조절, 컨텍스트 메뉴(divider), 단축키 레전드, 드래그-오버 드롭존(앞/뒤/그룹/하위), 비활성창 정적 SVG 프리뷰. 설계 `specs/2026-06-13-{editor-ui,drag-drop-zones,node-interactions}-design.md`.
- 그룹(업무 묶음) 풀스택 — `groups` 테이블+`nodes.group_id`, 그룹 박스·타이틀바(이름/색/이동/나가기). 노드·그룹 색 팔레트 무채도 톤으로 세련화.
- Whimsical 디자인 — 바이올렛 액센트(#6A41FF)·파스텔 노드·dot-grid·움직이는 엣지·겹침 방지. `specs/2026-06-13-whimsical-design-design.md`, `rules/frontend/design.md`.

## 2026-06-12
- OS형 자유 창(드릴인 윈도우 `ScopeWindow` — 이동/리사이즈/포커스/최소·최대/영속). `specs/2026-06-12-os-windows-design.md`.
- UI 디자인 시스템 — Tailwind4 `@theme` 토큰·Pretendard·Lucide, flat+hairline. `specs/2026-06-12-ui-design-system-design.md`.
- UI 개선 — 계단식 창, 전역 네비바+경량 i18n(en/ko), 박스선택·스페이스 팬. `specs/2026-06-12-ui-improvements-design.md`.
- 기능 확장 Phase A/B/C(`docs/spec.md` §7) — A: undo/redo·마우스위치 컨텍스트메뉴·자동저장·노드 색/모양/엣지 라벨. B: BPM 속성 4종·버전 diff(계보 매칭)·초성 검색·PNG. C: 체크아웃 잠금·노드 코멘트(폴링).
- 문서 명령 bash/PowerShell 병기 원칙(`rules/common/documentation.md`).

## 2026-06-11
- 초기 구축(spec §6 ①~⑤): 스캐폴딩(Next+FastAPI+nginx+compose, 9787) → 맵 CRUD+캔버스 → 계층(드릴다운·브레드크럼)+정렬(dagre) → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). 배포 준비 `docs/deploy.md`. 기능 명세 `docs/spec.md`. 프로젝트명 BPM 확정.
