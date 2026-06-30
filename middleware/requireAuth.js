export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.method === "GET") {
      return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    return res.status(401).send("Session expired. Please login again.");
  }

  next();
}
