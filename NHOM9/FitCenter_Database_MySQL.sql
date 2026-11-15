-- =====================================================================
-- FitCenter Database | MySQL 8.0+
-- Tương thích hoàn toàn từ kiến trúc FitCenter_Database.sql (PostgreSQL)
-- Đồ án CDIO SE447 G - Xây dựng Website quản lý trung tâm thể hình
-- =====================================================================

CREATE DATABASE IF NOT EXISTS fitcenter 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

USE fitcenter;

-- Vô hiệu hóa kiểm tra khóa ngoại tạm thời để khởi tạo lại sạch sẽ
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_conversations;
DROP TABLE IF EXISTS notification_recipients;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS counter_invoice_items;
DROP TABLE IF EXISTS counter_invoices;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS training_assessments;
DROP TABLE IF EXISTS body_measurements;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS facility_checkins;
DROP TABLE IF EXISTS booking_change_requests;
DROP TABLE IF EXISTS session_bookings;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS class_sessions;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS membership_plans;
DROP TABLE IF EXISTS trainer_work_hours;
DROP TABLE IF EXISTS trainer_certifications;
DROP TABLE IF EXISTS trainers;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS accounts;

DROP VIEW IF EXISTS daily_new_members;
DROP VIEW IF EXISTS daily_facility_checkins;
DROP VIEW IF EXISTS daily_course_enrollments;
DROP VIEW IF EXISTS daily_counter_revenue;
DROP VIEW IF EXISTS session_attendance_report;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 1. UC01–04, UC12, UC19: TÀI KHOẢN, HỘI VIÊN VÀ NHÂN SỰ
-- =====================================================================

CREATE TABLE accounts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    username VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE,
    address TEXT,
    birth_date DATE,
    role ENUM('member', 'trainer', 'staff', 'admin') NOT NULL DEFAULT 'member',
    status ENUM('pending', 'active', 'locked', 'inactive') NOT NULL DEFAULT 'active',
    terms_accepted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT accounts_email_unique UNIQUE (email),
    CONSTRAINT accounts_username_unique UNIQUE (username)
) ENGINE=InnoDB;

