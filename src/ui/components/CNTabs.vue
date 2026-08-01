<template>
	<div
		ref="rootRef"
		class="cn-tabs"
		:class="[`cn-tabs--${level}`, { 'cn-tabs--scrollable': isScrollable }]"
	>
		<span class="cn-tabs__indicator" aria-hidden="true" />
		<button
			v-for="item in items"
			:key="item.key"
			type="button"
			class="cn-tabs__item"
			:class="{ 'cn-tabs__item--active': item.key === modelValue }"
			:ref="(el) => setItemRef(el, item.key)"
			@click="emit('update:modelValue', item.key)"
		>
			<i v-if="item.icon" class="fa-solid" :class="item.icon" />
			<span class="cn-tabs__label">
				<span class="cn-tabs__label-zh">{{ item.label }}</span>
				<span v-if="item.sublabel" class="cn-tabs__label-en">{{ item.sublabel }}</span>
			</span>
			<span
				v-if="item.badge !== undefined && item.badge !== '' && item.badge !== 0"
				class="cn-tabs__badge"
			>{{ item.badge }}</span>
		</button>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

type TabLevel = 'l1' | 'l2' | 'l3'

interface TabItem {
	key: string
	label: string
	sublabel?: string
	icon?: string
	badge?: number | string
}

const props = withDefaults(
	defineProps<{
		items: TabItem[]
		modelValue: string
		level?: TabLevel
		scrollable?: boolean
	}>(),
	{
		level: 'l2',
		scrollable: undefined,
	},
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const rootRef = ref<HTMLElement | null>(null)
const itemRefs = new Map<string, HTMLElement>()

const setItemRef = (el: unknown, key: string) => {
	if (el instanceof HTMLElement) itemRefs.set(key, el)
	else itemRefs.delete(key)
}

const isScrollable = computed(() => props.scrollable ?? props.level === 'l3')

const updateIndicator = () => {
	const root = rootRef.value
	const active = props.modelValue ? itemRefs.get(props.modelValue) : null
	if (!root || !active) return
	root.style.setProperty('--tab-x', `${active.offsetLeft}px`)
	root.style.setProperty('--tab-w', `${active.offsetWidth}px`)
}

const onScroll = () => updateIndicator()

let ro: ResizeObserver | null = null

watch(
	() => props.modelValue,
	async () => {
		await nextTick()
		updateIndicator()
	},
)

watch(
	() => props.items,
	async () => {
		await nextTick()
		updateIndicator()
	},
	{ deep: true },
)

onMounted(() => {
	updateIndicator()
	ro = new ResizeObserver(() => updateIndicator())
	if (rootRef.value) ro.observe(rootRef.value)
	if (isScrollable.value && rootRef.value) {
		rootRef.value.addEventListener('scroll', onScroll, { passive: true })
	}
})

onBeforeUnmount(() => {
	ro?.disconnect()
	if (rootRef.value) rootRef.value.removeEventListener('scroll', onScroll)
	itemRefs.clear()
})
</script>
