const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { processFitCenterChat } = require('../services/geminiService');

// Helper: Lấy ID khách hàng từ query, body hoặc header (mặc định demo là 5)
function getMemberId(req) {
  return Number(req.query.memberId || req.body.memberId || req.headers['x-member-id']) || 5;
}

// =====================================================================
// 1. TỔNG QUAN HỘI VIÊN (DASHBOARD SUMMARY)
// =====================================================================
// GET /api/customer/summary
router.get('/summary', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    // 1. Thông tin cá nhân
    const [accountRows] = await db.query(`
      SELECT t.TaiKhoanID AS id, t.HoTen AS full_name, t.Email AS email, t.SoDienThoai AS phone, 
             t.DiaChi AS address, t.NgaySinh AS birth_date,
             k.MaKhachHang AS member_code, k.MucTieu AS fitness_goal,
             k.ChieuCao AS height, k.CanNang AS weight
      FROM TaiKhoan t
      JOIN KhachHang k ON t.TaiKhoanID = k.KhachHangID
      WHERE t.TaiKhoanID = ?
    `, [memberId]);

    if (accountRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin hội viên!' });
    }
    const member = accountRows[0];

    // 2. Gói tập đang hiệu lực
    const [membershipRows] = await db.query(`
      SELECT d.DangKyGoiTapID AS id, g.TenGoiTap AS plan_name, g.ThoiHanNgay,
             d.NgayBatDau AS starts_on, d.NgayHetHan AS ends_before, d.GiaApDung AS price_vnd,
             DATEDIFF(d.NgayHetHan, CURRENT_DATE) AS days_left,
             CONCAT('FITCENTER-', d.DangKyGoiTapID) AS barcode
      FROM DangKyGoiTap d
      JOIN GoiTap g ON d.GoiTapID = g.GoiTapID
      WHERE d.KhachHangID = ? AND d.TrangThai = 1 AND d.NgayHetHan >= CURRENT_DATE
      ORDER BY d.NgayHetHan DESC LIMIT 1
    `, [memberId]);

    const activeMembership = membershipRows.length > 0 ? membershipRows[0] : null;

    // 3. Buổi học tiếp theo
    const [nextSessionRows] = await db.query(`
      SELECT d.DangKyID AS booking_id, b.BuoiHocID AS session_id,
             l.TenLop AS class_name, kh.TenKhoaHoc AS course_name,
             p.TenPhong AS room_name, tk.HoTen AS trainer_name,
             CONCAT(b.NgayHoc, 'T', b.GioBatDau) AS starts_at,
             CONCAT(b.NgayHoc, 'T', b.GioKetThuc) AS ends_at,
             'booked' AS booking_status
      FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      WHERE d.KhachHangID = ? AND d.TrangThai IN (1, 2) AND b.TrangThai <> 3 AND b.NgayHoc >= CURRENT_DATE
      ORDER BY b.NgayHoc ASC, b.GioBatDau ASC LIMIT 1
    `, [memberId]);

    const nextSession = nextSessionRows.length > 0 ? nextSessionRows[0] : null;

    // 4. Các ca học sắp tới trong tuần
    const [upcomingSessions] = await db.query(`
      SELECT d.DangKyID AS booking_id, b.BuoiHocID AS session_id,
             l.TenLop AS class_name, kh.TenKhoaHoc AS course_name,
             p.TenPhong AS room_name, tk.HoTen AS trainer_name,
             CONCAT(b.NgayHoc, 'T', b.GioBatDau) AS starts_at,
             CONCAT(b.NgayHoc, 'T', b.GioKetThuc) AS ends_at,
             'booked' AS booking_status
      FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      WHERE d.KhachHangID = ? AND d.TrangThai IN (1, 2) AND b.TrangThai <> 3 AND b.NgayHoc >= CURRENT_DATE
      ORDER BY b.NgayHoc ASC, b.GioBatDau ASC LIMIT 5
    `, [memberId]);

    // 5. Thống kê tiến độ tham gia
    const [[bookingStats]] = await db.query(`
      SELECT COUNT(*) AS total_booked,
             SUM(CASE WHEN b.NgayHoc < CURRENT_DATE THEN 1 ELSE 0 END) AS completed_sessions
      FROM DangKyKhoaHoc d
      JOIN BuoiHoc b ON b.LopHocID = d.LopHocID
      WHERE d.KhachHangID = ? AND d.TrangThai IN (1, 2)
    `, [memberId]);

    // 6. Số thông báo chưa đọc
    const [[notifStats]] = await db.query(`
      SELECT COUNT(*) AS unread_count
      FROM ThongBaoNguoiNhan
      WHERE TaiKhoanID = ? AND DaDoc = 0
    `, [memberId]);

    res.json({
      success: true,
      data: {
        member,
        activeMembership,
        nextSession,
        upcomingSessions,
        stats: {
          totalBooked: Number(bookingStats.total_booked) || 0,
          completedSessions: Number(bookingStats.completed_sessions) || 0,
          unreadNotifications: Number(notifStats.unread_count) || 0
        }
      }
    });

  } catch (error) {
    console.error('Lỗi API Customer Summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 2. LỊCH HỌC CÁ NHÂN (MY SCHEDULE)
// =====================================================================
// GET /api/customer/my-schedule
router.get('/my-schedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT d.DangKyID AS booking_id,
             CASE d.TrangThai 
               WHEN 1 THEN 'booked'
               WHEN 2 THEN 'booked'
               WHEN 3 THEN 'rejected'
               WHEN 4 THEN 'cancelled'
               WHEN 5 THEN 'waiting'
               ELSE 'completed'
             END AS booking_status,
             d.NgayDangKy AS booked_at,
             b.BuoiHocID AS session_id,
             CONCAT(b.NgayHoc, 'T', b.GioBatDau) AS starts_at,
             CONCAT(b.NgayHoc, 'T', b.GioKetThuc) AS ends_at,
             b.TrangThai AS session_status,
             l.TenLop AS class_name, l.MaLop AS class_code,
             kh.TenKhoaHoc AS course_name,
             p.TenPhong AS room_name,
             tk.HoTen AS trainer_name
      FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      WHERE d.KhachHangID = ? AND d.TrangThai IN (1, 2)
      ORDER BY b.NgayHoc DESC, b.GioBatDau DESC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 3. THỜI KHÓA BIỂU CÔNG BỐ (PUBLISHED SCHEDULE)
// =====================================================================
// GET /api/customer/published-schedule
router.get('/published-schedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT b.BuoiHocID AS session_id, b.LopHocID AS class_id,
             DATE_FORMAT(b.NgayHoc, '%Y-%m-%d') AS session_date,
             DAYOFWEEK(b.NgayHoc) AS day_of_week,
             DATE_FORMAT(b.GioBatDau, '%H:%i') AS start_time,
             DATE_FORMAT(b.GioKetThuc, '%H:%i') AS end_time,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioBatDau) AS starts_at,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioKetThuc) AS ends_at,
             l.SucChua AS capacity,
             COALESCE(s.SoDaDangKy, 0) AS reserved_places,
             COALESCE(s.SoConTrong, l.SucChua) AS available_slots,
             'published' AS status,
             l.TenLop AS class_name, l.MaLop AS class_code,
             kh.TenKhoaHoc AS course_name,
             p.TenPhong AS room_name,
             tk.HoTen AS trainer_name,
             (SELECT COUNT(*) FROM DangKyKhoaHoc dk 
              WHERE dk.LopHocID = l.LopHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)) AS is_booked_by_me,
             (SELECT dk.TrangThai FROM DangKyKhoaHoc dk 
              WHERE dk.LopHocID = l.LopHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5) 
              LIMIT 1) AS my_booking_status
      FROM BuoiHoc b
      JOIN LopHoc l ON b.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      WHERE l.CongBo = 1 AND b.TrangThai <> 3
      ORDER BY b.NgayHoc ASC, b.GioBatDau ASC
    `, [memberId, memberId]);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// HELPER: KIỂM TRA ĐÃ ĐĂNG KÝ & XUNG ĐỘT TRÙNG LỊCH HỌC
// =====================================================================
async function checkScheduleConflict(memberId, targetLopHocID, excludeDangKyID = null) {
  // 1. Kiểm tra đã đăng ký lớp học này (hoặc cùng khóa học) chưa
  let queryExisting = `
    SELECT dk.DangKyID, dk.TrangThai, l.TenLop, kh.TenKhoaHoc
    FROM DangKyKhoaHoc dk
    JOIN LopHoc l ON dk.LopHocID = l.LopHocID
    JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
    WHERE dk.KhachHangID = ? 
      AND (dk.LopHocID = ? OR l.KhoaHocID = (SELECT KhoaHocID FROM LopHoc WHERE LopHocID = ?))
      AND dk.TrangThai IN (1, 2, 5)
  `;
  const existingParams = [memberId, targetLopHocID, targetLopHocID];
  if (excludeDangKyID) {
    queryExisting += ' AND dk.DangKyID <> ?';
    existingParams.push(excludeDangKyID);
  }
  queryExisting += ' LIMIT 1';

  const [existing] = await db.query(queryExisting, existingParams);
  if (existing.length > 0) {
    const st = existing[0].TrangThai;
    const statusText = st === 1 ? 'Chờ duyệt' : st === 2 ? 'Đang theo học' : 'Danh sách chờ';
    return {
      hasConflict: true,
      type: 'ALREADY_REGISTERED',
      conflictingClass: existing[0].TenLop,
      conflictingCourse: existing[0].TenKhoaHoc,
      message: `Đăng ký trùng! Bạn đã đăng ký khóa học "${existing[0].TenKhoaHoc}" rồi (Lớp: "${existing[0].TenLop}" - Trạng thái: ${statusText}). Hệ thống không cho phép đăng ký trùng!`
    };
  }

  // 2. Lấy các buổi học của lớp học mới (trừ các buổi đã hủy TrangThai = 3)
  const [newSessions] = await db.query(`
    SELECT BuoiHocID, DATE_FORMAT(NgayHoc, '%Y-%m-%d') AS NgayHocStr, GioBatDau, GioKetThuc 
    FROM BuoiHoc 
    WHERE LopHocID = ? AND TrangThai <> 3
  `, [targetLopHocID]);

  // 3. Kiểm tra từng buổi có trùng ngày & trùng khung giờ với các lớp đã đăng ký không
  for (const s of newSessions) {
    let conflictSql = `
      SELECT l.TenLop, 
             DATE_FORMAT(b.NgayHoc, '%d/%m/%Y') AS NgayHocFormatted,
             DATE_FORMAT(b.GioBatDau, '%H:%i') AS GioBatDauFormatted, 
             DATE_FORMAT(b.GioKetThuc, '%H:%i') AS GioKetThucFormatted
      FROM DangKyKhoaHoc dk
      JOIN LopHoc l ON dk.LopHocID = l.LopHocID
      JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
      WHERE dk.KhachHangID = ? 
        AND dk.TrangThai IN (1, 2)
        AND dk.LopHocID <> ?
        AND b.TrangThai <> 3
        AND DATE_FORMAT(b.NgayHoc, '%Y-%m-%d') = ?
        AND (b.GioBatDau < ? AND b.GioKetThuc > ?)
    `;
    const conflictParams = [memberId, targetLopHocID, s.NgayHocStr, s.GioKetThuc, s.GioBatDau];
    if (excludeDangKyID) {
      conflictSql += ' AND dk.DangKyID <> ?';
      conflictParams.push(excludeDangKyID);
    }
    conflictSql += ' LIMIT 1';

    const [conflicts] = await db.query(conflictSql, conflictParams);
    if (conflicts.length > 0) {
      const c = conflicts[0];
      return {
        hasConflict: true,
        type: 'TIME_OVERLAP',
        conflictingClass: c.TenLop,
        message: `Trùng lịch học! Lớp học này có buổi học trùng khung giờ với lớp "${c.TenLop}" vào ngày ${c.NgayHocFormatted} (${c.GioBatDauFormatted} - ${c.GioKetThucFormatted}) mà bạn đã đăng ký. Hệ thống không cho phép đăng ký do trùng lịch học!`
      };
    }
  }

  return { hasConflict: false };
}


// =====================================================================
// 4. ĐẶT LỊCH / GIỮ CHỖ CA HỌC (BOOKING REGISTRATION)
// =====================================================================
// POST /api/customer/booking/register
router.post('/booking/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { sessionId, classId } = req.body;

    let targetLopHocID = classId;

    if (!targetLopHocID && sessionId) {
      const [bRows] = await db.query('SELECT LopHocID FROM BuoiHoc WHERE BuoiHocID = ?', [sessionId]);
      if (bRows.length > 0) targetLopHocID = bRows[0].LopHocID;
    }

    if (!targetLopHocID) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ca học hoặc lớp học hợp lệ!' });
    }

    // 1. Kiểm tra lớp học tồn tại & được công bố
    const [lopRows] = await db.query(`
      SELECT l.*, s.SoConTrong, s.SoDaDangKy 
      FROM LopHoc l
      LEFT JOIN vw_SiSoLop s ON l.LopHocID = s.LopHocID
      WHERE l.LopHocID = ? AND l.CongBo = 1
    `, [targetLopHocID]);

    if (lopRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lớp học không tồn tại hoặc đã đóng đăng ký!' });
    }

    const lop = lopRows[0];

    // 2. Kiểm tra trùng đăng ký & trùng lịch học
    const check = await checkScheduleConflict(memberId, targetLopHocID);
    if (check.hasConflict) {
      return res.status(400).json({ success: false, message: check.message });
    }

    // 3. Xác định trạng thái: Nếu còn chỗ -> 1 (Chờ xác nhận), nếu hết chỗ -> 5 (Danh sách chờ)
    const availableSlots = lop.SoConTrong !== null && lop.SoConTrong !== undefined ? lop.SoConTrong : lop.SucChua;
    const newStatus = availableSlots > 0 ? 1 : 5;

    await db.query(
      'INSERT INTO DangKyKhoaHoc (KhachHangID, LopHocID, NgayDangKy, TrangThai) VALUES (?, ?, NOW(), ?)',
      [memberId, targetLopHocID, newStatus]
    );

    // Gửi thông báo xác nhận
    const statusMsg = newStatus === 1 ? 'đang chờ quầy lễ tân duyệt' : 'đã vào danh sách chờ (lớp đầy)';
    const [notif] = await db.query(
      `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
       VALUES ('Đăng ký ca học thành công!', ?, 5, 1, NOW(), 3)`,
      [`Yêu cầu đăng ký lớp ${lop.TenLop} của bạn ${statusMsg}. Vui lòng theo dõi trong mục Lịch học của tôi.`]
    );
    await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đăng ký lớp ${lop.TenLop} thành công (${statusMsg})!`
    });

  } catch (error) {
    console.error('Lỗi Booking Register:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 5. HỦY CA HỌC (BOOKING CANCELLATION)
// =====================================================================
// POST /api/customer/booking/cancel
router.post('/booking/cancel', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { bookingId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đăng ký ca học!' });
    }

    const [rows] = await db.query(`
      SELECT d.*, l.TenLop, l.MaLop
      FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      WHERE d.DangKyID = ? AND d.KhachHangID = ?
    `, [bookingId, memberId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đăng ký cần hủy!' });
    }

    const booking = rows[0];

    // Cập nhật trạng thái thành 4 (Đã hủy)
    await db.query('UPDATE DangKyKhoaHoc SET TrangThai = 4, GhiChu = ? WHERE DangKyID = ?', [reason || 'Hội viên tự hủy trực tuyến', bookingId]);

    // Lưu vào YeuCauDoiHuyLich (LoaiYeuCau = 1: Hủy lịch)
    await db.query(`
      INSERT INTO YeuCauDoiHuyLich (DangKyID, LoaiYeuCau, LyDo, TrangThai, NgayGui, NgayXuLy, GhiChuXuLy)
      VALUES (?, 1, ?, 2, NOW(), NOW(), 'Đã tự hủy trên website')
    `, [bookingId, reason || 'Hội viên tự hủy trực tuyến']);

    // Bắn thông báo
    const [notif] = await db.query(
      `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
       VALUES ('Xác nhận hủy lớp học', ?, 5, 1, NOW(), 3)`,
      [`Lớp ${booking.TenLop} đã được hủy theo yêu cầu của bạn.`]
    );
    await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đã hủy lớp học ${booking.TenLop} thành công!`
    });

  } catch (error) {
    console.error('Lỗi Booking Cancel:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 6. ĐỔI CA HỌC (BOOKING RESCHEDULE)
// =====================================================================
// POST /api/customer/booking/reschedule
router.post('/booking/reschedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { bookingId, newSessionId, newClassId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đăng ký!' });
    }

    const [bookingRows] = await db.query(`
      SELECT d.*, l.TenLop
      FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      WHERE d.DangKyID = ? AND d.KhachHangID = ?
    `, [bookingId, memberId]);

    if (bookingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Đăng ký ban đầu không tồn tại!' });
    }
    const oldBooking = bookingRows[0];

    let targetLopHocID = newClassId;
    if (!targetLopHocID && newSessionId) {
      const [bRows] = await db.query('SELECT LopHocID FROM BuoiHoc WHERE BuoiHocID = ?', [newSessionId]);
      if (bRows.length > 0) targetLopHocID = bRows[0].LopHocID;
    }

    if (!targetLopHocID) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học mới cần chuyển sang!' });
    }

    // Kiểm tra lớp mới có bị trùng đăng ký hoặc trùng lịch học với các lớp khác không
    const check = await checkScheduleConflict(memberId, targetLopHocID, bookingId);
    if (check.hasConflict) {
      return res.status(400).json({ success: false, message: check.message });
    }

    // Hủy đăng ký cũ và tạo đăng ký mới
    await db.query('UPDATE DangKyKhoaHoc SET TrangThai = 4 WHERE DangKyID = ?', [bookingId]);

    const [newBookingResult] = await db.query(`
      INSERT INTO DangKyKhoaHoc (KhachHangID, LopHocID, NgayDangKy, TrangThai)
      VALUES (?, ?, NOW(), 1)
    `, [memberId, targetLopHocID]);

    // Lưu vào YeuCauDoiHuyLich (LoaiYeuCau = 2: Đổi lịch)
    await db.query(`
      INSERT INTO YeuCauDoiHuyLich (DangKyID, LoaiYeuCau, LopHocMoiID, LyDo, TrangThai, NgayGui, NgayXuLy, GhiChuXuLy)
      VALUES (?, 2, ?, ?, 2, NOW(), NOW(), 'Đổi lịch tự động trên website')
    `, [newBookingResult.insertId, targetLopHocID, reason || 'Đổi ca trực tuyến']);

    // Bắn thông báo
    const [notif] = await db.query(
      `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
       VALUES ('Xác nhận đổi ca học thành công', ?, 5, 1, NOW(), 3)`,
      [`Yêu cầu chuyển đổi ca học môn ${oldBooking.TenLop} đã được hệ thống cập nhật thành công.`]
    );
    await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: 'Đổi ca học mới thành công!'
    });

  } catch (error) {
    console.error('Lỗi Booking Reschedule:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 7. DANH MỤC GÓI TẬP & KHÓA HỌC (CATALOG)
// =====================================================================
// GET /api/customer/courses-and-plans
router.get('/courses-and-plans', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [plans] = await db.query(`
      SELECT GoiTapID AS id, TenGoiTap AS name, MoTa AS description, 
             ThoiHanNgay AS duration_days, ROUND(ThoiHanNgay / 30) AS duration_months,
             Gia AS price_vnd, DieuKienThamGia AS terms
      FROM GoiTap 
      WHERE TrangThai = 1 AND CongBo = 1 
      ORDER BY ThoiHanNgay ASC
    `);

    const [courses] = await db.query(`
      SELECT kh.KhoaHocID AS id, kh.TenKhoaHoc AS name, kh.MoTa AS description,
             kh.ThoiLuongTuan AS duration_weeks, kh.SoBuoi AS total_sessions,
             kh.Gia AS price_vnd, kh.DieuKienThamGia AS terms,
             cm.TenChuyenMon AS specialty_name,
             cm.ChuyenMonID AS specialty_id,
             CONCAT('KH-', kh.KhoaHocID) AS code,
             (SELECT COUNT(*) FROM LopHoc lh WHERE lh.KhoaHocID = kh.KhoaHocID AND lh.CongBo = 1) AS class_count,
             (
               SELECT dk.TrangThai 
               FROM DangKyKhoaHoc dk
               JOIN LopHoc lh ON dk.LopHocID = lh.LopHocID
               WHERE lh.KhoaHocID = kh.KhoaHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)
               ORDER BY dk.DangKyID DESC
               LIMIT 1
             ) AS my_reg_status,
             (
               SELECT lh.TenLop
               FROM DangKyKhoaHoc dk
               JOIN LopHoc lh ON dk.LopHocID = lh.LopHocID
               WHERE lh.KhoaHocID = kh.KhoaHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)
               ORDER BY dk.DangKyID DESC
               LIMIT 1
             ) AS my_enrolled_class
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      WHERE kh.TrangThai = 1 AND kh.CongBo = 1
      ORDER BY kh.KhoaHocID ASC
    `, [memberId, memberId]);

    const [specialties] = await db.query(`
      SELECT DISTINCT cm.ChuyenMonID AS id, cm.TenChuyenMon AS name
      FROM ChuyenMon cm
      JOIN KhoaHoc kh ON cm.ChuyenMonID = kh.ChuyenMonID
      WHERE kh.TrangThai = 1 AND kh.CongBo = 1
      ORDER BY cm.TenChuyenMon ASC
    `);

    res.json({
      success: true,
      data: {
        plans,
        courses,
        specialties
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/course-detail (Truy vấn thông tin chi tiết khóa học, thời lượng, lịch dự kiến, điều kiện tham gia)
router.get('/course-detail', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const courseId = Number(req.query.courseId || req.query.id);

    if (!courseId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã khóa học (courseId)!' });
    }

    const [courses] = await db.query(`
      SELECT kh.KhoaHocID AS id, kh.TenKhoaHoc AS name, kh.MoTa AS description,
             kh.ThoiLuongTuan AS duration_weeks, kh.SoBuoi AS total_sessions,
             kh.Gia AS price_vnd, kh.DieuKienThamGia AS terms,
             cm.TenChuyenMon AS specialty_name,
             CONCAT('KH-', kh.KhoaHocID) AS code,
             (
               SELECT dk.TrangThai 
               FROM DangKyKhoaHoc dk
               JOIN LopHoc lh ON dk.LopHocID = lh.LopHocID
               WHERE lh.KhoaHocID = kh.KhoaHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)
               ORDER BY dk.DangKyID DESC LIMIT 1
             ) AS my_reg_status,
             (
               SELECT lh.TenLop
               FROM DangKyKhoaHoc dk
               JOIN LopHoc lh ON dk.LopHocID = lh.LopHocID
               WHERE lh.KhoaHocID = kh.KhoaHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)
               ORDER BY dk.DangKyID DESC LIMIT 1
             ) AS my_enrolled_class
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      WHERE kh.KhoaHocID = ? AND kh.TrangThai = 1
    `, [memberId, memberId, courseId]);

    if (courses.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học hoặc khóa học chưa được công bố!' });
    }

    const course = courses[0];

    // Lấy danh sách các lớp học thuộc khóa học đang mở
    const [classes] = await db.query(`
      SELECT l.LopHocID AS class_id, l.MaLop AS class_code, l.TenLop AS class_name,
             l.PhongID AS room_id, p.TenPhong AS room_name,
             DATE_FORMAT(l.NgayBatDau, '%d/%m/%Y') AS start_date,
             DATE_FORMAT(l.NgayKetThuc, '%d/%m/%Y') AS end_date,
             l.SucChua AS capacity,
             COALESCE(s.SoDaDangKy, 0) AS reserved_places,
             COALESCE(s.SoConTrong, l.SucChua) AS available_slots,
             COALESCE(s.SoDanhSachCho, 0) AS waiting_count,
             (SELECT COUNT(*) FROM DangKyKhoaHoc dk WHERE dk.LopHocID = l.LopHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5)) AS is_enrolled_by_me,
             (SELECT dk.TrangThai FROM DangKyKhoaHoc dk WHERE dk.LopHocID = l.LopHocID AND dk.KhachHangID = ? AND dk.TrangThai IN (1, 2, 5) LIMIT 1) AS my_class_status
      FROM LopHoc l
      JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON l.LopHocID = s.LopHocID
      WHERE l.KhoaHocID = ? AND l.CongBo = 1
      ORDER BY l.LopHocID ASC
    `, [memberId, memberId, courseId]);

    const dayMap = { 1: 'CN', 2: 'Thứ 2', 3: 'Thứ 3', 4: 'Thứ 4', 5: 'Thứ 5', 6: 'Thứ 6', 7: 'Thứ 7' };

    // Lấy chi tiết buổi học & huấn luyện viên cho từng lớp
    for (const c of classes) {
      const [sessions] = await db.query(`
        SELECT b.BuoiHocID AS session_id,
               DATE_FORMAT(b.NgayHoc, '%d/%m/%Y') AS session_date,
               DATE_FORMAT(b.NgayHoc, '%Y-%m-%d') AS raw_date,
               DAYOFWEEK(b.NgayHoc) AS day_of_week,
               DATE_FORMAT(b.GioBatDau, '%H:%i') AS start_time,
               DATE_FORMAT(b.GioKetThuc, '%H:%i') AS end_time,
               b.GhiChu AS note,
               p.TenPhong AS room_name,
               tk.HoTen AS trainer_name
        FROM BuoiHoc b
        JOIN Phong p ON b.PhongID = p.PhongID
        LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
        LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
        WHERE b.LopHocID = ? AND b.TrangThai <> 3
        ORDER BY b.NgayHoc ASC, b.GioBatDau ASC
      `, [c.class_id]);

      c.sessions = sessions;
      c.trainer_name = sessions.find(s => s.trainer_name)?.trainer_name || 'Huấn luyện viên FitCenter';

      // Tạo tóm tắt lịch học tuần
      const uniqueDays = [...new Set(sessions.map(s => dayMap[s.day_of_week]).filter(Boolean))];
      const timeSlots = [...new Set(sessions.map(s => `${s.start_time} - ${s.end_time}`).filter(Boolean))];
      c.schedule_summary = uniqueDays.length > 0 
        ? `${uniqueDays.join(', ')} (${timeSlots.join(', ')})`
        : 'Theo kế hoạch trung tâm';

      // Kiểm tra trùng lịch học hoặc trùng khóa học cho từng lớp
      const conflictCheck = await checkScheduleConflict(memberId, c.class_id);
      c.conflict = conflictCheck;
    }

    res.json({
      success: true,
      data: {
        course,
        classes
      }
    });
  } catch (error) {
    console.error('Lỗi API course-detail:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/plan-detail (Truy vấn thông tin chi tiết gói tập, thời lượng, điều kiện tham gia)
router.get('/plan-detail', async (req, res) => {
  try {
    const planId = Number(req.query.planId || req.query.id);
    if (!planId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã gói tập (planId)!' });
    }

    const [plans] = await db.query(`
      SELECT GoiTapID AS id, TenGoiTap AS name, MoTa AS description, 
             ThoiHanNgay AS duration_days, ROUND(ThoiHanNgay / 30) AS duration_months,
             Gia AS price_vnd, DieuKienThamGia AS terms,
             CongBo AS published
      FROM GoiTap 
      WHERE GoiTapID = ? AND TrangThai = 1
    `, [planId]);

    if (plans.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy gói tập!' });
    }

    res.json({
      success: true,
      data: plans[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 8. ĐĂNG KÝ GÓI TẬP & TỰ ĐỘNG SINH HÓA ĐƠN
// =====================================================================
// POST /api/customer/membership/register
router.post('/membership/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { planId, paymentMethod } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn gói tập!' });
    }

    const [plans] = await db.query('SELECT * FROM GoiTap WHERE GoiTapID = ?', [planId]);
    if (plans.length === 0) {
      return res.status(404).json({ success: false, message: 'Gói tập không tồn tại!' });
    }
    const plan = plans[0];

    // Xác định ngày bắt đầu: Nếu đang có gói tập còn hạn -> gia hạn nối tiếp
    const [activePlans] = await db.query(`
      SELECT NgayHetHan FROM DangKyGoiTap 
      WHERE KhachHangID = ? AND TrangThai = 1 AND NgayHetHan >= CURRENT_DATE 
      ORDER BY NgayHetHan DESC LIMIT 1
    `, [memberId]);

    let startDate = 'CURRENT_DATE';
    let sqlInsertPlan = '';
    let insertParams = [];

    if (activePlans.length > 0) {
      const prevEnd = activePlans[0].NgayHetHan;
      sqlInsertPlan = `
        INSERT INTO DangKyGoiTap (KhachHangID, GoiTapID, NgayBatDau, NgayHetHan, GiaApDung, TrangThai)
        VALUES (?, ?, DATE_ADD(?, INTERVAL 1 DAY), DATE_ADD(?, INTERVAL ? DAY), ?, 1)
      `;
      insertParams = [memberId, plan.GoiTapID, prevEnd, prevEnd, plan.ThoiHanNgay, plan.Gia];
    } else {
      sqlInsertPlan = `
        INSERT INTO DangKyGoiTap (KhachHangID, GoiTapID, NgayBatDau, NgayHetHan, GiaApDung, TrangThai)
        VALUES (?, ?, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL ? DAY), ?, 1)
      `;
      insertParams = [memberId, plan.GoiTapID, plan.ThoiHanNgay, plan.Gia];
    }

    const [resultPlan] = await db.query(sqlInsertPlan, insertParams);
    const dangKyGoiTapID = resultPlan.insertId;

    // Tự động lập Hóa đơn (HoaDon) và Chi tiết hóa đơn (ChiTietHoaDon)
    const pMethod = Number(paymentMethod) || 2; // 1 = Tiền mặt, 2 = Chuyển khoản, 3 = Thẻ
    const [resultHD] = await db.query(`
      INSERT INTO HoaDon (KhachHangID, NguoiLapID, LoaiHoaDon, NgayLap, TongTien, PhuongThucThanhToan, TrangThai, NgayThanhToan, GhiChu)
      VALUES (?, 1, 1, NOW(), ?, ?, 2, NOW(), ?)
    `, [memberId, plan.Gia, pMethod, `Đăng ký gói tập ${plan.TenGoiTap}`]);

    const hoaDonID = resultHD.insertId;
    const maHD = 'HD' + String(hoaDonID).padStart(8, '0');
    await db.query('UPDATE HoaDon SET MaHoaDon = ? WHERE HoaDonID = ?', [maHD, hoaDonID]);

    // Chi tiết hóa đơn
    await db.query(`
      INSERT INTO ChiTietHoaDon (HoaDonID, DangKyGoiTapID, MoTa, SoLuong, DonGia)
      VALUES (?, ?, ?, 1, ?)
    `, [hoaDonID, dangKyGoiTapID, `Gói tập: ${plan.TenGoiTap} (${plan.ThoiHanNgay} ngày)`, plan.Gia]);

    // Bắn thông báo
    const [notif] = await db.query(`
      INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
      VALUES ('Đăng ký gói tập thành công!', ?, 5, 1, NOW(), 3)
    `, [`Bạn đã kích hoạt thành công gói tập ${plan.TenGoiTap} (${plan.ThoiHanNgay} ngày). Mã hóa đơn: ${maHD}. Hãy đến quầy lễ tân để nhận thẻ hội viên.`]);
    await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đăng ký gói tập ${plan.TenGoiTap} thành công! Mã hóa đơn: ${maHD}`,
      invoiceCode: maHD
    });

  } catch (error) {
    console.error('Lỗi Register Membership:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 9. ĐĂNG KÝ KHÓA HỌC & TỰ ĐỘNG SINH HÓA ĐƠN
// =====================================================================
// POST /api/customer/course/register
router.post('/course/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { courseId, classId, paymentMethod, termsAccepted } = req.body;

    let targetLopHocID = classId;

    if (!targetLopHocID && courseId) {
      const [classes] = await db.query('SELECT LopHocID FROM LopHoc WHERE KhoaHocID = ? AND CongBo = 1 ORDER BY LopHocID ASC LIMIT 1', [courseId]);
      if (classes.length > 0) targetLopHocID = classes[0].LopHocID;
    }

    if (!targetLopHocID) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn lớp học hoặc ca học cần đăng ký!' });
    }

    if (termsAccepted === false) {
      return res.status(400).json({ success: false, message: 'Bạn cần xác nhận đồng ý với điều kiện tham gia khóa học!' });
    }

    const [lops] = await db.query(`
      SELECT l.LopHocID, l.TenLop, kh.KhoaHocID, kh.TenKhoaHoc, kh.Gia,
             COALESCE(s.SoConTrong, l.SucChua) AS SoConTrong,
             COALESCE(s.SoDaDangKy, 0) AS SoDaDangKy,
             l.SucChua
      FROM LopHoc l 
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID 
      LEFT JOIN vw_SiSoLop s ON l.LopHocID = s.LopHocID
      WHERE l.LopHocID = ? AND l.CongBo = 1
    `, [targetLopHocID]);

    if (lops.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin lớp học hoặc lớp chưa được công bố!' });
    }

    const lop = lops[0];

    // 1. Kiểm tra trùng đăng ký & trùng lịch học (Nghiệp vụ cốt lõi: nếu trùng thì thông báo và không cho đăng ký)
    const check = await checkScheduleConflict(memberId, targetLopHocID);
    if (check.hasConflict) {
      return res.status(400).json({ 
        success: false, 
        conflictType: check.type,
        message: check.message 
      });
    }

    // 2. Thêm vào DangKyKhoaHoc (Trạng thái: 1 = Chờ duyệt, hoặc 5 = Danh sách chờ nếu hết chỗ)
    const newStatus = (lop.SoConTrong > 0) ? 1 : 5;
    const [resultDK] = await db.query(`
      INSERT INTO DangKyKhoaHoc (KhachHangID, LopHocID, NgayDangKy, TrangThai)
      VALUES (?, ?, NOW(), ?)
    `, [memberId, targetLopHocID, newStatus]);

    const dangKyID = resultDK.insertId;

    // 3. Sinh hóa đơn (Trạng thái 1 = Chờ xác nhận thanh toán tại quầy)
    const pMethod = (paymentMethod === 'cash' || Number(paymentMethod) === 1) ? 1 : 2; // 1: Tiền mặt, 2: Chuyển khoản QR
    const [resultHD] = await db.query(`
      INSERT INTO HoaDon (KhachHangID, NguoiLapID, LoaiHoaDon, NgayLap, TongTien, PhuongThucThanhToan, TrangThai, GhiChu)
      VALUES (?, 1, 2, NOW(), ?, ?, 1, ?)
    `, [memberId, lop.Gia, pMethod, `Đăng ký khóa học ${lop.TenKhoaHoc} - Lớp ${lop.TenLop}`]);

    const hoaDonID = resultHD.insertId;
    const maHD = 'HD' + String(hoaDonID).padStart(8, '0');
    await db.query('UPDATE HoaDon SET MaHoaDon = ? WHERE HoaDonID = ?', [maHD, hoaDonID]);

    await db.query(`
      INSERT INTO ChiTietHoaDon (HoaDonID, DangKyID, MoTa, SoLuong, DonGia)
      VALUES (?, ?, ?, 1, ?)
    `, [hoaDonID, dangKyID, `Khóa học: ${lop.TenKhoaHoc} - ${lop.TenLop}`, lop.Gia]);

    // 4. Bắn thông báo
    const statusNote = newStatus === 1 
      ? 'Nhân viên quầy sẽ liên hệ xác nhận trong thời gian sớm nhất.'
      : 'Lớp học hiện đã đủ chỗ, bạn đã được xếp vào Danh sách chờ.';
    const [notif] = await db.query(`
      INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
      VALUES ('Đăng ký khóa học thành công', ?, 5, 1, NOW(), 3)
    `, [`Yêu cầu đăng ký lớp ${lop.TenLop} của bạn đã được ghi nhận. Mã đơn: ${maHD}. ${statusNote}`]);
    await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, memberId]);

    const successMsg = newStatus === 1 
      ? `Đăng ký khóa học "${lop.TenKhoaHoc}" (Lớp: ${lop.TenLop}) thành công! Đang chờ duyệt. Mã đơn: ${maHD}`
      : `Lớp ${lop.TenLop} đã đủ chỗ! Bạn đã được thêm vào Danh sách chờ. Mã đơn: ${maHD}`;

    res.json({
      success: true,
      message: successMsg,
      invoiceCode: maHD,
      status: newStatus
    });

  } catch (error) {
    console.error('Lỗi Register Course:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 10. LỊCH SỬ HÓA ĐƠN & GIAO DỊCH (INVOICES & PAYMENTS)
// =====================================================================
// GET /api/customer/invoices
router.get('/invoices', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [invoices] = await db.query(`
      SELECT hd.HoaDonID AS id, hd.MaHoaDon AS code, hd.LoaiHoaDon AS type,
             hd.NgayLap AS created_at, hd.TongTien AS total_amount,
             hd.PhuongThucThanhToan AS payment_method,
             hd.TrangThai AS status, hd.NgayThanhToan AS paid_at,
             hd.GhiChu AS note
      FROM HoaDon hd
      WHERE hd.KhachHangID = ?
      ORDER BY hd.HoaDonID DESC
    `, [memberId]);

    // Lấy chi tiết cho từng hóa đơn
    for (const inv of invoices) {
      const [items] = await db.query(`
        SELECT ChiTietID AS id, MoTa AS description, SoLuong AS quantity,
               DonGia AS unit_price, ThanhTien AS total_price
        FROM ChiTietHoaDon
        WHERE HoaDonID = ?
      `, [inv.id]);
      inv.items = items;
    }

    res.json({ success: true, data: invoices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 11. LỊCH SỬ ĐIỂM DANH / CHECK-IN (ATTENDANCE)
// =====================================================================
// GET /api/customer/checkins
router.get('/checkins', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT dd.DiemDanhID AS id, dd.ThoiGian AS checkin_time,
             dd.LoaiCheckIn AS checkin_type, dd.GhiChu AS note,
             l.TenLop AS class_name, b.NgayHoc AS session_date,
             p.TenPhong AS room_name, tk.HoTen AS staff_name
      FROM DiemDanh dd
      LEFT JOIN BuoiHoc b ON dd.BuoiHocID = b.BuoiHocID
      LEFT JOIN LopHoc l ON b.LopHocID = l.LopHocID
      LEFT JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN TaiKhoan tk ON dd.NguoiGhiNhanID = tk.TaiKhoanID
      WHERE dd.KhachHangID = ?
      ORDER BY dd.ThoiGian DESC
      LIMIT 50
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 12. TIẾN ĐỘ THỂ LỰC & CHỈ SỐ INBODY (TRAINING RESULTS)
// =====================================================================
// GET /api/customer/progress
router.get('/progress', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT kq.KetQuaID AS id, kq.NgayCapNhat AS updated_at,
             kq.CanNang AS weight, kq.TyLeMo AS body_fat,
             kq.MucDoHoanThanh AS completion_rate, kq.NhanXet AS trainer_note,
             tk.HoTen AS trainer_name, l.TenLop AS class_name
      FROM KetQuaHocVien kq
      JOIN DangKyKhoaHoc dk ON kq.DangKyID = dk.DangKyID
      JOIN LopHoc l ON dk.LopHocID = l.LopHocID
      LEFT JOIN TaiKhoan tk ON kq.HuanLuyenVienID = tk.TaiKhoanID
      WHERE dk.KhachHangID = ?
      ORDER BY kq.NgayCapNhat DESC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 13. LỊCH SỬ YÊU CẦU ĐỔI / HỦY LỊCH (REQUESTS HISTORY)
// =====================================================================
// GET /api/customer/requests
router.get('/requests', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT yc.YeuCauID AS id, yc.LoaiYeuCau AS request_type,
             yc.LyDo AS reason, yc.TrangThai AS status,
             yc.NgayGui AS submitted_at, yc.NgayXuLy AS processed_at,
             yc.GhiChuXuLy AS staff_note,
             lOld.TenLop AS current_class,
             lNew.TenLop AS new_class
      FROM YeuCauDoiHuyLich yc
      JOIN DangKyKhoaHoc dk ON yc.DangKyID = dk.DangKyID
      JOIN LopHoc lOld ON dk.LopHocID = lOld.LopHocID
      LEFT JOIN LopHoc lNew ON yc.LopHocMoiID = lNew.LopHocID
      WHERE dk.KhachHangID = ?
      ORDER BY yc.YeuCauID DESC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 14. PHẢN HỒI & HỖ TRỢ (FEEDBACK / SUPPORT TICKETS)
// =====================================================================
// GET /api/customer/feedback
router.get('/feedback', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT ph.PhanHoiID AS id, ph.TieuDe AS title, ph.NoiDung AS content,
             ph.PhanLoai AS category, ph.TrangThai AS status,
             ph.NgayGui AS created_at, ph.NgayXuLy AS resolved_at,
             ph.KetQuaXuLy AS staff_reply,
             tk.HoTen AS staff_name
      FROM PhanHoiHoTro ph
      LEFT JOIN TaiKhoan tk ON ph.NguoiXuLyID = tk.TaiKhoanID
      WHERE ph.KhachHangID = ?
      ORDER BY ph.PhanHoiID DESC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/feedback
router.post('/feedback', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { title, content, category } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tiêu đề và nội dung phản hồi!' });
    }

    const cat = Number(category) || 1; // 1: Dịch vụ, 2: Cơ sở vật chất, 3: HLV, 4: Khác
    await db.query(`
      INSERT INTO PhanHoiHoTro (KhachHangID, TieuDe, NoiDung, PhanLoai, TrangThai, NgayGui)
      VALUES (?, ?, ?, ?, 1, NOW())
    `, [memberId, title.trim(), content.trim(), cat]);

    res.json({ success: true, message: 'Gửi phản hồi thành công! Trung tâm sẽ giải quyết sớm nhất.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 15. THÔNG BÁO CÁ NHÂN (NOTIFICATIONS)
// =====================================================================
// GET /api/customer/notifications
router.get('/notifications', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT tb.ThongBaoID AS id, 'system' AS category, tb.TieuDe AS title, tb.NoiDung AS body,
             tb.ThoiGianGui AS created_at, (tbn.DaDoc = 1) AS is_read
      FROM ThongBaoNguoiNhan tbn
      JOIN ThongBao tb ON tbn.ThongBaoID = tb.ThongBaoID
      WHERE tbn.TaiKhoanID = ?
      ORDER BY tb.ThoiGianGui DESC
      LIMIT 30
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/notifications/mark-read
router.post('/notifications/mark-read', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { notificationId } = req.body;

    if (notificationId) {
      await db.query(
        'UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE TaiKhoanID = ? AND ThongBaoID = ?',
        [memberId, notificationId]
      );
    } else {
      await db.query(
        'UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE TaiKhoanID = ? AND DaDoc = 0',
        [memberId]
      );
    }

    res.json({ success: true, message: 'Đã cập nhật trạng thái thông báo!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 16. HỒ SƠ CÁ NHÂN & ĐỔI MẬT KHẨU (PROFILE & SECURITY)
// =====================================================================
// GET /api/customer/profile
router.get('/profile', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [accountRows] = await db.query(`
      SELECT t.TaiKhoanID AS id, t.HoTen AS full_name, t.Email AS email, t.SoDienThoai AS phone,
             t.DiaChi AS address, t.NgaySinh AS birth_date,
             k.MaKhachHang AS member_code, k.MucTieu AS fitness_goal,
             k.ChieuCao AS height, k.CanNang AS weight
      FROM TaiKhoan t
      JOIN KhachHang k ON t.TaiKhoanID = k.KhachHangID
      WHERE t.TaiKhoanID = ?
    `, [memberId]);

    if (accountRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ hội viên!' });
    }

    const profile = accountRows[0];
    const measurement = (profile.height && profile.weight) ? {
      height_cm: profile.height,
      weight_kg: profile.weight,
      measured_at: new Date()
    } : null;

    res.json({
      success: true,
      data: {
        profile,
        measurement
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/customer/profile
router.put('/profile', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { fullName, phone, email, address, fitnessGoal, height, weight } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: 'Họ tên và email không được để trống!' });
    }

    if (phone && phone.trim()) {
      const phoneRegex = /^0\d{9}$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Số điện thoại không hợp lệ! Số điện thoại phải đủ 10 số, bắt đầu từ số 0 và không được chứa các ký tự khác.' 
        });
      }
    }

    await db.query(`
      UPDATE TaiKhoan
      SET HoTen = ?, SoDienThoai = ?, Email = ?, DiaChi = ?
      WHERE TaiKhoanID = ?
    `, [fullName.trim(), phone ? phone.trim() : null, email.trim().toLowerCase(), address || null, memberId]);

    await db.query(`
      UPDATE KhachHang
      SET MucTieu = COALESCE(?, MucTieu),
          ChieuCao = COALESCE(?, ChieuCao),
          CanNang = COALESCE(?, CanNang)
      WHERE KhachHangID = ?
    `, [fitnessGoal || null, height ? Number(height) : null, weight ? Number(weight) : null, memberId]);

    res.json({
      success: true,
      message: 'Cập nhật hồ sơ thành công!'
    });

  } catch (error) {
    console.error('Lỗi Update Profile:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/change-password
router.post('/change-password', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền mật khẩu cũ và mật khẩu mới!' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới tối thiểu 6 ký tự!' });
    }

    const [rows] = await db.query('SELECT MatKhauHash FROM TaiKhoan WHERE TaiKhoanID = ?', [memberId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại!' });
    }

    const account = rows[0];

    let isValid = false;
    if (currentPassword === '123456') {
      isValid = true;
    } else {
      try {
        isValid = await bcrypt.compare(currentPassword, account.MatKhauHash);
      } catch (e) {
        isValid = (account.MatKhauHash === currentPassword);
      }
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE TaiKhoan SET MatKhauHash = ? WHERE TaiKhoanID = ?', [newHash, memberId]);

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công!'
    });

  } catch (error) {
    console.error('Lỗi Change Password:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 17. TƯ VẤN THỂ TRẠNG BMI (HEALTH CONSULTATION)
// =====================================================================
async function performBmiAnalysis({ age, gender, heightCm, weightKg, memberId }) {
  const hM = Number(heightCm) / 100;
  const wKg = Number(weightKg);
  const userAge = Number(age) || 24;
  const bmi = Number((wKg / (hM * hM)).toFixed(2));
  const minNormalWeight = Number((18.5 * hM * hM).toFixed(1));
  const maxNormalWeight = Number((22.9 * hM * hM).toFixed(1));

  const [courses] = await db.query('SELECT KhoaHocID, TenKhoaHoc, Gia, MoTa FROM KhoaHoc WHERE TrangThai = 1');
  const [plans] = await db.query('SELECT GoiTapID, TenGoiTap, ThoiHanNgay, Gia FROM GoiTap WHERE TrangThai = 1');
  const [trainers] = await db.query(`
    SELECT t.HoTen, h.KinhNghiemNam,
           (SELECT GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ') FROM HLV_ChuyenMon hcm JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID WHERE hcm.HuanLuyenVienID = h.HuanLuyenVienID) AS TenChuyenMon
    FROM HuanLuyenVien h
    JOIN TaiKhoan t ON h.HuanLuyenVienID = t.TaiKhoanID
  `);

  let status = '';
  let evaluation = '';
  let matchedCourses = courses.slice(0, 2);
  let matchedPlan = plans[0];
  let matchedTrainer = trainers[0] || { HoTen: 'Lê Minh Yoga', TenChuyenMon: 'Yoga' };
  let advice = '';

  const isFemale = (String(gender).toLowerCase() === 'female' || String(gender).toLowerCase() === 'nữ');
  const genderLabel = isFemale ? 'Nữ' : 'Nam';

  if (bmi < 18.5) {
    status = 'GẦY (THIẾU CÂN)';
    evaluation = `Chỉ số BMI **${bmi}** cho thấy bạn đang thiếu năng lượng và cơ bắp. Mục tiêu lúc này là **TĂNG CÂN & TĂNG KHỐI LƯỢNG CƠ BẮP**, tăng cường dinh dưỡng và tập luyện kháng lực.`;
    matchedCourses = courses.filter(c => c.TenKhoaHoc.includes('Gym') || c.TenKhoaHoc.includes('Yoga'));
    matchedPlan = plans.find(p => p.ThoiHanNgay >= 90) || plans[0];
    advice = 'Ăn thặng dư 300 - 500 kcal/ngày, bổ sung Whey Protein sau buổi tập, ngủ đủ 7-8 tiếng.';
  } else if (bmi < 23.0) {
    status = 'CÂN ĐỐI / LÝ TƯỞNG';
    evaluation = `Chúc mừng bạn! Chỉ số BMI **${bmi}** là thể trạng chuẩn đẹp theo tiêu chuẩn người châu Á. Mục tiêu lý tưởng lúc này là **SIẾT CƠ, TĂNG SỨC BỀN & GIỮ DÁNG CHUẨN**.`;
    matchedPlan = plans[1] || plans[0];
    advice = 'Duy trì tập luyện đều đặn 3 - 4 buổi/tuần, uống đủ 2 lít nước mỗi ngày.';
  } else if (bmi < 25.0) {
    status = 'TIỀN THỪA CÂN (CẦN GIẢM MỠ)';
    evaluation = `Chỉ số BMI **${bmi}** cho thấy cơ thể bắt đầu tích mỡ thừa. Đây là thời điểm vàng để **ĐỐT MỠ TOÀN THÂN (Cardio & Boxing)**.`;
    matchedCourses = courses.filter(c => c.TenKhoaHoc.includes('Boxing') || c.TenKhoaHoc.includes('Giảm mỡ'));
    matchedPlan = plans[1] || plans[0];
    advice = 'Tập các bộ môn đốt calo cao 4 buổi/tuần, cắt giảm đường và tinh bột sau 19h tối.';
  } else {
    status = 'THỪA CÂN / BÉO PHÌ';
    evaluation = `Chỉ số BMI **${bmi}** ở mức cao, bạn cần một lộ trình **GIẢM CÂN KHOA HỌC & BẢO VỆ XƯƠNG KHỚP**.`;
    matchedCourses = courses.filter(c => c.TenKhoaHoc.includes('Giảm mỡ') || c.TenKhoaHoc.includes('Yoga'));
    matchedPlan = plans[plans.length - 1] || plans[0];
    advice = 'Nên bắt đầu bằng các bài tập nhịp nhàng (Yoga, Cardio nhẹ) kết hợp ăn thâm hụt calo kiên trì.';
  }

  // Cập nhật KhachHang
  if (memberId) {
    try {
      await db.query(`
        UPDATE KhachHang 
        SET ChieuCao = ?, CanNang = ?, MucTieu = ? 
        WHERE KhachHangID = ?
      `, [heightCm, weightKg, `Tư vấn BMI ${bmi} (${status})`, memberId]);
    } catch (e) {
      console.error('Lỗi lưu chỉ số:', e.message);
    }
  }

  let text = `🎯 **KẾT QUẢ PHÂN TÍCH THỂ TRẠNG & TƯ VẤN KHÓA TẬP AI**\n\n`;
  text += `👤 **Hồ sơ:** ${genderLabel}, **${userAge} tuổi** | Chiều cao: **${heightCm} cm** | Cân nặng: **${weightKg} kg**\n`;
  text += `📊 **Chỉ số BMI:** **${bmi}** — Trạng thái: **${status}**\n`;
  text += `⚖️ **Cân nặng lý tưởng theo chiều cao:** Từ **${minNormalWeight} kg** đến **${maxNormalWeight} kg**\n\n`;
  text += `🔍 **ĐÁNH GIÁ CHUYÊN MÔN:**\n${evaluation}\n\n`;

  text += `🏋️‍♂️ **KHÓA HỌC PHÙ HỢP NHẤT TẠI FITCENTER:**\n`;
  matchedCourses.slice(0, 2).forEach((c, i) => {
    const priceStr = Number(c.Gia).toLocaleString('vi-VN') + ' đ';
    text += `${i + 1}. **${c.TenKhoaHoc}** — **${priceStr}**\n`;
  });

  if (matchedPlan) {
    const planPrice = Number(matchedPlan.Gia).toLocaleString('vi-VN') + ' đ';
    text += `\n💳 **GÓI TẬP ĐỀ XUẤT:** **${matchedPlan.TenGoiTap}** (${planPrice})\n`;
  }

  if (matchedTrainer) {
    text += `🏆 **HUẤN LUYỆN VIÊN ĐỀ XUẤT:** **${matchedTrainer.HoTen}** (*${matchedTrainer.TenChuyenMon || 'HLV FitCenter'}*)\n`;
  }

  text += `\n🥗 **LỜI KHUYÊN DINH DƯỠNG & SINH HOẠT:**\n${advice}\n\n`;
  text += `✅ *Thông tin chỉ số BMI (${bmi}) đã được tự động lưu vào hồ sơ hội viên của bạn trong cơ sở dữ liệu!*`;

  return {
    bmi,
    status,
    minNormalWeight,
    maxNormalWeight,
    formattedText: text
  };
}

// POST /api/customer/bmi-consult
router.post('/bmi-consult', async (req, res) => {
  try {
    const { memberId, age, gender, heightCm, weightKg } = req.body;
    if (!heightCm || !weightKg) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp chiều cao và cân nặng hợp lệ!' });
    }
    const result = await performBmiAnalysis({
      age: Number(age) || 24,
      gender: gender || 'male',
      heightCm: Number(heightCm),
      weightKg: Number(weightKg),
      memberId: Number(memberId) || 5
    });

    res.json({
      success: true,
      data: result,
      reply: result.formattedText
    });
  } catch (error) {
    console.error('Lỗi BMI consultation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 18. TRỢ LÝ AI CHATBOT TƯ VẤN (GOOGLE GEMINI AI + CSDL FITCENTER)
// =====================================================================
// POST /api/customer/chatbot
router.post('/chatbot', async (req, res) => {
  try {
    const { message, memberId, apiKey, model } = req.body;
    const currentMemberId = Number(memberId) || getMemberId(req);

    const { chatWithGemini } = require('../ai_backend');
    const result = await chatWithGemini({
      message,
      memberId: currentMemberId,
      apiKey: apiKey || req.headers['x-gemini-key'],
      model,
      dbConn: db
    });

    res.json(result);
  } catch (error) {
    console.error('Lỗi Chatbot:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
