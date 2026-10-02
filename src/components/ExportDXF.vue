<template>
  <div class="export-dxf-group">
    <el-tooltip placement="bottom" effect="dark" content="Xuất bằng ezdxf: giữ nguyên file gốc, thêm phần vẽ mới">
      <el-button type="success" :loading="exporting === 'merged'" :disabled="!ready || !!exporting" @click="exportDxf">
        {{ exporting === 'merged' ? 'Đang xuất DXF...' : 'Xuất DXF' }}
      </el-button>
    </el-tooltip>
    <el-tooltip placement="bottom" effect="dark" content="Xuất bằng ezdxf: chỉ khung mẫu, giữ nguyên tọa độ file gốc">
      <el-button type="warning" :loading="exporting === 'sheet'" :disabled="!ready || !!exporting" @click="exportSheet">
        {{ exporting === 'sheet' ? 'Đang xuất khung mẫu...' : 'Xuất khung mẫu' }}
      </el-button>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { nextTick, ref } from 'vue'

import { exportCurrentDrawingToDxf, exportSheetTemplateToDxf } from '../commands/exportDxf'

defineProps<{
  ready?: boolean
}>()

const exporting = ref<'merged' | 'sheet' | ''>('')

const runExport = async (mode: 'merged' | 'sheet', action: () => Promise<{ ok: boolean; message: string }>) => {
  if (exporting.value) {
    return
  }

  exporting.value = mode
  await nextTick()
  await new Promise((resolve) => window.setTimeout(resolve, 30))

  try {
    const result = await action()
    if (!result.ok) {
      ElMessage.error(result.message)
      return
    }
    ElMessage.success(result.message)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    ElMessage.error(detail || 'Không xuất được DXF.')
  } finally {
    exporting.value = ''
  }
}

const exportDxf = () => runExport('merged', exportCurrentDrawingToDxf)
const exportSheet = () => runExport('sheet', exportSheetTemplateToDxf)
</script>

<style scoped>
.export-dxf-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
</style>
