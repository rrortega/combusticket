/**
 * FacturaGas — Client-side SaaS Application
 * Clean, modern, end-user friendly gas invoice automation
 */

document.addEventListener('DOMContentLoaded', () => {
  // Embedded SAT Catalogs Fallback (ensures local dev & offline never show empty dropdowns)
  const DEFAULT_SAT_REGIMENES = [
    { code: '601', description: 'General de Ley Personas Morales', tipoPersona: 'MORAL' },
    { code: '603', description: 'Personas Morales con Fines no Lucrativos', tipoPersona: 'MORAL' },
    { code: '605', description: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', tipoPersona: 'FISICA' },
    { code: '606', description: 'Arrendamiento', tipoPersona: 'FISICA' },
    { code: '607', description: 'Régimen de Enajenación o Adquisición de Bienes', tipoPersona: 'FISICA' },
    { code: '608', description: 'Demás ingresos', tipoPersona: 'FISICA' },
    { code: '610', description: 'Residentes en el Extranjero sin Establecimiento Permanente en México', tipoPersona: 'AMBAS' },
    { code: '611', description: 'Ingresos por Dividendos (socios y accionistas)', tipoPersona: 'FISICA' },
    { code: '612', description: 'Personas Físicas con Actividades Empresariales y Profesionales', tipoPersona: 'FISICA' },
    { code: '614', description: 'Ingresos por intereses', tipoPersona: 'FISICA' },
    { code: '615', description: 'Régimen de los ingresos por obtención de premios', tipoPersona: 'FISICA' },
    { code: '616', description: 'Sin obligaciones fiscales', tipoPersona: 'FISICA' },
    { code: '620', description: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', tipoPersona: 'MORAL' },
    { code: '621', description: 'Incorporación Fiscal', tipoPersona: 'FISICA' },
    { code: '622', description: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', tipoPersona: 'AMBAS' },
    { code: '623', description: 'Opcional para Grupos de Sociedades', tipoPersona: 'MORAL' },
    { code: '624', description: 'Coordinados', tipoPersona: 'MORAL' },
    { code: '625', description: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', tipoPersona: 'FISICA' },
    { code: '626', description: 'Régimen Simplificado de Confianza', tipoPersona: 'AMBAS' }
  ];

  const DEFAULT_SAT_USOS = [
    { code: 'G03', description: 'Gastos en general', defaultGasolina: true },
    { code: 'G01', description: 'Adquisición de mercancías', defaultGasolina: false },
    { code: 'G02', description: 'Devoluciones, descuentos o bonificaciones', defaultGasolina: false },
    { code: 'I03', description: 'Equipo de transporte', defaultGasolina: false },
    { code: 'I01', description: 'Construcciones', defaultGasolina: false },
    { code: 'I02', description: 'Mobiliario y equipo de oficina por inversiones', defaultGasolina: false },
    { code: 'I04', description: 'Equipo de computo y accesorios', defaultGasolina: false },
    { code: 'I05', description: 'Dados, troqueles, moldes, matrices y herramental', defaultGasolina: false },
    { code: 'I06', description: 'Comunicaciones telefónicas', defaultGasolina: false },
    { code: 'I07', description: 'Comunicaciones satelitales', defaultGasolina: false },
    { code: 'I08', description: 'Otra maquinaria y equipo', defaultGasolina: false },
    { code: 'D01', description: 'Honorarios médicos, dentales y gastos hospitalarios', defaultGasolina: false },
    { code: 'D02', description: 'Gastos médicos por incapacidad o discapacidad', defaultGasolina: false },
    { code: 'D03', description: 'Gastos funerales', defaultGasolina: false },
    { code: 'D04', description: 'Donativos', defaultGasolina: false },
    { code: 'D05', description: 'Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)', defaultGasolina: false },
    { code: 'D06', description: 'Aportaciones voluntarias al SAR', defaultGasolina: false },
    { code: 'D07', description: 'Primas por seguros de gastos médicos', defaultGasolina: false },
    { code: 'D08', description: 'Gastos de transportación escolar obligatoria', defaultGasolina: false },
    { code: 'D09', description: 'Depósitos en cuentas para el ahorro, primas con base en planes de pensiones', defaultGasolina: false },
    { code: 'D10', description: 'Pagos por servicios educativos (colegiaturas)', defaultGasolina: false },
    { code: 'S01', description: 'Sin efectos fiscales', defaultGasolina: false },
    { code: 'CP01', description: 'Pagos', defaultGasolina: false },
    { code: 'CN01', description: 'Nómina', defaultGasolina: false }
  ];

  // State: Initialize catalogs with local cache or robust embedded fallbacks
  let cachedCatalogs = null;
  try {
    cachedCatalogs = JSON.parse(localStorage.getItem('combusticket_catalogs') || 'null');
  } catch {}

  let catalogs = cachedCatalogs || {
    regimenes: { regimenes: DEFAULT_SAT_REGIMENES },
    usosCfdi: { usos: DEFAULT_SAT_USOS },
    formasPago: null
  };

  let supportedStations = [];
  let currentScannedReceipts = []; // Array of ParsedReceiptData objects currently in review
  let activeJobs = [];
  let redisHistoryItems = [];
  let historyPollingTimer = null;

  // Elements
  const brandLogo = document.getElementById('brand-logo');
  const navTabs = document.getElementById('nav-tabs');
  const navTabsButtons = document.querySelectorAll('.nav-tab');
  const historyBadge = document.getElementById('history-badge');

  // Profile Header Pill & Actions
  const headerProfile = document.getElementById('header-profile');
  const profilePill = document.getElementById('profile-pill');
  const avatarInitials = document.getElementById('avatar-initials');
  const pillRazonSocial = document.getElementById('pill-razon-social');
  const pillRfc = document.getElementById('pill-rfc');
  const btnEditProfile = document.getElementById('btn-edit-profile');
  const btnHeaderOnboard = document.getElementById('btn-header-onboard');

  // Screens
  const screenWelcome = document.getElementById('screen-welcome');
  const screenProfile = document.getElementById('screen-profile');
  const screenWorkbench = document.getElementById('screen-workbench');
  const screenHistory = document.getElementById('screen-history');
  const allScreens = [screenWelcome, screenProfile, screenWorkbench, screenHistory];

  // Welcome Screen
  const btnWelcomeStart = document.getElementById('btn-welcome-start');
  const stationsGrid = document.getElementById('stations-grid');

  // Profile Form Elements
  const profileForm = document.getElementById('profile-form');
  const profRfc = document.getElementById('prof-rfc');
  const profRazon = document.getElementById('prof-razon');
  const profEmail = document.getElementById('prof-email');
  const profCp = document.getElementById('prof-cp');
  const profRegimen = document.getElementById('prof-regimen');
  const profUso = document.getElementById('prof-uso');
  const btnCancelProfile = document.getElementById('btn-cancel-profile');
  const btnSaveProfile = document.getElementById('btn-save-profile');

  // Profile Form Real-time Validation Feedback Nodes
  const profRfcFeedback = document.getElementById('prof-rfc-feedback');
  const profRazonFeedback = document.getElementById('prof-razon-feedback');
  const profEmailFeedback = document.getElementById('prof-email-feedback');
  const profCpFeedback = document.getElementById('prof-cp-feedback');
  const profRegimenFeedback = document.getElementById('prof-regimen-feedback');
  const profUsoFeedback = document.getElementById('prof-uso-feedback');

  // Custom Searchable Régimen Fiscal Choice
  const customRegimenContainer = document.getElementById('custom-regimen-container');
  const regimenSelectTrigger = document.getElementById('regimen-select-trigger');
  const regimenSelectPlaceholder = document.getElementById('regimen-select-placeholder');
  const regimenSelectedValue = document.getElementById('regimen-selected-value');
  const regimenSelectedCode = document.getElementById('regimen-selected-code');
  const regimenSelectedDesc = document.getElementById('regimen-selected-desc');
  const regimenSelectClear = document.getElementById('regimen-select-clear');
  const regimenSelectDropdown = document.getElementById('regimen-select-dropdown');
  const regimenSearchInput = document.getElementById('regimen-search-input');
  const regimenSearchClear = document.getElementById('regimen-search-clear');
  const chipFilterAll = document.getElementById('chip-filter-all');
  const chipFilterFisica = document.getElementById('chip-filter-fisica');
  const chipFilterMoral = document.getElementById('chip-filter-moral');
  const regimenOptionsList = document.getElementById('regimen-options-list');
  const regimenEmptyState = document.getElementById('regimen-empty-state');

  // Workbench
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const dropzoneScanning = document.getElementById('dropzone-scanning');
  const btnLoadDemoReceipt = document.getElementById('btn-load-demo-receipt');
  const uploadCard = document.getElementById('upload-card');
  const reviewSection = document.getElementById('review-section');
  const tabBtnData = document.getElementById('tab-btn-data');
  const tabBtnImage = document.getElementById('tab-btn-image');
  const paneData = document.getElementById('pane-data');
  const paneImage = document.getElementById('pane-image');
  const btnLoadAnotherReceipt = document.getElementById('btn-load-another-receipt');
  const btnScannedClear = document.getElementById('btn-scanned-clear');
  const btnScannedUploadAnother = document.getElementById('btn-scanned-upload-another');
  const fullwidthScannedImg = document.getElementById('fullwidth-scanned-img');
  const receiptsList = document.getElementById('receipts-list');
  const btnAddManualReceipt = document.getElementById('btn-add-manual-receipt');
  const btnClearReceipts = document.getElementById('btn-clear-receipts');
  const totalTicketsCount = document.getElementById('total-tickets-count');
  const totalAmountSum = document.getElementById('total-amount-sum');
  const btnEnqueueInvoices = document.getElementById('btn-enqueue-invoices');
  const btnCancelReview = document.getElementById('btn-cancel-review');

  // Scanner Overlay
  const scannerOverlay = document.getElementById('scanner-overlay');
  const scannerReceiptImg = document.getElementById('scanner-receipt-img');
  const scannerStatusText = document.getElementById('scanner-status-text');

  // History & Active Jobs Screen
  const activeJobsSection = document.getElementById('active-jobs-section');
  const activeJobsCount = document.getElementById('active-jobs-count');
  const queueJobsContainer = document.getElementById('queue-jobs-container');
  const historySubtitle = document.getElementById('history-subtitle');
  const historyContent = document.getElementById('history-content');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');
  const btnNewFromHistory = document.getElementById('btn-new-from-history');
  const mobileHistoryBar = document.getElementById('mobile-history-bar');
  const btnMobileNewReceipt = document.getElementById('btn-mobile-new-receipt');
  const btnBackToHistory = document.getElementById('btn-back-to-history');

  // Modal
  const mediaModal = document.getElementById('media-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const btnCloseModal = document.getElementById('btn-close-modal');

  // Fullscreen Receipt Viewer
  const receiptViewerOverlay = document.getElementById('receipt-viewer-overlay');
  const receiptViewerTitle = document.getElementById('receipt-viewer-title');
  const receiptViewerSubtitle = document.getElementById('receipt-viewer-subtitle');
  const receiptViewerCanvas = document.getElementById('receipt-viewer-canvas');
  const receiptViewerStage = document.getElementById('receipt-viewer-stage');
  const receiptViewerImg = document.getElementById('receipt-viewer-img');
  const viewerZoomLevel = document.getElementById('viewer-zoom-level');
  const btnViewerZoomIn = document.getElementById('viewer-zoom-in');
  const btnViewerZoomOut = document.getElementById('viewer-zoom-out');
  const btnViewerRotate = document.getElementById('viewer-rotate');
  const btnViewerReset = document.getElementById('viewer-reset');
  const btnViewerClose = document.getElementById('viewer-close');

  let viewerScale = 1.0;
  let viewerRotation = 0;
  let viewerPanX = 0;
  let viewerPanY = 0;
  let isViewerDragging = false;
  let viewerDragStartX = 0;
  let viewerDragStartY = 0;

  // Server Config
  let serverConfig = { recordVideo: false, dryRun: false };

  async function loadServerConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        serverConfig = await res.json();
      }
    } catch (err) {
      console.warn('Could not load server config:', err);
    }
  }

  // --- INITIALIZATION ---
  async function init() {
    // 1. Immediately populate select options with fallback/cached data synchronously
    populateSelectOptions();

    // 2. Immediately evaluate local profile state synchronously to prevent any render jump
    checkExistingProfile();

    // 3. Clear legacy local active jobs cache if present
    try { localStorage.removeItem('facturagas_active_jobs'); } catch {}

    setupEventListeners();
    checkDevEnvironment();

    // 4. Load server config and refresh history if active
    loadServerConfig().then(() => {
      const profile = getProfile();
      if (profile && profile.rfc && currentScreen === 'history') {
        loadUnifiedHistory(profile.rfc, true);
      }
    });

    // 5. Load catalogs and stations in background without blocking screen paint
    loadCatalogs();
    loadSupportedStations();
  }

  // --- PROFILE MANAGEMENT ---
  function getProfile() {
    try {
      const raw = localStorage.getItem('combusticket_profile') || localStorage.getItem('facturagas_profile');
      if (raw) return JSON.parse(raw);
    } catch {}

    // Cookie fallback
    try {
      const match = document.cookie.match(/(?:combusticket_profile|facturagas_profile)=([^;]+)/);
      if (match) return JSON.parse(decodeURIComponent(match[1]));
    } catch {}

    return null;
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem('combusticket_profile', JSON.stringify(profile));
      localStorage.setItem('facturagas_profile', JSON.stringify(profile));
    } catch {}
    try {
      document.cookie = `combusticket_profile=${encodeURIComponent(JSON.stringify(profile))};path=/;max-age=31536000;SameSite=Lax`;
    } catch {}
    updateProfileUI();
  }

  function checkExistingProfile() {
    const profile = getProfile();

    if (profile && profile.rfc) {
      document.documentElement.classList.add('has-profile');
      document.documentElement.classList.remove('no-profile');
      updateProfileUI();
      switchScreen(screenHistory);
      loadHistory();
    } else {
      document.documentElement.classList.remove('has-profile');
      document.documentElement.classList.add('no-profile');
      profilePill?.classList.add('hidden');
      btnHeaderOnboard?.classList.add('hidden');
      switchScreen(screenWelcome);

      // Background pre-fill from server default if available
      fetch('/api/profile')
        .then(res => res.json())
        .then(data => {
          if (data?.success && data?.profile && data?.profile.rfc) {
            profRfc.value = data.profile.rfc || '';
            profRazon.value = data.profile.razonSocial || '';
            profEmail.value = data.profile.email || '';
            profCp.value = data.profile.codigoPostal || '';
            if (data.profile.regimenFiscal) profRegimen.value = data.profile.regimenFiscal;
            if (data.profile.usoCfdi) profUso.value = data.profile.usoCfdi;
          }
        })
        .catch(() => {});
    }

    // Reveal header buttons once exact state is resolved
    headerProfile?.classList.remove('is-loading');
    document.documentElement.classList.add('app-initialized');
  }

  function getInitials(name, rfc) {
    const raw = (name || '').trim();
    if (raw) {
      const cleaned = raw.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0 && !['SA', 'DE', 'CV', 'SAPI', 'SRL', 'SC', 'LLC'].includes(w.toUpperCase()));
      
      if (cleaned.length >= 2) {
        return (cleaned[0][0] + cleaned[1][0]).toUpperCase();
      } else if (cleaned.length === 1) {
        return cleaned[0].substring(0, 2).toUpperCase();
      }
    }
    const cleanRfc = (rfc || '').trim().replace(/[^a-zA-Z0-9]/g, '');
    if (cleanRfc.length >= 2) {
      return cleanRfc.substring(0, 2).toUpperCase();
    }
    return '--';
  }

  function updateProfileUI() {
    const profile = getProfile();
    if (profile && profile.rfc) {
      const name = profile.razonSocial || profile.legalName || 'Mi Perfil';
      pillRazonSocial.textContent = name;
      pillRfc.textContent = `RFC: ${profile.rfc}`;
      if (avatarInitials) {
        avatarInitials.textContent = getInitials(name, profile.rfc);
      }
      profilePill?.classList.remove('hidden');
      btnHeaderOnboard?.classList.add('hidden');
    } else {
      profilePill?.classList.add('hidden');
      btnHeaderOnboard?.classList.add('hidden');
    }
    headerProfile?.classList.remove('is-loading');
  }

  // --- CATALOG & STATIONS LOADING ---
  async function loadCatalogs(retryCount = 0) {
    try {
      const res = await fetch('/api/catalogs');
      const data = await res.json();
      if (data && data.success && data.regimenes) {
        catalogs = data;
        try {
          localStorage.setItem('combusticket_catalogs', JSON.stringify(data));
        } catch {}
        populateSelectOptions();
      }
    } catch (err) {
      console.warn('Error loading /api/catalogs (using embedded fallback):', err);
      if (retryCount < 2) {
        setTimeout(() => loadCatalogs(retryCount + 1), 2000);
      }
    }
  }

  function populateSelectOptions() {
    const savedRegimenVal = profRegimen ? profRegimen.value : '';
    const savedUsoVal = profUso ? profUso.value : '';

    // 1. Régimen Fiscal (Native select options)
    if (catalogs.regimenes?.regimenes && profRegimen) {
      profRegimen.innerHTML = '<option value="">-- Selecciona tu Régimen Fiscal --</option>';
      for (const item of catalogs.regimenes.regimenes) {
        const code = item.code || item.codigo;
        const desc = item.description || item.descripcion;
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} - ${desc}`;
        profRegimen.appendChild(opt);
      }
      if (savedRegimenVal) {
        profRegimen.value = savedRegimenVal;
      }
      syncCustomRegimenFromValue(profRegimen.value);
      renderRegimenOptions();
    }

    // 2. Uso de CFDI
    if (catalogs.usosCfdi?.usos && profUso) {
      profUso.innerHTML = '<option value="">-- Selecciona el Uso de CFDI --</option>';
      for (const item of catalogs.usosCfdi.usos) {
        const code = item.code || item.codigo;
        const desc = item.description || item.descripcion;
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${code} - ${desc}`;
        profUso.appendChild(opt);
      }
      if (savedUsoVal) {
        profUso.value = savedUsoVal;
      } else if (profUso.querySelector('option[value="G03"]')) {
        profUso.value = 'G03';
      }
    }
  }

  // --- CUSTOM ACCESSIBLE SEARCHABLE SELECT (COMBOBOX) FOR RÉGIMEN FISCAL ---
  let activeRegimenFilter = 'ALL'; // 'ALL' | 'FISICA' | 'MORAL'
  let activeRegimenSearch = '';
  let activeHighlightedIndex = -1;

  function initCustomRegimenSelect() {
    if (!customRegimenContainer || !regimenSelectTrigger) return;

    // Trigger open/close
    regimenSelectTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRegimenDropdown();
    });

    // Clear selection button
    regimenSelectClear?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearRegimenSelection();
    });

    // Live search input
    regimenSearchInput?.addEventListener('input', (e) => {
      activeRegimenSearch = e.target.value;
      if (regimenSearchClear) {
        regimenSearchClear.classList.toggle('hidden', !activeRegimenSearch);
      }
      renderRegimenOptions();
    });

    // Clear search query button
    regimenSearchClear?.addEventListener('click', (e) => {
      e.stopPropagation();
      regimenSearchInput.value = '';
      activeRegimenSearch = '';
      regimenSearchClear.classList.add('hidden');
      regimenSearchInput.focus();
      renderRegimenOptions();
    });

    // Persona filter chips (Todos / Físicas / Morales)
    const chips = [
      { el: chipFilterAll, filter: 'ALL' },
      { el: chipFilterFisica, filter: 'FISICA' },
      { el: chipFilterMoral, filter: 'MORAL' },
    ];

    chips.forEach(({ el, filter }) => {
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        chips.forEach(c => c.el?.classList.remove('active'));
        el.classList.add('active');
        activeRegimenFilter = filter;
        renderRegimenOptions();
      });
    });

    // Keyboard navigation
    customRegimenContainer.addEventListener('keydown', handleRegimenKeydown);

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!customRegimenContainer.contains(e.target)) {
        closeRegimenDropdown();
      }
    });

    // Listen to changes on native select
    profRegimen?.addEventListener('change', () => {
      syncCustomRegimenFromValue(profRegimen.value);
      validateRegimenField(false);
    });

    // Initial setup
    renderRegimenOptions();
    syncCustomRegimenFromValue(profRegimen ? profRegimen.value : '');
  }

  function renderRegimenOptions() {
    if (!regimenOptionsList) return;
    const items = catalogs.regimenes?.regimenes || DEFAULT_SAT_REGIMENES;
    const query = (activeRegimenSearch || '').trim().toLowerCase();

    // 1. Filter by Persona type
    let filtered = items.filter(item => {
      if (activeRegimenFilter === 'FISICA') {
        return item.tipoPersona === 'FISICA' || item.tipoPersona === 'AMBAS';
      }
      if (activeRegimenFilter === 'MORAL') {
        return item.tipoPersona === 'MORAL' || item.tipoPersona === 'AMBAS';
      }
      return true;
    });

    // 2. Filter by search query
    if (query) {
      filtered = filtered.filter(item => {
        const code = (item.code || item.codigo || '').toLowerCase();
        const desc = (item.description || item.descripcion || '').toLowerCase();
        return code.includes(query) || desc.includes(query);
      });
    }

    regimenOptionsList.innerHTML = '';
    activeHighlightedIndex = -1;

    if (filtered.length === 0) {
      regimenEmptyState?.classList.remove('hidden');
      return;
    }

    regimenEmptyState?.classList.add('hidden');

    filtered.forEach((item, index) => {
      const code = item.code || item.codigo;
      const desc = item.description || item.descripcion;
      const tipo = item.tipoPersona || 'AMBAS';
      const isSelected = profRegimen && profRegimen.value === code;

      const li = document.createElement('li');
      li.className = `custom-select-option ${isSelected ? 'is-selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.dataset.code = code;
      li.dataset.index = index;

      const highlightedDesc = highlightText(desc, query);
      const highlightedCode = highlightText(code, query);
      const personaLabel = tipo === 'FISICA' ? 'Física' : (tipo === 'MORAL' ? 'Moral' : 'Física / Moral');
      const personaClass = tipo === 'FISICA' ? 'fisica' : (tipo === 'MORAL' ? 'moral' : 'ambas');

      li.innerHTML = `
        <div class="option-main">
          <span class="regimen-code-tag">${highlightedCode}</span>
          <span class="option-desc">${highlightedDesc}</span>
        </div>
        <div class="option-meta">
          <span class="persona-tag ${personaClass}">${personaLabel}</span>
          ${isSelected ? '<span class="option-check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        </div>
      `;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRegimen(code, desc);
        closeRegimenDropdown();
      });

      regimenOptionsList.appendChild(li);
    });
  }

  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return escapeHtml(text).replace(regex, '<mark>$1</mark>');
  }

  function selectRegimen(code, desc) {
    if (profRegimen) {
      profRegimen.value = code;
      profRegimen.dispatchEvent(new Event('change'));
    }
    syncCustomRegimenFromValue(code, desc);
    customRegimenContainer?.classList.remove('is-invalid');
    validateRegimenField(true);
  }

  function clearRegimenSelection() {
    if (profRegimen) {
      profRegimen.value = '';
      profRegimen.dispatchEvent(new Event('change'));
    }
    syncCustomRegimenFromValue('');
  }

  function syncCustomRegimenFromValue(code, knownDesc) {
    if (!regimenSelectPlaceholder || !regimenSelectedValue) return;

    if (!code) {
      regimenSelectPlaceholder.classList.remove('hidden');
      regimenSelectedValue.classList.add('hidden');
      regimenSelectClear?.classList.add('hidden');
      return;
    }

    let desc = knownDesc;
    if (!desc) {
      const items = catalogs.regimenes?.regimenes || DEFAULT_SAT_REGIMENES;
      const found = items.find(i => (i.code || i.codigo) === code);
      desc = found ? (found.description || found.descripcion) : `Régimen ${code}`;
    }

    regimenSelectPlaceholder.classList.add('hidden');
    regimenSelectedValue.classList.remove('hidden');
    if (regimenSelectedCode) regimenSelectedCode.textContent = code;
    if (regimenSelectedDesc) regimenSelectedDesc.textContent = desc;
    regimenSelectClear?.classList.remove('hidden');
  }

  function openRegimenDropdown() {
    if (!regimenSelectDropdown) return;
    customRegimenContainer?.classList.add('open');
    regimenSelectDropdown.classList.remove('hidden');
    regimenSelectTrigger?.setAttribute('aria-expanded', 'true');
    renderRegimenOptions();
    setTimeout(() => {
      regimenSearchInput?.focus();
    }, 40);
  }

  function closeRegimenDropdown() {
    if (!regimenSelectDropdown) return;
    customRegimenContainer?.classList.remove('open');
    regimenSelectDropdown.classList.add('hidden');
    regimenSelectTrigger?.setAttribute('aria-expanded', 'false');
    activeHighlightedIndex = -1;
  }

  function toggleRegimenDropdown() {
    if (regimenSelectDropdown?.classList.contains('hidden')) {
      openRegimenDropdown();
    } else {
      closeRegimenDropdown();
    }
  }

  function handleRegimenKeydown(e) {
    const isDropdownOpen = !regimenSelectDropdown?.classList.contains('hidden');

    if (e.key === 'Escape') {
      if (isDropdownOpen) {
        e.preventDefault();
        closeRegimenDropdown();
        regimenSelectTrigger?.focus();
      }
      return;
    }

    if (!isDropdownOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openRegimenDropdown();
      }
      return;
    }

    const options = regimenOptionsList?.querySelectorAll('.custom-select-option') || [];
    if (options.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeHighlightedIndex = (activeHighlightedIndex + 1) % options.length;
      updateHighlightedOption(options);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeHighlightedIndex = (activeHighlightedIndex - 1 + options.length) % options.length;
      updateHighlightedOption(options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeHighlightedIndex >= 0 && activeHighlightedIndex < options.length) {
        options[activeHighlightedIndex].click();
      }
    }
  }

  function updateHighlightedOption(options) {
    options.forEach((opt, idx) => {
      if (idx === activeHighlightedIndex) {
        opt.classList.add('is-focused');
        opt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        opt.classList.remove('is-focused');
      }
    });
  }

  function validateRegimenField(isTouched = false) {
    if (!profRegimenFeedback) return true;
    const val = profRegimen ? profRegimen.value : '';
    if (!val) {
      if (isTouched) {
        customRegimenContainer?.classList.add('is-invalid');
        profRegimenFeedback.className = 'validation-feedback is-invalid';
        profRegimenFeedback.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Selecciona tu Régimen Fiscal del SAT.</span>
        `;
      }
      return false;
    }
    customRegimenContainer?.classList.remove('is-invalid');
    profRegimenFeedback.className = 'validation-feedback is-valid';
    profRegimenFeedback.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      <span>Régimen Fiscal seleccionado correctamente.</span>
    `;
    return true;
  }

  // --- REAL-TIME FORM VALIDATION ENGINES (RFC, EMAIL, CÓDIGO POSTAL) ---
  function validateRFC(rfc) {
    const clean = (rfc || '').trim().toUpperCase();
    if (!clean) {
      return { valid: false, message: 'El RFC es obligatorio para emitir tus facturas.' };
    }
    // Generic SAT RFCs
    if (clean === 'XAXX010101000' || clean === 'XEXX010101000') {
      return { valid: true, type: 'GENERICO', message: 'RFC Genérico del SAT reconocido.' };
    }
    // Persona Moral: 12 caracteres (3 letras + 6 números de fecha + 3 homoclave)
    if (clean.length === 12) {
      const moralRegex = /^[A-Z&Ñ]{3}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
      if (moralRegex.test(clean)) {
        return { valid: true, type: 'MORAL', message: '✓ Persona Moral válida ante el SAT (12 caracteres).' };
      }
      return { valid: false, message: 'Estructura inválida de Persona Moral (3 letras + fecha AAMMDD + 3 homoclave).' };
    }
    // Persona Física: 13 caracteres (4 letras + 6 números de fecha + 3 homoclave)
    if (clean.length === 13) {
      const fisicaRegex = /^[A-Z&Ñ]{4}(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
      if (fisicaRegex.test(clean)) {
        return { valid: true, type: 'FISICA', message: '✓ Persona Física válida ante el SAT (13 caracteres).' };
      }
      return { valid: false, message: 'Estructura inválida de Persona Física (4 letras + fecha AAMMDD + 3 homoclave).' };
    }
    return {
      valid: false,
      message: `Longitud actual: ${clean.length} car. Debe tener 12 (moral) o 13 caracteres (física).`
    };
  }

  function validateEmail(email) {
    const clean = (email || '').trim();
    if (!clean) {
      return { valid: false, message: 'El correo electrónico es obligatorio para recibir tus facturas.' };
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(clean)) {
      return { valid: false, message: 'Ingresa un correo electrónico válido (ej. usuario@dominio.com).' };
    }
    return { valid: true, message: '✓ Correo electrónico válido.' };
  }

  function validatePostalCode(cp) {
    const clean = (cp || '').trim();
    if (!clean) {
      return { valid: false, message: 'El código postal fiscal es obligatorio.' };
    }
    if (!/^\d{5}$/.test(clean)) {
      return { valid: false, message: `Código postal incompleto (${clean.length}/5). Debe tener 5 dígitos.` };
    }
    return { valid: true, message: '✓ Código postal fiscal válido (5 dígitos).' };
  }

  function setFieldValidationUI(inputEl, feedbackEl, result, isTouched) {
    if (!feedbackEl || !inputEl) return;
    if (!isTouched && (!inputEl.value || !inputEl.value.trim())) {
      inputEl.classList.remove('is-valid', 'is-invalid');
      feedbackEl.className = 'validation-feedback';
      feedbackEl.innerHTML = '';
      return;
    }

    if (result.valid) {
      inputEl.classList.remove('is-invalid');
      inputEl.classList.add('is-valid');
      feedbackEl.className = 'validation-feedback is-valid';
      feedbackEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${escapeHtml(result.message)}</span>
      `;
    } else {
      inputEl.classList.remove('is-valid');
      inputEl.classList.add('is-invalid');
      feedbackEl.className = 'validation-feedback is-invalid';
      feedbackEl.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${escapeHtml(result.message)}</span>
      `;
    }
  }

  async function loadSupportedStations() {
    try {
      const res = await fetch('/api/stations');
      const data = await res.json();
      if (data.success && Array.isArray(data.stations)) {
        supportedStations = data.stations;
        renderStations(supportedStations);
      }
    } catch (err) {
      console.warn('Error loading stations:', err);
    }
  }

  function renderStations(stations) {
    if (!stationsGrid) return;
    stationsGrid.innerHTML = '';
    for (const st of stations) {
      const card = document.createElement('div');
      card.className = 'station-card';
      card.innerHTML = `
        <div class="station-logo">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 22V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17"/><path d="M15 11h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L20.5 6.5"/><rect x="6" y="6" width="6" height="5" rx="1"/></svg>
        </div>
        <div class="station-details">
          <h4>
            ${escapeHtml(st.name)}
            <span class="station-badge ${st.status === 'active' ? 'active' : ''}">${escapeHtml(st.statusText || 'Disponible')}</span>
          </h4>
          <p>${escapeHtml(st.description || '')}</p>
        </div>
      `;
      stationsGrid.appendChild(card);
    }
  }

  // --- NAVIGATION & SCREEN ROUTING ---
  function switchScreen(targetScreen) {
    for (const sc of allScreens) {
      sc.classList.add('hidden');
      sc.classList.remove('active');
    }
    targetScreen.classList.remove('hidden');
    targetScreen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setNavTabActive(tabId) {
    navTabsButtons.forEach((btn) => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    if (tabId === 'tab-history') {
      loadHistory();
    }
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    brandLogo?.addEventListener('click', () => {
      const profile = getProfile();
      if (profile && profile.rfc) {
        switchScreen(screenHistory);
        loadHistory();
      } else {
        switchScreen(screenWelcome);
      }
    });

    // Welcome start button
    btnWelcomeStart?.addEventListener('click', () => {
      const profile = getProfile();
      if (profile && profile.rfc) {
        switchScreen(screenHistory);
        loadHistory();
      } else {
        openProfileScreen(false);
      }
    });

    btnHeaderOnboard?.addEventListener('click', () => openProfileScreen(false));
    profilePill?.addEventListener('click', () => openProfileScreen(true));
    profilePill?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openProfileScreen(true);
      }
    });
    btnEditProfile?.addEventListener('click', (e) => {
      e.stopPropagation();
      openProfileScreen(true);
    });

    btnCancelProfile?.addEventListener('click', () => {
      const profile = getProfile();
      if (profile && profile.rfc) {
        switchScreen(screenHistory);
        loadHistory();
      } else {
        switchScreen(screenWelcome);
      }
    });

    // Initialize custom accessible searchable select for Régimen Fiscal
    initCustomRegimenSelect();

    // Real-time RFC input sanitization & validation
    profRfc?.addEventListener('input', () => {
      profRfc.value = profRfc.value.toUpperCase().replace(/[^A-Z0-9&Ñ]/g, '').slice(0, 13);
      const res = validateRFC(profRfc.value);
      setFieldValidationUI(profRfc, profRfcFeedback, res, true);

      // Intelligent filter suggestion based on RFC type
      if (res.valid) {
        if (res.type === 'MORAL' && activeRegimenFilter !== 'MORAL') {
          chipFilterMoral?.click();
        } else if (res.type === 'FISICA' && activeRegimenFilter !== 'FISICA') {
          chipFilterFisica?.click();
        }
      }
    });

    profRfc?.addEventListener('blur', () => {
      const res = validateRFC(profRfc.value);
      setFieldValidationUI(profRfc, profRfcFeedback, res, true);
    });

    // Real-time Email validation
    let emailTouched = false;
    profEmail?.addEventListener('input', () => {
      if (emailTouched) {
        const res = validateEmail(profEmail.value);
        setFieldValidationUI(profEmail, profEmailFeedback, res, true);
      }
    });
    profEmail?.addEventListener('blur', () => {
      emailTouched = true;
      const res = validateEmail(profEmail.value);
      setFieldValidationUI(profEmail, profEmailFeedback, res, true);
    });

    // Real-time Código Postal validation
    let cpTouched = false;
    profCp?.addEventListener('input', () => {
      profCp.value = profCp.value.replace(/\D/g, '').slice(0, 5);
      if (cpTouched || profCp.value.length === 5) {
        const res = validatePostalCode(profCp.value);
        setFieldValidationUI(profCp, profCpFeedback, res, true);
      }
    });
    profCp?.addEventListener('blur', () => {
      cpTouched = true;
      const res = validatePostalCode(profCp.value);
      setFieldValidationUI(profCp, profCpFeedback, res, true);
    });

    // Razón Social validation on blur
    profRazon?.addEventListener('blur', () => {
      if (!profRazon.value.trim()) {
        profRazon.classList.add('is-invalid');
        if (profRazonFeedback) {
          profRazonFeedback.className = 'validation-feedback is-invalid';
          profRazonFeedback.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Ingresa tu Razón Social o Nombre Completo.</span>
          `;
        }
      } else {
        profRazon.classList.remove('is-invalid');
        profRazon.classList.add('is-valid');
        if (profRazonFeedback) {
          profRazonFeedback.className = 'validation-feedback is-valid';
          profRazonFeedback.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>Razón social completa.</span>
          `;
        }
      }
    });

    // Profile form submission
    profileForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleProfileSubmit();
    });

    btnSaveProfile?.addEventListener('click', (e) => {
      e.preventDefault();
      handleProfileSubmit();
    });

    // Dropzone events
    fileInput?.addEventListener('change', handleFileSelect);

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFilesForScan(e.dataTransfer.files);
      }
    });

    // Demo receipt button
    if (btnLoadDemoReceipt) {
      btnLoadDemoReceipt.addEventListener('click', loadDemoReceipt);
    }

    // Workbench actions
    if (btnAddManualReceipt) {
      btnAddManualReceipt.addEventListener('click', addManualReceiptCard);
    }
    if (btnClearReceipts) {
      btnClearReceipts.addEventListener('click', clearAllReceipts);
    }
    if (btnEnqueueInvoices) {
      btnEnqueueInvoices.addEventListener('click', handleEnqueueInvoices);
    }
    if (btnCancelReview) {
      btnCancelReview.addEventListener('click', clearAllReceipts);
    }

    if (tabBtnData) {
      tabBtnData.addEventListener('click', () => switchReviewTab('pane-data'));
    }
    if (tabBtnImage) {
      tabBtnImage.addEventListener('click', () => switchReviewTab('pane-image'));
    }
    if (btnLoadAnotherReceipt) {
      btnLoadAnotherReceipt.addEventListener('click', triggerLoadAnother);
    }
    if (btnScannedUploadAnother) {
      btnScannedUploadAnother.addEventListener('click', triggerLoadAnother);
    }
    if (btnScannedClear) {
      btnScannedClear.addEventListener('click', clearAllReceipts);
    }

    // History actions & New Ticket workbench
    const openUploadWorkbench = () => {
      if (uploadCard) {
        const workbenchLayout = document.querySelector('.workbench-layout');
        if (workbenchLayout && uploadCard.parentElement !== workbenchLayout) {
          workbenchLayout.prepend(uploadCard);
        }
        uploadCard.classList.remove('hidden');
      }
      if (btnBackToHistory) {
        btnBackToHistory.classList.remove('hidden');
      }
      reviewSection?.classList.add('hidden');
      switchScreen(screenWorkbench);
    };

    btnNewFromHistory?.addEventListener('click', openUploadWorkbench);
    btnMobileNewReceipt?.addEventListener('click', openUploadWorkbench);

    btnBackToHistory?.addEventListener('click', () => {
      switchScreen(screenHistory);
      loadHistory();
    });

    if (btnRefreshHistory) {
      btnRefreshHistory.addEventListener('click', () => {
        loadHistory();
      });
    }

    // Modal & Drawer Interactions
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => closeModal());
    }
    mediaModal?.addEventListener('click', (e) => {
      if (e.target === mediaModal) closeModal();
    });

    // Fullscreen Receipt Viewer Toolbar & Canvas Controls
    btnViewerClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      closeReceiptViewer();
    });

    btnViewerZoomIn?.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomViewer(0.25);
    });

    btnViewerZoomOut?.addEventListener('click', (e) => {
      e.stopPropagation();
      zoomViewer(-0.25);
    });

    btnViewerRotate?.addEventListener('click', (e) => {
      e.stopPropagation();
      rotateViewer();
    });

    btnViewerReset?.addEventListener('click', (e) => {
      e.stopPropagation();
      resetViewerTransform();
    });

    // Panning with Mouse Drag
    if (receiptViewerCanvas) {
      receiptViewerCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isViewerDragging = true;
        viewerDragStartX = e.clientX - viewerPanX;
        viewerDragStartY = e.clientY - viewerPanY;
        receiptViewerCanvas.classList.add('is-dragging');
        receiptViewerStage?.classList.add('no-transition');
      });

      window.addEventListener('mousemove', (e) => {
        if (!isViewerDragging) return;
        viewerPanX = e.clientX - viewerDragStartX;
        viewerPanY = e.clientY - viewerDragStartY;
        updateViewerTransform(false);
      });

      window.addEventListener('mouseup', () => {
        if (isViewerDragging) {
          isViewerDragging = false;
          receiptViewerCanvas.classList.remove('is-dragging');
          receiptViewerStage?.classList.remove('no-transition');
        }
      });

      // Mouse Wheel Zoom
      receiptViewerCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        zoomViewer(delta, true);
      }, { passive: false });

      // Touch Drag for Mobile
      let touchStartX = 0;
      let touchStartY = 0;
      receiptViewerCanvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          isViewerDragging = true;
          touchStartX = e.touches[0].clientX - viewerPanX;
          touchStartY = e.touches[0].clientY - viewerPanY;
          receiptViewerStage?.classList.add('no-transition');
        }
      }, { passive: true });

      receiptViewerCanvas.addEventListener('touchmove', (e) => {
        if (isViewerDragging && e.touches.length === 1) {
          viewerPanX = e.touches[0].clientX - touchStartX;
          viewerPanY = e.touches[0].clientY - touchStartY;
          updateViewerTransform(false);
        }
      }, { passive: true });

      receiptViewerCanvas.addEventListener('touchend', () => {
        isViewerDragging = false;
        receiptViewerStage?.classList.remove('no-transition');
      });

      // Double Click / Double Tap to toggle zoom
      receiptViewerCanvas.addEventListener('dblclick', (e) => {
        if (e.target.closest('.viewer-toolbar') || e.target.closest('.receipt-viewer-topbar')) return;
        if (viewerScale > 1.2) {
          resetViewerTransform();
        } else {
          viewerScale = 2.0;
          updateViewerTransform(true);
        }
      });
    }

    // Keyboard & Back Button handlers
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (receiptViewerOverlay && !receiptViewerOverlay.classList.contains('hidden')) {
          closeReceiptViewer();
        } else if (mediaModal && !mediaModal.classList.contains('hidden')) {
          closeModal();
        }
      }
    });

    window.addEventListener('popstate', () => {
      if (receiptViewerOverlay && !receiptViewerOverlay.classList.contains('hidden')) {
        closeReceiptViewer(false);
      } else if (mediaModal && !mediaModal.classList.contains('hidden')) {
        closeModal(false);
      }
    });

    // Mobile pull-down to dismiss drawer
    const drawerHandleBar = document.getElementById('drawer-handle-bar');
    const modalCard = document.getElementById('modal-card');
    let touchStartY = 0;
    let touchCurrentY = 0;
    let isDraggingDrawer = false;

    function onTouchStart(e) {
      if (window.innerWidth > 768) return;
      touchStartY = e.touches[0].clientY;
      touchCurrentY = touchStartY;
      isDraggingDrawer = true;
      if (modalCard) modalCard.style.transition = 'none';
    }

    function onTouchMove(e) {
      if (!isDraggingDrawer || !modalCard) return;
      touchCurrentY = e.touches[0].clientY;
      const diffY = touchCurrentY - touchStartY;
      if (diffY > 0) {
        modalCard.style.transform = `translateY(${diffY}px)`;
      }
    }

    function onTouchEnd() {
      if (!isDraggingDrawer || !modalCard) return;
      isDraggingDrawer = false;
      const diffY = touchCurrentY - touchStartY;
      modalCard.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      if (diffY > 85) {
        modalCard.style.transform = 'translateY(100%)';
        setTimeout(() => {
          closeModal();
          modalCard.style.transform = '';
        }, 220);
      } else {
        modalCard.style.transform = 'translateY(0)';
      }
    }

    if (drawerHandleBar) {
      drawerHandleBar.addEventListener('touchstart', onTouchStart, { passive: true });
      drawerHandleBar.addEventListener('touchmove', onTouchMove, { passive: true });
      drawerHandleBar.addEventListener('touchend', onTouchEnd);
    }
    if (modalCard) {
      modalCard.addEventListener('touchstart', (e) => {
        const rect = modalCard.getBoundingClientRect();
        if (e.touches[0].clientY - rect.top < 65) {
          onTouchStart(e);
        }
      }, { passive: true });
      modalCard.addEventListener('touchmove', onTouchMove, { passive: true });
      modalCard.addEventListener('touchend', onTouchEnd);
    }

    // Localhost test profile loader
    const btnLoadTestProfile = document.getElementById('btn-load-test-profile');
    if (btnLoadTestProfile) {
      btnLoadTestProfile.addEventListener('click', () => {
        profRfc.value = 'MADR600405BK1';
        profRazon.value = 'REYNOL MARTINEZ DIAZ';
        profEmail.value = 'martinezdiazreynol@gmail.com';
        profCp.value = '77536';
        if (profRegimen) {
          profRegimen.value = '625';
          profRegimen.dispatchEvent(new Event('change'));
        }
        syncCustomRegimenFromValue('625');
        if (profUso?.querySelector('option[value="G03"]')) {
          profUso.value = 'G03';
        }

        // Trigger real-time visual validation states
        setFieldValidationUI(profRfc, profRfcFeedback, validateRFC(profRfc.value), true);
        setFieldValidationUI(profEmail, profEmailFeedback, validateEmail(profEmail.value), true);
        setFieldValidationUI(profCp, profCpFeedback, validatePostalCode(profCp.value), true);
        if (profRazon) {
          profRazon.classList.remove('is-invalid');
          profRazon.classList.add('is-valid');
          if (profRazonFeedback) {
            profRazonFeedback.className = 'validation-feedback is-valid';
            profRazonFeedback.innerHTML = `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Razón social completa.</span>
            `;
          }
        }
        customRegimenContainer?.classList.remove('is-invalid');
        validateRegimenField(true);
        showToast('Datos de prueba de REYNOL cargados correctamente.', 'info');
      });
    }
  }

  function checkDevEnvironment() {
    const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) ||
                    window.location.hostname.endsWith('.local');
    const devContainer = document.getElementById('dev-profile-container');
    if (isLocal && devContainer) {
      devContainer.classList.remove('hidden');
    }
  }

  // --- PROFILE LOGIC ---
  function openProfileScreen(isEditing) {
    switchScreen(screenProfile);

    // Reset validation feedback states
    [profRfc, profRazon, profEmail, profCp].forEach(el => {
      el?.classList.remove('is-valid', 'is-invalid');
    });
    [profRfcFeedback, profRazonFeedback, profEmailFeedback, profCpFeedback, profRegimenFeedback, profUsoFeedback].forEach(el => {
      if (el) { el.className = 'validation-feedback'; el.innerHTML = ''; }
    });
    customRegimenContainer?.classList.remove('is-invalid');

    if (isEditing) {
      const profile = getProfile() || {};
      profRfc.value = profile.rfc || '';
      profRazon.value = profile.razonSocial || '';
      profEmail.value = profile.email || '';
      profCp.value = profile.codigoPostal || '';
      if (profile.regimenFiscal && profRegimen) {
        profRegimen.value = profile.regimenFiscal;
        syncCustomRegimenFromValue(profile.regimenFiscal);
      } else {
        clearRegimenSelection();
      }
      if (profile.usoCfdi && profUso) profUso.value = profile.usoCfdi;
      btnCancelProfile.style.display = 'inline-flex';

      // Pre-evaluate visual validation for existing fields
      if (profRfc.value) setFieldValidationUI(profRfc, profRfcFeedback, validateRFC(profRfc.value), true);
      if (profEmail.value) setFieldValidationUI(profEmail, profEmailFeedback, validateEmail(profEmail.value), true);
      if (profCp.value) setFieldValidationUI(profCp, profCpFeedback, validatePostalCode(profCp.value), true);
      if (profRegimen?.value) validateRegimenField(false);
    } else {
      btnCancelProfile.style.display = 'none';
      profileForm.reset();
      clearRegimenSelection();
      // Default to common values
      if (profUso?.querySelector('option[value="G03"]')) {
        profUso.value = 'G03';
      }
    }
  }

  function handleProfileSubmit() {
    const rfc = profRfc.value.trim().toUpperCase();
    const razonSocial = profRazon.value.trim().toUpperCase();
    const email = profEmail.value.trim();
    const codigoPostal = profCp.value.trim();
    const regimenFiscal = profRegimen ? profRegimen.value : '';
    const usoCfdi = profUso ? profUso.value : '';

    // 1. Strict RFC Validation
    const rfcResult = validateRFC(rfc);
    setFieldValidationUI(profRfc, profRfcFeedback, rfcResult, true);
    if (!rfcResult.valid) {
      showToast(rfcResult.message, 'error');
      profRfc.focus();
      return;
    }

    // 2. Razón Social Validation
    if (!razonSocial) {
      profRazon?.classList.add('is-invalid');
      if (profRazonFeedback) {
        profRazonFeedback.className = 'validation-feedback is-invalid';
        profRazonFeedback.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Ingresa tu Razón Social o Nombre Completo.</span>
        `;
      }
      showToast('Ingresa tu Razón Social o Nombre Completo tal como aparece en tu Constancia Fiscal.', 'error');
      profRazon?.focus();
      return;
    }

    // 3. Strict Email Validation
    const emailResult = validateEmail(email);
    setFieldValidationUI(profEmail, profEmailFeedback, emailResult, true);
    if (!emailResult.valid) {
      showToast(emailResult.message, 'error');
      profEmail.focus();
      return;
    }

    // 4. Strict Código Postal Validation
    const cpResult = validatePostalCode(codigoPostal);
    setFieldValidationUI(profCp, profCpFeedback, cpResult, true);
    if (!cpResult.valid) {
      showToast(cpResult.message, 'error');
      profCp.focus();
      return;
    }

    // 5. Régimen Fiscal Selection
    if (!regimenFiscal) {
      customRegimenContainer?.classList.add('is-invalid');
      validateRegimenField(true);
      showToast('Por favor selecciona tu Régimen Fiscal del SAT utilizando el buscador.', 'error');
      openRegimenDropdown();
      return;
    } else {
      customRegimenContainer?.classList.remove('is-invalid');
    }

    // 6. Uso de CFDI Selection
    if (!usoCfdi) {
      showToast('Por favor selecciona el Uso de CFDI preferente para tus comprobantes.', 'error');
      profUso.focus();
      return;
    }

    const profileData = {
      rfc,
      razonSocial,
      email,
      emailConfirm: email,
      codigoPostal,
      regimenFiscal,
      usoCfdi,
      formaPago: '2', // Default: Tarjeta
    };

    saveProfile(profileData);
    switchScreen(screenHistory);
    loadHistory();
  }

  // --- RECEIPT SCANNING (OCR ON-THE-FLY) ---
  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFilesForScan(e.target.files);
      fileInput.value = ''; // Reset input
    }
  }

  // --- FULLSCREEN SCANNER OVERLAY ---
  function showScanner(imageSrc, statusMsg = 'Escaneando ticket con IA...') {
    if (scannerReceiptImg && imageSrc) {
      scannerReceiptImg.src = imageSrc;
    }
    if (scannerStatusText && statusMsg) {
      scannerStatusText.textContent = statusMsg;
    }
    if (scannerOverlay) {
      scannerOverlay.classList.remove('hidden');
    }
  }

  function hideScanner() {
    if (scannerOverlay) {
      scannerOverlay.classList.add('hidden');
    }
  }

  // --- REVIEW TABS SWITCHER ---
  function switchReviewTab(targetPaneId) {
    if (targetPaneId === 'pane-data') {
      tabBtnData?.classList.add('active');
      tabBtnImage?.classList.remove('active');
      paneData?.classList.remove('hidden');
      paneImage?.classList.add('hidden');
    } else {
      tabBtnData?.classList.remove('active');
      tabBtnImage?.classList.add('active');
      paneData?.classList.add('hidden');
      paneImage?.classList.remove('hidden');

      // Update fullwidth scanned image
      const firstReceipt = currentScannedReceipts[0];
      if (fullwidthScannedImg && firstReceipt) {
        if (firstReceipt.previewUrl) {
          fullwidthScannedImg.src = firstReceipt.previewUrl;
          fullwidthScannedImg.onclick = () => window.viewMedia(firstReceipt.previewUrl, 'Recibo Escaneado');
        } else {
          fullwidthScannedImg.src = '';
        }
      }
    }
  }

  function triggerLoadAnother() {
    fileInput.click();
  }

  // --- RECEIPT SCANNING (OCR ON-THE-FLY) ---
  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFilesForScan(e.target.files);
      fileInput.value = ''; // Reset input
    }
  }

  async function uploadFilesForScan(fileList) {
    if (!fileList || fileList.length === 0) return;

    let initialPreviewUrl = null;
    try {
      initialPreviewUrl = URL.createObjectURL(fileList[0]);
    } catch {}

    // Show fullscreen scanner overlay with sweeping laser bar
    navTabs?.classList.add('hidden');
    showScanner(initialPreviewUrl, 'Escaneando ticket con Inteligencia Artificial...');

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('receipts', fileList[i]);
    }
    const currentProfile = getProfile();
    if (currentProfile && currentProfile.rfc) {
      formData.append('rfc', currentProfile.rfc);
    }

    try {
      const res = await fetch('/api/receipts/scan', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      hideScanner();

      if (data.success && Array.isArray(data.results)) {
        currentScannedReceipts = []; // Replace with fresh scanned ticket
        for (let i = 0; i < data.results.length; i++) {
          const item = data.results[i];
          const fileObj = fileList[i];
          let pUrl = initialPreviewUrl;
          if (fileObj && !pUrl) {
            try {
              pUrl = URL.createObjectURL(fileObj);
            } catch {}
          }

          const serverReceiptImg = item.receipt?.receiptImageUrl || item.receiptImageUrl;
          if (item.success && item.receipt) {
            currentScannedReceipts.push({
              ...item.receipt,
              previewUrl: serverReceiptImg || pUrl,
              receiptImageUrl: serverReceiptImg || pUrl,
            });
          } else {
            currentScannedReceipts.push({
              gasStation: 'GOGAS',
              stationNumber: '',
              trackingNumber: '',
              amount: 0,
              date: new Date().toISOString().split('T')[0],
              paymentMethod: 'TARJETA DE CRÉDITO',
              billingUrl: 'https://www.facturasgas.com',
              previewUrl: serverReceiptImg || pUrl,
              receiptImageUrl: serverReceiptImg || pUrl,
            });
          }
        }

        // Default to Tab 1 (Datos Extraídos)
        switchReviewTab('pane-data');
        await ensureUserHistoryTickets();
        renderReviewCards();
        const hasDups = currentScannedReceipts.some((r) => isTicketDuplicate(r.trackingNumber));
        if (hasDups) {
          showToast('Atención: Uno o más tickets ya se encuentran en tu historial.', 'error');
        } else {
          showToast('Datos fiscales extraídos listos para revisión.', 'success');
        }
      } else {
        if (currentScannedReceipts.length === 0) {
          const profile = getProfile();
          if (profile && profile.rfc) navTabs?.classList.remove('hidden');
        }
        showToast(data.error || 'No se pudieron analizar los tickets seleccionados.', 'error');
      }
    } catch (err) {
      hideScanner();
      if (currentScannedReceipts.length === 0) {
        const profile = getProfile();
        if (profile && profile.rfc) navTabs?.classList.remove('hidden');
      }
      showToast(`Error al escanear los tickets: ${err.message}`, 'error');
    }
  }

  async function loadDemoReceipt() {
    const demoImgUrl = '/fixtures/receipt_sample.png';
    navTabs?.classList.add('hidden');
    showScanner(demoImgUrl, 'Analizando ticket de muestra con IA...');

    try {
      const blobRes = await fetch(demoImgUrl);
      const blob = await blobRes.blob();
      const file = new File([blob], 'receipt_sample.png', { type: 'image/png' });

      // Pass along blob
      const formData = new FormData();
      formData.append('receipts', file);
      const currentProfile = getProfile();
      if (currentProfile && currentProfile.rfc) {
        formData.append('rfc', currentProfile.rfc);
      }

      const res = await fetch('/api/receipts/scan', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      hideScanner();

      if (data.success && Array.isArray(data.results)) {
        currentScannedReceipts = [];
        for (let i = 0; i < data.results.length; i++) {
          const item = data.results[i];
          const demoReceiptImg = item.receipt?.receiptImageUrl || item.receiptImageUrl || demoImgUrl;
          if (item.success && item.receipt) {
            currentScannedReceipts.push({
              ...item.receipt,
              previewUrl: demoReceiptImg,
              receiptImageUrl: demoReceiptImg,
            });
          } else {
            currentScannedReceipts.push({
              gasStation: 'GOGAS',
              stationNumber: '12009',
              trackingNumber: '12009037449671666',
              amount: 1090.40,
              date: '21/08/2026 14:57',
              paymentMethod: 'TARJETA DE CRÉDITO',
              billingUrl: 'https://www.facturasgas.com',
              previewUrl: demoReceiptImg,
              receiptImageUrl: demoReceiptImg,
            });
          }
        }
        switchReviewTab('pane-data');
        await ensureUserHistoryTickets();
        renderReviewCards();
        const hasDups = currentScannedReceipts.some((r) => isTicketDuplicate(r.trackingNumber));
        if (hasDups) {
          showToast('Atención: Este ticket ya se encuentra en tu historial.', 'error');
        } else {
          showToast('Ticket de muestra cargado.', 'success');
        }
      } else {
        if (currentScannedReceipts.length === 0) {
          const profile = getProfile();
          if (profile && profile.rfc) navTabs?.classList.remove('hidden');
        }
        showToast(data.error || 'Error al procesar ticket de muestra.', 'error');
      }
    } catch (err) {
      hideScanner();
      if (currentScannedReceipts.length === 0) {
        const profile = getProfile();
        if (profile && profile.rfc) navTabs?.classList.remove('hidden');
      }
      showToast('Error cargando el ticket de muestra: ' + err.message, 'error');
    }
  }

  function addManualReceiptCard() {
    currentScannedReceipts.push({
      gasStation: 'GOGAS',
      stationNumber: '',
      trackingNumber: '',
      amount: 0,
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'TARJETA DE CRÉDITO',
      billingUrl: 'https://www.facturasgas.com',
      previewUrl: null,
    });
    switchReviewTab('pane-data');
    renderReviewCards();
  }

  function clearAllReceipts() {
    currentScannedReceipts = [];
    const profile = getProfile();
    if (profile && profile.rfc) {
      switchScreen(screenHistory);
      loadHistory();
    } else {
      switchScreen(screenWorkbench);
    }
    renderReviewCards();
    showToast('Recibo limpiado.', 'info');
  }

  function getBillingDomain(item) {
    if (!item) return 'facturasgas.com';
    let urlStr = (item.billingUrl || item.portalUrl || '').trim();
    if (!urlStr && item.gasStation && item.gasStation.includes('.')) {
      urlStr = item.gasStation;
    }
    if (urlStr) {
      try {
        if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
          urlStr = 'https://' + urlStr;
        }
        const parsed = new URL(urlStr);
        let hostname = parsed.hostname.toLowerCase();
        if (hostname.startsWith('www.')) {
          hostname = hostname.substring(4);
        }
        if (hostname) return hostname;
      } catch {
        const match = urlStr.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (match && match[1]) return match[1].toLowerCase();
      }
    }
    const station = (item.gasStation || '').toLowerCase();
    if (station.includes('iga') || station.includes('gogas') || station.includes('facturasgas')) {
      return 'facturasgas.com';
    }
    if (station.includes('oxxo')) {
      return 'oxxogas.com';
    }
    if (station.includes('petro')) {
      return 'petro-7.com.mx';
    }
    if (station.includes('hidrosina')) {
      return 'hidrosina.com.mx';
    }
    return item.gasStation || 'facturasgas.com';
  }

  function isTicketDuplicate(trackingNumber) {
    if (!trackingNumber) return false;
    const clean = String(trackingNumber).trim().toUpperCase();
    if (!clean) return false;
    return Boolean(window.userHistoryTickets && window.userHistoryTickets.has(clean));
  }

  async function ensureUserHistoryTickets() {
    const profile = getProfile();
    if (!profile || !profile.rfc) return window.userHistoryTickets || new Set();
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(profile.rfc)}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.history)) {
        window.userHistoryTickets = new Set(
          data.history
            .map((item) => (item.trackingNumber || '').trim().toUpperCase())
            .filter((t) => t.length > 0)
        );
      }
    } catch (e) {
      console.warn('Could not fetch history for duplicate check:', e);
    }
    return window.userHistoryTickets || new Set();
  }

  function updateDuplicateValidation() {
    let hasAnyDuplicates = false;
    const cards = receiptsList ? receiptsList.querySelectorAll('.receipt-card') : [];

    currentScannedReceipts.forEach((receipt, index) => {
      const isDup = isTicketDuplicate(receipt.trackingNumber);
      if (isDup) hasAnyDuplicates = true;

      const card = cards[index];
      if (card) {
        card.classList.toggle('card-duplicate', isDup);
        const trkInput = card.querySelector('[data-field="trackingNumber"]');
        if (trkInput) {
          trkInput.classList.toggle('input-duplicate', isDup);
        }
        let banner = card.querySelector('.duplicate-warning-banner');
        if (isDup && !banner) {
          banner = document.createElement('div');
          banner.className = 'duplicate-warning-banner';
          banner.innerHTML = `
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span><strong>Ticket ya registrado:</strong> Este número de rastreo ya existe en tu historial. Elimínalo para continuar.</span>
          `;
          const header = card.querySelector('.receipt-card-header');
          if (header) {
            header.insertAdjacentElement('afterend', banner);
          } else {
            card.prepend(banner);
          }
        } else if (!isDup && banner) {
          banner.remove();
        }
      }
    });

    if (btnEnqueueInvoices) {
      if (hasAnyDuplicates) {
        btnEnqueueInvoices.disabled = true;
        btnEnqueueInvoices.setAttribute('disabled', 'true');
        btnEnqueueInvoices.title = 'No puedes avanzar: contiene tickets que ya están en tu historial.';
      } else {
        btnEnqueueInvoices.disabled = false;
        btnEnqueueInvoices.removeAttribute('disabled');
        btnEnqueueInvoices.title = '';
      }
    }
  }

  function renderReviewCards() {
    if (currentScannedReceipts.length === 0) {
      reviewSection?.classList.add('hidden');
      uploadCard?.classList.remove('hidden');
      const profile = getProfile();
      if (profile && profile.rfc) {
        navTabs?.classList.remove('hidden');
        switchScreen(screenHistory);
        loadHistory();
      } else {
        switchScreen(screenWorkbench);
      }
      return;
    }

    // Ensure uploadCard is restored to workbenchLayout if loaned to historyContent
    const workbenchLayout = document.querySelector('.workbench-layout');
    if (uploadCard && workbenchLayout && uploadCard.parentElement !== workbenchLayout) {
      workbenchLayout.prepend(uploadCard);
    }

    // Switch screen to workbench so reviewSection and its tabs are visible!
    switchScreen(screenWorkbench);

    uploadCard?.classList.add('hidden');
    navTabs?.classList.add('hidden');
    reviewSection?.classList.remove('hidden');
    receiptsList.innerHTML = '';

    let totalAmount = 0;

    // Update fullwidth scanned image
    const firstReceipt = currentScannedReceipts[0];
    if (fullwidthScannedImg && firstReceipt) {
      if (firstReceipt.previewUrl) {
        fullwidthScannedImg.src = firstReceipt.previewUrl;
        fullwidthScannedImg.onclick = () => window.viewMedia(firstReceipt.previewUrl, 'Recibo Escaneado');
      } else {
        fullwidthScannedImg.src = '';
      }
    }

    currentScannedReceipts.forEach((receipt, index) => {
      totalAmount += Number(receipt.amount || 0);

      const isDuplicate = isTicketDuplicate(receipt.trackingNumber);

      const card = document.createElement('div');
      card.className = `receipt-card ${isDuplicate ? 'card-duplicate' : ''}`;
      card.innerHTML = `
        <div class="receipt-card-header">
          <div class="receipt-card-title-group">
            <span class="receipt-index-badge">Ticket #${index + 1}</span>
            <strong>${escapeHtml(getBillingDomain(receipt))}</strong>
          </div>
          <button type="button" class="btn-icon-xs text-danger" title="Eliminar ticket" data-delete-index="${index}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        ${isDuplicate ? `
          <div class="duplicate-warning-banner">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span><strong>Ticket ya registrado:</strong> Este número de rastreo ya existe en tu historial. Elimínalo para continuar.</span>
          </div>
        ` : ''}

        <div class="receipt-card-fields">
          <div class="form-group">
            <label class="form-label">Portal Web de Facturación / Dominio</label>
            <input type="text" class="form-input font-mono" data-field="billingUrl" data-index="${index}" value="${escapeHtml(receipt.billingUrl || getBillingDomain(receipt))}">
          </div>

          <div class="form-group">
            <label class="form-label">No. de Rastreo / Ticket <span class="req">*</span></label>
            <input type="text" class="form-input font-mono font-bold ${isDuplicate ? 'input-duplicate' : ''}" data-field="trackingNumber" data-index="${index}" value="${escapeHtml(receipt.trackingNumber || '')}" placeholder="Código de ticket">
          </div>

          <div class="form-group">
            <label class="form-label">Monto Total ($ MXN) <span class="req">*</span></label>
            <input type="number" step="0.01" class="form-input" data-field="amount" data-index="${index}" value="${receipt.amount || 0}">
          </div>

          <div class="form-group">
            <label class="form-label">Fecha y Hora</label>
            <input type="text" class="form-input" data-field="date" data-index="${index}" value="${escapeHtml(receipt.date || '')}" placeholder="DD/MM/AAAA HH:MM">
          </div>

          <div class="form-group">
            <label class="form-label">No. de Estación</label>
            <input type="text" class="form-input" data-field="stationNumber" data-index="${index}" value="${escapeHtml(receipt.stationNumber || '')}" placeholder="Ej. 12009">
          </div>

          <div class="form-group">
            <label class="form-label">Forma de Pago</label>
            <input type="text" class="form-input" data-field="paymentMethod" data-index="${index}" value="${escapeHtml(receipt.paymentMethod || 'TARJETA DE CRÉDITO')}">
          </div>
        </div>

        <div class="receipt-card-actions">
          <button type="button" class="btn btn-sm btn-ghost text-danger" data-delete-index="${index}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Limpiar este ticket</span>
          </button>
        </div>
      `;

      receiptsList.appendChild(card);
    });

    // Bind inputs to state
    receiptsList.querySelectorAll('input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(input.getAttribute('data-index'), 10);
        const field = input.getAttribute('data-field');
        if (currentScannedReceipts[idx]) {
          currentScannedReceipts[idx][field] = e.target.value;
          if (field === 'amount') {
            recalculateTotal();
          } else if (field === 'trackingNumber') {
            updateDuplicateValidation();
          }
        }
      });
    });

    // Bind delete buttons
    receiptsList.querySelectorAll('[data-delete-index]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.getAttribute('data-delete-index'), 10);
        currentScannedReceipts.splice(idx, 1);
        renderReviewCards();
      });
    });

    if (totalTicketsCount) {
      totalTicketsCount.textContent = `${currentScannedReceipts.length} ticket${currentScannedReceipts.length > 1 ? 's' : ''} listo${currentScannedReceipts.length > 1 ? 's' : ''}`;
    }
    if (totalAmountSum) {
      totalAmountSum.textContent = `Total: $${totalAmount.toFixed(2)} MXN`;
    }

    updateDuplicateValidation();
  }

  function recalculateTotal() {
    if (!totalAmountSum) return;
    let total = 0;
    for (const r of currentScannedReceipts) {
      total += Number(r.amount || 0);
    }
    totalAmountSum.textContent = `Total: $${total.toFixed(2)} MXN`;
  }

  // --- ENQUEUE INVOICE JOBS (BULLMQ) ---
  async function handleEnqueueInvoices() {
    const profile = getProfile();
    if (!profile || !profile.rfc) {
      showToast('Debes configurar tu perfil fiscal antes de generar facturas.', 'error');
      openProfileScreen(false);
      return;
    }

    if (currentScannedReceipts.length === 0) {
      showToast('No hay tickets en la lista para facturar.', 'error');
      return;
    }

    // Ensure latest history is loaded before evaluating
    await ensureUserHistoryTickets();

    // Validate that all tickets have a trackingNumber and no duplicates
    for (let i = 0; i < currentScannedReceipts.length; i++) {
      if (!currentScannedReceipts[i].trackingNumber) {
        showToast(`El ticket #${i + 1} no tiene Número de Rastreo / Ticket. Por favor ingresa el código del ticket.`, 'error');
        return;
      }
      const trk = (currentScannedReceipts[i].trackingNumber || '').trim();
      if (trk && isTicketDuplicate(trk)) {
        showToast(`El ticket "${trk}" ya está en tu historial. Elimínalo para continuar.`, 'error');
        updateDuplicateValidation();
        return;
      }
    }

    btnEnqueueInvoices.disabled = true;
    btnEnqueueInvoices.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div><span>Enviando a la cola...</span>`;

    try {
      const payload = {
        items: currentScannedReceipts.map((r) => ({
          receiptData: r,
          billingProfile: profile,
        })),
        billingProfile: profile,
      };

      const res = await fetch('/api/queue/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      btnEnqueueInvoices.disabled = false;
      btnEnqueueInvoices.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Avanzar y Facturar</span>`;

      if (res.status === 409 || data.duplicateTickets) {
        showToast(data.error || 'Ticket ya registrado en tu historial.', 'error');
        updateDuplicateValidation();
        return;
      }

      if (data.success && Array.isArray(data.jobs)) {
        // Clear current receipts workbench
        currentScannedReceipts = [];
        renderReviewCards();

        // Switch to unified Historial screen and load fresh state from Redis
        switchScreen(screenHistory);
        setNavTabActive('tab-history');
        await loadHistory();
      } else {
        showToast(data.error || 'Error al encolar los procesos.', 'error');
      }
    } catch (err) {
      btnEnqueueInvoices.disabled = false;
      btnEnqueueInvoices.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Avanzar y Facturar</span>`;
      showToast(`Error al conectar con la cola: ${err.message}`, 'error');
    }
  }

  // --- QUEUE MONITORING & NOTIFICATION BADGE ---
  function updateQueueBadge() {
    const pending = redisHistoryItems.filter((j) => j.status === 'waiting' || j.status === 'active');
    if (pending.length > 0) {
      if (historyBadge) {
        historyBadge.textContent = pending.length;
        historyBadge.classList.remove('hidden');
      }
      if (activeJobsCount) {
        activeJobsCount.textContent = `${pending.length} en curso`;
      }
    } else {
      if (historyBadge) historyBadge.classList.add('hidden');
      if (activeJobsCount) {
        activeJobsCount.textContent = `0 en curso`;
      }
    }
  }

  function renderActiveJobs() {
    renderUnifiedHistory();
  }

  // --- UNIFIED HISTORIAL (REDIS SOURCED & MULTI-DEVICE SYNC) ---
  async function loadHistory() {
    const profile = getProfile();
    if (!profile || !profile.rfc) {
      if (historySubtitle) historySubtitle.textContent = 'Configura tu perfil fiscal para consultar tu historial.';
      if (historyContent) {
        historyContent.innerHTML = `
          <div class="history-empty">
            <div class="empty-icon-wrap">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <p style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.35rem;">Perfil fiscal requerido</p>
            <p>Configura tus datos fiscales para consultar y gestionar tus facturas.</p>
          </div>
        `;
      }
      return;
    }

    if (historySubtitle) {
      historySubtitle.textContent = `Mostrando facturas registradas para RFC: ${profile.rfc}`;
    }

    try {
      const res = await fetch(`/api/history/${encodeURIComponent(profile.rfc)}`);
      const data = await res.json();

      if (data.success && Array.isArray(data.history)) {
        redisHistoryItems = data.history;
      } else {
        redisHistoryItems = [];
      }
      window.userHistoryTickets = new Set(
        redisHistoryItems
          .map((item) => (item.trackingNumber || '').trim().toUpperCase())
          .filter((t) => t.length > 0)
      );
      renderUnifiedHistory();

      // Check if any job is currently in progress across any device
      const hasPending = redisHistoryItems.some((item) => item.status === 'waiting' || item.status === 'active');
      if (hasPending) {
        if (!historyPollingTimer) {
          historyPollingTimer = setInterval(loadHistory, 2500);
        }
      } else {
        if (historyPollingTimer) {
          clearInterval(historyPollingTimer);
          historyPollingTimer = null;
        }
      }
    } catch (err) {
      console.warn('Error fetching history:', err);
      renderUnifiedHistory();
    }
  }

  function renderUnifiedHistory() {
    if (!historyContent) return;

    updateQueueBadge();

    // Work directly with Redis-backed history and deduplicate defensively
    const seenMap = new Map();
    for (const item of redisHistoryItems) {
      const trk = (item.trackingNumber && item.trackingNumber !== '---')
        ? `trk_${String(item.trackingNumber).trim().toUpperCase()}`
        : null;
      const job = item.jobId ? `job_${String(item.jobId)}` : null;
      const id = item.id ? `id_${String(item.id).replace(/^hist_/, '')}` : null;

      let matchedKey = null;
      for (const [key, existing] of seenMap.entries()) {
        const trkMatch = trk && existing.trackingNumber && existing.trackingNumber !== '---' &&
          String(existing.trackingNumber).trim().toUpperCase() === String(item.trackingNumber).trim().toUpperCase();
        const jobMatch = (job && existing.jobId && String(existing.jobId) === String(item.jobId)) ||
          (item.jobId && existing.id && (existing.id === String(item.jobId) || existing.id === `hist_${item.jobId}`));
        const idMatch = (id && existing.id && (existing.id === item.id || existing.id === `hist_${item.jobId}` || item.id === `hist_${existing.jobId}`));

        if (trkMatch || jobMatch || idMatch) {
          matchedKey = key;
          break;
        }
      }

      const primaryKey = matchedKey || trk || job || id || `item_${Math.random()}`;

      if (matchedKey) {
        const existing = seenMap.get(matchedKey);
        const statusPriority = { completed: 4, failed: 3, active: 2, waiting: 1, dry_run: 4 };
        const preferredStatus = (statusPriority[item.status] || 0) >= (statusPriority[existing.status] || 0)
          ? item.status
          : existing.status;

        seenMap.set(matchedKey, {
          ...existing,
          ...item,
          status: preferredStatus,
          progress: Math.max(existing.progress || 0, item.progress || 0),
        });
      } else {
        seenMap.set(primaryKey, item);
      }
    }

    const unifiedList = Array.from(seenMap.values());

    // Sort: pending jobs (waiting/active) first, then by timestamp descending
    unifiedList.sort((a, b) => {
      const aPending = a.status === 'waiting' || a.status === 'active';
      const bPending = b.status === 'waiting' || b.status === 'active';
      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;

      const timeA = new Date(a.timestamp || a.date || 0).getTime();
      const timeB = new Date(b.timestamp || b.date || 0).getTime();
      return timeB - timeA;
    });

    if (unifiedList.length === 0) {
      historyContent.innerHTML = '';
      if (uploadCard) {
        uploadCard.classList.remove('hidden');
        if (btnBackToHistory) btnBackToHistory.classList.add('hidden');
        historyContent.appendChild(uploadCard);
      }
      if (historySubtitle) {
        historySubtitle.textContent = 'Aún no tienes facturas registradas. Sube tu primer ticket para comenzar:';
      }
      if (btnNewFromHistory) {
        btnNewFromHistory.classList.add('hidden');
      }
      if (mobileHistoryBar) {
        mobileHistoryBar.classList.add('hidden');
      }
      return;
    }

    // When items exist:
    if (btnNewFromHistory) {
      btnNewFromHistory.classList.remove('hidden');
    }
    if (mobileHistoryBar) {
      mobileHistoryBar.classList.remove('hidden');
    }
    if (historySubtitle) {
      const profile = getProfile();
      historySubtitle.textContent = `Mostrando facturas registradas para RFC: ${profile?.rfc || ''}`;
    }

    // Move uploadCard back to workbenchLayout if it was attached to historyContent
    if (uploadCard && uploadCard.parentElement === historyContent) {
      const workbenchLayout = document.querySelector('.workbench-layout');
      if (workbenchLayout) {
        workbenchLayout.prepend(uploadCard);
      }
      uploadCard.classList.add('hidden');
    }

    let rowsHtml = '<div class="history-rows-list">';
    unifiedList.forEach((item) => {
      rowsHtml += createHistoryRowHtml(item);
    });
    rowsHtml += '</div>';

    historyContent.innerHTML = rowsHtml;

    // Row click: open full-page receipt viewer
    historyContent.querySelectorAll('.history-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) {
          return;
        }
        const entryId = row.getAttribute('data-entry-id');
        const jobId = row.getAttribute('data-job-id');
        const item = unifiedList.find(
          (h) => (entryId && h.id === entryId) || (jobId && h.jobId === jobId) || (jobId && `hist_${h.jobId}` === entryId)
        );
        if (item) {
          openReceiptViewer(item);
        }
      });
    });

    // Cancel in-progress buttons
    historyContent.querySelectorAll('.btn-cancel-history').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const entryId = btn.getAttribute('data-entry-id');
        const jobId = btn.getAttribute('data-job-id');
        await handleDeleteHistoryItem(entryId, jobId, true);
      });
    });

    // Delete completed/failed buttons
    historyContent.querySelectorAll('.btn-delete-history').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const entryId = btn.getAttribute('data-entry-id');
        const jobId = btn.getAttribute('data-job-id');
        await handleDeleteHistoryItem(entryId, jobId, false);
      });
    });
  }

  function createHistoryRowHtml(item) {
    const isWaiting = item.status === 'waiting';
    const isActive = item.status === 'active';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';
    const isDryRun = item.status === 'dry_run';
    const isPending = isWaiting || isActive;

    let statusClass = 'waiting';
    let statusLabel = 'En Cola';
    let statusIcon = '<span class="pulse-beacon-dot"></span>';

    if (isActive) {
      statusClass = 'active';
      statusLabel = 'En Proceso';
      statusIcon = '<div class="spinner-xs"></div>';
    } else if (isCompleted) {
      statusClass = 'completed';
      statusLabel = 'Completada';
      statusIcon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (isFailed) {
      statusClass = 'failed';
      statusLabel = 'Fallida';
      statusIcon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else if (isDryRun) {
      statusClass = 'verified';
      statusLabel = 'Verificada';
      statusIcon = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
    }

    const dateFormatted = item.timestamp
      ? new Date(item.timestamp).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
      : item.date || 'Reciente';

    const progressVal = item.progress || (isCompleted ? 100 : isActive ? 50 : 15);

    return `
      <div class="history-row status-${statusClass}" id="history-row-${escapeHtml(item.id || item.jobId)}" data-entry-id="${escapeHtml(item.id || '')}" data-job-id="${escapeHtml(item.jobId || '')}" title="Haz clic para ver el ticket completo">
        <div class="history-row-top">
          <div class="history-station-info">
            <div class="history-station-icon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 22v-8a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v8"/><path d="M15 22v-5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5"/><path d="M3 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M13 2h4a2 2 0 0 1 2 2v7"/><path d="M4 22h16"/></svg>
            </div>
            <div class="history-station-text">
              <strong class="history-station-name">${escapeHtml(getBillingDomain(item))}</strong>
              <span class="history-ticket-code font-mono">${escapeHtml(item.trackingNumber || item.jobId || '---')}</span>
            </div>
          </div>
          <div class="history-status-wrap">
            <span class="history-status-pill pill-${statusClass}">
              ${statusIcon}
              <span>${statusLabel}</span>
            </span>
          </div>
        </div>

        ${isPending ? `
          <div class="history-progress-wrap">
            <div class="history-progress-bar">
              <div class="history-progress-fill" style="width: ${progressVal}%;"></div>
            </div>
            <div class="history-progress-text">
              <span>${isActive ? 'Navegando y facturando en portal...' : 'Esperando turno en cola...'}</span>
              <span>${progressVal}%</span>
            </div>
          </div>
        ` : ''}

        <div class="history-row-bottom">
          <div class="history-meta-group">
            <span class="history-date">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>${dateFormatted}</span>
            </span>
            <span class="history-amount-pill">
              $${Number(item.amount || 0).toFixed(2)} MXN
            </span>
          </div>

          <div class="history-row-actions">
            ${(item.status === 'completed' || item.pdfUrl) ? `
              <button type="button" class="btn btn-sm btn-outline" onclick="event.stopPropagation(); window.downloadComprobante('${escapeHtml(item.pdfUrl || '')}', '${escapeHtml(item.trackingNumber || '')}', '${escapeHtml(item.id || item.jobId || '')}')" title="Descargar comprobante en PDF">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span>Descargar PDF</span>
              </button>
            ` : ''}
            ${(item.videoUrl && serverConfig.recordVideo) ? `
              <button type="button" class="btn btn-sm btn-outline" onclick="event.stopPropagation(); window.viewMedia('${item.videoUrl}', 'Video ${escapeHtml(item.trackingNumber || '')}', true)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span>Video</span>
              </button>
            ` : ''}
            ${isPending ? `
              <button type="button" class="btn btn-sm btn-cancel-history" data-entry-id="${escapeHtml(item.id || '')}" data-job-id="${escapeHtml(item.jobId || '')}" title="Cancelar proceso y eliminar de la cola">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <span>Cancelar</span>
              </button>
            ` : `
              <button type="button" class="btn-icon-xs text-danger btn-delete-history" data-entry-id="${escapeHtml(item.id || '')}" data-job-id="${escapeHtml(item.jobId || '')}" title="Eliminar del historial">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            `}
          </div>
        </div>

        ${(item.failedReason || item.error || (item.status === 'failed' ? item.message : '')) ? `
          <div class="history-error-banner">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${escapeHtml(item.failedReason || item.error || item.message)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  window.downloadComprobante = function (pdfUrl, trackingNumber, entryId) {
    const url = pdfUrl || `/api/invoices/${encodeURIComponent(trackingNumber || entryId)}/pdf?ticket=${encodeURIComponent(trackingNumber || '')}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `factura_${trackingNumber || 'comprobante'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Iniciando descarga del comprobante PDF...', 'info');
  };

  async function handleDeleteHistoryItem(entryId, jobId, isCancel = false) {
    const profile = getProfile();
    if (!profile || !profile.rfc) return;

    try {
      const idToDelete = entryId || jobId;
      if (idToDelete) {
        await fetch(`/api/history/${encodeURIComponent(idToDelete)}?rfc=${encodeURIComponent(profile.rfc)}`, {
          method: 'DELETE',
        });
      }

      // Remove from redisHistoryItems
      redisHistoryItems = redisHistoryItems.filter((h) =>
        h.id !== idToDelete &&
        h.jobId !== idToDelete &&
        h.id !== entryId &&
        h.jobId !== jobId &&
        `hist_${h.jobId}` !== idToDelete
      );

      // Synchronize window.userHistoryTickets so duplicate validation stays accurate
      window.userHistoryTickets = new Set(
        redisHistoryItems
          .map((item) => (item.trackingNumber || '').trim().toUpperCase())
          .filter((t) => t.length > 0)
      );

      renderUnifiedHistory();
      showToast(isCancel ? 'Proceso cancelado y eliminado del historial.' : 'Factura eliminada del historial.', 'info');
    } catch (err) {
      showToast(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  // --- FULLSCREEN RECEIPT VIEWER (FULL-PAGE, ZOOM, ROTATE, PAN) ---
  function updateViewerTransform(transition = true) {
    if (!receiptViewerStage) return;
    if (transition) {
      receiptViewerStage.classList.remove('no-transition');
    } else {
      receiptViewerStage.classList.add('no-transition');
    }
    receiptViewerStage.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerScale}) rotate(${viewerRotation}deg)`;
    if (viewerZoomLevel) {
      viewerZoomLevel.textContent = `${Math.round(viewerScale * 100)}%`;
    }
  }

  function resetViewerTransform() {
    viewerScale = 1.0;
    viewerRotation = 0;
    viewerPanX = 0;
    viewerPanY = 0;
    updateViewerTransform(true);
  }

  function zoomViewer(delta, animate = true) {
    const newScale = Math.min(Math.max(viewerScale + delta, 0.4), 4.0);
    viewerScale = parseFloat(newScale.toFixed(2));
    updateViewerTransform(animate);
  }

  function rotateViewer() {
    viewerRotation = (viewerRotation + 90) % 360;
    updateViewerTransform(true);
  }

  window.openReceiptViewer = function (item) {
    openReceiptViewer(item);
  };

  function openReceiptViewer(item) {
    const imgUrl = item.receiptImageUrl || item.previewUrl || item.screenshotUrl;
    if (!imgUrl) {
      showToast('No hay imagen o recibo escaneado disponible para este registro.', 'warning');
      return;
    }

    if (receiptViewerTitle) {
      receiptViewerTitle.textContent = getBillingDomain(item) || item.gasStation || 'Recibo de Gasolina';
    }
    if (receiptViewerSubtitle) {
      const parts = [];
      if (item.trackingNumber) parts.push(`Ticket: ${item.trackingNumber}`);
      if (item.amount) parts.push(`$${Number(item.amount).toFixed(2)} MXN`);
      if (item.date) parts.push(item.date);
      receiptViewerSubtitle.textContent = parts.join(' • ') || '---';
    }

    if (receiptViewerImg) {
      receiptViewerImg.src = imgUrl;
    }

    resetViewerTransform();
    receiptViewerOverlay?.classList.remove('hidden');
    document.body.classList.add('viewer-open');

    try {
      window.history.pushState({ receiptViewerOpen: true }, '');
    } catch {}
  }

  function closeReceiptViewer(shouldGoBack = true) {
    if (receiptViewerOverlay?.classList.contains('hidden')) return;
    receiptViewerOverlay?.classList.add('hidden');
    document.body.classList.remove('viewer-open');
    if (receiptViewerImg) receiptViewerImg.src = '';
    resetViewerTransform();

    if (shouldGoBack && window.history.state && window.history.state.receiptViewerOpen) {
      try {
        window.history.back();
      } catch {}
    }
  }

  // --- MODAL VIEWER (SCREENSHOTS & VIDEOS) ---
  window.viewMedia = function (url, title, isVideo = false) {
    modalTitle.textContent = title || 'Comprobante';
    if (isVideo) {
      modalBody.innerHTML = `
        <video controls autoplay loop playsinline style="max-width:100%;max-height:70vh;border-radius:8px;">
          <source src="${url}" type="video/webm">
          Tu navegador no soporta reproducción de video WebM.
        </video>
      `;
    } else {
      modalBody.innerHTML = `
        <img src="${url}" alt="Comprobante" style="max-width:100%;max-height:70vh;border-radius:8px;">
      `;
    }
    mediaModal.classList.remove('hidden');
    try {
      window.history.pushState({ modalOpen: true }, '');
    } catch {}
  };

  function closeModal(shouldGoBack = true) {
    mediaModal.classList.add('hidden');
    modalBody.innerHTML = '';
    const modalCard = document.getElementById('modal-card');
    if (modalCard) modalCard.style.transform = '';
    if (shouldGoBack && window.history.state && window.history.state.modalOpen) {
      try {
        window.history.back();
      } catch {}
    }
  }

  // Helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Toast Notification System
  function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    if (type === 'error') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (type === 'success') {
      iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    }

    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(14px) scale(0.96)';
      setTimeout(() => toast.remove(), 260);
    }, 3000);
  }

  // --- Progressive Web App (PWA) Lifecycle & Install Prompt ---
  function setupPWA() {
    // 1. Register Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[CombusTicket PWA] Service Worker activo con alcance:', registration.scope);
          })
          .catch((err) => {
            console.warn('[CombusTicket PWA] Error al registrar Service Worker:', err);
          });
      });
    }

    // 2. Install Prompt Handler
    let deferredInstallPrompt = null;
    const btnPwaInstall = document.getElementById('btn-pwa-install');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (btnPwaInstall) {
        btnPwaInstall.classList.remove('hidden');
      }
    });

    if (btnPwaInstall) {
      btnPwaInstall.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('CombusTicket se está instalando en tu dispositivo...', 'success');
        }
        deferredInstallPrompt = null;
        btnPwaInstall.classList.add('hidden');
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[CombusTicket PWA] Aplicación instalada con éxito.');
      showToast('¡CombusTicket instalada como App nativa!', 'success');
      if (btnPwaInstall) {
        btnPwaInstall.classList.add('hidden');
      }
    });
  }

  setupPWA();

  // Run app
  init();
});

