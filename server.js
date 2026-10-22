const express = require("express");
const fs = require("fs");
const { Zalo, ThreadType } = require("zca-js");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 10000;

// Nơi lưu phiên đăng nhập. Dùng Persistent Disk thì đặt SESSION_FILE=/data/zalo_session.json
const SESSION_FILE = process.env.SESSION_FILE || "zalo_session.json";

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
// LƯU / ĐỌC PHIÊN ĐĂNG NHẬP
// ======================================================

function saveSession(api) {
  try {
    const ctx = api.getContext();
    const cookieObj = api.getCookie().toJSON();
    const session = {
      cookie: cookieObj && cookieObj.cookies ? cookieObj.cookies : cookieObj,
      imei: ctx.imei,
      userAgent: ctx.userAgent
    };

    if (!session.cookie || !session.imei || !session.userAgent) {
      console.error("Phiên thiếu dữ liệu, không lưu.");
      return;
    }

    fs.writeFileSync(SESSION_FILE, JSON.stringify(session));
    console.log("Đã lưu phiên đăng nhập vào", SESSION_FILE);
  } catch (e) {
    console.error("SAVE SESSION ERROR:", e.message);
  }
}

function loadSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (!s || !s.cookie || !s.imei || !s.userAgent) return null;
    return s;
  } catch (e) {
    console.error("LOAD SESSION ERROR:", e.message);
    return null;
  }
}

function deleteSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch (e) {
    console.error("Không xóa được file phiên:", e.message);
  }
}

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

  // Xóa luôn phiên đã lưu để lần sau phải quét QR mới
  deleteSession();
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

  // Không tự động lấy info chung nếu không tìm thấy đúng khóa ID.
  const group = info?.gridInfoMap?.[groupId];

  if (!group || typeof group !== "object") {
    throw new Error(
      "Không lấy được thông tin nhóm khớp chính xác ID."
    );
  }

  const name = String(
    group.name || group.groupName || ""
  ).trim();

  const hasMemberData =
    Array.isArray(group.members) ||
    Array.isArray(group.memberList) ||
    (
      typeof group.totalMember === "number" &&
      group.totalMember > 0
    ) ||
    Boolean(group.adminId) ||
    Boolean(group.creatorId);

  if (!name || !hasMemberData) {
    throw new Error(
      "Không đủ thông tin xác minh nhóm. Đã từ chối gửi."
    );
  }

  return {
    id: groupId,
    name: name
  };
}

// ======================================================
// API LẤY DANH SÁCH NHÓM
// ======================================================

