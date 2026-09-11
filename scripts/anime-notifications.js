const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const JIKAN = 'https://api.jikan.moe/v4';
const DELAY_MS = 700;
const MAX_TOKENS = 50;
const OWNER = 'mainakgarai007';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tokenId(token) {
  return String(token).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
}

function titleOf(sub, data) {
  return data?.title_english || data?.title || sub?.title || 'Anime';
}

function prefsOf(data) {
  return {
    enabled: data?.enabled === true,
    episodes: data?.episodes !== false,
    news: data?.news === true,
    status: data?.status !== false,
  };
}

async function jikan(path) {
  const response = await fetch(`${JIKAN}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Jikan ${response.status}`);
  return response.json();
}

async function sendToTokens(tokens, title, body, url, tag) {
  if (!tokens.length) return [];
  const result = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { url, tag },
  });

  return result.responses
    .map((response, index) => {
      if (!response.success && [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ].includes(response.error?.code)) {
        return tokens[index];
      }
      return null;
    })
    .filter(Boolean);
}

function getCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing.');

  const credentials = JSON.parse(raw);
  if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields.');
  }
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  return credentials;
}

// Discover users from notification token documents instead of users/{uid} root
// documents. Firestore allows subcollections to exist even when the parent
// document does not, which is how the web app currently stores tokens.
async function getNotificationUsers(db) {
  const tokenSnap = await db.collectionGroup('notificationTokens').get();
  const grouped = new Map();

  for (const doc of tokenSnap.docs) {
    const userRef = doc.ref.parent.parent;
    if (!userRef) continue;

    const userId = userRef.id;
    const token = doc.data()?.token;
    if (!token) continue;

    if (!grouped.has(userId)) grouped.set(userId, []);
    const tokens = grouped.get(userId);
    if (tokens.length < MAX_TOKENS) tokens.push(token);
  }

  const users = [];
  for (const [userId, tokens] of grouped.entries()) {
    const prefSnap = await db.doc(`users/${userId}/profile/notificationPreferences`).get();
    const prefs = prefsOf(prefSnap.data());
    if (prefs.enabled && tokens.length) users.push({ userId, prefs, tokens });
  }

  console.log(`Discovered ${users.length} enabled user(s) from ${tokenSnap.size} notification token document(s).`);
  return users;
}

async function removeStaleTokens(db, userId, staleTokens) {
  for (const stale of staleTokens) {
    await db.doc(`users/${userId}/notificationTokens/${tokenId(stale)}`).delete().catch(() => {});
  }
}

async function broadcast(db, users, title, body) {
  let sent = 0;
  let removed = 0;

  for (const user of users) {
    const staleTokens = await sendToTokens(
      user.tokens,
      title,
      body,
      '/Hub/notifications.html',
      `owner-${Date.now()}`,
    );
    sent += 1;
    removed += staleTokens.length;
    await removeStaleTokens(db, user.userId, staleTokens);
  }

  console.log(`Broadcast complete. Sent to ${sent} user(s), removed ${removed} stale token(s).`);
}

async function testNotification(db, users) {
  // Test only goes to enabled devices, never to users who disabled push.
  await broadcast(
    db,
    users,
    '🔔 MG Master Hub',
    'Notification test successful! Your push notifications are working.',
  );
}

