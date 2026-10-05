import { CaptureWidget } from '@/features/capture/capture-widget';
import { getServices } from '@/platform/services';
import { mountApp } from '@/ui/app-root';

mountApp(getServices(), <CaptureWidget />);
