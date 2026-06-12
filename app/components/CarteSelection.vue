<script setup lang="ts">
// Sélecteur en cartes (Visibilité, Format, et futures options). ENVELOPPE
// URadioGroup variant="card" : la sélection, le v-model, la navigation
// clavier et l'accessibilité sont natifs — le composant n'ajoute que
// l'habillage Nuit & Corail (pastille d'icône, titre, sous-texte, ombres,
// coche corail sur l'option active). `indicator="hidden"` masque le point
// radio natif : la coche est l'unique indicateur de sélection.
//
// La disposition interne est couplée à `columns` (2 → verticale : pastille
// au-dessus du titre ; 1 → horizontale : pastille · texte · coche) car les
// deux cas actuels tombent ainsi. Si un jour une carte pleine largeur doit
// être verticale, découpler via une prop `layout` dédiée.

type CarteSelectionOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
};

const props = withDefaults(
  defineProps<{
    options: CarteSelectionOption[];
    name?: string;
    /** 2 = cartes côte à côte (Visibilité), 1 = pleine largeur (Format). */
    columns?: 1 | 2;
  }>(),
  {
    name: undefined,
    columns: 1,
  },
);

const model = defineModel<string>();

const isHorizontal = computed(() => props.columns === 1);

// Le sous-texte est transmis sous la clé `subtext` (≠ `description`) :
// la clé native déclencherait le <p> séparé de URadioGroup, hors du flux
// flex — tout le contenu de la carte est rendu dans le slot #label.
const radioItems = computed(() =>
  props.options.map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.icon,
    subtext: option.description,
  })),
);

const fieldsetClass = computed(() =>
  props.columns === 2
    ? "grid w-full grid-cols-2 gap-2.75"
    : "flex w-full flex-col gap-2.75",
);
</script>

<template>
  <URadioGroup
    v-model="model"
    :items="radioItems"
    :name="name"
    variant="card"
    indicator="hidden"
    :ui="{
      fieldset: fieldsetClass,
      item: 'relative w-full rounded-[14px] border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 py-4 shadow-(--pk-shadow-select-inactive) has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary-100 has-data-[state=checked]:shadow-(--pk-shadow-select-active)',
      // text-left : neutralise le `text-center` que la variante
      // indicator=hidden du thème pose sur le wrapper.
      wrapper: 'w-full text-left',
      label: 'w-full',
    }"
  >
    <template #label="{ item, modelValue }">
      <span
        class="flex w-full text-left"
        :class="isHorizontal ? 'items-center gap-2.5' : 'flex-col items-start'"
      >
        <span
          v-if="item.icon"
          class="flex size-9 shrink-0 items-center justify-center rounded-(--pk-r-sm)"
          :class="[
            item.value === modelValue
              ? 'bg-white text-primary'
              : 'bg-(--pk-page) text-(--pk-subtle)',
            isHorizontal ? '' : 'mb-2.5',
          ]"
        >
          <UIcon :name="item.icon" class="size-4.5" />
        </span>

        <span class="min-w-0" :class="isHorizontal ? 'flex-1' : ''">
          <span
            class="block font-disp text-[15px] font-extrabold"
            :class="
              item.value === modelValue ? 'text-primary' : 'text-(--pk-ink)'
            "
          >
            {{ item.label }}
          </span>
          <span
            v-if="item.subtext"
            class="mt-0.5 block font-sans text-[11.5px]"
            :class="
              item.value === modelValue
                ? 'text-primary-700'
                : 'text-(--pk-muted)'
            "
          >
            {{ item.subtext }}
          </span>
        </span>

        <!-- Coche corail : uniquement sur l'option active (le point radio
             natif est masqué, ceci est l'indicateur de sélection).
             Verticale : absolue haut-droite ; horizontale : fin de ligne. -->
        <span
          v-if="item.value === modelValue"
          class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary"
          :class="isHorizontal ? '' : 'absolute top-3 right-3'"
        >
          <UIcon name="i-lucide-check" class="size-3.25 text-(--pk-cream)" />
        </span>
      </span>
    </template>
  </URadioGroup>
</template>
