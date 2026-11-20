/* Host bridge: gives the page the same window.claude interface it uses on
   claude.ai, backed by this Next.js app (Google sign-in + GitHub commits). */
(function(){
  if (window.claude) return;
  const host = { signInUrl: "/api/auth/signin/google?callbackUrl=%2F%23admin", signOutUrl: "/api/auth/signout?callbackUrl=%2F", email: "" };
  let mePromise = null;
  const me = () => mePromise || (mePromise = fetch("/api/me", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(m => { host.email = m.email || ""; return m; }));
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  async function post(url, body, isForm) {
    const r = await fetch(url, isForm ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw err("not_writer", j.error);
    if (r.status === 409) throw err("conflict", j.error);
    if (r.status === 413) throw err("too_large", j.error);
    if (r.status === 415) throw err("unsupported_type", j.error);
    if (!r.ok) throw err("upstream_error", j.error);
    return j;
  }
  window.claude = {
    host,
    use: async (name) => {
      if (name === "user") {
        const m = await me();
        return { canEdit: async () => !!m.isAdmin, isOwner: async () => !!m.isAdmin, id: async () => m.email || null, profiles: async (ids) => Object.fromEntries((ids || []).map(i => [i, { name: i }])) };
      }
      if (name === "artifact") {
        const m = await me();
        if (!m.isAdmin) return null;
        return { publish: async (files) => post("/api/content", { content: files["site-data.json"] }) };
      }
      if (name === "assets") {
        const m = await me();
        if (!m.isAdmin) return null;
        return {
          upload: async (file) => { const fd = new FormData(); fd.append("file", file); return post("/api/upload", fd, true); },
          delete: async () => {}
        };
      }
      if (name === "db") {
        const m = await me();
        if (!m.isAdmin) return null;
        const probe = await fetch("/api/resources", { cache: "no-store" }).catch(() => null);
        if (!probe || probe.status === 503) return null;
        return resourcesDb();
      }
      return null;
    }
  };

  /* Research resources: a small stand-in for the db the page uses on claude.ai,
     backed by /api/resources (a private GitHub repository). */
  function resourcesDb() {
    const listeners = new Set();
    let timer = null;
    async function refresh() {
      const r = await fetch("/api/resources", { cache: "no-store" });
      if (!r.ok) throw err(r.status === 401 ? "permission_denied" : "unavailable");
      const j = await r.json();
      const docs = (j.items || []).map(it => ({ id: it.id, exists: true, data: () => it }));
      listeners.forEach(l => l.next({ docs, size: docs.length, empty: !docs.length }));
    }
    const call = async (body) => { await post("/api/resources", body); refresh().catch(() => {}); };
    return {
      collection: () => ({
        orderBy: () => ({
          onSnapshot: (next, error) => {
            const l = { next, error }; listeners.add(l);
            refresh().catch(e => error && error(e));
            if (!timer) timer = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60000);
            return () => listeners.delete(l);
          }
        }),
        add: async (data) => { await call({ action: "add", data }); return {}; }
      }),
      doc: (path) => {
        const id = String(path).split("/")[1];
        return { update: (data) => call({ action: "update", id, data }), delete: () => call({ action: "delete", id }) };
      },
      upload: async (file) => { const fd = new FormData(); fd.append("file", file); return post("/api/resources/upload", fd, true); },
      deleteFile: async (p) => { await fetch("/api/resources/file?path=" + encodeURIComponent(p), { method: "DELETE" }).catch(() => {}); }
    };
  }
})();


/* ---------- theme + menu ---------- */
(function(){
  const root=document.documentElement,btn=document.getElementById("theme-btn");
  const sysDark=()=>matchMedia("(prefers-color-scheme: dark)").matches;
  function current(){const t=root.getAttribute("data-theme");return t?t==="dark":sysDark();}
  function paint(){const d=current();root.classList.toggle("is-dark",d);btn.setAttribute("aria-label",d?"Switch to day mode":"Switch to night mode");btn.title=d?"Day mode":"Night mode";}
  let saved=null;try{saved=localStorage.getItem("bos-theme");}catch(e){}
  if(saved==="dark"||saved==="light")root.setAttribute("data-theme",saved);
  paint();
  btn.addEventListener("click",()=>{const next=current()?"light":"dark";root.setAttribute("data-theme",next);try{localStorage.setItem("bos-theme",next);}catch(e){}paint();});
  try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",paint);}catch(e){}
  new MutationObserver(paint).observe(root,{attributes:true,attributeFilter:["data-theme"]});
  const mb=document.getElementById("menu-btn"),hd=document.getElementById("hdr");
  mb.addEventListener("click",()=>{const o=hd.classList.toggle("open");mb.setAttribute("aria-expanded",String(o));mb.setAttribute("aria-label",o?"Close menu":"Open menu");});
})();

/* ---------- routing ---------- */
const pages=["home","why","studies","get-involved","publications","blog","about","admin"];
const NAV_ITEMS=[["studies","Studies"],["publications","Publications"],["blog","Blog"],["about","About"],["get-involved","Get involved"],["why","Why it matters"]];
const navHidden=k=>!!(window.__nav&&window.__nav.includes(k));
function applyNav(nav){
  window.__nav=(nav&&Array.isArray(nav.hidden))?nav.hidden.slice():[];
  NAV_ITEMS.forEach(([k])=>{const off=navHidden(k);
    document.querySelectorAll(`#mainnav a[data-p="${k}"],.flinks a[href="#${k}"],#p-home .btns a[href="#${k}"]`).forEach(a=>a.hidden=off);});
  const f=document.getElementById("float");if(f&&navHidden("get-involved"))f.hidden=true;
  const h=(location.hash||"#home").slice(1).replace(/^blog-.*/,"blog");
  if(navHidden(h)&&!window.__isEditor)location.hash="#home";
}
function route(){
  let h=(location.hash||"#home").slice(1); if(h==="method") h="studies"; let post=null; if(h.startsWith("blog-")){post=h.slice(5);h="blog";} if(!pages.includes(h)) h="home"; if(navHidden(h)&&!window.__isEditor) h="home"; if(h==="blog"&&window.__blogShow) window.__blogShow(post); if(h==="admin"&&window.__adminShow) window.__adminShow();
  pages.forEach(p=>document.getElementById("p-"+p).hidden=(p!==h));
  document.querySelectorAll("#hdr [data-p]").forEach(a=>{ if(a.dataset.p===h) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const hd=document.getElementById("hdr");if(hd){hd.classList.remove("open");const mb=document.getElementById("menu-btn");if(mb)mb.setAttribute("aria-expanded","false");}
  document.getElementById("float").hidden=(h==="get-involved"||h==="admin"||navHidden("get-involved")||(window.SITE&&!window.SITE.recruit.open));
  window.scrollTo(0,0);
  if(h==="home" && window.__graphResize) requestAnimationFrame(window.__graphResize);
}
addEventListener("hashchange",route); route();

/* ---------- typed line ---------- */
(function(){
  const lines=["“I talk to the chatbot more than I talk to anyone.”","“It said I should see someone. So I did.”","“I don’t want my family to know.”","“Is it okay to just ask the app?”"];
  const el=document.getElementById("typed");
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const L=()=>{const t=window.SITE&&window.SITE.home&&window.SITE.home.typed;return t&&t.length?t:lines;};
  let i=0,j=lines[0].length,dir=-1;
  function tick(){
    const ls=L();if(i>=ls.length)i=0;
    const s=ls[i]; j+=dir; el.textContent=s.slice(0,Math.max(0,j));
    if(dir<0&&j<=0){i=(i+1)%ls.length;dir=1;return setTimeout(tick,350);}
    if(dir>0&&j>=ls[i].length){dir=-1;return setTimeout(tick,2600);}
    setTimeout(tick,dir<0?18:42);
  }
  setTimeout(tick,2600);
})();

/* ---------- copy ---------- */
document.querySelectorAll(".copy").forEach(b=>b.addEventListener("click",()=>{
  const t=document.getElementById(b.dataset.copy).textContent;
  const done=()=>{b.textContent="Copied";setTimeout(()=>b.textContent="Copy email",1600)};
  const sel=()=>{const r=document.createRange();r.selectNodeContents(document.getElementById(b.dataset.copy));const s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent="Selected, press Ctrl/Cmd+C";};
  try{navigator.clipboard.writeText(t).then(done,sel)}catch(e){sel()}
}));

document.addEventListener("click",e=>{const b=e.target.closest(".copy-email");if(!b||document.body.classList.contains("editing"))return;(()=>{
  const t=b.dataset.email,lab=b.querySelector("span")||b,orig=lab.textContent;
  const done=()=>{lab.textContent="copied";setTimeout(()=>lab.textContent=orig,1600)};
  const fail=()=>{lab.textContent=t;};
  try{navigator.clipboard.writeText(t).then(done,fail)}catch(e){fail()}
})();});

/* ---------- gantt ---------- */
const AXES={study1:["gantt","2026-10-01","2027-03-01",true],program:["gantt-prog","2026-10-01","2029-10-01",false]};
function buildGantt(which,rows){
  const [id,a,b,ticks]=AXES[which];const g=document.getElementById(id);if(!g)return;
  while(g.children.length>2)g.lastChild.remove();
  const t0=Date.parse(a),t1=Date.parse(b),pct=x=>Math.min(100,Math.max(0,(Date.parse(x)-t0)/(t1-t0)*100));
  (rows||[]).forEach(r=>{
    const l=document.createElement("div");l.className="gl";l.textContent=r.label;
    const t=document.createElement("div");t.className="gt"+(ticks?"":" plain");
    const i=document.createElement("i");if(r.key)i.className="key";
    const L=pct(r.start),R=pct(r.end);i.style.left=L+"%";i.style.width=Math.max(.9,R-L)+"%";
    t.appendChild(i);g.append(l,t);
  });
}
document.querySelectorAll(".st[data-go]").forEach(b=>b.addEventListener("click",()=>{const el=document.getElementById(b.dataset.go);if(el)el.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});}));

/* ---------- publications ---------- */
const DOI_RE=/^10\.\d{4,9}\/\S+$/;
function normDoi(v){v=String(v||"").trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i,"").replace(/^doi:\s*/i,"");return v;}
window.initPubs=function(ALL){
  if(!window.__pubState) window.__pubState={type:"All",status:"All",tag:null,q:""};
  const P=(ALL||[]).filter(p=>!p.hidden);

  const has=(k,v)=>P.some(p=>p[k]===v);
  const types=["All",...["Article","Protocol","Talk"].filter(v=>has("type",v))], stats=["All",...["Published","Presented","In preparation","Planned"].filter(v=>has("status",v))];
  if(!types.includes(window.__pubState.type))window.__pubState.type="All";if(!stats.includes(window.__pubState.status))window.__pubState.status="All";
  const st=window.__pubState;
  const $=id=>document.getElementById(id);
  const tagCounts={};P.forEach(p=>p.tags.forEach(t=>tagCounts[t]=(tagCounts[t]||0)+1));
  const allTags=Object.keys(tagCounts).sort((a,b)=>tagCounts[b]-tagCounts[a]||a.localeCompare(b));
  function seg(el,opts,key,countFn){
    el.innerHTML="";
    opts.forEach(o=>{const b=document.createElement("button");b.className="fb";b.setAttribute("aria-pressed",String(st[key]===o));
      b.innerHTML='<span></span><span class="c"></span>';b.firstChild.textContent=o;b.lastChild.textContent=countFn(o);
      b.onclick=()=>{st[key]=o;render();};el.appendChild(b);});
  }
  const match=(p,ex)=>(ex==="type"||st.type==="All"||p.type===st.type)&&(ex==="status"||st.status==="All"||p.status===st.status)&&(ex==="tag"||!st.tag||p.tags.includes(st.tag))&&(!st.q||(p.title+" "+p.au+" "+p.venue+" "+(p.doi||"")+" "+p.tags.join(" ")).toLowerCase().includes(st.q));
  function render(){
    seg($("f-type"),types,"type",o=>P.filter(p=>match(p,"type")&&(o==="All"||p.type===o)).length);
    seg($("f-status"),stats,"status",o=>P.filter(p=>match(p,"status")&&(o==="All"||p.status===o)).length);
    const ft=$("f-tags");ft.innerHTML="";
    allTags.forEach(t=>{const b=document.createElement("button");b.className="ht";b.textContent="#"+t;b.setAttribute("aria-pressed",String(st.tag===t));b.onclick=()=>{st.tag=st.tag===t?null:t;render();};ft.appendChild(b);});
    const list=P.filter(p=>match(p));
    $("pub-count").textContent=`Showing ${list.length} of ${P.length}`;
    $("pub-clear").hidden=!(st.type!=="All"||st.status!=="All"||st.tag||st.q);
    const box=$("pub-list");box.innerHTML="";
    if(!list.length){box.innerHTML='<p class="empty">Nothing matches these filters.</p>';return;}
    [...new Set(list.map(p=>+p.y))].sort((a,b)=>b-a).forEach(y=>{
      const sec=document.createElement("section");sec.className="yr";
      const h=document.createElement("h2");h.textContent=y;const ol=document.createElement("ol");
      list.filter(p=>+p.y===y).forEach(p=>{
        const li=document.createElement("li");li.className="pub";
        const cls=p.status==="Presented"||p.status==="Published"?"presented":p.status==="In preparation"?"prep":"";
        li.innerHTML=`<div class="ptop"><span class="ptype"></span><span class="pst ${cls}"></span></div><h3></h3><p class="pau"></p><p class="pven"></p>${p.note?'<p class="pau pnote"></p>':""}<div class="plinks"></div><div class="ptags"></div>`;
        li.querySelector(".ptype").textContent=p.type;li.querySelector(".pst").textContent=p.status;
        li.querySelector("h3").textContent=p.title;li.querySelector(".pven").textContent=p.venue;
        const au=li.querySelector(".pau");
        const parts=p.au.split(/(Ban, B\. R\. J\.|Ban, R\. J\.)/);
        parts.forEach(x=>{if(!x)return;if(/^Ban, /.test(x)){const b=document.createElement("b");b.textContent=x;au.appendChild(b);}else au.appendChild(document.createTextNode(x));});
        if(p.note)li.querySelector(".pnote").textContent=p.note;
        const pl=li.querySelector(".plinks");
        if(p.doi&&DOI_RE.test(p.doi)){const a=document.createElement("a");a.className="pdoi";a.href="https://doi.org/"+p.doi;a.target="_blank";a.rel="noopener";a.innerHTML="<span>DOI</span>";a.appendChild(document.createTextNode(p.doi));pl.appendChild(a);}
        if(p.url&&/^https?:\/\//.test(p.url)){const a=document.createElement("a");a.className="pdoi";a.href=p.url;a.target="_blank";a.rel="noopener";a.innerHTML="<span>Link</span>";a.appendChild(document.createTextNode(p.url.replace(/^https?:\/\/(www\.)?/,"").replace(/\/$/,"").slice(0,60)));pl.appendChild(a);}
        if(!pl.children.length)pl.remove();
        const tg=li.querySelector(".ptags");
        p.tags.forEach(t=>{const b=document.createElement("button");b.className="ht";b.textContent="#"+t;b.setAttribute("aria-pressed",String(st.tag===t));b.onclick=()=>{st.tag=st.tag===t?null:t;render();$("f-tags").scrollIntoView({block:"nearest"});};tg.appendChild(b);});
        ol.appendChild(li);
      });
      sec.append(h,ol);box.appendChild(sec);
    });
  }
  $("pub-q").oninput=e=>{st.q=e.target.value.trim().toLowerCase();render();};
  $("pub-clear").onclick=()=>{st.type="All";st.status="All";st.tag=null;st.q="";$("pub-q").value="";render();};
  if(st.tag&&!P.some(p=>p.tags.includes(st.tag)))st.tag=null;
  render();
};

/* ---------- markdown (safe subset) ---------- */
function esc(t){return String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function inline(t){
  t=esc(t);
  t=t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|#)[^\s)]+)\)/g,(m,x,u)=>`<a href="${u}"${u[0]==="#"?"":' target="_blank" rel="noopener"'}>${x}</a>`);
  t=t.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g,"$1<i>$2</i>");
  return t;
}
function md(src){
  const out=[];let list=null,para=[];
  const flush=()=>{if(para.length){out.push("<p>"+inline(para.join(" "))+"</p>");para=[];} if(list){out.push("<ul>"+list.map(x=>"<li>"+inline(x)+"</li>").join("")+"</ul>");list=null;}};
  String(src||"").split(/\r?\n/).forEach(l=>{
    const t=l.trim();
    if(!t){flush();return;}
    const im=t.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
    if(im){flush();const u=safeUrl(im[2]);if(u)out.push(`<figure><img src="${esc(u)}" alt="${esc(im[1])}" loading="lazy">${im[1]?`<figcaption>${esc(im[1])}</figcaption>`:""}</figure>`);return;}
    if(t.startsWith("## ")){flush();out.push("<h2>"+inline(t.slice(3))+"</h2>");return;}
    if(t.startsWith("> ")){flush();out.push("<blockquote>"+inline(t.slice(2))+"</blockquote>");return;}
    if(/^[-*] /.test(t)){if(para.length){out.push("<p>"+inline(para.join(" "))+"</p>");para=[];} (list=list||[]).push(t.slice(2));return;}
    if(list){flush();}
    para.push(t);
  });
  flush();return out.join("");
}

/* ---------- blog ---------- */
(function(){
  let POSTS=[];let tag=null;let current=null;
  const fmt=d=>{const x=new Date(d+"T00:00:00");return isNaN(x)?d:x.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});};
  const mins=b=>Math.max(1,Math.round(String(b).split(/\s+/).length/200));
  const $=id=>document.getElementById(id);
  function tagBtn(t,onClick){const b=document.createElement("button");b.className="ht";b.textContent="#"+t;b.setAttribute("aria-pressed",String(tag===t));b.onclick=onClick;return b;}
  function sorted(){return POSTS.filter(p=>!p.hidden).sort((a,b)=>String(b.date).localeCompare(String(a.date)));}
  function cover(p,cls){const u=safeUrl(p.cover);if(!u)return null;const i=document.createElement("img");i.className=cls;i.src=u;i.alt="";i.loading="lazy";return i;}
  function renderIndex(){
    const counts={};POSTS.filter(p=>!p.hidden).forEach(p=>(p.tags||[]).forEach(t=>counts[t]=(counts[t]||0)+1));
    if(tag&&!counts[tag])tag=null;
    const bt=$("blog-tags");bt.innerHTML="";
    Object.keys(counts).sort((a,b)=>counts[b]-counts[a]||a.localeCompare(b)).forEach(t=>bt.appendChild(tagBtn(t,()=>{tag=tag===t?null:t;renderIndex();})));
    const list=$("blog-list");list.innerHTML="";
    const shown=sorted().filter(p=>!tag||(p.tags||[]).includes(tag));
    if(!shown.length){list.innerHTML='<p class="empty">No posts yet.</p>';return;}
    shown.forEach(p=>{
      const el=document.createElement("article");el.className="bp";
      el.innerHTML=`<time></time><div class="bb"><h2><a></a></h2><p></p><span class="bmeta"></span><div class="ptags"></div></div>`;
      el.querySelector("time").textContent=fmt(p.date);const a=el.querySelector("h2 a");a.textContent=p.title;a.href="#blog-"+p.slug;
      el.querySelector("p").textContent=p.dek||"";
      el.querySelector(".bmeta").textContent=`Brendon Ban · ${mins(p.body)} min read`;
      const tg=el.querySelector(".ptags");(p.tags||[]).forEach(t=>tg.appendChild(tagBtn(t,()=>{tag=tag===t?null:t;renderIndex();})));
      const c=cover(p,"bcover");if(c){const ca=document.createElement("a");ca.href="#blog-"+p.slug;ca.tabIndex=-1;ca.setAttribute("aria-hidden","true");ca.appendChild(c);el.querySelector(".bb").prepend(ca);}
      list.appendChild(el);
    });
  }
  window.__blogShow=function(slug){
    current=slug||null;
    const p=current&&POSTS.find(x=>x.slug===current&&(!x.hidden||window.__isEditor));
    $("blog-index").hidden=!!p;$("blog-post").hidden=!p;
    if(!p){renderIndex();return;}
    const a=$("blog-post");
    a.innerHTML=`<a class="back" href="#blog">← All posts</a><h1></h1><div class="pm"><span class="dot"></span><span>Brendon Ban</span><span>·</span><time></time><span>·</span><span class="rt"></span></div><div class="body">${md(p.body)}</div><div class="ptags"></div>`;
    a.querySelector("h1").textContent=p.title;a.querySelector("time").textContent=fmt(p.date);
    const c=cover(p,"pcover");if(c)a.querySelector(".pm").after(c);
    if(p.hidden){const n=document.createElement("p");n.className="hidden-note";n.textContent="Hidden post · only admins can see this";a.querySelector(".back").after(n);}a.querySelector(".rt").textContent=mins(p.body)+" min read";
    const tg=a.querySelector(".ptags");(p.tags||[]).forEach(t=>tg.appendChild(tagBtn(t,()=>{tag=t;location.hash="#blog";})));
  };
  window.initBlog=function(posts){POSTS=posts||[];window.__blogShow(current);};
  const h=(location.hash||"").slice(1);if(h.startsWith("blog-"))current=h.slice(5);
})();

