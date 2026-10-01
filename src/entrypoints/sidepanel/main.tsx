import { SidePanel } from '@/features/sidepanel/side-panel';
import { getServices } from '@/platform/services';
import { mountApp } from '@/ui/app-root';

/** The docked side panel (ADR-0021). */
mountApp(getServices(), <SidePanel />);
