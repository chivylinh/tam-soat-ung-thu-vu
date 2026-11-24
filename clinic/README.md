# Phần mềm quản lý phòng khám đa khoa

Ứng dụng web chạy trên máy chủ của phòng khám. Nhân viên dùng trình duyệt (máy tính, máy tính bảng, điện thoại) trong mạng nội bộ hoặc qua Internet.

## Chức năng

| Nhóm | Chức năng |
|---|---|
| Điều hành | Bảng tổng quan: lượt khám, doanh thu, CLS chờ kết quả, sơ đồ trạng thái từng phòng khám (ĐK / Chờ / Đang / Xong), hẹn tái khám, thuốc sắp hết |
| Đón tiếp | Tiếp nhận bệnh nhân, tự cấp số thứ tự theo phòng, thu phí khám; đặt / sửa / hủy lịch hẹn, phát hiện trùng lịch bác sĩ, tiếp đón từ lịch hẹn |
| Màn hình phòng chờ | Trang hiển thị trên TV: số đang khám và số tiếp theo của từng phòng, tên bệnh nhân được che bớt (VD: `N. V. AN`), tự cập nhật 15 giây |
| Khám bệnh (EMR) | Dấu hiệu sinh tồn, BMI, bệnh sử, khám thực thể, chẩn đoán + ICD-10, hướng điều trị, lời dặn, hẹn tái khám, xem lịch sử khám; cảnh báo dị ứng |
| Chỉ định & CLS | Chỉ định xét nghiệm / chẩn đoán hình ảnh / thủ thuật; danh sách chờ kết quả cho kỹ thuật viên |
| Kê đơn | Kê thuốc từ danh mục kho, mẫu cách dùng nhanh, cảnh báo tồn kho; in đơn thuốc / phiếu khám |
| Thu ngân | Lập hóa đơn từ lượt khám, giảm giá, tiền mặt / chuyển khoản / thẻ, in phiếu thu. Có thể thu tiền khám trước, các chỉ định sau sẽ vào hóa đơn mới. Hủy hóa đơn (quản trị) sẽ hoàn kho |
| Kho thuốc | Danh mục thuốc, nhập / xuất điều chỉnh, lịch sử kho, cảnh báo sắp hết và sắp hết hạn; thuốc tự trừ kho khi thu tiền |
| BHYT | Thẻ BHYT trong hồ sơ (số thẻ, hạn, nơi ĐKBĐ, mức hưởng); khám BHYT khi tiếp nhận (kiểm tra hạn thẻ); hóa đơn tách **BHYT chi trả / người bệnh trả** theo mức hưởng, áp dụng mức 100% khi chi phí dưới 15% lương cơ sở; **xuất XML giám định** (XML1 tổng hợp, XML2 thuốc, XML3 DVKT, gói GIAMDINHHS) kèm kiểm tra lỗi từng hồ sơ — *bản thử nghiệm, xem lưu ý bên dưới* |
| Nhắc lịch | Danh sách lịch hẹn và hẹn tái khám theo ngày, tin nhắn soạn sẵn (sửa mẫu trong `config.env`), nút sao chép / mở Zalo / gọi, đánh dấu đã nhắc, xuất CSV cho dịch vụ gửi SMS/Zalo hàng loạt |
| Phiếu kết quả CLS | In phiếu kết quả xét nghiệm / chẩn đoán hình ảnh theo lượt khám (hoặc từng chỉ định), nhóm theo loại, có chữ ký bác sĩ chỉ định và người trả kết quả |
| Báo cáo | Doanh thu theo ngày, dịch vụ / thuốc, lượt khám theo khoa và bác sĩ, chẩn đoán thường gặp, xuất CSV (mở bằng Excel) |
| Quản trị | Nhân viên & phân quyền, chuyên khoa / phòng, danh mục dịch vụ & bảng giá, nhật ký hoạt động |

