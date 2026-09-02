# Framework L5 퍼블리시 기준·거버넌스 — 설계 스펙

2026-09-02 브레인스토밍 확정본. 전제 스펙: `2026-08-28-framework-l5-linkage-canvas-design.md`(현행 구현의 정본 — 본 스펙은 그 §6 수명주기·§9 가드를 대체/강화한다).

## 1. 목표

L5 연계 캔버스의 확정(퍼블리시)에 **완결성 기준**을 세우고, 일반 버전 워크플로와의 **이중 경로를 봉쇄**하며, 확정 스냅샷을 일반 게시본과 구분되는 **"담당자 확정(confirmed)" 상태**로 분리한다. 동시에 카테고리 권한자를 **레벨별 기능 차등** 구조로 확장하고, 전사/서브트리 **현황판**과 관리자 UI를 만든다.

## 2. 확정 결정 (브레인스토밍 Q&A)

| 항목 | 결정 |
|---|---|
| 퍼블리시 방향 | **완결성 게이트 + 레벨 관리자 구조 동시 설계. 본인 확정 유지**(상위 승인 없음) |
| 스냅샷 상태 | `published` 재사용 폐기 → **신규 `confirmed` 상태**. 시각 표식(워터마크·칩·필)도 게시와 다른 전용 디자인 |
| 게이트 강제 | **하드 블록** — 서버 422 + 확정 버튼 비활성 + 미충족 체크리스트 표시 |
| 게이트 조건 | 6종: 소속 L6 전원 배치 · 플레이스홀더 0 · 스테일 링크 0 · 링크 L6 전부 게시본 보유 · 탈출구 없는 순환 없음 · 일반 노드 직접 팬아웃 금지(§4) |
| 확정 점유 | **체크아웃 보유자만 확정**(submit 규약과 일관). 비어 있으면 자동 획득, 타인 점유면 409 |
| 레벨 권한 | **레벨별 기능 차등**(§7). 행 위치(카테고리 레벨)가 곧 역할 — 스키마 확장 없음 |
| sysadmin | **전역 owner + 임명 위임** — 모든 기능 수행, L1~L4 관리자는 자기 서브트리의 하위 레벨 관리자 임명 가능 |
| 상위 확정권 | L1~L4 관리자는 직접 확정 불가 — **L5 관리자에게 확정 요청**(대체 처리자 sysadmin). 알림 + 승인 탭 노출, 기존 승인/알림 디자인 준용(§5) |
| 분기 규칙 의도 | 임포트가 L6 노드에서 엣지를 직접 2개 만든 경우를 잡는 것. decision 노드 out-degree 1은 허용(이상하지만 무해) |
| 현황판 사용자 | **둘 다** — sysadmin은 전사, 관리자는 자기 서브트리(같은 화면, 스코프만 다름) |

## 3. 상태 모델 — `confirmed` 신설

- `workflow.py`에 `CONFIRMED = "confirmed"` 추가. `EDITABLE_STATUSES` 불변(확정본은 읽기전용).
- `framework-confirm`(maps.py:1189~)이 스냅샷을 `status="confirmed"`로 생성. `version_number` 채번 **중단**(게시 순번 소비자와 절연 — fw_major/minor가 유일 번호). `VersionEvent`도 신규 타입 `"confirmed"` 기록(기존 `"published"` 기록 중단).
- **운영 데이터 일회 이전**: startup 보강 시 `fw_major IS NOT NULL AND status='published'` → `confirmed`, 해당 버전의 `VersionEvent.event_type='published'` → `'confirmed'`. 멱등(재실행 무해). 운영 DB 리셋 불가 전제.
- DB 마이그레이션 불필요(status는 String(20), enum/CHECK 없음).

### 3.1 동반 수정 (published 소비자 전수 조사 결과)

