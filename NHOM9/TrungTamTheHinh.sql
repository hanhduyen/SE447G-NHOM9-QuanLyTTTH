/* =====================================================================
   ĐỒ ÁN CDIO SE447 G – NHÓM 09
   Đề tài : Xây dựng Website quản lý trung tâm thể hình
   CSDL   : QuanLyTrungTamTheHinh  (Microsoft SQL Server 2016 trở lên)
   File   : GymDB_SQLServer.sql  (lưu UTF-8 có BOM để SSMS đọc đúng tiếng Việt)

   CÁCH CHẠY:
     - Cách nhanh : mở file trong SSMS -> Execute (F5) một lần, hoặc
     - Cách an toàn: bôi đen từng PHẦN (PHẦN 1 ... PHẦN 9) rồi bấm Execute.
   Mỗi PHẦN kết thúc bằng lệnh GO. Chạy đúng thứ tự từ trên xuống.
   Nếu chạy bằng sqlcmd, thêm tham số -I (bật QUOTED_IDENTIFIER) và -f 65001 (UTF-8).

   MỤC LỤC
     PHẦN 0 : (Tùy chọn) Xóa sạch để tạo lại từ đầu
     PHẦN 1 : Tạo cơ sở dữ liệu
     PHẦN 2 : Tạo 28 bảng (khóa chính, khóa ngoại, CHECK, DEFAULT, UNIQUE)
     PHẦN 3 : Tạo chỉ mục (index)
     PHẦN 4 : Trigger bảo đảm toàn vẹn nghiệp vụ
     PHẦN 5 : Dữ liệu mẫu
     PHẦN 6 : View phục vụ lịch học/lịch dạy/báo cáo
     PHẦN 7 : Stored procedure cho các nghiệp vụ quan trọng
     PHẦN 8 : Chạy thử (kiểm tra nghiệm thu)
     PHẦN 9 : (Tùy chọn) Tạo tài khoản đăng nhập cho ứng dụng web
   ===================================================================== */


/* ---------------------------------------------------------------------
   PHẦN 0 (TÙY CHỌN) – XÓA SẠCH CSDL ĐỂ LÀM LẠI TỪ ĐẦU
   Mặc định đang để chú thích. Chỉ bỏ chú thích khi muốn xóa toàn bộ dữ liệu.
   --------------------------------------------------------------------- */
/*
USE master;
GO
IF DB_ID(N'QuanLyTrungTamTheHinh') IS NOT NULL
BEGIN
    ALTER DATABASE QuanLyTrungTamTheHinh SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE QuanLyTrungTamTheHinh;
END
GO
*/


/* ---------------------------------------------------------------------
   PHẦN 1 – TẠO CƠ SỞ DỮ LIỆU
   Collation Vietnamese_CI_AS: so sánh/sắp xếp đúng tiếng Việt, không phân biệt
   hoa-thường.
   --------------------------------------------------------------------- */
USE master;
GO
IF DB_ID(N'QuanLyTrungTamTheHinh') IS NULL
    CREATE DATABASE QuanLyTrungTamTheHinh COLLATE Vietnamese_CI_AS;
GO
USE QuanLyTrungTamTheHinh;
GO
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO


/* ---------------------------------------------------------------------
   PHẦN 2 – TẠO BẢNG
   Thứ tự tạo đã sắp theo phụ thuộc khóa ngoại (bảng cha trước, bảng con sau).
   Nhóm A: Người dùng – hệ thống | Nhóm B: Đào tạo | Nhóm C: Cửa hàng – thông báo
   --------------------------------------------------------------------- */


-- ==== NHÓM A – NGƯỜI DÙNG VÀ HỆ THỐNG ====

-- Bảng VaiTro: Danh mục vai trò (phân quyền) của hệ thống
CREATE TABLE dbo.VaiTro (
    [VaiTroID] TINYINT NOT NULL,
    [MaVaiTro] VARCHAR(20) NOT NULL,
    [TenVaiTro] NVARCHAR(50) NOT NULL,
    [MoTa] NVARCHAR(200) NULL,
    CONSTRAINT PK_VaiTro PRIMARY KEY (VaiTroID),
    CONSTRAINT UQ_VaiTro_MaVaiTro UNIQUE (MaVaiTro),
    CONSTRAINT UQ_VaiTro_TenVaiTro UNIQUE (TenVaiTro)
);
GO

-- Bảng TaiKhoan: Tài khoản đăng nhập và thông tin cá nhân chung của mọi người dùng
CREATE TABLE dbo.TaiKhoan (
    [TaiKhoanID] INT IDENTITY(1,1) NOT NULL,
    [Email] VARCHAR(100) NOT NULL,
    [SoDienThoai] VARCHAR(15) NULL,
    [MatKhauHash] VARCHAR(255) NOT NULL,
    [HoTen] NVARCHAR(100) NOT NULL,
    [NgaySinh] DATE NULL,
    [GioiTinh] NVARCHAR(10) NULL,
    [DiaChi] NVARCHAR(255) NULL,
    [AnhDaiDien] VARCHAR(255) NULL,
    [VaiTroID] TINYINT NOT NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_TaiKhoan_TrangThai DEFAULT (1),
    [SoLanDangNhapSai] TINYINT NOT NULL CONSTRAINT DF_TaiKhoan_SoLanDangNhapSai DEFAULT (0),
    [LanDangNhapCuoi] DATETIME2(0) NULL,
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_TaiKhoan_NgayTao DEFAULT (SYSDATETIME()),
    [NgayCapNhat] DATETIME2(0) NULL,
    CONSTRAINT PK_TaiKhoan PRIMARY KEY (TaiKhoanID),
    CONSTRAINT UQ_TaiKhoan_Email UNIQUE (Email),
    CONSTRAINT FK_TaiKhoan_VaiTroID FOREIGN KEY (VaiTroID) REFERENCES dbo.VaiTro(VaiTroID),
    CONSTRAINT CK_TaiKhoan_GioiTinh CHECK (GioiTinh IN (N'Nam', N'Nữ', N'Khác')),
    CONSTRAINT CK_TaiKhoan_TrangThai CHECK (TrangThai IN (0,1,2))
);
GO

-- Bảng KhachHang: Hồ sơ khách hàng (kế thừa TaiKhoan, dùng chung khóa chính)
CREATE TABLE dbo.KhachHang (
    [KhachHangID] INT NOT NULL,
    [MaKhachHang] AS ('KH' + RIGHT('00000' + CAST(KhachHangID AS VARCHAR(10)), 6)) PERSISTED,
    [NgayDangKy] DATE NOT NULL CONSTRAINT DF_KhachHang_NgayDangKy DEFAULT (CAST(SYSDATETIME() AS DATE)),
    [ChieuCao] DECIMAL(5,2) NULL,
    [CanNang] DECIMAL(5,2) NULL,
    [MucTieu] NVARCHAR(200) NULL,
    [LienHeKhanCap] NVARCHAR(100) NULL,
    [GhiChu] NVARCHAR(500) NULL,
    CONSTRAINT PK_KhachHang PRIMARY KEY (KhachHangID),
    CONSTRAINT FK_KhachHang_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_KhachHang_ChieuCao CHECK (ChieuCao IS NULL OR ChieuCao > 0),
    CONSTRAINT CK_KhachHang_CanNang CHECK (CanNang IS NULL OR CanNang > 0)
);
GO

