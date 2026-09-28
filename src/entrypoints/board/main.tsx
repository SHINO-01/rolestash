import { BoardPage } from '@/features/board/board-page';
import { getServices } from '@/platform/services';
import { mountApp } from '@/ui/app-root';

mountApp(getServices(), <BoardPage />);
