import Phaser from 'phaser';
import { propStats, type PropDef } from '../config/levels';
import { TOWERS } from '../config/towers';
import { cellCenter, cellKey } from '../config/map';

/**
 * 地图上的元件障碍物。玩家点击标记（集火）后，射程内的塔会优先攻击它；
 * 拆掉后获得能量，空出的格子可以建塔，有的还藏着一座免费的塔。
 */
export class Obstacle {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly giftIcon: Phaser.GameObjects.Text | null;
  private readonly baseScale: number;
  readonly key: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly maxHp: number;
  readonly reward: number;
  hp: number;
  dead = false;
  /** 塔挑目标时和怪物统一比较用，障碍物不在走线上 */
  readonly dist = 0;
  private shake = 0;

  constructor(
    scene: Phaser.Scene,
    readonly def: PropDef,
    levelId: number,
  ) {
    const p = cellCenter(def.c, def.r);
    this.x = p.x;
    this.y = p.y;
    this.key = cellKey(def.c, def.r);
    const s = propStats(def.kind, levelId);
    this.name = s.name;
    this.maxHp = s.hp;
    this.hp = s.hp;
    this.reward = s.reward;
    this.sprite = scene.add.image(p.x, p.y - 4, `prop-${def.kind}`);
    this.baseScale = 56 / this.sprite.width;
    this.sprite.setScale(this.baseScale).setDepth(p.y);
    this.bar = scene.add.graphics().setDepth(10000);
    this.giftIcon = def.gift
      ? scene.add.text(p.x + 20, p.y - 24, '🎁', { fontSize: '16px' }).setOrigin(0.5).setDepth(p.y + 1)
      : null;
  }

  get gift() {
    return this.def.gift ? TOWERS[this.def.gift] : null;
  }

  get alive() {
    return !this.dead;
  }

  get targetable() {
    return !this.dead;
  }

  /** 被打中时抖一下 */
  flash() {
    this.shake = 0.15;
    this.sprite.setTintFill(0xffffff);
  }

  update(dt: number) {
    if (this.shake > 0) {
      this.shake -= dt;
      this.sprite.setX(this.x + Math.sin(this.shake * 90) * 3);
      if (this.shake < 0.08) this.sprite.clearTint();
    } else this.sprite.setX(this.x);
    this.bar.clear();
    if (this.hp < this.maxHp) {
      const w = 44;
      const top = this.y - 36;
      this.bar.fillStyle(0x000000, 0.45).fillRoundedRect(this.x - w / 2 - 1, top - 1, w + 2, 7, 3);
      this.bar.fillStyle(0xffb13c, 1).fillRoundedRect(this.x - w / 2, top, w * Math.max(0, this.hp / this.maxHp), 5, 2);
    }
  }

  destroy() {
    this.dead = true;
    this.sprite.destroy();
    this.bar.destroy();
    this.giftIcon?.destroy();
  }
}
