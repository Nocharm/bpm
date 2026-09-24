# PROGRESS 아카이브 — 전체 이력 스냅샷 (2026-07-20)

> 루트 `PROGRESS.md`는 최근 요약 + 이 파일 포인터. 여기엔 2026-07-20 시점까지의 전체 상세 이력이 보존돼 있다(더 오래된 요약은 하단 compact 섹션, 원문은 git history).

## ── 2026-09-24 이동분 (PROGRESS 경량화 — 원문 그대로) ──

## 2026-09-12 — 9월 1차 공지 초안 + 매뉴얼 6종·AI 챗 매뉴얼·슬라이드 최신화 (dev)

- 08-25(8월 3차) 이후 dev 전체(feat 235·fix 91)를 `docs/notices/2026-09-12-release.md`로 정리 — 홈 개인 대시보드·L5 연계 캔버스/확정 거버넌스·슬롯 승인·역할(Role)+카탈로그·AI 역할 계약·CSV Role·노드 편집 창·낡은 참조 감사·인터뷰 임포트 0.5/리포트·백업. md 매뉴얼 3종(ko)에 09-07 이후 델타(대시보드 후속·1클릭 지연·Issues/Stale refs·레벨 상세 패널·역할/시스템 카탈로그·고아 경고·Catalogs/Orphaned refs 탭·임포트 0.5·2열 리포트·유지/교체) 반영 후 en은 에이전트가 미러. `backend/app/manual.md`(AI 챗 근거)는 7/20 이후 낡은 서술(CSV 14열·파라미터 6개·30분 자동 해제·딥 뷰)을 전면 정정하고 홈 대시보드·업무 체계 절을 신설. 슬라이드 4종은 `build_slides.py`(scratch) 증분 수술 + 신규 캡처 5종(대시보드·역할·모달·Catalogs·Orphaned refs)으로 재생성·PDF 재출력.

## 2026-09-12 — 데이터 계약 3종 최신화: AI·CSV·컨설턴트 임포트에 역할·카탈로그 정규화 (dev)

- **결정(사용자)**: AI(챗 ops/graph·인터뷰 드래프터)는 담당자 실명을 쓸 수 없고 사람 필드는 **역할(`assignee_role`)만** — `AiNodeAttributes.assignee` 제거(에코해도 pydantic이 버림), 프롬프트에 `[역할 목록]`·`[시스템 목록]` 주입, 인터뷰 roles 스테이지가 역할 후보를 options로 묻는다. CSV·컨설턴트 임포트의 시스템은 에디터 `commitSystem`과 같은 규칙(별칭→정식 표기, 미일치→Other+원문 메모, 기존 메모 다르면 유지+경고). `rows[].ownerRole`은 `sp_assignee_role`에 착지(설명 줄도 유지), L6 action 노드엔 전파하지 않음.
- 규칙 이중 구현: FE `commitRole`/`commitSystem`(`lib/catalogs.ts`) ↔ BE `commit_role`/`commit_system`(`app_settings.py`). CSV는 `Role` 열(Assignee 다음) 왕복 + Other 노드는 System 셀에 원문 메모를 실어 재임포트가 같은 Other+메모로 복원. 변환단(`buildGraphFromCsv`·`buildGraphFromAiProposal`·`aiNodeToGraphNode`·set_attr)은 카탈로그를 **인자**로 받는다(`CsvImportContext.catalogs`, 에디터는 `catalogsRef`). 임포트 리포트 행 2종(`system 'x' normalized to 'y'` / `not in catalog - stored as Other`) FE 분류·i18n 추가. 핸드오프 문서는 소비 완료로 삭제. 게이트 tsc/lint/vitest(994)/ruff/pytest(1483)/COMPONENTS.md green.

## 2026-09-12 — 담당 역할 잔여 표면 동기화 (dev)

- `assignee_role`/`sp_assignee_role`가 라이브러리 행·피크(디테일/목업)·SP 지정 패널·sp-detail 타일 카운트·플레이스홀더 낙관 참조까지 전 표면에 노출되도록 마감. 그룹 일괄편집 모달에 `assignee_role`을 `system`과 같은 단일필드 모드(append 제외, `SuggestInput` 카탈로그 자동완성)로 추가. 백엔드 `library.py` raw select 컬럼 인덱스 시프트에 주의(assignee 뒤 삽입 → 이후 튜플 언패킹 전부 한 칸씩 밀림). 게이트 tsc/lint/vitest(982)/ruff/pytest(1476)/COMPONENTS.md green.

## 2026-09-12 — 역할·카탈로그 트랙 마무리 → origin/dev 반영 (dev)

- 이번 라운드(2026-09-11~12, 역할 칸·카탈로그 엔진·별칭·노드 전환·카탈로그 탭·역할 전 표면 동기화·타일 2:1·자동완성)를 `origin/dev`에 푸시. 다음 세션 타깃(AI 계약·CSV 임포트·컨설턴트 임포트 최신화)은 위 항목에서 완료·핸드오프 문서 삭제.

## 2026-09-12 — Other 노드 원문 메모 클램프 (dev)

- 캔버스 시스템 줄: `Other`면 라벨 대신 원문 메모를 **항상 1줄 말줄임**(`title`로 전문), 전문은 더블클릭 편집 모달에서 — 호버 확장안은 사용자 결정으로 철회(노드 높이 고정). 편집 입력의 raw `Other`·필터에 가려진 선택 행·후보 접기는 현행 유지로 완결.
- 역할 타일: 값이 있으면 라벨 없이 칩만(`SpFieldTile labelHiddenWhenFilled`), 편집 가능한데 비어 있으면 라벨+짧은 대시 — 1/3 칸에서 "Revie…" 말줄임 해소.
- 모달 타일: 담당자·역할을 한 행 2:1(`DeptAssigneeTiles roleTile` 슬롯 + `SpFieldTile spanColumns`)로, 노드 편집·SP 지정 모달 동일. `SuggestInput`은 타이핑 중 접두 일치 첫 제안을 자동 하이라이트해 Enter/Tab으로 완성(부분일치는 자유값 보호 위해 제외).
- 역할 표면 동기화 리뷰 픽스: 피크 목업 노드의 역할을 담당자 줄 바로 뒤 플레인 행(담당자 토글 동승)으로, 역할만 있어도 표시. 일괄 편집 append 금지 판정을 `isSingleValuedBulkField` 한 곳으로(테스트), 역할 입력은 `SuggestInput` field 모드(모달 폭·좌측 정렬).

## 2026-09-12 — Catalogs 탭 마스터-디테일 재구성 (dev)

- 밀도 재구성(칩 클라우드)을 탭(역할|시스템)+좌측 목록/우측 별칭 편집 2단 레이아웃으로 교체 — 두 `ManagedListCard` 모두 마운트 유지하고 비활성 탭은 `hidden`(미저장 초안 보존). 카드별 `selected`/`filter` state 신설, 로직(`mergeCatalogEntries`/`normalizeAliases`/`parseCatalogCsv`/resync·`Other` 잠금)은 무변경. i18n `catalog.filterPlaceholder`/`catalog.selectHint` 추가, `catalog.aliasesFor` 폐기(en/ko). 스모크(`pw-smoke-assignee-role.mjs`) Catalogs 섹션을 탭 클릭→추가→CSV 임포트→행 선택→별칭 적용→단일 저장 흐름으로 갱신. 게이트 tsc/lint/vitest(980)/COMPONENTS.md(CheckInput·HoverTip 사용처에서 catalogs-panel 제외) green.
- 리뷰 픽스: 탭 라벨 개수를 미저장 초안 기준(`onCountChange`, `catalog.count` 재사용)·`role=listbox/option`을 `aria-pressed` 토글 버튼으로(로빙 탭인덱스 없는 가짜 리스트박스 제거)·`catalog.inUse` 문구 "체크"→"클릭"·별칭 입력 autoFocus(선택별 remount)+Esc 되돌리기·필터 무일치 안내(`suggest.noMatch`)·후보 아이콘 14px·추가 버튼 텍스트 복원·`handleRemove` 잠금 가드. 스모크에 탭 전환 초안 유지·초안 개수·저장 후 선택 유지·2차 저장 4건 추가(19/19).

## 2026-09-12 — Settings Catalogs 탭 밀도 재구성 (dev)

- `catalogs-panel.tsx` 두 카드를 `max-w-6xl xl:grid-cols-2`로 나란히, 카드 헤더를 한 줄(제목·건수 배지·`HoverTip` 정보 아이콘·우측 추가입력+추가+CSV+저장)로 압축. 칩·별칭 편집 줄·사용 중 값 후보를 컴팩트 톤(`text-fine`)으로, 후보 8개 초과 시 스크롤. 로직(`applyAliases`·`addValues`·resync·`Other` 잠금) 무변경, `data-id` 전량 유지. i18n `catalog.count` 추가(en/ko). tsc/lint/vitest(980)/COMPONENTS.md(HoverTip 사용처에 catalogs-panel 추가) 전체 green.

## 2026-09-12 — 캔버스 담당자 흑백 칩·역할 텍스트 (dev)

- `NodeFields`(`process-node.tsx`) 담당자 줄 톤 반전 — 휴식=역할 플레인 텍스트(`BriefcaseBusiness` 아이콘), 활성=담당자 이름을 `parseAssignees`로 나눠 흑백 칩(사람마다 1개, wrap 허용)으로. 기존 `RoleChip tone="mono"` 캔버스 사용처 제거(다른 표면은 액센트 톤 유지, `role-chip.tsx` 자체는 무변경). 게이트 tsc/lint/vitest(980) green, COMPONENTS.md 갱신(RoleChip 사용처에서 process-node.tsx 제외).

## 2026-09-12 — assignee_role/카탈로그 최종 픽스 웨이브 (dev)

- **Task 1(catalog-alias-node-swap)**: 카탈로그 항목(`assignee_roles`/`systems`)이 `{value, aliases[]}` 엔트리로 승격 — `app_settings.py`에 `normalize_managed_entries`/`get_managed_entries`/`set_managed_entries` 추가(불변식 "별칭 하나 → 정식 표기 하나": 값이 별칭보다 우선, 겹치면 별칭 폐기, 항목당 20개 상한). `CatalogEntryIn`/`CatalogEntryOut` 스키마 신설, PUT은 구 문자열 페이로드도 그대로 받아 승격(`pw-smoke-assignee-role.mjs` 호환). `Other`는 저장된 별칭을 보존한 채 항상 0번. 전체 스위트 1475 green.
- 전체 브랜치 리뷰에서 나온 잔여 6건 정리: `assignee_role`이 빠져 있던 비교/확정 시그니처 3곳(`change-summary-section.tsx` `buildLiveGraph`·`compare/page.tsx` `buildAppNodes`+인스펙터 행 목록·`backend/app/framework_confirm.py` `_canvas_content_signature`) — 역할만 바꿔도 확정 게이트가 안 걸리고 승인 탭 변경 요약이 매 노드를 오탐하던 문제. `SuggestInput` blur가 호버 중이던 항목을 커밋하던 버그(`settle(useHighlight)`로 분리, Enter만 하이라이트 반영). 스모크 스크립트(`pw-smoke-assignee-role.mjs`) 시드/정리 순서·에러 무시 정리, 홈 SP 섹션 attrCount 역할 단독 입력 카운트 누락 픽스.
- 참고: `get_exposed_positions`는 공용 관리 목록 헬퍼(`normalize_managed_list`) 위로 재구현되며 대소문자 무시 중복 제거 + 항목 100자 컷이 붙었다 — spec §3.1 "동작 불변" 전제와 다른 미세 동작 변화(관리자가 대소문자만 다른 직책을 두 번 넣거나 100자 넘는 값을 넣는 극단 케이스에서만 관측).
- **Task 2**: 프론트 `CatalogEntry` 타입·별칭 정규화·CSV 2열 — `api.ts` `Catalogs`/`AppSettings.assignee_roles|systems`가 `CatalogEntry[]`, `lib/catalogs.ts`에 `findCatalogEntry`/별칭 인식 `normalizeToCatalog`·`commitSystem` 추가, `lib/catalog-csv.ts`를 value,aliases 2열 파싱+`mergeCatalogEntries`(별칭 합집합)+`normalizeAliases`(서버 불변식 FE 미러)로 교체. tsc 잔여 에러는 예상대로 소비자 4곳(`bpm-attribute-picker`·`role-tile`·`system-suggest-input`·`catalogs-panel`, Task 3·4에서 해소) 한정, 전체 vitest 976 green. 리뷰 픽스: `parseCatalogCsv`가 같은 값의 여러 행을 `normalizeAliases` 직행 대신 `mergeCatalogEntries`로 합쳐 별칭이 통째로 버려지던 문제 수정, 전체 vitest 977 green.
- **Task 3**: `SuggestInput`이 `SuggestOption{value, aliases?}`(`CatalogEntry`가 그대로 만족)를 받아 별칭까지 `filterByQuery`로 검색하고, 값·별칭 정확 일치는 정식 표기(`value`)로 치환해 커밋 — 드롭다운 항목에 별칭 보조 텍스트(`text-fine text-ink-tertiary`) 추가. 소비자 3곳(`bpm-attribute-picker`·`role-tile`·`system-suggest-input`)은 `useCatalogs()`가 이미 `CatalogEntry[]`를 반환해 무변경으로 타입이 맞음. tsc 잔여 에러는 예상대로 `catalogs-panel.tsx`(Task 4) 한정, vitest 977 green.
- **Task 4**: `catalogs-panel.tsx`를 `CatalogEntry[]`로 마무리 — 값 칩이 버튼으로 바뀌어 클릭 시 인라인 별칭 편집 줄(`applyAliases`, `normalizeAliases`로 서버 불변식 재적용) 토글, 별칭 있으면 `+n` 배지. `Other`는 삭제만 잠금이고 별칭은 편집 가능. CSV 임포트 결과 문구에 병합된 별칭 수 추가, 카드 힌트 아래 `catalog.csvHint` 한 줄. tsc 전체 clean(잔여 8건 해소), vitest 977 green, COMPONENTS.md 무변경.
- **Task 5**: 캔버스 노드 담당자/시스템 줄 휴식↔활성 전환 — `NODE_ALT_DELAY_MS`(1000ms, `lib/canvas.ts`) 이상 호버·선택이 지속되면 담당자 줄(역할 칩→담당자 이름)·시스템 줄(정식명→원문 메모)이 opacity 교차 페이드. `RoleChip`에 `tone="mono"` 추가(캔버스 안은 흑백, 다른 사용처는 액센트 유지). `useDelayedFlag`는 즉시 리셋은 render-time state adjust, 지연 설정은 effect+setTimeout(React Compiler lint 준수). tsc/lint/vitest(977) 전체 green, COMPONENTS.md 무변경.
- **Task 6**: `pw-smoke-assignee-role.mjs`를 엔트리 카탈로그로 확장 — 별칭 입력(`검토자`→`Reviewer`, `랩정보`→`LIMS`) 정규화 확인, 담당자 줄 휴식(역할 칩)↔호버 1300ms 뒤 활성(담당자 이름) 전환, Catalogs 탭 CSV 2열 임포트+칩 별칭 편집→저장→`/catalogs` deep-equal 검증(15/15 PASS). 설계 문서 상태를 "dev 구현 완료"로 갱신.
- **최종 픽스 웨이브**: Catalogs 탭이 다른 항목과 충돌하는 별칭을 `normalizeAliases`가 조용히 제외하던 UX 결함 수정 — `applyAliases`/`addValues`(handleAdd·candidate 체크·CSV 임포트 공용)가 드롭된 개수를 계산해 `catalog.aliasesDropped` 안내를 노출. 리뷰에서 빠졌던 주석 2건(`process-node.tsx` 경고 아이콘, `pw-smoke-assignee-role.mjs` 300ms 대기 사유) 복원. tsc/lint/vitest(977)/COMPONENTS.md 전체 green.
- **시스템 원문 메모 3택**: 시스템이 기타로 떨어질 때 기존 원문 메모를 교체/추가/취소 3지 선택으로 통일(`SystemSuggestInput` 재작성) — 행 모드는 `ModalBackdrop` 다이얼로그(z 1300), 필드 모드(타일 팝오버 z 1350 안)는 다이얼로그가 가려지므로 입력 아래 인라인 줄로 대체. `appendSystemNote`(`lib/catalogs.ts`) 순수 함수로 추가 병합, `keptNote` 안내문·`confirmReplace` prop·구 i18n 키 3종 폐기. tsc/lint/vitest(980)/COMPONENTS.md 전체 green.

## 2026-09-11 — 노드 assignee_role 컬럼(백엔드) (dev)

- `nodes.assignee_role`(단일값, 담당자 옆 표시) 신설 — `NodeIn`에 trim validator 얹고 graph upsert·version clone에 이월. 감사(`ref_audit.scan_user_refs`)는 역할을 사람 이름으로 취급하지 않도록 무영향 고정(테스트로 못박음). `process_maps.sp_assignee_role`은 Task 3에서 모델을 붙일 예정이라 DDL만 함께 등록(`db.py` `_ADDED_COLUMNS`). 전체 스위트 1471 green.
- **Task 3**: `process_maps.sp_assignee_role` 모델 컬럼 + SP 지정 PUT/응답/호스트 그래프 대칭 — `SubprocessDesignationIn.assignee_role`(trim, 빈값 None) 저장, `MapOut.sp_assignee_role`로 상세 노출, `SubprocessRefOut.assignee_role`로 호스트 맵 `subprocess_refs`에 상속. 전체 스위트 1472 green.

## 2026-09-11 — 관리 목록 엔진(역할·시스템 카탈로그) 백엔드 1단계 (dev)

- `app_settings.py`에 범용 관리 목록 헬퍼(`normalize_managed_list`/`get_managed_list`/`set_managed_list`) 추가하고 기존 `get_exposed_positions`를 그 위로 재구현. 신규 목록 `assignee_roles`(역할, 빈 목록 기본)·`systems`(시스템, `Other` 예약 항목이 항상 0번)를 얹고 `GET /api/catalogs`(로그인 유저 전원 읽기)를 신설, `PUT /admin/app-settings`에도 편집 필드와 `available_systems`(사용 중 값 승격 후보) 노출. 테스트 4종 추가, 전체 스위트 1468 green.
- **Task 4**: 프론트 카탈로그 클라이언트 기반 — `api.ts` `Catalogs`/`getCatalogs()`·`AppSettings.assignee_roles/systems/available_systems`·`putAppSettings` 패치 확장. `lib/catalogs.ts` 신설 — 모듈 캐시 `useCatalogs()`/`invalidateCatalogs()`(`lib/directory.ts` 패턴) + 순수 함수 `normalizeToCatalog`/`commitSystem`/`formatSystem`(시스템 불일치=Other+원문 메모 보존 규칙). i18n 12키(en/ko) 추가. 아직 UI 미연결. `catalogs.test.ts` 8종 green, 전체 vitest 968 green, tsc/lint clean.
- **Task 5**: `components/suggest-input.tsx` — 자유입력+제안 드롭다운 공용 엔진(`SuggestInput`). `lib/search.filterByQuery` 랭킹·↑↓/Enter/Esc/blur 확정·body 포털 `z-[1400]`(row=인스펙터 행 / field=팝오버 전폭). 아직 미사용(다음 태스크에서 연결). a11y 경고(`role="combobox"`에 `aria-controls` 누락) 1건을 `aria-controls`+메뉴 `id` 추가로 해소. 리뷰 지적으로 메뉴가 열린 동안의 외부 `value` 변경 유실을 픽스 — `seen`/`draft` 동기화를 `!open`일 때만 함께 반영하도록 조건 통합. tsc/lint clean, vitest 968 green.
- **Task 6**: 프론트 데이터 배관 — `assignee_role`을 `api.ts`(GraphNode/SubprocessRef/MapSummary/SubprocessDesignationBody)·`canvas.ts`(NodeData/spAssigneeRole)·page.tsx 그래프↔노드 변환 5곳+신규 노드 리터럴 3곳·`csv-import.ts`(NODE_DEFAULTS/mergeNode 기존값 보존/AI 표면 제외)·`diff.ts`(ChangedField/FIELD_KEYS/FIELD_MSG)·`excel-export.ts`/`excel-wbs.ts`(Role 열, Assignee 다음)까지 스레딩. CSV 열·AI 어트리뷰트는 노출 안 함(패스스루만). vitest 969 green, tsc/lint clean.
- **Task 7**: 역할 표시·편집 연결 — `components/role-chip.tsx` 신설(액센트 틴트 칩), 캔버스 담당자 줄(`process-node.tsx` NodeFields)·인스펙터 읽기 행(`attribute-read-rows.tsx`, SP 상속 공용)·편집 행(`bpm-attribute-picker.tsx`, `SuggestInput` 자동완성)에 배선, page.tsx 3개 호출부(일반 노드 읽기/편집·SP 읽기)에 `assignee_role` 전달. 부서·담당자 페어 로직과 무관 — role 행은 `onChange({ assignee_role })`만 호출. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(258개).
- **Task 8**: `components/permissions/role-tile.tsx` 신설(`DeptAssigneeTiles`와 분리, 클릭 위치 팝오버+`SuggestInput`) — 노드 편집 모달·SP 지정 모달(편집)·Subprocess 탭·홈 맵 상세 SP 섹션(읽기)에 배선. `DesignationForm.assignee_role` 필수 필드로 승격, 생성 6곳(usage tab·inspector card ×2·designation panel ×2·inbox) 전부 `sp_assignee_role` 채움. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(259개).
- **Task 9**: `components/system-suggest-input.tsx` 신설(`SuggestInput`+`commitSystem` 정규화 — 목록 일치=표기 저장, 자유값=Other+원문 메모, 인스펙터 행만 `ConfirmDialog` 교체/유지 확인) — 인스펙터 시스템 행·노드 편집 모달·SP 지정 모달 팝오버 3표면에 배선, `FallbackHint` 적용도 `commitSystem` 경유로 통일. 나머지 읽기 4표면(Subprocess 탭·인스펙터 카드·홈 맵 상세 SP 섹션·SP 프리뷰 피크)은 `formatSystem`으로 저장값 `Other`만 i18n 라벨 표시. 리뷰 픽스: `SuggestInput`이 커밋 직후(`resyncPending`) 값이 안 바뀌어도 draft를 저장값으로 되돌리도록 — 부모가 입력을 정규화·기각해도(시스템 Other 유지) 입력창이 버려진 글자를 보여주지 않는다. tsc/lint clean, vitest 969 green, COMPONENTS.md 재생성(260개).
- **Task 10**: 설정 Catalogs 탭 — `lib/catalog-csv.ts`(`parseCatalogCsv`/`mergeCatalogValues`, 1열 CSV 파싱+대소문자 무시 병합) + `components/settings/catalogs-panel.tsx`(역할·시스템 두 `ManagedListCard`, 칩 삭제·직접 추가·CSV 임포트·사용 중 값 승격 체크·저장 후 `invalidateCatalogs()`), 조직 카테고리에 탭 배선(sysadmin 편집/`getAppSettings`, 그 외 읽기전용/`getCatalogs`). i18n 18키(en/ko). vitest 972 green(신규 3), tsc/lint clean, COMPONENTS.md 재생성(261개). **리뷰 픽스**: 형제 카드 저장·재조회마다 미저장 초안이 날아가던 버그 — `seen` 참조 비교를 `JSON.stringify` 내용 비교(`valuesKey`)로, 조회 effect deps에서 `t` 제거(언어 토글 재조회 방지, 에러는 렌더 시점에 `humanizeApiError`).
- **Task 11**: Playwright 스모크(`scripts/pw-smoke-assignee-role.mjs`) — 인스펙터 역할 자동완성 저장→캔버스 칩, 시스템 자유값→Other+원문 메모, Catalogs 탭 CSV 임포트→`/catalogs` 반영, 9/9 green. 브랜치 종료 — 역할(assignee_role) 단일값 칸 + 관리 목록 엔진(역할·시스템 카탈로그) 기능 dev 구현 완료(CSV/AI 표면 노출은 후속 과제로 이관, `docs/design/2026-08-24-data-surface-parity-design.md` 후속 절).

## 2026-09-11 — 대시보드 섹션 순서·내 부서 직속 범위·점유 아코디언·승인 딥링크 (dev)

- **섹션 순서** (최근 열어본|업무 체계) → (내 부서|내 문서) → (승인 필요|최근 변경) — 사용자 지시. **내 부서**: 고른 부서가 직접 소유한 맵만 목록·지표에 올리고 하위 부서 맵은 건수 한 줄(`splitDeptMaps`, 직속 0건이면 빈 상태 + "하위 부서 맵 N건" 풋). 좌측 트리의 내 부서 섹션(`filterMyDeptMaps`, 자손 포함)은 그대로. **하위 부서 모달** `dept-sub-maps-modal.tsx`: 건수(지표 줄·빈 상태 풋) 클릭 → 부서별 맵 묶음. 부서 행 = 범위 전환(체인 밖 부서는 드롭다운 맨 위에 끼움, `isAllowedScope`는 내 최상위 조직 아래면 허용) + 좌측 조직 트리를 조상까지 펼치고 노드로 스크롤(`onRevealDept`, ref 소비 후 orgOpen 효과에서 스크롤), 맵 행 = 선택.
- **점유 목록**: `useClosingKeys` 아코디언 펼침/접힘, 행 선두는 맵 공개 범위 아이콘(Globe/Lock — `MeDashboardCheckoutOut.visibility` 추가) 이고 클릭 대기 링이 그 자리를 대체(`HoverLinkedRow leading`). **링 회전** 한 바퀴→반 바퀴(호 채움 0.6초 동일). **승인 필요 행** 클릭은 맵 상세 대신 `/inbox?approval=<kind>:<id>` — 인박스가 파라미터를 소비해 승인 탭 전환·카드 선택·스크롤(`?notification=`과 같은 패턴).
- **상태|버전 탭 + 막대 재디자인**: 내 부서·내 문서 헤더 우측 세그먼트 탭(`DistributionTabs`, 카드별 localStorage 영속). 버전 탭은 맵을 미게시·게시본 최신·업데이트 진행 중·재확인 필요 넷으로 센다(`bucketOfMap` — 만료/반려→재확인, 최신이 게시/확정→최신, 게시본 있는데 최신이 진행 중→업데이트 중). BE 목록 응답에 `latest_version_number`·`published_version_number` 추가(행 메타 `v1 → Draft` 칩). 막대는 2px 간격 알약 조각 + 폭 전환 애니 + 조각 호버↔범례 필 연동(선택/호버 중 나머지 조각 opacity 35%). 옛 `StatusBar`/`StatusLegend`는 범용 `Distribution`으로 통합(목업 `docs` 없음 — 아티팩트로 비교 후 A안 확정). **차트 채움 토큰** `--color-chart-*`(draft·pending·approved·published·rejected·expired) 신설 — 텍스트 시맨틱(added/changed/error)은 조각으로 깔면 칙칙하다는 피드백. `VERSION_STATUS_TONE.dot`이 전부 이 토큰을 보므로 맵 카드·행·비교 화면 상태 점도 같이 밝아진다(pill 텍스트 색은 그대로).
- **업무 체계 행 연계 캔버스 버튼**: 상시 노출 → 행 호버(키보드 포커스 포함) 시에만 grid 0fr→1fr로 열리며 등장(진입 300ms 지연·이탈 즉시, 맵 행 열기 버튼과 같은 규칙). ⚠️ 페이드는 `<button>`이 아니라 감싼 span에 — 전역 `button { transition: transform }`(globals.css, 무레이어)이 유틸리티 transition·delay를 덮어쓴다(맵 행은 `<a>`라 무사했음).
- **빈 상태 재배치**: `DashboardSection`에 `empty` 슬롯 — 아이콘+문구 세로 스택을 본문 중앙(2열 stretch 높이 기준)에 띄우고, 다음 행동(새 맵 만들기·체계 탐색·내 부서 맵·하위 부서 맵 N건)은 헤더 우측 `more` 링크로 이동. `DashboardEmpty.action` 제거. 빈 상태 컨테이너는 측정 래퍼(bodyRef) 밖이라 자연 높이·펼침 토글 판정에 안 잡힌다.
- **권한 게이트 검토**(변경 없음): 대시보드의 모든 블록이 기존 API 집합을 재사용 — 맵 계열은 `GET /maps`(load_my_roles 가시성 필터) 위에서 FE가 자르고, 최근 변경은 owner/editor 맵만(BE), 결재는 inbox 큐, 체계는 get_admin_scope seed, 점유·요청·알림·피드백은 본인 행만. 하위 부서 건수·최근 열람도 접근 가능 맵으로만 센다.

## 2026-09-11 — 대시보드 후속 4종 + 지연 0.6초·행 선택 지연 (dev)

- **프로필 부서**: 긴 조직 경로 대신 말단 부서만 무채색 필(전체 경로는 title). **최근 변경 행**: 조각(유저 필·맵 이름·버전 칩·글자)을 flex items-center로 세로 중앙 정렬(실측 중심 y 전부 동일), 맵 이름만 말줄임·버전 칩은 안쪽 span 말줄임.
- **섹션 간 맵 호버 연동** `dashboard-hover.tsx`(Provider+`useHoverMap`): 맵 행·최근 변경·결재·점유 행이 같은 맵이면 함께 `bg-surface-alt` 강조(pearl은 실측상 안 보여 한 단계 진하게). 버튼 행은 `HoverLinkedRow`로 통일(`data-map-id`·`data-linked`).
- **SP 섹션**: 빈 값 표기를 전부 짧은 대시(`–`)로. 부서는 값이 있으면 이전처럼 헤더 없이 필이 타일을 대신하되(사용자 재확인), `DeptPill` fill 변형의 여백·아이콘을 빈 타일 머리 행과 같게(px-2.5 py-2·아이콘 16·gap-2) 맞춰 두 상태의 아이콘·이름 좌표가 일치.
- **섹션 셸**: 접힌 채 넘치면 헤더는 고정하고 본문(`-body`, scroll-soft)만 안에서 스크롤 — 휠은 안쪽이 먼저, 끝에 닿으면 바깥 대시보드로 체이닝(기본값). 헤더 자체 클릭도 펼침/접기(안의 슬롯·더보기·토글은 전파 차단). 자연 높이는 헤더+본문 안쪽 래퍼 두 곳을 ResizeObserver로 잰다(스크롤 박스는 자기 높이가 잘려 못 잰다).
- **지연 실행**: `NAV_DELAY_MS` 1000→600(CSS 링 동기), 훅에 `toggleAction(key, run)` 추가 — 맵 행 클릭(카드 선택)·결재/점유/최근 변경 행 클릭도 0.6초 대기 후 선택, 재클릭 취소(맵 행은 상태 점 자리, 버튼 행은 좌측 가장자리에 링 + 행 틴트). 실측: 행 취소 후 대시보드 유지·선택 807ms·알림 이동 730ms(클릭 왕복 포함).

## 2026-09-11 — 1클릭 지연 이동 (dev)

- **이동 메뉴 폐기 → 지연 이동**: 활동 타일(결재·요청·미읽음·피드백)·프로필 알림/체계 설정/설정 버튼·결재 카드 링크아웃·대시보드 맵 행/맵 카드의 "열기"가 클릭 즉시 `router.prefetch` 후 1초 카운트다운 링(`components/nav-ring.tsx`, `NAV_DELAY_MS`=CSS 1000ms)으로 바뀌고 이동, 그 사이 다시 클릭하면 취소. `lib/use-delayed-nav.ts` — 전역 단일 대기(다른 대상 시작 시 이전 취소), 언마운트 시 폐기, 새 탭 modifier는 브라우저 기본. 열기 버튼은 대기 중 호버가 끝나도 열린 채 유지.
- 랜드마인: 훅 인스턴스 식별자를 `useRef({}).current`로 렌더 중 읽으면 `react-hooks/refs` 린트 실패 — `useState(() => ({}))`로. `GoToMenu`는 부서 범위 피커만 남았다.
- 실측(3051): 타일 클릭→링·취소 후 URL 불변, 알림 버튼 1초 후 `/inbox`, 맵 행 열기 1초 후 `/maps/24`, 피드백 대기 중 설정 클릭 시 피드백 링 해제·`/settings` 착지. `pw-verify-home-dashboard.mjs` 18/18.

## 2026-09-11 — 개인 대시보드 미세 조정 6종 (dev)

- **부서 카드**: 헤더는 "내 부서"만, 부서명은 헤더 우측 드롭다운(상위 없으면 정적 필 — `DashboardSection.aside` 슬롯 신설), 맵 수·트리 보기는 내 문서처럼 하단 링크아웃 행(`home.dash.deptFoot`)으로 이동(지표 행의 "맵 N"은 중복이라 제거).
- **최근 변경**: 문장 템플릿을 토큰 단위로 쪼개(`renderTemplate`) 유저=필·맵=굵은 이름·버전=칩(라벨형은 `max-w-24` 절단)으로 구분, 이벤트 종류 아이콘 칩(버전 타임라인과 같은 톤)은 행 끝. **맵 행**: 상태 점이 맨 앞, SP 아이콘은 이름 바로 뒤.
- **섹션 높이 상한** `SECTION_CAP`(272px) + overflow hidden + 하단 페이드, 넘칠 때만 헤더에 펼침 토글(max-height 350ms) — 2열 그리드는 stretch로 좌우 같은 높이. **상단 sticky**: 프로필+타일 블록 `sticky -top-4`(컨테이너 패딩 보정) + `bg-surface-alt/85`·`backdrop-blur-[3px]` + 하단 그라데이션으로 지나가는 섹션을 흐린다.
- **후속**: 부서 범위 피커는 무채색 — 필 호버 `bg-surface-alt`/`text-ink`, 메뉴 현재 항목 `bg-surface-pearl` 굵게(공용 `GoToMenu.active` 스타일, 다른 소비자는 active 미사용).
- 검증: tsc·lint·vitest 953·카탈로그 그린, `pw-verify-home-dashboard.mjs` 18/18(sticky·행 순서·이벤트 아이콘 체크 추가), 실측 admin.sys·yerin.jang(부서 맵 2·드롭다운 4단) 캡처.

## 2026-09-11 — db-viewer 읽기전용 조회 연결 검증 후 철수 (dev)

- 같은 71번 서버 db-viewer가 이 앱 Postgres를 읽는 연결을 9910에서 검증(전용 external 브리지 `dbv-bpm9910` 10.203.1.0/24 + 별칭 + `dbviewer_ro`) — **연결 성공**. 이후 가이드는 db-viewer 저장소가 총괄하기로 하고 이 저장소의 compose `dbv` 네트워크 합류·`DBV_*` env·런북 md/html·문서 포인터(setup-once A9·deploy §3·9910 §2)를 전부 되돌렸다(운영은 아직 미연결 — external 네트워크 선행 요구를 compose에 남기지 않는다). 교훈만 기록: 별칭은 스택마다 달리, `down -v`는 롤을 지운다(pg_dump는 롤 미포함), 브리지 대역은 사내 실제 호스트와 겹치면 안 된다.

## 2026-09-11 — 개인 대시보드 미세 개선 8종 (dev)

- **행**: 제목 톤다운(ink-secondary)·SP는 맵 카드와 같은 아이콘 박스·상태는 점 인디케이터만(툴팁 라벨, 범례 라벨은 유지)·열기 버튼은 맵 카드 호버 필과 동일 디자인 + 버튼 자체 호버(액센트 테두리) + `grid-cols-[0fr→1fr]`로 폭이 열리며 우측 항목이 밀리는 등장(진입 300ms 지연, 이탈 즉시).
- **이동 메뉴**(`go-to-menu.tsx`): 결재/요청/미읽음/피드백 타일·승인 카드 링크·프로필 알림 버튼은 바로 이동하지 않고 마우스 위치에 "…로 이동" 메뉴를 먼저 띄운다(설정·체계 설정은 바로 이동). 아이콘·active 옵션으로 선택형 메뉴에도 재사용.
- **필터 강조**: "내 맵만"·상태 필터 버튼이 좌측 필터를 바꾸면 필터 행이 `filter-flash` 900ms 1회 강조(onAnimationEnd로 해제).
- **내 부서 범위 드롭다운**: 리프→루트 조상 경로 선택(체크 표시), `bpm.home.dashDeptScope` 영속(현재 경로 조상이 아니면 리프로 복원). 카드가 필터 전 전체 맵을 받아 범위로 거른다.
- **스크롤 숨김**: 대시보드 루트 `scrollbar-hidden`. 실측(bora.hwang, 1600px): 점·아이콘·열기 슬라이드·범위 Growth Center 7건 리로드 유지·이동 메뉴·강조 attr 확인.

## 2026-09-11 — 맵 카드 호버 모달 화면 하단 반전 (dev)

- **원인**: 호버 요약 모달이 `fixed`로 카드 상단(`rect.top`)에만 고정되고 뷰포트 높이를 보지 않아, 화면 아래쪽 카드에서는 모달 하단이 잘렸다(높이는 행 수에 따라 가변).
- **수정**: `lib/clamp-viewport.placeBesideAnchor`(상단 정렬 → 넘치면 카드 하단 정렬로 반전 → 그래도 안 들어가면 여백 클램프, 단위 테스트 3) + 모달 ref 레이아웃 이펙트에서 실측 `offsetHeight`로 top 확정(`getBoundingClientRect`는 등장 애니메이션 `scale(0.98)` 첫 프레임에 4px 작게 잰다). 실측(700px 뷰포트, 카드 하단 676px): 모달 하단 676px 정렬.

## 2026-09-11 — 홈 개인 대시보드 재구성 + 프로필 빠른 액션 (feat/map-tab-dashboard)

- **배경**: 맵 탭 미선택 aside가 최근 열람·오너 도넛·승인 3카드뿐이라 오너 맵 없는 유저는 카드 하나만 남고, 과다 유저는 목록이 무제한으로 늘어졌다. HTML 목업(빈약·중간·과다 3시나리오) 확정 후 구현.
- **구성**: 프로필 마스트헤드(아바타·역할 칩 Sysadmin/체계 권한자·부서 경로·직전 로그인 + 빠른 액션 — 내 맵만 필터는 라벨, 알림·체계 설정·설정은 아이콘 전용+툴팁) → 활동 타일 5(결재 대기·내가 낸 요청·점유 중 버전(클릭 시 목록 펼침)·미읽음·내 피드백) → (승인 필요|내 문서) → (내 부서 맵|업무 체계) → (최근 변경|최근 열어본). 2열은 aside 폭 `@container 42rem` 기준. 모든 섹션 **행 상한(3~6) + "N건 더" 링크아웃**, 빈 데이터는 `null` 반환 대신 **한 줄 빈 상태 + 다음 행동**. 도넛은 상태 분포 바+범례 필터로 대체(`charts/donut`·`donut-geometry` 삭제).
- **백엔드**: `GET /api/me/dashboard`(`routers/me_dashboard.py`) 단일 집계 — 결재/요청/점유/미읽음/피드백 수·직전 로그인·점유 목록·내 요청·최근 이벤트(오너/편집자 맵, 내 draft 잡음 제외)·권한 카테고리별 L5/미확정/슬롯 대기. `list_maps`의 유효 역할 블록을 `permissions/access.load_my_roles`로 추출해 공유. 스키마 변경 없음.
- **검증**: backend pytest 1463·ruff 그린 / tsc·lint·vitest 950(신규 `dashboard-stats.test.ts` 5)·카탈로그 그린 / `pw-verify-home-dashboard.mjs` 16/16(도넛 체크→범례 클릭·신규 섹션 5종·타일 렌더로 갱신). 실측 admin.sys(오너 19·점유 2·이벤트 20)·admin.kim(전부 빈 상태) 캡처.

## 2026-09-10 — 트리 조상 강조 템포 조정 (feat/tree-guide-tempo)

- **피드백**: 200ms 즉응이 촘촘한 트리에서 마우스를 따라 행마다 튀어 어지럽다. 전환을 350ms `ease-smooth`로 늦추고 진입 지연 120ms(스치는 이동은 반응 안 함)·이탈 지연 80ms를 둔다. 휴식 규칙의 transition=이탈, 활성 규칙의 transition=진입으로 나눠 비대칭 지연 구현. 템포 값은 `:root` `--tree-tempo`/`--tree-delay-in`/`--tree-delay-out` 한 곳. 이름 색·굵기도 같은 템포(정적 굵기라 굵기는 즉시).

## 2026-09-10 — 트리 조상 강조 2차: 가이드 라인 + 밀림 애니메이션 (feat/tree-ancestor-guide)

- **배경**: 1차(이름만 검정)가 12px에서 너무 약했다. 목업 4안(현재/A 글자 강화/B 행 틴트/C 가이드 라인) 비교 후 **A+C** 확정(사용자).
- **구현**: 헤더 `[data-tree-head]`에 `::before` 2px 액센트 선(원래 들여쓰기 자리, scaleY 0→1 200ms)이 켜지고 `--tree-shift: 10px`로 체브론·이름이 오른쪽으로 밀렸다가 호버가 떠나면 당겨진다(padding-left 전환). 들여쓰기는 인라인 px 대신 `--tree-indent` 변수 + `pl-[calc(...)]` 클래스(`lib/tree-indent.ts` 단일 소스 — 업무 체계는 div 헤더/button 패딩이 분리라 변수·클래스 분리). 호버 행 자신도 선을 켜 조상과 한 줄로 잇는다. 조상 이름은 검정 + **500**. reduced-motion이면 전환 없음.
- **굵기 500 확정**: 굵기 사다리(300/400/600) 밖이지만 600은 12px 행에서 과하다는 사용자 결정 — 유일한 예외로 `rules/frontend/design.md`에 명시.
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 실측(부서 Growth Team 호버): Growth Center·Marketing Office pad +10px·선 scaleY(1)·500·검정, 형제 Brand Team 미변. 업무 체계: 선택 EPCV는 선·밀림만(액센트 유지). `pw-smoke-framework.mjs`의 `framework-node > button` 셀렉터는 헤더 div 도입(이전 커밋) 이후 낡은 것 — 이번 변경과 무관.

## 2026-09-10 — 홈 맵 상세 SP 섹션: 타일 단위 메모 아이콘 호버 + 부서 타일 축소 (feat/home-sp-tile-hover)

- **메모 아이콘 일괄 스왑 원인**: 섹션 루트가 "모두 펼치기" 버튼용 무명 `group`이라 `.group:hover .note-swap-*`가 섹션 어디를 호버해도 안의 모든 타일 아이콘을 한꺼번에 바꿨다. 섹션은 named group `group/sp`로 바꿔(멤버 카드 `group/member` 선례) 타일의 무명 `group` 호버만 스왑을 켠다.
- **부서 타일(DeptPill block)**: 글자 caption→fine, 보조 이름(반대 언어)은 필 호버 때만 opacity로 노출(자리는 유지 — 호버로 그리드 행 높이 안 튐), 인터랙티브면 `cursor-pointer`. 아이콘은 열 밖 `mt-0.5` 고정 오프셋 대신 이름과 같은 행 `items-center`로 — 글자 크기를 바꿔도 세로 중앙 유지(사용자 지적).
- **열 비율**: BPM 속성 그리드(≥40rem) 부서 1.5→1.75fr, 담당자 1.5→1.28fr(85%), 시스템 스택 3fr 유지 — 실측 219/160/375px. 담당자 미입력은 "Not set" 대신 짧은 대시(`vertHead` emptyText).
- **트리 조상 강조(부서·업무 체계 공용)**: 하위 행(또는 L5 박스 안 맵 카드)을 호버하면 그 경로의 상위 행 이름만 검정(`--color-ink`)으로 — 펼친 행은 tertiary 톤다운이라 가지를 잃기 쉬웠다. CSS `li[data-tree-node]:has(li:hover)` + 헤더 훅 `data-tree-head`/`data-tree-name`(globals.css, 비레이어라 Tailwind 색 유틸리티를 이김). 선택 행(업무 체계)은 액센트 유지(훅 미부여). 실측: 부서 Growth Team 호버→Growth Center·Marketing Office만 검정, 형제 Brand Team 제외 / 업무 체계 L5 호버→Facility·계측 보전·Calibration 기획 및 운영 / 카드 호버→소유 L5까지 5단.
- **노트 카드**: 제목 caption-strong→fine semibold·본문 caption→fine→**11px(leading-snug)**, 제목은 카드형도 한 줄 말줄임(전문은 title 속성 — 줄바꿈 예외 폐기). 출처(Imported)·수정됨 표시는 행 호버 때만(opacity, 편집/삭제 버튼과 같은 규칙). `ClipBody`는 클립 중(넘침·미펼침)에만 내용 하단 `pb-8` — 끝까지 스크롤해도 마지막 노트가 h-10 페이드 밑에 깔리지 않는다(설명 섹션도 같은 공용이라 함께 적용).
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 신규 스모크 `scripts/pw-smoke-home-sp-tile-hover.mjs` 9/9(섹션 호버=펼치기 버튼만·타일 호버=그 타일 아이콘만·부서 12px·중앙 gap 0·pointer). 보조 이름 호버 노출은 시드에 한글 부서명이 없어 미실측.

## 2026-09-10 — 홈 맵 상세 SP 섹션: 미지정 맵도 접힌 채 노출 + 부서 타일 상시 경고 픽스 (feat/home-sp-section)

- **섹션 상시 노출**: SP 미지정이고 값·메모도 없는 맵은 섹션을 아예 안 그렸는데(목업 v5 결정), 톤다운 배경·muted 헤더·`Not designated` 필로 접힌 채 남긴다(사용자 지시). 펼치면 빈 타일(Not set)만 보인다.
- **부서 타일 상시 경고 원인**: 섹션이 `DeptPill`에 저장 리프명 대신 해석된 슬래시 조직 경로를 넘겨 유효 리프 집합(`buildDeptLeaves`, 세그먼트/리프명 집합) 대조가 항상 실패 → 정상 지정 부서도 고아 경고. 저장값(리프명)을 그대로 넘기고 경로 해석은 필이 다시 하도록 정정(인스펙터·지정 모달 타일과 같은 호출 방식).
- **검증**: tsc·lint·vitest 948·카탈로그 그린. 신규 스모크 `scripts/pw-smoke-home-sp-section.mjs` 9/9(맵 1 Order Fulfillment=Brand Part 1 경고 없음, 맵 2 Employee Onboarding 접힌 회색 섹션).

## 2026-09-10 — 노드 고아 부서·담당자 경고: 인라인 아이콘 + 배지 호버 내역 (dev)

- **기존 우하단 배지 실태**: `AssigneeWarningBadge`는 "담당자 부서 불일치" `title` 하나로 세 상황(재직자 명단에 없음·이 맵 열람권한 없음·부서 드리프트)을 뭉쳐 있었고, 판정 소스가 `eligible`(맵 열람권한자)이라 **비공개 맵에서 재직자를 미등재로 오판**했다. 부서 고아는 아예 신호가 없었고 SP 노드는 `hasBpmAttributes` 가드로 제외됐다.
- **구현**: 판정을 `/directory`(active 전 직원) 기준으로 옮겨 감사(`app/ref_audit.load_valid_sets`)와 같은 집합을 보게 하고(`lib/node-ref-warnings.ts` 단일 소스), `eligible`은 "열람권한 없음"만 가르는 역할로 축소. 캔버스는 속성 줄 아이콘만 경고색으로 바꾸고(글자색 유지 — 노드가 많아도 도배 안 됨) 우하단 배지에 건수 + 호버 내역(`HoverTip`)을 붙였다. `DeptPill`·`AssigneePills`는 스스로 고아를 판정해 인스펙터·노드 편집 모달·홈 상세가 같은 톤을 공유한다. 새 토큰 `--color-warn`(#b45309) — 고아는 error가 아니라 "확인 필요"라 error 재사용은 과하다(사용자 결정).
- **가드**: 디렉터리 미도착이면 `refCheck=null`로 판정 자체를 건너뛴다 — 로드 전 판정은 전 노드를 경고로 물들인다. 비교·프리뷰 표면도 null(디렉터리를 안 부른다). 판정은 노드 컴포넌트가 컨텍스트로 직접 해서 RF 노드 data를 안 건드린다(재렌더 churn 없음).
- **검증**: tsc·lint·vitest 945(신규 9)·카탈로그 그린. 브라우저 캡처 `scripts/pw-orphan-warning-shots.mjs` 4/4(8047/3047, `seed_ref_audit_demo`).

## 2026-09-10 — 임포트 부서 인덱싱: sp_department 리프화 + "/" 든 부서명 사전 (dev)

- **문제**: JSON 임포트가 `owning_department`만 조직 트리에 정렬하고 `sp_department`엔 전달물 전체 경로를 그대로 박았다(실측 `Quality Center/QC Department/...`). 앱의 sp_department 계약은 리프명이라 라이브러리 부서 트리는 어느 부서를 눌러도 0건(임포트 값이 별도 루트로 튐), 고아 참조 감사는 임포트 맵을 전부 고아로 신고했다.
- **구현**: `resolve_sp_department`가 착지 경로의 리프명을 쓴다. 착지 실패한 값에서 리프를 뽑는 건 금지 — `A/ADC T/F`의 마지막 칸은 `F`라 가짜 부서가 생긴다(전달값 통째로 유지). 부서명 자체에 `/`가 든 실부서(`ADC T/F`, `AX/PI Department`)는 경로 구분자와 같은 문자라 쪼개면 두 칸으로 찢어져 영영 미매칭이었다 — `collect_slashed_dept_names`가 조직 미러에서 그런 이름 사전을 만들고 `merge_slashed_segments`가 **쪼개기 전에** 전각형으로 되붙인다(세그먼트 경계 치환·긴 이름 우선으로 오탐/비결정성 차단).
- **검증**: backend pytest 1459·ruff 그린. 신규 테스트 5종(4종은 구현 전 red 확인).
- **잔여**: 리프 표기 통일은 보류 — `/` 든 부서의 리프가 임포트는 전각형(트리·감사와 일치), 피커는 원본형(`Employee.department`)이라 갈린다. 임포트와 무관한 기존 문제라 별도 건으로 남긴다.

## 2026-09-09 — 고아 참조 감사 구현 (feat/ux-polish)
- **문제**: 기존 소멸 부서 재지정은 조직 경로 3곳(맵 부서 권한·그룹 부서 멤버·오우닝)만 봤다. 노드·SP 지정의 담당부서(리프명)·담당자(이름)와 사용자 참조(오너·협업자·승인자·그룹·카테고리)는 조직개편·퇴직 뒤 조용히 낡는다.
- **구현**(`docs/design/2026-09-09-ref-audit-design.md`, 플랜 10 Task): 참조 12곳을 **온디맨드 스캔**(저장 테이블 없음, `app/ref_audit.py`) → 설정 > 조직 > "Orphaned refs" 탭에서 값별 그룹·라인 체크로 일괄 replace/remove(노드 필드는 드래프트 필요라 캐치·체크 불가), 오너에게 오너당 1건 묶음 알림(`ref_fix_requested`)·오너 교체 시 `owner_assigned`, 홈 카드 "Stale refs" 배지 + Owning 필터를 Issues로 확장. 노드 스캔은 게시본+최신 드래프트. 데모 시드 `backend/scripts/seed_ref_audit_demo.py` + 브라우저 스모크 `frontend/scripts/pw-smoke-ref-audit.mjs`(10/10 PASS) 추가.
- **검증**: backend pytest·ruff 전체 그린, frontend tsc·lint·vitest·컴포넌트 카탈로그 그린. 포트 8047/3047으로 스모크 확인.
- **랜드마인**: 그룹 카드 인터랙티브 `data-id`는 Task 8 수정으로 `${kind}-${value_kind}-${value}` 접미사가 붙어 `^=` prefix 스코프 필요. `ref-audit-panel`은 GET 완료 전에도 마운트돼 `.count()` 즉시 호출은 로딩 중 0으로 오탐(그룹 로케이터 `waitFor` 선행 필요). 부서 뷰는 아코디언 미펼침 시 `MapCard` 언마운트라 배지 확인은 검색(평면 목록)으로 우회. 인박스는 좁은 화면용 카드-아래 아코디언이 상세를 이중 마운트(`split:hidden`)해 칩 개수가 2배로 잡히므로 우측 aside로 스코프.
- **최종 리뷰 수정**: 홈 배지(`GET /api/maps`)와 감사 스캔의 드래프트 스코프를 `ref_audit.load_target_versions`로 단일화(최신 버전이 draft가 아니어도 최신 드래프트는 계속 센다) — 배지·탭이 다른 숫자를 보이던 어긋남 제거. `count_stale_refs_by_map`의 노드 조회에 SQL 사전 필터(`department`/`assignee` 후보만)를 추가해 `GET /api/maps` 핫패스의 행 볼륨을 줄이되 온디맨드 스캔 방식은 유지(컨트롤러 판단). 그 외: 죽은 `_NAME_SOURCES`/`refAudit.pickUser` 제거, 패널 에러 표시가 Rescan 버튼을 가리던 것 인라인으로 전환, 그룹 카드 `data-id` 2종 키 접미사 보강, 부서 테이블·orgchart·9910 문서의 낡은 "dept-remap" 문구를 "ref-audit"로 정정.

## 2026-09-09 — 임포트 리포트 UI 4종: 세그먼트 토글·L5 미리보기·3노드 높이·노트 내용 diff (feat/ux-polish)
- **거버넌스 유지/교체 드롭다운 재디자인** — 컨트롤은 드롭다운 그대로 두고 **펼친 목록만** 앱 디자인으로(네이티브 `option` 목록은 OS가 그려 리포트 톤과 어긋났다). 트리거+포털 목록(체크 표시·아이콘·hover), 섹션 본문이 `max-h` 스크롤이라 `absolute`면 잘려 body 포털+fixed(z 1250, SearchSelect와 같은 계약)·아래 공간 부족 시 위로 플립. 스모크는 `selectOption` → 트리거 열고 `-replace` 클릭으로 이관.
- **L5 연계 캔버스 미리보기 신설** — 캔버스 행 호버 시 Preview 노출(맵 행과 같은 규칙). `buildL5PreviewGraph`가 파일 최상위 `relations.edges`로 rows(subprocess)+`externalTasks`를 잇고, 백엔드 `expand_linkage_branches`처럼 택일 팬아웃 앞에만 분기 노드를 세운다(전부 `parallel`이면 제외). 미선언 끝점은 코드 그대로가 제목.
- **미리보기 높이 1.5노드 → 5노드(266px) + 펼침/접힘 애니메이션**(grid-rows 0fr↔1fr, 350ms). 랜드마인: 맵 목록 4행 캡의 `useLayoutEffect` 실측이 전환 시작 전 값을 재 미리보기가 잘렸다 — 열리는 행은 안쪽 `data-preview-body`의 `scrollHeight`로 보정해 목록이 같은 속도로 늘어나게 했다.
- **임포트 노트 거버넌스는 내용 비교가 1차**(백엔드 동반 수정) — `diff_import_notes`가 (kind, title) 키로 짝지어 added/removed/changed만 남기고, **차이가 없으면 행 자체를 안 내려보낸다**(재삽입해도 결과가 같아 그냥 skip). 다르면 `GovernanceDiffOut.note_changes`로 실어 보내 행 호버 시 뜨는 "변경사항 자세히"가 git diff식 아코디언(`-` 기존 / `+` 남을 본문)을 편다. 종전 "임포트 노트가 있으면 항상 결정 행"은 폐기 — 회귀 테스트도 새 계약으로 옮겼다.
- **검증**: backend pytest 1440·ruff, vitest 917(L5 빌더 5케이스 신설), tsc·lint·카탈로그, 스모크 interview-import 26/26, 캡처 7장(호버 노출·펼침·드롭다운 열림·노트 diff). 포트 8047/3047.

## 2026-09-09 — 홈 맵 상세 패널 섹션 재구성: 설명|노트 3:2 + 서브프로세스 정보 타일(원문 메모 병합) (dev)
- **배경(사용자)**: 맵 이름 아래 설명/서브프로세스 정보/인터뷰 원문 메모/노트 4박스가 헤더 없이 이어져 시스템에 익숙하지 않은 사용자에게 구분이 안 보임. HTML 목업 5차(워스트 케이스 데이터)로 레이아웃을 확정한 뒤 구현.
- **후속 라운드(2026-09-09)**: 부서는 말줄임 알약 → **줄바꿈 둥근 사각형**(`DeptPill variant="block"`, 14px — 긴 부서명 전문 노출), BPM 속성은 **2행**(시스템 / GMP·URL 1:2), 입력물·산출물 각 행에 **데이터 형식 필**(`parseIoRows`가 `sp_*_forms`를 줄 번호로 1:1 짝지음 — 글머리 음수 들여쓰기가 필 안에 상속돼 겹치므로 `indent-0` 필수), 노트 헤더의 접기 제거 → **설명 헤더가 두 섹션을 함께 접음**(`SectionHeader`는 `onToggle` 없으면 정적 span). 필수/선택 플래그는 SP 지정에 컬럼이 없어(노드 `input_flags`만 존재) 미표시 — 필요 시 백엔드 컬럼 추가 필요. 형식 필은 `align-middle`+행 줄높이(18px)+`-top-px`로 행 글자와 세로 중앙 일치(실측 오차 0.2px), 8rem 초과는 말줄임(제목에 전문). 결합 IO 타일의 반쪽은 `flex-1` 균등분할이면 글자가 중간에서 잘려 **자연 높이**로 바꿔 그리드 행이 따라 늘게 함. 항목이 많으면 3줄 클램프 대신 **반쪽별 세로 스크롤**(`max-h-16`+`scroll-soft`, 4행째가 살짝 보여 더 있음 암시)과 **행 호버 배경**(클릭 동작·커서 없음). 부서는 값이 있으면 **필이 곧 타일**(헤더 생략, `DeptPill fill`+`subLabel`로 반대 언어명을 필 안 톤다운 줄로), 없을 때만 비활성 헤더 타일. URL은 값이 있을 때만 폭(1:2)을 갖고 비면 36px 아이콘 타일로 줄어 GMP가 남는 폭(124→335px)을 가져간다.
- **구조**: 상단 3:2 **설명 | 노트(카드형)** — 둘 다 접힘 높이 136px 클립(처음 272 → 사용자 지시로 절반)(스크롤바 숨김·하단 페이드·헤더 펼치기/접기, `components/clip-body.tsx`), 헤더는 공용 `SectionHeader`(체브론+아이콘+제목+건수). 하단 전폭 **서브프로세스 정보**(`maps/map-detail-sp-section.tsx`, 순수 로직 `lib/sp-detail.ts`): BPM 속성=부서 필(1.5/6, `DeptPill label`=UI 언어 이름, 클릭 조직 모달, 아랫줄 반대 언어명 톤다운 — 처음 트리안은 사용자 지시로 필로 회귀)·담당자 인물 필(1/6, `AssigneePills` 호버/클릭 인물 카드)·3행 높이 클립(셀을 absolute로 채워 fr 행 성장 차단) + 시스템·URL·GMP 스택, 수행 지표 1행 타일 3열, 입출력=결합 타일(5/12, 글머리 목록)+시작/종료 조건(7/12) — 본문은 내용 높이에 맞추고 상한 3줄 클램프(사용자 지시). 폭 <40rem(컨테이너 쿼리 `@[40rem]`)이면 세로 쌓임. **기본 접힘**: BPM 속성 + 수행 지표 헤더까지만 보이고 지표 타일·입출력은 `grid-rows 0fr↔1fr` 아코디언 — 섹션 호버 시 헤더의 지정 필이 「모든 섹션 펼치기/접기」 버튼으로 크로스페이드(`group-hover`), 누르면(또는 접힌 수행 지표 헤더 클릭) 안의 그룹까지 전부 펼침 — 버튼은 상태 필 **왼쪽**에 절대 배치(줄바꿈 없음, 필은 그대로). **SP 미지정 맵**(값·메모는 있음)은 섹션 배경 `surface-alt`·헤더 톤다운으로 접힌 채 시작(`SectionHeader muted`); 값·메모도 없으면 미노출. **노트 추가·수정은 카드형(홈)에서 모달**(`ModalBackdrop`, 취소/확정 버튼, ⌘/Ctrl+Enter 확정) — 접힘 높이 안에 인라인 폼이 들어갈 자리가 없다. 에디터 맵 탭 등 목록형은 인라인 폼 유지.
- **메모 규칙**: 메모 있는 타일은 아이콘 점 + 호버 스왑 + 클릭 원문 팝오버(FallbackHint 읽기), 대표값 없을 때만 폴백 톤(점선·회색 12px, `SpFieldTile labelFixed`로 라벨 유지). 홈 카드의 `MapFallbackNotes`·`map-detail-io` 블록은 제거(에디터 맵 탭·비교 화면은 그대로). 패널 본문 스크롤바 숨김(`scrollbar-hidden`).
- **용어**: 「인터뷰 원문 메모」→ **「원문 메모 / Source note」**(필 「원문 기준 / from source note」) — i18n·매뉴얼·spec 표기 교체. `MapNotesSection`에 `icon/layout="cards"/clipHeight/defaultCollapsed` 추가(카드형은 노트가 없어도 빈 상태를 그려 3:2 열을 비우지 않음).
- **검증**: vitest 922(신규 sp-detail 10)·tsc·lint·카탈로그, 실화면(3010) 캡처 — 기본/호버/팝오버/노트 펼침/좁은 폭 614px/에디터 맵 탭 회귀 없음, 콘솔 에러 0. 스모크 import-followups 22/23(실패 1은 스크립트의 백엔드 8000 직접 호출), field-promotion·framework는 홈 이전 단계(임포트 API·트리)에서 중단 — 기존 기록대로 낡은 스크립트, 셀렉터만 `map-detail-sp-section`으로 갱신. 랜드마인: 클립 넘침 측정은 ref 객체가 아니라 **콜백 ref**로(비동기 로드 뒤 마운트되는 본문을 ref 객체+deps 이펙트는 놓친다).

## 2026-09-08 — 인터뷰 JSON 0.5 외부 L6 참조(`externalTasks`) + 드라이런 리포트 2열 (feat/interview-external-refs → dev)
- **목적**: 컨설턴트가 L5 단위로 전달하면서 타 L5의 L6를 "소속 L5 코드 + 불확실한 이름"으로만 아는 경우(taskId 없음)를 임포트가 받도록, 우리가 JSON 계약을 먼저 제안·구현(컨설턴트 측 Fable 5.1이 이 계약대로 생성). 스펙 `docs/superpowers/specs/2026-09-07-interview-external-refs-design.md`, 플랜 `docs/superpowers/plans/2026-09-07-interview-external-refs.md`, 컨설턴트 전달용 계약 `docs/samples/interview-json-0.5.md`, 필드 맵 `docs/qa/interview-import-field-map.md`.
- **계약(A안, 사용자 결정)**: 최상위 `externalTasks[]` `{refId, l5{nodeCode,label}, l6|null, note}` — 엣지 끝점은 rows taskId → refId → 미선언 원문(기존 taskId 플레이스홀더+경고) 순으로 해석, 양쪽 외부면 드롭. 외부 L5 계보는 `framework.categories`에 그대로 동봉(create-only, 라우터 병합은 홈 주장 우선, 끊긴 외부 체인은 경고 후 제외). 플레이스홀더는 제목 `l6∥(L6 unspecified) L5명`·출처 `placeholder_category_id`·계보키 `external_ref_lineage_key(홈 L5|refId)`. 자동 연결은 **같은 L5 안 정규화 이름(`normalize_task_name`) 정확 일치 라이브 맵 1건만**(임포트 시 선해소 + 후차 `resolve_external_placeholders` 이름 경로), 2건+는 경고·플레이스홀더 유지, 재임포트는 미연결 노드 제목·출처만 갱신. 리포트 문구 5종은 FE `interview-report.ts` PATTERNS와 verbatim 계약. 어댑터는 0.4/0.5 수용, 0.3 거부("re-deliver as 0.5"). 조사 중 발견한 외부 엣지 `quote` KeyError(dry-run 500)도 픽스.
- **거버넌스 배선**: 후차 해소 시 `fw_external_linked` 알림(캔버스 단위 1건, 캔버스 L5·출처 L5의 직속+조상 관리자, 실행자 제외, 인박스 subprocess 카테고리)+`VersionEvent(external_linked)`·타임라인 라벨. `framework.categories[].admins`(L1~L5 어느 행)로 카테고리 관리자 **add-only**(외부 행은 경고 후 무시). 확인된 것: 확정 게이트는 확정 시점 재검증, 관리자 추가는 sysadmin 경로, dry-run은 알림·이벤트 롤백. 미보정(기존): `slot_changed` FE 라벨 없음, 선해소·수동 Connect는 알림 없음.
- **샘플 7종 0.5 재작성**(`brr-large-l5.json`→`brr-l5.json`): 파일당 L6 ≥4·행마다 decision+branch·loop, 파일마다 parallel·bypass·exception·handoff, 외부 참조 시나리오 매트릭스(직결·정규화 일치·불일치·`l6:null`·계보 동봉 빈 카테고리·계보 없음 origin unknown), 3종에 seed 로그인 admins. `backend/tests/test_samples_0_5.py`가 규격(의도 경고 화이트리스트)+B세트 e2e(4파일→qa-deviation 후차 해소 4건) 고정. 스모크 앵커 Created 9·Notes 41·교정 준비 노트 7행.
- **드라이런 리포트 2열(A안, HTML 목업 4차 승인 후 구현)**: 좌 = 요약 카드(강조 톤 6셀) · 확인 필요(종류별 접기, 펼치면 맵 칩) · 외부 L6(상태 필=필터, 비해당 행은 제거 대신 흐림) · 카테고리 관리자 · 거버넌스(유지↩/교체⇄ 드롭다운, 굵은 값=적용 뒤 값·버려지는 값 취소선). 우 = L5 파일 카드(`Lv5` 필 색=검증 결과, L1~L4 계보 필+업무체계 탐색 아이콘(계보 코드를 `/nodes`로 따라 id 해석, 미적용 L5는 안내), 외부 L6 필·파일명 우측, 맵·노트 수) + 항상 펼친 맵 목록(4행 캡·숨은 스크롤·모두 보기) + 행 미리보기(`lib/interview-preview.ts`가 rows[i].actions/relations를 백엔드 그래프 규칙과 동형으로 그려 에디터 자동정렬 → ScopePreview, Start 기준 시야). 맵/L5 클릭 → 좌측 FLIP 재정렬(`lib/use-flip-order.ts`)·강조·흐림, 좌측 호버 → 우측 강조, 하단 바 필터 상태+Clear. 사용자는 이름 필(UI 언어→영어→아이디, 인물 카드 재활용), 섹션 i 툴팁. **파일 이슈**(어댑터 경고: 자기 반복 ◇ 합성·판단 승격·외부 L5 계보 없음·seq 폴백·기타)도 다이제스트·맵 행 ⚠·요약 경고 수에 합침(`a0N`/`seq N`은 단계 이름으로). `frontend/src/components/admin/import-report/`(9파일)+`components/info-tip.tsx`, `import-governance-review.tsx`는 `governance-section.tsx`로 대체.
- **검증**: backend pytest 1437·ruff, vitest 912, tsc·lint·카탈로그, 스모크 interview-import 26/26(`Lv5` data-state·select), import-followups·framework-slot·node-modal-tiles 그린, 리포트 캡처 19/19(포커스·필터·모두 보기·미리보기·한글·파일 이슈). 별건: field-promotion 스모크는 임포트 검사 통과 후 홈 Framework 트리 단계에서 타임아웃(이 트랙 무관). 포트 8047/3047로 실행(8000·8010·3010은 다른 세션 점유).

## 2026-09-07 — 슬라이드 매뉴얼 4종 재생성: 08-31 이후 md 델타 반영 (docs/manual-pdf-refresh)
- **범위 판단**: md 매뉴얼 6종은 09-07 커밋까지 증분 갱신돼 최신(잔여 3커밋은 체크박스 모양·모션 리팩터라 문서 영향 없음) → 실제 정체는 08-31에 만든 슬라이드 HTML/PDF. `git diff e89aabe5..HEAD -- docs/manual/*.md`(225+/71−)를 델타로 삼아 슬라이드에 흡수.
- **관리자 덱 35→40장**: ⑤ 프레임워크를 2장→7장으로 재편(카테고리 관리·레벨 위임 / 권한자 / 확정 거버넌스 / 슬롯 변경 / 현황판 / 인터뷰 임포트 2장), 설정 레일·배치 작업(지금 백업·다운로드)·승인 큐(`fw_slot`·대체 처리자) 문구 갱신. **사용자 덱 60→65장**: 체계 필 슬롯 연결·이동·이양, 노드 편집 창(타일), AI 컨설턴트 인터뷰, 초안·확정본 열람 규칙, 끊긴 링크 교체·슬롯 이력 신설 + 홈·복사·맵 설정·에디터·노드 속성·IO·라이브러리 필터·피크·미등록·지정 관리·버전·결재함·CSV·내보내기·Framework 보기·L5 캔버스·확정·플레이스홀더·FAQ 문구 갱신. 실화면 재촬영 13장(관리/현황 뷰·슬롯 다이얼로그·분류 요약 카드·배치 작업·필터 팝오버·미등록 필터·새 피크·노드 편집 창·차콜 L5·확정 게이트·연결 다이얼로그·미싱 노드), 나머지 이미지는 기존 유지. TOC `data-goto`는 섹션 구분 슬라이드에서 재계산, 날짜 2026-09-07.
- **PDF**: `docs/manual/slides/export-pdf.mjs`(playwright-core + 시스템 Chrome, 1280×720 1장/페이지) 추가 — 이전엔 생성 절차가 없었음. 검증: 4덱 브라우저에서 새 슬라이드 렌더·`.col-text` 넘침 측정(영문 8장 문구 축약으로 해소)·PDF 페이지 수 = 슬라이드 수. AI 인터뷰 화면은 로컬 AI 비활성으로 이미지 없이 문구만.
- **전수 감사(사용자 지시 "증분 말고 처음부터 끝까지")**: md 3종(KO+EN)을 코드(i18n 사전·설정 화면·라우터·Settings) 근거로 처음부터 끝까지 대조해 56건 정정 — 관리자 13(권한 콘솔→직원 관리 태그, 탭 라벨 4종, 승인 큐 반려 사유 없음, 로컬 계정 Sysadmin 토글은 로컬 전용, 위임 범위(seed 자신 불가), 메이저 확정은 중간 마이너만 프룬, AI access 스위치·`EMBED_URL`, §14 `AI_TIMEOUT_SECONDS` 기본 60) · 사용 안내 18(슬롯 즉시 적용=확인 창 "바로 적용"+토스트·철회권 오너/sysadmin, 홈 필터 오우닝·SP, **체크아웃 30분 자동 해제 없음**(`checkout.py` TTL 미사용 — 관리자 §10·`CHECKOUT_TTL_MINUTES` 행도 제거), 게시는 제출자만, 셀프 게시 문구, 승인 대기 6종, PNG 카드 오너, 공지 읽음=열면 표시, Inbox 배지 15초, 알림 필터 서브프로세스) · 맵 편집 25(**딥 뷰 폐기**(더블클릭=노드 편집 창), 하위프로세스 만들기 우클릭 삭제, 펼치기 메뉴명·액션 바, 디시전 드롭 분기/인터셉트, CSV 20열·미지 열 오류·500행, Excel "Process Map"·2,000행, CSV 경고 실제 목록, 인터뷰 버튼 Ask about this/Draw now/Start over, 외부 L6는 L6 피커에서 드래그, 배너 "연결(Connect)"·플레이스홀더 만들기, 슬롯 이력 패널 우상단, `Ctrl+Y`). 미검증 12건은 감사 보고에만 남김. **슬라이드 2차**: 4덱 210장을 md와 전수 대조(관리자 결함 0, 사용자 6)한 결과와 md 감사 정정을 덱에 반영 — 사용자 65→66장(단축키 요약 슬라이드 신설, 딥 뷰 슬라이드를 "노드 다듬기와 링크된 맵 열기"로 개편·낡은 모달 스크린샷 제거, 내보내기 KO에 EN과 같은 스크린샷), 슬롯/체크아웃/게시/CSV·Excel/인터뷰 라벨/외부 L6/슬롯 이력 위치 등 문구 30여 장 갱신, dev 머지로 바뀐 라이브러리 필터 팝오버(미등록 스위치·부서 트리 플라이아웃·권한 필) 재촬영 2장. 제품 관찰(코드 미수정): 죽은 i18n 키 4종, `settings.checkout_ttl_minutes`·`sp_description` 잔존, 범례 "Double-click → Connect"·드롭존 Swap 누락, `ai.readOnly` 문구 드리프트, 하드코딩 라벨(AI access·KB Upload/Refresh).

## 2026-09-07 — 슬롯 거버넌스 UX 2라운드: 트리 모션·L5 플레이스홀더 생성·라이브러리 필터 (feat/fw-slot-handover → dev)

- **CLAUDE.md 감사(claude-md-improver)**: 낡은 수치·목록 교정(에디터 ~12,500줄, `settings-and-forms` lessons), 프론트 게이트(tsc·vitest·카탈로그 검사)와 Playwright/dev 인증 관례를 Commands에, 이번 트랙들의 계약(오버레이 z 사다리·라이브러리 행 부서=`sp_department` 리프명·`useSectionMotion`/`CheckInput`)을 Lessons에 추가. 템플릿 메타 문구 제거. `frontend/AGENTS.md`엔 zsh `--include` 인용 함정.
- **트리(사용자 요청)**: 슬롯 배정 모달·플레이스홀더 연결 다이얼로그·"Framework L6" 목록(같은 `FrameworkTreePicker`) 모두 하위 후보가 하나뿐이면 끝까지 자동 펼침(L5·갈래에서 멈춤, 6홉 상한)하고, 펼침/접힘은 홈 트리의 `accordion-open/close/static`(`useClosingKeys`)으로 시선이 따라가게 — 사용자가 클릭한 노드만 `open`, 자동 펼침은 `static`, 접힘은 고스트 `close` 뒤 언마운트, 쉐브론 회전.
- **L5 플레이스홀더 생성**: "Framework L6" 라이브러리 하단 입력+버튼(`framework-placeholder-name/create`)으로 미연결 subprocess 노드를 만든다(`linked_map_id`·`placeholder_category_id` null, 가운데 빈자리 배치·플래시·토스트). 임포트 플레이스홀더와 같은 룩("Connect" CTA → 연결 다이얼로그), 확정 게이트 `placeholder`가 막는다. 연결 다이얼로그에는 이 footer가 뜨지 않는다.
- **라이브러리 필터(일반 맵)**: `/library/processes` 행에 `my_role`(배치 해석, sysadmin=owner) 동봉 → `lib/library-filters.ts`(부서 전체경로/말단 매칭·권한 any-of·미등록은 재조회 플래그, `bpm.library.filters` 영속) + 패널 Filter 팝오버(부서 다중선택·Owner/Editor/Viewer·미등록 토글)와 × 달린 필·일괄 삭제·"N of M". `library-unregistered-toggle`은 팝오버 안으로(수동 검증 스크립트 2종에 팝오버 열기 추가).
- 검증: pytest 1392·ruff·tsc·lint·vitest 879·build 그린, `pw-smoke-framework-slot` 20/20·framework-admin 7/7·delegation 18/18(리셋 DB), 컨트롤러 브라우저 검증(트리 자동 펼침/클래스, 필터 6/6, 플레이스홀더 8/8).
- **리뷰 후속 수정(F1/F4/F5/F11 트리 모션, F8/F9/F3/F2 라이브러리 필터)**: 아코디언은 콘텐츠 도착 후에만 마운트(빈 박스 위 애니메이션 헛돎 방지), 피커·모달의 중복 모션 배선을 `useSectionMotion` 훅(`lib/use-closing-keys.ts`)으로 통합, 자동 드릴인은 재펼침 전 고스트-close 취소, 쉐브론 회전 `motion-safe:`. 필터 팝오버 `w-52`로 224px 패널 안쪽에, 필터는 지연 초기화로 교체(마운트 이펙트 제거 — `showUnregistered` 영속 시 중복 fetch 해소), 죽은 i18n 키 `library.showUnregistered` 제거, 매뉴얼 문구 갱신. 게이트 tsc·lint·vitest 879·catalog 그린(FE 전용).
- **부서 필터 트리화(사용자 요청 — 조직 트리 500개)**: 팝오버 부서 섹션이 행에서 뽑은 distinct 목록 대신 **내 부서 체인만**(루트→내 부서, 들여쓰기·"내 부서" 마크, 부서 미지정이면 트리 루트 + 체인 밖 활성 필터) 노출하고, "전체 부서…"가 팝오버 우측 도킹 포털 `LibraryDeptFlyout`(조직도 부서 ∪ 행 부서 트리·검색·아코디언 드릴인·내 부서 찾기 120ms 스태거+스크롤+플래시)을 연다. 부서 매칭은 **서브트리 의미**로 확장(`rowDept === s || startsWith("s/")`, 레거시 리프명 일치 유지 — 경계를 "/"까지 봐 "Growth Center"가 "Growth Center 2"를 삼키지 않음). 역할 필터는 체크박스 대신 **한 줄 필 토글**(앞 아이콘 Crown/PenLine/Eye, 선택 시 Check로 교체; 빈 선택=전체) — 사용자 지시. 부서 체크는 이름 **앞** 자리 유지(행 호버/포커스/선택 시만 노출 — 뒤로 옮겼다가 사용자 지시로 복귀), 미등록 맵은 **맨 위 스위치 행**(행 클릭도 토글)으로 재배치 — 사용자 지시. 플라이아웃 행 배선: 클릭=체크, 더블클릭=펼침/접힘(쉐브론과 동일). 회귀 스크립트 `pw-verify-sp-placeholder.mjs`는 팝오버를 닫고 드래그하도록 보정(①~③ 통과), ④ 지정 모달 타일 UI 드리프트는 TODO. 재리뷰 마이너: 트리 소스도 패널의 부서 인덱스를 공유(재계산 제거). 3차: 검색은 영문/한글명 양쪽(표시는 언어별 `formatDeptName`), 플라이아웃 폭 `w-max` 288~416px+말줄임(왼쪽 도킹은 right 정렬), 행 우클릭 `ContextMenu`(선택/펼치기·접기/부서 정보 — `OrgInfoModal elevated`로 플라이아웃 위).
- 위 작업에 딸린 공유화: 트리 빌드·검색을 `lib/dept-path-tree.ts`로 이관(관리자 부서 피커와 공유), `useDirectoryDepartments()`를 `lib/directory.ts`에 추가(유저 맵과 같은 fetch 1회 공유), `lib/me.ts` `useMe()` 신설(모듈 캐시). 게이트 tsc·lint·vitest 886·catalog(227) 그린.
- 픽스(브라우저 검증): 행의 `department`는 `sp_department`라 실무상 **리프명만** 담긴다("Brand Part 1") — 조직도 리프 역인덱스(`buildDeptPathIndex`/`resolveDepartmentPaths`)로 경계에서 전체 경로를 복원해, 트리에 중복 루트가 생기고 상위 부서 선택이 "0 of 8"이 되던 것 해소(인덱스 미전달 시 예전 동작 유지). vitest 893.
- **필터 체크박스 디자인 통일(사용자 지시)**: 라이브러리 필터 팝오버 3종(부서·권한·미등록)의 네이티브 체크박스를 앱 공통 커스텀 체크로 전환 — `components/check-input.tsx` 신설(`CheckInput`), `framework-confirm-section.tsx` 메이저 승급 토글의 기존 인라인 마크업도 이걸로 교체(시각 변화 없음). `data-id`는 라벨이 아닌 `<input>`으로 이동해 `pw-verify-sp-peek.mjs`/`pw-verify-sp-placeholder.mjs`의 `[data-id="library-unregistered-toggle"] input` 셀렉터를 직접 매치로 수정. 게이트 tsc·lint·vitest 879·catalog(226개) 그린. 후속(사용자 지시): 모양은 라운드 네모 유지 — 16px 박스에 `rounded-sm`(8px)은 원이 돼 `rounded-xs`(5px)로 조정(확인 섹션 토글도 같은 모양). 재리뷰 후속: 모션 훅 접근자 `getSectionClass`(동사 규칙)·쉐브론 회전은 `motion-safe:duration-150`(감속 모션이면 실제로 정지).

## 2026-09-06 — Framework 슬롯 거버넌스: 승인 워크플로·캔버스 재지정·임포트 플레이스홀더·UX 개선 (feat/fw-slot-handover → dev)
- **배경·결정**: 슬롯 이양이 `category_id`·`consultant_code`만 옮기고 홈 L5 캔버스·계보·알림을 안 따라가던 결함 4종(UPDATE 순서 unique 500·캔버스 맵에 슬롯 허용·이양 후 캔버스 표류·복사+은퇴 시 슬롯 휴지통 잔존)을 실행으로 확인 → 슬롯 변경 5액션(assign·unassign·move·replace·delete)을 승인 종류 하나 `fw_slot`으로 통일. 스펙 `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md`(개정 각주 포함), 플랜 4종 `docs/superpowers/plans/2026-09-06-fw-slot-track-*.md`, 명세 `docs/spec.md` §7 슬롯 수명주기 절.
- **코어(트랙 A+B)**: `app/framework_slots.py` validate→plan→apply 단일 루틴 + `framework_slot_events` 이력, `POST /maps/{id}/slot-changes`(dry_run 미리보기·L5 직속 관리자 즉시 적용), 대체·삭제 시 홈 캔버스 노드 자동 재지정(엣지 유지·중복 쌍 합치기·계보 `retired_to_map_id`, 슬롯을 되찾으면 리셋), refs에 superseded·시각 3종·후계자, 해제 링크는 `stale_link` 게이트. 캔버스는 미싱 룩+배너("Removed/Handed over/Deleted - replace")·최근 이양 배지(14일)·호버 슬롯 이력 패널.
- **승인(트랙 C)**: 비관리자 owner는 `ApprovalRequest(kind="fw_slot")` 요청(중복 대기 409 — 관리자 즉시 적용·레거시 어댑터도 같은 가드), 다측 승인(move는 양 L5 각 1명, 요청자가 관리하는 side는 생성 시 자동 승인, 동일인 1회), 적용 시 sides·target owner 재검증(드리프트 409, 요청 유지), 거절 알림·철회(`GET/DELETE …/slot-changes/pending`), 인박스·설정 큐·맵 승인 탭·벨(`fw_slot_requested/applied/rejected`), 결정권 `can_decide_slot`=잔여 side 기준(`can_decide_slot_for_map` 공용, 맵 승인 목록 열람도 공유). FE 공용 `SlotChangeDialog`(안내/요청, busy 중 닫기 차단, 해제·삭제 위험 톤)·배정 모달 대기 배너/철회·`SlotDeleteDialog`(후계자)·복사+은퇴 해제/승계 라디오(슬롯 원본은 이름 편집 가능)·옛 체크아웃 저장 422 "reload" 안내.
- **임포트 플레이스홀더(트랙 D)**: 어댑터가 한쪽 끝점만 없는 엣지를 `external`로 보존 → 임포터가 taskId 제목의 플레이스홀더 노드(`source_node_id = make_node_id("__ext__", code)`, `app/lineage.py`)를 엣지와 함께 배치(새 캔버스는 정렬에 포함) → 재전달 시 `resolve_external_placeholders`가 draft 캔버스에서만·휴지통 맵 제외·타인 체크아웃 존중으로 해소, 슬롯 수령(assign/move)도 플레이스홀더를 채움. 재임포트는 계보 키 우선·linked_map_id 폴백(백필)으로 중복 없음.
- **UX 개선(트랙 F, 사용자 요청)**: 슬롯 모달·배너 시인성(아이콘 디스크·모드/진행 필·impact 칩·side 카드·선택 카드·진입 모션, 짧은 대시), 호버 이력 패널은 이력이 있을 때만 우상단 "L5 map" 태그 자리에(반투명), 플레이스홀더 연결은 체계 트리 선택 → 우측 SP 피크형 플라이아웃 → Connect(안내 L5 자동 펼침·안내 밖 확인 게이트·키보드 행).
- **검증**: QA `docs/qa/2026-09-fw-slot-governance-qa.md`(기능 26/26·시나리오 S1~S10, 컨트롤러 실브라우저) · `pw-smoke-framework-slot.mjs` 20/20 · pytest 1390·ruff·tsc·lint·vitest 863·build 그린. 검증 중 결함 3건(L5 관리자 맵 승인 목록 403·삭제 노드 범용 CTA·복사 이름 잠금 409)과 리뷰 결함(어댑터 대기 가드·sides 재검증·Esc 이중 처리·재임포트 중복·배치 겹침·체크아웃 무시) 수정. framework 스모크 4종의 낡은 임포트 확인 단계 보정; `pw-smoke-framework`·`-canvas`·`copy-purge`는 dev에서도 낡은 스크립트(홈 트리 셀렉터·draft 열람 룰·워터마크 Title case·시드 부서) — 별도 정비 필요.
- **잔여·주의**: A+B+C+D+F는 한 배포 단위(부분 배포 불가). 후속: 해소된 플레이스홀더 리포트 카운터/칩, 슬라이드 재생성(매뉴얼 연결 흐름 변경), `notifBody.fw_slot_*` 문구 보강, 서버 Postgres(9910) 배포 검증. (2026-09-07: 철회권을 요청자·현재 오너·sysadmin으로 넓혀 오너 이전 뒤 데드엔드 해소 — 대기 조회 `can_withdraw`, 배너 "submitted by another user" 필.)

## 2026-09-03 — 5라운드: 인스펙터 행 통일·IO 열 배치·SP 부서 말단 필·독 장면 이동 (dev)
- **인스펙터 행 문법 통일**(사용자 피드백 "SP와 일반 노드 스페이서·폭이 다름"): `lib/inspector-row.ts`(`INSPECTOR_ROW` min-h-8·py-1, `INSPECTOR_ROW_LABEL`)를 속성 피커·시스템/GMP/URL 행·지표 카드·조건 행·SP 상속 행(속성·IO·조건)이 공유 — 읽기/편집 모두 32px 행, 스페이서는 URL 위 구분선 하나(일반 노드 정책). fitContent 피커 트리거는 입력과 같은 24px(py-0.5). SP IO 상속 표시는 자체 렌더 대신 `MultiValueInput readOnly`(링크 아이콘·호버·드롭다운 유지).
- **SP 속성 부서=말단 필**: `DeptPill`(말단+조직 모달)을 신설해 타일·SP 상속 행·읽기 전용 일반 행이 공유(attribute-tiles의 DeptLeafPill/모달 상태 이관). 담당자도 `AssigneePills`. 후속(사용자 피드백): 필 `min-w-0`으로 카드 밖 오버플로우 차단 + 호버(보더 액센트·틴트·그림자), **읽기 전용 속성 행 공용화** `AttributeReadRows`(부서 필·인물 필·시스템+메모 힌트·GMP 배지·링크 필) — 일반 노드 읽기 전용과 SP 상속 표시가 같은 컴포넌트, `BpmAttributePicker`는 편집 전용으로.
- **IO 목록 열 배치**(인스펙터·타일 팝오버, 읽기/편집): 인덱스(w-5) / 형식 필(고정 폭 5.5rem, 카탈로그 아이콘, 미지정은 점선 자리표시, `DataFormPicker column`) / 라벨 말줄임 + R/O 플래그. 읽기 헤드리스(타일 팝오버)의 중복 헤더 제거.
- **독 장면 이동**(사용자 요청): 후행으로 가면 양쪽 독이 왼쪽으로 빠지고(`dock-exit-left`) 새 카드는 오른쪽에서 들어옴(`dock-enter-from-right`), 선행은 반대 — `travel` 상태가 방향을 기억.
- 검증: tsc·eslint·vitest 850·`pw-smoke-node-modal-tiles.mjs` 63/63.

## 2026-09-03 — 편집 모달 4라운드: 담당자 인물 필·지정 모달 조건 타일·아코디언 잘림·타일 오버플로우 (dev)
- **담당자 인물 필**(사용자 요청): 저장된 담당자(영문 name)를 디렉터리에서 해석해 필로(중립 톤 surface-alt — 액센트 톤 부서 필과 구분, 사용자 피드백), 호버 0.7초/클릭 시 기존 인물 카드(`PersonHoverCard`, 이름·아이디·말단 부서+조직 경로). 신규 공용 `AssigneePills` — 노드 편집 모달·지정 모달 타일(+피커 초안 칩)·인스펙터 BPM 속성 담당자 행이 공유. 미해석 이름은 정적 필.
- **지정 모달 시작·종료 조건 타일** 누락 보완 — `SubprocessDesignationIn.start_condition/end_condition`(None=미변경, 승격 필드 PATCH와 같은 `sp_*` 컬럼)·`DesignationForm` 5개 빌더·Subprocess 탭 읽기 타일.
- **펼친 채 열면 섹션이 잘리던 문제**: 원인은 `AutoHeight`가 `getBoundingClientRect`로 재는데 모달 팝인(scale 0.92→1) 중이라 줄어든 값이 고정된 것 — RO `borderBoxSize`/`offsetHeight`(레이아웃 높이)로 교체. **타일 오버플로우**: 읽기 타일에 ref가 없어 라벨 생략 판정이 안 돌던 것 교정 + 루트 `overflow-hidden`, 조건 타일 값은 `valueSize="fine"`. **메모 점**은 호버 시 25%로 흐려짐(아이콘 교체 가시성).
- **독 카드 레이아웃**(사용자 결정): 1행 색 점+라벨, 2행 타입 단독(점이 두 줄을 걸치던 좌측 열 폐기). **섹션 헤더 높이 통일**: 세 섹션 헤더 행을 `h-5`로 고정하고 '모두 펼치기' 버튼의 호버 패딩은 음수 마진(-my-1)으로 흡수 — 전부 접었을 때 첫 헤더만 살짝 높던 것 교정(노드 모달·지정 모달, 실측 20/20/20px).
- **인터뷰 임포트 드라이런 카드**(사용자 요청): 결과 본문(요약·다이제스트·파일 리포트·거버넌스 확인)과 하단 [Cancel][Apply] 바를 한 테두리(`rounded-md border`) 안에 — 바는 고정(sticky) 없이 카드 맨 아래(본문이 바 뒤로 넘어가는 게 거슬린다는 피드백, 끝까지 내려서 클릭). **적용 완료 후** 본문에 반투명 음영(`interview-import-applied-overlay`)을 덮고 푸터 문구를 "적용 완료"로 바꿔 두 번 누르지 못하게(Apply 비활성은 기존, Cancel로 닫기).
- 검증: pytest 1347·vitest 850·`pw-smoke-node-modal-tiles.mjs` 63/63(담당자 필→인물 카드, 조건 타일 저장, 잘림 회귀, 점 페이드)·`pw-smoke-interview-import.mjs` 25/25(카드·음영·Cancel 도달 검사 추가, 거버넌스 체크 수는 전후 +1로 교정, 노트 행은 `li`만 집계 — 노트 CRUD 이후 행마다 edit/delete 버튼이 붙어 접두 매칭이 3배였음 — 배지는 i18n "Exception" 대소문자 무시).

## 2026-09-03 — 노드 레벨 data_form 폐기 + 메모 아이콘 호버 효과 3라운드 (dev)
- **`nodes.data_form` 폐기**(사용자 결정 — 운영 미사용 컬럼): 자료 형식은 IO 항목별 `output_forms`/`input_forms`만. 인터뷰 임포트의 `dataForm`은 산출물이 항상 하나라 **유일한 산출물의 폼(`output_forms`)으로 착지**(`CanonicalNode.output_forms`, 배열로 바뀌면 줄 정렬로 확장). 모델·NodeIn·AI 속성 스키마·graph upsert·clone·확정 시그니처·AI 프롬프트·인터뷰 에이전트 프롬프트·FE 타입/에디터/편집 모달 타일/인스펙터 폴백 행/diff/비교/CSV(21열→20열, 예전 파일의 Data_Form 열은 무시)/템플릿/i18n에서 제거. 물리 컬럼은 `db._drop_legacy_node_data_form`(기동 비치명 스텝)으로 드랍 — 롤백은 이 커밋 이후 버전 사이에서만 안전.
- **메모 아이콘 호버**(사용자 피드백): 흰 칩 폐기 → 타일 자체가 호버 시 흰 배경+보더 강조(`SpFieldTile` 편집 타일·메모 있는 읽기 타일), 아이콘은 같은 자리에서 크로스페이드 + 액센트로 한 번 튀었다 가라앉는 일회 애니메이션(`.note-swap-*`, reduced-motion 제외), 메모 점은 호버 전 60%→호버 100%.
- 검증: pytest 1347·vitest 850·`pw-smoke-node-modal-tiles.mjs` 55/55·`pw-smoke-field-promotion.mjs`(output_forms 착지 단언으로 갱신).

## 2026-09-03 — 컴포넌트 카탈로그 + 편집 모달 피드백 2라운드 (dev)
- **컴포넌트 카탈로그**(사용자 지시): `frontend/COMPONENTS.md`를 `scripts/build-component-catalog.mjs`가 생성(파일·컴포넌트·역할=머리 주석 첫 문장·사용처=임포터, `--check`) — 일괄 UI 수정 전 사용처 확인, 컴포넌트 추가·이동·사용처 변경 시 같은 커밋에서 재생성. 룰 `rules/frontend/components.md`(CLAUDE.md import)·`frontend/AGENTS.md` gotcha.
- **독 호버 = 레이아웃 확대**: scale 변환의 래스터 뒤틀림 피드백 → 폭 +12px(모달 쪽)·세로 패딩 +4px·액센트 보더 트랜지션으로 교체(위아래 카드는 높이만큼 자연히 벌어짐). **원문 메모 표시**: 메모 있는 아이콘 모서리 점(호버 전), 호버 시 아이콘 뒤 흰 칩(틴트 타일 위에서도 교체가 보임). **내 부서 필**은 PrincipalPicker 치수로 통일(테두리 제거·py-0.5).
- **Subprocess 탭**: 게시본이 아닌 버전이면 지정값 위 워터마크("게시본이 아닙니다"/"아직 게시본이 없습니다") + 수정 자리에 '게시본으로 이동'(액센트 테두리, `switchVersion`). 빈 값도 "미입력" 회색 타일로 남기고(누락 가시화), 대표값 없이 메모만 있으면 메모를 임시값 스타일(점선·기울임·"인터뷰 원문 기준" 필)로 — `SpFieldTile placeholder/valueTone`, `DeptAssigneeTiles placeholder`.
- Q&A: 편집 창 변경은 일괄 되돌리기 없음 — Ctrl+Z 단계별(모달 열린 채로도 동작, 입력 포커스 밖에서). 일반 노드의 지표 폴백은 데이터 모델에 없음(노드는 `system_fallback`만, 시간·빈도 메모는 맵 지정값).
- 검증: tsc·eslint·vitest 850·스모크 55/55(카탈로그 `--check` 포함).

## 2026-09-03 — 노드 편집 모달 실사용 피드백 9종 (dev)
- **양방향 라이브 동기**(사용자 요청 "인스펙터와 편집 창 값 싱크"): 편집 창 버퍼+하단 저장(⌘S)을 폐기하고 팝오버 확정·제목·설명 타이핑·부서/담당자·원문 메모가 노드에 즉시 반영(`patchLive`) → 인스펙터가 같은 상태를 본다. 반대로 props가 바뀌면 렌더 중 diff로 폼과 "변경 없는" 열린 팝오버 초안까지 갱신(IO는 `ioSync` 키로 편집기 리마운트). 하단은 완료(Esc)만, 미저장 확인 오버레이·변경 필드 표시 제거. 노드 데이터는 같은 메모리 state라 로딩·스켈레톤은 불필요.
- **사이드 독**: 호버 시 잘리던 안쪽 경계 → 스크롤 상자 안쪽 여백(px-3.5/py-2)+폭 200으로 해결, scale 1.1 + 6px 이동 + `hover:my-1.5`(margin 트랜지션으로 위아래 카드가 벌어짐). 클릭 전환은 고스트(클릭 카드 자리→가운데로 커지며 페이드)+가운데 카드(반대편 독 자리로 줄어들며 페이드) 380ms 후 노드 교체, 새 카드는 `summary-card-in` 팝인(`--swap-*` CSS 변수 실측 주입, reduced-motion은 즉시 전환).
- **원문 메모 표면**: 노드에 있는 폴백은 `system_fallback` 하나 — 시스템 타일 호버 메모 아이콘(보기·수정·적용)+시스템 팝오버 메모 칸, SP 노드 연간 건수 타일은 링크 맵 빈도 원문(읽기). 지정 모달의 메모 4필드 타일에도 호버 메모 아이콘(폼 버퍼 반영). 회당 지표의 다른 폴백(시간·실작업)은 맵 단위 지정값에만 존재해 노드 타일엔 없음. `SpFieldTile` 편집 타일을 button→role=button div로(중첩 버튼 유효화) + 포털 내부 클릭은 `contains` 가드로 타일 팝오버 오픈 차단.
- **IO 팝오버 '다른 노드에서 불러오기'**(+ Add 옆, 초안 있으면 잠김) — page의 IoImportModal 재사용(z 1360으로 팝오버 위, 필터 autoFocus라 Esc가 팝오버까지 닫지 않음). **부서 피커 내 부서 태그**(`SelectOption.tag`, 타일 피커·인스펙터 피커 모두 근접도 정렬+태그). **인스펙터**: BPM 속성 행 아이콘+라벨 통일(시스템 행머리=FallbackHint 호버 스왑), SP 지표 행은 참고치 Info를 라벨 뒤로·입력 `shrink-0`으로 맨 우측 동일 폭(라벨이 먼저 truncate), 툴팁은 `w-max`+`wide`(fixed 박스가 우측 앵커에서 150px로 쪼그라들던 원인).
- 검증: tsc·eslint·vitest 850·`pw-smoke-node-modal-tiles.mjs` 49/49. 매뉴얼 편집 ko/en 노드 편집 창 절 갱신.

## 2026-09-03 — 노드 편집 모달 타일화 + Subprocess 탭 지정 파라미터 (feat/node-modal-tiles)
- **노드 편집 모달(더블클릭·정보 수정)을 SP 지정 모달 디자인으로**(사용자 지시): 제목·설명은 유지, 유형·색·속성(부서·담당자=두 열 가로지르는 행 타일, 시스템·링크·GMP)·지표 7·입출력/조건을 2열 타일 + 클릭 위치 팝오버로. 폭 512 통일. 읽기 전용은 값 있는 타일만 정적, 입출력만 읽기 팝오버(사용자 결정). SP 노드는 상속 속성·4지표·IO/조건 읽기 타일 + 연간/FTE 편집(참고치 안내). 부서 확인 오버레이는 팝오버 안 "담당자 해제" 안내로 대체(Esc=취소).
- **비용 단일 타일**(사용자 결정): ₩/$ 두 타일 → 한 타일, 팝오버 앞 단위 탭(`CostUnitTabs`)+배타 안내, 타일엔 단위 필(`CurrencyPill`). 지정 모달·노드 모달 공통. **부서 피커 내 부서 체인 우선**(`sortDepartmentsByOrgProximity`, 새 맵 오우닝 부서 피커 규칙) — 공용 `DeptAssigneeTiles`가 두 모달을 담당.
- **PopoverActionBar**(사용자 결정): 변경 없음=취소 단독(셰브론 없음), 변경 시 저장+셰브론이 폭 트랜지션으로 열림·라벨 페이드, 글자·높이 축소. **Subprocess 탭**: '이 맵을 연결한 맵' 아래 **지정 파라미터** 읽기 타일(1열 행 타일) + 오너/관리자 '수정'→지정 모달(`SubprocessUsageTab`이 상세 자체 조회). 원문 메모 있는 파라미터는 행 호버 시 아이콘이 메모 아이콘으로(`SpFieldTile iconSlot` + `FallbackHint restIcon`).
- **선후행 사이드 독**(사용자 요청): 모달 하단 밴드 → 백드롭 좌우에 떠 있는 간소 카드(색 점·라벨·타입, `NavDock`), 호버 시 scale 1.05 + 모달 쪽 8px(`translate`/`scale` 속성 트랜지션·ease-spring), 클릭=노드 전환(변경 있으면 확인 유지). 백드롭은 자기 자신 mousedown만 닫아 독 클릭이 모달을 안 닫는다.
- **부서 타일 값=말단 부서 필**(사용자 결정): 필 클릭=조직 정보 모달(`OrgInfoModal` 중앙 변형, 경로는 디렉터리 말단 일치로 해석), 필 밖 타일 클릭=피커. 타일 값은 안 잘리고 라벨이 먼저 줄어든다(생략 후에만 값 truncate).
- 검증: tsc·lint·vitest 850(+2)·`pw-smoke-node-modal-tiles.mjs` 26/26. 랜드마인: 축소 캔버스에서 노드 더블클릭이 제목을 맞히면 이름 편집으로 빠진다 — 스모크는 우클릭 "Edit info"로 연다. 타일 값은 안 잘리고 라벨이 먼저 줄어든다(생략 후에만 값 truncate).

## 2026-09-03 — 매뉴얼 6종 main 기준 보완 (main)
- 8/31 이후 델타를 md 매뉴얼에 반영(사용자 지시 "메인 기준 검토·보완"): L5 확정 거버넌스(confirmed 상태·게이트 6·직속 확정권·확정 요청·draft 열람 룰·차콜 배경·분류 노트), 레벨 위임·권한자 모달·현황판·홈 분류 요약 카드, 임포트 거버넌스 체크·오너 미확정·부서 경로 해석·0.4 착지 규칙, 인터뷰 원문 메모·노트 CRUD·SP 참고치·타일 지정 모달·팝오버 공통 조작, SP 피크 재배치·링크된 맵 열기·Framework 칩 좌상단·온보딩 말풍선, 온디맨드 백업, CSV 21열(`input_flags`) 정합. 사용자 매뉴얼에 없던 **AI 컨설턴트 인터뷰** 절 신설. 문구는 i18n 실값 대조.
- 슬라이드 매뉴얼(`docs/manual/slides/`)은 실화면 캡처 파이프라인이라 이번엔 재생성하지 않음 — md와 어긋난 상태(후속).

## 2026-09-03 — 컨설턴트 임포트 후속 1~6: 거버넌스 확인·원문 메모·노트·참고치·지정 모달 (dev)
- **배경**: 임포트 폴백 6종·노트·값 대체 전수조사(아티팩트 "임포트 폴백 지도") — 폴백은 오너 전용 표면뿐, L5 스코프 노트는 조회 경로 없음, 오너 대기 플래그는 수동 이전으로 안 꺼져 재전달이 수동 배정을 덮던 구멍 4종. 설계 `docs/superpowers/specs/2026-09-03-import-governance-review-design.md`·`…-import-fallback-followups-design.md`.
- **재임포트 결정 UI**: 오너·오우닝 부서·승인자·임포트 노트 교체는 dry-run "Governance changes"에서 체크한 것만 적용(`decisions`, 미매칭 422; 노트는 사람이 고친 임포트 노트가 없을 때만 기본 체크, 사용자 노트 불변). 오너 대기 예외 폐지·수동 이전이 플래그 해제·카드 "Owner unconfirmed" 필. 확인 다이얼로그 → 리포트 하단 고정 [Cancel][Apply] 바.
- **표면 확장**: 인터뷰 원문 메모 5종 `PATCH /maps/{id}/fallback-notes`(editor) + `MapFallbackNotes`(에디터 맵 탭=점유권자 편집·홈 카드·비교 요약 기본 접힘; 행머리 아이콘 호버 스왑, 팝오버 360). 노트 CRUD(맵=오너, L5=체인 관리자/sysadmin, `edited_at`) + `MapNotesSection` 프리셋 칩·'[' 자동완성·비권한자 안내, 에디터 맵 탭 순서 SP 카드→원문 메모→노트(L5 캔버스는 카테고리 스코프). SP 지정 참고치 `sp_annual_count/sp_fte`(임포트는 맵 지정값+L5 캔버스 노드 둘 다, 노드 인스펙터 Info 호버). SP 지정 모달 타일 재디자인(`max-w-lg`, 2열 타일 라벨 톤다운+값 우측, 클릭 위치 팝오버·Σ·원문 메모, IO 플라이아웃은 헤드리스 편집기 + 푸터 OK 줄 맨 앞 '+ Add'). SP 카드 액션 행 wrap.
- **소형 입력 팝오버 공통 경험**(`PopoverActionBar`, 사용자 결정): kbd 키 안내(Enter/⌘·Ctrl+Enter/Esc, "바깥 클릭" 문구 제거) + 상태형 주 버튼(변경 없음 Cancel / 있음 Save=저장하고 닫기 / 메뉴 Save 후 Saved) + 셰브론 메뉴 3종(Save·Save and close·Close without saving). 적용: SP 타일 팝오버·인터뷰 원문 메모 팝오버·노트 폼. 바깥 클릭은 변경 있을 때만 저장. 큰 편집 모달은 대상 밖.
- **사용자 노출 문구 긴 대시 → 짧은 대시** 일괄 전환(i18n·JSX·문자열 리터럴·백엔드 API/리포트 메시지·테스트 단언, 150파일 605줄; 코드 주석·docs 유지). FE 파서 `linkage skipped -` 동기.
- 검증: pytest 1347·vitest 848·스모크 `pw-smoke-interview-import.mjs` 23/23·`pw-smoke-import-followups.mjs` 23/23. 랜드마인: 개발 서버를 `| head`로 띄우면 EPIPE로 죽는다(파일 로그), 지정 모달은 게시본에서만 활성, 에디터 goto는 domcontentloaded.

## 2026-09-03 — SP 피크 재배치·목업 드래그·우클릭 맵 이동·프레임워크 탐색 좌상단 통일 (dev)
- **SP 미리보기 피크 재배치**: 헤더를 정보 표면(좌: 맵 이름·오너·게시 버전 / 우: 업무체계 경로·미지정 안내)으로 바꾸고 인스펙터 탭을 좌측, 추가/이동 버튼은 미리보기 우상단에 떠 있는 독립 버튼 2개로(추가=강조색, 한 줄 고정+말줄임) — 패널 높이를 이분할하던 세로 레일은 과하다는 피드백으로 폐기. 목업 노드는 클릭(드롭다운) 유지 + 드래그→캔버스 드롭 추가(`dragPayload`, 행 드래그와 동일 dataTransfer 계약) — 드래그 중 피크는 언마운트 대신 visibility 숨김(언마운트=Chrome 드래그 취소), dragend에서 닫음.
- **피크 미리보기 휠 줌**: SVG 프리뷰 위 휠이 줌 스텝(100~300%, 커서 지점 앵커 고정 — 버튼 줌은 중앙 앵커로 통일). 휠은 프리뷰가 preventDefault+stopPropagation로 전부 소비해 뒤 캔버스·패널과 동시 입력되지 않는다 (React `onWheel`은 루트 passive라 preventDefault 무시 → 네이티브 리스너로 부착).
- **새 맵 AI 컨설턴트 온보딩 말풍선 i18n+가시성**(사용자 요청): 하드코딩 영문이라 한글 UI에서도 영어로 뜨던 것을 `consultOnboard.*` 키 7종(en/ko)으로 이관. 내용은 액센트 틴트 아이콘 배지 + 아이콘 태그 필 3종(인터뷰·문서 첨부·초안 자동 생성) + 화살표 시작 버튼으로 재구성, 본문은 `break-keep`(한국어 어절 보존).
- **피크·라이브러리 UX 5종**(사용자 요청): ①미리보기 SVG `select-none` — 라벨이 드래그 선택되면 팬(초점 이동)이 겉돌던 문제. ②헤더 업무체계 경로를 클릭 트리거로(FrameworkPeekTrigger 재사용) — 체계 트리 플라이아웃 + "다른 체계 검색" 모달. 둘 다 body 포털이라 피크가 먼저 닫히는 것을 막으려 `onOpenChange`로 호스트 자동 닫힘(바깥클릭·이탈)을 억제. ③부서 칩 호버 카드 유예 닫기(500ms) 폐기 → 즉시 페이드아웃(`.animate-item-out` 140ms, 페이드 중 재진입은 되살림). ④피크 액션 폭 통일(추가·이동·게시본 표기 8.5rem) + 이동 버튼을 우하단으로 내리고 게시본 표기를 그 위에. ⑤SP 우클릭 "링크된 맵 열기"를 삭제 아래 구분선 뒤 맨 끝으로(캔버스 이탈 동작 분리). pw 14/14 통과.
- **SP 노드 우클릭 "링크된 맵 열기"**: 링크 부재/삭제·권한 없음(locked)이면 비활성, 클릭 시 이탈 확인 게이트(openMapPrompt). autosave 반영 전 신규 노드는 캔버스 state 폴백으로 해석.
- **프레임워크 탐색 배선·위치 통일**: 헤더 칩의 검색 불능은 회귀가 아니라 `onBrowse` 미배선 — 칩과 L5 탐색기 풋터에 "다른 체계 검색"(FrameworkBrowseModal) 배선. 일반 등록 맵은 칩을 좌상단으로 스왑(제목+저장 체크리스트는 우상단, 플라이아웃 우측 개방) — L5 캔버스와 같은 자리 인식. pw 검증 18/18+스크린샷 7종.

## 2026-09-02 — 컨설턴트 임포트 미세조정: 오너 표기·부서 트리 해석·라이브러리 호버 카드 (dev)
- **오너 표기 owner_id 기준 통일**: 카드·상세 owner_name·에디터 인스펙터가 전부 `created_by`를 보고 있어 임포트 맵(created_by=임포터 ≠ owner_id)에서 임포터가 노출되던 간극 교정 — BE 목록/상세 해석·`MapOut.owner_id` 노출·FE 폴백 3표면(`owner_name ?? owner_id ?? created_by`) 일괄 전환. 미등재 오너는 id+퇴사 배지 폴백.
- **전달물 부서 트리 해석 + L6 owning 등록**: `rows[].department`(루트부터 N단계 슬래시 경로)를 완전일치만 보던 것을 4단 사다리로 — known 완전일치 → 선두 드랍(트림 정렬) → 유일 세그먼트-서픽스 → departments 미러 체인 정렬(직원 없는 부서도 트림 canonical 착지). 실패 시 NULL 대신 정규화 경로 그대로 등록(as delivered), 오너 pending이어도 부서만으로 owning 등록(임포터 org 폴백은 계속 금지). 구 엔진이 owning 없이 만든 pending 맵은 재전달에서 부서만 채움 — 홈 부서 트리에 임포트 부서 그룹이 바로 선다.
- **라이브러리 부서 칩 호버 카드**: 중앙 모달+백드롭 블러 → 커서 앵커 고정 카드(`OrgInfoModal anchored` 변형 — 백드롭 없음·클램프+실측 보정·마우스 추적 좌표) 전환, 칩엔 호버 어포던스(리프트+보더+섀도) 추가. map-detail-card의 중앙 모달 용법은 불변.
- **L5 워터마크 마스크 기울임**: 스탬프(CONFIRMED/DRAFT)가 -24°라 수평 중앙 띠 마스크론 스탬프 양끝이 위아래 로고 타일과 겹침 — 마스크 밴드를 같은 각도(156deg 그라데이션, 36~64%)로 기울여 평행 정렬.
- **framework draft 열람 룰 재정립**(사용자 결정): 라이브 draft는 sysadmin·자기/조상 카테고리 권한자만 열람 — 맵 상세 versions에서 draft 제외(`can_view_draft` 노출)+draft 그래프 403(BE 강제), 뷰어는 최신 confirmed 스냅샷 착지(없으면 빈 상태 안내). 상태 배너 3종(Draft=앰버 상시·Confirmed=액센트·Superseded=회색+최신 라벨) + 확정 스탬프는 최신=한 줄 `CONFIRMED vX.Y`·과거=2단 `SUPERSEDED+LATEST vX.Y`(회색 톤). 상태 배너에 우측 닫기 버튼(버전:사유 키 — 맵 재진입·버전 전환 시 재노출). 워터마크 표기는 전부 Title case(Confirmed/Draft/Superseded/Published/Expired/Read only — 가독성, uppercase 클래스 제거).

## 2026-09-02 — 권한자 관리 UX 3종: 드롭다운 z·버퍼+확인·트리 인라인 표시 (dev)
- 권한자 모달 백드롭 z-1300이 피커 z 계약(호스트 ≤1200·드롭다운 1250)을 위반해 드롭다운이 블러 뒤로 가던 것 교정. 편집은 로컬 버퍼로 바꾸고 확인 버튼 1회만 서버 저장(부서 지정 Confirm 게이트 선례 — 취소/Esc/백드롭=폐기).
- 설정 트리 행의 코드 옆에 그 카테고리에 직접 붙은 권한자를 인라인 표시(2명+초과 +N 호버 툴팁) — 이름은 언어 기준 이중 표기 `주이름(보조이름)`(ko: 한글(영문)·en: 영문(한글), person-hover-card 규칙의 한 줄 판, 모달 필 동일) — 신규 `GET /categories/permissions-map`(1쿼리, sysadmin=전체·위임 관리자=스코프 필터) + 모달 확정 시 즉시 갱신.

## 2026-09-02 — height-shift 충돌 기반 전환 + 에디터·임포트 개선 (feat/height-shift-collision-only)
- **height-shift 충돌 기반 전환**: 커진 노드의 Y축 보정을 전역 계단함수 → 충돌 기반 필드로(`lib/height-shift.ts` 재작성) — 성장분은 저장 여백을 먼저 흡수, X 겹침 열만 `min(저장 간격, 16px)` 유지하며 밀리고 같은 행은 max 동기화. 역변환은 열 프로브 이분탐색(`invertDisplayY`)+드래그 자기 푸셔 제외, 저장 좌표 불변·BE/임포트 배치 무변경. `pw-smoke-height-shift.mjs` 계약 재작성 14/14.
- **에디터/설정 UX 4종**: 펼침 자식 엣지 라벨 알약 복원(`styleEdgeLabelPill` 공용화), 라이브러리 부서 칩 리프 한 줄 표기+호버 조직 모달(닫힘 500ms 유예), 대시보드 브라우저 뒤로가기 → 설정 레일 복귀(popstate), 펼침 자식/게이트웨이 엣지 사용감 통일 — F14 하이라이트 경계 관통·자식 엣지 선택 개방(읽기전용 인스펙터)·게이트웨이 "흐름 안내 엣지" 안내(selected는 styledEdges 직접 세팅 — 자식은 edges state 밖이라 RF 에코 소실).
- **인터뷰 임포트**: dry-run 이슈 메시지 전수(어댑터 49종+라우터 3종) 영어+한글 병기. self edge(A→A)는 드랍 대신 분기 노드 합성 — L6 `a{seq}r` 합성+진출 이설+승격 복원, L5 단독 진출도 강제 fork+back 등록, 이름은 고정 "반복 여부(자동 생성됨)"(`LOOP_BRANCH_NODE_NAME` 단일 소스, 팬아웃 유래는 "{이름} 결과" 유지), quote 노트 보존·자동 생성 노티. 설계 문서 3종 동기화.

## 2026-09-02 — 트랙 C: 레벨 위임·현황판·레벨 요약 카드 머지 — 스펙 §1~§8 전 항목 구현 완료 (dev)
- 레벨 인지 판정(`resolve_category_admin`·`get_admin_scope`·`/me` category_admin_root_ids)과 카테고리 CRUD 위임 5게이트(생성·개명·정렬=서브트리 seed 포함 / 이동·삭제=seed 금지+새 부모 검사 / 임명=하위 레벨만 / **L5-only 관리자는 구조 변경 전체 403** / 루트 생성·임포트=sysadmin). fw_confirm 요청 철회(`DELETE .../fw-confirm-requests/pending`, 점유 미반환)+그룹 수신자 실증.
- 현황판 `GET /categories/framework-overview`(배치 검사기 — 캔버스 수 무관 고정 쿼리, 단건 동치 테스트 6코드 전수)+설정>Framework Manage↔Status 테이블, 레벨 요약 `GET /categories/{id}/summary`(전체 공개·can_edit_linkage)+홈 트리 행 선택→aside 요약 카드(맵 선택 배타·빈공간 복귀). 위임 관리자는 설정 탭에서 자기 서브트리만(frameworkAdmin 접근). 실패 필 라벨은 부정형(`framework.gateFail.*`)으로 분리.
- 검증: 신규 스모크 `pw-smoke-framework-delegation.mjs` 18/18(위임 재현은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys` — 기본 false는 전원 sysadmin 바이패스). 게이트 pytest 1311·vitest 833·build 그린.

## 2026-09-02 — 트랙 B: 확정 게이트 6종 + 점유·직속 L5 확정권 + 확정 요청 워크플로 (feat/fw-track-b-gates)
- 확정 게이트 6종(missing_l6·placeholder·stale_link·l6_unpublished·noexit_cycle·plain_fanout — 병행 팬아웃은 전부 `Edge.gateway=parallel`이면 예외)을 체크아웃 점유·직속 L5 관리자(`is_direct_l5_admin`) 자기확정권과 함께 `perform_framework_confirm`에 통합, `GET /maps/{id}/confirm-readiness`(+`can_confirm`)를 체크리스트 단일 소스로 노출하고 라이브 draft 삭제를 차단했다.
- 상위 관리자용 확정 위임 요청 워크플로(`kind='fw_confirm'`, 직속 L5/sysadmin은 409→직접확정 유도)를 승인 표면에 통합, FE엔 Approval 탭 게이트 체크리스트+확정 버튼 disabled 연동·요청 CTA·알림 3종을 붙였다. 스모크(`pw-smoke-framework-canvas.mjs`)는 게이트 체크리스트 중심(플레이스홀더 노드 임시 주입으로 위반→해소 결정적 검증) 24/24, 요청 워크플로는 BE 10케이스로 갈음.
- **머지 전 최종 리뷰 후속 4건**: 에디터 그래프 왕복(`toAppEdges`/`buildGraph`)에서 빠져있던 `Edge.gateway` 직렬화를 placeholder_category_id 선례대로 보강(안 하면 저장마다 병행 팬아웃 예외가 서버에서 소거됨) — vitest 3건 추가. 확정 요청 생성 시 요청자의 draft 점유를 자동 해제(요청=편집권 이양, sticky 점유가 decide 확정을 상시 409로 막던 교착 해소) — BE 1건 추가. `fw_confirm_requested` 수신자에 sysadmin(대체 처리자) 합류. 스펙 §4에 게이트 6 판정 기준(source 노드 out-degree) 각주 추가.

## 2026-09-02 — 문서 정리: main 머지 완료 스펙·플랜 폐기 + PROGRESS 아카이브 (dev)
- 폐기 정책(`rules/common/documentation.md`)에 따라 main 머지 완료분 삭제: superpowers 스펙 5(approval-comments·collab-staging·topnav·io-linking·node-spacing)+플랜 12(거버넌스 r3~r6·8월 트랙 전부·framework-l5-linkage)+design 1(field-promotion — 구현 완료·QA 문서 존치). 코드 주석 참조는 파일명으로 강등(`git grep` 전수 확인). 유지: 미구현·핸드오프·전제 스펙(consultant-hierarchy·governance-ux A/B/C·data-surface-parity·interview-import 8/18·v04 2종·framework 8-28 스펙·트랙 A 스펙/플랜).
- PROGRESS 8/18 이전 137줄을 `docs/history/PROGRESS-archive.md`(2026-09-02 이동분)로 아카이브.

## 2026-09-02 — Framework L5 퍼블리시 거버넌스: 스펙 확정 + 트랙 A 머지 (dev)
- 브레인스토밍으로 스펙 확정(`docs/superpowers/specs/2026-09-02-framework-l5-publish-governance-design.md`): 완결성 게이트 6종·`confirmed` 상태 분리·옆문 봉쇄·레벨별 권한 차등·확정 요청 워크플로·현황판. 구현은 트랙 A(상태·봉쇄)→B(게이트·요청)→C(권한·현황판) 순.
- **트랙 A 구현 머지**: 확정 스냅샷 published→confirmed 분리(멱등 startup 이전·게시 순번 채번 중단·삭제 보호), 옆문 봉쇄(versions 8종+승인자/협업자/개명·SP요청 422 — 실파손 경로였음: 확정 후 create-version이 빈 draft 확정, 게시 옆문은 스냅샷 전량 expired / 설정 페이지 4탭·에디터 버튼 숨김), 시각 언어(CONFIRMED·DRAFT 스탬프 -24°·브랜드 워터마크 중앙 띠 마스크·타임라인 칩·다크 PNG export). 게이트 pytest 1255·vitest 821·스모크 14/14.
- 트랙 B 인계: plain_fanout 게이트는 임포트의 "전부 parallel 팬아웃 합법" 예외 반영 필요·framework 라이브 draft DELETE 미차단(게이트 설계 때 판단).

## 2026-09-01 — 대형맵 임포트 스트레스 더미 (dev)
- `docs/samples/framework-linkage-dummy/brr-large-l5.json` — 대형맵 드래그/렌더 성능 실측용 인터뷰 0.4 세트(완제품 배치기록 검토). L6 6개 중 "제조기록 전수 검토"가 대형맵: 12구획×(착수+점검 20+취합) 팬아웃 격자 = **268노드·497엣지**(R2 실측 규모). 시험기록 대조 100노드, L5 연계 캔버스 8노드(분기 2), 유닛 간 IO 완전일치 5쌍, branch/loop/bypass/exception·decision/handoff 포함.
- 로컬 검증: dry-run 어댑터 이슈 0(경고는 기존 더미 세트와 동일 클래스 — owner null 관례 + 로컬 데모 db에 없는 승인자 jihoon.park/sujin.han), apply로 6맵+연계 캔버스 생성, 에디터에서 268/497 렌더·드래그·드롭 영속 실측 확인.

## 2026-09-01 — 캔버스 드래그 성능 라운드 2: 드래그 중 nodes 동결 (perf/canvas-drag-r2)
- 일반 드래그의 dragging=true 프레임을 `nodes` state에 커밋하지 않고(페이지 리렌더·`[nodes]` memo 재계산 0) 드롭 flush 1회만 커밋. 352노드·351엣지 스트레스 맵 프로드 A/B(순서 교차): **avg 47~49→17.2ms/frame(-64%), p95 150→16.8ms(-89%), over33 176→2** — vsync(16.7ms) 락. 엣지 0 맵도 avg 39→16.9·p95 116.7→16.8.
- 설계는 인라인 펼침의 suppress+라이브 오버레이 일반화 — 단, **controlled RF는 부모가 position을 되돌려줘야만 노드가 움직인다**(스토어는 `onNodesChange` 디스패치만, 내부 미갱신 — 1302줄 "ref면 안 됨" 주석이 정답이었다). 그래서 프레임당 라이브 좌표를 RF props 동기화와 같은 채널(`useStoreApi().getState().setNodes`)로 직접 흘린다 — 노드·엣지·선택링·액션바(dragging 플래그)가 전부 따라오고, 드래그 중 다른 state 변경 시엔 displayNodes의 모듈 맵(`generalDragLive`) 오버레이가 stale adopt(스냅백)를 막는다. **트레이드오프: 스토어 직행은 세미-내부 API** — RF 메이저 업그레이드 시 이 echo가 첫 점검 대상(깨지면 "드래그 무반응"으로 즉시 드러남).
- 동결 제외 게이트: Shift 축고정 프레임(보정 좌표를 RF에 되돌려야 시각 잠금 — 기존 per-frame 커밋 유지), 그룹 멤버 제스처(그룹박스가 nodes 기반 memo라 라이브 추종 필요), 인라인 펼침(전용 dragLiveById 경로 유지). 드롭 후 존/충돌/ctrl-복사·autosave는 flush가 stop 콜백보다 먼저 큐잉되는 RF 순서(소스 확인)에 그대로 얹힘.
- 검증: 신규 `pw-verify-drag-freeze.mjs` 15/15(커서1:1+영속·Shift 중간프레임 이탈0·다중선택·그룹박스 라이브·링 표시/해제·undo)·`pw-verify-zone-swap.mjs`(swap 실행+aStart 계약) + 기존 shift 17/21·ctrl 29/31·밴드 연속성·펼침 드래그 — **전 항목 베이스라인(64dfbc35 별도 빌드)과 픽셀 단위 동일**(mid-drag 엣지 끝점 거리까지 일치). 게이트 lint·vitest 812·build 그린.
- 기존 이슈 확인(이번 변경 무관, 베이스라인 동일 재현): 다중선택 시 `.react-flow__nodesselection-rect` 오버레이 미렌더, Ctrl 드래그 mid-drag 고스트(`.bpm-node-ghost`) 미표시 — 별도 추적 필요.
- 측정 랜드마인: `next start`의 `/api` rewrite는 **BACKEND_URL을 빌드 시점에 굽는다** — 런타임 env로 안 바뀌므로 측정용 빌드는 `BACKEND_URL=… npm run build`로 만들 것(안 그러면 기본 8000의 공용 dev.db에 테스트 데이터가 들어간다. 이번에 들어간 5개 맵은 하드 퍼지 완료).

## 2026-09-01 — 임포트 dry-run 리포트 가독성 재구성 (dev)
- 리포트가 코드(taskId)·영문 상세 500행 평면 테이블이라 같은 경고가 20번 반복돼 읽히지 않았다. **파일 → L5 연계 캔버스 → 맵** 계층으로 접고, 1열을 사람이 아는 이름(L6 라벨·카테고리 경로)으로 바꿨다. 반복 경고는 상단 "확인 필요" 다이제스트에 종류별 1줄(영향 맵 이름 + 개수)로 접는다. 고유키(taskId·unitId·카테고리 코드)는 Hash 아이콘 호버 툴팁으로만 노출.
- 맵 이름은 서버 rows에 없다 — 업로드한 인터뷰 JSON에서 코드→이름 색인을 만들어 붙인다(`lib/interview-report.ts`, 백엔드 스키마 무변경). 미등록 상세 문구는 원문 그대로 통과시켜 정보 손실 없음.
- 툴팁은 위 공간이 없으면 **아래로 플립**한다(경계에서 클램프만 하면 앵커 행을 덮었다). 정렬은 CSS `translate` 속성으로 — Tailwind v4 `-translate-*`와 같은 속성이라 `transform`으로 덮으면 두 번 밀린다.

## 2026-09-01 — 0.4 임포트 트랙 핸드오프 문서 (dev)
- `docs/design/2026-09-01-interview-import-v04-result.md` — 이번 트랙의 최종 결과문서(확정 계약·검증 수치·한계 7건·확장 계획 5건·후속 점검 6건). 시행착오는 뺐고, 규칙 근거는 같은 날 설계 스냅샷, 필드 대조는 `docs/qa/interview-import-field-map.md`로 분리.
- 최우선 후속은 **실파일 0.4 dry-run 대조** — unknown key 리포트가 그대로 어댑터 수정 목록이 된다.

## 2026-09-01 — 0.4 전 기능 더미 1세트 (dev)
- `docs/samples/framework-linkage-dummy/change-control-l5.json` — 변경관리 L5 + L6 4건. seq·branch(exclusive/parallel)·loop·bypass, decision/handoff kind, exception variant, IO 완전일치 체인을 한 파일에 다 태운 시연용 세트.
- 실 임포트 확인: 어댑터 이슈 0 · L6 4맵(24노드/25엣지, 분기 승격 4) · 연계 캔버스 7노드(분기 3개, 위/아래 팬아웃) · IO 자동 연결 21건 · 자동 draft 4건 · L5 노트 8건. `분류 확정 CR`을 두 노드가 내는 경우 최근접 상류(동률이면 낮은 seq)가 선택되는 것까지 확인.

## 2026-09-01 — L5 분기 출구 팬아웃 배치 (dev)
- 분기 노드를 세워도 캔버스가 한 줄이라 어디서 갈라지는지 선만으론 안 읽혔다. 분기 출구를 **오른쪽 위 → 아래 → 옆 순**으로 벌리고 엣지 출구 핸들(`s-top`/`s-bottom`/`s-right`)을 기하에 맞췄다. 분기 노드는 일반 노드라 4면 핸들을 다 쓸 수 있다(SP는 좌 `in`·우 `__primary__` 고정).
- 행 배정은 먼저 배정된 쪽이 이긴다 — 두 갈래가 같은 L6로 합류할 때 나중 분기가 위치를 흔들면 안 된다. 출구 변은 최종 행에서 되뽑아 기하와 항상 일치시킨다(4번째부터는 위/아래로 한 칸씩 더).
- 검증: pytest 1249(신규 4)·ruff 그린 + 실 서버 임포트로 `◇준비결과 ─위→ 현장 수행 / ─아래→ 보고(bypass)` 시각 확인.

## 2026-09-01 — L5 연계 캔버스 분기 노드 (dev)
- L5의 L6 연계는 `A→B, B→A(loop), B→C`가 가능한데 분기가 다중 out-edge로만 표현돼 어디서 갈라지는지 안 보였다. L6 맵은 branch 엣지의 src를 decision으로 승격하지만 캔버스 src는 subprocess라 타입을 못 바꾼다 → **팬아웃 앞에 분기 노드를 새로 끼운다**(`B → ◇(B 결과) → A|C`). 조건 라벨은 분기 노드 출구 엣지가 들고 간다.
- 기준: 나가는 엣지 2개 이상 && 전부 `gateway=parallel`은 아님(병행은 택일이 아니라 마름모가 오독을 만든다 — L6 승격 제외 규칙과 동일). 재임포트 재사용은 계보 키(`__branch__{src}`), 핸들은 끝점 타입별(SP=in/`__primary__`, 분기=`t-left`/`s-right` — 섞으면 RF가 엣지를 조용히 버린다).
- 검증: pytest 1245(신규 5)·ruff 그린 + 실 서버 임포트로 `준비 → ◇준비 결과 → {수행, 보고}`, `수행 → ◇수행 결과 → {보고, 준비(loop)}` 확인.

## 2026-09-01 — L5 연계 캔버스 사이클 배치 (dev)
- 사용자 지적대로 SP 노드끼리 `kind:"loop"`으로 **사이클이 생길 수 있는 구조**였고, L6 맵과 달리 캔버스 배치엔 `back_pairs`를 안 넘기고 있었다. 사이클이 남으면 Kahn 큐가 비어 **전원이 leftover로 떨어져 랭크가 노드 나열 순서로 매겨진다** — 같은 그래프인데 전달 순서만 뒤집으면 배치가 뒤집히는 걸 실측 확인(멀쩡해 보였던 건 `map_codes`가 우연히 진입 L6부터였기 때문).
- 되돌아가는 엣지를 랭크에서 먼저 걷어내 선행→분기 순서를 확정하고 복귀 엣지를 그 위에 그리도록 변경. 제거 대상은 전달물의 `kind:"loop"`(확정) + DFS가 찾은 잔여 back edge(보완, 진입 노드부터 탐색). 이를 위해 `InterviewLinkageEdge.kind`를 엔진까지 전달(저장 안 됨).
- 검증: pytest 1240(신규 5)·ruff 그린 + rows를 역순으로 전달해도 캔버스가 흐름 순(준비→수행→보고)으로 배치됨을 실 서버에서 확인.

## 2026-09-01 — 첫 자동배치에서 엣지 라벨↔노드 간섭 제거 (dev)
- 실측이 추정을 뒤집었다: 라벨은 이미 `maxWidth:160`에 걸려 있었고, 진짜 원인은 **랭크 간격 240 − 노드 폭 170 = 틈 70px**이라 어떤 읽을 만한 폭도 안 들어간다는 것(신규 스크립트 `pw-measure-edge-label-overlap.mjs`로 3개 맵 17건 실측).
- 라벨 최대폭을 배치의 입력으로 승격 — 랭크 간격을 **그 구간을 지나는 엣지 라벨 폭**에서 계산한다(`estimate_label_width`: 한글 1em·그 외 0.55em 근사 후 최대폭 클램프). 라벨 없는 구간은 240 유지 — 일률적으로 넓혔더니 맵이 과하게 커졌다(중간 시도, 폐기). 최대폭 상수는 FE `canvas.ts EDGE_LABEL_MAX_WIDTH`와 동기.
- 검증: 같은 스크립트로 재측정 17건 → **0건**, 맵이 뷰포트에 다 들어옴. pytest 1235(신규 4)·ruff·tsc·lint 그린.

## 2026-09-01 — 임포트 후처리 3종: IO 자동 연결·가로 자동정렬·편집용 draft (dev)
- **IO 자동 연결** — 아웃풋 줄과 인풋 줄이 완전일치하고 흐름상 순방향이면 IO 링크(원본↔미러)로 잇는다. 후보가 여럿이면 최근접 상류 하나(한 항목=링크 1개 불변식). 항목 id는 전달 좌표에서 파생한 결정적 sha1 — uuid4면 재임포트마다 바뀌어 기존 미러가 끊긴다. 샘플 7개 맵에서 40건 연결, 전부 흐름 순방향. 전달물이 고유키를 싣기 시작하면 텍스트 대신 그 키로 잇는다.
- **가로 자동정렬** — 노드·엣지를 다 만든 뒤 배치를 최종화. 에디터 `autoLayoutFlow`(LR)의 파이썬 동치본 `scripts/consultant_layout.py`(dagre 대신 rank+배리센터, 그 뒤 computeSpine·alignBackbone·핸들 지정은 TS 이식). L5 연계 캔버스는 **새로 만들 때만** 적용(보강은 "추가만·이동 없음"). ⚠️ 좌표는 시그니처 밖이라 무변경 재임포트는 배치를 갱신하지 않는다.
- **게시본 위 편집용 draft** — 게시 직후 자동 생성(점유권자 없음 — 실행자로 잡으면 실오너가 강탈 없이 편집 불가). 손 안 댄 draft는 재전달이 새 버전으로 재사용해 이력에 쌓이지 않게 했다(편집 흔적이 있으면 보존하고 새 버전을 따로 게시).
- 검증: pytest 1231(신규 17)·ruff 그린, 실 서버 신규 L5 apply — IO 8건·주 흐름 직선 정렬·역행 loop top 핸들·draft 1건 확인.

## 2026-09-01 — 컨설턴트 인터뷰 JSON 0.4 임포트 (dev)
- 전달 스키마가 흐름 그래프를 싣기 시작(`relations`) — 0.3에선 seq 순서로 추측하던 흐름이 이제 명시 엣지(seq/branch/loop/bypass + exclusive/parallel 게이트웨이·조건·근거 발화)로 온다. **0.3은 거부**(수용하면 흐름이 조용히 일직선으로 뭉개짐), 저장소 샘플 5종은 0.4로 변환.
- L7 엣지는 맵 그래프로(라벨=label+condition 2줄, branch면 src를 decision 승격 — `actions[].kind`는 분기를 안 알려준다, loop은 Start 배선 판정에서만 제외), 최상위 L6 엣지는 **L5 연계 캔버스를 시드/보강**(추가만·이동 없음, 타인 체크아웃이면 스킵). 이걸로 0.4에서 처음 값이 실리는 `annual_count`/`fte`가 SP 노드에 착지 — 종전엔 착지면이 없어 경고 후 버려졌다.
- ⚠️ 실브라우저에서 밟은 함정: 서버가 만든 SP 끝점 엣지에 전용 핸들(`in`/`__primary__`)을 안 넣으면 **React Flow가 엣지를 조용히 버린다**(DB엔 있는데 캔버스엔 선이 없음) → `docs/lessons/canvas-react-flow.md` §6에 기록, 회귀 테스트 추가.
- 필드 착지·무시·조용한 오변환 전수 대조표: `docs/qa/interview-import-field-map.md`. 검증: pytest 1214(신규 20)·ruff·vitest 812·tsc·lint 그린 + 실 서버 dry-run/apply(경고 0)·연계 캔버스/분기·루프 스크린샷.

## 2026-09-01 — 핫픽스: 피크 목업 드롭다운 "해당 맵으로 이동" 무반응 (dev)
- 목업 드롭다운 메뉴가 body 포털이라 피크의 바깥클릭 닫기(mousedown 캡처)에 걸려 **click 전에 피크째 언마운트** → 이동 게이트(openMapPrompt) 미표시·추가 항목도 동일 사망. 내부 mockMenu 닫기 핸들러엔 제외가 있었는데 피크 레벨 핸들러에 누락 — mockMenuRef를 공유해 양쪽 모두 제외.
- 검증: 신규 `pw-verify-peek-mock-open.mjs` RED(gateVisible 0)→GREEN(게이트 표시·콘솔 에러 0), lint·vitest 812·build 그린.

## 2026-09-01 — 온디맨드 백업 + 백업파일 로컬 다운로드 (dev)
- 일간 사이드카만 있던 백업에 **온디맨드 경로** 추가 — 설정 > Batch jobs DB 백업 카드에 "Backup now"·백업 파일 목록·다운로드. postgres는 backend가 `${BACKUP_DIR}/backup.request` 트리거를 쓰고 사이드카(60s→5s 폴링)가 소비해 pg_dump, 로컬 sqlite는 backend가 backup API로 즉시 사본. backend 컨테이너에 `${BACKUP_DIR}` 마운트 추가(compose).
- 파일명 화이트리스트(`bpm-*.dump|sqlite`)로 경로 탈출 차단, 전부 sysadmin 게이트. 검증: pytest 1200 그린(신규 6), `pw-verify-backup-ui.mjs` E2E(실행→목록→다운로드 577KB) 통과.

## 2026-09-01 — 캔버스 드래그 성능 라운드 1 (dev)
- 352노드·351엣지 스트레스 맵 실측(프로드): 드래그 평균 41.5ms/frame·p95 125ms → **35.5ms·p95 100ms**. 최대 병목은 꺾은선 엣지의 장애물 회피 — 엣지마다 `useNodes` 전체를 filter+map+inflate해 **매 프레임 엣지×노드 규모 객체 생성**(GC 폭증) → 노드 배열 identity당 1회 공유 캐시 + 양끝 노드는 스캔 중 스킵 + 밴드 프루닝·최근접 후보 조기종료.
- displayNodes의 프레임당 낭비 2건 제거 — 담당자 드리프트 판정을 users 선형 스캔에서 name→dept Map으로, height-shift 오프셋 적용 노드는 WeakMap identity 캐시로 무변경 노드 리렌더 차단. 남은 병목은 페이지 전체 리렌더(거대 JSX)+RF 스토어 팬아웃 — 다음 라운드는 드래그 중 `nodes` 동결(dragLive 일반화) 검토.
- ⚠️ 측정 중 발견한 랜드마인: `nodes.id`/`edges.id`가 **전역 PK**라 다른 버전에 같은 id로 graph PUT하면 upsert가 기존 버전의 노드 행을 새 버전으로 **이관(탈취)**한다 — 실데이터는 uuid라 충돌 없지만 CSV 왕복(export→다른 맵 import) 같은 id 재사용 경로는 위험. 경계 가드 미구현(후속).

## 2026-09-01 — 운영 대시보드 "새벽 조감도" 재구성 (dev)
- 설정 > Dashboard를 L5 하늘 프레임 문법으로 전면 재구성 — 상단 네브바만 라이트로 남기고 그 아래 전체(지표+Access 사이드바)가 흰 거터 위 `.bpm-l5-sky` 라운드 프레임 하나(거터가 네브바와의 단절을 잇는다). 좌 요약 레일 폐지 — KPI 4종은 하늘 위 유리 타일 밴드(SkyStat), 운영 카운터 3종은 헤더 우측 승격.
- 카드·차트까지 전부 다크(사용자 지시) — 섹션 유리면 `bg-surface/10`+`text-canvas` 계열, 차트/막대/상태 톤은 새 파생 토큰 `--color-accent-sky`와 color-mix 라이트닝으로 재조색, StatCard는 SkyStat으로 흡수·삭제. 폼 입력(SearchSelect·date)만 라이트 필드 유지, 프레임 내 스크롤바 `.bpm-sky-scroll`. 워터마크·스포트라이트는 L5 폐기 결정과 동기화해 넣지 않음.
- 검증: tsc 0·eslint 0·vitest 812 그린, `pw-shot-dashboard-sky.mjs` 3장(전체/스크롤/커버리지+직접기간) 콘솔 에러 0.

## 2026-09-01 — 인스펙터 3종: L5 SP 카드 은닉 통일·표시정보 일괄 토글·팝오버 가장자리 보정 (dev)
- **L5 SP 지정 카드**가 속성 탭에서만 숨겨지고 맵·승인 탭엔 남아 있었다 — 세 탭 모두 `!isFrameworkMap` 게이트로 통일(지정 자체가 서버 422라 노출이 곧 혼동). 일반 맵은 종전대로 세 탭 모두 노출.
- **노드 표시 정보 헤더에 전체 보이기/숨기기** 추가 — 카테고리별 눈 아이콘은 있었지만 전체가 없었다. 헤더는 접힘/펼침 공용이라 접은 채로도 쓸 수 있다(접기 버튼 안에 버튼을 못 넣어 헤더를 행으로 분리).
- **팝오버 가장자리 보정** — 인스펙터가 화면 오른쪽 끝이라 오너·승인자 필 카드(`UserHoverCard`)와 SP 안내 툴팁(`Tooltip`)이 화면 밖으로 나갔다. 높이가 가변이고 툴팁은 CSS 변형으로 중앙정렬돼 **크기 추정 배치가 불가** → `getViewportOverflow`(실측 박스 기반 보정량)를 새로 두고 레이아웃 이펙트에서 붙인 뒤 밀어 넣는다(페인트 전이라 튐 없음, `visibility`로 첫 프레임 가림).
- 검증: 신규 `pw-verify-inspector-round.mjs` 20/20 — 보정은 "화면 안이더라" 대신 **보정 없는 원래 자리를 계산해 실제로 벗어났는지까지** 확인(오너 카드 우측 127px 당김, 강제 가장자리 툴팁 y −173→8). 게이트 tsc 0·lint 0·vitest 812.

## 2026-09-01 — L5 워터마크 가시성 상향 + 커서 스포트라이트 (dev)
- 회사(SΛMSUNG BIOLOGICS)·서비스(Business Process Map) 워터마크가 하늘에 묻혀 읽히지 않는다는 지적 — 화이트 **6% → 24%**(0.06/0.10/0.13/0.16/0.20을 런타임 override로 실화면 대조 후 사용자 지정값 24%로 확정).
- **커서 스포트라이트는 시도 후 폐기**(재제안 금지) — 커서를 따라 하늘을 밝히는 광원을 넣었다가(넓고 옅은 단일 광 → 반경 1/3+잔상 3겹) "조잡하다"는 판단으로 걷어냈다. 꼬리가 시선을 커서로 끌어 배경이 아니라 장식으로 읽히고, 반경을 좁히자 은은한 조명이 손전등이 됐다. **L5 하늘은 정적으로 둔다** — 정체성은 워터마크 24%가 진다. 성능은 문제가 아니었다(합성 레이어 transform만 갱신, 프레임 간격 구성 무관 median 16.7ms). 구현이 필요해지면 git 이력(e237479c·cf68558d)에 남아 있다.
- 측정 함정 기록: 스윕 중 잡히던 long task 2건은 글로우와 무관했다 — 글로우를 지운 구성에서도 **로드 후 t≈5.5s에 고정 발생**(`unknown:window`, 앱 폴링 추정). 측정 순서 때문에 처음엔 글로우에 귀속돼 보였다. A/B는 순서를 바꿔 한 번 더 볼 것.
- 검증 중 확인: 오래 떠 있던 dev 서버는 **Turbopack CSS 영속 캐시 탓에 `.bpm-l5-sky` 규칙이 비어(`background-image: none`) L5 캔버스가 흰 배경으로 렌더**된다 — 소스·프로덕션 빌드는 정상. 톤 판정 전 `frontend/.next` 삭제 후 재기동이 필요하다(기존 랜드마인 재확인).

## 2026-09-01 — 펼친 하위프로세스 안에서 Tab이 캔버스를 벗어나던 버그 (fix/sp-tab-focus)
- 자식 스코프의 **끝 노드에서 Tab, 진입 노드에서 Shift+Tab**을 누르면 다음 노드로 못 가고 브라우저 기본 Tab이 살아나 캔버스 밖 버튼으로 포커스가 튀었다. 원인은 스테퍼가 따라가는 엣지 집합에 **게이트웨이(호스트→자식 진입, 자식 끝→후속)가 빠져 있어** 자식 스코프가 흐름의 섬이 됐던 것 — 게다가 다음 노드가 없으면 `preventDefault` 없이 빠져나가 기본 동작이 그대로 실행됐다.
- `buildStepFlowEdges`(lib/inline-expand.ts)로 "화면에 보이는 흐름"(가려진 A→B 제외 + 게이트웨이 포함)을 만들어 스테퍼에 물렸다. 이제 아웃라인과 같은 순서로 호스트→자식 진입→…→자식 끝→후속을 오간다. **Tab은 노드 선택 중이면 항상 `preventDefault`** — 막다른 노드에서도 포커스가 새지 않는다(비교 화면이 이미 쓰던 규칙과 통일).
- 일반 맵과 L5 업무체계 맵이 같은 에디터·같은 합성 경로라 한 번의 수정으로 둘 다 교정됐다. 검증: 신규 `pw-verify-sp-tab-focus.mjs` 26/26(두 맵 × 진입/복귀/내부 순회/막다른 포커스 유지) — 수정 전 동일 스크립트로 6건 FAIL 재현. 게이트 tsc 0·lint 0·vitest 812·build OK.

## 2026-09-01 — L5 연계 캔버스 "새벽 조감도" 아이덴티티 (feature/l5-dark-shell 머지)
- L5 캔버스에 전용 시각 정체성 부여. 여덟 라운드 시행착오(은은한 회색→차콜→다크 셸→프레임→미드톤→링·그리드·도트 변주) 끝에 브레인스토밍으로 목표 이미지("전략 조감도 × 새벽 그라데이션 × 임원 보고용 플랫")를 확정하고 안착. **최종**: 흰 거터 위 라운드 프레임(라이트 토글에도 유지 — 컨트롤 위치 불변) + 네이비(`#1B2743`)→차콜(`#363843`) **86% 알파** 세로 그라데이션 하늘(`.bpm-l5-sky`) + **SΛMSUNG BIOLOGICS ↔ 아이콘+Business Process Map 2종 사선 타일 워터마크**(-24°·화이트 6%·노드 아래·뷰포트 고정) + 우상단 L5 태그 토글(Moon/Sun, `bpm.l5CanvasBg` 사용자 전역 영속, 칩 20px 인셋 고정) + 도트 없음 + RF 어트리뷰션 숨김(`proOptions`). L5 인스펙터의 SP 지정 카드는 숨김(서버 422 차단과 UI 정합 — 노드 선택 시 L6 등록요청 CTA는 유지).
- 폐기·재제안 금지 결정(design.md §7 명문화): 표면 단색 재도색(어떤 색이든 라이트 크롬과 "깨진 테마" 충돌)·크롬 다크 셸(다크모드화). 함정 기록: Turbopack 런타임 클래스 purge → raw `<style>`·**CSS 영속 캐시는 `.next` 삭제로만 해소**·반투명 그라데이션 밑 background-color 언더레이는 알파 이중 적층·absolute inset-0 자식은 컨테이너 padding 무시·스크린샷 톤 판정은 픽셀 실측으로. 홈 목록의 L5 제외는 `lib/word-map-home.ts splitMapsByMode`가 정답(트리 L5 행으로만 진입, 검색 리스트는 예외적으로 노출).
- 검증 `pw-verify-l5-canvas-bg.mjs` 27/27 + 픽셀/DOM 실측 · tsc 0 · lint 0 · vitest 807 · build OK.

## 2026-08-31 — 중첩 펼침 영역 메뉴는 가장 안쪽 맵 기준 (dev)
- A>B>C로 하위프로세스를 겹쳐 펼친 상태에서 **C 안에서 우클릭해도 B가 대상**이 됐다 — 좌표 히트테스트가 "마지막 매치=바깥"을 돌려줬기 때문. 바깥 영역이 안쪽을 항상 포함하므로 `depth`가 가장 큰 매치를 고르도록 뒤집었다(호버 강조도 같은 함수라 함께 교정).
- 대상이 헷갈리지 않게 **영역 메뉴 첫 줄에 그 링크맵 이름**을 박았다(`ContextMenuItem`에 `title` 변형 추가 — `caption`은 대문자 변환이라 고유명사에 부적합).
- **영역 헤더의 맵 이름 클릭 = 즉시 접기 → 그 영역 기준 메뉴 열기**(사용자 요청). 실수로 전체가 닫히는 사고를 없앤다. 이름을 눌러 연 메뉴는 대상이 자명해 헤더를 생략한다. 헤더 버튼들의 클릭/우클릭은 pane으로 새지 않게 `stopPropagation`.
- 검증: 신규 `pw-verify-nested-region-menu.mjs` 12/12(중첩 2단 펼침·안쪽 우클릭 헤더 이름·접기는 C만·이름 클릭은 미접힘+메뉴·이름 메뉴 접기도 C·열기 이동 대상 /maps/3). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 오우닝 부서 미지정 필에서 바로 지정 (dev)
- 홈 상세 카드의 "Dept unassigned" 필(권한 필 오른쪽)을 **오너/시스템 관리자에 한해 버튼으로** 바꿔 클릭 시 부서 지정 모달을 연다 — 경고만 띄우고 조치 경로가 없던 것을 이었다. 좌측 맵 카드의 태그는 목록 밀도상 그대로 둔다(비클릭 span).
- 피커는 설정 화면 오우닝 지정과 동일 컴포넌트·옵션(`PrincipalPicker` `deptTreeBrowse`), 저장은 기존 `PUT /maps/{id}/owning-department`. 게이트는 `my_role === "owner"` 하나로 충분 — sysadmin은 `effective_role`이 owner로 해석돼 서버 `require_map_role("owner")`와 판정이 일치한다.
- **모달 z를 1300 → 1200으로 내렸다**(사용자 신고: 목록이 안 뜸) — 피커 드롭다운 포털이 z=1250 고정이라 1300짜리 모달 뒤로 깔렸다. 피커를 쓰는 모달은 1200대여야 한다는 기존 계약(생성 모달과 동일)에 맞춘 것.
- **행 클릭은 선택까지만, 확정은 Confirm**(선택 전 비활성) — 잘못 눌린 부서가 즉시 저장되던 것을 막는다. 선택 후엔 새 맵 모달처럼 피커를 선택 행(X로 재선택)으로 교체 — 드롭다운이 Confirm을 덮는 문제도 함께 사라진다.
- 검증: `pw-verify-owning-assign.mjs` 14/14(카드 태그는 span 유지·상세 필은 button·모달·**목록이 모달 위에 뜸(히트테스트)**·**행 클릭만으론 미저장**·Confirm 활성화·서버 저장·필 전환). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 미리보기 팬·링크 행 포커스·피커 드릴인 (dev)
- **미리보기 줌은 스크롤바 대신 드래그(그랩)** — 좁은 피크 안에서 스크롤바는 조준이 어렵고 클릭도 안 먹었다. `overflow:hidden` 상태에서도 동작하는 scrollLeft/Top을 포인터 드래그로 움직인다(캡처 기반, 절대 좌표 환산이라 드리프트 없음).
- **목업 호버 방향 반전**(사용자 지적) — 기본=현재 맵 표시 기준, 호버=전체 파라미터. 호버로 *줄어들면* 커서가 목업 밖으로 나가 unhover→확대→재hover 점프 루프가 생긴다. 항상 아래로 자라는 방향이면 커서가 계속 안쪽이라 루프가 사라진다.
- **이미 맵에 있는 행 클릭 = 그 노드로 포커스** — 추가가 불가능한 행에 미리보기를 띄우는 건 의미가 없었다. 커서·호버도 "금지"에서 "이동"으로 바꿔 클릭 가능함을 알린다(라이브러리·트리 피커 공통).
- **트리 피커는 열릴 때 내 위치(캔버스 결착 L5)까지 자동 드릴인** — 매번 L1부터 파고들 필요가 없다. 체인 각 단계를 병렬 fetch해 한 번에 펼친다.
- 피크 헤더에 **"해당 맵으로 이동"** 버튼 추가(추가 버튼 왼쪽) — 목업 드롭다운에만 있던 동선을 올렸고, 클릭은 기존 이탈 확인 게이트를 그대로 탄다.
- 검증: `pw-verify-ux8-round.mjs` 23/23(항목 12·13·14·16 추가) · `pw-smoke-framework-canvas.mjs` 13/13(자동 드릴인 레이스로 이미 열린 행을 닫던 단계 수정). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — SP 설명 일원화 · 노트 섹션 · 슬롯 게이트 (dev)
- **`sp_description` 폐기, 맵 `description`으로 일원화** — 운영에서 둘을 따로 채우는 사례가 없어 이중 관리만 남아 있었다(사용자 확인). 지정 화면에서 고치면 맵 설명이 함께 바뀐다. 모델 컬럼·`_ADDED_COLUMNS`·`MapOut.sp_description` 제거, `SubprocessRefOut.sp_description`은 소비처(캔버스 설명 합성·Excel)가 많아 이름을 유지한 채 소스만 맵 설명으로 교체(빈 문자열은 None 정규화). **기존 DB 컬럼은 nullable이라 남겨둔 채 무시** — 드랍은 별도 정리 시점에.
- SP 더블클릭 상세 모달에 **링크맵 노트 섹션** 추가 — 기존 `MapNotesSection` 재사용(기본 접힘·영속 없음·노트 없으면 섹션 자체가 안 뜸)이라 신규 상태 없음.
- **슬롯 해제/변경 파급효과 게이트** — 되돌리기 어려운 두 동작만 즉시 실행 대신 영향 패널로 막는다(최초 연결은 게이트 없음). 해제=에러 톤, 변경=changed 톤 + 현재 경로·영향 목록(체계 트리 이동/제거·연계 캔버스 소속/외부 전환)·`subprocess-usage` 기반 참조 맵 수(있을 때만).
- **폐기 컬럼 물리 삭제**(사용자 결정) — `_drop_legacy_sp_description`를 비치명 부트스트랩 스텝에 추가해 배포 1회 기동으로 `process_maps.sp_description`을 드랍한다. ⚠️ 드랍 후 이 커밋 이전 코드로 롤백하면 해당 컬럼에 쓰다 죽는다.
- 검증: 신규 `pw-verify-slot-notes-desc.mjs` 10/10 · `pw-shot-external-l6-mock.mjs` 6/6(외부 L6 목업 흰 바디+5px 좌측 탭, 같은 L5는 파스텔 필 유지 회귀 포함). 게이트 BE pytest 1195·ruff 0·3.11 compileall 0 / FE tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 캔버스/피크 UX 8종 (dev)
- 팝오버 앵커를 **커서 좌상단 기준**으로 전환 — 체계 피크(FrameworkPeekTrigger)와 피크 목업 드롭다운이 트리거 오른쪽/아래 고정이라 화면 끝에서 뷰포트를 벗어나 찾기 어려웠다. 렌더 후 실측 클램프(ResizeObserver, state 대신 DOM style write로 set-state-in-effect 회피).
- SP 미리보기 피크: 폭·높이 1.5배(40vw→60vw, 32vh→48vh) + 줌 1~3배(ScopePreview에 `zoom` — viewBox를 좁히는 대신 SVG를 키워 브라우저 스크롤로 이동, 팬 구현 불필요) + 이탈 400ms 유예 닫힘 + 목업 높이 아코디언(호버로 표시 필드가 바뀔 때 점프하던 것). 외부 L6 목업을 캔버스 C안(흰 바디+좌측 컬러 탭)과 일치시킴 — 파스텔 필이라 실제 렌더와 달라 보였다.
- 트리 피커: 하위 후보가 하나뿐인 단계는 자동 드릴인(갈래가 생기면 정지), 현재 L5 `aria-current` 하이라이트. SP 노드의 체계 아이콘 더블클릭이 노드 편집 모달까지 새던 것 차단. PNG 출력에서 "최신본 따르는 중" 배너 생략(화면 전용 상태 표시 — 노드 높이도 그만큼 감소).
- 검증: 신규 `pw-verify-ux8-round.mjs` 14/14 + 기존 `pw-smoke-framework-canvas.mjs` 12/12(자동 드릴인으로 이미 열린 행을 재클릭해 닫던 단계를 aria-expanded 가드로 수정). 게이트 tsc 0·lint 0·vitest 807·build OK.

## 2026-08-31 — 배포 문서 최신화 + 1회성 셋업 분리 (dev)
- `docs/deploy/setup-once.md` 신설 — 배포 문서 전반에 흩어져 있던 1회성 작업을 **A. 스택 구축 1회**(Docker 전제·Keycloak 클라이언트/URI·AD 서비스 계정·n8n 웹훅 2종·`.env`+시크릿 발급·백업 디렉터리·서브넷 분리·빈 DB 시드)와 **B. 릴리스 이후 1회**(ai_chat_logs 드랍·KB 백필·필드 승격 재임포트·HR 첫 sync+고아 경로 이관·노출 직책 확정)로 갈라 모았다. 성격이 달라서(B4만 재실행 위험) 항목마다 재실행 안전성을 명시.
- `db-migration-9910.md` 전면 재작성 — **`dc910` alias 전제 제거**(셸 새로 열면 조용히 깨지는 전제였다), 모든 명령을 `docker compose -p bpm-9910 --env-file .env.9910 …` 완전형으로. 회차마다 갱신할 스키마 델타 표를 현재 dev 기준(L5 연계 캔버스 6컬럼+`category_permissions`)으로 교체하고 델타 산출법(`git diff … db.py models.py`)을 명시. §5 로그인 확인 절과 §9 backend 기동 실패 트러블슈팅을 신설 — 이번 사고(3.11 SyntaxError)와 fail-closed 오진 경로를 여기서 끊는다.
- `deploy.md` §1은 setup-once 포인터로 축약(코드·매뉴얼이 §1·§2.1을 참조해 번호는 고정), §5에 "로그인 무반응이면 인증보다 backend 생존 먼저" 진단 순서 + 4행 추가. CLAUDE.md Operations 제약표에 런타임 버전 갭 행 추가. backup/db-seed/kb-embedding/docs README·`docker-compose.dev.yml` 주석 상호참조 정리.
- **운영 포트 표기 정정 3333 → 9900 전수**(사용자 확인) — 문서 5종·`.env.example`·`docker-compose.yml` 기본값·nginx 주석·pw 스크립트 주석. 3333은 6월 마이그레이션 이후 어디에도 실재하지 않는 값이었는데 README/CLAUDE.md/spec이 계속 "서버 노출 포트"로 안내하고 있었다. README의 backend 스택 표기도 Python 3.12 → **3.11(배포 이미지 기준)**로 정정 — 이번 기동 불능의 근원이 이 오표기와 같은 계열이다.

## 2026-08-31 — 서버 기동 불능 핫픽스: PEP 695 제네릭 → TypeVar (dev)
- 9910 로그인 무반응의 진범은 인증이 아니라 backend 기동 실패였다 — `graph.py`의 `def _apply_placeholder_paths[NodeT: NodeIn]`(PEP 695, 3.12+)이 배포 런타임 `python:3.11-slim`에서 import SyntaxError → 크래시 루프 → `/api/auth/mode` 무응답 → FE가 fail-closed로 빈 issuer/client_id의 Keycloak 카드를 그려 버튼이 죽은 것처럼 보였다(bb05acbc, 8/29 도입).
- 로컬 venv가 3.12라 pytest 1193·ruff 전부 green이었다 — **런타임 버전 갭이 게이트를 통째로 우회**. `backend/ruff.toml` 신설(`target-version = "py311"`)로 같은 문법을 기존 린트 게이트가 잡도록 고정(Dockerfile 베이스 상향 시 동반 상향).
- 검증: 3.11 venv에 requirements.txt 실설치 후 `import app.main` 성공(188 routes) — 컨테이너 기동과 동등. 수정 전 원본은 동일 조건에서 SyntaxError 재현.

## 2026-08-31 — 매뉴얼 최신화 + 슬라이드 매뉴얼(HTML/PDF) (main)
- md 매뉴얼 6종을 8/25 이후 델타(81커밋)로 최신화 — L5 연계 캔버스 신규 챕터(편집 §11), 복사/원본 대체(retire) 재편, 비교 필드 diff 상태색·버전 선택, 알림 리치 렌더, SP 피크/인라인 펼침/폭 조절/업무체계 필, IO 링크 표식·필수/선택, 인스펙터 소유·승인자/요약 아코디언, 반려 시 체크아웃 복귀, 피커 근접도 정렬, 관리자(Batch jobs·DB 백업 사이드카·휴지통 즉시삭제·연계 권한자·지식기반·AI 프롬프트·BACKUP_* env).
- `docs/manual/slides/` 신설 — 사용자/관리자 × 한/영 4종 PPT형 스탠드얼론 HTML(←/→·클릭 이동, 전환 애니, 목차 점프, 인쇄=1슬라이드 1페이지) + PDF 4종. 실화면 스크린샷 127컷을 로컬 시드(org+compare+inbox+프레임워크 임포트 5종+연계 캔버스 v1.0/외부 L6/플레이스홀더 주입)로 Playwright 캡처(ko/en 각각) 후 내장. md가 원본 — 갱신 시 함께 재생성.

## 2026-08-30 — SP 펼침 UX 7종 (dev)
- 펼친 자식 Tab 순회(자식 엣지 합류+선택 이원 라우팅), 펼침 중 방향키 점프 픽스(비제스처 이동 rootOffsets 역변환 — ySteps 게이트 구간의 무변환 유출이 진범), 포커스 비행 앵커 줌(연속 아웃라인/Tab 이동에도 d3 비행의 일시 줌아웃이 목표 줌으로 눌러앉지 않음), 임베드 자식 GMP 필 읽기전용(span).
- 틴트 영역: 호버 강조(래퍼 pointermove 히트테스트 — 상시 selection 모드라 RF onPaneMouseMove 미바인딩) + 우클릭 메뉴(링크맵 열기=확인 게이트·접기, 겹침은 최상단만). 영역 헤더 개편: 서피스 필+큰 이름+열기 아이콘, 링크맵 업무체계 5단계 전체 경로 라벨(클릭=체계 피크).
- 체계 피크 유예 닫힘 400ms(플라이아웃 6px 갭 이동에도 유지, 재진입 취소 — FrameworkPeekTrigger 전 경로 일괄) + 탐색 버튼을 "다른 체계 검색" 라벨 풋터 행으로 승격. page.tsx의 리터럴 NUL 바이트 2개(\u0000 이스케이프화 — git 바이너리 취급 해소). pw-verify-sp-ux7 31체크 ALL PASS·tsc/lint/vitest 807 그린.

## 2026-08-30 — 드래그 Y 연속화 + SP 미리보기 피크 (dev)
- height-shift(노드정보 노출) 중 드래그가 밴드 갭에서 스톨→점프하던 것을 제스처 오프셋 동결(선형 항등 왕복)로 연속화 — 드롭 확정만 계단 역변환이라 저장 좌표 의미 불변(실측 스텝점프 23.8px·드리프트 5.6px·저장=표시 일치).
- 라이브러리/L5 트리 피커 행 클릭·2.5s 호버 → SP 미리보기 피크(창 비례 40vw/32vh): 게시본 그래프(ScopePreview에 캔버스 타입색 적용 — 조상 창·요약 모달도 통일) + 우측 탭(노드/상세). 노드 탭=실노드 미러 목업(전체 파라미터: 속성·파라미터 칩·GMP 배지·조건·IO 체크리스트 박스, L5 캔버스의 타 L5 출신은 홈 L5 색+출처 배지 선반영), 호버=현재 맵 표시 기준 스왑, 클릭=추가/해당 맵 이동(openMapPrompt 확인 게이트). 상세 탭=속성3+SP 파라미터5+조건·IO·GMP+메타(게시 버전 v마커·게시 시각·업무체계 전체 레벨), 빈 값은 톤다운 대시. viewer 미만은 잠금 안내+추가 가능(메타 조회 생략), 미등록은 기존 등록 확인 체인.
- BE: 라이브러리 목록에 SP 파라미터 4종(touch_time·cost_krw·cost_usd·headcount) 동봉(미지정 마스킹 동일·테스트 확장). 검증 스크립트 pw-verify-drag-continuity·pw-verify-sp-peek(5시나리오) 커밋 — pytest 1193·vitest 807·tsc/lint 그린.

## 2026-08-30 — 탐색 모달 이동 확인 게이트 (dev)
- 탐색 모달의 이동 3지점(맵 행·L5 연계 아이콘·검색 맵 결과)을 F6 "링크맵 열기"(openMapPrompt)와 동일 문구·아이콘의 ConfirmDialog 게이트로 전환 — 확인 시에만 에디터 이탈, Esc/Cancel은 최상위(확인)만 닫고 탐색 모달·피크 유지. E2E 6/6.

## 2026-08-30 — 탐색 모달 = 추가 창(피크 유지) + 검색 (dev)
- 사용자 정정 반영: 탐색 모달은 피크를 대체하지 않고 위에 추가로 뜬다 — 바깥닫기/마우스리브 억제 + **포털 자식 클릭이 React 트리로 트리거 onClick까지 버블돼 토글이 피크를 닫던 버그**를 DOM 포함 가드로 픽스(포털 버블 랜드마인 재발 사례).
- 탐색 모달 검색: BE `GET /api/categories/search`(ilike 카테고리+맵, 가시성 마스킹, 경로 동봉 — /nodes보다 앞 등록) + FE 디바운스 300ms, 카테고리 결과 클릭=해당 경로 펼침 합류(expandTo)·맵 결과 클릭=이동. E2E 5/5.

## 2026-08-30 — 피크→체계 탐색 모달 (dev)
- 드릴인 피크 헤더에 탐색 버튼(FolderTree) → FrameworkBrowseModal: framework-tree-state 엔진 재사용, 체인 openIds 시드로 현재 경로 펼침·형제 브랜치 아코디언·맵/연계 클릭 이동(현재 링크맵 하이라이트). E2E 5/5.

## 2026-08-30 — 외부 L6 출처 배지 클릭 드릴인 (dev)
- FrameworkPeekTrigger로 피크 범용화(필=아이콘+3초 호버/클릭, 배지=클릭 전용) — 캔버스 외부 L6의 출처 배지 클릭 시 출신 L5 드릴인 피크(FrameworkChip 재활용). spOriginCategoryId 주입(spAttrs). E2E 2/2.

## 2026-08-30 — 비-L5 이양 차단 배너 재디자인 (dev)
- 앰버 텍스트 한 줄 → TriangleAlert+틴트 박스(볼드 제목/설명 2단, Title/Desc 키 분리)로 시인성 강화.

## 2026-08-30 — 그립-핸들 이격·배정/이양 모달 L5 반영 (dev)
- 그립 이격(사용자 정정 반영): 수평 이동 대신 경계 위(right-0) 유지 + 시작 높이 top-7(28px)로 낮춰 출력 핸들(anchorTop 18, 12.5~23.5px) 아래부터 — 세로 비중첩 실증(E2E 5/5). 배정 모달: L5만 선택·시딩(레거시 비-L5 지정은 미시딩)·비-L5 말단 muted, 이양 섹션은 currentLevel!==5면 재배정 유도 문구로 대체(서버 409 미러). PickLeafHint 문구 L5로 갱신.

## 2026-08-30 — 후속 6종: 필 개선·폭 영속·rejected 점유·L5 전용 슬롯·그립 UX (dev)
- ①필: 배경 제거·첫줄 정렬(self-start)·호버 배경만·클릭 즉시 피크(3초 호버 유지). ②nodes.width 컬럼(_ADDED_COLUMNS·ge100 le400)로 폭 영속 — 드래그 중 로컬, 확정 시 onResizeNode→autosave, 리로드 유지 E2E. ③반려 시 점유를 제출자에게 복귀(빈 점유를 먼저 연 editor+/관리자가 자동 점유로 편집권 가져가는 구멍 픽스, 테스트 동반 — withdraw 경로는 동일 갭 후속 검토). ④맵 슬롯 L5 전용 확정: 배정 422·이양 시 레거시 비-L5 슬롯 409·칩/피커/홈트리 상위 레벨 맵 목록 미노출(아코디언만). ⑤⑥그립: 노드 호버 시 표시·전체 높이·호버 액센트. E2E 9/9.

## 2026-08-30 — SP 업무체계 필+피크·SP 노드 폭 조절 (dev)
- 일반 맵 SP 노드: 링크맵이 프레임워크 소속이면 이름 옆 FolderTree 필, 3초 호버 시 FrameworkChip 재사용 팝오버(defaultOpen 드릴인·floating=false 스킨 분리, 포털 고정 좌표). E2E 7/7.
- SP 노드 자체 폭 조절(요약 모달 리사이즈는 사용자 정정으로 원복): 우측 하단 그립 드래그 180=최소→120%(216) 클램프, zoom 보정(드래그 시작 시 스토어 read — 전 노드 zoom 구독 금지), 표시 전용(저장 없음)·편집 표면 한정(isConnectable 게이트). E2E 6/6.

## 2026-08-30 — L5 캔버스 개선 5종 배치 (dev)
- ①이양 후계자: process_maps.retired_to_map_id(copy retire 기록)·refs 체인추적 successor 동봉·스테일 배너=Replace CTA→다이얼로그 추천 카드(직결). ②undesignated 바디를 플레이스홀더 점선 에러 룩으로 통일(코너 삼각 배지 제거·잠금 억제). ③변경 요약을 접힘 1줄(카운트 필)→펼침로, change-summary-section으로 추출해 일반 맵 승인 탭(승인자 아래)에도 게시본 기준 요약 추가 — 라이브 계보를 rootGraph에서 주입해 게시본 열람 시 전량 삭제+추가 오탐 픽스. ④트리 피커 드래그에 카테고리 동봉→낙관 참조로 드롭·연결 즉시 외부 L6 스타일. ⑤COLOR_PRESETS lib 승격 + 비교 화면에 외부 C안·플레이스홀더 스타일 재현(full-graph 출처 경로 주입 포함). E2E 12/12.

## 2026-08-29 — 플레이스홀더 수동 연결 UX (dev)
- 배너 CTA→연결 다이얼로그: 출처 L5 후보 우선(유사도 랭킹 lib/framework-connect·정확 일치 배지)·트리 드릴로 타 L5 탐색·이미 캔버스 맵 비활성. 안내 밖 L5 선택 시 경로 비교 확인 모달 게이트(사용자 요구). 연결 시 출처 소거+follow_latest, E2E 8/8. (2026-09-06 트랙 F에서 유사도 랭킹 목록을 체계 트리+미리보기 플라이아웃으로 교체 — 확인 게이트·연결 규칙은 유지)

## 2026-08-29 — 플레이스홀더 그릇 준비 (dev)
- nodes.placeholder_category_id(_ADDED_COLUMNS 등록·미지 카테고리 422)·연계 캔버스 검증 완화(linked 필수 해제)·응답 경로 주입·clone/시그니처 포함·에디터 왕복+에러톤 출처 배지 — 임포트 착지 지점 완성 (§10.1). CSV/AI 병합은 ...existing 스프레드가 보존이라 무변경.

## 2026-08-29 — 외부 L6 C안·플레이스홀더 에러레드 (dev)
- 연계 캔버스 외부 L6 = 뉴트럴 바디+좌측 5px 홈 L5 컬러 탭+틴트 배지·아이콘(시안 4종 중 사용자 선정 C안 — 기존 18% 파스텔은 홈과 구분 약함).
- 플레이스홀더(linked_map_id 빈 SP) = 점선 에러레드 바디+동톤 배너. 개념 확정(§10.1): 임포트가 타 L5 소속 L6를 자리로 파두고 후차 연결 — 출처 L5 컬럼·검증 완화는 임포트 트랙으로 분리.
- compare가 linkedMapId 미전달로 모든 SP에 "링크 미지정" 배너 오표시하던 기존 버그 동봉 픽스. 명시 null만 강스타일 적용(미전달 표면 가드).

## 2026-08-29 — 메이저 체크박스 커스텀 통일 (dev)
- 네이티브 체크박스를 앱 언어로 교체 — appearance-none rounded-sm(hairline→checked:accent) + peer-checked Lucide Check(text-on-accent).

## 2026-08-29 — 타임라인 더보기 최상위 기준 (dev)
- 3개 클램프를 최상위 아이템(그룹=1) 기준으로 산정하고, 펼친 그룹의 하위 멤버는 슬라이스 무관 전부 노출(2단계: topItems slice → open 그룹 평면 전개).

## 2026-08-29 — 토글 체크 리빌 + 그룹 라벨/들여쓰기 (dev)
- 유지/삭제 요약은 평소 숨기고 체크 시 grid-rows 아코디언으로 리빌(체크 행위가 읽기 유도). 그룹 헤더 라벨 vX.x → "버전 N"(i18n home.verMajorGroup), 펼친 멤버 카드는 ml-7 들여쓰기로 하위 표시.

## 2026-08-29 — 메이저 토글 구체 필 + 버전 메이저 그룹핑 (dev)
- 토글 아래 산문 설명이 안 읽힌다는 피드백 → 실제 유지/영구삭제 라벨 필 행(MajorImpactRows, 토글 compact·모달 배너 공용)으로 교체, 최초 확정만 짧은 문구(majorDescFirst). 버전 타임라인에 groupByMajor(framework 맵 한정) — vX.Y 연속 구간을 마이너 2개↑일 때 그룹 헤더(Layers·개수·최신 필·최신시각)로 접고 클릭 시 멤버 카드 평면 삽입(최신 메이저가 앞), 카드 강조는 idx→newestId 기준으로 교정.

## 2026-08-29 — 인스펙터 확정 섹션 안내 시인성 (dev)
- 확정 섹션 4곳을 모달과 같은 필 언어로 통일 — 최신 확정 캡션(Workflow 아이콘+초록/muted 필)·메이저 토글 목표 버전 필·무변경 안내(Info+버전 필)·변경 요약 헤더(GitCompare+기준 필)와 엣지 증감(Spline+색상별 +N/-N/~N 필). i18n 5키 재편(latestLabel/notConfirmedShort/noChangesAfter/changesTitle/edgesLabel).

## 2026-08-29 — 메이저 승급 모달 시인성 (dev)
- 안내문구를 ConfirmDialog 리치 폼으로 재구성 — 유지(Archive+초록 필)/영구 삭제(Trash2+빨강 취소선 필, 없으면 None 필) 행 + 비가역 경고 라인(TriangleAlert). 최초 확정(스냅샷 없음)은 배너 생략. i18n majorModalPrune/NoPrune → Keep/Delete/None/Irreversible 4키로 분해.

## 2026-08-28 — L5 캔버스 개선 7종 (feature/l5-canvas-refinements)
- 사용자 피드백 반영: 소속 L6 삭제 금지(onBeforeDelete 필터+서버 422)·외부 L6=홈 L5별 색(SubprocessRefOut.category_id, subprocess 단일색 규칙에 외부 예외)·분기/끝 노드 허용(끝 규칙 포함)·좌상단 체크리스트→L5 탐색기(전 레벨 트리·내 위치·타 L5 열기/생성)·우상단 칩→"L5 map" 태그·메이저 승급 토글 행+영구삭제 안내 모달(직전 라인 X.0·최종만 유지 프룬, FrameworkConfirmOut.pruned_labels)·확정 게이트(레이아웃 외 변경 없으면 409/버튼 비활성, FIELD_MSG lib 승격+computeVersionDiff·엣지 시그니처로 변경 요약 노출). 게이트: pytest 1189·vitest 803·tsc/lint/ruff 그린·스모크 12/12·기능 검증 11/11.

## 2026-08-28 — Framework L5 연계 캔버스 구현 (feature/framework-l5-canvas)
- 스펙 전체 구현 완료: BE(모델 4컬럼+category_permissions·역할 파생 mode 분기·멱등 linkage-map 시드/자동 보강·framework-confirm maj.min·subprocess-only 검증·가드 4종·표면 3종) + FE(트리 L5 버튼·에디터 모드 플러밍·Confirm 섹션·트리 피커·출신 배지·권한자 모달·홈 제외). 게이트: pytest 1186·vitest 795·tsc/lint/ruff 그린·실브라우저 스모크 10/10(`pw-smoke-framework-canvas.mjs`).

## 2026-08-28 — 비교화면 버전 선택 명확화 + 필드 diff 상태색 (feature/compare-ux)
- 상단 BASE/TARGET가 어느 쪽 기준인지 안 읽히는 피드백 → 역할 캡션을 언어설정 따르는 "기준 (변경 전)/대상 (변경 후)"로 교체하고, native select을 커스텀 드롭다운으로 바꿔 행에 상태 필+변경일(`VersionOut.updated_at` 신규 노출, 모델엔 기존 존재) 표시. 반대편 선택 버전 행은 역할 태그+클릭 스왑(동일 쌍 차단). 변경 사항 패널 제목 아래 "base → target" 방향 캡션 상시 노출. 게이트: pytest 1179·vitest 802·tsc/lint/ruff 그린 + 실브라우저 캡처.
- 필드 diff를 파라미터 단위 상태색으로 세분화(생성=초록·삭제=빨강+취소선·변경=노랑 배경+바뀐 부분만 취소선/굵게 — `lib/compare-field-diff` 공통 접두·접미 절단) — 변경 목록 행·캔버스 DiffFieldPills 공용(`components/compare-field-diff.tsx`). 잘린 긴 값(설명 등)은 호버 시 전체 내용 팝오버(clampToViewport, overflow 실측 판정). vitest 8건 추가(802).

## 2026-08-28 — Framework L5 연계 캔버스 설계 스펙 (main)
- L5 "상세보기" 캔버스(소속 L6=subprocess 노드 전원 배치·타 L5의 L6 가져오기·Start/End 없음) 브레인스토밍 확정: 실맵 `mode="framework"`+`ProcessCategory.linkage_map_id` 1:1(L6 목록 오염 차단), 카테고리 레벨별 권한자 신설(하향 상속·캔버스 한정), 라이브 편집+본인 확정 스냅샷(minor/major), 열 때 자동 보강. 스펙: `docs/superpowers/specs/2026-08-28-framework-l5-linkage-canvas-design.md` · 구현 플랜: `2026-08-28-framework-l5-linkage-canvas.md`(폐기 — git history) (16태스크).

## 2026-08-27 — 인스펙터 UX 3종: 요약 아코디언·소유/승인자 섹션·SP 카드 Linked from (main)
- 속성 빈상태 개편: ① 맵 요약을 아코디언화(기본 접힘 — 접힘 헤더 우측 아이콘+숫자 3쌍이 요약을 대신, 영속 없음) ② 그 위에 소유·승인자 섹션 신설(`map-ownership-section.tsx`, 맵 탭 협업자 섹션과 같은 details 박스 — 오우닝 부서 리프·오너/승인자 UserPill, 표시 전용). ③ SP 지정 카드에 Linked from(역참조) 하위 아코디언 — page.tsx `spUsage`를 prop으로 공유(카드별 재조회 없음)해 3개 탭 마운트 일괄 적용, designated일 때만·기본 접힘·영속 없음(카드 접으면 리셋). 소유·승인자는 언어설정 우선노출+폴백 — 이름은 approval-panel resolve 규칙(ko=korean_name∥영문), 부서는 formatDeptName+buildKoreanDeptByPath(모듈 캐시로 세션당 1회 fetch — 빈상태가 선택 변경마다 리마운트되는 것 대응). tsc/lint/vitest 794 + 실브라우저 스크린샷 7장(ko/en 언어 전환 포함, 콘솔 에러 0) 검증.

## 2026-08-27 — 캔버스 노드 IO 링크 행 호버 하이라이트 (main)
- 인스펙터 IO 링크 항 호버의 상대 노드·경로 엣지 하이라이트를 노드 내 IO 행에서도 동일 점등 — 계산을 `computeIoLinkHighlight`(io-items.ts 단일 소스)로 추출해 두 표면 공용, 캔버스 쪽은 NodeActions 컨텍스트 `onHoverIoLink`(ref 미러 stable 콜백)로 배선. 링크 행(`linkState!=="plain"`)에만 이벤트를 달아 plain 행 hover는 상태 무변동. 단위테스트 3건+실브라우저 스크린샷(미러→원본·원본→미러·소등) 검증.

## 2026-08-27 — 배치 작업 상태 표시: 설정 > Batch jobs 탭 (dev)
- 백업·인원(HR)동기화의 최근 시도 시각·성공/실패를 설정 Database 카테고리 새 탭(sysadmin)에서 표시. 새 테이블 `batch_job_runs`는 (job, outcome) 복합 PK upsert라 "최신 성공·실패만 보전"이 스키마로 강제 — 정리 배치 불필요. HR은 `run_full_sync`(가드 중단·예외=failure, 스로틀은 미기록), 백업은 사이드카가 psql로 기록(CREATE IF NOT EXISTS 가드 — 모델과 스키마 계약, 변경 시 양쪽 동기화). pytest 5건+docker e2e+실브라우저 스크린샷 검증.

## 2026-08-27 — DB 자동 백업(db-backup 사이드카) + 복구 런북 (main)
- 운영 안정성 요구로 일간 배치 백업 도입. compose 사이드카(postgres:16-alpine 재사용, 04:00 KST + 기동 베이스라인, `pg_restore --list` 검증 통과 시에만 확정, 14일 보존)로 결정 — 호스트 crontab은 git 밖 설정이라, 앱 내 스케줄러는 앱 장애와 결합이라 배제. 로컬 Docker로 덤프→검증→보존정리→복원→실패경로 e2e 실측.
- 1단계는 서버 디스크만(사용자 결정) — 디스크 장애 무방비 한계·오프서버 확장 경로·`.env` 수동 사본 필요를 `docs/deploy/backup.md`에 기록.

## 2026-08-27 — IO 단일 항목은 헤더 없이 행 하나로 (main)
- 항목이 1개뿐인 IO 박스는 헤더(펼침 토글·카운트)가 과함 — 헤더를 생략하고 행이 박스를 직접 채운다. side 구분은 체크박스 자리가 담당: 휴식 시 인풋/아웃풋 아이콘 상시(헤더 대체), 호버·체크 시 체크박스(일반 행과 동일 — 첫 구현의 호버=아이콘은 반대라 정정). 접힘 상태는 단일 모드에서 무시(헤더가 없어 다시 펼 수 없음). 2개 이상은 기존 목록 그대로. 상태별 실브라우저 스크린샷 검증.

## 2026-08-27 — 가시성 동봉 드롭다운 세로 줄바꿈 픽스 (main)
- ko에서 승인 요청 모달의 공개 범위 드롭다운을 열면 '비공개'가 Current 필에 밀려 한 글자씩 세로로 꺾이던 것 — 옵션 행 nowrap+필 shrink-0, 메뉴 w-max(트리거보다 옵션이 넓을 때 콘텐츠 폭). 셀프게시 팝오버·설정 게시 패널 공용 컴포넌트라 세 표면 동시 해결. before/after 실측.

## 2026-08-27 — IO 항 분리: 대시 폐기 → 행간 (main)
- 체크박스 자리 상시 대시는 지저분하다는 피드백으로 즉시 폐기(같은 날 롤백). 대신 행간 `space-y-[3px]`로 항 분리 — 2줄 클램프 항목이 덩어리로 구분. 3.5줄 캡은 새 스트라이드(18+3px) 기준 max-h 63→72px 재조정. 호버 체크박스·체크 유지 동작은 원래대로.

## 2026-08-27 — 캔버스 IO 링크 표식·필수/선택 호버 색 (main)
- NodeIoDetails 행에 링크 상태 표식 — 원본(output_ids)·미러(input_links/output_links) 공통 Link2 액센트 아이콘+방향 툴팁, 독립(plain) 항은 없음. SP 노드는 로컬 링크 필드가 없어 제외(체크 키 규칙과 동일). 인풋 행 호버 색으로 필수/선택 구분 — 필수=`bg-error/10` 로즈·선택=중립 surface-alt(+기존 뮤트 텍스트), 행 title 툴팁(Required/Optional input) 동반.

## 2026-08-26 — 피커 조직 근접도 정렬 (main)
- 협업자 피커(새 맵 모달·설정 협업자 추가)와 담당자 지정 피커(인스펙터·편집 모달)의 기본(무검색) 순서를 이름순 → 내 조직 근접도 순으로: `lib/org-proximity`(다리 수 0~3=3다리 내 우선, 4=밖, 5=org 빈 사람 최후순위, 버킷 내 이름순). 검색은 로직 그대로 — PrincipalPicker·SearchSelect 모두 filterByQuery 랭킹이라 입력 순서와 무관. eligible-assignees 응답엔 org_path가 없어 디렉터리 스토어(fetch-on-use 캐시)로 보강. 승인자 피커는 기존 순서 유지.
- 검증: 유닛 5케이스 + 실브라우저(협업자 피커 상단 8명 전원 내 파트, 검색 랭킹 유지). 담당자 플라이아웃(addMode) 자동화는 헤드리스에서 안 열려 스샷 미확보 — 동일 정렬 함수·배선이라 로직 동일, 수동 1회 확인 권장.

## 2026-08-26 — 알림 상세 행위자 유저 필 (main)
- 상세 문장의 {actor} 자리를 파츠 분할(`formatNotificationBodyParts`, 센티널 ⟬actor⟭)해 필로 렌더. 카드가 UserHoverCard(간이)가 아니라 **PersonHoverCard**(인물 카드 — 직급 필·메신저·말단 부서+조직 경로 아코디언, ko는 한글명 우선) 재사용으로 확정. 필은 surface+헤어라인·caption 크기 — 상세 패널(surface-alt) 위에서 bg-surface-alt 필이 묻히는 시인성 픽스. 버전·이름·인용의 따옴표 표기도 일괄 칩 처리 — 센티널을 RichVar 6종(actor/version/from/to/copy/snippet)으로 확장, 템플릿이 감싸던 따옴표는 파츠 빌드 시 제거(버전 칩은 v번호 뱃지 동반), 플레인 텍스트 표면(벨/카드/검색)은 따옴표 유지. 후속: 칩=카드 어포던스로 통일 — 버전 칩은 인터랙티브(0.7s 호버/클릭 → 버전 카드: 상태·생성 KST·`?version=` 딥링크 이동, getMap lazy 1회·missing 폴백), 카드가 애매한 이름류(from/to/copy)는 볼드 텍스트, 인용은 이탤릭 “…” — 칩 모양은 카드 열리는 것에만. 행위자 필 이름은 언어선택 병기(ko 한글(영어)/en 영어(한글), 한글명 없으면 영문 단독), 버전 칩·카드는 라벨 앞 톤다운 v번호. 행위자 없는 유형·레거시는 1파츠 유지. ⚠️ Edit 도구 \uXXXX가 리터럴 NUL로 박히는 함정 재발 — 파이썬 바이트 치환으로 교정.

## 2026-08-26 — 알림 리치 렌더·전수 컨텍스트 보강 (main)
- 26개 생성 지점 전수: `notifications.payload`(JSON, `_ADDED_COLUMNS` 자동 ALTER)에 맵 이름·버전 라벨/번호·행위자·사유 등 구조화 동봉, 영어 `message`도 맵 이름 포함으로 보강(레거시 표시·폴백 겸용). `workflow.get_map_name` 헬퍼.
- FE `lib/notification-format.ts` — type+payload를 언어 토글에 맞는 {유형 칩·제목(맵 이름)·상세 문장}으로 렌더(en/ko 템플릿 26유형+기계 사유 코드 번역, 자유 텍스트 사유·공지 제목은 원문). payload 없는 레거시/미지 유형은 message 원문 폴백. 벨 드롭다운 2줄 리디자인(w-96·아이콘·시각)·받은함 카드/상세(유형 칩+절대 KST) 적용, 검색은 렌더 텍스트 포함.
- 검증: BE pytest 1173(payload 계약 테스트 추가)·FE vitest 782(포매터 7케이스) / 실브라우저 — 실워크플로(submit→approve→publish·reject)로 알림 생성 후 ko/en 벨·받은함·레거시 폴백·반려 사유 스샷 확인, 콘솔 에러 0.

## 2026-08-26 — retire 시 원본 협업자·승인자 이어받기 (main)
- 휴지통 체크 시 원본 `listMapPermissions`+`listApprovers`를 협업자 → 승인자 순으로 스테이징(제출 체인 grant→PUT 순서와 일치). 본인 행·오우닝 파생 부서 제외, 타인 owner 행은 editor 강등, 접근 없는 승인자는 viewer 보강(private 복사본 결재 보장). 해제 시 자동분만 제거(수동 추가 보존, autoLeaderRef 패턴). 요약박스 4번째 라인 안내. 스모크 25체크 + 새 맵 DB 권한/승인자 실측 대조. 참고: sqlite 로컬 한정 영구삭제 후 map_permissions 고아 잔존(FK CASCADE 미강제 — postgres는 DDL cascade로 정상).

## 2026-08-25 — 복사 모달 retire 섹션 시인성 리디자인 (main)
- 휴지통 체크를 선택 카드로(체크 시 앰버 `border-changed/40 bg-changed/10`+Trash2 아이콘) + 체크 시 ConfirmDialog lines 어법의 아이콘 요약박스 3줄(태그 rename·7일 보관·알림). SP 경고는 앰버 박스가 아코디언·확인 체크까지 감싸고 확인 문구는 caption-strong으로 상향.

## 2026-08-25 — 복사 워크플로 재편 (main)
- 게이트: 게시(published/expired) 이력 1회 이상인 맵만 복사(FE 버튼 비활성+툴팁, BE 409 — status 판정: pre-ALTER 게시본은 version_number NULL 가능). Word 승격(convert)은 기존 승인본 기준 예외. 기본 원본 버전도 approved→published로 상향.
- 복사 모달을 CreateMapDialog `copy` 모드로 통합(전용 CopyMapDialog 폐기) — 버전 선택+비게시 안내·오너 잠금 행·오우닝 프리필·공개범위(BE `MapCopy.visibility`)·협업자/승인자는 기존 스테이징 체인 재사용.
- 알림: 복사 시 원본 오너 `map_copied`(행위자 제외). 오너 전용 `retire_source` — 원본 "(Pending deletion)" rename(중복 카운터·200자 절단)+휴지통행, 승인자·editor+ `map_retired`, 새 맵은 원본 이름 유지(모달에서 이름 고정). SP 지정 맵은 사용처 아코디언+확인 체크 필수(FE 게이트).
- 검증: BE pytest 1164(신규 test_map_copy_workflow 9)·ruff / FE tsc·lint·vitest 767 / pw-smoke-copy-purge 23체크 실브라우저(retire 실집행→알림 sqlite 실측→휴지통 즉시삭제까지).

## 2026-08-25 — 휴지통 즉시 영구삭제 (sysadmin, main)
- `DELETE /maps/{id}/permanent` — sysadmin 전용(403)·휴지통 상태만(활성 맵 409), KB 청크 소거 포함 기존 lazy purge 로직 재사용. 설정 휴지통 행에 sysadmin 한정 Delete now 버튼+danger 확인 모달. 7일 보존은 기본 유지 — 즉시삭제는 명시적 관리자 액션만.

## 2026-08-25 — 맵 복사 버전 선택 + 드래프트 열기 (main)
- 복사 모달을 이름 전용 PromptDialog에서 전용 CopyMapDialog로 — 원본 버전 드롭다운(전체 버전, 기본=최신 승인본, 승인 여부 무관 `MapCopy.version_id`), 성공 시 카드 쉬머 대신 새 맵 에디터로 직행(게시본 없는 새 맵은 versions[0]=드래프트가 기본 오픈). 카드 복사 버튼 게이트도 승인본 보유 → 버전 보유로 완화. 검증: pytest 버전 선택/기본/타맵 404 + pw-smoke-copy-purge 실브라우저(드래프트 선택 복사 → DB 계보 m*v6 실측).

## 2026-08-25 — 맵 복사 500 픽스 (main)
- 운영 서버 복사 500 원인: 자동 ALTER로 추가된 `doc_sections`(DDL DEFAULT 없음)가 pre-ALTER 행에서 NULL → `copy_map`의 `list(None)` TypeError. `or []` 소거 + 서버 상태(컬럼 드롭→nullable 재추가)를 재현한 회귀 테스트. 같은 함정의 직렬화 계층은 `schemas._coerce_doc_sections`가 이미 방어 — 라우터만 누락이었다.

## 2026-08-25 — 릴리스 문서 최신화 (main)
- 매뉴얼 6종을 현재 main 기준으로 갱신 — 편집: GMP 분류·IO 불러오기(Linked/Disconnect)·간격 자동 조정+엣지 우회·몸체 드롭 빠른 연결·start/end 타입 필·Framework 칩·PNG 정보 카드·Map 탭 비교 버튼 / 사용 안내: LDAP 로그인 화면·비교 화면 개편(요약 탭·엣지 라벨 diff·선모양·임시 드래그) / 관리자: 로컬 계정 절 신설(설정→조직, ldap 전용)+`AUTH_JWT_SECRET`/`AUTH_JWT_TTL_HOURS` 레퍼런스.
- 릴리스 공지 8월 3차 초안 `docs/notices/2026-08-25-release.md` — 872a953b(운영 배포) 이후 변경분 대상.

## 2026-08-25 — dev → main 릴리스 머지
- 8/19(shimmer) 이후 dev 전체(144 커밋)를 main에 반영 — LDAP 인증 폴백+로컬 계정 · 인터뷰 필드 승격(touch_time 7번째 파라미터·노드 IO/조건/data_form·활동별 GMP) · 인스펙터/편집 모달 재설계(아코디언·레이지 세이브·데이터 폼 피커·비용 통화 토글) · 노드 IO 연결(불러오기) · height-shift 노드 간격 자동 재조정+엣지 우회 · 비교화면 리프레시(세션 드래그·요약 탭·최신화)+start/end 노드 · 에디터 프레임워크 트리 칩 · PNG 내보내기 정보 카드 · SP 상태 배너/노드 카드 UX · React 19.2 useEffectEvent. 상세는 아래 항목들.
- **배포 시 필요**: ① `.env`에 인증 3키 추가(`AUTH_MODE`·`AUTH_JWT_SECRET`·`AUTH_JWT_TTL_HOURS`) — keycloak 유지면 `AUTH_MODE` 공란으로 무회귀, ldap 전환 시 `AUTH_JWT_SECRET` 필수. frontend `NEXT_PUBLIC_KEYCLOAK_*` 빌드 args는 폐기(런타임 `GET /api/auth/mode` 조회)라 compose에서 제거된 상태. ② 스키마는 자동 ALTER(`nodes` 승격/IO 링크/gmp 계열·`process_maps` sp_* 계열, `db.py _ADDED_COLUMNS`) — 리셋 불가. ③ **FE/BE 동시 배포 필수** — 구 FE의 graph PUT이 승격 필드를 소거한다(`docs/deploy/db-migration-9910.md` §8).
- 게이트(머지 후 main 기준): BE pytest 1150 passed·ruff 0 / FE vitest 767 passed(55 files)·tsc 0·lint 0·build OK.
- 정리 완료(08-26): 원격 `feat/io-linking`·`feat/node-spacing`(main 완전 병합·열린 PR 없음)을 로컬에서 삭제 — 원격 실행 환경의 ref 삭제 403은 로컬 push로 우회. 원격은 dev·main만 유지.

## 2026-08-25 — SP GMP 필 숨김·우측 핸들 dot 정렬 (dev)
- 미분류 GMP 호버 필은 수정 가능할 때만(SP는 링크 맵 상속 read-only·읽기전용 모드 제외) — 클릭 유도만 되던 필 제거. SP 단일 끝 핸들 dot이 50% 중앙에 남아 엣지 앵커(라벨 라인)와 어긋나던 것 — 단일 끝은 18px 앵커, 다중 끝만 분산 유지.

## 2026-08-25 — 프레임워크 플라이아웃 이동 게이트 (dev)
- 맵 탭 버전 필 우측 액션 클러스터 최좌측에 버전 비교 아이콘 버튼(GitCompare) — 하단 CTA와 동일 게이트(게시본 없으면 비활성+안내 툴팁).
- IO 박스 헤더(3노드 타입 공통 NodeIoDetails)에 행과 같은 호버 하이라이트(enabled 한정 bg-surface-alt+글자 진하게) 추가.
- 우측 프레임워크 칩 플라이아웃의 맵 이동에 F6 "링크맵 열기"와 동일한 미저장 경고 확인 모달(openMapPrompt) 재사용 — FrameworkChip onNavigate 게이트 prop, 미제공 시 직접 이동 폴백.

## 2026-08-25 — SP 상태 배너 4종 완성 (dev)
- 배너 체인: 업데이트 가능(액센트) > 지정 해제(에러 톤, 코너 뱃지와 동조) > 플레이스홀더 링크 미지정(앰버 changed 톤 — 해제와 강도 구분) > 버전 고정(중립 박스) > 최신본 추종(박스 없는 semibold 글자 한 줄 — 초록·중립박스안 거쳐 확정, 색=조치 필요 상태만). follow_latest는 전 노드 공통 불리언이라 실링크+지정 유효 게이트, 실렌더 스크린샷 검증.

## 2026-08-25 — 분기 액션 바(바로가기 버튼) 겹침 픽스 (dev)
- 가려지던 건 배지가 아니라 선택 시 노드 하단의 액션 바(링크 버튼) — 분기 하단 확장 블록(파라미터/조건/IO)과 같은 공간이었다. 배지는 원위치(bottom-0) 복귀, 액션 바가 확장 블록(data-id=node-below-extension) 높이를 실측(offsetHeight=줌 무관 레이아웃값, 초기 layout effect+이후 ResizeObserver)해 그 아래로 내려간다.

## 2026-08-25 — 몸체 드롭 빠른 연결 (dev)
- 엣지 드래그를 핸들이 아닌 노드 몸체 위에서 놓으면 기본 핸들로 즉시 연결(정방향=왼쪽 타깃·SP는 in 핸들, 역방향=오른쪽 소스·SP 소스는 제외). 드래그 중 몸체 위에선 커스텀 connectionLine(QuickConnectLine)이 기본 핸들에 스냅된 미리보기를 그려 핸들 포착과 동일한 느낌 — 판정 헬퍼(canQuickConnect)를 미리보기·드롭이 공유해 결과 일치. 기존 onConnect 플로우(디시전 분기 모달·출력 충돌 모달·회귀 차단·터미널 규칙) 그대로 재사용.

## 2026-08-25 — 노드 카드 후속 2건 (dev)
- 분기 조건/IO 박스는 노드 밖 상시 노출이 산만 — 선택(활성) 시에만 렌더(속성/지표 줄은 유지). 미분류(Unclassified) GMP 필은 공간 미차지 기본 숨김 — 노드 호버 시 좌상단 부유로만(분류 진입점 유지, 위치 override는 미분류에선 무시).

## 2026-08-25 — 노드 카드 UX 일괄 7건 (dev)
- IO 목록: 호버 휠은 캔버스 팬 대신 목록 스크롤(nowheel+overflow-y-auto, capped 한정)·미선택 노드 헤더 클릭은 토글 없이 선택만(선택 후 클릭부터 접힘/열림)·분기(decision)도 속성/지표/조건/IO를 마름모 아래 절대배치로 동일 수준 노출(IO 박스 framed 보더 강조).
- URL: 노드 내 라벨 줄 삭제(좌하 배지+액션 바가 전부), 링크 버튼은 등록 시 무조건 노출·뷰어 패널도 무조건 오픈 — 단 iframe 로드·새탭 열기는 기존 안전 판정 유지(비안전 URL은 즉시 폴백 카드, http(s) 외 스킴은 새탭 버튼 숨김).
- start/end 선택 링 rounded-full→rounded-[19px](키 큰 노드에서 링이 노드 뒤로 숨던 회귀)·SP 핸들 라벨 라인 18px 앵커(+justify-start, 다중 끝 핸들은 분산 유지)·모든 노드 더블클릭 시 인스펙터 속성 탭 자동 전환(논스 신호). pw-smoke-io-links 26/26.

## 2026-08-25 — height-shift 펼침 중 적용 + 드래그 지터 픽스 (dev)
- 인라인 펼침 중 height-shift 전면 비활성(spec §7 게이트)이던 것을 합성 **입력**에 Y 오프셋을 베이크하는 방식으로 적용 — childTop·regions bbox·rootOffsets(표시−저장)가 자동 일관, 역변환은 상시 스텝(heightStepsRef)으로 toSavedPoint·finalizeRootDrag Y를 통일(드롭 위치 기준 — 시작 오프셋 빼기의 밴드 교차 오차 제거). 표시단은 펼침 중 renderYOffsets 이중적용 게이트.
- 커진 노드(앵커) 드래그 시 마우스·원위치 사이를 튀는 지터 — 자기 밴드가 매 프레임 따라 움직여 표시/역변환이 서로 쫓던 것. 드래그 시작 시 스텝 동결(dragFrozenSteps), 드롭 시 해제(트윈 복귀). pw-smoke-height-shift 12/12(펼침 상태 드래그 라운드트립 포함).

## 2026-08-25 — 에디터 프레임워크 트리 칩 (dev)
- 프레임워크 등록 맵이면 에디터 캔버스 우상단에 체인 트리 칩(FrameworkChip) — 좌상단 저장 체크리스트 칩 디자인 재활용(반투명·크로스페이드·grid-rows 아코디언). 행 클릭 시 좌측 플라이아웃(행 top 실측 배치 — 아코디언 클립 밖으로)에 카테고리 맵 목록, 클릭으로 다른 맵 이동. ScopeWindow topRightSlot 신설.

## 2026-08-25 — PNG 내보내기 정보 카드+배경·비교 잘림 픽스 (dev)
- 비교 PNG 우측 끝 노드 잘림 — minZoom 0.5 클램프로 큰 맵이 1600×1000에 못 들어가던 것. 프레임을 bounds×minZoom에 맞춰 확장(MAX 4096 비율 축소)하고 fit이 항상 이기도록 zoom 하한을 낮춰 전달.
- PNG(에디터/비교) 공통: 투명 캡처 후 캔버스 합성 — bg-canvas+dot-grid 배경, 하단 정보 카드(이름·오우닝부서 리프·오너·버전(비교는 base→target)·게시일(published 이벤트)·프레임워크 경로). 게시일은 findPublishedAt(events) 공용 헬퍼, 오너명은 get_map에 owner_name 동봉(목록과 동일 Employee 소스, 테스트 추가).

## 2026-08-25 — 비교 드래그 끊김 픽스 (dev)
- 비교 캔버스 드래그가 매 프레임 sessionPos를 갱신해 laidNodes→nodeCenters→handleSides→appEdges 전부 재계산·전 노드/엣지 identity 교체로 화면 전체가 새로고침되듯 끊기던 문제 — 드래그 프레임은 applyNodeChanges(rfNodes)로만 반영하고 sessionPos는 드롭 시점 1회 커밋으로 전환.

## 2026-08-24 — React 19.2 패턴 도입: useEffectEvent 적용 + Activity 판정 룰 (dev)
- React/Next 최신 기능 6종 적용성 검토 → 가치 판정: useEffectEvent·Activity만 채택, Cache Components(전 페이지 클라이언트 컴포넌트라 대상 없음)·Compiler 활성화(검증 비용 별도 결정)는 보류.
- 체크아웃 폴링(에디터)을 useEffectEvent로 전환 — deps의 versions 배열 identity·t가 목록 갱신·언어 전환마다 인터벌 재구독+acquireCheckout 즉시 재호출하던 것 제거(게이트는 selectedVersionStatus 파생값으로 유지). Activity는 코드 적용 없이 룰만 — 기존 설계 3곳(배지 소스 display:none·FrameworkTree 강제 리마운트·pw strict mode)과 충돌해 함부로 쓰면 안 됨을 lessons §8로 명문화.
## 2026-08-24~26 — AI 계약 최신화 + 인터뷰 JSON 임포트 점검 (feat/ai-contract-parity 머지)
- 데이터 표면 패리티(CSV 왕복·Excel)는 다음 브랜치로 이관 — 설계 초안 `docs/design/2026-08-24-data-surface-parity-design.md`(검토값 CSV 왕복 확정·system_fallback 미결·Word 내보내기 제외).
- 챗 계약 승격 필드 반영: `_INSTRUCTIONS` attributes 예시·파라미터 의미·SP 제한 확장(IO/조건은 "대화 근거만" 가드) + `_serialize_node`에 실작업·입력/출력("; " 조인·80자 컷)·양식·조건·GMP 노출. gmp는 읽기 전용 — `AiNodeAttributes`에 없어 편집 에코는 스키마가 거른다. 스키마·FE 수신부는 필드 승격(8/20) 때 이미 준비돼 프롬프트 갭만 봉합.
- touch_time 7종 완성(인터뷰 표면): 인터뷰어 규칙9 params_table·드래프터 attributes 예시(+input/output/조건/양식)·첨부 추출기 계약·apply-params `_PARAM_FIELDS`·FE params 표(Touch 열·48rem)·`PARAM_TABLE_KEYS`. CLAUDE.md의 낡은 "6필드/나머지 4필드" 문구를 7필드/5필드로 정정.
- ops set_attr 승격 텍스트 반영: `resolveAiTextPatch` 신설(params.ts — null=유지·""=지움, IO 텍스트 변경 시 폼·링크·플래그 폐기 = mergeNode 줄 정렬 계약 미러, 동일 에코는 보존, SP 전체 드롭) + page.tsx set_attr 스프레드 배선 — 기존엔 AI가 보낸 input/output/조건/양식이 조용히 버려졌다.
- 인터뷰 JSON 임포트 점검: 키 전수 소비 대조·샘플 2종 dry-run 이슈 0. `artifact_role` 유실 회귀 봉합(승격 리팩터가 [Interview] KV를 지우며 전용 컬럼 없이 증발 → 기록성 키로 잔류 복원, 스모크 [5] 단언 동기) + l5/tasks/exceptions 미지 키 경고 추가. summary·labelSource 미소비는 설계 "미저장" 의도 유지. 잔여: 실파일 dry-run(사용자 제공 필요).
- 머지 직전 main(1cc0c4a1, 08-25 릴리스) 역머지 — 충돌은 PROGRESS뿐, page.tsx 자동 병합(set_attr 배선 유지 확인). 최종 게이트: BE pytest 1172·ruff / FE vitest 775·tsc·lint·build 그린.

## 2026-08-24 — 비교화면 리프레시 + start/end 노드 개선 (feat/compare-refresh 머지)
- start/end 노드: 커스텀 라벨 시 타입 필(Start/End)+제목 분리(좌정렬)·rounded-[19px] 고정 곡률(계란형 방지), 노트(description)는 캔버스 미노출 — 인스펙터/편집 모달 전용(캔버스 노출 1차안은 피드백으로 철회). hasCustomTerminalLabel(canvas.ts).
- 비교 최신화: 유지 엣지 라벨 변경 감지(MergedEdgeStatus "changed"+labelChange, 옐로)·저장 line_style대로 렌더(직선/곡선/꺾은선)·인스펙터 확장(touch_time·GMP 행+IO/양식/조건 블록 diff+엣지 포커스 패널)·변경 목록 세로 필드 행(truncate+툴팁)·동좌표 삭제 노드 순차 오프셋. location은 레거시 계층 마커라 diff 미대상 확정.
- 세션 한정 드래그(sessionPos 키에 방향·버전 쌍 → 전환 시 자동 원위치·리셋 effect 불필요, 핸들 변·목록/Tab 내비 모두 옮긴 좌표 기준)·인스펙터 2탭: 요약 = 7파라미터 버전 합계(BASE→TARGET+delta, sumVersionParam — SP 5종 위임·annual_count/fte 자체값 합·headcount 평균 표기)+기여 노드 목록(클릭=포커스)+확장 섹션 4종(구조·시스템 집합 diff·부서/담당자 지정률·GMP 분포, 공용 SummaryCard)+표시 선택 드롭다운(체크 숨김, 트리거 (-N)).
- 시드: scripts.seed_compare_demo 워스트케이스 확장(17필드 동시 변경·통화 전환·동일 이웃 삭제 2개·라벨/선모양 3종). ⚠️ seed_org_demo 맵은 버전 간 source_node_id 계보가 없어 비교화면 데모 불가 — 비교 검증은 이 데모 맵으로.

## 2026-08-23~24 — 노드 간격 자동 재조정 height-shift + 엣지 우회 (feat/node-spacing 머지)
- height-shift: 표시 높이(실측)로 커진 노드 아래 전체를 저장 Y 계단함수로 밀어냄 — 저장 좌표 절대 불변(표시=저장+X inline-shift+Y height-shift), lib/height-shift.ts 밴드 병합(같은 행 max·스택 합산)·inline-shift 역변환 재사용·rAF 트윈 350ms(즉시 3조건)·인라인 펼침 중 비활성. 드래그/생성/스왑/Ctrl복사 전 경로 역변환, 그룹 오버레이·PNG bounds 표시 공간 전환, 성장 후 1회 재핏(80ms 디바운스·마운트 1.5s 창).
- 엣지 우회(lib/edge-detour): 꺾은선의 기본 3구간 경로가 표시 bbox(+12px) 관통 시 무교차 최소 이탈 회랑으로 직각 우회(무회랑=폴백, 직선·곡선 불변). 라벨은 무가림 최장 구간 중앙. 프로세스 좌우 핸들 제목 라인 18px 고정(이웃 엣지 수평).
- 검증: FE vitest 760(height-shift 9·edge-detour 11)·pw-smoke-height-shift 12/12·브라우저 QA T8/U6/W6 전부 통과(docs/qa/node-spacing-qa.md). 스펙/플랜 docs/superpowers/(main 머지 시 삭제 정책).

## 2026-08-21~24 — 노드 IO 연결(불러오기) 완결 (feat/io-linking 머지)
- IO 항목 링크 그룹(원본 1 아웃풋/SP + 미러 N, itemId-only·줄 정렬 텍스트 컬럼 6개)·불러오기 4시나리오(미러/인수/승계/합류)·전파+정합화 겸용 propagateIoLinks — 단일 소스 lib/io-items.ts. CSV Input_Flags 왕복·일괄편집/복사 소거 가드·플레이스홀더 브로큰 플로우 경고.
- 에디터 UI 웨이브: GMP 픽커 즉시적용+되돌리기 안내(collapse 미리보기·캔버스 반영), IO 체크리스트 3단계(0/3.5줄/전체)+그룹 동반 체크·체크 동기 애니, 인박스 행 컨트롤(R/O 플래시)·2줄 클램프·양식 아이콘 맨 뒤·필수/선택 색·Show more 호버, 디시전 1:1.2+3줄 클램프+배지 코너+인쇄 클램프 해제, 엣지 라벨 160px 랩, kbd 줄바꿈 힌트(Alt/Shift+Enter), SP 마크 인라인·양식 스레딩·버전 배너 2종(한 줄+툴팁), UI em-dash→하이픈 전수.
- 검증: BE pytest 1149·FE vitest 740·pw-smoke-io-links 26/26·브라우저 QA 121항목 118✅(docs/qa/io-linking-qa.md). 랜드마인은 docs/lessons·메모리에 흡수.
## 2026-08-20 — 좁은 인스펙터 입력 오버플로 픽스 (dev)
- 통일 폭 입력의 shrink-0가 원인 — w-32/w-44는 상한으로 두고 min-w-0+축소 허용(메트릭스·조건·시스템·URL·SP 지정 4행). 인스펙터 최소 폭 300px에서 경계 이탈 0 실측(여유 폭에선 통일 폭 유지).

## 2026-08-20 — 섹션 스페이서 규칙 통일 + IO 항목 번호 (dev)
- 스페이서(구분선)는 분리가 필요한 경계에만: 어트리뷰트=URL 위 1개(부서/담당/시스템 무구분, BpmAttributePicker·인스펙터·SP 지정 공통), Metrics=무구분(지정 모달의 행 구분선 제거), 입출력 조건=Output↔시작 조건 경계 1개. 링크 라벨은 URL 하위 항목으로 한 단 더 들여쓰기+축소 글자(UrlLabelField·지정 모달). 입출력 각 항목 앞 회색 번호(1. 2. — 편집 행·읽기 행·SP 상속 표시 공통). 들여쓰기 세로선 유지.

## 2026-08-20 — SP 안내 툴팁 키워드 구조화 (dev)
- 문장식(spNoteFull) 폐기 → 아이콘+키워드 행(Library/Embed, caption-strong)+회색 보완설명+하단 회색 요지 한 줄로 재구성 — 한눈에 파악하는 구조 (사용자 정정 반영).

## 2026-08-20 — 모달 헤더 아이콘·지정 상태 필 + 툴팁 카드 가시성 (dev)
- SP 지정 모달 헤더에 Workflow 아이콘+지정 상태 필(Designated/Not designated, 영어 고정 — SP 카드 뱃지 규칙, `designated` prop 호출부 3곳). 벌크 모달 헤더에 SlidersHorizontal 아이콘. Tooltip 리치 콘텐츠(content) 변형을 카드형으로 승격(caption 14px·max-w-72·여유 패딩) — SP 섹션 ⓘ 안내 가시성 개선, 아이콘 호버 액센트.

## 2026-08-20 — 모달 상단 고정 + 높이 전환 아코디언 + SP 지정 모달 섹션화/스크롤 (dev)
- 벌크·노드 편집·SP 지정 모달을 상단 고정(items-start+pt)으로 바꿔 내용 변화 시 위치 점프 제거. 높이 변화는 AutoHeight(인박스 컴포넌트 재사용)로 스무딩 — 벌크는 카드 전체+카테고리 패널+충돌 박스, 편집/지정 모달은 각 섹션 바디(상시 마운트 래퍼+내부 조건부라 열림/닫힘 모두 애니메이션).
- SP 지정 모달 섹션화: BPM attributes(부서·담당·시스템·URL)/Metrics(SP 5필드+Σ)/I-O & Conditions 아코디언(공유 접힘 키)+모두 접기/펼치기 버튼, max-h+내부 스크롤로 작은 창에서 Save 항상 도달. 실브라우저 7항목(top 불변 실측·600px 창)+스모크 25/25.

## 2026-08-20 — 편집 모달 섹션 일괄 접기/펼치기 (dev)
- BPM attributes 헤더 우측에 아이콘+라벨 버튼(모달은 공간 여유) — 인스펙터 탭 바 버튼과 동일 판정(하나라도 펼침→모두 접기), 모달 3섹션은 로컬 state 직접 제어(공유 영속 키 write 유지). 왕복 실측 검증.

## 2026-08-20 — 데이터 폼 피커(자동완성)·짧은 대시·탭 폭·SP 지정 통일 (dev)
- IO 항목별 자료 형식을 상시 입력칸 → 피커로 전환(`data-form-picker.tsx`): 행 호버 시 아이콘 → 자동완성 드롭다운(카탈로그 12종 `lib/data-forms.ts`, 확장자/영문/한글 유사도=lib/search 재사용, ↑/↓ 이동·Enter/Space 선택, 무일치 자유값은 "추가" 행으로만 확정, body portal). 완료 상태는 필 비활성 표시(카탈로그=아이콘 동반, 기타=텍스트만). 인스펙터·편집 모달·SP 지정 모달 3표면 공유(MultiValueInput).
- 빈값 플레이스홀더 "—"→"-" 전 표면 스윕(주석 제외 15파일). 인스펙터 탭바는 선택 탭 라벨 shrink-0(비선택 탭이 먼저 말줄임), 우측 일괄 버튼 유지. SP 지정 모달 단일행 입력 w-44 통일.
- 검증: data-forms 단위 5·실브라우저 10항목·스모크 25/25(피커 플로 반영)·게이트 그린(vitest 670)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — 모달 저장→인스펙터 즉시 동기 + 모달 버퍼 변경 노출 (dev)
- 편집 모달 저장이 인스펙터에 바로 안 비치던 원인 2건 수정: MultiValueInput 행 버퍼가 외부 값 변경에 미동기(렌더 중 상태 조정으로 외부 변경만 리셋 — 자기 커밋 에코·입력 중 빈 행은 보존), NodeMetricsCard 활성 통화가 외부 통화 전환에 미동기(로컬 비용 draft 없을 때만 재판정).
- 모달에 버퍼 내용 노출: 변경 섹션 헤더에 점(•) + 푸터에 "Unsaved: {변경 필드 목록}"(비용 2필드는 Cost / run 하나로 접음). 실브라우저 6항목·스모크 25/25.

## 2026-08-20 — 인스펙터 입력 상시 노출·통일 폭 + 모달 어트리뷰트 아코디언 (dev)
- 편집 가능한 인라인 입력(수행 지표·조건·data_form·시스템·URL)은 호버 시에만 보이던 영역을 상시 박스(bg-surface-alt+hairline)로 노출, 폭은 최단 행 기준 w-32(128px)로 전 행 통일(모달 표면은 w-44 — NodeDetailsFields/UrlLabelField `inputWidth` prop), 포커스 시 액센트 보더. 읽기전용은 기존 투명 디자인 유지. MultiValueInput 행에도 포커스 보더.
- 편집 모달 BPM 속성(부서/담당/시스템+URL 편입)을 수행 지표와 동일 아코디언 섹션화 — `bpm.attrsCollapsed` 인스펙터와 키 공유. 실브라우저 4항목(폭 128 균일 실측·accent 보더·모달 섹션 공유 키)+스모크 25/25.

## 2026-08-20 — 인스펙터 섹션 일괄 접기/펼치기 (dev)
- 인스펙터 탭 바 맨 오른쪽에 아이콘 버튼(호버 툴팁) — 하나라도 펼쳐져 있으면 모두 접기, 모두 접혀 있으면 모두 펼치기. 아코디언 상태가 컴포넌트별로 흩어져 있어 DOM 컨벤션으로 수렴: 헤더 버튼 `data-acc-toggle`(aria-expanded)+`<details data-acc>`를 탭 콘텐츠에서 쿼리(활성 탭만 마운트=탭 스코프), MutationObserver로 아이콘/툴팁 동기화. 실브라우저 6항목 검증.

## 2026-08-20 — 인스펙터 2차 디자인 라운드 (dev)
- 벌크 카테고리 정리: 순서 속성/수행 지표/입출력·조건, 쉐브론 삭제·선택 점(•)은 라벨 앞. Node display를 공용 컴포넌트(`node-display-section.tsx`)로 추출 — 카테고리 계단 구성·행 전체 클릭 토글(hover), 승격 토글 추가(입력/산출 별도, 시작·종료 조건은 "conditions" 하나로 통합 — 캔버스는 두 줄 렌더), 속성 탭 기본 화면(맵 요약 아래)에도 노출. 맵 탭 노트는 기본 접힘 아코디언·Edge style은 보더 카드로 통일. 인스펙터 설명(읽기전용)은 호버 편집 아이콘/더블클릭 → 편집 모달 설명 자동 포커스(`initialFocus`).
- 검증: 실브라우저 10항목 + pw-smoke-field-promotion 25/25(노트 접힘 반영)·게이트 그린(vitest 665)·매뉴얼 EN/KO 갱신.

## 2026-08-20 — IO 항목별 데이터 폼 + 벌크 카테고리 재편 + BPM 속성 아코디언 (dev)
- 데이터 폼을 IO 항목별 값으로 승격: 신규 정렬 컬럼 4개(`nodes.input_forms/output_forms`·`process_maps.sp_input_forms/sp_output_forms`, 줄 1:1 정렬·`_ADDED_COLUMNS` 자동 ALTER). 기존 노드 `data_form`은 임포트 폴백 유지(항목별 값 없을 때만 행 표시). MultiValueInput에 항목별 폼 열 추가 — 인스펙터·편집 모달·SP 지정 모달(단일행 입력→MultiValueInput 교체) 3표면 공유, SP 상속 표시는 " · form" 접미. 정렬 무효화 규칙 3곳 동일: 재임포트 승계(항목 텍스트 불변 시만, gmp 계보 패턴)·CSV/AI 병합(mergeNode)·벌크(교체=소거, append=유지). diff/compare 필드 등록, CSV/Excel/AI 표면은 제외(병합 보존, 후속 트랙).
- 그룹 일괄 편집 재편: 카테고리 3버튼 한 행(수행 지표/입출력·조건/속성) + 클릭 시 아래 패널에 하위 모드 버튼 펼침(재클릭=접힘, 현재 모드 카테고리는 점 표시). IO·조건 4필드 벌크 모드 신설 — IO는 textarea(줄=항목)·append=줄 추가. 인스펙터 BPM attributes 카드 2곳(일반·SP 상속)도 동일 아코디언(기본 접힘, `bpm.attrsCollapsed`).
- 검증: BE 1146·ruff / FE 665·tsc·lint·build / 실브라우저 신규 10항목 + pw-smoke-field-promotion 25/25(폴백 행 숨김 계약·attrs 접힘 반영, [11][12]에 폼 회귀 추가). 매뉴얼 EN/KO 갱신.

## 2026-08-20 — 인스펙터 레이지 세이브 + 비용 통화 토글 (dev)
- 수행 지표·입출력 조건 두 섹션을 자동 저장→명시 저장(버퍼+헤더 Save 버튼, 노드 전환 시 미저장분 폐기)으로 전환하며 카드를 `node-metrics-card`/`node-details-card` 컴포넌트로 추출(key 리마운트=버퍼 리셋). 비용은 배타 계약이라 KRW/USD 2행을 ₩/$ 세그먼트 토글 1행으로 통합 — 반대 통화 값이 있으면 "저장 시 삭제" 인라인 안내+되돌리기(인스펙터·편집 모달 동일). 검증: 신규 시나리오 14/14 + pw-smoke-field-promotion 25/25(레이지 계약 반영, [8]은 c0c532a에서 제거된 배지 단언 정정)·게이트 그린·매뉴얼 EN/KO 갱신.

## 2026-08-20 — I/O & Conditions 아코디언 + 두 섹션 행 아이콘 (dev)
- 입출력·조건 섹션을 수행 지표와 동일한 아코디언(기본 접힘·채움 개수 배지·`bpm.detailsCollapsed` 인스펙터↔편집 모달 공유)으로 전환. 두 섹션 전 행에 12px 아이콘(수행 지표=PARAM_ICON 공용 추출 `components/param-icons.ts` — 캔버스 칩·일괄 편집 탭과 3표면 공유 / IO·조건=`DETAIL_FIELD_ICONS`: 입력 LogIn·산출 LogOut·형식 FileType·시작 Play·종료 Flag). 게이트 662·tsc 0·build OK, 기본 접힘 실브라우저 확인.

## 2026-08-20 — 승격 카드 용어 확정 (dev)
- 혼동 제거(사용자 지시) — 노드 카드 타이틀 "Details/상세 속성" → **"I/O & Conditions/입출력 · 조건"**, "Parameters/파라미터" → **"Metrics/수행 지표"**. i18n 값+매뉴얼 4종 일괄 스윕(코드 식별자·설정 "상세" 탭명은 유지), 매뉴얼의 낡은 "6필드" 표기도 7로 정정. 상세 디자인 피드백은 용어 확정 후 사용자 진행 예정.

## 2026-08-20 — 인터뷰 필드 승격 + 활동별 GMP (feat/field-promotion → dev)
- 인터뷰 텍스트 직렬화 키를 고유 필드로 승격(기조: 노드↔SP 대칭) — **touch_time 7번째 공용 파라미터**(duration H.MM 완전 미러: 정규화·Σ·CSV 20열·Excel·일괄편집·SP 상속 5필드·칩=스톱워치 아이콘), 노드 input/output(개행 복수·Details 카드/편집 모달 공용 `NodeDetailsFields`)·시작/종료 조건·data_form(IO 종속 행)·system_fallback, 맵 sp_조건·GMP 3값+폴백 5종. 설계 `2026-08-19-field-promotion-design.md`.
- **대표+폴백 검토 흐름**: 임포트는 폴백에 원문([Interview]=Owner role만·노드 KV=Rule/Screen/Quote만), 검토는 `PATCH /maps/{id}/process-fields`(오너, SP 지정 무관)+설정 Conditions & GMP 카드+`FallbackHint` 팝오버(원문·수정·적용). 엔진은 sp_gmp 비교·갱신 제외, 폴백 수정은 재전달이 덮음(전달분이 진실). openItems·tasks.note도 노트 보존.
- **활동별 GMP**: `nodes.gmp`(3값, 무효 "" 소거) — 캔버스 필 태그(맵 탭 GMP 토글, 노드 안쪽 라벨 왼쪽 위, 미분류=아이콘만, 45% 틴트 보더), 편집 모드 필 클릭=클릭 지점 분류 피커, **분류가 일반 노드 색 자동 확정**(GMP_NODE_COLORS)+마우스 지점 안내 모달(2단 되돌리기: 이전 분류로/색만). SP 노드는 링크 맵 sp_gmp read-only 상속 필. **재임포트 승계**(계보 이어받기·시그니처 제외 — 검토값 보존).
- 검증: QA 문서 `docs/qa/2026-08-20-field-promotion-qa.md` 43항목 전부 ✅(스모크 `pw-smoke-field-promotion.mjs` 25/25 + GMP 6체크 + 3차 5체크 + 회귀 15/15·7/7·25/25). 게이트 BE 1143·ruff 0 / FE 662·tsc 0·build OK. ⚠️ 서버 배포는 FE/BE 동시 필수(구 FE의 graph PUT이 승격 필드 소거) — 재임포트 1회로 백필(`docs/deploy/db-migration-9910.md` §8). 시스템 라이브러리는 별도 트랙.

## 2026-08-19 — LDAP 인증 폴백 + 로컬 계정 (dev, 완료)
- 9910을 LDAP으로 열어 Keycloak 없이도 AD bind + 설정 화면 발급 로컬 계정(컨설턴트용)으로 로그인하게 함. 설계 스냅샷 `2026-08-19-auth-fallback-ldap-design.md`는 서버 Keycloak 로그인 실검증 후 폐기(git history 보존) — 운영 계약은 `docs/deploy/deploy.md` §2.1·`docs/spec.md`가 담당.
- 구현: `AUTH_MODE=keycloak|ldap|dev`를 `GET /api/auth/mode`로 런타임 노출(프론트 빌드타임 상수 폐기) · 자체 서명 HS256 세션 토큰(`app/tokens.py`, `AUTH_JWT_SECRET` 필수) · `POST /api/auth/login`(로컬 계정 우선→AD bind 폴백, 5회/5분 스로틀) · 설정 화면 로컬 계정 CRUD + sysadmin 부여(`local_credentials`, 메모리 캐시) · 프론트 3모드 게이트(`AuthGate`/`DevGate`/`LdapGate`)와 모드별 로그인 화면.
- Task 11(마감): frontend 빌드 args(`NEXT_PUBLIC_KEYCLOAK_*`) 완전 제거 — top-nav 로그아웃·`keycloak-login.ts`도 런타임 조회(`getCachedAuthMode`)로 전환. `docs/deploy/deploy.md`에 인증모드 절 추가(AUTH_JWT_SECRET 필수·컨설턴트 계정 회수 절차·토큰 무효화 불가+시크릿 교체 kill switch·단일 워커 캐시 주의). `scripts/pw-smoke-ldap-login.mjs` 신설(5시나리오 10체크, 실브라우저 통과). 리뷰 픽스 4건 — ldap-session 만료 파싱 NaN을 만료로 처리, auth-mode 폴백 결과는 캐시하지 않음(재시도 허용), 죽은 `login.or` i18n 키 제거. 전체 그린: backend 1129 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 최종 리뷰 하드닝 3건: ① 로그인 로컬 분기를 `credential 존재`가 아니라 `credential + employee.source=='local'`로 강화 — HR 동기화가 충돌 loginId를 `source='hr'`로 전환한 뒤 orphan credential로 계속 로그인되는 구멍 차단, AD로 폴백. ② `is_sysadmin`의 `_granted_sysadmins` 캐시 항을 `resolved_auth_mode()=='ldap'`일 때만 인정 — ldap→keycloak 전환 후 관리 엔드포인트가 404라 회수 불가능한 잔여 부여가 새는 문제를 predicate에서 차단(env 목록은 모드 무관 유지). ③ 로컬 계정 표에 active 토글(deactivate/reactivate) 추가 — 스펙 §5·`docs/deploy/deploy.md` 오프보딩 절차가 요구하던 차단 기능이 UI에 없었던 결함. `docs/deploy/deploy.md`에 AD 첫 로그인 전제(HR 미동기화 계정은 401) 한 문장 추가. 전체 그린: backend 1132 passed+ruff clean, frontend tsc/lint/vitest 652 passed/build 통과.
- 서버 검증: **Keycloak 로그인 실검증 확인**(런타임 모드 전환·빌드 ARG 제거·PKCE 경로 무회귀). 잔여 검증: 실 AD bind·ldap 모드 평문 HTTP·`AUTH_MODE=ldap` compose 전환.

## 2026-08-19 — 로딩 플레이스홀더(shimmer) 일괄 도입 + 첫 렌더 애니메이션 억제 (dev)
- 실서비스에서 보이던 3종 깜빡임 — ①공지 작성자 필이 아이디→이름으로 바뀜 ②홈 새로고침 시 "맵 없음" 화면이 1초쯤 떴다가 뒤집힘 ③좌측 조직도가 렌더 후 아코디언 애니메이션을 우르르 재생. 공통 원인은 "데이터 없는 상태를 먼저 그린다"라, 그 자리를 shimmer 스켈레톤(`globals.css .skeleton` + `components/skeleton.tsx`)으로 채우는 방향으로 통일.
- ① `useDirectoryState().ready`로 "아직 안 온 것"과 "모르는 사람"을 구분 — 도착 전 UserPill은 스켈레톤 필. ② 홈은 맵+내 정보+디렉터리가 모두 settled될 때까지 `HomeSkeleton`(같은 1:2 레이아웃). ③ `useClosingKeys.getSectionClass`가 사용자가 접거나 편 뒤에만 `accordion-open`을 주고, 그 전(첫 페인트·localStorage 복원·시드)에는 애니메이션 없는 `accordion-static`.
- 검증: `scripts/pw-smoke-loading.mjs`(API 지연 주입) 수정 전 3/7 → 수정 후 7/7. 미조정: ClampedList의 `clamp-size` 높이 전환은 복원 시 1회 재생되나, 첫 펼침 애니메이션을 잃을 위험이 있어 그대로 뒀다.

## 2026-08-19 — 승인 대기 필 압축(유저 카드 이름·부서 복구) (main 직접)
- 인원 카드에서 `editor → viewer · Approval pending` 필이 행 폭을 통째로 먹어 이름/부서가 0px로 뭉개지던 문제(실측: 이름열 0px·필열 265px) — 필을 **목표 역할만 남긴 압축형**(⏳ Viewer / ⏳ removed)으로 바꾸고 전체 내역(현재→목표·요청자)은 툴팁으로. 공용 `components/permissions/pending-change-pill.tsx`로 추출해 홈·인스펙터 카드와 설정 협업자 패널이 같은 문법을 쓴다.
- 맵 상세 카드에선 staged 태그와 같은 **2번째 줄**로 내리고 우측 필 열에 `shrink-0` — 이름열 103~113px 확보·클리핑 0(실브라우저 before/after 실측, 홈·인스펙터 두 표면).

## 2026-08-19 — 인박스 스크롤바 제거·선택 해제 범위 축소·이름 클릭 (main 직접)
- 인박스 우측 상세에 늘 떠 있던 스크롤바 — `AutoHeight`가 border-box 높이에 테두리를 안 더해 1~2px이 모자랐던 것. 올림+테두리 보정으로 넘침 자체를 없애고, 실제로 넘칠 때만 보이도록 `scroll-quiet`(스크롤 중에만 노출, `useQuietScroll`)를 상세·좌측 목록·긴 textarea에 적용.
- 내용을 클릭·드래그만 해도 선택이 풀리던 문제(멤버 보기 버튼 포함) — 해제 판정을 "빈 여백을 **직접** 눌렀을 때만"(target===currentTarget)으로 바꾸고 홈/인박스의 자식 stopPropagation 가드 의존을 제거. 인박스는 배경이 click, 가드는 mousedown이라 단계까지 어긋나 있었다.
- 사용자 이름 필(UserPill) — 포인터 커서·호버 틴트 추가, **클릭하면 1초 대기 없이 즉시** 인물 카드(부모 행 선택으로 번지지 않음). PersonHoverCard 계열은 이미 동일 동작.

## 2026-08-19 — 드롭다운 안 닫힘 진범: stopPropagation 가드 (main 직접)
- 맵 상세 카드 **안쪽**을 클릭하면 조직/인물 드롭다운이 남던 진짜 원인 — 카드의 선택-해제 방지 `stopPropagation` 가드가 버블을 끊어 메뉴의 window mousedown 리스너까지 이벤트가 도달하지 못했다. 메뉴·팝업·드롭다운 6곳(ContextMenu·PersonInfoPopup·홈 생성메뉴·top-nav·알림벨·피드백 노트·필터)의 바깥닫힘 리스너를 **캡처 단계**로 전환해 해소(실브라우저 좌/우클릭·카드 내부 클릭·Esc 8항목 통과).

## 2026-08-19 — 인스펙터 맵탭 인물/조직 메뉴 복구 + 메뉴 닫힘 강화 (main 직접)
- 에디터 인스펙터 Map 탭에서 부서·유저 카드 좌/우클릭이 무반응이던 원인: `MapDetailCard`가 `showFooter={false}`(인스펙터) 조기 반환에서 **오버레이 블록(컨텍스트 메뉴·조직 정보·인물 팝업)을 렌더하지 않음** — 상태만 바뀌고 화면엔 아무것도 없었다. 오버레이를 변수로 추출해 두 반환 모두에서 렌더.
- 메뉴·팝업이 fixed 좌표라 목록이 움직이면 엉뚱한 자리에 남던 문제 — `ContextMenu`·`PersonInfoPopup`에 스크롤(캡처)·리사이즈 닫힘 추가(바깥 클릭·Esc는 기존). 실브라우저 8항목 통과(인스펙터 메뉴·팝업·스크롤 닫힘, 홈 단일 메뉴 유지).

## 2026-08-19 — 인박스 결재 주체 표시 + 상세 높이 애니메이션 (main 직접)
- 관리자 인박스에서 "관리자라서 보이는 건지, 내가 결재자인지" 구분이 안 되던 문제 — `/inbox/approvals`에 `deciders`·`pending_on`·`approved_by`·`via_sysadmin` 추가(kind별 결재 주체: 버전/권한·가시성=지정 승인자, 이름변경·SP지정=오너, 점유권=점유자+오너). 카드에 대기 필(2명+n), 상세에 결재자/대기 행과 관리자 열람 안내.
- 우측 상세를 **내용 높이**로 바꾸고(`components/auto-height.tsx`, ResizeObserver+height 트랜지션 350ms, 첫 측정은 무애니) 카드 전환 시 이전 높이에서 이어지게 — 승인·알림 상세 공용. 게이트 BE 1077·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 8항목(대기 필·높이 추종·전환 중간값 관측).

## 2026-08-19 — 8월 2차 릴리스 문서 (main 직접)
- 공지 초안 `docs/notices/2026-08-19-release.md` 신설(연결선 모양·라벨 줄바꿈·창 닫기·피드백 노트/알림·GLM-5.2 이관) + docs 인덱스 등록.
- 매뉴얼 6종 갱신 — 편집(엣지별 선 모양·일괄 변경·Shift/Alt+Enter 줄바꿈·단축키 행), 사용 안내(피드백 노트·알림 수신), 관리자(알림 보내기 2종·노트 수정이력/아카이브·`feedback_notes` 퍼지, 설정 레퍼런스에 AI_BASE_URL/AI_MODEL/AI_MAX_TOKENS/AI_TIMEOUT_SECONDS). README 기능 줄 1건.

## 2026-08-19 — dev → main 릴리스 머지
- 8/18 이후 dev 전체를 main에 반영 — 엣지별 선 모양(서버 영속+일괄 변경 모달)·GLM-5.2/SGLang 사고모드 이관·인터뷰 임포트 정리(variant 보존)·피드백 노트/수동 알림·노드/엣지 라벨 줄바꿈·모달 닫기 규칙(Esc·mousedown). 상세는 아래 항목들.
- **배포 시 필요**: 서버 `.env` AI 설정 교체(`AI_BASE_URL=https://gpu02.sbiologics.com/v1`·`AI_MODEL=glm-5.2`·`AI_API_TOKEN`·`AI_MAX_TOKENS=8000`, 타임아웃 120~180 권장). 스키마는 자동 ALTER(edges.line_style·feedback 알림 시각 2종·feedback_notes 2종) + 신규 테이블(feedback_notes·feedback_note_revisions·map_notes) 자동 생성.
- 게이트(머지 후 main 기준): BE pytest 1077·ruff 0 / FE vitest 640·tsc 0·lint 0·build OK.

## 2026-08-19 — 액션 variant 보존 + 예외 색 분리 (feat/interview-variant → dev)
- 실파일 검증 피드백 반영 — `variant`가 통째로 버려지던 갭 해소: `normal` 외 값은 `Variant:` 줄로 노드 노트 보존, `exception`은 노드 색 rose(#c2849a, COLOR_PRESETS 수동 동기)로 시각 분리. 흐름 분기는 앵커 정보 부재로 미구현(협의 확장 포인트). CanonicalNode.color 신설·엔진 passthrough·시그니처 포함(색 변경=새 버전 감지). 샘플에 예외 액션 추가. 게이트 BE 1068·ruff 0(머지 후 재확인).

## 2026-08-19 — 모달 닫기 규칙 통일: Escape + 바깥 누름(mousedown) (dev)
- 공용 `ModalBackdrop`이 단일 지점 — 바깥 **mousedown 즉시 닫기**(mouseup 대기 없음, 내부 드래그→바깥 릴리즈 오작동도 함께 해소)와 **Escape 닫기**(겹친 모달은 스택으로 최상위만) 제공. 오버레이를 직접 들고 있던 5곳(피드백 상세·공지 편집·알림 퍼지·인터뷰 파라미터/드로우·조직 정보)을 여기에 흡수 — 36개 모달이 같은 규칙.
- 홈: 빈 여백 **누름**으로 선택 해제(상세/카드 가드도 mousedown 기준), 생성 메뉴 바깥 닫기 리스너도 mousedown. 실브라우저 10항목 통과(Esc 단계별·mousedown 즉시 닫힘·드래그 오작동 없음·홈 디셀렉).

## 2026-08-19 — 피드백 노트·수동 알림 + 이름/라벨 Alt+Enter 줄바꿈 (dev)
- 피드백 알림을 **자동 발송 → 관리자 수동 발송**으로 전환(사용자 결정) — 답글 저장은 무통지, 저장 버튼 옆 "알림 보내기"(확인 모달 → 발송 → 토스트)와 상태변경 알림 버튼(**피드백당 1회**, 발송 후 잠금)으로 분리. `feedback.reply_notified_at`/`status_notified_at`로 이전 발송 여부를 모달 메타에 표시. 본인 피드백 셀프 발송은 서버 400(관리자도 피드백 작성자가 될 수 있어 실재하는 경우).
- **`feedback_notes` 테이블 신설** — 누구나 자유롭게 노트 작성, 목록 테이블 노트 버튼 → body portal 플라이아웃에서 내용+시간순 로그 열람·추가. 스레드(작성자 이어달기)는 계속 보류.
- 알림 버튼 발견성 픽스(실사용 피드백) — 관리자에게 **항상 노출**하고 못 보내는 경우만 사유 툴팁으로 비활성(본인 작성/답글 미저장/상태알림 기발송). 기존엔 `!isAuthor` 조건이 버튼을 통째로 숨겨 "관리자인데 안 보인다"가 됐고, done 상태에선 답글 영역째 사라져 알림도 못 보냈다.
- 노트 라이프사이클(사용자 결정): **수정은 작성자만 + 직전 본문을 `feedback_note_revisions`에 스냅샷**(플라이아웃에서 이력 펼침), **삭제는 아카이브까지만**(`archived_at`, 기본 숨김+보기 토글) — 되돌릴 수 없는 **영구삭제는 관리자 DB 테이블의 퍼지 버튼**에서만(알림 퍼지 선례). 겸사로 피드백 하드삭제 시 노트/이력 정리 추가(sqlite FK CASCADE 기본 비활성이라 고아 행이 남던 경로).
- 랜드마인: portal 자식(ConfirmDialog)의 이벤트는 **React 트리를 따라 버블**해 오버레이 `onClick=onClose`가 삼켜 모달이 닫혔다 — 오버레이 밖 형제로 분리(실측).
- 노드 이름 3표면(캔버스 인라인·인스펙터·편집 모달)을 textarea로 전환 — **Enter=커밋, Alt/Shift+Enter=줄바꿈**(Shift는 사용자 요청으로 추가). 캔버스 렌더 `whitespace-pre-wrap`, 실측 추정기(estimateNodeWidth/countTitleLines)는 \n 세그먼트별 계산.
- 엣지 라벨도 동일 규칙(Enter 커밋·Alt/Shift+Enter 줄바꿈) 적용 — SVG `<text>`는 줄바꿈 불가라 커스텀 엣지(`multiline-edge.tsx`, EdgeLabelRenderer HTML 라벨, compare의 LabeledSmoothEdge 선례)로 빌트인 3타입을 덮어씀. 라벨은 pointer-events-none이라 선택·더블클릭 편집·컨텍스트 메뉴는 아래 path로 통과(실브라우저 7항목 확인). 게이트: BE 1068·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 스팟(Alt+Enter 입력→저장 "\n" 확인→리로드 2줄 렌더) 통과.


## ── 2026-09-02 이동분 (PROGRESS 경량화 — 원문 그대로) ──

## 2026-08-18 — GLM-5.2/SGLang 전환 + 챗 UX (feat/glm52-api → dev)
- GPU 서빙이 vLLM(모델명 alias 3종) → SGLang 단일 `glm-5.2`로 바뀌어 사고 모드를 요청 파라미터로 이관 — `call_ai`에 `reasoning`("high"/"none"/기본=최대)·`max_tokens`(기본 `AI_MAX_TOKENS=8000`, 사고 토큰 포함이라 작으면 빈 응답) 추가, 호출 목적별 지정(챗·인터뷰어="high", 드래프터=최대, 첨부 추출="none"). 서버 .env는 `AI_BASE_URL=https://gpu02.sbiologics.com/v1`·`AI_MODEL=glm-5.2`로 교체 필요(deploy.md 갱신, 타임아웃 120~180 권장).
- 챗 UX: 전송 단축키를 인터뷰 입력과 정렬(Enter=전송, Shift+Enter=줄바꿈), 스텁("준비 중" 토스트)이던 파일 첨부 버튼 제거. 게이트: BE 1063·ruff 0 / FE 637·tsc 0·lint 0·build OK. 실 GPU 검증 잔여.

## 2026-08-18 — 엣지별 선 모양 (feat/edge-line-style → dev)
- 선 모양(곡선/꺾은선/직선)을 맵 전역 localStorage 토글 → **엣지별 서버 영속**(`edges.line_style`, `_ADDED_COLUMNS` 등록·clone 보존·""=레거시 꺾은선)으로 전환 — 인스펙터 엣지 패널·엣지 컨텍스트 메뉴에서 개별 변경. 구 전역 토글 자리는 "전체 일괄 변경 + 확인 모달"(변경 수·모양별 내역 요약)로 대체, 새 엣지 기본값은 마지막 일괄 선택(맵별 `bpm.edgeStyle.<mapId>`, 구 전역 키 폴백).
- 증발 방지: CSV/AI 머지는 엣지 전량 재생성이라 (source→target) 쌍으로 line_style 이월(신규 엣지는 맵 기본값), 붙여넣기·Ctrl드래그 사본·클립보드도 type 보존. 적대적 리뷰 확정 2건(맵 전환 시 기본값 하이라이트 스테일·머지 신규 엣지 "" 폴백) 반영. 게이트: BE 1065·ruff 0 / FE 640·tsc 0·lint 0·build OK, 실브라우저 스모크 `pw-smoke-edge-style.mjs` 11/11(개별 변경·컨텍스트 메뉴·일괄 모달·API 영속·리로드 복원).

## 2026-08-18 — canonical 임포트 경로 정리 (chore/remove-canonical-import)
- 실전달물이 인터뷰 JSON으로 확정되어 기존 canonical 수용 표면 전체 제거(사용자 결정) — 웹 `POST /api/categories/import`·CLI(run_import/main)·파일 로더(load_categories/load_maps/parse_map_objs)·FrameworkImportIn/Out. 엔진(import_delivery)·canonical 모델·parse_categories는 인터뷰 어댑터의 내부 IR로 유지. BE 게이트 1062·ruff 0.
- 정리 커밋의 `git add -A`가 home-dept 스모크 스크린샷 4장(SHOT_DIR 기본 `.`)을 쓸어담은 것 발견 — 제거 + `frontend/.gitignore`에 `home-dept-*.png` 가드.
- FE도 동반 정리 — 설정 탭 canonical 임포트 섹션·importFramework·parseCategoriesFile/parseMapsFile·미사용 i18n 5키 제거, canonical 샘플 디렉터리 삭제. 스모크 2종은 인터뷰 샘플 웹 임포트 시드로 재작성(admin은 CRUD 전담, home은 자가 시드 + my-dept 스티키 체크 폐기 — 전제였던 admin 오너 canonical 샘플 소멸). 문서 스윕(9910 §8·관리자 매뉴얼 EN/KO·checklist·design/README). 게이트 FE 637·tsc 0·lint 0·build OK, 스모크 15/15·7/7·25/25·23/23.

## 2026-08-18 — 인터뷰 결과 JSON 임포트 1차 (feat/interview-import → dev)
- PwC 협의로 실전달물이 canonical → **인터뷰 결과 JSON**(0.3-bpm-interface-draft)으로 확정 — Phase 3 어댑터 1차 구현 완료. 설계·결정 로그: `docs/design/2026-08-18-interview-import-design.md`.
- 구성: 순수 어댑터 `scripts/consultant_interview.py`(키 화이트리스트 검증·경로 표기 이슈·seq 그룹 병렬 엣지·`total_time_min`→H.MM·KV 텍스트 직렬화) → 기존 `import_delivery` 재사용(canonical description 확장·오너 null=actor 폴백+`consultant_owner_pending`·pending 맵만 재전달 거버넌스 예외 갱신) · 신규 `map_notes` 테이블(예외/VOC, 전달 단위 replace 멱등)+`GET /maps/{id}/notes` · `POST /api/categories/import-interview`(다중 파일·error 파일 스킵·파일 간 중복 taskId 제외) · 설정 Framework 탭 Interview import UI(파일별 아코디언 키 검증 리포트) · 맵 상세/인스펙터 읽기전용 Notes 섹션.
- 게이트: BE pytest 1071·ruff 0 / FE vitest 646·tsc 0·lint 0·build OK / 실브라우저 스모크 `pw-smoke-interview-import.mjs` 15/15. 합성 샘플 `docs/samples/consultant-interview-sample/`. 잔여: 서버 배포 후 실파일 dry-run 키 대조·에디터 인스펙터 Notes 스팟 체크.

## 2026-08-14 — 8월 릴리스 문서 일괄 + dev→main 머지
- 이전 main 머지(2026-08-04) 이후 변경분(거버넌스 UX P0~R6·승인 코멘트·협업자 스테이징·조직 기준 departments·HR 웹훅·업무체계 Framework·관리자 CSV)을 main으로 머지하며 릴리스 문서 일괄 갱신 — 공지 초안 `docs/notices/2026-08-14-release.md` 신설, 사용/편집/관리자 매뉴얼 6종 갱신, README 기능 목록·CLAUDE.md 상태 라인(⑩) 최신화.
## 2026-08-14 — 상단 네비 반응형 구현 (fix/frontend-minor)
- **최종 리뷰 픽스(컨트롤러 직접)** — 강등 아이콘 버튼 3곳 aria-label(피드백·유저 메뉴·언어 전환)·클론 패리티 2건(인박스 뱃지 min-w-[1.125rem]·언어 활성 font-semibold). 게이트: vitest 643·tsc 0·lint 0 error. ※ 서브에이전트가 동일 픽스를 main에 오커밋(9e16857, 미푸시) — 로컬 main 원복 필요.
- **Task 1: `lib/display-stage.ts` TDD 완료** — `pickDisplayStage(available, stageWidths, marginPx=8)` 순수 함수(4 test 통과, tsc clean). 폭 실측 기반 단계 판정: 모든 단계가 미측정이거나 부족하면 강등(length로 반환), margin은 진동 방지 여유.
- **Task 2: `top-nav.tsx` 4단계 반응형 배선** — `pickDisplayStage` + 측정 복제 4개(S0~S3, 비상호작용 스팬·InboxBadge/NotificationBell은 정적 플레이스홀더)로 `stage` 실측, RO+rAF 초기 산정(deps `[lang, userName, tabIndex]`, 필터 모드 훅 선례). 라이브 전환: S1 탭 비활성 아이콘만+title(활성만 라벨, IconPillFilter 문법 350ms), 세그먼트 래퍼 `grid-cols-3`→`inline-flex`(S0 시각 동일) — InboxBadge는 라벨 유무와 무관 상시 렌더. S2 피드백 버튼 아이콘만(매뉴얼 아이콘 버튼과 동일 스타일)+Tooltip. S3 언어 토글 현재 언어 1버튼(클릭 즉시 전환)+Tooltip(신규 i18n `nav.langSwitchEn`/`nav.langSwitchKo`). S4 이름 버튼 → `User` 16px 아이콘+Tooltip(user.name), 드롭다운·로그아웃 구조 불변, 비로그인 Login 버튼은 전 단계 불변. 게이트: vitest 643 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **Task 3: 브라우저 검증 + 실측 픽스 2건** — `scripts/pw-verify-topnav-responsive.mjs`(1440/1200/1000/860/760px×EN·KO, 좌우그룹 충돌·줄바꿈·오버플로 실측 rect 기반, S1 클릭 네비 확인, 62/62 pass·콘솔에러 0). 실측 중 진짜 버그 2건 발견·수정: ① 복제 벨 플레이스홀더 `p-1.5`(+12px 과대측정, 실 `NotificationBell`은 무패딩) — 실 크기로 맞춤. ② 측정 복제 4개가 `absolute left-0`만 있고 `right` 미지정이라 containing block(nav 전체폭) 기준 shrink-to-fit 계산되어 **좁은 뷰포트에서 자연폭이 클램프되어 과소측정**(스테이지 오판 유발 확인 — 원인 ①②로 760px에서 실제보다 이른 단계로 진입했었음) → `w-max` 추가로 뷰포트 무관 고정. 설계 스펙 §5의 "760px→S4" 가정은 두 픽스 반영 후 실측으로 반증(시드 데이터 기준 760px는 S1까지만, 진짜 S4는 avail<~644px/폭 ~660대) — 버그 아니라 "필요한 만큼만 강등"이 의도대로 동작한 결과. 760 앵커를 실측대로 S1로 교정 + 보조 600px에서 S4 도달 확인(캐스케이드 전 구간 배선 검증). 최종 게이트: vitest 643·tsc clean·lint 0 error·build OK.
- **Task 3 리뷰 픽스**: Critical — `w-max`로 자연폭을 살린 측정 복제(S0~S3)가 `visibility:hidden`이어도 조상 스크롤 가능 오버플로엔 반영돼 좁은 뷰포트에서 문서 실 가로 스크롤 유발 가능(nav 자체엔 `overflow-hidden` 금지 — 유저메뉴·벨 드롭다운이 nav 40px 박스 아래로 나가야 함) → 전용 클리핑 래퍼(`absolute inset-0 overflow-hidden`)로 복제 4개만 격리(클론 자체 scrollWidth는 조상 클리핑과 무관해 측정치 그대로 정확 — 실측 확인). 검증 스크립트에 `document.documentElement.scrollWidth<=innerWidth` 가드 추가(74/74 pass, +12). Important — 스펙 §5에 "760→S1 정정(T3 실측)" 각주 추가. 재게이트: vitest 643·tsc clean·lint 0 error·build OK.

## 2026-08-14 — 상단 네비 반응형 설계·플랜 (fix/frontend-minor)
- **설계 스펙**: `docs/superpowers/specs/2026-08-14-topnav-responsive-design.md` — 폭 실측 기반 4단계 누적 강등(S1 탭 활성만 라벨(IconPillFilter 문법·인박스 뱃지 상시) → S2 피드백 아이콘 → S3 언어 토글 1개(클릭 즉시 전환) → S4 이름 User 아이콘). 판정은 `pickDisplayStage` + 측정 복제 4개(비상호작용 스팬·뱃지/벨 플레이스홀더).
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-topnav-responsive.md` — 3태스크(lib TDD·top-nav 배선·브라우저 검증). T9 교훈 반영: 오버플로 단언은 scrollWidth 금지(복제 오염)·가시 rect 기반.

## 2026-08-14 — 조직/인물 카드 후속 (dev 직접)
- **후속(피드백)**: 부서 행·오우닝 부서 카드 좌클릭도 우클릭과 동일한 조직 정보 메뉴(펼침 없는 카드라 포인터 어포던스와 배선 일치) · 인물 카드에 직급·보직 필 추가(`formatTitleWithPosition` 재사용 — allowlist 보직만, 멤버 행 펼침 필과 동일 표기).
- **승인 워크플로 패널 리디자인**: 상태를 태그 필로 승격(Approved/Pending/Rejected 틴트 필 + 호버 시 이벤트 기반 시각·코멘트 툴팁 — `hover-tip.tsx` 신설·150ms 지연·비인터랙티브), 승인자 행에 인물 카드 부착+이름 한/영 전환, 제출 컨텍스트는 호버 아이콘만(제출자·시각·코멘트 — 영구 노출 지양 지시), 진행 필(n/m)·대기자 필 나열·반려 사유 라인·동봉 가시성 필, 스테퍼 위계 강화(원 32px·연결선 4px·활성 라벨 caption-strong). 사이클 판정은 최신 submitted 이벤트 이후만(재제출 시 이전 사이클 승인 시각 오표시 방지). `ApprovalPanel.events` prop 신설(에디터 `currentVersion.events` 전달, API 무변경).
- **패널 후속 조정**: 인물 카드 트리거 클릭 토글(열림 상태서 클릭=닫기)·승인자 트리거 반투명 회색 음영(`hover:bg-ink/5`)·스테퍼 라벨 전 단계 동일 사이즈 태그 필(색상만 강조).

## 2026-08-14 — 협업자 스테이징 UX 구현 (fix/frontend-minor)
- **T1 BE request_id** — `PendingChangeOut.request_id` 필드 신규 추가(요청자 본인 철회 용). schemas.py 184·permissions.py 117-120 수정, test 1216-1254 assert 강화(pending 생성 응답 req_id 캡처 추가). TDD: RED(assert 실패 `request_id` 미노출) → GREEN(1042 tests passed, ruff clean).
- **T2 FE forecastStagedOp** — 권한 op별 즉시/승인 예측 함수(BE `requires_downgrade_approval` 미러). permission-staging.ts에 `forecastStagedOp(op, grantRole, actorIsOwner): "instant" | "approval"` 추가, 5개 test case(add·viewer→editor·editor→viewer·remove·owner) 전부 green. TDD: RED → GREEN(15 tests passed, tsc clean).
- **T3 FE applyStagedOps records** — 저장 결과 상세 레코드(되돌리기 재료). `AppliedOpRecord` interface 신규, `StagedResult.records` 필드 추가(outcome + createdPermission/approvalRequest/prev 스냅샷), `applyStagedOps` 시그니처 `permsById?: Map<number, MapPermission>` param 신규. 호출부 2곳 업데이트(collaborators-panel·map-detail-card)에서 permsById 전달. TDD: RED(records undefined) → GREEN(17 tests passed, 620 전체 시험, tsc/lint 0 error).
- **T4 설정 협업자 패널 예고·중복픽스·호버캔슬·회수** — 공용 `HoverSwapPill`(hover-swap-pill.tsx) 신규, i18n 5키(forecastInstant/Approval·cancelPill·pending.withdraw/withdrawDone) EN·KO 양쪽 추가, `MapPermission.pending_change`에 `request_id` 타입 반영. `collaborators-panel.tsx`: 역할 배지 pending prop 제거(실제 role 상시 표시, 배지 pending 중복 소거), pending 상세 태그는 본인 요청이면 HoverSwapPill로 회수(`withdrawApprovalRequest`), 스택 태그는 X버튼 대신 HoverSwapPill+forecast 아이콘(Zap/Hourglass, `forecastStagedOp` 사용)로 교체(행 태그·staged-add 고스트 행 양쪽). 패널에 `isOwner` prop 신규(settings/page.tsx에서 전달). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T5 맵 카드(홈 미리보기·에디터 맵 탭) 동일 4종** — `map-detail-card.tsx`에 T4와 동일 패턴 적용: 역할 배지 `pending` prop 제거+고정폭(`ROLE_PILL_WIDTH_CLASS`) 상시 적용(중복 pending 표시 픽스), `removable`에 `!perm.pending_change` 추가(pending 행은 Remove 어포던스 자체를 닫음 — 쌓으면 저장 시 서버 409), pending 상세 태그는 본인 요청(`loginId` 일치)이면 HoverSwapPill로 회수, 스택 제거 태그·staged-add 태그 모두 X버튼 제거하고 HoverSwapPill+forecast 아이콘(`forecastStagedOp`)로 교체(제거 태그는 아이콘 포함폭이 60px를 넘어 이 필에서만 `min-w-[60px]`로 완화, 공유 상수는 불변). `handleWithdrawPending` 신규: 카드엔 `onToast`가 없어 기존 저장 핸들러와 동일한 재조회 경로(`setLocalReloadKey`)로 반영, 에러는 기존 `stagedSaveError` 배너로 노출(패널의 onToast와 다른 채널). 게이트: vitest 627 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T6 되돌리기(직전 저장 1회분)** — `lib/permission-undo.ts` 신규: `buildUndoPlan(records, actorIsOwner)`(applied add→remove-added·applied change→restore-role·applied remove→re-add·pending→withdraw·failed 제외, `forecastStagedOp` 재사용) + `executeUndoPlan(mapId, items)`(액션별 API 순차 실행, 개별 실패 비차단·pending 집계 — 저장과 동일 정책). `UndoLastApplyModal`(confirm-dialog 백드롭/카드/z-[1300] 패턴 재사용) 신규: 항목별 필+forecast 아이콘(Zap/Hourglass) 목록. 두 표면(`collaborators-panel.tsx`·`map-detail-card.tsx`) 공통 배선: `lastApply` state(컴포넌트 메모리만, 페이지 이탈 시 소멸 — 영속 안 함, 스펙대로), Save 성공 경로에서 `outcome!=="failed"` records로 세팅, Save/Cancel 바가 안 보일 때(`stagedOps.length===0 && lastApply`)만 Undo 버튼 노출(공존 안 함), 확인 후 1회성 소거(재저장 전까지 재사용 불가). 이름 해석은 패널=기존 `resolvePrincipalName`, 카드=기존 staged-add 행과 동일 소스(`nameById`/`groupNameById`/`formatDeptName`) 재사용. 카드는 `onToast` 부재라 저장 핸들러와 동일하게 실패시에만 `stagedSaveError` 배너(성공/승인대기는 재조회 반영만, 일관성 유지). TDD: RED(`permission-undo.test.ts` 모듈 없음) → GREEN(5 tests). 게이트: vitest 632 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T7 오우닝 부서 피커 조직도 브라우즈** — `lib/dept-browse.ts` 신규: `buildDeptBrowseRows(deptOptions, myOrgPath, pinnedCap=3)` — 내 소속 체인을 깊은 단위부터 최대 3개 pinned(트리에서 제외), 나머지는 세그먼트 정렬(=DFS, 부모가 자식의 접두라 항상 먼저 옴) + `depth` 부여. `deptLeaf`·`deptLevelRank`·레벨 아이콘 사다리(센터/담당/팀/그룹/파트)를 `map-detail-card.tsx`에서 `components/maps/dept-level-icon.tsx`로 순수 이동(`DeptLevelIcon` 컴포넌트로 감쌈, size 기본 14) — 카드 3개 사용처(MemberIcon·오우닝 멤버 행·staged-add 행) 임포트 전환, 동작 무변경. `PrincipalPicker`에 `deptTreeBrowse` prop 신규(기존 `myDeptsFirst`는 유일 사용처 교체로 소거) — 빈 검색 브라우즈 시 내 체인 pinned(들여쓰기 없음) → 구분선(pinned 0개면 생략) → 조직도 트리(들여쓰기 `12+depth*14`, 부서 아이콘은 `DeptLevelIcon`)로 렌더, 키보드 내비·infinite slice는 기존 `{item, matches:[]}` hit 형태 그대로라 무변경. 검색 중엔 기존 랭킹 플랫 리스트 그대로(트리 미적용). 호출부 2곳(`create-map-dialog.tsx`·`map-details-panel.tsx` 오우닝 피커) 전환, 협업자/승인자 피커(managersFirst·pinnedIds) 무변경. TDD: RED(모듈 없음) → GREEN(3 tests). 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK.
  - **리뷰 픽스**: 트리 브라우즈 부서 아이콘이 `PrincipalIcon`의 `shrink-0 text-ink-tertiary`를 안 받아 색·shrink가 형제 행과 달랐던 문제 — `DeptLevelIcon`에 `className` prop 신규(기본 `""`, 카드 기존 사용처는 무변경) 추가, 피커 호출부에서 `className="shrink-0 text-ink-tertiary"` 전달. 게이트: vitest 635 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존).
- **T8 홈 필터 필 3단계 반응형** — `lib/filter-display.ts` 신규: `pickFilterDisplayMode(available, {full,label}, marginPx=8)` — 고정 브레이크포인트 아닌 실측 폭 비교(측정 전 폭 0이면 강등 금지, full 유지). `FilterDropdown`에 `display?: "full"|"label"|"icon"` prop 추가(기본 full, 버튼에 `title` 상시 부여) — 기존 유일 사용처(page.tsx)만 있어 하위호환 리스크 없음 확인(grep: inbox/notices/feedback 미사용). `home-filter-pills.tsx` 신규: page.tsx의 상태·역할·오우닝·SP 필터 4종 FilterDropdown + `STATUS_ORDER` 상수를 그대로 이식(로직 무변경, `measureOnly`시 dataId 미부여). page.tsx 배선: 필터 행 `flex shrink-0`→`relative flex min-w-0`(실측 가능하게 축소 허용), 라이브 `HomeFilterPills` + 보이지 않는 측정 복제 2개(`display="full"`/`"label"`, `measureOnly`, absolute+invisible+pointer-events-none+aria-hidden, dataId 없음) + ResizeObserver(행·두 복제 관찰, `homeView`/`lang` 변경 시 재관찰) — 최초 산정은 `requestAnimationFrame`으로 이연(`react-hooks/set-state-in-effect` 회피, RO 콜백은 이펙트 밖이라 무관). 방어 보강: `FilterDropdown` 버튼·루트에 `shrink-0 whitespace-nowrap` 추가 — 브리프가 Task 9로 미룬 Clear 버튼 잠식 엣지케이스(측정에 Clear 폭 미포함)에서도 실패 모드를 "세로 줄바꿈"이 아닌 "여유폭 흡수 실패 시 오버플로"로 강등(같은 파일 내 최소 변경). TDD: RED(모듈 없음, import 실패) → GREEN(4 tests). 게이트: vitest 639 passed, tsc clean, lint clean(무관 스크립트 warning 1건 기존), build OK. 잔여: Clear 버튼 폭이 margin(8px)에 실제로 흡수되는지는 1130px 실측 필요 — Task 9에서 브라우저 검증.
- **T9 브라우저 실구동 검증 + 최종 게이트** — `scripts/pw-verify-collab-staging.mjs`(38 시나리오: 설정 패널 스테이징 4종+홈 카드/에디터 탭 재확인 2종+새맵 오우닝 피커)·`scripts/pw-verify-home-filter-responsive.mjs`(22 시나리오: 1440/1130/1000/900px×EN·KO 줄바꿈·오버플로+1130px Clear 활성 케이스) 신규, 전부 실 Chrome+백엔드로 green. **실측으로 발견한 진짜 버그 2건 픽스**(T8에서는 안 잡힘 — 맵 목록이 항상 캐시돼 있던 로컬 조건에서만 우연히 동작했음): ① `filterMode` 측정 effect의 deps가 `[homeView, lang]`뿐이라, 초기 렌더에 `maps`가 아직 비어(`visibleMaps.length===0`) `WelcomePlaceholder`가 뜨는 동안 effect가 null-ref로 조기 반환하고, `maps` 도착 후 필터 행이 처음 마운트돼도 deps 불변이라 다시 안 돎 — `filterMode`가 초기값 "full"에 영구 고정되고 리사이즈도 못 잡는 실사용 버그. `maps.length`를 deps에 추가해 맵 도착 시 effect 재실행하도록 수정(page.tsx). ② 1130px에서 Clear 버튼이 뜨면 그 폭이 가용폭 계산에서 빠져 있어 진짜 가로 오버플로(13.6px) 발생 — `clearBtnRef`를 같은 훅에서 관찰해 `row.clientWidth - (clearWidth + gap)`을 `pickFilterDisplayMode`에 전달하도록 수정, Clear 노출/소멸 시 effect 재부착은 `hasActiveFilter`(기존 JSX 조건 추출·재사용)를 deps에 추가해 해결. 스크립트 자체의 측정 방법도 2건 교정: `row.scrollWidth`는 측정용 invisible 복제(항상 full폭)가 얹혀 오염되므로 가시 버튼 bounding rect 기반 실측으로 대체, `offsetTop` 동일성 대신 세로 중심(`top+height/2`) 비교로 교체(Clear는 패딩 없는 텍스트라 필 버튼과 자연 높이가 달라 같은 줄이어도 offsetTop이 어긋남). 게이트 전부 그린: FE vitest 639·tsc 0·lint 0 error(무관 스크립트 warning 1건 기존)·build OK / BE pytest 1042·ruff 0. dev.db는 두 스크립트 모두 net-zero 설계(스테이징 add/remove는 전부 취소·되돌리기, 새맵 다이얼로그는 Cancel)로 실행 후 원상태 확인.
- **최종 리뷰 픽스 2건** — BE `requires_downgrade_approval` docstring에 FE `forecastStagedOp` 미러 참조 추가(규칙 수정 시 동기화점 명시) · FE collaborators-panel Remove 버튼에 `!isPending` 게이트 추가(pending 행 제거 차단, 저장 시 409 방지). 게이트: BE ruff/pytest 59 green / FE vitest 639·tsc 0·lint 0 error·build OK.

## 2026-08-14 — 협업자 스테이징 UX 7종 설계 스펙 (fix/frontend-minor)
- **구현 플랜**: `docs/superpowers/plans/2026-08-14-collab-staging-ux.md` — 9태스크(TDD·태스크당 커밋·게이트 명시, 브라우저 검증은 Task 9 일괄). 실측 앵커: BE `PendingChangeOut`(schemas.py:184)·pending 직렬화 단일 지점(permissions.py:117)·카드 60px 필 공유 지오메트리·측정 복제 기반 필터 모드 판정.
- **설계 확정·문서화**: `docs/superpowers/specs/2026-08-14-collab-staging-ux-design.md` — ① 스테이지 필 즉시/승인 예고(Zap/Hourglass, FE forecast 미러) ② pending 필 중복 렌더·고정폭 깨짐 픽스 ③ 스테이지 필 호버 캔슬 전환(X버튼 제거) ④ pending 회수(BE `PendingChangeOut.request_id` 추가+기존 철회 API) ⑤ 변경적용→되돌리기(직전 1회 메모리, 확인 모달+역방향 예고) ⑥ 오우닝 부서 피커 조직도 브라우즈(내 부서 3개 고정+들여쓰기 트리) ⑦ 홈 필터 필 3단계 반응형(full/label/icon, 실측 기반). 구현은 `fix/frontend-minor` 워크트리에서.

## 2026-08-14 — 승인 워크플로 코멘트 + 에러 인간화 (feat/approval-comments → dev 머지)
- **전이 코멘트**: submit/approve/publish/withdraw 4단계 선택 코멘트 → 기존 `VersionEvent.note` 재사용(스키마 무변경). 무기록 바로철회(pending·승인 0건)는 submitted 이벤트 하드삭제로 코멘트 자동 동반 삭제 — FE 철회 모달도 같은 조건으로 입력란 숨김(서버·UI 대칭). 에디터·설정 패널 두 마운트 공용 `transitionComment` 1개, 오픈 10곳 전부 리셋.
- **받은함 사유 픽스**: `ApprovalRequest.decision_reason` 컬럼(`_ADDED_COLUMNS` 자동 ALTER) — 비버전 거절도 선택 사유 입력(`isVersion || isApprovalRequest`), reject 시 저장 + 거절 알림 말미 `": {reason}"` 동봉(빌더 3종). 기존엔 입력 사유가 API로 전달되지 않고 유실.
- **에러 인간화 전수**: Group A 28파일 ~50곳 `humanizeApiError` 전환 — 미매핑 폴백만 `(HTTP nnn)` 꼬리표, 원문 JSON은 api.ts throw 2곳 `console.error` 보존, 에러 토스트 톤(XCircle+`border-error`, 성공 토스트 무톤 — onToast prop `(msg, tone?)` 확장). ⚠️ settings 401/403 억제는 문자열 포맷 결합 유지(양단 경고 주석) — status 기반 전환은 후속 결정.
- **거절 배너·코멘트 모달**: 에디터 헤더 배너를 에러 틴트 칩 + 거절자 필(스테일 가드 `workflow.version_id` 대조)로 재디자인(`wf.rejectedBanner`→`wf.rejectedLabel`). 버전 카드 MessageSquare 카운트 버튼(0건 숨김) → 코멘트 이력 모달(`comment-history-modal.tsx`, 클릭점→중앙 확대 `comment-modal-in` 350ms overshoot·바깥 mousedown 즉시 닫힘·Escape·`eventsReloadKey` 액션 후 재조회).
- 검증: 태스크 리뷰 8/8 + 최종 전체 리뷰 승인(머지 가능), BE pytest 1050·ruff 0 / FE lint 0 error·tsc 0·vitest 620·build OK, Playwright+Chrome 실구동 6항목 전판 PASS. 설계·플랜: `docs/superpowers/{specs,plans}/2026-08-14-approval-comments*`.
- **후속(피드백)**: 버전 타임라인(`version-timeline.tsx` — 홈 맵 상세·인스펙터 맵 탭 공용)에도 버전별 코멘트 카운트 버튼(0건 숨김) → 동일 `CommentHistoryModal` 재사용 (dev 직접).
- **후속(피드백)**: 승인 모달에 요청자 제출 코멘트 배너(`requester-comment-banner.tsx` — 최신 submitted 이벤트 note) — 에디터·설정 패널(`ApproveConfirmDialog.submitComment`)·받은함(맵 상세 lazy 조회) 3표면. 에디터 `versions`를 `VersionDetail[]`로 상향(전 지점이 getMap 상세 주입이라 안전) (dev 직접).
- **후속(피드백)**: 반려 모달 3표면에도 요청자 코멘트 배너 + 승인 요청(submit) 모달에 반려 기록 시 이전 반려 배너(에러 톤, 최신 rejected 이벤트 note·반려자 — `findLatestRejection`) (dev 직접).
- **후속(피드백)**: 버전 히스토리 이름 한/영 전환(`useDirectory`+`lang` — ko는 한글명·영문 폴백) + 아이디 hover 0.7초 인물 카드(`person-hover-card.tsx` 공용 — 한/영 이름 치환·`mysingleim://` 메신저 링크·말단 부서+조직 경로 아코디언) (dev 직접).
- **후속(피드백)**: 허용 인원 목록 우클릭 — 인물 행=메신저 보내기·부서/오우닝 카드=조직 정보(에디터 `ContextMenu` 재사용) → `org-info-modal.tsx` 신설(클릭점→중앙 확대·브레드크럼 이동·구성인원 조직장 우선 6.5행 클램프 스크롤·하위 조직 재귀 아코디언, 디렉터리 캐시만 사용) (dev 직접).
- **마이너 픽스 4건**: 타임라인 코멘트 버튼 카드 호버 시에만 노출 · 인물 카드 트리거 호버 어포던스+클릭 즉시 열림 · 호버 카드 포털 이벤트가 React 트리로 버블링돼 버전 카드 접힘/열림 토글되던 것 차단(click/mousedown/keydown stopPropagation) · 멤버 스택 오우닝 부서 행에도 우클릭 조직 정보(부서 행과 동일 카드 인식) (dev 직접).
- **후속(피드백)**: 부서/오우닝 카드 호버 어포던스(링+포인터, 인물 행과 통일) · 버전 카드 우클릭 메뉴(이 버전으로 가기·코멘트 보기 — 비활성 조건 포함) · 타임라인 `group`→`group/vercard` 네임드 그룹(인스펙터 details.group 조상 충돌로 호버 리빌 오작동 교정, R5-2 동일 함정) · 에디터 go-to는 `requestGoToVersion` 가드로 편집 중 전환 확인 모달 유지(`version-switch-confirm.tsx` 공용 추출, VersionPill도 사용) · 인물 우클릭 메뉴에 Info(스탠드얼론 `PersonInfoPopup`, 버블링 차단) (dev 직접).

## 2026-08-14 — QA 문서 정비: ai 2건 삭제·dev-vs-main 로컬 검증·alarm-audit 재검증 부기 (dev 직접)
- **ai-connectivity-test·ai-real-model-smoke 삭제**(사용자 확인 완료분) + `docs/README.md`·`.env.example` 참조 정리.
- **dev-vs-main 체크리스트 로컬 검증**: 카테고리 Add/Rename(트리 반영·`ui-` code)·Delete 기본 동작(연결 맵 거부 사유·묶음 삭제, sqlite) + 샘플 전달물 임포트로 CM-PUR-001 게시 v1·SP 지정·CM-PUR-003 연계 subprocess 임베드 실브라우저 확인 — 남은 미체크는 9910 Postgres FK 재확인뿐.
- **alarm-audit 재검증 부기**: ed15440 감사 이후 해소된 결론 명시(사용자 삭제 API·인당 100캡·sysadmin 퍼지·type 6→18종·checkout 벨 비대칭 해소·create_notifications async).

## 2026-08-14 — 거버넌스 QA 전수 브라우저 검증 + 결함 픽스 4건 (dev 직접)
- **QA 체크리스트 68항목 전수 검증**(P0·C·B·A·R2~R6·회귀) — Playwright+시스템 Chrome, 결정적 QA 시드(O/E/V 3역할·맵 4종·리셋 DB). 전 항목 통과 처리, 백엔드 계약 항목(P0-6·A-3/4/8/10 연쇄)은 API 실호출 검증·항목 비고 부기.
- **발견·픽스 4건**: ① R5-1 Remove 필 상하 6px 커짐(오버레이가 래퍼 라인박스 덮음 → 내부 span 분리, `map-detail-card.tsx`) ② 설정 결재 대기 탭이 실제 승인자에게 미노출(mock permState 게이트 → `listApprovers` 실서버 목록, `settings/page.tsx`) ③ 인박스 배지 첫 폴 X-Dev-User 미주입 레이스(`api.ts` devUser localStorage 부트 시드) ④ 비권한자 에디터 승인 탭 403 무한 재요청 루프+원문 토스트(`pending-approvals-panel.tsx` 조회 게이트+초기 로드 무토스트).
- 관찰(후속 판단): 협업자 패널 pending 행 잠금으로 오너 직접 강등 UI 진입점 없음(백엔드 supersede 계약은 유효). 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R6: 인스펙터 재정비 (feat/governance-r6 → dev 머지)
- **맵 탭**: 버전 선택 행(VersionPill+관리 아이콘)을 승인 탭→맵 탭 최상단으로 이동, 노드 디스플레이(항목 아이콘 5종 추가)/엣지 스타일 섹션 기본 접힘 아코디언화(`useClosingKeys`+`accordion-open/close` 공유 인스턴스).
- **승인 탭 재배치**: 결재 대기(최상단)→드래프트 CTA(드래프트 有=전환/無=생성, 옛 버전 행 자리)→승인 워크플로(접힘 섹션, 헤더에 StatusBadge — `ApprovalPanel hideHeader`로 중복 헤더 제거)→SP 지정→버전 카드. 체크아웃 UI는 draft 전용(rejected 제외 — Withdraw가 draft 복귀+체크아웃 재부여라 막다른 상태 아님).
- **협업자 클램프**: 개인(user) 그룹만 4행 초과 시 3.3행(177px, `clamp-size` 재사용) + 전체 펼치기/접기 토글.
- **SP 카드 버튼 행 통합**: 지정 버튼(`Workflow` 아이콘)+우측 정렬 게시본 가기(`ArrowRight`)/등록 요청(`BadgeCheck`) 한 행, reason은 순수 노트로. R10 계약 무변경.
- 최종 리뷰 Critical 픽스: 접힘 전환으로 `PendingApprovalsPanel` 언마운트→카운트 배지 0 고정 회귀 — 패널 상시 마운트+완전 접힘만 `hidden` 3분기로 복원. QA `## R6` 7항목+문구 교정 3건. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R5: 멤버 행 Remove 필 폴리시 (feat/governance-r5 → dev 머지)
- 사용자 피드백 5건 일괄: 스왑 크기 불변(고정폭 `w-[60px]`을 RoleBadge 신설 `className` prop으로 — `min-w-[72px]` wrapper 폐기)·X 아이콘 제거(문구만)·`invisible`→opacity 페이드(`duration-150`)·행 루트 `group`→`group/member`(인스펙터 `<details.group>` 조상 누수로 전 행 동시 스왑되던 버그 해소)·제거 예정 태그를 소속 줄 우측 2행으로 분리(권한 필 유지, 취소 X 공간 예약+hover 페이드 인). EN `perm.staged.remove` "To remove"→"Remove"(60px 폭 맞춤).
- 브라우저 실측 검증(Playwright+Chrome): bounding box 0px 이동·인스펙터 1행만 스왑·전 역할 우측 정렬 일치. QA R4-4 교정+`## R5` 4항목. 게이트: FE vitest 620·lint 0 error·tsc 0·build OK(백엔드 무변경).

## 2026-08-13 — 거버넌스 R4: 가시성 UX 4건 (feat/governance-r4 → dev 머지)
- **승인자 모달 가시성 배지**: 승인자 관리 모달 우측 상단에 현재 가시성 배지(Globe/Lock, 라이브 state 스레딩).
- **동봉 픽커 드롭다운화**: pill 행 → "공개 범위"(EN "Visibility") 라벨 + 우측 드롭다운(아이콘·current 옵션에 리터럴 "Current" 필). 계약 불변(재선택=해제 포함) — 3표면 배선 무변경. `perm.visibilityCurrent`는 visibility-control 사용처 잔존으로 유지.
- **인스펙터 가시성 3:1 + 워크플로 모달**: 3:1 그리드는 전원 공통, 전환 클릭만 오너 전용 → ConfirmDialog(현재→대상·승인자 이름 필·0명이면 confirm 비활성·조회 실패는 별도 에러) → `requestVisibilityChange`, 409는 humanize+pending 재조회. mapId 전환 시 모달 상태 강제 리셋(stale target 방지). ConfirmDialog `dialogId` optional prop(타 호출부 무변화).
- **멤버 행 제거 hover 스왑**: 카드/인스펙터의 제거 X 폐기 → RoleBadge 자리에 hover/focus 시 빨간 Remove 필 스왑(min-w 72px 실측, opacity/pointer-events 토글로 Tab 도달 유지 — 구 X의 focusable-invisible 결함도 해소). 설정 패널은 select UX 유지·X만 absolute 전환+`pr-8` 공통화로 정렬 교정(사용자 확정 범위).
- QA `docs/qa/governance-ux-checklist.md` R4 섹션 5항목(최종 리뷰가 문구 2건 교정 — 배지 표면·스택 적립 동작). 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R3: 후속 정비 6건 (feat/governance-r3 → dev 머지)
- R2 리뷰 이월분 정비: SP ⓘ 클릭이 접힘 토글 안 함(stopPropagation) · SP 등록 409 문구 i18n(`apiError.spDesignationPending`) · `stageRoleChange`로 원복 선택 시 staged op 소거(no-op 스택 방지, 협업자 패널 — 맵 카드는 role 변경 UI 없음) · 결재 대기 카운트에서 동봉 행 제외(`isBundledRow`, 목록 표시는 유지).
- **새 맵 모달 협업자 팝오버 통일**: `RolePopover`를 `role-popover.tsx`로 공용 추출(무변화 리팩터) 후 create-map-dialog도 클릭 위치 2-step 팝오버+하이라이트+추가 플래시로 전환(role select 폐기, 퍼블릭은 Editor만·2-step 유지). 고아 키 `collaboratorRoleViewerDisabled` 제거.
- **체크아웃 폴 중지**: 본인 강등 pending 409(`PERMISSION_PENDING_DETAIL_PREFIX` 단일 소스) 감지 시 인터벌 정지(첫 폴 실패는 생성 생략). 알려진 한계: pending이 반려로 해소돼도 자동 재개 없음(새로고침/버전 전환으로 재개) — 후속: focus 재시도. `checkout===null` readOnly 미강제는 cosmetic(서버 graph PUT이 비보유자 저장 거부) — 후속 후보.
- QA `docs/qa/governance-ux-checklist.md` R3 섹션 5항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 620·lint 0 error·tsc 0·build OK.

## 2026-08-13 — 거버넌스 R2: QA 피드백 반영 (feat/governance-r2 → dev 머지)
- **pending 가시성·복구**: 행 단위 pending 노출(`PermissionOut.pending_change`·`WorkflowStateOut.bundled_visibility`)로 요청자 아닌 유저에게도 승인 대기 태그(→role·요청자) 표시. `lib/api-errors.ts` `humanizeApiError`(서버 detail 전방일치 10종→i18n) 16개 catch 지점 — 409도 pending 재조회로 마커·철회 버튼 복구(막다른 상태 제거).
- **상호 배제**: 체크아웃 보유자·pending/approved 제출자 대상 권한 변경 차단(오너 직접 적용 포함) ↔ 본인 pending 다운그레이드 시 체크아웃·제출 차단(승인/반려는 무관).
- **전이 다이얼로그 공용화 + pill 동봉**: 버전 전이 5종 다이얼로그를 `components/version/`으로 추출해 설정 패널을 공용 전환(승인자 미표시 표면 드리프트 근본 해소). 동봉 UI는 체크박스→`VisibilityBundlePicker` pill로 3표면(에디터·패널·셀프 게시 팝오버) 통일, 승인 확인 모달에 동봉 변경 내용 공개.
- **스택 저장**: 권한 편집을 두 표면(협업자 패널·맵 카드)에서 적립+Save 일괄/Cancel 폐기(`lib/permission-staging.ts`). Save 부분 실패는 dismissible 인라인 배너(`stagedSaveError`) — 카드 생존(최종 리뷰 픽스).
- **홈/피커**: 맵 탭 협업자 기본 펼침 + 오너 섹션 정렬(`renderMemberRow` 공유, owner 행 불변식 유지). 협업자 추가는 클릭 위치 `RolePopover` 2-step(+선택 하이라이트·staged-add 플래시), `PrincipalPicker` coords/highlightId 하위호환 확장.
- **에디터/SP**: 승인 탭 하단 결재 대기 접이식 섹션+카운트 필(`PendingApprovalsPanel` 재사용). SP 안내 ⓘ 호버 툴팁화+카드 본문 기본 접힘(sessionStorage `bpm.inspector.spOpen`, 3마운트 공유). SP reason 행 액션 2종 — 게시본 가기(`switchVersion`)·등록 요청(pending이면 disabled+요청자/시각 툴팁, `disabledReasonKind` 분기).
- QA: `docs/qa/governance-ux-checklist.md` R2 섹션 16항목. 게이트: BE pytest 1042·ruff 0 / FE vitest 617·lint 0 error·tsc 0·build OK. origin/dev 2c3170e 푸시 완료.

## 2026-08-13 — 관리자 UX: 동기화 로딩·테이블 CSV (feat/admin-sync-csv → dev 머지)
- **인원 동기화 로딩**: sync 버튼 Loader2 스피너 + busy가 후속 재조회까지 커버(재조회 실패는 err.message로 전파 — 삼킴 제거).
- **관리자 테이블 CSV 내보내기**: 공용 `lib/csv.ts`(escapeCsvCell — **수식 인젝션 가드**('=+-@탭CR' 시작 셀 ' 접두, 보안 리뷰 반영)·buildCsv CRLF·downloadCsv BOM `\uFEFF` 이스케이프 접두) + `ExportCsvButton` → employees/departments/notices 3표(화면 동일 컬럼·전체 데이터). DB 테이블 뷰어는 신설 `GET /api/admin/tables/{name}/export`(sysadmin·read_table 미러·**PK 타이브레이커 정렬**·500행 스트리밍·JSON 셀 json.dumps·BOM 미부착)로 현재 정렬/필터 그대로 전체 내보내기 — 모든 원시 테이블 커버.
- **계약**: FE `escapeCsvCell` ↔ BE `_escape_csv_cell` 동치 유지(파리티 테스트로 고정), BOM 접두는 FE downloadCsv 단일 지점. 게이트: BE pytest 1036·ruff 0 / FE vitest 606·lint 0 error·tsc 0·build OK. origin 푸시 대기.

## 2026-08-12~13 — 거버넌스 UX 확장 4페이즈 (feat/governance-ux → dev 머지)
- **설계 재검토**(docs/design/2026-08-08-governance-ux-design.md 개정): 코드 실측으로 P0 선행 정비 신설, B 게이트 editor 확정, C는 red dot→count pill+top-nav 배지, 구현 순서 P0→C→B→A.
- **P0 라이프사이클 대칭화**: visibility/permission 요청에 중복 409·요청자 withdraw(DELETE /approval-requests/{id})·직접 적용 supersede(+알림), 소프트삭제 스윕 통일(_get_map_or_404·inbox block3·sysadmin 큐), 승인자0 409, FE pending 마커 새로고침 복원+철회 버튼.
- **C 승인 탭 통합**: per-map 목록 게이트 오너 확대(_assert_owner_or_approver), PendingApprovalsPanel 4종 전종+행별 결정권(rename/sp=오너·나머지=승인자), 좌측 레일·top-nav 인박스 pending 카운트 배지(InboxBadge 15s 폴링).
- **B 카드 멤버 편집**: AddCollaborator 추출 재사용, map-detail-card에 editor+ 게이트 추가/제거(owner·오우닝 부서 행 보호, 강등은 승인 경유+pending 배지).
- **A 게시 동봉**: submit에 to_visibility 동봉(SubmitIn, payload.version_id 링크 — DDL 무변경) → 버전 만장일치 편승, publish 시 _apply_request 재사용 적용, reject/withdraw/delete_version 연쇄 종결, 직접 decide·withdraw 409, standalone pending은 동봉이 supersede. FE 3표면(에디터 모달·설정 패널·셀프 게시 팝오버) 체크박스 — **오너 전용**(최종 리뷰가 에디터 우회 적발→게이트 봉쇄), 결재 대기 행은 "Decided with version approval" 읽기전용.
- **최종 전체 리뷰**(opus)에서 Critical 1(동봉 오너 게이트 우회)+Important 3(범용 철회·sysadmin 큐·approved 버전 삭제 고아화) 적발→픽스웨이브로 봉쇄. QA: `docs/qa/governance-ux-checklist.md`(P0 7·C 5·B 5·A 11·회귀 4). 게이트 최종: BE pytest 1028·ruff 0 / FE vitest 599·lint 0 error·tsc 0·build OK. 사용자 실검증(9910)·origin 푸시 대기.

## 2026-08-12 — 9910 검증 반영 + 관리 탭 후속 2종
- 검증: 멱등 재실행·카테고리 관리·홈 노출·회귀 스팟 사용자 확인 완료(잔여: CM-PUR-001 연계 SP 노드 1건). 오우닝 부서장 자동핀은 **보류 결정**(현행 유지).
- **Move 모달 트리화**: 캐스케이드 → 지정 모달과 동일한 조직도식 트리(루트 행·자기 서브트리 숨김·깊이 초과 위치 비활성·잔여 422는 인라인 표시 — 블러 뒤 토스트 안 보이던 문제 해소). category-cascade 헬퍼 완전 폐기.
- **삭제 묶음 정책**: 서브트리에 연결 맵 1개라도 있으면 409, 없으면 하위 카테고리까지 통째 삭제. 게이트 BE 997·FE 598·admin 스모크 11/11·move 검증 8/8.
- **묶음 삭제 500 픽스(9910 실측)**: ORM 개별 delete는 플러시 순서 비보장 → 부모 선삭제 시 Postgres 자기참조 FK 즉시 강제로 IntegrityError(sqlite는 FK 미강제라 로컬 무재현). 레벨 역순 명시적 벌크 DELETE로 교체, 3레벨 회귀 테스트.

## 2026-08-08~12 — 컨설턴트 전사 체계 수용 + 홈 프레임워크 UX (feat/consultant-hierarchy → dev 머지·푸시)
- **Phase 1**(스키마·canonical 파서·멱등 임포트 엔진+CLI — uuid id+`source_node_id` 계보, 부분 재전달 연계 승계) → **Phase 2**(카테고리 lazy API·홈 Framework 토글+트리·상세 뱃지/I/O·연결/이양) → **Framework 관리 탭**(카테고리 CRUD+웹 JSON 대량 임포트 — 이제 기본 경로, 재임포트 시 전체 level BFS 재계산) → **홈 뷰 UX**(검색/필터 공유·원클릭 캐스케이드·펼침/리스트 영속·틴트 박스·3.5 클램프(숨김 스크롤바·내부 스크롤)·펼침/접힘 애니(고스트 렌더)·스티키 헤더·카드 이름 클릭=선택+호버 Open) → **지정 모달 조직도식 트리**(리프만 선택) → 상세 카테고리 필 최상단 행.
- 조직 기준 전환(dept_info→departments·EDW 직책) 후속 통합 — `import_consultant`를 orgchart resolver로 정합(피커·검증과 단일 소스), 9910 픽스(has_org_info·한/영 트리·단절 체인 폴백 등).
- 게이트 최종: BE pytest 997·ruff 0 / FE vitest 600·tsc·lint 0·build OK / 실브라우저 스모크 framework 25/25·home-dept 23/23·admin 11/11·지정 모달 6/6. **웹 임포트·슬롯 이양 사용자 실검증 완료(2026-08-12).** 남은 것: `docs/qa/dev-vs-main-checklist.md` 미체크 4항목 → main 머지·운영 배포.

## 2026-08-10 — 사용자·조직도 소스 교체(AD→n8n HR 웹훅, dev 머지)
- employees 단일 소스를 AD→n8n HR 웹훅으로 교체(`app/hr/` 클라이언트+sync 코어+내장 스케줄러), LDAP은 title 전용 패스로 축소. 퇴직자 active=false+피커/디렉터리 제외, email 모델 제거(운영 NOT NULL 완화 부트스트랩), departments 미러 신설, 드라이런 프리뷰+삭제 20% 상한 가드. 잔여 후속은 체크리스트 백로그 1~6.


## ── 2026-08-12 이동분 (PROGRESS 경량화 — 원문 그대로) ──

## 2026-08-11 — 조직 기준 전환(dept_info → departments) 설계
- **검토 문서 갱신(사용자 실검증 반영)**: 웹 임포트(자작 json/jsonl)·슬롯 이양 확인 완료로 체크, "알려진 한계·후속 트랙" 섹션 신설(승인 워크플로/거버넌스 UX 별도 트랙·재임포트 덮어쓰기 정책·rows 500캡·KB 백필·스케일 하드닝·Move 모달 캐스케이드 잔존).
- **상세 카드 카테고리 필 최상단 행 분리**: 우측 필 무리가 shrink-0라 긴 L1~L5 경로가 타이틀을 세로로 쥐어짜던 것 → category_path 있으면 헤더 위 전용 행(max-w-full+truncate+title 툴팁), 미연결 유령 필(오너)은 기존 우측 위치 유지. 실측 타이틀 1줄(21px) 복원.
- **업무 체계 지정 모달 조직도식 트리 개편**: 캐스케이드 셀렉트 N개 → lazy 트리(framework-assign-modal) — **리프(child_count 0)만 선택 가능**(상위 클릭=펼침/접힘), 선택 행 accent 틴트+체크 강조, 미선택 시 연결 버튼 비활성, 현재 지정 체인은 getCategoryChain으로 프리펼침+리프면 프리선택. 캐스케이드 시딩 헬퍼(seedChainIds/seedLevelParents)는 고아화로 제거(pickCascadeLevel은 관리자 Move 모달이 계속 사용). 브라우저 검증 6/6(프리펼침·강조·상위 선택불가·선택 이동·재지정 왕복). 비고: 기존에 비-리프에 지정된 맵은 재지정 시 리프를 골라야 함(의도).
- **홈 리스트 후속 2차(스크롤바 숨김·접힘 애니·클램프 전환·카드 이름 클릭 교정)**: ① 클램프 스크롤바 숨김+`overflow-x-hidden`(폭 밀림·우측 이탈 방지), overscroll-contain 제거(끝 도달 시 바깥 목록으로 자연 체이닝) ② 접힘도 `accordion-close`(고스트 렌더 — **상태·영속은 즉시 커밋**, 지연 커밋은 그 사이 리로드에 접힘 유실: 기존 스모크가 적발) ③ Show all↔Collapse 높이 전환 `clamp-size`(interpolate-size, max-content↔px) ④ **grid 래퍼 min-width:0 필수** — 없으면 카드 truncate가 막혀 긴 이름 리스트가 틴트 박스 우측을 138px 뚫음(나의 부서에서 재현·수정) ⑤ 맵 카드 이름 클릭=선택으로 통일(오클릭 방지), 에디터 이동은 호버 시 권한 필 앞 ↗ Open 버튼(기존 `home.openMap` 키 재사용). 스모크 25/25·23/23.
- **홈 리스트 후속 4종(내부 스크롤·펼침 애니메이션·스티키 헤더·즐겨찾기 소급)**: ① 클램프 영역 `overflow-y-auto`+`overscroll-contain`(휠이 올라간 영역만 스크롤, 바깥 전파 차단) ② 아코디언 펼침 진입 애니메이션 `accordion-open`(grid 0fr→1fr 300ms — 높이 측정 불요, overflow는 keyframe 안에서만 hidden이라 종료 후 그림자/링 안 잘림, reduced-motion 가드) ③ 틴트 박스 헤더 공용 `StickyBoxHeader`(sticky top-0, 전체 펼침 상태면 우측 Collapse 버튼) ④ 나의 부서 즐겨찾기에 클램프·영속(`bpm.home.favListExpand`)·애니·스티키 전부 소급. 함정: ClampedList 스크롤 래퍼 data-id(`…-scroll`)가 버튼 프리픽스 셀렉터에 걸림 → 스모크는 `button[data-id^=…]`로 한정. 스모크 23/23·home-dept 23/23.
- **홈 리스트 가시성 2종(틴트 박스·3.5개 클램프)**: ① Framework 트리도 부서 목록처럼 직접 보유 맵 카테고리를 `DeptGroupBox` 틴트 박스로(자식은 박스 밖·중첩 금지, `dataId` prop만 추가해 재사용) ② 두 뷰 맵 리스트에 공용 `ClampedList` — 4개+ 목록은 3.5개 높이(카드 실측 77px 기준)로 잘리고 풀폭 쉐브론 "Show all (n)"/"Collapse" 토글, 상태는 부서=`bpm.home.deptListExpand`·framework=`bpm.framework.tree` 블롭 확장으로 영속(구버전 블롭 호환). 스모크 18/18(+박스·클램프·영속 4체크)·home-dept 23/23. 주의: 시드에서 직접 맵 4+ 리스트는 미지정 섹션뿐(Growth Center는 하위 오피스 소유라 클램프 무관).
- **홈 Framework 뷰 UX 3종(검색·필터 공유/원클릭 캐스케이드/펼침 영속)**: ① 검색·가시성·상태·역할 필터를 두 뷰 공용으로 승격(owning/SP는 부서 뷰 전용 선별) — 검색은 공용 플랫 리스트 전환, 필터는 로드된 카드에 클라 적용+"{n} filtered out" 노트(카운트 태그는 전체 기준) ② 카테고리 첫 펼침 시 map_count>0 가지를 예산 40 내 자동 재귀 펼침(재펼침은 사용자 상태 존중) ③ openIds를 `bpm.framework.tree` localStorage 영속 — 뒤로가기/새로고침/검색 해제 리마운트에 복원(StrictMode 이중실행·persist 선실행 가드). BE 무변경. vitest 602·스모크 framework 14/14·home-dept 23/23.
- **Framework Admin UI 완료(카테고리 관리 + 웹 임포트)**: 설정에 sysadmin **Framework 탭** 신설 — ① 카테고리 CRUD(`POST/PATCH/DELETE /api/categories`: 생성 `ui-` 자동채번·이동 자손가드+서브트리 level 재계산·삭제 자식/맵 가드) + 관리 트리 UI ② 웹 JSON 대량 임포트(`POST /api/categories/import` — CLI 엔진 `import_delivery` 재사용, dry-run 미영속·rows 500캡·파일 파서 `framework-import-parse.ts`) → Dry-run 리포트 → Apply. 리뷰가 잡아 고친 핵심: 캐스케이드 재선택 버그(원본 assign 모달 포함)·임포트 파일선택 레이스·warnings 언더카운트(summary["warning"] 서버 집계)·**재임포트 시 UI 생성 카테고리 level 미재계산(전체 BFS 도입)**·트리 stale 캐시·트리 순회 사이클 가드. 체크리스트 쉬운 판 재작성(n8n 완료 전제)+9910 가이드 웹 임포트 우선+설계 §6 개정. 게이트 BE pytest 997·ruff 0 / FE tsc·lint 0·vitest 599·build OK / 브라우저 스모크 admin 11/11·home 8/8.
- 9910 가이드에 컨설턴트 임포트 CLI 절차 추가 — Framework 검증 항목이 데이터 시드 단계 없이 UI 확인만 요구해 "임포트 수단이 없다" 혼선 유발(임포트는 설계상 UI 없는 관리자 CLI).
- **템플릿 룰 동기화**(claude-code-template 8/1 개정 반영): guidelines Claude 5 튜닝(ask-first 축소, §1 표가 단일 기준)·git.md 커밋 전 체크 확장(PROGRESS 1–3줄 맥락 위주·README는 영향 섹션만·브랜치 머지 시 PROGRESS 압축)·`rules/frontend/identifiers.md` 신설 — 템플릿의 `data-testid`는 기존 컨벤션 `data-id`(450+곳)로 속성명만 유지.
- **컨설턴트 임포트 orgchart resolver 정합**: `import_consultant.py`의 부서 유효 집합·오너 org 폴백이 raw org_l 인라인 조합으로 남아 조직 기준 전환 스윕에서 누락돼 있던 것(체인 해석·새니타이즈·상위 트림 미반영 → 서버에서 owning 고아 경로 위험) → `orgchart.load_valid_org_prefixes`+`resolve_org_path`로 통일(피커·maps 검증과 단일 소스), 체인+트림 회귀 가드 테스트 추가. BE 982(+1)·ruff 0.
- **9910 픽스 4차**: ① org 정보 전무 직원(org_l1~l5 전부 빈 + 체인 불가) 예외처리 — `has_org_info` 신설, department 단독 가짜 경로를 트리·유효 경로·directory 파생에서 제외(권한 판정·개인 표시는 불변) ② 홈 부서 트리 한/영 연동 — ko 모드는 departments.name_ko 우선 표기. BE 981·FE 그린.
- 단절 체인 폴백: 부모 dept_code가 미러에 없으면(부서 피드 불완전) 부분 경로 대신 org 컬럼 폴백 — 인원 있는 고아 루트 노드의 범인(최종리뷰 백로그 #10 해소). BE 980(+1).
- EDW positions 타임아웃 30→180초 — 9910 실측 뷰 스캔 지연으로 타임아웃 발생.
- **9910 검증 픽스 3차**: ① 관리 부서 트리의 고아 루트 노드 — 퇴사자(active=false, 부서 정보 미갱신) 스테일 경로가 부서 목록에 새던 것 → `get_admin_users` 부서 파생을 active 직원 경로만으로(users 목록은 전체 유지) ② n8n hr-position 쿼리 — 제외 직책 확장(프로·담당과장·계약직사원·담당임원), NAME 컬럼 제거(n8n 마스킹 [object Object]). BE 979(+1)·ruff 0.
- **9910 검증 픽스 2차**: ① 부서명 내 "/"(AX/PI Department·ADC T/F) 경로 파손 — `orgchart.sanitize_org_segment`(전각 슬래시 치환)를 체인 해석·폴백·name_ko 키에 적용 ② inactive만 남은 부서는 선택지·remap에서 자동 제외(`load_valid_org_prefixes(active_only=)` — 오우닝 *검증*은 관대 유지, conftest 앵커 보존) ③ position 미입력 진단 — AD 패스 로그(사용자·사번 수)+`position_unmatched_sample`(≤10) 요약 노출·sync 버튼 메시지에 표시 ④ 부서 탭 개편 — 테이블을 조직도 트리(들여쓰기·접기)로, 소멸 부서 재지정 대상은 드롭다운 대신 **트리 모달**(`dept-tree-picker`, active 부서만·검색) ⑤ org 디버그 토글·열 제거. 게이트 BE 978·ruff 0·FE tsc/lint/vitest 589/build 그린.
- dept-remap에 오우닝 부서 포함: 목록 집계(`owning_maps`)·이관(단일 컬럼 치환, 소프트삭제 포함) 확장 — 홈 "내 부서" 트리는 owning_department 기준이라 빠지면 이관해도 맵이 미아로 남음(9910 적발). FE 카운트 표기·i18n 동기. BE 974(+1)·ruff 0·FE 그린.
- 홈 맵 필터에 SP 여부 추가: 상태·권한·오우닝 옆 4번째 드롭다운(`home-sp-filter`) — SP maps/Non-SP maps(`sp_designated_at` 기준), 세션 영속·Clear 연동. FE tsc/lint/vitest 589/build 그린.
- **9910 검증 픽스 4종**: ① EDW 뷰 부서코드 컬럼 DEPTCO→**DEPTCD** 정정(n8n 워크플로 JSON·문서) ② 조직 최상위 2레벨(법인·사업부급) 해석 제외 — `settings.org_trim_levels=2`, departments 체인 해석 전용(org 컬럼·폴백 원본 보존) ③ 오우닝 부서 검증(maps `_assert_known_department`)이 org 컬럼 인라인 조합이라 피커(체인 경로)와 불일치 → 신설 `orgchart.load_valid_org_prefixes` 공용 헬퍼로 통일(unknown department 422 해소, admin dept-remap도 위임) ④ 어드민 테이블 뷰어 kb_chunks 500 — LargeBinary 셀을 크기 표시로 직렬화. 게이트 BE 973(+4)·ruff 0.
- 9910 검증 가이드 갱신: [`docs/deploy/db-migration-9910.md`](docs/deploy/db-migration-9910.md) — 운영(main) DB 복사→dev 60ba560 검증 절차 8월판(스키마 델타 표·n8n hr-dept URL 실측/hr-position 임포트 상세·HR §9 이행 리허설·EDW 직책 검증·운영 승격 절차).
- dev↔main 미반영 체크리스트 신설: [`docs/qa/dev-vs-main-checklist.md`](docs/qa/dev-vs-main-checklist.md) — 3묶음(1423f41·953d5cb·60ba560) 배포 통합 순서·서버 확인 항목·백로그 12건(설계 문서 링크로 중복 제거).
- **Task 10 완료(최종 게이트+브라우저 스모크)**: 전체 게이트 BE pytest 968/968·ruff 0 / FE tsc 0·lint 0 errors·vitest 608/608·build OK. 로컬 브라우저 스모크(:8901/:3200, 전용 `smoke_dept.db`+departments 2계층·position="팀장" 리더 추가 시드, playwright-core+시스템 Chrome) 5시나리오 전량 관찰 완료: ① Departments 탭 고아 섹션 없음(정상)·`dept-table-scroll` max-height 540px(60vh)·`dept-manager-cell` 부재 ② Employees 탭 `kr-add-btn` 부재+노출 직책 카드(기본 4직책 체크) ③ 협업자 피커 "Smoke Team(스모크팀)" 영/한 병기 정상 ④ `/api/me` manager_ids=["smoke.leader"] + 승인자 피커 브라우즈 최상단 Manager 배지 렌더 확인 ⑤ RosterHover 툴팁이 `dept-table-scroll`의 `overflow-y-auto`에 스크롤 하단 근처 행에서 실제로 시각 클리핑됨을 실측 확인(Task 8 watch 항목, 픽스 없이 관찰만 기록). 코드 결함 0건 — 리뷰용 코드 변경 없음. 상세: `.superpowers/sdd/2026-08-11-departments-org-basis/task-10-report.md`.
- 구현 플랜 v2 작성: [`docs/superpowers/plans/2026-08-11-departments-org-basis.md`](docs/superpowers/plans/2026-08-11-departments-org-basis.md) — 10태스크(v1 셔리픽 2건 재사용 → EDW positions 파이프라인 → allowlist+me 체인 → 표시/판정 전환 → dept_info 제거 → FE 4태스크 → 게이트).
- **설계 v2 개정**: EDW에 사번 키 DEPTCD·직책(FRNM) 뷰 발견 → v1의 AD manager DN 역추적 폐기, **EDW 직책 기반 부서장 모델**로 재설계(n8n `hr-position` 워크플로 JSON 신설 `docs/deploy/n8n/hr-position-workflow.json`, AD employeeNumber 사번 매핑→`employees.position`, 노출 직책 allowlist=app_settings, Manager 태그=부서 체인 직책 보유자). v1 구현 4태스크는 `backup/dept-basis-v1-impl` 보존·코드 리셋.
- 설계서 신설: [`docs/design/2026-08-11-departments-org-basis-design.md`](docs/design/2026-08-11-departments-org-basis-design.md). 경로 해석 계층 `app/orgchart.py`(dept_code→departments 부모 체인, org_l1~l5 폴백)로 권한 판정·조직도·한글명 소스를 departments로 단일화, dept_info 소비 전제거(임포트 API 2종 삭제·모델 삭제·테이블 잔류), AD `manager` 속성 역추적(`employees.manager_login_id`, DN 매칭+CN 사번 폴백)으로 피커 Manager 태그를 개인 체인 2단계로 재정의, 부서관리 고아 재지정 섹션 상단 이동+테이블 스크롤 격리. 결정: principal 경로 문자열 유지·빈 부서 숨김·임포트 API까지 제거.
- **Task 1 완료**: `app/orgchart.py` 경로 해석기 신설(체인·폴백·가드) + 단위테스트. `DeptIndex`/`load_dept_index`/`resolve_org_path`/`resolve_org_prefixes` — dept_code 부모 체인 우선, 코드 부재·스테일·사이클·전빈 이름은 org_l1~l5 폴백(불변식: departments 빈 환경=현행 동작 그대로). 이 태스크는 모듈+테스트만, 기존 소비처 무변경. `tests/test_orgchart.py` 8케이스(conftest에 raw AsyncSession 픽스처가 없어 `test_sp_params.py`의 동기 래핑 `session` 컨벤션으로 `load_dept_index` 검증). 게이트: BE pytest 959(951+8)·ruff 0.
- **Task 2 완료(v1 Task 3 셔리픽)**: 권한 판정·`/api/me`를 `orgchart.resolve_org_path`로 전환 — `permissions/access.py` 3곳(`get_effective_role`·`get_eligible_users`(루프 전 인덱스 1회 로드)·`can_view_dashboard_db`)과 `main.py`의 `/api/me` `org_path` 산출을 org 컬럼 직접 조합에서 resolver 호출로 교체(`main.py`의 미사용 `logic.org_path` 임포트 정리, `access.py`의 `logic.org_path` 호출 전량 제거 — 다른 라우터의 `logic.org_path` 사용처는 범위 밖이라 무변경). 신규 `tests/test_orgchart_permissions.py` 2케이스: 부서 grant 판정이 org 컬럼이 아니라 dept_code 체인을 쓰는지 증명(레거시 org 컬럼과 무관한 부서로 grant해도 통과) + dept_code 미설정 직원은 기존과 동일하게 org 컬럼 폴백(불변식). 게이트: BE pytest 961(959+2, 기존 무수정 전량 통과)·ruff 0.
- **Task 3 완료**: EDW positions 백엔드 파이프라인 — `hr/client.py`에 `RawHrPosition`·`parse_position_row`·`fetch_positions`(n8n `N8N_POSITION_URL`, 토큰은 `n8n_hr_token` 공용, `_post`에 `url` 파라미터 추가·기존 호출부 무변경) 신설. `ad/client.py` `RawUser.employee_number`(AD `employeeNumber`) 추가. `ad/service.py`의 `refresh_titles`를 `refresh_titles_and_positions`로 확장 — employeeNumber로 EDW `empId`(사번) 매핑해 `employees.position`(신규 컬럼) 갱신, 사번 중복은 매핑 불가 처리, 목록 밖 기존 보유자는 NULL 소거(단 positions 빈 리스트면 소거 스킵 — 빈 피드 전멸 방어). `hr/service.py` `sync_all`이 `position_enabled`면 `fetch_positions` 호출 후 확장 패스로 전달, `HrSyncSummary`/`SyncSummaryOut`에 `position_refreshed`/`position_unmatched` 노출. TDD 7케이스+회귀(정상 매핑·중복 사번 unmatched·미해석 사번이 매칭된 타 직원 안 건드림·소거·빈 피드 소거 스킵·전부 unmatched여도 소거 실행(설계 §4-2 극단 케이스 채택, 브리프 그대로)·title 회귀). 게이트: BE pytest 970(961+9)·ruff 0.
- **Task 3 리뷰 픽스**: Important 2건 — ① 소거 대상 조회의 `not_in(matched)` 바인드 폭발(부서장 수만큼 파라미터 전개, 999 넘으면 `OperationalError`→title까지 유실 위험)을 `position IS NOT NULL` 무바인드 조회+파이썬 차집합으로 교체(`ad/service.py`) ② 테스트 갭 2건 추가(EDW fetch 실패 시 title만 갱신·소거 스킵 / `position_enabled=False`면 `fetch_positions` 미호출, 스파이 카운터로 단언). Minor 4건(카운터 분리·URL 폴백·isinstance 중복·사번 zero-padding)은 컨트롤러 지시대로 유예 기록만. 게이트: BE pytest 972(970+2)·ruff 0.
- **Task 4 완료**: 노출 직책 allowlist(`app_settings.py` `exposed_positions`, 기본 `["그룹장","파트장","팀장","센터장"]`, 저장된 빈 목록은 그대로 존중) + `GET/PUT /api/admin/app-settings`에 `exposed_positions`(저장)·`available_positions`(읽기전용 distinct) 노출. `/api/me` `manager_ids`를 dept_info 부서장 체인에서 **departments dept_code 체인(리프→루트)의 노출 직책 보유자**로 교체(`main.py`, `DeptInfo` 임포트 제거 — 이 파일 마지막 사용처). 기존 dept_info 기반 단언 테스트 2건(`test_employees.py::test_me_includes_manager_ids_chain`, `test_dept_info.py::test_dept_info_accepts_parent_org_levels` 독스트링)을 새 의미로 갱신. 신규 `tests/test_me_manager_chain.py` 5케이스. 게이트: BE pytest 977(972+5)·ruff 0.
- **Task 5 완료**: 표시·목록 소비처(`directory.py`·`admin.py`(`get_admin_users`·`_load_valid_org_paths`)·`dashboard.py`(`_resolve_display_name`·coverage 한글맵)·`versions.py` eligible-assignees)의 한글 부서명 소스를 `dept_info` 조인에서 `orgchart.load_dept_index().name_ko_by_name`(departments)로 교체, `manager` 필드 스키마 3곳(`DirectoryDeptOut`·`AdminDeptOut`·`DeptInfoValueOut`) 삭제. `DirectoryUserOut.position` 신설(노출 직책 allowlist 필터 — FE Task 7·9 소비). 잔여 판정 4파일(`library.py`·`maps.py`의 `list_maps`·`list_eligible_approvers`·`list_editors`·`groups.py` `_emp_org_path`·`categories.py`)의 `logic.org_path` 호출 6곳을 `resolve_org_path`로 전량 교체(다수 루프 2곳은 인덱스 1회 로드, access.py와 동일 패턴). `admin.py`의 `PUT /admin/dept-info`(dept_info 임포트)는 Task 6 대상이라 무변경 — 그 잔존으로 `git grep DeptInfo backend/app/routers`는 0건이 아님(admin.py 3곳·versions.py의 `DeptInfoValueOut` 스키마명, 둘 다 의도됨). 기존 dept_info 시드 단언 6건을 departments 시드 또는 어드민 테이블 뷰어(`GET /admin/tables/dept_info`) 직접조회로 갱신 — 경로 판정 관련 기존 테스트는 전량 무수정 그린(폴백 불변식 회귀 증거). 신규 3케이스(directory position allowlist·admin korean_name·dashboard department display_name). 게이트: BE pytest 980(977+3)·ruff 0.
- **Task 6 완료**: `dept_info` 소비·임포트 API 전제거 — `models.py` `DeptInfo` 클래스 삭제(운영 테이블은 잔류, DDL 무추가), `PUT /api/admin/dept-info`(`routers/admin.py`)·`PUT /api/employees/korean-names`(`routers/employees.py`) 엔드포인트 삭제, `schemas.py`의 `DeptInfoImportIn/Out`·`DeptInfoEntryIn`·`KoreanNamesImportIn/Out`·`KoreanNameEntryIn`·`SyncSummaryOut/HrSyncPreviewOut.dept_info_orphans` 삭제(`DeptInfoValueOut`는 eligible-assignees 응답 형태로 유지), `hr/service.py`의 `_find_dept_info_orphans`+호출 2곳+summary/preview 필드 삭제. 임포트 전용 테스트 파일 `test_dept_info.py` 삭제, `test_korean_names.py`는 비-임포트 케이스(`test_employees_include_korean_fields`)만 남기고 임포트 케이스 전량 삭제, 양쪽에 라우트 부재 확인 테스트 신설(실행 확정 결과 둘 다 404). `test_hr_sync.py`의 dept_info 고아 리포트 테스트를 `DeptInfo` 시드 없는 `departments` 미러 단독 검증으로 재작성, `test_hr_endpoints.py`의 `dept_info_orphans` 단언 제거. `git grep DeptInfo backend/app` = `DeptInfoValueOut` 뿐(의도). 게이트: BE pytest 968(980-14 삭제+2 신규 route-absence)·ruff 0.
- **Task 7 완료**: FE `api.ts`·`korean-dept.ts`·`principal-picker.tsx`를 백엔드 새 계약(Task 1~6)에 맞춰 정리 — `SyncSummary.dept_info_orphans` 삭제+`position_refreshed`/`position_unmatched` 추가, `DirectoryDept`/`AdminDept.manager` 삭제, `DirectoryUser.position?` 추가, eligible `dept_infos` 타입에서 `manager` 삭제, `importKoreanNames`/`importDeptInfo`+요약 타입 삭제, `AppSettings`/`putAppSettings`에 `exposed_positions`+읽기전용 `available_positions` 추가(백엔드 `app_settings.py`/`schemas.py` 실계약 대조). `buildDepartmentOptions`·`PrincipalOption`의 manager 키워드/필드 제거(Manager 태그·정렬 로직은 무변경 — 개인 체인 기반이라 이번 변경과 무관). `korean-dept.test.ts` manager 단언 3건을 korean_name 전용으로 갱신, `csv-import.test.ts`의 `DirectoryDept` 픽스처에서 `manager` 제거(타입 변경의 직접 파생 — csv-import.ts 본체의 `dept_infos` 타입은 원래 `korean_name`만이라 무변경). 게이트: FE vitest 605/605·lint 0. **스코프 정정(컨트롤러 판정, 플랜 개정 반영)**: 잔존 tsc 23건 중 5파일(`group-detail.tsx`·`groups-panel.tsx`·`collaborators-panel.tsx`·`create-map-dialog.tsx`·`map-details-panel.tsx`)은 Task 8/9가 아니라 Task 7 누락분으로 재분류돼 이 태스크에서 마저 정리 — 전부 `Department.manager`(picker 검색 키워드용 합성 필드, principal-picker.tsx가 이미 미소비) 또는 `DirectoryDept.manager`(백엔드가 이미 안 보내던 필드) 참조 제거이며 **동작 무변경**(create-map-dialog.tsx의 오우닝 부서 리더 자동승인자 추가/피커 핀 기능은 이미 백엔드 Task 5부터 조용히 no-op이던 상태 — `owningLeaderId` 상시 null로 확정해 타입만 정리, 새 회귀 아님). 게이트: FE vitest 605/605·lint 0. **tsc 잔존 7건은 Task 8/9 대상 3파일**(department-table.tsx·korean-name-modal.tsx·dept-info-modal.tsx, 모달 삭제 대상)로만 한정.
- **Task 8 완료**: JSON 임포트 모달 2개(`korean-name-modal.tsx`·`dept-info-modal.tsx`) 삭제 — `employee-table.tsx`에서 `KoreanNameModal`·`showKrModal`·`kr-add-btn` 제거, `department-table.tsx`에서 `DeptInfoModal`·`showImportModal`·`dept-info-add-btn` 제거. 부서 테이블 재배치: 소멸 부서 재지정 카드(`dept-remap-card`)를 테이블 위로 이동, `<TableCard>`를 `max-h-[60vh] overflow-y-auto` 래퍼(`dept-table-scroll`)로 감싸 스크롤 격리, Manager 열(th+`dept-manager-cell`) 삭제(`colCount = showOrg ? 2 + maxOrgDepth : 3`). i18n에서 모달 전용 키 23개(`admin.kr*`·`admin.deptInfo*`·`admin.deptManagerCol`) EN/KO 양쪽 삭제(전량 타 사용처 없음, `git grep` 확인). 게이트: FE **tsc --noEmit 0**(태스크 목표 전체 그린 달성)·lint 0 에러(미관련 사전 경고 1건 무변경)·vitest 605/605.
- **Task 9 완료**: `employee-table.tsx`에 노출 직책 카드(`exposed-positions-card`) 신설 — `available_positions` 체크박스(현 `exposed_positions` 체크 상태 + available에 없는 기존 exposed 항목도 유지 표시) + Save(PUT), 둘 다 빈 경우 빈 상태 문구. `korean-dept.ts`에 `formatTitleWithPosition`(title·position 병기, 한쪽만 있으면 그 값만) 신설해 `user-hover-card.tsx` title 라인과 `map-detail-card.tsx` `titleById` 구성부(`dir.users` 맵핑) 2곳에 적용 — 백엔드 allowlist 필터를 신뢰하고 FE는 존재 여부만 판단. i18n 신규 5키 EN/KO. 게이트: FE tsc 0·lint 0 에러(미관련 사전 경고 1건 무변경)·vitest 608/608(605+3 신규)·build OK.
- **최종 리뷰 픽스 완료**: 3건 — ① `ad/service.py` `refresh_titles_and_positions`에 AD employeeNumber 전멸(`empno_to_sam` 빈 dict) 가드 추가(EDW 정상인데 매칭 전멸로 기존 position 보유자 전원 소거되던 사고 방지, `logger.warning`+unmatched=전체로 스킵), 신규 테스트 1건+기존 극단케이스 테스트 독스트링 정정 ② `department-table.tsx`의 `RosterHover`를 `dept-table-scroll`(60vh 스크롤 클립) 하단 행에서 잘리던 `absolute` 툴팁→`createPortal(document.body)`+`fixed` 좌표(search-select.tsx 패턴)로 전환, pt-1 브리지는 cancel-on-enter 디바운스로 대체(포털이라 DOM 남남), 우측 가장자리 근접 행 오버플로 클램프 추가 — Playwright+시스템 Chrome 실측(org-demo 시드 401명, 하단 행 호버) 완료: 포털 확인·뷰포트 내 완전 표시·호버 연속성(trigger→tooltip 이동 유지, 이탈 시 닫힘) 전부 통과 ③ 고아 임포트 lib 4파일 삭제(`dept-info-import.ts`/`.test.ts`·`korean-name-import.ts`/`.test.ts`, 다른 소비처 0건 확인). 게이트: BE pytest 969·ruff 0 / FE tsc 0·lint 0·vitest 589(605-16 orphan 테스트 삭제분)·build OK. 상세: `.superpowers/sdd/2026-08-11-departments-org-basis/final-fix-report.md`.

## 2026-08-10 — 사용자·조직도 소스 교체(AD→n8n HR 웹훅) 설계
- 구현 플랜 작성: [`docs/superpowers/plans/2026-08-10-hr-webhook-directory.md`](docs/superpowers/plans/2026-08-10-hr-webhook-directory.md) — 9태스크(클라이언트+설정 → 스키마/email 제거 → 매핑 → sync 코어 → 소스 교체+프리뷰 → title 패스 → active 필터 → 스케줄러 → 게이트).
- 브레인스토밍 확정 — 설계서 신설: [`docs/design/2026-08-10-hr-webhook-directory-design.md`](docs/design/2026-08-10-hr-webhook-directory-design.md). 신규 `app/hr/`(웹훅 클라이언트+동기화)로 employees 단일 소스 교체, LDAP은 title 전용 패스로 축소 보존. 결정: 퇴직자 active=false 유지+피커·디렉터리 제외+reconcile, 내장 스케줄러(주기 env), email 모델 제거(운영 NOT NULL 완화 부트스트랩 필수), dept_code+departments 미러 신설, 드라이런 diff·삭제 20% 상한 가드로 기존 데이터(권한 경로·login_id 참조·수동 한글값) 이행 방어.
- **Task 1 완료**: settings + HR 웹훅 클라이언트(`app/hr/client.py`) — 설정 3종(n8n_hr_url/token, sync 간격/상한%), 파싱 순수 함수(parse_employee_row/department_row), 비동기 조회(fetch_all_employees/departments/single).
- **Task 2 완료**: 스키마 — `Department`(`departments`) 신설·`Employee.dept_code` 추가·`Employee.email` 모델 제거(`app/models.py`), `db.py`에 `dept_code` `_ADDED_COLUMNS` 등록 + `_relax_employees_email_not_null` 부트스트랩(운영 Postgres NOT NULL 완화), `ad/service.py`·`seed_org_demo.py` email 잔재 스윕. 게이트: BE pytest 930(928+신규 2)·ruff 0.
- **Task 3 완료**: HR 매핑 순수 함수 — `HrEmployeeFields` dataclass + `to_employee_fields`(널 폴백·절사·불일치 플래그, admin 롤 해석). `app/hr/service.py` 신설, `tests/test_hr_mapping.py` 신설(6 케이스: 기본·널·상태·6레벨·불일치·빈org). 게이트: BE pytest 936·ruff 0.
- **Task 4 완료**: 전체 동기화 코어 `sync_all`/`run_full_sync`(`app/hr/service.py`) — upsert(ad→hr 소스 전환·title 미터치)·비활성 전환·청크 삭제(500단위, sqlite 999 바인드 상한 방어)·삭제 20% 상한 가드(무변경 abort)·count 불일치 abort·부서 미러(`_mirror_departments`)·dept_info 고아 리포트(읽기만, 절대 미변경)·퇴사자 점유 해제(기존 `workflow.reconcile_departures` 재사용)·5분 재동기화 가드(`SyncTooSoon`). 공유 테스트 헬퍼 `tests/hr_sync_helpers.py` 신설(`test_hr_sync.py` 9케이스, 향후 Task 5~7 공용). 브리프 오류 정정: `tests/`가 실제로는 패키지(`__init__.py` 존재)라 평모듈 import 불가 — 기존 `test_ai_chat_history.py` 선례대로 `from tests.hr_sync_helpers import ...`로 교정, `MapVersion`에 없는 `created_by` 인자 제거. 게이트: BE pytest 945(936+9)·ruff 0.
- **Task 5 완료**: 소스 교체 — `/api/employees/sync`·신설 `/sync-preview`가 HR(`app.hr.service`)을 보도록 라우터 교체(`SyncSummaryOut`/`HrSyncPreviewOut` 개편, `asdict` 직렬화), `/api/me` 1인 동기화를 `app.hr.service.sync_one`(하루 1회 인메모리 스로틀 `_one_sync_done`)로 교체, 이행 드라이런 `build_sync_preview`(신규/삭제/표기불일치/한글덮어씀/고아 org 경로 diff, 샘플 50개 캡) 신설. FE `SyncSummary` 타입·admin 요약 문자열 신필드 반영. 부수 수정: `tests/test_departed_reconcile.py`의 LDAP mock 3건이 라우터 교체로 깨져 HR mock(`hr_sync_helpers`)로 전환(§로직은 legacy `source='ad'` 행도 HR 프룬 대상이라 스토리 그대로 보존), `test_employees.py`의 구 AD sync 라우팅 테스트 5건 삭제(HR판이 `test_hr_endpoints.py`/`test_hr_sync.py`로 대체, `to_employee_fields`(AD) 직접 테스트는 Task 6까지 보존). 게이트: BE pytest 944(945+4 신규-5 삭제)·ruff 0 / FE tsc 0·lint 0(무관 사전경고 1건 미변경).
- **Task 6 완료**: `app/ad/service.py`를 로컬 시드(`seed_local_employees`) + AD title 전용 패스로 축소 — 구 sync 기계(`EmployeeFields`/`SyncSummary`/`resolve_role`/`to_employee_fields`/`_upsert`/`sync_one`/`sync_all`/`run_full_sync`/`SyncTooSoon`/5분 가드) 전량 제거, 신설 `refresh_titles`(AD title만 갱신, 이름·조직·active 미터치, `app.hr.service.sync_all` 후속에서 지연 import 호출·실패는 로깅만 하고 HR sync 자체는 지킴). 신규 `tests/test_hr_title_pass.py` 2건(title 단독 갱신·HR+title 콤보 통합). 사라진 심볼을 직접 참조하던 구 테스트 3건 삭제(`test_employees.py`의 `to_employee_fields` 매핑/제외 2건, `test_korean_names.py`의 `EmployeeFields`/`_upsert` 보존 1건 — 동등 회귀는 `test_hr_sync.py`의 legacy `source='ad'` 한글필드 보존 케이스가 커버). `test_ad_active.py`의 `is_active` 순수 테스트·시드/디렉터리 단언은 무변경 보존. 게이트: BE pytest 943(944-3 삭제+2 신규)·ruff 0.
- **Task 7 완료**: 소비처 active 필터 스윕 — 퇴직자(`active=false`)가 피커·디렉터리에 노출되지 않도록 4지점에 `Employee.active.is_(True)` 필터 추가(`routers/directory.py` 전수 조회, `permissions/access.py` `get_eligible_users`, `routers/maps.py` `list_editors`의 dept 멤버십 판정 모수+이름 머지 조회). admin 콘솔(`admin.py`)·owning dept 검증 등은 제외 대상으로 무변경. 신규 `tests/test_hr_active_filter.py` 3건(디렉터리 제외·admin 콘솔은 비활성도 포함·eligible-assignees 제외). 부수 회귀: `test_interview_api.py::test_turn_prompt_includes_dept_catalog`가 conftest의 의도적 비활성 시드(`owning.anchor`)로 조립되던 부서 후보 목록이 필터로 비게 돼 깨짐 — 해당 테스트에 별도 active 앵커 직원(`owning.anchor.active`)을 로컬 시딩해 최소 수정. 게이트: BE pytest 946(943+3)·ruff 0.
- **Task 8 완료**: 내장 스케줄러 — `app/main.py`에 `_run_hr_sync_loop`(sleep-first 무한 루프, 주기마다 `hr_service.run_full_sync` 호출·`SyncTooSoon`은 무시하고 다음 주기로·기타 예외는 로깅 후 생존) 신설, lifespan에서 `hr_enabled and hr_sync_interval_hours > 0`일 때만 `asyncio.create_task`로 기동하고 yield 뒤 `hr_task.cancel()`로 정리. 신규 `tests/test_hr_scheduler.py` 1건(sleep 목으로 1회 실패 생존 + 2회차 CancelledError 탈출 검증). 게이트: BE pytest 947(946+1)·ruff 0.
- **Task 9 완료(최종 게이트+문서 마감)**: 잔재 스윕 결과 코드 결함 0건(`ldap_enabled`는 `hr/service.py` title 패스 게이트+`settings.py` 정의만 잔존, `email`은 `db.py`의 설계된 NOT NULL 완화 부트스트랩만 잔존 — 둘 다 정상). 설계 문서(`docs/design/2026-08-10-hr-webhook-directory-design.md`) 상단에 상태줄 추가. `docs/deploy/db-seed.md`는 email/HR env 참조가 없어 변경 없음. **전체 게이트**: BE pytest 947/947·ruff 0 / FE tsc 0·lint 0(무관 사전경고 1건 미변경)·vitest 605/605·build OK.
- **최종 리뷰 픽스 웨이브 완료**: 브랜치 전체 리뷰 findings 5건 수정 — F1 빈 피드 전멸 가드(`sync_all`, 캡=0이어도 전멸 방지, §5-4 ②) · F2 단건 조회 타임아웃 분리(`fetch_employee`만 10초, 전수는 180초 유지) · F3 컬럼 길이 클램프(Postgres VARCHAR 사각 — login_id>100 skip, name/dept 등 200/300자 클램프, §3) · F4 `list_editors` 점유권 이전 피커에서 emp_map 미존재(비활성·소멸) 후보 제외(§7, 기존 회귀 테스트 `test_editors_list_name_resolution_and_group`도 새 동작에 맞춰 최소 갱신) · F5 스케줄러 이행 지침(`.env.example`+설계 §9에 "최초 0(off)→이행 후 24" 문구). 신규 테스트 4건. **전체 게이트**: BE pytest 951/951(947+4)·ruff 0. FE 무변경. 상세: `.superpowers/sdd/2026-08-10-hr-webhook-directory/final-fix-report.md`.

- 컨설팅사 발송용 메일 초안 신설: [`docs/notices/2026-08-09-consultant-delivery-interface-mail.md`](docs/notices/2026-08-09-consultant-delivery-interface-mail.md) — 수용 방향(부트스트랩·재전달 무충돌)과 전달 데이터 인터페이스(안)(categories.json+maps.jsonl 항목 정의·표기 규칙·인터뷰 수집 항목·협의 요청).
- **Phase 2 최종 리뷰 클린(머지 가능)** — 브랜치 리뷰 Minor 3+테스트 갭 3 전량 수정(fetch 실패 복구·category_path 대칭·403 배선 테스트·hasMoreMaps 술어). 게이트: BE pytest 924·ruff 0 / FE vitest 605·tsc 0·lint 0·build OK / 실브라우저 스모크 8/8. 잔여 유예: 서버 실배포 검증·수천 카테고리 렌더 실측·스케일 하드닝 트랙(기존 홈 fetch-all·SP 피커).
- Phase 2 구현 플랜 작성: [`docs/superpowers/plans/2026-08-08-consultant-framework-phase2.md`](docs/superpowers/plans/2026-08-08-consultant-framework-phase2.md) — 6태스크(카테고리 조회 API+MapOut 노출 → 지정 I/O·연결/이양 API → 홈 토글+lazy 트리 → 상세 카드 뱃지/I/O/모달 → SP 폼 I/O → 샘플 전달물+pw 스모크).
- Phase 2 스코핑 확정: 배치=Maps 탭 좌측 세그먼트 토글(Departments↔Framework), 스케일=신규 카테고리 트리 표면만 서버 주도 lazy로 정합(기존 홈 fetch-all·SP 피커 재설계는 별도 스케일 하드닝 트랙 분리) — 설계 §6/§7 개정.
- **Phase 1 최종 리뷰 클린(912 green)** — 브랜치 전체 리뷰(Important 7 적발·전량 수정: 무변경 맵 재기록 게이트/연계 파라미터 정규화/휴지통 맵 스킵/중복 이름 경고 정책/파서 길이 캡(postgres 사각)/미참조 fte 경고/pass-1 청크 커밋). 잔여 유예: 최종 대량 전달 전 maps.jsonl 스트리밍 재구조(현재 전량 메모리 보유)·KB 인덱싱 백필 별도·pending map_rename supersede는 거버넌스 UX 트랙에서 결정·vs-DB 동명 충돌 분기 전용 테스트.
- 브레인스토밍 확정 — 설계서 2건 신설: [`docs/design/2026-08-08-consultant-hierarchy-design.md`](docs/design/2026-08-08-consultant-hierarchy-design.md)(L1~L5 카테고리 트리·L6=맵·연계=subprocess 변환·SP 지정 확장 I/O·canonical JSON 계약·멱등 임포트 스크립트 — "임포트=부트스트랩, 수명주기=BPM 거버넌스" 이양 모델) + [`docs/design/2026-08-08-governance-ux-design.md`](docs/design/2026-08-08-governance-ux-design.md)(게시 모달 가시성 동봉·맵 카드 권한 목록 편집·승인 탭 비버전 승인 통합+red dot).
- 재임포트는 CSV 임포트식 무충돌 모델 — 현업 편집이 있어도 안 막히고(스킵/차단 없음) 새 버전 적재+게시로 이력 보존, 변경점은 dry-run 리포트+버전 비교 화면으로 확인.
- 스케일 전제 반영(§8): 컨설턴트 추산 L5 ~3,000·L6 맵 ~20,000 — canonical을 `maps.jsonl` 스트리밍으로 전환(어댑터 자동 생성, 수기 아님), 벌크 임포트+청크 커밋, dry-run CSV 출력, Phase 2 선행 조건으로 맵 목록 API 서버 필터/페이지네이션·카테고리 트리 lazy-load·SP 피커 검색 재설계 명시.
- 설계서 2건 사용자 승인 → Phase 1 구현 플랜 작성: [`docs/superpowers/plans/2026-08-08-consultant-import-phase1.md`](docs/superpowers/plans/2026-08-08-consultant-import-phase1.md) — 7태스크 TDD(스키마→canonical 파서→결정적 id 그래프 빌더→카테고리/오우닝부서→업서트 엔진(버전 게시·SP 지정·변경 감지)→dry-run CLI/CSV/청크 커밋→전체 게이트). 결정적 노드 id(코드 sha1 파생)로 재임포트 버전 비교 매칭 성립, 거버넌스 필드는 생성 시에만·재임포트는 콘텐츠만 갱신.
- **Phase 1 Task 1 완료**: ProcessCategory 신규 테이블(L1~L5 트리 저장, code 기준 유니크) + ProcessMap에 4컬럼(category_id/consultant_code/sp_input/sp_output) 추가. db.py _ADDED_COLUMNS 등록 완료, 스키마 스모크 테스트 그린.
- **Phase 1 Task 2 완료**: canonical 파서 모듈(카테고리/맵 Pydantic 모델 + 로더 함수) 구현 완료. load_categories 구조 검증(중복코드/parent 존재/level 체인), load_maps 줄단위 오류 수집(벌크 임포트 계약) — pytest 5/5 통과.
- **Phase 1 Task 3 완료**: 결정적 그래프 빌더 구현 — make_node_id/make_edge_id(컨설턴트 코드 sha1 파생), build_graph_rows(Start/End 자동 시드, 연계 노드 subprocess 변환·SP 파라미터 상속, 위상 정렬 레이아웃). pytest 3/3 통과(체인·연계·경고), 린트 OK.
- **Phase 1 Task 4 완료**: 카테고리/오우닝부서 해석 모듈 구현 — upsert_categories 멱등 업서트(code 기준·parent 2-pass), build_known_departments 직원 org 전 prefix, resolve_owning_department dept/owner 폴백 규약. pytest 2/2 통과, 린트 OK.
- **Phase 1 Task 5 완료**: 맵 업서트 엔진 `import_delivery` 구현 — 2-pass(맵 껍데기+link_targets → 그래프/버전/SP 지정), 게시는 routers/versions.publish_version 규칙 재현(채번·기존 게시본 expired·이벤트, 승인·알림 우회), 거버넌스 필드는 생성 시에만 세팅. 변경 감지 시그니처 비교 시 미영속 Node/Edge의 컬럼 default 미적용(None) vs DB 로드본("") 불일치로 오탐되던 버그 수정. pytest 16/16(신규 5 포함) + 백엔드 전체 900/900 통과, 린트 OK.
- **Phase 1 Task 5 fix round 1**: 리뷰에서 이전 버전 그래프 삭제가 스펙("재임포트는 새 버전 적재로 이력 보존")과 버전비교 화면 요구를 위반한다고 지적 — 근본 원인은 Task 3의 결정적 id를 Node/Edge.id(테이블 전역 PK)로 쓴 설계 결함. clone_graph의 계보 규약(id=uuid4, source_node_id=계보 루트, `frontend/src/lib/diff.ts` getLineageKey가 이 규약으로 버전 비교 매칭)을 그대로 따르도록 개정: build_graph_rows는 이제 Node/Edge마다 uuid4 id를 새로 발급하고 결정적 값은 `source_node_id`(make_node_id 계보 루트)로만 기록, make_edge_id는 불필요해져 제거. 엔진의 이전 버전 삭제 로직 완전 제거(만료 버전도 그래프 그대로 보존, append-only). 변경 감지 시그니처도 id 대신 source_node_id 계보로 노드·엣지를 비교하도록 갱신. Task 3 테스트 3건을 계보 계약으로 개정(id 대신 source_node_id 단언). pytest 16/16 + 백엔드 전체 900/900 통과, 린트 OK. 수동 검증: 재임포트 후 만료 버전의 노드 3건이 그대로 조회됨을 확인.
- **Phase 1 Task 5 fix round 2**: 리뷰 지적 1 Important + 3 Minor + 갭 1건 수정. [Important] 부분 재전달(A만 재전달, A가 링크하는 B는 이번 전달분에 없음)이 link_targets를 빈 CanonicalParams()로 폴백시켜 연계 노드 annual_count/fte가 초기화되고 불필요한 새 버전까지 찍히던 버그 — pass 2가 old_nodes에서 source_node_id로 같은 연계 노드를 찾아 두 필드를 시그니처 계산 전에 이어받도록 수정(plan 파일의 "DB-only는 공백 시드" 주석도 개정 사실로 갱신). [Minor] `version` possibly-unbound(Optional 초기화로 방어) · `names` dict를 맵 루프 밖으로 호이스트(O(n²) 회피) · `link_targets`/`existing` 키 타입을 `str | None`→`str`로 명시 가드(Pyright 클린 확인). [갭] 전달분 내 중복 map code — 첫 항목만 처리, 이후 항목은 error 행 남기고 스킵(중복 에러 행이 살아남은 첫 항목까지 pass 2에서 건너뛰지 않도록 카테고리 에러 추적을 report.rows 재스캔이 아닌 전용 set으로 분리). 신규 테스트 2건(부분 재전달 보존·중복 code). pytest 18/18 + 백엔드 전체 902/902 통과, 린트·pyright 클린.
- **Phase 2 Task 2 완료**: `SubprocessDesignationIn`에 `input`/`output`(길이 캡 없음, description과 동일 strip validator 확장) 추가 + `designate_subprocess`가 `sp_input`/`sp_output` 저장. 신규 `PUT /maps/{id}/category`(연결/해제, 존재 검증 404, `set_owning_department`과 동일 owner/sysadmin 가드) + `POST /maps/{id}/framework-transfer`(source→target으로 category_id+consultant_code 이전, source 초기화, 소프트삭제 404·source 슬롯없음/target 슬롯보유 409, 두 맵 모두 owner 필요 — 이양 알림 없음/최소 스코프). pytest 신규 3건 + `tests/test_categories_api.py`·`tests/test_consultant_import.py` 28/28, 백엔드 전체 920/920 통과, 린트 클린.
- **Phase 1 Task 6 완료**: `run_import`(파일 로드→`import_delivery`→apply=commit/dry-run=rollback→CSV 리포트, jsonl 줄 에러를 `("-","error",…)` 행으로 편입) + argparse CLI(`python -m scripts.import_consultant <dir> [--apply]`, 기본 dry-run, stdout counts+warning/error 상위 20건) 구현. `import_delivery`에 `commit_every: int | None = None` 추가 — apply 시 맵 200건마다 중간 `session.commit()`(20k 스케일 단일 트랜잭션 방지, design §8). 20k 실측 벤치는 범위 밖(서버 실측으로 이월). pytest 20/20(신규 2) + 백엔드 전체 904/904 통과, 린트 OK.
- **Phase 1 Task 6 fix round 1**: 리뷰 지적 — pass 1(맵 껍데기 생성)이 전달분 전체를 커밋 없이 한 트랜잭션에 쌓아, 첫 pass-2 청크 커밋 때 한꺼번에 실리는 문제(크래시 시 버전 없는 빈 껍데기가 대량 잔존, 20k 스케일에서 §8 청크 커밋 취지 훼손). pass 1에도 동일한 `commit_every` 청크 커밋 적용(신규 생성분만 카운트, dry-run은 `commit_every=None`이라 여전히 단일 트랜잭션 rollback). 모듈 docstring에 크래시/재실행 계약 문단 추가(멱등 재실행 안전·청크 경계 사이 크래시 시 빈 껍데기 일시적 노출 가능). 신규 테스트 1건(commit_every=1로 맵 3건, 양쪽 pass 청크 경계 통과 확인). pytest 21/21 + 백엔드 전체 905/905 통과, 린트 OK.
- **Phase 1 완료**: 스키마(ProcessCategory+4컬럼) · canonical 파서(카테고리/맵 로더, 줄 오류 수집) · 결정적 그래프 빌더(source_node_id 계보 루트, Start/End 자동 시드, 연계→subprocess, 파라미터 상속, 레이아웃) · 카테고리/오우닝 부서 모듈(멱등 업서트, org 폴백) · 맵 업서트 엔진(버전 게시, SP 지정, 변경 감지, 부분 재전달 연계 보존) · dry-run/apply CLI(CSV 리포트, 청크 커밋 — 200건마다) 구현 완료. **전체 게이트**: pytest 905/905 통과(기존 884 + 신규 21, 7.70s), ruff 0 오류. 미검증 잔여: 20k 실측 벤치(서버 실운영), postgres 실배포 ALTER, 실제 컨설턴트 스키마 어댑터(Phase 3), 홈 UI 노출(Phase 2).
- **Phase 1 최종 리뷰 픽스 웨이브**: Important 6건 — 무변경 맵 재전달 시 콘텐츠/`sp_changed_*` 쓰기를 `is_new or graph_changed or fields_changed or sp_designated_at is None`로 게이팅(`updated_at` 무의미 갱신·홈 목록 도배·SP 이력 오염 방지) · params 정규화를 1회 상류 통합(`link_targets`가 raw 값을 쓰던 버그로 연계 맵 무효값이 정규화 없이 새던 것 수정) · 휴지통(소프트삭제) 맵 재전달 차단(에러 리포트, `_purge_expired`의 버전째 영구삭제 회피, link_targets서도 제외) · 맵 이름 중복은 차단·강제개명 없이 경고만(컨트롤러 결정 — 식별은 consultant_code) · canonical 파서에 DB 컬럼폭 상한 추가(postgres 전용 apply 중 크래시 방지, sqlite는 안 걸림) + CLI `--label` 100자 트렁케이션 · annual_count/fte가 있는데 이번 전달분에 인바운드 연계가 없으면 경고(design §4 "아무것도 안 잃는다"의 반례 표면화). Minor 6건도 동시 처리 — 링크 대상 중복(`to_map`) 파서 단계 차단 · `--label` 기본값 KST 고정(`app.clock.now_kst`) · 청크 커밋 지점 진행 로그(pass1/pass2 print) · owner/approver 유령 로그인 경고(관측용, 승인 정족수는 안 막힘) · 재전달 이름 변경 시 리포트 상세에 old→new 기재 · `_publish`가 KB 인덱싱을 스킵한다는 모듈 docstring 한 줄. 신규 테스트 6건. **전체 게이트**: pytest 911/911(기존 905+신규6), ruff 0 오류. 상세: `.superpowers/sdd/2026-08-08-consultant-import-phase1/final-fix-report.md`.
- **픽스 웨이브 정정**: I-5에서 `CanonicalParams.input`/`output`에 건 50자 상한이 잘못 — design §2.2상 `sp_input`/`sp_output`은 자유 텍스트(Text, 무상한)라 실제 문장형 값이 거부될 수 있었다. 두 필드만 상한 해제(숫자형 6필드는 `String(50)` 그대로 유지). pytest 911/911, ruff 클린.
- **회귀 가드 추가**: `test_long_input_output_accepted` — input/output 500자 자유 텍스트가 파서에서 수용되는지 확인하는 테스트 전용 후속(운영 코드 변경 없음). pytest 912/912, ruff 클린.
- **Phase 2 Task 1 완료**: `GET /api/categories/nodes`(lazy 자식 + 서브트리 map_count, 레벨 역순 부모 누적)·`GET /api/categories/{id}/maps`(직접 연결 맵 페이지네이션, subprocess-usage hidden_count 마스킹 선례 재사용·list_maps 카드 메트릭 스코프 재사용) 신설. `MapOut`에 `category_id`/`category_path`(트랜지언트, `build_category_paths` 순수 함수)/`consultant_code`/`sp_input`/`sp_output` 노출, `list_maps`·`get_map`에 경로 주입. 마스킹 테스트는 기본 스위트(auth OFF→전원 sysadmin)로는 트리거 안 돼 `test_permission_gates.py`의 `enforce` 픽스처 패턴을 로컬 복제해 감쌈. 부수 발견: 세션 스코프 DB를 공유하는 `test_consultant_import.py::test_upsert_categories_idempotent`가 전체 테이블 스냅샷을 단언해 신규 시드와 충돌 — code 필터로 좁혀 회귀 없이 정정. pytest 915/915, ruff 클린.
- **Phase 2 Task 1 fix round 1**: 리뷰 지적 Important 1건 — `list_category_maps`가 offset/limit을 가시성 필터 이전에 적용해, 비가시 맵만 있는 페이지가 total>0인데 maps=[]로 창을 통째로 잃는 버그. 직접연결 맵(카테고리당 소량, 서브트리 아님)을 전량 로드→가시성 분리→그 뒤에만 `visible[offset:offset+limit]` 슬라이스로 수정(total=전체 비삭제 수, hidden=페이지 무관 전체 비가시 수로 안정화). Minor 1건 — 존재하지 않는 category_id 404 회귀 테스트 추가(라우터 자체는 이미 404 처리 중). 신규 테스트 2건. pytest 917/917, ruff 클린.
- **Phase 2 Task 3 완료**: 홈 Maps 탭에 Departments↔Framework 좌측 뷰 토글(`home-view-toggle`, 가시성 필터 세그먼트 스타일 복제) + lazy 카테고리 트리 `FrameworkTree` 신설. `api.ts`에 `CategoryNode`/`CategoryMaps`/`listCategoryNodes`/`listCategoryMaps` 추가, `MapSummary`에 `category_id`/`category_path`/`consultant_code`/`sp_input`/`sp_output` 노출. 캐시·펼침 상태는 `frontend/src/lib/framework-tree-state.ts` 순수 리듀서(+fetch 오케스트레이션 함수, 컴포넌트는 thin 렌더러)로 분리 — vitest 컴포넌트 테스트 관례가 리포에 없음을 확인(`vitest.config.ts`가 `*.test.ts`만 include)하고 브리프의 대체 경로를 택함. `bpm.home.tree` localStorage 블롭에 `view` 필드 추가(writeTree 시그니처 확장, 기존 5개 호출부 전부 갱신, 복원 effect 하이드레이션). 루트 fetch 미완료를 "카테고리 없음" empty 상태와 구분(로드 중 오인 메시지 깜빡임 방지). 신규 테스트 4건(루트 로드·펼침 1회 fetch+재펼침 캐시·hidden/빈 카테고리 보존·load more append). **전체 게이트**: `npx vitest run` 597/597, `npx tsc --noEmit` 클린, `npm run lint` 0 errors(사전 존재 1 warning 무관), `npm run build` 성공.
- **Phase 2 Task 5 완료**: SP 지정 폼 Input/Output 편집 필드 추가. `DesignationForm` 인터페이스에 `input`/`output` 스트링 필드 신규 추가, 모달 렌더에서 description textarea **앞**에 두 필드를 단일라인 text input으로 배치(url/system과 동일 INPUT_CLASS 스타일, maxLength=500, trim 저장). `SubprocessDesignationBody` API 타입에 `input?`/`output?` 추가, 모달 저장 경로(`handleSave`)에 두 필드 포함. Panel 프리필(`openModal`)·초기 상태·display 속성 행(attrRows)에 sp_input/sp_output 필드 통합. 인스펙터 카드(subprocess-inspector-card.tsx)·inbox 모달 초기화(page.tsx line 330)도 동일 반영. i18n 메시지 EN/KO 쌍 신설: `sp.input`("Input"/"인풋"), `sp.output`("Output"/"아웃풋"). 모든 생성 사이트 tsc 검증 완료, 기존 테스트 회귀 0. **전체 게이트**: `npx vitest run` 603/603, `npx tsc --noEmit` 클린, `npm run lint` 0 errors.
- **Phase 2 Task 5 fix round 1**: 리뷰 지적 2건 — input/output maxLength 제거(자유 텍스트 무상한, description 관례) · 플랜 Task 5 체크박스 틱. 재검증: vitest 603/603, tsc/lint 클린.
- **Phase 2 Task 4 완료**: `MapDetailCard` 기존 pill 행에 카테고리 뱃지 추가(`data-id="map-detail-category"`) — 오너는 클릭 가능한 필(연결 시 `category_path`, 미연결 시 "Add to framework" 유령 필)로 `FrameworkAssignModal`을 열고, 비오너는 연결돼 있을 때만 정적 필로 표시. 설명 박스 아래 `sp_input`/`sp_output` 2행 I/O 블록(`data-id="map-detail-io"`) 신설. 신규 `FrameworkAssignModal`(`components/maps/framework-assign-modal.tsx`) — 루트부터 `listCategoryNodes` lazy 캐스케이드 셀렉트(비-리프 포함 아무 깊이나 연결 허용), Assign/Unassign(카테고리 있을 때만)/Transfer slot(`consultant_code` 있을 때만, `listMaps()` 클라 목록 + SearchSelect 대상 피커) 3액션, 성공 시 카드 내부 `localReloadKey`로 자체 재조회(부모 prop 변경 없이 `detailReloadKey` 패턴 재현). 캐스케이드 선택 체인(깊은 레벨 재선택 시 하위 리셋)은 순수 헬퍼 `lib/category-cascade.ts`(`pickCascadeLevel`)로 분리해 유닛 테스트(TDD 레드 확인 후 구현). `api.ts`에 `putMapCategory`/`postFrameworkTransfer`, i18n 10키(EN/KO) 추가. **전체 게이트**: `npx vitest run` 601/601(신규 2건), `npx tsc --noEmit` 클린, `npm run lint` 0 errors(사전 존재 1 warning 무관), `npm run build` 성공.
- **Phase 2 Task 4 fix round 1**: 리뷰 2 Important + 2 Minor 수정. [Important] FrameworkTree 캐시 stale — 카테고리 연결/해제/이양 성공 후에도 트리의 `mapsByCategory`/`childrenByParent` 캐시가 구 상태를 계속 보여주던 버그. `MapDetailCard`에 `onFrameworkChanged?`(page.tsx 전용, 다른 호출부 무영향) 추가 → 모달 `onChanged`에서 `localReloadKey` 갱신과 함께 호출 → page.tsx가 `frameworkVersion` state를 bump해 `<FrameworkTree key={frameworkVersion}/>`를 강제 리마운트(펼침 상태는 리셋되지만 v1 허용 범위). [Important] 캐스케이드가 `currentCategoryId`로 시딩되지 않아 깊은 맵 재지정 시 매번 루트부터 재클릭해야 하던 문제 — 백엔드 `GET /api/categories/{id}/chain`(조상 체인 루트→자신, 404 가드) 신설 + 프론트 `getCategoryChain` + 모달 마운트 시 조상 체인 병렬 prefetch로 선택 체인·레벨별 옵션을 한 번에 시딩(재선택 시 기존 `pickCascadeLevel` 하위 리셋 의미론은 그대로 유지). [Minor] 이양 대상 피커에서 이미 슬롯(`category_id`/`consultant_code`) 보유 맵 제외(자기 자신 제외에 추가). [Minor] 체인 끝 레벨 자식 fetch 중 로딩 표시 — `fetchedParentIds`(depth 아닌 parentId로 키잉, 재선택 시 stale 캐시 회피) 기반 파생값으로 구현(초기 시도한 `useState` 기반 플래그는 effect 본문 동기 setState라 `react-hooks/set-state-in-effect`에 걸려 파생값 방식으로 교체). 순수 변환(조상체인→id 시딩, 레벨별 parentId 목록)은 `lib/category-cascade.ts`에 `seedChainIds`/`seedLevelParents`로 분리해 유닛 테스트(TDD). 신규 테스트: 프론트 2건(vitest), 백엔드 2건(pytest, chain 정상/404). **게이트**: 백엔드 타겟 `pytest tests/test_categories_api.py` 10/10 + `ruff check` 클린, 프론트 `npx vitest run` 603/603, `npx tsc --noEmit` 클린, `npm run lint` 0 errors, `npm run build` 성공.
- **Phase 2 Task 3 fix round 1**: 리뷰 지적 Important 1건 + Minor 1건, 동일 근본원인(핸들러가 `loadingIds`를 참조하지 않음). [Important] `handleToggle` — 펼침 중(fetch 미완료) 접었다 재펼침하면 `hasCachedChildren`만 보던 가드를 통과해 `fetchCategoryChildren`이 중복 호출. [Minor] `handleLoadMore` — 응답 전 연타 시 같은 offset으로 중복 요청→중복 id append. 가드 판단을 순수 모듈로 이관: `shouldFetchChildren`/`shouldFetchMore`(`framework-tree-state.ts`, 캐시 또는 `loadingIds` 인플라이트면 false) 신설, 컴포넌트는 이 가드로만 fetch 여부 결정. `handleLoadMore`도 `loading_started`/`loading_ended`를 리듀서 흐름에 편입(기존엔 load-more가 loadingIds를 전혀 안 건드림). 부수 수정 — `loadingIds`를 load-more에도 재사용하면 이미 로드된 목록이 로딩 placeholder로 통째로 가려지는 회귀가 생겨, `initialLoading = loading && !hasCachedChildren(...)`로 "최초 펼침 로딩"과 "더 보기 로딩"을 구분(후자는 기존 목록 유지 + "더 보기" 버튼만 `disabled`). 회귀 테스트 2건 추가(펼침 미해결 중 접기→재펼침 시 fetch 1회, 더 보기 연타 시 fetch 1회+중복 id 없음). **게이트**: `npx vitest run` 599/599, `npx tsc --noEmit` 클린, `npm run lint` 0 errors(동일 사전 warning).
- **Phase 2 Task 6 완료 — Phase 2 종료**: 샘플 전달물 `docs/samples/consultant-delivery-sample/`(categories.json — L1~L5 체인 5종+L2 형제 1종, maps.jsonl — 맵 3개·연계 1쌍·owner `admin.sys`·department는 데모 시드 org 경로, 1개 맵에 duration/annual_count/fte/input=PR/output=PO 전체 파라미터) — dry-run `created=3, errors=0` 확인. Playwright 스모크 `frontend/scripts/pw-smoke-framework.mjs`(기존 pw-smoke-*.mjs 관례 미러) 신설 — 홈 진입→Framework 토글→L1~L5 체인 펼침→맵 카드 노출→선택→상세 카드 경로뱃지/IO 확인→Departments 복귀 회귀→새로고침 뷰 유지, 8/8 그린(재실행 2회 안정). 이중 마운트(모바일 인라인 아코디언 vs 데스크톱 aside — 기존 패턴) 때문에 `map-detail-*` 셀렉터는 `:visible` 필수. **전체 게이트**: backend pytest 922/922·ruff 클린, frontend vitest 603/603·tsc 클린·lint 0 errors(사전 warning 1건 무관)·build 성공. **Phase 2(카테고리 트리 UI+I/O+슬롯이양) 6태스크 전부 완료** — 잔여는 Phase 3(실스키마 어댑터)·거버넌스 UX 트랙(별도)·스케일 하드닝(홈 fetch-all·SP 피커 재설계, 대량 전달 도래 전)으로 이월.
- **Phase 2 최종 리뷰 픽스 웨이브**: 잔여 Minor 3건 + 테스트 갭 2건. [FE] `framework-tree.tsx`(루트/펼침/더 보기)와 `framework-assign-modal.tsx`(init)의 미처리 promise rejection — 실패 시 `loadingIds`가 영원히 안 지워져 노드가 리마운트 전까지 복구 불능이던 버그. 세 fetch 모두 `.catch`로 `loading_ended` 디스패치(재요청 잠금 해제) + 인라인 `text-error` 재시도 행(루트는 `rootError` state, 카테고리는 `open && !loading && !hasCachedChildren` 파생값) 추가, 모달 init 실패는 기존 에러 텍스트로 라우팅. [BE] `/categories/{id}/maps`만 다른 맵 응답과 달리 `category_path` 미주입 — 페이지 내 맵이 카테고리 하나 공유하므로 `build_category_paths` 1회 조회로 통일. [FE] `FrameworkTree.selectedId` 미사용 prop 제거(선택 스타일은 이미 `renderCard` 클로저의 `effectiveSelected`가 처리 — 확인 후 프롭·호출부 둘 다 삭제). [테스트] 백엔드 2건(`enforce` 픽스처로 카테고리 PUT 비-owner 403·source만 owner인 framework-transfer가 target측 inline `assert_map_role` 배선으로 403) + 프론트 2건(fetch 실패→`loading_ended`→`shouldFetchChildren` true 복귀 회귀, `hasMoreMaps(state, categoryId)` 순수 헬퍼 추출+hidden 포함 경계 테스트). **전체 게이트**: backend pytest 924/924(신규 2)·ruff 클린, frontend vitest 605/605(신규 2)·tsc 클린·lint 0 errors(사전 warning 1건 무관). 상세: `.superpowers/sdd/2026-08-08-consultant-framework-phase2/final-fix-report.md`.

## 2026-08-04 — 맵 카드 최근열람 표시 정정
- 기본 상태에서 시계 칩 전체가 accent-tint 배경이라 그 줄이 "최근 수정"이 아닌 다른 값처럼 읽혔다 — 칩 스타일을 빼고 **시계 아이콘에만** 최근 열람을 표시(아이콘 색 + 배경 하이라이트, 텍스트는 다른 카드와 동일하게 `updated_at`).
- 호버 전환: 들어올 땐 **0.5초 지연 후 0.5초 페이드**(스쳐 지나는 커서에 반응하지 않게), 나갈 땐 지연 없이 **0.5초 페이드로 복귀**.
- 스모크 갱신: 아이콘 색·배경 하이라이트·칩 배경 투명 동시 검사, 지연 구간 중간(250ms) 미전환 검사, 언호버 150ms 중간값 검사(즉시 스냅이면 걸림)와 페이드 완료 검사.

## 2026-08-04 — 홈 부서 목록 재조정 설계 (개정)
- 문서 정합: 픽스 웨이브로 R4가 테두리 없는 틴트 박스 + 상수 인셋(≈389px)으로 바뀐 뒤 남아 있던 낡은 수치·도해 정리 — §3 ASCII 도해를 틴트 박스로 다시 그리고, §4 중첩 금지 랜드마인의 폭 체인과 R6의 어긋남 수치를 실제 값으로 교체.
- 사용자 평가 "오히려 난잡" — 원인 4건 확정: sticky 행이 들여쓰기를 버려 좌변이 지그재그 · breadcrumb이 바로 윗줄 부모를 재기재 · 한 행에 `…`/`/`/`›` 세 구분자 · 부서 행과 카드가 뒤섞여 목록만 훑을 수 없음. 앞 3건은 필 체인+sticky+breadcrumb 장치 자체에서 나와 그 장치를 폐기.
- 설계 확정 — `docs/design/2026-08-04-home-dept-list-revision-design.md`(앞 설계 §2 대체, §3·§4는 유지). main 들여쓰기 트리 회귀 + 카운트 태그화 · 펼친 부서는 태그 숨김·회색 톤다운 · 맵 보유 부서와 그 카드를 **컬럼 풀폭 그룹 박스**로 묶음(박스 헤더=트리 행, 자식은 박스 밖, 중첩 금지 → 카드 399px 고정) · 미지정/내 부서 섹션도 같은 박스.
- 구현: 조직도 아코디언을 main 들여쓰기 트리로 되돌리고 카운트 태그(`CountTag`)·펼친 행 태그 숨김/톤다운·맵 보유 부서 풀폭 그룹 박스(`DeptGroupBox`, 자식은 박스 밖) 적용. 사용처 사라진 `collectPillChain`+테스트 제거.
- 구현: 내 부서 섹션에도 같은 태그·그룹 박스 적용 — 좌측 컬럼 카드 폭을 조직도와 동일(399px)하게 정렬.
- 검증: 스모크를 박스·태그·톤다운·좁은폭 클리핑 검사로 갱신해 20/20 통과 + 전체 게이트(lint·tsc·vitest 593·build·pytest 884). 픽스: 톤다운 검사가 `expandAll` 이후(닫힌 행이 하나도 안 남는 시점) 닫힌 행 색을 찾던 버그 — 전부 펼치기 전에 닫힌 색을 미리 캡처하도록 수정.
- 머지 전 수정 웨이브(리뷰+육안 확인, 원인 1개로 수렴하는 결함 5건 + 승인된 디자인 변경 1건): `DeptGroupBox` 테두리 제거(카드 자체 테두리와 9px 간격 이중 테두리로 겹쳐 보임) + `p-2`→`py-2`(좌우 패딩 폐지), 카드 리스트(`renderMapList`·내 부서 `<ul>`)에 `pl-5 pr-2` 고정 인셋 추가(depth 무관 상수 — 헤더 `paddingLeft`와 별개라 박스형/비박스형 헤더가 같은 depth에서 같은 x로 정렬됨, 카드 폭 ≈389px로 전 구간 동일). 헤더 hover를 `bg-surface-alt`(#f5f5f7, 박스 배경·카운트 태그 배경과 동색이라 무효)에서 `bg-divider`(#f0f0f0, `git grep`으로 실사용 확인된 생성 유틸리티)로 3곳(부서 노드·미지정·내 부서) 모두 교체 — 박스 안/밖 어디서나 보이고 카운트 태그 호버 용해도 해소. 트리 `<li>`/`<ul>` 간격 `gap-1`→`gap-2`로 인접 틴트 영역 분리. `MyDeptFavorites` 헤더에 `data-id="my-dept-toggle"`+`aria-expanded`(트리 토글과 다른 id — 트리는 첫 진입 접힘·내 부서는 기본 펼침이라 같은 id면 "조직도 접힘" 검사가 깨짐). 스모크: 카운트 태그 검사가 `expandAll` 이후(닫힌 행 0개) 실행돼 절반이 공집합만 걸러 항상 통과하던 버그 — 톤다운 검사처럼 펼치기 전에 닫힌 행 증거를 선캡처하도록 교정, 태그·톤다운 검사 모두 `my-dept-toggle` 포함하도록 확장. 설계문서 DOM 계약에 누락돼 있던 `org-node-name`·`my-dept-toggle` 추가, R4 박스 스타일 서술을 신규 무테두리/`py-2`/고정 인셋 처리로 갱신. 게이트·브라우저 스모크 재검증 완료(상세는 커밋 로그).

## 2026-08-04 — 홈 부서 가시성·시인성 개선 설계
- 좌측 조직도 문제 2건 실측 확정: ①`depth*12+16` 들여쓰기로 맵 카드 폭이 depth별 401~365px로 제각각(콘텐츠 333px에서 제목 말줄임) ②My dept 섹션과 조직도가 첫 진입 시 동시 펼침 상태로 **동일 카드를 중복 렌더**(시선 분산의 진짜 원인).
- 설계 확정 — `docs/design/2026-08-04-home-dept-visibility-design.md`. 부서명 고정폭 필(단일자식 구간 한 행 병합)·카드 풀폭 417px 통일·맵 보유 부서만 sticky 경로 헤더·최근접속 표시 호버 반전(기본은 accent 시계 칩)·내 부서 맵 있으면 조직도 접힘 시작 + 접힘 상태 localStorage 영속.
- 구현: `collectPillChain` 순수 함수(통과 노드 병합·맵 보유 시 중단) + 단위 테스트 3종.
- 구현: 조직도 아코디언 재구성 — 부서명 고정폭 필 체인(단일자식 병합)·맵 카드 들여쓰기 제거(전 depth 동일 폭)·맵 보유 행만 sticky 경로 헤더(조상 breadcrumb 동반)·자기 맵을 자식보다 먼저 렌더.
- 구현: 맵 카드 최근접속 표시 반전 — 기본은 오너/수정시각(시계 칩 accent+tint)·호버 시 `Recent · N ago` 필로 교체(겹침 그리드 유지로 폭 점프 없음).
- 구현: 첫 진입 포커스 — 내 부서 맵이 있으면 조직도 시드 생략(me·maps 도착 후 1회 판단으로 경합 차단), 접힘 상태는 `bpm.home.tree`(localStorage)로 분리해 새로고침에도 유지(저장은 StrictMode 사고 회피 위해 토글 핸들러에서).
- 검증: 브라우저 스모크 `pw-smoke-home-dept.mjs` 15/15 통과(진입 접힘·카드 폭 통일·sticky 고정·새로고침 유지·호버 반전) + 전체 게이트(lint·tsc·vitest 596·build·pytest 884).
- 최종 리뷰 픽스 3건: sticky 행 breadcrumb을 바로 위 부모 1개(+"…" 압축)로 줄이고 그 폭을 터미널 필에 양보(형제 부서 식별 가능, `DeptPill` `grow` prop) · My부서 카드 리스트 `pl-1` 제거(아코디언과 동일 417px) · 트리 시드 래치를 `touched` 필드로 분리(조직도 자체 조작만 래치, My부서/Word/미지정 토글은 이어받기만 해 내 부서 맵 없는 유저의 시드가 계속 재계산되게).
- 회귀 픽스: 980-1280px 구간에서 breadcrumb 없는 체인 필(2-3개) 행이 `(N)` 카운트를 클리핑(overflow-x-hidden이 무음 절단, 1000px에서 71px 잘림 실측) — `DeptPill` `shrink-0`→`min-w-0`(w-24는 floor 아닌 basis) + 체인 필 wrapper span도 `min-w-0 shrink`로 전환해 필이 줄어들며 truncate, 카운트는 고정 유지. 1000/1100/1280/1440px 재측정 결과 0 clipped, 1440px 96px 정렬 유지 확인.

## 2026-08-04 — AI 프롬프트 관리(sysadmin) 설계 (feat/ai-prompts-admin)
- 프롬프트 7종(AI 챗 지침·인터뷰어/드래프터 계약·Word 애드덤 2종·추출 계약·반복 넛지)을 sysadmin이 설정 탭에서 열람·수정·기본값 복원하는 기능 설계 확정 — `docs/design/2026-08-04-ai-prompts-admin-design.md`. 신규 `ai_prompts` 테이블(오버라이드만 행 저장, 없으면 코드 기본값), 매뉴얼 관리 패널 편집 패턴 재사용.
- 구현 플랜 작성 — `docs/superpowers/plans/2026-08-04-ai-prompts-admin.md` (태스크 5개: 모델+레지스트리 → API → 빌더 스레딩 → 설정 탭 → 브라우저 스모크).
- 구현: AiPrompt 오버라이드 모델 + prompt_registry(기본값 매핑·오버라이드 조회).
- 구현: /api/admin/ai-prompts GET/PUT/DELETE(sysadmin 전용, 404/422/멱등 복원).
- 구현: 프롬프트 빌더 7표면에 overrides 스레딩(None=기존 상수 폴백, 기존 테스트 무변경 그린).
- 구현: 설정 Content > AI prompts 탭(7종 목록·편집/프리뷰·기본값 복원, MarkdownView 재사용).
- 픽스: 저장/복원 비행 중 프롬프트 전환 경합 차단(리뷰 지적).
- 검증: pw 스모크 10체크 그린(편집·저장·프리뷰·지속성·복원) + 전체 게이트(pytest·ruff·lint·vitest·build).
- 픽스: 스모크 스크립트 실패경로(중간 throw)에서도 finally에서 오버라이드 DELETE 클린업 항상 시도(리뷰 지적 — 이전엔 try/finally라 throw 시 dev.db에 오버라이드 잔존 가능).
- 최종 리뷰 반영: 저장 비행 중 textarea 잠금·스모크 reset 단언 강화.

## 2026-08-03 — 컨테이너 메모리 예약 최적화 (docker-compose)
- 공용 서버(71번) 과예약 방지 — 4개 서비스에 `deploy.resources` 메모리 reservations/limits 명시(예약 합계 ~800M, 상한 합계 ~2.9G: proxy 32M/128M · frontend 256M/768M · backend 256M/1G · db 256M/1G).
- backend에 `MALLOC_ARENA_MAX=2`(glibc arena 증식으로 인한 RSS 팽창 방지), frontend(Next.js standalone)에 `NODE_OPTIONS=--max-old-space-size=512`(V8 힙 상한) 추가. `docker compose config`로 해석 결과 검증.

## 2026-07-30 — 브랜치 최종 리뷰 픽스 배치 (worktree-ai-consultant)
3방향 병렬 리뷰(백엔드 코어·프론트 표면·최근 픽스 회귀) 적발분 중 확정 항목 일괄 수정:
- **[블로커] `InterviewMessage.kind` VARCHAR(12)→(20)**: `sp_suggestion`(13자)이 운영 Postgres에서 extras 커밋을 터뜨려 SP 제안이 무음 유실(sqlite는 길이 미강제라 로컬 그린). `db.py` 부트스트랩에 postgres 전용 ALTER 스텝 추가(배포 시 자동), 선언 폭 회귀 테스트 동반.
- apply-params·sp-accept가 `pending_choices` 미무효화 → 스테일 카드 수락이 방금 반영한 파라미터/SP 치환을 되돌리던 구멍 봉합. 스테일 choice는 502→**409**(TurnError status_code 파라미터화).
- 첨부 추출 AI 콜이 관리자 런타임 차단(app_settings)을 우회 → `is_ai_access_enabled` 게이트.
- FE: fastTrack awaiting이 review 도달 후에도 "이대로 그리기" 클릭을 fast-forward로 인터셉트(백엔드 400 루프) → review에선 일반 턴 폴백+상태 해제. Start over가 fastTrack/readingIds/attachError/canRetry 미리셋 → 전체 리셋. 에러 배너 Retry가 재생 불가 실패(fast-forward·params)에도 노출돼 no-op/무관 턴 재전송 → `canRetry` 게이트. params 표 무변경 blur가 dirty 게이트 뚫던 것 수정 + **SP 행 필드 게이팅**(`getEditableParamFields` — CLAUDE.md 3표면 불변식의 4번째 표면). 체크포인트 revert 실패 무음 → 액션 바 에러 표면화. fast-forward 낙관 문구를 서버 기록과 동일화. 고아 주석·스테일 테스트 주석 정리.
- 백로그(추적만): FE Apply의 잔여 422 입구(end 제목 되돌림 충돌·keep-current 무교정)·에디터 AI 챗 start/end sanitize 대칭·세션 생성 레이스(부분 유니크 인덱스)·모달 뒤 키보드 턴·타이머 정리·같은 스테이지 칩 중복 표현.

## 2026-07-30 — 미리보기 포커스 엣지 하이라이트 (worktree-ai-consultant)
- 노드 클릭 포커스(선택 링+줌) 시 입출 엣지를 액센트로 강조 — 공용 `highlightConnectedEdges`(lib/interview) 신설, 메인 미리보기(키 기준)·복수 안 창(제목 싱크 기준) 양쪽 적용. 빈 키셋은 원본 배열 반환(메모 재사용).

## 2026-07-30 — 시작/끝 중복 안 결정적 교정 — Apply 422 벽돌·전멸 필터 갇힘 해소 (worktree-ai-consultant)
- **갇힘 체인**: AI 안이 시작 2개·같은 제목 끝 2개를 포함해도 가드가 없어 수락됨 → Apply가 `validate_process`(시작 정확히 1개·끝 제목 유니크) 422로 거부 → "시작 1개로 고쳐줘" 재드로는 드래프터 에코가 전멸 필터("같은 안뿐")에 걸려 탈출 불가.
- 수정: `_sanitize_start_end`(orchestrator) — 제안 파이프라인 마지막 단계에서 중복 시작·같은 제목 끝을 **병합**(참조 엣지 생존 노드로 재배선, 병합 유래 자기루프·중복 페어만 정리), 생존자는 이전 작업본 키 우선. 시작 0개는 이전 작업본 시작 복원. 병합 방식이라 고장난 세션에서도 에코 안이 sanitize로 달라져 필터를 통과 → 수락으로 자가 복구 가능. 프롬프트 문구만으론 안 막힌다 계보.

## 2026-07-30 — 수락 시 분기 저장(체크포인트) 누락 픽스 (worktree-ai-consultant)
- **좌상단 분기 저장이 늘 초기 상태**: 그리기가 턴에서 분리(speed redesign)된 뒤 체크포인트는 스테이지 완료(전이) 시점에만 생성 — 수락은 전이 이후라 **전이 없는 수락(패스트트랙 review·리뷰 중 재드로 수락)의 맵이 어떤 체크포인트에도 저장되지 않았다**. 패스트트랙은 일괄 체크포인트가 전부 시드 상태.
- 수정: choice 턴에서 전이 체크포인트가 안 생겼으면 현재 스테이지로 수락본 체크포인트 생성('그대로 유지' 수락은 맵 불변이라 제외). 같은 스테이지 복수 체크포인트는 revert가 최신부터 한 겹씩 벗기는 히스토리로 동작(기존 규칙 그대로).

## 2026-07-30 — 제안 diff 태그를 현재맵 대비로 전환 + 구조 중복 안 제거 (worktree-ai-consultant)
- **동일해 보이는 안 2개 문제**: 내용 포함 서명 도입(설명 병기 통과) 때 안끼리 중복 제거에도 적용된 부작용 — 워딩만 다른 구조 동일안이 둘 다 생존. **안끼리 중복은 구조 서명으로 복원**(현재맵 대비 판정만 내용 포함 유지).
- **변경/추가 태그 미작동**: 안끼리 차이(distinctiveNodeKeys — 안들이 비슷하면 무표시) 폐기 → **현재 작업본 대비 diff**(`diffFromCurrentKeys`: 새 제목=added·같은 제목 설명/attributes 변경=changed, layoutWorkingGraph changed 지원 추가, 비교화면 diff색 뱃지 재사용). keep-current 안은 정의상 무태그.

## 2026-07-30 — 도형 밀착 선택 링 + 복수 안 싱크 포커스 (worktree-ai-consultant)
- 선택 링을 래퍼 outline(추정 높이 박스 — 긴 라벨 노드와 어긋남)에서 **실제 도형(`bpm-node-emph`)의 box-shadow 이중 링**으로 — 알약/카드/마름모(회전 포함) 실측 크기를 그대로 감쌈. z-3 상승 유지.
- 복수 안 미리보기 **싱크 포커스**: 노드 클릭 시 제목 기준으로(안마다 키가 달라서) 모든 창이 동시에 선택 링 + 자기 매칭 노드로 카메라 센터(1.1 줌, centeredForRef 중복 방지). 빈 캔버스 클릭=전 창 해제.

## 2026-07-30 — 온보딩 플래그 맵별 키로 전환 (worktree-ai-consultant)
- 새 맵 온보딩이 안 뜨던 원인 = `bpm.consultOnboardSeen`이 **전역·영구 키** — 컨설턴트를 한 번이라도 쓰면(Start/Dismiss/AI 메뉴 진입) 이후 모든 새 맵에서 비노출. `bpm.consultOnboardSeen.<mapId>` 맵별 키로 전환 — 새 맵마다 안내, 맵당 1회.

## 2026-07-30 — Draw map 서머리 확인 + 백그라운드 선그리기 (worktree-ai-consultant)
- 수동 Draw map 클릭 → **수집 정보 마크다운 서머리 확인 다이얼로그**(`draw-confirm-dialog`, MarkdownView 렌더·`buildDrawSummary`) + 동시에 **백그라운드 선그리기(prefetch)** 시작. 승인 시 이미 완성이면 즉시 제안 모달, 미완성이면 기존 그리기 오버레이로 대기(isDone 플래그로 오버레이 플리커 방지). Not now=응답 무시(draw Cancel과 동일 시맨틱). 자동 draw(draw_due·fast-forward·Retry)는 확인 없이 종전 경로. 스모크 시나리오 추가.

## 2026-07-30 — 선택 링 z 상승 + 프리뷰 노드 호버 글로우 (worktree-ai-consultant)
- 선택 링이 이웃 노드에 가려지던 문제(긴 라벨로 실측 폭>추정 폭 → 겹침, 프리뷰 전 노드 z-2 고정) → `.selected` z-3 상승. 프리뷰·선택지 캔버스에 에디터와 동일한 `bpm-node-emph` 호버 글로우 + 클릭 가능 노드 pointer 커서.

## 2026-07-30 — 포커스 링 실체화 + params 표 전면 개편 3종 (worktree-ai-consultant)
- **선택 노드 링 실체화**: 에디터 선택 효과는 페이지 오버레이 담당이라 selected 주입만으론 무표시였음 → 프리뷰·선택지 캔버스 공용 CSS(`.selected` outline accent 2px) — 클릭 노드=인스펙터 대상이 시각적으로 연결됨.
- **params 표 전 활동 나열**: `deriveParamsEditorRows` — 수집분만이 아니라 작업본의 모든 활동(+맵에 없는 수집 고아 항목 뒤에 유지)을 행으로 — 어느 노드든 채팅 없이 값 입력 가능. "노드 많은데 일부만 보임" 해소.
- **무한 스크롤 + 행 일괄 삭제 + dirty 게이트**: 30행 청크 렌더(하단 근접 시 추가 로드, ParamInput 대량 마운트 방지) · 행 호버 시 Trash 버튼(전 필드 클리어 — **수동 표에서 비운 필드는 서버가 맵 속성도 제거**, AI 경로 빈 값은 종전대로 무시) · Apply to map은 변경 있을 때만 활성.

## 2026-07-30 — 관리자 런타임 AI 차단 토글 (worktree-ai-consultant)
- **AI access 토글(설정, sysadmin)**: app_settings `ai_access_disabled` — GPU 서버 다운 시 재배포 없이 전 AI 표면 차단. 유효 가용성 = env AI_ENABLED AND NOT 플래그(`is_ai_access_enabled`), 게이트 3면 배선: `/api/me` ai_enabled(전 화면 즉시 반영) · 인터뷰 `_require_ai_enabled`(async화, 5개 엔드포인트) · AI 챗/모델 목록 503. FE 설정 AI 챗 패널 상단 스위치 카드(Power 아이콘·차단 중 경고 문구). KB 임베딩은 별도 서버라 미차단(의도).

## 2026-07-30 — params 표 직접 편집 + 제안 미리보기 노드 포커싱 (worktree-ai-consultant)
- **params 수동 편집**: Params 모달 셀을 공용 `ParamInput`으로 편집 가능(Cost는 값+₩/$ 행별 토글 — 반대 통화는 ""로 전송해 facts 잔존값 정리). `POST /apply-params` body `params_table` 수용 — 서버가 **facts 딥머지 → 맵 반영** 순서로 처리해 수동 변경도 AI 컨텍스트(인터뷰어/드래프터·아웃라인)에 남고 기존 반영 노티스가 대화에 기록됨. 무효 필드 소거, 빈 값은 facts만 비우고 맵 속성 유지(클리어는 에디터에서).
- **제안 미리보기 포커싱**: ChoiceCanvas에도 노드 클릭 선택 링+센터 줌(창별 독립, fitView는 그래프 변경 시 1회만 — 클릭 줌 안 되돌림), 빈 캔버스 클릭 해제.

## 2026-07-30 — 프리뷰 노드 클릭 포커싱+줌 (worktree-ai-consultant)
- 컨설턴트 프리뷰에서 노드 클릭 시 선택 링(ProcessNode selected 재사용 — elementsSelectable=false라 selected 직접 주입) + 카메라 센터/줌(축소 상태면 1.1까지, 확대 상태 유지, 400ms). 빈 캔버스 클릭=포커스·인스펙터 해제. 카메라 게이팅(서명)과 독립이라 텍스트 턴 시점 강탈 없음.

## 2026-07-30 — 전멸 필터 내용 포함 서명(설명 병기 통과) + 온보딩 메뉴 경유 seen (worktree-ai-consultant)
- **설명만 바뀐 안 통과**: `_graph_signature(include_content=True)` — 전멸 필터 판정에 설명·attributes 포함. "설명 한/영 병기" 요청이 구조 동일이라 "같은 맵" 노티스로 거부되던 문제 해소. 에코 노드는 델타 복원이 이전 내용을 그대로 살리므로 진짜 무변화 안은 여전히 필터됨(노이즈 재발 없음). FE 카메라 게이팅은 구조 서명 유지(설명 변경 시 시점 안 뺏음).
- **온보딩 seen 보강(6d0e84d)**: AI 메뉴 경유 컨설턴트 진입도 seen 처리 — 말풍선 재노출 틈 봉합.

## 2026-07-30 — 수락=구조 확정 스탬프(재확인·재드로 루프 종결) + 컴포저 busy 잠금 (worktree-ai-consultant)
- **채팅-맵 싱크 이탈 패턴 종결**: 수락 턴 draw 억제(어제)만으론 한 턴 뒤 재발 — 인터뷰어가 스테이지를 완료 처리하지 않고 "이대로 확정할까요?" 재질문 → "네" 답변 턴의 전이가 choice 스테이지발 multi 재드로 유발. **수락 시 choice 스테이지 필수 facts를 수락안에서 서버가 결정적 스탬프**(activities=수락안 활동 제목 배열·branches=디시전 제목/“분기 없음” 폴백) → 같은 턴 전이+체크포인트(수락 턴은 draw 억제) → 인터뷰어는 다음 주제로. 수락 지시문도 "반영 완료·재확인 금지" 명시.
- **컴포저 busy 잠금**: 턴/draw 진행 중 컴포저 위에 스피너+"Waiting for the consultant…" 오버레이(bg-surface/75, cursor-not-allowed) — 흐림만으론 티가 안 나 오버레이로 강화.

## 2026-07-30 — 엣지 연결면 인스펙터 이식 + 현재맵 안 하이라이트 픽스 (worktree-ai-consultant)
- **연결면 편집 인스펙터 추가**: 엣지 우클릭 메뉴의 `EdgeSidesPad`(자립형 200px)를 export해 엣지 속성 폼에 재사용 — 편집 모드에서만 노출, SP 끝점 잠금·`setEdgeSide` 배선은 메뉴와 동일.
- **'현재 맵 유지' 안 오표시**: `distinctiveNodeKeys` 비교 모수에 현재맵 안이 포함돼 무변경 노드가 '추가' 하이라이트되고 다른 안 판정도 오염 → 계산·렌더 모두 same_as_current 제외(NO_HIGHLIGHT 상수 — new Set() 재레이아웃 함정 회피). 현재맵 카드에 "Current map" 대각 워터마크 추가(배지와 이중 표기), 스모크 어설션 포함.

## 2026-07-30 — 핫픽스 2종: 챗 텍스트 복사 가로채기 + AI 버튼 통합 (worktree-ai-consultant)
- **AI 챗 복사 실패**: 캔버스 노드가 선택된 채 챗 본문을 드래그 복사하면 에디터 Ctrl+C(노드 복사)가 preventDefault로 가로채 토스트만 뜨고 클립보드는 불변 — **텍스트 선택(getSelection 비접힘)이 있으면 네이티브 복사로 패스스루**.
- **AI 버튼 통합**: 상단바 컨설턴트(Headset)·AI(Sparkles) 2버튼 → AI 드롭다운 메뉴 하나(AI Chat/AI Consultant). 컨설턴트 항목은 편집 불가 시 비활성 + **래퍼 title로 사유 툴팁**(뷰어 권한/타인 점유/비편집 버전 구분 — disabled 버튼은 마우스 이벤트가 죽어 래퍼에 부착). 온보딩 말풍선은 통합 버튼으로 이식(메뉴 열림 중엔 숨김).

## 2026-07-30 — 컨설턴트 UX 폴리시 16종 (P0~P2, worktree-ai-consultant)
- **P0**: ① 체크포인트 스택 3개 초과 "+N older" 접기 + 코너 소유권 규칙 주석(fast-forward 5개 일괄 생성과 좌하 아웃라인 충돌 방지) ② 채팅 autoscroll 예의 — 바닥 근처만 자동, 위에서 읽는 중엔 스크롤다운 버튼 점 뱃지(stickBottomRef, 본인 전송은 항상 바닥) ③ 첨부 "Reading…" — 업로드 후 추출 9~22초 가시화(칩/플라이아웃/배지, 추출 노티스 파일명 매칭+25s 타임아웃 해제) ④ PDF 아이콘 error→changed(상태색 전용) ⑤ 패스트트랙 armed 칩(iv-fasttrack-chip, Cancel 포함) — invisible 모드 해소.
- **P1**: ⑥ 플로팅 진입 모션 통일(iv-pop 150ms — 오버레이·인스펙터·아웃라인·SP카드·draw카드·재열기칩·params모달, reduced-motion 가드) ⑦ 헤더 진행바 옆 현재 스테이지 라벨 ⑧ 빈 캔버스 고스트 노드+패스트트랙 CTA·워터마크 노드 아래(z-1)로+축소(72px/7%) ⑨ 액션바 재배치(baseline 좌측 그룹 소속·에러 좌측 고정+해제 X·ml-auto 이중 제거) ⑩ 인스펙터 값 있는 행만+빈 상태 문구+설명 스크롤 ⑪ params 표 Cost 열 합침(₩/$ 기호 병기, 배타 계약 표면화)·정식 라벨+title·Escape/백드롭 닫힘.
- **P2**: ⑫ 아이콘 12/16 2단 수렴(칩·플라이아웃·마이크로=12, 기본=16) ⑬ 첨부 안내 모달 버튼 우측 정렬(컨벤션 통일) ⑭ 픽커 ARIA(presentation 래퍼·aria-activedescendant·Escape→컴포저) ⑮ 디바이더 그립 도트·더블클릭 리셋·키보드 리사이즈·pointercancel 정리 ⑯ 카피(placeholder 공백·멘션 [Node:] 언어화·린트 메시지 en 지원) + 종료 컴포저를 "Session finished — Start over/Open in editor" 바로 교체.

## 2026-07-30 — 보기 픽커 노티스 내성 + 질문별 포커스 리셋 (worktree-ai-consultant)
- quickReplies 파생을 "마지막 **비-notice** 메시지" 기준으로 — 첨부 추출 노티스가 질문 뒤에 도착하면 보기가 통째로 사라지던 구멍(패스트트랙 범위 제안 ~9초 뒤 거의 항상 발생) 봉합.
- `QuestionOptions`를 질문 메시지 id로 key — 질문마다 리마운트되어 자동 포커스·선택 인덱스 리셋(마운트 1회 effect 한계 해소, 노출 즉시 ↑↓ 사용 가능). 스모크에 포커스·화살표 이동·노티스 내성 어설션 추가(hover 간섭은 '이동 여부' 판정으로 회피).

## 2026-07-29 — 인터뷰 패스트트랙 + 세분도 표준 10±3 (worktree-ai-consultant)
- **패스트트랙**: 인사 보기 "문서로 바로 그리기" → 첨부 → 자동 범위 제안 턴(AI 1콜, 첨부 본문 컨텍스트) → "이대로 그리기" FE 인터셉트 → `POST /fast-forward`(AI 0콜 — skip 시맨틱 일괄 전진·체크포인트·review 점프) → 자동 multi draw(힌트는 fast_forward 감지로 activities 고정). 문구 단일 소스 FE `FAST_TRACK_*` 상수(BE 인사·룰 15와 글자 동일). 스모크 `pw-smoke-consult-fast.mjs` 신설. 설계 `docs/design/2026-07-29-interview-fast-track-design.md`.
- **어체 간결화(룰 14)**: 인사치레·과격식 금지. **세분도 표준 10±3**: 계약·활동 힌트(표준 10내외/세밀 13~18/간결 6~8)·엔진 goal·린트(7~13) 동기(f735220).

## 2026-07-29 — 새 맵 모달 결재자 하이라이트 배경 반짝으로 교체 (worktree-ai-consultant)
- 오우닝 부서 선택 후 결재자 피커 accent 링(box-shadow 3px)이 모달 인접 요소·클리핑과 겹쳐 깨져 보임 → `picker-flash` 키프레임을 배경색(accent-tint) 1회 반짝으로 교체. 마크업·트리거(flashApprovers)·클래스명 불변, CSS만.

## 2026-07-29 — 하드닝 Phase 4: 제품 (worktree-ai-consultant) — **플랜 전 Phase 완결**
- **T19 톤 결정적 린트**: `app/interview/lint.py`(AI 0콜 — '~하기' 접미·존댓말/서술 어미·활동 수 6±3 이탈 정규식) → draw 옵션 payload `lint`(normal 모드만 — word는 문서 제목이라 비적용) → 카드 헤더 "Tone check N" warn 칩(iv-choice-lint, 툴팁=경고 목록). 자동 수정 없음(표시만) — 앵커·SP·params 사니타이저와 동일 계보의 톤 보증 장치.
- **T20 Apply 멘탈 모델**: 버튼 `Apply & finish` 개명 + 확인 모달에 "세션 종료" 명시 — 상시 노출 전환 후 무심코 눌러 세션을 잃는 불일치 해소. "적용하고 계속"은 백로그. 게이트: BE 856·ruff 0 / vitest 578·tsc 0·lint 0에러·build·스모크 2종. **하드닝 플랜 Phase 0~4 전체 완료 — 다음: GPU 실서버 재검증 → 워드 머지 → main 머지 판단.**

## 2026-07-29 — 하드닝 Phase 3: KB 운영 (worktree-ai-consultant)
- **T16 삭제 맵 청크 수명**: 소프트삭제·영구삭제(퍼지) 시 map 청크 즉시 제거+캐시 무효화(`_delete_map_kb_chunks` — get_effective_role이 삭제 맵을 구분 안 해 검색 필터만으론 계속 주입됨), 복구 시 게시본 백그라운드 재인덱싱, 기동 시 고아 청크 스윕(`db._sweep_orphan_kb_chunks`, 멱등).
- **T17 spawn 강참조 + 쿼리 타임아웃 분리**: `indexing._tasks` set 보관(asyncio 약참조 GC 소실 방지, done 시 discard — 테스트는 잔여 태스크 오염 대비 델타 판정) · `embed_texts(timeout=)` 파라미터화, 검색 쿼리 경로 5s 전용 상한(`retrieval.QUERY_TIMEOUT_SECONDS`) — embed 서버 행 시 턴 60s 블로킹 컷.
- **T18 문서**: kb-embedding.md에 백필 후 러닝 서버 캐시 무효화(재시작) 절차·삭제/복구 청크 수명·재시도 리컨실 백로그 명시. 게이트: BE 851·ruff 0.

## 2026-07-29 — 하드닝 Phase 2: 프론트 UX (worktree-ai-consultant)
- **T12 카메라 게이팅**: `getGraphSignature`(BE `_graph_signature` 동형 — 설명·attributes 무시) 신설, 프리뷰 fitView를 서명 변경 시에만 — 맵이 안 변한 텍스트 턴마다 팬/줌 시점을 뺏던 문제 제거. vitest 2종.
- **T13 draw 탈출구**: 오버레이 Cancel 버튼(iv-draw-cancel) + draw 취소 토큰(늦게 온 응답 무시) — 행 걸림 시 새로고침 없이 채팅 복귀(서버 작업은 계속, 결과는 다음 동기화 때 choices로 표시 가능).
- **T14 숫자 키 2단계**: 보기 픽커 숫자 키=하이라이트만·Enter=확정 — "3일 걸립니다" 오제출(낙관 렌더라 회수 불가) 방지, 푸터 힌트 갱신.
- **T15 소형 3건**: 새 메시지·낙관 수락 시 체크포인트 프리뷰 자동 해제(옛 스냅샷이 최신 캔버스 가림 방지) · 첨부 실패를 `attachError`(iv-attach-error, Retry 없음)로 분리 — 턴 Retry가 무관한 옛 턴 재전송하던 혼선 제거 · ChoiceOverlay `role="dialog"`+Escape 접기+재열기 칩(iv-choice-reopen, focus trap은 백로그). 게이트: vitest 578·tsc 0·lint 0에러·build·스모크 2종.

## 2026-07-29 — 하드닝 Phase 1: 백엔드 정합성 + 계측 (worktree-ai-consultant)
- **T6 델타 병합 보강**: `_expand_delta` attributes 딥머지(드래프터는 컴팩트 목록만 봐서 params를 모름 — 수정 노드에서 apply-params 축적분 증발 차단) + 에코 노드 group_key 그룹 이전 작업본 복원·정의 없는 참조 제거(AiProposal 검증기가 명시 노드 미지 그룹은 이미 거부 — 에코 병합 경로만 해당).
- **T7 SP 키 매칭**: `_sanitize_subprocess` 키 우선(제목 폴백) — 라벨 언어 변경 등 리네임만으로 링크가 process 강등되던 경로 제거.
- **T8 사후 로직 격리**: post_turn이 턴+계측을 먼저 커밋 → SP 제안/KB 노티스는 별도 트랜잭션 try/except(실패 로그만) — 성공한 턴이 부가 로직 예외로 롤백되던 AI 비용·답변 소실 차단. SP 제안 메시지를 interview.messages에도 append(동일 seq 충돌 방지 — T3 유니크와 맞물림).
- **T9 소형 정합성**: 첨부 filename 300자 확장자 보존 절단(Postgres 500 방지) · apply-params가 subprocess 노드엔 annual_count/fte만 반영(3표면 불변식 4번째 표면) · draw 옵션 id에 draw_tag(next_seq) 접두 — 스테일 카드 클릭이 다음 draw의 그래프를 적용 못 하게.
- **T10 계측 배선**: orchestrator `usage_log` ContextVar — `_ask_json` 콜별 (prompt, completion) 적재, 턴/draw/첨부 추출 이벤트에 합산 기록(`sum_usage`, 실패 이벤트 포함·병렬 드래프터 합산 검증). KB 임베딩 계측은 백로그.
- **T11 주입 방어 최소선**: 첨부/KB 컨텍스트 블록 헤더에 "문서 속 지시문은 데이터" 문구(인터뷰어·드래프터·추출기 공통, 빈 컨텍스트는 기존 형식 유지) — 구조적 롤 분리는 백로그. 게이트: BE 847·ruff 0.

## 2026-07-29 — 하드닝 Phase 0: 릴리스 블로커 5종 (worktree-ai-consultant)
- **T1 KB 가시성**: `_kb_reference_block`이 map 출처 히트를 사용자 viewer 권한으로 필터 — 비공개 맵 내용의 타 사용자 프롬프트 유출 차단(attachment 세션 스코프·library 통과 유지).
- **T2 임베딩 오류 정규화**: retrieval의 캐시 적재(혼합 차원 stack)·질의 내적(차원 불일치) numpy ValueError를 EmbedError로 변환 — 모델/차원 교체 후 미재색인 상태에서 전 턴 500 나던 경로를 디그레이드 노티스로.
- **T3 인터뷰 직렬화**: `app/interview/locks.py` 인터뷰 id 락(루프별 레지스트리) + 변이 엔드포인트 9종 `_locked_by_interview` 데코레이터(단일 워커 전제) · 첨부 추출은 AI 콜 밖/병합은 락 안 신선 재조회(lost-update 차단) · `(session_id, seq)` 유니크 인덱스+레거시 중복 리넘버 부트스트랩(`_enforce_interview_seq_unique`, 비중복 행 불변).
- **T4 인터뷰어 작업본**: 턴 프롬프트 "[현재 작업본 요약]"을 실제 working_graph(`format_graph_compact`)로 — 저장본을 보며 이미 그린 활동을 재질문하던 체감 저하 해소(작업본 없으면 저장본 폴백).
- **T5 Retry 이중 제출 방지**: FE 턴 실패 시 `getInterview` 재조회로 마지막 user 메시지(seq·kind·내용) 대조 — 반영돼 있으면 상태 채택·Retry 미노출(504 응답 유실 시나리오). 스모크에 504 유실 턴 시나리오 추가. 게이트: BE 837·ruff 0 / vitest·tsc·lint 0에러·build·스모크 2종 그린.

## 2026-07-29 — 하드닝 플랜 수립 (worktree-ai-consultant)
- 전면 리뷰(블로커 5·M급 다수·제품 6) 코드 검증 후 실행 계획 확정: `docs/superpowers/plans/2026-07-29-ai-consultant-hardening.md` — Phase 0 블로커(KB 가시성 유출·임베딩 차원 500·인터뷰 직렬화·인터뷰어 스테일 그래프·Retry 이중 제출) → Phase 1 정합성+계측 → Phase 2 FE UX → Phase 3 KB 운영 → Phase 4 제품(톤 린트·Apply 명시). **P0+P1 전 main 머지 금지.**

## 2026-07-29 — GPU 실검증 2차 피드백 7종 (worktree-ai-consultant)
- **수락 재드로 루프 차단**: choice 턴은 draw_due multi/single 신호를 억제(params 표 신호만 통과) — Use this option 직후 전이/redraw 신호가 방금 고른 안을 곧바로 다시 그려 제안 모달이 반복되던 회귀 종결.
- **드래프터 최근 대화 동봉**: `build_drafter_messages`에 `[최근 대화]` 블록(6발화·발화당 400자) — facts에 안 잡힌 수정 요청(예: "라벨 전부 영문으로")이 draw에 전달되지 않아 동일안만 나와 전멸 필터("새로 제시할 게 없습니다")에 걸리던 원인 해소.
- **'현재 맵 유지' 안 상시 제공**: draw 결과에 사용자 콘텐츠가 있는 현재 작업본을 `opt-current`(`same_as_current`)로 마지막에 추가 — 카드 좌상단 "Same as current" 배지, 수락=무변경 확정으로 루프 탈출구 겸용(시드뿐인 백지는 생략).
- **담당자/부서 수집 개편**: 담당자(assignee)는 인터뷰에서 수집 금지(에디터 피커 안내만, 인터뷰어 규칙 13+roles goal 개정). 부서는 eligible-assignees와 동일 모수의 `[부서 후보 목록]`을 턴 프롬프트에 주입(상한 80) — 관련 후보 2~4개를 quick reply로 제시+건너뛰기, 목록 밖 부서명 기록 금지.
- **세션 초기화 버튼**: consult 헤더 "Start over"(iv-restart) → 확인 모달 → abandon+새 세션 재개(맵·facts·대화 초기화, draft 불변).
- **Apply to draft 상시 노출**: review 도달 전이라도 맵이 그려진 시점(start/end 외 노드 존재)부터 액션바에 노출 — 언제든 반영·세션 종료 가능.
- **제안 모달 폭 확대**: ChoiceOverlay 1안 92%·2안 48%씩·3안 전폭(max-w-5xl 제거) — 뒤 캔버스는 안 보는 영역이라 가림 허용. **온보딩 z-인덱스 픽스**: 말풍선 z-40 → z-[1100](RF 선택 노드 1000·연결선 1001이 덮던 문제). 게이트: BE 831·ruff 0 / vitest 576·tsc 0·lint 0에러·build·consult/word 스모크 그린.

## 2026-07-28 — 인터뷰 간소화 3종: params 단계 폐지·첨부 추출·첨부 배지·온보딩 (worktree-ai-consultant)
- **params 고정 스테이지 폐지(7→6단계)**: engine STAGES에서 제외(레거시 세션은 get_stage/next_stage_key 폴백으로 review 탈출) — 파라미터는 어느 스테이지에서든 언급 시 `params_table`로 수집(`_merge_facts_namespace`가 스테이지 무관 'params' 네임스페이스로 라우팅), review 진입 시 표 확정 신호(draw_due="params")·Params 버튼 안내는 review goal에 통합. FE INTERVIEW_STAGES 동기(6단계).
- **첨부 시점 정보 추출**: 업로드 파싱 성공 시 백그라운드 AI 1콜 `extract_attachment_facts`(스테이지별 facts+params_table 추출·허용 네임스페이스만 병합·노티스) — 인터뷰 진행 전에 문서에서 최대한 수집. 프론트는 9s/22s 지연 재조회(seq 가드로 구상태 덮음 방지).
- **첨부 칩 잔류 정리**: 컴포저 칩은 "이번 메시지에 보낼" 최근 첨부만(전송·퀵리플라이 시 워터마크로 봉인, 재개 세션은 즉시 접힘) → 툴바 배지(Files 아이콘+개수)·클릭 시 플라이아웃(파일별 아이콘·상태·삭제, 바깥클릭/Esc 닫힘). data-id: iv-attach-badge/iv-attach-flyout(-row/-delete).
- **새 맵 온보딩**: 에디터가 시드 상태(Start/End 2노드 이하·편집 가능)면 컨설턴트 버튼에 accent 링 + "Try the AI consultant" 말풍선(Start=이동, Dismiss, localStorage `bpm.consultOnboardSeen` 1회). 게이트: BE 821·ruff 0 / vitest 576·tsc 0·lint 0에러·build·스모크 3종.

## 2026-07-27 — 인터뷰 속도 재설계 구현 (worktree-ai-consultant, dev 미머지 — AI 독립 라인)
- **Task 1 턴 경량화**: run_turn/skip = 인터뷰어 1콜(재드래프트·선택지·톤 검수 제거), `TurnResult.draw_due`("multi"=구조 스테이지 완료/"single"=review 진입·redraw) 신호 반환 → 라우터가 `InterviewStateOut.draw_due`(비영속)로 전달. 톤 검수 계약·`ToneReviewOut`·`build_tone_messages` 삭제(명명 표준은 드래프터 규칙 2에 통합), `_HISTORY_TAIL` 12→8. 오케스트레이터 테스트 전면 개정(1콜 단언 포함 17종).

- **Task 2 draw 이벤트**: `POST /interviews/{id}/draw`(variants multi/single) — `generate_proposals`(최근 완료 구조 스테이지 힌트·word draft 힌트 신설·무변화 필터 전멸 시 노티스·KB 참조 주입·word 강등 노티스). 작업본은 수락 전 불변, 실패 롤백. API 테스트 5종.
- **Task 3 델타 드래프팅**: `AiNode.title` 필수 해제(키 에코 `{"key":k}` 허용) + `_expand_delta`(exclude_unset 병합 복원·미지 키 무제목 드롭·빠진 키=삭제) + 드래프터 규칙 6(델타 출력)·[현재 작업본] 컴팩트 목록(`format_graph_compact`). 단위 테스트 5종.
- **Task 4 SP 훅 이동**: 유사 SP 제안을 매 턴 스테이지 훅 → 수락(choice) 턴 직후(작업본 갱신 유일 시점)로 이동. kb_pipeline 테스트 choice 시나리오로 갱신.
- **Task 5 프론트 draw 배선**: `drawProposals` API·`draw_due` 자동 트리거(턴 응답)·수동 Draw map 버튼(액션바) · 진행 오버레이(스켈레톤+경과초 `DrawTimer`, 실패 시 Close/Retry) · draw 중 채팅 잠금(busy OR). data-id: iv-draw/iv-draw-overlay/iv-draw-retry.
- **Task 6 아웃라인·배지**: `InterviewStateOut.facts` 노출 + `deriveOutline`/`deriveSequencePreview`(스테이지 순서 평탄화·배열/구분자 시퀀스 추출, vitest 6종) + 좌하단 접기 패널 `interview-outline.tsx`(iv-outline) + 액션바 맵 기준 배지(iv-map-baseline — not drawn/existing draft/up to date/N turns ago).
- **Task 7 스모크·게이트**: pw-smoke-consult 재작성(턴→draw_due 자동 draw→지연 오버레이 검증→3안 모달→수락→아웃라인·배지·SP·체크포인트) + word 스모크 draw 흐름 갱신. 최종 게이트: BE 809·ruff 0 / vitest 574·tsc 0·lint 0에러·build·스모크 3종 그린. **속도 재설계 Tasks 1~7 전체 완료 — dev 미머지(AI 독립 라인 유지)**.
- **후속: 수락 낙관적 반영** — Use this option 클릭이 인터뷰어 1콜(다음 질문)까지 기다려 모달이 얼던 문제: 클릭 즉시 모달 닫고 선택 안을 캔버스에 표시(`optimisticChoice`→`optimisticGraph`), 서버 턴은 typing 상태로 백그라운드 대기·실패 시 모달 자동 복귀. 스모크에 지연 턴(600ms) 목으로 응답 전 렌더 검증.
- **후속: 워드 기능 프론트 가리기** — `lib/features.ts` `WORD_FEATURES_ENABLED=false`(AI 독립 라인 혼선 방지, dev 워드 후속 머지 시 true 복원). 홈 WordDocsSection 미렌더, word-home 스모크는 플래그 인지형(OFF면 섹션 부재 검증 후 종료).
- **후속: 파라미터 표 확정 흐름(AI 0콜 반영)** — params 스테이지는 그리지 않고 `params_table` 구조로 수집(인터뷰어 규칙 9 확장·`_merge_stage_facts` 활동별 딥머지) → 완료 전이 시 `draw_due="params"` → 표 확정 모달(`params-table-dialog`, 액션바 Params 버튼 재오픈) → `POST /apply-params`가 제목 매칭으로 attributes에 즉시 반영(미정/무매칭 스킵·노티스). review 진입 자동 draw 제거(표 반영으로 대체). BE 테스트 6종·vitest 2종.
- **후속: 500 방어** — `_expand_delta`의 노드 검증 예외(예: 이전 작업본 두 통화 공존)가 draw를 500으로 죽이던 경로 차단(병합 실패→원본 복원→드롭, 안 단위 격리) + apply-params 통화 배타 강제(행에 둘 다면 krw 우선·기존 반대 통화 제거). 테스트 2종.

## 2026-07-27 — 인터뷰 속도·타이밍 재설계 설계 확정 (worktree-ai-consultant)
- GPU 실검증 피드백(턴 1~4분·진행 표시 부재·채팅-맵 어긋남) 브레인스토밍 → 설계 확정: **일반 턴=인터뷰어 1콜**(재드래프트·톤 검수 폐지·프롬프트 다이어트) · **그리기=`POST /draw` 이벤트**(구조 스테이지 완료/review 진입/수동 버튼, 동기+진행 오버레이, 맵은 수락 시점에만 변경) · **델타 드래프팅**(기존 노드 키 에코·exclude_unset 복원) · **facts 아웃라인 패널**(AI 0콜)+맵 기준 배지. `docs/design/2026-07-27-interview-speed-redesign-design.md`.

## 2026-07-27 — P2 지식기반 Tasks 7~9 완료: 유사 SP 제안·프론트·문서 (worktree-ai-consultant)
- **Task 7 유사 SP 제안(백엔드)**: `kb/sp_suggest.py` — 분기 없는 연속 process 체인(3+) 추출 → map 코퍼스 top-1(임계 0.65, 자기 맵·기링크 맵·비가시 맵 제외) → activities/review 턴에 `sp_suggestion` 메시지(맵당 1회). 수락은 `POST /interviews/{id}/sp-accept`가 결정적 치환(subprocess 링크 노드+엣지 재배선+노티스, 제안 메시지 superseded).
- **AI 계약 확장**: AI_NODE_TYPES에 subprocess 추가 + orchestrator `_sanitize_subprocess`(이전 작업본에 실존하는 링크만 제목 매칭 유지, 환각은 process 강등 — word 앵커 사니타이즈와 동형). 세션 시드도 링크 있는 subprocess 유지.
- **Task 8 프론트**: AiNode.linked_map_id 스레딩(AI 변환 2곳 — buildGraphFromAiProposal candidate/mergeNode·page aiNodeToGraphNode: 링크 있는 subprocess만 실제 Call Activity로, 무링크는 기존 강등 유지) · 캔버스 SP 제안 카드(iv-sp-card, Replace/Dismiss/새 탭 링크) · 설정 Knowledge base 탭(`kb-manage-panel` — 업로드/목록/Indexed 뱃지/삭제, sysadmin) + i18n 2키.
- **Task 9**: `docs/deploy/kb-embedding.md`(EMBED_* 설정·백필·그레이스풀) + docs 인덱스. 게이트: BE 805·ruff 0 / vitest 566·tsc 0·lint 0에러·build·스모크 3종(consult SP 카드 단언 포함) 그린. **P2 전체 Tasks 1~9 완료 — 실서버 검증 시나리오는 플랜 문서 하단.**

## 2026-07-27 — P2 지식기반 Tasks 4~6: 인덱싱 워커·라이브러리 API·검색 주입 (worktree-ai-consultant)
- **Task 4 인덱싱**: `kb/indexing.py` — 루프별 Semaphore(1) 직렬 워커 + `spawn()`(fire-and-forget), 소스별 인덱서 3종(library 문서·map 게시본 직렬화(이름/설명/활동/흐름, 맵 단위 교체)·attachment 세션 스코프), publish 훅(versions.py 커밋 후)·첨부 업로드 훅·첨부 삭제 시 청크 동반 삭제, `scripts/backfill_kb_maps.py`(기존 게시본 1회 백필).
- **Task 5 라이브러리 API**: `routers/kb.py` — sysadmin 전용 GET/POST/DELETE `/api/kb/documents`(인터뷰 파싱 계약 재사용·chunk_count 동봉·삭제 시 청크+캐시 정리), `KbDocumentOut` 스키마, main 등록.
- **Task 6 검색 주입**: post_turn에서 맵 이름+스테이지 목표+사용자 입력으로 top-k 검색 → `[지식기반 참조]` 블록(출처 표기·4000자 예산·날조 금지 헤더)을 컨텍스트에 추가. 임베딩 실패는 검색만 스킵+세션당 1회 디그레이드 노티스(인터뷰 계속). 비활성 시 완전 no-op(P1 회귀 가드 테스트).
- 테스트 10종 신규(`test_kb_pipeline.py`). 함정: 노드/엣지 id는 전역 PK — 테스트 픽스처 id에 접두 필수(kbm-*). 게이트: BE 801·ruff 0. 남은 Tasks 7~9(유사 SP 제안·프론트 UI·문서). **dev 머지는 사용자 확인 후 진행 예정(미머지)**.

## 2026-07-27 — 인터뷰 시작 시 기존 맵 데이터 파악 오프닝 (worktree-ai-consultant)
- **매번 같은 백지 인사 개선**: 세션 생성 시 draft 그래프를 작업본으로 시드(`_seed_working_graph` — note 제외·AI 계약 밖 타입 process 강등·엣지/그룹/attributes 동반) → 프리뷰가 처음부터 현재 맵을 표시, 드래프터도 기존 구조 위에서 시작.
- start/end 자동 시드 외 실제 내용이 있으면 **데이터 인지형 오프닝**: 파악한 활동 요약(마크다운, 6개 캡) + "기존 맵 보완/처음부터 재정리" quick reply 2개(question payload — 프론트 픽커 자동 렌더). word 모드는 기존 인사에 노드 파악 한 줄 추가.
- 에이전트 계약 보강: 인터뷰어 룰12(기존 맵 우선 — 백지 질문 금지)·드래프터 룰5(기존 작업본 보존 — 백지 재생성 금지, word 애든덤 6~9 재번호). 테스트 2종 추가, BE 791·ruff 0.

## 2026-07-27 — 임베딩 env를 사내 표준 변수명으로 정렬 (worktree-ai-consultant)
- `AI_EMBED_*` 4종 → **`EMBED_URL`/`EMBED_MODEL`/`EMBED_DIM`/`EMBED_TIMEOUT_SECONDS`** 개명(사내 타 임베딩 사용 서비스와 동일 — 그쪽 .env 값 그대로 복사 가능). 인증 없음 확인 → 토큰 필드·Bearer 헤더 제거.
- `EMBED_URL`은 /v1 루트·/embeddings 전체 경로 모두 수용(끝이 /embeddings면 그대로, 아니면 부착). `EMBED_DIM` 설정화(기본 1024). Settings+.env.example+compose 3곳 동시 갱신. BE 789·ruff 0.

## 2026-07-27 — AI 컨설턴트 P2 지식기반 착수: 플랜 + KB 코어 Tasks 1~3 (worktree-ai-consultant)
- 플랜 신설 `docs/superpowers/plans/2026-07-27-ai-consultant-p2-kb.md`(Tasks 1~9, 설계 §7 구체화).
- Task 1: `AI_EMBED_*` 설정 4종(Settings+.env.example+compose environment 3곳 동시) + `app/kb/embed_client.py`(OpenAI 호환 /embeddings, 배치 ≤32, 재시도 1회, EmbedError 정규화).
- Task 2: `kb_documents`/`kb_chunks` 테이블(create_all 자동) + `kb/chunking.py`(500자/오버랩 80/문단 경계 우선).
- Task 3: `kb/retrieval.py` — float32 패킹, numpy 코사인 top-5+임계 0.5, attachment는 세션 스코프, 인메모리 캐시+무효화. numpy==2.3.1 프로덕션 의존성 추가.
- 테스트 12종 신규(`test_kb_core.py`, 임베딩·httpx2 모킹). 게이트: BE 788·ruff 0. 남은 작업 Tasks 4~9(인덱싱 워커·라이브러리 API·검색 주입·유사 SP·프론트).

## 2026-07-27 — 인터뷰 GPU 실검증 2차 피드백 4종 (worktree-ai-consultant)
- **체크포인트 클릭 = 맵 프리뷰 먼저**: 좌상단 체크포인트를 누르면 즉시 revert하지 않고 캔버스만 스냅샷으로 되돌려 보여줌(신규 하이라이트 억제·인스펙터도 스냅샷 기준) + 상단 프리뷰 바(Keep current/Go back here)로 확정 시에만 실제 revert. `InterviewCheckpointOut.working_graph` 노출 추가(백엔드).
- **언어 미러링**: 세션 언어가 영어라도 사용자가 한글로 답하면 한글로 응답하도록 `_LANG_LINE` 계약 확장(ko/en 대칭).
- **선택지 무변화·중복 필터**: `_graph_signature`(제목 기준 구조 정규화 — 임시키·설명·attributes 무시)로 현재 작업본과 동일한 안·서로 중복인 안 제거, 전부 걸러지면 선택지 없이 일반 턴 폴백(TurnError 아님). 테스트 2종 추가.
- **선택지 레이아웃 재설계**: 3안=좌측 큰 창 1+우측 작은 창 2(탭·작은 창 헤더 클릭으로 큰 창 교체), 2안=1:1, 1안=큰 창 하나 — `ChoiceOverlay` 신설(`iv-choice-tab`·`data-focused`). 드래프터 summary는 "이 안만의 차별점 한 줄"로 유도(공통 설명 금지).
- 게이트: BE 776(+2)·ruff 0 / vitest 562·tsc 0·lint 0에러·build·pw-smoke-consult(+word) 그린.

## 2026-07-27 — 개발(dev) 스택 브리지 서브넷 172.42→172.44 (worktree-ai-consultant)
- 서버 지정값 반영: `docker-compose.dev.yml` subnet/gateway를 172.44.0.0/16·172.44.0.1로 변경(172.42는 기존 스택 점유).

## 2026-07-27 — 인터뷰 턴 504 픽스: nginx 프록시 타임아웃·업로드 한도 (worktree-ai-consultant)
- **GPU 실검증 1차 피드백**: 서버 경유(:3333) 인터뷰 턴이 자주 504 — 턴 1회가 순차 AI 호출 3~4회(인터뷰어→선택지→드래프터→톤 검수)로 nginx 기본 `proxy_read_timeout` 60s를 초과, 프록시가 먼저 끊음(백엔드는 계속 처리해 턴은 커밋됨 — 새로고침 시 답변 존재).
- `nginx/default.conf` `/api/`에 `proxy_read_timeout/send_timeout 600s` + `client_max_body_size 25m`(첨부 20MB — 기본 1MB면 413 잠복) 추가. `.env.example`에 느린 GPU는 `AI_TIMEOUT_SECONDS` 120~180 권장 주석.

## 2026-07-27 — Word 임포트 번호 픽스 3차: typedDoc 문서군은 번호 발명 금지 (dev)
- 2차 후 잔여(실물 3차 리포트): 헤딩 스타일의 무번호 **"Note"**가 카운터를 소모해 이후 하위 번호가 밀림. 근본 해법 — **텍스트 번호 문서군(typedDoc: 텍스트 리터럴 번호 제목 2건 이상)에선 문서가 안 보여주는 번호를 파서가 발명하지 않는다**: 무번호 헤딩(Note 등)=무번호 유지+카운터/스택 불변(실문서와 정합), 언어 짝 상속은 유지. 텍스트 번호 권위도 typedDoc에서만 발동 — 자동넘버 문서의 우발적 숫자 선두 제목("3 Way Handshake") 1건이 오발동하지 않게 보호(카운터·제목 분리 모두 미발동). collectHeadings를 2-pass(후보 수집→typedDoc 판정→넘버링)로 재구성. 무번호 섹션 UI는 기존 처리 재사용(패널 "—"·드롭 라벨 filter(Boolean)). word-import 19/19·vitest 570/570·tsc0·lint0.

## 2026-07-27 — Word 임포트 번호 픽스 2차: 짝 상속 기준을 "명시적 번호 헤더"로 일반화 (dev)
- 1차 픽스 후에도 실물에서 한글 짝이 카운터를 밀던 잔여 케이스(목적=2, 1.1→2.1): 영어 제목이 번호를 **텍스트가 아닌 TOC 권위**로 받아 fromText 가드에 걸림. 사용자 제안대로 기준을 일반화 — **명시적 번호(텍스트 리터럴 or TOC)를 가진 헤더가 기준점**, 그 직후 같은 레벨 무번호 제목은 번호 상속(카운터 불변). 인접성도 "바로 다음 문단"→"사이에 빈 문단만 허용(본문 텍스트 끼면 새 섹션)"으로 완화. 카운터로 추측된 번호는 여전히 기준점 아님(자동넘버 연속 형제 1.1.1→1.1.2 보존). word-import 17/17·vitest 566/566·tsc0·lint0.

## 2026-07-27 — Word 임포트 섹션 번호 불일치 픽스 (dev, 실물 문서 이슈)
- 실물 SOP 임포트에서 번호가 문서와 어긋나는 버그(사용자 진단 정확): 번호가 자동넘버가 아니라 **본문 제목 텍스트에 직접 타이핑**된 문서 + 영어/한글 짝이 **Enter(별도 문단)**로 이어지는 구조 — 한글 줄이 같은 레벨 제목으로 집계돼 카운터를 +1씩 밀어 이후 번호 전부 드리프트(3.2→4.2). Shift+Enter 쌍은 한 문단이라 무영향.
- 픽스 2종(`word-import.ts` collectHeadings): ① **텍스트 리터럴 번호 최우선 권위** — 제목 선두 `^(\d+(\.\d+)*)[.)]?\s+` 매치 시 그 번호 채택·제목에서 분리(라벨 "번호 제목" 중복 방지)·카운터 동기화(제목마다 자가 교정 → 드리프트 누적 불가) ② **무번호 언어 짝 번호 상속** — 텍스트 번호 제목 **바로 다음 문단**의 같은 레벨 무번호 제목은 같은 섹션의 언어 짝으로 보고 번호 상속+카운터 불변. 상속은 직전이 텍스트 번호일 때만(fromText 가드) — 자동넘버 문서의 무번호 연속 형제(1.1.1→1.1.2)는 기존 카운터 유지(기존 테스트가 회귀로 적발해 가드 추가). word-import 15/15·vitest 564/564·tsc0·lint0.
- 기존 임포트된 맵은 **재임포트**하면 번호가 교정됨(카탈로그 전체 교체 + 앵커 불변이라 노드 링크 유지).

## 2026-07-26 — Word 맵 AI 컨설턴트 변환 모드 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵의 컨설턴트 = **문서→순서도 변환 컨설턴트**(제안 우선) — word 전용 3스테이지(scope/draft/review, 기존 엔진 재사용)·드래프터 섹션 계약(카탈로그 앵커만 허용·무효 강등 노티스·라벨 서버 재구성)·카탈로그 기본+원본 업로드 권장·AI 변환 2곳 section_anchor 스레딩·기존 섹션 노드 보존. `docs/design/2026-07-26-word-map-ai-consultant-design.md`.
- 구현: word 전용 3스테이지 엔진(WORD_STAGES·mode 파라미터) (Task 1). 761개 테스트 통과, ruff 0.
- 구현: 세션 mode 컬럼 + 생성 분기 + state 노출 + skip 가드 mode 인자 (Task 2). 763개 테스트 통과, ruff 0.
- 구현: 에이전트 word 계약·카탈로그 주입 + AiNodeAttributes.section_anchor (Task 3). format_section_catalog·word 애든덤·mode/section_catalog 파라미터 추가 + 4개 신규 테스트. 767개 테스트 통과, ruff 0.
- 수정(Task 3): AI_NODE_TYPES에 section 추가(word 드래프터 파싱 게이트) — AI_NODE_TYPES 검증 + 회귀 테스트 추가. 768개 테스트 통과, ruff 0.
- 구현: 오케스트레이터 word 앵커 검증(`_sanitize_word_graph` — 무효 앵커 강등·카탈로그 라벨 재구성) + 강등 노티스 + `doc_sections` 라우터→턴 파이프라인 스레딩(`_redraft`/`_generate_choices`/`run_turn`/`_run_skip_turn`, engine 호출 전부 mode 인자) (Task 4). 3개 신규 테스트, 771개 테스트 통과, ruff 0.
- 수정(Task 4): skip-turn 재드래프트 강등 노티스(`_run_skip_turn`·`_redraft` 반환 unpacking) + 정합 로킹 테스트 3개(`test_sanitize_promotes_valid_anchor_on_plain_node`, `test_skip_turn_word_redraft_demote_notice`, `test_stage_complete_with_word_redraft_demote_notice`). 774개 테스트 통과, ruff 0.
- 구현: FE `mode` 노출 + word 3단계 칩(`WORD_INTERVIEW_STAGES`·`stagesForMode`·`stageIndex(key, mode?)`) — consult 페이지 진행 닷·인터뷰 패널 스테이지 칩/디바이더 라벨·프리뷰 체크포인트 라벨 전부 mode 인지(Task 5). `InterviewState.mode` 노출(api.ts). 560개 vitest 통과, tsc 0, lint 0.
- 수정: FE `aiNodeToGraphNode` `section_anchor` 스레딩(Task 6 — AI 변환 2곳 대칭 완성: csv-import buildGraphFromAiProposal 기존·page.tsx aiNodeToGraphNode 신규). 회귀 테스트 추가(buildGraphFromAiProposal 기존 코드로 통과), 561개 vitest·tsc 0·lint 0.
- 검증: word 모드 pw 스모크(`pw-smoke-consult-word.mjs` — 3단계 닷/칩·섹션 노드 프리뷰 렌더) + 원본 `pw-smoke-consult.mjs` 회귀 둘 다 통과, 전체 게이트 실행(Task 7 — 최종). backend pytest 774 passed·ruff 0. frontend vitest 561 passed·tsc 0·lint 0(무관 기존 경고 1)·build OK.
- 리뷰 픽스(최종): `mergeNode`(csv-import.ts)가 제목 매칭된 section 노드를 AI가 process로 에코해도 병합 후 section_anchor가 살아있으면 node_type을 section으로 승격(서버 `_sanitize_word_graph` 규칙의 FE 미러) — 안 그러면 word-export.ts의 "section && anchor" 조건이 깨져 문서 링크가 조용히 사라짐. `agents.py` 카탈로그 삽입이 없앤 일반 모드 프롬프트 개행 1줄 복원 + 개행 스펙 고정 테스트 추가. frontend vitest 562 passed·tsc 0. backend pytest 774 passed·ruff 0.

## 2026-07-26 — 첨부 칩 접기 + 복수/폴더 첨부 리뷰·업로드 진행 (worktree-ai-consultant)
- **칩 목록 접기**: 첨부 칩 5개(약 두 줄)까지만 노출, 초과분은 `+N more` 토글로 펼침/접힘.
- **복수/폴더 선택**: 안내 모달을 Cancel·Choose folder·Choose files 3버튼으로 재구성(폴더는 webkitdirectory — @types/react 미타이핑이라 ref 콜백 부여), 숨김 파일(.DS_Store 등) 자동 제외.
- **리뷰 모달**: 선택 파일을 가능/불가 섹션으로 나눠 표시(확장자 아이콘·크기·불가 사유 뱃지, 섹션당 8행 초과분 +N 요약) — 컨펌 후 순차 업로드. 판정 기준은 백엔드 계약 미러(5종 확장자·20MB).
- **업로드 진행 애니메이션**: 모달 행별 스피너→체크(Done)/실패(Failed) + 버튼 `Uploading n/m…`, 전부 성공 시 자동 닫힘·실패 시 실패 행 유지. 유효 단일 파일은 모달 생략 즉시 업로드(칩 줄 인라인 Uploading 스피너). onAttach는 성공 여부 반환으로 변경(page handleAttach).

## 2026-07-26 — 첨부 칩 확장자 아이콘 (worktree-ai-consultant)
- **파일타입 아이콘**: 첨부 칩에 확장자별 Lucide 아이콘+토큰색 — 시트(xlsx/xlsm/xls/csv)=FileSpreadsheet·added, 프레젠테이션(ppt/pptx)=FileChartPie·changed, 문서(doc/docx)=FileText·accent, pdf=FileType·error, md=FileCode, txt=FileText(뮤트), 그 외 File 폴백. 파싱 실패 칩은 아이콘도 error로 통일. 현재 업로드 포맷(5종) 외 확장자는 표시용 선매핑(백엔드 무변경).

## 2026-07-26 — 채팅 글자 크기 Aa 팝오버 (worktree-ai-consultant)
- **A−/A+ 트리오 → Aa 팝오버**: 액션 줄엔 Aa 버튼 하나만, 클릭 시 플로팅 팝오버(shadow-lg)에서 실크기 A 글리프 4단계(12/13/14/16px)를 직접 선택 — 현재 단계 accent 하이라이트, 바깥 클릭(capture)·Escape 닫힘, 선택 후 입력창 재포커스. 스모크는 팝오버 열기→선택→닫힘 플로우로 갱신(iv-font/iv-font-pop/iv-font-opt-*).

## 2026-07-26 — 인터뷰 채팅 패널 리디자인 7종 (worktree-ai-consultant)
- **컴포저 카드 통합**: 흩어져 있던 툴바·첨부 칩·입력·카운터를 rounded-lg + shadow-md 카드 하나로 — textarea는 borderless, 포커스는 카드 focus-within 테두리, 액션(첨부·A±·Skip·카운터·Send)은 카드 하단 줄.
- **메시지 그룹핑 + 스테이지 디바이더**: 연속 컨설턴트 런의 첫 메시지에만 "Consultant" 헤더(아바타 반복 제거), `message.stage` 전환 지점에 중앙 헤어라인 디바이더 삽입(기존 데이터만 사용, 백엔드 0줄).
- **sticky 스테이지 칩**: 채팅 상단에 현재 스테이지 라벨 + `Stage n of 7`(비활성 시 status) 고정 표시.
- **typing dots**: 스피너+문구 → 점 3개 바운스(기존 `lp-dot` keyframe 재사용), 팁은 ink-muted 캡션으로 톤 다운.
- **보기 픽커 핀 고정**: QuestionOptions를 스크롤 영역 밖 컴포저 바로 위로 이동 — 긴 대화에서도 항상 노출, 키보드 내비·autofocus 유지.
- **스크롤 다운 버튼**: 바닥에서 160px 이상 올라가면 중앙 하단 플로팅 ↓ 버튼(shadow-lg).
- 기존 data-id 전부 유지(pw-smoke-consult 무수정 통과) + 스모크에 iv-stage-chip/iv-composer 단언 추가. lint 0에러·vitest 518·build·스모크 그린, 목업 스크린샷 육안 확인.

## 2026-07-24 — Word 맵 라이프사이클 설계 (dev)
- 브레인스토밍 확정·설계 문서: word 맵=문서 부속 산출물 정체성 → 홈 Maps 탭 내 섹션 분리(조직도·집계 제외)·생성 진입 이동+자동값 축소·워크플로 UI 간소화(셀프 게시)·개정 타임스탬프 2종+stale 배지(N2)·일반 맵 승격 복사(copy 확장, 섹션→process 일괄 변환). `docs/design/2026-07-24-word-map-lifecycle-design.md`.
- 구현: 개정 타임스탬프 2종(doc_imported_at/doc_generated_at) 컬럼·재임포트 스탐프 (Task 1). pytest 24/24 그린.
- 구현: 완결문서 생성시각 기록 엔드포인트 POST /word-doc/generated (Task 2). pytest 703/703 그린.
- 구현: copy convert_to_normal 승격 복사(mode/doc 소거·섹션 노드→process 일괄 변환) (Task 3). pytest 704/704 그린.
- 구현: api 필드/copyMap opts/markWordDocGenerated + word-map-home 파생 헬퍼·vitest (Task 4). vitest 548/548 그린.
- 구현: 홈 분리 — `WordDocsSection`(조직도 밖 문서 평면 목록) + 조직도/즐겨찾기/대시보드는 processMaps만(검색은 word 맵 포함 유지) + 생성 진입은 섹션 "New" 버튼으로 이동, create 드롭다운 Word 항목 삭제. `mode`/`doc_name`/`doc_sections`를 MapDetail 전용에서 MapSummary로 이동(목록 응답 MapOut에 이미 포함 — 홈 분리에 필요) (Task 5). vitest 549/549·tsc0·lint0 그린.
- 구현: `WordQuickCreateDialog` — org_path 보유 유저는 이름만 확인하는 빠른 생성(오우닝 부서=내 org_path·승인자=본인 자동), org_path 없는 유저는 기존 CreateMapDialog 폴백 (Task 6). vitest 549/549·tsc0·lint0 그린.
- 구현: 홈 재임포트 액션 — WordDocsSection onReimport 핸들러 배선 + setWordDoc + 재임포트 모달 (Task 7). vitest 549/549·tsc0·lint0 그린.
- 구현: `MapDetailCard`에 word 맵 문서 메타 블록(문서명·섹션 수·타임스탬프 2종·재생성 힌트)+승격 진입 버튼("Convert to process map", `onPromote` prop) 추가. `latest_version_status` 배지는 이 카드에 애초 없어 숨김 작업 불필요(§4 계약은 카드 밖 대시보드/리스트에서 이미 processMaps만 소비). page.tsx `onPromote` 배선은 Task 9로 이연(다이얼로그 상태 미존재) (Task 8). vitest 549/549·tsc0·lint0 그린.
- 구현: 승격 관문 — `CreateMapDialog`에 `promote` 모드 추가(생성 호출을 `copyMap(mapId, name, {convertToNormal, owningDepartment})`로 교체, visibility 섹션 숨김, 제목 전환) + `page.tsx` `promoteTarget` 상태로 `MapDetailCard`(양쪽 사이트)·`WordDocsSection` `onPromote` 배선 (Task 9). vitest 549/549·tsc0·lint0 그린.
- 구현: 에디터 완결문서 생성 성공 시 `markWordDocGenerated(mapId)` 스탐프(다운로드 비차단, console.warn만) + 재임포트로 사라진 앵커 참조 섹션 노드에 stale 배지(`NodeData.staleAnchor`·`process-node` AlertTriangle) + 섹션 패널 헤더 경고(`staleCount`) — `staleAnchorIds` memo가 `getStaleSectionNodeIds`로 파생, `displayNodes`에 주입 (Task 10). vitest 549/549·tsc0·lint0 그린.
- 검증: 홈 분리 Playwright 스모크(`frontend/scripts/pw-smoke-word-home.mjs`) — 행 노출·생성 진입·조직도 미노출 + 상세카드 단언(`word-doc-meta`·`map-detail-promote` "Convert to process map") 추가. 스모크가 실버그 적발: `WordDocsSection` 행 `onClick`에 `stopPropagation` 누락 → 페이지 배경 클릭 핸들러로 버블링돼 선택이 즉시 해제됨(`map-card.tsx`와 동일 패턴으로 수정) (Task 11, 전체 계획 마지막). 전체 게이트 그린: 백엔드 pytest 704/704·ruff 0 / 프론트 vitest 549/549·tsc 0·lint 0(무관 파일 pre-existing warning 1)·build 성공.
- 전체 브랜치 최종 리뷰 픽스: `copy_map` `owning_department` override가 `create_map`/`set_owning_department`와 달리 `_assert_known_department` 검증을 우회하던 버그 수정(422 가드 추가 + 회귀 테스트) + 홈 재임포트 후 열린 상세카드가 갱신 안 되던 문제를 `detailReloadKey`로 강제 리마운트해 수정. pytest 27/27(test_maps.py)·ruff 0 / vitest 549/549·tsc 0·lint 0(무관 pre-existing warning 1) 그린.
- 홈 좌측 UX 후속(사용자 피드백): ① Word documents 섹션을 조직도 **위**(즐겨찾기 아래)로 이동 — 트리 아래에선 스크롤 밖으로 묻혀 생성 진입을 못 찾음 ② 좌측 접힘 상태(조직도·즐겨찾기·Word·미지정)를 `bpm.home.filters`에 실어 SPA 복귀 시 복원(새로고침은 초기화, 기존 정책 동일 — 복원 시 내 부서 시드 스킵) ③ 조직도 수동 펼침 시 하위 부서가 1개뿐인 구간 연쇄 자동 펼침(`collectSingleChildChain`, org-tree vitest 3종). vitest 552/552·tsc 0·lint 0·pw-smoke-word-home pass.

## 2026-07-24 — 인터뷰 채팅 UX 5종 (worktree-ai-consultant, 실사용 5차 피드백)
- **입력 포커스 유지 + `/` 단축키**: 전송/보기 선택 후 busy 해제 시 입력창 자동 재포커스(보기 픽커가 떠 있으면 픽커 키보드 포커스 양보), `/` 키로 어디서든 입력창 포커스(플레이스홀더에 표기).
- **입력창 반응형**: 1행 min~128px max 자동 확장, maxLength 4000(백엔드 계약 동일) + 3600자부터 카운터 노출. 보내기 버튼은 빈 입력/busy 시 비활성(기존 유지).
- **대기 팁**: 답변 대기 스피너 아래 기능 팁 표시 — AI 챗과 동일 소스(getAiTips 서버 팁, 미설정 시 i18n 폴백) 턴 수 기반 로테이션.
- **첨부 안내 모달**: 첨부 버튼 클릭 시 ConfirmDialog로 제한조건(포맷 5종·20MB) 안내 후 파일 선택.
- **채팅 글자 크기 조절**: A−/A+ 4단계(12/13/14/16px, 기본 13 — 기존 14보다 축소), localStorage(`bpm.consultChatFont`) 브라우저별 저장. `.md` 폰트는 패널 스코프에서 상속 개방.

## 2026-07-24 — 인터뷰 반복 루프 탈출구 (worktree-ai-consultant, 실사용 4차 피드백)
- **결정적 스테이지 스킵**: 미확정 필수 facts를 '미정'으로 채우고 체크포인트 후 다음 단계로 전진하는 skip 턴 구현(기존 스키마의 미사용 "skip" 타입 활용) + 패널 "Skip to next stage" 버튼(review 이전 스테이지 노출) — 모델이 미정 항목을 놓지 못해 같은 질문을 무한 반복하는 루프의 탈출구. review 스테이지 skip은 400.
- **반복 교정 재질의**: 인터뷰어 응답이 직전 컨설턴트 메시지와 거의 동일(유사도≥0.9)하면 1회 교정 재질의 — 실패 시 원 응답 유지(턴 비파괴). 프롬프트에도 "미정도 확정"·"요약 재출력 금지" 룰 추가.
- **redraw 플래그**: 사용자가 "맵 그려줘/갱신해줘"를 요청하면 facts 변화가 없어도 드래프터 실행(InterviewerOut.redraw) — "그림 그리라고 그림" 회귀 대응. 연속 드래프트 블록은 `_redraft` 헬퍼로 통합.

## 2026-07-23 — AI 컨설턴트 인터뷰 모드 설계 + P1 구현 (worktree-ai-consultant)
- **설계 문서**: 전문 컨설턴트가 인터뷰하며 맵을 그려주는 풀스크린 모드 — 고정 7스테이지+적응 스킵·역할 3에이전트(인터뷰어/드래프터/톤 검수자)·선택지 병렬 생성·세션 작업본+체크포인트·bge-m3 지식기반(P2)·RAG 축적(P3)·부하 가드(전역 세마포어 등). `docs/design/2026-07-23-ai-consultant-interview-design.md`.
- **P1 구현 계획**: 백엔드 7태스크(세마포어·모델·엔진·파싱·에이전트·오케스트레이터·API) + 프론트 5태스크(API 클라이언트·consult 라우트·프리뷰/선택지·진입 버튼·pw 스모크) — 태스크별 TDD 코드 포함. `docs/superpowers/plans/2026-07-23-ai-consultant-interview-p1.md`.
- **Task 1 구현**: 전역 `asyncio.Semaphore`로 `call_ai` 동시 호출 상한 강제(ai_max_concurrency, 기본 4) + 설정 3종(interview_choice_count, interview_context_budget) 추가 + .env.example 갱신 + TDD 테스트(동시성 제한 peak≤2 검증) + 기존 49개 테스트 통과.
- **Task 1 수정**: 루프별 세마포어 캐시로 변경(세마포어는 첫 경합 루프에 바인딩되므로 test asyncio.run() 반복 시 런타임 에러 방지).
- **Task 2 구현**: InterviewSession/Message/Checkpoint/Attachment 모델 4종(KST 타임스탐프·FK 무결성·관계 캐스케이드) + InterviewCreateIn/TurnIn/RevertIn/MessageOut/CheckpointOut/AttachmentOut/StateOut 스키마 7종 + TDD 테스트 4개 모두 통과 + 기존 702개 테스트 통과.
- **Task 3 구현**: 스테이지 엔진 — StageDef 데이터클래스 + 고정 7스테이지(scope/io/activities/branches/roles/params/review) + 전이 함수 5종(get_stage, next_stage_key, stage_index, is_stage_complete, first_incomplete_stage) + TDD 테스트 6개 모두 통과 + lint 통과.
- **Task 4 구현**: 첨부 파싱 + 예산 클리핑 — `app.interview.parsing` 신규(PDF/DOCX/XLSX/TXT/MD + cp949 인코딩 폴백) · `clip_to_budget()` 예산 초과 시 섹션별 균등 절단 · 의존성 3종(pypdf·python-docx·openpyxl) 추가 · 테스트 8/8 그린.
- **Task 5 구현**: 에이전트 프롬프트 빌더 + 출력 계약 — `app.interview.agents` 신규(extract_json·InterviewerOut/ToneReviewOut 모델·build_interviewer/drafter/tone_messages 3종 + CHOICE_VARIANT_HINTS) · vLLM 프리픽스 캐시 최적화(고정 프리픽스→문서→facts→히스토리) · TDD 테스트 8/8 그린 + lint 통과.
- **Task 6 구현**: 오케스트레이터 턴 파이프라인 — `app.interview.orchestrator` 신규(run_turn 함수·TurnError·병렬 선택지·스테이지 체크포인트·톤 검수) · 드래프터 병렬 생성(asyncio.gather) · facts 병합·체크포인트·stage 전이 · TDD 테스트 6/6 그린 + lint 통과 + 기존 724개 테스트 통과(총 730개).
- **Task 7 구현**: 인터뷰 API 라우터 — `app/routers/interviews.py` 신규(8 엔드포인트: create/resume·get·turn·attachment·revert·complete·delete + get_active_interview) · 편집자 권한 검증 · AI 활성화 체크(503) · 소유자만 접근(IDOR 404) · 턴 AI 실패 원자성(롤백 + 502) · TDD 테스트 8/8(+ 스키마 4) 그린 + main.py import 등록 + python-multipart 의존성 추가 + lint 통과 + 기존 738개 테스트 통과(총 738개).
- **Task 7 리뷰 픽스**: rollback 후 만료 접근 회귀 — map_id/version_id 선캡처 + 로깅 추가 + 실패 계량 테스트 확장 + python-multipart CVE-2024-53981 핀 상향(0.0.7→0.0.20) + 전체 테스트 738개 그린.
- **Task 8 구현**: 프론트 API 클라이언트 + 순수 헬퍼 — `interview.ts` 신규(INTERVIEW_STAGES 고정 7단계·stageIndex·choiceOptionsOf·addedNodeKeys·layoutWorkingGraph 함수 5종) · `api.ts`에 인터뷰 인터페이스 9종(WorkingGraph/ChoiceOption/InterviewMessage 등) + API 함수 8종(createOrResumeInterview/getInterview 등) 추가 · TDD 테스트 4/4 그린 + npm test 516/516 + tsc 0 에러(interview 범위).
- **Task 9 구현**: 컨설트 라우트 + 인터뷰 패널 — `frontend/src/app/maps/[mapId]/consult/page.tsx` 신규(부트스트랩 효과·상태관리·세션 진입) · `interview-panel.tsx` 신규(메시지 스트림·입력 필드·첨부·스크롤) · `interview-preview.tsx`/`choice-card.tsx` 스텁(Task 10에서 구현 예정) · tsc 0 신규 에러 + npm test 516/516 + npm run lint 통과.
- **Task 9 리뷰 픽스**: 중첩 버튼 + 첨부 stale closure — choice-card 외부 `<button>`을 `<div>`로(내부 버튼 유지·disabled 전파) · handleAttach 스프레드를 함수형 업데이트로(진행 중 턴 응답 낙관적 갱신 방지) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러.
- **Task 10 구현**: 우측 읽기전용 프리뷰 + 선택지 미니 프리뷰 — `interview-preview.tsx` 실구현(ReactFlow read-only 캔버스·EDGE_DEFAULTS로 화살표 스타일 적용·체크포인트 되돌리기+적용 바+충돌 경고) · `choice-card.tsx` 실구현(dagre 좌표 정적 SVG 미니 프리뷰) · 브리프 드래프트 3건 수정(`n.data.title`→`n.data.label`, `outcome.errors.join`→`.map(e=>e.message).join`, ref-in-useMemo를 렌더중 상태조정 패턴으로 대체해 `react-hooks/refs` lint 에러 해소) · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(스텁 경고 3건 해소) + npm run build 통과.
- **Task 11 구현**: 에디터 진입 버튼 — `page.tsx` 헤더 undo 버튼 앞에 `Headset` 아이콘 버튼 삽입(`data-id="open-consultant"`, `readOnly`일 때 비활성, 클릭 시 `/maps/${mapId}/consult?version=${versionId}` 이동) · lucide-react import에 `Headset` 추가 · tsc 4 기존 에러만 유지 + npm test 516/516 + npm run lint 0 에러(기존 경고 1건만 잔존).
- **Task 12 구현(최종)**: `pw-smoke-consult.mjs` 신규(인사→답변→선택지 2안→선택→체크포인트+프리뷰 3노드, `page.route` 전 API 모킹) 그린 · 전체 게이트 그린(백엔드 pytest 738 · npm test 516 · lint 0 에러 · tsc 기존 4건만 · build 성공) · 설계 문서 P1 단순화 3건 반영(§5 `/apply` 삭제 표기→프론트 `buildGraphFromAiProposal`+graph PUT 재사용·`/complete`는 상태 전이만, §6 `ring-added`→`diffStatus("added")`/`--color-added` 실메커니즘, 확인 카드는 P1 질문 문구 대체 명시).
- **Task 12 리뷰 픽스**: NotificationBell 폴링 ECONNREFUSED 소음 제거 — `pw-smoke-consult.mjs`에 `GET /api/notifications` 모킹 추가(`page.route(**/api/notifications*, r => r.fulfill({ json: [] }))`), 스모크 그린 + eslint 통과.
- **최종 리뷰 픽스 5건**: graph PUT이 `version.updated_at`을 갱신해 인터뷰 충돌 경고 신호 정상화(C1) · consult 페이지 인터뷰 언어를 `useI18n().lang`으로 연동(I1) · docker-compose backend env에 `AI_MAX_CONCURRENCY`/`INTERVIEW_CHOICE_COUNT`/`INTERVIEW_CONTEXT_BUDGET` 3종 추가(I2) · `_get_owned_interview`에서 매 접근마다 `assert_map_role(editor)` 재검증(I3, 권한 회수 시 차단) · Retry가 이미 성공한 턴을 재전송하지 않도록 `lastTurnRef` 성공 시 초기화(M1). 회귀 테스트 2건 추가(pytest 740개 그린 + npm test 516개 + ruff/tsc/lint 통과).

- **실사용 피드백 반영(대화 UX)**: 채팅 마크다운 렌더(공용 MarkdownView 재사용)+테마 정비(아바타·버블·노티스) · 인터뷰어 계약을 행동 원칙 중심으로 재작성(제안 우선·되물음 즉답·문서 요청 수행·반복 금지) · review 스테이지 체크포인트/톤 검수 스팸 차단(전이 시에만 실행) · 톤 노티스에 적용 개명 명시("A → B") · 선택 턴 이력에 옵션 id 대신 제목 저장 · 첨부 업로드 시 읽음 확인 노티스. 백엔드 741·vitest 516·스모크 그린.
- **실사용 피드백 2차(레이아웃·인터랙션)**: 채팅 우측 이동+드래그 폭 조절(320~640, localStorage) · 선택지를 채팅 밖 캔버스 플로팅 창 복수개로(안마다 팬/줌 ReactFlow, 선택 시 일괄 닫힘) · 명확화 질문 보기(quick-reply 칩, InterviewerOut.options) · 첨부 삭제 API+칩 × · 캔버스 워터마크+핸들 숨김(비교화면 패턴) · 체크포인트 좌상단 스택(최근 위, max-height 진입 애니) · 노드 호버 "Ask about this" 멘션 버튼(CustomEvent→입력창). 백엔드 743·vitest 516·스모크 그린.
- **질문 툴박스**: 보기(quick reply)를 클로드코드식 선택 UI로 — 화살표 ↑↓ 이동·Enter 선택·숫자 1~9 즉선택·클릭·일반 문자 입력 시 자유답변 입력창 자동 포커스(`question-options.tsx`). 프롬프트에 "보기는 options 배열에만, message 본문 중복 나열 금지" 규칙 추가. 전 게이트 그린.
- **질문 툴박스 Other 행**: 픽커 마지막에 "Other — type my own answer" 명시 행 추가(화살표·Enter·클릭으로 자유답변 입력창 포커스) — 주관식 답변 경로를 가시화.
- **대화 반응성·프리뷰 미세조정**: 보낸 메시지 낙관적 즉시 표시(실패 시 유지→Retry 대상 가시화) · 점 격자 제거(프리뷰+선택지 창 민무늬 캔버스) · 복수 제안 간 차이 노드 하이라이트(`distinctiveNodeKeys` — 전 안 공통 아닌 제목만 diff 표시, vitest 2건). vitest 518·스모크 그린.
- **연속 드래프팅 + 파라미터 컨설팅**: facts 갱신 턴마다 드래프터가 작업본 재생성(맵 라이브 갱신 — 선택지 시점에만 그리던 회귀 해소, 실패는 턴 비파괴) · 톤 검수는 그래프가 실제 바뀐 턴만 + '~하기' 개악 금지(플립플롭 차단) · params 스테이지를 체계 설명+활동별 확인 방식으로 강화, 드래프터 attributes 임의 추정 금지 · 프리뷰 노드 클릭 인스펙터(담당·시스템·6파라미터 카드). 백엔드 745·vitest 518·스모크 그린.
## 2026-07-22 — Word 맵 섹션 링크 (구현 완료, worktree-word-map-sections)
- Word(.docx) 맵 전용 모드: 순서도 도형이 문서 내부 앵커(`w:anchor`)로 링크 — 산출물 복사→원본 SOP 붙여넣기 시 섹션 점프 활성. 설계 `docs/design/2026-07-18-word-map-section-linking-design.md`.
- 백엔드: 노드 `section_anchor` 컬럼·맵 `mode`/`doc_name`/`doc_sections`+생성/복사·`PUT /maps/{id}/word-doc` 재임포트.
- 파서(`word-import.ts`, read-only): TOC 하이퍼링크 활성앵커+번호(1~2단계 권위) + `styles.xml` `outlineLvl` 본문 제목 워크 + 3단계+는 TOC 부모 씨앗·로컬카운터로 번호 재구성. 실물 SOP 구조 반영(커스텀 제목 스타일·자동 다단계 넘버·`_Toc` 잔재 중복·5단계+). 문서 0 수정.
- 프론트: `section` 노드타입·섹션 패널(라이브러리 미러)·5개 접근포인트 word맵 게이팅·섹션 드롭 노드생성(`section_anchor` 그래프 라운드트립 저장)·홈 "Word 문서로 만들기" 진입·재임포트.
- 내보내기: 섹션 노드 도형 두 링크 공존 — 1행 라벨 첫 공백토큰만 `w:anchor` 내부링크(+나머지 plain), 2행 url 라벨 외부링크. 도형 1.5cm×3cm 통일(튜닝 상수). Word 버튼은 word맵 전용 노출.
- 게이트 그린: 백엔드 701 pytest·ruff / 프론트 527 vitest·tsc0·lint0·build.
- **미검증(배포 전 수동 필수)**: ① Windows Word 실물 — 산출물 열기→그룹 복사→원본 SOP 붙여넣기→섹션 도형 클릭 시 해당 섹션 점프 + url 라벨 클릭 시 외부 링크. ② **실물 .docx 임포트 파싱 육안 검증**(literal XML 미확보 — 픽스처는 표준 Word TOC 구조 기준). ③ 도형 1.5×3cm·엣지 라우팅 시각 튜닝(design §7). 맵 탭 표현은 다음 세션 보류.
- 후속(dev): 섹션 드롭 노드 라벨을 `번호 제목`으로(제목 텍스트 기본 포함) — 내보내기 첫토큰 분할과 호환(번호만 앵커 링크).
- 후속(dev): **실물 진단** — 문서 제목 스타일(SBL_Text N_Kor/Eng)이 `outlineLvl` 감지 실패(level=0) + 제목 문단에 책갈피 없음(withBookmark=0). 그래서 현재 파서는 TOC 책갈피 달린 소수만 잡아 3단계+ 누락. → ① **스타일 이름 숫자로 레벨 감지**(levelFromStyleName, "SBLText3Kor"→3) ② **책갈피 없는 제목도 합성 앵커(`_bpmsec<n>`)로 노출**. 이제 전 레벨이 목록에 뜸(링크 성립은 다음: 출력 시 사본에 그 앵커명으로 책갈피 주입 = 완결 문서 생성). word-import 8/8.
- 후속(dev): 실물 눈검증 픽스 3종 — ① **빈 제목 문단(블랭크) 제외**(유령 항목·번호 오염) ② **TOC 제목 매칭**으로 책갈피 없는 1~2단계 제목이 권위 번호를 받아 언어별 카운터 리셋(번호 9→14 초과 해소) ③ **어펜딕스 무번호**. word-import 11/11. 다음: 완결 문서 생성(책갈피 주입+그래프 페이지).
- 후속(dev): **언어 필터** — 이중언어 SOP(영문/국문 두 트리)에서 스타일명 접미사(Kor/Eng)로 각 섹션에 `language`(ko/en) 태그(SectionEntry·SectionEntryIn), 섹션 패널에 All/KO/EN 토글(2개 이상일 때만). 영문 쪽 빈 제목은 이미 blank-skip으로 제거돼 국문 트리가 정확. word-import 12/12·백엔드 그린.
- 후속(dev): **완결 문서 생성기**(`word-doc-generator.ts`) — 원본 SOP 사본에 합성 앵커(`_bpmsecN`) 책갈피 주입(제목 걷기 `collectHeadings` 공유로 순번 동일 보장) + 순서도 새 페이지 append(마지막 sectPr 앞, 네임스페이스 보강·docPr/relId 충돌 재부여·rels 병합). opus 리뷰 READY(4대 불변식·리팩터 바이트동일 확인). vitest 541·tsc0·lint0·build 그린.
- 후속(dev): 완결문서 생성 **UI 배선** — 인스펙터 "Generate complete document" 버튼(원본 .docx 선택 → `generateCompleteWordDoc` → 다운로드, word맵 전용) + Word 내보내기와 export 모델 헬퍼 공유. 임시 진단 로그 제거. **미검증(수동)**: Windows Word에서 생성된 .docx 열어 도형 클릭 시 섹션 점프 실물 확인.
- 후속(dev): 내보내기 미세조정 3종 — ① **도형 정확히 1.5×3cm**(word맵은 `computeLayout` fit-to-page 끔=scale1, 상수도 1,080,000/540,000 EMU 정확값; 스프레드 시 페이지 초과 가능) ② **엣지가 도형 변 중점에 붙게** — 커넥터 `stCxn/endCxn`(미검증 프리셋 idx) 제거, off/ext(getSideAnchor)가 선 끝점 직결 ③ **도형 텍스트 8pt 통일**(FONT_HALF_PT 22→16). word-export 21/21·전체 그린. **실물 육안 튜닝 필요**.
- 후속(dev): 실물 임포트 픽스 — ① **섹션 필드 클램프**(파서가 title 500·anchor 200·number 50자로, 백엔드 SectionEntryIn 한도 초과 시 422 방지; 과도 title은 대개 오검지) ② **도형 텍스트 볼드 제거**(사용자 요청). word-import/export 42/42.
- 후속(dev): ① **캔버스 1페이지 경계**(word맵 전용, ViewportPortal flow좌표 점선 박스 ~565×894px = A4 가용−패딩) — 크기 감각·1페이지 안착 가이드 ② **엣지 커넥터 straightConnector1**(bentConnector3가 정렬 노드서 폭0 박스로 붕괴해 화살표가 노드에 안 붙던 문제 → 직선, 끝점이 변 중점에 확실). word-export 21/21.
- 후속(dev): 엣지 커넥터 재설계 — ① **stCxn/endCxn 복원**(도형에 실제 연결 → Word에서 노드 이동 시 선 따라옴; 이전 제거로 "화살표만 덩그러니" 남던 문제 해결) ② **cxn idx 정정** left0/top1/right2/bottom3(ECMA flowChartProcess cxnLst 순서; 기존 top0/left1/… 뒤바뀜) ③ **정렬이면 straightConnector1, 어긋나면 bentConnector3**(접점 정렬 여부로). word-export 22/22. **실물 검증 필요**(idx가 특정 프리셋서 다르면 매핑만 조정).
- 후속(dev): 한글 기본 폰트 바탕체 → **돋움**(word-export rFonts w:eastAsia).
- 후속(dev): **엣지 연결 변을 노드 상대 위치로 유도**(word맵) — 캔버스 핸들이 폴백(right/left)으로 어긋나 출력이 실제 연결과 안 맞던 문제(예: Start 위→아래인데 출력 right→left). 노드 중심 dx/dy로 위/아래·좌/우 변 결정 → 레이아웃 일치. 일반맵은 기존 핸들 유지.
- 후속(dev): 엣지 커넥터 — 여러 차례 실물 반복 끝에 **cxn 최우선**으로 확정: ① stCxn/endCxn 복원(도형 연결 → 노드 이동 시 선 따라옴) ② 변은 **노드 위치로 유도**(폴백 right/left 문제 해소 — 이전 "우측→아래"의 근본 원인이 폴백 변) ③ idx=SIDE_TO_CXN_IDX(left0/top1/right2/bottom3, flowChartProcess 기준) ④ 정렬=직선/어긋남=꺾은선. 잔여: 디시전/터미네이터 cxnLst 순서가 다르면 그 타입만 idx 조정 필요(실물 확인). word-export 22/22.

## 2026-07-20 — 문서 카테고리 폴더 재구성 + CLAUDE/rules 점검 + PROGRESS 아카이브 (main)
- **폴더 재구성(git mv, 이력 보존)**: docs/ 최상위 loose 문서를 카테고리 폴더로 이동 — `docs/deploy/`(deploy·db-seed·db-migration-9910) · `docs/qa/`(alarm-audit·ai-connectivity-test·ai-real-model-smoke) · `docs/design/`(구 `superpowers/specs` 25개 + version-lifecycle-summary). `spec.md`는 코드 15+곳이 참조해 루트 유지.
- **배포 문서 통합**: 과거 1차 `db-migration-9800` 삭제, `9910`을 `docs/deploy/`로. 내부 참조(9800·deploy.md 상대경로) 정리.
- **참조 전수 갱신**: 코드 주석 13파일(`docs/superpowers/specs/`→`docs/design/`, 서브에이전트)·문서/설정 ~20곳. stale 경로·broken 링크 0 검증. `docs/README.md`·`docs/design/README.md` 인덱스 갱신.
- **CLAUDE.md·rules 점검**: `page.tsx` 줄수 6700→9400 갱신(CLAUDE·frontend/AGENTS). `rules/common/documentation.md`에 docs 구조·유지관리 룰 추가(카테고리·설계 문서 경로 참조 불변식·PROGRESS 아카이브 관례).
- **PROGRESS 아카이브**: 전체 이력을 `docs/history/PROGRESS-archive.md`로 스냅샷 보존, 루트는 요약으로 축소.

## 2026-07-20 이전 (요약)
아래 항목들의 상세는 아카이브 참고 — 이번 세션(2026-07-20) 주요 작업:
- **홈/새맵 UX**: 빈 부서 숨김(내 부서 유지)·문서 상태 도넛 재디자인(호버 경계 잘림 방지)·최근맵 삽입 시 전체 밀림 애니·뒤로가기 선택해제·부서미지정 접기·오우닝 선택 시 승인자 피커 반짝·인스펙터 Subprocess 탭 맨끝 이동.
- **서브프로세스 노드 이름 라이브화**: 링크맵 개명이 참조 노드 라벨에 즉시 반영(`SubprocessRefOut.name` 추가, injectSubEnds/outline 라이브 렌더).
- **일괄편집 모달 폭**: 속성 3열 버튼 라벨 오버플로 해소(`w-96`→`w-[29rem]`).
- **완료 기능 문서 정리**: `docs/superpowers/plans/`·`DEV-SERVER-TEST-PLAN.md` 삭제(specs 유지).

> 2026-07-19 이하 및 위 항목의 커밋 단위 상세: [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md) · git history.

## 2026-07-20 — 문서 카테고리 인덱스 신설 (main, 문서 검토)
- `docs/README.md` 신설 — 전체 문서를 카테고리별(핵심 참조·배포/DB·QA·매뉴얼·교훈·설계 기록·공지·샘플)로 묶은 목차.
- `docs/superpowers/specs/README.md` 신설 — 25개 설계 스냅샷을 분야별(에디터·서브프로세스·파라미터/내보내기·CSV·AI·권한/워크플로·대시보드·UI)로 1줄 요약·링크.
- 파일 이동은 하지 않음 — specs는 코드 주석 13곳이 정확한 경로로 참조하고, deploy/db-seed 등도 참조 다수라 이동 시 링크가 깨진다. 인덱스로 탐색성만 개선. `CLAUDE.md` 디렉터리 설명에 인덱스 포인터 추가. 링크 유효성 전수 확인(끊김 0).

## 2026-07-20 — 완료 기능 문서 정리 (main, 검증 종료 후)
- 삭제: `docs/superpowers/plans/`(24개 구현 플랜) + 루트 `DEV-SERVER-TEST-PLAN.md`. 전부 git history 보존. `docs/superpowers/specs/`(설계 provenance)는 코드 주석·`docs/spec.md`가 참조하므로 유지.
- 끊긴 참조 정리: `docs/db-migration-9910.md`(테스트플랜 포인터 3곳→스모크 문구), `docs/lessons/scope-save-and-coordinates.md`(삭제 플랜 링크 제거), `docs/lessons/README.md`·`CLAUDE.md`(디렉터리 언급 `plans·specs/`→`specs/`). 워크트리(dev·word-map-sections)는 유지.

## 2026-07-20 — 그룹 일괄편집 모달 폭 확대(속성 버튼 오버플로 해소) (dev)
- **증상**: 일괄편집 모달의 속성 선택(`grid-cols-3`, MODE_META 8개) 버튼에서 긴 영어 라벨("Duration / run (h)" 등)이 `whitespace-nowrap`+`justify-center`라 버튼 폭을 넘어 아이콘이 버튼 밖으로 삐짐.
- **수정**: 모달 폭 `w-96`(384px) → `w-[29rem]`(464px). 실측(Pretendard 14px): 최장 버튼 135px, 3열 최소 445px 필요 → 464px는 여유. 한국어(최장 418px)도 커버. 영어 기준 산정.
- 파일: `frontend/src/components/group-bulk-modal.tsx`.
- 검증: build·lint OK. 실제 버튼 클래스 격리 렌더 실측 — 384px에서 4개 버튼 오버플로(내용>버튼) → 464px에서 전부 fit(오버플로 0). (dev.db에 데모 그룹 없어 실모달 트리거 불가 → 동일 클래스 렌더로 검증.)

## 2026-07-20 — 서브프로세스 노드 이름이 링크맵 개명을 안 따르던 버그 픽스 (dev)
- **증상**: 맵 이름을 바꿔도 그 맵을 서브프로세스로 링크한 다른 맵의 노드 라벨이 예전 이름 그대로.
- **근본 원인**: subprocess 노드 라벨은 링크맵 이름 고정(비편집, `process-node.tsx` F5)인데, 값이 링크 시점의 `node.title` **저장 스냅샷**이었다. dept/assignee 등 다른 SP 어트리뷰트는 `subprocess_refs`로 라이브 해석하는데 **이름만 라이브 소스에 없었음**.
- **수정(아키텍처 정합·라이브 해석)**: `SubprocessRefOut`에 `name`(링크맵 현재 이름) 추가 → 캔버스(`injectSubEnds`)·아웃라인이 `ref.name`을 라이브 라벨로 렌더(저장 스냅샷은 폴백). **저장 노드 title·게시본은 불변**(display 전용 주입) — 불변 버전 변형 없이 표시만 갱신.
- 파일: `backend/app/schemas.py`(SubprocessRefOut.name)·`backend/app/subprocess.py`(ProcessMap.name select)·`backend/tests/test_subprocess_designation.py`(개명 라이브 반영 테스트)·`frontend/src/lib/api.ts`(SubprocessRef.name)·`frontend/src/app/maps/[mapId]/page.tsx`(injectSubEnds liveLabel·outline liveName).
- 검증: ruff·pytest 696(신규 1 포함)·frontend lint 0·build OK. API 실검증(v12): 맵1 개명 전 refs.name="Order Fulfillment"→개명 후 "Order Fulfillment RENAMED". 브라우저(맵2 v12): 캔버스 노드·아웃라인 모두 새 이름 렌더 확인. (후속 검토: WBS/Excel/Word export는 저장 title을 읽어 여전히 스냅샷 — 별도 표면.)

## 2026-07-20 — 홈/새맵 UX 후속 3종 (dev)
- **부서 미지정 접기**: `OrgAccordion`의 "부서 미지정" 섹션을 부서 노드와 동일한 chevron 토글로 — `unassignedOpen`(page.tsx, 기본 열림) + `onToggleUnassigned` props. Collapse all이 부서 트리와 함께 미지정도 접도록 `setUnassignedOpen(false)` 동시 호출.
- **승인자 피커 반짝**: 새 맵 다이얼로그에서 오우닝 부서 선택 시 결재자 피커로 스크롤될 때 accent 링이 1회 반짝(`picker-flash` keyframe). `applyOwningDept`(이벤트 핸들러)에서 `setFlashApprovers(true)` + 850ms 타이머 리셋(모션 설정 무관 리셋, set-state-in-effect 린트 회피). 결재자 섹션 래퍼에 `motion-safe:animate-[picker-flash...]`.
- **최근 목록 전체 밀림**: top 변경 시 첫 행만 강조하던 걸 확장 — 새 최상단(i0)은 `recent-insert`, 나머지 기존 행은 `recent-shift`(`translateY(calc(-100% - 0.5rem))→0`, 자기높이+gap 한 슬롯, 픽셀 상수 없는 FLIP)로 한 칸 아래로 밀림.
- 파일: `components/maps/org-accordion.tsx`·`app/page.tsx`·`components/permissions/create-map-dialog.tsx`·`components/maps/recent-opened-list.tsx`·`app/globals.css`(picker-flash·recent-shift).
- 검증: lint 0 err·`next build`(TS) OK·vitest(org-tree 5/5). 브라우저 실기동(3200/8901, admin.sys): ①미지정 토글 접힘/펼침·Collapse all이 함께 접음 확인, ②오우닝 선택 시 결재자 섹션에 `picker-flash` 클래스 적용됨을 MutationObserver로 확인(automation 탭 백그라운드라 CSS 애니 tick은 스로틀·클래스 적용=로직은 확정, 포커스 사용자에겐 재생), ③top 변경 시 i0=`recent-insert`·i1~3=`recent-shift` 확인.

## 2026-07-20 — 홈(Maps 탭) UX 4종 + 인스펙터 Subprocess 탭 위치 (dev)
- **빈 부서 숨김(내 부서 유지)**: `buildOrgTree`에 `keepEmptyPaths` 인자 추가 — `mapCount===0` 부서 가지치기, 단 내 `org_path`의 모든 접두 경로는 앵커로 유지(맵 없어도 표시). `page.tsx`가 `me.org_path` 접두 집합을 전달. 유닛 테스트 1건 추가.
- **도넛 재디자인 + 호버 잘림 방지**: `charts/donut.tsx` — 옅은 트랙 링 + 세그먼트 얇은 gap(다중만) + 중앙 합계에 `total` 캡션 + 선택 시 나머지 dim(0.3). **잘림 진범**: 선택 세그먼트가 `stroke+3`으로 굵어지는데 반지름이 여유 없이 잡혀 viewBox 밖으로 삐짐 → `r`을 `SELECT_GROW+EDGE_PAD`만큼 축소(최대 외곽 102 ≤ 104 검증). `donut-geometry.ts`에 `gap` 인자(기본 0=기존 계약). 승인 카드도 공용 Donut이라 동시 개선.
- **최근 맵 "위에 추가됨" 인지**: top 변경 시 전 행 스태거(자기상쇄로 밋밋)를 폐기 → **새 최상단 행만** `recent-insert`(750ms, translateY + accent 링이 번졌다 사라짐), 나머지는 정지 → 하나가 위에 끼워진 느낌. `slideDown` keyframe 제거(미사용).
- **뒤로가기 → 선택 해제**: 대시보드에서 맵 클릭해 상세로 "이동"한 걸 브라우저 Back으로 되돌림 — `null→선택` 전이에만 `pushState`, `popstate`에서 `setSelectedId(null)`, UI 해제 시 `history.back()`으로 항목 소비(정합). 선택 간 전환은 항목 1개 유지.
- **인스펙터 Subprocess 탭 → 맨 끝(5번째)**: `inspector-panel.tsx` 탭 조립을 `[...TABS, subprocess?, import?]`로 변경 → Properties·Map·Approval·Activity·**Subprocess** 순(활동/코멘트 탭 뒤).
- 파일: `lib/org-tree.ts`·`org-tree.test.ts`·`app/page.tsx`·`lib/donut-geometry.ts`·`charts/donut.tsx`·`maps/status-donut-card.tsx`·`maps/approvals-card.tsx`·`lib/i18n-messages.ts`(home.donutTotal EN/KO)·`maps/recent-opened-list.tsx`·`app/globals.css`·`components/inspector-panel.tsx`.
- 검증: lint 0 err·`next build`(TS·React Compiler) OK·vitest 512/512. 브라우저 실기동(3200/8901, admin.sys=System Team 소속·맵0): ①조직도 루트+중첩 모두 빈 부서 제거·Management Center 체인만 앵커 유지 확인, ②도넛 외곽 102≤104(선택 세그먼트 코너 육안 무잘림)·트랙/gap/캡션 확인, ③top 변경 시 li[0]만 `recent-insert` 나머지 `none`, ④선택→Back=홈 유지+대시보드 복귀·UI 해제도 정합, ⑤/maps/1 인스펙터 탭 순서 Properties·Map·Approval·Activity·Subprocess 확인.

## 2026-07-20 — 펼침 영역 틴트 상하 경계(바운드 박스) + wrap 높이 함정 해결 (dev)
- **틴트 바운드**: `InlineRegionBands`가 화면 전체 높이 무한 레인(좌우선만)에서 **콘텐츠 Y범위 박스**로 전환 — `box.y/height`(ViewportPortal flow 좌표) 사용, 상하좌우 테두리 + 라운드(12). 뷰포트 구독(`useViewport`/`useStore`) 제거(box 좌표가 flow라 불필요, FocusScopeBands는 유지).
- **바깥이 안을 덮음(중첩)**: `buildScope`가 모든 영역의 `y/height`를 **전체 콘텐츠(모든 깊이) 공통 범위**로 산정 → 중첩 시 바깥·안 박스의 상하가 동일해 바깥이 안을 항상 덮음(추가 로직 불필요).
- **wrap 높이 함정**: 세로 경계가 `nodeSizeOf.h`(고정 52) 기준이라 wrap으로 커진 노드가 박스 아래로 삐져나올 수 있었음. `estimateNodeHeight()`(타이틀 wrap 줄 수 기반)로 펼침 자식 주입 높이를 실측화 + 두 Y-bbox 루프가 `measured.height` 우선 사용. 필드/파라미터 줄은 REGION_MARGIN(48)이 흡수(근사).
- 파일: `lib/canvas.ts`(estimateNodeHeight·공용 상수), `app/maps/[mapId]/page.tsx`(InlineRegionBands 박스 렌더·자식 주입 높이·Y-bbox measured).
- 검증: lint 0·build OK·유닛 35/35. 브라우저 실기동(3200/8901, 맵1에 map3 링크 중첩 서브프로세스 임시 삽입·map3 자식 하향 후 원복): 박스 바운드(h 유한·둥근 모서리), 바깥/안 박스 상하 동일(t=471·b=877, A⊃B), 최하단 깊은 중첩 노드(b=862)를 박스 하단(877)이 덮음, wrap-tall 자식 포함 — DOM 좌표로 확인.

## 2026-07-20 — 작업/터미널 노드 라벨 wrap + 서브프로세스 펼침 우측 경계 포함 (dev)
- **wrap**: process·start·end 노드에 `max-w-[240px] break-words` — 긴 라벨이 240px에서 여러 줄로 줄바꿈(짧은 라벨은 기존 `min-w` 컴팩트 유지, 무공백 토큰은 break-words로 분절). decision(`max-w-20`)·subprocess(`w-[180px]`)는 이미 wrap이라 무변경.
- **펼침 경계**: 인라인 펼침 자식은 React Flow가 측정 못 해 `measured`를 직접 주입하는데, 폭을 고정 근사(`nodeSizeOf`, process=170)로 넣어 긴 라벨(실폭≤240)이 region 우측 border를 빠져나갔다. `estimateNodeWidth()`(offscreen `measureText`로 타이틀 실폭 추정, `[nodeSizeOf, NODE_MAX_WIDTH]` 클램프)로 자식 주입 폭을 실폭화하고, buildScope bbox가 `measured.width` 우선 사용 → 경계가 자식을 감쌈. 실폭 추정이라 짧은 노드엔 빈 레인이 안 생기고, 긴 노드는 상한(240)에서 포함.
- 파일: `lib/canvas.ts`(NODE_MAX_WIDTH·estimateNodeWidth), `components/process-node.tsx`(wrap 클래스), `app/maps/[mapId]/page.tsx`(자식 주입 폭·bbox measured 우선).
- 검증: lint 0 err·`next build` OK(TS·React Compiler)·유닛 35/35. 브라우저 실기동(3200/8901, 맵2 서브프로세스 펼침, 맵1 자식 라벨 임시 장문화 후 원복): 긴 process·End 자식 240px·다줄 wrap 확인, region 우측 border가 최우측 자식보다 REGION_PAD(28px)만 바깥으로 포함 확인. 세로(높이) 경계는 이번 범위 밖.

## 2026-07-20 — 복사(Ctrl) 관련 마이너 버그 3건 (worktree-copy-paste-fix)
- ① **Ctrl+클릭 시 컨텍스트 메뉴가 열리던 문제** — macOS는 Ctrl+클릭=네이티브 우클릭이라 `contextmenu`가 발화. 모든 메뉴의 단일 초크포인트 `openMenu`에 `event.ctrlKey` 가드 추가(`preventDefault`는 유지→네이티브 메뉴도 억제). Ctrl은 복사 modifier이므로 Ctrl+드래그 복사와의 충돌 제거. node/pane/edge/selection/group 전 표면 커버.
- ② **End 노드 복사 시 대표끝(`isPrimaryEnd`)이 중복되던 문제** — 복사 두 경로(`node-clipboard.ts buildPaste`=Ctrl+C/V, `applyCtrlDragCopy`=Ctrl+드래그)에서 사본 data에 `isPrimaryEnd:false` 강제(groupIds 리셋과 동일 관례). "대표끝은 맵당 1개" 불변식 유지.
- ③ **Ctrl+드래그 복사 시각 반전** — 원본은 원위치에 솔리드로 남기고(엣지도 원위치 고스트로 재라우팅), 커서 따라 끌리는 실제 노드를 반투명 사본(`bpm-node-ctrl-copy` opacity .5)으로 표시. `displayNodes`(사본 클래스)·`ghostNodes`(원위치 솔리드)·`styledEdges`(드래그 중 엣지→`ctrl-ghost` 앵커) 3표면 수정. RF 드래그는 그대로 두고 렌더만 반전(노드 pin 안 함→충돌 없음).
- 검증: node-clipboard 신규 TDD 1건(RED→GREEN, buildPaste `isPrimaryEnd` 소거) 포함 vitest 511/511·lint 0 err·build OK. 브라우저 실기동(3300/8800, map1 v6): ① `contextmenu` 이벤트 디스패치로 Ctrl=메뉴 억제·일반=열림 확인, ② 실 UI Ctrl+C/V→오토세이브 PUT→DB 대표끝 정확히 1개(원본 1·사본 "End (2)" 0). ③ **Ctrl+드래그 시각은 CDP 합성 드래그가 Ctrl modifier 미전달로 자동검증 불가 → 육안 검증 대기**.

## 2026-07-20 — 리뷰 3차 반영: 라이브러리 현재 맵 제외·+노드 메뉴 바깥닫힘·우클릭 후 S (worktree-sp-placeholder)
- 프로세스 라이브러리 목록에서 **현재 맵 제외**(refsByMap은 순환 판별용이라 전체 rows 유지).
- **+노드 드롭다운**: 백드롭 제거 → capture-phase 문서 mousedown 바깥닫힘(맵 드롭다운과 동일 패턴 — React Flow d3 전파 차단 대응).
- **우클릭 후 S 미동작 원인**: 전역 S 핸들러가 메뉴 열림 중 무시(`!menu`, 정렬 서브메뉴 accel 충돌 방지)인데 컨텍스트 메뉴 라이브러리 항목엔 shortcut 표기("S")만 있고 **accel이 없었음** → `accel: "s"` 추가(가속기 매칭은 열린 서브메뉴 스코프라 정렬 서브메뉴의 s와 충돌 없음). 맥 여부 무관 — 전 환경 동일 버그.
- pw 44/44 PASS(현재 맵 제외·S 가속기·+노드 바깥닫힘 검사 3건 추가). tsc 0·lint 에러 0·vitest 510.

## 2026-07-20 — 리뷰 2차 반영: 드롭다운 마커 재설계·미등록 드래그 링크·New map 조건부 (worktree-sp-placeholder)
- 드롭다운: SP 배지 → **타일 아이콘 교체**(지정 맵=Workflow 아이콘 보라, 사용중 맵=보라 배경 타일+행 배경 하이라이트), 현재 맵 목록 제외, 사용중 행 클릭 시 아코디언과 함께 **캔버스 해당 노드 자동 포커싱**(handleOutlineSelect 재사용), 백드롭 제거하고 **document capture-phase mousedown**으로 바깥 클릭 닫힘(React Flow d3가 mousedown 전파를 끊어 버블 리스너 불가 — 실측).
- 라이브러리: 미등록 맵도 **다른 맵과 같은 드래그**로 — 드롭 시 page.tsx가 unregistered 플래그를 읽어 확인 체인(경고→드롭 위치 생성→등록 요청, createLinkNodeAt로 드롭 생성 로직 공용화). 클릭 링크·패널 내 다이얼로그 제거. **New map은 검색어 입력 시에만** 노출, 라벨 = "검색어" 필(말줄임)+언어별 prefix/suffix(newMapNamedPrefix/Suffix — 빈 값 생략 조립).
- pw 41/41 PASS(드래그·마커·바깥닫힘·조건부 버튼 검사로 갱신, footer 필이 getByText에 걸리는 함정은 data-map-id 행 검사로 회피). tsc 0·lint 에러 0·vitest 510. 매뉴얼·공지·검증 플랜 서술 동기화.

## 2026-07-19 — 리뷰 반영: 미등록 토글·즉시생성을 프로세스 라이브러리로 이동 (worktree-sp-placeholder)
- 사용자 로컬 확인 피드백 반영. 맵 이름 드롭다운은 원래 역할(맵 검색·최근 목록)로 원복하고 표시만 보강 — 지정 맵 **SP 배지**(홈 카드 배지 재사용)·이미 링크된 맵 **체크**(기존 체크 디자인), 링크된 맵은 링크 추가 숨김. "Show unregistered maps" 토글·미등록 클릭 링크(2단 확인+등록 요청)·검색어 프리필 **New map**(생성 즉시 링크)은 좌측 **프로세스 라이브러리 패널**로 이동(미등록 행은 드래그 대신 클릭 — 드롭 경로가 확인 모달을 우회하지 못하게). CreateMapDialog `initialName`/`onCreatedMap`은 라이브러리가 소비. pw 스크립트 신 플로우로 갱신 — 실기동 **37/37 PASS**(드롭다운 마커 2건 추가), tsc 0·lint 에러 0·vitest 510. 매뉴얼(편집 ko/en·번들)·공지 초안·검증 플랜 F1/F3 진입점 서술 정정.

## 2026-07-19 — 7월 2차 업데이트 공지 초안 (worktree-sp-placeholder)
- docs/notices/2026-07-release-2.md — 운영(ed15440) 이후 사용자 체감 변경(홈 개편·셀프 게시·이름변경 요청·플레이스홀더·노드 복사·엑셀 2형식·알림 정리)을 1차(2026-07-13-release.md) 형식으로 정리. 배포 시 sysadmin이 설정→공지에 붙여넣어 게시(전체 알림 권장).

## 2026-07-19 — 매뉴얼 최신화: ed15440 이후 dev 전체 델타 + 플레이스홀더 (worktree-sp-placeholder)
- docs/manual 6종(ko/en × 편집/사용안내/관리자) + 인앱 번들 backend/app/manual.md 갱신. 편집: 노드 복사/복제/Shift 축고정·S단축키/링크유일성/SP설명/플레이스홀더 신설 절/Subprocess 탭/엑셀 형식 2종/일괄편집 6필드/단축키 표. 사용안내: 홈 대시보드·조직도 즐겨찾기/새 맵(부서 우선·Start/End 시드)/버전 이름 직접입력·번호 자동부여/셀프 게시/이름변경 워크플로/Inbox sp 등록 수락 절차/FAQ 2건. 관리자: 오너 결정형 요청(rename·sp_designation) 노트. 갱신일 2026-07-19. 백엔드 695 그린(번들 변경 무회귀).

## 2026-07-19 — 릴리스 준비 문서: 검증 플랜 F섹션 + 9910 검증 스택 절차 (worktree-sp-placeholder)
- DEV-SERVER-TEST-PLAN.md: 대상=sp-placeholder 머지 후 dev·접속 9910으로 갱신, 운영(ed15440) 기준 델타 표 확장(sp_description·알림 인덱스 2·kind 값 2·follow_latest 기본), 작업단위 18로 확장(#17 플레이스홀더 + main 미배포분), 시나리오 F1~F4(플레이스홀더·main 델타) 신설.
- docs/db-migration-9910.md 신설 — 운영 9900(ed15440) DB 복사 → 9910 검증 스택(dev) 절차. 9800 선례 실측값(PROD_DB 컨테이너명·compose 병합 누적 함정·-t TTY 금지) 승계, 서브넷 172.43·`-p bpm-9910`·`.env.9910`, 승격은 main 머지 후(§7).

## 2026-07-19 — 서브프로세스 플레이스홀더 구현 (worktree-sp-placeholder)
- T7(검증): `pw-verify-sp-placeholder.mjs` 신설 — 실기동(백엔드 8933 enforcement ON·프론트 3233) **36/36 PASS·콘솔 에러 0**. ①피커 토글→미등록 배지→2단 확인 링크+요청 ②인스펙터 CTA 철회→재요청 ③미게시 카드 지정 비활성+안내 ④게시 카드 지정 모달 저장=수락 완결(카드 소멸·auto-applied·요청자 알림) ⑤반려+알림 ⑥New map 프리필→생성→에디터 잔류+자동 링크+미등록 상태 확인. 랜드마인: /inbox 기본 탭=알림(Approvals 클릭 필수, 뱃지 카운트로 exact 불가)·아코디언은 토글 후 재클릭 금지·SearchSelect 첫 옵션=None 제외·checkout POST는 {force} body 필수·상세 조작은 inbox-detail-aside 스코프. 최종 게이트: BE 695+ruff / FE tsc 0·lint 에러 0·vitest 510·build OK.
- T6(FE): Inbox sp_designation 카드 — 라벨/요약(from_map 컨텍스트, 빈 값 폴백), ApprovalDetail sp 브랜치(getMap으로 게시본·프리필 로드, 게시본 없으면 "지정하고 승인" 비활성+안내, "게시된 버전으로 가기" 링크), 수락=SubprocessDesignationModal 저장(PUT 자동 applied — decide 호출 없음), Reject=기존 decide+토스트. tsc 0·lint 에러 0·vitest 510.
- T5(FE): 인스펙터 `SubprocessRegistrationCta` 신설 — 미지정 링크 선택 시 등록 요청 버튼/Requested 배지(본인 요청은 철회), pending 409 자기치유 재조회, key=linkedMapId로 전환 리셋(StrictMode set-state-in-effect 회피). page.tsx SubprocessVersionPicker 아래 마운트. tsc 0·lint 에러 0·vitest 510.
- T4(FE): 피커(map-name-dropdown) "Show unregistered maps" 체크박스 토글(켜면 include_undesignated 재조회, 토글 시 library null 리셋→lazy 재로드)·미등록 배지·미지정 링크 2단 확인(경고 동봉 링크 확인→등록 요청 여부, 요청 409는 안내 토스트)·`onToast` prop. CreateMapDialog `initialName` 프리필+`onCreatedMap`(지정 시 router.push 생략→에디터 잔류·자동 링크). api.ts에 designated 필드·includeUndesignated 파라미터·sp 요청 3함수. tsc 0·vitest 510·lint 에러 0.
- T2 보안 후속: 요청 payload의 from_map_name은 요청자가 viewer 이상인 맵만 해석(무권한·미존재 모두 "" — 존재 오라클 차단). 임의 from_map_id로 비공개 맵 이름을 알아내는 IDOR 노출을 커밋 직후 보안 리뷰 지적으로 봉합. 회귀 695 그린.
- T3: 수락 체인 — 범용 decide에 sp_designation 오너/sysadmin 게이트 추가, `_apply_request` 분기(삭제 맵 멱등 applied·미지정 approve 409로 pending 유지·기지정 no-op), reject/approve 알림 `sp_designation_{outcome}`. Inbox block 3에서 제외 + 오너 게이트 block 5 신설(detail=payload). **PUT 지정 최초 전이 시 pending 자동 applied**(`_apply_pending_sp_designation`) — Inbox 수락은 지정 모달 저장만으로 완결. pytest 11신규 포함 694 그린·ruff 클린.
- T2: `POST/GET/DELETE /api/maps/{id}/sp-designation-requests(/pending)` — SP 등록 요청 생성(viewer 게이트=피커 가시성 조건 일치, 이미 지정 409·중복 pending 409·삭제 404, payload는 서버 박제 {from_map_id, from_map_name, map_name})·pending 조회·본인 철회(withdrawn). 오너 알림 `sp_designation_requested`. rename 선례 미러. pytest 8신규 포함 683 그린.
- T1: `GET /api/library/processes?include_undesignated=true` — 미지정 맵 옵트인 노출. 각 행에 `designated` bool 추가, 미지정 행은 sp 어트리뷰트 4종 None 마스킹(직전 지정 잔존값 유출 방지) + 가시성(role≥viewer) 배치 필터(`_filter_visible_map_ids`, maps.list_maps 패턴 미러 — 비공개 맵 이름 유출 방지). 기본 호출은 기존과 동일(지정 맵만). pytest 4신규(RED→GREEN) 포함 675 그린·ruff 클린.

## 2026-07-19 — 서브프로세스 플레이스홀더 설계 스펙 확정 (worktree-sp-placeholder)
- 미등록(SP 미지정) 맵을 subprocess 노드로 먼저 링크(즉시 연결형 플레이스홀더)하고 등록 요청(ApprovalRequest kind='sp_designation', rename 선례 미러)하거나 새 맵을 즉시 생성(CreateMapDialog 프리필→자동 링크→지정 모달)하는 기능 설계. DDL 없음. 스펙: `docs/superpowers/specs/2026-07-19-subprocess-placeholder-design.md`.

## 2026-07-19 — 개발서버 배포·브라우저 검증 시나리오 문서 추가 (DEV-SERVER-TEST-PLAN.md, dev 직접 커밋)
- 월요일 개발서버(3333) 배포 테스트용 체크리스트 문서 신설. 분기점 `31a9ea8`(main HEAD) 이후 dev 17 작업단위 정리 + 배포 델타 실측(신규 스키마 `sp_description` 1개=자동 ALTER 등록됨·신규 env `CSV_MANUAL_URL` 1개=선택) + 기능별 브라우저 검증 시나리오(A 승인/버전·B 에디터·C 메인/생성·D 인스펙터/파라미터·E 내보내기/알림/매뉴얼) + 서버 전용 함정 체크(평문 HTTP·Keycloak 자동로그인·KST). 코드 변경 없음.

## 2026-07-19 — rename 후속 ②④: 에러 토스트 detail 추출 + pending 배지 크로스탭 self-heal (dev 직접 커밋)
- ② `getApiErrorDetail`(api.ts) — `ApiError`에 `body` 보관(request 실패 시 응답 원문), JSON 본문의 `detail` 문자열만 추출해 사용자 표시(비JSON·422 배열·비ApiError는 메시지 폴백). TDD vitest 5신규(RED→GREEN, fetch 스텁 왕복 포함). 적용: map-details-panel 5개 catch + inbox decide 토스트 — `API POST … 409 — {"detail":…}` 원문 노출 해소.
- ④ `refreshRenameState`(map-details-panel) — rename 생성/취소 실패 시 맵·pending 재조회로 재동기화(다른 탭에서 승인·반려된 stale 배지 해소). 입력값 리셋은 pending 존재 또는 서버 이름 변경 시만(사용자 시도 텍스트 보존).
- 검증: pw-verify-map-rename.mjs에 ⑥ self-heal 시나리오 추가(오너가 API로 뒤에서 승인 → stale Withdraw 클릭 → 깨끗한 detail "no pending rename request"·배지 소멸·입력 재동기화, 의도적 404는 콘솔 필터 허용) — 실기동 **25/25 PASS·콘솔 에러 0**(8912/3212, enforcement ON). 게이트: tsc 0·lint 0 err·vitest 510/510·build OK.

## 2026-07-18 — 버전 드래프트 생성 다이얼로그: 이름 "To-Be" 자동입력 제거 + 번호 자동부여 힌트 (worktree-version-draft-no-tobe)
- 에디터 새 버전(드래프트) 생성 모달의 이름 입력 `defaultValue`가 create 모드에서 `"To-Be"`로 하드코딩돼 있던 것을 빈 값으로 변경 — 사용자가 버전 이름을 직접 입력하도록. rename 모드(기존 라벨 프리필)는 그대로. 빈 값 처리는 `PromptDialog`가 이미 담당(빈 값이면 확인 버튼 비활성).
- create 모드에 placeholder 힌트 추가 — `prompt.newVersionNumberAuto`("버전 번호는 자동으로 부여됩니다" / "Version number is assigned automatically", EN/KO). 이름(label)은 사용자 입력 필수, 버전 번호(`version_number`)는 게시 시 자동 채번(versions.py 최댓값+1)이라 사실과 일치. rename 모드는 placeholder 없음.
- 검증: tsc 0(무오류). 문자열 리터럴 스왑 + i18n 키 + placeholder prop이라 타입/동작 위험 없음. 브라우저 실기동 검증은 미실행(요청 시 수행).

## 2026-07-18 — 셀프 게시 팝오버를 설정 페이지 Versions 탭에도 적용 (worktree-self-publish-settings)
- `VersionsPublishPanel`(맵 설정 Versions 탭)의 승인요청 버튼도 에디터와 같은 플로우 — 승인자가 본인 1인이면 클릭 지점에 `SelfPublishPopover`, Yes=`runSelfPublishChain`(submit→approve→publish, 기존 `runAction` 경유), No=기존 즉시 제출, Escape/바깥클릭=취소. 승인자 2인 이상은 종전대로 즉시 제출. 백엔드·i18n 무변경(기존 컴포넌트·키 재사용).
- 검증: tsc 0·lint 0 err·vitest 504/504·build OK. 브라우저 실기동 `pw-verify-self-publish-settings.mjs` 11/11 — 2인 즉시 제출 보존, 1인 클릭 지점 팝오버, Escape/No/Yes 3분기, Yes로 published·approvals 기록, 콘솔 에러 0. (스크립트 함정: 화면 밖 버튼은 클릭 자동 스크롤로 사전 측정 좌표가 틀어짐 → `scrollIntoViewIfNeeded` 후 측정)

## 2026-07-18 — 셀프 게시: 승인자가 본인 1인이면 승인요청→승인→게시 원클릭 (worktree-self-approve-publish)
- 에디터 승인 탭에서 승인요청 클릭 시 승인자가 정확히 본인 1명이면 클릭 지점(마우스 근처)에 소형 Yes/No 팝오버(`SelfPublishPopover`) — Yes는 submit→approve→publish 체인(`lib/self-publish.ts`, 기존 `runTransition` 재사용), No는 기존 승인요청 확인 모달, Escape/바깥클릭은 취소. 백엔드 무변경(기존 3개 엔드포인트 순차 호출).
- `WorkflowActions`/`ApprovalPanel` `onSubmit`에 클릭 좌표 전달, i18n `approval.selfPublish*` 4키 EN/KO.
- 검증: vitest 신규 4(TDD RED→GREEN, 체인 순서·중간 실패 전파)·전체 504/504, tsc 0, lint 0 err, build OK. 브라우저 실기동 `pw-verify-self-publish.mjs` 15/15 — 승인자 2인은 팝오버 없이 기존 모달 직행, 1인은 클릭 지점 근처 팝오버, Escape/No/Yes 3분기, Yes로 status published·approvals 기록, 콘솔 에러 0.
## 2026-07-18 — 맵 이름 변경 승인 워크플로우 설계 스펙 (worktree-map-rename-workflow)
- 브레인스토밍으로 요구 확정(요청=editor 이상, 승인=오너/sysadmin 1인, 오너/sysadmin은 즉시 적용+pending supersede, 맵당 pending 1건, Settings 진입, 알림 5종) 후 설계 스펙 작성 — `docs/superpowers/specs/2026-07-18-map-rename-workflow-design.md`. 접근: 기존 `ApprovalRequest`에 `kind='map_rename'` 확장(DDL 불요), decide·Inbox는 kind별 오너/sysadmin 게이트 분기, `PATCH /maps` name은 오너/sysadmin 전용으로 조임(에디터 403), 신설 2엔드포인트(요청 생성·본인 취소). 리뷰 반영: 행위자 토스트를 알림 시점과 대칭으로 추가(§5.4 — 수신 측은 알림, 행위자는 토스트로 경계 유지). 구현 계획 작성 — `docs/superpowers/plans/2026-07-18-map-rename-workflow.md`(7태스크 TDD: BE 요청/조임/decide/Inbox 4 + FE Settings/Inbox 2 + pw 왕복 1, 실코드·게이트 명시).
- **Task 1**: 백엔드 요청 생성·pending 조회·취소 엔드포인트 + 공용 알림 헬퍼 — `RenameRequestIn` 스키마·`load_map_user_collaborators`·`notify_map_renamed` workflow 함수·3개 POST/GET/DELETE 엔드포인트. TDD: test_map_rename_workflow.py 9/9 green(editor 요청 생성 + 오너 알림·중복 409·미승인 422·권한 403, pending 조회·본인 취소 204·타인 취소 403·미존재 404). 게이트: pytest 650/650·ruff clean. **코드리뷰 픽스**: DELETE 엔드포인트에 `require_map_role("viewer")` 게이트 추가(Finding 1: permission 누락) + ApprovalRequest enum-doc 주석 갱신(Finding 2: stale) — test_map_rename_workflow.py 10/10 green(신규 test_withdraw_by_stranger_403_even_without_pending).
- **Task 2**: `PATCH /maps/{map_id}` name 변경을 오너/sysadmin 전용으로 조임(에디터 403) — pending rename 요청은 `superseded` 전이 + 요청자 `rename_superseded` 알림, 적용 시 협업자 전원 `map_renamed` 알림(`_supersede_pending_rename` 헬퍼). TDD: TestDirectRename 5개 신규(editor 403·description은 계속 가능·오너 적용+알림·pending supersede·sysadmin 가능) — test_map_rename_workflow.py 15/15 green. 기존 `test_permission_gates.py`의 role-gate 테스트 2건이 name 필드로 editor PATCH 200을 기대해 깨짐 — rename과 무관한 역할 게이트 검증이 목적이라 payload를 `description`으로 교체(actor는 그대로, 새 규칙 완화 아님). 게이트: pytest 656/656·ruff clean.
- **Task 3**: `POST /approval-requests/{id}/decide`를 kind별 게이트로 분기 — `map_rename`은 `assert_map_role(..., "owner")`(오너/sysadmin), 그 외는 기존 `assert_approver_or_sysadmin` 유지. `_apply_request`에 `map_rename` 분기 추가(승인 시 재중복검사 409로 커밋 전 중단해 pending 유지 + 이름 적용 + `notify_map_renamed` 협업자 알림), `_notify_permission_decision`에 rename 분기 추가(`rename_approved`/`rename_rejected` 요청자 알림). TDD: TestDecideRename 7개 신규(오너 승인 적용+3종 알림·비오너 승인자 403·에디터 403·sysadmin 가능·반려 시 이름 유지+알림·승인 중 이름 선점 409+pending 유지) — test_map_rename_workflow.py 21/21 green. 브리프의 전역 `select(Notification)` 단언은 세션-스코프 DB 공유로 이전 테스트(sysadmin 개명→OWNER 수신)에 오염돼 `map_id` 필터 추가로 보정. 게이트: pytest 662/662·ruff clean.
- **Task 4**: `GET /api/inbox/approvals`에 rename 요청 노출 — ar_q 블록에 `ApprovalRequest.kind != "map_rename"` 조건 추가로 분리, 신규 4번 블록 rn_q(pending map_rename, 오너 소유맵 또는 sysadmin만 조회). dict 키는 기존 approval_request 블록과 동일(`kind`·`id`·`title`·`map_id`·`map_name`·`requester`·`status`·`created_at`·`version_id`·`detail`·`updated_at`·`before`·`after`·`principal`). TDD: TestInboxRename 3개 신규(오너 보임+before/after·비오너 승인자 미노출·sysadmin 보임) — test_map_rename_workflow.py 24/24 green, 공용 _seed helpers 재사용. 게이트: pytest 665/665·ruff clean.
- **Task 5**: 프론트 Settings Details 탭에 이름 필드 추가 — `api.ts`에 `createRenameRequest`/`getPendingRenameRequest`/`withdrawRenameRequest` 3함수(`ApprovalRequest`는 이미 `payload` 보유, 타입 확장 불요), i18n 키 9종(`perm.rename.*`, EN+KO). `MapDetailsPanel`: 이름 입력+저장 버튼(owner는 `updateMap` 즉시 적용+supersede 토스트 분기, editor는 `createRenameRequest`로 pending 생성+입력 롤백), pending 배지(`to_name`·요청자·본인 요청 시 취소 버튼 `withdrawRenameRequest`). 로드 effect의 `Promise.all`에 `getPendingRenameRequest`·`getMe` 추가(active-cleanup 패턴 유지). 게이트: tsc 0·lint 0 err(사전 존재 경고 1건 무관)·vitest 500/500.
- **Task 6**: 프론트 Inbox — map_rename 카드 표시 + decide 토스트 + 알림 카테고리. `notification-categories.ts`에 `rename_*`/`map_renamed` → permission 분기(TDD: 실패 테스트 먼저 추가 확인 후 구현). `inbox/page.tsx`: `approvalTitle`/`approvalSummary`에 map_rename 분기(before→after 마크다운 요약), settings/page.tsx와 동일한 `ToastStack`/`genId` 패턴으로 토스트 상태 도입, decide 핸들러의 approval_request 분기를 try/catch로 감싸 승인 시점 이름 선점 409 등을 에러 토스트로 노출(성공 시 승인/반려 토스트, 기존 큐 재조회·선택 해제 흐름은 유지). i18n 키 4종(`inbox.reqKind.map_rename`·`inbox.summary.map_rename`·`inbox.toast.renameApproved`·`inbox.toast.renameRejected`) EN+KO. 게이트: tsc 0·lint 0 err(사전 존재 경고 1건 무관)·vitest 501/501·build OK.
- **Task 7**: Playwright 왕복 검증 `frontend/scripts/pw-verify-map-rename.mjs` 신설(백엔드 8911·프론트 3211, `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`로 기동 — 오너/에디터 역할 차등 실측 필수). 시드는 스크래치 맵 1개를 API로 생성(디렉터리 실직원 2명을 owner/editor로 배정, admin.sys 우회 배제)해 자기완결. 시나리오 22체크 전부 PASS(2회 연속, console errors 0): 오너 즉시 변경(토스트 "Map renamed")→에디터 요청(pending 배지+입력 disable)→취소·재요청→오너 Inbox Approvals "Map rename" 카드(before→after)에서 승인(토스트 "Rename approved — new name applied")→에디터 Notifications에 승인 메시지 수신. `providers.tsx` DevGate가 렌더 단계에서 localStorage devUser를 동기 반영하는 점에 착안해 유저 전환마다 `page.goto` 풀 네비게이션으로 재마운트(SPA 라우팅으론 안 먹힘). 최종 게이트: 전 항목 그린 — pytest 665/665·ruff clean·tsc 0·lint 0 err(무관 사전 경고 1건)·vitest 501/501·build OK.
- **최종 리뷰 픽스**(backend only): 소프트삭제 맵 404 스윕 — `get_pending_rename_request`·`withdraw_rename_request`에 POST와 동일한 `deleted_at` 404 가드 추가, `_apply_request` map_rename 분기는 삭제된 맵이면 이름 변경 없이 멱등 applied, Inbox `rn_q`에 `ProcessMap.deleted_at.is_(None)` 조건 추가. `PATCH /maps` name을 `.strip()` 정규화 후 비교/적용(공백만이면 422, 동일값은 역할 검사 없이 200 no-op 유지). `ApprovalRequest` 클래스독스트링·payload 주석에 rename 반영, 테스트 dead code(`_request_id`) 제거 + `_apply_request`의 `actor=req.decided_by or ""` → `actor=req.decided_by`(decide가 항상 먼저 설정). TDD: 신규 6테스트 우선 RED 확인 후 구현 → GREEN. 게이트: test_map_rename_workflow.py 30/30·전체 pytest 671/671·ruff clean.

## 2026-07-18 — persist-effect StrictMode 리셋 잔존 2건 픽스: edgeStyle·inspectorWidth (dev 직접 커밋)
- params-ui-sync에서 적발된 진범 패턴(상태-의존 effect 영속 → StrictMode 이중 마운트가 hydration 전 기본값으로 저장값 덮어씀)의 잔존 전수 스캔: 실버그 2건(`bpm.edgeStyle`·`bpm.inspectorWidth`, dev 한정 증상) + 자체 완화 2건(`bpm.home.filters` skip-guard, `bpm.windows.*` 디바운스+cleanup — 존치) + 나머지 9곳은 핸들러/lazy-init로 안전.
- 수정: persist effect 2개 제거 — edgeStyle은 스타일 버튼 onClick에서, inspectorWidth는 리사이저 드래그 종료(pointerup)에서 최종값(`lastW`) 1회 영속.
- 검증: pw 프로브(일회용, 미커밋) 6/6 — 저장값 선주입 후 마운트 유지(straight/480 리셋 없음)·폭 480 레이아웃 적용·버튼 클릭 즉시 영속·드래그 종료 영속(500)·재로드 왕복. 게이트: tsc 0·lint 0 err.

## 2026-07-18 — 6필드 파라미터 미반영 표면 동기화: 그룹 일괄 편집·파라미터 표시 토글·stale 스크립트 (worktree-params-ui-sync)
- 조사(에이전트 3병렬): 그룹 일괄 편집은 people/system/duration만 지원(5필드 누락·PARAM_FIELDS 미사용·SP 전면 배제), 캔버스 파라미터 칩은 토글 불가(항상 표시), 그 외 제품 표면은 전부 6필드 반영 확인 — 잔존은 pw-verify-export/sp-params 스크립트 2개뿐. 방향 확정: 일괄 편집 6필드 전부(SP는 annual_count·fte 허용) + "Parameters" 통합 토글 1개(기본 ON). 계획 `docs/superpowers/plans/2026-07-18-params-ui-sync.md`.
- **Task 1**: `lib/bulk-params.ts` 신설 — `canBulkEditField`(모드별 대상: people/system=hasBpmAttributes, 파라미터=getEditableParamFields), `buildBulkAttrPatch`(비용 설정 시 반대 통화 소거·비우기는 양쪽 소거), `isBulkParamField`. vitest 7/7 (TDD RED→GREEN).
- **Task 2+3**: `NodeDisplayToggle`("params" 추가)·`NODE_DISPLAY_TOGGLES`·`parseDisplayToggles`(v2 키 우선, 레거시 저장값은 params ON 이관 — 기존 사용자 칩이 꺼지는 회귀 방지) + `NodeParams`를 토글로 게이팅·`NodeFields`는 params 제외. compare 뷰는 `["params"]` 주입으로 칩 종전 표시 보존, Provider 없는 임베드는 defaultActions에 params 포함으로 보존. vitest 5/5 신규, 전체 500/500·tsc 0.
- **Task 4**: 에디터 토글 state를 `NodeDisplayToggle[]`(기본 `["assignee","params"]`)·localStorage `bpm.nodeDisplayFields.v2`(레거시 키는 이관 소스로만 읽고 유지)로 전환, 맵 탭 "노드 표시 정보" 카드에 Parameters 스위치 행 추가(`field.params` EN/KO). lint 0 err·tsc 0.
- **Task 5**: 그룹 일괄 편집을 6필드 전체로 확장 — `BulkAttrField = "system" | ParamField`, 모드 탭을 PARAM_FIELDS 순회로 생성(라벨=PARAM_LABEL_KEY, 아이콘=캔버스 칩과 동일). 모드별 멤버십 `canBulkEditField`(SP는 annual_count·fte 모드에 포함, people/system/나머지 4필드는 종전대로 제외). 비용 모드는 반대 통화 보유도 충돌로 취급(`getExistingAttrRaw`)·표시는 실보유 통화 기호(`displayExistingAttr`)·적용은 `buildBulkAttrPatch`로 반대 통화 소거. 파라미터 모드는 append 정책 봉인(숫자 콤마 append→백엔드 소거 유실, 기존 duration append 잠복 버그 해소), 입력은 ParamInput 공용. tsc 0·lint 0 err·vitest 500/500.
- **Task 6**: stale 검증 스크립트 2개를 6필드 모델로 이행 — pw-verify-export.mjs(입력 6필드·CSV 14컬럼 Cost_KRW/Cost_USD/Annual_Count/FTE·Excel 16컬럼·USD 경로 디시전 노드·표시형 1h15m/₩300 계약 + **추가 stale 2건 발견·수정**: Parameters 그룹 기본접힘 미대응, Excel 형식 선택 모달 미대응), pw-verify-sp-params.mjs(시드 cost_krw·지정 PUT 4필드·Σ 4개=headcount 평균 포함·sp_cost_krw·칩 ₩0.3). 실기동 green: export 22/22, sp-params 24/24 (백엔드 8907·프론트 3207, reset_db 시드).
- **Task 7**: 신규 브라우저 검증 `pw-verify-params-ui-sync.mjs` 14/14 green — 8모드 탭·cost_krw 일괄(통화 전환 충돌→Replace·Bravo USD 소거·SP 제외)·fte 일괄(SP 포함 4멤버)·칩 ₩500·토글 OFF/새로고침 유지/ON 복귀·레거시 이관. 검증이 **StrictMode 리셋 잠복 버그 적발·수정**: displayFields persist effect가 이중 마운트에서 hydration 전 기본값을 저장소에 덮어써 OFF 상태가 리셋(ui-improvement-5 때 알려진 잠복 이슈) → 영속을 토글 핸들러로 이동. 모달 루트에 `data-id="group-bulk-modal"` 부여(컨벤션). 최종 게이트: lint 0 err·tsc 0·vitest 500/500·build OK.

## 2026-07-18 — 인스펙터 Subprocess 탭: 지정 메타 + 역참조(used-by) 목록 (worktree-sp-usage-tab)
- **백엔드**: `GET /api/maps/{map_id}/subprocess-usage` 신설(viewer+, DDL 없음) — 지정 메타(designated/시점/행위자 `sp_changed_by`) + 지정이 가리키는 버전(최신 게시본 라이브 해석: id·number·label) + 이 맵을 링크한 부모 맵 목록. 사용처 판정은 부모의 **라이브 버전**(게시본 max id, 없으면 최신 — list_maps 노드 수 규칙과 동일) 기준 노드 수. 소프트삭제 부모 제외, 열람 불가 부모는 이름 미노출 `hidden_count` 집계(effective_role). 테스트 6종(test_subprocess_usage.py).
- **프론트**: 인스펙터에 **Subprocess 탭** 추가 — 지정된 맵에서만 노출(importSlot과 같은 조건부 탭 패턴, Map 탭 뒤). 상단 지정 정보 박스(버전 v{n}·라벨, 지정 시점 KST, 지정자 UserPill, 최신게시본 추종 안내 노트) + "이 맵을 연결한 맵" 목록(행=맵 이동 Link, 오우닝 부서 캡션, 링크 노드 수 ×n 칩, 빈/숨김 상태 문구). 지정/해제 시 `onDesignationChange` 콜백으로 usage 재조회(탭 노출 동기화). 지정 해제로 슬롯이 사라지면 열려있던 탭은 Map 탭으로 렌더 파생 폴백(effect 불요).
- 게이트: pytest 641(+6)·ruff·vitest 488·tsc 0·lint 0·build OK. pw 실측(ko/en): 맵3에서 탭 노출·지정 메타·연결 맵 3건(×2 칩·부서 캡션) 렌더 확인.

## 2026-07-18 — 권한 마스킹 표면 정리: 아웃라인 잠금 화살표 억제 + WBS 잠긴 SP 행 살리기 (worktree-inline-expand-drag-fix)
- 조사(권한 강제 백엔드 + yerin.yoo〈맵1 무권한〉 실측): 캔버스는 봉인 정상, Excel 1안은 SP 행+denied 노트 정상, CSV/Word는 링크맵 데이터 자체가 안 실려 무변경. sp_* 지정 정보는 잠금 사용자에게도 노출(지정 카드=공개 메타데이터, 현행 유지).
- **아웃라인 버그 픽스**: 현재 스코프의 잠긴 SP 행에 펼침 화살표가 그대로 표시되고 클릭이 무반응이던 문제 — outline memo가 `node.data.locked`를 읽었지만 nodes state엔 locked가 없음(주입은 displayNodes 렌더 시점). `lockedKeys` 직접 조회(canExpand와 동일 판정)로 교체 — 임베드/심층 행은 종전부터 정상. 미지정 SP도 함께 억제(resolved가 locked 반환). 키보드 `→` 펼침도 hasChildren=false로 자동 차단.
- **WBS(2안) 잠긴 SP 행 살리기**: 종전엔 잠긴/해석실패 SP가 이름조차 없는 익명 "(access denied)" 노트 1줄로 소실 → **번호 달린 잎 행**(Task=SP 제목, 파라미터·설명은 1안 SP 행과 동일 소스: 지정정보 상속+베이스·추가분 합성, next 포함) + 레벨 경로에 SP 제목을 단 denied 노트로 변경. 잎 행이 rowByNodeId에 들어가 규칙4 주석 대상도 유지. TDD(RED→GREEN), 시트 기록은 무변경.
- 게이트: vitest 475/475·tsc 0·lint 0 err·build OK. pw 실측: 아웃라인 화살표 잠금·미지정 모두 1→0, WBS 미리보기가 잎 행+denied 노트 형태로 출력(맵2, yerin.yoo).

## 2026-07-18 — 맵 상세 카드·인스펙터에 오우닝 부서 노출 (worktree-create-map-picker-ux)
- 요청: 맵 상세 화면/인스펙터에 협업 부서처럼 오우닝 부서를 보이게. 진단 = 상세 카드(홈)는 헤더 필로만 노출·`only="members"`(에디터 인스펙터 Map 탭 재사용) 모드에선 헤더가 생략돼 오우닝 부서가 **전혀 안 보임**.
- 수정: `MapDetailCard` 멤버 컬럼 최상단에 오우닝 부서를 협업 부서 행과 동일 스타일(레벨 아이콘·부서명, 한글명 폴백)로 노출 — `data-id="map-detail-owning-member"`, `Editor · locked/고정` 서브라벨 + editor RoleBadge, accent-tint 강조. `only` 무관 렌더라 상세 카드·인스펙터 양쪽 동시 반영. `detail.owning_department`를 const로 좁혀 클로저 타입 안전.
- 게이트: lint 0 err·tsc 0. 실앱(map 2 Employee Onboarding·owning=Analytics Part 1) 상세 aside + 인스펙터 Map 탭 EN/KO 4종 캡처 확인.

## 2026-07-18 — 새 맵 만들기 모달 UX 3종: 오우닝 부서 정렬·선택 후 스크롤 다운·협업자 빈 안내 (worktree-create-map-picker-ux)
- **오우닝 부서 피커 정렬**: `PrincipalPicker`에 `myDeptsFirst` prop 추가 — browse(빈 검색) 시 내 소속 부서 체인(`me.orgPath` 기준 `isMyDept`)을 맨 위로, 작은 단위(깊은 org_path=세그먼트 많음)부터 정렬. 검색 랭킹엔 불개입. 오우닝 부서 피커에만 적용(승인자용 `managersFirst`와 배타).
- **선택 후 결재자로 스크롤 다운**: 오우닝 부서를 고르면 피커가 잠금 행으로 바뀌며 닫히고(기존 동작), `approversRef.scrollIntoView({block:"end"})`로 맨 아래 결재자 피커까지 스크롤 — 작은 뷰포트에서 아래 피커를 상단 피커로 착각하던 문제 해소.
- **협업자·결재자 빈 안내문구**: 두 목록이 비었을 때(`collaborators.length===0` / `approvers.length===0`) 박스 중앙에 회색 초대 문구 — `collaboratorsEmpty`("Search below to add editors or viewers.")·`approversEmpty`("Search below to add approvers."), 한글 "…추가해보세요" 병기. "아직 없다"식 부정 표현 대신 초대형. 피커가 `flex-col-reverse`로 목록 **아래**에 있어 "search below". 오우닝 부서 잠금 행과 무관.
- 게이트: lint 0 err·tsc 0. 실앱(admin.sys·백엔드 8901·프론트 3200) 모달 캡처로 EN/KO 빈 안내 2종 확인. 정렬 순서·선택 후 스크롤은 로컬 실행에서 확인 권장.

## 2026-07-18 — 노드 편집 모달 선행/후행 밴드 잘림 수정
- 버그: 노드 편집 모달의 선행/후행(이전/이후) 내비가 모달 높이에 따라 안 보이거나 잘림. 근본원인 = 내비가 스크롤 바디 안 flex 자식인데 `shrink-0` 없음 + 내부 칩이 `overflow-y-auto`라 min-height가 0으로 붕괴 → 콘텐츠 넘치면 flex-shrink가 밴드를 테두리(4px)까지 뭉갬. 격리 재현으로 확정(nav 높이 4px).
- 수정: 내비 블록을 스크롤 바디 밖 `shrink-0` 고정 밴드(푸터 위)로 분리 — 스크롤 위치·모달 높이와 무관하게 항상 노출. 칩 자체 `max-h-[104px]`+내부 스크롤 유지. `node-summary-modal.tsx` 1파일.
- 검증: 실앱(admin 로그인·코멘트 6건 주입해 오버플로 강제)에서 바디 끝까지 스크롤해도 밴드 `fullyInViewport` 유지·칩 35px(붕괴 없음), 읽기전용 모달 포함. 게이트: lint 0 err·build OK.

## 2026-07-18 — 읽기전용 노드 더블클릭 모달 복구 (worktree-inline-expand-drag-fix)
- 부수 발견 수정: 읽기전용에서 노드 더블클릭이 모달을 안 열던 원인 = `nodesDraggable=false`라 노드에 `nopan` 클래스가 없어 **d3-zoom 더블클릭 줌 필터를 통과 → d3가 `stopImmediatePropagation`으로 이벤트를 소비** → React 합성 `onNodeDoubleClick` 미발화(편집 모드는 nopan이 차단해 정상). 계측으로 확정: DOM dblclick은 노드 도달, 합성만 실종.
- 수정: `zoomOnDoubleClick={!readOnly}` 1줄 — 읽기전용에서 더블클릭 줌을 꺼 이벤트가 React까지 버블. 편집 모드 동작 무변경.
- pw: 읽기전용(taeyang.oh) dblclick → 모달+합성 설명 표시·textarea 없음 ✓, 편집(admin.sys) dblclick → 모달+편집 폼 ✓. 게이트: vitest 475/475·lint 0 err·tsc 0·build OK.

## 2026-07-18 — 읽기전용 모달에 설명 표시 (worktree-inline-expand-drag-fix)
- 후속②: 읽기전용 모달(축약형)이 타입/그룹만 보여주고 설명을 누락하던 것 → 설명 블록 추가(있을 때만, 인스펙터와 동일 스타일). subprocess는 `mergeSubprocessDescription`(링크맵 베이스+추가분) 합성 표시.
- pw 검증(taeyang.oh로 읽기전용 재현): 우클릭→정보 수정 경로에서 합성 3줄 표시 ✓, 편집 textarea 없음 ✓. **부수 발견(기존 동작, 미수정)**: 읽기전용에선 노드 더블클릭이 모달을 애초에 안 연다(200ms에도 미오픈) — 읽기전용 모달 진입은 우클릭 정보 수정/E키만. 게이트: vitest 475/475·lint 0 err·tsc 0·build OK.

## 2026-07-18 — UX 통일 후속 2건: Excel 설명 합성 + 아웃라인 자식 이름편집 차단·토스트 (worktree-inline-expand-drag-fix)
- **Excel(1안)만 설명 합성 반영**: `buildExcelModel` 행 생성에서 subprocess면 `mergeSubprocessDescription(subprocess_refs[sp_description], node.description)` — 그래프에 이미 있는 `subprocess_refs` 재사용, TDD 1건(RED→GREEN). WBS(2안)는 SP가 행을 안 차지해 무변경, Word/CSV는 사용자 지시로 제외(CSV는 왕복 계약상 추가분만이 맞음).
- **아웃라인 자식 행 이름편집 차단+토스트**: 행 더블클릭·Enter(편집 단축키) 모두 `item.hierarchy`(하위 스코프 행) 게이트 — 편집 input 대신 토스트("링크맵의 읽기전용 노드입니다 — 해당 맵에서 편집하세요", en 병기). 종전엔 편집 UI가 뜨고 저장이 조용히 증발했음. 루트 행 편집은 회귀 없음(pw 확인).
- 게이트: vitest 475/475(신규 1)·lint 0 err·tsc 0·build OK. pw: 자식 행 dblclick → input null+토스트 표시, 루트 행 정상 편집.

## 2026-07-18 — 서브프로세스 UX 통일 6종: 딥뷰 봉인·자식 상호작용 통일·읽기전용 메뉴·펼치기 메뉴·모달 피커 패리티·설명 상속 (worktree-inline-expand-drag-fix)
- 조사(라이브 계측)로 확인된 불일치/고장 일괄 정리. 사용자 지시: ①봉인 ②선택효과 통일 ③읽기전용 안내 ④메뉴 펼치기 ⑤모달 패리티 + 설명 상속.
- **자식 더블클릭 봉인(깊이 무관)**: 임베드 자식 dblclick 캡처 핸들러가 하던 딥뷰 드릴인(`drillIntoSubprocess`) 제거 — 인라인 펼침과의 이중 렌더(React 중복 key)·오프스크린 스코프 창·빈 캔버스 고장의 유일 진입로였음. 이벤트는 계속 삼켜 RF 줌/모달도 차단. `isDrillableHost`/`drillIntoSubprocess` 삭제(스코프 창 머신은 존치).
- **자식 클릭 선택효과 통일**: 캔버스 클릭이 `selectedId`도 동기화(아웃라인 행 하이라이트 일치), 아웃라인 다른-스코프 선택이 RF `selected`(테두리+불투명)도 동기화(펼침 반영 다음 틱 setTimeout 안에서 childNodes 싱크). 같은-스코프 아웃라인 선택은 자식 선택 해제 대칭 추가.
- **자식 우클릭 = "(읽기전용)" 1항목 안내 메뉴**: ContextMenu에 `note` 변형(회색·기울임·비인터랙티브) 신설, 노드 메뉴 빌더가 현재 스코프 밖 대상이면 안내 1개만 반환 — 캔버스(종전 차단)·아웃라인(종전 풀 편집 메뉴 오노출) 공통 경로로 통일.
- **서브프로세스 우클릭 메뉴에 하위 프로세스 펼치기/접기**: 액션 바 `expandable`과 동일 조건. nodes state엔 subEnds가 없어(displayNodes 파생 주입) `injectSubEnds`를 거쳐 판정해야 함(1차 시도 실패 원인). 구 `hasChildren` "열기" 항목은 레거시 데이터용으로 존치.
- **모달 연결 버전 패리티**: `SubprocessVersionPicker`(최신 추종 토글·버전 고정·업데이트)를 편집 모달에 슬롯(`versionPickerSlot`)으로 주입 — 인스펙터와 동일 컴포넌트·즉시 반영. IIFE 내 인라인 클로저가 react-hooks/refs 오탐 → 톱레벨 `handleSummaryUpdateSubprocess`로 호이스트.
- **설명 상속(베이스+추가분)**: 노드 description엔 이 맵의 추가분만 저장, 표시는 링크맵 `sp_description`(SubprocessRef로 이미 클라이언트 도달) + 줄바꿈 + 추가분 합성(`lib/subprocess-description.ts`, vitest 5). 모달은 베이스 읽기전용 블록 + 추가분 textarea(플레이스홀더 안내), 인스펙터는 합성 표시. 등록(지정) 시 설명 입력은 기존 기능 그대로.
- **게이트**: vitest 474/474·lint 0 err·tsc 0·build OK. 라이브 pw 6검증(메뉴 펼치기/접기 라벨 전환·캔버스↔아웃라인 선택 상호 동기화·봉인(중첩 서브 dblclick에도 스코프 붕괴/중복 key 0)·읽기전용 메뉴 양표면·모달 토글 API 영속·추가분 분리 저장+합성 표시) 전부 그린.
- **후속(미처리)**: Excel/Word/CSV 내보내기는 subprocess 설명에 추가분만 실림(합성 미반영) · 읽기전용 모달 변형은 설명 자체 미표시(기존) · 아웃라인 자식 행 더블클릭 이름편집 UI는 여전히 뜨고 조용히 무시됨(우클릭만 정리됨).

## 2026-07-17 — 인라인 펼침 드래그 버그 3종 해소: 팬텀 링 카메라 점프(#2)·Shift 축고정(#3a)·Ctrl복제 드리프트(#3b) (worktree-inline-expand-drag-fix)
- 핸드오프 `docs/superpowers/specs/2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md`의 ②③ 해소. dev 기준 브랜치.
- **#2 "프리즈" 근본 원인 반전**: 가설(no-op 커밋)은 라이브 계측으로 **반증** — 제자리 커밋은 무해. 진범은 `screenRectOf`가 `nodesRef`(저장좌표)로 링 rect를 계산 → 펼침 중 footprint-shifted 노드 드래그 시 dwell 링이 실제 노드보다 footprint(예: 868px)만큼 왼쪽(화면 밖)에 잡히고, `ensureRingVisible`이 팬텀 링을 향해 카메라를 200ms 애니메이션 팬(드롭 후에도 지속, d3 줌 플라이트) → 노드가 화면 밖으로 밀려 이전 좌표 클릭이 전부 빗나감 = "하드 프리즈"로 관측. 수정: `reactFlow.getNode`(표시좌표) 사용 + 현재 스코프 멤버십 가드 유지(읽기전용 임베드 자식은 기존대로 링 제외).
- **표시↔저장 환산 헬퍼 추출**: `lib/inline-shift.ts` `displayToSavedX`/`offsetAtSavedX` — finalize의 고정점 반복 루프(도달 불가 갭 표시값에서 진동 발산)를 구간 직해+앵커 클램프로 대체. vitest 7건(경계·왕복·갭 클램프·다중 앵커).
- **#3a**: 펼침 추적 경로는 position 변경이 suppress로 버려져 `dropDraggingPositions`의 축 고정을 안 탐 → `handleNodeDrag` 라이브 기록 시점에 `constrainToAxis` 직접 적용(다중선택 `onSelectionDrag` 경로와 대칭).
- **#3b**: `applyCtrlDragCopy` 원위치 복귀가 `ghost.position`(RF 보고값=표시좌표)을 저장좌표로 박던 것 → `rootOffsets`로 표시→저장 환산한 `resetPos`를 updater 밖에서 선계산(StrictMode 순수성 유지). 미펼침은 오프셋 없음=기존 동작.
- **게이트**: 프론트 단독(백엔드 0줄). vitest 469/469(신규 7 포함)·lint 0 err·tsc 0·build OK. 라이브 Playwright(시드 맵2 v12 펼침 상태): 드롭 후 노드 화면 내 유지+재드래그 ALIVE, Shift 드래그 y 고정(RF raw y=224에도 커밋 y=200), Ctrl복제 원본 API 저장좌표 무오염(540,264)+사본 정확 환산(1672→804), 평면 맵 회귀 없음.
- 백로그 잔여 해소: `applyCtrlDragCopy`(Ctrl+드래그 노드 복제)가 내부 엣지를 복제할 때 `sourceHandle`/`targetHandle`을 매번 `right`/`left`로 하드코딩 → 디시전 분기 엣지가 한쪽으로 뭉치던 문제(Ctrl+C/V paste는 앞선 백로그에서 해소됨, Ctrl+드래그판만 잔존). `edge.sourceHandle ?? sourceHandleId("right")`/`edge.targetHandle ?? targetHandleId("left")`로 원본 핸들 보존·없을 때만 폴백(handlePaste와 동일 관례). 2줄.
- 게이트: lint 0·tsc 0·vitest 462/462. 프론트 단독(백엔드 무변경). 리뷰된 동일 패턴 재사용이라 라이브 pw 생략.

## 2026-07-17 — 에디터 백로그 픽스 2건: 붙여넣기 엣지 핸들측 보존 + add-node 즉시 선택 (worktree-editor-backlog)
- `worktree-editor-improvements`가 남긴 후속 미해결 ①·④ 해소. **FIX1**: `handleCopy`가 `sourceHandle`/`targetHandle`을 클립보드 엣지에 캡처 안 하고 `handlePaste`가 매 엣지에 `right`/`left`를 하드코딩 — 디시전 Yes/No 분기 엣지가 붙여넣기 후 한쪽으로 뭉치던 버그. `lib/node-clipboard.ts`(`ClipboardEdge`+`buildPaste`)와 `handleCopy`/`handlePaste`(page.tsx)에서 핸들을 캡처·전달하고, 없을 때만 기존 기본값(`right`/`left`)로 폴백. Ctrl드래그 사본(`beginCtrlDrag`)의 동일 하드코딩은 스코프 밖이라 유지.
- **FIX4**: `handleAddNode`가 새 노드를 `selected:true` 없이 추가(별도 `setSelectedId`만 호출) — `handleCopy`는 RF `node.selected` 필터라 방금 추가한 노드는 재클릭 전까지 Ctrl+C가 안 먹힘. `handlePaste`와 동일 패턴(기존 선택 해제+새 노드 `selected:true`)으로 통일.
- TDD: `node-clipboard.test.ts`에 `buildPaste` 핸들 보존/미지정 폴백 테스트 2건(RED 확인 후 GREEN). 게이트: lint 0·tsc 0·vitest 462 전부 그린.
- 실기동: 좀비 백엔드(삭제된 `editor-improvements` 워크트리의 고아 uvicorn, 8000 500) kill 후 이 워크트리 자체 백엔드로 재기동. `pw-verify-node-copy.mjs`에 시나리오 (e) 추가(＋메뉴로 노드 추가 직후 재클릭 없이 Ctrl+C→Ctrl+V → 정확히 1개 복제) — 전체 17/17 PASS, 콘솔 에러 0.
- **②·③ 보류(다음 세션)**: ②노드 프리즈는 라이브 계측 결과 "서브프로세스 인라인 펼침 상태 + footprint-shifted 노드" 한정 기존 버그(`2a78b6b`, `finalizeRootDrag` no-op 커밋), ③도 같은 펼침 좌표 머신 → 근본 원인·재현·수정 방향을 `docs/superpowers/specs/2026-07-17-inline-expand-drag-bugs-NEXT-SESSION.md`에 기록(커밋 `c36c400`). 후속 잔여: Ctrl드래그 사본 엣지 핸들 하드코딩(FIX1의 Ctrl드래그판, 스코프 밖).

## 2026-07-17 — 메인 탭 UX 개선 구현 완료 (worktree-main-tabs-ux)
- dev `0b72270` 기준 신규 브랜치. 설계 `docs/superpowers/specs/2026-07-17-main-tabs-ux-design.md`, 구현 계획 `docs/superpowers/plans/2026-07-17-main-tabs-ux.md`(16 TDD 태스크).
- **구현 완료(Task 1–15)** — subagent-driven(태스크별 구현+2단계 리뷰). 전부 클라이언트, **백엔드 무변경**(git diff 확인). 커밋 `b746c7b`…`28f9077`(구현+리뷰 픽스 포함). 최종 게이트: **tsc 0 · vitest 471/471(신규 org-tree/donut-geometry/recent-order 포함) · lint 0 errors(무관 사전 warning 1) · build 성공(전 라우트)**. Task 10 대시보드는 라이브 Playwright 10/10(auto-expand 포함) 검증.
  - 리뷰 픽스 5건: T1 테스트 픽스처 타입(tsc), T4 좁은화면 인라인 상세 renderCard, T5 도넛 `-0` offset, T7 recent-top peek/commit 분리(StrictMode), T10 auto-expand deps 축소(refresh clobber).
  - ⚠️ **미검증(배포 전 권장)**: Inbox/Notices 다이제스트·Feedback 딥링크·조직도 아코디언은 서버/원격 IP 실기동 브라우저 확인 미완(로컬 게이트만 통과).
- 스코프 5항목(전부 클라·백엔드 무변경): ①Maps 좌측 = 나의부서 즐겨찾기 + 오우닝부서 조직도 아코디언(모두접기, 카드 디자인 유지+`[SP]` 배지, 목록/상세 양쪽) ②Maps 우측 홈 대시보드 = 최근열람(최상단·스태거 진입) + 내오너 문서 상태 도넛(세그먼트 클릭→목록, 기본 draft) + 승인필요 단계 그래프(status 파생); 대시보드 맵행 hover→Open·클릭→선택(좌측 자동펼침 포커스) ③Feedback 작성하단 최근피드백 카드+`?feedback=<id>` 딥링크 ④Inbox 미선택 우측 활동요약 다이제스트 ⑤Notices 동일 다이제스트.
- 사용자 요청 "알림 카테고리 아이콘+필터"는 dev(`lib/notification-categories.ts`+inbox)에 이미 구현되어 스코프 제외.
- **Task 1-4 구현**: `lib/org-tree.ts`(순수 헬퍼 `buildOrgTree`/`filterMyDeptMaps`) + `OrgAccordion`/`MyDeptFavorites` 컴포넌트(Task 1-3) → `page.tsx` 좌측 브라우즈 컬럼에 배선(Task 4). 브라우즈 모드는 이제 "나의 부서 즐겨찾기(핀)" + 오우닝부서 조직도 아코디언(모두접기, 롤업 카운트)만 렌더 — 기존 최근열람 밴드는 좌측에서 제거(우측 대시보드로 이동 예정, Task 7). 검색·필터 모드(평면 리스트+최근매치 상단고정)는 무변경. 내 정보(`getMe`)·디렉터리(`getDirectory`)로 초기 펼침을 내 `org_path` 조상 경로로 시드. tsc/lint/build 전부 그린.
  - `useDirectory()`(`lib/directory.ts`)는 유저 Map만 노출(부서 미포함, 다른 4곳이 그 계약에 의존)이라 브리프 가정과 달라 `getDirectory()`를 page.tsx에서 직접 fetch — 공유 훅은 무변경.
- **Task 11 구현**: `feedback/page.tsx`에 딥링크 `?feedback=<id>` — 목록 로드 후 해당 id가 있으면 상세 모달 1회 오픈(`useRef` 가드), 모달 close 시 param 제거. `useSearchParams` 대신 `window.location.search` 직접 파싱으로 Next.js Suspense 경계 요구를 회피(빌드 시 `/feedback`이 정적 페이지로 유지됨 확인). tsc/lint/build 전부 그린.
- **Task 12 구현**: `feedback-side-panel.tsx` 작성폼 아래 "내 최근 피드백" 섹션 — 패널 `open` 시 `listFeedback()` 페치 후 `author === getCurrentUser()?.loginId`(정확한 필드명은 `current-user.ts` 확인) 필터·`created_at` desc 상위 5개. 카드 클릭 → `/feedback?feedback=<id>`(Task 11 딥링크) 이동 + `onClose()`. kind/status 필은 `feedback-meta.ts` 기존 토큰(`FEEDBACK_KIND_STYLE`·`FEEDBACK_STATUS_STYLE`) 재사용, 이모지 미사용. i18n 키 2종(`feedback.yourRecent`, `feedback.viewOnPage`) en+ko 추가. tsc/lint/build 전부 그린.
- **Task 7 구현**: `lib/recent-order.ts`(TDD, `readTopChanged` — sessionStorage `bpm.home.recentTop`로 최상단 id 변화 감지) + `RecentOpenedList`(최근열람 렌더, top 변경 시 `slideDown` 스태거 진입 — `motion-safe:` 가드, 45ms 딜레이). `globals.css`에 `@keyframes slideDown` 신설(기존 미존재 확인). vitest 4/4·tsc·lint 그린(무관 사전 warning 1건 제외).

## 2026-07-17 — 편집 모드 개선 5종 구현 완료 (worktree-editor-improvements)
- 계획 `docs/superpowers/plans/2026-07-17-editor-improvements.md`의 13 TDD 태스크 전부 구현 + 서브에이전트 리뷰 통과. 브랜치 커밋 `c064f89`…`467b82d`(18 코드 커밋). dev 기준, **미머지·미푸시**.
- **(1) 노드 복사/붙여넣기/Ctrl드래그**: Ctrl+C/V + Ctrl드래그 복제. 복사 대상 process·decision·end(start·subprocess 제외·토스트). `localStorage` 클립보드로 크로스탭/크로스맵. 다중+내부엣지. `makeCopyLabel`(`(n)` 증분). 붙여넣기 누적 오프셋+findFreeSpot(반복 Ctrl+V 겹침 방지). Ctrl드래그=원본 잔상+`+`배지, 사본 드롭. Ctrl+C는 노드 미선택 시 네이티브 복사 통과. 순수 헬퍼 `lib/drag-constrain`·`node-clipboard`·`canvas`(vitest).
- **(2) 서브프로세스 링크 유일성**: FE picker 이미 링크된 맵 자동 비활성+툴팁·`addLinkNodeFromMap` 차단. 백엔드 graph PUT 422 가드 — **기존 중복링크는 grandfather**(증가분만 차단: `count>1 and count>stored_counts[mid]`)해 운영 맵 브릭 방지.
- **(3) SP 설명 + 등록 알림**: `ProcessMap.sp_description` 신설(`_ADDED_COLUMNS` 등록=자동 ALTER)·스키마 3읽기경로·FE 3표면(모달/카드/패널)·`get_subprocess_refs` 채움. 최초 지정 시 오너+활성승인자 알림(`subprocess_registered`, actor 제외, 영문 메시지)·inbox `subprocess` 카테고리.
- **(4) Shift 축 고정**: `constrainToAxis`로 단일·다중선택(overlay 포함)·그룹 이동 축 고정. selectionKeyCode=null.
- **(5) SP 목록 접근+검색**: pane 우클릭 메뉴 하단 항목 + 전역 `S` 단축키(입력/모달/menu 가드)·검색 자동포커스·공용 `filterByQuery`(이름+부서 초성/로마자/순차).
- **게이트(최종 467b82d)**: 백엔드 pytest **635 pass**·ruff clean. 프론트 lint 0·tsc 0·vitest **429 pass**·build OK. Playwright 실검증(실서버 기동) 실행: node-copy 14/14·ctrl-drag 31/31·library-search 7/7·library-open 8/8·link-unique 13/13, 콘솔 에러 0.
- **후속(미해결)**: ①붙여넣기 엣지 핸들측 소실(분기 엣지 시각 뭉침, 위상/라벨은 보존) ②연속 평범 드래그 시 노드 프리즈(**기존 버그**, 이 브랜치 무관) ③인라인 펼침 상태에서 단일 Shift축고정 비활성·Ctrl드래그 사본 좌표 드리프트 가능(좁은 케이스) ④add-node 후 즉시 Ctrl+C 미복사(selectedId≠node.selected).

## 2026-07-17 — 편집 모드 개선 5종 설계 스펙 (worktree-editor-improvements)
- dev 기준 신규 브랜치·워크트리. 설계 `docs/superpowers/specs/2026-07-17-editor-improvements-design.md`(구현 대기).
- 범위: (1) 노드 복사/붙여넣기/Ctrl드래그(process·decision·end 한정, start·subprocess 제외·토스트, localStorage 클립보드로 크로스탭/크로스맵, `(n)` 증분, 다중+내부엣지) (2) 서브프로세스 링크 유일성(FE picker 자동 비활성 + 백엔드 422 가드) (3) SP 설명 필드 `sp_description`(백엔드/DB 자동ALTER) + 최초 지정 시 오너·승인자 알림 (4) Shift 드래그 축 고정(단일·다중·그룹) (5) SP 목록 우클릭 메뉴·`S` 단축키·자동포커스·`filterByQuery` 초성검색.
- 조사: 노드 모델/드래그·서브프로세스 지정·알림·SP패널/검색 4개 read-only 탐색 완료. 결정: subprocess 복사 제외(기능2 충돌 회피), 다중+엣지 복사, 붙여넣기 오프셋, 백엔드 가드 추가, DB 변경 승인, Ctrl드래그 잔상+`+`배지.
- 구현 계획 `docs/superpowers/plans/2026-07-17-editor-improvements.md`(TDD 13태스크, 순서 4→1→5→2→3). 순수 헬퍼는 vitest·백엔드는 pytest·page.tsx 배선은 Playwright 검증.

## 2026-07-17 — Excel 출력 양식 2안(WBS) + 형식 선택 모달 (worktree-excel-export)
- 미리보기 행 스태거 등장 애니메이션 — 기존 `item-fade-in` 키프레임 재사용(`globals.css` `.preview-row-in`, 350ms ease-smooth both + 행별 45ms 딜레이, reduced-motion 가드), 양 형식 테이블 공통. 실측: computed style로 클래스·딜레이 확인 + pw 19/19 회귀 그린.
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md`. 신규 `lib/excel-wbs.ts` — 잎 업무 행+레벨 경로(`levels`), SP 무행(레벨 값=SP 노드 타이틀·루트=맵 이름), start/end 전부 삭제(Next 종착 텍스트 유지), 무라벨 디시전 flow-through·`[No:라벨]` 주석(SP 대상 소멸)은 1안과 동일 체계. 시트 "WBS": 동적 Level 1..N 컬럼(회색 `FF9CA3AF`)+1안 속성 꼬리(numFmt 정의 파생).
- Excel 버튼 → 형식 선택 모달(`components/excel-export-modal.tsx`): 한/영 세그먼트 토글 디자인 탭(Process Map/WBS)+첫 8행 미리보기(lazy 빌드·캐시)+Download. 파일명 WBS는 `_WBS` 접미. 다운로드는 `downloadWorkbookXlsx` 공용화(exceljs 동적 import 유지).
- 게이트: vitest 전체·tsc·lint·build 그린.
- 실기동 검증 pw-verify-excel-wbs.mjs 시나리오 12종·assertion 19/19 PASS(모달 플로우·양 형식 다운로드 파싱 — WBS 레벨 컬럼·SP 무행·start/end 0행·주석·1안 회귀·콘솔 0).

## 2026-07-17 — Excel 출력 양식 2안(WBS) 설계 확정 (worktree-excel-export)
- 레벨 컬럼 WBS 시트+형식 선택 모달(토글 탭·미리보기) 설계 — 사용자 확정 4건(모든 행 반복+회색 톤다운·start/end 전부 삭제·SP Next 이름 유지·모달 토글탭). 설계 docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md, 계획 docs/superpowers/plans/2026-07-17-excel-export-wbs-v2.md.

## 2026-07-17 — Excel 출력 양식 개선 1안 구현 (worktree-excel-export)
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md` 4규칙 구현: ①무라벨 병렬 디시전 행 제거+Next flow-through(라벨은 최종 대상까지 전파) ②첫 start 외 start 행 제거 ③기본 제목("end", trim·대소문자 무시) end 행 제거(Next의 End 표기는 유지) ④라벨 분기 대상 Name에 `[디시전No:라벨]` 주석(행 객체 참조로 역방향·다이아몬드 안전). No는 모델에서 확정(`ExcelNodeRow.no`).
- CSV 내보내기는 왕복 계약이라 미적용. 게이트: vitest 전체·tsc·lint·build 그린.
- 실기동 검증 pw-verify-excel-format-v1.mjs 10/10 PASS(스크래치 맵 픽스처 → xlsx 파싱 — 행 제거·flow-through·주석·No 연속·콘솔 0).
- 최종 리뷰 백로그 해소: ①재수렴 시 Next·주석 중복 제거(같은 (대상,라벨) 쌍 1회 — 사용자 확정 정책) ②행 상한 도달 시 `return`→`break`로 이미 출력된 행의 주석 보존 ③혼합 디시전 무라벨 분기→삭제 디시전 flow-through 회귀 테스트 추가, pw 규칙2 체크를 Type 컬럼 기반으로 강화(미도달 start 픽스처는 PUT /graph의 start=1 검증 때문에 불가 — 모델 vitest가 판별 담당). 게이트 vitest 433·tsc·lint·build 그린, pw 재실행 10/10. 잔여: Windows 실물 Excel 눈검증 1회(배포 전 수동).

## 2026-07-17 — Excel 출력 양식 개선 1안 설계 확정 (worktree-excel-export)
- 엑셀 산출물 2종 분리 작업의 1단계 설계 — 구조 노드 행 정리(무라벨 디시전·첫 start 외·기본 제목 end)+분기 주석(`Name [디시전No:라벨]`)·Next flow-through 규칙 확정. 설계 `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md`. CSV는 왕복 계약이라 미적용. Groups 반영 검토 — 정상(무명 그룹만 제외됨).

## 2026-07-16 — 매뉴얼 버튼 일관화 + /manual 외부 매뉴얼 드롭다운 (worktree-manual-buttons)
- 분산 유지 구조에서 표기 통일: 에디터 툴바 매뉴얼(D2)을 네이티브 title→스타일드 `<Tooltip>`으로 통일, 외부 새 탭 버튼(D2 툴바·D3 CSV 액션)에 `ExternalLink` 큐 추가(내부 /manual 라우팅과 구분 — 에디터 우상단 BookOpen 2개 혼동 해소).
- `/manual` 뷰어에 "한눈에 보기"(At a glance) 드롭다운 신규 — `getMe()`의 `manual_url`(편집사이트)·`csv_manual_url`(CSV안내)을 앵커로. 둘 다 미설정이면 트리거 숨김. i18n 키 `manual.externalMenu`·`manual.editSite` 추가.
- 설계 `docs/superpowers/specs/2026-07-16-manual-buttons-rearrange-design.md`. 게이트: lint/tsc/build 그린 · 브라우저 실검증 `pw-verify-manual-dropdown.mjs` 8/8 통과(API 모킹, 콘솔 에러 0 — 트리거 노출/드롭다운 2항목/external 큐/window.open 대상 URL, 둘 다 미설정 시 트리거 숨김). 백엔드 무변경.

## 2026-07-16 — CSV 매뉴얼 버튼 배포 파이프라인 개통 + compose 누락 방지 룰 (worktree-manual-buttons)
- CSV 임포트 안내 버튼(`csv-manual-link`, 홈 CSV 생성 모달·에디터 임포트 모달)이 프로덕션에서 절대 안 뜨던 문제 — `settings.csv_manual_url`(env `CSV_MANUAL_URL`)이 `.env.example`·`settings.py`·`schemas.py`·`main.py`엔 있었으나 **`docker-compose.yml` backend `environment:`에만 누락**. backend 서비스엔 `env_file:`가 없어 `.env` 값이 컨테이너에 도달 못 함 → `/me`가 빈 값 반환 → 버튼 영구 숨김(로컬 네이티브에선 정상이라 미발견). `MANUAL_URL`(편집 매뉴얼, 툴바 F9)은 이미 전달됨.
- `docker-compose.yml`에 `CSV_MANUAL_URL: ${CSV_MANUAL_URL:-}` 추가(파이프라인 개통).
- 재발 방지: `rules/backend/config.md`에 "새 Environment 카테고리 Settings 필드는 backend `environment:` 블록에도 반드시 매핑" 룰 명문화(no `env_file:` 근본 원인·`CSV_MANUAL_URL` 선례 기록). CLAUDE.md `@import` 대상이라 다음 세션 자동 로드.

## 2026-07-18 — 로그인 실패 시 막다른 빨간 화면 제거 + 세션 유효 시 무클릭 자동 복구 (main)
- 증상: 일부 유저가 Keycloak 로그인 직후 홈("/")에 빨간 "Auth error: …" 한 줄만 뜨는 막다른 화면에 갇히거나, 로그인 카드에 도달하지 못함. 근본 원인: `AuthGate`(`frontend/src/components/providers.tsx`)의 미인증→`/login` 리다이렉트 effect가 `!auth.error`로 가드돼 에러 시 동작 안 함 + 유일한 복구 effect가 `login_required`만 처리 → 그 외 에러(oidc `No matching state`·토큰 교환 실패·`consent_required`·시계 오차 등)는 복구 경로 없는 데드엔드 렌더로 낙하.
- 수정: 데드엔드 빨간 렌더 삭제(→ 에러는 not-authenticated로 로딩 화면 후 `/login` 복귀). 에러를 종류별 분기 — `login_required`(세션 없음, 정상)는 곧바로 카드+silent 억제, 그 외는 **세션이 살아있을 수 있으니 silent 자동 재시도 1회**(무클릭 로그인) 후 소진 시에만 카드로 폴백. 재시도 상한 1로 지속성 에러(시계 오차·스토리지 차단) 무한 리다이렉트 루프 방지.
- 파일: `providers.tsx`(effect 분기·데드엔드 제거·미사용 `useI18n`/`t` 정리), `lib/auth-return.ts`(`tryConsumeAuthRetry`/`clearAuthRetry`, 상한 1), `lib/auth-return.test.ts`(카운터 2건). i18n 키 `auth.error`는 미사용이나 데이터라 존치.
- 게이트: vitest 416 pass(신규 2)·lint clean(기존 무관 경고 1)·build(tsc+React Compiler) OK. **미검증**: 실제 Keycloak 에러 경로는 로컬 재현 불가(`AUTH_ENABLED=false`) — 서버 배포 후 수동 확인 필요(세션 유효 무클릭 로그인·콜백 새로고침 복구·세션 없음 카드 표시).

## 2026-07-16 — 새 맵 생성 시 Start·End 자동 시드 (worktree-workflow-improvements)
- 빈 새 맵이 캔버스가 비어 있던 문제 — `create_map`(`backend/app/routers/maps.py`)이 초기 버전에 Start·End 노드 2개를 자동 삽입(엣지 없음, 고정 LR 좌표, id=uuid hex). CSV 임포트 생성과 동일한 UX. 설계 `docs/superpowers/specs/2026-07-16-new-map-start-end-seed-design.md`.
- 범위: 새 맵의 초기 버전만(빈 새 버전·복사는 대상 아님). CSV 생성 경로 무영향(`PUT /graph` 전체 교체로 시드가 CSV 노드로 대체 — 중복 없음). `validate_process` 통과(start 1·대표 end 1·제목 유니크).
- 테스트: `test_maps.py`(생성 후 graph에 start/end 존재)·`test_graph.py`의 `test_new_version_has_empty_graph`→`test_new_map_version_seeds_start_end` 갱신. 게이트: pytest 609 pass·ruff clean. 브라우저 실검증 `pw-verify-new-map-seed.mjs` 5/5(에디터 Start·End 2노드 렌더, 엣지 0, 콘솔 에러 0).

## 2026-07-16 — 서브프로세스 워크플로 2건 개선 — 구현 완료 (worktree-workflow-improvements)
- 설계 `docs/superpowers/specs/2026-07-16-subprocess-workflow-improvements-design.md` + 계획 `docs/superpowers/plans/2026-07-16-subprocess-workflow-improvements.md`(TDD 3태스크). 구현 커밋: 백엔드 `f54f1dd`·프론트 생성경로 `432f8bf`·승인탭 카드 `cd25843`.
- **(1) `follow_latest`(최신본 추종) 생성 기본 ON — 모든 생성 경로 통일**: 라이브러리 드롭(`page.tsx:3701`)·AI 변환(`page.tsx:613`)·CSV 임포트 기본값(`csv-import.ts:186`)·`NodeIn` 스키마(`schemas.py`)·`Node` DB 컬럼 ORM 기본값(`models.py`) 5지점 `false→true`. `addLinkNodeFromMap`은 이미 ON. 읽기/직렬화 폴백 `?? false`는 유지(기존 노드 드리프트 방지, 마이그레이션 없음). 테스트: `test_graph.py`(생략 시 True 저장)·`csv-import.test.ts`(임포트 노드 follow_latest true).
- **(2) 게시본 승인 탭에 서브프로세스 지정 카드 노출**: 기존 `SubprocessInspectorCard`를 승인 탭(`approvalSlot`)의 `ApprovalPanel` 아래·버전 목록 위에 재사용(백엔드 무변경, `spCanManage`/`spDisabledReason` 게이팅 재사용).
- **게이트**: 백엔드 pytest 608 pass·ruff clean. 프론트 vitest 414 pass·tsc 0·lint 0 err(pre-existing 경고 1)·build OK. 브라우저 실검증 `pw-verify-approval-sp-card.mjs` 9/9 pass(게시본 카드 활성+지정 모달 진입, 미게시본 비활성+사유 노트, 콘솔 에러 0).

## 2026-07-16 — whole-branch 최종 리뷰 픽스: 퍼지 후 재조회 + 벨 인박스 내 이동
- **Finding 1(Critical) 픽스** — `table-viewer.tsx`: 퍼지 확정 시 `setPage(1)`이 이미 page=1이라 no-op되어 fetch effect가 재실행되지 않고 `isFetching`이 영구 true(무한 "Loading…")로 굳는 버그. `refreshTick` state 추가 + fetch effect deps에 포함 + `onPurged`에서 tick 증가로 강제 재트리거.
- **Finding 2(Important) 픽스** — `notification-bell.tsx` `handleOpen`: `/inbox` 체류 중 클릭 시 `router.push`가 같은 라우트라 리마운트 없어 딥링크 소비 무동작 → 현재 경로가 `/inbox`면 `window.location.assign`으로 하드 네비게이션 강제.
- **검증 보강** — `pw-verify-notifications.mjs` 시나리오 6에 회귀 가드 신설(check "6b"): 퍼지 후 테이블 재조회 GET 대기 + "Loading…" 스피너 미잔존·"No rows"/실제 행 렌더 확인.
- 게이트: tsc/lint/build 그린. E2E 클린 재시드 후 재실행 10/10 PASS(신설 6b 포함). 상세: `.superpowers/sdd/final-review-fixes.md`.

## 2026-07-16 — Task 12 완료: 전체 게이트 + Playwright 실검증 (알림 퍼지 브랜치 최종)
- **Task 12 리뷰 픽스** — pw 스크립트 단언 강화 3건: 콘솔 에러 총량 게이트 신설(check 8 `consoleErrors.length === 0` — validateDOMNesting 외 임의 런타임 에러도 FAIL, 실측 0건이라 allowlist 불요) · 퍼지 정확 감소 단언(확정 버튼 라벨에서 N 파싱 → `after === before - N`, 부분 삭제 버그 감지) · 시나리오 ① 알림 탭 활성 직접 단언(탭 세그먼트 스코프 `text-accent` + Approvals 비활성). 클린 DB 전체 재실행 9/9 PASS, 서버 종료·dev.db 재시드 정리 완료.
- **Task 12 완료** — 전체 게이트 그린: backend pytest 624 passed·ruff clean, frontend vitest 416 passed·tsc 0 errors·lint 0 errors(무관 사전 경고 1건)·next build 성공. `frontend/scripts/pw-verify-notifications.mjs` 신규(`pw-verify-dashboard.mjs` 하네스 재사용 — playwright-core+시스템 Chrome, devUser `admin.sys`) — 벨 딥링크/개별삭제, 알림탭 카테고리 필·선택삭제·읽음삭제·날짜이전삭제, 관리자 기간 퍼지(미리보기→확정→행수 감소) 6개 시나리오 + 콘솔 에러(validateDOMNesting) 수집, 클린 DB(reset_db+seed_org_demo)에서 8/8 PASS. 잔여 리스크: `worktree-workflow-improvements`(미머지, `inbox/page.tsx` 승인 탭 수정)와 향후 머지 시 충돌 가능성 — 상세: `.superpowers/sdd/task-12-report.md`.

## 2026-07-16 — Task 11 완료: 매뉴얼 알림 삭제·보존·퍼지 반영 + 감사 불일치 4건 교정
- **Task 11 완료** — `user-manual-general-{ko,en}.md` 알림·승인 절 재작성: 벨 5초 폴링·클릭 시 알림 탭 이동+자동읽음·항목별 삭제(X), 알림 탭은 페이지 진입 시 1회 로드(자동 갱신 없음), 카테고리 필터 5종(전체/버전/점유권/권한/공지)+선택모드 일괄삭제+읽은 알림 삭제+날짜지정 삭제(확인 모달, 복구불가), 1인당 최근 100건 보존, checkout·permission 벨 알림 반영 · 공지 읽음이 브라우저(기기)별 localStorage임을 명시. `admin-manual-{ko,en}.md` — 공지 삭제는 하드 삭제·휴지통 없음·복구불가(단 기 발송 벨 알림은 잔존)로 교정 + "알림 기간 삭제(퍼지)" 절 신설(§8, `notifications` 테이블 선택 시 기간 지정→preview 모달 기본 전체선택→체크 해제 확정→하드삭제) + 100건 보존 항목 추가. `backend/app/manual.md` 벨 서술 1문장 확장(클릭 이동·삭제·100건). `docs/alarm-audit.md` §8 불일치 4건(①인박스 갱신주기 ②보존정책 공백 ③공지 하드삭제 ④공지 읽음 기기별) 전부 교정 완료.

## 2026-07-16 — Task 10 완료: 관리자 퍼지 UI (테이블 뷰어 + 모달)
- **Task 10 재리뷰 픽스** — aliveRef effect setup에서 `aliveRef.current = true;` 복원 1줄(StrictMode dev의 mount→cleanup→re-mount에서 useRef(true) 초기값이 재설정되지 않아 영구 false → purge 실패 시 catch 즉시 return으로 에러 무표시+busy 데드락 방지). tsc/lint 그린.
- **Task 10 리뷰 픽스** — 퍼지 모달 3건(`notification-purge-modal.tsx`만): busy 중 닫힘 차단(백드롭 onClick `if (!busy)` 가드 + Cancel `disabled={busy}` — in-flight 중 닫혀 onPurged가 다른 테이블 상태를 오염시키는 경로 차단) · runPurge catch에 `aliveRef` 언마운트 가드(preview effect의 alive와 일관) · 로딩/에러 배타(preview 실패 시 스피너 숨김 — `groups === null` 분기 안에서 `!error &&`로 처리해 TS null-narrowing 유지, 리뷰 제안의 `groups === null && !error ?` 삼항 조건 변경은 else 분기 `groups.length` null 타입 에러라 조정) + runPurge 시작 시 `setError(null)`. tsc/lint/build 그린.
- **Task 10 완료** — `notification-purge-modal.tsx` 신규(preview `(type,message)` 묶음을 체크박스로 확정 후 하드 삭제, 기본 전체 선택, `bg-error`/`text-on-accent`는 `confirm-dialog.tsx` 등에서 이미 쓰이는 기존 theme 토큰이라 그대로 사용) · `table-viewer.tsx` 훅업 — 헤더 바 우측에 `selected === "notifications"`일 때만 기간 입력 2개+삭제 버튼(날짜 역전 시 disabled) 노출, 퍼지 완료 시 `setPage(1)`/`setLoadedPage(0)`/`setRows([])`+`listDbTables()` 재조회로 표·pill 카운트 동기화 · i18n 8키 EN·KO 양쪽. tsc 0 errors, lint 0 errors(무관 사전 경고 1건), next build 통과.

## 2026-07-16 — Task 9 완료: 알림 탭 딥링크·카테고리 필·선택/읽음/날짜 삭제
- **Task 9 완료** — `inbox/page.tsx`: 벨 딥링크(`?notification=<id>`) 마운트 effect fetch `.then` 안에서 소비(탭 전환·선택·읽음 처리·`router.replace("/inbox")`로 파라미터 소거) · 카테고리 필 필터(`getNotificationCategory` 체인, `useInfiniteSlice` resetKey에 `categoryFilter` 포함) · 선택모드(체크박스 토글, 카드 클릭이 selectMode에서 toggle로만 동작)+읽음 삭제+날짜 이전 삭제 툴바 · 개별 삭제 버튼(카드 시간 필 옆) · `ConfirmDialog`는 같은 파일 `ApprovalDetail` 승인/반려 모달 시그니처 그대로 재사용(danger+icon+message 1줄) · `typeIcon`에 `checkout_`/`permission_` prefix 매핑 추가 · i18n 14키 EN·KO 양쪽 추가. tsc 0 errors, lint 0 errors(무관 사전 경고 1건), vitest 416/416 passed.
- **Task 9 리뷰 픽스** — 알림 카드 외곽 `<button>`→`<div role="button" tabIndex={0}>`(내부 삭제 버튼과의 button-in-button `validateDOMNesting` 콘솔 에러 해소 — 클라이언트 마운트 시 renderer가 검사하므로 SSR 무관하게 실측 발생하던 문제, onKeyDown Enter/Space+`cursor-pointer` 부착, 승인 탭 카드는 내부 버튼 없어 미접촉) · 체크박스 input→Lucide `CheckSquare`/`Square` 시각 표현(토글은 카드 클릭 유지) · `performBulkDelete` 성공 후 `setBeforeDate("")` 리셋 · `deleteOne`이 selectedIds에서도 해당 id 제거. tsc/lint/vitest 재실행 전부 그린(416/416).
- **Task 9 재리뷰 픽스** — 카드 `onKeyDown`에 `e.target !== e.currentTarget` 가드 1줄(내부 삭제 버튼 포커스에서 Enter/Space 시 keydown 버블링으로 카드의 preventDefault가 버튼 활성화를 취소하고 열람이 대신 실행되는 "삭제 대신 열람" 회귀 방지). tsc/lint 그린.

## 2026-07-16 — Task 8 완료: 벨 드롭다운 삭제 버튼 + 클릭 네비게이션
- **Task 8 완료** — FE 벨 드롭다운: import 추가(lucide-react `X`, next/navigation `useRouter`, api `deleteNotification`) · 핸들러 2개(plain function, async catch 주석) · `handleDelete` — API 호출 후 UI 필터 제거 · `handleOpen` — 드롭다운 닫고 `/inbox?notification=${id}` 라우트 · `<li>` 교체 — `cursor-pointer` + `hover:bg-surface-alt` + onClick 핸들러 + 기존 mark-read 버튼 stopPropagation + 신규 delete 버튼(`X` icon 12px strokeWidth 1.5, text-error hover) · i18n 2개 키 추가(EN `"notif.delete": "Delete"` 615행, KO `"notif.delete": "삭제"` 1986행) · tsc 0 errors, npm run lint 0 errors (unrelated test warning). `git diff --stat`: notification-bell.tsx 39줄 추가/4줄 제거, i18n-messages.ts 2줄 추가.

## 2026-07-16 — Task 7 완료: FE API 클라이언트 + 카테고리 lib
- **Task 7 완료** — FE notification delete/purge API 클라이언트 + 카테고리 매핑: `notification-categories.ts` 신설(type → category 매핑 함수 `getNotificationCategory`, 상수 `NOTIFICATION_CATEGORIES` 4종: version/checkout/permission/notice) · `api.ts` 신규 5함수·3인터페이스 추가(`deleteNotification`·`bulkDeleteNotifications`/`NotificationBulkDelete`/`NotificationBulkDeleteResult`·`previewNotificationPurge`·`purgeNotifications`/`NotificationPurgeGroup` — 백엔드 T5/T6 머지됨 계약 구현) · 신규 테스트 3건(TDD RED→GREEN) · vitest 3/3 passed, tsc 0 errors. 회귀 무변화(기존 모듈만 신규 export 추가).
- **Task 7 리뷰 픽스** — `previewNotificationPurge` 쿼리스트링 `encodeURIComponent` 부착(getDashboardTimeseries 관례 일치) · `NotificationBulkDelete.read_only`를 `boolean`→`true`로 협소화(백엔드가 false를 422로 거부 — 컴파일 타임 차단). vitest 3/3 passed, tsc 0 errors.

## 2026-07-16 — 알림 통합·삭제(퍼지)·100개 한도 구현 계획 (worktree-alarm-audit)
- 산출물: `docs/superpowers/plans/2026-07-16-notification-purge.md` — 12태스크 TDD 체크리스트(백엔드 6·프론트 4·매뉴얼 1·게이트/pw 1). 실제 코드·테스트 코드 포함, 수정 지점 file:line 명시.
- 주요 결정: `create_notifications` async화(호출 7지점 await), permission 알림은 공용 헬퍼 `_notify_permission_request`로 3지점 공유, purge 응답은 `NotificationBulkDeleteOut` 재사용, 딥링크는 useSearchParams 대신 window.location 파싱(Suspense 회피).
- **Task 1 완료** — 인덱스 2종 + `_ADDED_INDEXES` 부트스트랩: `models.py` Notification `__table_args__` 추가 · `db.py` `_ADDED_INDEXES` + `_add_missing_indexes` 함수 + init_models 호출 · 테스트 3/3 passed.
- **Task 2 완료** — `create_notifications` async화 + 인당 `NOTIFICATION_CAP=100` 트리밍(오래된 순 삭제, 읽음 무관): `workflow.py` 시그니처 async 전환 + 호출 7지점 전부 `await` 부착(`workflow.py` 내부 2·`versions.py` 4·`notices.py` 1) · 신규 테스트 1건(TDD RED→GREEN) · 회귀 5개 파일 86 passed, 전체 스위트 609 passed, ruff clean.
- **Task 3 완료** — checkout 벨 알림 3종(`checkout_requested/approved/rejected`, inbox 전용이던 비대칭 해소): `checkout.py` `request_checkout`에 요청 통지(현 점유자+오너, 요청자 제외, 중복 제거) · `decide_checkout_request`에 결과 통지(요청자 본인 + 벌크 자동거절 전 캡처한 다른 미결 요청자) · 신규 테스트 2건(TDD RED→GREEN) · 회귀 3개 파일 18 passed, 전체 스위트 611 passed, ruff clean.
- **Task 4 완료** — permission 벨 알림 3종(`permission_requested/approved/rejected`): `permissions.py` 생성 3지점(update/delete_permission 다운그레이드, request_visibility_change)에 공용 헬퍼 `_notify_permission_request`(활성 승인자, 요청자 제외) 훅업 · `decide_approval_request`는 reject/approve 양 분기에 `_notify_permission_decision`(요청자에게 결과) 훅업 · 신규 테스트 1건(TDD RED→GREEN) · 회귀 3개 파일 80 passed, 전체 스위트 613 passed, ruff clean.
- **Task 4 리뷰 픽스** — 테스트 공백 2건 보강(production 무변경): approve 경로 `permission_approved` 내용 단언(test_notifications.py) · 다운그레이드 생성 지점 kind("a permission change")·map_name·요청자 제외 단언(test_permission_endpoints.py, enforce 필요라 해당 파일 — auth off는 전원 owner라 지연 분기 미도달) · 전체 스위트 615 passed, ruff clean.
- **Task 5 완료** — 사용자 삭제 API 2개(개별 DELETE + 범용 bulk-delete): `schemas.py` `NotificationBulkDeleteIn`(ids/read_only/before 택1 검증)·`NotificationBulkDeleteOut` · `notifications.py` `DELETE /{id}` 본인 수신분만(타인 404) · `POST /bulk-delete` 조건 3종(ids 교집합, read=true 필터, before 날짜 00:00 미만) · `test_notifications.py` 신규 테스트 4건 TDD RED→GREEN · 전체 스위트 615→615 passed(15개 알림 테스트), ruff clean.
- **Task 6 완료** — 관리자 퍼지 API 2개(`GET /admin/notifications/purge-preview` + `POST /admin/notifications/purge`, sysadmin 전용): `schemas.py` `NotificationPurgeGroupOut`/`NotificationPurgeGroupIn`/`NotificationPurgeIn`(`from`/`to`는 Python 예약어라 `Field(alias=...)`) · `admin.py` `_build_kst_range`([from 00:00, to+1일 00:00) KST) + preview(type·message 묶음 집계, last_at desc)·purge(확정 묶음 하드삭제, `Task 5`의 `NotificationBulkDeleteOut` 재사용, `deleted=max(result.rowcount, 0)` — `rowcount or 0`은 -1 미방어라 교정) · `test_admin_notifications.py` 신규 테스트 3건 TDD RED(404)→GREEN · 전체 스위트 619→622 passed, ruff clean.
- **Task 6 리뷰 픽스** — 테스트 공백 3건 보강(production 무변경, test_admin_notifications.py만): POST purge도 non-sysadmin 403 단언(유효 body — 빈 groups면 422가 게이트 선행) · to 경계일 포함 검증(to일 23:00 KST 포함·to+1일 00:30 제외, `_seed`에 hour/minute 확장) + groups 2개로 or_ 다중 분기 커버 · preview last_at DESC 정렬을 격리 범위(6/25~30)에서 순서로 단언 · 파일 5 passed, 전체 스위트 624 passed, ruff clean.

## 2026-07-16 — 알림 통합·삭제(퍼지)·100개 한도 설계 스펙 (worktree-alarm-audit)
- 감사 결과 기반 설계 확정 — 산출물: `docs/superpowers/specs/2026-07-16-notification-purge-design.md`.
- 사용자 확정 4건: 승인 알림은 요청+처리결과 양쪽 / 100캡은 읽음 무관 오래된 순 / 관리자 퍼지 미리보기는 type+message 묶음(수신자 수 표시) / 후속 중 인덱스+매뉴얼 보정 포함(페이지네이션·자동 retention 제외).
- 골자: 신규 알림 type 6종(checkout·permission 요청/결과, 수신자=inbox 노출 대상과 일치) · 사용자 삭제 API 2개(개별 DELETE + 범용 bulk-delete: ids/read_only/before 택1) · 관리자 purge-preview/purge(기간+묶음 확정, sysadmin) · `create_notifications` 내 인당 100캡 트리밍 · 인덱스 2종 + db.py `_ADDED_INDEXES` 자동 보강 · 벨 클릭→`/inbox?notification=<id>` 딥링크 · 알림 탭 카테고리 필 5종+선택/조건 삭제 · 테이블 뷰어 notifications 한정 퍼지 UI. DB 신규 컬럼 없음.

## 2026-07-16 — 알람(알림) 기능 전수 조사·퍼지(삭제) 경로 분류 (worktree-alarm-audit)
- 읽기 전용 감사 — 코드 변경 없음. 산출물: `docs/alarm-audit.md`.
- **명확화**: "알람" = 3개 서브시스템(벨 notifications / 수신함 inbox / 공지 notices). inbox는 테이블 없는 실시간 집계 뷰. 생성 경로는 단일 헬퍼 `create_notifications` 호출 7지점·type 6종. checkout(점유권 이전)은 inbox 전용 — 벨 알림 미생성(비대칭).
- **퍼지 분류**: 프로덕션 삭제 경로는 공지 sysadmin 하드 삭제(D1) 단 1개. 벨 알림(`Notification`)은 삭제 API·프론트 UI·retention·cascade 전부 없음(FK 의도적 미설정, `models.py:325`) — 읽음 UPDATE만 가능, 무한 누적. 스크립트 경로는 reset_db(D2)·seed_inbox_demo(D3)뿐.
- 부수 발견: `notifications` 테이블 인덱스 전무 + GET 전건 반환 + 전 사용자 5초 폴링 → 장기 성능 리스크. 매뉴얼 불일치 4건(인박스 갱신 주기·보존 정책 공백·공지 하드삭제·공지 읽음 localStorage). 후속 후보는 docs/alarm-audit.md §9.
## 2026-07-13 — 매뉴얼 커버리지 감사 후속 픽스: 번들 스테일·오우닝 부서·회수 규칙 (main)
- fable 에이전트 커버리지 감사(READ-ONLY, i18n·라우터 대조) 결과 중 "핵심" 갭을 반영. 지적 4건은 코드로 직접 재검증(swap 드롭존은 초기 grep이 `[mapId]` 대괄호 디렉터리에서 누락되는 ugrep 함정이라 Python으로 재확인).
- **번들 `backend/app/manual.md` 스테일 교정(AI 사용법 근거 — 적극적 오답 제거)**: 게시 시 직전 게시본은 "Approved로 강등"이 아니라 **Expired(만료·최종)** + 순차 버전번호 채번(`versions.py:641–659`); 폐기된 인라인 드릴다운 서술 삭제→하위프로세스 참조/딥뷰(⑦)로 교정; 드롭존 "하위"→swap; 강제 점유는 **sysadmin 전용**·체크아웃 요청/이전 추가(`versions.py:289`); 회수 규칙(Pending/Approved=제출자만, Rejected=+오너/sysadmin, 회수자 체크아웃 재부여, `versions.py:744–763`); 맵 생성 필수(오우닝 부서·결재자·공개범위); 코멘트 진입은 더블클릭이 아니라 컨텍스트 메뉴.
- **오우닝 부서(Owning department) 문서화(한/영)**: general 역할 표·§2 맵 만들기 필수 단계·§5 설정 탭 3곳 추가 — 부서원 자동 Editor 권한(`maps.py:253`, 생성 다이얼로그 필수).
- **회수 규칙 통일 교정(한/영)**: general §3.5·admin §10을 실제 게이트(제출자/오너/sysadmin 구분)로 정정.
- **관리자 임직원 임포트 3종(한/영)**: admin §7에 한글 이름 임포트(스키마·충돌 skip/overwrite)·부서 정보 임포트·부서 재지정 추가(기존엔 AD 동기화만).
- **editing(한/영)**: §2 swap 드롭존, §11 `Alt+←`/`Alt+→`(사이드바/인스펙터 토글, `editor-left-sidebar.tsx:269`) 추가.
- 범위 조정: 미니맵·메뉴키 액셀러레이터·노드 표시필드 토글·한/영 UI 토글·버전 이름변경/삭제·AI env 변수는 이번 "핵심만" 범위에서 제외(백로그).

## 2026-07-13 — 매뉴얼·README 최신화 + 사용자 매뉴얼 편집/그외 분할 + 릴리스 노트 (main)
- 지난 1주 신규 기능(회당 파라미터 6필드·CSV/AI 가져오기·CSV로 새 맵·PNG/Excel/CSV/Word 내보내기·운영 대시보드 확장·자동 로그인/딥링크·노드 URL 링크)이 매뉴얼(2026-07-09판)에 빠져 있어 전면 갱신.
- **사용자 매뉴얼을 편집/그외 2문서로 분할** — 기존 `docs/manual/user-manual-{ko,en}.md`(단일 15장, 코드 미참조 소스 문서) 삭제하고 `user-manual-editing-{ko,en}.md`(에디터·노드·회당 파라미터·그룹·하위프로세스·저장/검증·가져오기·내보내기·AI·단축키)와 `user-manual-general-{ko,en}.md`(로그인·홈·버전/승인·비교·설정·공지/알림·유저그룹·FAQ)로 재구성. 뷰어(F10)는 한/영 페어를 같은 순번으로 매칭하므로 editing=0·general=1 순으로 업로드 전제.
- 회당 파라미터는 UI 실 라벨(회당 소요시간(h)/추가비용(원·$)/투입인원/연간 건수/FTE, EN "Duration / run (h)" 등)·소요시간 시.분 표기(0.30=30분→`1h30m`)·비용 통화 배타·SP 상속 4필드·Σ 합산(비용 합/인원 평균)을 `lib/params.ts`·`lib/duration.ts` 실동작 기준으로 기술.
- `admin-manual-{ko,en}.md` §8을 "데이터베이스 뷰어와 운영 대시보드"로 확장 — 대시보드 5섹션+기간 필터+열람 권한 위임(Access 사이드바) 반영, 콘솔 지도 Dashboard 행·상단 크로스레퍼런스·갱신일 갱신.
- `backend/app/manual.md`(AI 사용법 근거 겸 번들 fallback)에 노드 속성·회당 파라미터·가져오기·내보내기 항목 추가. `README.md` 기능 목록에 파라미터·가져오기/내보내기 추가.
- 사용자용 릴리스 노트 `docs/notices/2026-07-13-release.md` 신설(기존 2026-07-06-release.md 형식).

## 2026-07-13 — 런칭 사실 문서 반영 (main)
- 서비스가 이미 런칭돼 운영 데이터가 있음(서버는 `0a9d19d`, 7/10 기준)이 확인돼 `docs/db-seed.md`·`README.md`·`CLAUDE.md`·회당 파라미터 설계문서에서 "미런칭이라 리셋 자유"·"DB 재생성 필수" 전제를 제거하고 **운영 서버 `reset_db`(drop_all) 금지**를 명시. 서버 스키마는 배포만으로 자동 보강(`db.py _add_missing_columns`; 신규 컬럼은 `_ADDED_COLUMNS` 수동 등록 필수)이고, 폐기된 구 파라미터 컬럼(`etf`/`cost`/`extra`·`sp_*`)은 7/11 도입분이라 운영 DB에 존재하지 않아 드롭·NOT NULL 충돌 위험 없음. 형식 검증 이전의 자유텍스트 `duration`은 이관 없이 폐기 결정.

## 2026-07-13 — 최종 whole-branch 리뷰 픽스: 통화 편도 pick·링크 없는 AI subprocess·Σ designated 게이트 (worktree-node-params)
- **[Critical]** `mergeNode`(csv-import.ts)·`resolveAiParamPatch`(params.ts)가 통화 배타를 candidate 자기 안에서만 체크해, 한쪽 통화만 채운 CSV 행/AI patch가 반대쪽 "기존" 통화값을 못 지워 두 통화가 동시에 저장되는 결함(422 루프·`isCostFieldDisabled`가 양쪽을 동시 잠가 탈출구 없음) 수정. `resolveCostFields`(mergeNode용, next/existing 병합)·`clearCounterpartCurrency`(resolveAiParamPatch용, patch에 반대쪽 `""` 추가) 신설, `isCostFieldDisabled`는 둘 다 값이 있으면 잠그지 않도록 탈출구 추가.
- **[Minor]** `AiNode.node_type`이 자유 문자열이라 AI가 링크 없는 `"subprocess"` 노드를 신규 생성할 수 있던 결함 — `coerceAiNewNodeType`(params.ts) 신설, `aiNodeToGraphNode`(page.tsx)·`buildGraphFromAiProposal`의 신규 노드 후보 생성 지점 2곳에서 링크 없는 subprocess를 process로 강등.
- **[Minor]** `param-sum.ts`의 `collectValues`가 `subprocess_refs`를 `designated` 게이트 없이 읽어, 지정 해제(`undesignate_subprocess`는 `sp_designated_at`만 null화하고 행 값은 남김) 후에도 Σ가 남은 값을 합산하던 불일치 — 인스펙터와 동일한 `getInheritedParams`로 소스 통일.
- **[Minor, comment only]** `AiNodeAttributes`(schemas.py) 독스트링이 "NodeIn과 동일 제약"이라 오해를 유발 — 실제로는 숫자 정규화기가 없고 duration·통화 배타만 검증함을 명시, 최종 정규화는 PUT /graph의 NodeIn에서 일어남을 기록. `csv-export.ts`에 서브프로세스 자기값 vs excel-export.ts 상속값 의도적 차이를 설명하는 주석 추가.
- TDD로 진행(신규 테스트 15종 먼저 추가 → 소스 stash로 red 확인 → 소스 복원 후 green). 게이트 전부 그린: pytest 607, vitest 413(395→413, 신규 18), ruff/tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T11: 시드·문서 갱신 + 전체 게이트 (worktree-node-params)
- `seed_org_demo.py` 데모값을 신규 6필드 모델에 맞게 갱신 — SP 지정 시드(`DESIGNATED_SPECS`)의 옛 자유텍스트 duration("3 days" 등)이 `normalize_duration` 무효 판정으로 응답 경계에서 조용히 소거되던 걸 발견해 H.MM 유효값(72/24/48/4)으로 교체하고 `sp_cost_krw`/`sp_headcount`도 채움, Vendor Management 맵(idx 11) 노드는 `cost_usd`만 채워 통화 배타를 실측 시연. `docs/db-seed.md`에 컬럼 개명(구 `etf`/`cost`/`extra`, SP `sp_etf`/`sp_cost`/`sp_extra` 폐기)으로 인한 DB 재생성 필수 경고 추가, `CLAUDE.md` 노드 속성 체크리스트·숫자 파라미터 계약 문단을 신규 6필드 + 비용 배타(422) + SP 편집 제한(3표면 강제) 기준으로 갱신. 전 레포 구 명칭 스윕 — 실사용 코드/문서 잔재 0건(테스트·주석의 매치는 전부 의도된 회귀 pin/폐기 서술). 게이트 전부 그린: pytest 607, vitest 395, ruff/tsc/lint/build clean, reset_db 무오류.

## 2026-07-13 — 리뷰 픽스: resolveAiParamPatch 무효 에코가 기존값을 지우던 결함 (worktree-node-params)
- `resolveAiParamPatch`(`lib/params.ts`)가 무효 에코(예: duration "2일", cost_krw "abc")를 `""`로 정규화해 patch에 그대로 담던 결함 수정 — page.tsx ops `set_attr`가 patch를 `node.data`에 직접 스프레드하므로 기존 값이 조용히 지워졌다(graph-merge 경로는 `mergeNode`의 `pick`이 `""`를 "건드리지 않음"으로 해석해 이미 안전했음). 정규화 실패 시 이제 키 자체를 결과에서 생략(명시적 `""` 에코는 여전히 "지움"으로 patch에 남음). 같은 원리로 `dropConflictingCurrency`도 통화 배타 위반 시 `cost_krw`/`cost_usd`를 `""`로 채우는 대신 키를 생략하도록 변경(csv-import.ts 호출부는 `?? ""`로 받아 동작 불변, resolveAiParamPatch 호출부는 이제 두 키가 patch에서 빠져 기존 값을 보존). `params.test.ts`에 무효 에코/명시적 빈값/통화충돌/콤마 에코/SP 게이트 6종 신규 pin, `csv-import.test.ts`에 병합 경로가 같은 위반 케이스에서 기존값을 지키는지 확인하는 pin 3종 추가(두 AI 경로 드리프트 방지). 395 tests green(389→395), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T10: AI 변환단 SP 제한·비용 배타 강제 (worktree-node-params)
- 프론트 `AiNodeAttributes`(api.ts)에 백엔드 T2가 이미 노출한 `cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte` 5필드를 추가(그동안 프론트 AI 타입엔 없었음). `lib/params.ts`에 순수 헬퍼 2종 신설 — `dropConflictingCurrency`(원·달러 동시 지정 시 둘 다 드롭)와 `resolveAiParamPatch`(page.tsx ops set_attr 전용, 정규화→통화배타→`dropUneditableParams` 순으로 적용해 SP 노드에서 통화 위반이 SP 드롭 경고에 겹치지 않게 함). `csv-import.ts`의 `buildGraphFromAiProposal`(graph 병합)이 두 헬퍼 + 기존 `mergeNode`/`dropUneditableParams`를 재사용해 SP 4필드 드롭·통화 배타를 CSV와 동일한 문구로 warnings에 싣는다. `page.tsx`의 `aiNodeToGraphNode`(ops add, 신규 노드라 SP 게이트는 미적용·통화 배타만)와 ops `set_attr` 블록(기존 노드, `resolveAiParamPatch` 호출 — SP/통화 위반은 색과 같은 방식으로 조용히 드롭, 이 경로엔 프리뷰 경고 채널이 없음)도 동일 규칙으로 맞춰 두 AI 경로의 비대칭을 없앴다. 377→389 tests green(신규 12), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T9: Excel 내보내기 컬럼·서식 (worktree-node-params)
- `excel-export.ts` 컬럼을 `No,Name,Type,Description,Assignee,Department,System,Duration (h),Cost (KRW),Cost (USD),Headcount,Annual volume,FTE,URL,Groups,Next` 16컬럼으로 개편, numFmt 6종(`0.00`/`#,##0`/`#,##0.00`)을 `COLUMNS` 정의에서 파생시켜(`"numFmt" in c` 순회) 셀 인덱스 하드코딩을 없앰(컬럼 재배열 시 인덱스 어긋남 방지). 서브프로세스 행의 duration/cost_krw/cost_usd/headcount는 노드 자신의 값이 아니라 링크 맵의 sp_* 라이브 참조(`graph.subprocess_refs`, `getInheritedParams` 재사용 — 캔버스 인스펙터·Σ 합산과 동일 소스)에서 가져오도록 수정, annual_count·fte는 노드 행 그대로. 시트 기록 로직을 `writeExcelSheet(workbook, model)`로 분리해 Blob/anchor(DOM) 없이도 vitest로 numFmt·빈 셀 유지를 검증(exceljs는 여전히 `downloadExcel`에서만 dynamic import — 번들 분리 유지). 377 tests green(신규 7), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T8: CSV 임포트/익스포트 14컬럼 (worktree-node-params)
- CSV 헤더를 `Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next` 14컬럼으로 개편(`csv-import.ts`/`csv-export.ts` 대칭). 숫자 셀은 `stripThousands`로 천단위 콤마를 허용, 원·달러 동시 기재 행은 `Row N: fill only one of Cost_KRW / Cost_USD` 에러로 저장 전 차단(백엔드 422 사전 방지). 리뷰 지적 수정: `mergeNode`가 서브프로세스 매칭 행에 duration/cost_krw/cost_usd/headcount(링크 맵 지정값)를 그대로 덮어쓰던 결함 — `lib/params.ts`에 공유 순수 헬퍼 `dropUneditableParams(nodeType, candidate)` 신설(subprocess는 annual_count·fte만 통과), CSV 경로는 드롭 발생 시 기존 warnings 채널로 안내. Task 10(AI 변환단)이 같은 헬퍼를 재사용할 수 있게 시그니처를 공용으로 유지. `buildAiPromptText`의 개명 이전 잔재 컬럼 설명(ETF/Cost/Extra)도 정리. `docs/samples/*.csv` 3종을 새 컬럼으로 재작성(자유텍스트 duration→H.MM 숫자, 파일당 1행 Cost_USD 배타 예시) — 재작성 전 3종 전부 duration 형식 불일치로 임포트 100% 실패였던 선재 결함도 함께 해소. 370 tests green(신규 9), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T7: SP 노드 부분 편집(연간 건수·FTE) + 인스펙터/요약/비교 반영 (worktree-node-params)
- Parameters 섹션을 `hasBpmAttributes` 게이트에서 분리해 자체 카드/그룹으로 승격 — start/end 외 모든 타입이 `PARAM_FIELDS` 6행을 렌더한다. subprocess는 회당 4필드가 링크 맵 지정값(라이브 참조)이라 읽기전용 텍스트(`—` 폴백)로, 연간 건수·FTE만 `ParamInput`으로 편집·저장(같은 SP를 쓰는 두 맵이 서로 다른 연간 물량을 가질 수 있음, design 2026-07-13 §3.1). 표시형은 순수 함수 `lib/params.ts`의 `formatParamValue`(duration→1h30m, 비용→₩/$+천단위)로 단일화해 캔버스 칩(`process-node.tsx`)과 인스펙터·요약 모달이 같은 규칙을 쓰고, 상속값 추출은 `getInheritedParams(SubprocessRef)`로 분리(미지정→전부 빈 값). 인스펙터 SP 어트리뷰트 카드에서 파라미터 4행은 제거(중복 표시 방지). 비교 화면 `displayFieldValue`에 비용 천단위 콤마 추가. 361 tests green(신규 7), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T6: SP 지정 Σ 4버튼 + placeholder 미리보기 (worktree-node-params)
- SP 지정 모달에 Σ 버튼을 4행 전부(duration/cost_krw/cost_usd/headcount)로 확장(기존 headcount 제외 조건 삭제), 모달 오픈 시 게시본 그래프를 1회 로드해 4개 Σ 결과를 각 입력의 `placeholder`(회색 이탤릭, `placeholder:italic placeholder:text-ink-tertiary`)로 미리 노출 — 값이 이미 있으면 HTML 기본 동작으로 자동 숨김, 채우려면 Σ 클릭 필요. 비용 배타(`isCostFieldDisabled`)를 Σ 버튼에도 적용. placeholder 표시형 결정은 순수 함수 `lib/param-sum.ts`의 `formatSumPreview(field, raw)`로 분리해 vitest로 검증(jsdom 미설치라 DOM 마운트 테스트는 추가하지 않음 — CLAUDE.md 방침). 패널·인스펙터 카드의 SP 어트리뷰트 표시행도 비용 2필드를 캔버스 칩과 동일 서식(`₩`/`$` + `formatThousands`)으로 통일. 354 tests green(신규 4), tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T5: 천단위 콤마 + 비용 배타 + 칩 표시 (worktree-node-params)
- `lib/duration.ts`에 `formatThousands`/`stripThousands` 추가, `ParamInput`이 비용 2필드(cost_krw/cost_usd)에 포커스아웃 시 콤마 표시(포커스 중은 원문) 적용, `process-node.tsx` 칩은 `₩1,250,000`/`$1,200.50` 서식(cost_usd 아이콘도 Coins로 통일). 비용 배타(한쪽 값 있으면 반대쪽 disabled)는 `lib/params.ts`의 `isCostFieldDisabled` 헬퍼로 통일해 인스펙터(page.tsx)·노드 요약 모달·SP 지정 모달 3개 호출부에 적용. `@testing-library/react`·jsdom 미설치라 컴포넌트 테스트는 추가하지 않고 `duration.test.ts`/`params.test.ts`에 순수 로직 테스트로 대체(350 tests green), tsc/lint/build clean.

## 2026-07-13 — Σ 인원 평균 정수 도메인 (worktree-node-params)
- 인원 평균을 float 나눗셈에서 정수 스케일 도메인으로 이동 — 1.005×3이 1.00으로 깎이던 반올림 손실 차단(리뷰 Important).


프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.

## 2026-07-13 — 노드 파라미터 재정의 T4: Σ 합산 규칙 재작성 (node-params)
- `lib/param-sum.ts`의 `sumParamField`가 `SpParamField`(4종) 전체를 받도록 확장. `duration`/`cost_krw`/`cost_usd`는 기존대로 합(통화 2필드 독립), `headcount`는 값 있는 일반 노드의 평균(소수점 2자리, SP 노드는 분자·분모 모두 제외)으로 변경. 호출부(`subprocess-designation-modal.tsx`)는 `SummableField` 대신 `SpParamField`로 시그니처만 갱신(headcount Σ 버튼 추가는 Task 6). 339 tests green(신규 5), tsc/lint clean.

## 2026-07-13 — 노드 파라미터 재정의 T3: 프론트 개명 스윕 + 편집 가능 필드 정의 (node-params)
- 프론트 전 표면을 신규 키(`duration`/`cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte`)로 개명하고 `lib/params.ts`에 `PARAM_FIELDS`(표시 순서)·`SP_PARAM_FIELDS`(SP 지정 4종)·`getEditableParamFields(nodeType)`(start/end 없음, subprocess는 연간건수·FTE만) 도입. i18n은 `field.costKrw`/`costUsd`/`annualCount`/`fte` 신규 키(EN·KO), 구 `field.etf`/`cost`/`extra` 삭제. `NodeData`의 회당 파라미터 키는 `PARAM_FIELDS`로 일반 인덱싱하므로 snake 유지, SP 라이브 참조는 `spCostKrw`/`spCostUsd`. 동작 변경 없음(콤마 서식·통화 배타·Σ 규칙·CSV/Excel 스키마·AI 가드는 후속 태스크). 329→334 tests green, tsc/lint/build clean.

## 2026-07-13 — 노드 파라미터 재정의 T2: AI 계약 확장 (node-params)
- `AiNodeAttributes`에 `cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte` 추가(부분 갱신 시맨틱: None=유지) + 공용 `_assert_single_currency` 재사용한 통화 배타 검증. `ai_prompt.py` 3곳(그래프 스키마 예시·규칙 텍스트·`_serialize_node`) 동기화, subprocess 노드는 `annual_count`·`fte`만 수정 가능하다는 제한을 프롬프트에 명시. 603→607 tests green, ruff clean.

## 2026-07-13 — 노드 파라미터 재정의 T1: 백엔드 개명·비용 배타 (node-params)
- `duration`/`cost_krw`/`cost_usd`/`headcount`/`annual_count`/`fte`로 개명(구 `etf`/`cost`/`extra` 폐기, 이관 없음), SP 지정은 `sp_duration`/`sp_cost_krw`/`sp_cost_usd`/`sp_headcount` 3종만. cost_krw·cost_usd 동시 값은 model_validator에서 422(공용 `_assert_single_currency`). models/db/schemas/routers(graph·versions·maps)/subprocess.py 갱신, `get_subprocess_refs` select/unpack 동시 수정. 599→603 tests green, ruff clean.

## 2026-07-13 — 노드 파라미터 재정의 설계 (main)
- 회당 단가 모델로 의미 확정(회당 소요시간·회당 추가비용(원/달러 배타 2필드)·회당 투입인원·연간 건수·FTE), SP 지정은 3종만 + 인원 Σ는 평균(SP 제외)·Σ 미리보기 placeholder, CSV 14컬럼·Excel 서식·AI 계약(6필드 읽기/쓰기, SP는 연간건수·FTE만) 반영 — 스펙 `docs/superpowers/specs/2026-07-13-node-params-redefinition-design.md`. 운영 미배포라 DB 재생성 전제(기존 cost 값 폐기).

## 2026-07-13 — 노드 파라미터 재정의 구현 계획 (main)
- 11개 태스크 TDD 체크리스트 작성 — 백엔드 개명·비용 배타(T1), AI 계약(T2), 프론트 개명 스윕·편집 집합(T3), Σ 규칙(T4), 콤마 서식(T5), SP Σ placeholder(T6), 에디터 SP 부분편집(T7), CSV 14컬럼(T8), Excel 서식(T9), AI 변환단 강제(T10), 시드·문서·전체검증(T11). 계획 `docs/superpowers/plans/2026-07-13-node-params-redefinition.md`.

## 2026-07-12 — CLAUDE.md 세션 학습 반영 (main)
- 숫자 파라미터(duration H.MM) 계약 레슨 추가(이중 정규화 동기화·경계 소거 증발·표시형·raw dict 우회), backend pytest .env 함정 커맨드(bash/PS 병기), frontend AGENTS.md에 ParamInput 필수·내보내기 라이브러리 dynamic import 규칙.

## 2026-07-12 — 운영 대시보드 마무리 (dashboard-design)
- 설정 카테고리 순서 조정 — Analytics를 승인큐·그룹 뒤로. 대시보드 권한만 받은 비-sysadmin이 설정을 열 때 첫 탭(=풀블리드 대시보드)에 강제 착지하던 문제 해소(대시보드는 탭을 눌러 진입). sysadmin은 영향 없음.

## 2026-07-11 — 운영 대시보드 설계 (dashboard-design)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-dashboard.md` (10태스크: 모델·판정 → 열람 게이트·MeOut → 설정 API → /summary → /timeseries → 프론트 순수함수·바인딩·i18n → 차트 5종 → 풀블리드 패널·탭 게이팅 → 우측 사이드바 2탭 → 브라우저 검증). 실행 순서는 T9를 T8보다 먼저(사이드바 선행이라야 패널 빌드가 한 번에 통과).
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-dashboard-design.md`. 스텁(진입 카드+로그인 3지표)을 리더 보고용 실운영 대시보드로 재작성: 신규 테이블 2개(`dashboard_permissions` 인원·부서·그룹 열람 권한 / `dashboard_coverage_depts` 커버리지 분모 부서), summary(스냅샷)·timeseries(기간 필터 전용) API 분리, 풀블리드 3열(좌 요약 레일 · 중앙 지표 그리드 · 우 인스펙터형 Access/Coverage 사이드바), 차트는 의존성 없이 자체 SVG/CSS.
- T1 모델·권한 판정 — `dashboard_permissions`·`dashboard_coverage_depts` 테이블 + `logic.can_view_dashboard()` 순수 함수(sysadmin·user·department 하위·group 멤버십·기본거부 5케이스 테스트, TDD RED→GREEN).
- T2 열람 게이트 — `require_dashboard_viewer`(sysadmin 또는 권한 행) 도입, 라우터 게이트를 엔드포인트별로 분리(ai-usage는 sysadmin 유지), `/api/me`에 `can_view_dashboard` 노출.
- T3 설정 API — 대시보드 권한 행 CRUD(중복 409·삭제 204)와 커버리지 분모 부서 GET/PUT(통째 교체·멱등). 열람은 뷰어, 변경은 sysadmin.
- T4 `/summary` 스냅샷 — 맵 현황·버전 상태 분포·부서 커버리지(하위 부서 맵을 상위 지정 부서에 귀속)·운영 항목(코멘트/알림/점유요청)·최근 버전 이벤트 10건. 지정 부서 0개면 0% (0 나눗셈 차단).
- T5 `/timeseries` — 일별 로그인·맵 생성·버전 생성(KST 버킷, 빈 날 0 채움). from>to·366일 초과는 422. 프리셋 환산은 프론트 책임.
- T6 프론트 기반 — `lib/dashboard-chart.ts` 순수 함수(nice 스케일·프리셋→KST 날짜범위·todayKeyKst, vitest 7케이스), api.ts 대시보드 바인딩 7종, `CurrentUser.canViewDashboard`(providers.tsx + settings dev-switch 양쪽 발행부 갱신), i18n 키 en/ko 39종. 기존 `dashboard.openCard` 등 4개 진입카드 키는 `dashboard-panel.tsx`가 아직 참조 중이라 삭제 보류(Task 8에서 참조 제거 확인 후 삭제).
- T7 차트 컴포넌트 — StatCard·BarChart(값 비례 막대, 최댓값 액센트)·LineChart(자체 SVG viewBox)·HBarList(버전상태·커버리지 공용)·PeriodFilter(프리셋 3종+달력). 라이브러리 무추가, 색은 전부 토큰.
- T9 우측 사이드바 — Access(인원·부서·그룹 피커로 권한 부여/제거)·Coverage(분모 부서 선택, 항상 전체 목록 PUT=멱등) 2탭. sysadmin에게만 렌더.
- T8 대시보드 패널 재작성 — 진입 카드 제거(탭 클릭이 곧 대시보드), 설정 탭 레일을 풀블리드 3열로 교체. 좌 요약 레일·중앙 지표 그리드(활동·성장·버전상태·커버리지·최근 이벤트)·AI 사용량은 sysadmin 한정. 설정 탭 게이팅에 `dashboard` Access 추가. `getDashboard()`/`DashboardMetrics`(구 바인딩)와 진입카드 잔재 i18n 키 9종 삭제. tsc·lint·build·vitest(297) 전부 통과.
- T10 브라우저 검증 — `frontend/scripts/pw-verify-dashboard.mjs` 6항목(풀블리드 교체·스탯 렌더·막대 수=기간·기간 변경 시 스냅샷 불변·커버리지 부서 추가 반영·비-sysadmin 권한 열람 게이팅) 6/6 PASS. 초안 대비 2건 수정: ① Coverage 부서 추가는 `SearchSelect` 메뉴가 `document.body` 포털(fixed)이라 사이드바 스코프가 아니라 페이지 스코프로 찾아야 함, ② check6은 "Dashboard 탭 버튼 노출"이 아니라 대시보드 루트(`data-id="dashboard"`) 노출로 판정 — dashboard 권한만 있는 비-sysadmin은 그 카테고리가 `allTabs[0]`이 되어 클릭 없이 즉시 풀블리드로 전환되므로 탭 버튼 자체가 생기지 않는다. 실측 발견 1건(테스트 픽스, 프로덕션 무변경): summary/timeseries 응답 도착과 React 커밋 사이 한 틱 지연 — 좌 레일을 곧장 읽으면 "—" 자리표시를 오탐, 300ms 안정화 대기로 해결. 전 게이트 그린: pytest 595·ruff 0·vitest 297·tsc 0·lint 0(신규)·build 0.
- 최종 리뷰 픽스(머지 전) — 11건: 커버리지 저장 시 중앙 카드 미갱신(`summaryNonce` 트리거, range는 여전히 deps 밖)·커스텀 기간 빈값/366일 초과 방지·라우터 default-deny 게이트 복원(`require_dashboard_viewer`)·죽은 `ChartScale.ticks` 제거·단일포인트 라인차트 원 중앙 정렬·이벤트 리스트 key에 event_type 추가·Access 피커 중복 후보 제외·`maps_created` deleted_at 비대칭 주석화·`CoverageDeptsIn.org_paths` 200자 제한·테스트명 `test_dashboard_requires_dashboard_viewer` 개명·`todayKeyKst`→`getTodayKeyKst`. 전 게이트 그린: pytest 595·ruff 0·vitest 297·tsc 0·lint 0(신규)·build 0. 상세: `.superpowers/sdd/final-review-fixes.md`.

## 2026-07-11 — CLAUDE.md 노드 속성 체크리스트 (main)
- Lessons에 노드 속성 추가 시 열거 지점 7곳 + CSV·AI 정규화 대칭 규칙 추가 — duration 정규화 갭(230a9e8) 재발 방지.

## 2026-07-12 — 최종 리뷰 픽스: 그룹 일괄편집 duration 모드 계약 정합 (sp-params-sum)
- `group-bulk-modal.tsx` duration 모드가 브랜치 계약(숫자 입력 강제+1h30m 표시)에서 누락 — 값 입력을 `ParamInput`(field="duration", ariaLabel, 신규 `placeholder` prop)으로 교체(자유텍스트가 applyGroupAttribute 경유로 들어갔다 백엔드 소거로 조용히 소실되던 갭 봉합, system 모드는 자유텍스트 유지), 충돌 팝오버·개별 마법사 existing/value·적용 요약 before/after의 duration 표시에 `displayAttrValue` 헬퍼(1h30m, 무효 시 원문 폴백 — compare 패턴) 적용. 게이트: vitest 304/304·tsc 0에러·lint 기존 경고 1건·build 0에러.

## 2026-07-12 — worktree-sp-params-sum 병합 (worktree-word-export)
- 머지 전 최신화: `worktree-sp-params-sum`(최신 main 기반, 41커밋 — SP 파라미터·Excel/CSV 내보내기·AI 사용량 계측 포함)을 Word 내보내기 브랜치에 병합(통합 테스트용). 충돌 5파일 해결 — 인스펙터 내보내기 영역은 PNG/Excel/CSV 3버튼 행 + 하단 Word 버튼으로 통합, i18n·package.json 합집합, lockfile 재생성. main 잔여 문서 커밋(b502df0)도 후속 머지.
- 병합 검증: vitest 322/322(word-export 18 포함)·tsc 0·lint 0에러(기존 경고 1)·build 성공·pytest 572. e2e — pw-verify-word-export 11/11(PNG 버튼 체크를 옛 라벨 "Download PNG" → `data-id="export-png"`로 보정, 병합으로 3버튼 행 라벨이 "PNG"로 바뀜)·pw-verify-sp-params 24/24, 콘솔 에러 0.

## 2026-07-12 — Task 6: SP 파라미터 브라우저 실기동 검증 + 배포 노트 (sp-params-sum)
- `pw-verify-sp-params.mjs` 신설 — 스크래치 맵 A(게시 체인 submit→approve→publish API 미러)에서 지정 모달 5입력+Σ 4개(headcount 제외) 확인, Σ(duration) 0.45+0.30=1.15(1h15m)·Σ(cost) 0.1+0.2=0.3·저장 200·영속 확인. 맵 B(미게시)는 Designate 진입 버튼 자체가 disabled(hasPublished 게이트)라 정상 UI로는 모달을 열 수 없음을 실측 — React `SimpleEventPlugin`이 DOM `disabled` 속성이 아니라 파이버 `props.disabled`를 보고 클릭을 억제하므로 속성만 지우는 우회는 무효였고, `__reactProps$*` 파이버 키로 실제 `onClick`(openModal) 핸들러를 직접 호출해 모달을 강제로 띄운 뒤 Σ 버튼 4개 전부 disabled임을 확인(진입 게이트와 Σ 내부 게이트가 동일 전제라 이 상태는 정상 내비게이션으로는 도달 불가 — 강제오픈 프로브로만 검증 가능). 맵 C에 맵 A를 subprocess로 링크해 노드 칩 `1h15m`+`0.3` 라이브 반영 확인. 에디터 인스펙터 Parameters 그룹 기본 접힘(`aria-expanded=false`)→펼침→duration `1.30`입력·blur `1h30m`·포커스 `1.30`복원·새로고침 후 펼침 유지(localStorage) 확인. 24/24 PASS, 콘솔 에러 0.
- 게이트 재확인: backend pytest 572 passed·ruff clean. frontend vitest 22 files/304 tests passed·tsc --noEmit 0에러·lint 0에러(기존 미관련 경고 1건만)·build 성공.
- **배포 노트**: sp 4컬럼(`sp_headcount`/`sp_etf`/`sp_cost`/`sp_extra`, Task 2)은 `create_all`이 기동 시 자동 보강하므로 프론트/백은 **반드시 동시 배포**(구버전 프론트가 신버전 백엔드에 4필드 없는 payload를 보내는 조합, 또는 그 역은 지정 모달 저장이 깨짐). 레거시 sp 자유텍스트(구 `sp_duration` 자유입력 값)는 API 응답 3표면(`MapOut`·`SubprocessRefOut`·라이브러리 목록, Task 2)에서 이미 정규식 미매치 시 `null`로 소거되므로 기능상 즉시 문제는 없으나, DB에 남은 원본 값은 그대로다. 원하면 배포 후 1회 물리 정리:
  `UPDATE process_maps SET sp_duration = NULL WHERE sp_duration IS NOT NULL AND sp_duration !~ '^[0-9]+(\.[0-9]{1,2})?$';`
- **dev.db 상태**: 로컬 검증에서 생성한 스크래치 맵(SP-Params A/B/C, 6회 실행분)은 전부 스크립트 종료 시 소프트삭제(`deleted_at` 설정) 완료 — 활성 맵 수는 시드 그대로 12개 유지, 휴지통에만 잔존(다른 pw-verify-*.mjs와 동일 패턴, 완전 복원은 `git checkout backend/dev.db` + 백엔드 재시작).

## 2026-07-11 — Word 도형 순서도 내보내기 설계 (worktree-word-export)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-word-export-design.md`. SOP에 하이퍼링크 살아있는 순서도를 붙여넣기 위한 `.docx` 생성(Word 순정 플로차트 도형 + 라벨/URL라벨 하이퍼링크 + 전체 그룹화). SmartArt(링크 불가)·HTML 복붙(도형 유실) 검토 후 제외. OOXML 직접 생성 + `fflate` 단일 의존성, 진입점은 인스펙터 맵 탭(PNG 무변경). 흑백톤 + Arial/바탕체 11pt.
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-word-export.md` (4태스크: 순수 빌더+노드 도형 → 연결선/엣지 라벨 → 진입점 통합 → 브라우저 검증. 접점 idx·inline 그룹 호환은 T4 실측 보정 항목).
- T1: word-export.ts 순수 빌더 — docx 4파트 조립 + 노드 도형(프리셋 매핑·흑백·Arial/바탕체 11pt·하이퍼링크 rels) + fflate 도입, vitest 10건.
- T2: 연결선 bentConnector3 + stCxn/endCxn 접점(도형 이동 시 추종) + 분기 라벨 텍스트박스 + 역방향 flip, vitest 4건 추가.
- T3: exportCanvasWord 다운로드 트리거 + i18n 2쌍(en/ko) + 인스펙터 맵 탭 하단 Word 버튼(data-id=inspector-export-word, PNG 무변경).
- T4: `frontend/scripts/pw-verify-word-export.mjs` — 버튼/다운로드/unzip 4파트/도형·연결선 수/하이퍼링크/흑백·폰트/콘솔 11항목, 로컬 실행 **11/11 PASS**(2회 재현, 콘솔에러 0). 브리프 원안 조정: 데모 시드(`reset_db`)는 모든 draft가 타인(데모 유저) 체크아웃 상태라 원안처럼 기본 로드 버전에 바로 URL 노드를 PUT하면 항상 409 — sysadmin(admin.sys)으로 draft를 force 체크아웃 인수해 검증하고, 종료 시 그래프 원복 PUT(200) + 체크아웃을 원 점유자(taeyang.oh)에게 이전(transfer, 200)해 dev.db를 원상복구(draft가 없는 맵이면 ④는 SKIP 로그). ⚠️ Word 실물 열기·복붙·링크 클릭·접점(`SIDE_TO_CXN_IDX`) 위치는 Windows 수동 검증 대기.
- 최종 리뷰 픽스: rels Target URL 정규화(new URL, 실패 시 링크 생략)·buildDocx 빈 배열 throw·엣지 라벨 bounds 클램프·스펙 함수명 정합.

## 2026-07-11 — Task 5: SP 표시 전면 — 칩 5종·1h30m 적용·읽기 표면 (sp-params-sum)
- `NodeData`(canvas.ts)에 spHeadcount/spEtf/spCost/spExtra 추가 + page.tsx subprocess_refs→data 매핑 확장. `NodeParams`(process-node.tsx)의 subprocess 분기를 sp 5종으로 확장, duration 칩만 `formatDurationHm` 적용(filled 판정도 포맷 결과 기준 — 레거시 방어). 읽기 표면 3곳(subprocess-inspector-card·subprocess-designation-panel·page.tsx `inspector-subprocess-attrs`)에 파라미터 4행 추가 + duration 포맷. compare/page.tsx에 공용 `displayFieldValue` 헬퍼 신설, 3곳(fieldsOf·목록·사이드패널)의 duration before/after/current를 포맷.
- 게이트: vitest 304/304·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트)·build 0에러.

## 2026-07-11 — Task 4: SP 지정 모달 숫자 5종 입력 + Σ 합산 버튼 (sp-params-sum)
- `subprocess-designation-modal.tsx`의 duration 자유텍스트 입력을 `PARAM_FIELDS` 5종 블록(`ParamInput`, ariaLabel 포함 — Task 3 확정 계약)으로 교체, duration/etf/cost/extra 4필드에 Σ 버튼(게시본 그래프 `useRef` 1회 fetch 캐시·`sumParamField`로 setForm만 갱신·저장은 기존 Save 경유) 추가. headcount는 Σ 미지원. `DesignationForm`에 4필드 추가 + 호출측 2파일(`subprocess-inspector-card.tsx`·`subprocess-designation-panel.tsx`)의 initial 조립에 `sp_headcount` 등 4필드 미러(tsc 강제). i18n `sp.sumAllNodes`/`sp.sumNeedsPublished` en/ko.
- 게이트: vitest 304/304·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트)·build 0에러.

## 2026-07-11 — Task 3 리뷰 픽스: ParamInput ariaLabel 복원 (sp-params-sum)
- 리팩터에서 탈락했던 요약모달 param 입력의 `aria-label` 회귀 픽스(라벨 span은 input과 미연결 — 스크린리더 접근명 공백). ParamInput에 옵셔널 `ariaLabel` prop 추가(브리프 인터페이스 결함 보강), 인스펙터·요약모달 양쪽에 `t(PARAM_LABEL_KEY[key])` 전달(인스펙터는 원래 없던 것을 이번에 추가). tsc 0에러·lint 0에러·vitest 304 passed.

## 2026-07-11 — Task 3: 공용 ParamInput + 인스펙터/요약모달 리팩터 + Parameters 접기 (sp-params-sum)
- 신규 `components/param-input.tsx`(단일 input focus/blur 표시 스왑 — duration만 비포커스 시 `formatDurationHm`, 나머지 4필드는 항상 raw) + `lib/params.ts`에 `readParamsCollapsed`/`writeParamsCollapsed`(localStorage `bpm.paramsCollapsed`, 저장값 없으면 기본 접힘). 인스펙터(page.tsx)·노드 요약 모달의 Parameters 인라인 타이핑필터/blur정규화 중복 구현을 ParamInput으로 대체, 접기 헤더(들여쓰기 `ml-2 border-l pl-2`+채워진 개수 `(n)`)를 두 지점에 동일 패턴으로 추가(같은 localStorage 키 공유 — 인스펙터/요약모달 토글 상태 연동).
- 게이트: vitest 304 passed·tsc --noEmit 0에러·lint 0에러(기존 미관련 경고 1건)·build 0에러.

## 2026-07-11 — Task 2 리뷰 픽스: 라이브러리 목록 레거시 sp_duration 소거 (sp-params-sum)
- `routers/library.py` `list_processes`가 raw dict 직렬화로 MapOut/SubprocessRefOut validator를 우회 — 레거시 자유텍스트("3일")가 라이브러리 API로 누출되던 잔여 경로 봉합(조립부에서 `normalize_duration` 소거, 무효→None). `test_sp_params.py`에 라이브러리 목록 단언 1건 추가. pytest 572 passed(571+1)·ruff 0에러.
- 스펙 §2 보정 — 레거시 sp_duration 소거 경로에 library 목록(raw dict) 추가(Task 2 리뷰 발견 반영).

## 2026-07-11 — Task 2: 백엔드 sp 4컬럼 + 지정 경계 정규화 + 응답 레거시 소거 (sp-params-sum)
- `ProcessMap`에 sp_headcount/sp_etf/sp_cost/sp_extra 4컬럼(`db.py _ADDED_COLUMNS` 멱등 보강 포함) 추가. `SubprocessDesignationIn`이 duration 포함 5필드를 경계에서 정규화(무효→`""`, NodeIn과 동일 시맨틱) — `designate_subprocess`·`get_subprocess_refs`에 4필드 배선. 응답 경로 레거시 소거 신설 — `MapOut.sp_duration`·`SubprocessRefOut.duration`에 무효→None validator(레거시 자유텍스트 직삽입이 GET을 깨지 않게). TDD 3케이스(지정 시 숫자 정규화·무효값 소거·레거시 응답 소거를 MapOut+subprocess_refs 양쪽에서 실단언) 신규 `test_sp_params.py`. pytest 571 passed(568+3)·ruff 0에러.

## 2026-07-11 — Task 1: formatDurationHm + sumParamField 순수 유틸 (sp-params-sum)
- TDD 완료 — `lib/duration.ts`에 `formatDurationHm(raw: string): string` 추가(정규화 후 "1h30m" 표시형), `lib/param-sum.ts` 신규(sumParamField 게시본 직합·subprocess는 sp값·duration 분환산 캐리·부동소수 오차 차단). api.ts SubprocessRef/MapSummary/SubprocessDesignationBody에 headcount/etf/cost/extra 4필드 확장. vitest 304/304 (formatDurationHm 8케이스+param-sum 6케이스 포함)·tsc --noEmit 0에러·lint 경고 0건(기존 미관련).

## 2026-07-11 — SP 숫자 파라미터 + Σ 합산 + duration 표시형(1h30m) 설계 (main)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-sp-params-sum-duration-format.md` (6태스크: 포맷·합산 유틸 → 백엔드 sp 4컬럼+경계 소거 → 공용 ParamInput+접기 → 지정 모달 5입력+Σ → 표시 전면(칩 5종·1h30m) → 브라우저 검증).
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-sp-params-sum-duration-format-design.md`. SP 지정 속성을 숫자 5종으로 확장(sp 4컬럼 추가·레거시 자유텍스트 소거), 지정 모달에 Σ 합산 버튼(게시본 직합·sub는 subprocess_refs sp값·duration 분환산 캐리), duration 표시형 1h30m 통일(편집 중만 1.30, CSV/Excel 예외), 인스펙터 Parameters 그룹 들여쓰기+접기(기본 접힘·localStorage 퍼시스트).

## 2026-07-11 — AI duration 정규화 대칭 픽스 (main)
- AI 그래프 제안 경로(`buildGraphFromAiProposal`·`aiNodeToGraphNode`)의 duration을 CSV와 동일하게 `normalizeDuration`으로 정규화 — 무효 에코("3일")가 pick에 채택돼 백엔드 소거로 기존 유효값이 유실되던 갭 봉합(numeric-params 머지 교차점 리뷰에서 발견). vitest 290·tsc 0·lint 0.

## 2026-07-11 — AI 실모델 스모크 체크리스트 (main)
- `docs/ai-real-model-smoke.md` 신규 — 실모델 검증 절차(연결 확인→.env 기동(bash/PowerShell 병기)→S1~S8 시나리오→판정·후속 매핑). S1 제목 에코 매칭률이 핵심 변수, 로컬은 OpenAI 호환 키 대체 가능(Claude 네이티브는 어댑터 작업 필요).

## 2026-07-11 — Task 1: duration 정규화 유틸 (FE/BE 동치) (numeric-params-export)
- TDD 완료 — 프론트엔드 `lib/duration.ts`·`lib/duration.test.ts` + 백엔드 `app/duration.py`·`tests/test_duration.py` 신규. 브리프의 테스트 케이스 19개(FE) + 15개(BE) 전수 통과(`DURATION_PATTERN`/`NUMERIC_PATTERN` 정규식, H.MM 정규화·1자리 10분 단위·60분 이월·소수부 0 정수 변환). 타입/린트 검증: frontend npm run test 19/19·tsc--noEmit 0에러 / backend pytest 15/15·ruff 0에러.
- 스펙 §5 진입점 문구 보정 — 드롭다운→나란한 3버튼(구현 확정 반영). 디시전 칩 시각 재검증: 픽스(0a2bc5a) 후 pw 22/22 PASS + 와이드 스크린샷·elementFromPoint 실가시성 확인.

## 2026-07-11 — Task 2: 백엔드 숫자 파라미터 4컬럼 + NodeIn/AI 경계 정규화 (numeric-params-export)
- Node에 headcount/etf/cost/extra 4컬럼(`db.py _ADDED_COLUMNS` 멱등 보강 포함) 추가, `NodeIn`이 duration 포함 5필드를 경계에서 정규화 — 무효값은 422 대신 `""` 소거(`from_attributes=True` 응답 경로가 레거시 자유텍스트로 깨지지 않게). `AiNodeAttributes.duration`은 None(생략)을 그대로 보존(부분 갱신 시맨틱). 필드 열거 지점(`routers/graph.py` upsert, `routers/versions.py` clone_graph) 미러 완료, `sp_duration`(ProcessMap SP 속성)은 미변경. AI 프롬프트에 duration H.MM 규칙 한 줄 추가. 시드에 데모값 채움. 기존 `test_bpm_attributes_roundtrip`의 자유텍스트 duration 단언을 새 정규화 계약에 맞춰 갱신. pytest 556 passed·ruff 0에러. 리뷰 픽스: `seed_compare_demo.py`의 자유텍스트 duration("3일"/"1일")을 H.MM 숫자("3"/"1")로 교체 — 경계 소거로 duration diff 시연이 사라지는 문제.

## 2026-07-11 — Task 3: 프론트 입력·노드 칩·diff·AI apply (numeric-params-export)
- `lib/params.ts` 신설(PARAM_FIELDS 5종 메타) + GraphNode/NodeData에 headcount/etf/cost/extra 옵셔널 추가 + 데이터 왕복 4곳(로드 매핑·buildGraph·신규노드 기본값 3곳·AI apply duration 정규화 경유) 배선.
- 인스펙터·요약모달에 Parameters 입력 그룹(5필드, 타이핑은 숫자만 허용·blur에서 정규화) + 노드 카드에 파라미터 칩(아이콘+숫자만, subprocess는 spDuration만) — NodeDisplayField에서 duration 제거(구설정 잔재는 로드 시 필터).
- 버전 비교 diff 필드 4종 추가(ChangedField·FIELD_KEYS·compare FIELD_MSG) + compare buildAppNodes에도 4필드 매핑(노드 칩이 비교화면에도 온전히 뜨도록).
- 게이트: tsc 0에러·vitest 263 passed·lint(경고 1건, 기존 미관련 스크립트)·build 0에러.
- 리뷰 픽스: compare 사이드 Properties 패널의 하드코딩 필드 목록에 4파라미터(headcount/etf/cost/extra) 추가 — FIELD_MSG·온캔버스 diff 필은 신규 파라미터를 보여주는데 상세 패널만 누락됐던 비일관 해소.
- 브라우저 검증 픽스(Task 8 FAIL): 디시전 마름모 칩 overflow — 파라미터 칩을 타이틀 레이어(max-w-20)에서 빼 마름모 아래 절대배치 캡션(`top-full left-1/2 -translate-x-1/2 w-max max-w-40`, justify-center)으로 이동. 절대배치라 React Flow 측정 크기(h-24 w-24) 불변 → 핸들·엣지 앵커 무영향. NodeParams에 옵셔널 className만 추가, 타 셸 배치 무변경.

## 2026-07-11 — Task 4: CSV 임포트 숫자 파라미터 5컬럼 확장 (numeric-params-export)
- `lib/csv-import.ts`에 headcount/etf/cost/extra 4컬럼 추가(HEADER_COLUMNS·MAX_LEN·NODE_DEFAULTS·mergeNode pick·행 매핑), duration은 자유텍스트 대신 `normalizeDuration` H.MM 검증으로 전환, 5필드 모두 정규화된 값을 노드에 저장. `buildTemplateCsv`(13컬럼)·`buildAiPromptText`(Duration H.MM 규칙+4컬럼 규칙) 갱신.
- TDD: 브리프 신규 테스트 2건 RED(`Unknown column "Headcount"`) 확인 후 구현 → GREEN. duration이 자유텍스트("2 days" 등)였던 기존 테스트 4건을 숫자값으로 갱신(테스트 수는 순감소 없이 73→75).
- 게이트: csv-import 75/75·전체 vitest 265/265·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트).

## 2026-07-11 — Task 5: CSV 내보내기(왕복) (numeric-params-export)
- `lib/csv-export.ts`(`buildCsvFromGraph`·`orderNodesByFlow`) 신규 — csv-import 13컬럼 포맷 미러, 표현 불가 구조(추가 end·라벨있는 End행 엣지·제목 중복·outgoing<2 decision·start 연결 상이)는 warnings로 명시. 브리프 코드에서 `orderNodesByFlow`의 outgoing Map 초기화를 `Map.set().get()` 체이닝 트릭에서 통상적인 get-or-set 패턴으로 단순화(동작 동일, 가독성만 개선).
- TDD: `csv-export.test.ts` 11케이스(왕복 불변·분기라벨 보존·이스케이프 원문보존·추가 end 경고·라벨 End행 경고·제목중복 경고·start 불일치 경고·숫자파라미터 undefined 안전 직렬화·orderNodesByFlow 3종[정상/무-start/사이클]) 모듈 부재로 RED 확인 후 구현 → 1회 실행에 11/11 GREEN.
- 게이트: csv-export 11/11·전체 vitest 276/276·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트, 무변화).
- 리뷰 픽스: 테스트 공백 1건 보강 — 무라벨 End행 엣지가 다른 outgoing과 병존(`outs.length > 1`)하는 분기 케이스 추가(경고 발화 + Next 셀 드랍 단언), csv-export 12/12.
- 최종 리뷰 픽스 3건: ① Next 대상 제목의 `;`/`:`·엣지 라벨의 `;`는 재임포트 오파싱 경고 추가(그대로 내보내되 warning, 테스트 +1 → csv-export 13/13) ② 에디터 handleExportCsv의 BOM 보이지 않는 리터럴 → 유니코드 이스케이프 표기(포매터 증발 방지) ③ 백엔드 test_ai 픽스처 duration "1일"→"1"(validator 소거로 죽은 값 복원).

## 2026-07-11 — Task 6: Excel 모델 빌더(재귀·순환·상한·locked) (numeric-params-export)
- `lib/excel-export.ts`(`buildExcelModel`) 신규 — 서브프로세스 노드 바로 아래에 링크 맵 전체를 depth+1로 재귀 인라인, 조상 맵 경로(ancestry Set)로 순환 차단(circular 1행), fetch 실패/locked는 denied 1행, 행 상한(`EXCEL_MAX_ROWS`=2000, 옵션 `maxRows`) 초과 시 rowLimit 1행 후 전 재귀 레벨 즉시 중단, 같은 (mapId,followLatest,pinned)는 fetch 1회 메모이즈. 브리프 Step 3 코드를 그대로 구현(변경 없음).
- 자체 결정 규칙: ①rowLimit 행 자체는 상한을 넘겨서라도 push되어 최종 rows.length가 maxRows보다 1 클 수 있음(브리프 코드 그대로, 테스트로 박제). ②truncated는 클로저 공유 플래그라 상한 도달 즉시 모든 재귀 레벨의 다음 for-반복에서 무조건 return — rowLimit 행은 정확히 1개만 생성됨. ③인터페이스에 루트 그래프 자신의 mapId가 없어(Graph 타입에 id 없음) ancestry가 빈 Set으로 시작 — 루트를 직접 역참조하는 순환은 fetchResolved로 루트를 한 번 더 확장(한 단계 깊은 복제)한 뒤에야 닫힌다(circular 1행은 여전히 보장, 유한 정지도 보장). 루트가 아닌 두 서브맵 간 순환은 즉시 차단됨 — 두 케이스 모두 테스트로 구분.
- TDD: `excel-export.test.ts` 10케이스(재귀 인라인+depth·루트 자기참조 순환 1행(지연 차단 확인)·비루트 서브맵간 순환 즉시차단·다이아몬드 인라인+fetch 1회 스파이·locked denied·fetch reject denied·행 상한 단순+재귀중 상한(rowLimit 1개 보장)·start/end 포함 next에 End 라벨 표기·groups는 링크 맵 자신 기준) 모듈 부재로 RED 확인 후 구현 → 1회 실행에 10/10 GREEN.
- 게이트: excel-export 10/10·전체 vitest 287/287·tsc --noEmit 0에러·lint 경고 1건(기존 미관련 스크립트, 무변화).
- 리뷰 픽스(Important): 루트 맵 자기/상호참조 순환이 스펙(조상 경로 즉시 차단, design §4)을 어기고 루트를 한 바퀴 더 인라인하던 결함 — args에 옵셔널 `rootMapId?: number` 추가(기존 필드 전부 유지), 초기 ancestry를 rootMapId로 시드. 루트 상호참조 테스트를 rootMapId 기준(즉시 circular + 루트 re-fetch 0회 스파이 단언)으로 갱신, rootMapId 생략 시 기존 지연 차단 동작 케이스를 별도로 남겨 하위호환 박제. **Task 7 소비 계약: `buildExcelModel` 호출 시 현재 맵 id를 `rootMapId`로 전달할 것.** excel-export 11/11·전체 vitest 288/288·tsc 0에러.

## 2026-07-11 — Task 7: exceljs 기록 + 다운로드 3버튼 (numeric-params-export)
- `exceljs`(dynamic import) 설치·`downloadExcel` 구현(`lib/excel-export.ts`) — 헤더 연보라 필·note 행 3종(circular/denied/rowLimit)·URL 하이퍼링크 셀·`outlineLevel=min(depth,7)`·duration 컬럼 `numFmt "0.00"`. exceljs 실 타입에 맞춰 브리프의 `as never` 캐스팅 없이 `AddWorksheetOptions.properties`가 이미 `Partial<WorksheetProperties>`라 그대로 대입.
- 에디터 인스펙터(맵 탭) PNG 단일 버튼(`handleExportPng`, 옛 ~4297) → PNG/Excel/CSV 3버튼 나열로 교체. 공용 `buildExportFileName(ext)` 헬퍼로 파일명 규칙(sanitize+stamp) 통일 — PNG도 이 헬퍼로 리팩터(출력 동일, 라벨만 "Download PNG"→"PNG"로 축약해 3버튼 정렬). `buildGraph(nodesRef.current, edgesRef.current, groupsRef.current)`는 저장 경로(1366행)와 동일 소스 — 실물 확인 후 브리프 추정 그대로 사용. Excel은 `rootMapId: mapId` 전달(Task 6 소비 계약), `truncated`/CSV `warnings` 발생 시 토스트.
- i18n 6키(en/ko): `inspector.exportExcel`/`exportCsv`("Excel"/"CSV"), `err.exportExcel`, `export.csvWarnings`, `export.excelTruncated`. PNG 아이콘(`Download`)은 부수 동작 보존 원칙에 따라 유지, Excel/CSV는 `FileSpreadsheet`/`FileDown` 신규.
- 게이트: vitest 288/288·tsc --noEmit 0에러·lint 경고 1건(기존 `pw-smoke-task8.mjs`, 무관)·build 0에러 — exceljs는 별도 청크(912K)로 분리, app-build-manifest 어디에도 정적 참조 없음(dynamic import 격리 확인).

## 2026-07-11 — Task 8: 통합 검증(브라우저 실기동) + 배포 노트 (numeric-params-export)
- `frontend/scripts/pw-verify-export.mjs` 신규 — reset_db 시드 + 스크래치 맵으로 6시나리오 21/22 PASS: ①파라미터 5입력 blur 정규화(0.75→1.15)+노드칩 5개 ②새로고침 저장왕복 ③CSV 다운로드 13컬럼·숫자값→재임포트 머지 프리뷰 0 added/0 removed·그래프 무변경 ④Excel 다운로드를 exceljs로 재독해 — 맵A(제어 데이터) 숫자 셀 5종 실수형·하이퍼링크 {text,hyperlink}, 맵2(Employee Onboarding) 서브프로세스 재귀 인라인 행+outlineLevel=1 ⑤콘솔 에러 0. 조정 2건: 내보내기 3버튼은 인스펙터 "Map" 탭 안(탭 전환 헬퍼), 노드/엣지 id는 rid() 32자 hex(소프트삭제된 이전 실행 행과 UNIQUE 충돌 — dev.db는 전역 유니크).
- **유일 FAIL(Task 3 이월, 미수정)**: 디시전(마름모) 노드 파라미터 칩 overflow — 마름모 대각선 130.2px vs 콘텐츠 102.3×89.5(내접 조건 w+h≤D 위반, 191.8>130.2). 칩이 마름모 경계 밖 코너까지 침범. 증거: `/tmp/pw-verify-export/06-decision-params.png`. 픽스 여부는 컨트롤러 판단 대기.
- 게이트 전종: pytest 556 passed·ruff 0에러·vitest 288/288·tsc --noEmit 0에러·lint 경고 1건(기존 `pw-smoke-task8.mjs`, 무관)·build 0에러.
- **배포 노트**: ① 프론트/백 **동시 배포 필수** — `NodeIn` 5필드 정규화(백)와 인스펙터 입력/칩/CSV·Excel(프론트)이 스키마 연동, 한쪽만 배포 시 신규 파라미터 저장·표시 불일치. 신규 4컬럼은 `db.py _ADDED_COLUMNS` 멱등 보강으로 자동 추가(수동 DDL 불요). ② 서버 1회 정리 SQL(**선택** — validator가 무효 duration을 응답 경계에서 `""` 소거하므로 방치해도 무해, 물리 정리를 원할 때만): `UPDATE nodes SET duration = '' WHERE duration !~ '^[0-9]+(\.[0-9]{1,2})?$';`

## 2026-07-11 — 숫자 파라미터 + Excel/CSV 내보내기 구현 계획 (main)
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-numeric-params-excel-csv-export.md` (8태스크: 정규화 유틸 FE/BE 동치 → 백엔드 4컬럼+경계 소거 → 프론트 입력/칩/diff → CSV 임포트 확장 → CSV 내보내기(왕복 불변 테스트) → Excel 모델(재귀) → exceljs 기록+3버튼 → 브라우저 검증). 무효값은 422 대신 "" 소거(from_attributes 응답 경로 보호), 내보내기 진입점은 3버튼 나열.

## 2026-07-11 — 숫자 파라미터 5종 + Excel/CSV 내보내기 설계 (main)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md`. duration 자유텍스트 → 숫자 파라미터 5종(duration H.MM 표기·60분 이월, headcount/etf/cost/extra 십진수, 기존 컬럼 재사용+4컬럼 추가), CSV 임포트 갱신+왕복용 CSV 내보내기 신설(재임포트 diff 0 기준), Excel(.xlsx) 클라이언트 exceljs 내보내기(서브프로세스 전체 재귀 인라인·순환 조상검사·행 상한 2,000·locked 마스킹). Word는 다음 세션.

## 2026-07-11 — AI 사용량 계측·매뉴얼 선별 (worktree-ai-usage-manual)
- B1 1/3: call_ai가 usage를 AiReply로 반환, _ask_and_validate가 시도 전체 누적(실패 시 HTTPException에 동봉).
- B1 2/3: ai_usage_events 테이블(create_all 자동)·성공은 write-through 동봉·실패는 ok=false 별도 커밋(502 전파 유지).
- B1 3/3 백엔드: GET /api/dashboard/ai-usage — SQL 집계(합계·실패·상위5), sysadmin 전역 게이트.
- 픽스: 집계 테스트에 상위 목록 내림차순 정렬 단언 추가(공유 DB 오염 무관 상대순서 검증).
- B2: 매뉴얼 30k 절단 → 섹션 선별(## 분할·2-gram 점수·TOC 상시·budget 12k, 소형 매뉴얼 무변화).
- 픽스: 매뉴얼 선별 header 단독 budget 초과 시 절단 보장(+테스트)·_extract_bigrams 개명.
- B1 프론트: Dashboard 탭 스텁에 AI usage 섹션(StatCard 4·상위 2표·빈 상태), i18n 9키.
- T6 브라우저 검증 + 최종 게이트 — `frontend/scripts/pw-verify-ai-usage.mjs` 신규(이벤트 2건 앱모델 시드→설정>Analytics>Dashboard 진입카드→AI usage 섹션 3체크: ①섹션 가시 ②토큰 합계(1,290) 렌더 ③상위 사용자 verify.user 노출, 3/3 PASS). 조정: 진입카드 클릭 직후 `GET /dashboard/ai-usage` 응답 도착 전에 텍스트를 읽어 "—" 자리표시로 오탐하던 레이스 — 응답 대기 추가로 해결. 스크립트는 실행마다 이벤트를 누적하므로 재실행 전 reset_db 필요(주석 명시). 게이트: pytest 550 passed·ruff 0에러·vitest 244 passed·tsc 0에러·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 완료: B1 사용량 계측/집계·B2 매뉴얼 선별. 배포: 신규 테이블 create_all 자동 — 수동 DDL 불요. 사용자 확인(3002 데모) 후 main 머지.

## 2026-07-11 — AI 사용량 계측(B1)·매뉴얼 섹션 선별(B2) 설계·계획 (main)
- 설계 스펙 + 구현 계획(6태스크) 커밋 — `docs/superpowers/specs/2026-07-11-ai-usage-manual-select-design.md`, `docs/superpowers/plans/2026-07-11-ai-usage-manual-select.md`. 호출별 이벤트(`ai_usage_events`, 원문 미저장)·대시보드 스텁 확장·`## `분할+2-gram 섹션 선별(budget 12k, 소형 무변화). 머지는 사용자 최종 확인 후.

## 2026-07-11 — CSV 검증 스크립트 owning_department 대응 + 실행 (worktree-pw-verify-owning-dept)
- `owning_department` 필수 필드(4e5a0f7)가 두 pw-verify 스크립트를 깨뜨림 — merge는 raw `POST /maps`에 부서 미포함 422, create-flow는 생성 다이얼로그 `Create`가 오우닝부서 미선택으로 disabled. 두 스크립트 다 이 필드 이전 작성.
- 수정: merge는 `/directory`에서 부서 id 얻어 POST 바디에 `owning_department` 추가. create-flow는 결재자 앞에 오우닝부서 피커 선택(첫 `Search by name` 입력) 추가, 없으면 남은 ⑥ 검사 스킵.
- 실측 실행(localhost): **create-flow 21/21**(클립보드 SKIP=secure context, drag-drop·createdRef NOT COVERED), **merge 31/31**(AI챗 2 NOT COVERED). 콘솔 에러 0, 시드 소프트삭제.
- merge ⑦ 접기잠금 FAIL은 스크립트 버그였음(제품 정상) — "Toggle inspector" 라벨 버튼이 둘(툴바 no-op enabled + 패널 접기 disabled), `.first()`가 툴바를 잡음. 불변식 기준(패널 접기 `[disabled]` + 툴바 클릭해도 Import 탭 유지)으로 교체. **csv-import-merge 브랜치 인스펙터 잠금이 코드리뷰 아닌 실행으로 처음 검증됨.**
- ⚠️ 클립보드 수정은 여전히 미검증 — localhost는 secure context라 SKIP. 평문 HTTP 서버(:3333)에서 `BASE_URL=http://<IP>:3333`로 재실행해야 실검증.

## 2026-07-11 — AI graph 제안 CSV 병합 통합 + 담당자/부서 기본 금지 설계 (main)
- 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-11-ai-graph-merge-design.md`. AI graph 전량 교체가 비교모드 무의미화 + 서브프로세스 링크 파괴("색 변경" 현상의 진짜 원인 — 타입이 process로 바뀌며 바이올렛 고정 해제)를 CSV 병합 파이프라인 완전 공유로 해결. 디렉터리 프롬프트 제거, 담당자/부서는 사용자 명시 요청 시에만.
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-11-ai-graph-merge.md` (5태스크: 백엔드 프롬프트→병합 진입점→page.tsx 전환→탭/카드 UX→브라우저 검증).
- 백엔드: 조직 디렉터리 프롬프트 제거, 담당자/부서는 명시 요청 시에만(규칙②)·미입력 힌트 축소(소요시간만).
- 병합 공용화: pick/mergeNode 모듈 추출(무변경) + buildGraphFromAiProposal(매칭 id 재사용·서브프로세스 보존·base 있으면 AI 그룹 무시) vitest 8종.
- 에디터: applyAiProposal(전량 교체) 폐기 → enterAiGraphPreview(병합 프리뷰, previewSource=csv 슬롯 공유+importOrigin), ops set_attr 서브프로세스 색 무시.
- UX: Import 탭 origin 라벨(AI/CSV)·챗 graph 카드는 안내 푸터(커밋 버튼은 ops 전용), i18n 2키.
- T5 브라우저 검증 + 최종 게이트 — `frontend/scripts/pw-verify-ai-graph-merge.mjs` 신규(맵2 draft, subprocess 노드 보유 시드로 4체크: ①graph 제안→Import 탭 노출 ②Apply 후 매칭 노드 id 불변+신규 노드 추가 ③챗 카드 안내 푸터 ④서브프로세스 node_type·linked_map_id 보존 +콘솔에러 0, 11/11 PASS). 브리프 골자에서 두 가지 조정: (a) 시드 draft 버전은 다른 사용자 체크아웃이 미리 걸려 있어(sticky 점유 데모) `force:true`로 인수해야 PUT /graph가 통과 — checkout 없이는 409/423; (b) 시드 그래프는 `node_type="process"`가 아니라 "task"/"subprocess"를 쓰고, AI 제안이 base의 start/end 노드를 echo하지 않으면 병합 결과에 시작 노드가 0개가 되어 백엔드 `validate_process`가 422 — 매칭 대상을 타입 무관 필터로 바꾸고 proposal에 start/end를 항상 echo하도록 수정. 맵 1 기본 선택 버전(published)은 편집 불가라 `?version=`으로 draft(id 12)에 직접 진입. 게이트 4종: pytest 538 passed·ruff 0에러·vitest 242 passed·tsc 0에러·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 완료: AI graph 병합 파이프라인 — 비교모드 유의미화·서브프로세스 보존. 배포 영향 없음(DB 무변경).
- 최종리뷰 픽스: 제안이 start/end 누락 시 base 유지(불투명 422 제거)·중복제목 테스트·ops 주석·카드 문구 중립화.

## 2026-07-11 — 오우닝 부서 누락 태그 위치·표기 변경 (worktree-owning-badge-move)
- 홈 카드의 누락 태그를 타이틀 행에서 우측 하단 카운트 자리(노드·버전·인원 수)로 이동 — 누락 맵은 카운트 대신 TriangleAlert + "No owning dept"(언어 무관 영어 고정, 역할/상태 패턴)로 대체 표시. data-id 유지로 pw-verify 스크립트 무변경. lint·tsc·build·vitest 234 초록.
- 누락 태그를 필 형태로 — `rounded-full bg-error/10`(토큰 color-mix 10% 반투명 틴트, recent-badge 필 패턴) + text-error. 빌드 CSS에서 유틸 생성 실측 확인. lint·build 초록.
- 태그 문구 "No owning dept" → "Dept unassigned" (사용자 선택 — 상태 서술·2단어, en/ko 사전 동일 영어). lint·build 초록.
- 우측 상세 카드(map-detail-card) 가시성·역할 필 행에 오우닝 부서 필 추가 — 지정 시 Building2 + 부서명(accent-tint 필, 한글명 우선 formatDeptName), 미지정 시 홈 카드와 동일한 "Dept unassigned" 반투명 경고 필. lint·tsc·build 초록.
- 상세 헤더 Open 버튼 삭제 + 필 3종(공개·역할·오우닝 부서)을 설명 아래에서 헤더 우측으로 이동(열기는 카드 타이틀 링크로 유지). 무용해진 `hideOpen` prop 제거 — 소비처 2곳(inspector 탭·에디터 page.tsx, 후자는 ugrep 브래킷 함정으로 tsc가 적발) 정리. lint·tsc·build·vitest 234 초록.
- 상세 헤더 공개·역할 필을 오우닝 부서 필과 동일한 반투명 필로 통일(+아이콘: Globe/Lock·Crown/PencilLine/Eye, 색 의미는 기존 visibilityPillClass·RoleBadge 유지 — public/editor=added, owner=accent, private/viewer=중립). 버전 타임라인은 최근 3개만 기본 노출 + "{n}개 더보기/접기" 토글, 접힌 카드 이벤트 칩은 1줄 고정(nowrap 잘림)·게시 칩은 우측 고정에 이름 생략(이름은 툴팁, 좌측 칩에서 제외). lint·tsc·build·vitest 234 초록.
- 버전 카드 "이 버전으로 가기" — 펼침 전용 버튼을 없애고 카드 호버 시 상태 필이 버튼으로 페이드 교체(grid 겹침 + opacity 전환, 이동 불가 카드는 상태 필 고정, 비호버 시 pointer-events 차단으로 오클릭 방지). 우측 생성일시는 제목과 세로 중앙정렬(items-center). lint·tsc·build·vitest 234 초록.
- 상태 필(+호버 버튼)을 버전 이름 바로 우측으로 — 이름 span의 flex-1 제거, 겹침 셀 justify-items-start(이름에 밀착·버튼은 오른쪽으로 성장). lint·tsc·build 초록.
- Current 배지 제거 — 기준이 "최신 생성 버전"(idx 0)일 뿐 열람 중/게시본과 무관해 정보가치 낮음(사용자 결정). 최신 카드의 연보라 하이라이트는 유지, 고아가 된 `home.verCurrent` 키 en/ko 삭제. lint·tsc·build·vitest 234 초록.
- 호버 스왑 정련 — "이 버전으로 가기"는 펼침 상태에서만(위치는 이름 우측 유지), 접힘 카드는 "Click for details" 안내 필로 스왑. 버튼 좌측 클릭 불가 버그 수정(투명 상태 필이 opacity<1 스태킹 컨텍스트로 위에 떠 클릭을 삼킴 → 필 pointer-events-none). 버튼 자체 호버는 accent 채움(hover:bg-accent+text-on-accent). i18n `home.verClickHint` en/ko. lint·tsc·build·vitest 234 초록.
- 스왑 크로스페이드 350→700ms(토큰 사다리 최장, "1초 정도" 요청 대응) — 호버 초반에 상태 필을 인지할 수 있게. 버튼 페이드는 래퍼로 옮기고 버튼 색 호버는 transition-colors 150ms로 분리(700ms면 굼뜸). lint·tsc·build 초록.

## 2026-07-10 — 후속 정비: 비교화면 로드 실패 처리 + AI 게이트/페이로드 잔무 (worktree-ai-followup-fixes)
- 비교화면 로드 effect 3곳 try/catch — 403은 에디터와 동일한 비공개 맵 안내 모달(홈 이동), 그 외는 인라인 오류 표시로 무한 로딩 제거. 브라우저 검증 `pw-verify-compare-403.mjs` 4/4(403 모달·홈 이동·500 인라인·정상 무회귀).
- AI 게이트/페이로드 리뷰 잔무 3건: public 맵 `/graph/all` 게이트 assert, toPayload walkthrough vitest, 스모크 check17 `.catch`+detail. 덤: `chat-sessions.test.ts:82` never 타입 에러 수정 — 직전 픽서의 "tsc 0 errors" 보고가 허위였고 next build는 테스트 파일 타입 에러로 안 깨져 잠복(이후 게이트에 tsc --noEmit 상시 포함).

## 2026-07-10 — 맵 필수 필드 '오우닝 부서' 설계
- 모든 맵에 책임 부서 필수화 설계 확정 — 생성 시 지정 필수(모든 조직 레벨), 파생 권한 방식(권한 행 없이 `effective_role`에서 오우닝 부서 소속 = editor 바닥값)으로 잠금 에디터 구현, 부서 리더 자동 승인자(제거 가능)·피커 우선 노출, 기존 맵은 NULL=누락 + 설정 owner/sysadmin 수동 지정 + 홈 필터·배지. `docs/superpowers/specs/2026-07-10-owning-department-design.md`.
- 구현 계획 작성 — 8태스크(백엔드 3·프론트 4·시드/검증 1), `docs/superpowers/plans/2026-07-10-owning-department.md`. 기존 테스트 52곳의 생성 호출엔 **앵커 부서**(어떤 테스트 액터도 소속되지 않는 시드 직원 org)를 주입해 파생 editor가 기존 403 단언을 오염시키지 않게 한다. `MapCreate` 필수화로 프론트 미반영 중간 커밋은 맵 생성이 불가하므로 워크트리 브랜치에서 원자적으로 머지.
- T1 백엔드 — `process_maps.owning_department` 컬럼 + `MapCreate` 필수 필드 + 라우터 `_assert_known_department`(known org_path 아니면 422) + copy 상속. conftest에 `owning.anchor`(비활성) 앵커 부서 시드, 기존 테스트 52곳에 앵커 부서 주입(sed 기계적 + 분할라인 1곳 수동). pytest 526 passed·ruff 0에러.
- T2 백엔드 — `logic.effective_role`에 `owning_department: str | None = None` 키워드 추가, grants 루프와 baseline 사이에 소속(prefix 하위 포함)이면 editor 바닥값 삽입(권한 행이 없어 해제·다운그레이드 불가="잠금"). 호출부 3곳(`access.py` get_effective_role/get_eligible_users, `maps.py list_maps`) 패스스루. 순수 로직 4 + enforce 통합 3 테스트, pytest 533 passed·ruff 0에러.
- T3 백엔드 — `PUT /maps/{id}/owning-department`(owner 게이트, `OwningDepartmentIn` 스키마, `_assert_known_department` 재검증) 추가, 레거시 NULL 맵의 최초 지정도 동일 엔드포인트로 처리. `POST /maps/{id}/permissions`에 오우닝 부서와 동일 department principal이면 409 가드(하위/상위 부서 grant는 허용). MapPermission 삽입 없음 — 컬럼만 갱신하면 파생 editor가 자동으로 새 부서를 따라간다. 스펙 문서 "중복 방지 가드" 400→409 정정. 신규 5 테스트, pytest 538 passed·ruff 0에러.
- T4 프론트 — `api.ts` 인터페이스 `MapSummary.owning_department` 필드 + `setOwningDepartment()` 함수, `principal-picker.tsx` `pinnedIds` prop + 브라우즈 IIFE로 핀 고정 + 배지 로직 확장, i18n 키 `perm.principalDeptLead` (en/ko). npm run lint·build 0에러.
- T5 프론트 — `createMap()` 4번째 인자 `owningDepartment` 필수화(호출부 1곳 동반 갱신), 생성 모달에 오우닝 부서 필드(피커→선택 후 잠금 표시+X 재선택) 추가·생성 게이트에 편입, 부서 리더 자동 승인자(제거 가능·부서 재선택 시 자동분만 교체)·`pinnedIds`로 승인자 피커 상단 고정, 오우닝 부서 소속원을 private 승인자 후보군에 편입, 협업자 목록에 잠금 행 노출. i18n 키 `perm.owningDept.*` (en/ko). npm run lint(경고 1건 무관)·build·vitest 234 passed.
- T5 리뷰 픽스 — `autoLeaderRef` 상태 오염 2건: ⓐ `applyOwningDept`가 dedup으로 실제 추가 안 했을 때도 리더를 auto로 기록해 수동 추가분이 clear 시 삭제되던 버그(실추가 시에만 ref 기록), ⓑ 자동 추가된 리더 pill을 수동 제거해도 ref가 남아 재선택/clear가 동명 수동 재추가분을 지우던 버그(`handleRemoveApprover`를 plain 함수로 전환·제거 대상이 추적 리더면 ref 해제). lint·build·vitest 234 passed.
- T6 프론트 — 설정 화면에 오우닝 부서 Assign/Change(owner 게이트) + 협업자 잠금 행 추가. `map-details-panel.tsx`에 부서 표시/피커 블록(미지정 시 경고+Assign, 지정 시 잠금뱃지+Change), `collaborators-panel.tsx`에 합성 잠금 행(MapPermission 미생성, 표시 전용) 추가, `settings/page.tsx`에 `owningDepartment` state 배선(초기 로드+refreshMap 양쪽) + `isOwner`/`onChanged` prop 전달. i18n 키 `perm.owningDept.title/missingNotice/assignBtn/changeBtn/saved` (en/ko). npm run lint(경고 1건 무관)·build 0에러.
- T6 리뷰 픽스 — 협업자 패널에서 잠금 행이 보이는데 "No collaborators yet."이 같이 뜨던 자기모순 UI 수정: 빈 목록 안내를 `perms.length === 0 && !owningDepartment`일 때만 렌더(오우닝 부서는 권한 행을 만들지 않아 신규 맵 대부분이 두 문구를 동시 노출하던 문제). lint(경고 1건 무관)·build 0에러.
- T7 프론트 — 홈에서 오우닝 부서 누락 맵 구분: 카드에 "No owning dept" 배지(departed 배지와 동일 error 톤), Owning 필터 드롭다운(누락-only 토글, sessionStorage 영속·listKey·Clear 편입), i18n `home.filterOwning/owningMissing*` (en/ko). ⚠️ 구현 에이전트가 메인 체크아웃에 커밋한 것을 cherry-pick으로 워크트리 이관 후 main은 원복. npm run lint/build 0에러.
- T8 시드+브라우저 검증+최종 게이트 — `seed_org_demo.py` `_seed_maps`에 idx%3==0 맵만 오우닝 부서 누락으로 남기는 2/3·1/3 분배 추가(brief 코드 그대로). `frontend/scripts/pw-verify-owning-dept.mjs` 신규 — brief 6시나리오 + 리뷰 요청 2건(리더 수동추가·오우닝 dedup 겹침, 협업자 빈 문구 공존 금지) 총 29체크. **SETUP 필요**: `seed_org_demo.py`가 `DeptInfo`(부서장)를 시드하지 않아(어드민 JSON 임포트 전용) 리더 자동추가·핀고정 시연이 불가능했던 갭을 스크립트가 실행 시점에 `/api/admin/dept-info` PUT으로 부서장 1명을 런타임 심어 메움(디렉터리에서 동적 선택, 하드코딩 아님) — dev.db에 영구 반영, 완전 복원은 `git checkout backend/dev.db`+백엔드 재시작. reset_db 직후 클린 실행 29/29 PASS·console errors 0(재실행은 ⑥의 시드 맵 영구 변경으로 "count=4" 단언이 count=3으로 어긋날 수 있음 — 재현 아님, 클린 1회 실행 기준). 스크립트는 관례상 `frontend/scripts/`에 둠(brief는 `backend/scripts/`라 적었으나 기존 pw-verify-*.mjs 9개 전부 frontend/scripts/에 있고 playwright-core도 frontend에만 설치되어 그쪽이 맞음 — cwd 불일치를 바로잡음). 시나리오 ⑧은 통과했지만 구조적으로 비판별적 — `create_map()`이 항상 owner 권한 행을 삽입해 `perms.length === 0`이 어떤 맵에서도 참일 수 없으므로 T6 수정("No collaborators yet." 가드)을 실질 검증하지 못함. 게이트 4종: pytest 538 passed·ruff 0에러·vitest 234 passed·lint(경고 1건, `pw-smoke-task8.mjs` 기존 미관련)·build 0에러.
- 최종 리뷰 마감 3건 — 부분실패 안내 문구에 오우닝 부서 언급 추가(재시도 시 미반영 사실을 숨기지 않도록, en/ko), 협업자 패널 잠금 행에 `!loading` 게이트 추가(스켈레톤과 동시 노출 방지), 홈 필터 sessionStorage 복원 시 `owningFilter` 값을 UI가 만들 수 있는 `"missing"`으로만 좁힘(임의 문자열 복원 시 전체 맵 필터아웃 방지). lint(경고 1건 기존·미관련)·build 0에러·vitest 234 passed.

## 2026-07-10 — CSV로 새 맵 만들기 + 클립보드 수정 설계 (worktree-csv-create-flow)
- **클립보드 버그 확정**: 복사 4곳(`csv-template-actions.tsx:32`, `markdown-view.tsx:179·188·198`)이 전부 `navigator.clipboard?.writeText()`. `navigator.clipboard`는 secure context 전용인데 서버는 원격 IP + 평문 HTTP → `undefined`. `?.`가 삼켜 **에러 없이 실패하고 버튼은 "복사됨!"을 띄운다**. localhost는 secure context라 재현 안 됨(`CLAUDE.md` 경고 그대로).
- 3조각 설계 — Ⓐ `lib/clipboard.ts` `copyText()`(execCommand 폴백 + boolean 반환, 호출부 4곳이 실패를 표시) Ⓑ 백엔드 `csv_manual_url`(Settings→`/api/me`, `manual_url`과 동일 경로, DB 무변경) Ⓒ 홈 분할 버튼 → CSV 드롭존 모달(요약 확인) → `CreateMapDialog`에 파일 아코디언·이름/설명 프리필·`createdRef` 재시도. `docs/superpowers/specs/2026-07-10-csv-create-flow-design.md`.
- 생성 시점엔 `listEligibleAssignees(versionId)`를 못 쓴다(버전 부재) → `getDirectory()`로 `CsvDirectory` 조립. 순수 함수 `stripCsvExtension`·`toCsvDirectory`만 TDD, 클립보드는 vitest가 node 환경이라 **단위 테스트 불가**(브라우저·평문 HTTP 오리진에서 검증).
- 구현 계획 작성 — 7태스크 34스텝, `docs/superpowers/plans/2026-07-10-csv-create-flow.md`. `execCommand`는 사용자 제스처 안에서 **동기 호출**해야 하므로 insecure 분기는 `await` 전에 실행한다. `CreateMapDialog`는 `map-name-dropdown.tsx`도 마운트하므로 `csv` prop은 반드시 optional.
- Ⓐ `lib/clipboard.ts` `copyText()` — insecure context면 textarea+execCommand 동기 폴백, 성공 여부를 boolean으로 반환. 호출부 4곳이 실패 시 성공 표시·onCopy를 내지 않는다. 단위 테스트 불가(vitest node 환경) — 브라우저·평문 HTTP에서 검증. vitest 219·lint 0에러.
- Ⓑ 백엔드 `csv_manual_url` — Settings → `MeOut` → `/api/me`(기존 `manual_url`과 동일 경로, DB 무변경). `.env.example`에 `CSV_MANUAL_URL=`. pytest +1.
- Ⓒ 순수 헬퍼 `stripCsvExtension`·`toCsvDirectory` — 생성 시점엔 `listEligibleAssignees(versionId)`를 못 써서 `/api/directory`로 담당자/부서를 해석한다. departments는 말단명(org_path 아님). vitest 231·lint 0에러.
- Ⓒ `CsvTemplateActions`에 CSV 매뉴얼 버튼(값 없으면 숨김) + 프롬프트 버튼 라벨을 "다른 AI에게 부탁하기"로. 에디터 임포트 모달도 같은 컴포넌트라 함께 적용. vitest 231·lint 0에러.
- Ⓒ `CreateMapDialog`에 optional `csv` prop — 파일명 아코디언(요약·경고 펼침), 이름·설명을 확장자 뗀 파일명으로 프리필, `createdRef`로 저장 실패 후 맵 재생성 없이 재시도. `createNotice`·`sectionTitle` 키 제거. vitest 231·lint 0에러.
- Ⓒ 홈 분할 버튼(쉐브론 → "CSV로 새 맵 만들기") + `csv-create-modal.tsx` — 드롭존(클릭=탐색기, 드래그&드롭)·양식/매뉴얼/프롬프트 3버튼·파싱 에러 차단·요약 2단계. 디렉터리 로드 전 [확인] 비활성. `csv` prop이 앞 커밋에서 선반영돼 이 커밋 단독으로 빌드 초록.
- Ⓒ 리뷰 픽스 — 쉐브론 메뉴가 다이얼로그 뒤에 남던 문제(stopPropagation 범위 축소·좌측 버튼이 메뉴 닫음), 임포트 실패 경로가 성공 토스트를 띄우던 문제(`onCreated(silent)`), `getMe()` 실패가 모달 전체를 막던 문제(디렉터리와 분리), 디렉터리 로드 전 드롭이 조용히 무시되던 문제(로딩 상태·비활성). vitest 231·lint 0에러.
- Ⓒ 브라우저 검증 스크립트 `pw-verify-csv-create-flow.mjs` — 클립보드(평문 HTTP 오리진에서만 유효)·분할버튼·파싱 에러 차단·프리필·아코디언·담당자 해석 경고·매뉴얼 버튼 7시나리오. **아직 미실행**(서버 필요).
- Ⓒ 전체 리뷰 픽스 — 맵 생성 후 협업자/결재자 단계가 실패하면 고아 맵이 목록에도 안 뜨고 재시도가 이름 409로 막히던 문제. `createdRef`를 `createMap` 직후 기록하고, 비멱등인 `addMapPermission`은 `grantedRef`로 건너뛰며, 멱등 PUT인 `setMapApprovers`는 매번 재전송. 바깥 catch가 `onCreated(true)`로 고아를 노출. 디렉터리 로드 실패 시 드롭존 비활성. vitest 231·lint 0에러.

## 2026-07-10 — CSV 임포트 머지 전환 설계 (worktree-csv-import-merge)
- 원인 규명: 임포트 후 비교가 전부 변경으로 잡는 건 비교 버그가 아니라 임포트의 전체 교체 탓 — ⓐ `diff.ts:203` `edgeKey`가 노드 계보 키만 써서 새 id면 전 엣지 오탐, ⓑ `NODE_DEFAULTS`(`csv-import.ts:104`)가 color/assignee/department/group_ids를 초기화해 정당한 `changed` 유발. 덤으로 코멘트(`graph.py:194`)·그룹까지 삭제 중.
- 해법: 프론트에서 제목 일치 노드의 **id를 재사용**하면 `graph.py:242` upsert가 제자리 UPDATE라 계보·코멘트·그룹이 보존되고 엣지 키가 안정된다. **백엔드 변경 0줄.**
- 3단계 설계 확정 — ① 새맵 다이얼로그는 템플릿 다운로드+프롬프트 복사만(+노티스), 생성 후 항상 에디터 이동 ② 이름 기준 머지 임포트(서브프로세스 `node_type` 보존) ③ 캔버스 프리뷰(`data.diffStatus` 재사용)+인스펙터 Import 탭(삭제/유지 선택, 탭·접기 잠금). `docs/superpowers/specs/2026-07-10-csv-import-merge-design.md`.
- 구현 계획 작성 — 9태스크 42스텝(태스크당 1커밋), `docs/superpowers/plans/2026-07-10-csv-import-merge.md`. 컴포넌트 테스트가 0개(전부 `lib/` 순수 모듈)라 TDD는 `csv-import.ts`·`diff.ts`에만 적용하고 UI는 lint·build·브라우저 실검증으로 확인. 신규 노드 부분정렬은 `buildGraphFromCsv` 안에서 1회만(프리뷰 재실행 금지 — 앵커 어긋남).
- ①-b 설명·담당자·부서 컬럼 추가 결정 — CSV 9열. 담당자는 login_id로 적고 임포트가 `eligible` 디렉터리로 이름 해석(이름 직접 표기도 통과), 부서는 정식명 또는 한글명, 미해석은 원문 저장 + 비차단 경고. 설명은 `Text` 컬럼이라 길이 제한 없음(`MAX_LEN` 제외). **백엔드는 담당자를 검증하지 않는다**(`NodeIn`은 길이만) — 안전망은 프론트 드리프트 배지뿐.
- **빈 셀 = 기존 값 유지**를 전 속성 열에 일관 적용. 근거: AI 프롬프트(`csv-import.ts:395`)가 "불명확한 속성은 비워두라"고 지시하므로 빈 칸이 값을 지우면 AI 생성 CSV 재임포트마다 속성이 전멸한다. `Next`만 예외(빈 값 = 말단).
- `docs/samples/*.csv` 3종이 이미 낡음(헤더에 `URL_Label` 누락, 파서의 열 부분집합 허용이 은폐) — 9열로 재작성 예정.
- ① 새맵 다이얼로그 축소 — CsvTemplateActions 추출(템플릿·프롬프트만), 노티스 추가, 생성 후 항상 에디터 이동. `mapCreatedImportFailed` 키 제거. vitest 162·lint 0에러.
- ①-b CSV 컬럼 확장 — Description(길이 제한 없음, Text 컬럼)·Assignee(login_id→이름 해석, 이름 직접 표기도 통과)·Department(한글 부서명→정식명) + 비차단 경고(미해석 담당자·미지 부서·부서 불일치). 백엔드는 담당자를 검증하지 않아 프론트 드리프트 배지가 유일한 안전망. vitest 174·lint 0에러.
- ①-b 템플릿·AI 프롬프트에 Description·Assignee(계정 id)·Department 규칙 추가, "빈 칸=건드리지 않음" 명시. `docs/samples/*.csv` 3종은 헤더가 URL_Label 없이 낡아 있어 9열로 재작성. vitest 174·lint 0에러.
- ② `buildGraphFromCsv(text, context?)` 이름 기준 머지 — 제목 일치 노드 id 재사용(계보·코멘트·그룹 보존), 빈 셀=기존 값 유지, 서브프로세스 node_type 보존, 신규 노드만 부분 dagre. `withKeptNodes` 추가. vitest 191·lint 0에러.
- ② 에디터 배선 — CsvImportSection `context`(base + eligible 디렉터리), 요약/확인 모달을 추가·갱신·삭제 실카운트로, 행 경고 노출, Import 버튼을 `eligible !== null`로 게이팅. vitest 191·lint 0에러.
- ② 비교 회귀 테스트 `diff.test.ts` 신설 — 클론+머지 시나리오에서 미변경 엣지가 오탐되지 않고 실제 변경만 잡히는지 6케이스. vitest 197.
- ③ 프리뷰 상태 기계 일반화(`aiPreviewRef`→`previewRef` + `previewSource`) + CSV 머지 프리뷰 진입/확정/취소. 소멸 노드·엣지 `diffStatus`/빨간 점선. 확인 모달 폐지. vitest 197·lint 0에러. ⚠️ Apply/Cancel UI는 다음 커밋(Import 탭).
- ③ 인스펙터 Import 탭(`forcedTab`/`lockTabs`, 프리뷰 중 다른 탭·접기 잠금) — MarkdownView 요약 + 행 경고 + 소멸 노드 React 리스트(클릭→캔버스 포커스) + 삭제/유지 세그먼트 + Apply/Cancel, 버튼별 리치 툴팁. vitest 197·lint 0에러.
- ③ 리뷰 픽스 — ConfirmDialog 폐지로 고아가 된 i18n 키 3종 제거, 인스펙터 잠금 조건을 `importSlot`과 단일 조건으로 통일(잠복 덫 제거), `tabIntro` 플레이스홀더 `{updated}`→`{matched}`. vitest 197·lint 0에러.
- ③ 전체 브랜치 리뷰 픽스 — AI/CSV 프리뷰 상호 배타(중첩 시 미승인 AI 그래프가 자동저장되던 데이터 안전 버그), `previewRef`를 소스 유니온으로 통일, 고아 `disabled` prop 제거, 폐기된 설계문서 참조 갱신. vitest 197·lint 0에러.
- ③ 브라우저 검증 스크립트 `pw-verify-csv-import-merge.mjs` 작성 — 프리뷰 충돌·머지 후 비교 무오탐·빈 셀 보존·삭제/유지·담당자 해석 경고·서브프로세스 보존·인스펙터 잠금 7시나리오. **아직 미실행**(서버 필요) — 실행 명령은 스크립트 헤더 주석 참조.

## 2026-07-10 — SearchSelect 드롭다운 포털화 + 노드 편집 모달 스크롤 (worktree-select-portal)
- 버그: BPM 속성의 부서 드롭다운이 `absolute`라 노드 편집 모달(`overflow-hidden`)·인스펙터(`overflow-y-auto`)에 잘림. `elementFromPoint`로 실측 — 모달은 전 높이에서, 인스펙터는 vh≤620에서 아래 모서리가 가려짐.
- `search-select.tsx` 기본 모드도 addMode처럼 **body 포털 + fixed**로. 좌표는 트리거 rect 기준(`computeMenuPos`: 아래 우선 → 위 → 클램프, `fitContent`면 우측 정렬), 열린 동안 `resize`/`scroll`(capture) 재계산, 닫힘 시 좌표 비움. z=1350(백드롭 1340) — 노드 모달(1200)·서브프로세스 모달(1300) 위.
- `node-summary-modal.tsx` 본문에 `min-h-0` + `scrollbar-hidden`. flex 자식의 `min-height:auto`(=min-content)가 축소를 막으면 `overflow-y-auto`가 죽고 카드의 `overflow-hidden`이 선행/후행 내비를 잘라 닿을 수 없게 되는 잠복 결함. 스크롤바만 감추고 스크롤은 유지.
- ⚠️ 사용자가 보고한 "모달 세로 스크롤 소실"은 400~800px 전 구간에서 **재현 실패**(본문은 항상 스크롤됨). 위 `min-h-0`은 원인 가설에 대한 선제 방어이며, 재발 시 창 크기·노드 내용 필요.
- 검증: `scripts/pw-verify-search-select-portal.mjs` 20/20(4개 높이 × 인스펙터·모달, 콘솔 에러 0) · 기존 스모크 21/21·10/10 회귀 없음 · vitest 184 · lint 0에러 · build.

## 2026-07-10 — 인원 카드 부서명 한글화 (worktree-korean-dept-card)
- 버그: 한글 모드에서 이름은 한글인데 부서명이 전부 영문. `map-detail-card.tsx`가 부서 표시에 `dept_info.korean_name`도 `employees.korean_dept`도 **한 번도 읽지 않았다** — 영문 org 세그먼트만 렌더.
- 수정 4곳(유저 행 말단 부서 · 펼침 레벨 필 · 팀 행 이름 · 팀 행 호버 상위 경로). 순수 함수 3종 신설: `buildKoreanDeptByPath`(확정 dept_info 우선, 없으면 직원 신고 korean_dept 폴백) · `buildOrgPathChain` · `formatDeptName`(ko=한글||영문, en=영문). 아이콘 레벨 판정·정렬은 영문 리프 유지.
- 폴백은 직원이 실제 소속된 말단 경로만 채운다 — 상위 조직은 dept_info 임포트 전엔 영문. 데이터 없는 한글명을 지어내지 않는다.
- 실측(한글 모드): 「지원팀」(korean_dept 폴백) · 「배송실」(dept_info) · 「Operations Center」(둘 다 없음 → 영문). 영어 모드는 무변경. vitest 184 · lint 0에러 · build · `pw-verify-hotfix-ui-6.mjs` 21/21.

## 2026-07-10 — 새 맵 모달: 죽은 여백 제거, 시작 위치 상향 (worktree-modal-top)
- 직전 `pb-40`(160px) 철회 — 긴 화면(≥900px)에서 스크롤 없이 액션행 위 죽은 여백만 남았다. 빈 패딩으로 스크롤을 만들지 않는다.
- 모달 시작 위치 `pt-8`→**`pt-4`**, `max-h` `100dvh-4rem`→**`100dvh-2rem`**. 1280 폭 실측: 900px 이상에서 모달 833px·스크롤 0, 500px에서도 액션 버튼 화면 안(스크롤 컨테이너 밖이라 밀리지 않음).
- 드롭다운 방향은 배치 알고리즘에 일임 — 뷰포트 ≥1000px면 아래 5줄, 미만이면 옆. 잘림·위 flip 없음.
- 실측: vitest 172 · lint 0에러 · build 통과 · `pw-verify-hotfix-ui-6.mjs` 21/21(콘솔 에러 0).

## 2026-07-10 — 새 맵 모달 상단 정렬 + 하단 패딩 (worktree-modal-tall)
- 사용자 피드백 반영: 모달을 중앙 정렬에서 **상단 정렬(`items-start pt-8`)**로, `max-h`를 `100dvh-13rem` → `100dvh-4rem`으로 늘려 세로를 최대한 쓴다. 본문 스크롤 컨테이너에 `pb-40`(160px) 추가 — 마지막 결재자 피커를 그만큼 위로 올릴 수 있어 드롭다운이 뷰포트 높이와 무관하게 아래로 열린다(끝까지 스크롤 시 피커 아래 ≈265px).
- 대가: 본문이 스크롤되지 않는 긴 화면(≥1080px)에선 `pb-40`이 액션행 위 빈 여백으로 남는다(모달 993px). 짧은 화면에선 스크롤 여유로 소비.
- 실측: 1280×580 모달 32~548(이전 372px 중앙) · vitest 172 · lint 0에러 · build 통과 · `pw-verify-hotfix-ui-6.mjs` 20/20(콘솔 에러 0).

## 2026-07-10 — 핫픽스 UI 6 설계 (worktree-hotfix-ui-6)
- 4항목 설계 확정 — ① Back to editor 테두리 버튼, ② 피커 드롭다운 portal+fixed(아래 우선/부족하면 옆, 위 flip 금지), ③ 마스터-디테일 breakpoint 1280→980(`--breakpoint-split`) + 공지·인박스 탭 확대 적용, ④ 부서 tree JSON 임포트(파서 교체 + 백엔드 `known`을 org 전 레벨로 확장). `docs/superpowers/specs/2026-07-10-hotfix-ui-6-design.md`.
- 조사: 피커는 이미 floating이었고 밀림 원인은 `scrollIntoView` 반창고 — 진짜 문제는 모달 본문 `overflow-y-auto` 클리핑. `/api/directory`는 이미 전 org 레벨을 내려주므로 `known` 확장만으로 상위 부서 한글 검색·부서장 체인이 켜짐.
- T1 Back to editor를 테두리 컴팩트 버튼(ArrowLeft 16px/1.5, `self-start`)으로. T2 피커 드롭다운을 body portal + fixed로 옮기고 `scrollIntoView` 제거 — 배치는 `lib/dropdown-placement.ts`(아래→오른쪽→왼쪽→축소, 위 flip 없음). T3 생성 모달 `max-h`를 `100dvh-13rem`으로 낮춰 580px에서도 드롭다운이 아래로 열림. vitest 170·lint 0에러·build 통과.
- T4·T5 마스터-디테일 분기점을 `xl`(1280) → 커스텀 `--breakpoint-split`(980px)으로. 공지·인박스(알림·승인)도 맵 탭과 같은 아코디언 패턴 적용 — 상세를 `NoticeDetail`/`NotificationDetail`로 추출해 우측 패널과 아코디언이 공유. vitest 170·lint 0에러·build 통과.
- T7 브라우저 실측 검증 2종 통과 — `pw-verify-hotfix-ui-6.mjs` 19/19(밀림 0px·드롭다운 미클리핑·below/right 배치·3탭 940↔1100 전환·레일 버튼), `pw-verify-dept-tree-import.mjs` 10/10(모달 업로드 updated=4·상위 레벨 한글명 조인·본부/실 한글 검색·부서장 이름 검색). 콘솔 에러 0. 검증 중 `perm.backToEditor` 문자열에 박혀 있던 `←` 글리프(main의 기존 이중 화살표 버그) 제거.
- T6 부서 임포트를 조직도 tree JSON(`enDeptNm`/`deptNm`/`dheadUserId` + `children` 재귀)으로 교체. 백엔드 `import_dept_info`의 현존 부서 판정을 `org_l1~l5 ∪ department`로 확장 — 상위 부서(본부·실)에도 dept_info가 생겨 피커 상위 부서 한글 검색과 `/api/me` 상위 부서장 체인이 처음으로 동작. 부서장은 login_id만 저장하고 이름은 생성 다이얼로그가 디렉터리로 조인해 검색 키워드에 합침. `test_directory`의 "상위 프리픽스엔 dept_info 없음" 전제가 깨져 미임포트 부서로 교체. vitest 172·pytest 510·ruff·lint·build 통과.

## 2026-07-10 — AI 권한 게이트 + 페이로드 저장 설계 (main)
- AI 챗·그래프 조회 viewer 게이트 + `ai_chat_messages.payload` 저장(카드 히스토리 재현) 설계 스펙 커밋 — `docs/superpowers/specs/2026-07-10-ai-gate-payload-design.md`. 사용자 결정 3건(게이트 범위=AI+그래프 GET 2종, 과거 graph/ops=읽기전용, 카드=메시지 부착형 통일).
- 구현 계획 커밋 — `docs/superpowers/plans/2026-07-10-ai-gate-payload.md` (6태스크: 게이트→payload 백엔드→뷰모델→카드 통일→프론트 영향 점검→스모크·enforce 검증).
- 게이트 1/2: ai/chat·graph GET 2종에 require_version_map_role("viewer") 부착 + 게이트 테스트 6종.
- 페이로드 1/2: ai_chat_messages.payload TEXT(+_ADDED_COLUMNS)·kind별 서브셋 직렬화·조회 시 오염 NULL 강등.
- 페이로드 2/2 준비: 프론트 뷰모델 kind/payload 보존·toPayload(vitest).
- 픽스: chat-sessions 테스트 TS 컴파일 에러 2건(payload 필드 누락·리터럴 widening) — tsc 게이트로 검출.
- 카드 통일: 분리 state 제거→메시지 부착(ai-chat-cards.tsx), graph/ops 읽기전용 요약+라이브 커밋 카드 부착, 히스토리 워크스루 자동재생 없음.
- 프론트 영향 점검: 그래프 GET 호출처 5곳(editor 3·compare 2) 전수 조사 — 전부 선행 `getMap` viewer 게이트 통과 후에만 호출돼 신규 403 노출 없음(compare 페이지의 getMap 자체 에러 미처리는 Task1 이전부터의 기존 결함, 크래시 아닌 무한 로딩).
- 픽스: `highlightNode`에 사라진 노드 가드(`nodesRef.current.some`) 추가 — 히스토리 카드가 삭제된 노드를 가리킬 때 전체 deselect + 원점(0,0) fitView 점프 방지.
- Task 6(스모크·enforce 검증, 브랜치 마지막): `pw-smoke-ai-chat-history.mjs`에 체크 17(SMOKE-second에 `kind="analysis"` payload 메시지 시드 → `page.reload()` 후 `[data-id="ai-analysis-card"]` 재현 확인) 추가 + 기존 로딩-팁 대기에 `.catch()` 방어(크래시 방지, 판정은 그대로 FAIL 기록). 실행 결과 17개 체크 중 15개는 항상 PASS(신규 체크 17 포함), 체크 "3a/3b"(SMOKE-paging 초기 30개 로드)만 4회 중 3회 간헐적 FAIL — 원인은 `ai-chat-panel.tsx:285-290`(새 메시지 로딩 시 하단 스크롤 effect)과 `:564-569`(`onScroll`의 `beginLoadOlder` 상단 트리거)의 레이스: 30개가 패널 높이를 넘겨 스크롤 가능해지는 순간 브라우저 scroll-anchoring이 `scrollTop=0`인 중간 스크롤 이벤트를 발생시켜 `beginLoadOlder`가 오발동, 아직 스크롤 안 한 시점에 다음 페이지(10개)를 미리 당겨온다(초기 30 대신 40으로 관측). `git diff`로 대조 확인 — 이 두 구간은 Task 1~5가 건드리지 않은 기존 코드라 이번 브랜치의 회귀가 아님(선재 결함, 픽스는 스코프 밖 — 무단 수정 안 함, 컨트롤러 판단 필요).
- enforce 수동 검증(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=true`, port 8000, private map=2/version=11): ① 무권한 유저(`bora.choi`) GET graph → **403**, ② 동일 유저 POST ai/chat → **403**, ③ viewer 권한 유저(`doyun.lim2`) GET graph → **200**(실 데이터) + POST ai/chat → **502**(AI 서버 미구성 — 게이트 통과 확인, 403 아님). 3케이스 전부 기대대로.
- 최종 게이트: backend pytest 521 passed · ruff 0 · frontend vitest 234 passed(18 files) · lint 0 errors(1건 pre-existing 경고) · build 성공(10 라우트).
- **배포 노트**: 서버는 startup `_ADDED_COLUMNS`가 `ai_chat_messages.payload` 컬럼을 자동 보강 — 별도 수동 DDL 불요.
- 최종리뷰 픽스: toPayload graph 판정을 백엔드 규칙(nodes|edges|groups)과 정렬 + stale 주석 정리.

## 2026-07-10 — 문서 정리: 완료 SDD 문서 삭제 + PROGRESS compact (main)
- `docs/superpowers/` 완료 plans·specs 72개 + editor-compare-redesign 에셋(1.9MB) + `docs/frontend-compare-verification.md` 삭제 — 최근 2건(ui-batch2·member-card-icons)만 유지, 전부 git history에 보존.
- PROGRESS.md 1713→321줄 compact — 2026-07-07 이후 원문 유지, 06-11~07-06은 기능 단위 요약(`## 이전 이력 compact` 섹션).
- 워크트리 `ui-improvement-3`·로컬 브랜치 정리(main 머지 확인 후). 원격 `origin/worktree-ui-improvement-3`은 별도 삭제 필요.

## 2026-07-09 — UI 개선 배치 2 설계 (worktree-ui-improvement-5)
- 7항목 설계 확정 — 새맵 모달 dvh+숨김 스크롤·맵 목록 가로스크롤 방지·전체맵 권한>시간 정렬(순수 간격)·허용인원 역할 간격·서브프로세스 노트 축약·노드 표시 URL(라벨/LINK)·URL 배지(좌상단 표시 전용). `docs/superpowers/specs/2026-07-09-ui-batch2-design.md`.
- 구현 계획 작성 — 8태스크(항목당 1커밋 + 통합 시각 검증), `docs/superpowers/plans/2026-07-09-ui-batch2.md`. URL 배지는 좌상단이 코멘트 배지와 충돌해 좌하단으로 정정(사용자 확인).
- ① 새맵 모달 max-h-[calc(100dvh-2rem)]·본문 scrollbar-hidden 내부 스크롤. vitest 147·lint 0에러.
- ② 맵카드 목록 overflow-x-hidden — 가로 스크롤 방지(카드 min-w-0는 T8 실측 후 판단). vitest 147·lint 0에러.
- ③ 브라우즈 전체맵 owner→editor→viewer·updated_at 정렬 + 역할 경계 순수 간격(h-2). vitest 147·lint 0에러.
- ④ 허용 인원 타입 그룹 내 역할 정렬(owner→editor→viewer)·클러스터 간격(h-1.5) — 홈·인스펙터 공용. vitest 147·lint 0에러.
- ⑤ 서브프로세스 노트 한 줄 축약 + 전체 문구 툴팁(spNoteFull, EN/KO) — 속성탭·Map 탭 공용. vitest 147·lint 0에러.
- ⑦ 노드 표시 필드 nodeType→url(라벨 있으면 라벨, 없으면 LINK, subprocess는 spUrl/spUrlLabel) — localStorage 위생은 기존 hydration 필터가 처리. vitest 147·lint 0에러.
- ⑧ 노드 URL 배지 좌하단 표시 전용(액센트 틴트·툴팁=URL) — 좌상단은 코멘트 배지와 충돌해 위치 정정, 비교뷰는 data 미탑재로 자동 미표시. vitest 147·lint 0에러.
- ⑨ Map 탭 협업자 기본 접힘 + 서브프로세스 카드 엣지 스타일 아래로 이동(사용자 추가 요청). vitest 147·lint 0에러.
- ⑩ 노티스·인박스 빈 여백 클릭 = 선택 해제(맵 탭 패턴 미러, 카드·상세 stopPropagation). vitest 147·lint 0에러.
- ⑪ 피커 바깥 클릭 닫힘(검색어 유지·재검색)·전체 지우기 X 버튼 — principal-picker(open 상태화+scrollIntoView)·search-select(검색어 보존)·transfer 다이얼로그(X만). vitest 147·lint 0에러.
- ⑬ 분기(마름모) 노드 코너 배지 안쪽 12px 조정(배지 position prop화, 타 노드 무변경). vitest 147·lint 0에러.
- ⑭ 미니맵 페이드 줌 기준 교체 — ≥90% 유지·90→40% 선형 감소·≤40% 소멸. vitest 147·lint 0에러.
- ⑮ Alt+←/→ 좌측 사이드바·우측 인스펙터 토글 + More shortcuts 플라이아웃 항목 추가. vitest 147·lint 0에러.
- ③④ 스페이서를 순수 간격 → 회색 가로선(border-hairline)으로 교체(사용자 피드백). vitest 147·lint 0에러.

## 2026-07-09 — 피커 한글 검색 (worktree-ui-improvement-3)
- 유령 principal 배지: 협업자 목록(퇴사 유저 Departed·소멸 부서 Missing, 로딩 전 오탐 가드)·승인자 카드(Departed)·맵 카드 오너(owner_name null → id 폴백 + Departed) — text-error 약한 배지 + title 안내. 점유자 표면은 프룬 자동 해제로 유령 케이스 소멸이라 미적용. 브라우저 체크 배지 4종 PASS.
- 소멸 부서 일괄 재지정: `GET/POST /api/admin/dept-remap` — 현 조직 프리픽스에 없는 부서 경로의 맵 권한·그룹 멤버 참조 집계, 현존 경로로 일괄 이동(같은 맵/그룹 중복은 병합 — 권한은 높은 역할 유지). 부서 탭 하단 Missing departments 카드(경로·참조 수·SearchSelect 대상 선택·Reassign). pytest 509(+4)·브라우저 재지정 플로우 실측 PASS.
- 퇴사자(AD 프룬) 승인 데드락 해소: `_load_approvers` 바이어스 뒤집기(직원 행 없음=활성→제외, `workflow.load_active_approvers`로 공용화) + 프룬 직후 `reconcile_departures` — 퇴사자 점유 자동 해제, pending 재평가(잔여 승인자 전원 기승인→Approved 전이+제출자 알림, 유효 승인자 0명→플로우 취소·draft 복귀·생존 제출자 점유 재부여·오너/제출자 `approval_cancelled` 알림). 테스트 가상 승인자는 conftest 전역 시드(notif-*는 공지 브로드캐스트 오염 방지로 파일 지연 시드). pytest 509 GREEN. `/api/me`에 `manager_ids`(내 org 체인 리프→루트 부서장, 본인 제외) 추가 → CurrentUser 스토어 배선. PrincipalPicker 우측 라벨 — 내 상위 부서장 유저는 "Manager"·내 소속 부서(체인 프리픽스)는 "My Dept"를 accent-tint 필로 약한 하이라이트, 그 외 기존 개인/부서/그룹 유지. 승인자 피커 3곳(approvers-panel·approver-manager·create-map-dialog)은 빈 검색 브라우즈 시 매니저를 상단 고정(`sortManagersFirst`, 검색 랭킹 불변). pytest 501·vitest 162·기존 스모크 9/9·신규 브라우저 체크 7/7 GREEN.
- 피커 부서 검색 dept_info 연동: `/api/directory` 부서 항목·`eligible-assignees`에 dept_info(한글 부서명·부서장) 조인/맵 전달. PrincipalPicker 부서 필드=[영문명, 한글명(확정), 부서장, 관찰 키워드]·부서 행도 유저와 동일 한/영 토글(ko=`한글 (영문)`), SearchSelect 부서 옵션 label lang 연동+키워드 확장(`buildDepartmentOptions(departments, users, lang, deptInfos)`). dept_info 임시 시드(12/14 부서, 공백 섞음). pytest 500·vitest 159·기존 피커 스모크 9/9·신규 브라우저 체크 5/5(한글부서명·부서장 검색 top-pin·ko/en 토글) GREEN.
- 부서 정보 JSON 임포트: 새 `dept_info` 테이블(영문 리프 부서명 PK + korean_name·manager) + `PUT /api/admin/dept-info`(현존 부서만·빈 필드 보존·unknown 보고) + `/admin/users` departments 조인. 부서 탭 열 개편(한글 부서=임포트값·부서장 신설, 직원 집계 필 폐기 — `aggregateDeptKoreanDepts` 제거), 임포트 모달(다운로드·충돌 단계 없음, 임시 필드명 dept/koreanName/manager — 소스 키 확정 시 `dept-info-import.ts` 상수만 변경). pytest 498·vitest 156·lint·build·브라우저 체크 8/8 GREEN.
- 설정 사용자 탭 흡수·부서 탭 이동: 사용자 탭 고유 정보(sysadmin 태그·active 상태)를 직원관리 테이블로 옮기고(`EmployeeOut.active/is_sysadmin` 추가) UserTable·Permissions 카테고리 삭제, 부서 탭은 조직(Directory) 카테고리 하위로. 고아 i18n 키 6종 정리. pytest 493·vitest 150·lint·build·브라우저 체크 7/7 GREEN.
- 최종 리뷰 폴리시: SelectOption 타입 중복 제거(search-select 것 재사용), eligible-approvers에 korean_dept 전달(+테스트 단언), 스펙 후속 섹션(점유권 이전 육안 확인·부서 하이라이트 툴팁·스모크 시드 원복 백로그). ⚠️ 최초 폴리시 커밋(5b5beb9)이 스펙 문서·테스트를 훼손해 리셋 후 재적용.
- 전 피커(협업자·담당자/부서·점유권 이전) 한글이름·한글그룹(부서 항목 파생 키워드) 검색 + 행 표시 lang 연동 + 점유권 이전 스코어링 통일 설계 — `docs/superpowers/specs/2026-07-09-picker-korean-search-design.md`.
- 구현 계획(5 task: BE 필드 전달 → lib 빌더 → PrincipalPicker+어댑터 → SearchSelect·점유권 → 스모크) — `docs/superpowers/plans/2026-07-09-picker-korean-search.md`.
- Task 1(BE): `DirectoryUserOut.korean_dept` 추가 + directory/eligible-assignees·approvers/editors 4개 엔드포인트가 korean_name·korean_dept 실값 전달하도록 보강(스키마 미신설, 미전달 지점만 채움). pytest 492 GREEN·ruff 0.
- Task 2(FE lib): api.ts `DirectoryUser.korean_dept?` + `EligibleAssignees.users` 항목에 `korean_name?, korean_dept?` 추가. korean-dept.ts 신규 함수 3개 + import/interface 정리(`deriveDeptKoreanKeywords`, `buildAssigneeOptions`, `buildDepartmentOptions`, `SelectOption` 신규). TDD 3개 describe 추가(테스트 150 GREEN·lint 0에러·무관 warning 1 허용)
- Task 3(FE PrincipalPicker+어댑터): `PrincipalOption`에 `koreanName`(유저)·`koreanKeywords`(부서) 추가, 검색 필드 유저=이름+한글이름+아이디/부서=부서명+한글그룹명, 행 표시는 `lang` 연동(반대 언어 괄호 보조). `MockUser.korean_name?` 추가 + 어댑터 6곳(collaborators-panel·approvers-panel·approver-manager·create-map-dialog·groups-panel·group-detail)에 `korean_name` 배선, dept를 넘기는 4곳(collaborators-panel·create-map-dialog·groups-panel·group-detail)에 `deriveDeptKoreanKeywords` 전달. lint 0·vitest 150·build 통과.
- Task 4(FE SearchSelect·점유권): 담당자/부서 옵션 구성 3화면(node-summary-modal·bpm-attribute-picker·group-bulk-modal)을 `buildAssigneeOptions`/`buildDepartmentOptions` 호출로 교체(사전 filter·value·onChange 불변), 점유권 이전 다이얼로그는 `filterByQuery`(name→koreanName→id)+`formatRosterName` lang 연동으로 전환. vitest 150·lint 0에러·build 성공.
- Task 5(브라우저 스모크+최종 게이트): `pw-smoke-picker-korean.mjs` 신규(협업자 피커: 한글이름 검색·초성 ㅈㅎㅈ·한글그룹 부서 top-pin·ko 토글 primary, 9/9 PASS, 첫 실행부터 수정 없이 GREEN) + 기존 스모크 3종 회귀(member-card 11/11·korean-names 17/17·korean-dept 5/5) 전부 PASS. 최종 게이트: pytest 492·ruff 0 / lint 0에러(무관 warning 1)·vitest 150·build 성공. 점유권 이전 필터 전환은 vitest+수동 확인 대상(스모크 제외, 브리프 명시).
## 2026-07-09 — 멤버 카드 아이콘 톤·조직 레벨 아이콘 설계 (worktree-ui-improvement-4)
- 멤버 카드 아이콘 ink-muted 회색·왼쪽 패딩 6px + `LEVEL_ICONS` 건축+조각 세트(Landmark/Building2/Building/House/Puzzle) 설계 확정 — 비주얼 컴패니언 시안 선정(톤 3안 중 C·세트 3안 중 C).
- 구현 계획 작성 — 3태스크(톤·패딩 / 아이콘 세트 / :3002 시각 검증), `docs/superpowers/plans/2026-07-09-member-card-icons.md`.
- 변경 1 구현 — 아이콘 컨테이너 `text-ink-muted`·행 패딩 `pl-1.5`(스켈레톤 동기화). vitest 147·lint 0에러.
- 변경 2 구현 — `LEVEL_ICONS`=[Landmark, Building2, Building, House, Puzzle]·`Boxes` import 제거. vitest 147·lint 0에러.

## 2026-07-09 — 자동 로그인 로딩 최소 노출 0.6s (feat/auto-login-min-visible)
- `/login` silent 시도 전 `AUTO_LOGIN_MIN_VISIBLE_MS=600` 최소 대기(모듈 로드와 병렬) — 로딩 화면 순간 플래시 방지, 리다이렉트 중 화면 유지로 Keycloak 왕복 내내 이어져 보임. 수동 버튼·일반 페이지 로드에는 지연 없음. vitest 148·lint 0에러·build·딥링크 스모크 PASS.

## 2026-07-09 — SSO 전체 로그아웃 패널 (feat/logout-sso-panel)
- 로그아웃 직후 /login 카드 아래 1회성 패널 — "모든 세션 로그아웃" 버튼이 Keycloak `end_session` 호출(같은 realm 다른 앱 세션도 종료, 문구 명시). removeUser 직전 id_token을 `bpm.ssoLogoutHint`로 확보해 확인 화면 없이 즉시 종료(id_token_hint). 자동 재로그인(소비형 억제)은 유지 — 사용자 결정. deploy.md §1 post-logout URI 실사용 명시. vitest 148·lint 0에러·build·딥링크 스모크 회귀 PASS. 서버 실검증 케이스 ⑥ 추가(스펙 3차 라운드).

## 2026-07-09 — 비공개 맵 403 안내 게이트 (feat/login-polish-403-gate)
- `ApiError(status)` 신설(api.ts, 메시지 형식 유지) — 에디터 초기 로드 403이면 raw 에러 문자열 대신 Lock 아이콘 안내 모달(단일 확인 버튼, ConfirmDialog `cancelLabel` 옵셔널화) 표시, 확인/닫기 모두 홈 이동. i18n `mapAccess.*` en/ko. 스모크 `pw-smoke-map-403.mjs`(라우트 목 403) 4체크 + 딥링크 회귀 4체크 ALL PASS. vitest 147·lint 0에러·build OK.

## 2026-07-09 — 로그인 전환 폴리시·정상접근 자동 로그인 (feat/login-polish-403-gate)
- `AuthLoadingScreen` 신설(브랜드+스피너, item-fade) — `/login` silent 시도 중 카드 플래시 제거, AuthGate 로딩·returnTo 대기 화면 통일. 억제 플래그를 소비형으로 변경(`consumeAutoLoginSkip`) — 로그아웃/실패 직후 1회만 카드, 이후 정상접근은 세션 있으면 자동 로그인(모듈 캐시 1회 판정, StrictMode 안전, 실패 시 플래그 원복).

## 2026-07-09 — 자동 로그인+딥링크 복원 구현 (feat/auto-login-deeplink)
- Task 3: `pw-smoke-login-deeplink.mjs` — dev 모드 딥링크(/maps/2)→/login→dev 로그인→원맵 복귀·consume·unsafe(//evil.com) 거부 4체크 ALL PASS. Keycloak prompt=none 경로는 서버 배포 후 3케이스 실검증 필요(스펙 §검증).
- Task 2: silent 로그인 배선 — `/login` mount 시 `signinRedirect({prompt:"none"})` 자동 1회(시도 직전 skip 플래그로 루프 차단), AuthGate가 `login_required`를 에러 아닌 "카드로" 신호로 처리 + returnTo 저장/복원(복원 대기 중 홈 플래시 방지), DevGate·dev 픽에도 동일 복원, 로그아웃 시 자동 재로그인 억제. vitest 145·lint 0에러·build OK.
- Task 1: `frontend/src/lib/auth-return.ts` 신설 — returnTo 저장/peek/consume(내부 경로 검증, open redirect 방지) + autoLoginSkip 플래그. vitest 7케이스 TDD(145 전체 통과).

## 2026-07-09 — 자동 로그인+딥링크 복원 설계 (feat/auto-login-deeplink)
- 딥링크 진입 시 Keycloak SSO 세션 있으면 버튼 없이 자동 로그인 후 원래 페이지 복귀, 세션 없으면 현행 로그인 카드 유지(prompt=none 사전 체크) — 설계 승인·스펙 저장(`docs/superpowers/specs/2026-07-09-auto-login-deeplink-design.md`). 로그아웃 직후 자동 재로그인 억제 플래그 포함. 구현 계획: `docs/superpowers/plans/2026-07-09-auto-login-deeplink.md`(태스크 3 — 헬퍼 TDD·배선·스모크).

## 2026-07-09 — AD 동기화 비활성 제외 + 프룬 (worktree-ui-improvement-2)
- 비활성(uac 0x2) 계정 동기화 제외 + 전체 동기화 시 스테일 source=ad 행 프룬 설계 — `docs/superpowers/specs/2026-07-09-ad-sync-inactive-exclusion-design.md`.
- 구현 완료(TDD): to_employee_fields 비활성 제외, sync_all 프룬(빈 스캔 가드·local 보존, 단일 DELETE)·SyncSummary/응답/탭 메시지에 purged 추가 — 신규 테스트 3종, pytest 492·ruff 0·lint 0·vitest 138·build 통과.
- 멤버 카드 개선 설계: 아이콘 확대(접힌 카드 높이)·유저 이름 한/영 토글+펼침 반대말 필·그룹 이름 해석 + **부서 매핑 기능 철회**(모달·PUT·필터 삭제, 관찰용 열·툴팁 유지, 툴팁 1열화) — `docs/superpowers/specs/2026-07-09-member-card-korean-names-design.md`.
- 멤버 카드 구현 계획(4 task: BE directory+철회 → FE 철회·툴팁 1열 → 카드 아이콘·토글·필 → 스모크) — `docs/superpowers/plans/2026-07-09-member-card-korean-names.md`. employees.korean_name/korean_dept·임포트는 유지 확인 완료.
- Task 1(BE): `GET /api/directory` 유저 항목에 `korean_name` 추가(TDD, 신규 테스트 1종), `PUT /api/admin/departments/korean-dept`+`DeptKoreanDeptIn/Out`+매핑 테스트 5종 삭제(관찰용 `test_admin_users_include_korean_fields`는 유지). `test_ad_active.py`의 directory 최소필드 화이트리스트에 `korean_name` 반영. pytest 488·ruff 0.
- Task 2(FE): 부서 매핑 UI 철회 — `dept-korean-modal.tsx` 삭제, `department-table.tsx`의 `needsOnly` 필터·`mappingDept`·행 더블클릭/cursor-pointer 제거(관찰용 `dept-kr-cell`·`RosterHover`·`dept-row`는 유지), `api.ts` `setDeptKoreanDept`·`korean-dept.ts` `shouldFlagDeptMapping`(+테스트)·i18n 7키 삭제(`admin.deptKrCol`은 유지). 명단 툴팁을 `flex-wrap`→`flex-col` 1열로 변경. `pw-smoke-korean-dept.mjs`에서 모달/필터 시나리오 제거하고 시드→탭 진입→2필→호버 툴팁만 유지(필터 소실로 대상 행은 스크롤 폴백 탐색). vitest 137·lint 0·build 성공, 잔재 grep 0.
- Task 3(FE): `map-detail-card.tsx` 멤버 카드 — 아이콘 12→22px 확대(Me 뱃지 Hand 20+ME 9px 세로 스택, 컨테이너 `h-9 w-9` 중앙정렬), 유저 이름 `lang` 토글(ko=한글 우선, en=영문)+펼침 시 반대 언어 필(`data-id="member-alt-name"`), 그룹 행 id 노출을 `groupNameById`로 이름 해석, `MembersSkeleton` 아이콘 자리 `h-9 w-9`로 동기. `api.ts` `DirectoryUser.korean_name?` 추가. vitest 137·lint 0·build 성공.
- Task 4(스모크+게이트): `pw-smoke-member-card.mjs` 신규(admin.sys 소유 테스트맵 자동 생성+협업자·그룹 부여+한글이름 임포트 → Me 뱃지·en/ko 이름줄·펼침 alt 필·그룹명 해석) 11/11(cleanup 체크 포함). `pw-smoke-korean-names.mjs` 17/17, `pw-smoke-korean-dept.mjs` 5/5 회귀 통과. 최종 게이트: pytest 488·ruff 0 / vitest 137·lint 0(무관 파일 warning 1)·build 성공. 서버 기동 중 발견: 메인 dev.db엔 admin.sys가 소유·멤버인 맵이 없어(Me 뱃지 전제 불충족) 스모크가 테스트맵을 직접 생성하도록 설계 — 제품 결함 아님, 데모 시드 특성.
- 전체 브랜치 리뷰 반영: `sync_all` 프룬 가드를 `if raws:`→`if valid_ids:`로 강화(스캔이 비어있지 않아도 전원 제외면 프룬 스킵, 회귀 테스트 1종 추가) + `to_employee_fields`의 죽은 `is_active` 재계산 정리·`LDAP_USER_FILTER` 범위 주석·`docs/deploy.md` 프룬 백업 권고·`korean-dept.ts` 헤더 참조 수정·`test_ad_active.py` docstring 보정.

## 2026-07-09 — 임베드 프로브 리다이렉트 SSRF 차단 (main)
- 푸시 보안 리뷰 반영: `embed_probe.probe_embeddable`가 `follow_redirects=True`로 자동 추종하던 것을 **수동 추종(최대 5홉)**으로 교체 — 홉마다 스킴(http/https)·호스트 SSRF 가드(`_is_probe_refused_host`) 재적용. 외부 서버가 302로 루프백/메타데이터(169.254.169.254)를 가리켜 최초-URL 검사만 통과시키던 우회 차단. 리다이렉트로 스킴 변경(file:// 등)도 거부. pytest +2(481)·ruff 0.

## 2026-07-09 — 배포 문서·compose 동기화 (main)
- `docker-compose.yml`에 `AI_ENDPOINTS` 패스스루 추가(누락 시 서버 .env에 설정해도 컨테이너 미전달 — 배포 브레이커였음). `docs/deploy.md` §2에 AI env 블록(AI_ENDPOINTS 포함), §3에 AI 런타임 반영 방법 + **업그레이드 노트(`DROP TABLE IF EXISTS ai_chat_logs;` 1회, psql 명령 포함)** 추가.

## 2026-07-09 — AI 다중 엔드포인트+모델 .env 구성 (feat/ai-multi-endpoint)
- `AI_ENDPOINTS`(JSON 배열, .env 전용 — 토큰 시크릿) 신설: 항목당 name·base_url·token·model(기본)·models(노출 목록, 비우면 /models 자동 조회). 비우면 기존 단일 AI_BASE_URL 폴백(하위호환). 모델 추가/삭제는 .env 수정+재기동.
- `ai_client.py`: `AiEndpoint`/`get_ai_endpoints`(검증 포함)/`resolve_endpoint` — 모델 선택자 `"이름::모델"`로 엔드포인트 라우팅(무접두는 첫 엔드포인트, 구형 하위호환), `list_models`는 전 엔드포인트 합산(다중이면 `이름::모델` id, 단일이면 종전 형식·개별 조회 실패는 기본 모델 폴백). 채팅 셀렉터는 `이름 / 모델`로 표시(전송 값 원본).
- 검증: pytest 471(신규 7 — 파싱/검증·라우팅·선택 엔드포인트 호출·합산·단일 형식 유지·조회 실패 폴백)·ruff 0·vitest 120·lint 0·build.

## 2026-07-09 — AI 챗 서버 저장 구현 (feat/ai-chat-server-history)
- Task 1: 세션/메시지 모델 + 계약 확장(AiChatRequest/AiProposal session_id, Out 스키마 4종).
- Task 2: `/ai/chat` write-through — `derive_chat_title` 헬퍼(`app/chat_history.py`) + 라우터에 세션 소유/맵 검증(AI 호출 전 404 fail-fast)·질문/답변 2행 적재를 AI 실패 시 미적재로 한 트랜잭션 처리. pytest 457·ruff 0.
- Task 3: 신규 라우터 `app/routers/ai_sessions.py` — `GET /api/ai/chat-sessions[?map_id=]`(맵 이름·메시지 수, 소프트삭제 맵 제외, 본인 것만)·`GET .../{id}/messages?before=&limit=`(최신순으로 떠서 has_more 판정 후 오름차순 페이지)·`DELETE .../{id}`(ORM cascade로 메시지 동반 삭제, 204). 전부 본인 소유만(타인 404). pytest 462·ruff 0.
- Task 4: 보존 상한 3종을 `app_settings`(런타임 조정, 기본 세션 20/메시지 200/기간 180일)로 노출 — `chat_history.py`에 `prune_chat_session_messages`(세션 내 메시지 상한, 오래된 순 삭제)·`prune_map_chat_sessions`(사용자×맵 세션 상한, ORM delete로 메시지 cascade)·`prune_expired_chat_sessions`(기간 만료, 목록 조회 시 기회적 실행) 추가. `/ai/chat` 적재 직후 메시지·세션 상한 훅업, `GET /ai/chat-sessions` 진입 시 만료 정리 훅업. PUT `/admin/app-settings`가 3필드(1–200/10–2000/7–3650) 부분 갱신 수용. pytest 466·ruff 0.
- Task 5: `ai_chat_logs` 흡수·제거 — `AiChatLog` 모델·`AI_CHAT_LOG_KEY`/`is_ai_chat_log_enabled`·`AppSettingsOut/Update.ai_chat_log_enabled`·`/ai/chat`의 구 로깅 write 블록·구 로깅 테스트 2종 삭제. `_to_out`은 관리 4키 중 최신 갱신 행 기준으로 `updated_by/updated_at` 산출. **서버 배포 시 `DROP TABLE ai_chat_logs;` 1회 수동 실행 필요**(더 이상 코드가 쓰지 않는 잔여 테이블). pytest 464·ruff 0.
- Task 6+7: 프론트 서버 세션 전환 — `chat-sessions.ts` 재작성(뷰모델 `ChatMessage`{id/role/content/at}·`createLocalMessage`(음수 낙관 id)·`toChatMessage`, localStorage 스토어 폐기)·`api.ts`에 `getAiChatSessions/getAiChatMessages/deleteAiChatSession`+`aiChat(session_id)`+`AiProposal.session_id`. `AiChatPanel` 코어를 서버 세션 로딩·전송·커서 페이징으로 전환(`mapId` prop, 현재 맵 세션 드롭다운·지연 새 대화·상단 스크롤 페이징·404 폴백·인라인 재시도), 세션 한도/용량바/카운터 제거. i18n 5키 삭제·3키 추가. 편차: 브리프의 `set-state-in-effect` disable 4개가 React Compiler 컴포넌트 bail로 전부 unused 경고 → 제거(0/0 유지). vitest 120·lint 0·build.
- Task 8: 히스토리 확장 — 드롭다운에 "다른 맵 대화" 섹션(맵 이름 접두 + 이동, 접기/펼침) 추가, 현재 맵 목록 항목에 삭제 버튼(`ConfirmDialog` 재도입) 추가, 다른 맵 세션은 읽기전용(입력·전송·빠른칩 비활성 + 안내 배너의 "이 맵 열기"로 이동), `AiChatPanelProps.initialSessionId`+`/maps/{mapId}?aiChat=<sessionId>` 딥링크로 패널 자동 오픈+세션 활성. i18n 6키 추가(EN/KO). vitest 120·lint 0(1 pre-existing warning)·build.
- Task 9: 관리자 설정 패널 — Q&A 적재 토글(+activeNotice)을 보존 상한 3필드(대화 수/메시지 수/보관 일수) 편집 카드로 교체. `AppSettings`/`putAppSettings` 타입에서 `ai_chat_log_enabled` 제거, 3필드 추가. 저장 전 로컬 범위 검증(1–200/10–2000/7–3650, 서버 422 이전 차단). i18n 5키 삭제 + 8키 추가(EN/KO). 팁 관리 섹션 무변경. vitest 120·lint 0(1 pre-existing warning)·build.
- Task 10: 기본 팁·매뉴얼 동기화 — `DEFAULT_AI_CHAT_TIPS` 구식 2건(4개 제한·40개 캡) 교체, `backend/app/manual.md`·`docs/manual/user-manual-{ko,en}.md` §AI 도우미를 서버 저장·다른 맵 대화·관리자 보존 상한 문구로 갱신(날짜 2026-07-09), `docs/manual/admin-manual-{ko,en}.md` §12에서 Q&A 적재 토글 설명을 보존 상한 3키(표)와 "항상 서버 저장(사용자·맵 단위, 본인만 조회)" 설명으로 교체 + 콘솔 지도 "AI 챗" 행 설명 갱신. pytest 7/7(test_app_settings.py), 잔재 grep 0.
- Task 11: 브라우저 e2e 스모크 + 전체 게이트 — 신규 `frontend/scripts/pw-smoke-ai-chat-history.mjs`(playwright-core + 시스템 Chrome, dev.db `SMOKE-` 세션 3종 시드) 13개 어서션 전부 PASS: 대화 바 자동 활성·현재 맵 2건/다른 맵 토글 1건·서버 페이징 30→(로딩 팁)→40·타맵 세션 포린 배너+입력 disabled+이 맵 열기·`?aiChat=` 딥링크 이동+자동 오픈·mocked `/ai/chat` 낙관 말풍선·삭제+새 대화 폴백·콘솔 에러 0. 제거된 UX(localStorage 4개 제한·용량바)를 테스트하던 구 스모크 `pw-smoke-ai-chat-sessions.mjs` 삭제(컨트롤러 승인). dev.db는 시드 정리 후 백업으로 원복(SMOKE 0행·ai_chat 테이블 없음·맵 12건). 게이트: pytest 464·ruff 0·vitest 120·lint 0(1 pre-existing warning)·build 성공.
- 최종 리뷰 반영: `fix(ai-chat): reload thread on retry + clear stale thread on switch` — 메시지 로딩 effect deps에 `messagesReload` 추가(Retry 버튼이 목록뿐 아니라 활성 스레드도 재시도), non-null 분기 진입 시 `setMessages([])`로 스테일 스레드 즉시 클리어(세션 전환 실패 시 이전 세션 스레드가 새 제목 아래 오귀속되던 버그 해소). 스모크에 체크 9(a/b/c) 추가 — 실패 경로에서 historyError+Retry 노출, 오귀속 없음(li 0개), Retry로 30개 복구. 16/16 PASS. 게이트 재확인(vitest 120·lint 0·build).
- 드롭다운 삭제 버튼 호버 노출 — 대화 목록 항목의 삭제 버튼을 행 호버 시에만 표시하고, 활성 대화는 같은 슬롯에 체크 표시를 두었다가 호버 시 삭제 버튼으로 크로스페이드(duration-150). 스모크 체크 ⑦ 셀렉터를 행(.group) 기준 hover→클릭으로 보정. 스모크 16/16 재확인·vitest 120·lint 0·build.

## 2026-07-08 — AI 챗 서버 저장 + 맵 단위 히스토리 설계 확정 (feat/ai-chat-server-history)
- 브레인스토밍으로 결정 확정: 서버 DB 저장(정규화 2테이블 + `/ai/chat` write-through), 대화 귀속 사용자×맵(다른 맵 대화는 열람만+이동 버튼), 보존 개수+기간 혼합(app_settings 상한 3종), 히스토리 목록형 UX(4개 제한·LRU 제거), localStorage 마이그레이션 없음, ai_chat_logs 흡수·제거. 스펙: `docs/superpowers/specs/2026-07-08-ai-chat-server-history-design.md`.
- 구현 계획 작성: 11개 태스크(백엔드 모델→write-through→조회 API→보존 상한→로그 제거→프론트 API→패널 코어→히스토리 확장→설정 패널→매뉴얼→e2e 스모크), TDD·커밋 단위 명세. 플랜: `docs/superpowers/plans/2026-07-08-ai-chat-server-history.md`.

## 2026-07-08 — AI 계약 URL 갭 보완 + 증분편집(ops) 확장 (feat/ai-incremental-edit)
- URL 갭: `AiNodeAttributes`에 url/url_label 추가(NodeIn 동일 제약), `ai_prompt` 직렬화에 `링크=` 노출 + 규칙 ⑦(재생성 시 에코 보존), `aiNodeToGraphNode` url 매핑 — graph 재생성 시 기존 노드 URL 소실 해소.
- 증분편집 확장: ops 신규 액션 3종 — `disconnect`(연결 끊기)·`set_edge_label`(분기 라벨)·`set_desc`(노드 설명) + 사이 삽입 패턴(add+disconnect+connect) 프롬프트 예시. **set_attr 부분 갱신 시맨틱**(None=유지·""=지움 — 기존엔 생략 필드가 ""로 덮여 소실되던 잠재 버그 해소). 라우터 미지 참조 표면화에 신규 액션 반영. 매뉴얼 3종(번들·user ko/en) 증분 편집 능력 갱신.
- 검증: pytest 451(신규 6)·ruff·vitest 134·lint 0·build. 브라우저 e2e 14/14(AI 응답 playwright 모킹 — 사이 삽입/disconnect/엣지 라벨/set_desc/url만 set_attr 후 기존 담당자 보존 실증/graph 재생성 url 에코/베이스라인 원복).

## 2026-07-08 — 임베드 체크: 차단 사이트 폴백 카드 즉시 표시 (feat/embed-check)
- 보안 리뷰 반영: 프로브가 루프백·링크로컬(메타데이터)·비유니캐스트 대상 거부(사설 RFC1918은 기능 목적상 허용 유지, httpx2는 저장소 표준이라 교체 제안 기각). pytest +1(445).
- `GET /api/embed-check`(신규 embed_probe·routers/embed) — 대상 URL의 X-Frame-Options/CSP frame-ancestors를 서버가 판독(httpx2, 4s, 리다이렉트 추종), 미리보기 패널이 차단 verdict 수신 시 크롬 오류 화면 대신 기존 폴백 카드를 즉시 표시(판정 불가는 기존 동작 유지). pytest +6(444)·vitest 134·build 클린, E2E(google→카드/wikipedia→iframe) PASS. SSRF 노트: 인증 전용·http(s)만·불리언만 노출.
## 2026-07-09 — 유저 한글이름 필드 + 일괄 등록 모달 설계 (worktree-ui-improvement)
- P2 최종 리뷰 반영: 이름만 임포트(dept 미기입) 시 부서 탭 매핑으로 채운 `korean_dept`를 소거하지 않도록 수정(빈 dept는 미기입으로 취급) + 회귀 테스트 1건, 추출 드롭다운 Esc/외부클릭 닫힘(투명 backdrop, 문서 리스너 없이), dept 스모크에 "매핑 후 단일 필" 직접 검증 추가, 설계 문서 파싱 실패 문단을 배열/객체 자동판별로 갱신 — pytest 454(신규 포함) PASS·ruff clean.
- 부서 매핑·추출 옵션 구현 계획 작성(5 task: BE PUT/필드 → lib → 부서 탭 UI → 스플릿 버튼 → 스모크) — `docs/superpowers/plans/2026-07-09-dept-korean-mapping.md`.
- 부서 한글명 매핑 관리(부서 탭 필터·korean dept 열·명단 툴팁·더블클릭 매핑 모달·전원 덮어쓰기 PUT) + 유저 추출 옵션(스플릿 버튼 4종) 설계 확정 — `docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md`.
- 조회 도구 응답 배열 포맷 임포트 + `korean_dept` 컬럼 신설 — 루트 배열([{userId,status,name,dept,…}], not_found/error 무시)·객체 맵 양쪽 자동 판별, PUT entries가 {name,dept} 객체로 확장(양쪽 max_length 200), 테이블 korean dept 열 추가. 스모크 15/15(배열 1차·맵 충돌 경로)·pytest 447·vitest 144·build 통과.
- AD 미제공 한글이름을 `Employee.korean_name`으로 추가하고 어드민 Employees 탭에서 JSON 임포트(skip/overwrite 충돌 확인·미보유 목록 다운로드)하는 설계 확정 — `docs/superpowers/specs/2026-07-09-user-korean-name-import-design.md`.
- 구현 계획 작성(6 task: BE 컬럼/엔드포인트 TDD → FE 파서 lib/모달/탭 wiring → 브라우저 스모크) — `docs/superpowers/plans/2026-07-09-user-korean-name-import.md`.
- Task 1 DONE: `korean_name` 컬럼 TDD 구현(2/2 테스트 통과·440 tests 회귀) — models.py Employee/schemas.py EmployeeOut 노출·AD _upsert 보존 검증.
- Task 2 DONE: `PUT /api/employees/korean-names` 엔드포인트 TDD 구현(5개 신규 테스트·445 tests 통과) — skip/overwrite 모드·미보유 목록 반환·sysadmin 권한 검증.
- Task 3 DONE: FE 파서·분류·다운로드 lib TDD 구현(6개 신규 테스트·140 tests 통과·0 lint 에러) — parseKoreanNamesJson/classifyKoreanNames/buildMissingIdsJson 순수함수·EmployeeRow korean_name 필드.
- Task 4 DONE: FE API 클라이언트·i18n·모달 컴포넌트(api.ts KoreanNamesImportSummary/importKoreanNames + i18n 14 keys en/ko + korean-name-modal.tsx 모달·3단계·무한스크롤 충돌 툴팁 + lint 0 err·vitest 140 pass).
- Task 5 DONE: FE Employees 탭 wiring(korean_name 열·Add Korean Names 버튼·모달 마운트, lint 0 err·vitest 140 pass·build PASS).
- Task 6 DONE_WITH_CONCERNS: 브라우저 스모크 11/12(신규/충돌 skip·overwrite·다운로드·테이블 반영 전부 PASS) — `pw-smoke-korean-names.mjs`. 기존 DB ALTER 자동보강 실증(레거시 dev.db 복사→재기동→401행 전부 `korean_name:""`). 발견: `korean-name-modal.tsx` 충돌 툴팁이 `<p>` 안에 `<div>`를 중첩해 콘솔 hydration-nesting 경고 2건(제품 결함, 미수정 — 컨트롤러 판단 대기). 최종 게이트 4종(pytest 445·ruff·lint·vitest 140·build) 전부 PASS.
- Task 6 후속 fix(컨트롤러 승인): `korean-name-modal.tsx` 충돌 문구 래퍼 `<p>`→`<div>`로 div-in-p 중첩 제거 — 스모크 12/12 PASS(콘솔 에러 0), lint 0 err·vitest 140·build PASS.
- 리뷰 후속: 스모크 헤더에 재실행 전제(DB `korean_name` 리셋) 주석 추가 — `pw-smoke-korean-names.mjs`, lint 0 err.
- 전체 브랜치 최종 리뷰 반영: 툴팁 호버 갭 제거(`mt-1`→패딩 래퍼)로 flaky 닫힘 해소, `entries` 값 max_length=200 서버 검증 추가(Postgres VARCHAR(200) DataError 500 방지, 422 테스트 1건), BE 테스트 헬퍼 `_korean_name_of`→`_get_korean_name` 리네임, FE any 캐스트 제거(`Object.entries(data as Record<string, unknown>)`), 파일 읽기 실패 시 에러 표시(`onFile` try/catch), ko 조사 띄어쓰기·en 타이틀 대문자 통일, Cancel 버튼 `data-id` 추가, 스모크에 툴팁 유지 체크 추가(13/13 PASS) — pytest 446·ruff·lint·vitest 140·build 전부 PASS.
- P2-Task 1 DONE: AdminUserOut korean 필드 + PUT /api/admin/departments/korean-dept 일괄 갱신 TDD 구현(6개 신규 테스트·453 tests 통과) — schemas.py DeptKoreanDeptIn/Out 2클래스 추가·admin.py 엔드포인트 등록·AdminUserOut korean_name/korean_dept 필드 노출·sysadmin 권한 검증.
- P2-Task 2 DONE: FE korean-dept lib + api TDD 구현(8개 신규 테스트·152 tests 통과·0 lint errors) — api.ts AdminUser korean_name/korean_dept 필드 + setDeptKoreanDept 함수·korean-dept.ts getDeptMembers/aggregateDeptKoreanDepts/shouldFlagDeptMapping/formatRosterName/buildExportIds 순수함수·vitest 모든 엣지케이스 커버.
- P2-Task 3 DONE: 부서 탭 UI 개편(매핑 필요 필터·korean dept 열·인원수 호버 명단 툴팁·행 더블클릭 매핑 모달) — department-table.tsx 확장·dept-korean-modal.tsx 신규·i18n 8키 en/ko, lint 0 err(불필요한 exhaustive-deps disable 제거)·vitest 152 pass·build 통과.
- P2-Task 4 DONE: FE 스플릿 버튼 4옵션 추출(missing/deptSample/random50/all) — korean-name-modal.tsx split button·i18n 4키 en/ko + buildExportIds·EXPORT_FILENAMES·exportMenuOpen state·menu 드롭다운, lint 0 err·vitest 152 pass·build 통과.
- P2-Task 5 DONE: 브라우저 스모크(부서 매핑 신규 9/9 `pw-smoke-korean-dept.mjs` + 추출 메뉴 체크 추가 후 17/17 `pw-smoke-korean-names.mjs`) 전부 첫 실행 PASS + 최종 게이트(pytest 453·ruff·lint 0 err·vitest 152·build) 전부 통과. 발견 결함 없음.

## 2026-07-07 — feat/url-viewer 머지 (main)
- 머지 후속: 스모크가 초안 버전으로 전환 후 진행 — 상태 배너 기능이 게시본을 기본 열람으로 바꿔 스모크 전제가 깨진 것 보정.

## 2026-07-07 — 에디터 읽기전용 배너 재편 + 저장 상태 필/실패 배너 (feat/editor-status-banner)
- 읽기전용 배너를 사유별 구조(톤·아이콘·굵은 타이틀+설명)로 재편 — 뷰어(중성/Eye) > **타인 점유(경고/PencilLine, 점유자 이름 디렉터리 해석 "이름 (id)" + 승인 탭 요청 안내)** > 게시(액센트/BadgeCheck) > 만료(중성/Archive, 신규 분기) > 승인(경고/CircleCheck) > 결재 중(경고/Hourglass). 상태 타이틀은 한/영 모두 영어 고정(Pending approval/Approved/Published/Expired). 헤더 점유 칩도 이름 해석 적용. 만료가 "결재 진행 중"으로 나오던 기존 미분기 해소.
- 저장 상태 표시를 필 형식으로 — 저장 중(중성)·저장됨(green/added·체크)·저장 실패(red/error·경고 아이콘, 짧은 라벨). **실패 상세는 상단 error 배너로 노출(err.message + 재시도 힌트), 다음 저장 성공까지 유지**(`saveErrorDetail`). 구 키 editor.readonly.*(5종)·editor.saveError 제거, 신규 키 13종(en/ko).
- 검증: vitest 122·lint 0·build·브라우저 스모크 18/18(점유자 본인 무배너/타인 점유 이름 배너/뷰어/게시/만료 톤·PUT 차단으로 실패 필+상세 배너 유지→수동 저장 성공 시 해소·콘솔 0). dev.db 원복 확인.

## 2026-07-07 — 에디터 UI: 상태별 워터마크 + 인스펙터 서브프로세스 지정 카드 (main 직접)
- 워터마크: 게시본 PUBLISHED(액센트)·만료본 EXPIRED(회색 `text-ink-tertiary`)·그 외 READ ONLY — 상태 텍스트 한/영 모두 영어 고정(`editor.watermarkPublished/Expired`).
- 인스펙터 속성 탭(빈 상태)·맵 탭에 `SubprocessInspectorCard` 신설 — 지정 상태 뱃지(영어 고정 Designated/Not designated)+어트리뷰트+연결 절차 노트("지정은 다른 맵이 이 맵을 임베드하기 위한 절차"). 버튼(지정/수정/해제)은 **게시 버전 열림 + 오너·sysadmin**일 때만 활성, 비활성 시 사유 노트 표시(`inspector.spNeedPublishedOpen/spOwnerOnly`). 지정 모달은 설정 화면 패널에서 `SubprocessDesignationModal`로 추출해 공용화(동작 동일).
- 검증: vitest 122·lint 0·build·브라우저 스모크 18/18(PUBLISHED/EXPIRED 워터마크·카드 뱃지/노트·게시본 활성·만료본 비활성+사유·모달 개폐·지정 반영·해제 복원·콘솔 0). 노트: 만료본 상단 읽기전용 배너가 "결재 진행 중" 문구로 나오는 기존 미분기(statusNoticeKey에 expired 분기 없음)는 범위 외 — 후속 후보.

## 2026-07-07 — AI 챗 다중 대화: 최대 4개 + 이전 대화 열기 + 최오래 닫기 확인 (feat/ai-chat-sessions)
- `chat-sessions.ts`(신규): 세션 스토어 파싱/직렬화·구 단일배열 포맷 자동 이행·최오래 세션 선정·제목 파생(첫 사용자 메시지 40자)·세션당 40개 캡 — 테스트 14. localStorage 키 `bpm.aiChat.v{versionId}` 유지.
- `AiChatPanel`: 대화 전환 바(이전 대화 드롭다운 최신순·활성 체크·카운터 n/4 + 새 대화 버튼). 5번째 새 대화 → ConfirmDialog(최대 4개 안내 + 가장 오래전에 연 대화 "닫힘" 뱃지) → 확인 시 최오래 퇴출+새 대화. 빈 대화 재사용(빈 세션 중복 방지), 응답 대기 중 전환해도 원 대화에 append, 버전 전환 시 교차 저장 가드. i18n 5키(en/ko).
- 검증: vitest 119·lint 0 errors·build PASS·브라우저 스모크 18/18(`frontend/scripts/pw-smoke-ai-chat-sessions.mjs` — 드롭다운/전환/한도 모달/취소 유지/퇴출/localStorage/레거시 이행/콘솔 에러 0).
- 후속(사용자 검토): 새 대화 버튼 ↔ 폰트 툴(−T＋) 자리 교환 — 새 대화는 창 헤더에 아이콘만(트리거는 `onRegisterNewChat` ref 등록), 폰트 툴은 대화 전환 바 우측(`onFontScaleChange`, 배율 상태는 페이지 유지). 창 최상단 바 아이콘 호버 툴팁 박스 `IconTip` 신설 — 이름변경·새대화·내보내기 + ScopeWindow 최소화/최대화/닫기 공통 적용(native title 제거). 스모크 21/21.
- 문서 정리: 매뉴얼 5종 갱신(번들 `backend/app/manual.md` §5 + user/admin ko·en — 다중 대화 4개·타임스탬프·청킹 로딩·입력 링·용량바·관리자 "AI 챗 설정" 12장 신설). 완료 트래커 4종 삭제(SCREEN-NEW-PAGES·SCREEN-REDESIGN-COMPARE·SCREEN-REDESIGN-EDITOR·SUBPROCESS-DESIGNATION — 전문은 git 이력). 트래커 잔여 후속 메모: 에디터 아웃라인 단축키 셋 정립·노드 정보 토글 카드 인스펙터 이전(에디터 D), 매뉴얼 읽기테마 범위·피드백 열람 정책(신규화면), U5 노드 표시필드 영속 복귀 현상(서브프로세스).
- 후속 3: 기능 팁 20종 확대 + 설정 관리 — 기본 팁을 서비스 전반 FAQ 20종(`app/app_settings.py DEFAULT_AI_CHAT_TIPS`)으로 DB 관리 전환. `GET /api/ai/tips`(전 사용자)·`PUT /api/admin/app-settings` 부분 갱신(`ai_chat_tips`, 빈 목록=기본 복원, 팁당 200자·최대 50개). 설정 "AI 챗" 탭에 팁 편집기(한 줄당 1개, 개수 카운터). 패널은 서버 팁 조회(실패 시 i18n 5종 폴백). 잔여 링 숫자는 회색톤(text-ink-tertiary)으로. 검증: pytest 433·vitest 122·lint 0·build·스모크 41/41(커스텀 팁 저장→채팅 노출→기본 복원 e2e).
- 후속 2: ① 입력 잔여 링(퀵칩 행 우측, instruction 2000자 대비 — 75% 주의 amber·90% 경고 error, 잔여 카운트+호버 툴팁, textarea maxLength) ② 세션 저장 용량 진행바(대화 전환 바 아래, 세션당 40개 캡 대비 동일 임계색) ③ 메시지 타임스탬프(`ChatMessage.at`, KST MM-DD HH:mm 노출, 저장은 시간 역순 `order:"desc"` — v2/레거시 파싱 호환) ④ 청킹 로딩(최근 12개 먼저, 스크롤 상단 도달 시 스피너+기능 팁 5종 노출 후 이전 청크, 스크롤 위치 보존) ⑤ AI 챗 Q&A DB 적재 토글 — 백엔드 `app_settings`(KV)+`ai_chat_logs` 테이블, GET/PUT `/api/admin/app-settings`(sysadmin), `ai_chat`서 설정 ON일 때 질문/답변/시간/사용자 적재(테스트 기간 ON 예정), 설정 콘솔 "AI 챗" 탭 토글 패널. 검증: pytest 430·vitest 122·lint 0·build·스모크 36/36.
## 2026-07-07 — URL 라벨 + 필 입력 + 서브프로세스 지정 URL 설계 (feat/url-viewer)
- 설계 스펙: 노드 url_label(액션 바 버튼 텍스트 대체·호버 열기 아이콘), 인스펙터/모달 공용 UrlLabelField 2행 필(URL X=동반 삭제·라벨 X=라벨만), subprocess는 지정 단계 sp_url/sp_url_label(호스트 수정 불가) — `docs/superpowers/specs/2026-07-07-url-label-design.md`. 풀스택(DB 컬럼 3·API·프론트) 사용자 확정.
- 스펙 보정(사용자 검토): CSV url_label 컬럼 추가 — URL 없는 라벨은 에러 없이 무시 + 임포트 전 서머리에 무시 건수 표기.
- 구현 계획 작성(Task 1~7: 백엔드 컬럼·캐스케이드 → 프론트 배선 → UrlLabelField → 액션 바 라벨 → 지정 모달 → CSV → 스모크): `docs/superpowers/plans/2026-07-07-url-label.md`.
- Task 1: 백엔드 — nodes.url_label·process_maps.sp_url/sp_url_label + 캐스케이드 validator + refs 동봉 (pytest 430).
- Task 2: 프론트 배선 — NodeData.urlLabel·spUrl/spUrlLabel, 그래프 왕복(toAppNodes/buildGraph)·injectSubEnds 주입.
- Task 3: UrlLabelField — 인스펙터·편집 모달 공용 2행 필 편집기(URL X=동반 삭제, 라벨 X=라벨만) + 스모크 셀렉터 이행.
- Task 3 fix: 모달 isDirty·navSaveAndGo에 url/urlLabel 포함 — 칩 내비 시 URL 변경 유실 방지.
- Task 4: 액션 바 — 라벨 텍스트 대체·호버 열기 아이콘·subprocess는 spUrl/spUrlLabel 소스.
- Task 5: 지정 모달 URL·라벨 입력(http(s) 검증·라벨은 URL 있을 때만) + 호스트 인스펙터 읽기전용 URL 행.
- Task 6: CSV url_label 컬럼(선택) — URL 없는 라벨 무시+ignoredLabelCount 서머리 표기, 템플릿·AI 프롬프트 갱신.
- Task 7: 스모크 라벨 대체/원복 시나리오 + 전체 게이트(pytest 430·lint·vitest 117·build) 클린.
- 최종 리뷰 반영: 라벨 행 게이트를 url.trim()으로 — 공백 URL 레거시 행에서 라벨 유령 표시 방지.

---

## 이전 이력 compact (2026-06-11 ~ 2026-07-06) — 상세는 git history의 PROGRESS.md 참고

### 노드 액션 바 + 링크 미리보기 (2026-07-06 · feat/url-viewer)
- 단일 노드 포커스 시 하단 통합 액션 바(펼치기→링크 열기→그룹 나가기) + 우측 520px 슬라이드 iframe 미리보기(로딩 애니·임베드 차단 폴백). 구 버튼(그룹 모서리 나가기·ExpandToggleButton) 제거.
- `isHttpUrl` 가드로 노드 URL의 XSS 백로그 해소 + 보안 하드닝 `isSafePreviewUrl`(자기 오리진 URL 차단 — sandbox 탈출 벡터 봉쇄).
- 스모크 `pw-smoke-node-action-bar` 신설, 전체 게이트 클린.

### CSV 임포트 + 외부 AI 왕복 (2026-07-06)
- 노드 `url` 필드 신설(String 500, `db.py _ADDED_COLUMNS` 백필) + 인스펙터 URL 입력. 클라이언트 파싱(`csv-import.ts` — RFC4180·UTF-8/EUC-KR·자동 Start/End·Next≥2 decision 추론·dagre 배치·행 상한 500) 후 기존 `PUT /graph` 재사용.
- 진입 2경로: 새 맵 다이얼로그 "CSV로 시작" + 에디터 툴바 전체 교체(체크아웃 보유자·루트 스코프 한정, 교체 확인 모달·undo 1회).
- 외부 AI 왕복: 절차 추출용 AI 프롬프트 복사 버튼 + CSV 붙여넣기 textarea(```csv 펜스 관용). 테스트용 샘플 CSV 3종 `docs/samples/`.
- 최종 E2E+회귀 게이트: pytest 423·vitest 93·브라우저 라이브 체크 전부 통과.

### AI 챗 강화 1차 (2026-07-06 · feat/ai-chat)
- 대화 히스토리 버전별 localStorage 저장/복원 + '새 대화'(⚠️ 이후 07-08 서버 저장 구조로 대체됨).
- AI 근거를 번들 manual.md → 등록 매뉴얼 문서(manual_docs, ko 우선·30k자 가드)로 교체, 답변 마크다운 서식 규칙 신설.
- `_structure_hints` 확장 — 도달성·라벨 없는 분기·막다른 노드·BPM 속성 누락·중복 제목 사전탐지(환각 감소).

### 서브프로세스 지정(Designation) U1~U7 (2026-07-06 · worktree-feat+subprocess-detail)
- 오너가 맵 설정에서 지정해야 라이브러리 피커에 노출(Call Activity 소비 게이트). `ProcessMap` sp_* 컬럼 7개(+백필), PUT/DELETE `/maps/{id}/subprocess-designation`(오너/sysadmin·게시버전 409·부서 필수 422·해제 멱등+프리필).
- `subprocess_refs` 그래프 동봉 + 미지정/삭제 맵 resolve는 권한 무관 locked → 캔버스 경고 삼각형+펼침 봉인. 맵 드롭다운 '링크 노드로 추가'에도 동일 지정 필터 적용.
- 노드 카드가 지정 어트리뷰트(부서·시스템·소요) 라이브 표시, 인스펙터 읽기전용 카드. subprocess 색은 타입 기본 바이올렛 단일 고정(색 UI 숨김).
- 데모 시드 지정 4종+소비 노드. pytest 415. ⚠️ 노드 표시 필드 localStorage가 리로드 시 기본값 복귀하는 기존 현상 관찰(본 작업 무관, 백로그).

### 매뉴얼 시스템 S8~S9·F9~F11 (2026-07-05~06)
- `manual_docs`: 단일 게시본 → 다중 문서(title·language·sort_order 컬럼, 제목 자동 추출·레거시 ko 흡수) + CRUD API(쓰기 sysadmin). `/manual` 뷰어(TOC·본문검색 점프·읽기폭·읽기테마·언어 전환 시 동일 순번 유지), 관리 패널(마크다운/HTML 편집·미리보기·게시, HTML은 dompurify sanitize).
- `MANUAL_URL` env → 에디터 툴바 매뉴얼 버튼. ⚠️ compose에 backend 전달 누락으로 배포 무동작이었음(수정 완료 — 신규 Settings는 compose 병기 확인 필수).
- 매뉴얼 4종(user/admin × en/ko) 코드 실측 기반 작성, 뷰어 파서 지원 문법만 사용.

### 에디터 소소 폴리시 F6~F15 + 단축키·줌 (2026-07-06)
- 노드 검색 단축키 Ctrl+K → `/`(키캡 버튼·플레이스홀더 축약, 아웃라인 검색 동일 패턴).
- 서브프로세스 1차 검증 피드백 F1~F5: 비교뷰 subprocess 4변 핸들, 펼침 게이트웨이 targetHandle 보정, `isConnectable` 전 핸들 전달(+접힘 시 표시 전용 `sp-ends:*` 파생 엣지), 더블클릭=편집 모달(드릴인 제거), 타이틀 편집 4진입점 차단. 펼침 레인 헤더 강조+맵 이동 버튼+미저장 경고(F6).
- 단축키 안내를 우하단 레전드 → 사이드바 'More shortcuts' 플로팅 패널로 이관, 줌 컨트롤 우하단 이동. ConfirmDialog 요점 줄 말줄임 제거(F7)·우클릭 플라이아웃 폭 보정.

### 자동정렬 가로/세로 + flow-layout 공용화 (2026-07-06)
- `lib/flow-layout.ts` 신설 — 비교 화면의 spine 판정·백본 직선화·핸들 변 선택을 일반화, 에디터 `autoLayoutFlow`(dagre→척추→직선화→엣지 핸들 재지정). 비교 페이지는 로컬 구현 삭제 후 lib 재사용.
- 정렬 메뉴 가로(⇧L)/세로(⇧K) 2항목 분화, 부분 정렬(선택 2+)은 방향 dagre만. 노드+엣지 한 스냅샷(undo 1회).

### 성능·로딩·검색 개선 (2026-07-06)
- 직원 5000명 대비 25청크 무한스크롤(`use-infinite-slice`) — 피커 3종·관리자 테이블 3종·스크롤 목록 11곳(에디터 아웃라인은 제외).
- PNG 내보내기 엣지 소실 수정 — html-to-image가 SVG 하위 요소 스타일을 인라인하지 않는 것이 원인 → 캡처 직전 엣지·화살촉 인라인 스타일 주입 후 원복(`applyEdgeFixups`), 전 엣지 검은 실선·pixelRatio 2, 비교 export 공용화.
- 검색 랭킹 v2(정확>접두>단어시작>중간>초성>시퀀스 + 공백 AND + 타이브레이크) 전 소비처 공통, 피커 검색 캡 삭제·부서/그룹 최고 랭크 상단 핀. 맵 상세 로딩 스피너+고스트 행(버전 프레임 리플로우 제거).

### DB 마이그레이션 9800 검증 스택 (2026-07-06)
- `docs/db-migration-9800.md` — 운영(9900) 복사본 검증: 스키마 diff(신규 테이블 4·컬럼 9·expired), 마이그레이션=최신 backend 1회 기동(create_all+`_ADDED_COLUMNS` 멱등, DDL 스크립트 불요), pg_dump→db만 기동→복원→전체 기동 순서, version_number 백필 SQL, 롤백(additive).
- `docker-compose.dev.yml` 9800 오버라이드(-p bpm-dev 격리). ⚠️ 실전 트러블: ① `docker exec -t` 덤프는 TTY가 CR을 섞어 아카이브 손상 → `-t` 제거 ② compose 오버라이드 `ipam.config`는 누적 병합이라 대역 바꿔도 Pool overlaps → dev 클론 compose 직접 수정 ③ heredoc은 `-it` 불가 → `-i`.

### 신규 화면 4종 S1~S10 — 피드백·공지·인박스·대시보드 (2026-07-05~06 · worktree feat+new-pages)
- 공유 셸: TopNav 3-way 탭(맵/공지/인박스, 세그먼트 pill)·미로그인 Login 표시. 공용 컴포넌트 확립 — UserPill(이름 우선+1초 호버 유저 카드)·TimePills(상대/날짜 2필)·SearchBox(`/` 단축키·초성 검색)·Pagination·IconPillFilter.
- 피드백: `Feedback` 모델(+reply·수정/답글/완료 시각) + 사이드 패널(4000자 카운터) + `/feedback` 페이지(집계·필터·표·페이징) + 상세/관리 모달(상태변경=관리자·답글·작성자 draft 수정/삭제).
- 공지: `Notice` 모델 + `/notices` 뷰어(카드 목록·읽음은 localStorage 캐시·notify_all 알림 fan-out) + 설정 콘텐츠 관리 탭(등록/수정 모달·자체 date-range 캘린더·아코디언 미리보기). 마크다운 뷰어 대비 강화·복사 토스트. 릴리스 공지 초안 `docs/notices/2026-07-06-release.md`.
- 인박스: 알림 탭(read-all)+승인 대기 탭 — `GET /api/inbox/approvals`가 버전 승인·점유권 이전·권한/가시성 요청 3출처 집계, 상세에서 승인/반려(공용 ConfirmDialog·승인자 현황·멤버 보기·마크다운 요약). 알림 메시지 요청자 id→이름 해석(`get_display_name`).
- 대시보드: 설정 분석 카테고리 진입 스텁 + `GET /api/dashboard`(login_records 집계 — 고유 접속자·총 로그인·최근 7일, 나머지 지표는 후속).

### 비교화면 재디자인 C0~C4 (2026-07-05 · feat/compare-redesign, main 머지 a914063)
- 3단 read-only 구성(좌 변경 패널[필터칩·종류 필터·클릭 포커스]·중 캔버스·우 속성 인스펙터[before→after 취소선]) + 헤더 BASE/TARGET pill·swap·PNG export·READ ONLY 워터마크. DB 스키마 무변경.
- diff 노드 스타일(상태 뱃지·틴트·삭제 점선)+before→after 필, passthrough 삭제 엣지는 우회 아크(`RemovedArcEdge`), 엣지 변경 목록은 양끝 기존 노드인 실배선 변경만(중복 제거).
- LR/TB 방향 토글 + 연결성 기반 spine 직선화(`computeSpine`/`alignBackbone`, 실측 렌더 폭 기준) + 의미 기반 핸들 변 직접 배정(그리디 회피 폐기 — 곁가지 꼬임 해소). 데모 시드 `seed_compare_demo`(계보 공유 2버전, map 13).
- 폴리시: 노드 클릭/hover 포커스 링 슬라이드, 휠/키 에디터화(팬·Ctrl 줌·Space 그랩·Tab 흐름 이동), 엣지 라벨 반투명+블러, 포커스 잔상 제거. 진입 버튼은 게시본 있을 때만(BASE 기본=게시본).

### 홈 최근 열람 + 저장 조건 체크리스트 (2026-07-05)
- recent-maps localStorage 캐시(최신 11) — 브라우즈 최근 밴드(접기/펼침)·검색 매치 상단 고정+배지·검색/필터 sessionStorage 유지(새로고침·로고 클릭은 초기화)·빈 여백 클릭 선택해제.
- 좌상단 맵 제목 칩 = 저장 조건 아코디언(`MapTitleChecklist`): 시작 1개·대표 끝·끝 이름 중복 없음·잘못된 다중 출력 감지(문제 노드 클릭 이동). 수동 저장·승인 시작만 차단(autosave·백엔드 불변). 노드 모달 제목 저장 유실 버그 수정.

### 에디터 재디자인 R6~R11 (2026-07-03~04 · feat/editor-redesign 계열)
- R6 컨텍스트 메뉴: 시각 통일(danger 빨간 칩)·전 항목 아이콘·F2 이름변경(노드·엣지)·그룹 메뉴(이름변경·색 인라인)·하위메뉴 상하 뒤집기. 엣지 연결면 패드 직각 커넥터 재작성(16조합 박스 미통과 수치검증).
- R7 노드 편집 모달: 라이브→버퍼 편집(저장/취소·⌘S), 설명 필드, 선후행 클릭 내비+미저장 확인, 속성 영역 우측정렬·구분선·담당자 ＋플라이아웃(body 포털·fitContent). R8 그룹: 타이틀바 색 pill·박스 dashed·벌크 모달 재설계(속성 3탭·충돌 2×2·개별 마법사 이전→현재 필·요약 표).
- R9 엣지 팝업 5종(decision·action·branch·select·Keep/Insert) 리치 재디자인 — 커스텀 애니 SVG(정지 상태=최종형·reduced-motion 가드), select는 리스트형+행 hover 시 캔버스 엣지 하이라이트. 분기 엣지는 브랜치 선택 후 생성(노드 드롭 경로도 보류-적용으로 원자화).
- R10 AI 패널: 공용 `MarkdownView`(자체 파서·XSS safeHref·GFM 표·태그 필·행/인라인 복사) + 스레드 재스타일·헤더 자동 타이틀·폰트 배율·퀵칩·인채팅 제안 카드·최소화 스파클 드래그. R11 드롭존 SVG 부채꼴 링+극좌표 히트테스트(스왑 S 이동).
- 미니맵: 줌아웃 페이드(채움비 기반)·클릭 스태킹 수정(패널에 직접 opacity)·크기 조정. ScopeWindow 8방향 리사이즈·min-h-0 스크롤 수정. 한영 전환 세그먼트 토글.

### 담당자/부서 설정 로직 통일 (2026-07-03)
- 3지점(노드 모달·인스펙터·그룹 벌크) 통일: 부서 단일 + 담당자 같은 부서 복수(콤마, 백엔드 무변경), 담당자↔부서 연동(선택 시 부서 자동), 부서 변경 시 담당자 초기화 확인 모달, 드리프트 경고(부서 불일치 담당자 오류색).
- 그룹 벌크: 결합세트(부서만 3옵션·담당자 4옵션·교차부서 확인 재디자인)·start/end/subprocess 벌크 제외(`hasBpmAttributes`) — 해당 타입은 BPM 속성 입력/표시 자체를 숨김.

### 오류방지·편집 UX R11b (2026-07-04)
- 시작 노드 싱글턴(추가 시 기존으로 이동 안내), 스왑은 같은 종류만(subprocess↔process 예외, `canSwapTypes`), `D` 삭제 가속기+복수선택 삭제 메뉴, 승인 요청 전 `saveCurrentScope` 강제(지금 보는 내용=승인 대상 보장).

### 버전 라이프사이클 후속 폴리시 (2026-07-02~03)
- 점유(체크아웃) sticky — TTL 자동해제 폐기, 인계는 요청 승인/이전만. 요청자 복수 허용+승인 시 타요청 자동거절+철회+provenance(`checked_out_from`). 점유 이동은 draft 전용(거절본 점유 버그 구조 차단).
- 회수 권한 상태별: pending/approved=제출자만, rejected=+오너·sysadmin. 거절 시 거절자 승인 레코드 삭제+`rejected_by` 노출, 반려본은 회수(기록) 후 재제출. 승인자 관리 = 오너 OR sysadmin, 승인 진행 중엔 409.
- 전이 모달(제출/승인/거절/게시/회수) ConfirmDialog 통일 — 요약박스·승인자 현황(본인 하이라이트)·상태는 영어 뱃지, 회수는 제출자→회수자 핸드오프 시각화. UI 용어 "점유권"→"체크아웃" 통일. 버전 마커 `v{n}`/`(Draft)v.{n}` 공통화, 버전 카드 상세 레이아웃 다듬기(rowspan 날짜박스·sticky 1열·말줄임).
- 홈 상세·버전 카드에 "이 버전으로 가기"+에디터 `?version=` 진입, 승인탭 체크아웃 접이식 패널(요청자 카드·호버 결정·철회), 설정 승인큐 탭 everyone 공개(비-sysadmin은 준비 중 안내), 피커 선택 목록 위로+신규 항목 페이드인.

### 시드 전면 재구성 + 로컬 권한검증 (2026-07-02)
- 단일 종합 시드 `seed_org_demo`(조직 센터/담당/팀/파트·직원 401[admin.sys 포함]·맵 12[공개6/비공개6, v1~v5 게시 정상 워크플로 이벤트]·그룹 6), 구 데모 시드 5종 삭제, reset_db=drop_all→seed→verify. 기동 재시드 가드(빈 DB만 시드 — 오염 방지).
- 로컬 권한검증 ON: `backend/.env`에 `DEV_ENFORCE_PERMISSIONS=true`+`BPM_SYSADMINS=admin.sys`(conftest baseline 고정으로 테스트 미오염). ⚠️ 미설정 시 전원 sysadmin=owner라 viewer 시현 불가. DevLoginModal은 하드코딩 5명→디렉터리 fetch 피커.
- README 갱신·폐기 문서/완료 트래커 삭제.

### 버전 라이프사이클 본편 (2026-06-29~07-02 · feat/version-lifecycle)
- `version_number`(게시 시 채번) + `expired` 상태(재게시 시 이전 published 전환+이벤트), 점유권 이전/요청/결정 API(transfer/request/decide-checkout), 만료본 재게시(그래프 복제 새 draft·생성자 점유), 프론트 역할/상태 액션 매트릭스+이전 다이얼로그 검색 피커+pending 결정 배너.
- 생성 게이트 강화: draft/pending/rejected 존재 시 409, 최신이 published여야 새 버전. 뷰어 드래프트 생성 차단, 드래프트 삭제=보유자|오너|sysadmin.
- ⚠️ 배포 RESOLVED: 기존 DB의 `map_versions.version_number`는 기동 시 `_add_missing_columns` 자동 보강(수동 ALTER·reset 불필요). 신규 `checkout_requests` 테이블은 create_all이 생성.

### 에디터 재디자인 R1~R5 (2026-06-28~29 · feat/editor-compare-redesign)
- 전략 전환: 제로베이스 `/v2` 리라이트 폐기 → **제자리 리스타일+컴포넌트 추출**(단축키·드롭존·스코프·undo/autosave 등 기존 동작 전부 보존). 마스터 트래커 단위 검토 방식 확립.
- R1 미니맵(노드 실색 톤다운·뷰포트 악센트 채움)+줌 pill, R2 셀렉션 링=노드 간 슬라이드 인디케이터(`NodeSelectionRing`), R3 상단바(MapNameDropdown·VersionPill·편집 중 이동 확인 모달), R4 편집 툴바(+Node·자동정렬·정렬/분배, 편집 모드만)+노드 검색 사이드바 이전+단축키 카드(↵/Del 배선).
- R5 인스펙터 4탭(속성/맵/승인/활동) — NEW‖OLD 나란히 비교 후 컷오버(OLD 인스펙터·하단 대시보드 제거, 버전 CRUD는 승인 탭으로 이관). BPM 담당자/부서 피커화(eligible-assignees), ApprovalPanel 3단 스테퍼, 멤버 카드=MapDetailCard 재사용, 코멘트 작성자 권한·노드 네비.
- 백엔드(사용자 승인): 드래프트 점유 강탈은 sysadmin 전용 + 생성자 자동 점유.

### 화면 리디자인 S1~S8 + 홈·그룹·관리자 개편 (2026-06-26~28 · feat/frontend-ui-improvements)
- S1 로그인 카드(운영은 Keycloak 단독·dev 모달은 로컬만), S2~S3 맵 설정 폭/노티스·삭제 모달, S4 에디터 뷰어 읽기전용 모드(my_role 통합 — draft 공개맵 뷰어 편집 허점 차단·배지·안내 스트립·워터마크), B1 viewer 멤버 목록 읽기 허용(GET permissions viewer 게이트, 쓰기는 editor+ 유지).
- 홈 H1~H6: 상태+역할 멀티셀렉트 필터 드롭다운, 멤버 행 2줄+호버 펼침(디렉터리에 title·org_path 추가), 버전 타임라인(단계 필·rowspan 날짜박스·클릭 토글·withdrawn 표시), 카드 재디자인+호버 모달(1초·pointer-events 통과), 카드 집계 version_count/node_count/owner_name/member_count(그룹 쿼리로 N+1 회피). ⚠️ 드롭다운 클릭-어웨이 전체화면 오버레이가 페이지 전체 호버를 가로채던 근본원인 → document mousedown 리스너로 교체.
- 그룹 라이프사이클 L1~L6: withdraw/deactivate/reactivate/rename(active만·주1회 `name_changed_at`)+`user_groups.deleted_at` 소프트삭제(7일 퍼지·휴지통·복구)+재신청 프리필, 매니저⊆멤버(★토글·캐스케이드), 그룹 이름 전역 중복 검사(실시간), 가이드 SVG(5상태 라이프사이클), 비활성 시 map_permissions 삭제, 피커 빈 포커스 전체 옵션.
- 관리자: A1 DB 뷰어 무한스크롤, A5~A6 테이블 공통 셸+테이블 pill(행수), A7 삭제 카운트다운, A9 부서 인원수 열, A10 승인 큐 카드+클릭 아코디언, A13 가시성 before→after(`payload.from_visibility`). 캔버스 좌우 휠 패닝(PanOnScrollMode.Free).

### 플로우 규칙 + RBAC 개선 (2026-06-24~25 · feat/flow-rbac-improvements)
- 플로우: F1 디시전 드롭 분기/인터셉트 모달+다중 출력 선택 모달(비-decision 2번째 출력=삽입/교체/취소, 마우스 위치 팝업), F2 회귀(A↔B) 차단(+토스트 안내), F14 흐름 하이라이트(`[`/`]` 경로 증감·Tab/⇧Tab 흐름 이동, BFS 분기 일괄), 시작=출발/끝=도착 전용, F11 맵당 draft 1개 제한.
- 권한: F5 담당자/부서=조회권한자(viewer+)만(eligible-assignees), F10 오너 다운그레이드 무승인+비-오너는 승인 가능자 토스트, F6 admin 티어를 sysadmin으로 흡수(⚠️ 운영 관리자는 `BPM_SYSADMINS` 등록 필수 — `Employee.role`은 정보용), F9 퍼블릭 맵 viewer 지정 불가(백엔드 409 방어), F15 AD 제외 OU 추가, F12 승인본 기준 맵 복사+맵 이름 전역 유니크, AP 승인자 viewer+ 자격 제한.
- Settings v2: PV 가시성 스테이징(선택→변경 적용+미리보기, 퍼블릭 전환 승인 적용 시 잔존 viewer 그랜트 제거)·ST 맵 설정 단일 스크롤+앵커 내비·승인자 카드. DL 맵 소프트삭제(`ProcessMap.deleted_at`·휴지통 7일 lazy 퍼지·복구·"삭제 예정" 탭).
- 인프라: 타임스탬프 KST 통일(`app/clock.py` — 체크아웃 만료 9h skew 수정, 프론트 formatKst Asia/Seoul 고정), `login_records` 테이블(/me 시 KST 하루 1건 중복제거), 역할(Owner/Editor/Viewer)·승인 대기 상태 라벨 영어 고정. 생성 시 public 무시 버그 핫픽스(MapCreate.visibility 미수용이 원인).
- UX: 검색 SR(우선순위 정렬·subsequence·키 내비·아이디 검색·principal 검색 필드 타입별 한정), Tooltip/PromptDialog 신설(native prompt/confirm 4곳 교체·모달 blur 통일), 홈 가시성 탭·빈 상태 환영 화면·협업자 선택 즉시 추가, 승인자 후보 규칙(public=전원·가시성 변경 시 초기화 확인).

### 설정 콘솔 통합 + 홈/에디터 UX (2026-06-22 · claude/frontend-ux-improvements)
- /admin·/admin/permissions·/groups를 **/settings 단일 콘솔**로 통합(좌측 세로 탭 레일, 권한별 카테고리: Groups 모두·조직 admin·권한 sysadmin). DB 테이블 뷰어 탭(읽기전용 인트로스펙션·서버측 페이징/정렬/필터·SELECT 전용 안전장치).
- 홈 마스터-디테일 시작(맵 카드 리디자인·우측 상세 카드[버전+허용 인원+하단 버튼바]·멤버 그룹핑), 카드 최신 버전 상태 필(`latest_version_status` 1쿼리 동봉), 내 소속 멤버 하이라이트.
- 에디터: 툴바 축소→하단 탭 패널(승인/버전/다운로드/디자인 — 이후 R5로 대체), 읽기전용 워터마크, 사이드바 설정 버튼, 맵 설정도 세로 레일로. ⚠️ "누구나 owner"는 버그 아님 — AUTH_ENABLED·DEV_ENFORCE_PERMISSIONS 둘 다 off면 전원 sysadmin(로컬 잠금 방지 설계).

### AI 채팅 개편 Phase 0~6 (2026-06-22 · feat/ai-enhancements)
- `AiProposal` 5종(graph 생성/answer/walkthrough/analysis/ops 증분편집) — 자연어 맵 생성(그룹·어트리뷰트), ops 편집(add/remove/connect/relabel/set_attr — 좌표·색·담당자·그룹 메타 보존), read-only 분석 findings+노드 하이라이트, 워크스루 스텝퍼+자동재생, 조직 디렉터리 주입(담당자 매칭), 매뉴얼 근거 answer(범위 밖은 "모른다").
- persist는 기존 `saveGraph→replace_graph` 검증 경로 경유(우회 없음). `ai_prompt.py` 직렬화+`_structure_hints`로 환각 감소, 502 시 내부 URL 은닉.
- ⚠️ 보고된 미해결: AI 라우트 viewer 게이트 없음(원천 API가 이미 인증자 전원 공개라 신규 노출 아님 — 넓은 read-path 게이팅은 후속 Phase).

### 하위프로세스 권한 마스킹 (2026-06-22 · feat/expand-sync)
- resolved API(`/library/processes/{id}/resolved`)가 viewer 미만이면 `200+{locked:true, nodes:[], edges:[]}`(그래프 미빌드 — 데이터 미유출), 프론트는 Lock 뱃지+펼침/드릴/아웃라인 봉인(호스트 노드·엣지는 유지). 3중첩 픽스처로 차단/허용 양방향 스모크.
- 딥드릴 L2→L3 수정(캡처 dblclick을 scopeId로 분기 — 딥뷰 노드는 RF가 이벤트 미발화), 아웃라인 접기 드릴인 모드 인지, 마스킹 게이트 자리(no-op) 선매설.
- ⚠️ 기록(별건): dev-login `X-Dev-User` 헤더 타이밍 레이스로 compare 초기 GET 403 → 빈 캔버스(dev 전용, 이후 DevGate 렌더 단계 동기 호출로 수정).

### 맵 카드·상세 개편 + 병합 비교 + 시드/검색 (2026-06-23)
- 맵 카드·상세정보 개편 — 버전 git-log 타임라인, **신규 `version_events` 테이블**(created/submitted/approved/rejected/published, 누가·언제 + 멱등 백필), 삭제 확인 모달, description 입력 복원.
- 비교 화면을 좌/우 2캔버스 → **단일 병합 캔버스**로 재작성(lineage 매칭 `merge-diff.ts`·diff 색·클릭 fitView 포커스) + vitest 셋업 도입. 빈 캔버스 진짜 원인=DevGate `setDevUser` effect 호출 → 렌더 단계 동기 호출로 수정.
- 시드 정합성 멱등 패스(`seed_invariants` — 전 맵 owner+승인자, 비-draft 이력 보정) + 재사용 검색 lib(`lib/search.ts` — 부분/한글초성/로마자, `filterByQuery`·`<Highlight>`) + 승인자 필 UI + 홈 검색. 엣지 우클릭=Start/End 박스 테두리 면 선택+라벨 편집(더블클릭), 수동 연결 기본 핸들 s-right/t-left 고정. 브랜딩 "Business Process Map" 풀네임화.

### 권한 관리 RBAC Layer 1~4 (2026-06-20~21)
- UI-first mock(Phase 1-3) → 실 백엔드 전환: Layer 2 맵 엔드포인트 게이트(가시성 필터·viewer/editor/owner·체크아웃 보유 강제)+권한 관리 API(협업자 CRUD·다운그레이드 승인 pending·owner 이양·가시성 요청·결재 결정), Layer 3 프론트 실 API 배선(서버 진실·낙관적 갱신 금지, `/api/me.is_sysadmin`·`MapOut.my_role` 단일화), Layer 4 유저그룹(스키마 3테이블·`effective_role` 그룹 principal[user/dept 멤버십]·그룹 CRUD/승인 큐·협업자 그룹 grant).
- 권한 데모 시드+워크스루 가이드, whole-branch 리뷰 후 mock 스토어 dead code 정리. 캔버스 회귀 픽스 3건(펼침 가로지른 드래그 좌표·아웃라인 펼침 표시·obsolete 드롭존+서브프로세스 엣지 핸들).

### 하위프로세스 참조 모델(Call Activity) (2026-06-20)
- 인라인 계층 편집(`parent_node_id`) 폐기 → 평면 노드 + 다른 맵 링크 읽기전용 임베드. 백엔드: 노드 평면화·subprocess 참조/대표끝/엣지핸들 필드·프로세스 검증·순환 차단·라이브러리/해석 API.
- 프론트 9태스크: 합성트리(compositeTree — 링크맵 resolved를 네임스페이스 parent로 임베드, 렌더 폴리시 무변경)·동적 끝핸들·하위 편집경로 제거·읽기전용 딥뷰 드릴인·라이브러리 드래그·다중출구+버전 업데이트 배지·follow-latest.
- 권한 관리 UI-first mock 구현(이후 Layer 1-4 실 백엔드로 대체), 깊이4 복잡 테스트 맵 시드.

### 캔버스 인라인 펼침·포커스 모드·레슨 (2026-06-18~19)
- 인라인 펼치기/접기 전면 구현(세로 레인·중첩 재귀·캡 노드300/깊이5·모두 펼치기/접기), prop-only 자식 함정 우회(measured 직접 주입·raw dblclick 캡처). 자식 편집은 별도 `childNodes` state 방식(⚠️ 메인 nodes 합치기는 광범위 회귀로 reset — 이후 ⑦에서 인라인 편집 자체 폐기).
- 포커스 모드 — 비활성 스코프 dim/읽기전용·클릭 시 활성화(`navigateTo`+카메라 보정)·조상 감싸기 레인. 아웃라인 키보드 내비게이션.
- `docs/lessons/` 4종 신설(canvas-react-flow·scope-save-and-coordinates·browser-verification·react-ts-patterns) + CLAUDE.md Lessons 섹션.

### 초기 구축 ~ 중반 기능 (2026-06-11~17)
- 스펙 §6 ①~⑤: 스캐폴딩(Next+FastAPI+nginx+compose) → 맵 CRUD+캔버스 → 계층(드릴다운)+dagre 정렬 → 버전관리+비교 → Keycloak 인증(AUTH_ENABLED). Whimsical 디자인 시스템(@theme 토큰·바이올렛 #6A41FF·dot-grid, `rules/frontend/design.md`) + 에디터 UI 대개편(아웃라인·인스펙터·컨텍스트 메뉴·드롭존) + 그룹 풀스택(이후 다중 태그 `nodes.group_ids` JSON+중첩+일괄 편집).
- 버전 승인 워크플로 풀스택(Draft→Pending→Approved→Published+Rejected, 맵별 만장일치 승인자·수동 게시+구버전 강등·인앱 알림). 온프레미스 AI 채팅(OpenAI 호환 프록시·모델 드롭다운). 엣지 핸들 변 커스텀(`source_side`/`target_side` 컬럼·4변 8핸들)·분기 Yes/No 색. 기능 확장 Phase A/B/C(undo/redo·자동저장·BPM 속성·버전 diff 계보·초성 검색·PNG·체크아웃 잠금·노드 코멘트).
- Keycloak 로그인+사내 AD(LDAP) 동기화(`employees` 테이블·`app/ad/`·X-Dev-User·/admin 직원 테이블) + 서버(사내 71번) 배포 성공(포트 3333·명시 서브넷·시드 스크립트 이미지 포함). ⚠️ 평문 HTTP insecure context — `crypto.randomUUID`/Web Crypto 미동작 → `genId()` 사용·Keycloak `disablePKCE`(localhost는 secure context라 재현 안 됨 — 서버/원격 IP로 검증).
