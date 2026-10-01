# 하위프로세스 출구 다중 연결 + 들어오는 문 네 방향 (설계 + 구현 플랜)

작성 2026-10-01. 선행: `2026-09-30-edge-fanout-design.md`(팬아웃, `feat/edge-fanout`). 조사 근거는 각 항목의 `파일:줄`.

## 0. 확정된 결정 (사용자, 2026-10-01)

| # | 결정 | 선택 |
|---|------|------|
| 1 | 들어오는 문(`in`) | **네 방향**(1단계). 나가는 끝 핸들은 우측 유지 |
| 2 | 다중 출구 | 끝(end)마다 별도 출구 엣지, 각 끝이 자기 다음 노드로 |
| 3 | 라벨 기본값 | 끝이 **2개 이상일 때만**, 모든 출구 엣지(대표 끝 포함)에 끝 노드 제목. 끝이 하나면 라벨 없음 |
| 4 | 끝당 출력 규칙 | 끝 단위 "출력 1개" 규칙(삽입/교체 모달을 그 끝의 엣지에만). 끝이 하나인 SP는 기존 노드 단위 규칙 그대로 |
| 5 | 펼침 게이트웨이 | 자식 End는 **자기 끝에 연결된 노드로만**. 연결이 없는 끝은 잇지 않음 |
| 6 | 역방향 몸체 드롭 | SP 몸체에 놓으면 **출구 목록**을 띄워 연결(현행 제외 해제) |
| 7 | 출구 선택 UI | 분기 노드 선택 모달처럼 **목록**. 대표 끝을 맨 위에 두고 표시 |
| 8 | 라벨 기본값 방식 | 복사가 아니라 **미러링**(끝 제목을 실시간으로 따라감, 저장 안 함). 미러링 라벨은 **디자인을 달리해** 직접 쓴 라벨과 구분 |
| 9 | 펼침 게이트웨이 점선 | 진입(호스트→Start)·진출(End→후속) 게이트웨이도 다른 엣지처럼 **점선이 흐르는 애니메이션**으로 통일 |
| 10 | 스왑 출력 재배정 | 양쪽에 출력이 있고 한쪽이라도 2개 이상이면 **"출력 자리 바꾸기" 두 열 짝짓기 모달**(단일↔다출력도 같은 모달로 통일, 기존 출력선 선택 모달 대체). 짝 없이 확인도 허용. **확인을 눌러야 실행, 취소면 스왑 자체 취소** |

## 1. 목표 · 비목표

- 목표: 끝이 여러 개인 하위프로세스에서 끝마다 다른 다음 노드로 이어지는 흐름을 그릴 수 있게 한다. 끝이 모호한 생성 경로에서는 출구 목록으로 끝을 고른다. 출구 엣지 라벨은 끝 제목을 기본값으로 갖는다. 들어오는 문은 네 방향으로 연다.
- 비목표: 나가는 끝 핸들을 우측 이외 변으로 옮기는 것(2단계, 별도). 끝 키 체계 변경(키 = 끝 제목, 개명 시 고아 엣지 문제는 기존 그대로, §6). 백엔드 스키마 변경.

## 2. 현행 사실 (조사 요약)

- SP 노드 핸들: `in`(좌, target 1개) + 끝별 source 핸들(우, id = 대표 끝 `__primary__` 또는 끝 제목, `(i+1)/(n+1)` 세로 분산). `process-node.tsx:1047-1092`, 키 파생 `subprocess-embed.ts:23-38`.
- 끝 정보는 렌더 시에만 노드 data에 주입(`injectSubEnds`, `page.tsx:1666`). `nodes` state에는 없다. 링크 맵 그래프는 `resolvedCache`(linkKey당 불변)에서 온다.
- 출구 엣지 생성 경로 9가지(`page.tsx`):
  - 끝을 아는 경로: 끝 핸들 → 상대 핸들 드래그(`onConnect :3738` → `createEdge :3706`, keepSource), 끝 핸들 → 노드 몸체 드롭(`handleConnectEnd :3788`, `sourceHandle=fromHandle.id`).
  - 끝을 모르는 경로: 드롭존 뒤 삽입(`applyFlowEdges :4314` → `insertNodeAfter`), 뒤 삽입 충돌 1개(`EdgeActionModal`, `applyEdgeAction :8663`), 충돌 2개 이상(`EdgeSelectModal` → `interceptIntoEdge :8689`), 앞 삽입(`insertNodeBefore`) 및 `FlowConflictModal` 변형, 가운데 스왑(`swapNodeEdges canvas.ts:944`). 전부 `withSubprocessHandles`(`canvas.ts:909-932`)가 SP 출발을 `__primary__`로 **무조건** 덮는다. 이미 보조 끝에 붙어 있던 엣지도 대표 끝으로 되돌린다.
  - 막힌 경로: 역방향 빠른 연결(`quick-connect-line.tsx:31-39`, SP 제외).
  - 배치: CSV·AI는 `source_handle` null → 로드 시 `s-right`(`page.tsx:769`)인데 SP는 그 핸들이 없어 **조용히 안 그려짐**(`backend/app/subprocess.py:14-17` 주석과 일치).
