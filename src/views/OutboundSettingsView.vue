<script setup>
import { ref, computed, onMounted } from 'vue';
import { useDataStore } from '../stores/useDataStore.js';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '../stores/editor.js';
import { api } from '../lib/http.js';
import { useToastStore } from '../stores/toast';
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
const dataStore = useDataStore();
const editorStore = useEditorStore();
const toastStore = useToastStore();
const { showToast } = toastStore;

const { outbounds } = storeToRefs(dataStore);

const OUTBOUND_TYPES = [
  { value: 'direct', label: 'Direct (直连)', icon: '→', desc: '直接连接，不经过代理' },
  { value: 'block', label: 'Block (拒绝)', icon: '✕', desc: '拦截所有流量' },
  { value: 'dns', label: 'DNS', icon: '🌐', desc: 'DNS 出站' },
  { value: 'proxy', label: 'Proxy (代理节点)', icon: '🔗', desc: '转发到指定代理节点' },
  { value: 'load_balance', label: 'Load Balance (负载均衡)', icon: '⚖️', desc: '在多个节点间分发流量' },
  { value: 'chain', label: 'Chain (链式代理)', icon: '⛓️', desc: '链式多跳代理' },
  { value: 'wireguard', label: 'WireGuard', icon: '🔒', desc: 'WireGuard VPN 出站' },
  { value: 'custom', label: 'Custom (自定义)', icon: '⚙️', desc: '自定义 JSON 配置' }
];

const LB_STRATEGIES = [
  { value: 'random', label: 'Random (随机)' },
  { value: 'round_robin', label: 'Round Robin (轮询)' },
  { value: 'least_ping', label: 'Least Ping (最低延迟)' },
  { value: 'least_load', label: 'Least Load (最低负载)' },
  { value: 'consistent_hashing', label: 'Consistent Hashing (一致性哈希)' }
];

const isLoading = ref(false);
const showEditor = ref(false);
const editingOutbound = ref(null);
const isSaving = ref(false);

const form = ref({
  name: '',
  type: 'direct',
  enabled: true,
  description: '',
  config: {},
  targets: [],
  strategy: 'random',
  proxyNode: '',
  chainId: '',
  wireguardConfig: {},
  customConfig: ''
});

const availableProxyNodes = computed(() => {
  const nodes = [];
  const subs = dataStore.subscriptions || [];
  subs.forEach(sub => {
    if (sub.nodes && Array.isArray(sub.nodes)) {
      sub.nodes.forEach(node => {
        if (typeof node === 'string') nodes.push(node);
        else if (node?.name) nodes.push(node.name);
      });
    }
  });
  return [...new Set(nodes)].sort();
});

const availableChains = computed(() => {
  return (dataStore.chains || []).filter(c => c.enabled);
});

const newTarget = ref('');

function openCreate() {
  editingOutbound.value = null;
  form.value = { name: '', type: 'direct', enabled: true, description: '', config: {}, targets: [], strategy: 'random', proxyNode: '', chainId: '', wireguardConfig: {}, customConfig: '' };
  showEditor.value = true;
}

function openEdit(outbound) {
  editingOutbound.value = outbound;
  form.value = {
    name: outbound.name || '',
    type: outbound.type || 'direct',
    enabled: outbound.enabled !== false,
    description: outbound.description || '',
    config: { ...(outbound.config || {}) },
    targets: [...(outbound.targets || [])],
    strategy: outbound.strategy || 'random',
    proxyNode: outbound.proxyNode || '',
    chainId: outbound.chainId || '',
    wireguardConfig: { ...(outbound.wireguardConfig || {}) },
    customConfig: outbound.customConfig || ''
  };
  showEditor.value = true;
}

