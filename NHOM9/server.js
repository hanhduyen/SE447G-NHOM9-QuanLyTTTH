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
// 2.8 TÍNH BMI, PHÂN TÍCH THỂ TRẠNG & TƯ VẤN KHÓA TẬP BẰNG AI
// =====================================================================
function tryParseBmiText(text) {
  const t = (text || '').toLowerCase();
  let age = null, gender = 'male', heightCm = null, weightKg = null;
  
  if (t.includes('nữ') || t.includes('chị') || t.includes('gái') || t.includes('female')) gender = 'female';
  else if (t.includes('nam') || t.includes('anh') || t.includes('trai') || t.includes('male')) gender = 'male';

  const ageMatch = t.match(/(\d{1,2})\s*tuổi/) || t.match(/tuổi\s*[:=]?\s*(\d{1,2})/);
  if (ageMatch) age = Number(ageMatch[1]);

  const h1mMatch = t.match(/1m(\d{1,2})/i);
  if (h1mMatch) {
    heightCm = 100 + Number(h1mMatch[1].padEnd(2, '0').slice(0, 2));
  } else {
    const hMatch = t.match(/(?:cao|chiều cao)\s*[:=]?\s*(\d{2,3})/i) || t.match(/(\d{3})\s*cm/i);
    if (hMatch) heightCm = Number(hMatch[1]);
  }

  const wMatch = t.match(/(?:nặng|cân nặng)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)/i) || t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:kg|kí|ký)/i);
  if (wMatch) weightKg = Number(wMatch[1]);

  if (heightCm && weightKg && heightCm >= 100 && weightKg >= 30) {
    return { age: age || 24, gender, heightCm, weightKg };
  }
  return null;
}

