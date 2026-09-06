# Framework 슬롯 거버넌스 — L6 슬롯 변경(해제·대체·이동·신규·삭제)의 승인·캔버스 반영·이력 — 설계 스펙

2026-09-06 브레인스토밍 확정본. 전제 스펙: `2026-08-28-framework-l5-linkage-canvas-design.md`(L5 연계 캔버스 정본) · `2026-09-02-framework-l5-publish-governance-design.md`(confirmed·게이트·레벨 관리자·확정 요청). 본 스펙은 그 둘이 다루지 않은 **L6 슬롯의 수명주기**(맵이 L5에 들고 나가고 바뀌는 일)를 정의하고, 2026-09-03 조사에서 실행으로 확인한 결함 4종을 흡수한다.

## 1. 목표

L5 캔버스는 "소속 L6 = `process_maps.category_id == L5`"를 라이브로 판정하는데, 캔버스 노드(`nodes.linked_map_id`)·계보(`retired_to_map_id`)·알림은 슬롯 변경을 따라가지 않아 어긋난다. 이 스펙은 **모든 슬롯 변경을 하나의 승인 가능한 요청으로 통일**하고, 승인(또는 관리자 즉시 적용) 시 **캔버스·계보·이벤트·알림이 한 트랜잭션에서 함께 움직이게** 한다. 초기 임포트로 L5 안에 L6가 채워진 뒤의 **유지보수 단계**가 대상이다.

## 2. 확정 결정 (브레인스토밍 Q&A)

| 항목 | 결정 |
|---|---|
| 요청 모델 | **A안 — 승인 종류 하나(`fw_slot`) + 액션 payload + 다측 승인 맵.** 액션별 종류 5개(B)·승인 없는 즉시 적용(C)은 폐기 |
| 액션 | `assign` · `unassign` · `move` · `replace` · `delete`(후계자 선택 가능). 복사+은퇴는 "복사 즉시 + `delete{successor}` 요청" 조합이라 별도 액션 없음 |
| 승인권자 | 해당 L5의 **직속 관리자 또는 sysadmin**(fw_confirm decide와 같은 기준). `move`는 보내는 L5·받는 L5 **각 1명**, 한 사람이 양쪽 관리자면 한 번의 승인으로 둘 다 충족 |
| 자기결재 | 요청자가 필요한 쪽 전부의 직속 관리자(또는 sysadmin)면 **요청 없이 즉시 적용**. 화면은 안내 모달(영향 요약 + "관리자 권한으로 바로 적용됩니다")을 먼저 띄운다 — 셀프 게시 팝오버와 같은 결 |
| 대체 시 원본(A) | **살려 둔다**(슬롯만 잃음). 은퇴는 `delete` 요청(항목 7) 또는 복사+은퇴(항목 9)로만 |
| 홈 캔버스 반영 | 승인(적용) 시 **자동 재지정** — A를 가리키던 노드가 C를 가리키고 엣지·좌표 유지. "교체하세요" 안내만 두는 안은 폐기(빠짐 보강과 교체가 C를 두 번 붙이는 충돌) |
| 복사+은퇴 | 복사는 즉시, 은퇴는 **해제 / 대체 중 사용자 선택** 후 L5 승인 |
| 대체 진입 범위 | **슬롯을 가진 L6 전부**(바코드 `consultant_code` 유무 무관) — `hasConsultantCode` 게이트 폐기 |
| 알림·이력 | L5 직속·조상 관리자 알림 + `framework_slot_events` 이력 테이블 + 캔버스 "최근 이양" 배지(14일) + 호버 시 시각 3종 |
| 슬롯 보유 자격 | `process_maps.mode == 'normal'`만. 연계 캔버스(`framework`)·Word 맵(`word`)은 슬롯 대상·이양 대상 모두 422 |
| 임포트 | 컨설턴트/인터뷰 임포트는 부트스트랩이라 **승인 없이 그대로**(sysadmin 경로). 단, 미배치 코드로 향하는 연계 엣지는 **플레이스홀더 노드**로 남긴다(§8) |
| 게이트 | `stale_link`에 **해제된 링크(링크 맵 `category_id IS NULL`)** 추가 — 미싱 노드가 남은 채 확정되지 않게 |

## 3. 용어와 현재 모델

