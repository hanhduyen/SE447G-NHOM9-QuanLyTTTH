const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper async handler
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Lấy adminId từ headers, body hoặc query
function getAdminId(req) {
  return Number(req.headers['x-admin-id'] || req.body?.adminId || req.query?.adminId) || 0;
}

// Kiểm tra quyền Quản trị viên (VaiTroID = 1: Admin)
async function requireAdmin(adminId) {
  if (!adminId) return null;
  const [rows] = await db.query(
    `SELECT tk.TaiKhoanID, tk.HoTen, tk.Email, tk.VaiTroID, v.TenVaiTro
       FROM TaiKhoan tk
       JOIN VaiTro v ON tk.VaiTroID = v.VaiTroID
      WHERE tk.TaiKhoanID = ? AND tk.TrangThai = 1 AND tk.VaiTroID = 1`,
    [adminId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Middleware bảo vệ phân quyền Admin
async function ensureAdmin(req, res) {
  const adminId = getAdminId(req);
  const admin = await requireAdmin(adminId);
  if (!admin) {
    res.status(403).json({
      success: false,
      message: 'Lỗi phân quyền: Bạn không có quyền Quản trị viên hoặc phiên đăng nhập đã hết hạn!'
    });
    return null;
  }
  return admin;
}

// =============================================================================
// DANH MỤC CHUYÊN MÔN
// =============================================================================
router.get('/specialties', asyncHandler(async (req, res) => {
  const [rows] = await db.query('SELECT * FROM ChuyenMon ORDER BY ChuyenMonID ASC');
  res.json({ success: true, data: rows });
}));

// =============================================================================
// I. QUẢN LÝ GÓI TẬP (PACKAGES)
// Luồng sự kiện chính:
// 1. Quản trị viên truy cập chức năng quản lý gói tập và khóa học.
// 2. Hệ thống hiển thị danh sách các gói tập hiện có.
// 3. Quản trị viên chọn tạo mới hoặc chọn một gói tập cần chỉnh sửa.
// 4. Nếu tạo mới, hiển thị form trống. Nếu sửa, hiển thị thông tin hiện tại.
// 5. Quản trị viên nhập/cập nhật tên, mô tả, thời lượng (ngày), giá và điều kiện tham gia.
// 6. Quản trị viên thiết lập trạng thái kinh doanh (đang kinh doanh / ngừng kinh doanh) và trạng thái công bố.
// 7. Chọn lưu thông tin -> Hệ thống kiểm tra tính hợp lệ và đầy đủ.
// 8. Nếu hợp lệ, lưu thông tin gói tập và cập nhật trạng thái công bố.
// 9. Thông báo kết quả lưu thành công và hiển thị danh sách đã cập nhật.
//
// Luồng thay thế:
// - Nếu quản trị viên chọn ngừng kinh doanh, hệ thống cập nhật trạng thái thay vì xóa dữ liệu.
// - Nếu dữ liệu bị thiếu hoặc thời lượng không hợp lệ, hệ thống báo lỗi và yêu cầu chỉnh sửa.
// - Nếu gói tập đã phát sinh đăng ký, hệ thống KHÔNG CHO PHÉP XÓA CỨNG; có thể chuyển sang ngừng kinh doanh.
//
// Luồng ngoại lệ:
// - Nếu xảy ra lỗi trong quá trình lưu dữ liệu, hệ thống rollback, báo lỗi và giữ nguyên thông tin trước đó.
//
// Yêu cầu đặc biệt:
// - Các thay đổi thông tin hoặc trạng thái kinh doanh không được làm sai lệch lịch sử đăng ký đã phát sinh của khách hàng.
// =============================================================================

// 1. GET /api/admin/packages: Lấy danh sách tất cả gói tập
router.get('/packages', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [rows] = await db.query(`
    SELECT g.GoiTapID AS id,
           g.TenGoiTap AS name,
           g.MoTa AS description,
           g.ThoiHanNgay AS duration_days,
           g.Gia AS price_vnd,
           g.DieuKienThamGia AS requirements,
           g.TrangThai AS status,
           g.CongBo AS is_published,
           g.NgayTao AS created_at,
           g.NgayCapNhat AS updated_at,
           (SELECT COUNT(*) FROM DangKyGoiTap d WHERE d.GoiTapID = g.GoiTapID) AS total_enrollments,
           (SELECT COUNT(*) FROM DangKyGoiTap d WHERE d.GoiTapID = g.GoiTapID AND d.TrangThai = 1 AND CURDATE() BETWEEN d.NgayBatDau AND d.NgayHetHan) AS active_enrollments
      FROM GoiTap g
     ORDER BY g.GoiTapID DESC
  `);

  res.json({ success: true, data: rows });
}));

// 2. GET /api/admin/packages/:id: Xem chi tiết 1 gói tập
router.get('/packages/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [rows] = await db.query(`
    SELECT g.GoiTapID AS id,
           g.TenGoiTap AS name,
           g.MoTa AS description,
           g.ThoiHanNgay AS duration_days,
           g.Gia AS price_vnd,
           g.DieuKienThamGia AS requirements,
           g.TrangThai AS status,
           g.CongBo AS is_published,
           g.NgayTao AS created_at,
           g.NgayCapNhat AS updated_at,
           (SELECT COUNT(*) FROM DangKyGoiTap d WHERE d.GoiTapID = g.GoiTapID) AS total_enrollments
      FROM GoiTap g
     WHERE g.GoiTapID = ?
  `, [id]);

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy gói tập yêu cầu!' });
  }

  res.json({ success: true, data: rows[0] });
}));

// 3. POST /api/admin/packages: Tạo mới gói tập
router.post('/packages', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    name,
    description,
    durationDays,
    thoiHanNgay,
    price,
    requirements,
    status = 1,
    isActive,
    isPublished = 1,
    congBo
  } = req.body;

  // 1. Kiểm tra tính hợp lệ và đầy đủ của dữ liệu (Luồng thay thế)
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên gói tập không được để trống!' });
  }

  const days = Number(durationDays ?? thoiHanNgay);
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Thời lượng gói tập không hợp lệ! Vui lòng nhập số ngày là số nguyên dương lớn hơn 0 (VD: 30, 90, 365).'
    });
  }

  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ success: false, message: 'Giá gói tập không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.' });
  }

  // Kiểm tra trùng tên gói tập
  const [existing] = await db.query(
    'SELECT GoiTapID FROM GoiTap WHERE LOWER(TenGoiTap) = LOWER(?) LIMIT 1',
    [cleanName]
  );
  if (existing.length > 0) {
    return res.status(400).json({ success: false, message: `Tên gói tập "${cleanName}" đã tồn tại. Vui lòng chọn tên khác!` });
  }

  // 2. Lưu thông tin gói tập (Luồng ngoại lệ với Transaction)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalStatus = Number(status) === 0 ? 0 : 1;
    const finalPublish = Number(isPublished) === 1 ? 1 : 0;

    const [insert] = await conn.query(
      `INSERT INTO GoiTap (TenGoiTap, MoTa, ThoiHanNgay, Gia, DieuKienThamGia, TrangThai, CongBo, NgayTao)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        cleanName,
        description ? String(description).trim() : null,
        days,
        priceNum,
        requirements ? String(requirements).trim() : 'Từ 16 tuổi trở lên',
        finalStatus,
        finalPublish
      ]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Đã tạo mới gói tập "${cleanName}" thành công!`,
      data: {
        id: insert.insertId,
        name: cleanName,
        durationDays: days,
        price: priceNum,
        status: finalStatus,
        isPublished: finalPublish
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN CREATE PACKAGE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu dữ liệu gói tập: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên dữ liệu trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 4. PUT /api/admin/packages/:id: Cập nhật thông tin gói tập
router.put('/packages/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  // Kiểm tra gói tập tồn tại
  const [existing] = await db.query('SELECT * FROM GoiTap WHERE GoiTapID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy gói tập cần cập nhật!' });
  }

  const {
    name,
    description,
    durationDays,
    price,
    requirements,
    status,
    isPublished
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế)
  const cleanName = String(name || req.body.className || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên gói tập không được để trống!' });
  }

  const days = Number(durationDays);
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Thời lượng gói tập không hợp lệ! Vui lòng nhập số ngày là số nguyên dương lớn hơn 0.'
    });
  }

  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ success: false, message: 'Giá gói tập không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.' });
  }

  // Kiểm tra trùng tên với gói tập khác
  const [dup] = await db.query(
    'SELECT GoiTapID FROM GoiTap WHERE LOWER(TenGoiTap) = LOWER(?) AND GoiTapID != ? LIMIT 1',
    [cleanName, id]
  );
  if (dup.length > 0) {
    return res.status(400).json({ success: false, message: `Tên gói tập "${cleanName}" đã được sử dụng bởi một gói tập khác!` });
  }

  // 2. Lưu cập nhật với Transaction (Luồng ngoại lệ)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalStatus = status !== undefined ? (Number(status) === 0 ? 0 : 1) : existing[0].TrangThai;
    const finalPublish = isPublished !== undefined ? (Number(isPublished) === 1 ? 1 : 0) : existing[0].CongBo;

    await conn.query(
      `UPDATE GoiTap
          SET TenGoiTap = ?,
              MoTa = ?,
              ThoiHanNgay = ?,
              Gia = ?,
              DieuKienThamGia = ?,
              TrangThai = ?,
              CongBo = ?,
              NgayCapNhat = NOW()
        WHERE GoiTapID = ?`,
      [
        cleanName,
        description !== undefined ? (String(description).trim() || null) : existing[0].MoTa,
        days,
        priceNum,
        requirements !== undefined ? (String(requirements).trim() || null) : existing[0].DieuKienThamGia,
        finalStatus,
        finalPublish,
        id
      ]
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Cập nhật thông tin gói tập "${cleanName}" thành công!`,
      data: {
        id,
        name: cleanName,
        durationDays: days,
        price: priceNum,
        status: finalStatus,
        isPublished: finalPublish
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN UPDATE PACKAGE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật dữ liệu: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên thông tin gói tập trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 5. PATCH /api/admin/packages/:id/status: Chuyển đổi trạng thái kinh doanh hoặc công bố
router.patch('/packages/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenGoiTap, TrangThai, CongBo FROM GoiTap WHERE GoiTapID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy gói tập!' });
  }

  const { status, isPublished } = req.body;
  const updates = [];
  const params = [];

  if (status !== undefined) {
    const s = Number(status) === 1 ? 1 : 0;
    updates.push('TrangThai = ?');
    params.push(s);
  }
  if (isPublished !== undefined) {
    const p = Number(isPublished) === 1 ? 1 : 0;
    updates.push('CongBo = ?');
    params.push(p);
  }

  if (!updates.length) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp trạng thái cần thay đổi (status hoặc isPublished).' });
  }

  updates.push('NgayCapNhat = NOW()');
  params.push(id);

  await db.query(`UPDATE GoiTap SET ${updates.join(', ')} WHERE GoiTapID = ?`, params);

  const [updated] = await db.query('SELECT TrangThai, CongBo FROM GoiTap WHERE GoiTapID = ?', [id]);

  res.json({
    success: true,
    message: `Đã cập nhật trạng thái gói tập "${existing[0].TenGoiTap}" thành công!`,
    data: {
      id,
      status: updated[0].TrangThai,
      isPublished: updated[0].CongBo
    }
  });
}));

// 6. DELETE /api/admin/packages/:id: Xóa gói tập (Ràng buộc: cấm xóa cứng nếu đã có đăng ký)
router.delete('/packages/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenGoiTap FROM GoiTap WHERE GoiTapID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy gói tập cần xóa!' });
  }

  // Ràng buộc bảo mật & luồng thay thế: Kiểm tra lịch sử đăng ký đã phát sinh
  const [[enrollments]] = await db.query(
    'SELECT COUNT(*) AS total FROM DangKyGoiTap WHERE GoiTapID = ?',
    [id]
  );

  if (Number(enrollments.total) > 0) {
    return res.status(400).json({
      success: false,
      message: `Gói tập "${existing[0].TenGoiTap}" đã phát sinh ${enrollments.total} lượt đăng ký của khách hàng, hệ thống không cho phép xóa cứng để bảo vệ tính toàn vẹn dữ liệu lịch sử! Bạn vui lòng chuyển gói tập sang trạng thái "Ngừng kinh doanh".`
    });
  }

  // Nếu chưa từng có đăng ký -> Cho phép xóa cứng
  await db.query('DELETE FROM GoiTap WHERE GoiTapID = ?', [id]);

  res.json({
    success: true,
    message: `Đã xóa gói tập "${existing[0].TenGoiTap}" thành công.`
  });
}));


