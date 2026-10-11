import Phaser from 'phaser';
import { WIDTH, HEIGHT } from './config/map';
import { ENEMIES, ESD_DISCHARGE, type EnemyKind, type EnemyDef } from './config/enemies';
import { hasSeen } from './progress';
import { FONT, fit, makeButton, type Box } from './ui';
import { sfx } from './audio';

const ORDER: EnemyKind[] = ['thermal', 'glitch', 'crosstalk', 'flicker', 'jitter', 'emi', 'esd'];

/** 应对建议：推荐的塔 */
const COUNTERS: Record<EnemyKind, string> = {
  thermal: '振荡器、混频器：范围伤害清群',
  glitch: '滤波器减速，再用放大器补刀',
  crosstalk: '振荡器同时打到两只；单体伤害会被分摊',
  flicker: 'ADC 斩杀、比较器暴击、锁相环持续输出',
  jitter: '振荡器、锁相环、比较器都不会落空',
  emi: '必须有雷达，雷达范围内才能被攻击',
  esd: 'LDO 抵抗瘫痪，比较器和锁相环负责输出',
};

/** 真实电路里的它（预留给以后的科普内容，可以换成 def.info） */
const FLAVOR: Record<EnemyKind, string> = {
  thermal: '电阻里电子的随机热运动，无处不在，只能压低不能消除。',
  glitch: '信号切换瞬间出现的短暂尖峰，来得快去得也快。',
  crosstalk: '相邻走线之间的耦合，一根线的信号“串”到另一根上。',
  flicker: '低频越强的噪声，频率越低越难对付。',
  jitter: '时钟边沿的时间抖动，总是不在该在的位置。',
  emi: '来自外部的电磁辐射，看不见摸不着。',
  esd: '人体或设备带的静电瞬间释放，电压可达上千伏。',
};

function traits(d: EnemyDef): string[] {
  const t: string[] = [];
  if (d.armor) t.push(`减伤 ${Math.round(d.armor * 100)}%`);
  if (d.dodge) t.push(`闪避 ${Math.round(d.dodge * 100)}%`);
  if (d.stealth) t.push('隐身');
  if (d.linked) t.push('成对出现');
  if (d.boss) t.push(`每 ${ESD_DISCHARGE.interval} 秒放电，瘫痪附近的塔 ${ESD_DISCHARGE.stun} 秒`);
  return t;
}

/** 速度换成更直观的描述 */
const speedText = (v: number) => (v >= 120 ? '极快' : v >= 75 ? '较快' : v >= 55 ? '普通' : v >= 40 ? '较慢' : '很慢');

/**
 * 怪物图鉴弹窗。没遇到过的怪物显示为剪影。
 * 返回 close，调用方自己处理 Esc 键（避免和场景里的其他快捷键冲突）；onClose 用于恢复调用方状态。
 */
