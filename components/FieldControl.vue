<template>
  <div class="field">
    <label>
      <span class="fname">{{ field.label }}</span>
      <span v-if="field.kind === 'textarea'" class="muted">（提示词）</span>
    </label>

    <textarea
      v-if="field.kind === 'textarea'"
      :value="modelValue"
      rows="3"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>

    <template v-else-if="field.kind === 'number'">
      <div v-if="field.isSeed" class="seed-row">
        <input type="number" :value="modelValue" @input="$emit('update:modelValue', num($event))" />
        <button class="btn small" type="button" @click="$emit('update:modelValue', randomSeed())">🎲 随机</button>
      </div>
      <input v-else type="number" :step="field.step" :value="modelValue" @input="$emit('update:modelValue', num($event))" />
    </template>

    <select
      v-else-if="field.kind === 'select'"
      :value="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="field.options && !field.options.includes(modelValue)" :value="modelValue">{{ modelValue }}（当前值）</option>
      <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
    </select>

    <label v-else-if="field.kind === 'bool'" style="display:flex;align-items:center;gap:8px">
      <input
        type="checkbox"
        style="width:auto"
        :checked="!!modelValue"
        @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
    </label>

    <input
      v-else-if="field.kind !== 'image'"
      type="text"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
interface FieldDef {
  uid: string; name: string; label: string
  kind: 'textarea' | 'number' | 'select' | 'bool' | 'text' | 'image'
  options?: string[]; step?: number; isSeed?: boolean; original: any
}
const props = defineProps<{ field: FieldDef; modelValue: any }>()
defineEmits<{ (e: 'update:modelValue', v: any): void }>()

function num(e: Event) {
  const v = (e.target as HTMLInputElement).value
  const n = Number(v)
  return v === '' || Number.isNaN(n) ? v : n
}
function randomSeed() {
  return Math.floor(Math.random() * 1e15)
}
</script>
