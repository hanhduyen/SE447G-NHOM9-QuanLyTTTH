const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper async handler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Lấy staffId từ headers, body hoặc query
function getStaffId(req) {
  return Number(req.headers['x-staff-id'] || req.body?.staffId || req.query?.staffId) || 0;
}

// Kiểm tra quyền nhân viên (Chấp nhận VaiTroID = 2: Nhân viên, hoặc VaiTroID = 1: Quản trị viên)
async function requireStaff(staffId) {
  if (!staffId) return null;
  const [rows] = await db.query(
    `SELECT tk.TaiKhoanID, tk.HoTen, tk.Email, tk.VaiTroID, v.TenVaiTro
       FROM TaiKhoan tk
       JOIN VaiTro v ON tk.VaiTroID = v.VaiTroID
      WHERE tk.TaiKhoanID = ? AND tk.TrangThai = 1
        AND (tk.VaiTroID = 2 OR tk.VaiTroID = 1)`,
    [staffId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Middleware xác thực phân quyền nhân viên
async function ensureStaff(req, res) {
  const staffId = getStaffId(req);
  const staff = await requireStaff(staffId);
  if (!staff) {
    res.status(403).json({
      success: false,
      message: 'Không xác định được tài khoản nhân viên hợp lệ hoặc bạn không có quyền truy cập Cổng Nhân viên! Vui lòng đăng nhập lại.'
    });
    return null;
  }
  return staff;
}

// Helper gửi thông báo cho người dùng
async function createNotification(conn, customerId, staffId, title, content) {
  const [notice] = await conn.query(
    `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
     VALUES (?, ?, 5, ?, NOW(), 3)`,
    [title, content, staffId]
  );
  await conn.query(
    `INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc)
     VALUES (?, ?, 0)`,
    [notice.insertId, customerId]
  );
  return notice.insertId;
}

// Helper chuyển người tiếp theo trong hàng chờ khi lớp có chỗ
async function promoteNextWaiter(conn, classId, staffId) {
  const [waiters] = await conn.query(
    `SELECT d.DangKyID, d.KhachHangID, l.TenLop
       FROM DangKyKhoaHoc d
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
      WHERE d.LopHocID = ? AND d.TrangThai = 5
      ORDER BY d.NgayDangKy ASC, d.DangKyID ASC
      LIMIT 1 FOR UPDATE`,
    [classId]
  );
  if (!waiters.length) return null;

  const waiter = waiters[0];
  await conn.query(
    `UPDATE DangKyKhoaHoc
        SET TrangThai = 1, NguoiXuLyID = NULL, NgayXuLy = NULL, LyDoTuChoi = NULL,
            GhiChu = CONCAT(COALESCE(GhiChu, ''), CASE WHEN COALESCE(GhiChu, '') = '' THEN '' ELSE ' | ' END,
                            'Được chuyển từ danh sách chờ vào hàng chờ duyệt')
      WHERE DangKyID = ? AND TrangThai = 5`,
    [waiter.DangKyID]
  );
  await createNotification(
    conn,
    waiter.KhachHangID,
    staffId,
    'Lớp học đã có chỗ trống',
    `Lớp ${waiter.TenLop} đã có chỗ trống. Đăng ký của bạn đã được chuyển vào hàng chờ nhân viên duyệt.`
  );
  return waiter;
}

// =============================================================================
// 0. TỔNG QUAN DASHBOARD NHÂN VIÊN
// GET /api/staff/summary
// =============================================================================
router.get('/summary', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const [[checkins]] = await db.query(
    `SELECT COUNT(*) AS total FROM DiemDanh WHERE DATE(ThoiGian) = CURDATE()`
  );
  const [[enrollmentsPending]] = await db.query(
    `SELECT COUNT(*) AS total FROM DangKyKhoaHoc WHERE TrangThai = 1`
  );
  const [[requestsPending]] = await db.query(
    `SELECT COUNT(*) AS total FROM YeuCauDoiHuyLich WHERE TrangThai = 1`
  );
  const [[revenue]] = await db.query(
    `SELECT COALESCE(SUM(TongTien), 0) AS total
       FROM HoaDon WHERE TrangThai = 2 AND LoaiHoaDon = 3
         AND DATE(NgayThanhToan) = CURDATE()`
  );
  const [[notifications]] = await db.query(
    `SELECT COUNT(*) AS total FROM ThongBaoNguoiNhan
      WHERE TaiKhoanID = ? AND DaDoc = 0`,
    [staff.TaiKhoanID]
  );
  const [[totalCustomers]] = await db.query(
    `SELECT COUNT(*) AS total FROM KhachHang`
  );

  res.json({
    success: true,
    data: {
      staffName: staff.HoTen,
      checkinsToday: Number(checkins.total) || 0,
      pendingEnrollments: Number(enrollmentsPending.total) || 0,
      pendingRequests: Number(requestsPending.total) || 0,
      revenueToday: Number(revenue.total) || 0,
      unreadNotifications: Number(notifications.total) || 0,
      totalCustomers: Number(totalCustomers.total) || 0
    }
  });
}));

// =============================================================================
// 1. THÔNG BÁO HỆ THỐNG
// Luồng sự kiện chính:
// 1. Mở mục thông báo.
// 2. Hệ thống tải thông báo theo người nhận/vai trò.
// 3. Người dùng chọn thông báo.
// 4. Hệ thống hiển thị nội dung và cập nhật đã đọc.
// =============================================================================

// GET /api/staff/notifications: Lấy danh sách thông báo của nhân viên
router.get('/notifications', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const [rows] = await db.query(
    `SELECT t.ThongBaoID AS id, t.TieuDe AS title, t.NoiDung AS content,
            t.ThoiGianGui AS sentAt,
            COALESCE(nn.DaDoc, 0) AS isRead,
            nn.NgayDoc AS readAt
       FROM ThongBao t
       LEFT JOIN ThongBaoNguoiNhan nn ON nn.ThongBaoID = t.ThongBaoID AND nn.TaiKhoanID = ?
      WHERE nn.TaiKhoanID = ? OR t.NhomNguoiNhan IN (1, 2)
      ORDER BY t.ThoiGianGui DESC, t.ThongBaoID DESC`,
    [staff.TaiKhoanID, staff.TaiKhoanID]
  );

  res.json({ success: true, data: rows });
}));

