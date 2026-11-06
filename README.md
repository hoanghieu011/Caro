# Cờ Caro 50 × 50 — Thách Đấu

Game cờ caro 50 × 50 — chơi với máy giao diện tối kiểu bàn cờ gỗ, chạy hoàn toàn trong trình duyệt.

## Mở game

Bấm đúp vào **`co-caro-50x50.html`** (hoặc `index.html`) để chơi. Không cần cài đặt, không cần mạng, không cần chạy server.

## Tính năng

- Bàn cờ **50 × 50**, thắng khi nối **5 quân trở lên** theo hàng, cột hoặc chéo.
- Hai chế độ:
  - **Người vs Máy**: 3 độ khó **Vừa / Khó / Siêu khó** (mặc định).
  - **Máy vs Máy**: hai bot đều ở mức **Siêu khó**, tự chơi liên tục, tối đa **30 giây** suy nghĩ mỗi nước.
- Chọn bên đi trước: người/bot Đen hoặc máy/bot Trắng.
- Ở chế độ Máy vs Máy: có **Tạm dừng / Tiếp tục**, đồng hồ đếm ngược và thanh tiến trình 30 giây.
- **Đi lại**, **Gợi ý**, **Ván mới** (Đi lại/Gợi ý dành cho chế độ Người vs Máy).
- Phóng to / thu nhỏ / vừa khung; kéo bàn cờ; chụm hai ngón trên điện thoại.
- Hiển thị tọa độ, lịch sử nước đi, đánh dấu nước cuối, đường thắng.
- Âm thanh đặt quân/chiến thắng có thể bật tắt.
- Lưu lại chế độ, độ khó, người đi trước và cài đặt âm thanh trên trình duyệt.
- Responsive cho cả máy tính và điện thoại.

## Bộ máy AI

- Đánh giá bàn cờ theo mẫu (open four, four, open three, chuỗi quân).
- Cập nhật điểm tăng dần: mỗi nước chỉ tính lại 4 đường đi qua nó, giúp tìm kiếm nhanh.
- Sắp xếp nước đi theo mối đe dọa của cả hai bên.
- **VCF** — tìm chuỗi thắng bằng các nước tạo “tứ” liên hoàn, ép đối thủ chặn từng bước.
- **Alpha-beta** với tìm kiếm sâu dần, cắt tỉa và giới hạn thời gian.
- Chặn thắng ngay, chặn bốn, ưu tiên tứ mở / ba mở / đòn đôi.
- Chạy trong **Web Worker** để giao diện không bị đứng khi máy suy nghĩ.
- Chế độ Máy vs Máy: engine có ngân sách tối đa **29,5 giây** và watchdog phía giao diện cắt ở **30 giây**; nếu quá hạn sẽ chọn nước dự phòng để ván đấu tiếp tục.

Ở chế độ Người vs Máy, mức Siêu khó thường mất khoảng 2–3 giây mỗi nước. Ở chế độ Máy vs Máy, bot có thể nghĩ lâu hơn nhưng không quá 30 giây.

## Cấu trúc dự án

- `co-caro-50x50.html` — bản đóng gói một tệp, mở trực tiếp.
- `index.html` — bản sao của tệp trên.
- `src/engine.js` — bộ máy AI.
- `src/app.js` — giao diện, canvas, luồng ván cờ.
- `src/style.css` — giao diện.
- `src/index.template.html` — khung HTML.
- `build.js` — đóng gói thành một tệp HTML duy nhất.

## Chỉnh sửa / đóng gói lại

```powershell
node build.js
```

Lệnh này tạo lại `index.html` và `co-caro-50x50.html`.
