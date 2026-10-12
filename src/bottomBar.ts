import Phaser from 'phaser';
import { WIDTH, MAP_BOTTOM, BAR_H } from './config/map';
import { ENEMIES, type EnemyKind } from './config/enemies';
import type { WaveDef } from './config/waves';
import { hasSeen } from './progress';
import { FONT, fit } from './ui';
import { sfx } from './audio';

export type SkillId = 'fan' | 'reset' | 'power';

export interface SkillDef {
  id: SkillId;
  icon: string;
  name: string;
  key: string;
  /** 冷却（游戏内秒，只在波次进行时计时） */
  cooldown: number;
  desc: string;
}

export const SKILLS: SkillDef[] = [
  { id: 'fan', icon: '🌀', name: '散热风扇', key: 'Q', cooldown: 35, desc: '全场怪物减速 50%，持续 5 秒' },
  { id: 'reset', icon: '🔁', name: '系统复位', key: 'W', cooldown: 50, desc: '全场怪物定住 2 秒，并解除所有塔的瘫痪' },
  { id: 'power', icon: '🔋', name: '紧急供电', key: 'E', cooldown: 60, desc: '立即获得能量，代价是扣 1 点生命' },
];

const CY = MAP_BOTTOM + BAR_H / 2;
const SKILL_W = 150;
const SKILL_H = 40;

interface SkillButton {
  def: SkillDef;
  container: Phaser.GameObjects.Container;
  shade: Phaser.GameObjects.Graphics;
  /** 冷却时隐藏名字和快捷键，换成倒计时 */
  idle: Phaser.GameObjects.Text[];
  cdText: Phaser.GameObjects.Text;
  remaining: number;
}

/**
 * 底部工具栏：左边三个主动技能，右边下一波预告。
 * 技能效果由 GameScene 实现（onUse 返回 false 表示现在不能用）。
 */
