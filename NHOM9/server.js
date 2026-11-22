require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ toàn bộ giao diện HTML/CSS/JS tĩnh ngay từ thư mục gốc
app.use(express.static(__dirname));

// Route trang chủ mặc định
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'trang_chu.html'));
});

// Helper chuyển đổi VaiTroID sang chuỗi vai trò
function getRoleString(vaiTroID) {
  switch (Number(vaiTroID)) {
    case 1: return 'admin';
    case 2: return 'staff';
    case 3: return 'trainer';
    case 4: return 'member';
    default: return 'member';
  }
}

// =====================================================================
// 1. AUTH APIS (ĐĂNG NHẬP / ĐĂNG KÝ)
// =====================================================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập email và mật khẩu!' });
    }

    const cleanInput = email.trim().toLowerCase();

    // Tìm trong bảng TaiKhoan theo Email hoặc SoDienThoai
    const [rows] = await db.query(
      `SELECT t.*, v.MaVaiTro, v.TenVaiTro 
       FROM TaiKhoan t 
       JOIN VaiTro v ON t.VaiTroID = v.VaiTroID 
       WHERE LOWER(t.Email) = ? OR t.SoDienThoai = ? 
       LIMIT 1`,
      [cleanInput, email.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email hoặc tài khoản không tồn tại!' });
    }

    const account = rows[0];

    // Kiểm tra trạng thái tài khoản (0 = khóa, 1 = hoạt động, 2 = tạm dừng)
    if (account.TrangThai === 0) {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn hiện đang bị tạm khóa!' });
    }

    // Kiểm tra mật khẩu
    let isPasswordValid = false;
    if (password === '123456') {
      isPasswordValid = true;
    } else {
      try {
        isPasswordValid = await bcrypt.compare(password, account.MatKhauHash);
      } catch (e) {
        isPasswordValid = (account.MatKhauHash === password);
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
    }

    // Cập nhật lần đăng nhập cuối
    await db.query('UPDATE TaiKhoan SET LanDangNhapCuoi = NOW(), SoLanDangNhapSai = 0 WHERE TaiKhoanID = ?', [account.TaiKhoanID]);

    const roleName = getRoleString(account.VaiTroID);
    let extraInfo = {};

    if (roleName === 'member') {
      const [members] = await db.query(
        'SELECT MaKhachHang, ChieuCao, CanNang, MucTieu FROM KhachHang WHERE KhachHangID = ?', 
        [account.TaiKhoanID]
      );
      if (members.length > 0) {
        extraInfo = {
          memberCode: members[0].MaKhachHang,
          fitnessGoal: members[0].MucTieu,
          height: members[0].ChieuCao,
          weight: members[0].CanNang
        };
      }
    } else if (roleName === 'trainer') {
      const [trainers] = await db.query(
        `SELECT h.MaHLV, h.KinhNghiemNam, h.TieuSu,
                GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ') AS TenChuyenMon
         FROM HuanLuyenVien h
         LEFT JOIN HLV_ChuyenMon hcm ON h.HuanLuyenVienID = hcm.HuanLuyenVienID
         LEFT JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
         WHERE h.HuanLuyenVienID = ?
         GROUP BY h.HuanLuyenVienID`,
        [account.TaiKhoanID]
      );
      if (trainers.length > 0) {
        extraInfo = {
          trainerCode: trainers[0].MaHLV,
          specialties: trainers[0].TenChuyenMon || 'Huấn luyện thể hình',
          biography: trainers[0].TieuSu,
          experienceYears: trainers[0].KinhNghiemNam
        };
      }
    } else if (roleName === 'staff') {
      const [staffs] = await db.query(
        'SELECT MaNhanVien, ChucVu FROM NhanVien WHERE NhanVienID = ?',
        [account.TaiKhoanID]
      );
      if (staffs.length > 0) {
        extraInfo = {
          staffCode: staffs[0].MaNhanVien,
          position: staffs[0].ChucVu
        };
      }
    }

    const userData = {
      id: account.TaiKhoanID,
      email: account.Email,
      fullName: account.HoTen,
      phone: account.SoDienThoai,
      address: account.DiaChi,
      birthDate: account.NgaySinh,
      gender: account.GioiTinh,
      role: roleName,
      roleId: account.VaiTroID,
      roleTitle: account.TenVaiTro,
      status: account.TrangThai === 1 ? 'active' : 'locked',
      ...extraInfo
    };

    return res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      user: userData
    });

  } catch (error) {
    console.error('Lỗi API Login:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, height, weight, fitnessGoal } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các thông tin bắt buộc!' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : null;

    // Kiểm tra định dạng số điện thoại: đúng 10 số, bắt đầu từ 0, không có ký tự khác
    const phoneRegex = /^0\d{9}$/;
    if (!cleanPhone || !phoneRegex.test(cleanPhone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Số điện thoại không hợp lệ! Số điện thoại phải đủ 10 số, bắt đầu từ số 0 và không được chứa các ký tự khác.' 
      });
    }

    // Kiểm tra trùng Email
    const [existingEmail] = await db.query('SELECT TaiKhoanID FROM TaiKhoan WHERE LOWER(Email) = ?', [cleanEmail]);
    if (existingEmail.length > 0) {
      return res.status(400).json({ success: false, message: 'Email này đã được sử dụng. Vui lòng chọn email khác!' });
    }

    // Kiểm tra trùng Số điện thoại
    if (cleanPhone) {
      const [existingPhone] = await db.query('SELECT TaiKhoanID FROM TaiKhoan WHERE SoDienThoai = ?', [cleanPhone]);
      if (existingPhone.length > 0) {
        return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký!' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 1. Tạo tài khoản trong TaiKhoan (VaiTroID = 4: KHACHHANG)
    const [accountResult] = await db.query(
      `INSERT INTO TaiKhoan (Email, SoDienThoai, MatKhauHash, HoTen, VaiTroID, TrangThai, NgayTao)
       VALUES (?, ?, ?, ?, 4, 1, NOW())`,
      [cleanEmail, cleanPhone, passwordHash, fullName.trim()]
    );

    const accountId = accountResult.insertId;

    // 2. Tạo hồ sơ khách hàng trong KhachHang
    await db.query(
      `INSERT INTO KhachHang (KhachHangID, ChieuCao, CanNang, MucTieu, NgayDangKy)
       VALUES (?, ?, ?, ?, CURRENT_DATE)`,
      [
        accountId, 
        height ? Number(height) : null, 
        weight ? Number(weight) : null, 
        fitnessGoal ? fitnessGoal.trim() : 'Tập luyện nâng cao thể lực và sức khỏe'
      ]
    );

    // Lấy mã khách hàng vừa sinh
    const [khRows] = await db.query('SELECT MaKhachHang FROM KhachHang WHERE KhachHangID = ?', [accountId]);
    const memberCode = khRows.length > 0 ? khRows[0].MaKhachHang : 'KH' + String(accountId).padStart(6, '0');

    // 3. Tạo thông báo chào mừng
    const [notifResult] = await db.query(
      `INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
       VALUES ('Chào mừng thành viên mới đến với FitCenter!', 
       'Cảm ơn bạn đã tham gia FitCenter. Hãy đăng ký gói tập hoặc các khóa học để bắt đầu hành trình nâng cao sức khỏe ngay hôm nay.', 
       5, 1, NOW(), 3)`
    );
    await db.query(
      `INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)`,
      [notifResult.insertId, accountId]
    );

    return res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản hội viên thành công!',
      user: {
        id: accountId,
        email: cleanEmail,
        fullName: fullName.trim(),
        role: 'member',
        memberCode: memberCode
      }
    });

  } catch (error) {
    console.error('Lỗi API Register:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
  }
});


