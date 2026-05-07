<script setup lang="ts">
// Pattern d'erreurs : les actions du store throw ; on attrape ici et on
// affiche un toast via useErrorToast (voir composables/useErrorToast).
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
});

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
      format: "round_robin",
      location: trimmedLocation === "" ? undefined : trimmedLocation,
      description: trimmedDescription === "" ? undefined : trimmedDescription,
    });
    await navigateTo(`/tournaments/${createdTournament.id}`);
  } catch (error) {
    showError(error);
  } finally {
    isSubmitting.value = false;
  }
}

useHead({ title: "Nouveau tournoi — Pétankup" });
</script>

<template>
  <div class="space-y-4">
    <UButton to="/" variant="ghost" color="neutral" size="sm">
      ← Retour à l'accueil
    </UButton>

    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold text-primary-900">Créer un tournoi</h1>
      </template>

      <UForm
        :schema="tournamentSchema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Nom du tournoi" name="name" required>
          <UInput
            v-model="state.name"
            placeholder="Ex : Tournoi de l'été"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Date" name="date" required>
          <UInput v-model="state.date" type="date" class="w-full" />
        </UFormField>

        <UFormField label="Lieu" name="location">
          <UInput
            v-model="state.location"
            placeholder="Ex : Parc Bordelais"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Description" name="description">
          <UTextarea
            v-model="state.description"
            placeholder="Notes, règles spéciales..."
            :maxlength="500"
            :rows="4"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Format">
          <p class="text-toned">Championnat (toutes rondes)</p>
        </UFormField>

        <UButton
          type="submit"
          color="primary"
          size="lg"
          :loading="isSubmitting"
          block
        >
          Créer le tournoi
        </UButton>
      </UForm>
    </UCard>
  </div>
</template>