-- Bảng NhanVien: Hồ sơ nhân viên quầy (kế thừa TaiKhoan)
CREATE TABLE dbo.NhanVien (
    [NhanVienID] INT NOT NULL,
    [MaNhanVien] AS ('NV' + RIGHT('00000' + CAST(NhanVienID AS VARCHAR(10)), 6)) PERSISTED,
    [ChucVu] NVARCHAR(50) NULL,
    [NgayVaoLam] DATE NULL,
    [TrangThaiLamViec] TINYINT NOT NULL CONSTRAINT DF_NhanVien_TrangThaiLamViec DEFAULT (1),
    CONSTRAINT PK_NhanVien PRIMARY KEY (NhanVienID),
    CONSTRAINT FK_NhanVien_NhanVienID FOREIGN KEY (NhanVienID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_NhanVien_TrangThaiLamViec CHECK (TrangThaiLamViec IN (0,1))
);
GO

-- Bảng HuanLuyenVien: Hồ sơ huấn luyện viên (kế thừa TaiKhoan)
CREATE TABLE dbo.HuanLuyenVien (
    [HuanLuyenVienID] INT NOT NULL,
    [MaHLV] AS ('HLV' + RIGHT('00000' + CAST(HuanLuyenVienID AS VARCHAR(10)), 6)) PERSISTED,
    [KinhNghiemNam] TINYINT NOT NULL CONSTRAINT DF_HuanLuyenVien_KinhNghiemNam DEFAULT (0),
    [TieuSu] NVARCHAR(1000) NULL,
    [TrangThaiHoatDong] BIT NOT NULL CONSTRAINT DF_HuanLuyenVien_TrangThaiHoatDong DEFAULT (1),
    [NgayVaoLam] DATE NULL,
    CONSTRAINT PK_HuanLuyenVien PRIMARY KEY (HuanLuyenVienID),
    CONSTRAINT FK_HuanLuyenVien_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES dbo.TaiKhoan(TaiKhoanID)
);
GO

-- Bảng ChuyenMon: Danh mục chuyên môn huấn luyện (Yoga, Boxing...)
CREATE TABLE dbo.ChuyenMon (
    [ChuyenMonID] INT IDENTITY(1,1) NOT NULL,
    [TenChuyenMon] NVARCHAR(100) NOT NULL,
    [MoTa] NVARCHAR(300) NULL,
    CONSTRAINT PK_ChuyenMon PRIMARY KEY (ChuyenMonID),
    CONSTRAINT UQ_ChuyenMon_TenChuyenMon UNIQUE (TenChuyenMon)
);
GO

-- Bảng HLV_ChuyenMon: Bảng trung gian: HLV có những chuyên môn nào (quan hệ N–N)
CREATE TABLE dbo.HLV_ChuyenMon (
    [HuanLuyenVienID] INT NOT NULL,
    [ChuyenMonID] INT NOT NULL,
    CONSTRAINT PK_HLV_ChuyenMon PRIMARY KEY (HuanLuyenVienID, ChuyenMonID),
    CONSTRAINT FK_HLV_ChuyenMon_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES dbo.HuanLuyenVien(HuanLuyenVienID) ON DELETE CASCADE,
    CONSTRAINT FK_HLV_ChuyenMon_ChuyenMonID FOREIGN KEY (ChuyenMonID) REFERENCES dbo.ChuyenMon(ChuyenMonID)
);
GO

-- Bảng LichLamViecHLV: Khung giờ làm việc cố định hằng tuần của HLV
CREATE TABLE dbo.LichLamViecHLV (
    [LichLamViecID] INT IDENTITY(1,1) NOT NULL,
    [HuanLuyenVienID] INT NOT NULL,
    [ThuTrongTuan] TINYINT NOT NULL,
    [GioBatDau] TIME(0) NOT NULL,
    [GioKetThuc] TIME(0) NOT NULL,
    CONSTRAINT PK_LichLamViecHLV PRIMARY KEY (LichLamViecID),
    CONSTRAINT FK_LichLamViecHLV_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES dbo.HuanLuyenVien(HuanLuyenVienID) ON DELETE CASCADE,
    CONSTRAINT CK_LichLamViecHLV_ThuTrongTuan CHECK (ThuTrongTuan BETWEEN 1 AND 7),
    CONSTRAINT CK_LichLamViecHLV_Gio CHECK (GioBatDau < GioKetThuc)
);
GO

-- Bảng ThongTinTrungTam: Nội dung trang thông tin công khai (giới thiệu, cơ sở vật chất, dịch vụ, liên hệ)
CREATE TABLE dbo.ThongTinTrungTam (
    [ThongTinID] INT IDENTITY(1,1) NOT NULL,
    [LoaiMuc] TINYINT NOT NULL,
    [TieuDe] NVARCHAR(200) NOT NULL,
    [NoiDung] NVARCHAR(MAX) NOT NULL,
    [ThuTu] SMALLINT NOT NULL CONSTRAINT DF_ThongTinTrungTam_ThuTu DEFAULT (0),
    [CongBo] BIT NOT NULL CONSTRAINT DF_ThongTinTrungTam_CongBo DEFAULT (0),
    [NgayCapNhat] DATETIME2(0) NOT NULL CONSTRAINT DF_ThongTinTrungTam_NgayCapNhat DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_ThongTinTrungTam PRIMARY KEY (ThongTinID),
    CONSTRAINT CK_ThongTinTrungTam_LoaiMuc CHECK (LoaiMuc BETWEEN 1 AND 4)
);
GO

-- Bảng NhatKyHeThong: Nhật ký thao tác quan trọng (truy vết, NFR07)
CREATE TABLE dbo.NhatKyHeThong (
    [NhatKyID] BIGINT IDENTITY(1,1) NOT NULL,
    [TaiKhoanID] INT NULL,
    [HanhDong] NVARCHAR(50) NOT NULL,
    [BangTacDong] VARCHAR(100) NOT NULL,
    [KhoaBanGhi] VARCHAR(50) NULL,
    [GiaTriCu] NVARCHAR(MAX) NULL,
    [GiaTriMoi] NVARCHAR(MAX) NULL,
    [DiaChiIP] VARCHAR(45) NULL,
    [ThoiGian] DATETIME2(0) NOT NULL CONSTRAINT DF_NhatKyHeThong_ThoiGian DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_NhatKyHeThong PRIMARY KEY (NhatKyID),
    CONSTRAINT FK_NhatKyHeThong_TaiKhoanID FOREIGN KEY (TaiKhoanID) REFERENCES dbo.TaiKhoan(TaiKhoanID)
);
GO


-- ==== NHÓM B – ĐÀO TẠO (GÓI TẬP, KHÓA HỌC, LỚP, ĐIỂM DANH) ====

-- Bảng GoiTap: Gói tập của trung tâm
CREATE TABLE dbo.GoiTap (
    [GoiTapID] INT IDENTITY(1,1) NOT NULL,
    [TenGoiTap] NVARCHAR(100) NOT NULL,
    [MoTa] NVARCHAR(1000) NULL,
    [ThoiHanNgay] SMALLINT NOT NULL,
    [Gia] DECIMAL(12,2) NOT NULL,
    [DieuKienThamGia] NVARCHAR(500) NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_GoiTap_TrangThai DEFAULT (1),
    [CongBo] BIT NOT NULL CONSTRAINT DF_GoiTap_CongBo DEFAULT (0),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_GoiTap_NgayTao DEFAULT (SYSDATETIME()),
    [NgayCapNhat] DATETIME2(0) NULL,
    CONSTRAINT PK_GoiTap PRIMARY KEY (GoiTapID),
    CONSTRAINT UQ_GoiTap_TenGoiTap UNIQUE (TenGoiTap),
    CONSTRAINT CK_GoiTap_ThoiHanNgay CHECK (ThoiHanNgay > 0),
    CONSTRAINT CK_GoiTap_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_GoiTap_TrangThai CHECK (TrangThai IN (0,1))
);
GO

-- Bảng KhoaHoc: Khóa học (Yoga, Boxing, Giảm mỡ...)
CREATE TABLE dbo.KhoaHoc (
    [KhoaHocID] INT IDENTITY(1,1) NOT NULL,
    [TenKhoaHoc] NVARCHAR(150) NOT NULL,
    [MoTa] NVARCHAR(1000) NULL,
    [ChuyenMonID] INT NULL,
    [ThoiLuongTuan] TINYINT NOT NULL,
    [SoBuoi] SMALLINT NOT NULL,
    [Gia] DECIMAL(12,2) NOT NULL,
    [DieuKienThamGia] NVARCHAR(500) NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_KhoaHoc_TrangThai DEFAULT (1),
    [CongBo] BIT NOT NULL CONSTRAINT DF_KhoaHoc_CongBo DEFAULT (0),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_KhoaHoc_NgayTao DEFAULT (SYSDATETIME()),
    [NgayCapNhat] DATETIME2(0) NULL,
    CONSTRAINT PK_KhoaHoc PRIMARY KEY (KhoaHocID),
    CONSTRAINT UQ_KhoaHoc_TenKhoaHoc UNIQUE (TenKhoaHoc),
    CONSTRAINT FK_KhoaHoc_ChuyenMonID FOREIGN KEY (ChuyenMonID) REFERENCES dbo.ChuyenMon(ChuyenMonID),
    CONSTRAINT CK_KhoaHoc_ThoiLuongTuan CHECK (ThoiLuongTuan > 0),
    CONSTRAINT CK_KhoaHoc_SoBuoi CHECK (SoBuoi > 0),
    CONSTRAINT CK_KhoaHoc_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_KhoaHoc_TrangThai CHECK (TrangThai IN (0,1))
);
GO

-- Bảng Phong: Phòng tập / phòng học
CREATE TABLE dbo.Phong (
    [PhongID] INT IDENTITY(1,1) NOT NULL,
    [TenPhong] NVARCHAR(50) NOT NULL,
    [SucChua] SMALLINT NOT NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_Phong_TrangThai DEFAULT (1),
    [MoTa] NVARCHAR(200) NULL,
    CONSTRAINT PK_Phong PRIMARY KEY (PhongID),
    CONSTRAINT UQ_Phong_TenPhong UNIQUE (TenPhong),
    CONSTRAINT CK_Phong_SucChua CHECK (SucChua > 0),
    CONSTRAINT CK_Phong_TrangThai CHECK (TrangThai IN (0,1))
);
GO

-- Bảng LopHoc: Lớp học thuộc một khóa học
CREATE TABLE dbo.LopHoc (
    [LopHocID] INT IDENTITY(1,1) NOT NULL,
    [MaLop] VARCHAR(20) NOT NULL,
    [TenLop] NVARCHAR(150) NOT NULL,
    [KhoaHocID] INT NOT NULL,
    [PhongID] INT NOT NULL,
    [NgayBatDau] DATE NOT NULL,
    [NgayKetThuc] DATE NOT NULL,
    [SucChua] SMALLINT NOT NULL,
    [TrangThaiDangKy] TINYINT NOT NULL CONSTRAINT DF_LopHoc_TrangThaiDangKy DEFAULT (0),
    [CongBo] BIT NOT NULL CONSTRAINT DF_LopHoc_CongBo DEFAULT (0),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_LopHoc_NgayTao DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_LopHoc PRIMARY KEY (LopHocID),
    CONSTRAINT UQ_LopHoc_MaLop UNIQUE (MaLop),
    CONSTRAINT FK_LopHoc_KhoaHocID FOREIGN KEY (KhoaHocID) REFERENCES dbo.KhoaHoc(KhoaHocID),
    CONSTRAINT FK_LopHoc_PhongID FOREIGN KEY (PhongID) REFERENCES dbo.Phong(PhongID),
    CONSTRAINT CK_LopHoc_SucChua CHECK (SucChua > 0),
    CONSTRAINT CK_LopHoc_TrangThaiDangKy CHECK (TrangThaiDangKy IN (0,1,2,3)),
    CONSTRAINT CK_LopHoc_Ngay CHECK (NgayKetThuc >= NgayBatDau)
);
GO

-- Bảng BuoiHoc: Từng buổi học cụ thể của một lớp (lịch lớp)
CREATE TABLE dbo.BuoiHoc (
    [BuoiHocID] INT IDENTITY(1,1) NOT NULL,
    [LopHocID] INT NOT NULL,
    [PhongID] INT NOT NULL,
    [NgayHoc] DATE NOT NULL,
    [GioBatDau] TIME(0) NOT NULL,
    [GioKetThuc] TIME(0) NOT NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_BuoiHoc_TrangThai DEFAULT (1),
    [GhiChu] NVARCHAR(200) NULL,
    CONSTRAINT PK_BuoiHoc PRIMARY KEY (BuoiHocID),
    CONSTRAINT FK_BuoiHoc_LopHocID FOREIGN KEY (LopHocID) REFERENCES dbo.LopHoc(LopHocID) ON DELETE CASCADE,
    CONSTRAINT FK_BuoiHoc_PhongID FOREIGN KEY (PhongID) REFERENCES dbo.Phong(PhongID),
    CONSTRAINT CK_BuoiHoc_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_BuoiHoc_Gio CHECK (GioBatDau < GioKetThuc),
    CONSTRAINT UQ_BuoiHoc_Lop_Ngay_Gio UNIQUE (LopHocID, NgayHoc, GioBatDau)
);
GO

-- Bảng PhanCongHLV: Phân công huấn luyện viên phụ trách buổi học
CREATE TABLE dbo.PhanCongHLV (
    [PhanCongID] INT IDENTITY(1,1) NOT NULL,
    [BuoiHocID] INT NOT NULL,
    [HuanLuyenVienID] INT NOT NULL,
    [VaiTroGiangDay] TINYINT NOT NULL CONSTRAINT DF_PhanCongHLV_VaiTroGiangDay DEFAULT (1),
    [NguoiPhanCongID] INT NOT NULL,
    [NgayPhanCong] DATETIME2(0) NOT NULL CONSTRAINT DF_PhanCongHLV_NgayPhanCong DEFAULT (SYSDATETIME()),
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_PhanCongHLV_TrangThai DEFAULT (1),
    CONSTRAINT PK_PhanCongHLV PRIMARY KEY (PhanCongID),
    CONSTRAINT FK_PhanCongHLV_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES dbo.BuoiHoc(BuoiHocID),
    CONSTRAINT FK_PhanCongHLV_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES dbo.HuanLuyenVien(HuanLuyenVienID),
    CONSTRAINT FK_PhanCongHLV_NguoiPhanCongID FOREIGN KEY (NguoiPhanCongID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_PhanCongHLV_VaiTroGiangDay CHECK (VaiTroGiangDay IN (1,2)),
    CONSTRAINT CK_PhanCongHLV_TrangThai CHECK (TrangThai IN (0,1)),
    CONSTRAINT UQ_PhanCong_Buoi_HLV UNIQUE (BuoiHocID, HuanLuyenVienID)
);
GO

-- Bảng DangKyKhoaHoc: Đăng ký lớp/khóa học của khách hàng
CREATE TABLE dbo.DangKyKhoaHoc (
    [DangKyID] INT IDENTITY(1,1) NOT NULL,
    [KhachHangID] INT NOT NULL,
    [LopHocID] INT NOT NULL,
    [NgayDangKy] DATETIME2(0) NOT NULL CONSTRAINT DF_DangKyKhoaHoc_NgayDangKy DEFAULT (SYSDATETIME()),
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_DangKyKhoaHoc_TrangThai DEFAULT (1),
    [NguoiXuLyID] INT NULL,
    [NgayXuLy] DATETIME2(0) NULL,
    [LyDoTuChoi] NVARCHAR(300) NULL,
    [GhiChu] NVARCHAR(300) NULL,
    CONSTRAINT PK_DangKyKhoaHoc PRIMARY KEY (DangKyID),
    CONSTRAINT FK_DangKyKhoaHoc_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.KhachHang(KhachHangID),
    CONSTRAINT FK_DangKyKhoaHoc_LopHocID FOREIGN KEY (LopHocID) REFERENCES dbo.LopHoc(LopHocID),
    CONSTRAINT FK_DangKyKhoaHoc_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_DangKyKhoaHoc_TrangThai CHECK (TrangThai IN (1,2,3,4,5,6))
);
GO

-- Bảng DangKyGoiTap: Gói tập mà khách hàng đang sở hữu (hợp đồng/gói tập)
CREATE TABLE dbo.DangKyGoiTap (
    [DangKyGoiTapID] INT IDENTITY(1,1) NOT NULL,
    [KhachHangID] INT NOT NULL,
    [GoiTapID] INT NOT NULL,
    [NgayBatDau] DATE NOT NULL,
    [NgayHetHan] DATE NOT NULL,
    [GiaApDung] DECIMAL(12,2) NOT NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_DangKyGoiTap_TrangThai DEFAULT (1),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_DangKyGoiTap_NgayTao DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_DangKyGoiTap PRIMARY KEY (DangKyGoiTapID),
    CONSTRAINT FK_DangKyGoiTap_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.KhachHang(KhachHangID),
    CONSTRAINT FK_DangKyGoiTap_GoiTapID FOREIGN KEY (GoiTapID) REFERENCES dbo.GoiTap(GoiTapID),
    CONSTRAINT CK_DangKyGoiTap_GiaApDung CHECK (GiaApDung >= 0),
    CONSTRAINT CK_DangKyGoiTap_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_DangKyGoiTap_Ngay CHECK (NgayHetHan >= NgayBatDau)
);
GO

-- Bảng YeuCauDoiHuyLich: Yêu cầu hủy hoặc đổi lịch học của khách hàng
CREATE TABLE dbo.YeuCauDoiHuyLich (
    [YeuCauID] INT IDENTITY(1,1) NOT NULL,
    [DangKyID] INT NOT NULL,
    [BuoiHocID] INT NULL,
    [LoaiYeuCau] TINYINT NOT NULL,
    [LopHocMoiID] INT NULL,
    [LyDo] NVARCHAR(300) NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_YeuCauDoiHuyLich_TrangThai DEFAULT (1),
    [NgayGui] DATETIME2(0) NOT NULL CONSTRAINT DF_YeuCauDoiHuyLich_NgayGui DEFAULT (SYSDATETIME()),
    [NguoiXuLyID] INT NULL,
    [NgayXuLy] DATETIME2(0) NULL,
    [GhiChuXuLy] NVARCHAR(300) NULL,
    CONSTRAINT PK_YeuCauDoiHuyLich PRIMARY KEY (YeuCauID),
    CONSTRAINT FK_YeuCauDoiHuyLich_DangKyID FOREIGN KEY (DangKyID) REFERENCES dbo.DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_YeuCauDoiHuyLich_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES dbo.BuoiHoc(BuoiHocID),
    CONSTRAINT FK_YeuCauDoiHuyLich_LopHocMoiID FOREIGN KEY (LopHocMoiID) REFERENCES dbo.LopHoc(LopHocID),
    CONSTRAINT FK_YeuCauDoiHuyLich_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_YeuCauDoiHuyLich_LoaiYeuCau CHECK (LoaiYeuCau IN (1,2)),
    CONSTRAINT CK_YeuCauDoiHuyLich_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_YeuCau_DoiLich CHECK (LoaiYeuCau = 1 OR LopHocMoiID IS NOT NULL)
);
GO

-- Bảng DiemDanh: Lịch sử check-in vào trung tâm và điểm danh buổi học
CREATE TABLE dbo.DiemDanh (
    [DiemDanhID] INT IDENTITY(1,1) NOT NULL,
    [KhachHangID] INT NOT NULL,
    [LoaiCheckIn] TINYINT NOT NULL,
    [BuoiHocID] INT NULL,
    [DangKyID] INT NULL,
    [DangKyGoiTapID] INT NULL,
    [ThoiGian] DATETIME2(0) NOT NULL CONSTRAINT DF_DiemDanh_ThoiGian DEFAULT (SYSDATETIME()),
    [NguoiGhiNhanID] INT NOT NULL,
    [GhiChu] NVARCHAR(200) NULL,
    CONSTRAINT PK_DiemDanh PRIMARY KEY (DiemDanhID),
    CONSTRAINT FK_DiemDanh_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.KhachHang(KhachHangID),
    CONSTRAINT FK_DiemDanh_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES dbo.BuoiHoc(BuoiHocID),
    CONSTRAINT FK_DiemDanh_DangKyID FOREIGN KEY (DangKyID) REFERENCES dbo.DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_DiemDanh_DangKyGoiTapID FOREIGN KEY (DangKyGoiTapID) REFERENCES dbo.DangKyGoiTap(DangKyGoiTapID),
    CONSTRAINT FK_DiemDanh_NguoiGhiNhanID FOREIGN KEY (NguoiGhiNhanID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_DiemDanh_LoaiCheckIn CHECK (LoaiCheckIn IN (1,2)),
    CONSTRAINT CK_DiemDanh_Buoi CHECK (LoaiCheckIn = 1 OR BuoiHocID IS NOT NULL)
);
GO

-- Bảng KetQuaHocVien: Nhận xét, tiến độ và chỉ số theo dõi của học viên do HLV cập nhật
CREATE TABLE dbo.KetQuaHocVien (
    [KetQuaID] INT IDENTITY(1,1) NOT NULL,
    [DangKyID] INT NOT NULL,
    [BuoiHocID] INT NULL,
    [HuanLuyenVienID] INT NOT NULL,
    [NhanXet] NVARCHAR(1000) NULL,
    [MucDoHoanThanh] TINYINT NULL,
    [CanNang] DECIMAL(5,2) NULL,
    [TyLeMo] DECIMAL(4,1) NULL,
    [ChiSoKhac] NVARCHAR(300) NULL,
    [NgayCapNhat] DATETIME2(0) NOT NULL CONSTRAINT DF_KetQuaHocVien_NgayCapNhat DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_KetQuaHocVien PRIMARY KEY (KetQuaID),
    CONSTRAINT FK_KetQuaHocVien_DangKyID FOREIGN KEY (DangKyID) REFERENCES dbo.DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_KetQuaHocVien_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES dbo.BuoiHoc(BuoiHocID),
    CONSTRAINT FK_KetQuaHocVien_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES dbo.HuanLuyenVien(HuanLuyenVienID),
    CONSTRAINT CK_KetQuaHocVien_MucDoHoanThanh CHECK (MucDoHoanThanh IS NULL OR MucDoHoanThanh BETWEEN 0 AND 100)
);
GO


-- ==== NHÓM C – CỬA HÀNG, HÓA ĐƠN, THÔNG BÁO, HỖ TRỢ ====

-- Bảng DanhMucSanPham: Danh mục (nhóm) sản phẩm của cửa hàng
CREATE TABLE dbo.DanhMucSanPham (
    [DanhMucID] INT IDENTITY(1,1) NOT NULL,
    [TenDanhMuc] NVARCHAR(100) NOT NULL,
    [MoTa] NVARCHAR(200) NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_DanhMucSanPham_TrangThai DEFAULT (1),
    CONSTRAINT PK_DanhMucSanPham PRIMARY KEY (DanhMucID),
    CONSTRAINT UQ_DanhMucSanPham_TenDanhMuc UNIQUE (TenDanhMuc),
    CONSTRAINT CK_DanhMucSanPham_TrangThai CHECK (TrangThai IN (0,1))
);
GO

-- Bảng SanPham: Sản phẩm bán trực tiếp tại cửa hàng
CREATE TABLE dbo.SanPham (
    [SanPhamID] INT IDENTITY(1,1) NOT NULL,
    [MaSanPham] VARCHAR(20) NOT NULL,
    [TenSanPham] NVARCHAR(150) NOT NULL,
    [MoTa] NVARCHAR(500) NULL,
    [DanhMucID] INT NOT NULL,
    [Gia] DECIMAL(12,2) NOT NULL,
    [SoLuongTon] INT NOT NULL CONSTRAINT DF_SanPham_SoLuongTon DEFAULT (0),
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_SanPham_TrangThai DEFAULT (1),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_SanPham_NgayTao DEFAULT (SYSDATETIME()),
    [NgayCapNhat] DATETIME2(0) NULL,
    CONSTRAINT PK_SanPham PRIMARY KEY (SanPhamID),
    CONSTRAINT UQ_SanPham_MaSanPham UNIQUE (MaSanPham),
    CONSTRAINT FK_SanPham_DanhMucID FOREIGN KEY (DanhMucID) REFERENCES dbo.DanhMucSanPham(DanhMucID),
    CONSTRAINT CK_SanPham_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_SanPham_SoLuongTon CHECK (SoLuongTon >= 0),
    CONSTRAINT CK_SanPham_TrangThai CHECK (TrangThai IN (0,1))
);
GO

-- Bảng HoaDon: Hóa đơn thu tiền tại quầy (khóa học, gói tập hoặc sản phẩm)
CREATE TABLE dbo.HoaDon (
    [HoaDonID] INT IDENTITY(1,1) NOT NULL,
    [MaHoaDon] AS ('HD' + RIGHT('00000000' + CAST(HoaDonID AS VARCHAR(10)), 8)) PERSISTED,
    [KhachHangID] INT NULL,
    [NguoiLapID] INT NOT NULL,
    [LoaiHoaDon] TINYINT NOT NULL,
    [NgayLap] DATETIME2(0) NOT NULL CONSTRAINT DF_HoaDon_NgayLap DEFAULT (SYSDATETIME()),
    [TongTien] DECIMAL(14,2) NOT NULL CONSTRAINT DF_HoaDon_TongTien DEFAULT (0),
    [PhuongThucThanhToan] TINYINT NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_HoaDon_TrangThai DEFAULT (1),
    [NgayThanhToan] DATETIME2(0) NULL,
    [NguoiXacNhanID] INT NULL,
    [GhiChu] NVARCHAR(300) NULL,
    CONSTRAINT PK_HoaDon PRIMARY KEY (HoaDonID),
    CONSTRAINT FK_HoaDon_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.KhachHang(KhachHangID),
    CONSTRAINT FK_HoaDon_NguoiLapID FOREIGN KEY (NguoiLapID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT FK_HoaDon_NguoiXacNhanID FOREIGN KEY (NguoiXacNhanID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_HoaDon_LoaiHoaDon CHECK (LoaiHoaDon IN (1,2,3)),
    CONSTRAINT CK_HoaDon_TongTien CHECK (TongTien >= 0),
    CONSTRAINT CK_HoaDon_PhuongThucThanhToan CHECK (PhuongThucThanhToan IS NULL OR PhuongThucThanhToan IN (1,2,3)),
    CONSTRAINT CK_HoaDon_TrangThai CHECK (TrangThai IN (1,2,3))
);
GO

-- Bảng ChiTietHoaDon: Các dòng chi tiết của hóa đơn
CREATE TABLE dbo.ChiTietHoaDon (
    [ChiTietID] INT IDENTITY(1,1) NOT NULL,
    [HoaDonID] INT NOT NULL,
    [SanPhamID] INT NULL,
    [DangKyID] INT NULL,
    [DangKyGoiTapID] INT NULL,
    [MoTa] NVARCHAR(200) NULL,
    [SoLuong] INT NOT NULL CONSTRAINT DF_ChiTietHoaDon_SoLuong DEFAULT (1),
    [DonGia] DECIMAL(12,2) NOT NULL,
    [ThanhTien] AS (SoLuong * DonGia) PERSISTED,
    CONSTRAINT PK_ChiTietHoaDon PRIMARY KEY (ChiTietID),
    CONSTRAINT FK_ChiTietHoaDon_HoaDonID FOREIGN KEY (HoaDonID) REFERENCES dbo.HoaDon(HoaDonID) ON DELETE CASCADE,
    CONSTRAINT FK_ChiTietHoaDon_SanPhamID FOREIGN KEY (SanPhamID) REFERENCES dbo.SanPham(SanPhamID),
    CONSTRAINT FK_ChiTietHoaDon_DangKyID FOREIGN KEY (DangKyID) REFERENCES dbo.DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_ChiTietHoaDon_DangKyGoiTapID FOREIGN KEY (DangKyGoiTapID) REFERENCES dbo.DangKyGoiTap(DangKyGoiTapID),
    CONSTRAINT CK_ChiTietHoaDon_SoLuong CHECK (SoLuong > 0),
    CONSTRAINT CK_ChiTietHoaDon_DonGia CHECK (DonGia >= 0),
    CONSTRAINT CK_ChiTietHoaDon_MotDoiTuong CHECK ((CASE WHEN SanPhamID IS NULL THEN 0 ELSE 1 END + CASE WHEN DangKyID IS NULL THEN 0 ELSE 1 END + CASE WHEN DangKyGoiTapID IS NULL THEN 0 ELSE 1 END) = 1)
);
GO

-- Bảng ThongBao: Thông báo hệ thống do quản trị viên tạo
CREATE TABLE dbo.ThongBao (
    [ThongBaoID] INT IDENTITY(1,1) NOT NULL,
    [TieuDe] NVARCHAR(200) NOT NULL,
    [NoiDung] NVARCHAR(MAX) NOT NULL,
    [NhomNguoiNhan] TINYINT NOT NULL,
    [NguoiTaoID] INT NOT NULL,
    [ThoiGianGui] DATETIME2(0) NULL,
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_ThongBao_TrangThai DEFAULT (1),
    [NgayTao] DATETIME2(0) NOT NULL CONSTRAINT DF_ThongBao_NgayTao DEFAULT (SYSDATETIME()),
    [NgayCapNhat] DATETIME2(0) NULL,
    CONSTRAINT PK_ThongBao PRIMARY KEY (ThongBaoID),
    CONSTRAINT FK_ThongBao_NguoiTaoID FOREIGN KEY (NguoiTaoID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_ThongBao_NhomNguoiNhan CHECK (NhomNguoiNhan IN (1,2,3,4,5)),
    CONSTRAINT CK_ThongBao_TrangThai CHECK (TrangThai IN (1,2,3,4,5))
);
GO

-- Bảng ThongBaoNguoiNhan: Người nhận của từng thông báo và trạng thái đã đọc
CREATE TABLE dbo.ThongBaoNguoiNhan (
    [ThongBaoID] INT NOT NULL,
    [TaiKhoanID] INT NOT NULL,
    [DaDoc] BIT NOT NULL CONSTRAINT DF_ThongBaoNguoiNhan_DaDoc DEFAULT (0),
    [NgayDoc] DATETIME2(0) NULL,
    CONSTRAINT PK_ThongBaoNguoiNhan PRIMARY KEY (ThongBaoID, TaiKhoanID),
    CONSTRAINT FK_ThongBaoNguoiNhan_ThongBaoID FOREIGN KEY (ThongBaoID) REFERENCES dbo.ThongBao(ThongBaoID) ON DELETE CASCADE,
    CONSTRAINT FK_ThongBaoNguoiNhan_TaiKhoanID FOREIGN KEY (TaiKhoanID) REFERENCES dbo.TaiKhoan(TaiKhoanID)
);
GO

-- Bảng PhanHoiHoTro: Phản hồi và yêu cầu hỗ trợ của khách hàng
CREATE TABLE dbo.PhanHoiHoTro (
    [PhanHoiID] INT IDENTITY(1,1) NOT NULL,
    [KhachHangID] INT NOT NULL,
    [TieuDe] NVARCHAR(200) NOT NULL,
    [NoiDung] NVARCHAR(2000) NOT NULL,
    [PhanLoai] TINYINT NOT NULL CONSTRAINT DF_PhanHoiHoTro_PhanLoai DEFAULT (1),
    [TrangThai] TINYINT NOT NULL CONSTRAINT DF_PhanHoiHoTro_TrangThai DEFAULT (1),
    [NgayGui] DATETIME2(0) NOT NULL CONSTRAINT DF_PhanHoiHoTro_NgayGui DEFAULT (SYSDATETIME()),
    [NguoiXuLyID] INT NULL,
    [NgayXuLy] DATETIME2(0) NULL,
    [KetQuaXuLy] NVARCHAR(1000) NULL,
    [PhanHoiTrungID] INT NULL,
    CONSTRAINT PK_PhanHoiHoTro PRIMARY KEY (PhanHoiID),
    CONSTRAINT FK_PhanHoiHoTro_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES dbo.KhachHang(KhachHangID),
    CONSTRAINT FK_PhanHoiHoTro_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES dbo.TaiKhoan(TaiKhoanID),
    CONSTRAINT FK_PhanHoiHoTro_PhanHoiTrungID FOREIGN KEY (PhanHoiTrungID) REFERENCES dbo.PhanHoiHoTro(PhanHoiID),
    CONSTRAINT CK_PhanHoiHoTro_PhanLoai CHECK (PhanLoai IN (1,2,3,4)),
    CONSTRAINT CK_PhanHoiHoTro_TrangThai CHECK (TrangThai IN (1,2,3,4))
);
GO


/* ---------------------------------------------------------------------
   PHẦN 3 – CHỈ MỤC (INDEX)
   PK/UNIQUE đã tự có index. Dưới đây là index bổ sung cho các truy vấn thường dùng
   và index lọc (filtered unique) để chặn bản ghi trùng theo nghiệp vụ.
   --------------------------------------------------------------------- */

CREATE UNIQUE NONCLUSTERED INDEX UX_TaiKhoan_SoDienThoai ON dbo.TaiKhoan (SoDienThoai) WHERE SoDienThoai IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_TaiKhoan_VaiTroID ON dbo.TaiKhoan (VaiTroID);
CREATE NONCLUSTERED INDEX IX_KhachHang_MaKhachHang ON dbo.KhachHang (MaKhachHang);
CREATE NONCLUSTERED INDEX IX_LichLamViecHLV_HLV ON dbo.LichLamViecHLV (HuanLuyenVienID, ThuTrongTuan);
CREATE NONCLUSTERED INDEX IX_NhatKy_ThoiGian ON dbo.NhatKyHeThong (ThoiGian);
CREATE NONCLUSTERED INDEX IX_NhatKy_Bang ON dbo.NhatKyHeThong (BangTacDong, KhoaBanGhi);
CREATE NONCLUSTERED INDEX IX_LopHoc_KhoaHocID ON dbo.LopHoc (KhoaHocID);
CREATE NONCLUSTERED INDEX IX_LopHoc_TrangThai ON dbo.LopHoc (TrangThaiDangKy, CongBo);
CREATE NONCLUSTERED INDEX IX_BuoiHoc_Phong_Ngay ON dbo.BuoiHoc (PhongID, NgayHoc, GioBatDau);
CREATE NONCLUSTERED INDEX IX_BuoiHoc_Ngay ON dbo.BuoiHoc (NgayHoc);
CREATE NONCLUSTERED INDEX IX_PhanCong_HLV ON dbo.PhanCongHLV (HuanLuyenVienID, TrangThai);
CREATE UNIQUE NONCLUSTERED INDEX UX_DangKy_KhachHang_Lop ON dbo.DangKyKhoaHoc (KhachHangID, LopHocID) WHERE TrangThai IN (1,2,5);
CREATE NONCLUSTERED INDEX IX_DangKy_Lop_TrangThai ON dbo.DangKyKhoaHoc (LopHocID, TrangThai);
CREATE NONCLUSTERED INDEX IX_DangKyGoiTap_KH ON dbo.DangKyGoiTap (KhachHangID, TrangThai, NgayHetHan);
CREATE NONCLUSTERED INDEX IX_YeuCau_TrangThai ON dbo.YeuCauDoiHuyLich (TrangThai, NgayGui);
CREATE UNIQUE NONCLUSTERED INDEX UX_DiemDanh_KhachHang_Buoi ON dbo.DiemDanh (KhachHangID, BuoiHocID) WHERE BuoiHocID IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_DiemDanh_KH_ThoiGian ON dbo.DiemDanh (KhachHangID, ThoiGian);
CREATE NONCLUSTERED INDEX IX_KetQua_DangKy ON dbo.KetQuaHocVien (DangKyID, NgayCapNhat);
CREATE NONCLUSTERED INDEX IX_SanPham_DanhMuc ON dbo.SanPham (DanhMucID, TrangThai);
CREATE NONCLUSTERED INDEX IX_HoaDon_KhachHang ON dbo.HoaDon (KhachHangID);
CREATE NONCLUSTERED INDEX IX_HoaDon_Ngay_TrangThai ON dbo.HoaDon (TrangThai, NgayLap);
CREATE NONCLUSTERED INDEX IX_ChiTietHoaDon_HoaDon ON dbo.ChiTietHoaDon (HoaDonID);
CREATE NONCLUSTERED INDEX IX_ChiTietHoaDon_SanPham ON dbo.ChiTietHoaDon (SanPhamID) WHERE SanPhamID IS NOT NULL;
CREATE NONCLUSTERED INDEX IX_ThongBao_TrangThai ON dbo.ThongBao (TrangThai, ThoiGianGui);
CREATE NONCLUSTERED INDEX IX_TBNN_TaiKhoan ON dbo.ThongBaoNguoiNhan (TaiKhoanID, DaDoc);
CREATE NONCLUSTERED INDEX IX_PhanHoi_TrangThai ON dbo.PhanHoiHoTro (TrangThai, NgayGui);
CREATE NONCLUSTERED INDEX IX_PhanHoi_KhachHang ON dbo.PhanHoiHoTro (KhachHangID);
GO


/* ---------------------------------------------------------------------
   PHẦN 4 – TRIGGER
   --------------------------------------------------------------------- */

-- 4.1 Sức chứa lớp không được vượt sức chứa phòng (UC15)
CREATE TRIGGER dbo.trg_LopHoc_KiemTraSucChua
ON dbo.LopHoc
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.Phong p ON p.PhongID = i.PhongID
               WHERE i.SucChua > p.SucChua)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 50040, N'Sức chứa của lớp vượt quá sức chứa của phòng học.', 1;
    END
END;
GO

-- 4.2 Không xếp hai buổi học trùng giờ trong cùng một phòng (UC15)
CREATE TRIGGER dbo.trg_BuoiHoc_KiemTraTrungPhong
ON dbo.BuoiHoc
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1
               FROM inserted i
               JOIN dbo.BuoiHoc b ON b.PhongID = i.PhongID
                                 AND b.NgayHoc = i.NgayHoc
                                 AND b.BuoiHocID <> i.BuoiHocID
                                 AND b.TrangThai <> 3
                                 AND b.GioBatDau < i.GioKetThuc
                                 AND i.GioBatDau < b.GioKetThuc
               WHERE i.TrangThai <> 3)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 50041, N'Phòng học đã có buổi học khác trong khung giờ này.', 1;
    END
END;
GO

-- 4.3 Tự cập nhật TongTien của hóa đơn khi thêm/sửa/xóa dòng chi tiết (UC21, UC22)
--     và không cho sửa chi tiết của hóa đơn đã thanh toán/đã hủy
CREATE TRIGGER dbo.trg_ChiTietHoaDon_CapNhatTongTien
ON dbo.ChiTietHoaDon
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1
               FROM dbo.HoaDon h
               WHERE h.TrangThai <> 1
                 AND h.HoaDonID IN (SELECT HoaDonID FROM inserted UNION SELECT HoaDonID FROM deleted))
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 50042, N'Không được thay đổi chi tiết của hóa đơn đã thanh toán hoặc đã hủy.', 1;
    END

    UPDATE h
    SET h.TongTien = ISNULL((SELECT SUM(c.ThanhTien) FROM dbo.ChiTietHoaDon c
                             WHERE c.HoaDonID = h.HoaDonID), 0)
    FROM dbo.HoaDon h
    WHERE h.HoaDonID IN (SELECT HoaDonID FROM inserted UNION SELECT HoaDonID FROM deleted);
END;
GO


/* ---------------------------------------------------------------------
   PHẦN 5 – DỮ LIỆU MẪU
   LƯU Ý: cột MatKhauHash chỉ là giá trị giữ chỗ. Khi làm website, mật khẩu phải được
   băm bằng thư viện (bcrypt/PBKDF2/Argon2) ở phía ứng dụng rồi mới lưu vào đây.
   Ngày học mẫu: T2 09/11/2026 trở đi (09/11/2026 là thứ Hai).
   --------------------------------------------------------------------- */
GO
INSERT dbo.VaiTro (VaiTroID, MaVaiTro, TenVaiTro, MoTa) VALUES
 (1, 'ADMIN',     N'Quản trị viên',   N'Quản lý toàn bộ dữ liệu nền, nhân sự, báo cáo'),
 (2, 'NHANVIEN',  N'Nhân viên',       N'Nghiệp vụ tại quầy: check-in, xử lý đăng ký, bán hàng, thanh toán'),
 (3, 'HLV',       N'Huấn luyện viên', N'Xem lịch dạy, cập nhật kết quả học viên'),
 (4, 'KHACHHANG', N'Khách hàng',      N'Xem gói tập/khóa học, đăng ký lớp, xem lịch học');

INSERT dbo.TaiKhoan (Email, SoDienThoai, MatKhauHash, HoTen, GioiTinh, VaiTroID, TrangThai) VALUES
 ('admin@gym.local',      '0900000001', 'CHANGE_ME_HASH', N'Nguyễn Quản Trị',  N'Nam', 1, 1),
 ('nhanvien01@gym.local', '0900000002', 'CHANGE_ME_HASH', N'Trần Thu Ngân',    N'Nữ',  2, 1),
 ('hlv01@gym.local',      '0900000003', 'CHANGE_ME_HASH', N'Lê Minh Yoga',     N'Nữ',  3, 1),
 ('hlv02@gym.local',      '0900000004', 'CHANGE_ME_HASH', N'Phạm Quốc Boxing', N'Nam', 3, 1),
 ('kh01@gym.local',       '0900000005', 'CHANGE_ME_HASH', N'Võ Văn An',        N'Nam', 4, 1),
 ('kh02@gym.local',       '0900000006', 'CHANGE_ME_HASH', N'Nguyễn Thị Bình',  N'Nữ',  4, 1),
 ('kh03@gym.local',       '0900000007', 'CHANGE_ME_HASH', N'Đặng Văn Cường',   N'Nam', 4, 1);

INSERT dbo.NhanVien (NhanVienID, ChucVu, NgayVaoLam)
SELECT TaiKhoanID, N'Nhân viên quầy', '20260101' FROM dbo.TaiKhoan WHERE Email = 'nhanvien01@gym.local';

INSERT dbo.HuanLuyenVien (HuanLuyenVienID, KinhNghiemNam, TieuSu, NgayVaoLam)
SELECT TaiKhoanID,
       CASE Email WHEN 'hlv01@gym.local' THEN 5 ELSE 3 END,
       CASE Email WHEN 'hlv01@gym.local' THEN N'Chứng chỉ Yoga Alliance RYT-200' ELSE N'Võ sĩ Boxing nghiệp dư, chứng chỉ PT' END,
       '20260101'
FROM dbo.TaiKhoan WHERE Email IN ('hlv01@gym.local', 'hlv02@gym.local');

INSERT dbo.KhachHang (KhachHangID, MucTieu)
SELECT TaiKhoanID, N'Cải thiện sức khỏe' FROM dbo.TaiKhoan WHERE VaiTroID = 4;

INSERT dbo.ChuyenMon (TenChuyenMon, MoTa) VALUES
 (N'Yoga',             N'Yoga cơ bản, nâng cao, thiền'),
 (N'Boxing',           N'Boxing thể lực và đối kháng nhẹ'),
 (N'Gym - Thể hình',   N'Tập tạ, tăng cơ'),
 (N'Cardio - Giảm mỡ', N'Giảm mỡ, cải thiện tim phổi'),
 (N'Zumba',            N'Nhảy aerobic theo nhạc');

INSERT dbo.HLV_ChuyenMon (HuanLuyenVienID, ChuyenMonID)
SELECT tk.TaiKhoanID, cm.ChuyenMonID
FROM dbo.TaiKhoan tk
JOIN dbo.ChuyenMon cm
  ON (tk.Email = 'hlv01@gym.local' AND cm.TenChuyenMon = N'Yoga')
  OR (tk.Email = 'hlv02@gym.local' AND cm.TenChuyenMon IN (N'Boxing', N'Cardio - Giảm mỡ'));

-- Lịch làm việc: Thứ hai đến Thứ bảy, 06:00 - 21:00
INSERT dbo.LichLamViecHLV (HuanLuyenVienID, ThuTrongTuan, GioBatDau, GioKetThuc)
SELECT h.HuanLuyenVienID, d.n, '06:00', '21:00'
FROM dbo.HuanLuyenVien h
CROSS JOIN (VALUES (1), (2), (3), (4), (5), (6)) AS d(n);

INSERT dbo.Phong (TenPhong, SucChua, MoTa) VALUES
 (N'Phòng Yoga',   20, N'Phòng yoga, sàn gỗ, gương'),
 (N'Phòng Gym',    40, N'Khu tạ và máy tập'),
 (N'Phòng Boxing', 15, N'Phòng boxing, bao cát');

INSERT dbo.GoiTap (TenGoiTap, MoTa, ThoiHanNgay, Gia, DieuKienThamGia, CongBo) VALUES
 (N'Gói 1 tháng',  N'Tập tự do không giới hạn trong 1 tháng',  30,  400000,  N'Từ 16 tuổi trở lên', 1),
 (N'Gói 3 tháng',  N'Tập tự do không giới hạn trong 3 tháng',  90,  1000000, N'Từ 16 tuổi trở lên', 1),
 (N'Gói 12 tháng', N'Tập tự do không giới hạn trong 12 tháng', 365, 3600000, N'Từ 16 tuổi trở lên', 1);

INSERT dbo.KhoaHoc (TenKhoaHoc, MoTa, ChuyenMonID, ThoiLuongTuan, SoBuoi, Gia, DieuKienThamGia, CongBo)
SELECT v.ten, v.mota, cm.ChuyenMonID, v.tuan, v.buoi, v.gia, v.dk, 1
FROM (VALUES
  (N'Yoga cơ bản',     N'Làm quen các tư thế yoga, hít thở, giãn cơ',   N'Yoga',             8, 16, 1200000, N'Không yêu cầu kinh nghiệm'),
  (N'Boxing nhập môn', N'Kỹ thuật đấm cơ bản, thể lực, phản xạ',        N'Boxing',           8, 16, 1600000, N'Sức khỏe tốt'),
  (N'Giảm mỡ 8 tuần',  N'Kết hợp cardio và tạ nhẹ, theo dõi chỉ số',    N'Cardio - Giảm mỡ', 8, 24, 2000000, N'Có xác nhận sức khỏe')
) AS v(ten, mota, cm, tuan, buoi, gia, dk)
JOIN dbo.ChuyenMon cm ON cm.TenChuyenMon = v.cm;

INSERT dbo.LopHoc (MaLop, TenLop, KhoaHocID, PhongID, NgayBatDau, NgayKetThuc, SucChua, TrangThaiDangKy, CongBo)
SELECT v.ma, v.ten, kh.KhoaHocID, p.PhongID, '20261109', '20261231', v.sc, 1, 1
FROM (VALUES
  ('YG-2611-A', N'Yoga cơ bản - Sáng T2/T4',   N'Yoga cơ bản',     N'Phòng Yoga',   20),
  ('BX-2611-A', N'Boxing nhập môn - Tối T3/T5', N'Boxing nhập môn', N'Phòng Boxing',  2)
) AS v(ma, ten, kh, phong, sc)
JOIN dbo.KhoaHoc kh ON kh.TenKhoaHoc = v.kh
JOIN dbo.Phong p    ON p.TenPhong = v.phong;

INSERT dbo.BuoiHoc (LopHocID, PhongID, NgayHoc, GioBatDau, GioKetThuc)
SELECT l.LopHocID, l.PhongID, CONVERT(date, v.d, 112), CONVERT(time(0), v.s), CONVERT(time(0), v.e)
FROM (VALUES
  ('YG-2611-A', '20261109', '06:00', '07:00'), ('YG-2611-A', '20261111', '06:00', '07:00'),
  ('YG-2611-A', '20261116', '06:00', '07:00'), ('YG-2611-A', '20261118', '06:00', '07:00'),
  ('BX-2611-A', '20261110', '18:00', '19:30'), ('BX-2611-A', '20261112', '18:00', '19:30'),
  ('BX-2611-A', '20261117', '18:00', '19:30'), ('BX-2611-A', '20261119', '18:00', '19:30')
) AS v(ma, d, s, e)
JOIN dbo.LopHoc l ON l.MaLop = v.ma;

-- Phân công HLV: hlv01 dạy lớp Yoga, hlv02 dạy lớp Boxing (HLV chính)
INSERT dbo.PhanCongHLV (BuoiHocID, HuanLuyenVienID, VaiTroGiangDay, NguoiPhanCongID)
SELECT b.BuoiHocID, hlv.TaiKhoanID, 1, adm.TaiKhoanID
FROM dbo.BuoiHoc b
JOIN dbo.LopHoc l   ON l.LopHocID = b.LopHocID
JOIN dbo.TaiKhoan hlv ON hlv.Email = CASE l.MaLop WHEN 'YG-2611-A' THEN 'hlv01@gym.local' ELSE 'hlv02@gym.local' END
CROSS JOIN (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'admin@gym.local') AS adm;

INSERT dbo.DanhMucSanPham (TenDanhMuc, MoTa) VALUES
 (N'Thực phẩm bổ sung',  N'Whey, vitamin, BCAA'),
 (N'Phụ kiện tập luyện', N'Găng tay, thảm, bình nước'),
 (N'Đồ uống',            N'Nước điện giải, nước suối');

INSERT dbo.SanPham (MaSanPham, TenSanPham, MoTa, DanhMucID, Gia, SoLuongTon)
SELECT v.ma, v.ten, v.mota, dm.DanhMucID, v.gia, v.ton
FROM (VALUES
  ('WHEY-01', N'Whey Protein 2lb',     N'Bổ sung đạm',        N'Thực phẩm bổ sung',  1200000, 20),
  ('GANG-01', N'Găng tay tập gym',     N'Size M/L',           N'Phụ kiện tập luyện',  150000, 50),
  ('BINH-01', N'Bình nước 1 lít',      N'Nhựa Tritan',        N'Phụ kiện tập luyện',   90000, 40),
  ('THAM-01', N'Thảm Yoga TPE',        N'Dày 6mm',            N'Phụ kiện tập luyện',  280000, 15),
  ('NUOC-01', N'Nước điện giải 500ml', N'Bù khoáng',          N'Đồ uống',              15000, 200)
) AS v(ma, ten, mota, dm, gia, ton)
JOIN dbo.DanhMucSanPham dm ON dm.TenDanhMuc = v.dm;

INSERT dbo.ThongTinTrungTam (LoaiMuc, TieuDe, NoiDung, ThuTu, CongBo) VALUES
 (1, N'Giới thiệu trung tâm',  N'Trung tâm thể hình hiện đại với đội ngũ huấn luyện viên giàu kinh nghiệm.', 1, 1),
 (2, N'Cơ sở vật chất',        N'Phòng gym, phòng yoga, phòng boxing, khu thay đồ và gửi xe rộng rãi.',     2, 1),
 (3, N'Dịch vụ',               N'Gói tập tự do, khóa học theo lớp, huấn luyện cá nhân, cửa hàng dụng cụ.',   3, 1),
 (4, N'Liên hệ',               N'Đà Nẵng - Hotline: 0900 000 001 - Giờ mở cửa: 05:30 - 21:30 hằng ngày.',    4, 1);

-- Gói tập đang hiệu lực cho khách kh01 (để thử check-in)
INSERT dbo.DangKyGoiTap (KhachHangID, GoiTapID, NgayBatDau, NgayHetHan, GiaApDung)
SELECT tk.TaiKhoanID, g.GoiTapID, CAST(SYSDATETIME() AS DATE), DATEADD(DAY, g.ThoiHanNgay, CAST(SYSDATETIME() AS DATE)), g.Gia
FROM dbo.TaiKhoan tk CROSS JOIN dbo.GoiTap g
WHERE tk.Email = 'kh01@gym.local' AND g.TenGoiTap = N'Gói 1 tháng';
GO


/* ---------------------------------------------------------------------
   PHẦN 6 – VIEW
   --------------------------------------------------------------------- */

-- 6.1 Sĩ số từng lớp (dùng khi đăng ký, UC06/UC13)
CREATE VIEW dbo.vw_SiSoLop AS
SELECT l.LopHocID, l.MaLop, l.TenLop, l.SucChua,
       COUNT(CASE WHEN d.TrangThai IN (1, 2) THEN 1 END) AS SoDaDangKy,
       l.SucChua - COUNT(CASE WHEN d.TrangThai IN (1, 2) THEN 1 END) AS SoConTrong,
       COUNT(CASE WHEN d.TrangThai = 5 THEN 1 END) AS SoDanhSachCho
FROM dbo.LopHoc l
LEFT JOIN dbo.DangKyKhoaHoc d ON d.LopHocID = l.LopHocID
GROUP BY l.LopHocID, l.MaLop, l.TenLop, l.SucChua;
GO

-- 6.2 Lịch học cá nhân của khách hàng (UC07) - lọc theo KhachHangID khi gọi
CREATE VIEW dbo.vw_LichHocCaNhan AS
SELECT d.KhachHangID, d.DangKyID, l.MaLop, l.TenLop, b.BuoiHocID, b.NgayHoc,
       b.GioBatDau, b.GioKetThuc, p.TenPhong, tk.HoTen AS TenHLV, b.TrangThai AS TrangThaiBuoi
FROM dbo.DangKyKhoaHoc d
JOIN dbo.LopHoc l ON l.LopHocID = d.LopHocID
JOIN dbo.BuoiHoc b ON b.LopHocID = l.LopHocID
JOIN dbo.Phong p ON p.PhongID = b.PhongID
LEFT JOIN dbo.PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
LEFT JOIN dbo.TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
WHERE d.TrangThai = 2;
GO

-- 6.3 Lịch dạy cá nhân của huấn luyện viên (UC17) - lọc theo HuanLuyenVienID khi gọi
CREATE VIEW dbo.vw_LichDayCaNhan AS
SELECT pc.HuanLuyenVienID, pc.PhanCongID, pc.VaiTroGiangDay, l.MaLop, l.TenLop, b.BuoiHocID,
       b.NgayHoc, b.GioBatDau, b.GioKetThuc, p.TenPhong, b.TrangThai AS TrangThaiBuoi,
       (SELECT COUNT(*) FROM dbo.DangKyKhoaHoc d WHERE d.LopHocID = l.LopHocID AND d.TrangThai = 2) AS SoHocVien
FROM dbo.PhanCongHLV pc
JOIN dbo.BuoiHoc b ON b.BuoiHocID = pc.BuoiHocID
JOIN dbo.LopHoc l ON l.LopHocID = b.LopHocID
JOIN dbo.Phong p ON p.PhongID = b.PhongID
WHERE pc.TrangThai = 1;
GO

-- 6.4 Lịch lớp được công bố cho khách hàng (UC09)
CREATE VIEW dbo.vw_LichLopCongBo AS
SELECT l.LopHocID, l.MaLop, l.TenLop, kh.TenKhoaHoc, b.NgayHoc, b.GioBatDau, b.GioKetThuc,
       p.TenPhong, tk.HoTen AS TenHLV, s.SoConTrong
FROM dbo.LopHoc l
JOIN dbo.KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
JOIN dbo.BuoiHoc b ON b.LopHocID = l.LopHocID AND b.TrangThai <> 3
JOIN dbo.Phong p ON p.PhongID = b.PhongID
JOIN dbo.vw_SiSoLop s ON s.LopHocID = l.LopHocID
LEFT JOIN dbo.PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
LEFT JOIN dbo.TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
WHERE l.CongBo = 1 AND l.TrangThaiDangKy IN (1, 2);
GO

-- 6.5 Doanh thu tại quầy theo tháng và loại hóa đơn (UC25) - chỉ tính hóa đơn đã thanh toán
CREATE VIEW dbo.vw_DoanhThuTheoThang AS
SELECT YEAR(NgayThanhToan) AS Nam, MONTH(NgayThanhToan) AS Thang, LoaiHoaDon,
       COUNT(*) AS SoHoaDon, SUM(TongTien) AS DoanhThu
FROM dbo.HoaDon
WHERE TrangThai = 2
GROUP BY YEAR(NgayThanhToan), MONTH(NgayThanhToan), LoaiHoaDon;
GO

-- 6.6 Hiệu quả lớp học: sĩ số, số buổi, lượt điểm danh (UC25)
CREATE VIEW dbo.vw_ThongKeLopHoc AS
SELECT l.LopHocID, l.MaLop, l.TenLop, s.SucChua, s.SoDaDangKy,
       (SELECT COUNT(*) FROM dbo.BuoiHoc b WHERE b.LopHocID = l.LopHocID AND b.TrangThai <> 3) AS SoBuoi,
       (SELECT COUNT(*) FROM dbo.DiemDanh dd JOIN dbo.BuoiHoc b ON b.BuoiHocID = dd.BuoiHocID
        WHERE b.LopHocID = l.LopHocID) AS SoLuotDiemDanh
FROM dbo.LopHoc l
JOIN dbo.vw_SiSoLop s ON s.LopHocID = l.LopHocID;
GO

-- 6.7 Hội viên còn gói tập hiệu lực (UC25)
CREATE VIEW dbo.vw_HoiVienConHan AS
SELECT tk.TaiKhoanID AS KhachHangID, kh.MaKhachHang, tk.HoTen, g.TenGoiTap, d.NgayBatDau, d.NgayHetHan
FROM dbo.DangKyGoiTap d
JOIN dbo.KhachHang kh ON kh.KhachHangID = d.KhachHangID
JOIN dbo.TaiKhoan tk ON tk.TaiKhoanID = kh.KhachHangID
JOIN dbo.GoiTap g ON g.GoiTapID = d.GoiTapID
WHERE d.TrangThai = 1 AND CAST(SYSDATETIME() AS DATE) BETWEEN d.NgayBatDau AND d.NgayHetHan;
GO


/* ---------------------------------------------------------------------
   PHẦN 7 – STORED PROCEDURE
   Mã lỗi nghiệp vụ dùng THROW 500xx; ứng dụng bắt lỗi và hiển thị message cho người dùng.
   --------------------------------------------------------------------- */

-- 7.1 UC06 - Khách hàng đăng ký lớp: kiểm tra trạng thái lớp, trùng lịch, sức chứa
--     Lớp còn chỗ -> TrangThai = 1 (Chờ xác nhận, giữ chỗ). Lớp đầy -> 5 (Danh sách chờ).
CREATE PROCEDURE dbo.sp_DangKyKhoaHoc
    @KhachHangID INT,
    @LopHocID    INT,
    @DangKyID    INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @SucChua INT, @TrangThaiLop TINYINT, @DaGiuCho INT, @TrangThaiMoi TINYINT;

        -- Khóa dòng lớp học để các đăng ký đồng thời được xử lý lần lượt (chống vượt sức chứa)
        SELECT @SucChua = SucChua, @TrangThaiLop = TrangThaiDangKy
        FROM dbo.LopHoc WITH (UPDLOCK, HOLDLOCK)
        WHERE LopHocID = @LopHocID;

        IF @SucChua IS NULL
            THROW 50001, N'Lớp học không tồn tại.', 1;
        IF @TrangThaiLop <> 1
            THROW 50002, N'Lớp chưa mở hoặc đã đóng đăng ký.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.KhachHang k JOIN dbo.TaiKhoan t ON t.TaiKhoanID = k.KhachHangID
                       WHERE k.KhachHangID = @KhachHangID AND t.TrangThai = 1)
            THROW 50003, N'Khách hàng không tồn tại hoặc tài khoản đang bị khóa.', 1;

        IF EXISTS (SELECT 1 FROM dbo.DangKyKhoaHoc
                   WHERE KhachHangID = @KhachHangID AND LopHocID = @LopHocID AND TrangThai IN (1, 2, 5))
            THROW 50004, N'Khách hàng đã đăng ký lớp này.', 1;

        -- Trùng lịch với các lớp khác mà khách đã đăng ký (chờ xác nhận hoặc đã xác nhận)
        IF EXISTS (SELECT 1
                   FROM dbo.BuoiHoc b1
                   JOIN dbo.BuoiHoc b2 ON b2.NgayHoc = b1.NgayHoc
                                      AND b1.GioBatDau < b2.GioKetThuc
                                      AND b2.GioBatDau < b1.GioKetThuc
                                      AND b2.TrangThai <> 3
                   JOIN dbo.DangKyKhoaHoc d ON d.LopHocID = b2.LopHocID
                   WHERE b1.LopHocID = @LopHocID AND b1.TrangThai <> 3
                     AND d.KhachHangID = @KhachHangID AND d.TrangThai IN (1, 2))
            THROW 50005, N'Lịch của lớp này trùng với lớp khác mà bạn đã đăng ký.', 1;

        SELECT @DaGiuCho = COUNT(*) FROM dbo.DangKyKhoaHoc
        WHERE LopHocID = @LopHocID AND TrangThai IN (1, 2);

        SET @TrangThaiMoi = CASE WHEN @DaGiuCho >= @SucChua THEN 5 ELSE 1 END;

        INSERT dbo.DangKyKhoaHoc (KhachHangID, LopHocID, TrangThai)
        VALUES (@KhachHangID, @LopHocID, @TrangThaiMoi);
        SET @DangKyID = SCOPE_IDENTITY();

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 7.2 UC13 - Nhân viên xác nhận / từ chối đăng ký; có kiểm tra sức chứa, trùng lịch; gửi thông báo
CREATE PROCEDURE dbo.sp_XuLyDangKy
    @DangKyID     INT,
    @NguoiXuLyID  INT,
    @XacNhan      BIT,
    @LyDo         NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @KhachHangID INT, @LopHocID INT, @TrangThai TINYINT, @SucChua INT,
                @DaXacNhan INT, @MaLop VARCHAR(20), @TieuDe NVARCHAR(200), @NoiDung NVARCHAR(MAX), @TBID INT;

        SELECT @KhachHangID = KhachHangID, @LopHocID = LopHocID, @TrangThai = TrangThai
        FROM dbo.DangKyKhoaHoc WITH (UPDLOCK, HOLDLOCK)
        WHERE DangKyID = @DangKyID;

        IF @KhachHangID IS NULL
            THROW 50006, N'Không tìm thấy đăng ký.', 1;
        IF @TrangThai NOT IN (1, 5)
            THROW 50007, N'Đăng ký không ở trạng thái chờ xử lý.', 1;

        SELECT @SucChua = SucChua, @MaLop = MaLop
        FROM dbo.LopHoc WITH (UPDLOCK, HOLDLOCK)
        WHERE LopHocID = @LopHocID;

        IF @XacNhan = 1
        BEGIN
            SELECT @DaXacNhan = COUNT(*) FROM dbo.DangKyKhoaHoc WHERE LopHocID = @LopHocID AND TrangThai = 2;
            IF @DaXacNhan >= @SucChua
                THROW 50008, N'Lớp đã đủ học viên đã xác nhận, không thể xác nhận thêm.', 1;

            IF EXISTS (SELECT 1
                       FROM dbo.BuoiHoc b1
                       JOIN dbo.BuoiHoc b2 ON b2.NgayHoc = b1.NgayHoc
                                          AND b1.GioBatDau < b2.GioKetThuc
                                          AND b2.GioBatDau < b1.GioKetThuc
                                          AND b2.TrangThai <> 3
                       JOIN dbo.DangKyKhoaHoc d ON d.LopHocID = b2.LopHocID
                       WHERE b1.LopHocID = @LopHocID AND b1.TrangThai <> 3
                         AND d.KhachHangID = @KhachHangID AND d.TrangThai = 2 AND d.DangKyID <> @DangKyID)
                THROW 50009, N'Lịch lớp trùng với lớp khác đã xác nhận của khách hàng.', 1;

            UPDATE dbo.DangKyKhoaHoc
            SET TrangThai = 2, NguoiXuLyID = @NguoiXuLyID, NgayXuLy = SYSDATETIME(), LyDoTuChoi = NULL
            WHERE DangKyID = @DangKyID;

            SET @TieuDe = N'Đăng ký lớp được xác nhận';
            SET @NoiDung = N'Đăng ký lớp ' + @MaLop + N' của bạn đã được xác nhận.';
        END
        ELSE
        BEGIN
            UPDATE dbo.DangKyKhoaHoc
            SET TrangThai = 3, NguoiXuLyID = @NguoiXuLyID, NgayXuLy = SYSDATETIME(), LyDoTuChoi = @LyDo
            WHERE DangKyID = @DangKyID;

            SET @TieuDe = N'Đăng ký lớp bị từ chối';
            SET @NoiDung = N'Đăng ký lớp ' + @MaLop + N' chưa được chấp nhận. Lý do: ' + ISNULL(@LyDo, N'không nêu');
        END

        -- Thông báo cá nhân cho khách hàng
        INSERT dbo.ThongBao (TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai)
        VALUES (@TieuDe, @NoiDung, 5, @NguoiXuLyID, SYSDATETIME(), 3);
        SET @TBID = SCOPE_IDENTITY();
        INSERT dbo.ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID) VALUES (@TBID, @KhachHangID);

        -- Nhật ký truy vết (NFR07)
        INSERT dbo.NhatKyHeThong (TaiKhoanID, HanhDong, BangTacDong, KhoaBanGhi, GiaTriMoi)
        VALUES (@NguoiXuLyID, CASE WHEN @XacNhan = 1 THEN N'XACNHAN' ELSE N'TUCHOI' END,
                'DangKyKhoaHoc', CAST(@DangKyID AS VARCHAR(50)), @NoiDung);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 7.3 UC16 - Quản trị viên phân công HLV cho một buổi học
--     Kiểm tra: HLV đang hoạt động, đúng chuyên môn, nằm trong giờ làm việc, không trùng lịch dạy
CREATE PROCEDURE dbo.sp_PhanCongHLV
    @BuoiHocID        INT,
    @HuanLuyenVienID  INT,
    @NguoiPhanCongID  INT,
    @VaiTroGiangDay   TINYINT = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @Ngay DATE, @GioBD TIME(0), @GioKT TIME(0), @ChuyenMonYC INT, @Thu TINYINT;

        SELECT @Ngay = b.NgayHoc, @GioBD = b.GioBatDau, @GioKT = b.GioKetThuc, @ChuyenMonYC = kh.ChuyenMonID
        FROM dbo.BuoiHoc b
        JOIN dbo.LopHoc l ON l.LopHocID = b.LopHocID
        JOIN dbo.KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
        WHERE b.BuoiHocID = @BuoiHocID AND b.TrangThai <> 3;

        IF @Ngay IS NULL
            THROW 50010, N'Buổi học không tồn tại hoặc đã bị hủy.', 1;

        -- Khóa dòng HLV để hai phân công đồng thời không cùng lọt qua bước kiểm tra trùng lịch
        IF NOT EXISTS (SELECT 1
                       FROM dbo.HuanLuyenVien h WITH (UPDLOCK, HOLDLOCK)
                       JOIN dbo.TaiKhoan t ON t.TaiKhoanID = h.HuanLuyenVienID
                       WHERE h.HuanLuyenVienID = @HuanLuyenVienID AND h.TrangThaiHoatDong = 1 AND t.TrangThai = 1)
            THROW 50011, N'Huấn luyện viên không tồn tại hoặc không còn hoạt động.', 1;

        IF @ChuyenMonYC IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.HLV_ChuyenMon
                           WHERE HuanLuyenVienID = @HuanLuyenVienID AND ChuyenMonID = @ChuyenMonYC)
            THROW 50012, N'Huấn luyện viên không có chuyên môn phù hợp với khóa học.', 1;

        -- Thứ trong tuần: 1 = Thứ hai ... 7 = Chủ nhật (01/01/1900 là Thứ hai, không phụ thuộc DATEFIRST)
        SET @Thu = (DATEDIFF(DAY, '19000101', @Ngay) % 7) + 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.LichLamViecHLV
                       WHERE HuanLuyenVienID = @HuanLuyenVienID AND ThuTrongTuan = @Thu
                         AND GioBatDau <= @GioBD AND GioKetThuc >= @GioKT)
            THROW 50013, N'Buổi học nằm ngoài khung giờ làm việc của huấn luyện viên.', 1;

        IF EXISTS (SELECT 1
                   FROM dbo.PhanCongHLV pc
                   JOIN dbo.BuoiHoc b2 ON b2.BuoiHocID = pc.BuoiHocID
                   WHERE pc.HuanLuyenVienID = @HuanLuyenVienID AND pc.TrangThai = 1
                     AND pc.BuoiHocID <> @BuoiHocID AND b2.TrangThai <> 3
                     AND b2.NgayHoc = @Ngay AND b2.GioBatDau < @GioKT AND @GioBD < b2.GioKetThuc)
            THROW 50014, N'Huấn luyện viên đã có buổi dạy khác trùng giờ.', 1;

        IF @VaiTroGiangDay = 1
           AND EXISTS (SELECT 1 FROM dbo.PhanCongHLV
                       WHERE BuoiHocID = @BuoiHocID AND VaiTroGiangDay = 1 AND TrangThai = 1
                         AND HuanLuyenVienID <> @HuanLuyenVienID)
            THROW 50015, N'Buổi học đã có huấn luyện viên chính.', 1;

        IF EXISTS (SELECT 1 FROM dbo.PhanCongHLV WHERE BuoiHocID = @BuoiHocID AND HuanLuyenVienID = @HuanLuyenVienID)
            UPDATE dbo.PhanCongHLV
            SET TrangThai = 1, VaiTroGiangDay = @VaiTroGiangDay,
                NguoiPhanCongID = @NguoiPhanCongID, NgayPhanCong = SYSDATETIME()
            WHERE BuoiHocID = @BuoiHocID AND HuanLuyenVienID = @HuanLuyenVienID;
        ELSE
            INSERT dbo.PhanCongHLV (BuoiHocID, HuanLuyenVienID, VaiTroGiangDay, NguoiPhanCongID)
            VALUES (@BuoiHocID, @HuanLuyenVienID, @VaiTroGiangDay, @NguoiPhanCongID);

        INSERT dbo.NhatKyHeThong (TaiKhoanID, HanhDong, BangTacDong, KhoaBanGhi, GiaTriMoi)
        VALUES (@NguoiPhanCongID, N'PHANCONG', 'PhanCongHLV', CAST(@BuoiHocID AS VARCHAR(50)),
                N'HLV ' + CAST(@HuanLuyenVienID AS NVARCHAR(20)) + N' - buổi ' + CAST(@BuoiHocID AS NVARCHAR(20)));

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 7.4 UC11 - Nhân viên ghi nhận check-in (1) hoặc điểm danh buổi học (2)
CREATE PROCEDURE dbo.sp_GhiNhanDiemDanh
    @KhachHangID     INT,
    @LoaiCheckIn     TINYINT,
    @NguoiGhiNhanID  INT,
    @BuoiHocID       INT = NULL,
    @GhiChu          NVARCHAR(200) = NULL,
    @DiemDanhID      INT = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DangKyGoiTapID INT, @DangKyID INT, @HomNay DATE = CAST(SYSDATETIME() AS DATE);

    IF NOT EXISTS (SELECT 1 FROM dbo.KhachHang k JOIN dbo.TaiKhoan t ON t.TaiKhoanID = k.KhachHangID
                   WHERE k.KhachHangID = @KhachHangID AND t.TrangThai = 1)
        THROW 50020, N'Khách hàng không tồn tại hoặc tài khoản đang bị khóa.', 1;

    IF @LoaiCheckIn = 1
    BEGIN
        SELECT TOP (1) @DangKyGoiTapID = DangKyGoiTapID
        FROM dbo.DangKyGoiTap
        WHERE KhachHangID = @KhachHangID AND TrangThai = 1 AND @HomNay BETWEEN NgayBatDau AND NgayHetHan
        ORDER BY NgayHetHan DESC;

        IF @DangKyGoiTapID IS NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.DangKyKhoaHoc d JOIN dbo.LopHoc l ON l.LopHocID = d.LopHocID
                           WHERE d.KhachHangID = @KhachHangID AND d.TrangThai = 2
                             AND @HomNay BETWEEN l.NgayBatDau AND l.NgayKetThuc)
            THROW 50021, N'Gói tập đã hết hạn hoặc khách hàng chưa có đăng ký hợp lệ.', 1;

        IF EXISTS (SELECT 1 FROM dbo.DiemDanh
                   WHERE KhachHangID = @KhachHangID AND LoaiCheckIn = 1 AND CAST(ThoiGian AS DATE) = @HomNay)
            THROW 50022, N'Khách hàng đã check-in hôm nay.', 1;
    END
    ELSE IF @LoaiCheckIn = 2
    BEGIN
        IF @BuoiHocID IS NULL
            THROW 50023, N'Cần chọn buổi học để điểm danh.', 1;

        SELECT @DangKyID = d.DangKyID
        FROM dbo.DangKyKhoaHoc d
        JOIN dbo.BuoiHoc b ON b.LopHocID = d.LopHocID
        WHERE d.KhachHangID = @KhachHangID AND d.TrangThai = 2
          AND b.BuoiHocID = @BuoiHocID AND b.TrangThai <> 3;

        IF @DangKyID IS NULL
            THROW 50024, N'Khách hàng chưa có đăng ký được xác nhận cho buổi học này.', 1;

        IF EXISTS (SELECT 1 FROM dbo.DiemDanh WHERE KhachHangID = @KhachHangID AND BuoiHocID = @BuoiHocID)
            THROW 50025, N'Khách hàng đã được điểm danh buổi học này.', 1;
    END
    ELSE
        THROW 50026, N'Loại check-in không hợp lệ (1 = vào trung tâm, 2 = điểm danh buổi học).', 1;

    INSERT dbo.DiemDanh (KhachHangID, LoaiCheckIn, BuoiHocID, DangKyID, DangKyGoiTapID, NguoiGhiNhanID, GhiChu)
    VALUES (@KhachHangID, @LoaiCheckIn, @BuoiHocID, @DangKyID, @DangKyGoiTapID, @NguoiGhiNhanID, @GhiChu);
    SET @DiemDanhID = SCOPE_IDENTITY();