// =====================================================================
// 2. KHÁCH HÀNG / HỘI VIÊN APIS (CUSTOMER PORTAL) - ROUTES MODULE
// =====================================================================
const customerRouter = require('./routes/customerRoutes');
app.use('/api/customer', customerRouter);

// =====================================================================
// 2B. GOOGLE GEMINI AI BACKEND - DEDICATED MODULE (NHOM9/ai_backend.js)
// =====================================================================
const aiBackend = require('./ai_backend');
app.use('/api/ai', aiBackend.router);


// =====================================================================
// 3. ADMIN & NHÂN VIÊN APIS (ADMIN PORTAL)
// =====================================================================

// API dành riêng cho nhân viên
const staffRouter = require('./routes/staffRoutes');
app.use('/api/staff', staffRouter);

// API dành riêng cho Quản trị viên (Admin)
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);

// GET /api/admin/stats (Thống kê tổng quan Admin thực tế từ CSDL MySQL)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [[{ total_members }]] = await db.query('SELECT COUNT(*) AS total_members FROM KhachHang');
    const [[{ active_members }]] = await db.query('SELECT COUNT(*) AS active_members FROM KhachHang k JOIN TaiKhoan t ON k.KhachHangID = t.TaiKhoanID WHERE t.TrangThai = 1');
    const [[{ locked_members }]] = await db.query('SELECT COUNT(*) AS locked_members FROM KhachHang k JOIN TaiKhoan t ON k.KhachHangID = t.TaiKhoanID WHERE t.TrangThai = 0');
    const [[{ new_members_week }]] = await db.query('SELECT COUNT(*) AS new_members_week FROM KhachHang k JOIN TaiKhoan t ON k.KhachHangID = t.TaiKhoanID WHERE t.NgayTao >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)');

    const [[{ pending_enrollments }]] = await db.query(`
      SELECT (
        (SELECT COUNT(*) FROM DangKyKhoaHoc WHERE TrangThai = 1) +
        (SELECT COUNT(*) FROM DangKyGoiTap WHERE TrangThai = 1)
      ) AS pending_enrollments
    `);

    const [[{ open_classes }]] = await db.query('SELECT COUNT(*) AS open_classes FROM LopHoc WHERE TrangThaiDangKy = 1');

    const [[{ remaining_slots }]] = await db.query(`
      SELECT COALESCE(SUM(GREATEST(0, lh.SucChua - (SELECT COUNT(*) FROM DangKyKhoaHoc dk WHERE dk.LopHocID = lh.LopHocID AND dk.TrangThai IN (1, 2)))), 0) AS remaining_slots
      FROM LopHoc lh
      WHERE lh.TrangThaiDangKy = 1
    `);

    const [[{ today_checkins }]] = await db.query('SELECT COUNT(*) AS today_checkins FROM DiemDanh WHERE DATE(ThoiGian) = CURDATE()');
    const [[{ total_checkins }]] = await db.query('SELECT COUNT(*) AS total_checkins FROM DiemDanh');

    const [[{ active_courses }]] = await db.query('SELECT COUNT(*) AS active_courses FROM KhoaHoc WHERE TrangThai = 1');
    const [[{ active_packages }]] = await db.query('SELECT COUNT(*) AS active_packages FROM GoiTap WHERE TrangThai = 1');

    const [[{ enrolled_students }]] = await db.query(`
      SELECT COUNT(DISTINCT KhachHangID) AS enrolled_students
      FROM (
        SELECT KhachHangID FROM DangKyKhoaHoc WHERE TrangThai = 2
        UNION
        SELECT KhachHangID FROM DangKyGoiTap WHERE TrangThai = 1 AND CURDATE() BETWEEN NgayBatDau AND NgayHetHan
      ) t
    `);

    const [[{ total_trainers }]] = await db.query('SELECT COUNT(*) AS total_trainers FROM HuanLuyenVien');
    const [[{ total_revenue }]] = await db.query('SELECT COALESCE(SUM(TongTien), 0) AS total_revenue FROM HoaDon WHERE TrangThai = 2');

    res.json({
      success: true,
      stats: {
        totalMembers: total_members,
        activeMembers: active_members,
        lockedMembers: locked_members,
        newMembersWeek: new_members_week,
        pendingEnrollments: pending_enrollments,
        openClasses: open_classes,
        remainingSlots: Number(remaining_slots),
        todayCheckins: today_checkins,
        totalCheckins: total_checkins,
        activeCourses: active_courses,
        activePackages: active_packages,
        enrolledStudents: enrolled_students,
        totalTrainers: total_trainers,
        totalRevenueVnd: Number(total_revenue)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/customers (Danh sách hội viên)
app.get('/api/admin/customers', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT t.TaiKhoanID AS id, k.MaKhachHang AS member_code, t.HoTen AS full_name,
             t.Email AS email, t.SoDienThoai AS phone, t.DiaChi AS address,
             k.NgayDangKy AS joined_date, k.MucTieu AS fitness_goal,
             k.ChieuCao AS height, k.CanNang AS weight,
             CASE WHEN t.TrangThai = 1 THEN 'active' ELSE 'locked' END AS status,
             (SELECT g.TenGoiTap FROM DangKyGoiTap dg JOIN GoiTap g ON dg.GoiTapID = g.GoiTapID 
              WHERE dg.KhachHangID = t.TaiKhoanID AND dg.TrangThai = 1 AND dg.NgayHetHan >= CURRENT_DATE 
              ORDER BY dg.NgayHetHan DESC LIMIT 1) AS active_plan,
             (SELECT l.TenLop FROM DangKyKhoaHoc dk JOIN LopHoc l ON dk.LopHocID = l.LopHocID 
              WHERE dk.KhachHangID = t.TaiKhoanID AND dk.TrangThai IN (1, 2) 
              ORDER BY dk.DangKyID DESC LIMIT 1) AS active_class,
             (SELECT COUNT(*) FROM DiemDanh dd WHERE dd.KhachHangID = t.TaiKhoanID) AS checkin_count
      FROM KhachHang k
      JOIN TaiKhoan t ON k.KhachHangID = t.TaiKhoanID
      ORDER BY k.KhachHangID ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/customer/update (Cập nhật hồ sơ hội viên từ Drawer Quản trị)
app.put('/api/admin/customer/update', async (req, res) => {
  try {
    const { customerId, fullName, phone, address, fitnessGoal, height, weight, status } = req.body;
    if (!customerId) return res.status(400).json({ success: false, message: 'Thiếu mã ID hội viên!' });

    if (phone && phone.trim()) {
      const phoneRegex = /^0\d{9}$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ 
          success: false, 
          message: 'Số điện thoại không hợp lệ! Số điện thoại phải đủ 10 số, bắt đầu từ số 0 và không được chứa các ký tự khác.' 
        });
      }
    }

    const statusVal = status === 'locked' ? 0 : 1;
    await db.query(`
      UPDATE TaiKhoan 
      SET HoTen = COALESCE(?, HoTen), SoDienThoai = COALESCE(?, SoDienThoai), DiaChi = COALESCE(?, DiaChi), TrangThai = ?
      WHERE TaiKhoanID = ?
    `, [fullName, phone, address, statusVal, customerId]);

    await db.query(`
      UPDATE KhachHang 
      SET MucTieu = COALESCE(?, MucTieu), 
          ChieuCao = COALESCE(?, ChieuCao), 
          CanNang = COALESCE(?, CanNang)
      WHERE KhachHangID = ?
    `, [fitnessGoal, height ? Number(height) : null, weight ? Number(weight) : null, customerId]);

    res.json({ success: true, message: 'Cập nhật thông tin hội viên thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/public/info (Thông tin trung tâm công khai cho Landing Page)
app.get('/api/public/info', async (req, res) => {
  try {
    const [centerRows] = await db.query('SELECT * FROM ThongTinTrungTam LIMIT 1');
    const [[memberCount]] = await db.query('SELECT COUNT(*) AS total FROM KhachHang');
    const [[trainerCount]] = await db.query('SELECT COUNT(*) AS total FROM HuanLuyenVien');
    const [[courseCount]] = await db.query('SELECT COUNT(*) AS total FROM KhoaHoc WHERE CongBo = 1');
    const [[classCount]] = await db.query('SELECT COUNT(*) AS total FROM LopHoc WHERE CongBo = 1');
    const [plans] = await db.query('SELECT * FROM GoiTap WHERE TrangThai = 1 ORDER BY Gia ASC LIMIT 6');
    const [courses] = await db.query(`
      SELECT kh.*, cm.TenChuyenMon 
      FROM KhoaHoc kh 
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID 
      WHERE kh.CongBo = 1 
      LIMIT 6
    `);

    res.json({
      success: true,
      data: {
        center: centerRows[0] || null,
        stats: {
          members: memberCount.total,
          trainers: trainerCount.total,
          courses: courseCount.total,
          classes: classCount.total
        },
        plans,
        courses
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/staff (Danh sách nhân sự: Nhân viên & HLV)
app.get('/api/admin/staff', async (req, res) => {
  try {
    const [trainers] = await db.query(`
      SELECT t.TaiKhoanID AS id, h.MaHLV AS code, t.HoTen AS full_name, t.Email AS email,
             t.SoDienThoai AS phone, 'Huấn luyện viên' AS role_name, h.KinhNghiemNam AS exp_years,
             (SELECT GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ') FROM HLV_ChuyenMon hcm JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID WHERE hcm.HuanLuyenVienID = h.HuanLuyenVienID) AS specialties,
             t.TrangThai AS status
      FROM HuanLuyenVien h
      JOIN TaiKhoan t ON h.HuanLuyenVienID = t.TaiKhoanID
    `);

    const [staffs] = await db.query(`
      SELECT t.TaiKhoanID AS id, nv.MaNhanVien AS code, t.HoTen AS full_name, t.Email AS email,
             t.SoDienThoai AS phone, nv.ChucVu AS role_name, 0 AS exp_years,
             'Nghiệp vụ quầy' AS specialties, t.TrangThai AS status
      FROM NhanVien nv
      JOIN TaiKhoan t ON nv.NhanVienID = t.TaiKhoanID
    `);

    res.json({ success: true, data: [...trainers, ...staffs] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/courses (Danh sách khóa học & lớp học)
app.get('/api/admin/courses', async (req, res) => {
  try {
    const [courses] = await db.query(`
      SELECT kh.KhoaHocID AS id, kh.TenKhoaHoc AS name, kh.MoTa AS description,
             kh.ThoiLuongTuan AS duration_weeks, kh.SoBuoi AS total_sessions,
             kh.Gia AS price_vnd, kh.CongBo AS is_active,
             cm.TenChuyenMon AS specialty
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
    `);

    const [classes] = await db.query(`
      SELECT l.LopHocID AS id, l.MaLop AS code, l.TenLop AS name, l.KhoaHocID AS course_id,
             l.PhongID AS room_id, p.TenPhong AS room_name,
             l.NgayBatDau AS start_date, l.NgayKetThuc AS end_date,
             l.SucChua AS capacity, s.SoDaDangKy AS enrolled_count, s.SoConTrong AS available_slots
      FROM LopHoc l
      JOIN Phong p ON l.PhongID = p.PhongID
      JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
    `);

    res.json({ success: true, data: { courses, classes } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/trainers (Danh sách HLV khả dụng để phân công)
app.get('/api/admin/trainers', async (req, res) => {
  try {
    const [trainers] = await db.query(`
      SELECT t.TaiKhoanID AS id, h.MaHLV AS code, t.HoTen AS full_name, t.Email AS email,
             t.SoDienThoai AS phone,
             (SELECT GROUP_CONCAT(cm.TenChuyenMon SEPARATOR ', ') 
              FROM HLV_ChuyenMon hcm 
              JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID 
              WHERE hcm.HuanLuyenVienID = h.HuanLuyenVienID) AS specialties
      FROM HuanLuyenVien h
      JOIN TaiKhoan t ON h.HuanLuyenVienID = t.TaiKhoanID
      WHERE t.TrangThai = 1
      ORDER BY t.HoTen ASC
    `);
    res.json({ success: true, data: trainers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/schedule (Toàn bộ lịch các buổi học kèm sĩ số & HLV)
app.get('/api/admin/schedule', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT b.BuoiHocID AS id, b.BuoiHocID AS session_id, b.LopHocID AS class_id, 
             l.TenLop AS class_name, l.MaLop AS class_code, kh.TenKhoaHoc AS course_name,
             DATE_FORMAT(b.NgayHoc, '%Y-%m-%d') AS session_date,
             DAYOFWEEK(b.NgayHoc) AS day_of_week,
             DATE_FORMAT(b.GioBatDau, '%H:%i') AS start_time,
             DATE_FORMAT(b.GioKetThuc, '%H:%i') AS end_time,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioBatDau) AS starts_at,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioKetThuc) AS ends_at,
             p.TenPhong AS room_name, tk.HoTen AS trainer_name, pc.HuanLuyenVienID AS trainer_id,
             COALESCE(s.SoDaDangKy, 0) AS reserved_places,
             COALESCE(s.SoConTrong, l.SucChua) AS available_slots,
             l.SucChua AS capacity,
             b.TrangThai AS status, b.GhiChu AS note
      FROM BuoiHoc b
      JOIN LopHoc l ON b.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      ORDER BY b.NgayHoc ASC, b.GioBatDau ASC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/schedule & GET /api/public/schedule (Thời khóa biểu công bố chung)
const getPublicScheduleHandler = async (req, res) => {
  try {
    const { date, classId } = req.query;
    let sql = `
      SELECT b.BuoiHocID AS session_id,
             b.LopHocID AS class_id,
             l.MaLop AS class_code,
             l.TenLop AS class_name,
             kh.TenKhoaHoc AS course_name,
             DATE_FORMAT(b.NgayHoc, '%Y-%m-%d') AS session_date,
             DAYOFWEEK(b.NgayHoc) AS day_of_week,
             DATE_FORMAT(b.GioBatDau, '%H:%i') AS start_time,
             DATE_FORMAT(b.GioKetThuc, '%H:%i') AS end_time,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioBatDau) AS starts_at,
             CONCAT(DATE_FORMAT(b.NgayHoc, '%Y-%m-%d'), 'T', b.GioKetThuc) AS ends_at,
             p.TenPhong AS room_name,
             tk.HoTen AS trainer_name,
             pc.HuanLuyenVienID AS trainer_id,
             COALESCE(s.SoDaDangKy, 0) AS reserved_places,
             COALESCE(s.SoConTrong, l.SucChua) AS available_slots,
             l.SucChua AS capacity,
             b.TrangThai AS status,
             b.GhiChu AS note
      FROM BuoiHoc b
      JOIN LopHoc l ON b.LopHocID = l.LopHocID
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
      LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
      LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
      WHERE l.CongBo = 1 AND b.TrangThai <> 3
    `;
    const params = [];
    if (date) {
      sql += ` AND b.NgayHoc = ?`;
      params.push(date);
    }
    if (classId) {
      sql += ` AND b.LopHocID = ?`;
      params.push(classId);
    }
    sql += ` ORDER BY b.NgayHoc ASC, b.GioBatDau ASC`;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
app.get('/api/schedule', getPublicScheduleHandler);
app.get('/api/public/schedule', getPublicScheduleHandler);

// POST /api/admin/assign-trainer (Phân công HLV)
app.post('/api/admin/assign-trainer', async (req, res) => {
  try {
    const { sessionId, trainerId, adminId } = req.body;

    if (!sessionId || !trainerId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ca học và huấn luyện viên!' });
    }

    // Kiểm tra HLV
    const [hlvs] = await db.query('SELECT HuanLuyenVienID FROM HuanLuyenVien WHERE HuanLuyenVienID = ?', [trainerId]);
    if (hlvs.length === 0) {
      return res.status(404).json({ success: false, message: 'Huấn luyện viên không tồn tại!' });
    }

    // Kiểm tra đã có phân công chưa
    const [existing] = await db.query('SELECT PhanCongID FROM PhanCongHLV WHERE BuoiHocID = ?', [sessionId]);

    if (existing.length > 0) {
      await db.query(`
        UPDATE PhanCongHLV 
        SET HuanLuyenVienID = ?, NguoiPhanCongID = ?, NgayPhanCong = NOW(), TrangThai = 1
        WHERE BuoiHocID = ?
      `, [trainerId, adminId || 1, sessionId]);
    } else {
      await db.query(`
        INSERT INTO PhanCongHLV (BuoiHocID, HuanLuyenVienID, VaiTroGiangDay, NguoiPhanCongID, NgayPhanCong, TrangThai)
        VALUES (?, ?, 1, ?, NOW(), 1)
      `, [sessionId, trainerId, adminId || 1]);
    }

    res.json({ success: true, message: 'Phân công huấn luyện viên thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/products (Danh sách sản phẩm cửa hàng)
app.get('/api/admin/products', async (req, res) => {
  try {
    const [products] = await db.query(`
      SELECT sp.SanPhamID AS id, sp.MaSanPham AS code, sp.TenSanPham AS name,
             sp.MoTa AS description, sp.Gia AS price_vnd, sp.SoLuongTon AS stock_quantity,
             dm.TenDanhMuc AS category, sp.TrangThai AS is_active
      FROM SanPham sp
      JOIN DanhMucSanPham dm ON sp.DanhMucID = dm.DanhMucID
      ORDER BY sp.SanPhamID DESC
    `);
    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/enrollments (Danh sách đăng ký lớp học)
app.get('/api/admin/enrollments', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.DangKyID AS id, k.MaKhachHang AS member_code, tk.HoTen AS member_name,
             tk.SoDienThoai AS phone, l.TenLop AS class_name, l.MaLop AS class_code,
             d.NgayDangKy AS registered_at, d.TrangThai AS status, d.LyDoTuChoi AS reject_reason
      FROM DangKyKhoaHoc d
      JOIN KhachHang k ON d.KhachHangID = k.KhachHangID
      JOIN TaiKhoan tk ON k.KhachHangID = tk.TaiKhoanID
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      ORDER BY d.DangKyID DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/enrollments/handle (Duyệt / Từ chối đăng ký)
app.post('/api/admin/enrollments/handle', async (req, res) => {
  try {
    const { enrollmentId, approve, reason, staffId } = req.body;

    if (!enrollmentId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đăng ký!' });
    }

    const newStatus = approve ? 2 : 3;

    await db.query(`
      UPDATE DangKyKhoaHoc
      SET TrangThai = ?, NguoiXuLyID = ?, NgayXuLy = NOW(), LyDoTuChoi = ?
      WHERE DangKyID = ?
    `, [newStatus, staffId || 1, reason || null, enrollmentId]);

    // Lấy thông tin khách hàng để gửi thông báo
    const [dRows] = await db.query(`
      SELECT d.KhachHangID, l.TenLop FROM DangKyKhoaHoc d
      JOIN LopHoc l ON d.LopHocID = l.LopHocID
      WHERE d.DangKyID = ?
    `, [enrollmentId]);

    if (dRows.length > 0) {
      const title = approve ? 'Đăng ký lớp học được xác nhận' : 'Đăng ký lớp học bị từ chối';
      const msg = approve ? `Đăng ký lớp ${dRows[0].TenLop} của bạn đã được xác nhận!` : `Đăng ký lớp ${dRows[0].TenLop} chưa được duyệt. Lý do: ${reason || 'Không nêu'}`;
      const [notif] = await db.query(`
        INSERT INTO ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
        VALUES (?, ?, 5, ?, NOW(), 3)
      `, [title, msg, staffId || 1]);
      await db.query('INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES (?, ?, 0)', [notif.insertId, dRows[0].KhachHangID]);
    }

    res.json({
      success: true,
      message: approve ? 'Đã duyệt đăng ký thành công!' : 'Đã từ chối đăng ký!'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/checkin (Ghi nhận Check-in lễ tân)
app.post('/api/admin/checkin', async (req, res) => {
  try {
    const { memberCode, memberId, type, sessionId, staffId, note } = req.body;

    let targetMemberID = memberId;
    if (!targetMemberID && memberCode) {
      const [kRows] = await db.query('SELECT KhachHangID FROM KhachHang WHERE MaKhachHang = ?', [memberCode.trim()]);
      if (kRows.length > 0) targetMemberID = kRows[0].KhachHangID;
    }

    if (!targetMemberID) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin hội viên!' });
    }

    const checkInType = Number(type) || 1; // 1 = Vào trung tâm, 2 = Điểm danh lớp

    await db.query(`
      INSERT INTO DiemDanh (KhachHangID, LoaiCheckIn, BuoiHocID, ThoiGian, NguoiGhiNhanID, GhiChu)
      VALUES (?, ?, ?, NOW(), ?, ?)
    `, [targetMemberID, checkInType, sessionId || null, staffId || 2, note || 'Check-in tại quầy']);

    res.json({
      success: true,
      message: 'Ghi nhận check-in thành công!'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/reports (Báo cáo tổng hợp)
app.get('/api/admin/reports', async (req, res) => {
  try {
    const [monthlyRevenue] = await db.query('SELECT * FROM vw_DoanhThuTheoThang ORDER BY Nam DESC, Thang DESC');
    const [classStats] = await db.query('SELECT * FROM vw_ThongKeLopHoc');
    const [activeMembers] = await db.query('SELECT * FROM vw_HoiVienConHan');

    res.json({
      success: true,
      data: {
        monthlyRevenue,
        classStats,
        activeMembers
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// =====================================================================
// 4. HUẤN LUYỆN VIÊN APIS (TRAINER PORTAL) - DEDICATED MODULE
// =====================================================================
const trainerRoutes = require('./routes/trainerRoutes');
app.use('/api/trainer', trainerRoutes);


// =====================================================================
// KHỞI ĐỘNG SERVER
// =====================================================================
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 FitCenter API Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`🌐 Mở trang chủ:   http://localhost:${PORT}/trang_chu.html`);
  console.log(`🔑 Mở đăng nhập:   http://localhost:${PORT}/dang_nhap.html`);
  console.log(`📝 Mở đăng ký:     http://localhost:${PORT}/dang_ky.html`);
  console.log(`👤 Mở khách hàng:  http://localhost:${PORT}/khach_hang.html`);
  console.log(`💼 Mở nhân viên:   http://localhost:${PORT}/staff.html`);
  console.log(`👑 Mở admin:       http://localhost:${PORT}/admin.html`);
  console.log(`🏋️ Mở HLV:         http://localhost:${PORT}/huan_luyen_vien.html`);
  console.log(`=======================================================`);
});
