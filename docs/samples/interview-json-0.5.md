# 인터뷰 결과 JSON `0.5-bpm-interface-draft` — 외부 L6 참조 계약

컨설턴트 전달용. 0.4(흐름 그래프)와의 델타만 다룬다 — 나머지 키는 0.4와 동일하며 `docs/qa/interview-import-field-map.md`가 착지를 설명한다.
설계: `2026-09-07-interview-external-refs-design.md`(폐기 — git history).
`actions[].input`/`output`은 문자열 배열이 정본이다(한 항목 = 한 줄, 문자열 하나도 하위호환으로 받는다) — 앞 활동의 output 항목을 다음 활동 input에 같은 표기로 다시 쓰면 캔버스에서 IO가 자동으로 연결된다. 활동의 input은 그 활동이 받는 것, output은 그 활동이 만들어 내는 것이라 같은 활동의 양쪽에 같은 항목을 적지 않는다(어댑터가 warning으로 잡는다). L6 전체의 입력물·산출물은 `fields.input_data`/`output_data`에 두고, 활동에는 첫 활동 input·마지막 활동 output으로만 넣는다.

## 1. 왜 필요한가

전달은 L5 단위인데, L6 흐름(`relations.edges`)에 **다른 L5의 L6**가 등장한다. 그 L6는 아직 인터뷰 전이라 `taskId`가 없고, 알 수 있는 것은 **소속 L5 코드**와 **대략적인 이름**(없을 수도, 실제와 다를 수도)이다. 0.5는 이를 `externalTasks[]`로 선언하고 엣지가 `refId`로 가리키게 한다. BPM은 그 자리를 **플레이스홀더 노드**(출처 L5 배지)로 두고, 그 L5가 전달되면 **같은 L5 안에서 이름이 정확히 일치하는 맵이 1개**일 때만 자동 연결한다. 나머지는 화면에서 사람이 연결한다.

## 2. 추가 키 — `externalTasks[]` (선택)

```jsonc
"schema_version": "0.5-bpm-interface-draft",
"externalTasks": [
  {
    "refId": "ext-oos-intake",        // 필수. 파일 안 유일, rows[].taskId와 겹치면 안 됨. 엣지 src/dst에 taskId 자리 그대로 사용
    "l5": { "nodeCode": "20-02-01-01-01", "label": "시험 일탈·OOS 관리" },  // nodeCode 필수, label은 참고용
    "l6": "OOS 접수 및 초동 평가",    // 이름 힌트. 모르면 null
    "note": "완료 후 일탈이 열리면 QA로 넘긴다고 함"   // 선택 — 홈 L5 노트로 저장
  }
]
```

| 키 | 필수 | 설명 |
|---|---|---|
| `refId` | ✅ | 파일 안 유일 식별자. 접두 `ext-` 권장. 재전달 때도 **같은 refId를 유지**해야 이름 수정이 같은 노드에 반영된다 |
| `l5.nodeCode` | ✅ | 외부 L6가 속한 L5의 업무체계 코드 |
| `l5.label` | — | 사람이 읽는 L5 이름(참고용) |
| `l6` | — | 외부 L6 이름 힌트. `null` 허용(L5만 아는 경우) → BPM 제목 `"(L6 unspecified) {L5명}"` |
| `note` | — | 참조에 대한 메모 → BPM 홈 L5 노트(kind `external`) |

## 2-1. 카테고리 관리자 — `framework.categories[].admins` (선택)

```jsonc
"framework": { "categories": [
  { "code": "21", "name": "Quality System", "level": 1, "parent": null, "admins": ["qs.head"] },
  { "code": "21-03-02-01-01", "name": "공정 변경관리 실행", "level": 5, "parent": "21-03-02-01", "admins": ["jihoon.park"] }
]}
```

