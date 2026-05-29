import Redis from 'ioredis';

async function check() {
  const redis = new Redis();
  const val = await redis.get('users:total_count');
  console.log('users:total_count =', val);
  await redis.quit();
}
check().catch(console.error);
