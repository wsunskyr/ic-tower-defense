import { TOWERS, type TowerKind } from './towers';
import type { Waypoints } from './map';
import { g, type WaveDef } from './waves';

export type PropKind = 'cap' | 'res' | 'ram' | 'ind';

export interface Theme {
  ground: number;
  blob: number;
  path: number;
  pathEdge: number;
  dash: number;
}

/** 可选的关卡挑战：通关的同时满足条件即可获得徽章 */
export type Challenge =
  | { kind: 'maxTowers'; n: number }
  | { kind: 'noTower'; tower: TowerKind }
  | { kind: 'noUpgrade' }
  | { kind: 'earlyCalls'; n: number };

export function challengeText(c: Challenge) {
  switch (c.kind) {
    case 'maxTowers':
      return `场上最多 ${c.n} 座塔`;
    case 'noTower':
      return `不建造${TOWERS[c.tower].name}`;
    case 'noUpgrade':
      return '不升级任何塔';
    case 'earlyCalls':
      return `至少提前开波 ${c.n} 次`;
  }
}

export interface LevelDef {
  id: number;
  name: string;
  /** 选关卡片上的一句话 */
  subtitle: string;
  theme: Theme;
  /** 所有路径的终点必须相同（芯片核心） */
  paths: Waypoints[];
  /** 不能建塔的元件障碍物 */
  props: { kind: PropKind; c: number; r: number }[];
  towers: TowerKind[];
  /** 本关新解锁的塔，开局时提示 */
  unlock?: TowerKind;
  challenge?: Challenge;
  /** 无尽模式：waves 为空，波次由 endless.ts 实时生成 */
  endless?: boolean;
  startEnergy: number;
  lives: number;
  /** 每过一波，怪物血量增加的比例 */
  hpGrowth: number;
  waves: WaveDef[];
}

const THEMES = {
  meadow: { ground: 0xa8dc8f, blob: 0xbde7a6, path: 0xf1d39a, pathEdge: 0xd4ae6c, dash: 0xe4bf7a },
  lime: { ground: 0xd4ec9a, blob: 0xe2f4b4, path: 0xf3d9a4, pathEdge: 0xc9a466, dash: 0xe2c086 },
  mint: { ground: 0x9fdccb, blob: 0xb6e8da, path: 0xf4e2b8, pathEdge: 0xcdb27c, dash: 0xe2c992 },
  lavender: { ground: 0xc9c3ee, blob: 0xd8d3f5, path: 0xf6e7c4, pathEdge: 0xb59f78, dash: 0xe0cb9c },
  peach: { ground: 0xf5cfa8, blob: 0xf9dcbd, path: 0xfaeccd, pathEdge: 0xc49a6a, dash: 0xe8cc9a },
  sky: { ground: 0xa9d4f0, blob: 0xbfe0f6, path: 0xf3e0b0, pathEdge: 0xc3a46a, dash: 0xdcc28a },
  ice: { ground: 0xc5e6ef, blob: 0xd8eff5, path: 0xf2e6c8, pathEdge: 0xa8946e, dash: 0xd8c69c },
  sun: { ground: 0xf0dc8c, blob: 0xf6e7a8, path: 0xe9c7a0, pathEdge: 0xb88a5c, dash: 0xd5ab80 },
  blossom: { ground: 0xf2c6d4, blob: 0xf7d6e1, path: 0xf6e5c2, pathEdge: 0xc49d7a, dash: 0xe2c49a },
} satisfies Record<string, Theme>;

