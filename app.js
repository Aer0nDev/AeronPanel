const $=id=>document.getElementById(id);
function tick(){const d=new Date();$("clock").textContent=d.toLocaleTimeString("en-PH",{hour12:false});$("time").textContent=d.toLocaleTimeString("en-PH",{hour:"numeric",minute:"2-digit"})+" PH";}
setInterval(tick,1000);tick();
function updateEstimate(){const d=+$("duration").value,m=+$("devices").value;$("estimate").textContent=`💰 ${m} device(s) for ${d} day(s)`} $("duration").onchange=updateEstimate;$("devices").oninput=updateEstimate;updateEstimate();
async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});const j=await r.json();if(!r.ok)throw Error(j.error||"Request failed");return j}
async function load(){const rows=await api("/api/licenses");$("keys").innerHTML=rows.map(r=>`<article class="key"><div class="top"><div><div class="keyname">🔑 ${esc(r.key)}</div><span class="badge ${r.status.toLowerCase()}">${r.status}</span></div><b>${r.duration_days}d</b></div><div class="meta">🎮 ${esc(r.game)}<br>📱 ${r.devices.length}/${r.max_devices} devices<br>🗓 Created: ${fmt(r.created_at)}<br>⏳ Expires: ${fmt(r.expires_at)}</div><div class="actions"><button class="copy" onclick="copyKey('${esc(r.key)}')">Copy Key</button><button onclick="resetDevices(${r.id})">Reset Devices</button><button onclick="revoke(${r.id})">Revoke</button><button class="danger" onclick="delKey(${r.id})">Delete</button></div></article>`).join("")||"<p>No licenses yet.</p>"}
async function createKey(){try{const r=await api("/api/licenses",{method:"POST",body:JSON.stringify({game:$("game").value,duration_days:+$("duration").value,max_devices:+$("devices").value,prefix:$("prefix").value,custom_key:$("custom").value})});$("notice").textContent="Created: "+r.key;$("custom").value="";load()}catch(e){$("notice").textContent="❌ "+e.message}}
async function revoke(id){if(confirm("Revoke this license?")){await api("/api/licenses/"+id+"/revoke",{method:"POST"});load()}}
async function resetDevices(id){if(confirm("Reset registered devices?")){await api("/api/licenses/"+id+"/reset-devices",{method:"POST"});load()}}
async function delKey(id){if(confirm("Delete this license permanently?")){await api("/api/licenses/"+id,{method:"DELETE"});load()}}
async function copyKey(k){await navigator.clipboard.writeText(k);$("notice").textContent="Copied: "+k}
function fmt(s){return new Date(s).toLocaleString("en-PH",{dateStyle:"medium",timeStyle:"short"})}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
load();