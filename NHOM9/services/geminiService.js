/**
 * Dịch vụ Trợ lý AI FitCenter thông minh
 * Tích hợp Google Gemini API + Local AI Reasoning Engine
 * Dựa trên dữ liệu thực tế từ CSDL QuanLyTrungTamTheHinh
 */

const OUT_OF_SCOPE_MESSAGE = 'Dạ em đã ghi nhận câu hỏi của anh/chị. Anh/chị có thể hỏi em những câu hỏi liên quan đến hệ thống fitcenter thôi ạ. Những câu hỏi này vược ngoài phạm vi của em ạ.';

/**
 * Chuẩn hóa tiếng Việt (bỏ dấu) để nhận diện ngôn ngữ tự nhiên linh hoạt
 */
function removeAccents(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Định dạng tiền tệ VNĐ
 */
function formatCurrency(val) {
  return Number(val || 0).toLocaleString('vi-VN') + ' đ';
}

/**
 * Thu thập toàn bộ ngữ cảnh dữ liệu của Trung tâm FitCenter từ MySQL
 */
async function getFitCenterDataContext(db, memberId) {
  try {
    // 1. Thông tin trung tâm
    const [centerInfo] = await db.query('SELECT LoaiMuc, TieuDe, NoiDung FROM ThongTinTrungTam WHERE CongBo = 1 ORDER BY ThuTu ASC');

    // 2. Danh sách gói tập
    const [plans] = await db.query('SELECT GoiTapID, TenGoiTap, Gia, ThoiHanNgay, MoTa FROM GoiTap WHERE TrangThai = 1');

    // 3. Danh sách khóa học
    const [courses] = await db.query(`
      SELECT kh.KhoaHocID, kh.TenKhoaHoc, kh.MoTa, kh.ThoiLuongTuan, kh.SoBuoi, kh.Gia, kh.DieuKienThamGia, cm.TenChuyenMon
      FROM KhoaHoc kh
      LEFT JOIN ChuyenMon cm ON kh.ChuyenMonID = cm.ChuyenMonID
      WHERE kh.TrangThai = 1
    `);

    // 4. Danh sách lớp học đang công bố kèm số chỗ còn trống
    const [classes] = await db.query(`
      SELECT l.LopHocID, l.MaLop, l.TenLop, kh.KhoaHocID, kh.TenKhoaHoc,
             p.TenPhong, l.SucChua, l.NgayBatDau, l.NgayKetThuc,
             (l.SucChua - COALESCE(COUNT(dk.DangKyID), 0)) AS ConTrong
      FROM LopHoc l
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      LEFT JOIN Phong p ON l.PhongID = p.PhongID
      LEFT JOIN DangKyKhoaHoc dk ON l.LopHocID = dk.LopHocID AND dk.TrangThai = 1
      WHERE l.CongBo = 1
      GROUP BY l.LopHocID, l.MaLop, l.TenLop, kh.KhoaHocID, kh.TenKhoaHoc, p.TenPhong, l.SucChua, l.NgayBatDau, l.NgayKetThuc
    `);

    // 5. Lịch học chi tiết từng thứ trong tuần từ bảng BuoiHoc & PhanCongHLV
    const [schedules] = await db.query(`
      SELECT b.LopHocID,
             DAYOFWEEK(b.NgayHoc) AS DayOfWeekNum,
             TIME_FORMAT(b.GioBatDau, '%H:%i') AS GioBatDau,
             TIME_FORMAT(b.GioKetThuc, '%H:%i') AS GioKetThuc,
             p.TenPhong,
             tk.HoTen AS TenHLV
      FROM BuoiHoc b
      LEFT JOIN Phong p ON b.PhongID = p.PhongID
      LEFT JOIN PhanCongHLV pc ON b.BuoiHocID = pc.BuoiHocID
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
      classMap[c.LopHocID] = {
        ...c,
        patterns: []
      };
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
          phong: s.TenPhong || 'Phòng tập FitCenter',
          hlv: s.TenHLV || 'HLV FitCenter',
          ca
        });
      }
    });

    // Tạo chuỗi tóm tắt lịch cho từng lớp
    Object.values(classMap).forEach(c => {
      if (c.patterns.length > 0) {
        const timeGroups = {};
        c.patterns.forEach(p => {
          const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.ca}-${p.phong}-${p.hlv}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], ...p };
          timeGroups[k].days.push(p.thu);
        });
        c.scheduleSummary = Object.values(timeGroups)
          .map(t => `${t.days.join(' & ')} (${t.gioBatDau} – ${t.gioKetThuc}, Buổi ${t.ca}) | ${t.phong} | HLV: ${t.hlv}`)
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
    const enrichedCourses = courses.map(course => {
      return {
        ...course,
        classes: enrichedClasses.filter(cls => cls.KhoaHocID === course.KhoaHocID)
      };
    });

    // 6. Danh sách huấn luyện viên
    const [trainers] = await db.query(`
      SELECT tk.HoTen, cm.TenChuyenMon, hlv.KinhNghiemNam, hlv.TieuSu
      FROM HuanLuyenVien hlv
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
      LEFT JOIN HLV_ChuyenMon hcm ON hlv.HuanLuyenVienID = hcm.HuanLuyenVienID
      LEFT JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
      WHERE hlv.TrangThaiHoatDong = 1
    `);

    // 7. Ngữ cảnh cá nhân của học viên nếu có memberId
    let memberContext = null;
    if (memberId) {
      const [members] = await db.query(`
        SELECT t.TaiKhoanID, t.HoTen, t.Email, t.SoDienThoai,
               k.KhachHangID, k.MaKhachHang, k.ChieuCao, k.CanNang, k.MucTieu AS MucTieuLuyenTap
        FROM TaiKhoan t
        JOIN KhachHang k ON t.TaiKhoanID = k.KhachHangID
        WHERE t.TaiKhoanID = ? OR k.KhachHangID = ?
      `, [memberId, memberId]);

      if (members.length > 0) {
        const m = members[0];
        // Gói tập hiện tại
        const [memberships] = await db.query(`
          SELECT g.TenGoiTap, d.NgayHetHan, DATEDIFF(d.NgayHetHan, CURRENT_DATE) AS days_left
          FROM DangKyGoiTap d
          JOIN GoiTap g ON d.GoiTapID = g.GoiTapID
          WHERE d.KhachHangID = ? AND d.TrangThai = 1
          ORDER BY d.NgayHetHan DESC LIMIT 1
        `, [m.KhachHangID]);

        // Đánh giá InBody gần nhất
        const [progress] = await db.query(`
          SELECT kq.CanNang, kq.TyLeMo, kq.MucDoHoanThanh, kq.NhanXet, kq.NgayCapNhat
          FROM KetQuaHocVien kq
          JOIN DangKyKhoaHoc dk ON kq.DangKyID = dk.DangKyID
          WHERE dk.KhachHangID = ?
          ORDER BY kq.NgayCapNhat DESC LIMIT 1
        `, [m.KhachHangID]);

        // Lịch học cá nhân sắp tới từ DangKyKhoaHoc + BuoiHoc (TrangThai IN (1, 2))
        const [myUpcomingSessions] = await db.query(`
          SELECT dk.DangKyID, l.LopHocID, l.MaLop, l.TenLop, kh.TenKhoaHoc,
                 b.BuoiHocID,
                 DATE_FORMAT(b.NgayHoc, '%d/%m/%Y') AS NgayHocFormatted,
                 b.NgayHoc,
                 DAYOFWEEK(b.NgayHoc) AS DayOfWeekNum,
                 TIME_FORMAT(b.GioBatDau, '%H:%i') AS GioBatDau,
                 TIME_FORMAT(b.GioKetThuc, '%H:%i') AS GioKetThuc,
                 p.TenPhong,
                 COALESCE(tk.HoTen, 'FitCenter HLV') AS TenHLV,
                 b.TrangThai AS TrangThaiBuoi
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

        // Khóa học / lớp học đã đăng ký thành công
        const [myRegisteredCourses] = await db.query(`
          SELECT dk.DangKyID, kh.TenKhoaHoc, l.LopHocID, l.MaLop, l.TenLop,
                 p.TenPhong, l.SucChua, dk.NgayDangKy, dk.TrangThai
          FROM DangKyKhoaHoc dk
          JOIN LopHoc l ON dk.LopHocID = l.LopHocID
          JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
          LEFT JOIN Phong p ON l.PhongID = p.PhongID
          WHERE dk.KhachHangID = ? AND dk.TrangThai IN (1, 2)
        `, [m.KhachHangID]);

        // Tính BMI nếu có chiều cao cân nặng
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
    console.error('Lỗi khi lấy dữ liệu context FitCenter:', err);
    return null;
  }
}

/**
 * Xây dựng System Prompt chi tiết cho Gemini
 */
function buildGeminiSystemPrompt(context) {
  let prompt = `Bạn là Trợ lý AI thông minh chính thức của Trung tâm thể hình FitCenter Đà Nẵng.
Nhiệm vụ của bạn là hỗ trợ, tư vấn khách hàng và hội viên về các dịch vụ, gói tập, lịch học, thời gian các lớp học, huấn luyện viên, dinh dưỡng, ước tính thời gian hiệu quả tập luyện và các chính sách của trung tâm FitCenter.

Tác phong của bạn:
- Xưng hô "em" và gọi người dùng là "anh/chị".
- Giọng điệu thân thiện, chu đáo, nhiệt tình, chuyên nghiệp, sử dụng biểu tượng cảm xúc (emoji) phù hợp.
- Trình bày mạch lạc, cấu trúc danh sách rõ ràng, dễ đọc.

DƯỚI ĐÂY LÀ DỮ LIỆU THỜI GIAN THỰC CHÍNH XÁC VỀ FITCENTER TỪ CƠ SỞ DỮ LIỆU MYSQL:
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
        const price = formatCurrency(p.Gia);
        prompt += `- ${p.TenGoiTap} (Thời hạn ${p.ThoiHanNgay} ngày): ${price}. ${p.MoTa || ''}\n`;
      });
    }

    // Khóa học & Lịch học cụ thể từng lớp
    if (context.courses && context.courses.length > 0) {
      prompt += `\n3. CÁC KHÓA ĐÀO TẠO CHUYÊN SÂU & THỜI GIAN BIỂU CỤ THỂ TỪ CSDL:\n`;
      context.courses.forEach(c => {
        const price = formatCurrency(c.Gia);
        prompt += `* Khóa "${c.TenKhoaHoc}" (${c.ThoiLuongTuan} tuần, ${c.SoBuoi} buổi) - Học phí: ${price}. Điều kiện: ${c.DieuKienThamGia || 'Không yêu cầu'}. Mô tả: ${c.MoTa || ''}\n`;
        if (c.classes && c.classes.length > 0) {
          c.classes.forEach(cls => {
            prompt += `   - Lớp ${cls.MaLop} (${cls.TenLop}): Lịch học: ${cls.scheduleSummary}. Sức chứa ${cls.SucChua}, còn ${cls.ConTrong} chỗ trống.\n`;
          });
        }
      });
    }

    // Đội ngũ Huấn luyện viên
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
      if (mc.fitnessGoal) prompt += `- Mục tiêu đã lưu: ${mc.fitnessGoal}\n`;
      if (mc.activeMembership) {
        prompt += `- Gói tập đang kích hoạt: ${mc.activeMembership.TenGoiTap}, hạn đến ngày ${new Date(mc.activeMembership.NgayHetHan).toLocaleDateString('vi-VN')} (còn ${mc.activeMembership.days_left} ngày).\n`;
      } else {
        prompt += `- Gói tập: Hiện chưa có gói tập nào còn hạn.\n`;
      }
      if (mc.latestInBody) {
        prompt += `- Đánh giá InBody gần nhất: Cân nặng ${mc.latestInBody.CanNang}kg, Tỷ lệ mỡ ${mc.latestInBody.TyLeMo}%. HLV nhận xét: "${mc.latestInBody.NhanXet || ''}"\n`;
      }
      if (mc.myRegisteredCourses && mc.myRegisteredCourses.length > 0) {
        prompt += `- Các khóa học / lớp học học viên đã đăng ký:\n`;
        mc.myRegisteredCourses.forEach(rc => {
          prompt += `   * Lớp ${rc.TenLop} (${rc.TenKhoaHoc})\n`;
        });
      }
      if (mc.myUpcomingSessions && mc.myUpcomingSessions.length > 0) {
        prompt += `- Danh sách các buổi học cụ thể sắp tới của học viên:\n`;
        mc.myUpcomingSessions.forEach(s => {
          prompt += `   + Lớp ${s.TenLop} (${s.MaLop}): Ngày ${s.NgayHocFormatted} từ ${s.GioBatDau} đến ${s.GioKetThuc} tại ${s.TenPhong}, HLV ${s.TenHLV}\n`;
        });
      }
    }
  }

  prompt += `
QUY ĐỊNH VÀ CHÍNH SÁCH BẮT BUỘC CỦA FITCENTER:
- ĐỔI CA / HỦY CA HỌC: Hội viên được phép tự đổi ca hoặc hủy ca học trên website (tại mục "Lịch học của tôi") trước giờ bắt đầu buổi học ít nhất 2 tiếng.
- MUA HÀNG & NƯỚC UỐNG / WHEY: Các sản phẩm nước giải khát, Whey Protein, găng tay, khăn tập chỉ được bán trực tiếp tại Quầy lễ tân trung tâm qua nhân viên, không bán trực tuyến để đảm bảo chất lượng.
- TẬP THỬ MIỄN PHÍ: Khách hàng mới được trải nghiệm 1 buổi tập thử MIỄN PHÍ, đo InBody miễn phí và có PT hướng dẫn. Đăng ký tại Quầy lễ tân 123 Nguyễn Văn Linh hoặc Hotline 0900 000 001.
- HIỆU QUẢ THEO BMI: Phân tích lộ trình 3 giai đoạn (2-4 tuần: Thích nghi; 6-8 tuần: Biến chuyển vóc dáng rõ rệt; 12 tuần trở lên: Thay đổi vóc dáng toàn diện).

QUY TẮC BẮT BUỘC KHI TRẢ LỜI VỀ KHÓA HỌC VÀ THỜI GIAN:
- Khi người dùng hỏi liên quan đến khóa học (nội dung, học phí, điều kiện, có những gì): Hãy trả lời chi tiết và giới thiệu các lớp học đang mở kèm thời gian học.
- ĐẶC BIỆT: Khi người dùng hỏi về "thời gian bắt đầu và thời gian kết thúc" (hoặc mấy giờ bắt đầu, mấy giờ kết thúc): BẮT BUỘC CHỈ ĐƯỢC trả lời thời gian bắt đầu và thời gian kết thúc cụ thể từ dữ liệu CSDL. Tuyệt đối KHÔNG kèm theo các thông tin dài dòng khác như học phí, mô tả chi tiết, điều kiện tham gia...
- Khi người dùng hỏi về THỜI GIAN / MẤY GIỜ / THỨ MẤY / LỊCH HỌC: Phải dựa trực tiếp vào danh sách các lớp học ở mục 3 để trả lời thời gian cụ thể (thứ trong tuần, giờ bắt đầu đến giờ kết thúc, ca sáng/chiều/tối, phòng học, HLV phụ trách, chỗ trống). Tuyệt đối không trả lời chung chung!
- Khi người dùng hỏi lịch học của cá nhân ("của tôi", "lịch của em"): Dựa vào mục 5 để trả lời chính xác các buổi học sắp tới của họ.

QUY TẮC PHẠM VI (RẤT QUAN TRỌNG - TUYỆT ĐỐI TUÂN THỦ):
Nếu câu hỏi của người dùng KHÔNG liên quan đến hệ thống trung tâm thể hình FitCenter, thể thao, thể hình, tập gym, dinh dưỡng, gói tập, khóa học, huấn luyện viên, lịch học, sức khỏe, BMI, chính sách trung tâm (ví dụ: hỏi thời tiết, lập trình, viết code, giải toán, chính trị, tin tức ngoài lề...), bạn BẮT BUỘC chỉ trả lời duy nhất câu văn sau, không thêm bớt bất kỳ từ ngữ nào:
"${OUT_OF_SCOPE_MESSAGE}"
`;

  return prompt;
}

/**
 * Gọi Google Gemini API
 */
async function callGeminiApi(userMessage, systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null; // Không có API Key -> chuyển sang fallback local
  }

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userMessage }]
      }
    ],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1200
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000); // 9 giây timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(`[Gemini API] Lỗi HTTP ${response.status}: ${errBody}`);
      return null;
    }

    const data = await response.json();
    const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return replyText ? replyText.trim() : null;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[Gemini API] Ngoại lệ khi gọi API:', err.message);
    return null;
  }
}

/**
 * Bộ xử lý Tri thức cục bộ Thông minh (Smart Local AI Engine)
 * Xử lý ngôn ngữ tự nhiên, phân tích ý định và trích xuất dữ liệu CSDL thời gian thực
 */
function smartLocalAIResponse(userMessage, context) {
  const originalQ = (userMessage || '').trim();
  const lowerQ = originalQ.toLowerCase();
  const cleanQ = removeAccents(lowerQ);

  const has = (...keywords) => {
    return keywords.some(kw => {
      const cleanKw = removeAccents(kw.toLowerCase());
      return lowerQ.includes(kw.toLowerCase()) || cleanQ.includes(cleanKw);
    });
  };

  const courses = context?.courses || [];
  const classes = context?.classes || [];
  const member = context?.memberContext || null;

  // 1. Nhận diện khóa học cụ thể
  let targetCourse = null;
  if (has('yoga', 'duong sinh', 'uon deo', 'gian co')) {
    targetCourse = courses.find(c => removeAccents(c.TenKhoaHoc).includes('yoga'));
  } else if (has('boxing', 'dam boc', 'quyen anh', 'vo thuat', 'dam')) {
    targetCourse = courses.find(c => removeAccents(c.TenKhoaHoc).includes('boxing'));
  } else if (has('giam mo', 'giam can', '8 tuan', 'cardio', 'fat loss', 'giam beo')) {
    targetCourse = courses.find(c => removeAccents(c.TenKhoaHoc).includes('giam mo'));
  }

  // 2. Nhận diện ý định hỏi thời gian / lịch học
  const isAskingTime = has(
    'thoi gian', 'may gio', 'may h', 'gio hoc', 'gio tap', 'khung gio',
    'lich', 'lich hoc', 'lich tap', 'thu may', 'khi nao', 'buoi nao', 'ca nao',
    'ca hoc', 'thoi khoa bieu', 'tkb', 'hoc luc', 'tap luc', 'gio bat dau',
    'buoi toi', 'buoi sang', 'buoi chieu'
  );

  // 3. Nhận diện hỏi lịch cá nhân của tôi
  const isPersonalSchedule = 
    has(
      'lich cua toi', 'lich hoc cua toi', 'lich cua em', 'lich tap cua toi', 'lich cua minh',
      'toi hoc luc may gio', 'toi hoc khi nao', 'toi co lich khong', 'toi co lich hoc khong',
      'lop toi da dang ky', 'lop cua toi', 'lop hoc cua toi', 'khoa cua toi',
      'ca hoc cua toi', 'gio hoc cua toi', 'hom nay toi co hoc khong', 'tuan nay toi hoc',
      'lich sap toi', 'lich ca nhan', 'xem lich cua toi', 'toi hoc ca nao', 'toi hoc thu may',
      'toi da dang ky', 'da dang ky lop nao', 'da dang ky khoa nao', 'thoi gian hoc cua toi',
      'lich hoc cua ban than'
    ) || 
    (has('cua toi', 'cua em', 'cua minh', 'da dang ky', 'toi hoc') && isAskingTime);

  // 4. Nhận diện ca / buổi (sáng, chiều, tối)
  const isAskingEvening = has('toi', 'buoi toi', 'evening', 'chieu toi', 'tan tam');
  const isAskingMorning = has('sang', 'buoi sang', 'morning', 'som');
  const isAskingAfternoon = has('chieu', 'buoi chieu', 'afternoon');
  const isAskingShift = isAskingEvening || isAskingMorning || isAskingAfternoon;

  // 5. Nhận diện câu hỏi chuyên biệt về thời gian bắt đầu & kết thúc
  const isAskingStart = has('bat dau', 'bắt đầu', 'mở đầu', 'start', 'vao hoc');
  const isAskingEnd = has('ket thuc', 'kết thúc', 'kết thức', 'ket thuc', 'end', 'tan hoc', 'nghi hoc');
  const isStartAndEnd = (isAskingStart && isAskingEnd) ||
    has(
      'bat dau va ket thuc', 'bat dau vf ket thuc', 'bat dau va ket thuc', 'bat dau vf ket thuc',
      'tu may gio den may gio', 'may gio bat dau may gio ket thuc', 'may gio bat dau va may gio ket thuc',
      'thoi gian bat dau va thoi gian ket thuc', 'thoi gian bat dau vf thoi gian ket thuc',
      'thoi gian bat dau va ket thuc', 'thoi gian bat dau vf ket thuc',
      'gio bat dau va gio ket thuc', 'gio bat dau va ket thuc'
    );

  const dayOfWeekMap = {
    1: 'Chủ nhật',
    2: 'Thứ 2',
    3: 'Thứ 3',
    4: 'Thứ 4',
    5: 'Thứ 5',
    6: 'Thứ 6',
    7: 'Thứ 7'
  };

  // =========================================================================
  // 0. CHUYÊN BIỆT: NẾU HỎI THỜI GIAN BẮT ĐẦU VÀ KẾT THÚC (CHỈ TRẢ LỜI TG BẮT ĐẦU & KẾT THÚC)
  // =========================================================================
  if (isStartAndEnd) {
    // 0.1. Lịch học cá nhân của tôi
    if (isPersonalSchedule) {
      if (!member) {
        return 'Dạ do anh/chị chưa đăng nhập tài khoản nên em chưa tra cứu được thời gian bắt đầu và kết thúc của các buổi học cá nhân. Mời anh/chị đăng nhập để xem nhé!';
      }
      const hasSessions = member.myUpcomingSessions && member.myUpcomingSessions.length > 0;
      if (hasSessions) {
        let reply = `⏰ **THỜI GIAN BẮT ĐẦU & KẾT THÚC CÁC BUỔI HỌC CỦA ANH/CHỊ (${member.fullName}):**\n\n`;
        member.myUpcomingSessions.forEach((s, idx) => {
          const thu = dayOfWeekMap[s.DayOfWeekNum] || 'Thứ';
          const ngay = s.NgayHocFormatted || new Date(s.NgayHoc).toLocaleDateString('vi-VN');
          reply += `${idx + 1}. **${s.TenLop}** (${thu}, ${ngay}):\n`;
          reply += `   - Giờ bắt đầu: **${s.GioBatDau}**\n`;
          reply += `   - Giờ kết thúc: **${s.GioKetThuc}**\n\n`;
        });
        return reply.trim();
      } else if (member.myRegisteredCourses && member.myRegisteredCourses.length > 0) {
        let reply = `⏰ **THỜI GIAN BẮT ĐẦU & KẾT THÚC CÁC LỚP CỦA ANH/CHỊ (${member.fullName}):**\n\n`;
        member.myRegisteredCourses.forEach((rc, idx) => {
          const foundCls = classes.find(c => c.LopHocID === rc.LopHocID);
          if (foundCls && foundCls.patterns && foundCls.patterns.length > 0) {
            const timeGroups = {};
            foundCls.patterns.forEach(p => {
              const k = `${p.gioBatDau}-${p.gioKetThuc}`;
              if (!timeGroups[k]) timeGroups[k] = { days: [], gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc };
              timeGroups[k].days.push(p.thu);
            });
            Object.values(timeGroups).forEach(tg => {
              reply += `${idx + 1}. **${rc.TenLop}** (${tg.days.join(' & ')}):\n`;
              reply += `   - Giờ bắt đầu: **${tg.gioBatDau}**\n`;
              reply += `   - Giờ kết thúc: **${tg.gioKetThuc}**\n\n`;
            });
          }
        });
        return reply.trim();
      } else {
        return `Dạ hiện tại tài khoản của anh/chị (${member.fullName}) chưa đăng ký lớp học nào nên chưa có thời gian bắt đầu và kết thúc buổi học ạ.`;
      }
    }

    // 0.2. Khóa học cụ thể (Yoga, Boxing, Giảm mỡ)
    if (targetCourse) {
      let reply = `⏰ **THỜI GIAN BẮT ĐẦU & KẾT THÚC KHÓA ${targetCourse.TenKhoaHoc.toUpperCase()}:**\n\n`;
      if (targetCourse.classes && targetCourse.classes.length > 0) {
        targetCourse.classes.forEach(cls => {
          const timeGroups = {};
          (cls.patterns || []).forEach(p => {
            const k = `${p.gioBatDau}-${p.gioKetThuc}`;
            if (!timeGroups[k]) timeGroups[k] = { days: [], gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc };
            timeGroups[k].days.push(p.thu);
          });
          Object.values(timeGroups).forEach(tg => {
            reply += `• **${cls.TenLop}** (${cls.MaLop} - ${tg.days.join(' & ')}):\n`;
            reply += `  - Giờ bắt đầu: **${tg.gioBatDau}**\n`;
            reply += `  - Giờ kết thúc: **${tg.gioKetThuc}**\n\n`;
          });
        });
      } else {
        reply += 'Hiện tại khóa học đang cập nhật thời gian mở lớp mới ạ.';
      }
      return reply.trim();
    }

    // 0.3. Trung tâm mở cửa / đóng cửa
    if (has('trung tam', 'phong tap', 'fitcenter', 'gym', 'mo cua', 'dong cua')) {
      return (
        `⏰ **THỜI GIAN BẮT ĐẦU & KẾT THÚC MỞ CỬA FITCENTER:**\n\n` +
        `- Giờ bắt đầu (Mở cửa): **05:30**\n` +
        `- Giờ kết thúc (Đóng cửa): **21:30**\n` +
        `*(Áp dụng tất cả các ngày trong tuần)*`
      );
    }

    // 0.4. Toàn bộ các lớp học tại trung tâm
    let reply = `⏰ **THỜI GIAN BẮT ĐẦU & KẾT THÚC CỦA CÁC LỚP HỌC TẠI FITCENTER:**\n\n`;
    classes.forEach((cls, idx) => {
      const timeGroups = {};
      (cls.patterns || []).forEach(p => {
        const k = `${p.gioBatDau}-${p.gioKetThuc}`;
        if (!timeGroups[k]) timeGroups[k] = { days: [], gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc };
        timeGroups[k].days.push(p.thu);
      });
      Object.values(timeGroups).forEach(tg => {
        reply += `${idx + 1}. **${cls.TenLop}** (${tg.days.join(' & ')}):\n`;
        reply += `   - Giờ bắt đầu: **${tg.gioBatDau}**\n`;
        reply += `   - Giờ kết thúc: **${tg.gioKetThuc}**\n\n`;
      });
    });
    return reply.trim();
  }

  // =========================================================================
  // 0B. NẾU CHỈ HỎI THỜI GIAN BẮT ĐẦU (MẤY GIỜ BẮT ĐẦU)
  // =========================================================================
  if (isAskingStart && !isAskingEnd && (has('lop', 'khoa', 'hoc', 'tap', 'may gio', 'thoi gian') || targetCourse)) {
    if (targetCourse) {
      let reply = `⏰ **THỜI GIAN BẮT ĐẦU KHÓA ${targetCourse.TenKhoaHoc.toUpperCase()}:**\n\n`;
      targetCourse.classes.forEach(cls => {
        const timeGroups = {};
        (cls.patterns || []).forEach(p => {
          const k = `${p.gioBatDau}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], gioBatDau: p.gioBatDau };
          timeGroups[k].days.push(p.thu);
        });
        Object.values(timeGroups).forEach(tg => {
          reply += `• **${cls.TenLop}** (${tg.days.join(' & ')}): Giờ bắt đầu là **${tg.gioBatDau}**\n`;
        });
      });
      return reply.trim();
    } else {
      let reply = `⏰ **THỜI GIAN BẮT ĐẦU CỦA CÁC LỚP HỌC TẠI FITCENTER:**\n\n`;
      classes.forEach((cls, idx) => {
        const timeGroups = {};
        (cls.patterns || []).forEach(p => {
          const k = `${p.gioBatDau}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], gioBatDau: p.gioBatDau };
          timeGroups[k].days.push(p.thu);
        });
        Object.values(timeGroups).forEach(tg => {
          reply += `${idx + 1}. **${cls.TenLop}** (${tg.days.join(' & ')}): Giờ bắt đầu là **${tg.gioBatDau}**\n`;
        });
      });
      return reply.trim();
    }
  }

  // =========================================================================
  // 0C. NẾU CHỈ HỎI THỜI GIAN KẾT THÚC (MẤY GIỜ KẾT THÚC / TAN HỌC)
  // =========================================================================
  if (isAskingEnd && !isAskingStart && (has('lop', 'khoa', 'hoc', 'tap', 'may gio', 'thoi gian', 'tan hoc') || targetCourse)) {
    if (targetCourse) {
      let reply = `⏰ **THỜI GIAN KẾT THÚC KHÓA ${targetCourse.TenKhoaHoc.toUpperCase()}:**\n\n`;
      targetCourse.classes.forEach(cls => {
        const timeGroups = {};
        (cls.patterns || []).forEach(p => {
          const k = `${p.gioKetThuc}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], gioKetThuc: p.gioKetThuc };
          timeGroups[k].days.push(p.thu);
        });
        Object.values(timeGroups).forEach(tg => {
          reply += `• **${cls.TenLop}** (${tg.days.join(' & ')}): Giờ kết thúc là **${tg.gioKetThuc}**\n`;
        });
      });
      return reply.trim();
    } else {
      let reply = `⏰ **THỜI GIAN KẾT THÚC CỦA CÁC LỚP HỌC TẠI FITCENTER:**\n\n`;
      classes.forEach((cls, idx) => {
        const timeGroups = {};
        (cls.patterns || []).forEach(p => {
          const k = `${p.gioKetThuc}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], gioKetThuc: p.gioKetThuc };
          timeGroups[k].days.push(p.thu);
        });
        Object.values(timeGroups).forEach(tg => {
          reply += `${idx + 1}. **${cls.TenLop}** (${tg.days.join(' & ')}): Giờ kết thúc là **${tg.gioKetThuc}**\n`;
        });
      });
      return reply.trim();
    }
  }

  // =========================================================================
  // 1. LỊCH HỌC CÁ NHÂN (Hội viên hỏi về lịch của mình)
  // =========================================================================
  if (isPersonalSchedule) {
    if (!member) {
      let reply = `👋 **THÔNG BÁO THỜI KHÓA BIỂU CÁC LỚP HỌC FITCENTER:**\n\n`;
      reply += `Dạ do anh/chị chưa đăng nhập tài khoản hội viên trên hệ thống nên em chưa thể hiển thị lịch học cá nhân riêng của anh/chị.\n\n`;
      reply += `🏋️‍♂️ **DƯỚI ĐÂY LÀ THỜI KHÓA BIỂU CÁC LỚP HỌC ĐANG MỞ TẠI FITCENTER ĐỂ ANH/CHỊ THEO DÕI:**\n\n`;
      classes.forEach((cls, idx) => {
        reply += `${idx + 1}. **${cls.TenLop}** (${cls.TenKhoaHoc}):\n`;
        reply += `   ⏰ **Lịch học:** ${cls.scheduleSummary}\n`;
        reply += `   👥 **Chỗ trống:** Còn **${cls.ConTrong}/${cls.SucChua}** chỗ\n\n`;
      });
      reply += `👉 Anh/chị hãy đăng nhập vào tài khoản để quản lý lịch học riêng tại mục **"Lịch học của tôi"** nhé!`;
      return reply;
    }

    const hasSessions = member.myUpcomingSessions && member.myUpcomingSessions.length > 0;
    const hasRegisteredCourses = member.myRegisteredCourses && member.myRegisteredCourses.length > 0;

    if (hasSessions || hasRegisteredCourses) {
      let reply = `📅 **LỊCH HỌC CÁ NHÂN CỦA ANH/CHỊ (${member.fullName} - Mã HV: ${member.memberCode}):**\n\n`;
      reply += `Dạ theo dữ liệu hệ thống FitCenter, anh/chị đang tham gia các lớp học với thời khóa biểu cụ thể sau:\n\n`;

      if (hasRegisteredCourses) {
        reply += `📌 **Các lớp đã đăng ký thành công:**\n`;
        member.myRegisteredCourses.forEach((rc, i) => {
          const foundCls = classes.find(c => c.LopHocID === rc.LopHocID);
          const sched = foundCls ? foundCls.scheduleSummary : 'Đang cập nhật lịch chi tiết';
          reply += `• **${rc.TenLop}** (${rc.TenKhoaHoc}): ${sched}\n`;
        });
        reply += `\n`;
      }

      if (hasSessions) {
        reply += `🗓️ **DANH SÁCH CÁC BUỔI HỌC SẮP TỚI:**\n`;
        member.myUpcomingSessions.forEach((s, idx) => {
          const thu = dayOfWeekMap[s.DayOfWeekNum] || 'Thứ';
          const ngay = s.NgayHocFormatted || new Date(s.NgayHoc).toLocaleDateString('vi-VN');
          reply += `${idx + 1}. **${s.TenLop}** (${s.MaLop})\n`;
          reply += `   ⏰ **Thời gian:** ${thu}, ngày **${ngay}** từ **${s.GioBatDau} – ${s.GioKetThuc}**\n`;
          reply += `   📍 **Phòng:** ${s.TenPhong || 'Phòng tập'} | 👨‍🏫 **HLV:** ${s.TenHLV || 'FitCenter HLV'}\n\n`;
        });
      }

      reply += `💡 **Lưu ý:** Nếu anh/chị có việc bận, có thể thao tác **Hủy ca** hoặc **Đổi ca học** tại mục **"Lịch học của tôi"** trên website trước giờ học ít nhất 2 tiếng nhé!`;
      return reply;
    } else {
      let reply = `📅 **THÔNG BÁO LỊCH HỌC CÁ NHÂN (${member.fullName}):**\n\n`;
      reply += `Dạ em kiểm tra trên hệ thống CSDL thì hiện tại tài khoản của anh/chị **chưa đăng ký lớp học nào** hoặc chưa có ca học nào được xếp.\n\n`;
      reply += `🏋️‍♂️ **THỜI KHÓA BIỂU CÁC LỚP HỌC ĐANG MỞ ĐỂ ANH/CHỊ THAM KHẢO & ĐĂNG KÝ:**\n\n`;
      classes.forEach((cls, idx) => {
        reply += `${idx + 1}. **${cls.TenLop}** (${cls.TenKhoaHoc}):\n`;
        reply += `   ⏰ **Lịch học:** ${cls.scheduleSummary}\n`;
        reply += `   👥 **Chỗ trống:** Còn **${cls.ConTrong}/${cls.SucChua}** chỗ\n\n`;
      });
      reply += `👉 Mời anh/chị vào mục **"Gói tập & Khóa học"** để chọn lớp học yêu thích và bấm **Đăng ký trực tuyến** ngay nhé!`;
      return reply;
    }
  }

  // =========================================================================
  // 2. HỎI THỜI GIAN / LỊCH CỦA MỘT KHÓA HỌC CỤ THỂ (VD: Yoga, Boxing, Giảm mỡ)
  // =========================================================================
  if (targetCourse && isAskingTime) {
    let reply = `⏰ **THỜI GIAN & LỊCH HỌC CỤ THỂ CỦA KHÓA: ${targetCourse.TenKhoaHoc.toUpperCase()}**\n\n`;
    reply += `Khóa học kéo dài **${targetCourse.ThoiLuongTuan} tuần** (tổng cộng **${targetCourse.SoBuoi} buổi**). Dưới đây là thời gian biểu chi tiết các lớp đang mở từ CSDL FitCenter:\n\n`;

    if (targetCourse.classes && targetCourse.classes.length > 0) {
      targetCourse.classes.forEach(cls => {
        reply += `📌 **Lớp ${cls.MaLop}: ${cls.TenLop}**\n`;
        if (cls.patterns && cls.patterns.length > 0) {
          const timeGroups = {};
          cls.patterns.forEach(p => {
            const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.phong}-${p.hlv}-${p.ca}`;
            if (!timeGroups[k]) {
              timeGroups[k] = { days: [], ...p };
            }
            timeGroups[k].days.push(p.thu);
          });
          Object.values(timeGroups).forEach(tg => {
            reply += `   🗓️ **Lịch học:** ${tg.days.join(' & ')} hàng tuần\n`;
            reply += `   ⏱️ **Khung giờ:** ${tg.gioBatDau} – ${tg.gioKetThuc} (Buổi ${tg.ca})\n`;
            reply += `   📍 **Địa điểm:** ${tg.phong} | 👨‍🏫 **HLV phụ trách:** ${tg.hlv}\n`;
          });
        } else {
          reply += `   ⏱️ ${cls.scheduleSummary}\n`;
        }
        reply += `   👥 **Tình trạng:** Sức chứa ${cls.SucChua} học viên (Hiện còn **${cls.ConTrong} chỗ trống**)\n\n`;
      });
    } else {
      reply += `Hiện tại khóa học đang chuẩn bị mở đợt tuyển sinh mới, mời anh/chị theo dõi website để nhận thông báo sớm nhất ạ.\n\n`;
    }

    reply += `💰 **Học phí trọn khóa:** ${formatCurrency(targetCourse.Gia)}\n`;
    reply += `👉 Anh/chị có thể vào mục **"Gói tập & Khóa học"** trên website để chọn khung giờ phù hợp và bấm **Đăng ký trực tuyến** ngay hôm nay nhé!`;
    return reply;
  }

  // =========================================================================
  // 3. HỎI THÔNG TIN / NỘI DUNG / HỌC PHÍ MỘT KHÓA HỌC CỤ THỂ
  // =========================================================================
  if (targetCourse) {
    let reply = `🎓 **THÔNG TIN CHI TIẾT KHÓA HỌC: ${targetCourse.TenKhoaHoc.toUpperCase()}**\n\n`;
    reply += `📝 **Nội dung & Mục tiêu:** ${targetCourse.MoTa}\n`;
    reply += `⏱️ **Thời lượng:** ${targetCourse.ThoiLuongTuan} tuần (${targetCourse.SoBuoi} buổi học chuyên sâu)\n`;
    reply += `💰 **Học phí trọn gói:** ${formatCurrency(targetCourse.Gia)}\n`;
    reply += `📋 **Điều kiện tham gia:** ${targetCourse.DieuKienThamGia || 'Không yêu cầu đặc biệt'}\n\n`;

    reply += `🗓️ **CÁC LỚP & KHUNG GIỜ ĐANG MỞ:**\n`;
    if (targetCourse.classes && targetCourse.classes.length > 0) {
      targetCourse.classes.forEach(cls => {
        reply += `• **${cls.TenLop}** (${cls.MaLop}):\n`;
        if (cls.patterns && cls.patterns.length > 0) {
          const timeGroups = {};
          cls.patterns.forEach(p => {
            const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.phong}-${p.hlv}-${p.ca}`;
            if (!timeGroups[k]) timeGroups[k] = { days: [], ...p };
            timeGroups[k].days.push(p.thu);
          });
          Object.values(timeGroups).forEach(tg => {
            reply += `  - Lịch: **${tg.days.join(' & ')}** (${tg.gioBatDau} – ${tg.gioKetThuc}, Buổi ${tg.ca})\n`;
            reply += `  - Phòng: ${tg.phong} | HLV: ${tg.hlv} | Còn ${cls.ConTrong}/${cls.SucChua} chỗ\n`;
          });
        } else {
          reply += `  - ${cls.scheduleSummary}\n`;
        }
      });
    } else {
      reply += `• Lịch khai giảng khóa mới đang được cập nhật.\n`;
    }

    reply += `\n👉 Anh/chị có thể bấm xem chi tiết hoặc đăng ký trực tiếp trên website tại tab **Gói tập & Khóa học** ạ!`;
    return reply;
  }

  // =========================================================================
  // 4. LỌC LỚP THEO BUỔI (Buổi tối / Buổi sáng / Buổi chiều)
  // =========================================================================
  if (isAskingShift && (isAskingTime || has('lop', 'khoa', 'hoc', 'tap', 'co', 'mon', 'lich'))) {
    const targetShift = isAskingEvening ? 'Tối' : (isAskingMorning ? 'Sáng' : 'Chiều');
    const matchedClasses = classes.filter(cls => cls.shifts && cls.shifts.includes(targetShift));

    let reply = `🌙 **DANH SÁCH CÁC LỚP HỌC BUỔI ${targetShift.toUpperCase()} TẠI FITCENTER:**\n\n`;
    if (matchedClasses.length > 0) {
      reply += `Dạ FitCenter hiện đang có **${matchedClasses.length} lớp học** vào khung giờ buổi ${targetShift.toLowerCase()} để anh/chị lựa chọn:\n\n`;
      matchedClasses.forEach((cls, idx) => {
        reply += `${idx + 1}. **${cls.TenLop}** (Khóa: ${cls.TenKhoaHoc})\n`;
        const shiftPatterns = cls.patterns.filter(p => p.ca === targetShift);
        const timeGroups = {};
        shiftPatterns.forEach(p => {
          const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.phong}-${p.hlv}`;
          if (!timeGroups[k]) timeGroups[k] = { days: [], ...p };
          timeGroups[k].days.push(p.thu);
        });
        Object.values(timeGroups).forEach(tg => {
          reply += `   ⏰ **Khung giờ:** ${tg.days.join(' & ')} từ **${tg.gioBatDau} – ${tg.gioKetThuc}**\n`;
          reply += `   📍 **Phòng:** ${tg.phong} | 👨‍🏫 **HLV:** ${tg.hlv}\n`;
          reply += `   👥 **Chỗ trống:** Còn **${cls.ConTrong}** chỗ (Sĩ số tối đa: ${cls.SucChua})\n\n`;
        });
      });
      reply += `👉 Khung giờ buổi ${targetShift.toLowerCase()} rất thuận tiện cho người đi làm và sinh viên. Anh/chị vào tab **Gói tập & Khóa học** để đăng ký giữ chỗ ngay nhé!`;
    } else {
      reply += `Dạ hiện tại chưa có lớp nào mở vào buổi ${targetShift.toLowerCase()}. Mời anh/chị tham khảo các khung giờ khác tại mục Thời khóa biểu trên website nhé!`;
    }
    return reply;
  }

  // =========================================================================
  // 4B. LỌC LỚP THEO THỨ TRONG TUẦN (Thứ 2, Thứ 3, Thứ 4, Thứ 5, Thứ 6, Cuối tuần)
  // =========================================================================
  let targetDay = null;
  if (has('thu 2', 't2', 'thu hai')) targetDay = 'Thứ 2';
  else if (has('thu 3', 't3', 'thu ba')) targetDay = 'Thứ 3';
  else if (has('thu 4', 't4', 'thu tu')) targetDay = 'Thứ 4';
  else if (has('thu 5', 't5', 'thu nam')) targetDay = 'Thứ 5';
  else if (has('thu 6', 't6', 'thu sau')) targetDay = 'Thứ 6';
  else if (has('thu 7', 't7', 'thu bay')) targetDay = 'Thứ 7';
  else if (has('chu nhat', 'cn')) targetDay = 'Chủ nhật';

  if (targetDay && (isAskingTime || has('lop', 'khoa', 'hoc', 'co', 'tap', 'mon', 'lich'))) {
    const matchedDayClasses = classes.filter(cls => cls.days && cls.days.includes(targetDay));
    let reply = `📅 **CÁC LỚP HỌC VÀO ${targetDay.toUpperCase()} TẠI FITCENTER:**\n\n`;
    if (matchedDayClasses.length > 0) {
      reply += `Dạ vào **${targetDay}**, FitCenter có các lớp học và khung giờ cụ thể sau:\n\n`;
      matchedDayClasses.forEach((cls, idx) => {
        const dayPatterns = cls.patterns.filter(p => p.thu === targetDay);
        dayPatterns.forEach(dp => {
          reply += `${idx + 1}. **${cls.TenLop}** (${cls.TenKhoaHoc})\n`;
          reply += `   ⏰ **Khung giờ:** ${dp.gioBatDau} – ${dp.gioKetThuc} (Buổi ${dp.ca})\n`;
          reply += `   📍 **Phòng:** ${dp.phong} | 👨‍🏫 **HLV:** ${dp.hlv}\n`;
          reply += `   👥 **Chỗ trống:** Còn **${cls.ConTrong}/${cls.SucChua}** chỗ\n\n`;
        });
      });
      reply += `👉 Anh/chị có thể đăng ký trực tuyến tại mục **Gói tập & Khóa học** trên website nhé!`;
    } else {
      reply += `Dạ hiện tại vào **${targetDay}** trung tâm chưa xếp lớp học nhóm. Tuy nhiên phòng Gym vẫn mở cửa tự do từ 05:30 – 21:30 để anh/chị tự tập luyện ạ!`;
    }
    return reply;
  }

  // =========================================================================
  // 5. THỜI KHÓA BIỂU TỔNG HỢP / THỜI GIAN CÁC KHÓA HỌC
  // =========================================================================
  if (isAskingTime || has('thoi khoa bieu', 'tkb', 'lich cac lop', 'lich tap chung', 'khi nao co lop')) {
    let reply = `⏰ **THỜI KHÓA BIỂU & KHUNG GIỜ CỤ THỂ TẤT CẢ CÁC LỚP HỌC:**\n\n`;
    reply += `FitCenter xin gửi đến anh/chị lịch học chi tiết đang hoạt động dựa trên dữ liệu hệ thống:\n\n`;

    courses.forEach((c, idx) => {
      reply += `🏋️‍♂️ **${idx + 1}. Khóa ${c.TenKhoaHoc}** (${c.ThoiLuongTuan} tuần - ${c.SoBuoi} buổi - ${formatCurrency(c.Gia)}):\n`;
      if (c.classes && c.classes.length > 0) {
        c.classes.forEach(cls => {
          const timeGroups = {};
          (cls.patterns || []).forEach(p => {
            const k = `${p.gioBatDau}-${p.gioKetThuc}-${p.ca}`;
            if (!timeGroups[k]) timeGroups[k] = { days: [], ...p };
            timeGroups[k].days.push(p.thu);
          });
          const scheduleStr = Object.values(timeGroups)
            .map(tg => `${tg.days.join(' & ')} (${tg.gioBatDau} – ${tg.gioKetThuc}, Buổi ${tg.ca})`)
            .join('; ');
          reply += `   • **${cls.TenLop}**: ${scheduleStr} | Phòng: ${cls.TenPhong} | Còn **${cls.ConTrong}** chỗ\n`;
        });
      } else {
        reply += `   • Đang cập nhật lớp mới.\n`;
      }
      reply += `\n`;
    });

    reply += `👉 Anh/chị có thể xem chi tiết từng buổi học hoặc đăng ký tại tab **Gói tập & Khóa học** hoặc **Thời khóa biểu** trên website nhé!`;
    return reply;
  }

  // =========================================================================
  // 6. TẤT CẢ KHÓA HỌC (Overview)
  // =========================================================================
  if (has('khoa hoc', 'khoa dao tao', 'lop hoc', 'co lop nao', 'co khoa nao', 'cac khoa hoc')) {
    let reply = `🎓 **DANH SÁCH CÁC KHÓA ĐÀO TẠO CHUYÊN SÂU TẠI FITCENTER:**\n\n`;
    courses.forEach((c, idx) => {
      reply += `${idx + 1}. **${c.TenKhoaHoc}** (${c.ThoiLuongTuan} tuần / ${c.SoBuoi} buổi)\n`;
      reply += `   • **Học phí:** ${formatCurrency(c.Gia)}\n`;
      reply += `   • **Nội dung:** ${c.MoTa}\n`;
      reply += `   • **Điều kiện:** ${c.DieuKienThamGia || 'Không yêu cầu'}\n`;
      if (c.classes && c.classes.length > 0) {
        const classNames = c.classes.map(cls => `${cls.TenLop} (Còn ${cls.ConTrong} chỗ)`).join(', ');
        reply += `   • **Lớp đang mở:** ${classNames}\n`;
      }
      reply += `\n`;
    });
    reply += `👉 Anh/chị có thể hỏi em cụ thể về **thời gian học**, **nội dung** của từng khóa hoặc bấm **Đăng ký trực tuyến** tại mục Gói tập & Khóa học nhé!`;
    return reply;
  }

  // =========================================================================
  // 7. BẢNG GIÁ GÓI TẬP (Membership)
  // =========================================================================
  if (
    has('bang gia', 'gia the', 'membership', 'the tap', 'bao nhieu tien', 'phi tap') ||
    (has('goi tap', 'goi') && has('gia', 'phi', 'tien', 'bao nhieu', 'mua'))
  ) {
    let reply = '🏋️‍♂️ **BẢNG GIÁ CÁC GÓI TẬP THẺ HỘI VIÊN TẠI FITCENTER:**\n\n';
    if (context?.plans && context.plans.length > 0) {
      context.plans.forEach((p, idx) => {
        reply += `${idx + 1}. **${p.TenGoiTap}** (Thời hạn ${p.ThoiHanNgay} ngày): **${formatCurrency(p.Gia)}**\n`;
        if (p.MoTa) reply += `   *${p.MoTa}*\n`;
      });
    }
    reply += `\n✨ **Quyền lợi hội viên:** Tập luyện không giới hạn khung giờ, miễn phí tủ khóa thông minh, phòng tắm nóng lạnh và đo chỉ số InBody định kỳ.\n`;
    reply += `👉 Anh/chị có thể đăng ký thẻ tập trực tiếp tại website trong mục **Gói tập & Khóa học** ạ.`;
    return reply;
  }

  // =========================================================================
  // 8. ĐĂNG KÝ TẬP THỬ / TRẢI NGHIỆM MIỄN PHÍ
  // =========================================================================
  if (has('tap thu', 'trai nghiem', 'dung thu', 'free trial', 'thu 1 buoi', 'thu mien phi')) {
    return (
      `🎁 **CHÍNH SÁCH ĐĂNG KÝ TẬP THỬ MIỄN PHÍ TẠI FITCENTER:**\n\n` +
      `Dạ **CÓ** ạ! FitCenter luôn chào đón quý khách với chương trình **Đăng ký tập thử trải nghiệm 1 buổi hoàn toàn MIỄN PHÍ (Free Trial)** dành cho khách hàng mới:\n\n` +
      `✨ **Quyền lợi đặc biệt khi tập thử:**\n` +
      `1. **Đo chỉ số InBody miễn phí:** Phân tích tỷ lệ cơ, mỡ, nước và mức trao đổi chất cơ bản.\n` +
      `2. **Có Huấn luyện viên (PT) hướng dẫn:** Hướng dẫn các bài tập khởi động, cách sử dụng trang thiết bị chuẩn form, hạn chế tối đa chấn thương.\n` +
      `3. **Trải nghiệm toàn bộ tiện ích:** Tự do tập tại khu Gym, sử dụng tủ khóa từ thông minh và phòng tắm nóng lạnh cao cấp.\n\n` +
      `👉 **Cách thức nhận vé tập thử:**\n` +
      `- Đến trực tiếp Quầy lễ tân FitCenter tại: **123 Nguyễn Văn Linh, Đà Nẵng**\n` +
      `- Hoặc gọi Hotline: **0900 000 001** để nhân viên xếp lịch trải nghiệm ngay trong ngày anh/chị nhé!`
    );
  }

  // =========================================================================
  // 9. HIỆU QUẢ TẬP LUYỆN / BAO LÂU CÓ KẾT QUẢ / BMI
  // =========================================================================
  if (
    has('bao lau', 'hieu qua', 'ket qua', 'bao nhieu ngay', 'bao lau thi', 'co ket qua') ||
    (has('giam mo', 'giam can', 'tang co') && has('lau', 'thoi gian', 'nhanh')) ||
    (has('bmi') && has('tap', 'lau', 'tu van'))
  ) {
    let bmiIntro = '';
    if (member && member.bmi) {
      bmiIntro = `Dựa trên thể trạng của anh/chị (${member.fullName} - Cao ${member.height}cm, Nặng ${member.weight}kg, **BMI = ${member.bmi}** - *${member.bmiCategory}*):\n\n`;
    }

    return (
      `⏱️ **ƯỚC TÍNH THỜI GIAN TẬP LUYỆN ĐẠT HIỆU QUẢ RÕ RỆT:**\n\n` +
      bmiIntro +
      `Một lộ trình rèn luyện bài bản tại FitCenter sẽ mang lại biến chuyển rõ rệt qua **3 giai đoạn cụ thể**:\n\n` +
      `🌱 **Giai đoạn 1 (2 – 4 tuần đầu - Thích nghi & Tăng thể lực):**\n` +
      `- Cơ thể thích ứng với vận động, hết hụt hơi, giảm cảm giác mỏi mệt hàng ngày.\n` +
      `- Giấc ngủ sâu hơn, tinh thần sảng khoái, giảm 1 – 2kg mỡ thừa ban đầu hoặc tăng trương lực cơ bắp.\n\n` +
      `🔥 **Giai đoạn 2 (6 – 8 tuần - Thay đổi vóc dáng nhìn thấy rõ):**\n` +
      `- Số đo vòng eo, đùi, bắp tay thon gọn rõ rệt (giảm 3 – 5cm).\n` +
      `- Cân nặng giảm 3 – 5kg mỡ (nếu theo lộ trình giảm mỡ) hoặc cơ bắp săn chắc, nét cơ rõ ràng.\n` +
      `- Khóa học **"Giảm mỡ 8 tuần"** tại FitCenter được thiết kế tối ưu nhất cho giai đoạn này!\n\n` +
      `🏆 **Giai đoạn 3 (12 tuần / 3 tháng trở lên - Chuyển hóa toàn diện):**\n` +
      `- Tỷ lệ mỡ về ngưỡng chuẩn vận động viên (Nam: 12-15%, Nữ: 18-22%), vóc dáng cân đối lâu dài.\n` +
      `- Hình thành thói quen rèn luyện tự nhiên, sức mạnh và sức bền tăng vượt trội.\n\n` +
      `💡 **3 Yếu tố cốt lõi để đạt kết quả:** Duy trì 3 – 4 buổi/tuần, dinh dưỡng chiếm 70% thành công và nên đo InBody định kỳ mỗi tháng anh/chị nhé!`
    );
  }

  // =========================================================================
  // 10. ĐỘI NGŨ HUẤN LUYỆN VIÊN (PT / HLV)
  // =========================================================================
  if (has('huan luyen vien', 'hlv', 'pt', 'doi ngu', 'thay day', 'co day')) {
    let reply = '🏆 **ĐỘI NGŨ HUẤN LUYỆN VIÊN TẠI FITCENTER:**\n\n';
    if (context?.trainers && context.trainers.length > 0) {
      const seen = new Set();
      context.trainers.forEach(t => {
        if (!seen.has(t.HoTen)) {
          seen.add(t.HoTen);
          reply += `• **HLV ${t.HoTen}**: Chuyên môn **${t.TenChuyenMon || 'Thể hình'}**, kinh nghiệm **${t.KinhNghiemNam || 3} năm**.\n  *${t.TieuSu || 'Nhiệt tình, tận tâm và giàu kinh nghiệm.'}*\n\n`;
        }
      });
    }
    reply += '👉 Toàn bộ HLV tại FitCenter đều có chứng chỉ đào tạo chuyên nghiệp và luôn đồng hành sát sao trong từng buổi tập.';
    return reply;
  }

  // =========================================================================
  // 11. QUY ĐỊNH HỦY / ĐỔI CA
  // =========================================================================
  if (
    has('huy ca', 'doi ca', 'chuyen ca', 'nghi hoc', 'doi gio') ||
    (has('huy', 'doi', 'chuyen') && has('lich', 'buoi', 'lop'))
  ) {
    return (
      '📋 **QUY ĐỊNH HỦY & ĐỔI CA HỌC TẠI FITCENTER:**\n\n' +
      '1. Hội viên được phép **Hủy ca** hoặc **Đổi sang ca học khác** trước giờ bắt đầu ít nhất **2 tiếng**.\n' +
      '2. Thao tác hoàn toàn trực tuyến tại mục **"Lịch học của tôi"** trên website.\n' +
      '3. Nếu ca học mới còn chỗ trống, hệ thống sẽ xác nhận ngay lập tức mà không phát sinh chi phí.'
    );
  }

  // =========================================================================
  // 12. MUA NƯỚC UỐNG / WHEY / SẢN PHẨM
  // =========================================================================
  if (
    has('nuoc uong', 'nuoc khoang', 'whey', 'gang tay', 'tham yoga', 'binh nuoc', 'do uong') ||
    (has('mua', 'ban') && has('nuoc', 'whey', 'san pham', 'quay'))
  ) {
    return (
      '🛍️ **QUY ĐỊNH MUA SẢN PHẨM TẠI FITCENTER:**\n\n' +
      'Các sản phẩm như Nước giải khát, Nước tăng lực, Whey Protein, Thảm Yoga, Găng tay tập... **chỉ bán trực tiếp tại Quầy lễ tân** thông qua nhân viên để đảm bảo chất lượng và xuất hóa đơn VAT. Website hiện tập trung phục vụ đăng ký thẻ tập và khóa học trực tuyến ạ.'
    );
  }

  // =========================================================================
  // 13. THÔNG TIN TRUNG TÂM / GIỜ MỞ CỬA / ĐỊA CHỈ
  // =========================================================================
  if (
    has('dia chi', 'hotline', 'lien he', 'mo cua', 'dong cua', 'gio lam viec', 'gio mo cua') ||
    (has('o dau', 'o cho nao') && has('trung tam', 'phong tap', 'fitcenter', 'gym'))
  ) {
    return (
      '🏢 **THÔNG TIN TRUNG TÂM THỂ HÌNH FITCENTER:**\n\n' +
      '⏰ **Giờ mở cửa:** 05:30 – 21:30 hàng ngày (kể cả Thứ 7, Chủ nhật và ngày lễ)\n' +
      '📍 **Địa chỉ:** 123 Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng\n' +
      '📞 **Hotline:** 0900 000 001 | Email: lienhe@fitcenter.vn\n' +
      '🏋️ **Cơ sở vật chất:** Hệ thống máy móc hiện đại, phòng Yoga cách âm, phòng Boxing chuẩn thi đấu, tủ khóa từ bảo mật và phòng tắm nóng lạnh miễn phí.'
    );
  }

  // =========================================================================
  // 14. CHÀO HỎI & CẢM ƠN
  // =========================================================================
  if (has('chao', 'hello', 'hi', 'xin chao', 'em oi', 'bot oi', 'ad oi')) {
    return 'Dạ em chào anh/chị! 👋 Em là Trợ lý AI FitCenter. Em có thể hỗ trợ anh/chị giải đáp về các gói tập, chi tiết khóa học, thời gian học các lớp cụ thể, đăng ký tập thử miễn phí hoặc tư vấn lộ trình rèn luyện hiệu quả ạ!';
  }

  if (has('cam on', 'thank', 'da cam on', 'ok em', 'tuyet voi')) {
    return 'Dạ không có gì ạ! FitCenter rất vui được đồng hành cùng anh/chị trên hành trình nâng cao sức khỏe và vóc dáng. Nếu cần thêm thông tin gì, anh/chị cứ nhắn em nhé! Chúc anh/chị một ngày tràn đầy năng lượng! 💪';
  }

  // =========================================================================
  // 15. TƯ VẤN THỂ HÌNH & DINH DƯỠNG
  // =========================================================================
  if (has('dinh duong', 'an gi', 'uong gi', 'protein', 'calo', 'tang can', 'thuc don', 'nghi ngoi')) {
    return (
      `🥗 **LỜI KHUYÊN DINH DƯỠNG & RÈN LUYỆN TỪ FITCENTER:**\n\n` +
      `1. **Nguyên tắc calo:** Muốn giảm mỡ cần duy trì thâm hụt calo lành mạnh (300 - 500 kcal/ngày). Muốn tăng cơ cần thặng dư calo giàu đạm.\n` +
      `2. **Chất đạm (Protein):** Bổ sung 1.6 – 2.0g protein/kg trọng lượng cơ thể từ ức gà, bò, cá, trứng, đậu hoặc Whey Protein.\n` +
      `3. **Nước & Giấc ngủ:** Uống tối thiểu 2 – 2.5 lít nước mỗi ngày và ngủ đủ 7 – 8 tiếng để cơ bắp phục hồi tối ưu.\n\n` +
      `👉 Khi tham gia khóa học tại FitCenter, HLV sẽ đo chỉ số InBody và tư vấn thực đơn chi tiết phù hợp với thể trạng riêng của anh/chị!`
    );
  }

  // =========================================================================
  // 16. BẤT KỲ CÂU HỎI NGOÀI PHẠM VI FITCENTER
  // =========================================================================
  return OUT_OF_SCOPE_MESSAGE;
}

