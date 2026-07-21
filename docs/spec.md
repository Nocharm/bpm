# BPM (Business Process Management) — 기능 명세

현업이 계층형 프로세스맵을 그리고, As-Is/To-Be를 버전으로 관리·비교하는 웹 애플리케이션.

## 1. 핵심 개념

| 개념 | 설명 |
|------|------|
| **ProcessMap** | 프로세스맵 문서 단위 (예: "구매 프로세스"). 버전들을 묶는 컨테이너 |
| **Version** | 맵의 스냅샷. 라벨(As-Is, To-Be, 자유 입력)을 가지며 각각 독립 편집. 버전 간 비교 화면 제공 |
| **Node** | 프로세스 단계. 한 버전에 속하는 **평면** 노드. `node_type="subprocess"`면 다른 맵을 참조(Call Activity) |
| **Edge** | 노드 간 선후(흐름) 연결. 같은 버전 캔버스 내 노드끼리만 연결 |

**관계 두 축:**
- **선후 (sequence)** — Edge로 표현. 같은 버전 캔버스 안에서 화살표 연결
- **상하 (hierarchy)** — **하위프로세스 참조 모델(Call Activity)**. 옛 인라인 계층(`parent_node_id`)은 폐기 — subprocess 노드가 `linked_map_id`로 다른 맵을 링크하고, 그 맵을 읽기전용으로 인라인 임베드/드릴인한다. 편집은 루트 맵에서만, 임베드 자식은 읽기전용. 설계: git history `2026-06-20-subprocess-reference-model-design.md`

## 2. 데이터 모델 (초안)

```
process_maps   id, name, description, created_by, created_at, updated_at,
               owner_id, visibility(private/public)        # 권한 (RBAC, 후속 절)
map_versions   id, map_id(FK), label(As-Is/To-Be/custom), created_by, created_at, updated_at,
               status(draft/pending/approved/rejected/published),  # 버전 게시 워크플로
               checked_out_by, checked_out_at              # 체크아웃 잠금 (§7 Phase C)
nodes          id, version_id(FK), title, description, node_type, pos_x, pos_y, sort_order,
               color,                                      # 노드 색 지정 (§7 Phase A)
               assignee, department, system, duration,     # BPM 속성 (§7 Phase B)
               source_node_id,                             # 복제 출처 — diff 계보 매칭 (§7 Phase B)
               group_id, group_ids,                        # 업무 그룹(다중 태그) 소속
               linked_map_id, linked_version_id, follow_latest,  # subprocess 참조(Call Activity)
               is_primary_end                              # 대표 끝(프로세스당 1개, 버전업 유지)
edges          id, version_id(FK), source_node_id, target_node_id, label  # node FK 없이 앱 계층 검증
comments       id, version_id(FK), node_id, author, body, resolved, created_at  # 노드 코멘트 (§7 Phase C)
```

- 노드는 평면(버전 스코프) — 계층은 subprocess 노드의 `linked_map_id` 참조로 표현(§1).
- 버전 생성: 기존 버전(예: As-Is)의 노드/엣지 전체를 깊은 복사해 새 라벨(To-Be)로 생성. 권한·버전 워크플로 데이터 모델은 권한 설계 문서 참조(git history `2026-06-20-permission-management-design.md`).

## 3. 화면 / UX

### 3.1 캔버스 에디터 (React Flow 기반)
- 노드 추가/편집(제목·설명·유형)/삭제, 드래그 이동
- 노드 핸들 드래그로 선후 Edge 연결, Edge 삭제
- 저장은 명시적 저장 버튼 + 주기적 자동 저장

### 3.2 계층 탐색 — 오버레이 스택 + 브레드크럼
사용자 제안(창 위에 창, 윈도우식)을 다음과 같이 다듬어 구현:

- 노드 **더블클릭 → 하위 맵이 오버레이 카드로 위에 쌓임**. 이전 캔버스가 가장자리에 살짝 보여 "창 위에 창" 멘탈 모델 유지
- 깊이 무제한 — 들어갈 때마다 카드가 겹겹이 스택
- 상단 **브레드크럼** (예: `홈 > 구매 > 발주 > 검수`)으로 현재 깊이 표시, 클릭 시 해당 레벨로 점프
- `ESC` 또는 카드 닫기 = 한 단계 복귀
- **자유 이동/리사이즈 가능한 MDI 창은 채택하지 않음** — 창 관리(겹침·포커스·최소화) 구현 비용이 크고, 여러 창이 열리면 어느 창이 어느 노드의 하위인지 추적이 어려움. 스택+브레드크럼이 같은 개념을 더 단순하게 전달

### 3.3 정렬
- **자동 정렬 버튼** — 레이아웃 엔진(dagre 또는 elkjs)으로 선후 흐름 기준 좌→우 자동 배치
- **선택 정렬** — 다중 선택 후 좌/우/상/하 맞춤, 가로/세로 등간격 분배

### 3.4 버전 관리 / 비교
- 맵 상세에서 버전 목록·생성(기존 버전 복제)·라벨 변경·삭제
- **비교 화면**: 두 버전을 좌우 나란히 읽기 전용 렌더 (1차). 노드 추가/삭제/변경 하이라이트는 §7 Phase B에서 구현

### 3.5 맵 목록
- 전체 맵 목록 (이름·설명·버전 수·수정일), 생성/삭제

## 4. 인증 — Keycloak (OIDC)

- 같은 배포 서버의 Keycloak 사용: realm `ai-portal` (주소는 `.env`로 관리, 예: `http://182.199.63.71:8080/realms/ai-portal`)
- frontend: OIDC Authorization Code + PKCE 로그인(`react-oidc-context`) → backend API 호출 시 Bearer 토큰
- backend: realm JWKS로 RS256 서명 검증(`pyjwt[crypto]`) 후 사용자 식별 — `created_by`에 기록
- **우회 플래그(확정)**: `AUTH_ENABLED`(backend) / `NEXT_PUBLIC_AUTH_ENABLED`(frontend). 로컬 네이티브는 미설정(우회), 서버 compose는 `true`. `/api/health`는 항상 인증 면제
- Keycloak에 public(PKCE) 클라이언트 등록 필요 — client_id `KEYCLOAK_CLIENT_ID`(예: `bpm-frontend`), redirect_uri는 앱 origin

## 5. 기술 스택 / 배포

| 레이어 | 선택 | 비고 |
|--------|------|------|
| frontend | Next.js + TypeScript + **@xyflow/react** (React Flow) | 캔버스/노드/엣지 에디터 표준 |
| backend | **FastAPI** + SQLAlchemy + Pydantic | 비동기 API, 검증은 Pydantic |
| db | PostgreSQL | |
| proxy | nginx — **서버 노출 포트 3333** | `/` → frontend, `/api` → backend |

- 접속: 우선 `http://<서버IP or g-ai-agent.sbiologics.com>:3333` 포트 직접 접속 → 추후 서버 엣지 nginx(직접 편집 가능)에 도메인 라우팅 추가
- Keycloak(8080)은 이 compose 외부의 기존 서비스 — 주소는 `.env`로만 참조

## 6. 단계별 구현 순서 (제안)

1. ~~**스캐폴딩** — frontend/backend/nginx/compose + 로컬 네이티브 실행 확인~~ ✅
2. ~~**맵 CRUD + 캔버스 편집/저장** — 단일 레벨, 인증 없이~~ ✅
3. ~~**계층(드릴다운+브레드크럼) + 정렬**~~ ✅ — 캔버스는 (version, parent_node_id) 스코프, 저장은 스코프별 교체
4. ~~**버전 관리 + 비교 화면**~~ ✅ — 버전 복제(깊은 복사, ID 재발급)/이름변경/삭제, 두 버전 나란히 읽기 전용 비교
5. ~~**Keycloak 인증 연동**~~ ✅ — OIDC 로그인 + JWT 검증, AUTH_ENABLED 플래그로 로컬 우회
6. ~~**기능 확장 Phase A/B/C** — §7. 캔버스 UX → 데이터·조회 → 협업~~ ✅
7. ~~**서버 docker-compose 배포 (3333)**~~ ✅ — 런북 `docs/deploy/deploy.md`(Keycloak 로그인 + 사내 AD 동기화 포함). compose config 정적 검증 완료, 실제 빌드/기동은 서버에서
8. ~~**하위프로세스 참조 모델(Call Activity)**~~ ✅ — 인라인 계층 편집(`parent_node_id`) 폐기 → 평면 노드 + 다른 맵 링크(읽기전용 임베드·드릴인). 설계 `…/2026-06-20-subprocess-reference-model-design.md`
9. ~~**권한 관리(RBAC) 백엔드**~~ ✅ — 맵 가시성/소유자/협업자(user·dept·group 3종 principal)·승인자·버전 게시 워크플로·유저그룹. 게이트는 `DEV_ENFORCE_PERMISSIONS`로 로컬 검증. 설계 `…/2026-06-20-permission-management-design.md`