// GET /api/staff/notifications/:id: Xem chi tiết thông báo và cập nhật đã đọc
router.get('/notifications/:id', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const notifId = Number(req.params.id);

  const [rows] = await db.query(
    `SELECT t.ThongBaoID AS id, t.TieuDe AS title, t.NoiDung AS content,
            t.ThoiGianGui AS sentAt,
            COALESCE(nn.DaDoc, 0) AS isRead,
            nn.NgayDoc AS readAt
       FROM ThongBao t
       LEFT JOIN ThongBaoNguoiNhan nn ON nn.ThongBaoID = t.ThongBaoID AND nn.TaiKhoanID = ?
      WHERE t.ThongBaoID = ? AND (nn.TaiKhoanID = ? OR t.NhomNguoiNhan IN (1, 2))`,
    [staff.TaiKhoanID, notifId, staff.TaiKhoanID]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo.' });
  }

  // Cập nhật trạng thái đã đọc
  const [exist] = await db.query(
    `SELECT DaDoc FROM ThongBaoNguoiNhan WHERE ThongBaoID = ? AND TaiKhoanID = ?`,
    [notifId, staff.TaiKhoanID]
  );
  if (exist.length > 0) {
    await db.query(
      `UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE ThongBaoID = ? AND TaiKhoanID = ?`,
      [notifId, staff.TaiKhoanID]
    );
  } else {
    await db.query(
      `INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc, NgayDoc) VALUES (?, ?, 1, NOW())`,
      [notifId, staff.TaiKhoanID]
    );
  }

  res.json({
    success: true,
    data: {
      ...rows[0],
      isRead: 1,
      readAt: new Date()
    }
  });
}));

// PATCH /api/staff/notifications/:id/read: Đánh dấu đã đọc 1 thông báo
router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const notifId = Number(req.params.id);

  const [exist] = await db.query(
    `SELECT DaDoc FROM ThongBaoNguoiNhan WHERE ThongBaoID = ? AND TaiKhoanID = ?`,
    [notifId, staff.TaiKhoanID]
  );
  if (exist.length > 0) {
    await db.query(
      `UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE ThongBaoID = ? AND TaiKhoanID = ?`,
      [notifId, staff.TaiKhoanID]
    );
  } else {
    await db.query(
      `INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc, NgayDoc) VALUES (?, ?, 1, NOW())`,
      [notifId, staff.TaiKhoanID]
    );
  }

  res.json({ success: true, message: 'Đã đánh dấu thông báo là đã đọc.' });
}));

// PATCH /api/staff/notifications/read-all: Đánh dấu tất cả đã đọc
router.patch('/notifications/read-all', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  await db.query(
    `UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE TaiKhoanID = ? AND DaDoc = 0`,
    [staff.TaiKhoanID]
  );
  res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo là đã đọc.' });
}));

// =============================================================================
// 2. GHI NHẬN CHECK-IN VÀ ĐIỂM DANH
// Luồng sự kiện chính:
// 1. Nhân viên mở chức năng check-in và điểm danh.
// 2. Hệ thống hiển thị giao diện chức năng.
// 3. Nhân viên tìm khách hàng hoặc quét mã thành viên.
// 4. Hệ thống hiển thị thông tin khách hàng.
// 5. Nhân viên chọn buổi hoặc loại check-in.
// 6. Nhân viên xác nhận ghi nhận.
// 7. Hệ thống kiểm tra tài khoản, hiệu lực gói tập hoặc đăng ký và trạng thái điểm danh.
// 8. Nếu hợp lệ, hệ thống lưu lượt check-in hoặc điểm danh.
// 9. Hệ thống thông báo kết quả thành công.
// =============================================================================

// GET /api/staff/members/search?q=...: Tìm khách hàng và nạp thông tin gói tập / lớp học
router.get('/members/search', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const q = String(req.query.q || '').trim();

  if (!q) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mã thành viên, họ tên hoặc số điện thoại để tìm kiếm.' });
  }

  const [members] = await db.query(
    `SELECT k.KhachHangID AS id, k.MaKhachHang AS code, tk.HoTen AS name,
            tk.SoDienThoai AS phone, tk.Email AS email, tk.GioiTinh AS gender,
            tk.TrangThai AS accountStatus
       FROM KhachHang k
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE k.MaKhachHang = ? OR tk.SoDienThoai = ? OR tk.HoTen LIKE ?
      LIMIT 10`,
    [q.toUpperCase(), q, `%${q}%`]
  );

  if (!members.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng phù hợp.' });
  }

  // Nạp thông tin gói tập và lớp học của khách hàng đầu tiên
  const m = members[0];

  // Gói tập còn hiệu lực
  const [plans] = await db.query(
    `SELECT d.DangKyGoiTapID AS planRegistrationId, g.TenGoiTap AS planName,
            d.NgayBatDau AS startDate, d.NgayHetHan AS endDate,
            DATEDIFF(d.NgayHetHan, CURDATE()) AS daysRemaining,
            d.TrangThai AS status
       FROM DangKyGoiTap d
       JOIN GoiTap g ON g.GoiTapID = d.GoiTapID
      WHERE d.KhachHangID = ? AND d.TrangThai = 1
        AND CURDATE() BETWEEN d.NgayBatDau AND d.NgayHetHan
      ORDER BY d.NgayHetHan DESC LIMIT 1`,
    [m.id]
  );

  // Khóa học / lớp học đã đăng ký (được duyệt TrangThai = 2)
  const [classes] = await db.query(
    `SELECT d.DangKyID AS enrollmentId, l.LopHocID AS classId,
            l.MaLop AS classCode, l.TenLop AS className,
            l.NgayBatDau AS startDate, l.NgayKetThuc AS endDate, l.SucChua AS capacity
       FROM DangKyKhoaHoc d
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
      WHERE d.KhachHangID = ? AND d.TrangThai = 2
      ORDER BY d.DangKyID DESC`,
    [m.id]
  );

  // Buổi học hôm nay khách hàng có thể điểm danh
  const [todaySessions] = await db.query(
    `SELECT b.BuoiHocID AS sessionId, b.NgayHoc AS sessionDate,
            b.GioBatDau AS startTime, b.GioKetThuc AS endTime,
            l.TenLop AS className, l.MaLop AS classCode,
            p.TenPhong AS roomName, d.DangKyID AS enrollmentId,
            (SELECT COUNT(*) FROM DiemDanh dd WHERE dd.KhachHangID = ? AND dd.BuoiHocID = b.BuoiHocID AND dd.LoaiCheckIn = 2) AS isAttended
       FROM BuoiHoc b
       JOIN LopHoc l ON l.LopHocID = b.LopHocID
       JOIN Phong p ON p.PhongID = b.PhongID
       JOIN DangKyKhoaHoc d ON d.LopHocID = l.LopHocID AND d.KhachHangID = ? AND d.TrangThai = 2
      WHERE b.NgayHoc = CURDATE() AND b.TrangThai IN (1, 2)
      ORDER BY b.GioBatDau ASC`,
    [m.id, m.id]
  );

  res.json({
    success: true,
    data: {
      member: m,
      activePlan: plans.length ? plans[0] : null,
      enrolledClasses: classes,
      todaySessions: todaySessions,
      allMatches: members
    }
  });
}));

