import Redis from 'ioredis';

async function check() {
  const redis = new Redis();
  const val = await redis.get('stats:total_signups');
  console.log('stats:total_signups =', val);
  await redis.quit();
}
check().catch(console.error);
