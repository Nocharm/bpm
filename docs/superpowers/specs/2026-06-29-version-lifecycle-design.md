# 버전 라이프사이클 · 승인 탭 재구성 설계

> **상태**: 설계(검토 대기). 승인 후 `writing-plans`로 구현 계획 작성.
> **브랜치**: `feat/version-lifecycle` (← `feat/editor-compare-redesign`, R5 승인 탭 기반).
> **결정 완료**: 새 브랜치 분리 · 스펙 먼저 · 버전 넘버 `v1, v2 …` 순차.

## Goal

게시(publish)를 기준으로 버전에 순차 번호를 부여하고, 게시 시 직전 게시본을 **만료**시켜 라이프사이클을 종료한다. 승인 탭을 버전 라벨 + 축소 pill(번호 포함) + **역할/상태별 아이콘 버튼**으로 재구성하고, 점유권 이전·편집권한 요청·만료본 재게시 플로를 추가한다.

## 비범위 (이번 작업 제외)
- 답글(comment replies) — 별도.
- 마이너 버전(v1.1) — `v1, v2` 순차만.

---

## 1. 데이터 모델 변경 (DB 스키마)

### 1.1 `map_versions` 테이블
| 컬럼 | 변경 | 설명 |
|---|---|---|
| `version_number` | **신규** `int NULL` | **게시 시 부여**되는 맵별 순차 번호(v1, v2…). 미게시(draft/pending/approved/rejected)는 `NULL`. |
| `status` | **값 추가** | 기존 `draft\|pending\|approved\|published\|rejected` → **`expired` 추가**. |

- **버전 번호 채번**: 맵 단위 `MAX(version_number)+1`(없으면 1). 게시 트랜잭션에서 부여, 한 번 부여되면 불변(만료돼도 유지). 재게시(새 드래프트→게시)는 새 번호.
- **표시 강제**: 번호 있으면 `v{n} · {label}`, 없으면 `{label}`(드래프트). 프론트 `formatVersionName(v)` 유틸 1곳에서 처리.

### 1.2 점유권(편집) 요청 — 신규 테이블 `checkout_requests`
편집권한 보유·점유권 미보유 유저가 드래프트 점유를 요청 → 현재 점유자/오너가 승인 → 점유 이전.
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | int PK | |
| `version_id` | FK | 대상 드래프트 버전 |
| `requested_by` | str | 요청자 login_id |
| `status` | str | `pending\|approved\|rejected\|withdrawn` |
| `created_at` | datetime KST | |

> 승인큐(기존 `approval-queue` 인프라) 연동: `pending` 요청을 큐에 노출, 현재 점유자(또는 오너)가 처리.

---

## 2. 라이프사이클 상태 머신

```
draft ─submit→ pending ─approve(전원)→ approved ─publish→ published
  ↑ reject ┘                                          │
  └─────────────── (반려)                              │ 새 버전 publish 시
                                                       ▼
                                              (직전 published) → expired   ← 종료
```

- **변경점**: 현재 publish는 직전 published를 **`approved`로 강등**. → **`expired`로 종료**(다시 승인 단계로 안 감).
- **스테퍼(승인 탭)**: 3단계 `제출 → 검토 → 게시`. `expired`는 3단계 모두 done + 상태 배지 **「만료됨」**(회색/dim) + 게시 노드에 만료 표식.
- **active published는 맵당 1개**(최신). 그 외 published 이력은 expired.

---

## 3. 백엔드 API (신규/변경)

| 엔드포인트 | 종류 | 동작 |
|---|---|---|
| `POST /versions/{id}/publish` | **변경** | 게시 시 ① `version_number` 채번 ② 직전 published → `expired` (approved 강등 폐기). |
| `POST /versions/{id}/checkout/transfer` | **신규** | body `{to: login_id}`. 현재 점유자(또는 오너/sysadmin)만. `to`는 **맵 편집권한자(editor+)**여야 함(서버 검증). 점유 이전. |
| `GET  /maps/{mapId}/editors` | **신규** | 점유권 이전 피커용 — 맵 편집권한(editor/owner) 유저 목록. |
| `POST /versions/{id}/checkout/request` | **신규** | 편집권한 보유·점유 미보유 유저가 점유 요청 생성(`checkout_requests`). |
| `POST /checkout-requests/{id}/decide` | **신규** | 점유자/오너가 승인/거절. 승인 시 점유 이전 + 요청 closed. |
| `POST /versions/{id}/republish` | **신규** | 만료(expired) 버전 기준 **새 드래프트 생성**(그래프 복제) → 승인 플로 진입. 드래프트 없을 때만(맵당 작업 드래프트 1개 규약). |