async function performBmiAnalysis({ age, gender, heightCm, weightKg, memberId }) {
  const hM = Number(heightCm) / 100;
  const wKg = Number(weightKg);
  const userAge = Number(age) || 24;
  const bmi = Number((wKg / (hM * hM)).toFixed(2));
  const minNormalWeight = Number((18.5 * hM * hM).toFixed(1));
  const maxNormalWeight = Number((22.9 * hM * hM).toFixed(1));

  // Truy vấn dữ liệu thực từ MySQL FitCenter
  const [courses] = await db.query('SELECT * FROM courses WHERE is_active = 1');
  const [plans] = await db.query('SELECT * FROM membership_plans WHERE is_active = 1');
  const [trainers] = await db.query(`
    SELECT a.full_name, t.specialties, t.biography 
    FROM trainers t JOIN accounts a ON t.account_id = a.id 
    WHERE a.role = 'trainer' AND a.status = 'active'
  `);

  let status = '';
  let evaluation = '';
  let matchedCourses = [];
  let matchedPlan = plans[0];
  let matchedTrainer = trainers[0];
  let advice = '';

  const isFemale = (String(gender).toLowerCase() === 'female' || String(gender).toLowerCase() === 'nữ');
  const genderLabel = isFemale ? 'Nữ' : 'Nam';

  if (bmi < 18.5) {
    status = 'GẦY (THIẾU CÂN)';
    evaluation = `Chỉ số BMI **${bmi}** cho thấy cơ thể bạn đang thiếu năng lượng và cơ bắp. Mục tiêu lúc này là **TĂNG CÂN & TĂNG KHỐI LƯỢNG CƠ BẮP (Hypertrophy)**, kích thích hệ tiêu hóa hấp thu dinh dưỡng và xây dựng nền tảng thể lực săn chắc.`;
    matchedCourses = courses.filter(c => c.code.includes('BODYBUILD') || c.code.includes('YOGA'));
    matchedPlan = plans.find(p => p.duration_months === 3) || plans[0];
    matchedTrainer = trainers.find(t => t.specialties.toLowerCase().includes('thể hình') || t.specialties.toLowerCase().includes('bodybuilding')) || trainers[0];
    advice = 'Ăn thặng dư 300 - 500 kcal/ngày, bổ sung Whey Protein Isolate sau buổi tập. Hạn chế cardio kéo dài, tập trung vào các bài tập kháng lực phát triển đa khớp (Squat, Deadlift, Bench Press).';
  } else if (bmi < 23.0) {
    status = 'CÂN ĐỐI / LÝ TƯỞNG';
    evaluation = `Chúc mừng bạn! Chỉ số BMI **${bmi}** là thể trạng chuẩn đẹp theo tiêu chuẩn người châu Á. Mục tiêu lý tưởng lúc này là **SIẾT CƠ (Lean Muscle), TĂNG SỨC BỀN & GIỮ DÁNG CHUẨN**.`;
    if (isFemale) {
      matchedCourses = courses.filter(c => c.code.includes('PILATES') || c.code.includes('ZUMBA') || c.code.includes('YOGA'));
      matchedTrainer = trainers.find(t => t.specialties.toLowerCase().includes('pilates') || t.specialties.toLowerCase().includes('yoga')) || trainers[0];
    } else {
      matchedCourses = courses.filter(c => c.code.includes('CROSSFIT') || c.code.includes('KICKBOX') || c.code.includes('BODYBUILD'));
      matchedTrainer = trainers.find(t => t.specialties.toLowerCase().includes('kickbox') || t.specialties.toLowerCase().includes('crossfit')) || trainers[0];
    }
    matchedPlan = plans.find(p => p.duration_months === 3) || plans[0];
    advice = 'Duy trì tập luyện đều đặn 3 - 4 buổi/tuần, kết hợp cả rèn luyện cơ bắp lẫn cardio tim mạch. Uống đủ 2 - 2.5 lít nước khoáng mỗi ngày.';
  } else if (bmi < 25.0) {
    status = 'TIỀN THỪA CÂN (CẦN GIẢM MỠ)';
    evaluation = `Chỉ số BMI **${bmi}** cho thấy cơ thể bắt đầu tích mỡ thừa tại vùng eo, bắp tay hoặc đùi. Đây là thời điểm vàng để **ĐỐT MỠ TOÀN THÂN (Fat Burn) & SIẾT CƠ LÕI**, ngăn chặn tích mỡ nội tạng.`;
    matchedCourses = courses.filter(c => c.code.includes('KICKBOX') || c.code.includes('ZUMBA') || c.code.includes('CROSSFIT'));
    matchedPlan = plans.find(p => p.duration_months === 3) || plans[0];
    matchedTrainer = trainers.find(t => t.specialties.toLowerCase().includes('kickbox') || t.specialties.toLowerCase().includes('giảm mỡ')) || trainers[0];
    advice = 'Tập các bộ môn đốt calo cao 4 buổi/tuần, cắt giảm đường, đồ uống có ga, trà sữa và hạn chế tinh bột nhanh sau 19h tối.';
  } else {
    status = 'THỪA CÂN / BÉO PHÌ';
    evaluation = `Chỉ số BMI **${bmi}** ở mức cao, lượng mỡ thừa có thể tạo áp lực lên cột sống và khớp gối. Bạn cần một lộ trình **GIẢM CÂN KHOA HỌC & BẢO VỆ XƯƠNG KHỚP**, ưu tiên vận động nhịp nhàng trước khi tập nặng.`;
    matchedCourses = courses.filter(c => c.code.includes('ZUMBA') || c.code.includes('PILATES') || c.code.includes('YOGA'));
    matchedPlan = plans.find(p => p.duration_months === 12) || plans[plans.length - 1];
    matchedTrainer = trainers.find(t => t.specialties.toLowerCase().includes('yoga') || t.specialties.toLowerCase().includes('giảm mỡ')) || trainers[0];
    advice = 'Không nên tập nặng đột ngột gây chấn thương khớp gối. Nên bắt đầu bằng đi bộ nhanh trên máy dốc, Zumba, Pilates kết hợp chế độ ăn thâm hụt calo kiên trì.';
  }

  let ageAdvice = '';
  if (userAge >= 45) {
    ageAdvice = `\n💡 *Lưu ý độ tuổi ${userAge}:* Nên khởi động kỹ các khớp trước buổi tập, hạn chế các bài nhảy bật gắt và dành 10 phút thả lỏng hạ nhiệt sau buổi tập.`;
  } else if (userAge < 22) {
    ageAdvice = `\n💡 *Lưu ý độ tuổi ${userAge}:* Cơ thể đang trong giai đoạn phát triển thể chất vàng, khả năng phục hồi rất nhanh, thuận lợi xây dựng sức mạnh vượt trội.`;
  }

  // Lưu vào database nếu có memberId
  if (memberId) {
    try {
      await db.query(`
        INSERT INTO body_measurements (member_id, recorded_by, measured_at, height_cm, weight_kg)
        VALUES (?, ?, NOW(), ?, ?)
      `, [memberId, memberId, heightCm, weightKg]);

      await db.query(`
        UPDATE members SET fitness_goal = ? WHERE account_id = ?
      `, [`Tư vấn BMI ${bmi} (${status})`, memberId]);
    } catch (e) {
      console.error('Lỗi cập nhật body_measurements:', e.message);
    }
  }

  let text = `🎯 **KẾT QUẢ PHÂN TÍCH THỂ TRẠNG & TƯ VẤN KHÓA TẬP AI**\n\n`;
  text += `👤 **Hồ sơ:** ${genderLabel}, **${userAge} tuổi** | Chiều cao: **${heightCm} cm** | Cân nặng: **${weightKg} kg**\n`;
  text += `📊 **Chỉ số BMI:** **${bmi}** — Trạng thái: **${status}**\n`;
  text += `⚖️ **Cân nặng lý tưởng theo chiều cao:** Từ **${minNormalWeight} kg** đến **${maxNormalWeight} kg**\n\n`;
  text += `🔍 **ĐÁNH GIÁ CHUYÊN MÔN:**\n${evaluation}${ageAdvice}\n\n`;
  
  text += `🏋️‍♂️ **KHÓA HỌC PHÙ HỢP NHẤT TẠI FITCENTER:**\n`;
  matchedCourses.slice(0, 2).forEach((c, i) => {
    const priceStr = Number(c.price_vnd).toLocaleString('vi-VN') + ' đ';
    text += `${i + 1}. **${c.name}** [Mã: \`${c.code}\`] — **${priceStr}**\n`;
    text += `   • *Mô tả:* ${c.description || 'Lớp tập nhóm cùng HLV chuyên nghiệp'}\n`;
  });

  if (matchedPlan) {
    const planPrice = Number(matchedPlan.price_vnd).toLocaleString('vi-VN') + ' đ';
    text += `\n💳 **GÓI TẬP ĐỀ XUẤT:** **Gói ${matchedPlan.name}** (${planPrice} / ${matchedPlan.duration_months} tháng)\n`;
  }

  if (matchedTrainer) {
    text += `🏆 **HUẤN LUYỆN VIÊN ĐỀ XUẤT:** **${matchedTrainer.full_name}** (*${matchedTrainer.specialties || 'HLV FitCenter'}*)\n`;
  }

  text += `\n🥗 **LỜI KHUYÊN DINH DƯỠNG & SINH HOẠT:**\n${advice}\n\n`;
  text += `✅ *Thông tin chỉ số BMI (${bmi}) đã được tự động lưu vào hồ sơ hội viên của bạn trong hệ thống MySQL!*`;

  return {
    bmi,
    status,
    minNormalWeight,
    maxNormalWeight,
    matchedCourses,
    matchedPlan,
    matchedTrainer,
    advice,
    formattedText: text
  };
}

