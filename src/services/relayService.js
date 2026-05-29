import { v4 as uuidv4 } from 'uuid';

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
    active_player_index: parseInt(data.active_player_index || '0'),
    active_tribe: data.active_tribe,
    current_round: parseInt(data.current_round || '0'),
    tribeA_score: parseFloat(data.tribeA_score || '0'),
    tribeB_score: parseFloat(data.tribeB_score || '0'),
    tribeA_participants: JSON.parse(data.tribeA_participants || '[]'),
    tribeB_participants: JSON.parse(data.tribeB_participants || '[]'),
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
    active_player_index: String(state.active_player_index || 0),
    active_tribe: state.active_tribe || 'A',
    current_round: String(state.current_round || 0),
    tribeA_score: String(state.tribeA_score || 0),
    tribeB_score: String(state.tribeB_score || 0),
    tribeA_participants: JSON.stringify(state.tribeA_participants || []),
    tribeB_participants: JSON.stringify(state.tribeB_participants || []),
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

    socket.on('relay:answer', async (data) => {
      const { relayId, responseTimeMs, isCorrect = true } = data;
      if (!userId || !relayId) return;
      const state = await getRelayState(relayId, fastify);
      if (!state || state.status !== RELAY_STATES.SEQUENCE) return;

      const activeParticipants = state.active_tribe === 'A' ? state.tribeA_participants : state.tribeB_participants;
      if (userId !== activeParticipants[state.active_player_index]) return;

      // Scoring: (C * 100) + (T_rem * 10)
      // T_rem is in seconds. responseTimeMs is in ms. Round time is 10s.
      const roundTimeSeconds = 10;
      const tRem = Math.max(0, roundTimeSeconds - (responseTimeMs / 1000));
      
      let points = 0;
      if (isCorrect) {
        points = 100 + (tRem * 10);
        // Apply General Multiplier if applicable (1.05x on speed bonus part?)
        // Spec says "1.05x Speed Multiplier during the relay"
        // We'll interpret this as 1.05x on the T_rem * 10 part.
        // For simulation we assume no general for now, but logic is ready.
        // points = 100 + (tRem * 10 * 1.05); 
        
        if (state.active_tribe === 'A') {
          state.tribeA_correct_total += 1;
          await updateRelayField(relayId, 'tribeA_correct_total', state.tribeA_correct_total, fastify);
        } else {
          state.tribeB_correct_total += 1;
          await updateRelayField(relayId, 'tribeB_correct_total', state.tribeB_correct_total, fastify);
        }
      }

      if (state.active_tribe === 'A') {
        state.tribeA_score += points;
        await updateRelayField(relayId, 'tribeA_score', state.tribeA_score, fastify);
      } else {
        state.tribeB_score += points;
        await updateRelayField(relayId, 'tribeB_score', state.tribeB_score, fastify);
      }

      state.current_round += 1;
      await updateRelayField(relayId, 'current_round', state.current_round, fastify);

      relayNamespace.to(`relay:${relayId}`).emit('relay:progress', {
        tribeA_score: state.tribeA_score,
        tribeB_score: state.tribeB_score,
        current_round: state.current_round,
        active_tribe: state.active_tribe,
        active_player_index: state.active_player_index
      });

      if (state.current_round >= QUESTIONS_PER_PLAYER) {
        await handleBatonPass(relayId, state, relayNamespace, fastify);
      } else {
        socket.emit('relay:next_question', { round: state.current_round + 1 });
      }
    });
  });
}

async function handleBatonPass(relayId, state, namespace, fastify) {
  state.current_round = 0;
  if (state.active_tribe === 'A') {
    state.active_tribe = 'B';
  } else {
    state.active_tribe = 'A';
    state.active_player_index += 1;
  }

  if (state.active_player_index >= 5) {
    // End of all turns. Calculate Clean Sheet Bonuses.
    if (state.tribeA_correct_total >= TOTAL_QUESTIONS) {
      state.tribeA_score += 500;
      await updateRelayField(relayId, 'tribeA_score', state.tribeA_score, fastify);
    }
    if (state.tribeB_correct_total >= TOTAL_QUESTIONS) {
      state.tribeB_score += 500;
      await updateRelayField(relayId, 'tribeB_score', state.tribeB_score, fastify);
    }

    state.status = RELAY_STATES.SCORING;
    await updateRelayField(relayId, 'status', state.status, fastify);
    namespace.to(`relay:${relayId}`).emit('relay:scoring', {
      tribeA_score: state.tribeA_score,
      tribeB_score: state.tribeB_score
    });
    
    setTimeout(async () => {
       await updateRelayField(relayId, 'status', RELAY_STATES.COMPLETED, fastify);
       namespace.to(`relay:${relayId}`).emit('relay:end', {
         winner: state.tribeA_score > state.tribeB_score ? 'A' : (state.tribeA_score < state.tribeB_score ? 'B' : 'TIE'),
         tribeA_score: state.tribeA_score,
         tribeB_score: state.tribeB_score
       });
    }, 5000);
  } else {
    await updateRelayField(relayId, 'active_tribe', state.active_tribe, fastify);
    await updateRelayField(relayId, 'active_player_index', state.active_player_index, fastify);
    await updateRelayField(relayId, 'current_round', 0, fastify);
    namespace.to(`relay:${relayId}`).emit('relay:baton_pass', {
      active_tribe: state.active_tribe,
      active_player_index: state.active_player_index
    });
  }
}

export async function createRelayMatch(fastify, tribeA_id, tribeB_id, participantsA, participantsB) {
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
    tribeA_participants: participantsA,
    tribeB_participants: participantsB,
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
  await updateRelayField(relayId, 'status', RELAY_STATES.OPENING, fastify);
  namespace.to(`relay:${relayId}`).emit('relay:opening', { relayId });
  setTimeout(async () => {
    await updateRelayField(relayId, 'status', RELAY_STATES.SEQUENCE, fastify);
    namespace.to(`relay:${relayId}`).emit('relay:start', { relayId });
  }, 10000);
}