- `onConnect`의 "출력 1개 충돌"은 노드 단위(`getOutgoingEdges`, `:3763`)라 두 번째 끝을 끌면 삽입/교체 모달이 뜨고, 교체는 다른 끝 엣지까지 지운다(`removeOutgoingEdges`). `edgeAction` state는 `{source,target,at}`뿐이라 잡은 끝이 유실된다(`:1069`).
- 라벨 기본값 없음. 끝 제목을 라벨로 쓰는 코드 없음. 라벨은 분기 Yes/No/기타(`canvas.ts:607-612`), 인스펙터, 더블클릭 편집만.
- 접힌 SP의 명시 연결 없는 끝은 표시 전용 `sp-ends:` 합성 엣지로 대표 경로 타깃까지 그린다(`page.tsx:7437-7487`, 선택 시 안내 패널). 펼치면 진출 게이트웨이는 모든 자식 End × 모든 후속 노드(`inline-expand.ts:93-106`).
- 선택 모달 4종은 같은 크롬(body 포털, `ModalBackdrop z-[1200]`, 포인터 위치 카드, 헤더 캡션 + X, 취소 바). 세로 목록형은 `EdgeSelectModal`(행 = 글리프·라벨 알약·chevron·타깃 알약, hover → `hoveredEdgeId` 캔버스 강조). 대표 표시 선례 없음. 문구 키 `node.primaryEnd`("Primary end"/"대표 끝") 존재.
- `withEdge`(`canvas.ts:882`) 중복 판정은 (source, target)뿐 → 두 끝이 같은 노드로 가는 엣지를 구조 경로로는 만들 수 없다. `createEdge`(RF addEdge)는 핸들까지 본다.

## 3. 설계

### 3.1 들어오는 문 네 방향 (1단계)

- 핸들 id: `in`(좌, 기존 그대로) · `in:top` · `in:right` · `in:bottom`. 헬퍼 `subprocess-embed.ts`: `subprocessInHandle(side)`(left → `in`), `parseSubprocessInHandle(id) → side | null`.
- `SubprocessHandles`: target 핸들 4개 렌더(좌·우는 라벨 라인 18px, 상·하는 가로 중앙). 우측 `in:right`는 대표 끝 핸들과 같은 픽셀에 겹친다(일반 노드의 s-/t- 겹침과 동일).
- `sideFromHandleId`: `in:<side>` 파싱, `in` → left. 저장 시 `target_side`가 실제 변으로 기록된다.
- `withSubprocessHandles`: 타깃이 SP면 in 변형은 보존, 그 외(`t-*`·null)만 `in`.
- 변 선택 패드: SP **타깃** 끝점 잠금 해제. `setEdgeSide`가 SP 타깃에는 `subprocessInHandle(side)`를 쓴다. 소스 끝점(끝 핸들)은 잠금 유지.
- 자동정렬(`autoLayoutFlow`): SP 타깃 끝은 `pickHandleSide` 결과를 `subprocessInHandle(side)`로 반영(소스 끝은 지금처럼 보존).
- 팬아웃(`edge-fanout.ts`): `anchorOf`가 `in:<side>`를 변으로 인식. 그룹 키는 변이 다르면 자연히 분리.
- 빠른 연결 정방향 타깃은 `in`(좌) 유지.
- 로드 정규화(잠재 버그 수정): `toAppEdges`에서 SP 타깃의 `t-<side>` → `subprocessInHandle(side)`, SP 소스의 `s-*`·null → `__primary__`. CSV·AI 임포트 엣지가 사라지던 문제가 같이 해결된다.
- 백엔드 무변경(`in`·`__primary__`는 그대로 유효, `EdgeIn.target_handle`은 자유 문자열).

