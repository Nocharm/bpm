# 인터뷰 결과 JSON 0.4 임포트 — 설계

2026-09-01 브레인스토밍 확정본. 전달 스키마가 `0.3-bpm-interface-draft` → `0.4-bpm-interface-draft`로
올라가며 **흐름 그래프(relations)가 전달물에 처음 실린다**. `2026-08-18-interview-import-design.md`가
"협의 확장 포인트"로 남겨둔 앵커(분기 시작/합류) 키가 바로 이것이다 — 그 문서의 §3 매핑을 이 문서가 개정한다.

## 0. 0.4 델타

| 변경 | 내용 |
|---|---|
| **최상위 `relations`** | L6(=rows) 사이 흐름 그래프. `entry{taskId,triggerType,label,quote}` + `edges[]`(src/dst=`rows[].taskId`) |
| **`rows[].relations`** | 그 L6 내부 L7(=actions) 흐름 그래프. `edges[]`(src/dst=`actions[].seq`) |
| **`edge.kind` 4종** | `seq`(순차) · `branch`(조건분기) · `loop`(재수행) · `bypass`(건너뜀) |
| **`edge.gateway`** | branch에만: `exclusive`(택일) / `parallel`(병행) |
| **`edge.condition`·`quote`** | 분기 조건 문장 + 근거 발화 원문 |
| `labelSource` | `human-confirmed`(확정 표 검수본) |
| 수치 병기 필드 | `total_time_min`·`touch_time_min`·`annual_count`·`headcount`·`fte`가 **JSON 숫자로 채워짐** |
| 거버넌스 필드 | `owner`·`approvers`·`department`가 실값으로 채워짐 |
| `summary` | `l6_edge_total`·`l7_edge_total` 추가 |

**seq는 참조키가 됐다** — `rows[].relations.edges[].src/dst`가 `actions[].seq`를 가리키므로 row 안에서
유일해야 한다. 0.3의 "중복 seq = 병렬 분기/합류" 관례는 폐기된다.

## 1. 버전 게이트 — 0.4 전용

`schema_version`이 `0.4`로 시작하지 않으면 **file error**(파일 통째 스킵). 0.3 하위호환은 두지 않는다
(사용자 결정 2026-09-01) — 0.3 파일은 흐름 정보가 없어 수용해도 조용히 일직선 맵이 되고, 그 사실이
경고 한 줄에 묻힌다. 저장소 샘플 5종은 전부 0.4로 변환한다(기존 seq 체인을 `kind:"seq"` 엣지로 명시화).

## 2. L7 흐름 — `rows[].relations.edges` → 맵 그래프

| 입력 | 처리 |
|---|---|
| `src`/`dst`(seq 정수) | 노드코드 `a{seq:02d}`로 해석. **중복 seq = file error**(참조 대상 모호). 미존재 seq 참조 = warning + 그 엣지만 드롭 |
| `label` + `condition` | `Edge.label`에 줄바꿈으로 합쳐 적재(엣지 라벨은 Alt/Shift+Enter 다중행 지원). 200자 초과 시 절단+경고 |
| `kind: "branch"` | **src 노드를 `decision`으로 승격.** `actions[].kind`(action/handoff/decision)는 분기 여부를 신뢰할 수 없다 — 엣지가 진실이다. 승격 시 리포트 행 |
| `kind: "loop"` | 엣지로 그린다. **Start 배선 판정(`has_in`)에서만 제외** — 안 그러면 루프 대상 노드가 in-edge를 갖게 돼 Start가 붕 뜬다. End 판정(`has_out`)에는 포함(보완→재작성처럼 loop가 유일 출구인 노드가 있다) |
| `kind: "seq"` / `"bypass"` | 일반 엣지. 미지 kind는 warning 후 seq 취급 |
| `gateway` | 노드 타입 승격 판단엔 `branch`만 쓴다. `exclusive`는 decision 승격으로, `parallel`은 다중 out-edge로 이미 시각 표현된다 — 값 자체는 아래 노트에 부기 |
| `quote` | quote가 있는 엣지만 **map_notes 1건**(kind=`flow`, title=`"작업지시 확인 → 표준기 선정"`, text=quote + `kind/gateway · condition` 부기) |
| `relations` 누락 | warning + seq 순서 체인 폴백 |

