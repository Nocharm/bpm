# 인터뷰 JSON 0.5 — 외부 L6 참조(`externalTasks`) 설계

작성 2026-09-07 · 기준선 dev `91f9f5f6` · 브랜치 `feat/interview-external-refs`(워크트리, **dev 머지 보류 — 브랜치 푸시까지만**)

## 1. 목표

컨설턴트는 L5 단위로 인터뷰 결과를 전달한다. 한 L5의 L6 흐름(`relations.edges`)에 **다른 L5의 L6**가 등장하는데, 그 L6는 아직 인터뷰되지 않아 `taskId`가 없다 — 컨설턴트가 아는 것은 **소속 L5 코드**와 **대략적인 이름**(없을 수도, 실제 이름과 다를 수도)뿐이다. 컨설턴트 측 데이터 구조는 아직 미구현이라 우리가 JSON 계약을 먼저 제안한다.

dev에는 이미 "끝점이 rows 밖인 엣지 → L5 연계 캔버스 플레이스홀더 노드" 메커니즘이 있다(spec 2026-09-06 §8). 빠진 것은 **그 외부 L6가 어느 L5인지·이름이 무엇인지 실을 자리**이고, 스펙 §8이 이를 "인터뷰 트랙 백로그"로 남겼다. 이 문서가 그 백로그를 닫는다.

## 2. 확정 결정 (브레인스토밍 Q&A)

| 질문 | 결정 |
|---|---|
| 외부 L6의 식별자 | **L5 코드 + 이름(불확실)만**. taskId 없음 → 파일 안 참조용 `refId` 신설 |
| 후차 매칭 | **같은 L5 안 정규화 이름 정확 일치만 자동**, 나머지는 플레이스홀더로 남겨 연결 다이얼로그(기존 UX)로 수동 |
| 외부 L5가 BPM에 없을 수 있나 | **있을 수도 없을 수도** — 외부 L5 계보를 파일에 동봉하면 임포터가 **없을 때만 생성**(있으면 절대 개명 안 함), 동봉 안 하면 DB의 기존 체계로 해석 |
| JSON 자리 | **A안: 최상위 `externalTasks[]` 레지스트리 + 엣지는 `refId` 참조**. B안(엣지 끝점 객체화)·C안(rows 스텁 행)은 폐기 — 안정 핸들 부재·rows 소비자 오염 |
| 샘플 | **7파일 전부 0.5로 재작성** — 파일당 L6 ≥4, 각 L6는 순환(loop)+분기(branch) 포함, "있는 버전/없는 버전" 시나리오 전부 |
| 브랜치 | dev에서 분기한 워크트리 브랜치에서 작업, 게이트 그린 후 **브랜치 푸시까지**. dev 머지는 사용자 결정 대기 |

## 3. 현재 모델 (dev 91f9f5f6 실측)