// GET /api/staff/checkins: Danh sách lượt check-in hôm nay
router.get('/checkins', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const params = date ? [date] : [];
  const where = date ? 'DATE(dd.ThoiGian) = ?' : 'DATE(dd.ThoiGian) = CURDATE()';

  const [rows] = await db.query(
    `SELECT dd.DiemDanhID AS id, dd.ThoiGian AS checkedAt,
            dd.LoaiCheckIn AS type, dd.GhiChu AS note,
            k.MaKhachHang AS memberCode, tk.HoTen AS memberName,
            tk.SoDienThoai AS phone,
            gt.TenGoiTap AS planName, d.NgayHetHan AS membershipEnd,
            l.TenLop AS className, b.BuoiHocID AS sessionId,
            staffTk.HoTen AS staffName
       FROM DiemDanh dd
       JOIN KhachHang k ON k.KhachHangID = dd.KhachHangID
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
       LEFT JOIN DangKyGoiTap d ON d.DangKyGoiTapID = dd.DangKyGoiTapID
       LEFT JOIN GoiTap gt ON gt.GoiTapID = d.GoiTapID
       LEFT JOIN BuoiHoc b ON b.BuoiHocID = dd.BuoiHocID
       LEFT JOIN LopHoc l ON l.LopHocID = b.LopHocID
       LEFT JOIN TaiKhoan staffTk ON staffTk.TaiKhoanID = dd.NguoiGhiNhanID
      WHERE ${where}
      ORDER BY dd.ThoiGian DESC`,
    params
  );

  res.json({ success: true, data: rows });
}));

// POST /api/staff/checkins: Ghi nhận check-in gói tập hoặc điểm danh buổi học
router.post('/checkins', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const memberCode = String(req.body.memberCode || '').trim().toUpperCase();
  const type = Number(req.body.type || 1); // 1: Check-in gói tập trung tâm, 2: Điểm danh buổi học
  const sessionId = Number(req.body.sessionId) || null;
  const note = String(req.body.note || '').trim() || null;

  if (!memberCode) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mã thẻ hội viên hoặc số điện thoại.' });
  }
  if (![1, 2].includes(type)) {
    return res.status(400).json({ success: false, message: 'Loại check-in không hợp lệ (1: Gói tập, 2: Điểm danh buổi học).' });
  }

  // 1. Tìm thông tin khách hàng
  const [members] = await db.query(
    `SELECT k.KhachHangID, k.MaKhachHang, tk.HoTen, tk.TrangThai
       FROM KhachHang k
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE k.MaKhachHang = ? OR tk.SoDienThoai = ?`,
    [memberCode, memberCode]
  );

  if (!members.length) {
    return res.status(404).json({ success: false, message: `Không tìm thấy khách hàng với mã hoặc SĐT "${memberCode}".` });
  }

  const member = members[0];
  if (member.TrangThai !== 1) {
    return res.status(403).json({ success: false, message: `Tài khoản của hội viên ${member.HoTen} hiện đang bị khóa hoặc ngưng hoạt động.` });
  }

  // 2. Xử lý Loại 1: Check-in gói tập trung tâm
  if (type === 1) {
    const [plans] = await db.query(
      `SELECT d.DangKyGoiTapID, g.TenGoiTap, d.NgayBatDau, d.NgayHetHan
         FROM DangKyGoiTap d
         JOIN GoiTap g ON g.GoiTapID = d.GoiTapID
        WHERE d.KhachHangID = ? AND d.TrangThai = 1
          AND CURDATE() BETWEEN d.NgayBatDau AND d.NgayHetHan
        ORDER BY d.NgayHetHan DESC LIMIT 1`,
      [member.KhachHangID]
    );

    if (!plans.length) {
      return res.status(403).json({
        success: false,
        message: `Hội viên ${member.HoTen} không có gói tập còn hiệu lực hôm nay. Từ chối check-in!`
      });
    }

    // Kiểm tra trùng lặp: Đã check-in trung tâm hôm nay chưa
    const [duplicate] = await db.query(
      `SELECT DiemDanhID, ThoiGian FROM DiemDanh
        WHERE KhachHangID = ? AND LoaiCheckIn = 1 AND DATE(ThoiGian) = CURDATE()
        LIMIT 1`,
      [member.KhachHangID]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Hội viên ${member.HoTen} đã check-in trung tâm hôm nay vào lúc ${new Date(duplicate[0].ThoiGian).toLocaleTimeString('vi-VN')}!`
      });
    }

    // Lưu lượt check-in
    const [insert] = await db.query(
      `INSERT INTO DiemDanh (KhachHangID, LoaiCheckIn, DangKyGoiTapID, ThoiGian, NguoiGhiNhanID, GhiChu)
       VALUES (?, 1, ?, NOW(), ?, ?)`,
      [member.KhachHangID, plans[0].DangKyGoiTapID, staff.TaiKhoanID, note || 'Check-in tại quầy']
    );

    return res.status(201).json({
      success: true,
      message: `Ghi nhận check-in thành công: ${member.HoTen} (${plans[0].TenGoiTap})`,
      data: {
        id: insert.insertId,
        memberCode: member.MaKhachHang,
        memberName: member.HoTen,
        planName: plans[0].TenGoiTap,
        membershipEnd: plans[0].NgayHetHan,
        type: 1
      }
    });
  }

  // 3. Xử lý Loại 2: Điểm danh buổi học
  if (type === 2) {
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn buổi học để điểm danh.' });
    }

    const [sessions] = await db.query(
      `SELECT b.BuoiHocID, b.LopHocID, b.NgayHoc, b.GioBatDau, b.GioKetThuc, l.TenLop, l.MaLop
         FROM BuoiHoc b
         JOIN LopHoc l ON l.LopHocID = b.LopHocID
        WHERE b.BuoiHocID = ? AND b.TrangThai IN (1, 2)`,
      [sessionId]
    );

    if (!sessions.length) {
      return res.status(404).json({ success: false, message: 'Buổi học không tồn tại hoặc đã bị hủy.' });
    }
    const session = sessions[0];

    // Kiểm tra đăng ký lớp học đã duyệt
    const [bookings] = await db.query(
      `SELECT DangKyID FROM DangKyKhoaHoc
        WHERE KhachHangID = ? AND LopHocID = ? AND TrangThai = 2
        LIMIT 1`,
      [member.KhachHangID, session.LopHocID]
    );

    if (!bookings.length) {
      return res.status(403).json({
        success: false,
        message: `Hội viên ${member.HoTen} chưa có đăng ký lớp "${session.TenLop}" được duyệt.`
      });
    }

    // Kiểm tra trùng lặp điểm danh buổi học này
    const [duplicate] = await db.query(
      `SELECT DiemDanhID FROM DiemDanh
        WHERE KhachHangID = ? AND BuoiHocID = ? AND LoaiCheckIn = 2
        LIMIT 1`,
      [member.KhachHangID, sessionId]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Hội viên ${member.HoTen} đã được điểm danh buổi học này trước đó.`
      });
    }

    // Lưu điểm danh buổi học
    const [insert] = await db.query(
      `INSERT INTO DiemDanh (KhachHangID, LoaiCheckIn, BuoiHocID, DangKyID, ThoiGian, NguoiGhiNhanID, GhiChu)
       VALUES (?, 2, ?, ?, NOW(), ?, ?)`,
      [member.KhachHangID, sessionId, bookings[0].DangKyID, staff.TaiKhoanID, note || 'Điểm danh lớp học']
    );

    return res.status(201).json({
      success: true,
      message: `Điểm danh thành công: ${member.HoTen} - Lớp ${session.TenLop}`,
      data: {
        id: insert.insertId,
        memberCode: member.MaKhachHang,
        memberName: member.HoTen,
        className: session.TenLop,
        sessionId: sessionId,
        type: 2
      }
    });
  }
}));

