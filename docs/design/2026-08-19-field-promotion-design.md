# 인터뷰 필드 승격 — 노드/SP 파라미터 확장 + 폴백 컬럼 설계 (2026-08-19)

인터뷰 JSON 임포트 1차([2026-08-18-interview-import-design.md](2026-08-18-interview-import-design.md))에서 텍스트 직렬화(노드 설명 KV·맵 `[Interview]` 섹션)로만 보존하던 키들을 **고유 필드로 승격**한다. 실파일 1차 임포트 검증 후 사용자 결정(2026-08-19).

## 0. 기조 · 확정 결정

- **기조: 파라미터는 일반 노드와 SP(맵 지정)가 차이 없음** — 신규 필드는 노드 ↔ `sp_*` 1:1 대칭으로 신설한다.
- **대표 필드 + 폴백 컬럼 쌍**: 구조화 값(대표)과 인터뷰 원문(폴백)을 분리. 임포트는 폴백에 원문을 넣고, 대표 필드는 이관 후 검토 작업에서 사람이 선정/입력한다. UI는 폴백이 있으면 호버 아이콘 → 툴팁(원문 + 수정 + 대표값 입력).
- 확정(AskUserQuestion 2026-08-19):
  1. **touch_time = 7번째 공용 파라미터** — `PARAM_FIELDS`에 추가, 노드+SP 전 표면(일괄편집·CSV·Excel·Σ) 확장. duration과 동일 H.MM 계약.
  2. **시스템 라이브러리화는 별도 트랙** — 이번엔 `system_fallback` 컬럼+원문 유지까지만. 카탈로그 테이블·에디터 셀렉트·기타 입력 폴백 창은 후속.
  3. **dataForm은 노드 컬럼+참고 배지**, **input/output은 복수 등록 가능**(개행 구분 리스트).
  4. **GMP 유효성 필드는 맵(SP)만** — 3값 `direct` / `indirect` / `non_gmp` (+미분류=빈 값).
- rule/screen/quote는 노드 설명 잔류(현행). ownerRole은 실오너 거버넌스 전달 전까지 `[Interview]` 텍스트 유지.

## 1. 데이터 모델

### 1.1 Node 신규 컬럼 (7개)

| 컬럼 | 타입 | 의미 | 임포트 소스 |
|---|---|---|---|
| `input` | Text | 입력물 — **개행 구분 복수**(UI는 리스트 add/remove) | `actions[].input` (str 1건) |
| `output` | Text | 산출물 — 〃 | `actions[].output` |
| `start_condition` | Text | 시작 조건 | (액션엔 없음 — 수동 입력용) |
| `end_condition` | Text | 종료 조건 | 〃 |
| `data_form` | String(50) | 입출력 형식 참고 배지 (structured/document/tacit — 자유값 허용) | `actions[].dataForm` |
| `system_fallback` | String(200) | 시스템 원문(라이브러리화 전 검토 원천) | `actions[].system` (system에도 원문 그대로 — 표시 무회귀) |
| `touch_time` | String(50) | **7번째 파라미터** — 실작업시간 H.MM | (액션엔 없음) |

### 1.2 ProcessMap 신규 컬럼 (9개)

| 컬럼 | 타입 | 의미 | 임포트 소스 |
|---|---|---|---|
| `sp_start_condition` | Text | 시작 조건 | `fields.start_condition` |
| `sp_end_condition` | Text | 종료 조건 | `fields.done_criteria`(+`done_criterial` 이중 수용) |
| `sp_gmp` | String(20) | GMP 분류 — `direct`\|`indirect`\|`non_gmp`\|null(미분류) | **임포트는 비움** — 검토에서 선정 |
| `sp_gmp_fallback` | Text | GMP 원문 | `fields.gmp` |
| `sp_frequency_fallback` | String(200) | 빈도 원문 — 대표는 **이 맵을 참조하는 SP 노드의 `annual_count`**(연간 건수는 부모 맥락 값이라 노드 행 저장, design 2026-07-13 §2.2 — 맵 컬럼 신설 안 함) | `fields.frequency` |
| `sp_total_time_fallback` | String(200) | 총시간 원문 — 대표는 기존 `sp_duration`(total_time_min→H.MM 현행 유지) | `fields.total_time` |
| `sp_touch_time` | String(50) | **7번째 파라미터** — H.MM | `fields.touch_time_min`(분 int → `format_minutes_hmm`) |
| `sp_touch_time_fallback` | String(200) | 실작업시간 원문 | `fields.touch_time` |
| `sp_system_fallback` | String(200) | 시스템 원문 | `fields.systems` (`sp_system`에도 원문) |

- `sp_input`/`sp_output`: 기존 Text 재사용 — 복수(개행) 시맨틱만 부여.
- 전 컬럼 `db.py` `_ADDED_COLUMNS` 등록(운영 자동 ALTER — 리셋 불가).
- 비대칭 예외(기조의 의도적 예외): `data_form`·`system_fallback`의 맵 측은 `sp_system_fallback`만(맵 dataForm은 소스 없음 — YAGNI), GMP는 맵만(확정 4), 맵 폴백 4종은 노드 측 소스 없음.