- **데이터**: `nodes.placeholder_category_id`(출처 L5, FK 없음·앱 경계 검증 `routers/graph.py:245-263`) · `nodes.source_node_id`(계보 키) · `process_maps.consultant_code`(taskId, 전역 unique) · `process_categories.code`(unique).
- **어댑터** `scripts/consultant_interview.py:513-528`: 엣지 끝점 한쪽만 rows 밖이면 `external=True`, `linkage.external_codes`에 원문 코드 적재. 양쪽 다 밖이면 드롭.
- **엔진** `scripts/import_consultant.py`: `apply_interview_linkage`가 외부 코드를 DB에서 조회 — 있으면 실 노드 직결, 없으면 플레이스홀더(`title=코드`, `placeholder_category_id=None`, `source_node_id=external_lineage_key(코드)`, :1484-1494). `resolve_external_placeholders`(:712)가 pass 1 직후 이번 전달분 코드와 같은 계보 키의 플레이스홀더를 **전 캔버스 draft**에서 연결(체크아웃 규약·휴지통 제외). 슬롯 assign/move도 채움(`app/framework_slots.py:195-206`).
- **계보 키** `app/lineage.py`: `make_node_id(map_code, node_code)` = sha1 기반 결정적 값, `external_lineage_key(code) = make_node_id("__ext__", code)`.
- **FE(이미 구현, 무변경)**: 플레이스홀더 노드 = 점선 에러 룩 + 출처 L5 배지(`placeholder_category_path`) + "Connect" 배너 → 연결 다이얼로그가 출처 L5 체인을 자동 펼침(`framework-tree-picker.tsx:169`), 다른 L5 선택은 확인 게이트. 미해소 플레이스홀더는 L5 확정 게이트(`lib/framework-gates.ts` `"placeholder"`)를 막는다.
- **카테고리 upsert** `import_consultant.upsert_categories:301-344`: code 기준 멱등, **기존 행 이름을 전달값으로 덮어씀**(뒤 파일 승). 외부 계보를 그대로 넣으면 타 L5 이름을 이 파일이 개명해 버린다 → 외부 판정이 필요한 이유.
- **버그**: 외부 엣지에 `quote`가 있으면 `row_names[dst]` KeyError(`consultant_interview.py:536`) — `convert_interview`는 "예외를 던지지 않는다"고 선언했지만 던지고, 라우터에 try/except가 없어 dry-run이 500. 실측 재현(change-control 샘플 + 외부 엣지 quote).

## 4. JSON 계약 — `0.5-bpm-interface-draft`

### 4.1 추가 키 `externalTasks[]` (선택)

```jsonc
"schema_version": "0.5-bpm-interface-draft",
"externalTasks": [
  {
    "refId": "ext-oos-intake",        // 필수. 파일 안 유일, rows[].taskId와 충돌 금지. 엣지 src/dst에 taskId 자리 그대로
    "l5": { "nodeCode": "20-02-01-01-01", "label": "시험 일탈·OOS 관리" },  // nodeCode 필수, label 참고용
    "l6": "OOS 접수 및 초동 평가",    // 이름 힌트. 모르면 null
    "note": "완료 후 일탈이 열리면 QA로 넘긴다고 함"   // 선택 → 홈 L5 노트(kind=external)
  }
]
```

- 어댑터는 `schema_version` 접두 `0.4`/`0.5` 둘 다 수용(0.4 파일은 지금과 동일 동작). 0.3은 계속 거부.
- `externalTasks` 자체가 없으면 0.4 동작.

### 4.2 엣지 끝점 해석 순서

`relations.edges[].src|dst` 문자열을 **① `rows[].taskId` → ② `externalTasks[].refId` → ③ 둘 다 아님** 순으로 해석한다.

| 끝점 조합 | 처리 |
|---|---|
| 둘 다 ① | 지금과 동일(홈 L6 사이 엣지) |
| ① + ② | 외부 엣지 — 선언된 ref(`declared=True`) |
| ① + ③ | 외부 엣지 — **기존 dev 동작 유지**: 원문 코드를 "실 taskId를 아는 외부 L6"로 보고 플레이스홀더(`declared=False`) + warning `edge endpoint {code} not declared in externalTasks - kept as taskId placeholder` |
| ②/③ + ②/③ | 드롭(지금과 동일 — 타 L5끼리의 엣지는 이 캔버스 것이 아님) |
| src == dst 인 외부 | 드롭 + warning (외부 자기 반복은 무의미) |

`relations.entry.taskId`는 rows만 허용(외부가 진입이면 엣지로 표현). refId를 가리키면 지금의 "not in rows - ignored" 경고 그대로.

### 4.3 외부 L5 계보 — `framework.categories`에 그대로

새 shape 없음. 외부 L5의 **L1~L5 체인을 `framework.categories`에 이어서** 적는다. 홈 `l5.nodeCode`에서 `parent`를 따라 올라간 집합 = 홈 체인, 그 밖 = **외부 계보**.

