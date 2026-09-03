# 컨설턴트 임포트 후속 2~6 — 설계

2026-09-03 · 브랜치 `feat/consultant-import-fallbacks` · 1번(거버넌스 확인 적용)에 이어 나머지 5건.
사용자 지시(2026-09-03)를 그대로 따르되, 모호한 지점은 아래 "결정"에 가정으로 명시한다.
구현 순서 **6 → 4 → 2 → 3 → 5** — 4(지정값 연간횟수/FTE)가 5(모달 재디자인)의 전제이고, 2의 "작성자 입력"은
5의 필드별 입력 창에 원문 메모로 함께 넣는 것이 가장 자연스럽기 때문.

## 6. 인스펙터 SP 섹션 버튼 줄바꿈

- `subprocess-inspector-card.tsx` 액션 행(`mt-2 flex items-center gap-1.5`)을 `flex-wrap`으로, 버튼은
  `whitespace-nowrap`. 폭이 모자라면 마지막(`ml-auto`) 버튼이 다음 줄로 내려간다.
- 인스펙터 최소 폭은 이미 300(리사이즈 클램프 `Math.max(300, …)`, 기본 360) — 변경 없음, 확인만.

## 4. SP 지정값 연간 수행횟수 · FTE (`sp_annual_count` · `sp_fte`)

- **모델**: `process_maps.sp_annual_count`, `sp_fte` — `String(50)`, `db.py _ADDED_COLUMNS` 등록(운영 자동 ALTER).
- **API**: `MapOut.sp_annual_count/sp_fte`(from_attributes) · `SubprocessDesignationIn.annual_count/fte`
  (headcount와 같은 숫자 정규화, 무효는 "") · 지정 PUT이 저장 · `SubprocessRefOut.annual_count/fte`
  (subprocess.py select 추가) · `library.py` SP 목록 raw dict 2곳에 추가.
- **임포트**: `rows[].fields.annual_count/fte` → 맵 `sp_annual_count/sp_fte`에도 착지(신규·기존 모두,
  `fields_changed` 비교 포함). L5 연계 캔버스 SP 노드 채움은 그대로(빈 값만 채움).
- **의미**: 지정값 = 담당자 기준 참고치. 연결 맵의 SP 노드는 지금처럼 각자 `annual_count/fte`를 가진다.
- **FE**: `DesignationForm.annual_count/fte` + 모달 파라미터 섹션에 2행 추가(Σ 없음 — 노드 합산이 무의미) ·
  `putSubprocessDesignation` 바디 · 폼 생성 지점 4곳(inbox·인스펙터 카드·설정 패널·모달 initial) ·
  인스펙터 카드/설정 패널 표시 행 · `node-metrics-card`의 subprocess 노드 annual_count/fte 행에
  **참고치 힌트**(`Info` 아이콘 + Tooltip "Designated reference: X") — 값은 `selectedSpRef.annual_count/fte`.
  `SP_PARAM_FIELDS`(Σ 대상 5종)는 유지, `SP_CONTEXT_FIELDS = ["annual_count", "fte"]` 신설.

## 2. 폴백 6종 — 작성자 입력 · 뷰어 조회 · 요약 노출

- **FallbackHint 빈 값 + 편집 가능이면 "추가" 어포던스**: 점선 톤 `MessageSquarePlus` 아이콘 → 클릭 시
  편집 모드로 팝오버. 지금은 원문이 비어 있으면 아무것도 안 그려 새 맵/새 노드에서 작성이 불가능했다.
  적용 지점 변경 없음(노드 system, 설정 › 상세 5종).
- **맵 단위 폴백 5종의 편집 권한**: 설정 › 상세 카드는 오너 전용 유지(지정 PUT·process-fields PATCH 모두
  owner 가드). "새 맵에서 작성자 입력"은 **5번 모달의 필드별 입력 창에 원문 메모 칸**으로 제공 —
  duration→`total_time_fallback`, touch_time→`touch_time_fallback`, system→`system_fallback`,
  annual_count→`frequency_fallback`. `SubprocessDesignationIn`에 4필드를 `str | None = None`으로 추가
  (None=미변경, 구 클라이언트 호환). GMP 원문은 GMP가 설정 카드에만 있으므로 그대로.
- **뷰어 조회(읽기 전용 FallbackHint, onSave 없음)**:
  - 홈 상세 카드 인터뷰 블록: GMP·실작업시간 줄 옆 + 총시간/시스템 줄 신설(값 또는 원문이 있을 때만).
  - SP 인스펙터 카드(`subprocess-inspector-card.tsx`) 속성 행: duration/touch_time/system/headcount 옆.
  - 비교 화면 요약 탭: "Designation notes" 블록 — 맵 단위 원문 5종을 읽기 전용 목록으로(캔버스에는 없음).
