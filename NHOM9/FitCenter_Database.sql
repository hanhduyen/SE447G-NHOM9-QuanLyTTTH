-- FitCenter | PostgreSQL 15+
-- Chạy trong một database trống:
-- psql -v ON_ERROR_STOP=1 -d fitcenter -f FitCenter_Database.sql
-- Tài khoản triển khai cần quyền tạo schema và extension btree_gist.
-- Giá tiền tính bằng VND. Các báo cáo theo ngày dùng múi giờ Việt Nam.

BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE SCHEMA fitcenter;
SET LOCAL search_path = fitcenter, public;

-- UC01–04, UC12, UC19: tài khoản, hội viên và nhân sự.
CREATE TABLE accounts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL CHECK (btrim(email) <> ''),
    username text CHECK (btrim(username) <> '' AND position('@' in username) = 0),
    password_hash text NOT NULL CHECK (btrim(password_hash) <> ''),
    full_name text NOT NULL CHECK (btrim(full_name) <> ''),
    phone text UNIQUE,
    address text,
    birth_date date,
    role text NOT NULL DEFAULT 'member'
        CHECK (role IN ('member', 'trainer', 'staff', 'admin')),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'locked', 'inactive')),
    terms_accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX accounts_email_ci ON accounts (lower(email));
CREATE UNIQUE INDEX accounts_username_ci ON accounts (lower(username));

CREATE TABLE members (
    account_id bigint PRIMARY KEY REFERENCES accounts(id),
    member_code text NOT NULL UNIQUE,
    fitness_goal text
);

CREATE TABLE trainers (
    account_id bigint PRIMARY KEY REFERENCES accounts(id),
    specialties text,
    biography text
);

CREATE TABLE trainer_certifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trainer_id bigint NOT NULL REFERENCES trainers(account_id),
    name text NOT NULL,
    issuer text,
    issued_on date,
    expires_on date,
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

-- Giờ địa phương Asia/Ho_Chi_Minh, thứ 2 = 1 và chủ nhật = 7.
CREATE TABLE trainer_work_hours (
    trainer_id bigint NOT NULL REFERENCES trainers(account_id),
    weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
    starts_at time NOT NULL,
    ends_at time NOT NULL,
    PRIMARY KEY (trainer_id, weekday, starts_at),
    CHECK (starts_at < ends_at)
);

-- UC05, UC14: gói tập và thẻ của hội viên. Mỗi lần gia hạn có một dòng mới.
CREATE TABLE membership_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    duration_months smallint NOT NULL CHECK (duration_months > 0),
    price_vnd numeric(14,0) NOT NULL CHECK (price_vnd >= 0),
    is_active boolean NOT NULL DEFAULT true
);

INSERT INTO membership_plans (code, name, duration_months, price_vnd) VALUES
    ('STANDARD', 'Standard', 1, 500000),
    ('VIP', 'VIP', 3, 1200000),
    ('DIAMOND', 'Diamond', 12, 4500000);

CREATE TABLE memberships (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(account_id),
    plan_id bigint NOT NULL REFERENCES membership_plans(id),
    barcode text NOT NULL UNIQUE,
    starts_on date NOT NULL,
    ends_before date NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'activated', 'cancelled')),
    CHECK (starts_on < ends_before),
    UNIQUE (id, member_id)
);
CREATE INDEX memberships_member_dates ON memberships (member_id, starts_on, ends_before);

-- UC05–09, UC13–17: khóa học, đợt mở lớp và từng buổi học.
CREATE TABLE rooms (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    capacity integer NOT NULL CHECK (capacity > 0),
    is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE courses (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    description text,
    price_vnd numeric(14,0) NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
    is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE classes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id bigint NOT NULL REFERENCES courses(id),
    name text NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'open', 'closed', 'cancelled')),
    reserved_places integer NOT NULL DEFAULT 0 CHECK (reserved_places BETWEEN 0 AND capacity)
);
CREATE INDEX classes_course ON classes (course_id);

CREATE TABLE class_sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    class_id bigint NOT NULL REFERENCES classes(id),
    room_id bigint NOT NULL REFERENCES rooms(id),
    trainer_id bigint REFERENCES trainers(account_id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    reserved_places integer NOT NULL DEFAULT 0 CHECK (reserved_places BETWEEN 0 AND capacity),
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'completed', 'cancelled')),
    CHECK (ends_at > starts_at),
    CHECK (status NOT IN ('published', 'completed') OR trainer_id IS NOT NULL),
    UNIQUE (id, class_id),
    -- Khoảng [bắt đầu, kết thúc) cho phép xếp hai ca nối tiếp.
    EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (status <> 'cancelled'),
    EXCLUDE USING gist (trainer_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
        WHERE (status <> 'cancelled' AND trainer_id IS NOT NULL)
);
CREATE INDEX class_sessions_schedule ON class_sessions (starts_at) WHERE status = 'published';
CREATE INDEX class_sessions_class ON class_sessions (class_id, starts_at);
CREATE INDEX class_sessions_trainer ON class_sessions (trainer_id, starts_at);

