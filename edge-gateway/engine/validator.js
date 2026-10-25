const config = require('../config');

/**
 * Valide l'intégrité, la fraîcheur et la conformité physiologique des données reçues.
 */
function validateMeasurement(data) {
  if (!data || typeof data !== 'object') {
    return { isValid: false, error: 'Corps de données manquant ou invalide' };
  }

  const { patientId, deviceId, timestamp, vitals } = data;

  if (!patientId || typeof patientId !== 'string') {
    return { isValid: false, error: 'patientId manquant ou invalide' };
  }

  if (!deviceId || typeof deviceId !== 'string') {
    return { isValid: false, error: 'deviceId manquant ou invalide' };
  }

  if (!timestamp || isNaN(Date.parse(timestamp))) {
    return { isValid: false, error: 'Horodatage manquant ou invalide' };
  }

  if (!vitals || typeof vitals !== 'object') {
    return { isValid: false, error: 'Objet vitals manquant' };
  }

  // Vérification de la fraîcheur temporelle
  const measurementTime = new Date(timestamp).getTime();
  const now = Date.now();
  const maxFutureSkewMs = 60 * 1000; // 1 minute de tolérance pour dérive d'horloge

  if (measurementTime > now + maxFutureSkewMs) {
    return { isValid: false, error: 'Horodatage futur incohérent (dérive d\'horloge excessive)' };
  }

  const isStale = (now - measurementTime) > config.SENSOR_HEALTH.STALE_THRESHOLD_MS;

  // Validation des limites physiologiques réalistes
  const { heartRate, spo2, bloodPressure } = vitals;

  if (heartRate !== undefined && heartRate !== null) {
    if (typeof heartRate !== 'number' || heartRate < 0 || heartRate > 300) {
      return { isValid: false, error: `Fréquence cardiaque hors limites physiologiques (${heartRate} bpm)` };
    }
  }

  if (spo2 !== undefined && spo2 !== null) {
    if (typeof spo2 !== 'number' || spo2 < 0 || spo2 > 100) {
      return { isValid: false, error: `Saturation SpO2 hors limites (${spo2} %)` };
    }
  }

  if (bloodPressure && typeof bloodPressure === 'object') {
    const { systolic, diastolic } = bloodPressure;
    if (systolic !== undefined && systolic !== null) {
      if (typeof systolic !== 'number' || systolic < 20 || systolic > 320) {
        return { isValid: false, error: `Pression systolique aberrante (${systolic} mmHg)` };
      }
    }
    if (diastolic !== undefined && diastolic !== null) {
      if (typeof diastolic !== 'number' || diastolic < 10 || diastolic > 200) {
        return { isValid: false, error: `Pression diastolique aberrante (${diastolic} mmHg)` };
      }
    }
  }

  return {
    isValid: true,
    isStale,
    staleAgeMs: Math.max(0, now - measurementTime)
  };
}

module.exports = {
  validateMeasurement
};
