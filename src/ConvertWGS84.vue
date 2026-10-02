<template>
	<div class="convert-page" :class="{ embedded }">
		<el-card class="convert-card" shadow="never">
			<template #header>
				<div class="header-row">
					<h2>{{ keepCrs ? 'DWG → DXF (EPSG:3857)' : 'VN2000 → WGS 84' }}</h2>
					<span class="header-note">{{ keepCrs ? 'Giữ Web Mercator EPSG:3857' : 'DXF/DWG → Web Mercator EPSG:3857' }}</span>
				</div>
			</template>

			<div class="pipeline-steps">
				<template v-if="keepCrs && inputIsDwg">
					<span :class="{ active: convertStage === 'idle' || convertStage === 'read-source' }">1. aspose-cad</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'vn2000-to-wgs84' || convertStage === 'export-dxf' || convertStage === 'done' }">2. Xuất DXF (giữ tọa độ)</span>
				</template>
				<template v-else-if="keepCrs">
					<span :class="{ active: convertStage === 'idle' || convertStage === 'read-source' }">1. Đọc DXF</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'vn2000-to-wgs84' || convertStage === 'export-dxf' || convertStage === 'done' }">2. Xuất DXF (giữ tọa độ)</span>
				</template>
				<template v-else-if="inputIsDwg">
					<span :class="{ active: convertStage === 'idle' || convertStage === 'read-source' }">1. aspose-cad</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'vn2000-to-wgs84' }">2. convert_dxf2dxf.py</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'export-dxf' || convertStage === 'done' }">3. Xuất DXF 3857</span>
				</template>
				<template v-else>
					<span :class="{ active: convertStage === 'idle' || convertStage === 'read-source' }">1. Đọc DXF</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'vn2000-to-wgs84' }">2. convert_dxf2dxf.py</span>
					<span class="pipeline-sep">→</span>
					<span :class="{ active: convertStage === 'export-dxf' || convertStage === 'done' }">3. Xuất DXF 3857</span>
				</template>
			</div>

			<div class="grid-layout">
				<section class="panel">
					<h3>1) File nguồn (DXF / DWG)</h3>
					<el-upload
						drag
						:auto-upload="false"
						:show-file-list="true"
						:limit="1"
						accept=".dxf,.dwg"
						:on-change="handleFileChange"
						:on-remove="handleFileRemove"
						:before-upload="beforeUpload"
					>
						<template #trigger>
							<el-button type="primary" plain>Chọn file CAD (DXF/DWG)</el-button>
						</template>
						<el-icon class="upload-icon" size="48">
							<UploadFilled />
						</el-icon>
					</el-upload>
					<p v-if="selectedFileName" class="selected-file">
						Đã chọn: {{ selectedFileName }}
						<span class="input-kind">({{ inputIsDwg ? 'luồng DWG' : 'luồng DXF' }})</span>
					</p>
				</section>

				<section class="panel">
					<h3>2) Hệ tọa độ</h3>
					<el-radio-group v-model="keepCrs" class="crs-mode">
						<el-radio :value="false">Chuyển VN2000 → Web Mercator (EPSG:3857)</el-radio>
						<el-radio :value="true">Đã là Web Mercator (EPSG:3857) — giữ nguyên tọa độ</el-radio>
					</el-radio-group>
					<p v-if="keepCrs" class="keep-crs-hint">
						File đã là EPSG:3857. Chỉ đổi DWG → DXF, không đổi tọa độ.
					</p>
					<el-form v-else label-position="top">
						<el-form-item label="Tỉnh / kinh tuyến trục">
							<el-select v-model="presetId" placeholder="Chọn preset" style="width: 100%">
								<el-option
									v-for="preset in projectionPresets"
									:key="preset.id"
									:label="preset.label"
									:value="preset.id"
								/>
							</el-select>
						</el-form-item>

						<el-form-item v-if="presetId === 'custom'" label="Kinh tuyến trục (lon_0)">
							<el-input-number v-model="centralMeridian" :step="0.25" :precision="2" :controls="false" style="width: 100%" />
						</el-form-item>
					</el-form>
				</section>
			</div>

			<section class="actions">
				<el-button type="primary" :loading="isConverting" :disabled="!selectedFile" @click="runConvertPipeline">
					{{ keepCrs ? 'Chuyển sang DXF' : 'Convert to WGS 84 DXF' }}
				</el-button>
				<el-button :disabled="!convertedBlob" @click="downloadConvertedDxf">
					Tải DXF đã chuyển
				</el-button>
				<el-button text @click="resetForm">Reset</el-button>
			</section>

			<section class="result" v-if="resultMessage">
				<el-alert :title="resultMessage" :type="resultType" show-icon :closable="false" />
			</section>
		</el-card>
	</div>
</template>

<script setup lang="ts">
import { UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadProps } from 'element-plus'
import { computed, ref } from 'vue'

import { VN2000_TM_PRESETS } from './generated/vn2000TmPresets'

defineProps<{
	embedded?: boolean
}>()

