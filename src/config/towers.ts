export type TowerKind = 'amp' | 'osc' | 'adc' | 'filter' | 'radar' | 'pll' | 'mixer' | 'comparator' | 'ldo';

/**
 * 每一级的数值。cost 是建造（第 0 级）或升级到该级的费用。
 * extra 的含义随塔种类不同：
 *  - adc:    斩杀线（血量比例）
 *  - filter: 减速比例
 *  - radar:  标记增伤比例
 *  - pll:    锁定满蓄力后的伤害倍数
 *  - mixer:  边带子弹的伤害比例
 *  - comparator: 判决为 1（目标血量 ≥ 50%）时的伤害倍数
 *  - ldo:    范围内友方塔的攻速 / 持续伤害加成
 */
export interface TowerLevel {
  cost: number;
  damage: number;
  range: number;
  interval: number;
  extra: number;
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  /** 建造菜单里的一句话玩法说明 */
  desc: string;
  levels: TowerLevel[];
  /** 预留：以后的科普 / 图鉴内容 */
  info?: string;
}

export const TOWERS: Record<TowerKind, TowerDef> = {
  amp: {
    kind: 'amp',
    name: '放大器',
    desc: '单体直射，稳定输出',
    levels: [
      { cost: 100, damage: 12, range: 150, interval: 0.55, extra: 0 },
      { cost: 90, damage: 22, range: 165, interval: 0.5, extra: 0 },
      { cost: 160, damage: 40, range: 180, interval: 0.45, extra: 0 },
    ],
  },
  osc: {
    kind: 'osc',
    name: '振荡器',
    desc: '周期性发出环形波，范围伤害',
    levels: [
      { cost: 140, damage: 14, range: 110, interval: 1.4, extra: 0 },
      { cost: 120, damage: 24, range: 120, interval: 1.25, extra: 0 },
      { cost: 200, damage: 40, range: 135, interval: 1.1, extra: 0 },
    ],
  },
  adc: {
    kind: 'adc',
    name: 'ADC',
    desc: '血量低于斩杀线的怪直接被量化清除',
    levels: [
      { cost: 120, damage: 8, range: 145, interval: 0.8, extra: 0.15 },
      { cost: 110, damage: 12, range: 155, interval: 0.7, extra: 0.22 },
      { cost: 180, damage: 18, range: 170, interval: 0.6, extra: 0.3 },
    ],
  },
  filter: {
    kind: 'filter',
    name: '滤波器',
    desc: '范围减速，并持续造成少量伤害',
    levels: [
      { cost: 90, damage: 4, range: 105, interval: 0, extra: 0.35 },
      { cost: 80, damage: 7, range: 115, interval: 0, extra: 0.45 },
      { cost: 140, damage: 12, range: 125, interval: 0, extra: 0.55 },
    ],
  },
  radar: {
    kind: 'radar',
    name: '雷达',
    desc: '揭示隐身怪，范围内的怪受到更多伤害',
    levels: [
      { cost: 110, damage: 0, range: 160, interval: 0, extra: 0.2 },
      { cost: 100, damage: 0, range: 185, interval: 0, extra: 0.3 },
      { cost: 160, damage: 0, range: 210, interval: 0, extra: 0.45 },
    ],
  },
  pll: {
    kind: 'pll',
    name: '锁相环',
    desc: '锁定一个目标，伤害随锁定时间增加，不会落空',
    levels: [
      { cost: 160, damage: 14, range: 140, interval: 0, extra: 3 },
      { cost: 140, damage: 22, range: 150, interval: 0, extra: 3.5 },
      { cost: 220, damage: 34, range: 165, interval: 0, extra: 4 },
    ],
  },
  mixer: {
    kind: 'mixer',
    name: '混频器',
    desc: '命中后分出两路边带，打向附近的怪',
    levels: [
      { cost: 150, damage: 14, range: 150, interval: 0.9, extra: 0.5 },
      { cost: 130, damage: 24, range: 160, interval: 0.8, extra: 0.6 },
      { cost: 210, damage: 38, range: 175, interval: 0.7, extra: 0.75 },
    ],
  },
  comparator: {
    kind: 'comparator',
    name: '比较器',
    desc: '专打血最厚的怪，血量过半时判决为 1 造成暴击',
    levels: [
      { cost: 170, damage: 28, range: 160, interval: 1.6, extra: 3 },
      { cost: 150, damage: 46, range: 175, interval: 1.4, extra: 3.5 },
      { cost: 230, damage: 75, range: 190, interval: 1.2, extra: 4 },
    ],
  },
  ldo: {
    kind: 'ldo',
    name: 'LDO',
    desc: '给范围内的塔稳压供电：攻速提升，抵抗静电瘫痪',
    levels: [
      { cost: 130, damage: 0, range: 120, interval: 0, extra: 0.2 },
      { cost: 120, damage: 0, range: 135, interval: 0, extra: 0.3 },
      { cost: 190, damage: 0, range: 150, interval: 0, extra: 0.45 },
    ],
  },
};

/** LDO 每一级抵消的静电瘫痪时间比例 */
export const LDO_PROTECT = [0.4, 0.7, 1];

/** 建造菜单顺序，也是解锁顺序 */
export const TOWER_ORDER: TowerKind[] = ['amp', 'osc', 'filter', 'adc', 'radar', 'mixer', 'pll', 'comparator', 'ldo'];

/** 出售返还比例 */
export const SELL_RATE = 0.7;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => `${Math.round(v * 10) / 10}`;

/** 菜单里展示的数值：[名称, 当前值]，next 给出时附上升级后的值 */
export function towerStats(kind: TowerKind, level: number): [string, string][] {
  const s = TOWERS[kind].levels[level];
  const rate = s.interval > 0 ? `${num(1 / s.interval)}/秒` : '';
  switch (kind) {
    case 'amp':
    case 'osc':
      return [['伤害', `${s.damage}`], ['攻速', rate], ['射程', `${s.range}`]];
    case 'adc':
      return [['伤害', `${s.damage}`], ['斩杀线', pct(s.extra)], ['射程', `${s.range}`]];
    case 'filter':
      return [['减速', pct(s.extra)], ['伤害', `${s.damage}/秒`], ['射程', `${s.range}`]];
    case 'radar':
      return [['增伤', `+${pct(s.extra)}`], ['射程', `${s.range}`]];
    case 'pll':
      return [['伤害', `${s.damage}/秒`], ['满蓄力', `×${s.extra}`], ['射程', `${s.range}`]];
    case 'mixer':
      return [['伤害', `${s.damage}`], ['边带', pct(s.extra)], ['攻速', rate]];
    case 'comparator':
      return [['伤害', `${s.damage}`], ['暴击', `×${s.extra}`], ['攻速', rate]];
    case 'ldo':
      return [['攻速', `+${pct(s.extra)}`], ['抗瘫痪', pct(LDO_PROTECT[level])], ['射程', `${s.range}`]];
  }
}

/** 一行文字；有下一级时显示“当前→下一级” */
export function statText(kind: TowerKind, level: number, compare = false) {
  const cur = towerStats(kind, level);
  const nxt = compare && level + 1 < TOWERS[kind].levels.length ? towerStats(kind, level + 1) : null;
  return cur.map(([k, v], i) => (nxt && nxt[i][1] !== v ? `${k} ${v}→${nxt[i][1]}` : `${k} ${v}`)).join('   ');
}
