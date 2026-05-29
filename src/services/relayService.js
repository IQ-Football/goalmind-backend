import { v4 as uuidv4 } from 'uuid';
import { finalizeRelayTournament } from './rewardService.js';

export const RELAY_STATES = {
  LOBBY: 'lobby',
  OPENING: 'opening',
  SEQUENCE: 'sequence',
  SCORING: 'scoring',
  COMPLETED: 'completed',
};

const RELAY_STATE_TTL = 3600;
const RECONNECTION_WINDOW_MS = 15000;
const QUESTIONS_PER_PLAYER = 5;
const TOTAL_QUESTIONS = 25;

function relayKey(relayId) { return `relay:${relayId}:state`; }

async function getRelayState(relayId, fastify) {
  const data = await fastify.redis.hgetall(relayKey(relayId));
  if (!data || Object.keys(data).length === 0) return null;
  return {
    id: relayId,
    tribeA_id: data.tribeA_id,
    tribeB_id: data.tribeB_id,
    status: data.status,
    tribeA_active_player_index: parseInt(data.tribeA_active_player_index || '0'),
    tribeB_active_player_index: parseInt(data.tribeB_active_player_index || '0'),
    tribeA_current_round: parseInt(data.tribeA_current_round || '0'),
    tribeB_current_round: parseInt(data.tribeB_current_round || '0'),
    tribeA_score: parseFloat(data.tribeA_score || '0'),
    tribeB_score: parseFloat(data.tribeB_score || '0'),
    tribeA_participants: JSON.parse(data.tribeA_participants || '[]'),
    tribeB_participants: JSON.parse(data.tribeB_participants || '[]'),
    tribeA_substitutes: JSON.parse(data.tribeA_substitutes || '[]'),
    tribeB_substitutes: JSON.parse(data.tribeB_substitutes || '[]'),
    tribeA_has_general: data.tribeA_has_general === 'true',
    tribeB_has_general: data.tribeB_has_general === 'true',
    tribeA_online: JSON.parse(data.tribeA_online || '[]'),
    tribeB_online: JSON.parse(data.tribeB_online || '[]'),
    tribeA_correct_total: parseInt(data.tribeA_correct_total || '0'),
    tribeB_correct_total: parseInt(data.tribeB_correct_total || '0'),
    startTime: parseInt(data.startTime || '0'),
  };
}

async function setRelayState(relayId, state, fastify) {
  await fastify.redis.hset(relayKey(relayId), {
    tribeA_id: state.tribeA_id,
    tribeB_id: state.tribeB_id,
    status: state.status,
    tribeA_active_player_index: String(state.tribeA_active_player_index || 0),
    tribeB_active_player_index: String(state.tribeB_active_player_index || 0),
    tribeA_current_round: String(state.tribeA_current_round || 0),
    tribeB_current_round: String(state.tribeB_current_round || 0),
    tribeA_score: String(state.tribeA_score || 0),
    tribeB_score: String(state.tribeB_score || 0),
    tribeA_participants: JSON.stringify(state.tribeA_participants || []),
    tribeB_participants: JSON.stringify(state.tribeB_participants || []),
    tribeA_substitutes: JSON.stringify(state.tribeA_substitutes || []),
    tribeB_substitutes: JSON.stringify(state.tribeB_substitutes || []),
    tribeA_has_general: String(state.tribeA_has_general || false),
    tribeB_has_general: String(state.tribeB_has_general || false),
    tribeA_online: JSON.stringify(state.tribeA_online || []),
    tribeB_online: JSON.stringify(state.tribeB_online || []),
    tribeA_correct_total: String(state.tribeA_correct_total || 0),
    tribeB_correct_total: String(state.tribeB_correct_total || 0),
    startTime: String(state.startTime || 0),
  });
  await fastify.redis.expire(relayKey(relayId), RELAY_STATE_TTL);
}

