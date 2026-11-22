

require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const db = require('./db');

const OUT_OF_SCOPE_MESSAGE = 'Dạ em đã ghi nhận câu hỏi của anh/chị. Anh/chị có thể hỏi em những câu hỏi liên quan đến hệ thống fitcenter thôi ạ. Những câu hỏi này vược ngoài phạm vi của em ạ.';

/**
 * 1. Thu thập toàn bộ dữ liệu thực tế từ MySQL nạp làm ngữ cảnh cho Gemini
 */
async function getFitCenterDataContext(database, memberId) {
  const conn = database || db;
  try {
    // 1.1. Thông tin chung trung tâm
    const [centerInfo] = await conn.query(
      'SELECT LoaiMuc, TieuDe, NoiDung FROM ThongTinTrungTam WHERE CongBo = 1 ORDER BY ThuTu ASC'
    );

    // 1.2. Danh sách gói tập
    const [plans] = await conn.query(
      'SELECT GoiTapID, TenGoiTap, Gia, ThoiHanNgay, MoTa FROM GoiTap WHERE TrangThai = 1'
    );

    // 1.3. Danh sách khóa học
    const [courses] = await conn.query(`
      SELECT kh.KhoaHocID, kh.TenKhoaHoc, kh.MoTa, kh.ThoiLuongTuan, kh.SoBuoi, kh.Gia, kh.DieuKienThamGia, cm.TenChuyenMon
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      WHERE kh.TrangThai = 1
    `);

    // 1.4. Danh sách lớp học và số chỗ trống
    const [classes] = await conn.query(`
      SELECT l.LopHocID, l.MaLop, l.TenLop, kh.KhoaHocID, kh.TenKhoaHoc,
             p.TenPhong, l.SucChua, l.NgayBatDau, l.NgayKetThuc,
             (l.SucChua - COALESCE(COUNT(dk.DangKyID), 0)) AS ConTrong
      FROM LopHoc l
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      LEFT JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN DangKyKhoaHoc dk ON l.LopHocID = dk.LopHocID AND dk.TrangThai IN (1, 2)
      WHERE l.CongBo = 1
      GROUP BY l.LopHocID, l.MaLop, l.TenLop, kh.KhoaHocID, kh.TenKhoaHoc, p.TenPhong, l.SucChua, l.NgayBatDau, l.NgayKetThuc
    `);

    // 1.5. Lịch học chi tiết từng thứ, giờ bắt đầu và giờ kết thúc
    const [schedules] = await conn.query(`
      SELECT b.LopHocID,
             DAYOFWEEK(b.NgayHoc) AS DayOfWeekNum,
             TIME_FORMAT(b.GioBatDau, '%H:%i') AS GioBatDau,
             TIME_FORMAT(b.GioKetThuc, '%H:%i') AS GioKetThuc,
             p.TenPhong,
             COALESCE(tk.HoTen, 'FitCenter HLV') AS TenHLV
      FROM BuoiHoc b
      LEFT JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN PhanCongHLV pc ON b.BuoiHocID = pc.BuoiHocID AND pc.TrangThai = 1
      LEFT JOIN HuanLuyenVien hlv ON pc.HuanLuyenVienID = hlv.HuanLuyenVienID
      LEFT JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
      GROUP BY b.LopHocID, DayOfWeekNum, GioBatDau, GioKetThuc, p.TenPhong, tk.HoTen
      ORDER BY b.LopHocID, DayOfWeekNum, GioBatDau
    `);

    const dayOfWeekMap = {
      1: 'Chủ nhật',
      2: 'Thứ 2',
      3: 'Thứ 3',
      4: 'Thứ 4',
      5: 'Thứ 5',
      6: 'Thứ 6',
      7: 'Thứ 7'
    };

    const classMap = {};
    classes.forEach(c => {
      classMap[c.LopHocID] = { ...c, patterns: [] };
    });

    schedules.forEach(s => {
      if (classMap[s.LopHocID]) {
        const startH = parseInt((s.GioBatDau || '00:00').split(':')[0], 10);
        let ca = 'Sáng';
        if (startH >= 12 && startH < 17) ca = 'Chiều';
        else if (startH >= 17) ca = 'Tối';

        classMap[s.LopHocID].patterns.push({
          thu: dayOfWeekMap[s.DayOfWeekNum] || `Thứ ${s.DayOfWeekNum}`,
          dayOfWeekNum: s.DayOfWeekNum,
          gioBatDau: s.GioBatDau,
          gioKetThuc: s.GioKetThuc,
          phong: s.TenPhong || 'Phòng tập',
          hlv: s.TenHLV || 'FitCenter HLV',
          ca
        });
      }
    });

    Object.values(classMap).forEach(c => {
      if (c.patterns.length > 0) {
        const timeGroups = {};
        c.patterns.forEach(p => {
          const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.ca}-${p.phong}-${p.hlv}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], ...p };
          timeGroups[k].days.push(p.thu);
        });
        c.scheduleSummary = Object.values(timeGroups)
          .map(t => `${t.days.join(' & ')} (Bắt đầu ${t.gioBatDau} – Kết thúc ${t.gioKetThuc}, Buổi ${t.ca}) | ${t.phong} | HLV: ${t.hlv}`)
          .join('; ');
        c.shifts = Array.from(new Set(c.patterns.map(p => p.ca)));
        c.days = Array.from(new Set(c.patterns.map(p => p.thu)));
      } else {
        c.scheduleSummary = 'Đang cập nhật lịch chi tiết';
        c.shifts = [];
        c.days = [];
      }
    });

    const enrichedClasses = Object.values(classMap);
    const enrichedCourses = courses.map(course => ({
      ...course,
      classes: enrichedClasses.filter(cls => cls.KhoaHocID === course.KhoaHocID)
    }));

    // 1.6. Huấn luyện viên
    const [trainers] = await conn.query(`
      SELECT tk.HoTen, cm.TenChuyenMon, hlv.KinhNghiemNam, hlv.TieuSu
      FROM HuanLuyenVien hlv
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
      LEFT JOIN HLV_ChuyenMon hcm ON hlv.HuanLuyenVienID = hcm.HuanLuyenVienID
      LEFT JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
      WHERE hlv.TrangThaiHoatDong = 1
    `);

    // 1.7. Hội viên hiện tại (nếu có memberId)
    let memberContext = null;
    if (memberId) {
      const [members] = await conn.query(`
        SELECT t.TaiKhoanID, t.HoTen, t.Email, t.SoDienThoai,
               k.KhachHangID, k.MaKhachHang, k.ChieuCao, k.CanNang, k.MucTieu AS MucTieuLuyenTap
        FROM TaiKhoan t
        JOIN KhachHang k ON t.TaiKhoanID = k.KhachHangID
        WHERE t.TaiKhoanID = ? OR k.KhachHangID = ?
      `, [memberId, memberId]);

      if (members.length > 0) {
        const m = members[0];
        // Gói tập hiện tại
        const [memberships] = await conn.query(`
          SELECT g.TenGoiTap, d.NgayHetHan, DATEDIFF(d.NgayHetHan, CURRENT_DATE) AS days_left
          FROM DangKyGoiTap d
          JOIN GoiTap g ON d.GoiTapID = g.GoiTapID
          WHERE d.KhachHangID = ? AND d.TrangThai = 1
          ORDER BY d.NgayHetHan DESC LIMIT 1
        `, [m.KhachHangID]);

        // Đánh giá InBody gần nhất
        const [progress] = await conn.query(`
          SELECT kq.CanNang, kq.TyLeMo, kq.MucDoHoanThanh, kq.NhanXet, kq.NgayCapNhat
          FROM KetQuaHocVien kq
          JOIN DangKyKhoaHoc dk ON kq.DangKyID = dk.DangKyID
          WHERE dk.KhachHangID = ?
          ORDER BY kq.NgayCapNhat DESC LIMIT 1
        `, [m.KhachHangID]);

        // Lịch học cá nhân sắp tới
        const [myUpcomingSessions] = await conn.query(`
          SELECT dk.DangKyID, l.LopHocID, l.MaLop, l.TenLop, kh.TenKhoaHoc,
                 b.BuoiHocID,
                 DATE_FORMAT(b.NgayHoc, '%d/%m/%Y') AS NgayHocFormatted,
                 b.NgayHoc,
                 DAYOFWEEK(b.NgayHoc) AS DayOfWeekNum,
                 TIME_FORMAT(b.GioBatDau, '%H:%i') AS GioBatDau,
                 TIME_FORMAT(b.GioKetThuc, '%H:%i') AS GioKetThuc,
                 p.TenPhong,
                 COALESCE(tk.HoTen, 'FitCenter HLV') AS TenHLV
          FROM DangKyKhoaHoc dk
          JOIN LopHoc l ON dk.LopHocID = l.LopHocID
          JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
          JOIN BuoiHoc b ON b.LopHocID = l.LopHocID
          JOIN Phong p ON b.PhongID = p.PhongID
          LEFT JOIN PhanCongHLV pc ON pc.BuoiHocID = b.BuoiHocID AND pc.TrangThai = 1
          LEFT JOIN TaiKhoan tk ON tk.TaiKhoanID = pc.HuanLuyenVienID
          WHERE dk.KhachHangID = ? AND dk.TrangThai IN (1, 2)
          ORDER BY b.NgayHoc ASC, b.GioBatDau ASC
          LIMIT 10
        `, [m.KhachHangID]);

        // Khóa học đã đăng ký
        const [myRegisteredCourses] = await conn.query(`
          SELECT dk.DangKyID, kh.TenKhoaHoc, l.LopHocID, l.MaLop, l.TenLop,
                 p.TenPhong, l.SucChua, dk.NgayDangKy, dk.TrangThai
          FROM DangKyKhoaHoc dk
          JOIN LopHoc l ON dk.LopHocID = l.LopHocID
          JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
          LEFT JOIN Phong p ON l.PhongID = p.PhongID
          WHERE dk.KhachHangID = ? AND dk.TrangThai IN (1, 2)
        `, [m.KhachHangID]);

        let currentBmi = null;
        let bmiCategory = null;
        const heightM = Number(m.ChieuCao) > 0 ? (Number(m.ChieuCao) > 3 ? Number(m.ChieuCao) / 100 : Number(m.ChieuCao)) : null;
        const weightKg = Number(m.CanNang) > 0 ? Number(m.CanNang) : null;
        if (heightM && weightKg) {
          currentBmi = (weightKg / (heightM * heightM)).toFixed(2);
          if (currentBmi < 18.5) bmiCategory = 'Thiếu cân (Cần tăng cân, tăng cơ)';
          else if (currentBmi < 23) bmiCategory = 'Bình thường (Cân đối, duy trì thể lực)';
          else if (currentBmi < 25) bmiCategory = 'Tiền thừa cân (Cần giảm mỡ, săn chắc cơ)';
          else bmiCategory = 'Thừa cân / Béo phì (Cần giảm mỡ cấp tốc, kiểm soát calo)';
        }

        memberContext = {
          fullName: m.HoTen,
          memberCode: m.MaKhachHang,
          height: m.ChieuCao,
          weight: m.CanNang,
          bmi: currentBmi,
          bmiCategory,
          fitnessGoal: m.MucTieuLuyenTap,
          activeMembership: memberships[0] || null,
          latestInBody: progress[0] || null,
          myUpcomingSessions,
          myRegisteredCourses
        };
      }
    }

    return {
      centerInfo,
      plans,
      courses: enrichedCourses,
      classes: enrichedClasses,
      trainers,
      memberContext
    };
  } catch (err) {
    console.error('[AI Backend] Lỗi khi truy vấn CSDL FitCenter:', err);
    return null;
  }
}

