export const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const send = (res, data, message = "Information loaded successfully.", status = 200) => res.status(status).json({ success: true, message, data });
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const fields = (body, allowed) => Object.fromEntries(Object.entries(body || {}).filter(([key]) => allowed.includes(key)));
export const dateWindow = (query, field) => {
  const range = {};
  if (query.from) { const d = new Date(query.from); if (!Number.isFinite(d.getTime())) throw fail("Please enter a valid From date."); range.$gte = d; }
  if (query.to) { const d = new Date(query.to); if (!Number.isFinite(d.getTime())) throw fail("Please enter a valid To date."); if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) d.setUTCDate(d.getUTCDate()+1); range.$lt = d; }
  if (range.$gte && range.$lt && range.$gte >= range.$lt) throw fail("To date must be after From date.");
  return Object.keys(range).length ? { [field]: range } : {};
};
export const paging = (query) => ({ page: Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1)), limit: Math.max(1, Math.min(3000, Number.parseInt(query.limit, 10) || 10)) });
