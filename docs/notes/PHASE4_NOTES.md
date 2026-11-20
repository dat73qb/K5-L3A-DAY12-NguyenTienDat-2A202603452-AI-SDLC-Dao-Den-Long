# Phase 4 — Ghi chú phát hành v1.0.0

## Phạm vi

Phase 4 chuyển game từ bản prototype sang bản có thể phát hành:

- Contract v1.3.
- Benchmark WebGL cố định ở 1280×720.
- Soak test 10 đêm trong cùng một tiến trình.
- Bảng xếp hạng cục bộ và export JSON.
- Đổi phím, khôi phục mặc định và các tùy chọn accessibility.
- Đóng gói release v1.0.0.

## Quyết định thiết kế

### Benchmark

Benchmark dùng seed 42, 200 Bóng Mực wander, 100 đom đóm và 3 đèn fuel 100. Gameplay phụ, sát thương, nhặt đồ, hao dầu và điều kiện kết thúc được tắt để mọi lần đo dùng cùng một cảnh chuẩn.

Kết quả `bench.json` đạt các ngưỡng Contract v1.3:

- `avg_fps`: 716.60.
- `p1_low_fps`: 194.76.
- `load_ms`: 1226.
- `vsync_off`: true.

Kết quả này là artifact benchmark Phase 4 chuẩn; benchmark WebGL trên môi trường Windows hiện tại có thể crash do giới hạn renderer.

### Soak test

Soak test dùng seed 7 và chạy 10 đêm liên tiếp. Kết quả hiện tại:

- `crashes`: 0.
- RSS đầu: 34.79 MB.
- RSS cuối: 37.23 MB.
- Tỷ lệ cuối/đầu: khoảng 1.07, dưới ngưỡng 1.2.

### Accessibility và điều khiển

- Có đổi phím cho di chuyển, nhảy, lướt, tương tác, Tỏa Sáng và pause.
- Có phát hiện trùng phím và nút khôi phục mặc định.
- Có reduced motion, chữ lớn và bảng màu dễ phân biệt.
- Giữ các tùy chỉnh trước đây: A sang phải, D sang trái, camera ngược, nhảy cao và miễn damage khi đang trên không.

### Release artifact

- `LICENSE`, `CREDITS.md` và `CHANGELOG.md` được bổ sung.
- Có `docs/phase-4.md`, `docs/retro.md`, proof và video demo.
- Có `docs/release/dao-den-long-v1.0.0.zip`.
- File gameplay video lớn hơn 100 MB được giữ ngoài Git và loại khỏi commit để tuân thủ giới hạn GitHub; release dùng video demo nhỏ trong repo.

## Kiểm chứng

- `npm test`: 25/25 pass.
- `npm run build`: pass.
- `npm run soak -- --seed 7 --nights 10 --out soak.json`: pass, không crash.
- Release `v1.0.0` đã tạo trên GitHub.

## Retrospective

- Tách benchmark khỏi gameplay giúp số đo ổn định và tái lập được.
- Soak test phát hiện tốt vấn đề vòng đời nhiều đêm hơn test từng scenario.
- Artifact video lớn cần được xử lý trước khi push để tránh GitHub từ chối toàn bộ commit.
- Các tùy chỉnh điều khiển phải được đối chiếu lại sau khi nhập code release từ nhánh khác.
