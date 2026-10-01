# 인터뷰 JSON 0.4/0.5 임포트 — 필드 대조표

전달 스키마 `0.4`/`0.5-bpm-interface-draft`의 **모든 키**가 BPM 어디에 착지하는지, 무엇이 버려지는지,
무엇이 조용히 다르게 변환될 수 있는지. 실파일 대조 시 이 표를 기준으로 dry-run 리포트를 읽는다.

구현: `backend/scripts/consultant_interview.py`(어댑터) · `backend/scripts/import_consultant.py`(엔진).
설계: `2026-09-01-interview-import-v04-design.md`(폐기 — git history) · 0.5 외부 참조: 컨설턴트 계약 `docs/samples/interview-json-0.5.md`(설계 `2026-09-07-interview-external-refs-design.md`는 폐기 — git history).

---

## 1. 착지 — 값이 보존되는 필드

### 최상위

| 키 | 착지 |
|---|---|
| `framework.categories[]` | `process_categories` 업서트(code 기준 멱등, 개명 안전) |
| `l5.nodeCode` | 이번 파일 전체 맵의 소속 카테고리. categories에 없으면 **파일 error** |
| `l5.label` | 미사용 — 카테고리 이름은 `framework.categories`가 진실 |
| `relations.entry` | L5 스코프 노트(kind=`entry`, title=`Entry (triggerType)`) + 진입 L6를 연계 캔버스 **첫 자리**로 |
| `relations.edges[]` | **L5 연계 캔버스 엣지**(SP 노드 사이). `label`+`condition`이 엣지 라벨, `quote`는 L5 노트 |
| `rows[]` | 맵 1건씩 — `consultant_code=taskId`, `name=l6`, `category=l5.nodeCode` |
| `tasks[]` | `taskId` 조인으로 `exceptions`·`note`만 소비 (아래 §3) |
| `sideNotes[]` | `map_notes` — `unitId` 매칭 시 그 맵, null이면 L5 스코프. `kind` 그대로 |
| `openItems[]` | `map_notes` kind=`open_item`, L5 스코프 |
| `externalTasks[]` (0.5) | 타 L5의 L6 참조 레지스트리 — 엣지 끝점이 `refId`면 **L5 연계 캔버스 플레이스홀더 SP 노드**(`title=l6`∥`(L6 unspecified) L5명`, `placeholder_category_id=l5.nodeCode의 카테고리`, 계보키 `__ext__|홈L5|refId`). 그 L5에 정규화 이름 정확 일치 라이브 맵이 1개면 실 노드로 직결. `note`는 홈 L5 노트(kind=`external`). 계약: `docs/samples/interview-json-0.5.md` |
| `framework.categories[]` 중 홈 체인 밖 (0.5) | 외부 계보 — **없을 때만 생성**(있으면 name/level/parent/sort 불변). 부모가 파일에 없으면 경고 후 제외 |
| `framework.categories[].admins` (0.5) | `category_permissions`(user) **add-only** — 홈 체인 행만, 기존 사람·그룹 권한자 불변, `granted_by`=실행자. 외부 행의 admins는 경고 후 무시. 리포트 `category admin 'x' added @ 코드` / 미등재 `not found in employees` 경고 |
| (후차 해소 알림, 0.5) | 자리표가 자동 연결되면 `fw_external_linked` 알림 — 캔버스 L5 직속·조상 관리자 ∪ 연결된 맵 L5 직속·조상 관리자(그룹은 멤버 확장), 실행자 제외. payload `map_name`(캔버스)·`from_name`(전달 L5)·`to_name`(연결 L6들)·`count`. 인박스 카테고리=subprocess. 같은 트랜잭션에 캔버스 draft `VersionEvent(external_linked, note=연결 제목들)`. dry-run은 rollback으로 미생성 |

### rows[]

