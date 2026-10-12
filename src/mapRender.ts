import Phaser from 'phaser';
import { CELL, COLS, ROWS, MAP_Y, MAP_BOTTOM, WIDTH, cellCenter, cellKey, pathCells } from './config/map';
import type { LevelDef } from './config/levels';

/** 不能建塔的格子：走线 + 障碍物 */
export function blockedCells(level: LevelDef): Set<string> {
  const set = pathCells(level.paths);
  for (const p of level.props) set.add(cellKey(p.c, p.r));
  return set;
}

/**
 * 在游戏坐标系里画出关卡地图（地面、走线、入口）。
 * detail=false 用于选关缩略图，省略格子提示和小花。
 */
export function drawLevelMap(g: Phaser.GameObjects.Graphics, level: LevelDef, detail = true) {
  const t = level.theme;
  g.fillStyle(t.ground, 1).fillRect(0, MAP_Y, WIDTH, MAP_BOTTOM - MAP_Y);

  const rnd = new Phaser.Math.RandomDataGenerator([`ic-td-${level.id}`]);
  for (let i = 0; i < 26; i++) {
    g.fillStyle(t.blob, 0.8).fillEllipse(rnd.between(0, WIDTH), rnd.between(MAP_Y, MAP_BOTTOM), rnd.between(60, 140), rnd.between(30, 70));
  }

  if (detail) {
    for (let i = 0; i < 60; i++) {
      g.fillStyle(rnd.pick([0xffffff, 0xffe066, 0xff9ec7]), 0.9).fillCircle(rnd.between(0, WIDTH), rnd.between(MAP_Y, MAP_BOTTOM), 2.5);
    }
    const blocked = blockedCells(level);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (blocked.has(cellKey(c, r))) continue;
        g.fillStyle(0xffffff, 0.07).fillRoundedRect(c * CELL + 4, MAP_Y + r * CELL + 4, CELL - 8, CELL - 8, 10);
      }
    }
  }

  const tracks = level.paths.map((wps) => wps.map(([c, r]) => cellCenter(c, r)));
  const stroke = (width: number, color: number) => {
    for (const pts of tracks) {
      g.lineStyle(width, color, 1);
      for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      g.fillStyle(color, 1);
      for (const p of pts) g.fillCircle(p.x, p.y, width / 2);
    }
  };
  stroke(54, t.pathEdge);
  stroke(44, t.path);

  if (detail) {
    g.lineStyle(3, t.dash, 1);
    for (const pts of tracks) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 0; d < len; d += 20) {
          const t0 = d / len;
          const t1 = Math.min(1, (d + 10) / len);
          g.lineBetween(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
        }
      }
    }
  }

  // 入口 Pad：画在走线进入地图的那条边上
  for (const wps of level.paths) {
    const [c, r] = wps[0];
    const p = cellCenter(Math.max(0, Math.min(COLS - 1, c)), Math.max(0, Math.min(ROWS - 1, r)));
    let rect: [number, number, number, number];
    if (c < 0) rect = [2, p.y - 26, 30, 52];
    else if (c >= COLS) rect = [WIDTH - 32, p.y - 26, 30, 52];
    else if (r < 0) rect = [p.x - 26, MAP_Y + 2, 52, 30];
    else rect = [p.x - 26, MAP_BOTTOM - 32, 52, 30];
    g.fillStyle(0xc8a83c, 1).fillRoundedRect(...rect, 6);
    g.lineStyle(3, 0x8a6d12, 1).strokeRoundedRect(...rect, 6);
    if (detail) {
      const [x, y, w, h] = rect;
      g.fillStyle(0x4a3a00, 1);
      // 用三角形箭头标出前进方向
      const cx = x + w / 2;
      const cy = y + h / 2;
      const [dc, dr] = [Math.sign(wps[1][0] - c), Math.sign(wps[1][1] - r)];
      g.fillTriangle(cx + dc * 8, cy + dr * 8, cx - dc * 5 - dr * 7, cy - dr * 5 - dc * 7, cx - dc * 5 + dr * 7, cy - dr * 5 + dc * 7);
    }
  }
}

/** 摆放障碍物图片 */
export function placeProps(scene: Phaser.Scene, level: LevelDef, x0 = 0, y0 = 0, scale = 1) {
  return level.props.map((p) => {
    const pos = cellCenter(p.c, p.r);
    const img = scene.add.image(x0 + pos.x * scale, y0 + (pos.y - 4) * scale, `prop-${p.kind}`);
    img.setScale((56 / img.width) * scale).setDepth(pos.y);
    return img;
  });
}
