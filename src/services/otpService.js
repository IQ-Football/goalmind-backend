
import { v4 as uuidv4 } from 'uuid';
import smsService from './smsService.js';

const otpService = {
  /**
   * Generate and send OTP
   * @param {object} fastify Fastify instance
   * @param {string} phoneNumber 
   */
  generateAndSendOTP: async (fastify, phoneNumber) => {
    // Generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration (e.g., 10 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Save to database
    await fastify.db.query(
      `INSERT INTO verification_codes (phone_number, code, expires_at) 
       VALUES ($1, $2, $3)`,
      [phoneNumber, code, expiresAt]
    );

    // Send via SMS (simulated)
    await smsService.send(phoneNumber, `Your GoalMind verification code is: ${code}`);

    return { success: true };
  },

  /**
   * Verify OTP
   * @param {object} fastify Fastify instance
   * @param {string} phoneNumber 
   * @param {string} code 
   */
  verifyOTP: async (fastify, phoneNumber, code) => {
    const result = await fastify.db.query(
      `SELECT id FROM verification_codes 
       WHERE phone_number = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phoneNumber, code]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Invalid or expired code' };
    }

    return { success: true, id: result.rows[0].id };
  },

  /**
   * Mark OTP as used
   * @param {object} fastify Fastify instance
   * @param {string} verificationId 
   */
  markAsUsed: async (fastify, verificationId) => {
    await fastify.db.query(
      `UPDATE verification_codes SET used = TRUE WHERE id = $1`,
      [verificationId]
    );
    return { success: true };
  }
};

export default otpService;
