const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {defineSecret}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {getMessaging}=require('firebase-admin/messaging');

initializeApp();
const openaiApiKey=defineSecret('OPENAI_API_KEY');
const ALLOWED_ORIGIN='https://mainakgarai007.github.io';
const MODEL='gpt-5.6-luna';
const MAX_MESSAGE=4000;
const MAX_HISTORY=8;
const JIKAN='https://api.jikan.moe/v4';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function cors(res,origin){
  const allowed=origin===ALLOWED_ORIGIN||origin==='http://localhost:5000'||origin==='http://127.0.0.1:5000';
  if(allowed)res.set('Access-Control-Allow-Origin',origin);
  res.set('Vary','Origin');
  res.set('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods','POST, OPTIONS');
  res.set('Cache-Control','no-store');
  return allowed;
}
function cleanHistory(value){
  if(!Array.isArray(value))return [];
  return value.slice(-MAX_HISTORY).filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').map(item=>({role:item.role,content:item.content.slice(0,4000)}));
}
function extractText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();
  const parts=[];
  for(const item of data?.output||[])for(const content of item?.content||[])if(typeof content?.text==='string')parts.push(content.text);
  return parts.join('\n').trim();
}

exports.aiChat=onRequest({region:'us-central1',timeoutSeconds:60,secrets:[openaiApiKey],maxInstances:3},async(req,res)=>{
  const origin=req.get('origin')||'';const allowed=cors(res,origin);
  if(req.method==='OPTIONS')return res.status(allowed?204:403).send('');
  if(!allowed)return res.status(403).json({error:'Origin not allowed.'});
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  try{
    const authorization=req.get('authorization')||'';
    if(!authorization.startsWith('Bearer '))return res.status(401).json({error:'Please log in first.'});
    const token=authorization.slice(7).trim();if(!token)return res.status(401).json({error:'Please log in first.'});
    await getAuth().verifyIdToken(token);
    const message=typeof req.body?.message==='string'?req.body.message.trim():'';
    if(!message)return res.status(400).json({error:'Message is required.'});
    if(message.length>MAX_MESSAGE)return res.status(400).json({error:`Message is too long. Keep it under ${MAX_MESSAGE} characters.`});
    const history=cleanHistory(req.body?.history);
    const input=[...history,{role:'user',content:message}].map(item=>({role:item.role,content:[{type:'input_text',text:item.content}]}));
    const apiResponse=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiApiKey.value()}`},body:JSON.stringify({model:MODEL,instructions:'You are MG AI Helper inside MG Master Hub. Be helpful, concise, friendly and accurate. Explain school concepts clearly, help with coding and electronics safely, and support creative projects. Keep responses age-appropriate. Never provide instructions that facilitate dangerous activities, weapons, drugs, self-harm, or other unsafe behavior. If a question needs current facts, say that you may need a current source rather than inventing details. Do not claim you performed actions you did not perform.',input,max_output_tokens:1200})});
    const data=await apiResponse.json().catch(()=>({}));
    if(!apiResponse.ok){console.error('OpenAI request failed',apiResponse.status,data?.error?.code||data?.error?.type||'unknown');return res.status(apiResponse.status===429?429:502).json({error:'AI service is temporarily unavailable. Please try again.'});}
    const reply=extractText(data);if(!reply)return res.status(502).json({error:'AI returned an empty response.'});
    return res.status(200).json({reply,model:MODEL});
  }catch(error){
    console.error('aiChat error',error?.code||error?.message||'unknown');
    if(error?.code==='auth/argument-error'||error?.code==='auth/id-token-expired'||error?.code==='auth/invalid-id-token')return res.status(401).json({error:'Your login session expired. Please log in again.'});
    return res.status(500).json({error:'Something went wrong. Please try again.'});
  }
});

async function jikan(path){const r=await fetch(`${JIKAN}${path}`,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`Jikan ${r.status}`);return r.json()}
function tokenId(token){return String(token).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,140)}
function titleOf(sub,data){return data?.title_english||data?.title||sub?.title||'Anime'}
function prefsOf(data){return{enabled:data?.enabled===true,episodes:data?.episodes!==false,news:data?.news===true,status:data?.status!==false}}
async function sendToTokens(tokens,title,body,url,tag){if(!tokens.length)return[];const result=await getMessaging().sendEachForMulticast({tokens,notification:{title,body},data:{url,tag}});return result.responses.map((r,i)=>!r.success&&['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)?tokens[i]:null).filter(Boolean)}

exports.checkAnimeNotifications=onSchedule({schedule:'every 30 minutes',timeZone:'Asia/Kolkata',region:'us-central1',timeoutSeconds:540,memory:'256MiB'},async()=>{
  const db=getFirestore();const users=await db.collection('users').get();
  for(const userDoc of users.docs){
    const prefSnap=await db.doc(`users/${userDoc.id}/profile/notificationPreferences`).get();const prefs=prefsOf(prefSnap.data());if(!prefs.enabled)continue;
    const tokenSnap=await db.collection(`users/${userDoc.id}/notificationTokens`).get();const tokens=tokenSnap.docs.map(d=>d.data()?.token).filter(Boolean).slice(0,50);if(!tokens.length)continue;
    const subs=await db.collection(`users/${userDoc.id}/subscriptions`).get();
    for(const subDoc of subs.docs){
      const sub=subDoc.data();const malId=Number(sub.malId||String(sub.id||'').replace('anime:mal:',''));if(!Number.isInteger(malId)||malId<1)continue;
      try{
        await sleep(800);const detail=(await jikan(`/anime/${malId}/full`)).data||{};const name=titleOf(sub,detail);const currentEp=Number(detail.episodes);const currentStatus=String(detail.status||'Unknown');const state=sub.notificationState||{};
        const update={notificationState:{...state,lastCheckedAt:new Date().toISOString()}};
        if(state.baselined!==true){update.notificationState={...update.notificationState,baselined:true,lastEpisode:Number.isFinite(currentEp)?currentEp:null,lastStatus:currentStatus};}
        else{
          if(prefs.episodes&&Number.isFinite(currentEp)&&Number.isFinite(Number(state.lastEpisode))&&currentEp>Number(state.lastEpisode)){
            const old=Number(state.lastEpisode);const body=currentEp-old===1?`Episode ${currentEp} is now available.`:`Episodes ${old+1}–${currentEp} are now available.`;await sendToTokens(tokens,`📺 ${name}`,body,`/Hub/anime-detail.html?id=${malId}`,`episode-${malId}-${currentEp}`);
          }
          if(prefs.status&&currentStatus!==String(state.lastStatus||''))await sendToTokens(tokens,`📌 ${name}`,`Status changed to ${currentStatus}.`,`/Hub/anime-detail.html?id=${malId}`,`status-${malId}-${currentStatus}`);
          update.notificationState={...update.notificationState,lastEpisode:Number.isFinite(currentEp)?currentEp:state.lastEpisode,lastStatus:currentStatus};
        }
        if(prefs.news){
          await sleep(800);const news=(await jikan(`/anime/${malId}/news?limit=3`)).data||[];const latest=news[0];const key=latest?.url||latest?.mal_id||null;
          if(key&&state.lastNewsKey&&key!==state.lastNewsKey)await sendToTokens(tokens,`📰 ${name}`,latest.title||'New anime news is available.`,`/Hub/anime-pulse.html`,`news-${malId}-${tokenId(key)}`);
          if(key)update.notificationState={...update.notificationState,lastNewsKey:key};
        }
        await subDoc.ref.set(update,{merge:true});
      }catch(error){console.error('Anime notification check failed',userDoc.id,subDoc.id,error?.message||error)}
    }
  }
});
