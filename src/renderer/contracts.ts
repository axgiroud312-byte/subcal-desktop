import type { Snapshot, SubCalClient } from '../shared/types';
export type Notify = (message: string, action?: { label: string; run: () => void; duration?: number }) => void;
export type PageProps = { snapshot: Snapshot; client: SubCalClient; notify: Notify; onOpen: (id: string) => void; onCreate: () => void; onConnection: (id: string) => void };
