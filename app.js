/**
 * app.js — NovaPay Core Application Logic
 *
 * Features:
 *  - Freighter wallet connect / disconnect
 *  - XLM balance fetch with animated counter
 *  - Send payment via Stellar SDK + Freighter signing
 *  - Transaction history from Horizon API
 *  - Friendbot faucet integration
 *  - Full error handling with toast feedback
 *
 * Network: Stellar TESTNET
 */

import { initParticles } from './particles.js';
import { initBalanceChart, updateBalanceChart, destroyBalanceChart } from './chart-helper.js';
import { toastSuccess, toastError, toastInfo, toastWarning } from './toast.js';

// ── Constants ──────────────────────────────────────────────────
const HORIZON_URL   = 'https://horizon-testnet.stellar.org';
const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet/tx/';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const XLM_USD_PRICE = 0.11; // Approximate — in a real app you'd fetch this live

// ── StellarSdk (loaded via CDN global) ────────────────────────
const { Horizon, Networks, TransactionBuilder, Operation, Asset, Memo, StrKey, BASE_FEE } = StellarSdk;
const server = new Horizon.Server(HORIZON_URL);

// ── App State ──────────────────────────────────────────────────
const state = {
  connected: false,
  publicKey: null,
  balance: null,
  txHistory: [],
};

// ── DOM References ─────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  heroSection:      $('heroSection'),
  dashboard:        $('dashboard'),
  connectBtn:       $('connectBtn'),
  heroConnectBtn:   $('heroConnectBtn'),
  disconnectBtn:    $('disconnectBtn'),
  faucetBtn:        $('faucetBtn'),
  walletAddress:    $('walletAddressDisplay'),
  balanceNumber:    $('balanceNumber'),
  balanceUsd:       $('balanceUsd'),
  lastUpdated:      $('lastUpdated'),
  refreshBalanceBtn:$('refreshBalanceBtn'),
  refreshHistoryBtn:$('refreshHistoryBtn'),
  historyList:      $('historyList'),
  copyAddressBtn:   $('copyAddressBtn'),
  sendForm:         $('sendForm'),
  sendBtn:          $('sendBtn'),
  sendBtnText:      $('sendBtnText'),
  destinationInput: $('destinationInput'),
  amountInput:      $('amountInput'),
  memoInput:        $('memoInput'),
  memoCount:        $('memoCount'),
  pasteBtn:         $('pasteBtn'),
  destError:        $('destError'),
  amountError:      $('amountError'),
  successOverlay:   $('successOverlay'),
  txHashDisplay:    $('txHashDisplay'),
  viewOnExplorerBtn:$('viewOnExplorerBtn'),
  copyTxHashBtn:    $('copyTxHashBtn'),
  closeSuccessBtn:  $('closeSuccessBtn'),
  loadingOverlay:   $('loadingOverlay'),
  loadingText:      $('loadingText'),
};

// ══════════════════════════════════════════════════════════════
// WALLET FUNCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * Check if Freighter is installed — polls up to 3 seconds
 * since the extension may take time to inject into the page
 */
async function isFreighterInstalled() {
  // Check immediately
  if (window.freighterApi || window.freighter) return true;

  // Poll every 200ms for up to 3 seconds (15 attempts)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (window.freighterApi || window.freighter) return true;
  }
  return false;
}

/**
 * Get the Freighter API object (handles both old and new API shapes)
 */
function getFreighterApi() {
  return window.freighterApi || window.freighter || null;
}

/**
 * Connect wallet via Freighter
 */
async function connectWallet() {
  const installed = await isFreighterInstalled();
  if (!installed) {
    toastError(
      'Freighter Not Found',
      'Please install the Freighter browser extension at freighter.app'
    );
    window.open('https://freighter.app', '_blank', 'noopener');
    return;
  }

  showLoading('Connecting to Freighter...');

  try {
    const api = getFreighterApi();

    // Request access
    const accessResult = await api.requestAccess();
    if (accessResult.error) throw new Error(accessResult.error);

    // Get public key
    let publicKey;
    if (typeof api.getPublicKey === 'function') {
      const pkResult = await api.getPublicKey();
      publicKey = pkResult.publicKey || pkResult;
    } else if (typeof api.getAddress === 'function') {
      const addrResult = await api.getAddress();
      publicKey = addrResult.address || addrResult;
    } else {
      throw new Error('Could not retrieve public key from Freighter.');
    }

    if (!publicKey || !StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new Error('Invalid public key received from Freighter.');
    }

    // Check network
    if (typeof api.getNetwork === 'function') {
      const net = await api.getNetwork();
      const networkName = (net.network || net || '').toUpperCase();
      if (networkName && !networkName.includes('TEST')) {
        toastWarning(
          'Wrong Network',
          'Please switch Freighter to Stellar Testnet in extension settings.'
        );
      }
    }

    state.publicKey  = publicKey;
    state.connected  = true;

    onWalletConnected();
    toastSuccess('Wallet Connected', shortenAddress(publicKey));

  } catch (err) {
    console.error('[connectWallet]', err);
    const msg = err.message || String(err);
    if (msg.toLowerCase().includes('user declined') || msg.toLowerCase().includes('rejected')) {
      toastInfo('Connection Cancelled', 'You cancelled the wallet connection.');
    } else {
      toastError('Connection Failed', msg);
    }
  } finally {
    hideLoading();
  }
}

