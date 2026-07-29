<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorState, type Range } from '@codemirror/state'
import {
  EditorView,
  Decoration,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let suppress = false

function buildDecorations(v: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const re = /\{\{(\w+)\}\}/g
  for (const { from, to } of v.visibleRanges) {
    const text = v.state.sliceDoc(from, to)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = from + m.index
      decos.push(Decoration.mark({ class: 'seg-var' }).range(start, start + m[0].length))
    }
  }
  return Decoration.set(decos, true)
}

const varHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(v: EditorView) {
      this.decorations = buildDecorations(v)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

const changeListener = EditorView.updateListener.of((u) => {
  if (u.docChanged && !suppress) {
    emit('update:modelValue', u.state.doc.toString())
  }
})

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue || '',
      extensions: [
        history(),
        EditorView.lineWrapping,
        varHighlight,
        changeListener,
        keymap.of([...defaultKeymap, ...historyKeymap])
      ]
    }),
    parent: host.value
  })
})

watch(
  () => props.modelValue,
  (val) => {
    if (!view) return
    const cur = view.state.doc.toString()
    if (val !== cur) {
      suppress = true
      view.dispatch({ changes: { from: 0, to: cur.length, insert: val || '' } })
      suppress = false
    }
  }
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="host" class="seg-item__edit cn-cm-editor"></div>
</template>
