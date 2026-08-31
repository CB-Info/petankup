<script setup lang="ts" generic="TValue extends string">
// Sélecteur en pilules (filtre du journal de bord, toggle de source des
// statistiques). ENVELOPPE UTabs variant="pill" sans panneaux
// (:content="false") : la sélection, le clavier et les rôles tablist sont
// natifs — le composant n'ajoute que l'habillage Nuit & Corail et le
// rétrécissement typé du modelValue (UTabs émet string | number ; on ne
// réécrit le modèle que si la valeur correspond à une option — pas de cast).
// Générique sur la valeur : chaque écran garde son union littérale.
type FiltrePiluleOption = { value: TValue, label: string }

const props = defineProps<{
  options: FiltrePiluleOption[]
}>()

const model = defineModel<TValue>({ required: true })

const items = computed(() =>
  props.options.map(option => ({ value: option.value, label: option.label })),
)

function onTabChange(emittedValue: string | number) {
  const matchingOption = props.options.find(
    option => option.value === String(emittedValue),
  )
  if (matchingOption !== undefined) model.value = matchingOption.value
}
</script>

<template>
  <UTabs
    :model-value="model"
    :items="items"
    :content="false"
    variant="pill"
    color="neutral"
    :ui="{
      root: 'w-full',
      list: 'w-full rounded-(--pk-r-md) bg-(--pk-page) p-1',
      indicator: 'rounded-(--pk-r-sm) bg-(--pk-card) shadow-(--pk-shadow-card)',
      trigger:
        'h-10 justify-center font-disp text-xs font-extrabold tracking-[0.04em] uppercase data-[state=active]:text-(--pk-ink) data-[state=inactive]:text-(--pk-subtle)',
    }"
    @update:model-value="onTabChange"
  />
</template>
