import { io } from 'socket.io-client';

const BACKEND_URL = 'http://localhost:8080';
const RELAY_NAMESPACE = `${BACKEND_URL}/relay`;
const TOTAL_CONNECTIONS = 2000;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 200;

async function simulate() {
  console.log(`Starting relay load simulation: ${TOTAL_CONNECTIONS} connections...`);
  
  const relayId = 'test-relay-id';
  const participants = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];

  console.log('Starting 10 participants...');
  participants.forEach((pid) => {
    createParticipant(relayId, pid);
  });

  let connectedCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_CONNECTIONS; i += BATCH_SIZE) {
    const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_CONNECTIONS - i);
    const promises = [];

    for (let j = 0; j < currentBatchSize; j++) {
      promises.push(createConnection(relayId, i + j));
    }

    await Promise.all(promises);
    connectedCount += currentBatchSize;
    if (connectedCount % 1000 === 0) {
      console.log(`Connected ${connectedCount}/${TOTAL_CONNECTIONS} spectators...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`Successfully simulated ${TOTAL_CONNECTIONS} spectators in ${duration}s`);
  
  console.log('Holding simulation for 120 seconds...');
  await new Promise(resolve => setTimeout(resolve, 120000));
  
  process.exit(0);
}

function createConnection(relayId, id) {
  return new Promise((resolve) => {
    const socket = io(RELAY_NAMESPACE, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false
    });

    socket.on('connect', () => {
      socket.emit('relay:join', { relayId });
    });

    socket.on('relay:welcome', () => {
      const interval = setInterval(() => {
        if (socket.connected) {
          socket.emit('relay:encourage', { type: 'fire' });
        } else {
          clearInterval(interval);
        }
      }, 10000 + Math.random() * 20000);
      resolve();
    });

    socket.on('connect_error', (err) => {
      resolve();
    });
  });
}

function createParticipant(relayId, playerId) {
  const socket = io(RELAY_NAMESPACE, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token: 'mock-token' }
  });

  socket.on('connect', () => {
    socket.emit('relay:join', { relayId });
  });

  socket.on('relay:welcome', (data) => {
    checkTurn(socket, relayId, playerId, data.state);
  });

  socket.on('relay:start', () => {
    // Re-check turn when match starts
    // In our simplified logic, Tribe A player 0 always starts
    if (playerId === 'p1') {
      sendAnswer(socket, relayId);
    }
  });

  socket.on('relay:baton_pass', (data) => {
    if (isMyTurn(playerId, data.active_tribe, data.active_player_index)) {
      sendAnswer(socket, relayId);
    }
  });

  socket.on('relay:next_question', () => {
    sendAnswer(socket, relayId);
  });
  
  socket.on('relay:end', (data) => {
    console.log(`Relay match finished! Winner: Tribe ${data.winner}. Score: ${data.tribeA_score} - ${data.tribeB_score}`);
  });
}

function isMyTurn(playerId, activeTribe, activeIndex) {
  const participantsA = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const participantsB = ['p6', 'p7', 'p8', 'p9', 'p10'];
  const activeParticipants = activeTribe === 'A' ? participantsA : participantsB;
  return activeParticipants[activeIndex] === playerId;
}

function checkTurn(socket, relayId, playerId, state) {
  if (state.status === 'sequence' && isMyTurn(playerId, state.active_tribe, state.active_player_index)) {
    sendAnswer(socket, relayId);
  }
}

function sendAnswer(socket, relayId) {
  setTimeout(() => {
    if (socket.connected) {
      socket.emit('relay:answer', {
        relayId,
        questionId: 'q' + Date.now(),
        answer: 'option1',
        responseTimeMs: 500 + Math.random() * 1000
      });
    }
  }, 1000 + Math.random() * 2000);
}

simulate().catch(console.error);
