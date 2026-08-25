/**
 * SMS Service
 *
 * Sends a real SMS via Twilio when it is configured, and falls back to
 * console simulation when it is not.
 *
 * Switched on by SOLELY providing these env vars (via .env / Secrets) and
 * restarting the backend — no code change required:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_FROM_NUMBER
 *   - SMS_SIMULATION=false   (explicitly disable simulation)
 *
 * Simulation is used when EITHER:
 *   - SMS_SIMULATION=true (explicit), OR
 *   - any of the three Twilio credentials is missing/empty (safe default).
 *
 * In simulation mode the generated code is returned to the caller only via
 * the OTP service so the onboarding screen can show a clearly-labelled
 * dev/test fallback. Real SMS mode never leaks the code.
 */
import axios from 'axios';

const SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM_NUMBER;

/**
 * @returns {boolean} true when SMS should be simulated rather than sent.
 */
function isSimulationActive() {
  const explicit = (process.env.SMS_SIMULATION || '').toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  // conservative default: simulate unless every required Twilio credential is present
  return !SID || !AUTH_TOKEN || !FROM;
}

const smsService = {
  isSimulationActive,

  /**
   * Send an SMS message.
   * @param {string} phoneNumber E.164 recipient, e.g. +27821238888
   * @param {string} message body text
   * @returns {Promise<{success:boolean, simulated:boolean, messageId?:string, error?:string}>}
   */
  send: async (phoneNumber, message) => {
    if (smsService.isSimulationActive()) {
      console.log(`[SMS Simulation] Sending to ${phoneNumber}: ${message}`);
      return {
        success: true,
        simulated: true,
        messageId: 'sim_' + Math.random().toString(36).substr(2, 9),
      };
    }

    try {
      const resp = await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
        new URLSearchParams({ To: phoneNumber, From: FROM, Body: message }).toString(),
        {
          auth: { username: SID, password: AUTH_TOKEN },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      return { success: true, simulated: false, messageId: resp.data && resp.data.sid };
    } catch (err) {
      console.error('[SMS] Twilio send failed:', err && err.response && err.response.data
        ? JSON.stringify(err.response.data) : (err && err.message));
      return { success: false, simulated: false, error: err && err.message };
    }
  },
};

export default smsService;