// =============================================================================
// 3. QUẢN LÝ THÔNG TIN KHÁCH HÀNG
// Luồng sự kiện chính:
// 1. Nhân viên mở danh sách khách hàng.
// 2. Hệ thống hiển thị danh sách khách hàng.
// 3. Nhân viên tìm kiếm theo mã, tên hoặc số điện thoại.
// 4. Hệ thống hiển thị kết quả tìm kiếm.
// 5. Nhân viên chọn hồ sơ khách hàng cần xem.
// 6. Hệ thống hiển thị thông tin hồ sơ.
// 7. Nhân viên xem hoặc chỉnh sửa các trường thông tin được phép.
// 8. Nhân viên chọn lưu thay đổi.
// 9. Hệ thống kiểm tra dữ liệu và cập nhật hồ sơ.
// 10. Hệ thống thông báo kết quả thành công.
//
// Luồng thay thế:
// - Nếu không tìm thấy khách hàng, hiển thị thông báo không tìm thấy.
// - Nếu dữ liệu nhập không đúng định dạng (SĐT phải đủ 10 số, bắt đầu từ 0), thông báo yêu cầu sửa.
// - Nếu chỉ xem mà không sửa, kết thúc thao tác không cập nhật dữ liệu.
//
// Luồng ngoại lệ:
// - Nếu xảy ra lỗi khi lưu dữ liệu, rollback và giữ nguyên thông tin khách hàng trước đó.
//
// Yêu cầu đặc biệt:
// - Nhân viên chỉ được chỉnh sửa các trường thông tin khách hàng theo quyền được cấp;
//   KHÔNG ĐƯỢC SỬA quyền quản trị, vai trò hệ thống hoặc cấu hình bảo mật.
// =============================================================================

// GET /api/staff/customers: Danh sách khách hàng kèm tìm kiếm
router.get('/customers', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;

  const [rows] = await db.query(
    `SELECT k.KhachHangID AS id, k.MaKhachHang AS code, tk.HoTen AS fullName,
            tk.SoDienThoai AS phone, tk.Email AS email, tk.DiaChi AS address,
            tk.NgaySinh AS birthDate, tk.GioiTinh AS gender,
            k.ChieuCao AS height, k.CanNang AS weight, k.MucTieu AS fitnessGoal,
            k.LienHeKhanCap AS emergencyContact, k.GhiChu AS notes,
            k.NgayDangKy AS registeredDate, tk.TrangThai AS status,
            (SELECT gt.TenGoiTap 
               FROM DangKyGoiTap dgt 
               JOIN GoiTap gt ON gt.GoiTapID = dgt.GoiTapID 
              WHERE dgt.KhachHangID = k.KhachHangID AND dgt.TrangThai = 1 
                AND CURDATE() BETWEEN dgt.NgayBatDau AND dgt.NgayHetHan 
              ORDER BY dgt.NgayHetHan DESC LIMIT 1) AS currentPlan,
            (SELECT COUNT(*) FROM DangKyKhoaHoc dkh WHERE dkh.KhachHangID = k.KhachHangID AND dkh.TrangThai = 2) AS enrolledClassesCount
       FROM KhachHang k
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE (? = '' OR k.MaKhachHang LIKE ? OR tk.HoTen LIKE ? OR tk.SoDienThoai LIKE ? OR tk.Email LIKE ?)
      ORDER BY k.KhachHangID DESC`,
    [q, like, like, like, like]
  );

  res.json({
    success: true,
    data: rows,
    total: rows.length
  });
}));

// GET /api/staff/customers/:id: Xem chi tiết hồ sơ 1 khách hàng
router.get('/customers/:id', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const customerId = Number(req.params.id);

  const [rows] = await db.query(
    `SELECT k.KhachHangID AS id, k.MaKhachHang AS code, tk.HoTen AS fullName,
            tk.SoDienThoai AS phone, tk.Email AS email, tk.DiaChi AS address,
            tk.NgaySinh AS birthDate, tk.GioiTinh AS gender,
            k.ChieuCao AS height, k.CanNang AS weight, k.MucTieu AS fitnessGoal,
            k.LienHeKhanCap AS emergencyContact, k.GhiChu AS notes,
            k.NgayDangKy AS registeredDate, tk.TrangThai AS status
       FROM KhachHang k
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE k.KhachHangID = ?`,
    [customerId]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ khách hàng!' });
  }

  const customer = rows[0];

  // Lịch sử gói tập
  const [plans] = await db.query(
    `SELECT d.DangKyGoiTapID AS id, g.TenGoiTap AS planName,
            d.NgayBatDau AS startDate, d.NgayHetHan AS endDate,
            d.TrangThai AS status
       FROM DangKyGoiTap d
       JOIN GoiTap g ON g.GoiTapID = d.GoiTapID
      WHERE d.KhachHangID = ?
      ORDER BY d.DangKyGoiTapID DESC`,
    [customerId]
  );

  // Lịch sử đăng ký khóa học
  const [enrollments] = await db.query(
    `SELECT d.DangKyID AS id, l.TenLop AS className, l.MaLop AS classCode,
            d.NgayDangKy AS registeredAt, d.TrangThai AS status
       FROM DangKyKhoaHoc d
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
      WHERE d.KhachHangID = ?
      ORDER BY d.NgayDangKy DESC`,
    [customerId]
  );

  res.json({
    success: true,
    data: {
      ...customer,
      plans,
      enrollments
    }
  });
}));

