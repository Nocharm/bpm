# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷 + 이후 이동분) + git history로 아카이브한다.

## 2026-10-02 — 데이터 입출력 계약 최신화 (feat/io-contract-refresh, 진행 중)

- 전수 감사(10표면 93건 → 62건 반박 검증, 출력 규칙 머지 후 재검증 52건 + 병렬 출구 신규 43건) 결과를 클러스터별로 반영 중.
- **Start 기본 병렬**(사용자 결정): start는 출력 규칙 밖(연결 1개 이상 허용, 팬아웃은 병렬로 읽고 펄스·배지), 우클릭 병렬 토글은 숨김 — CSV 루트 여러 개가 만든 Start 팬아웃이 저장을 막던 문제 해소. FE `output-rules.ts` ↔ BE `find_output_rule_violations` 동치, AI 연결 규칙 문구 갱신. 체크리스트·확정 게이트 라벨은 "갈래는 판단 노드나 병렬 출구로"(en "Splits use a decision or a parallel exit").

## 2026-10-01 — 출력 규칙 통일: 출구당 1개·병렬 출구·SP 출구 한 점 (feat/output-rules → dev)

- **규칙**(사용자 결정, 일반 맵·L5 캔버스 공통): 출구(일반 노드 `__primary__`, SP는 끝 키)마다 엣지 1개, 병렬 출구는 2개 이상, decision은 예외. 단일 소스 `lib/output-rules.ts` ↔ BE `find_output_rule_violations`(확정 게이트 6, 끝마다 정상 연결된 다중 끝 SP가 막히던 것 해소). 삽입 재연결의 일시 초과는 허용하고 저장 체크리스트(수동 저장·승인 시작)가 막는다 — 종전엔 SP를 통째로 면제해 대표 끝 2엣지가 새어 나갔다.
- **SP 핸들**: in 핸들은 받기 전용(`isConnectableStart=false`, 연결 드래그 중에만 노출 — 좌·상·하에서 끌면 역방향 연결로 입력 엣지가 생기던 버그), 끝 핸들은 우측 한 점에 겹쳐(세로 분산이 폭 그립과 겹침) 끌어 놓으면 출구 목록, 팬아웃 그룹 키 (노드·변). 제목 끝 인라인 배지 `출구 사용량/끝 수`(병렬 출구는 1), 초과는 같은 알약이 `+N`·호버 시 `4/3`.
- **병렬 출구**: 노드 속성 `nodes.parallel_outputs`(JSON 출구 키, `_ADDED_COLUMNS`, 저장·클론·확정 서명·비교 diff `parallel` 필드·인스펙터 행). 노드 우클릭 "병렬 출구"(SP 끝 ≥2는 끝별), 병렬 출구엔 갈래 추가 시 충돌 모달 없음(레거시 gateway 병렬 포함), 호버 배지. 시각 강조는 시안 4라운드 끝에 **흐름 펄스**(`lib/edge-pulse`·`EdgePulseDot` SMIL: 병렬=형제 동시 건너기, 분기=머뭇거린 뒤 한 갈래·회차 순환) — 갈래점 기호는 출구가 여러 변이라 폐기, RF 엣지별 svg라 마운트 때 SMIL 시계를 페이지 시계에 맞춤. 레거시 `gateway=parallel`은 마이그레이션 없이 병렬로 도출. 클립보드 사본은 병렬 해제(갈래 2개 이상 함께 복사되면 유지).
- **임포트·계약**: 인터뷰 JSON 0.5 형식 무변경. L5 연계는 전부 병행 팬아웃 출발 출구를 병렬로(보강 시 기존 비병렬 진출 노드는 제외), L6 어댑터는 병행 표시를 `CanonicalNode.parallel`로 들고 가고(종전엔 증발) 전부 병행이 아닌 팬아웃 뒤에 ◇ 자동 생성(L5와 같은 이름 규칙, FE 미리보기 미러, `map_to_row`가 접음, 재임포트 서명 포함). 프롬프트 3곳+외부 프롬프트+0.5 문서에 출구당 1개 명시. 에디터 AI `attributes.parallel`·"병렬출구" 메타·구조 힌트(제목·사유 병기)·"출발 노드에 set_attr" 예시, 비교 AI 요약은 값 풀이·추정 금지 — 실모델(gpt-4o-mini, SGLang 필드 제거 프록시) 실측으로 보강. CSV `Parallel` 열(Y/N, 빈 칸=유지, Next ≥2라도 Y면 병렬 일반 노드).
- 검증: Fable 5.1 리뷰 서브에이전트(버그 0, 누락 6건 반영) · pytest 1595 · vitest 1135 · 스모크 `pw-verify-output-rules.mjs` 33/33 · sp-ends 23/23 · fanout 24/24 · framework-canvas 25/25. 배포: FE/BE 동시(새 컬럼), 서버 `ai_prompts` 오버라이드 확인, 반복이 있는 L6 재임포트는 새 버전 1회.

## 2026-10-01 — 홈 한 줄 행 말줄임 정리 (dev)

