# Hotfix UI 6 — 설계

작성 2026-07-10 · 브랜치 `worktree-hotfix-ui-6` (base `main@95fb436`)

메인 작업 중 끼어드는 핫픽스 4건. 프론트 3건 + 부서 임포트(프론트 파서 + 백엔드 `known` 확장).

---

## ① 맵 설정 "Back to editor" 버튼 재디자인

**현상** `frontend/src/app/maps/[mapId]/settings/page.tsx:274-279` — 좌측 레일 최상단이 `← Back to editor` 밑줄 텍스트 링크(`text-fine text-accent hover:underline`). 버튼으로 안 읽힘.

**변경** 홈 헤더 Manual 버튼(`app/page.tsx:357-364`)과 같은 시각 언어의 컴팩트 테두리 버튼으로 교체.

```tsx
<Link href={`/maps/${mapIdStr}`} data-id="settings-back-to-editor"
  className="mb-2 inline-flex items-center gap-1.5 self-start rounded-sm border border-hairline
             bg-surface px-2.5 py-1.5 text-caption-strong text-ink hover:bg-surface-alt">
  <ArrowLeft size={16} strokeWidth={1.5} />
  {t("perm.backToEditor")}
</Link>
```

- `self-start` — flex column 자식이라 기본 stretch. 레일 폭(224px)을 채우면 탭 내비 항목처럼 보이므로 내용 폭으로 고정.
- `←` 문자 → Lucide `ArrowLeft` 16px/1.5 (`rules/frontend/design.md` §5).
- 커서·클릭 눌림은 전역 base가 처리 — 컴포넌트엔 hover 배경만.

**범위 밖** 같은 파일 227행 no-access 화면의 링크는 다른 맥락(중앙 정렬 안내문) — 유지.

---

## ② 피커 드롭다운 — portal + fixed, 아래 우선 / 부족하면 옆

**현상 진단**

`principal-picker.tsx`의 결과 목록은 **이미 floating**(`absolute left-0 right-0 top-full`)이다. 두 가지 별개 문제가 겹쳐 있었다:

1. **위로 밀림** — `useEffect`의 `listRef.current?.scrollIntoView({block:"nearest"})`(line 101-103)가 모달 본문(`overflow-y-auto`)을 스크롤시킨다.
2. **클리핑** — 드롭다운이 그 `overflow-y-auto` 본문의 자식이라 모달 밖으로 못 나간다. 1번은 2번을 가리려고 붙인 반창고다.

`scrollIntoView`만 지우면 결재자 피커(모달 본문 맨 아래)의 드롭다운이 그대로 잘린다.

**변경 (a) — `components/permissions/principal-picker.tsx`**

드롭다운을 `createPortal(…, document.body)` + `position: fixed`로 전환. 클리핑 컨테이너를 벗어나므로 `scrollIntoView` 제거 → 밀림 소멸.

- z-index `z-[1250]` — 생성 모달(1200) 위, `ConfirmDialog`(1300) 아래.
- `open` 동안 `resize` + `scroll`(capture) 리스너로 좌표 재계산.
- 목록 내부 `onMouseDown={e => e.preventDefault()}`는 유지 — portal 밖으로 나가도 blur 방지에 그대로 유효.

배치 알고리즘 (`DROPDOWN_H = 160px` = `max-h-40` = 약 5줄, `GAP = 4`, `MARGIN = 8`):

```
spaceBelow = innerHeight - rect.bottom - GAP - MARGIN
spaceRight = innerWidth  - rect.right  - GAP - MARGIN
spaceLeft  = rect.left - GAP - MARGIN

if   spaceBelow >= 160          → 아래   left=rect.left,            width=rect.width
elif spaceRight >= 200          → 오른쪽 left=rect.right + GAP,     width=min(rect.width, spaceRight)
elif spaceLeft  >= 200          → 왼쪽   left=rect.left - GAP - w,  width=min(rect.width, spaceLeft)
else                            → 아래   maxHeight = spaceBelow (축소)
```

옆으로 열릴 때 `top`은 `clamp(rect.top, MARGIN, innerHeight - MARGIN - height)`.

**위로 flip은 하지 않는다** — 결재자/협업자 목록이 피커 바로 위에 `flex-col-reverse`로 붙어 있어(선택 즉시 반영을 보이려는 의도, `create-map-dialog.tsx:427`) 위로 열면 방금 고른 사람이 가려진다.