| 규칙 | 내용 |
|---|---|
| 어디에 | **어느 레벨(L1~L5) 행에나** 넣을 수 있다. L5가 주 용도지만 상위 카테고리 관리자도 같은 자리에 적는다 |
| 값 | 로그인 id 배열. 공백·중복은 정리된다 |
| 적용 범위 | **홈 체인 행만**. 옆 L5의 계보(외부 행)에 적힌 admins는 경고 후 무시된다 — 남의 L5 권한은 그 L5 파일이 가져와야 한다 |
| 정책 | **추가만, 제거 없음.** 파일의 로그인을 그 카테고리 관리자로 더하고, 이미 있는 관리자(사람·그룹)는 그대로 둔다. 빼는 건 설정 › Framework › 관리자 화면에서 |
| 리포트 | `category admin 'login' added @ 코드` 행(추가된 것만) · 직원 목록에 없는 로그인은 `not found in employees` 경고(그래도 추가됨 — 나중에 직원 동기화되면 유효) |

## 2-2. 행 필드 — `rows[].fields`

키는 15개다(AI 캠페인 조립기 `contracts.ROW_FIELD_KEYS`와 같은 목록). 값이 있는 것만 적는다.

`start_condition` · `input_data` · `output_data` · `done_criteria` · `systems` · `frequency` · `total_time` · `total_time_min` · `touch_time` · `touch_time_min` · `annual_count` · `headcount` · `fte` · `gmp` · `artifact_role`

- `total_time_min`/`touch_time_min`은 분 단위 정수(1시간 30분이면 90)로 회당 소요·실작업 시간의 대표값이다. `total_time`/`touch_time`은 답의 원문 표현 그대로다.
- `input_data`/`output_data`는 개행으로 구분한 문자열 또는 문자열 배열(한 항목 = 한 줄)을 받는다. 배열은 개행으로 합쳐 저장한다.

## 2-3. 재전달·유지 행 (2026-10-19)

- **활동 맞추기.** 재전달이 직전 게시본 값을 이을 때 활동은 `seq`가 아니라 **같은 `label`끼리** 먼저 맞추고, 이름만 바뀐 활동은 같은 자리(seq)끼리 맞춘다(유형이 같을 때만). 이름과 자리가 둘 다 바뀐 활동은 새 활동이라 오너 값을 잇지 않는다. 활동을 끼우거나 빼도 값이 한 칸씩 밀리지 않는다.
- **`rows[].keep: true`** — AI 캠페인 조립기가 "유지" 카드에만 다는 내부 표시. 임포터는 그 맵의 그래프·지정값·거버넌스를 쓰지 않고 `unchanged (kept)`로 보고한다. 없는 맵에 달면 그 행은 error로 빠진다. 외부 AI 프롬프트에는 싣지 않는다.
- **기존 체계 보호.** 파일이 이미 있는 분류를 다른 상위 아래로 옮기거나(`framework.categories[].parent` 불일치) 다른 L5 소속 맵의 taskId를 `rows`에 담으면 그 파일 전체가 error로 빠진다. 분류 이름만 다르면 warning과 함께 파일의 이름이 적용된다.

## 2-4. L5 판단·끝 노드 — `relations.nodes[]` (선택, 2026-11-12)

최상위 `relations`에 이름 있는 판단(◇)과 끝 노드를 선언하고, 엣지가 그 `id`를 끝점으로 가리킨다. 없으면 종전과 같다.

```jsonc
"relations": {
  "entry": { "taskId": "...", "label": "..." },
  "nodes": [
    { "id": "D1",   "kind": "decision", "label": "산출물 도출 지연 여부" },
    { "id": "END1", "kind": "end",      "label": "산출물 고객사 전달 완료" }
  ],
  "edges": [
    { "src": "task-01", "dst": "D1", "kind": "seq" },
    { "src": "D1", "dst": "task-02", "kind": "branch", "label": "예" },
    { "src": "D1", "dst": "END1", "kind": "branch", "label": "아니오" }
  ]
}
```