async function saveOutbound() {
  if (!form.value.name.trim()) { showToast('出站名称不能为空', 'warning'); return; }
  isSaving.value = true;
  try {
    if (editingOutbound.value) {
      const res = await api.put(`/api/outbounds/${editingOutbound.value.id}`, form.value);
      if (res.success) {
        const idx = outbounds.value.findIndex(o => o.id === editingOutbound.value.id);
        if (idx !== -1) outbounds.value[idx] = res.data;
        showToast('出站配置已保存', 'success');
      }
    } else {
      const res = await api.post('/api/outbounds', form.value);
      if (res.success) { outbounds.value.push(res.data); showToast('出站配置已创建', 'success'); }
    }
    showEditor.value = false;
    editorStore.markDirty();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    isSaving.value = false;
  }
}

async function removeOutbound(outbound) {
  if (!window.confirm(`确定要删除出站配置 "${outbound.name}" 吗？`)) return;
  try {
    const res = await api.del(`/api/outbounds/${outbound.id}`);
    if (res.success) {
      outbounds.value = outbounds.value.filter(o => o.id !== outbound.id);
      showToast('出站配置已删除', 'success');
      editorStore.markDirty();
    }
  } catch (e) { showToast(e.message || '删除失败', 'error'); }
}

async function toggleOutbound(outbound) {
  try {
    const res = await api.put(`/api/outbounds/${outbound.id}`, { enabled: !outbound.enabled });
    if (res.success) { Object.assign(outbound, res.data); editorStore.markDirty(); }
  } catch (e) { showToast(e.message || '切换失败', 'error'); }
}

function addTarget() {
  if (newTarget.value && !form.value.targets.includes(newTarget.value)) {
    form.value.targets.push(newTarget.value);
    newTarget.value = '';
  }
}

function removeTarget(idx) {
  form.value.targets.splice(idx, 1);
}

function getTypeLabel(type) {
  const found = OUTBOUND_TYPES.find(t => t.value === type);
  return found ? found.label : type;
}

function getTypeIcon(type) {
  const found = OUTBOUND_TYPES.find(t => t.value === type);
  return found ? found.icon : '?';
}

