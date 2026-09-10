// MG Master Hub — shared app logic
const API_BASE='https://api.jikan.moe/v4';
const KITSU_BASE='https://kitsu.io/api/edge';
const ANILIST_BASE='https://graphql.anilist.co';
const FIREBASE_VERSION='12.18.0';
const FIREBASE_CONFIG={apiKey:'AIzaSyBF3jubXpba2G8CPszVN-Dip3-OWs_EUoE',authDomain:'hubs-b9c39.firebaseapp.com',projectId:'hubs-b9c39',storageBucket:'hubs-b9c39.firebasestorage.app',messagingSenderId:'699995857695',appId:'1:699995857695:web:240f8598fb4100d7cf462a'};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cache=new Map();
const CACHE_MS=120000;

async function requestJson(url,options={},attempt=0){
  const r=await fetch(url,{...options,headers:{Accept:'application/json',...(options.headers||{})}});
  if((r.status===429||r.status>=500)&&attempt<1){
    const retry=Number(r.headers.get('Retry-After'))||2;
    await sleep(Math.min(Math.max(retry*1000,1200),5000));
    return requestJson(url,options,attempt+1);
  }
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function normalizeKitsu(item){
  const a=item?.attributes||{},t=a.titles||{},poster=a.posterImage?.large||a.posterImage?.medium||a.posterImage?.small||'';
  const start=a.startDate||null;
  return{mal_id:`kitsu-${item.id}`,title:t.en||t.en_jp||t.ja_jp||Object.values(t)[0]||'Unknown title',title_english:t.en||null,year:start?start.slice(0,4):'—',score:a.averageRating?Number((Number(a.averageRating)/10).toFixed(2)):null,type:a.subtype||'Anime',status:a.status==='current'?'Currently Airing':(a.status||'Unknown'),images:{jpg:{large_image_url:poster,image_url:poster}},aired:{from:start},_source:'kitsu'};
}

function normalizeAniList(item){
  const title=item?.title||{},start=item?.startDate;
  const date=start?.year?`${start.year}-${String(start.month||1).padStart(2,'0')}-${String(start.day||1).padStart(2,'0')}`:null;
  return{mal_id:`anilist-${item.id}`,title:title.english||title.romaji||title.native||'Unknown title',title_english:title.english||null,year:start?.year||'—',score:item.averageScore?Number((item.averageScore/10).toFixed(2)):null,type:item.format||'Anime',status:item.status==='RELEASING'?'Currently Airing':item.status==='FINISHED'?'Finished Airing':(item.status||'Unknown'),images:{jpg:{large_image_url:item.coverImage?.extraLarge||item.coverImage?.large||item.coverImage?.medium||'',image_url:item.coverImage?.large||item.coverImage?.medium||''}},aired:{from:date},_source:'anilist',anilist_id:item.id};
}

async function requestAniList(mode,value=''){
  let variables={page:1,perPage:12};
  let mediaArgs='type: ANIME, isAdult: false, sort: POPULARITY_DESC';
  if(mode==='search'){variables.search=value;mediaArgs='type: ANIME, search: $search, isAdult: false, sort: SEARCH_MATCH_DESC';}
  if(mode==='trending')mediaArgs='type: ANIME, isAdult: false, sort: TRENDING_DESC';
  if(mode==='airing')mediaArgs='type: ANIME, status: RELEASING, isAdult: false, sort: START_DATE_DESC';
  const query=`query($page:Int,$perPage:Int${mode==='search'?', $search:String'}){Page(page:$page,perPage:$perPage){media(${mediaArgs}){id title{romaji english native}coverImage{extraLarge large medium}averageScore format status startDate{year month day}}}}`;
  const json=await requestJson(ANILIST_BASE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})});
  if(json.errors?.length)throw new Error(json.errors[0].message||'AniList error');
  return Array.isArray(json.data?.Page?.media)?json.data.Page.media.map(normalizeAniList):[];
}

async function requestKitsu(path){
  const q=new URLSearchParams(path.split('?')[1]||'');
  let url=`${KITSU_BASE}/anime?page[limit]=12`;
  const query=q.get('q');
  if(query)url+=`&filter[text]=${encodeURIComponent(query)}`;
  else if(path.includes('/top/anime'))url+='&sort=-userCount';
  else url+='&filter[status]=current&sort=-startDate';
  const json=await requestJson(url);
  return Array.isArray(json.data)?json.data.map(normalizeKitsu):[];
}

