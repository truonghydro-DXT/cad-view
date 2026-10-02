<template>
	<el-tooltip placement="bottom" effect="dark" content="Xuất PDF theo layer đang bật trên menu Layer; Adobe/Foxit có bảng Layers để bật/tắt">
		<el-button type="primary" :loading="exporting" :disabled="!ready" @click="openExportDialog">
			{{ exporting ? 'Đang xuất PDF...' : buttonText }}
		</el-button>
	</el-tooltip>

	<el-dialog v-model="exportDialogVisible" title="Tùy chọn xuất PDF" width="420px" :close-on-click-modal="false">
		<el-form label-position="top">
			<el-form-item label="Khổ giấy">
				<el-select v-model="exportOptions.paperSize" style="width: 100%">
					<el-option
						v-for="option in paperSizeOptions"
						:key="option.value"
						:label="option.label"
						:value="option.value"
					/>
				</el-select>
			</el-form-item>

			<el-form-item label="Hướng giấy">
				<el-select v-model="exportOptions.orientation" style="width: 100%">
					<el-option
						v-for="option in orientationOptions"
						:key="option.value"
						:label="option.label"
						:value="option.value"
					/>
				</el-select>
			</el-form-item>

			<p class="export-pdf-note">PDF theo layer đang bật trên menu Layer. Adobe Reader / Foxit có bảng Layers để bật tắt lớp.</p>
		</el-form>

		<template #footer>
			<div>
				<el-button @click="exportDialogVisible = false">Hủy</el-button>
				<el-button type="primary" :loading="exporting" @click="confirmExportPdf">Xuất PDF</el-button>
			</div>
		</template>
	</el-dialog>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { reactive, ref } from 'vue'

import { exportCurrentDrawingToPdf, type PdfOrientation, type PdfPaperSize } from './commands/exportPdf'

const props = withDefaults(
	defineProps<{
		fileName?: string
		buttonText?: string
		ready?: boolean
	}>(),
	{
		fileName: 'ban-ve.pdf',
		buttonText: 'Xuất PDF',
		ready: true
	}
)

const exporting = ref(false)
const exportDialogVisible = ref(false)
const exportOptions = reactive({
	paperSize: 'A4' as PdfPaperSize,
	orientation: 'auto' as PdfOrientation
})

const paperSizeOptions: Array<{ label: string; value: PdfPaperSize }> = [
	{ label: 'A4', value: 'A4' },
	{ label: 'A3', value: 'A3' },
	{ label: 'A2', value: 'A2' },
	{ label: 'Letter', value: 'Letter' },
	{ label: 'Legal', value: 'Legal' }
]

const orientationOptions: Array<{ label: string; value: PdfOrientation }> = [
	{ label: 'Tự động', value: 'auto' },
	{ label: 'Dọc (Portrait)', value: 'portrait' },
	{ label: 'Ngang (Landscape)', value: 'landscape' }
]

const openExportDialog = () => {
	if (exporting.value || !props.ready) {
		return
	}
	exportDialogVisible.value = true
}

const confirmExportPdf = async () => {
	if (exporting.value) {
		return
	}

	exporting.value = true
	try {
		const result = await exportCurrentDrawingToPdf({
			paperSize: exportOptions.paperSize,
			orientation: exportOptions.orientation,
			fileName: props.fileName
		})
		if (!result.ok) {
			ElMessage.error(result.message)
			return
		}
		ElMessage.success(result.message)
		exportDialogVisible.value = false
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		ElMessage.error(detail || 'Xuất PDF thất bại')
	} finally {
		exporting.value = false
	}
}
</script>

<style scoped>
.export-pdf-note {
	margin: 0;
	font-size: 12px;
	line-height: 1.5;
	color: #606266;
}
</style>
