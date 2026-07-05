# 비교화면(Compare) 재디자인 — 계획·검토 트래커

버전 비교화면(`frontend/src/app/maps/[mapId]/compare/page.tsx`)을 승인된 목업 기준으로 재디자인. 상위 트래커(편집기)의 **C 섹션을 이 문서로 이관**한다.

- **승인 목업**: `docs/superpowers/specs/assets/editor-compare-redesign/compare-screen.mockup.html` (반응형·실제 `@theme` 토큰, JS 데이터모델로 노드/엣지/패널/카운트 생성). 참조 이미지 `compare-screen.png`.
- **브랜치**: `feat/compare-redesign` (main 분기). **C1a/C1b는 이미 main 머지 완료.**
- **상위 트래커**: `SCREEN-REDESIGN-EDITOR.md`(R 시리즈). 설계: `docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md`.

## 검토 환경
- 목업 미리보기: `cd docs/superpowers/specs/assets/editor-compare-redesign && python3 -m http.server 8899` → `http://localhost:8899/compare-screen.mockup.html`.
- 라이브 검증: 로컬 네이티브 `:3000`, 다버전 맵(예: map 11, 9버전) `/maps/11/compare`. 대조 기준 = main(=배포).
- **개발용 데모 맵**: `backend/scripts/seed_compare_demo.py` — **계보(source_node_id) 공유 2버전**(v1 게시본 As-Is / v2 초안 To-Be)으로 목업 스타일 diff(노드 추가5·삭제1·변경3·무변경8, 엣지 추가9·삭제5(passthrough 3), 3개 우회 아크). 실행 `cd backend && .venv/bin/python -m scripts.seed_compare_demo` → map 13 `/maps/13/compare`. (시드의 Release 스냅샷들은 계보 독립이라 전부 add/remove로만 나옴 — 실제 diff 검증은 이 데모 맵으로.)

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
| C0 | 진입(에디터) | **비교화면 진입 버튼** — 에디터 우측 속성탭 **빈 상태**(선택 없음) 하단 **스티키** 버튼. PNG 다운로드와 동일 accent 톤(`bg-accent`·`GitCompare`), `/maps/[id]/compare` 내비. 읽기전용에서도 노출. `inspector-panel.tsx`(`mapId` prop·`Link` 푸터, 스크롤 밖 `shrink-0 border-t`)·i18n `inspector.compareVersions`. **+ 게시본 없으면 비활성**(`canCompare` prop, 회색·툴팁 `compareNeedsPublished`) + **비교 BASE 기본값=게시본 우선**(compare/page.tsx). | lint/build✅ | 라이브(map 13: 활성/비활성·게시본 BASE 확인)✅ | ✅ | (this) |
| C1a | 셸 헤더 | (완료·머지) 뒤로가기·타이틀·**BASE/TARGET pill(상태 색점)**·swap·Export(PNG)·Apply To-Be·범례 캔버스 이전·`min-h-0` 높이수정 | lint/build✅ | ✅ | ✅ | main `f257047` |
| C1b | 셸 오버레이 | (완료·머지) 좌상 카운트 필·좌하 범례 폴리시·우하 `ZoomBar`(useStore zoom%) | lint/build✅ | ✅ | ✅ | main `d1f95f9` |
| C2a | diff 노드 | 노드 상태별 스타일 — 추가 green 실선·삭제 red **점선**·변경 amber, 상단 **상태 뱃지(.7)**+diff색 틴트 fill(자기색 대신), 변경 노드 **before→after 필**(None·최대 3+"+N more"·값 truncate). `merge-diff.ts`에 `FieldChange{field,before,after}` 실음(+단위테스트), `NodeData.diffFields`·`ProcessNode`(DiffBadge/DiffFieldPills)·compare `fieldsOf`. **+ `layoutWithDagre nodesep` 72→120**(필이 아래 노드 침범 방지, compare 전용). | lint/build✅·27test✅ | 라이브(map11 73→74: 추가/삭제/변경 각 확인)✅ | ✅ | (this) |
| C2b | diff 엣지 | 추가 green·삭제 red 점선 + **상태별 화살표 색** + **passthrough-removed 우회 라우팅** — 양끝이 모두 유지 노드인 removed 엣지는 커스텀 `RemovedArcEdge`(BaseEdge 베지어, 아래로 dip)로 삽입 노드 회피. 삭제 노드로 가는 엣지는 기존 smoothstep. `keptKeys`(non-removed 계보키)로 판정, `edgeTypes` 등록. **+ 엣지 핸들 변 지정(라우팅 정합)** — compare 엣지가 핸들 미지정이라 RF가 좌측 핸들(`s-left`/`t-left`)에 몰아 타겟(우측)까지 **노드 뒤로 우회**하던 문제 해결: 레이아웃된 두 노드 중심 우세방향으로 `sourceHandle/targetHandle` 산정(`edgeSides`: 가로 R/L·세로 B/T) + 하위프로세스는 `withSubprocessHandles` remap. 배열(dagre LR)은 그대로, 핸들만으로 목업급 정합. **+ 미세정렬**: 핸들을 노드별 **4변 그리디 분산**(`handleSides`·`preferredSides` 방향선호+충돌회피 → 분기 겹침↓·수평 직선), **passthrough 아크 바닥→바닥 U자**(bottom 핸들 고정+수직 dip), **노드 핸들(히트박스) 숨김**(`.react-flow__handle{opacity:0}`)·**노드 호버 링**(`.bpm-node-emph` box-shadow, 에디터 raw `<style>` 이식). | lint/build✅ | 라이브(map11 73→74·map13: 분산·직선·바닥아크·핸들숨김·호버 확인)✅ | ✅ | (this) |
| C3 | 변경 패널 | 패널 **좌측 이동**(aside 캔버스 앞·`border-r`) + **필터칩**(전체/추가/삭제/변경, 상태 색점+건수, 클릭 필터·`filter` state·active=accent-tint) + **아이콘 항목**(＋/−/✎ 색상 사각) + 상태 뱃지 + **before→after 필**(변경 노드) + 엣지 설명 + **선택 하이라이트**(focusId=accent-tint) + **클릭 포커스**(fitView). `changeItems`(목업 순서: 추가노드→추가엣지→삭제노드→삭제엣지→변경노드) 통합. 컴팩트(w-72·text-caption/fine). i18n `compare.filterAll`. **+보강**: 엣지 항목은 **양끝이 모두 기존 노드**인 것만(노드 추가/삭제로 딸린 엣지 제외=실제 배선 변경만, 14→3) + **종류 필터 행**(모두/노드만/엣지만·`kindFilter`, 상태와 AND). i18n `compare.kind{All,Nodes,Edges}`. | lint/build✅ | 라이브(map 13: 필터·포커스·선택·필·엣지제외·종류필터 확인)✅ | ✅ | (this) |
| C4 | 속성 인스펙터 | **우측 노드 속성(읽기전용) 신규** — 선택 노드 속성 카드(Title/Desc/Type/Color/BPM), 변경 필드 diff, `View only` 배지. | — | — | ⏳ | — |

