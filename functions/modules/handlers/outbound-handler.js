/**
 * Outbound Settings Handler
 * CRUD operations for custom outbound configurations.
 *
 * In 3x-ui / Xray-core style, outbounds define where traffic can be routed:
 *   - direct / freedom: direct connection
 *   - block: block traffic
 *   - dns: DNS outbound
 *   - proxy: forward to a specific proxy node
 *   - load_balance: distribute across multiple nodes
 *   - wireguard: WireGuard outbound
 *   - chain: chain proxy (existing feature integration)
 *
 * These outbounds are then referenced by routing rules.
 */

import { StorageFactory } from '../../storage-adapter.js';
import { KV_KEY_OUTBOUNDS } from '../config.js';
import { createJsonResponse, createErrorResponse, readJsonWithLimit, JSON_BODY_LIMITS } from '../utils.js';
import { authMiddleware } from '../auth-middleware.js';

/** Supported outbound types */
export const OUTBOUND_TYPES = [
    'direct',       // Direct connection (freedom)
    'block',        // Block traffic (reject)
    'dns',          // DNS outbound
    'proxy',        // Forward to a specific proxy node
    'load_balance', // Load balance across multiple nodes
    'chain',        // Chain proxy (reference an existing chain)
    'wireguard',    // WireGuard outbound
    'custom'        // Custom JSON config passthrough
];

/** Load balance strategies */
const LB_STRATEGIES = ['random', 'round_robin', 'least_ping', 'least_load', 'consistent_hashing'];

/**
 * Normalize an outbound object with defaults.
 */
function normalizeOutbound(outbound = {}) {
    return {
        id: outbound.id || '',
        name: outbound.name || '',
        type: outbound.type || 'direct',
        enabled: outbound.enabled !== false,
        description: outbound.description || '',
        // Settings per type
        config: outbound.config || {},
        // Load balance specific
        targets: Array.isArray(outbound.targets) ? outbound.targets : [],
        strategy: outbound.strategy || 'random',
        // Proxy specific
        proxyNode: outbound.proxyNode || '',
        // Chain reference
        chainId: outbound.chainId || '',
        // WireGuard specific
        wireguardConfig: outbound.wireguardConfig || {},
        // Custom JSON
        customConfig: outbound.customConfig || '',
        createdAt: outbound.createdAt || new Date().toISOString(),
        updatedAt: outbound.updatedAt || new Date().toISOString()
    };
}

/**
 * Validate outbound data before saving.
 */
function validateOutbound(outbound) {
    const errors = [];
    if (!outbound.name || typeof outbound.name !== 'string' || !outbound.name.trim()) {
        errors.push('Outbound name is required');
    }
    if (!outbound.type || !OUTBOUND_TYPES.includes(outbound.type)) {
        errors.push(`Type must be one of: ${OUTBOUND_TYPES.join(', ')}`);
    }
    if (outbound.type === 'load_balance') {
        if (!Array.isArray(outbound.targets) || outbound.targets.length < 2) {
            errors.push('Load balance outbound requires at least 2 targets');
        }
        if (outbound.strategy && !LB_STRATEGIES.includes(outbound.strategy)) {
            errors.push(`Strategy must be one of: ${LB_STRATEGIES.join(', ')}`);
        }
    }
    if (outbound.type === 'proxy' && !outbound.proxyNode) {
        errors.push('Proxy outbound requires a target proxy node');
    }
    if (outbound.type === 'chain' && !outbound.chainId) {
        errors.push('Chain outbound requires a chain ID reference');
    }
    return errors;
}

/**
 * List all outbounds.
 */
export async function handleOutboundsList(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }
        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];
        return createJsonResponse({ success: true, data: outbounds });
    } catch (error) {
        console.error('[OutboundHandler] List error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Create a new outbound.
 */
export async function handleOutboundCreate(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) {
            return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
        }

        const errors = validateOutbound(body);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];

        // Check for duplicate name
        if (outbounds.some(o => o.name === body.name.trim())) {
            return createJsonResponse({ success: false, message: 'An outbound with this name already exists' }, 409);
        }

        const newOutbound = normalizeOutbound({
            ...body,
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        outbounds.push(newOutbound);
        await storage.put(KV_KEY_OUTBOUNDS, JSON.stringify(outbounds));

        return createJsonResponse({ success: true, data: newOutbound, message: 'Outbound created' }, 201);
    } catch (error) {
        console.error('[OutboundHandler] Create error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Update an existing outbound.
 */
export async function handleOutboundUpdate(request, env, outboundId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!outboundId) {
        return createJsonResponse({ success: false, message: 'Outbound ID is required' }, 400);
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

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];
        const index = outbounds.findIndex(o => o.id === outboundId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Outbound not found' }, 404);
        }

        // Check name uniqueness (exclude current)
        const newName = body.name ? body.name.trim() : outbounds[index].name;
        if (outbounds.some((o, i) => i !== index && o.name === newName)) {
            return createJsonResponse({ success: false, message: 'An outbound with this name already exists' }, 409);
        }

        const updated = { ...outbounds[index], ...body, id: outboundId, updatedAt: new Date().toISOString() };
        const errors = validateOutbound(updated);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        outbounds[index] = normalizeOutbound(updated);
        await storage.put(KV_KEY_OUTBOUNDS, JSON.stringify(outbounds));

        return createJsonResponse({ success: true, data: outbounds[index], message: 'Outbound updated' });
    } catch (error) {
        console.error('[OutboundHandler] Update error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Delete an outbound.
 */
export async function handleOutboundDelete(request, env, outboundId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!outboundId) {
        return createJsonResponse({ success: false, message: 'Outbound ID is required' }, 400);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];
        const index = outbounds.findIndex(o => o.id === outboundId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Outbound not found' }, 404);
        }

        outbounds.splice(index, 1);
        await storage.put(KV_KEY_OUTBOUNDS, JSON.stringify(outbounds));

        return createJsonResponse({ success: true, message: 'Outbound deleted' });
    } catch (error) {
        console.error('[OutboundHandler] Delete error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Helper: get all outbounds as array (used by other modules).
 */
export async function getOutboundsData(env) {
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return [];
        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}
