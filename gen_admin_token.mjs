import jwt from 'jsonwebtoken';
import config from './src/config.js';

const payload = {
  id: '50ae7ded-ecdb-4f8a-b20e-ec5a46998352', // tester admin id
  username: 'tester',
  role: 'admin'
};

const token = jwt.sign(payload, config.jwt.secret, { expiresIn: '1h' });
console.log(token);
