/**
 * 全局邮箱管理页面
 * @module mailboxes
 */

import { getCurrentUserKey } from './storage.js';
import { openForwardDialog, toggleFavorite, batchSetFavorite, injectDialogStyles } from './mailbox-settings.js';
import { api, loadMailboxes as fetchMailboxes, loadDomains as fetchDomains, deleteMailbox as apiDeleteMailbox, toggleLogin as apiToggleLogin, batchToggleLogin, resetPassword as apiResetPassword, changePassword as apiChangePassword } from './modules/mailboxes/api.js';
import { formatTime, escapeHtml, generateSkeleton, renderGrid, renderList } from './modules/mailboxes/render.js';

injectDialogStyles();

// showToast 由 toast-utils.js 全局提供
const showToast = window.showToast || ((msg, type) => console.log(`[${type}] ${msg}`));

// DOM 元素
const els = {
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  loadingPlaceholder: document.getElementById('loading-placeholder'),
  q: document.getElementById('q'),
  search: document.getElementById('search'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  page: document.getElementById('page'),
  logout: document.getElementById('logout'),
  viewGrid: document.getElementById('view-grid'),
  viewList: document.getElementById('view-list'),
  domainFilter: document.getElementById('domain-filter'),
  loginFilter: document.getElementById('login-filter'),
  favoriteFilter: document.getElementById('favorite-filter'),
  forwardFilter: document.getElementById('forward-filter'),
  // 批量操作按钮
  batchAllow: document.getElementById('batch-allow'),
  batchDeny: document.getElementById('batch-deny'),
  batchFavorite: document.getElementById('batch-favorite'),
  batchUnfavorite: document.getElementById('batch-unfavorite'),
  batchForward: document.getElementById('batch-forward'),
  batchClearForward: document.getElementById('batch-clear-forward'),
  // 批量操作模态框
  batchModal: document.getElementById('batch-login-modal'),
  batchModalClose: document.getElementById('batch-modal-close'),
  batchModalTitle: document.getElementById('batch-modal-title'),
  batchModalMessage: document.getElementById('batch-modal-message'),
  batchEmailsInput: document.getElementById('batch-emails-input'),
  batchForwardWrapper: document.getElementById('batch-forward-input-wrapper'),
  batchForwardTarget: document.getElementById('batch-forward-target'),
  batchModalCancel: document.getElementById('batch-modal-cancel'),
  batchModalConfirm: document.getElementById('batch-modal-confirm'),
  // 重置密码模态框
  resetModal: document.getElementById('reset-modal'),
  resetClose: document.getElementById('reset-close'),
  resetEmail: document.getElementById('reset-email'),
  resetCancel: document.getElementById('reset-cancel'),
  resetConfirm: document.getElementById('reset-confirm'),
  // 登录权限确认模态框
  loginConfirmModal: document.getElementById('login-confirm-modal'),
  loginConfirmClose: document.getElementById('login-confirm-close'),
  loginConfirmTitle: document.getElementById('login-confirm-title'),
  loginConfirmMessage: document.getElementById('login-confirm-message'),
  loginConfirmEmail: document.getElementById('login-confirm-email'),
  loginConfirmCancel: document.getElementById('login-confirm-cancel'),
  loginConfirmOk: document.getElementById('login-confirm-ok'),
  // 修改密码模态框
  changePasswordModal: document.getElementById('change-password-modal'),
  changePasswordClose: document.getElementById('change-password-close'),
  changePasswordEmail: document.getElementById('change-password-email'),
  changePasswordCancel: document.getElementById('change-password-cancel'),
  changePasswordSubmit: document.getElementById('change-password-submit'),
  newPassword: document.getElementById('new-password'),
  confirmPassword: document.getElementById('confirm-password')
};

// 状态
let page = 1, PAGE_SIZE = 20, lastCount = 0, currentData = [];
let currentView = localStorage.getItem('mf:mailboxes:view') || 'grid';
let searchTimeout = null, isLoading = false;
let availableDomains = [];

// 加载邮箱列表
async function load() {
  if (isLoading) return;
  isLoading = true;

  // 显示骨架屏
  if (els.grid) els.grid.innerHTML = generateSkeleton(currentView, 8);
  if (els.empty) els.empty.style.display = 'none';

  try {
    const params = { page, size: PAGE_SIZE };
    if (els.q?.value) params.q = els.q.value.trim();
    if (els.domainFilter?.value) params.domain = els.domainFilter.value;
    if (els.loginFilter?.value) params.login = els.loginFilter.value;
    if (els.favoriteFilter?.value) params.favorite = els.favoriteFilter.value;
    if (els.forwardFilter?.value) params.forward = els.forwardFilter.value;

    const data = await fetchMailboxes(params);
    const list = Array.isArray(data) ? data : (data.list || []);
    const total = data.total ?? list.length;
    lastCount = total;
    currentData = list;

    if (!list.length) {
      els.grid.innerHTML = '';
      if (els.empty) els.empty.style.display = 'block';
    } else {
      els.grid.innerHTML = currentView === 'grid' ? renderGrid(list) : renderList(list);
      if (els.empty) els.empty.style.display = 'none';
    }

    updatePager();
    bindCardEvents();
  } catch (e) {
    console.error('加载失败:', e);
    showToast('加载失败', 'error');
  } finally {
    isLoading = false;
  }
}

// 更新分页器
function updatePager() {
  const totalPages = Math.max(1, Math.ceil(lastCount / PAGE_SIZE));
  if (els.page) els.page.textContent = `第 ${page} / ${totalPages} 页 (共 ${lastCount} 个)`;
  if (els.prev) els.prev.disabled = page <= 1;
  if (els.next) els.next.disabled = page >= totalPages;
}

// 绑定卡片事件
function bindCardEvents() {
  // 绑定卡片点击跳转（网格视图）
  els.grid?.querySelectorAll('.mailbox-card[data-action="jump"]').forEach(card => {
    card.onclick = (e) => {
      // 如果点击的是按钮区域，不跳转
      if (e.target.closest('.actions')) return;
      const address = card.dataset.address;
      if (address) {
        showToast('跳转中...', 'info', 500);
        setTimeout(() => location.href = `/?mailbox=${encodeURIComponent(address)}`, 600);
      }
    };
  });

  // 绑定按钮操作
  els.grid?.querySelectorAll('[data-action]').forEach(btn => {
    // 跳过卡片本身（只处理按钮）
    if (btn.classList.contains('mailbox-card') || btn.classList.contains('mailbox-list-item')) return;

    btn.onclick = async (e) => {
      e.stopPropagation();
      const card = btn.closest('[data-address]');
      const address = card?.dataset.address;
      const id = card?.dataset.id;
      const action = btn.dataset.action;

      if (!address) return;

      switch (action) {
        case 'copy':
          try { await navigator.clipboard.writeText(address); showToast('已复制', 'success'); }
          catch(_) { showToast('复制失败', 'error'); }
          break;
        case 'jump':
          showToast('跳转中...', 'info', 500);
          setTimeout(() => location.href = `/?mailbox=${encodeURIComponent(address)}`, 600);
          break;
        case 'pin':
          try {
            const pinRes = await api(`/api/mailboxes/pin?address=${encodeURIComponent(address)}`, {
              method: 'POST'
            });
            if (pinRes.ok) {
              showToast('置顶状态已更新', 'success');
              load();
            } else {
              showToast('操作失败', 'error');
            }
          } catch(e) { showToast('操作失败', 'error'); }
          break;
        case 'forward':
          const m = currentData.find(x => x.address === address);
          if (m && m.id) openForwardDialog(m.id, m.address, m.forward_to);
          break;
        case 'favorite':
          const mb = currentData.find(x => x.address === address);
          if (mb && mb.id) {
            const result = await toggleFavorite(mb.id);
            if (result.success) load();
          }
          break;
        case 'login':
          const mailbox = currentData.find(x => x.address === address);
          if (mailbox) {
            try {
              await apiToggleLogin(address, !mailbox.can_login);
              showToast(mailbox.can_login ? '已禁止登录' : '已允许登录', 'success');
              load();
            } catch(e) { showToast('操作失败', 'error'); }
          }
          break;
        case 'password':
          const pwMailbox = currentData.find(x => x.address === address);
          if (pwMailbox) {
            openChangePasswordModal(address, pwMailbox.password_is_default);
          }
          break;
        case 'delete':
          if (!confirm(`确定删除邮箱 ${address}？`)) return;
          try {
            await apiDeleteMailbox(address);
            showToast('已删除', 'success');
            load();
          } catch(e) { showToast('删除失败', 'error'); }
          break;
      }
    };
  });
}

// 视图切换
function switchView(view) {
  if (currentView === view) return;
  currentView = view;
  localStorage.setItem('mf:mailboxes:view', view);
  els.viewGrid?.classList.toggle('active', view === 'grid');
  els.viewList?.classList.toggle('active', view === 'list');
  els.grid.className = view;
  if (currentData.length) {
    els.grid.innerHTML = view === 'grid' ? renderGrid(currentData) : renderList(currentData);
    bindCardEvents();
  }
}

// 加载域名筛选
async function loadDomainsFilter() {
  try {
    const domains = await fetchDomains();
    if (Array.isArray(domains) && domains.length) {
      availableDomains = domains.sort();
      if (els.domainFilter) {
        els.domainFilter.innerHTML = '<option value="">全部域名</option>' + domains.map(d => `<option value="${d}">@${d}</option>`).join('');
      }
    }
  } catch(_) {}
}

// 批量操作状态
let currentBatchAction = null;

// 打开批量操作模态框
function openBatchModal(action, title, message) {
  currentBatchAction = action;
  if (els.batchModalTitle) els.batchModalTitle.textContent = title;
  if (els.batchModalMessage) els.batchModalMessage.textContent = message;
  if (els.batchEmailsInput) els.batchEmailsInput.value = '';
  if (els.batchForwardWrapper) els.batchForwardWrapper.style.display = action === 'forward' ? 'block' : 'none';
  if (els.batchForwardTarget) els.batchForwardTarget.value = '';
  if (els.batchModalConfirm) els.batchModalConfirm.disabled = true;

  if (els.batchModal) els.batchModal.classList.add('show');
}

// 关闭批量操作模态框
function closeBatchModal() {
  if (els.batchModal) els.batchModal.classList.remove('show');
  currentBatchAction = null;
}

// 解析邮箱列表
function parseEmails(text) {
  if (!text) return [];
  return text.split(/[\n,;，；\s]+/).map(e => e.trim().toLowerCase()).filter(e => e && e.includes('@'));
}

// 更新邮箱计数
function updateBatchCount() {
  const emails = parseEmails(els.batchEmailsInput?.value || '');
  if (els.batchModalConfirm) {
    const forwardValid = currentBatchAction !== 'forward' || (els.batchForwardTarget?.value?.includes('@'));
    els.batchModalConfirm.disabled = emails.length === 0 || !forwardValid;
  }
}

// 执行批量操作
async function executeBatchAction() {
  const emails = parseEmails(els.batchEmailsInput?.value || '');
  if (!emails.length) return;

  if (els.batchModalConfirm) els.batchModalConfirm.disabled = true;

  try {
    let result;
    switch (currentBatchAction) {
      case 'allow':
        result = await batchToggleLogin(emails, true);
        break;
      case 'deny':
        result = await batchToggleLogin(emails, false);
        break;
      case 'favorite':
        result = await api('/api/mailboxes/batch-favorite-by-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: emails, is_favorite: true })
        });
        break;
      case 'unfavorite':
        result = await api('/api/mailboxes/batch-favorite-by-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: emails, is_favorite: false })
        });
        break;
      case 'forward':
        const forwardTo = els.batchForwardTarget?.value?.trim();
        if (!forwardTo) { showToast('请输入转发目标', 'error'); return; }
        result = await api('/api/mailboxes/batch-forward-by-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: emails, forward_to: forwardTo })
        });
        break;
      case 'clear-forward':
        result = await api('/api/mailboxes/batch-forward-by-address', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: emails, forward_to: null })
        });
        break;
    }
    showToast('批量操作完成', 'success');
    closeBatchModal();
    load();
  } catch (e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  } finally {
    if (els.batchModalConfirm) els.batchModalConfirm.disabled = false;
  }
}

