import Phaser from 'phaser';
import { CELL, MAP_Y, MAP_BOTTOM, WIDTH, HEIGHT, PathTrack, cellAt, cellCenter, cellKey } from '../config/map';
import { TOWERS, TOWER_ORDER, statText, type TowerKind } from '../config/towers';
import { LEVELS, challengeText, type LevelDef } from '../config/levels';
import { findLevel, endlessWave, endlessHpScale, KILL_SCORE, WAVE_SCORE } from '../config/endless';
import { Tutorial } from '../tutorial';
import { blockedCells, drawLevelMap } from '../mapRender';
import { recordWin, markSeen, hasSeen, recordBadge, hasBadge, recordEndless, endlessBest, tutorialDone } from '../progress';
import { openCodex } from '../codex';
import { ENEMIES, ESD_DISCHARGE, type EnemyKind } from '../config/enemies';
import { waveBonus } from '../config/waves';
import { Enemy } from '../entities/Enemy';
import { Tower, towerTexture, type Battle, type Target } from '../entities/Tower';
import { Obstacle } from '../entities/Obstacle';
import { BottomBar, type SkillId } from '../bottomBar';
import { FONT, fit, makeButton, measureMax, type Button } from '../ui';
import { sfx, music, type SfxName } from '../audio';
import { setupCamera } from '../display';

type State = 'build' | 'wave' | 'won' | 'lost';

interface Projectile {
  obj: Phaser.GameObjects.Arc | Phaser.GameObjects.Text;
  tower: Tower;
  target: Target;
  damage: number;
  /** 混频器分出的边带子弹：更小，命中后不再继续分裂 */
  sideband?: boolean;
  /** 拖尾计时 */
  trail: number;
}

