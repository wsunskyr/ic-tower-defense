import Phaser from 'phaser';
import { MAP_Y, WIDTH, HEIGHT, cellCenter } from '../config/map';
import { LEVELS, challengeText, type LevelDef } from '../config/levels';
import { ENDLESS } from '../config/endless';
import { TOWERS } from '../config/towers';
import { drawLevelMap, placeProps } from '../mapRender';
import { isUnlocked, starsOf, totalStars, hasBadge, isEndlessUnlocked, endlessBest, ENDLESS_UNLOCK_LEVEL } from '../progress';
import { FONT, fit, makeButton, type Box } from '../ui';
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
    this.input.keyboard?.on('keydown-ESC', () => {
      codex?.close();
      endless?.close();
    });

    // 左上角：无尽模式
    let endless: { close: () => void } | null = null;
    const open = isEndlessUnlocked();
    const endlessBtn = makeButton(this, 90, 40, 130, 42, open ? '∞ 无尽模式' : '🔒 无尽模式', open ? 0xd0782a : 0x8a8f99, () => {
      if (!open) {
        sfx.play('deny');
        this.toast(`通关第 ${ENDLESS_UNLOCK_LEVEL} 关后开放无尽模式`);
        return;
      }
      endless = this.openEndless(() => (endless = null));
    }, 16);
    void endlessBtn;

    const gap = 18;
    const x0 = (WIDTH - (3 * CARD_W + 2 * gap)) / 2;
    LEVELS.forEach((level, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      this.card(level, x0 + col * (CARD_W + gap), 118 + row * (CARD_H + 16));
    });
  }

  private toast(text: string) {
    const t = this.add
      .text(WIDTH / 2, HEIGHT - 30, text, { fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#2c3a52dd', padding: { x: 14, y: 8 } })
      .setOrigin(0.5)
      .setDepth(60000);
    fit(t, WIDTH - 40);
    this.tweens.add({ targets: t, alpha: 0, delay: 1600, duration: 400, onComplete: () => t.destroy() });
  }

  /** 无尽模式选图：三张横向卡片 */
  private openEndless(onClose: () => void) {
    const parts: Phaser.GameObjects.GameObject[] = [];
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.55).setInteractive().setDepth(30000);
    const g = this.add.graphics().setDepth(30000);
    const pw = 1000;
    const ph = 300;
    const y0 = HEIGHT / 2 - ph / 2;
    g.fillStyle(0xfff4e6, 1).fillRoundedRect(WIDTH / 2 - pw / 2, y0, pw, ph, 26);
    g.lineStyle(5, 0xd0782a, 1).strokeRoundedRect(WIDTH / 2 - pw / 2, y0, pw, ph, 26);
    const title = this.add
      .text(WIDTH / 2 - pw / 2 + 28, y0 + 36, '∞ 无尽模式', { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#b0601a' })
      .setOrigin(0, 0.5)
      .setDepth(30001);
    const tip = this.add
      .text(WIDTH / 2 - pw / 2 + 180, y0 + 38, '全部塔可用 · 20 条命 · 每 10 波来 BOSS · 击败怪物和清波都会加分', { fontFamily: FONT, fontSize: '13px', color: '#8a6a4a' })
      .setOrigin(0, 0.5)
      .setDepth(30001);
    // 说明文字夹在标题和关闭按钮之间
    const tipR = WIDTH / 2 + pw / 2 - 60 - 45 - 12;
    fit(tip, tipR - tip.x, { x: tip.x, y: y0, w: tipR - tip.x, h: 72 });
    parts.push(shade, g, title, tip);
    const close = () => {
      parts.forEach((o) => o.destroy());
      onClose();
    };
    const closeBtn = makeButton(this, WIDTH / 2 + pw / 2 - 60, y0 + 36, 90, 38, '关闭', 0xd0782a, () => close(), 16);
    closeBtn.container.setDepth(30001);
    parts.push(closeBtn.container);
    const gap = 18;
    const x0 = (WIDTH - (3 * CARD_W + 2 * gap)) / 2;
    ENDLESS.forEach((level, i) => {
      parts.push(this.card(level, x0 + i * (CARD_W + gap), y0 + 86).setDepth(30001));
    });
    return { close };
  }

  private card(level: LevelDef, x: number, y: number) {
    const unlocked = level.endless ? isEndlessUnlocked() : isUnlocked(level.id);
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
    const card: Box = { x: -CARD_W / 2 + 8, y: -CARD_H / 2 + 4, w: CARD_W - 16, h: CARD_H - 8 };
    /** 从 x 到 r 之间放一行字 */
    const fitRow = <T extends Phaser.GameObjects.Text>(t: T, r = right) => fit(t, r - t.x, { x: t.x, y: card.y, w: r - t.x, h: card.h });
    const s = starsOf(level.id);
    // 标题行：左边关卡号，右边星星和奖章
    let headR = right;
    if (!level.endless) {
      const starText = this.add
        .text(right, my + 8, '★'.repeat(s) + '☆'.repeat(3 - s), { fontFamily: FONT, fontSize: '15px', color: s > 0 ? '#ffb300' : '#c9b99a' })
        .setOrigin(1, 0.5);
      container.add(starText);
      headR = right - starText.width - 4;
      if (hasBadge(level.id)) {
        const medal = this.add.text(headR, my + 8, '🏅', { fontSize: '15px' }).setOrigin(1, 0.5);
        container.add(medal);
        headR -= medal.width + 2;
      }
    }
    container.add(
      fitRow(this.add.text(rx, my + 8, level.endless ? '无尽模式' : `第 ${level.id} 关`, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#a08a5a' }).setOrigin(0, 0.5), headR - 4),
    );
    container.add(
      fitRow(this.add.text(rx, my + 32, level.name, { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: '#4a3a1a' }).setOrigin(0, 0.5)),
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
        fitRow(
          this.add
            .text(rx + tagText.width + 36, tagY, TOWERS[level.unlock].name, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#6b5a3a' })
            .setOrigin(0, 0.5),
        ),
      );
    }
    const boss = level.endless || level.waves.some((w) => w.some((grp) => grp.kind === 'esd'));
    const best = level.endless ? endlessBest(level.id) : null;
    const info = level.endless
      ? best
        ? `最高 ${best.wave} 波 · ${best.score} 分`
        : '还没有纪录'
      : `${level.waves.length} 波${level.paths.length > 1 ? ' · 双入口' : ''}${boss ? ' · BOSS' : ''}`;
    container.add(
      fitRow(
        this.add
          .text(rx, my + 84, info, {
            fontFamily: FONT, fontSize: '12px', fontStyle: level.endless ? 'bold' : 'normal', color: level.endless ? '#b0601a' : boss ? '#c6331f' : '#8a7a5a',
          })
          .setOrigin(0, 0.5),
      ),
    );
    // 通关后底部改为显示可选挑战
    const ch = level.challenge;
    const showChallenge = ch && s > 0;
    const done = hasBadge(level.id);
    container.add(
      fitRow(
        this.add
          .text(-CARD_W / 2 + 12, my + MINI_H + 15, showChallenge ? `${done ? '🏅 挑战完成' : '挑战'}：${challengeText(ch)}` : level.subtitle, {
            fontFamily: FONT, fontSize: '12px', fontStyle: showChallenge ? 'bold' : 'normal', color: showChallenge ? (done ? '#b8860b' : '#8a5a2a') : '#8a7a5a',
          })
          .setOrigin(0, 0.5),
      ),
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
        fit(this.add
          .text(lx, ly + 24, level.endless ? `通关第 ${ENDLESS_UNLOCK_LEVEL} 关解锁` : '通过上一关解锁', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#3a3f4c', strokeThickness: 4 })
          .setOrigin(0.5), MINI_W - 8),
      );
      zone.on('pointerdown', () => {
        sfx.play('deny');
        this.tweens.add({ targets: container, x: cx + 6, duration: 50, yoyo: true, repeat: 2 });
      });
      return container;
    }

    zone.on('pointerover', () => this.tweens.add({ targets: container, scale: 1.04, duration: 120 }));
    zone.on('pointerout', () => this.tweens.add({ targets: container, scale: 1, duration: 120 }));
    zone.on('pointerdown', () => {
      sfx.play('click');
      this.scene.start('Game', { levelId: level.id });
    });
    return container;
  }
}
