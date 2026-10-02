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

## 2. 데이터 모델

정본은 코드다: 컬럼은 `backend/app/models.py`, API 입출력과 검증은 `backend/app/schemas.py`(`NodeIn`/`EdgeIn`/`NodeOut` 등). 아래는 필드군 요약이며, 새 노드 필드를 넣을 때 갱신할 지점은 CLAUDE.md "노드 속성 추가 체크리스트"가 열거한다.

```
process_maps   id, name, description, created_by, created_at, updated_at, deleted_at(휴지통),
               owner_id, visibility(private/public), owning_department,   # 권한 (RBAC)
               mode(normal/framework=L5 연계 캔버스),
               category_id, consultant_code, consultant_owner_pending,    # 업무 체계 슬롯·컨설턴트 임포트
               sp_designated_at, sp_department, sp_assignee, sp_assignee_role, sp_system,
               sp_duration, sp_touch_time, sp_cost_krw, sp_cost_usd, sp_headcount,
               sp_annual_count, sp_fte, sp_url, sp_url_label, sp_input, sp_output,
               sp_input_forms, sp_output_forms, sp_input_ids, sp_output_ids,
               sp_start_condition, sp_end_condition, sp_gmp,               # 서브프로세스 지정값(링크 노드가 상속)
               sp_*_fallback                                               # 임포트 원문 메모 5종
map_versions   id, map_id(FK), label, created_by, created_at, updated_at,
               status(draft/pending/approved/rejected/published/expired, 연계 캔버스는 confirmed),
               version_number, fw_major, fw_minor, submitted_by, reject_reason,
               checked_out_by, checked_out_at, checked_out_from           # 체크아웃 잠금
nodes          id, version_id(FK), title, description, node_type, color, width,
               pos_x, pos_y, sort_order, source_node_id(복제 출처, diff 계보 매칭),
               assignee, assignee_role, department, system, system_fallback, gmp, url, url_label,
               duration, touch_time, cost_krw, cost_usd, headcount, annual_count, fte,  # 회당 파라미터 7종
               input, output, input_flags, input_forms, output_forms,      # 입출력(줄 단위 항목)
               output_ids, input_links, output_links,                      # IO 링크(항목 id 기반)
               start_condition, end_condition,
               group_id, group_ids,                                        # 업무 그룹(다중 태그) 소속
               linked_map_id, linked_version_id, follow_latest,            # subprocess 참조(Call Activity)
               placeholder_category_id,                                    # 미등록 L6 자리 표시
               is_primary_end,                                             # 대표 끝(프로세스당 1개)
               parallel_outputs                                            # 병렬 출구 키 JSON 리스트(§3.1 출력 규칙)
edges          id, version_id(FK), source_node_id, target_node_id, label,  # node FK 없이 앱 계층 검증
               source_side, target_side, source_handle, target_handle,     # 변·핸들(SP는 끝 키·in 변형, §3.1)
               line_style,                                                 # 엣지별 선 모양
               gateway                                                     # 임포트 출처 기록, "parallel"만 레거시 병렬 도출에 쓰임
groups         id, version_id(FK), parent_group_id, label, color
comments       id, version_id(FK), node_id, author, body, resolved, created_at  # 노드 코멘트
```

- 폐기 컬럼(`process_maps.doc_*`, `nodes.section_anchor`, `interview_sessions.mode`)은 모델에 매핑만 남기고 읽지 않는다(CLAUDE.md Lessons).
- 노드는 평면(버전 스코프) — 계층은 subprocess 노드의 `linked_map_id` 참조로 표현(§1).
- `map_notes`(맵 또는 L5 카테고리 스코프, `kind` 태그·`source` consultant-import|user·`edited_at`) — 인터뷰 임포트 노트 + 사용자 노트. API: `GET/POST/PATCH/DELETE /maps/{id}/notes[/{note_id}]`(열람 viewer, 쓰기 owner) · `/categories/{id}/notes[/{note_id}]`(열람 전원, 쓰기 체인 관리자/sysadmin). 맵 단위 원문 메모(구 인터뷰 원문 메모) 5종(`sp_*_fallback`)은 `PATCH /maps/{id}/fallback-notes`(editor)로 편집 (2026-09-03).
- 버전 생성: 기존 버전(예: As-Is)의 노드/엣지 전체를 깊은 복사해 새 라벨(To-Be)로 생성. 권한·버전 워크플로 데이터 모델은 권한 설계 문서 참조(git history `2026-06-20-permission-management-design.md`).

