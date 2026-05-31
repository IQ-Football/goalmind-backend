import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'http://localhost:8082';
const CONCURRENCY = 50;
const TOTAL_SIGNUPS = 1000; // Let's do 1000 for now as a representative sample

async function signupWorker(id, tribeIds, count) {
  for (let i = 0; i < count; i++) {
    const payload = {
      username: `surge_user_${id}_${i}_${uuidv4().substring(0, 4)}`,
      email: `surge_${id}_${i}_${uuidv4().substring(0, 4)}@example.com`,
      password: 'password123',
      tribeId: tribeIds[Math.floor(Math.random() * tribeIds.length)]
    };

    try {
      await axios.post(`${BASE_URL}/auth/register`, payload);
    } catch (err) {
      // console.error(`Worker ${id} error: ${err.message}`);
    }
  }
}

async function runSurgeTest() {
  try {
    const res = await axios.get(`${BASE_URL}/tribes`);
    const tribes = res.data.data.tribes;
    // Specifically target surge tribes
    const surgeTribeIds = tribes.filter(t => ['nigeria', 'ghana', 'morocco', 'uct-ikey-tigers', 'wits-clever-boys'].includes(t.slug)).map(t => t.id);
    
    if (surgeTribeIds.length === 0) {
      console.log('No surge tribes found, using all tribes');
      var targetTribeIds = tribes.map(t => t.id);
    } else {
      var targetTribeIds = surgeTribeIds;
    }

    console.log(`Starting surge stress test: ${TOTAL_SIGNUPS} signups with concurrency ${CONCURRENCY}`);
    const start = Date.now();

    const workers = [];
    const signupsPerWorker = Math.ceil(TOTAL_SIGNUPS / CONCURRENCY);

    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(signupWorker(i, targetTribeIds, signupsPerWorker));
    }

    await Promise.all(workers);

    const duration = (Date.now() - start) / 1000;
    console.log(`Finished ${TOTAL_SIGNUPS} signups in ${duration}s (${(TOTAL_SIGNUPS / duration).toFixed(2)} req/s)`);
  } catch (err) {
    console.error(`Failed to initialize test: ${err.message}`);
  }
}

runSurgeTest();
