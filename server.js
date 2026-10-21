const express = require('express');
const fs = require('fs');
const path = require('path');
const { Zalo } = require('zca-js');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = null;
let loginStatus = 'Chưa đăng nhập';
let apiInstance = null;

function cleanZaloCache() {
  try {
    console.log('=== DỌN CACHE ===');
    ['zalo_data', 'data', 'cache', 'cookies', '.zalo', 'zca-js'].forEach(dir => {
      try { if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log('Đã xóa thư mục:', dir); } } catch {}
    });
    fs.readdirSync('.').forEach(f => {
      if ((f.includes('zalo') || f === 'cookies.json' || f === 'credentials.json' || f === 'appstate.json' || f.startsWith('cred_')) && fs.existsSync(f)) {
        try { fs.unlinkSync(f); console.log('Đã xóa file:', f); } catch {}
      }
    });
  } catch (e) { console.log('Lỗi clean cache:', e.message); }
}

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static('public')); 

// Trang chủ hiện QR
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Zalo Server s09k-moi FIX</title>
<style>
body{font-family:sans-serif;text-align:center;padding:30px;background:#f0f2f5}
.card{background:white;padding:30px;border-radius:12px;max-width:500px;margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
#qr{margin:20px auto;min-height:300px;display:flex;align-items:center;justify-content:center;background:#fafafa;border:2px dashed #ddd;border-radius:8px}
h1{color:#0084ff}
.status{padding:10px;border-radius:6px;margin:15px 0;font-weight:bold}
.waiting{background:#fff3cd;color:#856404}
.success{background:#d4edda;color:#155724}
button{padding:12px 24px;background:#0084ff;color:white;border:none;border-radius:6px;font-size:16px;cursor:pointer;margin:5px}
button:hover{background:#006dd1}
pre{white-space:pre-wrap;word-break:break-all;background:#f8f9fa;padding:15px;border-radius:6px;text-align:left;overflow:auto;max-height:200px}
</style>
</head>
<body>
<div class="card">
<h1>Zalo Server s09k-moi FIX</h1>
<div id="status" class="status waiting">${loginStatus}</div>
<div id="qr">Đang tạo QR Code... vui lòng đợi 10-20s</div>
<button onclick="location.reload()">🔄 Tải lại QR</button>
<button onclick="logout()" style="background:#ff4444">🚪 Đăng xuất - Đổi Zalo khác</button>
<p style="margin-top:20px;font-size:14px;color:#666">Link server:<br><b>https://zalo-server-s09k-moi.onrender.com</b></p>
<pre id="log">Đang chờ QR...</pre>
</div>
<script>
async function loadQR(){
  try{
    const res = await fetch('/api/qr');
    const data = await res.json();
    document.getElementById('status').textContent = data.status;
    if(data.status.includes('Đã đăng nhập')){
      document.getElementById('status').className='status success';
      document.getElementById('qr').innerHTML='<h2 style="color:green">✅ Đã đăng nhập thành công!<br>'+data.user+'</h2><p><a href="/api/groups" target="_blank">Bấm vào đây xem danh sách nhóm</a></p>';
    } else if(data.qr){
      document.getElementById('qr').innerHTML='<img src="'+data.qr+'" style="max-width:100%;border-radius:8px"/> <p>Mở Zalo -> Quét mã QR</p>';
    } else {
      document.getElementById('qr').innerHTML=data.message || 'Đang tạo QR...';
    }
    document.getElementById('log').textContent = JSON.stringify(data, null, 2);
  }catch(e){
    document.getElementById('qr').innerHTML='Lỗi: '+e.message;
  }
}
async function logout(){ if(!confirm("Đăng xuất để đổi Zalo khác?")) return; document.getElementById("qr").innerHTML="Đang đăng xuất..."; await fetch("/api/logout"); setTimeout(()=>location.reload(), 2000); }
setInterval(loadQR, 5000);
loadQR();
</script>
</body>
</html>
  `);
});

app.get('/api/qr', async (req, res) => {
  res.json({ qr: qrCodeData, status: loginStatus, user: apiInstance ? 'Đã login' : '' });
});
app.get('/api/status', (req, res) => {
  res.json({ status: loginStatus, hasQR: !!qrCodeData, hasAPI: !!apiInstance, uid: apiInstance ? (apiInstance.getOwnId ? apiInstance.getOwnId() : '') : '' });
});
app.get('/api/logout', (req, res) => { cleanZaloCache(); apiInstance = null; qrCodeData = null; loginStatus = 'Đã đăng xuất - Đang tạo QR mới...'; res.json({ success: true }); setTimeout(startZaloLogin, 1500); });
app.post('/api/logout', (req, res) => { cleanZaloCache(); apiInstance = null; qrCodeData = null; loginStatus = 'Đã đăng xuất - Đang tạo QR mới...'; res.json({ success: true }); setTimeout(startZaloLogin, 1500); });

// Gửi tin nhắn - FIX gửi đúng nhóm
app.post('/api/send', async (req, res) => {
  try {
    let { groupId, message } = req.body;
    if (!apiInstance) return res.status(400).json({ error: 'Chưa đăng nhập Zalo' });
    groupId = groupId.toString().replace(/^'/, '').split('.')[0].replace(/[^0-9]/g,'').trim();
    console.log(`Gửi tới ${groupId}: ${message.slice(0,50)}`);
    let result = await apiInstance.sendMessage(message, groupId);
    res.json({ success: true, groupId, result });
  } catch (e) {
    console.error('Lỗi gửi:', e);
    res.status(500).json({ error: e.message });
  }
});

// LẤY NHÓM - FIX LỌC NHÓM NGƯỜI LẠ
app.get('/api/groups', async (req, res) => {
  try {
    if (!apiInstance) return res.status(400).json({ error: 'Chưa đăng nhập', groups: [] });
    const raw = await apiInstance.getAllGroups();
    console.log('RAW:', JSON.stringify(raw).substring(0,800));
    
    let groupIds = [];
    if (raw && raw.gridVerMap) groupIds = Object.keys(raw.gridVerMap);
    else if (Array.isArray(raw)) groupIds = raw.map(g => typeof g === 'string' ? g : (g.gridId || g.id || g.groupId)).filter(Boolean);
    else if (raw && typeof raw === 'object') groupIds = Object.keys(raw).filter(k => k.length > 10 && /^\d+$/.test(k));
    
    console.log('Total IDs:', groupIds.length);
    
    // Lấy tên thật, chỉ giữ nhóm lấy được tên
    let nameMap = {};
    if (apiInstance.getGroupInfo) {
      const limit = Math.min(groupIds.length, 100);
      for (let i = 0; i < limit; i++) {
        const gid = groupIds[i];
        try {
          const info = await apiInstance.getGroupInfo(gid);
          let single = info?.gridInfoMap?.[gid] || info?.[gid] || info || null;
          const name = single?.name || single?.groupName || single?.data?.name || "";
          if (name && name.trim().length > 2 && !name.includes("Nhóm ")) {
            nameMap[gid] = name;
            console.log(`OK ${gid}: ${name}`);
          }
        } catch (e) { console.log(`Skip ${gid}: ${e.message}`); }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // FIX QUAN TRỌNG: Chỉ trả về nhóm có tên thật -> bỏ hết nhóm lạ
    const groups = Object.keys(nameMap).map(id => ({
      id: id,
      name: nameMap[id],
      realName: nameMap[id],
      hasRealName: true
    }));
    
    res.json({
      total: groupIds.length,
      totalWithName: groups.length,
      groups: groups,
      nameMap: nameMap
    });
  } catch (e) {
    console.error('Lỗi /api/groups:', e);
    res.status(500).json({ error: e.message, groups: [] });
  }
});

app.get('/groups', (req,res) => res.redirect('/api/groups'));

async function startZaloLogin() {
  try {
    console.log('=== BẮT ĐẦU ĐĂNG NHẬP ZALO QR ===');
    cleanZaloCache();
    qrCodeData = null;
    loginStatus = 'Đang tạo QR Code...';
    const zalo = new Zalo();
    const api = await zalo.loginQR({}, (qrEvent) => {
      try {
        let qrData = null;
        if (typeof qrEvent === 'string') qrData = qrEvent;
        else if (qrEvent?.data && typeof qrEvent.data === 'string') qrData = qrEvent.data;
        else if (qrEvent?.image) qrData = qrEvent.image;
        else if (qrEvent?.qr) qrData = qrEvent.qr;
        
        if (qrData) {
          if (typeof qrData === 'string' && (qrData.startsWith('data:image') || qrData.startsWith('http'))) {
            qrCodeData = qrData;
          } else if (typeof qrData === 'string' && qrData.length > 50) {
            if (qrData.startsWith('/9j') || qrData.startsWith('iVBOR')) {
              qrCodeData = 'data:image/png;base64,' + qrData;
            } else {
              qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrData)}`;
            }
          }
          loginStatus = 'Đã có QR Code - Mở Zalo quét ngay!';
        }
      } catch (e) { console.error('Lỗi QR:', e); }
    });
    
    if (api && (api.listener || api.sendMessage)) {
      apiInstance = api;
      const uid = api.getOwnId ? api.getOwnId() : '';
      loginStatus = `Đã đăng nhập thành công! ${uid}`;
      qrCodeData = null;
      console.log(loginStatus);
    } else if (typeof api === 'string' && api.startsWith('data:image')) {
      qrCodeData = api;
    }
  } catch (err) {
    console.error('Lỗi đăng nhập:', err);
    loginStatus = 'Lỗi: ' + err.message + ' - Thử lại sau 10s...';
    setTimeout(startZaloLogin, 10000);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startZaloLogin();
});