async function updateRelayField(relayId, field, value, fastify) {
  await fastify.redis.hset(relayKey(relayId), field, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

export function setupRelayHandlers(relayNamespace, fastify) {
  relayNamespace.on('connection', async (socket) => {
    let userId = null;
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = await fastify.jwt.verify(token);
        userId = decoded.id;
      }
    } catch (err) {}

    socket.userId = userId;

    socket.on('relay:join', async (data) => {
      const { relayId } = data;
      if (!relayId) return;
      socket.join(`relay:${relayId}`);
      socket.relayId = relayId;
      const state = await getRelayState(relayId, fastify);
      if (!state) return;

      if (userId) {
        let updated = false;
        if (state.tribeA_participants.includes(userId) && !state.tribeA_online.includes(userId)) {
          state.tribeA_online.push(userId);
          updated = true;
        } else if (state.tribeB_participants.includes(userId) && !state.tribeB_online.includes(userId)) {
          state.tribeB_online.push(userId);
          updated = true;
        }
        if (updated) {
          await updateRelayField(relayId, 'tribeA_online', state.tribeA_online, fastify);
          await updateRelayField(relayId, 'tribeB_online', state.tribeB_online, fastify);
          relayNamespace.to(`relay:${relayId}`).emit('relay:status', {
            tribeA_online: state.tribeA_online.length,
            tribeB_online: state.tribeB_online.length
          });
        }
      }
      socket.emit('relay:welcome', { state });
    });

    socket.on('disconnect', async () => {
      if (socket.relayId && socket.userId) {
        const state = await getRelayState(socket.relayId, fastify);
        if (!state) return;

        let updated = false;
        if (state.tribeA_online.includes(socket.userId)) {
          state.tribeA_online = state.tribeA_online.filter(id => id !== socket.userId);
          updated = true;
        } else if (state.tribeB_online.includes(socket.userId)) {
          state.tribeB_online = state.tribeB_online.filter(id => id !== socket.userId);
          updated = true;
        }

        if (updated) {
          await updateRelayField(socket.relayId, 'tribeA_online', state.tribeA_online, fastify);
          await updateRelayField(socket.relayId, 'tribeB_online', state.tribeB_online, fastify);
          relayNamespace.to(`relay:${socket.relayId}`).emit('relay:status', {
            tribeA_online: state.tribeA_online.length,
            tribeB_online: state.tribeB_online.length
          });
        }

        // Handle disconnection during turn
        const activeParticipants = state.active_tribe === 'A' ? state.tribeA_participants : state.tribeB_participants;
        if (socket.userId === activeParticipants[state.active_player_index] && state.status === RELAY_STATES.SEQUENCE) {
          // Set disconnection timeout
          setTimeout(async () => {
            const currentState = await getRelayState(socket.relayId, fastify);
            if (!currentState) return;
            const currentOnline = currentState.active_tribe === 'A' ? currentState.tribeA_online : currentState.tribeB_online;
            if (!currentOnline.includes(socket.userId)) {
              fastify.log.info(`Player ${socket.userId} failed to reconnect. Force-passing baton.`);
              await handleBatonPass(socket.relayId, currentState, relayNamespace, fastify);
            }
          }, RECONNECTION_WINDOW_MS);
        }
      }
    });

    socket.on('relay:encourage', (data) => {
      if (socket.relayId) {
        socket.to(`relay:${socket.relayId}`).emit('relay:encouragement', {
          from: userId || 'Spectator',
          type: data.type || 'fist'
        });
      }
    });

    socket.on('relay:cheer', async (data) => {
      const { relayId, tribeId } = data;
      if (!relayId || !tribeId) return;
      
      const spiritKey = `relay:${relayId}:spirit:${tribeId}`;
      const newSpirit = await fastify.redis.incr(spiritKey);
      
      // Every 100 cheers, grant a "Tribal Spirit" bonus (extra 2 seconds)
      if (newSpirit % 100 === 0) {
        relayNamespace.to(`relay:${relayId}`).emit('relay:spirit_bonus', { 
          tribeId,
          bonusSeconds: 2
        });
      }
      
      relayNamespace.to(`relay:${relayId}`).emit('relay:spirit_update', {
        tribeId,
        spirit: newSpirit
      });
    });

    socket.on('relay:answer', async (data) => {
      const { relayId, responseTimeMs, isCorrect = true } = data;
      if (!userId || !relayId) return;
      const state = await getRelayState(relayId, fastify);
      if (!state || state.status !== RELAY_STATES.SEQUENCE) return;

      let tribe = null;
      if (state.tribeA_participants.includes(userId)) {
        tribe = 'A';
        const playerIndex = state.tribeA_participants.indexOf(userId);
        if (playerIndex !== state.tribeA_active_player_index) return;
      } else if (state.tribeB_participants.includes(userId)) {
        tribe = 'B';
        const playerIndex = state.tribeB_participants.indexOf(userId);
        if (playerIndex !== state.tribeB_active_player_index) return;
      }

      if (!tribe) return;

      // Scoring: (C * 100) + (T_rem * 10)
      const roundTimeSeconds = 10;
      const tRem = Math.max(0, roundTimeSeconds - (responseTimeMs / 1000));
      
      let points = 0;
      if (isCorrect) {
        // Apply General Multiplier if applicable (1.05x on speed bonus part)
        const hasGeneral = tribe === 'A' ? state.tribeA_has_general : state.tribeB_has_general;
        const speedMultiplier = hasGeneral ? 1.05 : 1.0;
        
        points = 100 + (tRem * 10 * speedMultiplier);
        
        if (tribe === 'A') {
          state.tribeA_correct_total += 1;
          await updateRelayField(relayId, 'tribeA_correct_total', state.tribeA_correct_total, fastify);
        } else {
          state.tribeB_correct_total += 1;
          await updateRelayField(relayId, 'tribeB_correct_total', state.tribeB_correct_total, fastify);
        }
      }

      if (tribe === 'A') {
        state.tribeA_score += points;
        state.tribeA_current_round += 1;
        await updateRelayField(relayId, 'tribeA_score', state.tribeA_score, fastify);
        await updateRelayField(relayId, 'tribeA_current_round', state.tribeA_current_round, fastify);
      } else {
        state.tribeB_score += points;
        state.tribeB_current_round += 1;
        await updateRelayField(relayId, 'tribeB_score', state.tribeB_score, fastify);
        await updateRelayField(relayId, 'tribeB_current_round', state.tribeB_current_round, fastify);
      }

      relayNamespace.to(`relay:${relayId}`).emit('relay:progress', {
        tribeA_score: state.tribeA_score,
        tribeB_score: state.tribeB_score,
        tribeA_current_round: state.tribeA_current_round,
        tribeB_current_round: state.tribeB_current_round,
        tribeA_active_player_index: state.tribeA_active_player_index,
        tribeB_active_player_index: state.tribeB_active_player_index
      });

      const currentRound = tribe === 'A' ? state.tribeA_current_round : state.tribeB_current_round;
      if (currentRound >= QUESTIONS_PER_PLAYER) {
        await handleBatonPass(relayId, tribe, state, relayNamespace, fastify);
      } else {
        socket.emit('relay:next_question', { round: currentRound + 1 });
      }
    });
  });
}