/**
 * Disconnect wallet — clear state and reset UI
 */
function disconnectWallet() {
  state.connected = false;
  state.publicKey = null;
  state.balance   = null;
  state.txHistory = [];

  destroyBalanceChart();

  // UI reset
  els.heroSection.hidden = false;
  els.dashboard.hidden   = true;
  updateConnectButtonState(false);

  els.destinationInput.value = '';
  els.amountInput.value      = '';
  els.memoInput.value        = '';
  els.destError.textContent  = '';
  els.amountError.textContent = '';

  toastInfo('Wallet Disconnected', 'See you among the stars! ★');
}

// ══════════════════════════════════════════════════════════════
// BALANCE
// ══════════════════════════════════════════════════════════════

/**
 * Fetch XLM balance from Horizon
 */
async function fetchBalance(showSpinner = true) {
  if (!state.publicKey) return;
  if (showSpinner) animateRefreshBtn(els.refreshBalanceBtn, true);

  try {
    const account = await server.loadAccount(state.publicKey);
    const xlmBalance = account.balances.find(b => b.asset_type === 'native');
    const amount = xlmBalance ? parseFloat(xlmBalance.balance) : 0;

    state.balance = amount;
    animateBalanceCounter(amount);
    updateBalanceChart(amount);

    const usd = (amount * XLM_USD_PRICE).toFixed(2);
    els.balanceUsd.textContent = `≈ $${usd} USD`;
    els.lastUpdated.textContent = new Date().toLocaleTimeString();

  } catch (err) {
    console.error('[fetchBalance]', err);
    if (err.response?.status === 404) {
      // Account not funded yet
      state.balance = 0;
      animateBalanceCounter(0);
      updateBalanceChart(0);
      els.balanceUsd.textContent = '≈ $0.00 USD';
      els.lastUpdated.textContent = new Date().toLocaleTimeString();
      toastWarning(
        'Account Not Funded',
        'Click "Get Free XLM" to fund your testnet account.'
      );
    } else {
      toastError('Balance Fetch Failed', err.message || 'Network error');
    }
  } finally {
    if (showSpinner) animateRefreshBtn(els.refreshBalanceBtn, false);
  }
}

/**
 * Animate the balance number rolling up
 */
