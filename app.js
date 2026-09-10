// MG Master Hub — shared app logic
const API_BASE = 'https://api.jikan.moe/v4';
const FIREBASE_VERSION = '12.18.0';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBF3jubXpba2G8CPszVN-Dip3-OWs_EUoE',
  authDomain: 'hubs-b9c39.firebaseapp.com',
  projectId: 'hubs-b9c39',
  storageBucket: 'hubs-b9c39.firebasestorage.app',
  messagingSenderId: '699995857695',
  appId: '1:699995857695:web:240f8598fb4100d7cf462a'
};

async function requestJikan(path, attempt = 0) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise(x => setTimeout(x, 1200 * (attempt + 1)));
      return requestJikan(path, attempt + 1);
    }
    if (!r.ok) throw new Error(`Jikan HTTP ${r.status}`);
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch (e) {
    if (attempt < 2 && e instanceof TypeError) {
      await new Promise(x => setTimeout(x, 1000));
      return requestJikan(path, attempt + 1);
    }
    throw e;
  }
}

const searchAnime = q => requestJikan(`/anime?q=${encodeURIComponent(String(q || '').trim())}&limit=12&sfw=true`);
const fetchJikan = requestJikan;

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function animeCard(a, extra = '') {
  const image = a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || '';
  const title = a.title_english || a.title || 'Unknown title';
  const year = a.year || a.aired?.from?.slice(0, 4) || '—';
  return `<article class="anime-card"><img src="${escapeHtml(image)}" alt="" loading="lazy"><div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${year} · ⭐ ${a.score ?? '—'}</p><p>${escapeHtml(a.type || 'Anime')} · ${escapeHtml(a.status || 'Unknown')}</p>${extra}</div></article>`;
}

let firebasePromise;
async function initFirebase() {
  if (firebasePromise) return firebasePromise;
  firebasePromise = (async () => {
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const app = initializeApp(FIREBASE_CONFIG);
    return { ...authModule, app, auth: authModule.getAuth(app) };
  })();
  return firebasePromise;
}

function setProfileUI(firebase) {
  const button = document.getElementById('profileButton');
  const avatar = document.getElementById('profileAvatar');
  const fallback = document.getElementById('avatarFallback');
  const name = document.getElementById('profileName');
  const menu = document.getElementById('profileMenu');
  const menuAvatar = document.getElementById('menuAvatar');
  const menuName = document.getElementById('menuName');
  const menuEmail = document.getElementById('menuEmail');
  const logout = document.getElementById('menuLogout');
  const loginCta = document.getElementById('loginCta');
  if (!button) return;

  const guest = () => {
    button.href = 'login.html';
    name.textContent = 'Login';
    fallback.hidden = false;
    avatar.hidden = true;
    menuName.textContent = 'Guest';
    menuEmail.textContent = 'Not signed in';
    menuAvatar.hidden = true;
    logout.hidden = true;
    if (loginCta) loginCta.hidden = false;
  };

  const userUI = u => {
    button.href = '#';
    name.textContent = u.displayName || u.email?.split('@')[0] || 'Account';
    menuName.textContent = u.displayName || 'My account';
    menuEmail.textContent = u.email || '';
    logout.hidden = false;
    if (u.photoURL) {
      avatar.src = u.photoURL;
      avatar.hidden = false;
      fallback.hidden = true;
      menuAvatar.src = u.photoURL;
      menuAvatar.hidden = false;
    } else {
      avatar.hidden = true;
      fallback.hidden = false;
      menuAvatar.hidden = true;
    }
    if (loginCta) loginCta.hidden = true;
  };

  button.addEventListener('click', e => {
    if (firebase?.auth.currentUser) {
      e.preventDefault();
      menu.hidden = !menu.hidden;
    }
  });
  document.addEventListener('click', e => {
    if (menu && !menu.hidden && !e.target.closest('#profileArea')) menu.hidden = true;
  });
  logout?.addEventListener('click', async () => {
    await firebase.signOut(firebase.auth);
    menu.hidden = true;
  });
  if (!firebase) return guest();
  firebase.onAuthStateChanged(firebase.auth, u => u ? userUI(u) : guest());
}

window.MGHub = { searchAnime, fetchJikan, animeCard, escapeHtml, initFirebase };
window.MGHubReady = initFirebase().then(f => {
  window.MGHubFirebase = f;
  setProfileUI(f);
  return f;
}).catch(e => {
  console.error(e);
  setProfileUI(null);
  return null;
});

export { searchAnime, fetchJikan, animeCard, escapeHtml, initFirebase };
