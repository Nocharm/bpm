# 매뉴얼 버튼 일관화 + `/manual` 외부 매뉴얼 드롭다운 — 설계

- 날짜: 2026-07-16
- 브랜치: `worktree-manual-buttons`
- 관련 선행 커밋: `4b0c7a7` (docker-compose에 `CSV_MANUAL_URL` 전달 — CSV 매뉴얼 버튼 배포 파이프라인 개통)

## 배경 / 문제

앱에는 매뉴얼 진입 버튼이 4종(렌더 5곳)으로 흩어져 있고, 세 개의 서로 다른 목적지가 **모두 동일한 `BookOpen` 아이콘**을 쓴다.

| 목적지 | 출처 | 성격 |
|--------|------|------|
| **D1** 앱내 사용 매뉴얼 뷰어 | `/manual` (DB 문서) | 내부 라우팅 |
| **D2** 외부 편집 매뉴얼 사이트 | `.env MANUAL_URL` | 외부 새 탭 |
| **D3** 외부 CSV 임포트 안내 | `.env CSV_MANUAL_URL` | 외부 새 탭 |

현재 진입 버튼 인벤토리:

| # | 위치 | 코드 | 표기 | → 목적지 |
|---|------|------|------|---------|
| 1 | 상단 네비 우측 | `top-nav.tsx:136–151` | 아이콘14 + `<Tooltip>` | D1 (내부) |
| 2 | 홈 헤더 | `page.tsx:386–393` | 아이콘16 + 라벨 | D1 (내부) |
| 3 | 에디터 툴바 우측 | `editor-toolbar.tsx:161–172` | 아이콘16 + 네이티브 `title` | D2 (외부) |
| 4 | CSV 액션(에디터 임포트 모달·홈 CSV 생성 모달) | `csv-template-actions.tsx:57–68` | 아이콘14 + 라벨 | D3 (외부) |

