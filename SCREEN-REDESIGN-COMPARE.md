# 비교화면(Compare) 재디자인 — 계획·검토 트래커

버전 비교화면(`frontend/src/app/maps/[mapId]/compare/page.tsx`)을 승인된 목업 기준으로 재디자인. 상위 트래커(편집기)의 **C 섹션을 이 문서로 이관**한다.

- **승인 목업**: `docs/superpowers/specs/assets/editor-compare-redesign/compare-screen.mockup.html` (반응형·실제 `@theme` 토큰, JS 데이터모델로 노드/엣지/패널/카운트 생성). 참조 이미지 `compare-screen.png`.
- **브랜치**: `feat/compare-redesign` (main 분기). **C1a/C1b는 이미 main 머지 완료.**
- **상위 트래커**: `SCREEN-REDESIGN-EDITOR.md`(R 시리즈). 설계: `docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md`.

## 검토 환경
- 목업 미리보기: `cd docs/superpowers/specs/assets/editor-compare-redesign && python3 -m http.server 8899` → `http://localhost:8899/compare-screen.mockup.html`.
- 라이브 검증: 로컬 네이티브 `:3000`, 다버전 맵(예: map 11, 9버전) `/maps/11/compare`. 대조 기준 = main(=배포).

## DB 실현가능성 (확인 완료 — 스키마 변경 불필요)
- **노드 계보**: `Node.source_node_id`(원본 루트 포인터). 버전 클론 시 서버가 `source_node_id = node.source_node_id or node.id`로 전파 → 버전 간 "같은 논리 노드"가 같은 계보키 공유. `getLineageKey = source_node_id ?? id`.
- **엣지 매칭**: 계보 id 없이 `(source계보 → target계보)` 문자열 키. 클론 시 endpoint를 새 노드 id로 재매핑.
- **삽입-사이 A→B 삭제**: base에만 있는 엣지 → 데이터상 이미 `removed`로 나옴(스킵 아님).
- **프론트 보강 1건(DB 아님)**: before→after 필("System None → PG v2")은 *이전 값* 필요. 현재 `buildMergedGraph`는 `changedFields`(바뀐 필드 *이름*만) + target 노드만 담음 → merged 노드에 `{field, before, after}` 쌍을 추가로 실어야 함. 양 버전 그래프는 이미 로드됨.

## 스코프 결정 — 노드 집중
- **엣지는 added/removed만.** 같은 양끝 엣지의 라벨·분기(Yes/No)·연결면 "changed" 감지는 **범위 밖**(엣지 계보 id가 DB에 없음 → 후속 스키마 논의). 현재 그림은 엣지를 추가/삭제로만 사용하므로 지금은 문제 없음.

## 보존 불변식 (깨뜨리면 회귀)
- `buildMergedGraph`(계보 매칭) 재사용. **읽기전용**(편집·저장·드래그·연결 전부 차단). 저장 좌표 무시·dagre 연결기반 배치. `genId`·KST·토큰만(raw hex 금지, 단 노드색·export 배경은 데이터/출력 예외).

## 확정 디자인 (목업 기준)
1. **읽기전용 캔버스** — 메인 에디터 워터마크 그대로: "READ ONLY" `text-accent`·120px·uppercase·`tracking-widest`·`-rotate-18`·`opacity .14`. **dot 그리드 제거**(메인도 `readOnly`면 `<Background Dots>` 미렌더).
2. **3단 레이아웃** — 좌: 변경 사항 패널 / 중: 캔버스 / 우: 노드 속성 인스펙터(읽기전용).
3. **diff 노드** — 추가 green 실선·삭제 red **점선**·변경 amber 실선 + 상단 상태 뱃지(`opacity .7`, 내용 안 가림) + 변경 노드 하단 **before→after 필**. 빈값 표기 **None**(`—` 아님).
4. **diff 엣지** — 추가 green 실선·삭제 red 점선. **passthrough-removed(양끝이 모두 유지 노드) → 아래로 우회하는 아크**(삽입 노드 회피, `route-around`). 한쪽 끝이 삭제 노드인 엣지는 그 노드로 직행. 패널엔 "Edge removed" 항목 유지.
5. **오버레이** — 좌상 카운트 필(노드+엣지 status 집계)·좌하 범례(삭제=점선 스와치)·우하 줌바(`- % +`·fit).
6. **변경 패널** — 헤더+건수·필터칩(All/추가/삭제/변경)·아이콘(＋/−/✎)+상태 뱃지+상세·변경 항목 before→after 필·선택 하이라이트·클릭 시 캔버스 포커스.
7. **노드 속성 인스펙터(우, 신규)** — `Properties` + `View only` 배지(메인 read-only 배지: `bg-surface-alt`·Lock·`text-fine font-semibold`). Title/Description(회색 read-only 박스)·Type·Color(스와치)·Assignee·Department·System(변경 시 `~~None~~ → PG v2`)·Duration. 라벨 좌·값 우측정렬·`divide-y` 행.

