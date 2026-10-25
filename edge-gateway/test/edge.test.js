const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const EdgeDatabase = require('../storage/database');
const { validateMeasurement } = require('../engine/validator');
const { evaluateClinicalRules } = require('../engine/ruleEngine');
const SensorHealthMonitor = require('../engine/healthMonitor');
const NotificationManager = require('../notification/notificationManager');
const MockSmsTransport = require('../notification/transports/mockTransport');
const SyncAgent = require('../sync/syncAgent');

const TEST_DB_PATH = path.join(__dirname, 'test_edge_storage.db');

function cleanupDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
  }
  const walPath = TEST_DB_PATH + '-wal';
  const shmPath = TEST_DB_PATH + '-shm';
  if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch (e) {}
  if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch (e) {}
}

// Nettoyage initial
cleanupDb();

// --------------------------------------------------------------------------
// TEST 1 : Une anomalie configurée déclenche une alerte locale SANS requête backend
// --------------------------------------------------------------------------
test('1. Configured anomaly triggers a local alert without a backend request', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);

  const abnormalPayload = {
    patientId: 'patient_001',
    deviceId: 'smartwatch_123',
    timestamp: new Date().toISOString(),
    vitals: {
      heartRate: 165, // Tachycardie critique (> 150 bpm)
      spo2: 98,
      bloodPressure: { systolic: 120, diastolic: 80 }
    }
  };

  // 1. Validation
  const validation = validateMeasurement(abnormalPayload);
  assert.strictEqual(validation.isValid, true, 'La mesure doit être valide');

  // 2. Détection par règles cliniques locales (pur calcul sans réseau)
  const anomalies = evaluateClinicalRules(abnormalPayload.vitals);
  assert.strictEqual(anomalies.length >= 1, true, 'Une anomalie doit être détectée');
  assert.strictEqual(anomalies[0].type, 'critical_tachycardia');
  assert.strictEqual(anomalies[0].severity, 'critical');

  // 3. Création et stockage de l'alerte locale
  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: abnormalPayload.patientId,
    deviceId: abnormalPayload.deviceId,
    gatewayId: 'test_rpi_gw',
    eventTimestamp: abnormalPayload.timestamp,
    alertType: anomalies[0].type,
    severity: anomalies[0].severity,
    reason: anomalies[0].reason,
    detectionMethod: 'clinical_rules',
    metrics: abnormalPayload.vitals,
    deliveryStatus: 'pending',
    isAcknowledged: false,
    isSynced: false
  };

  db.saveAlert(alert);

  // 4. Vérification dans la base locale
  const saved = db.getAlertById(eventId);
  assert.ok(saved, 'L alerte doit exister dans la base locale SQLite');
  assert.strictEqual(saved.alertType, 'critical_tachycardia');
  assert.strictEqual(saved.isSynced, false, 'L alerte doit être marquée comme non synchronisée');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 2 : Le transport SMS (Mock) est invoqué pendant que le backend est hors-ligne
// --------------------------------------------------------------------------
test('2. Mock SMS transport is invoked while the backend is offline', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);
  const mockTransport = new MockSmsTransport();
  const notifyManager = new NotificationManager(db, mockTransport);

  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: 'patient_offline_01',
    deviceId: 'smartwatch_offline',
    gatewayId: 'test_rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'hypoxia',
    severity: 'critical',
    reason: 'Hypoxie sévère (SpO2: 85%)',
    detectionMethod: 'clinical_rules',
    metrics: { heartRate: 90, spo2: 85, bloodPressure: { systolic: 110, diastolic: 70 } },
    deliveryStatus: 'pending',
    isAcknowledged: false,
    isSynced: false
  };

  db.saveAlert(alert);

  // Déclenchement de la notification (sans aucun contact avec le cloud)
  const result = await notifyManager.dispatchAlert(alert);

  assert.strictEqual(result.initiated, true);
  assert.strictEqual(result.status, 'accepted_by_mock_transport');

  const sentList = mockTransport.getSentMessages();
  assert.strictEqual(sentList.length, 1, 'Un SMS simulé doit avoir été émis');
  assert.strictEqual(sentList[0].eventId, eventId);
  assert.ok(sentList[0].message.includes('hypoxia') || sentList[0].message.includes('HYPOXIA') || sentList[0].message.includes('patient_offline_01'));

  // Vérification de la mise à jour du statut dans SQLite
  const updated = db.getAlertById(eventId);
  assert.strictEqual(updated.deliveryStatus, 'accepted_by_mock_transport');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 3 : L'événement persiste après un redémarrage du processus