## 3. L6 흐름 — 최상위 `relations` → L5 연계 캔버스

`import_delivery` 직후 L5 카테고리의 연계 캔버스를 **생성 또는 보강**한다. 규약은 기존
`open_linkage_map`(design 2026-08-28 §5)과 동일 — **추가만, 삭제·이동 없음**.

- 캔버스 없음 → 생성(`mode="framework"`, draft `Linkage`) + 이번 전달분 L6 맵 SP 노드 + `relations.edges` 엣지
- 캔버스 있음 → 없는 SP 노드·없는 엣지만 추가. 기존 노드 좌표·라벨·기존 엣지 불변.
  draft가 **타인 체크아웃 중이면 보강 스킵** + 리포트 경고(체크아웃 규약)
- SP 노드 `annual_count`/`fte` — **비어 있으면 채우고, 값이 있으면 안 덮고 경고**. 사용자 직접 편집
  필드라 `gmp`와 같은 관례(design 2026-08-19 §1.3). 0.4에서 처음 값이 실리는 두 필드의 유일한 착지면이다
- 게시하지 않고 draft 유지. dry-run은 세션 롤백으로 자동 미저장

**`relations.entry`는 Start 노드가 될 수 없다** — `validate_framework_canvas`(`app/subprocess.py`)가
연계 캔버스에 `subprocess`/`decision`/`end`만 허용하고 `start`를 막는다. 대신:
- entry의 taskId가 가리키는 SP 노드를 **첫 자리(sort_order 0, 그리드 좌상단)** 에 놓고
- entry 자체는 **L5 스코프 map_notes 1건**(kind=`entry`, title=`Entry (timer)`, text=label+quote)으로 보존

**L6 레벨 `branch`는 노드 타입을 바꾸지 않는다** — src가 subprocess(=L6 맵)라 decision으로 승격할 수 없다.
분기는 다중 out-edge + 엣지 라벨(조건)로만 표현된다.

## 4. 값 정규화 2건 (0.4에서 처음 값이 차며 새로 문제되는 지점)

- **JSON 숫자 → 파라미터 문자열**: `str(1e-05)` = `"1e-05"`는 `NUMERIC_RE`(`^\d+(\.\d+)?$`)에 걸려
  엔진이 조용히 소거한다. 고정소수 포맷터로 변환한다(`0.03` → `"0.03"`, `52` → `"52"`).
- **department 세그먼트 공백**: 전달 예시의 `"Quality Center/ QC Department/…"`처럼 `/` 뒤 공백이 있으면
  조직경로 known 집합과 안 맞아 **오너 org로 조용히 폴백**된다. 세그먼트별 strip 후 재결합한다.

## 5. 미소비 유지 (의도적)

`summary` · `labelSource` · `_readme` · `tasks[]`의 `evidence`/`revision`/`state`/`doc`/`seq` —
2026-08-18 설계의 "리포트 카운트만" 방침 그대로. 미지 키는 dry-run warning으로 표면화된다.

## 6. 결정 로그

| 결정 | 내용 |
|---|---|
| 하위호환 | 0.3 거부(file error). 저장소 샘플 5종은 0.4로 변환 |
| 중복 seq | file error — relations의 참조 대상이 모호해진다 |
| 분기 판정 | `actions[].kind`가 아니라 **엣지 kind=branch**가 진실 → src 노드 decision 승격 |
| 엣지 라벨 | `label` + `condition`을 줄바꿈으로 한 칸에(캔버스 2줄). quote는 노트로 |
| loop 배선 | `has_in`에서만 제외, `has_out`에는 포함 |
| entry | Start 노드 불가(framework 캔버스 검증) → SP 노드 첫 자리 + L5 노트 |
| annual_count/fte | 연계 캔버스 SP 노드가 착지면. 빈 값이면 채우고 기존값은 안 덮음 |
