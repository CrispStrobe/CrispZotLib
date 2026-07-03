// endpoints.ts - Endpoint definitions.
//
// The endpoint data lives in the SHARED manifest endpoints.json, which is kept
// byte-identical across CrispZotLib / CrispLib / citer (see scripts/sync-endpoints.sh
// and endpoints.parity.test). Edit the manifest, not this file, so an endpoint fix
// lands once for all three projects. This module just types and re-exports it.

import { SRUEndpoint, OAIEndpoint, IxTheoEndpoint } from './models';
import manifest from './endpoints.json';

export const NAMESPACES: Record<string, string> = manifest.namespaces;
export const SRU_ENDPOINTS: Record<string, SRUEndpoint> = manifest.sru as Record<string, SRUEndpoint>;
export const OAI_ENDPOINTS: Record<string, OAIEndpoint> = manifest.oai as Record<string, OAIEndpoint>;
export const IXTHEO_ENDPOINTS: Record<string, IxTheoEndpoint> = manifest.ixtheo as unknown as Record<string, IxTheoEndpoint>;