const projectionPresets = [
	{ id: 'auto', label: 'Tự nhận diện kinh tuyến (theo tọa độ DXF)', lon0: 0 },
	...VN2000_TM_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, lon0: preset.lon0 })),
	{ id: 'custom', label: 'Tùy chọn kinh tuyến trục (--cm)', lon0: 105 }
]

const SUPPORTED_EXTENSIONS = ['.dxf', '.dwg'] as const

type ConvertStage = 'idle' | 'read-source' | 'vn2000-to-wgs84' | 'export-dxf' | 'done'

const presetId = ref<string>('auto')
const keepCrs = ref(false)
const centralMeridian = ref<number>(105)
const selectedFile = ref<File | null>(null)
const selectedFileName = ref<string>('')
const convertedBlob = ref<Blob | null>(null)
const outputFileName = ref<string>('')
const resultMessage = ref<string>('')
const resultType = ref<'success' | 'warning' | 'error'>('success')
const isConverting = ref<boolean>(false)
const convertStage = ref<ConvertStage>('idle')

const getFileExtension = (fileName: string): string => {
	const lowerName = fileName.toLowerCase()
	const lastDotIndex = lowerName.lastIndexOf('.')
	return lastDotIndex < 0 ? '' : lowerName.slice(lastDotIndex)
}

const isSupportedCadFile = (fileName: string) =>
	SUPPORTED_EXTENSIONS.includes(getFileExtension(fileName) as (typeof SUPPORTED_EXTENSIONS)[number])

const inputIsDwg = computed(() => selectedFile.value != null && getFileExtension(selectedFile.value.name) === '.dwg')

const selectedPreset = computed(() => projectionPresets.find((item) => item.id === presetId.value))

const convertWithPython = async (fileBlob: Blob, sourceName: string) => {
	const baseName = sourceName.replace(/\.(dxf|dwg)$/i, '')
	const fileName = keepCrs.value ? `${baseName}.dxf` : `${baseName}-wgs84.dxf`
	const headers: Record<string, string> = {
		'Content-Type': 'application/octet-stream',
		'X-Convert-File-Name': encodeURIComponent(sourceName),
		'X-Convert-Output-Name': encodeURIComponent(fileName),
		'X-Convert-Preset': encodeURIComponent(presetId.value)
	}
	if (keepCrs.value) {
		headers['X-Convert-Keep-Crs'] = '1'
	}
	if (presetId.value === 'custom') {
		headers['X-Convert-Cm'] = String(centralMeridian.value)
	} else if (selectedPreset.value?.lon0 && presetId.value !== 'auto') {
		headers['X-Convert-Cm'] = String(selectedPreset.value.lon0)
	}

	let response: Response
	try {
		response = await fetch('/api/convert-vn2000', {
			method: 'POST',
			headers,
			body: fileBlob
		})
	} catch {
		throw new Error('Không gọi được convert VN2000. Hãy chạy lại pnpm dev.')
	}

	if (!response.ok) {
		let detail = ''
		try {
			const errorBody = (await response.json()) as { message?: string }
			detail = errorBody.message || ''
		} catch {
			detail = await response.text()
		}
		throw new Error(detail || 'Không chuyển được file.')
	}

	const blob = await response.blob()
	if (blob.size < 32) {
		throw new Error('File DXF tạo ra không hợp lệ.')
	}

	const entities = Number(response.headers.get('X-Convert-Entities') || 0)
	const source = decodeURIComponent(response.headers.get('X-Convert-Source') || '')
	const meridian = decodeURIComponent(response.headers.get('X-Convert-Meridian') || '')
	return { blob, fileName, entities, source, meridian }
}

const beforeUpload: UploadProps['beforeUpload'] = (file) => {
	if (!isSupportedCadFile(file.name)) {
		ElMessage.warning('Chỉ nhận file .dxf và .dwg')
		return false
	}
	return true
}

const handleFileChange: UploadProps['onChange'] = (uploadFile: UploadFile) => {
	if (!uploadFile.raw) {
		return
	}
	if (!isSupportedCadFile(uploadFile.raw.name)) {
		ElMessage.warning('Chỉ nhận file .dxf và .dwg')
		return
	}
	selectedFile.value = uploadFile.raw
	selectedFileName.value = uploadFile.raw.name
	if (getFileExtension(uploadFile.raw.name) === '.dwg') {
		keepCrs.value = true
	}
	convertedBlob.value = null
	outputFileName.value = ''
	resultMessage.value = ''
	convertStage.value = 'idle'
}

const handleFileRemove: UploadProps['onRemove'] = () => {
	selectedFile.value = null
	selectedFileName.value = ''
	convertedBlob.value = null
	outputFileName.value = ''
	resultMessage.value = ''
	convertStage.value = 'idle'
}

