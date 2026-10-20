# 시스템 전체 리뷰 — 2026-10-19 (시나리오 기반)

> **수정 현황(2026-10-21)**: 아래 "권장 수정 순서" 1~7단계를 dev에서 수정해 main에 머지했다(`efb0d05f` 보안 경계 → `b55b0419` 7d③). 단계별 처리·사용자 결정은 `PROGRESS.md` 2026-10-21 머지 항목, 상세는 각 단계 커밋 메시지. 이 문서는 리뷰 시점 스냅샷이라 본문의 "현재 코드" 서술은 수정 전 기준이다.

- **기준**: `main` @ `cd4a4b4d` (작업 트리 clean)
- **방식**: 사용자 여정 9개를 리뷰어가 병렬로 맡았다. 모두 읽기 전용이었고, 각 단계를 FE → API → BE → DB로 추적한 뒤 실행으로 확인했다.
  - A 작성·저장
  - B 결재·버전
  - C 권한·보안
  - D 내보내기·가져오기
  - E 업무 체계
  - F SP 참조·이중 구현
  - G AI·인터뷰·임포트
  - H 운영·배포
  - W 실브라우저 E2E
- **실행 환경**: 격리 sqlite DB(종합 데모 시드), 일회용 PostgreSQL 16(동시성·운영 전용 문제), 가짜 AI 서버, Playwright + 시스템 Chrome.
- **베이스라인(HEAD)**: 아래 결함은 모두 기존 테스트가 다루지 않는 경로에 있다.
  - BE: pytest 1710 passed · ruff clean(app·tests·scripts)
  - FE: tsc 0 · eslint clean · vitest 1460 passed · 컴포넌트 카탈로그 최신 · `next build` 성공
- **결과(중복 병합 후)**: **P0 3 · P1 14 · P2 59 · P3 10**
  - 판정은 리뷰어의 실행 근거를 따른다. CONFIRMED는 재현, PLAUSIBLE은 코드 경로만 확인한 것이다.
  - "재확인"은 코디네이터가 재현 스크립트를 다시 돌려 같은 출력을 본 항목이다.
- **심각도 기준**
  - P0: 데이터 파괴·오염, 권한 경계를 넘는 본문 노출
  - P1: 핵심 시나리오 실패, 부분 노출·자기 권한 상승, 운영에서만 나는 500
  - P2: 엣지 케이스, 표면 간 불일치
  - P3: 사소한 문제, 문서 드리프트
- **리뷰어 제안에서 조정한 것**
  - F-2: P0 → P1. 메타데이터 노출이라 C-2와 수준을 맞췄다.
  - W-1: P0 → P1. 유실 범위가 마지막 2초 안의 편집으로 한정된다.
  - 병합: C-5 → E-2, A-3 → W-1, C-8 → H-7.

> ⚠️ 보안 항목에는 재현 절차가 들어 있다. 수정을 배포하기 전에는 이 문서의 커밋·공유 범위를 제한하는 편이 안전하다.

## 공통 원인 5가지

1. **소속 검증 누락**: id만 받고 "이 리소스가 이 버전·맵 소속인가"를 확인하지 않는다. → P0-1, P0-2, F-2
2. **읽기 가드가 그래프 GET에만 있음**: 역할 가드와 framework draft 가드가 AI 챗·코멘트·워크플로·SP refs·라이브러리 해석에는 빠져 있다. → C-2, C-4, E-2, F-2, G-9
3. **상태 전이에 행 잠금·유일성 제약이 없음**: 아래가 모두 잠금 없이 "읽고 확인한 뒤 쓰는" 구조다. 운영 postgres에서만 드러나 로컬 sqlite 테스트로는 보이지 않는다. → B-1, B-2, E-7, E-8, E-10
   - 승인 정족수가 집합 판정이 아니라 COUNT다.
   - 버전 생성·게시, 카테고리 이동, 슬롯 승인, 캔버스 생성
4. **임포트 계보·승계**: 활동 seq가 계보 키라, 활동을 끼우거나 빼면 값이 다른 노드로 밀린다. 재전달은 전달물이 싣지 않는 값을 지운다. → P0-3, G-3, G-4, G-11
5. **sqlite가 숨기는 운영 차이**: VARCHAR 길이, timestamptz, FK, 잠금. 로컬 게이트가 녹색이어도 운영에서 500이나 데이터 오류가 난다. → H-2, H-4, H-5, H-6, H-11

---

## P0 (3)

### P0-1 그래프 저장 한 번으로 남의 맵(게시본·비공개 포함) 노드·엣지·코멘트를 파괴 — A-1 [CONFIRMED·재확인]

**위치**
- `backend/app/routers/graph.py:422-424`: 노드 upsert. `session.get(Node, node.id)` 다음에 `existing.version_id = version_id`를 하며, 그 노드가 어느 버전 소속인지 검사하지 않는다.
- `:403-406`: 그룹도 같다.
- 피해를 키우는 곳: `:365-375`의 엣지·코멘트 삭제가 `version_id` 범위 없이 node_id만으로 지운다.

**재현**: 비sysadmin 사용자, `DEV_ENFORCE_PERMISSIONS=true`.
1. 자기 Draft를 점유한 상태로 PUT 본문에 공개 맵 게시본의 node id를 넣는다 → 200.
2. 그 노드가 피해 게시본에서 공격자 Draft로 옮겨진다.
3. 다음 저장에서 그 노드를 빼면 피해 게시본의 엣지 전부와 오너 코멘트가 영구 삭제된다.

추가로 확인한 것:
- 접근할 수 없는 비공개 맵(403)도 node id만 알면 똑같이 된다. id는 C-2(코멘트 IDOR)로 얻을 수 있다.
- 그룹도 같은 방식으로 빼앗긴다.
- 다른 버전의 edge id를 넣으면 처리되지 않은 `IntegrityError` 500이 난다(A-2).

**정상 경로**: `clone_graph`·CSV/AI 머지·붙여넣기·임포트는 id를 새로 발급하므로 우연히 충돌하지 않는다. 순수한 인가 경계 결함이다.

**수정 방향**
- payload의 node·group·edge id마다 "이 버전 소속이거나 미존재"인지 확인하고, 아니면 409/422.
- 삭제 쿼리에 `version_id` 조건을 넣는다.

### P0-2 `GET /library/processes/{map}/resolved?pinned=`로 아무 버전 그래프나 열람(비공개 맵 유출) — C-1 = F-1 [CONFIRMED·재확인]