// PUT /api/staff/customers/:id: Cập nhật hồ sơ khách hàng
// Ràng buộc nghiêm ngặt:
// - Kiểm tra định dạng số điện thoại 10 số bắt đầu từ 0: /^0\d{9}$/
// - Kiểm tra trùng số điện thoại
// - TUYỆT ĐỐI KHÔNG cho phép sửa VaiTroID, role, MatKhauHash, TrangThai quản trị
router.put('/customers/:id', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const customerId = Number(req.params.id);

  // Kiểm tra khách hàng tồn tại
  const [existing] = await db.query(
    `SELECT tk.TaiKhoanID, tk.HoTen, tk.SoDienThoai, tk.Email
       FROM KhachHang k
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE k.KhachHangID = ?`,
    [customerId]
  );

  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng cần cập nhật!' });
  }

  const current = existing[0];
  const {
    fullName,
    phone,
    address,
    birthDate,
    gender,
    height,
    weight,
    fitnessGoal,
    emergencyContact,
    notes
  } = req.body;

  // 1. Kiểm tra định dạng số điện thoại (Luồng thay thế)
  let cleanPhone = phone !== undefined ? String(phone).trim() : current.SoDienThoai;
  if (cleanPhone) {
    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại không đúng định dạng! Số điện thoại phải đủ 10 chữ số, bắt đầu từ số 0 và không chứa ký tự khác.'
      });
    }

    // Kiểm tra trùng SĐT với tài khoản khác
    const [dup] = await db.query(
      `SELECT TaiKhoanID FROM TaiKhoan WHERE SoDienThoai = ? AND TaiKhoanID <> ? LIMIT 1`,
      [cleanPhone, customerId]
    );
    if (dup.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại này đã được đăng ký cho khách hàng khác!'
      });
    }
  }

  // 2. Thực hiện cập nhật với Transaction (Luồng ngoại lệ)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Cập nhật thông tin cá nhân trong TaiKhoan (Tuyệt đối không sửa VaiTroID, MatKhauHash)
    await conn.query(
      `UPDATE TaiKhoan 
          SET HoTen = COALESCE(?, HoTen),
              SoDienThoai = COALESCE(?, SoDienThoai),
              DiaChi = ?,
              NgaySinh = ?,
              GioiTinh = ?
        WHERE TaiKhoanID = ?`,
      [
        fullName ? String(fullName).trim() : null,
        cleanPhone || null,
        address !== undefined ? (String(address).trim() || null) : null,
        birthDate || null,
        gender !== undefined ? String(gender).trim() : null,
        customerId
      ]
    );

    // Cập nhật thông tin thể chất trong KhachHang
    await conn.query(
      `UPDATE KhachHang
          SET ChieuCao = ?,
              CanNang = ?,
              MucTieu = ?,
              LienHeKhanCap = ?,
              GhiChu = ?
        WHERE KhachHangID = ?`,
      [
        height ? Number(height) : null,
        weight ? Number(weight) : null,
        fitnessGoal !== undefined ? (String(fitnessGoal).trim() || null) : null,
        emergencyContact !== undefined ? (String(emergencyContact).trim() || null) : null,
        notes !== undefined ? (String(notes).trim() || null) : null,
        customerId
      ]
    );

    await conn.commit();

    res.json({
      success: true,
      message: 'Cập nhật hồ sơ khách hàng thành công!',
      data: {
        id: customerId,
        fullName: fullName || current.HoTen,
        phone: cleanPhone
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[STAFF CUSTOMER UPDATE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu dữ liệu: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên thông tin khách hàng trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// =============================================================================
// 4. DUYỆT ĐĂNG KÝ KHÓA HỌC
// Luồng sự kiện chính:
// 1. Mở danh sách đăng ký.
// 2. Chọn yêu cầu.
// 3. Kiểm tra thông tin khách, lớp và điều kiện.
// 4. Xác nhận/từ chối.
// 5. Hệ thống cập nhật trạng thái và gửi thông báo.
//
// Luồng thay thế:
// Nếu lớp đã đầy hoặc lịch không còn phù hợp, nhân viên từ chối hoặc đề xuất lớp khác.
// =============================================================================

// GET /api/staff/enrollments: Danh sách đăng ký khóa học
router.get('/enrollments', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const status = String(req.query.status || 'all');
  let statusSql = '';
  const params = [];

  if (['1', '2', '3', '4', '5'].includes(status)) {
    statusSql = 'WHERE d.TrangThai = ?';
    params.push(Number(status));
  } else if (status === 'pending') {
    statusSql = 'WHERE d.TrangThai = 1';
  } else if (status === 'waiting') {
    statusSql = 'WHERE d.TrangThai = 5';
  }

  const [rows] = await db.query(
    `SELECT d.DangKyID AS id, d.KhachHangID AS memberId,
            k.MaKhachHang AS memberCode, tk.HoTen AS memberName,
            tk.SoDienThoai AS phone, tk.Email AS email,
            l.LopHocID AS classId, l.MaLop AS classCode, l.TenLop AS className,
            kh.TenKhoaHoc AS courseName, l.SucChua AS capacity,
            (SELECT COUNT(*) FROM DangKyKhoaHoc d2 WHERE d2.LopHocID = l.LopHocID AND d2.TrangThai = 2) AS enrolledCount,
            d.NgayDangKy AS registeredAt, d.TrangThai AS status,
            d.LyDoTuChoi AS rejectReason, d.GhiChu AS note,
            staffTk.HoTen AS processedByName, d.NgayXuLy AS processedAt
       FROM DangKyKhoaHoc d
       JOIN KhachHang k ON k.KhachHangID = d.KhachHangID
       JOIN TaiKhoan tk ON tk.TaiKhoanID = d.KhachHangID
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
       JOIN KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
       LEFT JOIN TaiKhoan staffTk ON staffTk.TaiKhoanID = d.NguoiXuLyID
       ${statusSql}
      ORDER BY CASE d.TrangThai WHEN 1 THEN 0 WHEN 5 THEN 1 ELSE 2 END,
               d.NgayDangKy ASC`,
    params
  );

  res.json({ success: true, data: rows });
}));

// GET /api/staff/classes: Danh sách lớp học kèm sĩ số và sức chứa
router.get('/classes', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const [rows] = await db.query(
    `SELECT l.LopHocID AS id, l.MaLop AS code, l.TenLop AS name,
            l.SucChua AS capacity, kh.TenKhoaHoc AS courseName,
            l.NgayBatDau AS startDate, l.NgayKetThuc AS endDate,
            COALESCE((SELECT COUNT(*) FROM DangKyKhoaHoc d WHERE d.LopHocID = l.LopHocID AND d.TrangThai = 2), 0) AS enrolled,
            COALESCE((SELECT COUNT(*) FROM DangKyKhoaHoc d WHERE d.LopHocID = l.LopHocID AND d.TrangThai = 5), 0) AS waiting,
            (l.SucChua - COALESCE((SELECT COUNT(*) FROM DangKyKhoaHoc d WHERE d.LopHocID = l.LopHocID AND d.TrangThai = 2), 0)) AS available
       FROM LopHoc l
       JOIN KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
      ORDER BY l.NgayBatDau DESC, l.LopHocID DESC`
  );

  res.json({ success: true, data: rows });
}));

