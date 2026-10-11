/**
 * 用 Web Audio 实时合成的音效，不依赖音频文件。
 * 以后要换成录制音效时，只需替换 play() 内部实现。
 */
export type SfxName =
  | 'amp' | 'adc' | 'osc' | 'lock' | 'mixer' | 'cmp' | 'crit' | 'shield' | 'hit' | 'miss' | 'pop' | 'bigPop' | 'quantize'
  | 'build' | 'upgrade' | 'sell' | 'deny' | 'click'
  | 'leak' | 'waveStart' | 'waveClear' | 'boss' | 'zap' | 'win' | 'lose';

/** 同一音效的最短间隔（秒），防止大量命中时叠成噪音 */
const THROTTLE: Partial<Record<SfxName, number>> = {
  amp: 0.05, adc: 0.05, hit: 0.035, miss: 0.08, pop: 0.04, osc: 0.08, lock: 0.15, zap: 0.2, mixer: 0.06, cmp: 0.06, crit: 0.1, shield: 0.3,
};

const STORAGE_KEY = 'ic-td-muted';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  muted = false;
  /** 音频上下文创建后通知背景音乐 */
  onMute?: () => void;
  onReady?: (ctx: AudioContext, out: AudioNode, noise: AudioBuffer) => void;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      /* 存储不可用时保持默认 */
    }
  }

  /** 浏览器要求在用户交互后才能出声 */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      master.connect(comp);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noiseBuf = buf;
      this.onReady?.(ctx, comp, buf);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    this.onMute?.();
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      /* 忽略 */
    }
    return this.muted;
  }

  play(name: SfxName) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gap = THROTTLE[name];
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);

    switch (name) {
      case 'amp':
        this.tone('square', 900, 420, 0.07, 0.12);
        break;
      case 'adc':
        this.tone('square', 1400, 1400, 0.03, 0.08);
        this.tone('square', 700, 700, 0.03, 0.08, 0.035);
        break;
      case 'osc':
        this.tone('sine', 180, 520, 0.18, 0.28);
        this.tone('triangle', 360, 1040, 0.18, 0.08);
        break;
      case 'lock':
        this.tone('sine', 1200, 1800, 0.12, 0.12);
        break;
      case 'mixer':
        // 两个频率叠在一起：混频的“拍频”感
        this.tone('triangle', 660, 330, 0.09, 0.1);
        this.tone('triangle', 990, 495, 0.09, 0.08);
        break;
      case 'cmp':
        this.tone('square', 1800, 1800, 0.025, 0.08);
        this.noise(0.05, 0.12, 5000);
        break;
      case 'crit':
        this.tone('square', 2400, 2400, 0.03, 0.1);
        this.tone('sawtooth', 1200, 300, 0.16, 0.14, 0.02);
        this.noise(0.08, 0.18, 6000);
        break;
      case 'shield':
        this.tone('sine', 500, 900, 0.18, 0.18);
        break;
      case 'hit':
        this.noise(0.04, 0.18, 2500);
        break;
      case 'miss':
        this.tone('sine', 900, 300, 0.12, 0.06);
        break;
      case 'pop':
        this.tone('sine', 620, 120, 0.12, 0.25);
        this.noise(0.05, 0.12, 4000);
        break;
      case 'bigPop':
        this.tone('sine', 300, 50, 0.35, 0.45);
        this.noise(0.25, 0.3, 1200);
        break;
      case 'quantize':
        [880, 660, 1320, 990].forEach((f, i) => this.tone('square', f, f, 0.04, 0.09, i * 0.045));
        break;
      case 'build':
        this.tone('sine', 300, 700, 0.1, 0.3);
        this.noise(0.06, 0.12, 1500);
        break;
      case 'upgrade':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.1, 0.22, i * 0.06));
        break;
      case 'sell':
        this.tone('square', 1320, 1320, 0.06, 0.1);
        this.tone('square', 1760, 1760, 0.12, 0.1, 0.06);
        break;
      case 'deny':
        this.tone('square', 160, 120, 0.15, 0.15);
        break;
      case 'click':
        this.tone('sine', 1000, 800, 0.04, 0.12);
        break;
      case 'leak':
        this.tone('sawtooth', 220, 110, 0.3, 0.25);
        this.tone('sawtooth', 233, 116, 0.3, 0.2);
        break;
      case 'waveStart':
        this.tone('square', 392, 392, 0.12, 0.14);
        this.tone('square', 523, 523, 0.22, 0.14, 0.13);
        break;
      case 'waveClear':
        [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.22, i * 0.09));
        this.tone('triangle', 1047, 1047, 0.3, 0.22, 0.27);
        break;
      case 'boss':
        this.tone('sawtooth', 80, 40, 1.2, 0.35);
        [0, 0.35, 0.7].forEach((d) => this.tone('square', 660, 440, 0.25, 0.12, d));
        break;
      case 'zap':
        this.noise(0.3, 0.35, 6000);
        this.tone('sawtooth', 1600, 200, 0.25, 0.15);
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, i === 5 ? 0.5 : 0.14, 0.25, i * 0.13));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this.tone('triangle', f, f * 0.97, 0.3, 0.25, i * 0.25));
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}

export const sfx = new Sfx();

// ───────────────────────── 背景音乐 ─────────────────────────

export type TrackName = 'menu' | 'battle' | 'boss';

