# Progress

프로젝트 진행 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.
최근 요약만 유지하고, 이전 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-07-20 전체 스냅샷 + 이후 이동분) + git history로 아카이브한다.

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

## 2026-09-18 — 승인자 착지·결재 대기 안내·게시본 vs 대기본 비교 딥링크·비교 화면 AI 요약 탭 (feat/approval-landing-compare-ai)

- 승인자가 맵을 열면 내가 결재할 pending 버전(승인자 목록에 있고 미결재)으로 착지(`?version=`은 여전히 우선). 다른 버전을 열었을 땐 상단 상태 배너에 "내 결재 대기 버전 열기" 링크, 승인 탭엔 `SectionOverlay` 흰 덮개+"해당 버전으로 이동" 버튼 — 이 탭은 열린 버전 기준이라 오판을 막는다. 판정은 버전별 워크플로 캐시(`wsById`, 진입 조회+현재 버전 조회 미러)로 하므로 결재 직후에도 최신. draft/pending은 공존하지 않아 착지 분기는 `else`.
- pending 버전을 여는 모든 사용자에게 승인 워크플로와 확정 변경 기준 사이에 "게시본과 비교" 버튼 — 비교 화면 `?base=<최신 게시본>&target=<pending>` 딥링크(비교 페이지가 쿼리를 처음 읽게 됨, 모르는 id는 기본값).
- 비교 화면 세 번째 탭 **AI 요약**: 프론트가 계산한 병합 diff를 `CompareDiffPayload`(노드/엣지 각 200 상한, ref n1/e1)로 `POST /api/maps/{id}/compare/ai-summary`에 보내고(파이썬에 diff 복제 안 함, viewer 게이트·두 버전 맵 소속 검증) 총평·주요 변경(kind 칩, 클릭=캔버스 포커스)·확인 포인트·집계 칩으로 렌더. 비교 진입 시 그래프가 준비되면 **선행 생성**하고 탭 라벨에 스피너, (base,target) 조합별 결과 보관, 재생성은 총평 카드 우상단. 프롬프트 키 `compare_summary_contract`(관리자 오버라이드 8번째), 계량 `ai_usage_events kind=compare_summary`. `_ask_and_validate`는 `schema` 인자로 일반화.
- 후속(09-19) 문구 축약: 덮개=제목 "Awaiting your approval / 내 결재 대기" + 라벨 한 줄 + "Open that version / 그 버전 열기", 배너 링크 "Awaiting your approval: {label} / 내 결재 대기: {label}". 최소 높이 min-h-36.
- 후속(09-19): 결재 대기 덮개는 승인 탭 전체가 아니라 **승인 워크플로 섹션만** 덮는다(사용자 지시) — 덮인 동안 섹션은 펼침 유지 + `min-h-44`로 문구·버튼 높이 확보(게시본의 워크플로 본문은 낮음). 결재 대기 목록·비교 CTA·SP 카드는 그대로 조작 가능.
- 후속: 비교 좌측 변경 목록의 항목별 상태 필(Added/Removed/Changed 틴트)은 왼쪽 아이콘 사각과 중복이라 제거 — 제목 한 줄로(사용자 지시). 속성 탭·엣지 인스펙터의 상태 필은 그대로.
- 검증: backend 1489 green·ruff, vitest 1004(+4)·tsc·eslint, Playwright `pw-smoke-approver-landing.mjs` 16/16(맵 32, 승인자 bora.hong). AI 응답은 로컬 OpenAI 호환 스텁으로 렌더만 확인 — 실제 모델(GLM/SGLang) 대상 프롬프트 품질은 서버 배포 후 확인 필요. 함정: 승인자가 뷰어 역할이면 배너 제목이 "Viewer access"라 버전 판정은 pending 전용 비교 CTA로; `networkidle` 대기는 AI 요청이 끝나야 풀려 스피너를 못 본다.

## 2026-09-18 — 비교 화면 워스트케이스 개선 4종: 엣지 라벨 줄바꿈·속성 범위 토글·전 파라미터 표시·실측 배치 (main)