export class BottomBar {
  private readonly buttons: SkillButton[] = [];
  private readonly preview: Phaser.GameObjects.Container;
  private readonly tip: Phaser.GameObjects.Text;
  private previewKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onUse: (id: SkillId) => boolean,
  ) {
    const g = scene.add.graphics().setDepth(20000);
    g.fillStyle(0x1d2738, 1).fillRect(0, MAP_BOTTOM, WIDTH, 4);
    g.fillStyle(0x2c3a52, 1).fillRect(0, MAP_BOTTOM + 4, WIDTH, BAR_H - 4);

    SKILLS.forEach((def, i) => this.buttons.push(this.makeSkill(def, 14 + SKILL_W / 2 + i * (SKILL_W + 8))));
    this.preview = scene.add.container(0, 0).setDepth(20001);
    // 技能说明：悬停时显示在按钮上方
    this.tip = scene.add
      .text(0, MAP_BOTTOM - 8, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#2c3a52ee', padding: { x: 8, y: 5 } })
      .setOrigin(0, 1)
      .setDepth(25000)
      .setVisible(false);
  }

  private makeSkill(def: SkillDef, x: number): SkillButton {
    const s = this.scene;
    const bg = s.add.graphics();
    bg.fillStyle(0x000000, 0.25).fillRoundedRect(-SKILL_W / 2, -SKILL_H / 2 + 3, SKILL_W, SKILL_H, 12);
    bg.fillStyle(0x4a5a78, 1).fillRoundedRect(-SKILL_W / 2, -SKILL_H / 2, SKILL_W, SKILL_H, 12);
    bg.lineStyle(2, 0xffffff, 0.35).strokeRoundedRect(-SKILL_W / 2 + 2, -SKILL_H / 2 + 2, SKILL_W - 4, SKILL_H - 4, 10);
    const label = s.add
      .text(-SKILL_W / 2 + 12, 0, `${def.icon} ${def.name}`, { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0, 0.5);
    const key = s.add
      .text(SKILL_W / 2 - 10, 0, def.key, { fontFamily: 'Arial', fontSize: '12px', fontStyle: 'bold', color: '#2c3a52', backgroundColor: '#ffe14d', padding: { x: 4, y: 1 } })
      .setOrigin(1, 0.5);
    const box = { x: -SKILL_W / 2 + 8, y: -SKILL_H / 2, w: SKILL_W - 16, h: SKILL_H };
    fit(label, SKILL_W - 24 - key.width - 8, box);
    // 冷却遮罩：从右往左褪去
    const shade = s.add.graphics();
    const cdText = s.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#c8d2e6' })
      .setOrigin(0.5);
    const zone = s.add.zone(0, 0, SKILL_W, SKILL_H).setInteractive({ useHandCursor: true });
    const container = s.add.container(x, CY, [bg, label, key, shade, cdText, zone]).setDepth(20002);
    const btn: SkillButton = { def, container, shade, idle: [label, key], cdText, remaining: 0 };
    zone.on('pointerover', () => {
      this.tip.setText(`${def.icon} ${def.name}（${def.key}）：${def.desc}\n冷却 ${def.cooldown} 秒，只在波次进行时计时`);
      this.tip.setX(Math.min(x - SKILL_W / 2, WIDTH - this.tip.width - 8)).setVisible(true);
      if (btn.remaining <= 0) container.setScale(1.04);
    });
    zone.on('pointerout', () => {
      this.tip.setVisible(false);
      container.setScale(1);
    });
    zone.on('pointerdown', () => this.use(def.id));
    return btn;
  }

  /** 点按钮或按快捷键 */
  use(id: SkillId) {
    const b = this.buttons.find((x) => x.def.id === id)!;
    if (b.remaining > 0 || !this.onUse(id)) {
      sfx.play('deny');
      this.scene.tweens.add({ targets: b.container, x: b.container.x + 4, duration: 40, yoyo: true, repeat: 2 });
      return;
    }
    b.remaining = b.def.cooldown;
    this.draw(b);
  }

  /** 冷却计时；dt 为游戏内秒 */
  tick(dt: number) {
    for (const b of this.buttons) {
      if (b.remaining <= 0) continue;
      b.remaining = Math.max(0, b.remaining - dt);
      this.draw(b);
    }
  }

  private draw(b: SkillButton) {
    b.shade.clear();
    const cooling = b.remaining > 0;
    b.idle.forEach((t) => t.setVisible(!cooling));
    fit(b.cdText.setText(cooling ? `${b.def.icon} 冷却 ${Math.ceil(b.remaining)}s` : ''), SKILL_W - 16, { x: -SKILL_W / 2 + 8, y: -SKILL_H / 2, w: SKILL_W - 16, h: SKILL_H });
    if (!cooling) return;
    const k = b.remaining / b.def.cooldown;
    b.shade.fillStyle(0x000000, 0.55).fillRoundedRect(-SKILL_W / 2, -SKILL_H / 2, SKILL_W * k, SKILL_H, { tl: 12, bl: 12, tr: k > 0.95 ? 12 : 0, br: k > 0.95 ? 12 : 0 });
  }

  /**
   * 下一波预告：怪物图标 × 数量。没见过的怪物显示剪影，留给图鉴去发现。
   * wave 为 null 表示没有下一波了。
   */
  setPreview(label: string, wave: WaveDef | null) {
    const key = `${label}|${JSON.stringify(wave)}`;
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.preview.removeAll(true);
    const s = this.scene;
    const counts = new Map<EnemyKind, number>();
    for (const grp of wave ?? []) {
      const n = grp.count * (ENEMIES[grp.kind].linked ? 2 : 1);
      counts.set(grp.kind, (counts.get(grp.kind) ?? 0) + n);
    }
    // 从右往左排，右边对齐
    let x = WIDTH - 16;
    const items = [...counts].reverse();
    for (const [kind, n] of items) {
      const def = ENEMIES[kind];
      const num = s.add
        .text(x, CY, `×${n}`, { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: def.boss ? '#ff8c8c' : '#ffffff' })
        .setOrigin(1, 0.5);
      x -= num.width + 2;
      const icon = s.add.image(x - 15, CY, kind);
      icon.setScale(30 / Math.max(icon.width, icon.height));
      if (!hasSeen(kind)) icon.setTintFill(0x8a94aa);
      x -= 30 + 12;
      this.preview.add([num, icon]);
    }
    const text = s.add
      .text(x, CY, wave ? label : '没有下一波了', { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#9fc3ff' })
      .setOrigin(1, 0.5);
    this.preview.add(text);
  }
}
