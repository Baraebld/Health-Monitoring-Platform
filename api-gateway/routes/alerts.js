const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Pool } = require('pg');

// Schéma et modèle Alert
const AlertSchema = new mongoose.Schema({
  patientId: { type: String, required: true, index: true },
  deviceId: { type: String },
  type: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
  message: { type: String },
  metrics: { type: Object },
  isAcknowledged: { type: Boolean, default: false },
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
 * Récupère la liste des alertes avec filtres optionnels
 */
router.get('/', async (req, res) => {
  try {
    const { patientId, severity, acknowledged, limit = 50 } = req.query;
    const filter = {};

    if (patientId) filter.patientId = patientId;
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
router.get('/summary', async (req, res) => {
  try {
    const totalAlerts = await Alert.countDocuments();
    const criticalAlerts = await Alert.countDocuments({ severity: 'critical', isAcknowledged: false });
    const warningAlerts = await Alert.countDocuments({ severity: 'warning', isAcknowledged: false });
    const totalUnacknowledged = await Alert.countDocuments({ isAcknowledged: false });

    // Patients actifs depuis TimescaleDB
    let activePatients = 1;
    try {
      const result = await pool.query('SELECT COUNT(DISTINCT patient_id) FROM vital_signs WHERE time > NOW() - INTERVAL \'1 hour\'');
      activePatients = parseInt(result.rows[0].count, 10) || 1;
    } catch (e) {
      // repli si query échoue
    }

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
 * Liste des patients avec dernières constantes et alertes
 */
router.get('/patients', async (req, res) => {
  try {
    // Récupérer les dernières constantes par patient depuis TimescaleDB
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
router.patch('/:id/ack', async (req, res) => {
  try {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { isAcknowledged: true },
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
