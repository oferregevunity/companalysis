/**
 * Run with: npx ts-node scripts/seed-genres.ts
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key.
 */
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

admin.initializeApp();
const db = getFirestore('companalysis');

const DEFAULT_GENRES = [
  {
    name: 'Games (All)',
    categoryIds: { ios: '6014', android: 'GAME' },
    active: true,
  },
  {
    name: 'Hypercasual',
    categoryIds: { ios: '7003', android: 'GAME_CASUAL' },
    active: true,
  },
  {
    name: 'Match',
    categoryIds: { ios: '7019', android: 'GAME_WORD' },
    active: true,
  },
  {
    name: 'Puzzle',
    categoryIds: { ios: '7012', android: 'GAME_PUZZLE' },
    active: true,
  },
];

async function seed() {
  for (const genre of DEFAULT_GENRES) {
    const ref = db.collection('genres').doc();
    await ref.set({
      ...genre,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Created genre: ${genre.name} (${ref.id})`);
  }
  console.log('Seeding complete.');
}

seed().catch(console.error);