| 키 | 착지 |
|---|---|
| `taskId` | 맵 `consultant_code`(재전달 식별키) |
| `unitId` | sideNotes/openItems의 맵 매칭 키로만 사용 — 컬럼 저장 없음 |
| `l6` | 맵 이름 (200자 초과 절단+경고) |
| `owner` | 신규 맵: 맵 오너(null이면 **실행자 폴백 + `consultant_owner_pending=True`**, 카드에 "Owner unconfirmed" 필). 기존 맵: 현재값과 다르면 dry-run `governance[]` 차이 행 — **체크한 것만 교체**(체크 시 대기 플래그 해제, 수동 오너 이전도 해제) |
| `ownerRole` | 맵 지정값 `sp_assignee_role`(100자 절단+경고, 2026-09-12) + 맵 설명 `[Interview]` 섹션 `Owner role:` 줄 |
| `approvers[]` | 신규 맵: `map_approvers`. 기존 맵: 비어 있지 않고 집합이 다르면 governance 차이 행 — 체크 시 전부 교체 |
| `department` | `sp_department`(항상, **조직 트리에 착지한 경로의 리프명**) + 신규 맵 `owning_department`(트림된 전체 경로). 기존 맵: 해석 결과가 현재 owning과 다르면 governance 차이 행 — 체크 시 교체 |
| `actions[]` | 노드 (아래) |
| `relations.edges[]` | 맵 엣지 (아래 §2) |

### rows[].fields

| 키 | 착지 |
|---|---|
| `start_condition` | `sp_start_condition` |
| `done_criteria` (또는 `done_criterial`) | `sp_end_condition` — 표기 이중 수용 |
| `input_data` / `output_data` | `sp_input` / `sp_output` (list면 개행 join) |
| `systems` | `sp_system`(100자) + `sp_system_fallback`(200자) 이중 기록. `sp_system`은 시스템 카탈로그로 정규화(`commit_system` — 별칭→정식 표기, 미일치→`Other`, 원문은 폴백에 남음). 에디터 commitSystem과 같은 규칙 |
| `total_time_min` | `sp_duration` — 분 → H.MM (`90` → `1.30`) |
| `touch_time_min` | `sp_touch_time` — 같은 H.MM 계약 |
| `total_time` / `touch_time` | `sp_total_time_fallback` / `sp_touch_time_fallback` (원문 프리텍스트) |
| `frequency` | `sp_frequency_fallback` |
| `gmp` | `sp_gmp_fallback` — **`sp_gmp`(검토 선정값)는 임포트가 안 건드린다** |
| `annual_count` / `fte` | 맵 지정 참고치 `sp_annual_count`/`sp_fte`(2026-09-03, 재전달 시 다른 SP 필드처럼 덮어씀) + **L5 연계 캔버스 SP 노드**의 `annual_count`/`fte`(빈 값만 채움) |
| `headcount` | `sp_headcount` |
| `artifact_role` | 맵 설명 `[Interview]` 섹션 `Artifact role:` 줄 |

### rows[].actions[]

| 키 | 착지 |
|---|---|
| `seq` | 노드 코드 `a{seq:02d}`(계보 키) + 정렬. **relations의 참조키** |
| `label` | 노드 제목(200자 절단+경고) |
| `name` | 노드 설명 첫 줄 |
| `kind` | `decision`→decision 노드 / `action`·`handoff`→process(handoff는 설명에 `Kind: handoff`) |
| `variant` | `normal` 외는 설명에 `Variant: <값>`. `exception`은 노드 색 rose(`#c2849a`) |
| `input` / `output` | 노드 `input`/`output` — **문자열 배열이 정본**(0.5, 문자열 하나도 하위호환), 항목을 개행으로 합친다. 같은 활동의 양쪽이 같은 집합이면 경고(handoff 예외). **텍스트가 완전일치하는 상류 아웃풋이 있으면 IO 링크로 자동 연결**(§2-1) |
| `dataForm` | 산출물 **첫 줄의 `output_forms`**(50자). 산출물이 비면 버린다(노드 레벨 `data_form`은 2026-09-03 폐기) |
| `system` | 노드 `system`(100자) + `system_fallback`(200자). `system`은 `systems`와 같은 카탈로그 정규화(별칭→정식, 미일치→`Other`) |
| `rule` / `screen` / `quote` | 노드 설명 KV 줄(`Rule:` / `Screen:` / `Quote:`) |

---

## 2. 흐름 그래프 (0.4 신규)

규칙: 한 활동(L7)·한 L6에서 나가는 연결은 하나(출력 규칙 2026-10-01). 갈래는 `branch`+`exclusive`(출발 활동이 decision) 또는 `branch`+`parallel`(출발 노드 `parallel_outputs`). 계약 문장은 `docs/samples/interview-json-0.5.md` "출구당 연결 1개".

