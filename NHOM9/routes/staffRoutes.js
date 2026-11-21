const express = require('express');
const router = express.Router();
const db = require('../db');

// API nhân viên dùng schema và mysql2 đang có trong dự án.
// Tạm thời nhận staffId từ request vì dự án hiện chưa có middleware session/JWT.
// Khi nhóm thống nhất cơ chế đăng nhập, cần thay helper này bằng user từ token/session.

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getStaffId(req) {
  return Number(req.body?.staffId || req.query?.staffId || req.headers['x-staff-id']) || 0;
}

async function requireStaff(staffId) {
  if (!staffId) return false;
  const [rows] = await db.query(
    `SELECT nv.NhanVienID
       FROM NhanVien nv
       JOIN TaiKhoan tk ON tk.TaiKhoanID = nv.NhanVienID
      WHERE nv.NhanVienID = ? AND nv.TrangThaiLamViec = 1
        AND tk.VaiTroID = 2 AND tk.TrangThai = 1`,
    [staffId]
  );
  return rows.length > 0;
}

async function ensureStaff(req, res) {
  const staffId = getStaffId(req);
  if (!(await requireStaff(staffId))) {
    res.status(401).json({ success: false, message: 'Không xác định được tài khoản nhân viên hợp lệ. Vui lòng đăng nhập lại.' });
    return null;
  }
  return staffId;
}

function sendError(res, error, fallback = 'Có lỗi xảy ra khi xử lý dữ liệu.') {
  console.error('[STAFF API]', error);
  return res.status(500).json({ success: false, message: fallback, detail: error.message });
}

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
}