// POST /api/staff/enrollments/:id/decision: Xác nhận hoặc từ chối đăng ký khóa học
router.post('/enrollments/:id/decision', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const enrollmentId = Number(req.params.id);
  const action = String(req.body.action || '').toLowerCase(); // 'approve' hoặc 'reject'
  const reason = String(req.body.reason || '').trim();

  if (!enrollmentId || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Thao tác xử lý đăng ký không hợp lệ (approve hoặc reject).' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT d.DangKyID, d.KhachHangID, d.LopHocID, d.TrangThai,
              l.TenLop, l.SucChua, tk.HoTen AS customerName
         FROM DangKyKhoaHoc d
         JOIN LopHoc l ON l.LopHocID = d.LopHocID
         JOIN TaiKhoan tk ON tk.TaiKhoanID = d.KhachHangID
        WHERE d.DangKyID = ? FOR UPDATE`,
      [enrollmentId]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu đăng ký.' });
    }

    const enrollment = rows[0];
    if (Number(enrollment.TrangThai) !== 1 && Number(enrollment.TrangThai) !== 5) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Yêu cầu đăng ký đã được xử lý trước đó.' });
    }

    if (action === 'approve') {
      // Kiểm tra sĩ số lớp hiện tại
      const [counts] = await conn.query(
        `SELECT COUNT(*) AS total FROM DangKyKhoaHoc
          WHERE LopHocID = ? AND TrangThai = 2`,
        [enrollment.LopHocID]
      );
      const currentEnrolled = Number(counts[0].total);

      // Nếu lớp đã đủ sĩ số -> Chuyển vào danh sách chờ (Luồng thay thế)
      if (currentEnrolled >= Number(enrollment.SucChua)) {
        await conn.query(
          `UPDATE DangKyKhoaHoc
              SET TrangThai = 5, NguoiXuLyID = ?, NgayXuLy = NOW(),
                  GhiChu = 'Lớp đã đủ sĩ số tại thời điểm duyệt; chuyển vào danh sách chờ'
            WHERE DangKyID = ?`,
          [staff.TaiKhoanID, enrollmentId]
        );
        await createNotification(
          conn,
          enrollment.KhachHangID,
          staff.TaiKhoanID,
          'Đăng ký khóa học chuyển vào danh sách chờ',
          `Lớp ${enrollment.TenLop} hiện đã đủ sĩ số (${enrollment.SucChua}/${enrollment.SucChua} học viên). Đăng ký của bạn đã được chuyển vào danh sách chờ tự động.`
        );
        await conn.commit();
        return res.json({
          success: true,
          message: `Lớp ${enrollment.TenLop} đã đủ sĩ số (${enrollment.SucChua} học viên). Yêu cầu đã được chuyển vào danh sách chờ.`
        });
      }

      // Còn chỗ -> Xác nhận duyệt thành công
      await conn.query(
        `UPDATE DangKyKhoaHoc
            SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), LyDoTuChoi = NULL
          WHERE DangKyID = ?`,
        [staff.TaiKhoanID, enrollmentId]
      );
      await createNotification(
        conn,
        enrollment.KhachHangID,
        staff.TaiKhoanID,
        'Đăng ký khóa học đã được duyệt',
        `Chúc mừng bạn! Yêu cầu đăng ký lớp ${enrollment.TenLop} của bạn đã được nhân viên duyệt thành công. Vui lòng theo dõi lịch học để tham gia đúng giờ.`
      );
    } else {
      // Từ chối yêu cầu đăng ký
      const finalReason = reason || 'Lớp đã đầy hoặc lịch học không còn phù hợp.';
      await conn.query(
        `UPDATE DangKyKhoaHoc
            SET TrangThai = 3, NguoiXuLyID = ?, NgayXuLy = NOW(), LyDoTuChoi = ?
          WHERE DangKyID = ?`,
        [staff.TaiKhoanID, finalReason, enrollmentId]
      );
      await createNotification(
        conn,
        enrollment.KhachHangID,
        staff.TaiKhoanID,
        'Đăng ký khóa học chưa được duyệt',
        `Đăng ký lớp ${enrollment.TenLop} chưa được duyệt. Lý do: ${finalReason}. Bạn có thể chọn lớp hoặc khung giờ khác phù hợp hơn.`
      );

      // Nếu có người tiếp theo trong danh sách chờ của lớp, chuyển lên chờ duyệt
      await promoteNextWaiter(conn, enrollment.LopHocID, staff.TaiKhoanID);
    }

    await conn.commit();
    res.json({
      success: true,
      message: action === 'approve'
        ? `Đã duyệt đăng ký lớp ${enrollment.TenLop} cho khách hàng ${enrollment.customerName} thành công!`
        : `Đã từ chối đăng ký lớp ${enrollment.TenLop} của khách hàng ${enrollment.customerName}.`
    });
  } catch (error) {
    await conn.rollback();
    console.error('[STAFF ENROLLMENT DECISION ERROR]', error);
    res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu đăng ký: ' + error.message });
  } finally {
    conn.release();
  }
}));

// =============================================================================
// 5. YÊU CẦU ĐỔI / HỦY LỚP CỦA HỘI VIÊN
// =============================================================================
router.get('/class-requests', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const [rows] = await db.query(
    `SELECT y.YeuCauID AS id, y.LoaiYeuCau AS type, y.TrangThai AS status,
            y.LyDo AS reason, y.NgayGui AS requestedAt,
            d.DangKyID AS enrollmentId, d.KhachHangID AS memberId,
            k.MaKhachHang AS memberCode, tk.HoTen AS memberName,
            l.LopHocID AS fromClassId, l.TenLop AS fromClassName,
            lm.LopHocID AS toClassId, lm.TenLop AS toClassName
       FROM YeuCauDoiHuyLich y
       JOIN DangKyKhoaHoc d ON d.DangKyID = y.DangKyID
       JOIN KhachHang k ON k.KhachHangID = d.KhachHangID
       JOIN TaiKhoan tk ON tk.TaiKhoanID = d.KhachHangID
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
       LEFT JOIN LopHoc lm ON lm.LopHocID = y.LopHocMoiID
      WHERE y.TrangThai = 1
      ORDER BY y.NgayGui ASC`
  );
  res.json({ success: true, data: rows });
}));

router.post('/class-requests/:id/handle', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const requestId = Number(req.params.id);
  const approve = req.body.approve === true || req.body.approve === 1 || req.body.approve === 'true';
  const reason = String(req.body.reason || '').trim();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT y.YeuCauID, y.LoaiYeuCau, y.TrangThai, y.LopHocMoiID,
              d.DangKyID, d.KhachHangID, d.LopHocID, d.TrangThai AS enrollmentStatus,
              l.TenLop AS fromClassName
         FROM YeuCauDoiHuyLich y
         JOIN DangKyKhoaHoc d ON d.DangKyID = y.DangKyID
         JOIN LopHoc l ON l.LopHocID = d.LopHocID
        WHERE y.YeuCauID = ? FOR UPDATE`,
      [requestId]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' });
    }
    const r = rows[0];
    if (Number(r.TrangThai) !== 1) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'Yêu cầu đã được xử lý trước đó.' });
    }

    if (!approve) {
      await conn.query(
        `UPDATE YeuCauDoiHuyLich SET TrangThai = 3, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`,
        [staff.TaiKhoanID, reason || 'Không được chấp nhận', requestId]
      );
      await createNotification(conn, r.KhachHangID, staff.TaiKhoanID, 'Yêu cầu đổi/hủy lớp không được chấp nhận', reason || 'Yêu cầu của bạn chưa được chấp nhận.');
      await conn.commit();
      return res.json({ success: true, message: 'Đã từ chối yêu cầu đổi/hủy lớp.' });
    }

    if (Number(r.LoaiYeuCau) === 1) {
      // Hủy lớp
      await conn.query(`UPDATE DangKyKhoaHoc SET TrangThai = 4, NguoiXuLyID = ?, NgayXuLy = NOW() WHERE DangKyID = ?`, [staff.TaiKhoanID, r.DangKyID]);
      await conn.query(`UPDATE YeuCauDoiHuyLich SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`, [staff.TaiKhoanID, reason || null, requestId]);
      await createNotification(conn, r.KhachHangID, staff.TaiKhoanID, 'Yêu cầu hủy lớp được chấp nhận', `Yêu cầu hủy lớp ${r.fromClassName} đã được chấp nhận.`);
      await promoteNextWaiter(conn, r.LopHocID, staff.TaiKhoanID);
    } else {
      // Đổi lớp
      const targetId = Number(r.LopHocMoiID);
      const [target] = await conn.query(`SELECT LopHocID, TenLop, SucChua FROM LopHoc WHERE LopHocID = ? FOR UPDATE`, [targetId]);
      if (!target.length) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: 'Không tìm thấy lớp muốn chuyển.' });
      }
      const [counts] = await conn.query(`SELECT COUNT(*) AS total FROM DangKyKhoaHoc WHERE LopHocID = ? AND TrangThai IN (1, 2)`, [targetId]);
      if (Number(counts[0].total) >= Number(target[0].SucChua)) {
        await conn.rollback();
        return res.status(409).json({ success: false, message: 'Lớp đích đã đầy sĩ số. Bạn có thể hướng dẫn khách đăng ký danh sách chờ.' });
      }
      await conn.query(`UPDATE DangKyKhoaHoc SET LopHocID = ?, TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW() WHERE DangKyID = ?`, [targetId, staff.TaiKhoanID, r.DangKyID]);
      await conn.query(`UPDATE YeuCauDoiHuyLich SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`, [staff.TaiKhoanID, reason || null, requestId]);
      await createNotification(conn, r.KhachHangID, staff.TaiKhoanID, 'Yêu cầu đổi lớp được chấp nhận', `Bạn đã được chuyển sang lớp ${target[0].TenLop}.`);
      await promoteNextWaiter(conn, r.LopHocID, staff.TaiKhoanID);
    }

    await conn.commit();
    res.json({ success: true, message: 'Đã xử lý yêu cầu thành công.' });
  } catch (error) {
    await conn.rollback();
    console.error('[STAFF CLASS REQUEST ERROR]', error);
    res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu: ' + error.message });
  } finally {
    conn.release();
  }
}));