- 홈 체인: 지금과 동일(부모 누락·레벨 불일치 → 파일 error, upsert는 개명 포함).
- 외부 계보: 임포터가 **없으면 생성, 있으면 4필드(name·level·parent·sort_order) 불변**. 부모가 파일에 없어 체인이 끊긴 외부 카테고리는 파일 error가 아니라 **warning 후 제외**(nodeCode는 DB 기존 체계로 해석).
- `externalTasks[].l5.nodeCode`가 파일 categories에 없으면 warning `external L5 {code} not in framework.categories - resolved against existing framework`. DB에도 없으면 엔진이 warning `external L5 {code} not found - placeholder without origin` + `placeholder_category_id=NULL`(제목에 이름 힌트 보존).
- 파일 간 병합(라우터 `merged_cats`): 같은 code가 한 파일에선 홈, 다른 파일에선 외부면 **홈 주장 우선**.

### 4.4 검증 심각도 (파일 error = 그 파일 전체 제외, 기존 규약)

| 대상 | error | warning |
|---|---|---|
| `externalTasks` | 리스트가 아님 | — |
| `externalTasks[i]` | 객체 아님 · `refId` 누락/중복/`rows[].taskId`와 충돌 · `l5.nodeCode` 누락 | 미지 키 · 엣지에서 한 번도 참조되지 않음(노드 안 만듦) |
| `externalTasks[i].l5` | 객체 아님 | `nodeCode`가 파일 categories에 없음 |
| `externalTasks[i].l6` | — | 200자 초과 절단(기존 `_truncate` 규약) |

### 4.5 플레이스홀더 제목

`title = l6` (있으면) / `"(L6 unspecified) {L5명}"` (`l6: null`, L5명 = 파일 categories 이름 → `l5.label` → nodeCode 순 폴백) / 미선언 코드는 코드 그대로(기존).

### 4.6 컨설턴트 전달 문서

파일 내부 `_readme` 대신 **`docs/samples/interview-json-0.5.md`**(한글)에 계약을 쓴다 — 0.4 대비 델타, `externalTasks` 필드표, 심각도, 엣지 끝점 해석, 외부 계보 규칙, 샘플 7종 시나리오 매트릭스, 후차 해소 시연 수순. 샘플의 `_readme`는 이 문서를 가리키는 한 줄만 남긴다.

### 4.7 카테고리 관리자 `framework.categories[].admins` (2026-09-08 추가)

- 어느 레벨 행에나 `admins: ["login", …]`. 어댑터가 공백·중복 정리, **외부 계보 행의 admins는 경고 후 비운다**.
- 엔진 `upsert_categories(..., actor, report, known_logins)`: 홈 체인 행만 `CategoryPermission(user)` **add-only**(기존 사람·그룹 권한자 불변, 제거는 설정 화면 PUT만 — 사용자 결정 2026-09-08). 리포트 `category admin '{login}' added @ {code}`(action `category`) / 미등재 `... not found in employees @ {code}`(warning, 그래도 추가).
- FE 리포트: kind `category-admin`/`category-admin-unknown` → 다이제스트·외부 참조 표 아래 "카테고리 관리자(파일에서)" 목록(코드·로그인·상태). L5 코드 행이라도 캔버스 문구로 새지 않도록 L5 매칭 전에 가로챈다.

## 5. 어댑터 규칙 (`scripts/consultant_interview.py`)

- 상수: `_TOP_KEYS += {"externalTasks"}`, `_EXTERNAL_TASK_KEYS = {"refId","l5","l6","note"}`, `_EXTERNAL_L5_KEYS = {"nodeCode","label"}`.
- 신설 `@dataclass ExternalRef(code: str, l5_code: str | None, name: str, note: str, declared: bool)`.
- `InterviewLinkage.external_codes: list[str]` → **`external_refs: dict[str, ExternalRef]`**(선언/등장 순서 유지). 미선언 원문 코드도 `ExternalRef(code, None, "", "", declared=False)`로 같은 dict에 → 엔진 분기 하나.
- `InterviewLinkage.home_code`는 기존 `category_code`가 담당(계보 키 네임스페이스에 사용).
- `CanonicalCategory.external: bool = False`(`scripts/consultant_canonical.py`) — pydantic 기본값이라 다른 호출부 무영향. 어댑터가 홈 체인 계산 후 나머지에 `True`. 끊긴 외부 체인은 `parse_categories` 전에 걸러낸다(홈 체인 검증은 `parse_categories` 그대로).
- `quote` 노트 제목 `display_names = row_names ∪ {ref.code: ref.name or ref.code}` → KeyError 픽스(회귀 테스트).
- `note` → `InterviewNote(kind="external", title=f"{name or refId} ({L5명})", text=note, category_code=홈 L5)`.