**Vai trò:** Quản trị · Bác sĩ · Kỹ thuật viên CLS · Lễ tân · Thu ngân · Dược sĩ. Mỗi vai trò chỉ thấy và thao tác được phần việc của mình.

## Chạy trên Windows (bấm đúp)

1. Cài **Node.js bản LTS** (22.13 trở lên) từ https://nodejs.org.
2. Tải mã nguồn và giải nén, ví dụ vào `C:\phongkham`.
3. Mở thư mục `clinic` rồi bấm đúp các file sau:

| File | Tác dụng |
|---|---|
| `CHAY-PHAN-MEM.bat` | Chạy phần mềm và mở trình duyệt. Lần đầu tự cài thư viện (cần Internet). Giữ cửa sổ mở trong lúc dùng. Nếu phần mềm đang chạy ngầm thì chỉ mở trình duyệt |
| `TU-KHOI-DONG-BAT.bat` | Bật tự chạy ngầm mỗi khi đăng nhập Windows (không hiện cửa sổ; nhật ký ở `data\server.log`) |
| `TU-KHOI-DONG-TAT.bat` | Tắt tự khởi động |
| `DUNG-PHAN-MEM.bat` | Dừng phần mềm đang chạy ngầm |
| `SAO-LUU-NGAY.bat` | Sao lưu dữ liệu ngay vào `data\backups` |

Lần chạy đầu sẽ tạo file `config.env`. Mở bằng Notepad để đổi **tên phòng khám**, **cổng** hoặc **thư mục sao lưu** (ví dụ ổ D hoặc thư mục OneDrive/Google Drive), rồi chạy lại phần mềm.

**Sao lưu tự động:** khi đang chạy, phần mềm tự sao lưu mỗi ngày một bản vào `data\backups` (giữ 30 bản gần nhất). Khôi phục: dừng phần mềm, chép bản sao lưu đè lên `data\clinic.db`.

## Cài đặt & chạy (dòng lệnh, mọi hệ điều hành)

Yêu cầu: **Node.js 22.13 trở lên** (dữ liệu lưu bằng SQLite tích hợp sẵn, không cần cài cơ sở dữ liệu riêng).

```bash
cd clinic
npm install
npm start            # mở http://localhost:3000
```

Đăng nhập lần đầu: `admin` / `admin123`. **Đổi mật khẩu ngay sau khi đăng nhập**, hoặc đặt `ADMIN_PASSWORD` trước lần chạy đầu tiên.

Dữ liệu mẫu để dùng thử (8 nhân viên, 10 bệnh nhân, lượt khám hôm nay; mật khẩu nhân viên `matkhau123`):

```bash
npm run demo && npm start
```

Chạy kiểm thử: `npm test` · Sao lưu thủ công: `npm run backup`

### Cấu hình

