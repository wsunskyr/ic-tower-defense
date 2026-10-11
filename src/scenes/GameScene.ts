import Phaser from 'phaser';
import { CELL, MAP_Y, WIDTH, HEIGHT, PathTrack, cellAt, cellCenter, cellKey } from '../config/map';
import { TOWERS, TOWER_ORDER, statText, type TowerKind } from '../config/towers';
import { LEVELS, getLevel, type LevelDef } from '../config/levels';
import { blockedCells, drawLevelMap, placeProps } from '../mapRender';
import { recordWin } from '../progress';
import { ENEMIES, ESD_DISCHARGE, type EnemyKind } from '../config/enemies';
import { waveBonus } from '../config/waves';
import { Enemy } from '../entities/Enemy';
import { Tower, towerTexture, type Battle } from '../entities/Tower';
import { FONT, makeButton, type Button } from '../ui';
import { sfx, type SfxName } from '../audio';
import { setupCamera } from '../display';

type State = 'build' | 'wave' | 'won' | 'lost';

interface Projectile {
  obj: Phaser.GameObjects.Arc | Phaser.GameObjects.Text;
  tower: Tower;
  target: Enemy;
  damage: number;
  /** 混频器分出的边带子弹：更小，命中后不再继续分裂 */
  sideband?: boolean;
  /** 拖尾计时 */
  trail: number;
}

const PROJECTILE_SPEED = 520;

export class GameScene extends Phaser.Scene implements Battle {
  // 战场状态（scene.restart 不会重新执行构造函数，因此在 create 里初始化）
  enemies: Enemy[] = [];
  private towers = new Map<string, Tower>();
  private projectiles: Projectile[] = [];
  private level!: LevelDef;
  private tracks: PathTrack[] = [];
  private blocked!: Set<string>;
  private energy = 0;
  private lives = 0;
  private waveIndex = 0;
  private state: State = 'build';
  private speed = 1;
  private paused = false;
  private spawnQueue: { t: number; kind: EnemyKind; path: number }[] = [];
  private waveClock = 0;
  private seen = new Set<EnemyKind>();
  private banners: Phaser.GameObjects.Container[] = [];
  /** 顿帧剩余时间（真实秒），期间战斗逻辑暂停 */
  private hitstop = 0;
  private damageTexts = 0;

  // 显示对象
  private core!: Phaser.GameObjects.Image;
  private coreScale = 1;
  private hoverG!: Phaser.GameObjects.Graphics;
  private linkG!: Phaser.GameObjects.Graphics;
  private menu: Phaser.GameObjects.Container | null = null;
  private menuCell: string | null = null;
  /** 当前菜单的快捷键动作 */
  private menuKeys: { build?: (i: number) => void; upgrade?: () => void; sell?: () => void } = {};
  private energyText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private startBtn!: Button;
  private speedBtn!: Button;
  private pauseBtn!: Button;
  private pauseLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  get stage(): Phaser.Scene {
    return this;
  }

  init(data: { levelId?: number }) {
    this.level = getLevel(data.levelId ?? 1);
  }

  create() {
    setupCamera(this);
    this.enemies = [];
    this.towers = new Map();
    this.projectiles = [];
    this.tracks = this.level.paths.map((wps) => new PathTrack(wps));
    this.blocked = blockedCells(this.level);
    this.energy = this.level.startEnergy;
    this.lives = this.level.lives;
    this.waveIndex = 0;
    this.state = 'build';
    this.speed = 1;
    this.paused = false;
    this.spawnQueue = [];
    this.seen = new Set();
    this.banners = [];
    this.hitstop = 0;
    this.damageTexts = 0;
    this.menu = null;
    this.menuCell = null;
    this.menuKeys = {};
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;

    this.drawMap();
    this.createCore();
    this.hoverG = this.add.graphics().setDepth(5);
    this.linkG = this.add.graphics().setDepth(9000);
    this.createHud();
    this.bindInput();
    this.banner(`第${this.level.id}关「${this.level.name}」：${this.level.subtitle}`, 0x2a6fb8, 3500);
    const unlock = this.level.unlock;
    if (unlock) this.banner(`新塔解锁「${TOWERS[unlock].name}」：${TOWERS[unlock].desc}`, 0xd0782a, 5000, unlock);
    if (this.level.id === 1) this.banner('点击空地建造防御塔，准备好后点「开始」', 0x3c8fb8, 5000);
  }

  // ───────────────────────── 地图 ─────────────────────────

  private drawMap() {
    drawLevelMap(this.add.graphics().setDepth(0), this.level);
    placeProps(this, this.level);
  }

