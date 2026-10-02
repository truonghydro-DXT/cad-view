<template>
  <div class="stroke-width-picker" role="listbox" aria-label="Kích thước đường">
    <button
      v-for="item in STROKE_WIDTHS"
      :key="item"
      type="button"
      role="option"
      class="stroke-width-picker__item"
      :class="{ 'is-active': modelValue === item }"
      :aria-selected="modelValue === item"
      :title="`${item} px`"
      @click="$emit('update:modelValue', item)"
    >
      <span class="stroke-width-picker__bar" :style="{ height: `${item}px`, background: color }" />
      <span class="stroke-width-picker__label">{{ item }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { STROKE_WIDTHS } from '../commands'

defineProps<{
  modelValue: number
  color: string
}>()

defineEmits<{
  'update:modelValue': [value: number]
}>()
</script>

<style scoped>
.stroke-width-picker {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.stroke-width-picker__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  height: 40px;
  padding: 4px 2px 3px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.stroke-width-picker__item:hover {
  border-color: #c0c4cc;
  background: #f5f7fa;
}

.stroke-width-picker__item.is-active {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff inset;
  background: #ecf5ff;
}

.stroke-width-picker__bar {
  width: 70%;
  border-radius: 99px;
}

.stroke-width-picker__label {
  font-size: 11px;
  line-height: 1;
  color: #606266;
}
</style>