**위치**
- `backend/app/routers/library.py:199-219`: 권한은 경로의 `map_id`로 판정하고, 실제로는 `pinned`를 로드한다.
- `backend/app/subprocess.py:121-141`: `resolve_linked_version`이 `pinned`를 그대로 반환한다.
- `graph.py:461`: PUT이 `linked_version_id`의 소속을 검증하지 않는다.

**재현**
1. 외부인이 `GET /api/library/processes/{아무 공개·지정 맵}/resolved?pinned={비공개 버전}`를 보낸다 → 200, `locked=false`, 비공개 노드·담당자 전체.
   - 같은 사용자의 직접 `GET /versions/{비공개 버전}/graph`는 403이다.
2. 지속형: 공개 맵의 SP 노드에 비공개 버전 핀을 저장한다(PUT 200). 그러면 그 맵을 여는 모든 직원의 임베드가 비공개 그래프를 받는다.
3. framework draft 가드도 이 경로에서는 우회된다.

**수정 방향**: `MapVersion.map_id == map_id`가 아니면 404 또는 locked. PUT에서 핀 소속을 422로 막는다.

### P0-3 임포트 계보 키가 활동 seq — 재전달·유지(keep)·정정(revise)에서 오너가 넣은 값이 엉뚱한 노드로 옮겨 붙은 새 게시본 — G-1 [CONFIRMED·재확인]

**위치**
- `backend/scripts/consultant_interview.py:330`: `code=f"a{seq:02d}"`가 곧 계보 키다.
- `import_consultant.py:254-278`: `_inherit_prior_fields`가 계보로만 매칭한다.
- `backend/app/framework_interview/existing.py:131-135`: `map_to_row`가 seq를 sort_order 순서로 다시 매긴다.
- `import_consultant.py:1461-1463,1531-1545`: 서명이 다르면 새 게시본을 낸다.

**재현**
- (a) 재전달 중 2번 위치에 활동을 끼운다 → 끼운 활동이 기존 2번의 값(소요시간·역할·GMP·url·비용)을 받고, 이후 활동도 한 칸씩 밀린다. 마지막 활동은 빈 값이 된다.
- (b) 오너가 활동 하나를 지우고 게시한 뒤 캠페인을 keep만으로 등록한다 → 같은 밀림이 생긴다.
- 리포트에는 `('updated','graph')`만 나온다.
- 손대지 않은 샘플 맵은 왕복해도 변경 0이라, 오너가 편집한 맵에서만 터진다.

**수정 방향**
- `map_to_row`가 seq를 계보에서 되살린다.
- 승계 매칭을 "계보 우선, 실패 시 제목"으로 바꾼다.
- keep 행은 콘텐츠를 다시 쓰지 않는다.

---

## P1 (14)

### 권한·노출

**F-2 SP refs가 권한과 무관하게 링크 맵 메타데이터를 노출하고, PUT은 아무 맵 id나 링크 허용(열거 오라클) [CONFIRMED·재확인]**
- **위치**
  - `backend/app/subprocess.py:144-329`: `get_subprocess_refs`가 user 인자를 받지 않는다.
  - `graph.py:52-83,140-177`: `/graph`·`/graph/all` 응답에 refs가 실린다.
  - `graph.py:195-473`: PUT이 링크 대상의 존재·가시성·mode를 검사하지 않는다.
- **재현**: 자기 Draft에 비공개 맵 C·D(직접 GET 403)를 링크해 PUT하면 200이고, 응답 refs에 다음이 실린다.
  - 이름, 부서, 담당자 실명, system, duration, input, url, 맵 설명
  - 라이브러리(`library.py:134-170`)와 지정 요청(`maps.py:1182-1189`)은 이 정보를 마스킹하는데, refs 경로만 열려 있다.
- **수정 방향**
  - refs를 사용자 역할로 마스킹한다(`library._resolve_roles` 재사용).
  - 새로 생긴 링크 대상만 존재 + viewer 이상(또는 지정) + mode≠framework인지 검증한다.

**C-2 `GET /versions/{id}/comments` 역할 게이트 없음 [CONFIRMED·재확인]**
- **위치**: `backend/app/routers/comments.py:36-47`. POST·PATCH에는 게이트가 있다.
- **재현**: 외부인이 비공개 맵의 코멘트 본문 전체를 200으로 받는다. 이 응답에서 P0-1에 쓸 node id도 얻는다.
- **수정 방향**: `require_version_map_role("viewer")`.

**C-3 승인자 PUT 게이트가 `created_by` 기준 [CONFIRMED·재확인]**
- **위치**: `backend/app/routers/approvers.py:50-59`
- **재현**
  - (a) `created_by=None`(시드·레거시) 비공개 맵: 외부인이 자기를 승인자로 지정 → 200 → 승인자 바닥 역할로 그래프 403→200.
  - (b) 오너 이전·임포트로 `created_by≠owner_id`인 맵: 실오너는 403, 역할을 잃은 원작성자는 200.
- **수정 방향**: 게이트를 `effective_role=="owner" or is_sysadmin`으로 바꾼다.

**E-2(=C-5) framework draft 열람 룰이 AI 챗·코멘트에서 우회 [CONFIRMED·재확인]**
- **위치**
  - `backend/app/routers/ai.py:193-230`: viewer 게이트 뒤 `_load_graph`를 호출한다.
  - draft 가드는 `graph.py:115-142`의 그래프 GET 2종에만 있다.
  - `comments.py:36-75`
- **재현**: 비관리자 뷰어가 draft 그래프 GET은 403인데, AI 챗은 200이고 draft 노드 제목이 프롬프트에 실린다. draft 코멘트 조회·작성도 된다.
- **수정 방향**: `_assert_framework_draft_visible`을 version_id 경로 공통 가드로 옮긴다(`require_version_map_role`에 흡수).

### 결재 무결성

**B-1 같은 승인자의 동시 approve 2건이 2표로 집계 → 공동 승인자 없이 approved [CONFIRMED·재확인]**
- **위치**
  - `backend/app/routers/versions.py:723-746`: 기존 행 확인 후 insert하고, `count >= len(approvers)`로 판정한다.
  - `models.py:486-496`: `version_approvals`에 (version_id, approver) 유니크가 없다.