## 마스터 표
| ID | 화면 | 단위 / 내용 | 검증 | 시현 | 검토결과 | 커밋 |
|----|------|-------------|------|------|---------|------|
| C0 | 진입(에디터) | **비교화면 진입 버튼** — 에디터 우측 속성탭 **빈 상태**(선택 없음) 하단 **스티키** 버튼. PNG 다운로드와 동일 accent 톤(`bg-accent`·`GitCompare`), `/maps/[id]/compare` 내비. 읽기전용에서도 노출. `inspector-panel.tsx`(`mapId` prop·`Link` 푸터, 스크롤 밖 `shrink-0 border-t`)·i18n `inspector.compareVersions`. | lint/build✅ | 라이브(:3000 map 11)✅ 내비 확인 | ✅ | (this) |
| C1a | 셸 헤더 | (완료·머지) 뒤로가기·타이틀·**BASE/TARGET pill(상태 색점)**·swap·Export(PNG)·Apply To-Be·범례 캔버스 이전·`min-h-0` 높이수정 | lint/build✅ | ✅ | ✅ | main `f257047` |
| C1b | 셸 오버레이 | (완료·머지) 좌상 카운트 필·좌하 범례 폴리시·우하 `ZoomBar`(useStore zoom%) | lint/build✅ | ✅ | ✅ | main `d1f95f9` |
| C2a | diff 노드 | 노드 상태별 스타일 — 추가 green 실선·삭제 red **점선**·변경 amber, 상단 **상태 뱃지(.7)**+diff색 틴트 fill(자기색 대신), 변경 노드 **before→after 필**(None·최대 3+"+N more"·값 truncate). `merge-diff.ts`에 `FieldChange{field,before,after}` 실음(+단위테스트), `NodeData.diffFields`·`ProcessNode`(DiffBadge/DiffFieldPills)·compare `fieldsOf`. **+ `layoutWithDagre nodesep` 72→120**(필이 아래 노드 침범 방지, compare 전용). | lint/build✅·27test✅ | 라이브(map11 73→74: 추가/삭제/변경 각 확인)✅ | ✅ | (this) |
| C2b | diff 엣지 | 추가 green·삭제 red 점선 + **상태별 화살표 색** + **passthrough-removed 우회 라우팅** — 양끝이 모두 유지 노드인 removed 엣지는 커스텀 `RemovedArcEdge`(BaseEdge 베지어, 아래로 dip)로 삽입 노드 회피. 삭제 노드로 가는 엣지는 기존 smoothstep. `keptKeys`(non-removed 계보키)로 판정, `edgeTypes` 등록. **+ 엣지 핸들 변 지정(라우팅 정합)** — compare 엣지가 핸들 미지정이라 RF가 좌측 핸들(`s-left`/`t-left`)에 몰아 타겟(우측)까지 **노드 뒤로 우회**하던 문제 해결: 레이아웃된 두 노드 중심 우세방향으로 `sourceHandle/targetHandle` 산정(`edgeSides`: 가로 R/L·세로 B/T) + 하위프로세스는 `withSubprocessHandles` remap. 배열(dagre LR)은 그대로, 핸들만으로 목업급 정합. | lint/build✅ | 라이브(map11 73→74: passthrough 아크·분기·before→after·**엣지 라우팅 정합** 확인)✅ | ✅ | (this) |
| C3 | 변경 패널 | 패널 **좌측 이동** + 필터칩(전체/추가/삭제/변경)·아이콘 항목·before→after 필·**클릭 포커스**. 3단 레이아웃 정착(order/CSS). | — | — | ⏳ | — |
| C4 | 속성 인스펙터 | **우측 노드 속성(읽기전용) 신규** — 선택 노드 속성 카드(Title/Desc/Type/Color/BPM), 변경 필드 diff, `View only` 배지. | — | — | ⏳ | — |

## 진행 순서(권장)
C2a(노드 diff + before/after) → C2b(엣지 우회 라우팅) → C3(패널 좌측 + 필터/포커스) → C4(속성 인스펙터). **노드 우선.**

## 비고
- **각 단위는 행(sub-unit)으로 쪼개 개별 트래킹**(R 시리즈와 동일). 단위별 커밋 + 시현 데이터 세팅 + 이 표 갱신.
- **후속(범위 밖)**: 엣지 라벨·분기 "changed" 감지 → 엣지 계보 id(DB 스키마 추가) 필요 시 별도 논의.