**변경 (b) — `components/permissions/create-map-dialog.tsx`** *(2026-07-10 개정)*

처음엔 모달을 중앙 정렬 그대로 두고 `max-h`를 `calc(100dvh-13rem)`까지 낮춰 아래 여백을 만들었다.
그러면 짧은 화면에서 모달이 과하게 낮아져(580px에서 372px) 본문 스크롤만 늘었다. 사용자 피드백으로 뒤집었다:

- 백드롭 `items-center` → **`items-start pt-8`** (상단 정렬)
- 모달 `max-h-[calc(100dvh-13rem)]` → **`max-h-[calc(100dvh-4rem)]`** (세로를 최대한 사용)
- 본문 스크롤 컨테이너에 **`pb-40`(160px)** — 마지막(결재자) 피커를 그만큼 위로 스크롤할 수 있다

본문을 끝까지 내리면 피커 아래 여백 = `pb-40(160)` + 모달 크롬(`pb-6` 24 + 액션행 ≥29 + `gap-5` 20 ≈ 73) + 하단 마진(32) ≈ **265px ≥ 172px**(=160+GAP4+MARGIN8) — **뷰포트 높이와 무관하게** 드롭다운이 아래로 열린다.

대가: 본문이 스크롤되지 않을 만큼 긴 화면(≥1080px)에서는 `pb-40`이 액션행 위 빈 여백으로 남는다(모달 993px). 짧은 화면에서만 스크롤 여유로 소비된다.

정확성(안 잘림)은 여전히 실측 `spaceBelow` 알고리즘이 보장한다 — 이 값들은 "아래로 열림"만 담당한다.

**변경 (c) — 영향 범위**

`PrincipalPicker`는 `collaborators-panel`, `approvers-panel`(설정 화면)에서도 쓰인다. portal 전환은 거기에도 적용되며 클리핑 컨테이너가 없어 기존과 동일하게 아래로 열린다. 회귀 확인 대상.

---

## ③ 마스터-디테일 breakpoint 1280 → 980, 3개 탭 통일

**현상** `xl:`(Tailwind 기본 1280px)은 저장소 전체에서 `app/page.tsx` 2곳뿐. `notices`·`inbox`는 반응형 없이 항상 좌우 2단이라 좁은 화면에서 양쪽 다 찌그러진다.

**변경**

`app/globals.css` `@theme`에 커스텀 breakpoint 추가:

```css
/* 마스터-디테일 분기점 — 이하에선 상세를 카드 아래 아코디언으로 접는다 (맵·공지·인박스 공통) */
--breakpoint-split: 61.25rem; /* 980px */
```

| 파일 | 변경 |
|------|------|
| `app/page.tsx` | `xl:hidden` → `split:hidden`, `xl:flex` → `split:flex` (2곳) |
| `app/notices/page.tsx` | 상세 마크업을 `NoticeDetail` 컴포넌트로 추출 → 카드 아래 아코디언(`split:hidden`) + 우측 패널(`hidden split:flex`) |
| `app/inbox/page.tsx` | 알림 상세를 `NotificationDetail`로 추출(승인은 이미 `ApprovalDetail`) → 두 탭 모두 동일 구조 |

아코디언은 맵 탭 패턴을 그대로 재사용:

```tsx
<div className="grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth split:hidden
                ${selected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}">
  <div className="min-h-0 overflow-hidden">{selected && <Detail … />}</div>
</div>
```

배경 클릭 = 선택 해제, 상세 내부 클릭 `stopPropagation`도 기존 규약 유지.

---

## ④ 부서 tree JSON 임포트

### 소스 포맷 (확정)

```json
{
  "flat": [ … ],                         // 무시
  "tree": [
    {
      "deptCd": "…",                     // 무시
      "deptNm": "경영지원본부",            // → korean_name
      "enDeptNm": "Management Division",  // → 매칭 키
      "dheadUserId": "hong.gildong",      // → manager (login_id)
      "dheadFnm": "홍길동",               // 저장 안 함 (디렉터리가 login_id→이름 해석)
      "children": [ { … 자식 부서 … } ]   // 재귀
    }
  ]
}
```

### 프론트 — `lib/dept-info-import.ts` 전면 교체