| 키 | L7(`rows[].relations`) | L6(최상위 `relations`) |
|---|---|---|
| `src`/`dst` | `actions[].seq` 참조 → 노드 | `rows[].taskId` 참조 → SP 노드 |
| `label` + `condition` | 엣지 라벨에 **줄바꿈으로 합쳐** 적재(200자 절단) | 동일 |
| `kind: seq` | 일반 엣지(한 활동에서 순차 2개 이상이면 아래 팬아웃 행) | 일반 엣지 |
| `kind: branch` | 일반 엣지 + **src 노드를 decision으로 승격**(gateway≠parallel일 때) | src가 SP라 승격 불가 → **팬아웃 앞에 분기 노드를 새로 끼운다**(B→◇→{A,C}). 조건 라벨은 분기 노드 출구 엣지가 보유 |
| `kind: loop` | 엣지. **Start 배선 판정에서 제외**(End 판정엔 포함). 앞 활동으로 되돌아가는 seq/branch도 loop로 재분류(경고). 자기 자신으로 되돌아가면 `a{seq}r` ◇("반복 여부(자동 생성됨)")를 합성해 ◇→자기 루프백, 기존 진출은 ◇로 이설 | 엣지. **랭크 계산에서 제외** — SP 노드끼리 사이클이 생기면 배치가 전달 순서를 따라가 버린다 |
| `kind: bypass` | 일반 엣지 | 엣지 |
| `gateway: exclusive` | decision 승격으로 표현 | 분기 노드로 표현 |
| `gateway: parallel` | 다중 out-edge + 출발 노드 `parallel_outputs=["__primary__"]` 켬(승격 안 함, 출력 2개 이상일 때). 어댑터는 `CanonicalNode.parallel`로 넘기고 L6 맵 `Edge.gateway`는 기록하지 않는다 — 역변환(`map_to_row`)은 `parallel_outputs`로 `branch`/`parallel`을 복원. 같은 활동에서 되돌아가기·건너뛰기와 섞이면 팬아웃 ◇로 접혀 **택일로 바뀐다**(아래 §4 경고) | 분기 노드 없이 다중 out-edge + SP 출구 `parallel_outputs` 켬 (전부 parallel일 때, 엣지 `gateway="parallel"`도 기록). **보강 시 그 노드에 기존 비병렬 진출(`gateway≠parallel`)이 있으면 켜지 않는다**(`apply_interview_linkage` `plain_sources` — 수동 엣지 의미 보존, 체크리스트가 알림). SP 끝 키별 병렬은 0.5로 표현 불가 — 대표 끝만 켜고, 캔버스에서 켠 보조 끝 키는 add-only 보강이라 유지 |
| 팬아웃(비병렬 2개 이상, 2026-10-01) | decision이 아닌 활동에서 연결이 2개 이상이고 전부 parallel은 아니면 활동 뒤에 ◇ 자동 생성(코드 `a{seq}f`, 이름 `{활동명} 결과`, loop가 섞이면 `반복 여부(자동 생성됨)`) — 갈래를 ◇로 옮기고 활동의 parallel은 해제, 경고 1건. 역변환 `map_to_row`가 이 두 이름의 ◇를 접어 원래 행으로 되돌린다(`existing.py` `_is_fanout_branch`) | 분기 노드(`__branch__{src}`)를 끼운다 — 위 `kind: branch` 행과 같은 이름 규칙 |
| `quote` | `map_notes` kind=`flow`(title=`src → dst`, text=quote+`kind/gateway · condition`) | 동일, L5 스코프 |

---

## 2-1. 배치 · IO 링크 · 작업본 (전달 키가 아닌 파생 결과)

| 산출 | 규칙 |
|---|---|
| 노드 좌표 · 엣지 변(side) | 노드·엣지를 다 만든 뒤 **가로 자동정렬**(rank + 교차 감소 + 주 흐름 직선화 + 역행 엣지 top 핸들). 랭크 간격은 **그 구간을 지나는 엣지 라벨 폭**에서 나온다(라벨이 노드를 덮지 않게). L5 연계 캔버스는 분기 출구를 **위→아래→옆 순**으로 벌리고 핸들을 맞춘다. 둘 다 **캔버스를 새로 만들 때만** 적용(보강은 기존 노드 불변) |
| IO 링크(`output_ids`·`input_links`) | 아웃풋 줄과 인풋 줄이 **완전일치 + 흐름 순방향**이면 자동 연결. 후보 여럿이면 최근접 상류. 항목 id는 전달 좌표에서 파생한 결정적 값. 재전달은 직전 게시본의 사용자 링크를 먼저 승계(§4)한 뒤 빈 줄만 자동 연결한다 |
| SP 끝점 핸들 | L6 맵 연계 노드: 출구 `__primary__`, 들어오는 문은 배치가 고른 변(좌=`in`, 그 외 `in:<side>`, 에디터 자동 정렬과 동치 — `subprocess_in_handle`). L5 연계 캔버스: 출구 `__primary__`·들어오는 문 `in` 고정, 분기 노드는 변 id(`s-*`/`t-left`). 보조 끝 키는 전달물로 만들 수 없다 |
| 편집용 draft | 게시 직후 게시본을 복제한 draft 1건(점유권자 없음). 이미 draft가 있으면 만들지 않음. 재전달 때 **점유권자 없고 편집 가능한 전 필드(좌표·핸들·url·역할·파라미터·GMP·폼·플래그·링크·버전 고정·병렬 출구·그룹)가 게시본과 같으면** 그 draft를 새 게시 버전으로 재사용한다 |