### 3.2 다중 출구: 끝 키를 잃지 않게

- `withSubprocessHandles`: 소스가 SP면 **끝 키를 보존**(변 id `s-*`·null일 때만 `__primary__`). 타깃 SP도 §3.1 규칙.
- `withEdge`/`insertNodeAfter`/`insertNodeBefore`에 `sourceHandle?` 인자 추가. 중복 판정은 (source, sourceHandle, target). 뒤 삽입의 rewire는 `sourceHandle`이 주어지면 **그 끝의 엣지만** 옮긴다(끝이 하나면 인자 없이 기존 동작).
- `onConnect`(끝 핸들 드래그): SP 소스이고 끝이 2개 이상이면 충돌 판정을 `sourceHandle === connection.sourceHandle`인 출력만으로. `edgeAction` state에 `sourceHandle` 보관, `applyEdgeAction`의 교체는 그 끝의 엣지만 제거, 삽입은 그 끝만 rewire. 끝이 하나(또는 미해석·잠김)면 기존 노드 단위 규칙 그대로(결정 4).
- 끝 정보 조회 헬퍼 `subEndsOf(nodeId)`: `nodesRef` 노드 → `linkKey` → `resolvedCache` → `deriveSubEnds`. 잠김·미로드는 `[]`(= 끝 하나 취급, 목록 없이 `__primary__`).

### 3.3 출구 선택 목록 `EdgeEndModal` (신규 `components/edge-end-modal.tsx`)

- 크롬은 `EdgeSelectModal`과 동일(포털·백드롭 z-1200·포인터 위치·Esc·바깥 mousedown·취소 바). 헤더 캡션 `edge.selectEnd`("어느 끝에서 이어질까요?" / "Which end continues from here?").
- 행: `[End 글리프] [끝 제목] [대표 뱃지] [chevron]`. 대표 끝은 **항상 첫 행**, 뱃지 문구 `node.primaryEnd`, 행 배경 `bg-accent-tint` 계열로 구분. 이미 연결된 끝은 행 우측에 현재 타깃 알약을 흐리게 표시(정보용, 선택은 가능 → 끝당 규칙으로 삽입/교체 모달로 이어짐).
- props: `{ position; ends: SubEnd[]; connectedTargets: Record<endKey, string>; onPick(endKey); onClose; title? }`.
- 뜨는 조건: SP 소스의 끝이 **2개 이상**이고 끝을 모르는 경로일 때만. 끝 핸들 드래그 경로는 절대 안 뜬다.
- 키보드: 기존 4종과 같이 Esc만(방향키 탐색은 후속).

### 3.4 경로별 동작 (끝 ≥ 2 기준)

| 경로 | 동작 |
|------|------|
| 끝 핸들 → 핸들 / 몸체 드롭 | 끝 확정. 끝당 충돌 규칙 → 없으면 즉시 생성 |
| 드롭존 뒤(A를 SP 뒤에) | **출구 목록** → 끝 e 선택 → e의 기존 출력 0개면 삽입, 1개면 삽입/교체 모달(e 한정), 2개 이상이면 출력선 선택 모달(e 한정) |
| 드롭존 앞(SP를 B 앞에) | **출구 목록** → 끝 e → `insertNodeBefore(…, sourceHandle=e)`. B에 다른 입력이 있으면 그 뒤에 `FlowConflictModal`(순서: 끝 → 충돌) |
| 역방향 몸체 드롭(입력 핸들에서 끌어 SP 몸체에) | `canQuickConnect`에서 SP 제외 해제 → **출구 목록** → `onConnect({source: SP, sourceHandle: e, …})` |
| 가운데 스왑 | 양쪽에 출력이 있고 한쪽이라도 2개 이상이면 **출력 자리 바꾸기 모달**(§3.4a). 그 외(둘 다 출력 ≤ 1)는 현행 전면 교환 |
| 붙여넣기·Ctrl 복제 | 끝 키 그대로 복사(현행) |
| CSV·AI | 로드 정규화로 `__primary__`(§3.1) |