app.get("/api/groups", async (req, res) => {
  try {
    if (!apiInstance) {
      return res.status(400).json({
        success: false,
        error: "Chưa đăng nhập Zalo.",
        groups: []
      });
    }

    const raw = await apiInstance.getAllGroups();

    if (
      !raw ||
      !raw.gridVerMap ||
      typeof raw.gridVerMap !== "object" ||
      Array.isArray(raw.gridVerMap)
    ) {
      return res.status(502).json({
        success: false,
        error:
          "Cấu trúc dữ liệu nhóm khác định dạng dự kiến. " +
          "Cần kiểm tra phiên bản zca-js.",
        groups: []
      });
    }

    const ids = Object.keys(raw.gridVerMap);
    const groups = [];
    const rejected = [];

    for (const id of ids) {
      try {
        const group = await getVerifiedGroup_(id);
        groups.push(group);
      } catch (e) {
        rejected.push({
          id: id,
          reason: e.message
        });
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return res.json({
      success: true,
      total: ids.length,
      totalValid: groups.length,
      groups: groups,
      rejectedCount: rejected.length
    });

  } catch (e) {
    console.error("GROUPS ERROR:", e.message);

    return res.status(500).json({
      success: false,
      error: e.message,
      groups: []
    });
  }
});

// ======================================================
// API GỬI TIN NHẮN
// ======================================================

app.post("/api/send", async (req, res) => {
  if (sendInProgress) {
    return res.status(429).json({
      success: false,
      error: "Đang xử lý một yêu cầu gửi khác. Hãy thử lại sau."
    });
  }

  sendInProgress = true;

  try {
    if (!apiInstance) {
      return res.status(400).json({
        success: false,
        error: "Zalo chưa đăng nhập."
      });
    }

    const groupId = String(req.body?.groupId || "")
      .replace(/^'/, "")
      .trim();

    const expectedName = String(req.body?.groupName || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!groupId) {
      return res.status(400).json({
        success: false,
        error: "Thiếu ID nhóm."
      });
    }

    if (!expectedName) {
      return res.status(400).json({
        success: false,
        error:
          "Thiếu tên nhóm xác nhận. Hãy cập nhật Google Apps Script."
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Nội dung tin nhắn trống."
      });
    }

    // Xác minh lại ID và tên ngay trước khi gửi.
    const group = await getVerifiedGroup_(groupId);

    if (group.name !== expectedName) {
      return res.status(409).json({
        success: false,
        error: "Tên nhóm không khớp với ID.",
        expectedName: expectedName,
        actualName: group.name
      });
    }

    console.log(
      "[SEND REQUEST]",
      JSON.stringify({
        groupId: group.id,
        groupName: group.name,
        messageLength: message.length
      })
    );

    // Phải chỉ rõ ThreadType.Group, nếu không zca-js coi là chat cá nhân.
    const result = await apiInstance.sendMessage(
      message,
      group.id,
      ThreadType.Group
    );

    console.log(
      "[SEND RESPONSE]",
      JSON.stringify({
        groupId: group.id,
        groupName: group.name,
        result: result
      })
    );

    return res.json({
      success: true,
      groupId: group.id,
      verifiedGroup: {
        id: group.id,
        name: group.name
      },
      result: result
    });

  } catch (e) {
    console.error("SEND ERROR:", e.message);

    return res.status(400).json({
      success: false,
      error: e.message
    });

  } finally {
    sendInProgress = false;
  }
});

// ======================================================
// ĐĂNG NHẬP ZALO: ƯU TIÊN KHÔI PHỤC PHIÊN ĐÃ LƯU, NẾU KHÔNG ĐƯỢC THÌ QUÉT QR
// ======================================================

async function startZaloLogin() {
  if (loginInProgress) return;

  loginInProgress = true;

  try {
    console.log("=== BẮT ĐẦU ĐĂNG NHẬP ZALO ===");

    qrCodeData = null;
    apiInstance = null;
    loginStatus = "Đang kiểm tra phiên đã lưu...";

    let api = null;

    // 1. Thử khôi phục phiên đã lưu
    const saved = loadSession();
    if (saved) {
      try {
        console.log("Đang khôi phục phiên đã lưu...");
        const zaloRestore = new Zalo();
        api = await zaloRestore.login({
          cookie: saved.cookie,
          imei: saved.imei,
          userAgent: saved.userAgent
        });

        if (!api || typeof api.sendMessage !== "function") {
          throw new Error("Phiên đã lưu không hợp lệ.");
        }

        console.log("Khôi phục phiên thành công, không cần quét QR.");
      } catch (e) {
        console.error("Khôi phục phiên thất bại:", e.message);
        api = null;
        deleteSession(); // phiên hỏng, xóa để quét QR mới
      }
    }

    // 2. Không khôi phục được thì quét QR
    if (!api) {
      loginStatus = "Đang tạo QR đăng nhập...";

      const zalo = new Zalo();

      api = await zalo.loginQR({}, (qrEvent) => {
        try {
          let qrStr = null;

          if (typeof qrEvent === "string") {
            qrStr = qrEvent;
          } else if (
            typeof qrEvent?.data === "string"
          ) {
            qrStr = qrEvent.data;
          } else if (
            typeof qrEvent?.image === "string"
          ) {
            qrStr = qrEvent.image;
          } else if (
            typeof qrEvent?.qr === "string"
          ) {
            qrStr = qrEvent.qr;
          } else if (
            typeof qrEvent?.data?.image === "string"
          ) {
            qrStr = qrEvent.data.image;
          }

          if (!qrStr) return;

          if (qrStr.startsWith("data:image/")) {
            qrCodeData = qrStr;
          } else if (/^https?:\/\//i.test(qrStr)) {
            qrCodeData = qrStr;
          } else if (
            qrStr.startsWith("/9j/") ||
            qrStr.startsWith("iVBOR")
          ) {
            qrCodeData = "data:image/png;base64," + qrStr;
          } else {
            QRCode.toDataURL(qrStr, (err, url) => {
              if (!err) {
                qrCodeData = url;
                loginStatus = "Đã tạo QR - hãy quét bằng Zalo.";
              } else {
                console.error("QR ERROR:", err.message);
                loginStatus = "Không tạo được ảnh QR.";
              }
            });
          }

          loginStatus = "Đã có QR Code - mở Zalo quét ngay!";

        } catch (e) {
          console.error("QR CALLBACK ERROR:", e.message);
        }
      });

      if (!api || typeof api.sendMessage !== "function") {
        throw new Error(
          "Đăng nhập chưa hoàn tất hoặc phiên Zalo không hợp lệ."
        );
      }

      // Quét QR thành công thì lưu phiên cho lần sau
      saveSession(api);
    }

    apiInstance = api;
    qrCodeData = null;

    loginStatus = "Đã đăng nhập thành công!";
    console.log(loginStatus);

  } catch (e) {
    console.error("LOGIN ERROR:", e.message);

    apiInstance = null;
    loginStatus = "Lỗi đăng nhập: " + e.message;

    setTimeout(() => {
      startZaloLogin();
    }, 10000);

  } finally {
    loginInProgress = false;
  }
}

// ======================================================
// KHỞI ĐỘNG SERVER
// ======================================================

// Trả 503 khi Zalo chưa đăng nhập để UptimeRobot báo Down và gửi email
app.get("/health", (req, res) => {
  res.status(apiInstance ? 200 : 503).json({
    status: apiInstance ? "ok" : "chua dang nhap",
    loggedIn: Boolean(apiInstance),
    loginStatus: loginStatus
  });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  startZaloLogin();
});