- **재현**: 승인자 [ap1, ap2]에서 ap1이 동시에 2번 approve → approved. ap2는 승인하지 않았다.
  - sqlite 5/5, 재확인 3/3.
  - postgres에서는 행 2개가 남은 뒤 1번 더 approve하면 approved.
- **수정 방향**: 정족수를 "활성 승인자 ⊆ 승인 집합"으로 판정한다. 기존 중복 행을 정리한 뒤 유니크 인덱스를 추가하고, 행 잠금을 건다(B-2).

**B-3 퇴사·교체된 승인자의 기존 승인이 정족수에 포함 [CONFIRMED]**
- **위치**
  - `versions.py:739-746`: COUNT로 판정한다.
  - `workflow.py:187`의 `reconcile_departures`는 집합 판정이다. 같은 규칙이 두 군데 다르게 구현돼 있다.
  - `ref_audit.py:558-572`의 승인자 교체는 `approvers.py:61-75`의 "진행 중 변경 금지" 가드를 거치지 않는다.
- **재현**
  - [ap1, ap2, ap3]에서 ap1 승인 → ap1 퇴사 → ap2 승인 → approved. ap3는 승인하지 않았다.
  - ref-audit remap 경로도 같다.
  - FE `approval-panel.tsx:99,256-263`도 퇴사자의 승인을 개수에 넣는다.
- **수정 방향**: B-1과 같은 집합 판정 헬퍼를 승인·reconcile·FE가 함께 쓴다.

**B-2 버전 상태 전이에 행 잠금 없음 — 운영 postgres에서 반려 유실·pending 고착·이중 Draft·이중 게시 [CONFIRMED(postgres)·sqlite 일부 재확인]**
- **위치**: `versions.py`의 submit 581 / approve 701 / reject 766 / publish 840 / withdraw 990 / create_version 176. 모두 `with_for_update` 없이 판정한다.
- **재현**: PG16에서 요청 2건을 동시에 보냈다.

  | 동시 요청 | 결과 | 의미 |
  |---|---|---|
  | approve ∥ reject | 6/6 approved, 반려 사유 잔존 | 반려 알림·이벤트는 나갔는데 게시 가능 상태 |
  | 승인자 2명 동시 approve | 8/8 pending 고착 | 전원 승인했는데 빠져나갈 길이 없음 |
  | approve ∥ withdraw | 6/6 approved | 회수했는데 승인됨 |
  | create_version 2건 | Draft 2개 | sqlite에서도 재현 |
  | 승인본 2개 동시 publish | published 2개, 같은 `version_number` | sqlite에서도 번호 중복 |
  | 같은 버전 publish 2건 | 게시 이벤트·알림 2배 | 두 DB 모두 |
- **수정 방향**: 전이 진입 시 `select(MapVersion)…with_for_update()` 후 상태를 다시 검사한다. 버전 생성·재게시는 `ProcessMap` 행을 잠근다. (G 메모: `MapVersion`에 version_number·published 유일성 제약도 없다.)

**E-1 확정 요청 시 해제된 체크아웃을 요청자 에디터의 폴링이 10초 안에 되가져가, L5 관리자의 승인·확정이 409 [CONFIRMED·코드 재확인]**
- **위치**
  - `backend/app/routers/maps.py:1043-1048`: 확정 요청 시 점유를 해제한다.
  - `frontend/src/app/maps/[mapId]/page.tsx:3106-3160`: 편집 역할이면 `acquireCheckout`(POST)를 10초(`CHECKOUT_POLL_MS`, :474)마다 호출한다.
  - `framework_confirm.py:123-130`: 타인이 점유하면 409.
- **재현**: 요청 직후 점유 None → 폴링이 재점유 → 승인 409·직접 확정 409·강제 인수 403 → 요청은 pending으로 남는다.
  - 매뉴얼 `user-manual-editing-ko.md:320`("요청하는 순간 check out 자동 해제")과 어긋난다.
  - 일반 맵에서도 해제된 Draft를 열어 둔 editor가 10초 안에 가져간다.
- **수정 방향**: 폴링을 조회 전용으로 바꾼다. 또는 본인의 pending 확정 요청이 있으면 BE가 재획득을 거부하거나, decide 시 점유를 결정자에게 넘긴다.

### 임포트·AI 데이터 무결성

**G-2 외부 AI 프롬프트에 L1~L4 코드가 없어, 그 결과를 임포트하면 실제 L5가 지어낸 L1~L4 아래로 옮겨짐 [CONFIRMED]**
- **위치**
  - `frontend/src/lib/interview-json-prompt.ts:5-10,50-75`: 조상 코드를 싣지 않으면서 L1~L5 코드를 요구한다.
  - `framework/consult/[sessionId]/page.tsx:215`: `path: []`
  - `framework-panel.tsx:226-233`
  - `import_consultant.py:469-481`: `upsert_categories`가 기존 체인 행의 parent·name·level을 파일 값으로 덮는다.
- **재현**: dry-run은 경고 없음 → apply 후 체인이 바뀐다. 원래 L1~L4는 이 L5를 잃고, 하향 상속과 롤업도 조용히 바뀐다.
- **수정 방향**: 프롬프트에 체인 코드를 싣는다. 기존 체인을 재부모화하는 경우는 dry-run error 또는 체크 항목으로 낸다.

**G-3 재전달·유지 등록이 0.5가 싣지 못하는 값을 지움 [CONFIRMED·재확인]**
- **지워지는 값**: 노드의 부서·담당자·색, 맵의 SP 비용·설명·SP 부서
- **위치**
  - `import_consultant.py:202-227`: `INHERITED_NODE_FIELDS`에 department·assignee·color가 없다.
  - `_graph_signature :814-817`: 위 셋은 서명에 들어 있다.
  - `:1470-1528`: 전달할 수 없는 맵 필드(`sp_cost_krw/usd`·설명·`sp_department`)까지 덮어쓴다.
  - `existing.py:248-282`: 이 값을 되살리지 않는다.
- **재현**
  - 같은 파일을 재임포트 → 노드 부서·담당자·색이 `''`
  - keep 등록 → `sp_cost_krw '120000'→''`, 설명 → `'[Interview]\nOwner role: …'`, `sp_department` → `''`
  - SP 지정값은 버전이 없어 복구할 수 없다.
- **수정 방향**: 세 노드 필드는 승계로 돌리고 서명에서 뺀다. 전달할 수 없는 맵 필드는 비교·대입에서 빼거나, keep이면 맵 쓰기를 건너뛴다.