/* ---------- recruitment ---------- */
function defaultRoles(r){
  r=r||{};
  return [
    {title:"Research assistants",open:r.open!==false,status:r.open===false?(r.closedNote||"Closed for now"):`Open · closes ${r.deadline||"soon"}`,
     points:["Screen and chart studies for our reviews","About 10 hours a week, with a weekly check-in","Psychology, counseling or related students and graduates"],
     send:"CV and transcript",subject:"RA application—[Your Name]"},
    {title:"AI and tech team",open:true,status:"Open · rolling",
     points:["Help build the Ora app and Sol, its AI companion","Work with large language models, safety and privacy","Comfortable coding in JavaScript, TypeScript or Python"],
     send:"CV and GitHub or portfolio link",subject:"AI and tech team—[Your Name]"}
  ];
}
function renderRoles(roles){
  const box=document.getElementById("roles");if(!box)return;
  box.innerHTML="";
  const shown=roles.filter(x=>!x.hidden);
  if(!shown.length){box.innerHTML='<p class="empty">No open positions right now. You can still email us about collaborating.</p>';return;}
  shown.forEach(x=>{
    const a=document.createElement("article");a.className="role"+(x.open?"":" closed");
    const h=document.createElement("h2");h.textContent=x.title;a.appendChild(h);
    const st=document.createElement("p");st.className="rstat";st.textContent=x.status||(x.open?"Open":"Closed for now");a.appendChild(st);
    const pts=(x.points||[]).filter(Boolean);
    if(pts.length){const ul=document.createElement("ul");ul.className="list";pts.forEach(t=>{const li=document.createElement("li");li.textContent=t;ul.appendChild(li);});a.appendChild(ul);}
    [["Send",x.send],["Subject",x.subject]].forEach(([k,v])=>{if(!v)return;const q=document.createElement("p");q.className="rsend";const b=document.createElement("b");b.textContent=k;q.append(b," "+v);a.appendChild(q);});
    box.appendChild(a);
  });
}
window.applyRecruit=function(r){
  r=r||{};const roles=r.roles||defaultRoles(r);
  renderRoles(roles);
  document.querySelectorAll('[data-s="deadline"]').forEach(e=>e.textContent=r.deadline);
  const ft=document.getElementById("float-text");if(ft)ft.textContent=r.pill;
  const h=(location.hash||"#home").slice(1);
  document.getElementById("float").hidden=!r.open||!r.pill||h==="get-involved"||h==="admin"||navHidden("get-involved");
  const ra=roles.find(x=>/research assistant/i.test(x.title||""));
  const rs=document.getElementById("ra-state");if(rs)rs.textContent=ra&&ra.open&&!ra.hidden?"recruiting":"applications closed";
};

