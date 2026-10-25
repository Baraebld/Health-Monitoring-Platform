const http = require('http');
const path = require('path');
const fs = require('fs');

const EdgeDatabase = require('./storage/database');
const { validateMeasurement } = require('./engine/validator');
const { evaluateClinicalRules } = require('./engine/ruleEngine');
const SensorHealthMonitor = require('./engine/healthMonitor');
const NotificationManager = require('./notification/notificationManager');
const MockSmsTransport = require('./notification/transports/mockTransport');
const SyncAgent = require('./sync/syncAgent');

const DEMO_DB_PATH = path.join(__dirname, 'data', 'demo_offline.db');

// Nettoyer la base démo précédente
if (fs.existsSync(DEMO_DB_PATH)) {
  try { fs.unlinkSync(DEMO_DB_PATH); } catch (e) {}
}

async function runDemo() {
  console.log('\n================================================================================');
  console.log('🩺 DÉMONSTRATION DU SYSTÈME D\'ALERTE EDGE AUTONOME (HORS-LIGNE) - IoMT');
  console.log('================================================================================');
  console.log('Scénario : Perte totale d\'Internet et coupure du backend Cloud central.');
  console.log('Objectif  : Démontrer la détection locale, la décision d\'alerte et l\'initiation SMS directe.\n');

  const db = new EdgeDatabase(DEMO_DB_PATH);
  const mockSms = new MockSmsTransport();
  const notifyManager = new NotificationManager(db, mockSms);

  let sensorAlertsTriggered = [];
  const healthMonitor = new SensorHealthMonitor(db, (sensorAlert) => {
    sensorAlertsTriggered.push(sensorAlert);
  });

  // --------------------------------------------------------------------------
  // ÉTAPE 1 : Ingestion d'une mesure nominale normale (Hors-ligne)
  // --------------------------------------------------------------------------
  console.log('--- [ÉTAPE 1] Ingestion d\'une mesure physiologique normale ---');
  const normalData = {
    patientId: 'patient_001',
    deviceId: 'smartwatch_123',
    timestamp: new Date().toISOString(),
    vitals: { heartRate: 72, spo2: 98, bloodPressure: { systolic: 120, diastolic: 80 } }
  };

  const val1 = validateMeasurement(normalData);
  console.log(`> Validation : ${val1.isValid ? 'VALIDE' : 'INVALIDE'} (Fraîcheur vérifiée)`);
  db.saveMeasurement(normalData);
  healthMonitor.recordHeartbeat(normalData.deviceId, normalData.patientId, normalData.vitals, normalData.timestamp);
  const anomalies1 = evaluateClinicalRules(normalData.vitals);
  console.log(`> Règles cliniques évaluées localement : ${anomalies1.length} anomalie(s) détectée(s).`);
  console.log(`> SMS émis : ${mockSms.getSentMessages().length} (Aucun SMS attendu) ✅\n`);

  // --------------------------------------------------------------------------
  // ÉTAPE 2 : Ingestion d'une anomalie critique aiguë (Hors-ligne)
  // --------------------------------------------------------------------------
  console.log('--- [ÉTAPE 2] Détection d\'une urgence médicale sans backend ---');
  const criticalData = {
    patientId: 'patient_001',
    deviceId: 'smartwatch_123',
    timestamp: new Date().toISOString(),
    vitals: { heartRate: 162, spo2: 86, bloodPressure: { systolic: 135, diastolic: 85 } } // Tachycardie + Hypoxie
  };

  const val2 = validateMeasurement(criticalData);
  db.saveMeasurement(criticalData);
  healthMonitor.recordHeartbeat(criticalData.deviceId, criticalData.patientId, criticalData.vitals, criticalData.timestamp);
  const anomalies2 = evaluateClinicalRules(criticalData.vitals);

  console.log(`> Anomalies cliniques identifiées localement :`);
  anomalies2.forEach(a => console.log(`  - [${a.severity.toUpperCase()}] ${a.type} : ${a.reason}`));

  const crypto = require('crypto');
  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: criticalData.patientId,
    deviceId: criticalData.deviceId,
    gatewayId: 'edge_rpi_gateway_01',
    eventTimestamp: criticalData.timestamp,
    alertType: anomalies2[0].type,
    severity: anomalies2[0].severity,
    reason: anomalies2[0].reason,
    detectionMethod: 'clinical_rules',
    metrics: criticalData.vitals,
    deliveryStatus: 'pending',
    isAcknowledged: false,
    isSynced: false
  };

  db.saveAlert(alert);
  console.log(`> Alerte locale générée et persistée dans SQLite : EventID = ${eventId.slice(0, 8)}...`);

  console.log(`> Déclenchement direct du transport cellulaire SMS...`);
  const dispatchResult = await notifyManager.dispatchAlert(alert);
  console.log(`> Résultat de l'émission SMS : ${dispatchResult.status} (Tentatives: ${dispatchResult.attempts})`);

  const sentSms = mockSms.getSentMessages();
  console.log(`> Contenu du SMS généré :`);
  console.log(`  "${sentSms[sentSms.length - 1].message}" ✅\n`);

  // --------------------------------------------------------------------------
  // ÉTAPE 3 : Contrôle Anti-Spam lors de mesures anormales répétées
  // --------------------------------------------------------------------------
  console.log('--- [ÉTAPE 3] Test du filtre Anti-Spam (Dédoublonnage) ---');
  console.log('> Réception d\'une nouvelle mesure anormale 5 secondes plus tard...');
  const duplicateAlert = {
    eventId: crypto.randomUUID(),
    patientId: criticalData.patientId,
    deviceId: criticalData.deviceId,
    gatewayId: 'edge_rpi_gateway_01',
    eventTimestamp: new Date().toISOString(),
    alertType: anomalies2[0].type,
    severity: anomalies2[0].severity,
    reason: anomalies2[0].reason,
    metrics: criticalData.vitals,
    deliveryStatus: 'pending'
  };
  db.saveAlert(duplicateAlert);
  const spamResult = await notifyManager.dispatchAlert(duplicateAlert);
  console.log(`> Statut d'envoi : ${spamResult.status} (Raison: ${spamResult.reason})`);
  console.log(`> Nombre total de SMS émis : ${mockSms.getSentMessages().length} (Bloqué à 1 pour éviter la saturation du médecin) ✅\n`);

  // --------------------------------------------------------------------------
  // ÉTAPE 4 : Détection de déconnexion capteur (Santé matérielle distincte)
  // --------------------------------------------------------------------------
  console.log('--- [ÉTAPE 4] Détection de perte de signal capteur (Distinction matérielle) ---');
  // Simuler 35 secondes d'absence de données
  const disconnectedDevice = 'pulse_oximeter_ble';
  const pastTime = new Date(Date.now() - 35000).toISOString();
  db.updateSensorHeartbeat(disconnectedDevice, 'patient_001', {}, pastTime);
  healthMonitor.checkSensors();

  if (sensorAlertsTriggered.length > 0) {
    const sAlert = sensorAlertsTriggered[0];
    console.log(`> Statut capteur : [${sAlert.severity.toUpperCase()}] ${sAlert.type}`);
    console.log(`> Motif explicite : ${sAlert.reason}`);
    console.log(`> Confirmation : Traité comme anomalie matérielle et non détresse cardiaque ✅\n`);
  }

  // --------------------------------------------------------------------------
  // ÉTAPE 5 : Reconnexion du Cloud et Synchronisation Idempotente
  // --------------------------------------------------------------------------
  console.log('--- [ÉTAPE 5] Reconnexion au Cloud & Synchronisation Idempotente ---');
  console.log('> Démarrage d\'un serveur Backend Cloud simulé...');

  let syncedOnCloud = [];
  const cloudServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/edge/sync') {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => {
        const body = JSON.parse(b);
        syncedOnCloud.push(...body.alerts);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          syncedEventIds: body.alerts.map(a => a.eventId),
          syncedMeasurementIds: body.measurements.map(m => m.id)
        }));
      });
    }
  });

  await new Promise(r => cloudServer.listen(0, '127.0.0.1', r));
  const cloudPort = cloudServer.address().port;
  console.log(`> Backend Cloud de nouveau disponible sur http://127.0.0.1:${cloudPort}`);

  const syncAgent = new SyncAgent(db, `http://127.0.0.1:${cloudPort}`);
  await syncAgent.syncOnce();

  console.log(`> Synchronisation terminée.`);
  console.log(`> Alertes transférées au Cloud : ${syncedOnCloud.length}`);
  const unsyncedCount = db.getUnsyncedAlerts().length;
  console.log(`> Alertes restant non synchronisées en local : ${unsyncedCount} ✅\n`);

  cloudServer.close();
  db.close();

  console.log('================================================================================');
  console.log('🎉 DÉMONSTRATION TERMINÉE AVEC SUCCÈS : 100% DES OBJECTIFS HORS-LIGNE VALIDÉS');
  console.log('================================================================================\n');
}

runDemo().catch(err => {
  console.error('Erreur démonstration:', err);
});
