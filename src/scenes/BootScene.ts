import Phaser from 'phaser';
import { TOWER_ORDER } from '../config/towers';
import { towerTexture } from '../entities/Tower';
import { ENEMIES } from '../config/enemies';
import { WIDTH, HEIGHT } from '../config/map';
import { FONT } from '../ui';
import { RES, setupCamera } from '../display';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    setupCamera(this);
    const label = this.add
      .text(WIDTH / 2, HEIGHT / 2, '加载中…', { fontFamily: FONT, fontSize: '24px', color: '#ffffff' })
      .setOrigin(0.5);
    this.load.on('progress', (v: number) => label.setText(`加载中… ${Math.round(v * 100)}%`));

    for (const kind of TOWER_ORDER) {
      for (let lv = 0; lv < 3; lv++) {
        const key = towerTexture(kind, lv);
        this.load.svg(key, `assets/towers/${key}.svg`, { width: 80 * RES, height: 80 * RES });
      }
    }
    for (const def of Object.values(ENEMIES)) {
      // 按显示尺寸 × RES 栅格化，保证高分辨率下清晰
      const size = def.boss ? { width: 130 * RES, height: 104 * RES } : { width: 72 * RES, height: 72 * RES };
      this.load.svg(def.kind, `assets/enemies/${def.kind}.svg`, size);
    }
    this.load.svg('core', 'assets/core.svg', { width: 96 * RES, height: 96 * RES });
    for (const kind of ['cap', 'res', 'ram', 'ind']) this.load.svg(`prop-${kind}`, `assets/props/${kind}.svg`, { width: 64 * RES, height: 64 * RES });
  }

  create() {
    this.scene.start('Menu');
  }
}
