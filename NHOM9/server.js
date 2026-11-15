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

// Serve toàn bộ giao diện HTML/CSS/JS tĩnh ngay từ thư mục gốc
app.use(express.static(__dirname));

// Route trang chủ mặc định
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'trang_chu.html'));
});

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

    const [rows] = await db.query(
      'SELECT * FROM accounts WHERE email = ? OR username = ? LIMIT 1',
      [email.trim().toLowerCase(), email.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Email hoặc tài khoản không tồn tại!' });
    }

    const account = rows[0];

    if (account.status === 'locked') {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn hiện đang bị tạm khóa!' });
    }

    let isPasswordValid = false;
    if (account.password_hash.startsWith('$2b$12$demo_') && password === '123456') {
      isPasswordValid = true;
    } else if (account.password_hash === password) {
      isPasswordValid = true;
    } else {
      try {
        isPasswordValid = await bcrypt.compare(password, account.password_hash);
      } catch (e) {
        isPasswordValid = false;
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
    }

    let extraInfo = {};
    if (account.role === 'member') {
      const [members] = await db.query('SELECT member_code, fitness_goal FROM members WHERE account_id = ?', [account.id]);
      if (members.length > 0) extraInfo = members[0];
    } else if (account.role === 'trainer') {
      const [trainers] = await db.query('SELECT specialties, biography FROM trainers WHERE account_id = ?', [account.id]);
      if (trainers.length > 0) extraInfo = trainers[0];
    }

    const userData = {
      id: account.id,
      email: account.email,
      username: account.username,
      fullName: account.full_name,
      phone: account.phone,
      address: account.address,
      birthDate: account.birth_date,
      role: account.role,
      status: account.status,
      ...extraInfo
    };

    return res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      user: userData
    });

  } catch (error) {
    console.error('Lỗi API Login:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + error.message });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ các thông tin bắt buộc!' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : null;

    const [existingEmail] = await db.query('SELECT id FROM accounts WHERE email = ?', [cleanEmail]);
    if (existingEmail.length > 0) {
      return res.status(400).json({ success: false, message: 'Email này đã được sử dụng. Vui lòng chọn email khác!' });
    }

    if (cleanPhone) {
      const [existingPhone] = await db.query('SELECT id FROM accounts WHERE phone = ?', [cleanPhone]);
      if (existingPhone.length > 0) {
        return res.status(400).json({ success: false, message: 'Số điện thoại này đã được đăng ký!' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const baseUsername = cleanEmail.split('@')[0];
    const username = baseUsername + Math.floor(100 + Math.random() * 900);

    const [accountResult] = await db.query(
      `INSERT INTO accounts (email, username, password_hash, full_name, phone, role, status)
       VALUES (?, ?, ?, ?, ?, 'member', 'active')`,
      [cleanEmail, username, passwordHash, fullName.trim(), cleanPhone]
    );

    const accountId = accountResult.insertId;
    const memberCode = 'KH' + String(accountId).padStart(4, '0');

    await db.query(
      `INSERT INTO members (account_id, member_code, fitness_goal)
       VALUES (?, ?, 'Tập luyện nâng cao thể lực và sức khỏe')`,
      [accountId, memberCode]
    );

    // Tạo thông báo chào mừng thành viên mới
    const [notifResult] = await db.query(
      `INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
       VALUES (1, 'system', 'Chào mừng thành viên mới đến với FitCenter!', 
       'Cảm ơn bạn đã tham gia FitCenter. Hãy đăng ký gói tập hoặc các khóa học nhóm để bắt đầu hành trình nâng cao sức khỏe ngay hôm nay.', NOW(), NOW())`
    );
    await db.query(
      `INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)`,
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
// 2. KHÁCH HÀNG / HỘI VIÊN APIS (CUSTOMER PORTAL)
// =====================================================================

// Helper: lấy Member ID (hoặc mặc định id=6 nếu chưa truyền)
function getMemberId(req) {
  return Number(req.query.memberId || req.body.memberId || req.headers['x-member-id']) || 6;
}

// GET /api/customer/summary (Tổng quan Dashboard của Hội viên)
app.get('/api/customer/summary', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    // 1. Thông tin tài khoản & hội viên
    const [accountRows] = await db.query(`
      SELECT a.id, a.full_name, a.email, a.phone, a.address, a.birth_date,
             m.member_code, m.fitness_goal
      FROM accounts a
      JOIN members m ON a.id = m.account_id
      WHERE a.id = ?
    `, [memberId]);

    if (accountRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin hội viên!' });
    }
    const member = accountRows[0];

    // 2. Gói tập đang kích hoạt
    const [membershipRows] = await db.query(`
      SELECT ms.id, ms.barcode, ms.starts_on, ms.ends_before, ms.status,
             mp.name AS plan_name, mp.duration_months, mp.price_vnd,
             DATEDIFF(ms.ends_before, CURDATE()) AS days_left
      FROM memberships ms
      JOIN membership_plans mp ON ms.plan_id = mp.id
      WHERE ms.member_id = ? AND ms.status = 'activated'
      ORDER BY ms.ends_before DESC LIMIT 1
    `, [memberId]);

    const activeMembership = membershipRows.length > 0 ? membershipRows[0] : null;

    // 3. Lớp học tiếp theo sắp diễn ra
    const [nextSessionRows] = await db.query(`
      SELECT b.id AS booking_id, s.id AS session_id, c.name AS class_name, co.name AS course_name,
             r.name AS room_name, at.full_name AS trainer_name,
             s.starts_at, s.ends_at, b.status AS booking_status
      FROM session_bookings b
      JOIN class_sessions s ON b.session_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN trainers t ON s.trainer_id = t.account_id
      LEFT JOIN accounts at ON t.account_id = at.id
      WHERE b.member_id = ? AND b.status = 'booked' AND s.ends_at >= NOW()
      ORDER BY s.starts_at ASC LIMIT 1
    `, [memberId]);

    const nextSession = nextSessionRows.length > 0 ? nextSessionRows[0] : null;

    // 4. Các ca tập sắp tới trong tuần này (Dashboard List)
    const [upcomingSessions] = await db.query(`
      SELECT b.id AS booking_id, s.id AS session_id, c.name AS class_name, co.name AS course_name,
             r.name AS room_name, at.full_name AS trainer_name,
             s.starts_at, s.ends_at, b.status AS booking_status
      FROM session_bookings b
      JOIN class_sessions s ON b.session_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN trainers t ON s.trainer_id = t.account_id
      LEFT JOIN accounts at ON t.account_id = at.id
      WHERE b.member_id = ? AND b.status = 'booked' AND s.starts_at >= CURDATE()
      ORDER BY s.starts_at ASC LIMIT 5
    `, [memberId]);

    // 5. Thống kê tiến độ (Tổng số buổi đã đặt / đã hoàn thành)
    const [[bookingStats]] = await db.query(`
      SELECT COUNT(*) AS total_booked,
             SUM(CASE WHEN s.ends_at < NOW() AND b.status = 'booked' THEN 1 ELSE 0 END) AS completed_sessions
      FROM session_bookings b
      JOIN class_sessions s ON b.session_id = s.id
      WHERE b.member_id = ?
    `, [memberId]);

    // 6. Số thông báo chưa đọc
    const [[notifStats]] = await db.query(`
      SELECT COUNT(*) AS unread_count
      FROM notification_recipients
      WHERE recipient_id = ? AND read_at IS NULL
    `, [memberId]);

    res.json({
      success: true,
      data: {
        member,
        activeMembership,
        nextSession,
        upcomingSessions,
        stats: {
          totalBooked: bookingStats.total_booked || 0,
          completedSessions: Number(bookingStats.completed_sessions) || 0,
          unreadNotifications: notifStats.unread_count || 0
        }
      }
    });

  } catch (error) {
    console.error('Lỗi API Customer Summary:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/my-schedule (Danh sách lịch học cá nhân đầy đủ)
app.get('/api/customer/my-schedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT b.id AS booking_id, b.status AS booking_status, b.booked_at,
             s.id AS session_id, s.starts_at, s.ends_at, s.status AS session_status,
             c.name AS class_name, co.name AS course_name,
             r.name AS room_name,
             at.full_name AS trainer_name
      FROM session_bookings b
      JOIN class_sessions s ON b.session_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN trainers t ON s.trainer_id = t.account_id
      LEFT JOIN accounts at ON t.account_id = at.id
      WHERE b.member_id = ?
      ORDER BY s.starts_at DESC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/published-schedule (Thời khóa biểu trung tâm công bố)
app.get('/api/customer/published-schedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT s.id AS session_id, s.class_id, s.starts_at, s.ends_at,
             s.capacity, s.reserved_places, s.status,
             (s.capacity - s.reserved_places) AS available_slots,
             c.name AS class_name, co.name AS course_name,
             r.name AS room_name,
             at.full_name AS trainer_name,
             (SELECT COUNT(*) FROM session_bookings sb 
              WHERE sb.session_id = s.id AND sb.member_id = ? AND sb.status = 'booked') AS is_booked_by_me
      FROM class_sessions s
      JOIN classes c ON s.class_id = c.id
      JOIN courses co ON c.course_id = co.id
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN trainers t ON s.trainer_id = t.account_id
      LEFT JOIN accounts at ON t.account_id = at.id
      WHERE s.status = 'published' AND s.starts_at >= CURDATE()
      ORDER BY s.starts_at ASC
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/booking/register (Đăng ký giữ chỗ ca học mới)
app.post('/api/customer/booking/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin ca học!' });
    }

    // 1. Kiểm tra ca học
    const [sessionRows] = await db.query(
      'SELECT * FROM class_sessions WHERE id = ? AND status = "published"',
      [sessionId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ca học không tồn tại hoặc đã bị hủy!' });
    }

    const session = sessionRows[0];

    // Kiểm tra số chỗ trống
    if (session.reserved_places >= session.capacity) {
      return res.status(400).json({ success: false, message: 'Ca học này đã đủ học viên, không thể đăng ký thêm!' });
    }

    // Kiểm tra đã đăng ký chưa
    const [existingBooking] = await db.query(
      'SELECT id, status FROM session_bookings WHERE session_id = ? AND member_id = ?',
      [sessionId, memberId]
    );

    if (existingBooking.length > 0 && existingBooking[0].status === 'booked') {
      return res.status(400).json({ success: false, message: 'Bạn đã đăng ký giữ chỗ cho ca học này rồi!' });
    }

    // 2. Tìm hoặc tạo enrollment
    let enrollmentId;
    const [enrollmentRows] = await db.query(
      'SELECT id FROM enrollments WHERE member_id = ? AND class_id = ? LIMIT 1',
      [memberId, session.class_id]
    );

    if (enrollmentRows.length > 0) {
      enrollmentId = enrollmentRows[0].id;
    } else {
      const [newEnroll] = await db.query(
        'INSERT INTO enrollments (member_id, class_id, status, requested_at) VALUES (?, ?, "approved", NOW())',
        [memberId, session.class_id]
      );
      enrollmentId = newEnroll.insertId;
    }

    // 3. Tạo booking (Trigger trong MySQL sẽ tự động tăng reserved_places của ca học)
    if (existingBooking.length > 0) {
      await db.query(
        'UPDATE session_bookings SET status = "booked", booked_at = NOW() WHERE id = ?',
        [existingBooking[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO session_bookings (enrollment_id, class_id, member_id, session_id, booked_at, status) VALUES (?, ?, ?, ?, NOW(), "booked")',
        [enrollmentId, session.class_id, memberId, sessionId]
      );
    }

    // 4. Tạo thông báo cá nhân
    const [classInfo] = await db.query('SELECT name FROM classes WHERE id = ?', [session.class_id]);
    const className = classInfo.length > 0 ? classInfo[0].name : 'Lớp học';

    const [notif] = await db.query(
      `INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
       VALUES (1, 'booking', 'Đăng ký ca học thành công!', 
       ?, NOW(), NOW())`,
      [`Bạn đã đăng ký thành công ca học môn ${className}. Ca học đã được lưu vào "Lịch học của tôi".`]
    );
    await db.query('INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đăng ký giữ chỗ ca học ${className} thành công!`
    });

  } catch (error) {
    console.error('Lỗi Booking Register:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/booking/cancel (Hủy lịch học)
app.post('/api/customer/booking/cancel', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { bookingId, reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã lượt đặt chỗ!' });
    }

    const [bookingRows] = await db.query(`
      SELECT b.*, c.name AS class_name
      FROM session_bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.id = ? AND b.member_id = ?
    `, [bookingId, memberId]);

    if (bookingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin ca học cần hủy!' });
    }

    const booking = bookingRows[0];

    // Cập nhật trạng thái booking thành cancelled (Trigger MySQL sẽ tự động giảm reserved_places)
    await db.query('UPDATE session_bookings SET status = "cancelled" WHERE id = ?', [bookingId]);

    // Lưu yêu cầu vào booking_change_requests
    await db.query(`
      INSERT INTO booking_change_requests (booking_id, class_id, original_session_id, kind, reason, status, requested_at, resolved_at)
      VALUES (?, ?, ?, 'cancel', ?, 'approved', NOW(), NOW())
    `, [bookingId, booking.class_id, booking.session_id, reason || 'Hội viên tự hủy trên website']);

    // Tạo thông báo
    const [notif] = await db.query(
      `INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
       VALUES (1, 'booking', 'Xác nhận hủy ca học', ?, NOW(), NOW())`,
      [`Đã hủy ca học môn ${booking.class_name} theo yêu cầu của bạn. Buổi học của bạn không bị tính trừ.`]
    );
    await db.query('INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đã hủy ca học ${booking.class_name} thành công!`
    });

  } catch (error) {
    console.error('Lỗi Booking Cancel:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/booking/reschedule (Đổi ca học)
app.post('/api/customer/booking/reschedule', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { bookingId, newSessionId, reason } = req.body;

    if (!bookingId || !newSessionId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin đổi ca học!' });
    }

    // 1. Kiểm tra booking cũ
    const [bookingRows] = await db.query(`
      SELECT b.*, c.name AS class_name
      FROM session_bookings b
      JOIN classes c ON b.class_id = c.id
      WHERE b.id = ? AND b.member_id = ?
    `, [bookingId, memberId]);

    if (bookingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lịch học ban đầu không tồn tại!' });
    }
    const oldBooking = bookingRows[0];

    // 2. Kiểm tra ca học mới
    const [newSessionRows] = await db.query('SELECT * FROM class_sessions WHERE id = ? AND status = "published"', [newSessionId]);
    if (newSessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ca học mới không tồn tại!' });
    }
    const newSession = newSessionRows[0];

    if (newSession.reserved_places >= newSession.capacity) {
      return res.status(400).json({ success: false, message: 'Ca học mới đã kín chỗ!' });
    }

    // 3. Đổi ca: Hủy booking cũ và tạo booking mới
    await db.query('UPDATE session_bookings SET status = "cancelled" WHERE id = ?', [bookingId]);

    const [newBookingResult] = await db.query(`
      INSERT INTO session_bookings (enrollment_id, class_id, member_id, session_id, booked_at, status)
      VALUES (?, ?, ?, ?, NOW(), 'booked')
    `, [oldBooking.enrollment_id, newSession.class_id, memberId, newSessionId]);

    // 4. Lưu lịch sử đổi lịch
    await db.query(`
      INSERT INTO booking_change_requests (booking_id, class_id, original_session_id, target_session_id, kind, reason, status, requested_at, resolved_at)
      VALUES (?, ?, ?, ?, 'reschedule', ?, 'approved', NOW(), NOW())
    `, [newBookingResult.insertId, newSession.class_id, oldBooking.session_id, newSessionId, reason || 'Đổi ca trực tuyến']);

    // 5. Gửi thông báo
    const [notif] = await db.query(
      `INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
       VALUES (1, 'booking', 'Xác nhận đổi ca học thành công', ?, NOW(), NOW())`,
      [`Yêu cầu chuyển ca học môn ${oldBooking.class_name} đã được hệ thống cập nhật thành công.`]
    );
    await db.query('INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: 'Đổi ca học mới thành công!'
    });

  } catch (error) {
    console.error('Lỗi Booking Reschedule:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/courses-and-plans (Danh sách gói tập & khóa học cho Tab 4)
app.get('/api/customer/courses-and-plans', async (req, res) => {
  try {
    const [plans] = await db.query('SELECT * FROM membership_plans WHERE is_active = 1 ORDER BY duration_months ASC');
    const [courses] = await db.query('SELECT * FROM courses WHERE is_active = 1 ORDER BY id ASC');
    res.json({
      success: true,
      data: {
        plans,
        courses
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/membership/register (Đăng ký / Gia hạn gói tập)
app.post('/api/customer/membership/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { planId, paymentMethod } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn gói tập!' });
    }

    const [plans] = await db.query('SELECT * FROM membership_plans WHERE id = ?', [planId]);
    if (plans.length === 0) {
      return res.status(404).json({ success: false, message: 'Gói tập không tồn tại!' });
    }
    const plan = plans[0];

    // Tính toán thời gian
    const barcode = 'MB-' + memberId + '-' + Date.now().toString().slice(-6);

    const [result] = await db.query(`
      INSERT INTO memberships (member_id, plan_id, barcode, starts_on, ends_before, status)
      VALUES (?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? MONTH), 'activated')
    `, [memberId, plan.id, barcode, plan.duration_months]);

    // Gửi thông báo
    const [notif] = await db.query(`
      INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
      VALUES (1, 'membership', 'Đăng ký gói tập thành công!', ?, NOW(), NOW())
    `, [`Bạn đã kích hoạt thành công gói tập ${plan.name} (${plan.duration_months} tháng). Mã thẻ điện tử: ${barcode}.`]);
    await db.query('INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đăng ký gói tập ${plan.name} thành công!`
    });

  } catch (error) {
    console.error('Lỗi Register Membership:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/course/register (Đăng ký khóa học)
app.post('/api/customer/course/register', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { courseId, paymentMethod } = req.body;

    if (!courseId) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn khóa học!' });
    }

    const [courses] = await db.query('SELECT * FROM courses WHERE id = ?', [courseId]);
    if (courses.length === 0) {
      return res.status(404).json({ success: false, message: 'Khóa học không tồn tại!' });
    }
    const course = courses[0];

    // Tìm lớp mở của khóa học này
    const [classes] = await db.query('SELECT id FROM classes WHERE course_id = ? LIMIT 1', [courseId]);
    const classId = classes.length > 0 ? classes[0].id : 1;

    // Thêm vào enrollments
    await db.query(`
      INSERT INTO enrollments (member_id, class_id, status, requested_at)
      VALUES (?, ?, 'pending', NOW())
    `, [memberId, classId]);

    // Gửi thông báo
    const [notif] = await db.query(`
      INSERT INTO notifications (sender_id, category, title, body, created_at, published_at)
      VALUES (1, 'booking', 'Đăng ký khóa học đang chờ xác nhận', ?, NOW(), NOW())
    `, [`Yêu cầu đăng ký khóa học ${course.name} của bạn đã được ghi nhận. Nhân viên quầy sẽ liên hệ xác nhận trong thời gian sớm nhất.`]);
    await db.query('INSERT INTO notification_recipients (notification_id, recipient_id) VALUES (?, ?)', [notif.insertId, memberId]);

    res.json({
      success: true,
      message: `Đăng ký khóa học ${course.name} thành công! Đang chờ duyệt.`
    });

  } catch (error) {
    console.error('Lỗi Register Course:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/notifications (Danh sách thông báo cá nhân)
app.get('/api/customer/notifications', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [rows] = await db.query(`
      SELECT n.id, n.category, n.title, n.body, n.created_at, nr.read_at,
             (nr.read_at IS NOT NULL) AS is_read
      FROM notification_recipients nr
      JOIN notifications n ON nr.notification_id = n.id
      WHERE nr.recipient_id = ?
      ORDER BY n.created_at DESC
      LIMIT 30
    `, [memberId]);

    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/notifications/mark-read (Đánh dấu đã đọc)
app.post('/api/customer/notifications/mark-read', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { notificationId } = req.body;

    if (notificationId) {
      await db.query(
        'UPDATE notification_recipients SET read_at = NOW() WHERE recipient_id = ? AND notification_id = ?',
        [memberId, notificationId]
      );
    } else {
      // Đánh dấu tất cả là đã đọc
      await db.query(
        'UPDATE notification_recipients SET read_at = NOW() WHERE recipient_id = ? AND read_at IS NULL',
        [memberId]
      );
    }

    res.json({ success: true, message: 'Đã cập nhật trạng thái thông báo!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/customer/profile (Xem hồ sơ & chỉ số InBody)
app.get('/api/customer/profile', async (req, res) => {
  try {
    const memberId = getMemberId(req);

    const [accountRows] = await db.query(`
      SELECT a.id, a.full_name, a.email, a.phone, a.address, a.birth_date,
             m.member_code, m.fitness_goal
      FROM accounts a
      JOIN members m ON a.id = m.account_id
      WHERE a.id = ?
    `, [memberId]);

    if (accountRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ hội viên!' });
    }

    // Chỉ số cơ thể gần nhất
    const [measurementRows] = await db.query(`
      SELECT * FROM body_measurements WHERE member_id = ? ORDER BY measured_at DESC LIMIT 1
    `, [memberId]);

    res.json({
      success: true,
      data: {
        profile: accountRows[0],
        measurement: measurementRows.length > 0 ? measurementRows[0] : null
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/customer/profile (Cập nhật hồ sơ)
app.put('/api/customer/profile', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { fullName, phone, email, address, fitnessGoal } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ success: false, message: 'Họ tên và email không được để trống!' });
    }

    // Cập nhật accounts
    await db.query(`
      UPDATE accounts
      SET full_name = ?, phone = ?, email = ?, address = ?
      WHERE id = ?
    `, [fullName.trim(), phone ? phone.trim() : null, email.trim().toLowerCase(), address || null, memberId]);

    // Cập nhật members
    if (fitnessGoal) {
      await db.query(`
        UPDATE members SET fitness_goal = ? WHERE account_id = ?
      `, [fitnessGoal.trim(), memberId]);
    }

    res.json({
      success: true,
      message: 'Cập nhật hồ sơ thành công!'
    });

  } catch (error) {
    console.error('Lỗi Update Profile:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/change-password (Đổi mật khẩu bảo mật)
app.post('/api/customer/change-password', async (req, res) => {
  try {
    const memberId = getMemberId(req);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng điền mật khẩu cũ và mật khẩu mới!' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới tối thiểu 6 ký tự!' });
    }

    const [rows] = await db.query('SELECT password_hash FROM accounts WHERE id = ?', [memberId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tài khoản không tồn tại!' });
    }

    const account = rows[0];

    let isValid = false;
    if (account.password_hash.startsWith('$2b$12$demo_') && currentPassword === '123456') {
      isValid = true;
    } else if (account.password_hash === currentPassword) {
      isValid = true;
    } else {
      try {
        isValid = await bcrypt.compare(currentPassword, account.password_hash);
      } catch (e) {
        isValid = false;
      }
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [newHash, memberId]);

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
// 3. ADMIN & GENERAL APIS
// =====================================================================

app.get('/api/membership-plans', async (req, res) => {
  try {
    const [plans] = await db.query('SELECT * FROM membership_plans WHERE is_active = 1 ORDER BY duration_months ASC');
    res.json({ success: true, data: plans });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/courses', async (req, res) => {
  try {
    const [courses] = await db.query('SELECT * FROM courses WHERE is_active = 1 ORDER BY id ASC');
    res.json({ success: true, data: courses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/trainers', async (req, res) => {
  try {
    const [trainers] = await db.query(`
      SELECT a.id AS account_id, a.full_name, a.email, a.phone, t.specialties, t.biography
      FROM trainers t
      JOIN accounts a ON t.account_id = a.id
      WHERE a.role = 'trainer' AND a.status = 'active'
    `);
    res.json({ success: true, data: trainers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [[{ total_members }]] = await db.query('SELECT COUNT(*) AS total_members FROM members');
    const [[{ total_trainers }]] = await db.query('SELECT COUNT(*) AS total_trainers FROM trainers');
    const [[{ total_courses }]] = await db.query('SELECT COUNT(*) AS total_courses FROM courses');
    const [[{ total_revenue }]] = await db.query(`
      SELECT COALESCE(SUM(cii.line_total_vnd), 0) AS total_revenue
      FROM counter_invoice_items cii
      JOIN counter_invoices ci ON cii.invoice_id = ci.id
      WHERE ci.status = 'paid'
    `);
    const [[{ pending_enrollments }]] = await db.query('SELECT COUNT(*) AS pending_enrollments FROM enrollments WHERE status = "pending"');

    res.json({
      success: true,
      stats: {
        totalMembers: total_members,
        totalTrainers: total_trainers,
        totalCourses: total_courses,
        pendingEnrollments: pending_enrollments,
        totalRevenueVnd: Number(total_revenue)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

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
  console.log(`👑 Mở admin:       http://localhost:${PORT}/admin.html`);
  console.log(`=======================================================`);
});