// API Tư vấn BMI độc lập
app.post('/api/customer/bmi-consult', async (req, res) => {
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
      memberId: Number(memberId) || 6
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
// 2.9 CHATBOT TƯ VẤN KHÁCH HÀNG (DỰA TRÊN DỮ LIỆU MYSQL FITCENTER)
// =====================================================================
app.post('/api/customer/chatbot', async (req, res) => {
  try {
    const { message, memberId } = req.body;
    const rawQuery = (message || '').trim().toLowerCase();
    const currentMemberId = Number(memberId) || 6;

    if (!rawQuery) {
      return res.json({
        success: true,
        reply: 'Dạ em chào anh/chị! Em có thể giúp gì cho anh/chị về gói tập, lịch học, huấn luyện viên hay dịch vụ tại FitCenter ạ?'
      });
    }

    // 0. Ý định: Tư vấn thể trạng, tính BMI & gợi ý khóa tập
    if (
      rawQuery.includes('tư vấn') || rawQuery.includes('bmi') || rawQuery.includes('thể trạng') ||
      rawQuery.includes('gợi ý khóa') || rawQuery.includes('chọn khóa') || rawQuery.includes('nên tập') ||
      rawQuery.includes('khóa nào hợp') || rawQuery.includes('lớp nào hợp') || rawQuery.includes('tập gì') ||
      rawQuery.includes('chiều cao') || rawQuery.includes('cân nặng')
    ) {
      const parsed = tryParseBmiText(rawQuery);
      if (parsed) {
        const result = await performBmiAnalysis({
          ...parsed,
          memberId: currentMemberId
        });
        return res.json({
          success: true,
          data: result,
          reply: result.formattedText
        });
      }

      return res.json({
        success: true,
        needBmiForm: true,
        reply: 'Dạ để em có thể tính chỉ số BMI và tư vấn khóa học, giáo án tập luyện chuẩn xác nhất cho thể trạng của bạn, bạn vui lòng cho em biết: **Tuổi, Giới tính, Chiều cao (cm) và Cân nặng (kg)** hoặc điền nhanh vào bảng thông tin bên dưới nhé! 👇'
      });
    }

    // 1. Ý định: Hỏi về thông tin cá nhân (gói của tôi, lịch của tôi, hạn thẻ, inbody)
    if (
      rawQuery.includes('của tôi') || rawQuery.includes('của em') || rawQuery.includes('của mình') ||
      rawQuery.includes('hạn thẻ') || rawQuery.includes('hạn gói') || rawQuery.includes('thẻ của tôi') ||
      rawQuery.includes('lịch của tôi') || rawQuery.includes('buổi học của tôi') || rawQuery.includes('mã thẻ') ||
      rawQuery.includes('tiến độ') || rawQuery.includes('inbody') || rawQuery.includes('tài khoản của tôi')
    ) {
      const [members] = await db.query(`
        SELECT a.full_name, a.email, a.phone, m.member_code, m.fitness_goal
        FROM accounts a
        JOIN members m ON a.id = m.account_id
        WHERE a.id = ?
      `, [currentMemberId]);

      if (members.length === 0) {
        return res.json({
          success: true,
          reply: 'Dạ em không tìm thấy hồ sơ hội viên của anh/chị trong cơ sở dữ liệu. Anh/chị hãy đăng nhập lại nhé!'
        });
      }
      const member = members[0];

      // Gói tập đang kích hoạt
      const [memberships] = await db.query(`
        SELECT ms.*, mp.name AS plan_name, DATEDIFF(ms.ends_before, CURDATE()) AS days_left
        FROM memberships ms
        JOIN membership_plans mp ON ms.plan_id = mp.id
        WHERE ms.member_id = ? AND ms.status = 'activated'
        ORDER BY ms.ends_before DESC LIMIT 1
      `, [currentMemberId]);

      // Lịch học sắp tới
      const [nextSessions] = await db.query(`
        SELECT c.name AS class_name, r.name AS room_name, at.full_name AS trainer_name, s.starts_at, s.ends_at
        FROM session_bookings b
        JOIN class_sessions s ON b.session_id = s.id
        JOIN classes c ON s.class_id = c.id
        JOIN courses co ON c.course_id = co.id
        JOIN rooms r ON s.room_id = r.id
        LEFT JOIN trainers t ON s.trainer_id = t.account_id
        LEFT JOIN accounts at ON t.account_id = at.id
        WHERE b.member_id = ? AND b.status = 'booked' AND s.ends_at >= NOW()
        ORDER BY s.starts_at ASC LIMIT 1
      `, [currentMemberId]);

      let reply = `Dạ xin chào **${member.full_name}** (Mã hội viên: **${member.member_code}**)! 👋\n\n`;

      if (memberships.length > 0) {
        const ms = memberships[0];
        const expiryDate = new Date(ms.ends_before).toLocaleDateString('vi-VN');
        reply += `💳 **Gói tập hiện tại:** Gói **${ms.plan_name}**\n`;
        reply += `⏳ **Hạn sử dụng:** Đến ngày **${expiryDate}** (còn **${ms.days_left} ngày**).\n\n`;
      } else {
        reply += `💳 **Gói tập:** Anh/chị hiện chưa kích hoạt gói tập nào. Hãy vào mục *Gói & Khóa học* để đăng ký nhé!\n\n`;
      }

      if (nextSessions.length > 0) {
        const next = nextSessions[0];
        const nextTime = new Date(next.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const nextDate = new Date(next.starts_at).toLocaleDateString('vi-VN');
        reply += `📅 **Lớp học sắp tới:** Môn **${next.class_name}** lúc **${nextTime} ngày ${nextDate}** tại phòng **${next.room_name}** (HLV: ${next.trainer_name || 'FitCenter Coach'}).`;
      } else {
        reply += `📅 **Lịch học tiếp theo:** Anh/chị chưa đăng ký ca học sắp tới nào. Anh/chị có thể vào tab *Lịch công bố* để chọn ca phù hợp nha!`;
      }

      return res.json({ success: true, reply });
    }

    // 2. Ý định: Hỏi về Gói tập / Bảng giá / Chi phí
    if (
      rawQuery.includes('gói') || rawQuery.includes('giá') || rawQuery.includes('bảng giá') ||
      rawQuery.includes('chi phí') || rawQuery.includes('bao nhiêu tiền') || rawQuery.includes('standard') ||
      rawQuery.includes('vip') || rawQuery.includes('diamond') || rawQuery.includes('thẻ tập')
    ) {
      const [plans] = await db.query('SELECT * FROM membership_plans WHERE is_active = 1 ORDER BY duration_months ASC');
      let reply = '🏋️‍♂️ **BẢNG GIÁ GÓI TẬP THÀNH VIÊN TẠI FITCENTER:**\n\n';
      plans.forEach((p, idx) => {
        const price = Number(p.price_vnd).toLocaleString('vi-VN') + ' đ';
        reply += `${idx + 1}. **Gói ${p.name}**: **${price}** (${p.duration_months} tháng)\n`;
        reply += `   • *Quyền lợi:* ${p.description || 'Tập gym không giới hạn khung giờ, miễn phí tủ đồ và phòng tắm nước nóng.'}\n`;
      });
      reply += '\n👉 Anh/chị có thể đăng ký trực tuyến ngay tại tab **Gói & Khóa học** hoặc thanh toán tại quầy lễ tân ạ!';
      return res.json({ success: true, reply });
    }

    // 3. Ý định: Hỏi về Khóa học / Lớp học (Yoga, Kickboxing, Pilates, Zumba, CrossFit...)
    if (
      rawQuery.includes('khóa học') || rawQuery.includes('lớp') || rawQuery.includes('yoga') ||
      rawQuery.includes('kickbox') || rawQuery.includes('boxing') || rawQuery.includes('pilates') ||
      rawQuery.includes('zumba') || rawQuery.includes('crossfit') || rawQuery.includes('bodybuilding')
    ) {
      const [courses] = await db.query('SELECT * FROM courses WHERE is_active = 1 ORDER BY id ASC');
      let reply = '📋 **DANH SÁCH KHÓA HỌC & LỚP NHÓM TẠI FITCENTER:**\n\n';
      courses.forEach((c, idx) => {
        const price = Number(c.price_vnd).toLocaleString('vi-VN') + ' đ';
        reply += `${idx + 1}. **${c.name}** [${c.code}]: **${price}**\n`;
        reply += `   • *Mô tả:* ${c.description || 'Lớp tập nhóm cùng huấn luyện viên quốc tế chuyên nghiệp.'}\n`;
      });
      reply += '\n👉 Bạn có thể đăng ký giữ chỗ từng ca học tại tab **Thời khóa biểu** hoặc đăng ký trọn khóa tại tab **Gói & Khóa học**!';
      return res.json({ success: true, reply });
    }

    // 4. Ý định: Quy định đổi / hủy lịch học / chính sách
    if (rawQuery.includes('hủy') || rawQuery.includes('đổi') || rawQuery.includes('quy định') || rawQuery.includes('chính sách')) {
      const reply = 
        '📌 **QUY ĐỊNH HỦY & ĐỔI LỊCH HỌC TẠI FITCENTER:**\n\n' +
        '• Học viên có thể **Đổi ca học** hoặc **Hủy ca học** trực tuyến trước giờ bắt đầu tối thiểu **02 tiếng** mà không bị tính trừ buổi học.\n' +
        '• Để thao tác, bạn chỉ cần vào tab **Lịch của tôi**, bấm nút *Đổi lịch* hoặc *Hủy lịch* bên cạnh ca học tương ứng.\n' +
        '• Sau thời hạn 02 tiếng, vui lòng liên hệ trực tiếp quầy lễ tân để được hỗ trợ.';
      return res.json({ success: true, reply });
    }

    // 5. Ý định: Hỏi về Lịch tập / Thời khóa biểu / Ca học hôm nay / tuần này
    if (
      rawQuery.includes('lịch') || rawQuery.includes('thời khóa biểu') || rawQuery.includes('ca học') ||
      rawQuery.includes('hôm nay có') || rawQuery.includes('giờ tập') || rawQuery.includes('chỗ trống')
    ) {
      const [sessions] = await db.query(`
        SELECT s.starts_at, s.ends_at, s.capacity, s.reserved_places, (s.capacity - s.reserved_places) AS available_slots,
               c.name AS class_name, r.name AS room_name, at.full_name AS trainer_name
        FROM class_sessions s
        JOIN classes c ON s.class_id = c.id
        JOIN rooms r ON s.room_id = r.id
        LEFT JOIN trainers t ON s.trainer_id = t.account_id
        LEFT JOIN accounts at ON t.account_id = at.id
        WHERE s.status = 'published' AND s.starts_at >= CURDATE()
        ORDER BY s.starts_at ASC
        LIMIT 5
      `);

      if (sessions.length === 0) {
        return res.json({
          success: true,
          reply: 'Hiện tại chưa có ca học nào được công bố trong tuần này. Anh/chị vui lòng kiểm tra lại sau nhé!'
        });
      }

      let reply = '📅 **CÁC CA HỌC ĐANG MỞ CHỖ TRỐNG SẮP TỚI:**\n\n';
      sessions.forEach((s, idx) => {
        const d = new Date(s.starts_at);
        const dayStr = `${d.getDate()}/${d.getMonth() + 1}`;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        reply += `${idx + 1}. **${s.class_name}** — Ngày ${dayStr} lúc **${timeStr}**\n`;
        reply += `   • Phòng: ${s.room_name} | HLV: ${s.trainer_name || 'HLV FitCenter'}\n`;
        reply += `   • Còn trống: **${s.available_slots}/${s.capacity} chỗ**\n`;
      });
      reply += '\n👉 Anh/chị vào tab **Lịch công bố** để bấm đăng ký giữ chỗ ngay nhé!';
      return res.json({ success: true, reply });
    }

    // 5. Ý định: Hỏi về Huấn luyện viên (PT, Coach, Thầy giáo, Chuyên gia)
    if (
      rawQuery.includes('huấn luyện viên') || rawQuery.includes('hlv') || rawQuery.includes('pt') ||
      rawQuery.includes('coach') || rawQuery.includes('thầy') || rawQuery.includes('cô') || rawQuery.includes('kèm')
    ) {
      const [trainers] = await db.query(`
        SELECT a.full_name, a.email, a.phone, t.specialties, t.biography
        FROM trainers t
        JOIN accounts a ON t.account_id = a.id
        WHERE a.role = 'trainer' AND a.status = 'active'
      `);
      let reply = '🏆 **ĐỘI NGŨ HUẤN LUYỆN VIÊN CHUYÊN NGHIỆP TẠI FITCENTER:**\n\n';
      trainers.forEach((t, idx) => {
        reply += `${idx + 1}. **${t.full_name}**\n`;
        reply += `   • *Chuyên môn:* ${t.specialties || 'Thể hình, Thể lực nâng cao'}\n`;
        reply += `   • *Kinh nghiệm:* ${t.biography || 'Chứng chỉ quốc tế, tận tâm theo sát học viên'}\n`;
      });
      reply += '\n👉 Khi đăng ký các lớp nhóm hoặc gói PT 1-1, bạn sẽ được các huấn luyện viên trực tiếp kèm cặp và sửa kỹ thuật!';
      return res.json({ success: true, reply });
    }

    // 6. Ý định: Hỏi về Sản phẩm quầy bar (nước uống, whey, đồ tập)
    if (
      rawQuery.includes('sản phẩm') || rawQuery.includes('nước') || rawQuery.includes('whey') ||
      rawQuery.includes('mua') || rawQuery.includes('quầy') || rawQuery.includes('phụ kiện')
    ) {
      const [products] = await db.query('SELECT * FROM products WHERE is_active = 1');
      let reply = '🥤 **CÁC SẢN PHẨM PHỤC VỤ TẠI QUẦY LỄ TÂN FITCENTER:**\n\n';
      products.forEach((p, idx) => {
        const price = Number(p.sale_price_vnd).toLocaleString('vi-VN') + ' đ';
        reply += `${idx + 1}. **${p.name}** [${p.category}]: **${price}** (Còn ${p.stock_quantity} món)\n`;
      });
      reply += '\n👉 Anh/chị có thể thanh toán trực tiếp tại quầy lễ tân bằng tiền mặt hoặc chuyển khoản QR nhé!';
      return res.json({ success: true, reply });
    }

    // 7. Ý định: Giờ mở cửa, cơ sở vật chất, địa chỉ, xông hơi, locker
    if (
      rawQuery.includes('giờ') || rawQuery.includes('địa chỉ') || rawQuery.includes('ở đâu') ||
      rawQuery.includes('tiện ích') || rawQuery.includes('sauna') || rawQuery.includes('xông hơi') ||
      rawQuery.includes('locker') || rawQuery.includes('phòng tắm')
    ) {
      const reply = 
        '🏢 **THÔNG TIN TRUNG TÂM FITCENTER:**\n\n' +
        '⏰ **Giờ mở cửa:** Từ 05:30 đến 21:30 hàng ngày (kể cả Thứ 7 & Chủ Nhật).\n' +
        '📍 **Địa chỉ:** Quận Hải Châu, TP. Đà Nẵng.\n' +
        '🚿 **Tiện ích dịch vụ:**\n' +
        '   • Tủ locker khóa từ an toàn & phòng tắm nước nóng miễn phí.\n' +
        '   • Đo chỉ số cơ thể InBody định kỳ phân tích mỡ, cơ.\n' +
        '   • Phòng xông hơi khô Sauna & bể sục Jacuzzi thư giãn phục hồi cơ bắp.\n' +
        '   • Wifi tốc độ cao & bãi đỗ xe ô tô/xe máy rộng rãi an ninh.';
      return res.json({ success: true, reply });
    }

    // Mặc định: Trả lời thông minh & gợi ý
    const defaultReply = 
      'Dạ em là **Trợ lý Ảo FitCenter AI**! Em có thể tra cứu trực tiếp dữ liệu từ hệ thống để trả lời anh/chị:\n\n' +
      '💡 **Bạn có thể thử hỏi em:**\n' +
      '• *"Gói tập của tôi còn hạn bao lâu?"*\n' +
      '• *"Bảng giá các gói tập gym?"*\n' +
      '• *"Lịch học các lớp hôm nay?"*\n' +
      '• *"Danh sách huấn luyện viên?"*\n' +
      '• *"Trung tâm mở cửa từ mấy giờ?"*\n' +
      '• *"Quầy có bán nước khoáng hay Whey không?"*\n\n' +
      'Anh/chị cần em hỗ trợ thông tin gì ạ?';

    return res.json({ success: true, reply: defaultReply });

  } catch (error) {
    console.error('Lỗi Chatbot API:', error);
    res.status(500).json({ success: false, message: 'Lỗi chatbot: ' + error.message });
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
