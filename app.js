// MG Master Hub — shared app logic
const API_BASE='https://api.jikan.moe/v4';
const KITSU_BASE='https://kitsu.io/api/edge';
const ANILIST_BASE='https://graphql.anilist.co';
const FIREBASE_VERSION='12.18.0';
const FIREBASE_CONFIG={apiKey:'AIzaSyBF3jubXpba2GCPszVN-Dip3-OWs_EoUe',authDomain:'hubs-b9c39.firebaseapp.com',projectId:'hubs-b9c39',storageBucket:'hubs-b9c39.firebasestorage.app',messagingSenderId:'699995857695',appId:'1:699995857695:web:240f8598fb4100d7cf462a'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cache=new Map();
const CACHE_MS=120000;
const REQUEST_TIMEOUT=12000;
const MAX_RETRIES=2;
const RETRY_BASE_MS=600;
const inflight=new Map();

class ApiError extends Error{constructor(message,status=0,provider='api',cause){super(message);this.name='ApiError';this.status=status;this.provider=provider;this.cause=cause}}

function retryableStatus(status){return status===408||status===429||status>=500}
function retryDelay(response,attempt){
  const raw=response?.headers?.get?.('Retry-After');
  if(raw){
    const numeric=Number(raw);
    if(Number.isFinite(numeric))return Math.min(Math.max(numeric*1000,400),10000);
    const when=Date.parse(raw);
    if(Number.isFinite(when))return Math.min(Math.max(when-Date.now(),400),10000);
  }
  return Math.min(RETRY_BASE_MS*Math.pow(2,attempt)+Math.floor(Math.random()*250),6000);
}

async function requestJson(url,options={},provider='api'){
  const cacheKey=`json:${provider}:${options.method||'GET'}:${url}:${options.body||''}`;
  if(inflight.has(cacheKey))return inflight.get(cacheKey);
  const task=(async()=>{
    let lastError=null;
    for(let attempt=0;attempt<=MAX_RETRIES;attempt++){
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
      try{
        const r=await fetch(url,{...options,signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
        if(retryableStatus(r.status)&&attempt<MAX_RETRIES){await sleep(retryDelay(r,attempt));continue}
        if(!r.ok)throw new ApiError(`HTTP ${r.status}`,r.status,provider);
        try{return await r.json()}catch(e){throw new ApiError('Invalid JSON response',r.status,provider,e)}
      }catch(e){
        lastError=e instanceof ApiError?e:new ApiError(e?.name==='AbortError'?'Request timed out':(e?.message||'Network request failed'),e?.name==='AbortError'?408:0,provider,e);
        if(attempt<MAX_RETRIES && (!lastError.status||retryableStatus(lastError.status))){await sleep(Math.min(RETRY_BASE_MS*Math.pow(2,attempt)+Math.floor(Math.random()*250),6000));continue}
      }finally{clearTimeout(timer)}
    }
    throw lastError||new ApiError('Request failed',0,provider);
  })();
  inflight.set(cacheKey,task);
  try{return await task}finally{inflight.delete(cacheKey)}
}

function cached(key){const hit=cache.get(key);return hit&&Date.now()-hit.time<CACHE_MS?hit.data:null}
function setCached(key,data){cache.set(key,{time:Date.now(),data})}

function canonicalId(malId,provider,id,title='unknown'){
  if(malId!=null)return `anime:mal:${malId}`;
  if(id!=null)return `anime:${provider}:${id}`;
  return `anime:${provider}:${String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'unknown'}`;
}
function imageUrl(item){return item||''}
function normalizedBase({malId=null,anilistId=null,kitsuId=null,title='',englishTitle=null,japaneseTitle=null,image='',score=null,year='—',type='Anime',status='Unknown',synopsis='',genres=[],episodes=null,duration=null,airedFrom=null,airedTo=null,nextEpisodeAt=null,nextEpisode=null,provider='unknown'}){
  return{ id:canonicalId(malId,provider,anilistId??kitsuId,title),malId,anilistId,kitsuId,title:title||'Unknown title',englishTitle:englishTitle||null,japaneseTitle:japaneseTitle||null,image:imageUrl(image),score:Number.isFinite(Number(score))?Number(score):null,year:year??'—',type:type||'Anime',status:status||'Unknown',synopsis:synopsis||'',genres:Array.isArray(genres)?genres.map(g=>typeof g==='string'?g:(g?.name||'')).filter(Boolean):[],episodes:episodes??null,duration:duration??null,airedFrom,airedTo,nextEpisodeAt:nextEpisodeAt??null,nextEpisode:nextEpisode??null,provider};
}

function normalizeJikan(item){
  const a=item||{},title=a.title||a.title_japanese||'Unknown title';
  return normalizedBase({malId:a.mal_id??null,title,englishTitle:a.title_english??null,japaneseTitle:a.title_japanese??null,image:a.images?.jpg?.large_image_url||a.images?.jpg?.image_url||'',score:a.score,year:a.year??a.aired?.prop?.from?.year??(a.aired?.from?a.aired.from.slice(0,4):'—'),type:a.type,status:a.status,synopsis:a.synopsis,genres:a.genres,episodes:a.episodes,duration:a.duration,airedFrom:a.aired?.from??null,airedTo:a.aired?.to??null,provider:'jikan'});
}
function normalizeAniList(item){
  const t=item?.title||{},start=item?.startDate||{},end=item?.endDate||{};
  const date=(d)=>d?.year?`${d.year}-${String(d.month||1).padStart(2,'0')}-${String(d.day||1).padStart(2,'0')}`:null;
  return normalizedBase({malId:item?.idMal??null,anilistId:item?.id??null,title:t.romaji||t.english||t.native||'Unknown title',englishTitle:t.english||null,japaneseTitle:t.native||null,image:item?.coverImage?.extraLarge||item?.coverImage?.large||item?.coverImage?.medium||'',score:item?.averageScore?item.averageScore/10:null,year:start?.year??'—',type:item?.format,status:item?.status==='RELEASING'?'Currently Airing':item?.status==='FINISHED'?'Finished Airing':item?.status,synopsis:item?.description,genres:item?.genres,episodes:item?.episodes,duration:item?.duration,airedFrom:date(start),airedTo:date(end),nextEpisodeAt:item?.nextAiringEpisode?.airingAt?item.nextAiringEpisode.airingAt*1000:null,nextEpisode:item?.nextAiringEpisode?.episode??null,provider:'anilist'});
}
function normalizeKitsu(item){
  const a=item?.attributes||{},t=a.titles||{},title=t.en||t.en_jp||t.ja_jp||t.en_us||a.canonicalTitle||'Unknown title';
  return normalizedBase({kitsuId:item?.id??null,title,englishTitle:t.en||null,japaneseTitle:t.ja_jp||null,image:a.posterImage?.large||a.posterImage?.medium||a.posterImage?.small||'',score:a.averageRating?Number(a.averageRating)/10:null,year:a.startDate?.slice?.(0,4)||'—',type:a.subtype||'Anime',status:a.status==='current'?'Currently Airing':(a.status||'Unknown'),synopsis:a.synopsis,genres:(a.genres||[]),episodes:a.episodeCount,duration:a.episodeLength,airedFrom:a.startDate||null,airedTo:a.endDate||null,provider:'kitsu'});
}

const ANILIST_FIELDS=`id idMal title{romaji english native} coverImage{extraLarge large medium} averageScore format status description genres episodes duration startDate{year month day} endDate{year month day}`;
async function requestAniList(mode='popular',value=''){
  let variables={page:1,perPage:12};
  let args='type: ANIME, isAdult: false, sort: POPULARITY_DESC';
  if(mode==='search'){variables.search=value;args='type: ANIME, search: $search, isAdult: false, sort: SEARCH_MATCH_DESC'}
  else if(mode==='trending')args='type: ANIME, isAdult: false, sort: TRENDING_DESC';
  else if(mode==='airing')args='type: ANIME, status: RELEASING, isAdult: false, sort: NEXT_AIRING_DESC';
  const airing=mode==='airing'?' nextAiringEpisode{airingAt episode}':'';
  const query=`query($page:Int,$perPage:Int${mode==='search'?', $search:String'}){Page(page:$page,perPage:$perPage){media(${args}){${ANILIST_FIELDS}${airing}}}}`;
  const json=await requestJson(ANILIST_BASE,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,variables})},'AniList');
  if(json.errors?.length)throw new ApiError(json.errors[0].message||'AniList error',200,'AniList');
  return Array.isArray(json.data?.Page?.media)?json.data.Page.media.map(normalizeAniList):[];
}
async function requestKitsu(path=''){
  const q=new URLSearchParams(path.split('?')[1]||'');
  let url=`${KITSU_BASE}/anime?page[limit]=12`;
  const query=q.get('q');
  if(query)url+=`&filter[text]=${encodeURIComponent(query)}`;
  else if(path.includes('/top/anime'))url+='&sort=-userCount';
  else url+='&filter[status]=current&sort=-startDate';
  const json=await requestJson(url,{},'Kitsu');
  return Array.isArray(json.data)?json.data.map(normalizeKitsu):[];
}
function providerFallbackable(error){return !error?.status||error.status===408||error.status===429||error.status>=500||error.status===204}