/* ---------- site data ---------- */
window.SITE=null;
const ICONS={megaphone:'<path fill="currentColor" d="M3 10v4h3l5 4V6L6 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',cap:'<path fill="currentColor" d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2v4L12 21l7-3.8v-4L12 17l-7-3.8z"/>',person:'<path fill="currentColor" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z"/>',group:'<path fill="currentColor" d="M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 14c-2.7 0-6 1.3-6 4v2h12v-2c0-2.7-3.3-4-6-4zm8 0c-.6 0-1.3.1-2 .2 1.2.9 2 2.1 2 3.8v2h6v-2c0-2.6-3.3-4-6-4z"/>'};
const MAIL='<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 7 8-5H4l8 5zm0 2L4 8v10h16V8l-8 5z"/></svg>';
const ARROW='<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M5 12h11.2l-4.6-4.6L13 6l7 7-7 7-1.4-1.4 4.6-4.6H5z"/></svg>';
const IC=d=>`<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
const LINK_TYPES=[
  ["website","website",IC("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"),"https://…"],
  ["linkedin","linkedin",IC("M4 8h16v12H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13h16"),"https://www.linkedin.com/in/…"],
  ["github","github",IC("M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"),"https://github.com/…"],
  ["scholar","google scholar",IC("M12 4 2 9l10 5 10-5-10-5zM6 11v5c3 2.7 9 2.7 12 0v-5"),"https://scholar.google.com/citations?user=…"],
  ["orcid","orcid",IC("M4 6h16v12H4zM8 10v4M12 10h2a2 2 0 0 1 0 4h-2zM8 8.2v.1"),"0000-0000-0000-0000 or full link"],
  ["researchgate","researchgate",IC("M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9"),"https://www.researchgate.net/profile/…"],
  ["social","bluesky / x",IC("M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm0 0v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1"),"https://bsky.app/profile/… or https://x.com/…"],
  ["cv","cv",IC("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6"),"Link to a PDF or page"]
];
const LINK_ICON=Object.fromEntries(LINK_TYPES.map(t=>[t[0],t[2]]));LINK_ICON.link=IC("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1");
const LINK_LABEL=Object.fromEntries(LINK_TYPES.map(t=>[t[0],t[1]]));
function normUrl(type,v){v=String(v||"").trim();if(!v)return"";if(type==="orcid"&&/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(v))return"https://orcid.org/"+v.toUpperCase();if(!/^(https?:\/\/|#)/i.test(v)&&/\.[a-z]{2,}/i.test(v))v="https://"+v.replace(/^\/+/,"");return /^(https?:\/\/|#)/i.test(v)?v:"";}
function memberLinks(m){const out=(m.links||[]).filter(l=>l&&l.url);if(m.link&&!out.some(l=>l.url===m.link))out.push({type:"link",url:m.link,label:m.linkLabel||"link"});return out;}
const initials=n=>String(n).replace(/^(Assoc\.|Prof\.|Dr\.|\s)+/g,"").split(/\s+/).filter(w=>/^[A-Z]/.test(w)).slice(0,3).map(w=>w[0]).join("")||"+";
const safeUrl=u=>/^(https?:\/\/|#|\/_blob\/|\/uploads\/[\w.-]+$|\/api\/resources\/file\?path=resources%2Ffiles%2F[\w.%-]+$)/.test(String(u||""))?u:"";
function renderTeam(team){
  const R=document.getElementById("roster");if(!R||!team)return;R.innerHTML="";
  team.forEach(m=>{
    const a=document.createElement("article");a.className="member";
    const ph=document.createElement("div");ph.className="photo"+(m.open&&!m.photo?" open":"");
    if(safeUrl(m.photo)){const img=document.createElement("img");img.src=m.photo;img.alt=m.name;ph.appendChild(img);}else{const sp=document.createElement("span");sp.textContent=m.open?"+":initials(m.name);ph.appendChild(sp);ph.setAttribute("aria-hidden","true");}
    const info=document.createElement("div");info.className="info";
    info.innerHTML=`<div class="mh"><h3></h3><span class="badge"><span></span><svg viewBox="0 0 24 24" width="18" height="18">${ICONS[m.icon]||ICONS.person}</svg></span></div>`;
    info.querySelector("h3").textContent=m.name;info.querySelector(".badge span").textContent=m.badge||"";
    if(m.sub){const x=document.createElement("p");x.className="sub";x.textContent=m.sub;info.appendChild(x);}
    String(m.bio||"").split(/\n\s*\n/).filter(t=>t.trim()).forEach(t=>{const x=document.createElement("p");x.className="bio";x.innerHTML=inline(t.trim());info.appendChild(x);});
    const works=String(m.works||"").split("\n").map(t=>t.trim()).filter(Boolean);
    if(works.length){const ul=document.createElement("ul");ul.className="work";works.forEach(w=>{const li=document.createElement("li");li.innerHTML=inline(w);ul.appendChild(li);});info.appendChild(ul);}
    const links=document.createElement("div");links.className="links";
    if(m.email){const b=document.createElement("button");b.className="lchip copy-email";b.dataset.email=m.email;b.innerHTML=MAIL+"<span>email</span>";links.appendChild(b);}
    memberLinks(m).forEach(lk=>{const u=safeUrl(lk.url);if(!u)return;const l=document.createElement("a");l.className="lchip";l.href=u;if(u[0]!=="#"){l.target="_blank";l.rel="noopener";}l.innerHTML=(LINK_ICON[lk.type]||(u[0]==="#"?ARROW:LINK_ICON.link))+"<span></span>";l.querySelector("span").textContent=lk.label||LINK_LABEL[lk.type]||"link";links.appendChild(l);});
    if(links.children.length)info.appendChild(links);
    a.append(ph,info);R.appendChild(a);
  });
}
/* text overrides */
const ALLOWED_SPAN=new Set(["cite","k","v","lt","go","amend","stop","sw","n","or","addr","tag"]);
function cleanHTML(src){
  const t=document.createElement("template");t.innerHTML=String(src);
  (function walk(node){
    [...node.childNodes].forEach(c=>{
      if(c.nodeType===3)return;
      if(c.nodeType!==1){c.remove();return;}
      walk(c);
      const tag=c.tagName;
      if(["B","STRONG","I","EM","BR","CODE","SUP","SUB"].includes(tag)){[...c.attributes].forEach(a=>c.removeAttribute(a.name));return;}
      if(tag==="A"){const h=c.getAttribute("href")||"";[...c.attributes].forEach(a=>c.removeAttribute(a.name));if(/^(https?:|#|mailto:)/i.test(h)){c.setAttribute("href",h);if(/^https?:/i.test(h)){c.target="_blank";c.rel="noopener";}return;}}
      if(tag==="SPAN"){const cls=(c.getAttribute("class")||"").split(/\s+/).filter(x=>ALLOWED_SPAN.has(x));const st=cls.includes("sw")?c.getAttribute("style"):null;[...c.attributes].forEach(a=>c.removeAttribute(a.name));if(cls.length){c.className=cls.join(" ");if(st&&/^[\w\s:;().,%#-]*$/.test(st)&&!/url\(/i.test(st))c.setAttribute("style",st);return;}}
      const frag=document.createDocumentFragment();
      if((tag==="DIV"||tag==="P")&&c.previousSibling)frag.appendChild(document.createElement("br"));
      while(c.firstChild)frag.appendChild(c.firstChild);
      c.replaceWith(frag);
    });
  })(t.content);
  return t.innerHTML;
}
const NOEDIT="#blog-list,#blog-post,#pub-list,.pubbar,#p-admin,.graph-block,.roster,.gantt,.trio,#blog-tags";
const ORIG={};
function editable(el){return !el.closest(NOEDIT)&&!el.querySelector("[id],[data-s],[data-k],button,svg,input,select,textarea,img");}
function textEls(){return [...document.querySelectorAll("[data-k]")].filter(editable);}
textEls().forEach(el=>ORIG[el.dataset.k]=el.innerHTML);
function applyTexts(texts){
  textEls().forEach(el=>{const k=el.dataset.k;const v=texts&&texts[k];el.innerHTML=(v!=null)?cleanHTML(v):ORIG[k];});
}
/* ---------- alumni + collaborator network ---------- */
const AUTH_RE=/([A-Z][A-Za-z'’\-]+(?:\s[A-Z][A-Za-z'’\-]+)*),\s*((?:[A-Z]\.\s?(?:-\s?)?)+)/g;
function parseAuthors(str){
  const out=[],seen=new Set();String(str||"").replace(/et al\.?/g,"").replace(/&/g,",").replace(AUTH_RE,(m,sur,ini)=>{
    const i=ini.replace(/\s|-/g,"");const key=sur.toLowerCase()+"|"+i[0];
    if(!seen.has(key)){seen.add(key);out.push({sur,ini:i.replace(/\./g,". ").trim(),key});}return m;});
  return out;
}
const NAME_TITLES=/\b(Assoc|Asst|Prof|Dr|Mr|Ms|Mrs|Ir|Ts)\.?\s*/g;
function personMatches(person,tok){
  if(person.cite){if(parseAuthors(person.cite).some(t=>t.key===tok.key))return true;}
  const w=String(person.name||"").replace(NAME_TITLES,"").split(/\s+/).filter(Boolean);
  const si=w.findIndex(x=>x.toLowerCase()===tok.sur.toLowerCase());
  return si>=0&&w.some((x,i)=>i!==si&&x[0]&&x[0].toUpperCase()===tok.key.split("|")[1]);
}
function renderAlumni(list){
  const blk=document.getElementById("alumni-block"),ul=document.getElementById("alumni-list");if(!blk)return;
  const items=(list||[]).filter(a=>a&&a.name);blk.hidden=!items.length;ul.innerHTML="";
  items.forEach(a=>{const li=document.createElement("li");
    const u=safeUrl(a.link);const n=document.createElement(u?"a":"b");n.textContent=a.name;if(u){n.className="an";n.href=u;if(u[0]!=="#"){n.target="_blank";n.rel="noopener";}}
    li.appendChild(n);
    let t=a.role||"";if(a.period)t+=(t?" ":"")+"("+a.period+")";if(a.now)t+=(t?", ":"")+a.now;
    if(t)li.appendChild(document.createTextNode(" – "+t));ul.appendChild(li);});
}
function renderCollab(d){
  const blk=document.getElementById("collab-block");if(!blk||!window.d3)return;
  const pubs=(d.pubs||[]).filter(p=>!p.hidden);
  const team=(d.team||[]).filter(m=>m&&m.name&&!m.open),alumni=(d.alumni||[]).filter(a=>a&&a.name);
  const nodes=new Map(),edges=new Map();
  const resolve=tok=>{
    const m=team.find(x=>personMatches(x,tok));if(m)return {id:"m:"+m.name,label:m.name.replace(NAME_TITLES,""),kind:"member",badge:m.badge};
    const a=alumni.find(x=>personMatches(x,tok));if(a)return {id:"a:"+a.name,label:a.name,kind:"alum"};
    return {id:"c:"+tok.key,label:tok.ini+" "+tok.sur,kind:"collab"};
  };
  pubs.forEach(p=>{
    const ppl=[...new Map(parseAuthors(p.au).map(t=>{const r=resolve(t);return [r.id,r];})).values()];
    ppl.forEach(r=>{const n=nodes.get(r.id)||Object.assign(r,{papers:0,ids:new Set()});n.papers++;n.ids.add(p.id||p.title);nodes.set(r.id,n);});
    for(let i=0;i<ppl.length;i++)for(let j=i+1;j<ppl.length;j++){const k=[ppl[i].id,ppl[j].id].sort().join("~");edges.set(k,(edges.get(k)||0)+1);}
  });
  const N=[...nodes.values()];blk.hidden=N.length<2;if(N.length<2)return;
  const center=N.filter(n=>n.kind==="member").sort((a,b)=>b.papers-a.papers||(b.badge==="PI")-(a.badge==="PI"))[0]||N.sort((a,b)=>b.papers-a.papers)[0];
  N.forEach(n=>{n.withC=n===center?n.papers:[...n.ids].filter(x=>center.ids.has(x)).length;});
  const maxW=Math.max(1,...N.filter(n=>n!==center).map(n=>n.withC));
  const L=[...edges.entries()].map(([k,w])=>{const [a,b]=k.split("~");return {source:a,target:b,w};});
  const W=640,H=Math.max(300,Math.min(600,260+N.length*10)),R=Math.min(W,H)/2-36;
  const rad=n=>n===center?0:R*(0.28+0.72*(1-n.withC/maxW)*(N.length>3?1:0.6));
  const size=n=>n===center?11:3.5+3*Math.sqrt(n.papers);
  N.forEach((n,i)=>{const a=i/N.length*2*Math.PI;n.x=W/2+Math.cos(a)*rad(n);n.y=H/2+Math.sin(a)*rad(n);});
  center.fx=W/2;center.fy=H/2;
  const sim=d3.forceSimulation(N).force("link",d3.forceLink(L).id(n=>n.id).strength(.015)).force("charge",d3.forceManyBody().strength(-90)).force("r",d3.forceRadial(rad,W/2,H/2).strength(1)).force("c",d3.forceCollide(n=>size(n)+12)).stop();
  for(let i=0;i<400;i++)sim.tick();
  const xs=N.map(n=>n.x),ys=N.map(n=>n.y),pad=90;const minX=Math.min(...xs)-30,maxX=Math.max(...xs)+pad+40,minY=Math.min(...ys)-24,maxY=Math.max(...ys)+24;
  const vw=Math.max(640,maxX-minX),vh=Math.max(280,maxY-minY),vx=(minX+maxX)/2-vw/2,vy=(minY+maxY)/2-vh/2;
  const svg=d3.select("#collab").attr("viewBox",`${vx} ${vy} ${vw} ${vh}`);svg.selectAll("*").remove();
  const col=k=>k==="member"?"var(--violet)":k==="alum"?"var(--rose)":"var(--faint)";
  svg.append("g").selectAll("line").data(L).join("line").attr("x1",l=>l.source.x).attr("y1",l=>l.source.y).attr("x2",l=>l.target.x).attr("y2",l=>l.target.y)
    .attr("stroke","var(--faint)").attr("stroke-opacity",.55).attr("stroke-width",l=>Math.min(3,.8+.5*(l.w-1)));
  const g=svg.append("g").selectAll("g").data(N).join("g").attr("transform",n=>`translate(${n.x},${n.y})`);
  g.append("circle").attr("r",size).attr("fill",n=>n===center?"var(--fg)":col(n.kind));
  g.append("title").text(n=>`${n.label} · ${n.papers} paper${n.papers===1?"":"s"}${n===center?"":`, ${n.withC} with ${center.label.split(" ")[0]}`}`);
  g.filter(n=>N.length<=15||n===center||n.kind!=="collab"||n.papers>=2).append("text").attr("class",n=>n===center?"center":"").attr("x",n=>size(n)+4).attr("y",4).text(n=>n.label);
  const cnt=k=>N.filter(n=>n.kind===k).length;
  document.getElementById("collab-legend").innerHTML="";
  [["member","Team members","var(--violet)"],["alum","Alumni","var(--rose)"],["collab","Collaborators","var(--faint)"]].forEach(([k,lab,c])=>{const n=cnt(k);if(!n&&k!=="member")return;const s=document.createElement("span");s.innerHTML=`<i style="background:${c}"></i>`;s.appendChild(document.createTextNode(`${lab} (${n})`));document.getElementById("collab-legend").appendChild(s);});
  document.getElementById("collab-note").textContent=`Built from the Publications list. The closer to the middle and the larger the circle, the more papers with ${center.label.split(" ")[0]}; a line joins two people who wrote one together. ${N.length>15?"Names are shown for the team, alumni and anyone on two or more papers; point at a circle to see the rest.":"Point at a circle to see the number of papers."}`;
}
/* ---------- homepage: bridge/substitute slider ---------- */
(function(){
  const STOPS=[
    ["Bridge","He tells the AI what's wrong, and it nudges him to talk to a friend. That week, he books a counseling session.","b"],
    ["Leaning bridge","He vents to the AI most nights, and it keeps pointing him to people. He starts replying to his brother again.","b"],
    ["Could go either way","Talking to the AI is a relief. Whether it leads anywhere depends on what it says next. This is what our studies test.",""],
    ["Leaning substitute","Talking to the AI feels easier than talking to friends. He cancels dinner plans to stay in and chat.","s"],
    ["Substitute","The AI becomes the only place he goes. Months later, no one in his life knows he's been struggling.","s"]];
  const r=document.getElementById("tug");if(!r)return;
  const card=document.getElementById("tug-out");
  function upd(){const [t,p,c]=STOPS[+r.value];document.getElementById("tug-t").textContent=t;document.getElementById("tug-p").textContent=p;card.className="tug-card"+(c?" "+c:"");r.setAttribute("aria-valuetext",t);}
  r.addEventListener("input",upd);upd();
})();

/* ---------- studies ---------- */
const DEFAULT_STUDIES=[
  {title:"Scoping review",desc:"Mapping what is already known about AI and mental health help-seeking in Asia, with particular attention to men.",status:"Underway · Oct 2026 to Jan 2027",tone:"on"},
  {title:"Systematic review and meta-analysis",desc:"Pooling comparable results to estimate how AI tools relate to mental health help-seeking.",status:"Planned",tone:"next"},
  {title:"Feasibility trial",desc:"A small randomized trial of Ora and Sol with young Malaysian men, testing whether a full trial is workable and safe.",status:"Ethics review",tone:"next"},
  {title:"Full trial",desc:"A multi-site trial testing whether Sol helps men reach people, and why. It goes ahead only if the feasibility trial says go.",status:"From 2028",tone:"later"}
];
function renderStudies(list){
  const ol=document.getElementById("study-list");if(!ol)return;ol.innerHTML="";
  (list||DEFAULT_STUDIES).filter(x=>x&&x.title&&!x.hidden).forEach((x,i)=>{
    const li=document.createElement("li");li.className="sitem";
    li.innerHTML=`<span class="sn"></span><div><h2></h2><p></p></div><span class="stat"></span>`;
    li.querySelector(".sn").textContent="Study "+(i+1);li.querySelector("h2").textContent=x.title;
    const p=li.querySelector("p");if(x.desc)p.textContent=x.desc;else p.remove();
    const st=li.querySelector(".stat");if(x.status){st.textContent=x.status;st.classList.add(x.tone==="on"?"on":x.tone==="later"?"later":"next");}else st.remove();
    ol.appendChild(li);
  });
  const hs=document.getElementById("home-studies");
  if(hs){hs.innerHTML="";(list||DEFAULT_STUDIES).filter(x=>x&&x.title&&!x.hidden).forEach((x,i)=>{
    const li=document.createElement("li");const a=document.createElement("a");a.href="#studies";
    a.innerHTML='<span class="sn"></span><b></b>'+(x.status?'<span class="stat"></span>':"");
    a.querySelector(".sn").textContent="Study "+(i+1);a.querySelector("b").textContent=x.title;
    if(x.status){const st=a.querySelector(".stat");st.textContent=x.status;st.classList.add(x.tone==="on"?"on":x.tone==="later"?"later":"next");}
    li.appendChild(a);hs.appendChild(li);});}
}
renderStudies();
function applySite(d){
  d.texts=d.texts||{};
  window.SITE=d;applyNav(d.nav);window.applyRecruit(d.recruit);window.initPubs(d.pubs);window.initBlog(d.posts);
  if(d.team)renderTeam(d.team);
  renderAlumni(d.alumni);try{renderCollab(d);}catch(e){}
  renderStudies(d.studies);
  if(!document.body.classList.contains("editing"))applyTexts(d.texts);
}
fetch("site-data.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw 0;return r.json();}).then(applySite).catch(()=>{
  document.getElementById("blog-list").innerHTML='<p class="empty">Posts could not be loaded. Refresh to try again.</p>';
  document.getElementById("pub-list").innerHTML='<p class="empty">Publications could not be loaded. Refresh to try again.</p>';
});

/* ---------- admin ---------- */
(function(){
  const $=id=>document.getElementById(id);
  let artifact=null,canEdit=false,draft=null,tab="recruit",editing=null,confirmDel=null,readOnly=false,editMode=false;
  const clone=o=>JSON.parse(JSON.stringify(o));
  const dirty=()=>!!(draft&&window.SITE&&JSON.stringify(draft)!==JSON.stringify(window.SITE));
  function toast(t){const e=document.createElement("div");e.className="toast";e.setAttribute("role","status");e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),3400);}
  function stash(){try{sessionStorage.setItem("bos-draft",JSON.stringify(draft));}catch(e){}}
  function ensureDraft(){
    if(draft||!window.SITE)return !!draft;
    let saved=null;try{saved=JSON.parse(sessionStorage.getItem("bos-draft")||"null");}catch(e){}
    draft=saved&&saved.recruit?saved:clone(window.SITE);
    draft.texts=draft.texts||{};
    if(saved)toast("Restored your unpublished draft");
    return true;
  }
  const changeCount=()=>{if(!draft||!window.SITE)return 0;let n=0;["recruit","home","team","posts","pubs","timelines"].forEach(k=>{if(JSON.stringify(draft[k])!==JSON.stringify(window.SITE[k]))n++;});const a=draft.texts||{},b=window.SITE.texts||{};new Set([...Object.keys(a),...Object.keys(b)]).forEach(k=>{if(a[k]!==b[k])n++;});return n;};
  function bar(){
    const d=dirty(),n=changeCount();
    $("adm-bar").classList.toggle("dirty",d);
    $("adm-status").textContent=readOnly?"You can view this editor but not publish to the site.":(d?`Unpublished changes (${n})`:"No unpublished changes");
    $("adm-publish").disabled=!d||readOnly;$("adm-discard").disabled=!d;
    $("eb-count").textContent=d?`${n} unpublished change${n===1?"":"s"}`:"No unpublished changes";
    $("eb-publish").disabled=!d||readOnly;
    if(d)stash();else{try{sessionStorage.removeItem("bos-draft");}catch(e){}}
  }
  const slugify=t=>String(t).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"post";
  const fld=(label,html,hint)=>`<label class="fld"><span>${label}</span>${html}${hint?`<em>${hint}</em>`:""}</label>`;
  const tagsOf=v=>v.split(",").map(t=>t.trim().replace(/^#/,"").replace(/\s+/g,"-")).filter(Boolean);
  const btn=(label,cls,fn)=>{const b=document.createElement("button");b.type="button";b.className="abtn"+(cls?" "+cls:"");b.textContent=label;b.onclick=fn;return b;};

  /* ---- list view shared by posts, pubs, team ---- */
  function listView(B,arr,opts){
    const top=document.createElement("div");top.className="adm-act";
    top.appendChild(btn(opts.newLabel,"",()=>{editing="new";render();}));
    if(opts.extraTop)opts.extraTop(top);
    B.appendChild(top);
    const list=document.createElement("div");
    const items=arr.map((x,i)=>({x,i}));if(opts.sort)items.sort(opts.sort);
    if(!items.length)list.innerHTML='<p class="empty">Nothing here yet.</p>';
    items.forEach(({x,i},pos)=>{
      const row=document.createElement("div");row.className="arow";
      row.innerHTML=`<div><b></b><small></small></div><div class="adm-act"></div>`;
      row.querySelector("b").textContent=opts.title(x);row.querySelector("small").textContent=opts.meta(x);
      const act=row.querySelector(".adm-act");
      if(confirmDel===i){
        const q=document.createElement("span");q.className="aq";q.textContent="Delete this?";
        act.append(q,btn("Delete","danger",()=>{arr.splice(i,1);confirmDel=null;bar();render();}),btn("Keep","ghost",()=>{confirmDel=null;render();}));
      }else{
        if(opts.order){
          const up=btn("↑","ghost sm",()=>{if(i>0){[arr[i-1],arr[i]]=[arr[i],arr[i-1]];bar();render();}});up.setAttribute("aria-label","Move up");up.disabled=i===0;
          const dn=btn("↓","ghost sm",()=>{if(i<arr.length-1){[arr[i+1],arr[i]]=[arr[i],arr[i+1]];bar();render();}});dn.setAttribute("aria-label","Move down");dn.disabled=i===arr.length-1;
          act.append(up,dn);
        }
        if(opts.view){const v=document.createElement("a");v.className="abtn ghost";v.textContent="View";v.href=opts.view(x);act.appendChild(v);}
        if(opts.toggle){const on=!x.hidden;const t=document.createElement("button");t.type="button";t.className="vis"+(on?" on":"");t.setAttribute("role","switch");t.setAttribute("aria-checked",String(on));t.setAttribute("aria-label",(on?"Shown on site: ":"Hidden from site: ")+opts.title(x));t.innerHTML='<span class="knob"></span><span class="vl"></span>';t.querySelector(".vl").textContent=on?"Shown":"Hidden";t.onclick=()=>{if(on)x.hidden=true;else delete x.hidden;bar();render();};act.appendChild(t);}
        act.append(btn("Edit","ghost",()=>{editing=i;render();}),btn("Delete","danger",()=>{confirmDel=i;render();}));
      }
      list.appendChild(row);
    });
    B.appendChild(list);
  }
  function formShell(B,title,inner,onSave){
    const f=document.createElement("form");f.className="aform";
    f.innerHTML=`<h3></h3>${inner}<div class="adm-act"><button type="submit" class="abtn">Save to draft</button><button type="button" class="abtn ghost" data-cancel>Cancel</button></div><p class="note">Saving here updates your draft. Use Publish to site to make it live.</p>`;
    f.querySelector("h3").textContent=title;
    f.onsubmit=e=>{e.preventDefault();if(onSave(f)!==false){editing=null;bar();render();}};
    f.querySelector("[data-cancel]").onclick=()=>{editing=null;render();};
    B.appendChild(f);return f;
  }

  function render(){
    if(!draft)return;
    document.querySelectorAll(".adm-tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===tab)));
    const B=$("adm-body");B.innerHTML="";
    if(tab==="recruit")return recruitTab(B);
    if(tab==="home")return homeTab(B);
    if(tab==="studies"){
      if(!draft.studies)draft.studies=clone(DEFAULT_STUDIES);
      if(editing!==null)return studyForm(B,draft.studies);
      return listView(B,draft.studies,{newLabel:"Add study",order:true,toggle:true,title:x=>x.title,meta:x=>[x.status,x.hidden?"Hidden from site":""].filter(Boolean).join(" · "),
        extraTop:top=>{const s=document.createElement("span");s.className="aq";s.textContent="Numbered on the site in this order.";top.appendChild(s);}});
    }
    if(tab==="menu")return menuTab(B);
    if(tab==="resources")return resTab(B);
    if(tab==="alumni"){
      draft.alumni=draft.alumni||[];
      if(editing!==null)return alumForm(B,draft.alumni);
      return listView(B,draft.alumni,{newLabel:"Add alum",order:true,title:x=>x.name,meta:x=>[x.role,x.period,x.now].filter(Boolean).join(" · "),
        extraTop:top=>{const s=document.createElement("span");s.className="aq";s.textContent="Listed on About in this order. The section appears once there is at least one.";top.appendChild(s);}});
    }
    if(tab==="team"){
      if(editing!==null)return teamForm(B,draft.team);
      return listView(B,draft.team,{newLabel:"Add person",order:true,title:x=>x.name,meta:x=>[x.badge,x.sub].filter(Boolean).join(" · ")});
    }
    if(tab==="posts"){
      if(editing!==null)return postForm(B,draft.posts);
      return listView(B,draft.posts,{newLabel:"New post",sort:(a,b)=>String(b.x.date).localeCompare(String(a.x.date)),title:x=>x.title,meta:x=>x.date+" · "+(x.tags||[]).map(t=>"#"+t).join(" "),view:x=>"#blog-"+x.slug,toggle:true});
    }
    if(tab==="pubs"){
      if(editing!==null)return pubForm(B,draft.pubs);
      return listView(B,draft.pubs,{newLabel:"New publication",toggle:true,sort:(a,b)=>b.x.y-a.x.y,title:x=>x.title,meta:x=>[x.y,x.type,x.status,x.doi?"DOI":"",x.hidden?"Hidden from site":""].filter(Boolean).join(" · "),
        extraTop:top=>{const n=draft.pubs.filter(x=>x.hidden).length;const s=document.createElement("span");s.className="aq";s.textContent=`${draft.pubs.length-n} shown on site${n?` · ${n} hidden`:""}`;top.appendChild(s);}});
    }
  }
  function recruitTab(B){
    const r=draft.recruit=draft.recruit||{};
    if(!r.roles)r.roles=clone(defaultRoles(r));
    if(editing!==null)return roleForm(B,r.roles);
    const top=document.createElement("div");top.className="aform";
    top.innerHTML=`<h3>Recruitment</h3><p class="note">The positions below appear as cards on Get involved, in this order. Switch one off to hide it, or edit its status to show it as closed.</p>
      <label class="chk"><input type="checkbox" id="r-open"> Show the floating button on every page</label>
      ${fld("Floating button text",'<input id="r-pill" placeholder="Apply by Oct 30">',"Links to Get involved")}`;
    B.appendChild(top);
    $("r-open").checked=!!r.open;$("r-pill").value=r.pill||"";
    $("r-open").onchange=e=>{r.open=e.target.checked;bar();};
    $("r-pill").oninput=e=>{r.pill=e.target.value;bar();};
    listView(B,r.roles,{newLabel:"Add position",order:true,toggle:true,title:x=>x.title,meta:x=>[x.status||(x.open?"Open":"Closed"),x.hidden?"Hidden from site":""].filter(Boolean).join(" · ")});
  }
  function roleForm(B,arr){
    const p=editing==="new"?{title:"",open:true,status:"Open · rolling",points:[],send:"CV",subject:"Application—[Your Name]"}:clone(arr[editing]);
    formShell(B,editing==="new"?"Add position":"Edit position",
      fld("Position",'<input id="ro-title" required placeholder="Research assistants">')+
      `<div class="fgrid">${fld("Status",'<input id="ro-status" placeholder="Open · closes October 30, 2026">',"Shown in the badge, e.g. Open · rolling")}<label class="chk" style="align-self:end"><input type="checkbox" id="ro-open"> Open (green badge)</label></div>`+
      fld("Points",'<textarea id="ro-points" class="short"></textarea>',"One per line: what they do, time, who should apply")+
      `<div class="fgrid">${fld("Send",'<input id="ro-send">',"What to email, e.g. CV and transcript")}${fld("Email subject",'<input id="ro-subject">')}</div>`+
      `<label class="chk"><input type="checkbox" id="ro-show"> Show on the public site</label>`,
      ()=>{
        const title=$("ro-title").value.trim();if(!title){$("ro-title").focus();return false;}
        const o={title,open:$("ro-open").checked,status:$("ro-status").value.trim(),points:$("ro-points").value.split("\n").map(t=>t.trim()).filter(Boolean),send:$("ro-send").value.trim(),subject:$("ro-subject").value.trim()};
        if(!$("ro-show").checked)o.hidden=true;
        if(editing==="new")arr.push(o);else arr[editing]=o;
      });
    $("ro-title").value=p.title;$("ro-status").value=p.status||"";$("ro-open").checked=!!p.open;$("ro-points").value=(p.points||[]).join("\n");$("ro-send").value=p.send||"";$("ro-subject").value=p.subject||"";$("ro-show").checked=!p.hidden;
  }
  function homeTab(B){
    draft.home=draft.home||{typed:[]};
    B.innerHTML=`<div class="aform"><h3>Home page</h3>
      ${fld("Typed quotes",'<textarea id="h-typed" class="short"></textarea>',"One quote per line. They type out in turn above the title.")}
      <p class="note">To change any other text on the site, including headings, paragraphs and table cells, use <b>Edit page text</b> at the top.</p></div>`;
    $("h-typed").value=(draft.home.typed||[]).join("\n");
    $("h-typed").oninput=e=>{draft.home.typed=e.target.value.split("\n").map(t=>t.trim()).filter(Boolean);bar();};
  }
  function menuTab(B){
    draft.nav=draft.nav||{hidden:[]};
    const box=document.createElement("div");box.className="aform";
    box.innerHTML=`<h3>Menu</h3><p class="note">Turn pages off to remove them from the menu, the footer and the home page buttons. Visitors who open a hidden page's link go to the home page. You can still open hidden pages while signed in.</p><div class="navlist"></div>`;
    const L=box.querySelector(".navlist");
    NAV_ITEMS.forEach(([k,label])=>{
      const on=!draft.nav.hidden.includes(k);
      const row=document.createElement("div");row.className="arow";
      row.innerHTML=`<div><b></b><small></small></div><div class="adm-act"></div>`;
      row.querySelector("b").textContent=label;row.querySelector("small").textContent=k==="why"?"Footer and home page button":"Top menu and footer";
      const t=document.createElement("button");t.type="button";t.className="vis"+(on?" on":"");t.setAttribute("role","switch");t.setAttribute("aria-checked",String(on));t.setAttribute("aria-label",label+(on?" is shown":" is hidden"));
      t.innerHTML='<span class="knob"></span><span class="vl"></span>';t.querySelector(".vl").textContent=on?"Shown":"Hidden";
      t.onclick=()=>{const h=draft.nav.hidden;if(on)h.push(k);else h.splice(h.indexOf(k),1);applyNav(draft.nav);bar();render();};
      row.querySelector(".adm-act").appendChild(t);L.appendChild(row);
    });
    B.appendChild(box);
  }
  function timelinesTab(B){
    draft.timelines=draft.timelines||{study1:[],program:[]};
    [["program","Program timeline","Studies page · October 2026 to September 2029"]].forEach(([k,title,hint])=>{
      const box=document.createElement("div");box.className="aform";
      box.innerHTML=`<h3></h3><p class="note"></p><div class="tl"></div>`;
      box.querySelector("h3").textContent=title;box.querySelector(".note").textContent=hint+". Highlighted bars show in purple.";
      const tl=box.querySelector(".tl"),rows=draft.timelines[k];
      rows.forEach((r,i)=>{
        const row=document.createElement("div");row.className="tlrow";
        row.innerHTML=`<input aria-label="Activity" class="tl-l"><input type="date" aria-label="Start" class="tl-s"><input type="date" aria-label="End" class="tl-e"><label class="chk sm"><input type="checkbox" class="tl-k"> Highlight</label>`;
        const L=row.querySelector(".tl-l"),S=row.querySelector(".tl-s"),E=row.querySelector(".tl-e"),K=row.querySelector(".tl-k");
        L.value=r.label;S.value=r.start;E.value=r.end;K.checked=!!r.key;
        L.oninput=()=>{r.label=L.value;bar();};S.onchange=()=>{r.start=S.value;bar();buildGantt(k,rows);};E.onchange=()=>{r.end=E.value;bar();buildGantt(k,rows);};K.onchange=()=>{r.key=K.checked;bar();buildGantt(k,rows);};
        const acts=document.createElement("div");acts.className="adm-act";
        const up=btn("↑","ghost sm",()=>{if(i>0){[rows[i-1],rows[i]]=[rows[i],rows[i-1]];bar();render();}});up.disabled=i===0;up.setAttribute("aria-label","Move up");
        acts.append(up,btn("Remove","danger sm",()=>{rows.splice(i,1);bar();render();}));
        row.appendChild(acts);tl.appendChild(row);
      });
      box.appendChild(btn("Add row","ghost",()=>{const last=rows[rows.length-1];rows.push({label:"New activity",start:last?last.end:"2026-10-01",end:last?last.end:"2026-11-01",key:false});bar();render();}));
      B.appendChild(box);
    });
  }
  function teamForm(B,arr){
    const p=editing==="new"?{name:"",badge:"",icon:"person",sub:"",bio:"",works:"",email:"",links:[],open:false,photo:""}:clone(arr[editing]);
    const icons=[["megaphone","Megaphone (lead)"],["cap","Graduation cap"],["person","Person"],["group","Group"]];
    const f=formShell(B,editing==="new"?"Add person":"Edit person",
      `<div class="photo-edit"><div class="photo" id="t-ph"></div><div class="adm-act col"><label class="abtn ghost filebtn">Upload photo<input type="file" id="t-file" accept="image/*" hidden></label><button type="button" class="abtn ghost" id="t-rmph">Remove photo</button><em class="hint" id="t-phnote">Square or portrait photos work best.</em></div></div>`+
      fld("Name",'<input id="t-name" required>')+
      `<div class="fgrid">${fld("Badge",'<input id="t-badge">',"e.g. PI, Supervisor, RA")}${fld("Icon",'<select id="t-icon">'+icons.map(([v,l])=>`<option value="${v}"${v===p.icon?" selected":""}>${l}</option>`).join("")+'</select>')}</div>`+
      fld("Subtitle",'<input id="t-sub">',"Shown in italics under the name")+
      fld("Bio",'<textarea id="t-bio" class="short"></textarea>',"Blank line between paragraphs · **bold** · [link](https://…)")+
      fld("Selected work",'<textarea id="t-works" class="short"></textarea>',"One item per line (optional)")+
      fld("Name in citations",'<input id="t-cite" placeholder="Ban, B. R. J.; Ban, R. J.">',"Optional. How their name appears in author lists, so the collaborator network links them. Usually matched automatically.")+
      `<div class="fgrid">${fld("Email",'<input id="t-email" type="email">')}<label class="chk"><input type="checkbox" id="t-open"> Open position (dashed outline)</label></div>`+
      `<h4 class="fsub">Links</h4><p class="note">Fill in any that apply. Empty ones are hidden. Each shows as a chip under the bio.</p>`+
      `<div class="fgrid">${LINK_TYPES.map(([k,l,,ph])=>fld(l,`<input id="t-l-${k}" placeholder="${ph}">`)).join("")}</div>`+
      `<div class="fgrid">${fld("Other link label",'<input id="t-xlabel">',"e.g. lab page, portfolio, get involved")}${fld("Other link",'<input id="t-xurl">',"https://… or #get-involved")}</div>`,
      ()=>{
        const name=$("t-name").value.trim();if(!name){$("t-name").focus();return false;}
        const links=[];LINK_TYPES.forEach(([k])=>{const u=normUrl(k,$("t-l-"+k).value);if(u)links.push({type:k,url:u});});
        const xu=normUrl("link",$("t-xurl").value);if(xu)links.push({type:"link",url:xu,label:$("t-xlabel").value.trim()||"link"});
        const bad=LINK_TYPES.find(([k])=>$("t-l-"+k).value.trim()&&!normUrl(k,$("t-l-"+k).value));if(bad){const el=$("t-l-"+bad[0]);el.setCustomValidity("Enter a full web address starting with https://");el.reportValidity();el.oninput=()=>el.setCustomValidity("");return false;}
        const o={name,badge:$("t-badge").value.trim(),icon:$("t-icon").value,sub:$("t-sub").value.trim(),bio:$("t-bio").value,works:$("t-works").value,email:$("t-email").value.trim(),links,open:$("t-open").checked,photo:p.photo||"",cite:$("t-cite").value.trim()};
        if(editing==="new")arr.push(o);else arr[editing]=o;
      });
    $("t-name").value=p.name;$("t-badge").value=p.badge;$("t-sub").value=p.sub;$("t-bio").value=p.bio;$("t-works").value=p.works;$("t-email").value=p.email;$("t-open").checked=!!p.open;$("t-cite").value=p.cite||"";
    memberLinks(p).forEach(lk=>{if(lk.type!=="link"&&$("t-l-"+lk.type)&&!$("t-l-"+lk.type).value)$("t-l-"+lk.type).value=lk.url;else{$("t-xlabel").value=lk.label||"";$("t-xurl").value=lk.url;}});
    const showPh=()=>{const ph=$("t-ph");ph.innerHTML="";ph.className="photo"+(p.photo?"":" open");if(p.photo){const i=document.createElement("img");i.src=p.photo;i.alt="";ph.appendChild(i);}else{const sp=document.createElement("span");sp.textContent=initials($("t-name").value||p.name);ph.appendChild(sp);}$("t-rmph").disabled=!p.photo;};
    showPh();
    $("t-rmph").onclick=()=>{p.photo="";showPh();};
    $("t-file").onchange=async e=>{
      const file=e.target.files&&e.target.files[0];if(!file)return;
      const note=$("t-phnote");note.textContent="Uploading…";
      try{
        const assets=window.claude&&await window.claude.use("assets");
        if(!assets){note.textContent="Photo upload isn't available in this view.";return;}
        const up=await assets.upload(file);p.photo=up.url;showPh();note.textContent="Uploaded. Save to draft, then publish.";
      }catch(err){note.textContent=err&&err.code==="too_large"?"That file is too large. Try a photo under 20 MB.":"Upload failed. Try another image.";}
      e.target.value="";
    };
  }
  function studyForm(B,arr){
    const p=editing==="new"?{title:"",desc:"",status:"",tone:"next"}:clone(arr[editing]);
    const tones=[["on","Green · underway"],["next","Purple · planned or in preparation"],["later","Gray · later"]];
    formShell(B,editing==="new"?"Add study":"Edit study",
      fld("Title",'<input id="st-title" required placeholder="Systematic review and meta-analysis">')+
      fld("Description",'<textarea id="st-desc" class="short"></textarea>',"One or two sentences")+
      `<div class="fgrid">${fld("Status",'<input id="st-status" placeholder="Underway · Oct 2026 to Jan 2027">',"Shown as a small label")}${fld("Label color",'<select id="st-tone">'+tones.map(([v,l])=>`<option value="${v}"${v===(p.tone||"next")?" selected":""}>${l}</option>`).join("")+'</select>')}</div>`+
      `<label class="chk"><input type="checkbox" id="st-show"> Show on the public site</label>`,
      ()=>{
        const title=$("st-title").value.trim();if(!title){$("st-title").focus();return false;}
        const o={title,desc:$("st-desc").value.trim(),status:$("st-status").value.trim(),tone:$("st-tone").value};
        if(!$("st-show").checked)o.hidden=true;
        if(editing==="new")arr.push(o);else arr[editing]=o;
        renderStudies(arr);
      });
    $("st-title").value=p.title;$("st-desc").value=p.desc||"";$("st-status").value=p.status||"";$("st-show").checked=!p.hidden;
  }
  function alumForm(B,arr){
    const p=editing==="new"?{name:"",role:"",period:"",now:"",link:"",cite:""}:clone(arr[editing]);
    formShell(B,editing==="new"?"Add alum":"Edit alum",
      fld("Name",'<input id="al-name" required>')+
      fld("Role on the program",'<input id="al-role" placeholder="Research assistant, scoping review">')+
      `<div class="fgrid">${fld("Period",'<input id="al-period" placeholder="2026–2027">')}${fld("Where they are now",'<input id="al-now" placeholder="now Master\'s student at …">',"Optional")}</div>`+
      `<div class="fgrid">${fld("Link",'<input id="al-link" placeholder="https://…">',"Optional, e.g. LinkedIn or personal site")}${fld("Name in citations",'<input id="al-cite" placeholder="Tan, A. B.">',"Optional. Links them to their papers in the network; separate variants with ;")}</div>`,
      ()=>{
        const name=$("al-name").value.trim();if(!name){$("al-name").focus();return false;}
        const li=$("al-link"),link=li.value.trim()?normUrl("link",li.value):"";
        if(li.value.trim()&&!/^https?:\/\//.test(link)){li.setCustomValidity("Enter a full web address starting with https://");li.reportValidity();li.oninput=()=>li.setCustomValidity("");return false;}
        const o={name,role:$("al-role").value.trim(),period:$("al-period").value.trim(),now:$("al-now").value.trim(),link,cite:$("al-cite").value.trim()};
        if(editing==="new")arr.push(o);else arr[editing]=o;
      });
    $("al-name").value=p.name;$("al-role").value=p.role||"";$("al-period").value=p.period||"";$("al-now").value=p.now||"";$("al-link").value=p.link||"";$("al-cite").value=p.cite||"";
  }
  function postForm(B,arr){
    const p=editing==="new"?{slug:"",date:new Date().toISOString().slice(0,10),title:"",dek:"",tags:[],body:""}:clone(arr[editing]);
    formShell(B,editing==="new"?"New post":"Edit post",
      fld("Title",'<input id="p-title" required>')+
      `<div class="fgrid">${fld("Date",'<input id="p-date" type="date" required>')}${fld("Tags",'<input id="p-tags">',"Comma separated, e.g. study-1, methods")}</div>`+
      fld("Summary",'<input id="p-dek">',"One sentence shown in the post list")+
      `<div class="fld"><span class="fl">Cover image</span><div class="cover-edit"><div class="cv" id="p-cv"></div><div class="adm-act col"><label class="abtn ghost filebtn">Upload cover<input type="file" id="p-cfile" accept="image/*" hidden></label><button type="button" class="abtn ghost" id="p-crm">Remove</button><em class="hint" id="p-cnote">Optional. Wide images work best.</em></div></div></div>`+
      fld("Post",'<textarea id="p-body"></textarea>',"Blank line between paragraphs · ## Heading · - list item · > quote · **bold** · [link](https://…) · ![caption](image link) on its own line")+
      `<div class="adm-act"><label class="abtn ghost filebtn">Insert image in post<input type="file" id="p-ifile" accept="image/*" hidden></label><em class="hint" id="p-inote">Goes where the cursor is</em></div>`+
      `<label class="chk"><input type="checkbox" id="p-show"> Show on the public site</label>`,
      ()=>{
        const title=$("p-title").value.trim();if(!title){$("p-title").focus();return false;}
        const o={slug:p.slug||slugify(title),date:$("p-date").value,title,dek:$("p-dek").value.trim(),tags:tagsOf($("p-tags").value),body:$("p-body").value};
        if(p.cover)o.cover=p.cover;if(!$("p-show").checked)o.hidden=true;
        if(editing==="new"){const base=o.slug;let n=2;while(arr.some(x=>x.slug===o.slug))o.slug=base+"-"+n++;arr.push(o);}else arr[editing]=o;
      });
    $("p-title").value=p.title;$("p-date").value=p.date;$("p-tags").value=(p.tags||[]).join(", ");$("p-dek").value=p.dek||"";$("p-body").value=p.body||"";$("p-show").checked=!p.hidden;
    const showCv=()=>{const cv=$("p-cv");cv.innerHTML="";if(p.cover&&safeUrl(p.cover)){const i=document.createElement("img");i.src=p.cover;i.alt="";cv.appendChild(i);}else cv.textContent="No cover";$("p-crm").disabled=!p.cover;};
    showCv();$("p-crm").onclick=()=>{delete p.cover;showCv();};
    const upload=async(input,note,done)=>{
      const file=input.files&&input.files[0];if(!file)return;note.textContent="Uploading…";
      try{
        const assets=window.claude&&await window.claude.use("assets");
        if(!assets){note.textContent="Image upload isn't available in this view.";return;}
        const up=await assets.upload(file);done(up.url,file);
      }catch(err){note.textContent=err&&err.code==="too_large"?"That image is too large. Try one under 4 MB.":"Upload failed. Try another image.";}
      input.value="";
    };
    $("p-cfile").onchange=e=>upload(e.target,$("p-cnote"),u=>{p.cover=u;showCv();$("p-cnote").textContent="Uploaded. Save to draft, then publish.";});
    $("p-ifile").onchange=e=>upload(e.target,$("p-inote"),(u,f)=>{
      const ta=$("p-body"),cap=f.name.replace(/\.[^.]+$/,"").replace(/[-_]+/g," ").replace(/[\[\]()]/g,"");
      const pos=ta.selectionStart??ta.value.length,before=ta.value.slice(0,pos),after=ta.value.slice(pos);
      const snip=(before&&!before.endsWith("\n\n")?(before.endsWith("\n")?"\n":"\n\n"):"")+`![${cap}](${u})`+"\n\n";
      ta.value=before+snip+after;ta.focus();ta.selectionStart=ta.selectionEnd=pos+snip.length;
      $("p-inote").textContent="Image added. Edit the caption inside ![ ] if you like.";
    });
  }
  function pubForm(B,arr){
    const p=editing==="new"?{id:"p"+Date.now().toString(36),y:new Date().getFullYear(),type:"Article",status:"In preparation",title:"",au:"Ban, B. R. J., & Lau, P. L.",venue:"",note:"",tags:[]}:arr[editing];
    const opt=(v,list)=>list.map(x=>`<option${x===v?" selected":""}>${x}</option>`).join("");
    formShell(B,editing==="new"?"New publication":"Edit publication",
      fld("Title",'<input id="u-title" required>')+
      `<div class="fgrid">${fld("Year",'<input id="u-y" type="number" min="1990" max="2100" required>')}${fld("Type",'<select id="u-type">'+opt(p.type,["Article","Protocol","Talk"])+'</select>')}</div>`+
      `<div class="fgrid">${fld("Status",'<select id="u-status">'+opt(p.status,["Published","Presented","In preparation","Planned"])+'</select>')}${fld("Tags",'<input id="u-tags">',"Comma separated")}</div>`+
      fld("Authors",'<input id="u-au">',"Your name is bolded automatically")+
      fld("Venue",'<input id="u-venue">',"Journal, conference or registry")+
      `<div class="fgrid">${fld("DOI",'<input id="u-doi" placeholder="10.1038/s41746-023-00979-5">',"Optional. Paste the DOI or its doi.org link")}${fld("Link",'<input id="u-url" placeholder="https://…">',"Optional, e.g. slides, preprint or OSF page")}</div>`+
      fld("Note",'<input id="u-note">',"Optional one-line summary")+
      `<label class="chk"><input type="checkbox" id="u-show"> Show on the public site</label>`,
      ()=>{
        const title=$("u-title").value.trim();if(!title){$("u-title").focus();return false;}
        const o={id:p.id,y:+$("u-y").value||p.y,type:$("u-type").value,status:$("u-status").value,title,au:$("u-au").value.trim(),venue:$("u-venue").value.trim(),tags:tagsOf($("u-tags").value)};
        const note=$("u-note").value.trim();if(note)o.note=note;
        const di=$("u-doi"),doi=normDoi(di.value);
        if(doi&&!DOI_RE.test(doi)){di.setCustomValidity("A DOI starts with 10. followed by a slash, e.g. 10.1037/cou0000176");di.reportValidity();di.oninput=()=>di.setCustomValidity("");return false;}
        if(doi)o.doi=doi;
        const ui=$("u-url"),url=$("u-url").value.trim()?normUrl("link",$("u-url").value):"";
        if($("u-url").value.trim()&&!/^https?:\/\//.test(url)){ui.setCustomValidity("Enter a full web address starting with https://");ui.reportValidity();ui.oninput=()=>ui.setCustomValidity("");return false;}
        if(url)o.url=url;
        if(!$("u-show").checked)o.hidden=true;
        if(editing==="new")arr.push(o);else arr[editing]=o;
      });
    $("u-title").value=p.title;$("u-y").value=p.y;$("u-tags").value=(p.tags||[]).join(", ");$("u-au").value=p.au;$("u-venue").value=p.venue;$("u-note").value=p.note||"";$("u-doi").value=p.doi||"";$("u-url").value=p.url||"";$("u-show").checked=!p.hidden;
  }

  /* ---- research resources (private, editors only, saved immediately) ---- */
  const RES_CATS=["Protocols","Ethics","Literature","Forms and templates","Data management","Meeting notes","Other"];
  let res={items:[],state:"idle",err:"",q:"",cat:"All",editing:null,confirm:null,busy:"",unsub:null,me:null,names:{}};
  async function resStart(){
    if(res.state!=="idle")return;
    res.state="loading";render();
    try{
      const db=window.claude&&await window.claude.use("db");
      if(!db){res.state="error";res.err=(window.claude&&window.claude.host)?"Research resources are switched off because the site's GitHub repository isn't private. Make the repository private on GitHub, then reload this page.":"Private storage isn't available in this view. Open the site in claude.ai while signed in.";render();return;}
      try{const u=await window.claude.use("user");if(u){res.me=await u.id();res.user=u;}}catch(e){}
      res.db=db;
      res.unsub=db.collection("resources").orderBy("createdAt","desc").onSnapshot(snap=>{
        res.items=snap.docs.map(d=>Object.assign({id:d.id},d.data()));res.state="ready";resNames();if(tab==="resources")render();
      },e=>{res.state="error";res.err=e&&e.code==="permission_denied"?"Only site editors can see research resources.":"Resources could not be loaded. Refresh to try again.";if(tab==="resources")render();});
    }catch(e){res.state="error";res.err="Resources could not be loaded. Refresh to try again.";render();}
  }
  async function resNames(){
    if(!res.user||!res.user.profiles)return;
    const ids=[...new Set(res.items.map(x=>x.addedBy).filter(Boolean))].filter(id=>!(id in res.names));
    if(!ids.length)return;
    try{const ps=await res.user.profiles(ids);ids.forEach(id=>res.names[id]=(ps[id]&&ps[id].name)||"");if(tab==="resources")render();}catch(e){}
  }
  const fmtSize=n=>!n?"":n<1024*1024?Math.max(1,Math.round(n/1024))+" KB":(n/1048576).toFixed(1)+" MB";
  const fmtDate=t=>t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";
  function resTab(B){
    resStart();
    const wrap=document.createElement("div");wrap.className="resv";
    wrap.innerHTML=`<div class="res-note"><b>Private to site editors.</b> Resources save as soon as you add them and never appear on the public site. Don't upload participant data or anything that identifies a person.</div>`;
    B.appendChild(wrap);
    if(res.state==="loading"||res.state==="idle"){const p=document.createElement("p");p.className="empty";p.textContent="Loading resources…";B.appendChild(p);return;}
    if(res.state==="error"){const p=document.createElement("p");p.className="empty";p.textContent=res.err;B.appendChild(p);return;}
    if(res.editing)return resForm(B);
    const top=document.createElement("div");top.className="adm-act";
    top.append(btn("Upload file","",()=>{res.editing={kind:"file"};render();}),btn("Add link","ghost",()=>{res.editing={kind:"link"};render();}),btn("Add note","ghost",()=>{res.editing={kind:"note"};render();}));
    B.appendChild(top);
    const bar=document.createElement("div");bar.className="res-filter";
    bar.innerHTML=`<label class="srch"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg><input id="res-q" type="search" placeholder="Search resources" aria-label="Search resources"></label><div class="seg" id="res-cats"></div>`;
    B.appendChild(bar);
    const qi=bar.querySelector("#res-q");qi.value=res.q;qi.oninput=e=>{res.q=e.target.value.trim().toLowerCase();drawList();};
    const cats=bar.querySelector("#res-cats");
    ["All",...RES_CATS].forEach(c=>{const n=c==="All"?res.items.length:res.items.filter(x=>x.category===c).length;if(c!=="All"&&!n)return;const b=document.createElement("button");b.type="button";b.className="fb";b.setAttribute("aria-pressed",String(res.cat===c));b.innerHTML='<span></span><span class="c"></span>';b.firstChild.textContent=c;b.lastChild.textContent=n;b.onclick=()=>{res.cat=c;render();};cats.appendChild(b);});
    const list=document.createElement("div");list.className="reslist";B.appendChild(list);
    function drawList(){
      list.innerHTML="";
      const shown=res.items.filter(x=>(res.cat==="All"||x.category===res.cat)&&(!res.q||[x.title,x.notes,x.fileName,x.category,(x.tags||[]).join(" ")].join(" ").toLowerCase().includes(res.q)));
      if(!res.items.length){list.innerHTML='<p class="empty">No resources yet. Upload a protocol, ethics form or reading list, or add a link to a shared folder.</p>';return;}
      if(!shown.length){list.innerHTML='<p class="empty">Nothing matches.</p>';return;}
      shown.forEach(x=>{
        const row=document.createElement("div");row.className="resrow";
        const icon=x.kind==="file"?LINK_ICON.cv:x.kind==="link"?LINK_ICON.link:IC("M5 4h14v16H5zM8 8h8M8 12h8M8 16h5");
        row.innerHTML=`<span class="resic">${icon}</span><div class="resmain"><b></b><small></small><p class="resnotes"></p><div class="ptags"></div></div><div class="adm-act"></div>`;
        row.querySelector("b").textContent=x.title||x.fileName||"Untitled";
        const who=x.addedBy?(x.addedBy===res.me?"you":(res.names[x.addedBy]||"an editor")):"";
        row.querySelector("small").textContent=[x.category,x.kind==="file"?(x.fileName||"")+(x.size?" · "+fmtSize(x.size):""):x.kind==="link"?(String(x.url||"").replace(/^https?:\/\//,"").split("/")[0]):"Note",fmtDate(x.createdAt)+(who?" by "+who:"")].filter(Boolean).join(" · ");
        const n=row.querySelector(".resnotes");if(x.notes){n.innerHTML=inline(x.kind==="note"?x.notes:String(x.notes).split("\n")[0]);}else n.remove();
        const tg=row.querySelector(".ptags");(x.tags||[]).forEach(t=>{const s=document.createElement("span");s.className="ht";s.textContent="#"+t;tg.appendChild(s);});
        const act=row.querySelector(".adm-act");
        if(res.confirm===x.id){
          const q=document.createElement("span");q.className="aq";q.textContent=x.kind==="file"?"Delete this file?":"Delete this?";
          act.append(q,btn("Delete","danger",()=>resDelete(x)),btn("Keep","ghost",()=>{res.confirm=null;render();}));
        }else{
          const u=safeUrl(x.url);
          if(u&&x.kind!=="note"){const o=document.createElement("a");o.className="abtn ghost";o.textContent="Open";o.href=u;o.target="_blank";o.rel="noopener";act.appendChild(o);}
          act.append(btn("Edit","ghost",()=>{res.editing=Object.assign({},x);render();}),btn("Delete","danger",()=>{res.confirm=x.id;render();}));
        }
        list.appendChild(row);
      });
    }
    drawList();
  }
  function resForm(B){
    const x=res.editing,isNew=!x.id;
    const kindLabel={file:"file",link:"link",note:"note"}[x.kind];
    const f=document.createElement("form");f.className="aform";
    f.innerHTML=`<h3></h3>
      ${x.kind==="file"&&isNew?fld("File",'<input type="file" id="r-file" required>',res.db&&res.db.upload?"Any file type, including Word and Excel, up to 4 MB. For bigger files, add a link to the shared copy.":"PDF, image, video, CSV, Markdown, JSON or plain text, up to 20 MB. For Word or Excel files, save as PDF or add a link to the shared copy."):""}
      ${x.kind==="file"&&!isNew?`<p class="note">File: <b></b></p>`:""}
      ${fld("Title",'<input id="r-title"'+(x.kind==="link"?" required":"")+'>',x.kind==="file"?"Leave blank to use the file name":x.kind==="note"?"Leave blank to use the first line":"")}
      ${x.kind==="link"?fld("Link",'<input id="r-url" required placeholder="https://drive.google.com/…">',"A shared folder, Google Doc, OneDrive file, Zotero group, OSF page and so on"):""}
      <div class="fgrid">${fld("Category",'<select id="r-cat">'+RES_CATS.map(c=>`<option${c===(x.category||"Other")?" selected":""}>${c}</option>`).join("")+'</select>')}${fld("Tags",'<input id="r-tags">',"Comma separated, e.g. study-1, screening")}</div>
      ${fld(x.kind==="note"?"Note":"Notes",'<textarea id="r-notes" class="'+(x.kind==="note"?"":"short")+'"></textarea>',"**bold** · [link](https://…)")}
      <p class="note" id="r-status" role="status"></p>
      <div class="adm-act"><button type="submit" class="abtn" id="r-save">${isNew?"Add "+kindLabel:"Save changes"}</button><button type="button" class="abtn ghost" id="r-cancel">Cancel</button></div>`;
    f.querySelector("h3").textContent=(isNew?"Add ":"Edit ")+kindLabel;
    if(x.kind==="file"&&!isNew)f.querySelector(".note b").textContent=x.fileName||"";
    B.appendChild(f);
    $("r-title").value=x.title||"";$("r-tags").value=(x.tags||[]).join(", ");$("r-notes").value=x.notes||"";if($("r-url"))$("r-url").value=x.url||"";
    $("r-cancel").onclick=()=>{res.editing=null;render();};
    f.onsubmit=async e=>{
      e.preventDefault();
      const st=$("r-status"),save=$("r-save");
      const body={title:$("r-title").value.trim(),category:$("r-cat").value,tags:tagsOf($("r-tags").value),notes:$("r-notes").value,kind:x.kind,updatedAt:Date.now()};
      if(x.kind==="link"){const u=normUrl("link",$("r-url").value);if(!u||u[0]==="#"){const el=$("r-url");el.setCustomValidity("Enter a full web address starting with https://");el.reportValidity();el.oninput=()=>el.setCustomValidity("");return;}body.url=u;}
      if(x.kind==="note"&&!body.title)body.title=String(body.notes).split("\n")[0].slice(0,80)||"Note";
      save.disabled=true;
      try{
        if(x.kind==="file"&&isNew){
          const file=$("r-file").files[0];if(!file){save.disabled=false;return;}
          const own=res.db&&res.db.upload,max=own?4*1048576:20*1048576;
          if(file.size>max){st.textContent=`That file is over ${own?4:20} MB. Add a link to it instead.`;save.disabled=false;return;}
          let up;
          if(own){st.textContent="Uploading…";up=await res.db.upload(file);}
          else{
            const assets=window.claude&&await window.claude.use("assets");
            if(!assets){st.textContent="File uploads aren't available in this view.";save.disabled=false;return;}
            st.textContent="Uploading…";
            up=await assets.upload(file);
          }
          Object.assign(body,{url:up.url,assetId:up.id,fileName:file.name,size:up.sizeBytes||file.size,contentType:up.contentType||file.type});
          if(!body.title)body.title=file.name.replace(/\.[^.]+$/,"");
        }
        if(isNew){body.createdAt=Date.now();if(res.me)body.addedBy=res.me;await res.db.collection("resources").add(body);}
        else{await res.db.doc("resources/"+x.id).update(body);}
        res.editing=null;render();toast(isNew?"Added to resources":"Saved");
      }catch(err){
        const c=err&&err.code;save.disabled=false;
        st.textContent=c==="unsupported_type"||c==="invalid_content"||c==="invalid_argument"?"This file type can't be uploaded. Save it as PDF, or add a link to it instead.":c==="too_large"?"That file is too large. Add a link to it instead.":c==="quota_exceeded"?"Storage is full. Delete old files, or add links instead.":c==="permission_denied"||c==="not_granted"?"Only site editors can add resources.":"Saving failed. Try again in a moment.";
      }
    };
  }
  async function resDelete(x){
    try{
      if(x.kind==="file"&&x.assetId){try{if(res.db.deleteFile)await res.db.deleteFile(x.assetId);else{const a=await window.claude.use("assets");if(a)await a.delete(x.assetId);}}catch(e){}}
      await res.db.doc("resources/"+x.id).delete();res.confirm=null;toast("Deleted");
    }catch(e){res.confirm=null;render();toast("Delete failed. Try again in a moment.");}
  }

  /* ---- edit page text ---- */
  function setEditMode(on){
    if(on&&!ensureDraft())return;
    editMode=on;document.body.classList.toggle("editing",on);
    $("edit-bar").hidden=!on;
    if(on){applyTexts(draft.texts);textEls().forEach(el=>{el.contentEditable="true";el.spellcheck=true;});
      if(location.hash==="#admin")location.hash="#home";
      toast("Click any text to edit it. Move between pages with the menu.");}
    else{textEls().forEach(el=>el.removeAttribute("contenteditable"));applyTexts((window.SITE||{}).texts);}
    const f=$("float");if(f&&on)f.hidden=true;
  }
  document.addEventListener("input",e=>{
    if(!editMode)return;const el=e.target.closest&&e.target.closest("[data-k][contenteditable]");if(!el)return;
    const k=el.dataset.k,v=cleanHTML(el.innerHTML);
    if(v===cleanHTML(ORIG[k]))delete draft.texts[k];else draft.texts[k]=v;
    bar();
  });
  document.addEventListener("paste",e=>{
    if(!editMode||!e.target.closest||!e.target.closest("[data-k][contenteditable]"))return;
    e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData("text/plain");document.execCommand("insertText",false,t);
  });
  document.addEventListener("click",e=>{
    if(!editMode)return;const a=e.target.closest("[contenteditable] a");if(a)e.preventDefault();
  },true);
  document.addEventListener("keydown",e=>{
    if(!editMode)return;const el=e.target.closest&&e.target.closest("[data-k][contenteditable]");if(!el)return;
    if(e.key==="Enter"&&!e.shiftKey&&!/^(LI|TD|TH)$/.test(el.tagName)){e.preventDefault();el.blur();}
    if((e.metaKey||e.ctrlKey)&&(e.key==="b"||e.key==="i")){e.preventDefault();document.execCommand(e.key==="b"?"bold":"italic");}
  });
  $("eb-done").onclick=()=>{setEditMode(false);location.hash="#admin";};
  $("eb-reset").onclick=()=>{
    const cur=textEls().find(el=>el.contains(document.activeElement)||el===document.activeElement);
    if(!cur){toast("Click into a piece of text first, then reset it.");return;}
    delete draft.texts[cur.dataset.k];cur.innerHTML=ORIG[cur.dataset.k];bar();toast("Reset to the original text");
  };

  /* ---- publish ---- */
  async function publish(){
    if(!artifact||!dirty())return;
    const bs=[$("adm-publish"),$("eb-publish")];bs.forEach(b=>{b.disabled=true;b.textContent="Publishing…";});
    stash();
    try{
      await artifact.publish({"site-data.json":JSON.stringify(draft,null,2)});
      const live=clone(draft);try{sessionStorage.removeItem("bos-draft");}catch(e){}
      applySite(live);
      toast("Published. The site is updated for everyone.");
    }catch(e){
      const c=e&&e.code;
      if(c==="conflict")toast("Someone else published first. The page will reload with their version; your draft is kept.");
      else if(["not_writer","not_granted","consent_required","not_declared"].includes(c)){readOnly=true;toast("You can't publish to this site. Ask the owner for edit access.");}
      else if(c==="capability_disabled"||c==="capability_removed")toast("Publishing isn't available in this view. Open the site in claude.ai to publish.");
      else if(c==="rate_limited")toast("Publishing too often. Wait a minute, then publish again.");
      else if(c==="too_large")toast("The site data is too large to publish. Shorten some posts.");
      else toast("Publishing failed. Your draft is kept; try again in a moment.");
    }finally{bs.forEach(b=>b.textContent="Publish to site");bar();}
  }
  $("adm-publish").onclick=publish;$("eb-publish").onclick=publish;
  $("adm-discard").onclick=()=>{draft=clone(window.SITE);applyNav(draft.nav);renderStudies(draft.studies);draft.texts=draft.texts||{};editing=null;confirmDel=null;if(editMode)applyTexts(draft.texts);buildGantt("study1",draft.timelines&&draft.timelines.study1);buildGantt("program",draft.timelines&&draft.timelines.program);bar();render();toast("Changes discarded");};
  $("adm-edittext").onclick=()=>setEditMode(true);
  document.querySelectorAll(".adm-tabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;editing=null;confirmDel=null;render();});

  window.__adminShow=function(){
    if(!canEdit){$("adm-gate").hidden=false;$("adm").hidden=true;return;}
    if(!ensureDraft()){$("adm-gate").hidden=false;$("adm-gate").textContent="Loading site content…";$("adm").hidden=true;setTimeout(window.__adminShow,500);return;}
    $("adm-gate").hidden=true;$("adm").hidden=false;
    bar();render();
  };
  (async()=>{
    const gate=$("adm-gate");
    try{
      const user=window.claude&&await window.claude.use("user");
      canEdit=user?await user.canEdit():false;
      if(canEdit)artifact=await window.claude.use("artifact");
    }catch(e){canEdit=false;}
    const host=window.claude&&window.claude.host;
    if(canEdit&&artifact){window.__isEditor=true;$("nav-admin").hidden=false;if(host&&host.signOutUrl){const so=document.createElement("a");so.className="abtn ghost";so.href=host.signOutUrl;so.textContent="Sign out";$("adm-bar").querySelector(".adm-act").prepend(so);}}
    else{canEdit=false;
      if(host&&host.signInUrl){
        gate.innerHTML="";
        const p=document.createElement("p");
        p.textContent=host.email?`You're signed in as ${host.email}, which isn't an admin account.`:"Sign in with an admin Google account to edit this site.";
        const a=document.createElement("a");a.className="abtn";a.style.marginTop="12px";a.href=host.email?host.signOutUrl:host.signInUrl;a.textContent=host.email?"Sign out":"Sign in with Google";
        gate.append(p,a);
      }else gate.textContent="Only editors of this site can make changes here. If you run this site, open it in claude.ai while signed in.";
    }
    if((location.hash||"").slice(1)==="admin")window.__adminShow();
  })();
})();


/* ---------- network ---------- */
(function(){
  if(!window.d3){document.getElementById("panel").innerHTML="<p>The network could not load. The rest of the site works as normal.</p>";return;}
  const groups={
    question:{label:"The question",shape:"star"},
    studies:{label:"Four studies",shape:"big"},
    people:{label:"People",shape:"circle"},
    ai:{label:"AI and Sol",shape:"square"},
    mechanism:{label:"Mechanism",shape:"tri"},
    stages:{label:"Help-seeking stages",shape:"ring"},
    context:{label:"Context",shape:"hollow"},
    method:{label:"Method",shape:"pill"},
    sources:{label:"Databases",shape:"small"},
    evidence:{label:"Evidence",shape:"diamond"},
    outputs:{label:"Outputs",shape:"pill"}
  };
  const N=[
    ["q","Bridge or Substitute?","question","Does talking to an AI companion lead Malaysian men toward help from people (a bridge), or away from it (a substitute)? Self-compassion is the proposed mechanism."],
    ["bridge","Bridge","question","The AI companion helps men take the first step toward friends, family and counselors."],
    ["sub","Substitute","question","The AI companion becomes the only place men go."],
    ["st1","Study 1 · Scoping review","studies","Maps what is known about AI and mental health help-seeking in Asia. October 2026 to January 2027."],
    ["st2","Study 3 · Feasibility RCT","studies","A small randomized trial of Ora and Sol with young Malaysian men. Tests whether a full trial is workable."],
    ["st3","Study 4 · Full trial","studies","A larger multi-site trial to give a clear answer. From 2028, only if Study 3 says go."],
    ["sr","Study 2 · Systematic review","studies","A systematic review and meta-analysis that pools comparable results to estimate how AI tools relate to help-seeking."],
    ["pi","Brendon Ban Ren Jie","people","Principal investigator. Counseling trainee who designed and built Ora and Sol, and leads all four studies."],
    ["sv","Assoc. Prof. Dr. Lau Poh Li","people","Supervisor of the program, Universiti Malaya."],
    ["ra","Research assistants","people","Two RAs share second screening and data charting for Study 1."],
    ["team","Trial and tech team","people","Open now, unpaid: research assistants, and people who code and work with AI to build Ora and Sol. Collaborators welcome."],
    ["ora","Ora app","ai","The study app: weekly check-ins, diary and a get-help page."],
    ["sol","Sol","ai","The AI companion inside Ora, with a safety escalation protocol and a researcher console."],
    ["chat","Chatbots","ai","Conversational agents that people talk to about how they feel."],
    ["screen","Screening tools","ai","AI that flags possible depression, anxiety or risk."],
    ["refer","Referral tools","ai","AI that routes people toward services."],
    ["sc","Self-compassion","mechanism","Treating yourself with kindness during difficulty (Neff, 2003). The proposed mechanism linking Sol to help-seeking."],
    ["ss","Self-stigma","mechanism","The shame attached to seeking help, measured with SSOSH."],
    ["mn","Masculine norms","mechanism","Conformity to norms such as self-reliance, measured with CMNI-30."],
    ["lof","Loss of face","mechanism","Concern about losing face, measured with the Loss of Face Scale."],
    ["ahs","Actual help-seeking","mechanism","The primary outcome (AHSQ): did men actually talk to someone?"],
    ["tpb","Theory of Planned Behavior","mechanism","The framework for the program (Ajzen, 1991)."],
    ["s1","Recognize","stages","Stage 1: noticing a difficulty (Rickwood et al., 2005)."],
    ["s2","Appraise","stages","Stage 2: judging that it warrants support."],
    ["s3","Select a source","stages","Stage 3: choosing who or what to turn to."],
    ["asia","Asia","context","Study 1 covers any Asian country and people of Asian background."],
    ["my","Malaysian men","context","Rarely included in help-seeking research; the population for Studies 3 and 4."],
    ["stigma","Stigma · face · family","context","Cultural pressures that shape help-seeking in Asia."],
    ["jbi","JBI · PRISMA-ScR","method","Scoping review methods (Peters et al., 2020; Tricco et al., 2018)."],
    ["screening","Dual screening","method","Independent screening of titles, abstracts and full texts."],
    ["rayyan","Rayyan · Covidence · Zotero","method","Screening and reference tools."],
    ["consort","CONSORT · SPIRIT","method","Reporting standards for the two trials."],
    ["lights","Progression criteria","method","Pre-set criteria decide whether Study 4 goes ahead."],
    ["pubmed","PubMed","sources","Biomedical database."],["psyc","PsycINFO","sources","Psychology database."],["scopus","Scopus","sources","Multidisciplinary database."],["wos","Web of Science","sources","Multidisciplinary database."],["acm","ACM","sources","Computing database."],["ieee","IEEE Xplore","sources","Engineering and computing database."],["mycite","MyCite","sources","Malaysian citation index."],["asean","ASEAN Citation Index","sources","Regional citation index."],
    ["rick","Rickwood 2005","evidence","Help-seeking as a staged process."],
    ["wong","Wong 2017","evidence","Masculine norms linked to poorer mental health and help-seeking attitudes."],
    ["addis","Addis & Mahalik 2003","evidence","Men, masculinity and the contexts of help seeking."],
    ["li","Li 2023","evidence","AI conversational agents reduce depression and distress."],
    ["lee","Lee 2019","evidence","Brief chatbot conversations increased self-compassion."],
    ["fang","Fang 2025","evidence","Heavier chatbot use linked to loneliness and less social contact."],
    ["neff","Neff 2003","evidence","Defines and measures self-compassion."],
    ["heath","Heath 2017","evidence","Self-compassion weakened the link between masculine norms and self-stigma in men."],
    ["ajzen","Ajzen 1991","evidence","The Theory of Planned Behavior."],
    ["paper","Review article","outputs","Study 1 article and gap map, submitted before Chinese New Year 2027."],
    ["gate","Go / amend / stop","outputs","The Study 3 progression decision, August 2027."],
    ["thesis","Manuscripts","outputs","Manuscripts for publication from all four studies, with final papers by 2029."]
  ].map(([id,label,group,desc])=>({id,label,group,desc}));
  const L=[
    ["q","bridge"],["q","sub"],["q","st1"],["q","sr"],["q","st2"],["q","st3"],["st1","sr"],["sr","st2"],["st2","st3"],["pi","sr"],["sr","li"],["sr","thesis"],
    ["pi","st1"],["team","st2"],["team","st3"],["team","sol"],["team","pi"],["pi","st2"],["pi","st3"],["pi","sv"],["ra","st1"],["ra","screening"],["ra","rayyan"],
    ["st2","ora"],["ora","sol"],["sol","st3"],["sol","sc"],["sol","chat"],["chat","screen"],["screen","refer"],["refer","s3"],["screen","s1"],
    ["sc","ss"],["mn","ss"],["lof","ss"],["ss","ahs"],["sc","ahs"],["tpb","ahs"],["ahs","bridge"],["ahs","sub"],["st3","ahs"],
    ["s1","s2"],["s2","s3"],["s3","ahs"],["st1","s1"],
    ["st1","asia"],["asia","stigma"],["stigma","lof"],["my","st2"],["my","st3"],["my","mn"],
    ["st1","jbi"],["jbi","screening"],["screening","rayyan"],["st2","consort"],["st3","consort"],["st2","lights"],["lights","gate"],
    ["st1","pubmed"],["st1","psyc"],["st1","scopus"],["st1","wos"],["st1","acm"],["st1","ieee"],["st1","mycite"],["st1","asean"],["pubmed","psyc"],["scopus","wos"],["acm","ieee"],["mycite","asean"],
    ["rick","s1"],["wong","mn"],["addis","mn"],["li","chat"],["li","bridge"],["lee","sc"],["fang","chat"],["fang","sub"],["neff","sc"],["heath","sc"],["heath","mn"],["ajzen","tpb"],
    ["st1","paper"],["st2","gate"],["gate","st3"],["st2","thesis"],["st3","thesis"]
  ].map(([s,t])=>({source:s,target:t}));

  const byId=Object.fromEntries(N.map(n=>[n.id,n]));
  const adj={};N.forEach(n=>adj[n.id]=new Set());L.forEach(l=>{adj[l.source].add(l.target);adj[l.target].add(l.source)});

  const svg=d3.select("#graph");
  const gHull=svg.append("g"),gLink=svg.append("g"),gNode=svg.append("g"),gLabel=svg.append("g");
  const hidden=new Set();
  let W=800,H=600,selected="q";

  // anchors: clusters arranged around the question
  const order=["studies","people","method","sources","outputs","context","stages","evidence","mechanism","ai"];
  let rot=0,hovering=false,dragging=false;
  function anchor(g){
    if(g==="question") return [W/2,H/2];
    const k=order.indexOf(g),a=-Math.PI/2+k*2*Math.PI/order.length+rot;
    const r=Math.min(W,H)*0.38;
    return [W/2+Math.cos(a)*r*(W>H?1.35:1),H/2+Math.sin(a)*r];
  }

  const sim=d3.forceSimulation(N)
    .force("link",d3.forceLink(L).id(d=>d.id).distance(l=>l.source.group===l.target.group?34:70).strength(l=>l.source.group===l.target.group?.7:.12))
    .force("charge",d3.forceManyBody().strength(-120))
    .force("x",d3.forceX(d=>anchor(d.group)[0]).strength(.16))
    .force("y",d3.forceY(d=>anchor(d.group)[1]).strength(.16))
    .force("collide",d3.forceCollide(d=>d.id==="q"?26:13));

  const link=gLink.selectAll("line").data(L).join("line").attr("stroke","var(--faint)").attr("stroke-width",1).attr("stroke-opacity",.7);

  const node=gNode.selectAll("g").data(N).join("g").attr("tabindex",0).attr("role","button").attr("aria-label",d=>d.label).style("cursor","pointer");
  node.each(function(d){
    const g=d3.select(this),s=groups[d.group].shape;
    if(d.id==="q"){g.append("circle").attr("r",22).attr("fill","none").attr("stroke","var(--line)").attr("stroke-width",6);g.append("circle").attr("r",14).attr("fill","var(--accent)").attr("stroke","var(--fg)").attr("stroke-width",1.5);return;}
    if(s==="star"){g.append("circle").attr("r",9).attr("fill",d.id==="bridge"?"var(--accent)":"var(--fg)").attr("stroke","var(--fg)").attr("stroke-width",1.2);}
    else if(s==="circle") g.append("circle").attr("r",9).attr("fill","var(--violet)");
    else if(s==="ring"){g.append("circle").attr("r",8).attr("fill","var(--bg)").attr("stroke","var(--violet-2)").attr("stroke-width",2.5);g.append("circle").attr("r",2.5).attr("fill","var(--violet)");}
    else if(s==="square") g.append("rect").attr("x",-7).attr("y",-7).attr("width",14).attr("height",14).attr("rx",2).attr("fill","var(--violet)");
    else if(s==="hollow") g.append("circle").attr("r",7).attr("fill","var(--bg)").attr("stroke","var(--violet)").attr("stroke-width",1.8);
    else if(s==="pill") g.append("rect").attr("x",-10).attr("y",-5).attr("width",20).attr("height",10).attr("rx",5).attr("fill",d.group==="outputs"?"var(--rose)":"var(--bg)").attr("stroke",d.group==="outputs"?"var(--rose)":"var(--violet-2)").attr("stroke-width",1.8);
    else if(s==="small") g.append("circle").attr("r",5).attr("fill","var(--violet-2)");
    else if(s==="big"){g.append("circle").attr("r",13).attr("fill","var(--fg)");g.append("circle").attr("r",5).attr("fill","var(--accent)");}
    else if(s==="tri") g.append("path").attr("d","M0 -9 L8 6 L-8 6 Z").attr("fill","var(--violet)");
    else if(s==="diamond") g.append("rect").attr("x",-6).attr("y",-6).attr("width",12).attr("height",12).attr("transform","rotate(45)").attr("fill","var(--violet-soft)").attr("stroke","var(--violet)").attr("stroke-width",1.4);
  });

  // labels: always for key nodes, others on focus
  const always=new Set(["q","bridge","sub","st1","sr","st2","st3","pi","sv","sol","ora","sc","ss","ahs","mn","my","li","fang","heath","gate","s1","s3","jbi"]);
  const label=gLabel.selectAll("text").data(N).join("text").text(d=>d.label)
    .attr("font-size",d=>d.id==="q"?15:12.5).attr("font-weight",d=>d.id==="q"?600:400).attr("dy",d=>d.id==="q"?-30:(d.group==="studies"?-19:-14)).attr("text-anchor","middle");
  const hullLabel=gLabel.selectAll("text.h").data(Object.keys(groups).filter(g=>g!=="question")).join("text").attr("class","h")
    .text(g=>groups[g].label).attr("font-size",14).attr("font-weight",500).attr("text-anchor","middle").style("fill","var(--muted)");
  const hull=gHull.selectAll("path").data(Object.keys(groups).filter(g=>g!=="question")).join("path").attr("fill","var(--hull)").attr("stroke","none");
  const line=d3.line().curve(d3.curveCatmullRomClosed.alpha(.7));

  function hullPts(g){
    const pts=[];N.forEach(n=>{if(n.group===g&&!hidden.has(g)){const p=22;pts.push([n.x-p,n.y],[n.x+p,n.y],[n.x,n.y-p],[n.x,n.y+p],[n.x-p*.7,n.y-p*.7],[n.x+p*.7,n.y+p*.7],[n.x+p*.7,n.y-p*.7],[n.x-p*.7,n.y+p*.7])}});
    return pts.length?d3.polygonHull(pts):null;
  }

  function update(){
    const focus=selected,nb=adj[focus]||new Set();
    node.style("opacity",d=>hidden.has(d.group)?0:(d.id===focus||nb.has(d.id)?1:.38)).style("pointer-events",d=>hidden.has(d.group)?"none":null);
    link.attr("stroke",l=>(l.source.id===focus||l.target.id===focus)?"var(--violet)":"var(--faint)")
        .attr("stroke-width",l=>(l.source.id===focus||l.target.id===focus)?1.8:1)
        .style("opacity",l=>(hidden.has(l.source.group)||hidden.has(l.target.group))?0:((l.source.id===focus||l.target.id===focus)?1:.45));
    label.style("opacity",d=>hidden.has(d.group)?0:(d.id===focus||nb.has(d.id)?1:(always.has(d.id)?.55:0)))
         .attr("font-weight",d=>d.id===focus||d.id==="q"?600:400);
    hullLabel.style("opacity",g=>hidden.has(g)?0:1);
  }

  sim.on("tick",()=>{
    N.forEach(d=>{d.x=Math.max(24,Math.min(W-24,d.x));d.y=Math.max(40,Math.min(H-20,d.y));});
    link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
    node.attr("transform",d=>`translate(${d.x},${d.y})`);
    label.attr("x",d=>d.x).attr("y",d=>d.y);
    hull.attr("d",g=>{const h=hullPts(g);return h?line(h):null;});
    hullLabel.each(function(g){const ns=N.filter(n=>n.group===g);const top=d3.min(ns,n=>n.y),cx=d3.mean(ns,n=>n.x);d3.select(this).attr("x",Math.max(70,Math.min(W-70,cx))).attr("y",Math.max(18,top-34));});
  });

  function select(id){selected=id;update();renderPanel();}
  node.on("click",(e,d)=>select(d.id)).on("keydown",(e,d)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(d.id);}});
  node.call(d3.drag()
    .on("start",(e,d)=>{dragging=true;if(!e.active)sim.alphaTarget(.25).restart();d.fx=d.x;d.fy=d.y;svg.style("cursor","grabbing")})
    .on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y})
    .on("end",(e,d)=>{dragging=false;if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;svg.style("cursor",null)}));

  function renderPanel(){
    const d=byId[selected],p=document.getElementById("panel");
    const nbs=[...adj[d.id]].map(id=>byId[id]).filter(n=>!hidden.has(n.group));
    p.innerHTML=`<span class="kind">${groups[d.group].label}</span><h3></h3><p></p><span class="conn">Connected to ${nbs.length}</span><ul></ul>`;
    p.querySelector("h3").textContent=d.label;p.querySelector("p").textContent=d.desc;
    const ul=p.querySelector("ul");
    nbs.forEach(n=>{const li=document.createElement("li"),b=document.createElement("button");b.textContent=n.label;b.onclick=()=>select(n.id);li.appendChild(b);ul.appendChild(li);});
  }

  // legend
  const lg=document.getElementById("legend");
  const icon={star:'<circle cx="7" cy="7" r="5.5" fill="var(--accent)" stroke="var(--fg)"/>',circle:'<circle cx="7" cy="7" r="5.5" fill="var(--violet)"/>',ring:'<circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--violet-2)" stroke-width="2"/>',square:'<rect x="2" y="2" width="10" height="10" rx="1.5" fill="var(--violet)"/>',hollow:'<circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--violet)" stroke-width="1.6"/>',pill:'<rect x="1" y="4" width="12" height="6" rx="3" fill="none" stroke="var(--violet-2)" stroke-width="1.6"/>',small:'<circle cx="7" cy="7" r="3.5" fill="var(--violet-2)"/>',big:'<circle cx="7" cy="7" r="6" fill="var(--fg)"/><circle cx="7" cy="7" r="2.5" fill="var(--accent)"/>',tri:'<path d="M7 1.5 L12.5 12 L1.5 12 Z" fill="var(--violet)"/>',diamond:'<rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="var(--violet-soft)" stroke="var(--violet)"/>'};
  Object.entries(groups).forEach(([k,g])=>{
    const b=document.createElement("button");b.setAttribute("aria-pressed","true");
    const ic=k==="outputs"?'<rect x="1" y="4" width="12" height="6" rx="3" fill="var(--rose)"/>':icon[g.shape];
    b.innerHTML=`<svg width="14" height="14" viewBox="0 0 14 14">${ic}</svg><span></span>`;b.querySelector("span").textContent=g.label;
    if(k==="question"){b.disabled=true;b.style.cursor="default";}
    b.onclick=()=>{if(hidden.has(k))hidden.delete(k);else hidden.add(k);b.setAttribute("aria-pressed",hidden.has(k)?"false":"true");if(hidden.has(byId[selected].group))selected="q";update();renderPanel();sim.alpha(.15).restart();};
    lg.appendChild(b);
  });

  function resize(){
    const r=document.getElementById("graph").getBoundingClientRect();
    if(!r.width) return;
    W=r.width;H=r.height;svg.attr("viewBox",`0 0 ${W} ${H}`);
    sim.force("x").x(d=>anchor(d.group)[0]);sim.force("y").y(d=>anchor(d.group)[1]);
    sim.alpha(.6).restart();
  }
  N.forEach(n=>{const [x,y]=[400,300];n.x=x+(Math.random()-.5)*200;n.y=y+(Math.random()-.5)*200;});
  window.__graphResize=resize;
  new ResizeObserver(resize).observe(document.getElementById("graph"));
  resize(); update(); renderPanel();
  // settle quickly so the first frame is readable
  for(let i=0;i<180;i++) sim.tick();
  sim.alpha(.05).restart();
  // gentle self-motion: the clusters slowly orbit the question
  const box=document.querySelector(".graph-box");
  box.addEventListener("pointerenter",()=>hovering=true);box.addEventListener("pointerleave",()=>hovering=false);
  box.addEventListener("focusin",()=>hovering=true);box.addEventListener("focusout",()=>hovering=false);
  const still=matchMedia("(prefers-reduced-motion: reduce)");
  setInterval(()=>{
    if(still.matches||hovering||dragging||document.hidden||document.getElementById("p-home").hidden)return;
    rot+=0.003;
    sim.force("x").x(d=>anchor(d.group)[0]);sim.force("y").y(d=>anchor(d.group)[1]);
    if(sim.alpha()<0.035)sim.alpha(0.035).restart();
  },60);
})();