- 영/한 실측 프로브(뷰포트 1920~1100)로 두 줄 넘침·카드 밖 밀림을 수집해 3곳 수정: 대시보드 섹션 헤더(6카드 공용) 제목은 한 줄 고정·더보기 라벨이 말줄임으로 양보("My documents"·"My department" 두 줄 해소), 내 부서 범위 필 `min-w-0`(긴 부서명이 상태|버전 탭을 카드 밖으로 밀던 것), 맵 상세 버전 이벤트 칩 줄은 반쯤 잘린 칩 대신 들어가는 칩만 통째로(1줄 높이 wrap). 뒤 칩부터 말줄임(flexShrink 가중)은 칩이 전부 최소폭으로 찌그러져 폐기.
- 버전 타임라인 접힘 줄의 우측 게시 필이 만료 버전에도 green "Published"로 남아 전부 게시처럼 보였다 — 버전 상태가 expired면 중립 톤 "Expired", 좌측 타임라인 노드도 중립 테두리, 아이콘은 노드·필 모두 게시 Upload 대신 TimerOff(최근 변경 카드의 만료 아이콘과 통일). 백엔드가 남기는 `expired` 이벤트가 라벨·아이콘·색 표에 없어 펼침에 원문 "expired"·기본 아이콘으로 나오던 것을 등록(한/영 "만료"/"Expired"), 접힘 줄은 우측 만료 필 + 칩 줄은 게시부터(최신순)(게시 이력은 툴팁·펼침 상세에 유지). 맵 설정 버전 카드는 만료 버전에 단계 칩을 그리지 않아 해당 없음.

## 2026-10-01 — 맵 설정 UX 라운드: 오너 이전 후보 버그·협업자 행·드롭다운·SP 타일·버전 카드 (feat/map-settings-ux)

- **버그** — 소유권 이전 후보가 명시 user 권한 행(editor/owner)만 모아 오우닝 부서 소속(권한 행 없는 파생 editor)이 빠졌고, 백엔드 `transfer-owner`도 권한 행이 없으면 409였다. 표시명도 목 시드라 아이디로 보였다. 수정: FE 후보 = 명시 editor+ ∪ 디렉터리에서 오우닝 부서(하위 포함, BE `belongs_to_department` 미러 `lib/owner-candidates.ts`) 소속, BE는 파생 editor 대상이면 owner 행을 새로 만들어 이전(테스트 2건). 권한 응답에 `granted_at` 추가(협업자 행 메타).
- **UX(목업 A~E 승인, 사용자 보정 2건: 버전 카드 스트라이프 변 보더 제거·우측 액션 200px 등폭, 드롭다운은 트리거 등폭·간극 0)** — 레일+h2 섹션 아이콘·요약 카운트, 협업자 행(아바타·언어별 주/보조명·아이디·직급·소속/구성원 수·부여자·일시) + `PersonHoverCard`(배너에 이 맵 권한 1줄)·부서는 `OrgInfoModal`, 네이티브 select 3곳(역할·GMP·이전)을 `MenuSelect`(신규)·`SearchSelect`로 교체하고 `.dropdown-in` 등장을 한 벌로(위로 뒤집힐 땐 bottom 앵커로 밀착), 역할 메뉴 Owner 항목(빨간 호버) → `TransferOwnerDialog`(위험 구역과 공용) 게이트, SP 지정 정보는 `SpFieldTile(readOnly)` 4열 그리드(빈 필드 "미입력" 유지), 버전은 상태 스트라이프·메타·결재자 아바타·진행 단계 칩 카드. 본문 폭 680→920. 스모크 `pw-smoke-map-settings.mjs` 26/26(임시 맵 e2e 이전 포함).
- **"조건 · GMP" 카드를 서브프로세스 섹션에 흡수(사용자 결정)** — 둘 다 같은 `sp_*` 컬럼을 읽고 썼는데(카드는 2026-08-19 인터뷰 필드 승격이 지정 없이도 검토하라고 붙인 것) 같은 값이 두 번 보이고 GMP·원문 메모는 한쪽에만 있었다. 이제 SP 타일 그리드가 단일 표면: 지정 여부와 무관하게 항상 보이고, 승격 필드(GMP·시작/종료 조건·소요/실작업시간·시스템)는 타일 클릭 팝오버(`SpFieldPopover`)로 바로 `PATCH /process-fields`, 원문 메모는 타일 아이콘 슬롯(`FallbackHint`), 나머지는 지정 모달 경로. `ProcessFieldsCard` 삭제, GMP 변경 알림 팝오버(되돌리기)는 팝오버 확정/취소로 대체. `pw-smoke-field-promotion.mjs` [17][18][19]를 타일 기준으로 갱신.
- 후속(dev): SP 타일 그리드를 섹션 폭 반응형(`@container`, 44rem 미만 2열·이상 4열, 헤더 액션 줄바꿈)으로, 버전 카드 좌측(스트라이프) 모서리는 직각(`rounded-r-md`) — 둥글면 스트라이프가 손톱처럼 보인다는 피드백.

## 2026-10-01 — 하위프로세스 출구 다중 연결 + 들어오는 문 네 방향 (feat/subprocess-ends → dev)

