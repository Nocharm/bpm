# IO 연결(불러오기) 브라우저 QA 검수 — 2026-08-21 (M·N·P·Q·R 라운드 2026-08-23)

`feat/io-linking` 전면 브라우저 검수. 실행 환경: 로컬 네이티브(backend :8000 + frontend :3000) + Playwright/시스템 Chrome, `admin.sys`. 스펙: `docs/superpowers/specs/2026-08-21-io-linking-design.md`.

표기: ✅ 통과 · ❌ 결함(하단 이슈 절에 기록) · ➖ 해당 없음/차단됨(사유 기록) · (스모크) = pw-smoke-io-links.mjs 26체크가 이미 자동 검증한 항목(재확인은 시각 위주).

## A. 에드 버튼 · 메뉴

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| A1 | 인풋/아웃풋 섹션 비호버 시 + 버튼 숨김, 섹션(헤더·목록) 호버 시 표시 | ✅ | opacity 0→1→0 실측(헤더·행 호버 모두 1). 스크린샷에서 + 부재/등장 육안 확인 |
| A2 | + 클릭 → 2항목 메뉴(Add new / Import from node…), 바깥 mousedown·Esc로 닫힘 | ✅ | 메뉴 항목 2개 `["Add new","Import from node…"]`, Esc·바깥 클릭 모두 닫힘 |
| A3 | Add new → 기존처럼 빈 행 추가·편집 정상 | ✅ | 빈 행 추가→입력→커밋, Save 활성(dirty) 전환까지 확인 |
| A4 | 카드 draft dirty 상태에서 Import 항목 비활성 + 사유 노출(툴팁 신뢰성 — 최종 리뷰 지적) | ✅ | `disabled=true`, `title="Save this card first"`. 스크린샷에서 회색 처리 확인. **툴팁 전달 경로 재검증(`9dc6a3b5`)** — title이 disabled 버튼에서 래퍼 `<span>`으로 이동(`btnOwnTitle=null`, `span.title="Save this card first"`), 실제 마우스 호버에서 그 span이 `mouseover`를 수신하고 hit-test(`elementFromPoint`)도 같은 title 보유 요소로 해석됨 = 네이티브 툴팁 노출 조건 성립. 툴팁 픽셀 자체는 브라우저 크롬이라 페이지 스크린샷에 안 잡히고 OS 캡처는 이 환경에서 권한 부족(`screencapture: could not create image from display`)이라 촬영 불가 |
| A5 | 읽기전용(뷰어/비체크아웃)에선 + 버튼 자체 미노출 | ✅ | 게시(published) 버전에서 `-add` 0개·편집 input 0개. **비체크아웃만으로는 미검증** — 에디터가 로드 시 체크아웃을 자동 재획득해 편집모드가 됨(io-linking 무관 기존 동작) |

## B. 불러오기 모달

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| B1 | (스모크) 인풋 쪽: 업스트림 노드의 아웃풋 항목이 노드별 그룹핑으로 표시, 파일타입 필 동반 | ✅ | 캡션 `["Node C","Node B"]`, 행 텍스트 `테스트결과 + PDF 필` |
| B2 | 아웃풋 쪽: 다운스트림 인풋 항목 표시 | ✅ | Node A 아웃풋 모달에 하류 Node B 인풋(`선행자료`) 노출 |
| B3 | 기본 2홉 표시 → 3홉+ 후보 존재 시 Show more 행 → 클릭 시 흐름 전체 확장 | ✅ | 기본 노출 0개였던 3홉 Node A 항목이 Show more 후 2행(회의록/Word·계획서/Excel) 등장 |
| B4 | 텍스트 필터: 항목 텍스트·노드명 부분일치, 필터가 심층 후보만 남기면 Show more 유지(막다른 상태 없음) | ✅ | `회의록`(3홉 전용) 필터 시 행 0·빈 상태 미표시·Show more 유지 → 확장 시 등장. 노드명(`Node B`)·부분 텍스트(`승인`) 매칭 확인 |
| B5 | (스모크) 행 호버 → 대상 노드 링(io-node-highlight) + 경로 엣지 하이라이트, 이탈 시 해제 | ✅ | 호버 시 `{nodes:[ch-c], edges:[c-e-c-d]}`, 이탈 시 공집합. 스크린샷에서 노드 아웃라인·엣지 강조 육안 확인 |
| B6 | 이미 링크된 항목에 Link 배지, SP 항목에 SP 배지 | ✅ | 링크 항목 = `title="Linked"` Link2 아이콘, SP 항목 = `SP` 텍스트 배지(`SP산출물 개정 / PDF / SP`) |
| B7 | 자기 노드·이미 연결한 그룹·id 없는 레거시 SP 항목은 후보에서 제외 | ✅ | 자기 노드 행 0 · 이미 미러인 그룹 재노출 0 · `sp_*_ids` 없는 지정 SP는 후보 0(빈 상태) |
| B8 | 후보 0개면 빈 상태 문구, Esc/백드롭/X/Cancel 닫힘 + 하이라이트 잔존 없음 | ✅ | 빈 문구 `No connected items`, 4개 닫기 경로 모두 동작, 닫은 뒤 하이라이트 공집합 |
| B9 | 뷰포트 가장자리에서 모달 클램프(화면 밖 미이탈) | ✅ | 900×560 뷰포트에서 box `{x:604,y:312,w:288,h:244}` — 전 변 뷰포트 내부 |

## C. 불러오기 실행 — 4시나리오 + SP

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| C1 | (스모크) 미러 생성: 인풋이 일반 아웃풋 불러오기 → 미러 행 생성, 원본에 id 부여, 토스트, 자동저장·리로드 영속 | ✅ | 미러 readOnly+Link 아이콘, 토스트 `Linked to origin`, `A.output_ids == D.input_links`, 리로드 후 유지 |
| C2 | 소유권 인수: 아웃풋이 일반 인풋 불러오기 → 아웃풋 원본 행 추가, 대상 인풋이 미러로 전환(텍스트 불변), 토스트 | ✅ | 새 아웃풋 행 `선행자료`+id, Node B 인풋 readOnly 전환·텍스트 불변, 토스트 `Ownership moved to this output` |
| C3 | 원본 승계: 상류 아웃풋이 미러 인풋 불러오기 → 편집점 이동(구 원본 미러 강등·기존 미러 유지), 토스트 | ✅ | itemId가 ch-a 아웃풋으로 이동, ch-c `output_ids` 비고 `output_links`로 강등(행 readOnly), ch-d 미러 링크 불변. 토스트 `Edit point moved to this output` |
| C4 | 그룹 합류: 병렬 아웃풋이 미러 인풋 불러오기 → 미러로 합류, 기존 편집점 유지, 토스트 | ✅ | br-r `output_links=<br-q itemId>`·`output_ids` 공백(편집점 br-q 유지), 토스트 `Joined the existing group` |
| C5 | SP: 지정된 SP의 아웃풋을 인풋으로 불러오기 → 미러 생성, SP 쪽 영구 원본(양쪽 수정 불가) | ✅ | hs-h 인풋 미러(readOnly) ↔ `sp_output_ids[0]`, SP 카드는 읽기 상속(편집 불가) |
| C6 | 순환(A⇄B) 구성에서 승계 없이 합류로 처리 | ✅ | Z→X 역방향 존재 시 cy-z 아웃풋은 승계 아닌 합류(`output_links` 세팅·`output_ids` 공백, 원본 cy-y 불변) |

## D. 미러 행 표시·해제

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| D1 | (스모크) 미러 행: 번호 대신 Link 아이콘, 텍스트 잠금, 폼 피커 대신 정적 폼 표시 | ✅ | `readOnly=true`, 번호 span 없음, 폼 피커 없음·정적 `PDF` 텍스트. 스크린샷 육안 확인 |
| D2 | 아이콘 행 호버 시 Link→Unlink 스왑 + 툴팁 | ✅ | 아이콘 opacity `[1,0]` → 호버 `[0,1]`, `title="Disconnect"` |
| D3 | (스모크) Unlink 클릭 → 마우스 근처 확인 팝오버(클램프) → Disconnect 시 일반 행 전환(텍스트·폼 복사 유지) | ✅ | 팝오버 box 뷰포트 내부, 해제 후 `readOnly=false`·번호 `2.` 복귀·텍스트 유지·폼 `PDF` 피커로 유지(스크린샷 `D3-after-disconnect`) |
| D4 | (스모크) 해제 후 Save 전 노드 재선택 → 링크 원복(draft 취소) | ✅ | 재선택 후 `readOnly=true`+Link 아이콘 복귀 |
| D5 | (스모크) 해제 + Save → 리로드 후에도 해제 영속, 원본은 배지 소멸 | ✅ | 서버 `input_links=""`·텍스트 유지, 리로드 후 일반 행. 마지막 미러였던 원본 행은 Link 아이콘 → 번호 `3.` 복귀 |
| D6 | 팝오버 Cancel/Esc → 링크 유지 | ✅ | Cancel·Esc 모두 팝오버만 닫히고 행은 미러 유지 |
| D7 | 미러 행 × 삭제 → 항목 제거, 같은 그룹 다른 미러·원본 무영향 | ✅ | ch-d 인풋에서 항목만 제거, ch-c 미러·ch-a `output_ids` 그대로 |
| D8 | 미러 텍스트 클릭 → 원본 노드로 센터링+선택+인스펙터 포커스 | ✅ | 원본 노드 `selected`, 캔버스 중앙 오차 `dx≈0/dy≈0`, 인스펙터가 원본 노드 IO(`회의록`) 표시 |

## E. 전파 · 정합화

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| E1 | (스모크) 원본 텍스트 수정+Save → 모든 미러(복수 노드·인풋/아웃풋 혼재) 즉시 갱신 | ✅ | 원본 1 → 미러 2(노드 C 아웃풋 · 노드 D 인풋) 동시 `테스트결과 v3` 반영, 리로드 없이 |
| E2 | 원본 파일타입 변경 → 미러 폼 동반 갱신 | ✅ | 원본 폼 `PDF→structured` 변경 시 미러 행 정적 폼도 `structured` |
| E3 | 원본 항목 삭제+Save → 미러 자동 해제(복사본 전환, 텍스트 유지) | ✅ | 두 미러 모두 `readOnly=false`·Link 아이콘 소멸·텍스트 유지, 서버 `*_links` 공백 |
| E4 | 원본 노드 삭제 → 같은 세션에서 미러 즉시 일반 행 전환(최종 픽스 검증) | ✅ | 삭제 직전 `readOnly=true` → 노드 Delete 직후 재선택 시 `readOnly=false`·링크 없음·텍스트 유지 |
| E5 | 노드 편집 모달 경유 원본 수정도 전파(patchNode 경로) | ✅ | 요약/편집 모달에서 아웃풋 수정 후 저장 → 미러 2곳(br-s 인풋·br-r 아웃풋) `분기산출물 v3` |
| E6 | 일괄편집: IO append는 링크 보존, 교체/비우기는 해당 측 링크 소거(미러 오염 없음) | ✅ | append 후 `output_ids`/`output_links` 유지, replace 후 양쪽 소거(`""`)·소비 노드 텍스트(`분기산출물 v3`)는 보존 → 다음 로드에서 보수적 해산 |
| E7 | 드리프트 시드(콘솔/DB로 미러 텍스트 어긋남 주입) 후 리로드 → 정합화 치유 + 저장 | ✅ | API로 `드리프트값` 주입 → 리로드 시 UI `루프문서`로 치유, 오토세이브 후 서버도 `루프문서` |

