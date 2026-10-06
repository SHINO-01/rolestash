import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Services } from '@/services/container';
import { ToastProvider } from './components/toast';
import { ServicesProvider, useApplyTheme } from './hooks/services';
import './styles.css';

function ThemeBoundary({ children }: { children: ReactNode }) {
  useApplyTheme();
  return children;
}

/** Shared bootstrap for every extension page (widget, board). */
export function mountApp(services: Services, app: ReactNode): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');
  createRoot(container).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <ThemeBoundary>
          <ToastProvider>{app}</ToastProvider>
        </ThemeBoundary>
      </ServicesProvider>
    </StrictMode>,
  );
}