| 용어 | 실제 |
|---|---|
| 슬롯 | `process_maps.category_id`(L5 소속, L5 전용) + `process_maps.consultant_code`(임포트 결착 키, UNIQUE) |
| 홈 캔버스 | 슬롯 L5의 `process_categories.linkage_map_id`가 가리키는 `mode='framework'` 맵의 **라이브 draft**(`map_versions.status='draft'`) |
| 소속 노드 | 홈 캔버스 draft의 `nodes(node_type='subprocess', linked_map_id=맵)` — 삭제 불가(graph.py 422) |
| 외부 노드 | 다른 L5의 L6를 가리키는 노드 — `SubprocessRefOut.category_path`가 캔버스 L5와 달라 출처 배지·L5별 색으로 자동 표시 |
| 계보 | `process_maps.retired_to_map_id` — 후계자. 본 스펙부터 **은퇴 여부와 무관하게** "이 맵의 슬롯을 이어받은 맵"을 뜻한다(컬럼명 유지) |

조사(2026-09-03, dev 9ddd2f3e 재확인)에서 실행으로 확인한 결함:

1. `transfer_framework_slot`이 target/source를 같은 flush에 쓰는데 SQLAlchemy가 PK 순으로 UPDATE를 내보내 `target.id < source.id`면 `UNIQUE(process_maps.consultant_code)` 위반으로 500. 기존 테스트는 target을 나중에 만들어 우연히 통과. 운영 PG는 ALTER 추가 컬럼이라 unique 제약이 없어 조용히 통과.
2. `set_map_category`·`transfer_framework_slot`·FE 피커(`listMaps()`) 모두 `mode` 무검사 — 연계 캔버스 맵이 슬롯을 갖는다(200 확인).
3. 이양 후 홈 캔버스: 옛 노드 잔류(엣지 보유, `category_id NULL`이라 소속처럼 렌더, 게이트 미검출), 새 맵은 `missing_l6` → 열면 엣지 없는 노드 append → `l6_unpublished`. 엣지·후계자 미승계.
4. 복사+은퇴: 슬롯 두 값이 휴지통 원본에 남아 L5 목록에서 증발, 복사본은 슬롯·코드 없음(이양 UI도 미노출), 휴지통 원본은 이양 404, 재임포트는 "map is in trash" 에러 → 퍼지 뒤 중복 생성.

## 4. 요청 모델 — `ApprovalRequest.kind = "fw_slot"`

### 4.1 진입점

`POST /api/maps/{map_id}/slot-changes` — body `SlotChangeIn`:

```
action: "assign" | "unassign" | "move" | "replace" | "delete"
to_category_id: int | None      # assign · move
to_map_id: int | None           # replace(이양 대상) · delete(후계자, 선택)
note: str = ""                  # 승인자에게 보이는 사유
dry_run: bool = False
```

응답 `SlotChangeOut`:

```
mode: "applied" | "requested" | "preview"
request_id: int | None
self_apply: bool                 # preview에서: 호출자가 요청 없이 적용 가능한가
sides: list[{category_id, path, approvers: list[login], satisfied_by_caller: bool}]
impact: {home_canvas_nodes: int, other_canvas_nodes: int, referencing_maps: int, edges_kept: int}
```

- `dry_run=true`는 검증(§5 전제)만 수행하고 `preview`를 돌려준다. FE는 이 결과로 **안내 모달**(자기결재) 또는 **요청 모달**(승인자 목록·사유 입력)을 그린다.
- 호출자 자격: 대상 맵(`map_id`)의 **owner**(sysadmin 포함, `require_map_role("owner")`). `replace`·후계자 있는 `delete`는 `to_map_id`의 owner도 겸해야 한다(현행 이양 가드 유지). L5 관리자라도 자기 소유가 아닌 맵의 슬롯 변경을 **시작**할 수는 없다 — 승인만 한다.
- `self_apply`(호출자가 sysadmin이거나 모든 side의 직속 관리자) → 즉시 `apply_slot_change` 후 `applied`. 아니면 `ApprovalRequest(kind="fw_slot", map_id, payload, requested_by)` 생성 후 `requested`.
- 대상 맵에 pending `fw_slot`이 이미 있으면 409("a slot change is already pending"). 대상 맵에 pending `fw_confirm`이 있어도 무관(별개 맵).
- payload:

```
{action, to_category_id, to_map_id, from_category_id, note,
 sides: [category_id, ...],
 approvals: {"<category_id>": {"by": login, "at": iso}}}
```

> **amendment (2026-09-06)**: `impact`(`home_canvas_nodes`/`other_canvas_nodes`/`referencing_maps`)는 **라이브 draft 캔버스만** 세는 미리보기 집계다 — 확정/게시 스냅샷 기준이 아니므로 실제로 사용자가 보게 될(확정·게시된) 화면보다 **과대 계산될 수 있다**(draft에만 있는 노드·참조가 잡힘). FE 배정 모달(§7.2)의 영향 요약은 이 값을 그대로 노출한다.
> **amendment (2026-09-06)**: `build_request_payload`가 요청 생성 시 `payload.approvals`를 호출자가 **이미 직속 관리자인 side**로 미리 채운다(dry-run 프리뷰의 `satisfied_by_caller`가 참인 side). 그래서 대기 배너의 n/m은 생성 시점부터 실제 진행률을 보여주고, 그 side에 대해 요청자 자신도 결정권을 잃지 않는다. 요청자가 **모든** side를 겸하면 애초에 `self_apply`라 요청 자체가 생기지 않는다 — 이 프리셋은 `move`처럼 side가 혼합된 경우를 위한 것.