// =============================================================================
// II. QUẢN LÝ KHÓA HỌC (COURSES)
// Luồng sự kiện chính:
// 1. Quản trị viên truy cập chức năng quản lý gói tập và khóa học.
// 2. Hệ thống hiển thị danh sách các khóa học hiện có kèm lớp học và sĩ số.
// 3. Quản trị viên chọn tạo mới hoặc chọn một khóa học cần chỉnh sửa.
// 4. Hệ thống hiển thị biểu mẫu thông tin khóa học.
// 5. Quản trị viên nhập/cập nhật tên, mô tả, chuyên môn, thời lượng (tuần), số buổi, giá và điều kiện tham gia.
// 6. Quản trị viên thiết lập trạng thái kinh doanh (đang kinh doanh / ngừng kinh doanh) và trạng thái công bố.
// 7. Chọn lưu thông tin -> Hệ thống kiểm tra tính hợp lệ và đầy đủ của dữ liệu.
// 8. Nếu dữ liệu hợp lệ, lưu thông tin khóa học và cập nhật trạng thái công bố.
// 9. Thông báo kết quả lưu thành công và hiển thị danh sách cập nhật.
//
// Luồng thay thế:
// - Nếu chọn ngừng kinh doanh, hệ thống cập nhật trạng thái thay vì xóa dữ liệu.
// - Nếu dữ liệu bị thiếu hoặc thời lượng không hợp lệ, hệ thống báo lỗi và yêu cầu chỉnh sửa.
// - Nếu khóa học đã phát sinh đăng ký hoặc đã có lớp học mở, hệ thống KHÔNG CHO PHÉP XÓA CỨNG; có thể chuyển sang ngừng kinh doanh.
//
// Luồng ngoại lệ:
// - Nếu xảy ra lỗi trong quá trình lưu, rollback, thông báo lỗi và giữ nguyên thông tin trước đó.
//
// Yêu cầu đặc biệt:
// - Các thay đổi thông tin hoặc trạng thái kinh doanh không được làm sai lệch lịch sử đăng ký đã phát sinh của khách hàng.
// =============================================================================

// 1. GET /api/admin/courses: Lấy danh sách tất cả khóa học và lớp học
router.get('/courses', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [courses] = await db.query(`
    SELECT kh.KhoaHocID AS id,
           kh.TenKhoaHoc AS name,
           kh.MoTa AS description,
           kh.ChuyenMonID AS specialty_id,
           COALESCE(cm.TenChuyenMon, 'Chung') AS specialty,
           kh.ThoiLuongTuan AS duration_weeks,
           kh.SoBuoi AS total_sessions,
           kh.Gia AS price_vnd,
           kh.DieuKienThamGia AS requirements,
           kh.TrangThai AS status,
           kh.CongBo AS is_published,
           kh.NgayTao AS created_at,
           kh.NgayCapNhat AS updated_at,
           (SELECT COUNT(*) FROM LopHoc l WHERE l.KhoaHocID = kh.KhoaHocID) AS total_classes,
           (SELECT COUNT(*) 
              FROM DangKyKhoaHoc d 
              JOIN LopHoc l ON d.LopHocID = l.LopHocID 
             WHERE l.KhoaHocID = kh.KhoaHocID) AS total_enrollments
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
     ORDER BY kh.KhoaHocID DESC
  `);

  const [classes] = await db.query(`
    SELECT l.LopHocID AS id,
           l.MaLop AS code,
           l.TenLop AS name,
           l.KhoaHocID AS course_id,
           l.PhongID AS room_id,
           p.TenPhong AS room_name,
           l.NgayBatDau AS start_date,
           l.NgayKetThuc AS end_date,
           l.SucChua AS capacity,
           COALESCE(s.SoDaDangKy, 0) AS enrolled_count,
           COALESCE(s.SoConTrong, l.SucChua) AS available_slots
      FROM LopHoc l
      JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
     ORDER BY l.NgayBatDau DESC
  `);

  res.json({
    success: true,
    data: {
      courses,
      classes
    }
  });
}));

// 2. GET /api/admin/courses/:id: Xem chi tiết 1 khóa học
router.get('/courses/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [rows] = await db.query(`
    SELECT kh.KhoaHocID AS id,
           kh.TenKhoaHoc AS name,
           kh.MoTa AS description,
           kh.ChuyenMonID AS specialty_id,
           COALESCE(cm.TenChuyenMon, 'Chung') AS specialty,
           kh.ThoiLuongTuan AS duration_weeks,
           kh.SoBuoi AS total_sessions,
           kh.Gia AS price_vnd,
           kh.DieuKienThamGia AS requirements,
           kh.TrangThai AS status,
           kh.CongBo AS is_published,
           kh.NgayTao AS created_at,
           kh.NgayCapNhat AS updated_at,
           (SELECT COUNT(*) FROM LopHoc l WHERE l.KhoaHocID = kh.KhoaHocID) AS total_classes,
           (SELECT COUNT(*) 
              FROM DangKyKhoaHoc d 
              JOIN LopHoc l ON d.LopHocID = l.LopHocID 
             WHERE l.KhoaHocID = kh.KhoaHocID) AS total_enrollments
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
     WHERE kh.KhoaHocID = ?
  `, [id]);

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học yêu cầu!' });
  }

  res.json({ success: true, data: rows[0] });
}));

// 3. POST /api/admin/courses: Tạo mới khóa học
router.post('/courses', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    name,
    description,
    specialtyId,
    durationWeeks,
    thoiLuongTuan,
    totalSessions,
    sessionsCount,
    soBuoi,
    price,
    requirements,
    status = 1,
    isActive,
    isPublished = 1,
    congBo
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế)
  const cleanName = String(name || req.body.className || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên khóa học không được để trống!' });
  }

  const weeks = Number(durationWeeks ?? thoiLuongTuan);
  if (!Number.isInteger(weeks) || weeks <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Thời lượng khóa học không hợp lệ! Vui lòng nhập số tuần là số nguyên dương lớn hơn 0 (VD: 4, 8, 12 tuần).'
    });
  }

  const sessions = Number(totalSessions ?? sessionsCount ?? soBuoi);
  if (!Number.isInteger(sessions) || sessions <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Số buổi học không hợp lệ! Vui lòng nhập số buổi là số nguyên dương lớn hơn 0.'
    });
  }

  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ success: false, message: 'Giá khóa học không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.' });
  }

  // Kiểm tra trùng tên khóa học
  const [existing] = await db.query(
    'SELECT KhoaHocID FROM KhoaHoc WHERE LOWER(TenKhoaHoc) = LOWER(?) LIMIT 1',
    [cleanName]
  );
  if (existing.length > 0) {
    return res.status(400).json({ success: false, message: `Tên khóa học "${cleanName}" đã tồn tại. Vui lòng chọn tên khác!` });
  }

  // 2. Lưu khóa học với Transaction (Luồng ngoại lệ)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalStatus = Number(status) === 0 ? 0 : 1;
    const finalPublish = Number(isPublished) === 1 ? 1 : 0;
    const specId = specialtyId ? Number(specialtyId) : 1;

    const [insert] = await conn.query(
      `INSERT INTO KhoaHoc (TenKhoaHoc, MoTa, ChuyenMonID, ThoiLuongTuan, SoBuoi, Gia, DieuKienThamGia, TrangThai, CongBo, NgayTao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        cleanName,
        description ? String(description).trim() : null,
        specId,
        weeks,
        sessions,
        priceNum,
        requirements ? String(requirements).trim() : 'Sức khỏe tốt',
        finalStatus,
        finalPublish
      ]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Đã tạo mới khóa học "${cleanName}" thành công!`,
      data: {
        id: insert.insertId,
        name: cleanName,
        durationWeeks: weeks,
        totalSessions: sessions,
        price: priceNum,
        status: finalStatus,
        isPublished: finalPublish
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN CREATE COURSE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu dữ liệu khóa học: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên dữ liệu trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 4. PUT /api/admin/courses/:id: Cập nhật thông tin khóa học
router.put('/courses/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  // Kiểm tra khóa học tồn tại
  const [existing] = await db.query('SELECT * FROM KhoaHoc WHERE KhoaHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học cần cập nhật!' });
  }

  const {
    name,
    description,
    specialtyId,
    durationWeeks,
    thoiLuongTuan,
    totalSessions,
    sessionsCount,
    soBuoi,
    price,
    requirements,
    status,
    isActive,
    isPublished,
    congBo
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế)
  const cleanName = String(name || req.body.className || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên khóa học không được để trống!' });
  }

  const weeks = Number(durationWeeks ?? thoiLuongTuan);
  if (!Number.isInteger(weeks) || weeks <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Thời lượng khóa học không hợp lệ! Vui lòng nhập số tuần là số nguyên dương lớn hơn 0.'
    });
  }

  const sessions = Number(totalSessions ?? sessionsCount ?? soBuoi);
  if (!Number.isInteger(sessions) || sessions <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Số buổi học không hợp lệ! Vui lòng nhập số buổi là số nguyên dương lớn hơn 0.'
    });
  }

  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ success: false, message: 'Giá khóa học không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.' });
  }

  // Kiểm tra trùng tên với khóa học khác
  const [dup] = await db.query(
    'SELECT KhoaHocID FROM KhoaHoc WHERE LOWER(TenKhoaHoc) = LOWER(?) AND KhoaHocID != ? LIMIT 1',
    [cleanName, id]
  );
  if (dup.length > 0) {
    return res.status(400).json({ success: false, message: `Tên khóa học "${cleanName}" đã được sử dụng bởi một khóa học khác!` });
  }

  // 2. Lưu cập nhật với Transaction (Luồng ngoại lệ)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalStatus = status !== undefined ? (Number(status) === 0 ? 0 : 1) : existing[0].TrangThai;
    const finalPublish = isPublished !== undefined ? (Number(isPublished) === 1 ? 1 : 0) : existing[0].CongBo;
    const specId = specialtyId !== undefined ? Number(specialtyId) : existing[0].ChuyenMonID;

    await conn.query(
      `UPDATE KhoaHoc
          SET TenKhoaHoc = ?,
              MoTa = ?,
              ChuyenMonID = ?,
              ThoiLuongTuan = ?,
              SoBuoi = ?,
              Gia = ?,
              DieuKienThamGia = ?,
              TrangThai = ?,
              CongBo = ?,
              NgayCapNhat = NOW()
        WHERE KhoaHocID = ?`,
      [
        cleanName,
        description !== undefined ? (String(description).trim() || null) : existing[0].MoTa,
        specId,
        weeks,
        sessions,
        priceNum,
        requirements !== undefined ? (String(requirements).trim() || null) : existing[0].DieuKienThamGia,
        finalStatus,
        finalPublish,
        id
      ]
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Cập nhật thông tin khóa học "${cleanName}" thành công!`,
      data: {
        id,
        name: cleanName,
        durationWeeks: weeks,
        totalSessions: sessions,
        price: priceNum,
        status: finalStatus,
        isPublished: finalPublish
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN UPDATE COURSE ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật dữ liệu khóa học: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên thông tin khóa học trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 5. PATCH /api/admin/courses/:id/status: Chuyển đổi trạng thái kinh doanh hoặc công bố
router.patch('/courses/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenKhoaHoc, TrangThai, CongBo FROM KhoaHoc WHERE KhoaHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học!' });
  }

  const { status, isPublished } = req.body;
  const updates = [];
  const params = [];

  if (status !== undefined) {
    const s = Number(status) === 1 ? 1 : 0;
    updates.push('TrangThai = ?');
    params.push(s);
  }
  if (isPublished !== undefined) {
    const p = Number(isPublished) === 1 ? 1 : 0;
    updates.push('CongBo = ?');
    params.push(p);
  }

  if (!updates.length) {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp trạng thái cần thay đổi (status hoặc isPublished).' });
  }

  updates.push('NgayCapNhat = NOW()');
  params.push(id);

  await db.query(`UPDATE KhoaHoc SET ${updates.join(', ')} WHERE KhoaHocID = ?`, params);

  const [updated] = await db.query('SELECT TrangThai, CongBo FROM KhoaHoc WHERE KhoaHocID = ?', [id]);

  res.json({
    success: true,
    message: `Đã cập nhật trạng thái khóa học "${existing[0].TenKhoaHoc}" thành công!`,
    data: {
      id,
      status: updated[0].TrangThai,
      isPublished: updated[0].CongBo
    }
  });
}));

