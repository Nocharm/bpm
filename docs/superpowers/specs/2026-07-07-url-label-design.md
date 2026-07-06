# URL 라벨 + 필 입력 + 서브프로세스 지정 URL — 설계

2026-07-07 · 브랜치 `feat/url-viewer`(URL 뷰어 위에 계속) · **풀스택**(DB 컬럼 3개 + API + 프론트, 사용자 확정)

## 1. 목표

노드 참조 URL에 **표시용 라벨**을 붙인다. 라벨이 있으면 액션 바 "링크 열기" 버튼 텍스트가 라벨로 대체된다(호버 시 열기 아이콘). URL 입력은 인스펙터·노드 편집 모달 양쪽에서 **담당자 칩과 같은 필 형식**(말줄임)으로. subprocess는 노드 데이터가 아니라 **지정(designation) 단계의 대표 어트리뷰트**로 URL·라벨을 설정하며 호스트 맵에서 수정 불가.

## 2. 확정 결정 (브레인스토밍 Q&A)

| 항목 | 결정 |
|---|---|
| 진행 방식 | `feat/url-viewer` 브랜치에서 풀스택(백엔드+DB 포함) |
| 지정 어트리뷰트 | URL + 라벨 **둘 다** (`sp_url`, `sp_url_label`) |
| 편집 UI 레이아웃 | **2행 분리** — URL 행(필+X, X=URL·라벨 동시 삭제) / 라벨 행(URL 있을 때만 노출, 필+X, X=라벨만 삭제) |
| 삭제 규칙 | 라벨만 삭제 가능. URL 삭제 시 라벨 동반 삭제(서버 경계에서도 강제) |
| CSV | `url_label` 컬럼 미추가 — 임포트 그래프는 라벨 없음(UI에서 후속 입력) |

## 3. 데이터 모델 / 백엔드

- `nodes.url_label` VARCHAR(100) DEFAULT `''` — `models.py`의 `url`(String 500) 옆, `db.py` `_ADDED_COLUMNS` 자동보강 등록.
- `process_maps.sp_url` VARCHAR(500) nullable, `process_maps.sp_url_label` VARCHAR(100) nullable — 기존 `sp_system`/`sp_duration` 컨벤션.
- `NodeIn.url_label: str = Field(default="", max_length=100)` — url 필드와 동일하게 **길이만 제한**(스킴 검증은 클라이언트, 자동저장 자유 타이핑 보호). `NodeOut`은 상속.
- **캐스케이드 validator**: `NodeIn`에 `model_validator` — `url.strip()`이 비면 `url_label`을 `""`로 강제. `SubprocessDesignationIn`도 동일(`url`이 비면 `url_label` 소거).
- `SubprocessDesignationIn.url: str = Field(default="", max_length=500)`, `url_label: str = Field(default="", max_length=100)` — 선택 필드. `designate_subprocess`(PUT)에서 `sp_url`/`sp_url_label` 저장. DELETE(지정 해제)는 기존 컨벤션대로 어트리뷰트 보존.
- `SubprocessRefOut`에 `url`/`url_label` 추가, `subprocess.py get_subprocess_refs` select에 두 컬럼 포함.
- 그래프 저장/로드: `url_label` 왕복 (NodeIn→DB→NodeOut).

## 4. 공용 편집 컴포넌트 — `UrlLabelField` (`frontend/src/components/url-label-field.tsx`, 신규)

Props: `{ url: string; urlLabel: string; readOnly: boolean; onChange: (patch: { url?: string; urlLabel?: string }) => void }`. 담당자 칩과 동일 토큰(`rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-fine` + `X size={11}`), 필 내용은 `truncate`(말줄임).

- **URL 행**: 값 없음 → 인라인 입력창(blur/Enter 커밋, 기존 인스펙터 자유 타이핑 규칙). 값 있음 → 필(URL 말줄임, `title`로 전체 노출) + X. **X 클릭 = `onChange({ url: "", urlLabel: "" })`**. 수정은 삭제 후 재입력(칩 관용).
- **라벨 행**: `url`이 비어있지 않을 때만 렌더. 값 없음 → 입력창(placeholder "Label", maxLength 100). 값 있음 → 필 + X. **X 클릭 = `onChange({ urlLabel: "" })`**.
- readOnly: X·입력 비활성(필 표시만).
- `data-id`: `url-field-input` / `url-field-pill` / `url-field-remove`, `url-label-input` / `url-label-pill` / `url-label-remove`.

