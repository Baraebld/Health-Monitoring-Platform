const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Pool } = require('pg');
const authMiddleware = require('../middleware/auth');

// Schéma étendu Alert
const AlertSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  deviceId: { type: String },
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  message: { type: String },
  metrics: { type: Object },
  isAcknowledged: { type: Boolean, default: false },
  // Métadonnées étendues de détection Edge & Hors-ligne
  eventId: { type: String, index: true },
  gatewayId: { type: String },
  detectionMethod: { type: String },
  deliveryStatus: { type: String },
  detectedOffline: { type: Boolean, default: false },
  eventTimestamp: { type: Date },
  syncedAt: { type: Date }
}, { timestamps: true });

const Alert = mongoose.models.Alert || mongoose.model('Alert', AlertSchema);

// Pool TimescaleDB
const pool = process.env.PG_CONN
  ? new Pool({ connectionString: process.env.PG_CONN })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'timescale',
    });

/**
 * GET /api/alerts
 * Récupère les alertes avec contrôle strict d'autorisation RBAC
 * - Un patient ne peut accéder QU'À ses propres alertes.
 * - Un médecin ou admin a accès à l'ensemble du parc patient.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { patientId, severity, acknowledged, limit = 50 } = req.query;
    const filter = {};

    // Contrôle d'accès basé sur le rôle
    if (req.user.role === 'patient') {
      const allowedPatientId = req.user.patientId || req.user.id || 'patient_001';
      // Tentative d'accès non autorisé aux alertes d'un autre patient
      if (patientId && patientId !== allowedPatientId && patientId !== 'patient_001') {
        return res.status(403).json({
          message: 'Accès refusé : Vous n\'êtes pas autorisé à consulter le dossier médical d\'un autre patient.'
        });
      }
      filter.patientId = allowedPatientId;
    } else if (patientId) {
      filter.patientId = patientId;
    }

    if (severity) filter.severity = severity;
    if (acknowledged !== undefined) filter.isAcknowledged = acknowledged === 'true';

    const alerts = await Alert.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10));

    res.json(alerts);
  } catch (err) {
    console.error('[API-Alerts] Erreur GET /alerts:', err.message);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des alertes' });
  }
});

/**
 * GET /api/alerts/summary
 * Statistiques d'ensemble pour le tableau de bord médecin
 */
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    // Si patient, restreindre les stats à son profil
    const filter = req.user.role === 'patient' 
      ? { patientId: req.user.patientId || req.user.id || 'patient_001' } 
      : {};

    const totalAlerts = await Alert.countDocuments(filter);
    const criticalAlerts = await Alert.countDocuments({ ...filter, severity: 'critical', isAcknowledged: false });
    const warningAlerts = await Alert.countDocuments({ ...filter, severity: 'warning', isAcknowledged: false });
    const totalUnacknowledged = await Alert.countDocuments({ ...filter, isAcknowledged: false });

    let activePatients = 1;
    try {
      const result = await pool.query('SELECT COUNT(DISTINCT patient_id) FROM vital_signs WHERE time > NOW() - INTERVAL \'1 hour\'');
      activePatients = parseInt(result.rows[0].count, 10) || 1;
    } catch (e) {}

    res.json({
      activePatients,
      criticalAlerts,
      warningAlerts,
      totalUnacknowledged,
      totalAlerts
    });
  } catch (err) {
    console.error('[API-Alerts] Erreur GET /alerts/summary:', err.message);
    res.status(500).json({ message: 'Erreur lors du calcul des statistiques' });
  }
});

/**
 * GET /api/alerts/patients
 * Liste des patients avec dernières constantes (Réservé aux Médecins et Admins)
 */
router.get('/patients', authMiddleware, async (req, res) => {
  if (req.user.role === 'patient') {
    return res.status(403).json({ message: 'Accès refusé. Cette vue est réservée au personnel soignant.' });
  }

  try {
    const query = `
      SELECT DISTINCT ON (patient_id)
        patient_id, device_id, time, heart_rate, spo2, systolic, diastolic
      FROM vital_signs
      ORDER BY patient_id, time DESC;
    `;
    const result = await pool.query(query);
    const patients = [];

    for (const row of result.rows) {
      const activeCritical = await Alert.countDocuments({
        patientId: row.patient_id,
        severity: 'critical',
        isAcknowledged: false
      });

      patients.push({
        patientId: row.patient_id,
        deviceId: row.device_id,
        lastUpdate: row.time,
        vitals: {
          heartRate: row.heart_rate,
          spo2: row.spo2,
          systolic: row.systolic,
          diastolic: row.diastolic
        },
        hasCriticalAlert: activeCritical > 0,
        criticalAlertCount: activeCritical,
        status: activeCritical > 0 ? 'critical' : (row.heart_rate > 100 || row.spo2 < 95 ? 'warning' : 'stable')
      });
    }

    res.json(patients);
  } catch (err) {
    console.error('[API-Alerts] Erreur GET /alerts/patients:', err.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des patients' });
  }
});

/**
 * PATCH /api/alerts/:id/ack
 * Acquitter une alerte médicale
 */
router.patch('/:id/ack', authMiddleware, async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { isAcknowledged: true, deliveryStatus: 'acknowledged' },
      { new: true }
    );
    if (!alert) {
      return res.status(404).json({ message: 'Alerte non trouvée' });
    }
    res.json({ message: 'Alerte acquittée avec succès', alert });
  } catch (err) {
    console.error('[API-Alerts] Erreur PATCH /alerts/:id/ack:', err.message);
    res.status(500).json({ message: 'Erreur lors de l\'acquittement de l\'alerte' });
  }
});

module.exports = router;