export function openCodex(scene: Phaser.Scene, onClose?: () => void) {
  const layer = scene.add.container(0, 0).setDepth(50000);
  const shade = scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.6).setInteractive();
  const pw = 880;
  const ph = 540;
  const x0 = WIDTH / 2 - pw / 2;
  const y0 = HEIGHT / 2 - ph / 2;
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.2).fillRoundedRect(x0, y0 + 6, pw, ph, 26);
  g.fillStyle(0xfffaf0, 1).fillRoundedRect(x0, y0, pw, ph, 26);
  g.lineStyle(5, 0x6a55b5, 1).strokeRoundedRect(x0, y0, pw, ph, 26);
  const seenCount = ORDER.filter((k) => hasSeen(k)).length;
  const title = scene.add
    .text(x0 + 30, y0 + 34, `怪物图鉴  ${seenCount}/${ORDER.length}`, { fontFamily: FONT, fontSize: '26px', fontStyle: 'bold', color: '#4a3a8a' })
    .setOrigin(0, 0.5);
  layer.add([shade, g, title]);

  const close = () => {
    sfx.play('click');
    layer.destroy();
    onClose?.();
  };
  const closeBtn = makeButton(scene, x0 + pw - 60, y0 + 34, 90, 38, '关闭', 0x6a55b5, close, 16);
  layer.add(closeBtn.container);

  // 左侧：2 列图标列表
  const listX = x0 + 30;
  const listY = y0 + 76;
  const cell = 108;
  const detail = scene.add.container(0, 0);
  const highlights: ((on: boolean) => void)[] = [];
  layer.add(detail);

  const show = (kind: EnemyKind) => {
    detail.removeAll(true);
    const d = ENEMIES[kind];
    const seen = hasSeen(kind);
    const dx = x0 + 280;
    const dy = y0 + 76;
    const dw = pw - 280 - 30;
    const box = scene.add.graphics();
    box.fillStyle(0xf1ebff, 1).fillRoundedRect(dx, dy, dw, ph - 106, 20);
    detail.add(box);

    const big = scene.add.image(dx + 100, dy + 104, kind);
    big.setScale(Math.min(150 / big.width, 150 / big.height));
    if (!seen) big.setTintFill(0x5a5470);
    // 游戏暂停时补间动画是冻结的，这里只在能动时加上浮动
    else if (!scene.tweens.paused) scene.tweens.add({ targets: big, y: big.y - 6, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    detail.add(big);

    const tx = dx + 210;
    // 详情框内留 16 的边距，所有文字都不能出这个范围
    const inner: Box = { x: dx + 16, y: dy + 8, w: dw - 32, h: ph - 106 - 16 };
    const innerR = inner.x + inner.w;
    const name = scene.add
      .text(tx, dy + 40, seen ? d.name : '？？？', { fontFamily: FONT, fontSize: '30px', fontStyle: 'bold', color: d.boss && seen ? '#c6331f' : '#3a2a6a' })
      .setOrigin(0, 0.5);
    detail.add(name);
    if (d.boss && seen) {
      const tag = scene.add.text(0, dy + 40, 'BOSS', { fontFamily: 'Arial', fontSize: '15px', fontStyle: 'bold', color: '#ffffff', backgroundColor: '#c6331f', padding: { x: 6, y: 3 } }).setOrigin(1, 0.5);
      fit(name, innerR - tag.width - 10 - tx, inner);
      tag.setX(Math.min(innerR, tx + name.displayWidth + 10 + tag.width));
      detail.add(fit(tag, tag.width, inner));
    } else {
      fit(name, innerR - tx, inner);
    }
    if (!seen) {
      detail.add(
        fit(scene.add.text(tx, dy + 86, '还没有遇到过它。\n在关卡里第一次遭遇后解锁。', { fontFamily: FONT, fontSize: '16px', color: '#7a7090', lineSpacing: 6 }), innerR - tx, inner),
      );
      return;
    }
    // 简介在名字下面、数值条上面
    detail.add(
      fit(scene.add.text(tx, dy + 72, d.intro, { fontFamily: FONT, fontSize: '15px', color: '#5a4a7a', wordWrap: { width: innerR - tx } }), innerR - tx, {
        x: tx, y: dy + 60, w: innerR - tx, h: 210 - 16 - 60,
      }),
    );

    // 数值条
    const bars: [string, number, number, string][] = [
      ['血量', d.hp, 1900, `${d.hp}`],
      ['速度', d.speed, 145, speedText(d.speed)],
      ['漏过扣命', d.leak, 4, `${d.leak}`],
      ['击败奖励', d.reward, 200, `⚡${d.reward}`],
    ];
    bars.forEach(([name, v, max, label], i) => {
      const by = dy + 210 + i * 32;
      detail.add(scene.add.text(dx + 24, by, name, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#5a4a7a' }).setOrigin(0, 0.5));
      const bar = scene.add.graphics();
      const bw = 260;
      // 血量和奖励跨度大，用平方根拉开小数值的差距
      const k = name === '血量' || name === '击败奖励' ? Math.sqrt(v / max) : v / max;
      bar.fillStyle(0xddd3f5, 1).fillRoundedRect(dx + 104, by - 7, bw, 14, 7);
      bar.fillStyle(d.color, 1).fillRoundedRect(dx + 104, by - 7, Math.max(14, bw * k), 14, 7);
      detail.add(bar);
      detail.add(fit(scene.add.text(dx + 104 + bw + 12, by, label, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#3a2a6a' }).setOrigin(0, 0.5), innerR - (dx + 104 + bw + 12), inner));
    });

    // 下面几段按实际高度往下排，换行多了也不会互相压住
    let y = dy + 336;
    const para = (text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => {
      const p = scene.add.text(dx + 24, y, text, { fontFamily: FONT, fontSize: '14px', ...style, wordWrap: { width: dw - 48 } });
      detail.add(fit(p, dw - 48, inner));
      y += p.displayHeight + 8;
    };
    const t = traits(d);
    if (t.length) para(`特性：${t.join('，')}`, { color: '#c6331f', fontStyle: 'bold' });
    para(`应对：${COUNTERS[kind]}`, { color: '#2f7a4a', fontStyle: 'bold' });
    para(`电路里的它：${d.info ?? FLAVOR[kind]}`, { fontSize: '13px', color: '#8a7aa0' });
  };

  ORDER.forEach((kind, i) => {
    const cx = listX + (i % 2) * (cell + 8) + cell / 2;
    const cy = listY + Math.floor(i / 2) * (cell + 8) + cell / 2;
    const seen = hasSeen(kind);
    const hl = scene.add.graphics();
    const draw = (on: boolean) => {
      hl.clear();
      hl.fillStyle(on ? 0xe3d9ff : 0xf4efe4, 1).fillRoundedRect(cx - cell / 2, cy - cell / 2, cell, cell, 16);
      hl.lineStyle(3, on ? 0x6a55b5 : 0xe0d6c0, 1).strokeRoundedRect(cx - cell / 2, cy - cell / 2, cell, cell, 16);
    };
    draw(i === 0);
    highlights.push(draw);
    const icon = scene.add.image(cx, cy - 10, kind);
    icon.setScale(Math.min(64 / icon.width, 64 / icon.height));
    if (!seen) icon.setTintFill(0x9a94b0);
    const name = scene.add
      .text(cx, cy + 38, seen ? ENEMIES[kind].name : '？？？', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#4a3a6a' })
      .setOrigin(0.5);
    fit(name, cell - 12, { x: cx - cell / 2 + 6, y: cy - cell / 2, w: cell - 12, h: cell });
    const zone = scene.add.zone(cx, cy, cell, cell).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => {
      sfx.play('click');
      highlights.forEach((h) => h(h === draw));
      show(kind);
    });
    layer.add([hl, icon, name, zone]);
  });
  show(ORDER[0]);

  return { close };
}