- 65노드·78변경 워스트케이스(스크래치 시드, 저장소 미포함)로 비교 화면을 실측한 뒤 사용자 지적 4건 반영. ① 비교 엣지 라벨에 에디터와 같은 `EDGE_LABEL_MAX_WIDTH`(160) + 자동 줄바꿈 — 수평 연결에서 긴 라벨이 이웃 노드를 덮거나 잘리지 않게. ② 속성 탭에 "모두 / 변경만" 범위 토글(기본 변경만) — 변경 노드는 바뀐 필드만(제목·설명·타입·색 포함), 추가·삭제·무변경 노드는 토글 비활성+전체 표시. ③ 비교 노드 표시 필드를 AI 프리뷰와 같은 역할·부서·시스템·파라미터 칩으로(값 있는 것만, 전후는 기존 diff 필). `buildAppNodes`에 `touch_time` 누락 보강.
- ④ 자동정렬 검토: 비교 화면은 `COMPARE_RENDER_H`(process 38) 고정 상수로 백본 정렬·핸들 중심을 계산했고, 공용 `layoutWithDagre`는 `nodeSizeOf` 고정 박스로 배치해 속성 줄이 켜지면 같은 열 이웃과 겹칠 수 있었다. `layoutWithDagre`가 `node.measured`를 우선하도록 바꾸고(에디터 자동정렬도 실측 박스 사용), 비교·프리뷰 모두 RF `dimensions` 변경에서 실측을 모아 1회 재배치 후 fitView. 상수표는 측정 전 폴백으로만 남긴다. 단위 테스트: 실측 300px 노드가 nodesep(120)만큼 띄워지는지.
- 후속(같은 날): 비교 엣지 라벨 최대폭은 비교 전용 120(`COMPARE_EDGE_LABEL_MAX_WIDTH`, 에디터 160 유지 — 비교는 ranksep 120이라 더 좁게). 속성 탭은 변경 노드가 아니면(추가·삭제·변경 없음) 본문 전체를 톤다운(opacity)하고 상태 워터마크("추가/삭제/변경 없음", 스크롤 고정)를 덮어 값 비교 대상이 아님을 드러낸다. 입출력·조건 섹션은 "모두" 모드에선 비어도 구분선 섹션으로 남겨 "어디 있나"를 답하고(없으면 None 한 줄), "변경만"에선 바뀐 것이 있을 때만. 읽기전용 필은 탭 줄에서 본문 최상단(제목 위, 엣지·빈 상태 포함)으로 이동 — 탭 줄은 범위 토글에 양보.
- 후속 2: 노드 위 표시에 입출력·시작/종료 조건도 포함(비교·AI 프리뷰 공통, 값 있는 것만) — 처음엔 노드 높이 때문에 뺐으나 실측 재배치가 높이를 흡수하므로 켠다. 비교 `buildAppNodes`·프리뷰 `layoutWorkingGraph`에 input/output/(forms)/start·end_condition 전달. 프리뷰 스모크 픽스처에 IO·조건 추가(15/15).
- 후속 3: 비교 노드의 입출력은 패널 대신 **"입출력 +N −M" 한 줄**(항목 추가/삭제 없으면 생략) + 호버 시 입력·출력을 한 툴팁에 항목별 +/−로 펼침(`lib/io-diff.ts` 다중집합 diff, `NodeIoDiffSummary`, 조건 줄 아래·body 포털 z1400). AI 프리뷰는 패널 그대로. 그리고 **변경 필드 힌트** — 바뀐 필드의 파라미터 칩·속성 줄·조건 줄에 상태색(added/changed/removed) 아이콘 + 배경 틴트(`data.diffFieldStatus`, 담당자 줄은 실명·역할 중 하나만 바뀌어도). 에디터는 상태가 없어 무색. 함정: 조건 줄이 `NodeIoDetails` 안에 있어 컴포넌트째 갈아끼우면 조건이 사라진다 → 요약은 그 안에서 IO 변만 대체.
- 후속 4: 입출력 요약 줄에 호버 이펙트(액센트 틴트 배경+글자색, 150ms) 추가, 그 줄에선 노드 래퍼의 네이티브 `title` 툴팁("변경: 시스템")을 `title=""`로 억제해 통합 툴팁과 겹치지 않게.
- 주의: `tsc`가 dev 서버 산출물 `.next/dev/types`를 포함해 에디터 `page.tsx`의 기존 `toAppEdges` named export를 Next 페이지 계약 위반으로 잡는다(이번 변경과 무관, dev 서버 기동 후에만 발생).

