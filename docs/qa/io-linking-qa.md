# IO 연결(불러오기) 브라우저 QA 검수 — 2026-08-21

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
| J4 | 알 수 없는 플래그 값(`mandatory`) → Input_Flags 경고 + 값이 Required로 착지 | ❌ | **이슈 #2** — 경고는 정상 노출(`Row 2: Input_Flags accepts only "optional" per line — other values were treated as required`)이나, **셀의 모든 줄이 무효라 정규화 결과가 빈 문자열이 되면** "빈 셀=기존 유지" 규칙에 걸려 기존 `optional`이 그대로 남는다(필 Optional 유지). 일부 줄만 무효한 변형(`"mandatory\noptional"`)은 기대대로 1행 Required·2행 Optional로 착지 |
| J5 | 원본→미러 흐름이 연결된 상태에선 배지 없음(편집·읽기 모드 모두) | ✅ | 편집모드 행 `warn=false`, 게시본 읽기모드 `1. 산출물 · PDF`에도 경고 아이콘 없음 |
| J6 | 원본↔미러 엣지 삭제 → 인풋 미러 행에 빨간 TriangleAlert + 툴팁 | ✅ | 행 마크업에 `svg.lucide-triangle-alert`, 감싼 요소 `title="No upstream flow path from its origin"`. 스크린샷에서 링크 아이콘 다음·텍스트 앞 위치 확인 |
| J7 | 읽기모드에서도 같은 배지 노출 | ✅ | 게시 버전 읽기모드 행 `warn=true`, 동일 title. 스크린샷 `J7-read-broken-badge` |
| J8 | 병렬 합류 **아웃풋** 미러엔 배지 없음(인풋 전용 규칙) + 엣지 복구 시 배지 소멸 | ✅ | 경로 없는 병렬 아웃풋 미러 `warn=false`, A→B 엣지 재추가 후 인풋 미러도 `warn=false`로 복귀 |

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

### #2 CSV Input_Flags — 셀 전 줄이 무효면 경고와 달리 기존 값이 유지됨 (J4) · **미수정**

- **증상**: `Input_Flags` 셀의 값이 전부 알 수 없는 값이면(예: 유일한 비어있지 않은 줄이 `mandatory`) 경고는 `Input_Flags accepts only "optional" per line — other values were treated as required`로 뜨는데, 실제 저장값은 **기존 `optional`이 그대로 유지**된다. 경고 문구와 결과가 어긋난다.
- **원인**: `normalizeInputFlagsCell`이 무효 줄을 `""`로 낮춘 뒤 `join("\n").replace(/\s+$/,"")`를 적용해, 전 줄이 무효면 셀 전체가 `""`가 된다. 그 뒤 `mergeNode`는 `nextFlags === ""`를 "셀 미제공"으로 보고 "빈 셀=기존 값 유지" 규칙을 적용한다 — 즉 **"제공됐지만 전부 무효"와 "아예 비어 있음"이 구분되지 않는다.**
- **파급**: Input 텍스트가 그대로인 한 **CSV로 Optional을 다시 Required로 되돌릴 방법이 없다**(빈 셀·공백 셀·무효 값 셀이 모두 "유지"로 수렴). 텍스트가 바뀌면 정렬이 깨져 플래그 열이 소거되므로 그때는 초기화된다.
- **심각도**: **Minor** — 데이터 손실이 아니라 사용자 값 보존 쪽으로 치우친 동작이고, 일부 줄만 무효한 일반적 케이스(`"mandatory\noptional"`)는 기대대로 동작한다. 다만 경고 문구가 결과를 잘못 설명한다.
- **재현 절차**: ① 인풋 2항목 중 2번째를 Optional로 저장 → ② CSV 내보내기 → ③ 셀 `"\noptional"`을 `"\nmandatory"`로 바꿔 재임포트 → ④ 경고는 뜨지만 적용·리로드 후 2번 항목 필이 여전히 Optional.
- **조치**: 미수정(QA는 기록만). 고치려면 정규화 결과와 별개로 "셀이 제공됐는지"를 전달하거나(예: `null` vs `""` 구분), 문구를 실제 동작에 맞게 정정.

### 참고(결함 아님)

