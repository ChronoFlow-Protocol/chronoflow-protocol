import { API_URL } from "./config";
import type { ApiEnvelope, ApiErrorEnvelope, ListMeta, StatsView, VaultView } from "./types";

/** Error raised for any non-2xx response, network failure or timeout. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `Cannot reach the ChronoFlow API at ${API_URL}. Start it with \`pnpm --filter @chronoflow/backend run dev\`.`,
      0,
      "NETWORK_ERROR",
    );
  }

  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const envelope = body as ApiErrorEnvelope | null;
    throw new ApiError(
      envelope?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      envelope?.error?.code ?? "HTTP_ERROR",
    );
  }

  return body as T;
}

export interface VaultQuery {
  status?: string;
  funder?: string;
  recipient?: string;
  token?: string;
  limit?: number;
  offset?: number;
}

/** `GET /api/vaults` — newest vault first. */
export async function fetchVaults(
  query: VaultQuery = {},
): Promise<{ items: VaultView[]; meta: ListMeta }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }

  const envelope = await request<ApiEnvelope<VaultView[]>>(`/api/vaults?${params.toString()}`);
  const items = Array.isArray(envelope.data) ? envelope.data : [];

  return {
    items,
    meta: envelope.meta ?? { total: items.length, limit: items.length, offset: 0, decimals: 7 },
  };
}

/** `GET /api/vaults/:id` — includes the milestone timeline and event log. */
export async function fetchVault(id: number): Promise<VaultView | null> {
  try {
    const envelope = await request<ApiEnvelope<VaultView>>(`/api/vaults/${id}`);
    return envelope.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** `GET /api/stats` — protocol-wide aggregates. */
export async function fetchStats(): Promise<StatsView> {
  const envelope = await request<ApiEnvelope<StatsView>>("/api/stats");
  return envelope.data;
}
