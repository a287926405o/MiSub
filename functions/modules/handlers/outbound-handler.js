/**
 * Outbound Settings Handler (3x-ui style)
 * CRUD operations for outbound node configurations.
 *
 * In 3x-ui / Xray-core, outbounds define the actual server connections
 * that traffic gets routed TO. This includes:
 *   - Proxy protocols: Shadowsocks, VMess, Trojan, VLESS, Hysteria2
 *   - Tunnels: SOCKS5, HTTP, WireGuard
 *   - Special: Direct (freedom), Block (reject)
 *
 * These outbounds can be used as the "next hop" in routing rules,
 * creating chain proxy effects when a proxy node routes through
 * another outbound.
 */

import { StorageFactory } from '../../storage-adapter.js';
import { KV_KEY_OUTBOUNDS } from '../config.js';
import { createJsonResponse, createErrorResponse, readJsonWithLimit, JSON_BODY_LIMITS } from '../utils.js';
import { authMiddleware } from '../auth-middleware.js';

/** Supported outbound protocol types */
export const OUTBOUND_PROTOCOLS = [
    'shadowsocks',  // SS: server, port, method, password, plugin
    'vmess',        // VMess: server, port, uuid, alterId, cipher, network, tls
    'trojan',       // Trojan: server, port, password, sni, skip-cert-verify
    'vless',        // VLESS: server, port, uuid, flow, network, reality/tls
    'hysteria2',    // Hysteria2: server, port, password, sni, up/down
    'socks5',       // SOCKS5: server, port, username, password, udp
    'http',         // HTTP: server, port, username, password, tls
    'wireguard',    // WireGuard: server, port, public_key, private_key, addresses
    'direct',       // Direct (freedom): no config needed
    'block'         // Block (reject): no config needed
];

/** Protocol display names */
export const PROTOCOL_LABELS = {
    shadowsocks: 'Shadowsocks',
    vmess: 'VMess',
    trojan: 'Trojan',
    vless: 'VLESS',
    hysteria2: 'Hysteria2',
    socks5: 'SOCKS5',
    http: 'HTTP',
    wireguard: 'WireGuard',
    direct: 'Direct (直连)',
    block: 'Block (拒绝)'
};

/**
 * Normalize an outbound object with defaults.
 */
function normalizeOutbound(outbound = {}) {
    const base = {
        id: outbound.id || '',
        name: outbound.name || '',
        protocol: outbound.protocol || 'shadowsocks',
        enabled: outbound.enabled !== false,
        description: outbound.description || '',
        createdAt: outbound.createdAt || new Date().toISOString(),
        updatedAt: outbound.updatedAt || new Date().toISOString()
    };

    // Protocol-specific config
    switch (outbound.protocol) {
        case 'shadowsocks':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 443,
                method: outbound.method || 'aes-128-gcm',
                password: outbound.password || '',
                plugin: outbound.plugin || '',
                pluginOpts: outbound.pluginOpts || ''
            };
        case 'vmess':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 443,
                uuid: outbound.uuid || '',
                alterId: outbound.alterId || 0,
                cipher: outbound.cipher || 'auto',
                network: outbound.network || 'tcp', // tcp, ws, grpc
                tls: outbound.tls !== false,
                sni: outbound.sni || '',
                skipCertVerify: outbound.skipCertVerify === true,
                wsPath: outbound.wsPath || '/',
                wsHost: outbound.wsHost || ''
            };
        case 'trojan':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 443,
                password: outbound.password || '',
                sni: outbound.sni || '',
                skipCertVerify: outbound.skipCertVerify === true,
                udp: outbound.udp !== false
            };
        case 'vless':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 443,
                uuid: outbound.uuid || '',
                flow: outbound.flow || '',
                network: outbound.network || 'tcp',
                tls: outbound.tls !== false,
                sni: outbound.sni || '',
                skipCertVerify: outbound.skipCertVerify === true,
                reality: outbound.reality === true,
                realityPublicKey: outbound.realityPublicKey || '',
                realityShortId: outbound.realityShortId || '',
                realityServerName: outbound.realityServerName || ''
            };
        case 'hysteria2':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 443,
                password: outbound.password || '',
                sni: outbound.sni || '',
                skipCertVerify: outbound.skipCertVerify === true,
                upMbps: outbound.upMbps || 100,
                downMbps: outbound.downMbps || 100
            };
        case 'socks5':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 1080,
                username: outbound.username || '',
                password: outbound.password || '',
                udp: outbound.udp === true
            };
        case 'http':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 8080,
                username: outbound.username || '',
                password: outbound.password || '',
                tls: outbound.tls === true
            };
        case 'wireguard':
            return {
                ...base,
                server: outbound.server || '',
                port: outbound.port || 51820,
                privateKey: outbound.privateKey || '',
                publicKey: outbound.publicKey || '',
                localAddress: outbound.localAddress || '',
                mtu: outbound.mtu || 1420,
                reserved: outbound.reserved || ''
            };
        case 'direct':
        case 'block':
            return {
                ...base,
                server: '',
                port: 0
            };
        default:
            return base;
    }
}