### 4.2 결정·철회

- `POST /api/approval-requests/{id}/decide` 기존 엔드포인트에 `fw_slot` 분기. 결정권: sysadmin 또는 `sides` 중 하나 이상의 **직속 관리자**(`is_direct_l5_admin`). 승인 시 호출자가 관리자인 side 전부를 `approvals`에 기록하고, 모든 side가 채워지면 `_apply_request` → `apply_slot_change` → `applied`. 아직 남은 side가 있으면 `pending` 유지(`decided_by`는 마지막 결정자). 거절은 한 side만으로 종결(`rejected`).
- 철회 `DELETE /api/maps/{map_id}/slot-changes/pending` — 요청자만, pending만(fw_confirm 철회와 동일 패턴).
- 대기 조회 `GET /api/maps/{map_id}/slot-changes/pending` — owner/L5 체인 관리자/sysadmin. 배정 모달·상세 카드가 "대기 중" 배너와 철회 버튼을 그린다.
- 적용 시 `_apply_request`가 던지는 HTTPException(전제 재검증 실패, 예: 승인 사이 target이 슬롯을 얻음)은 그대로 전파 — decide가 커밋 전이라 pending 유지(map_rename 이름 선점 경합과 같은 패턴).
- 레거시 엔드포인트 `PUT /maps/{id}/category`·`POST /maps/{id}/framework-transfer`는 **어댑터**로 남긴다: 호출자가 self_apply 가능하면 종전처럼 즉시 적용, 아니면 409("slot changes require approval - use slot-changes"). FE는 전부 `slot-changes`로 옮긴다.

> **amendment (2026-09-06, 409 문구 확정)**: 대기 요청 충돌은 `create_slot_change`·레거시 어댑터 두 곳(`PUT /maps/{id}/category`, `POST /maps/{id}/framework-transfer`) **모두** 동일하게 `assert_no_pending_slot_change` → `"a slot change is already pending"`을 던진다 — 어댑터도 이 가드를 공유하도록 갱신됐다(self-apply 자격자가 남의 대기 요청 위에 바로 적용해 그 요청을 stale로 만드는 경합 방지). 어댑터 호출자가 self_apply가 아니면 정확히 `"slot changes require L5 admin approval - use slot-changes"`(위 문구의 "require approval"을 "require L5 admin approval"로 정정). 승인 적용 시점 전제 재검증 실패는 정확히 `"request preconditions changed - withdraw and re-request"`(요청은 pending 유지).

## 5. 액션별 전제와 적용 — `apply_slot_change(session, change, actor)`

한 함수가 전제 검증 → 데이터 변경 → 캔버스 반영 → 계보 → 이벤트 → 알림을 **한 세션 트랜잭션**에서 수행한다. 요청 생성(dry_run 포함)과 승인 적용이 같은 검증을 공유한다.

| action | 전제(422/409) | 데이터 | 홈 캔버스(슬롯 L5의 draft) | 다른 캔버스 |
|---|---|---|---|---|
| `assign` | 맵 `category_id IS NULL` · `mode='normal'` · `to_category_id`가 L5 | `category_id = to` | 소속 노드 없으면 append(격자 하단, `open_linkage_map` 보강과 동일 산식) | — |
| `unassign` | 슬롯 있음 | `category_id = NULL` (`consultant_code` **유지** — 재전달 결착 키) | 노드 **유지**. 링크 맵 `category_id NULL`이라 `unassigned` 상태로 파생 표시, 게이트 `stale_link` 위반 | — |
| `move` | 슬롯 있음 · `to ≠ from` · `to`가 L5 | `category_id = to` | 옛 캔버스 노드 유지 → 외부 L6 표시(자동) | 새 L5 캔버스에 소속 노드 append |
| `replace` | source 슬롯이 L5 · target `mode='normal'` · target `category_id IS NULL AND consultant_code IS NULL` · target ≠ source · target 살아 있음 | ① `source.category_id/consultant_code = NULL` → **flush** → ② target에 두 값 세팅 → ③ `source.retired_to_map_id = target.id` | source를 가리키는 노드의 `linked_map_id = target`(엣지·좌표·폭 유지, `follow_latest` 유지). target 노드가 이미 있으면 source 노드의 엣지를 target 노드로 옮기고(중복 쌍 제거) source 노드 삭제 | 그대로. `retired_to_map_id`로 `stale_link`가 잡고 Replace CTA가 후계자를 추천 |
| `delete` | 슬롯 있음. 후계자 있으면 `replace` 전제도 충족 | `deleted_at = now` + KB 청크 제거(`delete_map`과 동일) · `retired_to_map_id = successor or NULL` · 후계자 있으면 `replace`의 데이터 변경 수행 | 후계자 있으면 `replace`와 동일 재지정. 없으면 노드 유지 — 링크 끊지 않음(휴지통 복구 시 자동 회복), `deleted` 상태로 플레이스홀더 룩 | 그대로(stale) |