/**
 * 2. Xây dựng System Instruction cho Google Gemini dựa trên CSDL
 */
function buildGeminiSystemPrompt(context) {
  let prompt = `Bạn là Trợ lý AI thông minh chính thức của Trung tâm Thể hình FitCenter Đà Nẵng.
Nhiệm vụ của bạn là tư vấn cho khách hàng và hội viên về các khóa học, gói tập, lịch học, thời gian biểu các lớp, huấn luyện viên, dinh dưỡng, ước tính thời gian hiệu quả rèn luyện và chính sách của trung tâm.

PHONG CÁCH GIAO TIẾP:
- Xưng hô "em" và gọi người dùng là "anh/chị".
- Thân thiện, chu đáo, nhiệt tình, chuyên nghiệp, sử dụng emoji phù hợp.
- Trình bày mạch lạc, rõ ràng.

DƯỚI ĐÂY LÀ DỮ LIỆU THỜI GIAN THỰC TỪ CƠ SỞ DỮ LIỆU MYSQL CỦA FITCENTER:
`;

  if (context) {
    // Thông tin trung tâm
    if (context.centerInfo && context.centerInfo.length > 0) {
      prompt += `\n1. THÔNG TIN TRUNG TÂM FITCENTER:\n`;
      context.centerInfo.forEach(ci => {
        prompt += `- ${ci.TieuDe}: ${ci.NoiDung}\n`;
      });
    }

    // Gói tập
    if (context.plans && context.plans.length > 0) {
      prompt += `\n2. CÁC GÓI TẬP THẺ THÀNH VIÊN (MEMBERSHIP):\n`;
      context.plans.forEach(p => {
        const price = Number(p.Gia).toLocaleString('vi-VN') + ' đ';
        prompt += `- ${p.TenGoiTap} (${p.ThoiHanNgay} ngày): ${price}. ${p.MoTa || ''}\n`;
      });
    }

    // Khóa học & Lịch học
    if (context.courses && context.courses.length > 0) {
      prompt += `\n3. CÁC KHÓA ĐÀO TẠO CHUYÊN SÂU & THỜI GIAN BẮT ĐẦU / KẾT THÚC CÁC LỚP:\n`;
      context.courses.forEach(c => {
        const price = Number(c.Gia).toLocaleString('vi-VN') + ' đ';
        prompt += `* Khóa "${c.TenKhoaHoc}" (${c.ThoiLuongTuan} tuần, ${c.SoBuoi} buổi) - Học phí: ${price}. Điều kiện: ${c.DieuKienThamGia || 'Không yêu cầu'}. Mô tả: ${c.MoTa || ''}\n`;
        if (c.classes && c.classes.length > 0) {
          c.classes.forEach(cls => {
            prompt += `   - Lớp ${cls.MaLop} (${cls.TenLop}): ${cls.scheduleSummary}. Sức chứa ${cls.SucChua}, còn ${cls.ConTrong} chỗ trống.\n`;
          });
        }
      });
    }

    // Huấn luyện viên
    if (context.trainers && context.trainers.length > 0) {
      prompt += `\n4. ĐỘI NGŨ HUẤN LUYỆN VIÊN (HLV / PT):\n`;
      context.trainers.forEach(t => {
        prompt += `- HLV ${t.HoTen}: Chuyên môn ${t.TenChuyenMon || 'Thể hình'}, kinh nghiệm ${t.KinhNghiemNam || 3} năm. Tiểu sử: ${t.TieuSu || ''}\n`;
      });
    }

    // Hội viên đang trò chuyện
    if (context.memberContext) {
      const mc = context.memberContext;
      prompt += `\n5. THÔNG TIN HỘI VIÊN ĐANG TRÒ CHUYỆN:\n`;
      prompt += `- Họ và tên: ${mc.fullName} (Mã HV: ${mc.memberCode})\n`;
      if (mc.height && mc.weight) prompt += `- Thể trạng: Cao ${mc.height}cm, Nặng ${mc.weight}kg. BMI hiện tại: ${mc.bmi || 'Chưa tính'} (${mc.bmiCategory || ''})\n`;
      if (mc.fitnessGoal) prompt += `- Mục tiêu: ${mc.fitnessGoal}\n`;
      if (mc.myRegisteredCourses && mc.myRegisteredCourses.length > 0) {
        prompt += `- Lớp học đã đăng ký thành công:\n`;
        mc.myRegisteredCourses.forEach(rc => {
          prompt += `   + Lớp ${rc.TenLop} (${rc.TenKhoaHoc})\n`;
        });
      }
      if (mc.myUpcomingSessions && mc.myUpcomingSessions.length > 0) {
        prompt += `- Các buổi học sắp tới của học viên:\n`;
        mc.myUpcomingSessions.forEach(s => {
          prompt += `   + Lớp ${s.TenLop} (${s.MaLop}): Ngày ${s.NgayHocFormatted} từ ${s.GioBatDau} đến ${s.GioKetThuc} tại ${s.TenPhong}, HLV ${s.TenHLV}\n`;
        });
      }
    }
  }

  prompt += `
QUY ĐỊNH VÀ CHÍNH SÁCH BẮT BUỘC:
- GIỜ MỞ CỬA: 05:30 – 21:30 hàng ngày từ Thứ 2 đến Chủ nhật tại 123 Nguyễn Văn Linh, Đà Nẵng (Hotline: 0900 000 001).
- TẬP THỬ MIỄN PHÍ: FitCenter tặng 1 buổi tập thử Free Trial 100% miễn phí cho khách mới, đo InBody miễn phí và có PT hướng dẫn.
- ĐỔI CA / HỦY CA HỌC: Hội viên được phép đổi ca hoặc hủy ca học trước giờ bắt đầu ít nhất 2 tiếng tại mục "Lịch học của tôi".
- MUA HÀNG: Nước giải khát, Whey Protein, phụ kiện chỉ bán trực tiếp tại Quầy lễ tân qua nhân viên.

QUY TẮC RẤT QUAN TRỌNG KHI TRẢ LỜI:
1. NẾU NGƯỜI DÙNG HỎI VỀ THỜI GIAN BẮT ĐẦU VÀ KẾT THÚC (hoặc mấy giờ bắt đầu, mấy giờ kết thúc):
   👉 BẠN CHỈ ĐƯỢC PHÉP TRẢ LỜI NGẮN GỌN THỜI GIAN BẮT ĐẦU VÀ THỜI GIAN KẾT THÚC CỤ THỂ DỰA VÀO DỮ LIỆU CSDL TRÊN.
   👉 TUYỆT ĐỐI KHÔNG KÈM THEO HỌC PHÍ, MÔ TẢ NỘI DUNG DÀI DÒNG HAY ĐIỀU KIỆN THAM GIA.

2. NẾU NGƯỜI DÙNG HỎI VỀ KHÓA HỌC: Trả lời đầy đủ thông tin về nội dung, thời lượng, học phí, điều kiện và các lớp đang mở.
3. NẾU NGƯỜI DÙNG HỎI LỊCH CỦA TÔI: Tra cứu mục 5 để trả lời chính xác các buổi học sắp tới của họ.
4. QUY TẮC NGOÀI PHẠM VI: Nếu câu hỏi hoàn toàn không liên quan đến thể thao, thể hình, gói tập, khóa học, sức khỏe hay FitCenter (ví dụ: thời tiết, lập trình, viết code, giải toán, chính trị...), bạn BẮT BUỘC chỉ trả lời duy nhất:
"${OUT_OF_SCOPE_MESSAGE}"
`;

  return prompt;
}