## 6. 엔진 규칙 (`scripts/import_consultant.py` · `app/lineage.py`)

### 6.1 카테고리 upsert
`cat.external`이면 없을 때만 생성(전달값), 있으면 불변. `ids[cat.code]`는 양쪽 다 채운다(외부 자식의 `parent_id` 해석). BFS 레벨 재계산 그대로.

### 6.2 이름 정규화 · 계보 키 (`app/lineage.py`)
- `normalize_task_name(s) = "".join(unicodedata.normalize("NFKC", s).casefold().split())` — "정확 일치" = 이 값이 같음. FE 미러 불필요(FE엔 현재 유사도 랭킹 없음).
- `external_ref_lineage_key(home_code, ref_id) = make_node_id("__ext__", f"{home_code}|{ref_id}")` — 선언 ref. 파일 안 유일한 refId를 홈 L5로 네임스페이스해 파일 간 충돌 차단.
- 미선언 코드는 기존 `external_lineage_key(code)` 그대로(taskId 기반 전 캔버스 해소 유지).

### 6.3 `apply_interview_linkage` — ref마다
1. `l5_id`: `ref.l5_code`를 `process_categories.code`로 조회(이번 upsert 결과 포함). 없으면 warning + `placeholder_category_id=NULL`.
2. **선해소**: `ref.name`이 있고 그 L5(`category_id==l5_id`, `deleted_at IS NULL`)에 정규화 이름 일치 맵이 **정확히 1개** → 실 노드로 직결(기존 `external_present` 경로, 계보 키는 6.2). **2개 이상** → 연결 안 함 + warning `external task '{title}' @ {l5_code}: {n} maps share the name - left as placeholder`. 0개 → 플레이스홀더.
3. 플레이스홀더 노드: `title`(4.5) · `placeholder_category_id=l5_id` · `source_node_id=계보 키` · `linked_map_id=NULL` · `follow_latest=True`. 리포트 `placeholder for external task '{title}' @ {l5_code} (map not delivered yet)`.
4. 재임포트: 계보 노드가 있고 **미연결**이면 `title`·`placeholder_category_id`를 이번 값으로 갱신(이름 수정 전파, 중복 노드 없음). 이미 연결됐으면 불변(F1 규약).
5. `_node_of(key)`: 선언 ref는 6.2 키로, 미선언은 기존 키로 `lineage_nodes` 조회 → `node_by_map` 폴백(선해소 직결 노드).
6. 배치: 외부/플레이스홀더 신규 노드는 기존처럼 `layout_nodes`에 포함(F2 규약).

### 6.4 `resolve_external_placeholders` — 이름 경로 추가 (pass 1 직후)
기존 taskId 키 경로 유지 + 이번 전달분 맵들의 `category_id` 집합 C를 잡고, `placeholder_category_id ∈ C`인 미연결 SP 노드(라이브 draft 캔버스 전체)를 스캔한다. 노드마다 그 카테고리의 **라이브 맵 중 정규화 이름 일치가 정확히 1개**면 연결(`linked_map_id`·`title=맵명`·`follow_latest=True`·**`placeholder_category_id=NULL`** — FE 연결·슬롯 채움과 같은 소거 규약). 2개 이상이면 warning만. 체크아웃 규약 동일(타인 체크아웃 캔버스 스킵+warning). UI에서 손으로 만든 플레이스홀더(`placeholder_category_id` NULL)는 대상 아님. 리포트 `resolved {n} external placeholder node(s)`(기존 문구 유지).

