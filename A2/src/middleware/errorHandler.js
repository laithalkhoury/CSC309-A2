/* Global Error Handling Middleware */

function notFound(_req, res, _next) {
  return res.status(404).json({ error: "Not Found" });
}

function errorHandler(err, _req, res, _next) {
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Bad Request" });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Bad Request" });
  }

  if (err.code === "P2002") {
    return res.status(409).json({ error: "Conflict" });
  }

  if (err.code === "P2025") {
    return res.status(404).json({ error: "Not Found" });
  }

  if (err.code === "P2003") {
    return res.status(400).json({ error: "Bad Request" });
  }

  const map = {
    "Bad Request": 400,
    Unauthorized: 401,
    Forbidden: 403,
    "Not Found": 404,
    Conflict: 409,
    Gone: 410,
  };

  if (err.message && map[err.message]) {
    return res.status(map[err.message]).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: "Server error" });
}

module.exports = { notFound, errorHandler };
