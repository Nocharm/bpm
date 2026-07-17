# Word 맵 — 섹션 링크(문서 내부 하이퍼링크) 순서도 — 설계

- 날짜: 2026-07-18
- 상태: 승인 대기 (브레인스토밍 완료, 사용자와 축별 확정 반영)
- 브랜치: `worktree-word-map-sections`
- 기준: dev `5163615` (main-tabs UX refresh 머지 포함 — 홈 `page.tsx` 재편됨. 접근 포인트·패널·노드모델·export 파일은 무변경)

## 1. 목적 · 배경

현업이 SOP Word 문서(목차 TOC가 있는 긴 문서)의 **순서도 그림을 그릴 때**, 순서도의 각 도형이 **문서 내부의 해당 섹션으로 점프하는 살아있는 하이퍼링크**를 갖게 하고 싶다. 기존 PNG는 링크가 죽고, 기존 Word 내보내기(`word-export.ts`)는 **외부 URL** 하이퍼링크만 지원한다.

**채택안:** 기존 Word 도형 순서도 내보내기를 확장해, **외부 URL 대신 문서 내부 앵커(`w:anchor`)**로 링크하는 **"Word 맵" 전용 모드**를 둔다. 사용자는 산출물을 열어 도형 그룹을 복사 → 목차가 있는 원본 문서에 붙여넣으면, 앵커가 그 문서에 이미 존재하므로 **클릭 시 섹션 점프가 즉시 활성**된다.

- **일반 맵**: Word 산출물 버튼을 **숨김**.
- **Word 맵**: 서브프로세스 대신 "섹션"을 다루고, Word 내보내기를 노출.

### 검토 후 제외한 대안 (핵심 근거)

| 대안 | 제외 사유 |
|------|-----------|
| 문서에 안정 북마크 **주입**(사본/병합 생성) | 사용자 문서가 길고 양식이 엉켜 있어 기계적 재작성 시 손상 위험. **문서 0 수정**이 요구사항. (하위 섹션에 북마크가 아예 없는 경우에만 옵트인 폴백으로 뒤로 미룸 — §11) |
| 외부 URL 재사용해 앵커를 `url`에 저장 | "섹션 = 서브프로세스 대체"라는 깔끔한 축과 어긋나 개념이 엉킴. 앵커는 자기 필드로 분리(§6). |
| 제목 텍스트로 링크 | Word/OOXML에 **존재하지 않음**. 내부 링크는 반드시 실재하는 `w:bookmarkStart`를 `w:anchor`로 가리켜야 한다(§5의 근본 제약). |

## 2. 핵심 원칙 — **섹션 = 서브프로세스의 대체**

Word 맵에서 "섹션"은 새 개념이 아니라 **현재의 서브프로세스 자리에 끼워지는 대체물**이다. 같은 기계장치, **링크 대상만 다르다**(다른 맵 → 문서 섹션 앵커).

| | 서브프로세스 (일반 맵) | **섹션 (Word 맵)** |
|---|---|---|
| 피커 창 | `ProcessLibraryPanel` (등록된 맵 목록) | **섹션 패널** (임포트한 문서의 섹션 목록) |
| 행이 뜻하는 것 | 링크할 맵 | 링크할 섹션 `{ number, title, anchor }` |
| 드래그 → | subprocess 노드 (맵 링크) | **section 노드 (앵커 링크)** |
| 시맨틱 타입 | `data.nodeType: "subprocess"` | `data.nodeType: "section"` |
| 주 링크 필드 | `linked_map_id` 등 | **`section_anchor` (문자열) 1개** |
| 라벨 | 맵 이름 | **섹션번호 (편집 가능)** |
| 접근 포인트 | AddNodeMenu / inspector 빈상태 / pane 우클릭·`S` → 라이브러리 | **동일 지점, 모드 분기로 → 섹션 패널** |
| Word 내보내기 링크 | 해당 없음 | **`w:anchor` 내부 링크** |

