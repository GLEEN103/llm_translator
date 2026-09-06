import { AppError } from './contract.mjs';
import { sortModels } from './model-releases.mjs';
import { openaiModel } from './openai-models.mjs';

export const validModel = model => typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model);
export const validProvider = provider => ['google', 'openai', 'kie'].includes(provider);
const slot = (model, provider) => `${provider}:${model}`;
// Keys never leave this trusted background module except in provider headers.
export function createProfiles(local, uuid) {
  const read = async () => {
    try { return (await local.get('modelProfiles')).modelProfiles ?? { schemaVersion: 1, entries: {}, active: '', revision: '' }; }
    catch { throw new AppError('STORAGE_FAILED'); }
  };
  const write = async data => {
    try { await local.set({ modelProfiles: data }); }
    catch { throw new AppError('STORAGE_FAILED'); }
  };
  return {
    async settings() {
      const data = await read(), entry = data.entries[data.active];
      return entry ? { ...entry, revision: data.revision } : null;
    },
    async keyFor(model, provider = 'google') { return validModel(model) && validProvider(provider) ? (await read()).entries[slot(model, provider)]?.apiKey : undefined; },
    async publicList() {
      return sortModels(Object.values((await read()).entries).map(entry => ({ id: entry.model, provider: entry.provider, displayName: entry.displayName, hasKey: true })))
        .map(entry => entry.provider === 'openai' ? { ...entry, releaseDate: openaiModel(entry.id)?.releaseDate ?? null } : entry)
        .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.id.localeCompare(b.id));
    },
    async save(model, apiKey, metadata, provider = 'google') {
      if (!validProvider(provider) || !validModel(model)) throw new AppError('INVALID_SETTINGS');
      const data = await read();
      data.entries[slot(model, provider)] = { provider, model, apiKey, displayName: metadata.displayName };
      data.active = slot(model, provider); data.revision = uuid();
      await write(data);
    },
    async activate(model, provider = 'google') {
      if (!validModel(model) || !validProvider(provider)) throw new AppError('INVALID_SETTINGS');
      const data = await read();
      if (!data.entries[slot(model, provider)]?.apiKey) throw new AppError('MODEL_KEY_REQUIRED');
      data.active = slot(model, provider); data.revision = uuid();
      await write(data);
    },
    async remove(model, provider = 'google') {
      if (!validModel(model) || !validProvider(provider)) throw new AppError('INVALID_SETTINGS');
      const data = await read();
      delete data.entries[slot(model, provider)];
      if (data.active === slot(model, provider)) data.active = '';
      data.revision = uuid(); await write(data);
    },
    async clear() {
      try { await local.remove('modelProfiles'); }
      catch { throw new AppError('STORAGE_FAILED'); }
    }
  };
}