구현은 `pendingDrop` state(`{aId, bId, zone, at, rewire}`)에 드롭을 보류 → `EdgeEndModal` → 선택 시 기존 게이트 함수들에 `sourceHandle`을 넘겨 재개. 취소 = 아무 변경 없음(분기 `pendingInsert`와 같은 계약).

#### 3.4a 스왑 출력 재배정 모달 "출력 자리 바꾸기" (결정 10)

현행(`swapNodeEdges`, `canvas.ts:944-997`): 분기 노드가 끼지 않으면 **모든 끝점을 전면 교환**한다. 끝 3개에 출구 엣지 3개가 붙은 SP와 출력 1개인 일반 노드를 스왑하면 일반 노드가 출구 3개를 전부 넘겨받고("출력 1개" 관례 붕괴), 끝별 매핑은 사라진다. 분기 ↔ 일반은 출력선 선택 모달로 1개만 가져가는 부분 이관(`swapSelect`).

새 규칙(목업 `.shots/swap-outputs-mock.png`):
- **진입 조건**: A·B 양쪽에 출력 엣지가 있고 한쪽이라도 2개 이상이면 모달. 둘 다 출력 ≤ 1이면 현행 전면 교환(모달 없음). 분기 ↔ 일반의 기존 `swapSelect`(EdgeSelectModal)는 이 모달로 **대체**해 규칙을 하나로 모은다.
- **짝(pair)**: 왼쪽 행(A의 출력) → 오른쪽 행(B의 출력) 순으로 눌러 짝을 만든다. 짝지은 두 출력은 **가는 곳(target)만 서로 바꾼다**. 라벨(Yes/No)과 SP 끝 키(`sourceHandle`)는 각자 노드에 남는다. 같은 번호 배지 + 가운데 연결선으로 표시, 다시 누르면 해제.
- **남김**: 짝이 없는 출력은 지금 타깃을 유지한다. 짝이 하나도 없어도 확인 가능(입력만 교환되는 스왑).
- **기본 상태**: "순서대로 짝짓기"가 적용된 채 열린다(대표 끝·첫 분기부터, 짧은 쪽 길이만큼). 푸터의 같은 버튼으로 다시 적용 가능.
- **입력 엣지**는 현행대로 전면 교환. 둘을 직접 잇는 엣지(A→B)는 끝점 교환(B→A)하고 짝 목록에서는 뺀다.
- **확인을 눌러야 실행**(위치 교환 + 엣지 재배정 + 히스토리 1건). **취소 또는 Esc·바깥 클릭이면 스왑 자체가 취소**되어 엣지·위치 모두 변경 없음(A는 드롭 지점에 그대로, 현행 swapSelect 취소와 동일).
- 행 hover 시 캔버스의 해당 엣지를 강조(`hoveredEdgeId`, 출력선 선택 모달과 동일). SP 행은 대표 끝 뱃지와 미러 라벨 알약(§3.5)을 그대로 쓴다.
- 분기 ↔ 일반에서 바뀌는 점: 종전에는 가져간 엣지가 노드를 옮겨 라벨도 함께 갔지만(일반 노드에 "Yes" 라벨 엣지), 새 규칙은 타깃만 바꿔 **Yes/No가 분기 노드에 남는다**. 의미상 더 맞고 결과 그림은 같다.

구현: 새 컴포넌트 `swap-outputs-modal.tsx`(props `{ position; left: SwapSide; right: SwapSide; initialPairs; onConfirm(pairs: [leftEdgeId, rightEdgeId][]); onClose; onHoverEdge? }`, `SwapSide = { nodeLabel; nodeType; outputs: { edgeId; label; mirrored; isPrimary; targetLabel; branchKind? }[] }`). `swapNodeEdges(edges, aId, bId, typeOf, pairs)`로 시그니처 변경: 입력 전면 교환 + 직접 엣지 끝점 교환 + 짝 타깃 교환, 그 외 출력은 그대로. `swapSelect` state를 `swapOutputs` state(`{aId, bId, aStart, left, right, at}`)로 교체 — 드래그 시작 좌표 `aStart` 캡처는 기존 랜드마인 그대로(모달로 미루면 `dragStartPosRef`가 비워진다). 테스트: `canvas.test.ts`의 스왑 5케이스를 pairs 시그니처로 옮기고 SP·다출력끼리·전부 남김 케이스 3종 추가.

