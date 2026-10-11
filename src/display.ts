import Phaser from 'phaser';
import { WIDTH, HEIGHT } from './config/map';

/**
 * 渲染倍率。游戏逻辑仍使用 1024×640 的坐标，画布按 RES 倍分辨率渲染，
 * 再由相机缩放回来，这样在 Retina 屏和放大的窗口里都清晰。
 */
export const RES = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));

/** 每个场景在 create 开头调用：让相机按 RES 倍显示 1024×640 的世界 */
export function setupCamera(scene: Phaser.Scene) {
  scene.cameras.main.setZoom(RES).centerOn(WIDTH / 2, HEIGHT / 2);
}

/** 所有 scene.add.text 创建的文字都按 RES 倍分辨率栅格化 */
export function patchTextResolution() {
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (...args: unknown[]) => Phaser.GameObjects.Text;
  };
  const original = factory.text;
  factory.text = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args).setResolution(RES);
  };
}