일반 도형(process/decision/start/end)은 이 표와 무관하게 **평소대로** 그린다. 노드 구성은 **혼합** — 일반 도형 + 섹션 노드.

## 3. 모드 — Word 맵 (맵 종류, 생성 시 고정)

- `maps`에 **모드 플래그**(예: `kind = "word"` 또는 `is_word_mode`). 일반 맵과 영구 구분, 생성 시 확정.
- **게이팅:**
  - 일반 맵: Word 내보내기 버튼 숨김. 서브프로세스/라이브러리 UI 그대로.
  - Word 맵: 라이브러리(서브프로세스) 진입점이 **섹션 패널**로 분기. Word 내보내기 노출.

## 4. 생성 진입 — 홈 (CSV 만들기 미러)

- 홈 `frontend/src/app/page.tsx`의 **New map 영역**(현재 426–477 부근, `CsvCreateModal`이 `FileUp` 보조 버튼으로 붙어 있음)에 **"Word 문서로 만들기"**를 세 번째 진입으로 추가.
- 흐름: 버튼 → **`WordCreateModal`**(드롭존, `csv-create-modal.tsx` 미러) → `.docx` 파싱(§5) → `CreateMapDialog`에 **섹션 카탈로그 prefill + 모드=word** 전달 → Word 맵 생성.
- **나중 임포트 · 재임포트는 섹션 패널이 홈:** 문서 없이 Word 맵을 먼저 만들 수 있고, **섹션 패널의 빈 상태**("No document — Import" 드롭존)와 **재임포트 버튼**으로 임포트/갱신한다. → 맵 탭 표현(§11 이월)과 무관하게 이번 스코프에서 닫힌다. (생성 모달과 파싱·prefill 경로를 공유.)

## 5. Word 파서 (read-only, 신규 `frontend/src/lib/word-import.ts`)

- `.docx`를 **`fflate`로 unzip**(동적 import — `exceljs`/`fflate`는 정적 import 금지, AGENTS.md) → `word/document.xml` 파싱.
- **문서에 이미 존재하는 내부링크 타겟만 선별**: `w:bookmarkStart`(`_Toc*` · `_Ref*` · 수동 북마크) + 대응 제목 텍스트·레벨.
- **번호(예: 1.2.2) 확보 순서**: (a) TOC 필드 캐시 텍스트의 번호 → (b) 제목에 타이핑된 번호 → (c) 아웃라인 넘버링 계산 → 없으면 (d) 제목 텍스트로 폴백.
- 산출: `SectionEntry[]` = `{ anchor: string, title: string, number: string, level: number }`. **순수 함수** → vitest.
- **문서 0 수정.** `word-export.ts`와 대칭되는 위치.

### 근본 제약 (스펙 고정 사실)

내부 링크는 **실재하는 북마크**를 가리켜야만 동작한다(제목 텍스트/인덱스로 링크 불가). 따라서 read-only로 링크 가능한 것 = **문서에 이미 박힌 북마크뿐.**

- 문서의 최상위 TOC 항목만 `_Toc` 북마크를 가지고 **하위(1.2.2)는 본문에만** 있는 경우, 하위에 별도 `_Ref`/수동 북마크가 없으면 **하위는 read-only로 링크 불가** → 목록에 최상위만 남는다.
- **안정성:** 앵커는 번호가 바뀌어도 따라간다(북마크가 제목과 함께 이동). 단 사용자가 **목차를 통째로 재생성(F9)**하면 `_Toc` 번호가 재발급돼 어긋난다 → 재임포트로 복구. (사용자 안내 문구 필요)

### 착수 시 실물 확인 (구현 전 게이트)

실제 대상 문서를 열어 **하위 섹션에 북마크가 있는지 / 번호(1.2.2) 추출이 가능한지** 확인한다. Word "책갈피 표시" 또는 삽입→책갈피로 자가 확인 가능. 결과에 따라 하위 도달 가능 여부가 갈리고, 불가 시 §11의 주입 폴백을 검토.

## 6. 데이터 모델

### 맵 레벨 (신규 컬럼 — `db.py` `_ADDED_COLUMNS` 등록 필수)