### 3.5 라벨 미러링 (결정 3·8)

- **저장하지 않는다.** 소스 SP의 끝이 2개 이상이고 엣지에 직접 쓴 라벨이 없으면, 렌더 변환(`styledEdges`)이 끝 제목을 표시 라벨로 넣고 `data.labelMirrored = true`를 표시한다. `resolvedCache`의 끝 제목을 읽으므로 링크 맵에서 끝을 개명하면 즉시 따라간다. `buildGraph`는 `edges` state를 직렬화하므로 미러 라벨은 저장·서명·비교 diff에 들어가지 않는다.
- **디자인 구분**: 직접 쓴 라벨 알약은 현행 그대로(실선 테두리, `text-ink`). 미러 라벨은 점선 테두리(`border-dashed`)·옅은 글자(`text-ink-tertiary`)·배경 `bg-surface-alt`·앞에 12px 링크 아이콘(Lucide `Link2`)을 붙인다. 선택·in/out 하이라이트 시 색 규칙은 `highlightEdgeLabel`과 동일하게 적용하되 점선은 유지.
- 인스펙터 라벨 입력과 더블클릭 편집 박스는 값은 비운 채 **placeholder로 미러 제목**을 보여 준다. 글자를 쓰면 직접 라벨(저장), 지우면 다시 미러.
- 끝이 하나인 SP는 미러 없음(결정 3). 기존 데이터 소급 없음(직접 라벨이 있는 엣지는 그대로 우선).
- 표면 범위: 에디터(임베드 자식 엣지 포함). 비교 화면·Excel/CSV는 저장 라벨만 보므로 미러 라벨이 나오지 않는다(한계, §6).

### 3.6 표시 규칙: 합성 안내 엣지 제거 · 펼침 게이트웨이 끝별

- 접힌 SP의 `sp-ends:` 합성 엣지(명시 연결 없는 끝을 대표 타깃으로 그리던 표시 전용 선)는 **제거**. 결정 5의 원칙(연결 안 한 끝은 잇지 않음)을 접힘 상태에도 적용(확인 항목 §7-1). 함께 제거: `SP_ENDS_EDGE_PREFIX` 분기, 안내 패널(`isGuideEdgeSelected`의 sp-ends 부분), 하이라이트 순회 포함분.
- 펼침 진출 게이트웨이(`buildGatewayEdges`): 자식 End e(키 k)마다 호스트 출구 엣지 중 `sourceHandle === k`(레거시 null·`s-*`는 `__primary__`로 간주)인 엣지의 타깃으로만 잇는다. 없으면 게이트웨이 없음. 게이트웨이의 타깃 핸들은 원본 엣지의 `targetHandle`을 물려받는다(§3.1의 `in:*` 포함). 자식 맵에 End가 없는 폴백(진출 차수 0 노드·전체)은 현행 유지.
- 진입 게이트웨이는 그대로(우측 `__primary__` → 자식 Start 좌측).

### 3.7 변경하지 않는 것

- 끝 키 = 끝 제목 계약과 개명 시 고아 처리(핀 갱신 토스트만). 나가는 끝 핸들의 변(우측 고정). 비교 화면(4변 핸들 재매핑, 끝 정체성 없음). 백엔드 모델·스키마·임포터.

### 3.8 펼침 게이트웨이 점선 애니메이션 (결정 9)

- 현행: 게이트웨이는 `animated: false` + 인라인 `strokeDasharray: "5 4"` + 불투명도 0.55(`page.tsx:6980-6988`)라 점선이 멈춰 있다. 다른 엣지는 `EDGE_DEFAULTS.animated = true`로 React Flow 기본 점선 흐름(`stroke-dasharray: 5`, dashdraw)이 돈다.
- 변경: 게이트웨이도 `animated: true`로 두고 인라인 dasharray를 제거해 다른 엣지와 같은 점선·속도로 흐르게 한다. 불투명도 0.55와 선택 허용·삭제 차단은 그대로. 진입·진출 둘 다 적용.
- 리스크 없음(스타일만). `pw-verify-edge-fanout-expand.mjs`에 `.react-flow__edge.animated` 클래스 확인 1건 추가.