## 2026-09-18 — AI 컨설턴트 프리뷰 노드 속성 표시 + Tab 이동, PNG 내보내기 선택 해제 (main)

- 프리뷰가 노드 라벨만 보여 수집된 파라미터를 한눈에 못 본다는 피드백 — 원인은 `layoutWorkingGraph`가 AI `attributes`를 노드 data로 안 옮기고 전부 빈값으로 채운 것(파라미터 칩 토글은 이미 ON). 역할·부서·시스템·회당 7필드를 data에 싣고 프리뷰 표시 필드를 인스펙터 카드와 같은 범위(`assignee`·`department`·`system`·`params`)로 확장. IO·조건·URL은 노드 높이를 키워 제외(카드에서 확인). 선택지 카드 썸네일도 같은 컨텍스트라 함께 표시된다.
- 프리뷰 Tab/Shift+Tab — 에디터와 같은 `getNext/PrevNodeAlongFlow`로 흐름상 다음/이전 노드에 포커스(+클릭과 같은 카메라 센터·1.1 줌). 채팅 입력 포커스 중엔 가로채지 않음.
- 에디터 PNG 내보내기가 선택 링·IO 상세·흐름 강조까지 찍히던 것 — 선택은 React 상태가 그리므로 캡처 전에 `selectedId`/노드 `selected`를 비우고 두 프레임 뒤 캡처, finally에서 원래 선택 복원. 실측: 캡처 시점 `.selected` 0개·액센트 픽셀 0·캡처 후 선택 1개 복원(`scripts/pw-smoke-preview-tab-export.mjs`, 14/14).

## 2026-09-18 — 지연 실행 안내를 섹션 레이어로 + 인터뷰 임포트 30파일 워스트 케이스 UX (main)

- 홈 대시보드 1클릭 지연 실행(0.6초)의 안내가 **아이콘 자리 링 치환**이라 눈에 안 띈다는 피드백 — `useDelayedNav`가 가장 가까운 스코프(`DelayedNavScopeContext`)에 `{label, cancel}`을 보고하고, 섹션(`DashboardSection`·점유 목록·프로필·이동 타일 한 칸)이 반투명 레이어(`SectionOverlay`, 임포트 완료와 같은 톤) 가운데에 링 + "Going to Inbox / Selecting {맵}" + "클릭하면 취소"를 띄운다(레이어 클릭 = 취소). 타일은 **한 칸 단위**(묶음 아님, 사용자 지시)라 컴팩트 변형. 섹션 밖 맵 카드는 기존 동작 유지. 헤더 더보기·하단 링크아웃은 `SectionLink`(onClick | href+pendingLabel)로 스코프 안에서 훅을 돌린다.
- 인터뷰 임포트: 적용 완료 문구를 푸터에서 본문 레이어 가운데로 이동, 적용 중/재드라이런 중도 같은 레이어(스피너). 파일 목록은 건수 헤더 + 8행 내부 스크롤 + Clear all. 드라이런은 리포트 영역이 아코디언(0fr→1fr)으로 먼저 열리며 링 → 결과가 같은 자리에. 리포트 본문은 `100vh-11rem` 상한에 **좌/우 열 독립 스크롤**(스티키 대신 — 오른쪽을 내려도 요약이 남는다), 우측 스티키 툴바(건수·검색·정렬 Order/Name/Issues/Maps), 카드 10개 윈도 + 바닥 센티널 IntersectionObserver(limit마다 재관찰해야 짧은 카드에서도 이어짐), 좌측 포커스가 윈도 밖이면 노출·스크롤. 실측 함정: 높이 상한에 걸리면 열의 flex 자식이 눌려 요약 카드가 잘린다 → `[&>*]:shrink-0`.
- 검증: 30개 변형 JSON 드라이런 실측 19/19, 기존 인터뷰 임포트 스모크의 적용 음영/Apply 비활성/Cancel 도달 통과. 로컬 3000/8000은 db-viewer가 점유 중이라 BPM은 3047/8048로 따로 띄웠고, `~/package.json` 때문에 turbopack root가 홈으로 잡혀 `next dev`가 수분 걸려 `--webpack`으로 우회(메모리 기록).

