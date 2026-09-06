// Client logic for RepoRelay Dashboard & Media Manager

let allMediaItems = [];
let currentCategory = 'all';

// Category labels and badge colors (4 reaction pools: opened, approved, merged, needs_work)
const CATEGORY_MAP = {
  opened:     { label: 'Mở PR 🔀', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  approved:   { label: 'Được Duyệt 👍', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
  merged:     { label: 'Đã Merge 🚀', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
  needs_work: { label: 'Cần Sửa ⚠️', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  // Backward compatibility aliases
  positive:   { label: 'Đã Merge 🚀', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
  negative:   { label: 'Cần Sửa ⚠️', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
};

function normalizeCategoryName(cat) {
  if (!cat) return 'opened';
  const lower = cat.toLowerCase().trim();
  if (lower === 'merged' || lower === 'positive' || lower === 'ci_success' || lower === 'deploy_success') return 'merged';
  if (lower === 'approved') return 'approved';
  if (lower === 'needs_work' || lower === 'negative' || lower === 'ci_failure' || lower === 'deploy_failure' || lower === 'security') return 'needs_work';
  return 'opened';
}

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  fetchStatus();
  fetchMedia();
  loadRecentEvents();

  // Polling every 15 seconds for status updates
  setInterval(fetchStatus, 15000);
});

// Tab navigation
function setupNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      switchTab(tabId);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const activeBtn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  const activeContent = document.getElementById(tabId);

  if (activeBtn) activeBtn.classList.add('active');
  if (activeContent) activeContent.classList.add('active');

  if (tabId === 'tab-media') {
    renderMediaGrid();
  }
}

// Fetch Bot and System Status
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    // Navigation Pill
    const navName = document.getElementById('nav-bot-name');
    const navAvatar = document.getElementById('nav-bot-avatar');

    if (data.bot) {
      if (navName) navName.textContent = data.bot.tag;
      if (data.bot.avatar && navAvatar) {
        navAvatar.src = data.bot.avatar;
        navAvatar.style.display = 'inline-block';
      }
    }

    // Dashboard Metrics
    const statusElem = document.getElementById('metric-bot-status');
    const tagElem = document.getElementById('metric-bot-tag');
    if (statusElem) {
      if (data.bot?.status === 'online') {
        statusElem.textContent = 'Online';
        statusElem.className = 'metric-value text-emerald';
        if (tagElem) tagElem.textContent = 'Discord Gateway 24/7';
      } else {
        statusElem.textContent = 'Connecting...';
        statusElem.className = 'metric-value text-amber';
        if (tagElem) tagElem.textContent = 'Đang kết nối...';
      }
    }

    if (data.system) {
      // System Tab
      const sysNode = document.getElementById('sys-node-version');
      if (sysNode) sysNode.textContent = data.system.nodeVersion;
    }

    if (data.config) {
      const webhookPath = data.config.webhookPath || '/webhook';
      const webhookUrl = `${window.location.origin}${webhookPath}`;
      const elUrl = document.getElementById('sys-webhook-url');
      if (elUrl) elUrl.textContent = webhookUrl;

      const elSec = document.getElementById('sys-secret-status');
      if (elSec) {
        elSec.innerHTML = data.config.hasSecret
          ? '<span class="text-emerald">✅ Đã kích hoạt (HMAC-SHA256)</span>'
          : '<span class="text-amber">⚠️ Chưa đặt secret (Bảo mật cơ bản)</span>';
      }

      const elPr = document.getElementById('sys-channel-prs');
      if (elPr) elPr.textContent = data.config.channels?.prs || 'Chưa cấu hình';

      const elIssue = document.getElementById('sys-channel-issues');
      if (elIssue) elIssue.textContent = data.config.channels?.issues || 'Dùng chung kênh PRs';
    }
  } catch (err) {
    console.error('Lỗi tải trạng thái bot:', err);
  }
}

// Fetch Media Items from Database
async function fetchMedia() {
  try {
    const res = await fetch('/api/media');
    if (!res.ok) return;
    const data = await res.json();
    allMediaItems = data.items || [];

    // Calculate 4 categories counts
    const totalCount = allMediaItems.length;
    let openedCount = 0;
    let approvedCount = 0;
    let mergedCount = 0;
    let needsWorkCount = 0;

    allMediaItems.forEach(item => {
      const cat = normalizeCategoryName(item.category);
      if (cat === 'opened') openedCount++;
      else if (cat === 'approved') approvedCount++;
      else if (cat === 'merged') mergedCount++;
      else if (cat === 'needs_work') needsWorkCount++;
    });

    // Update Dashboard & Tab Counts
    const elNav = document.getElementById('nav-media-count');
    if (elNav) elNav.textContent = totalCount;

    const elTotal = document.getElementById('metric-gif-total');
    if (elTotal) elTotal.textContent = totalCount;

    const elOpened = document.getElementById('metric-gif-opened');
    if (elOpened) elOpened.textContent = openedCount;

    const elApproved = document.getElementById('metric-gif-approved');
    if (elApproved) elApproved.textContent = approvedCount;

    const elMerged = document.getElementById('metric-gif-merged');
    if (elMerged) elMerged.textContent = mergedCount;

    const elNeedsWork = document.getElementById('metric-gif-needs-work');
    if (elNeedsWork) elNeedsWork.textContent = needsWorkCount;

    // Filter Pills Counts
    const elCountAll = document.getElementById('count-all');
    if (elCountAll) elCountAll.textContent = totalCount;

    const elCountOpened = document.getElementById('count-opened');
    if (elCountOpened) elCountOpened.textContent = openedCount;

    const elCountApproved = document.getElementById('count-approved');
    if (elCountApproved) elCountApproved.textContent = approvedCount;

    const elCountMerged = document.getElementById('count-merged');
    if (elCountMerged) elCountMerged.textContent = mergedCount;

    const elCountNeedsWork = document.getElementById('count-needs-work');
    if (elCountNeedsWork) elCountNeedsWork.textContent = needsWorkCount;

    renderMediaGrid();
  } catch (err) {
    console.error('Lỗi tải danh sách media:', err);
  }
}

// Filter Media by Category
function filterCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-category') === cat);
  });
  renderMediaGrid();
}