공통:

- 슬롯 없는 일반 맵의 삭제는 기존 `DELETE /maps/{id}` 즉시 삭제 그대로. **슬롯 있는 맵**은 `DELETE`가 409("slotted maps are deleted through slot-changes")를 돌려주고 FE가 `delete` 요청 다이얼로그로 분기한다.
- 캔버스 재지정은 홈 캔버스 **라이브 draft만**. confirmed 스냅샷은 이력이라 불변. draft가 타인 체크아웃 중이어도 적용한다 — 승인된 변경이 미뤄지면 이 스펙이 없애려는 표류가 다시 생긴다. 대신 draft에 `VersionEvent("slot_changed", actor)`를 남기고 체크아웃 보유자에게 알림을 보낸다.
- `move`·`assign`의 append는 `open_linkage_map`과 같은 규칙(draft 존재 시)으로 즉시 수행한다. 캔버스가 아직 없는 L5면 아무것도 하지 않는다(생성 시 시드가 채움).
- 모든 액션이 `framework_slot_events` 1행(후계자 있는 `replace`/`delete`는 target 관점 1행 추가: action `succeed`)을 기록한다.
- **(amendment 2026-09-06)** 맵이 슬롯을 **받는** 쪽이 되면(`assign`의 대상, `replace`/`delete`의 target) `retired_to_map_id`가 **NULL로 정리**된다 — 옛 superseded/stale 계보를 지워, 되찾은 슬롯이 여전히 "이양됨"으로 잘못 표시되지 않게 한다(§6.2 `superseded` 파생과 연동).
- **(amendment 2026-09-06, 문구 정정)** `replace` 행의 "`follow_latest` 유지"는 오기다 — 실제로는 재지정된 노드의 `linked_version_id`를 지우고 `follow_latest`를 **true로 재설정**한다("pin reset to follow-latest"): 옛 타깃에 걸린 버전 고정은 새 타깃에 무의미하므로 latest 추종으로 되돌린다.
- **(amendment 2026-09-06)** `delete`의 전제는 후계자 유무와 무관하게 `replace`와 **같은 L5 검사**(source 슬롯 카테고리의 `level == 5`, 아니면 409 "framework slot must point to a level-5 category - reassign before transfer")를 공유한다 — 표의 "후계자 있으면 replace 전제도 충족"은 이 L5 검사에도 적용된다. 후계자 없는 delete는 노드를 `deleted` 상태(배너 "Deleted - replace")로 남기고 맵은 소프트삭제(`deleted_at`)되며, 복구(`restore_map`)하면 링크가 그대로 회복된다.

## 6. 데이터

### 6.1 신설 테이블 `framework_slot_events`

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `id` | PK | |
| `map_id` | FK process_maps (CASCADE) | 대상 맵 |
| `action` | String(20) | `assign` `unassign` `move` `replace` `delete` `succeed` |
| `from_category_id` / `to_category_id` | int, nullable | 슬롯 이동 전후 |
| `to_map_id` | int, nullable | `replace`·`delete`의 후계자 / `succeed`의 원본 |
| `actor` | String(100) | 적용자(자기결재면 요청자, 승인이면 마지막 결정자) |
| `request_id` | FK approval_requests (SET NULL), nullable | 승인 경로였으면 요청 |
| `created_at` | tz datetime | KST `clock.now` |

인덱스 `(map_id, created_at)`. 신규 테이블은 startup `create_all`이 만든다(`_ADDED_COLUMNS` 불필요). 기존 컬럼 변경 없음.

### 6.2 `SubprocessRefOut` 확장 (subprocess.py `get_subprocess_refs`)

