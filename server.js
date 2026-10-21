const express = require('express');
const fs = require('fs');
const { Zalo } = require('zca-js');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = null;
let loginStatus = 'Chưa đăng nhập';
let apiInstance = null;

// Hàm dọn dẹp cache phiên đăng nhập cũ
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

// Giao diện Web hiển thị trạng thái và quét QR
app.get('/', (req,res)=>{
  res.send(`
<html><head><meta charset="utf-8"><title>Zalo Server An Toàn</title>
<style>body{font-family:sans-serif;text-align:center;padding:30px;background:#f0f2f5}.card{background:white;padding:30px;border-radius:12px;max-width:500px;margin:0 auto}.status{padding:10px;border-radius:6px;margin:15px 0;font-weight:bold}.waiting{background:#fff3cd;color:#856404}.success{background:#d4edda;color:#155724}#qr{min-height:300px;display:flex;align-items:center;justify-content:center;background:#fafafa;border:2px dashed #ddd;border-radius:8px;margin:20px 0}</style>
</head><body><div class="card">
<h1 style="color:#0084ff">Zalo Server - Chống Gửi Nhầm</h1>
<div id="status" class="status waiting">${loginStatus}</div>
<div id="qr">Đang tạo QR... vui lòng đợi 20s</div>
<button onclick="location.reload()" style="padding:12px 24px;background:#0084ff;color:white;border:none;border-radius:6px;margin:5px">🔄 Tải lại QR</button>
<button onclick="fetch('/api/logout').then(()=>location.reload())" style="padding:12px 24px;background:#ff4444;color:white;border:none;border-radius:6px">🚪 Đăng xuất</button>
<pre id="log" style="background:#f8f9fa;padding:10px;border-radius:6px;text-align:left;overflow:auto;max-height:150px;font-size:11px"></pre>
</div>
<script>
async function loadQR(){
  const res=await fetch('/api/qr'); const data=await res.json();
  document.getElementById('status').textContent=data.status;
  if(data.status.includes('Đã đăng nhập')){
    document.getElementById('qr').innerHTML='<h2 style="color:green">✅ Đã đăng nhập!<br>'+data.status+'</h2>';
  }else if(data.qr){
    document.getElementById('qr').innerHTML='<img src="'+data.qr+'" style="max-width:350px"/>';
  }else{
    document.getElementById('qr').innerHTML=data.message||'Đang tạo QR...';
  }
  document.getElementById('log').textContent=JSON.stringify(data,null,2);
}
setInterval(loadQR,4000); loadQR();
</script></body></html>`);
});

app.get('/api/qr', (req,res)=> res.json({qr:qrCodeData,status:loginStatus}));
app.get('/api/logout', (req,res)=>{ cleanZaloCache(); apiInstance=null; qrCodeData=null; loginStatus='Đã đăng xuất - Đang tạo QR mới...'; res.json({ok:true}); setTimeout(startZaloLogin,1000); });

