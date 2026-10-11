/**
 * 开发用的 UI 审查：扫描当前所有场景里可见的文字，找出
 *  1. 超过 fit() 登记宽度的文字（多半是 setText 之后忘了重新 fit）
 *  2. 超出 fit() 登记框的文字
 *  3. 跑出画布的文字
 *  4. 同一层里互相重叠的文字
 *  5. 被 fit() 缩到 80% 以下、看不清的文字
 * 控制台用法：__ui.audit('场景说明') → 问题列表（空数组表示没问题）
 */
import Phaser from 'phaser';
import { WIDTH, HEIGHT } from '../config/map';

type Rect = { x: number; y: number; w: number; h: number };

interface Found {
  t: Phaser.GameObjects.Text;
  world: Rect;
  /** 所在的最顶层容器的深度，用来区分 UI 层 */
  layer: number;
}

const EPS = 1;

function visibleChain(o: Phaser.GameObjects.GameObject): boolean {
  let cur: Phaser.GameObjects.GameObject | null = o;
  while (cur) {
    const v = cur as unknown as { visible?: boolean; alpha?: number; active?: boolean };
    if (v.visible === false || v.alpha === 0 || v.active === false) return false;
    cur = cur.parentContainer;
  }
  return true;
}

function collect(list: Phaser.GameObjects.GameObject[], layer: number | null, out: Found[]) {
  for (const o of list) {
    const depth = layer ?? (o as unknown as { depth: number }).depth ?? 0;
    if (o instanceof Phaser.GameObjects.Container) {
      collect(o.list, depth, out);
    } else if (o instanceof Phaser.GameObjects.Text && o.text.trim() !== '' && !o.getData('transient') && visibleChain(o)) {
      const b = o.getBounds();
      out.push({ t: o, world: { x: b.x, y: b.y, w: b.width, h: b.height }, layer: depth });
    }
  }
}

