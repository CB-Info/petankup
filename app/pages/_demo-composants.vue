<!-- DEMO TEMPORAIRE — à supprimer en fin de lot composants (ticket de cleanup) -->
<script setup lang="ts">
import type { TournamentStatus } from "../types";

// Page de validation isolée des composants du lot (briques de base :
// BouleAvatar, StatutBadge ; assemblages : AppHeader, ScoreboardEquipe,
// CarteTournoi). Non liée dans la navigation. Accès en étant connecté
// (redirect auth global).

const TONES = [
  "horizon",
  "sand",
  "gold",
  "silver",
  "bronze",
  "clay",
  "dark",
] as const;

const SIZES = [40, 60, 96];

const STATUTS: { statut: TournamentStatus; live?: boolean; titre: string }[] = [
  { statut: "draft", titre: "Brouillon" },
  { statut: "in_progress", titre: "En cours" },
  { statut: "in_progress", live: true, titre: "En direct (live)" },
  { statut: "completed", titre: "Terminé" },
];

// Un panneau par variant : header sur le navy du header, liste sur la crème
// des cartes. La couleur (toujours or en header, par statut en liste) doit
// tenir sur son fond.
const PANELS = [
  {
    titre: "Variant header — sur navy",
    variant: "header" as const,
    panelClass: "bg-(--pk-navy)",
    captionClass: "text-(--pk-on-navy-2)",
  },
  {
    titre: "Variant liste — sur crème",
    variant: "liste" as const,
    panelClass: "bg-elevated",
    captionClass: "text-toned",
  },
];

// AppHeader : onglets interactifs (l'état actif vit dans le parent,
// le composant ne fait qu'émettre tab-change).
const ONGLETS_DEMO = [
  { id: "equipes", label: "Équipes" },
  { id: "matchs", label: "Matchs" },
  { id: "classement", label: "Classement" },
];
const ongletActif = ref("matchs");
</script>

