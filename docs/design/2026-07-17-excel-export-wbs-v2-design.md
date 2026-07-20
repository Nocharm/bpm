# Excel 출력 양식 2안 — WBS(레벨 컬럼) 시트 + 형식 선택 모달 (2026-07-17)

## 목표

엑셀 산출물 2안: 서브프로세스 계층을 들여쓰기가 아닌 **레벨 컬럼**으로 펼치는 상향식 WBS 시트.
잎 단위 업무(일반 노드·분기)가 각 1행을 차지하고, 상위 맵들은 좌측 레벨 컬럼의 값으로만 존재한다.
Excel 버튼은 형식 선택 모달(토글 탭 + 미리보기 + 다운로드)로 바뀐다. 1안(`buildExcelModel`)은 유지.

컨셉(사용자): 가장 작은 단위 업무를 먼저 만들고, 이후엔 서브프로세스만으로 엮인 상위 맵을
쌓아 올리는 운영 방식 — 산출물은 잎 업무 목록 + 소속 경로.

## 시트 레이아웃 (사용자 확정)

- 컬럼: `No | Level 1 | Level 2 | … | Level N | Task | Type | Description | Assignee | Department | System | 회당 파라미터 6종 | URL | Groups | Next`
  - 레벨 컬럼 수 N = 이번 내보내기에서 만난 **최대 깊이**(루트=Level 1, 동적). Task 이후 속성 컬럼은 1안 `COLUMNS`의 Type~Next 정의 재사용(numFmt 포함 — 인덱스는 레벨 수만큼 시프트되므로 정의 파생 필수).
  - 메타 3행(맵 이름·버전/시각·빈 행)+4행 헤더+틀고정 — 1안과 동일. 시트 이름 `"WBS"`.
- **레벨 컬럼 값은 모든 행에 반복 기재 + 회색 톤다운**(피로도 감소 — 사용자 확정). 회색은 출력물이라 raw ARGB 허용(design.md §1 예외), `FF9CA3AF`.
- **레벨 값 = SP 노드 타이틀**(루트만 맵 이름) — Next의 SP 참조 텍스트와 매칭. 링크 맵 이름과 노드 타이틀이 다르면 노드 타이틀이 이긴다.
- **서브프로세스는 행을 차지하지 않는다** — 그 자리에서 링크 맵의 잎 행들이 흐름 순으로 전개(레벨 경로에 SP 타이틀 추가). 들여쓰기·outline 없음.

## 행 규칙 (사용자 확정)

| # | 규칙 | 1안과의 차이 |
|---|------|--------------|
| 1 | **start/end 전부 삭제** — 커스텀 제목 end 포함(구조 노드 완전 배제) | 1안은 첫 start 유지·기본 제목 end만 삭제 |
| 2 | 무라벨(전부) 디시전 삭제 + Next flow-through(라벨 전파 포함) | 동일 |
| 3 | `[No:라벨]` 주석 — 행 객체 참조, No는 삭제 후 1..n 연속 | 동일. 단 **라벨 분기 대상이 SP면 주석 소멸**(행이 없으므로) — Next의 `대상:라벨`로만 남음 |
| 4 | Next: 삭제된 end 참조 텍스트 유지(종착 표시), SP 참조는 SP 노드 타이틀 그대로 | end 유지는 동일, SP는 2안 고유(1안은 SP 행 존재) |

- 노트 행(circular/denied/rowLimit): Task 컬럼 이탤릭, 레벨 경로는 해당 스코프 것으로 채움. 상한 `EXCEL_MAX_ROWS`(2000)·다이아몬드 반복·fetch 메모이즈 — 1안과 동일 체계.
- 잎 노드가 0개인 서브프로세스(빈 맵 링크)는 블록이 사라져 이름이 미노출 — 수용(드문 케이스).
- 서브프로세스로만 구성된 중간 맵은 자체 행 없이 하위 잎 행들의 레벨 컬럼에서만 보임 — 컨셉상 정상.
- SP 노드가 상속하던 회당 파라미터(duration/비용/headcount)와 자체 annual/fte는 2안에 미표기(행이 없음) — 잎 노드 파라미터만.

## 모달 UX (사용자 확정)

Excel 버튼(`data-id="export-excel"`) 클릭 → 즉시 다운로드 대신 **형식 선택 모달**:

- **형식 토글 탭**: top-nav 한/영 세그먼트 토글 디자인 재사용(`top-nav.tsx:207` — `inline-flex rounded-sm border-hairline bg-surface-alt p-0.5`, 활성 `bg-accent-tint font-semibold text-accent`, `aria-pressed`). 탭 2개: `Process Map` / `WBS`.
- **간단 미리보기**: 활성 탭의 모델 **첫 8행**을 HTML 표로(text-fine, `overflow-x-auto`).
  Process Map 탭: No·Name(depth 들여쓰기 표현)·Type·Next. WBS 탭: No·Level 1..N(회색)·Task.
  모델은 탭 활성화 시 lazy 빌드(모달 열려있는 동안 캐시, 로딩/에러 상태 표시).
- **하단 버튼**: Cancel / Download — Download는 활성 탭 모델을 xlsx로 다운로드.
- 모달 셸: `node-summary-modal.tsx:371` 패턴(overlay `z-[1200] backdrop-blur-sm`, 패널 `rounded-sm border-hairline bg-surface shadow-lg`). UI 문구는 i18n(en/ko) 추가, 기본 영어.
- 파일명: 1안 기존 규칙(`buildExportFileName("xlsx")`), 2안은 확장자 앞 `_WBS` 접미.

## 구현 구조

- **Create `frontend/src/lib/excel-wbs.ts`** — `WbsModel`/`WbsNodeRow`(`levels: string[]` 경로)/`buildWbsModel`/`writeWbsSheet`. 순회·규칙 엔진은 1안 emit과 동형(무라벨 디시전 판정·resolveTargets·행 객체 주석·번호 부여)이지만 행 페이로드(레벨 경로)와 삭제 조건(start/end 전부)·SP 무행이 달라 **별도 빌더**로 작성(1안 코드 오염 방지).
- **Modify `frontend/src/lib/excel-export.ts`** — 공유 조각 export: `getNodeRunParams`, `NOTE_TEXT`. 다운로드 Blob/anchor를 `downloadWorkbookXlsx(write: (wb) => void, fileName)`로 추출해 1안 `downloadExcel`과 2안이 공용(exceljs 동적 import 유지).
- **Create `frontend/src/components/excel-export-modal.tsx`** — 형식 탭·미리보기·다운로드. props로 두 모델 빌더(async)와 파일명 빌더를 받아 자체 상태 관리.
- **Modify `frontend/src/app/maps/[mapId]/page.tsx`** — Excel 버튼이 모달 오픈으로 변경, 기존 `handleExportExcel` 로직은 모달에 넘길 빌더로 재구성. React Compiler 함정 주의(트리비얼 핸들러는 plain function).
- **Modify `frontend/src/lib/i18n-messages.ts`** — 모달 문구 en/ko.
- 테스트: 모델·시트는 vitest(컴포넌트 테스트 인프라 없음 — 모달은 tsc/lint/build+실기동으로 검증). 실기동 `pw-verify-excel-wbs.mjs` 신규(모달 열기→탭 전환→미리보기 렌더→양 형식 다운로드 파싱).

## 범위 밖

- 1안 규칙·CSV/Word/PNG 내보내기 변경 없음. 백엔드 0줄.
- WBS 시트의 Σ 합산·SP 파라미터 표기(잎만 표기, 수용).
