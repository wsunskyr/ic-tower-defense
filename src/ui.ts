import Phaser from 'phaser';
import { sfx } from './audio';

export const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

export interface Button {
  container: Phaser.GameObjects.Container;
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
}

/** 圆角按钮，(x, y) 为中心点 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  fill: number,
  onClick: () => void,
  fontSize = 18,
): Button {
  const bg = scene.add.graphics();
  const draw = (color: number) => {
    bg.clear();
    bg.fillStyle(0x000000, 0.25).fillRoundedRect(-w / 2, -h / 2 + 3, w, h, h / 2);
    bg.fillStyle(color, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    bg.lineStyle(2, 0xffffff, 0.5).strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, h / 2 - 2);
  };
  draw(fill);
  const text = scene.add
    .text(0, 0, label, { fontFamily: FONT, fontSize: `${fontSize}px`, color: '#ffffff', fontStyle: 'bold', stroke: '#00000055', strokeThickness: 3 })
    .setOrigin(0.5);
  const zone = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
  const container = scene.add.container(x, y, [bg, text, zone]);

  let enabled = true;
  zone.on('pointerover', () => enabled && container.setScale(1.05));
  zone.on('pointerout', () => container.setScale(1));
  zone.on('pointerdown', () => {
    if (!enabled) return;
    container.setScale(0.95);
    sfx.unlock();
    sfx.play('click');
    onClick();
  });
  zone.on('pointerup', () => container.setScale(1));

  return {
    container,
    setLabel: (l) => text.setText(l),
    setEnabled: (e) => {
      enabled = e;
      draw(e ? fill : 0x8a8f99);
      container.setAlpha(e ? 1 : 0.75);
    },
  };
}