async function promoteNextWaiter(conn, classId, staffId) {
  // Chỉ chuyển người đầu hàng chờ sang trạng thái 1 (chờ nhân viên xác nhận),
  // tuyệt đối không tự động chuyển sang trạng thái 2 (đã xác nhận).
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
        SET TrangThai = 1, NguoiXuLyID = NULL, NgayXuLy = NULL,
            LyDoTuChoi = NULL,
            GhiChu = CONCAT(COALESCE(GhiChu, ''), CASE WHEN COALESCE(GhiChu, '') = '' THEN '' ELSE ' | ' END,
                            'Được chuyển từ danh sách chờ vào hàng chờ xác nhận')
      WHERE DangKyID = ? AND TrangThai = 5`,
    [waiter.DangKyID]
  );
  await createNotification(
    conn,
    waiter.KhachHangID,
    staffId,
    'Lớp học đã có chỗ trống',
    `Lớp ${waiter.TenLop} đã có chỗ. Đăng ký của bạn đang chờ nhân viên xác nhận.`
  );
  return waiter;
}

// -----------------------------------------------------------------------------
// Tổng quan nhân viên
// GET /api/staff/summary?staffId=...
// -----------------------------------------------------------------------------
router.get('/summary', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;

  const [[checkins]] = await db.query(
    `SELECT COUNT(*) AS total FROM DiemDanh WHERE DATE(ThoiGian) = CURDATE()`
  );
  const [[requests]] = await db.query(
    `SELECT COUNT(*) AS total FROM YeuCauDoiHuyLich WHERE TrangThai = 1`
  );
  const [[revenue]] = await db.query(
    `SELECT COALESCE(SUM(TongTien), 0) AS total
       FROM HoaDon WHERE TrangThai = 2 AND LoaiHoaDon = 3
         AND DATE(NgayThanhToan) = CURDATE()`
  );
  const [[notifications]] = await db.query(
    `SELECT COUNT(*) AS total FROM ThongBaoNguoiNhan
      WHERE TaiKhoanID = ? AND DaDoc = 0`, [staffId]
  );

  res.json({ success: true, data: {
    checkinsToday: Number(checkins.total) || 0,
    pendingRequests: Number(requests.total) || 0,
    revenueToday: Number(revenue.total) || 0,
    unreadNotifications: Number(notifications.total) || 0
  }});
}));

// -----------------------------------------------------------------------------
// Check-in trung tâm / điểm danh buổi học
// GET /api/staff/checkins?staffId=...&date=YYYY-MM-DD
// POST /api/staff/checkins {staffId, memberCode, type:1|2, sessionId?, note?}
// -----------------------------------------------------------------------------
router.get('/checkins', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  const params = date ? [date] : [];
  const where = date ? 'DATE(dd.ThoiGian) = ?' : 'DATE(dd.ThoiGian) = CURDATE()';
  const [rows] = await db.query(
    `SELECT dd.DiemDanhID AS id, dd.ThoiGian AS checkedAt,
            dd.LoaiCheckIn AS type, dd.GhiChu AS note,
            k.MaKhachHang AS memberCode, tk.HoTen AS memberName,
            gt.TenGoiTap AS planName, d.NgayHetHan AS membershipEnd,
            l.TenLop AS className, b.BuoiHocID AS sessionId
       FROM DiemDanh dd
       JOIN KhachHang k ON k.KhachHangID = dd.KhachHangID
       JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
       LEFT JOIN DangKyGoiTap d ON d.DangKyGoiTapID = dd.DangKyGoiTapID
       LEFT JOIN GoiTap gt ON gt.GoiTapID = d.GoiTapID
       LEFT JOIN BuoiHoc b ON b.BuoiHocID = dd.BuoiHocID
       LEFT JOIN LopHoc l ON l.LopHocID = b.LopHocID
      WHERE ${where}
      ORDER BY dd.ThoiGian DESC`, params
  );
  res.json({ success: true, data: rows });
}));

router.post('/checkins', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const memberCode = String(req.body.memberCode || '').trim().toUpperCase();
  const type = Number(req.body.type || 1);
  const sessionId = Number(req.body.sessionId) || null;
  const note = String(req.body.note || '').trim() || null;
  if (!memberCode) return res.status(400).json({ success: false, message: 'Vui lòng nhập mã hội viên.' });
  if (![1, 2].includes(type)) return res.status(400).json({ success: false, message: 'Loại check-in không hợp lệ.' });
  if (type === 2 && !sessionId) return res.status(400).json({ success: false, message: 'Vui lòng chọn buổi học để điểm danh.' });

  const [members] = await db.query(
    `SELECT k.KhachHangID, k.MaKhachHang, tk.HoTen
       FROM KhachHang k JOIN TaiKhoan tk ON tk.TaiKhoanID = k.KhachHangID
      WHERE k.MaKhachHang = ? AND tk.TrangThai = 1`, [memberCode]
  );
  if (!members.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hội viên đang hoạt động.' });
  const member = members[0];

  if (type === 1) {
    const [plans] = await db.query(
      `SELECT d.DangKyGoiTapID, g.TenGoiTap, d.NgayHetHan
         FROM DangKyGoiTap d JOIN GoiTap g ON g.GoiTapID = d.GoiTapID
        WHERE d.KhachHangID = ? AND d.TrangThai = 1
          AND CURDATE() BETWEEN d.NgayBatDau AND d.NgayHetHan
        ORDER BY d.NgayHetHan DESC LIMIT 1`, [member.KhachHangID]
    );
    if (!plans.length) return res.status(403).json({ success: false, message: 'Hội viên không có gói tập còn hiệu lực. Từ chối check-in.' });
    const [duplicate] = await db.query(
      `SELECT DiemDanhID FROM DiemDanh
        WHERE KhachHangID = ? AND LoaiCheckIn = 1 AND DATE(ThoiGian) = CURDATE() LIMIT 1`,
      [member.KhachHangID]
    );
    if (duplicate.length) return res.status(409).json({ success: false, message: 'Hội viên đã check-in trung tâm hôm nay.' });
    const [insert] = await db.query(
      `INSERT INTO DiemDanh (KhachHangID, LoaiCheckIn, DangKyGoiTapID, ThoiGian, NguoiGhiNhanID, GhiChu)
       VALUES (?, 1, ?, NOW(), ?, ?)`,
      [member.KhachHangID, plans[0].DangKyGoiTapID, staffId, note || 'Check-in tại quầy']
    );
    return res.status(201).json({ success: true, message: `Check-in thành công: ${member.HoTen}`, data: { id: insert.insertId, memberCode, memberName: member.HoTen, planName: plans[0].TenGoiTap, membershipEnd: plans[0].NgayHetHan } });
  }

  const [sessions] = await db.query(
    `SELECT b.BuoiHocID, b.LopHocID, l.TenLop
       FROM BuoiHoc b JOIN LopHoc l ON l.LopHocID = b.LopHocID
      WHERE b.BuoiHocID = ? AND b.TrangThai IN (1,2)`, [sessionId]
  );
  if (!sessions.length) return res.status(404).json({ success: false, message: 'Không tìm thấy buổi học hợp lệ.' });
  const [bookings] = await db.query(
    `SELECT DangKyID FROM DangKyKhoaHoc
      WHERE KhachHangID = ? AND LopHocID = ? AND TrangThai = 2 LIMIT 1`,
    [member.KhachHangID, sessions[0].LopHocID]
  );
  if (!bookings.length) return res.status(403).json({ success: false, message: 'Hội viên chưa có đăng ký lớp được xác nhận.' });
  const [duplicate] = await db.query(
    `SELECT DiemDanhID FROM DiemDanh
      WHERE KhachHangID = ? AND BuoiHocID = ? AND LoaiCheckIn = 2 LIMIT 1`,
    [member.KhachHangID, sessionId]
  );
  if (duplicate.length) return res.status(409).json({ success: false, message: 'Hội viên đã được điểm danh buổi học này.' });
  const [insert] = await db.query(
    `INSERT INTO DiemDanh (KhachHangID, LoaiCheckIn, BuoiHocID, DangKyID, ThoiGian, NguoiGhiNhanID, GhiChu)
     VALUES (?, 2, ?, ?, NOW(), ?, ?)`,
    [member.KhachHangID, sessionId, bookings[0].DangKyID, staffId, note || 'Điểm danh lớp học']
  );
  res.status(201).json({ success: true, message: `Điểm danh thành công: ${member.HoTen}`, data: { id: insert.insertId, memberCode, memberName: member.HoTen, className: sessions[0].TenLop, sessionId } });
}));

// -----------------------------------------------------------------------------
// Lớp học, đăng ký và danh sách chờ
// GET /api/staff/classes
// GET /api/staff/enrollments?status=1|5|all
// POST /api/staff/enrollments/:id/decision {staffId, action:'approve'|'reject', reason?}
// -----------------------------------------------------------------------------
router.get('/classes', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const [rows] = await db.query(
    `SELECT l.LopHocID AS id, l.MaLop AS code, l.TenLop AS name,
            l.SucChua AS capacity, kh.TenKhoaHoc AS courseName,
            COALESCE(s.SoDaDangKy, 0) AS enrolled,
            COALESCE(s.SoConTrong, l.SucChua) AS available,
            COALESCE(s.SoDanhSachCho, 0) AS waiting,
            MIN(b.NgayHoc) AS nextDate,
            MIN(CONCAT(b.NgayHoc, ' ', b.GioBatDau)) AS nextSession
       FROM LopHoc l JOIN KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
       LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
       LEFT JOIN BuoiHoc b ON b.LopHocID = l.LopHocID AND b.TrangThai <> 3
      GROUP BY l.LopHocID, l.MaLop, l.TenLop, l.SucChua, kh.TenKhoaHoc,
               s.SoDaDangKy, s.SoConTrong, s.SoDanhSachCho
      ORDER BY l.NgayBatDau DESC, l.LopHocID DESC`
  );
  res.json({ success: true, data: rows });
}));

router.get('/enrollments', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const status = String(req.query.status || 'all');
  const allowed = ['1', '2', '3', '4', '5', '6'];
  let statusSql = '';
  const params = [];
  if (allowed.includes(status)) { statusSql = 'WHERE d.TrangThai = ?'; params.push(Number(status)); }
  else if (status === 'pending') statusSql = 'WHERE d.TrangThai = 1';
  else if (status === 'waiting') statusSql = 'WHERE d.TrangThai = 5';
  const [rows] = await db.query(
    `SELECT d.DangKyID AS id, d.KhachHangID AS memberId,
            k.MaKhachHang AS memberCode, tk.HoTen AS memberName,
            tk.SoDienThoai AS phone, l.LopHocID AS classId,
            l.MaLop AS classCode, l.TenLop AS className,
            d.NgayDangKy AS registeredAt, d.TrangThai AS status,
            d.LyDoTuChoi AS rejectReason, d.GhiChu AS note
       FROM DangKyKhoaHoc d
       JOIN KhachHang k ON k.KhachHangID = d.KhachHangID
       JOIN TaiKhoan tk ON tk.TaiKhoanID = d.KhachHangID
       JOIN LopHoc l ON l.LopHocID = d.LopHocID
       ${statusSql}
      ORDER BY CASE d.TrangThai WHEN 1 THEN 0 WHEN 5 THEN 1 ELSE 2 END,
               d.NgayDangKy ASC`, params
  );
  res.json({ success: true, data: rows });
}));

router.post('/enrollments/:id/decision', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const enrollmentId = Number(req.params.id);
  const action = String(req.body.action || '').toLowerCase();
  const reason = String(req.body.reason || '').trim();
  if (!enrollmentId || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Thông tin xử lý đăng ký không hợp lệ.' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT d.DangKyID, d.KhachHangID, d.LopHocID, d.TrangThai, l.TenLop, l.SucChua
         FROM DangKyKhoaHoc d JOIN LopHoc l ON l.LopHocID = d.LopHocID
        WHERE d.DangKyID = ? FOR UPDATE`, [enrollmentId]
    );
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy đăng ký.' }); }
    const enrollment = rows[0];
    if (Number(enrollment.TrangThai) !== 1) { await conn.rollback(); return res.status(409).json({ success: false, message: 'Đăng ký không còn ở trạng thái chờ xác nhận.' }); }

    if (action === 'approve') {
      const [counts] = await conn.query(
        `SELECT COUNT(*) AS total FROM DangKyKhoaHoc
          WHERE LopHocID = ? AND TrangThai IN (1,2)`, [enrollment.LopHocID]
      );
      if (Number(counts[0].total) > Number(enrollment.SucChua)) {
        await conn.query(
          `UPDATE DangKyKhoaHoc SET TrangThai = 5, NguoiXuLyID = ?, NgayXuLy = NOW(),
             GhiChu = 'Lớp đã đủ chỗ tại thời điểm xác nhận; chuyển vào danh sách chờ'
           WHERE DangKyID = ?`, [staffId, enrollmentId]
        );
        await createNotification(conn, enrollment.KhachHangID, staffId, 'Đăng ký được chuyển vào danh sách chờ', `Lớp ${enrollment.TenLop} hiện đã đủ chỗ. Bạn được chuyển vào danh sách chờ.`);
        await conn.commit();
        return res.json({ success: true, message: 'Lớp đã đủ chỗ. Đăng ký được chuyển vào danh sách chờ.' });
      }
      await conn.query(
        `UPDATE DangKyKhoaHoc SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), LyDoTuChoi = NULL
          WHERE DangKyID = ?`, [staffId, enrollmentId]
      );
      await createNotification(conn, enrollment.KhachHangID, staffId, 'Đăng ký lớp học được xác nhận', `Đăng ký lớp ${enrollment.TenLop} của bạn đã được xác nhận.`);
    } else {
      if (!reason) { await conn.rollback(); return res.status(400).json({ success: false, message: 'Vui lòng nhập lý do từ chối.' }); }
      await conn.query(
        `UPDATE DangKyKhoaHoc SET TrangThai = 3, NguoiXuLyID = ?, NgayXuLy = NOW(), LyDoTuChoi = ?
          WHERE DangKyID = ?`, [staffId, reason, enrollmentId]
      );
      await createNotification(conn, enrollment.KhachHangID, staffId, 'Đăng ký lớp học bị từ chối', `Đăng ký lớp ${enrollment.TenLop} chưa được duyệt. Lý do: ${reason}`);
      await promoteNextWaiter(conn, enrollment.LopHocID, staffId);
    }
    await conn.commit();
    res.json({ success: true, message: action === 'approve' ? 'Đã xác nhận đăng ký.' : 'Đã từ chối đăng ký.' });
  } catch (error) {
    await conn.rollback();
    sendError(res, error, 'Không thể xử lý đăng ký lớp học.');
  } finally { conn.release(); }
}));

