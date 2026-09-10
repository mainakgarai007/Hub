// MG Master Hub — shared app logic
const API_BASE='https://api.jikan.moe/v4';
const KITSU_BASE='https://kitsu.io/api/edge';
const ANILIST_BASE='https://graphql.anilist.co';
const FIREBASE_VERSION='12.18.0';
const FIREBASE_CONFIG={apiKey:'AIzaSyBF3jubXpba2GCPszVN-Dip3-OWs_EUoE',authDomain:'hubs-b9c39.firebaseapp.com',projectId:'hubs-b9c39',storageBucket:'hubs-b9c39.firebasestorage.app',messagingSenderId:'699995857695',appId:'1:699995857695:web:240f8598fb4100d7cf462a'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cache=new Map();
const CACHE_MS=120000;
const REQUEST_TIMEOUT=12000;
class ApiError extends Error{constructor(message,status=0,provider='api'){super(message);this.name='ApiError';this.status=status;this.provider=provider;}}
async function requestJson(url,options={},attempt=0,provider='api'){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
  try{
    const r=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
    if((r.status===429||r.status>=500)&&attempt<1){
      const raw=r.headers.get('Retry-After');
      const numeric=Number(raw);
      const retry=Number.isFinite(numeric)?numeric:(raw?Math.max(0,(Date.parse(raw)-Date.now())/1000):2);
      await sleep(Math.min(Math.max(retry*1000,1200),5000));
      return requestJson(url,options,attempt+1,provider);
    }
    if(!r.ok)throw new ApiError(`HTTP ${r.status}`,r.status,provider);
    try{return await r.json();}catch{throw new ApiError('Invalid JSON response',r.status,provider);}
  }catch(e){if(e.name==='AbortError')throw new ApiError('Request timed out',408,provider);throw e}
  finally{clearTimeout(timer)}
}
function nextBroadcastTimestamp(day,time){
  if(!day||!time)return null;
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const target=days.indexOf(day);if(target<0)return null;
  const m=String(time).match(/^(\d{1,2}):(\d{2})/);if(!m)return null;
  const now=new Date(),next=new Date(now);next.setHours(Number(m[1]),Number(m[2]),0,0);
  const diff=(target-next.getDay()+7)%7;next.setDate(next.getDate()+diff);if(next<=now)next.setDate(next.getDate()+7);return next.getTime();
}
function normalizeJikan(item){
  const a=item||{},image=a.images?.jpg?.large_image_url||a.images?.jpg?.image_url||'',broadcast=a.broadcast||{};
  return{...a,anime_id:a.mal_id?`mal:${a.mal_id}`:`jikan:${a.mal_id||a.title||Math.random()}`,title:a.title||'Unknown title',title_english:a.title_english||null,year:a.year??a.aired?.prop?.from?.year??(a.aired?.from?a.aired.from.slice(0,4):'—'),score:Number.isFinite(Number(a.score))?Number(a.score):null,images:{jpg:{large_image_url:image,image_url:a.images?.jpg?.image_url||image}},aired:{from:a.aired?.from||null},nextEpisodeAt:nextBroadcastTimestamp(broadcast.day,broadcast.time),_source:'jikan'};
}
function normalizeKitsu(item){
  const a=item?.attributes||{},t=a.titles||{},poster=a.posterImage?.large||a.posterImage?.medium||a.posterImage?.small||'',start=a.startDate||null;
  return{mal_id:null,anime_id:`kitsu:${item?.id||'unknown'}`,kitsu_id:item?.id||null,title:t.en||t.en_jp||t.ja_jp||t.en_us||'Unknown title',title_english:t.en||null,year:start?Number(start.slice(0,4)):'—',score:a.averageRating?Number((Number(a.averageRating)/10).toFixed(2)):null,type:a.subtype||'Anime',status:a.status==='current'?'Currently Airing':(a.status||'Unknown'),images:{jpg:{large_image_url:poster,image_url:poster}},aired:{from:start},nextEpisodeAt:null,_source:'kitsu'};
}
function normalizeAniList(item){
  const title=item?.title||{},start=item?.startDate,date=start?.year?`${start.year}-${String(start.month||1).padStart(2,'0')}-${String(start.day||1).padStart(2,'0')}`:null,malId=item?.idMal||null;
  return{mal_id:malId,anime_id:malId?`mal:${malId}`:`anilist:${item?.id||'unknown'}`,anilist_id:item?.id||null,title:title.english||title.romaji||title.native||'Unknown title',title_english:title.english||null,year:start?.year||'—',score:item.averageScore?Number((item.averageScore/10).toFixed(2)):null,type:item.format||'Anime',status:item.status==='RELEASING'?'Currently Airing':item.status==='FINISHED'?'Finished Airing':(item.status||'Unknown'),images:{jpg:{large_image_url:item.coverImage?.extraLarge||item.coverImage?.large||item.coverImage?.medium||'',image_url:item.coverImage?.large||item.coverImage?.medium||''}},aired:{from:date},nextEpisodeAt:item.nextAiringEpisode?.airingAt?item.nextAiringEpisode.airingAt*1000:null,nextEpisode:item.nextAiringEpisode?.episode||null,_source:'anilist'};
}
async function requestAniList(mode,value=''){
  let variables={page:1,perPage:12},mediaArgs='type: ANIME, isAdult: false, sort: POPULARITY_DESC';
  if(mode==='search'){variables.search=value;mediaArgs='type: ANIME, search: $search, isAdult: false, sort: SEARCH_MATCH_DESC'}
  if(mode==='trending')mediaArgs='type: ANIME, isAdult: false, sort: TRENDING_DESC';
  if(mode==='airing')mediaArgs='type: ANIME, status: RELEASING, isAdult: false, sort: START_DATE_DESC';
  const nextField=mode==='airing'?'nextAiringEpisode{airingAt episode}':'';
  const query=`query($page:Int,$perPage:Int${mode==='search'?', $search:String'}){Page(page:$page,perPage:$perPage){media(${mediaArgs}){id idMal title{romaji english native}coverImage{extraLarge large medium}averageScore format status startDate{year month day}${nextField}}}}`;
  const json=await requestJson(ANILIST_BASE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})},0,'AniList');
  if(json.errors?.length)throw new ApiError(json.errors[0].message||'AniList error',400,'AniList');
  return Array.isArray(json.data?.Page?.media)?json.data.Page.media.map(normalizeAniList):[];
}
async function requestKitsu(path){
  const q=new URLSearchParams(path.split('?')[1]||'');let url=`${KITSU_BASE}/anime?page[limit]=12`,query=q.get('q');
  if(query)url+=`&filter[text]=${encodeURIComponent(query)}`;else if(path.includes('/top/anime'))url+='&sort=-userCount';else url+='&filter[status]=current&sort=-startDate';
  const json=await requestJson(url,{},0,'Kitsu');return Array.isArray(json.data)?json.data.map(normalizeKitsu):[];
}
function shouldFallback(error){return !error?.status||error.status===408||error.status===429||error.status>=500}
async function requestJikan(path){
  const key=`anime:${path}`,hit=cache.get(key);if(hit&&Date.now()-hit.time<CACHE_MS)return hit.data;
  let jikanError=null;
  try{const json=await requestJson(`${API_BASE}${path}`,{},0,'Jikan');const data=Array.isArray(json.data)?json.data.map(normalizeJikan):[];if(data.length){cache.set(key,{time:Date.now(),data});return data}jikanError=new ApiError('Jikan returned no results',204,'Jikan')}catch(e){jikanError=e;console.warn('Jikan unavailable:',e)}
  if(!shouldFallback(jikanError)&&jikanError.status!==204)throw jikanError;
  const params=new URLSearchParams(path.split('?')[1]||''),isSearch=params.has('q'),mode=isSearch?'search':path.includes('/top/anime')?'trending':'airing',value=isSearch?params.get('q')||'':'';
  try{const data=await requestAniList(mode,value);if(data.length){cache.set(key,{time:Date.now(),data});return data}throw new ApiError('AniList returned no results',204,'AniList')}catch(aniError){
    console.warn('AniList unavailable:',aniError);
    try{const data=await requestKitsu(path);if(data.length){cache.set(key,{time:Date.now(),data});return data}throw new ApiError('Kitsu returned no results',204,'Kitsu')}catch(kitsuError){console.error('All anime APIs unavailable:',{jikanError,aniError,kitsuError});throw new ApiError('Anime providers are temporarily unavailable',503,'anime')}
  }
}
async function fetchCountdown(){
  const key='anime:countdown',hit=cache.get(key);if(hit&&Date.now()-hit.time<CACHE_MS)return hit.data;
  try{const data=await requestAniList('airing');if(data.length){cache.set(key,{time:Date.now(),data});return data}}catch(e){console.warn('AniList countdown unavailable:',e)}
  return requestJikan('/anime?status=airing&order_by=popularity&sort=asc&limit=12');
}
const searchAnime=q=>{const query=String(q||'').trim();return query?requestJikan(`/anime?q=${encodeURIComponent(query)}&limit=12&sfw=true`):Promise.resolve([])};
const fetchJikan=requestJikan;
function getAnimeId(a){return a?.anime_id||((a?.mal_id!=null)?`mal:${a.mal_id}`:`unknown:${String(a?.title||'').toLowerCase()}`)}
function escapeHtml(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]))}
function animeCard(a,extra=''){
  const item=a&&typeof a==='object'?a:{},image=item.images?.jpg?.large_image_url||item.images?.jpg?.image_url||'',title=item.title_english||item.title||'Unknown title',year=item.year||item.aired?.from?.slice?.(0,4)||'—',score=Number.isFinite(Number(item.score))?String(item.score):'—';
  return `<article class="anime-card"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.style.display='none'"><div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(year)} · ⭐ ${escapeHtml(score)}</p><p>${escapeHtml(item.type||'Anime')} · ${escapeHtml(item.status||'Unknown')}</p>${typeof extra==='string'?extra:''}</div></article>`;
}
let firebasePromise;
async function initFirebase(){if(firebasePromise)return firebasePromise;firebasePromise=(async()=>{const{initializeApp}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),authModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),app=initializeApp(FIREBASE_CONFIG);return{...authModule,app,auth:authModule.getAuth(app)}})();return firebasePromise}
function setProfileUI(firebase){
  try{setProfileUI._cleanup?.()}catch(e){}
  const button=document.getElementById('profileButton'),avatar=document.getElementById('profileAvatar'),fallback=document.getElementById('avatarFallback'),name=document.getElementById('profileName'),menu=document.getElementById('profileMenu'),menuAvatar=document.getElementById('menuAvatar'),menuName=document.getElementById('menuName'),menuEmail=document.getElementById('menuEmail'),logout=document.getElementById('menuLogout'),loginCta=document.getElementById('loginCta'),profileArea=document.getElementById('profileArea');if(!button)return;
  const text=(el,v)=>{if(el)el.textContent=v};
  const guest=()=>{button.href='login.html';text(name,'Login');if(avatar){avatar.hidden=true;avatar.removeAttribute('src')}if(fallback)fallback.hidden=false;if(menuAvatar){menuAvatar.hidden=true;menuAvatar.removeAttribute('src')}text(menuName,'Guest');text(menuEmail,'Not signed in');if(logout)logout.hidden=true;if(loginCta)loginCta.hidden=false;if(menu)menu.hidden=true};
  const user=u=>{button.href='#';text(name,u?.displayName||u?.email?.split('@')[0]||'Account');text(menuName,u?.displayName||'My account');text(menuEmail,u?.email||'');if(logout)logout.hidden=false;if(loginCta)loginCta.hidden=true;if(u?.photoURL){if(avatar){avatar.src=u.photoURL;avatar.hidden=false}if(fallback)fallback.hidden=true;if(menuAvatar){menuAvatar.src=u.photoURL;menuAvatar.hidden=false}}else{if(avatar){avatar.hidden=true;avatar.removeAttribute('src')}if(fallback)fallback.hidden=false;if(menuAvatar){menuAvatar.hidden=true;menuAvatar.removeAttribute('src')}}};
  let current=null,unsubscribe=null;
  const click=async e=>{const t=e.target;if(t.closest('#menuLogout')){e.preventDefault();try{await firebase?.signOut?.(firebase.auth)}catch(err){console.error(err)}if(menu)menu.hidden=true;return}if(t.closest('#profileButton')&&current){e.preventDefault();if(menu)menu.hidden=!menu.hidden;return}if(menu&&!menu.hidden&&profileArea&&!t.closest('#profileArea'))menu.hidden=true};
  document.addEventListener('click',click);if(firebase?.auth&&firebase.onAuthStateChanged)unsubscribe=firebase.onAuthStateChanged(firebase.auth,u=>{current=u||null;u?user(u):guest()});else guest();setProfileUI._cleanup=()=>{document.removeEventListener('click',click);unsubscribe?.()};
}
window.MGHub={searchAnime,fetchJikan,fetchCountdown,animeCard,getAnimeId,escapeHtml,initFirebase};
window.MGHubReady=initFirebase().then(f=>{window.MGHubFirebase=f;setProfileUI(f);return f}).catch(e=>{console.error(e);setProfileUI(null);return null});
export{searchAnime,fetchJikan,fetchCountdown,animeCard,getAnimeId,escapeHtml,initFirebase};