**G-4 정정(revise) 카드를 "플레이스홀더로 건너뛰기"하면 기존 L6가 활동 1개짜리로 교체되고 SP 값이 지워짐 [CONFIRMED]**
- **위치**
  - `backend/app/routers/framework_interviews.py:403-438`: mode와 무관하게 `fields:{}` 행을 만든다.
  - FE `framework-interview/task-panel.tsx:119,255`: revise 카드에도 버튼을 노출한다.
- **재현**: AI가 3회 무효 응답 → failed → skip → 등록 → 노드 4개가 Start+1로 줄고 SP 필드가 모두 `''`. 드라이런은 `updated graph`만 보여 준다.
- **수정 방향**: revise 카드에서는 skip을 keep 복귀로 바꾸거나 막는다.

### 운영(postgres) 전용

**H-1 `docs/deploy/backup.md` §3 복원 절차가 스키마를 추가한 배포 뒤에는 섞인 DB를 남김 [CONFIRMED(postgres)]**
- **위치**: `backup.md:50-64`의 `pg_restore --clean --if-exists --no-owner`. 신규 FK 테이블(ai_compare_summaries·framework_interview_*·framework_slot_events·map_notes·category_permissions)이 핵심 테이블의 drop을 막는다.
- **재현**: c675d27e 스키마로 시드 → 덤프 → HEAD 기동과 편집 1건 → 문서 명령 그대로 복원.
  - 결과: `exit=1`, 오류 14건이 무시되고 `process_maps`·`map_versions`는 현재 값, nodes 등은 덤프 시점 값인 혼합 DB.
  - 문서의 다음 단계는 health 확인뿐이라 정상으로 보인다.
  - 이런 FK 테이블이 08-18~09-21에 5번 추가됐으니, 14일 보존 창 안에서 "배포 전 덤프로 롤백"하면 그대로 걸린다.
  - 확인 명령 `SELECT count(*) FROM maps;`도 테이블명이 틀렸다(실제 `process_maps`).
- **수정 방향**: 빈 스키마에 `pg_restore --exit-on-error --single-transaction`으로 복원하고 exit code를 확인한다.

**H-2 `app_settings.value VARCHAR(500)`에 JSON 목록 저장 → 운영에서 카탈로그·AI 팁·노출 직책 저장이 500 [CONFIRMED(postgres)·정적 재확인]**
- **위치**
  - `backend/app/models.py:37`: `String(500)`
  - `backend/app/app_settings.py:95,198`: `json.dumps`
  - `routers/app_settings.py:104,108`: ensure_ascii 기본값이라 한글 1자가 6자로 저장된다.
- **재현**: PG에서 시스템 20개 또는 한글 역할 16개 저장 → 500(`StringDataRightTruncationError`). sqlite는 200.
- **수정 방향**: 컬럼을 TEXT로 바꾸고 PG 전용 `ALTER COLUMN … TYPE TEXT` 부트스트랩 스텝을 추가한다.

### 편집 유실

**W-1(=A-3) 에디터에서 편집 후 2초 안에 앱 안 링크로 이동하면 마지막 편집이 경고 없이 사라짐 [CONFIRMED·브라우저 4/4]**
- **위치**: `frontend/src/app/maps/[mapId]/page.tsx`
  - `:473`: `AUTO_SAVE_DELAY_MS=2000`
  - `:2126-2148`: 디바운스 예약
  - `:2160-2168`: 이탈 가드가 beforeunload뿐
  - `:2170-2177`: 언마운트 시 flush 없이 `clearTimeout`만 한다.
- **재현**: F2로 이름 변경 → 150·300·1000ms 뒤 상단 "Maps" 또는 "Map Settings" 클릭 → PUT 0건, 확인창 없음.
  - AI Consultant·Compare 버튼(`:9564,9618,11633,12060`)도 같은 경로다.
  - 버전 pill 전환은 먼저 저장하므로 안전하다.
- **수정 방향**: 앱 안 이동과 언마운트 전에 `saveCurrentScope()`를 await(또는 dirty면 경고)한다.

---

## P2 (59) — 주제별

### 권한·보안 (8)

- **C-4** `GET /versions/{id}/workflow`에 역할 게이트가 없다(`versions.py:467-545`).
  - 비공개 맵의 status·반려 사유·승인자·제출자·점유자가 노출된다.
  - `GET /maps/{id}/approvers`(`approvers.py:19`)도 의존성이 없다(PLAUSIBLE).
- **C-6** 로그인 스로틀이 check-then-count 구조다(`routers/auth.py:48-76`, `login_throttle.py:15-29`).
  - 실패 기록이 느린 AD bind 뒤에 남아, 동시 요청 30건이 AD bind 30건으로 그대로 중계된다(상한 5).
  - 목적("AD 잠금 방지")과 반대로 잠금을 키운다.
- **H-7(=C-8)** 백엔드에 `--forwarded-allow-ips`·`FORWARDED_ALLOW_IPS`가 없다(`backend/Dockerfile:29`, compose).
  - 클라이언트 IP가 nginx 컨테이너 IP로 고정된다.
  - 그래서 누구나 특정 계정을 5분간 잠글 수 있고(ldap·로컬), `login_records` IP도 실제 클라이언트가 아니다.
- **C-7** HR이 같은 login_id의 로컬 계정을 인수해도 sysadmin 부여가 남는다.
  - `hr/service.py:108-115` `_upsert`가 source를 'hr'로 바꾸면서 `local_credentials.is_sysadmin`을 정리하지 않는다.
  - 그 결과 같은 login_id의 AD 계정이 sysadmin이 된다(`permissions/logic.py:78-82`).
- **H-8** 관리자 테이블 뷰어·CSV 내보내기가 `local_credentials.password_hash`를 그대로 노출한다(`routers/admin.py:291-337,380-`). sysadmin 전용이지만 "해시 미노출" 불변식 위반이다.
- **G-9** 맵 접근을 잃은 사용자가 그 맵의 AI 챗 기록(맵 이름·메시지·제안)을 계속 읽는다(`routers/ai_sessions.py:17-98`, login_id만 확인).
- **B-6** 제거된 협업자(맵 GET 403)가 점유와 submit·publish 권한을 유지한다.
  - `checkout.py:47-52,145-171`, `versions.py:400-405`, `permissions.py:735-749`
  - 다운그레이드를 적용할 때 점유·진행 중 제출을 정리하지 않는다.
