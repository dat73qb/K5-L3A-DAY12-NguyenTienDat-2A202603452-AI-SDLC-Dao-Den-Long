# Phase 3 — Đèn cạn dầu

## Phạm vi

Phase 3 chuyển mục tiêu từ “thắp đủ đèn là thắng ngay” sang “giữ đủ đèn sáng đến bình minh”. Contract nâng lên v1.2.

- Nhiên liệu tối đa mỗi đèn: 100.
- Đèn đang sáng tự hao 1 nhiên liệu/giây.
- Đom đóm có thể châm thêm dầu cho đèn đang sáng.
- Bóng Mực có thể hút dầu từ đèn yếu.
- Thời lượng đêm: 240/270/300 giây cho Đêm 1/2/3.
- Điều kiện thắng: Mây còn sống và số đèn sáng ở bình minh đạt ít nhất 60% tổng số đèn.

## ADR-003: Mô hình nhiên liệu và luật thắng

Mỗi đèn có `fuel`, `ever_lit` và `relit_count`. Đèn vừa được thắp hoặc thắp lại bắt đầu với 100 nhiên liệu. Nhiên liệu được lưu theo tick nguyên ở 60 Hz để tránh sai số số thực.

Đèn hết dầu chuyển sang trạng thái tắt, `fuel = 0`, phát `lantern_out` và mất vùng an toàn. Đèn từng sáng chỉ cần 5 đom đóm để thắp lại; đèn chưa từng sáng cần 10. Luật thắng chỉ được xét ở bình minh, loại bỏ thắng sớm.

## Bóng Mực hút dầu

- Bóng Mực ở `wander` ưu tiên đèn sáng có nhiên liệu dưới 30.
- Khi cách đèn không quá 2 m, chuyển sang `drain` và hút 5 nhiên liệu/giây.
- Nhiều Bóng Mực có thể hút cùng một đèn.
- Từ `drain`, chuyển sang `chase` khi Mây đến gần, hoặc về `wander` khi đèn tắt, được châm lên ít nhất 30, hoặc Mây đi xa.
- Tỏa Sáng làm Bóng Mực đang hút dầu bị choáng và áp dụng phần thưởng Phase 3.

## Điểm và sức chứa

- Châm mỗi đom đóm vào đèn: +5 điểm.
- Thắp lần đầu: +100 điểm; thắp lại: +40 điểm.
- Hạ Bóng Mực bằng Tỏa Sáng: +5; hạ ngay sau khi hút dầu: tổng +15.
- Bình minh thắng: mỗi đèn đang sáng nhận `50 + floor(fuel)` và mỗi Ngọn Lửa còn lại nhận +50.
- Không còn thưởng theo số giây còn lại.
- Sức chứa bắt đầu là 10, tăng 2 sau mỗi lần thắp thành công trong đêm, tối đa 20.

## Tương thích tính năng trước

- Giữ A sang phải, D sang trái.
- Giữ camera chuột ngược, pointer lock và giới hạn delta chuột.
- Giữ nhảy cao, không nhận sát thương Bóng Mực khi đang trên không.
- Giữ 3 bản đồ, Bùa Gió, Gió Lạc, gió mạnh, pause/resume và tính năng Phase 2.

## Thay đổi breaking

- `contract_version`: `1.1` → `1.2`.
- `all_lit` không còn là lý do thắng sớm; thêm `dawn_survived`.
- Snapshot đèn thêm `fuel`, `ever_lit`, `relit_count`.
- Snapshot người chơi thêm `capacity`.
- Bóng Mực thêm `drain` và `target_lantern_id`.
- Thêm sự kiện `refuel`, `lantern_out`, `fuel_drain`; `lantern_lit` có `relight`.

## Kiểm chứng

- `npm test`: 22/22 test pass.
- Test bao phủ nhiên liệu, hao dầu 60 Hz, pause, châm dầu, đèn cạn, thắp lại, tăng sức chứa, Bóng Mực hút dầu, Tỏa Sáng và thắng bình minh.
- `npm run build` và kiểm tra cú pháp các module: đạt.

## Retrospective

- Đọc contract trước khi thay đổi luật thắng để tránh giữ assertion của Phase 2.
- Bảo toàn các tùy chỉnh điều khiển của người chơi khi nhập code Phase 3.
- Test headless phát hiện nhanh breaking changes; UI vẫn cần kiểm thử trình duyệt riêng.