<template>
  <div class="space-y-10">
    <header>
      <p class="font-disp text-xs tracking-widest text-muted uppercase">
        Démo temporaire
      </p>
      <h1 class="font-disp text-2xl font-bold text-default">
        Composants de base
      </h1>
    </header>

    <!-- BouleAvatar : 7 tons × tailles, avec striures -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — tons et tailles (avec striures)
      </h2>
      <div class="space-y-6">
        <div
          v-for="size in SIZES"
          :key="size"
          class="flex flex-wrap items-end gap-5"
        >
          <div
            v-for="tone in TONES"
            :key="tone"
            class="flex flex-col items-center gap-2"
          >
            <BouleAvatar :tone="tone" :size="size" />
            <span class="text-xs text-toned">{{ tone }} · {{ size }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- BouleAvatar : sans striures -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — sans striures (striped=false)
      </h2>
      <div class="flex flex-wrap items-end gap-5">
        <div
          v-for="tone in TONES"
          :key="tone"
          class="flex flex-col items-center gap-2"
        >
          <BouleAvatar :tone="tone" :size="60" :striped="false" />
          <span class="text-xs text-toned">{{ tone }}</span>
        </div>
      </div>
    </section>

    <!-- BouleAvatar : initiale via slot -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        BouleAvatar — initiale (slot), façon « Mon compte »
      </h2>
      <BouleAvatar tone="gold" :size="96" aria-label="Profil de Bilfngr">
        <span class="text-(--pk-navy)">B</span>
      </BouleAvatar>
    </section>

    <!-- StatutBadge : variant header (navy) vs variant liste (crème) -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        StatutBadge — header (navy) et liste (crème)
      </h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <div
          v-for="panel in PANELS"
          :key="panel.titre"
          class="space-y-3 rounded-xl p-4"
          :class="panel.panelClass"
        >
          <p
            class="text-xs tracking-wide uppercase"
            :class="panel.captionClass"
          >
            {{ panel.titre }}
          </p>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div
              v-for="entry in STATUTS"
              v-show="!(entry.live && panel.variant === 'liste')"
              :key="entry.titre"
              class="flex flex-col items-start gap-1.5"
            >
              <StatutBadge
                :statut="entry.statut"
                :variant="panel.variant"
                :live="entry.live"
              />
              <span class="text-[11px]" :class="panel.captionClass">{{
                entry.titre
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- AppHeader : variantes du bandeau navy -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        AppHeader — variantes interne et accueil
      </h2>

      <div class="space-y-2">
        <p class="text-xs text-toned">1 — Retour + titre (Mon compte)</p>
        <AppHeader
          kicker="Profil"
          title="Mon compte"
          :back="{ label: 'Accueil', to: '/' }"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">2 — + description (Nouveau tournoi)</p>
        <AppHeader
          kicker="Étape 1 / 1"
          title="Nouveau tournoi"
          subtitle="Quelques infos et c'est parti"
          :back="{ label: 'Accueil', to: '/' }"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          3 — + description + onglets (Tournoi du 14 juillet)
        </p>
        <AppHeader
          kicker="● En cours"
          title="Tournoi du 14 juillet"
          subtitle="Boulodrome du port · 4 équipes"
          :back="{ label: 'Accueil', to: '/' }"
          :tabs="ONGLETS_DEMO"
          :active-tab="ongletActif"
          @tab-change="ongletActif = $event"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">4 — Close + titre (Saisie de score)</p>
        <AppHeader
          kicker="Manche 1 · Match 1"
          title="Saisie du score"
          closable
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          Accueil — bloc tournoi-en-cours (données via la prop tournoi)
        </p>
        <AppHeader
          mode="accueil"
          profile-initial="B"
          :tournoi="{
            titre: 'Tournoi du\n14 juillet',
            matchsJoues: 3,
            matchsTotal: 6,
            equipes: 4,
            ctaLabel: 'Reprendre le tournoi',
          }"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          Accueil — état vide (header = logo + profil seuls ; le contenu « Aucun
          tournoi » ci-dessous est du contenu de page, hors AppHeader)
        </p>
        <AppHeader mode="accueil" profile-initial="B" />
        <div class="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <BouleAvatar tone="gold" :size="64" />
          <p class="font-disp text-[19px] font-extrabold text-(--pk-ink)">
            Aucun tournoi pour l'instant
          </p>
          <p class="font-sans text-sm text-(--pk-subtle)">
            Crée ton premier tournoi pour lancer la saison.
          </p>
          <button
            type="button"
            class="flex h-13 w-full items-center justify-center gap-2 rounded-[13px] bg-primary font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
          >
            <UIcon name="i-lucide-plus" class="size-4.5" />
            Créer un tournoi
          </button>
        </div>
      </div>
    </section>

    <!-- ScoreboardEquipe : saisie + liste (joué / à jouer) -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        ScoreboardEquipe — saisie et liste
      </h2>

      <div class="space-y-2">
        <p class="text-xs text-toned">Mode saisie (meneur : Les Bouchons)</p>
        <ScoreboardEquipe
          mode="saisie"
          team-a-name="Les Bouchons"
          team-b-name="Les Cagoles"
          :score-a="13"
          :score-b="9"
          leading-side="A"
          tone-a="gold"
          tone-b="horizon"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          Mode liste — match joué (gagnant : Les Bouchons)
        </p>
        <ScoreboardEquipe
          mode="liste"
          team-a-name="Les Bouchons"
          team-b-name="Les Cagoles"
          :score-a="13"
          :score-b="7"
          winner-side="A"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">Mode liste — match à jouer</p>
        <ScoreboardEquipe
          mode="liste"
          team-a-name="Les Pointeurs"
          team-b-name="Les Tireurs"
          :score-a="null"
          :score-b="null"
        />
      </div>
    </section>

    <!-- CarteTournoi (sans boule) : liséré selon statut -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        CarteTournoi — liséré selon statut (sans boule)
      </h2>
      <div class="space-y-3">
        <p
          class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
        >
          Tous les tournois
        </p>
        <CarteTournoi
          name="Tournoi du 14 juillet"
          sub-info="En cours · 3/6 matchs"
          status="in_progress"
        />
        <CarteTournoi
          name="Anniversaire Marc"
          sub-info="22 juin · Place du village"
          status="draft"
        />
        <CarteTournoi
          name="Apéro de printemps"
          sub-info="Vainqueur · Les Magnums"
          status="completed"
        />
      </div>
    </section>

    <!-- CarteEquipe : nom + joueurs + éditer/supprimer -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        CarteEquipe — liste des équipes
      </h2>
      <p class="text-xs text-toned">
        L'en-tête « 4 équipes inscrites » et le bouton « Ajouter une équipe »
        sont du contenu d'écran, hors CarteEquipe.
      </p>
      <div class="space-y-3">
        <p
          class="font-disp text-[10px] font-extrabold tracking-widest uppercase text-(--pk-muted)"
        >
          4 équipes inscrites
        </p>
        <CarteEquipe name="Les Bouchons" :players="['Marc', 'Sophie']" />
        <CarteEquipe name="Les Cagoles" :players="['Léa', 'Tom', 'Anna']" />
        <CarteEquipe name="Les Pointeurs" :players="['Jules', 'Karim']" />
        <CarteEquipe name="Les Tireurs" :players="['Eva', 'Paul']" />
        <button
          type="button"
          class="flex h-13 w-full items-center justify-center gap-2 rounded-(--pk-r-card) border-2 border-dashed border-primary-200 font-disp text-[13px] font-extrabold tracking-[0.04em] uppercase text-primary"
        >
          <UIcon name="i-lucide-plus" class="size-4" />
          Ajouter une équipe
        </button>
      </div>
    </section>

    <!-- LigneClassement : en-tête + 4 lignes -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        LigneClassement — leader doré + médailles
      </h2>
      <div class="space-y-2">
        <LigneClassementEntete />
        <LigneClassement
          :rank="1"
          team-name="Les Bouchons"
          :wins="2"
          :losses="0"
          :diff="11"
        />
        <LigneClassement
          :rank="2"
          team-name="Les Tireurs"
          :wins="2"
          :losses="1"
          :diff="4"
        />
        <LigneClassement
          :rank="3"
          team-name="Les Cagoles"
          :wins="1"
          :losses="1"
          :diff="-2"
        />
        <LigneClassement
          :rank="4"
          team-name="Les Pointeurs"
          :wins="0"
          :losses="3"
          :diff="-13"
        />
      </div>
    </section>
  </div>
</template>