| 필드 | 소스 | 용도 |
|---|---|---|
| `superseded: bool` | `retired_to_map_id IS NOT NULL AND deleted_at IS NULL` | 살아 있지만 슬롯을 넘긴 맵 — 캔버스에서 stale 룩 + Replace CTA |
| `slot_changed_at` / `slot_changed_action` | 이 맵의 최신 `framework_slot_events` | 호버 패널 "해제된 날"(unassign) 등 |
| `succeeded_at` | 이 맵이 `to_map_id`인 최신 `succeed` 이벤트 | "이양된 날" + 최근 이양 배지(14일) |
| `map_updated_at` | `process_maps.updated_at` | "업데이트된 날" |

기존 `deleted`·`category_id`·`category_path`·`successor_map_id/name`은 그대로. 후계자 체인 추적(`retire_heads`)의 출발 조건을 `deleted_at IS NOT NULL`에서 **`retired_to_map_id IS NOT NULL`**로 완화해 살아 있는 superseded 맵도 후계자를 동봉한다.

캔버스 노드 상태는 FE가 파생한다(§7.1): `contained`(category == 캔버스 L5) · `external`(다른 L5) · `unassigned`(category NULL, 살아 있음, superseded 아님) · `superseded` · `deleted` · `placeholder`(linked 없음).

### 6.3 게이트 (`validate_confirm_readiness` · 배치판)

- `stale_link` 판정에 `by_id[mid].category_id IS NULL`(해제된 링크) 추가. 코드·라벨은 기존 `stale_link` 재사용(체크리스트 문구를 "삭제·이양·해제된 링크"로 갱신).
- `missing_l6`는 불변. `replace` 재지정 덕에 이양 직후 `missing_l6`가 뜨지 않는다(회귀 테스트로 고정).

## 7. 표시 (FE)

### 7.1 L5 캔버스 (`maps/[mapId]/page.tsx` · `process-node.tsx`)

- `unassigned`·`superseded`·`deleted`는 플레이스홀더와 같은 **점선 에러 룩**에 하단 배너 문구만 다르게(`framework.slotState.*`: "체계에서 해제됨" · "C로 이양됨" · "삭제됨"). 클릭 시 기존 `openConnectPlaceholder` → 연결 다이얼로그(후계자 추천 카드 고정 노출). `openConnectPlaceholder`의 진입 조건을 `ref.deleted`에서 **`deleted || superseded || unassigned`**로 넓힌다.
- `onBeforeDelete` 소속 잠금은 `contained`만(현행 유지) — 미싱 상태 노드는 지울 수 있다.
- **최근 이양 배지**: `succeeded_at`이 14일 이내인 `contained` 노드에 작은 필 "최근 이양"(accent 틴트). 상수 `RECENT_HANDOVER_DAYS = 14`(FE 단일 소스).
- **기타 정보 플로팅 패널**: subprocess 노드 호버 시 캔버스 **좌하단**에 작은 카드 — 맵 이름 · 이양된 날(`succeeded_at`) · 업데이트된 날(`map_updated_at`) · 해제/삭제된 날(`slot_changed_at` + action). 값 없는 행은 숨김. framework 캔버스 한정, `formatKstShort`. 기존 좌하단 컨트롤과 겹치지 않게 그 위에 띄운다(`data-id="l5-node-info-panel"`).

### 7.2 배정 모달 (`framework-assign-modal.tsx`)

- 연결·해제·L5 변경·대체 버튼이 모두 `slot-changes dry_run`을 먼저 호출한다. `self_apply`면 **안내 모달**(영향 요약 + "관리자 권한으로 바로 적용됩니다" + 확인/취소), 아니면 **요청 모달**(side별 승인자 필 목록 + 사유 입력 + "승인 요청" 버튼). 기존 파급효과 게이트(`framework-slot-gate`)는 이 모달의 영향 목록으로 흡수한다.
- 대체 섹션은 슬롯이 있으면 항상 노출(`hasConsultantCode` prop 제거). 대상 피커는 `mode === "normal"`·자기 제외·슬롯/코드 없는 맵만.
- 대기 요청이 있으면 상단 배너("○○ 승인 대기 중 · 철회")로 대체하고 버튼을 비활성화.
- 레거시 `putMapCategory`·`postFrameworkTransfer` FE 함수는 제거하고 `postSlotChange`·`getPendingSlotChange`·`withdrawSlotChange`로 대체.

### 7.3 삭제·복사

- 상세 카드 삭제(`map-detail-card.tsx` `confirmDelete`): 슬롯 있는 맵이면 확인 다이얼로그 대신 **삭제 요청 다이얼로그**(후계자 선택 optional, 영향 요약, 사유) → `slot-changes{action: delete}`.
- 복사 모달 은퇴 섹션(`create-map-dialog.tsx` `retireSource`): 원본에 슬롯이 있으면 라디오 "슬롯 해제" / "복사본이 슬롯 승계" 추가. 복사 성공 후 `slot-changes{action: delete, to_map_id: 복사본 or null}` 호출 → 자기결재면 즉시, 아니면 요청 생성 후 토스트 "L5 관리자 승인 대기". `POST /copy`의 `retire_source`는 **슬롯 없는 원본에서만** 종전대로 즉시 은퇴하고, 슬롯 있는 원본이면 409(FE가 위 흐름으로 분기).