// Load on mount
onMounted(async () => {
  isLoading.value = true;
  try {
    await dataStore.fetchData();
  } catch (e) {
    console.error('[OutboundSettings]', e);
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <div class="outbound-settings">
    <div class="page-header">
      <div>
        <h2>出站设置</h2>
        <p class="text-muted">管理自定义出站配置，实现 3x-ui 风格的出站路由</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新增出站
      </button>
    </div>

    <!-- Outbound List -->
    <div v-if="outbounds.length === 0" class="empty-state">
      <div class="empty-icon">📡</div>
      <h3>暂无出站配置</h3>
      <p>创建自定义出站来实现路由规则的目标，例如负载均衡、链式代理等</p>
    </div>

    <div v-else class="outbound-grid">
      <div v-for="ob in outbounds" :key="ob.id" class="outbound-card" :class="{ disabled: !ob.enabled }">
        <div class="card-header">
          <div class="card-type-badge">{{ getTypeIcon(ob.type) }} {{ getTypeLabel(ob.type) }}</div>
          <label class="toggle">
            <input type="checkbox" :checked="ob.enabled" @change="toggleOutbound(ob)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="card-body">
          <h4>{{ ob.name }}</h4>
          <p v-if="ob.description" class="card-desc">{{ ob.description }}</p>
          <div class="card-details">
            <span v-if="ob.type === 'load_balance' && ob.targets?.length">
              🎯 目标: {{ ob.targets.join(', ') }}
            </span>
            <span v-if="ob.type === 'load_balance' && ob.strategy">
              ⚖️ 策略: {{ ob.strategy }}
            </span>
            <span v-if="ob.type === 'proxy' && ob.proxyNode">
              🔗 节点: {{ ob.proxyNode }}
            </span>
            <span v-if="ob.type === 'chain' && ob.chainId">
              ⛓️ 链: {{ ob.chainId }}
            </span>
          </div>
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
            <input v-model="form.name" class="form-input" placeholder="出站名称" />
          </div>
          <div class="form-group">
            <label>类型</label>
            <select v-model="form.type" class="form-input">
              <option v-for="t in OUTBOUND_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>描述</label>
            <input v-model="form.description" class="form-input" placeholder="可选描述" />
          </div>

          <!-- Type-specific fields -->
          <template v-if="form.type === 'proxy'">
            <div class="form-group">
              <label>目标代理节点</label>
              <select v-model="form.proxyNode" class="form-input">
                <option value="">选择节点...</option>
                <option v-for="node in availableProxyNodes" :key="node" :value="node">{{ node }}</option>
              </select>
            </div>
          </template>

          <template v-if="form.type === 'load_balance'">
            <div class="form-group">
              <label>目标节点列表 (至少2个)</label>
              <div class="input-group">
                <input v-model="newTarget" class="form-input" placeholder="输入节点名称" @keyup.enter="addTarget" />
                <button class="btn btn-sm" @click="addTarget">添加</button>
              </div>
              <div class="tag-list">
                <span v-for="(target, idx) in form.targets" :key="idx" class="tag">
                  {{ target }}
                  <button class="tag-remove" @click="removeTarget(idx)">&times;</button>
                </span>
              </div>
            </div>
            <div class="form-group">
              <label>负载均衡策略</label>
              <select v-model="form.strategy" class="form-input">
                <option v-for="s in LB_STRATEGIES" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
            <div class="form-group">
              <label>健康检查 URL</label>
              <input v-model="form.config.url" class="form-input" placeholder="http://www.gstatic.com/generate_204" />
            </div>
            <div class="form-group">
              <label>检查间隔 (秒)</label>
              <input v-model.number="form.config.interval" class="form-input" type="number" placeholder="300" />
            </div>
          </template>

          <template v-if="form.type === 'chain'">
            <div class="form-group">
              <label>引用链式代理</label>
              <select v-model="form.chainId" class="form-input">
                <option value="">选择链...</option>
                <option v-for="chain in availableChains" :key="chain.id" :value="chain.id">{{ chain.name }}</option>
              </select>
            </div>
          </template>

          <template v-if="form.type === 'wireguard'">
            <div class="form-group">
              <label>端点地址</label>
              <input v-model="form.wireguardConfig.server" class="form-input" placeholder="Endpoint IP" />
            </div>
            <div class="form-group">
              <label>端点端口</label>
              <input v-model.number="form.wireguardConfig.server_port" class="form-input" type="number" placeholder="51820" />
            </div>
            <div class="form-group">
              <label>本地私钥</label>
              <input v-model="form.wireguardConfig.private_key" class="form-input" placeholder="Private key" />
            </div>
            <div class="form-group">
              <label>对端公钥</label>
              <input v-model="form.wireguardConfig.peer_public_key" class="form-input" placeholder="Peer public key" />
            </div>
            <div class="form-group">
              <label>本地地址</label>
              <input v-model="form.wireguardConfig.local_address" class="form-input" placeholder="10.0.0.2/24" />
            </div>
          </template>

          <template v-if="form.type === 'custom'">
            <div class="form-group">
              <label>自定义 JSON 配置</label>
              <textarea v-model="form.customConfig" class="form-input textarea" rows="8" placeholder='{"type": "freedom", ...}'></textarea>
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
.outbound-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.outbound-card { background: var(--card-bg, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 16px; }
.outbound-card.disabled { opacity: 0.5; }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.card-type-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: var(--badge-bg, #334155); }
.card-body h4 { margin: 0 0 4px; font-size: 1rem; }
.card-desc { font-size: 0.8rem; color: var(--text-secondary, #94a3b8); margin: 0 0 8px; }
.card-details { font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px; }
.card-actions { display: flex; gap: 8px; margin-top: 12px; }
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--card-bg, #1e293b); border-radius: 16px; padding: 24px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h3 { margin: 0; }
.btn-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--input-bg, #0f172a); color: inherit; font-size: 0.875rem; box-sizing: border-box; }
.form-input.textarea { resize: vertical; min-height: 80px; font-family: monospace; }
.input-group { display: flex; gap: 8px; }
.input-group .form-input { flex: 1; }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: var(--tag-bg, #334155); border-radius: 4px; font-size: 0.8rem; }
.tag-remove { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--text-secondary); padding: 0; line-height: 1; }
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
