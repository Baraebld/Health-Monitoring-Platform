const config = require('../config');

/**
 * Surveille la santé et la connectivité des capteurs.
 * Détecte les déconnexions matérielles ou l'obsolescence des mesures de manière DISTINCTE
 * des anomalies physiologiques.
 */
class SensorHealthMonitor {
  constructor(database, onSensorAlertCallback) {
    this.db = database;
    this.onSensorAlert = onSensorAlertCallback;
    this.intervalHandle = null;
    this.disconnectionAlertDebounce = new Map(); // Évite de spammer les alertes de déconnexion
  }

  start(intervalMs = 5000) {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.checkSensors(), intervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  recordHeartbeat(deviceId, patientId, vitals, timestamp) {
    this.db.updateSensorHeartbeat(deviceId, patientId, vitals, timestamp);
    // Si le capteur était considéré déconnecté, réinitialiser l'état
    this.disconnectionAlertDebounce.delete(deviceId);
  }

  checkSensors() {
    const sensors = this.db.getAllSensorStates();
    const now = Date.now();
    const timeoutMs = config.SENSOR_HEALTH.HEARTBEAT_TIMEOUT_MS;

    for (const sensor of sensors) {
      const lastSeen = new Date(sensor.last_seen_timestamp).getTime();
      const elapsed = now - lastSeen;

      if (elapsed > timeoutMs && sensor.status === 'ONLINE') {
        // Le capteur ne répond plus depuis plus longtemps que le seuil de battement
        this.db.setSensorStatus(sensor.device_id, 'DISCONNECTED');
        console.warn(`[HealthMonitor] ⚠️ Capteur déconnecté : ${sensor.device_id} (Patient: ${sensor.patient_id}, silencieux depuis ${Math.round(elapsed / 1000)}s)`);

        // Vérifier le debounce pour l'alerte de déconnexion
        const lastAlertTime = this.disconnectionAlertDebounce.get(sensor.device_id) || 0;
        if (now - lastAlertTime > config.NOTIFICATIONS.DEDUPLICATION_WINDOW_MS) {
          this.disconnectionAlertDebounce.set(sensor.device_id, now);

          if (typeof this.onSensorAlert === 'function') {
            this.onSensorAlert({
              patientId: sensor.patient_id,
              deviceId: sensor.device_id,
              type: 'sensor_disconnected',
              severity: 'warning', // Avertissement matériel et non urgence vitale
              reason: `Perte de signal du capteur ${sensor.device_id}. Aucune mesure reçue depuis ${Math.round(elapsed / 1000)} secondes. Ce statut matériel n'implique pas à lui seul une urgence clinique.`,
              detectionMethod: 'sensor_health_monitor',
              metrics: {
                silenceDurationSeconds: Math.round(elapsed / 1000),
                lastKnownTimestamp: sensor.last_seen_timestamp
              }
            });
          }
        }
      }
    }
  }
}

module.exports = SensorHealthMonitor;
