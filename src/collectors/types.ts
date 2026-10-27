import type { EditorialSubmission } from '../schema/claims.ts';
import type { CollectionMethod } from '../schema/common.ts';

export interface CollectedSubmission {
  origin: string;
  method: CollectionMethod;
  data: unknown;
}

export interface CollectorResult {
  sourceId: string;
  submissions: CollectedSubmission[];
  /** Fallo de recogida (red, robots, política...). Activa la conservación de los datos anteriores. */
  failure?: string;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type { EditorialSubmission };
