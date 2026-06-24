/**
 * Chain Proxy Handler
 * CRUD operations for proxy chains (链式代理).
 *
 * A chain proxy allows traffic to flow through multiple proxy nodes in sequence:
 *   Node A (SS) → Node B (VMess) → Node C (Trojan) → Destination
 *
 * Each chain stores an ordered list of node identifiers (subscription node URLs
 * or manual node URLs) and metadata for generating relay/chain configurations
 * for various proxy clients.
 */

import { StorageFactory } from '../../storage-adapter.js';
import { KV_KEY_CHAINS } from '../config.js';
import { createJsonResponse, createErrorResponse, readJsonWithLimit, JSON_BODY_LIMITS } from '../utils.js';
import { authMiddleware } from '../auth-middleware.js';

/**
 * Normalize a chain object, ensuring defaults for missing fields.
 */
function normalizeChain(chain = {}) {
    return {
        id: chain.id || '',
        name: chain.name || '',
        nodes: Array.isArray(chain.nodes) ? chain.nodes : [],
        enabled: chain.enabled !== false,
        description: chain.description || '',
        mode: chain.mode || 'relay',   // 'relay' | 'chain' | 'direct-chain'
        createdAt: chain.createdAt || new Date().toISOString(),
        updatedAt: chain.updatedAt || new Date().toISOString()
    };
}

/**
 * Validate chain data before saving.
 */
function validateChain(chain) {
    const errors = [];
    if (!chain.name || typeof chain.name !== 'string' || !chain.name.trim()) {
        errors.push('Chain name is required');
    }
    if (!Array.isArray(chain.nodes)) {
        errors.push('Nodes must be an array');
    } else if (chain.nodes.length < 2) {
        errors.push('A chain must have at least 2 nodes');
    }
    if (chain.mode && !['relay', 'chain', 'direct-chain'].includes(chain.mode)) {
        errors.push('Mode must be "relay", "chain", or "direct-chain"');
    }
    return errors;
}

/**
 * List all chains.
 */
export async function handleChainsList(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }
        const raw = await storage.get(KV_KEY_CHAINS);
        const chains = raw ? JSON.parse(raw) : [];
        return createJsonResponse({ success: true, data: chains });
    } catch (error) {
        console.error('[ChainHandler] List error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Create a new chain.
 */
export async function handleChainCreate(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) {
            return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
        }

        const errors = validateChain(body);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_CHAINS);
        const chains = raw ? JSON.parse(raw) : [];

        const newChain = normalizeChain({
            ...body,
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        chains.push(newChain);
        await storage.put(KV_KEY_CHAINS, JSON.stringify(chains));

        return createJsonResponse({ success: true, data: newChain, message: 'Chain created' }, 201);
    } catch (error) {
        console.error('[ChainHandler] Create error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Update an existing chain.
 */
export async function handleChainUpdate(request, env, chainId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!chainId) {
        return createJsonResponse({ success: false, message: 'Chain ID is required' }, 400);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) {
            return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_CHAINS);
        const chains = raw ? JSON.parse(raw) : [];
        const index = chains.findIndex(c => c.id === chainId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Chain not found' }, 404);
        }

        // Validate updated fields
        const updated = { ...chains[index], ...body, id: chainId, updatedAt: new Date().toISOString() };
        const errors = validateChain(updated);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        chains[index] = normalizeChain(updated);
        await storage.put(KV_KEY_CHAINS, JSON.stringify(chains));

        return createJsonResponse({ success: true, data: chains[index], message: 'Chain updated' });
    } catch (error) {
        console.error('[ChainHandler] Update error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Delete a chain.
 */
export async function handleChainDelete(request, env, chainId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!chainId) {
        return createJsonResponse({ success: false, message: 'Chain ID is required' }, 400);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_CHAINS);
        const chains = raw ? JSON.parse(raw) : [];
        const index = chains.findIndex(c => c.id === chainId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Chain not found' }, 404);
        }

        chains.splice(index, 1);
        await storage.put(KV_KEY_CHAINS, JSON.stringify(chains));

        return createJsonResponse({ success: true, message: 'Chain deleted' });
    } catch (error) {
        console.error('[ChainHandler] Delete error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Get chains data for data store hydration (used by /api/data endpoint).
 * Returns the raw chains array.
 */
export async function getChainsData(env) {
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return [];
        const raw = await storage.get(KV_KEY_CHAINS);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('[ChainHandler] getChainsData error:', err);
        return [];
    }
}
