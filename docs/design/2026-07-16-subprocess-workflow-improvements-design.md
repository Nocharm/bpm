# 서브프로세스 워크플로 2건 개선 — 설계

- 날짜: 2026-07-16
- 브랜치: `worktree-workflow-improvements`
- 범위: 서브프로세스(하위프로세스/Call Activity) 관련 UX 2건. 백엔드 스키마 기본값 1건 외 API·DB 구조 변경 없음.

## 배경 / 목표

1. **생성 시 최신본 추종 기본 ON** — 서브프로세스를 새로 만들면 `follow_latest`(링크 맵의 최신 발행본 자동 추종)가 켜진 채 생성되게 한다. 현재 라이브러리 드롭 생성 경로가 꺼진(`false`) 채 만들어져, 사용자가 매번 인스펙터에서 켜야 한다.
2. **승인 탭에 "서브프로세스 지정" UI 추가** — 게시된 버전을 보는 승인 탭에서도 이 맵을 하위프로세스로 지정/수정/해제할 수 있게, 기존 지정 카드를 승인 탭에 노출한다.

## 용어 정리 — 두 개의 "서브프로세스"

- **노드 링크(Call Activity)** — `Node.linked_map_id` / `linked_version_id` / `follow_latest`. 이 맵 그래프 안의 노드가 다른 맵을 참조. 버전별로 저장(clone 대상), draft/rejected에서만 편집. **요구사항 1이 다루는 대상.**
- **맵 단위 지정(SubprocessDesignation)** — `ProcessMap.sp_*`. 이 맵 자체를 "하위프로세스로 지정"해 다른 맵의 라이브러리 피커에 노출. 맵 전역(버전 무관, clone 안 됨), 게시본 존재 필수, 오너/sysadmin 전용. **요구사항 2가 다루는 대상.**

두 개념은 이름이 비슷하나 별개다. 요구사항 1 = 노드 링크 속성, 요구사항 2 = 맵 단위 지정.

---

## Part 1 — `follow_latest` 기본값 ON (모든 생성 경로)

### 의미
- `follow_latest = true` → 렌더 시 링크 맵의 최신 발행본을 해석(`backend/app/subprocess.py:33 resolve_linked_version`).
- `follow_latest = false` → `linked_version_id`로 고정.

### 변경 지점 (`false` → `true`)

| # | 파일:라인 | 경로 | 현재값 |
|---|---|---|---|
| 1 | `frontend/src/app/maps/[mapId]/page.tsx:3701` `handleLibraryDrop` | 라이브러리 드롭 생성(사용자 보고 지점) | `followLatest: false` |
| 2 | `frontend/src/app/maps/[mapId]/page.tsx:613` `aiNodeToGraphNode` | AI 변환 | `follow_latest: false` |
| 3 | `frontend/src/lib/csv-import.ts:186` `NODE_DEFAULTS` | CSV 임포트 / AI(`buildGraphFromAiProposal` 공용) | `follow_latest: false` |
| 4 | `backend/app/schemas.py:607` `NodeIn` | 백엔드 요청 스키마 기본값 | `follow_latest: bool = False` |
| 5 | `backend/app/models.py:226` `Node.follow_latest` | DB 컬럼 ORM 기본값 | `mapped_column(Boolean, default=False)` |

- `frontend/src/app/maps/[mapId]/page.tsx:3752` `addLinkNodeFromMap`는 **이미 `true`** → 변경 없음(회귀 확인만).

### 명시적으로 건드리지 않는 것 (경계)
- 읽기/직렬화 폴백 `?? false`: `page.tsx:656`, `page.tsx:1192-1193`(직렬화), `page.tsx:7814`(인스펙터 picker 표시).
  - 이유: 이 폴백은 "값이 없을 때의 해석"이다. `true`로 바꾸면 `followLatest`가 undefined인 **기존 노드**를 저장/표시할 때 고정→추종으로 뒤집혀 데이터가 드리프트한다. 이번 변경은 **신규 생성만** ON이 목표이므로 폴백은 `false` 유지.

