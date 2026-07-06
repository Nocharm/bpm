# CSV 임포트 — 설계 (2026-07-06)

현업이 Excel로 작성한 CSV 한 장으로 프로세스맵을 생성·교체하는 기능. 두 진입점:
(1) **새 맵 만들기** — CreateMapDialog에서 템플릿 다운로드 + CSV 첨부 → 생성 직후 그래프가 그려진 에디터로 이동.
(2) **기존 맵** — 에디터 툴바 Import CSV → 기존 노드·엣지·그룹 **전부 삭제 후 교체**. 편집 역할 + 체크아웃 보유자만.

부수 신규 필드: **노드 URL 어트리뷰트**(노드당 1개, 이번엔 데이터 필드 + 인스펙터 입력만 — 캔버스 UI는 후속).

## 결정 사항 (브레인스토밍 Q&A)

| 결정 | 내용 |
|------|------|
| CSV 구조 | 한 파일, 노드 1행 = 1노드, `Next` 컬럼으로 엣지 표현 |
| 범위 | 최소형 — start/end는 CSV에서 생략(자동 생성), Type 컬럼 없음(자동 추론), 필드는 System·Duration·URL만 |
| decision 판별 | Next 대상 2개 이상 → decision 자동, 1개 이하 → process |
| URL 노출 | 데이터 필드 + 인스펙터 입력만. 캔버스 노드 UI는 후속 |
| 기존 맵 진입점 | 에디터 툴바 버튼 (편집 가능 + 체크아웃 보유 시에만) |
| 파싱 위치 | **클라이언트** — 기존 `PUT /api/versions/{id}/graph` 재사용, 백엔드 신규 엔드포인트 없음 |

## 1. CSV 양식 스펙

**컬럼 5개 (헤더 행 필수):** `Name, System, Duration, URL, Next`

- **Name** — 필수·유일(트림 후 비교). 노드명이 곧 참조 키.
- **System / Duration** — 선택. 기존 BPM 속성 필드 매핑.
- **URL** — 선택. 빈 문자열 또는 `http://`·`https://` 시작, 최대 500자.
- **Next** — 선택. 세미콜론(`;`)으로 대상 나열. 분기 라벨은 `대상노드명:라벨` (첫 콜론에서 분리). 대상은 같은 CSV의 Name이어야 함.
- 헤더 매칭: 대소문자 무시·순서 무관(이름으로 컬럼 매핑). **알 수 없는 컬럼은 에러** (오타 방지).
- Description·담당자·부서·색상·그룹은 **의도적으로 제외** — 임포트 후 에디터에서 보정.
- **인코딩**: UTF-8(BOM 허용) `fatal` 디코드 → 실패 시 EUC-KR(CP949) 폴백. 구형 Excel "CSV(쉼표로 분리)" 저장본 지원.
- **파서**: RFC4180 자체 구현(~50줄, 따옴표·쉼표·셀 내 줄바꿈·CRLF). 신규 의존성 없음.
- **템플릿**: 클라이언트 Blob 생성(UTF-8 BOM), 예시 4~5행(구매 프로세스 샘플), 파일명 `bpm-map-template.csv`.
- 상한: 데이터 500행 초과 시 에러. 빈 파일(데이터 0행) 에러.

예시:

```csv
Name,System,Duration,URL,Next
서류 검토,SAP ERP,2 days,,승인 여부
승인 여부,,,,계약 체결:승인;반려 통보:반려
계약 체결,,3 days,https://contract.example.com,
반려 통보,,1 day,,
```

## 2. CSV → 그래프 변환 규칙

- **start/end 자동 생성**: `Start` 노드 1개 → 들어오는 엣지 없는 모든 노드에 연결. `End` 노드 1개 ← Next가 빈 모든 노드에서 연결. 진입점이 없으면(전부 순환) 첫 행 노드에 Start 연결 — 백엔드 `validate_process`의 "start 정확히 1개" 충족. end는 1개라 이름 유일·primary end 자동 규칙도 충족.
- **decision 추론**: 나가는 Next 대상 ≥2 → `node_type: "decision"`, 그 외 `"process"`. 분기 라벨은 엣지 `label`.
- **ID**: 노드·엣지 `genId()` (`frontend/src/lib/id.ts` — 평문 HTTP 서버 제약으로 `crypto.randomUUID` 금지).
- **좌표**: `layoutWithDagre(nodes, edges, "LR")` (`frontend/src/lib/canvas.ts:659`). 엣지 핸들 기본값(source `right` / target `left`).
- **구현 위치**: `frontend/src/lib/csv-import.ts` — 순수 함수 `parseCsv`(텍스트→행), `buildGraphFromCsv`(행→`{nodes, edges}` + 행 단위 에러 목록), `buildTemplateCsv`. 에디터 컴포넌트에 파싱 로직 금지.

## 3. 새 맵 생성 플로우

`frontend/src/components/permissions/create-map-dialog.tsx`에 선택 섹션 **"Start from CSV (optional)"**:

- [Download template] 링크 버튼 + `.csv` 파일 입력 (참고 패턴: `manual-manage-panel.tsx:242`).
- 파일 선택 즉시 파싱 → 인라인 요약("12 nodes · 14 edges will be created") 또는 에러 목록(최대 10건 표시). **에러 있으면 Create 차단**, 파일 제거 시 CSV 없이 생성 가능.
- 생성 시퀀스(CSV 첨부 시): `POST /api/maps` → 응답 `versions[0].id`로 `POST /checkout`(신규 맵은 잠금 free — 항상 성공) → `PUT /graph` → `router.push(/maps/{id})`.
- CSV 없으면 기존 동작(목록 갱신, 이동 없음) 유지.
- `PUT` 실패 시: 맵은 생성된 상태 — 에러 토스트 후 에디터로 이동(툴바 임포트로 재시도 가능).

## 4. 기존 맵 임포트 플로우 (전체 교체)

- **에디터 툴바 Import CSV 버튼**(Lucide 16px, `data-id` 부여). 노출 조건: `!readOnly && checkout?.mine` — 편집 역할 + draft/rejected + 본인 체크아웃. 그 외 숨김.
- 클릭 → 임포트 모달: 템플릿 다운로드 + 파일 선택 + 파싱 요약/에러. **새 맵 쪽과 공용 컴포넌트** (`frontend/src/components/editor/csv-import-*.tsx` 신규, 다이얼로그 내 섹션으로 재사용).
- 파싱 성공 → 확인 단계(맵 삭제 모달 컨벤션 — 아이콘 + 요약 박스): "기존 노드 N·엣지 M·그룹 K 삭제, 새 노드 X·엣지 Y로 교체". 그룹 삭제 명시(CSV에 그룹 없음 → `groups: []`로 PUT되어 전부 삭제).
- 확정 → `saveGraph`(`PUT /api/versions/{id}/graph`) → 응답 그래프로 캔버스 상태 리셋(마운트 로드 경로 재사용) → 성공 토스트.
- 서버 게이트는 기존 `replace_graph`(`backend/app/routers/graph.py:115`) 그대로: editor 역할(403)·체크아웃 보유(423/409)·편집 가능 상태(409)·엣지 무결성(422)·start 1개. **신규 서버 로직 없음.** 423/409 응답은 에러 토스트, 캔버스 불변.

## 5. 노드 URL 어트리뷰트 (신규 필드)

- **backend**:
  - `models.Node.url` — `String(500)`, default `""`.
  - `db.py _ADDED_COLUMNS` — `("nodes", "url", "VARCHAR(500) DEFAULT ''")` (기존 DB 자동 보강).
  - `NodeIn.url` — 검증: `max_length=500`만(스킴 패턴 없음 — 인스펙터 자유 타이핑의 자동저장이 422로 깨지지 않도록. `^https?://` 검증은 CSV 파서와 추후 링크 렌더 시 수행). `NodeOut`·`FlatNodeOut`에 포함. AI 그래프 스키마는 불변.
- **frontend**: `GraphNode.url`(`lib/api.ts`)·`NodeData.url`(`lib/canvas.ts`) 추가. 인스펙터 BPM 속성 카드에 URL 텍스트 입력(process/decision만, System·Duration과 동일 패턴). 캔버스 노드 표시 없음(후속).

## 6. 에러 처리

- 전부-아니면-전무: 에러 1건이라도 있으면 임포트 불가(부분 임포트 없음).
- 검증 항목: 헤더 불일치·미지 컬럼 / Name 누락·중복 / Next 대상 미존재·같은 셀 내 중복 대상 / URL 형식 / 500행 초과 / 빈 파일 / 디코드 실패. (자기 참조 엣지는 백엔드가 허용하므로 에러 아님 — 재작업 루프 표현 가능.)
- 에러 표기: `Row {n}: {message}` (헤더 행 제외한 데이터 행 번호 기준으로 하면 Excel 행 번호와 어긋나므로 **파일 실제 행 번호** 사용).
- UI 문구 영어, i18n en/ko 키 추가(`csvImport.*`).

## 7. 테스트·검증

- **backend pytest**: url 필드 PUT/GET 라운드트립, url 검증(잘못된 스킴 422), 기존 회귀(415+) 유지. `ruff` 클린.
- **frontend**: `npm run lint`·`npm run build` 통과. Playwright+시스템 Chrome 실사용 검증(`docs/lessons/browser-verification.md`):
  1. 새 맵 다이얼로그 — 템플릿 다운로드, CSV 첨부 → 생성 → 에디터에 노드 렌더.
  2. 기존 맵 — 툴바 임포트 → 확인 모달 → 교체 렌더.
  3. 음성 케이스 — 체크아웃 미보유/viewer에서 버튼 미노출, 에러 CSV에서 Create 차단.
- 검증은 로컬 네이티브 실행 기준, 서버 compose 배포는 별도 확인.

## 비범위 (Out of scope)

- CSV 내 subprocess·그룹·색상·좌표·Description·담당자·부서 표현.
- 캔버스 노드의 URL 표시 UI(링크 아이콘 등) — 후속.
- CSV **내보내기**(export), 백엔드 임포트 API, 부분(머지) 임포트.
