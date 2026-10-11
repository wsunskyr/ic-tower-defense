import Phaser from 'phaser';
import { MAP_Y, WIDTH, HEIGHT, cellCenter } from '../config/map';
import { LEVELS, type LevelDef } from '../config/levels';
import { TOWERS } from '../config/towers';
import { drawLevelMap, placeProps } from '../mapRender';
import { isUnlocked, starsOf, totalStars } from '../progress';
import { FONT, makeButton } from '../ui';
import { openCodex } from '../codex';
import { sfx, music } from '../audio';
import { RES, setupCamera } from '../display';

const CARD_W = 314;
const CARD_H = 142;
const MINI_W = 160;
const MINI_SCALE = MINI_W / WIDTH;
const MINI_H = (HEIGHT - MAP_Y) * MINI_SCALE;

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    setupCamera(this);
    this.input.on('pointerdown', () => sfx.unlock());
    music.play('menu');

    const bg = this.add.graphics();
    bg.fillStyle(0xa8dc8f, 1).fillRect(0, 0, WIDTH, HEIGHT);
    const rnd = new Phaser.Math.RandomDataGenerator(['menu']);
    for (let i = 0; i < 30; i++) {
      bg.fillStyle(0xbde7a6, 0.8).fillEllipse(rnd.between(0, WIDTH), rnd.between(0, HEIGHT), rnd.between(80, 180), rnd.between(40, 80));
    }

    const core = this.add.image(WIDTH / 2 - 170, 52, 'core');
    core.setScale(78 / core.width);
    this.tweens.add({ targets: core, y: 44, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.add
      .text(WIDTH / 2 + 20, 44, '芯片保卫战', { fontFamily: FONT, fontSize: '46px', fontStyle: 'bold', color: '#ffffff', stroke: '#2a6fb8', strokeThickness: 10 })
      .setOrigin(0.5);
    this.add
      .text(WIDTH / 2 + 20, 88, `IC Tower Defense    ★ ${totalStars()}/${LEVELS.length * 3}`, { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#2f6a3a' })
      .setOrigin(0.5);

    // 右上角：图鉴、音乐开关
    let codex: { close: () => void } | null = null;
    makeButton(this, WIDTH - 90, 40, 130, 42, '📖 怪物图鉴', 0x6a55b5, () => {
      codex = openCodex(this, () => (codex = null));
    }, 16);
    const onOff = (on: boolean) => (on ? '♪ 音乐 开' : '♪ 音乐 关');
    const musicBtn = makeButton(this, WIDTH - 90, 92, 130, 38, onOff(music.enabled), 0x5c6b85, () => musicBtn.setLabel(onOff(music.toggle())), 15);
    this.input.keyboard?.on('keydown-ESC', () => codex?.close());

    const gap = 18;
    const x0 = (WIDTH - (3 * CARD_W + 2 * gap)) / 2;
    LEVELS.forEach((level, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      this.card(level, x0 + col * (CARD_W + gap), 118 + row * (CARD_H + 16));
    });
  }

  private card(level: LevelDef, x: number, y: number) {
    const unlocked = isUnlocked(level.id);
    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2;
    const container = this.add.container(cx, cy);

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.18).fillRoundedRect(-CARD_W / 2, -CARD_H / 2 + 5, CARD_W, CARD_H, 18);
    bg.fillStyle(0xfffaf0, 1).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    bg.lineStyle(4, unlocked ? 0xe4bf7a : 0xb8b8b8, 1).strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    container.add(bg);

    // 地图缩略图：先在游戏坐标系里画，缩放后烘焙进 RenderTexture，超出部分自然被裁掉。
    // RenderTexture 按 RES 倍尺寸烘焙再缩回去，否则在高分辨率画布上会糊
    const mx = -CARD_W / 2 + 10;
    const my = -CARD_H / 2 + 10;
    const bake = MINI_SCALE * RES;
    const rt = this.add.renderTexture(mx, my, MINI_W * RES, MINI_H * RES).setOrigin(0).setScale(1 / RES);
    const mini = this.add.graphics();
    drawLevelMap(mini, level, false);
    mini.setScale(bake).setPosition(0, -MAP_Y * bake);
    rt.draw(mini);
    mini.destroy();
    for (const img of placeProps(this, level, 0, -MAP_Y * bake, bake)) {
      rt.draw(img);
      img.destroy();
    }
    container.add(rt);
    const frame = this.add.graphics();
    frame.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(mx, my, MINI_W, MINI_H, 8);
    container.add(frame);
    const last = level.paths[0][level.paths[0].length - 1];
    const end = cellCenter(last[0], last[1]);
    const coreIcon = this.add.image(mx + end.x * MINI_SCALE, my + (end.y - MAP_Y) * MINI_SCALE, 'core');
    coreIcon.setScale(20 / coreIcon.width);
    container.add(coreIcon);

    // 右侧信息栏
    const rx = mx + MINI_W + 12;
    const right = CARD_W / 2 - 12;
    container.add(
      this.add.text(rx, my + 8, `第 ${level.id} 关`, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#a08a5a' }).setOrigin(0, 0.5),
    );
    const s = starsOf(level.id);
    container.add(
      this.add
        .text(right, my + 8, '★'.repeat(s) + '☆'.repeat(3 - s), { fontFamily: FONT, fontSize: '15px', color: s > 0 ? '#ffb300' : '#c9b99a' })
        .setOrigin(1, 0.5),
    );
    container.add(
      this.add.text(rx, my + 32, level.name, { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#4a3a1a' }).setOrigin(0, 0.5),
    );
    // 新解锁的塔；第 1 关显示两座基础塔
    const shown = level.unlock ? [level.unlock] : level.id === 1 ? level.towers : [];
    const tagY = my + 60;
    const tag = level.unlock ? '解锁' : level.id === 1 ? '基础' : '全部塔';
    const tagText = this.add.text(rx, tagY, tag, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#d0782a' }).setOrigin(0, 0.5);
    container.add(tagText);
    shown.forEach((kind, i) => {
      const icon = this.add.image(rx + tagText.width + 18 + i * 28, tagY, kind);
      icon.setScale(26 / icon.width);
      container.add(icon);
    });
    if (level.unlock) {
      container.add(
        this.add
          .text(rx + tagText.width + 36, tagY, TOWERS[level.unlock].name, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#6b5a3a' })
          .setOrigin(0, 0.5),
      );
    }
    const boss = level.waves.some((w) => w.some((grp) => grp.kind === 'esd'));
    container.add(
      this.add
        .text(rx, my + 84, `${level.waves.length} 波${level.paths.length > 1 ? ' · 双入口' : ''}${boss ? ' · BOSS' : ''}`, {
          fontFamily: FONT, fontSize: '12px', color: boss ? '#c6331f' : '#8a7a5a',
        })
        .setOrigin(0, 0.5),
    );
    container.add(
      this.add
        .text(-CARD_W / 2 + 12, my + MINI_H + 15, level.subtitle, { fontFamily: FONT, fontSize: '12px', color: '#8a7a5a' })
        .setOrigin(0, 0.5),
    );

    const zone = this.add.zone(0, 0, CARD_W, CARD_H).setInteractive({ useHandCursor: unlocked });
    container.add(zone);

    if (!unlocked) {
      const lock = this.add.graphics();
      lock.fillStyle(0x3a3f4c, 0.4).fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
      container.add(lock);
      // 锁放在缩略图上，右侧的解锁预告保持可读
      const lx = -CARD_W / 2 + 10 + MINI_W / 2;
      const ly = -CARD_H / 2 + 10 + MINI_H / 2;
      container.add(this.add.text(lx, ly - 10, '🔒', { fontSize: '30px' }).setOrigin(0.5));
      container.add(
        this.add
          .text(lx, ly + 24, '通过上一关解锁', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#3a3f4c', strokeThickness: 4 })
          .setOrigin(0.5),
      );
      zone.on('pointerdown', () => {
        sfx.play('deny');
        this.tweens.add({ targets: container, x: cx + 6, duration: 50, yoyo: true, repeat: 2 });
      });
      return;
    }

    zone.on('pointerover', () => this.tweens.add({ targets: container, scale: 1.04, duration: 120 }));
    zone.on('pointerout', () => this.tweens.add({ targets: container, scale: 1, duration: 120 }));
    zone.on('pointerdown', () => {
      sfx.play('click');
      this.scene.start('Game', { levelId: level.id });
    });
  }
}
