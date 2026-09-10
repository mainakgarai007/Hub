const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');

initializeApp();
const openaiApiKey=defineSecret('OPENAI_API_KEY');
const ALLOWED_ORIGIN='https://mainakgarai007.github.io';
const MODEL='gpt-5.6-luna';
const MAX_MESSAGE=4000;
const MAX_HISTORY=8;

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
  for(const item of data?.output||[]){
    for(const content of item?.content||[]){
      if(typeof content?.text==='string')parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

exports.aiChat=onRequest({region:'us-central1',timeoutSeconds:60,secrets:[openaiApiKey],maxInstances:3},async(req,res)=>{
  const origin=req.get('origin')||'';
  const allowed=cors(res,origin);
  if(req.method==='OPTIONS')return res.status(allowed?204:403).send('');
  if(!allowed)return res.status(403).json({error:'Origin not allowed.'});
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});

  try{
    const authorization=req.get('authorization')||'';
    if(!authorization.startsWith('Bearer '))return res.status(401).json({error:'Please log in first.'});
    const token=authorization.slice(7).trim();
    if(!token)return res.status(401).json({error:'Please log in first.'});
    await getAuth().verifyIdToken(token);

    const message=typeof req.body?.message==='string'?req.body.message.trim():'';
    if(!message)return res.status(400).json({error:'Message is required.'});
    if(message.length>MAX_MESSAGE)return res.status(400).json({error:`Message is too long. Keep it under ${MAX_MESSAGE} characters.`});

    const history=cleanHistory(req.body?.history);
    const input=[
      ...history,
      {role:'user',content:message}
    ].map(item=>({role:item.role,content:[{type:'input_text',text:item.content}]}));

    const apiResponse=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiApiKey.value()}`},
      body:JSON.stringify({
        model:MODEL,
        instructions:'You are MG AI Helper inside MG Master Hub. Be helpful, concise, friendly and accurate. Explain school concepts clearly, help with coding and electronics safely, and support creative projects. Keep responses age-appropriate. Never provide instructions that facilitate dangerous activities, weapons, drugs, self-harm, or other unsafe behavior. If a question needs current facts, say that you may need a current source rather than inventing details. Do not claim you performed actions you did not perform.',
        input,
        max_output_tokens:1200
      })
    });

    const data=await apiResponse.json().catch(()=>({}));
    if(!apiResponse.ok){
      console.error('OpenAI request failed',apiResponse.status,data?.error?.code||data?.error?.type||'unknown');
      return res.status(apiResponse.status===429?429:502).json({error:'AI service is temporarily unavailable. Please try again.'});
    }
    const reply=extractText(data);
    if(!reply)return res.status(502).json({error:'AI returned an empty response.'});
    return res.status(200).json({reply,model:MODEL});
  }catch(error){
    console.error('aiChat error',error?.code||error?.message||'unknown');
    if(error?.code==='auth/argument-error'||error?.code==='auth/id-token-expired'||error?.code==='auth/invalid-id-token')return res.status(401).json({error:'Your login session expired. Please log in again.'});
    return res.status(500).json({error:'Something went wrong. Please try again.'});
  }
});
