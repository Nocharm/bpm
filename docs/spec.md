# BPM (Business Process Management) — 기능 명세

현업이 계층형 프로세스맵을 그리고, As-Is/To-Be를 버전으로 관리·비교하는 웹 애플리케이션.

## 1. 핵심 개념

| 개념 | 설명 |
|------|------|
| **ProcessMap** | 프로세스맵 문서 단위 (예: "구매 프로세스"). 버전들을 묶는 컨테이너 |
| **Version** | 맵의 스냅샷. 라벨(As-Is, To-Be, 자유 입력)을 가지며 각각 독립 편집. 버전 간 비교 화면 제공 |
| **Node** | 프로세스 단계. 한 버전에 속하며, 다른 노드의 하위 맵에 속할 수 있음 (계층) |
| **Edge** | 노드 간 선후(흐름) 연결. 같은 캔버스(같은 부모) 내 노드끼리만 연결 |

**관계 두 축:**
- **선후 (sequence)** — Edge로 표현. 같은 레벨 캔버스 안에서 화살표 연결
- **상하 (hierarchy)** — `parent_node_id`로 표현. 노드가 자신의 하위 프로세스맵(자식 노드들의 캔버스)을 가짐. **깊이 무제한** (재귀)

## 2. 데이터 모델 (초안)

```
process_maps   id, name, description, created_by, created_at, updated_at
map_versions   id, map_id(FK), label(As-Is/To-Be/custom), created_by, created_at, updated_at
nodes          id, version_id(FK), parent_node_id(FK nodes, null=최상위 캔버스),
               title, description, node_type, pos_x, pos_y, sort_order
edges          id, version_id(FK), source_node_id(FK), target_node_id(FK), label
```

- 계층 탐색: `parent_node_id = X`인 노드들 = 노드 X의 하위 캔버스
- 버전 생성: 기존 버전(예: As-Is)의 노드/엣지 전체를 깊은 복사해 새 라벨(To-Be)로 생성

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
- **비교 화면**: 두 버전을 좌우 나란히 읽기 전용 렌더 (1차). 노드 추가/삭제/변경 하이라이트는 후속 단계

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
| proxy | nginx — **서버 노출 포트 9787** | `/` → frontend, `/api` → backend |

- 접속: 우선 `http://<서버IP or g-ai-agent.sbiologics.com>:9787` 포트 직접 접속 → 추후 서버 엣지 nginx(직접 편집 가능)에 도메인 라우팅 추가
- Keycloak(8080)은 이 compose 외부의 기존 서비스 — 주소는 `.env`로만 참조

## 6. 단계별 구현 순서 (제안)

1. ~~**스캐폴딩** — frontend/backend/nginx/compose + 로컬 네이티브 실행 확인~~ ✅
2. ~~**맵 CRUD + 캔버스 편집/저장** — 단일 레벨, 인증 없이~~ ✅
3. ~~**계층(드릴다운+브레드크럼) + 정렬**~~ ✅ — 캔버스는 (version, parent_node_id) 스코프, 저장은 스코프별 교체
4. ~~**버전 관리 + 비교 화면**~~ ✅ — 버전 복제(깊은 복사, ID 재발급)/이름변경/삭제, 두 버전 나란히 읽기 전용 비교
5. ~~**Keycloak 인증 연동**~~ ✅ — OIDC 로그인 + JWT 검증, AUTH_ENABLED 플래그로 로컬 우회
6. **서버 docker-compose 배포 (9787)** — 런북 `docs/deploy.md`. compose config 정적 검증 완료, 실제 빌드/기동은 서버에서