## 7. 기능 확장 (2026-06-12 확정)

⑤까지 완료 후, 배포 전 추가하기로 확정한 기능. Phase 단위로 구현·검증·커밋한다.

### Phase A — 캔버스 편집 경험

| 기능 | 설계 |
|------|------|
| **Undo/Redo** | 에디터 스코프 단위 클라이언트 히스토리 스택. Ctrl+Z / Ctrl+Shift+Z(또는 Ctrl+Y). 노드 추가·이동·삭제·연결·속성 변경 기록. 백엔드 변경 없음 |
| **마우스 위치 컨텍스트 메뉴** | 캔버스 우클릭 → 커서 위치에 메뉴, "노드 추가"는 그 좌표(screenToFlowPosition)에 생성. 노드 우클릭 → 편집/삭제/드릴다운, 엣지 우클릭 → 라벨 편집/삭제. 화면 가장자리에서 메뉴 위치 보정 |
| **자동 저장 + 이탈 경고** | 변경 2초 디바운스 자동 저장, 미저장 상태 `beforeunload` 경고 |
| **노드 색·모양 / 엣지 라벨** | `nodes.color` 컬럼 추가(헥스 문자열, 빈 값=기본). `node_type`(process/decision/start/end — 기존 컬럼 활용)별 모양 렌더. 사이드패널에서 타입·색 선택, 엣지 라벨(기존 컬럼) 편집 노출 |

### Phase B — 데이터·조회

| 기능 | 설계 |
|------|------|
| **노드 속성 확장** | `assignee`(담당자)/`department`(부서)/`system`(시스템)/`duration`(소요시간) 컬럼 추가, 사이드패널 편집 |
| **버전 비교 diff** | 복제 시 노드 ID가 재발급되므로 `source_node_id`(출처 노드 ID)를 기록해 계보로 매칭, 계보 없으면 (parent 스코프, title) 매칭. 비교 화면에서 추가=초록/삭제=빨강/변경=노랑 하이라이트 + 변경 필드 목록 |
| **노드 검색 (+초성)** | 버전 전체 노드 조회 API → 클라이언트 검색. 한글 초성 매칭(유니코드 분해, 의존성 없음) + 일반 부분 일치. 결과 클릭 시 해당 스코프로 점프 + 노드 하이라이트 |
| **PNG 내보내기** | 현재 캔버스 PNG 다운로드 (`html-to-image`) |

### Phase C — 협업 (체크아웃 + 코멘트)

| 기능 | 설계 |
|------|------|
| **체크아웃 잠금** | 버전 단위 — 편집 진입 시 체크아웃(`checked_out_by/at`), 소유자만 저장 가능. 타 사용자는 읽기 전용 + "○○님이 편집 중" 배너. 30분 무활동 TTL 자동 해제 + 수동 해제. 저장/편집 활동이 heartbeat |
| **실시간 코멘트** | 노드 단위 코멘트 핀 + 스레드 패널(작성/해결). 5초 폴링으로 갱신 — WebSocket 미도입(추후 SSE 전환 가능). 작성자는 인증 사용자(`author`) |

**구현 순서 근거:** A는 프론트 중심(즉시 체감), B는 데이터 모델 확장(스키마 변경 동반), C는 신규 테이블·API(가장 큼). 각 Phase 종료 시 pytest/ruff/tsc/eslint/build 통과 후 커밋.