// 修改密码模态框状态
let currentChangePasswordAddress = null;

// 打开修改密码模态框
function openChangePasswordModal(address, isDefault) {
  currentChangePasswordAddress = address;
  if (els.changePasswordEmail) els.changePasswordEmail.textContent = address;
  if (els.newPassword) els.newPassword.value = '';
  if (els.confirmPassword) els.confirmPassword.value = '';
  if (els.changePasswordModal) els.changePasswordModal.classList.add('show');
}

// 关闭修改密码模态框
function closeChangePasswordModal() {
  if (els.changePasswordModal) els.changePasswordModal.classList.remove('show');
  currentChangePasswordAddress = null;
}

// 执行修改密码
async function executeChangePassword() {
  if (!currentChangePasswordAddress) return;

  const newPwd = els.newPassword?.value?.trim();
  const confirmPwd = els.confirmPassword?.value?.trim();

  if (!newPwd) {
    showToast('请输入新密码', 'error');
    return;
  }
  if (newPwd.length < 6) {
    showToast('密码至少6位', 'error');
    return;
  }
  if (newPwd !== confirmPwd) {
    showToast('两次密码不一致', 'error');
    return;
  }

  try {
    const res = await apiChangePassword(currentChangePasswordAddress, newPwd);
    if (res.ok) {
      showToast('密码已修改', 'success');
      closeChangePasswordModal();
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || '修改失败', 'error');
    }
  } catch (e) {
    showToast('修改失败: ' + (e.message || '未知错误'), 'error');
  }
}

