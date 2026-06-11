import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:8080/relay', {
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('Connected to /relay namespace');
  process.exit(0);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Connection timed out');
  process.exit(1);
}, 5000);
