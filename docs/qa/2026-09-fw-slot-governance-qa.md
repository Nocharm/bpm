# Framework 슬롯 거버넌스 QA (2026-09)

설계 `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md`. 자동 항목은 `frontend/scripts/pw-smoke-framework-slot.mjs`·pytest `tests/test_framework_slots.py`가 검사하고, 수동 항목은 구현자가 실브라우저로 확인해 결과 열에 기록한다(사용자 지시 2026-09-06: 기능·시나리오 둘 다, 브라우저 검증 직접 수행).

**환경**: `reset_db` 시드 + backend 8000(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false`) + frontend 3000 네이티브, 시스템 Chrome(playwright-core). 계정: `admin.sys`(sysadmin) · `slot.l5admin`(L5 직속 관리자) · `slot.owner`(L6 owner, 비관리자).

## 1. 기능 체크리스트

| # | 표면 | 항목 | 방식 | 결과 |
|---|---|---|---|---|
| 1 | API | assign/unassign/move/replace/delete 전제(422/409) — 캔버스 맵·비L5·중복 슬롯·자기 자신 | pytest test_core_validation_errors | ✅ pytest 1375 |
| 2 | API | target.id < source.id 이양 200 (결함 ①) | pytest test_transfer_succeeds_when_target_id_is_lower | ✅ |
| 3 | API | 캔버스 맵에 슬롯 부여 422 (결함 ②) | pytest test_slot_endpoints_reject_non_normal_maps | ✅ (+브라우저 S5: 어댑터 422·slot-changes 422 "only normal maps can hold a framework slot") |
| 4 | 캔버스 | replace 후 옛 노드 없음·엣지 유지·missing_l6 없음 (결함 ③) | pytest test_core_replace_repoints_home_canvas_and_keeps_edges | ✅ (+스모크 "old A node is gone") |
| 5 | 캔버스 | target이 이미 있으면 엣지 합치기·중복 쌍 제거 | pytest test_core_replace_merges_when_target_already_on_canvas | ✅ |
| 6 | API | delete: 후계자 있으면 승계, 없으면 노드 유지(stale) | pytest test_core_delete_with_and_without_successor | ✅ |
| 7 | API | dry_run 미리보기(self_apply·sides·impact) → 즉시 적용 | pytest test_slot_changes_preview_and_apply | ✅ |
| 8 | API | 비관리자 owner 요청 생성·중복 409·대기 조회 can_decide·철회 권한 | pytest test_non_admin_owner_creates_request_and_can_withdraw | ✅ (+test_self_apply_admin_blocked_by_others_pending_request: 관리자 즉시 적용도 남의 대기 요청 앞에서 409) |
| 9 | API | move 양측 승인(한쪽만 → pending, 동일인 → 1회 적용) | pytest test_move_needs_both_sides_and_same_person_satisfies_both | ✅ |
| 10 | API | 거절 → rejected+알림, 승인 시 전제 깨짐 → 409·pending 유지 | pytest test_reject_and_stale_apply_keep_state | ✅ |
| 11 | API | 인박스에 fw_slot(관리자만)·sysadmin 큐·can_decide_slot | pytest test_inbox_and_detail_expose_slot_decision_rights | ✅ (+test_can_decide_slot_*: assign 요청·move 부분 승인 뒤 잔여 side 기준, test_list_approval_requests_allows_remaining_side_l5_admin_slot_only) |
| 12 | API | refs superseded·시각 3종·후계자, 해제 링크 stale_link | pytest test_refs_expose_slot_state_and_timestamps / test_unassigned_link_counts_as_stale | ✅ |
| 13 | API | 슬롯 맵 DELETE 409·copy retire_source 409·레거시 어댑터 409 | pytest test_slotted_map_delete_and_copy_retire_are_blocked / test_legacy_adapters_follow_slot_policy | ✅ |
| 14 | FE lib | 슬롯 상태 파생 6종·최근 이양 14일 경계 | vitest framework-slot-state.test | ✅ vitest 864 |
| 15 | 배정 모달 | 관리자: 안내 모달 → 바로 적용 / 비관리자: 요청 모달(승인자·메모) → 요청 토스트 | 스모크 + 수동 | ✅ 비관리자 owner: 메모 필드·"Level-5 admins must approve"·승인자 slot.l5admin·요청 토스트(`a1-request-dialog`, `a1-requested-toast`) · 관리자(slot.l5admin, 맵 owner): 메모 없음·"lands now without a request"·제출 즉시 category 이동+적용 토스트(`a5-admin-notice-dialog`) |
| 16 | 배정 모달 | 대기 배너 + 요청자 철회 버튼, 대기 중 버튼 비활성 | 수동 | ✅ "… waiting for approval (0/1 sides) - requested by slot.owner" + Withdraw, 연결/해제 버튼 disabled, 철회 후 pending null(`a2-pending-banner`, `a3-after-withdraw`); move는 "(1/2 sides)"(`b2-move-banner-1of2`) |
| 17 | 배정 모달 | 대체 섹션 슬롯 보유 L6 전부 노출, 피커에 캔버스·Word 맵 없음 | 수동 | ✅ 연계 캔버스("…연계") 검색 0건, 타 L5 슬롯 보유 맵 0건, 미배치 후계자만 노출(`a4-transfer-picker`). Word 맵은 시드에 없어 미확인 |
| 18 | 승인 | 설정 승인 큐·맵 승인 탭·인박스에 fw_slot 행(액션·대상·n/m) 렌더, 승인/거절 동작 | 스모크(인박스) + 수동 | ✅ 설정 큐(`a6-settings-queue`) · 인박스 행+상세("Framework slot change", Waiting on, Approvers) → Approve → 확인 모달 → applied(`a9-inbox-row`, `a9b-inbox-approve-confirm`) · 에디터 Approval 탭 Pending Approvals에 행+Approve/Reject → Reject 즉시 rejected(`c1-editor-approvals-panel`, `c3-editor-after-reject`). **결함 발견·수정**: L5 관리자가 맵 승인 목록 GET에서 403 → 패널이 "No pending requests"(1ae412f8) |
| 19 | 알림 | fw_slot_requested(관리자)·fw_slot_applied(owner·관리자)·fw_slot_rejected(요청자) 벨 렌더 | 수동 | ✅ API 타입 확인(owner: fw_slot_rejected·fw_slot_applied, l5admin: fw_slot_requested) + 벨 드롭다운(`a8-owner-bell-rejected`, `a10-owner-bell-applied`). 상위(비직속) 관리자 수신은 미확인 |
| 20 | 캔버스 | 후계자 노드 최근 이양 배지 · 호버 좌하단 패널(이양/업데이트/해제 시각) | 스모크 | ✅ 스모크 20/20("Handed over" KST 시각 단언 포함) + `b13-y-canvas-copy-hover`(Handed over/Map updated), `b14-x-canvas-unassigned-hover`(+Unassigned), `c4-x-canvas-deleted-banner`(+Deleted) |
| 21 | 캔버스 | 해제·이양·삭제 노드 미싱 룩 + 배너 클릭 → 교체 다이얼로그(후계자 추천) | 스모크(배너) + 수동(다이얼로그) | ✅ 해제 배너 클릭 → `framework-connect-dialog`(`a11-missing-banner-connect-dialog`). **결함 발견·수정**: 삭제된 링크는 범용 "Replace map" CTA만 떠서 "Deleted - replace" 슬롯 배너로 통일(0727375c, `c4`) |
| 22 | 상세 카드 | 슬롯 맵 삭제 → 후계자 선택 다이얼로그 → 요청/적용 | 수동 | ✅ `slot-delete-dialog`(후계자 피커) → Next → 요청 모달 → 승인 → 404/휴지통, 캔버스 노드 유지+배너, restore 후 배너 소멸(`b7`~`b10`) |
| 23 | 복사 모달 | 슬롯 원본 은퇴 시 해제/승계 라디오 → 복사 후 요청/적용 | 수동 | ✅ 라디오 2종(`b11-copy-retire-radios`) → 복사 201 → `slot-changes{delete,to_map_id=복사본}` 요청·토스트 → Y 관리자 승인 → 원본 404·복사본 슬롯·Y 캔버스 재지정+배지(`b13`). **결함 발견·수정**: 잠긴 원본 이름 그대로 복사 → 409 "map name already exists" → 슬롯 원본은 이름 편집 가능+안내(7d8bd53d) |
| 24 | 게이트 | 확정 체크리스트 stale_link 라벨(삭제·이양·해제) | 수동 | ✅ 연계 캔버스 Approval 탭 "Confirm readiness … No stale links (deleted, handed over or unassigned)" 실패 표시 + API stale_link count 1(`a12-gate-checklist`) |
| 25 | 회귀 | pw-smoke-framework-canvas · pw-smoke-framework-delegation · pw-smoke-copy-purge | 스모크 | ⚠️ 리셋 DB 격리 실행: framework-admin 7/7 ✅ · framework-delegation 18/18 ✅ · **framework / framework-canvas / copy-purge는 dev에서 이미 낡은 스크립트**(시드 단계 확인 다이얼로그는 010e0a91로 보정, 잔여: 홈 트리 행 셀렉터(09-02 요약 카드 이후), 익명 fetch가 draft 열람 룰(92a4d262)에 걸림 + 워터마크 Title case(f2e0fa42), 시드에 없는 하드코딩 부서 "Quality Center/…") — 이 브랜치 변경과 무관, 별도 정비 필요. 해당 표면은 verify 스크립트(S3·S6·S7·S9)와 슬롯 스모크로 대체 검증 |
| 26 | 게이트 | pytest·ruff / tsc·lint·vitest·build 그린 | 명령 | ✅ 최종 트리(010e0a91): pytest 1375 passed · ruff clean · tsc clean · lint clean · vitest 864/864 · `npm run build` 성공 |

## 2. 사용자 시나리오 (유지보수 10항목 재현 대본)

각 시나리오: 사전 데이터 → 조작 → 기대 화면 → 확인 포인트. 계정은 §환경.

| # | 시나리오 | 대본 | 기대 | 결과 |
|---|---|---|---|---|
| S1 | 해제 → 미싱 | owner가 L6 A 상세 카드 → 체계 필 → Unassign → 요청 모달 → 요청. l5admin 인박스 승인 | L5 캔버스 A 노드가 점선 에러 룩 + "체계에서 해제됨 - 교체" 배너, 게이트 stale_link 위반, 호버 패널 "해제된 날" | ✅ 스모크 4단계("Removed from the framework - replace" 배너·stale_link) + `b14`(Unassigned 시각) |
| S2 | 대체 승인 → 반영·알림·최근 이양 | owner가 A 카드 → Transfer slot → C 선택 → 요청. l5admin 승인 | 캔버스 A 자리에 C(엣지 유지), C에 "최근 이양" 배지, l5admin·상위 관리자·owner 벨에 fw_slot_applied | ✅ 스모크(재지정·배지·호버) + 항목 19(owner fw_slot_applied). 상위 관리자 벨은 미확인 |
| S3 | 이동 → 외부 디자인·양측 승인 | owner가 A(L5-X) → L5-Y 선택 → Add to framework(=move) 요청. X 관리자 승인 → 대기 1/2, Y 관리자 승인 → 적용 | X 캔버스 A 노드가 외부 L6 색+출처 배지, Y 캔버스에 A 소속 노드 append | ✅ 요청 모달에 양측(slot.l5admin·slot.yadmin)·sides [7,8] → X 승인 후 remaining [8]·배너 1/2 → Y 승인 → category 8. X 캔버스 노드 유지(외부 L6), Y 캔버스 append(`b1`~`b4`) |
| S4 | 해제 승인자 = L5 관리자 | S1의 요청을 무관 사용자로 결정 시도 | 403, l5admin만 승인 가능 | ✅ 무관 사용자 403 "direct L5 admin of a side or sysadmin only", 요청자 본인도 403 |
| S5 | 캔버스 맵 슬롯 지정 차단 | 이양 피커에서 연계 캔버스 검색 / API로 PUT category | 피커에 없음, API 422 | ✅ 피커 0건, PUT category 422, slot-changes assign 422 |
| S6 | 새 L6 생성 승인 | owner가 새 맵 생성 후 체계 필(유령 필) → L5 선택 → Add to framework | 요청 모달(승인자 표시) → 승인 후 캔버스 append | ✅ 트리 피커로 L5-X 선택 → "Add to the framework" 요청 모달(승인자) → 승인 → X 캔버스 append(`b5`, `b6`) |
| S7 | 삭제 승인 + 플레이스홀더 | owner가 슬롯 맵 삭제 클릭 → 후계자 없음 → 요청 → 승인 | 맵 휴지통행, 캔버스 노드 점선 에러 룩(삭제됨 - 교체), 복구 시 자동 회복 | ✅ 삭제 다이얼로그 → 요청 → 승인 → GET 404, 캔버스 노드 유지 + "Deleted - replace"(0727375c 이후), restore 200 → 배너 소멸(`b7`~`b10`, `c4`) |
| S8 | 임포트 플레이스홀더 | (트랙 D) 미배치 코드 엣지가 있는 인터뷰 JSON 임포트 | 플레이스홀더 노드 + 엣지 유지, 재전달로 해소 | ✅ calibration 샘플에 `smp-cal-task-0003 → smp-util-task-0001`(미전달 utility 과업) 엣지를 추가해 임포트 → 캔버스에 taskId 제목 플레이스홀더 노드 + "Connect a map" CTA + 엣지, 확정 게이트 `placeholder` 위반(`s8-2-canvas-placeholder`) → utility-l5.json 전달 → 같은 노드가 "정제수 일상 점검 수행"으로 해소, 게이트 통과, 엣지 6→7 유지(`s8-3-canvas-resolved`). 비고: 임포트 리포트 요약에 해소 건수가 별도 행으로 드러나진 않음(노트로만) |
| S9 | 복사+은퇴 선택·승인 | owner가 A 복사 모달 → 원본 은퇴 체크 → "복사본이 슬롯 승계" → 생성 | 복사본 생성 즉시, 은퇴+승계는 요청 → 승인 후 A 휴지통·C 슬롯·캔버스 재지정 | ✅ 복사본 "(Copy)" 즉시 생성(201) → delete{to_map_id=복사본} 요청·토스트 → Y 관리자 승인 → 원본 404·복사본 category 8·Y 캔버스 재지정+최근 이양 배지(`b11`~`b13`). 전제: SP 지정 맵은 참조 프로세스 확인 체크 필요, 소속 부서 필수(임포트 맵은 프리필 안 됨) |
| S10 | 호버 시각 3종 | 캔버스에서 S1·S2 노드 호버 | 좌하단 패널에 이양된 날/업데이트된 날/해제된 날 | ✅ "Handed over / Map updated"(`b13`), "+ Unassigned"(`b14`), "+ Deleted"(`c4`) — KST MM-DD HH:mm |

## 3. 검증 기록

### 2026-09-06 — 트랙 C 마감 검증 (feat/fw-slot-handover, 컨트롤러 직접 수행)

- **환경**: 로컬 macOS, `reset_db` 시드 + 인터뷰 샘플 2종 웹 임포트, backend 8000(enforce, sysadmin `admin.sys`), frontend 3000(`npm run dev`), 시스템 Chrome headless(playwright-core 1.62). 계정 `slot.l5admin`(L5-X 직속), `slot.yadmin`(L5-Y 직속), `slot.owner`(비관리자 owner), `slot.stranger`.
- **자동**: pytest 1375 · ruff clean · tsc/lint clean · vitest 864 · `pw-smoke-framework-slot.mjs` 20/20(리셋 DB, 9b0157a7 강화판).
- **수동(임시 Playwright 스크립트 verify-a/b/b2/c, 스크린샷 `scratchpad/verify/*.png`)**: 기능 15~24 전부 ✅, 시나리오 S1~S7·S9·S10 ✅(S8은 트랙 D).
- **발견·수정한 결함 3건**(검증 중 커밋):
  1. `GET /maps/{id}/approval-requests`가 잔여 side L5 관리자에게 403 → 에디터 Approval 탭이 "No pending requests" — `can_decide_slot_for_map` 공용 헬퍼로 슬롯 결정권자에게 fw_slot 행만 열람 허용(1ae412f8).
  2. 삭제된 링크 L6 노드가 슬롯 미싱 배너 대신 범용 "Replace map" CTA — `framework.slotState.deleted` "Deleted - replace"로 통일(0727375c).
  3. 슬롯 원본 복사+은퇴 시 이름이 원본에 잠겨 `POST /copy` 409 "map name already exists" — 슬롯 원본은 이름 편집 가능(기본 "(Copy)")+안내 문구(7d8bd53d).
- **회귀 스모크 정비**: `pw-smoke-framework{,-admin,-canvas,-delegation}.mjs`가 2026-09-03 임포트 패널 리팩터로 사라진 확인 다이얼로그를 기다리다 시드 단계에서 타임아웃(dev에서도 동일) → `waitForResponse` 패턴으로 보정(010e0a91).
- **미확인**: Word 맵의 이양 피커 제외(시드 없음) · 상위(비직속) L5 관리자 벨 수신 · 서버 Postgres(9910) 배포 검증.

### 설정 및 명령어

**bash (macOS/Linux):**
```bash
# reset_db 및 backend 기동 (사용자 터미널 또는 background)
cd backend
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false .venv/bin/python -m scripts.reset_db
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000

# frontend 기동
cd frontend
npm run dev
```

**PowerShell (Windows):**
```powershell
# reset_db 및 backend 기동
cd backend
$env:DEV_ENFORCE_PERMISSIONS="true"
$env:BPM_SYSADMINS="admin.sys"
$env:AI_ENABLED="false"
.venv\Scripts\python -m scripts.reset_db
.venv\Scripts\uvicorn app.main:app --port 8000

# frontend 기동
cd frontend
npm run dev
```

**Smoke 스크립트 실행:**
```bash
# bash (frontend/ 에서 실행)
BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/bpm-slot-smoke node scripts/pw-smoke-framework-slot.mjs
```

```powershell
# PowerShell (frontend\ 에서 실행)
$env:BASE_URL="http://localhost:3000"
$env:SHOT_DIR="C:\tmp\bpm-slot-smoke"
node scripts/pw-smoke-framework-slot.mjs
```

Smoke 스크립트는 18개 체크(owner 이양 요청 → pending 배너 → L5 관리자 인박스 승인 → 캔버스 노드 재지정+엣지 유지 + "recently handed over" 배지 → 호버 정보 패널 → 할당 해제 → "removed from framework" 배너)를 검증한다.

### 제품 식별자 (data-id)

다음 식별자는 테스트 및 UI 검증에 사용된다:

- `slot-change-dialog` — 슬롯 변경 다이얼로그
- `slot-change-note` — 슬롯 변경 노트 입력
- `slot-change-submit` — 슬롯 변경 제출 버튼
- `slot-change-cancel` — 슬롯 변경 취소 버튼
- `slot-change-close` — 슬롯 변경 닫기 버튼
- `slot-pending-banner` — 슬롯 대기 배너
- `slot-withdraw-btn` — 슬롯 철회 버튼
- `slot-delete-dialog` — 슬롯 삭제 다이얼로그
- `slot-delete-next` — 슬롯 삭제 다음 버튼
- `copy-retire-checkbox` — 복사 시 원본 은퇴 체크박스
- `copy-retire-mode-unassign` — 복사+은퇴 해제 모드
- `copy-retire-mode-replace` — 복사+은퇴 대체 모드
- `framework-assign-modal` — 체계 할당 모달
- `framework-assign-btn` — 체계 할당 버튼
- `framework-unassign-btn` — 체계 할당 해제 버튼
- `framework-transfer-open` — 체계 이양 열기
- `framework-transfer-btn` — 체계 이양 버튼
- `map-detail-category` — 맵 상세 카테고리 필드
- `sp-banner-slot-missing` — 서브프로세스 배너 슬롯 미싱
- `node-recent-handover` — 노드 최근 이양 배지
- `l5-node-info-panel` — L5 노드 정보 패널

### 백엔드 규칙 및 제약

다음은 기능 체크리스트와 시나리오 검증 시 확인해야 할 백엔드 규칙이다:

- **Self-apply**: 직접 L5 관리자(맵 소유 L5)가 슬롯을 변경하면 다이얼로그 안내에도 불구하고 즉시 적용된다.
- **Move 양측**: 양 L5 간 이동(move)은 양측 관리자 승인 필요. 한 명이 양쪽 L5를 모두 관리하면 1회 승인으로 완료.
- **Pending 블록**: 특정 맵에 대해 fw_slot 요청이 대기 중이면 다른 슬롯 변경 409 ("a slot change is already pending").
- **Deciders**: 요청 승인자 = 영향받는 L5의 직속 관리자 또는 sysadmin.
- **DELETE 제약**: 슬롯 할당된 맵의 `DELETE /maps/{id}` → 409 (삭제 다이얼로그 경유).
- **Copy retire 제약**: 슬롯 할당된 맵의 `POST /maps/{id}/copy` with `retire_source` → 409 (복사 다이얼로그가 slot-changes로 라우팅).
- **Editor reload**: 구 L5 캔버스 에디터가 슬롯 변경 후 저장 시도 → 422 "canvas changed on the server — reload" 프롬프트.

