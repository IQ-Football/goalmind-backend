
/**
 * Mock SMS Service for simulation
 */
const smsService = {
  /**
   * Send SMS (simulated)
   * @param {string} phoneNumber 
   * @param {string} message 
   */
  send: async (phoneNumber, message) => {
    console.log(`[SMS Simulation] Sending to ${phoneNumber}: ${message}`);
    // In a real implementation, we would call an external API like Twilio
    return { success: true, messageId: 'sim_' + Math.random().toString(36).substr(2, 9) };
  }
};

export default smsService;
