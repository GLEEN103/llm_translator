import { AppError } from './contract.mjs';

export const USAGE_FIELDS = { input: 'promptTokenCount', output: 'candidatesTokenCount', thoughts: 'thoughtsTokenCount', total: 'totalTokenCount', cached: 'cachedContentTokenCount' };
export const USAGE_KINDS = { page: '본문', selection: '부분 텍스트', image: '이미지', video: '자막' };
export const USAGE_LIMITS = { days: 365, rows: 10000, pending: 128 };
const validNumber = n => Number.isSafeInteger(n) && n >= 0;
const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
export function localDate(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBefore(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d - days, 12).getTime());
}
export function numericUsage(metadata) {
  const result = {};
  for (const field of Object.values(USAGE_FIELDS)) if (validNumber(metadata?.[field])) result[field] = metadata[field];
  return result;
}
const counters = () => Object.fromEntries(Object.keys(USAGE_FIELDS).map(key => [key, 0]));
export function summarizeUsage(rows) {
  const summary = { attempts: 0, reported: 0, tokens: counters(), known: counters() };
  for (const row of rows) {
    summary.attempts = add(summary.attempts, row.attempts);
    summary.reported = add(summary.reported, row.reported);
    for (const key of Object.keys(USAGE_FIELDS)) {
      summary.tokens[key] = add(summary.tokens[key], row.tokens[key]);
      summary.known[key] = add(summary.known[key], row.known[key]);
    }
  }
  return { ...summary, unknown: summary.attempts - summary.reported };
}
export function filterUsage(rows, { today, days = 30, model = '', kind = '', provider = '' }) {
  const first = days ? daysBefore(today, days - 1) : '';
  return rows.filter(row => row.date >= first && row.date <= today && (!model || row.model === model) && (!provider || row.provider === provider) && (!kind || row.kind === kind));
}
export function groupUsage(rows, dimension) {
  const groups = new Map();
  for (const row of rows) {
    const name = dimension === 'model' ? `${row.provider}:${row.model}` : row.date;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups].map(([name, values]) => ({ name, ...summarizeUsage(values) }));
}
const rowKey = row => JSON.stringify([row.date, row.provider, row.model, row.kind]);

// Only the background owns this writer. A durable start survives worker interruption.
export function createUsageStore(local, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  let serial = Promise.resolve(), writeWarning = false;
  const locked = task => {
    const work = serial.then(task);
    serial = work.catch(() => {});
    return work;
  };
  async function load() {
    const raw = (await local.get('tokenUsage')).tokenUsage;
    const state = raw?.version === 1 ? raw : { version: 1, startedOn: null, rows: [], pending: [] };
    const cutoff = daysBefore(localDate(now()), USAGE_LIMITS.days - 1);
    const rows = (Array.isArray(state.rows) ? state.rows : []).filter(row =>
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date >= cutoff && ['google', 'openai', 'kie'].includes(row.provider) &&
      typeof row.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(row.model) &&
      Object.hasOwn(USAGE_KINDS, row.kind) && validNumber(row.attempts) && validNumber(row.reported) && row.reported <= row.attempts &&
      Object.keys(USAGE_FIELDS).every(key => validNumber(row.tokens?.[key]) && validNumber(row.known?.[key]) && row.known[key] <= row.attempts))
      .map(row => ({ date: row.date, provider: row.provider, model: row.model, kind: row.kind, attempts: row.attempts, reported: row.reported,
        tokens: Object.fromEntries(Object.keys(USAGE_FIELDS).map(key => [key, row.tokens[key]])),
        known: Object.fromEntries(Object.keys(USAGE_FIELDS).map(key => [key, row.known[key]])) }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, USAGE_LIMITS.rows);
    const keys = new Set(rows.map(rowKey));
    const pending = (Array.isArray(state.pending) ? state.pending : []).filter(p => typeof p.id === 'string' && p.id.length <= 100 && keys.has(p.key))
      .slice(-USAGE_LIMITS.pending).map(p => ({ id: p.id, key: p.key }));
    return { version: 1, startedOn: /^\d{4}-\d{2}-\d{2}$/.test(state.startedOn) ? state.startedOn : null, rows, pending };
  }
  const save = state => local.set({ tokenUsage: state });
  return {
    begin(context) {
      return locked(async () => {
        try {
          if (!['google', 'openai', 'kie'].includes(context.provider) || !Object.hasOwn(USAGE_KINDS, context.kind) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(context.model)) throw Error('Invalid usage context');
          const state = await load(), date = localDate(now());
          const identity = { date, provider: context.provider, model: context.model, kind: context.kind }, key = rowKey(identity);
          let row = state.rows.find(item => rowKey(item) === key);
          if (!row) { row = { ...identity, attempts: 0, reported: 0, tokens: counters(), known: counters() }; state.rows.unshift(row); }
          row.attempts = add(row.attempts, 1);
          state.startedOn ??= date;
          state.rows = state.rows.slice(0, USAGE_LIMITS.rows);
          const id = uuid();
          state.pending.push({ id, key });
          const keys = new Set(state.rows.map(rowKey));
          state.pending = state.pending.filter(p => keys.has(p.key)).slice(-USAGE_LIMITS.pending);
          await save(state);
          return id;
        } catch { throw new AppError('USAGE_STORAGE_FAILED'); }
      });
    },
    finish(id, metadata) {
      return locked(async () => {
        try {
          const state = await load(), pending = state.pending.find(p => p.id === id);
          if (!pending) return; // Already completed, cleared, or expired: never resurrect it.
          const row = state.rows.find(r => rowKey(r) === pending.key), usage = numericUsage(metadata);
          for (const [key, field] of Object.entries(USAGE_FIELDS)) if (Object.hasOwn(usage, field)) {
            row.tokens[key] = add(row.tokens[key], usage[field]); row.known[key] = add(row.known[key], 1);
          }
          if (['input', 'output', 'total'].every(key => Object.hasOwn(usage, USAGE_FIELDS[key]))) row.reported = add(row.reported, 1);
          state.pending = state.pending.filter(p => p.id !== id);
          await save(state);
        } catch { writeWarning = true; } // A charged translation must not be discarded because a counter write failed.
      });
    },
    snapshot() {
      return locked(async () => {
        try {
          const state = await load();
          // Persist retention pruning without issuing writes on every dashboard refresh.
          const raw = (await local.get('tokenUsage')).tokenUsage;
          if (raw && JSON.stringify(raw) !== JSON.stringify(state)) await save(state);
          return { today: localDate(now()), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            startedOn: state.startedOn, rows: state.rows, writeWarning, limits: USAGE_LIMITS };
        } catch { throw new AppError('USAGE_STORAGE_FAILED'); }
      });
    },
    clear() {
      return locked(async () => {
        try { await save({ version: 1, startedOn: null, rows: [], pending: [] }); writeWarning = false; }
        catch { throw new AppError('USAGE_STORAGE_FAILED'); }
      });
    }
  };
}
