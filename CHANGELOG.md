# Changelog

## Phase 4 · Bình minh · Contract v1.3

- Thêm benchmark có cửa sổ, cảnh 200 Bóng Mực và 100 đom đóm, và soak test 10 đêm trong cùng tiến trình.
- Bảng xếp hạng top 10 lưu trên đĩa khi chạy launcher, có lệnh xuất JSON.
- Đổi phím có phát hiện trùng, phụ đề và hướng Bóng Mực, giảm chuyển động và chữ lớn.
- `run_cmd` chuyển sang bản web production thông qua launcher Node. Thêm gói web đã build, bằng chứng, retro và demo.

## Phase 3 · Đèn cạn dầu · Contract v1.2

Các thay đổi phá vỡ tương thích từ v1.1:

- Thắp đủ đèn giữa đêm vẫn tiếp tục chơi. Sau tick bình minh, thắng với ít nhất 3/5, 4/6 hoặc 5/7 đèn đang sáng. Lý do thắng chuyển từ `all_lit` sang `dawn_survived`. Hết Ngọn Lửa vẫn được xét trước.
- Thời lượng mặc định đổi thành 240/270/300 giây. Sức chứa khởi đầu là 10, tăng 2 mỗi lần thắp thành công và dừng ở 20. Snapshot `player.capacity` ghi mức hiện tại.
- Đèn sáng nhận châm dầu, tự hao và có thể tắt. Snapshot đèn thêm `fuel`, `ever_lit` và `relit_count`. Đèn đã từng sáng cần 5 đom đóm để thắp lại. `lantern_lit.data` thêm boolean `relight`.
- Dưới 30 dầu, đèn mất vùng an toàn và Bóng Mực có thể chuyển sang trạng thái `drain`. JSONL thêm `refuel`, `lantern_out` và `fuel_drain`. Fixture có thể khai báo dầu, lịch sử đèn, số lần thắp và đèn mục tiêu của Bóng Mực.
- Điểm nạp giảm từ 10 xuống 5 mỗi đom đóm. Thắp lại được 40, pulse trúng Bóng Mực đang hút được 15. Thưởng khi thắng dùng lượng dầu và số đèn đang sáng tại bình minh, cùng số Ngọn Lửa còn lại.

Bản web thêm thanh dầu, đèn tắt xẹp và có vết rách, HUD sức chứa động và cài đặt **Bảng màu dễ phân biệt**.


## Phase 2 · Ba hòn đảo · Contract v1.1

- Chuẩn hóa thông số, thêm bản đồ Đảo Cau và Đảo Chuông, lướt, rơi, Gió Lạc, Bùa Gió, gió mạnh, pause và luồng ba đêm.
- CLI nhận ba đêm, snapshot ghi vận tốc, timer và thực thể mới. `tick` và `sim_tick` tách khi pause.

## Phase 1 · Đảo Bến · Contract v1.0

- Bản đầu có màn 3D góc nhìn thứ ba, nhặt đom đóm, thắp đèn, xua Bóng Mực và chơi lại.
- Thêm mô phỏng dùng chung với CLI headless 60 Hz có JSONL, scenario và input theo tick.
