const MARKER_PREFIX = '[KHO_TM_XUAT_CHUYEN_KHO:';
const SYSTEM_NOTE = 'Tạo tự động từ Xuất chuyển kho TM.';

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeDraftUuid(value) {
  const uuid = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)
    ? uuid
    : null;
}

function normalizePackageIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(positiveId).filter(Boolean))];
}

function normalizeNote(value) {
  return String(value || '').trim().slice(0, 300);
}

function markerFor(uuid) {
  return `${MARKER_PREFIX}${uuid}]`;
}

function buildNote(uuid, userNote) {
  const suffix = normalizeNote(userNote);
  return `${markerFor(uuid)} ${SYSTEM_NOTE}${suffix ? ` ${suffix}` : ''}`;
}

module.exports = {
  MARKER_PREFIX,
  SYSTEM_NOTE,
  positiveId,
  normalizeDraftUuid,
  normalizePackageIds,
  normalizeNote,
  markerFor,
  buildNote,
};