// 6. DELETE /api/admin/courses/:id: Xóa khóa học (Ràng buộc: cấm xóa cứng nếu đã có lớp học hoặc đăng ký)
router.delete('/courses/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenKhoaHoc FROM KhoaHoc WHERE KhoaHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy khóa học cần xóa!' });
  }

  // Ràng buộc bảo mật & luồng thay thế: Kiểm tra lớp học hoặc đăng ký đã phát sinh
  const [[classesCount]] = await db.query(
    'SELECT COUNT(*) AS total FROM LopHoc WHERE KhoaHocID = ?',
    [id]
  );
  const [[enrollmentsCount]] = await db.query(
    `SELECT COUNT(*) AS total 
       FROM DangKyKhoaHoc d 
       JOIN LopHoc l ON d.LopHocID = l.LopHocID 
      WHERE l.KhoaHocID = ?`,
    [id]
  );

  if (Number(classesCount.total) > 0 || Number(enrollmentsCount.total) > 0) {
    return res.status(400).json({
      success: false,
      message: `Khóa học "${existing[0].TenKhoaHoc}" đã có ${classesCount.total} lớp học và ${enrollmentsCount.total} học viên đăng ký liên quan, hệ thống không cho phép xóa cứng để bảo vệ tính toàn vẹn dữ liệu! Quản trị viên vui lòng chuyển khóa học sang trạng thái "Ngừng kinh doanh".`
    });
  }

  // Nếu chưa từng có lớp học hay đăng ký liên quan -> Cho phép xóa cứng
  await db.query('DELETE FROM KhoaHoc WHERE KhoaHocID = ?', [id]);

  res.json({
    success: true,
    message: `Đã xóa khóa học "${existing[0].TenKhoaHoc}" thành công.`
  });
}));

// =============================================================================
// III. QUẢN LÝ LỚP HỌC VÀ LỊCH LỚP (CLASSES & CLASS SCHEDULES)
// Luồng sự kiện chính:
// 1. Quản trị viên mở chức năng quản lý lớp học và lịch lớp.
// 2. Hệ thống hiển thị danh sách lớp học.
// 3. Quản trị viên chọn tạo mới hoặc chỉnh sửa lớp học.
// 4. Nhập/cập nhật khóa học, thời gian, phòng học, sức chứa và trạng thái đăng ký.
// 5. Chọn lưu -> Hệ thống kiểm tra dữ liệu và lịch phòng học.
// 6. Nếu hợp lệ, lưu thông tin lớp học và cập nhật lịch (sinh BuoiHoc).
// 7. Thông báo kết quả.
// Luồng thay thế & Yêu cầu đặc biệt:
// - Kiểm tra sức chứa: Không vượt quá sức chứa tối đa của phòng học.
// - Kiểm tra trùng lịch phòng học: Không được bố trí hai lớp trong cùng phòng có thời gian trùng nhau.
// - Lớp đã có học viên: Hạn chế chỉnh sửa thông tin ảnh hưởng trực tiếp (không giảm sức chứa < số học viên đã có, không đổi khóa học).
// - Transaction rollback khi có lỗi (Luồng ngoại lệ).
// =============================================================================

// 1. GET /api/admin/rooms: Lấy danh sách phòng học
router.get('/rooms', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [rooms] = await db.query(
    'SELECT PhongID AS id, TenPhong AS name, SucChua AS max_capacity, TrangThai AS status, MoTa AS description FROM Phong ORDER BY PhongID ASC'
  );
  res.json({ success: true, data: rooms });
}));

// 2. GET /api/admin/classes: Lấy danh sách lớp học
router.get('/classes', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [classes] = await db.query(`
    SELECT l.LopHocID AS id,
           l.MaLop AS code,
           l.TenLop AS name,
           l.KhoaHocID AS course_id,
           kh.TenKhoaHoc AS course_name,
           kh.ChuyenMonID AS specialty_id,
           COALESCE(cm.TenChuyenMon, 'Chung') AS specialty_name,
           l.PhongID AS room_id,
           p.TenPhong AS room_name,
           p.SucChua AS room_capacity,
           DATE_FORMAT(l.NgayBatDau, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(l.NgayKetThuc, '%Y-%m-%d') AS end_date,
           l.SucChua AS capacity,
           l.TrangThaiDangKy AS registration_status,
           l.CongBo AS is_published,
           l.NgayTao AS created_at,
           COALESCE(s.SoDaDangKy, 0) AS enrolled_count,
           COALESCE(s.SoConTrong, l.SucChua) AS available_slots,
           (SELECT GROUP_CONCAT(DISTINCT tk.HoTen SEPARATOR ', ')
              FROM PhanCongHLV pc
              JOIN HuanLuyenVien hlv ON pc.HuanLuyenVienID = hlv.HuanLuyenVienID
              JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
              JOIN BuoiHoc bh ON pc.BuoiHocID = bh.BuoiHocID
             WHERE bh.LopHocID = l.LopHocID AND pc.TrangThai = 1) AS trainer_names,
           (SELECT COUNT(*) FROM BuoiHoc bh WHERE bh.LopHocID = l.LopHocID) AS total_sessions
      FROM LopHoc l
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
     ORDER BY l.NgayBatDau DESC, l.LopHocID DESC
  `);

  res.json({ success: true, data: classes });
}));