| 지점 | 조치 |
|---|---|
| `versions.py:408` delete_version 차단 목록 | `confirmed` 추가 — 누락 시 확정 스냅샷 삭제 가능해짐 (**필수**) |
| `versions.py:191` create-version 게이트 | confirmed는 published가 아니므로 자동 409 — 옆문 #1 부수 봉쇄(§6 명시 가드도 추가) |
| `dashboard.py:283,341,408` 상태 열거 | `confirmed` 추가(누락 시 KeyError/집계 누락) |
| `maps.py:1614` restore 재인덱싱 | published만 인덱싱 유지 → confirmed 자동 제외(현행 confirm 경로 미인덱싱과 대칭 회복) |
| `framework-confirm-section.tsx:46` 스냅샷 파싱 | `published` → `confirmed` (**1순위**) |
| `compare/page.tsx:2220` 기준버전 자동선택 | framework 맵이면 최신 confirmed 기준 |
| `version-pill.tsx:33` "진행 중" 분류 | `confirmed` 제외 목록에 추가 |
| `page.tsx:1341~` 읽기전용 배너 | confirmed 분기 신설(누락 시 pending 오문구 폴백) |
| FE 열거 10곳 | `api.ts` VersionStatus · `version-status.ts` LABEL/STYLE · `status-badge.tsx` ×2 · `status-donut-card.tsx` COLOR+ORDER · `home-filter-pills.tsx` ORDER · `compare` STATUS_DOT · `approval-panel.tsx` switch · i18n `status.*`/`home.verStatus.*`/`home.verEvent.*` · `mock/permissions-store.ts`. Record 타입은 컴파일러가 누락 검출, 배열형(ORDER 2곳)만 수동 확인 |
| `maps.py:1495~` subprocess-usage 부모 집계 | 캔버스 라이브 draft가 `latest_vid` 폴백으로 잡히므로 동작 유지 — 변경 없음(의도 유지) |

### 3.2 시각 — "담당자 확정" 전용 디자인

"게시됨" 초록 톤과 구분되는 전용 표식(라벨은 UI 영어 규칙: **Confirmed**):

- **캔버스 워터마크**(page.tsx:9471~): `PUBLISHED` 자리에 `CONFIRMED` — 도장(seal) 모티프, 초록 아님(액센트 틴트 계열, BadgeCheck 동반). 디자인 토큰만 사용.
- **읽기전용 배너**: confirmed 전용 문구/아이콘(BadgeCheck).
- **버전 타임라인 칩**(version-timeline.tsx:237~): `event_type==="confirmed"` 칩 신설 — Published 초록(`bg-added`)과 다른 액센트 계열. `groupByMajor`는 라벨 정규식 기반이라 불변.
- **홈/카테고리 맵 카드 필**(`VERSION_STATUS_STYLE`): `confirmed` 스타일 신설(초록 아님).
- **PNG 정보 카드**: "게시일" → framework 맵은 "확정일"(`findPublishedAt`을 confirmed 이벤트 겸용으로).

## 4. 확정 게이트 — 하드 블록 6종

`framework-confirm`에 검사기 `validate_confirm_readiness(session, map, draft)` 신설. 위반 시 422(detail=문자열 요약 `"confirm gates failed: <codes>"`). **상시 체크리스트의 데이터 소스는 신규 `GET /api/maps/{map_id}/confirm-readiness`** — `{ready: bool, failures: [{code, count, node_ids?}]}` 반환(422 dict-detail은 FE 에러 경로가 못 받아 GET으로 일원화 — 2026-09-02 실측 결정). FE `FrameworkConfirmSection`에 상시 체크리스트(통과 ✓/미통과 행 + 위반 노드 포커스 링크), 미통과 시 버튼 비활성.

| # | code | 규칙 |
|---|---|---|
| 1 | `missing_l6` | 소속 L6 전원 배치 — linkage-map 보강 로직과 동일 산식으로 `missing_count == 0` |
| 2 | `placeholder` | `linked_map_id IS NULL`인 subprocess 노드 0개 |
| 3 | `stale_link` | 링크 대상 L6가 소프트삭제/이양(`retired_to_map_id`) 상태인 노드 0개 |
| 4 | `l6_unpublished` | 모든 링크 L6 맵에 `status='published'` 버전 존재(일반 맵 게시본 — confirmed 아님) |
| 5 | `noexit_cycle` | 탈출구 없는 순환 없음 — 밖으로 나가는 엣지가 0개인 SCC(크기≥2 또는 자기루프) 금지 |
| 6 | `plain_fanout` | 일반(비-decision) 노드의 out-degree ≥2 금지 — 분기는 decision 노드 경유. decision out-degree 1은 허용. **예외: 나가는 엣지 전부가 `gateway='parallel'`이면 합법**(0.4 임포트의 병행 팬아웃 규칙과 동일 — 사용자 확정 2026-09-02). 판정 재료로 `Edge.gateway` 컬럼 신설(임포터가 기록, 기존 캔버스는 재임포트 시 충전 — 운영 fw 데이터 0회) |

