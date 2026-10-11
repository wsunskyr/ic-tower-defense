import Phaser from 'phaser';
import type { EnemyDef } from '../config/enemies';
import type { PathTrack } from '../config/map';

const FLASH_DURATION = 0.12;

export class Enemy {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly baseScale: number;
  private wobble = Math.random() * Math.PI * 2;

  dist: number;
  hp: number;
  readonly maxHp: number;
  x = 0;
  y = 0;
  dead = false;
  reached = false;

  /** 每帧由塔的光环重新计算 */
  slow = 1;
  mark = 1;
  revealed = true;

  partner: Enemy | null = null;
  /** ESD 放电计时 */
  abilityTimer = 0;

  private flashTime = 0;
  /** 闪白冷却，避免被连续命中时一直是白的 */
  private flashCooldown = 0;
  private kickX = 0;
  private kickY = 0;
  private whiteFlash = false;

  constructor(
    scene: Phaser.Scene,
    readonly def: EnemyDef,
    hpScale: number,
    private readonly track: PathTrack,
    startDist = 0,
  ) {
    this.dist = startDist;
    this.maxHp = Math.round(def.hp * hpScale);
    this.hp = this.maxHp;
    this.sprite = scene.add.image(0, 0, def.kind);
    this.baseScale = def.size / this.sprite.width;
    this.sprite.setScale(this.baseScale);
    this.bar = scene.add.graphics();
    this.place(0);
  }

  get alive() {
    return !this.dead && !this.reached;
  }

  /** 是否能被塔选中 */
  get targetable() {
    return this.alive && this.revealed && this.dist > 0;
  }

  update(dt: number) {
    this.dist += this.def.speed * this.slow * dt;
    if (this.dist >= this.track.total) this.reached = true;
    this.place(dt);
  }

  private place(dt: number) {
    const p = this.track.pointAt(this.dist);
    this.x = p.x;
    this.y = p.y;
    this.wobble += dt * (this.def.boss ? 3 : 9) * this.slow;

    // 受击反馈：闪白、挤压、后退位移，都随时间衰减
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.flashCooldown = Math.max(0, this.flashCooldown - dt);
    const k = this.flashTime / FLASH_DURATION;
    let ox = this.kickX * k;
    let oy = Math.abs(Math.sin(this.wobble)) * -4 + this.kickY * k;
    if (this.def.dodge) {
      ox += Phaser.Math.Between(-3, 3);
      oy += Phaser.Math.Between(-3, 3);
    }
    this.sprite.setPosition(this.x + ox, this.y - 6 + oy);
    this.sprite.setRotation(Math.sin(this.wobble) * 0.08);
    this.sprite.setScale(this.baseScale * (1 + 0.14 * k), this.baseScale * (1 - 0.12 * k));
    if (p.dx !== 0) this.sprite.setFlipX(p.dx < 0);
    this.sprite.setDepth(this.y);
    this.sprite.setAlpha(this.def.stealth && !this.revealed ? 0.22 : 1);
    if (k > 0.5 && this.whiteFlash) this.sprite.setTintFill(0xffffff);
    else this.sprite.setTint(this.slow < 1 ? 0xb8f0ff : 0xffffff);

    this.bar.clear();
    if (this.hp < this.maxHp && this.revealed) {
      const w = this.def.boss ? 90 : 36;
      const top = this.y - 6 - this.def.size / 2 - 10;
      this.bar.fillStyle(0x000000, 0.45).fillRoundedRect(this.x - w / 2 - 1, top - 1, w + 2, 7, 3);
      const ratio = Math.max(0, this.hp / this.maxHp);
      const color = ratio > 0.5 ? 0x5ee36a : ratio > 0.25 ? 0xffc93c : 0xff5a5a;
      this.bar.fillStyle(color, 1).fillRoundedRect(this.x - w / 2, top, w * ratio, 5, 2);
      if (this.mark > 1) this.bar.fillStyle(0x9aa7ff, 1).fillCircle(this.x + w / 2 + 6, top + 2, 3);
      this.bar.setDepth(10000);
    }
  }

  /** 受击反馈；(fromX, fromY) 为攻击来源，用于计算后退方向 */
  flash(fromX?: number, fromY?: number) {
    this.flashTime = FLASH_DURATION;
    this.whiteFlash = this.flashCooldown <= 0;
    if (this.whiteFlash) this.flashCooldown = this.def.boss ? 0.5 : 0.25;
    if (fromX === undefined || fromY === undefined) {
      this.kickX = 0;
      this.kickY = 0;
      return;
    }
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const force = this.def.boss ? 2 : 6;
    this.kickX = (dx / d) * force;
    this.kickY = (dy / d) * force;
  }

  destroy() {
    this.sprite.destroy();
    this.bar.destroy();
  }
}