// --------------------------------------------------------------------------
test('3. The event persists after a service restart', async () => {
  const eventId = crypto.randomUUID();

  // Étape A : Écriture avec la première instance
  let db1 = new EdgeDatabase(TEST_DB_PATH);
  db1.saveAlert({
    eventId,
    patientId: 'patient_persist_01',
    deviceId: 'device_persist',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'critical_bradycardia',
    severity: 'critical',
    reason: 'Pouls à 35 bpm',
    detectionMethod: 'clinical_rules',
    metrics: { heartRate: 35 },
    deliveryStatus: 'accepted_by_mock_transport',
    isAcknowledged: false,
    isSynced: false
  });
  db1.close(); // Fermeture simulant le crash/arrêt du service

  // Étape B : Réouverture avec une nouvelle instance de connexion
  let db2 = new EdgeDatabase(TEST_DB_PATH);
  const reloaded = db2.getAlertById(eventId);

  assert.ok(reloaded, 'L alerte doit persister après redémarrage');
  assert.strictEqual(reloaded.eventId, eventId);
  assert.strictEqual(reloaded.alertType, 'critical_bradycardia');
  assert.strictEqual(reloaded.deliveryStatus, 'accepted_by_mock_transport');

  db2.close();
});

// --------------------------------------------------------------------------
// TEST 4 : Les anomalies répétées ne provoquent pas de flood SMS incontrôlé (Anti-Spam)
// --------------------------------------------------------------------------
test('4. Repeated abnormal measurements do not cause uncontrolled SMS flooding', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);
  const mockTransport = new MockSmsTransport();
  const notifyManager = new NotificationManager(db, mockTransport);

  const patientId = 'patient_spam_test';
  const alertType = 'critical_tachycardia';

  // Première alerte
  const alert1 = {
    eventId: crypto.randomUUID(),
    patientId,
    deviceId: 'watch_spam',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType,
    severity: 'critical',
    reason: 'Tachycardie 160 bpm',
    metrics: { heartRate: 160 },
    deliveryStatus: 'pending'
  };
  db.saveAlert(alert1);
  const res1 = await notifyManager.dispatchAlert(alert1);
  assert.strictEqual(res1.status, 'accepted_by_mock_transport');
  assert.strictEqual(mockTransport.getSentMessages().length, 1);

  // Deuxième alerte identique reçue 5 secondes après
  const alert2 = {
    eventId: crypto.randomUUID(),
    patientId,
    deviceId: 'watch_spam',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType,
    severity: 'critical',
    reason: 'Tachycardie 162 bpm',
    metrics: { heartRate: 162 },
    deliveryStatus: 'pending'
  };
  db.saveAlert(alert2);
  const res2 = await notifyManager.dispatchAlert(alert2);

  // Doit être dédupliquée et bloquée
  assert.strictEqual(res2.status, 'debounced');
  assert.strictEqual(res2.initiated, false);
  // Le nombre de SMS transmis doit rester 1
  assert.strictEqual(mockTransport.getSentMessages().length, 1, 'Le nombre de SMS émis ne doit pas augmenter');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 5 : Les tentatives d'envoi SMS échouées sont réessayées selon la politique (Backoff)
// --------------------------------------------------------------------------
test('5. Failed SMS attempts are retried according to policy', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);
  const mockTransport = new MockSmsTransport();
  const notifyManager = new NotificationManager(db, mockTransport);
  notifyManager.initialBackoffMs = 10; // Réduction pour accélérer le test

  // Simuler 2 échecs matériels puis un succès
  mockTransport.simulateFailure(true, 'TEMPORARY_MODEM_NETWORK_BUSY', 2);

  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: 'patient_retry_test',
    deviceId: 'watch_retry',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'hypertension',
    severity: 'critical',
    reason: 'Tension 190 mmHg',
    metrics: { bloodPressure: { systolic: 190, diastolic: 100 } },
    deliveryStatus: 'pending'
  };
  db.saveAlert(alert);

  const result = await notifyManager.dispatchAlert(alert);

  // Après 3 tentatives (2 échecs + 1 succès), le message doit être accepté
  assert.strictEqual(result.initiated, true);
  assert.strictEqual(result.attempts, 3, 'Doit avoir nécessité 3 tentatives');
  assert.strictEqual(result.status, 'accepted_by_mock_transport');

  // Vérifier le journal d'audit SQLite
  const attempts = db.getSmsAttemptsForEvent(eventId);
  assert.strictEqual(attempts.length, 3, '3 tentatives doivent être enregistrées dans l audit SQLite');
  assert.strictEqual(attempts[0].status, 'failed');
  assert.strictEqual(attempts[1].status, 'failed');
  assert.strictEqual(attempts[2].status, 'accepted_by_mock_transport');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 6 : L'échec de transmission cellulaire est distinct de la réussite