## 3. 화면 / UX

### 3.1 캔버스 에디터 (React Flow 기반)
- 노드 추가/편집(제목·설명·유형)/삭제, 드래그 이동
- 노드 핸들 드래그로 선후 Edge 연결, Edge 삭제
- 출력 규칙(2026-10-01, 일반 맵·L5 연계 캔버스 공통, 단일 소스 `frontend/src/lib/output-rules.ts` ↔ `backend/app/subprocess.py` `find_output_rule_violations`): 출구(일반 노드는 `__primary__` 하나, 하위프로세스는 끝 키)마다 엣지 1개. **병렬 출구**(`nodes.parallel_outputs`, 또는 엣지 2개 이상이 전부 `gateway="parallel"`인 레거시 도출)는 2개 이상. 분기(decision)는 규칙 밖(택일 다중 출력). 시작(start)은 기본 병렬이라 규칙 밖이다: 연결 수를 따지지 않고 팬아웃은 병렬로 펄스하며 병렬 토글이 없다(택일 시작은 start 바로 뒤 decision, 사용자 결정 2026-10-02). 저장 체크리스트·게이트 6 라벨은 "갈래는 판단 노드나 병렬 출구로"(실패 필 "판단·병렬 없이 갈라짐"). 삽입 재연결 중 일시 초과는 허용하고 저장 체크리스트가 수동 저장·승인 시작을 막는다(자동 저장은 막지 않음). L5 확정 게이트 6과 동치. 병렬 토글은 노드 우클릭(하위프로세스는 끝별 하위 메뉴), AI `attributes.parallel`·CSV `Parallel` 열은 노드 기본 출구만 다룬다. 병렬을 끄면 그 출구 엣지의 레거시 `gateway=parallel`도 지운다(남기면 도출이 다시 병렬로 읽는다). 병렬 출구 노드는 테두리 안쪽에 옅은 링을 그린다. 흐름 펄스(렌더 전용): 병렬 갈래는 경로 75%까지 같은 박자로, 분기 갈래는 동시 출발→약 1초 뒤 함께 정지·반짝임→하나씩 반짝임→무작위 한 갈래만 50%까지 전진·나머지 페이드. 소스 노드 선택 시 채도↑·불투명·1.25배속, 형제 한 갈래 선택 시 나머지는 이번 회차 뒤 정지, L5 차콜 하늘에선 밝은 점. 핸들에 직접 놓은 연결은 잡은·놓은 핸들을 그대로 저장한다(삽입/교체 경로 포함).
- 하위프로세스 노드 핸들(2026-10-01): 들어오는 문은 네 변(`in`=좌 레거시, `in:top`·`in:right`·`in:bottom`)이며 받기 전용(연결 드래그 중에만 보임). 출구는 링크 맵의 끝마다 하나(`__primary__`=대표 끝, 그 외=끝 제목)이고 우측 한 점에 겹쳐 그려지며, 끝마다 위 출력 규칙이 적용된다. 끝이 2개 이상이면 라벨 우측에 출구 사용량/끝 수 배지(초과는 `+N`). 끝이 2개 이상인데 끝을 모르는 생성 경로(드롭존 앞/뒤·역방향 몸체 드롭)는 출구 선택 목록(`EdgeEndModal`, 대표 끝 첫 행)을 거친다. 출구 엣지에 라벨이 없으면 끝 제목을 **미러**(점선 알약·링크 아이콘, 저장 안 함)로 표시한다. 가운데 스왑은 양쪽 출력 + 한쪽 2개 이상이면 출력 자리 바꾸기 모달(짝=타깃만 교환, 라벨·끝 키는 노드에 잔류, 짝 없는 출력은 남김, 확인해야 실행). 펼침 게이트웨이는 끝별 호스트 엣지에만 매핑되고 점선이 흐른다. 생성 경로(컨설턴트 임포트·AI·CSV)가 새로 만드는 SP 엣지는 출구를 대표 끝(`__primary__`), 입구를 `in`에 붙인다(L6 임포트는 배치 결과의 변으로 `in:<변>`). 보조 끝 출구와 끝별 병렬은 캔버스에서만 만든다. 같은 맵 재가져오기는 기존 엣지의 끝·입구 변·선 모양·gateway를 (출발→도착) 쌍으로 이월한다(새 맵 만들기는 대표 끝). 확정 서명·변경 요약·비교 화면·AI 비교 보고서는 SP 출구 끝 키 변경을 내용 변경으로 세고(같은 쌍의 두 끝은 별개 엣지), 변·입구 위치 이동은 레이아웃이라 세지 않는다. 알려진 한계: 끝 키가 끝 제목이라 링크 맵이 끝을 개명·삭제하면 부모의 해당 엣지와 끝별 병렬 설정이 고아가 되고(별도 출구 그룹으로 세어져 게이트가 잡지 못함), 끝 제목이 `in`·`in:<변>`·변 이름이면 대표 끝으로 오분류된다(상세는 CLAUDE.md 하위프로세스 핸들 계약).
- 같은 핸들(변)로 모이는 엣지는 렌더 시 팬아웃(2026-09-30, `frontend/src/lib/edge-fanout.ts`): 핸들 앞 레인(14px + 10px 간격)에서 반경이 다른 원호로 접선 진입해 끝점에서만 만난다. 대향 진입은 먼 소스가 안쪽, 루프백(동측)은 가까운 소스가 안쪽. 곡선은 제어점 중첩, 직선은 끝점을 핸들 안에서 ±3.5px 분산. 저장 데이터·핸들 변은 불변(표시 전용), 에디터·비교 화면·SVG 미리보기(역행)에 적용
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
- **비교 화면 확장 (2026-09-18)**: 노드 위 속성 칩·조건·입출력 `+N −M` 요약(`lib/io-diff.ts`)과 변경 필드 힌트(`data.diffFieldStatus`), 속성 패널 "모두/변경만" 범위 토글, 실측 크기 기반 재배치. 세 번째 탭 **AI 요약** — FE가 계산한 병합 diff(`CompareDiffPayload`, 노드/엣지 각 200 상한, 추가 노드는 설명·역할·부서·시스템 동봉, `assignee` 실명 제외)와 흐름 문맥(변경 노드의 이웃 무변경 노드·남긴 노드 사이 모든 엣지, 엣지 400)·버전 파라미터 합계(`metrics`, 요약 탭과 동일)·입출력 항목 변경과 소비처(`io_changes`)를 `POST /api/maps/{id}/compare/ai-summary`로 보내 **개조식 보고서 4블록**(title·opening·`sections`=의도별 개정 요지·`impacts`=흐름·통제 영향·`unmentioned`=제출 코멘트 대비 미언급(`has_submit_note`)·`questions[]`=결재 전 확인 질문·closing; 요지 절 항목·영향·미언급은 공통 `{point, kind, refs}`이고 `kind`(added/removed/changed/increase/decrease/flow/control/risk/note, 미지 값은 서버가 note로)를 FE가 Lucide 아이콘+상태색으로 그린다)을 받는다(프롬프트 키 `compare_summary_contract`, 계량 `ai_usage_events kind=compare_summary`). 변경 목록 나열은 왼쪽 패널 몫이라 보고서에서 뺀다(2026-09-21). 서버는 맵 이름·오너 부서·제출자·제출 코멘트를 프롬프트 맥락으로 넣고, `ai_compare_summaries`에 (맵, base, target, 언어)당 1행을 캐시한다 — diff+언어+프롬프트 계약의 sha256이 같으면 모델 호출 없이 `cached=true`로 반환, `force`면 재생성 후 교체. FE는 AI 탭을 열 때만 호출한다(선행 생성 없음, 2026-09-20). `?base=&target=` 딥링크. **제출 코멘트 AI 초안(2026-09-21)**: 승인 요청 다이얼로그(에디터·설정>버전 패널 공용 `SubmitConfirmDialog`)의 "AI 초안" 버튼 → FE `lib/submit-note-draft.ts`가 최신 게시본(없으면 null=첫 제출) 대비 같은 페이로드로 `POST /api/maps/{id}/compare/submit-note-draft`(editor 게이트, 캐시 없음, `kind=submit_note`, 프롬프트 키 `submit_note_contract`) → 개조식 2~4줄을 textarea에 채운다(제출자가 고쳐 올림).
- **비교 대상 확장 (2026-10-02)**: 링크(`url`·`url_label`)가 비교 필드(`lib/diff.ts` FIELD_KEYS·속성 패널·확정 서명·AI 비교 페이로드)에 들어가고, 하위프로세스 출구 끝 변경은 엣지 변경으로 잡힌다(§3.1). 링크 정체성(`linked_map_id`·`placeholder_category_id`·`is_primary_end`·`follow_latest`)도 FE diff에 들어가 BE 확정 서명과 같은 집합이다. 알려진 한계: 비교 캔버스는 하위프로세스를 끝 핸들 없이 네 변 핸들로 그려, 한 SP의 두 끝이 같은 대상으로 가면 같은 변 핸들에서 나가는 두 엣지(팬 레인으로만 구분)로 보인다. 어느 끝인지는 변경 목록과 속성 패널의 출구 행에서만 드러나고, 그래서 SP 노드의 병렬 호버 배지도 비교 화면에서는 띄우지 않는다. 컨설턴트 임포트의 재전달 감지 서명은 전달 필드 전용이라 링크를 넣지 않는다.
- **승인자 착지 (2026-09-18)**: 내가 결재할 pending 버전이 있으면 에디터가 그 버전으로 착지(`?version=` 우선). 다른 버전에서는 상단 배너 링크 + 승인 탭 워크플로 섹션 덮개(`SectionOverlay`), pending 버전에는 "게시본과 비교" CTA(최신 게시본 ↔ pending 딥링크).

