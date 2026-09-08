const express=require("express");
const path=require("path");
const crypto=require("crypto");
const Database=require("better-sqlite3");
const app=express(), db=new Database("licenses.db");
app.use(express.json()); app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS licenses(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 key TEXT UNIQUE NOT NULL,
 game TEXT NOT NULL,
 duration_days INTEGER NOT NULL,
 max_devices INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE',
 devices TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 license_id INTEGER,
 action TEXT,
 ip TEXT,
 created_at TEXT
);`);

const DAY=86400000;
function makeKey(prefix="YUNA"){
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
function addDays(date,n){return new Date(date.getTime()+n*DAY).toISOString();}
function log(id,action,req){db.prepare("INSERT INTO events(license_id,action,ip,created_at) VALUES(?,?,?,?,?)").run(id,action,req.ip,new Date().toISOString());}
function get(id){return db.prepare("SELECT * FROM licenses WHERE id=?").get(id);}
function normalize(row){if(!row)return null; return {...row,devices:JSON.parse(row.devices)}}

app.get("/api/licenses",(req,res)=>{
  const rows=db.prepare("SELECT * FROM licenses ORDER BY id DESC").all().map(normalize);
  res.json(rows);
});
app.post("/api/licenses",(req,res)=>{
  const {game="CUSTOM",duration_days=30,max_devices=1,prefix="YUNA",custom_key=""}=req.body;
  const d=Number(duration_days), m=Number(max_devices);
  if(!Number.isInteger(d)||d<1||d>36500||!Number.isInteger(m)||m<1||m>100) return res.status(400).json({error:"Invalid duration or device limit"});
  const key=(custom_key.trim()||makeKey(prefix.trim().replace(/[^A-Za-z0-9_-]/g,"").slice(0,12)||"YUNA")).toUpperCase();
  const now=new Date(), exp=new Date(now.getTime()+d*DAY);
  try{
    const info=db.prepare("INSERT INTO licenses(key,game,duration_days,max_devices,created_at,expires_at) VALUES(?,?,?,?,?,?)")
      .run(key,game,d,m,now.toISOString(),exp.toISOString());
    log(info.lastInsertRowid,"CREATED",req);
    res.json(normalize(get(info.lastInsertRowid)));
  }catch(e){res.status(409).json({error:"Key already exists"});}
});
app.post("/api/activate",(req,res)=>{
  const {key,device_id}=req.body;
  if(!key||!device_id)return res.status(400).json({valid:false,error:"key and device_id required"});
  const row=db.prepare("SELECT * FROM licenses WHERE key=?").get(key.toUpperCase().trim());
  if(!row)return res.status(404).json({valid:false,error:"Invalid key"});
  if(row.status!=="ACTIVE")return res.status(403).json({valid:false,error:`Key is ${row.status.toLowerCase()}`});
  if(Date.now()>=Date.parse(row.expires_at)){
    db.prepare("UPDATE licenses SET status='EXPIRED' WHERE id=?").run(row.id);
    return res.status(403).json({valid:false,error:"Key expired"});
  }
  let devices=JSON.parse(row.devices);
  if(!devices.includes(device_id)){
    if(devices.length>=row.max_devices)return res.status(403).json({valid:false,error:"Maximum devices reached"});
    devices.push(device_id);
    db.prepare("UPDATE licenses SET devices=? WHERE id=?").run(JSON.stringify(devices),row.id);
    log(row.id,"ACTIVATED",req);
  }else log(row.id,"CHECKED",req);
  res.json({valid:true,key:row.key,game:row.game,expires_at:row.expires_at,devices_used:devices.length,max_devices:row.max_devices});
});
app.post("/api/licenses/:id/revoke",(req,res)=>{
  const row=get(req.params.id); if(!row)return res.sendStatus(404);
  db.prepare("UPDATE licenses SET status='REVOKED' WHERE id=?").run(row.id); log(row.id,"REVOKED",req); res.json({ok:true});
});
app.post("/api/licenses/:id/reset-devices",(req,res)=>{
  const row=get(req.params.id); if(!row)return res.sendStatus(404);
  db.prepare("UPDATE licenses SET devices='[]' WHERE id=?").run(row.id); log(row.id,"DEVICES_RESET",req); res.json({ok:true});
});
app.delete("/api/licenses/:id",(req,res)=>{
  const row=get(req.params.id); if(!row)return res.sendStatus(404);
  db.prepare("DELETE FROM licenses WHERE id=?").run(row.id); log(row.id,"DELETED",req); res.json({ok:true});
});
app.get("/api/licenses/:id/events",(req,res)=>{
  res.json(db.prepare("SELECT action,ip,created_at FROM events WHERE license_id=? ORDER BY id DESC").all(req.params.id));
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(process.env.PORT||3000,()=>console.log("Yuna License Panel running on http://localhost:"+(process.env.PORT||3000)));