END;
GO

-- 7.5 UC22 - Xác nhận thanh toán tại quầy; hóa đơn sản phẩm thì trừ tồn kho
CREATE PROCEDURE dbo.sp_ThanhToanHoaDon
    @HoaDonID        INT,
    @PhuongThuc      TINYINT,
    @SoTienNhan      DECIMAL(14,2),
    @NguoiXacNhanID  INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @TongTien DECIMAL(14,2), @TrangThai TINYINT, @Loai TINYINT;

        SELECT @TongTien = TongTien, @TrangThai = TrangThai, @Loai = LoaiHoaDon
        FROM dbo.HoaDon WITH (UPDLOCK, HOLDLOCK)
        WHERE HoaDonID = @HoaDonID;

        IF @TrangThai IS NULL
            THROW 50030, N'Không tìm thấy hóa đơn.', 1;
        IF @TrangThai = 2
            THROW 50031, N'Hóa đơn đã được thanh toán trước đó.', 1;
        IF @TrangThai = 3
            THROW 50032, N'Hóa đơn đã bị hủy.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.ChiTietHoaDon WHERE HoaDonID = @HoaDonID)
            THROW 50033, N'Hóa đơn chưa có dòng chi tiết.', 1;
        IF @PhuongThuc NOT IN (1, 2, 3)
            THROW 50034, N'Phương thức thanh toán không hợp lệ.', 1;
        IF @SoTienNhan <> @TongTien
            THROW 50035, N'Số tiền nhận không khớp với tổng tiền hóa đơn.', 1;

        IF @Loai = 3
        BEGIN
            IF EXISTS (SELECT 1
                       FROM dbo.ChiTietHoaDon c
                       JOIN dbo.SanPham s WITH (UPDLOCK) ON s.SanPhamID = c.SanPhamID
                       WHERE c.HoaDonID = @HoaDonID
                       GROUP BY s.SanPhamID, s.SoLuongTon
                       HAVING SUM(c.SoLuong) > s.SoLuongTon)
                THROW 50036, N'Không đủ số lượng tồn kho cho một hoặc nhiều sản phẩm.', 1;

            UPDATE s
            SET s.SoLuongTon = s.SoLuongTon - x.SL, s.NgayCapNhat = SYSDATETIME()
            FROM dbo.SanPham s
            JOIN (SELECT SanPhamID, SUM(SoLuong) AS SL
                  FROM dbo.ChiTietHoaDon WHERE HoaDonID = @HoaDonID GROUP BY SanPhamID) x
              ON x.SanPhamID = s.SanPhamID;
        END

        UPDATE dbo.HoaDon
        SET TrangThai = 2, PhuongThucThanhToan = @PhuongThuc,
            NgayThanhToan = SYSDATETIME(), NguoiXacNhanID = @NguoiXacNhanID
        WHERE HoaDonID = @HoaDonID;

        INSERT dbo.NhatKyHeThong (TaiKhoanID, HanhDong, BangTacDong, KhoaBanGhi, GiaTriMoi)
        VALUES (@NguoiXacNhanID, N'THANHTOAN', 'HoaDon', CAST(@HoaDonID AS VARCHAR(50)),
                N'Đã nhận ' + CONVERT(NVARCHAR(30), @SoTienNhan));

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO


/* ---------------------------------------------------------------------
   PHẦN 8 – CHẠY THỬ (NGHIỆM THU CSDL)
   Bôi đen từng khối rồi Execute để xem kết quả.
   --------------------------------------------------------------------- */

-- 8.0 Đếm số bảng (kỳ vọng: 28)
SELECT COUNT(*) AS SoBang FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');
GO

-- 8.1 Lớp Boxing chỉ có 2 chỗ: kh01, kh02 vào chờ xác nhận; kh03 phải vào danh sách chờ (TrangThai = 5)
DECLARE @lop INT = (SELECT LopHocID FROM dbo.LopHoc WHERE MaLop = 'BX-2611-A');
DECLARE @kh1 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh01@gym.local');
DECLARE @kh2 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh02@gym.local');
DECLARE @kh3 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh03@gym.local');
DECLARE @id INT;
EXEC dbo.sp_DangKyKhoaHoc @KhachHangID = @kh1, @LopHocID = @lop, @DangKyID = @id OUTPUT;
EXEC dbo.sp_DangKyKhoaHoc @KhachHangID = @kh2, @LopHocID = @lop, @DangKyID = @id OUTPUT;
EXEC dbo.sp_DangKyKhoaHoc @KhachHangID = @kh3, @LopHocID = @lop, @DangKyID = @id OUTPUT;
SELECT d.DangKyID, tk.HoTen, d.TrangThai FROM dbo.DangKyKhoaHoc d JOIN dbo.TaiKhoan tk ON tk.TaiKhoanID = d.KhachHangID;
SELECT * FROM dbo.vw_SiSoLop;
GO

