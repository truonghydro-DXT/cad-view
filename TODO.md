# TODO

- [ ] Chỉnh `src/FontCAD.vue` để preload font theo loại file:
  - DWG: load full font (manifest `src/assets/fonts/fonts.json`)
  - DXF: load chỉ 4 font (manifest `src/assets/fonts1/fonts.json`)
  - Không preload full font ở `@create`.
- [ ] Sửa lại logic `src/FontCAD.vue` sau các chỉnh sửa tạm để loại lỗi TypeScript (nếu có).

- [x] Cập nhật `src/ConvertWGS84.vue`: tính bbox từ các cặp tọa độ sau khi convert.
- [ ] (Nếu có) Bổ sung logic lọc text/entity ngoài bbox trong DXF (cần spec entity/text + ví dụ DXF).

