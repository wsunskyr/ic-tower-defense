import Phaser from 'phaser';
import { sfx } from './audio';

export const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';

/** 文字允许占用的区域，坐标与文字所在的父容器一致 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 把文字限制在固定宽度（和可选的框）内：超宽时等比缩小。
 * 文字内容改变后要重新调用。框信息记在文字上，开发模式的 UI 审查（dev/uiAudit.ts）据此检查是否越界。
 */
export function fit<T extends Phaser.GameObjects.Text>(t: T, maxW: number, box?: Box): T {
  t.setScale(1);
  if (t.width > maxW) t.setScale(maxW / t.width);
  t.setData('fitW', maxW);
  if (box) t.setData('box', box);
  return t;
}

/** 量一组文字在某个样式下的最大宽度，用来决定面板该多宽 */
export function measureMax(scene: Phaser.Scene, lines: string[], style: Phaser.Types.GameObjects.Text.TextStyle) {
  const probe = scene.add.text(0, 0, '', style).setVisible(false);
  let max = 0;
  for (const line of lines) max = Math.max(max, probe.setText(line).width);
  probe.destroy();
  return max;
}

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
  // 左右各留一点内边距，标签再长也不会顶出按钮
  const pad = Math.min(12, h * 0.3);
  const box = { x: -w / 2 + pad, y: -h / 2, w: w - pad * 2, h };
  fit(text, box.w, box);
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
    setLabel: (l) => {
      fit(text.setText(l), box.w, box);
    },
    setEnabled: (e) => {
      enabled = e;
      draw(e ? fill : 0x8a8f99);
      container.setAlpha(e ? 1 : 0.75);
    },
  };
}