async function requestJikan(path){
  const key=`anime:${path}`;
  const hit=cached(key);if(hit)return hit;
  let jikanError=null;
  try{
    const json=await requestJson(`${API_BASE}${path}`,{},'Jikan');
    const data=Array.isArray(json.data)?json.data.map(normalizeJikan):[];
    if(data.length){setCached(key,data);return data}
    jikanError=new ApiError('Jikan returned no results',204,'Jikan');
  }catch(e){jikanError=e;console.warn('Jikan unavailable:',e)}
  if(!providerFallbackable(jikanError))throw jikanError;
  const params=new URLSearchParams(path.split('?')[1]||'');
  const isSearch=params.has('q'),mode=isSearch?'search':path.includes('/top/anime')?'trending':'airing',value=isSearch?params.get('q')||'':'';
  let aniError=null;
  try{const data=await requestAniList(mode,value);if(data.length){setCached(key,data);return data}aniError=new ApiError('AniList returned no results',204,'AniList')}catch(e){aniError=e;console.warn('AniList unavailable:',e)}
  if(!providerFallbackable(aniError)&&aniError.status!==200)throw aniError;
  try{const data=await requestKitsu(path);if(data.length){setCached(key,data);return data}throw new ApiError('Kitsu returned no results',204,'Kitsu')}catch(kitsuError){console.error('All anime APIs unavailable:',{jikanError,aniError,kitsuError});throw new ApiError('Anime providers are temporarily unavailable',503,'anime')}
}

