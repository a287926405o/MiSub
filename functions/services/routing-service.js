/**
 * Routing Service
 * Converts outbound settings and routing rules into proxy client configurations.
 *
 * Architecture (3x-ui style chain proxy):
 *   1. Outbound Settings define "exit nodes" (proxy servers to connect TO)
 *   2. Routing Rules map "proxy nodes → outbounds" creating chain effects
 *   3. Chain effect: Traffic → Subscription Node A → Outbound WARP → Internet
 *
 * This service generates the actual proxy config entries for:
 *   - Clash/Mihomo: proxies + proxy-groups
 *   - Sing-Box: outbounds
 *   - Surge: proxy entries
 *   - Loon: proxy entries
 */

import { PROTOCOL_LABELS } from '../modules/handlers/outbound-handler.js';

/**
 * Convert an outbound config to a Clash proxy entry.
 * Each outbound protocol has its own config format.
 *
 * @param {Object} ob - Outbound config object
 * @returns {Object|null} Clash proxy entry
 */
export function outboundToClashProxy(ob) {
    if (!ob || !ob.enabled) return null;

    switch (ob.protocol) {
        case 'shadowsocks':
            return {
                name: ob.name,
                type: 'ss',
                server: ob.server,
                port: ob.port,
                cipher: ob.method || 'aes-128-gcm',
                password: ob.password,
                ...(ob.plugin ? { plugin: ob.plugin, 'plugin-opts': ob.pluginOpts ? JSON.parse(ob.pluginOpts) : {} } : {})
            };
        case 'vmess':
            return {
                name: ob.name,
                type: 'vmess',
                server: ob.server,
                port: ob.port,
                uuid: ob.uuid,
                alterId: ob.alterId || 0,
                cipher: ob.cipher || 'auto',
                ...(ob.network === 'ws' ? {
                    network: 'ws',
                    'ws-opts': {
                        path: ob.wsPath || '/',
                        headers: ob.wsHost ? { Host: ob.wsHost } : {}
                    }
                } : { network: ob.network || 'tcp' }),
                ...(ob.tls ? { tls: true, servername: ob.sni || ob.server, 'skip-cert-verify': ob.skipCertVerify } : {})
            };
        case 'trojan':
            return {
                name: ob.name,
                type: 'trojan',
                server: ob.server,
                port: ob.port,
                password: ob.password,
                udp: ob.udp !== false,
                ...(ob.sni ? { sni: ob.sni } : {}),
                'skip-cert-verify': ob.skipCertVerify || false
            };
        case 'vless':
            return {
                name: ob.name,
                type: 'vless',
                server: ob.server,
                port: ob.port,
                uuid: ob.uuid,
                ...(ob.flow ? { flow: ob.flow } : {}),
                network: ob.network || 'tcp',
                tls: ob.tls || false,
                ...(ob.sni ? { 'servername': ob.sni } : {}),
                'skip-cert-verify': ob.skipCertVerify || false,
                ...(ob.reality ? {
                    reality: true,
                    'reality-opts': {
                        'public-key': ob.realityPublicKey || '',
                        'short-id': ob.realityShortId || ''
                    }
                } : {})
            };
        case 'hysteria2':
            return {
                name: ob.name,
                type: 'hysteria2',
                server: ob.server,
                port: ob.port,
                password: ob.password,
                ...(ob.sni ? { sni: ob.sni } : {}),
                'skip-cert-verify': ob.skipCertVerify || false,
                up: `${ob.upMbps || 100} Mbps`,
                down: `${ob.downMbps || 100} Mbps`
            };
        case 'socks5':
            return {
                name: ob.name,
                type: 'socks5',
                server: ob.server,
                port: ob.port,
                ...(ob.username ? { username: ob.username } : {}),
                ...(ob.password ? { password: ob.password } : {}),
                udp: ob.udp || false
            };
        case 'http':
            return {
                name: ob.name,
                type: 'http',
                server: ob.server,
                port: ob.port,
                ...(ob.username ? { username: ob.username } : {}),
                ...(ob.password ? { password: ob.password } : {}),
                tls: ob.tls || false
            };
        case 'wireguard':
            return {
                name: ob.name,
                type: 'wireguard',
                server: ob.server,
                port: ob.port,
                'private-key': ob.privateKey || '',
                'public-key': ob.publicKey || '',
                'local-address': ob.localAddress || '',
                mtu: ob.mtu || 1420,
                ...(ob.reserved ? { reserved: ob.reserved } : {})
            };
        case 'direct':
            return null; // DIRECT is built-in for Clash
        case 'block':
            return null; // REJECT is built-in for Clash
        default:
            return null;
    }
}