// 重置密码状态
let currentResetPasswordAddress = null;

// 打开重置密码模态框
function openResetPasswordModal(address) {
  currentResetPasswordAddress = address;
  if (els.resetEmail) els.resetEmail.textContent = address;
  if (els.resetModal) els.resetModal.classList.add('show');
}

// 关闭重置密码模态框
function closeResetPasswordModal() {
  if (els.resetModal) els.resetModal.classList.remove('show');
  currentResetPasswordAddress = null;
}

// 执行重置密码
async function executeResetPassword() {
  if (!currentResetPasswordAddress) return;

  try {
    const res = await apiResetPassword(currentResetPasswordAddress);
    if (res.ok) {
      showToast('密码已重置', 'success');
      closeResetPasswordModal();
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || '重置失败', 'error');
    }
  } catch (e) {
    showToast('重置失败: ' + (e.message || '未知错误'), 'error');
  }
}

// 登录权限确认状态
let currentLoginConfirmAddress = null;
let currentLoginConfirmAction = null;

// 打开登录权限确认模态框
function openLoginConfirmModal(address, allow, callback) {
  currentLoginConfirmAddress = address;
  currentLoginConfirmAction = callback;
  if (els.loginConfirmEmail) els.loginConfirmEmail.textContent = address;
  if (els.loginConfirmTitle) els.loginConfirmTitle.textContent = allow ? '确认放行登录' : '确认禁止登录';
  if (els.loginConfirmMessage) els.loginConfirmMessage.textContent = allow
    ? `确定允许该邮箱登录？`
    : `确定禁止该邮箱登录？`;
  if (els.loginConfirmModal) els.loginConfirmModal.classList.add('show');
}