| 규칙 | 내용 |
|---|---|
| `id` | 필수. 파일 안 유일하고 `rows[].taskId`·`externalTasks[].refId`와 겹치면 안 된다(error). 재전달 때 **같은 id를 유지**해야 같은 노드로 본다(계보 키가 L5 코드 + id에서 나온다) |
| `kind` | `decision` 또는 `end`만(그 외 error). 시작 노드는 연계 캔버스에 둘 수 없다 |
| `label` | 노드 이름(200자). 판단의 이름이 비면 warning과 함께 자동 이름(`{선행 L6 이름} 결과`, 선행 L6가 없으면 id)을 쓴다. 끝은 비워도 된다 |
| 선언 판단의 출구 | 그 노드에서 바로 나간다. 자동 분기 노드를 또 끼우지 않고, 병렬 표시도 하지 않는다(판단은 택일) |
| 허용 | 들어오는 연결이 없는 판단(시작 바로 뒤 판단), 판단 → 판단 |
| 제외(warning) | 끝 노드에서 나가는 연결, 선언 노드의 자기 연결, 엣지가 가리키지 않는 선언 |
| 선언 노드 없는 팬아웃 | 한 L6에서 갈래가 둘 이상 나가면 지금처럼 `{L6 이름} 결과` 분기 노드를 자동으로 세운다 |
| 끝 이름 | 캔버스 안에서 유니크해야 저장된다. 겹치면 뒤 노드에 번호를 붙이고 warning(`end node '…' renamed to '… 2'`) |
| 대표 끝 | 저장 규칙 그대로다. 캔버스에 끝이 없었으면 **선언 순서 첫 끝**이 대표, 이미 끝이 있으면 건드리지 않는다 |
| 재전달 | 추가만. 이미 있는 노드의 이름·위치는 바꾸지 않는다 |
| `kind: loop` 엣지 | 되돌아가는 연결로 보고 배치 순서(랭크)에서 뺀다 |

`relations.entry.taskId`는 여전히 rows만 가리킨다. 이 키는 최상위 `relations` 전용이다(`rows[].relations`에 쓰면 모르는 키 warning).

## 2-5. To-Be 작업본 — `rows[].tobe` (선택, **임포트 전용**, 2026-11-12)

같은 L6 맵에서 As-Is는 게시본, To-Be는 그 위 진행 중 버전(Draft)이 된다. 비교 화면의 버전 선택으로 둘을 나란히 보고, 결재·게시하면 To-Be를 채택한 것이 된다. 외부 AI 프롬프트와 AI 캠페인은 이 키를 내보내지 않는다.

```jsonc
"rows": [{
  "taskId": "...", "l6": "...", "actions": [ ... ],
  "tobe": {
    "label": "To-Be · A 보조",          // 버전 라벨, 100자 이하(넘으면 잘림 + warning)
    "actions": [                          // rows[].actions와 같은 스키마 + actor
      { "seq": 1, "label": "일정 모니터링 Agent", "name": "<상세>", "kind": "action", "actor": "ai" },
      { "seq": 2, "label": "지연 여부 최종 판단", "name": "<원문>", "kind": "action", "actor": "human" }
    ],
    "relations": { "edges": [ ... ] }     // rows[].relations와 같은 스키마. 생략하면 seq 순 일렬 연결
  }
}]
```