// =============================================================================
// 6. BÁN HÀNG TẠI QUẦY & HÓA ĐƠN
// =============================================================================
router.get('/products', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const [rows] = await db.query(
    `SELECT sp.SanPhamID AS id, sp.MaSanPham AS code, sp.TenSanPham AS name,
            sp.MoTa AS description, sp.Gia AS price, sp.SoLuongTon AS stock,
            dm.TenDanhMuc AS category
       FROM SanPham sp
       JOIN DanhMucSanPham dm ON dm.DanhMucID = sp.DanhMucID
      WHERE sp.TrangThai = 1 AND dm.TrangThai = 1
      ORDER BY sp.TenSanPham ASC`
  );
  res.json({ success: true, data: rows });
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;

  const memberCode = String(req.body.memberCode || '').trim().toUpperCase();
  const paymentMethod = Number(req.body.paymentMethod);
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (![1, 2, 3].includes(paymentMethod)) {
    return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ (1: tiền mặt, 2: chuyển khoản, 3: thẻ).' });
  }
  if (!items.length) {
    return res.status(400).json({ success: false, message: 'Giỏ hàng đang trống.' });
  }

  const normalized = new Map();
  for (const item of items) {
    const id = Number(item.productId), quantity = Number(item.quantity);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Sản phẩm hoặc số lượng không hợp lệ.' });
    }
    normalized.set(id, (normalized.get(id) || 0) + quantity);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let customerId = null;
    if (memberCode) {
      const [members] = await conn.query(`SELECT KhachHangID FROM KhachHang WHERE MaKhachHang = ?`, [memberCode]);
      if (!members.length) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: 'Không tìm thấy mã hội viên.' });
      }
      customerId = members[0].KhachHangID;
    }

    const productIds = [...normalized.keys()];
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await conn.query(
      `SELECT SanPhamID, MaSanPham, TenSanPham, Gia, SoLuongTon
         FROM SanPham WHERE SanPhamID IN (${placeholders}) AND TrangThai = 1 FOR UPDATE`,
      productIds
    );

    if (products.length !== productIds.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Có sản phẩm không tồn tại hoặc đã ngừng kinh doanh.' });
    }

    const byId = new Map(products.map(p => [Number(p.SanPhamID), p]));
    let total = 0;
    for (const [id, quantity] of normalized) {
      const p = byId.get(id);
      if (Number(p.SoLuongTon) < quantity) {
        await conn.rollback();
        return res.status(409).json({ success: false, message: `Sản phẩm "${p.TenSanPham}" chỉ còn ${p.SoLuongTon} trong kho.` });
      }
      total += Number(p.Gia) * quantity;
    }

    const [invoice] = await conn.query(
      `INSERT INTO HoaDon (KhachHangID, NguoiLapID, LoaiHoaDon, NgayLap, TongTien,
                           PhuongThucThanhToan, TrangThai, NgayThanhToan, NguoiXacNhanID, GhiChu)
       VALUES (?, ?, 3, NOW(), ?, ?, 2, NOW(), ?, 'Bán sản phẩm tại quầy')`,
      [customerId, staff.TaiKhoanID, total, paymentMethod, staff.TaiKhoanID]
    );
    const invoiceId = invoice.insertId;
    const invoiceCode = `HD${String(invoiceId).padStart(6, '0')}`;
    await conn.query(`UPDATE HoaDon SET MaHoaDon = ? WHERE HoaDonID = ?`, [invoiceCode, invoiceId]);

    for (const [id, quantity] of normalized) {
      const p = byId.get(id);
      await conn.query(
        `INSERT INTO ChiTietHoaDon (HoaDonID, SanPhamID, MoTa, SoLuong, DonGia)
         VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, id, p.TenSanPham, quantity, p.Gia]
      );
      await conn.query(`UPDATE SanPham SET SoLuongTon = SoLuongTon - ? WHERE SanPhamID = ?`, [quantity, id]);
    }

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Thanh toán tại quầy thành công.',
      data: { invoiceId, invoiceCode, total, paymentMethod }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[STAFF CHECKOUT ERROR]', error);
    res.status(500).json({ success: false, message: 'Không thể tạo hóa đơn bán hàng: ' + error.message });
  } finally {
    conn.release();
  }
}));

router.get('/invoices', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;

  const [rows] = await db.query(
    `SELECT h.HoaDonID AS id, h.MaHoaDon AS code, h.NgayLap AS createdAt,
            h.TongTien AS total, h.TrangThai AS status,
            h.PhuongThucThanhToan AS paymentMethod,
            COALESCE(tk.HoTen, 'Khách lẻ') AS customerName,
            COALESCE(GROUP_CONCAT(CONCAT(COALESCE(ct.MoTa, sp.TenSanPham, 'Sản phẩm'), ' x', ct.SoLuong) SEPARATOR ', '), '') AS description
       FROM HoaDon h
       LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = h.KhachHangID
       LEFT JOIN ChiTietHoaDon ct ON ct.HoaDonID = h.HoaDonID
       LEFT JOIN SanPham sp ON sp.SanPhamID = ct.SanPhamID
      WHERE h.LoaiHoaDon = 3 AND (? = '' OR h.MaHoaDon LIKE ? OR tk.HoTen LIKE ?)
      GROUP BY h.HoaDonID, h.MaHoaDon, h.NgayLap, h.TongTien, h.TrangThai,
               h.PhuongThucThanhToan, tk.HoTen
      ORDER BY h.NgayLap DESC`,
    [q, like, like]
  );
  res.json({ success: true, data: rows });
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const id = Number(req.params.id);

  const [headers] = await db.query(
    `SELECT h.HoaDonID AS id, h.MaHoaDon AS code, h.NgayLap AS createdAt,
            h.TongTien AS total, h.TrangThai AS status, h.PhuongThucThanhToan AS paymentMethod,
            COALESCE(tk.HoTen, 'Khách lẻ') AS customerName
       FROM HoaDon h
       LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = h.KhachHangID
      WHERE h.HoaDonID = ? AND h.LoaiHoaDon = 3`,
    [id]
  );
  if (!headers.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
  }

  const [items] = await db.query(
    `SELECT ct.SanPhamID AS productId, ct.MoTa AS description,
            ct.SoLuong AS quantity, ct.DonGia AS unitPrice, ct.ThanhTien AS lineTotal
       FROM ChiTietHoaDon ct
      WHERE ct.HoaDonID = ?`,
    [id]
  );
  res.json({ success: true, data: { ...headers[0], items } });
}));

router.post('/invoices/:id/pay', asyncHandler(async (req, res) => {
  const staff = await ensureStaff(req, res);
  if (!staff) return;
  const id = Number(req.params.id);
  const paymentMethod = Number(req.body.paymentMethod);

  if (![1, 2, 3].includes(paymentMethod)) {
    return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ.' });
  }

  const [result] = await db.query(
    `UPDATE HoaDon
        SET TrangThai = 2, PhuongThucThanhToan = ?,
            NgayThanhToan = NOW(), NguoiXacNhanID = ?
      WHERE HoaDonID = ? AND LoaiHoaDon = 3 AND TrangThai = 1`,
    [paymentMethod, staff.TaiKhoanID, id]
  );

  if (!result.affectedRows) {
    const [rows] = await db.query(`SELECT TrangThai FROM HoaDon WHERE HoaDonID = ? AND LoaiHoaDon = 3`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
    return res.status(409).json({
      success: false,
      message: Number(rows[0].TrangThai) === 2 ? 'Hóa đơn đã được thanh toán trước đó.' : 'Hóa đơn không ở trạng thái có thể thanh toán.'
    });
  }

  res.json({ success: true, message: 'Đã xác nhận thanh toán hóa đơn.' });
}));

// Global error handler
router.use((error, req, res, next) => {
  console.error('[STAFF ROUTE UNCAUGHT ERROR]', error);
  res.status(500).json({ success: false, message: 'Có lỗi xảy ra: ' + error.message });
});

module.exports = router;
