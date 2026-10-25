const http = require('http');
const crypto = require('crypto');
const config = require('./config');
const EdgeDatabase = require('./storage/database');
const { validateMeasurement } = require('./engine/validator');
const { evaluateClinicalRules } = require('./engine/ruleEngine');
const SensorHealthMonitor = require('./engine/healthMonitor');
const LocalMLDetector = require('./engine/localML');
const NotificationManager = require('./notification/notificationManager');
const SyncAgent = require('./sync/syncAgent');

// Initialisation des modules Edge
console.log('====================================================');
console.log(`[EDGE GATEWAY] Démarrage sur passerelle : ${config.GATEWAY_ID}`);
console.log(`[EDGE GATEWAY] Base SQLite locale : ${config.DB_PATH}`);
console.log(`[EDGE GATEWAY] Transport SMS configuré : [${config.NOTIFICATIONS.TRANSPORT}]`);
console.log('====================================================');

const db = new EdgeDatabase();
const notificationManager = new NotificationManager(db);
const localML = new LocalMLDetector();

// Callback d'alerte pour les événements de santé des capteurs
function handleSensorAlert(sensorEvent) {
  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: sensorEvent.patientId,
    deviceId: sensorEvent.deviceId,
    gatewayId: config.GATEWAY_ID,
    eventTimestamp: new Date().toISOString(),
    alertType: sensorEvent.type,
    severity: sensorEvent.severity,
    reason: sensorEvent.reason,
    detectionMethod: sensorEvent.detectionMethod,
    metrics: sensorEvent.metrics,
    deliveryStatus: 'pending',
    isAcknowledged: false,
    isSynced: false
  };

  db.saveAlert(alert);
  // Envoi de notification locale immédiate
  notificationManager.dispatchAlert(alert);
}

const healthMonitor = new SensorHealthMonitor(db, handleSensorAlert);
healthMonitor.start(5000);

const syncAgent = new SyncAgent(db, config.BACKEND_URL);
syncAgent.start();

/**
 * Traitement central d'une mesure physiologique en bordure de réseau (Edge)
 */
async function processIncomingMeasurement(data) {
  // 1. Validation de l'intégrité et de la cohérence des données
  const validation = validateMeasurement(data);
  if (!validation.isValid) {
    return { success: false, statusCode: 400, error: validation.error };
  }

  // 2. Enregistrement du battement de cœur du capteur
  healthMonitor.recordHeartbeat(data.deviceId, data.patientId, data.vitals, data.timestamp);

  // 3. Persistance locale obligatoire dans SQLite
  db.saveMeasurement(data);

  // 4. Évaluation des règles cliniques déterministes (autonome sans cloud)
  const clinicalAnomalies = evaluateClinicalRules(data.vitals);

  // 5. Évaluation optionnelle du détecteur ML local embarqué
  let mlAnomaly = null;
  if (clinicalAnomalies.length === 0) {
    mlAnomaly = localML.detectAnomaly(data.patientId, data.vitals);
  }

  const allAnomalies = [...clinicalAnomalies];
  if (mlAnomaly) {
    allAnomalies.push({
      type: mlAnomaly.type,
      severity: mlAnomaly.severity,
      reason: mlAnomaly.reason,
      detectionMethod: 'local_ml',
      metric: 'multivariate_statistical',
      value: mlAnomaly.metrics.score
    });
  }

  // 6. Si anomalie détectée : Génération de l'alerte structurée et déclenchement SMS immédiat
  const generatedAlerts = [];
  if (allAnomalies.length > 0) {
    const primaryAnomaly = allAnomalies[0];
    const eventId = crypto.randomUUID();

    const alert = {
      eventId,
      patientId: data.patientId,
      deviceId: data.deviceId,
      gatewayId: config.GATEWAY_ID,
      eventTimestamp: data.timestamp || new Date().toISOString(),
      alertType: primaryAnomaly.type,
      severity: primaryAnomaly.severity,
      reason: primaryAnomaly.reason,
      detectionMethod: primaryAnomaly.detectionMethod || 'clinical_rules',
      metrics: data.vitals,
      deliveryStatus: 'pending',
      isAcknowledged: false,
      isSynced: false
    };

    // Sauvegarde immédiate dans SQLite
    db.saveAlert(alert);
    generatedAlerts.push(alert);

    console.log(`[EDGE DECISION] 🚨 Anomalie locale validée [${alert.alertType}] pour ${alert.patientId} (Gravité: ${alert.severity})`);

    // DÉCLENCHEMENT IMMÉDIAT DE LA NOTIFICATION SMS (indépendant du cloud)
    notificationManager.dispatchAlert(alert).catch(err => {
      console.error(`[EDGE NOTIFY] Erreur dispatch SMS :`, err.message);
    });
  }

  return {
    success: true,
    statusCode: 200,
    isStale: validation.isStale,
    anomaliesDetected: allAnomalies.length,
    alerts: generatedAlerts.map(a => ({ eventId: a.eventId, type: a.alertType, severity: a.severity }))
  };
}