### 1.3 GMP 값 계약

- 저장값: `direct` / `indirect` / `non_gmp` / null. 표시: `GMP Direct` / `GMP Indirect` / `Non-GMP` / `—`.
- 검증: SP 지정 스키마(`SubprocessDesignationIn`류) validator에서 3값+빈 값 외 422. 폴백은 자유 텍스트.

## 2. touch_time — 7번째 파라미터 확장 지점

duration 파이프라인의 완전 미러. **한 지점이라도 빠지면 소거/드리프트** — 전수 체크리스트:

| 지점 | 내용 |
|---|---|
| `frontend/src/lib/params.ts` | `PARAM_FIELDS`에 `touch_time` 추가(단일 소스), `SP_PARAM_FIELDS`(SP 노드 read-only 상속 4→5필드), `getEditableParamFields` |
| 정규화 | FE `lib/duration.ts` ↔ BE `app/duration.py` — duration과 동일 H.MM 함수 재사용(신규 구현 없음), `NodeIn`/`SubprocessDesignationIn` 경계 소거(`""`) 대상에 추가 |
| BE | `models.py`(Node.touch_time·ProcessMap.sp_touch_time) · `schemas.py` · `graph.py` upsert · `versions.py` clone_graph |
| CSV | `csv-import.ts` NODE_DEFAULTS·mergeNode pick·행 변환 + `dropUneditableParams`(SP 노드 상속 강제) — 왕복은 duration과 동일 규칙 |
| AI | `buildGraphFromAiProposal`·page.tsx `aiNodeToGraphNode`·`resolveAiParamPatch` |
| UI | 인스펙터 Parameters·일괄편집 모달(6→7필드)·SP 지정 패널·Σ 합산(duration 로직 미러: 게시본 직합+SP 연쇄)·표시형(편집 중만 `1.30`, 그 외 `formatDurationHm`) |
| Excel/CSV export | 파라미터 컬럼에 touch_time 추가(1안·2안 WBS 포함) |

## 3. 나머지 신규 노드 필드 스레딩 (input/output/start·end_condition/data_form/system_fallback)

노드 속성 추가 체크리스트(CLAUDE.md) 전수 적용: `models.py` → `schemas.NodeIn`(길이 상한 방어) → `graph.py` upsert → `versions.py` clone_graph → `csv-import.ts`(NODE_DEFAULTS·mergeNode pick·행 변환 — input/output은 셀 내 개행 왕복, `escapeCsvCell` 기존 지원) → AI 변환 2곳.

- **SP 노드 상속(제안)**: subprocess 노드의 `input`/`output`/`start_condition`/`end_condition`/`data_form`은 링크 맵 `sp_*` 값을 **read-only 상속** — 파라미터 상속과 동일하게 3표면(`getEditableParamFields`형 필드 게이트·`dropUneditableParams`·`resolveAiParamPatch`) 강제. 로컬 편집을 허용하면 링크 맵과 드리프트하므로 파라미터 기조와 동일 취급. `system_fallback`은 상속 제외(노드 고유 원문).
- 폴백 컬럼(`system_fallback` 및 맵 폴백 4종)은 **CSV/Excel/AI 표면에서 제외** — 임포트·검토 전용 원문이며 편집 경로는 폴백 툴팁 하나로 좁힌다(다표면 동기화 비용 회피). 단 clone_graph·시그니처에는 포함(버전 보존).

## 4. 어댑터/임포트 변경 (`consultant_interview.py` · `import_consultant.py`)

### 4.1 착지 이동

| JSON 키 | 이전(1차) | 이후 |
|---|---|---|
| `actions[].input` / `output` | 노드 설명 `Input:`/`Output:` 줄 | `node.input` / `node.output` (줄 제거). 어댑터는 str 수용(현 전달 예상), list가 오면 개행 join — 복수 시맨틱과 일치 |
| `actions[].dataForm` | 설명 `Data form:` 줄 | `node.data_form` (줄 제거) |
| `actions[].system` | `node.system` + 설명 `System:` 줄 | `node.system` + `node.system_fallback` (설명 줄 제거 — 이중 기록 해소) |
| `actions[].rule` / `screen` / `quote` | 설명 줄 | 유지 |
| `fields.start_condition` / `done_criteria` | `[Interview]` 줄 | `sp_start_condition` / `sp_end_condition` |
| `fields.gmp` | `[Interview]` 줄 | `sp_gmp_fallback` (sp_gmp는 비움) |
| `fields.frequency` / `total_time` / `touch_time` | `[Interview]` 줄 | 각 `*_fallback` |
| `fields.touch_time_min` | `[Interview]` 줄 | `sp_touch_time` (H.MM 변환, 숫자 아니면 warning+폴백만) |
| `fields.systems` | `[Interview]` 줄 | `sp_system` + `sp_system_fallback` |
| `fields.total_time_min` → duration | 현행 | 유지 |