---

## 2-2. 외부 참조 해소 (0.5)

| 시점 | 규칙 |
|---|---|
| 임포트 시 | `externalTasks[].l5.nodeCode` 카테고리(파일 동봉 또는 DB)의 라이브 맵 중 `normalize_task_name(name) == normalize_task_name(l6)`가 **정확히 1개** → 직결(`linked external task …`). 2개 이상 → 경고, 플레이스홀더 유지. `l6: null`은 매칭 대상 아님 |
| 재전달(다른 L5) | 전달분이 건드린 카테고리를 `placeholder_category_id`로 가진 미연결 플레이스홀더를 전 캔버스 draft에서 스캔 → 같은 규칙으로 연결(`placeholder_category_id`는 소거, `resolved N external placeholder node(s)`). 손으로 만든 플레이스홀더(출처 NULL)는 대상 아님 |
| 재임포트(같은 파일) | 같은 `refId`의 미연결 플레이스홀더는 제목·출처 갱신, 연결된 노드는 불변 |
| 미선언 코드 | `externalTasks`에 없는 끝점 문자열은 실 taskId로 취급(dev 2026-09-06 동작) — 제목=코드, 출처 없음, 계보키 `__ext__|코드`, 리포트 `@ unknown` |
| 정규화 | `app/lineage.py` `normalize_task_name` = NFKC → casefold → 공백 전부 제거 |

## 3. 무시 — 저장하지 않는 필드

리포트 카운트에도 안 잡히고 조용히 버려진다. **미지 키가 아니므로 warning도 안 난다** — 의도된 제외.

| 키 | 이유 |
|---|---|
| `_readme` | 사람용 설명 |
| `schema_version` | 버전 게이트에만 사용(0.4/0.5로 시작하지 않으면 파일 error, 거부 문구는 0.5 재전달 안내) |
| `labelSource` | 현재 소비처 없음 — 검수 상태를 담을 컬럼이 없다 |
| `summary` 전체 | 전달측 집계값. BPM은 실제 적재 결과로 자체 집계 |
| `tasks[].evidence[]` | 근거 발화 원문 — 저장 제외 확정(2026-08-18) |
| `tasks[].revision` · `state` · `doc` · `seq` | 전달측 작업 상태 |
| `tasks[].name` | `rows[].l6`가 비었을 때만 폴백으로 사용 |
| `tasks[].startCondition` / `endCondition` | `rows[].fields`가 우선(중복 정보) |
| `tasks[].exceptions[].evidence` | 위와 동일 |
| `l5.label` | `framework.categories`의 name이 진실 |

**소비되는 tasks 키**: `id`(조인) · `exceptions[].name`/`rule`(→ `map_notes` kind=`exception`) · `note`(→ kind=`task_note`).

---

## 4. ⚠️ 조용히 다르게 변환될 수 있는 필드

dry-run 경고를 반드시 읽어야 하는 지점.

