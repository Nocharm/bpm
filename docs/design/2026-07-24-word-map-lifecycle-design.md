# Word 맵 — 맵 탭 분리 표현 · 생성 분기 · 라이프사이클 — 설계

- 날짜: 2026-07-24
- 상태: 사용자 승인 (브레인스토밍 축별 확정)
- 브랜치: `dev` (기준 `d26d987`)
- 선행: [Word 맵 섹션 링크 설계](2026-07-18-word-map-section-linking-design.md) — 섹션 링크 본체·파서·완결 문서 생성기

## 1. 배경 · 정체성 결정

섹션 링크 본체(선행 설계)가 dev에 머지된 뒤 남은 과제: **맵 탭에서 word 맵을 어떻게 표현하고, 두 맵 종류의 분기를 어디에 두며, word 맵의 생애주기를 어떻게 정의하는가.** 현재는 `MapOut.mode`가 내려오지만 홈 UI가 전혀 사용하지 않아 두 종류가 구분 없이 섞이고, word 맵도 일반 맵과 동일한 승인 워크플로 표면을 그대로 노출한다.

**정체성 확정: word 맵은 SOP 문서의 부속 산출물이다** (순서도 생성 도구). 일반 프로세스맵과 대등한 조직 자산이 아니다. 여기서 나머지 축이 전부 따라온다:

| 축 | 결정 |
|---|---|
| 맵 탭 표현 | Maps 탭 내 **섹션 분리** — 문서 중심 평면 목록, 조직도·홈 집계에서 제외 |
| 생성 분기 | 홈 상단 버튼 제거 → **Word documents 섹션 헤더로 이동**. 생성 요구는 자동값으로 축소 |
| 워크플로 | 백엔드 무변경, **UI만 간소화** (셀프 게시 경로 활용, 승인 표면 숨김) |
| 개정 대응 | 전체 포함 — 재임포트 노출·stale anchor 배지(백로그 N2 해소)·타임스탬프 2종 |
| 승격 | word 맵(게시본) → **일반 맵 v1 초안으로 승격 복사**, 섹션 노드 일괄 일반 노드 변환 |

라이프사이클 전체: **생성(문서 임포트) → 편집 → 완결 문서 생성 → (문서 개정 시) 재임포트 → stale 정리 → 재생성 … → (선택) 일반 맵으로 승격 복사 / 휴지통.**

## 2. 맵 탭 표현 (프론트만)

- **좌측 컬럼**: `MyDeptFavorites`·`OrgAccordion`에 넘기는 목록에서 `mode === "word"` 제외. 그 아래 접이식 **"Word documents" 섹션** 신설(신규 컴포넌트, `data-id` 부여) — 부서 트리 없이 **doc_name 중심 평면 목록**, `updated_at` 내림차순.
  - 행 구성: 맵 이름 · 문서명(`doc_name`) · 섹션 수(`doc_sections.length`) · 마지막 재임포트/완결 문서 생성 시각 · **재생성 힌트**(§5).
  - 행 액션: 열기 · 재임포트 · 승격 복사(§6).
- **우측 대시보드**: `HomeDashboard`에 전달하는 maps에서 word 제외 — 문서 상태 도넛·승인 카드·최근 열람 목록 전부. 집계는 프로세스 현황 지표이므로 word 맵은 오염 없이 빠진다.
- **상세**: word 맵 선택 시 기존 `MapDetailCard` 재사용 + 문서 메타 행(문서명·섹션 수·타임스탬프 2종) 추가. `latest_version_status` 배지는 word 맵에서 숨김(§4).
- 목록 응답은 이미 `mode`·`doc_name`·`doc_sections`를 실어 내려보내므로 분리·필터·문서 메타 표시는 **백엔드 무변경** — 단 행의 타임스탬프·재생성 힌트는 §5의 신규 컬럼에 의존.

## 3. 생성 분기 · 자동값 축소

- 홈 상단의 "Create from Word document" 버튼 제거 → Word documents **섹션 헤더의 생성 버튼**으로 이동. CSV·일반 생성은 상단 유지. 분기점 = 공간(맵 영역 vs 문서 영역).
- **생성 플로 축소**: `WordCreateModal` 파싱 후 create-map-dialog 전체 핸드오프를 폐기하고, **맵 이름(문서명 프리필)만 확인하는 최소 단계**로 대체. 생성 시:
  - `owning_department` = 내 org_path **말단 부서 자동** (백엔드 필수 필드 — 프론트가 자동으로 채워 전송, 백엔드 무변경).
  - 생성 직후 승인자 = **본인 자동** (`setApprovers` 멱등 PUT — csv-create 후속 호출 선례를 따르되 부분실패 재개 시 멱등성 주의).
  - `visibility` = 기본(private).
- **폴백**: 부서 정보가 없는 유저(admin.sys류)는 부서 피커 1개만 노출.

## 4. 워크플로 UI 간소화

- **백엔드 무변경.** 승인자=[본인]이므로 기존 **셀프 게시 팝오버**(submit→approve→publish 체인)가 그대로 원클릭 게시로 동작한다. 완결 문서 생성이 사실상의 "게시"이고, BPM 내 게시는 그 전제(승인본 확보)일 뿐이다.
- word 표면에서 승인 상태 노출 축소: 홈 섹션 행·상세 카드에서 `latest_version_status` 배지 숨김(문서 메타로 대체). **설정 페이지는 무변경**(고급 사용자용 존치 — 타인 승인자 지정 등은 여전히 가능).