- 노드 설명 = `name` + `Rule:`/`Screen:`/`Quote:` + `Variant:`/`Kind:` 줄만.
- `[Interview]` 섹션 = `Owner role:`만 잔류(없으면 섹션 생략) — 승격 키는 직렬화에서 제거해 드리프트 방지.
- IR 확장: `CanonicalNode`에 input/output/start_condition/end_condition/data_form/system_fallback/touch_time, `CanonicalMap`/`CanonicalParams`에 맵 측 대응 — 컬럼폭 상한 파서 방어(기존 패턴).
- **`_graph_signature`·`fields_changed`에 신규 필드 전부 포함** — 재임포트 1회로 기존 맵에 백필(새 버전 감지). 무변경 재임포트 no-op 불변식 유지.
- (소규모 동봉) `openItems[]` → `map_notes`(kind=`open_item`, L5 스코프), `tasks[].note` → `map_notes`(kind=`task_note`, 맵 스코프) — 현재 조용히 유실되는 두 키 보존. 검토에서 제외 가능.

## 5. UI

### 5.1 필드 표시 (Phase B)

- **노드 인스펙터**: Input/Output — 리스트형(행 add/remove, 저장은 개행 join) + `data_form` 참고 배지(Input/Output 라벨 옆, 값 있을 때만). Start/End condition — 접힘 텍스트 2필드. touch_time — Parameters 그룹에 합류.
- **맵 표면(구현 확정)**: 읽기 = 상세 카드 IO 블록 확장(gmp 배지·조건·touch_time, 값 있을 때만 — 비인터뷰 맵 노이즈 없음) / 편집 = **설정 > 상세 탭 `ProcessFieldsCard`(오너 전용, PATCH process-fields)** — gmp 셀렉트(4상태)·조건·duration/touch_time·system + 폴백 힌트 5종. 에디터 인스펙터 맵 탭은 밀도상 제외(상세 카드·설정이 담당).
- 상세 카드/맵 탭의 기존 `[Interview]` 표시는 자연 축소(설명 텍스트라 코드 변경 없음).

### 5.2 폴백 툴팁 — `FallbackHint` 공용 컴포넌트 (Phase C)

- 노출 조건: 해당 대표 필드의 폴백 컬럼이 비어 있지 않을 때, 필드 라벨 옆 Lucide 16px 아이콘.
- 클릭(호버는 프리뷰만 — 버튼 있는 팝오버는 클릭 고정, body portal + fixed 기존 컨벤션): 원문 텍스트 + **수정**(폴백 텍스트 편집 — 맵 편집 권한자) + **적용**(대표 필드 입력 프리필/포커스).
- 적용 표면: 노드 system(`system_fallback`) · 맵 gmp/duration(total_time)/touch_time/sp_system. **frequency는 SP 노드 측** — 링크 맵에 `sp_frequency_fallback`이 있으면 그 맵을 참조하는 SP 노드 인스펙터의 `annual_count` 옆에 힌트 노출(부모 맥락 값이라 노드에서 입력), 맵 SP 패널에서는 원문 참고 표시만.
- 폴백 수정 API: 노드는 graph PUT 페이로드에 포함(폴백도 NodeIn 필드), 맵은 SP 지정 PATCH에 포함.

## 6. 페이즈 · 머지 전략

| 페이즈 | 내용 | 게이트 |
|---|---|---|
| **A** | BE 스키마+IR+어댑터+엔진 시그니처+테스트 | pytest·ruff |
| **B** | FE 전 표면 — NodeIn 에코 스레딩(CSV·AI·인스펙터·일괄편집·Σ·Excel), GMP 셀렉트, IO 리스트 UI | vitest·tsc·lint·build·스모크 |
| **C** | FallbackHint 툴팁(수정/적용) | 스모크 |
| 별도 트랙 | 시스템 라이브러리(카탈로그·에디터 셀렉트·기타 폴백 창) | — |

⚠️ **A+B는 같은 릴리스로 묶어야 한다** — BE만 배포하고 재임포트하면 FE가 모르는 필드를 에디터 graph PUT이 소거한다(무효 에코 랜드마인, CLAUDE.md). 서버 재임포트(백필)는 A+B 배포 후에만. C는 후행 가능.

## 7. 미결 · 백로그

- `sp_gmp`의 노드 레벨 확장(활동별 GMP) — 보류(확정 4).
- input/output 항목별 dataForm(현재 노드당 1값) — 필요 시 JSON 직렬화로 승격하는 확장 경로만 남김.
- 시스템 라이브러리 트랙: 카탈로그 테이블 + `system`/`sp_system`의 카탈로그 참조화 + `*_fallback` 대조 검토 화면.
- `touch_time` Σ 합산의 SP 연쇄 검증(듀레이션 미러 확인).
- 노드 요약(정보 수정) 모달에 IO/조건 편집 노출 — 1차는 인스펙터 Details 카드만.
- ownerRole 승격은 실오너 거버넌스 전달 개시와 함께 재논의.
