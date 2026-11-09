/* Show a gentle refresh notification when a newer PWA service worker
   replaces the one controlling the current page. Never clear diary storage. */
(function(){
  "use strict";
  const banner=document.getElementById("appUpdateNotice");
  const button=document.getElementById("appUpdateButton");
  if(!banner||!button||!navigator||!("serviceWorker" in navigator))return;
  let initiallyControlled=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(!initiallyControlled){initiallyControlled=true;return;}
    banner.hidden=false;
  });
  button.onclick=()=>location.reload();
  // Ask the browser to check for a new offline shell; ignore offline failures.
  if(typeof navigator.serviceWorker.getRegistration==="function"){
    navigator.serviceWorker.getRegistration().then(reg=>{
      if(reg && typeof reg.update==="function")return reg.update();
    }).catch(()=>{});
  }
})();
