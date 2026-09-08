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
  let currentScreen = 'welcome';

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
  const btnMobileCameraFab = document.getElementById('btn-mobile-camera-fab');
  const mobileCameraFabContainer = document.getElementById('mobile-camera-fab-container');
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
  const profilePendingNotice = document.getElementById('profile-pending-notice');
  const profileStepIndicator = document.getElementById('profile-step-indicator');
  const profileCardTitle = document.getElementById('profile-card-title');
  const profileCardSubtitle = document.getElementById('profile-card-subtitle');
  const profileDangerZone = document.getElementById('profile-danger-zone');
  const profileNotificationsZone = document.getElementById('profile-notifications-zone');
  const btnDeleteProfile = document.getElementById('btn-delete-profile');
  const deleteProfileModal = document.getElementById('delete-profile-modal');
  const deleteProfileRfcBadge = document.getElementById('delete-profile-rfc-badge');
  const btnCloseDeleteProfileModal = document.getElementById('btn-close-delete-profile-modal');
  const btnCancelDeleteModal = document.getElementById('btn-cancel-delete-modal');
  const btnConfirmDeleteModal = document.getElementById('btn-confirm-delete-modal');
  let isPendingInvoicing = false;

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

  // Custom Searchable Uso de CFDI Choice
  const customUsoContainer = document.getElementById('custom-uso-container');
  const usoSelectTrigger = document.getElementById('uso-select-trigger');
  const usoSelectPlaceholder = document.getElementById('uso-select-placeholder');
  const usoSelectedValue = document.getElementById('uso-selected-value');
  const usoSelectedCode = document.getElementById('uso-selected-code');
  const usoSelectedDesc = document.getElementById('uso-selected-desc');
  const usoSelectClear = document.getElementById('uso-select-clear');
  const usoSelectDropdown = document.getElementById('uso-select-dropdown');
  const usoSearchInput = document.getElementById('uso-search-input');
  const usoSearchClear = document.getElementById('uso-search-clear');
  const chipUsoAll = document.getElementById('chip-uso-all');
  const chipUsoGastos = document.getElementById('chip-uso-gastos');
  const chipUsoInversiones = document.getElementById('chip-uso-inversiones');
  const chipUsoDeducciones = document.getElementById('chip-uso-deducciones');
  const usoOptionsList = document.getElementById('uso-options-list');
  const usoEmptyState = document.getElementById('uso-empty-state');

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

  // Legal Modal Elements
  const legalModal = document.getElementById('legal-modal');
  const legalModalTitle = document.getElementById('legal-modal-title');
  const btnCloseLegalModal = document.getElementById('btn-close-legal-modal');
  const btnAcceptLegalModal = document.getElementById('btn-accept-legal-modal');
  const btnLegalTerms = document.getElementById('btn-legal-terms');
  const btnLegalPrivacy = document.getElementById('btn-legal-privacy');
  const btnLegalDisclaimer = document.getElementById('btn-legal-disclaimer');

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
      if (profile && profile.rfc && (currentScreen === 'history' || screenHistory?.classList.contains('active'))) {
        loadHistory();
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
            if (data.profile.regimenFiscal) {
              profRegimen.value = data.profile.regimenFiscal;
              syncCustomRegimenFromValue(data.profile.regimenFiscal);
            }
            if (data.profile.usoCfdi) {
              profUso.value = data.profile.usoCfdi;
              syncCustomUsoFromValue(data.profile.usoCfdi);
            }
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
      syncCustomUsoFromValue(profUso.value);
      renderUsoOptions();
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
    document.getElementById('regimen-select-check')?.classList.add('hidden');
    syncCustomRegimenFromValue('');
  }

  function syncCustomRegimenFromValue(code, knownDesc) {
    const checkEl = document.getElementById('regimen-select-check');
    if (!regimenSelectPlaceholder || !regimenSelectedValue) return;

    if (!code) {
      regimenSelectPlaceholder.classList.remove('hidden');
      regimenSelectedValue.classList.add('hidden');
      regimenSelectClear?.classList.add('hidden');
      if (checkEl) checkEl.classList.add('hidden');
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
    if (checkEl) checkEl.classList.remove('hidden');
  }

  function openRegimenDropdown() {
    if (!regimenSelectDropdown) return;
    closeUsoDropdown();
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
    const val = profRegimen ? profRegimen.value : '';
    const checkEl = document.getElementById('regimen-select-check');
    if (!val) {
      if (checkEl) checkEl.classList.add('hidden');
      if (isTouched) {
        customRegimenContainer?.classList.add('is-invalid');
        regimenSelectTrigger?.classList.add('is-invalid');
        if (profRegimenFeedback) {
          profRegimenFeedback.className = 'validation-feedback is-invalid';
          profRegimenFeedback.innerHTML = `<span>Selecciona tu Régimen Fiscal del SAT.</span>`;
        }
      }
      return false;
    }
    customRegimenContainer?.classList.remove('is-invalid');
    regimenSelectTrigger?.classList.remove('is-invalid');
    if (checkEl) checkEl.classList.remove('hidden');
    if (profRegimenFeedback) {
      profRegimenFeedback.className = 'validation-feedback';
      profRegimenFeedback.innerHTML = '';
    }
    return true;
  }

  // --- CUSTOM ACCESSIBLE SEARCHABLE SELECT (COMBOBOX) FOR USO DE CFDI ---
  let activeUsoFilter = 'ALL'; // 'ALL' | 'GASTOS' | 'INVERSIONES' | 'DEDUCCIONES'
  let activeUsoSearch = '';
  let activeUsoHighlightedIndex = -1;

  function initCustomUsoSelect() {
    if (!customUsoContainer || !usoSelectTrigger) return;

    // Trigger open/close
    usoSelectTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUsoDropdown();
    });

    usoSelectTrigger.addEventListener('keydown', handleUsoKeydown);

    // Search input typing
    usoSearchInput?.addEventListener('input', (e) => {
      activeUsoSearch = e.target.value;
      if (usoSearchClear) {
        if (activeUsoSearch.length > 0) {
          usoSearchClear.classList.remove('hidden');
        } else {
          usoSearchClear.classList.add('hidden');
        }
      }
      renderUsoOptions();
    });

    usoSearchClear?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (usoSearchInput) usoSearchInput.value = '';
      activeUsoSearch = '';
      usoSearchClear.classList.add('hidden');
      renderUsoOptions();
      usoSearchInput?.focus();
    });

    // Filter chips
    const usoFilterChips = [chipUsoAll, chipUsoGastos, chipUsoInversiones, chipUsoDeducciones];
    usoFilterChips.forEach((chip) => {
      chip?.addEventListener('click', (e) => {
        e.stopPropagation();
        usoFilterChips.forEach((c) => c?.classList.remove('active'));
        chip.classList.add('active');
        activeUsoFilter = chip.dataset.filter || 'ALL';
        renderUsoOptions();
      });
    });

    // Clear selection
    usoSelectClear?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearUsoSelection();
      validateUsoField(true);
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!customUsoContainer.contains(e.target)) {
        closeUsoDropdown();
      }
    });

    // Sync initial state if profUso already has a value
    if (profUso && profUso.value) {
      syncCustomUsoFromValue(profUso.value);
    }
  }

  function renderUsoOptions() {
    if (!usoOptionsList) return;

    const items = catalogs.usosCfdi?.usos || DEFAULT_SAT_USOS;
    const query = (activeUsoSearch || '').trim().toLowerCase();

    // 1. Filter by category
    let filtered = items.filter((item) => {
      const code = (item.code || item.codigo || '').toUpperCase();
      if (activeUsoFilter === 'GASTOS') {
        return code.startsWith('G');
      }
      if (activeUsoFilter === 'INVERSIONES') {
        return code.startsWith('I');
      }
      if (activeUsoFilter === 'DEDUCCIONES') {
        return code.startsWith('D');
      }
      return true;
    });

    // 2. Filter by search query
    if (query) {
      filtered = filtered.filter((item) => {
        const code = (item.code || item.codigo || '').toLowerCase();
        const desc = (item.description || item.descripcion || '').toLowerCase();
        return code.includes(query) || desc.includes(query);
      });
    }

    usoOptionsList.innerHTML = '';
    activeUsoHighlightedIndex = -1;

    if (filtered.length === 0) {
      usoEmptyState?.classList.remove('hidden');
      return;
    }

    usoEmptyState?.classList.add('hidden');

    filtered.forEach((item, index) => {
      const code = item.code || item.codigo;
      const desc = item.description || item.descripcion;
      const isSelected = profUso && profUso.value === code;
      const isGasolina = item.defaultGasolina || code === 'G03';

      const li = document.createElement('li');
      li.className = `custom-select-option ${isSelected ? 'is-selected' : ''}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      li.dataset.code = code;
      li.dataset.index = index;

      const highlightedDesc = highlightText(desc, query);
      const highlightedCode = highlightText(code, query);

      li.innerHTML = `
        <div class="option-main">
          <span class="regimen-code-tag uso-code-tag">${highlightedCode}</span>
          <span class="option-desc">${highlightedDesc}</span>
        </div>
        <div class="option-meta">
          ${isGasolina ? '<span class="uso-recommended-badge">Recomendado Gasolina</span>' : ''}
          ${isSelected ? '<span class="option-check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}
        </div>
      `;

      li.addEventListener('click', (e) => {
        e.stopPropagation();
        selectUso(code, desc);
        closeUsoDropdown();
      });

      usoOptionsList.appendChild(li);
    });
  }

  function selectUso(code, desc) {
    if (profUso) {
      profUso.value = code;
      profUso.dispatchEvent(new Event('change'));
    }
    syncCustomUsoFromValue(code, desc);
    customUsoContainer?.classList.remove('is-invalid');
    validateUsoField(true);
  }

  function clearUsoSelection() {
    if (profUso) {
      profUso.value = '';
      profUso.dispatchEvent(new Event('change'));
    }
    document.getElementById('uso-select-check')?.classList.add('hidden');
    syncCustomUsoFromValue('');
  }

  function syncCustomUsoFromValue(code, knownDesc) {
    const checkEl = document.getElementById('uso-select-check');
    if (!usoSelectPlaceholder || !usoSelectedValue) return;

    if (!code) {
      usoSelectPlaceholder.classList.remove('hidden');
      usoSelectedValue.classList.add('hidden');
      usoSelectClear?.classList.add('hidden');
      if (checkEl) checkEl.classList.add('hidden');
      return;
    }

    let desc = knownDesc;
    if (!desc) {
      const items = catalogs.usosCfdi?.usos || DEFAULT_SAT_USOS;
      const found = items.find((i) => (i.code || i.codigo) === code);
      desc = found ? (found.description || found.descripcion) : `Uso ${code}`;
    }

    usoSelectPlaceholder.classList.add('hidden');
    usoSelectedValue.classList.remove('hidden');
    if (usoSelectedCode) usoSelectedCode.textContent = code;
    if (usoSelectedDesc) usoSelectedDesc.textContent = desc;
    usoSelectClear?.classList.remove('hidden');
    if (checkEl) checkEl.classList.remove('hidden');
  }

  function openUsoDropdown() {
    if (!usoSelectDropdown) return;
    // Close regimen dropdown if open to avoid overlap
    closeRegimenDropdown();
    customUsoContainer?.classList.add('open');
    usoSelectDropdown.classList.remove('hidden');
    usoSelectTrigger?.setAttribute('aria-expanded', 'true');
    renderUsoOptions();
    setTimeout(() => {
      usoSearchInput?.focus();
    }, 40);
  }

  function closeUsoDropdown() {
    if (!usoSelectDropdown) return;
    customUsoContainer?.classList.remove('open');
    usoSelectDropdown.classList.add('hidden');
    usoSelectTrigger?.setAttribute('aria-expanded', 'false');
    activeUsoHighlightedIndex = -1;
  }

  function toggleUsoDropdown() {
    if (usoSelectDropdown?.classList.contains('hidden')) {
      openUsoDropdown();
    } else {
      closeUsoDropdown();
    }
  }

  function handleUsoKeydown(e) {
    const isDropdownOpen = !usoSelectDropdown?.classList.contains('hidden');

    if (e.key === 'Escape') {
      if (isDropdownOpen) {
        e.preventDefault();
        closeUsoDropdown();
        usoSelectTrigger?.focus();
      }
      return;
    }

    if (!isDropdownOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openUsoDropdown();
      }
      return;
    }

    const options = usoOptionsList?.querySelectorAll('.custom-select-option') || [];
    if (options.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeUsoHighlightedIndex = (activeUsoHighlightedIndex + 1) % options.length;
      updateUsoHighlightedOption(options);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeUsoHighlightedIndex = (activeUsoHighlightedIndex - 1 + options.length) % options.length;
      updateUsoHighlightedOption(options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeUsoHighlightedIndex >= 0 && activeUsoHighlightedIndex < options.length) {
        options[activeUsoHighlightedIndex].click();
      }
    }
  }

  function updateUsoHighlightedOption(options) {
    options.forEach((opt, idx) => {
      if (idx === activeUsoHighlightedIndex) {
        opt.classList.add('is-focused');
        opt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        opt.classList.remove('is-focused');
      }
    });
  }

  function validateUsoField(isTouched = false) {
    const val = profUso ? profUso.value : '';
    const checkEl = document.getElementById('uso-select-check');
    if (!val) {
      if (checkEl) checkEl.classList.add('hidden');
      if (isTouched) {
        customUsoContainer?.classList.add('is-invalid');
        usoSelectTrigger?.classList.add('is-invalid');
        if (profUsoFeedback) {
          profUsoFeedback.className = 'validation-feedback is-invalid';
          profUsoFeedback.innerHTML = `<span>Selecciona el Uso de CFDI para tus facturas.</span>`;
        }
      }
      return false;
    }
    customUsoContainer?.classList.remove('is-invalid');
    usoSelectTrigger?.classList.remove('is-invalid');
    if (checkEl) checkEl.classList.remove('hidden');
    if (profUsoFeedback) {
      profUsoFeedback.className = 'validation-feedback';
      profUsoFeedback.innerHTML = '';
    }
    return true;
  }

  // --- 3D FLOATING RECEIPT INTERACTIONS (HOVER TILT & SCROLL PERSPECTIVE) ---
  function initReceipt3DInteractions() {
    const scene = document.getElementById('receipt-3d-scene');
    const card = document.getElementById('receipt-3d-card');
    if (!scene || !card) return;

    let targetRotateX = 8;
    let targetRotateY = -11;
    let currentRotateX = 8;
    let currentRotateY = -11;

    // Hover 3D tilt tracking
    scene.addEventListener('pointermove', (e) => {
      const rect = scene.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const normX = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
      const normY = (e.clientY - rect.top) / rect.height - 0.5; // -0.5 to 0.5

      targetRotateY = -11 + normX * 30;
      targetRotateX = 8 - normY * 24;
    });

    scene.addEventListener('pointerleave', () => {
      targetRotateX = 8;
      targetRotateY = -11;
    });

    // Scroll perspective effect: tilts card as user scrolls through landing page
    function handleReceiptScrollPerspective() {
      if (screenWelcome && screenWelcome.classList.contains('hidden')) return;

      const rect = scene.getBoundingClientRect();
      const windowHeight = window.innerHeight;

      if (rect.top < windowHeight && rect.bottom > 0) {
        const progress = (windowHeight - rect.top) / (windowHeight + rect.height);
        const clampedProgress = Math.min(Math.max(progress, 0), 1);

        const scrollDeltaRx = (clampedProgress - 0.5) * 22;
        const scrollDeltaRy = (clampedProgress - 0.5) * -16;

        card.style.setProperty('--scroll-rx', `${scrollDeltaRx.toFixed(2)}deg`);
        card.style.setProperty('--scroll-ry', `${scrollDeltaRy.toFixed(2)}deg`);
      }
    }

    window.addEventListener('scroll', handleReceiptScrollPerspective, { passive: true });
    window.addEventListener('resize', handleReceiptScrollPerspective, { passive: true });
    handleReceiptScrollPerspective();

    // Smooth lerp loop for interactive mouse movement
    function animateTilt() {
      currentRotateX += (targetRotateX - currentRotateX) * 0.12;
      currentRotateY += (targetRotateY - currentRotateY) * 0.12;

      card.style.setProperty('--hover-rx', `${currentRotateX.toFixed(2)}deg`);
      card.style.setProperty('--hover-ry', `${currentRotateY.toFixed(2)}deg`);

      requestAnimationFrame(animateTilt);
    }
    animateTilt();
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
    if (!inputEl) return;
    const iconEl = document.getElementById(inputEl.id + '-icon') || 
                   inputEl.parentElement?.querySelector('.field-status-icon');

    if (!isTouched && (!inputEl.value || !inputEl.value.trim())) {
      inputEl.classList.remove('is-valid', 'is-invalid');
      if (iconEl) {
        iconEl.className = 'field-status-icon hidden';
        iconEl.innerHTML = '';
      }
      if (feedbackEl) {
        feedbackEl.className = 'validation-feedback';
        feedbackEl.innerHTML = '';
      }
      return;
    }

    if (result.valid) {
      inputEl.classList.remove('is-invalid');
      inputEl.classList.add('is-valid');
      if (iconEl) {
        iconEl.className = 'field-status-icon is-valid';
        iconEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        `;
        iconEl.classList.remove('hidden');
      }
      // Never show check below, only inside on the right
      if (feedbackEl) {
        feedbackEl.className = 'validation-feedback';
        feedbackEl.innerHTML = '';
      }
    } else {
      inputEl.classList.remove('is-valid');
      inputEl.classList.add('is-invalid');
      if (iconEl) {
        iconEl.className = 'field-status-icon is-invalid';
        iconEl.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        `;
        iconEl.classList.remove('hidden');
      }
      if (feedbackEl) {
        feedbackEl.className = 'validation-feedback is-invalid';
        feedbackEl.innerHTML = `<span>${escapeHtml(result.message || 'Campo no válido.')}</span>`;
      }
    }
  }

  const DEFAULT_FALLBACK_STATIONS = [
    {
      id: 'gogas',
      name: 'GoGas',
      brandName: 'GoGas / FacturasGas',
      domain: 'facturasgas.com',
      portalUrl: 'https://www.facturasgas.com/facturacion/autofactura.php',
      status: 'active',
      statusText: 'Disponible',
      description: 'Estaciones de servicio GoGas y Red FacturasGas a nivel nacional.',
    },
    {
      id: 'pemex',
      name: 'PEMEX',
      brandName: 'Petróleos Mexicanos',
      domain: 'portaldecombustibles.pemex.com',
      portalUrl: 'https://portaldecombustibles.pemex.com/business-clients/sporadic-invoices',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Franquicia PEMEX y estaciones de servicio afiliadas a nivel nacional.',
    },
    {
      id: 'bp',
      name: 'British Petroleum',
      brandName: 'BP México',
      domain: 'gasolineriabp.com.mx',
      portalUrl: 'https://gasolineriabp.com.mx/facturagasbpme',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red de gasolineras BP con tecnología ACTIVE a nivel nacional.',
    },
    {
      id: 'shell',
      name: 'Royal Dutch Shell',
      brandName: 'Shell México',
      domain: 'facturacion.shell.com.mx',
      portalUrl: 'https://facturacion.shell.com.mx/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de servicio Shell con combustibles V-Power.',
    },
    {
      id: 'everilion',
      name: 'Everilion (Shell)',
      brandName: 'Portal Everilion Shell',
      domain: 'shellmx.everilion.com',
      portalUrl: 'https://shellmx.everilion.com/ILIONX45/custom/ShellMexico/Portal_Facturacion/Views/Facturacion.aspx?c=icn',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Portal corporativo de facturación para estaciones Shell en Everilion.',
    },
    {
      id: 'chevron',
      name: 'Chevron',
      brandName: 'Chevron con Techron',
      domain: 'chevroncontechron.com',
      portalUrl: 'https://www.chevroncontechron.com/es_mx/home/Facturacion.html',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de servicio Chevron con aditivo Techron.',
    },
    {
      id: 'totalenergies',
      name: 'TotalEnergies',
      brandName: 'TotalEnergies México',
      domain: 'totalenergies.mx',
      portalUrl: 'https://totalenergies.mx/nosotros/estaciones-de-servicio/facturacion',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red de estaciones de servicio TotalEnergies en México.',
    },
    {
      id: 'exxonmobil',
      name: 'ExxonMobil',
      brandName: 'Mobil Synergy',
      domain: 'mobil.com.mx',
      portalUrl: 'https://www.mobil.com.mx/es-mx/gasolina/facturacion',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Combustibles Mobil Synergy a nivel nacional.',
    },
    {
      id: 'petromax',
      name: 'PETROMAX',
      brandName: 'Petromax / FacturaMobil',
      domain: 'facturamobil.petromax.com.mx',
      portalUrl: 'https://facturamobil.petromax.com.mx:8081/KPortalExterno/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Portal de facturación Petromax para estaciones Mobil.',
    },
    {
      id: 'gasislo',
      name: 'GasIslo',
      brandName: 'GasIslo Estaciones',
      domain: 'gasislo.com',
      portalUrl: 'http://gasislo.com/facturacion-electronica/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Facturación electrónica para estaciones GasIslo.',
    },
    {
      id: 'policon',
      name: 'Policon',
      brandName: 'Policon / Efectifactura',
      domain: 'efectifactura.com.mx',
      portalUrl: 'https://efectifactura.com.mx/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Sistema Efectifactura para estaciones afiliadas Policon.',
    },
    {
      id: 'mobilgolfo',
      name: 'MobilTM Golfo',
      brandName: 'Mobil Golfo México',
      domain: 'mobil.com.mx',
      portalUrl: 'https://www.mobil.com.mx/es-mx/gasolina/facturacion',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red de estaciones Mobil en la región Golfo.',
    },
    {
      id: 'topgas',
      name: 'TopGas',
      brandName: 'TopGas México',
      domain: 'topgasmexico.com',
      portalUrl: 'https://topgasmexico.com/facturacion/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de servicio TopGas en el norte del país.',
    },
    {
      id: 'orsan',
      name: 'ORSAN',
      brandName: 'Grupo ORSAN',
      domain: 'facturacionmobil.orsan.com.mx',
      portalUrl: 'http://facturacionmobil.orsan.com.mx/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red nacional de gasolineras y estaciones de servicio ORSAN.',
    },
    {
      id: 'combured',
      name: 'Combured',
      brandName: 'Grupo Combured',
      domain: 'combured.com.mx',
      portalUrl: 'https://arc.net/l/quote/zenmitco',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de servicio y facturación Red Combured.',
    },
    {
      id: 'redgasolin',
      name: 'Red Gasolin',
      brandName: 'Red Gasolin México',
      domain: 'redgasolin.com.mx',
      portalUrl: 'http://www.redgasolin.com.mx/Facturacion.html',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Portal de auto-facturación para estaciones Red Gasolin.',
    },
    {
      id: 'oxxogas',
      name: 'OXXO Gas',
      brandName: 'OXXO Gas México',
      domain: 'facturacion.oxxogas.com',
      portalUrl: 'https://facturacion.oxxogas.com/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red nacional de estaciones de servicio OXXO Gas.',
    },
    {
      id: 'g500',
      name: 'G500',
      brandName: 'G500 Network',
      domain: 'g500network.com',
      portalUrl: 'https://g500network.com/facturacion-en-linea/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Red G500 Network con tecnología aditivada G-Premium.',
    },
    {
      id: 'gulfoil',
      name: 'Gulf Oil',
      brandName: 'Gulf México Sureste',
      domain: 'facturacion.gulfsureste.com.mx',
      portalUrl: 'https://facturacion.gulfsureste.com.mx/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de combustible y servicio Gulf México.',
    },
    {
      id: 'redco',
      name: 'Redco',
      brandName: 'Grupo Redco',
      domain: 'gruporedco.com',
      portalUrl: 'https://www.gruporedco.com/acceso-facturacion.html',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Acceso a facturación de estaciones de servicio Grupo Redco.',
    },
    {
      id: 'hidrosina',
      name: 'Hidrosina',
      brandName: 'Grupo Hidrosina',
      domain: 'hidrosina.com.mx',
      portalUrl: 'https://www.hidrosina.com.mx/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Grupo Hidrosina, red líder en estaciones de servicio urbanas.',
    },
    {
      id: 'petro7',
      name: 'Petro-7',
      brandName: 'Petro-7 / 7-Eleven México',
      domain: 'petro-7.com.mx',
      portalUrl: 'https://petro-7.com.mx/facturacion/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Facturación en línea para estaciones de servicio Petro-7.',
    },
    {
      id: 'rendichicas',
      name: 'Rendichicas',
      brandName: 'Rendichicas / Rendilitros',
      domain: 'facturacion.rendilitros.com',
      portalUrl: 'https://facturacion.rendilitros.com/',
      status: 'disabled',
      statusText: 'Próximamente',
      description: 'Estaciones de servicio Rendichicas con litros completos certificados.',
    },
  ];

  async function loadSupportedStations() {
    try {
      const res = await fetch('/api/stations');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.stations) && data.stations.length > 0) {
          supportedStations = data.stations;
          renderStations(supportedStations);
          return;
        }
      }
      supportedStations = DEFAULT_FALLBACK_STATIONS;
      renderStations(supportedStations);
    } catch (err) {
      console.warn('Error loading stations, using default fallback:', err);
      supportedStations = DEFAULT_FALLBACK_STATIONS;
      renderStations(supportedStations);
    }
  }

  function getStationLogoSvg(stationId, stationName) {
    const id = String(stationId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = String(stationName || '').toLowerCase();

    // 1. GoGas
    if (id === 'gogas' || name.includes('gogas')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#032B25"/>
        <circle cx="24" cy="24" r="22.5" stroke="#10B981" stroke-width="1.5"/>
        <path d="M24 8 C16.5 8 10.5 14 10.5 21.5 C10.5 28 15 33.5 21.5 34.7 L21.5 27.5 C17.8 26.5 15.5 24 15.5 21.5 C15.5 17 19.2 13.5 24 13.5 C26.2 13.5 28.2 14.3 29.7 15.7 L33.8 11.5 C31.2 9.2 27.8 8 24 8 Z" fill="#10B981"/>
        <path d="M24 13.5 C28.5 13.5 32 17 32 21.5 C32 23.5 31.2 25.2 29.8 26.5 L29.8 21.5 L24 21.5 L24 26.5 L33.2 26.5 C34.8 24 35.2 21 34.6 18 L30.2 19.8 C29.2 16.5 26.8 14 24 13.5 Z" fill="#00D2FF"/>
        <text x="24" y="40" text-anchor="middle" fill="#FFFFFF" font-size="7" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">GOGAS</text>
      </svg>`;
    }

    // 2. PEMEX
    if (id === 'pemex' || name.includes('pemex')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#006847"/>
        <circle cx="24" cy="24" r="22.5" stroke="#008a5e" stroke-width="1.5"/>
        <path d="M19 11 C14 13 11 17.5 11 22.5 C11 28.5 15.5 32.5 22 32.5 C23.5 32.5 25 32.2 26.2 31.5 C23 30.5 20 28 19 24.5 C18.5 23 18.5 20.5 19.5 18.5 C18 19 16.5 20.5 16 22 C15.5 20.5 16 18 18 15.5 C16 16.5 14.5 18.5 14 20.5 C14.5 16.5 16.5 13.5 19 11 Z" fill="#FFFFFF"/>
        <path d="M22 16 C20 17.5 19 20 19.5 22.5 C20.5 20.5 22 19.5 24 19 C22.5 20.5 22 22.5 22.5 24.5 C23.5 23 25.5 22 27 22 C25 23.5 24.5 25.5 25 27.5 C27 26 28.5 23.5 28.5 21 C28.5 17.5 25.5 15 22 16 Z" fill="#FFFFFF"/>
        <path d="M30 12 C30 12 35.5 17 35.5 21.5 C35.5 24.8 32.8 27 29.5 27 C30 25 29.5 23 28 21.5 C30 20.5 31 18.5 30 16.5 C30.5 15.5 30.5 14 30 12 Z" fill="#CE1126"/>
        <text x="24" y="41" text-anchor="middle" fill="#FFFFFF" font-size="7.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">PEMEX</text>
      </svg>`;
    }

    // 3. British Petroleum (BP)
    if (id === 'bp' || name.includes('petroleum') || name.includes('bp')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#E2E8F0" stroke-width="1.5"/>
        <g transform="translate(24, 19)">
          <g fill="#007A3D">
            <circle cx="0" cy="0" r="14.5"/>
            <path d="M0 -15 L3 -7 L10 -11 L7 -4 L15 0 L7 4 L10 11 L3 7 L0 15 L-3 7 L-10 11 L-7 4 L-15 0 L-7 -4 L-10 -11 L-3 -7 Z"/>
          </g>
          <g fill="#78BE20">
            <circle cx="0" cy="0" r="10.5"/>
            <path d="M0 -11 L2.5 -5 L8 -8 L5 -3 L11 0 L5 3 L8 8 L2.5 5 L0 11 L-2.5 5 L-8 8 L-5 3 L-11 0 L-5 -3 L-8 -8 L-2.5 -5 Z"/>
          </g>
          <g fill="#FDB913">
            <circle cx="0" cy="0" r="6.8"/>
            <path d="M0 -7 L1.8 -3.2 L5 -5 L3.2 -1.8 L7 0 L3.2 1.8 L5 5 L1.8 3.2 L0 7 L-1.8 3.2 L-5 5 L-3.2 1.8 L-7 0 L-3.2 -1.8 L-5 -5 L-1.8 -3.2 Z"/>
          </g>
          <circle cx="0" cy="0" r="3.2" fill="#FFFFFF"/>
        </g>
        <text x="24" y="42" text-anchor="middle" fill="#007A3D" font-size="9" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="-0.5">bp</text>
      </svg>`;
    }

    // 4. Shell
    if (id === 'shell' || name.includes('shell')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#FEE2E2" stroke-width="1.5"/>
        <path d="M24 7 C15.5 7 10 13.5 10 21 C10 26 12.5 29.5 15 32.5 L19 32.5 L19.8 35 L28.2 35 L29 32.5 L33 32.5 C35.5 29.5 38 26 38 21 C38 13.5 32.5 7 24 7 Z" fill="#FFD100" stroke="#DD1D21" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M24 8 L24 32.5" stroke="#DD1D21" stroke-width="2"/>
        <path d="M19.5 10 L17.5 31" stroke="#DD1D21" stroke-width="1.8"/>
        <path d="M28.5 10 L30.5 31" stroke="#DD1D21" stroke-width="1.8"/>
        <path d="M15.5 14.5 L13.5 28.5" stroke="#DD1D21" stroke-width="1.5"/>
        <path d="M32.5 14.5 L34.5 28.5" stroke="#DD1D21" stroke-width="1.5"/>
        <path d="M18.5 35 L29.5 35 L28.5 38.5 L19.5 38.5 Z" fill="#DD1D21"/>
        <text x="24" y="44.5" text-anchor="middle" fill="#DD1D21" font-size="6" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">SHELL</text>
      </svg>`;
    }

    // 5. Everilion (Shell)
    if (id === 'everilion' || name.includes('everilion')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#0A192F"/>
        <circle cx="24" cy="24" r="22.5" stroke="#1E3A8A" stroke-width="1.5"/>
        <polygon points="24,9 35,15.5 35,28.5 24,35 13,28.5 13,15.5" stroke="#38BDF8" stroke-width="2" fill="none" stroke-dasharray="2.5 2.5"/>
        <circle cx="24" cy="9" r="2.2" fill="#38BDF8"/>
        <circle cx="35" cy="15.5" r="2.2" fill="#38BDF8"/>
        <circle cx="35" cy="28.5" r="2.2" fill="#38BDF8"/>
        <circle cx="24" cy="35" r="2.2" fill="#38BDF8"/>
        <circle cx="13" cy="28.5" r="2.2" fill="#38BDF8"/>
        <circle cx="13" cy="15.5" r="2.2" fill="#38BDF8"/>
        <path d="M24 15 C19.5 15 16.5 18.5 16.5 22.5 C16.5 25 18 27.5 19.5 29 L28.5 29 C30 27.5 31.5 25 31.5 22.5 C31.5 18.5 28.5 15 24 15 Z" fill="#FFD100" stroke="#DD1D21" stroke-width="1.8"/>
        <path d="M24 16 L24 28" stroke="#DD1D21" stroke-width="1.5"/>
        <text x="24" y="42.5" text-anchor="middle" fill="#93C5FD" font-size="5.2" font-weight="800" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">EVERILION</text>
      </svg>`;
    }

    // 6. Chevron
    if (id === 'chevron' || name.includes('chevron')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#E2E8F0" stroke-width="1.5"/>
        <path d="M12 10 L24 19 L36 10 L36 16 L24 25 L12 16 Z" fill="#005596"/>
        <path d="M12 20 L24 29 L36 20 L36 26 L24 35 L12 26 Z" fill="#ED1C24"/>
        <text x="24" y="43" text-anchor="middle" fill="#005596" font-size="5.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.8">CHEVRON</text>
      </svg>`;
    }

    // 7. TotalEnergies
    if (id === 'totalenergies' || id === 'total' || name.includes('total')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#F1F5F9" stroke-width="1.5"/>
        <defs>
          <linearGradient id="te-grad-dyn" x1="12" y1="12" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop stop-color="#E52320"/>
            <stop offset="0.35" stop-color="#F37321"/>
            <stop offset="0.65" stop-color="#FFB612"/>
            <stop offset="1" stop-color="#0055A5"/>
          </linearGradient>
        </defs>
        <path d="M15 14 C19 10 29 10 33 14 C36.5 17.5 36.5 22.5 32.5 25.5 C28.5 28.5 20 28.5 17 31.5 C14 34.5 15 38.5 19 38.5 C23 38.5 26 35.5 27 33.5" stroke="url(#te-grad-dyn)" stroke-width="4.5" stroke-linecap="round" fill="none"/>
        <path d="M20.5 20.5 C22.5 17.5 26.5 17.5 28.5 19.5 C30.5 21.5 29.5 24.5 26.5 25.5" stroke="#FF6E00" stroke-width="4" stroke-linecap="round" fill="none"/>
        <text x="24" y="44" text-anchor="middle" fill="#1E293B" font-size="5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.3">TOTAL</text>
      </svg>`;
    }

    // 8. ExxonMobil / Mobil
    if (id === 'exxonmobil' || id === 'mobil' || name.includes('exxon') || name.includes('mobil')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#E2E8F0" stroke-width="1.5"/>
        <path d="M17 11 C18 9.5 21 8.5 23 10.5 C24 9.5 26 9.5 27 10.5 C28 11 28.5 12.5 28 13.5 L33 10.5 C34.5 9.5 36 10 35.5 11.5 L32 14.5 L37 13.5 C38.5 13 39 14 38 15.5 L33 18.5 L38 19.5 C39 20 39 21 37.5 21.5 L31 21.5 C29 23.5 28 25.5 27 27.5 L28 31.5 L26 31.5 L24 26.5 L22 26.5 L21 31.5 L19 31.5 L20 24.5 C19 24.5 18 23.5 17 22.5 L14 25.5 L13 24.5 L15 20.5 C14.5 20 14 18.5 15 16.5 L18 16.5 L17 13.5 Z" fill="#ED1C24"/>
        <g transform="translate(6, 32)">
          <text x="0" y="7" fill="#0033A0" font-size="8" font-weight="900" font-family="system-ui, -apple-system, sans-serif">M</text>
          <text x="9" y="7" fill="#ED1C24" font-size="8" font-weight="900" font-family="system-ui, -apple-system, sans-serif">o</text>
          <text x="14.5" y="7" fill="#0033A0" font-size="8" font-weight="900" font-family="system-ui, -apple-system, sans-serif">bil</text>
        </g>
      </svg>`;
    }

    // 9. PETROMAX
    if (id === 'petromax' || name.includes('petromax')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#0B1D3A"/>
        <circle cx="24" cy="24" r="22.5" stroke="#DC2626" stroke-width="1.5"/>
        <polygon points="24,9 35,21 24,33 13,21" fill="#DC2626"/>
        <polygon points="24,12 32,21 24,30 16,21" fill="#FFFFFF"/>
        <path d="M22 15 L26 15 C27.5 15 28.5 16 28.5 17.5 C28.5 19 27.5 20 26 20 L24 20 L24 26 L22 26 Z M24 17 L24 18.5 L25.5 18.5 C26 18.5 26.5 18.2 26.5 17.7 C26.5 17.3 26 17 25.5 17 Z" fill="#0B1D3A"/>
        <text x="24" y="41" text-anchor="middle" fill="#FFFFFF" font-size="5.2" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">PETROMAX</text>
      </svg>`;
    }

    // 10. GasIslo
    if (id === 'gasislo' || name.includes('islo')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#004B87" stroke-width="1.5"/>
        <path d="M22 9 C22 9 13 17 13 23 C13 28 17 31 21 31 C17 29 16 25 18 21 C19.5 18 22 15 22 9 Z" fill="#004B87"/>
        <path d="M26 9 C26 9 35 17 35 23 C35 28 31 31 27 31 C31 29 32 25 30 21 C28.5 18 26 15 26 9 Z" fill="#F7941D"/>
        <circle cx="24" cy="24" r="3.2" fill="#004B87"/>
        <text x="24" y="41.5" text-anchor="middle" fill="#004B87" font-size="6" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">GASISLO</text>
      </svg>`;
    }

    // 11. Policon
    if (id === 'policon' || name.includes('policon') || name.includes('efectifactura')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#06283D"/>
        <circle cx="24" cy="24" r="22.5" stroke="#0EA5E9" stroke-width="1.5"/>
        <polygon points="24,9 35,15.5 35,27.5 24,34 13,27.5 13,15.5" stroke="#0EA5E9" stroke-width="2" fill="#1363DF" fill-opacity="0.25"/>
        <path d="M19 22 L23 26 L29 17" stroke="#38BDF8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="24" y="42" text-anchor="middle" fill="#FFFFFF" font-size="5.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.8">POLICON</text>
      </svg>`;
    }

    // 12. MobilTM Golfo
    if (id === 'mobilgolfo' || (name.includes('mobil') && name.includes('golfo'))) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#0C2340"/>
        <circle cx="24" cy="24" r="22.5" stroke="#3B82F6" stroke-width="1.5"/>
        <path d="M16 12 C17 10.5 20 9.5 22 11.5 C23 10.5 25 10.5 26 11.5 C27 12 27.5 13.5 27 14.5 L32 11.5 C33.5 10.5 35 11 34.5 12.5 L31 15.5 L36 14.5 C37.5 14 38 15 37 16.5 L32 19.5 L37 20.5 C38 21 38 22 36.5 22.5 L30 22.5 C28 24.5 27 26.5 26 28.5 L27 32.5 L25 32.5 L23 27.5 L21 27.5 L20 32.5 L18 32.5 L19 25.5 C18 25.5 17 24.5 16 23.5 L13 26.5 L12 25.5 L14 21.5 C13.5 21 13 19.5 14 17.5 L17 17.5 L16 14.5 Z" fill="#ED1C24"/>
        <text x="24" y="41.5" text-anchor="middle" fill="#FFFFFF" font-size="5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">MOBIL GOLFO</text>
      </svg>`;
    }

    // 13. TopGas
    if (id === 'topgas' || name.includes('topgas')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#0F172A"/>
        <circle cx="24" cy="24" r="22.5" stroke="#F97316" stroke-width="1.5"/>
        <path d="M24 7 C24 7 28.5 13 28.5 17 C28.5 20.5 26.5 22.5 24 22.5 C21.5 22.5 19.5 20.5 19.5 17 C19.5 13 24 7 24 7 Z" fill="#F97316"/>
        <path d="M24 12 C24 12 26 15 26 17 C26 18.5 25 19.5 24 19.5 C23 19.5 22 18.5 22 17 C22 15 24 12 24 12 Z" fill="#FDE047"/>
        <path d="M14 25.5 L34 25.5 L32 28.5 L16 28.5 Z" fill="#EF4444"/>
        <text x="24" y="39.5" text-anchor="middle" fill="#FFFFFF" font-size="6.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">TOPGAS</text>
      </svg>`;
    }

    // 14. ORSAN
    if (id === 'orsan' || name.includes('orsan')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#B91C1C" stroke-width="1.5"/>
        <circle cx="24" cy="19" r="10.5" stroke="#B91C1C" stroke-width="3.5" fill="none"/>
        <path d="M24 9 C28 9 31 11 33 14 L28 18 C27 17 25.5 16 24 16 Z" fill="#F59E0B"/>
        <circle cx="24" cy="19" r="4.2" fill="#B91C1C"/>
        <text x="24" y="41" text-anchor="middle" fill="#B91C1C" font-size="7" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">ORSAN</text>
      </svg>`;
    }

    // 15. Combured
    if (id === 'combured' || name.includes('combured')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#111827"/>
        <circle cx="24" cy="24" r="22.5" stroke="#EF4444" stroke-width="1.5"/>
        <path d="M21 10 C21 10 14 16 14 21 C14 25 17 28 21 28 C24 28 26 26 26 23 C26 19 21 10 21 10 Z" fill="#EF4444"/>
        <path d="M27 13 C27 13 34 19 34 24 C34 28 31 31 27 31 C24 31 22 29 22 26 C22 22 27 13 27 13 Z" fill="#3B82F6"/>
        <text x="24" y="41" text-anchor="middle" fill="#FFFFFF" font-size="5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">COMBURED</text>
      </svg>`;
    }

    // 16. Red Gasolin
    if (id === 'redgasolin' || name.includes('red gasolin')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#DC2626"/>
        <circle cx="24" cy="24" r="22.5" stroke="#FFFFFF" stroke-width="1.5"/>
        <path d="M17 11 L25 11 C28.5 11 31 13.5 31 17 C31 19.5 29.5 21.5 27 22.5 L32 31 L27.5 31 L23 23 L21 23 L21 31 L17 31 Z M21 15 L21 19.5 L24.5 19.5 C26 19.5 27 18.5 27 17.2 C27 16 26 15 24.5 15 Z" fill="#FFFFFF"/>
        <circle cx="31" cy="13" r="2" fill="#FDE047"/>
        <text x="24" y="41.5" text-anchor="middle" fill="#FFFFFF" font-size="4.8" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">RED GASOLIN</text>
      </svg>`;
    }

    // 17. OXXO Gas
    if (id === 'oxxogas' || id === 'oxxo' || name.includes('oxxo')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#D0021B"/>
        <circle cx="24" cy="24" r="22.5" stroke="#FFCC00" stroke-width="1.5"/>
        <path d="M8 29 C14 33 34 33 40 29 L38 33.5 C30 36.5 18 36.5 10 33.5 Z" fill="#FFCC00"/>
        <g fill="#FFFFFF">
          <rect x="9" y="14" width="7" height="11" rx="3.5"/>
          <rect x="11" y="16" width="3" height="7" rx="1.5" fill="#D0021B"/>
          <path d="M18 14 L20.5 14 L22 17 L23.5 14 L26 14 L23.5 19.5 L26 25 L23.5 25 L22 22 L20.5 25 L18 25 L20.5 19.5 Z"/>
          <path d="M26 14 L28.5 14 L30 17 L31.5 14 L34 14 L31.5 19.5 L34 25 L31.5 25 L30 22 L28.5 25 L26 25 L28.5 19.5 Z"/>
          <rect x="34" y="14" width="7" height="11" rx="3.5"/>
          <rect x="36" y="16" width="3" height="7" rx="1.5" fill="#D0021B"/>
        </g>
        <text x="24" y="42" text-anchor="middle" fill="#FFCC00" font-size="6.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="1">GAS</text>
      </svg>`;
    }

    // 18. G500
    if (id === 'g500' || name.includes('g500')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#0A192F"/>
        <circle cx="24" cy="24" r="22.5" stroke="#00D2D3" stroke-width="1.5"/>
        <path d="M24 10 C17 10 12 15 12 22 C12 29 17 34 24 34 C30.5 34 34.5 30 35.5 24 L24 24 L24 19 L39.5 19 C40 30 32 38 24 38 C15 38 8 31 8 22 C8 13 15 6 24 6 C29.5 6 34 8.5 37 12.5 L33 16 C31 12.5 28 10 24 10 Z" fill="#00D2D3"/>
        <text x="25" y="27" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">500</text>
        <text x="24" y="42.5" text-anchor="middle" fill="#00D2D3" font-size="4.5" font-weight="800" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.8">NETWORK</text>
      </svg>`;
    }

    // 19. Gulf Oil
    if (id === 'gulfoil' || id === 'gulf' || name.includes('gulf')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FF6600"/>
        <circle cx="24" cy="24" r="22.5" stroke="#FFFFFF" stroke-width="1.5"/>
        <rect x="0" y="16" width="48" height="16" fill="#00205B"/>
        <line x1="0" y1="16" x2="48" y2="16" stroke="#FFFFFF" stroke-width="1.2"/>
        <line x1="0" y1="32" x2="48" y2="32" stroke="#FFFFFF" stroke-width="1.2"/>
        <text x="24" y="28.5" text-anchor="middle" fill="#FFFFFF" font-size="12" font-weight="900" font-family="Georgia, serif" font-style="italic">Gulf</text>
      </svg>`;
    }

    // 20. Redco
    if (id === 'redco' || name.includes('redco')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#DC2626" stroke-width="1.5"/>
        <path d="M24 9 L34 13 L34 23 C34 29 29 33 24 35 C19 33 14 29 14 23 L14 13 Z" fill="#DC2626"/>
        <polygon points="24,13 25.5,17 29.5,17 26.5,19.5 27.5,23.5 24,21 20.5,23.5 21.5,19.5 18.5,17 22.5,17" fill="#FFFFFF"/>
        <text x="24" y="31" text-anchor="middle" fill="#FFFFFF" font-size="6" font-weight="900" font-family="system-ui, -apple-system, sans-serif">R</text>
        <text x="24" y="43" text-anchor="middle" fill="#1E3A8A" font-size="5.5" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">REDCO</text>
      </svg>`;
    }

    // 21. Hidrosina
    if (id === 'hidrosina' || name.includes('hidrosina')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#047857"/>
        <circle cx="24" cy="24" r="22.5" stroke="#10B981" stroke-width="1.5"/>
        <path d="M24 9 C24 9 15 18 15 24 C15 29 19 33 24 33 C29 33 33 29 33 24 C33 18 24 9 24 9 Z" fill="#FFFFFF"/>
        <path d="M24 15 C24 15 18 21 18 25 C18 28.5 20.5 31 24 31 C27.5 31 30 28.5 30 25 C30 21 24 15 24 15 Z" fill="#84CC16"/>
        <path d="M22 21.5 L22 28.5 M26 21.5 L26 28.5 M22 25 L26 25" stroke="#047857" stroke-width="2" stroke-linecap="round"/>
        <text x="24" y="42" text-anchor="middle" fill="#FFFFFF" font-size="5" font-weight="800" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">HIDROSINA</text>
      </svg>`;
    }

    // 22. Petro-7
    if (id === 'petro7' || id === 'petro' || name.includes('petro-7') || name.includes('petro 7')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#FFFFFF"/>
        <circle cx="24" cy="24" r="23" stroke="#E2E8F0" stroke-width="1.5"/>
        <path d="M15 11 L33 11 L33 15 L23 31 L18 31 L26 17 L15 17 Z" fill="#EE6425"/>
        <path d="M15 11 L33 11 L33 15 L15 15 Z" fill="#008163"/>
        <rect x="14" y="31" width="20" height="6.5" rx="2" fill="#ED1B2D"/>
        <text x="24" y="36" text-anchor="middle" fill="#FFFFFF" font-size="4.8" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.5">PETRO-7</text>
      </svg>`;
    }

    // 23. Rendichicas
    if (id === 'rendichicas' || name.includes('rendichicas') || name.includes('rendilitros')) {
      return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="#BE185D"/>
        <circle cx="24" cy="24" r="22.5" stroke="#F472B6" stroke-width="1.5"/>
        <path d="M18 12 C22 12 28 13 30 15 C31 16 31 17 29 17 C26 17 23 17 21 18 C20 19 20 21 21 22 C22 23 23 23 23 24 C23 25 21 26 19 25 C17 24 16 22 16 20 C16 18 15 17 13 17 C12 16 12 15 13 14 C15 13 16 12 18 12 Z" fill="#FFFFFF"/>
        <path d="M21 24 C23 27 26 28 28 28 C29 28 27 32 24 32 C20 32 17 29 17 25 Z" fill="#FFFFFF"/>
        <circle cx="31" cy="21" r="1.5" fill="#FDE047"/>
        <circle cx="33" cy="17" r="1" fill="#FDE047"/>
        <text x="24" y="42" text-anchor="middle" fill="#FFFFFF" font-size="4.8" font-weight="900" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.3">RENDICHICAS</text>
      </svg>`;
    }

    // Default Gas Station Logo
    return `<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#0F172A"/>
      <circle cx="24" cy="24" r="22.5" stroke="#10B981" stroke-width="1.5"/>
      <path d="M15 34 V14 C15 12.9 15.9 12 17 12 H27 C28.1 12 29 12.9 29 14 V34" stroke="#10B981" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M29 21 H31 C32.1 21 33 21.9 33 23 V27 C33 28.1 33.9 29 35 29 C36.1 29 37 28.1 37 27 V19 C37 17.9 36.5 17 35.7 16.3 L34.5 15" stroke="#34D399" stroke-width="2" stroke-linecap="round"/>
      <rect x="18" y="16" width="8" height="6" rx="1" fill="#10B981" fill-opacity="0.3" stroke="#10B981" stroke-width="1.5"/>
      <line x1="12" y1="34" x2="32" y2="34" stroke="#10B981" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }

  function renderStations(stations) {
    if (!stationsGrid) return;
    stationsGrid.innerHTML = '';
    for (const st of stations) {
      const card = document.createElement('div');
      const isActive = st.status === 'active';
      card.className = `station-card ${!isActive ? 'station-card-disabled' : ''}`;
      const domainDisplay = st.domain || (st.portalUrl ? new URL(st.portalUrl).hostname : '');
      const portalTarget = st.portalUrl || (st.domain ? `https://${st.domain}` : '#');
      const badgeText = st.statusText || (isActive ? 'Disponible' : 'Próximamente');
      card.innerHTML = `
        <div class="station-logo" aria-hidden="true">
          ${getStationLogoSvg(st.id, st.name)}
        </div>
        <div class="station-details">
          <div class="station-header-row">
            <h4>${escapeHtml(st.name)}</h4>
            <span class="station-badge ${isActive ? 'active' : 'disabled'}">
              ${isActive ? `
                <span class="station-live-dot" aria-hidden="true">
                  <span class="station-live-ping"></span>
                  <span class="station-live-core"></span>
                </span>
              ` : ''}
              <span>${escapeHtml(badgeText)}</span>
            </span>
          </div>
          ${domainDisplay ? `
            <div class="station-website-row">
              <span class="station-website-text">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <span>${escapeHtml(domainDisplay)}</span>
              </span>
            </div>
          ` : ''}
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
    if (targetScreen === screenHistory) currentScreen = 'history';
    else if (targetScreen === screenWelcome) currentScreen = 'welcome';
    else if (targetScreen === screenProfile) currentScreen = 'profile';
    else if (targetScreen === screenWorkbench) currentScreen = 'workbench';

    if (mobileCameraFabContainer) {
      if (targetScreen === screenWelcome) {
        mobileCameraFabContainer.classList.remove('hidden');
      } else {
        mobileCameraFabContainer.classList.add('hidden');
      }
    }
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

    // Welcome start: directly triggers camera / file browser without intermediate empty workbench friction
    function handleWelcomeStart() {
      if (fileInput) {
        fileInput.click();
      } else {
        openUploadWorkbench();
      }
    }

    btnWelcomeStart?.addEventListener('click', handleWelcomeStart);
    btnMobileCameraFab?.addEventListener('click', handleWelcomeStart);

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
    btnDeleteProfile?.addEventListener('click', openDeleteProfileModal);
    btnCloseDeleteProfileModal?.addEventListener('click', () => closeDeleteProfileModal());
    btnCancelDeleteModal?.addEventListener('click', () => closeDeleteProfileModal());
    btnConfirmDeleteModal?.addEventListener('click', confirmDeleteProfile);
    deleteProfileModal?.addEventListener('click', (e) => {
      if (e.target === deleteProfileModal) closeDeleteProfileModal();
    });

    btnCancelProfile?.addEventListener('click', () => {
      if (currentScannedReceipts && currentScannedReceipts.length > 0) {
        isPendingInvoicing = false;
        switchScreen(screenWorkbench);
        return;
      }
      const profile = getProfile();
      if (profile && profile.rfc) {
        switchScreen(screenHistory);
        loadHistory();
      } else {
        switchScreen(screenWelcome);
      }
    });

    // Initialize custom accessible searchable select for Régimen Fiscal & Uso de CFDI
    initCustomRegimenSelect();
    initCustomUsoSelect();
    initReceipt3DInteractions();

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

    // Razón Social validation on input & blur
    profRazon?.addEventListener('input', () => {
      const isValid = !!profRazon.value.trim();
      setFieldValidationUI(profRazon, profRazonFeedback, { valid: isValid, message: 'Ingresa tu Razón Social o Nombre Completo.' }, true);
    });

    profRazon?.addEventListener('blur', () => {
      const isValid = !!profRazon.value.trim();
      setFieldValidationUI(profRazon, profRazonFeedback, { valid: isValid, message: 'Ingresa tu Razón Social o Nombre Completo.' }, true);
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
    function openUploadWorkbench() {
      if (uploadCard) {
        const workbenchLayout = document.querySelector('.workbench-layout');
        if (workbenchLayout && uploadCard.parentElement !== workbenchLayout) {
          workbenchLayout.prepend(uploadCard);
        }
        uploadCard.classList.remove('hidden');
      }
      if (btnBackToHistory) {
        const profile = getProfile();
        btnBackToHistory.classList.remove('hidden');
        const textSpan = btnBackToHistory.querySelector('span');
        if (textSpan) {
          textSpan.textContent = (profile && profile.rfc) ? 'Volver al Historial' : 'Volver al Inicio';
        }
      }
      reviewSection?.classList.add('hidden');
      switchScreen(screenWorkbench);
    }

    const handleNewReceiptTrigger = () => {
      if (fileInput) {
        fileInput.click();
      } else {
        openUploadWorkbench();
      }
    };

    btnNewFromHistory?.addEventListener('click', handleNewReceiptTrigger);
    btnMobileNewReceipt?.addEventListener('click', handleNewReceiptTrigger);

    btnBackToHistory?.addEventListener('click', () => {
      const profile = getProfile();
      if (profile && profile.rfc) {
        switchScreen(screenHistory);
        loadHistory();
      } else {
        switchScreen(screenWelcome);
      }
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

    // Legal Modal & Footer Links Interactions
    btnLegalTerms?.addEventListener('click', () => openLegalModal('legal-pane-terms'));
    btnLegalPrivacy?.addEventListener('click', () => openLegalModal('legal-pane-privacy'));
    btnLegalDisclaimer?.addEventListener('click', () => openLegalModal('legal-pane-disclaimer'));
    btnCloseLegalModal?.addEventListener('click', closeLegalModal);
    btnAcceptLegalModal?.addEventListener('click', closeLegalModal);
    legalModal?.addEventListener('click', (e) => {
      if (e.target === legalModal) closeLegalModal();
    });

    const legalTabBtns = document.querySelectorAll('.legal-tab-btn');
    legalTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) openLegalModal(tab);
      });
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
        if (deleteProfileModal && !deleteProfileModal.classList.contains('hidden')) {
          closeDeleteProfileModal();
        } else if (legalModal && !legalModal.classList.contains('hidden')) {
          closeLegalModal();
        } else if (receiptViewerOverlay && !receiptViewerOverlay.classList.contains('hidden')) {
          closeReceiptViewer();
        } else if (mediaModal && !mediaModal.classList.contains('hidden')) {
          closeModal();
        }
      }
    });

    window.addEventListener('popstate', () => {
      if (deleteProfileModal && !deleteProfileModal.classList.contains('hidden')) {
        closeDeleteProfileModal(false);
      } else if (legalModal && !legalModal.classList.contains('hidden')) {
        closeLegalModal(false);
      } else if (receiptViewerOverlay && !receiptViewerOverlay.classList.contains('hidden')) {
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
        if (profUso) {
          profUso.value = 'G03';
          profUso.dispatchEvent(new Event('change'));
        }
        syncCustomUsoFromValue('G03');

        // Trigger real-time visual validation states
        setFieldValidationUI(profRfc, profRfcFeedback, validateRFC(profRfc.value), true);
        setFieldValidationUI(profRazon, profRazonFeedback, { valid: true }, true);
        setFieldValidationUI(profEmail, profEmailFeedback, validateEmail(profEmail.value), true);
        setFieldValidationUI(profCp, profCpFeedback, validatePostalCode(profCp.value), true);
        customRegimenContainer?.classList.remove('is-invalid');
        validateRegimenField(true);
        customUsoContainer?.classList.remove('is-invalid');
        validateUsoField(true);
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
  function openProfileScreen(isEditing, options = {}) {
    isPendingInvoicing = Boolean(options.pendingInvoicing);
    switchScreen(screenProfile);

    // Reset validation feedback states, inner icons, and error borders
    [profRfc, profRazon, profEmail, profCp].forEach(el => {
      el?.classList.remove('is-valid', 'is-invalid');
    });
    document.querySelectorAll('.field-status-icon').forEach(icon => {
      icon.className = 'field-status-icon hidden';
      icon.innerHTML = '';
    });
    document.getElementById('regimen-select-check')?.classList.add('hidden');
    document.getElementById('uso-select-check')?.classList.add('hidden');
    [profRfcFeedback, profRazonFeedback, profEmailFeedback, profCpFeedback, profRegimenFeedback, profUsoFeedback].forEach(el => {
      if (el) { el.className = 'validation-feedback'; el.innerHTML = ''; }
    });
    customRegimenContainer?.classList.remove('is-invalid');
    customUsoContainer?.classList.remove('is-invalid');
    regimenSelectTrigger?.classList.remove('is-invalid');
    usoSelectTrigger?.classList.remove('is-invalid');

    if (isPendingInvoicing) {
      profileDangerZone?.classList.add('hidden');
      profileNotificationsZone?.classList.add('hidden');
      // User came directly from reviewing a scanned ticket!
      profilePendingNotice?.classList.remove('hidden');
      if (profileStepIndicator) profileStepIndicator.textContent = 'Paso Final: Datos Fiscales';
      if (profileCardTitle) profileCardTitle.textContent = '¿A quién facturamos este ticket?';
      if (profileCardSubtitle) profileCardSubtitle.textContent = 'Configura tus datos fiscales ante el SAT para emitir tu factura de inmediato.';
      if (btnSaveProfile) {
        const desktopText = btnSaveProfile.querySelector('.btn-text-desktop');
        const mobileText = btnSaveProfile.querySelector('.btn-text-mobile');
        if (desktopText) desktopText.textContent = 'Guardar y Facturar Ticket';
        if (mobileText) mobileText.textContent = 'Facturar';
      }
      btnCancelProfile.style.display = 'inline-flex';
      btnCancelProfile.textContent = 'Volver al Ticket';

      const profile = getProfile() || {};
      if (profile.rfc) {
        profRfc.value = profile.rfc;
        profRazon.value = profile.razonSocial || '';
        profEmail.value = profile.email || '';
        profCp.value = profile.codigoPostal || '';
        if (profile.regimenFiscal) syncCustomRegimenFromValue(profile.regimenFiscal);
        if (profile.usoCfdi) syncCustomUsoFromValue(profile.usoCfdi);
      }
    } else if (isEditing) {
      profilePendingNotice?.classList.add('hidden');
      const profile = getProfile() || {};
      if (profile && profile.rfc) {
        profileDangerZone?.classList.remove('hidden');
        profileNotificationsZone?.classList.remove('hidden');
        updatePushStatusUI();
      } else {
        profileDangerZone?.classList.add('hidden');
        profileNotificationsZone?.classList.add('hidden');
      }
      if (profileStepIndicator) profileStepIndicator.textContent = 'Mi Perfil';
      if (profileCardTitle) profileCardTitle.textContent = 'Editar Datos Fiscales';
      if (profileCardSubtitle) profileCardSubtitle.textContent = 'Actualiza los datos con los que se emitirán tus facturas ante el SAT.';
      if (btnSaveProfile) {
        const desktopText = btnSaveProfile.querySelector('.btn-text-desktop');
        const mobileText = btnSaveProfile.querySelector('.btn-text-mobile');
        if (desktopText) desktopText.textContent = 'Guardar Cambios';
        if (mobileText) mobileText.textContent = 'Guardar';
      }
      btnCancelProfile.style.display = 'inline-flex';
      btnCancelProfile.textContent = 'Cancelar';

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
      if (profile.usoCfdi && profUso) {
        profUso.value = profile.usoCfdi;
        syncCustomUsoFromValue(profile.usoCfdi);
      } else {
        syncCustomUsoFromValue('G03');
      }

      // Pre-evaluate visual validation for existing fields
      if (profRfc.value) setFieldValidationUI(profRfc, profRfcFeedback, validateRFC(profRfc.value), true);
      if (profRazon.value) setFieldValidationUI(profRazon, profRazonFeedback, { valid: true }, true);
      if (profEmail.value) setFieldValidationUI(profEmail, profEmailFeedback, validateEmail(profEmail.value), true);
      if (profCp.value) setFieldValidationUI(profCp, profCpFeedback, validatePostalCode(profCp.value), true);
      if (profRegimen?.value) validateRegimenField(false);
      if (profUso?.value) validateUsoField(false);
    } else {
      profileDangerZone?.classList.add('hidden');
      profileNotificationsZone?.classList.add('hidden');
      profilePendingNotice?.classList.add('hidden');
      if (profileStepIndicator) profileStepIndicator.textContent = 'Paso 1 de 2';
      if (profileCardTitle) profileCardTitle.textContent = 'Configura tus Datos Fiscales';
      if (profileCardSubtitle) profileCardSubtitle.textContent = 'Para poder rellenar automáticamente los portales de facturación, necesitamos saber a nombre de quién se expedirán tus comprobantes fiscales.';
      if (btnSaveProfile) {
        const desktopText = btnSaveProfile.querySelector('.btn-text-desktop');
        const mobileText = btnSaveProfile.querySelector('.btn-text-mobile');
        if (desktopText) desktopText.textContent = 'Guardar Perfil y Continuar';
        if (mobileText) mobileText.textContent = 'Guardar';
      }
      btnCancelProfile.style.display = 'none';
      btnCancelProfile.textContent = 'Cancelar';
      profileForm.reset();
      clearRegimenSelection();
      // Default to common values
      if (profUso) {
        profUso.value = 'G03';
      }
      syncCustomUsoFromValue('G03');
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
      setFieldValidationUI(profRazon, profRazonFeedback, { valid: false, message: 'Ingresa tu Razón Social o Nombre Completo.' }, true);
      showToast('Ingresa tu Razón Social o Nombre Completo tal como aparece en tu Constancia Fiscal.', 'error');
      profRazon?.focus();
      return;
    } else {
      setFieldValidationUI(profRazon, profRazonFeedback, { valid: true }, true);
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
      customUsoContainer?.classList.add('is-invalid');
      validateUsoField(true);
      showToast('Por favor selecciona el Uso de CFDI preferente para tus comprobantes.', 'error');
      openUsoDropdown();
      return;
    } else {
      customUsoContainer?.classList.remove('is-invalid');
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

    // If there were receipts pending in memory, upload tickets under this RFC and proceed directly to invoice!
    if (currentScannedReceipts && currentScannedReceipts.length > 0) {
      uploadAndProcessPendingInvoices(profileData);
      return;
    }

    isPendingInvoicing = false;
    switchScreen(screenHistory);
    loadHistory();
  }

  function openDeleteProfileModal() {
    if (!deleteProfileModal) return;
    const profile = getProfile();
    if (deleteProfileRfcBadge) {
      deleteProfileRfcBadge.textContent = profile?.rfc ? `RFC: ${profile.rfc}` : 'Sin RFC';
    }
    deleteProfileModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    btnCancelDeleteModal?.focus();
    try {
      window.history.pushState({ deleteProfileModalOpen: true }, '');
    } catch {}
  }

  function closeDeleteProfileModal(shouldGoBack = true) {
    if (!deleteProfileModal) return;
    deleteProfileModal.classList.add('hidden');
    document.body.style.overflow = '';
    if (shouldGoBack && window.history.state && window.history.state.deleteProfileModalOpen) {
      try {
        window.history.back();
      } catch {}
    }
  }

  function confirmDeleteProfile() {
    closeDeleteProfileModal(false);

    // 1. Purge client-side persistence
    try {
      localStorage.removeItem('combusticket_profile');
      localStorage.removeItem('facturagas_profile');
    } catch {}

    try {
      document.cookie = 'combusticket_profile=;path=/;max-age=0;SameSite=Lax';
      document.cookie = 'facturagas_profile=;path=/;max-age=0;SameSite=Lax';
    } catch {}

    // 2. Stop history polling and reset in-memory history state
    if (historyPollingTimer) {
      clearInterval(historyPollingTimer);
      historyPollingTimer = null;
    }
    redisHistoryItems = [];
    window.userHistoryTickets = new Set();

    // 3. Clear profile form and custom dropdowns
    if (profileForm) {
      profileForm.reset();
    }
    clearRegimenSelection();
    if (profUso) profUso.value = 'G03';
    syncCustomUsoFromValue('G03');

    // 4. Reset validation styles
    [profRfc, profRazon, profEmail, profCp].forEach((el) => {
      el?.classList.remove('is-valid', 'is-invalid');
    });
    document.querySelectorAll('.field-status-icon').forEach((icon) => {
      icon.className = 'field-status-icon hidden';
      icon.innerHTML = '';
    });
    document.getElementById('regimen-select-check')?.classList.add('hidden');
    document.getElementById('uso-select-check')?.classList.add('hidden');
    [profRfcFeedback, profRazonFeedback, profEmailFeedback, profCpFeedback, profRegimenFeedback, profUsoFeedback].forEach((el) => {
      if (el) {
        el.className = 'validation-feedback';
        el.innerHTML = '';
      }
    });
    customRegimenContainer?.classList.remove('is-invalid');
    customUsoContainer?.classList.remove('is-invalid');

    // 5. Update UI state
    document.documentElement.classList.remove('has-profile');
    document.documentElement.classList.add('no-profile');
    profileDangerZone?.classList.add('hidden');
    profileNotificationsZone?.classList.add('hidden');
    updateProfileUI();

    // 6. Navigate back to Welcome screen and notify user
    switchScreen(screenWelcome);
    showToast('Perfil fiscal eliminado de este dispositivo.', 'info');
  }

  async function uploadAndProcessPendingInvoices(profileData) {
    if (!btnSaveProfile) return;

    btnSaveProfile.disabled = true;
    const origBtnHtml = btnSaveProfile.innerHTML;
    btnSaveProfile.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;"></div><span>Almacenando ticket en tu RFC...</span>`;

    try {
      showToast('Guardando ticket bajo tu RFC...', 'info');

      const formData = new FormData();
      formData.append('rfc', profileData.rfc);

      let filesAttached = 0;
      for (let i = 0; i < currentScannedReceipts.length; i++) {
        const r = currentScannedReceipts[i];
        if (r._file) {
          formData.append('receipts', r._file);
          filesAttached++;
        }
      }

      const existingUrls = currentScannedReceipts
        .map((r) => r.receiptImageUrl || r.previewUrl)
        .filter(Boolean);
      formData.append('existingUrls', JSON.stringify(existingUrls));

      const res = await fetch('/api/receipts/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.files) && data.files.length > 0) {
          data.files.forEach((f, idx) => {
            if (currentScannedReceipts[idx] && f.receiptImageUrl) {
              currentScannedReceipts[idx].receiptImageUrl = f.receiptImageUrl;
              currentScannedReceipts[idx].previewUrl = f.receiptImageUrl;
            }
          });
        }
        if (Array.isArray(data.migrated) && data.migrated.length > 0) {
          data.migrated.forEach((m) => {
            currentScannedReceipts.forEach((r) => {
              if (r.receiptImageUrl === m.originalUrl || r.previewUrl === m.originalUrl) {
                r.receiptImageUrl = m.receiptImageUrl;
                r.previewUrl = m.receiptImageUrl;
              }
            });
          });
        }
      }

      isPendingInvoicing = false;
      btnSaveProfile.disabled = false;
      btnSaveProfile.innerHTML = origBtnHtml;

      // Automatically advance to invoicing without re-uploading!
      await handleEnqueueInvoices();
    } catch (err) {
      console.error('Error uploading receipt under RFC:', err);
      btnSaveProfile.disabled = false;
      btnSaveProfile.innerHTML = origBtnHtml;
      isPendingInvoicing = false;
      await handleEnqueueInvoices();
    }
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
              _file: fileObj,
            });
          } else {
            currentScannedReceipts.push({
              gasStation: 'GOGAS',
              stationNumber: '',
              cashier: '',
              trackingNumber: '',
              amount: 0,
              date: new Date().toISOString().split('T')[0],
              paymentMethod: 'TARJETA DE CRÉDITO',
              billingUrl: 'https://www.facturasgas.com',
              previewUrl: serverReceiptImg || pUrl,
              receiptImageUrl: serverReceiptImg || pUrl,
              _file: fileObj,
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
              _file: file,
            });
          } else {
            currentScannedReceipts.push({
              gasStation: 'GOGAS',
              stationNumber: '12009',
              cashier: 'ANGEL IVAN CLAU MAY',
              trackingNumber: '12009037449671666',
              amount: 1090.40,
              date: '21/08/2026 14:57',
              paymentMethod: 'TARJETA DE CRÉDITO',
              billingUrl: 'https://www.facturasgas.com',
              previewUrl: demoReceiptImg,
              receiptImageUrl: demoReceiptImg,
              _file: file,
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
      cashier: '',
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

  const PAYMENT_METHODS = [
    'Efectivo',
    'Tarjeta de Crédito',
    'Tarjeta de Débito',
    'Tarjeta de Servicios',
    'Cheque',
    'Transferencia Electrónica de Fondos',
  ];

  function normalizePaymentMethod(raw) {
    if (!raw) return 'Tarjeta de Crédito';
    const s = String(raw).toUpperCase().trim();
    if (s.includes('EFECTIVO') || s.includes('CASH')) return 'Efectivo';
    if (s.includes('DEBITO') || s.includes('DÉBITO')) return 'Tarjeta de Débito';
    if (s.includes('SERVICIO') || s.includes('VALE') || s.includes('MONEDERO') || s.includes('FLOTILLA')) return 'Tarjeta de Servicios';
    if (s.includes('CHEQUE')) return 'Cheque';
    if (s.includes('TRANSFERENCIA') || s.includes('SPEI') || s.includes('FONDOS') || s.includes('ELECTRONICA')) return 'Transferencia Electrónica de Fondos';
    if (s.includes('CREDITO') || s.includes('CRÉDITO') || s.includes('VISA') || s.includes('MC') || s.includes('MASTER') || s.includes('AMEX') || s.includes('AMERICAN')) return 'Tarjeta de Crédito';
    const found = PAYMENT_METHODS.find((m) => m.toLowerCase() === s.toLowerCase());
    return found || 'Tarjeta de Crédito';
  }

  function renderPortalChoices(receipt) {
    const rawUrl = (receipt.billingUrl || receipt.portalUrl || '').trim();
    const rawDomain = getBillingDomain(receipt).toLowerCase();
    const stations = (Array.isArray(supportedStations) && supportedStations.length > 0)
      ? supportedStations
      : DEFAULT_FALLBACK_STATIONS;

    let matchedIndex = -1;
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const stDomain = (st.domain || '').toLowerCase();
      const stPortal = (st.portalUrl || '').toLowerCase();
      if (
        (rawUrl && (rawUrl.toLowerCase() === stPortal || rawUrl.toLowerCase().includes(stDomain))) ||
        (rawDomain && (rawDomain === stDomain || rawDomain.includes(stDomain) || stDomain.includes(rawDomain))) ||
        (receipt.stationId && receipt.stationId.toLowerCase() === st.id.toLowerCase())
      ) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1 && (!rawUrl || rawUrl.includes('facturasgas') || rawDomain.includes('facturasgas'))) {
      matchedIndex = stations.findIndex((s) => s.id === 'gogas');
    }

    let html = '';
    if (matchedIndex === -1 && rawUrl) {
      html += `<option value="${escapeHtml(rawUrl)}" selected>Detectado: ${escapeHtml(rawDomain || rawUrl)}</option>`;
    }

    stations.forEach((st, idx) => {
      const val = st.portalUrl || `https://${st.domain}`;
      const isSel = idx === matchedIndex;
      const isAvailable = st.status === 'active';
      const labelSuffix = isAvailable ? '' : ' (Próximamente)';
      html += `<option value="${escapeHtml(val)}" ${isSel ? 'selected' : ''}>${escapeHtml(st.name)} (${escapeHtml(st.domain || val)})${labelSuffix}</option>`;
    });

    return html;
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
            <strong class="receipt-card-domain">${escapeHtml(getBillingDomain(receipt))}</strong>
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
            <label class="form-label">No. de Rastreo / Ticket <span class="req">*</span></label>
            <input type="text" class="form-input font-mono font-bold ${isDuplicate ? 'input-duplicate' : ''}" data-field="trackingNumber" data-index="${index}" value="${escapeHtml(receipt.trackingNumber || '')}" placeholder="Código de ticket">
          </div>

          <div class="form-group">
            <label class="form-label">Monto Total ($ MXN) <span class="req">*</span></label>
            <input type="number" step="0.01" class="form-input font-bold" data-field="amount" data-index="${index}" value="${receipt.amount || 0}">
          </div>

          <div class="form-group">
            <label class="form-label">Fecha y Hora</label>
            <input type="text" class="form-input font-mono" data-field="date" data-index="${index}" value="${escapeHtml(receipt.date || '')}" placeholder="DD/MM/AAAA HH:MM">
          </div>

          <div class="form-group">
            <label class="form-label">No. de Estación</label>
            <input type="text" class="form-input font-mono" data-field="stationNumber" data-index="${index}" value="${escapeHtml(receipt.stationNumber || '')}" placeholder="Ej. 14764">
          </div>

          <div class="form-group">
            <label class="form-label">Cajero / Despachador</label>
            <input type="text" class="form-input" data-field="cashier" data-index="${index}" value="${escapeHtml(receipt.cashier || '')}" placeholder="Nombre o No. de Cajero">
          </div>

          <div class="form-group">
            <label class="form-label">Forma de Pago <span class="req">*</span></label>
            <select class="form-select font-bold" data-field="paymentMethod" data-index="${index}">
              ${PAYMENT_METHODS.map((pm) => {
                const isSel = normalizePaymentMethod(receipt.paymentMethod) === pm;
                return `<option value="${escapeHtml(pm)}" ${isSel ? 'selected' : ''}>${escapeHtml(pm)}</option>`;
              }).join('')}
            </select>
          </div>

          <div class="form-group form-group-full">
            <label class="form-label">Portal de Facturación Detectado <span class="req">*</span></label>
            <select class="form-select font-mono" data-field="billingUrl" data-index="${index}">
              ${renderPortalChoices(receipt)}
            </select>
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

    // Bind inputs & selects to state
    receiptsList.querySelectorAll('input, select').forEach((element) => {
      const handleFieldChange = (e) => {
        const idx = parseInt(element.getAttribute('data-index'), 10);
        const field = element.getAttribute('data-field');
        if (currentScannedReceipts[idx]) {
          currentScannedReceipts[idx][field] = e.target.value;
          if (field === 'amount') {
            recalculateTotal();
          } else if (field === 'trackingNumber') {
            updateDuplicateValidation();
          } else if (field === 'billingUrl') {
            const cardEl = element.closest('.receipt-card');
            if (cardEl) {
              const headerDomain = cardEl.querySelector('.receipt-card-title-group strong');
              if (headerDomain) {
                headerDomain.textContent = getBillingDomain(currentScannedReceipts[idx]);
              }
            }
          }
        }
      };
      element.addEventListener('input', handleFieldChange);
      element.addEventListener('change', handleFieldChange);
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
      showToast('¡Datos del ticket listos! Configura tus datos fiscales para emitir tu factura.', 'info');
      openProfileScreen(false, { pendingInvoicing: true });
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

    // Auto-prompt push notification permissions on receipt submit if not yet decided
    if ('Notification' in window && Notification.permission === 'default') {
      autoPromptPushPermission(profile.rfc).catch(() => {});
    } else if ('Notification' in window && Notification.permission === 'granted') {
      subscribeUserToPush(profile.rfc, { silentSuccess: true }).catch(() => {});
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

  function openLegalModal(tabId = 'legal-pane-terms') {
    if (!legalModal) return;

    const tabButtons = legalModal.querySelectorAll('.legal-tab-btn');
    const panes = legalModal.querySelectorAll('.legal-pane');

    tabButtons.forEach((btn) => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    panes.forEach((pane) => {
      if (pane.id === tabId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    if (tabId === 'legal-pane-terms') {
      if (legalModalTitle) legalModalTitle.textContent = 'Términos y Condiciones de Uso';
    } else if (tabId === 'legal-pane-privacy') {
      if (legalModalTitle) legalModalTitle.textContent = 'Política de Privacidad Integral';
    } else if (tabId === 'legal-pane-disclaimer') {
      if (legalModalTitle) legalModalTitle.textContent = 'Aviso Legal y Deslinde SAT';
    }

    const modalBody = legalModal.querySelector('.legal-modal-body');
    if (modalBody) modalBody.scrollTop = 0;

    legalModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      window.history.pushState({ legalModalOpen: true }, '');
    } catch {}
  }

  function closeLegalModal(shouldGoBack = true) {
    if (!legalModal) return;
    legalModal.classList.add('hidden');
    document.body.style.overflow = '';
    if (shouldGoBack && window.history.state && window.history.state.legalModalOpen) {
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

    // 3. Push Notifications (VAPID) Integration
    setupPushNotifications();
  }

  // --- Push Notifications (VAPID) ---
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function updatePushStatusUI() {
    const btnPush = document.getElementById('btn-push-subscribe');
    const textPush = document.getElementById('push-btn-text');
    const statusBadge = document.getElementById('push-status-badge');
    const statusDesc = document.getElementById('push-status-desc');

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      if (profileNotificationsZone) profileNotificationsZone.classList.add('hidden');
      return;
    }

    if (!btnPush) return;

    if (Notification.permission === 'denied') {
      btnPush.classList.remove('btn-active');
      btnPush.disabled = true;
      if (textPush) textPush.textContent = 'Permiso Bloqueado';
      btnPush.setAttribute('title', 'Notificaciones bloqueadas en los ajustes de tu navegador');
      if (statusBadge) {
        statusBadge.className = 'push-status-badge badge-blocked';
        statusBadge.textContent = 'Bloqueadas';
      }
      if (statusDesc) {
        statusDesc.textContent = 'Las notificaciones están bloqueadas en la configuración de tu navegador. Para recibirlas, permite las alertas en los permisos del sitio.';
      }
      return;
    }

    btnPush.disabled = false;

    if (Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          btnPush.classList.add('btn-active');
          if (textPush) textPush.textContent = 'Desactivar Alertas';
          btnPush.setAttribute('title', 'Notificaciones activadas. Clic para desactivar');
          if (statusBadge) {
            statusBadge.className = 'push-status-badge badge-active';
            statusBadge.textContent = 'Activas';
          }
          if (statusDesc) {
            statusDesc.textContent = 'Alertas push activadas en este dispositivo. Te notificaremos en cuanto tus facturas se timbren o requieran atención.';
          }
          return;
        }
      } catch (e) {}
    }

    btnPush.classList.remove('btn-active');
    if (textPush) textPush.textContent = 'Activar Alertas';
    btnPush.setAttribute('title', 'Activar notificaciones de facturas completadas');
    if (statusBadge) {
      statusBadge.className = 'push-status-badge badge-inactive';
      statusBadge.textContent = 'Inactivas';
    }
    if (statusDesc) {
      statusDesc.textContent = 'Recibe avisos directos en este dispositivo cuando tus facturas se completen o requieran atención.';
    }
  }

  async function subscribeUserToPush(targetRfc, options = {}) {
    const { silentSuccess = false } = options;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }

    let rfc = targetRfc;
    if (!rfc) {
      try {
        const localProfile = JSON.parse(localStorage.getItem('combusticket_profile') || '{}');
        if (localProfile && localProfile.rfc) rfc = localProfile.rfc;
      } catch (e) {}
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const res = await fetch('/api/push/public-key');
        const data = await res.json();
        if (!data.success || !data.publicKey) {
          if (!silentSuccess) showToast('No se pudo obtener la clave VAPID del servidor.', 'error');
          return false;
        }

        const applicationServerKey = urlBase64ToUint8Array(data.publicKey);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }

      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: sub, rfc }),
        });

        if (!silentSuccess) {
          showToast('🔔 ¡Notificaciones push activadas! Te avisaremos al timbrar tu factura.', 'success');
        }
        updatePushStatusUI();
        return true;
      }
    } catch (err) {
      console.error('[Push] Error al suscribir a notificaciones:', err);
      if (!silentSuccess) {
        showToast('Error al configurar notificaciones push: ' + (err.message || err), 'error');
      }
      updatePushStatusUI();
    }
    return false;
  }

  async function unsubscribeUserFromPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        let rfc = undefined;
        try {
          const localProfile = JSON.parse(localStorage.getItem('combusticket_profile') || '{}');
          if (localProfile && localProfile.rfc) rfc = localProfile.rfc;
        } catch (e) {}

        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, rfc }),
        }).catch(() => {});

        showToast('Notificaciones push desactivadas.', 'info');
        updatePushStatusUI();
      }
    } catch (err) {
      console.error('[Push] Error al desactivar notificaciones:', err);
      showToast('Error al desactivar notificaciones: ' + (err.message || err), 'error');
      updatePushStatusUI();
    }
  }

  async function autoPromptPushPermission(rfc) {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await subscribeUserToPush(rfc, { silentSuccess: false });
        }
      } catch (err) {
        console.warn('[Push] Error en solicitud automática de permisos:', err);
      }
    } else if (Notification.permission === 'granted') {
      subscribeUserToPush(rfc, { silentSuccess: true }).catch(() => {});
    }
  }

  async function togglePushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      showToast('Tu navegador no soporta notificaciones push en segundo plano.', 'warning');
      return;
    }

    if (Notification.permission === 'denied') {
      showToast('Las notificaciones están bloqueadas en tu navegador. Puedes habilitarlas en los permisos del sitio.', 'warning');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await unsubscribeUserFromPush();
        return;
      }

      // Request permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Permiso de notificaciones no concedido.', 'warning');
        updatePushStatusUI();
        return;
      }

      await subscribeUserToPush(getProfile()?.rfc, { silentSuccess: false });
    } catch (err) {
      console.error('[Push] Error al configurar notificaciones:', err);
      showToast('Error al configurar notificaciones push: ' + (err.message || err), 'error');
      updatePushStatusUI();
    }
  }

  function setupPushNotifications() {
    const btnPush = document.getElementById('btn-push-subscribe');
    if (btnPush) {
      btnPush.addEventListener('click', togglePushSubscription);
      navigator.serviceWorker?.ready?.then(updatePushStatusUI).catch(() => {});
    }
  }

  setupPWA();

  // Run app
  init();
});