| 규칙 | 내용 |
|---|---|
| `actions` | 필수(누락·배열 아님은 error). 빈 배열 `[]`은 시작 → 끝만 있는 그래프(업무 삭제 재설계) |
| `actor` | `ai` 또는 `human`(생략 = human, 모르는 값은 warning 후 human). **tobe 안에서만 유효**하다. `ai`는 노드 역할 `AI Agent`(역할 목록에 있으면 정식 표기, 없으면 그대로 저장) + 보라(violet) 색, `human`은 역할·부서를 비운다 |
| 그래프 | As-Is와 같은 규칙으로 만든다(택일 분기 승격·자동 분기 노드·출력 규칙·자동 배치) |
| 착지 | 그 행의 As-Is 처리(게시 + 편집용 Draft)가 끝난 뒤, Draft가 **손대지 않은 상태**(점유자 없음 + 게시본과 전 필드 동일)일 때만 그래프와 라벨을 To-Be로 바꾼다. 리포트 `to-be draft written`. 진행 중 버전이 없으면 새로 만든다 |
| 건너뜀 | 누가 쓰는 Draft·결재 중 버전이 있으면 건드리지 않고 warning `to-be skipped - draft in use`. 진행 중 버전을 하나 더 만들지 않는다 |
| 재전달 | 같은 To-Be가 이미 깔려 있으면 조용히 넘어간다. **tobe만 바뀐 재전달은 기존 To-Be Draft를 덮지 않고** 같은 warning을 낸다(바꾸려면 Draft를 지우거나 화면에서 고친다). As-Is가 바뀌면 새 게시본이 되고 To-Be Draft는 그대로 남는다 |
| 변경 감지 | tobe는 As-Is 변경 감지(`unchanged`/`updated`)에 들어가지 않는다 |
| 제약 | To-Be가 있는 맵은 그동안 As-Is용 새 Draft를 열 수 없다(맵당 진행 중 버전 1개) |
| 비교 짝짓기 | To-Be 활동은 게시본 활동과 재전달 규칙(같은 `label` 먼저, 다음 같은 자리·같은 유형)으로 짝을 지어 비교 화면에 변경·추가·삭제로 보인다 |
| 그 밖 | `keep: true` 행의 tobe는 무시(warning). tobe 엣지의 `quote`는 노트로 싣지 않는다 |

## 3. 엣지 끝점 해석

`relations.edges[].src|dst`는 **① `rows[].taskId` → ② `externalTasks[].refId` → ②′ `relations.nodes[].id` → ③ 어느 것도 아님** 순으로 해석한다. ①과 ②′는 이 L5 캔버스의 노드다.

- ①+① 홈 L6 사이 엣지(0.4와 동일) · ①/②′+②′ 선언 판단·끝과의 엣지 · ①/②′+② 외부 엣지(선언) · ①/②′+③ **외부 엣지(미선언)** — 그 문자열을 "실 taskId를 아는 외부 L6"로 보고 플레이스홀더로 두되 경고를 낸다(가급적 ②로 선언할 것) · ②/③+②/③ 제외(이 L5의 캔버스 것이 아님).
- `relations.entry.taskId`는 rows만. 외부에서 들어오는 시작은 `ext → 첫 L6` 엣지로 표현한다.

### 출구당 연결 1개 (2026-10-01)

한 활동(L6 흐름) 또는 한 L6(최상위 흐름)에서 나가는 연결은 하나다. 갈래가 둘 이상이면 `kind: branch`로 적고, 택일은 `gateway: exclusive` + `condition`(L6 흐름에선 출발 활동이 `decision`), 동시 진행은 `gateway: parallel`. 이 규칙을 어긴 전달물(되돌아가기 + 다음 단계, 순차 여러 개)은 BPM 어댑터가 출발 활동 뒤에 분기 노드를 자동으로 세워(되돌아가기가 섞이면 "반복 여부(자동 생성됨)", 아니면 "{활동명} 결과") 경고와 함께 받아들인다. 동시 진행 갈래는 분기 노드 없이 출발 활동의 출구를 병렬로 켠다.

동시 진행 갈래와 되돌아가기·건너뛰기를 **같은 활동에서** 함께 내보내면 분기 노드가 그 갈래들을 택일로 나누고 병행 표시는 버려진다(경고 `parallel edges to ... dropped`). 동시 진행을 지키려면 되돌아가기·건너뛰기는 다른 활동(예: 판정 활동)에서 나가게 적는다.