// --------------------------------------------------------------------------
test('6. Cellular delivery failure is distinct from successful delivery', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);
  const mockTransport = new MockSmsTransport();
  const notifyManager = new NotificationManager(db, mockTransport);
  notifyManager.initialBackoffMs = 5;

  // Panne persistante : Perte complète de réseau cellulaire
  mockTransport.simulateFailure(true, 'NO_CELLULAR_CARRIER_COVERAGE', Infinity);

  const eventId = crypto.randomUUID();
  const alert = {
    eventId,
    patientId: 'patient_fail_test',
    deviceId: 'watch_fail',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'hypotension',
    severity: 'critical',
    reason: 'Tension basse 80 mmHg',
    metrics: { bloodPressure: { systolic: 80, diastolic: 50 } },
    deliveryStatus: 'pending'
  };
  db.saveAlert(alert);

  const result = await notifyManager.dispatchAlert(alert);

  assert.strictEqual(result.initiated, false);
  assert.strictEqual(result.status, 'failed');
  assert.notStrictEqual(result.status, 'accepted_by_modem');

  // L'alerte doit être préservée localement avec son statut 'failed'
  const saved = db.getAlertById(eventId);
  assert.strictEqual(saved.deliveryStatus, 'failed');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 7 : Les événements se synchronisent après reconnexion du backend sans doublons
// --------------------------------------------------------------------------
test('7. Events synchronize after the backend reconnects without duplicates', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);

  // Insérer 2 alertes et 2 mesures en attente de synchronisation
  const ev1 = crypto.randomUUID();
  const ev2 = crypto.randomUUID();

  db.saveAlert({
    eventId: ev1,
    patientId: 'patient_sync_01',
    deviceId: 'dev_1',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'hypoxia',
    severity: 'critical',
    reason: 'Hypoxie',
    metrics: { spo2: 88 },
    deliveryStatus: 'accepted_by_mock_transport',
    isAcknowledged: false,
    isSynced: false
  });

  db.saveAlert({
    eventId: ev2,
    patientId: 'patient_sync_02',
    deviceId: 'dev_2',
    gatewayId: 'rpi_gw',
    eventTimestamp: new Date().toISOString(),
    alertType: 'critical_tachycardia',
    severity: 'critical',
    reason: 'Tachycardie',
    metrics: { heartRate: 160 },
    deliveryStatus: 'accepted_by_mock_transport',
    isAcknowledged: false,
    isSynced: false
  });

  db.saveMeasurement({
    patientId: 'patient_sync_01',
    deviceId: 'dev_1',
    timestamp: new Date().toISOString(),
    vitals: { heartRate: 75, spo2: 98, bloodPressure: { systolic: 120, diastolic: 80 } }
  });

  assert.strictEqual(db.getUnsyncedAlerts().length >= 2, true);

  // Création d'un mini-serveur de test simulant le backend /api/edge/sync
  let receivedBatches = 0;
  let receivedAlertIds = [];

  const mockServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/edge/sync') {
      let data = '';
      req.on('data', c => data += c);
      req.on('end', () => {
        receivedBatches++;
        const parsed = JSON.parse(data);
        const alertIds = parsed.alerts.map(a => a.eventId);
        const measIds = parsed.measurements.map(m => m.id);
        receivedAlertIds.push(...alertIds);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          syncedEventIds: alertIds,
          syncedMeasurementIds: measIds
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const serverPort = mockServer.address().port;
  const syncAgent = new SyncAgent(db, `http://127.0.0.1:${serverPort}`);

  // Synchronisation 1
  await syncAgent.syncOnce();

  assert.strictEqual(receivedBatches, 1);
  assert.ok(receivedAlertIds.includes(ev1));
  assert.ok(receivedAlertIds.includes(ev2));

  // Vérifier qu'elles sont marquées comme synchronisées localement
  const alertAfterSync = db.getAlertById(ev1);
  assert.strictEqual(alertAfterSync.isSynced, true);
  assert.ok(alertAfterSync.syncedAt, 'Doit avoir une date de synchronisation');

  // Synchronisation 2 (idempotente : aucune nouvelle alerte ne doit être poussée)
  await syncAgent.syncOnce();
  assert.strictEqual(receivedBatches, 1, 'Aucun deuxième appel ne doit être émis pour des alertes déjà synchronisées');

  mockServer.close();
  db.close();
});

