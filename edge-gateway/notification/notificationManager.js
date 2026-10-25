const config = require('../config');
const MockSmsTransport = require('./transports/mockTransport');
const SerialModemSmsTransport = require('./transports/modemTransport');

class NotificationManager {
  constructor(database, customTransport = null) {
    this.db = database;

    if (customTransport) {
      this.transport = customTransport;
    } else if (config.NOTIFICATIONS.TRANSPORT === 'modem') {
      this.transport = new SerialModemSmsTransport(
        config.NOTIFICATIONS.MODEM_PORT,
        config.NOTIFICATIONS.MODEM_BAUD_RATE
      );
    } else {
      this.transport = new MockSmsTransport();
    }

    this.recipientPhone = config.NOTIFICATIONS.RECIPIENT_PHONE;
    this.maxRetries = config.NOTIFICATIONS.MAX_RETRIES;
    this.initialBackoffMs = config.NOTIFICATIONS.INITIAL_BACKOFF_MS;
    this.deduplicationWindowMs = config.NOTIFICATIONS.DEDUPLICATION_WINDOW_MS;
  }

  /**
   * Construit le corps du SMS d'alerte clinique selon un modèle concis et normalisé.
   */
  formatMessage(alert) {
    const v = alert.metrics || {};
    const bp = v.bloodPressure || {};
    const hr = v.heartRate != null ? `${v.heartRate}bpm` : 'N/A';
    const spo2 = v.spo2 != null ? `${v.spo2}%` : 'N/A';
    const ta = (bp.systolic != null && bp.diastolic != null) 
      ? `${bp.systolic}/${bp.diastolic}mmHg` 
      : (v.systolic != null ? `${v.systolic}mmHg` : 'N/A');

    const timeStr = new Date(alert.eventTimestamp).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // Format compact adapté aux 160 caractères d'un SMS GSM standard
    return `[IoMT ALERTE ${alert.severity.toUpperCase()}] ${alert.reason} | Patient: ${alert.patientId} | Mesures: HR=${hr}, SpO2=${spo2}, TA=${ta} | GW: ${alert.gatewayId} | Ref: ${alert.eventId.slice(0, 8)} | ${timeStr}`;
  }

  /**
   * Vérifie si une alerte identique a déjà été notifiée récemment (Anti-Spam / Déduplication).
   */
  isDebounced(patientId, alertType, eventId = null) {
    const recent = this.db.getRecentAlert(patientId, alertType, this.deduplicationWindowMs, eventId);
    return Boolean(recent);
  }

  /**
   * Déclenche l'envoi immédiat de l'alerte par SMS avec politique de réessai et backoff.
   * Fonctionne de manière 100% autonome sans connexion internet ni backend.
   */
  async dispatchAlert(alert) {
    const eventId = alert.eventId;

    // 1. Contrôle Anti-Spam (Déduplication)
    if (this.isDebounced(alert.patientId, alert.alertType, eventId)) {
      console.log(`[NotificationManager] ⏳ Alerte ${alert.alertType} pour ${alert.patientId} dédupliquée (anti-spam ${this.deduplicationWindowMs / 1000}s). SMS évité.`);
      this.db.updateAlertDeliveryStatus(eventId, 'debounced');
      return {
        initiated: false,
        status: 'debounced',
        reason: 'Alerte similaire envoyée récemment.'
      };
    }

    const messageBody = this.formatMessage(alert);
    let attempt = 0;
    let finalResult = null;
    let delay = this.initialBackoffMs;

    // 2. Boucle de réessais bornée avec Backoff exponentiel
    while (attempt < this.maxRetries) {
      attempt++;
      this.db.updateAlertDeliveryStatus(eventId, 'attempted');

      try {
        console.log(`[NotificationManager] 📱 Tentative SMS #${attempt}/${this.maxRetries} pour ${alert.patientId} via [${this.transport.name}]...`);

        const result = await this.transport.sendSms({
          to: this.recipientPhone,
          message: messageBody,
          eventId
        });

        // Enregistrement d'audit dans la base SQLite locale
        this.db.recordSmsAttempt({
          eventId,
          recipient: this.recipientPhone,
          attemptNumber: attempt,
          status: result.transportStatus,
          transportName: this.transport.name,
          messageBody,
          errorMessage: result.error || null
        });

        if (result.success) {
          this.db.updateAlertDeliveryStatus(eventId, result.transportStatus);
          console.log(`[NotificationManager] ✅ SMS accepté par le transport (${result.transportStatus}, Ref: ${result.messageId}).`);
          return {
            initiated: true,
            status: result.transportStatus,
            attempts: attempt,
            messageId: result.messageId
          };
        } else {
          finalResult = result;
          console.warn(`[NotificationManager] ⚠️ Échec tentative #${attempt} : ${result.error}`);
        }
      } catch (err) {
        this.db.recordSmsAttempt({
          eventId,
          recipient: this.recipientPhone,
          attemptNumber: attempt,
          status: 'failed',
          transportName: this.transport.name,
          messageBody,
          errorMessage: err.message
        });
        finalResult = { error: err.message };
        console.error(`[NotificationManager] ❌ Exception tentative #${attempt} : ${err.message}`);
      }

      // Attente avant réessai si pas la dernière tentative
      if (attempt < this.maxRetries) {
        console.log(`[NotificationManager] ⏳ Pause backoff de ${delay}ms avant réessai...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2; // Backoff exponentiel
      }
    }

    // Toutes les tentatives ont échoué
    this.db.updateAlertDeliveryStatus(eventId, 'failed');
    console.error(`[NotificationManager] 🚨 Échec définitif de transmission SMS après ${this.maxRetries} tentatives.`);

    return {
      initiated: false,
      status: 'failed',
      attempts: attempt,
      error: finalResult?.error || 'Échec après réessais multiples'
    };
  }
}

module.exports = NotificationManager;