async function handleBatonPass(relayId, tribe, state, namespace, fastify) {
  if (tribe === 'A') {
    state.tribeA_active_player_index += 1;
    state.tribeA_current_round = 0;
    await updateRelayField(relayId, 'tribeA_active_player_index', state.tribeA_active_player_index, fastify);
    await updateRelayField(relayId, 'tribeA_current_round', 0, fastify);
  } else {
    state.tribeB_active_player_index += 1;
    state.tribeB_current_round = 0;
    await updateRelayField(relayId, 'tribeB_active_player_index', state.tribeB_active_player_index, fastify);
    await updateRelayField(relayId, 'tribeB_current_round', 0, fastify);
  }

  namespace.to(`relay:${relayId}`).emit('relay:baton_pass', {
    tribe,
    active_player_index: tribe === 'A' ? state.tribeA_active_player_index : state.tribeB_active_player_index
  });

  const currentState = await getRelayState(relayId, fastify);
  if (currentState.tribeA_active_player_index >= 5 && currentState.tribeB_active_player_index >= 5) {
    // End of all turns. Calculate Clean Sheet Bonuses.
    if (currentState.tribeA_correct_total >= TOTAL_QUESTIONS) {
      currentState.tribeA_score += 500;
      await updateRelayField(relayId, 'tribeA_score', currentState.tribeA_score, fastify);
    }
    if (currentState.tribeB_correct_total >= TOTAL_QUESTIONS) {
      currentState.tribeB_score += 500;
      await updateRelayField(relayId, 'tribeB_score', currentState.tribeB_score, fastify);
    }

    state.status = RELAY_STATES.SCORING;
    await updateRelayField(relayId, 'status', state.status, fastify);
    namespace.to(`relay:${relayId}`).emit('relay:scoring', {
      tribeA_score: currentState.tribeA_score,
      tribeB_score: currentState.tribeB_score
    });
    
    setTimeout(async () => {
       // Determine winner with Tie-Breaker: highest single-player IQ
       let winner = 'TIE';
       if (currentState.tribeA_score > currentState.tribeB_score) {
         winner = 'A';
       } else if (currentState.tribeB_score > currentState.tribeA_score) {
         winner = 'B';
       } else {
         // Tie-breaker: highest single IQ
         const usersA = await fastify.db.query('SELECT MAX(elo) as max_elo FROM users WHERE id = ANY($1)', [currentState.tribeA_participants]);
         const usersB = await fastify.db.query('SELECT MAX(elo) as max_elo FROM users WHERE id = ANY($1)', [currentState.tribeB_participants]);
         const maxA = usersA.rows[0]?.max_elo || 0;
         const maxB = usersB.rows[0]?.max_elo || 0;
         winner = maxA > maxB ? 'A' : (maxB > maxA ? 'B' : 'TIE');
       }

       await updateRelayField(relayId, 'status', RELAY_STATES.COMPLETED, fastify);
       namespace.to(`relay:${relayId}`).emit('relay:end', {
         winner,
         tribeA_score: currentState.tribeA_score,
         tribeB_score: currentState.tribeB_score
       });

       // Finalize rewards and Hall of Generals induction
       const winnerTribeId = winner === 'A' ? currentState.tribeA_id : (winner === 'B' ? currentState.tribeB_id : null);
       const winnerParticipants = winner === 'A' ? currentState.tribeA_participants : (winner === 'B' ? currentState.tribeB_participants : []);
       
       if (winnerTribeId) {
         await finalizeRelayTournament(fastify, relayId, winnerTribeId, winnerParticipants);
       }
    }, 5000);
  }
}

