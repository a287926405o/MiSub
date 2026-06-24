<script setup>
import { ref, computed, onMounted } from 'vue';
import { useDataStore } from '../stores/useDataStore.js';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '../stores/editor.js';
import { api } from '../lib/http.js';
import { useToastStore } from '../stores/toast';

const dataStore = useDataStore();
const editorStore = useEditorStore();
const toastStore = useToastStore();
const { showToast } = toastStore;
const { outbounds } = storeToRefs(dataStore);

const PROTOCOLS = [
  { value: 'shadowsocks', label: 'Shadowsocks', icon: '🔑', fields: ['server','port','method','password','plugin'] },
  { value: 'vmess', label: 'VMess', icon: '🔮', fields: ['server','port','uuid','alterId','cipher','network','tls','sni','wsPath','wsHost'] },
  { value: 'trojan', label: 'Trojan', icon: '🛡️', fields: ['server','port','password','sni','skipCertVerify'] },
  { value: 'vless', label: 'VLESS', icon: '⚡', fields: ['server','port','uuid','flow','network','tls','sni','reality','realityPublicKey','realityShortId'] },
  { value: 'hysteria2', label: 'Hysteria2', icon: '🌊', fields: ['server','port','password','sni','upMbps','downMbps'] },
  { value: 'socks5', label: 'SOCKS5', icon: '🧦', fields: ['server','port','username','password','udp'] },
  { value: 'http', label: 'HTTP', icon: '🌐', fields: ['server','port','username','password','tls'] },
  { value: 'wireguard', label: 'WireGuard', icon: '🔒', fields: ['server','port','privateKey','publicKey','localAddress','mtu'] },
  { value: 'direct', label: 'Direct (直连)', icon: '→', fields: [] },
  { value: 'block', label: 'Block (拒绝)', icon: '✕', fields: [] }
];

const isLoading = ref(false);
const showEditor = ref(false);
const editingOutbound = ref(null);
const isSaving = ref(false);

const form = ref({
  name: '',
  protocol: 'shadowsocks',
  enabled: true,
  description: '',
  server: '',
  port: 443,
  method: 'aes-128-gcm',
  password: '',
  plugin: '',
  pluginOpts: '',
  uuid: '',
  alterId: 0,
  cipher: 'auto',
  network: 'tcp',
  tls: true,
  sni: '',
  skipCertVerify: false,
  wsPath: '/',
  wsHost: '',
  flow: '',
  reality: false,
  realityPublicKey: '',
  realityShortId: '',
  upMbps: 100,
  downMbps: 100,
  username: '',
  udp: false,
  privateKey: '',
  publicKey: '',
  localAddress: '',
  mtu: 1420,
  reserved: ''
});

const currentProtocol = computed(() => PROTOCOLS.find(p => p.value === form.value.protocol));

function getProtocolLabel(protocol) {
  return PROTOCOLS.find(p => p.value === protocol)?.label || protocol;
}

function getProtocolIcon(protocol) {
  return PROTOCOLS.find(p => p.value === protocol)?.icon || '?';
}

function openCreate() {
  editingOutbound.value = null;
  resetForm();
  showEditor.value = true;
}

function openEdit(ob) {
  editingOutbound.value = ob;
  Object.keys(form.value).forEach(key => {
    if (key === 'enabled') form.value[key] = ob[key] !== false;
    else form.value[key] = ob[key] !== undefined ? ob[key] : form.value[key];
  });
  showEditor.value = true;
}

function resetForm() {
  form.value = {
    name: '', protocol: 'shadowsocks', enabled: true, description: '',
    server: '', port: 443, method: 'aes-128-gcm', password: '',
    plugin: '', pluginOpts: '',
    uuid: '', alterId: 0, cipher: 'auto', network: 'tcp', tls: true,
    sni: '', skipCertVerify: false, wsPath: '/', wsHost: '',
    flow: '', reality: false, realityPublicKey: '', realityShortId: '',
    upMbps: 100, downMbps: 100,
    username: '', udp: false,
    privateKey: '', publicKey: '', localAddress: '', mtu: 1420, reserved: ''
  };
}

