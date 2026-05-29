import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'http://localhost:8082';

async function testSignup(count, tribeIds) {
  console.log(`Starting stress test: ${count} signups using ${tribeIds.length} tribes`);
  const start = Date.now();

  for (let i = 0; i < count; i++) {
    const payload = {
      username: `testuser_${uuidv4().substring(0, 8)}_${i}`,
      email: `test_${uuidv4().substring(0, 8)}_${i}@example.com`,
      password: 'password123',
      tribeId: tribeIds[i % tribeIds.length]
    };

    try {
      const res = await axios.post(`${BASE_URL}/auth/register`, payload);
      if (i % 10 === 0) console.log(`Processed ${i} signups...`);
    } catch (err) {
      console.error(`Error at ${i}: ${err.message}`);
      if (err.response) console.error(err.response.data);
    }
  }

  const duration = (Date.now() - start) / 1000;
  console.log(`Finished ${count} signups in ${duration}s (${(count / duration).toFixed(2)} req/s)`);
}

// First, get real tribe IDs
async function getTribesAndRun() {
  try {
    const res = await axios.get(`${BASE_URL}/tribes`);
    const tribeIds = res.data.data.tribes.map(t => t.id);
    if (tribeIds.length === 0) throw new Error('No tribes found');
    
    await testSignup(1000, tribeIds); // 1000 signups
  } catch (err) {
    console.error(`Failed to initialize test: ${err.message}`);
  }
}

getTribesAndRun();
