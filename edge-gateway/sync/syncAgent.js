const http = require('http');
const https = require('https');
const config = require('../config');

/**
 * Agent de synchronisation asynchrone et idempotent.
 * Détecte la connectivité avec le Cloud central et pousse les mesures et alertes stockées localement.
 */
class SyncAgent {
  constructor(database, backendUrl = config.BACKEND_URL) {
    this.db = database;
    this.backendUrl = backendUrl.replace(/\/$/, '');
    this.syncIntervalMs = config.SYNC_INTERVAL_MS;
    this.apiKey = config.SYNC_API_KEY;
    this.intervalHandle = null;
    this.isSyncing = false;
    this.lastSuccessfulSync = null;
    this.isBackendOnline = false;
  }

  start() {
    if (this.intervalHandle) return;
    // Premier essai immédiat
    this.syncOnce();
    this.intervalHandle = setInterval(() => this.syncOnce(), this.syncIntervalMs);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Effectue un cycle de synchronisation idempotente.
   */
  async syncOnce() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // 1. Récupérer les éléments en attente de synchronisation
      const pendingAlerts = this.db.getUnsyncedAlerts(50);
      const pendingMeasurements = this.db.getUnsyncedMeasurements(100);

      if (pendingAlerts.length === 0 && pendingMeasurements.length === 0) {
        // Rien à synchroniser
        this.isSyncing = false;
        return;
      }

      console.log(`[SyncAgent] 🔄 Données en attente : ${pendingAlerts.length} alerte(s), ${pendingMeasurements.length} mesure(s). Tentative de contact avec ${this.backendUrl}...`);

      const payload = {
        gatewayId: config.GATEWAY_ID,
        clientSyncTimestamp: new Date().toISOString(),
        alerts: pendingAlerts,
        measurements: pendingMeasurements.map(m => ({
          id: m.id,
          patientId: m.patient_id,
          deviceId: m.device_id,
          timestamp: m.timestamp,
          vitals: {
            heartRate: m.heart_rate,
            spo2: m.spo2,
            bloodPressure: { systolic: m.systolic, diastolic: m.diastolic }
          }
        }))
      };

      const response = await this._postJson(`${this.backendUrl}/api/edge/sync`, payload);

      if (response && response.success) {
        const now = new Date().toISOString();
        if (response.syncedEventIds && response.syncedEventIds.length > 0) {
          this.db.markAlertsSynced(response.syncedEventIds, now);
        }
        if (response.syncedMeasurementIds && response.syncedMeasurementIds.length > 0) {
          this.db.markMeasurementsSynced(response.syncedMeasurementIds, now);
        }

        this.lastSuccessfulSync = now;
        this.isBackendOnline = true;
        console.log(`[SyncAgent] ✅ Synchronisation réussie : ${response.syncedEventIds?.length || 0} alertes et ${response.syncedMeasurementIds?.length || 0} mesures transférées.`);
      } else {
        this.isBackendOnline = false;
        console.warn(`[SyncAgent] ⚠️ Réponse inattendue du backend :`, response);
      }

    } catch (err) {
      this.isBackendOnline = false;
      // Échec silencieux et propre sans faire planter le service local
      console.log(`[SyncAgent] ℹ️ Backend central non disponible (${err.message}). Les événements restent sécurisés localement dans SQLite.`);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Envoi HTTP POST natif (sans dépendance externe).
   */
  _postJson(urlStr, data) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const body = JSON.stringify(data);
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Gateway-Key': this.apiKey,
          'X-Gateway-Id': config.GATEWAY_ID
        },
        timeout: 5000 // 5 secondes de timeout maximum
      };

      const req = client.request(options, (res) => {
        let respBody = '';
        res.on('data', chunk => respBody += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(respBody);
            resolve(parsed);
          } catch (e) {
            resolve({ success: false, raw: respBody });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout de connexion'));
      });

      req.write(body);
      req.end();
    });
  }
}

module.exports = SyncAgent;