- 권한: transfer/republish는 편집권한(editor+) 게이트. request는 editor+·미점유.
- `WorkflowState`(GET) 응답에 `version_number`·`checkout_holder`(현재 점유자 login_id)·`pending_checkout_request` 추가.

---

## 4. 프론트 — 승인 탭 재구성

### 4.1 상단 레이아웃
```
[ 버전 라벨(좌) ]              [ pill: v3·To-Be(축소) ]  [ 우측 아이콘들 → ]
```
- **버전 라벨** 추가(좌상단, 예: "Version" 또는 현재 버전 풀네임).
- **버전 pill 축소** + **번호 포함**(`v3 · To-Be`). 클릭 시 버전 전환 드롭다운.
- **기능 버튼 우측 정렬 + 아이콘화**(호버 시 Tooltip 라벨). `Tooltip` 컴포넌트 재사용.

### 4.2 기본 선택 버전
- 기본: **최신 게시본**(published).
- **현재 점유권 보유자**: 자신의 **드래프트**가 기본 선택.

### 4.3 우측 버튼 — 역할/상태 매트릭스
| 사용자 / 선택 버전 | 노출 버튼(아이콘·우측정렬) |
|---|---|
| **점유권 보유** + 드래프트 선택 | ① **점유권 이전**(→모달+피커, 편집권한자 필터) ② **리네임** ③ **버전 삭제** |
| **편집권한 有·점유 無** + 드래프트 선택 | **편집권한 요청** 버튼 + "**{점유자 이름}** 편집 중" 표시 |
| 편집권한 有 + **만료 버전** 선택(드래프트 없음) | **다시 게시하기** 버튼 → 안내 모달 → 확인 시 드래프트 생성 |
| 그 외(viewer 등) | 버튼 없음(읽기) |

- 아이콘(잠정): 이전=`UserRoundCog`/`ArrowLeftRight`, 리네임=`PencilLine`, 삭제=`Trash2`, 요청=`Hand`/`BellPlus`, 재게시=`RotateCcw`/`Upload`.

### 4.4 모달 (맵삭제 모달 `DeleteMapDialog` 디자인 참고)
- **점유권 이전**: 제목 + 아이콘 + 피커(편집권한자, 검색) + 확인/취소.
- **재게시 안내**: 아이콘 + "이 버전 기준으로 드래프트를 생성하고 승인을 다시 진행합니다" + 확인/취소.
- 가시성: 아이콘 + 색(이전=accent, 삭제=error) 고려.

---

## 5. 확정된 결정 (검토 완료 2026-06-29)

1. **점유권 요청 승인자**: 현재 **점유자 + 맵 오너 + sysadmin** 모두 승인 가능.
2. **만료본 표시**: 버전 드롭다운/타임라인에서 만료본도 **선택 가능**(재게시용) — 노출 유지.
3. **버전 라벨(좌상단)**: 현재 선택 버전의 **풀네임**(`v3 · To-Be`). pill은 전환 트리거.
4. **리네임/삭제 범위**: **드래프트만**(점유자). 게시본·만료본은 불변(만료는 재게시 경로).
5. **편집권한 요청 중복**: pending 요청 있으면 버튼 → "요청됨(대기)" **비활성**.

---

## 6. 구현 순서(초안 — 승인 후 writing-plans에서 상세화)
1. 백엔드: `version_number` + `expired` + publish 로직 변경 + 채번 (테스트).
2. 백엔드: checkout transfer + `/maps/{id}/editors` 피커 API.
3. 백엔드: checkout_requests 테이블 + request/decide + 승인큐 연동.
4. 백엔드: republish(드래프트 생성).
5. 프론트: `formatVersionName` + 버전 pill 축소·번호 + 상단 라벨.
6. 프론트: 우측 아이콘 버튼 + 역할/상태 매트릭스 + 기본 선택.
7. 프론트: 모달(이전·재게시) + 편집권한 요청 UI.
8. 검증: 로컬 네이티브 + 권한 시뮬(`DEV_ENFORCE_PERMISSIONS`).