/** 一首循环曲：每小节 16 个十六分音符，和弦按小节轮换 */
interface Track {
  bpm: number;
  /** 每小节的根音（MIDI） */
  roots: number[];
  /** 旋律：每小节 16 格，null 为休止，数字是相对根音的半音 */
  melody: (number | null)[][];
  bass: (number | null)[];
  hat: boolean[];
  kick: boolean[];
  lead: OscillatorType;
}

const _ = null;
const TRACKS: Record<TrackName, Track> = {
  // 选关：轻快、放松
  menu: {
    bpm: 96,
    roots: [60, 57, 53, 55],
    melody: [
      [12, _, 16, _, 19, _, 16, _, 14, _, 12, _, 7, _, _, _],
      [12, _, 15, _, 19, _, 15, _, 14, _, 12, _, 10, _, _, _],
      [12, _, 16, _, 19, _, 21, _, 19, _, 16, _, 12, _, _, _],
      [14, _, 17, _, 19, _, 17, _, 14, _, 11, _, 7, _, _, _],
    ],
    bass: [0, _, _, _, 7, _, _, _, 12, _, _, _, 7, _, _, _],
    hat: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    kick: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false],
    lead: 'triangle',
  },
  // 战斗：更快，带底鼓
  battle: {
    bpm: 132,
    roots: [57, 53, 48, 55],
    melody: [
      [12, _, 12, 15, _, 12, 19, _, 17, _, 15, _, 12, _, 10, _],
      [12, _, 12, 16, _, 12, 19, _, 21, _, 19, _, 16, _, 14, _],
      [12, _, 12, 16, _, 19, 24, _, 23, _, 19, _, 16, _, 19, _],
      [14, _, 14, 17, _, 14, 19, _, 17, _, 14, _, 11, _, 7, _],
    ],
    bass: [0, _, 12, _, 0, _, 12, _, 0, _, 12, _, 0, _, 12, 10],
    hat: [true, false, true, true, true, false, true, true, true, false, true, true, true, false, true, true],
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, true],
    lead: 'square',
  },
  // Boss 在场：小调、低沉
  boss: {
    bpm: 120,
    roots: [45, 45, 41, 44],
    melody: [
      [12, _, _, 13, 12, _, 7, _, 12, _, _, 13, 15, _, 13, _],
      [12, _, _, 13, 12, _, 7, _, 6, _, 7, _, _, _, _, _],
      [12, _, _, 15, 12, _, 8, _, 12, _, _, 15, 17, _, 15, _],
      [11, _, _, 12, 11, _, 8, _, 7, _, 8, _, 11, _, _, _],
    ],
    bass: [0, 0, _, 0, 0, _, 0, _, 0, 0, _, 0, 1, _, 0, _],
    hat: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    kick: [true, false, false, true, false, false, true, false, true, false, false, true, false, false, true, false],
    lead: 'sawtooth',
  },
};

const MUSIC_KEY = 'ic-td-music-off';
const MUSIC_VOL = 0.22;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** 用 Web Audio 实时合成的循环背景音乐，提前约 0.25 秒排程音符 */
class Music {
  enabled = true;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: TrackName | null = null;
  private wanted: TrackName | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | undefined;
  private duck = 1;

  constructor() {
    try {
      this.enabled = localStorage.getItem(MUSIC_KEY) !== '1';
    } catch {
      /* 忽略 */
    }
    sfx.onMute = () => this.refresh();
    sfx.onReady = (ctx, dest, noise) => {
      this.ctx = ctx;
      this.noise = noise;
      this.out = ctx.createGain();
      this.out.gain.value = this.level;
      this.out.connect(dest);
      if (this.wanted) this.play(this.wanted);
    };
  }

  private get level() {
    return this.enabled && !sfx.muted ? MUSIC_VOL * this.duck : 0;
  }

  /** 切换曲目；音频还没解锁时先记下，解锁后自动开始 */
  play(name: TrackName) {
    this.wanted = name;
    if (!this.ctx || this.track === name) return;
    this.track = name;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (this.timer === undefined) this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop() {
    this.wanted = null;
    this.track = null;
  }

  /** 暂停菜单打开时压低音量 */
  setDuck(on: boolean) {
    this.duck = on ? 0.35 : 1;
    this.refresh();
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(MUSIC_KEY, this.enabled ? '0' : '1');
    } catch {
      /* 忽略 */
    }
    this.refresh();
    return this.enabled;
  }

  /** 音效静音或开关变化后同步音量 */
  refresh() {
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.05);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    const tr = TRACKS[this.track];
    const sixteenth = 60 / tr.bpm / 4;
    // 标签页切到后台再回来时不要补放一大串音符
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const bar = Math.floor(this.step / 16) % tr.roots.length;
      const i = this.step % 16;
      const root = tr.roots[bar];
      const t = this.nextTime;
      const m = tr.melody[bar][i];
      if (m !== null) this.note(tr.lead, midi(root + m), t, sixteenth * 1.8, tr.lead === 'triangle' ? 0.22 : 0.09);
      const b = tr.bass[i];
      if (b !== null) this.note('triangle', midi(root - 12 + b), t, sixteenth * 1.6, 0.35);
      if (tr.hat[i]) this.hit(t, 0.03, 0.06, 8000, 'highpass');
      if (tr.kick[i]) this.kick(t);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private note(type: OscillatorType, f: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hit(t: number, dur: number, vol: number, cutoff: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.17);
  }
}

export const music = new Music();
