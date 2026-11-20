# Phase 4 · Bình minh

## Cảnh và phép đo chuẩn

- Benchmark dùng bản production chạy trong cửa sổ Chrome. Launcher đặt viewport và framebuffer 1280×720. Cảnh có 200 Bóng Mực `wander`, 100 đom đóm, L1–L3 sáng ở 100 dầu và Mây ở gốc. Camera quay một vòng 15 giây, bắt đầu từ (30, 15, 0). Lượt đo loại 3 giây khởi động. Bóng Mực chạy nhánh wander của mô phỏng; đầu vào, sinh, nhặt, sát thương, hao dầu và kết thúc không được chạy. Các mô hình Bóng Mực vẫn dùng cùng hình học và vật liệu, gom theo instancing để giảm draw call.
- `bench.json` được tạo từ các khoảng giữa frame Chrome trong cửa sổ đo 30 giây. P1 low lấy trung bình 1% frame chậm nhất rồi đổi ra FPS. P95 dùng thứ hạng gần nhất. RSS của toàn bộ Chrome không có trong API web nên để `null`.
- Soak đánh số đêm từ 0, dùng seed 7–16 và xoay Đêm 1 → 2 → 3. Chọn hướng mỗi 30 tick. Các nút ngẫu nhiên theo xác suất Ticket-04, sau đó qua cơ chế cạnh lên của mô phỏng. Dùng Node `--jitless` để RSS đầu và cuối ít bị ảnh hưởng bởi việc V8 tích lũy mã JIT. Thu gom trước hai mốc RSS. Lệnh headless thông thường tiếp tục dùng runtime mặc định.
- Mở [bench.json](../bench.json), [soak.json](../soak.json) và [log kiểm chứng](proof/phase-4-checks.txt) để xem số đo. Kết quả không đại diện máy chấm chưa công bố.

## Bảng xếp hạng và tiếp cận

- `npm start` chạy launcher localhost, nhận và lưu điểm vào thư mục dữ liệu người dùng. Ghi tệp tạm rồi đổi tên để tránh JSON dở. Ghi thời điểm ISO 8601 UTC, số đêm đã thắng, tổng điểm các đêm đó và seed. Khi dùng Vite hoặc host tĩnh, dùng localStorage theo origin. Lệnh export đọc dữ liệu launcher trên đĩa.
- Đổi được bốn hướng di chuyển, nhảy, lướt, nạp, pulse và tạm dừng. Mỗi mã phím thuộc tối đa một hành động. Phím Tab và Enter dành cho điều hướng giao diện. Khôi phục mặc định cùng lúc cho tất cả hành động. Cài đặt lưu trong trình duyệt.
- Chỉ báo Bóng Mực xuất hiện có mũi tên theo hướng thực thể. Chỉ báo gió và đồng hồ 10 giây, cùng trạng thái đèn yếu trong HUD, hoạt động khi tắt tiếng. Giảm chuyển động tắt các hiệu ứng chớp và vòng pulse; camera không có rung trong bản này. Chữ thân giao diện 18 px, tùy chọn lớn tăng lên 22,5 px.
- [Video](demo/demo.mp4) ghi gameplay thật trên bản đồ mặc định và kết quả lệnh. Smoke test Chrome dùng fixture chỉ để đưa nhanh game tới điều kiện kết thúc, sau đó kiểm tra lưu điểm, đổi phím, trùng phím, reset, bảng xếp hạng và tiếp cận.

## Phát hành

Gói `dao-den-long-v1.0.0.zip` gồm thư mục web production, launcher, mã bảng điểm và hướng dẫn, chạy bằng `node scripts/run.mjs` sau giải nén. Source cài trong ba lệnh ở README. Bản địa phương có tag `phase-4` và `v1.0.0`; việc xuất bản lên GitHub dùng repo cá nhân của học viên. Bộ test ẩn không có trong repo này.
