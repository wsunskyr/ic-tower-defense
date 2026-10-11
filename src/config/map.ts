export const CELL = 64;
export const COLS = 16;
export const ROWS = 9;
/** 顶部 HUD 高度，地图从这里开始 */
export const MAP_Y = 64;
export const WIDTH = COLS * CELL;
export const HEIGHT = MAP_Y + ROWS * CELL;

/** 格子坐标的走线拐点；第一个点在地图外（入口），最后一个点是芯片核心 */
export type Waypoints = [number, number][];

export interface Point { x: number; y: number }

export function cellCenter(c: number, r: number): Point {
  return { x: c * CELL + CELL / 2, y: MAP_Y + r * CELL + CELL / 2 };
}

export function cellAt(x: number, y: number): { c: number; r: number } | null {
  const c = Math.floor(x / CELL);
  const r = Math.floor((y - MAP_Y) / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { c, r };
}

export const cellKey = (c: number, r: number) => `${c},${r}`;

/** 走线经过的格子 */
export function pathCells(paths: Waypoints[]): Set<string> {
  const set = new Set<string>();
  for (const wps of paths) {
    for (let i = 0; i < wps.length - 1; i++) {
      const [c0, r0] = wps[i];
      const [c1, r1] = wps[i + 1];
      const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
      for (let s = 0; s <= steps; s++) {
        const c = c0 + Math.sign(c1 - c0) * s;
        const r = r0 + Math.sign(r1 - r0) * s;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) set.add(cellKey(c, r));
      }
    }
  }
  return set;
}

/** 按行进距离取走线上的位置 */
export class PathTrack {
  readonly points: Point[];
  private readonly cum: number[] = [0];
  readonly total: number;

  constructor(waypoints: Waypoints) {
    this.points = waypoints.map(([c, r]) => cellCenter(c, r));
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.total = this.cum[this.cum.length - 1];
  }

  /** 返回位置和水平朝向（-1 左，1 右，0 竖直） */
  pointAt(d: number): Point & { dx: number } {
    const dist = Math.max(0, Math.min(d, this.total));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < dist) i++;
    const a = this.points[i - 1];
    const b = this.points[i];
    const seg = this.cum[i] - this.cum[i - 1];
    const t = seg === 0 ? 0 : (dist - this.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: Math.sign(b.x - a.x) };
  }
}
