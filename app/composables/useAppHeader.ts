import type {
  HeaderTournoi,
  HeaderMode,
  KickerTone,
  HeaderOnglet,
} from "~/components/AppHeader.vue";

// Une seule source de header : AppHeader est monté une fois dans le layout, et
// chaque page DÉCLARE sa config via ce composable (adossé à `useState`, pas une
// ref globale). Le layout lit l'état, les pages le posent via `set`/`clear`.

// Action navy pill du slot #actions (page tournoi). Données pures : la page
// fournit, le layout rend. `id` = clé stable de rendu (l'aria du toggle de
// visibilité change selon l'état, donc on ne peut pas keyer dessus).
export interface HeaderAction {
  id: string;
  icon: string;
  ariaLabel: string;
  onClick: () => void;
}

export interface AppHeaderState {
  mode: HeaderMode;
  title?: string;
  kicker?: string;
  kickerTone?: KickerTone;
  subtitle?: string;
  back?: { label: string; to: string };
  closable?: boolean;
  tabs?: HeaderOnglet[];
  activeTab?: string;
  titleSize?: 26 | 30;
  padBottom?: number;
  profileInitial?: string;
  tournoi?: HeaderTournoi;
  actions?: HeaderAction[];
  // Callbacks des emits. Stockés dans le state : acceptable UNIQUEMENT parce
  // que l'app est en ssr:false (pas de sérialisation du state côté serveur).
  onProfile?: () => void;
  onClose?: () => void;
  onTabChange?: (tabId: string) => void;
  onReprendre?: () => void;
}

export function useAppHeader() {
  // null = pas de header (login/confirm/results en layout:false ne passent pas ici).
  const state = useState<AppHeaderState | null>("app-header", () => null);

  // Chaque page déclare un état COMPLET (pas de merge partiel) pour qu'aucun
  // champ d'une page précédente ne fuite sur la suivante.
  function set(next: AppHeaderState): void {
    state.value = next;
  }

  function clear(): void {
    state.value = null;
  }

  return { state: readonly(state), set, clear };
}
