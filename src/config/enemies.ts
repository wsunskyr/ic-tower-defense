export type EnemyKind = 'thermal' | 'glitch' | 'crosstalk' | 'flicker' | 'jitter' | 'emi' | 'esd';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  /** 第一次出现时的提示 */
  intro: string;
  hp: number;
  /** 像素/秒 */
  speed: number;
  reward: number;
  /** 到达芯片时扣除的生命 */
  leak: number;
  /** 显示尺寸（像素） */
  size: number;
  /** 主色，用于击杀粒子 */
  color: number;
  /** 受到伤害的减免比例 */
  armor?: number;
  /** 躲开弹道攻击的概率 */
  dodge?: number;
  /** 隐身：只有在雷达范围内才能被攻击 */
  stealth?: boolean;
  /** 成对出现，伤害由两只分摊 */
  linked?: boolean;
  boss?: boolean;
  /** 预留：以后的科普 / 图鉴内容 */
  info?: string;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  thermal: {
    kind: 'thermal', name: '热噪声', intro: '成群出现，数量多但很脆',
    hp: 34, speed: 62, reward: 6, leak: 1, size: 46, color: 0x8a7bd9,
  },
  glitch: {
    kind: 'glitch', name: '毛刺', intro: '速度极快！用滤波器减速',
    hp: 24, speed: 145, reward: 7, leak: 1, size: 44, color: 0xff7a3d,
  },
  crosstalk: {
    kind: 'crosstalk', name: '串扰', intro: '成对出现，打一只另一只分摊一半伤害',
    hp: 70, speed: 58, reward: 9, leak: 1, size: 52, color: 0x55c4b0, linked: true,
  },
  flicker: {
    kind: 'flicker', name: '1/f 噪声', intro: '很慢但很硬，减伤 35%。试试 ADC 斩杀或锁相环',
    hp: 300, speed: 32, reward: 22, leak: 2, size: 62, color: 0xf29ac9, armor: 0.35,
  },
  jitter: {
    kind: 'jitter', name: '抖动', intro: '会躲开 35% 的子弹，锁相环和振荡器不会落空',
    hp: 70, speed: 78, reward: 9, leak: 1, size: 48, color: 0x9fd4ff, dodge: 0.35,
  },
  emi: {
    kind: 'emi', name: '电磁干扰', intro: '隐身！只有雷达范围内才能被看见和攻击',
    hp: 90, speed: 70, reward: 12, leak: 1, size: 50, color: 0xb8b8c8, stealth: true,
  },
  esd: {
    kind: 'esd', name: '静电放电', intro: 'BOSS！会周期性放电，让附近的塔瘫痪片刻',
    hp: 1900, speed: 30, reward: 200, leak: 4, size: 120, color: 0xffd166, armor: 0.15, boss: true,
  },
};

/** ESD 放电参数 */
export const ESD_DISCHARGE = { interval: 6, radius: 150, stun: 1.5 };