**하위프로세스(SP) 끝점.** 최상위 `relations.edges`는 L5 연계 캔버스의 SP 노드 사이 엣지가 되며, 출구는 대표 끝(`__primary__`), 들어오는 문은 좌측 `in`으로 정해진다. `gateway: parallel` 출발도 대표 끝만 병렬로 켠다(`parallel_outputs=["__primary__"]`). 엣지에 끝 키 개념이 없어 **보조 끝으로의 연결과 SP 끝별 병렬은 0.5로 표현할 수 없다**. 캔버스 편집(우클릭) 전용이고, 재전달 보강은 추가만 하므로 캔버스에서 바꾼 끝 키·들어오는 변은 유지된다. 역변환(기존 L6 학습)도 대표 끝만 되돌린다. 끝 키를 실을지는 다음 버전 후보다.

## 4. 외부 L5의 계보

외부 L5의 L1~L5 체인을 **`framework.categories`에 그대로 이어서** 넣는다(새 형식 없음). BPM은 홈 `l5.nodeCode`의 조상 체인 밖 항목을 외부 계보로 판정해 **없을 때만 생성하고, 있으면 이름·부모를 절대 바꾸지 않는다**. 체인이 끊긴 외부 항목(부모가 파일에 없음)은 경고 후 제외하고, `nodeCode`는 BPM의 기존 체계에서 찾는다. 계보를 안 넣어도 되지만, BPM에도 그 L5가 없으면 플레이스홀더는 출처 없이(제목만) 놓인다.

## 5. 검증 심각도

| 대상 | error(파일 전체 제외) | warning |
|---|---|---|
| `externalTasks` | 리스트가 아님 | — |
| `externalTasks[i]` | 객체 아님 · `refId` 누락/중복/`taskId` 충돌 · `l5` 또는 `nodeCode` 누락 | 미지 키 · 엣지에서 참조되지 않음(무시) |
| `externalTasks[i].l5` | — | `nodeCode`가 파일 categories에 없음(기존 체계로 해석) |
| `externalTasks[i].l6` | — | 200자 초과 절단 |
| `framework.categories[]` 외부 항목 | — | 부모가 파일에 없음(제외, 기존 체계로 해석) |
| `relations.nodes` | 리스트가 아님 | — |
| `relations.nodes[i]` | 객체 아님 · `id` 누락/중복/`taskId`·`refId` 충돌 · `kind`가 decision·end가 아님 | 미지 키 · 엣지에서 참조되지 않음(무시) · 판단 `label` 누락(자동 이름) · 200자 초과 절단 |
| `rows[i].tobe` | 객체 아님 · `actions` 누락/배열 아님 · 활동 `seq` 중복 | 미지 키 · `label` 누락(`To-Be`)/100자 초과 절단 · 모르는 `actor` · keep 행 |

## 6. BPM 처리 요약

1. 외부 L5의 라이브 맵 중 **정규화 이름**(대소문자·전각/반각·공백 무시)이 같은 것이 정확히 1개 → 즉시 연결(외부 L6 색). 2개 이상 → 연결 안 함 + 경고. 0개 → 플레이스홀더(제목=`l6` 또는 `(L6 unspecified) L5명`, 출처 배지=L5).
2. 그 L5가 나중에 전달되면 같은 규칙으로 플레이스홀더를 자동 연결한다(엣지·좌표 유지).
3. 자동 연결이 안 된 플레이스홀더는 캔버스에서 **Connect** 배너 → 연결 다이얼로그(출처 L5 자동 펼침)로 사람이 연결한다. 미해소 플레이스홀더가 있으면 그 L5는 확정(confirmed)으로 갈 수 없다.
4. 재전달 시 같은 `refId`의 미연결 플레이스홀더는 제목·출처가 새 값으로 갱신된다(중복 노드 없음). 이미 연결된 노드는 건드리지 않는다.
5. dry-run 리포트 문구: `linked external task '…' @ L5코드 -> map N`(직결) · `placeholder for external task '…' @ L5코드 (map not delivered yet)` · `external task '…' @ L5코드: N maps share the name - left as placeholder`(모호) · `external L5 코드 not found - placeholder without origin`(출처 없음) · `resolved N external placeholder node(s)`(후차 해소). 리포트 화면은 이 문구들을 **"외부 L6 참조" 표**(외부 L6 · 출처 L5 · 캔버스 · 상태)로 모아 보여 준다 — 조치 필요(출처 없음·확인 필요·자리표)가 먼저, 연결됨이 뒤.
6. **알림**: 나중에 온 파일이 자리표를 자동 연결하면 알림 `fw_external_linked`가 간다 — 수신자는 자리표를 가진 L5의 관리자(직속+상위) **와** 실제로 연결된 L6가 속한 L5의 관리자(직속+상위), 임포트 실행자는 제외. 제목=캔버스 이름, 본문에 전달된 L5·연결된 L6·개수, "관련 맵" 버튼은 그 캔버스로. dry-run은 알림을 만들지 않는다.