-- 8.2 Nhân viên xác nhận đăng ký của kh01, rồi xem lịch học cá nhân của kh01
DECLARE @nv INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'nhanvien01@gym.local');
DECLARE @kh1 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh01@gym.local');
DECLARE @dk INT = (SELECT DangKyID FROM dbo.DangKyKhoaHoc WHERE KhachHangID = @kh1);
EXEC dbo.sp_XuLyDangKy @DangKyID = @dk, @NguoiXuLyID = @nv, @XacNhan = 1;
SELECT * FROM dbo.vw_LichHocCaNhan WHERE KhachHangID = @kh1 ORDER BY NgayHoc;
SELECT * FROM dbo.ThongBaoNguoiNhan;
GO

-- 8.3 Check-in vào trung tâm và điểm danh buổi học đầu tiên của lớp Boxing
DECLARE @nv INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'nhanvien01@gym.local');
DECLARE @kh1 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh01@gym.local');
DECLARE @buoi INT = (SELECT TOP (1) b.BuoiHocID FROM dbo.BuoiHoc b JOIN dbo.LopHoc l ON l.LopHocID = b.LopHocID
                     WHERE l.MaLop = 'BX-2611-A' ORDER BY b.NgayHoc);
DECLARE @dd INT;
EXEC dbo.sp_GhiNhanDiemDanh @KhachHangID = @kh1, @LoaiCheckIn = 1, @NguoiGhiNhanID = @nv, @DiemDanhID = @dd OUTPUT;
EXEC dbo.sp_GhiNhanDiemDanh @KhachHangID = @kh1, @LoaiCheckIn = 2, @NguoiGhiNhanID = @nv, @BuoiHocID = @buoi, @DiemDanhID = @dd OUTPUT;
SELECT * FROM dbo.DiemDanh;
-- Chạy lại EXEC thứ hai lần nữa sẽ báo lỗi 50025 (điểm danh trùng) -> đúng nghiệp vụ.
GO

