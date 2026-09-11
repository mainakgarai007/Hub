importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js','https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:'AIzaSyBF3jubXpba2G8CPszVN-Dip-3OWs_EUoE',
  authDomain:'hubs-b9c39.firebaseapp.com',
  projectId:'hubs-b9c39',
  storageBucket:'hubs-b9c39.firebasestorage.app',
  messagingSenderId:'699995857695',
  appId:'1:699995857695:web:240f8598fb4100d7cf462a'
});

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const n=payload.notification||{};
  const data=payload.data||{};
  self.registration.showNotification(n.title||'MG Master Hub',{
    body:n.body||'You have a new Anime update.',
    icon:n.icon||'/Hub/favicon.ico',
    badge:n.badge||'/Hub/favicon.ico',
    tag:data.tag||`mg-${Date.now()}`,
    data:{url:data.url||'/Hub/anime-pulse.html'}
  });
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'/Hub/anime-pulse.html';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if('focus' in client){client.navigate(url);return client.focus()}
    }
    return clients.openWindow(url);
  }));
});
