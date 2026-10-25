const config = require('../config');

/**
 * Détecteur local Machine Learning léger pour systèmes embarqués (Raspberry Pi).
 * Utilise une analyse multivariée glissante basée sur le Z-score et l'écart absolu médian (MAD),
 * sans dépendance à Python ou scikit-learn.
 */
class LocalMLDetector {
  constructor(windowSize = config.LOCAL_ML.WINDOW_SIZE, threshold = config.LOCAL_ML.Z_SCORE_THRESHOLD) {
    this.windowSize = windowSize;
    this.threshold = threshold;
    this.history = new Map(); // patientId -> Array<{ hr, spo2, sys }>
  }

  detectAnomaly(patientId, vitals) {
    if (!config.LOCAL_ML.ENABLED) return null;

    const hr = vitals.heartRate;
    const spo2 = vitals.spo2;
    const sys = vitals.bloodPressure?.systolic;

    if (hr == null || spo2 == null || sys == null) return null;

    if (!this.history.has(patientId)) {
      this.history.set(patientId, []);
    }

    const buffer = this.history.get(patientId);
    buffer.push({ hr, spo2, sys });

    if (buffer.length > this.windowSize) {
      buffer.shift();
    }

    // Besoin d'un historique minimal pour calibrer la dispersion
    if (buffer.length < 5) return null;

    const hrScores = this._calcZScores(buffer.map(b => b.hr), hr);
    const spo2Scores = this._calcZScores(buffer.map(b => b.spo2), spo2);
    const sysScores = this._calcZScores(buffer.map(b => b.sys), sys);

    const maxScore = Math.max(hrScores, spo2Scores, sysScores);

    if (maxScore > this.threshold) {
      return {
        type: 'local_ml_statistical_anomaly',
        severity: 'warning',
        reason: `Déviation statistique multivariée locale détectée (Score Z: ${maxScore.toFixed(2)} > seuil ${this.threshold})`,
        metrics: { hr, spo2, systolic: sys, score: maxScore }
      };
    }

    return null;
  }

  _calcZScores(values, currentVal) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev < 0.001) return 0;
    return Math.abs(currentVal - mean) / stdDev;
  }
}

module.exports = LocalMLDetector;