## 4. 구현 순서 (플랜)

브랜치 `feat/subprocess-ends`(`feat/edge-fanout` 위에서 분기, 팬아웃 헬퍼 재사용). 각 단계 커밋 1개, `npx vitest run` + `npx tsc --noEmit` + `npm run lint` 그린이 게이트.

1. **핸들 헬퍼 + 순수 함수** — `subprocess-embed.ts` in 변형 헬퍼, `canvas.ts` `sideFromHandleId`·`withSubprocessHandles`(끝 키 보존, in 변형 보존)·`withEdge`/`insertNodeAfter`/`insertNodeBefore`의 `sourceHandle` 인자와 끝 한정 rewire·중복 판정 → verify: `canvas.test.ts` 신규 케이스(보존·정규화·끝 한정 rewire·같은 타깃 두 끝 허용).
2. **렌더·레이아웃·팬아웃** — `SubprocessHandles` 4변 in, `autoLayoutFlow` SP 타깃 변 매핑, `edge-fanout.ts` `anchorOf` in 변형 → verify: `flow-layout.test.ts`·`edge-fanout.test.ts` 케이스, 개발 서버에서 위/아래 진입 확인.
3. **로드 정규화** — `toAppEdges`(SP 소스 `s-*`/null → `__primary__`, SP 타깃 `t-<side>` → in 변형) + `buildGraph` side 기록 → verify: `page.test.ts` 라운드트립 케이스, CSV 임포트로 SP 출구 엣지가 그려지는지 스모크.
4. **끝당 충돌 규칙 + 끝 조회 헬퍼** — `subEndsOf`, `onConnect` 끝 단위 판정, `edgeAction.sourceHandle`, `applyEdgeAction`·`removeOutgoingEdges` 끝 한정 → verify: 끝 2개 SP에서 두 번째 끝 드래그 시 모달 없이 생성(Playwright).
5. **출구 목록 모달 + 보류 드롭** — `edge-end-modal.tsx`, i18n 키(`edge.selectEnd`, 긴 대시 금지), `pendingDrop` state, 드롭존 앞/뒤·역방향 몸체 드롭 배선, `canQuickConnect` 해제, `COMPONENTS.md` 재생성 → verify: Playwright로 세 경로 각각 목록 표시(대표 끝 첫 행+뱃지)·선택·취소.
6. **라벨 미러링** — `styledEdges`에서 끝 ≥ 2 SP 출구 엣지에 표시 라벨 + `data.labelMirrored`, `styleEdgeLabelPill` 미러 변형(점선·옅은 글자·아이콘), 인스펙터·편집 박스 placeholder → verify: 생성 직후 미러 알약, 직접 입력 시 실선 알약으로 전환, 지우면 복귀, 저장 payload에 미러 라벨 없음(라운드트립 테스트).
7. **스왑 출력 자리 바꾸기 모달** — `swapNodeEdges(…, pairs)` 재작성 + `canvas.test.ts` 이전·추가, `swap-outputs-modal.tsx`(두 열 짝짓기·순서대로 짝짓기·남김·hover 강조·Esc/바깥=취소), `swapSelect` → `swapOutputs` state 교체(aStart 캡처 유지), i18n 키(`swap.outputsTitle`·`swap.outputsHint`·`swap.pairInOrder`·`swap.keep`·`swap.confirm`), `COMPONENTS.md` 재생성 → verify: Playwright로 분기↔일반(기존 UX 대체)·SP↔일반·SP↔분기·전부 남김·취소 5케이스, 취소 시 엣지·위치 무변경.
8. **게이트웨이 점선 애니메이션** — `animated: true`, 인라인 dasharray 제거 → verify: 펼침 스모크에 `.animated` 확인.
9. **합성 안내 엣지 제거 + 게이트웨이 끝별** — `styledEdges`의 sp-ends 블록·안내 패널·순회 제거, `buildGatewayEdges` 끝별 매핑 + 타깃 핸들 상속 → verify: `inline-expand.test.ts` 갱신(연결 없는 끝 = 게이트웨이 없음), 펼침 스모크 `pw-verify-edge-fanout-expand.mjs` 확장.
10. **스모크·문서** — `pw-verify-sp-ends.mjs`(API 시드: 끝 2개 이상인 지정 맵 링크, 경로 5종 + 미러 라벨 + 저장/재로드 라운드트립 + 스왑 + 펼침), `PROGRESS.md`, CLAUDE.md Lessons(끝 키 보존 규칙·in 변형·합성 엣지 폐기·미러 라벨 비영속), `docs/spec.md` §3.3, 본 문서는 머지 후 폐기.

