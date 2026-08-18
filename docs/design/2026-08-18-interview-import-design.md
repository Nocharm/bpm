# 컨설턴트 인터뷰 결과 JSON 임포트 (Phase 3 어댑터) — 설계

2026-08-18 브레인스토밍 확정본. PwC 협의 결과, 실제 전달물은 canonical 양식이 아니라
**인터뷰 결과 JSON**(schema_version `0.3-bpm-interface-draft`)으로 확정됨.
`2026-08-08-consultant-hierarchy-design.md` §7의 Phase 3(실스키마 어댑터)를 이 문서가 구체화한다.

## 0. 범위 (1차)

- 인터뷰 JSON → canonical 변환 어댑터 + 기존 `import_delivery` 엔진 재사용.
- **카테고리 업서트 + 맵 생성이 한 번에**, **여러 JSON 파일 일괄 임포트**(웹 UI).
- **키 검증(dry-run) 결과를 프론트에서 확인** — 실파일은 사내 자료라 저장소 반입 불가,
  손타이핑 스키마 기준으로 구현하고 실파일과의 차이는 dry-run 리포트로 흡수한다.
- 신규 `map_notes` 테이블(예외 규칙·VOC) + 맵에서 읽기전용 표시. 등록/편집 UI는 추후.
- CLI 확장 없음(웹 임포트가 기본 경로). 1차 완료 후 실 서버에 배포해 실파일 dry-run 검증.

## 1. 아키텍처

```
인터뷰 JSON 파일들 (설정 Framework 탭, 다중 업로드)
  → POST /api/categories/import-interview  (sysadmin, dry-run 기본)
    → [신규] backend/scripts/consultant_interview.py    ← DB 무관 순수 어댑터
        파일별: 키 검증(unknown/missing/형식) → Canonical 변환 + map_notes 추출
    → [기존] import_delivery() — 카테고리 업서트·맵 멱등 업서트·게시·리포트
```

- 파일 1개 = L5 1건(`l5.nodeCode` + 조상 체인 L1~L5).
- 여러 파일의 categories는 병합 업서트(코드 재전달 간 불변). 같은 code 다른 name이면 경고.
- **error 파일은 스킵하고 나머지 파일은 진행** — 파일별 독립, 리포트에 명시.

## 2. 입력 스키마 (손타이핑 기준 — 실파일 대조는 dry-run으로)

최상위: `_readme` `schema_version` `labelSource` `framework.categories[]` `l5{label,nodeCode}`
`rows[]` `tasks[]` `summary` `openItems[]` `sideNotes[]`.

- `rows[]`: `taskId`(맵 슬롯키) `unitId` `l6`(맵 이름) `owner`(현재 null, 추후 login_id)
  `ownerRole` `approvers[]` `department`(현재 null) `fields{}` `actions[]`.
- `fields`: `start_condition` `input_data` `output_data` `done_criteria`(전달문 표기는
  `done_criterial` — 실파일 대조 필요) `systems` `total_time` `total_time_min` `touch_time`
  `touch_time_min` `frequency` `annual_count` `headcount` `fte` `gmp` `artifact_role`.
- `actions[]`: `seq` `label` `name` `kind`(action|handoff|decision) `variant` `rule`
  `input` `output` `system` `screen` `dataForm` `quote`.
- `tasks[]`: `id`(=taskId) `name` `state` `ownerRole` `exceptions[]{name,rule,evidence}`
  `startCondition` `endCondition` `evidence[]` 등.
- `sideNotes[]`: `kind`(voc|rule_basis|…) `text` `unitId`(null=L5 전역).

**키 검증 규칙**: 알려진 키 화이트리스트 기반. unknown key → warning(경로 표기, 예:
`rows[2].actions[3].done_criterial`), 필수 키 누락/형식 불일치 → error. `schema_version`이
`0.3` 프리픽스가 아니면 warning.

## 3. 매핑 규칙

| 인터뷰 JSON | BPM |
|---|---|
| `framework.categories[]` | 카테고리 업서트. `l5.nodeCode`가 categories에 없으면 파일 error |
| `rows[]` 1건 | 맵 1개 — `consultant_code=taskId`, `name=l6`, `category=l5.nodeCode` |
| `rows[].fields` | 맵 `description` `[Interview]` 섹션에 key-value 직렬화(빈 값 줄 생략, `ownerRole` 포함) |
| `actions[]` | 노드 — `title=label`, `description=name` + `Input:/Output:/System:/Screen:/Data form:/Rule:/Quote:` 줄 직렬화. `system`은 노드 `system` 컬럼에도 |
| `kind` | `decision`→decision 노드, `action`·`handoff`→process. handoff는 `Kind: handoff` 줄로 보존 |
| seq | 그룹 k 전원 → 그룹 k+1 전원 엣지. 유일 seq=순차 체인, **중복 seq=병렬 분기/합류**. Start/End는 엔진 시드·자동 배선 |
| `*_min` 숫자(추후 전달) | `total_time_min`→`duration`(분→H.MM), `annual_count`/`headcount`/`fte` 숫자면 맵 params. 매핑 코드는 1차에 포함(현재 null이라 no-op). 원문 텍스트는 노트에 항상 잔존 — 이중 보존 |
| `tasks[]` | `taskId` 조인으로 `exceptions`만 소비. start/end 조건은 `rows.fields` 우선(중복) |
| `tasks[].exceptions` | `map_notes` kind=`exception` (title=name, text=rule). evidence 제외 |
| `sideNotes[]` | `map_notes` — `unitId` 매칭 시 해당 맵, null이면 L5 스코프. kind 그대로 |
| `evidence`·`summary`·`openItems`·`_readme` | 미저장(리포트에 카운트만) |

