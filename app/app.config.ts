// Mappe les alias sémantiques Nuxt UI sur nos rampes custom du thème
// « Nuit & Corail » (définies dans assets/css/main.css) :
//   primary = clay (corail), secondary = gold (doré),
//   success = green, error = danger.
// Pour `neutral`, on garde `stone` (palette Tailwind chaude par défaut),
// le plus proche des neutres chauds de la charte sans maintenir une rampe
// custom 50→950 de plus.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'clay',
      secondary: 'gold',
      success: 'green',
      error: 'danger',
      neutral: 'stone',
    },
    // Variantes navy et cream de UButton, déclarées UNE fois ici (mécanisme
    // officiel Nuxt UI v4 : le thème runtime étend le thème généré avec ce
    // bloc, et depuis la 4.8 les variants custom remontent dans les types →
    // `<UButton color="navy">` / `color="cream"` sont typés). Scopées au
    // bouton volontairement : navy et cream sont des ambiances (--pk-*), pas
    // des couleurs sémantiques globales — on n'étend PAS ui.theme.colors
    // (qui exigerait des rampes 50→950).
    // navy : bouton sombre sur surfaces crème (focus : anneau navy, pas de
    // corail). cream : bouton clair sur fonds navy (Google de la connexion,
    // futurs sheets/modales — focus : anneau cream, lisible sur navy).
    button: {
      variants: {
        color: {
          navy: '',
          cream: '',
        },
        // Variante de bordure pointillée (boutons « ajouter » : équipe,
        // tournoi…). Base sans fond façon ghost + bordure dashed corail ;
        // motif récurrent → centralisé ici plutôt que des classes répétées.
        variant: {
          dashed: '',
        },
      },
      compoundVariants: [
        {
          color: 'navy',
          variant: 'solid',
          class:
            'bg-(--pk-navy) text-(--pk-cream) hover:bg-(--pk-navy-top) active:bg-(--pk-navy-top) disabled:bg-(--pk-navy) aria-disabled:bg-(--pk-navy) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--pk-navy)',
        },
        {
          color: 'cream',
          variant: 'solid',
          class:
            'bg-(--pk-cream) text-(--pk-navy) hover:bg-white active:bg-white disabled:bg-(--pk-cream) aria-disabled:bg-(--pk-cream) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--pk-cream)',
        },
        {
          color: 'primary',
          variant: 'dashed',
          class:
            'text-primary border-[1.5px] border-dashed border-primary-200 hover:bg-primary/10 active:bg-primary/10 disabled:bg-transparent aria-disabled:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        },
      ],
    },
  },
})