### 7.4 승인·알림 표면

- `approval-queue.tsx` `QueueRequestKind`와 `pending-approvals-panel.tsx` 종류 목록에 `fw_slot` 추가. 행 문구는 액션별(`perm.fwSlot.action.*`): "○○를 체계에서 해제" · "○○ → L5 경로 이동" · "○○의 슬롯을 △△로 대체" · "○○ 삭제(후계자 △△)". side가 둘이면 "승인 2/2 필요 · 1/2 완료" 진행 표시. 승인 버튼은 호출자가 관리자인 side가 남아 있을 때만 활성.
- 알림 유형 3종 `fw_slot_requested`(승인자에게) · `fw_slot_applied`(L5 직속·조상 관리자 + 대상 맵 owner + 후계자 owner + 캔버스 체크아웃 보유자, 행위자 제외) · `fw_slot_rejected`(요청자). `notification-format.ts` `KNOWN_TYPES`·i18n·아이콘·payload 구조화 4지점 동시 갱신(리치 렌더 규약).

> **amendment (2026-09-06)**: 결정권 판정(`can_decide_slot_for_map`, `app/framework_slots.py`)은 **sysadmin** → 대기 중인 `fw_slot` 요청이 있으면 그 요청의 **잔여 side의 직속 L5 관리자**(이미 결정한 side의 관리자는 재결정권 없음) → 대기 요청이 없으면 **맵의 현재 소속 카테고리 직속 관리자**로 폴백, 순서로 결정된다. 같은 규칙이 `GET /maps/{id}`의 `MapDetailOut.can_decide_slot` 필드(승인 버튼 노출)와 그 맵의 `fw_slot` 승인 요청 **목록 열람**(`permissions.list_approval_requests`) 게이트를 함께 정한다 — 결정권 없는 관리자에게는 그 맵의 fw_slot 요청 자체가 목록에 보이지 않는다.

## 8. 임포트 플레이스홀더 (항목 8)

현재 `import_consultant.py` 연계 임포트는 `placed_codes`(이번 전달에 실제 맵이 있는 코드)만 배치하고 미배치 코드로 향하는 엣지를 **버린다**. 인터뷰 단계에서 타 L5의 L6가 확정되지 않는 현상은 이미 플레이스홀더 개념(`nodes.placeholder_category_id`, 점선 에러 룩, 후차 연결 다이얼로그)으로 FE에 구현돼 있으므로 임포터가 그 노드를 만들면 된다.

- 엣지 끝점 코드가 `map_ids`에 없으면 `Node(node_type='subprocess', linked_map_id=NULL, title=<코드의 이름 또는 코드>, placeholder_category_id=<그 코드의 L5 id, 알 수 있으면>, source_node_id=make_node_id(l5code, 코드))`를 생성하고 엣지를 유지한다.
- 재전달에서 그 코드의 맵이 생기면 `source_node_id`로 플레이스홀더를 찾아 `linked_map_id`를 채운다(`placeholder_category_id`는 출처로 보존).
- **확인 결과(2026-09-06)**: 산출물에 외부 task 이름·L5 없음 → 제목=코드, `placeholder_category_id` NULL. 계약 확장은 인터뷰 트랙 백로그.

> **amendment (2026-09-06, 구현 확정)**: 플레이스홀더 계보 키는 스케치대로의 `make_node_id(l5code, 코드)`가 아니라 **`make_node_id("__ext__", 코드)`**(= `external_lineage_key`, 신설 `app/lineage.py`)로 확정됐다 — 캔버스 L5와 무관하게 코드만으로 정해져야 재전달 해소가 그 코드를 참조하는 **모든** 캔버스를 한 번에 찾는다. `resolve_external_placeholders`(`scripts/import_consultant.py`)는 **pass 1 직후**(pass 2 전) 실행되고 **라이브 draft 캔버스만** 대상이며(confirmed 스냅샷 불변), `deleted_at IS NULL`인 행만 후보로 삼아 **휴지통 맵으로는 연결하지 않는다**(같은 코드로 라이브 행이 여럿이면 슬롯을 쥔 행을 우선). 맵이 슬롯 변경(`assign`/`move`)으로 그 L5에 들어올 때도(§5 `_append_contained_node`) 새 노드를 얹기 전에 같은 계보 키의 플레이스홀더가 있으면 **그 자리를 채운다**(엣지·좌표 보존, 중복 노드 방지). 아직 어느 쪽 맵도 없는 "반쯤 알려진" 엣지(코드는 알지만 이번 전달에 실 맵이 없는 target)는 버리지 않고 `external` 플레이스홀더로 유지된다.

