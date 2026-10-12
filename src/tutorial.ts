import Phaser from 'phaser';
import { CELL, MAP_Y, MAP_BOTTOM, WIDTH, cellCenter } from './config/map';
import { FONT, fit, makeButton } from './ui';
import { finishTutorial } from './progress';

/** 引导需要读取的战场状态，由 GameScene 提供 */
export interface TutorialHost {
  readonly stage: Phaser.Scene;
  towerCount(): number;
  menuType(): 'build' | 'tower' | null;
  isWave(): boolean;
  waveIndex(): number;
  energy(): number;
  startButton(): { x: number; y: number };
  firstTower(): { x: number; y: number } | null;
}

interface Step {
  text: (h: TutorialHost) => string;
  /** 高亮目标：格子坐标、屏幕坐标或不高亮 */
  target: (h: TutorialHost) => { x: number; y: number; w: number; h: number } | null;
  done: (h: TutorialHost) => boolean;
}

const cellBox = (c: number, r: number) => {
  const p = cellCenter(c, r);
  return { x: p.x, y: p.y, w: CELL - 6, h: CELL - 6 };
};

/** 第 1 关的分步引导：建塔 → 再建一座 → 开波 → 拿能量 → 升级 */
const STEPS: Step[] = [
  {
    text: (h) => (h.menuType() === 'build' ? '选择「放大器」（⚡100）建造' : '点击发光的格子，在这里建一座防御塔'),
    target: (h) => (h.menuType() === 'build' ? null : cellBox(5, 3)),
    done: (h) => h.towerCount() >= 1,
  },
  {
    text: (h) => (h.menuType() === 'build' ? '选择「振荡器」：它会发出环形波，一次打一群' : '再建一座！振荡器适合放在拐角'),
    target: (h) => (h.menuType() === 'build' ? null : cellBox(3, 3)),
    done: (h) => h.towerCount() >= 2 || h.energy() < 100 || h.waveIndex() > 0,
  },
  {
    text: () => '点击「开始」（或按空格），怪物会沿着道路冲向芯片',
    target: (h) => ({ ...h.startButton(), w: 160, h: 48 }),
    done: (h) => h.waveIndex() >= 1,
  },
  {
    text: () => '击败怪物会获得能量 ⚡，清完一波还有额外奖励',
    target: () => null,
    done: (h) => !h.isWave(),
  },
  {
    text: () => '点击已经建好的塔，可以升级（更强、换造型）或出售',
    target: (h) => {
      const t = h.firstTower();
      return t ? { ...t, w: CELL - 6, h: CELL - 6 } : null;
    },
    done: (h) => h.menuType() === 'tower' || !h.firstTower(),
  },
  {
    text: () => '就这些！升级和建塔都要花能量，按自己的节奏来，祝你好运',
    target: () => null,
    done: () => false,
  },
];

export class Tutorial {
  private step = 0;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly arrow: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly bubble: Phaser.GameObjects.Graphics;
  private clock = 0;
  private finished = false;

  constructor(private readonly host: TutorialHost) {
    const scene = host.stage;
    this.frame = scene.add.graphics();
    this.arrow = scene.add
      .text(0, 0, '▼', { fontFamily: 'Arial', fontSize: '28px', color: '#ffe14d', stroke: '#7a5200', strokeThickness: 5 })
      .setOrigin(0.5, 1)
      // 引导箭头本来就要指着格子，不参与 UI 重叠检查
      .setData('transient', true);
    this.bubble = scene.add.graphics();
    this.label = scene.add
      .text(WIDTH / 2, MAP_BOTTOM - 44, '', { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    const skip = makeButton(scene, WIDTH - 70, MAP_BOTTOM - 44, 96, 32, '跳过引导', 0x5c6b85, () => this.finish(), 13);
    this.layer = scene.add.container(0, 0, [this.frame, this.arrow, this.bubble, this.label, skip.container]).setDepth(27000);
  }

  get active() {
    return !this.finished;
  }

  update(dt: number) {
    if (this.finished) return;
    const h = this.host;
    while (this.step < STEPS.length - 1 && STEPS[this.step].done(h)) {
      this.step++;
      this.clock = 0;
    }
    this.clock += dt;
    const s = STEPS[this.step];
    // 最后一步展示几秒后自动结束
    if (this.step === STEPS.length - 1 && this.clock > 5) {
      this.finish();
      return;
    }

    const text = `${this.step + 1}/${STEPS.length}  ${s.text(h)}`;
    if (this.label.text !== text) {
      // 气泡居中，右边不能碰到“跳过引导”按钮（左边缘 WIDTH-118）
      const maxW = 2 * (WIDTH / 2 - 126) - 40;
      fit(this.label.setText(text), maxW, { x: WIDTH / 2 - maxW / 2, y: MAP_BOTTOM - 66, w: maxW, h: 44 });
      const w = this.label.displayWidth + 40;
      this.bubble.clear();
      this.bubble.fillStyle(0x000000, 0.25).fillRoundedRect(WIDTH / 2 - w / 2, MAP_BOTTOM - 66 + 3, w, 44, 22);
      this.bubble.fillStyle(0x2a6fb8, 0.96).fillRoundedRect(WIDTH / 2 - w / 2, MAP_BOTTOM - 66, w, 44, 22);
    }

    // 高亮框呼吸闪烁 + 上下跳动的箭头（用自己的时钟，不依赖补间动画，暂停时也正常）
    const t = s.target(h);
    this.frame.clear();
    this.arrow.setVisible(!!t);
    if (!t) return;
    const pulse = 0.55 + Math.sin(this.clock * 6) * 0.35;
    this.frame.fillStyle(0xffe14d, 0.18 * pulse).fillRoundedRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h, 12);
    this.frame.lineStyle(4, 0xffe14d, pulse).strokeRoundedRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h, 12);
    const above = t.y - t.h / 2 - 6 > MAP_Y + 30;
    this.arrow.setText(above ? '▼' : '▲').setOrigin(0.5, above ? 1 : 0);
    const bob = Math.abs(Math.sin(this.clock * 5)) * 8;
    this.arrow.setPosition(t.x, above ? t.y - t.h / 2 - 4 - bob : t.y + t.h / 2 + 4 + bob);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    finishTutorial();
    this.layer.destroy();
  }
}
