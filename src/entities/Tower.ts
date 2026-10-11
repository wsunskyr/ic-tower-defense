import Phaser from 'phaser';
import { TOWERS, SELL_RATE, LDO_PROTECT, type TowerDef, type TowerKind } from '../config/towers';
import type { Enemy } from './Enemy';
import { sfx } from '../audio';

/** 塔与战场交互所需的接口，由 GameScene 实现 */
export interface Battle {
  readonly stage: Phaser.Scene;
  readonly enemies: Enemy[];
  /** from 有值表示一次离散命中（会闪白、显示伤害数字），否则是持续伤害 */
  damage(e: Enemy, amount: number, from?: { x: number; y: number }, showNumber?: boolean): void;
  fireProjectile(tower: Tower, target: Enemy): void;
  ring(x: number, y: number, radius: number, color: number): void;
}

const SIZE = 60;

/** 每一级对应的贴图 key：amp / amp-2 / amp-3 */
export const towerTexture = (kind: TowerKind, level: number) => (level === 0 ? kind : `${kind}-${level + 1}`);

/** 各塔每一级的主色，用于子弹、光环、光束等攻击特效 */
const LEVEL_COLORS: Record<TowerKind, [number, number, number]> = {
  amp: [0xffe14d, 0xffa53d, 0xff5fa2],
  osc: [0xff8fc8, 0xff7abf, 0xd77bff],
  adc: [0x3cff5a, 0x55ffff, 0xff6bd6],
  filter: [0x7ad6a0, 0x5cc98a, 0x3cc7b5],
  radar: [0x9aa7ff, 0x8494ff, 0xffc93c],
  pll: [0xff5a1f, 0xff2d55, 0xffb300],
  mixer: [0x4fd8e0, 0x2fb8ff, 0x7a6bff],
  comparator: [0xff6b5a, 0xff3355, 0xffc23c],
  ldo: [0x8ee86b, 0x4fe0a0, 0xffe14d],
};

export class Tower {
  readonly def: TowerDef;
  readonly sprite: Phaser.GameObjects.Image;
  private readonly stars: Phaser.GameObjects.Text;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly stunIcon: Phaser.GameObjects.Text;
  /** 底座：1 级只有阴影，2 级银色，3 级发光金色 */
  private readonly base: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private sparkleClock = 0;

  level = 0;
  invested: number;
  private cooldown = 0;
  private pulseClock = 0;
  stun = 0;
  /** 由附近 LDO 每帧写入：攻速 / 持续伤害加成、抵消静电瘫痪的比例 */
  boost = 0;
  protect = 0;

  private lockTarget: Enemy | null = null;
  private lockTime = 0;

