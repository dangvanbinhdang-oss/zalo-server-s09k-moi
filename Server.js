const express = require('express');
const fs = require('fs');
const path = require('path');
const { Zalo } = require('zca-js');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = null;
let loginStatus = 'Chưa đăng nhập';
let apiInstance = null;

app.use(express.json());
app.use(express.static('public'));

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
<p style="margin-top:20px;font-size:14px;color:#666">Link server của bạn:<br><b>https://zalo-server-s09k.onrender.com</b><br>Dán link này vào ô B1 Google Sheets</p>
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
async function getStatus(){
  loadQR();
}
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
  res.json({ status: loginStatus, hasQR: !!qrCodeData, hasAPI: !!apiInstance });
});

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
    loginStatus = 'Đang tạo QR Code...';
    const zalo = new Zalo();
    console.log('Gọi zalo.loginQR()...');
    const api = await zalo.loginQR({}, (qrEvent) => {
      // qrcode callback
      if (qrEvent && qrEvent.data) {
        // qrEvent.data là image base64 hoặc url
        console.log('NHẬN ĐƯỢC QR EVENT:', qrEvent.type || 'qr');
        if (qrEvent.data.startsWith('data:image') || qrEvent.data.startsWith('http')) {
          qrCodeData = qrEvent.data;
        } else {
          // Nếu là text QR, tạo QR image URL
          qrCodeData = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrEvent.data)}`;
        }
        loginStatus = 'Đã có QR Code - Mở Zalo quét ngay!';
        console.log('QR Code đã tạo, truy cập / để xem');
      }
    });
    
    // Nếu loginQR trả về QR trực tiếp
    if (typeof api === 'string' && api.startsWith('data:image')) {
      qrCodeData = api;
    }
    
    // Lưu ý: Một số phiên bản zca-js trả về khác nhau, nên bắt thêm event
    if (api && api.listener) {
      apiInstance = api;
      loginStatus = `Đã đăng nhập thành công! UID: ${api.getOwnId ? api.getOwnId() : 'unknown'}`;
      console.log(loginStatus);
      qrCodeData = null;
      
      api.listener.on('message', (msg) => {
        console.log('Nhận tin nhắn:', msg);
      });
    }
  } catch (err) {
    console.error('Lỗi đăng nhập Zalo:', err);
    loginStatus = 'Lỗi: ' + err.message + ' - Đang thử lại sau 10s...';
    setTimeout(startZaloLogin, 10000);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Truy cập https://zalo-server-s09k.onrender.com để lấy QR`);
  startZaloLogin();
});
