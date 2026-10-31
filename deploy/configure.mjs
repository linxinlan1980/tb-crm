// Runs with Node 24 locally or in the official Node Docker image. Never overwrites credentials.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
const target = process.argv[2] || 'deploy/.env';
if (existsSync(target)) {
  console.log('Existing deployment configuration preserved.');
} else {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || !/^[A-Za-z0-9!@#%^*+_.-]{5,128}$/.test(password))
    throw new Error('Set SEED_ADMIN_PASSWORD (5-128 supported letters, numbers or symbols)');
  const hex = () => randomBytes(32).toString('hex');
  writeFileSync(target, `MYSQL_ROOT_PASSWORD=${hex()}\nMYSQL_PASSWORD=${hex()}\nJWT_SECRET=${hex()}\nENCRYPTION_KEY=${hex()}\nSEED_ADMIN_PASSWORD=${password}\nWEB_PORT=3000\n`, { mode: 0o600, flag: 'wx' });
  console.log('Generated random per-install database and signing keys.');
}
