export const json = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

export const ok = (res, message, data) =>
  json(res, 200, {
    status: true,
    message,
    data,
  });

export const fail = (res, status, message, data = {}) =>
  json(res, status, {
    status: false,
    message,
    data,
  });

export const readBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
};

export const paginate = (records, query) => {
  const limit = Number(query.limit ?? 10);
  const pageNo = Number(query.pageNo ?? 1);
  const count = records.length;
  const totalPages = Math.max(1, Math.ceil(count / limit));
  const currentPage = Math.min(pageNo, totalPages);
  const start = (currentPage - 1) * limit;

  return {
    count,
    totalPages,
    pagination: Array.from({ length: totalPages }, (_, index) => index + 1),
    record: records.slice(start, start + limit),
  };
};

export const contains = (source, query) =>
  String(source ?? "")
    .toLowerCase()
    .includes(String(query ?? "").toLowerCase());

export const parseUrl = (req) => new URL(req.url, `https://${req.headers.host || "localhost"}`);

export const getSegments = (req) =>
  parseUrl(req)
    .pathname.replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