CREATE TABLE enrollments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(account_id),
    class_id bigint NOT NULL REFERENCES classes(id),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at timestamptz,
    reviewed_by bigint REFERENCES accounts(id),
    review_note text,
    CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
    CHECK (status NOT IN ('approved', 'rejected') OR reviewed_at IS NOT NULL),
    UNIQUE (id, class_id, member_id)
);
CREATE UNIQUE INDEX enrollments_one_active ON enrollments (member_id, class_id)
    WHERE status IN ('pending', 'approved');
CREATE INDEX enrollments_pending ON enrollments (requested_at) WHERE status = 'pending';
CREATE INDEX enrollments_reporting ON enrollments (requested_at);

CREATE TABLE session_bookings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    enrollment_id bigint NOT NULL,
    class_id bigint NOT NULL,
    member_id bigint NOT NULL,
    session_id bigint NOT NULL,
    booked_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status text NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked', 'cancelled', 'rescheduled')),
    FOREIGN KEY (enrollment_id, class_id, member_id)
        REFERENCES enrollments(id, class_id, member_id),
    FOREIGN KEY (session_id, class_id) REFERENCES class_sessions(id, class_id),
    UNIQUE (id, class_id, session_id)
);
CREATE UNIQUE INDEX session_bookings_one_active ON session_bookings (member_id, session_id)
    WHERE status = 'booked';
CREATE INDEX session_bookings_session ON session_bookings (session_id, status);

-- Các trạng thái đang giữ chỗ được tính bằng cập nhật nguyên tử trên dòng cha.
-- CHECK ở bảng cha chặn vượt sĩ số ngay cả khi có nhiều giao dịch đồng thời.
CREATE FUNCTION maintain_reserved_places() RETURNS trigger
LANGUAGE plpgsql SET search_path = fitcenter, public AS $$
DECLARE
    old_holds boolean := false;
    new_holds boolean := false;
    slot_owner bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        old_holds := OLD.status = ANY (TG_ARGV[1:TG_NARGS - 1]);
        slot_owner := (to_jsonb(OLD) ->> TG_ARGV[0])::bigint;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_holds := NEW.status = ANY (TG_ARGV[1:TG_NARGS - 1]);
        IF TG_OP = 'UPDATE' AND slot_owner <> (to_jsonb(NEW) ->> TG_ARGV[0])::bigint THEN
            RAISE EXCEPTION 'Tạo bản ghi mới khi chuyển lớp hoặc chuyển buổi';
        END IF;
        slot_owner := (to_jsonb(NEW) ->> TG_ARGV[0])::bigint;
    END IF;
    IF old_holds <> new_holds THEN
        IF TG_TABLE_NAME = 'enrollments' THEN
            UPDATE classes SET reserved_places = reserved_places + new_holds::int - old_holds::int
            WHERE id = slot_owner;
        ELSE
            UPDATE class_sessions SET reserved_places = reserved_places + new_holds::int - old_holds::int
            WHERE id = slot_owner;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER enrollments_count_places
AFTER INSERT OR UPDATE OR DELETE ON enrollments
FOR EACH ROW EXECUTE FUNCTION maintain_reserved_places('class_id', 'pending', 'approved');

CREATE TRIGGER bookings_count_places
AFTER INSERT OR UPDATE OR DELETE ON session_bookings
FOR EACH ROW EXECUTE FUNCTION maintain_reserved_places('session_id', 'booked');

CREATE TABLE booking_change_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL,
    class_id bigint NOT NULL,
    original_session_id bigint NOT NULL,
    target_session_id bigint,
    kind text NOT NULL CHECK (kind IN ('cancel', 'reschedule')),
    reason text,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at timestamptz,
    resolved_by bigint REFERENCES accounts(id),
    FOREIGN KEY (booking_id, class_id, original_session_id)
        REFERENCES session_bookings(id, class_id, session_id),
    FOREIGN KEY (target_session_id, class_id) REFERENCES class_sessions(id, class_id),
    CHECK ((kind = 'reschedule') = (target_session_id IS NOT NULL)),
    CHECK (target_session_id <> original_session_id),
    CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
    CHECK (status NOT IN ('approved', 'rejected') OR resolved_at IS NOT NULL)
);
CREATE UNIQUE INDEX booking_change_one_pending ON booking_change_requests (booking_id)
    WHERE status = 'pending';