## F. 인스펙터 읽기모드 · 하이라이트

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| F1 | 읽기모드 연결 항목(원본·미러 양쪽)에 Link 아이콘 | ✅ | 게시 버전 읽기모드에서 미러 행·원본 행 모두 Link 아이콘, 비연결 항목은 없음 |
| F2 | 미러 항목 호버 → 원본 노드+경로 엣지 하이라이트 / 원본 항목 호버 → 모든 미러 노드 | ✅ | 이슈 #1을 `34ccb79e`에서 수정 후 재검증 통과. 원본 1+미러 2(f2-q 원본 / f2-s 인풋·f2-r 아웃풋) 구성에서 — 미러(인풋) 호버 `{nodes:[f2-q], edges:[f2-e-q-s]}`(형제 f2-r 미점등) · 병렬 미러(아웃풋) 호버 `{nodes:[f2-q], edges:[]}` · 원본 호버 `{nodes:[f2-r,f2-s], edges:[f2-e-q-s]}`. 이탈 시 전부 해제 |
| F3 | 엣지 삭제된 링크: 호버 시 노드만 하이라이트, 링크·전파는 유지 | ✅ | 형제 미러가 있는 그룹에서 원본↔호버 미러 엣지 삭제 후 `{nodes:[f2-q], edges:[]}` — 형제 미러·그 경로 모두 미점등. 미러 잠금 유지, 원본 수정 전파(`분기산출물 v9`) 정상 |
| F4 | 하이라이트가 dev 서버에서 실표시(io-node-highlight raw style 주입 — Turbopack purge 회귀 없음) | ✅ | 계산 스타일 `outline 2px solid rgb(106,65,255) / offset 3px` 실측 + 스크린샷 육안 확인 |
| F5 | 호버 이탈·노드 전환 시 하이라이트 잔존 없음(이연 항목 ⑩ 실측) | ✅ | 이탈 2회·노드 전환 모두 `{nodes:[],edges:[]}` |

## G. 필수/선택 플래그

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| G1 | 인풋 행 필 표시: 기본 Required(액센트 틴트), 토글 → Optional(뮤트) | ✅ | Required `bg rgb(239,235,255)/text rgb(106,65,255)` → Optional `bg transparent/text rgb(122,122,122)` |
| G2 | 미러 인풋에서도 플래그 토글 가능(로컬), 원본 수정에 안 덮임 | ✅ | 미러 행 토글 후 Save → 원본 텍스트 수정·전파 후에도 `Optional` 유지, 서버 `input_flags` 2번째 줄 `optional` |
| G3 | 읽기모드: Optional만 `· Optional` 접미 표시, Required는 무접미 | ✅ | 읽기모드 행 `1. 산출물A · PDF`(무접미) / `2. 자체입력 · Optional` |
| G4 | 아웃풋 행·SP 카드엔 플래그 미노출 | ✅ | 아웃풋 flag 필 0개, SP 카드 텍스트에 Required/Optional 없음 |

## H. SP · 지정 연동

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| H1 | SP 카드(읽기모드) 연결 항목에 Link 아이콘 + 호버 하이라이트 | ✅ | 미러 보유 항목만 Link 아이콘(`1. SP산출물 · PDF` ✓ / `2. SP검토서` ✗), 호버 시 소비 노드 `hs-h` 하이라이트 |
| H2 | SP 지정 저장 → sp 항목 id 부여, 텍스트 유지 재저장 시 id 보존(소비 맵 미러 유지) | ✅ | 첫 저장에 인풋 1·아웃풋 2줄 id 부여, 텍스트 무변경 재저장 시 id 완전 동일 |
| H3 | SP 지정 항목 개명 후 소비 맵 리로드 → 해당 미러 보수적 해산(복사본 전환) | ✅ | `SP산출물→SP산출물 개정` 시 그 줄만 새 id → 소비 맵 미러가 링크 해제·구 텍스트(`SP산출물`) 보존, 서버 `input_links=""` |
| H4 | 미지정 SP는 후보 제외 | ✅ | 미지정 SP 대상 노드는 후보 0(빈 상태) |

## I. 엣지케이스 · 회귀

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| I1 | 원본 노드 Ctrl+드래그 복사/클립보드 붙여넣기 → 사본 output_ids 소거(그룹 무오염), 미러 복사는 미러 유지 | ✅ | Ctrl+C/V: 원본 사본 `output_ids=""`, 미러 사본은 `output_links` 유지. Ctrl+드래그 사본(`Node A (2)`)도 `output_ids=""` |
| I2 | CSV 임포트로 원본 텍스트 변경 → 리로드 시 그룹 보수적 해산·텍스트 보존 | ✅ | CSV 붙여넣기 임포트로 원본 텍스트 변경 → `output_ids` 소거, 리로드 시 미러가 일반 행(구 텍스트 `루프문서` 보존) |
| I3 | 링크 있는 맵 버전 생성(clone) → 새 버전에서 그룹 관계 유지 | ✅ | clone은 노드 id를 재발급하지만 `output_ids`/`input_links`/`output_links`/`input_flags`는 그대로 → 새 버전에서도 미러 잠금·Link 아이콘 정상 |
| I4 | 링크 없는 기존 맵·SP 지정 모달 등 기존 IO 편집 회귀 없음(MVI 공용 표면) | ✅ | 일반 항목 추가/입력/삭제 정상, 비연결 행 편집 가능. SP 지정 모달의 IO 편집(H2·H3)도 정상 동작 |
| I5 | 뷰어(권한 없음)로 드리프트 맵 열람 → 자동 PUT 미발사(403·에러 배너 없음), 아이콘·호버만 동작 | ✅ | `DEV_ENFORCE_PERMISSIONS=true`+`BPM_SYSADMINS=admin.sys`, 뷰어 `bora.choi`. PUT /graph 0건·4xx 0건, 서버 드리프트값 그대로, 화면은 치유값 표시·Link 아이콘/호버 정상 |
| I6 | 콘솔 에러 0 (전 시나리오 통과 중) | ✅ | 전 페이즈(A·B·C·D·E·F·G·H·I·R) 콘솔 error/pageerror 0건 |

## J. 백로그 반영 검수 (2026-08-21)

`353fc392`에서 들어온 두 기능 — CSV `Input_Flags` 왕복, 인풋 미러 끊긴 흐름 경고 배지.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| J1 | CSV 내보내기 헤더에 `Input_Flags`가 `Input`과 `Output` 사이에 위치 | ✅ | 에디터 인스펙터 Map 탭 `export-csv`로 실내보내기 → `…,FTE,Input,Input_Flags,Output,Data_Form,…` |
| J2 | 플래그 있는 노드 행이 따옴표 묶인 멀티라인 셀 `"\noptional"`로 실림 | ✅ | 2항목 인풋(2번째만 Optional)을 필로 토글·Save 후 내보내기 — 서버 `input_flags="\noptional"`, CSV 셀도 `"(개행)optional"`(첫 줄 빈 줄=required) |
| J3 | 같은 CSV 재임포트 → 대상 노드 변경 없음, 적용·리로드 후 2번 항목 Optional 유지 | ✅ | 프리뷰 `3 nodes matched / 0 nodes added / Nothing in this map …`, 적용 후 서버 `input="요청서\n첨부자료"`·`input_flags="\noptional"`, 필 `[Required, Optional]` |
| J4 | 알 수 없는 플래그 값(`mandatory`) → Input_Flags 경고 + 값이 Required로 착지 | ✅ | **이슈 #2** — 경고는 정상 노출(`Row 2: Input_Flags accepts only "optional" per line — other values were treated as required`)이나, **셀의 모든 줄이 무효라 정규화 결과가 빈 문자열이 되면** "빈 셀=기존 유지" 규칙에 걸려 기존 `optional`이 그대로 남는다(필 Optional 유지). 일부 줄만 무효한 변형(`"mandatory\noptional"`)은 기대대로 1행 Required·2행 Optional로 착지 |
| J5 | 원본→미러 흐름이 연결된 상태에선 배지 없음(편집·읽기 모드 모두) | ✅ | 편집모드 행 `warn=false`, 게시본 읽기모드 `1. 산출물 · PDF`에도 경고 아이콘 없음 |
| J6 | 원본↔미러 엣지 삭제 → 인풋 미러 행에 빨간 TriangleAlert + 툴팁 | ✅ | 행 마크업에 `svg.lucide-triangle-alert`, 감싼 요소 `title="No upstream flow path from its origin"`. 스크린샷에서 링크 아이콘 다음·텍스트 앞 위치 확인 |
| J7 | 읽기모드에서도 같은 배지 노출 | ✅ | 게시 버전 읽기모드 행 `warn=true`, 동일 title. 스크린샷 `J7-read-broken-badge` |
| J8 | 병렬 합류 **아웃풋** 미러엔 배지 없음(인풋 전용 규칙) + 엣지 복구 시 배지 소멸 | ✅ | 경로 없는 병렬 아웃풋 미러 `warn=false`, A→B 엣지 재추가 후 인풋 미러도 `warn=false`로 복귀 |

## L. UI/UX 개선 검수 (2026-08-21)

