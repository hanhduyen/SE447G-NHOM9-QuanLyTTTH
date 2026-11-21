# FITCENTER - HỆ THỐNG QUẢN LÝ TRUNG TÂM THỂ HÌNH (CDIO SE447G - NHÓM 09)

Dự án Website FitCenter bao gồm **Frontend** (giao diện HTML/Tailwind) kết nối với **Backend API (Node.js & Express)** và cơ sở dữ liệu **MySQL 8.0** chuẩn hóa theo thiết kế CSDL đồ án **`QuanLyTrungTamTheHinh`** (28 bảng, 7 views, trigger và dữ liệu mẫu nghiệp vụ).

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

## 🔑 DANH SÁCH TÀI KHOẢN TRẢI NGHIỆM DEMO (MẬT KHẨU CHUNG: `123456`)

| Vai trò | Email đăng nhập | Mật khẩu | Họ và tên | Chức năng chính |
| :--- | :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin@gym.local` | `123456` | Nguyễn Quản Trị | Cổng Admin, quản lý toàn bộ hệ thống, nhân sự, doanh thu |
| **Nhân viên quầy (Staff)** | `nhanvien01@gym.local` | `123456` | Trần Thu Ngân | Check-in, điểm danh, duyệt đăng ký, bán hàng tại quầy |
| **Huấn luyện viên (HLV Yoga)** | `hlv01@gym.local` | `123456` | Lê Minh Yoga | Xem lịch dạy cá nhân, cập nhật chỉ số và kết quả học viên |
| **Huấn luyện viên (HLV Boxing)** | `hlv02@gym.local` | `123456` | Phạm Quốc Boxing | Xem lịch dạy Boxing, quản lý học viên |
| **Hội viên 1 (VIP)** | `kh01@gym.local` | `123456` | Võ Văn An | Xem gói tập kích hoạt, thời khóa biểu, đăng ký lớp |
| **Hội viên 2** | `kh02@gym.local` | `123456` | Nguyễn Thị Bình | Cổng khách hàng, đổi/hủy ca học, hồ sơ cá nhân |
| **Hội viên 3** | `kh03@gym.local` | `123456` | Đặng Văn Cường | Đăng ký khóa học, tính BMI & Chatbot AI |

*(Các tài khoản tương thích cũ như `admin@fitcenter.vn`, `an.nguyen@email.com`, `hoale@fitcenter.vn` với mật khẩu `123456` vẫn hoạt động bình thường).*

---

## 🌐 CÁC ĐƯỜNG DẪN TRANG WEB

| Trang | URL | Mô tả |
| :--- | :--- | :--- |
| **Trang chủ** | [http://localhost:3000/trang_chu.html](http://localhost:3000/trang_chu.html) | Trang giới thiệu, nhận diện tài khoản đã đăng nhập |
| **Đăng nhập** | [http://localhost:3000/dang_nhap.html](http://localhost:3000/dang_nhap.html) | Đăng nhập tài khoản hệ thống (Hội viên, Quản trị viên, HLV, Nhân viên) |
| **Đăng ký** | [http://localhost:3000/dang_ky.html](http://localhost:3000/dang_ky.html) | Đăng ký hội viên mới, lưu tự động vào `TaiKhoan` & `KhachHang` |
| **Cổng Hội viên** | [http://localhost:3000/khach_hang.html](http://localhost:3000/khach_hang.html) | 8 phân hệ hoàn chỉnh (Lịch học cá nhân, Thời khóa biểu, Gói tập & Khóa học, Hóa đơn giao dịch, Nhật ký điểm danh, Thể chất InBody, Hộp thư phản hồi, Trợ lý ảo AI) |
| **Cổng Quản trị** | [http://localhost:3000/admin.html](http://localhost:3000/admin.html) | Cổng Admin, tự động tải thống kê thật từ 28 bảng database |
| **Cổng HLV** | [http://localhost:3000/huan_luyen_vien.html](http://localhost:3000/huan_luyen_vien.html) | Cổng HLV xem lịch dạy cá nhân (`vw_LichDayCaNhan`) & đánh giá học viên |

---

## 🗄️ CẤU TRÚC CƠ SỞ DỮ LIỆU `QuanLyTrungTamTheHinh` (28 BẢNG)

1. **Nhóm A - Người dùng & Hệ thống (10 bảng)**:
   - `VaiTro`, `TaiKhoan`, `KhachHang`, `NhanVien`, `HuanLuyenVien`, `ChuyenMon`, `HLV_ChuyenMon`, `LichLamViecHLV`, `ThongTinTrungTam`, `NhatKyHeThong`.

2. **Nhóm B - Đào tạo, Lớp học, Điểm danh (11 bảng)**:
   - `GoiTap`, `KhoaHoc`, `Phong`, `LopHoc`, `BuoiHoc`, `PhanCongHLV`, `DangKyKhoaHoc`, `DangKyGoiTap`, `YeuCauDoiHuyLich`, `DiemDanh`, `KetQuaHocVien`.

3. **Nhóm C - Cửa hàng, Hóa đơn, Thông báo, Hỗ trợ (7 bảng)**:
   - `DanhMucSanPham`, `SanPham`, `HoaDon`, `ChiTietHoaDon`, `ThongBao`, `ThongBaoNguoiNhan`, `PhanHoiHoTro`.

4. **Views nghiệp vụ (7 Views)**:
   - `vw_SiSoLop`: Theo dõi sĩ số từng lớp và số chỗ còn trống.
   - `vw_LichHocCaNhan`: Lịch học của từng học viên.
   - `vw_LichDayCaNhan`: Lịch dạy của từng HLV.
   - `vw_LichLopCongBo`: Thời khóa biểu các lớp đang mở cho khách hàng.
   - `vw_DoanhThuTheoThang`: Thống kê doanh thu theo tháng và loại hóa đơn.
   - `vw_ThongKeLopHoc`: Hiệu quả lớp học và số lượt điểm danh.
   - `vw_HoiVienConHan`: Danh sách hội viên còn hạn gói tập.

---

## 🔌 TÀI LIỆU API HỘI VIÊN / KHÁCH HÀNG (`/api/customer`)

Hệ thống cung cấp trọn bộ 19 RESTful API endpoints chuyên biệt cho Hội viên, tích hợp trực tiếp 28 bảng và các Business Rules:

| Endpoint | Phương thức | Mô tả chức năng & Nghiệp vụ |
| :--- | :---: | :--- |
| `/api/customer/summary` | `GET` | Dashboard tổng quan: thẻ hội viên, ngày hết hạn, QR barcode, ca học sắp tới, thống kê. |
| `/api/customer/my-schedule` | `GET` | Lịch học cá nhân của học viên (`DangKyKhoaHoc`, `BuoiHoc`, `LopHoc`, `Phong`). |
| `/api/customer/published-schedule` | `GET` | Thời khóa biểu các lớp đang mở, sĩ số và số chỗ còn trống (`vw_SiSoLop`). |
| `/api/customer/booking/register` | `POST` | Đăng ký lớp học: kiểm tra xung đột trùng giờ, kiểm tra chỗ trống, tự động đưa vào hàng chờ nếu lớp đầy. |
| `/api/customer/booking/cancel` | `POST` | Hủy đăng ký ca học, ghi nhận yêu cầu vào `YeuCauDoiHuyLich` và gửi thông báo xác nhận. |
| `/api/customer/booking/reschedule` | `POST` | Đổi ca học sang lớp mới còn chỗ trống, kiểm tra trùng giờ và cập nhật lịch trình. |
| `/api/customer/courses-and-plans` | `GET` | Danh mục gói tập thành viên (`GoiTap`) và khóa học chuyên sâu (`KhoaHoc`). |
| `/api/customer/membership/register` | `POST` | Đăng ký gói tập thành viên: tính nối tiếp hạn sử dụng nếu gói cũ còn hiệu lực, tự động xuất hóa đơn (`HoaDon`, `ChiTietHoaDon`). |
| `/api/customer/course/register` | `POST` | Đăng ký khóa học và lớp học, tự động xuất hóa đơn trực tuyến. |
| `/api/customer/invoices` | `GET` | Danh sách lịch sử hóa đơn thanh toán kèm chi tiết mặt hàng thanh toán (`ChiTietHoaDon`). |
| `/api/customer/checkins` | `GET` | Nhật ký điểm danh check-in tại phòng tập (`DiemDanh`). |
| `/api/customer/progress` | `GET` | Lịch sử đánh giá thể chất InBody, cân nặng, tỷ lệ mỡ, ghi chú chuyên môn của HLV (`KetQuaHocVien`). |
| `/api/customer/requests` | `GET` | Lịch sử các yêu cầu đổi/hủy lớp học (`YeuCauDoiHuyLich`). |
| `/api/customer/feedback` | `GET` | Hộp thư hỗ trợ: xem danh sách phản hồi/khiếu nại đã gửi và câu trả lời từ trung tâm (`PhanHoiHoTro`). |
| `/api/customer/feedback` | `POST` | Gửi ý kiến đóng góp, thắc mắc dịch vụ hoặc khiếu nại tới ban quản trị. |
| `/api/customer/notifications` | `GET` | Danh sách thông báo cá nhân của học viên (`ThongBao`, `ThongBaoNguoiNhan`). |
| `/api/customer/notifications/mark-read` | `POST` | Đánh dấu thông báo là đã đọc. |
| `/api/customer/profile` | `GET` / `PUT` | Xem và cập nhật hồ sơ cá nhân: số điện thoại, địa chỉ, mục tiêu rèn luyện thể chất. |
| `/api/customer/change-password` | `POST` | Đổi mật khẩu tài khoản an toàn với thuật toán mã hóa Bcrypt. |
| `/api/customer/bmi-consult` | `POST` | Tính toán chỉ số BMI, TDEE, lượng nước khuyến nghị, cân nặng lý tưởng và đề xuất lộ trình tập luyện. |
| `/api/customer/chatbot` | `POST` | Trợ lý ảo thông minh giải đáp thông tin gói tập, huấn luyện viên, giờ mở cửa và nội quy phòng tập (Tích hợp Google Gemini API). |

---

## 🤖 TRỢ LÝ AI FITCENTER (GOOGLE GEMINI API INTEGRATION)

Dịch vụ AI Chatbot được tích hợp trực tiếp tại [c:\CDIO4\NHOM9\services\geminiService.js](file:///c:/CDIO4/NHOM9/services/geminiService.js) và cung cấp các tính năng nổi bật:

1. **Gắn kết dữ liệu thời gian thực (Grounding on MySQL Data):**
   - Tự động nạp dữ liệu từ các bảng `ThongTinTrungTam`, `GoiTap`, `KhoaHoc`, `LopHoc`, `HuanLuyenVien`.
   - Nếu hội viên đã đăng nhập, AI tự động nhận diện chỉ số thể trạng (Chiều cao, Cân nặng, BMI), gói tập hiện tại và lịch sử InBody gần nhất từ `KetQuaHocVien` để cá nhân hóa câu trả lời.

2. **Bộ câu hỏi tư vấn chuyên sâu:**
   - **Đăng ký tập thử:** Hướng dẫn chính sách tập thử trải nghiệm 1 buổi hoàn toàn miễn phí (Free Trial) kèm đo InBody và HLV hướng dẫn buổi đầu.
   - **Ước tính hiệu quả tập luyện theo BMI:** Phân tích chỉ số BMI cụ thể và đưa ra lộ trình thời gian 3 giai đoạn (2-4 tuần thích nghi, 6-8 tuần biến chuyển rõ rệt 3-5kg mỡ, 12 tuần thay đổi toàn diện) kết hợp gợi ý khóa học (*Giảm mỡ 8 tuần*, *Boxing*, *Yoga*).

3. **Kiểm soát phạm vi nghiêm ngặt (Out-of-Scope Control):**
   - Với các câu hỏi ngoài phạm vi hệ thống FitCenter (thời tiết, lập trình, chính trị, giải toán...), hệ thống hiển thị chính xác thông báo:
     > *"Dạ em đã ghi nhận câu hỏi của anh/chị. Anh/chị có thể hỏi em những câu hỏi liên quan đến hệ thống fitcenter thôi ạ. Những câu hỏi này vược ngoài phạm vi của em ạ."*

4. **Cấu hình Google Gemini API trong `.env`:**
   ```env
   # Nhập API Key của Google Gemini vào đây:
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-1.5-flash
   ```
   *(Hệ thống hỗ trợ Hybrid Architecture: Nếu chưa cấu hình Key hoặc mạng gián đoạn, Local Knowledge Base tự động phản hồi ngay lập tức mà không gây gián đoạn trải nghiệm của người dùng).*