### 6.5 리포트 행 (엔진 `report.add`) → FE kind

| detail | kind |
|---|---|
| `placeholder for external task '{title}' @ {l5_code} (map not delivered yet)` | `external-placeholder` |
| `linked external task '{title}' @ {l5_code} -> map {id}` | `external-linked` |
| `external task '{title}' @ {l5_code}: {n} maps share the name - left as placeholder` | `external-ambiguous` |
| `external L5 {code} not found - placeholder without origin` | `external-l5-unknown` |
| `resolved {n} external placeholder node(s)` | `external-resolved` |

### 6.6 후차 해소 알림 `fw_external_linked` (2026-09-08 추가)

`resolve_external_placeholders`가 자리표를 이으면(taskId 경로·이름 경로 모두) **캔버스 단위 1건** — `_notify_external_linked`. 수신자 = 캔버스 L5의 직속·조상 관리자(`get_category_admin_logins(direct_only=False)`, 그룹은 멤버 확장) ∪ 연결된 맵이 속한 실제 L5의 직속·조상 관리자, 실행자 제외. `map_id`=캔버스(인박스 "관련 맵" 버튼이 캔버스로), payload `map_name`(제목)·`actor/actor_name`·`from_name`(전달 L5 이름, 칩)·`to_name`(연결 L6 이름 최대 3개 +n, 칩)·`count`·`origin_category_ids`·`linked_map_ids`. FE: `KNOWN_TYPES`·`notifLabel/notifBody.fw_external_linked`(en/ko)·아이콘 Link2·`{count}` 변수. 같은 세션이라 dry-run rollback에 함께 사라진다. 사용자 요청 "가시성·시인성": 제목=캔버스 이름, 본문은 인물 필+굵은 칩 2개+개수로 한 문장.

배선 검토(2026-09-08) 반영: ① 인박스 카테고리 필터 `getNotificationCategory` — `fw_external*` → `subprocess`(미매핑이면 "전체"에서만 보이고 카테고리 통계에서 빠짐). ② 감사 기록 — 해소된 draft마다 `VersionEvent(event_type="external_linked", note=연결된 제목들)`(슬롯 채움의 `slot_changed`와 같은 자리), 타임라인 라벨 `home.verEvent.external_linked`·Link2 아이콘·액센트 틴트 칩. ③ 확정 게이트는 확정 시점에 `validate_confirm_readiness`를 다시 돌리므로 자리표가 남은 캔버스는 확정 요청 자체가 막히고, 해소 뒤 재시도로 통과한다 — 대기 중 요청과의 경합 없음.

## 7. FE (`frontend/src/lib/interview-report.ts`)

`DetailKind` 5종 추가 + `PATTERNS` 정규식 + 다이제스트 라벨(en/ko, subject·숫자 보존). 그 외 FE 무변경(배지·연결 다이얼로그·게이트는 `placeholder_category_id` 소비 중). 완료 시 캔버스 실브라우저 캡처 1장(외부 L6 2종 색 + 플레이스홀더 배지) 공유.

## 8. 샘플 세트 — 7파일 전면 재작성

폴더·파일명 유지(스모크 10종·문서가 경로를 박아둠). 예외 `brr-large-l5.json` → `brr-l5.json`(코드 참조 없음, 330KB 생성물 폐기, README 갱신).

**공통 규격**: L6 ≥4행 · 각 L6의 L7 그래프에 `decision`+`branch(exclusive)` ≥1·`loop` ≥1 · 파일 안 어딘가에 `parallel` 게이트웨이·`bypass`·`variant: exception`·`handoff` 각 ≥1 · 최상위 L6 흐름도 `branch`+`loop` 포함 · 부서 경로·오너 표기는 현행 값 유지 · 의도된 warning은 아래 매트릭스의 1건만.

