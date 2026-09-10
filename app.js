// MG Master Hub — shared app logic
const API_BASE = 'https://api.jikan.moe/v4';
const KITSU_BASE = 'https://kitsu.io/api/edge';
const FIREBASE_VERSION = '12.18.0';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBF3jubXpba2G8CPszVN-Dip3-OWs_EUoE',
  authDomain: 'hubs-b9c39.firebaseapp.com', projectId: 'hubs-b9c39',
  storageBucket: 'hubs-b9c39.firebasestorage.app', messagingSenderId: '699995857695',
  appId: '1:699995857695:web:240f8598fb4100d7cf462a'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cache = new Map();
const CACHE_MS = 60000;

function normalizeKitsu(item) {
  const a = item?.attributes || {};
  const titles = a.titles || {};
  const poster = a.posterImage?.large || a.posterImage?.medium || a.posterImage?.small || '';
  const start = a.startDate || null;
  const year = start ? start.slice(0, 4) : '—';
  const rating = a.averageRating ? Number(a.averageRating) / 10 : null;
  return {
    mal_id: `kitsu-${item.id}`,
    title: titles.en || titles.en_jp || titles.ja_jp || Object.values(titles)[0] || 'Unknown title',
    title_english: titles.en || null,
    year,
    score: rating ? Number(rating.toFixed(2)) : null,
    type: a.subtype || 'Anime',
    status: a.status === 'current' ? 'Currently Airing' : (a.status || 'Unknown'),
    images: { jpg: { large_image_url: poster, image_url: poster } },
    aired: { from: start },
    _source: 'kitsu'
  };
}

