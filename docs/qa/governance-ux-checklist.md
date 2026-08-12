# 거버넌스 UX 확장 검증 체크리스트 (feat/governance-ux)

> 설계: [`docs/design/2026-08-08-governance-ux-design.md`](../design/2026-08-08-governance-ux-design.md) · 4페이즈(P0 라이프사이클 대칭화 → C 승인 탭 통합 → B 카드 멤버 편집 → A 게시 동봉).
> 자동 게이트는 전부 그린(BE pytest 1023·ruff 0 / FE vitest 599·lint 0 error·tsc 0·build OK) — 이 문서는 **사용자 실사용 검증**용. 항목당 1~2분.

## 준비

- 검증 서버(9910 dev 또는 로컬 네이티브)에서 유저 3역할 준비: **오너 O**(맵 소유), **에디터 E**(editor 그랜트), **승인자 V**(맵 지정 승인자, 비오너). sysadmin(admin.sys)은 오너+승인자 겸용으로 대체 가능하나, 6·10번은 역할 분리가 있어야 의미 있음.
- 비공개(private) 맵 1개(승인자 지정 완료) + 승인자 없는 맵 1개.
- 유저 전환: 우상단 Dev 스위처(로컬) 또는 계정 전환.

```powershell
# 로컬 네이티브(권한 검증 ON) — backend\ 에서
$env:DEV_ENFORCE_PERMISSIONS="true"; $env:BPM_SYSADMINS="admin.sys"; .venv\Scripts\uvicorn app.main:app --port 8000
# frontend\ 에서
npm run dev
```

```bash
# bash 동일 (backend/ 에서)
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/uvicorn app.main:app --port 8000
```

## P0 — 승인 요청 라이프사이클

- [ ] **P0-1 가시성 요청 + 새로고침 복원**: O로 설정→Visibility에서 Public 선택→Apply → "Approval pending" 마커. **새로고침** → 마커·Withdraw 버튼 유지(신규 기능).
- [ ] **P0-2 철회 후 재요청**: 마커 옆 **Withdraw request** → 마커 사라짐 → 다시 Apply 가능(409 없음).
- [ ] **P0-3 중복 요청 409**: pending 상태에서 다른 탭/유저(O)로 같은 맵 Apply → "already pending" 토스트, 행이 쌓이지 않음.
- [ ] **P0-4 승인자 0명 409**: 승인자 없는 맵에서 Apply → "map has no approvers — assign approvers first" 토스트, pending 미생성.
- [ ] **P0-5 강등 중복 가드**: E가 협업자 패널에서 다른 editor를 viewer로 강등(승인 대기 배지) → 같은 행 재시도 → "already pending" 토스트.
- [ ] **P0-6 직접 적용 supersede**: 위 pending 상태에서 O가 같은 행을 직접 강등 → 즉시 적용 + E에게 supersede 알림(벨) + 결재 대기 목록에서 해당 요청 사라짐.
- [ ] **P0-7 소프트삭제 스윕**: pending(가시성 or 강등) 있는 맵을 휴지통으로 → V 인박스·설정 결재 대기·관리자 콘솔 큐에서 해당 항목 소멸.

## C — 승인 탭 통합 + 배지

- [ ] **C-1 4종 통합 목록**: 한 맵에 ①rename 요청(E가 이름 변경 요청) ②SP 등록 요청 ③강등 요청 ④가시성 요청을 만들고 설정→결재 대기 탭에서 4종이 모두 보이는지.
- [ ] **C-2 행별 결정권(오너)**: **비승인자 오너 O**로 접속 → 결재 대기 탭이 보이고(신규), rename·SP 행에만 Approve/Reject 버튼, 강등·가시성 행은 "Approvers decide" 읽기전용.
- [ ] **C-3 행별 결정권(승인자)**: V로 접속 → 강등·가시성 행에 버튼, rename·SP 행은 "Owner decides".
- [ ] **C-4 레일 카운트 배지**: 좌측 레일 "결재 대기" 라벨에 pending 수 배지 → 하나 결정하면 즉시 감소.
- [ ] **C-5 top-nav 인박스 배지**: 내 결정 대기 항목이 있으면 상단 Inbox 탭에 숫자 배지, 처리 후 15초 내 갱신/소멸.