- 게이트 6의 팬아웃 판정은 source 노드 기준(out-degree) — 링크 L6의 서로 다른 출구(source_handle 상이)에서 나가는 엣지도 합산된다(의도: 분기 표현은 decision 노드로 일원화).

- **점유**: 확정 실행자는 라이브 draft 체크아웃 보유 필수. 비어 있으면 자동 획득 후 진행(linkage-map 보강의 "비었거나 본인" 선례), 타인 점유면 409.
- 기존 **무변경 409 게이트 유지**. major 승급은 무변경 게이트만 우회하고 **6종 게이트는 통과 필수**.
- 게이트는 확정 시점 검사 — 저장(graph PUT)은 막지 않는다(작업 중 미완 상태 허용).

## 5. 확정 요청 워크플로 (상위 관리자 → L5 관리자)

L1~L4 관리자는 서브트리 캔버스를 **편집**할 수 있으나 **확정은 불가** — 담당 L5 관리자에게 요청한다. 기존 승인/알림 디자인 준용.

- **엔티티**: `ApprovalRequest` 재사용 — `kind='fw_confirm'`, `payload={category_id, note?}`, 기존 status 라이프사이클(`pending/approved/rejected/withdrawn`) 그대로.
- **요청**: 편집 가능하되 확정권이 없는 주체 = 상위(L1~L4) 관리자 — 1맵 1 pending 유일(중복 409). 에디터 확정 섹션에서 "Request confirm" CTA(확정 버튼 대신 — canConfirm=false && canEdit일 때).
- **처리자**: 해당 L5 카테고리의 **직속 L5 관리자** + **sysadmin**(대체자). 처리 = 확정 실행(게이트 6종·점유 규약 동일 적용) 또는 반려(사유 코멘트, `decision_reason`). 직속 판정은 트랙 B에서 최소형 `is_direct_l5_admin`(해당 카테고리에 **직접** 붙은 `category_permissions` 행, 상속 없이)으로 구현하고 §7의 레벨 인지형 판정은 트랙 C에서 통합한다. **`framework-confirm` 자체의 권한 게이트도 이때 함께 좁아진다**(카테고리 관리자 전체 → 직속 L5 관리자·sysadmin — 상위 관리자는 요청 경로만). `MapOut.can_confirm` 트랜지언트 신설(FE 버튼/CTA 분기 소스).
- **노출**: ① 에디터 승인 탭 framework 박스에 pending 요청 카드(기존 PendingApprovalsPanel 디자인 준용) ② 설정 > 승인큐(ApprovalQueue)에 kind 행 추가 ③ 알림 3종 신설 — `fw_confirm_requested`(L5 관리자+sysadmin), `fw_confirm_done`/`fw_confirm_rejected`(요청자). 신규 알림 타입은 4곳 동시 갱신(payload 구조화·KNOWN_TYPES·i18n·아이콘) — 알림 리치 렌더 규약.
- 확정이 요청 없이 직접 이뤄지면 pending 요청은 `superseded` 처리.
- 요청 생성 시 요청자의 draft 점유는 자동 해제된다(요청=편집권 이양 — sticky 점유와 decide 확정의 교착 방지, 2026-09-02 최종 리뷰 결정).
- 요청자는 pending 요청을 철회할 수 있다(`DELETE /maps/{id}/fw-confirm-requests/pending` — rename 철회 선례 준용, 트랙 C). 철회해도 점유는 자동 반환하지 않는다(재체크아웃으로 복귀 — sticky 규약 일관, 2026-09-02 결정).

## 6. 옆문 봉쇄

`versions.py`에 framework 가드가 0건 — API와 설정 페이지 UI 모두 열려 있음(2026-09-02 전수 조사). 공통 가드 `_reject_framework(map)` (422 `framework maps use the confirm workflow`):

**BE 차단(11):**

