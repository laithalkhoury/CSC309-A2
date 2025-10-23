/* Global Error Handling Middleware */

function notFound(_req, res, _next) {
  return res.status(404).json({ error: "Not Found" });
}

function errorHandler(err, _req, res, _next) {
  
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ error: "Unauthorized" }); // jwt token error
  }

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Bad Request" });
  }

  
  if (err.code === "P2002") return res.status(409).json({ error: "Conflict" }); // unique violation
  if (err.code === "P2025") return res.status(404).json({ error: "Not Found" }); // missing row in databse

  // controller-thrown errors when handling endpoints
  if (err.message === "Bad Request")   return res.status(400).json({ error: "Bad Request" });
  if (err.message === "Unauthorized")  return res.status(401).json({ error: "Unauthorized" });
  if (err.message === "Forbidden")     return res.status(403).json({ error: "Forbidden" });
  if (err.message === "Not Found")     return res.status(404).json({ error: "Not Found" });
  if (err.message === "Conflict")      return res.status(409).json({ error: "Conflict" });


  console.error(err);
  res.status(500).json({ error: "Server error" });
}

module.exports = { notFound, errorHandler };