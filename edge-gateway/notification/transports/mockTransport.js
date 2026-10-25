const BaseSmsTransport = require('./baseTransport');

/**
 * Transport SMS Simulé (Mock) pour environnements de développement et tests automatisés.
 * Permet l'injection déterministe de pannes (perte de signal, erreur SIM, etc.).
 * Note importante : Les envois via ce transport ne constituent pas un envoi cellulaire réel.
 */
class MockSmsTransport extends BaseSmsTransport {
  constructor() {
    super('mock_sms_transport');
    this.sentMessages = [];
    this.failureConfig = {
      shouldFail: false,
      failureCountRemaining: 0,
      failureReason: 'CELLULAR_CARRIER_OUTAGE',
      delayMs: 10
    };
  }

  /**
   * Configure une injection de panne temporaire ou continue.
   */
  simulateFailure(enabled = true, reason = 'SIMULATED_MODEM_FAILURE', count = Infinity) {
    this.failureConfig.shouldFail = enabled;
    this.failureConfig.failureReason = reason;
    this.failureConfig.failureCountRemaining = count;
  }

  resetFailures() {
    this.failureConfig.shouldFail = false;
    this.failureConfig.failureCountRemaining = 0;
  }

  clearHistory() {
    this.sentMessages = [];
  }

  getSentMessages() {
    return [...this.sentMessages];
  }

  async healthCheck() {
    if (this.failureConfig.shouldFail && this.failureConfig.failureCountRemaining > 0) {
      return { isReady: false, details: this.failureConfig.failureReason };
    }
    return { isReady: true, details: 'Mock Transport prêt' };
  }

  async sendSms({ to, message, eventId }) {
    if (this.failureConfig.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.failureConfig.delayMs));
    }

    // Gestion de l'injection d'erreur
    if (this.failureConfig.shouldFail && this.failureConfig.failureCountRemaining > 0) {
      this.failureConfig.failureCountRemaining--;
      if (this.failureConfig.failureCountRemaining === 0) {
        this.failureConfig.shouldFail = false;
      }

      const failureRecord = {
        eventId,
        to,
        message,
        timestamp: new Date().toISOString(),
        status: 'failed',
        error: this.failureConfig.failureReason
      };
      this.sentMessages.push(failureRecord);

      return {
        success: false,
        transportStatus: 'failed',
        error: this.failureConfig.failureReason,
        rawResponse: { simulated: true, error: this.failureConfig.failureReason }
      };
    }

    const messageRecord = {
      eventId,
      to,
      message,
      timestamp: new Date().toISOString(),
      status: 'accepted_by_mock_transport',
      messageId: `MOCK_SMS_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    };

    this.sentMessages.push(messageRecord);

    return {
      success: true,
      transportStatus: 'accepted_by_mock_transport',
      messageId: messageRecord.messageId,
      rawResponse: { simulated: true, note: 'Simulé en environnement de test' }
    };
  }
}

module.exports = MockSmsTransport;