/**
 * 3. Gọi Google Gemini API chính thức
 */
async function callGoogleGeminiAPI({ message, systemPrompt, apiKey, model }) {
  const key = (apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    return {
      success: false,
      error: 'NO_API_KEY',
      message: 'Chưa cấu hình GEMINI_API_KEY. Vui lòng lấy API key từ https://aistudio.google.com/app/apikey và cấu hình vào file NHOM9/.env'
    };
  }

  const preferredModel = model || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  // Danh sách model ưu tiên tự động dự phòng nếu Google quá tải 503
  const modelsToTry = Array.from(new Set([
    preferredModel,
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite',
    'gemini-3.8-flash'
  ]));

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: message }]
      }
    ],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 1200
    }
  };

  let lastError = null;

  for (const modelName of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 giây timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText) {
          return {
            success: true,
            reply: replyText.trim(),
            model: modelName,
            source: 'google-gemini-ai'
          };
        }
      } else {
        const errText = await response.text();
        lastError = `HTTP_${response.status} (${modelName}): ${errText}`;
        console.warn(`[Google Gemini API] Model ${modelName} trả về lỗi HTTP ${response.status}, thử model kế tiếp...`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err.message;
      console.warn(`[Google Gemini API] Model ${modelName} ngoại lệ: ${err.message}, thử model kế tiếp...`);
    }
  }

  return {
    success: false,
    error: 'ALL_MODELS_FAILED',
    message: lastError || 'Không thể kết nối đến Google Gemini API.'
  };
}

