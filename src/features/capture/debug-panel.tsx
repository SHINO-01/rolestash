import { Copy, Download } from 'lucide-react';
import type { ExtractionResult } from '@/extraction';
import { Button } from '@/ui/components/button';
import { useServices } from '@/ui/hooks/services';
import { useToast } from '@/ui/components/toast';

/**
 * Developer view of an extraction: which strategy filled each field, plus
 * tools to turn a real page into a regression fixture. See
 * docs/guides/debugging-extraction.md.
 */
export function DebugPanel({ result, tabId }: { result: ExtractionResult; tabId: number }) {
  const { runner } = useServices();
  const toast = useToast();

  async function copyReport() {
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    toast({ message: 'Extraction report copied', tone: 'success' });
  }

  async function downloadSnapshot() {
    try {
      const snapshot = await runner.snapshot(tabId);
      const blob = new Blob([snapshot.html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${result.site.id}-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Snapshot failed', tone: 'error' });
    }
  }

  return (
    <details className="group text-xs">
      <summary className="text-subtle hover:text-muted cursor-pointer select-none">
        Extraction details · {Math.round(result.confidence * 100)}% confidence
      </summary>
      <div className="bg-surface border-line mt-2 rounded-lg border p-2.5">
        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1">
          {Object.entries(result.provenance).map(([field, p]) => (
            <div key={field} className="contents">
              <dt className="text-muted">{field}</dt>
              <dd className="text-subtle truncate font-mono">{p.strategy}</dd>
              <dd className="text-subtle text-right tabular-nums">
                {Math.round(p.confidence * 100)}%
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-subtle mt-2 font-mono break-all">
          {result.site.id} · v{result.extractorVersion}
        </p>
        {result.warnings.length ? (
          <p className="mt-1 text-amber-700 dark:text-amber-400">{result.warnings.join(' ')}</p>
        ) : null}
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="size-3.5" />}
            onClick={() => void copyReport()}
          >
            Copy report
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Download className="size-3.5" />}
            onClick={() => void downloadSnapshot()}
          >
            Page HTML
          </Button>
        </div>
      </div>
    </details>
  );
}
