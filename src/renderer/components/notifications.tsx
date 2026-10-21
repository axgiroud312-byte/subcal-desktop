import { createContext } from 'react';
import { X } from 'lucide-react';
import type { Notify } from '../contracts';
import { Button } from './ui/button';

export interface Notice {
  id: number;
  message: string;
  action?: Parameters<Notify>[1];
}

export const NotificationContext = createContext<{ notice: Notice | null; dismiss: () => void }>({ notice: null, dismiss: () => {} });

/** Same Notify event, placed in normal flow while a modal owns interaction.
 * It reserves space instead of covering save / conflict controls. */
export function ModalNotice({ notice, dismiss }: { notice: Notice; dismiss: () => void }) {
  return <div className="modal-notice" role="status" data-slot="modal-notice">
    <span>{notice.message}</span>
    <div className="row">
      {notice.action ? <Button type="button" variant="outline" onClick={notice.action.run}>{notice.action.label}</Button> : null}
      <Button type="button" variant="ghost" size="icon" aria-label="关闭通知" onClick={dismiss}><X /></Button>
    </div>
  </div>;
}