## 9. 옆문·가드

- `mode != 'normal'`인 맵은 슬롯 대상·이양 대상·후계자 모두 422 — `apply_slot_change` 전제와 레거시 어댑터 양쪽.
- `PUT /maps/{id}/category`·`POST /framework-transfer` 어댑터: self_apply 아니면 409. 테스트 `test_categories_api.py`는 새 엔드포인트 기준으로 재작성.
- 휴지통 맵(`deleted_at`)은 요청 대상·후계자 불가(404 유지). 복구(`restore_map`)는 슬롯을 그대로 되살린다(변경 없음).
- 임포트 경로(`import_delivery`)는 승인을 거치지 않는다(부트스트랩). 이벤트도 기록하지 않는다 — 이력은 "유지보수 단계 변경"만 담는다.
- 카테고리 삭제 가드(서브트리에 연결 맵이 있으면 409)는 불변.

## 10. 파급·알려진 한계

- 다른 L5 캔버스에 외부 노드로 놓인 A는 자동 재지정하지 않는다(그 캔버스 관리자의 결정) — stale + 후계자 추천으로 처리. 일반 맵 안의 SP 노드가 A를 가리키는 경우도 동일하며, 일반 맵엔 stale 배너 조건 확장을 적용하지 않는다(A는 여전히 유효한 하위 프로세스).
- 대기 요청 중 원본·대상 맵의 상태가 바뀌면(예: target이 다른 슬롯을 얻음) 승인 시점 전제 검증에서 409로 멈추고 요청은 pending에 남는다. 승인자가 거절하거나 요청자가 철회해야 한다.
- `retired_to_map_id`의 뜻이 "은퇴"에서 "후계자"로 넓어진다. 소비처(`refs` 후계자 체인, `stale_link`)는 이미 "값 존재"만 보므로 동작 변화는 §6.2 완화 하나뿐.
- 홈 캔버스 재지정은 타인 체크아웃 중에도 수행한다(§5 공통). 편집 중인 사람은 알림과 `VersionEvent`로 알게 된다.

## 11. 테스트 계획

