(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const state = {
    backendUrl: '',
    token: '',
    scanner: null,
    scannerRunning: false,
    scannerPaused: false,
    scanLocked: false,
    installPrompt: null
  };

  const loginView = $('loginView');
  const mainView = $('mainView');
  const loginMessage = $('loginMessage');
  const resultCard = $('resultCard');
  const studentBlock = $('studentBlock');

  const STORAGE_BACKEND = 'attendance_backend_url';
  const STORAGE_TOKEN = 'attendance_session_token';


  function show(el) {
    el.classList.remove('hidden');
  }


  function hide(el) {
    el.classList.add('hidden');
  }


  function setBusy(on) {
    $('busyOverlay').classList.toggle('hidden', !on);
  }


  function setLoginMessage(message, type = 'error') {
    loginMessage.textContent = message || '';
    loginMessage.className = `message ${type}`;
    show(loginMessage);
  }


  function clearLoginMessage() {
    hide(loginMessage);
    loginMessage.textContent = '';
  }


  function normalizeBackendUrl(value) {
    return String(value || '')
      .trim()
      .replace(/\/+$/, '');
  }


  function validBackendUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        /script\.google\.com$/i.test(url.hostname) &&
        /\/exec$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }


  function api(action, params = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const backend = normalizeBackendUrl(state.backendUrl);

      if (!validBackendUrl(backend)) {
        reject(new Error('رابط Apps Script Web App غير صحيح.'));
        return;
      }

      const callbackName =
        `__att_cb_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

      const query = new URLSearchParams({
        action,
        callback: callbackName,
        ...params
      });

      const script = document.createElement('script');
      let done = false;

      const cleanup = () => {
        if (done) return;
        done = true;

        clearTimeout(timer);

        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }

        script.remove();
      };

      window[callbackName] = payload => {
        cleanup();

        if (
          payload &&
          payload.ok === false &&
          (payload.code === 'auth_required' ||
           payload.code === 'auth_expired')
        ) {
          clearSavedToken();
          showLogin(
            payload.message ||
            'انتهت جلسة الدخول. أدخل رمز الدخول مرة أخرى.'
          );
          reject(new Error(payload.message || 'انتهت جلسة الدخول.'));
          return;
        }

        resolve(payload);
      };

      script.onerror = () => {
        cleanup();
        reject(
          new Error(
            'تعذر الاتصال بالـ Backend. تأكد من الإنترنت ومن رابط Web App.'
          )
        );
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            'انتهت مهلة الاتصال. جرّب مرة أخرى وتأكد من الإنترنت.'
          )
        );
      }, timeoutMs);

      script.src = `${backend}?${query.toString()}`;
      document.head.appendChild(script);
    });
  }


  function saveBackend(url) {
    state.backendUrl = normalizeBackendUrl(url);
    localStorage.setItem(STORAGE_BACKEND, state.backendUrl);
  }


  function saveToken(token) {
    state.token = String(token || '');
    sessionStorage.setItem(STORAGE_TOKEN, state.token);
  }


  function clearSavedToken() {
    state.token = '';
    sessionStorage.removeItem(STORAGE_TOKEN);
  }


  async function login() {
    clearLoginMessage();

    const backend = normalizeBackendUrl($('backendUrl').value);
    const pin = String($('pin').value || '').trim();

    if (!validBackendUrl(backend)) {
      setLoginMessage(
        'الصق رابط Web App الذي ينتهي بـ /exec.'
      );
      return;
    }

    if (!pin) {
      setLoginMessage('اكتب رمز الدخول.');
      return;
    }

    saveBackend(backend);

    $('loginBtn').disabled = true;

    try {
      const payload = await api('login', { pin }, 25000);

      if (!payload || !payload.ok) {
        setLoginMessage(
          payload?.message || 'تعذر تسجيل الدخول.'
        );
        return;
      }

      saveToken(payload.token);
      $('pin').value = '';

      openMain(payload);

    } catch (err) {
      setLoginMessage(err.message || 'تعذر تسجيل الدخول.');
    } finally {
      $('loginBtn').disabled = false;
    }
  }


  async function restoreSession() {
    const backend =
      localStorage.getItem(STORAGE_BACKEND) || '';

    const token =
      sessionStorage.getItem(STORAGE_TOKEN) || '';

    if (backend) {
      $('backendUrl').value = backend;
    }

    state.backendUrl = normalizeBackendUrl(backend);
    state.token = token;

    if (!backend || !token) {
      showLogin();
      return;
    }

    setBusy(true);

    try {
      const payload = await api(
        'initial',
        { token: state.token },
        25000
      );

      if (!payload || !payload.ok) {
        clearSavedToken();
        showLogin(
          payload?.message ||
          'أدخل رمز الدخول مرة أخرى.'
        );
        return;
      }

      openMain(payload);

    } catch (err) {
      if (state.token) {
        showLogin(
          'تعذر استعادة الجلسة. أدخل رمز الدخول مرة أخرى.'
        );
      }
    } finally {
      setBusy(false);
    }
  }


  function showLogin(message = '') {
    hide(mainView);
    show(loginView);

    if (message) {
      setLoginMessage(message);
    }

    stopScanner();
  }


  function openMain(payload) {
    hide(loginView);
    show(mainView);
    clearLoginMessage();

    fillSessions(
      payload.sessions || [],
      payload.currentSession || ''
    );

    renderStats(payload.stats || emptyStats());
  }


  function fillSessions(sessions, selected) {
    const select = $('sessionSelect');
    select.innerHTML = '';

    if (!sessions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'لا يوجد لقاء بعد';
      select.appendChild(option);
      updateSessionTitle();
      return;
    }

    sessions.forEach(session => {
      const option = document.createElement('option');
      option.value = session;
      option.textContent = session;
      option.selected = session === selected;
      select.appendChild(option);
    });

    if (!select.value && sessions.length) {
      select.value = sessions[sessions.length - 1];
    }

    updateSessionTitle();
  }


  function updateSessionTitle() {
    $('sessionTitle').textContent =
      $('sessionSelect').value || 'لا يوجد لقاء';
  }


  function emptyStats() {
    return {
      total: 0,
      attended: 0,
      absent: 0,
      pending: 0,
      percentage: 0,
      sectors: []
    };
  }


  function renderStats(stats) {
    stats = stats || emptyStats();

    $('totalCount').textContent =
      Number(stats.total || 0);

    $('attendedCount').textContent =
      Number(stats.attended || 0);

    $('pendingCount').textContent =
      Number(stats.pending || 0);

    $('percentageCount').textContent =
      `${Number(stats.percentage || 0)}%`;

    const list = $('sectorList');
    list.innerHTML = '';

    const sectors = Array.isArray(stats.sectors)
      ? stats.sectors
      : [];

    if (!sectors.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'لا توجد بيانات قطاع لهذا اللقاء.';
      list.appendChild(empty);
      return;
    }

    sectors.forEach(item => {
      const row = document.createElement('div');
      row.className = 'sector-row';

      const name = document.createElement('div');
      name.className = 'sector-name';
      name.textContent = item.sector || 'بدون قطاع';

      const attended = document.createElement('div');
      attended.className = 'sector-cell';
      attended.innerHTML =
        `<small>حضر</small><strong>${Number(item.attended || 0)}</strong>`;

      const total = document.createElement('div');
      total.className = 'sector-cell';
      total.innerHTML =
        `<small>الإجمالي</small><strong>${Number(item.total || 0)}</strong>`;

      const percent = document.createElement('div');
      percent.className = 'sector-percent';

      const pct = clamp(
        Number(item.percentage || 0),
        0,
        100
      );

      const label = document.createElement('strong');
      label.textContent = `${pct}%`;

      const progress = document.createElement('div');
      progress.className = 'progress';

      const bar = document.createElement('span');
      bar.style.width = `${pct}%`;

      progress.appendChild(bar);
      percent.append(label, progress);

      row.append(
        name,
        attended,
        total,
        percent
      );

      list.appendChild(row);
    });
  }


  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }


  async function refreshStats() {
    const session = $('sessionSelect').value;

    updateSessionTitle();

    if (!session) {
      renderStats(emptyStats());
      return;
    }

    setBusy(true);

    try {
      const payload = await api('stats', {
        token: state.token,
        session
      });

      if (!payload || !payload.ok) {
        throw new Error(
          payload?.message || 'تعذر تحديث الإحصائيات.'
        );
      }

      renderStats(payload.stats);

    } catch (err) {
      showResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setBusy(false);
    }
  }


  async function registerCode(rawCode, fromScanner = false) {
    const session = $('sessionSelect').value;
    const code = String(rawCode || '').trim();

    if (!session) {
      showResult({
        type: 'error',
        message: 'اختر اللقاء أولًا.'
      });
      unlockScanSoon();
      return;
    }

    if (!code) {
      showResult({
        type: 'error',
        message: 'اكتب أو امسح كود الطالب.'
      });
      unlockScanSoon();
      return;
    }

    $('manualBtn').disabled = true;

    try {
      const payload = await api('register', {
        token: state.token,
        session,
        code
      }, 25000);

      if (!payload) {
        throw new Error('لم يصل رد من الـ Backend.');
      }

      showResult(payload);

      if (payload.stats) {
        renderStats(payload.stats);
      }

      $('manualCode').value = '';

      if (
        payload.type === 'registered' ||
        payload.type === 'duplicate'
      ) {
        feedback(payload.type === 'registered');
      }

    } catch (err) {
      showResult({
        type: 'error',
        message: err.message || 'تعذر تسجيل الحضور.'
      });
    } finally {
      $('manualBtn').disabled = false;

      if (fromScanner) {
        setTimeout(() => {
          state.scanLocked = false;
          resumeScanner();
        }, 900);
      } else {
        state.scanLocked = false;
      }
    }
  }


  function showResult(payload) {
    const type =
      payload?.type === 'registered'
        ? 'success'
        : payload?.type === 'duplicate'
          ? 'warning'
          : 'error';

    resultCard.className = `result-card ${type}`;
    show(resultCard);

    let prefix = '❌';

    if (type === 'success') prefix = '✅';
    if (type === 'warning') prefix = '⚠️';

    $('resultStatus').textContent =
      `${prefix} ${payload?.message || 'حدث خطأ.'}`;

    if (payload?.student) {
      show(studentBlock);

      $('studentName').textContent =
        payload.student.name || '';

      $('studentSector').textContent =
        payload.student.sector || '—';

      $('studentRegion').textContent =
        payload.student.region || '—';

      $('studentCode').textContent =
        payload.student.code || '—';
    } else {
      hide(studentBlock);
    }
  }


  function feedback(success) {
    if ('vibrate' in navigator) {
      navigator.vibrate(
        success ? 80 : [60, 45, 60]
      );
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.frequency.value =
        success ? 880 : 330;

      gain.gain.setValueAtTime(
        .035,
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        .001,
        ctx.currentTime + .12
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + .13);

      setTimeout(() => ctx.close(), 250);

    } catch (_) {}
  }


  async function startScanner() {
    if (
      state.scannerRunning &&
      !state.scannerPaused
    ) {
      return;
    }

    if (!window.Html5Qrcode) {
      showResult({
        type: 'error',
        message:
          'قارئ QR لم يتم تحميله. تأكد من اتصال الإنترنت ثم أعد فتح التطبيق.'
      });
      return;
    }

    show($('scannerArea'));

    if (
      state.scannerRunning &&
      state.scannerPaused
    ) {
      resumeScanner();
      return;
    }

    try {
      state.scanner =
        state.scanner ||
        new Html5Qrcode('reader');

      await state.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: qrboxSize,
          aspectRatio: 1.0
        },
        decodedText => {
          if (state.scanLocked) return;

          state.scanLocked = true;
          pauseScanner();
          registerCode(decodedText, true);
        },
        () => {}
      );

      state.scannerRunning = true;
      state.scannerPaused = false;

    } catch (err) {
      state.scannerRunning = false;
      state.scannerPaused = false;

      showResult({
        type: 'error',
        message:
          'تعذر فتح الكاميرا. اسمح للتطبيق باستخدام الكاميرا من إعدادات Chrome ثم حاول مرة أخرى.'
      });
    }
  }


  function qrboxSize(viewfinderWidth, viewfinderHeight) {
    const minEdge = Math.min(
      viewfinderWidth,
      viewfinderHeight
    );

    const size = Math.max(
      190,
      Math.min(280, Math.floor(minEdge * .72))
    );

    return {
      width: size,
      height: size
    };
  }


  function pauseScanner() {
    if (
      !state.scanner ||
      !state.scannerRunning ||
      state.scannerPaused
    ) {
      return;
    }

    try {
      if (
        typeof state.scanner.pause === 'function'
      ) {
        state.scanner.pause(true);
        state.scannerPaused = true;
      }
    } catch (_) {}
  }


  function resumeScanner() {
    if (
      !state.scanner ||
      !state.scannerRunning
    ) {
      return;
    }

    try {
      if (
        state.scannerPaused &&
        typeof state.scanner.resume === 'function'
      ) {
        state.scanner.resume();
        state.scannerPaused = false;
      }
    } catch (_) {}
  }


  async function stopScanner() {
    state.scanLocked = false;

    if (
      state.scanner &&
      state.scannerRunning
    ) {
      try {
        await state.scanner.stop();
      } catch (_) {}
    }

    state.scannerRunning = false;
    state.scannerPaused = false;
    hide($('scannerArea'));
  }


  function unlockScanSoon() {
    setTimeout(() => {
      state.scanLocked = false;
      resumeScanner();
    }, 700);
  }


  async function createSession() {
    const date = $('newSessionDate').value;

    if (!date) {
      alert('اختر تاريخ اللقاء.');
      return;
    }

    $('createSessionBtn').disabled = true;

    try {
      const payload = await api(
        'create_session',
        {
          token: state.token,
          date
        },
        25000
      );

      if (!payload || !payload.ok) {
        throw new Error(
          payload?.message ||
          'تعذر إنشاء اللقاء.'
        );
      }

      fillSessions(
        payload.sessions || [],
        payload.session || payload.currentSession
      );

      renderStats(payload.stats || emptyStats());
      updateSessionTitle();

      $('newSessionDate').value = '';
      $('newSessionDialog').close();

      showResult({
        type: 'registered',
        message: `تم إنشاء ${payload.session}.`
      });

    } catch (err) {
      alert(err.message || 'تعذر إنشاء اللقاء.');
    } finally {
      $('createSessionBtn').disabled = false;
    }
  }


  async function finalizeSession() {
    const session = $('sessionSelect').value;

    if (!session) {
      showResult({
        type: 'error',
        message: 'اختر اللقاء أولًا.'
      });
      return;
    }

    const ok = confirm(
      'سيتم تسجيل "لم يحضر" لكل طالب ما زالت خانة هذا اللقاء فارغة لديه.\n\n' +
      'لو حضر طالب متأخرًا بعد ذلك، مسح QR سيحوّله إلى "حضر".\n\n' +
      'هل تريد المتابعة؟'
    );

    if (!ok) return;

    setBusy(true);

    try {
      const payload = await api(
        'finalize',
        {
          token: state.token,
          session
        },
        30000
      );

      if (!payload || !payload.ok) {
        throw new Error(
          payload?.message ||
          'تعذر إنهاء اللقاء.'
        );
      }

      renderStats(payload.stats || emptyStats());

      showResult({
        type: 'registered',
        message:
          `تم تسجيل الغياب لـ ${Number(payload.markedAbsent || 0)} طالب.`
      });

    } catch (err) {
      showResult({
        type: 'error',
        message: err.message
      });
    } finally {
      setBusy(false);
    }
  }


  async function logout() {
    try {
      if (state.token && state.backendUrl) {
        await api('logout', {
          token: state.token
        }, 8000);
      }
    } catch (_) {}

    clearSavedToken();
    $('settingsDialog').close();
    showLogin('تم تسجيل الخروج.');
  }


  function changeBackend() {
    clearSavedToken();
    localStorage.removeItem(STORAGE_BACKEND);
    state.backendUrl = '';
    $('backendUrl').value = '';
    $('settingsDialog').close();
    showLogin('الصق رابط Web App الجديد ثم سجّل الدخول.');
  }


  function setupInstallPrompt() {
    window.addEventListener(
      'beforeinstallprompt',
      event => {
        event.preventDefault();
        state.installPrompt = event;

        document
          .querySelectorAll('.install')
          .forEach(show);
      }
    );

    window.addEventListener(
      'appinstalled',
      () => {
        state.installPrompt = null;

        document
          .querySelectorAll('.install')
          .forEach(hide);
      }
    );
  }


  async function installApp() {
    if (state.installPrompt) {
      const prompt = state.installPrompt;
      state.installPrompt = null;

      prompt.prompt();

      try {
        await prompt.userChoice;
      } catch (_) {}

      document
        .querySelectorAll('.install')
        .forEach(hide);

      return;
    }

    alert(
      'لو زر التثبيت لم يظهر تلقائيًا:\n' +
      'افتح قائمة Chrome ⋮ ثم اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية".'
    );
  }


  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .catch(() => {});
    });
  }


  function wireEvents() {
    $('loginBtn').addEventListener('click', login);

    $('pin').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        login();
      }
    });

    $('sessionSelect').addEventListener(
      'change',
      refreshStats
    );

    $('refreshBtn').addEventListener(
      'click',
      refreshStats
    );

    $('scanBtn').addEventListener(
      'click',
      startScanner
    );

    $('resumeBtn').addEventListener(
      'click',
      resumeScanner
    );

    $('stopBtn').addEventListener(
      'click',
      stopScanner
    );

    $('manualBtn').addEventListener(
      'click',
      () => registerCode(
        $('manualCode').value,
        false
      )
    );

    $('manualCode').addEventListener(
      'keydown',
      event => {
        if (event.key === 'Enter') {
          event.preventDefault();

          registerCode(
            $('manualCode').value,
            false
          );
        }
      }
    );

    $('newSessionBtn').addEventListener(
      'click',
      () => $('newSessionDialog').showModal()
    );

    $('createSessionBtn').addEventListener(
      'click',
      createSession
    );

    $('finalizeBtn').addEventListener(
      'click',
      finalizeSession
    );

    $('menuBtn').addEventListener(
      'click',
      () => $('settingsDialog').showModal()
    );

    $('closeSettingsBtn').addEventListener(
      'click',
      () => $('settingsDialog').close()
    );

    $('logoutBtn').addEventListener(
      'click',
      logout
    );

    $('changeBackendBtn').addEventListener(
      'click',
      changeBackend
    );

    $('installBtnLogin').addEventListener(
      'click',
      installApp
    );

    $('installBtnSettings').addEventListener(
      'click',
      installApp
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          stopScanner();
        }
      }
    );
  }


  function init() {
    setupInstallPrompt();
    registerServiceWorker();
    wireEvents();

    const savedBackend =
      localStorage.getItem(STORAGE_BACKEND) || '';

    if (savedBackend) {
      $('backendUrl').value = savedBackend;
    }

    restoreSession();
  }


  init();
})();