async function fetchCountdown(){
  const key='anime:countdown';const hit=cached(key);if(hit)return hit;
  try{const data=await requestAniList('airing');const useful=data.filter(a=>a.nextEpisodeAt);if(useful.length){setCached(key,useful);return useful}}catch(e){console.warn('AniList countdown unavailable:',e)}
  return [];
}
const searchAnime=q=>{const query=String(q||'').trim();return query?requestJikan(`/anime?q=${encodeURIComponent(query)}&limit=12&sfw=true`):Promise.resolve([])};
const fetchJikan=requestJikan;
function getAnimeId(a){return a?.id||((a?.malId!=null)?`anime:mal:${a.malId}`:`anime:unknown:${String(a?.title||'').toLowerCase()}`)}
function escapeHtml(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]))}
function animeCard(a,extra=''){
  const item=a&&typeof a==='object'?a:{},image=item.image||item.images?.jpg?.large_image_url||item.images?.jpg?.image_url||'',title=item.englishTitle||item.title||'Unknown title',year=item.year||'—',score=Number.isFinite(Number(item.score))?String(item.score):'—';
  const img=image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.onerror=null;this.removeAttribute('src');this.alt='Anime poster unavailable';">`:'<div class="anime-card-image" aria-label="Anime poster unavailable">🎌</div>';
  return `<article class="anime-card">${img}<div class="anime-card-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(year)} · ⭐ ${escapeHtml(score)}</p><p>${escapeHtml(item.type||'Anime')} · ${escapeHtml(item.status||'Unknown')}</p>${typeof extra==='string'?extra:''}</div></article>`;
}

