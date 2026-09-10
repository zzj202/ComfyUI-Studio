<template>
  <div class="field">
    <label v-if="!hideLabel">
      <span class="fname">{{ field.label }}</span>
      <span v-if="field.kind === 'textarea'" class="muted">（提示词）</span>
    </label>

    <textarea
      v-if="field.kind === 'textarea'"
      :value="modelValue"
      rows="5"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>

    <template v-else-if="field.kind === 'number'">
      <div v-if="field.isSeed" class="seed-row">
        <input type="number" :value="modelValue" @input="$emit('update:modelValue', num($event))" />
        <button class="btn small" type="button" @click="$emit('update:modelValue', randomSeed())">🎲 随机</button>
      </div>
      <input v-else type="number" :step="field.step" :value="modelValue" @input="$emit('update:modelValue', num($event))" />
    </template>

    <!-- 可编辑下拉（combobox）：可手动输入任意值，也可从列表模糊筛选选择 -->
    <template v-else-if="field.kind === 'select' && editableCombo">
      <div class="combo">
        <input
          type="text"
          :value="modelValue"
          spellcheck="false"
          placeholder="输入或从列表选择"
          @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value); comboQ = ($event.target as HTMLInputElement).value; comboOpen = true"
          @focus="comboQ = ''; comboOpen = true"
          @blur="onComboBlur"
        />
        <span v-if="modelValue && !inOptions" class="combo-custom" title="手动输入的自定义值">自定义</span>
        <ul v-if="comboOpen && comboFiltered.length" class="combo-list">
          <li
            v-for="opt in comboFiltered"
            :key="opt"
            :class="{ cur: opt === modelValue }"
            @mousedown.prevent="$emit('update:modelValue', opt); comboOpen = false"
          >{{ opt }}</li>
        </ul>
      </div>
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
const props = defineProps<{ field: FieldDef; modelValue: any; hideLabel?: boolean }>()
defineEmits<{ (e: 'update:modelValue', v: any): void }>()

// ---------- 可编辑下拉（lora_name 等需要手输的字段） ----------
const editableCombo = computed(() => props.field.name === 'lora_name')
const comboOpen = ref(false)
const comboQ = ref('') // 空字符串 = 展示全部；非空 = 模糊过滤
const inOptions = computed(() => (props.field.options || []).includes(props.modelValue))
const comboFiltered = computed(() => {
  const opts = props.field.options || []
  const q = comboQ.value.trim().toLowerCase()
  if (!q) return opts
  return opts.filter(o => o.toLowerCase().includes(q))
})
function onComboBlur() {
  // mousedown.prevent 已阻止抢焦，留个小延迟兜底
  setTimeout(() => { comboOpen.value = false }, 120)
}

function num(e: Event) {
  const v = (e.target as HTMLInputElement).value
  const n = Number(v)
  return v === '' || Number.isNaN(n) ? v : n
}
function randomSeed() {
  return Math.floor(Math.random() * 1e15)
}
</script>