### 3.5 맵 목록
- 전체 맵 목록 (이름·설명·버전 수·수정일), 생성/삭제
- **업무 체계 보기 (2026-09-19)**: L5 포커스 드릴다운(`components/maps/framework-drill.tsx`) — 브레드크럼 + 형제(1):하위(2) 두 열, L5는 캔버스 카드, 소속 맵은 우측 요약(`category-summary-card.tsx`) 담당, 위치는 `bpm.home.frameworkDrill`로 영속. **탐색 플로팅 패널**(`framework-explorer-modal.tsx`, 계단식 트리 ↔ ERD식 다이어그램 `lib/framework-diagram.ts`, 우클릭 GoToMenu, `GET /categories/all` 클라이언트 검색 `lib/search`). `GET /categories/nodes`는 전 레벨 `l5_count`·`admin`, L5 전용 `canvas_state`·`slot_pending_count`를 함께 준다(FE/BE 동시 배포).

## 4. 인증 — Keycloak (OIDC)

- 같은 배포 서버의 Keycloak 사용: realm `ai-portal` (주소는 `.env`로 관리, 예: `http://182.199.63.71:8080/realms/ai-portal`)
- frontend: OIDC Authorization Code + PKCE 로그인(`react-oidc-context`) → backend API 호출 시 Bearer 토큰
- backend: realm JWKS로 RS256 서명 검증(`pyjwt[crypto]`) 후 사용자 식별 — `created_by`에 기록
- **인증 모드(확정, 2026-08-19)**: backend `AUTH_MODE`(`keycloak`|`ldap`|`dev`, 비면 구 `AUTH_ENABLED`로 유도)가 유일한 스위치. frontend는 빌드타임 상수 없이 `GET /api/auth/mode`로 부팅 시 런타임 조회한다. 로컬 네이티브는 `AUTH_MODE` 미설정(=`dev`, 우회), 서버 compose는 `keycloak`. `/api/health`는 항상 인증 면제
- Keycloak에 public(PKCE) 클라이언트 등록 필요 — client_id `KEYCLOAK_CLIENT_ID`(예: `bpm-frontend`), redirect_uri는 앱 origin

