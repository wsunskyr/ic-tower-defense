import Phaser from 'phaser';
import { WIDTH, HEIGHT } from './config/map';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { sfx } from './audio';
import { RES, patchTextResolution } from './display';

patchTextResolution();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // 按 RES 倍分辨率渲染，各场景的相机再缩放回 1024×640 的世界坐标
  width: WIDTH * RES,
  height: HEIGHT * RES,
  backgroundColor: '#2d4a22',
  antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, GameScene],
});

// 开发调试用：方便在控制台检查游戏状态
if (import.meta.env.DEV) {
  Object.assign(window, { __game: game, __sfx: sfx });
  void import('./dev/bot').then((m) => m.installBot(game));
}
