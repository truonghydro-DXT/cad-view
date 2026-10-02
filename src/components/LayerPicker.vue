<template>
  <div class="layer-picker">
    <span class="layer-picker__label">Lớp vẽ</span>
    <div class="layer-picker__current">
      Đang chọn: <strong>{{ store.drawLayer || 'chưa chọn' }}</strong>
    </div>

    <div class="layer-picker__create">
      <span class="layer-picker__sub">Tạo lớp mới</span>
      <div class="layer-picker__create-row">
        <input
          v-model="newName"
          class="layer-picker__search"
          type="text"
          placeholder="Nhập tên lớp mới..."
          @keydown.enter.prevent="createNewLayer"
        />
        <el-button type="primary" size="small" @click="createNewLayer">Tạo mới</el-button>
      </div>
    </div>

    <input
      v-model="query"
      class="layer-picker__search"
      type="search"
      placeholder="Tìm lớp có sẵn... (gõ tên, không cần dấu)"
      @focus="onFocus"
      @input="open = true"
      @keydown.enter.prevent="selectFirst"
      @keydown.escape="open = false"
    />
    <ul v-if="open || showList" class="layer-picker__list">
      <li
        v-for="layer in filteredLayers"
        :key="layer.name"
        class="layer-picker__item"
        :class="{
          'is-active': layer.name === store.drawLayer,
          'is-locked': layer.isLocked
        }"
        @mousedown.prevent="selectLayer(layer.name)"
      >
        <button
          type="button"
          class="layer-picker__vis"
          :title="layer.isOff ? 'Hiện lớp' : 'Ẩn lớp'"
          @mousedown.prevent.stop="toggleVisible(layer)"
        >
          {{ layer.isOff ? 'Ẩn' : 'Hiện' }}
        </button>
        <span class="layer-picker__name">{{ layer.name }}</span>
        <span v-if="layer.isLocked" class="layer-picker__tag">khóa</span>
      </li>
      <li v-if="filteredLayers.length === 0" class="layer-picker__empty">
        Không thấy lớp "{{ query.trim() }}". Dùng ô Tạo lớp mới phía trên.
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'

import {
  activateDrawLayer,
  createDrawLayer,
  DRAW_LAYER_BY_TOOL,
  listDrawLayers,
  setLayerVisible,
  type DrawLayerInfo
} from '../commands'
import { store } from '../store'

const props = withDefaults(
  defineProps<{
    tool?: keyof typeof DRAW_LAYER_BY_TOOL
    showList?: boolean
  }>(),
  {
    showList: false
  }
)

const layers = ref<DrawLayerInfo[]>([])
const query = ref('')
const newName = ref('')
const open = ref(props.showList)

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()

const filteredLayers = computed(() => {
  const needle = normalize(query.value)
  if (!needle) {
    return layers.value
  }
  return layers.value.filter((layer) => normalize(layer.name).includes(needle))
})

const refresh = () => {
  layers.value = listDrawLayers()
  if (!store.drawLayer && props.tool) {
    store.drawLayer = DRAW_LAYER_BY_TOOL[props.tool]
  }
  if (!layers.value.some((layer) => layer.name === store.drawLayer) && store.drawLayer) {
    layers.value = [{ name: store.drawLayer, isOff: false, isLocked: false }, ...layers.value]
  }
}

const applyLayer = (name: string) => {
  const result = activateDrawLayer(name)
  if (!result.ok) {
    ElMessage.warning(result.message)
    return false
  }
  query.value = name
  open.value = props.showList
  refresh()
  return true
}

const selectLayer = (name: string) => {
  applyLayer(name)
}

const toggleVisible = (layer: DrawLayerInfo) => {
  const result = setLayerVisible(layer.name, layer.isOff)
  if (!result.ok) {
    ElMessage.warning(result.message)
    return
  }
  refresh()
}

const selectFirst = () => {
  if (filteredLayers.value.length === 0) {
    ElMessage.warning('Không thấy lớp khớp. Hãy tạo lớp mới ở ô phía trên.')
    return
  }
  applyLayer(filteredLayers.value[0].name)
}

const createNewLayer = () => {
  const result = createDrawLayer(newName.value)
  if (!result.ok) {
    ElMessage.warning(result.message)
    return
  }

  query.value = result.layer
  newName.value = ''
  open.value = props.showList
  refresh()
  if (result.created) {
    ElMessage.success(`Đã tạo lớp "${result.layer}".`)
    return
  }
  ElMessage.info(`Lớp "${result.layer}" đã có, đang dùng lớp này.`)
}

const onFocus = () => {
  refresh()
  open.value = true
}

onMounted(refresh)
</script>

<style scoped>
.layer-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.layer-picker__label {
  font-size: 13px;
  font-weight: 600;
}

.layer-picker__sub {
  font-size: 12px;
  color: #606266;
}

.layer-picker__current {
  font-size: 12px;
  color: #606266;
}

.layer-picker__create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed #c6e2ff;
  border-radius: 6px;
  background: #f5faff;
}

.layer-picker__create-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.layer-picker__create-row .layer-picker__search {
  flex: 1;
}

.layer-picker__search {
  width: 100%;
  height: 32px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  padding: 0 8px;
  font-size: 14px;
  color: #303133;
  background: #fff;
}

.layer-picker__search:focus {
  outline: none;
  border-color: #409eff;
}

.layer-picker__list {
  max-height: 168px;
  overflow: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  background: #fff;
}

.layer-picker__item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 6px 8px;
  font-size: 13px;
  cursor: pointer;
}

.layer-picker__name {
  flex: 1;
  min-width: 0;
}

.layer-picker__vis {
  flex: none;
  height: 22px;
  padding: 0 6px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 11px;
  cursor: pointer;
}

.layer-picker__vis:hover {
  border-color: #409eff;
  color: #409eff;
}

.layer-picker__item:hover,
.layer-picker__item.is-active {
  background: #ecf5ff;
  color: #409eff;
}

.layer-picker__item.is-locked {
  opacity: 0.65;
}

.layer-picker__tag,
.layer-picker__empty {
  font-size: 12px;
  color: #909399;
}

.layer-picker__empty {
  padding: 8px;
}
</style>