- **E-12** 상위 체인 관리자가 L5 임명을 자기 자신으로 바꿔 "직속 L5 확정권"을 우회하고, 기존 L5 관리자를 알림 없이 해임한다(`categories.py:1653-1714`). **의도인지 확인 필요.**

### 결재·버전 (9)

- **B-4** 승인 후 제출자가 퇴사하면 approved 버전이 영구히 막힌다.
  - publish·withdraw가 제출자 전용이고 sysadmin 우회가 없다(`versions.py:856-857,1006-1018`).
- **B-5** 승인자 전원 퇴사로 플로우가 취소돼도 동봉 가시성 요청이 pending으로 남는다(`workflow.py:159-170`).
  - 철회는 409로 막힌다.
  - 이후 동봉 없이 재제출해 게시해도 남은 요청이 적용돼 private → public이 된다.
- **B-7** 만료본 재게시가 Draft만 검사해(`versions.py:962-971`) "진행 중 버전 1개" 불변식을 우회한다. 그래서 Draft가 2개 생긴다. FE 노출 조건은 `page.tsx:1522,11727`.
- **B-8** 인박스·배지에 결정할 수 없는 항목이 남는다.
  - 제출 후의 점유 요청은 decide가 409다.
  - 휴지통 맵의 pending 버전은 열면 404인데 승인·게시는 200이다.
  - 위치: `inbox.py:42-51,71-91`. 휴지통 이동도 진행 중 버전을 정리하지 않는다.
  - FE `inbox/page.tsx:342-369` `actApproval`에 catch가 없어 실패가 조용히 묻힌다.
- **B-9** (PLAUSIBLE) 인박스 승인 모달이 동봉 가시성 변경을 보여주지 않는다(`inbox/page.tsx:1417-1435`). 에디터·설정 패널은 보여준다.
- **B-10** AI 비교 요약 캐시 문제 2가지.
  - 최초 생성을 동시에 요청하면 IntegrityError 500이 난다(`routers/ai.py:358-366,399-403`).
  - 해시에 제출 코멘트가 빠져, 재제출 후에도 옛 코멘트 기준 보고서를 재사용한다(`compare_summary.py:114-121`).
- **B-11** 게시·만료 이력이 그래프 PUT 밖에서 바뀐다.
  - 점유하지 않은 editor가 게시·만료 버전 라벨을 바꿀 수 있다(`versions.py:279-296`).
  - 만료본을 삭제하면 버전 이벤트가 cascade로 사라진다(`:415-427`).
- **W-4** 승인자 피커가 막다른 길이다.
  - 후보 목록을 마운트 때 1회만 불러와(`approvers-panel.tsx:44-52`), 같은 화면에서 추가한 협업자가 새로고침 전까지 안 보인다.
  - 빈 결과는 안내 없이 "-"만 표시한다(`principal-picker.tsx:390-392`). 생성 다이얼로그도 같다.
- **W-6** 거절 버전에 "승인 탭에서 편집권 요청" 안내가 뜨는데(`page.tsx:1395-1403`), 요청 버튼은 Draft에서만 렌더된다(`:11690-11716`, BE `checkout.py:41`).

### 업무 체계 (10)

- **E-7 ⚠** 반대 방향 이동 2건이 동시에 들어오면 부모 사이클이 생긴다(`categories.py:1350-1433`, 잠금 없음).
  - 이후 `GET /categories/{id}/chain`(`:1121-1127`, 사이클 가드 없음)이 무한 루프에 빠져 단일 워커 백엔드 전체를 멈춘다.
  - 사이클이 DB에 남아 재기동 뒤에도 재발한다. 발생 가능성은 낮지만 피해가 크다.
- **E-3** 캔버스를 삭제해도 L5의 `linkage_map_id`가 그대로 남는다(`maps.py:1757-1770`).
  - 홈 "Open canvas"는 404가 된다.
  - 집계는 삭제된 캔버스를 "확정"으로 센다(`categories.py` `_card_meta`·overview·`_summary_l5`·subtree_confirm).
  - 그 L5는 영구삭제 후에도 삭제할 수 없다(409).
  - 캔버스를 만든 L5 관리자는 휴지통에서 복구하지 못한다(403).
- **E-4** 카테고리 이동으로 레벨이 바뀌면 "슬롯=L5 전용" 불변식이 조용히 깨진다(`categories.py:1349-1433`).
  - canvas_state null, L6 교체·삭제 409, linkage 422
  - 개명·이동은 형제 이름 중복도 검사하지 않는다.
- **E-5** 빈 L5를 지울 때 다른 캔버스의 `placeholder_category_id` 참조를 검사하지 않는다.
  - 그 캔버스 저장이 매번 422가 된다.
  - 고아 CategoryPermission 때문에 sqlite에서 500이 난다(`access.py:244-248` KeyError).
- **E-6** 슬롯 replace가 홈 캔버스를 재지정해도(후계가 이미 캔버스에 있을 때), 점유자의 낡은 자동저장이 그걸 조용히 되돌린다(`framework_slots.py:344-350,393-408`).
- **E-8** "Open canvas"를 더블클릭하면 같은 이름 캔버스가 2개 생기고 하나는 고아가 된다(`categories.py:1589-1617`, 홈 `page.tsx:753-761`에 진행 중 가드 없음).
- **E-9** L5 "승인 대기" 배지와 대시보드가 결정할 L5가 아니라 맵의 현재 L5 기준으로 센다(`categories.py:464-479`, `me_dashboard.py:279-295`). 인박스와 다르다.
- **E-10** 양측 move 요청을 두 L5 관리자가 동시에 승인하면 한쪽 승인이 유실된다(`permissions.py:693-699`, `framework_slots.py:523-533`).
- **E-11** (PLAUSIBLE) 확정·확정 요청이 대기 중인 자동저장을 먼저 비우지 않는다(`framework-confirm-section.tsx:160-169,209-219`).
  - 화면 내용이 아니라 저장된 구버전이 확정되거나, 마지막 편집이 409로 유실된다.
- **G-5** 다른 L5 맵의 taskId를 담은 전달 파일이 그 맵을 조용히 이 L5로 옮기고 덮어쓴다(`import_consultant.py:1265-1271,1472,1505`).
  - 슬롯 거버넌스(양측 승인)를 우회한다.
  - 리포트는 "map fields only"로만 표기한다.

