const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  // 1. Récupérer le token du header
  const token = req.header('Authorization');

  // 2. Vérifier s'il n'y a pas de token
  if (!token) {
    return res.status(401).json({ message: 'Accès refusé. Pas de token.' });
  }

  // 3. Vérifier s'il est au bon format ("Bearer <token>")
  if (!token.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Format de token invalide.' });
  }
  
  const tokenValue = token.split(' ')[1];

  // 4. Vérifier le token
  try {
    const decoded = jwt.verify(tokenValue, process.env.JWT_SECRET);
    
    // 5. Attacher l'utilisateur (payload) à la requête
    req.user = decoded.user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token invalide' });
  }
};