/**
 * 4. Hàm điều phối chính: Nhận câu hỏi, gom dữ liệu MySQL, gọi Gemini API
 */
async function chatWithGemini({ message, memberId, apiKey, model, dbConn }) {
  const cleanMsg = (message || '').trim();
  if (!cleanMsg) {
    return {
      success: true,
      reply: 'Dạ em chào anh/chị! Em là Trợ lý AI FitCenter. Em có thể giúp gì cho anh/chị về khóa học, thời gian bắt đầu và kết thúc hay lịch học ạ?'
    };
  }

  // Thu thập dữ liệu ngữ cảnh thời gian thực từ MySQL
  const context = await getFitCenterDataContext(dbConn || db, memberId);

  // Tạo System Instruction
  const systemPrompt = buildGeminiSystemPrompt(context);

  // Gọi Gemini API
  const geminiResult = await callGoogleGeminiAPI({
    message: cleanMsg,
    systemPrompt,
    apiKey,
    model
  });

  if (geminiResult.success && geminiResult.reply) {
    return {
      success: true,
      reply: geminiResult.reply,
      source: 'google-gemini-ai',
      model: geminiResult.model
    };
  }

  // Nếu chưa có API key hoặc gọi Gemini lỗi -> Dùng fallback engine thông minh
  const { smartLocalAIResponse } = require('./services/geminiService');
  const fallbackReply = smartLocalAIResponse(cleanMsg, context);

  return {
    success: true,
    reply: fallbackReply,
    source: 'fitcenter-knowledge-base',
    geminiStatus: geminiResult.error ? `Gemini API: ${geminiResult.error} (${geminiResult.message})` : 'Chưa có API key'
  };
}