/**
 * Convert an outbound config to a Sing-Box outbound entry.
 *
 * @param {Object} ob - Outbound config
 * @returns {Object|null} Sing-Box outbound object
 */
export function outboundToSingboxOutbound(ob) {
    if (!ob || !ob.enabled) return null;

    const tag = ob.name;

    switch (ob.protocol) {
        case 'direct':
            return { tag, type: 'direct' };
        case 'block':
            return { tag, type: 'block' };
        case 'shadowsocks':
            return {
                tag,
                type: 'shadowsocks',
                server: ob.server,
                server_port: ob.port,
                method: ob.method || 'aes-128-gcm',
                password: ob.password
            };
        case 'vmess':
            return {
                tag,
                type: 'vmess',
                server: ob.server,
                server_port: ob.port,
                uuid: ob.uuid,
                security: ob.cipher || 'auto',
                alter_id: ob.alterId || 0,
                ...(ob.network === 'ws' ? {
                    transport: {
                        type: 'ws',
                        path: ob.wsPath || '/',
                        headers: ob.wsHost ? { Host: ob.wsHost } : {}
                    }
                } : {}),
                ...(ob.tls ? { tls: { enabled: true, server_name: ob.sni || ob.server, insecure: ob.skipCertVerify } } : {})
            };
        case 'trojan':
            return {
                tag,
                type: 'trojan',
                server: ob.server,
                server_port: ob.port,
                password: ob.password,
                ...(ob.sni ? { tls: { enabled: true, server_name: ob.sni, insecure: ob.skipCertVerify } } : {})
            };
        case 'vless':
            return {
                tag,
                type: 'vless',
                server: ob.server,
                server_port: ob.port,
                uuid: ob.uuid,
                flow: ob.flow || '',
                ...(ob.network === 'ws' ? {
                    transport: { type: 'ws', path: '/', headers: {} }
                } : {}),
                ...(ob.tls ? { tls: { enabled: true, server_name: ob.sni || ob.server, insecure: ob.skipCertVerify } } : {}),
                ...(ob.reality ? {
                    tls: {
                        enabled: true,
                        reality: {
                            enabled: true,
                            public_key: ob.realityPublicKey || '',
                            short_id: ob.realityShortId || ''
                        }
                    }
                } : {})
            };
        case 'hysteria2':
            return {
                tag,
                type: 'hysteria2',
                server: ob.server,
                server_port: ob.port,
                password: ob.password,
                ...(ob.sni ? { tls: { enabled: true, server_name: ob.sni, insecure: ob.skipCertVerify } } : {}),
                up_mbps: ob.upMbps || 100,
                down_mbps: ob.downMbps || 100
            };
        case 'socks5':
            return {
                tag,
                type: 'socks5',
                server: ob.server,
                server_port: ob.port,
                ...(ob.username ? { username: ob.username } : {}),
                ...(ob.password ? { password: ob.password } : {}),
                udp: ob.udp || false
            };
        case 'http':
            return {
                tag,
                type: 'http',
                server: ob.server,
                server_port: ob.port,
                ...(ob.username ? { username: ob.username } : {}),
                ...(ob.password ? { password: ob.password } : {}),
                tls: ob.tls || false
            };
        case 'wireguard':
            return {
                tag,
                type: 'wireguard',
                server: ob.server,
                server_port: ob.port,
                private_key: ob.privateKey || '',
                peer_public_key: ob.publicKey || '',
                local_address: ob.localAddress || '',
                mtu: ob.mtu || 1420
            };
        default:
            return null;
    }
}

