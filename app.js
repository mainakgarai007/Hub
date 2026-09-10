// MG Master Hub — client foundation
const API_BASE = 'https://api.jikan.moe/v4';

const $ = (selector) => document.querySelector(selector);

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
    <img src="${image}" alt="" loading="lazy">
    <div><h3>${escapeHtml(title)}</h3><p>${year} · ⭐ ${score}</p><p>${escapeHtml(anime.type || 'Anime')} · ${escapeHtml(anime.status || 'Unknown')}</p></div>
  </article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

window.MGHub = { searchAnime, animeCard, escapeHtml };