CREATE FUNCTION validate_booking_change_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = fitcenter, public AS $$
DECLARE
    session_start timestamptz;
BEGIN
    SELECT s.starts_at INTO session_start
    FROM session_bookings b JOIN class_sessions s ON s.id = b.session_id
    WHERE b.id = NEW.booking_id AND b.status = 'booked' AND s.status = 'published'
    FOR SHARE OF b, s;

    NEW.requested_at := clock_timestamp();
    IF session_start IS NULL OR NEW.requested_at > session_start - interval '2 hours' THEN
        RAISE EXCEPTION 'Chỉ gửi yêu cầu cho buổi đã đặt trước giờ tập ít nhất 2 tiếng';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER booking_change_cutoff
BEFORE INSERT ON booking_change_requests
FOR EACH ROW EXECUTE FUNCTION validate_booking_change_request();

-- UC04, UC11, UC18: check-in tại quầy, điểm danh từng buổi và lịch sử thể trạng.
CREATE TABLE facility_checkins (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(account_id),
    membership_id bigint,
    checked_in_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by bigint REFERENCES accounts(id),
    method text NOT NULL CHECK (method IN ('barcode', 'phone', 'manual')),
    FOREIGN KEY (membership_id, member_id) REFERENCES memberships(id, member_id)
);
CREATE INDEX facility_checkins_time ON facility_checkins (checked_in_at);
CREATE INDEX facility_checkins_member ON facility_checkins (member_id, checked_in_at);

CREATE TABLE attendance (
    booking_id bigint PRIMARY KEY REFERENCES session_bookings(id),
    status text NOT NULL CHECK (status IN ('present', 'absent')),
    recorded_by bigint NOT NULL REFERENCES accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trainer_rating smallint CHECK (trainer_rating BETWEEN 1 AND 5),
    CHECK (trainer_rating IS NULL OR status = 'present')
);

CREATE TABLE body_measurements (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id bigint NOT NULL REFERENCES members(account_id),
    recorded_by bigint NOT NULL REFERENCES accounts(id),
    measured_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    height_cm numeric(5,2) NOT NULL CHECK (height_cm > 0),
    weight_kg numeric(5,2) NOT NULL CHECK (weight_kg > 0),
    bmi numeric(12,2) GENERATED ALWAYS AS
        (round(weight_kg * 10000 / (height_cm * height_cm), 2)) STORED
);
CREATE INDEX body_measurements_history ON body_measurements (member_id, measured_at DESC);

CREATE TABLE training_assessments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id bigint NOT NULL REFERENCES attendance(booking_id),
    trainer_id bigint NOT NULL REFERENCES trainers(account_id),
    assessed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    weight_kg numeric(5,2) CHECK (weight_kg > 0),
    fitness_notes text,
    technique_notes text,
    next_training_plan text
);

-- UC20–22: sản phẩm, tồn kho và hóa đơn bán tại quầy.
CREATE TABLE products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku text NOT NULL UNIQUE,
    name text NOT NULL,
    category text,
    sale_price_vnd numeric(14,0) NOT NULL CHECK (sale_price_vnd >= 0),
    stock_quantity integer NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE counter_invoices (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_number text NOT NULL UNIQUE,
    member_id bigint REFERENCES members(account_id),
    cashier_id bigint NOT NULL REFERENCES accounts(id),
    issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at timestamptz,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid', 'void')),
    payment_method text CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
    CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
    CHECK ((paid_at IS NULL) = (payment_method IS NULL)),
    CHECK (paid_at >= issued_at),
    UNIQUE (id, member_id)
);
CREATE INDEX counter_invoices_paid ON counter_invoices (paid_at) WHERE status = 'paid';

CREATE TABLE counter_invoice_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    invoice_id bigint NOT NULL REFERENCES counter_invoices(id),
    member_id bigint,
    product_id bigint REFERENCES products(id),
    membership_id bigint,
    item_name text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_vnd numeric(14,0) NOT NULL CHECK (unit_price_vnd >= 0),
    line_total_vnd numeric(24,0) GENERATED ALWAYS AS (quantity * unit_price_vnd) STORED,
    CHECK (num_nonnulls(product_id, membership_id) = 1),
    CHECK (membership_id IS NULL OR (member_id IS NOT NULL AND quantity = 1)),
    FOREIGN KEY (invoice_id, member_id) REFERENCES counter_invoices(id, member_id),
    FOREIGN KEY (membership_id, member_id) REFERENCES memberships(id, member_id)
);
CREATE INDEX counter_invoice_items_invoice ON counter_invoice_items (invoice_id);

