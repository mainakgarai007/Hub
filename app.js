// MG Master Hub — shared app logic
const API_BASE = 'https://api.jikan.moe/v4';
const FIREBASE_VERSION = '12.18.0';

async function searchAnime(query) {
  const q = query.trim();
  if (!q) return [];
  const response = await fetch(`${API_BASE}/anime?q=${encodeURIComponent(q)}&limit=12`);
  if (!response.ok) throw new Error(`Anime API error: ${response.status}`);
  const json = await response.json();
  return json.data || [];
}

function animeCard(anime) {
  const image = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
  const title = anime.title_english || anime.title || 'Unknown title';
  const year = anime.year || '—';
  const score = anime.score ?? '—';
  return `<article class="anime-card">
    <img src="${escapeHtml(image)}" alt="" loading="lazy">
    <div><h3>${escapeHtml(title)}</h3><p>${year} · ⭐ ${score}</p><p>${escapeHtml(anime.type || 'Anime')} · ${escapeHtml(anime.status || 'Unknown')}</p></div>
  </article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

async function initFirebase() {
  const config = window.firebaseConfig;
  if (!config?.projectId) return null;
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
  const app = initializeApp(config);
  const auth = authModule.getAuth(app);
  return { ...authModule, app, auth };
}

function setProfileUI(firebase) {
  const profileButton = document.getElementById('profileButton');
  const profileAvatar = document.getElementById('profileAvatar');
  const avatarFallback = document.getElementById('avatarFallback');
  const profileName = document.getElementById('profileName');
  const profileMenu = document.getElementById('profileMenu');
  const menuAvatar = document.getElementById('menuAvatar');
  const menuName = document.getElementById('menuName');
  const menuEmail = document.getElementById('menuEmail');
  const menuLogout = document.getElementById('menuLogout');
  if (!profileButton) return;

  const showGuest = () => {
    profileButton.href = 'login.html';
    profileName.textContent = 'Login';
    avatarFallback.hidden = false;
    profileAvatar.hidden = true;
    menuName.textContent = 'Guest';
    menuEmail.textContent = 'Not signed in';
    menuAvatar.hidden = true;
    menuLogout.hidden = true;
  };

  const showUser = (user) => {
    profileButton.href = '#';
    profileName.textContent = user.displayName || (user.email ? user.email.split('@')[0] : 'Account');
    menuName.textContent = user.displayName || 'My account';
    menuEmail.textContent = user.email || '';
    menuLogout.hidden = false;
    if (user.photoURL) {
      profileAvatar.src = user.photoURL;
      profileAvatar.hidden = false;
      avatarFallback.hidden = true;
      menuAvatar.src = user.photoURL;
      menuAvatar.hidden = false;
    } else {
      profileAvatar.hidden = true;
      avatarFallback.hidden = false;
      menuAvatar.hidden = true;
    }
  };

  profileButton.addEventListener('click', (event) => {
    if (!firebase?.auth.currentUser) return;
    event.preventDefault();
    profileMenu.hidden = !profileMenu.hidden;
  });

  document.addEventListener('click', (event) => {
    if (!profileMenu.hidden && !event.target.closest('#profileArea')) profileMenu.hidden = true;
  });

  menuLogout?.addEventListener('click', async () => {
    await firebase.authModule.signOut(firebase.auth);
    profileMenu.hidden = true;
  });

  if (!firebase) {
    showGuest();
    return;
  }

  firebase.authModule.onAuthStateChanged(firebase.auth, (user) => {
    if (user) showUser(user);
    else showGuest();
  });
}

(async () => {
  try {
    const firebase = await initFirebase();
    if (firebase) window.MGHubFirebase = firebase;
    setProfileUI(firebase);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    setProfileUI(null);
  }
})();

window.MGHub = { searchAnime, animeCard, escapeHtml, initFirebase };
