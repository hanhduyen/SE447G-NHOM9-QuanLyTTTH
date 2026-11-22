-- =====================================================================
-- ĐỒ ÁN CDIO SE447 G – NHÓM 09
-- Đề tài : Xây dựng Website quản lý trung tâm thể hình
-- CSDL   : QuanLyTrungTamTheHinh (Phiên bản chuyển đổi tương thích MySQL 8.0+)
-- =====================================================================

DROP DATABASE IF EXISTS QuanLyTrungTamTheHinh;
CREATE DATABASE QuanLyTrungTamTheHinh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE QuanLyTrungTamTheHinh;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- PHẦN 1: TẠO 28 BẢNG
-- =====================================================================

-- ==== NHÓM A – NGƯỜI DÙNG VÀ HỆ THỐNG ====

-- 1. Bảng VaiTro
CREATE TABLE VaiTro (
    VaiTroID TINYINT NOT NULL,
    MaVaiTro VARCHAR(20) NOT NULL,
    TenVaiTro VARCHAR(50) NOT NULL,
    MoTa VARCHAR(200) NULL,
    CONSTRAINT PK_VaiTro PRIMARY KEY (VaiTroID),
    CONSTRAINT UQ_VaiTro_MaVaiTro UNIQUE (MaVaiTro),
    CONSTRAINT UQ_VaiTro_TenVaiTro UNIQUE (TenVaiTro)
) ENGINE=InnoDB;

-- 2. Bảng TaiKhoan
CREATE TABLE TaiKhoan (
    TaiKhoanID INT AUTO_INCREMENT NOT NULL,
    Email VARCHAR(100) NOT NULL,
    SoDienThoai VARCHAR(15) NULL,
    MatKhauHash VARCHAR(255) NOT NULL,
    HoTen VARCHAR(100) NOT NULL,
    NgaySinh DATE NULL,
    GioiTinh VARCHAR(10) NULL,
    DiaChi VARCHAR(255) NULL,
    AnhDaiDien VARCHAR(255) NULL,
    VaiTroID TINYINT NOT NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    SoLanDangNhapSai TINYINT NOT NULL DEFAULT 0,
    LanDangNhapCuoi DATETIME NULL,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NgayCapNhat DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_TaiKhoan PRIMARY KEY (TaiKhoanID),
    CONSTRAINT UQ_TaiKhoan_Email UNIQUE (Email),
    CONSTRAINT FK_TaiKhoan_VaiTroID FOREIGN KEY (VaiTroID) REFERENCES VaiTro(VaiTroID),
    CONSTRAINT CK_TaiKhoan_GioiTinh CHECK (GioiTinh IS NULL OR GioiTinh IN ('Nam', 'Nữ', 'Khác')),
    CONSTRAINT CK_TaiKhoan_TrangThai CHECK (TrangThai IN (0,1,2))
) ENGINE=InnoDB;

-- 3. Bảng KhachHang
CREATE TABLE KhachHang (
    KhachHangID INT NOT NULL,
    MaKhachHang VARCHAR(10) GENERATED ALWAYS AS (CONCAT('KH', LPAD(KhachHangID, 6, '0'))) VIRTUAL,
    NgayDangKy DATE NOT NULL DEFAULT (CURRENT_DATE),
    ChieuCao DECIMAL(5,2) NULL,
    CanNang DECIMAL(5,2) NULL,
    MucTieu VARCHAR(200) NULL,
    LienHeKhanCap VARCHAR(100) NULL,
    GhiChu VARCHAR(500) NULL,
    CONSTRAINT PK_KhachHang PRIMARY KEY (KhachHangID),
    CONSTRAINT FK_KhachHang_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES TaiKhoan(TaiKhoanID) ON DELETE CASCADE,
    CONSTRAINT CK_KhachHang_ChieuCao CHECK (ChieuCao IS NULL OR ChieuCao > 0),
    CONSTRAINT CK_KhachHang_CanNang CHECK (CanNang IS NULL OR CanNang > 0)
) ENGINE=InnoDB;

-- 4. Bảng NhanVien
CREATE TABLE NhanVien (
    NhanVienID INT NOT NULL,
    MaNhanVien VARCHAR(10) GENERATED ALWAYS AS (CONCAT('NV', LPAD(NhanVienID, 6, '0'))) VIRTUAL,
    ChucVu VARCHAR(50) NULL,
    NgayVaoLam DATE NULL,
    TrangThaiLamViec TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT PK_NhanVien PRIMARY KEY (NhanVienID),
    CONSTRAINT FK_NhanVien_NhanVienID FOREIGN KEY (NhanVienID) REFERENCES TaiKhoan(TaiKhoanID) ON DELETE CASCADE,
    CONSTRAINT CK_NhanVien_TrangThaiLamViec CHECK (TrangThaiLamViec IN (0,1))
) ENGINE=InnoDB;

