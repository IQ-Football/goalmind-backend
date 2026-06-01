
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:8080/relay', {
  transports: ['websocket'],
  auth: {
    token: 'mock-token' // In real usage this would be a JWT
  }
});

socket.on('connect', () => {
  console.log('Connected to /relay namespace');
  
  // Try to join a relay match
  const relayId = 'd3afcf76-9010-4ab9-b3cc-c420e6fd2b08';
  socket.emit('relay:join', { relayId });
  console.log(`Sent relay:join for ${relayId}`);
});

socket.on('relay:welcome', (data) => {
  console.log('Received relay:welcome:', data);
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('Timeout waiting for response');
  process.exit(1);
}, 5000);
