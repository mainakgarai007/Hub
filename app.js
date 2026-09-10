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
const CACHE_MS = 45000;

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
  if (q.get('q')) {
    url += `&filter[text]=${encodeURIComponent(q.get('q'))}`;
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
function animeCard(a,extra=''){const image=a.images?.jpg?.large_image_url||a.images?.jpg?.image_url||'';const title=a.title_english||a.title||'Unknown title';const year=a.year||a.aired?.from?.slice(0,4)||'—';return `<article class="anime-card"><img src="${escapeHtml(image)}" alt="" loading="lazy"><div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${year} · ⭐ ${a.score??'—'}</p><p>${escapeHtml(a.type||'Anime')} · ${escapeHtml(a.status||'Unknown')}</p>${extra}</div></article>`}

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
function setProfileUI(firebase){const button=document.getElementById('profileButton'),avatar=document.getElementById('profileAvatar'),fallback=document.getElementById('avatarFallback'),name=document.getElementById('profileName'),menu=document.getElementById('profileMenu'),menuAvatar=document.getElementById('menuAvatar'),menuName=document.getElementById('menuName'),menuEmail=document.getElementById('menuEmail'),logout=document.getElementById('menuLogout'),loginCta=document.getElementById('loginCta');if(!button)return;const guest=()=>{button.href='login.html';name.textContent='Login';fallback.hidden=false;avatar.hidden=true;menuName.textContent='Guest';menuEmail.textContent='Not signed in';menuAvatar.hidden=true;logout.hidden=true;if(loginCta)loginCta.hidden=false};const userUI=u=>{button.href='#';name.textContent=u.displayName||u.email?.split('@')[0]||'Account';menuName.textContent=u.displayName||'My account';menuEmail.textContent=u.email||'';logout.hidden=false;if(u.photoURL){avatar.src=u.photoURL;avatar.hidden=false;fallback.hidden=true;menuAvatar.src=u.photoURL;menuAvatar.hidden=false}else{avatar.hidden=true;fallback.hidden=false;menuAvatar.hidden=true}if(loginCta)loginCta.hidden=true};button.addEventListener('click',e=>{if(firebase?.auth.currentUser){e.preventDefault();menu.hidden=!menu.hidden}});document.addEventListener('click',e=>{if(menu&&!menu.hidden&&!e.target.closest('#profileArea'))menu.hidden=true});logout?.addEventListener('click',async()=>{await firebase.signOut(firebase.auth);menu.hidden=true});if(!firebase)return guest();firebase.onAuthStateChanged(firebase.auth,u=>u?userUI(u):guest())}
window.MGHub={searchAnime,fetchJikan,animeCard,escapeHtml,initFirebase};
window.MGHubReady=initFirebase().then(f=>{window.MGHubFirebase=f;setProfileUI(f);return f}).catch(e=>{console.error(e);setProfileUI(null);return null});
