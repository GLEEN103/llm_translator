// Exact endpoint launch dates, checked 2026-09-06 against:
// https://ai.google.dev/gemini-api/docs/changelog
// Do not infer dates from versions, suffixes, descriptions or moving aliases.
export const releaseDates = Object.freeze({
  'gemini-3.8-flash': '2026-09-02',
  'gemini-3.7-flash': '2026-08-13',
  'gemini-3.6-flash': '2026-07-21',
  'gemini-3.5-flash-lite': '2026-07-21',
  'gemini-3.1-flash-lite-image': '2026-06-30',
  'gemini-3.1-flash-image': '2026-05-28',
  'gemini-3-pro-image': '2026-05-28',
  'gemini-3.5-flash': '2026-05-19',
  'gemini-3.1-flash-lite': '2026-05-07',
  'gemini-3.1-flash-tts-preview': '2026-04-15',
  'gemma-4-26b-a4b-it': '2026-04-02',
  'gemma-4-31b-it': '2026-04-02',
  'gemini-3.1-flash-lite-preview': '2026-03-03',
  'gemini-3.1-flash-image-preview': '2026-02-26',
  'gemini-3.1-pro-preview': '2026-02-19',
  'gemini-3.1-pro-preview-customtools': '2026-02-19',
  'gemini-3-flash-preview': '2025-12-17',
  'gemini-3-pro-image-preview': '2025-11-20',
  'gemini-2.5-flash-image': '2025-10-02',
  'gemini-2.5-flash-preview-09-2025': '2025-09-25',
  'gemini-2.5-flash-lite-preview-09-2025': '2025-09-25',
  'gemini-2.5-flash-image-preview': '2025-08-26',
  'gemini-2.5-flash-lite': '2025-07-22',
  'gemini-2.5-flash': '2025-06-17',
  'gemini-2.5-pro': '2025-06-17',
  'gemini-2.5-flash-lite-preview-06-17': '2025-06-17',
  'gemini-2.5-pro-preview-06-05': '2025-06-05',
  'gemini-2.5-flash-preview-05-20': '2025-05-20',
  'gemini-2.5-flash-preview-tts': '2025-05-20',
  'gemini-2.5-pro-preview-tts': '2025-05-20',
  'gemini-2.5-flash-preview-04-17': '2025-04-17',
  'gemma-3-27b-it': '2025-03-12',
  'gemini-2.0-flash-lite': '2025-02-25',
  'gemini-2.0-flash-001': '2025-02-05',
  'gemini-1.5-flash-8b-001': '2024-10-03',
  'gemini-1.5-pro-002': '2024-09-24',
  'gemini-1.5-flash-002': '2024-09-24'
});
export function sortModels(models) {
  return models.map(model => ({ ...model, releaseDate: Object.hasOwn(releaseDates, model.id) ? releaseDates[model.id] : null }))
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || a.id.localeCompare(b.id));
}