- 모드 플래그(§3).
- `doc_name` — 임포트한 파일명(표시·재임포트용).
- `doc_sections` — `SectionEntry[]` JSON 카탈로그. **섹션 패널이 이걸 읽어 행을 뿌린다**(서브프로세스 패널이 백엔드에서 맵 목록 읽는 것과 대칭). `.docx` 원본은 저장하지 않는다.

### 노드 레벨 — section 노드가 갖는 것 (셋)

1. **`section_anchor`** (신규 필드) — 문서 내부 링크. 서브프로세스의 "맵 링크" 슬롯을 대체하는 **주 링크**. 드래그 시 세팅.
2. **`label`** — 섹션번호, 편집 가능(일반 노드 인스펙터/온캔버스).
3. **`url` / `url_label`** (기존 필드 그대로) — 선택적 **외부** 참조 링크, 편집 가능. 모든 노드가 이미 가진 필드 — 파리티 유지. (앵커 ≠ url, 별개 필드로 공존)

- `data.nodeType`에 `"section"` 추가(`frontend/src/lib/canvas.ts` `ProcessNodeType`). React Flow `type`은 여전히 `"process"`.
- section은 **무거운 지정 모달 불필요** — 드래그하면 앵커+번호라벨로 노드 즉시 생성, 이후 `label`·`url`은 일반 인스펙터에서 편집.

### 노드 속성 추가 체크리스트 (신규 `section_anchor` 컬럼 — 열거 지점 전부)

`models.py` 컬럼 · `schemas.NodeIn`(+검증) · `graph.py` upsert · `versions.py` `clone_graph` · `csv-import.ts`(NODE_DEFAULTS·mergeNode pick·행 변환) · AI 변환 2곳(`buildGraphFromAiProposal`, page.tsx `aiNodeToGraphNode`) · `db.py` `_ADDED_COLUMNS`. (CLAUDE.md 체크리스트 준수)

> 백엔드/DB 스키마 변경이 있다(사용자 승인됨). 운영 DB는 배포 시 자동 ALTER 보강 — `_ADDED_COLUMNS` 등록이 관건.

## 7. 섹션 패널 + 접근 포인트 + 드롭 (미러링 지점)

- **섹션 패널** = `frontend/src/components/process-library-panel.tsx` 미러. 카탈로그 행·검색·**드래그**. 드래그 payload `application/bpm-section` = anchor(+번호/제목). 별도 `sectionsOpen` state + 렌더 지점(현 `libraryOpen`/`ProcessLibraryPanel` 렌더 자리 대응, page.tsx ~6717). **카탈로그가 비면 "Import a Word document" 드롭존 상태**, 상단에 **재임포트 버튼**(§4의 임포트/재임포트 홈).
- **접근 포인트 3곳(모드 분기)** — Word 맵에선 `setLibraryOpen` 대신 섹션 패널 열기:
  - (a) `AddNodeMenu`(`add-node-menu.tsx`)의 subprocess 항목 `onOpenLibrary()` → 섹션 항목.
  - (b) `inspector-panel.tsx:241` 빈 상태 "Add from library" → "Add section".
  - (c) `context-menu.tsx` pane 분기(page.tsx ~4537의 `{ label: library.open, icon: Network, shortcut:"S" }`) + `S` 단축키 → 섹션 패널.
- **드롭** → **`handleSectionDrop`**(`handleLibraryDrop` page.tsx ~3661 미러) → `handleAddNode`(page.tsx ~3017) 팩토리 재사용해 `data.nodeType:"section"` 노드 생성, `label`=섹션번호, `section_anchor`=앵커. canvas `onDrop` 지점(page.tsx ~6727)에 `application/bpm-section` 분기 추가.
- 일반 도형 삽입(process/decision/start/end)은 그대로.

> 라인 번호는 dev `5163615` 기준 근사치 — 구현 시 재확인.

## 8. Word 내보내기 변형 (Word 맵 전용) — `word-export.ts` 분기