-- 8.4 Bán sản phẩm tại quầy rồi thanh toán (tồn kho tự trừ)
DECLARE @nv INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'nhanvien01@gym.local');
DECLARE @kh1 INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'kh01@gym.local');
DECLARE @hd INT;
INSERT dbo.HoaDon (KhachHangID, NguoiLapID, LoaiHoaDon) VALUES (@kh1, @nv, 3);
SET @hd = SCOPE_IDENTITY();
INSERT dbo.ChiTietHoaDon (HoaDonID, SanPhamID, MoTa, SoLuong, DonGia)
SELECT @hd, SanPhamID, TenSanPham, 2, Gia FROM dbo.SanPham WHERE MaSanPham = 'NUOC-01';
INSERT dbo.ChiTietHoaDon (HoaDonID, SanPhamID, MoTa, SoLuong, DonGia)
SELECT @hd, SanPhamID, TenSanPham, 1, Gia FROM dbo.SanPham WHERE MaSanPham = 'THAM-01';
SELECT HoaDonID, MaHoaDon, TongTien, TrangThai FROM dbo.HoaDon WHERE HoaDonID = @hd;   -- TongTien = 310000
DECLARE @tong DECIMAL(14,2) = (SELECT TongTien FROM dbo.HoaDon WHERE HoaDonID = @hd);
EXEC dbo.sp_ThanhToanHoaDon @HoaDonID = @hd, @PhuongThuc = 1, @SoTienNhan = @tong, @NguoiXacNhanID = @nv;
SELECT MaSanPham, SoLuongTon FROM dbo.SanPham WHERE MaSanPham IN ('NUOC-01', 'THAM-01');  -- 198 và 14
SELECT * FROM dbo.vw_DoanhThuTheoThang;
GO

