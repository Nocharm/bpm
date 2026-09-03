# Frontend Component Catalog

`frontend/COMPONENTS.md`는 `src/components/**`의 **살아있는 목록**(파일 · 내보내는 컴포넌트 · 역할 · 사용처)이다. 타일·팝오버·피커처럼 여러 표면이 공유하는 조각을 일괄 수정할 때 "어디서 쓰이는지"를 빠짐없이 잡기 위한 장치다 (사용자 지시 2026-09-03).

## 규칙

- **일괄 수정 전 반드시 확인** — 공용 컴포넌트(예: `SpFieldTile`, `FallbackHint`, `SearchSelect`, `PopoverActionBar`)를 고치기 전에 `frontend/COMPONENTS.md`의 사용처 열을 읽고, 영향받는 표면 전부를 작업 범위·검증(스모크/스크린샷)에 넣는다. 한 표면만 보고 고치면 다른 표면이 조용히 깨진다.
- **컴포넌트 추가·이동·삭제·사용처 변경 시 같은 커밋에서 재생성** — `frontend/`에서 `node scripts/build-component-catalog.mjs`. 손으로 편집하지 않는다(생성 파일). `--check`는 최신 여부 검사만(훅·CI용).
- **모든 컴포넌트 파일은 머리 주석 한 줄**(역할 + 어디서 공유되는지)을 가진다 — 카탈로그의 "역할" 열은 이 첫 문장에서 뽑는다(`rules/common/comments.md`의 module docstring 규칙과 동일). 역할 열이 비어 있으면 주석을 채운다.
- **공유 조각의 표면별 차이는 props로** — 표면마다 조건 분기를 컴포넌트 안에 늘리지 말고 `readOnly`·`wide`·`iconSlot`·`restIcon` 같은 명시적 prop으로 드러낸다. 카탈로그 사용처가 3곳 이상인 컴포넌트를 바꾸면 그 3곳을 모두 스모크로 밟는다.

## 사용 예

```bash
# bash — 카탈로그 재생성 / 최신 검사
cd frontend && node scripts/build-component-catalog.mjs
cd frontend && node scripts/build-component-catalog.mjs --check
```

```powershell
# PowerShell
cd frontend; node scripts/build-component-catalog.mjs
cd frontend; node scripts/build-component-catalog.mjs --check
```