### AI·인터뷰·임포트 (5)

- **G-6** keep 카드에 보낸 피드백은 받아들여지지만(AI 비용 발생), 확정 때 `_refresh_keep_rows`가 원복한다(`framework_interviews.py:714-738`, `assemble.py:175-199`).
- **G-7** AI가 `content: null`을 돌려주면 `ai_client.py:146-150`이 None을 반환해 AttributeError가 난다.
  - 캠페인 카드가 오류 없이 영구 대기에 빠진다. retry·skip은 409이고, 재시작할 때마다 과금되며 사용량은 기록되지 않는다(`runner.py:73-79`).
  - 에디터 챗·계획·맵 인터뷰 턴은 500이다.
- **G-8** 맵 인터뷰 "Apply & finish"가 제목으로만 병합한다(`interview-preview.tsx:336-354` → `csv-import.ts:1016-1086`).
  - 이름을 바꾼 노드는 새 id가 되고 url·gmp·담당자·색·output_forms를 잃는다.
  - 확인창에 제거될 노드가 보이지 않는다.
- **G-10** 진행 중 맵 인터뷰가 생성 버전에 묶여, 그 Draft가 게시되면 적용할 길이 없다(`interviews.py:424-435`). abandon만 남는다.
- **G-11** 정정(revise) 행을 세션 시작 스냅샷으로 그려, 그 사이 오너가 게시한 변경을 등록이 덮는다(`runner.py:103-105`, `existing.py:296-332`).

### 편집·SP·비교·화면 (13)

- **A-2** 중복 edge id나 다른 버전의 edge id를 담으면 처리되지 않은 `IntegrityError` 500이 SQL 문과 함께 전파된다(`graph.py:468-472`).
- **F-3** 링크 맵이 대표 끝을 지우거나 바꾸면, BE가 다른 끝을 대표로 자동 지정한다(`subprocess.py:92-95`).
  - 부모의 `__primary__` 출구가 경고 없이 다른 끝에 붙는다(의미 반전).
  - 핀 갱신 감지가 이를 놓치고, follow_latest는 경고가 없다.
  - 문서화된 "고아" 한계보다 나쁜 결과다.
- **F-4** 일반 맵에는 서버 출력 규칙 게이트가 없다. 설정 > 버전 패널의 제출·셀프 게시도 `getSaveBlockers`를 우회한다(`versions-publish-panel.tsx:518-540`). 그래서 규칙 위반 맵이 게시된다.
- **F-5** L5 확정 섹션의 변경 요약이 `liveLineageById` 없이 계산된다(`framework-confirm-section.tsx:202`, `page.tsx:11942`).
  - 무변경인데 엣지 ±3을 표시하고, 마이너 확정 버튼이 열린다. 누르면 서버가 409.
- **F-6** 핀 버전(`linked_version_id`) 변경이 비교·변경 요약·확정 서명 어디에서도 잡히지 않는다(`diff.ts:69-103`, `framework_confirm.py:33-66`). 그래서 재핀만 한 변경은 확정할 수 없다(409).
- **F-7** SP 읽기전용 상속 필드를 BE가 강제하지 않고(`schemas.py` NodeIn, `graph.py:420-447`), FE AI 신규 SP 경로도 거르지 않는다.
  - 그 결과 화면의 상속값과 저장값이 갈라진다.
  - CSV·비교 인스펙터·확정 서명은 저장값을 쓴다.
- **F-8** SP 끝 제목에 앞뒤 공백이 있으면 그 출구의 병렬이 저장할 때마다 사라진다.
  - `parallel_outputs` 키만 strip하고 핸들은 하지 않는다(`schemas.py:1300-1304`).
  - 부모 오너가 스스로 고칠 수 없는 막다른 상태가 된다.
- **F-9** FE↔BE 정규화가 갈린다(유니코드·정밀도).
  - duration: 전각·유니코드 숫자·BOM·제어문자 처리(`duration.py:4-5` vs `duration.ts`)
  - 전각 숫자: BE는 원문 저장, FE는 무효로 봐서 Σ에서 빠진다.
  - 카탈로그: casefold와 toLocaleLowerCase 차이로 72/660건 불일치
  - FE의 UTF-16 절단이 만든 고립 서러게이트로 `PUT /api/admin/app-settings`가 500
- **W-2** 비교 화면에서 판단 노드의 No→End 분기가 중간 노드를 관통하고 "No" 라벨이 가려진다(LR·TB 모두).
  - `compare/page.tsx:1274-1298`이 우회 규칙 없는 `pickHandleSide`를 쓴다. 자동정렬은 `pickEdgeHandleSides`(`flow-layout.ts:300-325`)를 쓴다.
- **W-3** 맵 설정 페이지가 리렌더마다 모든 패널을 다시 불러온다.
  - 원인: 메모되지 않은 `showToast`(`settings/page.tsx:149`)가 각 패널 effect의 deps에 들어 있다.
  - 첫 로드 GET 71건, 내비 4번 클릭에 +91건
  - 맵 삭제 직후 404 → 토스트 → 리렌더 → 재조회가 반복된다.
- **W-5** 권한 없는 링크 맵의 미지정 SP에 "Request registration"이 보인다(`page.tsx:11316-11327`).
  - 누르면 403 원문 토스트가 뜨고, 노드를 선택할 때마다 403 GET이 2건씩 나간다.
- **W-7** 읽기전용 임베드 SP 자식에서 F2로 이름 편집기가 열린다(`page.tsx:8341-8354,9231-9235`). Enter 시 조용히 원복되고 무변경 PUT이 1건 나간다.
- **W-8** 대시보드 "Cumulative growth" 그래프가 일별 건수를 그려 선이 내려간다(`dashboard-panel.tsx:241-259` × `dashboard.py:444-`).

### 데이터 왕복 (8)

- **D-1** 제목 앞뒤 공백(끝 줄바꿈 포함)이 있으면, 무변경 왕복이 "삭제+신규"가 된다.
  - 파싱은 trim하고 매칭은 원문으로 한다(`csv-import.ts:607-610` vs `:776-780`). 저장 경계에도 정규화가 없다.
  - 그 결과 좌표·색·그룹·IO 링크·계보를 잃는다.
- **D-2** 같은 맵 재가져오기가 Start 연결을 다시 계산한다(`csv-import.ts:919-930`).
  - 재작업 루프가 있으면 진짜 첫 단계가 Start에서 끊긴다.
  - 흔한 무해한 경우에도 같은 경고가 떠서 유해한 경우가 묻힌다.
