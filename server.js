const express = require("express");
const fs = require("fs");
const { Zalo, ThreadType } = require("zca-js");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 10000;

let qrCodeData = null;
let loginStatus = "Đang khởi tạo...";
let apiInstance = null;
let loginInProgress = false;
let sendInProgress = false;

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// ======================================================
// TRANG CHỦ VÀ QR ĐĂNG NHẬP
// ======================================================

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zalo Server An Toàn</title>
<style>
body {
  font-family: Arial, sans-serif;
  text-align: center;
  padding: 25px;
  background: #f0f2f5;
}
.card {
  background: white;
  padding: 25px;
  border-radius: 12px;
  max-width: 550px;
  margin: auto;
  box-shadow: 0 2px 12px #0001;
}
.status {
  padding: 12px;
  border-radius: 6px;
  margin: 15px 0;
  font-weight: bold;
  overflow-wrap: anywhere;
}
.waiting { background: #fff3cd; color: #856404; }
.success { background: #d4edda; color: #155724; }
.error { background: #f8d7da; color: #721c24; }
#qr {
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  border: 2px dashed #ddd;
  border-radius: 8px;
  margin: 20px 0;
  overflow-wrap: anywhere;
}
button {
  padding: 12px 18px;
  border: 0;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  margin: 5px;
}
.blue { background: #0084ff; }
.red { background: #dc3545; }
pre {
  background: #f8f9fa;
  padding: 10px;
  border-radius: 6px;
  text-align: left;
  overflow: auto;
  max-height: 180px;
  font-size: 12px;
}
</style>
</head>
<body>
<div class="card">
  <h2 style="color:#0084ff">Zalo Server - Chống Gửi Nhầm</h2>
  <div id="status" class="status waiting">Đang kiểm tra...</div>
  <div id="qr">Đang tạo QR...</div>

  <button class="blue" onclick="loadQR()">🔄 Làm mới trạng thái</button>
  <button class="red" onclick="logout()">🚪 Đăng xuất</button>

  <pre id="log">Đang tải...</pre>
</div>

<script>
async function loadQR() {
  try {
    const res = await fetch("/api/qr");
    const data = await res.json();

    const status = document.getElementById("status");
    status.textContent = data.status || "Không rõ trạng thái";
    status.className = "status " +
      (data.loggedIn ? "success" :
       data.error ? "error" : "waiting");

    const qr = document.getElementById("qr");

    if (data.loggedIn) {
      qr.innerHTML =
        "<h3 style='color:green'>✅ Đã đăng nhập Zalo</h3>";
    } else if (data.qr) {
      qr.innerHTML =
        "<img alt='QR đăng nhập Zalo' src='" +
        data.qr +
        "' style='max-width:100%;width:350px'>";
    } else {
      qr.textContent = data.message || data.status ||
        "Đang chờ mã QR...";
    }

    document.getElementById("log").textContent =
      JSON.stringify(data, null, 2);

  } catch (e) {
    document.getElementById("status").textContent =
      "Không kết nối được máy chủ";
    document.getElementById("qr").textContent = e.message;
  }
}

async function logout() {
  if (!confirm("Bạn có chắc muốn đăng xuất Zalo?")) return;

  try {
    const res = await fetch("/api/logout", { method: "POST" });
    const data = await res.json();
    alert(data.message || "Đã gửi yêu cầu đăng xuất");
    loadQR();
  } catch (e) {
    alert("Lỗi: " + e.message);
  }
}

loadQR();
setInterval(loadQR, 4000);
</script>
</body>
</html>`);
});

// ======================================================
// TRẠNG THÁI QR
// ======================================================

app.get("/api/qr", (req, res) => {
  res.json({
    status: loginStatus,
    loggedIn: Boolean(apiInstance),
    qr: qrCodeData,
    message: apiInstance
      ? "Zalo đã kết nối."
      : "Mở ứng dụng Zalo để quét QR nếu mã đang hiển thị."
  });
});

// ======================================================
// DỌN CACHE ĐĂNG NHẬP
// Chỉ gọi khi chủ máy chủ chủ động đăng xuất.
// ======================================================

function cleanZaloCache() {
  const dirs = [
    "zalo_data",
    "data",
    "cache",
    "cookies",
    ".zalo"
  ];

  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error("Không xóa được thư mục:", dir, e.message);
    }
  }

  const files = [
    "cookies.json",
    "credentials.json",
    "appstate.json"
  ];

  for (const file of files) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      console.error("Không xóa được file:", file, e.message);
    }
  }
}

app.post("/api/logout", (req, res) => {
  if (loginInProgress) {
    return res.status(409).json({
      success: false,
      message: "Đang xử lý đăng nhập, vui lòng thử lại sau."
    });
  }

  apiInstance = null;
  qrCodeData = null;
  loginStatus = "Đang đăng xuất...";

  cleanZaloCache();

  res.json({
    success: true,
    message: "Đã yêu cầu đăng xuất. Máy chủ sẽ tạo phiên QR mới."
  });

  setTimeout(() => {
    startZaloLogin();
  }, 1000);
});

// ======================================================
// HÀM XÁC MINH ID NHÓM
// ======================================================

async function getVerifiedGroup_(groupId) {
  if (!apiInstance) {
    throw new Error("Zalo chưa đăng nhập.");
  }

  if (!groupId) {
    throw new Error("ID nhóm trống.");
  }

  // Chỉ sử dụng cấu trúc danh sách nhóm đã nhận diện.
  const raw = await apiInstance.getAllGroups();

  if (
    !raw ||
    !raw.gridVerMap ||
    typeof raw.gridVerMap !== "object" ||
    Array.isArray(raw.gridVerMap)
  ) {
    throw new Error(
      "Không xác minh được cấu trúc danh sách nhóm. Đã từ chối gửi."
    );
  }

  const ids = Object.keys(raw.gridVerMap);

  // So khớp chính xác ID, không dựa vào độ dài ID.
  if (!ids.includes(groupId)) {
    throw new Error(
      "ID không nằm trong danh sách nhóm hiện tại của Zalo."
    );
  }

  const info = await apiInstance.getGroupInfo(groupId);

  // Không tự động lấy info chung nếu không tìm thấy đúng khóa