// 3. GET /api/admin/classes/:id: Chi tiết 1 lớp học kèm lịch các buổi và học viên
router.get('/classes/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [classes] = await db.query(`
    SELECT l.LopHocID AS id,
           l.MaLop AS code,
           l.TenLop AS name,
           l.KhoaHocID AS course_id,
           kh.TenKhoaHoc AS course_name,
           kh.ChuyenMonID AS specialty_id,
           COALESCE(cm.TenChuyenMon, 'Chung') AS specialty_name,
           l.PhongID AS room_id,
           p.TenPhong AS room_name,
           p.SucChua AS room_capacity,
           DATE_FORMAT(l.NgayBatDau, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(l.NgayKetThuc, '%Y-%m-%d') AS end_date,
           l.SucChua AS capacity,
           l.TrangThaiDangKy AS registration_status,
           l.CongBo AS is_published,
           COALESCE(s.SoDaDangKy, 0) AS enrolled_count,
           COALESCE(s.SoConTrong, l.SucChua) AS available_slots
      FROM LopHoc l
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
     WHERE l.LopHocID = ?
  `, [id]);

  if (!classes.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học yêu cầu!' });
  }

  // Danh sách buổi học
  const [sessions] = await db.query(`
    SELECT bh.BuoiHocID AS id,
           DATE_FORMAT(bh.NgayHoc, '%Y-%m-%d') AS session_date,
           bh.GioBatDau AS start_time,
           bh.GioKetThuc AS end_time,
           bh.PhongID AS room_id,
           p.TenPhong AS room_name,
           bh.TrangThai AS status,
           bh.GhiChu AS note,
           (SELECT GROUP_CONCAT(CONCAT(tk.HoTen, ' (', CASE WHEN pc.VaiTroGiangDay = 1 THEN 'HLV chính' ELSE 'Trợ giảng' END, ')') SEPARATOR ', ')
              FROM PhanCongHLV pc
              JOIN HuanLuyenVien hlv ON pc.HuanLuyenVienID = hlv.HuanLuyenVienID
              JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
             WHERE pc.BuoiHocID = bh.BuoiHocID AND pc.TrangThai = 1) AS assigned_trainers
      FROM BuoiHoc bh
      JOIN Phong p ON bh.PhongID = p.PhongID
     WHERE bh.LopHocID = ?
     ORDER BY bh.NgayHoc ASC, bh.GioBatDau ASC
  `, [id]);

  // Danh sách học viên đã đăng ký
  const [students] = await db.query(`
    SELECT dk.DangKyID AS enrollment_id,
           dk.KhachHangID AS member_id,
           kh.MaKhachHang AS member_code,
           tk.HoTen AS full_name,
           tk.SoDienThoai AS phone,
           DATE_FORMAT(dk.NgayDangKy, '%Y-%m-%d %H:%i') AS registered_at,
           dk.TrangThai AS status
      FROM DangKyKhoaHoc dk
      JOIN KhachHang kh ON dk.KhachHangID = kh.KhachHangID
      JOIN TaiKhoan tk ON kh.KhachHangID = tk.TaiKhoanID
     WHERE dk.LopHocID = ?
     ORDER BY dk.NgayDangKy DESC
  `, [id]);

  res.json({
    success: true,
    data: {
      classInfo: classes[0],
      sessions,
      students
    }
  });
}));

// Helper kiểm tra định dạng ngày YYYY-MM-DD
function isValidDateString(str) {
  if (!str || typeof str !== 'string') return false;
  const match = str.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return false;
  const d = new Date(str);
  return d instanceof Date && !isNaN(d.getTime());
}

// 4. POST /api/admin/classes: Tạo mới lớp học và lịch học
router.post('/classes', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    name,
    code,
    courseId,
    roomId,
    startDate,
    endDate,
    capacity,
    registrationStatus = 1,
    isPublished = 1,
    daysOfWeek = [2, 4, 6], // Mặc định T2, T4, T6
    startTime = '06:00:00',
    endTime = '07:00:00'
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế)
  const cleanName = String(name || req.body.className || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên lớp học không được để trống!' });
  }

  const cId = Number(courseId);
  const [courseRows] = await db.query('SELECT KhoaHocID, TenKhoaHoc FROM KhoaHoc WHERE KhoaHocID = ?', [cId]);
  if (!courseRows.length) {
    return res.status(400).json({ success: false, message: 'Khóa học được chọn không tồn tại!' });
  }

  const rId = Number(roomId);
  const [roomRows] = await db.query('SELECT PhongID, TenPhong, SucChua, TrangThai FROM Phong WHERE PhongID = ?', [rId]);
  if (!roomRows.length) {
    return res.status(400).json({ success: false, message: 'Phòng học được chọn không tồn tại!' });
  }
  const room = roomRows[0];
  if (room.TrangThai === 0) {
    return res.status(400).json({ success: false, message: `Phòng học "${room.TenPhong}" hiện đang bảo trì hoặc tạm ngưng hoạt động!` });
  }

  // Yêu cầu đặc biệt: Sức chứa lớp không vượt quá sức chứa tối đa của phòng
  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap <= 0) {
    return res.status(400).json({ success: false, message: 'Sức chứa lớp học phải là số nguyên dương lớn hơn 0!' });
  }
  if (cap > room.SucChua) {
    return res.status(400).json({
      success: false,
      message: `Sức chứa lớp học (${cap} học viên) vượt quá sức chứa tối đa cho phép của ${room.TenPhong} (${room.SucChua} người)!`
    });
  }

  // Kiểm tra thời gian bắt đầu và kết thúc
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({ success: false, message: 'Thời gian bắt đầu hoặc kết thúc không đúng định dạng YYYY-MM-DD!' });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return res.status(400).json({ success: false, message: 'Thời gian không hợp lệ: Ngày kết thúc không được sớm hơn ngày bắt đầu!' });
  }

  // Chuẩn hóa khung giờ
  const cleanStart = String(startTime).length === 5 ? `${startTime}:00` : startTime;
  const cleanEnd = String(endTime).length === 5 ? `${endTime}:00` : endTime;
  if (cleanEnd <= cleanStart) {
    return res.status(400).json({ success: false, message: 'Khung giờ học không hợp lệ: Giờ kết thúc phải muộn hơn giờ bắt đầu!' });
  }

  // Yêu cầu đặc biệt & Luồng thay thế: Kiểm tra trùng lịch phòng học
  // Không được bố trí hai lớp trong cùng phòng có thời gian học trùng nhau
  const [roomConflicts] = await db.query(`
    SELECT bh.BuoiHocID, DATE_FORMAT(bh.NgayHoc, '%Y-%m-%d') AS NgayHoc, bh.GioBatDau, bh.GioKetThuc, lh.TenLop, p.TenPhong
      FROM BuoiHoc bh
      JOIN LopHoc lh ON bh.LopHocID = lh.LopHocID
      JOIN Phong p ON bh.PhongID = p.PhongID
     WHERE bh.PhongID = ?
       AND bh.TrangThai = 1
       AND bh.NgayHoc BETWEEN ? AND ?
       AND (bh.GioBatDau < ? AND bh.GioKetThuc > ?)
     LIMIT 1
  `, [rId, startDate, endDate, cleanEnd, cleanStart]);

  if (roomConflicts.length > 0) {
    const cf = roomConflicts[0];
    return res.status(400).json({
      success: false,
      message: `Phòng "${cf.TenPhong}" đã có lớp "${cf.TenLop}" hoạt động trong cùng thời gian vào ngày ${cf.NgayHoc} (${cf.GioBatDau} - ${cf.GioKetThuc})! Vui lòng chọn phòng học hoặc thời gian khác.`
    });
  }

  // Tạo mã lớp tự động nếu không nhập
  const cleanCode = code ? String(code).trim().toUpperCase() : `LH-${Date.now().toString().slice(-6)}`;

  // Luồng ngoại lệ: Sử dụng Transaction
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const regStatus = Number(registrationStatus) === 0 ? 0 : 1;
    const pubStatus = Number(isPublished) === 0 ? 0 : 1;

    // 1. Chèn Lớp học
    const [insClass] = await conn.query(
      `INSERT INTO LopHoc (MaLop, TenLop, KhoaHocID, PhongID, NgayBatDau, NgayKetThuc, SucChua, TrangThaiDangKy, CongBo, NgayTao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [cleanCode, cleanName, cId, rId, startDate, endDate, cap, regStatus, pubStatus]
    );
    const newClassId = insClass.insertId;

    // 2. Tự động sinh lịch các buổi học (BuoiHoc)
    const normalizedDays = Array.isArray(daysOfWeek) ? daysOfWeek.map(Number) : [2, 4, 6];
    const sDate = new Date(startDate);
    const eDate = new Date(endDate);
    let sessionCount = 0;

    for (let d = new Date(sDate); d <= eDate; d.setDate(d.getDate() + 1)) {
      // JS getDay(): 0 = Chủ Nhật, 1 = Thứ 2, 2 = Thứ 3, ..., 6 = Thứ 7
      // Quy ước Việt Nam: Thứ 2 = 2, Thứ 3 = 3, ..., Thứ 7 = 7, CN = 8 hoặc 1
      const jsDay = d.getDay();
      const vnDay = jsDay === 0 ? 8 : jsDay + 1; // 1->2 (T2), 2->3 (T3), ..., 6->7 (T7), 0->8 (CN)

      if (normalizedDays.includes(vnDay) || normalizedDays.includes(jsDay)) {
        sessionCount++;
        const dateStr = d.toISOString().slice(0, 10);
        await conn.query(
          `INSERT INTO BuoiHoc (LopHocID, PhongID, NgayHoc, GioBatDau, GioKetThuc, TrangThai, GhiChu)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [newClassId, rId, dateStr, cleanStart, cleanEnd, `Buổi ${sessionCount}`]
        );
      }
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Đã tạo lớp học "${cleanName}" (${cleanCode}) thành công với ${sessionCount} buổi học dự kiến!`,
      data: {
        id: newClassId,
        code: cleanCode,
        name: cleanName,
        courseId: cId,
        roomId: rId,
        startDate,
        endDate,
        capacity: cap,
        totalSessions: sessionCount,
        registrationStatus: regStatus,
        isPublished: pubStatus
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN CREATE CLASS ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu dữ liệu lớp học: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên cấu hình lớp học trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 5. PUT /api/admin/classes/:id: Cập nhật thông tin lớp học
router.put('/classes/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT * FROM LopHoc WHERE LopHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học cần cập nhật!' });
  }
  const oldClass = existing[0];

  const {
    name,
    courseId,
    roomId,
    startDate,
    endDate,
    capacity,
    registrationStatus,
    isPublished
  } = req.body;

  // Luồng thay thế: Kiểm tra số lượng học viên đã đăng ký
  const [[enrollmentRow]] = await db.query(
    'SELECT COUNT(*) AS total FROM DangKyKhoaHoc WHERE LopHocID = ? AND TrangThai IN (1, 2)',
    [id]
  );
  const enrolledCount = Number(enrollmentRow.total);

  // Nếu lớp đã có học viên đăng ký -> Hạn chế đổi khóa học gốc
  const newCourseId = courseId ? Number(courseId) : oldClass.KhoaHocID;
  if (enrolledCount > 0 && newCourseId !== oldClass.KhoaHocID) {
    return res.status(400).json({
      success: false,
      message: `Lớp học đã có ${enrolledCount} học viên đăng ký chính thức, không thể thay đổi khóa học gốc để tránh sai lệch quyền lợi của học viên!`
    });
  }

  const cleanName = name ? String(name).trim() : oldClass.TenLop;
  const targetRoomId = roomId ? Number(roomId) : oldClass.PhongID;
  const [roomRows] = await db.query('SELECT PhongID, TenPhong, SucChua, TrangThai FROM Phong WHERE PhongID = ?', [targetRoomId]);
  if (!roomRows.length) {
    return res.status(400).json({ success: false, message: 'Phòng học được chọn không tồn tại!' });
  }
  const room = roomRows[0];

  // Kiểm tra sức chứa
  const cap = capacity !== undefined ? Number(capacity) : oldClass.SucChua;
  if (!Number.isInteger(cap) || cap <= 0) {
    return res.status(400).json({ success: false, message: 'Sức chứa lớp học phải là số nguyên dương lớn hơn 0!' });
  }
  if (cap > room.SucChua) {
    return res.status(400).json({
      success: false,
      message: `Sức chứa lớp học (${cap} học viên) vượt quá giới hạn tối đa của ${room.TenPhong} (${room.SucChua} người)!`
    });
  }
  // Luồng thay thế: Nếu lớp đã có học viên, không cho phép giảm sức chứa nhỏ hơn số học viên hiện có
  if (enrolledCount > 0 && cap < enrolledCount) {
    return res.status(400).json({
      success: false,
      message: `Không thể giảm sức chứa xuống ${cap} vì hiện tại lớp đã có ${enrolledCount} học viên đăng ký!`
    });
  }

  const sDate = startDate || oldClass.NgayBatDau;
  const eDate = endDate || oldClass.NgayKetThuc;
  if (new Date(eDate) < new Date(sDate)) {
    return res.status(400).json({ success: false, message: 'Thời gian không hợp lệ: Ngày kết thúc không được sớm hơn ngày bắt đầu!' });
  }

  // Luồng ngoại lệ: Transaction
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const regStatus = registrationStatus !== undefined ? (Number(registrationStatus) === 0 ? 0 : 1) : oldClass.TrangThaiDangKy;
    const pubStatus = isPublished !== undefined ? (Number(isPublished) === 0 ? 0 : 1) : oldClass.CongBo;

    await conn.query(
      `UPDATE LopHoc
          SET TenLop = ?,
              KhoaHocID = ?,
              PhongID = ?,
              NgayBatDau = ?,
              NgayKetThuc = ?,
              SucChua = ?,
              TrangThaiDangKy = ?,
              CongBo = ?
        WHERE LopHocID = ?`,
      [cleanName, newCourseId, targetRoomId, sDate, eDate, cap, regStatus, pubStatus, id]
    );

    // Cập nhật phòng học cho các buổi học chưa diễn ra nếu phòng thay đổi
    if (targetRoomId !== oldClass.PhongID) {
      await conn.query(
        'UPDATE BuoiHoc SET PhongID = ? WHERE LopHocID = ? AND NgayHoc >= CURDATE()',
        [targetRoomId, id]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: `Đã cập nhật lớp học "${cleanName}" thành công!`,
      data: {
        id,
        name: cleanName,
        courseId: newCourseId,
        roomId: targetRoomId,
        startDate: sDate,
        endDate: eDate,
        capacity: cap,
        enrolledCount,
        registrationStatus: regStatus,
        isPublished: pubStatus
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN UPDATE CLASS ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật lớp học: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên cấu hình lớp học trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 6. PATCH /api/admin/classes/:id/status: Bật/tắt trạng thái đăng ký hoặc công bố
router.patch('/classes/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenLop, TrangThaiDangKy, CongBo FROM LopHoc WHERE LopHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học yêu cầu!' });
  }

  const { registrationStatus, isPublished } = req.body;
  const updates = [];
  const params = [];

  if (registrationStatus !== undefined) {
    updates.push('TrangThaiDangKy = ?');
    params.push(Number(registrationStatus) === 0 ? 0 : 1);
  }
  if (isPublished !== undefined) {
    updates.push('CongBo = ?');
    params.push(Number(isPublished) === 0 ? 0 : 1);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'Không có thông tin trạng thái cần cập nhật!' });
  }

  params.push(id);
  await db.query(`UPDATE LopHoc SET ${updates.join(', ')} WHERE LopHocID = ?`, params);

  const [updated] = await db.query('SELECT TrangThaiDangKy, CongBo FROM LopHoc WHERE LopHocID = ?', [id]);
  res.json({
    success: true,
    message: `Đã cập nhật trạng thái lớp học "${existing[0].TenLop}" thành công!`,
    data: {
      id,
      registrationStatus: updated[0].TrangThaiDangKy,
      isPublished: updated[0].CongBo
    }
  });
}));

// 7. DELETE /api/admin/classes/:id: Xóa lớp học (Chặn xóa cứng nếu đã có học viên đăng ký)
router.delete('/classes/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenLop FROM LopHoc WHERE LopHocID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học cần xóa!' });
  }

  // Ràng buộc bảo vệ dữ liệu: Kiểm tra học viên đã đăng ký
  const [[enrollmentRow]] = await db.query(
    'SELECT COUNT(*) AS total FROM DangKyKhoaHoc WHERE LopHocID = ?',
    [id]
  );
  if (Number(enrollmentRow.total) > 0) {
    return res.status(400).json({
      success: false,
      message: `Lớp học "${existing[0].TenLop}" đã có ${enrollmentRow.total} học viên đăng ký, hệ thống không cho phép xóa cứng để bảo vệ lịch sử đăng ký! Quản trị viên vui lòng chuyển sang trạng thái "Đóng đăng ký".`
    });
  }

  // Xóa các buổi học và phân công liên quan trước khi xóa lớp
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM PhanCongHLV WHERE BuoiHocID IN (SELECT BuoiHocID FROM BuoiHoc WHERE LopHocID = ?)', [id]);
    await conn.query('DELETE FROM BuoiHoc WHERE LopHocID = ?', [id]);
    await conn.query('DELETE FROM LopHoc WHERE LopHocID = ?', [id]);
    await conn.commit();

    res.json({
      success: true,
      message: `Đã xóa lớp học "${existing[0].TenLop}" và các buổi học liên quan thành công.`
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Lỗi khi xóa lớp học: ' + error.message });
  } finally {
    conn.release();
  }
}));


// =============================================================================
// IV. PHÂN CÔNG HUẤN LUYỆN VIÊN (TRAINER ASSIGNMENT)
// Luồng sự kiện chính:
// 1. Quản trị viên mở chức năng phân công huấn luyện viên.
// 2. Hệ thống hiển thị danh sách lớp học và buổi học cần phân công.
// 3. Quản trị viên chọn lớp học hoặc buổi học.
// 4. Hệ thống hiển thị danh sách huấn luyện viên.
// 5. Chọn huấn luyện viên phụ trách và xác nhận phân công.
// 6. Kiểm tra trạng thái hoạt động, chuyên môn và lịch làm việc của HLV.
// 7. Nếu hợp lệ, lưu thông tin phân công và cập nhật lịch dạy.
// 8. Thông báo kết quả.
// Luồng thay thế & Yêu cầu đặc biệt:
// - Chỉ phân công huấn luyện viên ĐANG HOẠT ĐỘNG (TrangThai = 1).
// - Huấn luyện viên phải CÓ CHUYÊN MÔN PHÙ HỢP với môn học của khóa học.
// - KHÔNG BỊ TRÙNG LỊCH DẠY với buổi học khác trong cùng khung giờ.
// =============================================================================

// 1. GET /api/admin/trainers: Lấy danh sách HLV kèm chuyên môn và trạng thái
router.get('/trainers', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [trainers] = await db.query(`
    SELECT hlv.HuanLuyenVienID AS id,
           hlv.MaHLV AS code,
           tk.HoTen AS full_name,
           tk.Email AS email,
           tk.SoDienThoai AS phone,
           hlv.KinhNghiemNam AS experience_years,
           hlv.TieuSu AS biography,
           tk.TrangThai AS status,
           GROUP_CONCAT(DISTINCT cm.TenChuyenMon SEPARATOR ', ') AS specialties,
           GROUP_CONCAT(DISTINCT cm.ChuyenMonID) AS specialty_ids,
           (SELECT COUNT(DISTINCT bh.LopHocID)
              FROM PhanCongHLV pc
              JOIN BuoiHoc bh ON pc.BuoiHocID = bh.BuoiHocID
             WHERE pc.HuanLuyenVienID = hlv.HuanLuyenVienID AND pc.TrangThai = 1) AS assigned_classes_count
      FROM HuanLuyenVien hlv
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
      LEFT JOIN HLV_ChuyenMon hcm ON hlv.HuanLuyenVienID = hcm.HuanLuyenVienID
      LEFT JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
     GROUP BY hlv.HuanLuyenVienID
     ORDER BY tk.TrangThai DESC, tk.HoTen ASC
  `);

  res.json({ success: true, data: trainers });
}));

