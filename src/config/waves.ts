import type { EnemyKind } from './enemies';

export interface SpawnGroup {
  kind: EnemyKind;
  count: number;
  /** 同组两只之间的间隔（秒） */
  gap: number;
  /** 本组相对波次开始的延迟（秒） */
  delay: number;
  /** 走哪条路；不填则在多条路之间轮流 */
  path?: number;
}

export type WaveDef = SpawnGroup[];

/** 清完一波的奖励 */
export const waveBonus = (waveIndex: number) => 40 + waveIndex * 10;

/** 简写：g('thermal', 8, 1.0) */
export const g = (kind: EnemyKind, count: number, gap: number, delay = 0, path?: number): SpawnGroup => ({
  kind, count, gap, delay, path,
});
