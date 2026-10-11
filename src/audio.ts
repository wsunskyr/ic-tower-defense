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
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
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