## 진행 순서(권장)
C2a(노드 diff + before/after) → C2b(엣지 우회 라우팅) → C3(패널 좌측 + 필터/포커스) → C4(속성 인스펙터). **노드 우선.**

## 정렬 후처리 + 흐름 방향 (C2 캔버스 폴리시 — dagre 위 얹는 순수 좌표 변형)
- **흐름 방향 토글 (LR/TB)** — 헤더 버튼으로 좌→우(기본)/상→하 전환. 맵이 한 축으로 길 때 반대 축 사용. 아래 후처리·핸들·아크·삭제배치가 모두 방향 파라미터(`dir`)로 일반화됨.
  - `layoutWithDagre(…, rankdir, spacing?)` — 전개방향 간격 75%(LR ranksep 120·TB ranksep 150), TB 좌우(nodesep) 120. spacing 오버라이드로 에디터 기본값 불변.
  - `alignBackbone(…, dir, spine)` — cross축(LR:Y·TB:X) 정렬. **연결성 기반 spine**(유지 ∪ 분기없는 단일 연속 인라인 삽입)만 라인에 스냅, 병렬 곁가지 제외 + `BRANCH_PUSH`(60px)로 곁가지를 라인에서 더 이격(있던 방향)해 병합 엣지 단일 꺾임. 실측 렌더 치수 `COMPARE_RENDER_H`(process/terminal 38·decision 96·subprocess 64)·`COMPARE_RENDER_W`(process 150·terminal 90·decision 96·subprocess 180)로 중심 계산 — nodeSizeOf(dagre 박스)는 실제와 달라 TB 세로 엣지가 꺾이던 것 해결(스파인 중심 X 완전 일치).
  - **하위프로세스 핸들** — 비교뷰(diff)에선 subprocess도 4변 핸들(`NodeHandles`) 렌더(`process-node.tsx`), `withSubprocessHandles` remap 미사용 → TB에서 상/하 진입 가능(배송준비→품질검사 세로).
  - `handleSides` — 각 끝에 **의미상 정해진 변을 직접 배정(핸들 공유 허용)**. 그리디 4변 회피는 엣지 많은 노드(결제처리: 있음·곁가지2·다음·재시도=5개)에서 곁가지를 반대편(아래)으로 밀어 꼬았으므로 제거. 규칙: passthrough=우회 변(LR bottom/TB right), back=우회 변(LR top/TB left), off-spine 노드 자신=흐름축 변(이전=뒤·다음=앞), spine↔off-spine=spine이 cross측, 둘 다 spine=흐름축. 결과(표기 [출발변−도착변]): LR 위 곁가지 `[U-L]`·`[R-U]`·아래 삭제 `[D-L]`·`[R-D]` / TB 좌 곁가지 `[L-U]`·`[D-L]`·우 삭제 `[R-U]`·`[D-R]`. spine은 `computeSpine`로 추출해 alignBackbone과 공유.
  - **변경 필 불투명**(`DiffFieldPills`) — 필 배경을 노드 fill과 동일 `color-mix(changed 12%, white)`로 불투명화 → 뒤 우회 아크가 비쳐 변경 내용 가리는 것 방지.
  - `RemovedArcEdge` — `sourcePosition`으로 LR 아래 dip / TB 우측 bulge.
  - `minZoom=0.2` + `ReactFlow key={flowDir}` 재마운트로 방향 전환 시 정확히 fitView(effect 레이스 회피).
- **z-index** — `.react-flow__node{z-index:2}`로 변경 필/노드를 엣지 위로(변경 내용 우선).
- **wrap(접힘) 시도 → 롤백**: 4행/2행 접힘은 세로 브릿지·교차 아크가 늘어 오히려 복잡 → 제거하고 방향 토글로 대체.

## 비고
- **각 단위는 행(sub-unit)으로 쪼개 개별 트래킹**(R 시리즈와 동일). 단위별 커밋 + 시현 데이터 세팅 + 이 표 갱신.
- **후속(범위 밖)**: 엣지 라벨·분기 "changed" 감지 → 엣지 계보 id(DB 스키마 추가) 필요 시 별도 논의.