// Yêu cầu hủy/đổi lớp do khách hàng gửi lên.
router.get('/class-requests', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
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
      WHERE y.TrangThai = 1 ORDER BY y.NgayGui ASC`
  );
  res.json({ success: true, data: rows });
}));

router.post('/class-requests/:id/handle', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
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
        WHERE y.YeuCauID = ? FOR UPDATE`, [requestId]
    );
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu.' }); }
    const r = rows[0];
    if (Number(r.TrangThai) !== 1) { await conn.rollback(); return res.status(409).json({ success: false, message: 'Yêu cầu đã được xử lý.' }); }

    if (!approve) {
      await conn.query(
        `UPDATE YeuCauDoiHuyLich SET TrangThai = 3, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`,
        [staffId, reason || 'Không được chấp nhận', requestId]
      );
      await createNotification(conn, r.KhachHangID, staffId, 'Yêu cầu đổi/hủy lớp không được chấp nhận', reason || 'Yêu cầu của bạn chưa được chấp nhận.');
      await conn.commit();
      return res.json({ success: true, message: 'Đã từ chối yêu cầu.' });
    }

    if (Number(r.LoaiYeuCau) === 1) {
      await conn.query(`UPDATE DangKyKhoaHoc SET TrangThai = 4, NguoiXuLyID = ?, NgayXuLy = NOW() WHERE DangKyID = ?`, [staffId, r.DangKyID]);
      await conn.query(`UPDATE YeuCauDoiHuyLich SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`, [staffId, reason || null, requestId]);
      await createNotification(conn, r.KhachHangID, staffId, 'Yêu cầu hủy lớp được chấp nhận', `Yêu cầu hủy lớp ${r.fromClassName} đã được chấp nhận.`);
      await promoteNextWaiter(conn, r.LopHocID, staffId);
    } else {
      const targetId = Number(r.LopHocMoiID);
      const [target] = await conn.query(`SELECT LopHocID, TenLop, SucChua FROM LopHoc WHERE LopHocID = ? FOR UPDATE`, [targetId]);
      if (!target.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy lớp muốn chuyển.' }); }
      const [counts] = await conn.query(`SELECT COUNT(*) AS total FROM DangKyKhoaHoc WHERE LopHocID = ? AND TrangThai IN (1,2)`, [targetId]);
      if (Number(counts[0].total) >= Number(target[0].SucChua)) { await conn.rollback(); return res.status(409).json({ success: false, message: 'Lớp đích đã đầy. Có thể hướng dẫn khách đăng ký danh sách chờ.' }); }
      await conn.query(`UPDATE DangKyKhoaHoc SET LopHocID = ?, TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW() WHERE DangKyID = ?`, [targetId, staffId, r.DangKyID]);
      await conn.query(`UPDATE YeuCauDoiHuyLich SET TrangThai = 2, NguoiXuLyID = ?, NgayXuLy = NOW(), GhiChuXuLy = ? WHERE YeuCauID = ?`, [staffId, reason || null, requestId]);
      await createNotification(conn, r.KhachHangID, staffId, 'Yêu cầu đổi lớp được chấp nhận', `Bạn đã được chuyển sang lớp ${target[0].TenLop}.`);
      await promoteNextWaiter(conn, r.LopHocID, staffId);
    }
    await conn.commit();
    res.json({ success: true, message: 'Đã xử lý yêu cầu thành công.' });
  } catch (error) {
    await conn.rollback();
    sendError(res, error, 'Không thể xử lý yêu cầu đổi/hủy lớp.');
  } finally { conn.release(); }
}));

