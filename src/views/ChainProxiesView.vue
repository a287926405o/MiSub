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

const { chains } = storeToRefs(dataStore);
const isLoading = ref(false);
const showEditor = ref(false);
const editingChain = ref(null);
const isSaving = ref(false);

const form = ref({
  name: '',
  description: '',
  nodes: [],
  mode: 'relay',
  enabled: true
});

const showNodeSelector = ref(false);
const nodeSearch = ref('');

const availableNodes = computed(() => {
  const nodes = [];
  const subs = dataStore.subscriptions || [];
  subs.forEach(sub => {
    if (sub.nodes && Array.isArray(sub.nodes)) {
      // 常规订阅：节点列表
      sub.nodes.forEach(node => {
        if (typeof node === 'string') nodes.push(node);
        else if (node?.name) nodes.push(node.name);
      });
    } else if (sub.url && !/^https?:\/\//i.test(sub.url)) {
      // 手动节点：单条 vless:// / socks5:// 等协议链接
      if (sub.name) nodes.push(sub.name);
    }
  });
  return [...new Set(nodes)].sort();
});

const filteredNodes = computed(() => {
  if (!nodeSearch.value) return availableNodes.value;
  const q = nodeSearch.value.toLowerCase();
  return availableNodes.value.filter(n => n.toLowerCase().includes(q));
});

const enabledCount = computed(() => chains.value.filter(c => c.enabled).length);

async function loadChains() {
  isLoading.value = true;
  try {
    const res = await api.get('/api/chains');
    if (res.success && Array.isArray(res.data)) chains.value = res.data;
  } catch (e) {
    console.error('[ChainProxies]', e);
    showToast('Failed to load chains', 'error');
  } finally {
    isLoading.value = false;
  }
}

function openCreate() {
  editingChain.value = null;
  form.value = { name: '', description: '', nodes: [], mode: 'relay', enabled: true };
  showEditor.value = true;
}

function openEdit(chain) {
  editingChain.value = chain;
  form.value = {
    name: chain.name || '',
    description: chain.description || '',
    nodes: [...(chain.nodes || [])],
    mode: chain.mode || 'relay',
    enabled: chain.enabled !== false
  };
  showEditor.value = true;
}

async function saveChain() {
  if (!form.value.name.trim()) { showToast(t('chains.nameRequired'), 'warning'); return; }
  if (form.value.nodes.length < 2) { showToast(t('chains.nodesMinError'), 'warning'); return; }
  isSaving.value = true;
  try {
    if (editingChain.value) {
      const res = await api.put(`/api/chains/${editingChain.value.id}`, form.value);
      if (res.success) {
        const idx = chains.value.findIndex(c => c.id === editingChain.value.id);
        if (idx !== -1) chains.value[idx] = res.data;
        showToast(t('chains.chainSaved'), 'success');
      }
    } else {
      const res = await api.post('/api/chains', form.value);
      if (res.success) { chains.value.push(res.data); showToast(t('chains.chainSaved'), 'success'); }
    }
    showEditor.value = false;
    editorStore.markDirty();
  } catch (e) {
    showToast(e.message || 'Save failed', 'error');
  } finally {
    isSaving.value = false;
  }
}

async function deleteChain(chain) {
  if (!confirm(t('chains.deleteConfirmBody', { name: chain.name }))) return;
  try {
    const res = await api.delete(`/api/chains/${chain.id}`);
    if (res.success) {
      chains.value = chains.value.filter(c => c.id !== chain.id);
      showToast(t('chains.chainDeleted'), 'success');
      editorStore.markDirty();
    }
  } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
}

async function toggleChain(chain) {
  try {
    const res = await api.put(`/api/chains/${chain.id}`, { enabled: !chain.enabled });
    if (res.success) { Object.assign(chain, res.data); editorStore.markDirty(); }
  } catch (e) { showToast(e.message || 'Toggle failed', 'error'); }
}

