# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷) + git history로 아카이브한다.

## 2026-08-23 — 노드 간격 자동 재조정 height-shift 설계 (feat/node-spacing)
- 브레인스토밍 확정: 원래 간격 보존·아래 전체(행 보존)·상시 자동·실측 기반 Y 계단함수(inline-shift 수학 재사용). 스펙 docs/superpowers/specs/2026-08-23-node-spacing-design.md. 플랜 5태스크(모듈 TDD→합성/역변환→생성 스윕→rAF 트윈→스모크). 스펙 정정: 인라인 펼침 중 V1 비활성(자식 합성 좌표 결합 리스크)·앵커 allowlist·경계 등호 계약.
- Task 1(TDD): `lib/height-shift.ts` 신설 — getDisplayHeight(measured 우선/추정 폴백)·buildHeightSteps(앵커 필터+행 병합)·buildYOffsets(nodewise 오프셋) 3함수, 테스트 9/9 통과. 게이트 그린: vitest 749(740→+9) / tsc 0 / lint 0.
- Task 2(에디터 합성): page.tsx에 ySteps/yStepsRef/yOffsets 메모 + displayNodes 오프셋 합성 + dropDraggingPositions Y 역변환. React Compiler 랜드마인: yStepsRef는 dropDraggingPositions(앞선 useCallback)보다 먼저 선언해야 함(TDZ 회피 컨벤션, nodesRef와 동일 패턴) — ySteps 메모 옆에 두면 `react-hooks/immutability` lint 에러. 게이트 그린: vitest 749 / tsc 0 / lint 0 / build 성공. 수동검증(playwright-core+시스템 Chrome, 격리 dev.db): Show more→노드 ~61px 하강, Show less→정확히 원위치(diff=0), 오프셋 활성 중 드래그해도 저장좌표는 역변환값(509)으로 저장되고 새로고침 후에도 동일(509→509, 오염 없음) 11/11 통과.
- Task 3(생성 좌표 스윕): `toSavedPoint` 헬퍼 + `screenToFlowPosition` 7지점 중 6곳(노드 생성·크로스맵 붙여넣기·라이브러리/섹션 드롭·링크노드 추가) 감쌈, 드래그 중 그룹 히트테스트 1곳(persist 안 됨)은 제외. 게이트 그린: vitest 749 / tsc 0 / lint 0 / build 성공. 수동검증 14/14 통과 — 밀린 영역 우클릭 추가 시 저장좌표가 "역변환 적용" 가설에 2px, "미적용" 가설에 108px로 명확히 판별, 새로고침 후 표시좌표 완전 일치(dist=0).
- Task 4(rAF 트윈): displayNodes가 `yOffsets`(목표) 대신 `renderYOffsets`(rAF로 350ms cubic ease-out 보간된 값)를 읽도록 교체, 즉시 적용 3조건(첫 산출·드래그 중·prefers-reduced-motion)은 브리프 스니펫 그대로 적용(set-state-in-effect는 rAF 경유라 lint 통과). 게이트 그린: vitest 749 / tsc 0 / lint 0 / build 성공. 수동검증 11/11 통과 — Show more 클릭 후 resize-observer 재측정 지연(~300ms) 뒤 350ms 트윈 시작, 3시점(y=529.664→536.089→538.804) 엄격 증가 후 539에 정착, 엣지 endpoint(548.66→555.09→557.80)도 동행 이동, 로드 직후 4시점 모두 동일(출렁임 없음), 트윈 도중 반대로 재클릭해도 오실레이션 없이 원상태로 수렴.
- Task 5(스모크): `frontend/scripts/pw-smoke-height-shift.mjs` 신설(io-links 골격 복제) — Show more/less 밀림·복원(B·C 동일 델타 ±2px)·저장좌표 불변(pos_y 280 유지)·펼친 상태 드래그 라운드트립(display 오프셋 미누출, 401≈400) 12/12 통과. 랜드마인: fitView는 로드 시 1회뿐이라 height-shift 성장 후 밀려난 노드가 좁은 뷰포트를 벗어나면 마우스 드래그가 클립돼 안 먹음 — 뷰포트를 세로로 넉넉히(2000px) 잡아야 함. 게이트 그린: vitest 749 / tsc 0 / lint 0 / build 성공, backend/ 변경 없음.
- 최종 리뷰 fix-wave(C1/C2/I1/I2): `onNodeDragStart`가 넘기는 건 표시좌표라, swapNodes(C1)·applyCtrlDragCopy(C2) 두 드롭 경로가 이를 역변환 없이 저장 좌표에 그대로 써 saved_y가 드리프트하던 버그를 `toSavedPoint`/`displayToSavedX`로 봉합. groupBoxes/findGroupAt(I1)·PNG export(I2)는 저장좌표 기준 bbox라 표시 밀림 중인 멤버/하단 행과 어긋나던 것을 renderYOffsets 가산으로 표시좌표 일치. 랜드마인 재확인: ref-미러-TDZ 패턴은 미러링 useEffect가 아니라 **ref 선언 자체**가 최초 사용 useCallback보다 먼저 와야 한다(renderYOffsetsRef를 yStepsRef 옆으로 이동, 안 그러면 `react-hooks/immutability`). 실브라우저 검증(C1 실제 드래그+존 스왑 gesture, I1/I2 expand 전후 델타 대조, C2는 CDP Ctrl모디파이어 미전달로 실제 프로덕션 함수 재사용한 산술 검증 3건) 전부 통과, 스모크 12/12 재확인. 게이트 그린.

