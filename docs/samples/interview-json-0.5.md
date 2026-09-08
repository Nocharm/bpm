# 인터뷰 결과 JSON `0.5-bpm-interface-draft` — 외부 L6 참조 계약

컨설턴트 전달용. 0.4(흐름 그래프)와의 델타만 다룬다 — 나머지 키는 0.4와 동일하며 `docs/qa/interview-import-field-map.md`가 착지를 설명한다.
설계: `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`.

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

## 3. 엣지 끝점 해석

`relations.edges[].src|dst`는 **① `rows[].taskId` → ② `externalTasks[].refId` → ③ 둘 다 아님** 순으로 해석한다.

- ①+① 홈 L6 사이 엣지(0.4와 동일) · ①+② 외부 엣지(선언) · ①+③ **외부 엣지(미선언)** — 그 문자열을 "실 taskId를 아는 외부 L6"로 보고 플레이스홀더로 두되 경고를 낸다(가급적 ②로 선언할 것) · ②/③+②/③ 제외(이 L5의 캔버스 것이 아님).
- `relations.entry.taskId`는 rows만. 외부에서 들어오는 시작은 `ext → 첫 L6` 엣지로 표현한다.

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

모든 샘플은 L5당 L6 ≥4, 각 L6의 L7 흐름에 `decision`+`branch(exclusive)`·`loop`, 파일마다 `parallel` 게이트웨이·`bypass`·`variant: exception`·`handoff`를 포함한다(`backend/tests/test_samples_0_5.py`가 고정).

**후차 해소 시연**: 설정 > Framework > Interview import에 `framework-linkage-dummy/` 중 `qa-deviation-oos-l5.json`을 **빼고** 4파일 apply → 각 캔버스에 OOS·일탈 종결 플레이스홀더(출처 배지) → `qa-deviation-oos-l5.json`만 apply → 리포트에 `resolved 4 external placeholder node(s)`, 캔버스의 플레이스홀더가 실 노드(외부 L6 색)로 바뀐다. `입고 검수`(출처 없음)와 `변경요청 접수`(근사 불일치)는 남아 Connect 배너로 잇는다.
