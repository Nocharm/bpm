# 숫자 파라미터 5종 + Excel/CSV 내보내기 설계

날짜: 2026-07-11
상태: 승인 대기
스코프: 이번 세션 = 숫자 파라미터 도입 + Excel(.xlsx) 내보내기 + CSV 내보내기/임포트 갱신. **Word(.docx) 내보내기는 다음 세션**(첨부용 양식 문서, 노드 제목·URL 하이퍼링크 중심 — 본 설계에 포함하지 않음).

## 1. 배경·목표

현재 다운로드는 PNG(캔버스 캡처)뿐이다. 사용자 요구:

- **Excel**: 노드의 모든 정보 + 서브프로세스 맥락을 담은 읽기용 산출물. (초기의 "xlsx 왕복 편집" 요구는 철회 — 왕복은 CSV가 담당)
- **CSV 내보내기**: 기존 CSV 임포트 형식과 동일한 왕복(round-trip)용 다운로드.
- **숫자 파라미터**: 기존 duration 자유텍스트를 숫자 전용 필드 5개로 세분화 — 소요시간·투입인력·ETF·비용·예비. 라벨은 추후 변경 예정이므로 교체 용이하게.

## 2. 숫자 파라미터 5종

### 2.1 필드 구성

| 필드(컬럼명) | 잠정 라벨 | 의미 | 표기 |
|---|---|---|---|
| `duration` | Duration (h) | 소요시간 | **H.MM 표기** (아래 2.2) |
| `headcount` | Headcount | 투입인력 | 십진수 |
| `etf` | ETF | ETF | 십진수 |
| `cost` | Cost | 비용 | 십진수 |
| `extra` | Extra | 예비 슬롯 | 십진수 |

- 전부 **숫자만 입력**, 빈값 허용, 음수 불가. 라벨·아이콘은 추후 교체 예정이므로 i18n 키/상수 1곳으로 모은다.
- 저장: **String(50)에 숫자 문자열** — `duration`은 기존 컬럼 재사용, 나머지 4개는 신규 컬럼(`db.py _ADDED_COLUMNS` 등록). Float 컬럼 대신 문자열을 쓰는 이유: 빈값="" 기존 컨벤션 유지, DB 마이그레이션 불필요, 프론트 표시 코드 대부분 무변경, H.MM 표기 보존(부동소수 왜곡 없음).
- 검증(API 경계, `NodeIn`): `duration`은 `^$|^\d+(\.\d{1,2})?$` + 정규화, 나머지는 `^$|^\d+(\.\d+)?$`.

### 2.2 duration H.MM 표기 (십진수 아님)

- 소수부 2자리는 **분**: 30분=`0.30`, 3분=`0.03`, 1시간 30분=`1.30`.
- 1자리 입력은 10분 단위로 패딩: `0.3` → `0.30`(=30분).
- **소수부 60 이상은 시간으로 자동 이월**: `0.60`→`1.00`, `0.75`→`1.15`, `2.99`→`3.39`.
- 정규화 구현은 프론트 공용 유틸 `frontend/src/lib/duration.ts`의 `normalizeDuration()` 1곳 — 인스펙터 입력(blur), CSV 임포트, AI apply 모두 이 유틸을 통과. 백엔드 `NodeIn` validator도 동일 정규화(경계 방어, pytest로 프론트 유틸과 케이스 동치 확인).
- ⚠️ 알려진 트레이드오프: H.MM은 십진수가 아니라 Excel SUM이 어긋난다(1.15+0.45=1.60≠2.00). Excel 셀엔 값 그대로 싣고, 집계용 변환은 필요 시 후속.

### 2.3 기존 데이터·배포

- 기존 duration 자유텍스트(예: "2일")는 **전부 버림**. 로컬은 `python -m scripts.reset_db`, 서버 배포 노트에 1회 클리어 SQL(숫자 패턴 불일치 duration을 ''로 UPDATE) 명시.
- `ProcessMap.sp_duration` 등 맵 SP 속성은 **이번 세션 무변경**(자유텍스트 유지).
- 프론트/백 **동시 배포 필수**(스키마 연동).

### 2.4 UI

- **인스펙터**: duration 텍스트 입력 1개 → "Parameters" 그룹 아래 컴팩트 숫자 입력 5개(숫자·소수점만 타이핑 허용, blur 시 duration 정규화). 라벨은 i18n 키.
- **노드 카드**: 속성 칩 명칭을 "Parameters"로. **값이 작성된 파라미터는 전부 표시** — 텍스트 라벨 없이 아이콘+숫자 칩(Lucide 16px/1.5). 잠정 아이콘: Clock(duration)·Users(headcount)·Target(etf)·Coins(cost)·Tag(extra). 기존 nodeDisplayFields 토글은 텍스트 속성(담당자·부서·시스템)용으로 유지, 숫자 파라미터는 토글 대상 아님(값 있으면 항상 표시).
- **버전 비교(diff)**: diff 필드 목록에 신규 4필드 추가.

### 2.5 AI 챗 파급(최소화)