## B — 맵 카드 멤버 편집

- [ ] **B-1 카드에서 추가**: 홈 맵 상세 카드(또는 에디터 Map 탭)의 멤버 목록 하단 추가 UI(피커+역할)로 유저/부서/그룹 추가 → 즉시 목록 반영. 퍼블릭 맵이면 역할이 editor 고정.
- [ ] **B-2 카드에서 제거(즉시/승인)**: 행 호버 시 X 버튼 — viewer 제거는 즉시, **비오너 E가 editor 제거 시** 행 유지 + 역할 배지에 승인 대기 표시 + 결재 대기 탭에 항목 생성.
- [ ] **B-3 보호 행**: owner 행·오우닝 부서(잠금) 행에는 X 버튼이 없고, 유저 행 X 클릭이 행 펼침을 유발하지 않는지.
- [ ] **B-4 viewer에겐 편집 UI 없음**: viewer(또는 무권한 공개맵 열람자)로 카드 열람 → 추가 UI·X 버튼 미노출.

## A — 게시 전이에 가시성 동봉

- [ ] **A-1 에디터 모달 동봉**: E(또는 O)가 체크아웃→편집→승인요청 → 모달에 "Also request visibility change to Public" 체크박스(현재 가시성의 반대 표시) → 체크 후 제출. 결재 대기 탭에 가시성 행이 **"Decided with version approval"** 읽기전용으로 표시되고, V 인박스에는 버전 항목만 뜸.
- [ ] **A-2 게시 시 적용**: V(전원) 승인 → 제출자 게시 → 맵이 Public으로 전환(설정 Visibility 확인), private 시절 viewer 그랜트 자동 제거, 요청자에게 적용 알림.
- [ ] **A-3 반려 연쇄**: 동봉 제출 → V 반려(사유) → 가시성 요청도 반려(맵 가시성 불변, 결재 대기에서 소멸), 요청자 알림.
- [ ] **A-4 회수 연쇄**: 동봉 제출 → 제출자 회수(withdraw) → 가시성 요청도 철회(맵 불변).
- [ ] **A-5 직접 결정 차단**: 동봉 pending 상태에서 V가 결재 대기 행을 직접 승인 시도할 UI가 없고(읽기전용), API 직접 호출 시 409.
- [ ] **A-6 셀프 게시 동봉**: 승인자=본인 1인 맵에서 승인요청 클릭 → 팝오버에 동봉 체크박스 → Yes → 제출·승인·게시 한 번에 + 가시성 적용. **직후 같은 세션에서 재시도 시 체크박스 대상이 갱신된 가시성 기준인지 확인**(stale 픽스 검증).
- [ ] **A-7 설정 패널 동봉**: 설정→Versions의 Request approval → 확인 모달+체크박스 동작(에디터 모달과 동일).
- [ ] **A-8 스테이징 충돌 supersede**: O가 Visibility 스테이징으로 standalone 요청을 걸어둔 상태에서 동봉 제출 → standalone은 superseded + O에게 알림, 동봉 행만 pending.
- [ ] **A-9 (엣지) 로드 직후 모달**: 페이지 로드 직후 곧바로 승인요청 모달을 열어 체크박스 라벨의 대상 가시성이 올바른지(퍼블릭 맵에서 "to Private"으로 나와야 함).

## 회귀 스팟 (기존 기능 무손상 확인)

- [ ] **R-1**: 동봉 없이 일반 승인요청→승인→게시가 종전과 동일하게 동작.
- [ ] **R-2**: 협업자 패널(설정)의 추가/강등/제거·승인 대기 배지가 종전과 동일.
- [ ] **R-3**: rename 요청/철회·SP 등록 요청 플로우 종전과 동일(전용 철회 경로 유지).
- [ ] **R-4**: 관리자 콘솔 Approval Queue(sysadmin)가 정상 표시(소프트삭제 맵 제외).

## 이슈 기록

| 번호 | 항목 | 증상 | 비고 |
|------|------|------|------|
|      |      |      |      |
