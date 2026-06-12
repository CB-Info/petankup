<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
//
// Layout désactivé : l'écran porte son propre header navy (AppHeader mode
// interne) — le bandeau crème du layout ferait doublon.
import type { TournamentFormat, TournamentVisibility } from "../../types";

definePageMeta({ layout: false });

const tournamentStore = useTournamentStore();
const { showError } = useErrorToast();

// `toLocaleDateString('en-CA')` renvoie le format ISO (YYYY-MM-DD) dans
// la timezone locale — évite le piège de `toISOString()`, qui passe en
// UTC et peut renvoyer la date du lendemain en fin de soirée locale.
function todayLocalIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

const state = reactive({
  name: "",
  date: todayLocalIso(),
  location: "",
  description: "",
  visibility: "private" as TournamentVisibility,
  // Une seule option aujourd'hui : la carte Format est sélectionnable
  // pour préparer les futurs formats, le payload reste identique.
  format: "round_robin" as TournamentFormat,
});

// TODO: les options de visibilité et de format seront à terme chargées
// depuis une table BDD — listes en dur temporaires.
const visibilityOptions = [
  {
    value: "private",
    label: "Privé",
    description: "Visible par vous",
    icon: "i-lucide-lock",
  },
  {
    value: "public",
    label: "Public",
    description: "Visible par tous",
    icon: "i-lucide-globe",
  },
];

const formatOptions = [
  {
    value: "round_robin",
    label: "Championnat",
    description: "Toutes les équipes se rencontrent",
    icon: "i-lucide-target",
  },
];

const isSubmitting = ref(false);

async function onSubmit() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    const trimmedLocation = state.location.trim();
    const trimmedDescription = state.description.trim();
    const createdTournament = await tournamentStore.createTournament({
      name: state.name.trim(),
      date: state.date,
      format: state.format,
      location: trimmedLocation === "" ? undefined : trimmedLocation,
      description: trimmedDescription === "" ? undefined : trimmedDescription,
      visibility: state.visibility,
    });
    await navigateTo(`/tournaments/${createdTournament.id}`);
  } catch (error) {
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

useHead({ title: "Nouveau tournoi — Pétankup" });

// Styles partagés des champs (valeurs maquette : h 51, fond card, bordure
// 1.5px line, radius 12, texte 15.5, placeholder muted).
const FIELD_LABEL_CLASS =
  "font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)";
const FIELD_BASE_CLASS =
  "h-12.75 w-full rounded-(--pk-r-md) border-[1.5px] border-(--pk-line) bg-(--pk-card) px-3.5 font-sans text-[15.5px] text-(--pk-ink) placeholder:text-(--pk-muted)";
</script>

<template>
  <div class="min-h-screen bg-default text-default">
    <div class="mx-auto max-w-2xl">
      <AppHeader
        kicker="Étape 1 / 1"
        title="Nouveau tournoi"
        subtitle="Quelques infos et c'est parti"
        :back="{ label: 'Accueil', to: '/' }"
      />

      <main class="px-4.5 pt-5.5 pb-10">
        <UForm
          :schema="tournamentSchema"
          :state="state"
          class="space-y-4"
          @submit="onSubmit"
        >
          <UFormField
            label="Nom du tournoi"
            name="name"
            required
            :ui="{ label: FIELD_LABEL_CLASS }"
          >
            <UInput
              v-model="state.name"
              placeholder="Ex : Tournoi de l'été"
              variant="none"
              class="w-full"
              :ui="{ base: FIELD_BASE_CLASS }"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-2.75">
            <UFormField
              label="Date"
              name="date"
              required
              :ui="{ label: FIELD_LABEL_CLASS }"
            >
              <UInput
                v-model="state.date"
                type="date"
                icon="i-lucide-calendar"
                variant="none"
                class="w-full"
                :ui="{
                  base: `${FIELD_BASE_CLASS} ps-10.5`,
                  leadingIcon: 'size-4.5 text-(--pk-muted)',
                }"
              />
            </UFormField>

            <UFormField
              label="Lieu"
              name="location"
              :ui="{ label: FIELD_LABEL_CLASS }"
            >
              <UInput
                v-model="state.location"
                placeholder="Parc Bordelais"
                icon="i-lucide-map-pin"
                variant="none"
                class="w-full"
                :ui="{
                  base: `${FIELD_BASE_CLASS} ps-10.5`,
                  leadingIcon: 'size-4.5 text-(--pk-muted)',
                }"
              />
            </UFormField>
          </div>

          <UFormField
            label="Description"
            name="description"
            :ui="{ label: FIELD_LABEL_CLASS }"
          >
            <UTextarea
              v-model="state.description"
              placeholder="Notes, règles spéciales…"
              :maxlength="500"
              :rows="4"
              variant="none"
              class="w-full"
              :ui="{
                base: `${FIELD_BASE_CLASS} h-auto py-2.75`,
              }"
            />
          </UFormField>

          <UFormField
            label="Visibilité"
            name="visibility"
            required
            :ui="{ label: FIELD_LABEL_CLASS }"
          >
            <CarteSelection
              v-model="state.visibility"
              :options="visibilityOptions"
              :columns="2"
              name="visibility"
            />
          </UFormField>

          <UFormField
            label="Format"
            name="format"
            :ui="{ label: FIELD_LABEL_CLASS }"
          >
            <CarteSelection
              v-model="state.format"
              :options="formatOptions"
              :columns="1"
              name="format"
            />
          </UFormField>

          <UButton
            type="submit"
            color="primary"
            block
            icon="i-lucide-plus"
            :loading="isSubmitting"
            class="h-13.5 gap-2.25 rounded-[14px] font-disp text-[14.5px] font-extrabold tracking-[0.03em] uppercase text-(--pk-cream) shadow-(--pk-shadow-clay-lg)"
            :ui="{ leadingIcon: 'size-4.5' }"
          >
            Créer le tournoi
          </UButton>
        </UForm>
      </main>
    </div>
  </div>
</template>