예상 변경 파일: 신규 3(`edge-end-modal.tsx`, `swap-outputs-modal.tsx`, `scripts/pw-verify-sp-ends.mjs`) · 수정 9(`subprocess-embed.ts`, `canvas.ts`, `process-node.tsx`, `flow-layout.ts`, `edge-fanout.ts`, `inline-expand.ts`, `quick-connect-line.tsx`, `maps/[mapId]/page.tsx`, `i18n-messages.ts`) · 테스트 5 · 문서 4. 규모 약 3.5~4.5일.

## 5. 리스크 · 완화

- **page.tsx 드롭 게이트 재배선**: 뒤 삽입 충돌 분기(0/1/2+)가 세 군데로 갈라져 있어 `sourceHandle` 스레딩 누락이 나기 쉽다 → 끝 인자를 받는 단일 진입 함수 `resumeDrop(pending, endKey)`로 모아 세 분기가 한 곳에서 나가게 한다. Playwright로 경로별 실측.
- **합성 안내 엣지 제거는 눈에 띄는 변화**: 기존 다중 끝 SP에서 "선이 사라진" 것처럼 보일 수 있음 → 릴리스 노트에 한 줄, 끝 핸들 호버 툴팁(끝 제목)은 그대로라 연결 지점은 보인다.
- **끝 제목 = 키**: 미러 라벨은 개명을 즉시 따라가지만 핸들 키(`source_handle`)는 옛 제목으로 남아 고아가 된다(기존 문제와 동일 범위, §6). 미러 라벨이 새 제목을 보여 주는 동안 핸들은 옛 키라는 불일치가 눈에 띌 수 있어, 핀 갱신 토스트 문구에 끝 이름을 함께 적는 정도로 보강한다.
- **미러 라벨은 에디터 전용**: 비교 화면·내보내기는 저장 라벨만 본다. 결재자가 비교 화면에서 출구 구분을 못 볼 수 있어 릴리스 노트에 적는다(후속으로 비교 화면에 링크 맵 끝 제목을 실어 나르는 것은 별도 트랙).
- **역방향 몸체 드롭 해제**: 미리보기 선(`QuickConnectLine`)이 SP 몸체 위에서 스냅해야 한다 → `canQuickConnect` 한 곳만 바꾸면 미리보기도 같이 따라온다(같은 술어).
- **compare diff는 핸들을 무시**(`diff.ts:259-264`): 두 끝이 같은 타깃으로 가면 비교 화면에서 1개로 합쳐진다 → 표시 한계로 기록, 이번 범위 밖.

## 6. 알려진 한계 (이번 범위 밖)

- 끝 키가 끝 제목이라 링크 맵에서 끝을 개명하면 부모 엣지의 `source_handle`이 고아가 된다(핀 갱신 시 토스트만, 최신 추종은 무경고). 키를 끝 노드 id로 바꾸는 것은 저장값 마이그레이션이 필요한 별도 트랙.
- 나가는 끝 핸들의 네 방향(2단계)은 별도 설계.

## 7. 검토 시 확인 부탁 (기본값 표기)

1. 접힌 상태의 `sp-ends:` 합성 안내 엣지 **제거** — 결정 5와 같은 원칙. 유지를 원하면 알려 주세요(그 경우 연결 안 한 끝은 접힘에서만 대표 타깃으로 그려지고 펼침에서는 안 그려지는 비대칭이 남습니다).
2. 미러 라벨 디자인 — 점선 테두리 + 옅은 글자 + 링크 아이콘. 다른 표식(예: 기울임, 접두 기호)을 원하면 알려 주세요.
3. 스왑 모달 짝짓기 조작 — 두 번 클릭(왼쪽 행 → 오른쪽 행). 드래그 연결은 모달 안에서는 과해 제외.