## 2026-08-21 — 노드 IO 연결(불러오기) 설계 스펙 (feat/io-linking)
- UI 문자열 em-dash(—)→하이픈(-) 일괄 스윕(i18n 179줄+소스 65줄+테스트 단언 8줄, 주석·테스트 제목 제외 — 8f254b44 컨벤션 확장). QA S1의 배너 title 전문도 하이픈으로 변경됨.
- SP 배너 한 줄화: 짧은 전용 문구(Update available/Pinned version)+truncate, 전문은 title 툴팁.
- SP 버전 추적 배너 2종(하단): 새 발행본=accent 틴트 배너(기존 점+텍스트 대체), 핀 고정=중립 배너(신규 — 캔버스엔 추적 표시가 없었음). 새 발행본이 핀 안내를 함의해 단일 노출.
- SP 캔버스 IO에 양식 아이콘(sp_*_forms 스레딩 누락이 원인 — 모델·API엔 이미 존재)·SP 마크 라벨 앞 인라인화(이하 행 전체 폭).
- IO 행 다듬기 2R: 디시전 라벨 max-w-24·긴 항목 2줄 클램프·미체크 인풋 필수/선택 글자색 분류·양식 아이콘 맨 뒤 고정+툴팁·Show more/less 호버 노출+셰브론.
- 후속 5종: kbd 힌트(Alt/Shift 병기)·디시전 1:1.2(116px, nodeSizeOf/COMPARE_RENDER_W 동기)·인쇄=클램프 해제만(폭 원복)·IO 흰 배경+행 호버+체크박스 호버 노출+체크 하이라이트·펄스 저배율+링(캡 경계 잘림 픽스).
- M7 픽스: PNG 픽스업이 flex에 눌려 폭 무효 → width·flex-shrink 강제. M3(캡만으론 워스트 겹침 잔존)은 #1 별도 브랜치 근거로 기록.
- SP 배너 한 줄화 검수 S1(`f694db13`, ✅·드라이버 6/6·콘솔 에러 0): `Update available`/`Pinned version` 짧은 문구가 `truncate`로 한 줄(scrollHeight=clientHeight=line-height 16, 배너 22px) 고정되고 전문은 배너 title 툴팁으로 이동, 배너 상호 배제 유지. R1·R2의 2줄 측정은 이 커밋으로 대체(문서 교차참조 반영).
- SP 버전 배너 브라우저 검수 R1~R4(`c0668d94`, 4/4·드라이버 13/13·콘솔 에러 0): 새 발행본 배너(accent-tint·CircleArrowUp 12px·전체 폭 154px·2줄 감김·아이콘 상단 정렬)와 핀 고정 배너(surface-alt·hairline·Pin) 확인, 구 6px 점 제거·update가 pinned를 함의해 배너 상호 배제·추종 노드 무배너, 노드 폭 180px과 핸들 무영향, 인스펙터 Follow-latest 토글 시 핀 배너가 리로드 없이 즉시 소멸. 교훈: `empty:hidden` 자식은 offsetTop이 0이라 중앙정렬 판정은 보이는 자식만 골라야 오탐이 없다.
- SP 양식·마크 브라우저 검수 Q1~Q4(`4dbfa7f2`, 3✅/1➖·드라이버 16/16·콘솔 에러 0): 지정 맵 양식이 SP 캔버스 행까지 상속돼 아이콘이 실제로 보이는 것(크기·박스 내·텍스트 오른쪽) 확인, 마크 인라인 이동으로 IO 목록 폭 136→154px·긴 맵 이름 4줄이 아이콘 옆에서 감김, 제목만일 때 세로 중앙·새 발행본/미지정 배지·핸들·타 노드 무영향. Q2 네이티브 툴팁 실물 촬영은 macOS 화면 기록 권한(TCC) 부재로 3경로 모두 차단 → 성립 조건만 DOM 실측(➖). 교훈: SVG엔 offsetLeft가 없어 위치 비교는 rect로.
- IO 행 다듬기 브라우저 검수 P1~P6(`eb71c57d`, 6/6·드라이버 23/23·콘솔 에러 0): 디시전 제목 96px(58자는 3줄 클램프 유지, 32자는 이제 말줄임 없이 수용)·71자 항목 2줄 클램프+체크박스 첫 줄 정렬(mt 2px)·optional만 ink-muted(아웃풋 불변)·양식 아이콘 행 끝 고정(잘린 행에도 유지, SP 행은 없음)·접기 버튼 호버 노출+셰브론 방향·회귀(헤더 접기/펄스/인쇄/N라운드) 전부 통과. 교훈: 게시 워크플로가 남기는 notifications는 맵 cascade 밖이라 검수 teardown에서 map_id 스코프 삭제 필요.
- 사용자 후속 5종 브라우저 검수 N1~N8(`ad0131ec`, 8/8·드라이버 30/30·콘솔 에러 0): kbd 힌트 4표면·Shift/Alt+Enter 실키 입력·디시전 116×96(마름모 실측 비율 1.200, 드롭 충돌 dx 155px로 nodeSizeOf 반영 확인)·GMP 필과 코멘트 배지 15.8px 이격·인쇄는 클램프만 해제(3L→4L @80px)·IO 행 호버/체크 강조·캡 경계 펄스 잘림 0·비교뷰 TB 세로 엣지 Δx 0. M7의 200px 폭 강제는 이 커밋에서 되돌려져 계약이 "클램프 해제만"으로 축소 확정.
- 워스트케이스 개선 브라우저 검수 M1~M10(`fe7b86bd` 8✅/2❌ → M7 픽스 `140367a5` 재검증으로 9✅/1❌·콘솔 에러 0): 체크리스트 3단계·체크 동기 애니(120ms 지연 실측)·디시전 클램프/배지 코너·엣지 라벨 줄바꿈·힌트 4표면 통과. M7은 `width`+`flex-shrink:0` 추가로 인쇄 시 제목 박스가 실제 200px가 되어 4L→2L·6L→3L로 넓게 착지. 남은 #3(캡만으론 노드 높이 710→628px뿐이라 아래 노드와 겹침)은 #1 간격 재조정 이월 브랜치로 넘긴다.
- 워스트케이스 피드백 #2~#7: IO 체크리스트 3단계(0/3.5/전체)+체크 동기 애니메이션(상대 자동 펼침·행 플래시·체크 팝), 디시전 GMP 좌상단·제목 3줄 클램프(+PNG 인쇄 시 폭 해제 픽스업)·배지 코너 이동, 엣지 라벨 max-width 160 자동 줄바꿈, Alt+Enter 힌트 4표면 노출. #1(높이 기반 간격 재조정)은 중~대형 판정 — 별도 브랜치 이월(+#2의 전체펼침 연동 효과 포함).
- GMP 안내 팝오버 여백 보강: 440px + 좌우 패딩 px-5(왼쪽 타이트 해소).
- 안내 호버 미리보기 개편: 딤 → 액션 후 남을 값만 남기고 반대쪽+화살표 폭 접힘(자연 이동), 캔버스 노드에도 결과값(분류·색) 임시 반영(gmpPreview 렌더 전용).
- GMP 안내 팝오버 폭 400px + 배지·버튼 nowrap(두 줄 꺾임 제거), 인스펙터/모달 GMP 배지도 nowrap.
- #6·#7 재배치: 스테이징/미리보기를 픽커에서 제거(즉시 적용 원복, 아이콘·동일값 가드 유지) → 안내 팝오버(GmpNoticePopover)로 이동 — 버튼 아이콘+우하단 확인, 호버 시 되돌릴 값만 강조, 바깥 클릭 닫힘.
- UI/UX 배치4(#11~#13): 노드 상세 모달 — SP 상속 상세(IO/조건) 동기화, 읽기전용 분기 전면 최신화(속성·GMP 배지·포맷 파라미터·IO 필 통일), IO 읽기 행 필 디자인(형식·R/O).
- UI/UX 배치3(#1·#2·#14·#15·#16): 미러 1클릭=행 포커스·더블클릭=이동, 읽기전용 링크 클릭=연결 노드 드롭다운(IoPeersMenu), IO 행 컨트롤 인박스+호버/선택 노출·R/O 플래그 플래시, 애니메이션 중 클릭 선택-인스펙터 불일치 픽스(select 변경 미러링), GMP 태그·체크박스 탭 순회 제외.
- UI/UX 배치2(#9·#10): 캔버스 노드 표시 규범 순서 고정(속성→지표→조건→IO — 토글 순서 의존 제거)·IO 체크리스트 영역(화면 한정, 링크 itemId 키로 그룹 동반 체크).
- UI/UX 배치1(#3~#8): GMP 픽커 리디자인(스테이징+Confirm+호버 미리보기 강조·별도 컴포넌트)·미분류=기본색 리셋·필 nowrap·인스펙터 GMP 행·읽기전용 빈 섹션 딤·노드 디스플레이 카테고리 눈 버튼.
- QA 이슈 #2 픽스: 전 줄 무효 플래그 셀 '제공' 판정 분리 + required 토큰 신설(Optional 명시 리셋 경로).
- 백로그 반영 ①CSV Input_Flags 컬럼(왕복+병합 규칙+템플릿/AI 프롬프트, 선행 빈 줄 보존 rawCellOf) ③끊긴 흐름 경고 배지(인풋 미러 한정, getBrokenInputMirrorIndexes).
- 이연 폴리시 일괄 해소: dirty Import 툴팁 span 래핑·appendIoRow flags 소거·후보 useMemo·subprocessRefs 루트 우선·aria-label·dead code/들여쓰기·assignSpIoIds 빈 줄·테스트 5건 보강·스펙 문구 2곳 정정.
- 브라우저 QA 54항목 전수 통과(`docs/qa/io-linking-qa.md`) — 1차 검수에서 나온 이슈 #1(미러 호버가 형제 미러까지 점등)을 `34ccb79e`로 수정하고 F2·F3 브라우저 재검증까지 완료, 미해결 이슈 없음. 체인·병렬·순환·SP·읽기전용/뷰어 토폴로지 실기동, 읽기전용 판정은 게시 버전+권한 뷰어 두 경로로 검증.
- 브레인스토밍 확정: 링크 그룹(원본 1+미러 N, 원본=항상 아웃풋/SP)·상류 합류 시 원본 승계·itemId-only 참조(clone 리매핑 불요)·복사 저장+로드 정합화·인풋 필수/선택 플래그(소비 노드 로컬). 스펙 `docs/superpowers/specs/2026-08-21-io-linking-design.md`.
- 구현 플랜 작성 `docs/superpowers/plans/2026-08-21-io-linking.md` — 10태스크(백엔드 스레딩→FE 직렬화→io-items 라이브러리 4분할→MVI/모달/배선→스모크), 코드 정독 기반 실 코드 포함.
- Task 1: 백엔드 스키마 6컬럼(Node 4·ProcessMap 2) 스레딩 — models/db/schemas/graph upsert/versions clone/maps 지정 저장/subprocess.py 3중 위치일치 select-kwargs-unpack. TDD RED→GREEN, 전체 1147 passed.
- Task 2: FE 타입·직렬화 스레딩 — api.ts(GraphNode·SubprocessRef·지정 payload)·canvas.ts NodeData·page.tsx(toAppNodes/buildGraph/aiNodeToGraphNode)에 IO 링크 4필드 왕복, csv-import.ts mergeNode 보존규칙(텍스트 동일=유지/변경=소거), 노드 복사 2경로(applyCtrlDragCopy·buildPaste)는 output_ids만 소거·*_links/input_flags는 유지(§6). TDD RED→GREEN, 전체 671 passed.
- Task 3: `lib/io-items.ts` 신설 — 줄 헬퍼(getIoLine/setIoLine/countIoLines)·상태 판정(origin/mirror/plain)·맵 전체 인덱스(buildIoIndex·buildIoMirrorIndex, 중복 itemId는 선착만 원본)·SP 지정 저장용 전 줄 id 부여(assignSpIoIds, 텍스트 일치 줄만 기존 id 승계). TDD RED→GREEN, 전체 683 passed.
- Task 4: `lib/io-items.ts` 확장 — 전방 BFS 최단 경로(getFlowPathBetween·canReachForward)와 불러오기 후보 수집(collectIoImportCandidates, 홉별 BFS+사이클 차단·alreadyLinked/자기그룹 재수입 제외·미지정 SP 제외·댕글링 링크는 groupId null). TDD RED→GREEN, 전체 697 passed.
- Task 5: `lib/io-items.ts` 불러오기 실행 — applyIoImport(mirror/takeover/succession/join 4시나리오+SP join, appendIoRow로 줄 정렬 동반 추가). TDD RED→GREEN, 전체 709 passed.
- Task 6: `lib/io-items.ts` 전파·정합화 겸용 패스 — propagateIoLinks(미러 텍스트/폼 동기화·댕글링/중복/자기참조/id+link공존 소거, changed=false는 입력 배열 참조 그대로 반환)·getIoLinkPeers(원본→mirrors, 미러→origin). TDD RED→GREEN, 전체 724 passed.
- Task 7: `multi-value-input.tsx` 확장(컴포넌트 전용, 배선은 후속 태스크) — 5열 행 버퍼(text/form/id/link/flag)·+ 버튼 섹션 호버 공개(`group/iosec`)+Add new/Import from node… 2항목 메뉴(mousedown/Esc 닫힘)·미러 행(Link2→Link2Off 호버 스왑, readOnly input, 정적 폼 텍스트)·원본 행(Link2 배지)·필수/선택 플래그 필. 기존 두 호출부는 신규 props 전부 optional이라 무변경 호환. 4게이트(tsc/lint/vitest 724/build) 그린.
- Task 8: `io-import-modal.tsx` 신설(컴포넌트 전용) — EdgeSelectModal 크롬(포탈·투명 백드롭·Esc·edge-row-in)을 본떠 필터 입력+hop≤2 축약(Show more)+nodeId 연속 캡션 그룹핑+행 배지(SP 필/Link2)로 IoImportCandidate 선택 UI 구성. 4게이트(tsc/lint/vitest 724/build) 그린.
- 후보 수집 픽스: 운영 레거시 SP 지정은 `sp_*_ids`가 비어 있어 후보 클릭이 조용히 무동작 — id 없는 SP 항목은 아예 후보에서 제외(applyIoImport의 null 가드는 방어로 유지).
- Task 9 리뷰 픽스 3건: 일괄편집 교체·비우기가 IO 링크 4열을 남겨 전파가 엉뚱한 행을 덮어쓰던 파손 차단(`buildBulkAttrPatch` 정렬 열 동반 소거, 스펙 §5 서술도 사실대로 정정)·노드 하이라이트 CSS를 Turbopack purge 대상인 globals.css에서 page.tsx raw `<style>`로 이전·디바운스 autosave 타이머가 예약 시점 클로저로 PUT하던 창을 `readOnlyRef` 재확인으로 봉쇄(권한 도착 전 열기만 해도 403 나던 경로).
- Task 9: 에디터 배선 — 로드 정합화(루트 스코프, 치유분은 autosave 동승)·노드 데이터 쓰기 2경로 전파(rootGraph 미로드 시 SP 미러 오판 방지 가드)·인스펙터 IO 카드 4열 draft+해제 팝오버(Save 전 취소)·불러오기 모달/토스트 4종·노드·엣지 hover 하이라이트·SP 지정 저장 시 항목 id 승계. 노드 편집 모달에도 링크 4열을 왕복시켜(미노출) 행 삭제 시 열 정렬 어긋남을 차단하고, `MapOut`에 `sp_*_ids`를 노출해 지정 재저장이 기존 id를 승계하도록 했다(없으면 매 저장마다 소비 맵 미러가 전량 해산).
- Task 10(브랜치 마무리): `frontend/scripts/pw-smoke-io-links.mjs` — API로 맵 시드(Start→A(output 회의록)→B→End)해 UI로 불러오기·하이라이트(`.edge-hover-highlight`/`.io-node-highlight`)·리로드 라운드트립·원본 편집 전파·해제 draft 취소/영속을 실브라우저 검증(26/26 PASS). teardown은 소프트삭제(API)+ORM cascade 하드퍼지(`_purge-test-map.py`, `MapPermission`은 cascade 밖이라 별도 삭제)로 `/api/admin/tables` 행수가 리셋 시드 베이스라인과 완전 일치함을 확인(zero residue). 전체 게이트 그린: BE pytest 1148 passed·ruff clean, FE vitest 726 passed·tsc clean·lint clean·build 성공. pw-smoke-task8.mjs의 미사용 변수 lint 경고도 함께 정리.
- 최종 리뷰 픽스 2건: `handleNodesDelete`(RF `onNodesDelete`, 유일한 삭제 경로)가 propagateIoLinks를 안 돌려 원본 노드 삭제 후 미러가 잠긴 채 남던 버그 수정 — RF는 실제 제거보다 onNodesDelete를 먼저 호출하므로 setNodes 콜백 내부에서 직접 걸러낸 배열로 돌림(§5). `_ADDED_COLUMNS` io-linking 6건 잠금 pytest 추가(`test_db.py`, mutation-check로 RED 확인 후 원복).

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
- 인터뷰 텍스트 직렬화 키를 고유 필드로 승격(기조: 노드↔SP 대칭) — **touch_time 7번째 공용 파라미터**(duration H.MM 완전 미러: 정규화·Σ·CSV 20열·Excel·일괄편집·SP 상속 5필드·칩=스톱워치 아이콘), 노드 input/output(개행 복수·Details 카드/편집 모달 공용 `NodeDetailsFields`)·시작/종료 조건·data_form(IO 종속 행)·system_fallback, 맵 sp_조건·GMP 3값+폴백 5종. 설계 `docs/design/2026-08-19-field-promotion-design.md`.
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

## 2026-08-04 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-08-12 이동분 포함) + git history.
