import pg from 'pg';
import config from '../src/config.js';

const pool = new pg.Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

async function run() {
    console.log('🏛️ Starting Senate & Architect Automation...');
    
    try {
        // 1. Find the 50,000th user's created_at to define the Genesis cohort
        const milestoneRes = await pool.query(`
            SELECT created_at 
            FROM users 
            ORDER BY created_at ASC 
            LIMIT 1 OFFSET 49999
        `);

        let milestoneTimestamp;
        if (milestoneRes.rows.length === 0) {
            console.log('ℹ️ Less than 50,000 users found. Applying to all existing users.');
            milestoneTimestamp = new Date();
        } else {
            milestoneTimestamp = milestoneRes.rows[0].created_at;
            console.log(`✅ Milestone timestamp (50k): ${milestoneTimestamp}`);
        }

        // 2. Mark cohort and award 'Founding Architect' Gold Frame to all 50k
        const cohortUpdateRes = await pool.query(`
            UPDATE users 
            SET cohort = 'founding_50k',
                profile_frame = 'gold_founding_architect'
            WHERE created_at <= $1
            AND (cohort IS NULL OR cohort = 'founding_50k' OR cohort = 'none')
        `, [milestoneTimestamp]);
        
        console.log(`✅ Updated ${cohortUpdateRes.rowCount} users with 'founding_50k' cohort and Gold Frame.`);

        // 3. Identify Al Ahly (Winning Tribe of Cairo Clash) members in the 50k
        const winningTribeSlug = 'al-ahly';
        const tribeRes = await pool.query('SELECT id FROM tribes WHERE slug = $1', [winningTribeSlug]);
        if (tribeRes.rows.length === 0) {
            console.warn(`⚠️ Winning tribe ${winningTribeSlug} not found in database. Skipping winners elevation.`);
        } else {
            const winningTribeId = tribeRes.rows[0].id;
            console.log(`🏆 Winning Tribe identified: Al Ahly (${winningTribeId})`);

            // 4. Elevate winners within the 50k to Senate and award Obsidian Glow
            const winnerUpdateRes = await pool.query(`
                UPDATE users 
                SET is_senate_member = true,
                    has_obsidian_glow = true
                WHERE created_at <= $1
                AND tribe_id = $2
                RETURNING id, username
            `, [milestoneTimestamp, winningTribeId]);

            console.log(`🏛️ Elevated ${winnerUpdateRes.rowCount} winners to Senate with Obsidian Glow.`);

            // 5. Credit 'First Dividend' (250 GT) to winners
            let dividendCount = 0;
            for (const user of winnerUpdateRes.rows) {
                const userId = user.id;
                
                // Idempotency check: Ensure they haven't received this specific dividend already
                const ledgerCheck = await pool.query(`
                    SELECT id FROM goaltoken_ledger 
                    WHERE user_id = $1 
                    AND type = 'event_reward' 
                    AND (metadata->>'event' = 'cairo_clash_dividend' OR metadata->>'description' LIKE '%Hegemon%')
                `, [userId]);

                if (ledgerCheck.rows.length === 0) {
                    // Record in ledger
                    await pool.query(`
                        INSERT INTO goaltoken_ledger (user_id, amount, type, metadata)
                        VALUES ($1, 250, 'event_reward', $2)
                    `, [userId, JSON.stringify({ 
                        event: 'cairo_clash_dividend', 
                        description: 'First Dividend: Hegemon Bonus (Cairo Clash Victory)',
                        milestone: '50k_genesis'
                    })]);

                    // Update balance
                    await pool.query('UPDATE users SET goal_tokens = goal_tokens + 250 WHERE id = $1', [userId]);
                    dividendCount++;
                }
            }
            console.log(`💰 Distributed 250 GT Dividend to ${dividendCount} eligible winners.`);
        }
        
        console.log('🚀 Automation successfully completed.');
    } catch (err) {
        console.error('❌ Automation failed:', err);
    } finally {
        await pool.end();
    }
}

run();