**사용처**
1. 인스펙터 속성 탭 — 기존 field 루프의 `["url","field.url"]` 평문 input 행 제거, 루프는 `["system","duration"]`만 남기고 그 아래 `UrlLabelField` 배치. 현행 게이트(`hasBpmAttributes` — process/decision만) 유지. `onChange`는 기존 `updateSelectedData(patch, true)` 재사용(자동저장 경로 동일).
2. 노드 편집 모달(`NodeSummaryModal`) — `showAttributes`(process/decision) 블록에 동일 컴포넌트 추가. 모달 편집 버퍼(`form`)에 `url`/`urlLabel` 키 추가, `handleSave`의 `onPatch`에 포함. subprocess/start/end는 기존 게이트에 의해 자연 미노출.

## 5. 액션 바 (`node-action-bar.tsx` 수정)

- URL 소스: `nodeType === "subprocess"` → 주입된 `data.spUrl`/`data.spUrlLabel`, 그 외 → `data.url`/`data.urlLabel`. 노출 게이트는 기존 `isSafePreviewUrl` 동일.
- **라벨 있음**: 버튼 내용 = 라벨 텍스트만(`truncate`, 아이콘 칩 없음). **hover 시 우측에 열기 아이콘(`ExternalLink` 12px) 페이드-인**(`opacity-0 group-hover:opacity-100`, 레이아웃 밀림 방지 고정폭). `aria-label` = 라벨.
- **라벨 없음**: 기존 그대로(체인 아이콘 칩 + `node.action.openLink`).
- store selector/`eq`에 `urlLabel`(및 subprocess 소스 결정 결과) 필드 추가 — stale 방지.

## 6. subprocess 지정 플로우

- **지정 모달**(`subprocess-designation-panel.tsx`): URL 입력(maxLength 500) + 링크 라벨 입력(maxLength 100) 추가. URL이 비어있지 않은데 `isHttpUrl` 불통과면 저장 버튼 비활성 + 인라인 에러(클라이언트 검증 — CSV와 동일한 http(s) 규칙). 라벨 행은 URL 입력값 있을 때만 활성.
- **주입**: `page.tsx injectSubEnds`의 `spAttrs`에 `spUrl: ref.url`/`spUrlLabel: ref.url_label`(미지정 시 null) 추가. `NodeData`에 `spUrl?/spUrlLabel?: string | null`, `api.ts SubprocessRef`에 `url/url_label`.
- **호스트 맵 수정 불가**: 기존 구조 그대로 — subprocess는 `hasBpmAttributes` 게이트로 편집 UI가 안 뜨고, 인스펙터의 subprocess 읽기전용 어트리뷰트 블록에 **URL 행 추가**(라벨 있으면 라벨, 없으면 URL 말줄임, 둘 다 없으면 "—"). 안내 문구는 기존 `subprocess.attrsFromOwner` 재사용.

## 7. i18n (en/ko)

```
field.urlLabel            "Link label"        / "링크 라벨"
urlField.addUrl           "Add URL"           / "URL 추가"      (입력 placeholder)
urlField.addLabel         "Add label"         / "라벨 추가"     (입력 placeholder)
urlField.removeUrl        "Remove URL"        / "URL 삭제"      (X aria-label)
urlField.removeLabel      "Remove label"      / "라벨 삭제"     (X aria-label)
subprocess.urlInvalid     "URL must start with http:// or https://" / "URL은 http:// 또는 https://로 시작해야 합니다"
```
(액션 바는 라벨 자체가 텍스트라 신규 키 불필요 — 라벨 없을 땐 기존 `node.action.openLink`.)

## 8. 비변경 / 스코프 외

- CSV 임포트/템플릿/AI 프롬프트: `url_label` 미도입(결정). 임포트로 만든 노드는 라벨 없음.
- 미리보기 패널 UI 무변경(주소줄은 URL 원문 유지).
- 캔버스 노드 본문에 URL/라벨 미표시 — 액션 바가 유일 진입점.
- displayFields(노드 표시 필드 체크박스)에 url 미추가.

## 9. 검증

- backend pytest: `url_label` 그래프 왕복, NodeIn 캐스케이드(url 비우면 라벨 소거), 지정 PUT에 url/url_label 저장·`SubprocessRefOut` 동봉, url 없이 url_label만 오면 소거되는 지정 케이스.
- frontend: lint/vitest/build 클린. 스모크 확장 — 라벨 입력 → 액션 바 버튼 텍스트가 라벨로 대체 assert(`data-id="node-action-link"` textContent), 라벨 X → "Open link" 복귀, URL X → 라벨 행 소멸.
- 지정 플로우는 브라우저 스팟체크(지정 모달 URL/라벨 저장 → 호스트 맵 subprocess 액션 바에 라벨 버튼).