| 엔드포인트 | 근거 |
|---|---|
| `POST /maps/{id}/versions` (create) | 확정 1회 후 뚫림 → 빈 draft 생성, 이후 확정이 빈 draft 복제(실파손 경로) |
| `POST /versions/{id}/submit·approve·reject·publish·republish` | 게시 옆문 — publish 시 기존 확정 스냅샷 전량 expired 파손 |
| `POST /versions/{id}/withdraw` | 방어적 차단(진입 자체가 불가하므로) |
| `PATCH /versions/{id}` (개명) | `v1.0` 라벨 파손 → fw 파싱(`^v(\d+)\.(\d+)$`) 붕괴 |
| `PUT /maps/{id}/approvers` | 게이트가 `created_by` 기준이라 캔버스 생성 권한자가 승인자를 심어 draft를 pending으로 잠글 수 있음 |
| `POST/PATCH/DELETE /maps/{id}/permissions` (협업자) | 현재 조용히 무효(판정이 무시) — 명시 422로 전환 |
| `POST /maps/{id}/rename-requests` | 캔버스 이름은 카테고리 동기 자동명 — 개명 무의미 |
| `POST /maps/{id}/sp-designation-requests` | 실제 지정이 422라 영구 pending 좀비 생성 중 |

**유지(정상 경로):** 체크아웃 계열 전부(획득/해제/이전/요청 — 캔버스 편집·확정의 기반), 가시성 변경(owner=sysadmin 전용, framework에서 private 전환은 유효한 접근 제어), 소프트삭제/복원(owner 전용).

**FE:** ① 맵 설정 페이지(`maps/[mapId]/settings/page.tsx`)에 framework 분기 신설 — 게시 패널·승인자·협업자·SP 지정 패널 숨기고 확정 이력 + 관리자 안내로 대체 ② 에디터 "새 버전 +"(page.tsx:10732)·republish(:10819) 버튼 framework 가드 ③ SP 지정 카드(:11145) framework 숨김.

## 7. 레벨 권한 — 행 위치가 곧 역할

`category_permissions` 스키마 불변. **행이 붙은 카테고리의 레벨이 관리자 레벨**. 판정 진입점 `access.py:64-97 is_category_admin`을 레벨 인지형으로 확장:

| 기능 | sysadmin | L1~L4 관리자 (자기 서브트리) | L5 관리자 (자기 카테고리) |
|---|---|---|---|
| 카테고리 구조(생성·개명·이동·삭제) | 전체 | ✓ 서브트리 내부(자기 노드 자체의 이동/삭제는 상위 소관) | ✗ |
| 하위 관리자 임명(`PUT permissions`) | 전체 | ✓ 서브트리의 자기보다 하위 레벨 카테고리 | ✗ |
| 캔버스 편집(graph PUT, 보강) | 전체 | ✓ 서브트리 내 전 캔버스 | ✓ 자기 캔버스 |
| 캔버스 생성(linkage-map) | 전체 | ✓ | ✓ |
| **확정(framework-confirm)** | ✓ (대체자) | ✗ → 확정 요청(§5) | ✓ (점유 조건 하) |
| 인터뷰 임포트 | 전체 | ✗ (현행 유지) | ✗ |

- 판정 반환을 bool → `{is_admin, admin_level, direct_l5}` 형으로 확장, 소비 4곳(`get_effective_role`·`can_edit_linkage`·`framework-confirm`·`linkage-map`) + 신규 카테고리 CRUD·permissions 게이트에 일괄 적용.
- `can_edit_linkage`는 현행 의미 유지(편집 가능 여부). 확정 가능 여부는 별도 트랜지언트 `can_confirm`으로 분리해 FE 버튼 분기.

## 8. 관리 화면

### 8.1 현황판 (신규)

- **API**: `GET /api/categories/framework-overview?root_id=` — L5 단위 행: `{category_id, path, linkage_map_id?, latest_fw: "v2.1"?, confirmed_at?, gate: {missing, placeholder, stale, unpublished_l6, noexit_cycle, plain_fanout}, ready: bool}`. sysadmin은 전사, 관리자는 자기 서브트리 루트만 허용(그 외 403). 집계는 `_category_metrics`(categories.py:587) 선례의 배치 쿼리 + 게이트 검사기(§4) 재사용 — 그래프 검사 2종은 저장된 draft 그래프 기준.
- **UI**: 설정 > Framework에 뷰 전환(관리 트리 ↔ 현황) — 현황은 L5 행 테이블(경로·최신 확정·게이트 6종 상태 필·바로가기). 미충족 필 클릭 시 해당 캔버스 이동.
- 미충족 필 클릭 이동·(§8.3) 카운트 클릭 트리 포커스는 후속으로 강등(2026-09-02 최종 리뷰 — Open 링크가 이동을 대체).