  private createCore() {
    const pts = this.tracks[0].points;
    const end = pts[pts.length - 1];
    this.core = this.add.image(end.x, end.y - 6, 'core').setDepth(end.y);
    this.coreScale = 88 / this.core.width;
    this.core.setScale(this.coreScale);
    this.tweens.add({ targets: this.core, y: end.y - 12, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  // ───────────────────────── HUD ─────────────────────────

  private createHud() {
    const g = this.add.graphics().setDepth(20000);
    g.fillStyle(0x2c3a52, 1).fillRect(0, 0, WIDTH, MAP_Y);
    g.fillStyle(0x1d2738, 1).fillRect(0, MAP_Y - 4, WIDTH, 4);

    const style = { fontFamily: FONT, fontSize: '22px', color: '#ffffff', fontStyle: 'bold' };
    const pill = (x: number, w: number) => g.fillStyle(0x000000, 0.25).fillRoundedRect(x, 14, w, 36, 18);
    pill(14, 130);
    pill(156, 100);
    pill(268, 150);
    this.energyText = this.add.text(30, 32, '', { ...style, color: '#ffe14d' }).setOrigin(0, 0.5).setDepth(20001);
    this.livesText = this.add.text(172, 32, '', { ...style, color: '#ff8c8c' }).setOrigin(0, 0.5).setDepth(20001);
    this.waveText = this.add.text(284, 32, '', style).setOrigin(0, 0.5).setDepth(20001);

    this.add
      .text(WIDTH / 2 - 26, 32, `第${this.level.id}关 ${this.level.name}`, { fontFamily: FONT, fontSize: '18px', color: '#9fc3ff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(20001);

    this.startBtn = makeButton(this, WIDTH - 280, 32, 150, 40, '▶ 开始第 1 波', 0x3cb35a, () => this.startWave());
    this.speedBtn = makeButton(this, WIDTH - 160, 32, 70, 40, '1x', 0x4f7fd1, () => this.toggleSpeed());
    this.pauseBtn = makeButton(this, WIDTH - 70, 32, 90, 40, '暂停', 0xe08a2e, () => this.togglePause());
    const muteBtn = makeButton(this, WIDTH - 384, 32, 48, 40, sfx.muted ? '🔇' : '🔊', 0x5c6b85, () => muteBtn.setLabel(sfx.toggleMute() ? '🔇' : '🔊'), 18);
    const menuBtn = makeButton(this, WIDTH - 436, 32, 48, 40, '☰', 0x5c6b85, () => this.scene.start('Menu'), 20);
    for (const b of [this.startBtn, this.speedBtn, this.pauseBtn, muteBtn, menuBtn]) b.container.setDepth(20002);

    this.pauseLabel = this.add
      .text(WIDTH / 2, HEIGHT / 2, '已暂停', { fontFamily: FONT, fontSize: '48px', color: '#ffffff', fontStyle: 'bold', stroke: '#2c3a52', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(30000)
      .setVisible(false);
    this.refreshHud();
  }

  private refreshHud() {
    this.energyText.setText(`⚡ ${Math.floor(this.energy)}`);
    this.livesText.setText(`❤ ${this.lives}`);
    this.waveText.setText(`波次 ${this.waveIndex}/${this.level.waves.length}`);
    const canStart = this.state === 'build';
    this.startBtn.setEnabled(canStart);
    this.startBtn.setLabel(canStart ? `▶ 开始第 ${this.waveIndex + 1} 波` : '战斗中…');
  }

  private toggleSpeed() {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.tweens.timeScale = this.speed;
    this.time.timeScale = this.speed;
    this.speedBtn.setLabel(`${this.speed}x`);
  }

  private togglePause() {
    if (this.state === 'won' || this.state === 'lost') return;
    this.paused = !this.paused;
    if (this.paused) {
      this.tweens.pauseAll();
      this.time.paused = true;
    } else {
      this.tweens.resumeAll();
      this.time.paused = false;
    }
    this.pauseBtn.setLabel(this.paused ? '继续' : '暂停');
    this.pauseLabel.setVisible(this.paused);
  }

  // ───────────────────────── 输入与菜单 ─────────────────────────

  private bindInput() {
    this.input.on('pointerdown', () => sfx.unlock());
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hoverG.clear();
      if (this.isOver()) return;
      const cell = cellAt(p.worldX, p.worldY);
      if (!cell) return;
      const key = cellKey(cell.c, cell.r);
      if (this.blocked.has(key)) return;
      const has = this.towers.has(key);
      this.hoverG.lineStyle(3, 0xffffff, has ? 0.5 : 0.8).strokeRoundedRect(cell.c * CELL + 3, MAP_Y + cell.r * CELL + 3, CELL - 6, CELL - 6, 12);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0 || this.isOver() || this.paused) return;
      const cell = cellAt(p.worldX, p.worldY);
      const key = cell ? cellKey(cell.c, cell.r) : null;
      const sameCell = key !== null && key === this.menuCell;
      this.closeMenu();
      if (!cell || !key || sameCell || this.blocked.has(key)) return;
      const tower = this.towers.get(key);
      if (tower) this.openTowerMenu(tower);
      else this.openBuildMenu(cell.c, cell.r);
    });
  }

  /**
   * 快捷键：空格 开波/暂停，F 倍速，P 暂停，Esc 关菜单，
   * 建造菜单里 1~9 建塔，塔菜单里 U 升级、S 出售
   */
  private onKey(ev: KeyboardEvent) {
    if (this.isOver()) return;
    sfx.unlock();
    const k = ev.key.toLowerCase();
    if (k === ' ') {
      ev.preventDefault();
      if (this.state === 'build' && !this.paused) this.startWave();
      else this.togglePause();
    } else if (k === 'p') this.togglePause();
    else if (this.paused) return;
    else if (k === 'f') this.toggleSpeed();
    else if (k === 'escape') this.closeMenu();
    else if (k >= '1' && k <= '9') this.menuKeys.build?.(Number(k) - 1);
    else if (k === 'u') this.menuKeys.upgrade?.();
    else if (k === 's') this.menuKeys.sell?.();
  }

  private isOver() {
    return this.state === 'won' || this.state === 'lost';
  }

  private closeMenu() {
    this.menu?.destroy();
    this.menu = null;
    this.menuCell = null;
    this.menuKeys = {};
  }

  private openBuildMenu(c: number, r: number) {
    const center = cellCenter(c, r);
    const kinds = TOWER_ORDER.filter((k) => this.level.towers.includes(k));
    const n = kinds.length;
    const gap = 70;
    const panelW = n * gap + 20;
    const panelH = 148;
    const px = Phaser.Math.Clamp(center.x, panelW / 2 + 6, WIDTH - panelW / 2 - 6);
    const above = center.y - CELL / 2 - panelH - 8 > MAP_Y;
    const py = above ? center.y - CELL / 2 - panelH / 2 - 8 : center.y + CELL / 2 + panelH / 2 + 8;

    const container = this.add.container(0, 0).setDepth(25000);
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.35).fillRoundedRect(c * CELL + 2, MAP_Y + r * CELL + 2, CELL - 4, CELL - 4, 12);
    g.lineStyle(3, 0xffffff, 1).strokeRoundedRect(c * CELL + 2, MAP_Y + r * CELL + 2, CELL - 4, CELL - 4, 12);
    g.fillStyle(0x000000, 0.2).fillRoundedRect(px - panelW / 2, py - panelH / 2 + 4, panelW, panelH, 18);
    g.fillStyle(0xfffaf0, 0.97).fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 18);
    g.lineStyle(3, 0xe4bf7a, 1).strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 18);
    container.add(g);

    const info = this.add
      .text(px, py + panelH / 2 - 38, '选择一座防御塔（数字键快速建造）', { fontFamily: FONT, fontSize: '14px', color: '#6b5a3a' })
      .setOrigin(0.5);
    const stat = this.add
      .text(px, py + panelH / 2 - 17, '', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#2a6fb8' })
      .setOrigin(0.5);
    container.add([info, stat]);
    const tryBuild = (kind: TowerKind) => {
      if (this.energy < TOWERS[kind].levels[0].cost) {
        info.setText('能量不足！');
        sfx.play('deny');
        return;
      }
      this.build(kind, c, r);
    };
    this.menuKeys = { build: (i) => kinds[i] && tryBuild(kinds[i]) };

    kinds.forEach((kind, i) => {
      const def = TOWERS[kind];
      const cost = def.levels[0].cost;
      const afford = this.energy >= cost;
      const x = px - ((n - 1) * gap) / 2 + i * gap;
      const y = py - 32;
      const bg = this.add.circle(x, y, 28, afford ? 0xe9f6ff : 0xdddddd).setStrokeStyle(3, afford ? 0x5fb0ff : 0xaaaaaa);
      const icon = this.add.image(x, y, kind);
      icon.setScale(46 / icon.width);
      const price = this.add
        .text(x, y + 38, `⚡${cost}`, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: afford ? '#c98a00' : '#999999' })
        .setOrigin(0.5);
      if (!afford) {
        icon.setAlpha(0.4);
      }
      bg.setInteractive({ useHandCursor: afford });
      bg.on('pointerover', () => {
        info.setText(`${def.name}：${def.desc}`);
        stat.setText(statText(kind, 0));
        if (afford) icon.setScale(52 / icon.width);
      });
      bg.on('pointerout', () => icon.setScale(46 / icon.width));
      bg.on('pointerdown', () => tryBuild(kind));
      const hotkey = this.add
        .text(x - 22, y - 22, `${i + 1}`, { fontFamily: 'Arial', fontSize: '11px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#5fb0ff', padding: { x: 3, y: 1 } })
        .setOrigin(0.5);
      container.add([bg, icon, price, hotkey]);
    });

    container.setScale(0.8).setAlpha(0);
    this.tweens.add({ targets: container, scale: 1, alpha: 1, duration: 140, ease: 'Back.Out' });
    // 以面板中心缩放
    container.setPosition(px * 0.2, py * 0.2);
    this.tweens.add({ targets: container, x: 0, y: 0, duration: 140, ease: 'Back.Out' });
    this.menu = container;
    this.menuCell = cellKey(c, r);
  }

  private openTowerMenu(tower: Tower) {
    const container = this.add.container(0, 0).setDepth(25000);
    const s = tower.stats;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.12).fillCircle(tower.x, tower.y, s.range);
    g.lineStyle(3, 0xffffff, 0.8).strokeCircle(tower.x, tower.y, s.range);
    if (!tower.maxed) {
      g.lineStyle(2, 0xffe14d, 0.7).strokeCircle(tower.x, tower.y, tower.def.levels[tower.level + 1].range);
    }
    container.add(g);

    const label = this.add
      .text(tower.x, tower.y - 98, `${tower.def.name}  Lv.${tower.level + 1}\n${statText(tower.kind, tower.level, true)}`, {
        fontFamily: FONT, fontSize: '13px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#2c3a52dd', padding: { x: 8, y: 4 },
        align: 'center', lineSpacing: 3,
      })
      .setOrigin(0.5);
    // 靠边时整体挪回屏幕内
    label.setX(Phaser.Math.Clamp(tower.x, label.width / 2 + 4, WIDTH - label.width / 2 - 4));
    container.add(label);

    const upY = Math.max(tower.y - 62, MAP_Y + 22);
    const sellY = Math.min(tower.y + 62, HEIGHT - 22);
    if (tower.maxed) {
      const b = makeButton(this, tower.x, upY, 110, 36, '已满级', 0x8a8f99, () => {}, 15);
      b.setEnabled(false);
      container.add(b.container);
    } else {
      const cost = tower.upgradeCost;
      const doUpgrade = () => {
        if (this.energy < cost) {
          sfx.play('deny');
          return;
        }
        this.energy -= cost;
        tower.upgrade();
        sfx.play('upgrade');
        this.burst(tower.x, tower.y, 0xffd23f, 14, 40);
        this.floatText(tower.x, tower.y - 40, `Lv.${tower.level + 1}!`, '#ffd23f', 20);
        this.refreshHud();
        this.closeMenu();
        this.openTowerMenu(tower);
      };
      const b = makeButton(this, tower.x, upY, 120, 36, `升级 ⚡${cost} [U]`, 0x3cb35a, doUpgrade, 14);
      this.menuKeys.upgrade = doUpgrade;
      b.setEnabled(this.energy >= cost);
      container.add(b.container);
      // 下一级造型预览
      const right = tower.x + 116 < WIDTH;
      const px = right ? tower.x + 86 : tower.x - 86;
      const preview = this.add.circle(px, upY, 22, 0xfffaf0).setStrokeStyle(3, 0x3cb35a);
      const icon = this.add.image(px, upY, towerTexture(tower.kind, tower.level + 1));
      icon.setScale(36 / icon.width);
      const arrow = this.add.text(right ? px - 30 : px + 30, upY, right ? '›' : '‹', { fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#2f8f5a', strokeThickness: 4 }).setOrigin(0.5);
      container.add([arrow, preview, icon]);
      this.tweens.add({ targets: icon, scale: icon.scale * 1.12, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const sell = makeButton(this, tower.x, sellY, 120, 36, `出售 +${tower.sellValue} [S]`, 0xe0533a, () => this.sell(tower), 14);
    this.menuKeys.sell = () => this.sell(tower);
    container.add(sell.container);

    label.setY(upY - 42);
    if (label.y - label.height / 2 < MAP_Y + 4) label.setY(sellY + 42);

    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 120 });
    this.menu = container;
    this.menuCell = cellKey(tower.c, tower.r);
  }

  private build(kind: TowerKind, c: number, r: number) {
    const cost = TOWERS[kind].levels[0].cost;
    if (this.energy < cost) return;
    this.energy -= cost;
    const p = cellCenter(c, r);
    this.towers.set(cellKey(c, r), new Tower(this, kind, c, r, p.x, p.y));
    this.burst(p.x, p.y, 0xffffff, 8);
    sfx.play('build');
    this.closeMenu();
    this.refreshHud();
  }

  private sell(tower: Tower) {
    this.energy += tower.sellValue;
    this.floatText(tower.x, tower.y - 30, `+${tower.sellValue}⚡`, '#ffe14d');
    this.burst(tower.x, tower.y, 0xd4ae6c, 10);
    sfx.play('sell');
    tower.destroy();
    this.towers.delete(cellKey(tower.c, tower.r));
    this.closeMenu();
    this.refreshHud();
  }

  // ───────────────────────── 波次 ─────────────────────────

  private startWave() {
    const waves = this.level.waves;
    if (this.state !== 'build' || this.waveIndex >= waves.length) return;
    const wave = waves[this.waveIndex];
    this.spawnQueue = [];
    let alt = 0;
    for (const grp of wave) {
      for (let i = 0; i < grp.count; i++) {
        const path = grp.path ?? alt++ % this.tracks.length;
        this.spawnQueue.push({ t: grp.delay + i * grp.gap, kind: grp.kind, path });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.waveClock = 0;
    this.waveIndex++;
    this.state = 'wave';
    this.refreshHud();
    const last = this.waveIndex === waves.length;
    sfx.play('waveStart');
    this.banner(last ? `最终波！第 ${this.waveIndex} 波来袭` : `第 ${this.waveIndex} 波来袭！`, last ? 0xc6331f : 0xe08a2e);
  }

  private spawn(kind: EnemyKind, path: number) {
    const def = ENEMIES[kind];
    // Boss 只吃一半的波次成长，否则后期 Boss 血量膨胀过快
    const growth = this.level.hpGrowth * (def.boss ? 0.5 : 1);
    const hpScale = 1 + growth * (this.waveIndex - 1);
    const track = this.tracks[Math.min(path, this.tracks.length - 1)];
    if (!this.seen.has(kind)) {
      this.seen.add(kind);
      this.banner(`新干扰「${def.name}」：${def.intro}`, def.boss ? 0xc6331f : 0x6a55b5, 4500, kind);
    }
    const e = new Enemy(this, def, hpScale, track);
    this.enemies.push(e);
    if (def.linked) {
      const twin = new Enemy(this, def, hpScale, track, -34);
      e.partner = twin;
      twin.partner = e;
      this.enemies.push(twin);
    }
    if (def.boss) {
      this.cameras.main.shake(600, 0.008);
      sfx.play('boss');
    }
  }

  private waveCleared() {
    this.state = 'build';
    const bonus = waveBonus(this.waveIndex);
    if (this.waveIndex >= this.level.waves.length) {
      this.finish(true);
      return;
    }
    this.energy += bonus;
    sfx.play('waveClear');
    this.banner(`第 ${this.waveIndex} 波清除！奖励 ⚡${bonus}`, 0x3cb35a);
    this.refreshHud();
  }

  // ───────────────────────── 主循环 ─────────────────────────

  update(_time: number, delta: number) {
    if (this.paused || this.isOver()) return;
    if (this.hitstop > 0) {
      this.hitstop -= delta / 1000;
      return;
    }
    const dt = (Math.min(delta, 50) / 1000) * this.speed;

    if (this.state === 'wave') {
      this.waveClock += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].t <= this.waveClock) {
        const next = this.spawnQueue.shift()!;
        this.spawn(next.kind, next.path);
      }
    }

    for (const e of this.enemies) {
      e.slow = 1;
      e.mark = 1;
      e.revealed = !e.def.stealth;
    }
    for (const t of this.towers.values()) {
      t.boost = 0;
      t.protect = 0;
    }
    for (const t of this.towers.values()) t.applySupport(this.towers.values());
    for (const t of this.towers.values()) t.applyAura();
    for (const t of this.towers.values()) t.applySlow();

    for (const e of this.enemies) {
      e.update(dt);
      if (e.def.boss) this.bossAbility(e, dt);
    }
    for (const t of this.towers.values()) t.update(dt);
    this.updateProjectiles(dt);
    this.drawLinks();

    for (const e of this.enemies) {
      if (e.reached && !e.dead) this.leak(e);
    }
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.state === 'wave' && this.spawnQueue.length === 0 && this.enemies.length === 0 && this.lives > 0) {
      this.waveCleared();
    }
  }

  private bossAbility(e: Enemy, dt: number) {
    e.abilityTimer += dt;
    if (e.abilityTimer < ESD_DISCHARGE.interval || !e.alive) return;
    e.abilityTimer = 0;
    const g = this.add.graphics().setDepth(15000);
    for (const t of this.towers.values()) {
      if ((t.x - e.x) ** 2 + (t.y - e.y) ** 2 > ESD_DISCHARGE.radius ** 2) continue;
      this.lightning(g, e.x, e.y - 20, t.x, t.y - 10);
      // LDO 稳压可以抵消一部分（满级全部）瘫痪时间
      const stun = ESD_DISCHARGE.stun * (1 - t.protect);
      if (stun <= 0.05) {
        this.floatText(t.x, t.y - 40, '稳压!', '#8ee86b', 15);
        sfx.play('shield');
        continue;
      }
      t.stun = Math.max(t.stun, stun);
    }
    g.lineStyle(3, 0xffd166, 0.8).strokeCircle(e.x, e.y, ESD_DISCHARGE.radius);
    this.tweens.add({ targets: g, alpha: 0, duration: 500, onComplete: () => g.destroy() });
    this.cameras.main.shake(200, 0.004);
    sfx.play('zap');
  }

  private lightning(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number) {
    const pts: Phaser.Math.Vector2[] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === 0 || i === steps ? 0 : 12;
      pts.push(new Phaser.Math.Vector2(x0 + (x1 - x0) * t + Phaser.Math.Between(-jitter, jitter), y0 + (y1 - y0) * t + Phaser.Math.Between(-jitter, jitter)));
    }
    g.lineStyle(7, 0xffd166, 0.4).strokePoints(pts);
    g.lineStyle(3, 0xffffff, 1).strokePoints(pts);
  }

  private drawLinks() {
    const g = this.linkG;
    g.clear();
    for (const e of this.enemies) {
      const p = e.partner;
      if (!p || !p.alive || !e.alive || e.dist < p.dist || e.dist <= 0) continue;
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const off = i % 2 === 0 ? -4 : 4;
        pts.push(new Phaser.Math.Vector2(e.x + (p.x - e.x) * t, e.y - 14 + (p.y - e.y) * t + (i === 0 || i === 6 ? 0 : off)));
      }
      g.lineStyle(3, 0xffd166, 0.9).strokePoints(pts);
    }
  }