-- 5. Bảng HuanLuyenVien
CREATE TABLE HuanLuyenVien (
    HuanLuyenVienID INT NOT NULL,
    MaHLV VARCHAR(10) GENERATED ALWAYS AS (CONCAT('HLV', LPAD(HuanLuyenVienID, 6, '0'))) VIRTUAL,
    KinhNghiemNam TINYINT NOT NULL DEFAULT 0,
    TieuSu TEXT NULL,
    TrangThaiHoatDong TINYINT(1) NOT NULL DEFAULT 1,
    NgayVaoLam DATE NULL,
    CONSTRAINT PK_HuanLuyenVien PRIMARY KEY (HuanLuyenVienID),
    CONSTRAINT FK_HuanLuyenVien_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES TaiKhoan(TaiKhoanID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Bảng ChuyenMon
CREATE TABLE ChuyenMon (
    ChuyenMonID INT AUTO_INCREMENT NOT NULL,
    TenChuyenMon VARCHAR(100) NOT NULL,
    MoTa VARCHAR(300) NULL,
    CONSTRAINT PK_ChuyenMon PRIMARY KEY (ChuyenMonID),
    CONSTRAINT UQ_ChuyenMon_TenChuyenMon UNIQUE (TenChuyenMon)
) ENGINE=InnoDB;

-- 7. Bảng HLV_ChuyenMon
CREATE TABLE HLV_ChuyenMon (
    HuanLuyenVienID INT NOT NULL,
    ChuyenMonID INT NOT NULL,
    CONSTRAINT PK_HLV_ChuyenMon PRIMARY KEY (HuanLuyenVienID, ChuyenMonID),
    CONSTRAINT FK_HLV_ChuyenMon_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES HuanLuyenVien(HuanLuyenVienID) ON DELETE CASCADE,
    CONSTRAINT FK_HLV_ChuyenMon_ChuyenMonID FOREIGN KEY (ChuyenMonID) REFERENCES ChuyenMon(ChuyenMonID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Bảng LichLamViecHLV
CREATE TABLE LichLamViecHLV (
    LichLamViecID INT AUTO_INCREMENT NOT NULL,
    HuanLuyenVienID INT NOT NULL,
    ThuTrongTuan TINYINT NOT NULL,
    GioBatDau TIME NOT NULL,
    GioKetThuc TIME NOT NULL,
    CONSTRAINT PK_LichLamViecHLV PRIMARY KEY (LichLamViecID),
    CONSTRAINT FK_LichLamViecHLV_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES HuanLuyenVien(HuanLuyenVienID) ON DELETE CASCADE,
    CONSTRAINT CK_LichLamViecHLV_ThuTrongTuan CHECK (ThuTrongTuan BETWEEN 1 AND 7),
    CONSTRAINT CK_LichLamViecHLV_Gio CHECK (GioBatDau < GioKetThuc)
) ENGINE=InnoDB;

-- 9. Bảng ThongTinTrungTam
CREATE TABLE ThongTinTrungTam (
    ThongTinID INT AUTO_INCREMENT NOT NULL,
    LoaiMuc TINYINT NOT NULL,
    TieuDe VARCHAR(200) NOT NULL,
    NoiDung LONGTEXT NOT NULL,
    ThuTu SMALLINT NOT NULL DEFAULT 0,
    CongBo TINYINT(1) NOT NULL DEFAULT 0,
    NgayCapNhat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_ThongTinTrungTam PRIMARY KEY (ThongTinID),
    CONSTRAINT CK_ThongTinTrungTam_LoaiMuc CHECK (LoaiMuc BETWEEN 1 AND 4)
) ENGINE=InnoDB;

-- 10. Bảng NhatKyHeThong
CREATE TABLE NhatKyHeThong (
    NhatKyID BIGINT AUTO_INCREMENT NOT NULL,
    TaiKhoanID INT NULL,
    HanhDong VARCHAR(50) NOT NULL,
    BangTacDong VARCHAR(100) NOT NULL,
    KhoaBanGhi VARCHAR(50) NULL,
    GiaTriCu LONGTEXT NULL,
    GiaTriMoi LONGTEXT NULL,
    DiaChiIP VARCHAR(45) NULL,
    ThoiGian DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_NhatKyHeThong PRIMARY KEY (NhatKyID),
    CONSTRAINT FK_NhatKyHeThong_TaiKhoanID FOREIGN KEY (TaiKhoanID) REFERENCES TaiKhoan(TaiKhoanID) ON DELETE SET NULL
) ENGINE=InnoDB;


-- ==== NHÓM B – ĐÀO TẠO ====

-- 11. Bảng GoiTap
CREATE TABLE GoiTap (
    GoiTapID INT AUTO_INCREMENT NOT NULL,
    TenGoiTap VARCHAR(100) NOT NULL,
    MoTa VARCHAR(1000) NULL,
    ThoiHanNgay SMALLINT NOT NULL,
    Gia DECIMAL(12,2) NOT NULL,
    DieuKienThamGia VARCHAR(500) NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    CongBo TINYINT(1) NOT NULL DEFAULT 0,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NgayCapNhat DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_GoiTap PRIMARY KEY (GoiTapID),
    CONSTRAINT UQ_GoiTap_TenGoiTap UNIQUE (TenGoiTap),
    CONSTRAINT CK_GoiTap_ThoiHanNgay CHECK (ThoiHanNgay > 0),
    CONSTRAINT CK_GoiTap_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_GoiTap_TrangThai CHECK (TrangThai IN (0,1))
) ENGINE=InnoDB;

-- 12. Bảng KhoaHoc
CREATE TABLE KhoaHoc (
    KhoaHocID INT AUTO_INCREMENT NOT NULL,
    TenKhoaHoc VARCHAR(150) NOT NULL,
    MoTa VARCHAR(1000) NULL,
    ChuyenMonID INT NULL,
    ThoiLuongTuan TINYINT NOT NULL,
    SoBuoi SMALLINT NOT NULL,
    Gia DECIMAL(12,2) NOT NULL,
    DieuKienThamGia VARCHAR(500) NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    CongBo TINYINT(1) NOT NULL DEFAULT 0,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NgayCapNhat DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_KhoaHoc PRIMARY KEY (KhoaHocID),
    CONSTRAINT UQ_KhoaHoc_TenKhoaHoc UNIQUE (TenKhoaHoc),
    CONSTRAINT FK_KhoaHoc_ChuyenMonID FOREIGN KEY (ChuyenMonID) REFERENCES ChuyenMon(ChuyenMonID) ON DELETE SET NULL,
    CONSTRAINT CK_KhoaHoc_ThoiLuongTuan CHECK (ThoiLuongTuan > 0),
    CONSTRAINT CK_KhoaHoc_SoBuoi CHECK (SoBuoi > 0),
    CONSTRAINT CK_KhoaHoc_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_KhoaHoc_TrangThai CHECK (TrangThai IN (0,1))
) ENGINE=InnoDB;

-- 13. Bảng Phong
CREATE TABLE Phong (
    PhongID INT AUTO_INCREMENT NOT NULL,
    TenPhong VARCHAR(50) NOT NULL,
    SucChua SMALLINT NOT NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    MoTa VARCHAR(200) NULL,
    CONSTRAINT PK_Phong PRIMARY KEY (PhongID),
    CONSTRAINT UQ_Phong_TenPhong UNIQUE (TenPhong),
    CONSTRAINT CK_Phong_SucChua CHECK (SucChua > 0),
    CONSTRAINT CK_Phong_TrangThai CHECK (TrangThai IN (0,1))
) ENGINE=InnoDB;

-- 14. Bảng LopHoc
CREATE TABLE LopHoc (
    LopHocID INT AUTO_INCREMENT NOT NULL,
    MaLop VARCHAR(20) NOT NULL,
    TenLop VARCHAR(150) NOT NULL,
    KhoaHocID INT NOT NULL,
    PhongID INT NOT NULL,
    NgayBatDau DATE NOT NULL,
    NgayKetThuc DATE NOT NULL,
    SucChua SMALLINT NOT NULL,
    TrangThaiDangKy TINYINT NOT NULL DEFAULT 0,
    CongBo TINYINT(1) NOT NULL DEFAULT 0,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_LopHoc PRIMARY KEY (LopHocID),
    CONSTRAINT UQ_LopHoc_MaLop UNIQUE (MaLop),
    CONSTRAINT FK_LopHoc_KhoaHocID FOREIGN KEY (KhoaHocID) REFERENCES KhoaHoc(KhoaHocID),
    CONSTRAINT FK_LopHoc_PhongID FOREIGN KEY (PhongID) REFERENCES Phong(PhongID),
    CONSTRAINT CK_LopHoc_SucChua CHECK (SucChua > 0),
    CONSTRAINT CK_LopHoc_TrangThaiDangKy CHECK (TrangThaiDangKy IN (0,1,2,3)),
    CONSTRAINT CK_LopHoc_Ngay CHECK (NgayKetThuc >= NgayBatDau)
) ENGINE=InnoDB;

-- 15. Bảng BuoiHoc
CREATE TABLE BuoiHoc (
    BuoiHocID INT AUTO_INCREMENT NOT NULL,
    LopHocID INT NOT NULL,
    PhongID INT NOT NULL,
    NgayHoc DATE NOT NULL,
    GioBatDau TIME NOT NULL,
    GioKetThuc TIME NOT NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    GhiChu VARCHAR(200) NULL,
    CONSTRAINT PK_BuoiHoc PRIMARY KEY (BuoiHocID),
    CONSTRAINT FK_BuoiHoc_LopHocID FOREIGN KEY (LopHocID) REFERENCES LopHoc(LopHocID) ON DELETE CASCADE,
    CONSTRAINT FK_BuoiHoc_PhongID FOREIGN KEY (PhongID) REFERENCES Phong(PhongID),
    CONSTRAINT CK_BuoiHoc_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_BuoiHoc_Gio CHECK (GioBatDau < GioKetThuc),
    CONSTRAINT UQ_BuoiHoc_Lop_Ngay_Gio UNIQUE (LopHocID, NgayHoc, GioBatDau)
) ENGINE=InnoDB;

-- 16. Bảng PhanCongHLV
CREATE TABLE PhanCongHLV (
    PhanCongID INT AUTO_INCREMENT NOT NULL,
    BuoiHocID INT NOT NULL,
    HuanLuyenVienID INT NOT NULL,
    VaiTroGiangDay TINYINT NOT NULL DEFAULT 1,
    NguoiPhanCongID INT NOT NULL,
    NgayPhanCong DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT PK_PhanCongHLV PRIMARY KEY (PhanCongID),
    CONSTRAINT FK_PhanCongHLV_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES BuoiHoc(BuoiHocID) ON DELETE CASCADE,
    CONSTRAINT FK_PhanCongHLV_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES HuanLuyenVien(HuanLuyenVienID),
    CONSTRAINT FK_PhanCongHLV_NguoiPhanCongID FOREIGN KEY (NguoiPhanCongID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_PhanCongHLV_VaiTroGiangDay CHECK (VaiTroGiangDay IN (1,2)),
    CONSTRAINT CK_PhanCongHLV_TrangThai CHECK (TrangThai IN (0,1)),
    CONSTRAINT UQ_PhanCong_Buoi_HLV UNIQUE (BuoiHocID, HuanLuyenVienID)
) ENGINE=InnoDB;

-- 17. Bảng DangKyKhoaHoc
CREATE TABLE DangKyKhoaHoc (
    DangKyID INT AUTO_INCREMENT NOT NULL,
    KhachHangID INT NOT NULL,
    LopHocID INT NOT NULL,
    NgayDangKy DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NguoiXuLyID INT NULL,
    NgayXuLy DATETIME NULL,
    LyDoTuChoi VARCHAR(300) NULL,
    GhiChu VARCHAR(300) NULL,
    CONSTRAINT PK_DangKyKhoaHoc PRIMARY KEY (DangKyID),
    CONSTRAINT FK_DangKyKhoaHoc_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES KhachHang(KhachHangID),
    CONSTRAINT FK_DangKyKhoaHoc_LopHocID FOREIGN KEY (LopHocID) REFERENCES LopHoc(LopHocID),
    CONSTRAINT FK_DangKyKhoaHoc_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_DangKyKhoaHoc_TrangThai CHECK (TrangThai IN (1,2,3,4,5,6))
) ENGINE=InnoDB;

-- 18. Bảng DangKyGoiTap
CREATE TABLE DangKyGoiTap (
    DangKyGoiTapID INT AUTO_INCREMENT NOT NULL,
    KhachHangID INT NOT NULL,
    GoiTapID INT NOT NULL,
    NgayBatDau DATE NOT NULL,
    NgayHetHan DATE NOT NULL,
    GiaApDung DECIMAL(12,2) NOT NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_DangKyGoiTap PRIMARY KEY (DangKyGoiTapID),
    CONSTRAINT FK_DangKyGoiTap_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES KhachHang(KhachHangID),
    CONSTRAINT FK_DangKyGoiTap_GoiTapID FOREIGN KEY (GoiTapID) REFERENCES GoiTap(GoiTapID),
    CONSTRAINT CK_DangKyGoiTap_GiaApDung CHECK (GiaApDung >= 0),
    CONSTRAINT CK_DangKyGoiTap_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_DangKyGoiTap_Ngay CHECK (NgayHetHan >= NgayBatDau)
) ENGINE=InnoDB;

-- 19. Bảng YeuCauDoiHuyLich
CREATE TABLE YeuCauDoiHuyLich (
    YeuCauID INT AUTO_INCREMENT NOT NULL,
    DangKyID INT NOT NULL,
    BuoiHocID INT NULL,
    LoaiYeuCau TINYINT NOT NULL,
    LopHocMoiID INT NULL,
    LyDo VARCHAR(300) NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayGui DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NguoiXuLyID INT NULL,
    NgayXuLy DATETIME NULL,
    GhiChuXuLy VARCHAR(300) NULL,
    CONSTRAINT PK_YeuCauDoiHuyLich PRIMARY KEY (YeuCauID),
    CONSTRAINT FK_YeuCauDoiHuyLich_DangKyID FOREIGN KEY (DangKyID) REFERENCES DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_YeuCauDoiHuyLich_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES BuoiHoc(BuoiHocID),
    CONSTRAINT FK_YeuCauDoiHuyLich_LopHocMoiID FOREIGN KEY (LopHocMoiID) REFERENCES LopHoc(LopHocID),
    CONSTRAINT FK_YeuCauDoiHuyLich_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_YeuCauDoiHuyLich_LoaiYeuCau CHECK (LoaiYeuCau IN (1,2)),
    CONSTRAINT CK_YeuCauDoiHuyLich_TrangThai CHECK (TrangThai IN (1,2,3)),
    CONSTRAINT CK_YeuCau_DoiLich CHECK (LoaiYeuCau = 1 OR LopHocMoiID IS NOT NULL)
) ENGINE=InnoDB;

-- 20. Bảng DiemDanh
CREATE TABLE DiemDanh (
    DiemDanhID INT AUTO_INCREMENT NOT NULL,
    KhachHangID INT NOT NULL,
    LoaiCheckIn TINYINT NOT NULL,
    BuoiHocID INT NULL,
    DangKyID INT NULL,
    DangKyGoiTapID INT NULL,
    ThoiGian DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NguoiGhiNhanID INT NOT NULL,
    GhiChu VARCHAR(200) NULL,
    CONSTRAINT PK_DiemDanh PRIMARY KEY (DiemDanhID),
    CONSTRAINT FK_DiemDanh_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES KhachHang(KhachHangID),
    CONSTRAINT FK_DiemDanh_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES BuoiHoc(BuoiHocID),
    CONSTRAINT FK_DiemDanh_DangKyID FOREIGN KEY (DangKyID) REFERENCES DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_DiemDanh_DangKyGoiTapID FOREIGN KEY (DangKyGoiTapID) REFERENCES DangKyGoiTap(DangKyGoiTapID),
    CONSTRAINT FK_DiemDanh_NguoiGhiNhanID FOREIGN KEY (NguoiGhiNhanID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_DiemDanh_LoaiCheckIn CHECK (LoaiCheckIn IN (1,2)),
    CONSTRAINT CK_DiemDanh_Buoi CHECK (LoaiCheckIn = 1 OR BuoiHocID IS NOT NULL)
) ENGINE=InnoDB;

-- 21. Bảng KetQuaHocVien
CREATE TABLE KetQuaHocVien (
    KetQuaID INT AUTO_INCREMENT NOT NULL,
    DangKyID INT NOT NULL,
    BuoiHocID INT NULL,
    HuanLuyenVienID INT NOT NULL,
    NhanXet VARCHAR(1000) NULL,
    MucDoHoanThanh TINYINT NULL,
    CanNang DECIMAL(5,2) NULL,
    TyLeMo DECIMAL(4,1) NULL,
    ChiSoKhac VARCHAR(300) NULL,
    NgayCapNhat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_KetQuaHocVien PRIMARY KEY (KetQuaID),
    CONSTRAINT FK_KetQuaHocVien_DangKyID FOREIGN KEY (DangKyID) REFERENCES DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_KetQuaHocVien_BuoiHocID FOREIGN KEY (BuoiHocID) REFERENCES BuoiHoc(BuoiHocID),
    CONSTRAINT FK_KetQuaHocVien_HuanLuyenVienID FOREIGN KEY (HuanLuyenVienID) REFERENCES HuanLuyenVien(HuanLuyenVienID),
    CONSTRAINT CK_KetQuaHocVien_MucDoHoanThanh CHECK (MucDoHoanThanh IS NULL OR MucDoHoanThanh BETWEEN 0 AND 100)
) ENGINE=InnoDB;


-- ==== NHÓM C – CỬA HÀNG, HÓA ĐƠN, THÔNG BÁO, HỖ TRỢ ====

-- 22. Bảng DanhMucSanPham
CREATE TABLE DanhMucSanPham (
    DanhMucID INT AUTO_INCREMENT NOT NULL,
    TenDanhMuc VARCHAR(100) NOT NULL,
    MoTa VARCHAR(200) NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    CONSTRAINT PK_DanhMucSanPham PRIMARY KEY (DanhMucID),
    CONSTRAINT UQ_DanhMucSanPham_TenDanhMuc UNIQUE (TenDanhMuc),
    CONSTRAINT CK_DanhMucSanPham_TrangThai CHECK (TrangThai IN (0,1))
) ENGINE=InnoDB;

-- 23. Bảng SanPham
CREATE TABLE SanPham (
    SanPhamID INT AUTO_INCREMENT NOT NULL,
    MaSanPham VARCHAR(20) NOT NULL,
    TenSanPham VARCHAR(150) NOT NULL,
    MoTa VARCHAR(500) NULL,
    DanhMucID INT NOT NULL,
    Gia DECIMAL(12,2) NOT NULL,
    SoLuongTon INT NOT NULL DEFAULT 0,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NgayCapNhat DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_SanPham PRIMARY KEY (SanPhamID),
    CONSTRAINT UQ_SanPham_MaSanPham UNIQUE (MaSanPham),
    CONSTRAINT FK_SanPham_DanhMucID FOREIGN KEY (DanhMucID) REFERENCES DanhMucSanPham(DanhMucID),
    CONSTRAINT CK_SanPham_Gia CHECK (Gia >= 0),
    CONSTRAINT CK_SanPham_SoLuongTon CHECK (SoLuongTon >= 0),
    CONSTRAINT CK_SanPham_TrangThai CHECK (TrangThai IN (0,1))
) ENGINE=InnoDB;

-- 24. Bảng HoaDon
CREATE TABLE HoaDon (
    HoaDonID INT AUTO_INCREMENT NOT NULL,
    MaHoaDon VARCHAR(20) NULL,
    KhachHangID INT NULL,
    NguoiLapID INT NOT NULL,
    LoaiHoaDon TINYINT NOT NULL,
    NgayLap DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    TongTien DECIMAL(14,2) NOT NULL DEFAULT 0,
    PhuongThucThanhToan TINYINT NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayThanhToan DATETIME NULL,
    NguoiXacNhanID INT NULL,
    GhiChu VARCHAR(300) NULL,
    CONSTRAINT PK_HoaDon PRIMARY KEY (HoaDonID),
    CONSTRAINT FK_HoaDon_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES KhachHang(KhachHangID),
    CONSTRAINT FK_HoaDon_NguoiLapID FOREIGN KEY (NguoiLapID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT FK_HoaDon_NguoiXacNhanID FOREIGN KEY (NguoiXacNhanID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_HoaDon_LoaiHoaDon CHECK (LoaiHoaDon IN (1,2,3)),
    CONSTRAINT CK_HoaDon_TongTien CHECK (TongTien >= 0),
    CONSTRAINT CK_HoaDon_PhuongThucThanhToan CHECK (PhuongThucThanhToan IS NULL OR PhuongThucThanhToan IN (1,2,3)),
    CONSTRAINT CK_HoaDon_TrangThai CHECK (TrangThai IN (1,2,3))
) ENGINE=InnoDB;

-- 25. Bảng ChiTietHoaDon
CREATE TABLE ChiTietHoaDon (
    ChiTietID INT AUTO_INCREMENT NOT NULL,
    HoaDonID INT NOT NULL,
    SanPhamID INT NULL,
    DangKyID INT NULL,
    DangKyGoiTapID INT NULL,
    MoTa VARCHAR(200) NULL,
    SoLuong INT NOT NULL DEFAULT 1,
    DonGia DECIMAL(12,2) NOT NULL,
    ThanhTien DECIMAL(12,2) GENERATED ALWAYS AS (SoLuong * DonGia) STORED,
    CONSTRAINT PK_ChiTietHoaDon PRIMARY KEY (ChiTietID),
    CONSTRAINT FK_ChiTietHoaDon_HoaDonID FOREIGN KEY (HoaDonID) REFERENCES HoaDon(HoaDonID) ON DELETE CASCADE,
    CONSTRAINT FK_ChiTietHoaDon_SanPhamID FOREIGN KEY (SanPhamID) REFERENCES SanPham(SanPhamID),
    CONSTRAINT FK_ChiTietHoaDon_DangKyID FOREIGN KEY (DangKyID) REFERENCES DangKyKhoaHoc(DangKyID),
    CONSTRAINT FK_ChiTietHoaDon_DangKyGoiTapID FOREIGN KEY (DangKyGoiTapID) REFERENCES DangKyGoiTap(DangKyGoiTapID),
    CONSTRAINT CK_ChiTietHoaDon_SoLuong CHECK (SoLuong > 0),
    CONSTRAINT CK_ChiTietHoaDon_DonGia CHECK (DonGia >= 0),
    CONSTRAINT CK_ChiTietHoaDon_MotDoiTuong CHECK ((CASE WHEN SanPhamID IS NULL THEN 0 ELSE 1 END + CASE WHEN DangKyID IS NULL THEN 0 ELSE 1 END + CASE WHEN DangKyGoiTapID IS NULL THEN 0 ELSE 1 END) = 1)
) ENGINE=InnoDB;

-- 26. Bảng ThongBao
CREATE TABLE ThongBao (
    ThongBaoID INT AUTO_INCREMENT NOT NULL,
    TieuDe VARCHAR(200) NOT NULL,
    NoiDung LONGTEXT NOT NULL,
    NhomNguoiNhan TINYINT NOT NULL,
    NguoiTaoID INT NOT NULL,
    ThoiGianGui DATETIME NULL,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayTao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NgayCapNhat DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT PK_ThongBao PRIMARY KEY (ThongBaoID),
    CONSTRAINT FK_ThongBao_NguoiTaoID FOREIGN KEY (NguoiTaoID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT CK_ThongBao_NhomNguoiNhan CHECK (NhomNguoiNhan IN (1,2,3,4,5)),
    CONSTRAINT CK_ThongBao_TrangThai CHECK (TrangThai IN (1,2,3,4,5))
) ENGINE=InnoDB;

-- 27. Bảng ThongBaoNguoiNhan
CREATE TABLE ThongBaoNguoiNhan (
    ThongBaoID INT NOT NULL,
    TaiKhoanID INT NOT NULL,
    DaDoc TINYINT(1) NOT NULL DEFAULT 0,
    NgayDoc DATETIME NULL,
    CONSTRAINT PK_ThongBaoNguoiNhan PRIMARY KEY (ThongBaoID, TaiKhoanID),
    CONSTRAINT FK_ThongBaoNguoiNhan_ThongBaoID FOREIGN KEY (ThongBaoID) REFERENCES ThongBao(ThongBaoID) ON DELETE CASCADE,
    CONSTRAINT FK_ThongBaoNguoiNhan_TaiKhoanID FOREIGN KEY (TaiKhoanID) REFERENCES TaiKhoan(TaiKhoanID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 28. Bảng PhanHoiHoTro
CREATE TABLE PhanHoiHoTro (
    PhanHoiID INT AUTO_INCREMENT NOT NULL,
    KhachHangID INT NOT NULL,
    TieuDe VARCHAR(200) NOT NULL,
    NoiDung VARCHAR(2000) NOT NULL,
    PhanLoai TINYINT NOT NULL DEFAULT 1,
    TrangThai TINYINT NOT NULL DEFAULT 1,
    NgayGui DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    NguoiXuLyID INT NULL,
    NgayXuLy DATETIME NULL,
    KetQuaXuLy VARCHAR(1000) NULL,
    PhanHoiTrungID INT NULL,
    CONSTRAINT PK_PhanHoiHoTro PRIMARY KEY (PhanHoiID),
    CONSTRAINT FK_PhanHoiHoTro_KhachHangID FOREIGN KEY (KhachHangID) REFERENCES KhachHang(KhachHangID),
    CONSTRAINT FK_PhanHoiHoTro_NguoiXuLyID FOREIGN KEY (NguoiXuLyID) REFERENCES TaiKhoan(TaiKhoanID),
    CONSTRAINT FK_PhanHoiHoTro_PhanHoiTrungID FOREIGN KEY (PhanHoiTrungID) REFERENCES PhanHoiHoTro(PhanHoiID),
    CONSTRAINT CK_PhanHoiHoTro_PhanLoai CHECK (PhanLoai IN (1,2,3,4)),
    CONSTRAINT CK_PhanHoiHoTro_TrangThai CHECK (TrangThai IN (1,2,3,4))
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;


-- =====================================================================
-- PHẦN 2: CHỈ MỤC (INDEXES)
-- =====================================================================

CREATE INDEX IX_TaiKhoan_VaiTroID ON TaiKhoan (VaiTroID);
CREATE INDEX IX_LichLamViecHLV_HLV ON LichLamViecHLV (HuanLuyenVienID, ThuTrongTuan);
CREATE INDEX IX_NhatKy_ThoiGian ON NhatKyHeThong (ThoiGian);
CREATE INDEX IX_NhatKy_Bang ON NhatKyHeThong (BangTacDong, KhoaBanGhi);
CREATE INDEX IX_LopHoc_KhoaHocID ON LopHoc (KhoaHocID);
CREATE INDEX IX_LopHoc_TrangThai ON LopHoc (TrangThaiDangKy, CongBo);
CREATE INDEX IX_BuoiHoc_Phong_Ngay ON BuoiHoc (PhongID, NgayHoc, GioBatDau);
CREATE INDEX IX_BuoiHoc_Ngay ON BuoiHoc (NgayHoc);
CREATE INDEX IX_PhanCong_HLV ON PhanCongHLV (HuanLuyenVienID, TrangThai);
CREATE INDEX IX_DangKy_Lop_TrangThai ON DangKyKhoaHoc (LopHocID, TrangThai);
CREATE INDEX IX_DangKyGoiTap_KH ON DangKyGoiTap (KhachHangID, TrangThai, NgayHetHan);
CREATE INDEX IX_YeuCau_TrangThai ON YeuCauDoiHuyLich (TrangThai, NgayGui);
CREATE INDEX IX_DiemDanh_KH_ThoiGian ON DiemDanh (KhachHangID, ThoiGian);
CREATE INDEX IX_KetQua_DangKy ON KetQuaHocVien (DangKyID, NgayCapNhat);
CREATE INDEX IX_SanPham_DanhMuc ON SanPham (DanhMucID, TrangThai);
CREATE INDEX IX_HoaDon_KhachHang ON HoaDon (KhachHangID);
CREATE INDEX IX_HoaDon_Ngay_TrangThai ON HoaDon (TrangThai, NgayLap);
CREATE INDEX IX_ChiTietHoaDon_HoaDon ON ChiTietHoaDon (HoaDonID);
CREATE INDEX IX_ThongBao_TrangThai ON ThongBao (TrangThai, ThoiGianGui);
CREATE INDEX IX_TBNN_TaiKhoan ON ThongBaoNguoiNhan (TaiKhoanID, DaDoc);
CREATE INDEX IX_PhanHoi_TrangThai ON PhanHoiHoTro (TrangThai, NgayGui);
CREATE INDEX IX_PhanHoi_KhachHang ON PhanHoiHoTro (KhachHangID);


-- =====================================================================
-- PHẦN 3: VIEWS
-- =====================================================================

-- 1. Sĩ số lớp
CREATE OR REPLACE VIEW vw_SiSoLop AS
SELECT l.LopHocID, l.MaLop, l.TenLop, l.SucChua,
       COUNT(CASE WHEN d.TrangThai IN (1, 2) THEN 1 END) AS SoDaDangKy,
       l.SucChua - COUNT(CASE WHEN d.TrangThai IN (1, 2) THEN 1 END) AS SoConTrong,
       COUNT(CASE WHEN d.TrangThai = 5 THEN 1 END) AS SoDanhSachCho
FROM LopHoc l
LEFT JOIN DangKyKhoaHoc d ON d.LopHocID = l.LopHocID
GROUP BY l.LopHocID, l.MaLop, l.TenLop, l.SucChua;

-- 2. Lịch học cá nhân của khách hàng
CREATE OR REPLACE VIEW vw_LichHocCaNhan AS
SELECT d.KhachHangID, d.DangKyID, l.MaLop, l.TenLop, b.BuoiHocID, b.NgayHoc,
       b.GioBatDau, b.GioKetThuc, p.TenPhong, tk.HoTen AS TenHLV, b.TrangThai AS TrangThaiBuoi
FROM DangKyKhoaHoc d
JOIN LopHoc l ON l.LopHocID = d.LopHocID
JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
JOIN Phong p ON p.PhongID = b.PhongID
LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
WHERE d.TrangThai = 2;

-- 3. Lịch dạy cá nhân của HLV
CREATE OR REPLACE VIEW vw_LichDayCaNhan AS
SELECT pc.HuanLuyenVienID, pc.PhanCongID, pc.VaiTroGiangDay, l.MaLop, l.TenLop, b.BuoiHocID,
       b.NgayHoc, b.GioBatDau, b.GioKetThuc, p.TenPhong, b.TrangThai AS TrangThaiBuoi,
       (SELECT COUNT(*) FROM DangKyKhoaHoc d WHERE d.LopHocID = l.LopHocID AND d.TrangThai = 2) AS SoHocVien
FROM PhanCongHLV pc
JOIN BuoiHoc b ON b.BuoiHocID = pc.BuoiHocID
JOIN LopHoc l ON l.LopHocID = b.LopHocID
JOIN Phong p ON p.PhongID = b.PhongID
WHERE pc.TrangThai = 1;

-- 4. Lịch lớp được công bố cho khách hàng
CREATE OR REPLACE VIEW vw_LichLopCongBo AS
SELECT l.LopHocID, l.MaLop, l.TenLop, kh.TenKhoaHoc, b.NgayHoc, b.GioBatDau, b.GioKetThuc,
       p.TenPhong, tk.HoTen AS TenHLV, s.SoConTrong
FROM LopHoc l
JOIN KhoaHoc kh ON kh.KhoaHocID = l.KhoaHocID
JOIN BuoiHoc b ON b.LopHocID = l.LopHocID AND b.TrangThai <> 3
JOIN Phong p ON p.PhongID = b.PhongID
JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID
LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1 AND pc.VaiTroGiangDay = 1
LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
WHERE l.CongBo = 1 AND l.TrangThaiDangKy IN (1, 2);

-- 5. Doanh thu tại quầy theo tháng
CREATE OR REPLACE VIEW vw_DoanhThuTheoThang AS
SELECT YEAR(NgayThanhToan) AS Nam, MONTH(NgayThanhToan) AS Thang, LoaiHoaDon,
       COUNT(*) AS SoHoaDon, SUM(TongTien) AS DoanhThu
FROM HoaDon
WHERE TrangThai = 2
GROUP BY YEAR(NgayThanhToan), MONTH(NgayThanhToan), LoaiHoaDon;

-- 6. Thống kê hiệu quả lớp học
CREATE OR REPLACE VIEW vw_ThongKeLopHoc AS
SELECT l.LopHocID, l.MaLop, l.TenLop, s.SucChua, s.SoDaDangKy,
       (SELECT COUNT(*) FROM BuoiHoc b WHERE b.LopHocID = l.LopHocID AND b.TrangThai <> 3) AS SoBuoi,
       (SELECT COUNT(*) FROM DiemDanh dd JOIN BuoiHoc b ON b.BuoiHocID = dd.BuoiHocID
        WHERE b.LopHocID = l.LopHocID) AS SoLuotDiemDanh
FROM LopHoc l
JOIN vw_SiSoLop s ON s.LopHocID = l.LopHocID;

-- 7. Hội viên còn hạn gói tập
CREATE OR REPLACE VIEW vw_HoiVienConHan AS
SELECT tk.TaiKhoanID AS KhachHangID, kh.MaKhachHang, tk.HoTen, g.TenGoiTap, d.NgayBatDau, d.NgayHetHan
FROM DangKyGoiTap d
JOIN KhachHang kh ON kh.KhachHangID = d.KhachHangID
JOIN TaiKhoan tk ON tk.TaiKhoanID = kh.KhachHangID
JOIN GoiTap g ON g.GoiTapID = d.GoiTapID
WHERE d.TrangThai = 1 AND CURRENT_DATE BETWEEN d.NgayBatDau AND d.NgayHetHan;


-- =====================================================================
-- PHẦN 4: DỮ LIỆU MẪU BAN ĐẦU
-- =====================================================================

-- 1. VaiTro
INSERT INTO VaiTro (VaiTroID, MaVaiTro, TenVaiTro, MoTa) VALUES
 (1, 'ADMIN',     'Quản trị viên',   'Quản lý toàn bộ dữ liệu nền, nhân sự, báo cáo'),
 (2, 'NHANVIEN',  'Nhân viên',       'Nghiệp vụ tại quầy: check-in, xử lý đăng ký, bán hàng, thanh toán'),
 (3, 'HLV',       'Huấn luyện viên', 'Xem lịch dạy, cập nhật kết quả học viên'),
 (4, 'KHACHHANG', 'Khách hàng',      'Xem gói tập/khóa học, đăng ký lớp, xem lịch học');

-- 2. TaiKhoan (Mật khẩu hash cho 123456: $2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2)
INSERT INTO TaiKhoan (TaiKhoanID, Email, SoDienThoai, MatKhauHash, HoTen, GioiTinh, VaiTroID, TrangThai) VALUES
 (1, 'admin@gym.local',      '0900000001', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Nguyễn Quản Trị',  'Nam', 1, 1),
 (2, 'nhanvien01@gym.local', '0900000002', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Trần Thu Ngân',    'Nữ',  2, 1),
 (3, 'hlv01@gym.local',      '0900000003', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Lê Minh Yoga',     'Nữ',  3, 1),
 (4, 'hlv02@gym.local',      '0900000004', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Phạm Quốc Boxing', 'Nam', 3, 1),
 (5, 'kh01@gym.local',       '0900000005', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Võ Văn An',        'Nam', 4, 1),
 (6, 'kh02@gym.local',       '0900000006', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Nguyễn Thị Bình',  'Nữ',  4, 1),
 (7, 'kh03@gym.local',       '0900000007', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Đặng Văn Cường',   'Nam', 4, 1),
 -- Thêm các tài khoản tương thích với giao diện cũ demo
 (8, 'admin@fitcenter.vn',   '0901234567', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Quản Trị Viên FitCenter', 'Nam', 1, 1),
 (9, 'an.nguyen@email.com',  '0912345678', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Nguyễn Văn An', 'Nam', 4, 1),
 (10,'hoale@fitcenter.vn',   '0923456789', '$2b$10$hLIoHNHLOSGJbO0KjsfLKuiw6akq/.Z.7BRLc05gAHBuWrfG9Ssx2', 'Lê Thị Hoa',   'Nữ',  3, 1);

-- 3. NhanVien
INSERT INTO NhanVien (NhanVienID, ChucVu, NgayVaoLam) VALUES
 (2, 'Nhân viên quầy', '2026-01-01');

-- 4. HuanLuyenVien
INSERT INTO HuanLuyenVien (HuanLuyenVienID, KinhNghiemNam, TieuSu, NgayVaoLam) VALUES
 (3, 5, 'Chứng chỉ Yoga Alliance RYT-200 quốc tế, hơn 5 năm giảng dạy Yoga cơ bản và nâng cao.', '2026-01-01'),
 (4, 3, 'Võ sĩ Boxing nghiệp dư, chứng chỉ PT quốc tế, chuyên đào tạo thể lực và đối kháng.', '2026-01-01'),
 (10,4, 'Chuyên gia Pilates, Zumba và Kickfit, giàu nhiệt huyết.', '2026-01-01');

-- 5. KhachHang
INSERT INTO KhachHang (KhachHangID, ChieuCao, CanNang, MucTieu, LienHeKhanCap, GhiChu) VALUES
 (5, 175.0, 68.5, 'Cải thiện sức khỏe, tăng cơ bắp', '0909999001', 'Hội viên VIP'),
 (6, 160.0, 52.0, 'Giảm mỡ, giữ dáng thon gọn', '0909999002', 'Tập Yoga'),
 (7, 170.0, 75.0, 'Tăng thể lực, rèn luyện phản xạ', '0909999003', 'Tập Boxing'),
 (9, 172.0, 65.0, 'Nâng cao thể lực và sự dẻo dai', '0909999004', 'Khách hàng thân thiết');

-- 6. ChuyenMon
INSERT INTO ChuyenMon (ChuyenMonID, TenChuyenMon, MoTa) VALUES
 (1, 'Yoga',             'Yoga cơ bản, nâng cao, thiền định'),
 (2, 'Boxing',           'Boxing thể lực và đối kháng nhẹ'),
 (3, 'Gym - Thể hình',   'Tập tạ, tăng cơ, siết cân'),
 (4, 'Cardio - Giảm mỡ', 'Giảm mỡ, cải thiện hệ tim mạch'),
 (5, 'Zumba',            'Nhảy aerobic sôi động theo nhạc');

-- 7. HLV_ChuyenMon
INSERT INTO HLV_ChuyenMon (HuanLuyenVienID, ChuyenMonID) VALUES
 (3, 1),
 (4, 2),
 (4, 4),
 (10, 1),
 (10, 5);

-- 8. LichLamViecHLV
INSERT INTO LichLamViecHLV (HuanLuyenVienID, ThuTrongTuan, GioBatDau, GioKetThuc) VALUES
 (3, 1, '06:00:00', '21:00:00'),
 (3, 2, '06:00:00', '21:00:00'),
 (3, 3, '06:00:00', '21:00:00'),
 (3, 4, '06:00:00', '21:00:00'),
 (3, 5, '06:00:00', '21:00:00'),
 (3, 6, '06:00:00', '21:00:00'),
 (4, 1, '06:00:00', '21:00:00'),
 (4, 2, '06:00:00', '21:00:00'),
 (4, 3, '06:00:00', '21:00:00'),
 (4, 4, '06:00:00', '21:00:00'),
 (4, 5, '06:00:00', '21:00:00'),
 (4, 6, '06:00:00', '21:00:00');

-- 9. Phong
INSERT INTO Phong (PhongID, TenPhong, SucChua, MoTa) VALUES
 (1, 'Phòng Yoga',   20, 'Phòng yoga chuyên dụng sàn gỗ, gương soi toàn cảnh'),
 (2, 'Phòng Gym',    40, 'Khu máy tập tạ đa năng và máy chạy bộ hiện đại'),
 (3, 'Phòng Boxing', 15, 'Phòng boxing sàn đài, bao cát cao cấp');

-- 10. GoiTap
INSERT INTO GoiTap (GoiTapID, TenGoiTap, MoTa, ThoiHanNgay, Gia, DieuKienThamGia, CongBo) VALUES
 (1, 'Gói 1 tháng',  'Tập tự do không giới hạn trong 1 tháng (30 ngày)',  30,  400000.00,  'Từ 16 tuổi trở lên', 1),
 (2, 'Gói 3 tháng',  'Tập tự do không giới hạn trong 3 tháng (90 ngày) tặng bình nước',  90,  1000000.00, 'Từ 16 tuổi trở lên', 1),
 (3, 'Gói 12 tháng', 'Tập tự do không giới hạn trong 12 tháng (365 ngày) tặng áo + balo', 365, 3600000.00, 'Từ 16 tuổi trở lên', 1);

-- 11. KhoaHoc
INSERT INTO KhoaHoc (KhoaHocID, TenKhoaHoc, MoTa, ChuyenMonID, ThoiLuongTuan, SoBuoi, Gia, DieuKienThamGia, CongBo) VALUES
 (1, 'Yoga cơ bản',     'Làm quen các tư thế yoga căn bản, hít thở, giãn cơ và thư giãn',   1, 8, 16, 1200000.00, 'Không yêu cầu kinh nghiệm', 1),
 (2, 'Boxing nhập môn', 'Kỹ thuật đấm cơ bản, di chuyển, tăng thể lực và phản xạ',          2, 8, 16, 1600000.00, 'Sức khỏe tốt', 1),
 (3, 'Giảm mỡ 8 tuần',  'Kết hợp cardio cường độ cao và kháng lực, theo dõi chỉ số InBody', 4, 8, 24, 2000000.00, 'Có xác nhận sức khỏe', 1);

-- 12. LopHoc
INSERT INTO LopHoc (LopHocID, MaLop, TenLop, KhoaHocID, PhongID, NgayBatDau, NgayKetThuc, SucChua, TrangThaiDangKy, CongBo) VALUES
 (1, 'YG-2611-A', 'Yoga cơ bản - Sáng T2/T4',   1, 1, '2026-11-09', '2026-12-31', 20, 1, 1),
 (2, 'BX-2611-A', 'Boxing nhập môn - Tối T3/T5', 2, 3, '2026-11-09', '2026-12-31', 15, 1, 1),
 (3, 'GM-2611-A', 'Giảm mỡ 8 tuần - Chiều T2/T6',3, 2, '2026-11-09', '2026-12-31', 25, 1, 1);

-- 13. BuoiHoc (Lịch buổi học phong phú)
INSERT INTO BuoiHoc (BuoiHocID, LopHocID, PhongID, NgayHoc, GioBatDau, GioKetThuc, TrangThai, GhiChu) VALUES
 (1, 1, 1, '2026-11-23', '06:00:00', '07:00:00', 1, 'Buổi 1: Khởi động và hơi thở Pranayama'),
 (2, 1, 1, '2026-11-25', '06:00:00', '07:00:00', 1, 'Buổi 2: Chuỗi chào mặt trời'),
 (3, 1, 1, '2026-11-30', '06:00:00', '07:00:00', 1, 'Buổi 3: Thăng bằng và trụ chân'),
 (4, 1, 1, '2026-12-02', '06:00:00', '07:00:00', 1, 'Buổi 4: Mở khớp háng và kéo giãn'),
 (5, 2, 3, '2026-11-24', '18:00:00', '19:30:00', 1, 'Buổi 1: Đòn thẳng Jab & Cross'),
 (6, 2, 3, '2026-11-26', '18:00:00', '19:30:00', 1, 'Buổi 2: Đòn móc Hook & Uppercut'),
 (7, 2, 3, '2026-12-01', '18:00:00', '19:30:00', 1, 'Buổi 3: Di chuyển bước chân và thủ'),
 (8, 2, 3, '2026-12-03', '18:00:00', '19:30:00', 1, 'Buổi 4: Phối hợp tổ hợp đòn đấm'),
 (9, 3, 2, '2026-11-23', '16:00:00', '17:30:00', 1, 'Buổi 1: Test chỉ số và Cardio HIIT'),
 (10,3, 2, '2026-11-27', '16:00:00', '17:30:00', 1, 'Buổi 2: Kháng lực toàn thân');

-- 14. PhanCongHLV
INSERT INTO PhanCongHLV (PhanCongID, BuoiHocID, HuanLuyenVienID, VaiTroGiangDay, NguoiPhanCongID) VALUES
 (1, 1, 3, 1, 1),
 (2, 2, 3, 1, 1),
 (3, 3, 3, 1, 1),
 (4, 4, 3, 1, 1),
 (5, 5, 4, 1, 1),
 (6, 6, 4, 1, 1),
 (7, 7, 4, 1, 1),
 (8, 8, 4, 1, 1),
 (9, 9, 4, 1, 1),
 (10,10, 4, 1, 1);

-- 15. DangKyKhoaHoc
INSERT INTO DangKyKhoaHoc (DangKyID, KhachHangID, LopHocID, NgayDangKy, TrangThai, NguoiXuLyID, NgayXuLy) VALUES
 (1, 5, 1, CURRENT_TIMESTAMP, 2, 1, CURRENT_TIMESTAMP),
 (2, 6, 1, CURRENT_TIMESTAMP, 2, 1, CURRENT_TIMESTAMP),
 (3, 7, 2, CURRENT_TIMESTAMP, 2, 1, CURRENT_TIMESTAMP),
 (4, 9, 1, CURRENT_TIMESTAMP, 2, 1, CURRENT_TIMESTAMP),
 (5, 5, 2, CURRENT_TIMESTAMP, 1, NULL, NULL);

-- 16. DangKyGoiTap
INSERT INTO DangKyGoiTap (DangKyGoiTapID, KhachHangID, GoiTapID, NgayBatDau, NgayHetHan, GiaApDung, TrangThai) VALUES
 (1, 5, 2, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 90 DAY), 1000000.00, 1),
 (2, 6, 1, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY), 400000.00,  1),
 (3, 9, 3, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 365 DAY),3600000.00, 1);

-- 17. DanhMucSanPham
INSERT INTO DanhMucSanPham (DanhMucID, TenDanhMuc, MoTa) VALUES
 (1, 'Thực phẩm bổ sung',  'Whey Protein, BCAA, Creatine, Vitamin khoáng chất'),
 (2, 'Phụ kiện tập luyện', 'Găng tay, đai lưng, thảm tập, bình nước thể thao'),
 (3, 'Đồ uống',            'Nước khoáng điện giải, nước dừa bù khoáng');

-- 18. SanPham
INSERT INTO SanPham (SanPhamID, MaSanPham, TenSanPham, MoTa, DanhMucID, Gia, SoLuongTon) VALUES
 (1, 'WHEY-01', 'Whey Protein 2lb',     'Bổ sung đạm cao cấp hấp thu nhanh sau tập', 1, 1200000.00, 20),
 (2, 'GANG-01', 'Găng tay tập gym',     'Bảo vệ bàn tay, chống chai tay, size M/L',  2, 150000.00, 50),
 (3, 'BINH-01', 'Bình nước 1 lít',      'Chất liệu Tritan an toàn, chống tràn',       2, 90000.00, 40),
 (4, 'THAM-01', 'Thảm Yoga TPE',        'Thảm dày 6mm đàn hồi cao, chống trượt',      2, 280000.00, 15),
 (5, 'NUOC-01', 'Nước điện giải 500ml', 'Bù khoáng tức thì trong lúc tập',           3, 15000.00, 200);

-- 19. ThongTinTrungTam
INSERT INTO ThongTinTrungTam (LoaiMuc, TieuDe, NoiDung, ThuTu, CongBo) VALUES
 (1, 'Giới thiệu trung tâm',  'FitCenter là trung tâm thể hình cao cấp với đội ngũ HLV chuyên môn cao, trang thiết bị nhập khẩu chuẩn quốc tế mang lại trải nghiệm tập luyện tốt nhất.', 1, 1),
 (2, 'Cơ sở vật chất',        'Không gian rộng hơn 1000m2 bao gồm phòng Gym, phòng Yoga cách âm, phòng Boxing tiêu chuẩn, tủ khóa từ thông minh và phòng tắm nước nóng miễn phí.', 2, 1),
 (3, 'Dịch vụ',               'Cung cấp các gói tập gym tự do, các khóa đào tạo lớp nhóm chuyên sâu (Yoga, Boxing, Cardio) và kèm riêng 1-1 cùng huấn luyện viên cá nhân.', 3, 1),
 (4, 'Liên hệ',               'Địa chỉ: 123 Nguyễn Văn Linh, Đà Nẵng - Hotline: 0900 000 001 - Mở cửa: 05:30 đến 21:30 hàng ngày.', 4, 1);

-- 20. ThongBao
INSERT INTO ThongBao (ThongBaoID, TieuDe, NoiDung, NhomNguoiNhan, NguoiTaoID, ThoiGianGui, TrangThai) VALUES
 (1, 'Chào mừng đến với FitCenter', 'Chào mừng bạn đã trở thành hội viên của FitCenter! Hãy kiểm tra lịch tập và tận hưởng các tiện ích của chúng tôi.', 1, 1, CURRENT_TIMESTAMP, 3),
 (2, 'Lịch tập lớp Yoga sáng mai',  'Nhắc nhở: Lớp Yoga cơ bản sẽ bắt đầu lúc 06:00 sáng mai tại Phòng Yoga tầng 2. Chúc bạn có buổi tập năng động!', 5, 1, CURRENT_TIMESTAMP, 3);

-- 21. ThongBaoNguoiNhan
INSERT INTO ThongBaoNguoiNhan (ThongBaoID, TaiKhoanID, DaDoc) VALUES
 (1, 5, 0),
 (1, 6, 0),
 (1, 7, 0),
 (1, 9, 0),
 (2, 5, 0),
 (2, 6, 0),
 (2, 9, 0);