-- 8.5 Thử các lỗi nghiệp vụ (mỗi lệnh dưới đây PHẢI báo lỗi - chạy riêng từng lệnh)
-- a) Phân công HLV Yoga cho buổi Boxing -> lỗi 50012 (sai chuyên môn)
-- DECLARE @b INT = (SELECT TOP (1) b.BuoiHocID FROM dbo.BuoiHoc b JOIN dbo.LopHoc l ON l.LopHocID = b.LopHocID WHERE l.MaLop = 'BX-2611-A');
-- DECLARE @h INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'hlv01@gym.local');
-- DECLARE @a INT = (SELECT TaiKhoanID FROM dbo.TaiKhoan WHERE Email = 'admin@gym.local');
-- EXEC dbo.sp_PhanCongHLV @BuoiHocID = @b, @HuanLuyenVienID = @h, @NguoiPhanCongID = @a;
-- b) Thêm số lượng tồn âm -> vi phạm CHECK
-- UPDATE dbo.SanPham SET SoLuongTon = -1 WHERE MaSanPham = 'NUOC-01';
-- c) Xếp 2 buổi trùng phòng, trùng giờ -> lỗi 50041
-- INSERT dbo.BuoiHoc (LopHocID, PhongID, NgayHoc, GioBatDau, GioKetThuc)
-- SELECT LopHocID, PhongID, '20261109', '06:30', '07:30' FROM dbo.LopHoc WHERE MaLop = 'YG-2611-A';
GO