## 5. 기술 스택 / 배포

| 레이어 | 선택 | 비고 |
|--------|------|------|
| frontend | Next.js + TypeScript + **@xyflow/react** (React Flow) | 캔버스/노드/엣지 에디터 표준 |
| backend | **FastAPI** + SQLAlchemy + Pydantic | 비동기 API, 검증은 Pydantic |
| db | PostgreSQL | |
| proxy | nginx — **서버 노출 포트 9900** | `/` → frontend, `/api` → backend |

- 접속: 우선 `http://<서버IP or g-ai-agent.sbiologics.com>:9900` 포트 직접 접속 → 추후 서버 엣지 nginx(직접 편집 가능)에 도메인 라우팅 추가
- Keycloak(8080)은 이 compose 외부의 기존 서비스 — 주소는 `.env`로만 참조

## 6. 단계별 구현 순서 (제안)

1. ~~**스캐폴딩** — frontend/backend/nginx/compose + 로컬 네이티브 실행 확인~~ ✅
2. ~~**맵 CRUD + 캔버스 편집/저장** — 단일 레벨, 인증 없이~~ ✅
3. ~~**계층(드릴다운+브레드크럼) + 정렬**~~ ✅ — 캔버스는 (version, parent_node_id) 스코프, 저장은 스코프별 교체
4. ~~**버전 관리 + 비교 화면**~~ ✅ — 버전 복제(깊은 복사, ID 재발급)/이름변경/삭제, 두 버전 나란히 읽기 전용 비교
5. ~~**Keycloak 인증 연동**~~ ✅ — OIDC 로그인 + JWT 검증, AUTH_ENABLED 플래그로 로컬 우회
6. ~~**기능 확장 Phase A/B/C** — §7. 캔버스 UX → 데이터·조회 → 협업~~ ✅
7. ~~**서버 docker-compose 배포 (9900)**~~ ✅ — 런북 `docs/deploy/deploy.md`(Keycloak 로그인 + 사내 AD 동기화 포함). compose config 정적 검증 완료, 실제 빌드/기동은 서버에서
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

