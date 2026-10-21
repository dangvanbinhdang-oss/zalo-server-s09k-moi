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
    const toDelete = [];
    // Tìm file credential thường gặp của zca-js
    const files = fs.readdirSync('.');
    files.forEach(f => {
      if (f.includes('zalo') || f.includes('cred') || f.includes('cookie') || f.endsWith('.json')) {
        if (f !== 'package.json' && f !== 'package-lock.json') {
          // Chỉ xóa file khả nghi, không xóa package.json
          if (f.includes('zalo') || f === 'cookies.json' || f === 'credentials.json' || f === 'appstate.json') {
            toDelete.push(f);
          }
        }
      }
    });
    // Xóa thư mục cache
    ['zalo_data', 'data', 'cache', 'cookies', '.zalo'].forEach(dir => {
      try { if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log('Đã xóa thư mục:', dir); } } catch {}
    });
    toDelete.forEach(f => {
      try { if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('Đã xóa file:', f); } } catch {}
    });
  } catch (e) { console.log('Lỗi clean cache:', e.message); }
}


app.use(express.json());

// Cho phép Google Sheets gọi - PHẢI đặt đầu tiên
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static('public')); 
// old cors removed marker
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Trang chủ hiện QR
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Zalo Server - QR Login</title>
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
<h1>Zalo Server s09k</h1>
<div id="status" class="status waiting">${loginStatus}</div>
<div id="qr">Đang tạo QR Code... vui lòng đợi 10-20s<br>Nếu không hiện, bấm F5 hoặc bấm nút Tải lại</div>
<button onclick="location.reload()">🔄 Tải lại QR</button>
<button onclick="getStatus()">📊 Kiểm tra trạng thái</button>
<button onclick="logout()" style="background:#ff4444">🚪 Đăng xuất - Đổi Zalo khác</button>
<p style="margin-top:20px;font-size:14px;color:#666">Link server của bạn:<br><b>https://zalo-server-s09k-moi.onrender.com</b><br>Dán link này vào ô B1 Google Sheets</p>
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
      document.getElementById('qr').innerHTML='<h2 style="color:green">✅ Đã đăng nhập thành công!<br>'+data.user+'</h2>';
    } else if(data.qr){
      document.getElementById('qr').innerHTML='<img src="'+data.qr+'" style="max-width:100%;border-radius:8px"/> <p>Mở Zalo -> Quét mã QR để đăng nhập</p><p style="font-size:12px">QR hết hạn sau 2 phút, nếu hết hạn bấm Tải lại</p>';
    } else {
      document.getElementById('qr').innerHTML=data.message || 'Đang tạo QR...';
    }
    document.getElementById('log').textContent = JSON.stringify(data, null, 2);
  }catch(e){
    document.getElementById('qr').innerHTML='Lỗi: '+e.message;
  }
}
async function getStatus(){ loadQR(); }
async function logout(){ if(!confirm("Đăng xuất Zalo hiện tại để quét Zalo MỚI?")) return; document.getElementById("qr").innerHTML="Đang đăng xuất..."; await fetch("/api/logout"); setTimeout(()=>location.reload(), 2000); }
setInterval(loadQR, 5000);
loadQR();
</script>
</body>
</html>
  `);
});

app.get('/api/qr', async (req, res) => {
  if (qrCodeData) {
    return res.json({ qr: qrCodeData, status: loginStatus, user: apiInstance ? 'Đã login' : '' });
  }
  res.json({ qr: null, status: loginStatus, message: 'Đang khởi tạo QR, vui lòng đợi...' });
});

app.get('/api/status', (req, res) => {
  res.json({ status: loginStatus, hasQR: !!qrCodeData, hasAPI: !!apiInstance, uid: apiInstance ? (apiInstance.getOwnId ? apiInstance.getOwnId() : '') : '' });
});

app.get('/api/logout', (req, res) => { cleanZaloCache(); apiInstance = null; qrCodeData = null; loginStatus = 'Đã đăng xuất - Đang tạo QR mới...'; res.json({ success: true, message: 'Đã đăng xuất, đang tạo QR mới' }); setTimeout(startZaloLogin, 1500); });
app.post('/api/logout', (req, res) => { cleanZaloCache(); apiInstance = null; qrCodeData = null; loginStatus = 'Đã đăng xuất - Đang tạo QR mới...'; res.json({ success: true, message: 'Đã đăng xuất' }); setTimeout(startZaloLogin, 1500); });
app.get('/api/restart', (req, res) => { cleanZaloCache(); apiInstance = null; qrCodeData = null; loginStatus = 'Đang khởi động lại QR...'; res.json({ success: true }); setTimeout(startZaloLogin, 1500); });

// Gửi tin nhắn nhóm - API cho Google Sheets
app.post('/api/send', async (req, res) => {
  try {
    const { groupId, message } = req.body;
    if (!apiInstance) return res.status(400).json({ error: 'Chưa đăng nhập Zalo' });
    const result = await apiInstance.sendMessage(message, groupId);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/groups', async (req, res) => {
  try {
    if (!apiInstance) return res.status(400).json({ error: 'Chưa đăng nhập' });
    const groups = await apiInstance.getAllGroups();
    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function startZaloLogin() {
  try {
    console.log('=== BẮT ĐẦU ĐĂNG NHẬP ZALO QR ===');
    cleanZaloCache();
    qrCodeData = null;
    loginStatus = 'Đang tạo QR Code...';
    const zalo = new Zalo();
    console.log('Gọi zalo.loginQR()...');
    const api = await zalo.loginQR({}, (qrEvent) => {
      try {
        console.log('NHẬN ĐƯỢC QR EVENT raw:', typeof qrEvent, JSON.stringify(qrEvent).slice(0,500));
        let qrData = null;
        if (typeof qrEvent === 'string') {
          qrData = qrEvent;
        } else if (qrEvent && typeof qrEvent.data === 'string') {
          qrData = qrEvent.data;
        } else if (qrEvent && qrEvent.data && typeof qrEvent.data === 'object') {
          // object có thể là { image: '...' } hoặc Buffer
          qrData = qrEvent.data.image || qrEvent.data.data || JSON.stringify(qrEvent.data);
        } else if (qrEvent && typeof qrEvent === 'object') {
          qrData = qrEvent.image || qrEvent.qr || qrEvent.url;
        }

        if (qrData) {
          if (typeof qrData === 'string' && (qrData.startsWith('data:image') || qrData.startsWith('http'))) {
            qrCodeData = qrData;
          } else if (typeof qrData === 'string' && qrData.length > 50) {
            // Có thể là base64 thô hoặc text QR
            if (qrData.startsWith('/9j') || qrData.startsWith('iVBOR')) {
              qrCodeData = 'data:image/png;base64,' + qrData;
            } else {
              qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrData)}`;
            }
          } else {
            qrCodeData = qrData;
          }
          loginStatus = 'Đã có QR Code - Mở Zalo quét ngay!';
          console.log('QR Code đã tạo thành công!');
        }
      } catch (e) {
        console.error('Lỗi xử lý QR event:', e);
      }
    });
    
    // api chính là instance sau khi quét QR thành công
    if (api && (api.listener || api.sendMessage)) {
      apiInstance = api;
      try { const uid = api.getOwnId ? api.getOwnId() : ''; loginStatus = `Đã đăng nhập thành công! ${uid}`; } catch { loginStatus = 'Đã đăng nhập thành công!'; }
      console.log(loginStatus);
      qrCodeData = null;
      try { api.listener.on('message', (msg) => { console.log('Nhận tin nhắn:', msg); }); } catch {}
    } else if (typeof api === 'string' && api.startsWith('data:image')) {
      qrCodeData = api;
    }
  } catch (err) {
    console.error('Lỗi đăng nhập Zalo:', err);
    loginStatus = 'Lỗi: ' + err.message + ' - Đang thử lại sau 10s...';
    setTimeout(startZaloLogin, 10000);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Truy cập https://zalo-server-s09k-moi.onrender.com để lấy QR`);
  startZaloLogin();
});