- **A5 — 비체크아웃 읽기전용 미검증**: 체크아웃을 API로 해제한 뒤 에디터를 열면 에디터가 체크아웃을 자동 재획득해 편집모드가 된다(io-linking 이전부터의 기존 동작). 읽기전용 판정은 **게시(published) 버전**과 **권한 없는 뷰어**(I5) 두 경로로 검증했다.
- **E6 replace 직후 소비 노드의 `input_links` 잔존**: 일괄 교체는 편집 대상 side의 열만 지우므로, 다른 노드에 남은 미러 링크는 그 시점엔 댕글링으로 남고 **다음 로드의 정합화에서 복사본으로 해산**된다(설계 §5 의도된 동작, 텍스트 보존 확인).
- **~~SP 원본 호버의 경로 엣지 미점등~~ → 검수 시드 결함이었음(`9dc6a3b5`에서 재검증, 제품 정상)**: 앞선 H1 관찰에서 엣지가 안 켜진 것은 **시드한 엣지가 캔버스에 렌더되지 않았기 때문**이다. SP 노드의 핸들 id는 일반 노드와 다른데(`target="in"`, `source=__primary__` 또는 끝 이름; 일반 노드는 `t-<side>`/`s-<side>`), API 시드가 `source_handle`/`target_handle`을 null로 둬 React Flow가 핸들을 못 찾고 그 엣지를 아예 그리지 않았다. 서버에는 엣지 3개가 있는데 캔버스 DOM엔 SP에 안 붙은 1개만 존재하는 것을 진단으로 확인. **핸들 id를 UI 연결과 동일하게 명시해 다시 시드하니 엣지 3개 전부 렌더되고, SP 원본 호버 → `{nodes:[소비노드], edges:[SP→소비 엣지]}`·소비 미러 호버 → `{nodes:[SP노드], edges:[SP→소비 엣지]}`로 경로 점등이 정상 확인**됐다. 즉 스펙 §4-5의 "흐름 경로 있으면 엣지 포함"은 SP에도 그대로 적용되고 있다. (교훈: SP 노드에 붙는 엣지를 API로 시드할 땐 핸들 id를 반드시 명시할 것)
- **폴리시 픽스(`9dc6a3b5`) 회귀 스팟체크**: 후보 목록 memo화·`subprocessRefs` 병합 순서 변경의 회귀를 확인 — 불러오기 모달 정상 개시, 행 호버 하이라이트 `{nodes:[원본], edges:[경로]}`, 클릭 임포트 1회로 미러 행 생성(readOnly·Link 아이콘·`aria-label="Disconnect"` 신규 확인·플래그 기본 `Required`), 서버 `output_ids ↔ input_links` 일치. `appendIoRow`의 flags 소거 픽스대로 새 미러 행 flags는 빈 값(기본 required). 콘솔 에러 0.
- **잔류**: 생성한 QA 맵 8개는 소프트삭제+ORM 하드퍼지로 전량 제거, 게시 워크플로가 만든 알림 12행도 map_id 스코프로 삭제해 베이스라인과 일치. `login_records` 2행(admin.sys·bora.choi)만 남으며, 이는 `scripts/_purge-test-map.py`에 명시된 의도적 예외(로그인id당 KST 하루 1행 dedup이라 소유 판별 불가).

## 결과 요약

- **일시**: 2026-08-21 (KST) · **브랜치**: `feat/io-linking` @ `2ed64edc` (이슈 #1 재검증은 픽스 커밋 `34ccb79e`)
- **환경**: macOS 로컬 네이티브 — backend `uvicorn :8000`(sqlite `dev.db`, `python -m scripts.reset_db` 데모 시드) + frontend `npm run dev :3000`, Playwright(playwright-core) + 시스템 Chrome headless 1600×1000, devUser `admin.sys`(뷰어 검증만 `bora.choi`).
- **점수**: **61 ✅ / 1 ❌ / 0 ➖ (총 62항목)** — 본 검수 A~I 54항목(1차 53✅/1❌ → 이슈 #1 `34ccb79e` 수정·재검증으로 54✅) + 백로그 반영 검수 J 8항목(7✅/1❌). 문서 상단 안내의 "51항목"은 실제 표 행수와 달라 표 기준으로 집계.
- **이슈**: #1 미러 호버 시 형제 미러까지 하이라이트 (Minor) — **수정·재검증 완료**. #2 CSV Input_Flags 전 줄 무효 시 경고와 달리 기존 값 유지 (Minor) — **미해결**.
- **테스트 토폴로지**: 체인(A→B→C→D) · 병렬 분기(P→{Q,R}→S) · 순환(X→Y→Z→X) · 전파 전용 체인 · SP 지정/미지정 호스트 · 읽기전용/clone 검증용 — 총 8맵을 API로 생성 후 전량 퍼지.
- **후속 검증 라운드**: 이슈 #1 픽스 재검증(`34ccb79e`) · 폴리시 픽스 검증(`9dc6a3b5`) · 백로그 기능 J1~J8(`353fc392`). 각 라운드도 전용 맵을 새로 시드해 실기동 후 전량 퍼지했고, 콘솔 에러는 모든 라운드 0건.
- **비고**: 검수는 임시 드라이버 스크립트(페이즈 분할)로 수행했고, 상태를 소모하는 성격이라 저장소에는 남기지 않았다. 재현 가능한 자동 회귀는 기존 `frontend/scripts/pw-smoke-io-links.mjs`(26체크)가 담당한다.
