import { LEVELS, ALL_TOWERS, getLevel, type LevelDef } from './levels';
import { g, type WaveDef } from './waves';
import type { EnemyKind } from './enemies';

/** 无尽模式的三张地图，借用正式关卡的走线和配色 */
export const ENDLESS: LevelDef[] = [
  { src: 5, id: 101, name: '无尽 · 螺旋', subtitle: '一条长螺旋，适合堆范围伤害', startEnergy: 450, endlessHp: 1 },
  { src: 7, id: 102, name: '无尽 · 汇流', subtitle: '两路汇合，守住公共主干', startEnergy: 650, endlessHp: 0.6 },
  { src: 9, id: 103, name: '无尽 · 夹击', subtitle: '上下两路，最难的一张', startEnergy: 650, endlessHp: 0.7 },
].map(({ src, ...rest }) => ({
  ...getLevel(src),
  ...rest,
  towers: ALL_TOWERS,
  unlock: undefined,
  challenge: undefined,
  lives: 20,
  hpGrowth: 0,
  waves: [],
  endless: true,
}));

/** 正式关卡和无尽地图统一查找 */
export const findLevel = (id: number) => ENDLESS.find((l) => l.id === id) ?? getLevel(id);

/** 每种怪物从第几波开始出现、按“威胁值”计的单价、出怪间隔 */
const POOL: { kind: EnemyKind; from: number; cost: number; gap: number }[] = [
  { kind: 'thermal', from: 1, cost: 6, gap: 0.45 },
  { kind: 'glitch', from: 2, cost: 8, gap: 0.45 },
  { kind: 'jitter', from: 4, cost: 10, gap: 0.6 },
  { kind: 'crosstalk', from: 5, cost: 20, gap: 1.3 },
  { kind: 'emi', from: 6, cost: 14, gap: 0.9 },
  { kind: 'flicker', from: 8, cost: 36, gap: 2.0 },
];

/** 固定种子的小随机数，同一波每次生成都一样 */
function rng(seed: number) {
  let t = seed * 0x9e3779b9;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 第 n 波（从 1 开始）的出怪表：总威胁值随波数增加，分成 1~3 组；每 10 波来 Boss */
export function endlessWave(n: number): WaveDef {
  const rand = rng(n);
  const pool = POOL.filter((p) => n >= p.from);
  let budget = 60 + 14 * n;
  const groups = Math.min(3, 1 + Math.floor(n / 4));
  const wave: WaveDef = [];
  let delay = 0;
  // 后期出怪更密
  const dense = Math.max(0.6, 1 - n * 0.012);
  for (let j = 0; j < groups; j++) {
    const p = pool[Math.floor(rand() * pool.length)];
    const share = j === groups - 1 ? budget : budget * (0.35 + rand() * 0.25);
    const count = Math.max(2, Math.round(share / p.cost));
    budget -= count * p.cost;
    wave.push(g(p.kind, count, p.gap * dense, delay));
    delay += count * p.gap * dense * 0.5;
  }
  // Boss：每 10 波一次，30 波起两只、60 波起三只（一下来太多会形成一堵墙）
  if (n % 10 === 0) {
    const bosses = 1 + Math.floor(n / 30);
    for (let b = 0; b < bosses; b++) wave.push(g('esd', 1, 0, 2 + b * 8));
  }
  return wave;
}

/** 第 n 波的血量倍率：前期接近线性，后期指数增长，再强的阵容最终也会被淹没 */
export const endlessHpScale = (n: number) => (1 + 0.1 * (n - 1)) * 1.08 ** (n - 1);

/** 无尽模式分数：击败怪物得 奖励×10，清完第 n 波得 n×50 */
export const KILL_SCORE = 10;
export const WAVE_SCORE = 50;

export const isFormalLevel = (id: number) => LEVELS.some((l) => l.id === id);
