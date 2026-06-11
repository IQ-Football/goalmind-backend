
import { io } from 'socket.io-client';

const URL = 'http://localhost:8080/relay';
const NUM_CLIENTS = 100;
const EMIT_INTERVAL = 100; // ms

async function run() {
  console.log(`Starting load test with ${NUM_CLIENTS} clients...`);
  const clients = [];

  for (let i = 0; i < NUM_CLIENTS; i++) {
    const socket = io(URL, {
      transports: ['websocket'],
      autoConnect: true
    });

    socket.on('connect', () => {
      // console.log(`Client ${i} connected`);
      socket.emit('relay:join', { relayId: 'test-relay-id' });
    });

    socket.on('relay:welcome', (data) => {
      // console.log(`Client ${i} welcomed`);
    });

    socket.on('connect_error', (err) => {
      console.error(`Client ${i} connection error:`, err.message);
    });

    clients.push(socket);
  }

  console.log('All clients connecting...');

  // Wait for connections
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Starting WarCry stress...');
  const interval = setInterval(() => {
    clients.forEach((socket, i) => {
      if (socket.connected) {
        socket.emit('relay:warcry', { 
          relayId: 'test-relay-id', 
          tribeId: 'test-tribe-id',
          intensity: Math.floor(Math.random() * 10) + 1
        });
      }
    });
  }, EMIT_INTERVAL);

  // Run for 10 seconds
  setTimeout(() => {
    clearInterval(interval);
    console.log('Load test finished. Disconnecting clients...');
    clients.forEach(s => s.disconnect());
    process.exit(0);
  }, 10000);
}

run().catch(console.error);
