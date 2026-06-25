# Review Status & Follow-up Backlog (feat/flow-rbac-improvements)

> 브랜치 `feat/flow-rbac-improvements`의 **검토 현황 + 후속 백로그**. 커밋 단위 로그는 `PROGRESS.md`,
> 원래 15개 항목 계획은 `2026-06-24-process-flow-rbac-improvements.md` 참조.
> 자동 검증 기준선(매 커밋): backend pytest **316** · ruff clean · frontend tsc 0 · eslint 0 error · vitest **36** · build OK.

---

## 1. 검토 현황

| # | 항목 | 상태 |
|---|------|:----:|
| F2 | 노드간 1:1 회귀 방지 + Decision 우회 토스트 | ✅ |
| F11 | 드래프트 있으면 새 버전 차단(토스트) | ✅ |
| F12 | 맵 이름 전역 유니크 + 복사 확인 모달 + 홈 카드 쉬머 | ✅ |
| F10 | 오너 다운그레이드 무승인 + 승인자 이름 표시 | ✅ |
| F9 | 퍼블릭 맵 = editor만 + 백엔드 409 | ✅ |
| F6 | 관리자 단순화 — sysadmin이 admin 흡수 | ✅ |
| F8 | 맵 설정 협업자/결재자 스켈레톤 로딩 | ✅ |
| F15 | AD 동기화 제외항 | ✅ |
| F5 | 담당자/부서 검색 드롭다운 | ✅ 확인완료 |
| BL | 모달 바깥영역 블러 | ✅ 확인완료 |
| SR | 검색 일괄(키내비·아이디검색·subsequence·위치고정·필터한정) | ✅ 확인완료 |
| F1 | 디시전 드롭 — 분기/인터셉트/취소 3분기 | ✅ 확인완료 |
| F14 | `[`/`]` 하이라이트 — 끝/처음 클램프 + **분기 일괄 강조** | ✅ 확인완료 |
| ST | 맵세팅 단일스크롤+앵커내비 + **승인자 카드(직사각형·이름·아이디·소속5)** | ✅ 확인완료 |
| DL | 삭제 안내 시각 모달 | ✅ 확인완료 |
| HM | 조직 레벨별 아이콘 + 본인 **손든사람 아이콘+ME** | ✅ 확인완료 |
| PV | 가시성 스테이징(저장+미리보기) | ⏸ 검토 보류 |
| AP | 승인자 viewer+ 제한 (+소속 자격) | ⏸ 검토 보류 |

**회귀 확인 필요**: 노드/엣지 편집·드래그, 그룹, 하위프로세스 펼침/드릴, compare, undo/redo.
**사전 조건**: 서버 IP(HTTP) 접속 · enforce 시 `BPM_SYSADMINS` 등록.

---

## 2. 추가 수정항목 처리 내역 (2026-06-25)

### A. 1차 수정 9건
| # | 내용 |
|---|------|
| 1 | 엣지 라벨 편집박스 또렷하게(accent ring·캐럿·placeholder) |
| 2 | start/end 노드 기본 라벨 공란(표시는 Start/End) |
| 3 | 엣지 시작/끝 핸들 박스를 가로로 길고 낮게 — 메뉴 박스는 `edges` 반응형이라 클릭 즉시 반영 |
| 4 | 캔버스 승인자 관리 모달을 생성 다이얼로그 picker(viewer+ PrincipalPicker+선택목록)로 통일 |
| 5 | 홈 상세 유저=이름(아이디 회색)·말줄임, 검색·필터탭을 좌측 리스트 컬럼 상단 같은 폭으로 |
| 6 | 에디터 무선택 상세의 Open 버튼 제거(`hideOpen`) |
| 7 | 저장 시 start/end 누락 에러를 상단배너 → 토스트 |
| 8 | 노드 타입별 색 세트(메인6·start/end3·분기4)·접기 제거, 헥스는 인스펙터 아이콘(Palette)→입력 토글 |
| 9 | 생성 협업자 picker 드롭다운 플로팅(absolute) + 추가된 협업자 권한 클릭 토글(viewer↔editor) |

### B. 2차 수정
| 항목 | 내용 |
|------|------|
| F14 분기 | `getFlowPathForward` BFS로 분기 엣지 일괄 강조(사이클/중복합류 차단) |
| ST 카드 | `grid-cols-3/4`+`aspect-[4/3]`로 ~2/3 축소·직사각형, 텍스트 truncate |
| HM me | 'me' 원형배지 → **손든 사람(Hand) 아이콘 + 작은 ME**(악센트 선색) |
| AP 소속 | 생성 다이얼로그 승인자 후보에 **부서 협업자 부서원·그룹 협업자 멤버** 포함(설정은 서버 `effective_role`이 부서/그룹 권한 이미 반영) |
| PV 단일옵션 | 생성 협업자 역할이 public이면 editor 1옵션 → 드롭다운 대신 정적 표시(화살표 제거) |
| 세팅 순서 | 정보 > 공개범위 > 협업자 > 결재자 > 버전 > 결재 대기 > 위험 구역 |
| 카드 멤버보기 | 리스트 overflow/z-index에 잘리던 팝오버 → body 포털(fixed), 스크롤 시 닫힘 |

