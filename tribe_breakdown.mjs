import { execSync } from 'child_process';

const query = "SELECT t.name, COUNT(u.id) as user_count FROM users u JOIN tribes t ON u.tribe_id = t.id GROUP BY t.name ORDER BY user_count DESC";
const result = execSync(`team-db "${query}"`).toString();
console.log(result);