- **게이팅:** 일반 맵 버튼 숨김; Word 맵만 노출(PNG는 양쪽 유지, 기존 무변경).
- **두 하이퍼링크 동시 생존 (확정 규칙):**
  - **1행 = `label`(앵커 라벨)** → `section_anchor`(내부 `w:anchor`)로 하이퍼링크. **첫 띄어쓰기 토큰만** 링크, 나머지는 plain:
    - `"1.22스탭 참고"` → `1.22스탭`만 링크, ` 참고` plain
    - `"1.22 스탭"` → `1.22`만 링크, ` 스탭` plain
    - 공백 없으면(`"1.22"`) 라벨 전체 링크
  - **2행 = `url_label`** → `url`(외부 `TargetMode="External"`) **전체** 하이퍼링크(현행 계승). `url` 있을 때만.
- **도형 1.5cm×3cm 고정**(process·decision 포함) + **통일 엣지**. 정확 수치·엣지 라우팅·배치(캔버스 상대좌표 유지 vs 오토레이아웃)는 **뒤로 미룸**(§11).
- XML 이스케이프·인시큐어 컨텍스트 다운로드(`crypto.*` 금지)·그룹화 등은 기존 `word-export.ts` 계승.

## 9. 에러 · 엣지 케이스

- **재임포트:** 카탈로그 교체. 노드의 `section_anchor`는 유지. 새 카탈로그에 **없어진 앵커** 노드는 플래그(서브프로세스 `undesignated` 유사 배지/경고).
- **하위 섹션 북마크 없음:** read-only 링크 불가 → 목록에 최상위만. (필요 시 §11 주입 폴백)
- **빈 라벨 / 앵커 없는 노드:** 하이퍼링크 없이 도형만.
- **노드 0개 export:** no-op(현행).
- **URL·앵커 문자열:** 저장값 그대로 사용, 이스케이프만. 별도 강화는 백로그.

## 10. 테스트

- **파서(vitest)** `word-import.test.ts`: 북마크 선별(`_Toc`/`_Ref`/수동), 번호 추출(TOC캐시/타이핑/아웃라인/폴백), 레벨. 픽스처 `.docx`를 fflate로 검증.
- **export(vitest)** `word-export.test.ts` 확장: section 노드 두 하이퍼링크 — 앵커 라벨 **첫토큰 분할**(plain 잔여 검증), url 라벨 전체, unzip으로 rels·`w:anchor`/`r:id` 확인.
- **브라우저(Playwright)**: 섹션 패널 드래그→드롭 노드 생성, 접근 포인트 모드 분기, Word 버튼 게이팅(일반 맵 숨김/Word 맵 노출).
- **수동(Windows Word)**: `.docx` 파싱→노드 링크→내보내기→그룹 복사→원본 문서 붙여넣기→**클릭 시 섹션 점프** 확인. 자동화 불가 영역.

## 11. 뒤로 미룸 / 다음 세션

- **맵 탭 Word 표현 — 다음 세션 보류 (사용자 지정).** Word Document 카드(파일명·임포트/재임포트·섹션 개수·섹션 패널 열기)와 Word 내보내기 버튼의 맵 탭 내 정확한 배치/비주얼. (`map-inspector-tab.tsx` + page.tsx `mapTabSlot` 합성 지점, page.tsx ~8387.)
- **1.5×3cm 정확 수치 · 엣지 라우팅 · 배치**(상대좌표 vs 오토레이아웃) — 구현 중 시각 검토로 확정.
- **북마크 주입 폴백(옵트인):** 하위 섹션에 북마크가 없고 그래도 하위 링크가 필요할 때만. 양식 영향 0(빈 마커 태그)이나 긴 문서 재작성 도구 리스크가 있어 실물 확인 후에만.

## 12. 제외 (v1 아님)

- 북마크 주입 · 완성 문서 병합.
- 이미 그려진 기존 노드에 섹션 링크 부여(드래그-생성만 지원).
- 비교 화면 지원.
- 맵 탭 Word 표현(§11 이월).
