# Word 도형 순서도 내보내기 (Word Export) — 설계

- 날짜: 2026-07-11
- 상태: 승인 대기 (브레인스토밍 완료, 섹션별 사용자 승인 반영)
- 브랜치: `worktree-word-export`

## 1. 목적 · 배경

현업이 SOP 문서를 작성할 때 프로세스맵 순서도를 붙여넣는데, 기존 PNG 내보내기는 **하이퍼링크가 죽는다**. 노드의 참조 링크(URL 라벨 + 하이퍼링크)가 살아있는 순서도를 Word에 붙여넣을 수 있어야 한다.

**채택안: Word 순정 도형(DrawingML) 순서도를 담은 `.docx` 생성.** 사용자는 생성된 문서를 열어 그룹째 복사 → 자기 SOP에 붙여넣기 → 도형·하이퍼링크가 그대로 유지되고 Word에서 크기조절·편집도 가능하다.

검토 후 제외한 대안:

| 대안 | 제외 사유 |
|------|-----------|
| SmartArt | Word가 SmartArt 텍스트에 하이퍼링크 삽입을 막음. 디시전 분기·루프 등 임의 그래프 표현 불가. 라이브러리 지원 전무 |
| HTML 생성 → Word 복붙 | Word HTML 붙여넣기는 표·문단 링크만 보존, 절대좌표 도형 레이아웃은 유실. 평문 HTTP라 클립보드 API 제약도 있음 |
| 이미지 + 참조 표 docx | 순서도 자체는 클릭 불가. 사용자가 "Word 양식의 도형 순서도"를 원해 채택안으로 대체 |

## 2. 요구사항

- 에디터 **현재 화면(현재 스코프)의 노드/엣지**를 Word 도형 순서도로 담은 `.docx` 다운로드 (PNG 내보내기와 동일한 스코프 의미론).
- 노드 도형 텍스트: **1행 = 노드 라벨(굵게)**, URL 있는 노드만 **2행 = URL 라벨 하이퍼링크** (Word 표준 파란 밑줄, `url_label` 비어 있으면 URL 자체를 표시).
- 노드의 기타 필드(담당·부서·시스템·소요시간·설명)는 **넣지 않는다**.
- 전체 도형을 **하나의 그룹**으로 묶어 한 번에 선택·복사·리사이즈 가능하게.
- **기존 PNG 내보내기는 일절 변경 없음** — 버튼·컨텍스트 메뉴·`Ctrl+⇧E` 그대로.
- 그룹 박스(업무 묶음)는 **v1 제외**.

## 3. 아키텍처 · 데이터 흐름

### 신규 모듈 `frontend/src/lib/word-export.ts`

- `buildDocxBlob(nodes, edges, options): Blob` — 내보내기 모델을 받아 docx Blob을 만드는 **순수 함수** (DOM 불의존 → vitest 단위 테스트 가능).
- `exportCanvasWord(nodes, edges, fileName): Promise<void>` — Blob 생성 후 `URL.createObjectURL` + 앵커 클릭으로 다운로드 (평문 HTTP 인시큐어 컨텍스트에서도 동작. `crypto.*` 사용 금지 준수).
- 기존 `src/lib/export.ts`(PNG)는 손대지 않는다.

### OOXML 직접 생성 + `fflate`

- `.docx`는 zip 컨테이너 — `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels` 최소 4파트를 코드로 생성.
- `docx` npm 라이브러리는 도형 프리셋·연결선(connector)을 지원하지 않아 부적합. zip만 해결하면 되므로 초경량 **`fflate`**(~8KB, 의존성 0, prod dependency)를 추가한다. 선정 사유는 이 줄이 근거 문서.
- 하이퍼링크는 `document.xml.rels`에 `TargetMode="External"` 관계로 추가하고 run에서 `r:id` 참조.

### 진입점 (사용자 지정)

- **인스펙터 맵 탭**(page.tsx `mapSlot`) 안, 기존 PNG 버튼 **아래에 별도 버튼** 추가. PNG 버튼 코드는 무변경.
- 컨텍스트 메뉴·키보드 단축키에는 넣지 않는다 (`Ctrl+⇧W`는 브라우저 창 닫기와 충돌).
- 버튼 스타일: PNG(accent 채움)와 구분되는 보조 스타일(`border-hairline` 계열), Lucide 16px/stroke 1.5 아이콘, i18n 키 `inspector.exportWord`. `data-id` 부여.

### 데이터 흐름

