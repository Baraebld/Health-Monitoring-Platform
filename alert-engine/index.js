const Redis = require('ioredis');
const axios = require('axios');
const mongoose = require('mongoose');
try { require('dotenv').config({ path: '../.env' }); } catch (e) {}
try { require('dotenv').config(); } catch (e) {}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/healthdb';
const REDIS_URI = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || process.env.ML_URL || 'http://localhost:5000/predict';
const VITALS_CHANNEL = process.env.VITALS_CHANNEL || 'vitals-channel';
const ALERTS_CHANNEL = process.env.ALERTS_CHANNEL || 'alerts-channel';

// ----- Modèle Alerte (inchangé) -----
const AlertSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  deviceId: { type: String },
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' }, // Default to warning now
  message: { type: String },
  metrics: { type: Object },
  isAcknowledged: { type: Boolean, default: false },
}, { timestamps: true });
const Alert = mongoose.model('Alert', AlertSchema);

// --- NOUVEAU: Logique Anti-Spam ---
// Garde en mémoire la dernière fois qu'une alerte spécifique a été envoyée pour un patient
const recentAlerts = {}; // Format: { "patientId_alertType": timestamp }
const SPAM_WINDOW_MS = 5 * 60 * 1000; // 5 minutes en millisecondes

function isSpam(patientId, alertType) {
    const key = `${patientId}_${alertType}`;
    const now = Date.now();

    if (recentAlerts[key] && (now - recentAlerts[key] < SPAM_WINDOW_MS)) {
        console.log(`[Anti-Spam] Alerte ${alertType} pour ${patientId} bloquée (trop récente).`);
        return true; // C'est du spam
    }

    // Mettre à jour le timestamp de la dernière alerte
    recentAlerts[key] = now;
    return false; // Ce n'est pas du spam
}
// ------------------------------------

// --- NOUVEAU: Déterminer la sévérité ---
function getSeverity(alertType) {
    // Logique simple, tu peux la complexifier
    if (alertType.startsWith('critical_')) {
        return 'critical';
    }
    if (alertType === 'hypoxia' || alertType === 'hypertension' || alertType === 'hypotension') {
        return 'critical';
    }
    // Par défaut, on peut mettre 'warning'
    return 'warning';
}
// --------------------------------------

async function main() {
    console.log('[Alert-Engine] Démarrage...');
    // ... (Connexion MongoDB et Redis inchangée) ...
    try {
        await mongoose.connect(MONGO_URI);
        console.log('[Alert-Engine] Connecté à MongoDB.');
    } catch (e) {
        console.error('[Alert-Engine] Erreur connexion MongoDB:', e.message);
        process.exit(1);
    }

    const redisSubscriber = new Redis(REDIS_URI);
    const redisPublisher = new Redis(REDIS_URI);

    redisSubscriber.on('connect', () => console.log('[Alert-Engine] Connecté à Redis (Subscriber).'));
    redisPublisher.on('connect', () => console.log('[Alert-Engine] Connecté à Redis (Publisher).'));

    redisSubscriber.subscribe(VITALS_CHANNEL, (err, count) => {
        if (err) { console.error("Erreur d'abonnement:", err); return; }
        console.log(`[Alert-Engine] Abonné au canal "${VITALS_CHANNEL}".`);
    });

    redisSubscriber.on('message', async (channel, message) => {
        if (channel !== VITALS_CHANNEL) return;

        console.log(`[Alert-Engine] Donnée vitale reçue.`);
        const data = JSON.parse(message);

        try {
            const response = await axios.post(ML_SERVICE_URL, { vitals: data.vitals });
            const { is_anomaly, rules_triggered } = response.data;

            if (is_anomaly) {
                const alertType = rules_triggered[0]; // On prend le premier type d'anomalie
                const patientId = data.patientId;

                console.log(`[Alert-Engine] Anomalie détectée: ${alertType} pour ${patientId}`);

                // --- NOUVEAU: Vérification Anti-Spam ---
                if (!isSpam(patientId, alertType)) {
                    // --- NOUVEAU: Déterminer la sévérité ---
                    const severity = getSeverity(alertType);

                    const alertMessage = `Anomalie ${severity}: ${alertType.replace('critical_', '')}`;
                    const newAlert = new Alert({
                        patientId: patientId,
                        deviceId: data.deviceId,
                        type: alertType,
                        severity: severity, // Utilise la sévérité déterminée
                        message: alertMessage,
                        metrics: data.vitals,
                    });
                    await newAlert.save();
                    console.log(`[Alert-Engine] Alerte (${severity}) sauvegardée.`);

                    await redisPublisher.publish(ALERTS_CHANNEL, JSON.stringify(newAlert));
                    console.log(`[Alert-Engine] Alerte publiée sur "${ALERTS_CHANNEL}".`);
                }
                // Si c'est du spam, on ne fait rien
            }

        } catch (err) {
            console.error('[Alert-Engine] Erreur:', err.message);
        }
    });
}

main();