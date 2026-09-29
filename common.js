/* RAIM 보드 공통 (대시보드·자원봉사·아뜰리에가 같이 씀)
   - 연결 정보(웹앱 주소·접속 코드) 읽기, 연결 링크(…#c=주소&t=코드)로 들어왔을 때 저장
   - 요청 제한 시간 (Apps Script가 멈춰도 ‘확인 중…’이 끝없이 떠 있지 않게)
   - 페이지 안 대화창 (카카오톡 인앱 브라우저는 prompt/confirm을 막는 경우가 많아서)
   - ‘연결 링크 복사’ 버튼 (data-act="copylink", data-board="volunteer|atelier") */
(function(){
"use strict";
var R=window.RAIM={};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
R.esc=esc;

/* ---------- 연결 정보 ---------- */
R.getApi=function(){try{return JSON.parse(localStorage.getItem("raim-api")||"null")}catch(e){return null}};
R.setApi=function(a){R.api=a;try{localStorage.setItem("raim-api",JSON.stringify(a))}catch(e){}};
R.api=R.getApi();
try{
  var p=new URLSearchParams(location.hash.slice(1));
  if(p.get("c")&&p.get("t")){
    history.replaceState(null,"",location.pathname+location.search);
    R.setApi({url:p.get("c").trim(),token:p.get("t").trim()});
  }
}catch(e){}
/* 웹앱 GET 주소: RAIM.url(api, "action=load&board=atelier") */
R.url=function(api,query){return api.url+(api.url.indexOf("?")<0?"?":"&")+query+"&token="+encodeURIComponent(api.token)};

/* ---------- 요청 ---------- */
/* JSON으로 받아요. 제한 시간이 지나면 Error("timeout")으로 실패해요 */
R.fetchJSON=function(url,opts,ms){
  var o=opts||{},ctl=typeof AbortController==="function"?new AbortController():null;
  if(ctl)o.signal=ctl.signal;
  return new Promise(function(done,fail){
    var t=setTimeout(function(){if(ctl)try{ctl.abort()}catch(x){}fail(new Error("timeout"))},ms||20000);
    fetch(url,o).then(function(r){return r.json()}).then(function(j){clearTimeout(t);done(j)},function(e){clearTimeout(t);fail(e)});
  });
};

/* ---------- 대화창 ---------- */
var css=document.createElement("style");
css.textContent='dialog.rdlg{border:0;border-radius:12px;box-shadow:0 8px 24px rgba(6,58,107,.12);padding:0;width:min(440px,calc(100vw - 32px));color:#0C243B;background:#fff}'+
  'dialog.rdlg::backdrop{background:rgba(12,36,59,.35)}.rdlg form{display:grid;gap:12px;padding:20px}.rdlg h3{margin:0;font-size:17px;font-weight:700}'+
  '.rdlg p{margin:0;font-size:13px;color:#536476;white-space:pre-wrap}.rdlg textarea{width:100%;min-height:96px;font:inherit;font-size:14px;padding:8px 10px;border:1px solid #ADC4D7;border-radius:6px;resize:vertical;word-break:break-all}'+
  '.rdlg-act{display:flex;justify-content:flex-end;gap:8px}.rdlg-act button{font:inherit;font-size:14px;border-radius:999px;padding:8px 16px;border:1px solid #4AADFD;background:#4AADFD;color:#0C243B;cursor:pointer}'+
  '.rdlg-act button.sub{background:#fff;color:#1479CC;border-color:#1479CC}@media (max-width:640px){.rdlg textarea{font-size:16px}}';
document.head.appendChild(css);
/* 복사할 글을 보여 주는 창: 길게 눌러 복사할 수 있게 전부 선택해 둬요 */
R.showText=function(title,text,value){
  var d=document.createElement("dialog");
  if(typeof d.showModal!=="function"){try{window.prompt(title,value)}catch(e){}return}
  d.className="rdlg";
  d.innerHTML='<form method="dialog"><h3>'+esc(title)+'</h3>'+(text?'<p>'+esc(text)+'</p>':'')+'<textarea readonly>'+esc(value)+'</textarea><div class="rdlg-act"><button type="button" class="sub" data-x="copy">복사</button><button type="submit">닫기</button></div></form>';
  document.body.appendChild(d);
  var ta=d.querySelector("textarea");
  d.addEventListener("close",function(){d.remove()});
  d.addEventListener("click",function(e){
    if(e.target.dataset.x!=="copy")return;
    ta.focus();ta.select();var ok=false;try{ok=document.execCommand("copy")}catch(x){}
    e.target.textContent=ok?"복사됨":"길게 눌러 복사하세요";
  });
  d.showModal();ta.focus();ta.select();
};
/* 클립보드에 넣고, 안 되면 창으로 보여 줘요. 성공하면 true */
R.copy=function(value,title,text){
  return new Promise(function(done){
    var manual=function(){R.showText(title,text,value);done(false)};
    try{navigator.clipboard.writeText(value).then(function(){done(true)},manual)}catch(x){manual()}
  });
};

/* ---------- 연결 링크 복사 ----------
   data-board 보드의 전용 코드를 웹앱에서 받아 링크를 만들어요. 전체 코드가 있는 기기에서만 전용 코드를 받을 수 있고,
   아니면 이 기기 코드(이미 전용) 그대로 */
document.addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest("[data-act=copylink]"),api=R.getApi();
  if(!b||!api||b.disabled)return;
  var want=b.dataset.board||"",label0=b.textContent;
  b.disabled=true;b.textContent="링크 만드는 중…";
  R.fetchJSON(R.url(api,"action=codes")).catch(function(){return null}).then(function(res){
    b.disabled=false;b.textContent=label0;
    var tok=api.token,what="?";
    if(res&&res.ok){if(res.full&&want&&res[want]){tok=res[want];what=want}else what=res.full?"all":(res.scope||[]).join(",")}
    var name={all:"전체 권한(두 보드 모두)",volunteer:"자원봉사 보드 전용",atelier:"아뜰리에 보드 전용"}[what]||"이 기기와 같은 권한";
    var root=location.pathname.replace(/\/(volunteer|atelier)\/(index\.html)?$/,"/").replace(/index\.html$/,"");
    var s=location.origin+root+({volunteer:"volunteer/",atelier:"atelier/"}[what]||"")+"#c="+encodeURIComponent(api.url)+"&t="+encodeURIComponent(tok);
    var text="이 링크를 연 사람은 웹앱 주소·접속 코드를 입력하지 않아도 연결돼요.";
    if(what==="?"){R.showText(name+" 연결 링크",text+"\n(Apps Script가 예전 버전이거나 연결이 안 돼서 전용 링크를 못 만들었어요. 이 기기 코드가 그대로 들어가요.)",s);return}
    R.copy(s,name+" 연결 링크",text).then(function(ok){if(ok)b.textContent="복사됨 · "+name});
  });
});
})();
