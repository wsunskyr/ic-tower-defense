/**
 * 开发用的数值平衡测试：一个不认识地图的简单策略，按“覆盖走线格子最多”选位置建塔和升级，
 * 用 game.step 推进完整帧，不依赖页面可见。
 * 控制台用法：await __bot.run(3) 或后台 __bot.start(3)，再看 __bot.results
 * 注意：它会直接调用 GameScene 的私有成员，只用于测试。
 */
import type Phaser from 'phaser';
import { pathCells, cellKey, COLS, ROWS } from '../config/map';
import { blockedCells } from '../mapRender';
import { findLevel } from '../config/endless';
import { TOWERS, type TowerKind } from '../config/towers';
import { PROGRESS_KEY } from '../progress';

const PATTERN: TowerKind[] = ['amp', 'osc', 'filter', 'amp', 'adc', 'radar', 'mixer', 'pll', 'comparator', 'ldo', 'osc', 'mixer', 'adc', 'pll', 'comparator', 'radar', 'amp', 'ldo'];

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

export function installBot(game: Phaser.Game) {
  let t = performance.now();
  const frame = () => {
    t += 50;
    game.step(t, 50);
  };

  const run = async (id: number, capArg?: number) => {
    const L = findLevel(id);
    // 无尽模式里玩家会把地图铺满，允许建更多塔
    const cap = capArg ?? (L.endless ? 24 : 16);
    // 测试通关会写入星数存档，跑完后还原，避免污染玩家进度
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(PROGRESS_KEY);
    } catch {
      /* 忽略 */
    }
    const active = game.scene.getScenes(true)[0];
    active.scene.start('Game', { levelId: id });
    for (let i = 0; i < 5; i++) frame();
    const s = game.scene.getScene('Game') as any;
    s.toggleSpeed();

    const blocked = blockedCells(L);
    // 每条路径分别计数：多条路径共用的走线格子权重更高（所有怪都会经过）
    const path = L.paths.flatMap((p) => [...pathCells([p])].map((k) => k.split(',').map(Number)));
    const cands: { c: number; r: number; cov: number }[] = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        if (blocked.has(cellKey(c, r))) continue;
        const cov = path.filter(([pc, pr]) => (pc - c) ** 2 + (pr - r) ** 2 <= 2.3 ** 2).length;
        cands.push({ c, r, cov });
      }
    }
    cands.sort((a, b) => b.cov - a.cov);
    const order = PATTERN.filter((k) => L.towers.includes(k));
    // 玩家会马上试用本关新解锁的塔：放到第 3 座
    if (L.unlock) order.splice(2, 0, L.unlock);
    let bi = 0;

    const spend = () => {
      for (;;) {
        const kind = order[bi % order.length];
        const cost = TOWERS[kind].levels[0].cost;
        const ups = [...s.towers.values()].filter((x: any) => !x.maxed).sort((a: any, b: any) => a.upgradeCost - b.upgradeCost);
        const canBuild = s.towers.size < cap && bi < cands.length;
        const preferUp = s.towers.size >= 8 && ups.length > 0 && ups[0].upgradeCost <= cost;
        if (canBuild && !preferUp) {
          if (s.energy >= cost) {
            s.build(kind, cands[bi].c, cands[bi].r);
            bi++;
            continue;
          }
          if (s.towers.size < 8) break;
        }
        if (ups.length && s.energy >= ups[0].upgradeCost) {
          s.energy -= ups[0].upgradeCost;
          ups[0].upgrade();
          continue;
        }
        break;
      }
    };

    const lives: number[] = [];
    // 无尽模式最多测 60 波
    const total = L.endless ? 60 : L.waves.length;
    while (s.state === 'build' && s.waveIndex < total) {
      spend();
      s.startWave();
      for (let i = 0; i < 20 * 240 && s.state === 'wave'; i++) {
        // 标签页隐藏时游戏会自动暂停，测试时直接恢复
        if (s.paused) s.togglePause();
        frame();
        if (i % 20 === 0) spend();
        // 定期让出主线程；用 MessageChannel 而不是 setTimeout，后台标签页里不会被节流
        if (i % 200 === 0) await yieldToBrowser();
      }
      lives.push(s.lives);
    }
    try {
      if (saved === null) localStorage.removeItem(PROGRESS_KEY);
      else localStorage.setItem(PROGRESS_KEY, saved);
    } catch {
      /* 忽略 */
    }
    if (L.endless) return `E${id} ${s.state} wave=${s.waveIndex} score=${s.score} ❤${s.lives}/${L.lives} towers=${s.towers.size} lives/wave=[${lives.join(',')}]`;
    return `L${id} ${s.state} ❤${s.lives}/${L.lives} towers=${s.towers.size} lives/wave=[${lives.join(',')}]`;
  };

  const results: Record<number, string> = {};
  /** 后台跑一关，结果写入 __bot.results */
  const start = (id: number) => {
    results[id] = 'running';
    run(id).then((r) => (results[id] = r), (e) => (results[id] = `error: ${e}`));
  };

  (window as any).__bot = { run, start, results, frame };
}
