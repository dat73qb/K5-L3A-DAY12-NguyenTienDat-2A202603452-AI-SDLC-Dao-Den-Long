# Phase 1 — Ghi chép ngắn (spec, giả định, nhật ký AI, retro)

## Spec / Giả định
- Mục tiêu Phase 1: Game chơi được Đêm 1 từ đầu tới thắng/thua.
- Game contract: `game.contract.json` (phiên bản 1.0) — tuning cố định, 5 đèn, 3 lửa, 180s/đêm.
- Chế độ headless: `src/headless.mjs` chạy đúng Test Contract v1.0 (`tests/contract.test.mjs`).
- Giả định: Không cần âm thanh, không cần asset bên ngoài (tất cả hình dạng lập trình qua Three.js primitives).
- Giả định: Điều khiển A sang phải, D sang trái (đảo ngược mặc định WASD) theo yêu cầu người chơi.
- Giả định: Nhảy cao hơn (verticalSpeed 11 thay vì 6) và không bị damage khi đang trên không (pos[1] > 0).

## Nhật ký dùng AI (Phase 1)
| Lần | Mục đích | Kết quả |
|-----|----------|---------|
| 1 | Khám phá cấu trúc dự án, cài dependencies, chạy dev server | Đã chạy được http://localhost:5173/ |
| 2 | Sửa lỗi font tiếng Việt (mojibake) trong index.html + browser.mjs | Hiển thị đúng tiếng Việt |
| 3 | Đảo phím A↔D trong browser.mjs | A sang phải, D sang trái |
| 4 | Tăng độ nhảy (6 → 15) trong game.mjs | Nhảy cao hơn |
| 5 | Thêm điều khiển chuột xoay camera (pointer lock) trong browser.mjs | Chuột xoay camera, Esc thoát |
| 6 | Đảo hướng chuột (chuột trái → camera phải) | Hoàn theo yêu cầu |
| 7 | Giới hạn bước xoay chuột (maxMouseDelta = 40) | Camera không quay mạnh đột ngột |
| 8 | Giảm nhảy (15 → 11), không damage khi trên không | Hoàn theo yêu cầu |
| 9 | Chạy `npm test`: 6/6 pass | Test contract pass |
| 10 | Cập nhật README.md, AGENTS.md, PHASE1_NOTES.md | Đã hoàn thiện docs |
| 11 | Commit + tag `phase-1` | Đang thực hiện |

Token ước tính Phase 1: ít (dùng chủ yếu sửa lỗi, điều khiển, docs, không sinh lại toàn bộ game).

## Retro
- Đạt: Game chạy được trên trình duyệt, test contract 6/6 pass, font tiếng Việt đã sửa, điều khiển theo yêu cầu.
- Chưa có: Video demo (sẽ làm ở Phase 4).
- Cải tiến harness: Nên đọc test file trước khi yêu cầu AI sửa code để tránh sai hướng.

## Bằng chứng kiểm chứng
- `npm test`: 6 tests pass (xem output terminal).
- Dev server: http://localhost:5173/ chạy ổn định.
- Tag `phase-1` sẽ được gắn trên commit này.