## 5. 개정 라이프사이클 (백엔드 소폭)

- **타임스탬프 2종 신설** (`ProcessMap` 컬럼, KST `clock.py`, `db.py _ADDED_COLUMNS` 등록 필수, `MapOut` 노출):
  - `doc_imported_at` — `PUT /maps/{id}/word-doc`(재임포트) 성공 시 서버가 스탬프.
  - `doc_generated_at` — 완결 문서 생성은 클라이언트 전용(원본 파일이 브라우저에만 있음)이므로, 생성 성공 후 프론트가 신규 경량 엔드포인트 **`POST /maps/{id}/word-doc/generated`**(editor 이상, 시각만 기록)를 호출.
- **재생성 힌트** (클라 파생, 추가 백엔드 없음): `doc_imported_at > doc_generated_at` 이면 "문서를 재임포트한 뒤 완결 문서를 재생성하지 않음" — 홈 word 행·상세 카드에 힌트 표시.
- **stale anchor 배지 (백로그 N2 해소, 클라 파생)**: `doc_sections`의 앵커 집합에 더 이상 없는 `section_anchor`를 가진 섹션 노드 → **캔버스 노드 경고 배지 + 섹션 패널 상단 경고 카운트**. 재임포트가 앵커를 못 찾아도 노드는 보존(자동 삭제 없음) — 사용자가 직접 재연결하거나 삭제. 홈 목록에서의 stale 정밀 집계는 스코프 밖(§9) — 홈은 재생성 힌트로 갈음.
- **재임포트 진입**: 현행 인스펙터 + 홈 Word documents 행 액션에도 노출.

## 6. 승격 복사 — word 맵 → 일반 맵 v1 초안

SOP 순서도로 시작한 word 맵을 정식 프로세스맵으로 승격하는 경로. **기존 `POST /maps/{id}/copy`가 이미 "최신 승인본(approved/published) → 새 맵 v1 'As-Is' draft 클론" 계약**이므로 확장 플래그로 구현한다.

- **`MapCopy` 확장**: `convert_to_normal: bool = False` + `owning_department: str | None`(지정 시 오버라이드).
- **서버 변환** (`convert_to_normal=True`일 때):
  - 새 맵: `mode="normal"`, `doc_name=""`, `doc_sections=[]` (상속 차단 — 현행 copy는 mode·문서 카탈로그를 상속함).
  - `clone_graph` 후 새 버전의 섹션 노드 일괄 변환: `node_type="process"`, `section_anchor=""`. **`url`·`url_label`(원본 SOP 외부 링크)은 유지** — 일반 노드의 표준 필드라 URL 배지로 계속 유용하고, 원치 않으면 개별 삭제 가능.
  - 그 외 그래프(노드 속성·파라미터 6필드·엣지·분기 라벨·그룹·좌표)는 동일 모델이라 무변환 클론.
- **게시본 필수**: 승인본 없으면 409 (기존 계약 그대로). UI는 게시본 없으면 버튼 비활성 + 셀프 게시 유도 툴팁.
- **승격 관문 다이얼로그** (정식 맵으로의 관문 — word 자동값이 그대로 승격되는 것 방지): 이름(기본 `{원본} (Copy)`, 유일성은 기존 가드) · 오우닝 부서 피커 · 승인자 피커 — create-map-dialog 부품 재사용. 승인자는 copy 성공 후 `setApprovers` 멱등 PUT.
- **진입**: word 상세 카드 + Word documents 행 액션 "Convert to process map".
- 원본 word 맵은 불변. 승격 시 앵커가 소거되므로 **stale 문제는 승격본에서 자연 소멸**.

## 7. 백엔드 변경 요약

| 항목 | 내용 |
|---|---|
| 컬럼 | `ProcessMap.doc_imported_at`·`doc_generated_at` (nullable datetime, `_ADDED_COLUMNS` 등록 — 운영 DB 자동 ALTER) |
| `PUT /maps/{id}/word-doc` | 성공 시 `doc_imported_at` 스탬프 |
| `POST /maps/{id}/word-doc/generated` | 신규 — editor 이상, `doc_generated_at` 스탬프만 |
| `POST /maps/{id}/copy` | `MapCopy.convert_to_normal`·`owning_department` 확장 + 섹션 노드 변환 |
| `MapOut` | 타임스탬프 2종 노출 |

워크플로(versions.py)·권한 로직은 무변경.

## 8. 검증 계획

- **백엔드 pytest**: 재임포트 스탬프 · generated 스탬프(권한 게이트 포함) · copy 변환(섹션→process, `section_anchor` 소거, `url` 유지, mode/doc 소거, `owning_department` 오버라이드) · 승인본 없음 409(기존).
- **프론트 vitest**: word 필터 파생(조직도/집계 제외) · 재생성 힌트 파생 · stale anchor 파생.
- **Playwright**: 홈 Word documents 섹션 노출·행 액션 · word 생성 축소 플로(자동값) · 집계 제외 · 승격 다이얼로그 플로.
- 기존 게이트 전체 그린 유지 (pytest·vitest·tsc·lint·build).

## 9. 스코프 밖

- 문서 영역의 최상위 탭 승격 (섹션 분리로 시작, 실사용 후 재평가).
- word 맵 전용 백엔드 워크플로 게이팅 (UI 간소화로 충분).
- 홈 목록에서의 stale 정밀 집계 (노드 로드 필요 — 재생성 힌트로 갈음).
- CSV 왕복의 `section_anchor` 누락 (백로그 N1 유지).
- 설정 페이지 간소화.