### 데이터/마이그레이션
- 기존 DB 행은 저장된 값 그대로 유지(마이그레이션 없음). DB 컬럼 기본값(#5) 변경은 DDL이 아니라 ORM 인서트 시 필드가 생략된 경우에만 적용된다.
- 구현 시 확인: `backend/app/db.py`의 `_ADDED_COLUMNS`에 `follow_latest`의 `server_default`가 걸려 있는지(있어도 ORM 경로엔 영향 없음, 기록만).

### 검증 기준
- 신규 서브프로세스 생성(라이브러리 드롭) → 인스펙터 토글이 ON으로 표시(`page.tsx:7814` picker가 `followLatest=true` 읽음).
- CSV export가 `follow_latest` 컬럼을 쓰는지 확인 → 왕복(export→import) 시 명시값 보존되면 기본값 변경이 기존 값에 영향 없음.
- 백엔드 `NodeIn()`을 필드 생략으로 만들면 `follow_latest is True`.
- 기존 픽스처가 old default(`false`)에 의존하면 새 기본값에 맞게 조정. 신규 기본값을 단언하는 테스트 추가(FE: 생성 경로 최소 1개, BE: `NodeIn` 기본값).

---

## Part 2 — 승인 탭에 "서브프로세스 지정" 카드 추가

### 접근
기존 `SubprocessInspectorCard`(`frontend/src/components/subprocess-inspector-card.tsx`)를 승인 탭에 그대로 재사용.

- 이 카드는 자기완결형: 자체 `getMap(mapId)` 조회, `publishedVersionId` 내부 계산, 지정/수정/해제(`SubprocessDesignationModal` + `deleteSubprocessDesignation`) 내장. props 4개(`mapId`, `canManage`, `disabledReason`, `onToast`).
- 이미 Properties 탭(`page.tsx:7930 subprocessSlot`)·Map 탭(`page.tsx:8012 mapTabSlot`)에서 동일 props로 사용 중.
- `InspectorPanel`은 **활성 탭 슬롯만 렌더**(`inspector-panel.tsx:173`) → 동시 다중 마운트 없음. 탭 전환 시 언마운트/재마운트(각 마운트가 자체 `getMap` 1회) — Properties↔Map 전환과 동일한 기존 동작.

### 변경 지점
- `frontend/src/app/maps/[mapId]/page.tsx` `approvalSlot`(8058~8208)의 `<ApprovalPanel/>`(8176-8198) **바로 아래**, 버전 목록 `<MapDetailCard/>`(8199) **위**에 삽입:
  ```tsx
  <SubprocessInspectorCard
    mapId={mapId}
    canManage={spCanManage}
    disabledReason={spDisabledReason}
    onToast={showToast}
  />
  ```
- import는 파일에 이미 존재(다른 슬롯에서 사용 중) → 추가 import 불필요.

### 게이팅 (재사용, 변경 없음)
- `spCanManage = currentVersion?.status === "published" && (isMapOwner || isSysadmin)` (`page.tsx:1009`).
- 비활성 시 사유 노트: 게시본 아님 → `inspector.spNeedPublishedOpen`, 오너 아님 → `inspector.spOwnerOnly`.
- **백엔드 변경 없음**: `PUT/DELETE /maps/{id}/subprocess-designation`(owner/sysadmin, 게시본 필수) 그대로.

### 검증 기준
- 게시된 버전 + 오너/관리자로 승인 탭 진입 → 카드 활성, 지정/수정/해제 동작.
- 게시 아님 또는 비오너 → 카드 비활성 + 사유 노트.
- 승인 패널·버전 목록·기존 Properties/Map 탭 카드에 회귀 없음.

---

## 비목표 (Out of scope)
- 노드 링크(Call Activity)를 게시된 버전에서 편집하는 기능(게시본 그래프 불변 — 하드 블로커).
- 기존 서브프로세스 노드의 `follow_latest` 값 일괄 변경(마이그레이션).
- 승인 워크플로 로직(제출/승인/반려/게시) 변경.

## 게이트
- 백엔드: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest tests/ -q` + `ruff check`.
- 프론트: `npm run lint` + `tsc --noEmit` + `vitest` + `npm run build`.
