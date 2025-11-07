const UTORID_REGEX = /^[a-z0-9]{7,8}$/;

function normalizeUtorid(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!UTORID_REGEX.test(trimmed)) return null;
  return trimmed;
}

function parsePositiveInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function buildUserWhere(identifier) {
  const byId = parsePositiveInt(identifier);
  if (byId !== null) {
    return { id: byId };
  }
  const utorid = normalizeUtorid(identifier);
  if (utorid) {
    return { utorid };
  }
  return null;
}

module.exports = {
  UTORID_REGEX,
  normalizeUtorid,
  parsePositiveInt,
  buildUserWhere,
};
