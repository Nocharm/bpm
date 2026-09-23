// 비교 화면 초기 base/target — 게시본(framework는 확정본) vs 그것을 제외한 최신. 둘이 같게 떨어지던 진입 상태를 막는다 (2026-09-23).

interface VersionLike {
  id: number;
  status: string;
}

export function pickInitialCompareVersions(
  versions: VersionLike[],
  isFramework: boolean,
  search: URLSearchParams,
): { baseId: number; targetId: number } {
  const anchorStatus = isFramework ? "confirmed" : "published";
  const anchors = versions.filter((version) => version.status === anchorStatus);
  const base = anchors.length > 0 ? anchors[anchors.length - 1] : versions[0];
  // 딥링크 ?base=&target= 우선 — 모르는 id는 기본값
  const pick = (key: string): number | null => {
    const id = Number(search.get(key));
    return id && versions.some((version) => version.id === id) ? id : null;
  };
  const baseId = pick("base") ?? base.id;
  const others = versions.filter((version) => version.id !== baseId);
  const defaultTarget = others.length > 0 ? others[others.length - 1].id : baseId;
  return { baseId, targetId: pick("target") ?? defaultTarget };
}