- **D-3** 병렬/분기 판정이 `getOutputGroups`와 어긋나 노드 타입이 조용히 뒤집힌다.
  - AI 머지가 decision으로 바꾸면서 `parallel_outputs`를 남겨, CSV 왕복 후 판단 노드가 병렬 일반 노드가 된다.
  - 레거시 gateway 팬아웃은 Excel `Y`, CSV는 빈 칸이다.
- **D-4** 짝이 안 맞는 따옴표 하나가 이후 행을 모두 한 셀로 삼키는데 오류가 0건이다(`csv-import.ts:166-191`).
- **D-5** CSV 가져오기 검증이 저장 경계보다 엄격해, 내보내기 창은 "경고 없음"인데 가져오기는 통째로 실패한다. 걸리는 값:
  - System=Other 메모 101~200자
  - http(s)가 아닌 URL
  - 빈 제목
- **D-6** L5 연계 캔버스에서 CSV 가져오기가 열리지만(`page.tsx:9718-9722`), 적용하면 항상 422다(Start 생성·placeholder→process 변환).
- **D-7** 인터뷰 자동 반복 ◇ 이름이 고정이라, 루프가 2곳 이상이면 제목이 겹쳐 CSV 재가져오기가 전체 실패한다.
  - 매뉴얼(`user-manual-editing-ko.md:258`)은 "건너뜀"이라고 적어 실제와 다르다.
  - 고정 이름은 2026-09-02 사용자 결정이라 재결정이 필요하다.
- **D-8** 경계 사례 3가지.
  - 따옴표 셀 안 CRLF의 `\r`이 남는다.
  - 비UTF-8 바이트 하나만 있어도 파일 전체를 EUC-KR로 경고 없이 해석한다.
  - `'`+수식문자로 시작하는 값은 왕복하면 `'`를 잃는다.

### 운영·postgres (6)

- **H-3** HR 전체 동기화의 대량 비활성화에 상한이 걸리지 않는다(`hr/service.py:79,166,176-185`).
  - status가 `"Active"`(대문자)로만 바뀌어도 401명 전원이 퇴직 처리된다.
  - 그 결과 진행 중 결재가 취소되고 점유가 해제된다. 다음 정상 동기화로 재직 상태는 돌아와도 이 둘은 남는다.
  - `orgLevels`가 빠지면 조직 정보가 지워지고, loginId가 중복되면 마지막 행이 이긴다.
- **H-4** `NodeIn.title`·`EdgeIn.label`·`GroupRenameIn.name`에 max_length가 없다(컬럼 200, FE 입력도 무제한).
  - PG에서 201자부터 500이 나고, 긴 값이 남아 있는 동안 자동저장이 계속 실패한다.
  - CSV·AI 임포트로도 들어온다.
- **H-5** 운영(PG)에서 공지를 편집해 저장할 때마다 시작일이 하루씩 앞당겨진다(`notice-edit-modal.tsx:20-25,43`, timestamptz가 UTC `Z`로 응답).
  - 인박스 삭제 확인 개수도 UTC 날짜로 센다(`inbox/page.tsx:852`).
- **H-6** `_ADDED_COLUMNS` 중 11건이 `TIMESTAMP`(시간대 없음)라 모델의 timestamptz와 다르다(`db.py:34-35,41,47,80-81,105-109,144`).
  - 업그레이드된 PG가 naive UTC를 반환해 화면에 9시간 이르게 보인다(feedback `*_notified_at` 확인).
- **H-9** (PLAUSIBLE) 서버에서 "Backup now"가 500일 가능성이 높다. appuser가 root 소유 `/backups`에 트리거 파일을 못 쓴다(`admin.py:253`).
- **H-10** backend·db·proxy·frontend에 `restart:` 정책이 없다(db-backup만 있음). OOM이나 재부팅 뒤 자동 복구가 안 된다.

---

## P3 (10)

- **A-4** payload 안 중복 node id는 마지막 값이 이기고, 그룹 부모 2-사이클이 저장된다(`graph.py:394-402,421-467`).
- **D-9** Excel 내려받기만 `downloadBlob`을 쓰지 않고 `revokeObjectURL`을 동기로 호출한다(`excel-export.ts:769-787`, Safari 취소 위험).
- **F-10** 서명 코너 드리프트 3종: merge-diff가 중복 엣지를 접음, 배열 `", "` 결합, 제목 폴백.
- **F-11** (PLAUSIBLE) FE 사이클 사전검사가 비가시 맵을 거치는 사이클을 놓친다. `assert_no_cycle`은 PG에서 동시 저장 경쟁이 있다.
- **F-12** CLAUDE.md 드리프트: 실제로는 `s-`/`t-`로 시작하는 모든 끝 제목(예: "t-shirt order")이 대표 끝으로 접힌다. 변 이름 끝 제목은 렌더 변만 오인한다.
- **H-11** sqlite가 FK를 강제하지 않는다(`db.py:14`).
  - 퍼지 잔재가 남고, rowid 재사용으로 새 맵이 퍼지된 맵의 권한을 물려받는다(로컬·테스트 한정).
  - 테스트 스위트가 cascade 동작을 검증하지 못한다.
- **H-12** 런북 드리프트: `backup.md:63`의 `maps` 테이블명, `CHECKOUT_TTL_MINUTES`를 "무활동 자동 해제"로 안내하지만 실제로는 쓰이지 않는다.
- **W-9** 제출 뒤 오너 본인에게 "<본인 id> is editing - read only"가 뜬다(`page.tsx:9404-9407`).
- **W-10** AI 챗 실패 시 대화 제목이 오류문으로 바뀐다(`ai-chat-panel.tsx:293-305`).
- **W-11** 에디터 상단 바가 폭 약 1,060px 미만에서 넘친다(900px에서 Save가 화면 밖).

## 확인 필요 (결함 단정 보류)