// Render Media Cards
function renderMediaGrid() {
  const container = document.getElementById('media-cards-container');
  if (!container) return;

  const filtered = currentCategory === 'all'
    ? allMediaItems
    : allMediaItems.filter(item => normalizeCategoryName(item.category) === currentCategory);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="loading-spinner">
        <p style="font-size: 18px; margin-bottom: 8px;">📂 Không có ảnh nào trong danh mục này</p>
        <button class="btn btn-primary btn-sm" onclick="openAddMediaModal('${currentCategory !== 'all' ? currentCategory : 'opened'}')">
          ➕ Thêm GIF đầu tiên
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const normCat = normalizeCategoryName(item.category);
    const catInfo = CATEGORY_MAP[normCat] || { label: normCat, color: '#fff', bg: 'rgba(255,255,255,0.1)' };
    const title = item.title || 'GIF Phản ứng';
    return `
      <div class="media-card">
        <div class="media-img-wrapper">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(title)}" class="media-img" loading="lazy">
        </div>
        <div class="media-body">
          <span class="media-category-badge" style="color: ${catInfo.color}; background: ${catInfo.bg};">
            ${catInfo.label}
          </span>
          <div class="media-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="media-actions">
            <button class="btn-icon" onclick="copyToClipboard('${escapeHtml(item.url)}')" title="Copy URL">
              📋 Copy Link
            </button>
            <button class="btn-icon btn-icon-danger" onclick="deleteMedia(${item.id})" title="Xóa khỏi kho">
              🗑️ Xóa
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Modal Handlers
function openAddMediaModal(defaultCategory) {
  const modal = document.getElementById('add-media-modal');
  const catSelect = document.getElementById('media-category');
  if (defaultCategory && defaultCategory !== 'all') {
    catSelect.value = normalizeCategoryName(defaultCategory);
  } else {
    catSelect.value = 'opened';
  }
  document.getElementById('media-url').value = '';
  document.getElementById('media-title').value = '';
  document.getElementById('modal-preview-img').style.display = 'none';
  document.querySelector('.preview-placeholder').style.display = 'block';
  modal.style.display = 'flex';
}

function closeAddMediaModal() {
  document.getElementById('add-media-modal').style.display = 'none';
}

// Live Preview in Modal
function updateLivePreview(url) {
  const img = document.getElementById('modal-preview-img');
  const placeholder = document.querySelector('.preview-placeholder');

  if (url && url.trim().startsWith('http')) {
    img.src = url.trim();
    img.onload = () => {
      img.style.display = 'block';
      placeholder.style.display = 'none';
    };
    img.onerror = () => {
      img.style.display = 'none';
      placeholder.style.display = 'block';
      placeholder.textContent = '❌ Không tải được ảnh từ link này. Vui lòng kiểm tra lại URL.';
    };
  } else {
    img.style.display = 'none';
    placeholder.style.display = 'block';
    placeholder.textContent = 'Dán URL ảnh ở trên để xem trước tại đây';
  }
}

function handlePreviewError() {
  const img = document.getElementById('modal-preview-img');
  const placeholder = document.querySelector('.preview-placeholder');
  img.style.display = 'none';
  placeholder.style.display = 'block';
  placeholder.textContent = '❌ Không tải được ảnh. Vui lòng kiểm tra lại link.';
}

// Save New Media Item
async function handleSaveMedia(event) {
  event.preventDefault();
  const category = document.getElementById('media-category').value;
  const url = document.getElementById('media-url').value.trim();
  const title = document.getElementById('media-title').value.trim();

  if (!url) return;

  const btn = document.getElementById('btn-save-media');
  btn.disabled = true;
  btn.textContent = 'Đang lưu...';

  try {
    const res = await fetch('/api/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, url, title: title || undefined }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ Đã thêm GIF mới vào kho thành công!');
      closeAddMediaModal();
      await fetchMedia();
    } else {
      showToast(`❌ Lỗi: ${data.error || 'Không thể lưu'}`);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu Vào Kho';
  }
}

// Delete Media Item
async function deleteMedia(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa ảnh này khỏi kho không?')) return;

  try {
    const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🗑️ Đã xóa ảnh khỏi kho');
      await fetchMedia();
    } else {
      showToast('❌ Không thể xóa ảnh');
    }
  } catch (err) {
    showToast(`❌ Lỗi: ${err.message}`);
  }
}

// Trigger Simulator Test Event
async function triggerTestEvent(scenario) {
  const prInput = document.getElementById('sim-pr-number');
  const prNumber = prInput ? parseInt(prInput.value, 10) : 101;

  const feedbacks = [
    document.getElementById('sim-feedback'),
    document.getElementById('sim-feedback-tab')
  ].filter(Boolean);

  feedbacks.forEach(fb => {
    fb.style.display = 'block';
    fb.className = 'feedback-box';
    fb.innerHTML = `⏳ Đang gửi sự kiện test <strong>${scenario.toUpperCase()}</strong> (PR #${prNumber}) tới Discord...`;
  });

  try {
    const res = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, prNumber }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      feedbacks.forEach(fb => {
        fb.className = 'feedback-box';
        fb.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        fb.style.background = 'rgba(16, 185, 129, 0.15)';
        fb.style.color = '#10b981';
        fb.innerHTML = `✅ Đã bắn sự kiện <strong>${scenario.toUpperCase()}</strong> cho <strong>PR #${data.prNumber || prNumber}</strong> thành công! Hãy kiểm tra Discord channel.`;
      });
      showToast(`🚀 Bắn sự kiện ${scenario.toUpperCase()} (PR #${prNumber}) thành công!`);
      loadRecentEvents();
    } else {
      feedbacks.forEach(fb => {
        fb.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        fb.style.background = 'rgba(239, 68, 68, 0.15)';
        fb.style.color = '#f87171';
        fb.innerHTML = `❌ Lỗi: ${data.error || 'Thất bại'}`;
      });
    }
  } catch (err) {
    feedbacks.forEach(fb => {
      fb.innerHTML = `❌ Lỗi mạng: ${err.message}`;
    });
  }
}

