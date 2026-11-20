# Phase 2 — Ghi chú triển khai và kiểm chứng

## Phạm vi

Phase 2 mở rộng game từ Đêm 1 thành chuỗi 3 đêm theo Test Contract v1.1:

- Đêm 1: Đảo Bến.
- Đêm 2: Đảo Cau, cầu tre, bậc nhảy, Bùa Gió và Gió Lạc.
- Đêm 3: Đảo Chuông, các tầng cao, ramp, gió mạnh và tháp chuông.

## Điều chỉnh theo yêu cầu người chơi

- Tên bản đồ dùng UTF-8 chuẩn: Đảo Bến, Đảo Cau, Đảo Chuông.
- Tốc độ di chuyển chuẩn là `6 m/s`.
- Tốc độ khi đang có Bùa Gió là `7.2 m/s`.
- Điểm nhặt mỗi đom đóm là `10 điểm`.
- Dash vẫn dùng tốc độ riêng `14 m/s` theo Contract v1.1.

## Tính năng Phase 2

- Chuẩn hóa 60 tick/giây và thời lượng Đêm 1/2/3 là 300/330/360 giây.
- Bản đồ, đèn, đom đóm và Bóng Mực cho cả ba đêm.
- Bậc nhảy Đêm 2 và ramp/tầng Đêm 3.
- Gió Lạc với trạng thái idle/chase/flee, cướp và thả đom đóm.
- Bùa Gió tăng tốc chạy và bỏ hồi chiêu dash trong thời gian hiệu lực.
- Gió mạnh Đêm 3: cảnh báo, hướng gió, lực đẩy và thời lượng 5 giây.
- Pause/resume, snapshot headless, HUD, âm thanh và chuỗi kết quả 3 đêm.

## Kiểm chứng

- `npm test`: regression và scenario Phase 2 trong `tests/contract.test.mjs`.
- `npm run build`: kiểm tra bản build trình duyệt.
- `node --check src/game.mjs` và `node --check src/headless.mjs`.
- Scenario headless bao phủ dash/Bùa Gió, bậc nhảy, tầng/ramp, Gió Lạc, gió mạnh và lịch sinh thực thể.

## Retro

- Test Contract giúp cố định số liệu và bảo vệ hành vi headless.
- Chuỗi UI và tên bản đồ cần được lưu bằng UTF-8 để tránh mojibake.
- Tốc độ và điểm số giữ theo số liệu chuẩn của Contract v1.1; cần kiểm tra lại cảm giác điều khiển bằng trình duyệt thật.

## Trạng thái

- Code Phase 2 và contract: đã cập nhật.
- Test tự động: chạy lại sau các điều chỉnh cân bằng mới.
- Kiểm thử trình duyệt/FPS: cần ghi nhận bằng chứng riêng khi nghiệm thu.