- SP 노드는 들어오는 문이 좌측 하나뿐이고 끝이 여러 개여도 출구 엣지가 전부 대표 끝으로 덮여(`withSubprocessHandles`) 끝별 흐름을 그릴 수 없었다. 사용자 결정 10건(설계 `2026-10-01-subprocess-ends-design.md`, main 머지와 함께 폐기): in만 네 방향(`in`·`in:top/right/bottom`), 끝마다 출구 엣지+끝당 출력 1개 규칙, 끝을 모르는 경로(드롭존 앞/뒤·역방향 몸체 드롭)는 출구 선택 목록 `EdgeEndModal`(대표 끝 첫 행), 출구 라벨 기본값은 끝 제목 **미러**(점선 알약·링크 아이콘, 저장 안 함), 스왑 다출력은 두 열 짝짓기 모달 `SwapOutputsModal`(짝=타깃만 교환, 라벨·끝 키는 노드 잔류, 확인해야 실행·취소=스왑 취소, 행 중앙 연결선+그려지는 모션), 펼침 게이트웨이는 끝별 호스트 엣지에만 매핑+점선 애니메이션, 합성 `sp-ends:` 안내 엣지 제거.
- 구현 축: 끝 키·in 변형 보존(`withSubprocessHandles`), 끝 한정 `sourceHandle` 인자 한 벌(`withEdge`·`insertNodeAfter/Before`·`removeOutgoingEdges`·`edgeAction/edgeSelect/pending`·`applyFlowEdges`), `swapNodeEdges(…, pairs)`, `toAppEdges` 로드 정규화(CSV·AI SP 엣지가 조용히 안 그려지던 잠재 버그 수정), `applyMirroredEndLabels` 렌더 전용. **실사고 1건**: 보조 끝 저장 엣지가 로드 직후 콘솔 에러 없이 사라짐 — 끝 핸들이 resolved 도착 뒤 늘어나는데 RF가 handleBounds를 재측정하지 않아서, `SubprocessHandles`가 끝 키 집합 변화마다 `updateNodeInternals`. 스모크 `pw-verify-sp-ends.mjs` 23/23(끝 3개 링크 맵 발행·지정, 로드·펼침·출구 목록·스왑 확인/취소·저장 payload). 불변식은 CLAUDE.md Lessons·spec §3.1, 설계 스냅샷은 main 머지와 함께 폐기(git history).

## 2026-10-01 — 엣지 팬아웃: 같은 핸들로 모이는 엣지의 나선 펼침 (feat/edge-fanout → dev)

- 같은 (노드·변·핸들) 앵커로 오가는 엣지(실데이터 13%, 루프백은 100%)가 스텁·화살촉·라벨까지 포개지던 것을 **렌더 전용 레인 배정**(`lib/edge-fanout.ts` `assignFanLanes` → `edge.data.fan`)으로 펼쳤다: 꺾은선은 게이트 포인트+원호, 곡선은 제어점 중첩, 직선은 끝점 ±3.5px. 에디터·비교·SVG 미리보기(역행) 세 표면, 저장 데이터·변·백엔드 무변경. 사용자 확정 4건(양쪽 끝·A 나선 아크·곡선 A/직선 분산/화살촉 한 점·세 표면). 반경은 배정 단계에서 압축 확정(끝마다 클램프하면 교차·NaN), 왕복 쌍(양끝 팬)은 중간 구간·라벨을 소스 레인만큼 비켜 세움. 스모크 `pw-smoke-edge-fanout.mjs` 25/25·펼침 `pw-verify-edge-fanout-expand.mjs` 10/10. 불변식은 CLAUDE.md Lessons, 설계 스냅샷은 main 머지와 함께 폐기(git history).

## 2026-09-30 — 슬라이드 매뉴얼 리스타일·카피 전면 요약 (main)

- **왜** — PDF를 실제로 내려받아 보니 슬라이드당 평균 5불릿·한국어 300자(영어 570자)의 문장형 텍스트에 레이아웃이 전부 같아 벽처럼 읽히고, 선언만 된 Pretendard가 설치돼 있지 않아 PDF는 시스템 폰트로 찍히고 페이지 번호도 없었다(사용자 지적 "글이 너무 많고 가시성이 떨어지고 단조롭다").
- **무엇** — 덱을 **카피 데이터(`docs/manual/slides/content/*.py`) + `theme.css` + `build_deck.py`**로 다시 빌드. 불릿 858개를 "리드 키워드 + 한 줄 설명" 포인트로 전면 요약(UI 요소명은 바이올렛 필 `<b>`, 키는 `<code>` 칩), 표지·챕터 구분은 L5 대시보드와 같은 네이비→차콜 하늘, 이미지 없는 슬라이드는 카드 2열, 표는 헤더 배경+얼룩 행, 슬라이드마다 푸터(덱 이름·페이지 번호), 스크린샷은 브라우저 창 프레임, Pretendard Variable data URI 임베드. 이미지 111컷은 직전 덱에서 순번 이월(재촬영 없음). 사용자 덱 ⑧ 구분 문구의 "네 가지 형식(Word 포함)" 잔재도 세 가지로 정정.
- **결정** — 증분 수술 도구 `build_slides.py`는 폐기(카피가 데이터로 들어가면서 수술 대상이 사라짐). 다음 회차부터는 content의 카피/`shot` 경로만 고치고 빌더를 돌린다. 넘침 검사 4덱 0건, PDF 4종 재출력.

## 2026-09-30 — 홈 대시보드 연동 액센트 바 등장 애니메이션·빛띠 (main)