### C. 3차 수정
| 항목 | 내용 |
|------|------|
| 생성 협업자 추가 | 드롭다운에서 **선택(클릭/Enter) 즉시 현재 역할로 추가** — 별도 Add 버튼·선택 미리보기 제거 |

### D. 4차 수정
| 항목 | 내용 |
|------|------|
| A1 엣지 라벨박스 | 더블클릭 시 인스펙터 입력이 인라인 박스 포커스를 뺏어 즉시 blur→커밋되던 것 수정 — 인라인 박스를 못 띄울 때만 인스펙터 포커스. 빈 라벨도 엣지 위에 박스+깜빡이는 캐럿 |
| A2 아웃라인 | 좌측 아웃라인에서 start/end 빈 라벨이 "Untitled" → **terminalDisplayLabel**("Start"/"End") |
| A3 핸들 박스 | 변 strip 히트박스 8px로 확대 + **박스를 잇는 커넥터(점선+화살촉)가 선택한 source/target 면을 반영**(절대배치 SVG) |
| F14 뒤로 | `getFlowPathBackward`도 BFS로 분기(합류) 일괄. 선택 해제(pane click) 시 flow 상태 초기화 → 재선택 시 잔존 안 함 |
| AP 계층 | 생성 다이얼로그 부서 협업자를 **org_path 하위(센터→하위 팀/그룹 전원)**까지 후보 포함(말단명→org_path 매핑 + prefix) |
| 설정 협업자 추가 | 맵 설정 CollaboratorsPanel도 **선택 즉시 추가**(Add 버튼 제거), 역할은 picker 옆 토글(public이면 editor 정적) |

### E. 5차 수정
| 항목 | 내용 |
|------|------|
| 역할 라벨 영어 고정 | 한↔영 전환 중 레이아웃 깨짐 방지 — `perm.roleOwner/Editor/Viewer` + `collaboratorRole{Viewer,Editor}` 5개 키의 KO값을 **Owner/Editor/Viewer**로(전 화면 i18n 키 경유) |
| 승인 대기 상태 영어 고정 | 상태 라벨 5개(`home.verStatus.pending`·`perm.rolePending`·`group.statusPending`·`visibilityPending`·`version.waitingApproval`) KO값을 영어로(Pending/Pending approval/Approval pending/Awaiting approval). 토스트·문장형은 한글 유지 |
| 로그인 기록 수집 | (부가 기능) 사용자 현황조사용 `login_records` 테이블 + `/api/me` 호출 시 1건 기록. 모델 `LoginRecord`(login_id·name·occurred_at). **집계·리포트·중복제거는 후속**(현재 raw 기록만). startup create_all로 테이블 자동 생성 |
| 타임스탬프 KST 기준 | 공용 `app/clock.py`(KST=UTC+9)로 백엔드 시각 생성 통일(models._now·라우터). `checkout._as_aware`는 naive를 KST로(만료 9h skew 버그 수정). 프론트 `lib/datetime.formatKst/Short`(Asia/Seoul)로 표시 — 브라우저 tz 무관 KST |

---

## 3. 결정 사항 (확정)
- **SR-3** 매칭 우선순위 — 정확 > 접두 > subsequence.
- **검색 필터 한정** — 유저=이름+아이디 / 부서·그룹=명칭만, 유저를 소속으로 매칭 안 함.
- **ST** — 탭 폐기 → 단일 스크롤+앵커 내비, 승인자 직사각형 카드(소속 5단).
- **HM-3 조직 레벨** — 센터 > 담당 > 팀 > 그룹 > 파트(이름 접미사 KO/EN). 말단만 표시 + 정렬. 본인=손든사람+ME.
- **DL** — 소프트삭제 + lazy 정리(7일). 복구는 설정 "삭제 예정" 탭(오너=본인/sysadmin=전체). 안내는 시각 모달.
- **AP** — 설정=서버 `eligible-approvers`(viewer+, 부서/그룹 권한 포함) / 생성 다이얼로그=생성자+선택 user 협업자 + 부서원(부서명 매칭)+그룹 멤버, public이면 전원.
- **생성 가시성** — public 선택 즉시 반영, public/private 변경 시 승인자 초기화(확인 모달), 퍼블릭 우선 노출.
- **생성 협업자 UX** — 드롭다운 선택 즉시 추가(Add 버튼 없음), 역할 토글로 사후 변경.

## 4. 남은 작업 / 보류
- **PV** (가시성 스테이징 저장+미리보기) — 구현됨, **검토 보류**. 전(全) 설정 일괄 스테이징은 후속 과제.
- **AP** (승인자 viewer+ 제한, 소속 자격 포함) — 구현됨, **검토 보류**.
- **AP 메모**: 설정 화면은 서버 `effective_role`/`belongs_to_department`가 상위조직(센터) 하위 전원을 prefix로 포함. 생성 다이얼로그는 맵 부재로 클라 산정 — 4차에서 말단명→org_path 매핑 + prefix로 상위조직 하위 전원 후보화(말단명 유니크 가정). 두 항목 검토 재개 시 §1 표 갱신.
- **로그인 기록 후속**: 현재 raw 기록만 수집(`login_records`). 후속 후보 — 일자별 중복제거 / 집계·리포트 엔드포인트(`/api/admin/login-records`) / 현황 화면(맵 오너십과 조인) / IP·UA 필드. 방식 확정 후 진행.