/**
 * Hàm điều phối chính: Kết hợp Gemini API và Dữ liệu CSDL FitCenter
 */
async function processFitCenterChat({ message, memberId, db }) {
  const cleanMsg = (message || '').trim();
  if (!cleanMsg) {
    return {
      success: true,
      reply: 'Dạ em chào anh/chị! Em có thể giúp gì cho anh/chị về gói tập, thông tin khóa học, thời gian học cụ thể hay tư vấn lộ trình tập luyện tại FitCenter ạ?'
    };
  }

  // Lấy dữ liệu context thời gian thực từ CSDL
  const context = await getFitCenterDataContext(db, memberId);

  // Thử gọi qua Google Gemini API nếu có cấu hình GEMINI_API_KEY
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '') {
    const systemPrompt = buildGeminiSystemPrompt(context);
    const geminiReply = await callGeminiApi(cleanMsg, systemPrompt);
    if (geminiReply) {
      return {
        success: true,
        reply: geminiReply,
        source: 'gemini-ai'
      };
    }
  }

  // Fallback engine: Phân tích theo CSDL nội bộ
  const fallbackReply = smartLocalAIResponse(cleanMsg, context);
  return {
    success: true,
    reply: fallbackReply,
    source: 'fitcenter-knowledge-base'
  };
}

module.exports = {
  processFitCenterChat,
  getFitCenterDataContext,
  smartLocalAIResponse,
  OUT_OF_SCOPE_MESSAGE
};
