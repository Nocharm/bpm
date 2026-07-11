# SP 숫자 파라미터 + Σ 합산 + duration 표시형(1h30m) 설계

날짜: 2026-07-11
상태: 승인 대기
선행: `docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md` (노드 숫자 파라미터 5종·H.MM — main 머지됨). 그 설계에서 "SP 속성 무변경"으로 남겼던 부분을 이번에 잇는다.

## 1. 배경·목표

- 맵을 서브프로세스로 지정할 때(sp_*) duration이 여전히 자유 텍스트 — 노드 파라미터와 불일치. **자유 텍스트 입력을 막고** 숫자 파라미터 5종(duration·headcount·etf·cost·extra)으로 확장한다.
- 합연산 가능한 4필드(duration·etf·cost·extra — headcount 제외)에 **Σ(모든 노드 합산) 버튼**을 붙여, 맵의 노드 값 합을 한 번에 가져온다.
- duration의 **표시형을 `1h30m`으로 통일**(한/영 무관). 저장·편집값은 기존 H.MM(`1.30`) 그대로.

## 2. 데이터 모델 (백엔드)

- `process_maps`에 `sp_headcount`·`sp_etf`·`sp_cost`·`sp_extra` **String(50) 4컬럼** 추가 + `db.py _ADDED_COLUMNS`에 `VARCHAR(50) DEFAULT ''` 등록. `sp_duration`은 기존 컬럼 재사용, 값은 H.MM 숫자 문자열.
- SP 지정 PUT(`/maps/{id}/subprocess-designation`) 페이로드 스키마에 4필드 추가. 검증은 노드와 동일: duration은 `app/duration.py normalize_duration`(무효→`""`), 나머지는 십진수 패턴(무효→`""`).
- **레거시 sp 자유텍스트("2일" 등)는 전부 버림** — 응답 경계 전부(MapOut의 sp_duration, SubprocessRef.duration, 그리고 raw dict로 직렬화하는 `GET /api/library/processes`의 duration)에서 소거해 기존 행이 화면·합산을 깨지 않게 한다(노드 duration과 동일 결정·동일 근거: from_attributes 응답 경로).
- `SubprocessRef`에 `headcount/etf/cost/extra: str | None` 4필드 추가(백엔드 `subprocess.py` 조립 + 프론트 `api.ts` 미러) — 서브프로세스 노드 칩 표시와 Σ 합산의 데이터 소스.

## 3. SP 지정 모달 (프론트 `subprocess-designation-modal.tsx`)

- duration 자유 텍스트 입력 제거 → **숫자 5종 입력**(인스펙터 파라미터와 동일한 타이핑 필터 `^\d*\.?\d*$`·blur 정규화). 라벨은 기존 `field.*` i18n 키 재사용.
- **Σ 버튼**: duration·etf·cost·extra 4필드 옆(headcount 제외). 동작:
  - 이 맵 **게시본 그래프**(`getGraph(publishedVersionId)`)의 노드 값을 직합. 서브프로세스 노드는 그래프의 `subprocess_refs[linked_map_id]` sp값을 사용 — 각 맵이 자기 sp를 Σ로 갱신해두면 연쇄적으로 전체 트리 합이 된다(재귀 fetch 없음, 빠르고 예측 가능).
  - duration 합산은 **분 단위 환산 후 캐리**: H.MM→총분 합→H.MM 복원(`0.45+0.30=1.15`). 나머지 3필드는 **스케일 정수 합산**으로 부동소수 오차 차단 — 항목들의 최대 소수 자릿수 n을 구해 10^n 곱한 정수로 합산 후 복원(`0.1+0.2=0.3`).
  - 빈값·무효값은 0으로 취급(스킵). 게시본이 없으면 Σ 비활성 + 툴팁("게시본 필요").
  - Σ는 해당 입력값을 채울 뿐 — 저장은 기존 Save 버튼.
- 합산 로직은 순수 유틸 `frontend/src/lib/param-sum.ts`로 분리해 vitest 대상.

