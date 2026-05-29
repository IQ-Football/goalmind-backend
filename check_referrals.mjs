import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'goalmind',
  user: 'postgres',
  password: 'postgres',
});

async function check() {
  try {
    await client.connect();
    // Assuming there is a referrals or similar table based on LAUNCH_PROGRESS.md
    // Let's check the schema first if we don't know the table name.
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', tables.rows.map(r => r.table_name));

    // Try to query common naming conventions for referrals
    const referralTable = tables.rows.find(r => r.table_name.includes('referral'))?.table_name;
    if (referralTable) {
      const res = await client.query(`SELECT * FROM ${referralTable}`);
      console.log('Referrals:', JSON.stringify(res.rows, null, 2));
    } else {
        console.log('No referral table found.');
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

check();
