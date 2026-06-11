import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'http://localhost:8080';
const TOTAL_SIGNUPS = 1000;
const CONCURRENCY = 50;

async function runTest() {
  console.log(`Starting stress test v3: ${TOTAL_SIGNUPS} signups with concurrency ${CONCURRENCY}`);
  
  const tribeRes = await axios.get(`${BASE_URL}/tribes`);
  const tribeIds = tribeRes.data.data.tribes.map(t => t.id);
  
  const start = Date.now();
  let successCount = 0;
  let failCount = 0;
  const latencies = [];

  const chunks = [];
  for (let i = 0; i < TOTAL_SIGNUPS; i += CONCURRENCY) {
    chunks.push(Array.from({ length: Math.min(CONCURRENCY, TOTAL_SIGNUPS - i) }, (_, j) => i + j));
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async (i) => {
      const payload = {
        username: `stress_${uuidv4().substring(0, 8)}_${i}` + Date.now(),
        email: `stress_${uuidv4().substring(0, 8)}_${i}@example.com`,
        password: 'password123',
        tribeId: tribeIds[i % tribeIds.length]
      };
      
      const reqStart = Date.now();
      try {
        await axios.post(`${BASE_URL}/auth/register`, payload);
        latencies.push(Date.now() - reqStart);
        successCount++;
      } catch (err) {
        failCount++;
        // console.error(`Error at ${i}: ${err.message}`);
      }
    }));
    if (successCount % 100 === 0) console.log(`Processed ${successCount} signups...`);
  }

  const duration = (Date.now() - start) / 1000;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  console.log('--- Results ---');
  console.log(`Total time: ${duration.toFixed(2)}s`);
  console.log(`Throughput: ${(successCount / duration).toFixed(2)} req/s`);
  console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`Success: ${successCount}`);
  console.log(`Failures: ${failCount}`);
}

runTest().catch(console.error);