- 루트는 `{ "tree": [...] }`. `flat`은 읽지 않는다.
- 노드에서 `enDeptNm`(매칭키)·`deptNm`(korean_name)·`dheadUserId`(manager)만 추출. 나머지 키는 전부 무시.
- `children` 배열을 재귀 순회. 없거나 빈 배열이면 리프. `children`이 배열이 아니면 에러.
- `enDeptNm` 없는 노드는 항목으로 취급하지 않되 자식 순회는 계속 (래퍼 노드 허용).
- `null`/누락 → 빈 문자열. 문자열 아닌 값 → 에러(소스 포맷 드리프트 감지). `deptCd`는 읽지 않으므로 숫자여도 무해.
- `enDeptNm`이 빈 항목, `deptNm`·`dheadUserId`가 둘 다 빈 항목 → 건너뜀 (기존 규칙 유지: 삭제 기능 아님).
- 중복 `enDeptNm` → 마지막 승리 (기존 규칙 유지).
- `DEPT_INFO_EXAMPLE`·모달 상단 주석 갱신, `dept-info-import.test.ts` 재작성.

### 백엔드 — `routers/admin.py` `import_dept_info`

```python
# 현재: known = employees.department distinct → 리프(파트/팀)만 수용
# 변경: org_l1~org_l5 ∪ department 의 distinct 이름 전부
```

DB 스키마 무변경. `dheadFnm`용 컬럼은 만들지 않는다.

`backend/tests/test_dept_info.py`에 상위 레벨(본부/실) 임포트가 `updated`에 잡히고 `unknown`에 안 들어가는 케이스 추가.

### 한글 검색 연결 — 조사 결과

`routers/directory.py:50-72`는 이미 **모든 org 레벨 프리픽스**를 부서 옵션으로 내려주고, `DeptInfo`를 **리프 세그먼트명**으로 조인한다. 지금은 상위 부서에 `dept_info` 행이 없어 `korean_name=""` → 한글 표시·검색이 리프에서만 동작한다.

→ `known` 확장만으로 **전 레벨 한글 검색이 자동으로 켜진다.** 추가 코드 불필요.

부수 효과: `main.py:108-119`의 상위 부서장 체인(`manager_ids`)이 그제서야 채워진다 → 승인자 피커의 "Manager" 배지·우선정렬(`sortManagersFirst`)이 실제로 동작한다.

### 부서장 이름 검색 (승인됨)

`principal-picker`는 부서를 `manager`(login_id) 텍스트로만 매칭한다. "홍길동"으로 그 사람이 부서장인 부서를 찾으려면 클라이언트에서 조인한다 — 백엔드·DB 무변경.

`create-map-dialog.tsx`의 `pickerDepts` 빌드에서 `dirUsers`로 `manager` → `name`·`korean_name`을 해석해 `PrincipalOption.manager` 검색 텍스트에 합친다. (`PrincipalPicker`의 `manager` 필드는 이미 검색 대상 — `principal-picker.tsx:130`.)

### 알려진 한계 (변경 안 함)

- `DeptInfo` PK는 **리프 세그먼트명**이라 서로 다른 조직 경로의 동명 부서는 충돌(마지막 승리)한다. 기존 설계 그대로.
- 어드민 부서 탭(`routers/admin.py:74-88`, `department-table.tsx`)은 리프만 표에 보여준다. 상위 레벨 임포트 결과는 표에 안 나타나지만 피커·부서장 체인에는 반영된다.

---

## 검증

| # | 명령/절차 | 통과 기준 |
|---|-----------|-----------|
| 1 | `npm run lint` · `npx vitest run src/lib/dept-info-import.test.ts` | 초록 |
| 2 | `npm run build` | React Compiler `preserve-manual-memoization` 위반 없음 |
| 3 | `.venv/bin/python -m pytest tests/test_dept_info.py -q` | 초록 (상위 레벨 케이스 포함) |
| 4 | Playwright 1280×580 — 생성 모달 결재자 피커 개방 | 드롭다운 미클리핑, 본문 스크롤 이동 0px |
| 5 | Playwright 940px / 1100px — 홈·공지·인박스 3탭 | 940=아코디언, 1100=2단 |

브라우저 검증 전 `docs/lessons/browser-verification.md` 참조 (좀비 next dev 전수 pkill, dev.db 오염).