// ==============================================================================
// 5. EXPRESS ROUTER DÀNH RIÊNG CHO MODULE AI
// ==============================================================================
const router = express.Router();

// POST /api/ai/chat -> Chat với AI
router.post('/chat', async (req, res) => {
  try {
    const { message, memberId, apiKey, model } = req.body;
    const key = apiKey || req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
    const currentMemberId = Number(memberId) || 5;

    const result = await chatWithGemini({
      message,
      memberId: currentMemberId,
      apiKey: key,
      model,
      dbConn: db
    });

    res.json(result);
  } catch (err) {
    console.error('[AI Backend Route] Lỗi:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/ai/status -> Kiểm tra tình trạng kết nối Google Gemini API
router.get('/status', async (req, res) => {
  const currentKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  const maskedKey = currentKey ? `${currentKey.slice(0, 8)}...${currentKey.slice(-4)}` : 'Chưa cấu hình (Đang trống)';

  res.json({
    success: true,
    status: 'AI Backend is active',
    configuredKey: maskedKey,
    hasApiKey: !!currentKey,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    instructions: 'Để sử dụng Google Gemini AI, hãy lấy API key từ https://aistudio.google.com/app/apikey và cấu hình vào file NHOM9/.env'
  });
});

// POST /api/ai/set-key -> Cập nhật API Key trực tiếp không cần sửa file bằng tay
router.post('/set-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp chuỗi apiKey hợp lệ!' });
  }

  const cleanKey = apiKey.trim();
  process.env.GEMINI_API_KEY = cleanKey;

  // Ghi vào file .env
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('GEMINI_API_KEY=')) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${cleanKey}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${cleanKey}\n`;
      }
    } else {
      envContent = `GEMINI_API_KEY=${cleanKey}\nGEMINI_MODEL=gemini-1.5-flash\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    res.json({
      success: true,
      message: 'Đã cập nhật GEMINI_API_KEY thành công vào hệ thống và file .env!',
      keyPreview: `${cleanKey.slice(0, 8)}...${cleanKey.slice(-4)}`
    });
  } catch (err) {
    res.json({
      success: true,
      message: 'Đã cập nhật GEMINI_API_KEY vào bộ nhớ runtime!',
      note: 'Lỗi ghi file .env: ' + err.message
    });
  }
});

