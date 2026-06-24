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
import { KV_KEY_CHAINS, KV_KEY_SUBS } from '../config.js';
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

/**
 * 解析单行代理 URL（vless://, socks5://, vmess://, ss://, trojan:// 等）为 Clash proxy 对象
 * 简化版实现，覆盖常见协议
 */
function parseProxyUrl(urlStr, name) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    try {
        const parsed = new URL(urlStr);
        const protocol = parsed.protocol.replace(':', '');
        const host = parsed.hostname;
        const port = parsed.port || (protocol === 'https' ? 443 : 80);

        switch (protocol) {
            case 'vless':
                return { name, type: 'vless', server: host, port: parseInt(port), uuid: parsed.username, flow: parsed.searchParams.get('flow') || '', tls: parsed.searchParams.get('security') === 'tls' || parsed.searchParams.get('security') === 'reality', servername: parsed.searchParams.get('sni') || parsed.searchParams.get('fp') || '', 'client-fingerprint': parsed.searchParams.get('fp') || '' };
            case 'vmess':
                return { name, type: 'vmess', server: host, port: parseInt(port), uuid: parsed.username, alterId: 0, cipher: 'auto', tls: parsed.searchParams.get('security') === 'tls' || parsed.searchParams.get('tls') === 'true' };
            case 'trojan':
                return { name, type: 'trojan', server: host, port: parseInt(port), password: parsed.username, sni: parsed.searchParams.get('sni') || host, udp: true };
            case 'ss':
                return { name, type: 'ss', server: host, port: parseInt(port), password: parsed.username, cipher: parsed.searchParams.get('method') || 'aes-256-gcm', udp: true };
            case 'socks5':
            case 'socks':
                return { name, type: 'socks5', server: host, port: parseInt(port), username: parsed.username, password: parsed.password, udp: true };
            case 'hysteria':
            case 'hy':
                return { name, type: 'hysteria', server: host, port: parseInt(port), auth_str: parsed.username, protocol: parsed.searchParams.get('protocol') || 'udp', up: parsed.searchParams.get('up') || '100', down: parsed.searchParams.get('down') || '100' };
            case 'hysteria2':
            case 'hy2':
                return { name, type: 'hysteria2', server: host, port: parseInt(port), password: parsed.username, sni: parsed.searchParams.get('sni') || host };
            case 'tuic':
                return { name, type: 'tuic', server: host, port: parseInt(port), token: parsed.username, sni: parsed.searchParams.get('sni') || host, udp: true };
            default:
                // 未知协议，返回基本配置
                return { name, type: 'ss', server: host, port: parseInt(port), cipher: 'none', password: 'unknown' };
        }
    } catch (e) {
        return { name, type: 'ss', server: '127.0.0.1', port: 1080, cipher: 'none', password: 'dummy' };
    }
}


/**
 * 导出链式代理为独立订阅配置
 * GET /api/chains/{id}/export?target=clash|singbox|v2ray|auto
 *
 * 加载链中各节点实际的代理 URL，生成可直接导入客户端的最小配置。
 * 输出格式：
 *   clash     — YAML（proxies + relay proxy-group）
 *   singbox   — JSON（chain outbounds）
 *   v2ray     — Base64 编码的单行节点链接（兼容 v2rayN）
 *   auto      — 根据 User-Agent 自动探测
 */
