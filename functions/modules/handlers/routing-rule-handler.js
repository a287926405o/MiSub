/**
 * Routing Rules Handler (3x-ui style chain proxy)
 * CRUD operations for routing rules.
 *
 * In 3x-ui style, routing rules define the path traffic takes:
 *   "Which proxy node → Which outbound"
 *
 * This creates chain proxy effects:
 *   Traffic → Proxy Node A → Outbound WARP → Internet
 *   Traffic → Proxy Node B → Outbound Direct → Internet
 *
 * Each rule has:
 *   - A source (proxy node name, or traffic conditions like domain/IP)
 *   - A target outbound (from outbound settings)
 *   - Optional: conditions for traffic-based routing (domain, IP, geo, etc.)
 *
 * The simplest form: select a proxy node name → route to an outbound
 * Advanced form: domain/IP matching → route to an outbound
 */

import { StorageFactory } from '../../storage-adapter.js';
import { KV_KEY_ROUTING_RULES } from '../config.js';
import { createJsonResponse, createErrorResponse, readJsonWithLimit, JSON_BODY_LIMITS } from '../utils.js';
import { authMiddleware } from '../auth-middleware.js';

/** Routing rule source types */
export const RULE_SOURCE_TYPES = [
    'node',        // Route a specific proxy node by name → outbound
    'domain',      // Domain match → outbound
    'domain_suffix', // Domain suffix → outbound
    'domain_keyword', // Domain keyword → outbound
    'ip_cidr',     // IP CIDR → outbound
    'geoip',       // GeoIP country → outbound
    'geosite',     // GeoSite category → outbound
    'port',        // Destination port → outbound
    'protocol',    // Protocol → outbound
    'all'          // All remaining traffic → outbound (catch-all)
];

/**
 * Normalize a routing rule.
 */
function normalizeRoutingRule(rule = {}) {
    return {
        id: rule.id || '',
        name: rule.name || '',
        description: rule.description || '',
        enabled: rule.enabled !== false,
        // Source: which node or traffic condition
        sourceType: rule.sourceType || 'node',
        sourceValue: rule.sourceValue || '',
        // Target: which outbound to use
        targetOutbound: rule.targetOutbound || '', // Outbound ID or name
        // Priority (higher = evaluated first)
        priority: rule.priority || 0,
        createdAt: rule.createdAt || new Date().toISOString(),
        updatedAt: rule.updatedAt || new Date().toISOString()
    };
}

/**
 * Validate routing rule data.
 */
function validateRoutingRule(rule) {
    const errors = [];
    if (!rule.name || typeof rule.name !== 'string' || !rule.name.trim()) {
        errors.push('Rule name is required');
    }
    if (!rule.sourceType || !RULE_SOURCE_TYPES.includes(rule.sourceType)) {
        errors.push(`Source type must be one of: ${RULE_SOURCE_TYPES.join(', ')}`);
    }
    if (rule.sourceType !== 'all' && !rule.sourceValue) {
        errors.push('Source value is required for this source type');
    }
    if (!rule.targetOutbound) {
        errors.push('Target outbound is required');
    }
    return errors;
}

/**
 * List all routing rules.
 */
export async function handleRoutingRulesList(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        // Sort by priority descending
        rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return createJsonResponse({ success: true, data: rules });
    } catch (error) {
        console.error('[RoutingRuleHandler] List error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Create a new routing rule.
 */
export async function handleRoutingRuleCreate(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);

        const errors = validateRoutingRule(body);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];

        const newRule = normalizeRoutingRule({
            ...body,
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        rules.push(newRule);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, data: newRule, message: 'Routing rule created' }, 201);
    } catch (error) {
        console.error('[RoutingRuleHandler] Create error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Update an existing routing rule.
 */
export async function handleRoutingRuleUpdate(request, env, ruleId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!ruleId) return createJsonResponse({ success: false, message: 'Rule ID is required' }, 400);
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);

        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        const index = rules.findIndex(r => r.id === ruleId);

        if (index === -1) return createJsonResponse({ success: false, message: 'Routing rule not found' }, 404);

        const updated = { ...rules[index], ...body, id: ruleId, updatedAt: new Date().toISOString() };
        const errors = validateRoutingRule(updated);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        rules[index] = normalizeRoutingRule(updated);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, data: rules[index], message: 'Routing rule updated' });
    } catch (error) {
        console.error('[RoutingRuleHandler] Update error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Delete a routing rule.
 */
export async function handleRoutingRuleDelete(request, env, ruleId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!ruleId) return createJsonResponse({ success: false, message: 'Rule ID is required' }, 400);
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return createJsonResponse({ success: false, message: 'Storage not available' }, 500);

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        const index = rules.findIndex(r => r.id === ruleId);

        if (index === -1) return createJsonResponse({ success: false, message: 'Routing rule not found' }, 404);

        rules.splice(index, 1);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, message: 'Routing rule deleted' });
    } catch (error) {
        console.error('[RoutingRuleHandler] Delete error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Helper: get all routing rules as array.
 */
export async function getRoutingRulesData(env) {
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return [];
        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