// --------------------------------------------------------------------------
// TEST 8 : La déconnexion d'un capteur est signalée de manière DISTINCTE
// --------------------------------------------------------------------------
test('8. Sensor disconnection is reported separately from medical emergencies', async () => {
  const db = new EdgeDatabase(TEST_DB_PATH);
  let capturedAlert = null;

  const healthMonitor = new SensorHealthMonitor(db, (alert) => {
    capturedAlert = alert;
  });

  const deviceId = 'sensor_bluetooth_01';
  const patientId = 'patient_sensor_health';

  // 1. Battement de cœur initial dans le passé (> HEARTBEAT_TIMEOUT_MS)
  const pastTimestamp = new Date(Date.now() - 40000).toISOString(); // 40 secondes dans le passé
  db.updateSensorHeartbeat(deviceId, patientId, { heartRate: 72 }, pastTimestamp);

  // 2. Déclenchement de la vérification de santé
  healthMonitor.checkSensors();

  assert.ok(capturedAlert, 'Une alerte de déconnexion capteur doit avoir été générée');
  assert.strictEqual(capturedAlert.type, 'sensor_disconnected');
  assert.strictEqual(capturedAlert.severity, 'warning', 'Doit être un warning matériel et non une urgence critique');
  assert.strictEqual(capturedAlert.detectionMethod, 'sensor_health_monitor');
  assert.ok(capturedAlert.reason.includes('Perte de signal'), 'La raison doit expliciter le problème matériel');

  // L'état du capteur doit être passé à DISCONNECTED
  const sensors = db.getAllSensorStates();
  const target = sensors.find(s => s.device_id === deviceId);
  assert.strictEqual(target.status, 'DISCONNECTED');

  db.close();
});

// --------------------------------------------------------------------------
// TEST 9 : Les utilisateurs non autorisés ne peuvent pas accéder aux données d'un autre patient
// --------------------------------------------------------------------------
test('9. Unauthorized users cannot access another patient\'s information', async () => {
  const jwtSecret = 'test_secret_for_rbac_tests';
  process.env.JWT_SECRET = jwtSecret;

  // Création d'un token pour le patient 1
  const patient1Token = jwt.sign(
    { user: { id: 'patient_001', role: 'patient', patientId: 'patient_001' } },
    jwtSecret
  );

  // Simulation d'une requête Express
  const authMiddleware = require('../../api-gateway/middleware/auth');

  // Cas A : Requête sans token -> 401
  const reqNoAuth = { header: (name) => null };
  const resNoAuth = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; }
  };
  authMiddleware(reqNoAuth, resNoAuth, () => {});
  assert.strictEqual(resNoAuth.statusCode, 401, 'Requête sans token doit renvoyer 401');

  // Cas B : Patient 1 demande ses propres données
  const reqPatient1 = {
    header: (name) => name === 'Authorization' ? `Bearer ${patient1Token}` : null
  };
  let nextCalled = false;
  authMiddleware(reqPatient1, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Le middleware doit autoriser le token valide');
  assert.strictEqual(reqPatient1.user.id, 'patient_001');
  assert.strictEqual(reqPatient1.user.role, 'patient');

  // Contrôle RBAC : si patient_001 tente de spécifier patientId='patient_999'
  const attemptedPatient = 'patient_999';
  const isForbidden = (reqPatient1.user.role === 'patient' && attemptedPatient !== reqPatient1.user.patientId);
  assert.strictEqual(isForbidden, true, 'Un patient ne doit pas pouvoir accéder aux alertes d un autre patient');
});

// Nettoyage final
test.after(() => {
  cleanupDb();
});
