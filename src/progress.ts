import { LEVELS } from './config/levels';

/** v2：关卡扩展为 9 关并重排，旧存档的关卡编号对不上，直接换新键 */
export const PROGRESS_KEY = 'ic-td-progress-v2';
const KEY = PROGRESS_KEY;

type Stars = Record<number, number>;
interface Save {
  stars: Stars;
  /** 图鉴：遇到过的怪物 */
  seen: string[];
}

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Save>) : null;
    return { stars: data?.stars ?? {}, seen: data?.seen ?? [] };
  } catch {
    return { stars: {}, seen: [] };
  }
}

let save: Save = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* 存储不可用时只在本次会话内有效 */
  }
}

/** 开发测试用：地址带 ?unlock=all 时开放全部关卡和图鉴（只在开发服务器生效，不影响存档） */
const UNLOCK_ALL = import.meta.env.DEV && new URLSearchParams(location.search).get('unlock') === 'all';

export function starsOf(id: number) {
  return save.stars[id] ?? 0;
}

/** 第一关始终解锁；之后的关卡需要通过上一关 */
export function isUnlocked(id: number) {
  if (UNLOCK_ALL) return true;
  const idx = LEVELS.findIndex((l) => l.id === id);
  return idx <= 0 || starsOf(LEVELS[idx - 1].id) > 0;
}

/** 只保存更好的成绩 */
export function recordWin(id: number, s: number) {
  if (s <= starsOf(id)) return;
  save = { ...save, stars: { ...save.stars, [id]: s } };
  persist();
}

export function totalStars() {
  return LEVELS.reduce((sum, l) => sum + starsOf(l.id), 0);
}

export function hasSeen(kind: string) {
  return UNLOCK_ALL || save.seen.includes(kind);
}

export function markSeen(kind: string) {
  if (save.seen.includes(kind)) return;
  save = { ...save, seen: [...save.seen, kind] };
  persist();
}