## 2026-09-14 — 맵 카드 최근 열람 배지: 호버 시 펼쳐지는 폭 (main)

- 최근 열람 맵 카드가 두 문구(수정시각·최근 접속)를 같은 그리드 셀에 겹쳐 두느라 **평소에도 넓은 쪽 폭을 잡고 있어 오너 이름 필이 미리 줄어 보였다.** 평소엔 수정시각 칩만 자리를 차지하고 호버 시 최근 접속 필이 폭을 늘리며 들어오도록 전환(max-width 애니, 상한은 최장 문구보다 조금 크게). 영문 `home.recentBadge`는 "Recently opened" → "Opened"로 단축(한글 "최근 접속"과 길이 균형). 1차 시도(두 칸을 각각 max-width로 접고 펴기)는 전환 중간 합계가 최종보다 커져(피크 147px > 최종 127px) 이름이 줄었다 늘어나는 튐을 만들었다 — 필을 absolute로 빼고 **실측 두 값 사이의 단일 width 전환**으로 교체. 실측: 배지 56/84px → 127/128px(ko/en), 전환 샘플 단조 증가·오버슈트 0, 넓은 폭에선 이름 불변(98px), 좁은 폭에서만 호버 중 말줄임.

## 2026-09-14 — db-viewer 공유 브리지 상시 합류 + 배포 문서 정리 (dev)

- db-viewer가 서버에 `dbv-shared`(`10.203.0.0/24`)를 띄우고 backend를 상시 합류시켜 둔 상태라, 2026-09-11에 되돌렸던 compose 합류를 **공유 방식으로 다시 넣었다** — db 서비스가 `default` + `dbv`(external, `DBV_NETWORK` 기본 `dbv-shared`)에 붙고 별칭은 `DBV_DB_ALIAS`(운영 `bpm-db` · 9910 `bpm9910-db`). 스택마다 별칭을 갈라야 공유 네트워크에서 엉뚱한 DB에 붙는 사고를 막는다. 되돌린 이유였던 "운영 미연결 + external 선행 요구"는 네트워크가 이미 서버에 있어 해소 — 대신 `up` 전제조건이 되었으므로 deploy §0·§5, setup-once A9에 명시.
- 서버에서 사람이 해야 하는 나머지(네트워크 확인·볼륨 점검·`up -d db`·`dbviewer_ro` 발급과 민감 테이블 REVOKE·db-viewer `/admin` 등록)는 [`docs/deploy/db-viewer-readonly.md`](docs/deploy/db-viewer-readonly.md)로 복원. db-viewer 저장소의 `connect-sources.md`가 방식·정책 총괄이고 이 문서는 BPM 스택 부분만 담는다.
- 문서 정리: 런칭 이후 운영 리셋이 금지라 `docs/deploy/db-seed.md`를 폐기(스키마 자동 보강 설명은 deploy §3으로 흡수, 시드 실행은 setup-once A8·README에 유지). main 머지 완료된 설계 스냅샷·구현 플랜 17건(superpowers plans 9·specs 6·ref-audit 설계·해소된 7/17 핸드오프)과 낡은 `qa/dev-vs-main-checklist.md` 삭제 — 코드 주석은 경로 접두만 떼고 파일명 유지.

## 2026-09-12 이전
- 상세 이력은 [`docs/history/PROGRESS-archive.md`](docs/history/PROGRESS-archive.md)(2026-09-24·09-02·08-12 이동분 포함) + git history.