```
page.tsx handleExportWord
  → nodesRef.current(표시 좌표·타입·title·url·url_label) + edges(source/target/label/sides)
  → 내보내기 모델로 변환 (React Flow 타입 의존 제거)
  → word-export.ts buildDocxBlob → 다운로드
```

- 파일명: PNG와 동일 규칙 `${맵이름}_${버전라벨}_${타임스탬프}.docx`.

## 4. 도형 · 레이아웃 매핑

캔버스 스타일 복제가 아니라 **구조(배치·연결·라벨·링크)만 옮기고 Word다운 양식**을 따른다 (사용자 결정).

| 노드 타입 | Word 프리셋 도형 | 비고 |
|-----------|------------------|------|
| `process` | `flowChartProcess` | 사각 |
| `decision` | `flowChartDecision` | 마름모 |
| `start` / `end` | `flowChartTerminator` | 알약 |
| `subprocess` | `flowChartPredefinedProcess` | 이중 테두리 |

- **색 — 기본 흑백톤**: 도형은 흰 채움 + 검정 테두리, 텍스트는 검정. 캔버스 노드 색은 반영하지 않는다. 하이퍼링크만 Word 표준 파란 밑줄 유지(클릭 대상 인지용 — 가정, 사용자 확인).
- **폰트**: 영문·숫자 **Arial**(`w:ascii`/`w:hAnsi`), 한글 **바탕체**(`w:eastAsia`), **11pt 기준**, 가운데 정렬. 11pt 대비 도형 크기가 작아 텍스트가 넘치는 경우는 구현 시 autofit/최소 크기로 처리.
- **좌표**: 캔버스 px 좌표·크기(`nodeSizeOf`)를 그대로 EMU(×9525)로 변환하되, 전체 bounds가 **A4 세로 페이지 여백 안(약 16×24.7cm)에 들어가는 단일 배율로 축소**(확대는 안 함). 극단적으로 큰 맵은 글자가 작아지는 것을 v1에서 수용 — 사용자가 Word에서 그룹 리사이즈 가능.
- **그룹화**: 도형+연결선 전체를 하나의 `wpg` 그룹으로. 인라인/앵커 배치는 구현 시 Word 호환성 검증으로 확정.
- **연결선**: 꺾인 연결선(`bentConnector3`) + 삼각 화살촉. 엣지의 `source_side`/`target_side`를 도형 접점 인덱스로 매핑해 **도형에 실제 연결**(Word에서 도형을 움직이면 선이 따라옴). 접점 인덱스는 프리셋별로 구현 시 실측 확정.
- **엣지 라벨**(분기 라벨): 라벨 있는 엣지만 연결선 중점에 테두리 없는 작은 텍스트박스.

## 5. 에러 처리

- 노드 0개면 no-op (PNG와 동일).
- 생성/다운로드 실패 시 `setStatus(t("err.exportWord"))` — i18n 키 추가.
- XML 이스케이프: 제목·라벨·URL의 `& < > " '` 및 제어문자 처리 (한글은 UTF-8 그대로).
- URL은 노드에 저장된 값을 그대로 사용 — 검증 정책은 기존 url 필드와 동일(별도 강화는 백로그).

## 6. 테스트

- **단위(vitest)** `word-export.test.ts`: 생성 Blob을 `fflate` unzip으로 풀어 검증 —
  - 노드 타입 → 프리셋 매핑, 도형/연결선 개수
  - 하이퍼링크: rels의 대상 URL·TargetMode, 도형 내 `r:id` 참조, `url_label` 폴백(빈 값 → URL 표시)
  - 좌표 축척(페이지 fit), XML 특수문자 이스케이프
  - 스타일: 흑백톤(흰 채움·검정 테두리·검정 텍스트), 폰트 지정(Arial/바탕체, 11pt)
- **브라우저(Playwright)**: `frontend/scripts` pw-verify 패턴 — 버튼 클릭 → 다운로드 파일 unzip → 구조 검증, console error 0.
- **수동(Windows Word)**: 파일 열기 → 그룹 복사 → 새 문서 붙여넣기 → 하이퍼링크 클릭 동작 확인. 자동화 불가 영역으로 검증 단계에 명시.

## 7. 제외 (v1 아님)

- 그룹 박스(업무 묶음) 렌더
- 참조 표·절차 서술 등 부가 섹션
- 컨텍스트 메뉴·단축키 진입점, 비교 화면 지원
- 서브프로세스 노드의 앱 딥링크 자동 삽입
