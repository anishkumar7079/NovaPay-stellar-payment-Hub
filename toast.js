/**
 * toast.js — Notification system for NovaPay
 * Supports success, error, info, warning with auto-dismiss
 */

const ICONS = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
};

const DURATIONS = {
  success: 5000,
  error:   7000,
  info:    4500,
  warning: 6000,
};

/**
 * Show a toast notification
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} title
 * @param {string} [message]
 * @param {number} [duration] — override auto-dismiss duration (ms)
 */
export function toast(type, title, message = '', duration) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'assertive');

  el.innerHTML = `
    <div class="toast-icon">${ICONS[type] || 'ℹ'}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${message}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Close notification">×</button>
  `;

  container.appendChild(el);

  const remove = () => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Fallback remove
    setTimeout(() => el.remove(), 500);
  };

  // Close button
  el.querySelector('.toast-close').addEventListener('click', remove);

  // Auto-dismiss
  const ms = duration ?? DURATIONS[type] ?? 5000;
  const timer = setTimeout(remove, ms);

  // Cancel auto-dismiss on hover
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => setTimeout(remove, 2000));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Convenience Wrappers ─────────────────────────────────────
export const toastSuccess = (title, msg, d) => toast('success', title, msg, d);
export const toastError   = (title, msg, d) => toast('error',   title, msg, d);
export const toastInfo    = (title, msg, d) => toast('info',    title, msg, d);
export const toastWarning = (title, msg, d) => toast('warning', title, msg, d);
