const config = require('../config');

/**
 * Moteur de règles cliniques déterministes transparentes et configurables.
 * Évalue les constantes physiologiques sans aucune dépendance réseau.
 */
function evaluateClinicalRules(vitals) {
  const anomalies = [];
  const thresholds = config.CLINICAL_THRESHOLDS;

  if (!vitals || typeof vitals !== 'object') {
    return anomalies;
  }

  // 1. Évaluation Fréquence Cardiaque
  if (typeof vitals.heartRate === 'number') {
    if (vitals.heartRate < thresholds.HEART_RATE_MIN) {
      anomalies.push({
        type: 'critical_bradycardia',
        severity: 'critical',
        reason: `Bradycardie critique détectée : ${vitals.heartRate} bpm (seuil < ${thresholds.HEART_RATE_MIN} bpm)`,
        metric: 'heartRate',
        value: vitals.heartRate
      });
    } else if (vitals.heartRate > thresholds.HEART_RATE_MAX) {
      anomalies.push({
        type: 'critical_tachycardia',
        severity: 'critical',
        reason: `Tachycardie critique détectée : ${vitals.heartRate} bpm (seuil > ${thresholds.HEART_RATE_MAX} bpm)`,
        metric: 'heartRate',
        value: vitals.heartRate
      });
    }
  }

  // 2. Évaluation Saturation en Oxygène (SpO2)
  if (typeof vitals.spo2 === 'number') {
    if (vitals.spo2 < thresholds.SPO2_MIN) {
      anomalies.push({
        type: 'hypoxia',
        severity: 'critical',
        reason: `Hypoxie sévère détectée : SpO2 à ${vitals.spo2}% (seuil < ${thresholds.SPO2_MIN}%)`,
        metric: 'spo2',
        value: vitals.spo2
      });
    }
  }

  // 3. Évaluation Pression Artérielle
  const bp = vitals.bloodPressure;
  if (bp && typeof bp === 'object') {
    if (typeof bp.systolic === 'number') {
      if (bp.systolic < thresholds.SYSTOLIC_MIN) {
        anomalies.push({
          type: 'hypotension',
          severity: 'critical',
          reason: `Hypotension sévère : Pression systolique à ${bp.systolic} mmHg (seuil < ${thresholds.SYSTOLIC_MIN} mmHg)`,
          metric: 'systolic',
          value: bp.systolic
        });
      } else if (bp.systolic > thresholds.SYSTOLIC_MAX) {
        anomalies.push({
          type: 'hypertension',
          severity: 'critical',
          reason: `Hypertension sévère : Pression systolique à ${bp.systolic} mmHg (seuil > ${thresholds.SYSTOLIC_MAX} mmHg)`,
          metric: 'systolic',
          value: bp.systolic
        });
      }
    }
  }

  return anomalies;
}

module.exports = {
  evaluateClinicalRules
};