/** 按解锁顺序：第 n 关可以用前 n+1 座塔（第 1 关给两座） */
const UNLOCK: TowerKind[] = ['amp', 'osc', 'filter', 'adc', 'radar', 'mixer', 'pll', 'comparator', 'ldo'];
const upTo = (kind: TowerKind) => UNLOCK.slice(0, UNLOCK.indexOf(kind) + 1);

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: '放大器入门',
    subtitle: '用放大器和振荡器挡住热噪声',
    theme: THEMES.meadow,
    paths: [[[-1, 4], [4, 4], [4, 1], [11, 1], [11, 6], [14, 6]]],
    props: [{ kind: 'cap', c: 1, r: 7 }, { kind: 'res', c: 8, r: 4 }, { kind: 'ind', c: 14, r: 1 }],
    towers: upTo('osc'),
    challenge: { kind: 'maxTowers', n: 4 },
    startEnergy: 260,
    lives: 10,
    hpGrowth: 0.1,
    waves: [
      [g('thermal', 5, 1.2)],
      [g('thermal', 8, 1.0)],
      [g('thermal', 10, 0.8)],
      [g('thermal', 14, 0.6)],
      [g('thermal', 10, 0.6), g('thermal', 8, 0.4, 7)],
    ],
  },
  {
    id: 2,
    name: '噪声过滤',
    subtitle: '毛刺跑得飞快，用滤波器拖慢它们',
    theme: THEMES.lime,
    paths: [[[-1, 2], [5, 2], [5, 6], [10, 6], [10, 2], [13, 2], [13, 6]]],
    props: [{ kind: 'cap', c: 0, r: 7 }, { kind: 'res', c: 7, r: 0 }, { kind: 'ind', c: 15, r: 8 }],
    towers: upTo('filter'),
    unlock: 'filter',
    challenge: { kind: 'noUpgrade' },
    startEnergy: 300,
    lives: 10,
    hpGrowth: 0.1,
    waves: [
      [g('thermal', 8, 1.0)],
      [g('glitch', 6, 1.0)],
      [g('thermal', 10, 0.7), g('glitch', 5, 0.9, 5)],
      [g('glitch', 10, 0.6)],
      [g('thermal', 14, 0.5), g('glitch', 8, 0.6, 5)],
      [g('glitch', 14, 0.45), g('thermal', 12, 0.5, 5)],
    ],
  },
  {
    id: 3,
    name: '时钟树',
    subtitle: '解锁 ADC，斩杀厚血的 1/f 噪声',
    theme: THEMES.mint,
    paths: [[[-1, 7], [2, 7], [2, 1], [6, 1], [6, 7], [9, 7], [9, 1], [13, 1], [13, 5]]],
    props: [{ kind: 'ram', c: 4, r: 4 }, { kind: 'cap', c: 11, r: 6 }, { kind: 'res', c: 15, r: 3 }],
    towers: upTo('adc'),
    unlock: 'adc',
    challenge: { kind: 'earlyCalls', n: 3 },
    startEnergy: 320,
    lives: 10,
    hpGrowth: 0.12,
    waves: [
      [g('thermal', 10, 0.8)],
      [g('glitch', 8, 0.7), g('thermal', 6, 0.7, 4)],
      [g('thermal', 12, 0.6), g('glitch', 6, 0.7, 4)],
      [g('crosstalk', 3, 2.4), g('thermal', 8, 0.6, 3)],
      [g('flicker', 2, 4.0), g('thermal', 10, 0.5, 2)],
      [g('crosstalk', 6, 1.6), g('glitch', 10, 0.5, 4)],
      [g('flicker', 4, 3.0), g('thermal', 14, 0.45, 3)],
      [g('crosstalk', 6, 1.4), g('flicker', 4, 2.5, 4), g('glitch', 12, 0.4, 8)],
    ],
  },
  {
    id: 4,
    name: '射频前端',
    subtitle: '双入口！解锁雷达，看穿隐身的 EMI',
    theme: THEMES.lavender,
    paths: [
      [[-1, 1], [5, 1], [5, 4], [8, 4], [8, 1], [12, 1], [12, 6], [14, 6]],
      [[-1, 7], [5, 7], [5, 4], [8, 4], [8, 1], [12, 1], [12, 6], [14, 6]],
    ],
    props: [{ kind: 'ind', c: 2, r: 4 }, { kind: 'cap', c: 10, r: 3 }, { kind: 'ram', c: 14, r: 2 }],
    towers: upTo('radar'),
    unlock: 'radar',
    challenge: { kind: 'maxTowers', n: 8 },
    startEnergy: 380,
    lives: 10,
    hpGrowth: 0.12,
    waves: [
      [g('thermal', 12, 0.6)],
      [g('glitch', 10, 0.6), g('thermal', 8, 0.6, 3)],
      [g('emi', 5, 1.5, 0, 0), g('thermal', 10, 0.5, 2, 1)],
      [g('crosstalk', 5, 1.8), g('glitch', 8, 0.6, 3)],
      [g('flicker', 3, 3.0), g('emi', 6, 1.2, 3)],
      [g('emi', 8, 1.1), g('glitch', 10, 0.5, 4)],
      [g('crosstalk', 6, 1.4), g('thermal', 16, 0.4, 4)],
      [g('emi', 10, 0.9), g('flicker', 4, 2.5, 3), g('glitch', 14, 0.4, 6)],
    ],
  },
  {
    id: 5,
    name: '混频链路',
    subtitle: '螺旋走线怪物扎堆，解锁混频器',
    theme: THEMES.peach,
    paths: [[[-1, 1], [14, 1], [14, 7], [1, 7], [1, 3], [11, 3], [11, 5], [5, 5]]],
    props: [{ kind: 'res', c: 15, r: 4 }, { kind: 'cap', c: 0, r: 5 }, { kind: 'ram', c: 7, r: 4 }],
    towers: upTo('mixer'),
    unlock: 'mixer',
    challenge: { kind: 'noTower', tower: 'amp' },
    startEnergy: 360,
    lives: 10,
    hpGrowth: 0.22,
    waves: [
      [g('thermal', 16, 0.45)],
      [g('jitter', 8, 0.8), g('thermal', 10, 0.5, 3)],
      [g('glitch', 16, 0.35)],
      [g('crosstalk', 5, 1.6), g('jitter', 8, 0.7, 5)],
      [g('thermal', 24, 0.3), g('emi', 6, 1.0, 4)],
      [g('flicker', 4, 2.5), g('jitter', 14, 0.5, 3)],
      [g('glitch', 20, 0.3), g('crosstalk', 8, 1.0, 4)],
      [g('jitter', 18, 0.4), g('emi', 10, 0.8, 3), g('thermal', 20, 0.3, 6)],
    ],
  },
  {
    id: 6,
    name: '高速 SerDes',
    subtitle: '长长的蛇形差分线，解锁锁相环',
    theme: THEMES.sky,
    paths: [[[-1, 1], [14, 1], [14, 3], [1, 3], [1, 5], [11, 5], [11, 7]]],
    props: [{ kind: 'res', c: 7, r: 0 }, { kind: 'cap', c: 0, r: 7 }, { kind: 'ram', c: 5, r: 7 }, { kind: 'ind', c: 15, r: 4 }],
    towers: upTo('pll'),
    unlock: 'pll',
    challenge: { kind: 'noTower', tower: 'osc' },
    startEnergy: 340,
    lives: 10,
    hpGrowth: 0.43,
    waves: [
      [g('glitch', 14, 0.5)],
      [g('jitter', 12, 0.7)],
      [g('thermal', 20, 0.35), g('glitch', 12, 0.45, 4)],
      [g('flicker', 5, 2.5), g('jitter', 10, 0.7, 3)],
      [g('crosstalk', 8, 1.2), g('emi', 6, 1.2, 4)],
      [g('glitch', 22, 0.3), g('jitter', 12, 0.6, 3)],
      [g('flicker', 8, 2.0), g('thermal', 20, 0.35, 3)],
      [g('emi', 14, 0.8), g('jitter', 14, 0.5, 3)],
      [g('crosstalk', 10, 1.0), g('glitch', 22, 0.3, 3), g('flicker', 6, 2.0, 6)],
    ],
  },
  {
    id: 7,
    name: '判决电路',
    subtitle: '厚血怪成群，解锁比较器一锤定音',
    theme: THEMES.ice,
    paths: [
      [[7, -1], [7, 3], [3, 3], [3, 7], [12, 7], [12, 3], [14, 3]],
      [[-1, 5], [3, 5], [3, 7], [12, 7], [12, 3], [14, 3]],
    ],
    props: [{ kind: 'cap', c: 1, r: 1 }, { kind: 'ind', c: 10, r: 1 }, { kind: 'ram', c: 7, r: 5 }, { kind: 'res', c: 14, r: 7 }],
    towers: upTo('comparator'),
    unlock: 'comparator',
    challenge: { kind: 'earlyCalls', n: 4 },
    startEnergy: 440,
    lives: 10,
    hpGrowth: 0.15,
    waves: [
      [g('thermal', 12, 0.6, 0, 0), g('thermal', 8, 0.7, 2, 1)],
      [g('crosstalk', 6, 1.4), g('glitch', 10, 0.5, 3)],
      [g('jitter', 10, 0.7, 0, 0), g('thermal', 10, 0.6, 2, 1)],
      [g('flicker', 2, 3.5, 0, 0), g('emi', 5, 1.3, 2, 1)],
      [g('flicker', 5, 2.2), g('crosstalk', 6, 1.2, 4)],
      [g('jitter', 16, 0.5), g('glitch', 14, 0.35, 4)],
      [g('flicker', 6, 1.8), g('emi', 8, 0.9, 4)],
      [g('crosstalk', 10, 1.0), g('jitter', 14, 0.5, 3), g('flicker', 6, 1.8, 6)],
      [g('flicker', 10, 1.3, 0, 0), g('flicker', 6, 1.8, 3, 1), g('glitch', 20, 0.3, 6)],
      [g('emi', 14, 0.7), g('flicker', 10, 1.4, 3), g('jitter', 16, 0.45, 6)],
    ],
  },
  {
    id: 8,
    name: '电源管理',
    subtitle: 'BOSS 静电放电来袭，解锁 LDO 稳压',
    theme: THEMES.sun,
    paths: [[[-1, 1], [3, 1], [3, 6], [7, 6], [7, 2], [11, 2], [11, 7], [14, 7], [14, 3]]],
    props: [{ kind: 'cap', c: 5, r: 3 }, { kind: 'ind', c: 9, r: 5 }, { kind: 'ram', c: 13, r: 0 }],
    towers: upTo('ldo'),
    unlock: 'ldo',
    challenge: { kind: 'maxTowers', n: 10 },
    startEnergy: 440,
    lives: 10,
    hpGrowth: 0.12,
    waves: [
      [g('thermal', 10, 0.8)],
      [g('thermal', 10, 0.7), g('glitch', 6, 1.0, 5)],
      [g('crosstalk', 5, 2.0), g('thermal', 10, 0.6, 3)],
      [g('flicker', 3, 3.5), g('jitter', 8, 0.8, 2)],
      [g('emi', 8, 1.2), g('glitch', 10, 0.5, 3)],
      [g('thermal', 12, 0.5), g('esd', 1, 0, 6), g('thermal', 6, 0.9, 10)],
      [g('crosstalk', 8, 1.2), g('flicker', 5, 2.4, 4)],
      [g('emi', 12, 0.9), g('glitch', 14, 0.4, 3), g('flicker', 4, 2.5, 6)],
      [g('jitter', 14, 0.6), g('crosstalk', 8, 1.2, 4)],
      [g('thermal', 16, 0.45), g('esd', 1, 0, 5), g('jitter', 10, 0.7, 8), g('emi', 8, 1.0, 12)],
    ],
  },
  {
    id: 9,
    name: 'SoC 总装',
    subtitle: '上下夹击，三只 BOSS 压轴',
    theme: THEMES.blossom,
    paths: [
      [[2, -1], [2, 3], [6, 3], [6, 1], [11, 1], [11, 4], [14, 4]],
      [[2, 9], [2, 5], [6, 5], [6, 7], [11, 7], [11, 4], [14, 4]],
    ],
    props: [{ kind: 'ram', c: 8, r: 4 }, { kind: 'cap', c: 13, r: 1 }, { kind: 'cap', c: 13, r: 7 }, { kind: 'res', c: 0, r: 4 }],
    towers: UNLOCK,
    challenge: { kind: 'noTower', tower: 'pll' },
    startEnergy: 520,
    lives: 10,
    hpGrowth: 0.12,
    waves: [
      [g('thermal', 16, 0.5)],
      [g('glitch', 12, 0.5), g('jitter', 6, 0.8, 3)],
      [g('crosstalk', 6, 1.5), g('thermal', 12, 0.4, 3)],
      [g('emi', 8, 1.1), g('flicker', 3, 3.0, 3)],
      [g('jitter', 14, 0.6), g('glitch', 12, 0.4, 4)],
      [g('flicker', 6, 2.0), g('crosstalk', 6, 1.4, 3)],
      [g('emi', 10, 0.9), g('thermal', 20, 0.35, 3)],
      [g('esd', 1, 0, 0, 0), g('thermal', 14, 0.5, 2), g('jitter', 8, 0.8, 6)],
      [g('glitch', 20, 0.3), g('emi', 10, 0.9, 4)],
      [g('flicker', 8, 1.8), g('crosstalk', 8, 1.2, 4)],
      [g('jitter', 16, 0.5), g('emi', 12, 0.8, 3), g('glitch', 14, 0.35, 6)],
      [g('esd', 1, 0, 0, 0), g('esd', 1, 0, 6, 1), g('thermal', 20, 0.4, 2), g('flicker', 6, 2.0, 8)],
    ],
  },
];

export const getLevel = (id: number) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];

export const ALL_TOWERS = UNLOCK;
