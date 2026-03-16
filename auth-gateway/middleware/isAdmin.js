'use strict';

function isAdmin(req, res, next) {
  if (!req.session?.userId) {
    // API : renvoie 401 JSON
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    // Page : redirect login
    return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
  }
  if (req.session.role !== 'superadmin') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    return res.status(403).send('Accès refusé');
  }
  next();
}

module.exports = isAdmin;
