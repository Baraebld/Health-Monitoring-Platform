const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

class EdgeDatabase {
  constructor(dbPath = config.DB_PATH) {
    this.dbPath = dbPath;
    this.init();
  }

  init() {
    // Créer le dossier parent si inexistant
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);

    // Activer le mode WAL pour de meilleures performances et tolérance aux crashs
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    this.createTables();
  }

  createTables() {
    // 1. Table des mesures physiologiques locales
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        heart_rate INTEGER,
        spo2 INTEGER,
        systolic INTEGER,
        diastolic INTEGER,
        is_synced INTEGER DEFAULT 0,
        synced_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_meas_sync ON measurements(is_synced);
      CREATE INDEX IF NOT EXISTS idx_meas_patient ON measurements(patient_id, timestamp);
    `);

    // 2. Table des alertes générées localement (survit aux redémarrages)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_alerts (
        event_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        gateway_id TEXT NOT NULL,
        event_timestamp TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        reason TEXT NOT NULL,
        detection_method TEXT NOT NULL,
        metrics_json TEXT,
        delivery_status TEXT NOT NULL,
        is_acknowledged INTEGER DEFAULT 0,
        acknowledged_at TEXT,
        is_synced INTEGER DEFAULT 0,
        synced_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alert_sync ON local_alerts(is_synced);
      CREATE INDEX IF NOT EXISTS idx_alert_patient_time ON local_alerts(patient_id, event_timestamp);
    `);

    // 3. Table d'audit des tentatives d'envoi SMS
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_delivery_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        attempt_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        transport_name TEXT NOT NULL,
        message_body TEXT NOT NULL,
        error_message TEXT,
        attempted_at TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES local_alerts(event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sms_event ON sms_delivery_attempts(event_id);
    `);

    // 4. Table d'état de santé des capteurs (détection déconnexion / fraîcheur)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sensor_states (
        device_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        last_seen_timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        last_vitals_json TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // --- Gestion des mesures ---
  saveMeasurement(data) {
    const stmt = this.db.prepare(`
      INSERT INTO measurements (patient_id, device_id, timestamp, heart_rate, spo2, systolic, diastolic, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const vitals = data.vitals || {};
    const bp = vitals.bloodPressure || {};

    stmt.run(
      data.patientId,
      data.deviceId,
      data.timestamp,
      vitals.heartRate ?? null,
      vitals.spo2 ?? null,
      bp.systolic ?? null,
      bp.diastolic ?? null,
      now
    );
  }

  getUnsyncedMeasurements(limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM measurements WHERE is_synced = 0 ORDER BY id ASC LIMIT ?
    `);
    return stmt.all(limit);
  }

  markMeasurementsSynced(ids, syncedAt = new Date().toISOString()) {
    if (!ids || ids.length === 0) return;
    const stmt = this.db.prepare(`
      UPDATE measurements SET is_synced = 1, synced_at = ? WHERE id = ?
    `);
    for (const id of ids) {
      stmt.run(syncedAt, id);
    }
  }

  // --- Gestion des alertes locales ---
  saveAlert(alert) {
    const stmt = this.db.prepare(`
      INSERT INTO local_alerts (
        event_id, patient_id, device_id, gateway_id, event_timestamp,
        alert_type, severity, reason, detection_method, metrics_json,
        delivery_status, is_acknowledged, is_synced, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      alert.eventId,
      alert.patientId,
      alert.deviceId || 'unknown_device',
      alert.gatewayId || config.GATEWAY_ID,
      alert.eventTimestamp || new Date().toISOString(),
      alert.alertType,
      alert.severity || 'warning',
      alert.reason || 'Anomalie détectée',
      alert.detectionMethod || 'clinical_rules',
      JSON.stringify(alert.metrics || {}),
      alert.deliveryStatus || 'pending',
      alert.isAcknowledged ? 1 : 0,
      alert.isSynced ? 1 : 0,
      new Date().toISOString()
    );
  }

  getAlertById(eventId) {
    const stmt = this.db.prepare(`SELECT * FROM local_alerts WHERE event_id = ?`);
    const row = stmt.get(eventId);
    if (!row) return null;
    return this._formatAlertRow(row);
  }

  getRecentAlert(patientId, alertType, windowMs, excludeEventId = null) {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    let query = `
      SELECT * FROM local_alerts 
      WHERE patient_id = ? AND alert_type = ? AND event_timestamp >= ?
        AND delivery_status IN ('accepted_by_modem', 'accepted_by_mock_transport', 'attempted')
    `;
    const params = [patientId, alertType, cutoff];
    if (excludeEventId) {
      query += ` AND event_id != ?`;
      params.push(excludeEventId);
    }
    query += ` ORDER BY event_timestamp DESC LIMIT 1`;

    const stmt = this.db.prepare(query);
    const row = stmt.get(...params);
    if (!row) return null;
    return this._formatAlertRow(row);
  }

  updateAlertDeliveryStatus(eventId, status) {
    const stmt = this.db.prepare(`
      UPDATE local_alerts SET delivery_status = ? WHERE event_id = ?
    `);
    stmt.run(status, eventId);
  }

  acknowledgeAlert(eventId, ackTimestamp = new Date().toISOString()) {
    const stmt = this.db.prepare(`
      UPDATE local_alerts 
      SET is_acknowledged = 1, acknowledged_at = ?, delivery_status = 'acknowledged' 
      WHERE event_id = ?
    `);
    stmt.run(ackTimestamp, eventId);
  }

  getUnsyncedAlerts(limit = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM local_alerts WHERE is_synced = 0 ORDER BY created_at ASC LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.map(r => this._formatAlertRow(r));
  }

  markAlertsSynced(eventIds, syncedAt = new Date().toISOString()) {
    if (!eventIds || eventIds.length === 0) return;
    const stmt = this.db.prepare(`
      UPDATE local_alerts SET is_synced = 1, synced_at = ? WHERE event_id = ?
    `);
    for (const id of eventIds) {
      stmt.run(syncedAt, id);
    }
  }

  getAllAlerts(limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM local_alerts ORDER BY event_timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit);
    return rows.map(r => this._formatAlertRow(r));
  }

  // --- Gestion de l'audit des tentatives SMS ---
  recordSmsAttempt({ eventId, recipient, attemptNumber, status, transportName, messageBody, errorMessage }) {
    const stmt = this.db.prepare(`
      INSERT INTO sms_delivery_attempts (
        event_id, recipient, attempt_number, status, transport_name, message_body, error_message, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      eventId,
      recipient,
      attemptNumber,
      status,
      transportName,
      messageBody,
      errorMessage || null,
      new Date().toISOString()
    );
  }

  getSmsAttemptsForEvent(eventId) {
    const stmt = this.db.prepare(`
      SELECT * FROM sms_delivery_attempts WHERE event_id = ? ORDER BY attempt_number ASC
    `);
    return stmt.all(eventId);
  }

  // --- Gestion de la santé des capteurs ---
  updateSensorHeartbeat(deviceId, patientId, vitals, timestamp) {
    const stmt = this.db.prepare(`
      INSERT INTO sensor_states (device_id, patient_id, last_seen_timestamp, status, last_vitals_json, updated_at)
      VALUES (?, ?, ?, 'ONLINE', ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        patient_id = excluded.patient_id,
        last_seen_timestamp = excluded.last_seen_timestamp,
        status = 'ONLINE',
        last_vitals_json = excluded.last_vitals_json,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    stmt.run(deviceId, patientId, timestamp, JSON.stringify(vitals || {}), now);
  }

  getAllSensorStates() {
    const stmt = this.db.prepare(`SELECT * FROM sensor_states`);
    return stmt.all();
  }

  setSensorStatus(deviceId, status) {
    const stmt = this.db.prepare(`
      UPDATE sensor_states SET status = ?, updated_at = ? WHERE device_id = ?
    `);
    stmt.run(status, new Date().toISOString(), deviceId);
  }

  // Formattage utilitaire
  _formatAlertRow(row) {
    return {
      eventId: row.event_id,
      patientId: row.patient_id,
      deviceId: row.device_id,
      gatewayId: row.gateway_id,
      eventTimestamp: row.event_timestamp,
      alertType: row.alert_type,
      severity: row.severity,
      reason: row.reason,
      detectionMethod: row.detection_method,
      metrics: row.metrics_json ? JSON.parse(row.metrics_json) : {},
      deliveryStatus: row.delivery_status,
      isAcknowledged: Boolean(row.is_acknowledged),
      acknowledgedAt: row.acknowledged_at,
      isSynced: Boolean(row.is_synced),
      syncedAt: row.synced_at,
      createdAt: row.created_at
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = EdgeDatabase;
