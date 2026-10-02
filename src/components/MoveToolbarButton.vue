<template>
  <Teleport v-if="host" :to="host">
    <el-button
      class="ml-toolbar-button ml-draw-move-button"
      :class="{ 'is-active': isActive }"
      title="Move: nhấn giữ đối tượng rồi kéo thả"
      @click="toggleMoveTool"
    >
      <el-icon :size="20">
        <Rank />
      </el-icon>
    </el-button>
  </Teleport>
</template>

<script setup lang="ts">
import { Rank } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { activateMoveMode, deactivateMoveMode } from '../commands'
import { store } from '../store'

const props = defineProps<{
  ready?: boolean
}>()

const host = ref<Element | null>(null)
const isActive = computed(() => store.activeDrawTool === 'move')
let observer: MutationObserver | null = null

const findHost = () =>
  document.querySelector('.ml-vertical-toolbar-container .ml-toolbar-group')

const bindHost = () => {
  host.value = props.ready ? findHost() : null
}

const toggleMoveTool = () => {
  if (!props.ready) {
    ElMessage.warning('Hãy mở bản vẽ trước khi di chuyển.')
    return
  }

  if (store.activeDrawTool === 'move') {
    deactivateMoveMode()
    return
  }

  store.tableEditor.visible = false
  store.tableEditor.mode = 'create'
  store.tableEditor.annotationId = null
  store.tableEditor.sheetTableRole = null
  store.tableCellEditor.visible = false
  store.tableCellEditor.sheetTableRole = null
  store.textEditor.visible = false
  store.textEditor.mode = 'create'
  store.textEditor.annotationId = null
  store.textEditor.sheetRole = null
  store.textEditor.popupX = null
  store.textEditor.popupY = null
  store.regionPanelVisible = false
  store.linePanelVisible = false
  activateMoveMode()
}

watch(
  () => props.ready,
  () => {
    bindHost()
    if (!props.ready || host.value) {
      return
    }
    requestAnimationFrame(bindHost)
  },
  { immediate: true }
)

observer = new MutationObserver(() => {
  const next = props.ready ? findHost() : null
  if (next !== host.value) {
    host.value = next
  }
})
observer.observe(document.body, { childList: true, subtree: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<style>
.ml-draw-move-button.ml-toolbar-button {
  width: 30px;
  height: 30px;
  padding: 5px;
  min-width: 30px;
}

.ml-draw-move-button.ml-toolbar-button.is-active {
  color: var(--el-color-primary);
}
</style>