function animateBalanceCounter(target) {
  const el = els.balanceNumber;
  const start = parseFloat(el.textContent.replace(/,/g, '')) || 0;
  const duration = 900;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;
    el.textContent = current.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══════════════════════════════════════════════════════════════
// TRANSACTION HISTORY
// ══════════════════════════════════════════════════════════════

/**
 * Fetch recent payment operations from Horizon
 */
async function fetchTransactionHistory(showSpinner = true) {
  if (!state.publicKey) return;
  if (showSpinner) animateRefreshBtn(els.refreshHistoryBtn, true);

  try {
    const ops = await server
      .payments()
      .forAccount(state.publicKey)
      .limit(10)
      .order('desc')
      .call();

    const records = ops.records.filter(r => r.type === 'payment' && r.asset_type === 'native');
    state.txHistory = records;
    renderTransactionHistory(records);

  } catch (err) {
    console.error('[fetchTransactionHistory]', err);
    if (err.response?.status !== 404) {
      toastError('History Fetch Failed', err.message || 'Network error');
    }
  } finally {
    if (showSpinner) animateRefreshBtn(els.refreshHistoryBtn, false);
  }
}

/**
 * Render the transaction history list
 */
function renderTransactionHistory(records) {
  const list = els.historyList;

  if (!records.length) {
    list.innerHTML = `
      <div class="history-empty">
        <div class="empty-icon">🌌</div>
        <p>No XLM transactions yet</p>
      </div>`;
    return;
  }

  list.innerHTML = records.map((r, i) => {
    const isSent   = r.from === state.publicKey;
    const partner  = isSent ? r.to : r.from;
    const amount   = parseFloat(r.amount).toFixed(4);
    const sign     = isSent ? '−' : '+';
    const typeClass= isSent ? 'sent' : 'received';
    const icon     = isSent ? '↑' : '↓';
    const label    = isSent ? 'Sent' : 'Received';
    const date     = new Date(r.created_at);
    const timeStr  = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const txHash   = r.transaction_hash;

    return `
      <div class="tx-item" style="animation-delay:${i * 0.06}s">
        <div class="tx-type-icon ${typeClass}">${icon}</div>
        <div class="tx-info">
          <div class="tx-direction">${label} XLM</div>
          <div class="tx-address" title="${partner}">${shortenAddress(partner)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${typeClass}">${sign}${amount} XLM</div>
          <div class="tx-time">${timeStr}</div>
        </div>
        <a
          href="${EXPLORER_BASE}${txHash}"
          target="_blank"
          rel="noopener noreferrer"
          class="tx-explorer-link"
          title="View on Stellar Expert"
          aria-label="View transaction on Stellar Expert explorer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// SEND PAYMENT
// ══════════════════════════════════════════════════════════════

/**
 * Handle send payment form submission
 */
async function handleSendPayment(e) {
  e.preventDefault();

  const destination = els.destinationInput.value.trim();
  const amountStr   = els.amountInput.value.trim();
  const memo        = els.memoInput.value.trim();

  // Clear previous errors
  setFieldError(els.destError,   '');
  setFieldError(els.amountError, '');

  // Validate
  let hasError = false;
  if (!destination) {
    setFieldError(els.destError, 'Recipient address is required.'); hasError = true;
  } else if (!StrKey.isValidEd25519PublicKey(destination)) {
    setFieldError(els.destError, 'Invalid Stellar public key. Must start with G.'); hasError = true;
  } else if (destination === state.publicKey) {
    setFieldError(els.destError, 'Cannot send to your own address.'); hasError = true;
  }

  const amount = parseFloat(amountStr);
  if (!amountStr || isNaN(amount) || amount <= 0) {
    setFieldError(els.amountError, 'Enter a valid amount greater than 0.'); hasError = true;
  } else if (amount < 0.0000001) {
    setFieldError(els.amountError, 'Minimum amount is 0.0000001 XLM.'); hasError = true;
  } else if (state.balance !== null && amount > state.balance - 1) {
    // Keep at least 1 XLM as reserve
    setFieldError(els.amountError, `Insufficient balance. Max sendable: ${Math.max(0, state.balance - 1).toFixed(4)} XLM (1 XLM minimum reserve).`);
    hasError = true;
  }

  if (hasError) return;

  showLoading('Building transaction...');
  setSendButtonLoading(true);

  try {
    // Load source account
    const sourceAccount = await server.loadAccount(state.publicKey);

    // Build transaction
    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
    .addOperation(Operation.payment({
      destination,
      asset:  Asset.native(),
      amount: amount.toFixed(7),
    }))
    .setTimeout(180);

    if (memo) {
      txBuilder.addMemo(Memo.text(memo));
    }

    const tx = txBuilder.build();

    // Sign with Freighter
    showLoading('Please confirm in Freighter...');
    const api = getFreighterApi();
    const txXdr = tx.toEnvelope().toXDR('base64');

    let signedXdr;
    if (typeof api.signTransaction === 'function') {
      const result = await api.signTransaction(txXdr, {
        networkPassphrase: Networks.TESTNET,
        network: 'TESTNET',
      });
      signedXdr = result.signedTxXdr || result;
    } else {
      throw new Error('Freighter signTransaction not available.');
    }

    if (!signedXdr) throw new Error('No signed transaction received from Freighter.');

    // Submit to Horizon
    showLoading('Submitting to Stellar network...');
    const { TransactionBuilder: TB } = StellarSdk;
    const signedTx = TB.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(signedTx);

    const txHash = result.hash;
    hideLoading();
    showSuccessOverlay(txHash, destination, amount);

    // Reset form
    els.destinationInput.value  = '';
    els.amountInput.value       = '';
    els.memoInput.value         = '';
    els.memoCount.textContent   = '0/28';
    setActiveQuickBtn(null);

    // Refresh balance and history
    setTimeout(() => {
      fetchBalance(false);
      fetchTransactionHistory(false);
    }, 2000);

  } catch (err) {
    hideLoading();
    console.error('[sendPayment]', err);
    const msg = extractStellarError(err);

    if (msg.toLowerCase().includes('user declined') || msg.toLowerCase().includes('rejected') || msg.toLowerCase().includes('cancel')) {
      toastInfo('Transaction Cancelled', 'You cancelled the Freighter signing.');
    } else {
      toastError('Transaction Failed', msg);
    }
  } finally {
    setSendButtonLoading(false);
  }
}

/**
 * Extract human-readable error from Stellar SDK errors
 */
function extractStellarError(err) {
  if (!err) return 'Unknown error';
  if (err.response?.data?.extras?.result_codes) {
    const codes = err.response.data.extras.result_codes;
    const opCodes = codes.operations || [];
    return `${codes.transaction || 'tx_failed'}: ${opCodes.join(', ') || 'unknown op error'}`;
  }
  return err.message || String(err);
}

// ══════════════════════════════════════════════════════════════
// FRIENDBOT FAUCET
// ══════════════════════════════════════════════════════════════

async function requestFaucet() {
  if (!state.publicKey) return;
  showLoading('Requesting XLM from Friendbot...');
  els.faucetBtn.disabled = true;

  try {
    const res = await fetch(`${FRIENDBOT_URL}?addr=${state.publicKey}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail || body?.title || `HTTP ${res.status}`;
      if (detail.toLowerCase().includes('already funded') || detail.toLowerCase().includes('createaccount')) {
        toastWarning('Already Funded', 'Your account is already funded. You have XLM!');
      } else {
        throw new Error(detail);
      }
    } else {
      toastSuccess('Free XLM Received! 🎉', '10,000 XLM added to your testnet account.');
      setTimeout(() => fetchBalance(false), 2500);
    }
  } catch (err) {
    console.error('[requestFaucet]', err);
    toastError('Faucet Failed', err.message || 'Could not reach Friendbot.');
  } finally {
    hideLoading();
    els.faucetBtn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════

function onWalletConnected() {
  els.heroSection.hidden = false; // hide with animation first
  els.heroSection.style.animation = 'fadeOut 0.3s ease forwards';
  setTimeout(() => {
    els.heroSection.hidden = true;
    els.heroSection.style.animation = '';
    els.dashboard.hidden   = false;
  }, 300);

  // Update wallet bar
  const pk = state.publicKey;
  els.walletAddress.textContent = shortenAddress(pk, 8, 8);
  els.walletAddress.title = pk;

  updateConnectButtonState(true);
  initBalanceChart();
  fetchBalance(true);
  fetchTransactionHistory(true);
}

function updateConnectButtonState(connected) {
  if (connected) {
    els.connectBtn.innerHTML = `
      <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 12V22H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
      </svg>
      Connected`;
    els.connectBtn.style.background = 'rgba(52,211,153,0.12)';
    els.connectBtn.style.border = '1px solid rgba(52,211,153,0.3)';
    els.connectBtn.style.color = '#34d399';
    els.connectBtn.style.boxShadow = '0 0 16px rgba(52,211,153,0.2)';
  } else {
    els.connectBtn.innerHTML = `
      <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
        <line x1="12" y1="12" x2="12" y2="16"/>
        <line x1="10" y1="14" x2="14" y2="14"/>
      </svg>
      Connect Wallet`;
    els.connectBtn.style.background = '';
    els.connectBtn.style.border     = '';
    els.connectBtn.style.color      = '';
    els.connectBtn.style.boxShadow  = '';
  }
}

function showLoading(text = 'Processing...') {
  els.loadingText.textContent = text;
  els.loadingOverlay.hidden   = false;
}

function hideLoading() {
  els.loadingOverlay.hidden = true;
}

function showSuccessOverlay(txHash, destination, amount) {
  els.txHashDisplay.textContent = txHash;
  els.viewOnExplorerBtn.href    = EXPLORER_BASE + txHash;
  els.successOverlay.hidden     = false;

  toastSuccess(
    `Sent ${amount.toFixed(4)} XLM ✓`,
    `To: ${shortenAddress(destination)}`
  );
}

function setFieldError(el, msg) {
  el.textContent = msg;
  const input = el.previousElementSibling?.querySelector?.('input') || el.closest('.form-group')?.querySelector?.('input');
  if (input) {
    input.classList.toggle('error', !!msg);
    input.setAttribute('aria-invalid', !!msg);
  }
}

function setSendButtonLoading(loading) {
  els.sendBtn.disabled = loading;
  els.sendBtnText.textContent = loading ? 'Sending...' : 'Send Payment';
}

function animateRefreshBtn(btn, spinning) {
  btn?.classList.toggle('spinning', spinning);
}

function setActiveQuickBtn(amount) {
  document.querySelectorAll('.quick-btn').forEach(b => {
    b.classList.toggle('active', amount !== null && b.dataset.amount === String(amount));
  });
}

function shortenAddress(addr, start = 6, end = 6) {
  if (!addr || addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

async function copyToClipboard(text, label = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(label, '');
  } catch {
    toastError('Copy Failed', 'Could not access clipboard.');
  }
}

// ══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════

function bindEvents() {
  // Connect buttons
  els.connectBtn.addEventListener('click', () => {
    if (!state.connected) connectWallet();
  });
  els.heroConnectBtn?.addEventListener('click', connectWallet);

  // Disconnect
  els.disconnectBtn?.addEventListener('click', disconnectWallet);

  // Faucet
  els.faucetBtn?.addEventListener('click', requestFaucet);

  // Refresh balance
  els.refreshBalanceBtn?.addEventListener('click', () => {
    fetchBalance(true);
    fetchTransactionHistory(true);
  });

  // Refresh history
  els.refreshHistoryBtn?.addEventListener('click', () => fetchTransactionHistory(true));

  // Copy wallet address
  els.copyAddressBtn?.addEventListener('click', () => {
    copyToClipboard(state.publicKey, 'Address Copied!');
  });

  // Paste address
  els.pasteBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      els.destinationInput.value = text.trim();
      els.destinationInput.dispatchEvent(new Event('input'));
    } catch {
      toastWarning('Paste Failed', 'Allow clipboard access or paste manually.');
    }
  });

  // Send form
  els.sendForm?.addEventListener('submit', handleSendPayment);

  // Quick amount buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.amount;
      els.amountInput.value = val;
      setActiveQuickBtn(val);
      els.amountError.textContent = '';
    });
  });

  // Amount input — clear active quick btn on manual entry
  els.amountInput?.addEventListener('input', () => {
    setActiveQuickBtn(null);
    els.amountError.textContent = '';
  });

  // Destination input validation on blur
  els.destinationInput?.addEventListener('blur', () => {
    const val = els.destinationInput.value.trim();
    if (val && !StrKey.isValidEd25519PublicKey(val)) {
      setFieldError(els.destError, 'Invalid Stellar address.');
    } else {
      setFieldError(els.destError, '');
    }
  });
  els.destinationInput?.addEventListener('input', () => {
    if (els.destError.textContent) setFieldError(els.destError, '');
  });

  // Memo character count
  els.memoInput?.addEventListener('input', () => {
    const len = els.memoInput.value.length;
    els.memoCount.textContent = `${len}/28`;
    if (len > 28) els.memoInput.value = els.memoInput.value.slice(0, 28);
  });

  // Copy tx hash
  els.copyTxHashBtn?.addEventListener('click', () => {
    copyToClipboard(els.txHashDisplay.textContent, 'Tx Hash Copied!');
  });

  // Close success overlay
  els.closeSuccessBtn?.addEventListener('click', () => {
    els.successOverlay.hidden = true;
  });
  els.successOverlay?.addEventListener('click', (e) => {
    if (e.target === els.successOverlay) els.successOverlay.hidden = true;
  });

  // Keyboard: Escape closes overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.successOverlay.hidden) {
      els.successOverlay.hidden = true;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

async function init() {
  // Start particle background
  initParticles();

  // Bind all UI events
  bindEvents();

  // Check if already connected (user refreshed page)
  try {
    const installed = await isFreighterInstalled();
    if (installed) {
      const api = getFreighterApi();
      if (typeof api.isConnected === 'function') {
        const connected = await api.isConnected();
        if (connected?.isConnected || connected === true) {
          // Silently restore session
          let pk;
          if (typeof api.getPublicKey === 'function') {
            const r = await api.getPublicKey();
            pk = r.publicKey || r;
          } else if (typeof api.getAddress === 'function') {
            const r = await api.getAddress();
            pk = r.address || r;
          }
          if (pk && StrKey.isValidEd25519PublicKey(pk)) {
            state.publicKey = pk;
            state.connected = true;
            onWalletConnected();
          }
        }
      }
    }
  } catch (err) {
    // Silent — not critical
    console.log('[init] auto-connect check failed:', err.message);
  }
}

// Boot
init();