// 2. GET /api/admin/assignments: Lấy danh sách phân công HLV hiện tại
router.get('/assignments', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [assignments] = await db.query(`
    SELECT pc.PhanCongID AS assignment_id,
           pc.BuoiHocID AS session_id,
           bh.LopHocID AS class_id,
           lh.TenLop AS class_name,
           kh.TenKhoaHoc AS course_name,
           cm.TenChuyenMon AS specialty_name,
           DATE_FORMAT(bh.NgayHoc, '%Y-%m-%d') AS session_date,
           bh.GioBatDau AS start_time,
           bh.GioKetThuc AS end_time,
           p.TenPhong AS room_name,
           hlv.HuanLuyenVienID AS trainer_id,
           hlv.MaHLV AS trainer_code,
           tk.HoTen AS trainer_name,
           pc.VaiTroGiangDay AS teaching_role,
           pc.TrangThai AS status,
           DATE_FORMAT(pc.NgayPhanCong, '%Y-%m-%d %H:%i') AS assigned_at
      FROM PhanCongHLV pc
      JOIN BuoiHoc bh ON pc.BuoiHocID = bh.BuoiHocID
      JOIN LopHoc lh ON bh.LopHocID = lh.LopHocID
      JOIN KhoaHoc kh ON lh.KhoaHocID = kh.KhoaHocID
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      JOIN Phong p ON bh.PhongID = p.PhongID
      JOIN HuanLuyenVien hlv ON pc.HuanLuyenVienID = hlv.HuanLuyenVienID
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
     WHERE pc.TrangThai = 1
     ORDER BY bh.NgayHoc DESC, bh.GioBatDau ASC
  `);

  res.json({ success: true, data: assignments });
}));

// 3. POST /api/admin/assignments: Phân công HLV cho lớp học hoặc buổi học
router.post('/assignments', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    classId,
    trainerId,
    sessionId, // Nếu có thì phân công buổi này, nếu không thì phân công toàn bộ buổi của lớp
    teachingRole = 1 // 1: HLV chính, 2: Trợ giảng
  } = req.body;

  const cId = Number(classId);
  const tId = Number(trainerId);
  if (!cId || !tId) {
    return res.status(400).json({ success: false, message: 'Vui lòng chọn đầy đủ lớp học và huấn luyện viên!' });
  }

  // 1. Kiểm tra lớp học và khóa học
  const [classRows] = await db.query(`
    SELECT lh.LopHocID, lh.TenLop, kh.KhoaHocID, kh.TenKhoaHoc, kh.ChuyenMonID, cm.TenChuyenMon
      FROM LopHoc lh
      JOIN KhoaHoc kh ON lh.KhoaHocID = kh.KhoaHocID
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
     WHERE lh.LopHocID = ?
  `, [cId]);

  if (!classRows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy lớp học yêu cầu!' });
  }
  const classItem = classRows[0];

  // 2. Yêu cầu đặc biệt: Kiểm tra trạng thái hoạt động của Huấn luyện viên
  const [trainerRows] = await db.query(`
    SELECT hlv.HuanLuyenVienID, hlv.MaHLV, tk.HoTen, tk.TrangThai
      FROM HuanLuyenVien hlv
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
     WHERE hlv.HuanLuyenVienID = ?
  `, [tId]);

  if (!trainerRows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy huấn luyện viên được chọn!' });
  }
  const trainer = trainerRows[0];
  if (trainer.TrangThai !== 1) {
    return res.status(400).json({
      success: false,
      message: `Huấn luyện viên "${trainer.HoTen}" hiện không hoạt động hoặc tài khoản đang bị khóa, không thể phân công!`
    });
  }

  // 3. Yêu cầu đặc biệt & Luồng thay thế: Kiểm tra chuyên môn của Huấn luyện viên
  if (classItem.ChuyenMonID) {
    const [specMatch] = await db.query(
      'SELECT * FROM HLV_ChuyenMon WHERE HuanLuyenVienID = ? AND ChuyenMonID = ?',
      [tId, classItem.ChuyenMonID]
    );
    if (!specMatch.length) {
      return res.status(400).json({
        success: false,
        message: `Huấn luyện viên "${trainer.HoTen}" không có chuyên môn phù hợp với môn học "${classItem.TenChuyenMon || classItem.TenKhoaHoc}"! Vui lòng chọn huấn luyện viên có chuyên môn phù hợp.`
      });
    }
  }

  // 4. Lấy danh sách các buổi học cần phân công
  let targetSessions = [];
  if (sessionId) {
    const [sess] = await db.query(
      'SELECT BuoiHocID, DATE_FORMAT(NgayHoc, "%Y-%m-%d") AS NgayHoc, GioBatDau, GioKetThuc FROM BuoiHoc WHERE BuoiHocID = ? AND LopHocID = ?',
      [Number(sessionId), cId]
    );
    if (!sess.length) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy buổi học thuộc lớp này!' });
    }
    targetSessions = sess;
  } else {
    const [allSess] = await db.query(
      'SELECT BuoiHocID, DATE_FORMAT(NgayHoc, "%Y-%m-%d") AS NgayHoc, GioBatDau, GioKetThuc FROM BuoiHoc WHERE LopHocID = ? ORDER BY NgayHoc ASC',
      [cId]
    );
    if (!allSess.length) {
      return res.status(400).json({ success: false, message: 'Lớp học này chưa có lịch các buổi học để phân công!' });
    }
    targetSessions = allSess;
  }

  // 5. Yêu cầu đặc biệt & Luồng thay thế: Kiểm tra trùng lịch dạy của Huấn luyện viên
  for (const s of targetSessions) {
    const [conflict] = await db.query(`
      SELECT bh.BuoiHocID, DATE_FORMAT(bh.NgayHoc, '%Y-%m-%d') AS NgayHoc, bh.GioBatDau, bh.GioKetThuc, lh.TenLop
        FROM PhanCongHLV pc
        JOIN BuoiHoc bh ON pc.BuoiHocID = bh.BuoiHocID
        JOIN LopHoc lh ON bh.LopHocID = lh.LopHocID
       WHERE pc.HuanLuyenVienID = ?
         AND pc.TrangThai = 1
         AND bh.LopHocID != ?
         AND bh.NgayHoc = ?
         AND (bh.GioBatDau < ? AND bh.GioKetThuc > ?)
       LIMIT 1
    `, [tId, cId, s.NgayHoc, s.GioKetThuc, s.GioBatDau]);

    if (conflict.length > 0) {
      const cf = conflict[0];
      return res.status(400).json({
        success: false,
        message: `Huấn luyện viên "${trainer.HoTen}" bị trùng lịch dạy vào ngày ${cf.NgayHoc} (${cf.GioBatDau} - ${cf.GioKetThuc}) tại lớp "${cf.TenLop}"! Vui lòng chọn huấn luyện viên khác.`
      });
    }
  }

  // 6. Lưu phân công vào database (Luồng ngoại lệ: Transaction)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const roleNum = Number(teachingRole) === 2 ? 2 : 1;
    const adminId = admin.TaiKhoanID || 1;

    for (const s of targetSessions) {
      // Hủy phân công cũ của buổi này cho vai trò tương ứng nếu có
      await conn.query(
        'DELETE FROM PhanCongHLV WHERE BuoiHocID = ? AND VaiTroGiangDay = ?',
        [s.BuoiHocID, roleNum]
      );

      // Thêm phân công mới
      await conn.query(
        `INSERT INTO PhanCongHLV (BuoiHocID, HuanLuyenVienID, VaiTroGiangDay, NguoiPhanCongID, NgayPhanCong, TrangThai)
         VALUES (?, ?, ?, ?, NOW(), 1)`,
        [s.BuoiHocID, tId, roleNum, adminId]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: `Đã phân công huấn luyện viên "${trainer.HoTen}" phụ trách ${targetSessions.length} buổi học của lớp "${classItem.TenLop}" thành công!`,
      data: {
        trainerId: tId,
        trainerName: trainer.HoTen,
        classId: cId,
        className: classItem.TenLop,
        specialty: classItem.TenChuyenMon,
        sessionsCount: targetSessions.length,
        role: roleNum === 1 ? 'HLV chính' : 'Trợ giảng'
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN ASSIGN TRAINER ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu phân công huấn luyện viên: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên thông tin phân công trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 4. DELETE /api/admin/assignments/:id: Hủy 1 phân công
router.delete('/assignments/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT PhanCongID FROM PhanCongHLV WHERE PhanCongID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy phân công yêu cầu!' });
  }

  await db.query('DELETE FROM PhanCongHLV WHERE PhanCongID = ?', [id]);
  res.json({ success: true, message: 'Đã hủy phân công thành công.' });
}));


// =============================================================================
// V. QUẢN LÝ DANH MỤC SẢN PHẨM CỬA HÀNG (PRODUCTS & CATEGORIES)
// Luồng sự kiện chính:
// 1. Quản trị viên mở chức năng quản lý danh mục sản phẩm.
// 2. Hệ thống hiển thị danh sách sản phẩm.
// 3. Quản trị viên chọn thêm mới, chỉnh sửa hoặc ngừng kinh doanh sản phẩm.
// 4. Quản trị viên nhập/cập nhật tên, giá và số lượng sản phẩm.
// 5. Quản trị viên chọn lưu thông tin -> Kiểm tra dữ liệu.
// 6. Nếu hợp lệ, lưu hoặc cập nhật thông tin sản phẩm.
// 7. Thông báo kết quả thành công.
// Luồng thay thế & Yêu cầu đặc biệt:
// - Giá sản phẩm phải hợp lệ (>= 0), số lượng KHÔNG ĐƯỢC ÂM (>= 0).
// - Sản phẩm ngừng kinh doanh không được hiển thị như sản phẩm đang kinh doanh.
// - Chặn xóa cứng nếu đã có hóa đơn bán hàng liên quan.
// =============================================================================

// 1. GET /api/admin/products/categories: Danh sách danh mục sản phẩm
router.get('/products/categories', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [categories] = await db.query(
    'SELECT DanhMucID AS id, TenDanhMuc AS name, MoTa AS description, TrangThai AS status FROM DanhMucSanPham ORDER BY DanhMucID ASC'
  );
  res.json({ success: true, data: categories });
}));

// 2. GET /api/admin/products: Danh sách sản phẩm
router.get('/products', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const { categoryId, status } = req.query;
  const conditions = [];
  const params = [];

  if (categoryId) {
    conditions.push('sp.DanhMucID = ?');
    params.push(Number(categoryId));
  }
  if (status !== undefined && status !== 'all') {
    conditions.push('sp.TrangThai = ?');
    params.push(Number(status));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [products] = await db.query(`
    SELECT sp.SanPhamID AS id,
           sp.MaSanPham AS code,
           sp.TenSanPham AS name,
           sp.MoTa AS description,
           sp.DanhMucID AS category_id,
           COALESCE(dm.TenDanhMuc, 'Khác') AS category_name,
           sp.Gia AS price,
           sp.SoLuongTon AS stock_quantity,
           sp.TrangThai AS status,
           DATE_FORMAT(sp.NgayTao, '%Y-%m-%d %H:%i') AS created_at,
           DATE_FORMAT(sp.NgayCapNhat, '%Y-%m-%d %H:%i') AS updated_at,
           (SELECT COUNT(*) FROM ChiTietHoaDon ct WHERE ct.SanPhamID = sp.SanPhamID) AS sales_count
      FROM SanPham sp
      LEFT JOIN DanhMucSanPham dm ON sp.DanhMucID = dm.DanhMucID
      ${whereClause}
     ORDER BY sp.TrangThai DESC, sp.SanPhamID DESC
  `, params);

  res.json({ success: true, data: products });
}));