export async function handleChainExport(request, env, chainId) {
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

        // --- 1. 加载链 ---
        const rawChain = await storage.get(KV_KEY_CHAINS);
        const chains = rawChain ? JSON.parse(rawChain) : [];
        const chain = chains.find(c => c.id === chainId);
        if (!chain) {
            return createJsonResponse({ success: false, message: 'Chain not found' }, 404);
        }
        if (!chain.enabled) {
            return createJsonResponse({ success: false, message: 'Chain is disabled' }, 400);
        }
        const nodeNames = Array.isArray(chain.nodes) ? chain.nodes : [];
        if (nodeNames.length < 2) {
            return createJsonResponse({ success: false, message: 'Chain must have at least 2 nodes' }, 400);
        }

        // --- 2. 加载所有订阅，建立 节点名 → 代理 URL 的映射 ---
        const subsRaw = await storage.get(KV_KEY_SUBS);
        const allMisubs = subsRaw ? JSON.parse(subsRaw) : [];

        const nodeUrlMap = {};  // name → raw proxy URL (vless://...)
        for (const sub of allMisubs) {
            // 手动节点：sub.url 就是代理链接（如 vless://）
            if (sub.url && !sub.url.toLowerCase().startsWith('http')) {
                if (sub.name) nodeUrlMap[sub.name] = sub.url;
                continue;
            }
            // 订阅源：sub.nodes 包含解析后的节点
            if (sub.nodes && Array.isArray(sub.nodes)) {
                for (const node of sub.nodes) {
                    const nodeName = typeof node === 'string' ? node : node?.name;
                    const nodeUrl = typeof node === 'string' ? node : node?.url;
                    if (nodeName && nodeUrl) nodeUrlMap[nodeName] = nodeUrl;
                }
            }
        }

        // --- 3. 获取每个链节点的实际 URL ---
        const nodeUrls = [];
        const validNames = [];
        for (const name of nodeNames) {
            const url = nodeUrlMap[name];
            if (url) {
                nodeUrls.push(url);
                validNames.push(name);
            }
        }
        if (validNames.length < 2) {
            return createJsonResponse({ success: false, message: 'Not enough valid node URLs found' }, 400);
        }

        // --- 4. 确定目标格式 ---
        const url = new URL(request.url);
        let target = (url.searchParams.get('target') || 'auto').toLowerCase();

        if (target === 'auto') {
            const ua = (request.headers.get('User-Agent') || '').toLowerCase();
            if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash') || ua.includes('meta')) {
                target = 'clash';
            } else if (ua.includes('sing-box') || ua.includes('singbox') || ua.includes('sfi') || ua.includes('sfa')) {
                target = 'singbox';
            } else if (ua.includes('v2ray') || ua.includes('v2rayn') || ua.includes('nekoray') || ua.includes('qv2ray')) {
                target = 'v2ray';
            } else if (ua.includes('shadowrocket') || ua.includes('quantumult') || ua.includes('surge') || ua.includes('loon') || ua.includes('stash')) {
                target = 'clash';
            } else {
                target = 'clash'; // 默认 clash
            }
        }

        // --- 5. 按格式生成输出 ---

        // singbox: 生成 JSON
        if (target === 'singbox' || target === 'sing-box') {
            return generateSingboxOutput(chain, validNames, nodeUrls);
        }

        // v2ray: 生成 base64 单行节点（落地节点 = 出口 = 最后一个节点）
        if (target === 'v2ray' || target === 'base64') {
            return generateV2rayOutput(chain, validNames, nodeUrls);
        }

        // 默认 clash: 生成 YAML
        return generateClashOutput(chain, validNames, nodeUrls);
    } catch (error) {
        console.error('[ChainHandler] Export error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * 生成 Clash YAML 配置（proxies + relay proxy-group）
 */
function generateClashOutput(chain, validNames, nodeUrls) {
    // 生成每个节点的 Clash proxy 配置
    const proxies = [];
    for (let i = 0; i < validNames.length; i++) {
        const name = validNames[i];
        const urlStr = nodeUrls[i];
        const proxy = parseProxyUrl(urlStr, name);
        if (proxy) {
            proxies.push(proxy);
        } else {
            proxies.push({ name, type: 'ss', server: '127.0.0.1', port: 1080, cipher: 'none', password: 'placeholder' });
        }
    }

    const chainMode = chain.mode === 'chain' ? 'chain' : 'relay';
    const chainName = chain.name || 'Chain';

    let yaml = '# Chain Proxy Export - ' + chainName + '\n';
    yaml += '# Mode: ' + chainMode + '\n';
    yaml += '# Route: ' + validNames.join(' → ') + '\n';
    yaml += '# Generated by MiSub Chain Proxy\n';
    yaml += '\n';
    yaml += 'port: 7890\n';
    yaml += 'socks-port: 7891\n';
    yaml += 'mode: Rule\n';
    yaml += 'log-level: info\n';
    yaml += '\n';
    yaml += 'proxies:\n';
    for (const p of proxies) {
        yaml += '  - {"name":"' + escYaml(p.name) + '","type":"' + p.type + '","server":"' + p.server + '","port":' + p.port;
        // Add protocol-specific fields
        if (p.uuid) yaml += ',"uuid":"' + p.uuid + '"';
        if (p.password) yaml += ',"password":"' + escYaml(p.password) + '"';
        if (p.cipher) yaml += ',"cipher":"' + p.cipher + '"';
        if (p.tls) yaml += ',"tls":true';
        if (p.sni) yaml += ',"sni":"' + p.sni + '"';
        if (p['client-fingerprint']) yaml += ',"client-fingerprint":"' + p['client-fingerprint'] + '"';
        if (p.flow) yaml += ',"flow":"' + p.flow + '"';
        if (p.udp) yaml += ',"udp":true';
        if (p.username) yaml += ',"username":"' + escYaml(p.username) + '"';
        yaml += '}\n';
    }
    yaml += '\n';
    yaml += 'proxy-groups:\n';
    yaml += '  - {name: "' + escYaml(chainName) + '", type: ' + chainMode + ', proxies: [' + validNames.map(n => '"' + escYaml(n) + '"').join(', ') + ']}\n';
    yaml += '\n';
    yaml += 'rules:\n';
    yaml += '  - MATCH,' + escYaml(chainName) + '\n';

    return new Response(yaml, {
        headers: {
            'Content-Type': 'application/x-yaml; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + (chain.name || 'chain') + '-clash.yaml"'
        }
    });
}

/**
 * 生成 Sing-Box JSON 配置（chain outbounds）
 */
function generateSingboxOutput(chain, validNames, nodeUrls) {
    const outbounds = [];
    const chainTags = [];

    for (let i = 0; i < validNames.length; i++) {
        const name = validNames[i];
        const tag = 'chain-node-' + name.replace(/[^a-zA-Z0-9_-]/g, '_');
        chainTags.push(tag);

        const urlStr = nodeUrls[i];
        const parsed = parseProxyUrlForSingbox(urlStr, tag);
        outbounds.push(parsed);
    }

    const chainName = chain.name || 'Chain';
    outbounds.push({
        tag: chainName,
        type: 'chain',
        outbounds: chainTags
    });

    const config = {
        log: { level: 'info' },
        dns: {
            servers: [{ tag: 'dns', address: '1.1.1.1' }]
        },
        inbounds: [{
            type: 'mixed',
            tag: 'mixed-in',
            listen: '0.0.0.0',
            listen_port: 7890
        }],
        outbounds: [
            ...outbounds,
            { tag: 'direct', type: 'direct' },
            { tag: 'block', type: 'block' }
        ],
        route: {
            rules: [{ outbound: chainName }]
        }
    };

    return new Response(JSON.stringify(config, null, 2), {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + (chain.name || 'chain') + '-singbox.json"'
        }
    });
}

/**
 * 生成 v2rayN 兼容的 Base64 订阅（落地节点 = 最后一个节点）
 */
function generateV2rayOutput(chain, validNames, nodeUrls) {
    // 出口是最后一个节点
    const exitIdx = nodeUrls.length - 1;
    const exitUrl = nodeUrls[exitIdx];

    // v2rayN 期望每个节点一行，整体 base64
    const nodeLine = exitUrl;  // 直接用原始 URL
    const base64Content = btoa(nodeLine);

    const comment = [
        '# Chain: ' + (chain.name || 'Unnamed'),
        '# Route: ' + validNames.join(' → '),
        '# Export node: ' + validNames[exitIdx] + ' (exit)',
        '# Generated by MiSub'
    ].join('\n');

    return new Response(comment + '\n' + base64Content, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + (chain.name || 'chain') + '-v2ray.txt"'
        }
    });
}

