import { Bug, CircleHelp, Compass, Keyboard, LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, IconButton } from '@/ui/components/button';
import { Menu } from '@/ui/components/menu';
import { Kbd } from '@/ui/components/misc';
import { Dialog } from '@/ui/components/overlay';

const SUPPORT_URL = 'https://rolestash.com/support/';

/** Help (?) in the board's header: the tour, shortcuts, help pages, a problem report. */
export function HelpMenu({ onTour, onReport }: { onTour: () => void; onReport: () => void }) {
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <>
      <span data-tour="help">
        <Menu
          trigger={(props) => (
            <IconButton label="Help" {...props}>
              <CircleHelp className="size-5" />
            </IconButton>
          )}
          items={[
            { label: 'Take the tour', icon: <Compass className="size-4" />, onSelect: onTour },
            {
              label: 'Keyboard shortcuts',
              icon: <Keyboard className="size-4" />,
              onSelect: () => setShortcuts(true),
            },
            {
              label: 'Help and support',
              icon: <LifeBuoy className="size-4" />,
              onSelect: () => void browser.tabs.create({ url: SUPPORT_URL }),
            },
            'separator',
            { label: 'Report a problem…', icon: <Bug className="size-4" />, onSelect: onReport },
          ]}
        />
      </span>
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </>
  );
}

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['Alt+J'], what: 'Open the Save job panel on any page' },
  { keys: ['Alt+Shift+J'], what: 'Save the job on this page straight to the board' },
  { keys: ['/'], what: 'Search the board' },
  { keys: ['N'], what: 'Add a job yourself' },
  { keys: ['Enter'], what: 'Open the focused card' },
  { keys: ['Space', '←↑↓→', 'Space'], what: 'Pick up a card, move it, put it down' },
  { keys: ['Ctrl', 'click'], what: 'Select several cards (Pro; ⌘ on a Mac)' },
  { keys: ['Esc'], what: 'Close a panel, clear search or stop selecting' },
];

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
          >
            Change the Alt shortcuts…
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <dl className="divide-line flex flex-col divide-y">
        {SHORTCUTS.map((s) => (
          <div key={s.what} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-ink text-sm">{s.what}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {s.keys.map((k, i) => (
                <Kbd key={i} large>
                  {k}
                </Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