const PROJECTILE_SPEED = 520;
// HUD 标题可用的横向范围：波次胶囊右边（268+150）到 ☰ 按钮左边（WIDTH-436-24）
const TITLE_L = 268 + 150 + 8;
const TITLE_R = WIDTH - 436 - 24 - 8;
const BUILD_TIP = '选择一座防御塔（数字键快速建造）';

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
  private muteBtn!: Button;
  /** 暂停菜单面板；为 null 表示没有打开 */
  private pausePanel: Phaser.GameObjects.Container | null = null;
  /** 正在打开的图鉴 */
  private codex: { close: () => void } | null = null;
  private menuKind: 'build' | 'tower' | null = null;
  private tutorial: Tutorial | null = null;
  /** 无尽模式分数 */
  private score = 0;
  private titleText!: Phaser.GameObjects.Text;
  /** 挑战条件：是否仍满足、提前开波次数 */
  private challengeOk = true;
  private earlyCalls = 0;
  /** 地图上的元件障碍物，按格子索引 */
  private obstacles = new Map<string, Obstacle>();
  /** 玩家标记要拆的障碍物 */
  private marked: Obstacle | null = null;
  private focusG!: Phaser.GameObjects.Graphics;
  private focusClock = 0;
  private hoverTip!: Phaser.GameObjects.Text;
  /** 当前正在出手的塔，用来统计战报 */
  private acting: Tower | null = null;
  /** 每座塔（包括卖掉的）的输出和击杀 */
  private record = new Map<Tower, { damage: number; kills: number }>();
  /** 拆障碍物送的塔，不计入“最多 N 座塔”的挑战 */
  private giftTowers = new Set<Tower>();
  private bar!: BottomBar;
  /** 技能效果剩余时间：散热风扇减速、系统复位定身 */
  private fanTime = 0;
  private freezeTime = 0;

  constructor() {
    super('Game');
  }

  get stage(): Phaser.Scene {
    return this;
  }

  /** 塔只在波次进行时拆障碍物，备战阶段不能白拿能量 */
  get focus(): Obstacle | null {
    return this.state === 'wave' ? this.marked : null;
  }

  init(data: { levelId?: number }) {
    this.level = findLevel(data.levelId ?? 1);
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
    this.startLabel = '';
    this.pausePanel = null;
    this.codex = null;
    this.menuKind = null;
    this.tutorial = null;
    this.score = 0;
    this.challengeOk = true;
    this.earlyCalls = 0;
    this.obstacles = new Map();
    this.marked = null;
    this.focusClock = 0;
    this.acting = null;
    this.record = new Map();
    this.giftTowers = new Set();
    this.fanTime = 0;
    this.freezeTime = 0;
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;

    this.drawMap();
    this.createCore();
    this.hoverG = this.add.graphics().setDepth(5);
    this.focusG = this.add.graphics().setDepth(11000);
    this.hoverTip = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#2c3a52dd', padding: { x: 8, y: 4 }, align: 'center' })
      .setOrigin(0.5, 1)
      .setDepth(25000)
      .setVisible(false);
    this.linkG = this.add.graphics().setDepth(9000);
    this.bar = new BottomBar(this, (id) => this.useSkill(id));
    this.createHud();
    this.bindInput();
    music.play('battle');
    // 切到别的标签页时自动暂停，避免回来时已经漏了一堆怪
    const onHidden = () => {
      if (!this.paused && !this.isOver()) this.togglePause();
    };
    this.game.events.on('hidden', onHidden);
    this.events.once('shutdown', () => this.game.events.off('hidden', onHidden));
    if (this.level.endless) {
      const best = endlessBest(this.level.id);
      this.banner(`${this.level.name}：怪物会越来越强，坚持得越久分数越高`, 0x2a6fb8, 4000);
      if (best) this.banner(`最高纪录：第 ${best.wave} 波 · ${best.score} 分`, 0x6a55b5, 4000);
    } else {
      this.banner(`第${this.level.id}关「${this.level.name}」：${this.level.subtitle}`, 0x2a6fb8, 3500);
    }
    const unlock = this.level.unlock;
    if (unlock) this.banner(`新塔解锁「${TOWERS[unlock].name}」：${TOWERS[unlock].desc}`, 0xd0782a, 5000, unlock);
    const ch = this.level.challenge;
    if (ch && !(this.level.id === 1 && !tutorialDone())) {
      this.banner(`可选挑战${hasBadge(this.level.id) ? '（已完成）' : ''}：${challengeText(ch)}`, 0x8a5a2a, 4500);
    }
    // 新玩法提示：每个存档只提示一次，等开局横幅播完再出
    if (!(this.level.id === 1 && !tutorialDone())) {
      const tips: [string, string][] = [
        ['tip-obstacle', '新玩法：点击地图上的元件标记它，波次中射程内的塔会优先拆掉它，换能量和空位'],
        ['tip-skill', '底部有三个技能：Q 全场减速、W 全场定身、E 用 1 点生命换能量'],
      ];
      tips.forEach(([key, text], i) => {
        if (hasSeen(key)) return;
        markSeen(key);
        this.time.delayedCall(4200 + i * 300, () => this.banner(text, 0x2f8f5a, 6000));
      });
    }
    if (this.level.id === 1 && !tutorialDone()) {
      const host = this;
      this.tutorial = new Tutorial({
        stage: this,
        towerCount: () => host.towers.size,
        menuType: () => host.menuKind,
        isWave: () => host.state === 'wave',
        waveIndex: () => host.waveIndex,
        energy: () => host.energy,
        startButton: () => ({ x: host.startBtn.container.x, y: host.startBtn.container.y }),
        firstTower: () => {
          const t = [...host.towers.values()][0];
          return t ? { x: t.x, y: t.y } : null;
        },
      });
    }
  }

  // ───────────────────────── 地图 ─────────────────────────

  private drawMap() {
    drawLevelMap(this.add.graphics().setDepth(0), this.level);
    for (const p of this.level.props) {
      const o = new Obstacle(this, p, this.level.id);
      this.obstacles.set(o.key, o);
    }
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

    this.titleText = this.add
      .text((TITLE_L + TITLE_R) / 2, 32, '', { fontFamily: FONT, fontSize: '18px', color: '#9fc3ff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(20001);

    this.startBtn = makeButton(this, WIDTH - 280, 32, 150, 40, '▶ 开始第 1 波', 0x3cb35a, () => this.startWave());
    this.speedBtn = makeButton(this, WIDTH - 160, 32, 70, 40, '1x', 0x4f7fd1, () => this.toggleSpeed());
    this.pauseBtn = makeButton(this, WIDTH - 70, 32, 90, 40, '暂停', 0xe08a2e, () => this.togglePause());
    const muteBtn = makeButton(this, WIDTH - 384, 32, 48, 40, sfx.muted ? '🔇' : '🔊', 0x5c6b85, () => muteBtn.setLabel(sfx.toggleMute() ? '🔇' : '🔊'), 18);
    this.muteBtn = muteBtn;
    // ☰ 打开暂停菜单（里面有图鉴、重开、返回选关）
    const menuBtn = makeButton(this, WIDTH - 436, 32, 48, 40, '☰', 0x5c6b85, () => {
      if (!this.paused) this.togglePause();
    }, 20);
    for (const b of [this.startBtn, this.speedBtn, this.pauseBtn, muteBtn, menuBtn]) b.container.setDepth(20002);
    this.refreshHud();
  }

  private refreshHud() {
    // 文字框 = 胶囊左边 16 的位置到胶囊右边留 10
    const hud = (t: Phaser.GameObjects.Text, s: string, pillX: number, pillW: number) =>
      fit(t.setText(s), pillX + pillW - 10 - t.x, { x: t.x, y: 14, w: pillX + pillW - 10 - t.x, h: 36 });
    hud(this.energyText, `⚡ ${Math.floor(this.energy)}`, 14, 130);
    hud(this.livesText, `❤ ${this.lives}`, 156, 100);
    hud(this.waveText, `波次 ${this.waveIndex}/${this.level.endless ? '∞' : this.level.waves.length}`, 268, 150);
    // 无尽模式标题栏只放分数，地图名在开局横幅里已经展示过
    this.titleText.setText(this.level.endless ? `🏆 ${this.score} 分` : `第${this.level.id}关 ${this.level.name}`);
    fit(this.titleText, TITLE_R - TITLE_L, { x: TITLE_L, y: 10, w: TITLE_R - TITLE_L, h: 44 });
    const hasNext = this.waveIndex < this.totalWaves;
    this.bar?.setPreview(this.state === 'build' ? `第 ${this.waveIndex + 1} 波：` : '下一波：', hasNext ? this.waveDef(this.waveIndex) : null);
    this.refreshStartBtn();
  }

  /** 本波怪物已经全部出场、还有下一波时，可以提前开波 */
  private get canCallEarly() {
    return this.state === 'wave' && this.spawnQueue.length === 0 && this.waveIndex < this.totalWaves;
  }

  private get totalWaves() {
    return this.level.endless ? Infinity : this.level.waves.length;
  }

  private waveDef(i: number) {
    return this.level.endless ? endlessWave(i + 1) : this.level.waves[i];
  }

  /** 提前开波的额外奖励：场上剩下的怪越多，冒的险越大，奖励越多 */
  private get earlyBonus() {
    return Math.min(60, 15 + this.enemies.length * 3);
  }

  private startLabel = '';
  private refreshStartBtn() {
    const canStart = this.state === 'build';
    const early = this.canCallEarly;
    const label = canStart ? `▶ 开始第 ${this.waveIndex + 1} 波` : early ? `⏩ 提前 +⚡${waveBonus(this.waveIndex) + this.earlyBonus}` : '战斗中…';
    if (label === this.startLabel) return;
    this.startLabel = label;
    this.startBtn.setEnabled(canStart || early);
    this.startBtn.setLabel(label);
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
    music.setDuck(this.paused);
    if (this.paused) this.openPausePanel();
    else {
      this.codex?.close();
      this.pausePanel?.destroy();
      this.pausePanel = null;
    }
  }

  /** 暂停菜单：继续 / 重新开始 / 图鉴 / 音乐音效开关 / 返回选关 */
  private openPausePanel() {
    this.closeMenu();
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2 + 20;
    const w = 340;
    const h = 400;
    const shade = this.add.rectangle(cx, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.45).setInteractive();
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillRoundedRect(cx - w / 2, cy - h / 2 + 6, w, h, 26);
    g.fillStyle(0xfffaf0, 1).fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 26);
    g.lineStyle(5, 0xe08a2e, 1).strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 26);
    const title = this.add
      .text(cx, cy - h / 2 + 40, '已暂停', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: '#c66a1e' })
      .setOrigin(0.5);
    const tip = this.add
      .text(cx, cy + h / 2 - 22, '空格 / P / Esc 继续', { fontFamily: FONT, fontSize: '12px', color: '#a08a5a' })
      .setOrigin(0.5);
    const panel = this.add.container(0, 0, [shade, g, title, tip]).setDepth(30000);

    const onOff = (on: boolean) => (on ? '开' : '关');
    const rows: [string, number, () => void][] = [
      ['▶ 继续', 0x3cb35a, () => this.togglePause()],
      ['↻ 重新开始', 0x4f7fd1, () => this.scene.restart({ levelId: this.level.id })],
      ['📖 怪物图鉴', 0x6a55b5, () => {
        panel.setVisible(false);
        this.codex = openCodex(this, () => {
          this.codex = null;
          panel.setVisible(true);
        });
      }],
    ];
    rows.forEach(([label, color, fn], i) => {
      panel.add(makeButton(this, cx, cy - h / 2 + 100 + i * 54, 220, 44, label, color, fn).container);
    });
    // 音乐、音效并排的小开关
    const ty = cy - h / 2 + 100 + 3 * 54;
    const musicBtn = makeButton(this, cx - 58, ty, 104, 40, `♪ 音乐 ${onOff(music.enabled)}`, 0x5c6b85, () => {
      musicBtn.setLabel(`♪ 音乐 ${onOff(music.toggle())}`);
    }, 15);
    const sfxBtn = makeButton(this, cx + 58, ty, 104, 40, `🔊 音效 ${onOff(!sfx.muted)}`, 0x5c6b85, () => {
      const muted = sfx.toggleMute();
      sfxBtn.setLabel(`🔊 音效 ${onOff(!muted)}`);
      this.muteBtn.setLabel(muted ? '🔇' : '🔊');
    }, 15);
    panel.add([musicBtn.container, sfxBtn.container]);
    panel.add(makeButton(this, cx, ty + 60, 220, 44, '⌂ 返回选关', 0xe0533a, () => this.scene.start('Menu')).container);

    // 暂停时补间动画全部冻结，面板直接显示
    this.pausePanel = panel;
  }

  // ───────────────────────── 输入与菜单 ─────────────────────────

  private bindInput() {
    this.input.on('pointerdown', () => sfx.unlock());
    this.input.keyboard?.on('keydown', (ev: KeyboardEvent) => this.onKey(ev));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hoverG.clear();
      this.hoverTip.setVisible(false);
      if (this.isOver()) return;
      const cell = cellAt(p.worldX, p.worldY);
      if (!cell) return;
      const key = cellKey(cell.c, cell.r);
      const o = this.obstacles.get(key);
      if (o) {
        this.hoverG.lineStyle(3, 0xffb13c, 0.9).strokeRoundedRect(cell.c * CELL + 3, MAP_Y + cell.r * CELL + 3, CELL - 6, CELL - 6, 12);
        this.showObstacleTip(o);
        return;
      }
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
      const o = key ? this.obstacles.get(key) : undefined;
      if (o) {
        this.toggleFocus(o);
        return;
      }
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
    if (this.codex) {
      if (k === 'escape') this.codex.close();
      return;
    }
    if (this.paused && (k === 'escape' || k === ' ')) {
      ev.preventDefault();
      this.togglePause();
      return;
    }
    if (k === 'escape' && !this.menu) {
      this.togglePause();
      return;
    }
    if (k === ' ') {
      ev.preventDefault();
      if (this.state === 'build' && !this.paused) this.startWave();
      else this.togglePause();
    } else if (k === 'p') this.togglePause();
    else if (this.paused) return;
    else if (k === 'f') this.toggleSpeed();
    else if (k === 'n') this.startWave();
    else if (k === 'escape') this.closeMenu();
    else if (k === 'q') this.bar.use('fan');
    else if (k === 'w') this.bar.use('reset');
    else if (k === 'e') this.bar.use('power');
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
    this.menuKind = null;
  }

  private openBuildMenu(c: number, r: number) {
    const center = cellCenter(c, r);
    const kinds = TOWER_ORDER.filter((k) => this.level.towers.includes(k));
    const n = kinds.length;
    const gap = 70;
    // 面板宽度按最长的说明文字来定，文字不会超出面板
    const infoStyle = { fontFamily: FONT, fontSize: '14px' };
    const statStyle = { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold' };
    const textW = Math.max(
      measureMax(this, [BUILD_TIP, '能量不足！', ...kinds.map((k) => `${TOWERS[k].name}：${TOWERS[k].desc}（再点一次建造）`)], infoStyle),
      measureMax(this, kinds.map((k) => statText(k, 0)), statStyle),
    );
    const panelW = Math.min(WIDTH - 12, Math.max(n * gap + 20, Math.ceil(textW) + 32));
    const panelH = 148;
    const px = Phaser.Math.Clamp(center.x, panelW / 2 + 6, WIDTH - panelW / 2 - 6);
    const above = center.y - CELL / 2 - panelH - 8 > MAP_Y;
    const py = above ? center.y - CELL / 2 - panelH / 2 - 8 : center.y + CELL / 2 + panelH / 2 + 8;

    // 高于横幅（26000），开局提示不会挡住菜单
    const container = this.add.container(0, 0).setDepth(26500);
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.35).fillRoundedRect(c * CELL + 2, MAP_Y + r * CELL + 2, CELL - 4, CELL - 4, 12);
    g.lineStyle(3, 0xffffff, 1).strokeRoundedRect(c * CELL + 2, MAP_Y + r * CELL + 2, CELL - 4, CELL - 4, 12);
    g.fillStyle(0x000000, 0.2).fillRoundedRect(px - panelW / 2, py - panelH / 2 + 4, panelW, panelH, 18);
    g.fillStyle(0xfffaf0, 0.97).fillRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 18);
    g.lineStyle(3, 0xe4bf7a, 1).strokeRoundedRect(px - panelW / 2, py - panelH / 2, panelW, panelH, 18);
    container.add(g);

    const info = this.add
      .text(px, py + panelH / 2 - 38, '', { ...infoStyle, color: '#6b5a3a' })
      .setOrigin(0.5);
    const stat = this.add
      .text(px, py + panelH / 2 - 17, '', { ...statStyle, color: '#2a6fb8' })
      .setOrigin(0.5);
    container.add([info, stat]);
    const textBox = { x: px - panelW / 2 + 12, y: py - panelH / 2, w: panelW - 24, h: panelH };
    const setInfo = (t: string) => fit(info.setText(t), textBox.w, textBox);
    const setStat = (t: string) => fit(stat.setText(t), textBox.w, textBox);
    setInfo(BUILD_TIP);
    const tryBuild = (kind: TowerKind) => {
      if (this.energy < TOWERS[kind].levels[0].cost) {
        setInfo('能量不足！');
        sfx.play('deny');
        return;
      }
      this.build(kind, c, r);
    };
    this.menuKeys = { build: (i) => kinds[i] && tryBuild(kinds[i]) };

    let touchPick: TowerKind | null = null;
    const picks: Phaser.GameObjects.Arc[] = [];
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
      const preview = () => {
        setInfo(`${def.name}：${def.desc}`);
        setStat(statText(kind, 0));
        if (afford) icon.setScale(52 / icon.width);
      };
      bg.on('pointerover', preview);
      bg.on('pointerout', () => icon.setScale(46 / icon.width));
      // 触屏没有悬停：第一次点按先看说明，再点一次才建造
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (p.wasTouch && touchPick !== kind) {
          touchPick = kind;
          preview();
          picks.forEach((b) => b.setStrokeStyle(3, 0x5fb0ff));
          bg.setStrokeStyle(5, 0xff9d2e);
          setInfo(`${def.name}：${def.desc}（再点一次建造）`);
          return;
        }
        tryBuild(kind);
      });
      picks.push(bg);
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
    this.menuKind = 'build';
  }

  private openTowerMenu(tower: Tower) {
    // 高于横幅（26000），开局提示不会挡住菜单
    const container = this.add.container(0, 0).setDepth(26500);
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
    fit(label, WIDTH - 8);
    // 靠边时整体挪回屏幕内
    label.setX(Phaser.Math.Clamp(tower.x, label.displayWidth / 2 + 4, WIDTH - label.displayWidth / 2 - 4));
    container.add(label);

    const upY = Math.max(tower.y - 62, MAP_Y + 22);
    const sellY = Math.min(tower.y + 62, MAP_BOTTOM - 22);
    // 最边上一列的塔，按钮往里挪，不出画面
    const bx = Phaser.Math.Clamp(tower.x, 64, WIDTH - 64);
    if (tower.maxed) {
      const b = makeButton(this, bx, upY, 110, 36, '已满级', 0x8a8f99, () => {}, 15);
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
        if (this.level.challenge?.kind === 'noUpgrade') this.failChallenge();
        sfx.play('upgrade');
        this.burst(tower.x, tower.y, 0xffd23f, 14, 40);
        this.floatText(tower.x, tower.y - 40, `Lv.${tower.level + 1}!`, '#ffd23f', 20);
        this.refreshHud();
        this.closeMenu();
        this.openTowerMenu(tower);
      };
      const b = makeButton(this, bx, upY, 120, 36, `升级 ⚡${cost} [U]`, 0x3cb35a, doUpgrade, 14);
      this.menuKeys.upgrade = doUpgrade;
      b.setEnabled(this.energy >= cost);
      container.add(b.container);
      // 下一级造型预览
      // 预览放在按钮旁边，箭头和按钮之间留出空隙
      const right = bx + 124 < WIDTH;
      const px = right ? bx + 96 : bx - 96;
      const preview = this.add.circle(px, upY, 22, 0xfffaf0).setStrokeStyle(3, 0x3cb35a);
      const icon = this.add.image(px, upY, towerTexture(tower.kind, tower.level + 1));
      icon.setScale(36 / icon.width);
      const arrow = this.add.text(right ? px - 28 : px + 28, upY, right ? '›' : '‹', { fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#2f8f5a', strokeThickness: 4 }).setOrigin(0.5);
      container.add([arrow, preview, icon]);
      this.tweens.add({ targets: icon, scale: icon.scale * 1.12, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    const sell = makeButton(this, bx, sellY, 120, 36, `出售 +${tower.sellValue} [S]`, 0xe0533a, () => this.sell(tower), 14);
    this.menuKeys.sell = () => this.sell(tower);
    container.add(sell.container);

    label.setY(upY - 42);
    if (label.y - label.displayHeight / 2 < MAP_Y + 4) label.setY(sellY + 42);

    container.setAlpha(0);
    this.tweens.add({ targets: container, alpha: 1, duration: 120 });
    this.menu = container;
    this.menuCell = cellKey(tower.c, tower.r);
    this.menuKind = 'tower';
  }

  // ───────────────────────── 技能 ─────────────────────────

  /** 紧急供电给的能量，随波次增加 */
  private get powerBonus() {
    return 60 + 15 * this.waveIndex;
  }

  /** 返回 false 表示现在不能用（不进入冷却） */
  private useSkill(id: SkillId): boolean {
    if (this.paused || this.isOver()) return false;
    const fighting = this.state === 'wave' && this.enemies.some((e) => e.alive);
    switch (id) {
      case 'fan': {
        if (!fighting) return this.skillDenied('场上没有怪物');
        this.fanTime = 5;
        // 横扫全图的风
        for (let i = 0; i < 18; i++) {
          const y = Phaser.Math.Between(MAP_Y + 20, MAP_BOTTOM - 20);
          const x = Phaser.Math.Between(-200, WIDTH - 100);
          const line = this.add.rectangle(x, y, Phaser.Math.Between(80, 180), 4, 0xd8f6ff, 0.7).setDepth(13000);
          this.tweens.add({ targets: line, x: x + 360, alpha: 0, duration: 700, delay: i * 25, ease: 'Cubic.Out', onComplete: () => line.destroy() });
        }
        this.floatText(WIDTH / 2, MAP_Y + 120, '🌀 散热风扇：全场减速！', '#d8f6ff', 22);
        sfx.play('shield');
        return true;
      }
      case 'reset': {
        if (!fighting) return this.skillDenied('场上没有怪物');
        this.freezeTime = 2;
        for (const t of this.towers.values()) {
          if (t.stun > 0) {
            t.stun = 0;
            this.floatText(t.x, t.y - 40, '复位!', '#9fd4ff', 15);
          }
        }
        this.cameras.main.flash(220, 170, 220, 255);
        this.floatText(WIDTH / 2, MAP_Y + 120, '🔁 系统复位：全场定住！', '#9fd4ff', 22);
        sfx.play('zap');
        return true;
      }
      case 'power': {
        if (this.lives <= 1) return this.skillDenied('生命太少，不能再透支了');
        const bonus = this.powerBonus;
        this.lives -= 1;
        this.energy += bonus;
        this.coinFly(this.core.x, this.core.y - 20, bonus);
        this.floatText(this.core.x, this.core.y - 50, `+⚡${bonus}  -1❤`, '#ffe14d', 18);
        this.tweens.add({ targets: this.core, angle: { from: -8, to: 8 }, duration: 60, yoyo: true, repeat: 3, onComplete: () => this.core.setAngle(0) });
        sfx.play('upgrade');
        this.refreshHud();
        return true;
      }
    }
  }

  private skillDenied(reason: string) {
    this.floatText(WIDTH / 2, MAP_BOTTOM - 40, reason, '#ffb3b3', 16);
    return false;
  }

  // ───────────────────────── 障碍物 ─────────────────────────

  private showObstacleTip(o: Obstacle) {
    const gift = o.gift ? `\n🎁 里面藏着一座${o.gift.name}` : '';
    const action = this.marked === o ? '已标记，再点一次取消' : '点击标记：波次进行时，射程内的塔优先拆它';
    this.hoverTip.setText(`${o.name}  拆除得 ⚡${o.reward}${gift}\n${action}`);
    const x = Phaser.Math.Clamp(o.x, this.hoverTip.width / 2 + 4, WIDTH - this.hoverTip.width / 2 - 4);
    const above = o.y - 40 - this.hoverTip.height > MAP_Y;
    this.hoverTip.setOrigin(0.5, above ? 1 : 0).setPosition(x, above ? o.y - 40 : o.y + 34).setVisible(true);
  }

  private toggleFocus(o: Obstacle) {
    this.marked = this.marked === o ? null : o;
    this.focusClock = 0;
    sfx.play(this.marked ? 'lock' : 'click');
    if (this.hoverTip.visible) this.showObstacleTip(o);
  }

  /** 标记：红色准星 + 上下跳动的箭头 */
  private drawFocus(dt: number) {
    const g = this.focusG;
    g.clear();
    const o = this.marked;
    if (!o || !o.alive) return;
    this.focusClock += dt;
    const pulse = 1 + Math.sin(this.focusClock * 6) * 0.08;
    const r = 30 * pulse;
    g.lineStyle(3, 0xff4d4d, 0.95).strokeCircle(o.x, o.y - 4, r);
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + this.focusClock * 1.5;
      g.lineBetween(o.x + Math.cos(a) * (r - 8), o.y - 4 + Math.sin(a) * (r - 8), o.x + Math.cos(a) * (r + 6), o.y - 4 + Math.sin(a) * (r + 6));
    }
    const ay = o.y - 44 - Math.abs(Math.sin(this.focusClock * 4)) * 6;
    g.fillStyle(0xff4d4d, 1).fillTriangle(o.x - 9, ay - 10, o.x + 9, ay - 10, o.x, ay);
  }

  private damageObstacle(o: Obstacle, amount: number, from?: { x: number; y: number }, showNumber = true) {
    const a = Math.min(amount, o.hp);
    this.credit(a, false);
    o.hp -= amount;
    if (from) {
      o.flash();
      if (showNumber) this.damageNumber(o.x, o.y - 44, amount);
    }
    if (o.hp <= 0) this.clearObstacle(o);
  }

  /** 拆掉障碍物：给能量、空出格子，藏着的塔直接建好 */
  private clearObstacle(o: Obstacle) {
    if (o.dead) return;
    o.destroy();
    this.obstacles.delete(o.key);
    this.blocked.delete(o.key);
    if (this.marked === o) this.marked = null;
    this.hoverTip.setVisible(false);
    this.energy += o.reward;
    this.coinFly(o.x, o.y - 10, o.reward);
    this.floatText(o.x, o.y - 40, `+⚡${o.reward}`, '#ffe14d', 18);
    this.burst(o.x, o.y - 6, 0xd4ae6c, 16, 46);
    this.burst(o.x, o.y - 6, 0xffffff, 8, 30);
    sfx.play('bigPop');
    const gift = o.def.gift;
    if (gift) {
      const tower = new Tower(this, gift, o.def.c, o.def.r, o.x, o.y);
      this.towers.set(o.key, tower);
      this.giftTowers.add(tower);
      this.banner(`拆出一座「${TOWERS[gift].name}」！`, 0xd0782a, 3000, gift);
      sfx.play('upgrade');
    }
    this.refreshHud();
  }

  private build(kind: TowerKind, c: number, r: number) {
    const cost = TOWERS[kind].levels[0].cost;
    if (this.energy < cost) return;
    this.energy -= cost;
    const p = cellCenter(c, r);
    this.towers.set(cellKey(c, r), new Tower(this, kind, c, r, p.x, p.y));
    const ch = this.level.challenge;
    if (ch?.kind === 'noTower' && ch.tower === kind) this.failChallenge();
    if (ch?.kind === 'maxTowers' && this.towers.size - this.giftTowers.size > ch.n) this.failChallenge();
    this.burst(p.x, p.y, 0xffffff, 8);
    sfx.play('build');
    this.closeMenu();
    this.refreshHud();
  }

  /** 挑战条件被打破时提示一次 */
  private failChallenge() {
    if (!this.challengeOk || !this.level.challenge) return;
    this.challengeOk = false;
    if (!hasBadge(this.level.id)) this.banner(`挑战失败：${challengeText(this.level.challenge)}（仍可正常通关）`, 0x8a5a2a, 3500);
  }

  private sell(tower: Tower) {
    this.energy += tower.sellValue;
    this.floatText(tower.x, tower.y - 30, `+${tower.sellValue}⚡`, '#ffe14d');
    this.burst(tower.x, tower.y, 0xd4ae6c, 10);
    sfx.play('sell');
    tower.destroy();
    this.giftTowers.delete(tower);
    this.towers.delete(cellKey(tower.c, tower.r));
    this.closeMenu();
    this.refreshHud();
  }

  // ───────────────────────── 波次 ─────────────────────────

  private startWave() {
    const total = this.totalWaves;
    if (this.canCallEarly) {
      // 提前开波：当前波的清波奖励立即发放，外加提前奖励
      const bonus = waveBonus(this.waveIndex) + this.earlyBonus;
      this.energy += bonus;
      this.coinFly(this.startBtn.container.x, this.startBtn.container.y + 30, bonus);
      this.floatText(this.startBtn.container.x, this.startBtn.container.y + 44, `提前开波 +⚡${bonus}`, '#ffe14d', 18);
      this.earlyCalls++;
      // 跳过等待的那一波也计入无尽模式分数
      if (this.level.endless) this.score += this.waveIndex * WAVE_SCORE;
    } else if (this.state !== 'build' || this.waveIndex >= total) return;
    const wave = this.waveDef(this.waveIndex);
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
    const last = this.waveIndex === total;
    const boss = wave.some((grp) => grp.kind === 'esd');
    sfx.play('waveStart');
    this.banner(
      last ? `最终波！第 ${this.waveIndex} 波来袭` : boss && this.level.endless ? `第 ${this.waveIndex} 波：BOSS 来袭！` : `第 ${this.waveIndex} 波来袭！`,
      last || boss ? 0xc6331f : 0xe08a2e,
    );
  }

  private spawn(kind: EnemyKind, path: number) {
    const def = ENEMIES[kind];
    // Boss 只吃一半的波次成长，否则后期 Boss 血量膨胀过快
    const base = this.level.endless
      ? endlessHpScale(this.waveIndex) * (this.level.endlessHp ?? 1) - 1
      : this.level.hpGrowth * (this.waveIndex - 1);
    const hpScale = 1 + base * (def.boss ? 0.5 : 1);
    const track = this.tracks[Math.min(path, this.tracks.length - 1)];
    if (!this.seen.has(kind)) {
      this.seen.add(kind);
      markSeen(kind);
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
    if (this.level.endless) this.score += this.waveIndex * WAVE_SCORE;
    if (this.waveIndex >= this.totalWaves) {
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
    this.tutorial?.update(delta / 1000);
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
      this.refreshStartBtn();
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
    if (this.fanTime > 0 || this.freezeTime > 0) {
      for (const e of this.enemies) e.slow = this.freezeTime > 0 ? 0 : Math.min(e.slow, 0.5);
      this.fanTime = Math.max(0, this.fanTime - dt);
      this.freezeTime = Math.max(0, this.freezeTime - dt);
    }
    if (this.state === 'wave') this.bar.tick(dt);

    for (const e of this.enemies) {
      e.update(dt);
      if (e.def.boss) this.bossAbility(e, dt);
    }
    // Boss 在场时切换成紧张的配乐
    music.play(this.enemies.some((e) => e.def.boss && e.alive) ? 'boss' : 'battle');
    for (const t of this.towers.values()) {
      this.acting = t;
      t.update(dt);
    }
    this.acting = null;
    this.updateProjectiles(dt);
    for (const o of this.obstacles.values()) o.update(dt);
    this.drawFocus(dt);
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

  fireProjectile(tower: Tower, target: Target) {
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
          .setData('transient', true)
      : this.add.circle(sx, sy, 7 + tower.level * 1.5, color).setStrokeStyle(3, Phaser.Display.Color.ValueToColor(color).darken(30).color);
    obj.setDepth(12000);
    this.projectiles.push({ obj, tower, target, damage: tower.stats.damage, trail: 0 });
    sfx.play(adc ? 'adc' : 'amp');

    // 枪口闪光
    const flash = this.add.circle(sx, sy, 12 + tower.level * 2, color, 0.7).setDepth(12001);
    this.tweens.add({ targets: flash, scale: 1.8, alpha: 0, duration: 120, onComplete: () => flash.destroy() });
  }

  /** 混频器子弹：中间带 ⊗ 的圆环；边带子弹更小 */
  private launchMixer(tower: Tower, x: number, y: number, target: Target, damage: number, sideband: boolean) {
    const r = sideband ? 6 : 9 + tower.level * 1.5;
    const obj = this.add.circle(x, y, r, 0xffffff).setStrokeStyle(sideband ? 3 : 4, tower.color).setDepth(12000);
    this.projectiles.push({ obj, tower, target, damage, sideband, trail: 0 });
  }

  /** 混频：主子弹命中后向附近另外两只怪分出上下边带 */
  private sidebands(p: Projectile, hit: Target) {
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

  private hit(p: Projectile, t: Target, from: { x: number; y: number }) {
    this.acting = p.tower;
    const dodge = t instanceof Enemy ? (t.def.dodge ?? 0) : 0;
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
    if (adc && t instanceof Enemy && t.alive && !t.def.boss && t.hp <= t.maxHp * threshold) this.kill(t, true);
    this.acting = null;
  }

  damage(e: Target, amount: number, from?: { x: number; y: number }, showNumber = true) {
    if (!e.alive) return;
    if (e instanceof Obstacle) {
      this.damageObstacle(e, amount, from, showNumber);
      return;
    }
    let a = amount * e.mark * (1 - (e.def.armor ?? 0));
    const p = e.partner;
    if (p && p.alive) {
      a /= 2;
      this.applyHp(p, a, from);
    }
    if (from && showNumber) this.damageNumber(e.x, e.y - e.def.size / 2 - 14, a);
    this.applyHp(e, a, from);
  }

  private credit(dealt: number, killed: boolean) {
    const t = this.acting;
    if (!t) return;
    const r = this.record.get(t) ?? { damage: 0, kills: 0 };
    r.damage += dealt;
    if (killed) r.kills++;
    this.record.set(t, r);
  }

  private applyHp(e: Enemy, a: number, from?: { x: number; y: number }) {
    if (!e.alive) return;
    this.credit(Math.min(a, e.hp), a >= e.hp);
    e.hp -= a;
    if (from) e.flash(from.x, from.y);
    if (e.hp <= 0) this.kill(e, false);
  }

  private damageNumber(x: number, y: number, a: number) {
    if (this.damageTexts > 25) return;
    const big = a >= 30;
    const t = this.add
      .text(x + Phaser.Math.Between(-10, 10), y, `${Math.round(a)}`, {
        fontFamily: 'Arial', fontSize: big ? '20px' : '14px', fontStyle: 'bold',
        color: big ? '#ffd23f' : '#ffffff', stroke: '#3a2a5a', strokeThickness: big ? 5 : 4,
      })
      .setOrigin(0.5)
      .setDepth(14000)
      .setScale(big ? 1.5 : 1.2)
      .setData('transient', true);
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
    // ADC 量化斩杀：剩余血量也算作它的输出
    if (quantized) this.credit(Math.max(0, e.hp), true);
    e.dead = true;
    this.energy += e.def.reward;
    if (this.level.endless) this.score += e.def.reward * KILL_SCORE;
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
              // 在 fit() 缩放的基础上弹一下
              const base = Math.min(1, (this.energyText.getData('fitW') as number) / this.energyText.width);
              this.energyText.setScale(base * 1.18);
              this.tweens.add({ targets: this.energyText, scale: base, duration: 120 });
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
    v.lineStyle(36, 0xff2a2a, 0.45).strokeRect(0, MAP_Y, WIDTH, MAP_BOTTOM - MAP_Y);
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

  /** 无尽模式结算：分数、最高纪录 */
  private finishEndless(
    layer: Phaser.GameObjects.Container,
    shade: Phaser.GameObjects.Rectangle,
    g: Phaser.GameObjects.Graphics,
    title: Phaser.GameObjects.Text,
    coreImg: Phaser.GameObjects.Image,
    panelText: (t: Phaser.GameObjects.Text) => void,
  ) {
    const prev = endlessBest(this.level.id);
    const record = recordEndless(this.level.id, this.waveIndex, this.score);
    title.setColor('#4a3a8a');
    const score = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 40, `${this.score} 分`, { fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: '#ffc21f', stroke: '#a87400', strokeThickness: 4 })
      .setOrigin(0.5);
    const best = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 10, record ? (prev ? `新纪录！之前最高 ${prev.score} 分` : '首个纪录！') : `最高纪录：第 ${prev!.wave} 波 · ${prev!.score} 分`, {
        fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: record ? '#c6331f' : '#6b5a3a',
      })
      .setOrigin(0.5);
    panelText(score);
    panelText(best);
    coreImg.setPosition(WIDTH / 2, HEIGHT / 2 + 56).setTint(0x777777).setAngle(-15);
    const buttons = [
      makeButton(this, WIDTH / 2 - 70, HEIGHT / 2 + 118, 120, 46, '选关', 0x5c6b85, () => this.scene.start('Menu'), 18),
      makeButton(this, WIDTH / 2 + 70, HEIGHT / 2 + 118, 120, 46, '再来一次', 0x3cb35a, () => this.scene.restart({ levelId: this.level.id }), 18),
    ];
    layer.add([shade, g, title, score, best, coreImg, ...buttons.map((b) => b.container)]);
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 300 });
  }

  private floatText(x: number, y: number, text: string, color: string, size = 16) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#00000088', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(14000)
      .setData('transient', true);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 800, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  /** icon 是贴图 key：新怪物或新解锁的塔 */
  private banner(text: string, color: number, duration = 2200, icon?: string) {
    // 最多同时显示 3 条，挤掉最早的
    while (this.banners.length >= 3) this.banners.shift()!.destroy();
    this.banners.forEach((b, i) => b.setY(MAP_Y + 46 + i * 52));
    const y = MAP_Y + 40 + this.banners.length * 52;
    const label = this.add.text(icon ? 22 : 0, 0, text, { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5);
    // 横幅最宽到画面两侧各留 20，文字太长就缩小
    const extra = icon ? 84 : 48;
    fit(label, WIDTH - 40 - extra);
    const w = label.displayWidth + extra;
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

  /**
   * 结算时在右边加一张战报：输出最高的 5 座塔（含卖掉的）。
   * 结算面板整体左移，两张面板一起居中。
   */
  private addReport(layer: Phaser.GameObjects.Container, shade: Phaser.GameObjects.GameObject) {
    const rows = [...this.record].filter(([, r]) => r.damage >= 1).sort((a, b) => b[1].damage - a[1].damage).slice(0, 5);
    if (rows.length === 0) return;
    const w = 380;
    const h = 300;
    const dx = (w + 20) / 2;
    for (const o of layer.list) {
      if (o === shade) continue;
      const obj = o as unknown as { x: number; setX(x: number): void; getData?(k: string): unknown; setData?(k: string, v: unknown): void };
      obj.setX(obj.x - dx);
      const box = obj.getData?.('box') as { x: number } | undefined;
      if (box) obj.setData?.('box', { ...box, x: box.x - dx });
    }
    const x0 = WIDTH / 2 + 220 - dx + 20;
    const y0 = HEIGHT / 2 - h / 2;
    const g = this.add.graphics();
    g.fillStyle(0xfffaf0, 1).fillRoundedRect(x0, y0, w, h, 28);
    g.lineStyle(5, 0x4f7fd1, 1).strokeRoundedRect(x0, y0, w, h, 28);
    const box = { x: x0 + 16, y: y0, w: w - 32, h };
    const title = this.add.text(x0 + 24, y0 + 32, '📊 战报：输出排行', { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#2a4f8a' }).setOrigin(0, 0.5);
    layer.add([g, fit(title, w - 48, box)]);
    const max = rows[0][1].damage;
    const alive = new Set(this.towers.values());
    rows.forEach(([t, r], i) => {
      const y = y0 + 80 + i * 46;
      const icon = this.add.image(x0 + 44, y, towerTexture(t.kind, t.level));
      icon.setScale(38 / Math.max(icon.width, icon.height));
      if (!alive.has(t)) icon.setAlpha(0.5);
      const tag = `${i === 0 ? '👑 ' : ''}${t.def.name} Lv.${t.level + 1}${this.giftTowers.has(t) ? ' 🎁' : ''}${alive.has(t) ? '' : '（已卖）'}`;
      const name = fit(this.add.text(x0 + 74, y - 9, tag, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#3a2a1a' }).setOrigin(0, 0.5), 170, box);
      const bar = this.add.graphics();
      bar.fillStyle(0xe6dcc4, 1).fillRoundedRect(x0 + 74, y + 7, 170, 8, 4);
      bar.fillStyle(t.color, 1).fillRoundedRect(x0 + 74, y + 7, Math.max(8, (170 * r.damage) / max), 8, 4);
      const nums = fit(
        this.add
          .text(x0 + w - 22, y, `${Math.round(r.damage)}\n击杀 ${r.kills}`, { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#6b5a3a', align: 'right', lineSpacing: 2 })
          .setOrigin(1, 0.5),
        w - 22 - 74 - 170 - 8 - 16,
        box,
      );
      layer.add([icon, name, bar, nums]);
    });
  }

  private finish(won: boolean) {
    this.state = won ? 'won' : 'lost';
    music.stop();
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
    const coreImg0 = () => this.add.image(WIDTH / 2, HEIGHT / 2 + 40, 'core').setScale(60 / this.core.width);
    const panelText = <T extends Phaser.GameObjects.Text>(t: T) => fit(t, 400, { x: WIDTH / 2 - 200, y: HEIGHT / 2 - 150, w: 400, h: 300 });
    const title = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 100, won ? '芯片守住了！' : this.level.endless ? `坚持到第 ${this.waveIndex} 波` : '芯片失效了…', { fontFamily: FONT, fontSize: '36px', fontStyle: 'bold', color: won ? '#2f8f5a' : '#c6331f' })
      .setOrigin(0.5);
    panelText(title);
    this.tutorial?.finish();
    if (this.level.endless) {
      this.finishEndless(layer, shade, g, title, coreImg0(), panelText);
      this.addReport(layer, shade);
      return;
    }
    const max = this.level.lives;
    const starCount = won ? (this.lives >= max ? 3 : this.lives >= max / 2 ? 2 : 1) : 0;
    if (won) recordWin(this.level.id, starCount);
    // 挑战：通关且全程满足条件
    const ch = this.level.challenge;
    if (ch?.kind === 'earlyCalls' && this.earlyCalls < ch.n) this.challengeOk = false;
    const badge = won && !!ch && this.challengeOk;
    if (badge) recordBadge(this.level.id);
    const stars = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 30, won ? '★'.repeat(starCount) + '☆'.repeat(3 - starCount) : `坚持到第 ${this.waveIndex} 波`, {
        fontFamily: FONT, fontSize: won ? '52px' : '22px', color: won ? '#ffc21f' : '#6b5a3a', stroke: won ? '#a87400' : '#00000000', strokeThickness: won ? 4 : 0,
      })
      .setOrigin(0.5);
    panelText(stars);
    const coreImg = coreImg0().setY(HEIGHT / 2 + 40);
    if (!won) coreImg.setTint(0x777777).setAngle(-15);
    // 挑战结果要在面板背景之后加进来，否则会被盖住
    let challengeLine: Phaser.GameObjects.Text | null = null;
    if (won && ch) {
      challengeLine = panelText(
        this.add
          .text(WIDTH / 2, HEIGHT / 2 + 82, `${badge ? '🏅 挑战完成' : '挑战未完成'}：${challengeText(ch)}`, {
            fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: badge ? '#b8860b' : '#9a8a6a',
          })
          .setOrigin(0.5),
      );
    }
    const idx = LEVELS.findIndex((l) => l.id === this.level.id);
    const next = won ? LEVELS[idx + 1] : undefined;
    const buttons: Button[] = [
      makeButton(this, 0, 0, 120, 46, '选关', 0x5c6b85, () => this.scene.start('Menu'), 18),
      makeButton(this, 0, 0, 120, 46, won ? '重玩' : '重试', won ? 0x4f7fd1 : 0x3cb35a, () => this.scene.restart({ levelId: this.level.id }), 18),
    ];
    if (next) buttons.push(makeButton(this, 0, 0, 120, 46, '下一关 ▶', 0x3cb35a, () => this.scene.start('Game', { levelId: next.id }), 18));
    buttons.forEach((b, i) => b.container.setPosition(WIDTH / 2 + (i - (buttons.length - 1) / 2) * 136, HEIGHT / 2 + 118));
    if (won && !next) stars.setY(HEIGHT / 2 - 40);
    layer.add([shade, g, title, stars, coreImg, ...buttons.map((b) => b.container)]);
    if (challengeLine) layer.add(challengeLine);
    if (won && !next) {
      layer.add(this.add.text(WIDTH / 2, HEIGHT / 2 + 4, '全部关卡通关！', { fontFamily: FONT, fontSize: '16px', color: '#6b5a3a' }).setOrigin(0.5));
      coreImg.setY(HEIGHT / 2 + 50);
    }
    this.addReport(layer, shade);
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 300 });
  }
}