/**
 * Apply routing rules to generate chain proxy groups for Clash.
 *
 * Each routing rule maps a source (proxy node name) to a target (outbound name).
 * This creates relay/chain proxy-groups in Clash format.
 *
 * @param {Array} routingRules - Routing rules
 * @param {Array} outbounds - All outbound configs
 * @param {Array} allProxyNames - All existing proxy node names
 * @returns {Object} { proxyGroups: Array, rules: Array }
 */
export function applyClashRouting(routingRules = [], outbounds = [], allProxyNames = []) {
    const proxyGroups = [];
    const clashRules = [];
    const nameSet = new Set(allProxyNames);
    const outboundMap = {};
    outbounds.filter(o => o.enabled).forEach(ob => { outboundMap[ob.id] = ob; outboundMap[ob.name] = ob; });

    // Sort by priority
    const sortedRules = [...routingRules]
        .filter(r => r.enabled)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
        const targetOb = outboundMap[rule.targetOutbound];
        if (!targetOb) continue;

        if (rule.sourceType === 'node') {
            // Node routing: Proxy Node → Outbound
            // Create a relay group: Node → Outbound
            const outboundProxy = outboundToClashProxy(targetOb);
            if (!outboundProxy && !['direct', 'block'].includes(targetOb.protocol)) continue;

            const groupName = `${rule.name || 'Route'}`;

            if (targetOb.protocol === 'direct') {
                // Node → DIRECT: just a select group that goes through the node
                if (nameSet.has(rule.sourceValue)) {
                    proxyGroups.push({
                        name: groupName,
                        type: 'select',
                        proxies: [rule.sourceValue, 'DIRECT']
                    });
                }
            } else if (targetOb.protocol === 'block') {
                if (nameSet.has(rule.sourceValue)) {
                    proxyGroups.push({
                        name: groupName,
                        type: 'select',
                        proxies: [rule.sourceValue, 'REJECT']
                    });
                }
            } else {
                // Node → Outbound: relay chain
                const proxyName = targetOb.name;
                if (nameSet.has(rule.sourceValue)) {
                    proxyGroups.push({
                        name: groupName,
                        type: 'relay',
                        proxies: [rule.sourceValue, proxyName]
                    });
                }
            }
        } else {
            // Traffic-based routing: domain/IP conditions → Outbound
            const proxyName = targetOb.protocol === 'direct' ? 'DIRECT'
                : targetOb.protocol === 'block' ? 'REJECT'
                : targetOb.name;

            switch (rule.sourceType) {
                case 'domain':
                    clashRules.push(`DOMAIN,${rule.sourceValue},${proxyName}`);
                    break;
                case 'domain_suffix':
                    clashRules.push(`DOMAIN-SUFFIX,${rule.sourceValue},${proxyName}`);
                    break;
                case 'domain_keyword':
                    clashRules.push(`DOMAIN-KEYWORD,${rule.sourceValue},${proxyName}`);
                    break;
                case 'ip_cidr':
                    clashRules.push(`IP-CIDR,${rule.sourceValue},${proxyName}`);
                    break;
                case 'geoip':
                    clashRules.push(`GEOIP,${rule.sourceValue},${proxyName}`);
                    break;
                case 'geosite':
                    clashRules.push(`GEOSITE,${rule.sourceValue},${proxyName}`);
                    break;
                case 'port':
                    clashRules.push(`DST-PORT,${rule.sourceValue},${proxyName}`);
                    break;
                case 'all':
                    clashRules.push(`MATCH,${proxyName}`);
                    break;
            }
        }
    }

    return { proxyGroups, rules: clashRules };
}

/**
 * Apply routing rules to generate chain outbounds for Sing-Box.
 *
 * @param {Array} routingRules
 * @param {Array} outbounds
 * @param {Array} allOutboundTags
 * @returns {Object} { chainOutbounds: Array, routeRules: Array }
 */