CREATE TABLE members (
    account_id BIGINT PRIMARY KEY,
    member_code VARCHAR(50) NOT NULL UNIQUE,
    fitness_goal TEXT,
    CONSTRAINT fk_members_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE trainers (
    account_id BIGINT PRIMARY KEY,
    specialties TEXT,
    biography TEXT,
    CONSTRAINT fk_trainers_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE trainer_certifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trainer_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    issuer VARCHAR(255),
    issued_on DATE,
    expires_on DATE,
    CONSTRAINT fk_cert_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(account_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Giờ địa phương Asia/Ho_Chi_Minh: Thứ 2 = 1 đến Chủ Nhật = 7
CREATE TABLE trainer_work_hours (
    trainer_id BIGINT NOT NULL,
    weekday TINYINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    starts_at TIME NOT NULL,
    ends_at TIME NOT NULL,
    PRIMARY KEY (trainer_id, weekday, starts_at),
    CONSTRAINT fk_work_hours_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(account_id) ON DELETE CASCADE,
    CONSTRAINT chk_work_hours_time CHECK (starts_at < ends_at)
) ENGINE=InnoDB;

-- =====================================================================
-- 2. UC05, UC14: GÓI TẬP VÀ THẺ CỦA HỘI VIÊN
-- =====================================================================

CREATE TABLE membership_plans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    duration_months SMALLINT NOT NULL CHECK (duration_months > 0),
    price_vnd DECIMAL(14,0) NOT NULL CHECK (price_vnd >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Dữ liệu mẫu chuẩn từ hệ thống FitCenter
INSERT INTO membership_plans (code, name, duration_months, price_vnd) VALUES
    ('STANDARD', 'Standard', 1, 500000),
    ('VIP', 'VIP', 3, 1200000),
    ('DIAMOND', 'Diamond', 12, 4500000);

CREATE TABLE memberships (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    member_id BIGINT NOT NULL,
    plan_id BIGINT NOT NULL,
    barcode VARCHAR(100) NOT NULL UNIQUE,
    starts_on DATE NOT NULL,
    ends_before DATE NOT NULL,
    status ENUM('pending', 'activated', 'cancelled') NOT NULL DEFAULT 'pending',
    CONSTRAINT fk_memberships_member FOREIGN KEY (member_id) REFERENCES members(account_id) ON DELETE CASCADE,
    CONSTRAINT fk_memberships_plan FOREIGN KEY (plan_id) REFERENCES membership_plans(id),
    CONSTRAINT chk_membership_dates CHECK (starts_on < ends_before),
    UNIQUE KEY uq_memberships_id_member (id, member_id)
) ENGINE=InnoDB;

CREATE INDEX idx_memberships_member_dates ON memberships (member_id, starts_on, ends_before);

-- =====================================================================
-- 3. UC05–09, UC13–17: KHÓA HỌC, ĐỢT MỞ LỚP VÀ TỪNG BUỔI HỌC
-- =====================================================================

CREATE TABLE rooms (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    capacity INT NOT NULL CHECK (capacity > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE courses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price_vnd DECIMAL(14,0) NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE classes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    name VARCHAR(150) NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    status ENUM('draft', 'open', 'closed', 'cancelled') NOT NULL DEFAULT 'draft',
    reserved_places INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_classes_course FOREIGN KEY (course_id) REFERENCES courses(id),
    CONSTRAINT chk_classes_reserved CHECK (reserved_places BETWEEN 0 AND capacity)
) ENGINE=InnoDB;

CREATE INDEX idx_classes_course ON classes (course_id);

CREATE TABLE class_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    class_id BIGINT NOT NULL,
    room_id BIGINT NOT NULL,
    trainer_id BIGINT,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    reserved_places INT NOT NULL DEFAULT 0,
    status ENUM('draft', 'published', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
    CONSTRAINT fk_sessions_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    CONSTRAINT fk_sessions_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_sessions_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(account_id),
    CONSTRAINT chk_sessions_time CHECK (ends_at > starts_at),
    CONSTRAINT chk_sessions_reserved CHECK (reserved_places BETWEEN 0 AND capacity),
    UNIQUE KEY uq_sessions_id_class (id, class_id)
) ENGINE=InnoDB;

CREATE INDEX idx_sessions_schedule ON class_sessions (starts_at, status);
CREATE INDEX idx_sessions_trainer ON class_sessions (trainer_id, starts_at);

CREATE TABLE enrollments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    member_id BIGINT NOT NULL,
    class_id BIGINT NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME,
    reviewed_by BIGINT,
    review_note TEXT,
    CONSTRAINT fk_enroll_member FOREIGN KEY (member_id) REFERENCES members(account_id) ON DELETE CASCADE,
    CONSTRAINT fk_enroll_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    CONSTRAINT fk_enroll_reviewer FOREIGN KEY (reviewed_by) REFERENCES accounts(id),
    UNIQUE KEY uq_enroll_id_class_member (id, class_id, member_id)
) ENGINE=InnoDB;

CREATE INDEX idx_enrollments_pending ON enrollments (requested_at, status);

CREATE TABLE session_bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enrollment_id BIGINT NOT NULL,
    class_id BIGINT NOT NULL,
    member_id BIGINT NOT NULL,
    session_id BIGINT NOT NULL,
    booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('booked', 'cancelled', 'rescheduled') NOT NULL DEFAULT 'booked',
    CONSTRAINT fk_bookings_enrollment FOREIGN KEY (enrollment_id, class_id, member_id)
        REFERENCES enrollments(id, class_id, member_id) ON DELETE CASCADE,
    CONSTRAINT fk_bookings_session FOREIGN KEY (session_id, class_id)
        REFERENCES class_sessions(id, class_id) ON DELETE CASCADE,
    UNIQUE KEY uq_bookings_id_class_session (id, class_id, session_id),
    UNIQUE KEY uq_bookings_member_session (member_id, session_id, status)
) ENGINE=InnoDB;

-- =====================================================================
-- 4. TRIGGERS DUY TRÌ SỐ CHỖ ĐÃ GIỮ (RESERVED PLACES)
-- =====================================================================

DELIMITER $$

CREATE TRIGGER trg_enrollments_insert AFTER INSERT ON enrollments
FOR EACH ROW
BEGIN
    IF NEW.status IN ('pending', 'approved') THEN
        UPDATE classes SET reserved_places = reserved_places + 1 WHERE id = NEW.class_id;
    END IF;
END$$

CREATE TRIGGER trg_enrollments_update AFTER UPDATE ON enrollments
FOR EACH ROW
BEGIN
    DECLARE old_holds INT DEFAULT 0;
    DECLARE new_holds INT DEFAULT 0;
    IF OLD.status IN ('pending', 'approved') THEN SET old_holds = 1; END IF;
    IF NEW.status IN ('pending', 'approved') THEN SET new_holds = 1; END IF;
    
    IF old_holds <> new_holds THEN
        UPDATE classes SET reserved_places = reserved_places + new_holds - old_holds WHERE id = NEW.class_id;
    END IF;
END$$

CREATE TRIGGER trg_enrollments_delete AFTER DELETE ON enrollments
FOR EACH ROW
BEGIN
    IF OLD.status IN ('pending', 'approved') THEN
        UPDATE classes SET reserved_places = reserved_places - 1 WHERE id = OLD.class_id;
    END IF;
END$$

CREATE TRIGGER trg_bookings_insert AFTER INSERT ON session_bookings
FOR EACH ROW
BEGIN
    IF NEW.status = 'booked' THEN
        UPDATE class_sessions SET reserved_places = reserved_places + 1 WHERE id = NEW.session_id;
    END IF;
END$$

CREATE TRIGGER trg_bookings_update AFTER UPDATE ON session_bookings
FOR EACH ROW
BEGIN
    DECLARE old_holds INT DEFAULT 0;
    DECLARE new_holds INT DEFAULT 0;
    IF OLD.status = 'booked' THEN SET old_holds = 1; END IF;
    IF NEW.status = 'booked' THEN SET new_holds = 1; END IF;
    
    IF old_holds <> new_holds THEN
        UPDATE class_sessions SET reserved_places = reserved_places + new_holds - old_holds WHERE id = NEW.session_id;
    END IF;
END$$

CREATE TRIGGER trg_bookings_delete AFTER DELETE ON session_bookings
FOR EACH ROW
BEGIN
    IF OLD.status = 'booked' THEN
        UPDATE class_sessions SET reserved_places = reserved_places - 1 WHERE id = OLD.session_id;
    END IF;
END$$

DELIMITER ;

-- =====================================================================
-- 5. UC08: YÊU CẦU HỦY HOẶC ĐỔI LỊCH HỌC
-- =====================================================================

CREATE TABLE booking_change_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    class_id BIGINT NOT NULL,
    original_session_id BIGINT NOT NULL,
    target_session_id BIGINT,
    kind ENUM('cancel', 'reschedule') NOT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected', 'withdrawn') NOT NULL DEFAULT 'pending',
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by BIGINT,
    CONSTRAINT fk_bcr_booking FOREIGN KEY (booking_id, class_id, original_session_id)
        REFERENCES session_bookings(id, class_id, session_id) ON DELETE CASCADE,
    CONSTRAINT fk_bcr_target_session FOREIGN KEY (target_session_id, class_id)
        REFERENCES class_sessions(id, class_id),
    CONSTRAINT fk_bcr_resolver FOREIGN KEY (resolved_by) REFERENCES accounts(id)
) ENGINE=InnoDB;

-- =====================================================================
-- 6. UC04, UC11, UC18: CHECK-IN, ĐIỂM DANH VÀ THEO DÕI THỂ TRẠNG
-- =====================================================================

CREATE TABLE facility_checkins (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    member_id BIGINT NOT NULL,
    membership_id BIGINT,
    checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by BIGINT,
    method ENUM('barcode', 'phone', 'manual') NOT NULL,
    CONSTRAINT fk_checkin_member FOREIGN KEY (member_id) REFERENCES members(account_id) ON DELETE CASCADE,
    CONSTRAINT fk_checkin_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(id),
    CONSTRAINT fk_checkin_membership FOREIGN KEY (membership_id, member_id)
        REFERENCES memberships(id, member_id)
) ENGINE=InnoDB;

CREATE INDEX idx_checkins_time ON facility_checkins (checked_in_at);

CREATE TABLE attendance (
    booking_id BIGINT PRIMARY KEY,
    status ENUM('present', 'absent') NOT NULL,
    recorded_by BIGINT NOT NULL,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trainer_rating TINYINT CHECK (trainer_rating BETWEEN 1 AND 5),
    CONSTRAINT fk_att_booking FOREIGN KEY (booking_id) REFERENCES session_bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_att_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(id)
) ENGINE=InnoDB;

CREATE TABLE body_measurements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    member_id BIGINT NOT NULL,
    recorded_by BIGINT NOT NULL,
    measured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    height_cm DECIMAL(5,2) NOT NULL CHECK (height_cm > 0),
    weight_kg DECIMAL(5,2) NOT NULL CHECK (weight_kg > 0),
    bmi DECIMAL(12,2) AS (ROUND(weight_kg * 10000 / (height_cm * height_cm), 2)) STORED,
    CONSTRAINT fk_bm_member FOREIGN KEY (member_id) REFERENCES members(account_id) ON DELETE CASCADE,
    CONSTRAINT fk_bm_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(id)
) ENGINE=InnoDB;

CREATE INDEX idx_body_measurements ON body_measurements (member_id, measured_at);

CREATE TABLE training_assessments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    trainer_id BIGINT NOT NULL,
    assessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    weight_kg DECIMAL(5,2) CHECK (weight_kg > 0),
    fitness_notes TEXT,
    technique_notes TEXT,
    next_training_plan TEXT,
    CONSTRAINT fk_ta_booking FOREIGN KEY (booking_id) REFERENCES attendance(booking_id) ON DELETE CASCADE,
    CONSTRAINT fk_ta_trainer FOREIGN KEY (trainer_id) REFERENCES trainers(account_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 7. UC20–22: SẢN PHẨM CỬA HÀNG VÀ HÓA ĐƠN BÁN TẠI QUẦY
-- =====================================================================

CREATE TABLE products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    sale_price_vnd DECIMAL(14,0) NOT NULL CHECK (sale_price_vnd >= 0),
    stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE counter_invoices (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    member_id BIGINT,
    cashier_id BIGINT NOT NULL,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    status ENUM('draft', 'paid', 'void') NOT NULL DEFAULT 'draft',
    payment_method ENUM('cash', 'card', 'bank_transfer'),
    CONSTRAINT fk_inv_member FOREIGN KEY (member_id) REFERENCES members(account_id),
    CONSTRAINT fk_inv_cashier FOREIGN KEY (cashier_id) REFERENCES accounts(id),
    UNIQUE KEY uq_inv_id_member (id, member_id)
) ENGINE=InnoDB;

CREATE TABLE counter_invoice_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    invoice_id BIGINT NOT NULL,
    member_id BIGINT,
    product_id BIGINT,
    membership_id BIGINT,
    item_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price_vnd DECIMAL(14,0) NOT NULL CHECK (unit_price_vnd >= 0),
    line_total_vnd DECIMAL(24,0) AS (quantity * unit_price_vnd) STORED,
    CONSTRAINT fk_inv_items_invoice FOREIGN KEY (invoice_id) REFERENCES counter_invoices(id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_items_product FOREIGN KEY (product_id) REFERENCES products(id),
    CONSTRAINT fk_inv_items_membership FOREIGN KEY (membership_id, member_id)
        REFERENCES memberships(id, member_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. UC10, UC23: THÔNG BÁO HỆ THỐNG
-- =====================================================================

CREATE TABLE notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sender_id BIGINT,
    category ENUM('system', 'booking', 'attendance', 'membership', 'trainer_schedule') NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    CONSTRAINT fk_notif_sender FOREIGN KEY (sender_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

CREATE TABLE notification_recipients (
    notification_id BIGINT NOT NULL,
    recipient_id BIGINT NOT NULL,
    read_at DATETIME,
    PRIMARY KEY (notification_id, recipient_id),
    CONSTRAINT fk_nr_notif FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    CONSTRAINT fk_nr_recipient FOREIGN KEY (recipient_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================
-- 9. TRỢ LÝ AI: LƯU HỘI THOẠI & PHẢN HỒI HỖ TRỢ
-- =====================================================================

CREATE TABLE support_conversations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    requester_id BIGINT NOT NULL,
    assigned_to BIGINT,
    status ENUM('open', 'escalated', 'closed') NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sc_requester FOREIGN KEY (requester_id) REFERENCES accounts(id),
    CONSTRAINT fk_sc_assigned FOREIGN KEY (assigned_to) REFERENCES accounts(id)
) ENGINE=InnoDB;

CREATE TABLE support_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT NOT NULL,
    author_id BIGINT,
    author_type ENUM('requester', 'assistant', 'staff') NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sm_conv FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_sm_author FOREIGN KEY (author_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

-- =====================================================================
-- 10. UC24: CÁC VIEW BÁO CÁO THỐNG KÊ HOẠT ĐỘNG
-- =====================================================================

CREATE OR REPLACE VIEW daily_new_members AS
SELECT CAST(a.created_at AS DATE) AS report_date,
       COUNT(*) AS member_count
FROM members m JOIN accounts a ON a.id = m.account_id
GROUP BY CAST(a.created_at AS DATE);

CREATE OR REPLACE VIEW daily_facility_checkins AS
SELECT CAST(checked_in_at AS DATE) AS report_date,
       COUNT(*) AS checkin_count
FROM facility_checkins 
GROUP BY CAST(checked_in_at AS DATE);

CREATE OR REPLACE VIEW daily_course_enrollments AS
SELECT CAST(requested_at AS DATE) AS report_date,
       COUNT(*) AS request_count
FROM enrollments 
GROUP BY CAST(requested_at AS DATE);

CREATE OR REPLACE VIEW daily_counter_revenue AS
SELECT CAST(i.paid_at AS DATE) AS report_date,
       COUNT(DISTINCT i.id) AS invoice_count, 
       SUM(l.line_total_vnd) AS revenue_vnd
FROM counter_invoices i
JOIN counter_invoice_items l ON l.invoice_id = i.id
WHERE i.status = 'paid'
GROUP BY CAST(i.paid_at AS DATE);

CREATE OR REPLACE VIEW session_attendance_report AS
SELECT s.id AS session_id, s.class_id, s.trainer_id, s.starts_at,
       COUNT(b.id) AS booked_count,
       SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present_count,
       ROUND(100.0 * SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) / NULLIF(COUNT(b.id), 0), 2) AS attendance_percent,
       AVG(a.trainer_rating) AS average_rating
FROM class_sessions s
LEFT JOIN session_bookings b ON b.session_id = s.id AND b.status = 'booked'
LEFT JOIN attendance a ON a.booking_id = b.id
WHERE s.status = 'completed'
GROUP BY s.id, s.class_id, s.trainer_id, s.starts_at;

-- =====================================================================
-- 11. KHỞI TẠO DỮ LIỆU MẪU ĐỒNG BỘ VỚI PROTOTYPE GIAO DIỆN
-- =====================================================================

-- Tài khoản Quản trị viên
INSERT INTO accounts (id, email, username, password_hash, full_name, phone, address, role, status) VALUES
(1, 'admin@fitcenter.vn', 'admin', '$2b$12$demo_admin_hash', 'Trần Hoàng Quản Trị', '0901000001', 'Hải Châu, Đà Nẵng', 'admin', 'active');

-- Tài khoản Nhân viên quầy
INSERT INTO accounts (id, email, username, password_hash, full_name, phone, address, role, status) VALUES
(2, 'nhanvien@fitcenter.vn', 'nhanvien', '$2b$12$demo_staff_hash', 'Hoàng Nhân Viên', '0901000002', 'Thanh Khê, Đà Nẵng', 'staff', 'active');

-- Tài khoản Huấn luyện viên
INSERT INTO accounts (id, email, username, password_hash, full_name, phone, address, role, status) VALUES
(3, 'hoale@fitcenter.vn', 'hlv_hoa', '$2b$12$demo_trainer_hash', 'Lê Thị Hoa', '0905111222', 'Sơn Trà, Đà Nẵng', 'trainer', 'active'),
(4, 'manhtran@fitcenter.vn', 'hlv_manh', '$2b$12$demo_trainer_hash', 'Trần Văn Mạnh', '0905222333', 'Ngũ Hành Sơn, Đà Nẵng', 'trainer', 'active'),
(5, 'baonguyen@fitcenter.vn', 'hlv_bao', '$2b$12$demo_trainer_hash', 'Nguyễn Quốc Bảo', '0905333444', 'Cẩm Lệ, Đà Nẵng', 'trainer', 'active');

INSERT INTO trainers (account_id, specialties, biography) VALUES
(3, 'Yoga, Pilates, Thư giãn & Hồi phục', '5 năm kinh nghiệm giảng dạy Yoga quốc tế.'),
(4, 'Kickboxing, CrossFit, Thể lực nâng cao', 'Vận động viên Kickboxing chuyên nghiệp.'),
(5, 'Bodybuilding, Zumba Dance, Giảm mỡ', 'Chuyên gia thể hình và đào tạo PT 1-kèm-1.');

-- Tài khoản Khách hàng (Hội viên)
INSERT INTO accounts (id, email, username, password_hash, full_name, phone, address, role, status) VALUES
(6, 'an.nguyen@email.com', 'nguyenvanan', '$2b$12$demo_member_hash', 'Nguyễn Văn An', '0905123456', 'Hải Châu, Đà Nẵng', 'member', 'active'),
(7, 'bich.tran@email.com', 'tranthibich', '$2b$12$demo_member_hash', 'Trần Thị Bích', '0914222333', 'Sơn Trà, Đà Nẵng', 'member', 'active'),
(8, 'cuong.le@email.com', 'lehoangcuong', '$2b$12$demo_member_hash', 'Lê Hoàng Cường', '0935456789', 'Thanh Khê, Đà Nẵng', 'member', 'pending'),
(9, 'dung.pham@email.com', 'phamminhdung', '$2b$12$demo_member_hash', 'Phạm Minh Dũng', '0977111222', 'Ngũ Hành Sơn, Đà Nẵng', 'member', 'active'),
(10, 'ha.vo@email.com', 'vothuha', '$2b$12$demo_member_hash', 'Võ Thu Hà', '0868333444', 'Cẩm Lệ, Đà Nẵng', 'member', 'locked'),
(11, 'huy.dang@email.com', 'dangquochuy', '$2b$12$demo_member_hash', 'Đặng Quốc Huy', '0902555666', 'Liên Chiểu, Đà Nẵng', 'member', 'active');

INSERT INTO members (account_id, member_code, fitness_goal) VALUES
(6, 'KH0001', 'Tăng độ dẻo dai và giảm đau mỏi lưng'),
(7, 'KH0002', 'Cải thiện sức bền tim mạch và săn chắc cơ'),
(8, 'KH0003', 'Giảm cân và điều chỉnh tư thế'),
(9, 'KH0004', 'Rèn luyện phản xạ và tự vệ'),
(10, 'KH0005', 'Tập Zumba duy trì vóc dáng'),
(11, 'KH0006', 'Tăng cơ nạc và nâng cao thể hình');

-- Phòng tập
INSERT INTO rooms (id, name, capacity, is_active) VALUES
(1, 'Phòng Yoga 1', 20, TRUE),
(2, 'Phòng Studio A', 25, TRUE),
(3, 'Phòng Studio B', 15, TRUE),
(4, 'Khu Functional', 16, TRUE),
(5, 'Khu tập tạ', 30, TRUE);

-- Khóa học
INSERT INTO courses (id, code, name, description, price_vnd, is_active) VALUES
(1, 'YOGA-01', 'Yoga buổi sáng', 'Lớp Yoga cơ bản rèn luyện độ dẻo dai và tập trung', 1200000, TRUE),
(2, 'CROSSFIT-01', 'CrossFit nâng cao', 'Lớp rèn luyện sức mạnh bùng nổ và sức bền cơ bắp', 1800000, TRUE),
(3, 'PILATES-01', 'Pilates cơ bản', 'Lớp cải thiện cột sống và vóc dáng', 1500000, TRUE),
(4, 'KICKBOX-01', 'Kickboxing', 'Lớp đấm bốc giải phóng năng lượng và tự vệ', 1600000, TRUE),
(5, 'ZUMBA-01', 'Zumba Dance', 'Vũ điệu sôi động đốt mỡ toàn thân', 1000000, TRUE),
(6, 'BODYBUILD-01', 'Bodybuilding', 'Khóa huấn luyện phát triển cơ bắp chuyên sâu', 2000000, FALSE);

-- Sản phẩm bán tại quầy
INSERT INTO products (sku, name, category, sale_price_vnd, stock_quantity, is_active) VALUES
('SP001', 'Nước khoáng điện giải Revive 500ml', 'Đồ uống', 20000, 85, TRUE),
('SP002', 'Găng tay tập Gym Pro', 'Phụ kiện', 180000, 24, TRUE),
('SP003', 'Whey Protein Isolate 2kg', 'Thực phẩm bổ sung', 1450000, 12, TRUE),
('SP004', 'Thảm tập Yoga định tuyến', 'Dụng cụ', 320000, 16, TRUE);