- 500ms 지연 뒤 inset box-shadow가 150ms에 그냥 켜져 "갑자기 생기는" 느낌 → `globals.css .hover-linked`로 교체: 좌측 2px 바(::before)가 세로 중앙에서 700ms smooth로 자라나고, 같은 순간 옅은 액센트 빛띠(::after 7%·1.8초 ease-in-out, background-position만 이동이라 overflow 불필요)가 행을 한 번 훑는다(1차 spring 350ms·12%·0.9초는 튀어 보여 완화, 사용자 피드백). 지연은 keyframe delay라 스쳐 가는 호버엔 안 뜨고 이탈 시 즉시 사라지는 동작은 그대로. reduced-motion은 모션 없이 지연만 유지. 스모크 `pw-shot-home-linked-hover.mjs`는 pseudo 요소 computed style로 판정.

## 2026-09-30 — 매뉴얼 슬라이드 PDF 앱 내 다운로드 (main)

- 슬라이드 PDF 4종은 저장소에만 있고 앱에서 받을 길이 없었다 → `frontend/public/manuals/`로 옮겨 `/manuals/<deck>.pdf`로 정적 서빙(Dockerfile이 `public/` 복사·nginx `/`→Next라 배포 파일 변경 없음, 스탠드얼론 조립으로 4종 200 확인). `/manual` 뷰어의 "한눈에 보기" 메뉴를 env 없이도 상시 표시로 바꾸고 사용자·관리자 PDF 항목을 추가 — 클릭 시 바로 받지 않고 한국어/English 선택 다이얼로그(`ManualPdfDialog`, 사용자 결정)를 거친다. `export-pdf.mjs` 출력 경로도 `public/manuals/`로. 파일명 계약은 `lib/manual-pdf.ts`(vitest가 실존 검사), 스모크 `pw-manual-pdf.mjs`.

## 2026-09-30 — 정리 라운드: 메모리·md 문서·매뉴얼 5차 (main)

- **md 정리**: main 머지 완료된 AI L5 캠페인 스펙 3종(`docs/superpowers/specs/`, 코드 주석은 파일명만 유지)과 0.4 결과 핸드오프(`design/2026-09-01-interview-import-v04-result.md`. 불변식은 qa 필드맵·lessons에 흡수 완료, 실서버 점검 4항목은 git history)·템플릿 잔재 `.claude/commands/setup-from-template.md` 폐기. PROGRESS는 09-28 폴리시 라운드 항목을 4줄로 압축하고 09-24 릴리스 이전 항목(09-14~09-18)을 아카이브로 이동.
- **매뉴얼 5차(md 6종+AI 챗 매뉴얼)**: 09-24 이후 매뉴얼 동반 갱신이 빠진 커밋 델타 반영 — 계획 보드 우클릭 외부 L6 지름길·타일 전환, 삭제 예정 복구, 유지 타일 비활성, 채팅 최소화 스파클 칩, 관리 트리 단일 자식 자동 펼침, 활동별 IO 동일 경고, 엣지 라벨 강조·선택 선 보라, 홈 연동 액센트 바 0.5초. 슬라이드 덱 4종(HTML+PDF)도 같은 회차로 재생성 — 사용자 덱 71→72장(연계 캔버스 맵 설정·편집 가능자 신설, 필터 2줄·연동 액센트 바·눈 아이콘 카드·AI 보고서·엣지 라벨 강조·내보내기 재촬영, Word 삭제), 관리자 덱 42→46장(AI로 L5 채우기 4장 신설, 카테고리 관리·인터뷰 임포트 재촬영). 캡처는 `frontend/scripts/pw-manual-shots.mjs`(사용자 덱)+캠페인 스모크 스크립트의 `PW_LANG`(관리자 덱), 덱 수술은 `docs/manual/slides/build_slides.py`(Deck 도구+회차별 ops), 넘침 검사 `scripts/check-deck-overflow.mjs`. 가짜 AI에 비교 보고서 분기 추가(캡처용).
- **슬라이드 전수 검사(236장)와 6차 재촬영**: 덱에 박힌 이미지 148장을 추출해 git 이력으로 촬영 회차를 판정하고 콘택트 시트로 전량 육안 검토. 노드 겹침·엣지 라벨 가림 0건. 낡은 화면 12장(옛 홈·옛 상세 패널·역할 행 없는 인스펙터·옛 피크·밝은 L5 캔버스·옛 체계 탐색·밝은 대시보드 등), 빈 화면 2장(지식기반·연계 권한자 모달), EN 덱이 KO와 같은 한국어 캡처를 쓰던 12장(09-07 2차 촬영분)을 `frontend/scripts/pw-manual-shots-6.mjs`로 두 언어 25컷씩 다시 찍어 교체(사용자 덱 19장·관리자 덱 8장). 시나리오 재료는 API로 만든다: 더미 인터뷰 5종 Apply(플레이스홀더), 임포트 맵 draft에 역할·SP 링크 노드 PUT(체크아웃 force 인수), 슬롯 변경 delete(끊긴 링크), 공지 2건. 랜드마인: 슬롯 맵은 `DELETE /maps`가 409(슬롯 변경 경유), 라이브러리는 이미 링크된 맵 행 클릭이 피크 대신 포커스 이동, 미등록 토글은 필터 팝오버 안, 배너 버튼은 `evaluate(click)`.
- **CLAUDE.md 감사**: 루트 85점(B)·frontend AGENTS.md 90점(A). 루트에 ⑭ 상태 한 줄, 캡처 산출물 `.shots/`·`PW_LANG`·슬라이드 재생성 절차, 폐기 컬럼 유지 규칙을 추가(참조 경로 12곳 실존 확인, vitest 수치 ~1,000으로 정정).
- **캡처 이미지 정리**: 스모크 스크립트가 `docs/qa/screens/`에 남기던 PNG 31장(5.1MB, 참조하는 문서 없음·스모크마다 드리프트)을 저장소에서 제거하고 14개 스크립트의 캡처 경로를 gitignore된 `.shots/`(저장소 루트, frontend 기준 `../.shots`)로 옮겼다. 같은 스크립트들에 `PW_LANG` 환경변수(기본값은 기존 언어)로 캡처 언어를 고른다.

