import { Plus, KeyRound, Monitor } from 'lucide-react';
import { BrandIcon, Modal } from './ui';
import { Button } from './ui/button';
import { PROVIDERS } from '../pages/ConnectionsPage';

export function AddSubscription({ onSelect, onManual, onClose }: { onSelect: (id: string) => void; onManual: () => void; onClose: () => void }) {
  return <Modal title="添加订阅" onClose={onClose}>
    <div className="stack">
      <div className="stack" role="group" aria-label="选择服务">
        {PROVIDERS.map(provider => <Button key={provider.id} variant="outline" className="h-auto justify-between py-3" onClick={() => onSelect(provider.id)}>
          <span className="row"><BrandIcon product={provider.name} />{provider.name}</span>
          <span className="row muted">{provider.mode === 'local_client' ? <><Monitor />本机账号</> : <><KeyRound />API Key</>}</span>
        </Button>)}
      </div>
      <Button variant="ghost" onClick={onManual}><Plus />手动记录其他订阅</Button>
    </div>
  </Modal>;
}
