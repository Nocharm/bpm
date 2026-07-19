# 서브프로세스 플레이스홀더 — 설계 (2026-07-19)

미등록(SP 미지정) 맵을 다른 맵에서 subprocess 노드로 먼저 링크해 두고, 소유자에게 **등록(지정) 요청**을 보내거나 **새 맵을 즉시 생성**해 연결하는 기능. dev 기준, 브랜치 `worktree-sp-placeholder`.

## 0. 확정 결정 (브레인스토밍)

| 항목 | 결정 |
|------|------|
| 대상 범위 | 기존 미지정 맵 링크 + 미존재 맵 즉시 생성 **둘 다** |
| 플레이스홀더 실체 | **즉시 연결형** — 미지정 맵을 `linked_map_id`로 링크한 subprocess 노드. 링크 없는 자리표시 노드 상태는 만들지 않는다(강등 규칙 유지) |
| 등록 요청 메커니즘 | **ApprovalRequest kind `'sp_designation'` 확장** (map_rename 선례 미러) |
| 새 맵 생성 | **기존 CreateMapDialog 프리필** — 오우닝 부서·결재자 정상 입력, 생성 후 자동 링크. ⚠️ 즉시 지정 모달은 불가(지정은 게시본 필수 — 기존 409 불변식 유지) → 링크는 미지정 경고 상태로 시작, 게시 후 지정 |
| 진입점 | SP 피커(map-name-dropdown) 확장 — **토글로 미지정 맵 검색**(기본 off), 토글 무관 **"Create new map" 버튼은 목록 최하단 고정** |
| 수락 절차 | 오너/sysadmin이 Inbox 수락 → **SP 지정 모달**로 메타 입력 → 저장 시 지정 완료. 카드에 **"Go to published version" 버튼**, 게시본 없으면 안내 문구 |
| 요청 발송 시점 | **링크 시 확인 팝업** — Yes=링크+요청, No=링크만(나중에 인스펙터 CTA로 발송 가능) |

## 1. 데이터 모델 — DDL 없음

- **Node 변경 없음.** 플레이스홀더 = 미지정 맵을 링크한 subprocess 노드. 기존 `SubprocessRefOut.designated=False` → 경고+잠금 렌더를 그대로 사용.
- **ApprovalRequest**: kind에 `'sp_designation'` 추가(String(30) 여유, 코멘트만 갱신). `map_id` = 지정 대상 맵. payload = `{from_map_id, from_map_name}` (요청자가 작업하던 호스트 맵 — Inbox 카드 컨텍스트 표시용).
- `_ADDED_COLUMNS` 등록 불필요 — 운영 배포 시 자동 ALTER 없음.

## 2. 백엔드 API — map_rename 선례 미러

1. `GET /api/library/processes?include_undesignated=true`
   - 기본(파라미터 없음)은 기존과 동일: 지정 맵만. 기존 소비자 무영향.
   - 플래그 켜면 미지정 맵 포함, 각 행에 `designated: bool` 필드 추가(항상 포함).
   - **미지정 맵은 요청 유저 가시성(role ≥ viewer) 필터 필수** — 비공개 맵 이름 유출 방지. 지정 맵은 기존처럼 필터 없음(라이브러리 공개 유지). 휴지통 제외 동일.
2. `POST /api/maps/{map_id}/sp-designation-requests`
   - 이미 지정된 맵 409, 중복 pending 409, 소프트삭제 맵 404.
   - 요청 권한: **대상 맵 viewer 이상**(`require_map_role("viewer")`) — 피커 노출 조건(가시성)과 일치.
   - payload는 서버가 구성: `{from_map_id, from_map_name, map_name}` (from_map_name·map_name은 서버 측 조회로 박제).
   - 대상 맵 오너(owner 롤 협업자, 요청자 제외)에게 알림 `sp_designation_requested`.
3. `GET /api/maps/{map_id}/sp-designation-requests/pending` — 인스펙터 배지·중복 안내용(없으면 null).
4. `DELETE .../pending` — 요청자 본인 철회 → `withdrawn`.
5. **decide는 기존 범용 `POST /api/approval-requests/{id}/decide` 재사용** (rename과 동일) — 게이트 분기에 `sp_designation`을 owner/sysadmin으로 추가.
   - `reject`: rejected + 요청자 알림 `sp_designation_rejected`.
   - `approve`(직접 호출 방어): `_apply_request`에서 맵이 미지정이면 **409로 중단(pending 유지)** — 정상 수락 경로는 아래 6의 PUT 자동 적용.
