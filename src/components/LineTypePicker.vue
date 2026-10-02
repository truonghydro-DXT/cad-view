<template>
  <div class="line-type-picker" role="listbox" aria-label="Loại đường">
    <button
      v-for="item in REGION_LINE_TYPES"
      :key="item.id"
      type="button"
      role="option"
      class="line-type-picker__item"
      :class="{ 'is-active': modelValue === item.id }"
      :aria-selected="modelValue === item.id"
      :title="item.label"
      @click="$emit('update:modelValue', item.id)"
    >
      <svg class="line-type-picker__preview" viewBox="0 0 160 18" preserveAspectRatio="none">
        <line
          x1="6"
          y1="9"
          x2="154"
          y2="9"
          :stroke="color"
          :stroke-width="Math.max(1.4, width)"
          :stroke-dasharray="item.dasharray || undefined"
          :stroke-linecap="item.linecap || 'butt'"
        />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { REGION_LINE_TYPES, type RegionLineTypeId } from '../commands'

withDefaults(
  defineProps<{
    modelValue: RegionLineTypeId
    color: string
    width?: number
  }>(),
  { width: 2.6 }
)

defineEmits<{
  'update:modelValue': [value: RegionLineTypeId]
}>()
</script>

<style scoped>
.line-type-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.line-type-picker__item {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.line-type-picker__item:hover {
  border-color: #c0c4cc;
  background: #f5f7fa;
}

.line-type-picker__item.is-active {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff inset;
  background: #ecf5ff;
}

.line-type-picker__preview {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
