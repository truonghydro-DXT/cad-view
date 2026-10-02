# CAD Viewer

Ứng dụng demo Vue 3 để mở, xem và xử lý bản vẽ CAD định dạng DWG/DXF trong trình duyệt, với nhiều tính năng hỗ trợ công việc khảo sát, kiểm tra tọa độ và xuất dữ liệu.

Dự án sử dụng các gói `@mlightcad/cad-viewer`, `@mlightcad/cad-simple-viewer` và `@mlightcad/data-model` để hiển thị bản vẽ 2D/3D theo phong cách CAD, đồng thời tích hợp các tiện ích địa lý và chuyển đổi tọa độ VN2000/WGS84.

## Tính năng chính

- Mở file `.dwg` / `.dxf` từ máy tính hoặc kéo thả vào giao diện
- Hiển thị bản vẽ CAD với toolbar, layer, zoom/pan, grid và các công cụ chỉnh sửa cơ bản
- Hỗ trợ overlay nền bản đồ OSM (OpenStreetMap) để đối chiếu vị trí địa lý
- Chuyển đổi hệ tọa độ VN2000 -> WGS84 với dữ liệu hệ quy chiếu địa phương
- Xuất bản vẽ ra DXF và PDF
- Xử lý file lớn bằng cơ chế worker và fallback WebGL/fallback CPU
- Giao diện hỗ trợ đa ngôn ngữ và dễ tùy biến theo nhu cầu

## Công nghệ

- Vue 3 + Vite
- Element Plus
- TypeScript
- `@mlightcad/cad-viewer` / `@mlightcad/cad-simple-viewer`
- `@mlightcad/data-model`
- `proj4` và các tiện ích chuyển đổi tọa độ
- Python helper để chuẩn bị môi trường xử lý DXF/DWG

## Cấu trúc dự án

```text
.
├── src/                  # mã nguồn giao diện và logic CAD viewer
├── scripts/              # setup môi trường Python
├── extract-data-dxf/     # script chuyển đổi DWG/DXF
├── VN2000_TM/            # file định nghĩa hệ tọa độ VN2000 TM
├── data/                 # dữ liệu mẫu
├── src/assets/           # font, hình ảnh và tài nguyên nền tảng
├── dist/                 # output build
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── LICENSE
├── README.md
└── TODO.md
```

## Yêu cầu môi trường

- Node.js 18+
- pnpm
- Python 3 (để setup môi trường xử lý DXF/DWG)

## Khởi động nhanh

Cài đặt phụ thuộc:

```bash
pnpm install
```

Tạo môi trường Python cần thiết cho các script DWG/DXF:

```bash
pnpm setup:python
```

Chạy ứng dụng ở chế độ dev:

```bash
pnpm dev
```

Build production:

```bash
pnpm build
```

Preview bản build:

```bash
pnpm preview
```

## Ghi chú Windows / pnpm

Nếu đang dùng hệ thống lưu cache pnpm ở một ổ đĩa riêng, có thể cấu hình trước khi cài:

```bash
pnpm config set store-dir D:\.pnpm-store
```

Dự án cũng có file `run_server.bat` dùng cho môi trường Windows để tự kiểm tra dependencies và khởi động Vite.

## Biến môi trường tùy chọn

Một số tính năng có thể điều chỉnh bằng biến môi trường khi chạy dev/build:

```bash
VITE_FORCE_MAIN_THREAD_DRAW=true
VITE_ENABLE_OSM_OVERLAY=false
VITE_LARGE_FILE_MODE_THRESHOLD_MB=150
VITE_LARGE_FILE_MINIMUM_CHUNK_SIZE=12000
VITE_LARGE_FILE_RENDER_CHUNK_SIZE=800
VITE_PARSER_TIMEOUT_MAX_MS=600000
```

Mục đích:

- `VITE_FORCE_MAIN_THREAD_DRAW`: buộc renderer chạy theo fallback CPU
- `VITE_ENABLE_OSM_OVERLAY`: bật/tắt overlay OSM
- các biến `VITE_LARGE_FILE_*`: điều chỉnh xử lý file lớn
- `VITE_PARSER_TIMEOUT_MAX_MS`: tăng thời gian chờ worker parse file lớn

## Sử dụng ứng dụng

1. Mở trình duyệt theo local dev URL của Vite.
2. Chọn hoặc kéo thả file DWG/DXF vào màn hình chính.
3. Sử dụng các công cụ trên thanh công cụ để zoom, pan, chỉnh sửa và xem dữ liệu.
4. Nếu cần chuyển đổi hệ tọa độ, mở chức năng `VN2000 -> WGS84`.
5. Xuất ra PDF hoặc DXF khi cần chia sẻ / lưu trữ bản vẽ.

## License

[MIT](LICENSE)