6. **수락의 실제 경로 = PUT 자동 적용**: `PUT /subprocess-designation`(최초 지정 `was_new`) 시 pending `sp_designation` 요청을 자동 `applied` 처리 + 요청자 알림 `sp_designation_approved` (rename `_supersede_pending_rename` 미러). 따라서 Inbox 수락은 **지정 모달 저장만으로 완결** — 별도 decide 호출 불필요. 오너가 요청과 무관하게 설정에서 직접 지정해도 같은 경로로 자동 해소.
7. 소프트삭제 맵의 pending 요청은 rename과 동일하게 **수동 스윕 없이 3중 가드**로 처리: Inbox 쿼리 `deleted_at IS NULL` 제외 + pending/withdraw 404 + `_apply_request` 멱등 return.
8. Inbox: `sp_designation`은 **오너 게이트 블록 신설**(block 4 미러) + 기존 block 3(approver 게이트)의 `kind != "map_rename"` 필터에 `sp_designation`도 제외 추가(안 하면 승인자에게 잘못 노출).
9. 알림 메시지는 영어 고정(역할/상태 i18n 규칙).

## 3. 프론트 — 피커 확장 (`map-name-dropdown.tsx`)

- 이 컴포넌트가 SP 목록·초성검색·`onAddLinkNode`·`CreateMapDialog` 마운트를 이미 담당 — 확장 지점.
- **토글 "Show unregistered maps"** (기본 off): 켜면 `include_undesignated=true`로 재조회, 미지정 맵은 "Not registered" 배지로 구분 표시.
- **"Create new map" 버튼 — 목록 최하단 고정** (토글 상태 무관, 검색어가 있으면 그 이름 프리필).
- 미지정 맵 선택 → 확인 팝업: "SP 미등록 맵 — 등록 요청을 보낼까요?"
  - Yes = 링크 + `POST sp-designation-requests` (409면 "이미 요청됨" 토스트, 링크는 유지).
  - No = 링크만.
- `CreateMapDialog` 확장: `initialName` prop + `onCreatedMap(mapId, name)` 콜백(지정 시 router.push 생략) → 생성 완료 시 **자동 링크**.
  - ⚠️ 즉시 SP 지정 모달은 **불가** — `PUT /subprocess-designation`이 게시본 필수(409, 기존 불변식 유지). 새 맵 링크는 미지정 경고 상태로 시작하고, 노드 경고 툴팁·인스펙터가 후속(게시→지정)을 안내한다.
- **인스펙터 subprocess 카드**: 미지정 링크에 "Request registration" CTA, pending이면 "Requested" 배지 + 본인 요청 철회 버튼.

## 4. Inbox 수락 카드

- kind `sp_designation` 카드 신설: 요청자·대상 맵·출처 맵(payload.from_map_name) 표시.
- **"Go to published version"** — 게시본 있으면 `/maps/{id}?version={게시본}` 이동, 없으면 버튼 대신 "No published version yet" 안내 + **Accept 비활성**(지정 자체가 게시본 필수라 수락 불가).
- **Accept** → `SubprocessDesignationModal` 마운트(mapId=대상 맵, publishedVersionId, initial=현 메타) → 저장 성공 = PUT이 pending을 자동 applied 처리(§2-6) → 목록 갱신. decide 호출 없음.
- **Reject** → 기존 `decideApprovalRequest(id, "reject")`.

## 5. 엣지 케이스

- 순환 참조: `assert_no_cycle`이 `linked_map_id` 기준 — 미지정 링크에도 자동 적용, 추가 작업 없음.
- 링크 유일성(중복 가드 + grandfather 불변식) 기존 그대로.
- decide 시점에 대상 맵 삭제 → `_apply_request` 멱등 return(변경 없이 applied) — rename 선례 동일.
- 수락이 PUT 자동 적용으로 완결되므로(§2-6) "지정은 됐는데 요청이 pending으로 잔존"하는 중간 상태 없음.
- 미지정 맵을 링크한 새 노드의 경고 배지: 오토세이브 응답/루트 그래프 재조회의 `subprocess_refs`로 채워짐 — 저장 전 일시적으로 배지가 없을 수 있으나 저장 주기(오토세이브)가 짧아 허용.

## 6. 테스트

- **pytest**: 라이브러리 include_undesignated 가시성 필터, 요청 생성/중복 409/이미 지정 409/삭제 404, decide 지정 선행 검증(400), withdraw, 직접 지정 auto-approve, 소프트삭제 supersede, 알림 수신자 검증(map_id 필터 필수 — 선례 함정).
- **vitest**: 피커 토글 필터·미지정 배지 표시 로직 유닛.
- **Playwright**: ① 토글 → 미지정 링크 + 요청 발송 → Inbox 수락 → 지정 모달 저장 → 경고 해제, ② 새 맵 만들기 프리필 → 자동 링크 → 지정 모달 체인.

## 7. 배제한 대안

- **링크 없는 자리표시 노드**(`is_placeholder` 플래그): 강등 규칙 예외 + 열거지점 체크리스트 전수 수정 필요 — 배제.
- **원자적 승인 엔드포인트**(승인 요청에 지정 폼 동봉): `putSubprocessDesignation` 로직 중복 + 지정 모달 재사용 불가 — 배제.
- **수락=빈 지정**(메타 없이 sp_designated_at만 세팅): 빈 메타 SP 양산 — 배제.
