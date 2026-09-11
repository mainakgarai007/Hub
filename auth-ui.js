// MG Master Hub — shared account/profile UI
const FIREBASE_VERSION='12.18.0';
const FIREBASE_CONFIG={apiKey:'AIzaSyBF3jubXpba2G8CPszVN-Dip3-OWs_EUoE',authDomain:'hubs-b9c39.firebaseapp.com',projectId:'hubs-b9c39',storageBucket:'hubs-b9c39.firebasestorage.app',messagingSenderId:'699995857695',appId:'1:699995857695:web:240f8598fb4100d7cf462a'};

async function startAccountUI(){
  const button=document.getElementById('profileButton');
  if(!button)return;
  const avatar=document.getElementById('profileAvatar');
  const fallback=document.getElementById('avatarFallback');
  const name=document.getElementById('profileName');
  const menu=document.getElementById('profileMenu');
  const menuAvatar=document.getElementById('menuAvatar');
  const menuName=document.getElementById('menuName');
  const menuEmail=document.getElementById('menuEmail');
  const logout=document.getElementById('menuLogout');
  const loginCta=document.getElementById('loginCta');
  const profileArea=document.getElementById('profileArea');

  const appModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
  const authModule=await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
  const app=appModule.getApps().length?appModule.getApps()[0]:appModule.initializeApp(FIREBASE_CONFIG);
  const auth=authModule.getAuth(app);

  const text=(el,value)=>{if(el)el.textContent=value};
  const setImage=(el,url)=>{if(!el)return;if(url){el.src=url;el.hidden=false}else{el.hidden=true;el.removeAttribute('src')}};
  const setCta=(visible)=>{if(!loginCta)return;loginCta.hidden=!visible;loginCta.style.display=visible?'':'none'};
  const guest=()=>{
    button.href='login.html';
    text(name,'Login');
    setImage(avatar,null);
    if(fallback)fallback.hidden=false;
    setImage(menuAvatar,null);
    text(menuName,'Guest');
    text(menuEmail,'Not signed in');
    if(logout)logout.hidden=true;
    setCta(true);
  };
  const signedIn=user=>{
    const displayName=user.displayName||user.email?.split('@')[0]||'Account';
    button.href='#';
    text(name,displayName);
    text(menuName,displayName);
    text(menuEmail,user.email||'');
    if(user.photoURL){setImage(avatar,user.photoURL);if(fallback)fallback.hidden=true;setImage(menuAvatar,user.photoURL)}
    else{setImage(avatar,null);if(fallback)fallback.hidden=false;setImage(menuAvatar,null)}
    if(logout)logout.hidden=false;
    setCta(false);
  };

  const stop=authModule.onAuthStateChanged(auth,user=>user?signedIn(user):guest());
  const click=async event=>{
    const target=event.target;
    if(target.closest('#menuLogout')){
      event.preventDefault();
      await authModule.signOut(auth);
      if(menu)menu.hidden=true;
      return;
    }
    if(target.closest('#profileButton')&&auth.currentUser){
      event.preventDefault();
      if(menu)menu.hidden=!menu.hidden;
      return;
    }
    if(menu&&!menu.hidden&&profileArea&&!target.closest('#profileArea'))menu.hidden=true;
  };
  document.addEventListener('click',click);
  window.addEventListener('pagehide',()=>{stop();document.removeEventListener('click',click)},{once:true});
}

startAccountUI().catch(error=>{console.error('Account UI failed:',error);const cta=document.getElementById('loginCta');if(cta){cta.hidden=false;cta.style.display=''}});