let firebasePromise;
async function initFirebase(){
  if(firebasePromise)return firebasePromise;
  firebasePromise=(async()=>{
    const{initializeApp}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const firestoreModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    const app=initializeApp(FIREBASE_CONFIG),auth=authModule.getAuth(app),db=firestoreModule.getFirestore(app);
    return{...authModule,...firestoreModule,app,auth,db};
  })();
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
  document.addEventListener('click',click);if(firebase?.auth&&firebase.onAuthStateChanged)unsubscribe=firebase.onAuthStateChanged(firebase.auth,u=>{current=u||null;u?user(u):guest()});else guest();setProfileUI._cleanup=()=>{document.removeEventListener('click',click);unsubscribe?.()};
}

async function getCurrentUser(){const f=await initFirebase();if(!f?.auth)return null;return f.auth.currentUser||await new Promise(resolve=>{let stop;stop=f.onAuthStateChanged(f.auth,u=>{stop();resolve(u||null)})})}
async function saveSubscription(subscription){
  const f=await initFirebase();const user=f?.auth?.currentUser;if(!user)throw new ApiError('Login required',401,'Firebase');
  const id=String(subscription.id||'').replace(/[^A-Za-z0-9:_-]/g,'_').slice(0,120);if(!id)throw new ApiError('Invalid anime id',400,'Firebase');
  const data={...subscription,id,updated:new Date().toISOString()};
  await f.setDoc(f.doc(f.db,'users',user.uid,'subscriptions',id),data,{merge:true});
  return data;
}
async function deleteSubscription(id){const f=await initFirebase();const user=f?.auth?.currentUser;if(!user)throw new ApiError('Login required',401,'Firebase');await f.deleteDoc(f.doc(f.db,'users',user.uid,'subscriptions',String(id).replace(/[^A-Za-z0-9:_-]/g,'_').slice(0,120)))}
async function loadSubscriptions(){const f=await initFirebase();const user=f?.auth?.currentUser;if(!user)return[];const snap=await f.getDocs(f.collection(f.db,'users',user.uid,'subscriptions'));return snap.docs.map(d=>d.data())}
async function savePreferences(preferences){const f=await initFirebase();const user=f?.auth?.currentUser;if(!user)throw new ApiError('Login required',401,'Firebase');await f.setDoc(f.doc(f.db,'users',user.uid,'preferences','settings'),{...preferences,updated:new Date().toISOString()},{merge:true})}
async function loadPreferences(){const f=await initFirebase();const user=f?.auth?.currentUser;if(!user)return{};const snap=await f.getDoc(f.doc(f.db,'users',user.uid,'preferences','settings'));return snap.exists()?snap.data():{}}

window.MGHub={searchAnime,fetchJikan,fetchCountdown,animeCard,getAnimeId,escapeHtml,initFirebase,getCurrentUser,saveSubscription,deleteSubscription,loadSubscriptions,savePreferences,loadPreferences};
window.MGHubReady=initFirebase().then(f=>{window.MGHubFirebase=f;setProfileUI(f);return f}).catch(e=>{console.error(e);setProfileUI(null);return null});
export{searchAnime,fetchJikan,fetchCountdown,animeCard,getAnimeId,escapeHtml,initFirebase,getCurrentUser,saveSubscription,deleteSubscription,loadSubscriptions,savePreferences,loadPreferences};
