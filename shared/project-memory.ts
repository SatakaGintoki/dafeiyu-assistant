/** Agenda projects and coding projects are separate; memory belongs to an agenda project. */
export interface ProjectMemory {
  id: string; projectId: string; kind: 'goal' | 'progress' | 'next' | 'context';
  content: string; revision: number; createdAt: string; updatedAt: string;
  source: { type: 'manual' | 'conversation'; messageId?: string };
}
export interface MemoryInput { projectId: string; kind: ProjectMemory['kind']; content: string }
export interface AgendaReference {
  status: 'resolved' | 'ambiguous' | 'missing';
  candidates: import('./agenda').AgendaItem[];
}