async function saveOutbound() {
  if (!form.value.name.trim()) { showToast('出站名称不能为空', 'warning'); return; }
  const proto = form.value.protocol;
  if (!['direct', 'block'].includes(proto) && !form.value.server) {
    showToast('服务器地址不能为空', 'warning'); return;
  }
  isSaving.value = true;
  try {
    const payload = { ...form.value };
    if (editingOutbound.value) {
      const res = await api.put(`/api/outbounds/${editingOutbound.value.id}`, payload);
      if (res.success) {
        const idx = outbounds.value.findIndex(o => o.id === editingOutbound.value.id);
        if (idx !== -1) outbounds.value[idx] = res.data;
        showToast('出站已保存', 'success');
      }
    } else {
      const res = await api.post('/api/outbounds', payload);
      if (res.success) { outbounds.value.push(res.data); showToast('出站已创建', 'success'); }
    }
    showEditor.value = false;
    editorStore.markDirty();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    isSaving.value = false;
  }
}

async function removeOutbound(ob) {
  if (!window.confirm(`确定删除出站 "${ob.name}" 吗？`)) return;
  try {
    const res = await api.del(`/api/outbounds/${ob.id}`);
    if (res.success) {
      outbounds.value = outbounds.value.filter(o => o.id !== ob.id);
      showToast('出站已删除', 'success');
      editorStore.markDirty();
    }
  } catch (e) { showToast(e.message || '删除失败', 'error'); }
}

async function toggleOutbound(ob) {
  try {
    const res = await api.put(`/api/outbounds/${ob.id}`, { enabled: !ob.enabled });
    if (res.success) { Object.assign(ob, res.data); editorStore.markDirty(); }
  } catch (e) { showToast(e.message || '切换失败', 'error'); }
}

onMounted(async () => {
  isLoading.value = true;
  try { await dataStore.fetchData(); } catch (e) { console.error(e); }
  finally { isLoading.value = false; }
});
</script>