### 8.2 관리자 접근 확장

- 설정 > Framework 탭 접근을 sysadmin → **sysadmin + 카테고리 관리자**로 확장(`settings/page.tsx` Access에 카테고리 관리자 판정 추가). 관리자에겐 자기 서브트리만 렌더, CRUD/임명 버튼은 §7 규칙대로 활성.
- `CategoryPermsModal`은 레벨 라벨(예: "L3 admins") + 하향 상속 안내 문구 보강.

### 8.3 홈 Framework 뷰 — 레벨 요약 카드 (설계 마지막 단계)

홈 맵탭 Framework 뷰에서 **카테고리(레벨) 행 클릭 시 우측 상세 자리(`map-detail-aside`)에 해당 레벨의 요약 카드**를 노출한다(현재는 맵 선택 시 `MapDetailCard`, 미선택 시 `HomeDashboard`만 존재).

- **인터랙션**: 카테고리 행 클릭 = 기존 펼침/캐스케이드 유지 + 동시에 요약 선택(행 하이라이트). 맵 선택과 카테고리 선택은 상호 배타(마지막 클릭 우선). 빈 공간 클릭 = 선택 해제 → HomeDashboard 복귀.
- **신규 컴포넌트** `CategorySummaryCard` (aside 분기: 맵 선택 → MapDetailCard, 카테고리 선택 → CategorySummaryCard, 없음 → HomeDashboard):
  - **공통(전 레벨)**: 체인 경로 + 레벨 배지, 이름, 관리자 필 목록(§7의 레벨 관리자 — 로그인 사용자 전체에게 노출, 담당자 파악 목적·인원 카드 재사용), 집계(직속 하위 카테고리 수 · 서브트리 L5 수 · 소속 L6 맵 수 — `_category_metrics` 선례).
  - **L5 전용**: 연계 캔버스 상태 — 캔버스 유무/열기 버튼(기존 Linkage 버튼 로직 재사용), 최신 확정 vX.Y·확정일·확정자, **게이트 6종 충족 필**(§8.1 overview 데이터), 미배치·플레이스홀더 수.
  - **L1~L4 전용**: 서브트리 L5 확정 현황 요약 — 확정 완료 / 게이트 미충족 / 캔버스 없음 카운트(§8.1 overview 집계 재사용), 클릭 시 해당 L5로 트리 포커스.
- **데이터**: `GET /api/categories/{id}/summary` 신설(로그인 전체) — 체인·집계·관리자 목록·(L5면) 게이트 상태를 한 번에. 내부적으로 §8.1 overview 검사기와 `_category_metrics`를 재사용. 기존 `GET /categories/{id}/permissions`(sysadmin 전용)는 그대로 두고, 요약용 관리자 노출은 이 엔드포인트가 담당.

## 9. 파급·알려진 한계

- 확정 스냅샷이 published가 아니게 되므로 **KB 인덱싱·대시보드 "published" 집계·홈 "게시됨" 필에서 자연 제외**된다(의도). subprocess-usage(Linked from)의 캔버스 부모 집계는 폴백 경로로 동작 유지.
- 기존 캔버스 중 게이트 위반 상태(임포트 산물 팬아웃 등)는 **다음 확정 시점부터 차단** — 소급 강제 없음. 현황판이 위반을 가시화한다.
- 확정 요청은 버전 승인(`version_approvals`)과 별개 트랙 — 승인자 지정 개념을 framework에 도입하지 않는다.
- L5 새벽 조감도 브랜드 워터마크(dev 브랜치)는 버전 상태와 무관 — 본 스펙 범위 밖.
- 확정 스냅샷이 published가 아니게 되면서 copy_map의 "게시 이력 필수" 게이트를 framework 캔버스가 더는 충족할 수 없다 — 캔버스는 영구 복사 불가(§6 봉쇄 취지에 부합하는 의도된 결과로 확정).
- 카테고리 요약(GET summary)은 로그인 전체 공개(관리자 노출 포함 — 담당자 파악 목적 §8.3 의도)라 현황판의 관리자 게이트는 관리 표면 구분이지 정보 은닉이 아니다.