-- UC10, UC23: mỗi thông báo có thể được gửi đến nhiều tài khoản.
CREATE TABLE notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_id bigint REFERENCES accounts(id),
    category text NOT NULL
        CHECK (category IN ('system', 'booking', 'attendance', 'membership', 'trainer_schedule')),
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at timestamptz
);

CREATE TABLE notification_recipients (
    notification_id bigint NOT NULL REFERENCES notifications(id),
    recipient_id bigint NOT NULL REFERENCES accounts(id),
    read_at timestamptz,
    PRIMARY KEY (notification_id, recipient_id)
);
CREATE INDEX notification_recipients_inbox ON notification_recipients (recipient_id, read_at);

-- Trợ lý AI: lưu hội thoại và trạng thái chuyển cho nhân viên.
CREATE TABLE support_conversations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requester_id bigint NOT NULL REFERENCES accounts(id),
    assigned_to bigint REFERENCES accounts(id),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'escalated', 'closed')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE support_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id bigint NOT NULL REFERENCES support_conversations(id),
    author_id bigint REFERENCES accounts(id),
    author_type text NOT NULL CHECK (author_type IN ('requester', 'assistant', 'staff')),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((author_type = 'assistant') = (author_id IS NULL))
);
CREATE INDEX support_messages_conversation ON support_messages (conversation_id, id);

-- UC24: báo cáo tổng hợp từ dữ liệu gốc.
CREATE VIEW daily_new_members AS
SELECT (a.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
       count(*) AS member_count
FROM members m JOIN accounts a ON a.id = m.account_id
GROUP BY 1;

CREATE VIEW daily_facility_checkins AS
SELECT (checked_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
       count(*) AS checkin_count
FROM facility_checkins GROUP BY 1;

CREATE VIEW daily_course_enrollments AS
SELECT (requested_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
       count(*) AS request_count
FROM enrollments GROUP BY 1;

CREATE VIEW daily_counter_revenue AS
SELECT (i.paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS report_date,
       count(DISTINCT i.id) AS invoice_count, sum(l.line_total_vnd) AS revenue_vnd
FROM counter_invoices i
JOIN counter_invoice_items l ON l.invoice_id = i.id
WHERE i.status = 'paid'
GROUP BY 1;

CREATE VIEW session_attendance_report AS
SELECT s.id AS session_id, s.class_id, s.trainer_id, s.starts_at,
       count(b.id) AS booked_count,
       count(b.id) FILTER (WHERE a.status = 'present') AS present_count,
       round(100.0 * count(b.id) FILTER (WHERE a.status = 'present')
           / nullif(count(b.id), 0), 2) AS attendance_percent,
       avg(a.trainer_rating) AS average_rating
FROM class_sessions s
LEFT JOIN session_bookings b ON b.session_id = s.id AND b.status = 'booked'
LEFT JOIN attendance a ON a.booking_id = b.id
WHERE s.status = 'completed'
GROUP BY s.id;

-- Tích hợp backend:
-- 1. Tự đăng ký luôn tạo accounts.role = 'member' và hồ sơ members trong một giao dịch.
--    Backend băm mật khẩu, chuẩn hóa email/SĐT, kiểm tra điều khoản và phân quyền.
--    Tài khoản nhân viên quầy chỉ sửa hồ sơ hội viên trong phạm vi được cấp.
-- 2. Khi mở ca, kiểm tra sức chứa phòng và khung giờ làm việc của HLV.
--    Khi đặt chỗ, kiểm tra lớp/ca đang mở, ca chưa bắt đầu và đăng ký đã được duyệt.
--    Chỉ trigger được cập nhật reserved_places. Khi hủy đăng ký, xử lý các chỗ còn hiệu lực.
-- 3. Khi duyệt đổi buổi, khóa yêu cầu và chỗ cũ, kiểm tra buổi đích, tạo chỗ mới
--    rồi cập nhật trạng thái chỗ cũ và yêu cầu trong cùng một giao dịch.
-- 4. Kiểm tra hiệu lực thẻ khi check-in; HLV chỉ điểm danh và ghi nhận học viên
--    trong ca mình phụ trách. Chỉ hội viên sở hữu đặt chỗ được gửi đánh giá.
-- 5. Khi thu tiền, khóa hóa đơn nháp, kiểm tra dòng hàng, trừ kho có điều kiện,
--    kích hoạt thẻ (nếu có) và đánh dấu đã thanh toán trong cùng một giao dịch.
--    Nếu thiếu hàng hoặc bất kỳ bước nào thất bại, rollback toàn bộ.

COMMIT;