| 파일 (L5) | 외부 참조 | 시나리오 |
|---|---|---|
| A `calibration-l5.json` 5행 | utility "정제수 일상 점검 수행" | 있음·정확 일치 → 같은 배치면 직결, 따로 올리면 후차 해소 |
| | EAM `19-01-05-01-01` "작업지시 발행 및 배정"(계보 동봉) | 없음 → 빈 카테고리 생성 + 출처 있는 플레이스홀더 |
| A `utility-l5.json` 4행 | calibration "교정 결과 보고" | 있음·근사 불일치(실명 "…및 이력 등록") → 출처 있는 플레이스홀더 → 수동 연결 |
| | EAM, `l6: null`(계보 동봉) | 없음 → `(L6 unspecified) …` 플레이스홀더 |
| B `qc-raw-material-l5.json` 4행 | qa-deviation "OOS 접수 및 초동 평가" | 있음·정확 일치 |
| | 구매 `22-01-01-01-01` "입고 검수"(**계보 없음**) | 없음·DB에도 없음 → origin unknown warning, `placeholder_category_id` NULL(**세트 중 유일한 의도 경고**) |
| B `qc-finished-product-l5.json` 4행 | brr "검토 접수 및 배치 편성" | 있음·정확 일치 |
| | qa-deviation "OOS접수 및 초동평가" | 있음·공백만 다름 → 정규화로 일치 |
| B `qa-deviation-oos-l5.json` 4행 | change-control "변경요청 접수" | 있음·근사 불일치 → 수동 연결 |
| | CAPA `20-02-01-02-01`, `l6: null`(계보 동봉) | 없음 → 빈 카테고리 + unnamed 플레이스홀더 |
| B `change-control-l5.json` 4행(전 기능 시연) | qa-deviation "일탈 종결 및 효과성 평가" + brr "적합 판정서 발행 및 통보" | 있음·정확 일치 2건 → 한 캔버스에 외부 L6 2종(L5 색 2개) |
| B `brr-l5.json` 6행 | qc-finished-product "시험 성적서 발행 및 출하 승인" + qa-deviation "일탈 종결 및 효과성 평가" | 있음·정확 일치 |

**스모크 앵커 보존(A)**: L5 계보/코드/이름 · `smp-cal-task-0001` "교정 준비"의 액션1 입출력("그 주 작업지시"→"대상 계측기와 측정 범위") · `Owner role: 교정 담당자` · `Artifact role: deliverable` · 시작조건 "교정 주기 도래…" · `annual_count 52` · 오너 로그인 · 노트 "표준기 관리대장은 아직 엑셀" · 유틸리티 첫 행 오너 null. **카운트 기대값**(Created 4 · Notes 8/17 · 노트 행 4/6)은 새 샘플 실측으로 `pw-smoke-interview-import`·`-field-promotion`·`-import-followups`·`-node-modal-tiles`·`-framework-slot`에서 갱신.

**샘플 고정 테스트** `backend/tests/test_samples_0_5.py`: 7파일 `convert_interview` error 0 · 의도 warning 화이트리스트(파일별) · 행수 ≥4 · 행마다 loop·branch ≥1 · externalTasks 전부 참조됨 · B 세트 API 임포트로 직결/플레이스홀더/origin-unknown 카운트 검증.

## 9. 문서

- 신규 `docs/samples/interview-json-0.5.md`(4.6) · `docs/qa/interview-import-field-map.md`(`externalTasks`·외부 계보 행) · `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md §8` 각주(백로그 해소 → 이 문서) · `docs/design/2026-09-01-interview-import-v04-result.md §4` 항목 반영 · `docs/README.md` 샘플 2줄 · `PROGRESS.md`.

## 10. 테스트 계획