/* ---------------------------------------------------------------------
   PHẦN 9 (TÙY CHỌN) – TÀI KHOẢN KẾT NỐI CHO ỨNG DỤNG WEB
   Ứng dụng web KHÔNG nên dùng tài khoản sa. Tạo login riêng, chỉ cấp quyền cần thiết.
   Đổi mật khẩu bên dưới trước khi chạy.
   --------------------------------------------------------------------- */
USE master;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'gym_app')
    CREATE LOGIN gym_app WITH PASSWORD = N'Doi_Mat_Khau_Manh_123!', CHECK_POLICY = ON;
GO
USE QuanLyTrungTamTheHinh;
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'gym_app')
    CREATE USER gym_app FOR LOGIN gym_app;
ALTER ROLE db_datareader ADD MEMBER gym_app;
ALTER ROLE db_datawriter ADD MEMBER gym_app;
GRANT EXECUTE TO gym_app;
GO
-- Chuỗi kết nối mẫu (ASP.NET Core):
-- Server=localhost;Database=QuanLyTrungTamTheHinh;User Id=gym_app;Password=...;TrustServerCertificate=True;
-- Chuỗi kết nối mẫu (Windows Authentication):
-- Server=localhost;Database=QuanLyTrungTamTheHinh;Trusted_Connection=True;TrustServerCertificate=True;