<template>
  <div class="outbound-settings">
    <div class="page-header">
      <div>
        <h2>📡 出站设置</h2>
        <p class="text-muted">像 3x-ui 一样添加出口节点信息，作为路由规则的目标</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新增出站
      </button>
    </div>

    <div v-if="outbounds.length === 0" class="empty-state">
      <div class="empty-icon">📡</div>
      <h3>暂无出站配置</h3>
      <p>在这里添加代理出口节点（Shadowsocks/VMess/Trojan/WARP等），然后在路由规则中选择节点通过此出站实现链式代理</p>
    </div>

    <div v-else class="outbound-grid">
      <div v-for="ob in outbounds" :key="ob.id" class="card" :class="{ disabled: !ob.enabled }">
        <div class="card-header">
          <span class="proto-badge">{{ getProtocolIcon(ob.protocol) }} {{ getProtocolLabel(ob.protocol) }}</span>
          <label class="toggle">
            <input type="checkbox" :checked="ob.enabled" @change="toggleOutbound(ob)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="card-body">
          <h4>{{ ob.name }}</h4>
          <div class="card-info" v-if="!['direct','block'].includes(ob.protocol)">
            <span>{{ ob.server }}:{{ ob.port }}</span>
          </div>
          <div class="card-info" v-if="ob.protocol === 'direct'">直连，不经过任何代理</div>
          <div class="card-info" v-if="ob.protocol === 'block'">拦截所有流量</div>
          <p v-if="ob.description" class="desc">{{ ob.description }}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm" @click="openEdit(ob)">编辑</button>
          <button class="btn btn-sm btn-danger" @click="removeOutbound(ob)">删除</button>
        </div>
      </div>
    </div>

    <!-- Editor Modal -->
    <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editingOutbound ? '编辑出站' : '新增出站' }}</h3>
          <button class="btn-close" @click="showEditor = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>名称</label>
            <input v-model="form.name" class="form-input" placeholder="例如: 我的WARP出口" />
          </div>
          <div class="form-group">
            <label>协议类型</label>
            <select v-model="form.protocol" class="form-input">
              <option v-for="p in PROTOCOLS" :key="p.value" :value="p.value">{{ p.icon }} {{ p.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>描述（可选）</label>
            <input v-model="form.description" class="form-input" placeholder="描述这个出站的用途" />
          </div>

          <!-- Protocol-specific fields -->
          <template v-if="!['direct','block'].includes(form.protocol)">
            <div class="form-row">
              <div class="form-group flex-2">
                <label>服务器地址</label>
                <input v-model="form.server" class="form-input" placeholder="example.com 或 IP" />
              </div>
              <div class="form-group flex-1">
                <label>端口</label>
                <input v-model.number="form.port" class="form-input" type="number" placeholder="443" />
              </div>
            </div>
          </template>

          <!-- Shadowsocks fields -->
          <template v-if="form.protocol === 'shadowsocks'">
            <div class="form-group">
              <label>加密方法</label>
              <input v-model="form.method" class="form-input" placeholder="aes-128-gcm" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input v-model="form.password" class="form-input" type="password" placeholder="密码" />
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>插件（可选）</label>
                <input v-model="form.plugin" class="form-input" placeholder="v2ray-plugin" />
              </div>
              <div class="form-group flex-2">
                <label>插件参数（可选）</label>
                <input v-model="form.pluginOpts" class="form-input" placeholder='{"mode":"websocket","tls":true}' />
              </div>
            </div>
          </template>

          <!-- VMess fields -->
          <template v-if="form.protocol === 'vmess'">
            <div class="form-group">
              <label>UUID</label>
              <input v-model="form.uuid" class="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>Alter ID</label>
                <input v-model.number="form.alterId" class="form-input" type="number" placeholder="0" />
              </div>
              <div class="form-group flex-1">
                <label>加密方式</label>
                <input v-model="form.cipher" class="form-input" placeholder="auto" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>传输协议</label>
                <select v-model="form.network" class="form-input">
                  <option value="tcp">TCP</option>
                  <option value="ws">WebSocket</option>
                  <option value="grpc">gRPC</option>
                </select>
              </div>
              <div class="form-group flex-1">
                <label>TLS</label>
                <select v-model="form.tls" class="form-input">
                  <option :value="true">开启</option>
                  <option :value="false">关闭</option>
                </select>
              </div>
            </div>
            <template v-if="form.network === 'ws'">
              <div class="form-row">
                <div class="form-group flex-1">
                  <label>WebSocket 路径</label>
                  <input v-model="form.wsPath" class="form-input" placeholder="/" />
                </div>
                <div class="form-group flex-2">
                  <label>WebSocket 主机 (Host)</label>
                  <input v-model="form.wsHost" class="form-input" placeholder="example.com" />
                </div>
              </div>
            </template>
            <div class="form-group" v-if="form.tls">
              <label>SNI（服务器名称指示）</label>
              <input v-model="form.sni" class="form-input" placeholder="example.com" />
            </div>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.skipCertVerify" /> 跳过证书验证
            </label>
          </template>

          <!-- Trojan fields -->
          <template v-if="form.protocol === 'trojan'">
            <div class="form-group">
              <label>密码</label>
              <input v-model="form.password" class="form-input" type="password" placeholder="密码" />
            </div>
            <div class="form-group">
              <label>SNI</label>
              <input v-model="form.sni" class="form-input" placeholder="example.com" />
            </div>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.skipCertVerify" /> 跳过证书验证
            </label>
          </template>

          <!-- VLESS fields -->
          <template v-if="form.protocol === 'vless'">
            <div class="form-group">
              <label>UUID</label>
              <input v-model="form.uuid" class="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </div>
            <div class="form-group">
              <label>Flow (流控)</label>
              <input v-model="form.flow" class="form-input" placeholder="xtls-rprx-vision" />
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>传输协议</label>
                <select v-model="form.network" class="form-input">
                  <option value="tcp">TCP</option>
                  <option value="ws">WebSocket</option>
                  <option value="grpc">gRPC</option>
                </select>
              </div>
              <div class="form-group flex-1">
                <label>TLS</label>
                <select v-model="form.tls" class="form-input">
                  <option :value="true">开启</option>
                  <option :value="false">关闭</option>
                </select>
              </div>
            </div>
            <div class="form-group" v-if="form.tls">
              <label>SNI</label>
              <input v-model="form.sni" class="form-input" placeholder="example.com" />
            </div>
            <div class="form-row" v-if="form.tls">
              <div class="form-group flex-1">
                <label>REALITY</label>
                <select v-model="form.reality" class="form-input">
                  <option :value="true">开启</option>
                  <option :value="false">关闭</option>
                </select>
              </div>
              <div class="form-group flex-2" v-if="form.reality">
                <label>REALITY Public Key</label>
                <input v-model="form.realityPublicKey" class="form-input" placeholder="public key" />
              </div>
            </div>
            <div class="form-group" v-if="form.reality">
              <label>REALITY Short ID</label>
              <input v-model="form.realityShortId" class="form-input" placeholder="short id" />
            </div>
          </template>

          <!-- Hysteria2 fields -->
          <template v-if="form.protocol === 'hysteria2'">
            <div class="form-group">
              <label>密码</label>
              <input v-model="form.password" class="form-input" type="password" placeholder="密码" />
            </div>
            <div class="form-group">
              <label>SNI</label>
              <input v-model="form.sni" class="form-input" placeholder="example.com" />
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>上行速度 (Mbps)</label>
                <input v-model.number="form.upMbps" class="form-input" type="number" placeholder="100" />
              </div>
              <div class="form-group flex-1">
                <label>下行速度 (Mbps)</label>
                <input v-model.number="form.downMbps" class="form-input" type="number" placeholder="100" />
              </div>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.skipCertVerify" /> 跳过证书验证
            </label>
          </template>

          <!-- SOCKS5 fields -->
          <template v-if="form.protocol === 'socks5'">
            <div class="form-row">
              <div class="form-group flex-1">
                <label>用户名（可选）</label>
                <input v-model="form.username" class="form-input" placeholder="用户名" />
              </div>
              <div class="form-group flex-1">
                <label>密码（可选）</label>
                <input v-model="form.password" class="form-input" type="password" placeholder="密码" />
              </div>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.udp" /> 启用 UDP
            </label>
          </template>

          <!-- HTTP fields -->
          <template v-if="form.protocol === 'http'">
            <div class="form-row">
              <div class="form-group flex-1">
                <label>用户名（可选）</label>
                <input v-model="form.username" class="form-input" placeholder="用户名" />
              </div>
              <div class="form-group flex-1">
                <label>密码（可选）</label>
                <input v-model="form.password" class="form-input" type="password" placeholder="密码" />
              </div>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" v-model="form.tls" /> 使用 TLS
            </label>
          </template>

          <!-- WireGuard fields -->
          <template v-if="form.protocol === 'wireguard'">
            <div class="form-group">
              <label>私钥 (Private Key)</label>
              <input v-model="form.privateKey" class="form-input" placeholder="私钥" />
            </div>
            <div class="form-group">
              <label>对端公钥 (Public Key)</label>
              <input v-model="form.publicKey" class="form-input" placeholder="公钥" />
            </div>
            <div class="form-group">
              <label>本地地址 (Local Address)</label>
              <input v-model="form.localAddress" class="form-input" placeholder="10.0.0.2/24" />
            </div>
            <div class="form-group">
              <label>MTU</label>
              <input v-model.number="form.mtu" class="form-input" type="number" placeholder="1420" />
            </div>
            <div class="form-group">
              <label>Reserved（可选）</label>
              <input v-model="form.reserved" class="form-input" placeholder="0,0,0" />
            </div>
          </template>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="showEditor = false">取消</button>
          <button class="btn btn-primary" :disabled="isSaving" @click="saveOutbound">
            {{ isSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.outbound-settings { max-width: 1200px; margin: 0 auto; padding: 24px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.page-header h2 { margin: 0; font-size: 1.5rem; }
.text-muted { color: var(--text-secondary, #94a3b8); margin: 4px 0 0; font-size: 0.875rem; }
.outbound-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.card { background: var(--card-bg, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 16px; }
.card.disabled { opacity: 0.5; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.proto-badge { font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; background: var(--badge-bg, #334155); }
.card-body h4 { margin: 0 0 4px; }
.card-info { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); margin: 4px 0; }
.desc { font-size: 0.8rem; color: var(--text-secondary); margin: 4px 0; }
.card-actions { display: flex; gap: 8px; margin-top: 12px; }
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--card-bg, #1e293b); border-radius: 16px; padding: 24px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h3 { margin: 0; }
.btn-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
.form-row { display: flex; gap: 12px; }
.form-group { margin-bottom: 16px; }
.form-group.flex-1 { flex: 1; }
.form-group.flex-2 { flex: 2; }
.form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--input-bg, #0f172a); color: inherit; font-size: 0.875rem; box-sizing: border-box; }
.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; margin-bottom: 12px; cursor: pointer; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color, #334155); }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-color, #334155); background: var(--btn-bg, #334155); color: inherit; cursor: pointer; font-size: 0.875rem; }
.btn-primary { background: var(--primary, #3b82f6); border-color: var(--primary, #3b82f6); color: white; }
.btn-danger { background: var(--danger, #ef4444); border-color: var(--danger, #ef4444); color: white; }
.btn-sm { padding: 4px 12px; font-size: 0.8rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #475569; border-radius: 22px; transition: 0.3s; }
.toggle-slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 2px; bottom: 2px; background: white; border-radius: 50%; transition: 0.3s; }
.toggle input:checked + .toggle-slider { background: var(--primary, #3b82f6); }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }
</style>