- 노드 `system_fallback`은 이미 인스펙터에서 편집·Apply, 읽기 전용 열람 가능 — 추가 어포던스만.

## 3. 맵 노트 CRUD — 오너 작성·수정, 조회 권한자 열람, 필 태그, L5·일반맵

- **맵 스코프 API** (`/maps/{id}/notes`): GET viewer(기존) · **POST/PATCH/DELETE owner**.
  바디 `{kind(≤50), title?(≤300), text}`. 새 노트 `source="user"`. 임포트 노트를 수정하면
  `source="user"`로 바뀌어 재임포트 replace에서 살아남는다(같은 내용이 재전달되면 중복 1건이 생길 수
  있음 — 사용자가 지운다. 문서화).
- **L5 스코프 API** (`/categories/{id}/notes`): GET 로그인 사용자 전원 → `{can_edit, notes}`;
  POST/PATCH/DELETE는 sysadmin 또는 `is_category_admin`(체인 권한자). `category_code`는 카테고리 code.
- **kind 프리셋**: `note · exception · voc · rule_basis · open_item` + 직접 입력(≤50). 배지 표기는
  i18n 라벨(프리셋) / 원문(그 외). exception만 error 톤 유지.
- **FE `MapNotesSection`**: props `scope: {mapId} | {categoryId}`, `canEdit`. 헤더에 "Add" 버튼(canEdit),
  행마다 Edit/Delete(canEdit). 편집 폼: kind 칩 행(프리셋 + Other 입력) · title input · text textarea ·
  Save/Cancel. 삭제는 `ConfirmDialog`. 노트가 0건이어도 canEdit이면 섹션을 그린다(추가 진입점).
  마운트: 홈 상세 카드(canEdit=isOwner) · 에디터 맵 탭(!readOnly && owner) · SP 요약 모달(읽기) ·
  **L5 연계 캔버스 맵 탭**(`mode==="framework"`이면 `linkage_category_id` 스코프, can_edit는 서버 응답).

## 5. SP 지정 모달 재디자인 — 2열 단추(타일)

- 폭 `max-w-sm`(384) → `max-w-lg`(512). 672는 시선 이동이 좌우로 길어져 폐기(사용자 피드백). 본문 스크롤·아코디언 유지.
- **타일화 대상**: BPM attributes의 시스템·URL(라벨 포함), Parameters 7종(4번 포함). 부서·담당자 피커
  행과 Input/Output 편집기·설명은 편집기 성격이라 유지하되 Input | Output을 2열로 나란히.
- **타일**(`data-id="sp-tile-<field>"`): 2열 grid. 빈 값 = 아이콘 + 라벨(한 줄 말줄임). 값 있음 =
  아이콘 + 라벨(작게·톤다운) + **값은 우측 강조**. 값 자리가 모자랄 때만 라벨 생략(실측, 사용자 피드백
  2026-09-03). 아이콘은 `param-icons.ts` 재사용 + System=`Monitor`, URL=`Link`, annual_count/fte는 기존 매핑.
- **원문 메모 행(MapFallbackNotes)**: 행머리 아이콘(필드 아이콘 → 행 호버 시 노트 아이콘 스왑, 클릭=열람/추가/
  수정), 라벨·값은 `text-fine` 톤다운. 빈 행은 문구 없이 비활성 톤. 팝오버 폭 360 (사용자 피드백 2026-09-03).
- **입력 팝오버**(`data-id="sp-tile-popover"`): 클릭한 마우스 좌표에 고정 배치(뷰포트 클램프, body 포털,
  z 1350). 내용 = 라벨 · 필드별 안내 문구 · 입력(ParamInput / text / URL+라벨 2칸) · Σ(합산 5종만) ·
  **Interview note** textarea(폴백 보유 4필드). Enter=확정+닫기, Esc=취소, 바깥 클릭=확정+닫기.
  비용 배타(KRW↔USD)는 타일 비활성 톤 + 팝오버 안내로 표현.
- 저장 계약은 기존 PUT 그대로(+4번 2필드 +2번 폴백 4필드).

## 검증

- BE pytest(신규: 지정 PUT annual/fte·폴백 저장, 노트 CRUD 권한 매트릭스, L5 노트 can_edit, 임포트 sp 착지)
  + ruff · FE vitest/tsc/lint · Playwright: 지정 모달 타일/팝오버 · 노트 추가/수정/삭제 · 홈 카드 폴백 힌트 ·
  인스펙터 참고치 힌트 — 스크린샷 사용자 공유.
- 문서: `docs/qa/interview-import-field-map.md`(annual_count/fte 착지 행), `docs/spec.md` 노트 API 한 줄,
  PROGRESS.
