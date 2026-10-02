export type ProjectionPreset = {
	id: string
	label: string
	lon0: number
	k0: number
	x0: number
	y0: number
	useTowgs84: boolean
	towgs84: string
}

// VN2000 seven-parameter shift (towgs84) commonly used for VN2000
const DEFAULT_TOWGS84 = '-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278'

// NOTE:
// This list is generated from VN2000_TM/*.prj (Transverse_Mercator):
// - False_Easting = 500000
// - False_Northing = 0
// - Central_Meridian comes from the suffix in filename: *_TM_10500 => 105.00, *_TM_10575 => 105.75, etc.
// - Scale_Factor appears as 0.9999 in provided PRJ files.
export const VN2000_TM_PRESETS: ProjectionPreset[] = [
	{ id: 'AnGiang_34Tinh_VN2000_TM_10475', label: 'Tỉnh An Giang', lon0: 104.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'BacNinh_34Tinh_VN2000_TM_10700', label: 'Tỉnh Bắc Ninh', lon0: 107.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'CaMau_34Tinh_VN2000_TM_10450', label: 'Tỉnh Cà Mau', lon0: 104.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'CanTho_34Tinh_VN2000_TM_10500', label: 'TP. Cần Thơ', lon0: 105.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'CaoBang_34Tinh_VN2000_TM_10575', label: 'Tỉnh Cao Bằng', lon0: 105.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'DakLak_34Tinh_VN2000_TM_10850', label: 'Tỉnh Đắk LắK', lon0: 108.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'DaNang_34Tinh_VN2000_TM_10775', label: 'TP. Đà Nẵng', lon0: 107.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'DienBien_34Tinh_VN2000_TM_10300', label: 'Tỉnh Điện Biên', lon0: 103.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'DongNai_34Tinh_VN2000_TM_10775', label: 'Tỉnh Đồng Nai', lon0: 107.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'DongThap_34Tinh_VN2000_TM_10500', label: 'Tỉnh Đồng Tháp', lon0: 105.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'GiaLai_34Tinh_VN2000_TM_10825', label: 'Tỉnh Gia Lai', lon0: 108.25, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'HaiPhong_34Tinh_VN2000_TM_10575', label: 'TP. Hải Phòng', lon0: 105.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'HaNoi_34Tinh_VN2000_TM_10500', label: 'TP. Hà Nội', lon0: 105.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'HaTinh_34Tinh_VN2000_TM_10550', label: 'Tỉnh Hà Tĩnh', lon0: 105.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'Hue_34Tinh_VN2000_TM_10700', label: 'TP. Huế', lon0: 107.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'HungYen_34Tinh_VN2000_TM_10550', label: 'Tỉnh Hưng Yên', lon0: 105.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'KhanhHoa_34Tinh_VN2000_TM_10825', label: 'Tỉnh Khánh Hòa', lon0: 108.25, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'LaiChau_34Tinh_VN2000_TM_10475', label: 'Tỉnh Lai Châu', lon0: 104.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'LamDong_34Tinh_VN2000_TM_10775', label: 'Tỉnh Lâm Đồng', lon0: 107.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'LangSon_34Tinh_VN2000_TM_10725', label: 'Tỉnh Lạng Sơn', lon0: 107.25, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'LaoCai_34Tinh_VN2000_TM_10475', label: 'Tỉnh Lào Cai', lon0: 104.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'NgheAn_34Tinh_VN2000_TM_10475', label: 'Tỉnh Nghệ An', lon0: 104.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'NinhBinh_34Tinh_VN2000_TM_10500', label: 'Tỉnh Ninh Bình', lon0: 105.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'PhuTho_34Tinh_VN2000_TM_10475', label: 'Tỉnh Phú Thọ', lon0: 104.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'QuangNgai_34Tinh_VN2000_TM_10800', label: 'Tỉnh Quảng Ngãi', lon0: 108.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'QuangNinh_34Tinh_VN2000_TM_10775', label: 'Tỉnh Quảng Ninh', lon0: 107.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'QuangTri_34Tinh_VN2000_TM_10600', label: 'Tỉnh Quảng Trị', lon0: 106.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'SonLa_34Tinh_VN2000_TM_10400', label: 'Tỉnh Sơn La', lon0: 104.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'TayNinh_34Tinh_VN2000_TM_10575', label: 'Tỉnh Tây Ninh', lon0: 105.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'ThaiNguyen_34Tinh_VN2000_TM_10650', label: 'Tỉnh Thái Nguyên', lon0: 106.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'ThanhHoa_34Tinh_VN2000_TM_10500', label: 'Tỉnh Thanh Hóa', lon0: 105.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'TPHoChiMinh_34Tinh_VN2000_TM_10575', label: 'TP. Hồ Chí Minh', lon0: 105.75, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'TuyenQuang_34Tinh_VN2000_TM_10600', label: 'Tỉnh Tuyên Quang', lon0: 106.0, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 },
	{ id: 'VinhLong_34Tinh_VN2000_TM_10550', label: 'Tỉnh Vĩnh Long', lon0: 105.5, k0: 0.9999, x0: 500000, y0: 0, useTowgs84: true, towgs84: DEFAULT_TOWGS84 }
]