### 7.x 업무 체계 슬롯 수명주기 (2026-09-06)

- **슬롯** = `process_maps.category_id`(L5 소속, L5 전용) + `consultant_code`(재전달 결착 키). 변경 5액션 `assign·unassign·move·replace·delete`는 `POST /api/maps/{id}/slot-changes`(dry_run 미리보기) 한 곳으로 들어온다.
- **승인**: 요청자가 L5 직속 관리자/sysadmin이면 즉시 적용(화면은 안내 모달), 아니면 `ApprovalRequest(kind="fw_slot")`. 이동은 보내는·받는 L5 각 1명(동일인 1회). 결정은 `POST /api/approval-requests/{id}/decide`, 철회 `DELETE /maps/{id}/slot-changes/pending`.
- **적용**(`app/framework_slots.py apply_slot_change`): 데이터 변경 + 홈 L5 캔버스 draft 노드 재지정(대체·후계자 삭제, 엣지 유지) + `retired_to_map_id` 계보 + `framework_slot_events` 이력 + `fw_slot_applied` 알림. 해제·삭제 노드는 링크를 끊지 않고 미싱 룩으로 표시, 확정 게이트 `stale_link`가 잡는다.
- **가드**: `mode='normal'`만 슬롯 보유. 슬롯 맵의 `DELETE /maps/{id}`·`copy retire_source`는 409 → slot-changes. 임포트는 승인 없이 그대로(부트스트랩), 미배치 taskId 엣지는 플레이스홀더 노드로.

### 7.x 고아 참조 감사 (2026-09-09)

- **대상 12곳**: 부서 경로 3(맵 부서 권한·그룹 부서 멤버·오우닝) + 리프 2(SP 지정 부서·노드 담당부서) + 사용자 login 5(오너·협업자·승인자·그룹 user 멤버·카테고리 권한자) + 이름 2(SP 담당자·노드 담당자). 유효 집합은 active 직원 기준(`app/ref_audit.py load_valid_sets`). 노드는 게시본+최신 드래프트만.
- **온디맨드**: 저장 테이블 없음. `GET /api/admin/ref-audit`(sysadmin)·`POST …/remap`(체크한 `target_id`만 replace/remove, 값이 바뀐 라인은 `skipped`)·`POST …/notify`(오너당 1건 `ref_fix_requested`). 오너 교체는 `owner_assigned` 알림. `GET /api/maps`의 `stale_ref_count`가 홈 배지·Issues 필터 소스.
- **불변식**: 노드 필드(`node_dept`·`node_assignee`)는 관리자가 못 고친다(드래프트 필요) — 캐치·알림만. 오너·오우닝·SP 부서는 remove 불가. 이름 기반 참조는 이름이 그룹 키(동명이인 1명 active면 유효).