// 关闭登录权限确认模态框
function closeLoginConfirmModal() {
  if (els.loginConfirmModal) els.loginConfirmModal.classList.remove('show');
  currentLoginConfirmAddress = null;
  currentLoginConfirmAction = null;
}

// 事件绑定
els.search?.addEventListener('click', () => { page = 1; load(); });
els.q?.addEventListener('input', () => { if (searchTimeout) clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { page = 1; load(); }, 300); });
els.q?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); page = 1; load(); }});
els.prev?.addEventListener('click', () => { if (page > 1 && !isLoading) { page--; load(); }});
els.next?.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(lastCount / PAGE_SIZE));
  if (page < totalPages && !isLoading) { page++; load(); }
});
els.domainFilter?.addEventListener('change', () => { page = 1; load(); });
els.loginFilter?.addEventListener('change', () => { page = 1; load(); });
els.favoriteFilter?.addEventListener('change', () => { page = 1; load(); });
els.forwardFilter?.addEventListener('change', () => { page = 1; load(); });
els.viewGrid?.addEventListener('click', () => switchView('grid'));
els.viewList?.addEventListener('click', () => switchView('list'));
els.logout?.addEventListener('click', async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch(_) {} location.replace('/html/login.html'); });

// 批量操作按钮
els.batchAllow?.addEventListener('click', () => openBatchModal('allow', '批量放行登录', '输入要允许登录的邮箱地址（每行一个或用逗号分隔）：'));
els.batchDeny?.addEventListener('click', () => openBatchModal('deny', '批量禁止登录', '输入要禁止登录的邮箱地址（每行一个或用逗号分隔）：'));
els.batchFavorite?.addEventListener('click', () => openBatchModal('favorite', '批量收藏', '输入要收藏的邮箱地址（每行一个或用逗号分隔）：'));
els.batchUnfavorite?.addEventListener('click', () => openBatchModal('unfavorite', '批量取消收藏', '输入要取消收藏的邮箱地址（每行一个或用逗号分隔）：'));
els.batchForward?.addEventListener('click', () => openBatchModal('forward', '批量设置转发', '输入要设置转发的邮箱地址（每行一个或用逗号分隔）：'));
els.batchClearForward?.addEventListener('click', () => openBatchModal('clear-forward', '批量清除转发', '输入要清除转发的邮箱地址（每行一个或用逗号分隔）：'));