// 3. GET /api/admin/products/:id: Chi tiết sản phẩm
router.get('/products/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [rows] = await db.query(`
    SELECT sp.SanPhamID AS id,
           sp.MaSanPham AS code,
           sp.TenSanPham AS name,
           sp.MoTa AS description,
           sp.DanhMucID AS category_id,
           COALESCE(dm.TenDanhMuc, 'Khác') AS category_name,
           sp.Gia AS price,
           sp.SoLuongTon AS stock_quantity,
           sp.TrangThai AS status
      FROM SanPham sp
      LEFT JOIN DanhMucSanPham dm ON sp.DanhMucID = dm.DanhMucID
     WHERE sp.SanPhamID = ?
  `, [id]);

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm yêu cầu!' });
  }

  res.json({ success: true, data: rows[0] });
}));

// 4. POST /api/admin/products: Thêm mới sản phẩm
router.post('/products', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    name,
    code,
    categoryId = 1,
    price,
    stock = 0,
    description,
    status = 1
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế & Yêu cầu đặc biệt)
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên sản phẩm không được để trống!' });
  }

  const priceNum = Number(price);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({
      success: false,
      message: 'Giá sản phẩm không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.'
    });
  }

  const stockNum = Number(stock);
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    return res.status(400).json({
      success: false,
      message: 'Số lượng sản phẩm không hợp lệ! Số lượng tồn kho không được âm và phải là số nguyên (>= 0).'
    });
  }

  const catId = Number(categoryId) || 1;
  const cleanCode = code ? String(code).trim().toUpperCase() : `SP-${Date.now().toString().slice(-6)}`;

  // Kiểm tra trùng mã sản phẩm
  const [dupCode] = await db.query('SELECT SanPhamID FROM SanPham WHERE MaSanPham = ?', [cleanCode]);
  if (dupCode.length > 0) {
    return res.status(400).json({ success: false, message: `Mã sản phẩm "${cleanCode}" đã tồn tại!` });
  }

  // 2. Lưu sản phẩm với Transaction (Luồng ngoại lệ)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const finalStatus = Number(status) === 0 ? 0 : 1;
    const [ins] = await conn.query(
      `INSERT INTO SanPham (MaSanPham, TenSanPham, MoTa, DanhMucID, Gia, SoLuongTon, TrangThai, NgayTao)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [cleanCode, cleanName, description ? String(description).trim() : null, catId, priceNum, stockNum, finalStatus]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Đã thêm mới sản phẩm "${cleanName}" (${cleanCode}) thành công!`,
      data: {
        id: ins.insertId,
        code: cleanCode,
        name: cleanName,
        price: priceNum,
        stock: stockNum,
        status: finalStatus
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN CREATE PRODUCT ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi lưu sản phẩm: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên dữ liệu sản phẩm trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 5. PUT /api/admin/products/:id: Chỉnh sửa thông tin sản phẩm
router.put('/products/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT * FROM SanPham WHERE SanPhamID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần cập nhật!' });
  }
  const oldProduct = existing[0];

  const {
    name,
    categoryId,
    price,
    stock,
    description,
    status
  } = req.body;

  const cleanName = name ? String(name).trim() : oldProduct.TenSanPham;
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Tên sản phẩm không được để trống!' });
  }

  const priceNum = price !== undefined ? Number(price) : Number(oldProduct.Gia);
  if (isNaN(priceNum) || priceNum < 0) {
    return res.status(400).json({ success: false, message: 'Giá sản phẩm không hợp lệ! Giá phải là số lớn hơn hoặc bằng 0.' });
  }

  const stockNum = stock !== undefined ? Number(stock) : oldProduct.SoLuongTon;
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    return res.status(400).json({ success: false, message: 'Số lượng tồn kho không hợp lệ! Số lượng không được âm (>= 0).' });
  }

  const finalStatus = status !== undefined ? (Number(status) === 0 ? 0 : 1) : oldProduct.TrangThai;
  const catId = categoryId !== undefined ? Number(categoryId) : oldProduct.DanhMucID;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE SanPham
          SET TenSanPham = ?,
              MoTa = ?,
              DanhMucID = ?,
              Gia = ?,
              SoLuongTon = ?,
              TrangThai = ?,
              NgayCapNhat = NOW()
        WHERE SanPhamID = ?`,
      [cleanName, description !== undefined ? String(description).trim() : oldProduct.MoTa, catId, priceNum, stockNum, finalStatus, id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Đã cập nhật sản phẩm "${cleanName}" thành công!`,
      data: {
        id,
        name: cleanName,
        price: priceNum,
        stock: stockNum,
        status: finalStatus
      }
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({
      success: false,
      message: 'Lỗi khi cập nhật sản phẩm: ' + error.message,
      detail: 'Hệ thống đã giữ nguyên dữ liệu sản phẩm trước đó.'
    });
  } finally {
    conn.release();
  }
}));

// 6. PATCH /api/admin/products/:id/status: Ngừng kinh doanh hoặc mở lại kinh doanh sản phẩm
router.patch('/products/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenSanPham, TrangThai FROM SanPham WHERE SanPhamID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm yêu cầu!' });
  }

  const newStatus = Number(req.body.status) === 1 ? 1 : 0;
  await db.query('UPDATE SanPham SET TrangThai = ?, NgayCapNhat = NOW() WHERE SanPhamID = ?', [newStatus, id]);

  const statusText = newStatus === 1 ? 'Đang kinh doanh' : 'Ngừng kinh doanh';
  res.json({
    success: true,
    message: `Đã cập nhật trạng thái sản phẩm "${existing[0].TenSanPham}" sang "${statusText}"!`,
    data: { id, status: newStatus }
  });
}));

// 7. DELETE /api/admin/products/:id: Xóa sản phẩm (Ràng buộc: chặn nếu đã có trong hóa đơn)
router.delete('/products/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TenSanPham FROM SanPham WHERE SanPhamID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm cần xóa!' });
  }

  const [[salesRow]] = await db.query('SELECT COUNT(*) AS total FROM ChiTietHoaDon WHERE SanPhamID = ?', [id]);
  if (Number(salesRow.total) > 0) {
    return res.status(400).json({
      success: false,
      message: `Sản phẩm "${existing[0].TenSanPham}" đã phát sinh trong ${salesRow.total} đơn hàng của khách, hệ thống không cho phép xóa cứng để bảo vệ lịch sử hóa đơn! Bạn vui lòng chuyển sản phẩm sang trạng thái "Ngừng kinh doanh".`
    });
  }

  await db.query('DELETE FROM SanPham WHERE SanPhamID = ?', [id]);
  res.json({ success: true, message: `Đã xóa sản phẩm "${existing[0].TenSanPham}" thành công.` });
}));


// =============================================================================
// VI. QUẢN LÝ THÔNG BÁO HỆ THỐNG (SYSTEM NOTIFICATIONS)
// Luồng sự kiện chính:
// 1. Quản trị viên mở chức năng quản lý thông báo.
// 2. Hệ thống hiển thị giao diện quản lý thông báo.
// 3. Soạn nội dung thông báo (tiêu đề, nội dung).
// 4. Chọn nhóm người nhận và thời gian gửi (gửi ngay hoặc lên lịch).
// 5. Xác nhận phát hành -> Kiểm tra quyền và tính hợp lệ.
// 6. Lưu thông báo và phân phối đến nhóm người nhận đã chọn.
// 7. Thông báo kết quả xử lý.
// Luồng thay thế & Yêu cầu đặc biệt:
// - Thông báo phải xác định rõ nhóm người nhận và thời gian gửi.
// - Không chứa nội dung nhạy cảm.
// - Nếu đã gửi, việc chỉnh sửa được lưu vết.
// =============================================================================

// 1. GET /api/admin/notifications: Lấy danh sách thông báo hệ thống
router.get('/notifications', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [notifications] = await db.query(`
    SELECT tb.ThongBaoID AS id,
           tb.TieuDe AS title,
           tb.NoiDung AS content,
           tb.NhomNguoiNhan AS recipient_group,
           CASE tb.NhomNguoiNhan
             WHEN 1 THEN 'Tất cả mọi người'
             WHEN 2 THEN 'Ban quản trị & Nhân viên'
             WHEN 3 THEN 'Huấn luyện viên'
             WHEN 4 THEN 'Khách hàng / Hội viên'
             ELSE 'Khác'
           END AS recipient_group_name,
           DATE_FORMAT(tb.ThoiGianGui, '%Y-%m-%d %H:%i') AS sent_at,
           tb.TrangThai AS status,
           CASE tb.TrangThai
             WHEN 1 THEN 'Bản nháp'
             WHEN 2 THEN 'Đã lên lịch'
             WHEN 3 THEN 'Đã phát hành'
             WHEN 0 THEN 'Đã hủy'
             ELSE 'Không xác định'
           END AS status_name,
           DATE_FORMAT(tb.NgayTao, '%Y-%m-%d %H:%i') AS created_at,
           (SELECT COUNT(*) FROM ThongBaoNguoiNhan nn WHERE nn.ThongBaoID = tb.ThongBaoID) AS total_recipients,
           (SELECT COUNT(*) FROM ThongBaoNguoiNhan nn WHERE nn.ThongBaoID = tb.ThongBaoID AND nn.DaDoc = 1) AS read_count
      FROM ThongBao tb
     ORDER BY tb.ThongBaoID DESC
  `);

  res.json({ success: true, data: notifications });
}));

// 2. POST /api/admin/notifications: Soạn và phát hành thông báo
router.post('/notifications', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    title,
    content,
    recipientGroup = 1, // 1: Tất cả, 2: Staff/Admin, 3: HLV, 4: Hội viên
    scheduledTime,
    publishNow = true
  } = req.body;

  // 1. Kiểm tra tính hợp lệ dữ liệu (Luồng thay thế & Yêu cầu đặc biệt)
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();

  if (!cleanTitle) {
    return res.status(400).json({ success: false, message: 'Tiêu đề thông báo không được để trống!' });
  }
  if (!cleanContent) {
    return res.status(400).json({ success: false, message: 'Nội dung thông báo không được để trống!' });
  }

  const groupNum = Number(recipientGroup);
  if (![1, 2, 3, 4].includes(groupNum)) {
    return res.status(400).json({ success: false, message: 'Vui lòng xác định rõ nhóm người nhận hợp lệ (1: Tất cả, 2: Nhân viên, 3: HLV, 4: Khách hàng)!' });
  }

  // Yêu cầu đặc biệt: Kiểm tra nội dung nhạy cảm cơ bản
  const sensitiveWords = ['lừa đảo', 'hack', 'mã độc', 'trojan', 'password reset bypass'];
  const hasSensitive = sensitiveWords.some(w => cleanTitle.toLowerCase().includes(w) || cleanContent.toLowerCase().includes(w));
  if (hasSensitive) {
    return res.status(400).json({ success: false, message: 'Nội dung thông báo chứa từ ngữ nhạy cảm hoặc không an toàn!' });
  }

  // Kiểm tra thời gian gửi
  let sendTime = 'NOW()';
  let status = 3; // 3: Đã phát hành

  if (!publishNow && scheduledTime) {
    const schedDate = new Date(scheduledTime);
    if (isNaN(schedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Thời gian lên lịch gửi không đúng định dạng!' });
    }
    if (schedDate < new Date()) {
      return res.status(400).json({ success: false, message: 'Thời gian lên lịch gửi không hợp lệ: Không được chọn thời gian trong quá khứ!' });
    }
    sendTime = schedDate;
    status = 2; // 2: Đã lên lịch
  }

  // Phân phối thông báo (Luồng ngoại lệ: Transaction)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const adminId = admin.TaiKhoanID || 1;

    let ins;
    if (status === 2) {
      [ins] = await conn.query(
        `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai, NgayTao)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [cleanTitle, cleanContent, groupNum, adminId, sendTime, status]
      );
    } else {
      [ins] = await conn.query(
        `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai, NgayTao)
         VALUES (?, ?, ?, ?, NOW(), 3, NOW())`,
        [cleanTitle, cleanContent, groupNum, adminId]
      );
    }
    const notifId = ins.insertId;

    // Nếu phát hành ngay -> Phân phối tới các tài khoản thuộc nhóm người nhận
    let recipientCount = 0;
    if (status === 3) {
      let roleCondition = '';
      if (groupNum === 1) roleCondition = 'WHERE TrangThai = 1'; // Tất cả
      else if (groupNum === 2) roleCondition = 'WHERE VaiTroID IN (1, 2) AND TrangThai = 1'; // Admin & Nhân viên
      else if (groupNum === 3) roleCondition = 'WHERE VaiTroID = 3 AND TrangThai = 1'; // HLV
      else if (groupNum === 4) roleCondition = 'WHERE VaiTroID = 4 AND TrangThai = 1'; // Khách hàng

      const [recipients] = await conn.query(`SELECT TaiKhoanID FROM TaiKhoan ${roleCondition}`);
      if (recipients.length > 0) {
        const values = recipients.map(r => [notifId, r.TaiKhoanID, 0]);
        await conn.query(
          'INSERT IGNORE INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES ?',
          [values]
        );
        recipientCount = recipients.length;
      }
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: status === 3
        ? `Đã phát hành thông báo "${cleanTitle}" và phân phối đến ${recipientCount} người nhận thành công!`
        : `Đã lên lịch phát hành thông báo "${cleanTitle}" thành công!`,
      data: {
        id: notifId,
        title: cleanTitle,
        recipientGroup: groupNum,
        status,
        recipientCount
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN NOTIFICATION ERROR]', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi gửi thông báo: ' + error.message,
      detail: 'Hệ thống đã ghi nhận trạng thái gửi thất bại để quản trị viên xử lý.'
    });
  } finally {
    conn.release();
  }
}));

