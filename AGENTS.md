# AGENTS.md — Harness AI (Phase 3)

## Mục tiêu harness
Điều phối AI (Claude/Cline) để xây game "Đảo Đèn Lồng" theo Test Contract v1.0, đảm bảo:
- Chơi được 3 Đêm từ đầu tới thắng/thua theo luật giữ đèn sáng đến bình minh.
- Tuân thủ Contract v1.2 và chế độ headless (`src/headless.mjs`).
- Tất cả tests trong `tests/contract.test.mjs` pass.

## Kỹ năng (skills) đã dùng
- Sửa mã nguồn game (`src/game.mjs`, `src/browser.mjs`).
- Chỉnh HTML (`index.html`) sửa lỗi font tiếng Việt.
- Viết/cập nhật `README.md` (cài đặt, điều khiển, tính điểm).
- Chạy `npm install`, `npm run dev`, `npm test`.
- Git: commit, tag `phase-1`.
- Phase 3: nhiên liệu đèn, Bóng Mực hút dầu, thắng bình minh và bảng màu dễ phân biệt.

## Hooks / quy trình làm việc với AI
1. **Requirements trước:** Đọc `game.contract.json` và `tests/contract.test.mjs` trước khi yêu cầu AI viết/sửa code.
2. **Plan trước khi build:** Ghi spec/giả định và ADR trong `docs/notes/PHASE3_NOTES.md`.
3. **Verify thật:** Chạy `npm test` và `npm run dev`, chơi thực tế trên trình duyệt. Không tin lời "agent bảo chạy rồi".
4. **Evaluate & retro:** Ghi nhận sai lầm của AI và điều chỉnh harness trong `PHASE3_NOTES.md`.

## Giới hạn
- Không commit API key, token, `.env`.
- AI chỉ hỗ trợ viết code; quyết định thiết kế và kiểm chứng do con người thực hiện.
- Không commit API key, token hay `.env`; kiểm chứng Phase 3 phải có test contract và proof trình duyệt.