// Increment Simulator Target PR Number
function incrementSimPr() {
  const prInput = document.getElementById('sim-pr-number');
  if (prInput) {
    const current = parseInt(prInput.value, 10) || 101;
    const nextVal = current + 1;
    prInput.value = nextVal;
    showToast(`🎯 Đã đổi mục tiêu sang PR #${nextVal}`);
  }
}

// Load Recent Webhook Events from SQLite
async function loadRecentEvents() {
  const tbody = document.getElementById('events-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/events');
    if (!res.ok) return;
    const data = await res.json();
    const events = data.events || [];

    if (events.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 24px;">Chưa có sự kiện webhook nào được ghi nhận.</td></tr>`;
      return;
    }

    tbody.innerHTML = events.slice(0, 10).map(e => {
      const date = new Date(e.createdAt);
      const formattedDate = date.toLocaleString('vi-VN');
      return `
        <tr>
          <td><code>#${e.id}</code></td>
          <td><span class="badge-event">${escapeHtml(e.eventType)}</span></td>
          <td><strong>${e.entityNumber ? `#${e.entityNumber}` : '—'}</strong></td>
          <td><code>${escapeHtml(e.repo)}</code></td>
          <td style="color: var(--text-dim);">${formattedDate}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Lỗi tải sự kiện:', err);
  }
}

// Toast notification
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Copy to clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Đã copy link vào clipboard!');
  }).catch(() => {
    showToast('❌ Không thể copy link');
  });
}

// Utility HTML escape
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}