// GET /api/ai/context -> Xem dữ liệu MySQL nạp vào Gemini
router.get('/context', async (req, res) => {
  const memberId = Number(req.query.memberId) || 5;
  const context = await getFitCenterDataContext(db, memberId);
  const systemPrompt = buildGeminiSystemPrompt(context);
  res.json({
    success: true,
    dataSummary: {
      coursesCount: context?.courses?.length || 0,
      classesCount: context?.classes?.length || 0,
      trainersCount: context?.trainers?.length || 0,
      member: context?.memberContext?.fullName || 'Không xác định'
    },
    systemInstructionPreview: systemPrompt
  });
});

// ==============================================================================
// 6. NẾU CHẠY TRỰC TIẾP TẬP TIN NÀY (node NHOM9/ai_backend.js)
// ==============================================================================
if (require.main === module) {
  const standaloneApp = express();
  standaloneApp.use(cors());
  standaloneApp.use(express.json());

  // Mount API
  standaloneApp.use('/api/ai', router);

  const AI_PORT = process.env.AI_PORT || 3001;
  standaloneApp.listen(AI_PORT, () => {
    console.log(`=======================================================`);
    console.log(`🤖 MÁY CHỦ RIÊNG GOOGLE GEMINI AI FITCENTER ĐANG CHẠY!`);
    console.log(`📍 Cổng hoạt động: http://localhost:${AI_PORT}`);
    console.log(`👉 Chat API: POST http://localhost:${AI_PORT}/api/ai/chat`);
    console.log(`👉 Kiểm tra trạng thái: GET http://localhost:${AI_PORT}/api/ai/status`);
    console.log(`👉 Cập nhật Key: POST http://localhost:${AI_PORT}/api/ai/set-key`);
    console.log(`👉 Xem ngữ cảnh CSDL: GET http://localhost:${AI_PORT}/api/ai/context`);
    console.log(`=======================================================`);
  });
}

module.exports = {
  router,
  chatWithGemini,
  getFitCenterDataContext,
  buildGeminiSystemPrompt,
  callGoogleGeminiAPI
};
