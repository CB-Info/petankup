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
    // Variante navy de UButton, déclarée UNE fois ici (mécanisme officiel
    // Nuxt UI v4 : le thème runtime étend le thème généré avec ce bloc, et
    // depuis la 4.8 les variants custom remontent dans les types →
    // `<UButton color="navy">` est typé). Scopée au bouton volontairement :
    // le navy est une ambiance (--pk-*), pas une couleur sémantique globale —
    // on n'étend PAS ui.theme.colors (qui exigerait une rampe navy 50→950).
    // Focus : anneau navy (lisible sur les surfaces crème), pas de corail.
    button: {
      variants: {
        color: {
          navy: '',
        },
      },
      compoundVariants: [
        {
          color: 'navy',
          variant: 'solid',
          class:
            'bg-(--pk-navy) text-(--pk-cream) hover:bg-(--pk-navy-top) active:bg-(--pk-navy-top) disabled:bg-(--pk-navy) aria-disabled:bg-(--pk-navy) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--pk-navy)',
        },
      ],
    },
  },
})