async function requestJikan(path){
  const key=`anime:${path}`;
  const hit=cache.get(key);
  if(hit&&Date.now()-hit.time<CACHE_MS)return hit.data;
  try{
    const json=await requestJson(`${API_BASE}${path}`);
    const data=Array.isArray(json.data)?json.data:[];
    cache.set(key,{time:Date.now(),data});
    return data;
  }catch(jikanError){
    console.warn('Jikan unavailable:',jikanError);
    try{
      const isSearch=new URLSearchParams(path.split('?')[1]||'').has('q');
      const data=await requestAniList(isSearch?'search':path.includes('/top/anime')?'trending':'airing',isSearch?new URLSearchParams(path.split('?')[1]).get('q')||'':'');
      cache.set(key,{time:Date.now(),data});
      return data;
    }catch(aniError){
      console.warn('AniList unavailable:',aniError);
      try{
        const data=await requestKitsu(path);
        cache.set(key,{time:Date.now(),data});
        return data;
      }catch(kitsuError){
        console.error('All anime APIs unavailable:',{jikanError,aniError,kitsuError});
        throw new Error('Anime APIs unavailable');
      }
    }
  }
}

const searchAnime=q=>{const query=String(q||'').trim();return query?requestJikan(`/anime?q=${encodeURIComponent(query)}&limit=12&sfw=true`):Promise.resolve([])};
const fetchJikan=requestJikan;
function escapeHtml(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]))}
function animeCard(a,extra=''){
  const item=a&&typeof a==='object'?a:{};
  const image=item.images?.jpg?.large_image_url||item.images?.jpg?.image_url||'';
  const title=item.title_english||item.title||'Unknown title';
  const year=item.year||item.aired?.from?.slice?.(0,4)||'—';
  const score=Number.isFinite(Number(item.score))?String(item.score):'—';
  return `<article class="anime-card"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"><div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(year)} · ⭐ ${escapeHtml(score)}</p><p>${escapeHtml(item.type||'Anime')} · ${escapeHtml(item.status||'Unknown')}</p>${typeof extra==='string'?extra:''}</div></article>`;
}

let firebasePromise;
async function initFirebase(){
  if(firebasePromise)return firebasePromise;
  firebasePromise=(async()=>{const{initializeApp}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);const authModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);const app=initializeApp(FIREBASE_CONFIG);return{...authModule,app,auth:authModule.getAuth(app)}})();
  return firebasePromise;
}
function setProfileUI(firebase){
  try{setProfileUI._cleanup?.()}catch(e){}
  const button=document.getElementById('profileButton'),avatar=document.getElementById('profileAvatar'),fallback=document.getElementById('avatarFallback'),name=document.getElementById('profileName'),menu=document.getElementById('profileMenu'),menuAvatar=document.getElementById('menuAvatar'),menuName=document.getElementById('menuName'),menuEmail=document.getElementById('menuEmail'),logout=document.getElementById('menuLogout'),loginCta=document.getElementById('loginCta'),profileArea=document.getElementById('profileArea');
  if(!button)return;
  const text=(el,v)=>{if(el)el.textContent=v};
  const guest=()=>{button.href='login.html';text(name,'Login');if(avatar){avatar.hidden=true;avatar.removeAttribute('src')}if(fallback)fallback.hidden=false;if(menuAvatar){menuAvatar.hidden=true;menuAvatar.removeAttribute('src')}text(menuName,'Guest');text(menuEmail,'Not signed in');if(logout)logout.hidden=true;if(loginCta)loginCta.hidden=false;if(menu)menu.hidden=true};
  const user=u=>{button.href='#';text(name,u?.displayName||u?.email?.split('@')[0]||'Account');text(menuName,u?.displayName||'My account');text(menuEmail,u?.email||'');if(logout)logout.hidden=false;if(loginCta)loginCta.hidden=true;if(u?.photoURL){if(avatar){avatar.src=u.photoURL;avatar.hidden=false}if(fallback)fallback.hidden=true;if(menuAvatar){menuAvatar.src=u.photoURL;menuAvatar.hidden=false}}else{if(avatar){avatar.hidden=true;avatar.removeAttribute('src')}if(fallback)fallback.hidden=false;if(menuAvatar){menuAvatar.hidden=true;menuAvatar.removeAttribute('src')}}};
  let current=null,unsubscribe=null;
  const click=async e=>{const t=e.target;if(t.closest('#menuLogout')){e.preventDefault();try{await firebase?.signOut?.(firebase.auth)}catch(err){console.error(err)}if(menu)menu.hidden=true;return}if(t.closest('#profileButton')&&current){e.preventDefault();if(menu)menu.hidden=!menu.hidden;return}if(menu&&!menu.hidden&&profileArea&&!t.closest('#profileArea'))menu.hidden=true};
  document.addEventListener('click',click);
  if(firebase?.auth&&firebase.onAuthStateChanged)unsubscribe=firebase.onAuthStateChanged(firebase.auth,u=>{current=u||null;u?user(u):guest()});else guest();
  setProfileUI._cleanup=()=>{document.removeEventListener('click',click);unsubscribe?.()};
}
window.MGHub={searchAnime,fetchJikan,animeCard,escapeHtml,initFirebase};
window.MGHubReady=initFirebase().then(f=>{window.MGHubFirebase=f;setProfileUI(f);return f}).catch(e=>{console.error(e);setProfileUI(null);return null});
export{searchAnime,fetchJikan,animeCard,escapeHtml,initFirebase};