  // ───────────────────────── 战斗结算（Battle 接口） ─────────────────────────

  fireProjectile(tower: Tower, target: Enemy) {
    const sx = tower.x + 14;
    const sy = tower.y - 14;
    const adc = tower.kind === 'adc';
    if (tower.kind === 'mixer') {
      this.launchMixer(tower, sx, sy, target, tower.stats.damage, false);
      sfx.play('mixer');
      return;
    }
    const color = tower.color;
    const css = `#${color.toString(16).padStart(6, '0')}`;
    // 子弹随等级变大、变色；ADC 的比特位数也随分辨率增加
    const obj = adc
      ? this.add
          .text(sx, sy, Phaser.Utils.Array.GetRandom(['0', '1', '01', '10', '101', '110'].slice(0, 2 + tower.level * 2)), {
            fontFamily: 'Courier New', fontSize: `${20 + tower.level * 2}px`, fontStyle: 'bold', color: css, stroke: '#1d2a3a', strokeThickness: 4,
          })
          .setOrigin(0.5)
      : this.add.circle(sx, sy, 7 + tower.level * 1.5, color).setStrokeStyle(3, Phaser.Display.Color.ValueToColor(color).darken(30).color);
    obj.setDepth(12000);
    this.projectiles.push({ obj, tower, target, damage: tower.stats.damage, trail: 0 });
    sfx.play(adc ? 'adc' : 'amp');

    // 枪口闪光
    const flash = this.add.circle(sx, sy, 12 + tower.level * 2, color, 0.7).setDepth(12001);
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 120, onComplete: () => flash.destroy() });
  }

  /** 混频器子弹：中间带 ⊗ 的圆环；边带子弹更小 */
  private launchMixer(tower: Tower, x: number, y: number, target: Enemy, damage: number, sideband: boolean) {
    const r = sideband ? 6 : 9 + tower.level * 1.5;
    const obj = this.add.circle(x, y, r, 0xffffff).setStrokeStyle(sideband ? 3 : 4, tower.color).setDepth(12000);
    this.projectiles.push({ obj, tower, target, damage, sideband, trail: 0 });
  }

  /** 混频：主子弹命中后向附近另外两只怪分出上下边带 */
  private sidebands(p: Projectile, hit: Enemy) {
    const near = this.enemies
      .filter((e) => e !== hit && e.targetable && (e.x - hit.x) ** 2 + (e.y - hit.y) ** 2 <= 110 * 110)
      .sort((a, b) => (a.x - hit.x) ** 2 + (a.y - hit.y) ** 2 - ((b.x - hit.x) ** 2 + (b.y - hit.y) ** 2))
      .slice(0, 2);
    for (const e of near) this.launchMixer(p.tower, hit.x, hit.y - 8, e, p.damage * p.tower.stats.extra, true);
  }

  private updateProjectiles(dt: number) {
    const step = PROJECTILE_SPEED * dt;
    // 命中时可能产生新子弹（混频边带），它们会 push 进旧数组，过滤完再接回来
    const current = this.projectiles;
    const before = current.length;
    const alive = current.filter((p) => {
      const t = p.target;
      if (!t.alive) {
        p.obj.destroy();
        return false;
      }
      const tx = t.x;
      const ty = t.y - 8;
      const dx = tx - p.obj.x;
      const dy = ty - p.obj.y;
      const d = Math.hypot(dx, dy);
      if (d > step + 6) {
        p.obj.setPosition(p.obj.x + (dx / d) * step, p.obj.y + (dy / d) * step);
        if (p.obj instanceof Phaser.GameObjects.Text) p.obj.rotation += dt * 10;
        // 拖尾
        p.trail += dt;
        if (p.trail > 0.025) {
          p.trail = 0;
          const small = p.tower.kind === 'adc' || p.sideband;
          const dot = this.add.circle(p.obj.x, p.obj.y, (small ? 3 : 5) + p.tower.level, p.tower.color, 0.6).setDepth(11999);
          this.tweens.add({ targets: dot, scale: 0.2, alpha: 0, duration: 180, onComplete: () => dot.destroy() });
        }
        return true;
      }
      // 命中方向：沿弹道往回 20px 作为攻击来源
      const len = d || 1;
      p.obj.destroy();
      this.hit(p, t, { x: tx - (dx / len) * 20, y: ty - (dy / len) * 20 });
      return false;
    });
    this.projectiles = alive.concat(current.slice(before));
  }

  private hit(p: Projectile, t: Enemy, from: { x: number; y: number }) {
    const dodge = t.def.dodge ?? 0;
    if (dodge > 0 && Math.random() < dodge) {
      this.floatText(t.x, t.y - 30, 'MISS', '#9fd4ff', 14);
      sfx.play('miss');
      return;
    }
    const adc = p.tower.kind === 'adc';
    this.burst(t.x, t.y - 8, p.tower.color, 5 + p.tower.level * 2);
    sfx.play('hit');
    this.damage(t, p.damage, from, !p.sideband);
    if (p.tower.kind === 'mixer' && !p.sideband) this.sidebands(p, t);
    const threshold = p.tower.stats.extra;
    if (adc && t.alive && !t.def.boss && t.hp <= t.maxHp * threshold) this.kill(t, true);
  }

  damage(e: Enemy, amount: number, from?: { x: number; y: number }, showNumber = true) {
    if (!e.alive) return;
    let a = amount * e.mark * (1 - (e.def.armor ?? 0));
    const p = e.partner;
    if (p && p.alive) {
      a /= 2;
      this.applyHp(p, a, from);
    }
    if (from && showNumber) this.damageNumber(e, a);
    this.applyHp(e, a, from);
  }

  private applyHp(e: Enemy, a: number, from?: { x: number; y: number }) {
    if (!e.alive) return;
    e.hp -= a;
    if (from) e.flash(from.x, from.y);
    if (e.hp <= 0) this.kill(e, false);
  }

  private damageNumber(e: Enemy, a: number) {
    if (this.damageTexts > 25) return;
    const big = a >= 30;
    const t = this.add
      .text(e.x + Phaser.Math.Between(-10, 10), e.y - e.def.size / 2 - 14, `${Math.round(a)}`, {
        fontFamily: 'Arial', fontSize: big ? '20px' : '14px', fontStyle: 'bold',
        color: big ? '#ffd23f' : '#ffffff', stroke: '#3a2a5a', strokeThickness: big ? 5 : 4,
      })
      .setOrigin(0.5)
      .setDepth(14000)
      .setScale(big ? 1.5 : 1.2);
    this.damageTexts++;
    this.tweens.add({ targets: t, scale: 1, duration: 90, ease: 'Back.Out' });
    this.tweens.add({
      targets: t, y: t.y - 22, alpha: 0, duration: 520, delay: 120, ease: 'Cubic.In',
      onComplete: () => {
        this.damageTexts--;
        t.destroy();
      },
    });
  }

  private kill(e: Enemy, quantized: boolean) {
    if (!e.alive) return;
    e.dead = true;
    this.energy += e.def.reward;
    this.refreshHud();
    this.coinFly(e.x, e.y - 10, e.def.reward);

    const big = e.def.boss || e.def.size >= 60;
    let sound: SfxName = big ? 'bigPop' : 'pop';
    if (quantized) {
      sound = 'quantize';
      this.floatText(e.x, e.y - 48, '量化!', '#3cff5a', 18);
      for (let i = 0; i < 10; i++) {
        const sq = this.add.rectangle(e.x + Phaser.Math.Between(-14, 14), e.y + Phaser.Math.Between(-18, 8), 8, 8, Phaser.Math.RND.pick([0x3cff5a, e.def.color])).setDepth(12000);
        this.tweens.add({ targets: sq, y: sq.y - Phaser.Math.Between(20, 50), alpha: 0, angle: 90, duration: 500, onComplete: () => sq.destroy() });
      }
      this.hitstop = Math.max(this.hitstop, 0.04);
    } else {
      const ghost = this.add.image(e.sprite.x, e.sprite.y, e.def.kind).setScale(e.sprite.scaleX).setFlipX(e.sprite.flipX).setDepth(e.sprite.depth).setTintFill(0xffffff);
      this.tweens.add({ targets: ghost, scale: e.sprite.scaleX * 1.3, alpha: 0, duration: 180, ease: 'Cubic.Out', onComplete: () => ghost.destroy() });
      this.burst(e.x, e.y - 8, e.def.color, big ? 18 : 9, big ? 60 : 30);
      this.burst(e.x, e.y - 8, 0xffffff, big ? 8 : 4, big ? 40 : 20);
    }
    if (big) this.hitstop = Math.max(this.hitstop, e.def.boss ? 0.25 : 0.06);
    if (e.def.boss) {
      this.cameras.main.shake(600, 0.012);
      this.cameras.main.flash(250, 255, 240, 200);
    }
    sfx.play(sound);
    e.destroy();
  }

  /** 金币飞向能量栏 */
  private coinFly(x: number, y: number, reward: number) {
    const n = Math.min(4, Math.ceil(reward / 6));
    for (let i = 0; i < n; i++) {
      const coin = this.add.circle(x, y, 6, 0xffd23f).setStrokeStyle(2, 0xc98a00).setDepth(21000);
      const sx = x + Phaser.Math.Between(-20, 20);
      const sy = y + Phaser.Math.Between(-24, -4);
      this.tweens.chain({
        targets: coin,
        tweens: [
          { x: sx, y: sy, duration: 160, ease: 'Cubic.Out' },
          {
            x: 34, y: 32, scale: 0.6, duration: 420, delay: i * 40, ease: 'Cubic.In',
            onComplete: () => {
              coin.destroy();
              this.energyText.setScale(1.18);
              this.tweens.add({ targets: this.energyText, scale: 1, duration: 120 });
            },
          },
        ],
      });
    }
  }

  private leak(e: Enemy) {
    e.dead = true;
    e.destroy();
    this.lives = Math.max(0, this.lives - e.def.leak);
    this.refreshHud();
    this.floatText(this.core.x, this.core.y - 50, `-${e.def.leak}❤`, '#ff5a5a', 22);
    this.core.setTint(0xff7070);
    this.time.delayedCall(180, () => this.core.clearTint());
    this.tweens.add({ targets: this.core, scale: this.coreScale * 0.85, duration: 80, yoyo: true });
    this.cameras.main.shake(180, 0.006);
    this.hitstop = Math.max(this.hitstop, 0.05);
    sfx.play('leak');

    // 屏幕边缘闪红
    const v = this.add.graphics().setDepth(29000);
    v.lineStyle(36, 0xff2a2a, 0.45).strokeRect(0, MAP_Y, WIDTH, HEIGHT - MAP_Y);
    this.tweens.add({ targets: v, alpha: 0, duration: 400, onComplete: () => v.destroy() });

    if (this.lives <= 0) this.finish(false);
  }

  ring(x: number, y: number, radius: number, color: number) {
    const g = this.add.graphics().setPosition(x, y).setDepth(y + 50);
    g.lineStyle(5, color, 0.9).strokeCircle(0, 0, radius);
    g.fillStyle(color, 0.12).fillCircle(0, 0, radius);
    g.setScale(0.15);
    this.tweens.add({ targets: g, scale: 1, alpha: 0, duration: 450, ease: 'Cubic.Out', onComplete: () => g.destroy() });
    sfx.play('osc');
  }

  // ───────────────────────── 特效与提示 ─────────────────────────

  private burst(x: number, y: number, color: number, n: number, spread = 26) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dot = this.add.circle(x, y, Phaser.Math.Between(3, 5), color).setDepth(12500);
      const dist = Phaser.Math.Between(spread * 0.5, spread);
      this.tweens.add({ targets: dot, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, alpha: 0, scale: 0.3, duration: 320, ease: 'Cubic.Out', onComplete: () => dot.destroy() });
    }
  }

  private floatText(x: number, y: number, text: string, color: string, size = 16) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#00000088', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(14000);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 800, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  /** icon 是贴图 key：新怪物或新解锁的塔 */
  private banner(text: string, color: number, duration = 2200, icon?: string) {
    // 最多同时显示 3 条，挤掉最早的
    while (this.banners.length >= 3) this.banners.shift()!.destroy();
    this.banners.forEach((b, i) => b.setY(MAP_Y + 46 + i * 52));
    const y = MAP_Y + 40 + this.banners.length * 52;
    const label = this.add.text(icon ? 22 : 0, 0, text, { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    const w = label.width + (icon ? 84 : 48);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(-w / 2, -19 + 3, w, 38, 19);
    g.fillStyle(color, 0.95).fillRoundedRect(-w / 2, -19, w, 38, 19);
    const parts: Phaser.GameObjects.GameObject[] = [g, label];
    if (icon) {
      const img = this.add.image(-w / 2 + 30, 0, icon);
      img.setScale(32 / Math.max(img.width, img.height));
      parts.push(img);
    }
    const c = this.add.container(WIDTH / 2, y, parts).setDepth(26000).setAlpha(0);
    this.banners.push(c);
    this.tweens.add({ targets: c, alpha: 1, y: y + 6, duration: 200 });
    this.time.delayedCall(duration, () => {
      if (!c.active) return;
      this.tweens.add({
        targets: c, alpha: 0, duration: 300,
        onComplete: () => {
          this.banners = this.banners.filter((b) => b !== c);
          c.destroy();
        },
      });
    });
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'lost';
    sfx.play(won ? 'win' : 'lose');
    this.closeMenu();
    this.hoverG.clear();
    this.refreshHud();
    this.startBtn.setLabel(won ? '胜利' : '失败');

    const layer = this.add.container(0, 0).setDepth(40000);
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.55).setInteractive();
    const g = this.add.graphics();
    g.fillStyle(0xfffaf0, 1).fillRoundedRect(WIDTH / 2 - 220, HEIGHT / 2 - 150, 440, 300, 28);
    g.lineStyle(5, won ? 0x3cb35a : 0xc6331f, 1).strokeRoundedRect(WIDTH / 2 - 220, HEIGHT / 2 - 150, 440, 300, 28);
    const title = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 100, won ? '芯片守住了！' : '芯片失效了…', { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: won ? '#2f8f5a' : '#c6331f' })
      .setOrigin(0.5);
    const max = this.level.lives;
    const starCount = won ? (this.lives >= max ? 3 : this.lives >= max / 2 ? 2 : 1) : 0;
    if (won) recordWin(this.level.id, starCount);
    const stars = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 30, won ? '★'.repeat(starCount) + '☆'.repeat(3 - starCount) : `坚持到第 ${this.waveIndex} 波`, {
        fontFamily: FONT, fontSize: won ? '52px' : '22px', color: won ? '#ffc21f' : '#6b5a3a', stroke: won ? '#a87400' : '#00000000', strokeThickness: won ? 4 : 0,
      })
      .setOrigin(0.5);
    const coreImg = this.add.image(WIDTH / 2, HEIGHT / 2 + 40, 'core').setScale(60 / this.core.width);
    if (!won) coreImg.setTint(0x777777).setAngle(-15);
    const idx = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = won ? LEVELS[idx + 1] : undefined;
    const buttons: Button[] = [
      makeButton(this, 0, 0, 120, 46, '选关', 0x5c6b85, () => this.scene.start('Menu'), 18),
      makeButton(this, 0, 0, 120, 46, won ? '重玩' : '重试', won ? 0x4f7fd1 : 0x3cb35a, () => this.scene.restart({ levelId: this.level.id }), 18),
    ];
    if (next) buttons.push(makeButton(this, 0, 0, 120, 46, '下一关 ▶', 0x3cb35a, () => this.scene.start('Game', { levelId: next.id }), 18));
    buttons.forEach((b, i) => b.container.setPosition(WIDTH / 2 + (i - (buttons.length - 1) / 2) * 136, HEIGHT / 2 + 108));
    if (won && !next) stars.setY(HEIGHT / 2 - 40);
    layer.add([shade, g, title, stars, coreImg, ...buttons.map((b) => b.container)]);
    if (won && !next) {
      layer.add(this.add.text(WIDTH / 2, HEIGHT / 2 + 4, '全部关卡通关！', { fontFamily: FONT, fontSize: '16px', color: '#6b5a3a' }).setOrigin(0.5));
      coreImg.setY(HEIGHT / 2 + 50);
    }
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 300 });
  }
}