- **어댑터(pytest)**: externalTasks 파싱·심각도 표 전항 · 끝점 해석 순서 3조합 · 미선언 폴백 warning · 외부 자기 반복 드롭 · 외부 계보 판정(홈 체인 밖 `external=True`) · 끊긴 외부 체인 warning+제외 · 홈 체인 끊김은 error 유지 · `l6:null` 제목 · quote KeyError 회귀 · 0.4 파일 무변경 동작.
- **엔진(pytest)**: 외부 카테고리 create-only(존재 시 4필드 불변) · 선해소 1건 직결 / 2건 모호 플레이스홀더 · 플레이스홀더 `title`·`placeholder_category_id`·계보 키 · origin unknown · 재임포트 미연결 갱신/연결 후 불변 · 이름 경로 후차 해소(`placeholder_category_id` 소거·엣지 유지) · 모호 시 미연결 · 체크아웃 스킵 · 기존 taskId 경로 회귀(기존 테스트 유지) · 라우터 병합 홈 우선.
- **샘플**: `test_samples_0_5.py`(8절).
- **FE(vitest)**: PATTERNS 5종 분류 + 라벨.
- **게이트**: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" pytest` 전체 · ruff · vitest · tsc · lint · 스모크 5종(카운트 갱신 후).

## 11. 파급·알려진 한계

- 이름 매칭은 **같은 L5 안 + 정확히 1개**일 때만 — 같은 이름 2개는 사람이 고른다(오연결 0 우선).
- UI에서 맵을 **개명**해 뒤늦게 이름이 일치하게 된 경우는 자동 연결 안 됨(해소 스캔은 전달분이 건드린 카테고리만) — 연결 다이얼로그로 수동.
- 외부 계보로 생성된 카테고리 이름은 홈 파일이 전달될 때까지 첫 전달값이 남는다(create-only의 의도된 결과).
- `l6: null` 플레이스홀더는 이름이 없어 자동 해소 대상이 아니다 — 항상 수동.
- 스키마/DDL 변경 없음 → FE/BE 동시 배포 제약 없음(리포트 kind만 FE 미배포 시 "other"로 표시).

## 12. 구현 앵커 (dev 91f9f5f6)

| 항목 | 위치 |
|---|---|
| 외부 판정·external_codes | `backend/scripts/consultant_interview.py:98-121`(dataclass), `:513-528`(엣지 루프), `:536`(KeyError) |
| 상수 | `consultant_interview.py:25-58` |
| `convert_interview` categories/l5 검증 | `consultant_interview.py:588-608` |
| `CanonicalCategory`·`parse_categories` | `backend/scripts/consultant_canonical.py:19-23`, `:127-154` |
| `upsert_categories` | `backend/scripts/import_consultant.py:301-344` |
| `resolve_external_placeholders` · 호출 | `import_consultant.py:712`, `:935` |
| `apply_interview_linkage` 외부/플레이스홀더 | `import_consultant.py` `lookup_codes`/`external_present`/`missing_placeholders`/`_node_of` |
| 계보 키 | `backend/app/lineage.py` |
| 라우터 병합 | `backend/app/routers/categories.py:720-800` |
| 리포트 분류 | `frontend/src/lib/interview-report.ts:166-194` |
| 기존 플레이스홀더 테스트(회귀 기준) | `backend/tests/test_interview_import_api.py:238-300, 295-580` |

## 13. 구현 트랙 분해 (커밋 단위)

1. **T1 계약+어댑터** — 상수·`ExternalRef`·`external_refs`·외부 계보 마킹·끊긴 체인 처리·KeyError 픽스·`CanonicalCategory.external` + 어댑터 테스트.
2. **T2 엔진** — `lineage.py` 헬퍼·create-only upsert·라우터 홈 우선 병합·선해소/플레이스홀더/재임포트·이름 경로 해소·리포트 행 + 엔진 테스트.
3. **T3 샘플** — 7파일 재작성·`brr-l5.json` 개명·`test_samples_0_5.py`·스모크 카운트 갱신·`docs/README.md`.
4. **T4 FE 리포트+문서** — PATTERNS/라벨/vitest·`interview-json-0.5.md`·field-map·스펙 각주·v04-result·PROGRESS.
5. 게이트 전체 그린 → 캡처 공유 → **`git push -u origin feat/interview-external-refs`**(dev 머지 안 함).