관찰된 문제:
1. **에디터 화면에 D1·D2 BookOpen이 우상단에 공존** — 상단 네비(내부 뷰어)와 툴바(외부 사이트)가 동일 아이콘이라 어느 매뉴얼인지 시각적으로 구분 불가.
2. **툴팁 메커니즘 불일치** — 같은 "밀도 높은 툴바 + 아이콘만" 티어인데 상단 네비(#1)는 스타일드 `<Tooltip>` 컴포넌트, 에디터 툴바(#3)는 네이티브 브라우저 `title`.
3. **내부/외부 미구분** — D2·D3는 외부 새 탭인데 D1과 동일한 아이콘·모양이라 새 탭 여부를 알 수 없다.

## 목표 / 범위

**구조 모델(확정): 컨텍스트별 분산 유지 + 밀도별 하이브리드 표기.** 라우팅은 현행(컨텍스트별 목적지) 유지. 버튼 이동·삭제 없음.

두 파트로 나눈다.

- **Part 1 — 기존 5개 사이트 일관성 정리** (툴팁 메커니즘 통일 + 외부 큐)
- **Part 2 — `/manual` 뷰어에 "한눈에 보기" 외부 매뉴얼 드롭다운 신규 추가**

### 명시적 비범위 (의도적 무변경)
- 아이콘 크기 14/16px — 각 행 형제 아이콘에 맞춘 로컬 규칙이라 유지(16px 강제 시 행 내 불일치, design.md §6 "생산성 화면 컴팩트"와 합치).
- 내부 D1 버튼(top-nav #1·home #2)의 위치·모양 — 무변경.
- 버튼 개수·물리적 위치 — 무변경("2,3 모두 괜찮음").
- 라벨 텍스트 정책 — 목적지별로 다른 게 분산 모델상 정상(내부 D1은 이미 `manual.title`로 통일됨).

## Part 1 — 기존 사이트 일관성 정리

### 1a. 에디터 툴바(D2) 툴팁 메커니즘 통일
`editor-toolbar.tsx`의 D2 버튼을 상단 네비와 동일하게 `<Tooltip>` 컴포넌트로 감싼다. 네이티브 `title` 제거, `aria-label`은 접근성 위해 유지.

- Before: `<button className={iconBtn} title={t("editor.manualSite")} aria-label=... >{<BookOpen 16/>}</button>`
- After: `<Tooltip label={t("editor.manualSite")}><button className=... aria-label=... >{<BookOpen 16/> <ExternalLink 12/>}</button></Tooltip>`

### 1b. 외부 사이트 버튼(D2·D3)에 external 큐 추가
외부 새 탭(`window.open(..., "_blank")`)으로 나가는 버튼에 `ExternalLink`(lucide) 12px 큐를 덧붙여 "새 탭" 신호를 준다. 특히 에디터 화면의 D1(내부)/D2(외부) 공존 혼동을 해소한다.

- **D2 (에디터 툴바, 아이콘만):** `BookOpen 16` 다음에 `ExternalLink 12` (버튼에 `gap-0.5` 부여, `text-ink-tertiary`). 툴바에 2-글리프 버튼(AddNodeMenu 등)이 이미 있어 이질적이지 않음.
- **D3 (CSV 액션, 라벨 있음):** `CSV_OUTLINE_BTN`(이미 `gap-1.5`) 안에서 `BookOpen 14` + 라벨 뒤에 후행 `ExternalLink 12` (`text-ink-tertiary`).

내부 D1(top-nav·home)에는 큐를 붙이지 않는다(내부 라우팅이라 새 탭 아님).

## Part 2 — `/manual` 뷰어 "한눈에 보기" 드롭다운

앱내 매뉴얼을 읽는 사용자가 외부 두 매뉴얼(D2 편집사이트·D3 CSV안내)로 바로 점프할 수 있도록, `/manual` 헤더에 통합 드롭다운을 신규 추가한다.

```
/manual 헤더:
[문서제목 ▼]   ···(본문검색)···      [⊞ 한눈에 보기 ▼]  [↔읽기폭] [◐읽기테마]
                                          │
                                          └ 드롭다운(우측 정렬):
                                            📖 편집 매뉴얼 사이트   ↗
                                            📖 CSV 임포트 매뉴얼    ↗
```

### 데이터
- `manual/page.tsx`에 `getMe` import + 상태 `manualUrl`·`csvManualUrl` 추가.
- 마운트 시 `getMe()` 호출 → `setManualUrl(me.manual_url)`·`setCsvManualUrl(me.csv_manual_url)`. 실패는 catch로 삼켜 버튼만 숨기고 페이지는 유지(csv-create-modal 패턴과 동일).

### 트리거 버튼
- 위치: 헤더 우측, **읽기 도구 클러스터 왼쪽**(현재 `<div className="flex-1" />` 스페이서와 읽기도구 `<div>` 사이). 바깥 헤더 flex의 `gap-4` 유지.
- 모양: 기존 **문서제목 드롭다운과 동일한 패턴**(테두리 버튼 `rounded-sm border border-hairline px-2.5 py-1 ... hover:bg-surface-alt`) 재사용. `LayoutGrid` 16px + 라벨 + `ChevronDown` 14px.
- 라벨/aria: 신규 i18n 키 `manual.externalMenu` (EN "At a glance" / KO "한눈에 보기").
- 상태: `const [extOpen, setExtOpen] = useState(false)`.
- **가시성:** `manualUrl`·`csvManualUrl` 둘 다 비어 있으면 트리거 자체를 렌더하지 않는다.

### 드롭다운 메뉴
- 문서 목록 드롭다운과 동일 구조: 백드롭 `<div className="fixed inset-0 z-[1000]" onClick={닫기} />` + 메뉴 `<div className="absolute right-0 z-[1001] mt-1 w-56 rounded-md border border-hairline bg-surface py-1 shadow-lg">`. (우측 배치이므로 `right-0`.)
- 항목: 설정된 URL만 렌더.
  - **D2 항목** (`manualUrl` 있을 때): `BookOpen 14` + `<span flex-1 truncate>{t("manual.editSite")}</span>` + `ExternalLink 12 text-ink-tertiary`. `onClick` = `window.open(manualUrl, "_blank", "noopener,noreferrer")` + `setExtOpen(false)`.
  - **D3 항목** (`csvManualUrl` 있을 때): 동일 구조, 라벨 `t("csvImport.manualLink")`(기존 키 재사용), `window.open(csvManualUrl, ...)`.
- 행 스타일: `flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt`.

## i18n 신규 키 (`i18n-messages.ts`, EN·KO 양쪽)
- `manual.externalMenu` — EN `"At a glance"` / KO `"한눈에 보기"` (트리거 라벨·aria).
- `manual.editSite` — EN `"Manual editor site"` / KO `"편집 매뉴얼 사이트"` (D2 메뉴 항목 — 기존 `editor.manualSite`의 "Open/열기"를 뺀 메뉴용 라벨).
- D3 메뉴 항목은 기존 `csvImport.manualLink`("CSV import manual" / "CSV 임포트 매뉴얼") 재사용.

## 손대는 파일
- `frontend/src/components/editor-toolbar.tsx` — 1a(툴팁)·1b(외부 큐).
- `frontend/src/components/csv-template-actions.tsx` — 1b(외부 큐).
- `frontend/src/app/manual/page.tsx` — Part 2(getMe·드롭다운).
- `frontend/src/lib/i18n-messages.ts` — 신규 키 2종.
- 백엔드 무변경(`/me`가 이미 `manual_url`·`csv_manual_url` 반환).

## 검증
- 게이트: `npm run lint` · `tsc --noEmit` · `npm run build` 그린.
- 브라우저 실검증(Playwright + 시스템 Chrome):
  - dev/me에 `MANUAL_URL`·`CSV_MANUAL_URL` 세팅 상태에서 `/manual` 진입 → "한눈에 보기" 트리거 노출, 클릭 시 드롭다운에 두 항목, 각 항목이 외부 URL 새 탭 오픈(`target=_blank`).
  - 둘 다 미설정 → 트리거 미노출.
  - 에디터 툴바 D2: 호버 시 스타일드 `<Tooltip>` 표시 + `ExternalLink` 큐 보임.
  - CSV 모달 D3: 라벨 뒤 `ExternalLink` 큐 보임.
  - 콘솔 에러 0.
- 순수 JSX 표시 로직이라 vitest 단위 테스트는 추가하지 않음(기존 페이지 컴포넌트 테스트 인프라 부재) — 브라우저 실검증 + 빌드 게이트로 대체.

## 리스크 / 주의
- `getMe()`가 `/manual`에서 인증 컨텍스트 없이 401 날 수 있음 → catch로 방어(버튼만 숨김).
- React Compiler 수동 메모이제이션 함정(AGENTS.md) — 새 핸들러는 setState만 하면 plain 함수로 두어 컴파일러 추론에 맡긴다.
- `ExternalLink`(node-action-bar·link-preview-panel)·`LayoutGrid`(inspector-panel)는 현 lucide 버전(`^1.17.0`)에서 이미 사용 중 — 존재 확정.