// 批量操作模态框事件
els.batchModalClose?.addEventListener('click', closeBatchModal);
els.batchModalCancel?.addEventListener('click', closeBatchModal);
els.batchEmailsInput?.addEventListener('input', updateBatchCount);
els.batchForwardTarget?.addEventListener('input', updateBatchCount);
els.batchModalConfirm?.addEventListener('click', executeBatchAction);
els.batchModal?.addEventListener('click', (e) => { if (e.target === els.batchModal) closeBatchModal(); });

// 修改密码模态框事件
els.changePasswordClose?.addEventListener('click', closeChangePasswordModal);
els.changePasswordCancel?.addEventListener('click', closeChangePasswordModal);
els.changePasswordSubmit?.addEventListener('click', executeChangePassword);
els.changePasswordModal?.addEventListener('click', (e) => { if (e.target === els.changePasswordModal) closeChangePasswordModal(); });
els.newPassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeChangePassword();
  }
});
els.confirmPassword?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeChangePassword();
  }
});

// 重置密码模态框事件
els.resetClose?.addEventListener('click', closeResetPasswordModal);
els.resetCancel?.addEventListener('click', closeResetPasswordModal);
els.resetConfirm?.addEventListener('click', executeResetPassword);
els.resetModal?.addEventListener('click', (e) => { if (e.target === els.resetModal) closeResetPasswordModal(); });

// 登录权限确认模态框事件
els.loginConfirmClose?.addEventListener('click', closeLoginConfirmModal);
els.loginConfirmCancel?.addEventListener('click', closeLoginConfirmModal);
els.loginConfirmOk?.addEventListener('click', () => {
  if (currentLoginConfirmAction) {
    currentLoginConfirmAction();
    closeLoginConfirmModal();
  }
});
els.loginConfirmModal?.addEventListener('click', (e) => { if (e.target === els.loginConfirmModal) closeLoginConfirmModal(); });

// 初始化 guest 模式
async function initGuestMode() {
  if (typeof window.__GUEST_MODE__ === 'undefined') {
    window.__GUEST_MODE__ = false;
  }

  try {
    const sessionResp = await fetch('/api/session');
    if (sessionResp.ok) {
      const session = await sessionResp.json();
      if (session.role === 'guest' || session.username === 'guest') {
        window.__GUEST_MODE__ = true;
        const { MOCK_STATE, buildMockMailboxes } = await import('./modules/app/mock-api.js');
        if (!MOCK_STATE.mailboxes.length) {
          MOCK_STATE.mailboxes = buildMockMailboxes(6, 2, MOCK_STATE.domains);
        }
      }
    }
  } catch(e) {
    console.warn('Session check failed:', e);
  }
}

// 初始化
(async () => {
  await initGuestMode();

  // 设置初始视图模式
  els.viewGrid?.classList.toggle('active', currentView === 'grid');
  els.viewList?.classList.toggle('active', currentView === 'list');
  if (els.grid) els.grid.className = currentView;

  await loadDomainsFilter();
  await load();
})();