## 2026-09-30 — Word 맵 모드·Word 내보내기 제거 (chore/remove-word → dev)

- **왜** — 2026-07-11~26에 만든 Word 묶음(SOP `.docx` 섹션 임포트·`section` 노드·홈 Word 문서 섹션·빠른 생성·승격 복사·인터뷰 word 3스테이지·완결 문서 생성·도형 순서도 내보내기)은 `WORD_FEATURES_ENABLED=false`로 7/27부터 홈에서 가려져 있었고, Word 내보내기 버튼도 word 맵 안에서만 보여 사실상 죽은 코드였다(운영 DB에 word 맵·section 노드 없음, 사용자 확인). FE 파일 12개+스모크 3개 삭제, BE는 `/word-doc` 엔드포인트 2개·`convert_to_normal`·`WORD_STAGES`·word 애든덤 프롬프트 키 2개(`PROMPT_KEYS` 13)·`_sanitize_word_graph`·`AI_NODE_TYPES`의 `section` 제거, `fflate` 의존성 제거. 홈 목록 분리는 `lib/map-mode.ts`(`splitMapsByMode` process/framework)로 이동.
- **DB 컬럼은 모델에 "폐기 컬럼"으로 남김** — `doc_name`·`doc_sections`·`doc_imported_at`·`doc_generated_at`·`nodes.section_anchor`·`interview_sessions.mode`는 create_all로 생긴 DB에서 NOT NULL·DDL 기본값 없음이라 모델에서 빼는 순간 INSERT가 깨진다(로컬 스모크에서 `POST /maps` 500으로 적발). 마이그레이션 도구가 없고 운영 리셋 불가라 매핑만 유지하고 코드 어디서도 읽지 않는다. 드랍은 별도 마이그레이션 시점의 후속.
- 검증: pytest 1590·ruff / vitest 1039·tsc·lint·카탈로그 clean, 스모크 `pw-smoke-no-word.mjs`(8/8)·`pw-verify-library-open.mjs`(8/8). 매뉴얼 §9 내보내기·README·AI 챗 매뉴얼에서 Word 행 제거.

## 2026-09-29 — L6 활동별 IO 규칙·동일 IO 경고 (dev)

- **원인** — AI 컨설턴트 L6 행에서 같은 활동의 input/output이 같거나 L6 전체 입력물·산출물이 전 활동에 복사되는 현상은 코드 버그가 아니라 프롬프트 빈틈: 설문은 IO를 L6 단위(입력물·산출물 주관식)로만 묻고, 행 작성 계약엔 "앞 output을 다음 input에 다시 쓰면 이어진다"는 체인 힌트만 있어 활동별 IO 의미가 없었다(정정·기존 L5 학습이 `[현재 등록된 내용]`으로 되먹임). 정규화·조립·어댑터는 값을 옮기기만 한다(로컬 가짜 AI 582 액션 중 0건).
- **조치** — 행 작성·행 피드백 계약(+외부 AI 프롬프트 `interview-json-prompt.ts`·`docs/samples/interview-json-0.5.md`)에 활동별 IO 규칙 추가: input=받는 것/output=만드는 것, 같은 활동 양쪽에 같은 항목 금지, L6 전체 IO는 `fields.input_data/output_data`+첫 활동 input·마지막 활동 output만. 어댑터 `_build_nodes`가 같은 활동의 동일 IO를 warning으로 리포트(값은 그대로 착지, handoff는 그대로 넘기는 활동이라 제외 — 샘플 calibration-l5 "결과 인계").

## 2026-09-29 — 엣지 라벨 하이라이트·선택 선 색 복구 (dev)