export function applySingboxRouting(routingRules = [], outbounds = [], allOutboundTags = []) {
    const routeRules = [];
    const tagSet = new Set(allOutboundTags);
    const outboundMap = {};
    outbounds.filter(o => o.enabled).forEach(ob => { outboundMap[ob.id] = ob; outboundMap[ob.name] = ob; });

    const sortedRules = [...routingRules]
        .filter(r => r.enabled)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
        const targetOb = outboundMap[rule.targetOutbound];
        if (!targetOb) continue;

        const targetTag = targetOb.protocol === 'direct' ? 'direct'
            : targetOb.protocol === 'block' ? 'block'
            : targetOb.name;

        if (rule.sourceType === 'node') {
            // Node routing → create a chain outbound or route rule
            // For Sing-Box, we create a simple route rule
            if (tagSet.has(rule.sourceValue)) {
                routeRules.push({
                    outbound: targetTag,
                    // Match by inbound tag (the proxy node name as tag)
                    inbound: [rule.sourceValue]
                });
            }
        } else {
            // Traffic-based routing
            const singboxRule = { outbound: targetTag };

            switch (rule.sourceType) {
                case 'domain':
                    singboxRule.domain = [rule.sourceValue];
                    break;
                case 'domain_suffix':
                    singboxRule.domain_suffix = [rule.sourceValue];
                    break;
                case 'domain_keyword':
                    singboxRule.domain_keyword = [rule.sourceValue];
                    break;
                case 'ip_cidr':
                    singboxRule.ip_cidr = [rule.sourceValue];
                    break;
                case 'geoip':
                    singboxRule.ip_cidr = [rule.sourceValue]; // geoip as ip_cidr
                    break;
                case 'geosite':
                    singboxRule.domain_suffix = [rule.sourceValue]; // geosite as domain
                    break;
                case 'port':
                    singboxRule.port = [parseInt(rule.sourceValue)];
                    break;
                case 'all':
                    // Default route - no conditions needed
                    break;
            }

            routeRules.push(singboxRule);
        }
    }

    return { routeRules };
}

/**
 * Convert outbound to Surge proxy entry format.
 */
export function outboundToSurgeProxy(ob) {
    if (!ob || !ob.enabled) return null;
    if (ob.protocol === 'direct' || ob.protocol === 'block') return null;

    // Surge format: ProxyName = protocol, server, port, ...
    const tag = ob.name;

    switch (ob.protocol) {
        case 'shadowsocks':
            return `${tag} = ss, ${ob.server}, ${ob.port}, encrypt-method=${ob.method || 'aes-128-gcm'}, password=${ob.password}`;
        case 'vmess':
            return `${tag} = vmess, ${ob.server}, ${ob.port}, username=${ob.uuid}, tls=${ob.tls ? 'true' : 'false'}`;
        case 'trojan':
            return `${tag} = trojan, ${ob.server}, ${ob.port}, password=${ob.password}${ob.sni ? `, sni=${ob.sni}` : ''}, skip-cert-verify=${ob.skipCertVerify || false}`;
        case 'socks5':
            return `${tag} = socks5, ${ob.server}, ${ob.port}${ob.username ? `, username=${ob.username}, password=${ob.password}` : ''}`;
        case 'http':
            return `${tag} = http, ${ob.server}, ${ob.port}${ob.username ? `, username=${ob.username}, password=${ob.password}` : ''}`;
        default:
            return null;
    }
}

/**
 * Get the display label for an outbound protocol.
 */
export function getProtocolLabel(protocol) {
    return PROTOCOL_LABELS[protocol] || protocol;
}

/**
 * Get all available node names combined with outbound names as routing targets.
 */
export function getAvailableTargets(allProxyNames = [], outbounds = []) {
    const targets = [
        { id: 'DIRECT', name: 'DIRECT (直连)', type: 'builtin' },
        { id: 'REJECT', name: 'REJECT (拒绝)', type: 'builtin' }
    ];

    // Proxy nodes as targets
    allProxyNames.forEach(name => {
        targets.push({ id: name, name: `节点: ${name}`, type: 'proxy' });
    });

    // Outbound configs as targets
    outbounds.filter(o => o.enabled).forEach(ob => {
        targets.push({
            id: ob.id,
            name: `出站: ${ob.name} (${getProtocolLabel(ob.protocol)})`,
            type: 'outbound'
        });
    });

    return targets;
}