Đặt trong file `config.env` (xem `config.env.example`) hoặc bằng biến môi trường. Biến môi trường được ưu tiên.

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PORT` | Cổng web | `3000` |
| `CLINIC_NAME` | Tên phòng khám hiển thị và in trên phiếu | `Phòng khám Đa khoa` |
| `DB_PATH` | Đường dẫn file dữ liệu | `data/clinic.db` |
| `SESSION_SECRET` | Chuỗi bí mật cho phiên đăng nhập | tự tạo và lưu ở `data/.session-secret` |
| `BACKUP_DIR` | Thư mục sao lưu hằng ngày | `data/backups` |
| `BACKUP_KEEP` | Số bản sao lưu giữ lại | `30` |
| `ADMIN_PASSWORD` | Mật khẩu admin khi tạo dữ liệu lần đầu | `admin123` |
| `COOKIE_SECURE` | `1` khi chạy sau HTTPS | tắt |
| `TRUST_PROXY` | `1` khi chạy sau Nginx / reverse proxy | tắt |
| `TZ` | Múi giờ | `Asia/Ho_Chi_Minh` |
| `CLINIC_PHONE` | Số điện thoại phòng khám trong tin nhắn nhắc lịch | trống |
| `REMINDER_APPOINTMENT`, `REMINDER_FOLLOWUP` | Mẫu tin nhắn nhắc lịch hẹn / tái khám (từ khóa `{ten} {phongkham} {khoa} {gio} {ngay} {sdt}`) | có sẵn |
| `BHYT_MA_CSKCB` | Mã cơ sở KCB do BHXH cấp — bắt buộc để xuất XML | trống |
| `LUONG_CO_SO` | Lương cơ sở (đồng), dùng cho ngưỡng 15% BHYT trả 100% | `2340000` |

## Đưa vào sử dụng thật — lưu ý

- **Sao lưu ra ngoài máy:** bản sao lưu tự động nằm cùng ổ đĩa với dữ liệu. Nên đặt `BACKUP_DIR` sang ổ khác hoặc thư mục đồng bộ đám mây, phòng khi hỏng máy.
- Chạy sau **HTTPS** (Nginx + Let's Encrypt) nếu truy cập qua Internet; đặt `COOKIE_SECURE=1`, `TRUST_PROXY=1`.
- Dữ liệu sức khỏe là dữ liệu cá nhân nhạy cảm theo **Nghị định 13/2023/NĐ-CP**: phân quyền đúng người, khóa tài khoản nhân viên nghỉ việc, xem nhật ký hoạt động định kỳ.
- **XML BHYT là bản thử nghiệm.** Tên trường và cấu trúc viết theo QĐ 130/QĐ-BYT và QĐ 4750/QĐ-BYT nhưng **chưa được đối chiếu với phụ lục chính thức**, chưa có chữ ký số và chưa có XML4/XML5. Mức hưởng suy từ ký tự thứ 3 của mã thẻ 15 ký tự (hoặc chọn tay), chưa xét đúng/trái tuyến, trần thanh toán, tỷ lệ thanh toán riêng của từng thuốc/DVKT. Trước khi quyết toán thật: nhập mã danh mục BHYT chính xác cho dịch vụ, thuốc, khoa, chứng chỉ hành nghề bác sĩ; nộp thử trên cổng kiểm thử của BHXH. Mọi quy tắc nằm trong `src/bhyt.js` để dễ chỉnh.
- Hóa đơn tính phần BHYT tại thời điểm lập. Nếu sau khi đã thu tiền khám, tổng chi phí lượt khám vượt ngưỡng 15% lương cơ sở, phần đã thu không tự điều chỉnh lại (file XML tính theo tổng cuối cùng).
- Chưa có: kết nối trực tiếp cổng giám định BHYT, kết nối máy xét nghiệm (LIS/HL7), lưu ảnh DICOM (PACS), hóa đơn điện tử, chữ ký số bệnh án điện tử theo Thông tư 46/2018 & 13/2025/TT-BYT. Các phần này cần làm thêm tùy nhu cầu.

## Cấu trúc mã nguồn

```
clinic/
  src/server.js        khởi tạo ứng dụng, bảo mật (CSRF, session, header)
  src/db.js            lược đồ cơ sở dữ liệu + dữ liệu danh mục ban đầu
  src/clinical.js      nghiệp vụ: tạo lượt khám, chỉ định, kê đơn, lập & thu hóa đơn, trừ / hoàn kho
  src/routes/          từng màn hình (patients, visits, appointments, lab, invoices, pharmacy, reports, admin…)
  views/               giao diện (EJS)
  public/              CSS, JS
  src/config.js        đọc config.env
  src/backup.js        sao lưu tự động hằng ngày
  scripts/             tạo dữ liệu mẫu, sao lưu thủ công, script PowerShell cho Windows
  *.bat, chay-an.vbs   các file bấm đúp trên Windows
  test/                kiểm thử toàn bộ quy trình
```
