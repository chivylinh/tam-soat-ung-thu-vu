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
| Báo cáo | Doanh thu theo ngày, dịch vụ / thuốc, lượt khám theo khoa và bác sĩ, chẩn đoán thường gặp, xuất CSV (mở bằng Excel) |
| Quản trị | Nhân viên & phân quyền, chuyên khoa / phòng, danh mục dịch vụ & bảng giá, nhật ký hoạt động |

**Vai trò:** Quản trị · Bác sĩ · Kỹ thuật viên CLS · Lễ tân · Thu ngân · Dược sĩ. Mỗi vai trò chỉ thấy và thao tác được phần việc của mình.

## Cài đặt & chạy

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

Chạy kiểm thử: `npm test`

### Biến môi trường

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `PORT` | Cổng web | `3000` |
| `CLINIC_NAME` | Tên phòng khám hiển thị và in trên phiếu | `Phòng khám Đa khoa` |
| `DB_PATH` | Đường dẫn file dữ liệu | `data/clinic.db` |
| `SESSION_SECRET` | Chuỗi bí mật cho phiên đăng nhập (**bắt buộc khi chạy thật**) | ngẫu nhiên mỗi lần chạy |
| `ADMIN_PASSWORD` | Mật khẩu admin khi tạo dữ liệu lần đầu | `admin123` |
| `COOKIE_SECURE` | `1` khi chạy sau HTTPS | tắt |
| `TRUST_PROXY` | `1` khi chạy sau Nginx / reverse proxy | tắt |
| `TZ` | Múi giờ | `Asia/Ho_Chi_Minh` |

## Đưa vào sử dụng thật — lưu ý

- **Sao lưu** file `data/clinic.db` hằng ngày (ví dụ chép sang ổ khác / lưu trữ đám mây). Khi sao lưu lúc đang chạy, dùng `sqlite3 data/clinic.db ".backup backup.db"`.
- Chạy sau **HTTPS** (Nginx + Let's Encrypt) nếu truy cập qua Internet; đặt `SESSION_SECRET`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`.
- Dữ liệu sức khỏe là dữ liệu cá nhân nhạy cảm theo **Nghị định 13/2023/NĐ-CP**: phân quyền đúng người, khóa tài khoản nhân viên nghỉ việc, xem nhật ký hoạt động định kỳ.
- Chưa có: kết nối cổng giám định BHYT (xuất XML theo QĐ 4750/130), kết nối máy xét nghiệm (LIS/HL7), lưu ảnh DICOM (PACS), hóa đơn điện tử, chữ ký số bệnh án điện tử theo Thông tư 46/2018 & 13/2025/TT-BYT. Các phần này cần làm thêm tùy nhu cầu.

## Cấu trúc mã nguồn

```
clinic/
  src/server.js        khởi tạo ứng dụng, bảo mật (CSRF, session, header)
  src/db.js            lược đồ cơ sở dữ liệu + dữ liệu danh mục ban đầu
  src/clinical.js      nghiệp vụ: tạo lượt khám, chỉ định, kê đơn, lập & thu hóa đơn, trừ / hoàn kho
  src/routes/          từng màn hình (patients, visits, appointments, lab, invoices, pharmacy, reports, admin…)
  views/               giao diện (EJS)
  public/              CSS, JS
  scripts/demo-data.js tạo dữ liệu mẫu
  test/                kiểm thử toàn bộ quy trình
```