`fb46744c` · `c70c8ace` · `a427ab84` · `1061a6c9`로 들어온 UI/UX 16건 + `591fd0c6`(#6·#7 재배치) + `5fd0b8fa`(안내 팝오버 다듬기) 재검증. 전 항목 실기동 검수 — 26/26 통과, 콘솔 에러 0.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| L1 | ~~GMP 픽커 스테이징/Confirm~~ → **재정의**: 픽커는 옵션 4개 아이콘 + 클릭 즉시 적용 | ✅ | **`591fd0c6`에서 재설계 — 스테이징·Confirm은 픽커에서 제거되고 안내 팝오버로 이동. 판정은 L21로 대체(이 행의 최초 측정은 폐기).** 아이콘 `[circle-dashed, shield-check, shield, shield-off]`는 그대로 유지 확인 |
| L2 | ~~픽커 호버 미리보기~~ → **재정의**: 미리보기/강조는 안내 팝오버가 담당 | ✅ | **`591fd0c6`에서 픽커의 `node-gmp-picker-preview`가 제거됨(count 0). 호버 강조 판정은 L23으로 대체(이 행의 최초 측정은 폐기).** |
| L3 | Unclassified 확정 → 노드색 타입 기본 리셋 + 되돌리기 토스트 점선 스와치 + "Restore color only" | ✅ | 확정 직후 노드 `--nc`가 `#4A7C7C`→타입 기본 `#6e84a3`, 토스트 두 번째 스와치 클래스에 `border-dashed`. Restore color only 클릭 → 서버 `color=#4A7C7C` 복원·`gmp=""` 유지 |
| L4 | 캔버스 GMP 필 "GMP Indirect"가 좁은 노드에서 한 줄 유지 | ✅ | 계산 스타일 `white-space: nowrap`, 필 높이 18px(1줄), 노드 폭 146px |
| L5 | 인스펙터 Attributes의 System 아래 GMP 행 — 편집=픽커, 읽기전용=배지만 | ✅ | 편집 `BUTTON`(클릭 시 픽커 열림 확인), 게시본 읽기전용 `SPAN`("GMP Direct" 배지) |
| L6 | Esc·바깥 클릭으로 픽커 닫힘 | ✅ | Esc·재오픈·바깥 클릭 3단계 모두 확인. `591fd0c6`(즉시 적용 전환) 이후에도 유효 — 옵션 클릭으로도 픽커가 닫힌다(L21) |
| L7 | 읽기전용에서 값 0인 섹션(Attributes/Parameters/Details) 딤 | ✅ | 빈 노드 3섹션 `opacity 0.5`, 값 있는 노드 3섹션 `1` |
| L8 | 노드 디스플레이 3카테고리 눈 버튼 + 영속 | ✅ | 1개 이상 켜짐=`EyeOff`("Hide all") → 클릭 시 전부 꺼짐=`Eye`("Show all"). details 일괄 켜기 후 input/output/conditions `aria-checked=true`, 새로고침 후에도 유지(localStorage `["params","input","output","conditions"]`) |
| L9 | 캔버스 표시 순서: 토글 역순이어도 속성→지표→조건→인풋→아웃풋 | ✅ | 토글 저장 순서를 역순으로 두고 렌더 확인 — `Bora Choi \| Support Team \| MES \| Ref \| 1h30m \| 시작조건 \| 종료조건 \| INPUT … \| OUTPUT …` 인덱스 단조 증가 |
| L10 | IO 체크리스트: 박스형 목록+체크박스, 체크=취소선, 비영속, 드래그·더블클릭 미유출 | ✅ | 목록 컨테이너 border 1px·radius 8px·체크박스 2개, 체크 시 `line-through`. 목록 더블클릭에 요약 모달 안 열림, 목록 위 드래그로 노드 transform 불변, 리로드 시 해제 |
| L11 | 그룹 동반 체크: 미러 인풋 체크 → 원본 아웃풋·형제 미러 동시 체크 | ✅ | `l-b` 인풋0 체크 → `l-a` 아웃풋0·`l-c` 아웃풋0 모두 `checked`, 무관 행(`l-b` 인풋1)은 false |
| L12 | Tab 순회가 GMP 태그·체크박스에 머물지 않음(서브프로세스 펼침 내부 노드 포함) | ✅ | 루트: Tab 4회 모두 노드 컨테이너(`l-b→l-c→l-empty→l-end`). SP 펼침 후 내부 노드(`lh-sp/lsp-start`) 클릭 → Tab 4회는 내부 노드 2개 + 일반 버튼 2개, GMP 필·체크박스 정지 0회 |
| L13 | 네비게이션 애니메이션 중 다른 노드 클릭 → 선택 링·인스펙터 일치 | ✅ | 미러 더블클릭(카메라 이동) 120ms 후 `l-c` 클릭 → 선택 노드 `["l-c"]`, 인스펙터 제목 `Node C` |
| L14 | 미러 행 1클릭=행 포커스 링만·캔버스 이동 없음, 더블클릭=원본 이동 | ✅ | 클릭 후 래퍼에 `ring-accent`·viewport transform 불변·선택 `l-b` 유지. 더블클릭 후 선택 `l-a`·transform 변경 |
| L15 | 인박스 컨트롤: 평소 숨김, 행 호버·선택 시 입력 박스 우측 안에 표시 | ✅ | 오버레이 opacity 0 → 호버 1 → 행 선택 1. 오버레이 우측 경계가 입력 박스 안(`insideRight`), 플래그·형식·× 3종 포함. 스크린샷에서 비호버 행엔 컨트롤 없음 확인 |
| L16 | R/O 플래그: 평소 이니셜, 토글 시 풀 라벨 확장 후 ~0.9s 뒤 축소 | ✅ | `O`(max-w-3) → 토글 직후 `Required`(max-w-16) → 1.2s 후 `R`(max-w-3) |
| L17 | 읽기전용 링크 항목 클릭 → 연결 노드 드롭다운(호버 하이라이트·클릭 이동), SP 카드 원본 행 포함 | ✅ | 원본 행 → 2행(`Node B/Input`, `Node C/Output`), 행 호버 시 해당 노드만 하이라이트, 클릭 시 그 노드 선택. 미러 행 → 원본 1행. SP 카드 원본 행 → 소비 노드 1행 |
| L18 | 읽기 행 필 디자인: 형식 필 + R/O 필, 접미 텍스트(`· PDF`) 없음 | ✅ | 행1 `pills=[PDF, R]`, 행2 `pills=[O]`, 두 행 모두 `·` 접미 없음 |
| L19 | SP 노드 모달(편집 모드): I/O & Conditions가 링크맵 상속 읽기전용 + 안내 문구, 파라미터는 상속값 | ✅ | 편집 가능한 IO 입력 0개, 상세 텍스트에 `SP인풋`/`SP산출물PDF` + `Set by the subprocess owner in map settings.`, Metrics는 상속값(`2h`, `30m`, `₩50,000`, `3`) |
| L20 | 읽기전용 모달: 타입/설명 + Attributes(GMP 배지)·Parameters(포맷값)·I/O(필 스타일) 표시, 빈 섹션 생략 | ✅ | `Type: Process` + `summary-read-attrs`(GMP Direct 배지)·`summary-read-params`(`1h30m`)·`summary-read-details`(PDF 필) 모두 노출. 값 없는 노드에선 세 섹션 전부 미렌더 |

### L21~L26 — #6·#7 재배치(`591fd0c6`) + 안내 팝오버 다듬기(`5fd0b8fa`) 재검증

스테이징·Confirm·호버 미리보기가 픽커에서 **안내 팝오버(`GmpNoticePopover`)로 이동**한 뒤의 재검수(L21~L24). L1·L2는 이 항목들로 대체된다. `5fd0b8fa`에서 팝오버 폭 고정(L25) · 딤→**접힘형** 호버 미리보기 전환(L23 재정의) · **캔버스 노드 실시간 반영**(L26)이 들어와 함께 검수했다.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| L21 | 픽커 즉시 적용 + 동일값 재선택 no-op(커스텀 색 유지) | ✅ | 픽커에 `node-gmp-picker-confirm`·`node-gmp-picker-preview` 모두 count 0(제거 확인), 옵션 아이콘 4종 유지. 현재값(indirect) 재선택 → 픽커만 닫히고 안내 미노출·노드 `--nc` `#4A7C7C` 유지·서버도 `gmp=indirect, color=#4A7C7C` 불변(커스텀 색 리셋 없음). 다른 값(direct) 선택 → Confirm 없이 즉시 반영(`--nc`→`#cc3300`) + 안내 팝오버 노출 |
| L22 | 안내 팝오버 버튼 아이콘 3종 + 우하단 Confirm으로 닫힘 | ✅ | `Palette`(Restore color only) · `Undo2`(Undo classification) · `Check`(Confirm, accent) 순으로 좌→우 배치(left 452 < 538 < 657), Confirm 우변 743 vs 팝오버 우변 756(패딩 13px) = 우하단 정렬. Confirm 클릭 시 닫힘 |
| L23 | ~~호버 강조: 반대편 행 딤(opacity 0.35)~~ → **재정의(`5fd0b8fa`)**: 접힘형 미리보기 — 버튼 호버 시 그 동작 뒤 **남을 값만 남고** 반대쪽 값 + 화살표는 폭이 접히며 사라진다 | ✅ | **딤 방식은 `5fd0b8fa`에서 폐기(이 행의 최초 측정은 폐기).** 세그먼트 span 6개(분류·색 × prev/arrow/next) computed 실측 — 무호버: 전부 `max-width 160px · opacity 1`. Restore color only 호버: 색 행 `[prev 160px/1, arrow 0px/0, next 0px/0]` · 분류 행 `[0px/0, 0px/0, next 160px/1]`. Undo classification 호버: 두 행 모두 prev만 남음. Confirm 호버: 두 행 모두 next만 남음. 이탈 시 6개 전부 복귀. 스크린샷 `L23-collapse-restore-color.png`·`L23-collapse-confirm.png`에서 남은 세그먼트가 라벨 쪽으로 밀려온 것 육안 확인 |
| L24 | 바깥 클릭·Esc 닫힘 + Restore color only(색만)·Undo(둘 다) 동작 | ✅ | 바깥 클릭·Esc 모두 닫힘. Restore color only → `gmp=direct` 유지·`color`만 이전(`#9a6b00`)으로 복원. Undo classification → 분류·색 둘 다 직전 상태로 복원. 미분류 선택 시 색 행의 "이후" 스와치가 점선(`border-dashed`)이고 노드 `--nc`가 타입 기본(`#6e84a3`)으로 리셋, 확정 후 서버 `gmp=""`·`color=""` |
| L25 | 팝오버 폭 `w-[400px]` + 배지·버튼 줄바꿈 없음(각 1줄, 3버튼 한 행) | ✅ | 미분류→indirect·direct→indirect 두 케이스 모두 폭 400px. 배지 `Unclassified`/`GMP Direct`/`GMP Indirect` 전부 `getClientRects()` 1개(=줄바꿈 없음). 푸터 3버튼 `Restore color only`·`Undo classification`·`Confirm` 각각 1줄이고 `top`이 셋 다 625로 동일 = 한 행에 정렬. 인스펙터 Attributes GMP 배지도 1줄(`GMP Direct`, h 28). 스크린샷 `L25-notice-width.png`. **게시본/뷰어 읽기전용 모달 배지는 이번 라운드 미측정(➖)** — 노출 자체는 L20에서 확인됨 |
| L26 | 버튼 호버 → 캔버스 노드에도 결과값 실시간 미리보기(렌더 전용·비영속) | ✅ | A=`direct`(`#cc3300`)에서 indirect 선택 → 노드 `--nc` `#9a6b00`·필 `GMP Indirect`로 즉시 적용되고 서버에도 저장. **Undo classification 호버 중 노드가 `#cc3300`·`GMP Direct`로 되돌아가고, 이탈하면 `#9a6b00`·`GMP Indirect`로 복귀**(스크린샷 `L26-node-preview-hover.png` / `L26-node-preview-off.png`, 노드·팝오버 한 화면). Confirm 호버=현행(`#9a6b00`), Restore color only 호버=분류 indirect 유지 + 색만 `#cc3300`. **호버 구간 그래프 쓰기 요청 0건**(관측된 건 체크아웃 하트비트 `POST /versions/*/checkout` 뿐)·서버 값 `indirect`/`#9a6b00` 불변. 실제 Undo 클릭 시에는 노드·서버 모두 `direct`/`#cc3300`으로 영속. 캔버스 필·인스펙터 두 진입 경로 모두 동일 동작 |

## M. 워스트 케이스 개선 검수 (2026-08-23)

`fe7b86bd`로 들어온 워스트 케이스 개선 6건 — IO 체크리스트 3단계 접힘(#2)·체크 동기 애니(#3)·디시전 제목 클램프/인쇄 해제(#4)·디시전 배지 코너 이동(#5)·엣지 라벨 줄바꿈(#6)·줄바꿈 힌트 4표면(#7).

시드: **S1** 워스트 프로세스 노드 `w`(70자 제목·담당 8명·부서/시스템/URL 장문·파라미터 6종·조건 2줄·인풋 6줄(2줄은 원본 `o`의 미러, 엣지 `o→w`)·아웃풋 5줄) + 280px 아래 일반 노드 `n`. **S2** 디시전 워스트 `d`(26자 제목·`gmp=direct`·파라미터 6종·분기 4엣지(라벨 23~27자)·인커밍 2·URL·담당 드리프트·미해결 코멘트 1). 노드 표시 토글은 9종 전부 ON(`bpm.nodeDisplayFields.v2`).

> 파라미터는 **6종**만 채웠다 — `cost_krw`/`cost_usd`는 배타(동시 입력 시 저장 422)라 7종 동시 세팅이 불가능하다(계약대로).

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| M1 | 인풋 체크리스트 기본 = 3줄 + 4번째 줄 절반, 하단 `Show more (+3)` | ✅ | 컨테이너 계산 스타일 `max-height 63px` · `overflow hidden`, `clientHeight 63 / scrollHeight 108`. 행 6개 렌더 중 **완전 노출 3 · 부분 노출 1**(경계 실측), 헤더 `Input(6)`. 스크린샷 `M01-checklist-capped.png`에서 4번째 행 `IN-D 승인 이력`이 가로로 잘린 것 육안 확인 |
| M2 | 헤더(쉐브론) 클릭 → 0줄 ↔ 재클릭 → 3.5줄 / Show more → 전체 + `Show less` → 3.5줄 | ✅ | 접힘: 목록 div 자체가 언마운트(`rowCount 0`·more 버튼 없음·쉐브론 `rotate-90` 해제). 재클릭: `63px`·3+0.5줄 복귀. Show more: `max-height none`·6행 전부 완전 노출·라벨 `Show less`. Show less: `63px`·`Show more (+3)` 복귀 |
| M3 | 캡 상태 워스트 노드 높이가 크게 줄어 280px 아래 노드 N과 겹치지 않음 | ❌ | **이슈 #3.** 캡 상태 노드 높이 **628px** — 280px 아래 `n`과 `gap = -309px`(N이 W 박스 안에 완전히 포함). 전량 펼침 710px 대비 **-82px(12%)**뿐 — 체크리스트는 두 목록 합쳐 244px 중 90px만 담당하고 나머지는 제목 68·담당 37·부서 21·시스템 37·URL 21·파라미터 39·조건 92px가 차지한다. 줌아웃 스샷 `M03-worst-capped-canvas.png`에서 N이 W에 완전히 가려진 것 육안 확인. **높이 기반 간격 재조정(#1)** 별도 브랜치로 이월된 트랙과 동일 원인이라 그쪽에서 해소 예정 — 이 라운드에서는 ❌로 유지 |
| M4 | 링크 항목 체크 → 상대 목록 자동 펼침 + 행 플래시/체크박스 팝(120ms 지연) + 체크 동기 | ✅ | `o`의 아웃풋 목록을 헤더로 0줄까지 접은 뒤 `w` 인풋 미러 체크 → `o` 목록이 `63px`(3+0.5줄)로 자동 복귀, 행 0 `checked=true`. 애니메이션 rAF 추적 26프레임: 행 `bpm-io-pulse-bg`·체크박스 `bpm-io-pulse-box`, `getTiming().delay = 120ms`(양쪽), duration 700, 지연 구간 프레임 10개(progress 0 고정, 마지막 t=136ms) 후 t=153ms부터 progress>0. **미러가 상대 목록의 5번째 줄(index 4)인 케이스**는 캡이 아니라 `all`로 펼쳐짐(`max-height none`·5행 전부 노출·행 4 체크 동기). 애니 중 스샷 `M04-check-sync-pulse.png`(캡처 시점 `playState running`, currentTime 233ms) |
| M5 | 애니 재생 중 다른 항목 연타 → 상태 꼬임·에러 없이 최종 상태 일치 | ✅ | 펄스 시작 직후 25ms 간격 7연타(3↗4↗5↗3↘0↗1↘1↗) → 최종 `[true,true,true,false,true,true]` = 조작 결과와 정확히 일치. 원본 `o` 동반 체크(행 0·4)도 유지. 이 구간 콘솔 에러 0 |
| M6 | 디시전: GMP 필 좌상단, 제목 가운데 3줄 클램프+말줄임(전문은 title 툴팁) | ✅ | 96px 박스 기준 GMP 필 `left 0 / top 0`(`GMP Direct`), 제목 `-webkit-line-clamp 3`·`overflow hidden`·`scrollHeight > clientHeight`(=말줄임 발생), `title` 속성이 전문과 정확히 일치. 스크린샷 `M06-decision-clamp.png` |
| M7 | PNG 내보내기 시 클램프 해제 + **넓은 폭**으로 전문 노출, 캡처 후 화면 원복 | ✅ | **1차 ❌(이슈 #4) → 픽스 커밋 `140367a5`(`width:200px` + `flex-shrink:0` 추가)에서 재검증 통과.** 1차 증상은 `max-width:200px`만으론 96px flex 부모가 도로 눌러 렌더 폭이 81px에 머문 것. 재검증(레이아웃 px 실측, 줌 배율 영향 배제) — 보정 적용 시점 `width/max-width 200px · flex-shrink 0 · boxWidth 200px · clamp none · clipped false`, 화면(80px 클램프)에서 필요한 전체 줄 수 대비 **D(32자) 4L@80px → 2L@200px · D2(53자) 6L@80px → 3L@200px**로 세로 기둥이 아닌 넓은 몇 줄로 착지. 저장된 PNG(`M07-decision-print.png`, 2380×1712)에서 두 마름모 제목 모두 전문·말줄임 없음 육안 확인. 캡처 후 원복 정상(`width 80px`·`flex-shrink 1`·clamp 3·clipped 복귀). **단, 이 폭 확장은 후속 `ad0131ec`에서 사용자 결정으로 되돌려졌다** — 넓힌 제목이 마름모 밖으로 퍼져 어색하다는 판단. 현행 계약은 "인쇄에서 클램프만 해제(폭은 화면 그대로)"이며 N5에서 재검증했다 |
| M8 | URL·담당 경고 배지가 96px 박스 진짜 코너로 이동, 3줄 제목과 미겹침 | ✅ | 박스 상대좌표 — URL `left 0 / bottom 0`, 담당 경고 `right 0 / bottom 0`(`title="Assignee department mismatch"`), 코멘트 `right 0 / top 0`(`1 unresolved comments`). 세 배지 모두 제목 박스와 사각형 교차 `false`. 스크린샷 `M06-decision-clamp.png` 겸용 |
| M9 | 20자+ 분기 라벨이 160px에서 자동 줄바꿈, 이웃 노드 미침범 | ✅ | 라벨 4개 전부 `max-width 160px`·`overflow-wrap break-word`, 실측 폭 136px·높이 30px = **2줄**(line-height 기준), 각 라벨과 교차하는 노드 **0개**. 스크린샷 `M09-edge-label-wrap.png` |
| M10 | 줄바꿈 힌트 4표면 노출 (`Enter to save · Alt+Enter for a new line`) | ✅ | (a) 캔버스 인라인 이름 편집 textarea `title` 속성 · (b) 노드 편집 모달 이름 필드 아래 `<p>` · (c) 인스펙터 이름 필드 아래 `<p>` · (d) 인스펙터 엣지 라벨 필드 아래 `<p>` — 4곳 모두 문구 완전 일치. 스크린샷 `M10-newline-hint.png`(인스펙터 엣지 라벨) |

### 참고 (M 라운드)

- **콘솔 에러 0** — 시드~teardown 전 페이즈 누적 0건(`console.error`·`pageerror`).
- **잔류 0** — 생성한 QA 맵 2개는 소프트삭제 + ORM 하드퍼지, 전 테이블 행수가 베이스라인과 일치(`login_records` 제외 — 기존 규약).
- **엣지 미렌더 1회 관측(재현 실패)**: 4회 실행 중 1회, S2를 연 직후 디시전 `d`에 붙은 엣지 6개가 DOM에서 통째로 사라지고 `d`와 무관한 `s2-e2` 1개만 남았다(서버 그래프는 7개 정상). 동일 시드를 단독 재현 스크립트로 3회 반복했으나 매번 7개 전부 렌더돼 원인을 특정하지 못했다. **이번 커밋(`fe7b86bd`)의 변경 표면(라벨 폭·클램프·배지 위치)과는 무관**하고 간헐적이라 이슈로 올리지 않고 관측 기록만 남긴다.
- **드라이버 메모**: 노드 내부 컨트롤은 좌표 클릭이 아니라 DOM 요소에 직접 dispatch했다 — 첫 실행에서 W 위에 겹쳐 그려진 N이 좌표 히트테스트를 가로채 헤더 토글이 먹지 않았기 때문(겹침 자체가 M3의 증상). 최종 실행의 헤더 중심 `elementFromPoint`는 `w`로 해석돼 헤더 자체는 조작 가능하다.
- **인스펙터 Map 탭**: PNG 내보내기 버튼(`export-png`)은 선택 해제 + **Map 탭 전환**까지 해야 마운트된다(속성 탭 기본). 기능 이상 아님 — 드라이버 경로 기록.

## N. 사용자 후속 5종 검수 (2026-08-23)

`ad0131ec`로 들어온 후속 다듬기 — kbd 힌트 칩(`NewlineHint`)·디시전 1:1.2 가로 확장(116×96, `nodeSizeOf`/`COMPARE_RENDER_W` 동기)·GMP 태그 좌상단 바깥 이동·인쇄 폭 원복(클램프 해제만)·IO 행 호버 다듬기(흰 배경·체크박스 호버 노출·체크 텍스트 accent-tint)·펄스 팝 링+1.15.

시드: **Map A** 워스트 디시전 `dec`(`gmp=indirect`·URL·담당 드리프트·미해결 코멘트 1·파라미터 6종·분기 2) + IO 링크 노드(`o` 아웃풋 5줄 원본 ↔ `w` 인풋 6줄 중 2줄 미러, 미러 상대 인덱스 0·**2**) · **Map B** 디시전+고립 프로세스(드롭 충돌·비교뷰용). 표시 토글 9종 전부 ON.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| N1 | 줄바꿈 힌트 4표면 — 캡션 3곳은 kbd 칩, 캔버스 인라인은 title 툴팁 | ✅ | 노드 편집 모달·인스펙터 이름·인스펙터 엣지 라벨 **3곳 모두** `<kbd>` 4개 = `["Enter","Alt","Shift","Enter"]` + 텍스트 `to save` / `for a new line`(= `[Enter] to save · [Alt]/[Shift]+[Enter] for a new line`). 캔버스 인라인 textarea `title="Enter to save · Alt/Shift+Enter for a new line"`. 스크린샷 `N01-kbd-hint.png` |
| N2 | 인스펙터 이름 필드 키 동작 — Shift+Enter·Alt+Enter 줄바꿈, Enter 블러 | ✅ | `keyboard.down/up`으로 모디파이어 전달(CDP 주의). `"선행 노드 P"` → Shift+Enter `"선행 노드 P\n"` → Alt+Enter `"선행 노드 P\n\n"` → 단독 Enter는 값 불변 + `document.activeElement`가 textarea에서 벗어남 |
| N3 | 디시전 116×96 · 마름모 1:1.2 · 엣지 앵커·드롭 충돌 무회귀 | ✅ | 박스 `offsetWidth 116 / offsetHeight 96`. 마름모 실측 `122.2×101.8` = **비율 1.200**. 엣지 끝점이 마름모 좌/우 꼭짓점에서 각각 **Δ2.4px**, 세로는 정확히 중앙(y=48). 앵커 규약은 프로세스 노드 대조군과 동일(둘 다 핸들 중심 +5.50px = React Flow 핸들 바깥 변) → 회귀 아님. 드롭 충돌: 디시전 중심에서 X 120px 지점에 프로세스 노드를 놓자 **중심 간 dx=155px**로 분리(116 박스 기대 151 / 구 96 박스면 141) = `nodeSizeOf` 116 반영 확인. 스크린샷 `N03-decision-ratio.png` |
| N4 | GMP 태그 `-left-2 top-0` · 코멘트 배지 `right-0 top-0` 미겹침 | ✅ | 박스 상대 — 필 `left -8 / top 0`(폭 83.8, `GMP Indirect`), 코멘트 `right 0 / top 0`(폭 24.4). 두 사각형 교차 `false`, 사이 여백 **15.8px**. 스크린샷 `N04-gmp-comment.png` |
| N5 | 인쇄(PNG) — 폭은 화면 그대로(~80px), 클램프만 해제해 전문 노출 | ✅ | 보정 적용 시점 `width/max-width 80px · clamp none · clipped false`(200px 확장 없음 — `ad0131ec`에서 폭 강제 제거). 줄 수 `화면 3L(클램프, 전체 4L) → 인쇄 4L @80px`, 캡처 후 `80px`·clamp 3 원복. 스크린샷 `N05-print-unclamped.png`(2900×2400 export 원본)에서 제목 4줄·말줄임 없음 육안 확인 |
| N6 | IO 박스 흰 배경 · 행 호버 · 체크박스 호버 노출 · 체크 강조 | ✅ | 목록 배경 `rgb(255,255,255)`(= `--color-surface`, 이전 `surface-alt/60` 틴트 아님). 비호버 상태에서 체크박스 opacity `["1","0","0","0","0","0"]` = **체크된 1행만 보임**. 체크 텍스트 `bg rgb(239,235,255)`(accent-tint) + `color rgb(22,22,29)`(text-ink), `text-decoration none`(취소선 제거). 미체크 행 호버 시 체크박스 opacity 1 + 행 배경 `rgb(245,245,247)`(surface-alt). 스크린샷 `N06a-io-no-hover.png` · `N06b-io-row-hover.png` |
| N7 | 캡 경계 행 펄스 — 링+scale(1.15), 잘림 없음 | ✅ | 상대(`o` 아웃풋) 목록이 캡(`max-height 63px`)인 상태에서 **행 index 2**(마지막 완전 노출 행)에 펄스 재생. 30프레임 전부 `box-shadow` 링 적용, 관측 최대 스케일 **1.164**(키프레임 1.15 + `ease-overshoot` 오버슈트 — 구 1.35와 확연히 구분). 링 확산 포함 체크박스 경계가 캡 박스 안쪽으로 **아래 -5.96px · 위 -32.96px** 여유 = 잘림 0. 스크린샷 `N07-pulse.png` |
| N8 | 비교뷰 회귀 — 디시전 포함 레이아웃 정상·세로 엣지 직선 | ✅ | `/maps/{id}/compare` 정상 로드(노드 4·`compare-load-error` 없음). 세로 배치(TB) 전환 후 디시전 전후 엣지 2개 모두 **Δx = 0.00px**(Δy 261 / 247) = 완전 직선 → `COMPARE_RENDER_W` 116 반영 확인. 스크린샷 `N08-compare-tb.png` |

### 참고 (N 라운드)

- **콘솔 에러 0** · **잔류 0**(맵 2개 소프트삭제 + ORM 하드퍼지 후 전 테이블 행수 베이스라인 일치).
- **엣지 앵커 오프셋은 원래 규약**: React Flow는 엣지를 핸들 *중심*이 아니라 핸들 박스 **바깥 변**(중심 ±5.5px, 핸들 11px)에 앵커한다. 프로세스 노드도 동일한 +5.50px라 디시전만의 문제가 아니다 — 핸들 중심 기준으로 판정하면 오탐이 난다(1차 실행에서 실제로 오탐).
- **마름모가 박스보다 3.1px 넓다**: 72px 정사각형을 회전(대각 101.8) 후 `scaleX(1.2)` → 시각 폭 122.2px로 116px 박스를 좌우 3.1px씩 넘어선다. 엣지 끝점(±5.5)은 그보다 2.4px 더 바깥이라 화살표가 꼭짓점에 닿아 보인다(스크린샷 확인). 의도된 여유로 판단해 결함으로 올리지 않았다.
- **비교뷰 TB에서 고립 노드가 Start와 겹쳐 보임**: Map B의 `mover`는 흐름에 연결되지 않은 노드라 dagre가 별도 컴포넌트로 배치하면서 Start 위에 겹쳤다. 디시전과 무관하고 시드가 만든 상황(드롭 충돌 테스트용 고립 노드)이라 이번 라운드 판정에서 제외했다 — 연결 노드들의 배치·엣지는 정상.

## P. IO 행 다듬기 검수 (2026-08-23)

`eb71c57d`로 들어온 IO 행 다듬기 — 디시전 제목 폭 `max-w-24`·IO 항목 2줄 클램프+체크박스 상단 정렬·필수/선택 글자색 분류·양식 아이콘 행 끝 고정·접기 버튼 호버 노출.

시드: **Map A** 프로세스 노드 `w`(인풋 6줄 = 71자 장문 1 + `optional` 플래그 2줄 + 양식 `Excel`/`Email`, 아웃풋 5줄 + 양식 `PDF`, 인덱스 2는 `o` 아웃풋의 미러) · SP 노드(지정 맵 `Map C`의 sp_input/sp_output + 양식 보유) · 디시전 2종(32자 `dec` / 58자 `dec2`). **Map C**는 게시(승인자=본인 체인) 후 `PUT /maps/{id}/subprocess-designation`으로 지정.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| P1 | 디시전 제목 박스 `max-w-24`(96px) + 3줄 클램프 유지 | ✅ | 두 디시전 모두 `max-width 96px`·`offsetWidth 96px`(노드 박스는 116px). 58자 `dec2`는 `-webkit-line-clamp 3`으로 **3줄에서 잘림**(전체 6줄, `clipped=true`) — 클램프 정상 동작. 넓어진 효과로 32자 `dec`는 96px에서 3줄에 전부 들어가 말줄임이 사라졌다(80px 시절엔 잘리던 제목). 스크린샷 `P01-decision-label.png` |
| P2 | 긴 IO 항목 2줄 클램프 + 체크박스 첫 줄 정렬 | ✅ | 71자 항목이 `line-clamp-2`로 **2줄 표시(전체 4줄)·말줄임 발생**. 행 `align-items: flex-start`, 체크박스 `offsetTop − span.offsetTop = 2px`(= `mt-0.5`)이고 중심이 첫 줄 밴드 안 → 첫 줄 정렬 확인. 스크린샷 `P02-io-two-lines.png` |
| P3 | 필수/선택 글자색 분류 | ✅ | 미체크 인풋 색 `[tertiary, muted, tertiary, tertiary, muted, tertiary]` = optional 줄(index 1·4)만 `rgb(160,160,168)`(ink-muted), 나머지는 `rgb(122,122,122)`(ink-tertiary). 아웃풋 5행은 전부 tertiary = **플래그가 아웃풋을 뮤트하지 않음**. optional·required 각각 체크 시 `bg rgb(239,235,255)`(accent-tint) + `color rgb(22,22,29)`(text-ink)로 동일 — 플래그 무관 |
| P4 | 양식 아이콘 행 끝 고정 + 툴팁 | ✅ | 양식 보유 행만 아이콘(인풋0 `Excel`/`lucide-file-spreadsheet`, 인풋2 `Email`, 아웃풋0 `PDF`) — 전부 **행의 마지막 자식**이고 텍스트 오른쪽. 2줄로 잘린 장문 행에서도 아이콘 유지(10px 렌더, 노드 박스 안쪽). `title` 속성이 canonical 값과 일치(네이티브 툴팁). 양식 없는 행은 아이콘 0개, **SP 노드 4행 전부 아이콘 없음**(`isSubprocess`면 form=null). 스크린샷 `P04-form-icon.png` |
| P5 | Show more/less 호버 노출 + 셰브론 | ✅ | 비호버 `opacity 0`(문구는 `Show more (+3)`로 DOM엔 존재) → IO 박스 호버 시 `opacity 1` + `lucide-chevron-down`. 클릭 시 `Show less` + `lucide-chevron-up` + `max-height none`(6행 전부), 재클릭 시 `63px` 캡 복귀. 스크린샷 `P05a-fold-idle.png`(버튼 안 보이고 4번째 반 줄만) · `P05b-fold-hover.png` |
| P6 | 회귀 — 헤더 접기·체크 동기 펄스·인쇄·N라운드 동작 | ✅ | 헤더 토글 0줄 접힘 정상. 체크 동기 펄스 `bpm-io-pulse-bg`·`delay 120ms`로 상대 행에 재생되고 동반 체크됨. PNG 내보내기: 보정이 `clamp none`만 적용하고 폭은 `96px` 유지(확장 없음), `dec2` 제목이 3줄(클램프) → **6줄 전문**으로 노출·`clipped=false`. N라운드 동작 유지 — 목록 배경 `rgb(255,255,255)`, 체크박스는 체크된 행만 `opacity 1` |

### 참고 (P 라운드)

- **콘솔 에러 0** · **잔류 0**(맵 2개 소프트삭제 + ORM 하드퍼지 후 전 테이블 행수 베이스라인 일치).
- **게시 워크플로 알림은 맵 cascade 밖**: SP 지정에 게시본이 필요해 이번 라운드는 제출→승인→게시를 태웠는데, 그 과정에서 생긴 `notifications` 3행이 `ProcessMap` ORM cascade로 지워지지 않아 잔류 대조가 깨졌다(느슨한 참조 — 모델 주석대로 FK 없음). teardown에서 `map_id` 스코프로 함께 삭제해야 0잔류가 된다. 저장소의 `frontend/scripts/_purge-test-map.py`는 알림을 건드리지 않으므로, 게시를 태우는 검수는 별도 퍼지가 필요하다.
- **측정 함정 재발(M 라운드와 동일)**: 캔버스 안 요소의 줄 수·폭을 `getBoundingClientRect()`로 재면 React Flow 뷰포트 `scale(zoom)`이 곱해져 2줄이 1줄로 보인다. **`offsetHeight`/`offsetWidth`/`offsetTop`만 사용**할 것.
- **SP 지정 엔드포인트는 `PUT`** `/api/maps/{id}/subprocess-designation`(POST는 405) — 게시 버전이 없으면 409.
- **스샷 가독성**: 기본 fitView 줌(≈0.68)에서 IO 행 크롭은 판독이 어려워, `deviceScaleFactor: 2` + 대상 노드 위 휠 줌인(포인터를 매 틱 노드 중심으로 재이동)으로 촬영했다. 측정값은 전부 `offset*`이라 줌 변경의 영향을 받지 않는다.

## Q. SP 양식 스레딩 · 마크 인라인 검수 (2026-08-23)

`4dbfa7f2`로 들어온 두 건 — 지정 맵의 `sp_input_forms`/`sp_output_forms`를 `subprocess_refs` 경유로 노드 data(`spInputForms`/`spOutputForms`)까지 스레딩(그전엔 SP 행 양식 아이콘이 조용히 누락), SP 마크(Workflow)를 라벨 앞 인라인으로 옮겨 아래 줄들이 노드 전체 폭을 쓰게 함.

시드: **Map C**(긴 이름 → 라벨 4줄 감김) v1 게시 + 지정(`input_forms="Excel\n\nEmail"`·`output_forms="PDF"`) 후 v2까지 게시 → `sp1`이 v1 고정(`follow_latest=false`)이라 새 발행본 배지 유발 · **Map E** 별도 지정 맵(같은 맵을 한 맵 안에 두 번 링크하면 422 — SP 링크 유일성) → `sp2`(follow_latest) · **Map D** 미지정 → `sp3`(경고 배지) · 프로세스 노드 `w`(양식 `Excel`/`PDF`) + 디시전.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| Q1 | SP 캔버스 IO 행이 링크 맵 지정 양식 아이콘을 상속 | ✅ | 인풋 3행 `[Excel, (없음), Email]`·아웃풋 2행 `[PDF, (없음)]`으로 **양식 있는 줄만** 아이콘(`lucide-file-spreadsheet` 등), `title`은 canonical 값과 일치. 아이콘이 실제로 보이는지도 실측 — 크기>0·노드 박스 안·텍스트 오른쪽·`visibility visible`·`opacity>0.5` 전부 통과. `follow_latest` 노드(`sp2`)도 동일 상속. 스크린샷 `Q01-sp-form-icons.png` |
| Q2 | 네이티브 툴팁 실물 캡처 | ➖ | **NOT CAPTURABLE — 환경 제약(제품 이상 아님).** headed Chrome으로 실제 창을 띄우고 아이콘에 마우스를 올린 뒤 1.8초 대기했으나 macOS 화면 기록 권한(TCC)이 없어 3경로 모두 실패: `screencapture -x`(전체) → `could not create image from display` · `screencapture -x -R`(커서 주변 영역) → `could not create image from rect` · `screencapture -l`(창 id) → `could not create image from window`. **대신 툴팁 성립 조건을 DOM으로 실측** — 호버 대상 요소가 `title="Excel"`을 보유하고 `mouseover`를 수신하며 `elementFromPoint` 히트테스트가 같은 요소로 해석됨(A4와 동일 판정 방식). 브라우저 크롬이라 CDP 스크린샷에는 원래 안 잡힌다 |
| Q3 | SP 마크 라벨 앞 인라인 + 아래 줄 전체 폭 | ✅ | 라벨 행 `display flex · gap 6px(gap-1.5) · align-items center`, 마크가 그 행의 **첫 자식**(markLeft 6.7 → markRight 15, 라벨 시작 34). IO 목록 폭 **154px**(노드 180 − 좌우 패딩 12×2 − 테두리 1.5×2)이고 `offsetLeft 12`로 패딩 경계에서 시작 = 아이콘 열이 사라져 전체 폭 사용(이전 ~136px). 긴 맵 이름은 **4줄로 감기며 아이콘 오른쪽**에 머문다(labelLeft 34 > markRight 15). 스크린샷 `Q03-sp-mark-inline.png` |
| Q4 | 회귀 — 세로 중앙·배지·핸들·타 노드 | ✅ | 표시 토글 전부 OFF(제목만)일 때 `min-height 64px`·`flex-direction column`·`justify-content center`이고 라벨 행 위/아래 여백 11 / 13px(반올림 차 2px 이내) = 세로 중앙 유지. 배지 — 고정 노드 `sp1`에 새 발행본 점 배지(`title="Newer published version available"` + accent 점), `follow_latest` `sp2`엔 없음, 미지정 `sp3`엔 경고 삼각형. 핸들은 SP 전 노드에 렌더(각 2개: in/`__primary__`). 프로세스(150px·IO 아이콘 `Excel`)·디시전(116×96·GMP 필) 무영향 |

### 참고 (Q 라운드)

- **콘솔 에러 0** · **잔류 0**(맵 4개 소프트삭제 + 하드퍼지, 게시 워크플로 알림도 `map_id` 스코프 삭제 — P 라운드 교훈 적용).
- **SP 링크 유일성**: 한 맵 안에서 같은 링크맵을 두 번 참조하면 `PUT /graph`가 422(`subprocess map already linked in this map`). 대조군이 필요하면 지정 맵을 하나 더 만들어야 한다.
- **SVG엔 `offsetLeft`/`offsetTop`이 없다**(HTMLElement 전용) — Lucide 아이콘 위치를 offset으로 재면 `undefined`가 되어 비교가 조용히 false가 된다. SVG는 `getBoundingClientRect()`로 재고 같은 스케일의 기준 요소와 상대 비교할 것.
- **`updateAvailable` 유발 조건**: `follow_latest=false` + `linked_version_id` 지정 + 라이브러리의 `latest_published_version_id`가 그보다 클 것. 즉 링크맵을 **두 번 게시**해야 배지가 뜬다.
- **SP 지정은 게시본 필수**: 지정 전에 제출→승인→게시 체인을 태워야 한다(승인자를 본인으로 두면 3콜). 미게시 맵에 지정하면 409.

## R. SP 버전 배너 검수 (2026-08-23)

`c0668d94`로 들어온 SP 버전 추적 배너 — 새 발행본 안내가 6px 점에서 **전체 폭 틴트 배너**로 바뀌고, 캔버스에 없던 **핀 고정(최신 미추종) 안내**가 추가됐다. 새 발행본은 핀 고정을 함의하므로 배너는 항상 하나만 뜬다.

시드: 지정 SP 원본 맵 3개(각각 게시 체인) — **SubA**는 2회 게시 후 `spA`가 v1 고정(`follow_latest=false`) → 새 발행본 · **SubB**는 1회 게시 후 `spB`가 그 v1 고정 → 핀 고정 · **SubC**는 `spC`가 `follow_latest=true` → 무배너. 링크 맵은 SP 링크 유일성 때문에 노드마다 별도 맵을 써야 한다.

| # | 항목 | 결과 | 비고 |
|---|---|---|---|
| R1 | 새 발행본 배너(`sp-banner-update`) | ✅ | `spA` 하단에 `background rgb(239,235,255)`(accent-tint) + `border 1px rgb(215,204,255)`(accent-tint-border) + `CircleArrowUp` **12px** + 문구 `Newer published version available`(폭 154px에서 **2줄** 감김), 글자색 `rgb(106,65,255)`. 폭 154px = 노드 콘텐츠 폭과 일치(전체 폭), `align-items: flex-start` + 아이콘 `mt-0.5`로 **첫 줄 상단 정렬** 실측. **구 6px 점(`span.h-1.5.w-1.5.rounded-full`)은 세 SP 노드 모두에서 0개** = 제거 확인. 스크린샷 `R01-sp-update-banner.png` |
| R2 | 핀 고정 배너(`sp-banner-pinned`) + 상호 배제 | ✅ | `spB` 하단에 `background rgb(245,245,247)`(surface-alt) + `border 1px rgb(230,230,234)`(hairline) + `Pin` 12px + 문구 `Pinned version — not following latest`, 글자색 `rgb(51,51,51)`(ink-secondary) — 액센트가 아닌 중립 톤. `spA`는 **update 배너만** 있고 pinned 배너 없음(update가 pinned를 함의). 스크린샷 `R02-sp-pinned-banner.png`(spA·spB 한 프레임) |
| R3 | 추종 노드 무배너 | ✅ | `follow_latest=true`인 `spC`에는 `sp-banner-update`·`sp-banner-pinned` **둘 다 없음** |
| R4 | 회귀 — 폭·중앙정렬·배지·핸들·픽커 연동 | ✅ | 배너 유무와 무관하게 SP 노드 폭 **180px 고정**(3노드 전부), 핸들 각 2개(in/`__primary__`) 정상. 표시 토글 OFF(제목+배너만)에서도 `min-height 64px`·`flex-col`·`justify-center` 유지에 상하 여백 8 / 10px(테두리 1.5px 반영, 2px 이내). **인스펙터 버전 픽커의 Follow-latest 토글을 켜자 `aria-checked` false→true와 함께 핀 배너가 즉시 사라졌고**(update 배너로도 바뀌지 않음) 페이지 내비게이션 횟수는 1 그대로 = **리로드 없는 라이브 반영** |

### 참고 (R 라운드)

- **콘솔 에러 0** · **잔류 0**(맵 4개 소프트삭제 + 하드퍼지, 게시 알림도 `map_id` 스코프 삭제).
- **`empty:hidden` 자식은 위치 측정의 함정**: SP 노드 첫 자식인 GMP 필 래퍼는 값이 없으면 `display:none`이라 `offsetTop`이 0으로 잡힌다. 세로 중앙 판정 시 **보이는 자식만 골라** 첫/마지막을 잡아야 한다(그러지 않으면 gapTop이 0으로 나와 오탐).
- **배너가 붙으면 노드가 min-height를 넘긴다**: 제목+배너만으로도 높이 100px이라 `justify-center`는 사실상 무동작이고, 상하 여백은 패딩(8px)+테두리(1.5px)로 수렴한다 — 중앙정렬 판정은 "상하 여백이 서로 같은가"로 보는 게 맞다.

## 이슈 로그

### #1 미러 항목 호버 시 형제 미러까지 하이라이트 (F2 / F3 일부) — **수정 완료 · 재검증 통과**

- **증상**: 인스펙터에서 **미러** 항목을 호버하면 스펙상 원본 노드만 강조되어야 하는데, 같은 링크 그룹의 **다른 미러 노드까지** 함께 강조된다. 그 형제 미러로 가는 흐름 경로 엣지도 같이 켜진다.
  - 실측: 원본 `br-q` + 미러 `br-s`(인풋)·`br-r`(아웃풋) 구성에서 `br-s`의 미러 항목 호버 → `{nodes:["br-q","br-r"], edges:["b-e-q-s","b-e-r-s"]}`. 읽기모드에서도 동일(`ro-b` 미러 호버 → `{nodes:["ro-a","ro-c"]}`).
  - 원본 항목 호버(→ 모든 미러)는 규격대로 정상.
- **심각도**: **Minor** — 표시 범위만 넓고 데이터/저장에는 영향 없음. 다만 스펙(§4-5 "미러=원본 노드")과 코드 주석("원본이면 미러 전부, 미러면 원본") 양쪽과 어긋난다.
- **원인 위치**: `frontend/src/app/maps/[mapId]/page.tsx` `handleIoHoverItem` — `getIoLinkPeers` 결과의 `origin`과 `mirrors`를 호버 대상 종류와 무관하게 항상 합집합으로 사용한다.
- **재현 절차**: ① 원본 아웃풋 1개 + 미러 2개(다른 노드) 구성 → ② 미러 쪽 노드 선택 → ③ 인스펙터 IO 미러 항목 호버 → ④ 캔버스에서 원본 외 형제 미러 노드에도 액센트 링이 뜬다.
- **조치**: **`34ccb79e`에서 수정, 재검증 통과.** `handleIoHoverItem`이 호버 대상을 분기하도록 변경 — 원본이 선택 노드 자신이면 미러 전부, 아니면 원본 하나만, 원본 소실(댕글링)이면 아무것도 점등하지 않는다.
- **재검증(2026-08-21, `34ccb79e`)**: 원본 1 + 미러 2(인풋·아웃풋) 전용 맵으로 4케이스 실측 — 미러(인풋) 호버 `{nodes:[f2-q], edges:[f2-e-q-s]}` / 병렬 미러(아웃풋) 호버 `{nodes:[f2-q], edges:[]}` / 원본 호버 `{nodes:[f2-r,f2-s], edges:[f2-e-q-s]}` / 엣지 삭제 후 미러 호버 `{nodes:[f2-q], edges:[]}`. 형제 미러 점등은 전 케이스에서 사라졌고, SP 원본↔미러 호버(H1 경로)도 각각 상대 1개만 점등되는 것으로 회귀 없음 확인. 콘솔 에러 0.

### #2 CSV Input_Flags — 셀 전 줄이 무효면 경고와 달리 기존 값이 유지됨 (J4) · **수정 완료**

조치: "셀 제공" 판정을 정규화 결과와 분리(원문 셀 기준 post-merge 확정 반영) + `required` 유효 토큰 추가(Optional→Required 명시 리셋 경로 신설). 회귀 테스트 2건 추가, vitest 740 그린 — 단위 테스트로 재검증(브라우저 재검은 생략, 착지 값만 달라지는 변경).

- **증상**: `Input_Flags` 셀의 값이 전부 알 수 없는 값이면(예: 유일한 비어있지 않은 줄이 `mandatory`) 경고는 `Input_Flags accepts only "optional" per line — other values were treated as required`로 뜨는데, 실제 저장값은 **기존 `optional`이 그대로 유지**된다. 경고 문구와 결과가 어긋난다.
- **원인**: `normalizeInputFlagsCell`이 무효 줄을 `""`로 낮춘 뒤 `join("\n").replace(/\s+$/,"")`를 적용해, 전 줄이 무효면 셀 전체가 `""`가 된다. 그 뒤 `mergeNode`는 `nextFlags === ""`를 "셀 미제공"으로 보고 "빈 셀=기존 값 유지" 규칙을 적용한다 — 즉 **"제공됐지만 전부 무효"와 "아예 비어 있음"이 구분되지 않는다.**
- **파급**: Input 텍스트가 그대로인 한 **CSV로 Optional을 다시 Required로 되돌릴 방법이 없다**(빈 셀·공백 셀·무효 값 셀이 모두 "유지"로 수렴). 텍스트가 바뀌면 정렬이 깨져 플래그 열이 소거되므로 그때는 초기화된다.
- **심각도**: **Minor** — 데이터 손실이 아니라 사용자 값 보존 쪽으로 치우친 동작이고, 일부 줄만 무효한 일반적 케이스(`"mandatory\noptional"`)는 기대대로 동작한다. 다만 경고 문구가 결과를 잘못 설명한다.
- **재현 절차**: ① 인풋 2항목 중 2번째를 Optional로 저장 → ② CSV 내보내기 → ③ 셀 `"\noptional"`을 `"\nmandatory"`로 바꿔 재임포트 → ④ 경고는 뜨지만 적용·리로드 후 2번 항목 필이 여전히 Optional.
- **조치**: 미수정(QA는 기록만). 고치려면 정규화 결과와 별개로 "셀이 제공됐는지"를 전달하거나(예: `null` vs `""` 구분), 문구를 실제 동작에 맞게 정정.

### #3 체크리스트 캡만으론 워스트 노드 높이가 실질적으로 줄지 않음 (M3) — **미수정**

- **증상**: IO 체크리스트를 3.5줄로 캡해도 워스트 프로세스 노드 높이는 **710px → 628px(-82px, 12%)**에 그친다. 280px 아래에 둔 일반 노드 `n`은 여전히 W 박스 **안쪽**에 완전히 들어가 겹친다(`gap = -309px`).
- **실측 분해**(표시 토글 9종 전부 ON, 노드 폭 240px): 제목 68 · 담당 37 · 부서 21 · 시스템 37 · URL 21 · 파라미터 39 · 조건 92 · 인풋 목록 122 · 아웃풋 목록 122 · 여백/배지 약 69 = 628px. 체크리스트 두 목록(244px) 중 캡이 절약하는 건 인풋 45 + 아웃풋 27 = 72px뿐이다.
- **심각도**: **Minor(설계 범위 문제)** — #2 자체는 스펙대로 동작한다. 다만 "워스트 노드가 아래 노드를 덮는다"는 원래 불만은 체크리스트 캡만으로 해소되지 않는다. 항목 수가 많을수록 절약폭은 커지지만(6줄→3.5줄이 상한), 지배 요인은 제목·담당·조건·파라미터의 상시 노출 쪽이다.
- **겹침의 부작용**: 겹친 구간에서는 위에 그려진 노드가 포인터 히트테스트를 가로채, 아래 노드의 체크박스·Show more 조작이 좌표에 따라 먹지 않는 사례를 관측했다(첫 실행에서 헤더 토글 클릭 무반응 → DOM 직접 dispatch로 우회). 최종 실행의 헤더 중심 히트테스트는 W로 해석돼 항상 막히는 건 아니다.
- **재현 절차**: ① 표시 토글 9종 ON → ② 제목 70자·담당 8명·부서/시스템/URL 장문·파라미터 6종·조건 2줄·인풋 6줄·아웃풋 5줄 노드 생성 → ③ 280px 아래에 일반 노드 배치 → ④ 두 노드의 화면 좌표 비교.
- **조치**: 미수정(QA는 기록만) — **높이 기반 간격 재조정(#1) 이월 브랜치**에서 함께 다룬다. 해소하려면 조건/담당/시스템 같은 나머지 섹션에도 캡 또는 접힘을 주거나, 노드 전체 최대 높이를 두고 넘치면 요약(예: `+N more`)으로 접는 방향이 필요하다.

### #4 인쇄(PNG) 제목 보정의 `max-width:200px`가 무효 — 폭이 안 넓어진다 (M7) — **수정 완료 · 재검증 통과**

- **증상**: `frontend/src/lib/export.ts` `applyEdgeFixups`가 마름모 제목에 걸어주는 두 보정 중 **클램프 해제만** 효과가 있고 **폭 확장은 무효**다. 보정 적용 시점 실측 `getComputedStyle(box).maxWidth = "200px"`이지만 `box.getBoundingClientRect().width = 81px`(화면 상태와 동일).
- **원인**: `.bpm-decision-title-box`의 부모가 `class="group relative flex h-24 w-24 items-center justify-center"` — **96px 고정 폭 flex 컨테이너**다. `max-width`를 200px로 올려도 flex 아이템이 기본 `flex-shrink:1`로 다시 96px 라인에 눌린다. `setImportant(box, "max-width", "200px")` 줄은 사실상 죽은 코드.
- **파급**: 인쇄물에서 제목은 **잘리지 않고 전문이 나오지만**(클램프 해제 덕분) 여전히 ~80px 폭에서 줄바꿈돼 마름모 밖으로 세로로 길게 흐른다. 긴 제목일수록 줄 수가 늘어 아래 파라미터 칩과 시각적으로 붙는다.
- **재현 절차**: ① 26자 이상 제목의 디시전 노드 → ② 인스펙터 Map 탭 → PNG 내보내기 → ③ 저장된 PNG에서 제목 폭이 노드 폭과 같은지 확인(또는 보정 적용 중 `offsetWidth` 측정).
- **조치**: **`140367a5`에서 수정** — `applyEdgeFixups`가 `.bpm-decision-title-box`에 `max-width`뿐 아니라 `width:200px`·`flex-shrink:0`까지 강제해 부모 flex가 되눌리지 못하게 했다.
- **후속 반전(`ad0131ec`)**: 폭 강제(`width`·`flex-shrink`·`max-width`) 자체가 사용자 결정으로 제거됐다 — 넓힌 제목이 마름모 밖으로 퍼져 어색했기 때문. 인쇄 보정은 **클램프 해제만** 남았고(전문은 같은 폭에서 줄 수가 늘어 노출) N5에서 재검증했다. 무효 코드 문제는 해소, 기능 요구는 축소 확정.
- **재검증(2026-08-23, `140367a5`)**: 26자·53자 두 마름모로 실측 — 보정 중 `width/max-width 200px · flex-shrink 0 · boxWidth 200px · clamp none · clipped false`, 줄 수 `4L@80px → 2L@200px` / `6L@80px → 3L@200px`, 캡처 후 `80px`·`flex-shrink 1`·clamp 3으로 원복. PNG 육안 확인 완료, 콘솔 에러 0, 드라이버 8/8.
- **측정 함정(기록)**: `getBoundingClientRect()`는 React Flow 뷰포트의 `transform: scale(zoom)`이 곱해져 실제 CSS px가 아니다(줌 0.85에서 80px 박스가 68px로 보임). 캔버스 요소의 폭 검증은 `offsetWidth`/`offsetHeight`로 할 것.

### 참고(결함 아님)

- **A5 — 비체크아웃 읽기전용 미검증**: 체크아웃을 API로 해제한 뒤 에디터를 열면 에디터가 체크아웃을 자동 재획득해 편집모드가 된다(io-linking 이전부터의 기존 동작). 읽기전용 판정은 **게시(published) 버전**과 **권한 없는 뷰어**(I5) 두 경로로 검증했다.
- **E6 replace 직후 소비 노드의 `input_links` 잔존**: 일괄 교체는 편집 대상 side의 열만 지우므로, 다른 노드에 남은 미러 링크는 그 시점엔 댕글링으로 남고 **다음 로드의 정합화에서 복사본으로 해산**된다(설계 §5 의도된 동작, 텍스트 보존 확인).
- **~~SP 원본 호버의 경로 엣지 미점등~~ → 검수 시드 결함이었음(`9dc6a3b5`에서 재검증, 제품 정상)**: 앞선 H1 관찰에서 엣지가 안 켜진 것은 **시드한 엣지가 캔버스에 렌더되지 않았기 때문**이다. SP 노드의 핸들 id는 일반 노드와 다른데(`target="in"`, `source=__primary__` 또는 끝 이름; 일반 노드는 `t-<side>`/`s-<side>`), API 시드가 `source_handle`/`target_handle`을 null로 둬 React Flow가 핸들을 못 찾고 그 엣지를 아예 그리지 않았다. 서버에는 엣지 3개가 있는데 캔버스 DOM엔 SP에 안 붙은 1개만 존재하는 것을 진단으로 확인. **핸들 id를 UI 연결과 동일하게 명시해 다시 시드하니 엣지 3개 전부 렌더되고, SP 원본 호버 → `{nodes:[소비노드], edges:[SP→소비 엣지]}`·소비 미러 호버 → `{nodes:[SP노드], edges:[SP→소비 엣지]}`로 경로 점등이 정상 확인**됐다. 즉 스펙 §4-5의 "흐름 경로 있으면 엣지 포함"은 SP에도 그대로 적용되고 있다. (교훈: SP 노드에 붙는 엣지를 API로 시드할 땐 핸들 id를 반드시 명시할 것)
- **폴리시 픽스(`9dc6a3b5`) 회귀 스팟체크**: 후보 목록 memo화·`subprocessRefs` 병합 순서 변경의 회귀를 확인 — 불러오기 모달 정상 개시, 행 호버 하이라이트 `{nodes:[원본], edges:[경로]}`, 클릭 임포트 1회로 미러 행 생성(readOnly·Link 아이콘·`aria-label="Disconnect"` 신규 확인·플래그 기본 `Required`), 서버 `output_ids ↔ input_links` 일치. `appendIoRow`의 flags 소거 픽스대로 새 미러 행 flags는 빈 값(기본 required). 콘솔 에러 0.
- **잔류**: 생성한 QA 맵 8개는 소프트삭제+ORM 하드퍼지로 전량 제거, 게시 워크플로가 만든 알림 12행도 map_id 스코프로 삭제해 베이스라인과 일치. `login_records` 2행(admin.sys·bora.choi)만 남으며, 이는 `scripts/_purge-test-map.py`에 명시된 의도적 예외(로그인id당 KST 하루 1행 dedup이라 소유 판별 불가).

## 결과 요약

- **일시**: 2026-08-21 (KST, A~L) · 2026-08-23 (KST, M·N) · **브랜치**: `feat/io-linking` @ `2ed64edc` → **M 라운드 `fe7b86bd`·N 라운드 `ad0131ec`·P 라운드 `eb71c57d`·Q 라운드 `4dbfa7f2`·R 라운드 `c0668d94`** (이슈 #1 재검증은 픽스 커밋 `34ccb79e`, L25·L26·L23 재정의는 `5fd0b8fa`)
- **환경**: macOS 로컬 네이티브 — backend `uvicorn :8000`(sqlite `dev.db`, `python -m scripts.reset_db` 데모 시드) + frontend `npm run dev :3000`, Playwright(playwright-core) + 시스템 Chrome headless 1600×1000, devUser `admin.sys`(뷰어 검증만 `bora.choi`).
- **점수**: **117 ✅ / 2 ❌ / 1 ➖ (총 120항목)** — 본 검수 A~I 54항목(1차 53✅/1❌ → 이슈 #1 `34ccb79e` 수정·재검증으로 54✅) + 백로그 반영 검수 J 8항목(7✅/1❌) + UI/UX 개선 검수 L 26항목(전부 ✅) + **워스트 케이스 개선 검수 M 10항목(1차 8✅/2❌ → M7이 픽스 커밋 `140367a5`로 ✅ 전환되어 9✅/1❌)** + **사용자 후속 5종 검수 N 8항목(전부 ✅)** + **IO 행 다듬기 검수 P 6항목(전부 ✅)** + **SP 양식·마크 검수 Q 4항목(3✅/1➖ — Q2는 macOS 화면 기록 권한 부재로 네이티브 툴팁 촬영 불가, 성립 조건은 DOM 실측)** + **SP 버전 배너 검수 R 4항목(전부 ✅)**. L25의 읽기전용 모달 배지 1줄 확인만 미측정(행 안 ➖ 주석)이라 행 판정에는 포함하지 않았다. 문서 상단 안내의 "51항목"은 실제 표 행수와 달라 표 기준으로 집계.
- **이슈**: #1 미러 호버 시 형제 미러까지 하이라이트 (Minor) — **수정·재검증 완료**. #2 CSV Input_Flags 전 줄 무효 시 경고와 달리 기존 값 유지 (Minor) — **미해결**. #3 체크리스트 캡만으론 워스트 노드 높이가 실질적으로 안 줄어 아래 노드와 겹침 (Minor·설계 범위) — **미해결(#1 간격 재조정 이월 브랜치로)**. #4 인쇄 제목 보정의 `max-width:200px`가 flex 부모에 눌려 무효 (Minor) — **`140367a5` 수정·재검증 완료**.
- **테스트 토폴로지**: R 라운드는 지정 SP 원본 맵 3개(하나는 2회 게시)+본 검수 맵 4개를 시드 후 퍼지. Q 라운드는 지정 맵 2개(하나는 2회 게시)·미지정 맵·본 검수 맵 총 4개를 시드 후 퍼지. P 라운드는 장문/optional/양식 IO 노드 + SP 노드 + 디시전 2종 맵과 SP 원본(게시·지정) 맵 2개를 시드 후 퍼지. N 라운드는 워스트 디시전+IO 링크 맵 · 드롭충돌/비교뷰 맵 2개를 추가로 시드 후 퍼지. 체인(A→B→C→D) · 병렬 분기(P→{Q,R}→S) · 순환(X→Y→Z→X) · 전파 전용 체인 · SP 지정/미지정 호스트 · 읽기전용/clone 검증용 — 총 8맵을 API로 생성 후 전량 퍼지. **M 라운드는 워스트 프로세스 맵(O→W→N) · 디시전 워스트 맵(2 인커밍 + 4 분기) 2맵**을 별도 시드 후 퍼지.
- **후속 검증 라운드**: 이슈 #1 픽스 재검증(`34ccb79e`) · 폴리시 픽스 검증(`9dc6a3b5`) · 백로그 기능 J1~J8(`353fc392`) · UI/UX 개선 L1~L20(`1061a6c9`) · GMP #6·#7 재배치 L21~L24(`591fd0c6`) · 안내 팝오버 폭/접힘 미리보기/노드 실시간 반영 L25·L26·L23 재정의(`5fd0b8fa`, 드라이버 체크 20/20) · **워스트 케이스 개선 M1~M10(`fe7b86bd`, 드라이버 체크 38/40)** · **M7 인쇄 폭 픽스 재검증(`140367a5`, 드라이버 체크 8/8)** · **사용자 후속 5종 N1~N8(`ad0131ec`, 드라이버 체크 30/30)** · **IO 행 다듬기 P1~P6(`eb71c57d`, 드라이버 체크 23/23)** · **SP 양식 스레딩·마크 인라인 Q1~Q4(`4dbfa7f2`, 드라이버 체크 16/16 + 1 skip)** · **SP 버전 배너 R1~R4(`c0668d94`, 드라이버 체크 13/13)**. 각 라운드도 전용 맵을 새로 시드해 실기동 후 전량 퍼지했고, 콘솔 에러는 모든 라운드 0건.
- **비고**: 검수는 임시 드라이버 스크립트(페이즈 분할)로 수행했고, 상태를 소모하는 성격이라 저장소에는 남기지 않았다. 재현 가능한 자동 회귀는 기존 `frontend/scripts/pw-smoke-io-links.mjs`(26체크)가 담당한다.
