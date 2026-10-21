const express = require('express');
const fs = require('fs');
const { Zalo } = require('zca-js');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = null;
let loginStatus = 'Chưa đăng nhập';
let apiInstance = null;

function cleanZaloCache() {
  try {
    ['zalo_data','data','cache','cookies','.zalo'].forEach(dir=>{
      if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});
    });
    fs.readdirSync('.').forEach(f=>{
      if(['cookies.json','credentials.json','appstate.json'].includes(f) && fs.existsSync(f)) fs.unlinkSync(f);
    });
  } catch {}
}

app.use(express.json());
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req,res)=>{
  res.send(`
<html><head><meta charset="utf-8"><title>Zalo Server s09k-moi FIX</title>
<style>body{font-family:sans-serif;text-align:center;padding:30px;background:#f0f2f5}.card{background:white;padding:30px;border-radius:12px;max-width:500px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,0.1)}#qr{min-height:300px;display:flex;align-items:center;justify-content:center;background:#fafafa;border:2px dashed #ddd;border-radius:8px;margin:20px 0}.status{padding:10px;border-radius:6px;margin:15px 0;font-weight:bold}.waiting{background:#fff3cd;color:#856404}.success{background:#d4edda;color:#155724}button{padding:12px 24px;background:#0084ff;color:white;border:none;border-radius:6px;font-size:16px;cursor:pointer;margin:5px}</style>
</head><body><div class="card">
<h1 style="color:#0084ff">Zalo Server s09k-moi FIX</h1>
<div id="status" class="status waiting">${loginStatus}</div>
<div id="qr">Đang tạo QR...</div>
<button onclick="location.reload()" style="background:#0084ff">🔄 Tải lại QR</button>
<button onclick="logout()" style="background:#ff4444">🚪 Đăng xuất</button>
<pre id="log" style="background:#f8f9fa;padding:15px;border-radius:6px;text-align:left;overflow:auto;max-height:150px;font-size:12px"></pre>
</div>
<script>
async function loadQR(){
  try{
    const res=await fetch('/api/qr'); const data=await res.json();
    document.getElementById('status').textContent=data.status;
    if(data.status.includes('Đã đăng nhập')){
      document.getElementById('status').className='status success';
      document.getElementById('qr').innerHTML='<h2 style="color:green">✅ Đã đăng nhập!<br>'+data.status+'</h2><p><a href="/api/groups" target="_blank">Xem nhóm</a></p>';
    }else if(data.qr){
      document.getElementById('qr').innerHTML='<img src="'+data.qr+'" style="max-width:350px"/>';
    }else{
      document.getElementById('qr').innerHTML=data.message||'Đang tạo QR... vui lòng đợi 20s';
    }
    document.getElementById('log').textContent=JSON.stringify(data,null,2);
  }catch(e){document.getElementById('qr').innerHTML='Lỗi: '+e.message;}
}
async function logout(){if(!confirm("Đăng xuất?"))return; await fetch('/api/logout'); location.reload();}
setInterval(loadQR, 4000); loadQR();
</script></body></html>`);
});

app.get('/api/qr', (req,res)=> res.json({qr:qrCodeData,status:loginStatus,user:apiInstance?'Đã login':''}));
app.get('/api/logout', (req,res)=>{ cleanZaloCache(); apiInstance=null; qrCodeData=null; loginStatus='Đã đăng xuất - Đang tạo QR mới...'; res.json({ok:true}); setTimeout(startZaloLogin,1000); });

app.post('/api/send', async (req,res)=>{
  try{
    let {groupId,message}=req.body;
    if(!apiInstance) return res.status(400).json({error:'Chưa đăng nhập'});
    groupId=groupId.toString().replace(/^'/,'').replace(/[^0-9]/g,'').trim();
    const result=await apiInstance.sendMessage(message,groupId);
    res.json({success:true,groupId,result});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/groups', async (req,res)=>{
  try{
    if(!apiInstance) return res.status(400).json({error:'Chưa đăng nhập',groups:[]});
    const raw=await apiInstance.getAllGroups();
    let ids=raw?.gridVerMap?Object.keys(raw.gridVerMap):Object.keys(raw).filter(k=>/^\d{10,}$/.test(k));
    let nameMap={};
    for(let i=0;i<Math.min(ids.length,80);i++){
      try{
        const info=await apiInstance.getGroupInfo(ids[i]);
        const g=info?.gridInfoMap?.[ids[i]]||info?.[ids[i]]||info;
        const name=g?.name||g?.groupName||"";
        if(name && name.length>2) nameMap[ids[i]]=name;
      }catch{} await new Promise(r=>setTimeout(r,400));
    }
    const groups=Object.keys(nameMap).map(id=>({id,name:nameMap[id]}));
    res.json({total:ids.length,totalWithName:groups.length,groups,nameMap});
  }catch(e){ res.status(500).json({error:e.message,groups:[]}); }
});

async function startZaloLogin(){
  try{
    console.log('=== BẮT ĐẦU LOGIN QR ===');
    cleanZaloCache();
    qrCodeData=null;
    loginStatus='Đang tạo QR Code...';
    const zalo=new Zalo();

    // Bắt QR bằng event mới nhất của zca-js
    zalo.on('qr',(qr)=>{
      console.log('Nhận QR event, dài:',qr?.length);
      try{
        if(typeof qr==='string'){
          if(qr.startsWith('data:image')){
            qrCodeData=qr;
          }else if(qr.startsWith('http')){
            qrCodeData=qr;
          }else{
            // qr là text -> tạo ảnh QR
            QRCode.toDataURL(qr,(err,url)=>{
              if(!err) qrCodeData=url;
              else qrCodeData=`https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qr)}`;
            });
          }
          loginStatus='Đã có QR Code - Mở Zalo quét ngay!';
          console.log('Đã tạo QR xong');
        }
      }catch(e){console.log('Lỗi tạo QR:',e.message);}
    });

    const api=await zalo.loginQR();
    if(api && api.sendMessage){
      apiInstance=api;
      loginStatus=`Đã đăng nhập thành công! ${api.getOwnId?api.getOwnId():''}`;
      qrCodeData=null;
      console.log(loginStatus);
    }
  }catch(err){
    console.error('Lỗi login:',err);
    loginStatus='Lỗi: '+err.message+' - Thử lại sau 10s';
    setTimeout(startZaloLogin,10000);
  }
}

app.listen(PORT,()=>{ console.log('Server running '+PORT); startZaloLogin(); });