// === API GỬI TIN NHẮN (BẢO VỆ TUYỆT ĐỐI CHỐNG GỬI NHẦM CÁ NHÂN) ===
app.post('/api/send', async (req,res)=>{
  try{
    if(!apiInstance) return res.status(400).json({error:'Chưa đăng nhập'});
    let {groupId, message} = req.body;
    
    groupId = groupId ? groupId.toString().replace(/^'/,'').trim() : '';
    
    if (!groupId) {
      return res.status(400).json({error: 'Mã nhóm bị trống'});
    }

    // CHẶN TUYỆT ĐỐI NẾU LÀ SỐ ĐIỆN THOẠI HOẶC ID QUÁ NGẮN (ID CÁ NHÂN)
    if (/^(0|84|\+84)?\d{9,11}$/.test(groupId)) {
      return res.status(400).json({error: 'BẢO VỆ: Từ chối gửi vì đây là Số Điện Thoại cá nhân!'});
    }
    
    if (groupId.length < 12) {
      return res.status(400).json({error: 'BẢO VỆ: Từ chối gửi vì ID quá ngắn, không phải nhóm Zalo!'});
    }

    const result = await apiInstance.sendMessage(message, groupId);
    res.json({success: true, groupId, result});
  }catch(e){ 
    res.status(500).json({error: e.message}); 
  }
});

// === API LẤY DANH SÁCH NHÓM (CHỈ LẤY NHÓM THẬT, LOẠI BỎ NGƯỜI LẠ) ===
app.get('/api/groups', async (req,res)=>{
  try{
    if(!apiInstance) return res.status(400).json({error:'Chưa đăng nhập',groups:[]});
    const raw = await apiInstance.getAllGroups();
    let ids = raw?.gridVerMap ? Object.keys(raw.gridVerMap) : Object.keys(raw).filter(k=>/^\d{10,}$/.test(k));
    let groups = [];
    
    for(let i = 0; i < Math.min(ids.length, 100); i++){
      try{
        const info = await apiInstance.getGroupInfo(ids[i]);
        const g = info?.gridInfoMap?.[ids[i]] || info?.[ids[i]] || info;
        const name = g?.name || g?.groupName || "";
        
        // KIỂM TRA CHẶT CHẼ: Phải có tên, ID dài >= 12 ký tự và có dấu hiệu cấu trúc nhóm thật
        const isActualGroup = g?.members || g?.adminId || g?.creatorId || g?.totalMember || g?.grid;
        
        if (name && ids[i].length >= 12 && isActualGroup) {
          const lowerName = name.toLowerCase();
          if (!/^(bạn bè|người dùng|user|friend)/.test(lowerName)) {
            groups.push({ id: ids[i], name: name });
          }
        }
      }catch{} 
      await new Promise(r => setTimeout(r, 300));
    }
    res.json({total: ids.length, totalValid: groups.length, groups});
  }catch(e){ 
    res.status(500).json({error: e.message, groups:[]}); 
  }
});

// Hàm khởi động quy trình đăng nhập Zalo
async function startZaloLogin(){
  try{
    console.log('=== BẮT ĐẦU LOGIN QR ===');
    cleanZaloCache();
    qrCodeData = null;
    loginStatus = 'Đang tạo QR Code...';
    const zalo = new Zalo();
    
    const api = await zalo.loginQR({}, (qrEvent)=>{
      try{
        let qrStr = null;
        if(typeof qrEvent==='string') qrStr = qrEvent;
        else if(qrEvent?.data && typeof qrEvent.data==='string') qrStr = qrEvent.data;
        else if(qrEvent?.image) qrStr = qrEvent.image;
        else if(qrEvent?.qr) qrStr = qrEvent.qr;
        else if(qrEvent?.data?.image) qrStr = qrEvent.data.image;
        
        if(qrStr){
          if(qrStr.startsWith('data:image') || qrStr.startsWith('http')){
            qrCodeData = qrStr;
          }else if(qrStr.length > 20){
            if(qrStr.startsWith('/9j') || qrStr.startsWith('iVBOR')){
              qrCodeData = 'data:image/png;base64,' + qrStr;
            }else{
              QRCode.toDataURL(qrStr,(err,url)=>{
                if(!err) qrCodeData = url;
                else qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrStr)}`;
              });
            }
          }
          loginStatus = 'Đã có QR Code - Mở Zalo quét ngay!';
        }
      }catch(e){ console.log('Lỗi xử lý QR:', e.message); }
    });

    if(api && api.sendMessage){
      apiInstance = api;
      loginStatus = `Đã đăng nhập thành công! ${api.getOwnId ? api.getOwnId() : ''}`;
      qrCodeData = null;
      console.log(loginStatus);
    }
  }catch(err){
    console.error('Lỗi login:', err);
    loginStatus = 'Lỗi: ' + err.message + ' - Thử lại sau 10s';
    setTimeout(startZaloLogin, 10000);
  }
}

app.listen(PORT, ()=>{ 
  console.log('Server running on port ' + PORT); 
  startZaloLogin(); 
});