async function requestJson(url, options = {}, attempt = 0) {
  const r = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  if ((r.status === 429 || r.status >= 500) && attempt < 1) {
    const retryAfter = Number(r.headers.get('Retry-After')) || 3;
    await sleep(Math.min(Math.max(retryAfter * 1000, 1500), 6000));
    return requestJson(url, options, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function requestJikan(path) {
  const key = `jikan:${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < CACHE_MS) return hit.data;
  try {
    const json = await requestJson(`${API_BASE}${path}`);
    const data = Array.isArray(json.data) ? json.data : [];
    cache.set(key, { time: Date.now(), data });
    return data;
  } catch (e) {
    console.warn('Jikan unavailable, using Kitsu fallback:', e);
    const fallback = await requestKitsu(path);
    cache.set(key, { time: Date.now(), data: fallback });
    return fallback;
  }
}

async function requestKitsu(path) {
  const q = new URLSearchParams(path.split('?')[1] || '');
  let url = `${KITSU_BASE}/anime?page[limit]=12`;
  const query = q.get('q');
  if (query) {
    url += `&filter[text]=${encodeURIComponent(query)}`;
  } else if (path.includes('/top/anime')) {
    url += '&sort=-userCount';
  } else {
    url += '&filter[status]=current&sort=-startDate';
  }
  const json = await requestJson(url);
  return Array.isArray(json.data) ? json.data.map(normalizeKitsu) : [];
}

const searchAnime = q => {
  const query = String(q || '').trim();
  if (!query) return Promise.resolve([]);
  return requestJikan(`/anime?q=${encodeURIComponent(query)}&limit=12&sfw=true`);
};
const fetchJikan = requestJikan;

function escapeHtml(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]))}
function animeCard(a,extra=''){
  const item = (a && typeof a === 'object') ? a : {};
  const image = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '';
  const title = item.title_english || item.title || 'Unknown title';
  const rawYear = item.year || item.aired?.from?.slice?.(0, 4);
  const year = rawYear ? String(rawYear) : '—';
  const score = Number.isFinite(Number(item.score)) ? String(item.score) : '—';
  const type = item.type || 'Anime';
  const status = item.status || 'Unknown';
  const safeExtra = typeof extra === 'string' ? extra : '';
  return `<article class="anime-card"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"><div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(year)} · ⭐ ${escapeHtml(score)}</p><p>${escapeHtml(type)} · ${escapeHtml(status)}</p>${safeExtra}</div></article>`;
}

let firebasePromise;
async function initFirebase(){
  if(firebasePromise)return firebasePromise;
  firebasePromise=(async()=>{
    const{initializeApp}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const app=initializeApp(FIREBASE_CONFIG);
    return{...authModule,app,auth:authModule.getAuth(app)};
  })();
  return firebasePromise;
}
function setProfileUI(firebase){
  try { setProfileUI._cleanup?.(); } catch (e) { console.error('Profile UI cleanup failed:', e); }

  const button = document.getElementById('profileButton');
  const avatar = document.getElementById('profileAvatar');
  const fallback = document.getElementById('avatarFallback');
  const name = document.getElementById('profileName') || document.getElementById('displayName');
  const menu = document.getElementById('profileMenu');
  const menuAvatar = document.getElementById('menuAvatar');
  const menuName = document.getElementById('menuName');
  const menuEmail = document.getElementById('menuEmail');
  const logout = document.getElementById('menuLogout');
  const loginCta = document.getElementById('loginCta');
  const profileArea = document.getElementById('profileArea');

  if (!button) return;

  const setText = (el, value) => { if (el) el.textContent = value; };
  const showGuest = () => {
    button.href = 'login.html';
    setText(name, 'Login');
    if (avatar) { avatar.hidden = true; avatar.removeAttribute('src'); }
    if (fallback) fallback.hidden = false;
    if (menuAvatar) { menuAvatar.hidden = true; menuAvatar.removeAttribute('src'); }
    setText(menuName, 'Guest');
    setText(menuEmail, 'Not signed in');
    if (logout) logout.hidden = true;
    if (loginCta) loginCta.hidden = false;
    if (menu) menu.hidden = true;
  };

  const showUser = user => {
    const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';
    button.href = '#';
    setText(name, displayName);
    setText(menuName, user?.displayName || 'My account');
    setText(menuEmail, user?.email || '');
    if (logout) logout.hidden = false;
    if (loginCta) loginCta.hidden = true;
    if (user?.photoURL) {
      if (avatar) { avatar.src = user.photoURL; avatar.hidden = false; }
      if (fallback) fallback.hidden = true;
      if (menuAvatar) { menuAvatar.src = user.photoURL; menuAvatar.hidden = false; }
    } else {
      if (avatar) { avatar.hidden = true; avatar.removeAttribute('src'); }
      if (fallback) fallback.hidden = false;
      if (menuAvatar) { menuAvatar.hidden = true; menuAvatar.removeAttribute('src'); }
    }
  };

  let currentUser = null;
  const handleClick = async e => {
    const target = e.target;
    if (!target) return;

    if (target.closest('#menuLogout')) {
      e.preventDefault();
      if (!firebase?.auth || typeof firebase.signOut !== 'function') return;
      try {
        await firebase.signOut(firebase.auth);
      } catch (err) {
        console.error('Sign out failed:', err);
      } finally {
        if (menu) menu.hidden = true;
      }
      return;
    }

    if (target.closest('#profileButton')) {
      if (currentUser) {
        e.preventDefault();
        if (menu) menu.hidden = !menu.hidden;
      }
      return;
    }

    if (menu && !menu.hidden && profileArea && !target.closest('#profileArea')) {
      menu.hidden = true;
    }
  };

  document.addEventListener('click', handleClick);
  let unsubscribe = null;

  if (!firebase?.auth || typeof firebase.onAuthStateChanged !== 'function') {
    showGuest();
  } else {
    try {
      unsubscribe = firebase.onAuthStateChanged(firebase.auth, user => {
        currentUser = user || null;
        if (currentUser) showUser(currentUser);
        else showGuest();
      });
    } catch (err) {
      console.error('Auth state listener failed:', err);
      showGuest();
    }
  }

  setProfileUI._cleanup = () => {
    document.removeEventListener('click', handleClick);
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}

window.MGHub={searchAnime,fetchJikan,animeCard,escapeHtml,initFirebase};
window.MGHubReady=initFirebase().then(f=>{window.MGHubFirebase=f;setProfileUI(f);return f}).catch(e=>{console.error(e);setProfileUI(null);return null});

// ES-module exports used by the Hub pages.
export { searchAnime, fetchJikan, animeCard, escapeHtml, initFirebase };
