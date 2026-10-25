const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

/**
 * @swagger
 * tags:
 * name: Authentication
 * description: Gestion de l'authentification des utilisateurs
 */

/**
 * @swagger
 * /api/auth/register:
 * post:
 * summary: Enregistre un nouvel utilisateur
 * tags: [Authentication]
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - email
 * - password
 * - firstName
 * - lastName
 * properties:
 * email:
 * type: string
 * format: email
 * description: Email unique de l'utilisateur
 * password:
 * type: string
 * format: password
 * minLength: 6
 * description: Mot de passe (min 6 caractères)
 * firstName:
 * type: string
 * description: Prénom
 * lastName:
 * type: string
 * description: Nom
 * role:
 * type: string
 * enum: [patient, doctor, admin]
 * default: patient
 * description: Rôle de l'utilisateur
 * responses:
 * 201:
 * description: Utilisateur créé avec succès
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * message:
 * type: string
 * example: Utilisateur créé avec succès. Veuillez vous connecter.
 * 400:
 * description: Email déjà existant ou données invalides
 * 500:
 * description: Erreur serveur
 */

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, role } = req.body;

  try {
    // 1. Vérifier si l'utilisateur existe déjà
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'Cet utilisateur existe déjà' });
    }

    // 2. Créer le nouvel utilisateur
    user = new User({
      email,
      password,
      role,
      profile: { firstName, lastName }
    });

    // 3. Sauvegarder (le 'pre-save' va hacher le mot de passe)
    await user.save();

    // 4. On ne renvoie PAS le token ici, on force le login
    res.status(201).json({ message: 'Utilisateur créé avec succès. Veuillez vous connecter.' });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

/**
 * @swagger
 * /api/auth/login:
 * post:
 * summary: Connecte un utilisateur et retourne un token JWT
 * tags: [Authentication]
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required:
 * - email
 * - password
 * properties:
 * email:
 * type: string
 * format: email
 * password:
 * type: string
 * format: password
 * responses:
 * 200:
 * description: Connexion réussie, retourne le token JWT
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * token:
 * type: string
 * description: Token JWT à utiliser pour les requêtes authentifiées (Bearer Token)
 * 400:
 * description: Identifiants invalides
 * 500:
 * description: Erreur serveur
 */

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Trouver l'utilisateur (et inclure le mot de passe)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(400).json({ message: 'Identifiants invalides' });
    }

    // 2. Comparer les mots de passe
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Identifiants invalides' });
    }

    // 3. Créer le Token JWT
    const payload = {
      user: {
        id: user.id,
        role: user.role
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        // 4. Renvoyer le token
        res.json({ token });
      }
    );

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

module.exports = router;