  constructor(
    private readonly battle: Battle,
    readonly kind: TowerKind,
    readonly c: number,
    readonly r: number,
    readonly x: number,
    readonly y: number,
  ) {
    const scene = battle.stage;
    this.def = TOWERS[kind];
    this.invested = this.def.levels[0].cost;
    this.fx = scene.add.graphics().setDepth(y - 40);
    this.glow = scene.add.graphics().setDepth(y - 2).setVisible(false);
    this.base = scene.add.graphics().setDepth(y - 1);
    this.sprite = scene.add.image(x, y - 4, kind).setDepth(y);
    this.stars = scene.add
      .text(x, y + 26, '', { fontFamily: 'Arial', fontSize: '13px', color: '#ffd23f', stroke: '#7a5200', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(y + 1);
    this.stunIcon = scene.add
      .text(x + 20, y - 34, '⚡', { fontSize: '18px' })
      .setOrigin(0.5)
      .setDepth(y + 2)
      .setVisible(false);
    this.refresh();

    this.sprite.setScale(0);
    scene.tweens.add({ targets: this.sprite, scale: this.scale, duration: 260, ease: 'Back.Out' });
  }

  get stats() {
    return this.def.levels[this.level];
  }

  get maxed() {
    return this.level >= this.def.levels.length - 1;
  }

  get upgradeCost() {
    return this.maxed ? 0 : this.def.levels[this.level + 1].cost;
  }

  get sellValue() {
    return Math.floor(this.invested * SELL_RATE);
  }

  /** 当前等级的攻击特效主色 */
  get color() {
    return LEVEL_COLORS[this.kind][this.level];
  }

  private get scale() {
    return (SIZE / this.sprite.width) * (1 + this.level * 0.08);
  }

  upgrade() {
    if (this.maxed) return;
    this.level++;
    this.invested += this.stats.cost;
    this.refresh();
    this.transform();
  }

  /** 升级变身：先缩成一团白光，换上新造型后弹出来 */
  private transform() {
    const scene = this.battle.stage;
    const sc = this.scale;
    scene.tweens.killTweensOf(this.sprite);
    this.sprite.setTintFill(0xffffff);
    scene.tweens.add({
      targets: this.sprite,
      scaleX: sc * 0.6,
      scaleY: sc * 1.25,
      duration: 110,
      ease: 'Quad.In',
      onComplete: () => {
        this.sprite.setTexture(towerTexture(this.kind, this.level));
        const nsc = this.scale;
        this.sprite.setScale(nsc * 1.35, nsc * 0.75);
        scene.tweens.add({ targets: this.sprite, scaleX: nsc, scaleY: nsc, duration: 380, ease: 'Elastic.Out', easeParams: [1.2, 0.5] });
        scene.time.delayedCall(90, () => {
          if (this.sprite.active && this.stun <= 0) this.sprite.clearTint();
        });
      },
    });
    // 向外扩散的光环 + 向上的光柱
    const ring = scene.add.graphics().setPosition(this.x, this.y).setDepth(this.y + 3);
    ring.lineStyle(5, this.level === 2 ? 0xffd23f : 0xe6ebf5, 1).strokeCircle(0, 0, 34);
    ring.setScale(0.3);
    scene.tweens.add({ targets: ring, scale: 1.6, alpha: 0, duration: 450, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    const beam = scene.add.rectangle(this.x, this.y - 40, 44, 120, this.level === 2 ? 0xfff2a0 : 0xffffff, 0.55).setDepth(this.y + 3);
    scene.tweens.add({ targets: beam, scaleX: 0.1, alpha: 0, duration: 420, ease: 'Cubic.In', onComplete: () => beam.destroy() });
  }

  private refresh() {
    this.stars.setText('★'.repeat(this.level + 1));
    this.drawBase();
  }

  private drawBase() {
    const g = this.base;
    const by = this.y + 20;
    g.clear();
    g.fillStyle(0x000000, 0.16).fillEllipse(this.x, by + 3, 58, 16);
    if (this.level === 1) {
      g.fillStyle(0xd6dbe4, 1).fillEllipse(this.x, by, 56, 16);
      g.lineStyle(3, 0x8a93a6, 1).strokeEllipse(this.x, by, 56, 16);
    } else if (this.level === 2) {
      g.fillStyle(0xffd23f, 1).fillEllipse(this.x, by, 60, 18);
      g.lineStyle(3, 0xb8860b, 1).strokeEllipse(this.x, by, 60, 18);
      g.fillStyle(0xfff4b8, 0.9).fillEllipse(this.x - 10, by - 3, 18, 5);
    }
    // 3 级：底座下方一圈呼吸的金光
    const lv3 = this.level === 2;
    this.glow.setVisible(lv3);
    if (lv3) {
      this.glow.clear().fillStyle(0xfff2a0, 0.5).fillEllipse(this.x, by, 84, 28);
      this.battle.stage.tweens.add({ targets: this.glow, alpha: { from: 0.35, to: 1 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /** 3 级时偶尔冒出小星星 */
  private sparkle(dt: number) {
    if (this.level < 2) return;
    this.sparkleClock += dt;
    if (this.sparkleClock < 1.1) return;
    this.sparkleClock = 0;
    const scene = this.battle.stage;
    const star = scene.add
      .text(this.x + Phaser.Math.Between(-22, 22), this.y - Phaser.Math.Between(10, 30), '✦', { fontSize: '14px', color: '#ffe36b' })
      .setOrigin(0.5)
      .setDepth(this.y + 4);
    scene.tweens.add({ targets: star, y: star.y - 22, alpha: 0, angle: 90, duration: 900, onComplete: () => star.destroy() });
  }

  inRange(e: Enemy) {
    const r = this.stats.range;
    return (e.x - this.x) ** 2 + (e.y - this.y) ** 2 <= r * r;
  }

  /** 选走得最远的目标 */
  private pickTarget(): Enemy | null {
    let best: Enemy | null = null;
    for (const e of this.battle.enemies) {
      if (e.targetable && this.inRange(e) && (!best || e.dist > best.dist)) best = e;
    }
    return best;
  }

  /** 光环效果：在其他塔行动前执行 */
  applyAura() {
    if (this.stun > 0) return;
    const s = this.stats;
    for (const e of this.battle.enemies) {
      if (!e.alive || !this.inRange(e)) continue;
      if (this.kind === 'radar') {
        e.revealed = true;
        e.mark = Math.max(e.mark, 1 + s.extra);
      }
    }
  }

  /** LDO 给范围内的其他塔供电，在所有塔行动前执行 */
  applySupport(towers: Iterable<Tower>) {
    if (this.stun > 0 || this.kind !== 'ldo') return;
    const s = this.stats;
    for (const t of towers) {
      if (t === this || t.kind === 'ldo') continue;
      if ((t.x - this.x) ** 2 + (t.y - this.y) ** 2 > s.range * s.range) continue;
      t.boost = Math.max(t.boost, s.extra);
      t.protect = Math.max(t.protect, LDO_PROTECT[this.level]);
      this.supplied.push(t);
    }
  }

  private supplied: Tower[] = [];

  applySlow() {
    if (this.stun > 0 || this.kind !== 'filter') return;
    for (const e of this.battle.enemies) {
      if (e.targetable && this.inRange(e)) e.slow = Math.min(e.slow, 1 - this.stats.extra);
    }
  }

  update(dt: number) {
    this.fx.clear();
    this.stunIcon.setVisible(this.stun > 0);
    if (this.stun > 0) {
      this.stun -= dt;
      this.sprite.setTint(0x888888);
      this.lockTarget = null;
      return;
    }
    if (this.sprite.tintFill === false) this.sprite.clearTint();
    this.sparkle(dt);
    const power = 1 + this.boost;
    this.cooldown -= dt * power;
    this.pulseClock += dt;
    const s = this.stats;

    switch (this.kind) {
      case 'amp':
      case 'adc':
      case 'mixer': {
        if (this.cooldown > 0) break;
        const t = this.pickTarget();
        if (!t) break;
        this.battle.fireProjectile(this, t);
        this.cooldown = s.interval;
        this.bounce();
        break;
      }
      case 'osc': {
        if (this.cooldown > 0) break;
        const hits = this.battle.enemies.filter((e) => e.targetable && this.inRange(e));
        if (hits.length === 0) break;
        this.battle.ring(this.x, this.y, s.range, this.color);
        // 范围攻击只闪白，不弹伤害数字，避免满屏数字
        for (const e of hits) this.battle.damage(e, s.damage, this, false);
        this.cooldown = s.interval;
        this.bounce();
        break;
      }
      case 'filter': {
        const alpha = 0.12 + Math.sin(this.pulseClock * 3) * 0.04;
        this.fx.fillStyle(this.color, alpha).fillCircle(this.x, this.y, s.range);
        this.fx.lineStyle(2, 0x2f8f5a, 0.35).strokeCircle(this.x, this.y, s.range);
        for (const e of this.battle.enemies) {
          if (e.targetable && this.inRange(e)) this.battle.damage(e, s.damage * power * dt);
        }
        break;
      }
      case 'radar': {
        const a = this.pulseClock * 2.2;
        this.fx.fillStyle(this.color, 0.1).fillCircle(this.x, this.y, s.range);
        this.fx.fillStyle(this.color, 0.22).slice(this.x, this.y, s.range, a, a + 0.6).fillPath();
        break;
      }
      case 'pll': {
        const t = this.lockTarget;
        if (!t || !t.targetable || !this.inRange(t)) {
          this.lockTarget = this.pickTarget();
          this.lockTime = 0;
          if (this.lockTarget) sfx.play('lock');
        }
        const target = this.lockTarget;
        if (!target) break;
        this.lockTime += dt;
        const charge = Math.min(1, this.lockTime / 2.5);
        const mult = 1 + (s.extra - 1) * charge;
        this.battle.damage(target, s.damage * mult * power * dt);
        this.drawBeam(target, charge);
        break;
      }
      case 'comparator': {
        if (this.cooldown > 0) break;
        const t = this.pickStrongest();
        if (!t) break;
        this.decide(t);
        this.cooldown = s.interval;
        this.bounce();
        break;
      }
      case 'ldo': {
        this.drawRails();
        break;
      }
    }
    this.supplied = [];
  }

  /** 选当前血量最多的目标（比较器） */
  private pickStrongest(): Enemy | null {
    let best: Enemy | null = null;
    for (const e of this.battle.enemies) {
      if (e.targetable && this.inRange(e) && (!best || e.hp > best.hp)) best = e;
    }
    return best;
  }

  /** 比较器判决：血量过半输出 1（暴击），否则输出 0（普通伤害）。瞬间命中，不会落空 */
  private decide(t: Enemy) {
    const s = this.stats;
    const high = t.hp >= t.maxHp * 0.5;
    const scene = this.battle.stage;
    const g = scene.add.graphics().setDepth(12500);
    const pts: Phaser.Math.Vector2[] = [];
    const x0 = this.x + 20;
    const y0 = this.y - 6;
    const x1 = t.x;
    const y1 = t.y - 8;
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      const j = i === 0 || i === 6 ? 0 : 9;
      pts.push(new Phaser.Math.Vector2(x0 + (x1 - x0) * k + Phaser.Math.Between(-j, j), y0 + (y1 - y0) * k + Phaser.Math.Between(-j, j)));
    }
    g.lineStyle(high ? 10 : 6, this.color, 0.45).strokePoints(pts);
    g.lineStyle(high ? 4 : 2.5, 0xffffff, 1).strokePoints(pts);
    scene.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });

    const bit = scene.add
      .text(x1, y1 - 34, high ? '1' : '0', {
        fontFamily: 'Courier New', fontSize: high ? '30px' : '20px', fontStyle: 'bold',
        color: high ? '#ffd23f' : '#d6e2f0', stroke: '#3a1a2a', strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(14001);
    scene.tweens.add({ targets: bit, y: bit.y - 24, alpha: 0, duration: 650, ease: 'Cubic.Out', onComplete: () => bit.destroy() });

    sfx.play(high ? 'crit' : 'cmp');
    this.battle.damage(t, high ? s.damage * s.extra : s.damage, this);
  }

  /** LDO：向供电的塔拉出流动的电源轨 */
  private drawRails() {
    const s = this.stats;
    const pulse = 0.5 + Math.sin(this.pulseClock * 4) * 0.2;
    this.fx.lineStyle(2, this.color, 0.25 + pulse * 0.2).strokeCircle(this.x, this.y, s.range);
    for (const t of this.supplied) {
      this.fx.lineStyle(6, this.color, 0.25).lineBetween(this.x, this.y - 6, t.x, t.y - 6);
      this.fx.lineStyle(2, 0xfffbd0, 0.9).lineBetween(this.x, this.y - 6, t.x, t.y - 6);
      // 沿电源轨流动的电荷点
      const k = (this.pulseClock * 1.2) % 1;
      this.fx.fillStyle(0xffffff, 1).fillCircle(this.x + (t.x - this.x) * k, this.y - 6 + (t.y - this.y) * k, 3.5);
    }
  }

  private drawBeam(t: Enemy, charge: number) {
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0xffd08a),
      Phaser.Display.Color.ValueToColor(this.color),
      100,
      charge * 100,
    );
    const c = Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    const sx = this.x;
    const sy = this.y - 10;
    this.fx.setDepth(Math.max(this.y, t.y) + 1);
    this.fx.lineStyle(4 + charge * 6, c, 0.35).lineBetween(sx, sy, t.x, t.y - 6);
    this.fx.lineStyle(2 + charge * 2 + this.level, 0xfff4e0, 0.95).lineBetween(sx, sy, t.x, t.y - 6);
    // 锁定环
    this.fx.lineStyle(2, c, 0.9).strokeCircle(t.x, t.y - 6, 14 - charge * 4);
  }

  private bounce() {
    const sc = this.scale;
    this.sprite.setScale(sc * 1.1, sc * 0.88);
    this.battle.stage.tweens.add({ targets: this.sprite, scaleX: sc, scaleY: sc, duration: 160, ease: 'Back.Out' });
  }

  destroy() {
    this.sprite.destroy();
    this.stars.destroy();
    this.fx.destroy();
    this.stunIcon.destroy();
    this.battle.stage.tweens.killTweensOf(this.glow);
    this.base.destroy();
    this.glow.destroy();
  }
}
