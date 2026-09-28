import { CapturePopup } from '@/features/capture/capture-popup';
import { getServices } from '@/platform/services';
import { mountApp } from '@/ui/app-root';

mountApp(getServices(), <CapturePopup />);