## 7. 샘플 7종 — 시나리오 매트릭스

| 파일 (L5) | 외부 참조 | 시나리오 |
|---|---|---|
| `consultant-interview-sample/calibration-l5.json` | utility "정제수 일상 점검 수행" | 세트 안 존재·정확 일치 → 같은 배치면 직결, 따로 올리면 후차 해소 |
| | EAM `19-01-05-01-01` "작업지시 발행 및 배정"(계보 동봉) | 세트 밖 → 빈 카테고리 생성 + 출처 있는 플레이스홀더 |
| `consultant-interview-sample/utility-l5.json` | calibration "교정 결과 보고" | 근사 불일치(실명 "…및 이력 등록") → 플레이스홀더 → 수동 연결 |
| | EAM `l6: null` | `(L6 unspecified) …` 플레이스홀더 |
| `framework-linkage-dummy/qc-raw-material-l5.json` | qa-deviation "OOS 접수 및 초동 평가" | 정확 일치 |
| | 구매 `22-01-01-01-01` "입고 검수"(**계보 없음**) | BPM에도 없음 → 경고, 출처 없는 플레이스홀더(세트 중 유일한 의도 경고) |
| `framework-linkage-dummy/qc-finished-product-l5.json` | brr "검토 접수 및 배치 편성" · qa-deviation "OOS접수 및 초동평가" | 정확 일치 · 공백만 다름(정규화 일치) |
| `framework-linkage-dummy/qa-deviation-oos-l5.json` | change-control "변경요청 접수" · CAPA `l6: null`(계보 동봉) | 근사 불일치 → 수동 · unnamed 플레이스홀더 |
| `framework-linkage-dummy/change-control-l5.json` | qa-deviation "일탈 종결 및 효과성 평가" · brr "적합 판정서 발행 및 통보" | 한 캔버스에 외부 L6 2종(L5 색 2개) |
| `framework-linkage-dummy/brr-l5.json` | qc-finished-product "시험 성적서 발행 및 출하 승인" · qa-deviation "일탈 종결 및 효과성 평가" | 정확 일치 |

모든 샘플은 L5당 L6 ≥4, 각 L6의 L7 흐름에 `decision`+`branch(exclusive)`·`loop`, 파일마다 `parallel` 게이트웨이(분기 노드 없이 병렬 출구로 착지)·`bypass`·`variant: exception`·`handoff`를 포함하고, `actions[].input`/`output`은 문자열 배열로 적는다(`backend/tests/test_samples_0_5.py`가 고정).

**후차 해소 시연**: 설정 > Framework > Interview import에 `framework-linkage-dummy/` 중 `qa-deviation-oos-l5.json`을 **빼고** 4파일 apply → 각 캔버스에 OOS·일탈 종결 플레이스홀더(출처 배지) → `qa-deviation-oos-l5.json`만 apply → 리포트에 `resolved 4 external placeholder node(s)`, 캔버스의 플레이스홀더가 실 노드(외부 L6 색)로 바뀐다. `입고 검수`(출처 없음)와 `변경요청 접수`(근사 불일치)는 남아 Connect 배너로 잇는다.