async function checkAnime(db, users) {
  console.log(`Checking ${users.length} enabled user(s).`);

  let checked = 0;
  let sent = 0;
  let removedTokens = 0;

  for (const user of users) {
    const { userId, prefs, tokens } = user;
    const subsSnap = await db.collection(`users/${userId}/subscriptions`).get();
    if (subsSnap.empty) continue;

    for (const subDoc of subsSnap.docs) {
      const sub = subDoc.data() || {};
      const malId = Number(sub.malId || String(sub.id || '').replace('anime:mal:', ''));
      if (!Number.isInteger(malId) || malId < 1) continue;

      checked += 1;
      try {
        await sleep(DELAY_MS);
        const detail = (await jikan(`/anime/${malId}/full`)).data || {};
        const name = titleOf(sub, detail);
        const currentEp = Number(detail.episodes);
        const currentStatus = String(detail.status || 'Unknown');
        const state = sub.notificationState || {};
        const update = {
          notificationState: {
            ...state,
            lastCheckedAt: new Date().toISOString(),
          },
        };

        if (state.baselined !== true) {
          update.notificationState = {
            ...update.notificationState,
            baselined: true,
            lastEpisode: Number.isFinite(currentEp) ? currentEp : null,
            lastStatus: currentStatus,
          };
        } else {
          if (
            prefs.episodes &&
            Number.isFinite(currentEp) &&
            Number.isFinite(Number(state.lastEpisode)) &&
            currentEp > Number(state.lastEpisode)
          ) {
            const old = Number(state.lastEpisode);
            const body = currentEp - old === 1
              ? `Episode ${currentEp} is now available.`
              : `Episodes ${old + 1}–${currentEp} are now available.`;
            const staleTokens = await sendToTokens(
              tokens,
              `📺 ${name}`,
              body,
              `/Hub/anime-detail.html?id=${malId}`,
              `episode-${malId}-${currentEp}`,
            );
            sent += 1;
            removedTokens += staleTokens.length;
            await removeStaleTokens(db, userId, staleTokens);
          }

          if (prefs.status && currentStatus !== String(state.lastStatus || '')) {
            const staleTokens = await sendToTokens(
              tokens,
              `📌 ${name}`,
              `Status changed to ${currentStatus}.`,
              `/Hub/anime-detail.html?id=${malId}`,
              `status-${malId}-${currentStatus}`,
            );
            sent += 1;
            removedTokens += staleTokens.length;
            await removeStaleTokens(db, userId, staleTokens);
          }

          update.notificationState = {
            ...update.notificationState,
            lastEpisode: Number.isFinite(currentEp) ? currentEp : state.lastEpisode,
            lastStatus: currentStatus,
          };
        }

        if (prefs.news) {
          await sleep(DELAY_MS);
          const news = (await jikan(`/anime/${malId}/news?limit=3`)).data || [];
          const latest = news[0];
          const key = latest?.url || latest?.mal_id || null;
          if (key && state.lastNewsKey && key !== state.lastNewsKey) {
            const staleTokens = await sendToTokens(
              tokens,
              `📰 ${name}`,
              latest.title || 'New anime news is available.',
              `/Hub/anime-pulse.html`,
              `news-${malId}-${tokenId(key)}`,
            );
            sent += 1;
            removedTokens += staleTokens.length;
            await removeStaleTokens(db, userId, staleTokens);
          }
          if (key) {
            update.notificationState = {
              ...update.notificationState,
              lastNewsKey: key,
            };
          }
        }

        await subDoc.ref.set(update, { merge: true });
      } catch (error) {
        console.error(`Failed ${userId}/${subDoc.id}:`, error?.message || error);
      }
    }
  }

  console.log(`Done. Checked ${checked} subscription(s), sent ${sent} notification batch(es), removed ${removedTokens} stale token(s).`);
}

async function main() {
  const credentials = getCredentials();
  if (!getApps().length) initializeApp({ credential: cert(credentials) });

  const db = getFirestore();
  const users = await getNotificationUsers(db);
  const mode = process.env.NOTIFICATION_MODE || 'check';

  if (mode === 'owner-message') {
    const actor = String(process.env.GITHUB_ACTOR || '');
    if (actor !== OWNER) {
      throw new Error('Owner message is restricted to the repository owner.');
    }

    const title = String(process.env.OWNER_MESSAGE_TITLE || '').trim().slice(0, 120) || 'MG Master Hub';
    const body = String(process.env.OWNER_MESSAGE_BODY || '').trim().slice(0, 1000);
    if (!body) throw new Error('Owner message body is required.');
    await broadcast(db, users, `📢 ${title}`, body);
    return;
  }

  if (mode === 'test') {
    await testNotification(db, users);
    return;
  }

  await checkAnime(db, users);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
