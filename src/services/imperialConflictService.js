import { hasAchievement, FOUNDING_GENERAL_ID, TRIBE_COMMANDER_ID } from './achievementService.js';

/**
 * Imperial Conflict Service - Siege of Giza
 */

export const GIZA_SECTORS = {
  WAVE_1: [
    'Solar Boat Museum',
    'Workers Village',
    'Valley Temple',
    'Mastaba Field'
  ],
  WAVE_2: [
    'Camel Trail',
    'Panorama Point',
    'Giza Gateway',
    'Causeway'
  ],
  WAVE_3: [
    'Great Pyramid',
    'Sphinx',
    'Pyramid of Khafre',
    'Pyramid of Menkaure'
  ]
};

export const GIZA_WAVES = {
  WAVE_1: { start: 18, end: 18.75, multiplier: 1 },
  WAVE_2: { start: 19, end: 19.75, multiplier: 2 },
  WAVE_3: { start: 20, end: 21, multiplier: 3 }
};

const STONE_WALL_DURATION = 15 * 60; // 15 minutes in seconds
const SALVO_WIN_LIMIT = 50;
const SALVO_PP_BUFF = 3;
const COMMAND_COST = 500;

export async function getCurrentWave() {
  const now = new Date();
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  
  if (utcHours >= GIZA_WAVES.WAVE_1.start && utcHours < GIZA_WAVES.WAVE_1.end) return 'WAVE_1';
  if (utcHours >= GIZA_WAVES.WAVE_2.start && utcHours < GIZA_WAVES.WAVE_2.end) return 'WAVE_2';
  if (utcHours >= GIZA_WAVES.WAVE_3.start && utcHours < GIZA_WAVES.WAVE_3.end) return 'WAVE_3';
  
  return null;
}

export async function recordWin(fastify, userId, tribeId, sector) {
  const wave = await getCurrentWave();
  if (!wave) return null;
  
  const multiplier = GIZA_WAVES[wave].multiplier;
  let pp = 10 * multiplier; // Base 10 PP
  
  // Check Salvo Buff
  const salvoKey = `giza:sector:${sector}:salvo`;
  const salvoData = await fastify.redis.hgetall(salvoKey);
  if (salvoData && salvoData.tribeId === tribeId && parseInt(salvoData.remaining) > 0) {
    pp *= SALVO_PP_BUFF;
    await fastify.redis.hincrby(salvoKey, 'remaining', -1);
  }

  // Check Stone Wall (Lock)
  const stoneWallKey = `giza:sector:${sector}:stonewall`;
  const stoneWallTribe = await fastify.redis.get(stoneWallKey);
  
  const dominanceKey = `giza:sector:${sector}:dominance`;
  
  if (stoneWallTribe && stoneWallTribe !== tribeId) {
    // If rival has Stone Wall, your win only "chips away"
    const chipKey = `giza:sector:${sector}:stonewall:chips`;
    await fastify.redis.incr(chipKey);
    const chips = await fastify.redis.get(chipKey);
    if (parseInt(chips) >= 20) { // Threshold to break the lock
       await fastify.redis.del(stoneWallKey);
       await fastify.redis.del(chipKey);
    }
  } else {
    await fastify.redis.hincrby(dominanceKey, tribeId, 1);
  }

  // --- Individual Tracking for Rewards ---
  // Giza Ten (Top 10 contributors by wins)
  await fastify.redis.zincrby('giza:leaderboard:wins', 1, userId);
  
  // Legion (Min 5 wins)
  await fastify.redis.hincrby('giza:user:wins', userId, 1);
  
  return { pp, sector, wave, salvoActive: !!salvoData };
}

export async function getDominance(fastify, sector) {
  const dominanceKey = `giza:sector:${sector}:dominance`;
  const data = await fastify.redis.hgetall(dominanceKey);
  
  const tribes = Object.keys(data);
  const totalWins = tribes.reduce((acc, tribeId) => acc + parseInt(data[tribeId]), 0);
  
  const results = {};
  if (totalWins === 0) {
    // Initialize with 0 if no wins yet
    results['default'] = 0; 
  } else {
    tribes.forEach(t => results[t] = (parseInt(data[t]) / totalWins) * 100);
  }
  
  return { results, totalWins };
}