| 상황 | 무슨 일이 나나 | 신호 |
|---|---|---|
| **`department`가 조직 트리에 없음** | 오너의 조직 경로로 **폴백**된다(값이 바뀌었는데 임포트는 성공) | `department ... unknown — fallback to owner org` |
| `department`의 `/` 앞뒤 공백 | 어댑터가 세그먼트별 strip 후 재결합 — **정상화되지만 원문과 다름** | 없음(의도된 정규화) |
| **`department`가 착지 실패** | `sp_department`에 전달값이 **경로 통째로** 남는다(리프를 뽑지 않는다 — `A/ADC T/F`의 마지막 칸은 `F`) | owning 쪽 `not in org tree` 경고 |
| 부서명 자체에 `/`가 든 부서(`ADC T/F`) | 조직 미러의 부서명 사전으로 **쪼개기 전에 되붙인다** — 정상 착지 | 없음(의도된 정규화) |
| **`annual_count`/`fte`에 값이 있는데 연계 캔버스 보강이 스킵됨** | 두 값이 갈 곳을 잃는다 | `linkage skipped — canvas checked out by ...` |
| **연계 캔버스 SP 노드에 이미 값이 있음** | 전달값이 **적용되지 않는다**(사용자 편집 우선) | `annual_count 'X' kept (delivery has 'Y')` |
| `total_time_min`/`touch_time_min`이 숫자가 아님 | 해당 파라미터가 빈 값으로 남는다 | `... not a number` |
| `annual_count`/`headcount`/`fte`가 숫자로 안 읽힘 | 엔진이 `""`로 소거 | `invalid ... dropped` |
| **`total_time`/`touch_time`(프리텍스트)만 있고 `*_min`이 없음** | 폴백 컬럼에만 남고 **회당 파라미터는 빈 값** | 없음 — 표에 안 뜬다 |
| `label`/`condition` 합계가 200자 초과 | 엣지 라벨이 잘린다 | `label truncated to 200 chars` |
| `l6`가 200자 초과 | 맵 이름이 잘린다 | `l6 truncated to 200 chars` |
| **branch 엣지의 src가 원래 action** | 노드가 **decision(마름모)으로 바뀐다** | `... promoted to decision (exclusive branch edge)` |
| **한 활동에서 연결 2개 이상(전부 병행은 아님)** | 활동 뒤에 ◇(`{활동명} 결과` / `반복 여부(자동 생성됨)`)가 생기고 갈래가 ◇로 옮겨간다 | `... has N outgoing edges - auto-generated branch node a{seq}f` |
| **병행 갈래가 되돌아가기·건너뛰기와 같은 활동에서 나감** | 위 ◇가 병행 갈래까지 택일로 나눈다 — 병행 표시가 버려진다 | `... parallel edges to '…' dropped - mixed with other outgoing edges` |
| **앞 활동으로 되돌아가는 seq/branch** | loop로 재분류(Start 배선 보호) | `backward edge ... treated as loop` |
| **같은 활동의 input·output이 같은 항목 집합** | 그대로 착지(값 보존) — L6 단위 IO를 뭉뚱그린 신호. handoff는 예외 | `input equals output - same items on both sides of one action` |
| **산출물(output) 없는 활동의 `dataForm`** | 버려진다(폼은 산출물 줄에만 붙는다) | 없음 |
| **`systems`/`system`이 카탈로그와 다름** | 별칭이면 정식 표기로, 미일치면 `Other`로 저장(원문은 폴백 컬럼) | `system '…' normalized to '…'` / `system '…' not in catalog - stored as Other` |
| **loop 엣지가 유일한 in-edge인 노드** | Start에 연결된다(설계 의도) | 없음 |
| 같은 `src→dst` 엣지가 두 번 | 뒤 엣지가 버려진다(라벨도 함께) | `duplicate edge ... dropped` |
| **맵 이름이 기존 맵과 중복** | 차단하지 않는다 — 양쪽 다 살아남는다 | `duplicate map name ...` |
| **휴지통에 있는 맵과 같은 taskId** | 파일 error — 되살리지 않는다 | `map is in trash` |
| `owner`/`approvers`가 employees에 없음 | 저장은 되지만 승인 정족수에서 제외된다 | `owner ... not found in employees` |
| **기존 맵에 새 owner/department/approvers** | **자동 적용되지 않는다** — 리포트 "Governance changes" 섹션에서 교체(Replace)로 고른 것만 교체, 유지(Keep)는 현재값 유지(오너 대기 맵도 동일, 2026-09-03; 2026-09-08부터 체크박스 대신 드롭다운, 굵은 값 = 적용 뒤 값) | governance 차이 행 + 교체 선택 시 `governance` 리포트 행 |
| **`sp_gmp`(검토 선정값)** | 재전달이 절대 못 덮는다 — `gmp`는 fallback 컬럼에만 | 없음(설계 의도) |
| **내용이 같은 재임포트** | `unchanged`로 끝나 **좌표·엣지 변이 갱신되지 않는다**(레이아웃은 시그니처 밖) | 없음 — 재정렬하려면 내용이 바뀌거나 에디터 "자동 정렬" |
| **동명 IO 항목이 여러 상류에 있음** | 최근접 상류 **하나만** 연결된다(한 항목=링크 1개) | 없음 |
| **인풋 항목에 이미 링크가 있음** | 자동 연결이 건너뛴다(사용자 편집 보존) | 없음 |
| **자동 draft를 손대지 않은 채 재전달** | 그 draft가 새 게시 버전으로 **재사용**된다(내용은 새 전달분으로 교체). "손대지 않음" = 점유권자 없음 + 편집 가능한 전 필드(좌표·핸들 포함)가 게시본과 같음 — 하나라도 다르면 draft는 보존되고 새 버전이 따로 게시된다 | 없음 |
| **재전달 새 버전과 게시본의 오너 편집값** | 전달물이 싣지 않는 노드 필드는 직전 게시본의 같은 계보 노드에서 **승계**된다(D1 2026-10-02, `INHERITED_NODE_FIELDS`): `gmp`·`assignee_role`·`url`/`url_label`·`duration`·`touch_time`·`cost_krw`/`cost_usd`·`headcount`·`start_condition`/`end_condition`·`width`·그룹(새 버전에 그룹 행 복제)·링크 노드 `follow_latest`/`linked_version_id`(같은 링크 맵일 때)·IO 줄 정렬 필드 `input_forms`/`input_flags`/`input_links`(인풋 텍스트 불변일 때)·`output_forms`/`output_ids`/`output_links`(아웃풋 텍스트 불변일 때). 전달물이 싣는 필드(제목·설명·담당·시스템·IO 텍스트·흐름·병렬 출구)는 전달분이 진실. 노드 수준 `annual_count`/`fte`는 링크 노드가 아닌 노드(L7 활동·Start/End)에서 승계하고, 링크 노드는 대상 맵 전달 params가 진실이다(이번 전달분에 없는 DB-only 대상만 직전 값 승계). 승계는 변경 감지 전에 돌아 승계 필드만 다른 재전달은 `unchanged` | 없음 |
| **승계한 인풋 링크의 원본 위치가 흐름상 옮겨짐** | 인풋·원본 아웃풋 줄 텍스트가 그대로면 링크(`input_links`)와 원본 항목 id가 승계돼 **옛 원본을 계속 가리킨다** — 흐름이 바뀌어 그 원본이 더는 상류가 아니어도 끊지 않는다. 자동 연결(`link_matching_io`)은 빈 줄만 채우므로 다시 잇지 않는다(원본 아웃풋 줄이 바뀐 경우만 비우고 재연결). 에디터에서 수동으로 다시 잇는다 | 없음 |
| **2026-10-01 이전에 임포트된 L6의 병행 팬아웃** | 그때는 `parallel_outputs`·`Edge.gateway` 둘 다 남지 않아 역변환이 `seq`로 되돌리고, 캠페인에서 그 행을 재등록하면 `{활동} 결과` ◇(택일)가 생긴다. keep 전에 에디터 우클릭 병렬 출구로 켜거나 전달분을 재임포트한다(서명에 `parallel_outputs`가 있어 새 버전) | 없음 — 마이그레이션 없음(저장 체크리스트·확정 게이트가 안내) |
| **출력 규칙 배포 후 첫 재전달** | 병행 갈래·자동 ◇가 생기는 맵은 내용이 같아도 서명(`parallel_outputs`·◇ 노드)이 달라 새 버전이 게시된다 | `updated` |

---

## 5. 파일 전체가 거부되는 조건 (error)

error가 1건이라도 있으면 **그 파일은 통째로 스킵**되고 다른 파일은 계속 진행된다(부분 임포트 없음).

- `schema_version`이 `0.4`/`0.5`로 시작하지 않음
- `framework.categories` 누락/구조 위반(중복 code·부모 미존재·레벨 불일치) — 홈 체인 기준. 외부 계보의 부모 미존재는 경고 후 제외(0.5)
- (0.5) `externalTasks`가 리스트가 아님 · 항목이 객체가 아님 · `refId` 누락/중복/`rows[].taskId`와 충돌 · `l5` 또는 `l5.nodeCode` 누락
- `l5.nodeCode`가 `framework.categories`에 없음
- `rows`가 리스트가 아님
- row의 `taskId` 누락 / 파일 내 중복 / **파일 간 중복**
- row의 `l6`(맵 이름)를 `tasks[].name`으로도 못 채움
- **`actions[].seq` 중복** (0.4에서 relations 참조키)
- `actions[]` 항목이 객체가 아님
- 맵이 휴지통에 있음