- **BE(pytest)**: 액션 5종 × {자기결재 즉시 적용, 요청 생성→승인→적용, 거절, 철회}; `move` 양측 승인(한 명이 양쪽 관리자면 1회 승인으로 적용, 한쪽만 승인 시 pending); 결함 4종 회귀(2026-09-03 프로브를 정식 테스트로 승격 — target.id < source.id 이양 200, 캔버스 맵 422, 이양 직후 `missing_l6` 0·엣지 유지·옛 노드 없음, 복사+은퇴 후 슬롯 승계/해제); `stale_link` 해제 링크 검출; `refs` 신규 필드; 슬롯 있는 맵 `DELETE` 409·`copy retire_source` 409; 레거시 어댑터 409; 이벤트 기록·알림 수신자.
- **FE(vitest)**: 노드 상태 파생(`contained/external/unassigned/superseded/deleted/placeholder`), 최근 이양 판정(14일 경계), 모달 분기(self_apply vs 요청), 피커 mode 필터.
- **스모크(Playwright, `frontend/scripts/pw-smoke-framework-slot.mjs`)**: 오너(비관리자)가 대체 요청 → 승인 탭에서 L5 관리자 승인 → 캔버스에서 C 노드가 A 자리에 엣지 유지 + 최근 이양 배지 → 호버 패널 시각 노출 → 해제 요청 승인 후 미싱 룩. 위임 재현은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`.
- **QA 문서(`docs/qa/2026-09-fw-slot-governance-qa.md`)**: ① 기능 체크리스트(액션 5종 × 자기결재/요청 × 결과 상태·게이트·알림) ② 사용자 시나리오(유지보수 10항목을 순서대로 재현하는 대본 — 사전 데이터·계정·기대 화면·확인 포인트). 항목마다 자동 검증(테스트 이름) 또는 수동 검증 표기.

> **amendment (2026-09-06, 결과)**: 위 QA 문서 기준 **기능 체크리스트 26/26**·**사용자 시나리오 S1–S10 전부 검증 완료**(2026-09-06). 회귀 스모크 `pw-smoke-framework{,-canvas}.mjs`·`pw-smoke-copy-purge.mjs`는 dev에서 이미 낡아(2026-09-03 임포트 패널 리팩터로 시드 단계 확인 다이얼로그가 바뀜 등, 이 브랜치 변경과 무관) 별도 정비가 필요 — 해당 표면은 이번 라운드의 수동 verify 스크립트와 `pw-smoke-framework-slot.mjs`로 대체 검증했다(후속 과제로 남김).
- **브라우저 검증은 구현자가 직접 수행**한다(Playwright + 시스템 Chrome 하네스, 필요 시 Claude in Chrome 확장). 스크린샷을 세션에 공유하고 QA 문서의 수동 항목에 결과를 기록한다.

## 12. 구현 앵커 (2026-09-04 dev 9ddd2f3e 실측)

| 지점 | 위치 |
|---|---|
| 이양·카테고리 PUT | `backend/app/routers/maps.py:1323-1414` (`set_map_category`, `transfer_framework_slot`) |
| 복사+은퇴 | `maps.py:351-517` (`retire_source` 427-473) · 삭제 `maps.py:1778` · 복구/퍼지 `:1812/:1839` |
| 확정 요청 선례 | `maps.py:967-1120` (`create_fw_confirm_request`, 대기 조회, 철회) · decide/apply `routers/permissions.py:587-733` · 알림 `:734-816` |
| 캔버스 보강·소속 판정 | `routers/categories.py:1376-1463` (`open_linkage_map`) · `subprocess.py:352` (`find_missing_l6_ids`) · 게이트 `:453-531` · 배치판 `:534-` |
| refs·후계자 체인 | `subprocess.py:131-288` (`get_subprocess_refs`) · 스키마 `schemas.py:1325` (`SubprocessRefOut`) |
| 소속 노드 삭제 금지 | `routers/graph.py:290-317` · FE `page.tsx:9751-9772` (`onBeforeDelete`) |
| 카테고리 관리자 판정 | `permissions/access.py:82-215` (`resolve_category_admin`, `is_category_admin`, `is_direct_l5_admin`, `get_category_admin_logins`, `get_admin_scope`) |
| 임포트 결착·연계 | `backend/scripts/import_consultant.py:754-760`(코드 결착) `:985`(꼬리표 되돌림) `:1240-1310`(연계 배치, `placed_codes`) |
| FE 표시 판정 | `page.tsx:1702-1723` (`spOriginPath`·색) · `:5542-5576` (`openConnectPlaceholder`) · `process-node.tsx:925-941` |
| FE 모달·카드 | `components/maps/framework-assign-modal.tsx` · `maps/map-detail-card.tsx:227,770-780,894-904,1087-1098,1532` · `permissions/create-map-dialog.tsx:440` · `framework-connect-dialog.tsx:33-63` |
| 승인 표면 | `components/admin/approval-queue.tsx:53-57` · `permissions/pending-approvals-panel.tsx:25` · `lib/notification-format.ts:37` (`KNOWN_TYPES`) · `lib/api.ts:2769-2790` |
| 컴포넌트 카탈로그 | `frontend/COMPONENTS.md` — 모달·다이얼로그 사용처 변경 시 `node scripts/build-component-catalog.mjs` 재생성 (`rules/frontend/components.md`) |

## 13. 구현 트랙 분해 (순차 4 + 문서)

| 트랙 | 내용 | 완료 기준 |
|---|---|---|
| **A. 핫픽스** | 결함 ①(flush 순서) · ②(mode 가드 3지점) + 프로브 4종을 정식 회귀 테스트로 승격 | pytest 그린, 프로브 시나리오가 테스트로 고정 |
| **B. 적용 코어·이력·표시** | `framework_slot_events` · `apply_slot_change` · `slot-changes`(sysadmin/관리자 즉시 적용만, 요청 생성은 C) · refs 확장 · `stale_link` 확장 · 캔버스 상태 룩·최근 이양 배지·호버 패널 · 배정 모달을 새 엔드포인트로 | 이양 직후 캔버스 무표류(회귀 테스트), 호버 패널 스크린샷 |
| **C. 승인 워크플로** | `fw_slot` 요청 생성·다측 decide·철회·대기 조회 · 알림 3종 · 승인 큐/대기 패널/알림 포맷/i18n · 배정 모달 요청/안내 분기 · 삭제·복사 분기 · 레거시 어댑터 409 | 스모크 통과(요청→승인→반영) |
| **D. 임포트 플레이스홀더** | 미배치 코드 플레이스홀더 노드 + 재전달 해소 (§8 전제 확인 선행) | 샘플 전달물 재임포트 테스트 |
| **E. 문서** | `docs/spec.md`(슬롯 수명주기 절) · 매뉴얼(사용자: 체계 변경 요청, 관리자: 승인) · PROGRESS · 본 스펙 폐기 정책 적용은 main 머지 후 | 문서 링크 무결 |