// -----------------------------------------------------------------------------
// Bán hàng tại quầy và tồn kho
// GET /api/staff/products
// POST /api/staff/checkout {staffId, memberCode?, paymentMethod:1|2|3, items:[{productId,quantity}]}
// -----------------------------------------------------------------------------
router.get('/products', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const [rows] = await db.query(
    `SELECT sp.SanPhamID AS id, sp.MaSanPham AS code, sp.TenSanPham AS name,
            sp.MoTa AS description, sp.Gia AS price, sp.SoLuongTon AS stock,
            dm.TenDanhMuc AS category
       FROM SanPham sp JOIN DanhMucSanPham dm ON dm.DanhMucID = sp.DanhMucID
      WHERE sp.TrangThai = 1 AND dm.TrangThai = 1
      ORDER BY sp.TenSanPham ASC`
  );
  res.json({ success: true, data: rows });
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const memberCode = String(req.body.memberCode || '').trim().toUpperCase();
  const paymentMethod = Number(req.body.paymentMethod);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (![1,2,3].includes(paymentMethod)) return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ (1 tiền mặt, 2 chuyển khoản, 3 thẻ).' });
  if (!items.length) return res.status(400).json({ success: false, message: 'Giỏ hàng đang trống.' });
  const normalized = new Map();
  for (const item of items) {
    const id = Number(item.productId), quantity = Number(item.quantity);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ success: false, message: 'Sản phẩm hoặc số lượng không hợp lệ.' });
    normalized.set(id, (normalized.get(id) || 0) + quantity);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let customerId = null;
    if (memberCode) {
      const [members] = await conn.query(`SELECT KhachHangID FROM KhachHang WHERE MaKhachHang = ?`, [memberCode]);
      if (!members.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Không tìm thấy mã hội viên.' }); }
      customerId = members[0].KhachHangID;
    }

    const productIds = [...normalized.keys()];
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await conn.query(
      `SELECT SanPhamID, MaSanPham, TenSanPham, Gia, SoLuongTon
         FROM SanPham WHERE SanPhamID IN (${placeholders}) AND TrangThai = 1 FOR UPDATE`, productIds
    );
    if (products.length !== productIds.length) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Có sản phẩm không tồn tại hoặc đã ngừng kinh doanh.' }); }
    const byId = new Map(products.map(p => [Number(p.SanPhamID), p]));
    let total = 0;
    for (const [id, quantity] of normalized) {
      const p = byId.get(id);
      if (Number(p.SoLuongTon) < quantity) { await conn.rollback(); return res.status(409).json({ success: false, message: `Sản phẩm ${p.TenSanPham} chỉ còn ${p.SoLuongTon} trong kho.` }); }
      total += Number(p.Gia) * quantity;
    }

    const [invoice] = await conn.query(
      `INSERT INTO HoaDon (KhachHangID, NguoiLapID, LoaiHoaDon, NgayLap, TongTien,
                           PhuongThucThanhToan, TrangThai, NgayThanhToan, NguoiXacNhanID, GhiChu)
       VALUES (?, ?, 3, NOW(), ?, ?, 2, NOW(), ?, 'Bán sản phẩm tại quầy')`,
      [customerId, staffId, total, paymentMethod, staffId]
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
    res.status(201).json({ success: true, message: 'Thanh toán tại quầy thành công.', data: { invoiceId, invoiceCode, total, paymentMethod } });
  } catch (error) {
    await conn.rollback();
    sendError(res, error, 'Không thể tạo hóa đơn bán hàng.');
  } finally { conn.release(); }
}));

