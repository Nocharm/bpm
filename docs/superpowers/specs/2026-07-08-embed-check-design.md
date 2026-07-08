# 임베드 체크 — 차단 사이트 폴백 카드 즉시 표시 설계

2026-07-08 · 브랜치 `feat/embed-check` · 배경: 대부분의 공개 사이트가 `X-Frame-Options`/`CSP frame-ancestors`로 iframe 임베드를 거부하는데, Chrome은 차단된 로드에도 onLoad를 발화해 미리보기 패널의 6s 폴백 카드가 뜨지 않고 크롬 자체 오류 화면("연결을 거부했습니다")이 보인다 — 버그처럼 보임. 사용자 승인(2026-07-08): 서버가 대상 헤더를 읽어 판정, 차단이면 우리 폴백 카드를 즉시 표시.

## 백엔드

- `GET /api/embed-check?url=<http(s)>` (신규 `routers/embed.py`, 인증 사용자 전용) → `{"embeddable": true|false|null}`.
  - `null` = 판정 불가(대상 도달 실패/타임아웃) — 프론트는 기존 동작 유지.
  - http(s) 외 스킴/500자 초과는 422.
- 판정 로직 `app/embed_probe.py`:
  - `parse_embeddable(xfo, csp)` 순수 함수 — XFO는 값과 무관하게 차단(DENY/SAMEORIGIN 모두 타 오리진 거부), `frame-ancestors`는 `*` 포함일 때만 허용(앱 오리진이 배포마다 달라 목록 매칭은 안 함 — 보수적 판정).
  - `probe_embeddable(url)` — `httpx2` GET, `follow_redirects=True`(최종 응답 헤더 기준), 타임아웃 4s(패널 6s 폴백보다 짧게), 실패는 `None`.
- **SSRF 노트**: 인증 사용자 전용 + http(s)만 + 응답은 불리언만(본문·헤더 미노출). 사내 시스템 URL 판정이 목적이라 사설 대역 차단은 하지 않음(내부 도구 전제, 문서화로 수용).
- 테스트: parse 3케이스(XFO/frame-ancestors/허용) + 엔드포인트 3케이스(차단 verdict·도달 실패 null·스킴 422), 아웃바운드는 monkeypatch.

## 프론트

- `api.ts` `checkEmbeddable(url): Promise<EmbedCheck>`.
- `LinkPreviewPanel`: 패널 오픈/새로고침 시 iframe 로드와 **병행**으로 체크 호출(비동기 → effect 내 동기 setState 없음).
  - `embeddable === false` → 기존 `failed` 폴백 카드 경로로 즉시 전환(iframe unmount) — "이 사이트는 미리보기(임베드)를 지원하지 않습니다" + 새 탭 버튼.
  - `true`/`null`/호출 실패 → 기존 동작(onLoad + 6s 타임아웃) 그대로 — 체크가 죽어도 기능 저하 없음.
  - reloadKey 변경 시 재판정(수동 새로고침 재시도 존중).

## 비변경

- 6s 타임아웃 안전망·새 탭 버튼·isSafePreviewUrl 게이트 유지. UI 문구/디자인 변경 없음(기존 폴백 카드 재사용).