- 공개 맵 비멤버가 일반 맵의 Draft 그래프를 GET할 수 있다(200). 설계 의도인지 확인 필요.
- `MapVersion`에 (map_id, version_number)·published 단일성 제약이 없다(B-2와 연관). `map_permissions`에도 유일성이 없어, 임포트 오너 교체가 중복 행을 만들 수 있다.
- `ref_audit.load_target_versions`가 게시본과 최신 Draft만 스캔해, 작업본이 rejected·pending인 맵을 놓친다.
- 게이트 3(stale_link)이 지정 해제된 L6를 잡지 않는다.
- HR 스케줄러가 기동 후 24시간을 먼저 기다린다. 배포가 잦으면 전체 동기화가 오래 돌지 않는다.
- `reset_db`가 가드 없이 운영 이미지에 실려 있다. setup-once A8 명령에 `-p`가 없다.
- deploy.md는 "계정 삭제 후 `/api/me` 조회는 막힌다"고 적었지만 실제로는 200이다.
- 하드코딩 한글 "홈"(`page.tsx:919`)이 영어 UI에 노출된다.

## 이상 없음으로 확인된 것 (주요)

- **저장 왕복**: 모델 44컬럼 ↔ NodeIn ↔ upsert ↔ `buildGraph` ↔ `toAppNodes`가 모두 일치한다. 체크아웃 게이트, `assert_no_cycle`, 링크 유일성도 정상.
- **결재 상태 게이트**: Draft·pending에서 publish는 409, 비승인자 403, 이미 결정된 요청 409. 알림 100캡, 동봉 오너 게이트, 셀프 게시 체인도 정상.
- **라우트 전수 232개**: 무인증은 health·auth.mode·login 3개뿐이다. 관리 계열은 sysadmin 게이트가 걸려 있다.
  - XSS 싱크는 DOMPurify·safeHref·React 19가 막는다.
  - CSV 수식 가드는 FE↔BE 동치다.
  - SQL 인젝션 없음, LDAP 필터 이스케이프, 백업 다운로드 경로 조작 차단, embed-check SSRF 가드, scrypt 비밀번호.
  - 운영 compose 기본값에서 dev 모드로 떨어지는 조합이 없다.
- **CSV·Excel 왕복**: 까다로운 픽스처·샘플 3종의 무변경 왕복이 동일하다. 부분 열 재가져오기는 기존 값을 유지한다. 500행 export 4ms·merge 7ms.
- **이중 구현 차등 테스트**
  - 불일치 0: 게이트 6(무작위 그래프 3,000개 + 401개), 출구 키·입구 핸들, CSV 이스케이프, AI 프롬프트 키·i18n, 레이아웃 역행 엣지·척추
  - 불일치 있음: duration·숫자·카탈로그 → F-9
- **위임 경계**: 형제·상위 쓰기, 자기 서브트리 이동, 깊이 초과가 모두 막힌다. `/categories/nodes`는 L5 2,000개에서 10~14쿼리·17ms.
- **캠페인 정상 경로**: 가짜 AI 실HTTP E2E(계획 → 등록)가 끝까지 돈다. 샘플 31 L6는 keep 왕복 변경 0. 재기동 복구가 있다. 프롬프트 오버라이드는 KeyError가 없다. dry-run은 전부 rollback.
- **스키마 진화**
  - 07-10 → HEAD 업그레이드 체인을 PG16·sqlite로 돌렸다. 누락 컬럼 0, GET 스윕 86건·167건 모두 5xx 없음.
  - py3.11 import·기동 정상, env 3자 대조 정상, Dockerfile 규칙 준수, 단일 워커.
- **실브라우저**
  - J1 작성·저장 보존
  - J3 권한 경계: 읽기전용이 키보드·우클릭·드래그·인스펙터 전부에서 강제되고, PUT은 403
  - J4 왕복 변경 0
  - J5 업무 체계 드릴다운·탐색 모달
  - J6 AI 오류 UX
  - J7 설정 16탭 page error 0, 휴지통 복구
  - J8 SP 임베드

## 미커버

- 실제 Keycloak RS256 토큰·AD·n8n, Docker 런타임(바인드 마운트 소유권·restart·OOM), 원격 HTTP(비보안 컨텍스트), 한국어 UI 전수, 모바일
- 브라우저: 슬롯 거버넌스, L5 확정, CSV 새 맵 부분 실패 재개, 한국어 로캘 Excel 실물, PNG 내용
- 실모델 AI 품질

## 권장 수정 순서

1. **보안 경계** (BE만, 작은 가드 묶음): P0-1 · P0-2 · F-2 · C-2 · C-4 · C-3 · E-2 · G-9 · H-8
   - 공통 패턴은 "id 소속 검증 + version_id 경로 공통 가드"다.
   - 리뷰어 재현 스크립트를 회귀 테스트로 옮긴다.
2. **결재 무결성**: B-1·B-3(집합 판정 헬퍼 + 유니크 인덱스, 기존 중복 행 정리) → B-2(행 잠금) → B-7 · B-4 · B-5 · B-6 · B-8
3. **임포트·AI 데이터 무결성**: P0-3 · G-3 · G-4 · G-2 → G-5~G-11
4. **운영 postgres 전용**: H-2 · H-4 · H-6 · H-5 · H-1(런북) · H-10 · H-7 · H-3
   - 대부분 sqlite 테스트로는 잡히지 않는다. PG를 쓰는 테스트 레인 도입을 검토할 만하다(이번에는 일회용 PG16으로 재현).
5. **편집 유실**: W-1 (+E-11 확정 전 저장)
6. **업무 체계**: E-1 · E-7 → E-3~E-10
7. **나머지 P2·P3**

## 부록 — 원 보고 ID와 재현 자료

- **ID 접두어**: 시나리오 담당 리뷰어(A~H, W)
  - A 작성·저장 / B 결재·버전 / C 권한·보안 / D 내보내기·가져오기 / E 업무 체계 / F SP 참조·이중 구현 / G AI·인터뷰·임포트 / H 운영·배포 / W 실브라우저
- **재현 스크립트·DB·캡처**: 이번 세션 스크래치 `review/<ID>/`(임시 경로, 세션 종료 후 사라질 수 있음)
  - A `scn_hijack.py`·`scn_validate.py`
  - B `s1~s9_*.py`(동시성은 PG 인자)
  - C `test_c_*.py`·`routes.md`(232 라우트 표)
  - D vitest 프로브(삭제됨)·`test_d_*.py`
  - E `s1~s11_*.py`
  - F `scen_*.py`·`signatures.md`·`corpus_*.json`
  - G `test_g_*.py`·`e2e_campaign.py`
  - H `scn_*.py`·`schema.md`·`env.md`·`tools/restore_test.sh`
  - W `j*.mjs`·`logs/`·`shots/`