## 10. 테스트 계획

- **BE**: confirmed 전이·데이터 이전 멱등·게이트 6종 각각의 422 페이로드·점유 규약(자동 획득/타인 점유 409)·옆문 11종 422·요청 워크플로(요청→확정/반려/superseded·중복 409)·레벨 권한 매트릭스(구조 CRUD·임명 위임·확정 가부)·현황판 스코프 403. 전체 스위트 그린(`AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""`).
- **FE**: VersionStatus 열거 스윕 tsc 검증·확정 체크리스트 분기 vitest·요청 CTA 분기.
- **실브라우저**: `pw-smoke-framework-canvas.mjs` 확장 — 게이트 위반 캔버스에서 버튼 비활성+체크리스트 → 위반 해소 → 확정 → confirmed 워터마크/칩 확인 → 상위 관리자 요청 → L5 관리자 수락 흐름.

## 11. 구현 앵커 (2026-09-02 조사 실측)

| 지점 | 위치 |
|---|---|
| status 상수·EDITABLE | `backend/app/workflow.py:18-27` |
| framework-confirm·시그니처 게이트 | `backend/app/routers/maps.py:1155-1295` |
| 버전 라이프사이클(옆문) | `backend/app/routers/versions.py:165-1037` (create :165, submit :563, publish :819, delete 차단 :408, rename :264) |
| 승인자 지정 게이트 | `backend/app/routers/approvers.py:34-79` |
| 권한 판정(framework 분기·카테고리 관리자) | `backend/app/permissions/access.py:56-124` |
| linkage-map 멱등 열기·보강 | `backend/app/routers/categories.py:904-1002` |
| 카테고리 CRUD 게이트 | `categories.py:614(POST)·668(PATCH)·790(DELETE)·1003-1030(perms)` |
| 서브트리 집계 선례 | `categories.py:587-613 _category_metrics` |
| ApprovalRequest(kind 확장) | `backend/app/models.py:696-717` |
| 확정 섹션(체크리스트 도입점) | `frontend/src/components/framework-confirm-section.tsx:46-232` |
| 버전 타임라인 칩 | `frontend/src/components/maps/version-timeline.tsx:37-63, 237, 399-407` |
| 캔버스 워터마크 | `frontend/src/app/maps/[mapId]/page.tsx:9471-9487` |
| 읽기전용 배너 | `page.tsx:1325-1367` |
| 맵 설정 페이지(fw 분기 없음) | `frontend/src/app/maps/[mapId]/settings/page.tsx` |
| FE 상태 열거 원천 | `frontend/src/lib/api.ts:5-11`, `lib/version-status.ts:6-23` |
| 설정 탭 접근 레벨 | `frontend/src/app/settings/page.tsx:52-88, 167-168` |
| Framework 관리 패널·권한자 모달 | `frontend/src/components/admin/framework-panel.tsx:341-375, 982-1147` |
| 알림 리치 렌더 규약 | payload 구조화·KNOWN_TYPES·i18n·아이콘 4곳 동시(메모리: notification-rich-render) |

## 12. 구현 트랙 분해 (순차 3)

1. **트랙 A — 상태 분리·옆문 봉쇄**: §3 confirmed 전환+데이터 이전+동반 수정, §6 BE/FE 봉쇄, §3.2 시각 교체. (기반 정리 — 이후 트랙의 전제)
2. **트랙 B — 확정 게이트·요청 워크플로**: §4 게이트 6종+점유+체크리스트 UX, §5 확정 요청(엔티티·알림·승인탭).
3. **트랙 C — 레벨 권한·관리 화면**: §7 판정 확장+위임 게이트, §8.1~8.2 현황판 API/UI+접근 확장, 마지막으로 §8.3 홈 레벨 요약 카드(overview 검사기·집계가 전제라 최후순).

각 트랙은 독립 머지 가능 단위이며, 트랙별 구현 플랜은 착수 시 `writing-plans`로 작성한다.
