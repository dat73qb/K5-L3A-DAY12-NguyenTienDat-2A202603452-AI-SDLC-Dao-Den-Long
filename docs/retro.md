# Retro · Đảo Đèn Lồng v1.0.0

## Evaluation qua bốn phase

| Phase | Kết quả | Điều chỉnh sau kiểm chứng |
|---|---|---|
| 1 · Đảo Bến | Một màn chơi được và CLI JSONL 60 Hz. Chrome xác minh thắng, thua và chơi lại. | Lệnh thử phát hiện parser của Node không nhận `--seed -3`. Bổ sung xử lý seed âm và giữ test CLI. |
| 2 · Ba hòn đảo | Ba bản đồ chuẩn, điều khiển và HUD dùng chung mô phỏng. Test kiểm tra pause, spawn, bục nhảy và hồi quy. | Điểm xuất phát Đêm 3 nằm dưới đĩa Y = 6. Sửa tầng tiếp đất và khả năng nhìn của camera. Khi dựng hình bằng SwiftShader chậm, gom mesh tĩnh và dùng instancing cho đom đóm. Sau đó đo lại trên GPU Intel tại 1280×720. |
| 3 · Đèn cạn dầu | Dầu theo tick nguyên, hút dầu, sức chứa động và thắng ở bình minh. | Test cũ giả định thắng sớm và bỏ qua sự kiện sau khi đủ đèn. Chạy lại cho thấy Mây tiếp tục nhặt ở tick sau. Cập nhật tiêu chí kiểm chứng và ghi ADR. Phản hồi chơi thử cho thấy thay đổi giao diện khó thấy lúc vào game, nên đưa trạng thái dầu từng đèn lên HUD. |
| 4 · Bình minh | Launcher, xuất bảng xếp hạng, cài đặt trợ năng, benchmark có cửa sổ, soak và gói chạy được. | Lần soak đầu tăng RSS khoảng 29% dù không lỗi. Chạy V8 ở chế độ thông dịch và thu gom tại hai mốc lấy mẫu để hạn chế phần tăng từ JIT. Benchmark ban đầu gặp lỗi context khi Chrome đang chuyển trang. Chờ đúng context của game trước khi lấy kết quả. |

## AI và harness

Một mô phỏng dùng chung cho game và CLI đem lại hiệu quả lớn nhất. Có thể dùng scenario nhỏ để kiểm tra từng luật, rồi xem đúng luật đó trên trình duyệt. `AGENTS.md` ghi lệnh test và các ràng buộc qua từng phase. Workflow CI chạy test và build trên lần push; script Chrome kiểm tra những thứ JSONL không thể hiện như HUD, phím, thiết lập và luồng chuyển màn. Kho bằng chứng theo từng tag giúp phân biệt kết quả thật với dự đoán của AI.

AI hiệu quả khi ticket được chuyển thành đầu vào, đầu ra và mốc tick cụ thể. Sai sót xuất hiện ở các biên dễ bỏ qua như seed âm, sàn chồng lớp, test tiếp tục chạy sau thay đổi luật và thời điểm DevTools gắn vào Chrome. Các sửa đổi trên đến từ CLI, test hoặc traceback thực tế. Cảnh chuyển đêm trên Chrome thường dùng fixture và bài chấm ẩn chưa được cung cấp.

## Chi phí và nếu làm lại

Ước tính thô khoảng **25.000–50.000 token đầu ra** cho bốn phase, căn cứ vào lượng mã, test và tài liệu sinh ra. Phiên làm việc không cung cấp số token đầu vào, đơn giá hoặc dữ liệu hóa đơn nên tổng chi phí tiền và tổng token thực chưa xác định. Giảm token bằng cách giữ hướng dẫn ngắn, dùng chung mô phỏng, chạy scenario ngay khi chỉnh luật, và mở đúng tệp có liên quan trước khi giao việc.

Nếu làm lại, sẽ dựng schema và kịch bản biên ngay ở Phase 1, kiểm tra trên cả GPU thật lẫn renderer phần mềm sớm hơn, và đo bộ nhớ với cùng tham số runtime từ lần chạy đầu. Dành thời gian cố định cuối mỗi phase cho bản clone sạch, bằng chứng và thao tác phát hành.