/**
 * URL 中 YAML 特殊字符转义
 */
function escYaml(val) {
    if (typeof val !== 'string') return val;
    return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 解析代理 URL 为 Sing-Box outbound 对象（简化版）
 */
function parseProxyUrlForSingbox(urlStr, tag) {
    if (!urlStr || typeof urlStr !== 'string') {
        return { tag, type: 'direct', server: '127.0.0.1', server_port: 1080 };
    }
    try {
        const parsed = new URL(urlStr);
        const protocol = parsed.protocol.replace(':', '');
        const host = parsed.hostname;
        const port = parseInt(parsed.port) || (protocol === 'https' ? 443 : 80);

        const base = { tag, server: host, server_port: port };

        switch (protocol) {
            case 'vless':
                return { ...base, type: 'vless', uuid: parsed.username, flow: parsed.searchParams.get('flow') || '' };
            case 'vmess':
                return { ...base, type: 'vmess', uuid: parsed.username };
            case 'trojan':
                return { ...base, type: 'trojan', password: parsed.username };
            case 'ss':
                return { ...base, type: 'shadowsocks', method: parsed.searchParams.get('method') || 'aes-256-gcm', password: parsed.username };
            case 'socks5':
            case 'socks':
                return { ...base, type: 'socks5', username: parsed.username, password: parsed.password };
            case 'hysteria':
            case 'hy':
                return { ...base, type: 'hysteria', auth_str: parsed.username };
            case 'hysteria2':
            case 'hy2':
                return { ...base, type: 'hysteria2', password: parsed.username };
            case 'tuic':
                return { ...base, type: 'tuic', token: parsed.username };
            default:
                return { tag, type: 'direct', server: '127.0.0.1', server_port: 1080 };
        }
    } catch (e) {
        return { tag, type: 'direct', server: '127.0.0.1', server_port: 1080 };
    }
}