- `AiNodeAttributes`는 `duration`만 유지(신규 4필드 AI 노출은 후속). `backend/app/ai_prompt.py` 프롬프트에 규칙 추가: duration은 숫자 H.MM 표기·소수부=분·60 이상 이월. apply 경계에서 비숫자 duration은 소거(경고). 직렬화 규칙이 백/프론트 이중 정의이므로 양쪽 함께 갱신·테스트.

## 3. CSV — 임포트 갱신 + 내보내기 신설 (왕복 담당)

- 헤더: `name, description, assignee, department, system, duration, headcount, etf, cost, extra, url, url_label, next` (duration 뒤에 4컬럼 삽입).
- 임포트: 숫자 컬럼에 비숫자 값 → 행 번호 포함 에러(기존 패턴). duration은 임포트 시 정규화.
- 템플릿 CSV(`buildTemplateCsv`)·AI 프롬프트 복사 텍스트(`buildAiPromptText`) 동반 갱신.
- **CSV 내보내기**: 에디터 현재 그래프 → 임포트와 완전 동일 포맷(UTF-8 BOM, RFC4180, `next` 인코딩은 임포트 파서 규칙 그대로 — 분기 라벨 포함). Start/End 행 처리는 임포트의 자동 생성 규칙과 정합하게 맞춘다.
- **수용 기준: 내보낸 CSV를 그대로 재임포트하면 변경 0**(머지 프리뷰에서 added/removed/lostEdges 전부 없음).
- 파일명: `<맵이름>.csv`.

## 4. Excel(.xlsx) 내보내기 (읽기용 산출물)

- **클라이언트 생성**: `exceljs`를 dynamic import(번들 분리). 선정 이유: 기존 PNG/CSV와 같은 클라이언트 아키텍처, 링크 맵 조회는 `getResolvedGraph` 재사용(권한 마스킹 locked 자동 처리), 셀 스타일·행 그룹(outline)·숫자 서식 지원, 차기 Word도 캡처 이미지 때문에 클라이언트 생성 예정이라 일관.
- 시트 1장 구성: 상단 메타(맵 이름·버전 라벨/번호·내보낸 시각 KST) + 노드 표.
- 컬럼: No · Name · Type · Description · Assignee · Department · System · Duration (h) · Headcount · ETF · Cost · Extra · URL(하이퍼링크 셀, url_label 표시) · Groups · Next.
- 행 순서: Start부터 흐름(위상) 순회, 순회 불가(고아·역류)는 sort_order 폴백. 결정 노드 분기는 Next 컬럼에 라벨 병기.
- **서브프로세스 인라인(전체 재귀)**: subprocess 노드 행 바로 아래에 링크 맵의 노드 행들을 들여쓰기 + **Excel 행 그룹(outlineLevel, 접기 가능)**으로 삽입.
  - 순환 참조(무한 깊이 방지): 펼침 시 루트→현재까지의 **조상 맵 경로**를 전달, 링크 맵이 조상 경로에 있으면 재펼침 없이 `(circular reference)` 1행. 경로상 같은 맵은 1회만 등장하므로 깊이 유한 보장.
  - 다이아몬드 팽창(지수 폭발 방지): 순환이 아니어도 다중 링크 중첩으로 행 수가 지수 증가 가능 → **총 행 수 상한 2,000행**, 초과 지점에 `(row limit reached)` 표기 후 펼침 중단. 같은 맵 resolved 그래프는 1회 fetch 후 메모이즈(요청 폭주 방지).
  - 접근 불가(locked) 맵: `(access denied)` 1행.
  - 버전 선택은 에디터 임베드와 동일 규칙(follow_latest / linked_version_id).
- 숫자 파라미터는 실제 숫자 셀(합계 행은 YAGNI — 미포함, H.MM 주의는 2.2). 스타일은 절제(헤더 배경·헤어라인 보더) — 출력물이므로 raw hex 허용(`export.ts`와 동일 논리, design.md §1 예외).
- 파일명: `<맵이름>.xlsx`.

## 5. UI 진입점

- 에디터 툴바의 기존 PNG 다운로드 버튼 → **드롭다운 3종: PNG / Excel (.xlsx) / CSV**.
- 비교 화면의 PNG 내보내기는 무변경.

## 6. 테스트·검증

- **프론트 vitest**: `duration.ts` 정규화(패딩·이월·경계), csv-import 신규 컬럼·숫자 검증·**왕복 round-trip**(export→import 변경 0), Excel 빌더 순수 로직(위상 순회·재귀·순환 참조·행 상한·locked) — 빌더는 exceljs 호출부와 분리해 데이터 구조로 테스트.
- **백엔드 pytest**: NodeIn 숫자 검증·duration 정규화(프론트 케이스 동치), ai_prompt 규칙 문자열.
- 상시 게이트: `tsc --noEmit`(vitest·next build가 못 잡는 테스트 타입 에러), `npm run lint`, `ruff`, 백엔드 전체 pytest.
- 로컬 Playwright 브라우저 검증: 파라미터 입력→노드 카드 칩 표시, Excel/CSV 다운로드 파일 생성 확인.

## 7. 후속(이번 세션 제외)

- Word(.docx) 내보내기 — 첨부용 양식, 노드 제목·URL 하이퍼링크 중심.
- 신규 4필드 AI 노출, 맵 SP 속성(sp_duration) 세분화, Excel 집계(H.MM 변환) 필요 시.