export async function activateStoneWall(fastify, userId, tribeId, sector) {
  // 1. Verify role
  const isGeneral = await hasAchievement(fastify, userId, FOUNDING_GENERAL_ID);
  const isCommander = await hasAchievement(fastify, userId, TRIBE_COMMANDER_ID);
  if (!isGeneral && !isCommander) {
    throw new Error('UNAUTHORIZED_COMMANDER');
  }

  // 2. Condition: Only available for sectors held in the previous Wave.
  // We need to track who won the previous wave's sectors.
  // For now, let's check a Redis key `giza:sector:${sector}:owner`
  const owner = await fastify.redis.get(`giza:sector:${sector}:owner`);
  if (owner !== tribeId) {
    throw new Error('SECTOR_NOT_HELD_IN_PREVIOUS_WAVE');
  }

  // 3. Deduct cost from Vault
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    const tribeRes = await client.query('SELECT vault_balance FROM tribes WHERE id = $1 FOR UPDATE', [tribeId]);
    if (tribeRes.rows[0].vault_balance < COMMAND_COST) {
      throw new Error('INSUFFICIENT_VAULT_FUNDS');
    }

    await client.query('UPDATE tribes SET vault_balance = vault_balance - $1 WHERE id = $2', [COMMAND_COST, tribeId]);
    await client.query(
      'INSERT INTO tribal_vault_ledger (tribe_id, user_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
      [tribeId, userId, -COMMAND_COST, 'command_stone_wall', `Stone Wall activated in ${sector}`]
    );

    const stoneWallKey = `giza:sector:${sector}:stonewall`;
    await fastify.redis.set(stoneWallKey, tribeId, 'EX', STONE_WALL_DURATION);

    await client.query('COMMIT');

    // Broadcast command activation
    const tribeName = tribeRes.rows[0].name || 'A';
    if (fastify.io) {
      fastify.io.emit('giza:command_activated', {
        type: 'stone_wall',
        tribeId,
        tribeName,
        sector,
        message: `${tribeName.toUpperCase()} COMMANDER HAS FORTIFIED THE ${sector.toUpperCase()}. HOLD THE LINE!`
      });
    }

    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function activateSalvo(fastify, userId, tribeId, sector) {
  // 1. Verify role
  const isGeneral = await hasAchievement(fastify, userId, FOUNDING_GENERAL_ID);
  const isCommander = await hasAchievement(fastify, userId, TRIBE_COMMANDER_ID);
  if (!isGeneral && !isCommander) {
    throw new Error('UNAUTHORIZED_COMMANDER');
  }

  // 2. Deduct cost from Vault
  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');
    const tribeRes = await client.query('SELECT vault_balance FROM tribes WHERE id = $1 FOR UPDATE', [tribeId]);
    if (tribeRes.rows[0].vault_balance < COMMAND_COST) {
      throw new Error('INSUFFICIENT_VAULT_FUNDS');
    }

    await client.query('UPDATE tribes SET vault_balance = vault_balance - $1 WHERE id = $2', [COMMAND_COST, tribeId]);
    await client.query(
      'INSERT INTO tribal_vault_ledger (tribe_id, user_id, amount, type, description) VALUES ($1, $2, $3, $4, $5)',
      [tribeId, userId, -COMMAND_COST, 'command_salvo', `Salvo strike called on ${sector}`]
    );

    const salvoKey = `giza:sector:${sector}:salvo`;
    await fastify.redis.hmset(salvoKey, {
      tribeId,
      remaining: SALVO_WIN_LIMIT
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function processWaveEnd(fastify, wave) {
  const sectors = GIZA_SECTORS[wave];
  if (!sectors) return;

  const results = [];

  for (const sector of sectors) {
    const dominance = await getDominance(fastify, sector);
    let ownerTribeId = null;
    let state = 'unclaimed';

    for (const tribeId of Object.keys(dominance.results)) {
      if (dominance.results[tribeId] > 60) {
        ownerTribeId = tribeId;
        state = 'captured';
        break;
      } else if (dominance.results[tribeId] >= 40) {
        state = 'contested';
        // Note: In contested state, we might not set an owner for Stone Wall purposes
        // or we might set the one with majority. Spec says "captured" is > 60%.
      }
    }

    if (ownerTribeId) {
      await fastify.redis.set(`giza:sector:${sector}:owner`, ownerTribeId);
    }

    results.push({ sector, ownerTribeId, state, dominance: dominance.results });
  }

  return results;
}

export async function distributePrizes(fastify) {
  const totalPrizePool = 10000;
  const vaultAllocation = 5000;
  const gizaTenAllocation = 3000;
  const legionAllocation = 2000;

  const client = await fastify.db.connect();
  try {
    await client.query('BEGIN');

    const allSectors = [...GIZA_SECTORS.WAVE_1, ...GIZA_SECTORS.WAVE_2, ...GIZA_SECTORS.WAVE_3];
    const tribeCapturePoints = {};

    for (const sector of allSectors) {
       const dominance = await getDominance(fastify, sector);
       for (const tribeId of Object.keys(dominance.results)) {
          if (dominance.results[tribeId] > 60) {
             tribeCapturePoints[tribeId] = (tribeCapturePoints[tribeId] || 0) + 1;
          } else if (dominance.results[tribeId] >= 40) {
             // Contested: split contribution to overall victory?
             tribeCapturePoints[tribeId] = (tribeCapturePoints[tribeId] || 0) + 0.5;
          }
       }
    }

    let winningTribeId = null;
    let maxPoints = -1;
    for (const tribeId of Object.keys(tribeCapturePoints)) {
       if (tribeCapturePoints[tribeId] > maxPoints) {
          maxPoints = tribeCapturePoints[tribeId];
          winningTribeId = tribeId;
       }
    }

    if (winningTribeId) {
      // Award to Tribe Vault
      await client.query(
        'UPDATE tribes SET vault_balance = vault_balance + $1 WHERE id = $2',
        [vaultAllocation, winningTribeId]
      );
      await client.query(
        'INSERT INTO tribal_vault_ledger (tribe_id, amount, type, description) VALUES ($1, $2, $3, $4)',
        [winningTribeId, vaultAllocation, 'reward', 'Siege of Giza Victory Reward']
      );
    }

    // 2. The "Giza Ten" (Top 10 individual contributors)
    const topTen = await fastify.redis.zrevrange('giza:leaderboard:wins', 0, 9);
    if (topTen.length > 0) {
      const share = Math.floor(gizaTenAllocation / topTen.length);
      for (const userId of topTen) {
        await client.query(
          'UPDATE users SET goal_tokens = goal_tokens + $1 WHERE id = $2',
          [share, userId]
        );
        await client.query(
          'INSERT INTO goaltoken_ledger (user_id, amount, type, metadata) VALUES ($1, $2, $3, $4)',
          [userId, share, 'event_reward', JSON.stringify({ event: 'giza_siege', category: 'giza_ten' })]
        );
      }
    }

    // 3. The Legion (Split proportionally among all members with at least 5 wins)
    const allUserWins = await fastify.redis.hgetall('giza:user:wins');
    const legionQualifiers = Object.keys(allUserWins)
      .filter(userId => parseInt(allUserWins[userId]) >= 5)
      .map(userId => ({ userId, wins: parseInt(allUserWins[userId]) }));
    
    if (legionQualifiers.length > 0) {
      const totalLegionWins = legionQualifiers.reduce((acc, curr) => acc + curr.wins, 0);
      
      for (const qualifier of legionQualifiers) {
        const share = Math.floor((qualifier.wins / totalLegionWins) * legionAllocation);
        if (share > 0) {
          await client.query(
            'UPDATE users SET goal_tokens = goal_tokens + $1 WHERE id = $2',
            [share, qualifier.userId]
          );
          await client.query(
            'INSERT INTO goaltoken_ledger (user_id, amount, type, metadata) VALUES ($1, $2, $3, $4)',
            [qualifier.userId, share, 'event_reward', JSON.stringify({ event: 'giza_siege', category: 'legion', wins: qualifier.wins })]
          );
        }
      }
    }

    await client.query('COMMIT');
    return { 
      success: true, 
      winningTribeId, 
      topTenCount: topTen.length, 
      legionCount: legionQualifiers.length 
    };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err, 'Failed to distribute Giza prizes');
    throw err;
  } finally {
    client.release();
  }
}

