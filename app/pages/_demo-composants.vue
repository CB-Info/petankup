<!-- DEMO TEMPORAIRE — à supprimer en fin de lot composants (ticket de cleanup) -->
<script setup lang="ts">
import type { TournamentStatus } from '../types'

// Page de validation isolée des composants du lot (briques de base :
// BouleAvatar, StatutBadge ; assemblages : EnteteEcran, ScoreboardEquipe,
// CarteTournoi). Non liée dans la navigation. Accès en étant connecté
// (redirect auth global).

const TONES = [
  'horizon',
  'sand',
  'gold',
  'silver',
  'bronze',
  'clay',
  'dark',
] as const

const SIZES = [40, 60, 96]

const STATUTS: { statut: TournamentStatus; live?: boolean; titre: string }[] = [
  { statut: 'draft', titre: 'Brouillon' },
  { statut: 'in_progress', titre: 'En cours' },
  { statut: 'in_progress', live: true, titre: 'En direct (live)' },
  { statut: 'completed', titre: 'Terminé' },
]

// Un panneau par variant : header sur le navy du header, liste sur la crème
// des cartes. La couleur (toujours or en header, par statut en liste) doit
// tenir sur son fond.
const PANELS = [
  {
    titre: 'Variant header — sur navy',
    variant: 'header' as const,
    panelClass: 'bg-(--pk-navy)',
    captionClass: 'text-(--pk-on-navy-2)',
  },
  {
    titre: 'Variant liste — sur crème',
    variant: 'liste' as const,
    panelClass: 'bg-elevated',
    captionClass: 'text-toned',
  },
]

// EnteteEcran : onglets interactifs (l'état actif vit dans le parent,
// le composant ne fait qu'émettre tab-change).
const ONGLETS_DEMO = [
  { id: 'equipes', label: 'Équipes' },
  { id: 'matchs', label: 'Matchs' },
  { id: 'classement', label: 'Classement' },
]
const ongletActif = ref('matchs')
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
          <p class="text-xs tracking-wide uppercase" :class="panel.captionClass">
            {{ panel.titre }}
          </p>
          <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div
              v-for="entry in STATUTS"
              v-show="!(entry.live && panel.variant === 'liste')"
              :key="entry.titre"
              class="flex flex-col items-start gap-1.5"
            >
              <StatutBadge :statut="entry.statut" :variant="panel.variant" :live="entry.live" />
              <span class="text-[11px]" :class="panel.captionClass">{{ entry.titre }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- EnteteEcran : variantes du bandeau navy -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        EnteteEcran — kicker / onglets / sheet
      </h2>

      <div class="space-y-2">
        <p class="text-xs text-toned">Kicker + titre + sous-titre</p>
        <EnteteEcran
          kicker="En direct"
          title="Tournoi du 14 juillet"
          subtitle="Boulodrome du port · 4 équipes"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">Retour + onglets (interactifs)</p>
        <EnteteEcran
          title="Tournoi du 14 juillet"
          :back="{ label: 'Accueil', to: '/' }"
          :tabs="ONGLETS_DEMO"
          :active-tab="ongletActif"
          @tab-change="ongletActif = $event"
        />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">Sheet : kicker + close</p>
        <EnteteEcran kicker="Partage" title="Gérer les invités" closable />
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          Accueil — bloc tournoi-en-cours (contenu fourni via slot)
        </p>
        <EnteteEcran mode="accueil" profile-initial="B">
          <StatutBadge statut="in_progress" live variant="header" />
          <h2
            class="mt-2.5 font-disp text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] whitespace-pre-line text-(--pk-cream)"
          >
            Tournoi du
14 juillet
          </h2>
          <div class="mt-[18px] flex gap-[22px]">
            <div>
              <p class="font-num text-2xl font-bold leading-[1.1] text-(--pk-cream)">
                3/6
              </p>
              <p
                class="mt-[3px] font-disp text-[9.5px] font-bold tracking-[0.12em] uppercase text-(--pk-on-navy-3)"
              >
                Matchs
              </p>
            </div>
            <div>
              <p class="font-num text-2xl font-bold leading-[1.1] text-(--pk-cream)">
                4
              </p>
              <p
                class="mt-[3px] font-disp text-[9.5px] font-bold tracking-[0.12em] uppercase text-(--pk-on-navy-3)"
              >
                Équipes
              </p>
            </div>
          </div>
          <button
            type="button"
            class="mt-5 flex h-[50px] w-full items-center justify-center gap-2 rounded-[13px] bg-primary font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
          >
            Reprendre le tournoi
            <UIcon name="i-lucide-arrow-right" class="size-[18px]" />
          </button>
        </EnteteEcran>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-toned">
          Accueil — état vide (header = logo + profil seuls ; le contenu
          « Aucun tournoi » ci-dessous est du contenu de page, hors EnteteEcran)
        </p>
        <EnteteEcran mode="accueil" profile-initial="B" />
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
            class="flex h-[52px] w-full items-center justify-center gap-2 rounded-[13px] bg-primary font-disp text-[15px] font-extrabold tracking-[0.02em] uppercase text-(--pk-cream)"
          >
            <UIcon name="i-lucide-plus" class="size-[18px]" />
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
        <p class="text-xs text-toned">Mode liste — match joué (gagnant : Les Bouchons)</p>
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

    <!-- CarteTournoi : terminé / brouillon -->
    <section class="space-y-4">
      <h2 class="font-disp text-lg font-semibold text-default">
        CarteTournoi — liséré selon statut
      </h2>
      <div class="space-y-3">
        <CarteTournoi
          name="Apéro de printemps"
          sub-info="12 avr. · Le village"
          status="completed"
          tone="gold"
        />
        <CarteTournoi
          name="Anniversaire Marc"
          sub-info="20 juin · Boulodrome du port"
          status="draft"
          tone="sand"
        />
      </div>
    </section>
  </div>
</template>