async function getTribeRelayTeam(fastify, tribeId) {
  // Top 3 by IQ
  const topIQ = await fastify.db.query(
    'SELECT id, elo, contribution_points FROM users WHERE tribe_id = $1 ORDER BY elo DESC LIMIT 3',
    [tribeId]
  );
  
  // The remaining 2 should be elected. For now, we take the next 2 highest IQ as fallback
  // In a real scenario, we'd query a 'relay_nominations' or 'tribe_votes' table
  const elected = await fastify.db.query(
    'SELECT id, elo, contribution_points FROM users WHERE tribe_id = $1 AND id NOT IN ($2, $3, $4) ORDER BY elo DESC LIMIT 2',
    [tribeId, topIQ.rows[0]?.id, topIQ.rows[1]?.id, topIQ.rows[2]?.id]
  );

  const team = [...topIQ.rows, ...elected.rows];
  
  // Designate Captain (highest IQ)
  team.sort((a, b) => b.elo - a.elo);
  
  // Substitutes (Next 2)
  const subs = await fastify.db.query(
    'SELECT id FROM users WHERE tribe_id = $1 AND id NOT IN (SELECT id FROM users WHERE tribe_id = $1 ORDER BY elo DESC LIMIT 5) ORDER BY elo DESC LIMIT 2',
    [tribeId]
  );

  return {
    participants: team.map(u => u.id),
    substitutes: subs.rows.map(u => u.id),
    hasGeneral: team.some(u => u.contribution_points >= 15000),
    captain: team[0]?.id
  };
}

export async function createRelayMatch(fastify, tribeA_id, tribeB_id) {
  const teamA = await getTribeRelayTeam(fastify, tribeA_id);
  const teamB = await getTribeRelayTeam(fastify, tribeB_id);

  const relayId = uuidv4();
  const state = {
    id: relayId,
    tribeA_id,
    tribeB_id,
    status: RELAY_STATES.LOBBY,
    active_player_index: 0,
    active_tribe: 'A',
    current_round: 0,
    tribeA_score: 0,
    tribeB_score: 0,
    tribeA_participants: teamA.participants,
    tribeB_participants: teamB.participants,
    tribeA_substitutes: teamA.substitutes,
    tribeB_substitutes: teamB.substitutes,
    tribeA_has_general: teamA.hasGeneral,
    tribeB_has_general: teamB.hasGeneral,
    tribeA_online: [],
    tribeB_online: [],
    tribeA_correct_total: 0,
    tribeB_correct_total: 0,
    startTime: Date.now(),
  };
  await setRelayState(relayId, state, fastify);
  return relayId;
}

export async function startRelayMatch(relayId, fastify, namespace) {
  const state = await getRelayState(relayId, fastify);
  if (!state) return;

  // Substitute Promotion Logic
  const ensureParticipantsOnline = (participants, online, substitutes) => {
    const newParticipants = [...participants];
    let subsUsed = 0;
    for (let i = 0; i < newParticipants.length; i++) {
      if (!online.includes(newParticipants[i])) {
        if (substitutes[subsUsed]) {
          fastify.log.info(`Promoting substitute ${substitutes[subsUsed]} for player ${newParticipants[i]}`);
          newParticipants[i] = substitutes[subsUsed];
          subsUsed++;
        }
      }
    }
    return newParticipants;
  };

  const finalParticipantsA = ensureParticipantsOnline(state.tribeA_participants, state.tribeA_online, state.tribeA_substitutes);
  const finalParticipantsB = ensureParticipantsOnline(state.tribeB_participants, state.tribeB_online, state.tribeB_substitutes);

  await updateRelayField(relayId, 'tribeA_participants', finalParticipantsA, fastify);
  await updateRelayField(relayId, 'tribeB_participants', finalParticipantsB, fastify);
  await updateRelayField(relayId, 'status', RELAY_STATES.OPENING, fastify);
  
  namespace.to(`relay:${relayId}`).emit('relay:opening', { 
    relayId,
    tribeA_participants: finalParticipantsA,
    tribeB_participants: finalParticipantsB
  });

  setTimeout(async () => {
    await updateRelayField(relayId, 'status', RELAY_STATES.SEQUENCE, fastify);
    namespace.to(`relay:${relayId}`).emit('relay:start', { relayId });
  }, 10000);
}