// 3. PUT /api/admin/notifications/:id: Chỉnh sửa thông báo (Có lưu vết nếu đã phát hành)
router.put('/notifications/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT * FROM ThongBao WHERE ThongBaoID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo cần cập nhật!' });
  }
  const notif = existing[0];

  const { title, content } = req.body;
  const cleanTitle = title ? String(title).trim() : notif.TieuDe;
  let cleanContent = content ? String(content).trim() : notif.NoiDung;

  // Luồng thay thế: Nếu thông báo đã được gửi (status = 3), việc chỉnh sửa được lưu vết
  if (notif.TrangThai === 3 && content && cleanContent !== notif.NoiDung) {
    const editStamp = `\n\n*(Thông báo đã được Quản trị viên cập nhật lúc ${new Date().toLocaleString('vi-VN')})*`;
    if (!cleanContent.includes('*(Thông báo đã được Quản trị viên cập nhật')) {
      cleanContent += editStamp;
    }
  }

  await db.query(
    'UPDATE ThongBao SET TieuDe = ?, NoiDung = ?, NgayCapNhat = NOW() WHERE ThongBaoID = ?',
    [cleanTitle, cleanContent, id]
  );

  res.json({
    success: true,
    message: 'Đã cập nhật thông báo thành công (đã ghi nhận lưu vết)!',
    data: { id, title: cleanTitle, content: cleanContent }
  });
}));

// 4. PATCH /api/admin/notifications/:id/status: Ngừng phát hành hoặc hủy thông báo
router.patch('/notifications/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [existing] = await db.query('SELECT TieuDe, TrangThai FROM ThongBao WHERE ThongBaoID = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo!' });
  }

  const rawStatus = Number(req.body.status);
  // Map: 0 hoặc 4 -> 4 (Ngừng phát hành), 5 -> 5 (Đã hủy), 1 -> 1 (Bản nháp), 2 -> 2 (Lên lịch), 3 -> 3 (Đã gửi)
  let newStatus = 4;
  if ([1, 2, 3, 4, 5].includes(rawStatus)) {
    newStatus = rawStatus;
  } else if (rawStatus === 0) {
    newStatus = 4;
  }
  await db.query('UPDATE ThongBao SET TrangThai = ?, NgayCapNhat = NOW() WHERE ThongBaoID = ?', [newStatus, id]);

  const statusName = newStatus === 4 ? 'Ngừng phát hành' : (newStatus === 5 ? 'Đã hủy' : 'Đã cập nhật');
  res.json({
    success: true,
    message: `Đã cập nhật trạng thái thông báo "${existing[0].TieuDe}" sang "${statusName}" thành công!`,
    data: { id, status: newStatus }
  });
}));

// 5. DELETE /api/admin/notifications/:id: Xóa thông báo
router.delete('/notifications/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM ThongBaoNguoiNhan WHERE ThongBaoID = ?', [id]);
    await conn.query('DELETE FROM ThongBao WHERE ThongBaoID = ?', [id]);
    await conn.commit();

    res.json({ success: true, message: 'Đã xóa thông báo thành công.' });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ success: false, message: 'Lỗi khi xóa thông báo: ' + error.message });
  } finally {
    conn.release();
  }
}));


// =============================================================================
// VII. BÁO CÁO VÀ THỐNG KÊ HOẠT ĐỘNG (REPORTS & STATISTICS)
// Luồng sự kiện chính:
// 1. Quản trị viên mở báo cáo.
// 2. Chọn loại báo cáo và thời gian.
// 3. Hệ thống tổng hợp dữ liệu.
// 4. Hiển thị số liệu/bảng/biểu đồ.
// 5. Quản trị viên có thể xuất báo cáo.
// Luồng thay thế & Yêu cầu đặc biệt:
// - CHỈ QUẢN TRỊ VIÊN ĐƯỢC TRUY CẬP báo cáo tổng hợp.
// - DOANH THU CHỈ TÍNH GIAO DỊCH ĐÃ XÁC NHẬN (TrangThai = 2).
// - Nếu không có dữ liệu, hiển thị kết quả bằng 0 hoặc danh sách trống có giải thích.
// =============================================================================

// 1. GET /api/admin/reports/summary: Báo cáo tổng hợp số liệu KPI toàn trung tâm
router.get('/reports/summary', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const { from, to, fromDate, toDate } = req.query;
  const startDate = from || fromDate || null;
  const endDate = to || toDate || null;

  let revSql = 'SELECT COALESCE(SUM(TongTien), 0) AS total_revenue FROM HoaDon WHERE TrangThai = 2';
  let revParams = [];
  if (startDate && endDate) {
    revSql += ' AND DATE(NgayThanhToan) BETWEEN ? AND ?';
    revParams = [startDate, endDate];
  }
  const [[revRow]] = await db.query(revSql, revParams);

  // Hội viên mới trong kỳ lọc
  let memSql = 'SELECT COUNT(*) AS new_members FROM KhachHang k JOIN TaiKhoan t ON k.KhachHangID = t.TaiKhoanID';
  let memParams = [];
  if (startDate && endDate) {
    memSql += ' WHERE DATE(t.NgayTao) BETWEEN ? AND ?';
    memParams = [startDate, endDate];
  }
  const [[newMemRow]] = await db.query(memSql, memParams);

  // Lượt đăng ký lớp trong kỳ
  let enrollSql = 'SELECT COUNT(*) AS class_enrollments FROM DangKyKhoaHoc';
  let enrollParams = [];
  if (startDate && endDate) {
    enrollSql += ' WHERE DATE(NgayDangKy) BETWEEN ? AND ?';
    enrollParams = [startDate, endDate];
  }
  const [[enrollRow]] = await db.query(enrollSql, enrollParams);

  // Lượt điểm danh trong kỳ
  let checkinSql = 'SELECT COUNT(*) AS checkins FROM DiemDanh';
  let checkinParams = [];
  if (startDate && endDate) {
    checkinSql += ' WHERE DATE(ThoiGian) BETWEEN ? AND ?';
    checkinParams = [startDate, endDate];
  }
  const [[checkinRow]] = await db.query(checkinSql, checkinParams);

  // Tổng hội viên đang hoạt động
  const [[activeMemRow]] = await db.query(
    'SELECT COUNT(*) AS active_members FROM TaiKhoan WHERE VaiTroID = 4 AND TrangThai = 1'
  );

  // Số lượng lớp học đang mở đăng ký
  const [[classRow]] = await db.query(
    'SELECT COUNT(*) AS open_classes FROM LopHoc WHERE TrangThaiDangKy = 1'
  );

  // Tỷ lệ lấp đầy phòng học & lớp học trung bình
  const [[occRow]] = await db.query(`
    SELECT COALESCE(SUM(SoDaDangKy), 0) AS total_enrolled,
           COALESCE(SUM(SucChua), 1) AS total_capacity
      FROM vw_SiSoLop
  `);
  const enrolled = Number(occRow.total_enrolled);
  const capacity = Number(occRow.total_capacity) || 1;
  const occupancyRate = Math.round((enrolled / capacity) * 100);

  // Doanh thu tháng hiện tại
  const [[curMonthRev]] = await db.query(`
    SELECT COALESCE(SUM(TongTien), 0) AS current_month_revenue
      FROM HoaDon
     WHERE TrangThai = 2
       AND MONTH(NgayThanhToan) = MONTH(CURRENT_DATE())
       AND YEAR(NgayThanhToan) = YEAR(CURRENT_DATE())
  `);

  res.json({
    success: true,
    data: {
      totalRevenue: Number(revRow.total_revenue),
      currentMonthRevenue: Number(curMonthRev.current_month_revenue),
      newMembers: Number(newMemRow.new_members),
      classEnrollments: Number(enrollRow.class_enrollments),
      checkins: Number(checkinRow.checkins),
      activeMembers: Number(activeMemRow.active_members),
      openClasses: Number(classRow.open_classes),
      occupancyRate: Math.min(100, occupancyRate)
    }
  });
}));

// 2. GET /api/admin/reports/revenue: Báo cáo doanh thu chi tiết theo thời gian
router.get('/reports/revenue', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const { fromDate, toDate } = req.query;
  const conditions = ['hd.TrangThai = 2']; // Yêu cầu đặc biệt: Chỉ giao dịch đã xác nhận
  const params = [];

  if (fromDate && isValidDateString(fromDate)) {
    conditions.push('DATE(hd.NgayThanhToan) >= ?');
    params.push(fromDate);
  }
  if (toDate && isValidDateString(toDate)) {
    conditions.push('DATE(hd.NgayThanhToan) <= ?');
    params.push(toDate);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Tổng hợp theo phân loại dịch vụ
  const [breakdown] = await db.query(`
    SELECT CASE hd.LoaiHoaDon
             WHEN 1 THEN 'Gói tập thể hình'
             WHEN 2 THEN 'Khóa học'
             WHEN 3 THEN 'Sản phẩm cửa hàng'
             ELSE 'Dịch vụ khác'
           END AS service_type,
           hd.LoaiHoaDon AS service_type_id,
           COUNT(*) AS transaction_count,
           COALESCE(SUM(hd.TongTien), 0) AS total_amount
      FROM HoaDon hd
      ${whereClause}
     GROUP BY hd.LoaiHoaDon
  `, params);

  // Danh sách các giao dịch xác nhận chi tiết
  const [invoices] = await db.query(`
    SELECT hd.HoaDonID AS id,
           hd.MaHoaDon AS code,
           DATE_FORMAT(hd.NgayThanhToan, '%Y-%m-%d %H:%i') AS paid_at,
           hd.TongTien AS amount,
           CASE hd.LoaiHoaDon
             WHEN 1 THEN 'Gói tập'
             WHEN 2 THEN 'Khóa học'
             WHEN 3 THEN 'Sản phẩm'
             ELSE 'Khác'
           END AS category,
           CASE hd.PhuongThucThanhToan
             WHEN 1 THEN 'Tiền mặt'
             WHEN 2 THEN 'Chuyển khoản'
             WHEN 3 THEN 'Thẻ ngân hàng'
             ELSE 'Khác'
           END AS payment_method,
           tk.HoTen AS customer_name,
           hd.GhiChu AS note
      FROM HoaDon hd
      LEFT JOIN KhachHang kh ON hd.KhachHangID = kh.KhachHangID
      LEFT JOIN TaiKhoan tk ON kh.KhachHangID = tk.TaiKhoanID
      ${whereClause}
     ORDER BY hd.NgayThanhToan DESC
     LIMIT 100
  `, params);

  const totalAmount = breakdown.reduce((sum, item) => sum + Number(item.total_amount), 0);

  // Luồng thay thế: Nếu không có dữ liệu trong khoảng thời gian đã chọn
  res.json({
    success: true,
    data: {
      totalRevenue: totalAmount,
      transactionCount: invoices.length,
      breakdown,
      invoices,
      hasData: invoices.length > 0,
      note: invoices.length === 0 ? 'Không có giao dịch thanh toán đã xác nhận nào trong khoảng thời gian được chọn.' : null
    }
  });
}));

// 3. GET /api/admin/reports/classes: Thống kê tình hình lớp học và tỷ lệ lấp đầy
router.get('/reports/classes', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [classes] = await db.query(`
    SELECT lh.LopHocID AS id,
           lh.MaLop AS code,
           lh.TenLop AS name,
           kh.TenKhoaHoc AS course_name,
           p.TenPhong AS room_name,
           lh.SucChua AS capacity,
           COALESCE(s.SoDaDangKy, 0) AS enrolled_count,
           COALESCE(s.SoConTrong, lh.SucChua) AS available_slots,
           ROUND((COALESCE(s.SoDaDangKy, 0) / lh.SucChua) * 100, 1) AS occupancy_rate,
           CASE
             WHEN COALESCE(s.SoConTrong, lh.SucChua) <= 0 THEN 'Đã đầy chỗ'
             WHEN COALESCE(s.SoDaDangKy, 0) > 0 THEN 'Còn chỗ'
             ELSE 'Chưa có học viên'
           END AS occupancy_status
      FROM LopHoc lh
      JOIN KhoaHoc kh ON lh.KhoaHocID = kh.KhoaHocID
      JOIN Phong p ON lh.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = lh.LopHocID
     ORDER BY occupancy_rate DESC, lh.LopHocID DESC
  `);

  res.json({
    success: true,
    data: classes,
    hasData: classes.length > 0,
    note: classes.length === 0 ? 'Hiện tại trung tâm chưa có lớp học nào được thiết lập.' : null
  });
}));