## 4. duration 표시형 `1h30m` (프론트 공용)

- `lib/duration.ts`에 `formatDurationHm(raw: string): string` 추가: `"1.30"`→`"1h30m"`, `"2"`→`"2h"`, `"0.05"`→`"5m"`, `"0.30"`→`"30m"`, 빈값/무효→`""`. 분은 제로패딩 없이(`1.05`→`"1h5m"`). 한/영 무관 고정 표기.
- **편집 중에만 원값, 나머지 표시는 전부 1h30m**:
  - 인스펙터 파라미터 duration 입력·노드 요약 모달·SP 지정 모달: 단일 input의 **focus/blur 값 스왑** — 포커스 시 raw(`1.30`) 편집, 포커스 아웃 시 `1h30m` 렌더.
  - 노드 카드 칩(일반 노드 + 서브프로세스 sp), 인스펙터 서브프로세스 sp 읽기 블록, SP 지정 패널(설정 화면) 표시, 비교 화면 diff 필의 before→after 값: `formatDurationHm` 적용.
- **파일 산출물은 예외**: CSV는 `1.30` 고정(재임포트 왕복 계약), Excel은 숫자 셀(1.30, numFmt "0.00") 유지 — 사용자 직접 연산 보장.
- 서브프로세스 노드 칩은 sp 5종 전부 표시로 확장(값 있는 것만 — 기존 spDuration 단독에서 확장, `NodeParams`의 subprocess 분기).

## 5. 파라미터 영역 접기 (인스펙터 UX)

- 에디터 인스펙터·노드 요약 모달의 **Parameters 그룹을 들여쓰기로 시각 구분**(그룹 내부를 한 단계 인덴트) + **접기/펼치기 토글, 최초 기본 접힘**.
- 접힌 헤더에 채워진 파라미터 개수 표시(예: `Parameters (3)`), 클릭으로 펼침.
- **직전 상태를 localStorage에 퍼시스트** — 매번 다시 열거나 닫지 않도록, 노드 전환·리마운트·재방문에도 마지막 토글 상태 유지(키 예: `bpm.paramsCollapsed`, 인스펙터/요약모달 공유 1키). 저장값이 없을 때만 기본 접힘.
- SP 지정 모달은 파라미터 입력이 모달의 목적이므로 **항상 펼침**(접기 없음) — 확정.

## 6. 파급·비변경

- CSV 임포트/내보내기·Excel 빌더·버전 diff 로직·AI 프롬프트 **무변경**(값은 여전히 H.MM 문자열, 표시 유틸만 추가. sp는 AI 미노출).
- 프론트/백 **동시 배포 필수**(sp 4컬럼 연동). 컬럼은 `_ADDED_COLUMNS` 자동 보강.
- ⚠️ 미머지 Word 내보내기 브랜치(worktree-word-export)가 duration을 표시한다면 머지 시 표현형(1h30m vs 1.30) 정합을 확인할 것.

## 7. 테스트·검증

- **vitest**: `formatDurationHm`(정수/분만/조합/무효/빈값), 합산 유틸(분 환산 캐리·십진 합·sub는 subprocess_refs 값·빈/무효 스킵) 순수 로직.
- **pytest**: SP 지정 페이로드 정규화·소거(0.75→1.15, "2일"→""), MapOut/SubprocessRef 레거시 소거, 신규 4컬럼 왕복.
- 게이트: tsc --noEmit·lint·vitest·pytest·ruff·build 전부 클린.
- 브라우저 검증(Playwright): 지정 모달 5입력+Σ(합산값 채움·게시본 없으면 비활성)→저장→부모 맵에서 서브프로세스 노드 칩 5종·`1h30m` 표시, 인스펙터 focus/blur 스왑, 파라미터 그룹 기본 접힘·펼침 토글.

## 8. 후속(이번 스코프 제외)

- 노드/SP headcount 합산(제외 결정 유지), Excel 셀 1h30m 표기 옵션, sp 파라미터의 AI 노출.