- **라벨 알약도 선과 같이 강조** — 선의 선택색·F14 in/out 색은 `<path>`에만 걸리고 라벨(`EdgeLabelRenderer` HTML 포털)은 정적 알약 스타일이라 빠져 있었다. `lib/canvas` `highlightEdgeLabel`(선택=edge-selected+2px 링 / in=teal / out=orange, 글자·테두리=선 색, 배경 12% 틴트)을 `applyFlowHighlight` 안에서 태워 메인·펼침 자식·게이트웨이 공용. Yes/No 파스텔은 선과 같은 규칙으로 강조 중엔 흐름 색이 우선.
- **선택 엣지 선이 회색(#555)이던 문제 복구** — globals의 바이올렛 규칙을 React Flow 기본 CSS의 같은 특이도 규칙이 순서상 이겨 글로우만 바이올렛이었다. RF가 읽는 `--xy-edge-stroke-selected`로 선택색을 넘겨 해결. 펼침 자식 엣지 클릭 선택은 이미 동작 중(2026-09-02)이라 변경 없음. 스모크 `pw-verify-edge-label-highlight.mjs` 16/16.

## 2026-09-29 — L5 캠페인 외부 L6 픽스·지름길·채팅 칩 통일 (dev)

- **채팅 수정 시 외부 L6 증발 픽스** — `feedback_session`(relations)만 태스크로만 known을 만들어 외부 참조 노드를 정규화가 "세션에 없는 카드"로 버렸다(첫 제안엔 있다가 한 번 고치면 사라지는 실사고). 다른 네 경로와 같은 `_known_task_names`로 통일하고 프롬프트 [L6 카드]에도 relations 제안과 같은 소속 L5 표시를 단다. 회귀 테스트는 픽스 전 코드에서 실패 확인.
- **계획 단계 외부 L6 지름길** — 좌측 [외부 L6] 탭이 목적·첨부 위에 묻혀 안 보여, 보드 빈 영역 우클릭 → [외부 L6 추가...]가 그 탭을 열고, 새 카드(+로 만든 이름 없는 타일) 우클릭 → [외부 L6 목록 보기...] → 체계 피커 모달(`ExternalL6Modal`, 연결 다이얼로그와 같은 임베드)에서 고르면 그 타일이 제자리(단계·선행 유지)에서 외부 타일로 바뀐다. 기존 L6(keep/revise)·이미 외부인 타일은 대상이 아니다.
- **연결 단계 채팅 최소화 칩 = 에디터 AI 도우미와 같은 컴포넌트** — 에디터 page.tsx에 인라인이던 끌 수 있는 스파클 칩을 `AiChatMinButton`으로 뽑아 두 표면이 공유한다(캠페인 쪽은 우하단 고정 MessageSquare 버튼이라 룩·동작이 달랐다). 기본 위치·끌기·제자리 클릭 복원 동일. 스모크 `pw-fw-consult-external-menu.mjs` 13/13.

## 2026-09-29 — 첨부 문서 pptx 허용 (dev)

- 첨부 허용 포맷에 `.pptx` 추가 — 2026-07-23 최초 파싱 구현 때 5종(pdf/docx/xlsx/txt/md)으로 시작한 뒤 배제 결정 없이 굳어 있었고, 사내 보고 자료가 PPT 중심이라 컨설턴트 첨부 실효성이 컸다. 백엔드 `parsing.py` 단일 계약(`ALLOWED_EXTENSIONS`+`_parse_pptx`: 슬라이드 순서·텍스트 프레임·표·발표자 노트, `python-pptx==1.0.2`)에 얹고 FE 3표면(맵 인터뷰·L5 계획 단계·설정 KB) accept·안내 문구를 맞췄다. 구 `.ppt`/`.doc`/`.xls` 바이너리는 라이브러리가 못 읽어 계속 제외.

## 2026-09-28 — 홈 대시보드 맵 호버 연동 표식 교체 (feat/linked-hover-effect)

- 연동 강조를 배경(alt)에서 좌측 2px 액센트 바(inset box-shadow)로 교체하고 마우스가 올라간 행 자신은 표식에서 제외 — 호버 배경(pearl)과 같은 계열이라 어느 행에 마우스가 있는지 구분되지 않아 오류처럼 보였다(사용자 선택: 액센트 바, 대안 이름 색·점선 링·링크 아이콘은 기각). 6개 섹션(최근 열람·내 부서·내 문서·결재 대기·최근 변경·점유 목록)이 `dashboard-hover.tsx` 상수 하나를 공유해 일괄 적용. 검증 `pw-shot-home-linked-hover.mjs`(admin.sys, 7/7).
- 표식 켜짐 500ms 지연(`delay-500`, linked일 때만 붙어 꺼짐은 즉시) — 스쳐 가는 호버로 시선이 분산되지 않게 하고 다른 섹션에서 찾을 때만 돕는다. 열기 버튼 의도 판정 300ms보다 한 단계 뒤로 잡았다(700ms는 찾는 상황에서 답답). 스모크에 200ms 미표시·900ms 표시·이탈 즉시 소거 체크 추가(9/9).

## 2026-09-28 — AI L5 캠페인 폴리시 라운드 (feat/fw-consult-polish → dev)

- **계획 단계 모델 교체**: 단계를 카드의 명시적 `stage`(`lib/plan-cards.ts`)로, 선행은 "직전 행의 비어 있지 않은 부분집합" 불변식(`normalizeDependencies`)으로 저장. 선행 편집은 타일 우클릭 체크 메뉴, 선행 연결선 SVG 점선, 삭제는 "삭제 예정"으로 남겨 복구 가능(`removedIds`), 기존 유지 타일은 점선·흐림 비활성. 설문은 빈 주관식=미답변(서버 자동채움 폐기), single 복수 답·문항/제출 코멘트, ready 단계 "플레이스홀더(임시)로 생성" 건너뛰기+`retry` 재드로잉.
- **연결 캔버스·미리보기**: 엣지 클릭 선택/더블클릭 라벨/우클릭 메뉴, 비분기 노드의 두 번째 나가는 엣지는 확인 후 교체. 어댑터 `_build_flow_edges`가 seq 역행 엣지를 loop로 재분류하고 Start/End 폴백을 붙여 L6 Start 미배선 픽스, `ScopePreview`는 역행 엣지를 위로 도는 직각 점선(`buildPreviewEdgePath`)로, 연결 제안은 `align_relations_to_plan`으로 계획 선행 쌍을 보강.
- **외부 참조 타일(2026-09-29)**: 계획 좌측 [목적·첨부 | 외부 L6] 세그먼트, 카드 `mode="external"`+`external{ref_id,l5_code,…}`, `_known_task_names` 단일 소스로 캔버스·relations·검증·확정 관통, 조립 시 `externalTasks`. 타일 색은 소속 L5 코드 FNV-1a 해시(`getExternalL5ColorByCode`, 남색 점선은 비활성처럼 읽혀 폐기), 상태 칩은 공용 `CardModeChip`(유지=회색·정정=앰버·외부=L5색).
- **그 외**: 빈 AI 응답(사고가 토큰 소진)은 `EMPTY_REPLY_MESSAGE`로 구분해 사고 끄고 재시도, 행 드로잉은 사고 없이 호출. 관리 트리 자식 하나뿐인 사슬 자동 드릴인(`drillSingleChain`), 관리 패널 타일 컴팩트·인터뷰 JSON 전폭 스트립. 검증: vitest 1092·pytest 1596·스모크 8종 통과.

## 2026-09-28 — PI팀 회의 자료: 컨설팅 범위 맵의 시스템 오너 협의 (docs/pi-meeting-prep → dev)

- PI팀이 "컨설턴트 도구가 원본, BPM은 뷰어"로 선회한 상황에 대비해 `docs/notices/2026-09-28-pi-meeting-prep.md` 작성·머지. 검토 후 구도 재정리(사용자 결정 2026-09-28): 프로세스맵은 한 서비스에서만 관리하고 병행·주기 재전달·미러링은 제외, 선택지는 **안 1 Agent 존속(PI팀이 시스템 오너, BPM은 종료 또는 동결)** / **안 2 종료 시 완성본 1회 이양(BPM 원본)** 둘. 안 2의 성립 조건으로 식별 키(맵=`taskId`, 단계=순번이라 삽입 시 비교가 삭제+추가로 갈림) 절 추가. 부록 수치는 9/24 기준 그대로(중요 수치 아님, 사용자 결정).

## 2026-09-24 — 릴리스 후 정리: md 문서·프론트 디자인 통일성·매뉴얼 (dev)

- **md 문서 정리**: main 머지 완료된 설계 스냅샷 3종(assignee-role·catalog-alias·interview-v04 설계)과 구현 플랜 3종 폐기(계약은 CLAUDE.md·0.5 계약 3표면으로 이미 흡수) — 코드 주석은 `docs/design/` 접두만 떼고 파일명 유지. PROGRESS는 2026-09-12 이전 793줄을 아카이브로 이동(헤더 무손실 검증), 인덱스 2종(`docs/README.md`·`design/README.md`) 상태 문구 갱신. 링크 검사 74파일: 남은 깨진 링크는 아카이브 원문 7건뿐(원문 보존 정책).
- **프론트 디자인 통일성 감사·수정**(`rules/frontend/design.md` 기준 15항목 그렙 감사): 사용자 문구 긴 대시 8곳(i18n 4·JSX 4)과 ★ 글리프 제거, 굵기 500(`font-medium` 68곳)→600·700 3곳→600(캔버스 노드 제목만 500 유지 — `lib/canvas.ts` measureText 미러 `"500 14px"`와 한 쌍), 네이티브 체크박스 10곳→공용 `CheckInput`(캔버스 IO 행 12px 2곳은 밀도 예외로 유지), `text-white`/`bg-white` 14곳→`text-on-accent`/`bg-surface`, 로딩바 글로우 제거, 스와치 폴백 hex·ERD rgba→토큰, `rounded-[5px]`→`rounded-xs`·`rounded-2xl`→`rounded-lg`, `strokeWidth` 1.6~1.8 65곳→1.5. 통과: 다크모드 0·아이콘 라이브러리 Lucide 단일·섀도 유틸 전부 토큰. **남긴 판단**: Lucide 크기 실태는 14(444)·12(316)·16(242)로 규칙(16 고정)과 어긋남 → 규칙을 사다리(12 인라인/14 컨트롤/16 기본/28 빈 상태)로 고칠지 결정 필요, 레거시 1000/1001 드롭다운 18곳은 모달 안에서 가려지므로 포털화 후속, `process-node.tsx`의 `text-xs`/`text-[10~11px]` 33곳은 줄높이가 노드 높이에 얽혀 별도 스윕. z 사다리에 실사용 단(1000·1100·1250·1340) 문서화.
- **매뉴얼 4차 갱신(md 6종 + AI 챗 `backend/app/manual.md`, 2026-09-19 adba1488 이후 델타)**: 관리자 §13 AI L5 진입을 레벨별 타일(하위로 이동·L5 만들고 AI로 시작·AI로 작업/AI 세션 이어서, 세션 목록 폐기, 같은 이름 409)과 **인터뷰 JSON** 섹션으로 정정, 관리 부서 상속·L5 캔버스 그룹·검색 L5 그룹·선택된 맵 스트립·필터 2줄(정렬·Type·이 필터 지우기)·비교 기본 선택/패널 폭 드래그/우하단 노드 표시 카드·연계 캔버스 맵 설정(**편집 가능자** 탭) 추가. **긴 대시(—) 전수 제거**(사용자 지시 2026-09-21, 7파일 약 750자 → 0, 문장별 재작성, KO/EN 라인·헤딩·불릿 정렬 유지 검증). 슬라이드 덱 4종은 **미재생성**(신규 캡처 ~6컷×2언어 필요, 절차는 memory `manual-slides-refresh`) — 후속.

## 2026-09-24 — dev → main 릴리스 (2026-09-19 이후 dev 135커밋 요약)

- **AI 컨설턴트 L5 캠페인 1·2라운드(feat/ai-consultant-l5 → dev, 2라운드 스프린트 ①~④):** 맵 하나에 묶이던 AI 컨설턴트를 L5 단위 "위층 세션"으로 — BE `framework_interview_sessions/_tasks` + `app/framework_interview/`(계약·정규화 `normalize.py`·조립·러너 병렬 `collect_jobs`·기존 L6 학습/정정 `existing.py`·세션 `canvas`↔relations 왕복·자연어 피드백 엔드포인트) + `routers/framework_interviews.py`(sysadmin 전용). FE `/framework/consult/[sessionId]`: 카드 보드(전 행 클릭=상태별 패널) → 계획(`depends_on` 단계 행, 타일 드래그·FLIP, `lib/plan-cards`) → AI 생성 설문(절차의 애매한 지점 초점, 섹션 4종, 주관식 타이핑, 종류별 hover) → 연결 편집 캔버스(`relations-canvas.tsx`)+플로팅 피드백 채팅 단일 게이트(`ScopeWindow`) → 등록=인터뷰 JSON 0.5 임포트(dry run 자동). 관리 패널은 좌 트리 : 우 상세 패널 + 레벨별 타일 액션(`fw-level-actions.tsx`, 같은 부모 아래 이름 중복 409) + 계단식 피커(`framework-cascade-picker.tsx`). 산출물 계약은 CLAUDE.md "인터뷰 JSON 0.5 계약 3(+1)표면"(IO는 문자열 배열). 가짜 AI `frontend/scripts/fake-ai-server.mjs`(`FAKE_AI_WORST=1`)로 스모크 `pw-fw-consult*.mjs`. 설계 스펙 `docs/superpowers/specs/2026-09-2*`는 코드 주석 provenance로 유지, 구현 플랜 6종은 이 릴리스에서 삭제(git history).
- **홈 업무 체계 뷰 = L5 포커스 드릴다운 + 탐색 플로팅 패널(feat/fw-l5-list·fw-drill-columns → dev):** `components/maps/framework-drill.tsx`(브레드크럼·형제(1):하위(2) 두 열·L5 275px 컴팩트 카드·우측 `CategorySummaryCard` 크로스페이드) + `framework-explorer-modal.tsx`(계단식 트리 ↔ ERD식 다이어그램 `lib/framework-diagram.ts`, 중심 브레드크럼 GoToMenu, 창 비례 `PANEL_SIZE`, z 1200). BE `/categories/nodes`에 전 레벨 `l5_count`, L5 `canvas_state·admin·slot_pending_count`. 재제안 금지: 방사형·브라우저 전체 모달·형제 칩·조상별 숫자 칩. 규모 시드 `backend/scripts/seed_framework_scale.py`(L5 2,000).
- **부서 뷰의 L5 연계 캔버스 6종(dev):** `framework-map-card.tsx` · 관리 부서 `ProcessCategory.admin_department`(B안, 비면 상위 상속 `resolve_admin_departments`, 캔버스 `owning_department`는 응답에만 파생) · 캔버스 설정 탭 읽기전용화(`framework-access-panel.tsx`, 결재 대기 탭 `can_confirm`/`can_decide_slot` 실값) · 필터 2줄 + 정렬(`lib/map-sort.ts`, Type 그룹 OR) · FW 뷰 검색 그룹(`framework-search-groups.tsx`) · L6 스트립(`selected-map-strip.tsx`, 뒤로가기 popstate 복귀).
- **비교 화면(feat/compare-ai-report·display-fields-float → dev, 2라운드 ①):** AI 요약을 결재자 개조식 보고서 4블록(`CompareSummaryOut` kind 9종, `ai_compare_summaries` diff 해시 캐시, AI 탭 열 때만 호출) + 제출 코멘트 AI 초안(`/compare/submit-note-draft`, 프롬프트 키 `submit_note_contract` 9번째) · 우하단 노드 표시 정보 플로팅 카드(`node-display-float.tsx`, 비교 키 `bpm.compare.nodeDisplayFields`) + 라이브러리 드롭 중심 보정 · diff 전용 토큰 `--color-diff-changed` · 초기 base≠target(`lib/compare-initial.ts`) · 인스펙터 폭 드래그(`lib/use-resizable-width.ts`) · L5 하늘 캔버스 드롭존 밝은 기반색. 함정: `.env` OpenAI 실키는 `chat_template_kwargs`로 400(운영 SGLang 무관).
- **문서·검증:** 매뉴얼 6종·AI 챗 매뉴얼·슬라이드 덱 4종(71장) dev 최신 동기화(`/sync-all` 일치), 낡은 스모크 4종을 드릴다운 id로 이식, lessons에 Tailwind display 이중 지정·이펙트 내 setState·워크트리 복합 Bash 함정 기록. 릴리스 게이트: backend pytest 1593·ruff, frontend vitest 1086(94파일)·tsc·lint green, 컴포넌트 카탈로그는 stale이라 재생성.

## 2026-09-18 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-09-30·09-24·09-02·08-12 이동분 포함) + git history.
