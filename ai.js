const FIREBASE_VERSION='12.18.0';
const FIREBASE_CONFIG={apiKey:'AIzaSyBF3jubXpba2GCPszVN-Dip3-OWs_EoUe',authDomain:'hubs-b9c39.firebaseapp.com',projectId:'hubs-b9c39',storageBucket:'hubs-b9c39.firebasestorage.app',messagingSenderId:'699995857695',appId:'1:699995857695:web:240f8598fb4100d7cf462a'};
const AI_ENDPOINT='https://us-central1-hubs-b9c39.cloudfunctions.net/aiChat';
let authPromise;
const history=[];

async function getAuth(){
  if(authPromise)return authPromise;
  authPromise=(async()=>{
    const {initializeApp}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const {getAuth,onAuthStateChanged}=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const app=initializeApp(FIREBASE_CONFIG,'mg-ai-helper');
    const auth=getAuth(app);
    const user=auth.currentUser||await new Promise(resolve=>{const stop=onAuthStateChanged(auth,u=>{stop();resolve(u||null)})});
    return {auth,user};
  })();
  return authPromise;
}

const chat=document.getElementById('chat');
const form=document.getElementById('composer');
const input=document.getElementById('message');
const sendBtn=document.getElementById('sendBtn');

function addBubble(role,text){
  const el=document.createElement('div');
  el.className=`bubble ${role}`;
  el.textContent=text;
  chat.appendChild(el);
  chat.scrollTop=chat.scrollHeight;
  return el;
}
function setBusy(busy){sendBtn.disabled=busy;input.disabled=busy;sendBtn.textContent=busy?'…':'Send'}

async function sendMessage(message){
  const {user}=await getAuth();
  if(!user)throw new Error('Please log in to use AI Helper.');
  const token=await user.getIdToken();
  const response=await fetch(AI_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({message,history:history.slice(-8)})});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok)throw new Error(data.error||`AI request failed (${response.status})`);
  if(!data.reply)throw new Error('The AI returned an empty response.');
  return data.reply;
}

addBubble('system','Hi! I’m MG AI Helper. Log in and ask me about school, coding, electronics, projects or anything you’re learning.');

form.addEventListener('submit',async event=>{
  event.preventDefault();
  const message=input.value.trim();
  if(!message)return;
  addBubble('user',message);history.push({role:'user',content:message});input.value='';setBusy(true);
  const typing=addBubble('assistant','');typing.innerHTML='<span class="typing" aria-label="AI is thinking"><i></i><i></i><i></i></span>';
  try{
    const reply=await sendMessage(message);
    typing.textContent=reply;
    history.push({role:'assistant',content:reply});
  }catch(error){
    typing.remove();
    addBubble('system',error?.message||'Something went wrong. Please try again.');
    history.pop();
  }finally{setBusy(false);input.focus()}
});

input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit()}});