- 노드 code(계보 키) = `a{seq:02d}`(중복 seq는 `-2`,`-3` 접미). **한계**: 재전달에서 seq가
  재배치되면 계보가 끊겨 diff가 수정 대신 추가/삭제로 보임 — 수용.
- **확장 포인트(미구현)**: 병렬 분기 후 명시 점프 키("있으면 해당 seq로") — 키 이름 협의 시 추가.
- decision 분기 라벨 정보는 현재 전달물에 없음 — 순차 연결 + 노드 타입만 decision(1차안 확정).

## 4. canonical·엔진 확장

- `CanonicalNode.description`, `CanonicalMap.description` 추가. **길이 캡 없음**(Text 컬럼,
  sp_input 교훈 — 자유 텍스트 길이 캡 금지).
- `CanonicalMap.owner`를 optional로 완화 → 엔진이 **실행자(sysadmin) 폴백 + 경고 행**.
  신규 컬럼 `ProcessMap.consultant_owner_pending`(Bool, `db.py` `_ADDED_COLUMNS` 등록)을 True로 마킹.
- **거버넌스 불변 원칙의 명시적 예외**: `consultant_owner_pending=True`인 맵만, 재전달에
  실오너(login_id)가 오면 오너·권한행·승인자를 갱신하고 플래그 해제.
  (`approval-owner-skip-policy`와 무관 — 승인 워크플로가 아니라 임포트 거버넌스 시딩.)
- 변경 감지(`fields_changed`)에 맵/노드 description 포함 — 무변경 재임포트는 여전히 no-op
  (updated_at bump 방지 게이트 유지).

## 5. `map_notes` 테이블 (신규)

```
id(PK) · map_id(FK, null) · node_id(String(50), null — 추후 활동별 등록용)
· category_code(String(100), null — L5 전역 VOC용) · kind(String(50): exception|voc|rule_basis|…)
· title(String(300), null) · text(Text) · source(String(100): 'consultant-import' 또는 추후 login_id)
· delivery_label(String(100), null) · created_at
```

- 멱등: 재임포트 시 해당 맵/L5 스코프의 `source='consultant-import'` 행 삭제 후 재삽입(전달 단위 replace).
- API: `GET /api/maps/{map_id}/notes` — 맵 읽기 권한 준수.
- 신규 테이블은 startup `create_all`이 생성(ALTER 불요).
- **확장 설계 의도**: 추후 일반맵에서 사용자 등록/편집(활동별 예외, 의견 교환)을 같은 테이블·
  같은 표시 표면에 얹는다 — node_id·source 컬럼이 그 자리.

## 6. 프론트

1. **임포트 UI**: 설정 Framework 탭 "Interview import" 서브섹션 — 다중 `.json` 선택 →
   Dry-run: **파일별 아코디언 리포트**(error/warning/unknown key 경로 + 생성/갱신 예정 카운트)
   → Apply. 기존 canonical 임포트 섹션과 병행 유지.
2. **Notes 섹션(읽기전용)**: 맵 상세 카드 + 에디터 인스펙터 Map 탭 — kind 뱃지 + title + text
   리스트. 데이터 없으면 섹션 숨김.

## 7. 검증

- BE pytest: 어댑터(키 검증·매핑·병렬 seq·KV 직렬화·오너 폴백·notes 멱등·거버넌스 예외 갱신),
  임포트 엔드포인트. 픽스처는 손타이핑 스키마 기반 JSON.
- FE: vitest(파서·리포트·Notes)·tsc·lint·build. 실브라우저 스모크(임포트→홈 트리→맵 Notes).
- 실파일 검증: 사용자가 실 서버(또는 로컬)에서 dry-run — unknown key 리포트가 어댑터 수정
  목록이 된다.
- **1차 구현 검증(2026-08-18)**: BE pytest 1071·ruff 0 / FE vitest 646·tsc 0·lint 0 error·build OK /
  실브라우저 스모크 `frontend/scripts/pw-smoke-interview-import.mjs` 15/15(다중 파일 dry-run 파일
  리포트→apply→재-dry-run 멱등·홈 Framework 트리 노출·맵 상세 [Interview] 설명·Notes 섹션).
  에디터 인스펙터 Notes는 동일 컴포넌트 공유라 스모크 생략 — 서버 배포 후 스팟 체크.
  합성 샘플: `docs/samples/consultant-interview-sample/`.

## 8. 결정 로그

| 결정 | 내용 |
|---|---|
| 전달물 | canonical 아님 — 인터뷰 결과 JSON(파일=L5 1건). canonical은 내부 IR로 강등 |
| 병렬 | seq 중복=병렬(현재는 유일 보장이라 사실상 체인). 점프 키는 확장 포인트만 |
| decision | 분기 라벨 없음 → 순차 연결 + 노드 타입만 |
| 오너 null | 실행자 폴백 + 즉시 게시 + `consultant_owner_pending` 마킹, 재전달 시 예외적 거버넌스 갱신 |
| KV 보존 | 텍스트 노트 직렬화(노드·맵 description). JSON meta 컬럼은 채택 안 함(1차 비용) |
| 예외·VOC | 공용 `map_notes` 테이블 통합 + 읽기전용 표시. 맵 description에 중복 기재 안 함 |
| evidence | 제외 확정 |
| 실파일 | 반입 불가 → FE dry-run 키 검증 화면이 1차 범위 |
| 구 경로 제거 | canonical 수용 표면(웹 `POST /categories/import`·CLI·파일 로더·canonical 샘플) 전체 제거(2026-08-18, 사용자 결정) — 엔진·canonical 모델은 내부 IR로 유지. 임포트 경로는 인터뷰 웹 임포트 단일 |
