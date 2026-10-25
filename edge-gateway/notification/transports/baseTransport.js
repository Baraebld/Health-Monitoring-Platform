/**
 * Interface abstraite pour les transports de notification SMS.
 */
class BaseSmsTransport {
  constructor(name) {
    this.name = name;
  }

  /**
   * Envoie un SMS.
   * Doit retourner une promesse résolue avec :
   * {
   *   success: boolean,
   *   transportStatus: 'accepted_by_modem' | 'failed' | 'accepted_by_mock_transport',
   *   messageId?: string,
   *   error?: string,
   *   rawResponse?: any
   * }
   */
  async sendSms({ to, message, eventId }) {
    throw new Error('sendSms() doit être implémenté par la classe fille');
  }

  /**
   * Vérifie la disponibilité matérielle du transport.
   */
  async healthCheck() {
    return { isReady: true, details: 'OK' };
  }
}

module.exports = BaseSmsTransport;