// -----------------------------------------------------------------------------
// Hóa đơn / thanh toán
// GET /api/staff/invoices?staffId=...&q=...
// GET /api/staff/invoices/:id?staffId=...
// POST /api/staff/invoices/:id/pay {staffId, paymentMethod:1|2|3}
// -----------------------------------------------------------------------------
router.get('/invoices', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
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
      ORDER BY h.NgayLap DESC`, [q, like, like]
  );
  res.json({ success: true, data: rows });
}));

router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const id = Number(req.params.id);
  const [headers] = await db.query(
    `SELECT h.HoaDonID AS id, h.MaHoaDon AS code, h.NgayLap AS createdAt,
            h.TongTien AS total, h.TrangThai AS status, h.PhuongThucThanhToan AS paymentMethod,
            COALESCE(tk.HoTen, 'Khách lẻ') AS customerName
       FROM HoaDon h LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = h.KhachHangID
      WHERE h.HoaDonID = ? AND h.LoaiHoaDon = 3`, [id]
  );
  if (!headers.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
  const [items] = await db.query(
    `SELECT ct.SanPhamID AS productId, ct.MoTa AS description,
            ct.SoLuong AS quantity, ct.DonGia AS unitPrice, ct.ThanhTien AS lineTotal
       FROM ChiTietHoaDon ct WHERE ct.HoaDonID = ?`, [id]
  );
  res.json({ success: true, data: { ...headers[0], items } });
}));

router.post('/invoices/:id/pay', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const id = Number(req.params.id);
  const paymentMethod = Number(req.body.paymentMethod);
  if (![1,2,3].includes(paymentMethod)) return res.status(400).json({ success: false, message: 'Phương thức thanh toán không hợp lệ.' });
  const [result] = await db.query(
    `UPDATE HoaDon SET TrangThai = 2, PhuongThucThanhToan = ?,
                       NgayThanhToan = NOW(), NguoiXacNhanID = ?
      WHERE HoaDonID = ? AND LoaiHoaDon = 3 AND TrangThai = 1`,
    [paymentMethod, staffId, id]
  );
  if (!result.affectedRows) {
    const [rows] = await db.query(`SELECT TrangThai FROM HoaDon WHERE HoaDonID = ? AND LoaiHoaDon = 3`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn.' });
    return res.status(409).json({ success: false, message: Number(rows[0].TrangThai) === 2 ? 'Hóa đơn đã được thanh toán trước đó.' : 'Hóa đơn không ở trạng thái có thể thanh toán.' });
  }
  res.json({ success: true, message: 'Đã xác nhận thanh toán hóa đơn.' });
}));

// -----------------------------------------------------------------------------
// Thông báo dành cho nhân viên
// GET /api/staff/notifications?staffId=...
// PATCH /api/staff/notifications/read-all {staffId}
// PATCH /api/staff/notifications/:id/read {staffId}
// -----------------------------------------------------------------------------
router.get('/notifications', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  const [rows] = await db.query(
    `SELECT t.ThongBaoID AS id, t.TieuDe AS title, t.NoiDung AS content,
            t.ThoiGianGui AS sentAt, n.DaDoc AS isRead
       FROM ThongBaoNguoiNhan n JOIN ThongBao t ON t.ThongBaoID = n.ThongBaoID
      WHERE n.TaiKhoanID = ? ORDER BY t.ThoiGianGui DESC, t.ThongBaoID DESC`, [staffId]
  );
  res.json({ success: true, data: rows });
}));

router.patch('/notifications/read-all', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  await db.query(`UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE TaiKhoanID = ? AND DaDoc = 0`, [staffId]);
  res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo là đã đọc.' });
}));

router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
  const staffId = await ensureStaff(req, res);
  if (!staffId) return;
  await db.query(`UPDATE ThongBaoNguoiNhan SET DaDoc = 1, NgayDoc = NOW() WHERE TaiKhoanID = ? AND ThongBaoID = ?`, [staffId, Number(req.params.id)]);
  res.json({ success: true, message: 'Đã đánh dấu thông báo đã đọc.' });
}));

// Error handler riêng của router để không làm server Express 5 bị treo request.
router.use((error, req, res, next) => {
  sendError(res, error);
});

module.exports = router;
