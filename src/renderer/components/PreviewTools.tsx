import { useState } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, RotateCcw } from 'lucide-react';
import type { ScenarioId, Snapshot, SubCalClient, PreviewController } from '../../shared/types';
import type { Notify } from '../contracts';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { FormSelect } from './form-controls';
import { ComponentPreview } from './ComponentPreview';
import { formatDateTime } from './ui';

interface PreviewToolsProps {
  snapshot: Snapshot;
  scenarios: { id: ScenarioId; name: string }[];
  client: SubCalClient & { preview: PreviewController; exportRawStorage: () => Promise<string> };
  notify: Notify;
  editing: boolean;
  onScenarioChange: () => void;
}

export function PreviewTools({ snapshot, scenarios, client, notify, editing, onScenarioChange }: PreviewToolsProps) {
  const [expanded, setExpanded] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const currentName = scenarios.find((item) => item.id === snapshot.scenario)?.name ?? snapshot.scenario;
  const switchScenario = async (id: ScenarioId) => {
    if (editing) { notify('请先保存或关闭正在编辑的订阅表单，再切换演示场景'); return; }
    try {
      await client.preview.switchScenario(id);
      onScenarioChange();
      notify(`已切换到场景「${scenarios.find((item) => item.id === id)?.name ?? id}」（原场景修改已独立保存）`);
    } catch (error) { notify((error as Error).message); }
  };
  const resetScenario = async () => {
    if (editing) { notify('请先保存或关闭正在编辑的订阅表单'); return; }
    try {
      await client.preview.resetScenario();
      onScenarioChange();
      setResetOpen(false);
      notify('已将当前场景重置为初始预设数据（不影响其他场景）');
    } catch (error) { notify((error as Error).message); }
  };
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="preview-tools-dock" aria-label="预览工具与场景控制">
      <div className="preview-dock-bar">
        <div className="preview-dock-summary"><FlaskConical /><span>预览工具</span><span>当前场景：{currentName}</span></div>
        <CollapsibleTrigger render={<Button variant="ghost" />}>
          {expanded ? <ChevronUp /> : <ChevronDown />}{expanded ? '收起预览工具' : '展开预览工具'}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="preview-dock-body stack">
          <div className="toolbar">
            <label className="inline-control"><span>演示场景</span><FormSelect aria-label="切换演示场景" value={snapshot.scenario} onChange={(event) => void switchScenario(event.target.value as ScenarioId)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</FormSelect></label>
            <span className="muted tabular">演示时钟：{formatDateTime(snapshot.now, snapshot.preferences.timezone)} · {snapshot.preferences.timezone}</span>
          </div>
          <div className="toolbar">
            <div className="row"><span className="muted">推进时钟</span>{[{ minutes: 5, label: '+5 分钟' }, { minutes: 60, label: '+1 小时' }, { minutes: 1440, label: '+1 天' }, { minutes: 10080, label: '+7 天' }].map((item) => <Button key={item.minutes} variant="outline" onClick={() => void client.preview.advance(item.minutes).then(() => notify(`演示时钟已推进 ${item.label}`)).catch((error) => notify((error as Error).message))}>{item.label}</Button>)}</div>
            <Button variant="ghost" onClick={() => setResetOpen(true)}><RotateCcw />重置当前场景…</Button>
          </div>
          <p className="muted preview-footnote">十二场景各自保存修改。以上操作仅改变本地演示资料，不连接外部服务。</p>
          <ComponentPreview />
        </div>
      </CollapsibleContent>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>重置「{currentName}」？</AlertDialogTitle><AlertDialogDescription>丢弃当前场景内的修改并恢复初始预设，不影响其他场景或真实外部服务。</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><Button variant="destructive" onClick={() => void resetScenario()}>确认重置当前场景</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}