// 4. GET /api/admin/reports/checkin: Thống kê lượt check-in và điểm danh
router.get('/reports/checkin', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const { fromDate, toDate } = req.query;
  const conditions = [];
  const params = [];

  if (fromDate && isValidDateString(fromDate)) {
    conditions.push('DATE(dd.ThoiGian) >= ?');
    params.push(fromDate);
  }
  if (toDate && isValidDateString(toDate)) {
    conditions.push('DATE(dd.ThoiGian) <= ?');
    params.push(toDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [checkins] = await db.query(`
    SELECT dd.DiemDanhID AS id,
           DATE_FORMAT(dd.ThoiGian, '%Y-%m-%d %H:%i') AS checkin_time,
           CASE dd.LoaiCheckIn
             WHEN 1 THEN 'Điểm danh lớp học'
             WHEN 2 THEN 'Check-in tập Gym tự do'
             ELSE 'Khác'
           END AS checkin_type,
           tk.HoTen AS member_name,
           kh.MaKhachHang AS member_code,
           lh.TenLop AS class_name,
           staff_tk.HoTen AS staff_recorded_name
      FROM DiemDanh dd
      JOIN KhachHang kh ON dd.KhachHangID = kh.KhachHangID
      JOIN TaiKhoan tk ON kh.KhachHangID = tk.TaiKhoanID
      LEFT JOIN BuoiHoc bh ON dd.BuoiHocID = bh.BuoiHocID
      LEFT JOIN LopHoc lh ON bh.LopHocID = lh.LopHocID
      LEFT JOIN TaiKhoan staff_tk ON dd.NguoiGhiNhanID = staff_tk.TaiKhoanID
      ${whereClause}
     ORDER BY dd.ThoiGian DESC
     LIMIT 100
  `, params);

  res.json({
    success: true,
    data: checkins,
    totalCount: checkins.length,
    hasData: checkins.length > 0,
    note: checkins.length === 0 ? 'Không có dữ liệu điểm danh nào trong khoảng thời gian này.' : null
  });
}));


// =============================================================================
// VIII. QUẢN LÝ TÀI KHOẢN NHÂN SỰ (STAFF MANAGEMENT)
// =============================================================================

// 1. GET /api/admin/staff: Lấy danh sách toàn bộ nhân sự (Admin, Nhân viên, Huấn luyện viên)
router.get('/staff', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const [staffList] = await db.query(`
    SELECT tk.TaiKhoanID AS id,
           COALESCE(nv.MaNhanVien, hlv.MaHLV, CONCAT('AD', LPAD(tk.TaiKhoanID, 4, '0'))) AS code,
           tk.HoTen AS full_name,
           tk.Email AS email,
           tk.SoDienThoai AS phone,
           tk.VaiTroID AS role_id,
           vt.TenVaiTro AS role_name,
           COALESCE(nv.ChucVu, 'Huấn luyện viên') AS position,
           COALESCE(hlv.KinhNghiemNam, 0) AS exp_years,
           (SELECT GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ')
              FROM HLV_ChuyenMon hcm
              JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
             WHERE hcm.HuanLuyenVienID = tk.TaiKhoanID) AS specialties,
           tk.TrangThai AS status,
           DATE_FORMAT(tk.NgayTao, '%Y-%m-%d %H:%i') AS created_at,
           DATE_FORMAT(tk.LanDangNhapCuoi, '%Y-%m-%d %H:%i') AS last_login
      FROM TaiKhoan tk
      JOIN VaiTro vt ON tk.VaiTroID = vt.VaiTroID
      LEFT JOIN NhanVien nv ON tk.TaiKhoanID = nv.NhanVienID
      LEFT JOIN HuanLuyenVien hlv ON tk.TaiKhoanID = hlv.HuanLuyenVienID
     WHERE tk.VaiTroID IN (1, 2, 3)
     ORDER BY tk.VaiTroID ASC, tk.TaiKhoanID DESC
  `);

  res.json({ success: true, data: staffList });
}));

// 2. GET /api/admin/staff/:id: Xem chi tiết 1 nhân sự
router.get('/staff/:id', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  const [rows] = await db.query(`
    SELECT tk.TaiKhoanID AS id,
           COALESCE(nv.MaNhanVien, hlv.MaHLV, CONCAT('AD', LPAD(tk.TaiKhoanID, 4, '0'))) AS code,
           tk.HoTen AS full_name,
           tk.Email AS email,
           tk.SoDienThoai AS phone,
           tk.DiaChi AS address,
           DATE_FORMAT(tk.NgaySinh, '%Y-%m-%d') AS birth_date,
           tk.GioiTinh AS gender,
           tk.VaiTroID AS role_id,
           vt.TenVaiTro AS role_name,
           COALESCE(nv.ChucVu, 'Huấn luyện viên') AS position,
           DATE_FORMAT(nv.NgayVaoLam, '%Y-%m-%d') AS start_working_date,
           COALESCE(hlv.KinhNghiemNam, 0) AS exp_years,
           hlv.TieuSu AS biography,
           (SELECT GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ')
              FROM HLV_ChuyenMon hcm
              JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
             WHERE hcm.HuanLuyenVienID = tk.TaiKhoanID) AS specialties,
           tk.TrangThai AS status,
           DATE_FORMAT(tk.NgayTao, '%Y-%m-%d %H:%i') AS created_at,
           DATE_FORMAT(tk.LanDangNhapCuoi, '%Y-%m-%d %H:%i') AS last_login
      FROM TaiKhoan tk
      JOIN VaiTro vt ON tk.VaiTroID = vt.VaiTroID
      LEFT JOIN NhanVien nv ON tk.TaiKhoanID = nv.NhanVienID
      LEFT JOIN HuanLuyenVien hlv ON tk.TaiKhoanID = hlv.HuanLuyenVienID
     WHERE tk.TaiKhoanID = ? AND tk.VaiTroID IN (1, 2, 3)
  `, [id]);

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ nhân sự yêu cầu!' });
  }

  // Nếu là HLV, lấy thêm danh sách lớp đang phụ trách
  let classes = [];
  if (rows[0].role_id === 3) {
    [classes] = await db.query(`
      SELECT DISTINCT lh.LopHocID AS id, lh.MaLop AS code, lh.TenLop AS name,
             DATE_FORMAT(lh.NgayBatDau, '%Y-%m-%d') AS start_date,
             DATE_FORMAT(lh.NgayKetThuc, '%Y-%m-%d') AS end_date,
             p.TenPhong AS room_name
        FROM PhanCongHLV pc
        JOIN BuoiHoc bh ON pc.BuoiHocID = bh.BuoiHocID
        JOIN LopHoc lh ON bh.LopHocID = lh.LopHocID
        JOIN Phong p ON lh.PhongID = p.PhongID
       WHERE pc.HuanLuyenVienID = ? AND pc.TrangThai = 1
    `, [id]);
  }

  res.json({ success: true, data: { profile: rows[0], assignedClasses: classes } });
}));

// 3. POST /api/admin/staff: Tạo tài khoản nhân sự mới
router.post('/staff', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;

  const {
    fullName,
    email,
    phone,
    password = 'Password123!',
    roleId = 2, // 1: Admin, 2: Nhân viên, 3: HLV
    position = 'Nhân viên quầy',
    specialtyId,
    experienceYears = 1,
    biography
  } = req.body;

  const cleanName = String(fullName || '').trim();
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Họ và tên nhân sự không được để trống!' });
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ success: false, message: 'Email không hợp lệ!' });
  }

  // Số điện thoại phải đủ 10 số và bắt đầu từ 0
  const cleanPhone = String(phone || '').trim();
  if (!/^0\d{9}$/.test(cleanPhone)) {
    return res.status(400).json({ success: false, message: 'Số điện thoại phải đủ 10 số, bắt đầu từ số 0 và không chứa ký tự khác!' });
  }

  const role = Number(roleId);
  if (![1, 2, 3].includes(role)) {
    return res.status(400).json({ success: false, message: 'Vai trò nhân sự không hợp lệ (1: Quản trị viên, 2: Nhân viên, 3: Huấn luyện viên)!' });
  }

  // Kiểm tra trùng Email hoặc SĐT
  const [existingEmail] = await db.query('SELECT TaiKhoanID FROM TaiKhoan WHERE LOWER(Email) = ?', [cleanEmail]);
  if (existingEmail.length > 0) {
    return res.status(400).json({ success: false, message: `Email "${cleanEmail}" đã được sử dụng bởi tài khoản khác!` });
  }
  const [existingPhone] = await db.query('SELECT TaiKhoanID FROM TaiKhoan WHERE SoDienThoai = ?', [cleanPhone]);
  if (existingPhone.length > 0) {
    return res.status(400).json({ success: false, message: `Số điện thoại "${cleanPhone}" đã được sử dụng!` });
  }

  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password || 'Password123!', salt);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Chèn bảng TaiKhoan
    const [insUser] = await conn.query(
      `INSERT INTO TaiKhoan (HoTen, Email, SoDienThoai, MatKhauHash, VaiTroID, TrangThai, NgayTao)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      [cleanName, cleanEmail, cleanPhone, hash, role]
    );
    const newUserId = insUser.insertId;

    let staffCode = '';
    // 2. Chèn bảng phụ tương ứng theo vai trò
    if (role === 2) {
      await conn.query(
        `INSERT INTO NhanVien (NhanVienID, ChucVu, NgayVaoLam, TrangThaiLamViec)
         VALUES (?, ?, CURDATE(), 1)`,
        [newUserId, position ? String(position).trim() : 'Nhân viên lễ tân']
      );
      const [[nvRow]] = await conn.query('SELECT MaNhanVien FROM NhanVien WHERE NhanVienID = ?', [newUserId]);
      staffCode = nvRow ? nvRow.MaNhanVien : `NV${newUserId}`;
    } else if (role === 3) {
      await conn.query(
        `INSERT INTO HuanLuyenVien (HuanLuyenVienID, KinhNghiemNam, TieuSu, TrangThaiHoatDong, NgayVaoLam)
         VALUES (?, ?, ?, 1, CURDATE())`,
        [newUserId, Number(experienceYears) || 1, biography ? String(biography).trim() : 'Huấn luyện viên tại FitCenter']
      );
      const [[hlvRow]] = await conn.query('SELECT MaHLV FROM HuanLuyenVien WHERE HuanLuyenVienID = ?', [newUserId]);
      staffCode = hlvRow ? hlvRow.MaHLV : `HLV${newUserId}`;

      // Gắn chuyên môn nếu có
      if (specialtyId) {
        await conn.query(
          'INSERT INTO HLV_ChuyenMon (HuanLuyenVienID, ChuyenMonID) VALUES (?, ?)',
          [newUserId, Number(specialtyId)]
        );
      }
    } else {
      staffCode = `AD${String(newUserId).padStart(4, '0')}`;
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: `Đã tạo tài khoản nhân sự cho "${cleanName}" (${staffCode}) thành công! Mật khẩu mặc định: ${password || 'Password123!'}`,
      data: {
        id: newUserId,
        code: staffCode,
        fullName: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        roleId: role
      }
    });
  } catch (error) {
    await conn.rollback();
    console.error('[ADMIN CREATE STAFF ERROR]', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tạo tài khoản nhân sự: ' + error.message });
  } finally {
    conn.release();
  }
}));

// 4. PATCH /api/admin/staff/:id/status: Khóa / Mở khóa tài khoản nhân sự
router.patch('/staff/:id/status', asyncHandler(async (req, res) => {
  const admin = await ensureAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);

  if (id === admin.TaiKhoanID) {
    return res.status(400).json({ success: false, message: 'Không thể tự khóa tài khoản quản trị viên của chính bạn!' });
  }

  const [existing] = await db.query('SELECT HoTen, TrangThai, VaiTroID FROM TaiKhoan WHERE TaiKhoanID = ? AND VaiTroID IN (1, 2, 3)', [id]);
  if (!existing.length) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản nhân sự!' });
  }

  const newStatus = Number(req.body.status) === 1 ? 1 : 0;
  await db.query('UPDATE TaiKhoan SET TrangThai = ? WHERE TaiKhoanID = ?', [newStatus, id]);

  const statusName = newStatus === 1 ? 'Đang hoạt động' : 'Tạm khóa';
  res.json({
    success: true,
    message: `Đã cập nhật trạng thái tài khoản của "${existing[0].HoTen}" sang "${statusName}"!`,
    data: { id, status: newStatus }
  });
}));


// Global error handler của admin router
router.use((error, req, res, next) => {
  console.error('[ADMIN ROUTE UNCAUGHT ERROR]', error);
  res.status(500).json({ success: false, message: 'Có lỗi xảy ra: ' + error.message });
});

module.exports = router;