/** 文字在父容器坐标系里的范围 */
function localRect(t: Phaser.GameObjects.Text): Rect {
  const w = t.displayWidth;
  const h = t.displayHeight;
  return { x: t.x - t.originX * w, y: t.y - t.originY * h, w, h };
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export function installUiAudit(game: Phaser.Game) {
  const audit = (label = '') => {
    const found: Found[] = [];
    for (const scene of game.scene.getScenes(true)) collect(scene.children.list, null, found);
    const issues: string[] = [];
    const name = (f: Found) => `「${f.t.text.replace(/\n/g, '⏎').slice(0, 24)}」`;

    for (const f of found) {
      const t = f.t;
      const fitW = t.getData('fitW') as number | undefined;
      if (fitW !== undefined && t.displayWidth > fitW + EPS) issues.push(`超宽 ${name(f)} ${t.displayWidth.toFixed(0)} > ${fitW.toFixed(0)}`);
      // 缩得太小就看不清了，这种情况应该加宽容器或换行
      if (fitW !== undefined && t.scaleX < 0.8) issues.push(`缩小过多 ${name(f)} ×${t.scaleX.toFixed(2)}`);
      const box = t.getData('box') as Rect | undefined;
      if (box) {
        const r = localRect(t);
        if (r.x < box.x - EPS || r.y < box.y - EPS || r.x + r.w > box.x + box.w + EPS || r.y + r.h > box.y + box.h + EPS) {
          issues.push(`出框 ${name(f)} 文字(${r.x.toFixed(0)},${r.y.toFixed(0)},${r.w.toFixed(0)}×${r.h.toFixed(0)}) 框(${box.x.toFixed(0)},${box.y.toFixed(0)},${box.w.toFixed(0)}×${box.h.toFixed(0)})`);
        }
      }
      const w = f.world;
      if (w.x < -EPS || w.y < -EPS || w.x + w.w > WIDTH + EPS || w.y + w.h > HEIGHT + EPS) {
        issues.push(`出画布 ${name(f)} (${w.x.toFixed(0)},${w.y.toFixed(0)},${w.w.toFixed(0)}×${w.h.toFixed(0)})`);
      }
    }
    // 同一 UI 层里的文字两两比较；重叠面积超过较小者的 15% 才算
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i];
        const b = found[j];
        if (Math.abs(a.layer - b.layer) > 600) continue;
        const area = overlap(a.world, b.world);
        const min = Math.min(a.world.w * a.world.h, b.world.w * b.world.h);
        if (area > min * 0.15) issues.push(`重叠 ${name(a)} × ${name(b)}`);
      }
    }
    return issues.map((s) => (label ? `[${label}] ${s}` : s));
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let t = performance.now();
  const frame = (n = 1) => {
    for (let i = 0; i < n; i++) {
      t += 50;
      game.step(t, 50);
    }
  };
  const issues: string[] = [];
  const check = (label: string) => issues.push(...audit(label));
  const menu = () => game.scene.getScene('Menu') as any;
  const gameScene = () => game.scene.getScene('Game') as any;
  /** 切换到某个场景（页面在后台时 rAF 停了，靠手动 step 推进） */
  const go = (key: string, data?: object) => {
    for (const sc of game.scene.getScenes(true)) game.scene.stop(sc.scene.key);
    game.scene.start(key, data);
  };
  const startLevel = (id: number) => {
    go('Game', { levelId: id });
    frame(3);
    const s = gameScene();
    // 横幅会定时消失，先清掉，单独测
    s.banners.forEach((b: any) => b.destroy());
    s.banners = [];
    return s;
  };

  /** 走一遍所有界面状态，返回发现的问题 */
  const runAll = async () => {
    issues.length = 0;
    // 结算界面会写存档，跑完后还原
    const saved = Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ic-td')).map((k) => [k, localStorage.getItem(k)!]));
    try {
      return await walk();
    } finally {
      for (const k of Object.keys(localStorage)) if (k.startsWith('ic-td')) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    }
  };
  const walk = async () => {
    const { LEVELS } = await import('../config/levels');
    const { ENDLESS } = await import('../config/endless');
    const { TOWERS, TOWER_ORDER } = await import('../config/towers');
    const { ENEMIES } = await import('../config/enemies');
    const { openCodex } = await import('../codex');

    // 选关页、无尽选图、图鉴每一页
    go('Menu');
    frame(3);
    check('选关');
    const m = menu();
    const endless = m.openEndless(() => undefined);
    frame(2);
    check('无尽选图');
    endless.close();
    const codex = openCodex(m);
    frame(2);
    check('图鉴-热噪声');
    const zones = m.children.list.filter((o: any) => o instanceof Phaser.GameObjects.Container && o.depth === 50000)[0]?.list.filter((o: any) => o instanceof Phaser.GameObjects.Zone) ?? [];
    for (let i = 0; i < zones.length; i++) {
      zones[i].emit('pointerdown');
      frame(1);
      check(`图鉴-${Object.keys(ENEMIES)[i] ?? i}`);
    }
    codex.close();

    for (const level of [...LEVELS, ...ENDLESS]) {
      const s = startLevel(level.id);
      const tag = `L${level.id}`;
      // 极端的 HUD 数值
      s.energy = 99999;
      s.lives = 20;
      s.waveIndex = level.endless ? 123 : level.waves.length;
      s.score = 9999999;
      s.refreshHud();
      frame(1);
      check(`${tag} HUD`);
      s.waveIndex = 0;
      // 建造菜单：四个角和中间，悬停每种塔、能量不足提示
      const cells = [[0, 0], [15, 0], [0, 8], [15, 8], [7, 4]];
      for (const [c, r] of cells) {
        s.closeMenu();
        s.openBuildMenu(c, r);
        frame(4);
        check(`${tag} 建造菜单(${c},${r})`);
        const picks = s.menu.list.filter((o: any) => o instanceof Phaser.GameObjects.Arc);
        for (const p of picks) {
          p.emit('pointerover');
          check(`${tag} 建造悬停(${c},${r})`);
          p.emit('pointerdown', { wasTouch: true });
          check(`${tag} 触屏选中(${c},${r})`);
        }
      }
      s.closeMenu();
      s.energy = 0;
      s.openBuildMenu(7, 4);
      frame(4);
      s.menu.list.filter((o: any) => o instanceof Phaser.GameObjects.Arc)[0]?.emit('pointerdown', { wasTouch: false });
      check(`${tag} 能量不足`);
      s.closeMenu();
      s.energy = 99999;
      // 每种塔、每一级，放在四个角附近
      const free = (c: number, r: number) => !s.blocked.has(`${c},${r}`) && !s.towers.has(`${c},${r}`);
      const spots: [number, number][] = [];
      for (const [c0, r0] of [[0, 0], [15, 0], [0, 8], [15, 8], [8, 4]]) {
        let best: [number, number] | null = null;
        for (let d = 0; d < 6 && !best; d++)
          for (let c = Math.max(0, c0 - d); c <= Math.min(15, c0 + d) && !best; c++)
            for (let r = Math.max(0, r0 - d); r <= Math.min(8, r0 + d) && !best; r++) if (free(c, r)) best = [c, r];
        if (best) spots.push(best);
      }
      for (const kind of TOWER_ORDER.filter((k) => level.towers.includes(k))) {
        for (const [c, r] of spots) {
          s.build(kind, c, r);
          const tw = s.towers.get(`${c},${r}`);
          for (let lv = 0; lv < TOWERS[kind].levels.length; lv++) {
            s.closeMenu();
            s.openTowerMenu(tw);
            frame(2);
            check(`${tag} ${kind} Lv${lv + 1} 塔菜单(${c},${r})`);
            tw.upgrade();
          }
          s.closeMenu();
          s.sell(tw);
        }
      }
      frame(2);
      // 暂停菜单、暂停里的图鉴
      s.togglePause();
      frame(1);
      check(`${tag} 暂停`);
      s.togglePause();
      // 横幅：开局提示、新塔解锁、挑战、最长的怪物介绍
      go('Game', { levelId: level.id });
      frame(6);
      check(`${tag} 开局横幅`);
      for (const k of Object.keys(ENEMIES)) {
        gameScene().banner(`新干扰「${(ENEMIES as any)[k].name}」：${(ENEMIES as any)[k].intro}`, 0x6a55b5, 4500, k);
      }
      frame(2);
      check(`${tag} 怪物横幅`);
      // 结算：胜利（含挑战）、失败
      for (const won of level.endless ? [false] : [true, false]) {
        startLevel(level.id);
        const g = gameScene();
        g.waveIndex = level.endless ? 123 : level.waves.length;
        g.score = 9999999;
        g.lives = won ? g.level.lives : 0;
        g.finish(won);
        frame(2);
        check(`${tag} 结算${won ? '胜' : '负'}`);
      }
    }
    go('Menu');
    frame(2);
    return [...new Set(issues)];
  };

  (window as unknown as { __ui: unknown }).__ui = { audit, runAll };
}
