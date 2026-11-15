# FITCENTER - HỆ THỐNG QUẢN LÝ TRUNG TÂM THỂ HÌNH (CDIO SE447G)

Dự án Website FitCenter bao gồm **Frontend** (giao diện HTML/Tailwind) kết nối với **Backend API (Node.js & Express)** và cơ sở dữ liệu **MySQL 8.0**.

---

## 🚀 HƯỚNG DẪN KHỞI CHẠY TRONG VS CODE

### 1. Mở Terminal trong VS Code
- Nhấn tổ hợp phím: `` Ctrl + ` `` (hoặc vào menu `Terminal` -> `New Terminal`).

### 2. Khởi chạy Server Backend API
Nếu Terminal đang ở thư mục gốc `CDIO4`, di chuyển vào thư mục `NHOM9`:
```bash
cd NHOM9
```
Sau đó chạy lệnh:
```bash
npm start
```
*(hoặc `npm run dev` để tự động khởi động lại mỗi khi sửa code)*.

Server sẽ chạy tại: **`http://localhost:3000`**

---

## 🌐 CÁC ĐƯỜNG DẪN TRANG WEB

| Trang | URL | Mô tả |
| :--- | :--- | :--- |
| **Trang chủ** | [http://localhost:3000/trang_chu.html](http://localhost:3000/trang_chu.html) | Trang giới thiệu, nhận diện tài khoản đã đăng nhập |
| **Đăng nhập** | [http://localhost:3000/dang_nhap.html](http://localhost:3000/dang_nhap.html) | Xác thực API MySQL, điều hướng theo vai trò (Role) |
| **Đăng ký** | [http://localhost:3000/dang_ky.html](http://localhost:3000/dang_ky.html) | Đăng ký hội viên mới, lưu tự động vào `accounts` & `members` |
| **Cổng Hội viên** | [http://localhost:3000/khach_hang.html](http://localhost:3000/khach_hang.html) | Toàn bộ 6 chức năng hoàn chỉnh của khách hàng |
| **Cổng Quản trị** | [http://localhost:3000/admin.html](http://localhost:3000/admin.html) | Cổng Admin, tự động tải thống kê thật từ database |
| **Cổng HLV** | [http://localhost:3000/huan_luyen_vien.html](http://localhost:3000/huan_luyen_vien.html) | Cổng xem lịch dạy và học viên |

---

## 👤 TÍNH NĂNG ĐÃ HOÀN THIỆN TRÊN CỔNG HỘI VIÊN (`khach_hang.html`)

1. **Tab 1: Tổng quan (Dashboard)**
   - Lời chào cá nhân hóa theo họ tên hội viên.
   - Thẻ thành viên điện tử tự sinh mã QR check-in (`FITCENTER-[MEMBER_CODE]`).
   - Thẻ hiển thị gói tập đang kích hoạt, ngày hết hạn và số ngày còn lại.
   - Thẻ lịch học tiếp theo và nút Hủy/Đổi ca trực tiếp.
   - Tiến độ tham gia khóa học (thanh tiến trình động % hoàn thành).
   - Danh sách các ca học sắp diễn ra trong tuần.

2. **Tab 2: Lịch học cá nhân (My Schedule)**
   - Bảng danh sách chi tiết các buổi học đã đăng ký trong MySQL.
   - Thao tác: **Hủy ca học** (cập nhật trạng thái `cancelled`, hoàn trả chỗ trống tự động bằng Database Trigger).
   - Thao tác: **Đổi ca học** (chuyển sang ca học khác cùng môn còn chỗ trống).

3. **Tab 3: Thời khóa biểu trung tâm (Published Schedule)**
   - Hiển thị toàn bộ ca học mở từ bảng `class_sessions`.
   - Hiển thị phòng tập, huấn luyện viên, giờ bắt đầu/kết thúc và số chỗ trống thực tế.
   - Nhận diện ca học bạn đã đăng ký ("✓ Bạn đã đăng ký ca này").
   - Nút **Đăng ký ca học này**: bấm là lưu ngay vào bảng `session_bookings` trong MySQL.

4. **Tab 4: Gói tập & Khóa học (Courses & Memberships)**
   - Tải động danh sách gói tập hội viên (`membership_plans`) và khóa học (`courses`).
   - Modal đăng ký/gia hạn gói tập và đăng ký khóa học trực tuyến.

5. **Tab 5: Thông báo cá nhân (Notifications)**
   - Danh sách thông báo nhắc lịch học, đổi ca, thời hạn gói tập từ bảng `notifications`.
   - Nút **Đánh dấu tất cả là đã đọc**: cập nhật trạng thái `read_at = NOW()` và xóa huy hiệu đỏ trên thanh header.

6. **Tab 6: Hồ sơ cá nhân (Profile)**
   - Thẻ QR định danh cá nhân kích thước lớn.
   - Form **Lưu thay đổi hồ sơ**: cập nhật Họ tên, SĐT, Email, Địa chỉ, Mục tiêu tập luyện vào bảng `accounts` & `members`.
   - Form **Đổi mật khẩu bảo mật**: xác thực mật khẩu hiện tại, mã hóa mật khẩu mới bằng `bcrypt`.

---

## 🔑 TÀI KHOẢN MẪU DEMO (MẬT KHẨU: `123456`)

- **Hội viên (Member)**: `an.nguyen@email.com` | Pass: `123456`
- **Quản trị viên (Admin)**: `admin@fitcenter.vn` | Pass: `123456`
- **Huấn luyện viên (HLV)**: `hoale@fitcenter.vn` | Pass: `123456`
