const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) {}
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (e) {}

module.exports = {
  // Identification de la passerelle Edge (Raspberry Pi)
  GATEWAY_ID: process.env.EDGE_GATEWAY_ID || 'edge_gateway_rpi_01',
  PORT: parseInt(process.env.EDGE_PORT || '3001', 10),

  // Stockage local persistant SQLite
  DB_PATH: process.env.EDGE_DB_PATH || path.join(__dirname, 'data', 'edge_storage.db'),

  // Connexion Backend Central (optionnelle / synchronisation)
  BACKEND_URL: process.env.CENTRAL_BACKEND_URL || process.env.API_URL || 'http://localhost:3000',
  SYNC_INTERVAL_MS: parseInt(process.env.SYNC_INTERVAL_MS || '15000', 10),
  SYNC_API_KEY: process.env.EDGE_SYNC_API_KEY || 'edge_secret_token_pfe_2026',

  // Seuils cliniques configurables
  CLINICAL_THRESHOLDS: {
    HEART_RATE_MIN: parseInt(process.env.THRESH_HR_MIN || '40', 10), // bradycardie critique
    HEART_RATE_MAX: parseInt(process.env.THRESH_HR_MAX || '150', 10), // tachycardie critique
    SPO2_MIN: parseInt(process.env.THRESH_SPO2_MIN || '90', 10),       // hypoxie critique
    SYSTOLIC_MIN: parseInt(process.env.THRESH_SYS_MIN || '90', 10),   // hypotension critique
    SYSTOLIC_MAX: parseInt(process.env.THRESH_SYS_MAX || '180', 10),  // hypertension critique
  },

  // Surveillance de santé des capteurs
  SENSOR_HEALTH: {
    STALE_THRESHOLD_MS: parseInt(process.env.STALE_THRESHOLD_MS || '30000', 10), // Données > 30s considérées obsolètes
    HEARTBEAT_TIMEOUT_MS: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '20000', 10), // Aucune mesure > 20s = déconnexion
  },

  // Transport et politiques de notification SMS
  NOTIFICATIONS: {
    TRANSPORT: process.env.SMS_TRANSPORT || 'mock', // 'mock' ou 'modem'
    RECIPIENT_PHONE: process.env.DOCTOR_PHONE_NUMBER || '+33600000000',
    MODEM_PORT: process.env.MODEM_SERIAL_PORT || '/dev/ttyUSB0',
    MODEM_BAUD_RATE: parseInt(process.env.MODEM_BAUD_RATE || '115200', 10),
    MAX_RETRIES: parseInt(process.env.SMS_MAX_RETRIES || '3', 10),
    INITIAL_BACKOFF_MS: parseInt(process.env.SMS_BACKOFF_MS || '1000', 10),
    DEDUPLICATION_WINDOW_MS: parseInt(process.env.SMS_DEBOUNCE_MS || '300000', 10), // 5 minutes
  },

  // Détecteur local ML léger
  LOCAL_ML: {
    ENABLED: process.env.ENABLE_LOCAL_ML === 'true',
    WINDOW_SIZE: 10,
    Z_SCORE_THRESHOLD: 3.0,
  }
};
