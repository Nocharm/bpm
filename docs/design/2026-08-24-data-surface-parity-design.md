# 데이터 표면 패리티 — CSV 왕복·Excel 내보내기·인터뷰 JSON 임포트 점검 (이관 트랙)

> 2026-08-24 브레인스토밍 확정분. AI 계약 최신화(`feat/ai-contract-parity`, 같은 날 선행 구현)에서
> **다음 브랜치로 분리**된 나머지 표면. 구현 시 이 문서를 소비하고, main 머지 후 삭제한다
> (`rules/common/documentation.md` 설계 스냅샷 폐기 정책).
> **Word 내보내기는 범위 제외** — 구현 보류(사용자 결정 2026-08-24).

## 배경 — 필드×표면 커버리지 (dev 04eedfe7 실측)

| 필드 | CSV 왕복(21열) | Excel(1안/WBS) | AI 계약 | 인터뷰 JSON 임포트 |
|---|---|---|---|---|
| 파라미터 7종 | ✅ | ✅ | ✅ (ai-contract-parity에서 봉합) | ✅ |
| input/output/flags | ✅ | ❌ | ✅ (〃) | ✅ |
| start/end 조건·data_form | ✅ | ❌ | ✅ (〃) | ✅ |
| input_forms/output_forms | ❌ 의도적 제외 → **왕복 포함으로 확정** | ❌ | 제외 유지(검토값) | ✅ 계보 승계 |
| gmp | ❌ 의도적 제외 → **왕복 포함으로 확정** | ❌ | 읽기 노출만 | ✅ 계보 승계 |
| system_fallback | ❌ — **미결** (아래 §1) | ❌ | 제외 유지 | ✅ 원문 기록 |
| IO 링크 3종 | ❌ 제외 유지(id 기반) | ❌ | 제외 유지 | — |

## 1. CSV 왕복 확장 (21열 → 24열)

`GMP`·`Input_Forms`·`Output_Forms` 컬럼 추가 — 사용자 확정: 검토값 필드도 CSV 왕복 포함.
임포트는 헤더명 매칭이라 순서 무관, export는 Input/Input_Flags/**Input_Forms**/Output/**Output_Forms**/… /**GMP** 논리 배치.

- **gmp**: 유효값은 `schemas.GMP_VALUES`(direct/indirect/non_gmp)와 단일 소스로 검증. 무효값은 기존
  CSV 계약대로 경고+소거, 빈 셀=유지. SP 노드는 링크 맵 sp_gmp 상속(read-only)이라 제공 시 드롭+경고.
  **에디터의 "GMP 분류→노드색 자동 확정"은 CSV 경로 미적용** — 값만 저장, 색 불변(임포트가 조용히 색을 바꾸면 안 됨).
- **input_forms/output_forms**: 셀 안 개행 = 항목과 1:1 줄 정렬(빈 줄=미지정). 병합 규칙 —
  폼 셀에 값이 있으면 새 정렬로 채택하되 병합된 텍스트 줄 수에 정렬(초과 절단+경고, `alignFlagLines` 패턴),
  폼 셀이 비면 기존 규칙 유지(텍스트 불변=보존, 변경=폐기 — `mergeNode` 2026-08-20 규칙).
  정규화·검증은 에디터/AI 경로와 같은 함수 재사용(무효 에코 소거 함정 — CLAUDE.md 체크리스트).
- **system_fallback: 미결** — 다음 세션 착수 시 확정. ⓐ 제외 유지(추천 — 재전달이 덮는 원문이며 편집은
  FallbackHint 검토 UI 전담, 대표 system과 이중 기록이라 왕복 시 진실원 모호) ⓑ export 전용 읽기
  컬럼(임포트 무시) ⓒ 완전 왕복.
- **IO 링크 3종(output_ids/input_links/output_links) 제외 유지**: itemId 기반이라 CSV 표현 부적합 —
  기존 보존/해산 규칙 그대로.
- 갱신 지점: `csv-export.ts` HEADER · `csv-import.ts` HEADER_COLUMNS/NODE_DEFAULTS/mergeNode/행 변환 ·
  CSV 템플릿(`csv-template-actions.tsx`) · CSV 매뉴얼 · CLAUDE.md 노드 속성 체크리스트 문구
  ("CSV 표면 제외" → 포함으로 개정).

## 2. Excel 내보내기 컬럼 확장 (1안 `excel-export.ts` + WBS `excel-wbs.ts` 동일 세트)

- 추가 컬럼: Input · Output · Data form · Start condition · End condition · GMP.
- IO 셀 표기: 줄마다 `항목 [optional] · 폼` — 항목별 폼·플래그를 별도 컬럼 대신 병기해 열 폭발 방지
  (에디터 SP 상속 표기 `· form` 관례 재사용).
- SP 노드 행: 파라미터와 동일하게 링크 맵 지정값을 참조(subprocess_refs) 범위 내에서 상속 표기.
- 읽기 전용 표면 — 병합 규칙 없음. 열 폭·헤더 스타일은 기존 규칙 유지.

## 3. 인터뷰 JSON 임포트 점검

- 어댑터(`backend/scripts/consultant_interview.py`) 인지 키 ↔ 인터뷰 웹 최신 출력 키 전수 대조.
- 실파일 dry-run 대조 — `2026-08-18-interview-import-design.md`의 잔여 작업. **실파일은 사용자 제공 필요.**
- 대조에서 갭 발견 시 같은 브랜치에서 수정.

## 결정 로그 (2026-08-24 브레인스토밍)

- 최신화 목표 = **데이터 모델 패리티** (기능 개선·외부 계약 대응·문서화가 아님).
- 검토값(gmp·항목별 폼)은 **CSV 왕복까지 포함** — 사용자 선택. system_fallback만 미결.
- Word 내보내기 제외(구현 보류). KB 인덱싱 패리티는 범위 밖(선택되지 않음 — 백로그).
- AI 계약(챗·컨설턴트 인터뷰)은 `feat/ai-contract-parity`에서 선행 구현 — 프롬프트/직렬화·touch_time
  7종 완성·set_attr 텍스트 필드 적용(정렬 폐기 동반).
