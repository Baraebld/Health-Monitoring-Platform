const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Pool } = require('pg');

const AlertSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  deviceId: { type: String },
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  message: { type: String },
  metrics: { type: Object },
  isAcknowledged: { type: Boolean, default: false },
  // Champs étendus pour la supervision Edge
  eventId: { type: String, index: true },
  gatewayId: { type: String },
  detectionMethod: { type: String },
  deliveryStatus: { type: String },
  detectedOffline: { type: Boolean, default: false },
  eventTimestamp: { type: Date },
  syncedAt: { type: Date }
}, { timestamps: true });

const Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);

const pool = process.env.PG_CONN
  ? new Pool({ connectionString: process.env.PG_CONN })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'timescale',
    });

// Suivi en mémoire des passerelles synchronisées
const registeredGateways = new Map();

/**
 * Middleware de sécurité pour l'Edge Gateway
 */
function verifyGatewayAuth(req, res, next) {
  const expectedKey = process.env.EDGE_SYNC_API_KEY || 'edge_secret_token_pfe_2026';
  const providedKey = req.header('X-Gateway-Key');

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: 'Authentification Edge refusée. Clé X-Gateway-Key invalide ou absente.'
    });
  }
  next();
}

/**
 * POST /api/edge/sync
 * Réception par lot et intégration idempotente des alertes et mesures locales
 */
router.post('/sync', verifyGatewayAuth, async (req, res) => {
  const { gatewayId, clientSyncTimestamp, alerts, measurements } = req.body;
  const io = req.app.get('socketio');

  const syncedEventIds = [];
  const syncedMeasurementIds = [];

  // Mettre à jour l'état de la passerelle
  registeredGateways.set(gatewayId || 'unknown_gw', {
    gatewayId,
    lastSync: new Date(),
    clientTimestamp: clientSyncTimestamp,
    ip: req.ip
  });

  try {
    // 1. Synchronisation idempotente des alertes
    if (Array.isArray(alerts)) {
      for (const alertData of alerts) {
        const eventId = alertData.eventId;
        if (!eventId) continue;

        // Upsert idempotent basé sur eventId
        const existing = await Alert.findOne({ eventId });
        if (!existing) {
          const newAlert = new Alert({
            eventId: alertData.eventId,
            patientId: alertData.patientId,
            deviceId: alertData.deviceId,
            gatewayId: alertData.gatewayId || gatewayId,
            type: alertData.alertType,
            severity: alertData.severity,
            message: alertData.reason,
            metrics: alertData.metrics,
            detectionMethod: alertData.detectionMethod,
            deliveryStatus: alertData.deliveryStatus,
            detectedOffline: true,
            isAcknowledged: Boolean(alertData.isAcknowledged),
            eventTimestamp: new Date(alertData.eventTimestamp),
            syncedAt: new Date()
          });

          await newAlert.save();

          // Diffusion temps réel aux dashboards connectés
          if (io) {
            io.emit('new_alert', newAlert);
          }
        } else {
          // Mise à jour de l'acquittement si modifié localement
          if (alertData.isAcknowledged && !existing.isAcknowledged) {
            existing.isAcknowledged = true;
            existing.deliveryStatus = 'acknowledged';
            await existing.save();
          }
        }

        syncedEventIds.push(eventId);
      }
    }

    // 2. Synchronisation idempotente des mesures physiologiques dans TimescaleDB
    if (Array.isArray(measurements)) {
      for (const m of measurements) {
        const { patientId, deviceId, timestamp, vitals } = m;
        const hr = vitals?.heartRate ?? null;
        const spo2 = vitals?.spo2 ?? null;
        const sys = vitals?.bloodPressure?.systolic ?? null;
        const dia = vitals?.bloodPressure?.diastolic ?? null;

        try {
          await pool.query(
            `INSERT INTO vital_signs(time, patient_id, device_id, heart_rate, spo2, systolic, diastolic)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [timestamp, patientId, deviceId, hr, spo2, sys, dia]
          );
          syncedMeasurementIds.push(m.id);

          // Diffusion WebSocket en direct
          if (io) {
            io.emit('vital_update', {
              patientId,
              deviceId,
              timestamp,
              vitals,
              syncedFromEdge: true
            });
          }
        } catch (dbErr) {
          // Si contrainte ou erreur, consigner et continuer
          console.error('[API-Edge] Erreur insertion mesure TimescaleDB:', dbErr.message);
          syncedMeasurementIds.push(m.id); // On valide pour ne pas bloquer la queue
        }
      }
    }

    console.log(`[API-Edge] Synchronisation effectuée pour ${gatewayId} : ${syncedEventIds.length} alertes, ${syncedMeasurementIds.length} mesures.`);

    res.json({
      success: true,
      gatewayId,
      serverTimestamp: new Date().toISOString(),
      syncedEventIds,
      syncedMeasurementIds
    });

  } catch (err) {
    console.error('[API-Edge] Erreur lors de la synchronisation :', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/edge/status
 * État de santé des passerelles Edge connectées
 */
router.get('/status', (req, res) => {
  const list = [];
  const now = Date.now();

  for (const [gwId, data] of registeredGateways.entries()) {
    const elapsed = now - new Date(data.lastSync).getTime();
    list.push({
      gatewayId: gwId,
      lastSync: data.lastSync,
      isOnline: elapsed < 60000, // En ligne si contact < 60s
      silenceSeconds: Math.round(elapsed / 1000)
    });
  }

  res.json({
    activeGateways: list.length,
    gateways: list
  });
});

module.exports = router;