/**
 * Serveur HTTP léger embarqué (sans dépendance externe Express)
 */
const server = http.createServer(async (req, res) => {
  // En-têtes CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Gateway-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Endpoint d'ingestion de mesures locales : POST /api/vitals
  if (req.method === 'POST' && url.pathname === '/api/vitals') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const json = JSON.parse(body);
        const result = await processIncomingMeasurement(json);
        res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'JSON malformé : ' + e.message }));
      }
    });
    return;
  }

  // Endpoint de statut : GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    const modemHealth = await notificationManager.transport.healthCheck();
    const sensorStates = db.getAllSensorStates();
    const unsyncedAlerts = db.getUnsyncedAlerts(100);
    const unsyncedMeas = db.getUnsyncedMeasurements(100);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'UP',
      gatewayId: config.GATEWAY_ID,
      timestamp: new Date().toISOString(),
      backendReachable: syncAgent.isBackendOnline,
      lastSuccessfulSync: syncAgent.lastSuccessfulSync,
      unsyncedRecords: {
        alerts: unsyncedAlerts.length,
        measurements: unsyncedMeas.length
      },
      transport: {
        name: notificationManager.transport.name,
        health: modemHealth
      },
      sensors: sensorStates
    }, null, 2));
  }

  // Endpoint des alertes locales : GET /api/alerts
  if (req.method === 'GET' && url.pathname === '/api/alerts') {
    const alerts = db.getAllAlerts(50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(alerts));
  }

  // Acquittement local d'alerte : PATCH /api/alerts/:id/ack
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/alerts/') && url.pathname.endsWith('/ack')) {
    const parts = url.pathname.split('/');
    const eventId = parts[3];
    db.acknowledgeAlert(eventId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: `Alerte ${eventId} acquittée localement` }));
  }

  // Déclencheur manuel de sync : POST /api/sync/trigger
  if (req.method === 'POST' && url.pathname === '/api/sync/trigger') {
    await syncAgent.syncOnce();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      lastSync: syncAgent.lastSuccessfulSync,
      backendOnline: syncAgent.isBackendOnline
    }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route non trouvée sur la passerelle Edge' }));
});

server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`[EDGE GATEWAY] ✅ Serveur HTTP local prêt et écoute sur http://0.0.0.0:${config.PORT}`);
});

// Arrêt gracieux
function shutdown() {
  console.log('\n[EDGE GATEWAY] Arrêt en cours...');
  healthMonitor.stop();
  syncAgent.stop();
  server.close(() => {
    db.close();
    console.log('[EDGE GATEWAY] Base SQLite fermée proprement. Arrêt complet.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = {
  db,
  notificationManager,
  healthMonitor,
  syncAgent,
  processIncomingMeasurement
};
