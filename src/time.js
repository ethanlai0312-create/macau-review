export function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(n => String(n).padStart(2, '0')).join(':');
}
export function answered(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0 && value.every(v => v !== '');
  if (typeof value === 'object') return Object.keys(value).length > 0 && Object.values(value).every(v => v !== '');
  return String(value).trim().length > 0;
}
