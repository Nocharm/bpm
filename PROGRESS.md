# Progress

프로젝트 진행 현황 로그. 커밋 직전 갱신 (`rules/common/git.md`). **한 줄 요약만** — 상세는 git 이력·`docs/spec.md` 참조.

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
