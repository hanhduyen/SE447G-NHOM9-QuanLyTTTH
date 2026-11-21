/**
 * Dịch vụ Trợ lý AI FitCenter tích hợp Google Gemini API
 * Dựa trên dữ liệu thực tế từ 28 bảng CSDL QuanLyTrungTamTheHinh
 */

const OUT_OF_SCOPE_MESSAGE = 'Dạ em đã ghi nhận câu hỏi của anh/chị. Anh/chị có thể hỏi em những câu hỏi liên quan đến hệ thống fitcenter thôi ạ. Những câu hỏi này vược ngoài phạm vi của em ạ.';

/**
 * Thu thập toàn bộ ngữ cảnh dữ liệu của Trung tâm FitCenter từ MySQL
 */
async function getFitCenterDataContext(db, memberId) {
  try {
    // 1. Thông tin trung tâm
    const [centerInfo] = await db.query('SELECT LoaiMuc, TieuDe, NoiDung FROM ThongTinTrungTam WHERE CongBo = 1 ORDER BY ThuTu ASC');

    // 2. Danh sách gói tập
    const [plans] = await db.query('SELECT TenGoiTap, Gia, ThoiHanNgay, MoTa FROM GoiTap WHERE TrangThai = 1');

    // 3. Danh sách khóa học
    const [courses] = await db.query('SELECT TenKhoaHoc, Gia, SoBuoi, MoTa FROM KhoaHoc WHERE TrangThai = 1');

    // 4. Danh sách huấn luyện viên
    const [trainers] = await db.query(`
      SELECT tk.HoTen, cm.TenChuyenMon, hlv.KinhNghiemNam, hlv.TieuSu
      FROM HuanLuyenVien hlv
      JOIN TaiKhoan tk ON hlv.HuanLuyenVienID = tk.TaiKhoanID
      LEFT JOIN HLV_ChuyenMon hcm ON hlv.HuanLuyenVienID = hcm.HuanLuyenVienID
      LEFT JOIN ChuyenMon cm ON hcm.ChuyenMonID = cm.ChuyenMonID
      WHERE hlv.TrangThaiHoatDong = 1
    `);

    // 5. Danh sách lớp học đang mở
    const [classes] = await db.query(`
      SELECT l.TenLop, kh.TenKhoaHoc, p.TenPhong, l.SucChua
      FROM LopHoc l
      JOIN KhoaHoc kh ON l.KhoaHocID = kh.KhoaHocID
      JOIN Phong p ON l.PhongID = p.PhongID
      WHERE l.CongBo = 1
    `);

    // 6. Ngữ cảnh cá nhân của học viên nếu có memberId
    let memberContext = null;
    if (memberId) {
      const [members] = await db.query(`
        SELECT t.HoTen, t.Email, t.SoDienThoai, k.MaKhachHang, k.ChieuCao, k.CanNang, k.MucTieu AS MucTieuLuyenTap
        FROM TaiKhoan t
        JOIN KhachHang k ON t.TaiKhoanID = k.KhachHangID
        WHERE t.TaiKhoanID = ?
      `, [memberId]);

      if (members.length > 0) {
        const m = members[0];
        // Gói tập hiện tại
        const [memberships] = await db.query(`
          SELECT g.TenGoiTap, d.NgayHetHan, DATEDIFF(d.NgayHetHan, CURRENT_DATE) AS days_left
          FROM DangKyGoiTap d
          JOIN GoiTap g ON d.GoiTapID = g.GoiTapID
          WHERE d.KhachHangID = ? AND d.TrangThai = 1
          ORDER BY d.NgayHetHan DESC LIMIT 1
        `, [memberId]);

        // Đánh giá InBody gần nhất
        const [progress] = await db.query(`
          SELECT kq.CanNang, kq.TyLeMo, kq.MucDoHoanThanh, kq.NhanXet, kq.NgayCapNhat
          FROM KetQuaHocVien kq
          JOIN DangKyKhoaHoc dk ON kq.DangKyID = dk.DangKyID
          WHERE dk.KhachHangID = ?
          ORDER BY kq.NgayCapNhat DESC LIMIT 1
        `, [memberId]);

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
          latestInBody: progress[0] || null
        };
      }
    }

    return {
      centerInfo,
      plans,
      courses,
      trainers,
      classes,
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
Nhiệm vụ của bạn là hỗ trợ, tư vấn khách hàng và hội viên về các dịch vụ, gói tập, lịch học, huấn luyện viên, dinh dưỡng, ước tính thời gian hiệu quả tập luyện và các chính sách của trung tâm FitCenter.

Tác phong của bạn:
- Xưng hô "em" và gọi người dùng là "anh/chị".
- Giọng điệu thân thiện, chu đáo, nhiệt tình, chuyên nghiệp, sử dụng biểu tượng cảm xúc (emoji) phù hợp.
- Trình bày mạch lạc, có cấu trúc bullet point rõ ràng.

DƯỚI ĐÂY LÀ DỮ LIỆU CHÍNH XÁC VỀ TRUNG TÂM FITCENTER TỪ CƠ SỞ DỮ LIỆU:
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
        prompt += `- ${p.TenGoiTap} (Thời hạn ${p.ThoiHanNgay} ngày): ${price}. ${p.MoTa || ''}\n`;
      });
    }

    // Khóa học
    if (context.courses && context.courses.length > 0) {
      prompt += `\n3. CÁC KHÓA ĐÀO TẠO CHUYÊN SÂU (COURSES):\n`;
      context.courses.forEach(c => {
        const price = Number(c.Gia).toLocaleString('vi-VN') + ' đ';
        prompt += `- Khóa ${c.TenKhoaHoc} (Quy mô ${c.SoBuoi} buổi): Học phí ${price}. Mô tả: ${c.MoTa || ''}\n`;
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
        prompt += `- Đánh giá InBody gần nhất: Cân nặng ${mc.latestInBody.CanNang}kg, Tỷ lệ mỡ ${mc.latestInBody.TyLeMo}%, Hoàn thành bài tập ${mc.latestInBody.MucDoHoanThanh}%. HLV nhận xét: "${mc.latestInBody.NhanXet || ''}"\n`;
      }
    }
  }

  prompt += `
QUY ĐỊNH VÀ CHÍNH SÁCH BẮT BUỘC CỦA FITCENTER:
- ĐỔI CA / HỦY CA HỌC: Hội viên được phép tự đổi ca hoặc hủy ca học trên website (tại mục "Lịch học của tôi") trước giờ bắt đầu buổi học ít nhất 2 tiếng.
- MUA HÀNG & NƯỚC UỐNG / WHEY: Các sản phẩm nước giải khát, Whey Protein, găng tay, khăn tập chỉ được bán trực tiếp tại Quầy lễ tân trung tâm qua nhân viên, không bán trực tuyến để đảm bảo chất lượng.

CÁC BỘ CÂU HỎI QUAN TRỌNG ĐẶC BIỆT CẦN TRẢ LỜI CHUẨN XÁC:
1. "CÓ THỂ ĐĂNG KÝ TẬP THỬ KHÔNG?" / "CÓ CHO TẬP THỬ KHÔNG?":
   - Trả lời nhiệt tình: Có! FitCenter luôn có chương trình **Đăng ký tập thử trải nghiệm 1 buổi hoàn toàn MIỄN PHÍ (Free Trial)** hoặc gói trải nghiệm 3 ngày cho khách hàng mới.
   - Quyền lợi khi tập thử: Đo chỉ số thể chất InBody miễn phí, có Huấn luyện viên hướng dẫn sử dụng máy tập và tư vấn lộ trình trong buổi đầu, sử dụng miễn phí phòng tắm nước nóng và tủ khóa từ thông minh.
   - Hướng dẫn nhận vé tập thử: Mời khách hàng đến trực tiếp Quầy lễ tân FitCenter tại 123 Nguyễn Văn Linh, Đà Nẵng hoặc gọi Hotline 0900 000 001 để nhận thẻ trải nghiệm ngay trong ngày.

2. "ƯỚC TÍNH TẬP LUYỆN BAO LÂU THÌ CÓ HIỆU QUẢ / KẾT QUẢ?" (Đặc biệt khi khách đã có hoặc hỏi về chỉ số BMI):
   - Phân tích chỉ số BMI: Nếu khách có sẵn BMI trong hồ sơ hoặc nêu chiều cao/cân nặng, hãy nhắc đến BMI của họ và đưa ra lộ trình thời gian 3 giai đoạn rõ ràng:
     * Giai đoạn 1 (2 - 4 tuần đầu - Thích nghi & Nâng cao thể lực): Cải thiện rõ rệt sức bền, giấc ngủ sâu hơn, tinh thần sảng khoái, giảm 1 - 2kg mỡ thừa ban đầu (nếu giảm cân) hoặc tăng trương lực cơ (nếu tăng cân).
     * Giai đoạn 2 (6 - 8 tuần - Biến chuyển vóc dáng rõ rệt): Vòng eo, bắp tay, đùi thon gọn hoặc cơ bắp săn chắc rõ nét (giảm 3 - 5kg mỡ đối với người thừa cân nếu theo đúng giáo án). Khóa "Giảm mỡ 8 tuần" của FitCenter được thiết kế chuẩn cho giai đoạn này!
     * Giai đoạn 3 (12 tuần / 3 tháng trở lên - Thay đổi vóc dáng toàn diện - Body Transformation): Cơ thể chuyển hóa tối ưu, chỉ số mỡ giảm sâu về mức chuẩn vận động viên, hình thành thói quen rèn luyện tự nhiên và bền vững.
   - 3 yếu tố quyết định hiệu quả: Duy trì 3 - 4 buổi/tuần, dinh dưỡng chiếm 70% thành công (thâm hụt calo lành mạnh hoặc bổ sung đủ protein, uống 2 - 2.5L nước/ngày) và nên tham gia lớp có HLV để được đo InBody định kỳ mỗi tháng.

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
 * Bộ xử lý Tri thức cục bộ (Local Knowledge Base) làm Fallback thông minh
 * Đảm bảo 100% hoạt động dựa trên CSDL khi chưa cấu hình API Key hoặc khi mạng gián đoạn
 */
function localRuleBasedResponse(userMessage, context) {
  const q = (userMessage || '').trim().toLowerCase();

  // 1. Câu hỏi về Đăng ký tập thử / Trải nghiệm thử
  if (q.includes('thử') || q.includes('trải nghiệm') || q.includes('dùng thử') || q.includes('tập thử')) {
    return (
      `🎁 **CHÍNH SÁCH ĐĂNG KÝ TẬP THỬ TẠI FITCENTER:**\n\n` +
      `Dạ **CÓ** ạ! FitCenter luôn chào đón quý khách với chương trình **Đăng ký tập thử trải nghiệm 1 buổi hoàn toàn MIỄN PHÍ (Free Trial)** dành cho khách hàng mới:\n\n` +
      `✨ **Quyền lợi khi trải nghiệm tập thử:**\n` +
      `1. **Đo chỉ số InBody miễn phí:** Phân tích chi tiết lượng cơ, lượng mỡ và nước trong cơ thể.\n` +
      `2. **Có Huấn luyện viên (PT) hướng dẫn:** Hướng dẫn các bài tập khởi động, cách sử dụng máy tập chuẩn form, tránh chấn thương.\n` +
      `3. **Trải nghiệm toàn bộ tiện ích:** Tự do tập tại khu Gym, sử dụng tủ khóa từ thông minh và phòng tắm nóng lạnh cao cấp.\n\n` +
      `👉 **Cách thức nhận vé tập thử:**\n` +
      `- Đến trực tiếp Quầy lễ tân tại: **123 Nguyễn Văn Linh, Đà Nẵng**\n` +
      `- Hoặc liên hệ Hotline: **0900 000 001** để nhân viên xếp lịch trải nghiệm ngay hôm nay anh/chị nhé!`
    );
  }

  // 2. Câu hỏi về Hiệu quả tập luyện / Bao lâu thì có kết quả / Lộ trình theo BMI
  if (
    q.includes('bao lâu') ||
    q.includes('hiệu quả') ||
    q.includes('kết quả') ||
    q.includes('bao nhiêu ngày') ||
    q.includes('bao lâu thì') ||
    q.includes('có kết quả') ||
    q.includes('giảm cân') ||
    q.includes('tăng cơ') ||
    (q.includes('bmi') && (q.includes('tập') || q.includes('lâu')))
  ) {
    const mc = context?.memberContext;
    let bmiIntro = '';
    if (mc && mc.bmi) {
      bmiIntro = `Dựa trên thể trạng của anh/chị (${mc.fullName} - Cao ${mc.height}cm, Nặng ${mc.weight}kg, **BMI = ${mc.bmi}** - *${mc.bmiCategory}*):\n\n`;
    }

    return (
      `⏱️ **ƯỚC TÍNH THỜI GIAN TẬP LUYỆN ĐẠT HIỆU QUẢ RÕ RỆT:**\n\n` +
      bmiIntro +
      `Thông thường, một lộ trình tập luyện bài bản tại FitCenter sẽ mang lại kết quả qua **3 giai đoạn cụ thể** như sau:\n\n` +
      `🌱 **Giai đoạn 1 (2 – 4 tuần đầu - Thích nghi & Nâng cao thể lực):**\n` +
      `- Cơ thể làm quen với nhịp vận động, giảm hẳn cảm giác hụt hơi và nhức mỏi.\n` +
      `- Giấc ngủ sâu hơn, tinh thần sảng khoái, giảm 1 – 2kg mỡ ban đầu hoặc săn chắc trương lực cơ.\n\n` +
      `🔥 **Giai đoạn 2 (6 – 8 tuần - Biến chuyển vóc dáng nhìn thấy rõ):**\n` +
      `- Giảm rõ rệt số đo vòng eo, đùi, bắp tay (giảm từ 3 – 5 cm).\n` +
      `- Cân nặng giảm 3 – 5kg mỡ thừa (đối với lộ trình giảm cân) hoặc cơ bắp săn chắc, ngực/xô rõ nét (đối với tăng cơ).\n` +
      `- Khóa học **"Giảm mỡ 8 tuần"** tại FitCenter được thiết kế tối ưu nhất cho giai đoạn bứt phá này!\n\n` +
      `🏆 **Giai đoạn 3 (12 tuần / 3 tháng trở lên - Thay đổi vóc dáng toàn diện):**\n` +
      `- Cơ thể chuyển hóa tối ưu, tỷ lệ mỡ về ngưỡng lý tưởng (Nam: 12-15%, Nữ: 18-22%).\n` +
      `- Hình thành thói quen rèn luyện tự nhiên, sức mạnh và sức bền tăng vượt trội.\n\n` +
      `💡 **3 Bí quyết để đạt kết quả nhanh nhất:**\n` +
      `1. **Tần suất:** Duy trì đều đặn 3 – 4 buổi/tuần (45 – 60 phút/buổi).\n` +
      `2. **Dinh dưỡng (70% thành công):** Thâm hụt calo lành mạnh (nếu giảm mỡ) hoặc thặng dư giàu đạm (nếu tăng cơ), uống đủ 2 – 2.5 lít nước mỗi ngày.\n` +
      `3. **Lộ trình chuẩn:** Anh/chị nên tham khảo khóa học chuyên sâu hoặc đăng ký kèm cùng Huấn luyện viên để đo chỉ số InBody mỗi tháng nhé!`
    );
  }

  // 3. Hỏi về Gói tập của tôi / Lịch của tôi / Hạn thẻ
  if (
    q.includes('hạn thẻ') ||
    q.includes('thẻ của tôi') ||
    q.includes('lịch của tôi') ||
    ((q.includes('gói') || q.includes('thẻ') || q.includes('lịch') || q.includes('hồ sơ') || q.includes('inbody')) && q.includes('của tôi'))
  ) {
    const mc = context?.memberContext;
    if (mc) {
      let reply = `Dạ xin chào **${mc.fullName}** (Mã HV: **${mc.memberCode}**)! 👋\n\n`;
      if (mc.activeMembership) {
        const expDate = new Date(mc.activeMembership.NgayHetHan).toLocaleDateString('vi-VN');
        reply += `💳 **Gói tập hiện tại:** **${mc.activeMembership.TenGoiTap}**\n`;
        reply += `⏳ **Hạn sử dụng:** Đến ngày **${expDate}** (còn **${mc.activeMembership.days_left} ngày**).\n`;
      } else {
        reply += `💳 Hiện tại anh/chị chưa kích hoạt gói tập nào. Hãy vào tab **Gói tập & Khóa học** để đăng ký nhé!\n`;
      }
      if (mc.latestInBody) {
        reply += `\n📊 **Đánh giá InBody gần nhất:** Cân nặng ${mc.latestInBody.CanNang}kg, Tỷ lệ mỡ ${mc.latestInBody.TyLeMo}%. HLV nhận xét: "${mc.latestInBody.NhanXet || 'Tập luyện tích cực'}"`;
      }
      return reply;
    }
  }

  // 4. Bảng giá gói tập
  if (
    q.includes('bảng giá') ||
    q.includes('gói tập') ||
    q.includes('giá thẻ') ||
    q.includes('học phí') ||
    ((q.includes('giá') || q.includes('chi phí') || q.includes('bao nhiêu tiền') || q.includes('nhiêu tiền')) && (q.includes('gói') || q.includes('tập') || q.includes('thẻ') || q.includes('khóa') || q.includes('tháng') || q.includes('năm')))
  ) {
    let reply = '🏋️‍♂️ **BẢNG GIÁ CÁC GÓI TẬP TẠI FITCENTER:**\n\n';
    if (context?.plans && context.plans.length > 0) {
      context.plans.forEach((p, idx) => {
        const price = Number(p.Gia).toLocaleString('vi-VN') + ' đ';
        reply += `${idx + 1}. **${p.TenGoiTap}** (${p.ThoiHanNgay} ngày): **${price}**\n`;
      });
    } else {
      reply += '• Gói 1 tháng: 400.000 đ\n• Gói 3 tháng: 1.000.000 đ\n• Gói 12 tháng: 3.600.000 đ\n';
    }
    reply += '\n👉 Anh/chị có thể vào tab **Gói tập & Khóa học** để chọn và đăng ký trực tuyến ngay trên website ạ.';
    return reply;
  }

  // 5. Khóa học & Lớp học
  if (
    q.includes('khóa học') ||
    q.includes('lớp học') ||
    q.includes('lớp yoga') ||
    q.includes('lớp boxing') ||
    q.includes('giảm mỡ') ||
    ((q.includes('khóa') || q.includes('lớp')) && (q.includes('yoga') || q.includes('boxing') || q.includes('zumba') || q.includes('cardio') || q.includes('mở') || q.includes('học')))
  ) {
    let reply = '🎓 **DANH SÁCH KHÓA ĐÀO TẠO CHUYÊN SÂU TẠI FITCENTER:**\n\n';
    if (context?.courses && context.courses.length > 0) {
      context.courses.forEach((c, idx) => {
        const price = Number(c.Gia).toLocaleString('vi-VN') + ' đ';
        reply += `${idx + 1}. **${c.TenKhoaHoc}** (${c.SoBuoi} buổi) – Học phí: **${price}**\n   *${c.MoTa || ''}*\n`;
      });
    }
    reply += '\n👉 Mời anh/chị vào tab **Gói & Khóa học** hoặc **Thời khóa biểu** để xem lịch khai giảng cụ thể!';
    return reply;
  }

  // 6. Đội ngũ Huấn luyện viên
  if (
    q.includes('huấn luyện viên') ||
    q.includes('đội ngũ hlv') ||
    q.includes('danh sách hlv') ||
    q.includes('pt của') ||
    (q.includes('hlv') && (q.includes('nào') || q.includes('ai') || q.includes('danh sách') || q.includes('giỏi') || q.includes('chuyên môn') || q.includes('tập') || q.includes('kèm')))
  ) {
    let reply = '🏆 **ĐỘI NGŨ HUẤN LUYỆN VIÊN TẠI FITCENTER:**\n\n';
    if (context?.trainers && context.trainers.length > 0) {
      const seen = new Set();
      context.trainers.forEach(t => {
        if (!seen.has(t.HoTen)) {
          seen.add(t.HoTen);
          reply += `• **HLV ${t.HoTen}**: Chuyên môn ${t.TenChuyenMon || 'Thể hình'}, kinh nghiệm ${t.KinhNghiemNam || 3} năm.\n  *${t.TieuSu || ''}*\n\n`;
        }
      });
    }
    reply += '👉 Mọi HLV tại FitCenter đều có chứng chỉ quốc tế và kèm sát sao trong từng buổi tập.';
    return reply;
  }

  // 7. Quy định Hủy / Đổi ca
  if (
    (q.includes('hủy') || q.includes('đổi') || q.includes('chuyển') || q.includes('nghỉ')) &&
    (q.includes('ca') || q.includes('lịch') || q.includes('lớp') || q.includes('buổi') || q.includes('giờ học'))
  ) {
    return (
      '📋 **QUY ĐỊNH HỦY & ĐỔI CA HỌC TẠI FITCENTER:**\n\n' +
      '1. Hội viên được phép **Hủy ca** hoặc **Đổi ca học** trước giờ bắt đầu ít nhất **2 tiếng**.\n' +
      '2. Thao tác thực hiện trực tuyến 100% tại mục **Lịch học của tôi** trên Website.\n' +
      '3. Khi chuyển ca, nếu lớp mới còn chỗ trống thì hệ thống sẽ cập nhật xác nhận ngay lập tức.'
    );
  }

  // 8. Mua hàng / Nước uống / Whey / Sản phẩm tại quầy
  if (
    (q.includes('mua') || q.includes('bán') || q.includes('quầy') || q.includes('uống')) &&
    (q.includes('nước uống') || q.includes('nước khoáng') || q.includes('nước tăng lực') || q.includes('đồ uống') || q.includes('whey') || q.includes('sản phẩm') || q.includes('găng') || q.includes('thảm') || q.includes('bình'))
  ) {
    return (
      '🛍️ **QUY ĐỊNH MUA SẢN PHẨM TẠI FITCENTER:**\n\n' +
      'Các mặt hàng như Nước khoáng, Nước tăng lực, Whey Protein, Thảm Yoga, Găng tay tập... **chỉ được bán trực tiếp tại Quầy lễ tân thông qua nhân viên** để đảm bảo kiểm soát chất lượng và xuất biên lai thanh toán. Website hiện chỉ hỗ trợ đăng ký thẻ tập và khóa học trực tuyến.'
    );
  }

  // 9. Giờ mở cửa & Địa chỉ liên hệ FitCenter
  if (
    q.includes('địa chỉ') ||
    q.includes('hotline') ||
    q.includes('liên hệ') ||
    q.includes('mở cửa') ||
    q.includes('đóng cửa') ||
    q.includes('giờ làm việc') ||
    q.includes('giờ tập') ||
    (q.includes('ở đâu') && (q.includes('phòng') || q.includes('trung tâm') || q.includes('gym') || q.includes('fitcenter') || q.includes('tập'))) ||
    (q.includes('mấy giờ') && (q.includes('mở') || q.includes('đóng') || q.includes('tập') || q.includes('hoạt động')))
  ) {
    return (
      '🏢 **THÔNG TIN TRUNG TÂM FITCENTER:**\n\n' +
      '⏰ **Giờ mở cửa:** 05:30 – 21:30 hàng ngày (kể cả Thứ 7, Chủ nhật và ngày lễ)\n' +
      '📍 **Địa chỉ:** 123 Nguyễn Văn Linh, Quận Hải Châu, Đà Nẵng\n' +
      '📞 **Hotline:** 0900 000 001 | Email: lienhe@fitcenter.vn\n' +
      '🏋️ **Cơ sở vật chất:** Rộng hơn 1000m2, phòng Gym, Yoga cách âm, Boxing, tủ khóa từ thông minh và phòng tắm nóng lạnh miễn phí.'
    );
  }

  // 10. Chào hỏi cơ bản
  if (q === 'chào' || q === 'hello' || q === 'hi' || q === 'xin chào' || q === 'em ơi' || q === 'bot ơi') {
    return 'Dạ em chào anh/chị! 👋 Em là Trợ lý AI FitCenter. Em có thể hỗ trợ anh/chị giải đáp về các gói tập, lịch học, đăng ký tập thử miễn phí, đội ngũ HLV hoặc tư vấn thời gian tập luyện hiệu quả theo chỉ số BMI ạ!';
  }

  // 11. BẤT KỲ CÂU HỎI NGOÀI PHẠM VI FITCENTER
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
      reply: 'Dạ em chào anh/chị! Em có thể giúp gì cho anh/chị về gói tập, lịch học, đăng ký tập thử miễn phí hay tư vấn lộ trình tập luyện theo BMI tại FitCenter ạ?'
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
  const fallbackReply = localRuleBasedResponse(cleanMsg, context);
  return {
    success: true,
    reply: fallbackReply,
    source: 'fitcenter-knowledge-base'
  };
}

module.exports = {
  processFitCenterChat,
  OUT_OF_SCOPE_MESSAGE
};
