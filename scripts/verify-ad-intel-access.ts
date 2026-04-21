/**
 * Verifies that SENSOR_TOWER_AUTH_TOKEN can call Sensor Tower Ad Intelligence API.
 * Run from repo root (node-fetch resolves via functions/node_modules):
 *
 *   SENSOR_TOWER_AUTH_TOKEN="$(firebase functions:secrets:access SENSOR_TOWER_AUTH_TOKEN)" \
 *     NODE_PATH=functions/node_modules npx tsx scripts/verify-ad-intel-access.ts
 */
import fetch from 'node-fetch';

const BASE_URL = 'https://api.sensortower.com/v1';

function redactTokenFromMessage(s: unknown): string {
  const str = s instanceof Error ? s.message : typeof s === 'string' ? s : String(s ?? '');
  return str.replace(/auth_token=[^&\s]+/g, 'auth_token=<REDACTED>');
}

async function main() {
  const token = process.env.SENSOR_TOWER_AUTH_TOKEN?.trim();
  if (!token) {
    console.error('Set SENSOR_TOWER_AUTH_TOKEN env var (copy value from Firebase Secret Manager).');
    process.exit(2);
  }

  // Minimal Ad Intelligence endpoint: list creatives for one well-known app
  // (Candy Crush iOS = 553834731). Use a small time window & limit to keep the call cheap.
  const url = `${BASE_URL}/ios/ad_intel/creatives?` + new URLSearchParams({
    auth_token: token,
    app_ids: '553834731',
    start_date: '2026-03-01',
    end_date: '2026-03-07',
    // Meta inventory is exposed as Instagram in this API (see 422 if using invalid names like "facebook").
    networks: 'Instagram',
    countries: 'US',
    limit: '5',
  }).toString();

  const res = await fetch(url);
  console.log('Status:', res.status, res.statusText);
  const body = await res.text();
  console.log('Body preview:', body.slice(0, 500));

  if (res.status === 200) {
    console.log('\n✅ Ad Intelligence access confirmed for the existing token.');
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    console.error('\n❌ Token is NOT authorized for Ad Intelligence. Contact Sensor Tower to add the add-on or issue a separate token.');
    process.exit(1);
  }
  console.error('\n⚠️  Unexpected response — inspect body above.');
  process.exit(3);
}

main().catch(err => {
  console.error(
    'Verification failed unexpectedly (network/runtime error, not an auth verdict):',
    redactTokenFromMessage(err)
  );
  process.exit(3);
});