/**
 * Validate outbound data before saving.
 */
function validateOutbound(outbound) {
    const errors = [];
    if (!outbound.name || typeof outbound.name !== 'string' || !outbound.name.trim()) {
        errors.push('Outbound name is required');
    }
    if (!outbound.protocol || !OUTBOUND_PROTOCOLS.includes(outbound.protocol)) {
        errors.push(`Protocol must be one of: ${OUTBOUND_PROTOCOLS.join(', ')}`);
    }

    // For protocols that require server/port
    if (!['direct', 'block'].includes(outbound.protocol)) {
        if (!outbound.server) errors.push('Server address is required');
        if (!outbound.port) errors.push('Port is required');
    }

    // Protocol-specific field validation
    switch (outbound.protocol) {
        case 'shadowsocks':
            if (!outbound.password) errors.push('Password is required for Shadowsocks');
            break;
        case 'vmess':
            if (!outbound.uuid) errors.push('UUID is required for VMess');
            break;
        case 'trojan':
            if (!outbound.password) errors.push('Password is required for Trojan');
            break;
        case 'vless':
            if (!outbound.uuid) errors.push('UUID is required for VLESS');
            break;
        case 'hysteria2':
            if (!outbound.password) errors.push('Password is required for Hysteria2');
            break;
        case 'wireguard':
            if (!outbound.privateKey) errors.push('Private key is required for WireGuard');
            if (!outbound.publicKey) errors.push('Public key is required for WireGuard');
            if (!outbound.localAddress) errors.push('Local address is required for WireGuard');
            break;
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
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
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
        if (!body) return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);

        const errors = validateOutbound(body);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];

        // Check duplicate name
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
    if (!outboundId) return createJsonResponse({ success: false, message: 'Outbound ID is required' }, 400);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);

        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];
        const index = outbounds.findIndex(o => o.id === outboundId);

        if (index === -1) return createJsonResponse({ success: false, message: 'Outbound not found' }, 404);

        // Check name uniqueness
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
    if (!outboundId) return createJsonResponse({ success: false, message: 'Outbound ID is required' }, 400);
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        const outbounds = raw ? JSON.parse(raw) : [];
        const index = outbounds.findIndex(o => o.id === outboundId);

        if (index === -1) return createJsonResponse({ success: false, message: 'Outbound not found' }, 404);

        // Check if outbound is referenced by any routing rules
        const rawRules = await storage.get('misub_routing_rules_v1');
        const rules = rawRules ? JSON.parse(rawRules) : [];
        const referencedBy = rules.filter(r => r.targetOutbound === outboundId || r.targetOutbound === outbounds[index].name);
        if (referencedBy.length > 0) {
            return createJsonResponse({
                success: false,
                message: `Cannot delete: outbound is referenced by ${referencedBy.length} routing rule(s)`,
                references: referencedBy.map(r => r.name)
            }, 409);
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
 * Helper: get all outbounds as array.
 */
export async function getOutboundsData(env) {
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return [];
        const raw = await storage.get(KV_KEY_OUTBOUNDS);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
