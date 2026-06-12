// 맵별 창 기하 영속 — localStorage(bpm.windows.<mapId>). 스코프키 → WindowGeom.

export interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  maximized: boolean;
}

const keyFor = (mapId: number) => `bpm.windows.${mapId}`;

export function loadWindowGeoms(mapId: number): Record<string, WindowGeom> {
  try {
    const raw = window.localStorage.getItem(keyFor(mapId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    // 파싱 실패는 빈 값으로 — 손상된 저장값이 앱을 막지 않게
    return {};
  }
}

export function saveWindowGeoms(mapId: number, geoms: Record<string, WindowGeom>): void {
  try {
    window.localStorage.setItem(keyFor(mapId), JSON.stringify(geoms));
  } catch {
    // 용량 초과 등은 무시 — 영속은 best-effort
  }
}