function toggleNode(name) {
  const idx = form.value.nodes.indexOf(name);
  idx === -1 ? form.value.nodes.push(name) : form.value.nodes.splice(idx, 1);
}
function isNodeSelected(name) { return form.value.nodes.includes(name); }
function moveNode(idx, dir) {
  const ni = idx + dir;
  if (ni < 0 || ni >= form.value.nodes.length) return;
  [form.value.nodes[idx], form.value.nodes[ni]] = [form.value.nodes[ni], form.value.nodes[idx]];
}
function removeNode(idx) { form.value.nodes.splice(idx, 1); }

onMounted(async () => {
  if (!chains.value || chains.value.length === 0) await loadChains();
});
</script>

<template>
  <div class="pt-0 pb-6 min-h-[calc(100vh-80px)]">
    <div class="mb-4 bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('chains.title') }}</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('chains.subtitle') }}</p>
        </div>
        <button @click="openCreate"
          class="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium misub-radius-lg transition-colors shadow-sm">
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          {{ t('actions.add') }}
        </button>
      </div>
      <div class="flex gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
        <span>{{ chains.length }} chains</span>
        <span>{{ enabledCount }} enabled</span>
      </div>
    </div>

    <div v-if="isLoading" class="flex justify-center py-12">
      <svg class="animate-spin h-8 w-8 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <div v-else-if="chains.length === 0"
      class="flex flex-col items-center justify-center py-16 bg-white/50 dark:bg-gray-900/30 border border-dashed border-gray-200 dark:border-white/10 misub-radius-lg">
      <svg class="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <p class="text-gray-500 dark:text-gray-400 text-lg font-medium">{{ t('chains.empty') }}</p>
      <p class="text-gray-400 dark:text-gray-500 text-sm mt-1">{{ t('chains.emptyDesc') }}</p>
      <button @click="openCreate" class="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium misub-radius-lg">{{ t('actions.add') }}</button>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="chain in chains" :key="chain.id"
        class="relative bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5 hover:shadow-md transition-all">
        <div class="absolute top-3 right-3">
          <span @click="toggleChain(chain)" class="cursor-pointer inline-block w-2.5 h-2.5 rounded-full"
            :class="chain.enabled ? 'bg-green-500' : 'bg-gray-400'" />
        </div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white pr-8">{{ chain.name }}</h3>
        <span class="inline-block mt-1.5 px-2 py-0.5 text-xs font-medium rounded-full"
          :class="chain.mode === 'chain' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                  chain.mode === 'direct-chain' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'">
          {{ chain.mode === 'chain' ? 'Chain' : chain.mode === 'direct-chain' ? 'Direct Chain' : 'Relay' }}
        </span>
        <p v-if="chain.description" class="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-1">{{ chain.description }}</p>
        <div class="mt-3 flex flex-wrap items-center gap-1">
          <template v-for="(node, idx) in chain.nodes" :key="idx">
            <span class="inline-flex items-center px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded max-w-[120px] truncate">{{ node }}</span>
            <svg v-if="idx < chain.nodes.length - 1" class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </template>
        </div>
        <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">{{ chain.nodes.length }} nodes</p>
        <div class="mt-3 flex items-center gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
          <button @click="openEdit(chain)"
            class="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 misub-radius-lg">
            <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {{ t('actions.edit') }}
          </button>
          <button @click="deleteChain(chain)"
            class="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 misub-radius-lg">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Editor Modal -->
    <div v-if="showEditor" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" @click.self="showEditor = false">
      <div class="w-full max-w-2xl bg-white dark:bg-gray-900 misub-radius-xl shadow-2xl border border-gray-200 dark:border-white/10 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between p-5 border-b border-gray-100 dark:border-white/10">
          <h2 class="text-lg font-bold text-gray-900 dark:text-white">{{ editingChain ? t('chains.editTitle') : t('chains.addTitle') }}</h2>
          <button @click="showEditor = false" class="text-gray-400 hover:text-gray-600"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('chains.nameLabel') }}</label>
            <input v-model="form.name" type="text" class="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 text-sm" :placeholder="t('chains.namePlaceholder')" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('chains.modeLabel') }}</label>
            <select v-model="form.mode" class="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 text-sm">
              <option value="relay">{{ t('chains.modeRelay') }}</option>
              <option value="chain">{{ t('chains.modeChain') }}</option>
              <option value="direct-chain">{{ t('chains.modeDirectChain') }}</option>
            </select>
            <p class="mt-1 text-xs text-gray-400">{{ t('chains.compatibleNote') }}</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('chains.descriptionLabel') }}</label>
            <input v-model="form.description" type="text" class="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 text-sm" :placeholder="t('chains.descriptionPlaceholder')" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('chains.nodesLabel') }}</label>
            <p class="text-xs text-gray-400 mb-2">{{ t('chains.nodesHelp') }}</p>
            <div v-if="form.nodes.length > 0" class="space-y-1 mb-3">
              <div v-for="(node, idx) in form.nodes" :key="idx" class="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50">
                <span class="text-xs font-mono text-gray-400 w-5">{{ idx + 1 }}.</span>
                <span class="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">{{ node }}</span>
                <button @click="moveNode(idx, -1)" :disabled="idx === 0" class="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg></button>
                <button @click="moveNode(idx, 1)" :disabled="idx === form.nodes.length - 1" class="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg></button>
                <button @click="removeNode(idx)" class="p-1 text-red-400 hover:text-red-600"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            </div>
            <div v-else class="text-sm text-gray-400 mb-3 italic">{{ t('chains.emptyNodes') }}</div>
            <button @click="showNodeSelector = true" class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 misub-radius-lg">
              <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
              {{ t('chains.selectNode') }}
            </button>
          </div>
        </div>
        <div class="flex items-center justify-end gap-3 p-5 border-t border-gray-100 dark:border-white/10">
          <button @click="showEditor = false" class="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800">{{ t('actions.cancel') }}</button>
          <button @click="saveChain" :disabled="isSaving" class="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 misub-radius-lg shadow-sm">
            <span v-if="isSaving" class="flex items-center"><svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving</span>
            <span v-else>{{ t('actions.save') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Node Selector -->
    <div v-if="showNodeSelector" class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" @click.self="showNodeSelector = false">
      <div class="w-full max-w-lg bg-white dark:bg-gray-900 misub-radius-xl shadow-2xl border border-gray-200 dark:border-white/10 max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-gray-100 dark:border-white/10">
          <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('chains.selectNode') }}</h3>
          <button @click="showNodeSelector = false" class="text-gray-400 hover:text-gray-600"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div class="p-4 border-b border-gray-100 dark:border-white/10">
          <input v-model="nodeSearch" type="text" class="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500" placeholder="Search..." />
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <div v-if="filteredNodes.length === 0" class="text-center py-8 text-gray-400 text-sm">No matching nodes</div>
          <div v-for="node in filteredNodes" :key="node" @click="toggleNode(node)"
            class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg"
            :class="isNodeSelected(node) ? 'bg-primary-50 dark:bg-primary-900/20' : ''">
            <div class="w-4 h-4 rounded border-2 flex items-center justify-center"
              :class="isNodeSelected(node) ? 'bg-primary-600 border-primary-600' : 'border-gray-300 dark:border-gray-600'">
              <svg v-if="isNodeSelected(node)" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
            </div>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{ node }}</span>
          </div>
        </div>
        <div class="flex items-center justify-between p-4 border-t border-gray-100 dark:border-white/10">
          <span class="text-sm text-gray-500">{{ t('chains.selectedNodes', { count: form.nodes.length }) }}</span>
          <button @click="showNodeSelector = false" class="px-4 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 misub-radius-lg">{{ t('actions.confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
