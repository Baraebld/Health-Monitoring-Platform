try { require('dotenv').config({ path: '../.env' }); } catch (e) {}
try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const mongoose = require('mongoose');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');

// --- Imports Swagger ---
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
// -----------------------

// Importer les routes EXISTANTES
const authRoutes = require('./routes/auth');
const vitalsRoutes = require('./routes/vitals');
const alertsRoutes = require('./routes/alerts');
const edgeRoutes = require('./routes/edge');

// Importer le middleware EXISTANT
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = 3000;

// Création du serveur HTTP et Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});
app.set('socketio', io);

// Connexion à MongoDB
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/healthdb';
    await mongoose.connect(mongoUri);
    console.log('[API-GATEWAY] Connecté à MongoDB !');
  } catch (err) {
    console.error('[API-GATEWAY] Erreur de connexion MongoDB:', err.message);
    process.exit(1);
  }
};
connectDB();

// Connexion à TimescaleDB
const pgPool = process.env.PG_CONN
  ? new Pool({ connectionString: process.env.PG_CONN })
  : new Pool({ host: process.env.DB_HOST || 'localhost' });
pgPool.on('connect', () => {
  console.log('[API-GATEWAY] Connexion pool TimescaleDB initialisée.');
});

// Connexion à Redis Pub/Sub
const REDIS_CONNECTION_STRING = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379';
const redisSubscriber = new Redis(REDIS_CONNECTION_STRING);
const VITALS_CHANNEL = process.env.VITALS_CHANNEL || 'vitals-channel';
const ALERTS_CHANNEL = process.env.ALERTS_CHANNEL || 'alerts-channel';

redisSubscriber.subscribe(VITALS_CHANNEL, ALERTS_CHANNEL, (err, count) => {
  if (err) {
    console.error("Erreur d'abonnement aux canaux Redis:", err);
  } else {
    console.log(`[API-GATEWAY] Abonné à ${count} canaux.`);
  }
});

redisSubscriber.on('message', (channel, message) => {
  if (channel === VITALS_CHANNEL) {
    console.log('[API-GATEWAY] Donnée vitale reçue de Redis, envoi au client...');
    const vitalData = JSON.parse(message);
    io.emit('vital_update', vitalData);
  }
  if (channel === ALERTS_CHANNEL) {
    console.log('[API-GATEWAY] ALERTE reçue de Redis, envoi au client...');
    const alertData = JSON.parse(message);
    io.emit('new_alert', alertData);
  }
});

// Middlewares Express
app.use(express.json());

// Support CORS pour requêtes HTTP provenant du frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// --- Configuration Swagger ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Health Monitoring Platform API',
      version: '1.0.0',
      description: 'API pour la plateforme de télésurveillance médicale IoMT',
    },
    servers: [
      { url: `http://localhost:${PORT}`, description: 'Serveur local' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    },
    // On met la sécurité par défaut, mais les routes auth n'en auront pas besoin
    security: [{ bearerAuth: [] }]
  },
  // IMPORTANT: On cible auth.js ET index.js (pour la route /me)
  apis: ['./routes/auth.js', './index.js'],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// ---------------------------

// Routes publiques
app.get('/', (req, res) => {
  res.send('API Gateway fonctionnelle. Swagger UI dispo sur /api-docs.');
});

// --- Routes existantes ---
// La route /api/auth est définie dans auth.js (déjà scanné par Swagger)
app.use('/api/auth', authRoutes);

// La route /api/vitals (utilisée par le simulateur) - on ne la documente pas ici
app.use('/api/vitals', vitalsRoutes);

// Route pour les alertes médicales et la supervision médecin
app.use('/api/alerts', alertsRoutes);

// Route pour la passerelle Edge (synchronisation autonome et statut passerelle)
app.use('/api/edge', edgeRoutes);

// Route protégée pour récupérer le profil utilisateur (DANS ce fichier)
/**
 * @swagger
 * /api/users/me:
 * get:
 * summary: Récupère le profil de l'utilisateur connecté
 * tags: [Users]
 * security:
 * - bearerAuth: [] # Indique que cette route nécessite le Bearer Token
 * responses:
 * 200:
 * description: Profil de l'utilisateur
 * content:
 * application/json:
 * schema:
 * $ref: '#/components/schemas/User' # Référence au schéma User (qu'on définira plus tard)
 * 401:
 * description: Non autorisé (token manquant ou invalide)
 * 500:
 * description: Erreur serveur
 */
app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    // On utilise findById(req.user.id).select('-password') pour être sûr de ne pas renvoyer le hash
    const user = await mongoose.model('User').findById(req.user.id).select('-password');
    if (!user) {
        return res.status(404).json({ message: 'Utilisateur non trouvé' }); // Ajout sécurité
    }
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});
// -------------------------

// --- Logique Socket.io (inchangée) ---
io.on('connection', (socket) => {
  console.log(`[API-GATEWAY] Un utilisateur est connecté (Socket ID: ${socket.id})`);
  socket.on('disconnect', () => {
    console.log(`[API-GATEWAY] Un utilisateur s'est déconnecté (Socket ID: ${socket.id})`);
  });
});
// ------------------------------------

// --- Démarrage Serveur ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API-GATEWAY] Service démarré sur http://0.0.0.0:${PORT}`);
  console.log(`[API-GATEWAY] Swagger UI disponible sur http://localhost:${PORT}/api-docs`);
});

// --- Schéma User pour Swagger (ajouté à la fin pour référence) ---
/**
 * @swagger
 * components:
 * schemas:
 * User:
 * type: object
 * properties:
 * _id:
 * type: string
 * description: ID unique MongoDB
 * example: 60d0fe4f5311236168a109ca
 * email:
 * type: string
 * format: email
 * description: Email de l'utilisateur
 * role:
 * type: string
 * enum: [patient, doctor, admin]
 * description: Rôle de l'utilisateur
 * profile:
 * type: object
 * properties:
 * firstName:
 * type: string
 * lastName:
 * type: string
 * assignedDoctor:
 * type: string
 * description: ID du médecin assigné (si patient)
 * patients:
 * type: array
 * items:
 * type: string
 * description: IDs des patients assignés (si médecin)
 * createdAt:
 * type: string
 * format: date-time
 * description: Date de création
 * updatedAt:
 * type: string
 * format: date-time
 * description: Date de dernière mise à jour
 * required:
 * - email
 * - role
 */