const runConvertPipeline = async () => {
	if (!selectedFile.value) {
		ElMessage.warning('Hãy chọn file DXF hoặc DWG trước')
		return
	}

	isConverting.value = true
	convertedBlob.value = null
	outputFileName.value = ''

	try {
		const inputWasDwg = getFileExtension(selectedFile.value.name) === '.dwg'
		convertStage.value = 'read-source'

		if (keepCrs.value && !inputWasDwg) {
			convertedBlob.value = selectedFile.value
			outputFileName.value = `${selectedFile.value.name.replace(/\.(dxf|dwg)$/i, '')}.dxf`
			convertStage.value = 'done'
			resultType.value = 'success'
			resultMessage.value = `DXF giữ nguyên hệ tọa độ gốc → ${outputFileName.value}`
			ElMessage.success(resultMessage.value)
			return
		}

		convertStage.value = inputWasDwg ? 'read-source' : 'vn2000-to-wgs84'
		const result = await convertWithPython(selectedFile.value, selectedFile.value.name)

		convertStage.value = 'export-dxf'
		convertedBlob.value = result.blob
		outputFileName.value = result.fileName
		convertStage.value = 'done'

		const sourceLabel = inputWasDwg ? 'DWG → aspose-cad →' : 'DXF →'
		if (keepCrs.value) {
			resultType.value = 'success'
			resultMessage.value = `${sourceLabel} DXF giữ EPSG:3857: ${result.entities.toLocaleString('vi-VN')} đối tượng → ${result.fileName}`
		} else {
			const meridian = result.meridian ? `, kinh tuyến ${result.meridian}` : ''
			const crsLabel = result.source ? ` (${result.source}${meridian})` : meridian
			resultType.value = 'success'
			resultMessage.value =
				`${sourceLabel} convert_dxf2dxf.py → EPSG:3857: ${result.entities.toLocaleString('vi-VN')} đối tượng${crsLabel} → ${result.fileName}`
		}
		ElMessage.success(resultMessage.value)
	} catch (error) {
		console.error(error)
		convertStage.value = 'idle'
		resultType.value = 'error'
		resultMessage.value = error instanceof Error ? error.message : keepCrs.value ? 'Không chuyển được DWG → DXF.' : 'Không chuyển được VN2000 → WGS 84.'
		ElMessage.error(resultMessage.value)
	} finally {
		isConverting.value = false
	}
}

const downloadConvertedDxf = () => {
	if (!convertedBlob.value || !outputFileName.value) {
		return
	}
	const url = URL.createObjectURL(convertedBlob.value)
	const link = document.createElement('a')
	link.href = url
	link.download = outputFileName.value
	link.click()
	URL.revokeObjectURL(url)
}

const resetForm = () => {
	selectedFile.value = null
	selectedFileName.value = ''
	convertedBlob.value = null
	outputFileName.value = ''
	resultMessage.value = ''
	convertStage.value = 'idle'
	presetId.value = 'auto'
	keepCrs.value = false
	centralMeridian.value = 105
}
</script>

<style scoped>
.convert-page {
	width: 100%;
	min-height: 100%;
	padding: 24px;
	background: linear-gradient(145deg, #edf4ff 0%, #f8fcff 48%, #f7fbf2 100%);
}

.convert-page.embedded {
	min-height: 0;
	padding: 0;
	background: transparent;
}

.convert-card {
	max-width: 1200px;
	margin: 0 auto;
}

.convert-card :deep(.el-card__header) {
	background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	border-bottom: none;
}

.convert-page.embedded .convert-card {
	max-width: none;
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
	border-radius: 16px;
	overflow: hidden;
}

.header-row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
}

.header-row h2 {
	margin: 0;
	font-size: 26px;
	color: #ffffff;
}

.header-note {
	color: rgba(255, 255, 255, 0.88);
	font-size: 13px;
}

.pipeline-steps {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 16px;
	padding: 10px 14px;
	background: #f0f6ff;
	border: 1px solid #c9dbf5;
	border-radius: 10px;
	font-size: 13px;
	color: #6a7d99;
}

.pipeline-steps span.active {
	color: #1256b8;
	font-weight: 600;
}

.pipeline-sep {
	color: #9aadc8;
}

.input-kind {
	margin-left: 6px;
	color: #1256b8;
	font-weight: 600;
}

.crs-mode {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 10px;
	margin-bottom: 14px;
}

.keep-crs-hint {
	margin: 0 0 4px;
	color: #3d5a80;
	font-size: 13px;
	line-height: 1.45;
}

.grid-layout {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 20px;
}

.panel {
	background: #ffffff;
	border: 1px solid #dbe6f7;
	border-radius: 12px;
	padding: 16px;
}

.panel h3 {
	margin-top: 0;
	margin-bottom: 14px;
	color: #21395f;
}

.upload-icon {
	color: #1a73e8;
}

.selected-file {
	margin: 10px 0 0;
	color: #2e476e;
}

.actions {
	margin-top: 20px;
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}

.result {
	margin-top: 14px;
}

@media (max-width: 900px) {
	.grid-layout {
		grid-template-columns: 1fr;
	}

	.convert-page {
		padding: 14px;
	}
}
</style>
